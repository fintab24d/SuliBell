import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, SCHOOL_SLUG } from './lib/supabase'
import { enableAudio, ring } from './lib/sound'
import { fmtHM, toSec, type Schedule } from './lib/engine'
import { parseVideo } from './lib/video'
import { KIND, type Countdown } from './lib/kinds'

interface Full {
  id: string; name: string
  settings: { timezone: string; theme: string; sound_enabled: boolean; logo_url: string | null; tv_show_seconds: boolean; tv_show_next: boolean; tv_scale: number; site_version: string; version_note: string; alert_text: string; alert_active: boolean; lunch_after: number | null; year_start: string | null; year_end: string | null; weather_enabled: boolean; weather_city: string; weather_lat: number | null; weather_lon: number | null; tv_show_qr: boolean; bell_sound_url: string | null }
  countdowns: Countdown[]; announcements: { id: string; text: string; active_until: string | null }[]; schedule_dates: { id: string; day: string; schedule_id: string }[]; changes: { id: string; day: string; kind: string; lesson_label: string; text: string }[]; menus: { id: string; day: string; text: string }[]; schedules: Schedule[]; closed_days: { id: string; day: string; reason: string }[]
}
type Res = PromiseLike<{ error: { message: string } | null }>
const DAYS = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V']
const ZONES = ['Europe/Budapest', 'Europe/Bratislava', 'Europe/Vienna', 'Europe/Bucharest', 'Europe/Belgrade']
const p2 = (n: number) => String(n).padStart(2, '0')
const plus = (t: string, m: number) => { const s = Math.min(86340, toSec(t) + m * 60); return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}` }

const TABLE: Record<string, string> = { schools: 'Iskola', settings: 'Beállítások', schedules: 'Csengetési rend', lessons: 'Óra', closed_days: 'Tanítás nélküli nap', countdowns: 'Visszaszámláló', announcements: 'Közlemény', school_members: 'Admin jogosultság', schedule_dates: 'Különleges nap', changes: 'Változás', menus: 'Étlap', polls: 'Szavazás', break_videos: 'Szünet-videó' }
const ACT: Record<string, string> = { INSERT: 'létrehozott', UPDATE: 'módosított', DELETE: 'törölt' }
const FIELD: Record<string, string> = { name: 'név', label: 'megnevezés', start_time: 'kezdés', end_time: 'vége', title: 'cím', text: 'szöveg', day: 'nap', reason: 'indok', target_date: 'dátum', target_time: 'időpont', weekdays: 'napok', is_default: 'alapértelmezett', timezone: 'időzóna', theme: 'téma', sound_enabled: 'hang', logo_url: 'logó', tv_show_seconds: 'TV másodperc', tv_show_next: 'TV következő', tv_scale: 'TV méret', site_version: 'verzió', version_note: 'verzió megjegyzés', kind: 'fajta', active_until: 'eddig', position: 'sorrend', bell_sound_url: 'csengőhang' }
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(üres)' : typeof v === 'boolean' ? (v ? 'be' : 'ki') : String(v).slice(0, 40))
/** Rövid, olvasható leírás egy naplósorról (módosításnál: mező: régi → új). */
const describe = (r: any) => {
  const d = r.new_data ?? r.old_data ?? {}
  const name = d.title ?? d.name ?? d.label ?? d.text ?? d.reason ?? d.day ?? ''
  if (r.action !== 'UPDATE') return String(name)
  const ch = Object.keys(r.new_data).filter(k => k !== 'created_at' && JSON.stringify(r.new_data[k]) !== JSON.stringify(r.old_data[k]))
  return (name ? `${name}: ` : '') + ch.slice(0, 3).map(k => `${FIELD[k] ?? k}: ${show(r.old_data[k])} → ${show(r.new_data[k])}`).join('; ')
}

const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' })
const CHG: Record<string, string> = { cancel: 'Elmarad', substitute: 'Helyettesítés', room: 'Teremváltás', info: 'Info' }

export default function Admin() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  if (session === undefined) return <main className="admin">Betöltés…</main>
  return session ? <Panel /> : <Login />
}

function Login() {
  const [email, setEmail] = useState(''), [pw, setPw] = useState(''), [err, setErr] = useState('')
  const go = async (e: FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    if (error) setErr('Hibás email vagy jelszó.')
  }
  return <main className="admin"><h1>Admin belépés</h1>
    <form onSubmit={go} className="row">
      <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
      <input type="password" placeholder="Jelszó" value={pw} onChange={e => setPw(e.target.value)} required />
      <button>Belépés</button>
    </form>{err && <p>{err}</p>}</main>
}

function Panel() {
  const [d, setD] = useState<Full | null>(null)
  const [admin, setAdmin] = useState(true)
  const [sel, setSel] = useState('')
  const [msg, setMsg] = useState('')
  const [cd, setCd] = useState({ day: '', reason: '' })
  const [ev, setEv] = useState({ title: '', kind: 'other', date: '', time: '00:00' })
  const [an, setAn] = useState({ text: '', until: '' })
  const [sd, setSd] = useState({ day: '', schedule_id: '' })
  const [chg, setChg] = useState({ day: todayStr, kind: 'cancel', lesson_label: '', text: '' })
  const [mn, setMn] = useState({ day: todayStr, text: '' })
  const [pm, setPm] = useState({ title: '', body: '' })
  const [chgNotify, setChgNotify] = useState(true)
  const [subs, setSubs] = useState<number | null>(null)
  const [vids, setVids] = useState<any[] | null>(null)   // null: az update12.sql még nem futott le
  const [vf, setVf] = useState({ url: '', title: '' })
  const [pl, setPl] = useState({ q: '', opts: ['', '', '', ''] })
  const [polls, setPolls] = useState<any[] | null>(null)   // null: az update11.sql még nem futott le
  const [pcounts, setPcounts] = useState<Record<string, number[]>>({})
  const [wq, setWq] = useState('')
  const [wres, setWres] = useState<any[]>([])

  const load = useCallback(async () => {
    const m = await supabase.from('school_members').select('school_id')
    setAdmin(!!m.data?.length)
    const { data, error } = await supabase.from('schools')
      .select('id, name, settings(*), schedules(*, lessons(*)), closed_days(*), countdowns(*), announcements(*), schedule_dates(*), changes(*), menus(*)').eq('slug', SCHOOL_SLUG).single()
    if (error || !data) return setMsg('Hiba: ' + (error?.message ?? 'nincs adat'))
    const r = data as any
    setD({ ...r, settings: Array.isArray(r.settings) ? r.settings[0] : r.settings })
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {   // hány eszköz iratkozott fel az értesítésekre
    if (!d) return
    supabase.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('school_id', d.id)
      .then(({ count, error }) => setSubs(error ? null : count ?? 0))
  }, [d])
  useEffect(() => {   // szünet-videók
    if (!d) return
    supabase.from('break_videos').select('*').eq('school_id', d.id).order('created_at').then(({ data, error }) => setVids(error ? null : data ?? []))
  }, [d])
  useEffect(() => {   // szavazások és állásuk
    if (!d) return
    supabase.from('polls').select('*').eq('school_id', d.id).order('created_at', { ascending: false }).limit(10).then(async ({ data, error }) => {
      if (error) return setPolls(null)
      setPolls(data ?? [])
      const c: Record<string, number[]> = {}
      for (const p of data ?? []) { const r = await supabase.rpc('poll_counts', { p_poll: p.id }); c[p.id] = (r.data as number[]) ?? [] }
      setPcounts(c)
    })
  }, [d])
  // Módosítási napló: minden mentés után újratöltődik (a d állapot ilyenkor frissül)
  const [log, setLog] = useState<any[] | null | undefined>(undefined)
  useEffect(() => {
    if (!d) return
    supabase.from('audit_log').select('*').eq('school_id', d.id).order('created_at', { ascending: false }).limit(100)
      .then(({ data, error }) => setLog(error ? null : data ?? []))
  }, [d])

  if (!d) return <main className="admin">{msg || 'Betöltés…'}</main>
  if (!admin) return <main className="admin"><p>Ehhez a fiókhoz nincs admin jogosultság rendelve (lásd README 6. lépés).</p>
    <button onClick={() => supabase.auth.signOut()}>Kilépés</button></main>

  const run = async (p: Res) => { const { error } = await p; setMsg(error ? 'Hiba: ' + error.message : 'Mentve'); await load() }
  const setS = (patch: object) => run(supabase.from('settings').update(patch).eq('school_id', d.id))
  const cur = d.schedules.find(s => s.id === (sel || d.schedules[0]?.id))
  const lessons = cur ? [...cur.lessons].sort((a, b) => a.position - b.position) : []

  const addSchedule = async () => {
    const { data, error } = await supabase.from('schedules').insert({ school_id: d.id, name: 'Új csengetési rend' }).select('id').single()
    if (error) return setMsg('Hiba: ' + error.message)
    setSel(data.id); await load()
  }
  const makeDefault = async (id: string) => {
    await supabase.from('schedules').update({ is_default: false }).eq('school_id', d.id)   // max. egy alapértelmezett lehet
    run(supabase.from('schedules').update({ is_default: true }).eq('id', id))
  }
  const addLesson = () => {
    const last = lessons[lessons.length - 1]
    const start = last ? plus(last.end_time, 10) : '08:00'
    run(supabase.from('lessons').insert({ schedule_id: cur!.id, label: `${lessons.length + 1}. óra`, start_time: start, end_time: plus(start, 45), position: (last?.position ?? 0) + 1 }))
  }

  // Rövidített rend: a kiválasztott rendből új rendet készít, megadott óra- és szünethosszal
  const makeShort = async () => {
    if (!cur || !lessons.length) return
    const len = Number(prompt('Hány perces legyen egy óra?', '35')), br = Number(prompt('Hány perces legyen a szünet?', '5'))
    if (!len || !br) return
    const { data, error } = await supabase.from('schedules').insert({ school_id: d.id, name: `${cur.name} – rövidített` }).select('id').single()
    if (error) return setMsg('Hiba: ' + error.message)
    let t = toSec(lessons[0].start_time)
    const hm = (s: number) => `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}`
    const rows = lessons.map(l => { const s = t; t += len * 60; const r = { schedule_id: data.id, label: l.label, position: l.position, start_time: hm(s), end_time: hm(t) }; t += br * 60; return r })
    await run(supabase.from('lessons').insert(rows)); setSel(data.id)
  }

  // Város keresése (Open-Meteo geokódoló): a találatra kattintva mentődik a hely
  // Saját csengőhang feltöltése (a régi fájlt törli, hogy ne gyűljenek a feleslegesek)
  const dropOldSound = () => { const p = d.settings.bell_sound_url?.split('/sounds/')[1]; if (p) supabase.storage.from('sounds').remove([decodeURIComponent(p)]) }
  const uploadSound = async (f: File) => {
    if (f.size > 2 * 1024 * 1024) return setMsg('A hangfájl legfeljebb 2 MB lehet.')
    const path = `${d.id}/bell-${Date.now()}.${f.name.split('.').pop()}`   // mappa = iskola azonosító (RLS ezt ellenőrzi)
    const { error } = await supabase.storage.from('sounds').upload(path, f, { contentType: f.type })
    if (error) return setMsg('Hiba: ' + error.message)
    dropOldSound()
    await setS({ bell_sound_url: supabase.storage.from('sounds').getPublicUrl(path).data.publicUrl })
  }

  // Értesítés küldése a feliratkozott eszközökre (Supabase Edge Function, csak admin hívhatja)
  const sendPush = async (title: string, body: string) => {
    // A feliratkozók listáját az oldal olvassa (ugyanúgy, mint a számlálót), és átadja a küldő függvénynek
    const { data: subRows, error: se } = await supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('school_id', d.id)
    if (se) return setMsg('Feliratkozók lekérése nem sikerült: ' + se.message)
    if (!subRows?.length) return setMsg('Nincs feliratkozott eszköz. Nyisd meg az oldalt a telefonon, és nyomd meg az Értesítések gombot.')
    const { data, error } = await supabase.functions.invoke('send-push', { body: { school_id: d.id, title, body, url: '/', subs: subRows } })
    let detail = error?.message ?? ''
    if (error) { try { const b = await (error as any).context?.json?.(); if (b?.error) detail = b.error } catch { /* marad az általános üzenet */ } }
    const r: any = data ?? {}
    setMsg(error ? 'Értesítés hiba: ' + detail
      : r.v !== 3 && !r.sent ? 'A Supabase függvény régi verziója fut. Másold be újra a supabase/functions/send-push/index.ts tartalmát, és nyomj Deploy-t.'
      : `Értesítés elküldve: ${r.sent} / ${r.total} eszközre.` + (r.failed ? ` Sikertelen: ${r.failed} (kód: ${(r.codes ?? []).join(', ')}), ellenőrizd a VAPID kulcsokat.` : ''))
  }

  // ---- Biztonsági mentés: az iskola összes adata egy JSON fájlban ----
  const downloadBackup = () => {
    const { schedules, closed_days, countdowns, announcements, schedule_dates, changes, menus, settings } = d
    const out = {
      app: 'SuliBell', version: 1, saved_at: new Date().toISOString(), school: { id: d.id, name: d.name }, settings,
      schedules: schedules.map(({ lessons: _l, ...r }: any) => r), lessons: schedules.flatMap((s: any) => s.lessons),
      closed_days, countdowns, announcements, schedule_dates, changes, menus,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `sulibell-mentes-${todayStr}.json`; a.click(); URL.revokeObjectURL(url)
    setMsg('A mentés letöltődött.')
  }
  // Visszaállítás: a mentésben lévő elemeket visszaírja/felülírja; a mentés után létrehozott elemeket NEM törli.
  const restoreBackup = async (f: File) => {
    try {
      if (f.size > 5 * 1024 * 1024) return setMsg('A mentés fájl túl nagy.')
      const b = JSON.parse(await f.text())
      if (b?.app !== 'SuliBell' || b.version !== 1 || !Array.isArray(b.schedules)) return setMsg('Ez nem SuliBell mentés.')
      if (b.school?.id !== d.id) return setMsg('Ez a mentés egy másik iskolához tartozik.')
      if (!confirm(`Visszaállítod a ${b.saved_at?.slice(0, 16).replace('T', ' ')} körüli mentést? A mentésben lévő adatok felülíródnak.`)) return
      const own = (rows: any[] = []) => rows.map(r => ({ ...r, school_id: d.id }))
      const byDay = (rows: any[] = []) => own(rows).map(({ id: _i, ...r }: any) => r)     // egyedi (iskola, nap) kulcs: az azonosító újra generálódik
      const steps: [string, any[], string][] = [
        ['schedules', own(b.schedules).map(({ lessons: _l, ...r }: any) => r), 'id'],
        ['lessons', b.lessons ?? [], 'id'], ['closed_days', byDay(b.closed_days), 'school_id,day'],
        ['countdowns', own(b.countdowns), 'id'], ['announcements', own(b.announcements), 'id'],
        ['schedule_dates', byDay(b.schedule_dates), 'school_id,day'], ['changes', own(b.changes), 'id'], ['menus', byDay(b.menus), 'school_id,day'],
      ]
      if (b.settings) {
        const { error } = await supabase.from('settings').upsert({ ...b.settings, school_id: d.id }, { onConflict: 'school_id' })
        if (error) return setMsg('Hiba (settings): ' + error.message)
      }
      if (b.school?.name) await supabase.from('schools').update({ name: b.school.name }).eq('id', d.id)
      if (b.schedules.some((s: any) => s.is_default)) await supabase.from('schedules').update({ is_default: false }).eq('school_id', d.id)   // csak egy alapértelmezett lehet
      for (const [table, rows, conflict] of steps) {
        if (!rows.length) continue
        const { error } = await supabase.from(table).upsert(rows, { onConflict: conflict })
        if (error) return setMsg(`Hiba (${table}): ${error.message}`)
      }
      setMsg('A mentés visszaállítva.'); await load()
    } catch { setMsg('A fájl nem olvasható.') }
  }

  const searchCity = async () => {
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(wq.trim())}&count=5&language=hu&format=json`)
      const j = await r.json(); setWres(j.results ?? []); if (!j.results) setMsg('Nincs találat.')
    } catch { setMsg('A városkeresés most nem érhető el.') }
  }

  const upload = async (f: File) => {
    const path = `${d.id}/logo-${Date.now()}.${f.name.split('.').pop()}`   // mappa = iskola azonosító (RLS ezt ellenőrzi)
    const { error } = await supabase.storage.from('logos').upload(path, f, { contentType: f.type })
    if (error) return setMsg('Hiba: ' + error.message)
    await setS({ logo_url: supabase.storage.from('logos').getPublicUrl(path).data.publicUrl })
  }

  return <main className="admin">
    <header><h1>Admin – {d.name}</h1><button onClick={() => supabase.auth.signOut()}>Kilépés</button></header>
    <p className="msg" role="status">{msg}</p>

    <section><h2>Beállítások</h2>
      <div className="row">Iskola neve (csak az adminban látszik) <input defaultValue={d.name} key={d.name} onBlur={e => e.target.value !== d.name && run(supabase.from('schools').update({ name: e.target.value }).eq('id', d.id))} /></div>
      <div className="row">Időzóna <select value={d.settings.timezone} onChange={e => setS({ timezone: e.target.value })}>{ZONES.map(z => <option key={z}>{z}</option>)}</select>
        Téma <select value={d.settings.theme} onChange={e => setS({ theme: e.target.value })}><option value="dark">Sötét</option><option value="light">Világos</option></select></div>
      <div className="row"><label><input type="checkbox" checked={d.settings.sound_enabled} onChange={e => setS({ sound_enabled: e.target.checked })} /> Csengetési hang</label>
        <button onClick={async () => { await enableAudio(); ring(d.settings.bell_sound_url) }}>Hang kipróbálása</button></div>
      <div className="row">Csengőhang: <b>{d.settings.bell_sound_url ? 'saját fájl' : 'alapértelmezett'}</b>
        <input type="file" accept="audio/mpeg,audio/ogg,audio/wav,audio/mp4,audio/aac,audio/webm,.mp3,.ogg,.wav,.m4a" onChange={e => e.target.files?.[0] && uploadSound(e.target.files[0])} />
        {d.settings.bell_sound_url && <button onClick={() => { dropOldSound(); setS({ bell_sound_url: null }) }}>Alapértelmezett hang visszaállítása</button>}</div>
      <div className="row">Logó {d.settings.logo_url && <img className="logo" src={d.settings.logo_url} alt="" />}
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
        {d.settings.logo_url && <button onClick={() => setS({ logo_url: null })}>Logó eltávolítása</button>}</div>
      <div className="row">TV-mód:
        <label><input type="checkbox" checked={d.settings.tv_show_seconds} onChange={e => setS({ tv_show_seconds: e.target.checked })} /> másodperc az órán</label>
        <label><input type="checkbox" checked={d.settings.tv_show_next} onChange={e => setS({ tv_show_next: e.target.checked })} /> következő óra</label>
        <label><input type="checkbox" checked={d.settings.tv_show_qr !== false} onChange={e => setS({ tv_show_qr: e.target.checked })} /> QR-kód</label>
        <label>méret <input type="number" min={50} max={150} step={10} defaultValue={d.settings.tv_scale} key={d.settings.tv_scale} onBlur={e => setS({ tv_scale: Math.min(150, Math.max(50, +e.target.value || 100)) })} /> %</label></div>
      <div className="row">Oldal verziója <input size={8} placeholder="pl. 1.2.0" defaultValue={d.settings.site_version ?? ''} key={'v' + d.settings.site_version}
          onBlur={e => e.target.value !== (d.settings.site_version ?? '') && setS({ site_version: e.target.value })} />
        Megjegyzés <input style={{ minWidth: '16rem' }} placeholder="pl. Új közlemények" defaultValue={d.settings.version_note ?? ''} key={'n' + d.settings.version_note}
          onBlur={e => e.target.value !== (d.settings.version_note ?? '') && setS({ version_note: e.target.value })} /></div>
    </section>

    <section><h2>Csengetési rendek</h2>
      <div className="row">{d.schedules.map(s => <button key={s.id} className={s.id === cur?.id ? 'on' : ''} onClick={() => setSel(s.id)}>{s.name}{s.is_default ? ' ★' : ''}</button>)}
        <button onClick={addSchedule}>+ Új rend</button></div>
      {cur && <>
        <div className="row"><input defaultValue={cur.name} key={cur.id + cur.name} onBlur={e => e.target.value !== cur.name && run(supabase.from('schedules').update({ name: e.target.value }).eq('id', cur.id))} />
          <button onClick={() => makeDefault(cur.id)} disabled={cur.is_default}>{cur.is_default ? 'Alapértelmezett ★' : 'Legyen alapértelmezett'}</button>
          <button onClick={() => confirm('Biztosan törlöd a rendet az óráival együtt?') && run(supabase.from('schedules').delete().eq('id', cur.id))}>Rend törlése</button></div>
        <div className="row">Ezeken a napokon él (üres = csak alapértelmezettként):
          {DAYS.map((n, i) => <label key={n}><input type="checkbox" checked={cur.weekdays.includes(i + 1)}
            onChange={e => run(supabase.from('schedules').update({ weekdays: e.target.checked ? [...cur.weekdays, i + 1].sort() : cur.weekdays.filter(x => x !== i + 1) }).eq('id', cur.id))} /> {n}</label>)}</div>
        {lessons.map((l, i) => <div className="row" key={l.id}>
          <input defaultValue={l.label} key={l.id + l.label} size={10} onBlur={e => e.target.value !== l.label && run(supabase.from('lessons').update({ label: e.target.value }).eq('id', l.id))} />
          <input type="time" defaultValue={fmtHM(l.start_time)} key={l.id + l.start_time} onBlur={e => e.target.value !== fmtHM(l.start_time) && run(supabase.from('lessons').update({ start_time: e.target.value }).eq('id', l.id))} />
          –<input type="time" defaultValue={fmtHM(l.end_time)} key={l.id + l.end_time} onBlur={e => e.target.value !== fmtHM(l.end_time) && run(supabase.from('lessons').update({ end_time: e.target.value }).eq('id', l.id))} />
          <button onClick={() => run(supabase.from('lessons').delete().eq('id', l.id))}>Törlés</button>
          {lessons[i + 1] && <em>szünet: {Math.round((toSec(lessons[i + 1].start_time) - toSec(l.end_time)) / 60)} perc</em>}</div>)}
        <button onClick={addLesson}>+ Új óra</button> <button onClick={makeShort} disabled={!lessons.length}>Rövidített rend készítése ebből</button>
      </>}
    </section>

    <section><h2>Ünnepnapok, tanítás nélküli napok</h2>
      {d.closed_days.sort((a, b) => a.day.localeCompare(b.day)).map(c => <div className="row" key={c.id}>{c.day} – {c.reason}
        <button onClick={() => run(supabase.from('closed_days').delete().eq('id', c.id))}>Törlés</button></div>)}
      <div className="row"><input type="date" value={cd.day} onChange={e => setCd({ ...cd, day: e.target.value })} />
        <input placeholder="Megnevezés" value={cd.reason} onChange={e => setCd({ ...cd, reason: e.target.value })} />
        <button disabled={!cd.day || !cd.reason} onClick={async () => { await run(supabase.from('closed_days').insert({ school_id: d.id, ...cd })); setCd({ day: '', reason: '' }) }}>Hozzáadás</button></div>
    </section>

    <section><h2>Visszaszámlálók (szünetek, ünnepek)</h2>
      {[...(d.countdowns ?? [])].sort((a, b) => (a.target_date + a.target_time).localeCompare(b.target_date + b.target_time)).map(c =>
        <div className="row" key={c.id}>{KIND[c.kind]?.icon} {c.title} – {c.target_date} {c.target_time.slice(0, 5)}
          <button onClick={() => run(supabase.from('countdowns').delete().eq('id', c.id))}>Törlés</button></div>)}
      <div className="row"><input placeholder="Megnevezés (pl. Nyári szünet)" value={ev.title} onChange={e => setEv({ ...ev, title: e.target.value })} />
        <select value={ev.kind} onChange={e => setEv({ ...ev, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}</select>
        <input type="date" value={ev.date} onChange={e => setEv({ ...ev, date: e.target.value })} />
        <input type="time" value={ev.time} onChange={e => setEv({ ...ev, time: e.target.value })} />
        <button disabled={!ev.title || !ev.date} onClick={async () => { await run(supabase.from('countdowns').insert({ school_id: d.id, title: ev.title, kind: ev.kind, target_date: ev.date, target_time: ev.time })); setEv({ title: '', kind: 'other', date: '', time: '00:00' }) }}>Hozzáadás</button></div>
    </section>

    <section><h2>Közlemények (főoldal és TV)</h2>
      {(d.announcements ?? []).map(n => <div className="row" key={n.id}>{n.text}{n.active_until ? ` (eddig: ${n.active_until})` : ''}
        <button onClick={() => run(supabase.from('announcements').delete().eq('id', n.id))}>Törlés</button></div>)}
      <div className="row"><input style={{ minWidth: '18rem' }} placeholder="Közlemény szövege" value={an.text} onChange={e => setAn({ ...an, text: e.target.value })} />
        <input type="date" title="Meddig látszódjon (üres = amíg törlöd)" value={an.until} onChange={e => setAn({ ...an, until: e.target.value })} />
        <button disabled={!an.text} onClick={async () => { await run(supabase.from('announcements').insert({ school_id: d.id, text: an.text, active_until: an.until || null })); setAn({ text: '', until: '' }) }}>Hozzáadás</button></div>
    </section>

    <section><h2>Különleges napok (adott napra más csengetési rend)</h2>
      {[...(d.schedule_dates ?? [])].sort((a, b) => a.day.localeCompare(b.day)).map(x => <div className="row" key={x.id}>{x.day}: {d.schedules.find(s => s.id === x.schedule_id)?.name ?? '?'}
        <button onClick={() => run(supabase.from('schedule_dates').delete().eq('id', x.id))}>Törlés</button></div>)}
      <div className="row"><input type="date" value={sd.day} onChange={e => setSd({ ...sd, day: e.target.value })} />
        <select value={sd.schedule_id} onChange={e => setSd({ ...sd, schedule_id: e.target.value })}><option value="">Válassz rendet…</option>{d.schedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <button disabled={!sd.day || !sd.schedule_id} onClick={async () => { await run(supabase.from('schedule_dates').insert({ school_id: d.id, ...sd })); setSd({ day: '', schedule_id: '' }) }}>Hozzáadás</button></div>
    </section>

    <section><h2>Mai változások (elmaradó órák, helyettesítés, teremváltás)</h2>
      {[...(d.changes ?? [])].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 20).map(c => <div className="row" key={c.id}>{c.day}: {c.lesson_label} – {CHG[c.kind]} {c.text}
        <button onClick={() => run(supabase.from('changes').delete().eq('id', c.id))}>Törlés</button></div>)}
      <div className="row"><input type="date" value={chg.day} onChange={e => setChg({ ...chg, day: e.target.value })} />
        <select value={chg.kind} onChange={e => setChg({ ...chg, kind: e.target.value })}>{Object.entries(CHG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input size={8} placeholder="pl. 7. óra" value={chg.lesson_label} onChange={e => setChg({ ...chg, lesson_label: e.target.value })} />
        <input style={{ minWidth: '14rem' }} placeholder="pl. terem 12 → 15" value={chg.text} onChange={e => setChg({ ...chg, text: e.target.value })} />
        <label title="Csak a mai napra szóló változásnál megy ki"><input type="checkbox" checked={chgNotify} onChange={e => setChgNotify(e.target.checked)} /> Értesítés is</label>
        <button disabled={!chg.day || !(chg.lesson_label || chg.text)} onClick={async () => {
          await run(supabase.from('changes').insert({ school_id: d.id, ...chg }))
          if (chgNotify && chg.day === todayStr) await sendPush(`${CHG[chg.kind]}: ${chg.lesson_label}`.replace(/: $/, ''), chg.text || chg.lesson_label)
          setChg({ ...chg, lesson_label: '', text: '' })
        }}>Hozzáadás</button></div>
    </section>

    <section><h2>Étlap (a kijelzőn az adott napon látszik)</h2>
      {[...(d.menus ?? [])].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14).map(m => <div className="row" key={m.id}>{m.day}: {m.text}
        <button onClick={() => run(supabase.from('menus').delete().eq('id', m.id))}>Törlés</button></div>)}
      <div className="row"><input type="date" value={mn.day} onChange={e => setMn({ ...mn, day: e.target.value })} />
        <input style={{ minWidth: '18rem' }} placeholder="pl. Húsleves, rántott csirke, rizs" value={mn.text} onChange={e => setMn({ ...mn, text: e.target.value })} />
        <button disabled={!mn.day || !mn.text} onClick={async () => { await run(supabase.from('menus').upsert({ school_id: d.id, ...mn }, { onConflict: 'school_id,day' })); setMn({ ...mn, text: '' }) }}>Mentés</button></div>
      <div className="row">Ebédszünet: a(z) <input type="number" min={1} max={12} style={{ width: '4rem' }} defaultValue={d.settings.lunch_after ?? ''} key={'l' + d.settings.lunch_after}
        onBlur={e => setS({ lunch_after: e.target.value ? Number(e.target.value) : null })} />. óra után</div>
    </section>

    <section><h2>Kiemelt közlemény (teljes képernyős) és tanév</h2>
      <div className="row"><input style={{ minWidth: '22rem' }} placeholder="pl. Tűzriadó-gyakorlat 10:00-kor" defaultValue={d.settings.alert_text} key={'a' + d.settings.alert_text} onBlur={e => e.target.value !== d.settings.alert_text && setS({ alert_text: e.target.value })} />
        <label><input type="checkbox" checked={d.settings.alert_active} onChange={e => setS({ alert_active: e.target.checked })} /> Megjelenítés az egész képernyőn</label>
        <button disabled={!d.settings.alert_text} onClick={() => sendPush('Fontos közlemény', d.settings.alert_text)}>Értesítés küldése</button></div>
      <div className="row">Tanév kezdete <input type="date" value={d.settings.year_start ?? ''} onChange={e => setS({ year_start: e.target.value || null })} />
        vége <input type="date" value={d.settings.year_end ?? ''} onChange={e => setS({ year_end: e.target.value || null })} /></div>
    </section>

    <section><h2>Időjárás a kijelzőn</h2>
      <div className="row"><label><input type="checkbox" checked={d.settings.weather_enabled} onChange={e => setS({ weather_enabled: e.target.checked })} /> Megjelenítés</label> Jelenlegi hely: <b>{d.settings.weather_city}</b></div>
      <div className="row"><input placeholder="Város keresése (pl. Szekszárd)" value={wq} onChange={e => setWq(e.target.value)} />
        <button disabled={!wq.trim()} onClick={searchCity}>Keresés</button></div>
      <div className="row">{wres.map((r, i) => <button key={i} onClick={() => { setS({ weather_city: r.name, weather_lat: r.latitude, weather_lon: r.longitude }); setWres([]); setWq('') }}>{r.name}{r.admin1 ? `, ${r.admin1}` : ''} ({r.country})</button>)}</div>
    </section>

    <section><h2>Szünet-videók (szünetben ezek játszódnak, hang nélkül)</h2>
      {vids === null && <p>A videók még nincsenek bekapcsolva: futtasd le a <code>supabase/update12.sql</code> fájlt.</p>}
      {vids !== null && <>
        <div className="row"><label><input type="checkbox" checked={d.settings.break_videos !== false} onChange={e => setS({ break_videos: e.target.checked })} /> Videó mutatása szünetben</label></div>
        <p>YouTube-link (watch, youtu.be, shorts) vagy közvetlen .mp4 / .webm link. Több videó esetén szünetenként váltakoznak.</p>
        {vids.map(v => <div className="row" key={v.id}>{v.title || v.url}{v.title ? ` (${v.url})` : ''}
          <button onClick={() => run(supabase.from('break_videos').delete().eq('id', v.id))}>Törlés</button></div>)}
        <div className="row"><input style={{ minWidth: '20rem' }} placeholder="Videó linkje (https://…)" value={vf.url} onChange={e => setVf({ ...vf, url: e.target.value })} />
          <input placeholder="Név (nem kötelező)" value={vf.title} onChange={e => setVf({ ...vf, title: e.target.value })} />
          <button disabled={!vf.url.trim()} onClick={async () => {
            if (!parseVideo(vf.url)) return setMsg('Hiba: csak YouTube-link vagy .mp4 / .webm fájl adható meg (https-sel).')
            await run(supabase.from('break_videos').insert({ school_id: d.id, url: vf.url.trim(), title: vf.title.trim() })); setVf({ url: '', title: '' })
          }}>Hozzáadás</button></div></>}
    </section>

    <section><h2>Szavazás (a TV-n eredmény és QR-kód, telefonról szavaznak)</h2>
      {polls === null && <p>A szavazás még nincs bekapcsolva: futtasd le a <code>supabase/update11.sql</code> fájlt.</p>}
      {(polls ?? []).map(p => <div className="polladm" key={p.id}>
        <b>{p.question}</b> {p.active ? '(aktív)' : '(lezárt)'}
        <ul>{p.options.map((o: string, i: number) => <li key={i}>{o}: {pcounts[p.id]?.[i] ?? 0} szavazat</li>)}</ul>
        <div className="row">{p.active && <button onClick={() => run(supabase.from('polls').update({ active: false }).eq('id', p.id))}>Lezárás</button>}
          <button onClick={() => run(supabase.from('polls').delete().eq('id', p.id))}>Törlés</button></div></div>)}
      {polls !== null && <div className="row"><input style={{ minWidth: '18rem' }} placeholder="Kérdés (pl. Mi legyen a pénteki szünetben?)" value={pl.q} onChange={e => setPl({ ...pl, q: e.target.value })} />
        {pl.opts.map((o, i) => <input key={i} placeholder={`${i + 1}. válasz${i < 2 ? '' : ' (nem kötelező)'}`} value={o} onChange={e => setPl({ ...pl, opts: pl.opts.map((x, j) => j === i ? e.target.value : x) })} />)}
        <button disabled={!pl.q.trim() || pl.opts.filter(o => o.trim()).length < 2} onClick={async () => {
          await supabase.from('polls').update({ active: false }).eq('school_id', d.id).eq('active', true)   // egyszerre egy szavazás él
          await run(supabase.from('polls').insert({ school_id: d.id, question: pl.q.trim(), options: pl.opts.map(o => o.trim()).filter(Boolean) }))
          setPl({ q: '', opts: ['', '', '', ''] })
        }}>Új szavazás indítása</button></div>}
    </section>

    <section><h2>Értesítések (telepített alkalmazás)</h2>
      <p>Feliratkozott eszközök: <b>{subs ?? '–'}</b>{subs === null && ' (futtasd le a supabase/update10.sql fájlt)'}</p>
      <div className="row"><input placeholder="Cím (pl. Fontos)" value={pm.title} onChange={e => setPm({ ...pm, title: e.target.value })} />
        <input style={{ minWidth: '18rem' }} placeholder="Szöveg" value={pm.body} onChange={e => setPm({ ...pm, body: e.target.value })} />
        <button disabled={!pm.title} onClick={async () => { await sendPush(pm.title, pm.body); setPm({ title: '', body: '' }) }}>Küldés mindenkinek</button></div>
    </section>

    <section><h2>Biztonsági mentés</h2>
      <p>Az iskola összes adata (rendek, órák, ünnepnapok, visszaszámlálók, közlemények, étlap, beállítások) egy fájlban. Az adminok fiókjai és a feltöltött logó/hang nem kerülnek bele.</p>
      <div className="row"><button onClick={downloadBackup}>Mentés letöltése</button>
        <label className="btn">Visszaállítás fájlból<input type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) restoreBackup(f) }} /></label></div>
    </section>

    <section><h2>Módosítási napló (utolsó 100)</h2>
      {log === null && <p>A napló még nincs bekapcsolva: futtasd le a <code>supabase/update5.sql</code> fájlt.</p>}
      {log && log.length === 0 && <p>Még nincs bejegyzés.</p>}
      <ul className="audit">{(log ?? []).map(r => <li key={r.id}>
        <time>{new Date(r.created_at).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', dateStyle: 'short', timeStyle: 'medium' })}</time>
        <b>{r.user_email ?? 'SQL / rendszer'}</b><span>{ACT[r.action]} ({TABLE[r.table_name] ?? r.table_name})</span><em>{describe(r)}</em></li>)}</ul>
    </section>
  </main>
}
