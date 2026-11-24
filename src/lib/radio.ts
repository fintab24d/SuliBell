import { supabase } from './supabase'

/**
 * Beépített és admin által bővíthető szüneti „SuliRádió” (Auto-DJ) zenerotáció:
 * - 10 állandó alap-sláger (minden nap szerepel a műsorban)
 * - 26 rotálódó sláger, amelyből naponta 10 aktív és minden nap 4 friss dal cserélődik be
 * - ünnepi időszakban extra karácsonyi slágerek
 * - admin által (akár diák-beküldésből) felvett állandó saját dalok
 */

export type RadioTier = 'core' | 'daily' | 'xmas' | 'custom'

export interface RadioTrack {
  id: string
  title: string
  ytId: string
  artist?: string
  tier?: RadioTier
  addedBy?: string
  addedAt?: number
}

export const RADIO_PREFIX = '__RADIO__:'
const LOCAL_KEY = 'csengeto-radio-custom-v1'
let cachedCustomTracks: RadioTrack[] | null = null

export function isRadioAnnouncement(text?: string | null): boolean {
  return typeof text === 'string' && text.startsWith(RADIO_PREFIX)
}

function normalizeCustomTracks(raw: unknown): RadioTrack[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: RadioTrack[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const ytId = typeof it.ytId === 'string' ? it.ytId.trim() : ''
    const title = typeof it.title === 'string' ? it.title.trim().slice(0, 100) : ''
    if (!/^[\w-]{11}$/.test(ytId) || !title || seen.has(ytId)) continue
    seen.add(ytId)
    const addedBy =
      typeof it.addedBy === 'string' && it.addedBy.trim()
        ? it.addedBy.trim().slice(0, 40)
        : undefined
    const addedAt =
      typeof it.addedAt === 'number' && Number.isFinite(it.addedAt) && it.addedAt > 0
        ? it.addedAt
        : undefined
    out.push({
      id: typeof it.id === 'string' && it.id.trim() ? it.id.trim() : `r-custom-${ytId}`,
      title,
      ytId,
      tier: 'custom',
      ...(addedBy ? { addedBy } : {}),
      ...(addedAt ? { addedAt } : {}),
    })
  }
  return out
}

export function getCustomRadioTracks(): RadioTrack[] {
  if (cachedCustomTracks !== null) return cachedCustomTracks
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]')
    cachedCustomTracks = normalizeCustomTracks(raw)
    return cachedCustomTracks
  } catch {
    cachedCustomTracks = []
    return []
  }
}

export function parseCustomRadioFromAnnouncements(
  announcements?: { id?: string; text: string; active_until?: string | null }[] | null
): RadioTrack[] {
  if (Array.isArray(announcements)) {
    const row = announcements.find(a => isRadioAnnouncement(a?.text))
    if (row) {
      try {
        const list = normalizeCustomTracks(JSON.parse(row.text.slice(RADIO_PREFIX.length)))
        cachedCustomTracks = list
        try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)) } catch { /* ignore */ }
        return list
      } catch {
        cachedCustomTracks = []
        return []
      }
    }
    cachedCustomTracks = []
    try { localStorage.setItem(LOCAL_KEY, '[]') } catch { /* ignore */ }
    return []
  }
  return getCustomRadioTracks()
}

export async function saveCustomRadioTracksToDb(schoolId: string, tracks: RadioTrack[]) {
  const clean = normalizeCustomTracks(tracks)
  cachedCustomTracks = clean
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(clean)) } catch { /* ignore */ }
  const payload = RADIO_PREFIX + JSON.stringify(clean)

  const { data: existing } = await supabase
    .from('announcements')
    .select('id')
    .eq('school_id', schoolId)
    .like('text', `${RADIO_PREFIX}%`)

  if (existing && existing.length > 0) {
    const firstId = existing[0].id
    if (existing.length > 1) {
      await supabase
        .from('announcements')
        .delete()
        .in('id', existing.slice(1).map((r: any) => r.id))
    }
    if (clean.length === 0) {
      return supabase.from('announcements').delete().eq('id', firstId)
    }
    return supabase.from('announcements').update({ text: payload, active_until: null }).eq('id', firstId)
  } else if (clean.length > 0) {
    return supabase.from('announcements').insert({ school_id: schoolId, text: payload, active_until: null })
  }
  return { error: null }
}

