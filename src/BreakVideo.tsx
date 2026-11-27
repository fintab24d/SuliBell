import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { currentLyricIndex, useLyrics } from './lib/lyrics'
import { serverNowMs } from './lib/serverTime'
import { isBellRinging, subscribeBellRinging } from './lib/sound'
import type { MusicSlot } from './lib/musicSync'
import type { MusicSyncResult } from './lib/useMusicSync'
import { cleanSongTitle } from './lib/video'

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
export const MusicVisualizer = memo(function MusicVisualizer({
  title,
  by,
  ytId,
  vip = false,
  radioMode = false,
  initialMuted = false,
  compact = false,
  tv = false,
  waitForBell = false,
  slotStartMs,
  slotEndMs,
  upcoming,
  onClose,
}: {
  title: string
  by?: string
  ytId?: string
  vip?: boolean
  radioMode?: boolean
  initialMuted?: boolean
  compact?: boolean
  tv?: boolean
  waitForBell?: boolean
  slotStartMs?: number
  slotEndMs?: number
  upcoming?: MusicSlot[]
  onClose?: () => void
}) {
  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState(initialMuted)
  const [soundBellActive, setSoundBellActive] = useState(() => isBellRinging())
  useEffect(() => subscribeBellRinging(setSoundBellActive), [])
  const holdingForBell = Boolean(waitForBell || soundBellActive)
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

  // Fejléc-némítás (különösen TV nézetben, ahol nincs saját gomb a zenelejátszón) szinkronizálása
  useEffect(() => {
    setMuted(initialMuted)
    if (!ytId || holdingForBell) return
    if (initialMuted) {
      sendYtCmd('mute')
    } else {
      forceUnmuteAndPlay()
    }
  }, [initialMuted, ytId, holdingForBell, sendYtCmd, forceUnmuteAndPlay])

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
  const displayTitle = useMemo(() => cleanSongTitle(title), [title])
  const [time, setTime] = useState(0)
  const lyrics = useLyrics(displayTitle)

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
  const lyricPrev = lyricIdx > 0 ? lyrics[lyricIdx - 1]?.text ?? '' : ''
  const lyricNow = lyricIdx >= 0 ? lyrics[lyricIdx]?.text ?? '' : ''
  const lyricNext = lyrics[lyricIdx + 1]?.text ?? ''
  const lyricDurSec =
    lyricIdx >= 0 && lyrics[lyricIdx + 1]
      ? Math.max(1.2, Math.min(12, lyrics[lyricIdx + 1].t - lyrics[lyricIdx].t))
      : 4

  // Ha a böngésző az első kattintásig visszafogná a hangot, az oldal bárhol történő első érintésére felhangosítjuk
  useEffect(() => {
    if (muted || !playing || waitingNext || holdingForBell) return
    const unlock = () => {
      forceUnmuteAndPlay()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [muted, playing, waitingNext, holdingForBell, forceUnmuteAndPlay])

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

  // Indítási másodperc: kizárólag váltáskor / újracsatoláskor / csengő lecsengése után számolódik újra
  const startSec = useMemo(() => {
    if (!playing || holdingForBell || slotStartMs === undefined) return 0
    return Math.max(0, Math.floor((serverNowMs() - slotStartMs) / 1000))
  }, [ytId, reloadNonce, playing, holdingForBell, slotStartMs])

  const origin = typeof window !== 'undefined' ? encodeURIComponent(window.location.origin) : ''
  const startParam = startSec > 0 ? `&start=${startSec}` : ''
  const ytSrc = ytId
    ? `https://www.youtube.com/embed/${ytId}?autoplay=1&mute=0&controls=1&rel=0&playsinline=1&enablejsapi=1${startParam}&origin=${origin}`
    : undefined

  const thumbUrl = ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : undefined
  const active = playing && !muted && !waitingNext && !holdingForBell

  const vipWish = vip && !radioMode

  return (
    <div className={`music-viz ${compact ? 'compact' : ''} ${tv ? 'is-tv' : ''} ${playing && !waitingNext && !holdingForBell ? 'is-playing' : 'is-paused'} ${vipWish ? 'is-vip' : ''}`}>
      {/* Háttérben futó 240x200px-es audio motor a visualizer réteg mögött (YouTube >=200x200px előírás miatt) */}
      <div className="bg-audio-engine" aria-hidden="true">
        {ytSrc && playing && !waitingNext && !holdingForBell && (
            <iframe
            ref={iframeRef}
            key={`${ytId}-${slotStartMs ?? 0}-${reloadNonce}`}
            src={ytSrc}
            title={displayTitle}
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
            <div className={`viz-disc ${playing && !waitingNext && !holdingForBell ? 'spin' : ''}`}>
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
                {holdingForBell
                  ? '🔔 CSENGŐHANG SZÓL — ZENE UTÁNA INDUL'
                  : waitingNext
                    ? `⏳ Következő szám hamarosan…${waitRemSec > 0 ? ` (${waitRemSec} mp)` : ''}`
                    : playing
                      ? (muted ? 'NÉMÍTVA MEGY A HÁTTÉRBEN' : 'KÖZPONTI ÉLŐ LEJÁTSZÁS')
                      : 'SZÜNETELTETVE (HELYI)'}
              </span>
              {radioMode ? (
                <span className="pill viz-radio-pill">📻 SULIRÁDIÓ • AUTO-DJ</span>
              ) : vipWish ? (
                <span className="pill viz-vip-pill">👑 VIP KÍVÁNSÁG</span>
              ) : (
                <span className="pill">🎵 DIÁKKÍVÁNSÁG</span>
              )}
            </div>
            <h3 key={`t-${ytId ?? displayTitle}`} className="viz-title" title={displayTitle}>{displayTitle}</h3>
            <div key={`s-${ytId ?? displayTitle}-${by ?? ''}`} className="viz-sub">
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

            {!tv && (
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
            )}
          </div>
        </div>

        {/* Időzített dalszöveg (csak ha elérhető) */}
        {lyrics.length > 0 && !waitingNext && !holdingForBell && (
          <div className="viz-lyrics" aria-live="polite">
            {lyricPrev && <p key={`p-${lyricIdx}`} className="prev">{lyricPrev}</p>}
            <p
              key={`n-${lyricIdx}`}
              className="now"
              style={{ '--ldur': `${lyricDurSec.toFixed(2)}s` } as CSSProperties}
            >
              {(lyricNow || '♪').split(/\s+/).map((word, wi) => (
                <span key={wi} className="lword" style={{ '--wi': wi } as CSSProperties}>
                  {word}{' '}
                </span>
              ))}
            </p>
            {lyricNext && <p key={`x-${lyricIdx}`} className="next">{lyricNext}</p>}
            <span
              key={`bar-${lyricIdx}`}
              className="viz-lyric-bar"
              style={{ '--ldur': `${lyricDurSec.toFixed(2)}s` } as CSSProperties}
              aria-hidden="true"
            />
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

        {/* Következő 3 szám előnézet */}
        {upcoming && upcoming.length > 0 && (
          <div className="viz-upnext" aria-label="Következő számok">
            <span className="viz-upnext-head">⏭️ Következő számok</span>
            <ol className="viz-upnext-list">
              {upcoming.slice(0, 3).map((slot, idx) => {
                const upTitle = cleanSongTitle(slot.track.title)
                const srcLabel =
                  slot.kind === 'wish'
                    ? slot.track.vip
                      ? `👑 VIP${slot.track.by ? ` • ${slot.track.by}` : ''}`
                      : `🎵 ${slot.track.by || 'Kívánság'}`
                    : slot.track.by
                      ? `📻 ${slot.track.by}`
                      : '📻 SuliRádió'
                return (
                  <li key={`${slot.track.id}-${slot.start}-${idx}`} className={`viz-upnext-item${slot.track.vip ? ' vip' : ''}`}>
                    <span className="viz-upnext-idx">{idx + 1}.</span>
                    <span className="viz-upnext-title" title={upTitle}>{upTitle}</span>
                    <small className="viz-upnext-src">{srcLabel}</small>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
})

/**
 * Szünetben szóló központi zenelejátszó:
 * Szerveridőhöz szinkronizált idővonalon játssza le a diák-kívánságokat és a SuliRádiót,
 * így minden kijelzőn és telefonon ugyanaz a dal, ugyanannál a másodpercnél szól.
 */
export default memo(function BreakVideo({
  sync,
  tv = false,
  soundOn: _soundOn,
  userMuted = false,
  waitForBell = false,
}: {
  sync: MusicSyncResult
  tv?: boolean
  soundOn?: boolean
  userMuted?: boolean
  waitForBell?: boolean
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
        vip={Boolean(track.vip)}
        radioMode={radioMode}
        initialMuted={userMuted}
        tv={tv}
        waitForBell={waitForBell}
        slotStartMs={sync.slotStartMs}
        slotEndMs={sync.slotEndMs}
        upcoming={sync.upcoming}
      />
    </section>
  )
})
