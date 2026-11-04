import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { audioReady, enableAudio, preload, ring } from './lib/sound'
import QRCode from 'qrcode'
import NotifyButton from './Notify'
import Fx, { BellFlash, Celebrate, FinalCount } from './Fx'
import { PollCard, usePoll } from './Poll'
import BreakVideo, { useVideos } from './BreakVideo'
import RestMode from './Rest'
import Ask from './Ask'
import { MyScheduleModal, formatMyLesson, useMySchedule, type MyLessonEntry } from './MySchedule'
import { VibeOverlay, VibePanel, useVibe } from './Vibe'
import Arena from './Arena'
import { useSchool } from './lib/useSchool'
import { KIND } from './lib/kinds'
import { APP_NAME } from './lib/brand'
import { computeState, fmtCount, fmtHM, addDays, instantOf, nextSchoolDay, scheduleFor, schoolDaysBetween, toSec, zoned, type BellState } from './lib/engine'

const pad = (n: number) => String(n).padStart(2, '0')
const hms = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
const fmtRoom = (r: string) => (/^\d+$/.test(r.trim()) ? `${r.trim()}. terem` : r.trim())
const TITLE: Record<BellState['phase'], string> = { closed: '', before: 'Tanítás előtt', lesson: '', break: 'Szünet', after: 'Vége a tanításnak' }
const CHIP: Record<string, string> = { past: 'vége', now: 'most', upnext: 'következő' }

/** Számjegyek "menetrend-tábla" csempékben (ez az oldal vizuális aláírása). */
function Digits({ text }: { text: string }) {
  return <span className="digits" role="img" aria-label={text}>
    {text.split('').map((c, i) => c === ':' ? <i key={i}>:</i> : <span key={`${i}${c}`} className="tile">{c}</span>)}</span>
}

/** 4×/mp-es ellenőrzéssel újraszámolja az állapotot a beállított időzóna (Europe/Budapest) szerint. */
function useBell() {
  const { data, offline } = useSchool()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 250); return () => clearInterval(t) }, [])
  return useMemo(() => {
    if (!data) return { data, offline }
    const z = zoned(now, data.settings.timezone)
    const ov = Object.fromEntries((data.schedule_dates ?? []).map(x => [x.day, x.schedule_id]))
    const schedule = scheduleFor(z.date, data.schedules, ov)
    const closed = data.closed.find(c => c.day === z.date)?.reason
    const state = computeState(z.secs, schedule?.lessons ?? [], closed, !schedule)
    return { data, offline, z, schedule, state, now }
  }, [now, data, offline])
}

/** Számlap: 60 osztás, az ív az aktuális óra/szünet előrehaladása, közepén a visszaszámláló. */
function Ring({ s, my }: { s: BellState; my?: MyLessonEntry }) {
  const R = 86, C = 2 * Math.PI * R
  const live = s.phase === 'lesson' || s.phase === 'break' || s.phase === 'before'
  const custom = s.phase === 'lesson' ? formatMyLesson(s.current, my) : null
  const title = s.phase === 'lesson' ? (custom?.title || s.current!.label) : s.phase === 'closed' ? s.reason : TITLE[s.phase]
  return <div className={`ring ${s.phase}`}>
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <linearGradient id="ledg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff3fb8" /><stop offset="28%" stopColor="#ffb02e" />
          <stop offset="55%" stopColor="#39ff7a" /><stop offset="80%" stopColor="#2de2ff" />
          <stop offset="100%" stopColor="#8a5cff" />
        </linearGradient>
      </defs>
      <circle className="ticks" cx="100" cy="100" r="96" stroke="url(#ledg)" />
      <circle className="track" cx="100" cy="100" r={R} />
      {live && <circle className="arc" cx="100" cy="100" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - s.progress)} />}
    </svg>
    <span key={`${s.phase}-${s.current?.id ?? s.next?.id}`} className="bell-fx" aria-hidden="true" />
    <div className="inner">
      <div className="title">{title}</div>
      {custom && (custom.sub || custom.room) && (
        <div className="ring-my">
          {custom.sub && <span>{custom.sub}</span>}
          {custom.room && <b>📍 {fmtRoom(custom.room)}</b>}
        </div>
      )}
      {live && <>
        <div key={`${s.phase}-${s.current?.id ?? s.next?.id}`} className={`count flash ${s.soon ? 'soon' : ''} ${s.remaining >= 3600 ? 'long' : ''}`}><Digits text={fmtCount(s.remaining)} /></div>
        <div className="sub">{s.soon ? 'Hamarosan csengetés' : s.phase === 'before' ? 'az első csengetésig' : 'a csengetésig'}</div>
        {s.phase !== 'before' && <div className="pct">{Math.round(s.progress * 100)}%</div>}
      </>}
    </div>
  </div>
}

