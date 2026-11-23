import { Fragment, Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { audioReady, enableAudio, preload, ring, type BellSoundStyle } from './lib/sound'
import { useSupporters, useVip, type VipPrefs } from './lib/vip'
import { SupporterTicker, VipModal, type VipModalTab } from './VipModal'
import { applyHolidayDom, isAfterDec5, useAdvent, WINTER_BREAK_DATE, type HolidayThemeMode } from './lib/advent'
import { AdventModal, AdventWreathIcon, ChristmasStockingSvg, SantaHatSvg, WinterBreakStrip, type AdventModalTab } from './AdventModal'
import { FlyingSleighTop, PeekingSantaBg } from './ChristmasDecor'
import QRCode from 'qrcode'
import NotifyButton from './Notify'
import Fx, { BellFlash, Celebrate, FinalCount } from './Fx'
import { PollCard, usePoll } from './Poll'
import BreakVideo from './BreakVideo'
const RestMode = lazy(() => import('./Rest'))
const Ask = lazy(() => import('./Ask'))
import { MyScheduleModal, formatMyLesson, useMySchedule, type MyLessonEntry } from './MySchedule'
import { VibeOverlay, VibePanel, useVibe } from './Vibe'
const Arena = lazy(() => import('./Arena'))
import Jukebox, { useJukebox, type SongWish } from './Jukebox'
import Daily from './Daily'
import FeedbackPanel from './FeedbackPanel'
const GamesPage = lazy(() => import('./pages/GamesPage'))
const MediaPage = lazy(() => import('./pages/MediaPage'))

type AppTab = 'home' | 'schedule' | 'games' | 'media'
type LayoutMode = 'classic' | 'tabbed'
const LAYOUT_KEY = 'sulibell_layout_v1'
const TAB_PATH: Record<AppTab, string> = {
  home: '/',
  schedule: '/orarend',
  games: '/jatek',
  media: '/zene',
}
function tabFromPath(pathname: string): AppTab {
  if (pathname.startsWith('/orarend')) return 'schedule'
  if (pathname.startsWith('/jatek')) return 'games'
  if (pathname.startsWith('/zene')) return 'media'
  return 'home'
}
function loadLayoutMode(pathname: string): LayoutMode {
  if (tabFromPath(pathname) !== 'home') return 'tabbed'
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'tabbed' ? 'tabbed' : 'classic'
  } catch {
    return 'classic'
  }
}
import { isMaintAnnouncement, useMaintenance } from './lib/maintenance'
import { isPartnersAnnouncement, parsePartnersFromAnnouncements } from './lib/partners'
import { isKofiAnnouncement, parseKofiFromAnnouncements, formatDonationAmount } from './lib/kofi'
import { trackPageVisit, useOnlinePresence } from './lib/visits'
import { isBannedWordsAnnouncement, parseBannedWordsFromAnnouncements } from './lib/moderation'
import { DISCORD_INVITE_URL, fetchDiscordSync, type DiscordAnnouncementItem } from './lib/discord'
import { updateSandbox, useSandbox, type SandboxConfig } from './lib/sandbox'
import { useSchool } from './lib/useSchool'
import { serverNowMs, startServerTimeSync, subscribeServerTime } from './lib/serverTime'
import { KIND } from './lib/kinds'
import { APP_NAME } from './lib/brand'
import { computeState, fmtCount, fmtHM, addDays, instantOf, isLessonCancelled, nextSchoolDay, scheduleFor, schoolDaysBetween, toSec, zoned, type BellState, type Lesson } from './lib/engine'

const pad = (n: number) => String(n).padStart(2, '0')
const hms = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
const fmtRoom = (r: string) => (/^\d+$/.test(r.trim()) ? `${r.trim()}. terem` : r.trim())
/** Saját órarend: ha a látogató az adott napra kitöltött legalább egy órát, a kitöltetlen órák nem látszanak (és nem számolnak). */
const onlyMyLessons = <T extends { position: number }>(lessons: T[], weekday: number, get?: (weekday: number, pos?: number) => MyLessonEntry | undefined): T[] => {
  if (!get) return lessons
  const mine = lessons.filter(l => get(weekday, l.position))
  return mine.length ? mine : lessons
}
const TITLE: Record<BellState['phase'], string> = { closed: '', before: 'Tanítás előtt', lesson: '', break: 'Szünet', after: 'Vége a tanításnak' }
const CHIP: Record<string, string> = { past: 'vége', now: 'most', upnext: 'következő', cancelled: 'elmarad' }

/** Neon számjegyek: világító, egyenletes szélességű számok, váltáskor finom beúszással. */
const huFmtCache = new Map<string, Intl.DateTimeFormat>()
function formatHuDate(d: string, o: Intl.DateTimeFormatOptions): string {
  const key = JSON.stringify(o)
  let fmt = huFmtCache.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('hu-HU', { timeZone: 'UTC', ...o })
    huFmtCache.set(key, fmt)
  }
  return fmt.format(new Date(d + 'T12:00:00Z'))
}

function Digits({ text }: { text: string }) {
  return <span className="digits neon" role="img" aria-label={text}>
    {text.split('').map((c, i) => c === ':' ? <i key={i} className="dg-sep">:</i> : <span key={`${i}${c}`} className="dg">{c}</span>)}</span>
}

