// Szüneti zenék: kizárólag biztonságos https YouTube-linkeket fogadunk el.
export type Parsed = { kind: 'yt'; id: string }

export function parseYouTubeId(raw: string): string | null {
  let u: URL
  try { u = new URL(raw.trim()) } catch { return null }
  if (u.protocol !== 'https:') return null
  const h = u.hostname.replace(/^(www|m|music)\./, '')
  let id = ''
  if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0]
  else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
    const m = /^\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname)
    id = m ? m[1] : u.pathname === '/watch' ? u.searchParams.get('v') ?? '' : ''
  }
  return /^[\w-]{11}$/.test(id) ? id : null
}

export function parseVideo(raw: string): Parsed | null {
  const id = parseYouTubeId(raw)
  return id ? { kind: 'yt', id } : null
}

const TITLE_NOISE_WORDS = new Set([
  'official', 'hivatalos', 'music', 'video', 'videoklip', 'klip',
  'lyric', 'lyrics', 'dalszoveg', 'dalszoveggel', 'szoveg', 'szoveggel',
  'with', 'audio', 'visualizer', 'visualiser', 'visual', 'hd', 'hq', 'uhd',
  '4k', '8k', '1080p', '720p', '60fps', 'mv', 'm', 'v', 'clip',
  'officiel', 'oficial', 'full', 'song', 'version', 'explicit', 'clean',
  'remaster', 'remastered', 'ncs', 'release', 'topic', 'subtitle', 'subtitles',
  'felirat', 'felirattal', 'color', 'coded', 'han', 'rom', 'eng', 'hun',
  'cc', 'performance', 'prod', 'screen',
])

function isMetadataNoiseOnly(segment: string): boolean {
  const tokens = segment
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  return tokens.length > 0 && tokens.every(t => TITLE_NOISE_WORDS.has(t))
}

/**
 * Eltávolítja a YouTube-címekből a felesleges körítéseket
 * (pl. "(Official Music Video)", "[Lyrics]", "(4K HD)", "| Official Audio").
 * Megőrzi a dalhoz tartozó fontos infókat (pl. "(feat. ...)", "(Remix)").
 */
export function cleanSongTitle(raw: string): string {
  const orig = (raw || '').trim()
  if (!orig) return ''

  let out = orig.replace(/[(\[{【]([^)\]}】]{1,70})[)\]}】]/g, (full, inner: string) =>
    isMetadataNoiseOnly(inner) ? ' ' : full
  )

  for (let i = 0; i < 3; i++) {
    const next = out.replace(/\s*(?:\||\/\/|[-–—])\s*([^|\n-–—]+)$/, (full, tail: string) =>
      isMetadataNoiseOnly(tail) ? '' : full
    )
    if (next === out) break
    out = next
  }

  out = out.replace(
    /\s+(?:official\s+(?:music\s+|lyric\s+|live\s+)?(?:video|audio|visuali[sz]er|clip)|lyric\s+video|music\s+video|hivatalos\s+(?:video)?klip|with\s+lyrics|m\/v)\s*$/i,
    ''
  )

  out = out
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}|【\s*】/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s\-–—|/:]+$/g, '')
    .trim()

  return out || orig
}