function Next({ s, secs, my }: { s: BellState; secs: number; my?: MyLessonEntry }) {
  if (!s.next) return null
  const m = Math.ceil((toSec(s.next.start_time) - secs) / 60)
  const custom = formatMyLesson(s.next, my)
  return <div className="next"><span>Következő</span><b>{custom.title}</b>
    {custom.sub && <span className="my-sub">({custom.sub})</span>}
    {custom.room && <span className="room-pill">📍 {fmtRoom(custom.room)}</span>}
    <span>{fmtHM(s.next.start_time)}{m > 0 && m < 120 ? `, ${m} perc múlva` : ''}</span></div>
}

/** Zárva (hétvége, ünnep) vagy tanítás után: mikor kezdődik legközelebb a tanítás. */
function NextDay({ label, time, until }: { label: string; time: string; until: number }) {
  const d = Math.floor(until / 86400), h = Math.floor((until % 86400) / 3600), m = Math.floor((until % 3600) / 60)
  const left = [d ? `${d} nap` : '', h ? `${h} óra` : '', `${m} perc`].filter(Boolean).join(' ')
  return <div className="next nextday"><span>Legközelebb</span><b>{label}, {time}</b><span>még {left}</span></div>
}

/** QR-kód az oldal címéről (a TV-n a telefonos megnyitáshoz); fehér alapon, hogy bármilyen témában olvasható maradjon. */
function useQr(text: string, on: boolean) {
  const [src, setSrc] = useState('')
  useEffect(() => { if (on) QRCode.toDataURL(text, { margin: 1, width: 360 }).then(setSrc).catch(() => setSrc('')) }, [text, on])
  return on ? src : ''
}

/** WMO időjárási kód → ikon és magyar leírás */
const WX = (c: number): [string, string] => c === 0 ? ['☀️', 'Derült'] : c <= 2 ? ['🌤️', 'Részben felhős'] : c === 3 ? ['☁️', 'Borult'] : c <= 48 ? ['🌫️', 'Ködös']
  : c <= 57 ? ['🌦️', 'Szitálás'] : c <= 67 ? ['🌧️', 'Eső'] : c <= 77 ? ['❄️', 'Havazás'] : c <= 82 ? ['🌦️', 'Zápor'] : c <= 86 ? ['🌨️', 'Hózápor'] : ['⛈️', 'Zivatar']

