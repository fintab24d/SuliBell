import { useEffect, useRef, useState, type PointerEvent as PE } from 'react'
import { botTarget, H, newCatch, stepCatch, W, type C } from './lib/catch'
import SnakeGame from './SnakeGame'
import { useArenaLeaderboard } from './Arena'
import { getChampionBadge, useChampions } from './lib/useChampions'
import { focusPlayerProfile, usePlayerProfile } from './lib/usePlayerProfile'


export type Game = 'snake' | 'halloween' | 'christmas' | 'easter' | 'none'
/** A szünet megnevezéséből dönti el, melyik játék jár hozzá (nyáron nincs játék). */
export function gameFor(reason?: string): Game {
  const r = reason ?? ''
  return /nyár/i.test(r) ? 'none' : /ősz|halloween|mindenszent/i.test(r) ? 'halloween' : /tél|karácsony/i.test(r) ? 'christmas' : /tavasz|húsvét/i.test(r) ? 'easter' : 'snake'
}
const TH = {
  halloween: { title: 'Halloween: édességfogó', catcher: '🧙', good: ['🍬', '🍭', '🍫'], gold: '🎃', bad: '🕷️', bg: ['#150a26', '#3a1450'], glow: '#ff7a2e', hint: 'Kapd el az édességet, kerüld a pókokat' },
  christmas: { title: 'Karácsony: ajándékfogó', catcher: '🎅', good: ['🎁', '🍪', '⭐'], gold: '🎄', bad: '🧊', bg: ['#0a1a2c', '#12331f'], glow: '#ff4f6a', hint: 'Kapd el az ajándékokat, kerüld a jégkockákat' },
  easter: { title: 'Húsvét: tojásvadászat', catcher: '🐰', good: ['🥚', '🐣', '🌷'], gold: '🍫', bad: '🐛', bg: ['#1a1030', '#12304a'], glow: '#ff9ad5', hint: 'Kapd el a tojásokat, kerüld a hernyókat' },
} as const

