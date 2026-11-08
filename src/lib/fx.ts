// Neon részecske-motor: két rétegen (<canvas>) rajzol:
// 1. Háttér (fxcanvas-bg, z-index: -1): lebegő neon "bokeh" gömbök, csillogó por, csengetéskori gyűrű-hullámok, vihar villanások.
// 2. Előtér (fxcanvas-fg, z-index: 10): valódi időjárás (eső/hó a kártyák előtt), csapódás és szétfröccsenés a kártyák tetején,
//    megmaradó hósapka a paneleken, kattintás-szikrák és konfetti/tűzijáték.
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
interface Drop { x: number; y: number; v: number; len: number; a: number; ph: number; r: number }
interface Splash { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number; alpha: number }
interface Ripple { x: number; y: number; r: number; maxR: number; life: number; max: number }
interface Rocket { x: number; y: number; vy: number; ty: number; ci: number }
interface Paper { x: number; y: number; vx: number; vy: number; rot: number; vr: number; w: number; h: number; col: RGB; ph: number }
interface Wave { x: number; y: number; r0: number; r1: number; t: number; max: number; ci: number }

interface Ledge {
  el: Element
  x0: number
  x1: number
  y: number
  snowDepth: number // 0..1 (a felhalmozódott hó vastagsága)
}

/** WMO időjárási kód → effekt: eső, hó, vihar vagy semmi (a második szám az erősség). */
export function weatherKind(code: number | null | undefined): ['none' | 'rain' | 'snow' | 'storm', number] {
  if (code == null) return ['none', 0]
  if (code >= 95) return ['storm', 1.3]
  if (code >= 71 && code <= 77) return ['snow', 1]
  if (code === 85 || code === 86) return ['snow', 1.3]
  if (code >= 51 && code <= 57) return ['rain', 0.5]
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['rain', code === 65 || code === 67 || code === 82 ? 1.5 : 1]
  return ['none', 0]
}

export class FxEngine {
  private ctxBg: CanvasRenderingContext2D
  private ctxFg: CanvasRenderingContext2D | null = null
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
  private wkind: 'none' | 'rain' | 'snow' | 'storm' = 'none'
  private wpow = 0
  private drops: Drop[] = []
  private splashes: Splash[] = []
  private ripples: Ripple[] = []
  private ledges: Ledge[] = []
  private lastLedgeScan = 0
  private rockets: Rocket[] = []
  private papers: Paper[] = []
  private queue: { t: number; fn: () => void }[] = []
  private flash = 0
  private nextBolt = 0
  private snowSprite!: HTMLCanvasElement
  /** Hangjelzés a tűzijáték / konfetti eseményeire (pan: -1…1). */
  onSound?: (kind: 'launch' | 'boom' | 'pop', pan: number) => void
  private readonly maxFps: number

  constructor(
    private canvasBg: HTMLCanvasElement,
    private canvasFg?: HTMLCanvasElement | null,
    private tv = false
  ) {
    const cBg = canvasBg.getContext('2d')
    if (!cBg) throw new Error('A háttér canvas nem érhető el')
    this.ctxBg = cBg
    if (canvasFg) {
      this.ctxFg = canvasFg.getContext('2d')
    }
    this.maxFps = tv ? 30 : 50
    const cs = getComputedStyle(document.documentElement)
    this.pal = VARS.map((v, i) => parseColor(cs.getPropertyValue(v)) ?? FALLBACK[i])
    this.sprites = this.pal.map(makeSprite)
    this.snowSprite = makeSprite([235, 245, 255])
  }

