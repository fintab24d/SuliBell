import { useMemo } from 'react'
import type { SongWish } from '../Jukebox'
import { instantOf, zoned } from './engine'
import {
  computeMusicTimeline,
  fallbackRadioAt,
  type MusicSlot,
  type MusicWindow,
  type SyncTrack,
  type SyncWish,
} from './musicSync'
import { getDailyRadioPlaylist, type RadioTrack } from './radio'

export interface MusicSyncResult {
  current?: MusicSlot
  startedWishIds: Set<string>
  nowPlayingWishId?: string
  slotStartMs?: number
  slotEndMs?: number
}

export function useMusicSync(params: {
  day: string
  tz: string
  secs: number
  windows: MusicWindow[]
  wishes: SongWish[]
  ghosts: SongWish[]
  christmas: boolean
  customRadio?: RadioTrack[]
  enabled: boolean
}): MusicSyncResult {
  const { day, tz, secs, windows, wishes, ghosts, christmas, customRadio, enabled } = params

  const radio = useMemo<SyncTrack[]>(() => {
    if (!day) return []
    return getDailyRadioPlaylist(day, christmas, customRadio).map(t => ({
      id: t.id,
      title: t.title,
      ytId: t.ytId,
      by: t.addedBy,
      dur: t.dur,
    }))
  }, [day, christmas, customRadio])

  const syncWishes = useMemo<SyncWish[]>(() => {
    if (!day) return []
    const seen = new Set<string>()
    const out: SyncWish[] = []
    const toSync = (w: SongWish, removed: boolean): SyncWish | null => {
      if (!w.ytId || seen.has(w.id)) return null
      seen.add(w.id)
      let atSec = 0
      if (w.at > 0 && Number.isFinite(w.at)) {
        const z = zoned(new Date(w.at), tz)
        atSec = z.date === day ? z.secs : 0
      }
      return {
        id: w.id,
        title: w.title,
        ytId: w.ytId,
        by: w.by || undefined,
        atSec,
        ...(removed ? { removed: true } : {}),
      }
    }
    for (const w of wishes) {
      const item = toSync(w, false)
      if (item) out.push(item)
    }
    for (const g of ghosts) {
      const item = toSync(g, true)
      if (item) out.push(item)
    }
    return out
  }, [day, tz, wishes, ghosts])

  return useMemo<MusicSyncResult>(() => {
    if (!day || !radio.length) {
      return { startedWishIds: new Set<string>() }
    }
    const { current: timelineSlot, startedWishIds } = computeMusicTimeline({
      windows,
      wishes: syncWishes,
      radio,
      nowSec: secs,
    })
    const current = enabled ? (timelineSlot ?? fallbackRadioAt(radio, secs)) : undefined
    const slotStartMs = current ? instantOf(day, current.start, tz) : undefined
    const slotEndMs = current ? instantOf(day, current.end, tz) : undefined
    return {
      current,
      startedWishIds,
      nowPlayingWishId: current?.kind === 'wish' ? current.wishId : undefined,
      slotStartMs,
      slotEndMs,
    }
  }, [day, tz, secs, windows, syncWishes, radio, enabled])
}
