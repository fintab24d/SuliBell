// Snake: tiszta játéklogika (nincs DOM), plusz egy gépi játékos a TV-s bemutatóhoz.
export type P = { x: number; y: number }
export interface G { cols: number; rows: number; snake: P[]; dir: P; food: P; score: number; dead: boolean }
export const DIRS: P[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }]
const same = (a: P, b: P) => a.x === b.x && a.y === b.y

export function newGame(cols = 20, rows = 14, rnd: () => number = Math.random): G {
  const y = rows >> 1, x = cols >> 2
  const g: G = { cols, rows, snake: [{ x: x + 2, y }, { x: x + 1, y }, { x, y }], dir: { x: 1, y: 0 }, food: { x: -1, y: -1 }, score: 0, dead: false }
  g.food = placeFood(g, rnd)
  return g
}
export function placeFood(g: G, rnd: () => number): P {
  const free: P[] = []
  for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) if (!g.snake.some(s => s.x === x && s.y === y)) free.push({ x, y })
  return free.length ? free[Math.floor(rnd() * free.length)] : { x: -1, y: -1 }
}
/** Egy lépés; d az új irány (a visszafordulást figyelmen kívül hagyja). */
export function step(g: G, d?: P, rnd: () => number = Math.random) {
  if (g.dead) return
  if (d && !(d.x === -g.dir.x && d.y === -g.dir.y)) g.dir = d
  const h = { x: g.snake[0].x + g.dir.x, y: g.snake[0].y + g.dir.y }
  const eat = same(h, g.food)
  const body = eat ? g.snake : g.snake.slice(0, -1)         // a farok elmozdul, ha nem eszünk
  if (h.x < 0 || h.y < 0 || h.x >= g.cols || h.y >= g.rows || body.some(s => same(s, h))) { g.dead = true; return }
  g.snake.unshift(h)
  if (eat) { g.score++; g.food = placeFood(g, rnd) } else g.snake.pop()
}

const key = (p: P) => p.y * 1000 + p.x
function blocked(g: G, skipTail = true) {
  const set = new Set<number>()
  g.snake.forEach((s, i) => { if (!(skipTail && i === g.snake.length - 1)) set.add(key(s)) })
  return set
}
const inside = (g: G, p: P) => p.x >= 0 && p.y >= 0 && p.x < g.cols && p.y < g.rows
function area(g: G, from: P, block: Set<number>) {
  const seen = new Set<number>([key(from)]), q = [from]
  while (q.length) { const c = q.pop()!; for (const d of DIRS) { const n = { x: c.x + d.x, y: c.y + d.y }; if (inside(g, n) && !block.has(key(n)) && !seen.has(key(n))) { seen.add(key(n)); q.push(n) } } }
  return seen.size
}
/** Gépi játékos: a legrövidebb úton az étel felé, de csak ha utána marad elég hely; különben a legtágasabb irányba. */
export function botDir(g: G): P {
  const block = blocked(g), head = g.snake[0]
  const moves = DIRS.filter(d => !(d.x === -g.dir.x && d.y === -g.dir.y)).map(d => ({ d, n: { x: head.x + d.x, y: head.y + d.y } }))
    .filter(m => inside(g, m.n) && !block.has(key(m.n)))
  if (!moves.length) return g.dir
  // legrövidebb út (BFS) az ételhez
  const prev = new Map<number, number>(), q: P[] = [head]; prev.set(key(head), -1)
  let found = false
  while (q.length && !found) {
    const c = q.shift()!
    for (const d of DIRS) {
      const n = { x: c.x + d.x, y: c.y + d.y }
      if (!inside(g, n) || (block.has(key(n)) && !same(n, g.food)) || prev.has(key(n))) continue
      prev.set(key(n), key(c)); if (same(n, g.food)) { found = true; break } q.push(n)
    }
  }
  const safe = (m: { d: P; n: P }) => {
    const b = blocked(g); b.add(key(m.n)); return area(g, m.n, b) >= g.snake.length + 1
  }
  if (found) {
    let k = key(g.food); while (prev.get(k) !== key(head)) k = prev.get(k)!
    const m = moves.find(m => key(m.n) === k)
    if (m && safe(m)) return m.d
  }
  const ranked = moves.map(m => { const b = blocked(g); b.add(key(m.n)); return { m, a: area(g, m.n, b) } }).sort((x, y) => y.a - x.a)
  return ranked[0].m.d
}

export type SnakeSkin = 'neon' | 'christmas'

