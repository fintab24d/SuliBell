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
