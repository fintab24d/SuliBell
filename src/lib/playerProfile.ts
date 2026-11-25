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