/** Kirajzolja a Snake játéktáblát a választott kinézettel ('neon' vagy 'christmas' ünnepi skin). */
export function drawSnakeBoard(
  x: CanvasRenderingContext2D,
  width: number,
  height: number,
  G: G,
  skin: SnakeSkin,
  timeMs: number
) {
  const k = width / G.cols
  const t = timeMs / 260
  x.setTransform(1, 0, 0, 1, 0, 0)

  if (skin === 'christmas') {
    // Mély fenyőzöld havas játéktér
    const bg = x.createLinearGradient(0, 0, 0, height)
    bg.addColorStop(0, '#05150e')
    bg.addColorStop(1, '#0b2619')
    x.fillStyle = bg
    x.fillRect(0, 0, width, height)

    // Finom havas pontrács
    for (let i = 0; i < G.cols; i++) {
      for (let j = 0; j < G.rows; j++) {
        const twinkle = (i * 7 + j * 13) % 5 === 0 ? 0.24 : 0.11
        x.fillStyle = `rgba(225, 245, 255, ${twinkle})`
        x.beginPath()
        x.arc((i + 0.5) * k, (j + 0.5) * k, k * 0.055, 0, Math.PI * 2)
        x.fill()
      }
    }

    // Ajándékdoboz (étel): piros doboz, arany masni + szalag, finom pulzálás
    const f = G.food
    if (f.x >= 0) {
      const pulse = 1 + 0.07 * Math.sin(t)
      const cx = (f.x + 0.5) * k
      const cy = (f.y + 0.5) * k
      const sz = k * 0.68 * pulse
      const rx = cx - sz * 0.5
      const ry = cy - sz * 0.5

      x.shadowColor = '#ffd166'
      x.shadowBlur = k * 0.75
      x.fillStyle = '#e63946'
      x.beginPath()
      if (x.roundRect) x.roundRect(rx, ry, sz, sz, k * 0.12)
      else x.rect(rx, ry, sz, sz)
      x.fill()

      // Arany kereszt-szalag
      x.shadowBlur = 0
      x.fillStyle = '#ffd166'
      const rib = Math.max(2, sz * 0.2)
      x.fillRect(cx - rib * 0.5, ry, rib, sz)
      x.fillRect(rx, cy - rib * 0.5, sz, rib)

      // Masni a doboz tetején
      x.strokeStyle = '#ffe599'
      x.lineWidth = Math.max(1.5, k * 0.09)
      x.beginPath()
      x.ellipse(cx - sz * 0.16, ry - sz * 0.04, sz * 0.16, sz * 0.1, -0.35, 0, Math.PI * 2)
      x.ellipse(cx + sz * 0.16, ry - sz * 0.04, sz * 0.16, sz * 0.1, 0.35, 0, Math.PI * 2)
      x.stroke()
    }

    // Piros-fehér cukorpálca kígyó + Mikulás-sapka a fején
    G.snake.forEach((s, i) => {
      const isRed = i % 2 === 0
      const fill = G.dead ? '#ff3b5c' : isRed ? '#ef233c' : '#f8fafc'
      const glow = G.dead ? '#ff3b5c' : isRed ? '#ff4d6d' : '#ffd166'
      x.shadowColor = glow
      x.shadowBlur = k * 0.45
      x.fillStyle = fill
      const r = k * (i === 0 ? 0.45 : 0.39)
      const cx = (s.x + 0.5) * k
      const cy = (s.y + 0.5) * k
      const bx = cx - r
      const by = cy - r
      x.beginPath()
      if (x.roundRect) x.roundRect(bx, by, r * 2, r * 2, r * 0.52)
      else x.rect(bx, by, r * 2, r * 2)
      x.fill()

      // Fej részletei: szemek + mini Mikulás-sapka
      if (i === 0) {
        x.shadowBlur = 0
        // Szemek
        x.fillStyle = '#0b132b'
        const ex = G.dir.x * r * 0.25
        const ey = G.dir.y * r * 0.25
        const px = -G.dir.y * r * 0.34
        const py = G.dir.x * r * 0.34
        const er = Math.max(1.3, k * 0.085)
        x.beginPath()
        x.arc(cx + ex + px, cy + ey + py, er, 0, Math.PI * 2)
        x.arc(cx + ex - px, cy + ey - py, er, 0, Math.PI * 2)
        x.fill()

        // Mini Mikulás-sapka a fej tetején
        x.fillStyle = '#d90429'
        x.beginPath()
        x.moveTo(cx - r * 0.72, cy - r * 0.55)
        x.lineTo(cx + r * 0.72, cy - r * 0.55)
        x.lineTo(cx + r * 0.15, cy - r * 1.42)
        x.closePath()
        x.fill()

        // Fehér prém és bojt
        x.fillStyle = '#ffffff'
        x.fillRect(cx - r * 0.78, cy - r * 0.68, r * 1.56, Math.max(2, r * 0.28))
        x.beginPath()
        x.arc(cx + r * 0.22, cy - r * 1.42, Math.max(1.8, r * 0.26), 0, Math.PI * 2)
        x.fill()
      }
    })
    x.shadowBlur = 0
    return
  }

  // Alapértelmezett Neon Snake megjelenés
  x.fillStyle = '#080a1c'
  x.fillRect(0, 0, width, height)
  x.fillStyle = 'rgba(120,140,255,.14)'
  for (let i = 0; i < G.cols; i++) {
    for (let j = 0; j < G.rows; j++) {
      x.beginPath()
      x.arc((i + 0.5) * k, (j + 0.5) * k, k * 0.05, 0, Math.PI * 2)
      x.fill()
    }
  }
  const f = G.food
  if (f.x >= 0) {
    x.shadowColor = '#ffb02e'
    x.shadowBlur = k * 0.9
    x.fillStyle = '#ffb02e'
    x.beginPath()
    x.arc((f.x + 0.5) * k, (f.y + 0.5) * k, k * (0.28 + 0.05 * Math.sin(t)), 0, Math.PI * 2)
    x.fill()
  }
  const n = G.snake.length
  G.snake.forEach((s, i) => {
    const p = n > 1 ? i / (n - 1) : 0
    x.shadowColor = G.dead ? '#ff3b5c' : `hsl(${180 + p * 130} 100% 60%)`
    x.shadowBlur = k * 0.6
    x.fillStyle = G.dead ? '#ff3b5c' : `hsl(${180 + p * 130} 100% ${62 - p * 8}%)`
    const r = k * (i === 0 ? 0.44 : 0.38)
    const bx = (s.x + 0.5) * k - r
    const by = (s.y + 0.5) * k - r
    x.beginPath()
    if (x.roundRect) x.roundRect(bx, by, r * 2, r * 2, r * 0.5)
    else x.rect(bx, by, r * 2, r * 2)
    x.fill()
  })
  x.shadowBlur = 0
}
