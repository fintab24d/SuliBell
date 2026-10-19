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