export function isTrackInRadio(
  ytId: string | undefined,
  customTracks: RadioTrack[] = getCustomRadioTracks()
): boolean {
  if (!ytId) return false
  return (
    DEFAULT_RADIO_TRACKS.some(t => t.ytId === ytId) ||
    XMAS_RADIO_TRACKS.some(t => t.ytId === ytId) ||
    customTracks.some(t => t.ytId === ytId)
  )
}

/** Állandó kedvencek: minden tanítási napon szerepelnek a SuliRádió műsorában (10 sláger). */
export const CORE_RADIO_TRACKS: RadioTrack[] = [
  { id: 'r-olyan-o', title: 'Bagossy Brothers Company – Olyan Ő', ytId: 'lEU011dGjbk', artist: 'Bagossy Brothers Company', tier: 'core' },
  { id: 'r-nem-tudja', title: 'Follow The Flow – Nem tudja senki', ytId: 'lLZ-sHGcgjo', artist: 'Follow The Flow', tier: 'core' },
  { id: 'r-valami-van', title: 'Halott Pénz – Valami van a levegőben', ytId: 'ArTbyFQpQ_8', artist: 'Halott Pénz', tier: 'core' },
  { id: 'r-rakpart', title: 'Wellhello – Rakpart', ytId: 'KoViCHyvZLk', artist: 'Wellhello', tier: 'core' },
  { id: 'r-aprilis', title: 'Rúzsa Magdi – Április', ytId: 'cu7ft2Z2v3c', artist: 'Rúzsa Magdi', tier: 'core' },
  { id: 'r-3korty', title: 'Azahriah – 3korty (Clean Version)', ytId: 'rPDhFKvTO7o', artist: 'Azahriah', tier: 'core' },
  { id: 'r-meselek', title: '4S Street – Mesélek a bornak', ytId: '0ElyzQ5TeCA', artist: '4S Street', tier: 'core' },
  { id: 'r-kismadar', title: 'Republic – Szállj el kismadár', ytId: '2LkUu85JLAc', artist: 'Republic', tier: 'core' },
  { id: 'r-santamaria', title: 'Neoton Família – Santa Maria', ytId: 'DjRD1qmUkCw', artist: 'Neoton Família', tier: 'core' },
  { id: 'r-blinding', title: 'The Weeknd – Blinding Lights', ytId: 'fHI8X4OXluQ', artist: 'The Weeknd', tier: 'core' },
]

