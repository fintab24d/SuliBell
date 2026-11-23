const STORAGE_DAY_PREFIX = 'sulibell-anim-day-'
const STORAGE_EGGS_KEY = 'sulibell-anim-eggs-v1'
const CHANNEL_NAME = 'sulibell-anim-guard'

const memoryDaily = new Set<string>()
const memoryEggs = new Set<string>()

let bc: BroadcastChannel | null = null
let initialized = false

function readSet(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeSet(key: string, values: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(values)))
  } catch { /* ignore */ }
}

function pruneOldDailyKeys(currentDay: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(currentDay)) return
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith(STORAGE_DAY_PREFIX) && k !== STORAGE_DAY_PREFIX + currentDay) {
        localStorage.removeItem(k)
      }
    }
  } catch { /* ignore */ }
}

function ensureSync() {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  for (const id of readSet(STORAGE_EGGS_KEY)) memoryEggs.add(id)

  try {
    bc = new BroadcastChannel(CHANNEL_NAME)
    bc.onmessage = (ev) => {
      const d = ev.data
      if (!d) return
      if (d.kind === 'daily' && typeof d.token === 'string') memoryDaily.add(d.token)
      else if (d.kind === 'egg' && typeof d.id === 'string') memoryEggs.add(d.id)
    }
  } catch { /* ignore */ }

  window.addEventListener('storage', (e) => {
    if (!e.key) return
    if (e.key === STORAGE_EGGS_KEY) {
      for (const id of readSet(STORAGE_EGGS_KEY)) memoryEggs.add(id)
    } else if (e.key.startsWith(STORAGE_DAY_PREFIX)) {
      const d = e.key.slice(STORAGE_DAY_PREFIX.length)
      for (const evId of readSet(e.key)) memoryDaily.add(`${d}::${evId}`)
    }
  })
}

/**
 * Központi napi egyszeri lejátszás-őr (pl. Becsengettek / Kicsengettek / Vége a tanításnak):
 * egy adott napon egy esemény animációja csak egyszer játszódhat le, akkor is ha újratöltik vagy több fülön nyitják meg.
 */
export function claimDailyAnimationOnce(day: string, eventId: string): boolean {
  if (!eventId) return false
  ensureSync()
  const safeDay = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'today'
  if (safeDay !== 'today') pruneOldDailyKeys(safeDay)

  const token = `${safeDay}::${eventId}`
  if (memoryDaily.has(token)) return false

  const storageKey = STORAGE_DAY_PREFIX + safeDay
  const persisted = new Set(readSet(storageKey))
  for (const id of persisted) memoryDaily.add(`${safeDay}::${id}`)

  if (memoryDaily.has(token) || persisted.has(eventId)) {
    memoryDaily.add(token)
    return false
  }

  memoryDaily.add(token)
  persisted.add(eventId)
  writeSet(storageKey, persisted)
  try { bc?.postMessage({ kind: 'daily', token }) } catch { /* ignore */ }
  return true
}

/**
 * Központi egyszeri lejátszás-őr az Easter Egg animációkhoz:
 * minden Easter Egg animáció központilag csak egyszer játszódik le.
 */
export function claimEasterEggOnce(eggId: string): boolean {
  if (!eggId) return false
  ensureSync()
  if (memoryEggs.has(eggId)) return false

  const persisted = new Set(readSet(STORAGE_EGGS_KEY))
  for (const id of persisted) memoryEggs.add(id)

  if (memoryEggs.has(eggId) || persisted.has(eggId)) {
    memoryEggs.add(eggId)
    return false
  }

  memoryEggs.add(eggId)
  persisted.add(eggId)
  writeSet(STORAGE_EGGS_KEY, persisted)
  try { bc?.postMessage({ kind: 'egg', id: eggId }) } catch { /* ignore */ }
  return true
}
