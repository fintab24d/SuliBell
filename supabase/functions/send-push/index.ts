// Web Push küldő (Supabase Edge Function). Csak az iskola adminja hívhatja.
// Titkok (Supabase → Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (pl. mailto:te@pelda.hu)
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { school_id, title, body, url } = await req.json()
    if (!school_id || !title) return reply({ error: 'Hiányzó adat' }, 400)

    // 1) Jogosultság: a hívó bejelentkezett felhasználó legyen az iskola adminja
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: isAdmin, error: authErr } = await userClient.rpc('is_school_admin', { sid: school_id })
    if (authErr || isAdmin !== true) return reply({ error: 'Nincs jogosultság' }, 403)

    // 2) Feliratkozók lekérése (service role: a táblát az RLS miatt csak így lehet törölni)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('school_id', school_id)

    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)
    const payload = JSON.stringify({
      title: String(title).slice(0, 80),
      body: String(body ?? '').slice(0, 200),
      url: typeof url === 'string' && url.startsWith('/') ? url : '/',
    })

    let sent = 0
    const dead: string[] = []
    const failed: (number | string)[] = []
    await Promise.all((subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 })
        sent++
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.id)   // lejárt feliratkozás: törölni kell
        else failed.push(err?.statusCode ?? 'hiba')                                // pl. 401/403: nem egyező VAPID kulcsok
      }
    }))
    if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead)
    return reply({ sent, removed: dead.length, failed: failed.length, codes: [...new Set(failed)], total: subs?.length ?? 0 })
  } catch (e) {
    return reply({ error: String(e) }, 500)
  }
})
