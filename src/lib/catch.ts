// Fogó-játék logika (nincs DOM): hulló tárgyakat kell elkapni, a rosszakat kerülni. Az ünnepi témák csak a megjelenésben különböznek.
export const W = 220, H = 140, CW = 15            // pálya mérete, a kosár fél szélessége
export interface Item { x: number; y: number; vy: number; kind: 0 | 1 | 2; e: number; rot: number; vr: number }   // 0 jó, 1 arany (+5), 2 rossz (-1 élet)
export interface C { cx: number; tx: number; items: Item[]; score: number; lives: number; spawn: number; dead: boolean; flash: number }

export const newCatch = (): C => ({ cx: W / 2, tx: W / 2, items: [], score: 0, lives: 5, spawn: 0.4, dead: false, flash: 0 })

export function stepCatch(c: C, dt: number, rnd: () => number = Math.random) {
  if (c.dead) return
  const speed = Math.min(112, 42 + c.score * 1.1), rate = Math.min(2.3, 0.8 + c.score * 0.02)
  c.spawn -= dt
  if (c.spawn <= 0) {
    c.spawn += (1 / rate) * (0.7 + rnd() * 0.6)
    const r = rnd(), bad = 0.18 + Math.min(0.17, c.score * 0.004)
    c.items.push({ x: 10 + rnd() * (W - 20), y: -8, vy: speed * (0.85 + rnd() * 0.3), kind: r < 0.07 ? 1 : r < 0.07 + bad ? 2 : 0, e: Math.floor(rnd() * 3), rot: rnd() * 6, vr: (rnd() - 0.5) * 3 })
  }
  const d = c.tx - c.cx
  c.cx += Math.sign(d) * Math.min(Math.abs(d), 300 * dt)
  c.cx = Math.max(CW, Math.min(W - CW, c.cx))
  c.flash = Math.max(0, c.flash - dt * 3)
  for (let i = c.items.length - 1; i >= 0; i--) {
    const it = c.items[i]
    it.y += it.vy * dt; it.rot += it.vr * dt
    if (it.y > H - 28 && it.y < H - 6 && Math.abs(it.x - c.cx) < CW) {
      if (it.kind === 2) { c.lives--; c.flash = 1; if (c.lives <= 0) c.dead = true } else c.score += it.kind === 1 ? 5 : 1
      c.items.splice(i, 1)
    } else if (it.y > H + 12) c.items.splice(i, 1)
  }
}

/** Gépi játékos: a legalsó elérhető jó tárgy alá áll, a rosszaktól elhúzódik. */
export function botTarget(c: C): number {
  const goods = c.items.filter(i => i.kind !== 2 && i.y < H - 10)
  let best: Item | null = null
  for (const g of goods) {
    const t = (H - 18 - g.y) / g.vy
    if (Math.abs(g.x - c.cx) / 300 <= t + 0.05 && (!best || g.y > best.y)) best = g
  }
  let x = best ? best.x : c.cx
  for (const b of c.items) if (b.kind === 2 && b.y > H - 80 && b.y < H - 4 && Math.abs(b.x - x) < CW + 4) {
    x = b.x < x ? Math.min(W - CW, b.x + CW + 6) : Math.max(CW, b.x - CW - 6)
  }
  return x
}
