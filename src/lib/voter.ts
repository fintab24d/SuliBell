/** Névtelen szavazó-azonosító (központi profillal PIN-nel hordozható több eszköz között). */
export const voterId = (): string => {
  try {
    let v = localStorage.getItem('voter')
    if (!v) {
      v = crypto.randomUUID()
      localStorage.setItem('voter', v)
    }
    return v
  } catch {
    return 'anon-' + Math.random().toString(36).slice(2, 12)
  }
}

/** Átállítja a helyi játékos/szavazó azonosítót (PIN-es belépéshez). */
export const setVoterId = (id: string) => {
  if (!id) return
  try {
    localStorage.setItem('voter', id)
  } catch { /* ignore */ }
}

/** Új névtelen azonosítót generál (kijelentkezéshez közös gépen). */
export const resetVoterId = (): string => {
  let next = 'anon-' + Math.random().toString(36).slice(2, 12)
  try {
    next = crypto.randomUUID()
    localStorage.setItem('voter', next)
  } catch { /* ignore */ }
  return next
}
