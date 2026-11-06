import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { supabase } from './lib/supabase'
import { pickVideos, type Vid } from './lib/video'
import { mediaModeForDay, type SongWish } from './Jukebox'
import { currentLyricIndex, useLyrics } from './lib/lyrics'

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
 * A YouTube / audio lejátszó 240x200px méretben a visualizer réteg mögött fut (így a YouTube és a böngésző
 * nem tiltja le a hangot), miközben a felhasználó csak a Neon Visualizert látja.
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
  const [volume, setVolume] = useState(50)
  const volumeRef = useRef(50)
  volumeRef.current = volume
  const [reloadNonce, setReloadNonce] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const mediaRef = useRef<HTMLVideoElement | null>(null)

  const sendYtCmd = useCallback((func: string, args: unknown[] = []) => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    win.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*')
    win.postMessage(JSON.stringify({ event: 'command', func, args }), '*')
  }, [])

  const forceUnmuteAndPlay = useCallback(() => {
    const v = volumeRef.current
    if (ytId) {
      sendYtCmd('unMute')
      sendYtCmd('setVolume', [v])
      sendYtCmd('playVideo')
    } else if (mediaRef.current) {
      mediaRef.current.muted = false
      mediaRef.current.volume = v / 100
      mediaRef.current.play().catch(() => {})
    }
  }, [ytId, sendYtCmd])

  // Amikor az iframe betöltődik, feliratkozunk az időadatokra, és többször is elküldjük az unMute + setVolume(100) + playVideo parancsot
  const handleIframeLoad = useCallback(() => {
    const win = iframeRef.current?.contentWindow
    win?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*')
    if (muted) return
    forceUnmuteAndPlay()
    setTimeout(forceUnmuteAndPlay, 250)
    setTimeout(forceUnmuteAndPlay, 800)
    setTimeout(forceUnmuteAndPlay, 1600)
  }, [muted, forceUnmuteAndPlay])

  // Lejátszási idő követése (a YouTube "infoDelivery" üzeneteiből), a feliratok időzítéséhez
  const [time, setTime] = useState(0)
  const lyrics = useLyrics(title)
  useEffect(() => {
    if (!ytId) return
    const onMsg = (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow) return
      if (!/^https:\/\/(www\.)?youtube(-nocookie)?\.com$/.test(String(ev.origin))) return
      try {
        const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data
        const t = d?.info?.currentTime
        if (typeof t === 'number') setTime(t)
      } catch { /* nem JSON */ }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [ytId])
  const lyricIdx = currentLyricIndex(lyrics, time)
  const lyricNow = lyricIdx >= 0 ? lyrics[lyricIdx].text : ''
  const lyricNext = lyrics[lyricIdx + 1]?.text ?? ''

  // Ha a böngésző az első kattintásig visszafogná a hangot, az oldal bárhol történő első érintésére felhangosítjuk
  useEffect(() => {
    if (muted || !playing) return
    const unlock = () => {
      forceUnmuteAndPlay()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [muted, playing, forceUnmuteAndPlay])

  const togglePlay = () => {
    const next = !playing
    setPlaying(next)
    if (ytId) {
      if (next) {
        sendYtCmd('unMute')
        sendYtCmd('setVolume', [volume])
        sendYtCmd('playVideo')
      } else {
        sendYtCmd('pauseVideo')
      }
    } else if (mediaRef.current) {
      if (next) {
        mediaRef.current.muted = muted
        mediaRef.current.volume = volume / 100
        mediaRef.current.play().catch(() => {})
      } else {
        mediaRef.current.pause()
      }
    }
  }

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    if (ytId) {
      if (next) {
        sendYtCmd('mute')
      } else {
        setPlaying(true)
        setReloadNonce(n => n + 1)
        setTimeout(() => {
          sendYtCmd('unMute')
          sendYtCmd('setVolume', [volume])
          sendYtCmd('playVideo')
        }, 200)
      }
    } else if (mediaRef.current) {
      mediaRef.current.muted = next
      if (!next) {
        mediaRef.current.volume = volume / 100
        mediaRef.current.play().catch(() => {})
        setPlaying(true)
      }
    }
  }

  const changeVolume = (nextVol: number) => {
    const v = Math.max(0, Math.min(100, nextVol))
    setVolume(v)
    if (v === 0) {
      setMuted(true)
      if (ytId) sendYtCmd('mute')
      else if (mediaRef.current) mediaRef.current.muted = true
    } else {
      if (muted) setMuted(false)
      if (ytId) {
        sendYtCmd('unMute')
        sendYtCmd('setVolume', [v])
      } else if (mediaRef.current) {
        mediaRef.current.muted = false
        mediaRef.current.volume = v / 100
      }
    }
  }

  const origin = typeof window !== 'undefined' ? encodeURIComponent(window.location.origin) : ''
  const ytSrc = ytId
    ? `https://www.youtube.com/embed/${ytId}?autoplay=1&mute=0&controls=1&rel=0&playsinline=1&loop=1&playlist=${ytId}&enablejsapi=1&origin=${origin}`
    : undefined

  const thumbUrl = ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : undefined
  const active = playing && !muted

  return (
    <div className={`music-viz ${compact ? 'compact' : ''} ${playing ? 'is-playing' : 'is-paused'}`}>
      {/* Háttérben futó 240x200px-es audio motor a visualizer réteg mögött (YouTube >=200x200px előírás miatt) */}
      <div className="bg-audio-engine" aria-hidden="true">
        {ytSrc && playing && (
          <iframe
            ref={iframeRef}
            key={`${ytId}-${reloadNonce}`}
            src={ytSrc}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={handleIframeLoad}
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
            onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
          />
        )}
      </div>

      <div className="viz-foreground">
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
                {muted ? '🔇 Némítva' : '🔊 Hang'}
              </button>
              <label className="viz-vol" title="Hangerő szabályzó">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={muted ? 0 : volume}
                  onChange={e => changeVolume(Number(e.target.value))}
                />
                <span>{muted ? 0 : volume}%</span>
              </label>
              {ytId && (
                <button
                  type="button"
                  className="viz-btn"
                  onClick={() => {
                    setMuted(false)
                    setPlaying(true)
                    setReloadNonce(n => n + 1)
                  }}
                  title="Ha a böngésző letiltotta az automatikus hangot, kattints ide a hangos újraindításhoz"
                >
                  🔄 Hang frissítése
                </button>
              )}
              {onClose && (
                <button type="button" className="viz-btn" onClick={onClose}>
                  ⏹ Bezárás
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Időzített dalszöveg (csak ha elérhető) */}
        {lyrics.length > 0 && (
          <div className="viz-lyrics" aria-live="polite">
            <p key={`n${lyricIdx}`} className="now">{lyricNow || '♪'}</p>
            {lyricNext && <p className="next">{lyricNext}</p>}
          </div>
        )}

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
  soundOn: _soundOn,
  userMuted = false,
}: {
  list: Vid[]
  wishes?: SongWish[]
  day: string
  breakKey: string
  soundOn?: boolean
  userMuted?: boolean
}) {
  const mode = mediaModeForDay(day)

  // Lejátszható diák-kívánságok (szavazatszám szerint rendezve)
  const playableWishes = wishes.filter(w => w.ytId || w.mp4Url)

  if (playableWishes.length > 0) {
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
            initialMuted={userMuted}
          />
        </section>
      )
    }

    // Videó-napon a videók mindig némítva indulnak
    const ytSrc = chosen.ytId
      ? `https://www.youtube.com/embed/${chosen.ytId}?autoplay=1&mute=1&controls=1&rel=0&playsinline=1&loop=1&playlist=${chosen.ytId}`
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
              referrerPolicy="strict-origin-when-cross-origin"
              loading="lazy"
            />
          ) : (
            <video key={chosen.mp4Url} src={chosen.mp4Url} autoPlay muted controls loop playsInline />
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
          initialMuted={userMuted}
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
