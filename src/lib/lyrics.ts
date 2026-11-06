import { useEffect, useState } from 'react'

/** Egy időzített dalszöveg-sor (másodpercben megadott kezdéssel). */
export interface LyricLine { t: number; text: string }

const CACHE_PREFIX = 'csengeto-lyrics-v1-'

/** "Előadó – Cím (NCS Release) [Official Video]" → { artist, track } */
export function splitSongTitle(raw: string): { artist: string; track: string } {
  const clean = raw
    .replace(/\(([^)]*)\)|\[([^\]]*)\]/g, ' ')
    .replace(/\b(official|video|audio|lyrics?|hd|4k|clip|mv|ncs|release)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const m = clean.split(/\s[–—-]\s/)
  if (m.length >= 2) return { artist: m[0].trim(), track: m.slice(1).join(' ').trim() }
  return { artist: '', track: clean }
}

/** LRC formátum ("[01:23.45] szöveg") feldolgozása időrendbe rendezett sorokká. */
function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const row of lrc.split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (!stamps.length) continue
    const text = row.replace(/\[[^\]]*\]/g, '').trim()
    for (const s of stamps) {
      const frac = s[3] ? Number(`0.${s[3]}`) : 0
      out.push({ t: Number(s[1]) * 60 + Number(s[2]) + frac, text })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

/**
 * Időzített dalszöveg betöltése a nyílt LRCLIB adatbázisból.
 * Ha nincs elérhető (időzített) szöveg, üres tömböt ad vissza — ilyenkor nem jelenik meg felirat.
 */
export function useLyrics(title: string | undefined) {
  const [lines, setLines] = useState<LyricLine[]>([])

  useEffect(() => {
    setLines([])
    if (!title) return
    const { artist, track } = splitSongTitle(title)
    if (!track) return
    const key = CACHE_PREFIX + (artist + '|' + track).toLowerCase()
    try {
      const cached = localStorage.getItem(key)
      if (cached !== null) {
        setLines(cached ? parseLrc(cached) : [])
        return
      }
    } catch { /* ignore */ }

    const ctrl = new AbortController()
    const params = new URLSearchParams({ track_name: track })
    if (artist) params.set('artist_name', artist)
    fetch(`https://lrclib.net/api/search?${params}`, { signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : []))
      .then((list: any[]) => {
        const hit = Array.isArray(list) ? list.find(x => x && !x.instrumental && typeof x.syncedLyrics === 'string' && x.syncedLyrics.trim()) : null
        const lrc: string = hit?.syncedLyrics ?? ''
        try { localStorage.setItem(key, lrc) } catch { /* ignore */ }
        setLines(lrc ? parseLrc(lrc) : [])
      })
      .catch(() => { /* nincs felirat */ })
    return () => ctrl.abort()
  }, [title])

  return lines
}

/** Az adott lejátszási időponthoz tartozó aktuális sor indexe (-1, ha még nem kezdődött el). */
export function currentLyricIndex(lines: LyricLine[], time: number) {
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= time + 0.25) idx = i
    else break
  }
  return idx
}
