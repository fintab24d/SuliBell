import { useMemo, useRef } from 'react'
import type { SongWish } from '../Jukebox'
import { instantOf, zoned } from './engine'
import {
  computeMusicTimeline,
  fallbackRadioAt,
  fallbackUpcomingRadio,
  type MusicSlot,
  type MusicWindow,
  type SyncTrack,
  type SyncWish,
} from './musicSync'
import { getDailyRadioPlaylist, type RadioTrack } from './radio'

export interface MusicSyncResult {
  current?: MusicSlot
  upcoming: MusicSlot[]
  startedWishIds: Set<string>
  nowPlayingWishId?: string
  slotStartMs?: number
  slotEndMs?: number
}

const EMPTY_WISH_SET = new Set<string>()
const EMPTY_UPCOMING: MusicSlot[] = []

function sameSlot(a: MusicSlot | undefined, b: MusicSlot | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.kind === b.kind &&
    a.start === b.start &&
    a.end === b.end &&
    a.wishId === b.wishId &&
    a.track.id === b.track.id &&
    a.track.ytId === b.track.ytId &&
    a.track.title === b.track.title &&
    a.track.by === b.track.by &&
    a.track.vip === b.track.vip
  )
}

function sameUpcoming(a: MusicSlot[], b: MusicSlot[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!sameSlot(a[i], b[i])) return false
  }
  return true
}

function sameStringSet(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
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
        ...(w.vip ? { vip: true } : {}),
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

  const prevRef = useRef<MusicSyncResult>({
    upcoming: EMPTY_UPCOMING,
    startedWishIds: EMPTY_WISH_SET,
  })

  return useMemo<MusicSyncResult>(() => {
    if (!day || !radio.length) {
      const emptyRes: MusicSyncResult = { upcoming: EMPTY_UPCOMING, startedWishIds: EMPTY_WISH_SET }
      prevRef.current = emptyRes
      return emptyRes
    }
    if (!enabled && syncWishes.length === 0) {
      const prev = prevRef.current
      if (!prev.current && prev.upcoming.length === 0 && prev.startedWishIds.size === 0) {
        return prev
      }
      const idleRes: MusicSyncResult = { upcoming: EMPTY_UPCOMING, startedWishIds: EMPTY_WISH_SET }
      prevRef.current = idleRes
      return idleRes
    }

    const { current: timelineSlot, upcoming: timelineUpcoming, startedWishIds: rawStarted } = computeMusicTimeline({
      windows,
      wishes: syncWishes,
      radio,
      nowSec: secs,
    })
    const current = enabled ? (timelineSlot ?? fallbackRadioAt(radio, secs)) : undefined
    const rawUpcoming = enabled
      ? (timelineSlot ? timelineUpcoming : fallbackUpcomingRadio(radio, secs, 3))
      : EMPTY_UPCOMING
    const slotStartMs = current ? instantOf(day, current.start, tz) : undefined
    const slotEndMs = current ? instantOf(day, current.end, tz) : undefined
    const nowPlayingWishId = current?.kind === 'wish' ? current.wishId : undefined

    const prev = prevRef.current
    const startedWishIds =
      rawStarted.size === 0
        ? EMPTY_WISH_SET
        : sameStringSet(prev.startedWishIds, rawStarted)
          ? prev.startedWishIds
          : rawStarted
    const upcoming =
      rawUpcoming.length === 0
        ? EMPTY_UPCOMING
        : sameUpcoming(prev.upcoming, rawUpcoming)
          ? prev.upcoming
          : rawUpcoming

    if (
      sameSlot(prev.current, current) &&
      prev.upcoming === upcoming &&
      prev.startedWishIds === startedWishIds &&
      prev.nowPlayingWishId === nowPlayingWishId &&
      prev.slotStartMs === slotStartMs &&
      prev.slotEndMs === slotEndMs
    ) {
      return prev
    }

    const next: MusicSyncResult = {
      current,
      upcoming,
      startedWishIds,
      nowPlayingWishId,
      slotStartMs,
      slotEndMs,
    }
    prevRef.current = next
    return next
  }, [day, tz, secs, windows, syncWishes, radio, enabled])
}
