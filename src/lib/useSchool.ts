import { useEffect, useState } from 'react'
import { supabase, SCHOOL_SLUG } from './supabase'
import type { Schedule } from './engine'
import type { Countdown } from './kinds'

export interface SchoolData {
  id?: string
  name: string
  settings: { timezone: string; theme: 'dark' | 'light'; sound_enabled: boolean; logo_url: string | null; tv_show_seconds: boolean; tv_show_next: boolean; tv_scale: number; site_version: string; version_note: string; alert_text: string; alert_active: boolean; lunch_after: number | null; year_start: string | null; year_end: string | null; weather_enabled: boolean; weather_city: string; weather_lat: number | null; weather_lon: number | null; tv_show_qr: boolean; bell_sound_url: string | null }
  schedules: Schedule[]
  closed: { day: string; reason: string }[]
  countdowns: Countdown[]
  announcements: { id: string; text: string; active_until: string | null }[]
  schedule_dates: { id: string; day: string; schedule_id: string }[]
  changes: { id: string; day: string; kind: string; lesson_label: string; text: string }[]
  menus: { id: string; day: string; text: string }[]
}
const KEY = 'csengeto-cache-v1'
const one = <T,>(x: T | T[]) => (Array.isArray(x) ? x[0] : x)

/** Betölti az iskola adatait; hálózati hiba esetén az utolsó mentett példánnyal megy tovább (offline mód). */
export function useSchool() {
  const [data, setData] = useState<SchoolData | null>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null }
  })
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const { data: row, error: err } = await supabase
        .from('schools')
        .select('id, name, settings(*), schedules(*, lessons(*)), closed_days(day, reason), countdowns(*), announcements(*), schedule_dates(*), changes(*), menus(*)')
        .eq('slug', SCHOOL_SLUG).single()
      if (!alive) return
      if (err || !row) { setOffline(true); setError(err?.message ?? 'Nincs adat'); return }
      const d: SchoolData = { id: (row as any).id, name: row.name, settings: one(row.settings as any), schedules: row.schedules as any, closed: row.closed_days as any, countdowns: (row as any).countdowns ?? [], announcements: (row as any).announcements ?? [], schedule_dates: (row as any).schedule_dates ?? [], changes: (row as any).changes ?? [], menus: (row as any).menus ?? [] }
      localStorage.setItem(KEY, JSON.stringify(d))
      setData(d); setOffline(false); setError(null)
    }
    load()
    const t = setInterval(load, 5 * 60_000)           // 5 percenként szinkronizál
    window.addEventListener('online', load)           // visszatérő net esetén azonnal
    return () => { alive = false; clearInterval(t); window.removeEventListener('online', load) }
  }, [])
  return { data, offline, error }
}
