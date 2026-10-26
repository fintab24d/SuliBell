import { useEffect, useRef, useState, type PointerEvent as PE } from 'react'
import { botDir, newGame, step, type G, type P } from './lib/snake'

const COLS = 22, ROWS = 14
const KEYS: Record<string, P> = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 } }
const bestGet = () => { try { return +(localStorage.getItem('snake-best') ?? 0) } catch { return 0 } }

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
  const wait = useRef(0)

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
    const t = setInterval(tick, tv ? 85 : 100)
    window.addEventListener('resize', draw)
    return () => { clearInterval(t); window.removeEventListener('resize', draw) }
  }, [tv])

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
    <div className="snakehud"><span>Snake</span><span>{mode === 'demo' ? (tv ? 'Gépi játékos' : 'Bemutató') : 'Pont'}: <b>{score}</b></span><span>Rekord: <b>{best}</b></span></div>
    <div className="snakescreen">
      <canvas ref={cv} onPointerDown={down} onPointerUp={up} aria-label="Snake játék" />
      {!tv && mode !== 'play' && <div className="snakeover">
        {mode === 'over' && <b>Vége! {score} pont</b>}
        <button className="cta" onClick={start}>{mode === 'over' ? 'Újra' : '▶ Játssz te is'}</button>
        <small>Nyilak / WASD, vagy húzd az ujjad</small></div>}
    </div>
  </div>
}

const QUIPS = ['Pihenj egy nagyot!', 'Ma nincs csengő, csak nyugi.', 'Tölts fel, jön az új hét!', 'Az ágy ma erősebb, mint a csengő.', 'Játsz egyet, a házi úgyis ráér.', 'Szünet van, a csengő is alszik.']

/** Pihenő mód: ha nincs tanítás (hétvége, ünnep, szünet), vicces üzenet, a következő szünetig hátralévő idő és egy Snake-játék. */
export default function RestMode({ tv, reason, day, ev }: { tv: boolean; reason?: string; day: string; ev?: { icon: string; days: number; hours: number; mins: number; note: string } }) {
  const h = [...day].reduce((a, c) => a + c.charCodeAt(0), 0)
  return <section className="panel full rest">
    <div className="tag">Pihenő mód{reason ? `: ${reason}` : ''}</div>
    <div className="restgrid">
      <div className="restinfo">
        <h2>{QUIPS[h % QUIPS.length]}</h2>
        {ev && <div className="restcount">
          <span className="ico" aria-hidden="true">{ev.icon}</span>
          <b>{ev.days}</b><span>nap<small>{ev.hours} óra {ev.mins} perc</small></span>
          <em>{ev.note}</em>
        </div>}
      </div>
      <Snake tv={tv} />
    </div>
  </section>
}
