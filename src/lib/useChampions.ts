import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { voterId } from '../Poll'
import { checkProfanity, isAnonymousName } from './moderation'
import {
  championsFromRpcRows,
  computeChampions,
  emptyChampionsState,
  getChampionBounds,
  type ChampionScoreRow,
  type ChampionsState,
  type ChampionTier,
} from './champions'

const FRAME_KEY = 'sulibell-champ-frame'
const SEEN_PREFIX = 'sulibell-champ-seen-'
const CHAMP_EVENT = 'sulibell:champion-change'
const LB_PREFIX = 'csengeto-arena-lb-'

function readFrameEnabled(): boolean {
  try {
    return localStorage.getItem(FRAME_KEY) !== '0'
  } catch {
    return true
  }
}

function readLocalAllScores(minStart: string, maxDay: string): ChampionScoreRow[] {
  const out: ChampionScoreRow[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(LB_PREFIX)) continue
      const d = k.slice(LB_PREFIX.length)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < minStart || d > maxDay) continue
      const arr = JSON.parse(localStorage.getItem(k) ?? '[]')
      if (!Array.isArray(arr)) continue
      for (const item of arr) {
        if (!item || !item.name || isAnonymousName(item.name) || !checkProfanity(item.name).clean || Number(item.score) <= 0) {
          continue
        }
        out.push({
          day: d,
          mode: String(item.mode || 'reflex'),
          playerId: String(item.playerId || item.name),
          name: String(item.name),
          score: Number(item.score),
          at: Number(item.at) || 0,
        })
      }
    }
  } catch { /* ignore */ }
  return out
}

export function getChampionBadge(champions: ChampionsState, playerId: string): ChampionTier | null {
  if (!playerId) return null
  if (champions.monthlyChampion?.playerId === playerId) return 'monthly'
  if (champions.weeklyChampion?.playerId === playerId) return 'weekly'
  return null
}

export function useChampions(schoolId: string | undefined, day: string, syncDom = false) {
  const [champions, setChampions] = useState<ChampionsState>(() => emptyChampionsState(day || '2026-01-01'))
  const [frameEnabled, setFrameEnabled] = useState<boolean>(readFrameEnabled)
  const [justWon, setJustWon] = useState(false)

  useEffect(() => {
    setChampions(emptyChampionsState(day || '2026-01-01'))
  }, [day])

  const refresh = useCallback(async () => {
    if (!schoolId || !day) return
    const { data, error } = await supabase.rpc('get_arena_champions', {
      p_school: schoolId,
      p_day: day,
    })
    if (!error && Array.isArray(data)) {
      setChampions(championsFromRpcRows(data as any[], day))
      return
    }

    // Tartalék régi DB migráció esetén (az update26.sql előtti állapotban)
    const b = getChampionBounds(day)
    const { data: rowsData } = await supabase
      .from('arena_scores')
      .select('day,mode,player_id,player_name,score,created_at')
      .eq('school_id', schoolId)
      .gte('day', b.minStart)
      .lte('day', day)
    const combined: ChampionScoreRow[] = readLocalAllScores(b.minStart, day)
    if (Array.isArray(rowsData)) {
      for (const r of rowsData as any[]) {
        if (!r.player_name || isAnonymousName(r.player_name) || !checkProfanity(r.player_name).clean) continue
        combined.push({
          day: String(r.day),
          mode: String(r.mode || 'reflex'),
          playerId: String(r.player_id),
          name: String(r.player_name),
          score: Number(r.score) || 0,
          at: Date.parse(r.created_at) || 0,
        })
      }
    }
    setChampions(computeChampions(combined, day))
  }, [schoolId, day])

  useEffect(() => {
    void refresh()
    const onWake = () => {
      if (!document.hidden) void refresh()
    }
    const onRefresh = () => void refresh()
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, 60_000)

    window.addEventListener('sulibell:refresh', onRefresh)
    document.addEventListener('visibilitychange', onWake)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('sulibell:refresh', onRefresh)
      document.removeEventListener('visibilitychange', onWake)
    }
  }, [refresh])

  useEffect(() => {
    const syncFrame = () => setFrameEnabled(readFrameEnabled())
    const onStorage = (e: StorageEvent) => {
      if (e.key === FRAME_KEY) syncFrame()
    }
    window.addEventListener(CHAMP_EVENT, syncFrame)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CHAMP_EVENT, syncFrame)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const previewChamp =
    import.meta.env.DEV && typeof location !== 'undefined'
      ? new URLSearchParams(location.search).get('champ')
      : null
  const previewTier: ChampionTier | null =
    previewChamp === 'monthly' ? 'monthly' : previewChamp === 'weekly' ? 'weekly' : null

  const [myId, setMyId] = useState(() => (typeof window !== 'undefined' ? voterId() : ''))

  useEffect(() => {
    const syncId = () => setMyId(voterId())
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === 'voter') syncId()
    }
    window.addEventListener('sulibell-profile-changed', syncId)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('sulibell-profile-changed', syncId)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const realTier: ChampionTier | null =
    champions.monthlyChampion?.playerId === myId
      ? 'monthly'
      : champions.weeklyChampion?.playerId === myId
        ? 'weekly'
        : null
  const myTier: ChampionTier | null = previewTier ?? realTier

  const toggleFrame = useCallback(() => {
    setFrameEnabled(prev => {
      const next = !prev
      try {
        localStorage.setItem(FRAME_KEY, next ? '1' : '0')
      } catch { /* ignore */ }
      window.dispatchEvent(new Event(CHAMP_EVENT))
      return next
    })
  }, [])

  useEffect(() => {
    if (!syncDom || typeof document === 'undefined') return
    if (myTier && frameEnabled) {
      document.documentElement.dataset.champion = myTier
    } else {
      delete document.documentElement.dataset.champion
    }
    return () => {
      delete document.documentElement.dataset.champion
    }
  }, [syncDom, myTier, frameEnabled])

  useEffect(() => {
    if (!syncDom || !myTier) {
      setJustWon(false)
      return
    }
    if (previewTier) {
      setJustWon(true)
      window.dispatchEvent(new CustomEvent('sulibell:celebrate', { detail: { kind: 'confetti', power: 1.3 } }))
      return
    }
    const key = myTier === 'monthly' ? `m-${champions.prevMonthKey}` : `w-${champions.prevWeekKey}`
    try {
      if (!localStorage.getItem(SEEN_PREFIX + key)) {
        localStorage.setItem(SEEN_PREFIX + key, '1')
        setJustWon(true)
        window.dispatchEvent(new CustomEvent('sulibell:celebrate', { detail: { kind: 'confetti', power: 1.3 } }))
      }
    } catch { /* ignore */ }
  }, [syncDom, myTier, previewTier, champions.prevMonthKey, champions.prevWeekKey])

  return {
    champions,
    myTier,
    frameEnabled,
    toggleFrame,
    justWon,
    refresh,
  }
}
