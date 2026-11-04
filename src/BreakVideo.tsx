import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { pickVideos, type Vid } from './lib/video'
import { mediaModeForDay, type SongWish } from './Jukebox'

/** Az iskola régi szünet-videói (ha még van a break_videos táblában); 5 percenként frissül. */
export function useVideos(schoolId?: string) {
  const [v, setV] = useState<Vid[]>(() => {
    try { return JSON.parse(localStorage.getItem('csengeto-videos') ?? '[]') } catch { return [] }
  })
  useEffect(() => {
    if (!schoolId) return
    let alive = true
    const load = async () => {
      const { data, error } = await supabase.from('break_videos').select('id, url, title').eq('school_id', schoolId).order('created_at')
      if (error || !alive) return
      setV(data as Vid[])
      try { localStorage.setItem('csengeto-videos', JSON.stringify(data)) } catch { /* nem baj */ }
    }
    load()
    const t = setInterval(load, 300_000)
    return () => { alive = false; clearInterval(t) }
  }, [schoolId])
  return v
}

/**
 * Szünetben lejátszott videó vagy zene:
 * - Videó-napon a diákok által beküldött és megszavazott szüneti videók mennek (vagy tartalékként a break_videos).
 * - Zene-napon a diákok által beküldött és megszavazott zenék mennek.
 */
export default function BreakVideo({
  list,
  wishes = [],
  day,
  breakKey,
  soundOn,
}: {
  list: Vid[]
  wishes?: SongWish[]
  day: string
  breakKey: string
  soundOn?: boolean
}) {
  const mode = mediaModeForDay(day)
  const isVideoDay = mode === 'video'

  // Lejátszható diák-kívánságok (szavazatszám szerint rendezve)
  const playableWishes = wishes.filter(w => w.ytId || w.mp4Url)

  if (playableWishes.length > 0) {
    // A legtöbb szavazatot kapott kívánság (vagy döntetlen esetén a szünet kulcsa alapján választva az élmezőnyből)
    const topVotes = playableWishes[0].votes
    const leaders = playableWishes.filter(w => w.votes === topVotes)
    let h = 0
    for (const c of breakKey) h = (h * 31 + c.charCodeAt(0)) >>> 0
    const chosen = leaders[h % leaders.length] ?? playableWishes[0]

    // Zene-napon ha a hang engedélyezve van, ne legyen némítva; videó-napon alapból néma (vagy ha soundOn van, hanggal)
    const muteParam = (!isVideoDay && soundOn) ? 0 : 1
    const ytSrc = chosen.ytId
      ? `https://www.youtube-nocookie.com/embed/${chosen.ytId}?autoplay=1&mute=${muteParam}&controls=1&rel=0&playsinline=1&loop=1&playlist=${chosen.ytId}`
      : undefined

    return (
      <section className="panel full vid">
        <div className="tag" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>
            {isVideoDay ? '🎬 Szüneti Videó' : '🎵 Szüneti Zene'}: <b>{chosen.title}</b>
            {chosen.by ? ` (küldi: ${chosen.by})` : ''}
          </span>
          <span className="pill">🔥 {chosen.votes} szavazat</span>
        </div>
        <div className="vframe">
          {ytSrc ? (
            <iframe
              key={ytSrc}
              src={ytSrc}
              title={chosen.title}
              allow="autoplay; encrypted-media; picture-in-picture"
              sandbox="allow-scripts allow-same-origin allow-presentation"
              referrerPolicy="strict-origin-when-cross-origin"
              loading="lazy"
            />
          ) : (
            <video key={chosen.mp4Url} src={chosen.mp4Url} autoPlay muted={!soundOn} controls loop playsInline />
          )}
        </div>
      </section>
    )
  }

  // Tartalék: ha még nincs lejátszható diák-beküldés, de van régi break_videos elem
  const p = pickVideos(list, breakKey)
  if (!p) return null
  return (
    <section className="panel full vid">
      <div className="tag">
        {isVideoDay ? '🎬 Szüneti Videó' : '🎵 Szünet'}{p.title ? `: ${p.title}` : ''}
      </div>
      <div className="vframe">
        {p.yt ? (
          <iframe
            key={p.yt}
            src={p.yt}
            title={p.title || 'Szünet-videó'}
            allow="autoplay; encrypted-media; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
          />
        ) : (
          <video key={p.src} src={p.src} autoPlay muted loop playsInline />
        )}
      </div>
    </section>
  )
}