/** 4×/mp-es ellenőrzéssel újraszámolja az állapotot a beállított időzóna (Europe/Budapest) szerint, figyelembe véve az elmaradó órákat is. */
function useBell(tv: boolean, getMyEntry?: (weekday: number, pos?: number) => MyLessonEntry | undefined, sb?: SandboxConfig | null, potato?: boolean) {
  const { data, offline } = useSchool()
  const [nowSec, setNowSec] = useState(() => Math.floor(serverNowMs() / 1000))
  useEffect(() => {
    startServerTimeSync()
    let lastSec = Math.floor(serverNowMs() / 1000)
    const syncNow = () => {
      const s = Math.floor(serverNowMs() / 1000)
      if (s !== lastSec) {
        lastSec = s
        setNowSec(s)
      }
    }
    const onWake = () => {
      if (!document.hidden) syncNow()
    }
    const unsubTime = subscribeServerTime(syncNow)
    const t = window.setInterval(syncNow, potato ? 1000 : 250)
    document.addEventListener('visibilitychange', onWake)
    document.addEventListener('resume', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('pageshow', onWake)
    return () => {
      clearInterval(t)
      unsubTime()
      document.removeEventListener('visibilitychange', onWake)
      document.removeEventListener('resume', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('pageshow', onWake)
    }
  }, [potato])
  const now = new Date(nowSec * 1000)
  const rawZ = data ? zoned(now, data.settings.timezone) : null
  const dayDate = rawZ?.date ?? ''
  const dayWeekday = rawZ?.weekday ?? 1
  const dayPrep = useMemo(() => {
    if (!data || !dayDate) return null
    const ov = Object.fromEntries((data.schedule_dates ?? []).map((x: any) => [x.day, x.schedule_id])) as Record<string, string>
    const baseSchedule = scheduleFor(dayDate, data.schedules, ov)
    const allLessons: Lesson[] = onlyMyLessons([...(baseSchedule?.lessons ?? [])].sort((a, b) => a.position - b.position), dayWeekday, tv ? undefined : getMyEntry)
    const schedule = baseSchedule ? { ...baseSchedule, lessons: allLessons } : baseSchedule
    const maxPos = allLessons.length ? Math.max(...allLessons.map(l => l.position)) : 0
    const baseChanges = ((data.changes ?? []) as any[]).filter(c => c.day === dayDate)
    const dayChanges = sb ? [...baseChanges, ...sb.extraChanges.map(c => ({ ...c, day: dayDate }))] : baseChanges
    const cancelledIds = new Set<string>()
    for (const l of allLessons) {
      const myEntry = !tv ? getMyEntry?.(dayWeekday, l.position) : undefined
      const isMyFree = !!formatMyLesson(l, myEntry).isFree
      if (isLessonCancelled(l, dayChanges, isMyFree, maxPos)) {
        cancelledIds.add(l.id)
      }
    }
    const activeLessons = allLessons.filter(l => !cancelledIds.has(l.id))
    const cancelledLessons = allLessons.filter(l => cancelledIds.has(l.id))
    let closed = sb?.simClosedReason ?? data.closed.find((c: any) => c.day === dayDate)?.reason
    if (!closed && allLessons.length > 0 && activeLessons.length === 0) {
      closed = 'Minden mai óra elmarad.'
    }
    const effData = sb ? {
      ...data,
      changes: dayChanges,
      menus: sb.testMenu.trim() ? [{ id: 'sb-m', day: dayDate, text: sb.testMenu.trim() }, ...(data.menus ?? []).filter((m: any) => m.day !== dayDate)] : data.menus,
      announcements: sb.testAnnouncement.trim() ? [{ id: 'sb-a', text: sb.testAnnouncement.trim(), active_until: null }, ...(data.announcements ?? [])] : data.announcements,
      settings: {
        ...data.settings,
        alert_active: sb.alertActive ? true : data.settings.alert_active,
        alert_text: sb.alertActive ? sb.alertText : data.settings.alert_text,
      },
    } : data
    const byPos = (x: any[]) => [...x].sort((p: any, q: any) => p.position - q.position)
    const monday = addDays(dayDate, 1 - dayWeekday)
    const week = [0, 1, 2, 3, 4, 5, 6].map(i => {
      const date = addDays(monday, i), sch = scheduleFor(date, effData.schedules, ov), ls = sch ? byPos(sch.lessons) : []
      const off = (effData.closed as { day: string; reason: string }[]).find(c => c.day === date)?.reason
      return { date, i, dim: !!off || !ls.length, info: off ?? '' }
    }).filter(w => w.i < 5 || !w.dim)
    const upcoming = (effData.closed as { day: string; reason: string }[]).filter(c => c.day > dayDate).sort((x, y) => x.day.localeCompare(y.day)).slice(0, 4)
    parseBannedWordsFromAnnouncements(effData.announcements)
    const partners = parsePartnersFromAnnouncements(effData.announcements)
    const kofi = parseKofiFromAnnouncements(effData.announcements)
    return { effData, ov, schedule, activeLessons, cancelledLessons, cancelledIds, closed, week, upcoming, partners, kofi }
  }, [data, dayDate, dayWeekday, tv, getMyEntry, sb])

  return useMemo(() => {
    const now = new Date(nowSec * 1000)
    if (!data || !dayPrep || !rawZ) return { data, offline, cancelledIds: new Set<string>() }

    const z = sb && sb.simSecs !== null ? { ...rawZ, secs: sb.simSecs } : rawZ
    const st = computeState(z.secs, dayPrep.activeLessons, dayPrep.closed, !dayPrep.schedule, dayPrep.cancelledLessons)
    const ov: Record<string, string> = dayPrep.ov
    if (true as boolean) return { data: dayPrep.effData, offline, z, schedule: dayPrep.schedule, state: st, now, cancelledIds: dayPrep.cancelledIds, ovMap: dayPrep.ov, week: dayPrep.week, upcoming: dayPrep.upcoming, partners: dayPrep.partners, kofi: dayPrep.kofi }
    const baseSchedule = scheduleFor(z.date, data.schedules, ov)
    const allLessons: Lesson[] = onlyMyLessons([...(baseSchedule?.lessons ?? [])].sort((a, b) => a.position - b.position), z.weekday, tv ? undefined : getMyEntry)
    const schedule = baseSchedule ? { ...baseSchedule, lessons: allLessons } : baseSchedule
    const maxPos = allLessons.length ? Math.max(...allLessons.map(l => l.position)) : 0
    const baseChanges = ((data.changes ?? []) as any[]).filter(c => c.day === z.date)
    const dayChanges = sb ? [...baseChanges, ...sb.extraChanges.map(c => ({ ...c, day: z.date }))] : baseChanges
    const cancelledIds = new Set<string>()
    for (const l of allLessons) {
      const myEntry = !tv ? getMyEntry?.(z.weekday, l.position) : undefined
      const isMyFree = !!formatMyLesson(l, myEntry).isFree
      if (isLessonCancelled(l, dayChanges, isMyFree, maxPos)) {
        cancelledIds.add(l.id)
      }
    }
    const activeLessons = allLessons.filter(l => !cancelledIds.has(l.id))
    const cancelledLessons = allLessons.filter(l => cancelledIds.has(l.id))
    let closed = sb?.simClosedReason ?? data.closed.find(c => c.day === z.date)?.reason
    if (!closed && allLessons.length > 0 && activeLessons.length === 0) {
      closed = 'Minden mai óra elmarad.'
    }
    const state = computeState(z.secs, activeLessons, closed, !schedule, cancelledLessons)
    const effData = sb ? {
      ...data,
      changes: dayChanges,
      menus: sb.testMenu.trim() ? [{ id: 'sb-m', day: z.date, text: sb.testMenu.trim() }, ...(data.menus ?? []).filter((m: any) => m.day !== z.date)] : data.menus,
      announcements: sb.testAnnouncement.trim() ? [{ id: 'sb-a', text: sb.testAnnouncement.trim(), active_until: null }, ...(data.announcements ?? [])] : data.announcements,
      settings: {
        ...data.settings,
        alert_active: sb.alertActive ? true : data.settings.alert_active,
        alert_text: sb.alertActive ? sb.alertText : data.settings.alert_text,
      },
    } : data
    return { data: effData, offline, z, schedule, state, now, cancelledIds }
  }, [nowSec, data, offline, dayPrep, rawZ, sb])
}

/** Számlap: 60 osztás, az ív az aktuális óra/szünet előrehaladása, közepén a visszaszámláló. */
function Ring({ s, my, lastMin, christmas }: { s: BellState; my?: MyLessonEntry; lastMin?: boolean; christmas?: boolean }) {
  const R = 86, C = 2 * Math.PI * R
  const live = s.phase === 'lesson' || s.phase === 'break' || s.phase === 'before'
  const custom = s.phase === 'lesson' ? formatMyLesson(s.current, my) : null
  const title = s.phase === 'lesson' ? (custom?.title || s.current!.label) : (s.reason || TITLE[s.phase])
  return <div className={`ring ${s.phase}${lastMin ? ' vip-last-min' : ''}`}>
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <linearGradient id="ledg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff3fb8" /><stop offset="28%" stopColor="#ffb02e" />
          <stop offset="55%" stopColor="#39ff7a" /><stop offset="80%" stopColor="#2de2ff" />
          <stop offset="100%" stopColor="#8a5cff" />
        </linearGradient>
        <pattern id="candycane" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(42)">
          <rect width="7" height="14" fill="#e63946" />
          <rect x="7" width="7" height="14" fill="#f8fafc" />
        </pattern>
        <linearGradient id="ledg_noop" x1="0" y1="0" x2="1" y2="1">
        </linearGradient>
      </defs>
      <circle className="ticks" cx="100" cy="100" r="96" stroke="url(#ledg)" />
      <circle className="track" cx="100" cy="100" r={R} />
      {live && <circle className="arc" cx="100" cy="100" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - s.progress)} style={christmas ? { stroke: 'url(#candycane)' } : undefined} />}
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
const WX = (c: number, night?: boolean): [string, string] => c === 0 ? [night ? '🌙' : '☀️', 'Derült'] : c <= 2 ? [night ? '🌙' : '🌤️', 'Részben felhős'] : c === 3 ? ['☁️', 'Borult'] : c <= 48 ? ['🌫️', 'Ködös']
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
function DayStrip({ L, secs, phase, cancelledIds }: { L: any[]; secs: number; phase: BellState['phase']; cancelledIds?: Set<string> }) {
  const a = toSec(L[0].start_time), b = toSec(L[L.length - 1].end_time), span = b - a
  const live = phase === 'lesson' || phase === 'break'
  return <div className="strip">
    <div className="bar">
      {L.map((l, i) => {
        const s0 = toSec(l.start_time), e0 = toSec(l.end_time)
        const isCanc = cancelledIds?.has(l.id)
        const cls = isCanc ? 'cancelled' : secs >= e0 ? 'past' : secs >= s0 ? 'on' : ''
        return <i key={l.id} className={`seg ${cls}`}
          style={{ left: `${((s0 - a) / span) * 100}%`, width: `${((e0 - s0) / span) * 100}%` }}>{i + 1}</i>
      })}
      {live && <span className="mark" style={{ left: `${Math.min(1, Math.max(0, (secs - a) / span)) * 100}%` }} />}
    </div>
    <div className="ends"><span>{fmtHM(L[0].start_time)}</span><span>{fmtHM(L[L.length - 1].end_time)}</span></div>
  </div>
}

const ScrollCue = memo(function ScrollCue({ layoutKey }: { layoutKey: string }) {
  const [showMedia, setShowMedia] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)

  useEffect(() => {
    const check = () => {
      const mediaEl = document.querySelector('.jukebox, .arena') as HTMLElement | null
      const fbEl = document.querySelector('.feedback-panel') as HTMLElement | null
      const fold = window.innerHeight - 90
      setShowMedia(!!mediaEl && mediaEl.getBoundingClientRect().top > fold)
      setShowFeedback(!!fbEl && fbEl.getBoundingClientRect().top > fold)
    }
    check()
    const t1 = window.setTimeout(check, 250)
    const t2 = window.setTimeout(check, 900)
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check, { passive: true })
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }
  }, [layoutKey])

  if (!showMedia && !showFeedback) return null

  const scrollTo = (sel: string) => {
    const target = document.querySelector(sel) as HTMLElement | null
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="scroll-cue-dock" role="navigation" aria-label="Gyors görgetés">
      {showMedia && (
        <button
          type="button"
          className="scroll-cue"
          onClick={() => scrollTo('.jukebox, .arena')}
          title="Ugrás a zenebeküldéshez és a szüneti játékhoz"
        >
          <span className="scroll-cue-txt">🎵 Zene beküldés &amp; játék</span>
          <span className="scroll-cue-arr" aria-hidden="true">↓</span>
        </button>
      )}
      {showFeedback && (
        <button
          type="button"
          className="scroll-cue scroll-cue-fb"
          onClick={() => scrollTo('.feedback-panel')}
          title="Ugrás a hibajelentéshez és ötletbeküldéshez"
        >
          <span className="scroll-cue-txt">💬 Hibajelentés &amp; ötlet</span>
          <span className="scroll-cue-arr" aria-hidden="true">↓</span>
        </button>
      )}
    </div>
  )
})

