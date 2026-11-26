/**
 * Központi játékosprofil segédfüggvények (tisztán Node-kompatibilis, importmentes).
 */

/**
 * Normalizálja a játékosnevet egyediség-ellenőrzéshez:
 * kisbetűsítés, magyar ékezetek eltávolítása, többszörös szóközök összevonása.
 */
export function normalizePlayerNameKey(name: string): string {
  return name
    .trim()
    .toLocaleLowerCase('hu')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

export interface NameEntry {
  playerId: string
  nameKey?: string
  name?: string
}

/**
 * Megállapítja, hogy a választott nevet másik játékos (eltérő playerId) már lefoglalta-e.
 */
export function isNameTakenByOther(
  candidateName: string,
  myPlayerId: string,
  entries: readonly NameEntry[],
): boolean {
  const targetKey = normalizePlayerNameKey(candidateName)
  if (!targetKey) return false
  for (const entry of entries) {
    if (!entry.playerId || entry.playerId === myPlayerId) continue
    const key = entry.nameKey
      ? normalizePlayerNameKey(entry.nameKey)
      : entry.name
        ? normalizePlayerNameKey(entry.name)
        : ''
    if (key && key === targetKey) return true
  }
  return false
}

/** Csak a számjegyeket tartja meg a PIN mezőben, legfeljebb 4 karakterig. */
export function sanitizePinInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 4)
}

/** Ellenőrzi, hogy a PIN pontosan 4 számjegyből áll-e. */
export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin.trim())
}

function isSubsequence(needle: string, haystack: string): boolean {
  let j = 0
  for (let i = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) j++
  }
  return j === needle.length
}

/**
 * Hasonlóság szerint rangsorolja a már létező játékosneveket PIN-es belépésnél.
 */
export function rankProfileSuggestions(
  query: string,
  names: readonly string[],
  limit = 5,
): string[] {
  const q = normalizePlayerNameKey(query)
  if (!q) return []

  const qTokens = q.split(' ').filter(Boolean)
  const seen = new Set<string>()
  const scored: { name: string; score: number; lenDiff: number }[] = []

  for (const raw of names) {
    const clean = raw.trim()
    const key = normalizePlayerNameKey(clean)
    if (!clean || !key || seen.has(key)) continue
    seen.add(key)

    let score = 0
    if (key === q) {
      score = 100
    } else if (key.startsWith(q)) {
      score = 85
    } else {
      const words = key.split(/[\s./-]+/).filter(Boolean)
      if (words.some(w => w.startsWith(q))) {
        score = 75
      } else if (key.includes(q)) {
        score = 60
      } else if (qTokens.length > 1 && qTokens.every(t => key.includes(t))) {
        score = 50
      } else if (q.length >= 2 && isSubsequence(q.replace(/\s+/g, ''), key.replace(/\s+/g, ''))) {
        score = 30
      }
    }

    if (score > 0) {
      scored.push({ name: clean, score, lenDiff: Math.abs(key.length - q.length) })
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.lenDiff - b.lenDiff || a.name.localeCompare(b.name, 'hu'))
    .slice(0, limit)
    .map(x => x.name)
}
