import { useEffect, useRef, useState, type PointerEvent as PE } from 'react'
import { botDir, newGame, step, type G, type P } from './lib/snake'
import { botTarget, H, newCatch, stepCatch, W, type C } from './lib/catch'

const COLS = 22, ROWS = 14
const KEYS: Record<string, P> = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 } }
const bestGet = () => { try { return +(localStorage.getItem('snake-best') ?? 0) } catch { return 0 } }

export type SnakeDiff = 'easy' | 'normal' | 'hard' | 'extreme'
const SNAKE_DIFFS: { id: SnakeDiff; label: string; ms: number }[] = [
  { id: 'easy', label: 'Könnyű', ms: 135 },
  { id: 'normal', label: 'Normál', ms: 95 },
  { id: 'hard', label: 'Nehéz', ms: 68 },
  { id: 'extreme', label: 'Extrém', ms: 48 },
]
const diffGet = (): SnakeDiff => {
  try {
    const v = localStorage.getItem('snake-diff')
    if (v === 'easy' || v === 'normal' || v === 'hard' || v === 'extreme') return v
  } catch { /* ignore */ }
  return 'normal'
}

/** Neon Snake. A TV-n (és amíg senki nem játszik) a gép játszik; koppintásra / Enter-re átveheted az irányítást.
 *  Irányítás: nyilak, WASD vagy ujjal húzás a játéktéren. */