export default function App({ sandbox }: { sandbox?: boolean } = {}) {
  const sb = useSandbox(!!sandbox)
  const tv = sandbox ? sb.simTv : location.pathname.startsWith('/display')
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => loadLayoutMode(location.pathname))
  const [activeTab, setActiveTab] = useState<AppTab>(() => tabFromPath(location.pathname))
  useEffect(() => {
    if (tv || sandbox) return
    const onPop = () => {
      const t = tabFromPath(location.pathname)
      setActiveTab(t)
      if (t !== 'home') setLayoutMode('tabbed')
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === LAYOUT_KEY) {
        setLayoutMode(e.newValue === 'tabbed' ? 'tabbed' : 'classic')
      }
    }
    window.addEventListener('popstate', onPop)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('storage', onStorage)
    }
  }, [tv, sandbox])
  const toggleLayoutMode = useCallback(() => {
    setLayoutMode(prev => {
      const next: LayoutMode = prev === 'tabbed' ? 'classic' : 'tabbed'
      try { localStorage.setItem(LAYOUT_KEY, next) } catch { /* ignore */ }
      if (next === 'classic' && !tv && !sandbox && location.pathname !== '/') {
        try { window.history.pushState(null, '', '/') } catch { /* ignore */ }
      }
      if (next === 'tabbed') setActiveTab('home')
      window.scrollTo({ top: 0, behavior: 'auto' })
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
      return next
    })
  }, [tv, sandbox])
  const navigateTab = useCallback((next: AppTab) => {
    setActiveTab(next)
    if (!tv && !sandbox) {
      const targetPath = TAB_PATH[next]
      if (location.pathname !== targetPath) {
        try { window.history.pushState(null, '', targetPath) } catch { /* ignore */ }
      }
    }
    window.scrollTo({ top: 0, behavior: 'auto' })
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
  }, [tv, sandbox])
  const { map: myMap, update: updateMyMap, getEntry, hasAny: hasMySchedule } = useMySchedule()
  const [potato, setPotato] = useState(() => { try { return localStorage.getItem('potato') === '1' } catch { return false } })
  useEffect(() => { if (potato) document.documentElement.dataset.potato = '1'; else delete document.documentElement.dataset.potato }, [potato])
  const togglePotato = () => { const v = !potato; try { localStorage.setItem('potato', v ? '1' : '0') } catch { /* nem baj */ } setPotato(v) }
  const { data, offline, z, schedule, state, now, cancelledIds, ovMap, week: weekFromBell, upcoming: upcomingFromBell, partners: partnersFromBell, kofi: kofiFromBell } = useBell(tv, getEntry, sandbox ? sb : null, potato) as any
  const upcoming: { day: string; reason: string }[] = upcomingFromBell ?? []
  const partners: ReturnType<typeof parsePartnersFromAnnouncements> = partnersFromBell ?? []
  const kofi: ReturnType<typeof parseKofiFromAnnouncements> = kofiFromBell ?? { url: '', donors: [] }
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
  const fx = !potato && fxOn && data?.settings.particles !== false && style === 'neon'
  const isTvWeekend = tv && !!z && (z.weekday === 6 || z.weekday === 7) && state?.phase === 'closed'
  const tvActive = tv && !isTvWeekend
  const needAll = tvActive || (!tv && layoutMode === 'classic')
  const { poll, counts } = usePoll(needAll ? data?.id : undefined)
  const pollQr = useQr(location.origin + '/szavazas', tv && !!poll)
  const [myModalOpen, setMyModalOpen] = useState(false)
  useOnlinePresence(sandbox ? undefined : data?.id, tv ? 'tv' : 'web')
  useEffect(() => { if (data?.id && !sandbox) void trackPageVisit(data.id, location.pathname) }, [data?.id, sandbox])

  // Csengetési hang: állapotváltáskor szól, ha az admin bekapcsolta és a hang engedélyezve van.
  // Hang alapból bekapcsolva: a böngésző az első érintésnél/kattintásnál/billentyűnél automatikusan feloldja; a látogató letilthatja.
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem('sound-muted') === '1' } catch { return false } })
  const [ctxOn, setCtxOn] = useState(audioReady())
  useEffect(() => {
    if (muted || ctxOn) return
    let done = false
    const unlock = () => { if (done) return; enableAudio().then(ok => { if (ok) { done = true; setCtxOn(true) } }).catch(() => {}) }
    unlock()   // ha a böngésző már engedi (pl. kioszk / korábbi interakció), azonnal indul
    const evs = ['pointerdown', 'keydown', 'touchstart'] as const
    evs.forEach(e => window.addEventListener(e, unlock, { passive: true }))
    return () => evs.forEach(e => window.removeEventListener(e, unlock))
  }, [muted, ctxOn])
  const toggleMute = async () => {
    const next = !muted
    setMuted(next)
    try { localStorage.setItem('sound-muted', next ? '1' : '0') } catch { /* nem baj */ }
    if (!next) setCtxOn(await enableAudio())
  }
  const audioOn = !muted && ctxOn
  const vip = useVip()
  const hasCustomVipTheme = vip.status.active && vip.prefs.theme !== 'neon-green'
  const advent = useAdvent(hasCustomVipTheme)
  const devXmasPreview = import.meta.env.DEV && typeof location !== 'undefined' && /[?&]xmaspreview=1\b/.test(location.search)
  const sandboxXmasPreview = !!sandbox && sb.forceXmasAfterDec5
  const xmasPreviewActive = devXmasPreview || sandboxXmasPreview
  const isXmasSkin = advent.activeTheme === 'christmas' || xmasPreviewActive
  const showBrandHoliday = isXmasSkin || advent.santaFrameActive
  const showXmasAfterDec5 = !potato && isXmasSkin && (isAfterDec5(advent.serverDate) || xmasPreviewActive)
  useEffect(() => {
    if (!xmasPreviewActive) return
    document.documentElement.dataset.holidayTheme = 'christmas'
    return () => {
      applyHolidayDom(advent.activeTheme, advent.santaFrameActive)
    }
  }, [xmasPreviewActive, advent.activeTheme, advent.santaFrameActive])
  const [adventModal, setAdventModal] = useState<{ open: boolean; tab: AdventModalTab }>({ open: false, tab: 'calendar' })
  const handleUpdateVipPrefs = (patch: Partial<VipPrefs>) => {
    vip.updatePrefs(patch)
    if (patch.theme && patch.theme !== 'neon-green') advent.setThemeMode('off')
    if (patch.bellSound) advent.setHolidayBell(null)
  }
  const handleSetHolidayTheme = (mode: HolidayThemeMode) => {
    advent.setThemeMode(mode)
    if (mode !== 'off' && vip.status.active && vip.prefs.theme !== 'neon-green') {
      vip.updatePrefs({ theme: 'neon-green' })
    }
  }
  const handleToggleSnow = (force?: boolean) => {
    const next = typeof force === 'boolean' ? force : !advent.state.snowEnabled
    advent.toggleSnow(next)
    if (next && !fxOn) {
      try { localStorage.setItem('fx', '1') } catch { /* ignore */ }
      setFxOn(true)
    }
  }
  const { counts: vibeCounts, floats: vibeFloats, sendVibe, cooldown: vibeCooldown } = useVibe(
    needAll || (!tv && activeTab === 'home') ? data?.id : undefined,
    z?.date ?? '',
    !!data?.settings.sound_enabled && audioOn,
    isXmasSkin
  )
  const { songs: jbWishes, finishSong } = useJukebox(needAll ? data?.id : undefined, z?.date ?? '', false)
  const { maint: liveMaint } = useMaintenance(sandbox ? undefined : data?.id, sandbox ? null : data?.announcements)
  const maint = sandbox
    ? { main: sb.maintMain, tv: sb.maintTv, text: sb.maintText, mainStartsAt: sb.maintMainStartsAt, tvStartsAt: sb.maintTvStartsAt }
    : liveMaint
  const maintSeenRef = useRef<{ on: boolean; startsAt: number; deadline: number }>({ on: false, startsAt: 0, deadline: 0 })
  const [discordNotes, setDiscordNotes] = useState<DiscordAnnouncementItem[]>([])
  useEffect(() => {
    let alive = true
    const loadDc = async (force = false) => {
      if (!force && document.hidden) return
      const res = await fetchDiscordSync()
      if (alive) setDiscordNotes(res.announcements)
    }
    const onWake = () => { if (!document.hidden) loadDc(true) }
    const onRefresh = () => { loadDc(true) }
    loadDc(true)
    const t = setInterval(() => loadDc(false), 20_000)
    window.addEventListener('sulibell:refresh', onRefresh)
    document.addEventListener('visibilitychange', onWake)
    document.addEventListener('resume', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('pageshow', onWake)
    return () => {
      alive = false
      clearInterval(t)
      window.removeEventListener('sulibell:refresh', onRefresh)
      document.removeEventListener('visibilitychange', onWake)
      document.removeEventListener('resume', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('pageshow', onWake)
    }
  }, [potato])
  const [dismissed, setDismissed] = useState('')   // a kiemelt közleményt a látogató bezárhatja (a TV-n nem)
  useEffect(() => { if (audioOn) preload(data?.settings.bell_sound_url) }, [audioOn, data?.settings.bell_sound_url])   // saját csengőhang előtöltése
  // Telepítés gomb (Chrome, Edge, Android): a böngésző jelzi, ha az oldal telepíthető
  const [installEv, setInstallEv] = useState<any>(null)
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setInstallEv(e) }, done = () => setInstallEv(null)
    window.addEventListener('beforeinstallprompt', on); window.addEventListener('appinstalled', done)
    return () => { window.removeEventListener('beforeinstallprompt', on); window.removeEventListener('appinstalled', done) }
  }, [potato])
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
  const qr = useQr(location.origin + '/telepites', tv && data?.settings.tv_show_qr !== false)
  const rawWx = useWeather(data?.settings.weather_lat ?? null, data?.settings.weather_lon ?? null, data?.settings.timezone, !!data?.settings.weather_enabled)
  const wx = sandbox && sb.simWeatherCode !== null
    ? { t: 14, c: sb.simWeatherCode, min: 10, max: 18, p: 90, lat: 0, lon: 0 }
    : rawWx
  const isNight = !!z && (z.secs >= 18 * 3600 || z.secs < 6 * 3600)
  const sup = useSupporters()
  const [vipModal, setVipModal] = useState<{ open: boolean; tab: VipModalTab }>({ open: false, tab: 'vip' })
  const bellStyleRef = useRef<BellSoundStyle>('default')
  bellStyleRef.current = advent.effectiveBell ?? (vip.status.active ? vip.prefs.bellSound : 'default')
  const key = state ? `${state.phase}-${state.current?.id ?? state.next?.id}` : ''
  const prev = useRef('')
  useEffect(() => {
    if (prev.current && key !== prev.current && state?.phase !== 'closed' && data?.settings.sound_enabled && !muted) ring(data.settings.bell_sound_url, bellStyleRef.current)
    prev.current = key
  }, [key])
  // TV-mód méretezése az admin beállítása szerint.
  useEffect(() => { if (tv) document.documentElement.style.fontSize = `${data?.settings.tv_scale ?? 100}%` }, [tv, data])

  if (!data) return <main><div className="panel"><div className="title">{offline ? 'Nincs kapcsolat és nincs mentett adat.' : 'Betöltés…'}</div></div></main>
  const s: BellState = state
  const lastMinuteGlow = vip.status.active && vip.prefs.lastMinuteEffect && s.phase === 'lesson' && s.remaining > 0 && s.remaining <= 60 && !potato
  const byPos = (x: any[]) => [...x].sort((p: any, q: any) => p.position - q.position)

  const pvRaw = s.phase === 'closed' || s.phase === 'after' ? nextSchoolDay(z.date, data.schedules, data.closed, ovMap) : undefined
  const pv = pvRaw ? { ...pvRaw, schedule: { ...pvRaw.schedule, lessons: onlyMyLessons(pvRaw.schedule.lessons, new Date(pvRaw.date + 'T12:00:00Z').getUTCDay() || 7, tv ? undefined : getEntry) } } : undefined
  const tl = s.phase === 'closed' ? pv?.schedule : schedule            // zárva: a következő tanítási nap rendje látszik
  const L = tl ? byPos(tl.lessons) : []
  const boardWeekday = s.phase === 'closed' && pv ? (new Date(pv.date + 'T12:00:00Z').getUTCDay() || 7) : z.weekday
  const myCur = !tv ? getEntry(z.weekday, s.current?.position) : undefined
  const myNext = !tv ? getEntry(z.weekday, s.next?.position) : undefined
  const first = pv && byPos(pv.schedule.lessons)[0]
  const until = pv && first ? Math.round((instantOf(pv.date, toSec(first.start_time), data.settings.timezone) - now.getTime()) / 1000) : 0
  const dayName = formatHuDate
  const dateText = dayName(z.date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  // Visszaszámlálók: a legközelebbi 4 még le nem járt esemény, másodperc pontosan (óraátállással is helyesen).
  const events = ((data.countdowns ?? []) as any[])
    .map(c => ({ ...c, left: Math.round((instantOf(c.target_date, toSec(c.target_time), data.settings.timezone) - now.getTime()) / 1000) }))
    .filter(c => c.left > 0).sort((x, y) => x.left - y.left).slice(0, 4)

  const p = (on: boolean) => (on ? ({ '--p': `${s.progress * 100}%` } as CSSProperties) : undefined)

  // ---- A mai nap adatai (csak tanítási napon, az elmaradó órákat kihagyva a számolóból) ----
  const T_all = schedule && s.phase !== 'closed' ? byPos(schedule.lessons) : []
  const T = T_all.filter((l: any) => !cancelledIds.has(l.id))
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
  const strip = T_all.length > 0 && <DayStrip L={T_all} secs={z.secs} phase={s.phase} cancelledIds={cancelledIds} />
  const bells = bellList.length > 0 && <div className="bells"><div className="tag">Következő csengetések</div>
    <ul>{bellList.map((b: any) => <li key={b.t + b.txt}><b>{hm(b.t)}</b><span>{b.txt}</span><span>{away(b.t)}</span></li>)}</ul></div>

  // ---- E heti rend (hétfő–péntek, plusz a hétvége, ha van rendje) ----
  const week: { date: string; i: number; dim: boolean; info: string }[] = weekFromBell ?? []
  const _unusedWeek = false && [0].map(i => {
    const date = z.date, sch = undefined as any, ls = [] as any[]
    const off = (data.closed as { day: string; reason: string }[]).find(c => c.day === date)?.reason
    void _unusedWeek; void off; void sch; return { date, i, dim: !ls.length, info: '' }
  }).filter(w => w.i < 5 || !w.dim)

  // ---- Közlemények (a TV-n 10 mp-enként váltakoznak) ----
  const notes = ((data.announcements ?? []) as { id: string; text: string; active_until: string | null }[])
    .filter(n => !isMaintAnnouncement(n.text) && !isPartnersAnnouncement(n.text) && !isKofiAnnouncement(n.text) && !isBannedWordsAnnouncement(n.text) && (!n.active_until || n.active_until >= z.date))
    .concat(discordNotes.map(dn => ({ id: dn.id, text: dn.text, active_until: null })))


  const partnersBox = !tv && partners.length > 0 && <section className="panel partners-panel"><div className="tag">🤝 Társoldalak és hasznos linkek</div><div className="partners-grid">{partners.map(p => <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="partner-card"><span className="p-ico" aria-hidden="true">{p.icon || '🌐'}</span><div className="p-info"><b>{p.name}</b>{p.desc && <small>{p.desc}</small>}</div><span className="p-arr" aria-hidden="true">↗</span></a>)}</div></section>

  const kofiHref = kofi.url && !/^https?:\/\/(www\.)?ko-fi\.com\/?$/i.test(kofi.url) ? kofi.url : 'https://ko-fi.com/sulibell'
  const kofiBox = !tv && kofi.enabled !== false && (
    <section className="panel kofi-panel">
      <div className="kofi-head">
        <div className="tag" style={{ marginBottom: 0 }}>☕ Ko-fi Támogatás & 💎 VIP Toplista</div>
        <span className="kofi-vip-pill">💎 Discord VIP</span>
      </div>
      <p className="kofi-sub">
        Tetszik a SuliBell? Támogasd az oldal fejlesztését Ko-fi-n! A támogatók felkerülnek a <b>🏆 Támogatói Toplistára</b>, és ha az üzenetbe beírod a Discord nevedet, automatikusan megkapod a <b>💎 VIP Támogató</b> rangot és a privát VIP szobákat (<b>#💎-vip-társalgó</b>, <b>#👑-vip-zenekérés +2 szavazattal</b>)!
      </p>
      <div className="kofi-actions">
        <a href={kofiHref} target="_blank" rel="noopener noreferrer" className="kofi-cta">
          <span className="kofi-cup" aria-hidden="true">☕</span>
          <span>Támogatás Ko-fi-n</span>
          <span aria-hidden="true">↗</span>
        </a>
        <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer" className="kofi-dc-btn" title="Csatlakozz a Discord szerverhez a VIP szobákért!">
          💎 VIP Szobák (Discord)
        </a>
        <button type="button" className="kofi-sup-btn" onClick={() => setVipModal({ open: true, tab: 'supporters' })}>
          🏆 Támogatók fala{sup.supporters.length > 0 ? ` (${sup.supporters.length})` : ''}
        </button>
        <button type="button" className="kofi-vip-open-btn" onClick={() => setVipModal({ open: true, tab: 'vip' })}>
          {vip.status.active ? '👑 VIP Extrák' : '🔑 VIP kód beváltása'}
        </button>
      </div>
      {sup.topClass && (
        <button type="button" className="kofi-topclass-bar" onClick={() => setVipModal({ open: true, tab: 'supporters' })}>
          <span>🏆 Legtámogatóbb osztály: <b>{sup.topClass.className}</b></span>
          <small>{sup.topClass.count} támogatás ↗</small>
        </button>
      )}
      <div className="kofi-board">
        <div className="kofi-board-title">
          <span>🏆 Támogatói Toplista</span>
          <small>
            {kofi.donors.length > 0
              ? `${kofi.donors.length} támogató`
              : sup.supporters.length > 0
                ? `${sup.supporters.length} támogató`
                : 'Legyél te az első!'}
          </small>
        </div>
        {kofi.donors.length > 0 ? (
          <div className="kofi-list">
            {kofi.donors.slice(0, 10).map((d, idx) => {
              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`
              return (
                <div key={d.id} className={`kofi-item ${idx < 3 ? `kofi-top-${idx + 1}` : ''}`}>
                  <span className="kofi-rank">{medal}</span>
                  <div className="kofi-donor-main">
                    <div className="kofi-donor-row">
                      <b className="kofi-donor-name">{d.name}</b>
                      <span className="kofi-donor-badge" title="Discord VIP Támogató">💎 VIP</span>
                    </div>
                    {d.message && <small className="kofi-donor-msg">„{d.message}”</small>}
                  </div>
                  <span className="kofi-donor-amt">{formatDonationAmount(d.amount, d.currency)}</span>
                </div>
              )
            })}
          </div>
        ) : sup.supporters.length > 0 ? (
          <div className="kofi-list">
            {sup.supporters.slice(0, 6).map((sp, idx) => (
              <div key={sp.id} className={`kofi-item ${sp.is_top_tier ? 'kofi-top-1' : idx < 3 ? `kofi-top-${idx + 1}` : ''}`}>
                <span className="kofi-rank">{sp.is_top_tier ? '👑' : '💚'}</span>
                <div className="kofi-donor-main">
                  <div className="kofi-donor-row">
                    <b className="kofi-donor-name">{sp.name}</b>
                    {sp.class_name && <span className="sup-class-pill">{sp.class_name}</span>}
                    <span className="kofi-donor-badge">{sp.is_top_tier ? '⭐ Top' : '💎 VIP'}</span>
                  </div>
                  {sp.message && <small className="kofi-donor-msg">„{sp.message}”</small>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="kofi-empty">
            🌟 Még senki sem került fel a toplistára — támogasd az oldalt Ko-fi-n, és szerezd meg elsőként a <b>💎 VIP Támogató</b> rangot!
          </div>
        )}
      </div>
    </section>
  )
  const note = notes.length ? notes[Math.floor(now.getTime() / 10000) % notes.length] : null

  // ---- Visszaszámláló kártyák ----
  const startDay = s.phase === 'after' || s.phase === 'closed' ? addDays(z.date, 1) : z.date
  // Téli szünet visszaszámláló (december 18-ig, a napi órarend mellett)
  const winterBreak = (() => {
    const isClosedOnTarget = (data.closed as { day: string }[]).some(c => c.day === WINTER_BREAK_DATE)
    const targetSch = !isClosedOnTarget ? scheduleFor(WINTER_BREAK_DATE, data.schedules, ovMap) : undefined
    const targetLessons = targetSch?.lessons?.length ? byPos(targetSch.lessons) : []
    const targetEndSec = targetLessons.length ? toSec(targetLessons[targetLessons.length - 1].end_time) : 0
    const endMs = instantOf(WINTER_BREAK_DATE, targetEndSec, data.settings.timezone)
    const started = now.getTime() >= endMs || z.date > WINTER_BREAK_DATE
    const isLastDay = !started && !isClosedOnTarget && targetLessons.length > 0 && z.date === WINTER_BREAK_DATE
    const schoolDaysLeft = started ? 0 : schoolDaysBetween(startDay, WINTER_BREAK_DATE, data.schedules, data.closed, ovMap)
    const hoursLeft = started ? 0 : Math.max(0, Math.ceil((endMs - now.getTime()) / 3600000))
    return { started, isLastDay, schoolDaysLeft, hoursLeft }
  })()
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
  const yearDaysLeft = sett.year_start && sett.year_end
    ? schoolDaysBetween(startDay, sett.year_end, data.schedules, data.closed, ovMap)
    : 0
  const yearBox = sett.year_start && sett.year_end && <div className="year-inline"><div className="tag">Tanév haladása</div>
    <div className="yearbar"><i style={{ width: `${yp}%` }} /></div>
    <p className="meta" style={{ marginBottom: 0 }}>{yp}%, még {yearDaysLeft} tanítási nap a tanév végéig</p></div>
  const tvInfoCard = tv && (
    <section className="panel tv-info-card">
      <div className="tag">📅 Közelgő &amp; Tanév</div>
      {events.length > 0 ? (
        <ul className="tv-info-list">
          {events.slice(0, 2).map((e: any) => {
            const k = KIND[e.kind] ?? KIND.other
            const d = Math.floor(e.left / 86400)
            const h = Math.floor((e.left % 86400) / 3600)
            return (
              <li key={e.id}>
                <span aria-hidden="true">{k.icon}</span>
                <b>{e.title}</b>
                <small>{d > 0 ? `${d} nap` : `${Math.max(1, h)} óra`}</small>
              </li>
            )
          })}
        </ul>
      ) : upcoming.length > 0 ? (
        <ul className="tv-info-list">
          {upcoming.slice(0, 2).map((c: { day: string; reason: string }) => (
            <li key={c.day}>
              <span aria-hidden="true">🗓️</span>
              <b>{c.reason}</b>
              <small>{dayName(c.day, { month: 'short', day: 'numeric' })}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tv-info-fallback">
          <b>{schedule?.name || 'Normál csengetési rend'}</b>
          <span>{T.length > 0 ? `${T.length} tanítási óra ma` : 'Nincs tanítás ma'}</span>
        </p>
      )}
      {sett.year_start && sett.year_end && (
        <div className="tv-info-year">
          <div className="tv-info-year-head">
            <span>Tanév haladása</span>
            <b>{yp}% · még {yearDaysLeft} nap</b>
          </div>
          <div className="yearbar"><i style={{ width: `${yp}%` }} /></div>
        </div>
      )}
    </section>
  )
  const overlay = sett.alert_active && sett.alert_text && dismissed !== sett.alert_text && <div className="alertfs" role="alertdialog" aria-live="assertive">
    <div className="alertbox"><div className="tag">Fontos közlemény</div><p>{sett.alert_text}</p>{!tv && <button onClick={() => setDismissed(sett.alert_text)}>Értettem</button>}</div></div>

  const maintTargetOn = tv ? maint.tv : maint.main
  const rawStartsAt = tv ? maint.tvStartsAt : maint.mainStartsAt
  const maintDlKey = 'csengeto-maint-dl-' + (tv ? 'tv' : 'main')
  if (!maintTargetOn) {
    if (maintSeenRef.current.on) {
      try { localStorage.removeItem(maintDlKey) } catch { /* ignore */ }
    }
    maintSeenRef.current = { on: false, startsAt: 0, deadline: 0 }
  } else {
    const startsKey = typeof rawStartsAt === 'number' && rawStartsAt > 0 ? rawStartsAt : 0
    if (!maintSeenRef.current.on || maintSeenRef.current.startsAt !== startsKey) {
      const nowMs = serverNowMs()
      let deadline = 0
      try {
        const saved = JSON.parse(localStorage.getItem(maintDlKey) ?? 'null')
        if (saved && saved.startsAt === startsKey && typeof saved.deadline === 'number') {
          deadline = saved.deadline
        }
      } catch { /* ignore */ }
      if (!deadline) {
        deadline = startsKey > 0 && startsKey <= nowMs + 15_000 ? startsKey : nowMs + 10_000
        try { localStorage.setItem(maintDlKey, JSON.stringify({ startsAt: startsKey, deadline })) } catch { /* ignore */ }
      }
      maintSeenRef.current = { on: true, startsAt: startsKey, deadline }
    }
  }
  const prepLeftSec = maintTargetOn ? Math.max(0, Math.ceil((maintSeenRef.current.deadline - serverNowMs()) / 1000)) : 0
  const isPrepCountdown = maintTargetOn && prepLeftSec > 0
  const isUpdating = maintTargetOn && prepLeftSec <= 0
  const maintPrepBanner = isPrepCountdown && (
    <div className="maint-prep-banner" role="alert" aria-live="polite">
      <div className="maint-prep-inner">
        <span className="maint-prep-badge">⏳ Rendszerfrissítés hamarosan</span>
        <div className="maint-prep-main">
          <b>Készülj fel! A frissítési képernyő {prepLeftSec} másodperc múlva aktiválódik…</b>
          <span>{maint.text}</span>
        </div>
        <div className="maint-prep-timer">{prepLeftSec} mp</div>
        {sandbox && (
          <button
            type="button"
            className="maint-test-exit-btn"
            onClick={() => updateSandbox({ maintMain: false, maintTv: false })}
            title="Teszt leállítása"
          >
            ✕ Mégse / Kilépés
          </button>
        )}
      </div>
      <div className="maint-prep-progress"><i style={{ width: `${Math.min(100, (prepLeftSec / 10) * 100)}%` }} /></div>
    </div>
  )
  const maintOverlay = isUpdating && (
    <div className="maint-overlay" role="status" aria-live="assertive">
      <div className="maint-card">
        <div className="maint-spinner" aria-hidden="true">🔄</div>
        <div className="tag">Rendszerfrissítés</div>
        <h2>Frissítés folyamatban…</h2>
        <p>{maint.text}</p>
        <div className="maint-bar"><i /></div>
        {sandbox && (
          <div className="maint-test-actions">
            <button
              type="button"
              className="cta maint-test-exit-btn"
              onClick={() => updateSandbox({ maintMain: false, maintTv: false })}
            >
              ✕ Kilépés a tesztből (Frissítés kikapcsolása)
            </button>
          </div>
        )}
      </div>
    </div>
  )

  const effectiveWishes: SongWish[] = sandbox && sb.forceBreakMedia ? [{ id: 'sb-demo', day: z.date, kind: 'music', title: 'Cartoon – On & On (Szüneti Zene Mix)', by: 'Admin Tesztlabor', ytId: 'K4DyBUG242c', votes: 99, at: Date.now() }, ...jbWishes] : jbWishes
  const hasAnyWish = effectiveWishes.some(w => !!w.ytId)
  const curBreakKey = s.phase === 'break' ? `${z.date}-${s.next?.id ?? key}` : undefined
  const curJukeboxBreakKey = `${z.date}-${s.phase}-${s.current?.id ?? s.next?.id ?? '0'}`
  const breakTotalSec = s.phase === 'break' ? s.total : undefined
  const isWeekendDay = z.weekday === 6 || z.weekday === 7
  const vid = !isWeekendDay && s.phase === 'break' && data.settings.break_videos !== false && hasAnyWish && (
    <BreakVideo wishes={effectiveWishes} breakKey={s.next?.id ?? key} soundOn={!!data.settings.sound_enabled && audioOn} userMuted={muted} onFinished={finishSong} />
  )
  const e0 = events[0]
  const restEv = pv && first && until > 0
    ? { icon: /ősz/i.test(s.reason ?? '') ? '🍂' : /tél/i.test(s.reason ?? '') ? '❄️' : /nyár/i.test(s.reason ?? '') ? '☀️' : /tavasz/i.test(s.reason ?? '') ? '🌷' : '😴',
        days: Math.floor(until / 86400), hours: Math.floor((until % 86400) / 3600), mins: Math.floor((until % 3600) / 60),
        note: `Ennyi van még hátra a pihenésből! Tanítás újra: ${dayName(pv.date, { weekday: 'long' })}, ${fmtHM(first.start_time)}` }
    : e0 ? { icon: (KIND[e0.kind] ?? KIND.other).icon, days: Math.floor(e0.left / 86400), hours: Math.floor((e0.left % 86400) / 3600), mins: Math.floor((e0.left % 3600) / 60), note: e0.title } : undefined
  const restBox = (tv || layoutMode === 'classic') && s.phase === 'closed' && data.settings.rest_mode !== false && <Suspense fallback={null}><RestMode tv={tv} reason={s.reason} day={z.date} ev={restEv} /></Suspense>
  const pollCard = poll && <PollCard poll={poll} counts={counts} tv={tv} qr={tv ? pollQr : undefined} />
  const brandLogoContent = (
    <>
      <span className="brand-logo-wrap">
        <img
          className="logo"
          src={data.settings.logo_url || '/logo.png'}
          alt=""
          onError={e => {
            const wrap = e.currentTarget.parentElement
            if (wrap) wrap.style.display = 'none'
            else e.currentTarget.style.display = 'none'
          }}
        />
        {showBrandHoliday && <SantaHatSvg />}
      </span>
      <span className="brand-word">
        {showBrandHoliday && APP_NAME.endsWith('l') ? (
          <>
            {APP_NAME.slice(0, -1)}
            <span className="brand-stocking-letter">
              {APP_NAME.slice(-1)}
              <ChristmasStockingSvg />
            </span>
          </>
        ) : (
          APP_NAME
        )}
      </span>
    </>
  )

  // ==================== TV / DISPLAY NÉZET (FIX 100SVH, GÖRGETÉS NÉLKÜL) ====================
  if (tv) {
    if (isTvWeekend) {
      return (
        <>
          <main className={`tv tv-weekend-mode${isUpdating ? ' is-updating' : ''}`}>
            <header className="tv-hdr">
              <div className="tv-hdr-left">
                <span className="brand">
                  {brandLogoContent}
                  {advent.litCandles > 0 && <AdventWreathIcon litCount={advent.litCandles} size="sm" />}
                </span>
                <div className="date">{dateText}</div>
                {wx && (
                  <div className="wx">
                    <span>{WX(wx.c, isNight)[0]}</span>
                    <b>{wx.t}°C, {WX(wx.c, isNight)[1]}</b>
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
                </div>
              </div>
            </header>

            <section className="tv-weekend">
              <div className="panel tv-weekend-card">
                <h1>Hétvége van</h1>
              </div>
            </section>

            {overlay}
          </main>
          {maintPrepBanner}
          {maintOverlay}
          {fx && <Fx phase={s.phase} bellKey={key} day={z.date} tv={tv} wx={wx?.c} night={isNight} sound={false} festiveSnow={advent.state.snowEnabled && !potato} />}
        </>
      )
    }

    return (
      <>
        <PeekingSantaBg enabled={showXmasAfterDec5} fastPreview={xmasPreviewActive} />
        <main className={`tv${isUpdating ? ' is-updating' : ''}`}>
          <header className="tv-hdr">
            <div className="tv-hdr-left">
              <span className="brand">
                {brandLogoContent}
                {advent.litCandles > 0 && <AdventWreathIcon litCount={advent.litCandles} size="sm" />}
              </span>
              <div className="date">{dateText}</div>
              {wx && (
                <div className="wx">
                  <span>{WX(wx.c, isNight)[0]}</span>
                  <b>{wx.t}°C, {WX(wx.c, isNight)[1]}</b>
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
                {data.settings.sound_enabled && (
                  <button className={muted ? 'cta' : ''} onClick={toggleMute}>{muted ? '🔊 Hang bekapcsolása' : '🔇 Hang letiltása'}</button>
                )}
              </div>
              {qr && (
                <div className="qrbox">
                  <img src="/site-qr.jpg" alt="QR-kód az oldal megnyitásához" />
                  <span>Telepítsd<br />telefonra</span>
                </div>
              )}
            </div>
          </header>

          <div className="tv-main">
            <section className={`panel now ${s.phase}${lastMinuteGlow ? ' vip-last-min' : ''}`}>
              <Ring s={s} lastMin={lastMinuteGlow} christmas={isXmasSkin} />
              {isXmasSkin && (s.phase === 'lesson' || s.phase === 'break' || s.phase === 'before') && (
                <div className="xmas-bar" aria-hidden="true"><i style={{ width: `${Math.round(s.progress * 100)}%` }} /></div>
              )}
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
                    <VibePanel counts={vibeCounts} onSend={sendVibe} cooldown={vibeCooldown} tv christmas={isXmasSkin} />
                    <Suspense fallback={null}><Arena schoolId={data.id} day={z.date} phase={s.phase} breakKey={curBreakKey} breakTotalSec={breakTotalSec} tv /></Suspense>
                    <Jukebox schoolId={data.id} day={z.date} breakKey={curJukeboxBreakKey} tv />
                    {tvInfoCard}
                  </div>
                </>
              ) : (
                <>
                  {pollCard}
            {partnersBox}
                  {restBox || (events[0] && evCard(events[0], 0))}
                  <div className="tv-subgrid">
                    {offCard}
                    <VibePanel counts={vibeCounts} onSend={sendVibe} cooldown={vibeCooldown} tv christmas={isXmasSkin} />
                    <Suspense fallback={null}><Arena schoolId={data.id} day={z.date} phase={s.phase} breakKey={curBreakKey} breakTotalSec={breakTotalSec} tv /></Suspense>
                    <Jukebox schoolId={data.id} day={z.date} breakKey={curJukeboxBreakKey} tv />
                    {tvInfoCard}
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
        <FlyingSleighTop enabled={showXmasAfterDec5} fastPreview={xmasPreviewActive} />
        {maintPrepBanner}
      {maintOverlay}
        {!potato && <VibeOverlay floats={vibeFloats} />}
        {fx && <Fx phase={s.phase} bellKey={key} day={z.date} tv={tv} wx={wx?.c} night={isNight} sound={!!data.settings.sound_enabled && audioOn} festiveSnow={advent.state.snowEnabled && !potato} />}
        <Celebrate enabled={fx} sound={!!data.settings.sound_enabled && audioOn} phase={s.phase} day={z.date} awayDays={pv ? Math.round((tms(pv.date) - tms(z.date)) / 86400000) : 0} events={events} allowEasterEggs={false} />
        {fx && <FinalCount phase={s.phase} remaining={Math.ceil(s.remaining)} />}
        {fx && <BellFlash bellKey={key} day={z.date} phase={s.phase} label={s.current?.label} />}
      </>
    )
  }

  // ==================== NORMÁL (BENTO DASHBOARD) NÉZET ====================
  return (
    <>
      <PeekingSantaBg enabled={showXmasAfterDec5} fastPreview={xmasPreviewActive} />
      <main className={`bento-app${isUpdating ? ' is-updating' : ''}`}>
        <header className="bento-hdr">
          <div className="hdr-brand-col">
            <span className="brand">
              {brandLogoContent}
              {advent.unlocked.hasSurvivorBadge && (
                <span className="survivor-pill" title="2026. dec. 24. — Exkluzív adventi jelvény">
                  🏅 Téli Túlélő ’26
                </span>
              )}
            </span>
            <div className="hdr-meta">
              <div className="date">{dateText}</div>
              {wx && (
                <div className="wx">
                  <span>{WX(wx.c, isNight)[0]}</span>
                  <b>{wx.t}°C, {WX(wx.c, isNight)[1]}</b>
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
            {data.settings.sound_enabled && (
              <button className={muted ? 'cta' : ''} onClick={toggleMute}>{muted ? '🔊 Hang bekapcsolása' : '🔇 Hang letiltása'}</button>
            )}
            {!standalone && (
              installEv
                ? <button className="cta" onClick={async () => { installEv.prompt(); await installEv.userChoice; setInstallEv(null) }}>Telepítés</button>
                : <button onClick={() => location.assign('/telepites')}>Telepítés</button>
            )}
            <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer" className="btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 12px', borderRadius: 12, border: '1px solid var(--line)', background: 'rgba(88,101,242,.2)' }} title="Csatlakozz a SuliBell Discord szerverhez">💬 Discord</a>
            <button className={hasMySchedule ? 'on' : ''} onClick={() => setMyModalOpen(true)} title="Saját tantárgyak és termek beállítása">📚 Saját óráim</button>
            <NotifyButton schoolId={data.id} />
            {data.settings.particles !== false && (
              <button className={fxOn && !potato ? 'on' : ''} onClick={() => { const v = !fxOn; localStorage.setItem('fx', v ? '1' : '0'); setFxOn(v) }} title="Háttéreffektek">✨</button>
            )}
            <button type="button" className={`potato-btn${potato ? ' on' : ''}`} onClick={togglePotato} title={potato ? 'Potato / Ratyi PC mód kikapcsolása' : 'Potato / Ratyi PC mód: minden nehéz effekt, átlátszóság és animáció kikapcsolása a maximális sebességért'}>🥔 {potato ? 'Potato: BE' : 'Potato PC'}</button>
            <button
              type="button"
              className={`adv-hdr-btn${advent.availableCount > 0 ? ' has-new' : ''}${advent.activeTheme !== 'off' ? ' on' : ''}`}
              onClick={() => setAdventModal({ open: true, tab: 'calendar' })}
              title={`Adventi Kalendárium (Nov. 29. – Dec. 24.) • ${advent.litCandles}/4 gyertya ég`}
            >
              <span aria-hidden="true">🎁</span>
              <span>Advent</span>
              <AdventWreathIcon litCount={advent.litCandles} size="sm" />
              {advent.availableCount > 0 && <b className="adv-dot">{advent.availableCount}</b>}
            </button>
            {data.settings.particles !== false && !potato && (
              <button
                type="button"
                className={`snow-hdr-btn${advent.state.snowEnabled ? ' on' : ''}`}
                onClick={() => handleToggleSnow()}
                title={advent.state.snowEnabled ? 'Hóesés effekt kikapcsolása' : 'Hóesés háttéreffekt bekapcsolása'}
                aria-label="Hóesés háttéreffekt kapcsolása"
              >
                ❄️
              </button>
            )}
            <button
              type="button"
              className={`layout-btn${layoutMode === 'tabbed' ? ' on' : ''}`}
              onClick={toggleLayoutMode}
              title={
                layoutMode === 'tabbed'
                  ? 'Visszaváltás a klasszikus, egyoldalas nézetre (elmentve a böngészőben)'
                  : 'Váltás a gyorsabb, többmenüs nézetre (elmentve a böngészőben)'
              }
            >
              {layoutMode === 'tabbed' ? '🧩 Sima nézet' : '📑 Menüs nézet'}
            </button>
            <button onClick={() => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('theme', t); setTheme(t) }}>Téma</button>
            <button
              type="button"
              className={`vip-hdr-btn${vip.status.active ? ' on' : ''}`}
              onClick={() => setVipModal({ open: true, tab: 'vip' })}
              title={vip.status.active ? 'VIP Extrák & Támogatók fala' : 'VIP kód feloldása & Támogatók fala'}
              aria-label={vip.status.active ? 'VIP Extrák megnyitása' : 'VIP feloldás megnyitása'}
            >
              {vip.status.active ? '👑' : '🔑'}
            </button>
          </div>
        </header>

        {layoutMode === 'classic' ? (
          /* KLASSZIKUS (SIMA) 3 OSZLOPOS BENTO MŰSZERFAL — MENÜK NÉLKÜL */
          <div className="dash-grid">
            {/* 1. OSZLOP (BAL): Fő visszaszámláló + Napsáv + Gyors statisztika + Következő csengetések */}
            <div className="dash-col col-hero">
              <section className={`panel now ${s.phase}${lastMinuteGlow ? ' vip-last-min' : ''}`}>
                <div className="tag">Most</div>
                <Ring s={s} my={myCur} lastMin={lastMinuteGlow} christmas={isXmasSkin} />
                {isXmasSkin && (s.phase === 'lesson' || s.phase === 'break' || s.phase === 'before') && (
                  <div className="xmas-bar" aria-hidden="true"><i style={{ width: `${Math.round(s.progress * 100)}%` }} /></div>
                )}
                {pv && first
                  ? <NextDay label={dayName(pv.date, { weekday: 'long' })} time={fmtHM(first.start_time)} until={until} />
                  : <Next s={s} secs={z.secs} my={myNext} />}
                <SupporterTicker supporters={sup.withMessages} onOpenWall={() => setVipModal({ open: true, tab: 'supporters' })} />
                {strip && <div className="hero-strip">{strip}</div>}
                {stats && <div className="hero-stats">{stats}</div>}
                {bells}
              </section>
            </div>

            {/* 2. OSZLOP (KÖZÉP): Mai napirend, változások, szüneti zene / pihenő mód, heti áttekintés */}
            <div className="dash-col col-schedule">
              {changesBox}
              {vid}
              {restBox}

              <WinterBreakStrip
                serverDate={advent.serverDate}
                schoolDaysLeft={winterBreak.schoolDaysLeft}
                hoursLeft={winterBreak.hoursLeft}
                isLastDay={winterBreak.isLastDay}
                started={winterBreak.started}
                onOpenAdvent={() => setAdventModal({ open: true, tab: 'calendar' })}
              />

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
                      const isCanc = s.phase !== 'closed' && cancelledIds.has(l.id)
                      const cls = isCanc ? 'cancelled' : s.current?.id === l.id ? 'now' : s.next?.id === l.id ? 'upnext' : s.phase !== 'closed' && z.secs >= toSec(l.end_time) ? 'past' : ''
                      const gap = nx ? Math.round((toSec(nx.start_time) - toSec(l.end_time)) / 60) : 0
                      const inBreak = s.phase === 'break' && s.next?.id === nx?.id
                      const custom = formatMyLesson(l, getEntry(boardWeekday, l.position))
                      return (
                        <Fragment key={l.id}>
                          <li className={`l ${cls} ${custom.isFree || isCanc ? 'free' : ''}`} style={p(cls === 'now')}>
                            <div className="l-main">
                              <b>{custom.title}</b>
                              {custom.sub && <small className="l-orig">{custom.sub}</small>}
                              {custom.room && <span className="room-pill">📍 {fmtRoom(custom.room)}</span>}
                            </div>
                            <span className="t">{fmtHM(l.start_time)} – {fmtHM(l.end_time)}</span>
                            <span className="chip">{CHIP[cls] ?? (custom.isFree ? 'elmarad' : '')}</span>
                          </li>
                          {gap > 0 && <li className={`g ${inBreak ? 'nowb' : ''}`} style={p(inBreak)}>{gap} perc szünet</li>}
                        </Fragment>
                      )
                    })}
                  </ol>
                </section>
              )}

              <section className="panel week-panel">
                <div className="tag">E heti naptár</div>
                <div className="week">
                  {week.map(w => (
                    <div key={w.date} className={`wd ${w.date === z.date ? 'today' : ''} ${w.dim ? 'off' : ''}`}>
                      <b>{dayName(w.date, { weekday: 'long' })}</b>
                      <small>{dayName(w.date, { month: 'long', day: 'numeric' })}</small>
                      {w.info && <span>{w.info}</span>}
                    </div>
                  ))}
                </div>
                {yearBox}
              </section>

              {lunchBox}

              {notes.length > 0 && (
                <section className="panel">
                  <div className="tag">Közlemények</div>
                  {notes.slice(0, 4).map(n => <p className="notice" key={n.id}>{n.text}</p>)}
                </section>
              )}

              <Daily day={z.date} />

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

            {/* 3. OSZLOP (JOBB): Ko-fi Támogatás, Élő Hangulatfal, Zenegép, Mini-Aréna, Szavazás */}
            <div className="dash-col col-side">
              {kofiBox}
              <VibePanel counts={vibeCounts} onSend={sendVibe} cooldown={vibeCooldown} christmas={isXmasSkin} />

              <Jukebox schoolId={data.id} day={z.date} breakKey={curJukeboxBreakKey} sound={!!data.settings.sound_enabled && audioOn} christmas={isXmasSkin} />

              <Suspense fallback={null}>
                <Arena schoolId={data.id} day={z.date} phase={s.phase} breakKey={curBreakKey} breakTotalSec={breakTotalSec} sound={!!data.settings.sound_enabled && audioOn} />
              </Suspense>

              {pollCard}
              {partnersBox}
              <FeedbackPanel />
            </div>
          </div>
        ) : (
          <>
        {/* Felső menüsáv: külön oldalakra bontva a gyorsabb, lagg-mentes működésért */}
        <nav className="app-nav" aria-label="Oldal menü">
          <button
            type="button"
            className={`nav-tab${activeTab === 'home' ? ' on' : ''}`}
            aria-current={activeTab === 'home' ? 'page' : undefined}
            onClick={() => navigateTab('home')}
          >
            <span className="nav-ico" aria-hidden="true">⏱️</span>
            <span>Főoldal</span>
          </button>
          <button
            type="button"
            className={`nav-tab${activeTab === 'schedule' ? ' on' : ''}`}
            aria-current={activeTab === 'schedule' ? 'page' : undefined}
            onClick={() => navigateTab('schedule')}
          >
            <span className="nav-ico" aria-hidden="true">📅</span>
            <span>Órarend</span>
            {chgs.length > 0 && <b className="nav-badge warn">{chgs.length}</b>}
          </button>
          <button
            type="button"
            className={`nav-tab${activeTab === 'games' ? ' on' : ''}`}
            aria-current={activeTab === 'games' ? 'page' : undefined}
            onClick={() => navigateTab('games')}
          >
            <span className="nav-ico" aria-hidden="true">🎮</span>
            <span>Játékok</span>
            {(s.phase === 'break' || s.phase === 'closed') && (
              <b className="nav-badge live">{s.phase === 'closed' ? 'Pihi' : 'Szünet'}</b>
            )}
          </button>
          <button
            type="button"
            className={`nav-tab${activeTab === 'media' ? ' on' : ''}`}
            aria-current={activeTab === 'media' ? 'page' : undefined}
            onClick={() => navigateTab('media')}
          >
            <span className="nav-ico" aria-hidden="true">🎵</span>
            <span>Zenegép</span>
            {s.phase === 'break' && <b className="nav-badge live">ÉLŐ</b>}
          </button>
        </nav>

        {/* Kompakt élő visszaszámláló sáv az aloldalakon, hogy minden menüben látszódjon a csengő */}
        {activeTab !== 'home' && (() => {
          const curCustom = s.phase === 'lesson' ? formatMyLesson(s.current, myCur) : null
          const miniTitle = s.phase === 'lesson' ? (curCustom?.title || s.current!.label) : (s.reason || TITLE[s.phase])
          const isLive = s.phase === 'lesson' || s.phase === 'break' || s.phase === 'before'
          return (
            <div className={`mini-bell-bar ${s.phase}`}>
              <div className="mini-bell-left">
                <i className="mini-dot" aria-hidden="true" />
                <b>{miniTitle}</b>
                {isLive && (
                  <span className="mini-count">
                    {fmtCount(s.remaining)} <small>{s.phase === 'before' ? 'az 1. óráig' : 'a csengetésig'}</small>
                  </span>
                )}
              </div>
              <button type="button" className="mini-home-btn" onClick={() => navigateTab('home')}>
                ← Nagy óra
              </button>
            </div>
          )
        })()}

        {/* 1. MENÜ: FŐOLDAL (Ultragyors: Visszaszámláló + Téli szünet + Változások/Ebéd/Közlemény + Ko-fi) */}
        {activeTab === 'home' && (
          <div className="home-grid">
            <div className="dash-col col-hero">
              <section className={`panel now ${s.phase}${lastMinuteGlow ? ' vip-last-min' : ''}`}>
                <div className="tag">Most</div>
                <Ring s={s} my={myCur} lastMin={lastMinuteGlow} christmas={isXmasSkin} />
                {isXmasSkin && (s.phase === 'lesson' || s.phase === 'break' || s.phase === 'before') && (
                  <div className="xmas-bar" aria-hidden="true"><i style={{ width: `${Math.round(s.progress * 100)}%` }} /></div>
                )}
                {pv && first
                  ? <NextDay label={dayName(pv.date, { weekday: 'long' })} time={fmtHM(first.start_time)} until={until} />
                  : <Next s={s} secs={z.secs} my={myNext} />}
                <SupporterTicker supporters={sup.withMessages} onOpenWall={() => setVipModal({ open: true, tab: 'supporters' })} />
                {strip && <div className="hero-strip">{strip}</div>}
                {stats && <div className="hero-stats">{stats}</div>}
                {bells}
              </section>
            </div>

            <div className="dash-col col-home-side">
              <WinterBreakStrip
                serverDate={advent.serverDate}
                schoolDaysLeft={winterBreak.schoolDaysLeft}
                hoursLeft={winterBreak.hoursLeft}
                isLastDay={winterBreak.isLastDay}
                started={winterBreak.started}
                onOpenAdvent={() => setAdventModal({ open: true, tab: 'calendar' })}
              />

              {changesBox}
              {lunchBox}

              {notes.length > 0 && (
                <section className="panel">
                  <div className="tag">Közlemények</div>
                  {notes.slice(0, 4).map(n => <p className="notice" key={n.id}>{n.text}</p>)}
                </section>
              )}

              {/* Ko-fi marad a főoldalon, hogy rögtön felkeltse a figyelmet */}
              {kofiBox}

              {/* Élő Hangulat- és Reakciófal a főoldalon */}
              <VibePanel counts={vibeCounts} onSend={sendVibe} cooldown={vibeCooldown} christmas={isXmasSkin} />

              {/* A nap gondolata / érdekesség a főoldalon */}
              <Daily day={z.date} />

              {/* Közelgő szünetek és ünnepek a főoldalon */}
              {(events.length > 0 || offCard) && (
                <section className="events-side">
                  <div className="tag wide">Közelgő szünetek és ünnepek</div>
                  <div className="events">
                    {events.map(evCard)}
                    {offCard}
                  </div>
                </section>
              )}

              {/* Társoldalak és hasznos linkek a főoldalon */}
              {partnersBox}

              {/* Hibajelentés & Ötletek a főoldalon */}
              <FeedbackPanel />

              <section className="panel quick-nav-card">
                <div className="tag" style={{ marginBottom: 8 }}>🚀 Gyors ugrás más menükre</div>
                <div className="quick-nav-btns">
                  <button type="button" onClick={() => navigateTab('schedule')}>
                    <span>📅</span>
                    <div>
                      <b>Órarend &amp; Naptár</b>
                      <small>{L.length > 0 ? `${L.length} óra • vízszintes órarend & heti rend` : 'Vízszintes heti naptár'}</small>
                    </div>
                    <i>→</i>
                  </button>
                  <button type="button" onClick={() => navigateTab('games')}>
                    <span>🎮</span>
                    <div>
                      <b>Játékok &amp; Szavazás</b>
                      <small>{s.phase === 'closed' ? 'Snake / ünnepi játék + Mini-Aréna' : 'Szüneti Mini-Aréna & Szavazás'}</small>
                    </div>
                    <i>→</i>
                  </button>
                  <button type="button" onClick={() => navigateTab('media')}>
                    <span>🎵</span>
                    <div>
                      <b>Szüneti Zenegép</b>
                      <small>{s.phase === 'break' ? 'Szünet van — nyisd meg a lejátszót!' : 'Kívánságlista & szavazás'}</small>
                    </div>
                    <i>→</i>
                  </button>
                </div>
              </section>
            </div>
          </div>
        )}

        {/* 2. MENÜ: VÍZSZINTES ÓRAREND & NAPTÁR */}
        {activeTab === 'schedule' && (
          <div className="page-schedule-h">
            <WinterBreakStrip
              serverDate={advent.serverDate}
              schoolDaysLeft={winterBreak.schoolDaysLeft}
              hoursLeft={winterBreak.hoursLeft}
              isLastDay={winterBreak.isLastDay}
              started={winterBreak.started}
              onOpenAdvent={() => setAdventModal({ open: true, tab: 'calendar' })}
            />

            {changesBox}

            {L.length > 0 && (
              <section className="panel board board-horiz">
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
                <ol className="horiz-lessons">
                  {L.map((l: any, i: number) => {
                    const nx = L[i + 1]
                    const isCanc = s.phase !== 'closed' && cancelledIds.has(l.id)
                    const cls = isCanc ? 'cancelled' : s.current?.id === l.id ? 'now' : s.next?.id === l.id ? 'upnext' : s.phase !== 'closed' && z.secs >= toSec(l.end_time) ? 'past' : ''
                    const gap = nx ? Math.round((toSec(nx.start_time) - toSec(l.end_time)) / 60) : 0
                    const inBreak = s.phase === 'break' && s.next?.id === nx?.id
                    const custom = formatMyLesson(l, getEntry(boardWeekday, l.position))
                    return (
                      <Fragment key={l.id}>
                        <li className={`l ${cls} ${custom.isFree || isCanc ? 'free' : ''}`} style={p(cls === 'now')}>
                          <div className="lh-top">
                            <span className="t">{fmtHM(l.start_time)} – {fmtHM(l.end_time)}</span>
                            <span className="chip">{CHIP[cls] ?? (custom.isFree ? 'elmarad' : '')}</span>
                          </div>
                          <div className="l-main">
                            <b>{custom.title}</b>
                            {custom.sub && <small className="l-orig">{custom.sub}</small>}
                            {custom.room && <span className="room-pill">📍 {fmtRoom(custom.room)}</span>}
                          </div>
                        </li>
                        {gap > 0 && (
                          <li className={`g ${inBreak ? 'nowb' : ''}`} style={p(inBreak)} title={`${gap} perc szünet`}>
                            <span>{gap}p</span>
                          </li>
                        )}
                      </Fragment>
                    )
                  })}
                </ol>
              </section>
            )}

            <section className="panel week-panel week-horiz">
              <div className="tag">E heti naptár</div>
              <div className="week">
                {week.map(w => (
                  <div key={w.date} className={`wd ${w.date === z.date ? 'today' : ''} ${w.dim ? 'off' : ''}`}>
                    <b>{dayName(w.date, { weekday: 'long' })}</b>
                    <small>{dayName(w.date, { month: 'long', day: 'numeric' })}</small>
                    {w.info && <span>{w.info}</span>}
                  </div>
                ))}
              </div>
              {yearBox}
            </section>

            {lunchBox}
          </div>
        )}

        {/* 3. MENÜ: JÁTÉKOK (Lazy-loaded, csak itt fut az Aréna, Snake és Szavazás) */}
        {activeTab === 'games' && (
          <Suspense fallback={<section className="panel page-loading">🎮 Játékok betöltése…</section>}>
            <GamesPage
              schoolId={data.id}
              day={z.date}
              phase={s.phase}
              reason={s.reason}
              breakKey={curBreakKey}
              breakTotalSec={breakTotalSec}
              sound={!!data.settings.sound_enabled && audioOn}
              restEnabled={data.settings.rest_mode !== false}
              restEv={restEv}
            />
          </Suspense>
        )}

        {/* 4. MENÜ: ZENEGÉP (Lazy-loaded, csak itt fut a Jukebox és a BreakVideo zenelejátszó) */}
        {activeTab === 'media' && (
          <Suspense fallback={<section className="panel page-loading">🎵 Zenegép betöltése…</section>}>
            <MediaPage
              schoolId={data.id}
              day={z.date}
              phase={s.phase}
              breakKey={curJukeboxBreakKey}
              videoBreakKey={s.next?.id ?? key}
              breakMusicEnabled={data.settings.break_videos !== false}
              sound={!!data.settings.sound_enabled && audioOn}
              userMuted={muted}
              christmas={isXmasSkin}
              sandboxDemo={sandbox ? { forceBreakMedia: sb.forceBreakMedia } : undefined}
            />
          </Suspense>
        )}
          </>
        )}

        <footer className="foot">
          {data.settings.site_version && <span className="ver">Verzió {data.settings.site_version}</span>}
          {data.settings.version_note && <span>{data.settings.version_note}</span>}
          <span className="copy">© 2026 Finta Benjámin • SuliBell • Minden jog fenntartva (All Rights Reserved)</span>
        </footer>
        {data.settings.ask_enabled && (
          <Suspense fallback={null}>
            <Ask />
          </Suspense>
        )}
        <VipModal
          open={vipModal.open}
          initialTab={vipModal.tab}
          onClose={() => setVipModal(prev => ({ ...prev, open: false }))}
          kofiUrl={kofiHref}
          customBellUrl={data.settings.bell_sound_url}
          muted={muted}
          vipStatus={vip.status}
          vipPrefs={vip.prefs}
          onUnlock={vip.unlockWithCode}
          onUpdatePrefs={handleUpdateVipPrefs}
          onResetVip={vip.resetVip}
          supporters={sup.supporters}
          topClass={sup.topClass}
          supportersLoading={sup.loading}
        />
        <AdventModal
          open={adventModal.open}
          initialTab={adventModal.tab}
          onClose={() => setAdventModal(prev => ({ ...prev, open: false }))}
          state={advent.state}
          unlocked={advent.unlocked}
          activeTheme={advent.activeTheme}
          santaFrameActive={advent.santaFrameActive}
          effectiveBell={advent.effectiveBell}
          serverDate={advent.serverDate}
          serverSynced={advent.serverSynced}
          litCandles={advent.litCandles}
          potato={potato}
          muted={muted}
          customBellUrl={data.settings.bell_sound_url}
          onOpenDoor={advent.openDoor}
          onSetThemeMode={handleSetHolidayTheme}
          onToggleSnow={handleToggleSnow}
          onToggleSantaFrame={advent.toggleSantaFrame}
          onToggleSnakeSkin={advent.toggleSnakeSkin}
          onSetHolidayBell={advent.setHolidayBell}
        />
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
      <FlyingSleighTop enabled={showXmasAfterDec5} fastPreview={xmasPreviewActive} />
      {maintPrepBanner}
      {maintOverlay}
      {!potato && (layoutMode === 'classic' || activeTab === 'home') && <VibeOverlay floats={vibeFloats} />}
      {fx && <Fx phase={s.phase} bellKey={key} day={z.date} tv={tv} wx={wx?.c} night={isNight} sound={!!data.settings.sound_enabled && audioOn} festiveSnow={advent.state.snowEnabled && !potato} />}
      <Celebrate enabled={fx} sound={!!data.settings.sound_enabled && audioOn} phase={s.phase} day={z.date} awayDays={pv ? Math.round((tms(pv.date) - tms(z.date)) / 86400000) : 0} events={events} />
      {fx && <FinalCount phase={s.phase} remaining={Math.ceil(s.remaining)} />}
      {fx && <BellFlash bellKey={key} day={z.date} phase={s.phase} label={s.current?.label} />}
      {!isUpdating && !overlay && !adventModal.open && !vipModal.open && !myModalOpen && (
        <ScrollCue layoutKey={`${layoutMode}:${activeTab}`} />
      )}
    </>
  )
}