/** Naponta részben cserélődő SuliRádió-katalógus (26 sláger — naponta 10 aktív, napi 4 új dallal). */
export const ROTATING_RADIO_TRACKS: RadioTrack[] = [
  { id: 'r-visszajovok', title: 'Bagossy Brothers Company – Visszajövök', ytId: 'Qjmj9aNqgG8', artist: 'Bagossy Brothers Company', tier: 'daily' },
  { id: 'r-maradok-tavol', title: 'Follow The Flow – Maradok távol', ytId: 'gcCiQXlNJh4', artist: 'Follow The Flow', tier: 'daily' },
  { id: 'r-darabokra', title: 'Halott Pénz – Darabokra törted a szívem', ytId: 'yNnFGRXayS0', artist: 'Halott Pénz', tier: 'daily' },
  { id: 'r-elnunk-kellett', title: 'Halott Pénz – Élnünk kellett volna', ytId: 'xRGNzR34FKU', artist: 'Halott Pénz', tier: 'daily' },
  { id: 'r-ilyenek', title: 'Ákos – Ilyenek voltunk', ytId: 'URbYei513Y0', artist: 'Ákos', tier: 'daily' },
  { id: 'r-kek-hullam', title: 'Carson Coma – Kék Hullám Kemping', ytId: 'GN5FNPdfBmk', artist: 'Carson Coma', tier: 'daily' },
  { id: 'r-eso', title: 'Margaret Island – Eső', ytId: 'TNEJm6EoGCY', artist: 'Margaret Island', tier: 'daily' },
  { id: 'r-legnagyobb-hos', title: 'Honeybeast – A legnagyobb hős', ytId: '0ShzHUq_ejI', artist: 'Honeybeast', tier: 'daily' },
  { id: 'r-kedvesem', title: 'ByeAlex – Kedvesem', ytId: 'cBOmcnHMJ3E', artist: 'ByeAlex', tier: 'daily' },
  { id: 'r-lelekdonor', title: 'Caramel – Lélekdonor', ytId: 'Ed-KHp9MJ9o', artist: 'Caramel', tier: 'daily' },
  { id: 'r-kiralylany', title: 'Hooligans – Királylány', ytId: '89ikVC_Pbdo', artist: 'Hooligans', tier: 'daily' },
  { id: 'r-ahol-osszeer', title: 'Blahalouisiana – Ahol összeér', ytId: 'VExlAf6Rzyw', artist: 'Blahalouisiana', tier: 'daily' },
  { id: 'r-valahol-itt', title: 'Bagossy Brothers Company – Valahol itt', ytId: 'BkPRZgk1LDs', artist: 'Bagossy Brothers Company', tier: 'daily' },
  { id: 'r-a-kor', title: 'Edda Művek – A kör', ytId: 'xtOlSfGIkjc', artist: 'Edda Művek', tier: 'daily' },
  { id: 'r-jeg-dupla', title: 'Charlie – Jég dupla whiskyvel', ytId: 'B5Deno4mqpA', artist: 'Charlie', tier: 'daily' },
  { id: 'r-most-mulik', title: 'Quimby – Most múlik pontosan', ytId: 'bbF7VVsKYIw', artist: 'Quimby', tier: 'daily' },
  { id: 'r-videki-sanzon', title: 'Magna Cum Laude – Vidéki sanzon', ytId: '0ybB92b_iM0', artist: 'Magna Cum Laude', tier: 'daily' },
  { id: 'r-gabriel', title: 'Rúzsa Magdi – Gábriel', ytId: 'PvVVvi16ejU', artist: 'Rúzsa Magdi', tier: 'daily' },
  { id: 'r-lehetek', title: 'Vad Fruttik – Lehetek én is', ytId: 'SY4_HO1pNyA', artist: 'Vad Fruttik', tier: 'daily' },
  { id: 'r-zene-nelkul', title: 'Máté Péter – Zene nélkül mit érek én', ytId: 'kJUL_hwA5mY', artist: 'Máté Péter', tier: 'daily' },
  { id: 'r-hajolj-bele', title: 'Péterfy Bori & Love Band – Hajolj bele a hajamba', ytId: '9Qf6vmELIhI', artist: 'Péterfy Bori & Love Band', tier: 'daily' },
  { id: 'r-bodotta', title: 'Honeybeast – Bódottá', ytId: 'nsbPs5_V9os', artist: 'Honeybeast', tier: 'daily' },
  { id: 'r-egyszer', title: 'Rúzsa Magdi – Egyszer', ytId: 'WiK4zt5UVMI', artist: 'Rúzsa Magdi', tier: 'daily' },
  { id: 'r-viva-la-vida', title: 'Coldplay – Viva La Vida', ytId: 'dvgZkm1xWPE', artist: 'Coldplay', tier: 'daily' },
  { id: 'r-levitating', title: 'Dua Lipa – Levitating', ytId: 'TUVcZfQe-Kw', artist: 'Dua Lipa', tier: 'daily' },
  { id: 'r-dont-stop', title: "Queen – Don't Stop Me Now", ytId: 'HgzGwKwLmgM', artist: 'Queen', tier: 'daily' },
]

