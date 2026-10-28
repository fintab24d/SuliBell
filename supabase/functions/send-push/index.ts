// Web Push küldő (Supabase Edge Function, v4). Csak az hívhatja, akinek van joga értesítést küldeni (update15.sql: 'push' terület).
// A feliratkozók listáját az admin oldal adja át (ő amúgy is látja őket), a függvény csak ellenőrzi a jogosultságot és elküldi az üzenetet.
// Titkok (Supabase → Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (pl. mailto:te@pelda.hu)
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const V = 4
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Csak a böngészők valódi push-szolgáltatóihoz küldünk (nem lehet tetszőleges címre kérést indítani).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/]
const okEndpoint = (e: unknown) => {
  try { const u = new URL(String(e)); return u.protocol === 'https:' && PUSH_HOSTS.some(r => r.test(u.hostname)) } catch { return false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { school_id, title, body, url, subs: given } = await req.json()
    if (!school_id || !title) return reply({ error: 'Hiányzó adat' }, 400)

    // 1) Jogosultság: a hívó bejelentkezett felhasználó legyen az iskola adminja
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: isAdmin, error: authErr } = await userClient.rpc('can_edit', { sid: school_id, area: 'push' })
    if (authErr || isAdmin !== true) return reply({ error: 'Nincs jogosultság' }, 403)

    // 2) Feliratkozók: az admin oldal adja át; ha nem, a hívó jogosultságával olvassuk
    let rows: any[] = Array.isArray(given) ? given : []
    if (!Array.isArray(given)) {
      const { data, error } = await userClient.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('school_id', school_id)
      if (error) return reply({ error: 'Feliratkozók lekérése nem sikerült: ' + error.message }, 500)
      rows = data ?? []
    }
    const subs = rows.filter(s => s && okEndpoint(s.endpoint) && typeof s.p256dh === 'string' && typeof s.auth === 'string').slice(0, 500)

    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)
    const payload = JSON.stringify({
      title: String(title).slice(0, 80),
      body: String(body ?? '').slice(0, 200),
      url: typeof url === 'string' && url.startsWith('/') ? url : '/',
    })

    let sent = 0
    const dead: string[] = []
    const failed: (number | string)[] = []
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 })
        sent++
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.id)      // lejárt feliratkozás
        else failed.push(err?.statusCode ?? String(err?.message ?? err).slice(0, 60))  // pl. 401/403: nem egyező VAPID kulcsok
      }
    }))
    if (dead.length) {   // lejárt feliratkozások törlése (service role kell; ha nem megy, nem baj)
      try { await createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!).from('push_subscriptions').delete().in('id', dead) } catch { /* nem kritikus */ }
    }
    return reply({ v: V, sent, removed: dead.length, failed: failed.length, codes: [...new Set(failed)], total: subs.length })
  } catch (e) {
    return reply({ error: String(e) }, 500)
  }
})
