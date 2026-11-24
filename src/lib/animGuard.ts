/**
 * Központi, szerveridőhöz szinkronizált élő animáció-vezérlés:
 * - A csengetési/esemény animációk csak a valódi pillanat élő időablakán belül indulnak el,
 *   így háttérből előtérbe hozott vagy elaludt füleken soha nem játszódnak le utólag.
 * - Az Easter Eggek nincsenek végleg letiltva localStorage-ban — bármikor újra aktiválhatók,
 *   csak rövid spammelés elleni lehűlési idővel és láthatósági ellenőrzéssel.
 */

const LEGACY_DAY_PREFIX = 'sulibell-anim-day-'
const LEGACY_EGGS_KEY = 'sulibell-anim-eggs-v1'
const EGG_COOLDOWN_STORAGE_KEY = 'sulibell-egg-cd-v1'

const GLOBAL_EGG_COOLDOWN_MS = 10_000
const DEFAULT_PER_EGG_COOLDOWN_MS = 30_000

const liveDedupe = new Map<string, number>()
const eggCooldown = new Map<string, number>()
let lastAnyEggAt = 0
let cleanedLegacy = false

interface EggCooldownState {
  globalAt: number
  byId: Record<string, number>
}

function readEggCooldownState(now: number): EggCooldownState {
  const byId: Record<string, number> = {}
  let globalAt = lastAnyEggAt
  for (const [id, ts] of eggCooldown) {
    if (now - ts < 120_000) byId[id] = ts
  }
  try {
    const raw = sessionStorage.getItem(EGG_COOLDOWN_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<EggCooldownState> | null
      if (typeof parsed?.globalAt === 'number' && parsed.globalAt <= now) {
        globalAt = Math.max(globalAt, parsed.globalAt)
      }
      if (parsed?.byId && typeof parsed.byId === 'object') {
        for (const [id, ts] of Object.entries(parsed.byId)) {
          if (typeof ts === 'number' && ts <= now && now - ts < 120_000) {
            byId[id] = Math.max(byId[id] ?? 0, ts)
          }
        }
      }
    }
  } catch { /* ignore */ }
  return { globalAt, byId }
}

function writeEggCooldownState(state: EggCooldownState) {
  lastAnyEggAt = state.globalAt
  for (const [id, ts] of Object.entries(state.byId)) {
    eggCooldown.set(id, ts)
  }
  try {
    sessionStorage.setItem(EGG_COOLDOWN_STORAGE_KEY, JSON.stringify(state))
  } catch { /* ignore */ }
}

function cleanupLegacyStorage() {
  if (cleanedLegacy || typeof localStorage === 'undefined') return
  cleanedLegacy = true
  try {
    localStorage.removeItem(LEGACY_EGGS_KEY)
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith(LEGACY_DAY_PREFIX)) {
        localStorage.removeItem(k)
      }
    }
  } catch { /* ignore */ }
}

/** Igaz, ha az aktuális esemény még a központi élő időablakban van (0 <= elapsed < maxWindowSec). */
export function isLiveWindow(elapsedSec: number | undefined, maxWindowSec: number): boolean {
  return typeof elapsedSec === 'number' && Number.isFinite(elapsedSec) && elapsedSec >= 0 && elapsedSec < maxWindowSec
}

/**
 * Élő csengetés / mérföldkő animáció engedélyezése:
 * - Háttérben (document.hidden) sosem indul el.
 * - Csak akkor futhat, ha a csengetés/mérföldkő óta eltelt valódi szerveridő még az élő ablakon belül van.
 * - Rövid (15 mp) memóriabeli védelem gondoskodik róla, hogy ugyanabban a 2-3 mp-es ablakban
 *   újrarendereléskor vagy fókuszváltáskor ne induljon duplán.
 */
export function claimLiveBellEvent(
  day: string,
  eventId: string,
  elapsedSec: number | undefined,
  maxWindowSec: number
): boolean {
  if (!eventId) return false
  cleanupLegacyStorage()
  if (typeof document !== 'undefined' && document.hidden) return false
  if (!isLiveWindow(elapsedSec, maxWindowSec)) return false

  const now = Date.now()
  const safeDay = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'today'
  const token = `${safeDay}::${eventId}`
  const prev = liveDedupe.get(token)
  if (prev != null && now - prev < 15_000) return false

  if (liveDedupe.size > 32) {
    for (const [k, ts] of liveDedupe) {
      if (now - ts >= 60_000) liveDedupe.delete(k)
    }
  }
  liveDedupe.set(token, now)
  return true
}

/**
 * Easter Egg aktiválhatóságának ellenőrzése:
 * - Bármikor újra aktiválható (nincs örök tiltás).
 * - Háttérben nem indul el, és spammelés ellen globálisan 10 mp,
 *   ugyanarra az Easter Eggre pedig 30 mp cooldown védi (sessionStorage-ban is tükrözve F5 ellen).
 */
export function canTriggerEasterEgg(eggId: string, cooldownMs = DEFAULT_PER_EGG_COOLDOWN_MS): boolean {
  if (!eggId) return false
  cleanupLegacyStorage()
  if (typeof document !== 'undefined' && document.hidden) return false

  const now = Date.now()
  const state = readEggCooldownState(now)
  if (state.globalAt > 0 && now - state.globalAt < GLOBAL_EGG_COOLDOWN_MS) return false

  const prev = state.byId[eggId] ?? 0
  if (prev > 0 && now - prev < cooldownMs) return false

  state.globalAt = now
  state.byId[eggId] = now
  writeEggCooldownState(state)
  return true
}
