// Szünet-videók: csak YouTube-linkeket és közvetlen .mp4/.webm fájlokat fogadunk el (más oldalt nem ágyazunk be).
export type Vid = { id: string; url: string; title: string }
export type Parsed = { kind: 'yt'; id: string } | { kind: 'file'; src: string }

export function parseVideo(raw: string): Parsed | null {
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
  if (/^[\w-]{11}$/.test(id)) return { kind: 'yt', id }
  if (/\.(mp4|webm)$/i.test(u.pathname)) return { kind: 'file', src: u.toString() }
  return null
}

/** Egy szünethez egy videót választ (a szünet kulcsából), a többi YouTube-videó követi lejátszási listaként. */
export function pickVideos(list: Vid[], key: string) {
  const ok = list.map(v => ({ v, p: parseVideo(v.url) })).filter((x): x is { v: Vid; p: Parsed } => !!x.p)
  if (!ok.length) return null
  let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const rot = [...ok.slice(h % ok.length), ...ok.slice(0, h % ok.length)]
  const first = rot[0]
  if (first.p.kind === 'file') return { src: first.p.src, title: first.v.title, yt: null as string | null }
  const ids = rot.filter(x => x.p.kind === 'yt').map(x => (x.p as { id: string }).id)
  const q = new URLSearchParams({ autoplay: '1', mute: '1', controls: '0', rel: '0', playsinline: '1', modestbranding: '1', loop: '1' })
  return { src: '', title: first.v.title, yt: `https://www.youtube-nocookie.com/embed/${ids[0]}?${q}&playlist=${ids.join(',')}` }
}