/** Ünnepi fogó-játék (Halloween, Karácsony, Húsvét). Egér / ujj / nyilak mozgatják a szereplőt; a TV-n és amíg senki nem játszik, a gép játszik. */
function Catch({ tv, theme, schoolId }: { tv: boolean; theme: 'halloween' | 'christmas' | 'easter'; schoolId?: string }) {
  const T = TH[theme]
  const cv = useRef<HTMLCanvasElement>(null)
  const c = useRef<C>(newCatch())
  const [mode, setMode] = useState<'demo' | 'play' | 'over'>('demo')
  const m = useRef(mode); m.current = mode
  const [hud, setHud] = useState({ score: 0, lives: 5 })
  const bk = 'catch-best-' + theme
  const [best, setBest] = useState(() => { try { return +(localStorage.getItem(bk) ?? 0) } catch { return 0 } })
  const keys = useRef({ l: false, r: false })
  const wait = useRef(0)
  const profile = usePlayerProfile(schoolId)
  const playerName = profile.valid ? profile.cleanName : ''
  const [nameErr, setNameErr] = useState('')

  useEffect(() => {
    if (profile.valid && nameErr) setNameErr('')
  }, [profile.valid, nameErr])

  const start = () => {
    if (!profile.valid) {
      setNameErr(profile.validationError || 'A játékhoz előbb add meg a neved a Játékosprofil kártyán!')
      focusPlayerProfile()
      return
    }
    setNameErr('')
    c.current = newCatch()
    setHud({ score: 0, lives: 5 })
    setMode('play')
  }

  useEffect(() => {
    let raf = 0, last = performance.now()
    const draw = () => {
      const el = cv.current; if (!el) return
      const w = el.clientWidth || 440, dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (el.width !== Math.round(w * dpr)) { el.width = Math.round(w * dpr); el.height = Math.round(w * (H / W) * dpr) }
      const x = el.getContext('2d')!, k = el.width / W, C = c.current
      x.setTransform(1, 0, 0, 1, 0, 0)
      const g = x.createLinearGradient(0, 0, 0, el.height); g.addColorStop(0, T.bg[0]); g.addColorStop(1, T.bg[1])
      x.fillStyle = g; x.fillRect(0, 0, el.width, el.height)
      const gl = x.createRadialGradient(el.width / 2, el.height, 0, el.width / 2, el.height, el.width * .6)
      gl.addColorStop(0, T.glow + '55'); gl.addColorStop(1, T.glow + '00'); x.fillStyle = gl; x.fillRect(0, 0, el.width, el.height)
      x.textAlign = 'center'; x.textBaseline = 'middle'
      for (const it of C.items) {
        x.save(); x.translate(it.x * k, it.y * k); if (it.kind !== 2) x.rotate(Math.sin(it.rot) * .4)
        x.font = `${(it.kind === 1 ? 17 : 14) * k}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`
        if (it.kind === 1) { x.shadowColor = '#ffd23f'; x.shadowBlur = 10 * k }
        x.fillText(it.kind === 1 ? T.gold : it.kind === 2 ? T.bad : T.good[it.e], 0, 0); x.restore()
      }
      x.font = `${26 * k}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`
      x.shadowColor = T.glow; x.shadowBlur = 12 * k; x.fillText(T.catcher, C.cx * k, (H - 15) * k); x.shadowBlur = 0
      x.fillStyle = T.glow; x.fillRect(0, (H - 2) * k, el.width, 2 * k)
      if (C.flash > 0) { x.fillStyle = `rgba(255,50,80,${C.flash * .35})`; x.fillRect(0, 0, el.width, el.height) }
    }
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(.05, (now - last) / 1000); last = now
      if (document.hidden) return
      const C = c.current
      if (m.current === 'demo') {
        if (C.dead) { if ((wait.current += dt) > 1.2) { wait.current = 0; c.current = newCatch() } }
        else { C.tx = botTarget(C); stepCatch(C, dt) }
      } else if (m.current === 'play') {
        if (keys.current.l || keys.current.r) C.tx = C.cx + (keys.current.r ? 1 : 0) * 120 - (keys.current.l ? 1 : 0) * 120
        stepCatch(C, dt)
        if (C.dead) { setMode('over'); setBest(b => { const v = Math.max(b, C.score); try { localStorage.setItem(bk, String(v)) } catch { /* nem baj */ } return v }) }
      }
      setHud(h => h.score === C.score && h.lives === C.lives ? h : { score: C.score, lives: C.lives })
      draw()
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [theme])

  useEffect(() => {
    if (tv) return
    const set = (e: KeyboardEvent, v: boolean) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (m.current !== 'play') return
      if (k === 'ArrowLeft' || k === 'a') { keys.current.l = v; e.preventDefault() }
      if (k === 'ArrowRight' || k === 'd') { keys.current.r = v; e.preventDefault() }
    }
    const dn = (e: KeyboardEvent) => set(e, true), up = (e: KeyboardEvent) => set(e, false)
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up) }
  }, [tv])

  const aim = (e: PE<HTMLCanvasElement>) => { if (m.current !== 'play' || tv) return; const r = e.currentTarget.getBoundingClientRect(); c.current.tx = (e.clientX - r.left) / r.width * W }

  return <div className="snake">
    <div className="snakehud">
      <span>{T.title}</span>
      {playerName && <span>Játékos: <b>{playerName}</b></span>}
      <span>{mode === 'demo' ? (tv ? 'Gépi játékos' : 'Bemutató') : 'Pont'}: <b>{hud.score}</b></span>
      <span>{'❤️'.repeat(Math.max(0, hud.lives))}</span>
      <span>Rekord: <b>{best}</b></span>
    </div>
    <div className="snakescreen">
      <canvas ref={cv} onPointerMove={aim} onPointerDown={e => { if (m.current !== 'play' && !tv) start(); else aim(e) }} aria-label={T.title} />
      {tv && <div className="tvplay">📱 Játssz te is! Menj fel a <b>{location.host}</b> oldalra, vagy nyisd meg az alkalmazást.</div>}
      {!tv && mode !== 'play' && <div className="snakeover">
        {mode === 'over' && <b>Vége! {hud.score} pont</b>}
        {!profile.valid && (
          <div style={{ margin: '6px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <small style={{ color: '#ffb02e' }}>
              🔒 {nameErr || 'A játékhoz előbb állítsd be a neved a Játékosprofil kártyán!'}
            </small>
            <button type="button" className="profile-chip-cta" onClick={() => focusPlayerProfile()}>
              👤 Név megadása
            </button>
          </div>
        )}
        <button className="cta" onClick={start}>{mode === 'over' ? 'Újra' : '▶ Játssz te is'}</button>
        <small>{T.hint}. Egér / ujj vagy nyilak</small></div>}
    </div>
  </div>
}

const QUIPS = ['Pihenj egy nagyot!', 'Ma nincs csengő, csak nyugi.', 'Tölts fel, jön az új hét!', 'Az ágy ma erősebb, mint a csengő.', 'Játsz egyet, a házi úgyis ráér.', 'Szünet van, a csengő is alszik.']

/** Pihenő mód: ha nincs tanítás (hétvége, ünnep, szünet), vicces üzenet, a következő szünetig hátralévő idő és egy Snake-játék toplistával. */
export default function RestMode({
  tv,
  reason,
  day,
  ev,
  schoolId,
  sound,
}: {
  tv: boolean
  reason?: string
  day: string
  ev?: { icon: string; days: number; hours: number; mins: number; note: string }
  schoolId?: string
  sound?: boolean
}) {
  const game = gameFor(reason)
  const h = [...day].reduce((a, c) => a + c.charCodeAt(0), 0)
  const { board, submitScore } = useArenaLeaderboard(schoolId, day)
  const { champions, myTier, refresh: refreshChampions } = useChampions(schoolId, day)
  const snakeBoard = board.filter(b => b.mode === 'snake').slice(0, 5)

  return (
    <section className="panel full rest">
      <div className="tag">Pihenő mód{reason ? `: ${reason}` : ''}</div>
      <div className={`restgrid ${game === 'none' ? 'solo' : ''}`}>
        <div className="restinfo">
          <h2>{QUIPS[h % QUIPS.length]}</h2>
          {ev && (
            <div className="restcount">
              <span className="ico" aria-hidden="true">{ev.icon}</span>
              <b>{ev.days}</b><span>nap<small>{ev.hours} óra {ev.mins} perc</small></span>
              <em>{ev.note}</em>
            </div>
          )}
          {game === 'snake' && snakeBoard.length > 0 && (
            <div className="snake-lb">
              <div className="snake-lb-title">🏆 Mai Snake Toplista</div>
              <ol className="arena-lb">
                {snakeBoard.map((b, i) => {
                  const tier = getChampionBadge(champions, b.playerId)
                  return (
                    <li key={`${b.playerId}-${i}`} className={i === 0 ? 'gold' : ''}>
                      <span className="rk">{i === 0 ? '👑' : `${i + 1}.`}</span>
                      <b>
                        {b.name}
                        {tier && (
                          <span className={`champ-badge ${tier}`}>
                            {tier === 'monthly' ? '💎 Havi' : '🏆 Heti'}
                          </span>
                        )}
                      </b>
                      <strong className="pts">{b.score} p</strong>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
        </div>
        {game === 'snake' && (
          <SnakeGame
            tv={tv}
            schoolId={schoolId}
            championTier={myTier}
            sound={sound}
            onGameOver={(score, _apples, _diff, playerName) => {
              submitScore(playerName, 'snake', score)
              window.setTimeout(() => void refreshChampions(), 350)
            }}
          />
        )}
        {(game === 'halloween' || game === 'christmas' || game === 'easter') && <Catch tv={tv} theme={game} schoolId={schoolId} />}
      </div>
    </section>
  )
}