/** Teljes beépített SuliRádió katalógus (36 ellenőrzött sláger). */
export const DEFAULT_RADIO_TRACKS: RadioTrack[] = [...CORE_RADIO_TRACKS, ...ROTATING_RADIO_TRACKS]

/** Ünnepi / téli szüneti extra dalok a SuliRádió rotációjához (3 dal). */
export const XMAS_RADIO_TRACKS: RadioTrack[] = [
  { id: 'r-wham', title: 'Wham! – Last Christmas', ytId: 'E8gmARGvPlI', artist: 'Wham!', tier: 'xmas' },
  { id: 'r-mariah', title: 'Mariah Carey – All I Want For Christmas Is You', ytId: 'yXQViqx6GMY', artist: 'Mariah Carey', tier: 'xmas' },
  { id: 'r-shakin', title: 'Shakin’ Stevens – Merry Christmas Everyone', ytId: 'N-PyWfVkjZc', artist: 'Shakin’ Stevens', tier: 'xmas' },
]

const DAILY_ROTATING_COUNT = 10
const DAILY_ROTATION_STEP = 4

function fnv1a(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function dayNumber(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim())
  if (m) {
    const utcDays = Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000)
    return Math.max(0, utcDays)
  }
  return fnv1a(day)
}

/**
 * Összeállítja az adott nap determinisztikus SuliRádió műsorlistáját:
 * - mind a 10 állandó alap-sláger szerepel benne,
 * - a 26 rotálódó slágerből csúszóablakkal 10 aktív (naponta 4 friss dal lép be),
 * - az admin által felvett állandó saját dalok is automatikusan bekerülnek,
 * - majd a nap alapján determinisztikusan összekeverve.
 */
export function getDailyRadioPlaylist(
  day: string,
  christmas = false,
  customTracks: RadioTrack[] = getCustomRadioTracks()
): RadioTrack[] {
  const dIdx = dayNumber(day)
  const rotLen = ROTATING_RADIO_TRACKS.length
  const pickedRotating: RadioTrack[] = []
  for (let i = 0; i < DAILY_ROTATING_COUNT; i++) {
    const idx = (dIdx * DAILY_ROTATION_STEP + i) % rotLen
    pickedRotating.push(ROTATING_RADIO_TRACKS[idx])
  }

  const base = christmas
    ? [...XMAS_RADIO_TRACKS, ...CORE_RADIO_TRACKS, ...pickedRotating]
    : [...CORE_RADIO_TRACKS, ...pickedRotating]

  const seenYt = new Set(base.map(t => t.ytId))
  for (const ct of normalizeCustomTracks(customTracks)) {
    if (!seenYt.has(ct.ytId)) {
      seenYt.add(ct.ytId)
      base.push(ct)
    }
  }

  // Determinisztikus Fisher–Yates keverés az adott napra (LCG PRNG)
  const shuffled = [...base]
  let seed = fnv1a(`suliradio-${day}`) || 1
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    const j = seed % (i + 1)
    const tmp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = tmp
  }
  return shuffled
}

/**
 * Determinisztikusan választ egy rádiószámot a nap és a szünet kulcsa alapján,
 * hogy minden kijelzőn és telefonon ugyanaz a zene induljon el ugyanabban a szünetben.
 */
export function pickRadioTrack(
  day: string,
  breakKey: string,
  offset = 0,
  christmas = false,
  customTracks: RadioTrack[] = getCustomRadioTracks()
): RadioTrack {
  const pool = getDailyRadioPlaylist(day, christmas, customTracks)
  const baseIdx = fnv1a(`${day}-${breakKey}`) % pool.length
  const step = Math.max(0, Math.floor(offset))
  return pool[(baseIdx + step) % pool.length] ?? CORE_RADIO_TRACKS[0]
}
