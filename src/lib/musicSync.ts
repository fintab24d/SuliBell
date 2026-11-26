/**
 * Központi (szerveridőhöz kötött) szüneti zene-idővonal.
 * Minden kliens ugyanabból az adatból (csengetési rend + kívánságok + rádiólista)
 * determinisztikusan kiszámolja, mi szól éppen és hol tart — így mindenkinél
 * ugyanaz a szám, ugyanannál a másodpercnél szól.
 *
 * Szándékosan nincs importja, hogy Node-tesztből is futtatható legyen.
 */

export const MUSIC_MORNING_START = 7 * 3600 + 45 * 60
export const MUSIC_AFTER_END = 15 * 3600
export const DEFAULT_TRACK_SEC = 240
export const MIN_WISH_START_SEC = 90
export const MIN_SLOT_SEC = 30

export interface MusicWindow {
  key: string
  start: number
  end: number
}

export interface SyncTrack {
  id: string
  title: string
  ytId: string
  by?: string
  dur?: number
  vip?: boolean
}

export interface SyncWish extends SyncTrack {
  atSec: number
  removed?: boolean
}

export interface MusicSlot {
  kind: 'wish' | 'radio' | 'filler'
  track: SyncTrack
  start: number
  end: number
  offset: number
  windowKey: string
  wishId?: string
}

const toSec = (t: string): number => {
  const [h, m, s] = String(t).split(':').map(Number)
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0)
}

const slotLen = (t: SyncTrack): number => Math.max(MIN_SLOT_SEC, Math.round(t.dur ?? DEFAULT_TRACK_SEC))

/** Zenei ablakok az aktív (nem elmaradó) órákból: reggel 07:45-től, szünetekben és tanítás után 15:00-ig. */
export function buildMusicWindows(lessons: { start_time: string; end_time: string }[]): MusicWindow[] {
  const L = [...lessons]
    .map(l => ({ s: toSec(l.start_time), e: toSec(l.end_time) }))
    .filter(l => l.e > l.s)
    .sort((a, b) => a.s - b.s)
  if (!L.length) return []
  const out: MusicWindow[] = []
  if (L[0].s > MUSIC_MORNING_START) out.push({ key: 'm', start: MUSIC_MORNING_START, end: L[0].s })
  for (let i = 0; i < L.length - 1; i++) {
    const a = L[i].e, b = L[i + 1].s
    if (b > a) out.push({ key: `b${i + 1}`, start: a, end: b })
  }
  const lastEnd = Math.max(...L.map(l => l.e))
  if (lastEnd < MUSIC_AFTER_END) out.push({ key: 'a', start: lastEnd, end: MUSIC_AFTER_END })
  return out
}

/**
 * Kiszámolja a napi idővonalat a megadott pillanatig.
 * - A kívánságok érkezési sorrendben szólnak, a futó szám után következnek.
 * - Kívánság csak akkor indul, ha legalább MIN_WISH_START_SEC (vagy a teljes hossza) belefér az ablakba.
 * - Törölt kívánság is megtartja a helyét (filler rádió szól helyette), így a törlés sosem tolja el az idővonalat.
 */
export function computeMusicTimeline(params: {
  windows: MusicWindow[]
  wishes: SyncWish[]
  radio: SyncTrack[]
  nowSec: number
}): { current?: MusicSlot; upcoming: MusicSlot[]; startedWishIds: Set<string> } {
  const { windows, radio, nowSec } = params
  const startedWishIds = new Set<string>()
  const upcoming: MusicSlot[] = []
  const len = radio.length
  if (!len) return { upcoming, startedWishIds }

  const pending = params.wishes
    .filter(w => !!w.ytId)
    .sort((a, b) => a.atSec - b.atSec || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  let k = 0
  let current: MusicSlot | undefined

  const wins = [...windows].sort((a, b) => a.start - b.start)
  for (const w of wins) {
    if (w.start > nowSec && upcoming.length >= 3) break
    let cursor = w.start
    let guard = 0
    while (cursor < w.end && guard++ < 500) {
      if (cursor > nowSec && upcoming.length >= 3) break
      const isPastOrCurrent = cursor <= nowSec
      let idx = pending.findIndex(p => Boolean(p.vip) && p.atSec <= cursor && w.end - cursor >= Math.min(MIN_WISH_START_SEC, slotLen(p)))
      if (idx < 0) {
        idx = pending.findIndex(p => p.atSec <= cursor && w.end - cursor >= Math.min(MIN_WISH_START_SEC, slotLen(p)))
      }
      let slot: Omit<MusicSlot, 'offset' | 'end'> & { len: number }
      if (idx >= 0) {
        const wish = pending.splice(idx, 1)[0]
        if (isPastOrCurrent) startedWishIds.add(wish.id)
        const len0 = slotLen(wish)
        if (wish.removed) {
          slot = { kind: 'filler', track: radio[(k + Math.floor(len / 2)) % len], start: cursor, windowKey: w.key, wishId: wish.id, len: len0 }
        } else {
          slot = { kind: 'wish', track: wish, start: cursor, windowKey: w.key, wishId: wish.id, len: len0 }
        }
      } else {
        const tr = radio[k % len]
        k++
        slot = { kind: 'radio', track: tr, start: cursor, windowKey: w.key, len: slotLen(tr) }
      }
      const end = Math.min(w.end, cursor + slot.len)
      if (nowSec >= cursor && nowSec < end) {
        const { len: _l, ...rest } = slot
        current = { ...rest, end, offset: nowSec - cursor }
      } else if (cursor > nowSec && upcoming.length < 3) {
        const { len: _l, ...rest } = slot
        upcoming.push({ ...rest, end, offset: 0 })
      }
      cursor = end
    }
  }
  return { current, upcoming, startedWishIds }
}

/** Tartalék: abszolút óra 07:45-től, a rádiólistát a hosszak alapján körbeforgatva. */
export function fallbackRadioAt(radio: SyncTrack[], nowSec: number): MusicSlot | undefined {
  if (!radio.length) return undefined
  const total = radio.reduce((s, t) => s + slotLen(t), 0)
  const base = MUSIC_MORNING_START
  const rel = ((nowSec - base) % total + total) % total
  let acc = 0
  for (const t of radio) {
    const l = slotLen(t)
    if (rel < acc + l) {
      const start = nowSec - (rel - acc)
      return { kind: 'radio', track: t, start, end: start + l, offset: rel - acc, windowKey: 'fallback' }
    }
    acc += l
  }
  return undefined
}

/** Tartalék következő N rádiószám, ha nincs aktív csengetési ablak. */
export function fallbackUpcomingRadio(radio: SyncTrack[], nowSec: number, count = 3): MusicSlot[] {
  if (!radio.length || count <= 0) return []
  const total = radio.reduce((s, t) => s + slotLen(t), 0)
  const base = MUSIC_MORNING_START
  const rel = ((nowSec - base) % total + total) % total
  let acc = 0
  let curIdx = 0
  let curStart = nowSec
  for (let i = 0; i < radio.length; i++) {
    const l = slotLen(radio[i])
    if (rel < acc + l) {
      curIdx = i
      curStart = nowSec - (rel - acc)
      break
    }
    acc += l
  }
  const out: MusicSlot[] = []
  let cursor = curStart + slotLen(radio[curIdx])
  for (let step = 1; step <= count; step++) {
    const t = radio[(curIdx + step) % radio.length]
    const len = slotLen(t)
    out.push({ kind: 'radio', track: t, start: cursor, end: cursor + len, offset: 0, windowKey: 'fallback' })
    cursor += len
  }
  return out
}
