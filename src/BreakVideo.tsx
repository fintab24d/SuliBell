import { useEffect, useRef, useState, type CSSProperties } from 'react'
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

const VIZ_BARS = Array.from({ length: 28 }, (_, i) => {
  const d = ((i * 7 + 3) % 13) / 10
  const s = 0.42 + ((i * 5) % 9) * 0.07
  const h = 35 + ((i * 19 + 11) % 65)
  return { delay: `${d.toFixed(2)}s`, dur: `${s.toFixed(2)}s`, maxH: `${h}%` }
})

/**
 * Háttérben szóló zenelejátszó + Neon Spektrum Visualizer.
 * A videót nem jeleníti meg, csak a hang szól a háttérben, miközben a lemez és a spektrum sávok mozognak.
 */
export function MusicVisualizer({
  title,
  by,
  votes,
  ytId,
  mp4Url,
  initialMuted = false,
  compact = false,
  onClose,
}: {
  title: string
  by?: string
  votes?: number
  ytId?: string
  mp4Url?: string
  initialMuted?: boolean
  compact?: boolean
  onClose?: () => void
}) {
  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState(initialMuted)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const mediaRef = useRef<HTMLVideoElement | null>(null)

  const sendYtCmd = (func: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      '*'
    )
  }

  const togglePlay = () => {
    const next = !playing
    setPlaying(next)
    if (ytId) {
      sendYtCmd(next ? 'playVideo' : 'pauseVideo')
    } else if (mediaRef.current) {
      if (next) mediaRef.current.play().catch(() => {})
      else mediaRef.current.pause()
    }
  }

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    if (ytId) {
      sendYtCmd(next ? 'mute' : 'unMute')
      if (!next) {
        sendYtCmd('setVolume', [100])
        sendYtCmd('playVideo')
        setPlaying(true)
      }
    } else if (mediaRef.current) {
      mediaRef.current.muted = next
      if (!next) {
        mediaRef.current.play().catch(() => {})
        setPlaying(true)
      }
    }
  }

  // Ha a szülő komponensben bekapcsolják a hangot, vegyük le a némítást
  useEffect(() => {
    setMuted(initialMuted)
    if (ytId) {
      sendYtCmd(initialMuted ? 'mute' : 'unMute')
    } else if (mediaRef.current) {
      mediaRef.current.muted = initialMuted
    }
  }, [initialMuted, ytId])

  const ytSrc = ytId
    ? `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&mute=${initialMuted ? 1 : 0}&controls=0&disablekb=1&fs=0&modestbranding=1&rel=0&playsinline=1&loop=1&playlist=${ytId}&enablejsapi=1`
    : undefined

  const thumbUrl = ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : undefined
  const active = playing && !muted

  return (
    <div className={`music-viz ${compact ? 'compact' : ''} ${playing ? 'is-playing' : 'is-paused'}`}>
      {/* Háttérben futó, láthatatlan audio motor (nem jelenik meg videóként) */}
      <div className="bg-audio-engine" aria-hidden="true">
        {ytSrc && (
          <iframe
            ref={iframeRef}
            key={ytId}
            src={ytSrc}
            title={title}
            allow="autoplay; encrypted-media"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            referrerPolicy="strict-origin-when-cross-origin"
            tabIndex={-1}
          />
        )}
        {!ytSrc && mp4Url && (
          <video
            ref={mediaRef}
            key={mp4Url}
            src={mp4Url}
            autoPlay
            muted={muted}
            loop
            playsInline
          />
        )}
      </div>

      <div className="viz-top">
        {/* Forgó neon bakelit korong + pulzáló hanghullám gyűrűk */}
        <div className="viz-disc-wrap">
          <div className="viz-ring r1" />
          <div className="viz-ring r2" />
          <div className={`viz-disc ${playing ? 'spin' : ''}`}>
            {thumbUrl ? (
              <img src={thumbUrl} alt="" className="viz-thumb" loading="lazy" />
            ) : (
              <span className="viz-note">🎵</span>
            )}
            <span className="viz-hole" />
          </div>
        </div>

        {/* Szám adatai és vezérlőgombok */}
        <div className="viz-meta">
          <div className="viz-status-row">
            <span className="viz-badge">
              <span className="eq" aria-hidden="true"><i /><i /><i /></span>
              {playing ? (muted ? 'NÉMÍTVA MEGY A HÁTTÉRBEN' : 'MOST SZÓL A HÁTTÉRBEN') : 'SZÜNETELTETVE'}
            </span>
            {typeof votes === 'number' && (
              <span className="pill">🔥 {votes} szavazat</span>
            )}
          </div>
          <h3 className="viz-title" title={title}>{title}</h3>
          <div className="viz-sub">
            {by ? <span>Küldi: <b>{by}</b></span> : <span>Szüneti Zenegép</span>}
          </div>

          <div className="viz-controls">
            <button type="button" className="viz-btn" onClick={togglePlay}>
              {playing ? '⏸ Szünet' : '▶ Lejátszás'}
            </button>
            <button
              type="button"
              className={`viz-btn ${muted ? 'warn' : 'on'}`}
              onClick={toggleMute}
            >
              {muted ? '🔇 Hang bekapcsolása' : '🔊 Hang BE'}
            </button>
            {onClose && (
              <button type="button" className="viz-btn" onClick={onClose}>
                ⏹ Bezárás
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Neon Spektrum Hullám Visualizer */}
      <div className={`viz-bars ${active ? 'live' : playing ? 'soft' : 'idle'}`} aria-hidden="true">
        {VIZ_BARS.map((b, idx) => (
          <span
            key={idx}
            className="viz-bar"
            style={
              {
                '--d': b.delay,
                '--s': b.dur,
                '--h': b.maxH,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Szünetben lejátszott videó vagy zene:
 * - Videó-napon a diákok által beküldött és megszavazott szüneti videók mennek.
 * - Zene-napon a zenék NEM videóként jelennek meg, hanem a háttérben szólnak a Neon Visualizerrel!
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

  // Lejátszható diák-kívánságok (szavazatszám szerint rendezve)
  const playableWishes = wishes.filter(w => w.ytId || w.mp4Url)

  if (playableWishes.length > 0) {
    // A legtöbb szavazatot kapott kívánság (vagy döntetlen esetén a szünet kulcsa alapján választva az élmezőnyből)
    const topVotes = playableWishes[0].votes
    const leaders = playableWishes.filter(w => w.votes === topVotes)
    let h = 0
    for (const c of breakKey) h = (h * 31 + c.charCodeAt(0)) >>> 0
    const chosen = leaders[h % leaders.length] ?? playableWishes[0]

    const isChosenMusic = chosen.kind === 'music' || (chosen.kind !== 'video' && mode === 'music')

    // Ha Zene-nap van (vagy zene kívánság), NE videót mutassunk, hanem a háttérlejátszót + Visualizert!
    if (isChosenMusic) {
      return (
        <section className="panel full vid music-panel">
          <MusicVisualizer
            title={chosen.title}
            by={chosen.by}
            votes={chosen.votes}
            ytId={chosen.ytId}
            mp4Url={chosen.mp4Url}
            initialMuted={false}
          />
        </section>
      )
    }

    const muteParam = soundOn ? 0 : 1
    const ytSrc = chosen.ytId
      ? `https://www.youtube-nocookie.com/embed/${chosen.ytId}?autoplay=1&mute=${muteParam}&controls=1&rel=0&playsinline=1&loop=1&playlist=${chosen.ytId}`
      : undefined

    return (
      <section className="panel full vid">
        <div className="tag" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>
            🎬 Szüneti Videó: <b>{chosen.title}</b>
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
  if (mode === 'music') {
    const ytMatch = p.yt?.match(/\/embed\/([^?&/]+)/)
    return (
      <section className="panel full vid music-panel">
        <MusicVisualizer
          title={p.title || 'Szüneti zene'}
          ytId={ytMatch?.[1]}
          mp4Url={p.src}
          initialMuted={false}
        />
      </section>
    )
  }
  return (
    <section className="panel full vid">
      <div className="tag">
        🎬 Szüneti Videó{p.title ? `: ${p.title}` : ''}
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
