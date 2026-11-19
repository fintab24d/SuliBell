import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { serverNowMs } from './serverTime'

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
  return new Date(serverNowMs()).toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' })
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
  } catch { /* privát mód fallback */ }

  let isUnique = false
  try {
    if (!localStorage.getItem(uniqKey)) {
      isUnique = true
    }
  } catch { /* privát mód fallback */ }

  try {
    const { error } = await supabase.rpc('track_visit', {
      p_school_id: schoolId,
      p_path: norm,
      p_is_unique: isUnique,
    })
    if (!error) {
      try { sessionStorage.setItem(sessKey, '1') } catch { /* ignore */ }
      if (isUnique) {
        try { localStorage.setItem(uniqKey, '1') } catch { /* ignore */ }
      }
    }
  } catch { /* ha az update22.sql még nem futott le, ne okozzon hibát */ }
}

/** Élő online nézők követése Supabase Realtime Presence segítségével (SQL tábla nélkül is működik). */
export function useOnlinePresence(schoolId: string | undefined, kind: 'web' | 'tv' | 'admin'): OnlineCounts {
  const [counts, setCounts] = useState<OnlineCounts>({ web: 0, tv: 0, total: 0 })

  useEffect(() => {
    if (!schoolId) return
    let ch: ReturnType<typeof supabase.channel> | null = null
    try {
      const key = `${kind}_${Math.random().toString(36).slice(2, 10)}`
      ch = supabase.channel(`school-online-${schoolId}`, {
        config: { presence: { key } },
      })

      const sync = () => {
        if (!ch) return
        try {
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
        } catch { /* ignore */ }
      }

      ch.on('presence', { event: 'sync' }, sync)
        .on('presence', { event: 'join' }, sync)
        .on('presence', { event: 'leave' }, sync)
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED' && kind !== 'admin' && ch) {
            try {
              await ch.track({ kind, at: Date.now() })
            } catch { /* ignore */ }
          }
        })
    } catch { /* ignore */ }

    return () => {
      if (ch) {
        try { void supabase.removeChannel(ch) } catch { /* ignore */ }
      }
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
