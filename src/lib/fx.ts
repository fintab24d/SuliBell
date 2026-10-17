// Neon részecske-motor: keretrendszer-független, egyetlen <canvas>-ra rajzol.
// Lebegő neon "bokeh" gömbök, csillogó por, kattintásra szikrák, csengetéskor gyűrű-hullám és szikra-robbanás.
type RGB = [number, number, number]
const TAU = Math.PI * 2
const rnd = (a: number, b: number) => a + Math.random() * (b - a)

function parseColor(s: string): RGB | null {
  s = s.trim()
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (h) {
    let v = h[1]
    if (v.length === 3) v = v.split('').map(c => c + c).join('')
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
  }
  const r = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s)
  return r ? [+r[1], +r[2], +r[3]] : null
}
const FALLBACK: RGB[] = [[255, 79, 195], [45, 226, 255], [255, 176, 46], [57, 255, 122]]
const VARS = ['--n-pink', '--n-cyan', '--n-amber', '--n-green']
/** Az állapothoz tartozó hangsúlyszín indexe a palettán (óra: rózsaszín, szünet: cián, tanítás előtt: borostyán). */
export const PHASE_FOCUS: Record<string, number> = { lesson: 0, break: 1, before: 2, after: 3, closed: 3 }

function makeSprite([r, g, b]: RGB) {
  const s = document.createElement('canvas')
  s.width = s.height = 64
  const c = s.getContext('2d')!
  const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, 'rgba(255,255,255,.95)')
  gr.addColorStop(0.16, `rgba(${r},${g},${b},.9)`)
  gr.addColorStop(0.5, `rgba(${r},${g},${b},.22)`)
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`)
  c.fillStyle = gr
  c.fillRect(0, 0, 64, 64)
  return s
}

interface Orb { x: number; y: number; vx: number; vy: number; r: number; a: number; ci: number; cj: number; t: number; ph: number }
interface Dust { x: number; y: number; vx: number; vy: number; r: number; a: number; ci: number; ph: number; sp: number }
interface Spark { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number; ci: number }
interface Wave { x: number; y: number; r0: number; r1: number; t: number; max: number; ci: number }

export class FxEngine {
  private ctx: CanvasRenderingContext2D
  private w = 0
  private h = 0
  private dpr = 1
  private sc = 1
  private orbs: Orb[] = []
  private dust: Dust[] = []
  private sparks: Spark[] = []
  private waves: Wave[] = []
  private pal: RGB[] = []
  private sprites: HTMLCanvasElement[] = []
  private focus = 0
  private additive = true
  private raf = 0
  private last = 0
  private frame = 0
  private time = 0
  private running = false
  private lastTrail = 0
  private readonly maxFps: number

  constructor(private canvas: HTMLCanvasElement, private tv = false) {
    const c = canvas.getContext('2d')
    if (!c) throw new Error('A canvas nem érhető el')
    this.ctx = c
    this.maxFps = tv ? 30 : 50
    const cs = getComputedStyle(document.documentElement)
    this.pal = VARS.map((v, i) => parseColor(cs.getPropertyValue(v)) ?? FALLBACK[i])
    this.sprites = this.pal.map(makeSprite)
  }

  start() {
    if (this.running) return
    this.running = true
    this.resize()
    window.addEventListener('resize', this.onResize)
    window.addEventListener('pointerdown', this.onDown, { passive: true })
    window.addEventListener('pointermove', this.onMove, { passive: true })
    document.addEventListener('visibilitychange', this.onVis)
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }
  stop() {
    this.running = false
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointermove', this.onMove)
    document.removeEventListener('visibilitychange', this.onVis)
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  /** Az állapotváltáskor a gömbök fokozatosan átveszik az új állapot színét. */
  setPhase(phase: string) {
    const f = PHASE_FOCUS[phase] ?? 3
    if (f === this.focus) return
    this.focus = f
    for (const o of this.orbs) if (Math.random() < 0.7) { o.ci = o.t >= 1 ? o.cj : o.ci; o.cj = f; o.t = 0 }
  }

  /** Csengetés: gyűrű-hullámok és szikra-robbanás a számlap körül (x, y, a számlap sugara). */
  bell(x: number, y: number, rad: number) {
    for (let i = 0; i < 3; i++) this.waves.push({ x, y, r0: rad * 0.9, r1: rad * (2.6 + i * 0.7), t: -i * 0.16, max: 1.25, ci: this.focus })
    const n = this.tv ? 90 : 130
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), sp = rnd(140, 520)
      this.sparks.push({ x: x + Math.cos(a) * rad, y: y + Math.sin(a) * rad, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(3, 8), life: rnd(0.7, 1.6), max: 1.6, ci: this.pick(0.6) })
    }
    this.capSparks()
  }
  burst(x: number, y: number, n = 16, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), sp = rnd(60, 260) * power
      this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(2.5, 6), life: rnd(0.5, 1.2), max: 1.2, ci: this.pick(0.45) })
    }
    this.capSparks()
  }

  // ---- belső részek ----
  private onResize = () => this.resize()
  private onVis = () => {
    if (document.hidden) { cancelAnimationFrame(this.raf) }
    else if (this.running) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick) }
  }
  private onDown = (e: PointerEvent) => this.burst(e.clientX, e.clientY, 16, 1)
  private onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const n = performance.now()
    if (n - this.lastTrail < 40) return
    this.lastTrail = n
    for (let i = 0; i < 2; i++) this.sparks.push({ x: e.clientX, y: e.clientY, vx: rnd(-30, 30), vy: rnd(-30, 30), r: rnd(2, 4), life: rnd(0.4, 0.9), max: 0.9, ci: this.pick(0.4) })
    this.capSparks()
  }
  private pick(focusWeight: number) { return Math.random() < focusWeight ? this.focus : (Math.random() * this.pal.length) | 0 }
  private capSparks() { if (this.sparks.length > 420) this.sparks.splice(0, this.sparks.length - 420) }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight
    this.dpr = this.tv ? 1 : Math.min(window.devicePixelRatio || 1, 1.5)
    this.canvas.width = Math.round(w * this.dpr)
    this.canvas.height = Math.round(h * this.dpr)
    this.w = w; this.h = h
    this.sc = Math.max(0.6, Math.min(1.5, Math.min(w, h) / 900))
    const k = Math.min(1.4, Math.max(0.5, (w * h) / (1920 * 1080))) * (this.tv ? 0.6 : 1)
    const no = Math.round(14 * k), nd = Math.round(70 * k)
    while (this.orbs.length < no) this.orbs.push(this.newOrb())
    this.orbs.length = Math.min(this.orbs.length, no)
    while (this.dust.length < nd) this.dust.push(this.newDust())
    this.dust.length = Math.min(this.dust.length, nd)
  }
  private newOrb(): Orb {
    const c = this.pick(0.5)
    return { x: rnd(0, this.w), y: rnd(0, this.h), vx: rnd(-18, 18), vy: rnd(-14, 14), r: rnd(70, 170) * this.sc, a: rnd(0.05, 0.12), ci: c, cj: c, t: 1, ph: rnd(0, TAU) }
  }
  private newDust(): Dust {
    return { x: rnd(0, this.w), y: rnd(0, this.h), vx: rnd(-6, 6), vy: rnd(-26, -6), r: rnd(2, 6), a: rnd(0.25, 0.8), ci: this.pick(0.4), ph: rnd(0, TAU), sp: rnd(0.8, 2.6) }
  }

  private tick = (now: number) => {
    if (!this.running || document.hidden) return
    this.raf = requestAnimationFrame(this.tick)
    if (now - this.last < 1000 / this.maxFps - 1) return
    const dt = Math.min(0.05, (now - this.last) / 1000 || 0.016)
    this.last = now
    this.time += dt
    if (++this.frame % 30 === 0) this.additive = document.documentElement.dataset.theme !== 'light'
    this.step(dt)
    this.draw()
  }

  private step(dt: number) {
    const { w, h } = this
    for (const o of this.orbs) {
      o.x += o.vx * dt; o.y += o.vy * dt
      if (o.t < 1) { o.t = Math.min(1, o.t + dt / 1.4); if (o.t >= 1) o.ci = o.cj }
      if (o.x < -o.r) o.x = w + o.r; else if (o.x > w + o.r) o.x = -o.r
      if (o.y < -o.r) o.y = h + o.r; else if (o.y > h + o.r) o.y = -o.r
    }
    for (const d of this.dust) {
      d.x += d.vx * dt; d.y += d.vy * dt
      if (d.y < -10) { d.y = h + 10; d.x = rnd(0, w) }
      if (d.x < -10) d.x = w + 10; else if (d.x > w + 10) d.x = -10
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]
      s.life -= dt
      if (s.life <= 0) { this.sparks.splice(i, 1); continue }
      const drag = 1 - 2.2 * dt
      s.vx *= drag; s.vy = s.vy * drag + 90 * dt
      s.x += s.vx * dt; s.y += s.vy * dt
    }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      this.waves[i].t += dt
      if (this.waves[i].t > this.waves[i].max) this.waves.splice(i, 1)
    }
  }

  private spr(ci: number, x: number, y: number, r: number, a: number) {
    this.ctx.globalAlpha = Math.max(0, Math.min(1, a))
    this.ctx.drawImage(this.sprites[ci], x - r, y - r, r * 2, r * 2)
  }

  private draw() {
    const c = this.ctx, t = this.time
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    c.clearRect(0, 0, this.w, this.h)
    c.globalCompositeOperation = this.additive ? 'lighter' : 'source-over'
    const k = this.additive ? 1 : 0.75
    for (const o of this.orbs) {
      const a = o.a * (0.8 + 0.2 * Math.sin(t * 0.5 + o.ph)) * k
      if (o.t >= 1) this.spr(o.ci, o.x, o.y, o.r, a)
      else { this.spr(o.ci, o.x, o.y, o.r, a * (1 - o.t)); this.spr(o.cj, o.x, o.y, o.r, a * o.t) }
    }
    for (const d of this.dust) this.spr(d.ci, d.x, d.y, d.r * 2.2, d.a * (0.55 + 0.45 * Math.sin(t * d.sp + d.ph)) * k)
    for (const s of this.sparks) {
      const f = s.life / s.max
      const al = Math.pow(Math.max(0, Math.min(1, f)), 1.4) * k
      this.spr(s.ci, s.x, s.y, s.r * (0.6 + 0.4 * f) * 2.4, al)
      this.spr(s.ci, s.x - s.vx * 0.018, s.y - s.vy * 0.018, s.r * 1.6, al * 0.6)   // rövid csóva
    }
    c.globalAlpha = 1
    for (const wv of this.waves) {
      if (wv.t < 0) continue
      const p = wv.t / wv.max, e = 1 - Math.pow(1 - p, 3)
      const [r, g, b] = this.pal[wv.ci]
      c.beginPath()
      c.arc(wv.x, wv.y, wv.r0 + (wv.r1 - wv.r0) * e, 0, TAU)
      c.strokeStyle = `rgba(${r},${g},${b},${(1 - p) * 0.85 * k})`
      c.lineWidth = 2 + 6 * (1 - p)
      c.stroke()
    }
    c.globalCompositeOperation = 'source-over'
  }
}
