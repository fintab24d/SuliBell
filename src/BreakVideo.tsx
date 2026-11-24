import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { currentLyricIndex, useLyrics } from './lib/lyrics'
import { serverNowMs } from './lib/serverTime'
import type { MusicSyncResult } from './lib/useMusicSync'

const VIZ_BARS = Array.from({ length: 28 }, (_, i) => {
  const d = ((i * 7 + 3) % 13) / 10
  const s = 0.42 + ((i * 5) % 9) * 0.07
  const h = 35 + ((i * 19 + 11) % 65)
  return { delay: `${d.toFixed(2)}s`, dur: `${s.toFixed(2)}s`, maxH: `${h}%` }
})

/**
 * Háttérben szóló zenelejátszó + Neon Spektrum Visualizer.
 * A YouTube lejátszó 240x200px méretben a visualizer réteg mögött fut (így a YouTube és a böngésző
 * nem tiltja le a hangot), miközben a felhasználó csak a Neon Visualizert látja.
 */
export function MusicVisualizer({
  title,
  by,
  ytId,
  radioMode = false,
  initialMuted = false,
  compact = false,
  slotStartMs,
  slotEndMs,
  onClose,
}: {
  title: string
  by?: string
  ytId?: string
  radioMode?: boolean
  initialMuted?: boolean
  compact?: boolean
  slotStartMs?: number
  slotEndMs?: number
  onClose?: () => void
}) {
  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState(initialMuted)
  const [volume, setVolume] = useState(50)
  const volumeRef = useRef(50)
  volumeRef.current = volume
  const [reloadNonce, setReloadNonce] = useState(0)
  const [waitingNext, setWaitingNext] = useState(false)
  const [waitRemSec, setWaitRemSec] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const lastSeekAtRef = useRef(0)

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
    }
  }, [ytId, sendYtCmd])

  // Amikor az iframe betöltődik, feliratkozunk az időadatokra, és többször is elküldjük az unMute + setVolume + playVideo parancsot
  const handleIframeLoad = useCallback(() => {
    const win = iframeRef.current?.contentWindow
    win?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*')
    if (muted) return
    forceUnmuteAndPlay()
    setTimeout(forceUnmuteAndPlay, 250)
    setTimeout(forceUnmuteAndPlay, 800)
    setTimeout(forceUnmuteAndPlay, 1600)
  }, [muted, forceUnmuteAndPlay])

  // Lejátszási idő követése és drift-korrekció a központi szerveridő alapján
  const [time, setTime] = useState(0)
  const lyrics = useLyrics(title)

  useEffect(() => {
    setWaitingNext(false)
    lastSeekAtRef.current = 0
  }, [ytId, slotStartMs])

  useEffect(() => {
    if (!waitingNext || slotEndMs === undefined) {
      setWaitRemSec(0)
      return
    }
    const tick = () => {
      setWaitRemSec(Math.max(0, Math.ceil((slotEndMs - serverNowMs()) / 1000)))
    }
    tick()
    const id = window.setInterval(tick, 500)
    return () => window.clearInterval(id)
  }, [waitingNext, slotEndMs])

  useEffect(() => {
    if (!ytId) return
    const onMsg = (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow) return
      if (!/^https:\/\/(www\.)?youtube(-nocookie)?\.com$/.test(String(ev.origin))) return
      try {
        const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data
        const t = d?.info?.currentTime
        if (typeof t === 'number') {
          setTime(t)
          if (slotStartMs !== undefined) {
            const expected = (serverNowMs() - slotStartMs) / 1000
            const nowMs = Date.now()
            if (expected >= 0 && Math.abs(t - expected) > 2.5 && nowMs - lastSeekAtRef.current >= 4000) {
              lastSeekAtRef.current = nowMs
              sendYtCmd('seekTo', [expected, true])
            }
          }
        }

        const state = d?.info?.playerState ?? (d?.event === 'onStateChange' ? d?.info : undefined)
        if (state === 0 && (slotEndMs === undefined || serverNowMs() < slotEndMs - 500)) {
          setWaitingNext(true)
        }
      } catch { /* nem JSON */ }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [ytId, slotStartMs, slotEndMs, sendYtCmd])

  const lyricIdx = currentLyricIndex(lyrics, time)
  const lyricNow = lyricIdx >= 0 ? lyrics[lyricIdx].text : ''
  const lyricNext = lyrics[lyricIdx + 1]?.text ?? ''

  // Ha a böngésző az első kattintásig visszafogná a hangot, az oldal bárhol történő első érintésére felhangosítjuk
  useEffect(() => {
    if (muted || !playing || waitingNext) return
    const unlock = () => {
      forceUnmuteAndPlay()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [muted, playing, waitingNext, forceUnmuteAndPlay])

  const togglePlay = () => {
    const next = !playing
    setPlaying(next)
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
      }
    }
  }

  const changeVolume = (nextVol: number) => {
    const v = Math.max(0, Math.min(100, nextVol))
    setVolume(v)
    if (v === 0) {
      setMuted(true)
      if (ytId) sendYtCmd('mute')
    } else {
      if (muted) setMuted(false)
      if (ytId) {
        sendYtCmd('unMute')
        sendYtCmd('setVolume', [v])
      }
    }
  }

  // Indítási másodperc: kizárólag váltáskor / újracsatoláskor számolódik újra
  const startSec = useMemo(() => {
    if (!playing || slotStartMs === undefined) return 0
    return Math.max(0, Math.floor((serverNowMs() - slotStartMs) / 1000))
  }, [ytId, reloadNonce, playing, slotStartMs])

  const origin = typeof window !== 'undefined' ? encodeURIComponent(window.location.origin) : ''
  const startParam = startSec > 0 ? `&start=${startSec}` : ''
  const ytSrc = ytId
    ? `https://www.youtube.com/embed/${ytId}?autoplay=1&mute=0&controls=1&rel=0&playsinline=1&enablejsapi=1${startParam}&origin=${origin}`
    : undefined

  const thumbUrl = ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : undefined
  const active = playing && !muted && !waitingNext

  return (
    <div className={`music-viz ${compact ? 'compact' : ''} ${playing && !waitingNext ? 'is-playing' : 'is-paused'}`}>
      {/* Háttérben futó 240x200px-es audio motor a visualizer réteg mögött (YouTube >=200x200px előírás miatt) */}
      <div className="bg-audio-engine" aria-hidden="true">
        {ytSrc && playing && !waitingNext && (
          <iframe
            ref={iframeRef}
            key={`${ytId}-${slotStartMs ?? 0}-${reloadNonce}`}
            src={ytSrc}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={handleIframeLoad}
            tabIndex={-1}
          />
        )}
      </div>

      <div className="viz-foreground">
        <div className="viz-top">
          {/* Forgó neon bakelit korong + pulzáló hanghullám gyűrűk */}
          <div className="viz-disc-wrap">
            <div className="viz-ring r1" />
            <div className="viz-ring r2" />
            <div className={`viz-disc ${playing && !waitingNext ? 'spin' : ''}`}>
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
                {waitingNext
                  ? `⏳ Következő szám hamarosan…${waitRemSec > 0 ? ` (${waitRemSec} mp)` : ''}`
                  : playing
                    ? (muted ? 'NÉMÍTVA MEGY A HÁTTÉRBEN' : 'KÖZPONTI ÉLŐ LEJÁTSZÁS')
                    : 'SZÜNETELTETVE (HELYI)'}
              </span>
              {radioMode ? (
                <span className="pill viz-radio-pill">📻 SULIRÁDIÓ • AUTO-DJ</span>
              ) : (
                <span className="pill">🎵 DIÁKKÍVÁNSÁG</span>
              )}
            </div>
            <h3 className="viz-title" title={title}>{title}</h3>
            <div className="viz-sub">
              {radioMode ? (
                by ? (
                  <span>SuliRádió • Diákajánlás: <b>{by}</b> (ha beküldesz egy számot, az szól következőnek!)</span>
                ) : (
                  <span>SuliRádió • Központi szüneti műsor (mindenkinél egyszerre szól)</span>
                )
              ) : by ? (
                <span>Küldi: <b>{by}</b></span>
              ) : (
                <span>Szüneti Zenegép</span>
              )}
            </div>

            <div className="viz-controls">
              <button type="button" className="viz-btn" onClick={togglePlay}>
                {playing ? '⏸ Szünet' : '▶ Csatlakozás élőhöz'}
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
                    setWaitingNext(false)
                    setReloadNonce(n => n + 1)
                  }}
                  title="Ha a böngésző letiltotta az automatikus hangot, kattints ide a hangos újraindításhoz"
                >
                  🔄 Szinkron / Hang
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
        {lyrics.length > 0 && !waitingNext && (
          <div className="viz-lyrics" aria-live="polite">
            <p key={`n${lyricIdx}`} className="now">{lyricNow || '♪'}</p>
            {lyricNext && <p className="next">{lyricNext}</p>}
          </div>
        )}

        {/* Neon Spektrum Hullám Visualizer */}
        <div className={`viz-bars ${active ? 'live' : playing && !waitingNext ? 'soft' : 'idle'}`} aria-hidden="true">
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
 * Szünetben szóló központi zenelejátszó:
 * Szerveridőhöz szinkronizált idővonalon játssza le a diák-kívánságokat és a SuliRádiót,
 * így minden kijelzőn és telefonon ugyanaz a dal, ugyanannál a másodpercnél szól.
 */
export default function BreakVideo({
  sync,
  tv: _tv = false,
  soundOn: _soundOn,
  userMuted = false,
}: {
  sync: MusicSyncResult
  tv?: boolean
  soundOn?: boolean
  userMuted?: boolean
}) {
  if (!sync.current) return null
  const { kind, track } = sync.current
  const radioMode = kind !== 'wish'

  return (
    <section className="panel full vid music-panel">
      <MusicVisualizer
        title={track.title}
        by={track.by}
        ytId={track.ytId}
        radioMode={radioMode}
        initialMuted={userMuted}
        slotStartMs={sync.slotStartMs}
        slotEndMs={sync.slotEndMs}
      />
    </section>
  )
}