  start() {
    if (this.running) return
    this.running = true
    this.resize()
    window.addEventListener('resize', this.onResize)
    window.addEventListener('scroll', this.onScroll, { passive: true })
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
    window.removeEventListener('scroll', this.onScroll)
    window.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointermove', this.onMove)
    document.removeEventListener('visibilitychange', this.onVis)
    this.ctxBg.clearRect(0, 0, this.canvasBg.width, this.canvasBg.height)
    if (this.ctxFg && this.canvasFg) {
      this.ctxFg.clearRect(0, 0, this.canvasFg.width, this.canvasFg.height)
    }
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

  /** Valódi időjárás: eső, hó, vihar (villámlással). Folyamatosan záporozik, csapódik a kártyákra. */
  setWeather(code: number | null | undefined) {
    const [k, p] = weatherKind(code)
    if (this.wkind === k && this.wpow === p) return
    this.wkind = k
    this.wpow = p
    this.nextBolt = this.time + rnd(3, 7)
    this.scanLedges(true)
    this.fitDrops()
  }

  /** Nagy pillanat: tűzijáték és/vagy konfetti. */
  celebrate(kind: 'fireworks' | 'confetti' | 'both' = 'both', power = 1) {
    const k = this.tv ? 0.7 : 1
    if (kind !== 'fireworks') {
      const n = Math.round(9 * power)
      for (let i = 0; i < n; i++) this.queue.push({ t: this.time + 0.2 + i * 0.55 + rnd(0, 0.25), fn: () => this.launch(rnd(0.12, 0.88)) })
    }
    if (kind !== 'fireworks') {
      const n = Math.round(150 * power * k)
      for (let i = 0; i < n; i++) this.queue.push({ t: this.time + rnd(0, 2.2), fn: () => this.papers.push(this.newPaper()) })
      for (const at of [0, 0.35, 0.8]) this.queue.push({ t: this.time + at, fn: () => this.onSound?.('pop', rnd(-0.8, 0.8)) })
    }
  }

  private launch(fx: number) {
    this.onSound?.('launch', fx * 2 - 1)
    this.rockets.push({ x: this.w * fx, y: this.h + 10, vy: -rnd(this.h * 0.75, this.h * 1.0), ty: rnd(this.h * 0.14, this.h * 0.45), ci: (Math.random() * this.pal.length) | 0 })
  }

  private explode(x: number, y: number, ci: number) {
    this.onSound?.('boom', (x / this.w) * 2 - 1)
    const n = this.tv ? 60 : 85, sp0 = rnd(190, 330) * this.sc, two = (ci + 1 + ((Math.random() * 3) | 0)) % this.pal.length
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(-0.05, 0.05), sp = sp0 * (i % 2 ? 1 : 0.62) * rnd(0.92, 1.05)
      this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(3, 6), life: rnd(1.1, 1.8), max: 1.8, ci: i % 2 ? ci : two })
    }
    this.waves.push({ x, y, r0: 4, r1: sp0 * 0.45, t: 0, max: 0.5, ci })
    this.capSparks()
  }

  private newPaper(): Paper {
    const cols: RGB[] = [...this.pal, [138, 92, 255], [255, 255, 255]]
    return { x: rnd(0, this.w), y: rnd(-40, -8), vx: rnd(-40, 40), vy: rnd(130, 260), rot: rnd(0, TAU), vr: rnd(-6, 6), w: rnd(7, 13) * this.sc, h: rnd(4, 8) * this.sc, col: cols[(Math.random() * cols.length) | 0], ph: rnd(0, TAU) }
  }

  private fitDrops() {
    const area = Math.min(1.4, Math.max(0.5, (this.w * this.h) / (1920 * 1080))) * (this.tv ? 0.6 : 1)
    const want = this.wkind === 'none' ? 0 : Math.round((this.wkind === 'snow' ? 130 : 200) * this.wpow * area)
    while (this.drops.length < want) this.drops.push(this.newDrop(true))
    this.drops.length = Math.min(this.drops.length, want)
  }

  private newDrop(anywhere: boolean): Drop {
    const snow = this.wkind === 'snow'
    // Eső esetén jobbra kissé kiterjesztett sávból indul a balra dőlő esés miatt (-0.16 slant)
    const x = snow ? rnd(-20, this.w + 20) : rnd(-20, this.w + 220)
    const y = anywhere ? rnd(0, this.h) : rnd(-60, -5)
    return {
      x,
      y,
      v: snow ? rnd(45, 95) : rnd(680, 960),
      len: rnd(16, 32) * this.sc,
      a: rnd(0.5, 0.95),
      ph: rnd(0, TAU),
      r: rnd(3.5, 8)
    }
  }

  private createRainSplash(x: number, y: number) {
    const n = (Math.random() * 3 + 2) | 0
    for (let i = 0; i < n; i++) {
      this.splashes.push({
        x: x + rnd(-2, 2),
        y: y - 1,
        vx: rnd(-45, 20),
        vy: -rnd(60, 140) * this.sc,
        r: rnd(1.2, 2.2) * this.sc,
        life: rnd(0.16, 0.32),
        max: 0.32,
        alpha: rnd(0.65, 0.95),
      })
    }
    this.ripples.push({
      x,
      y: y + 1,
      r: 1,
      maxR: rnd(4, 9) * this.sc,
      life: 0.28,
      max: 0.28,
    })
  }

  burst(x: number, y: number, n = 16, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), sp = rnd(60, 260) * power
      this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(2.5, 6), life: rnd(0.5, 1.2), max: 1.2, ci: this.pick(0.45) })
    }
    this.capSparks()
  }

  // ---- kártya-peremek szkennelése a hósapkához és eső-becsapódáshoz ----
  private scanLedges(force = false) {
    const now = performance.now()
    if (!force && now - this.lastLedgeScan < 800) return
    this.lastLedgeScan = now

    // Csak a legfelső szintű kártyákat/paneleket gyűjtjük be
    const els = Array.from(
      document.querySelectorAll<HTMLElement>('.panel, .bento-hdr, .ticker, .testlab-card')
    ).filter(el => {
      let p = el.parentElement
      while (p) {
        if (p.matches && p.matches('.panel, .bento-hdr, .ticker, .testlab-card')) return false
        p = p.parentElement
      }
      return true
    })

    const prevMap = new Map<Element, Ledge>()
    for (const l of this.ledges) prevMap.set(l.el, l)

    const next: Ledge[] = []
    const vh = window.innerHeight, vw = window.innerWidth

    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (r.width <= 30 || r.height <= 20) continue
      if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue

      const old = prevMap.get(el)
      next.push({
        el,
        x0: Math.max(0, r.left),
        x1: Math.min(vw, r.right),
        y: r.top,
        snowDepth: old ? old.snowDepth : (this.wkind === 'snow' ? 0.35 : 0),
      })
    }

    this.ledges = next
  }

  private onScroll = () => {
    // Görgetéskor a kártyák pozíciója azonnal frissül
    const vw = window.innerWidth
    for (const l of this.ledges) {
      const r = l.el.getBoundingClientRect()
      l.x0 = Math.max(0, r.left)
      l.x1 = Math.min(vw, r.right)
      l.y = r.top
    }
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
  private capSparks() { if (this.sparks.length > 800) this.sparks.splice(0, this.sparks.length - 800) }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight
    this.dpr = this.tv ? 1 : Math.min(window.devicePixelRatio || 1, 1.5)
    this.canvasBg.width = Math.round(w * this.dpr)
    this.canvasBg.height = Math.round(h * this.dpr)
    if (this.canvasFg) {
      this.canvasFg.width = Math.round(w * this.dpr)
      this.canvasFg.height = Math.round(h * this.dpr)
    }
    this.w = w; this.h = h
    this.sc = Math.max(0.6, Math.min(1.5, Math.min(w, h) / 900))
    const k = Math.min(1.4, Math.max(0.5, (w * h) / (1920 * 1080))) * (this.tv ? 0.6 : 1)
    const no = Math.round(14 * k), nd = Math.round(70 * k)
    while (this.orbs.length < no) this.orbs.push(this.newOrb())
    this.orbs.length = Math.min(this.orbs.length, no)
    while (this.dust.length < nd) this.dust.push(this.newDust())
    this.dust.length = Math.min(this.dust.length, nd)
    this.scanLedges(true)
    this.fitDrops()
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
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].t <= this.time) { const q = this.queue.splice(i, 1)[0]; q.fn() }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]
      r.y += r.vy * dt; r.vy *= 1 - 0.6 * dt
      if (Math.random() < 0.8) this.sparks.push({ x: r.x + rnd(-2, 2), y: r.y, vx: rnd(-14, 14), vy: rnd(10, 50), r: rnd(2, 3.5), life: rnd(0.25, 0.5), max: 0.5, ci: r.ci })
      if (r.y <= r.ty || r.vy > -60) { this.explode(r.x, r.y, r.ci); this.rockets.splice(i, 1) }
    }
    for (let i = this.papers.length - 1; i >= 0; i--) {
      const q = this.papers[i]
      q.y += q.vy * dt; q.x += (q.vx + Math.sin(this.time * 2.4 + q.ph) * 55) * dt; q.rot += q.vr * dt
      if (q.y > h + 20) this.papers.splice(i, 1)
    }

    // Időjárás és kártyákkal való ütközés
    if (this.wkind !== 'none') {
      this.scanLedges()
      const snow = this.wkind === 'snow'
      const isRain = this.wkind === 'rain' || this.wkind === 'storm'

      for (const d of this.drops) {
        const prevY = d.y
        d.y += d.v * dt
        d.x += (snow ? Math.sin(this.time * 0.9 + d.ph) * 24 : -d.v * 0.16) * dt

        let hit = false

        if (snow) {
          // Hópihe leérkezik a kártya tetejére és megmarad rajta
          for (const l of this.ledges) {
            if (d.x >= l.x0 - 4 && d.x <= l.x1 + 4) {
              if (prevY <= l.y + 4 && d.y >= l.y - 2) {
                hit = true
                l.snowDepth = Math.min(1, l.snowDepth + 0.02)
                break
              }
            }
          }
        } else if (isRain) {
          // Esőcsepp rácsapódik a kártya tetejére és fröccsen
          for (const l of this.ledges) {
            if (d.x >= l.x0 - 2 && d.x <= l.x1 + 2) {
              const topY = l.y - l.snowDepth * 8 * this.sc
              if (prevY <= topY + 4 && d.y >= topY - 2) {
                // 75% esély a becsapódásra a peremen, 25% az előtérben hullik tovább
                if (Math.random() < 0.75) {
                  hit = true
                  this.createRainSplash(d.x, topY)
                  if (l.snowDepth > 0) l.snowDepth = Math.max(0, l.snowDepth - 0.04)
                  break
                }
              }
            }
          }
          // A képernyő aljára csapódás (padló)
          if (!hit && d.y >= h - 4) {
            if (Math.random() < 0.5) this.createRainSplash(d.x, h - 3)
            hit = true
          }
        }

        if (hit || d.y > h + 30 || d.x < -60 || d.x > w + 240) {
          Object.assign(d, this.newDrop(false))
        }
      }

      // Hófelhalmozódás és olvadás a kártyákon
      for (const l of this.ledges) {
        if (snow) {
          l.snowDepth = Math.min(1, l.snowDepth + dt * 0.035)
        } else {
          l.snowDepth = Math.max(0, l.snowDepth - dt * (isRain ? 0.35 : 0.06))
        }
      }

      if (this.wkind === 'storm' && this.time > this.nextBolt) {
        this.flash = 1
        this.nextBolt = this.time + rnd(5, 12)
        this.queue.push({ t: this.time + 0.18, fn: () => { this.flash = 0.8 } })
      }
    } else {
      // Ha nincs időjárás, a meglévő hó lassan elolvad
      for (const l of this.ledges) {
        if (l.snowDepth > 0) l.snowDepth = Math.max(0, l.snowDepth - dt * 0.06)
      }
    }

    // Eső fröccsenések (splashes) mozgása
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i]
      s.life -= dt
      if (s.life <= 0) { this.splashes.splice(i, 1); continue }
      s.vy += 450 * dt
      s.x += s.vx * dt
      s.y += s.vy * dt
    }
    if (this.splashes.length > 300) this.splashes.splice(0, this.splashes.length - 300)

    // Eső gyűrűk (ripples) tágulása
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]
      r.life -= dt
      if (r.life <= 0) { this.ripples.splice(i, 1); continue }
      const prog = 1 - r.life / r.max
      r.r = 1 + (r.maxR - 1) * prog
    }
    if (this.ripples.length > 200) this.ripples.splice(0, this.ripples.length - 200)

    this.flash = Math.max(0, this.flash - dt * 3.2)
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

  private spr(c: CanvasRenderingContext2D, ci: number, x: number, y: number, r: number, a: number) {
    c.globalAlpha = Math.max(0, Math.min(1, a))
    c.drawImage(this.sprites[ci], x - r, y - r, r * 2, r * 2)
  }

  private drawSnowCaps(c: CanvasRenderingContext2D) {
    const isDark = this.additive
    for (const l of this.ledges) {
      if (l.snowDepth <= 0.04) continue
      const w = l.x1 - l.x0
      if (w <= 20) continue
      if (l.y < -30 || l.y > this.h + 20) continue

      const h = l.snowDepth * 10 * this.sc
      const y = l.y
      const x0 = l.x0 + 2
      const x1 = l.x1 - 2

      c.save()
      c.shadowColor = isDark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(0, 40, 80, 0.15)'
      c.shadowBlur = 4
      c.shadowOffsetY = 2

      c.beginPath()
      c.moveTo(x0 + 8, y + 2)
      c.lineTo(x1 - 8, y + 2)
      c.quadraticCurveTo(x1 + 1, y, x1, y - h * 0.6)

      const bumpW = 26 * this.sc
      const count = Math.max(2, Math.round((x1 - x0) / bumpW))
      const step = (x1 - x0) / count
      for (let i = count; i >= 0; i--) {
        const curX = x0 + i * step
        const prevX = x0 + Math.max(0, i - 1) * step
        const midX = (curX + prevX) / 2
        const varH = Math.sin((curX + l.y) * 0.05) * 1.5
        c.quadraticCurveTo(midX, y - h - varH - 1, prevX, y - h * 0.7)
      }

      c.quadraticCurveTo(x0 - 1, y, x0 + 8, y + 2)
      c.closePath()

      const grad = c.createLinearGradient(0, y - h - 2, 0, y + 2)
      if (isDark) {
        grad.addColorStop(0, '#ffffff')
        grad.addColorStop(0.7, '#f0f6ff')
        grad.addColorStop(1, '#d8e8fc')
      } else {
        grad.addColorStop(0, '#ffffff')
        grad.addColorStop(0.7, '#eef5fc')
        grad.addColorStop(1, '#cce0f5')
      }
      c.fillStyle = grad
      c.fill()

      c.shadowColor = 'transparent'
      c.fillStyle = isDark ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.85)'
      for (let i = 1; i < count; i++) {
        const bx = x0 + i * step
        const by = y - h - Math.sin((bx + l.y) * 0.05) * 1.5
        c.beginPath()
        c.arc(bx, by + 1.5, 1.2 * this.sc, 0, TAU)
        c.fill()
      }

      c.restore()
    }
  }

  private draw() {
    const cBg = this.ctxBg
    const cFg = this.ctxFg ?? this.ctxBg
    const t = this.time

    // 1. Háttér canvas (orbs, dust, hullámok)
    cBg.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    cBg.clearRect(0, 0, this.w, this.h)
    cBg.globalCompositeOperation = this.additive ? 'lighter' : 'source-over'
    const k = this.additive ? 1 : 0.75

    for (const o of this.orbs) {
      const a = o.a * (0.8 + 0.2 * Math.sin(t * 0.5 + o.ph)) * k
      if (o.t >= 1) this.spr(cBg, o.ci, o.x, o.y, o.r, a)
      else { this.spr(cBg, o.ci, o.x, o.y, o.r, a * (1 - o.t)); this.spr(cBg, o.cj, o.x, o.y, o.r, a * o.t) }
    }
    for (const d of this.dust) this.spr(cBg, d.ci, d.x, d.y, d.r * 2.2, d.a * (0.55 + 0.45 * Math.sin(t * d.sp + d.ph)) * k)

    for (const wv of this.waves) {
      if (wv.t < 0) continue
      const p = wv.t / wv.max, e = 1 - Math.pow(1 - p, 3)
      const [r, g, b] = this.pal[wv.ci]
      cBg.beginPath()
      cBg.arc(wv.x, wv.y, wv.r0 + (wv.r1 - wv.r0) * e, 0, TAU)
      cBg.strokeStyle = `rgba(${r},${g},${b},${(1 - p) * 0.85 * k})`
      cBg.lineWidth = 2 + 6 * (1 - p)
      cBg.stroke()
    }

    if (this.flash > 0.02) {
      cBg.globalAlpha = this.flash * (this.additive ? 0.22 : 0.4)
      cBg.fillStyle = '#e8f0ff'
      cBg.fillRect(0, 0, this.w, this.h)
      cBg.globalAlpha = 1
    }

    // 2. Előtér canvas (időjárás a kártyák előtt, hósapka a kártyákon, csobbanások, szikrák, konfetti)
    if (this.ctxFg) {
      cFg.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
      cFg.clearRect(0, 0, this.w, this.h)
    }

    // Hósapkák a kártyák tetején
    this.drawSnowCaps(cFg)

    // Időjárás (eső vagy hó a kártyák előtt)
    if (this.drops.length) {
      const isDark = this.additive
      const snow = this.wkind === 'snow'
      cFg.globalCompositeOperation = 'source-over'
      if (snow) {
        for (const d of this.drops) {
          cFg.globalAlpha = Math.min(1, d.a * 1.1)
          cFg.drawImage(isDark ? this.snowSprite : this.sprites[1], d.x - d.r * 1.6, d.y - d.r * 1.6, d.r * 3.2, d.r * 3.2)
        }
      } else {
        const [r, g, b] = isDark ? [135, 220, 255] : [35, 90, 190]
        cFg.lineCap = 'round'
        cFg.lineWidth = Math.max(1.8, 2.2 * this.sc)
        for (const d of this.drops) {
          cFg.strokeStyle = `rgba(${r},${g},${b},${Math.min(1, d.a * 1.1)})`
          cFg.beginPath()
          cFg.moveTo(d.x, d.y)
          cFg.lineTo(d.x + d.len * 0.16, d.y - d.len)
          cFg.stroke()
        }
      }
      cFg.globalAlpha = 1
    }

    // Esőbecsapódási gyűrűk a kártyák tetején
    if (this.ripples.length) {
      const isDark = this.additive
      for (const rip of this.ripples) {
        const f = rip.life / rip.max
        cFg.strokeStyle = isDark ? `rgba(160, 230, 255, ${f * 0.75})` : `rgba(40, 100, 200, ${f * 0.6})`
        cFg.lineWidth = 1.2 * this.sc
        cFg.beginPath()
        cFg.ellipse(rip.x, rip.y, rip.r * 1.6, rip.r * 0.5, 0, 0, TAU)
        cFg.stroke()
      }
    }

    // Esőbecsapódási fröccsenések (vízcseppek)
    if (this.splashes.length) {
      const isDark = this.additive
      for (const s of this.splashes) {
        const f = s.life / s.max
        cFg.fillStyle = isDark ? `rgba(180, 235, 255, ${f * s.alpha})` : `rgba(45, 110, 210, ${f * s.alpha})`
        cFg.beginPath()
        cFg.arc(s.x, s.y, s.r, 0, TAU)
        cFg.fill()
      }
    }

    // Kattintás és mozgás szikrák az előtérben
    cFg.globalCompositeOperation = this.additive ? 'lighter' : 'source-over'
    for (const s of this.sparks) {
      const f = s.life / s.max
      const al = Math.pow(Math.max(0, Math.min(1, f)), 1.4) * k
      this.spr(cFg, s.ci, s.x, s.y, s.r * (0.6 + 0.4 * f) * 2.4, al)
      this.spr(cFg, s.ci, s.x - s.vx * 0.018, s.y - s.vy * 0.018, s.r * 1.6, al * 0.6)
    }
    cFg.globalAlpha = 1

    // Ünneplés: rakéták és konfetti az előtérben
    cFg.globalCompositeOperation = 'source-over'
    for (const r of this.rockets) this.spr(cFg, this.focus, r.x, r.y, 12, 1)
    cFg.globalAlpha = 1
    for (const q of this.papers) {
      cFg.save(); cFg.translate(q.x, q.y); cFg.rotate(q.rot)
      cFg.scale(1, Math.cos(this.time * 5 + q.ph))
      cFg.fillStyle = `rgb(${q.col[0]},${q.col[1]},${q.col[2]})`
      cFg.fillRect(-q.w / 2, -q.h / 2, q.w, q.h)
      cFg.restore()
    }
  }
}
