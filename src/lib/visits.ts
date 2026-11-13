import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface VisitStatRow {
  day: string
  path: string
  views: number
  unique_visitors: number
}

export interface OnlineCounts {
  web: number
  tv: number
  total: number
}

function budapestDay(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' })
}

function normalizePath(p: string): string {
  if (p.startsWith('/display')) return '/display'
  if (p.startsWith('/telepites')) return '/telepites'
  return '/'
}

/** Egyszeri munkamenet-szintű látogatás rögzítése a Supabase `track_visit` RPC-vel. */
export async function trackPageVisit(schoolId: string, pathname: string): Promise<void> {
  if (!schoolId) return
  const day = budapestDay()
  const norm = normalizePath(pathname)
  const sessKey = `sb_v_sess_${day}_${norm}`
  const uniqKey = `sb_v_uniq_${day}`

  try {
    if (sessionStorage.getItem(sessKey)) return
    sessionStorage.setItem(sessKey, '1')
  } catch { /* privát mód fallback */ }

  let isUnique = false
  try {
    if (!localStorage.getItem(uniqKey)) {
      isUnique = true
      localStorage.setItem(uniqKey, '1')
    }
  } catch { /* privát mód fallback */ }

  try {
    await supabase.rpc('track_visit', {
      p_school_id: schoolId,
      p_path: norm,
      p_is_unique: isUnique,
    })
  } catch { /* ha az update22.sql még nem futott le, ne okozzon hibát */ }
}

/** Élő online nézők követése Supabase Realtime Presence segítségével (SQL tábla nélkül is működik). */
export function useOnlinePresence(schoolId: string | undefined, kind: 'web' | 'tv' | 'admin'): OnlineCounts {
  const [counts, setCounts] = useState<OnlineCounts>({ web: 0, tv: 0, total: 0 })

  useEffect(() => {
    if (!schoolId) return
    const key = `${kind}_${Math.random().toString(36).slice(2, 10)}`
    const ch = supabase.channel(`school-online-${schoolId}`, {
      config: { presence: { key } },
    })

    const sync = () => {
      const state = ch.presenceState<{ kind?: string }>()
      let web = 0
      let tv = 0
      for (const entries of Object.values(state)) {
        for (const item of entries) {
          if (item.kind === 'tv') tv++
          else if (item.kind === 'web') web++
        }
      }
      setCounts({ web, tv, total: web + tv })
    }

    ch.on('presence', { event: 'sync' }, sync)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED' && kind !== 'admin') {
          try {
            await ch.track({ kind, at: Date.now() })
          } catch { /* ignore */ }
        }
      })

    return () => {
      void supabase.removeChannel(ch)
    }
  }, [schoolId, kind])

  return counts
}

/** Napi látogatottsági adatok betöltése az Admin felülethez. */
export async function loadVisitStats(schoolId: string): Promise<{ missing: boolean; rows: VisitStatRow[] }> {
  const { data, error } = await supabase
    .from('visit_stats')
    .select('day, path, views, unique_visitors')
    .eq('school_id', schoolId)
    .order('day', { ascending: false })
    .limit(90)

  if (error) {
    const code = (error as { code?: string }).code ?? ''
    if (code === '42P01' || code === 'PGRST205' || error.message.includes('visit_stats')) {
      return { missing: true, rows: [] }
    }
    return { missing: false, rows: [] }
  }
  return { missing: false, rows: (data ?? []) as VisitStatRow[] }
}