/** Aktuális időjárás az Open-Meteo-ból (30 percenként frissül; offline esetén az utolsó adat marad). */
function useWeather(lat: number | null, lon: number | null, tz: string | undefined, on: boolean) {
  const [w, setW] = useState<any>(() => { try { return JSON.parse(localStorage.getItem('csengeto-weather') ?? 'null') } catch { return null } })
  useEffect(() => {
    if (!on || lat == null || lon == null || !tz) return
    let alive = true
    const load = async () => {
      try {
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=${encodeURIComponent(tz)}&forecast_days=1`)
        if (!r.ok || !alive) return
        const j = await r.json()
        const v = { t: Math.round(j.current.temperature_2m), c: j.current.weather_code, min: Math.round(j.daily.temperature_2m_min[0]), max: Math.round(j.daily.temperature_2m_max[0]), p: j.daily.precipitation_probability_max[0] ?? 0, lat, lon }
        localStorage.setItem('csengeto-weather', JSON.stringify(v)); if (alive) setW(v)
      } catch { /* nincs net: marad a legutóbbi adat */ }
    }
    load(); const t = setInterval(load, 30 * 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [lat, lon, tz, on])
  return on && w && w.lat === lat && w.lon === lon ? w : null
}

/** A tanítási nap sávja: az órák és szünetek arányosan, a pillanatnyi időt jelző vonallal. */
function DayStrip({ L, secs, phase }: { L: any[]; secs: number; phase: BellState['phase'] }) {
  const a = toSec(L[0].start_time), b = toSec(L[L.length - 1].end_time), span = b - a
  const live = phase === 'lesson' || phase === 'break'
  return <div className="strip">
    <div className="bar">
      {L.map((l, i) => {
        const s0 = toSec(l.start_time), e0 = toSec(l.end_time)
        return <i key={l.id} className={`seg ${secs >= e0 ? 'past' : secs >= s0 ? 'on' : ''}`}
          style={{ left: `${((s0 - a) / span) * 100}%`, width: `${((e0 - s0) / span) * 100}%` }}>{i + 1}</i>
      })}
      {live && <span className="mark" style={{ left: `${Math.min(1, Math.max(0, (secs - a) / span)) * 100}%` }} />}
    </div>
    <div className="ends"><span>{fmtHM(L[0].start_time)}</span><span>{fmtHM(L[L.length - 1].end_time)}</span></div>
  </div>
}

export default function App() {
  const { data, offline, z, schedule, state, now } = useBell() as any
  const tv = location.pathname.startsWith('/display')
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') ?? '')
  const style = 'neon'
  useEffect(() => { document.documentElement.dataset.style = 'neon'; try { localStorage.setItem('style', 'neon') } catch { /* nem baj */ } }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme || data?.settings.theme || 'dark' }, [theme, data])
  useEffect(() => { document.documentElement.dataset.phase = state?.phase ?? '' }, [state?.phase])
  useEffect(() => { document.title = APP_NAME }, [])
  useEffect(() => {
    document.documentElement.classList.toggle('tv-lock', tv)
    return () => document.documentElement.classList.remove('tv-lock')
  }, [tv])
  const [fxOn, setFxOn] = useState(() => localStorage.getItem('fx') !== '0')
  const fx = fxOn && data?.settings.particles !== false && style === 'neon'
  const { poll, counts } = usePoll(data?.id)
  const videos = useVideos(data?.id)
  const pollQr = useQr(location.origin + '/szavazas', tv && !!poll)
  const { map: myMap, update: updateMyMap, getEntry, hasAny: hasMySchedule } = useMySchedule()
  const [myModalOpen, setMyModalOpen] = useState(false)

  // Csengetési hang: állapotváltáskor szól, ha az admin bekapcsolta és a hang engedélyezve van.
  const [audioOn, setAudioOn] = useState(audioReady())
  const { counts: vibeCounts, floats: vibeFloats, sendVibe, cooldown: vibeCooldown } = useVibe(
    data?.id,
    z?.date ?? '',
    !!data?.settings.sound_enabled && audioOn
  )
  const [dismissed, setDismissed] = useState('')   // a kiemelt közleményt a látogató bezárhatja (a TV-n nem)
  useEffect(() => { if (audioOn) preload(data?.settings.bell_sound_url) }, [audioOn, data?.settings.bell_sound_url])   // saját csengőhang előtöltése
  // Telepítés gomb (Chrome, Edge, Android): a böngésző jelzi, ha az oldal telepíthető
  const [installEv, setInstallEv] = useState<any>(null)
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setInstallEv(e) }, done = () => setInstallEv(null)
    window.addEventListener('beforeinstallprompt', on); window.addEventListener('appinstalled', done)
    return () => { window.removeEventListener('beforeinstallprompt', on); window.removeEventListener('appinstalled', done) }
  }, [])
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
  const qr = useQr(location.origin + '/telepites', tv && data?.settings.tv_show_qr !== false)
  const wx = useWeather(data?.settings.weather_lat ?? null, data?.settings.weather_lon ?? null, data?.settings.timezone, !!data?.settings.weather_enabled)
  const key = state ? `${state.phase}-${state.current?.id ?? state.next?.id}` : ''
  const prev = useRef('')
  useEffect(() => {
    if (prev.current && key !== prev.current && state?.phase !== 'closed' && data?.settings.sound_enabled) ring(data.settings.bell_sound_url)
    prev.current = key
  }, [key])
  // TV-mód méretezése az admin beállítása szerint.
  useEffect(() => { if (tv) document.documentElement.style.fontSize = `${data?.settings.tv_scale ?? 100}%` }, [tv, data])

  if (!data) return <main><div className="panel"><div className="title">{offline ? 'Nincs kapcsolat és nincs mentett adat.' : 'Betöltés…'}</div></div></main>
  const s: BellState = state
  const byPos = (x: any[]) => [...x].sort((p: any, q: any) => p.position - q.position)
  const ovMap = Object.fromEntries(((data.schedule_dates ?? []) as any[]).map(x => [x.day, x.schedule_id])) as Record<string, string>
  const pv = s.phase === 'closed' || s.phase === 'after' ? nextSchoolDay(z.date, data.schedules, data.closed, ovMap) : undefined
  const tl = s.phase === 'closed' ? pv?.schedule : schedule            // zárva: a következő tanítási nap rendje látszik
  const L = tl ? byPos(tl.lessons) : []
  const boardWeekday = s.phase === 'closed' && pv ? (new Date(pv.date + 'T12:00:00Z').getUTCDay() || 7) : z.weekday
  const myCur = !tv ? getEntry(z.weekday, s.current?.position) : undefined
  const myNext = !tv ? getEntry(z.weekday, s.next?.position) : undefined
  const first = pv && byPos(pv.schedule.lessons)[0]
  const until = pv && first ? Math.round((instantOf(pv.date, toSec(first.start_time), data.settings.timezone) - now.getTime()) / 1000) : 0
  const dayName = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('hu-HU', { timeZone: 'UTC', ...o }).format(new Date(d + 'T12:00:00Z'))
  const dateText = dayName(z.date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  // Visszaszámlálók: a legközelebbi 4 még le nem járt esemény, másodperc pontosan (óraátállással is helyesen).
  const events = ((data.countdowns ?? []) as any[])
    .map(c => ({ ...c, left: Math.round((instantOf(c.target_date, toSec(c.target_time), data.settings.timezone) - now.getTime()) / 1000) }))
    .filter(c => c.left > 0).sort((x, y) => x.left - y.left).slice(0, 4)
  const upcoming = (data.closed as { day: string; reason: string }[]).filter(c => c.day > z.date).sort((x, y) => x.day.localeCompare(y.day)).slice(0, 4)
  const p = (on: boolean) => (on ? ({ '--p': `${s.progress * 100}%` } as CSSProperties) : undefined)

  // ---- A mai nap adatai (csak tanítási napon) ----
  const T = schedule && s.phase !== 'closed' ? byPos(schedule.lessons) : []
  const hm = (t: number) => `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}`
  const away = (t: number) => { const m = Math.ceil((t - z.secs) / 60); return m < 120 ? `${m} perc múlva` : `${Math.floor(m / 60)} óra ${m % 60} perc múlva` }
  const bellList = T.flatMap((l: any) => {
    const custom = formatMyLesson(l, !tv ? getEntry(z.weekday, l.position) : undefined)
    const lbl = custom.sub ? `${custom.title} (${custom.sub})` : custom.title
    return [{ t: toSec(l.start_time), txt: `${lbl} kezdete` }, { t: toSec(l.end_time), txt: `${lbl} vége` }]
  })
    .filter((b: any) => b.t > z.secs).sort((x: any, y: any) => x.t - y.t).slice(0, tv ? 3 : 4)
  const leftSecs = T.reduce((n: number, l: any) => n + Math.max(0, toSec(l.end_time) - Math.max(toSec(l.start_time), z.secs)), 0)
  const dayPct = T.length ? Math.round(Math.min(1, Math.max(0, (z.secs - toSec(T[0].start_time)) / (toSec(T[T.length - 1].end_time) - toSec(T[0].start_time)))) * 100) : 0
  const nb = T.findIndex((l: any, i: number) => toSec(l.end_time) > z.secs && T[i + 1])
  const stats = T.length > 0 && <div className="stats">
    <div className="stat"><b>{T.filter((l: any) => toSec(l.end_time) <= z.secs).length}/{T.length}</b><span>óra kész</span></div>
    <div className="stat"><b>{Math.floor(leftSecs / 3600) ? `${Math.floor(leftSecs / 3600)} ó ` : ''}{Math.floor(leftSecs / 60) % 60} p</b><span>tanítás van hátra</span></div>
    <div className="stat"><b>{dayPct}%</b><span>a napból</span></div>
    {nb >= 0 && <div className="stat"><b>{Math.round((toSec(T[nb + 1].start_time) - toSec(T[nb].end_time)) / 60)} perc</b><span>köv. szünet ({fmtHM(T[nb].end_time)})</span></div>}
  </div>
  const strip = T.length > 0 && <DayStrip L={T} secs={z.secs} phase={s.phase} />
  const bells = bellList.length > 0 && <div className="bells"><div className="tag">Következő csengetések</div>
    <ul>{bellList.map((b: any) => <li key={b.t + b.txt}><b>{hm(b.t)}</b><span>{b.txt}</span><span>{away(b.t)}</span></li>)}</ul></div>

  // ---- E heti rend (hétfő–péntek, plusz a hétvége, ha van rendje) ----
  const monday = addDays(z.date, 1 - z.weekday)
  const week = [0, 1, 2, 3, 4, 5, 6].map(i => {
    const date = addDays(monday, i), sch = scheduleFor(date, data.schedules, ovMap), ls = sch ? byPos(sch.lessons) : []
    const off = (data.closed as { day: string; reason: string }[]).find(c => c.day === date)?.reason
    return { date, i, dim: !!off || !ls.length, info: off ?? (ls.length ? `${ls.length} óra, ${fmtHM(ls[0].start_time)}–${fmtHM(ls[ls.length - 1].end_time)}` : 'Nincs tanítás') }
  }).filter(w => w.i < 5 || !w.dim)

  // ---- Közlemények (a TV-n 10 mp-enként váltakoznak) ----
  const notes = ((data.announcements ?? []) as { id: string; text: string; active_until: string | null }[]).filter(n => !n.active_until || n.active_until >= z.date)
  const note = notes.length ? notes[Math.floor(now.getTime() / 10000) % notes.length] : null

  // ---- Visszaszámláló kártyák ----
  const startDay = s.phase === 'after' || s.phase === 'closed' ? addDays(z.date, 1) : z.date
  const evCard = (e: any, i: number) => {
    const k = KIND[e.kind] ?? KIND.other
    const d = Math.floor(e.left / 86400), h = Math.floor((e.left % 86400) / 3600), m = Math.floor((e.left % 3600) / 60), sec = e.left % 60
    const nd = schoolDaysBetween(startDay, e.target_date, data.schedules, data.closed, ovMap)
    return <article key={e.id} className={`ev ${i === 0 ? 'big' : ''}`} style={{ '--k': k.color } as CSSProperties}>
      <div className="ev-top"><span className="ico" aria-hidden="true">{k.icon}</span><h3>{e.title}</h3></div>
      {i === 0
        ? <div className="units">{([[d, 'nap'], [h, 'óra'], [m, 'perc'], [sec, 'mp']] as [number, string][]).map(([v, l]) => <div key={l}><Digits text={pad(v)} /><span>{l}</span></div>)}</div>
        : <div className="days"><b>{d}</b><span>nap{h > 0 || d === 0 ? `, ${h} óra` : ''}</span></div>}
      <div className="ev-date">{dayName(e.target_date, { weekday: 'long', month: 'long', day: 'numeric' })}{nd > 0 ? `, még ${nd} tanítási nap` : ''}</div>
    </article>
  }
  const offCard = upcoming.length > 0 && <article key="off" className="ev" style={{ '--k': 'var(--mut)' } as CSSProperties}>
    <div className="ev-top"><span className="ico" aria-hidden="true">📅</span><h3>Tanítás nélküli napok</h3></div>
    <ul className="offl">{upcoming.map(c => <li key={c.day}><b>{dayName(c.day, { month: 'long', day: 'numeric' })}</b>
      <span>{dayName(c.day, { weekday: 'long' })}, {c.reason}</span></li>)}</ul>
  </article>

  // ---- Mai változások, ebéd, tanév haladása, kiemelt közlemény ----
  const sett = data.settings
  const KCH: Record<string, string> = { cancel: 'Elmarad', substitute: 'Helyettesítés', room: 'Teremváltás', info: 'Info' }
  const chgs = ((data.changes ?? []) as any[]).filter(c => c.day === z.date)
  const changesBox = chgs.length > 0 && <section className="panel chg"><div className="tag">Mai változások</div>
    <ul>{chgs.map(c => <li key={c.id}><b>{c.lesson_label}</b><span className={`chip k-${c.kind}`}>{KCH[c.kind]}</span><em>{c.text}</em></li>)}</ul></section>
  const menu = ((data.menus ?? []) as any[]).find(m => m.day === z.date)
  const SL = schedule ? byPos(schedule.lessons) : []
  const li = sett.lunch_after ? SL.findIndex((l: any) => l.position === sett.lunch_after) : -1
  const lunchTime = li >= 0 && SL[li + 1] ? `${fmtHM(SL[li].end_time)} – ${fmtHM(SL[li + 1].start_time)}` : ''
  const lunchBox = menu && s.phase !== 'closed' && <section className="panel lunch"><div className="tag">Mai ebéd{lunchTime ? ` (${lunchTime})` : ''}</div><p>{menu.text}</p></section>
  const tms = (d: string) => Date.parse(d + 'T00:00:00Z')
  const yp = sett.year_start && sett.year_end ? Math.round(Math.min(1, Math.max(0, (tms(z.date) - tms(sett.year_start)) / (tms(sett.year_end) - tms(sett.year_start)) || 0)) * 100) : 0
  const yearBox = sett.year_start && sett.year_end && <div className="year-inline"><div className="tag">Tanév haladása</div>
    <div className="yearbar"><i style={{ width: `${yp}%` }} /></div>
    <p className="meta" style={{ marginBottom: 0 }}>{yp}%, még {schoolDaysBetween(startDay, sett.year_end, data.schedules, data.closed, ovMap)} tanítási nap a tanév végéig</p></div>
  const overlay = sett.alert_active && sett.alert_text && dismissed !== sett.alert_text && <div className="alertfs" role="alertdialog" aria-live="assertive">
    <div className="alertbox"><div className="tag">Fontos közlemény</div><p>{sett.alert_text}</p>{!tv && <button onClick={() => setDismissed(sett.alert_text)}>Értettem</button>}</div></div>

  const vid = s.phase === 'break' && data.settings.break_videos !== false && videos.length > 0 && <BreakVideo list={videos} breakKey={s.next?.id ?? key} />
  const e0 = events[0]
  const restBox = s.phase === 'closed' && data.settings.rest_mode !== false && <RestMode tv={tv} reason={s.reason} day={z.date}
    ev={pv && first && until > 0
      ? { icon: /ősz/i.test(s.reason ?? '') ? '🍂' : /tél/i.test(s.reason ?? '') ? '❄️' : /nyár/i.test(s.reason ?? '') ? '☀️' : /tavasz/i.test(s.reason ?? '') ? '🌷' : '😴',
          days: Math.floor(until / 86400), hours: Math.floor((until % 86400) / 3600), mins: Math.floor((until % 3600) / 60),
          note: `Ennyi van még hátra a pihenésből! Tanítás újra: ${dayName(pv.date, { weekday: 'long' })}, ${fmtHM(first.start_time)}` }
      : e0 ? { icon: (KIND[e0.kind] ?? KIND.other).icon, days: Math.floor(e0.left / 86400), hours: Math.floor((e0.left % 86400) / 3600), mins: Math.floor((e0.left % 3600) / 60), note: e0.title } : undefined} />
  const pollCard = poll && <PollCard poll={poll} counts={counts} tv={tv} qr={tv ? pollQr : undefined} />

  // ==================== TV / DISPLAY NÉZET (FIX 100SVH, GÖRGETÉS NÉLKÜL) ====================
  if (tv) {
    return (
      <>
        <main className="tv">
          <header className="tv-hdr">
            <div className="tv-hdr-left">
              <span className="brand">
                <img className="logo" src={data.settings.logo_url || '/logo.png'} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />
                {APP_NAME}
              </span>
              <div className="date">{dateText}</div>
              {wx && (
                <div className="wx">
                  <span>{WX(wx.c)[0]}</span>
                  <b>{wx.t}°C, {WX(wx.c)[1]}</b>
                  <small>{data.settings.weather_city} ({wx.min}–{wx.max}°C, 💧{wx.p}%)</small>
                </div>
              )}
            </div>

            <div className="timebox">
              <Digits text={!data.settings.tv_show_seconds ? hms(z.secs).slice(0, 5) : hms(z.secs)} />
            </div>

            <div className="tv-hdr-right">
              <div className="tools">
                {offline && <span className="pill">Offline mód</span>}
                {data.settings.sound_enabled && !audioOn && (
                  <button className="cta" onClick={async () => setAudioOn(await enableAudio())}>Hang engedélyezése</button>
                )}
              </div>
              {qr && (
                <div className="qrbox">
                  <img src={qr} alt="QR-kód az oldal megnyitásához" />
                  <span>Telepítsd<br />telefonra</span>
                </div>
              )}
            </div>
          </header>

          <div className="tv-main">
            <section className={`panel now ${s.phase}`}>
              <Ring s={s} />
              {data.settings.tv_show_next && (
                pv && first
                  ? <NextDay label={dayName(pv.date, { weekday: 'long' })} time={fmtHM(first.start_time)} until={until} />
                  : <Next s={s} secs={z.secs} />
              )}
            </section>

            <section className="tvside">
              {changesBox}
              {T.length > 0 ? (
                <>
                  {vid ? (
                    <div className="tv-vid-row">
                      {vid}
                      {pollCard || bells}
                    </div>
                  ) : (
                    <>
                      {bells}
                      {pollCard || stats}
                    </>
                  )}
                  <div className="tv-subgrid">
                    {!vid && lunchBox}
                    <VibePanel counts={vibeCounts} onSend={sendVibe} cooldown={vibeCooldown} tv />
                    <Arena schoolId={data.id} day={z.date} phase={s.phase} tv />
                  </div>
                </>
              ) : (
                <>
                  {pollCard}
                  {restBox || (events[0] && evCard(events[0], 0))}
                  <div className="tv-subgrid">
                    {offCard}
                    <VibePanel counts={vibeCounts} onSend={sendVibe} cooldown={vibeCooldown} tv />
                    <Arena schoolId={data.id} day={z.date} phase={s.phase} tv />
                  </div>
                </>
              )}
            </section>
          </div>

          <div className="tv-bottom">
            {strip && <div className="stripbox">{strip}</div>}
            {note && <section className="ticker"><span>Közlemény</span><p key={note.id} className="flash">{note.text}</p></section>}
          </div>

          {overlay}
        </main>
        <VibeOverlay floats={vibeFloats} />
        {fx && <Fx phase={s.phase} bellKey={key} tv={tv} wx={wx?.c} sound={!!data.settings.sound_enabled && audioOn} />}
        <Celebrate enabled={fx} sound={!!data.settings.sound_enabled && audioOn} phase={s.phase} awayDays={pv ? Math.round((tms(pv.date) - tms(z.date)) / 86400000) : 0} events={((data.countdowns ?? []) as any[]).map(c => ({ id: c.id, title: c.title, left: Math.round((instantOf(c.target_date, toSec(c.target_time), data.settings.timezone) - now.getTime()) / 1000) }))} />
        {fx && <FinalCount phase={s.phase} remaining={Math.ceil(s.remaining)} />}
        {fx && <BellFlash bellKey={key} phase={s.phase} label={s.current?.label} />}
      </>
    )
  }

  // ==================== NORMÁL (BENTO DASHBOARD) NÉZET ====================
  return (
    <>
      <main className="bento-app">
        <header className="bento-hdr">
          <div className="hdr-brand-col">
            <span className="brand">
              <img className="logo" src={data.settings.logo_url || '/logo.png'} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />
              {APP_NAME}
            </span>
            <div className="hdr-meta">
              <div className="date">{dateText}</div>
              {wx && (
                <div className="wx">
                  <span>{WX(wx.c)[0]}</span>
                  <b>{wx.t}°C, {WX(wx.c)[1]}</b>
                  <small>{data.settings.weather_city} ({wx.min}–{wx.max}°C, 💧{wx.p}%)</small>
                </div>
              )}
            </div>
          </div>

          <div className="timebox">
            <Digits text={hms(z.secs)} />
          </div>

          <div className="tools">
            {offline && <span className="pill">Offline mód</span>}
            {data.settings.sound_enabled && !audioOn && (
              <button className="cta" onClick={async () => setAudioOn(await enableAudio())}>Hang engedélyezése</button>
            )}
            {!standalone && (
              installEv
                ? <button className="cta" onClick={async () => { installEv.prompt(); await installEv.userChoice; setInstallEv(null) }}>Telepítés</button>
                : <button onClick={() => location.assign('/telepites')}>Telepítés</button>
            )}
            <button className={hasMySchedule ? 'on' : ''} onClick={() => setMyModalOpen(true)} title="Saját tantárgyak és termek beállítása">📚 Saját óráim</button>
            <NotifyButton schoolId={data.id} />
            {data.settings.particles !== false && (
              <button className={fxOn ? 'on' : ''} onClick={() => { const v = !fxOn; localStorage.setItem('fx', v ? '1' : '0'); setFxOn(v) }} title="Háttéreffektek">✨</button>
            )}
            <button onClick={() => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('theme', t); setTheme(t) }}>Téma</button>
          </div>
        </header>

        {/* 3 oszlopos Bento Műszerfal */}
        <div className="dash-grid">
          {/* 1. OSZLOP (BAL): Fő visszaszámláló + Napsáv + Gyors statisztika + Következő csengetések */}
          <div className="dash-col col-hero">
            <section className={`panel now ${s.phase}`}>
              <div className="tag">Most</div>
              <Ring s={s} my={myCur} />
              {pv && first
                ? <NextDay label={dayName(pv.date, { weekday: 'long' })} time={fmtHM(first.start_time)} until={until} />
                : <Next s={s} secs={z.secs} my={myNext} />}
              {strip && <div className="hero-strip">{strip}</div>}
              {stats && <div className="hero-stats">{stats}</div>}
              {bells}
            </section>
          </div>

          {/* 2. OSZLOP (KÖZÉP): Mai napirend, változások, szünet-videó / pihenő mód, heti áttekintés */}
          <div className="dash-col col-schedule">
            {changesBox}
            {vid}
            {restBox}

            {L.length > 0 && (
              <section className="panel board">
                <div className="board-top">
                  <div>
                    <div className="tag" style={{ marginBottom: 4 }}>{s.phase === 'closed' ? 'Következő tanítási nap' : 'Mai napirend'}</div>
                    <h2>{tl.name}</h2>
                  </div>
                  <button type="button" className="my-btn" onClick={() => setMyModalOpen(true)}>
                    ✏️ {hasMySchedule ? 'Óráim szerkesztése' : 'Saját órák megadása'}
                  </button>
                </div>
                <p className="meta">
                  {s.phase === 'closed' && pv ? `${dayName(pv.date, { weekday: 'long', month: 'long', day: 'numeric' })}, ` : ''}
                  {L.length} óra ({fmtHM(L[0].start_time)} – {fmtHM(L[L.length - 1].end_time)})
                </p>
                <ol>
                  {L.map((l: any, i: number) => {
                    const nx = L[i + 1]
                    const cls = s.current?.id === l.id ? 'now' : s.next?.id === l.id ? 'upnext' : s.phase !== 'closed' && z.secs >= toSec(l.end_time) ? 'past' : ''
                    const gap = nx ? Math.round((toSec(nx.start_time) - toSec(l.end_time)) / 60) : 0
                    const inBreak = s.phase === 'break' && s.next?.id === nx?.id
                    const custom = formatMyLesson(l, getEntry(boardWeekday, l.position))
                    return (
                      <Fragment key={l.id}>
                        <li className={`l ${cls} ${custom.isFree ? 'free' : ''}`} style={p(cls === 'now')}>
                          <div className="l-main">
                            <b>{custom.title}</b>
                            {custom.sub && <small className="l-orig">{custom.sub}</small>}
                            {custom.room && <span className="room-pill">📍 {fmtRoom(custom.room)}</span>}
                          </div>
                          <span className="t">{fmtHM(l.start_time)} – {fmtHM(l.end_time)}</span>
                          <span className="chip">{CHIP[cls] ?? (custom.isFree ? 'szabad' : '')}</span>
                        </li>
                        {gap > 0 && <li className={`g ${inBreak ? 'nowb' : ''}`} style={p(inBreak)}>{gap} perc szünet</li>}
                      </Fragment>
                    )
                  })}
                </ol>
              </section>
            )}

            <section className="panel week-panel">
              <div className="tag">E heti rend</div>
              <div className="week">
                {week.map(w => (
                  <div key={w.date} className={`wd ${w.date === z.date ? 'today' : ''} ${w.dim ? 'off' : ''}`}>
                    <b>{dayName(w.date, { weekday: 'long' })}</b>
                    <small>{dayName(w.date, { month: 'long', day: 'numeric' })}</small>
                    <span>{w.info}</span>
                  </div>
                ))}
              </div>
              {yearBox}
            </section>
          </div>

          {/* 3. OSZLOP (JOBB): Élő Hangulatfal, Mini-Aréna, Szavazás, Ebéd, Közlemények, Szünetek */}
          <div className="dash-col col-side">
            <VibePanel counts={vibeCounts} onSend={sendVibe} cooldown={vibeCooldown} />

            <Arena schoolId={data.id} day={z.date} phase={s.phase} sound={!!data.settings.sound_enabled && audioOn} />

            {pollCard}
            {lunchBox}

            {notes.length > 0 && (
              <section className="panel">
                <div className="tag">Közlemények</div>
                {notes.slice(0, 4).map(n => <p className="notice" key={n.id}>{n.text}</p>)}
              </section>
            )}

            {(events.length > 0 || offCard) && (
              <section className="events-side">
                <div className="tag wide">Közelgő szünetek és ünnepek</div>
                <div className="events">
                  {events.map(evCard)}
                  {offCard}
                </div>
              </section>
            )}
          </div>
        </div>

        {data.settings.site_version && (
          <footer className="foot">
            <span className="ver">Verzió {data.settings.site_version}</span>
            {data.settings.version_note && <span>{data.settings.version_note}</span>}
          </footer>
        )}
        {data.settings.ask_enabled && <Ask />}
        <MyScheduleModal
          open={myModalOpen}
          onClose={() => setMyModalOpen(false)}
          lessons={L}
          defaultWeekday={boardWeekday}
          map={myMap}
          onSave={updateMyMap}
        />
        {overlay}
      </main>
      <VibeOverlay floats={vibeFloats} />
      {fx && <Fx phase={s.phase} bellKey={key} tv={tv} wx={wx?.c} sound={!!data.settings.sound_enabled && audioOn} />}
      <Celebrate enabled={fx} sound={!!data.settings.sound_enabled && audioOn} phase={s.phase} awayDays={pv ? Math.round((tms(pv.date) - tms(z.date)) / 86400000) : 0} events={((data.countdowns ?? []) as any[]).map(c => ({ id: c.id, title: c.title, left: Math.round((instantOf(c.target_date, toSec(c.target_time), data.settings.timezone) - now.getTime()) / 1000) }))} />
      {fx && <FinalCount phase={s.phase} remaining={Math.ceil(s.remaining)} />}
      {fx && <BellFlash bellKey={key} phase={s.phase} label={s.current?.label} />}
    </>
  )
}
