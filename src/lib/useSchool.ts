import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, SCHOOL_SLUG } from './supabase'
import type { Schedule } from './engine'
import type { Countdown } from './kinds'

export interface SchoolData {
  id?: string
  name: string
  settings: {
    timezone: string
    theme: 'dark' | 'light'
    sound_enabled: boolean
    logo_url: string | null
    tv_show_seconds: boolean
    tv_show_next: boolean
    tv_scale: number
    site_version: string
    version_note: string
    alert_text: string
    alert_active: boolean
    lunch_after: number | null
    year_start: string | null
    year_end: string | null
    weather_enabled: boolean
    weather_city: string
    weather_lat: number | null
    weather_lon: number | null
    tv_show_qr: boolean
    bell_sound_url: string | null
    particles?: boolean
    break_videos?: boolean
    rest_mode?: boolean
    ask_enabled?: boolean
    preview_disabled?: boolean
  }
  schedules: Schedule[]
  closed: { day: string; reason: string }[]
  countdowns: Countdown[]
  announcements: { id: string; text: string; active_until: string | null }[]
  schedule_dates: { id: string; day: string; schedule_id: string }[]
  changes: { id: string; day: string; kind: string; lesson_label: string; text: string }[]
  menus: { id: string; day: string; text: string }[]
}

const KEY = 'csengeto-cache-v1'
const REV_KEY = 'csengeto-admin-rev'
const GLOBAL_CHANNEL = `sulibell-global-${SCHOOL_SLUG}`
const one = <T,>(x: T | T[]) => (Array.isArray(x) ? x[0] : x)

function normalizeRow(row: any): SchoolData {
  return {
    id: row.id,
    name: row.name,
    settings: one(row.settings as any),
    schedules: row.schedules ?? [],
    closed: (row.closed_days ?? row.closed ?? []).map((c: any) => ({ day: c.day, reason: c.reason })),
    countdowns: row.countdowns ?? [],
    announcements: row.announcements ?? [],
    schedule_dates: row.schedule_dates ?? [],
    changes: row.changes ?? [],
    menus: row.menus ?? [],
  }
}

async function fetchFreshSchool(): Promise<SchoolData | null> {
  const { data: row, error } = await supabase
    .from('schools')
    .select('id, name, settings(*), schedules(*, lessons(*)), closed_days(day, reason), countdowns(*), announcements(*), schedule_dates(*), changes(*), menus(*)')
    .eq('slug', SCHOOL_SLUG)
    .single()
  if (error || !row) return null
  const d = normalizeRow(row)
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch { /* ignore */ }
  return d
}

/**
 * Admin oldalon használt élő csatorna: amikor az admin bármit ment vagy módosít,
 * azonnal jelez minden nyitott főoldalnak és /display kijelzőnek, hogy frissüljenek.
 */
export function useAdminBroadcaster() {
  const chanRef = useRef<any>(null)
  const bcRef = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    const ch = supabase.channel(GLOBAL_CHANNEL, {
      config: { broadcast: { self: false } },
    })
    ch.subscribe()
    chanRef.current = ch

    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel(GLOBAL_CHANNEL)
      bcRef.current = bc
    } catch { /* ignore */ }

    return () => {
      supabase.removeChannel(ch)
      chanRef.current = null
      try { bc?.close() } catch { /* ignore */ }
      bcRef.current = null
    }
  }, [])

  const notifyAllClients = useCallback((freshRow?: any) => {
    const ts = Date.now()
    if (freshRow) {
      try {
        localStorage.setItem(KEY, JSON.stringify(normalizeRow(freshRow)))
      } catch { /* ignore */ }
    }
    try {
      localStorage.setItem(REV_KEY, String(ts))
    } catch { /* ignore */ }
    try {
      bcRef.current?.postMessage({ type: 'admin_change', ts })
    } catch { /* ignore */ }
    chanRef.current?.send({
      type: 'broadcast',
      event: 'admin_change',
      payload: { ts },
    }).catch?.(() => {})
  }, [])

  return { notifyAllClients }
}

/**
 * Betölti az iskola adatait; ha az admin bármit módosít az oldalon,
 * azonnal letölti a friss adatokat és újratölti az oldalt mindenkinél.
 */
export function useSchool() {
  const [data, setData] = useState<SchoolData | null>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null }
  })
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fingerprintRef = useRef<string>('')
  const versionRef = useRef<string>('')
  const reloadingRef = useRef(false)

  useEffect(() => {
    let alive = true
    let retryTimer = 0
    const isAdminPage = location.pathname.startsWith('/admin') || location.pathname.startsWith('/teszt')

    const load = async (broadcastRefresh = true, allowRetry = false) => {
      clearTimeout(retryTimer)
      const d = await fetchFreshSchool()
      if (!alive) return
      if (!d) {
        setOffline(true)
        setError('Nincs kapcsolat')
        if (allowRetry && !document.hidden) {
          retryTimer = window.setTimeout(() => { if (alive) load(broadcastRefresh, false) }, 1500)
        }
        return
      }

      const nextVer = String(d.settings?.site_version ?? '')
      const prevVer = versionRef.current
      versionRef.current = nextVer

      // Csak akkor töltjük újra a teljes oldalt, ha az admin ténylegesen verziót frissített
      if (prevVer && nextVer && prevVer !== nextVer && !isAdminPage && !reloadingRef.current) {
        reloadingRef.current = true
        setTimeout(() => { reloadingRef.current = false }, 5000)
        location.reload()
        return
      }

      const nextFp = JSON.stringify(d)
      const changed = fingerprintRef.current !== nextFp
      fingerprintRef.current = nextFp

      setData(d)
      setOffline(false)
      setError(null)
      if (changed || broadcastRefresh) {
        window.dispatchEvent(new Event('sulibell:refresh'))
      }
    }

    load(true, true)

    // 10 másodpercenként háttér-ellenőrzés (csak ha az ablak látható, így kíméli a hálózatot és a CPU-t)
    const t = setInterval(() => {
      if (!document.hidden) load(false)
    }, 10_000)

    const onResume = () => {
      if (!document.hidden) load(true, true)
    }
    const onOnline = () => load(true, true)
    const onStorage = (e: StorageEvent) => {
      if (e.key === REV_KEY && e.newValue) {
        load(true)
      }
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('focus', onResume)
    window.addEventListener('pageshow', onResume)
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onResume)
    document.addEventListener('resume', onResume)

    // Élő Supabase Realtime csatorna az azonnali admin-frissítéshez
    const ch = supabase.channel(GLOBAL_CHANNEL, {
      config: { broadcast: { self: false } },
    })
    ch.on('broadcast', { event: 'admin_change' }, () => {
      if (!alive) return
      load(true)
    })
    ch.subscribe()

    const pgCh = supabase
      .channel(`sulibell-global-pg-${SCHOOL_SLUG}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        if (!alive) return
        load(false)
      })
      .subscribe()

    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel(GLOBAL_CHANNEL)
      bc.onmessage = ev => {
        if (!alive) return
        if (ev.data?.type === 'admin_change') {
          load(true)
        }
      }
    } catch { /* ignore */ }

    return () => {
      alive = false
      clearInterval(t)
      clearTimeout(retryTimer)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('focus', onResume)
      window.removeEventListener('pageshow', onResume)
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onResume)
      document.removeEventListener('resume', onResume)
      supabase.removeChannel(ch)
      supabase.removeChannel(pgCh)
      try { bc?.close() } catch { /* ignore */ }
    }
  }, [])

  return { data, offline, error }
}