function Snake({ tv }: { tv: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const g = useRef<G>(newGame(COLS, ROWS))
  const q = useRef<P[]>([])
  const [mode, setMode] = useState<'demo' | 'play' | 'over'>('demo')
  const m = useRef(mode); m.current = mode
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(bestGet)
  const [diff, setDiff] = useState<SnakeDiff>(diffGet)
  const wait = useRef(0)

  const changeDiff = (d: SnakeDiff) => {
    setDiff(d)
    try { localStorage.setItem('snake-diff', d) } catch { /* ignore */ }
  }

  const start = () => { g.current = newGame(COLS, ROWS); q.current = []; setScore(0); setMode('play') }

  useEffect(() => {
    const draw = () => {
      const c = cv.current; if (!c) return
      const W = c.clientWidth || 440, dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round((W * ROWS / COLS) * dpr) }
      const x = c.getContext('2d')!, k = c.width / COLS, G = g.current
      x.setTransform(1, 0, 0, 1, 0, 0)
      x.fillStyle = '#080a1c'; x.fillRect(0, 0, c.width, c.height)
      x.fillStyle = 'rgba(120,140,255,.14)'
      for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) { x.beginPath(); x.arc((i + .5) * k, (j + .5) * k, k * .05, 0, 6.3); x.fill() }
      // étel (pulzál)
      const t = performance.now() / 260, f = G.food
      if (f.x >= 0) { x.shadowColor = '#ffb02e'; x.shadowBlur = k * .9; x.fillStyle = '#ffb02e'; x.beginPath(); x.arc((f.x + .5) * k, (f.y + .5) * k, k * (.28 + .05 * Math.sin(t)), 0, 6.3); x.fill() }
      // kígyó: fejtől a farokig cián → rózsaszín
      const n = G.snake.length
      G.snake.forEach((s, i) => {
        const p = n > 1 ? i / (n - 1) : 0
        x.shadowColor = G.dead ? '#ff3b5c' : `hsl(${180 + p * 130} 100% 60%)`; x.shadowBlur = k * .6
        x.fillStyle = G.dead ? '#ff3b5c' : `hsl(${180 + p * 130} 100% ${62 - p * 8}%)`
        const r = k * (i === 0 ? .44 : .38)
        const bx = (s.x + .5) * k - r, by = (s.y + .5) * k - r; x.beginPath(); if (x.roundRect) x.roundRect(bx, by, r * 2, r * 2, r * .5); else x.rect(bx, by, r * 2, r * 2); x.fill()
      })
      x.shadowBlur = 0
    }
    const tick = () => {
      if (document.hidden) return
      const G = g.current
      if (m.current === 'over') { draw(); return }
      if (m.current === 'demo') {
        if (G.dead) { if (++wait.current > 10) { wait.current = 0; g.current = newGame(COLS, ROWS) } }
        else step(G, botDir(G))
        setScore(G.score)
      } else {
        step(G, q.current.shift())
        setScore(G.score)
        if (G.dead) { setMode('over'); setBest(b => { const v = Math.max(b, G.score); try { localStorage.setItem('snake-best', String(v)) } catch { /* nem baj */ } return v }) }
      }
      draw()
    }
    draw()
    const speedMs = tv ? 85 : (SNAKE_DIFFS.find(d => d.id === diff)?.ms ?? 95)
    const t = setInterval(tick, speedMs)
    window.addEventListener('resize', draw)
    return () => { clearInterval(t); window.removeEventListener('resize', draw) }
  }, [tv, diff])

  // Billentyűk: csak játék közben nyeljük el a nyilakat (hogy az oldal ne görögjön)
  useEffect(() => {
    if (tv) return
    const on = (e: KeyboardEvent) => {
      const d = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key]
      if (m.current === 'play' && d) { e.preventDefault(); if (q.current.length < 2) q.current.push(d) }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [tv])

  // Érintés: koppintás = indítás, húzás = irány
  const p0 = useRef<P | null>(null)
  const down = (e: PE<HTMLCanvasElement>) => { p0.current = { x: e.clientX, y: e.clientY } }
  const up = (e: PE<HTMLCanvasElement>) => {
    const a = p0.current; p0.current = null
    if (!a || tv) return
    const dx = e.clientX - a.x, dy = e.clientY - a.y
    if (Math.hypot(dx, dy) < 24) { if (m.current !== 'play') start(); return }
    if (m.current === 'play' && q.current.length < 2) q.current.push(Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) })
  }

  return <div className="snake">
    <div className="snakehud">
      <span>Snake</span>
      <span>{mode === 'demo' ? (tv ? 'Gépi játékos' : 'Bemutató') : 'Pont'}: <b>{score}</b></span>
      <span>Rekord: <b>{best}</b></span>
    </div>
    {!tv && (
      <div className="snakediff" role="group" aria-label="Nehézségi szint">
        <span>Nehézség:</span>
        {SNAKE_DIFFS.map(d => (
          <button
            key={d.id}
            type="button"
            className={diff === d.id ? 'on' : ''}
            onClick={() => changeDiff(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>
    )}
    <div className="snakescreen">
      <canvas ref={cv} onPointerDown={down} onPointerUp={up} aria-label="Snake játék" />
      {tv && <div className="tvplay">📱 Játssz te is! Menj fel a <b>{location.host}</b> oldalra, vagy nyisd meg az alkalmazást.</div>}
      {!tv && mode !== 'play' && <div className="snakeover">
        {mode === 'over' && <b>Vége! {score} pont</b>}
        <button className="cta" onClick={start}>{mode === 'over' ? 'Újra' : '▶ Játssz te is'}</button>
        <small>Nyilak / WASD, vagy húzd az ujjad</small></div>}
    </div>
  </div>
}


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
function Catch({ tv, theme }: { tv: boolean; theme: 'halloween' | 'christmas' | 'easter' }) {
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
  const start = () => { c.current = newCatch(); setHud({ score: 0, lives: 5 }); setMode('play') }

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
    <div className="snakehud"><span>{T.title}</span><span>{mode === 'demo' ? (tv ? 'Gépi játékos' : 'Bemutató') : 'Pont'}: <b>{hud.score}</b></span><span>{'❤️'.repeat(Math.max(0, hud.lives))}</span><span>Rekord: <b>{best}</b></span></div>
    <div className="snakescreen">
      <canvas ref={cv} onPointerMove={aim} onPointerDown={e => { if (m.current !== 'play' && !tv) start(); else aim(e) }} aria-label={T.title} />
      {tv && <div className="tvplay">📱 Játssz te is! Menj fel a <b>{location.host}</b> oldalra, vagy nyisd meg az alkalmazást.</div>}
      {!tv && mode !== 'play' && <div className="snakeover">
        {mode === 'over' && <b>Vége! {hud.score} pont</b>}
        <button className="cta" onClick={start}>{mode === 'over' ? 'Újra' : '▶ Játssz te is'}</button>
        <small>{T.hint}. Egér / ujj vagy nyilak</small></div>}
    </div>
  </div>
}

const QUIPS = ['Pihenj egy nagyot!', 'Ma nincs csengő, csak nyugi.', 'Tölts fel, jön az új hét!', 'Az ágy ma erősebb, mint a csengő.', 'Játsz egyet, a házi úgyis ráér.', 'Szünet van, a csengő is alszik.']

/** Pihenő mód: ha nincs tanítás (hétvége, ünnep, szünet), vicces üzenet, a következő szünetig hátralévő idő és egy Snake-játék. */
export default function RestMode({ tv, reason, day, ev }: { tv: boolean; reason?: string; day: string; ev?: { icon: string; days: number; hours: number; mins: number; note: string } }) {
  const game = gameFor(reason)
  const h = [...day].reduce((a, c) => a + c.charCodeAt(0), 0)
  return <section className="panel full rest">
    <div className="tag">Pihenő mód{reason ? `: ${reason}` : ''}</div>
    <div className={`restgrid ${game === 'none' ? 'solo' : ''}`}>
      <div className="restinfo">
        <h2>{QUIPS[h % QUIPS.length]}</h2>
        {ev && <div className="restcount">
          <span className="ico" aria-hidden="true">{ev.icon}</span>
          <b>{ev.days}</b><span>nap<small>{ev.hours} óra {ev.mins} perc</small></span>
          <em>{ev.note}</em>
        </div>}
      </div>
      {game === 'snake' && <Snake tv={tv} />}
      {(game === 'halloween' || game === 'christmas' || game === 'easter') && <Catch tv={tv} theme={game} />}
    </div>
  </section>
}
