// Neon részecske-motor: három rétegen dolgozik, adaptív "potato PC" optimalizációval:
// 1. Háttér (fxcanvas-bg, fixed, z-index: -1): lebegő bokeh gömbök, csillogó por, csengetéskori gyűrű-hullámok,
//    napsugárzás (derült), sodródó felhők (borult/részben felhős), több rétegű köd (ködös), villámcsapások és égi villanás (vihar).
// 2. Kártyákhoz kötött réteg (fx-ledges-root, absolute dokumentum-réteg, z-index: 10): a látható kártyák tetején megmaradó
//    hósapka és becsapódó eső-fröccsenések/vízgyűrűk — görgetéskor nulla elcsúszással és nulla layout-thrashinggel.
// 3. Előtér (fxcanvas-fg, fixed, z-index: 10): szitálás / eső / zivatar / hó / lebegő ködfátyol, szikrák, tűzijáték és konfetti.
type RGB = [number, number, number]
const TAU = Math.PI * 2
const rnd = (a: number, b: number) => a + Math.random() * (b - a)

const LEDGE_OFFSET_Y = 30 // Hány px hely van a kártya felső éle felett a hósapkának és felcsapódó cseppeknek
const LEDGE_BELOW_Y = 8   // Hány px nyúlik a kártya felső éle alá
const LEDGE_H = LEDGE_OFFSET_Y + LEDGE_BELOW_Y

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

/** Előre lerenderelt puha ködfelhő-textúra (128x128), hogy futás közben csak egyetlen GPU blit (drawImage) legyen. */
function makeMistSprite([r, g, b]: RGB) {
  const s = document.createElement('canvas')
  s.width = s.height = 128
  const c = s.getContext('2d')!
  const gr = c.createRadialGradient(64, 64, 4, 64, 64, 64)
  gr.addColorStop(0, `rgba(${r},${g},${b},.78)`)
  gr.addColorStop(0.42, `rgba(${r},${g},${b},.36)`)
  gr.addColorStop(0.75, `rgba(${r},${g},${b},.1)`)
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`)
  c.fillStyle = gr
  c.fillRect(0, 0, 128, 128)
  return s
}

/** Előre lerenderelt több-pamacsos felhő sprite (220x96). */
function makeCloudSprite([r, g, b]: RGB) {
  const s = document.createElement('canvas')
  s.width = 220
  s.height = 96
  const c = s.getContext('2d')!
  const puffs: [number, number, number, number][] = [
    [56, 56, 36, 0.55],
    [98, 42, 44, 0.72],
    [142, 46, 38, 0.65],
    [176, 58, 30, 0.48],
    [114, 62, 34, 0.5],
  ]
  for (const [px, py, pr, pa] of puffs) {
    const gr = c.createRadialGradient(px, py, pr * 0.15, px, py, pr)
    gr.addColorStop(0, `rgba(${r},${g},${b},${pa})`)
    gr.addColorStop(0.65, `rgba(${r},${g},${b},${pa * 0.35})`)
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`)
    c.fillStyle = gr
    c.fillRect(px - pr, py - pr, pr * 2, pr * 2)
  }
  return s
}

interface Orb { x: number; y: number; vx: number; vy: number; r: number; a: number; ci: number; cj: number; t: number; ph: number }
interface Dust { x: number; y: number; vx: number; vy: number; r: number; a: number; ci: number; ph: number; sp: number }
interface Spark { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number; ci: number }
interface Drop { x: number; y: number; v: number; len: number; a: number; bucket: 0 | 1 | 2; ph: number; r: number }
interface MistBand { x: number; y: number; vx: number; w: number; h: number; a: number; ph: number; fg: boolean }
interface Bolt { pts: [number, number][]; branches: [number, number][][]; life: number; max: number }
interface Splash { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number; alpha: number }
interface Ripple { x: number; y: number; r: number; maxR: number; life: number; max: number }
interface Rocket { x: number; y: number; vy: number; ty: number; ci: number }
interface Paper { x: number; y: number; vx: number; vy: number; rot: number; vr: number; w: number; h: number; colStr: string; ph: number }
interface Wave { x: number; y: number; r0: number; r1: number; t: number; max: number; ci: number }

interface Ledge {
  el: HTMLElement
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  docX: number
  docY: number
  vx0: number
  vx1: number
  vy: number
  w: number
  seed: number
  snowDepth: number // 0..1 (a felhalmozódott hó vastagsága)
  drawnSnow: number // utoljára kirajzolt hóvastagság (felesleges újrarajzolás elkerülésére)
  splashes: Splash[]
  ripples: Ripple[]
  empty: boolean
}

export type WeatherKind = 'none' | 'clear' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm'

/** WMO időjárási kód -> részletes animációtípus + erősség. */
export function weatherKind(code: number | null | undefined): [WeatherKind, number] {
  if (code == null) return ['none', 0]
  if (code >= 95) return ['storm', code >= 96 ? 1.45 : 1.25]             // Zivatar / Vihar (nagyon sok + villám)
  if (code === 85 || code === 86) return ['snow', 1.35]                  // Hózápor
  if (code >= 71 && code <= 77) return ['snow', code === 75 ? 1.35 : 1]  // Havazás
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {        // Eső / Zápor (több csapadék)
    const heavy = code === 65 || code === 67 || code === 82
    return ['rain', heavy ? 1.45 : 1.0]
  }
  if (code >= 51 && code <= 57) {                                        // Szitálás (kevés, finom csepp)
    return ['drizzle', code >= 55 ? 0.45 : 0.32]
  }
  if (code === 45 || code === 48) return ['fog', code === 48 ? 1.25 : 1] // Ködös
  if (code === 3) return ['cloudy', 1.25]                                // Borult
  if (code === 1 || code === 2) return ['cloudy', 0.7]                   // Részben felhős
  if (code === 0) return ['clear', 1]                                    // Derült / Napsütés
  return ['none', 0]
}

export class FxEngine {
  private ctxBg: CanvasRenderingContext2D
  private ctxFg: CanvasRenderingContext2D | null = null
  private ledgesRoot: HTMLDivElement | null = null
  private resizeObs: ResizeObserver | null = null
  private w = 0
  private h = 0
  private dpr = 1
  private ledgeDpr = 1
  private sc = 1
  private scrollX = 0
  private scrollY = 0
  private orbs: Orb[] = []
  private dust: Dust[] = []
  private sparks: Spark[] = []
  private waves: Wave[] = []
  private pal: RGB[] = []
  private sprites: HTMLCanvasElement[] = []
  private snowSprite!: HTMLCanvasElement
  private sunSprite!: HTMLCanvasElement
  private mistDarkSprite!: HTMLCanvasElement
  private mistLightSprite!: HTMLCanvasElement
  private cloudDarkSprite!: HTMLCanvasElement
  private cloudLightSprite!: HTMLCanvasElement
  private focus = 0
  private additive = true
  private raf = 0
  private last = 0
  private frame = 0
  private time = 0
  private running = false
  private lastTrail = 0
  private wkind: WeatherKind = 'none'
  private wpow = 0
  private drops: Drop[] = []
  private mists: MistBand[] = []
  private bolts: Bolt[] = []
  private ledges: Ledge[] = []
  private visibleLedges: Ledge[] = []
  private ledgesDirty = true
  private lastLedgeScan = 0
  private rockets: Rocket[] = []
  private papers: Paper[] = []
  private queue: { t: number; fn: () => void }[] = []
  private flash = 0
  private nextBolt = 0
  /** Hangjelzés a tűzijáték / konfetti eseményeire (pan: -1…1). */
  onSound?: (kind: 'launch' | 'boom' | 'pop', pan: number) => void

  // Hardver + adaptív teljesítmény-szabályozó ("potato PC"-re optimalizálva)
  private readonly lowSpec: boolean
  private readonly midSpec: boolean
  private baseMaxFps: number
  private currentMaxFps: number
  private perfScale = 1
  private avgWorkMs = 4
  private lastPerfAdjust = 0

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
    const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4
    const mem = typeof navigator !== 'undefined' ? ((navigator as { deviceMemory?: number }).deviceMemory || 8) : 8
    this.lowSpec = cores <= 2 || mem <= 2
    this.midSpec = !this.lowSpec && (cores <= 4 || mem <= 4)
    this.baseMaxFps = tv ? 30 : this.lowSpec ? 34 : this.midSpec ? 42 : 50
    this.currentMaxFps = this.baseMaxFps
    if (this.lowSpec) this.perfScale = 0.72
    else if (this.midSpec) this.perfScale = 0.88

    const cs = getComputedStyle(document.documentElement)
    this.pal = VARS.map((v, i) => parseColor(cs.getPropertyValue(v)) ?? FALLBACK[i])
    this.sprites = this.pal.map(makeSprite)
    this.snowSprite = makeSprite([235, 245, 255])
    this.sunSprite = makeMistSprite([255, 210, 95])
    this.mistDarkSprite = makeMistSprite([185, 215, 245])
    this.mistLightSprite = makeMistSprite([135, 162, 198])
    this.cloudDarkSprite = makeCloudSprite([115, 155, 215])
    this.cloudLightSprite = makeCloudSprite([140, 165, 200])
  }

  private syncPerfAttr() {
    if (typeof document === 'undefined') return
    if (this.lowSpec || this.perfScale <= 0.68) {
      document.documentElement.dataset.perf = 'lite'
    } else {
      delete document.documentElement.dataset.perf
    }
  }

  start() {
    if (this.running) return
    this.running = true
    this.additive = document.documentElement.dataset.theme !== 'light'
    this.syncPerfAttr()
    this.scrollX = window.scrollX
    this.scrollY = window.scrollY
    if (!this.ledgesRoot) {
      const root = document.createElement('div')
      root.className = 'fx-ledges-root'
      root.setAttribute('aria-hidden', 'true')
      document.body.appendChild(root)
      this.ledgesRoot = root
    }
    this.resize()
    if (typeof ResizeObserver !== 'undefined') {
      const target = document.querySelector('main') || document.body
      this.resizeObs = new ResizeObserver(() => { this.ledgesDirty = true })
      this.resizeObs.observe(target)
    }
    window.addEventListener('resize', this.onResize)
    window.addEventListener('scroll', this.onScroll, { passive: true })
    window.addEventListener('pointerdown', this.onDown, { passive: true })
    window.addEventListener('pointermove', this.onMove, { passive: true })
    document.addEventListener('visibilitychange', this.onVis)
    document.addEventListener('resume', this.onVis)
    window.addEventListener('focus', this.onVis)
    window.addEventListener('pageshow', this.onVis)
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.resizeObs?.disconnect()
    this.resizeObs = null
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('scroll', this.onScroll)
    window.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointermove', this.onMove)
    document.removeEventListener('visibilitychange', this.onVis)
    document.removeEventListener('resume', this.onVis)
    window.removeEventListener('focus', this.onVis)
    window.removeEventListener('pageshow', this.onVis)
    this.ctxBg.clearRect(0, 0, this.canvasBg.width, this.canvasBg.height)
    if (this.ctxFg && this.canvasFg) {
      this.ctxFg.clearRect(0, 0, this.canvasFg.width, this.canvasFg.height)
    }
    for (const l of this.ledges) l.canvas.remove()
    this.ledges = []
    this.visibleLedges = []
    this.ledgesRoot?.remove()
    this.ledgesRoot = null
    if (typeof document !== 'undefined') delete document.documentElement.dataset.perf
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
    const n = Math.round((this.tv ? 80 : 120) * this.perfScale)
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), sp = rnd(140, 520)
      this.sparks.push({ x: x + Math.cos(a) * rad, y: y + Math.sin(a) * rad, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(3, 8), life: rnd(0.7, 1.6), max: 1.6, ci: this.pick(0.6) })
    }
    this.capSparks()
  }

  /** Valódi időjárás: derült, felhős/borult, ködös, szitálás, eső, hó, vihar (villámlással). */
  setWeather(code: number | null | undefined) {
    const [k, p] = weatherKind(code)
    if (this.wkind === k && this.wpow === p) return
    const wasSnow = this.wkind === 'snow'
    this.wkind = k
    this.wpow = p
    this.bolts = []
    this.flash = 0
    this.nextBolt = this.time + (k === 'storm' ? rnd(2.2, 5.5) : 999)
    this.scanLedges(true)
    if (k === 'snow' && !wasSnow) {
      for (const l of this.ledges) {
        if (l.snowDepth < 0.35) l.snowDepth = 0.35
      }
    }
    this.fitDrops()
    this.fitMists()
  }

  /** Nagy pillanat: tűzijáték és/vagy konfetti. */
  celebrate(kind: 'fireworks' | 'confetti' | 'both' = 'both', power = 1) {
    const k = (this.tv ? 0.7 : 1) * this.perfScale
    if (kind !== 'confetti') {
      const n = Math.max(4, Math.round(9 * power * this.perfScale))
      for (let i = 0; i < n; i++) this.queue.push({ t: this.time + 0.2 + i * 0.55 + rnd(0, 0.25), fn: () => this.launch(rnd(0.12, 0.88)) })
    }
    if (kind !== 'fireworks') {
      const n = Math.round(140 * power * k)
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
    const n = Math.round((this.tv ? 55 : 80) * this.perfScale), sp0 = rnd(190, 330) * this.sc, two = (ci + 1 + ((Math.random() * 3) | 0)) % this.pal.length
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(-0.05, 0.05), sp = sp0 * (i % 2 ? 1 : 0.62) * rnd(0.92, 1.05)
      this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(3, 6), life: rnd(1.1, 1.8), max: 1.8, ci: i % 2 ? ci : two })
    }
    this.waves.push({ x, y, r0: 4, r1: sp0 * 0.45, t: 0, max: 0.5, ci })
    this.capSparks()
  }

  private newPaper(): Paper {
    const cols: RGB[] = [...this.pal, [138, 92, 255], [255, 255, 255]]
    const c = cols[(Math.random() * cols.length) | 0]
    return {
      x: rnd(0, this.w), y: rnd(-40, -8), vx: rnd(-40, 40), vy: rnd(130, 260),
      rot: rnd(0, TAU), vr: rnd(-6, 6), w: rnd(7, 13) * this.sc, h: rnd(4, 8) * this.sc,
      colStr: `rgb(${c[0]},${c[1]},${c[2]})`, ph: rnd(0, TAU)
    }
  }

  private fitDrops() {
    const area = Math.min(1.35, Math.max(0.55, (this.w * this.h) / (1920 * 1080))) * (this.tv ? 0.6 : 1) * this.perfScale
    let base = 0
    if (this.wkind === 'drizzle') base = 105        // wpow 0.32..0.45 -> ~34..47 finom csepp
    else if (this.wkind === 'rain') base = 138      // wpow 1.0..1.45  -> ~138..200 esőcsepp
    else if (this.wkind === 'storm') base = 228     // wpow 1.25..1.45 -> ~285..330 sűrű viharos csepp
    else if (this.wkind === 'snow') base = 115      // wpow 1.0..1.35  -> ~115..155 hópihe

    const want = base === 0 ? 0 : Math.max(12, Math.round(base * this.wpow * area))
    while (this.drops.length < want) this.drops.push(this.newDrop(true))
    this.drops.length = Math.min(this.drops.length, want)
  }

  private newDrop(anywhere: boolean): Drop {
    const snow = this.wkind === 'snow'
    const drizzle = this.wkind === 'drizzle'
    const storm = this.wkind === 'storm'
    const x = snow ? rnd(-20, this.w + 20) : rnd(-20, this.w + (storm ? 320 : 220))
    const y = anywhere ? rnd(0, this.h) : rnd(-60, -5)
    const a = snow ? rnd(0.5, 0.92) : drizzle ? rnd(0.24, 0.48) : storm ? rnd(0.52, 0.95) : rnd(0.4, 0.85)
    const bucket: 0 | 1 | 2 = a < 0.45 ? 0 : a < 0.72 ? 1 : 2
    return {
      x,
      y,
      v: snow ? rnd(42, 92) : drizzle ? rnd(360, 540) : storm ? rnd(920, 1320) : rnd(680, 960),
      len: (drizzle ? rnd(8, 15) : storm ? rnd(24, 44) : rnd(16, 30)) * this.sc,
      a,
      bucket,
      ph: rnd(0, TAU),
      r: snow ? rnd(3.2, 7.5) : 4
    }
  }

  private fitMists() {
    let wantBg = 0
    let wantFg = 0
    if (this.wkind === 'fog') {
      wantBg = Math.round(8 * this.wpow * this.perfScale)
      wantFg = Math.round(3 * this.perfScale)
    } else if (this.wkind === 'cloudy') {
      wantBg = Math.max(3, Math.round(5.5 * this.wpow * this.perfScale))
      wantFg = 0
    } else if (this.wkind === 'rain' || this.wkind === 'storm') {
      wantBg = this.wkind === 'storm' ? 4 : 2
      wantFg = this.wkind === 'storm' ? 2 : 0
    }

    const total = wantBg + wantFg
    this.mists = []
    for (let i = 0; i < total; i++) {
      const isFg = i >= wantBg
      const isCloud = this.wkind === 'cloudy'
      const isFog = this.wkind === 'fog'
      const bw = isCloud ? rnd(240, 440) * this.sc : rnd(420, 780) * this.sc
      const bh = isCloud ? bw * 0.42 : rnd(170, 320) * this.sc
      const y = isCloud ? rnd(-bh * 0.2, this.h * 0.42) : rnd(-bh * 0.15, this.h - bh * 0.35)
      const vx = (isCloud ? rnd(7, 17) : isFog ? rnd(10, 26) : rnd(28, 65)) * (Math.random() < 0.8 ? 1 : -1)
      const a = isFg
        ? (isFog ? rnd(0.055, 0.105) : rnd(0.035, 0.07))
        : (isFog ? rnd(0.16, 0.3) : isCloud ? rnd(0.2, 0.38) : rnd(0.08, 0.16))
      this.mists.push({ x: rnd(-bw * 0.4, this.w), y, vx, w: bw, h: bh, a, ph: rnd(0, TAU), fg: isFg })
    }
  }

  private spawnLightning() {
    const startX = rnd(this.w * 0.1, this.w * 0.9)
    const endY = rnd(this.h * 0.36, this.h * 0.68)
    const segs = 8
    const pts: [number, number][] = [[startX, 0]]
    const branches: [number, number][][] = []
    let cx = startX, cy = 0
    for (let i = 1; i <= segs; i++) {
      cx += rnd(-42, 42) * this.sc
      cy = (i / segs) * endY + rnd(-10, 10)
      pts.push([cx, cy])
      if (i >= 2 && i <= 6 && Math.random() < 0.45) {
        let bx = cx, by = cy
        const br: [number, number][] = [[bx, by]]
        const dir = Math.random() < 0.5 ? -1 : 1
        for (let k = 0; k < 3; k++) {
          bx += dir * rnd(18, 40) * this.sc
          by += rnd(22, 48) * this.sc
          br.push([bx, by])
        }
        branches.push(br)
      }
    }
    this.bolts.push({ pts, branches, life: 0.28, max: 0.28 })
    if (this.bolts.length > 3) this.bolts.shift()
    this.flash = 1
    this.queue.push({ t: this.time + 0.14, fn: () => { this.flash = 0.72 } })
  }

  /** Kártyához kötött eső-becsapódás (localX: 0..l.w a kártya saját koordináta-rendszerében). */
  private createLedgeSplash(l: Ledge, localX: number, localTopY: number, droplets: number) {
    for (let i = 0; i < droplets; i++) {
      l.splashes.push({
        x: localX + rnd(-2, 2),
        y: localTopY - 1,
        vx: rnd(-45, 25),
        vy: -rnd(55, 130) * this.sc,
        r: rnd(1.2, 2.2) * this.sc,
        life: rnd(0.15, 0.3),
        max: 0.3,
        alpha: rnd(0.6, 0.92),
      })
    }
    if (l.splashes.length > 42) l.splashes.splice(0, l.splashes.length - 42)

    l.ripples.push({
      x: localX,
      y: localTopY + 1,
      r: 1,
      maxR: rnd(4, 9) * this.sc,
      life: 0.26,
      max: 0.26,
    })
    if (l.ripples.length > 28) l.ripples.splice(0, l.ripples.length - 28)
  }

  burst(x: number, y: number, n = 16, power = 1) {
    const cnt = Math.round(n * this.perfScale)
    for (let i = 0; i < cnt; i++) {
      const a = rnd(0, TAU), sp = rnd(60, 260) * power
      this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(2.5, 6), life: rnd(0.5, 1.2), max: 1.2, ci: this.pick(0.45) })
    }
    this.capSparks()
  }

  // ---- kártya-peremek szkennelése (nulla layout thrashing: először minden DOM-olvasás, utána az írások!) ----
  private scanLedges(force = false) {
    const now = performance.now()
    if (!force && !this.ledgesDirty && now - this.lastLedgeScan < 1600) return
    this.lastLedgeScan = now
    this.ledgesDirty = false
    if (!this.ledgesRoot) return

    const els = Array.from(
      document.querySelectorAll<HTMLElement>('.panel, .bento-hdr, .ticker')
    ).filter(el => {
      if (el.closest('.mymodal-bg, .alertfs, .maint-overlay, .askbox, .testlab-dock')) return false
      let p = el.parentElement
      while (p) {
        if (p.matches && p.matches('.panel, .bento-hdr, .ticker')) return false
        p = p.parentElement
      }
      return true
    })

    // 1. FÁZIS: CSAK olvasás (getBoundingClientRect egyetlen batch-ben, nulla köztes DOM-írás!)
    const sx = window.scrollX
    const sy = window.scrollY
    this.scrollX = sx
    this.scrollY = sy
    const measured: { el: HTMLElement; w: number; docX: number; docY: number; vx0: number; vx1: number; vy: number }[] = []
    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (r.width <= 30 || r.height <= 20) continue
      measured.push({
        el,
        w: Math.round(r.width),
        docX: Math.round(r.left + sx),
        docY: Math.round(r.top + sy),
        vx0: r.left,
        vx1: r.right,
        vy: r.top,
      })
    }

    // 2. FÁZIS: DOM-módosítások és cache frissítése
    const prevMap = new Map<HTMLElement, Ledge>()
    for (const l of this.ledges) prevMap.set(l.el, l)

    const next: Ledge[] = []
    for (const m of measured) {
      let l = prevMap.get(m.el)
      if (l) {
        prevMap.delete(m.el)
        this.applyLedgeGeometry(l, m.docX, m.docY, m.w, m.vx0, m.vx1, m.vy)
        next.push(l)
      } else {
        const canvas = document.createElement('canvas')
        canvas.className = 'fx-ledge'
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        this.ledgesRoot.appendChild(canvas)
        l = {
          el: m.el,
          canvas,
          ctx,
          docX: -99999,
          docY: -99999,
          vx0: m.vx0,
          vx1: m.vx1,
          vy: m.vy,
          w: 0,
          seed: rnd(0, 100),
          snowDepth: this.wkind === 'snow' ? 0.35 : 0,
          drawnSnow: -1,
          splashes: [],
          ripples: [],
          empty: true,
        }
        this.applyLedgeGeometry(l, m.docX, m.docY, m.w, m.vx0, m.vx1, m.vy)
        next.push(l)
      }
    }

    for (const old of prevMap.values()) old.canvas.remove()
    this.ledges = next
    this.refreshVisibleLedges()
  }

  private applyLedgeGeometry(l: Ledge, docX: number, docY: number, w: number, vx0: number, vx1: number, vy: number) {
    l.vx0 = vx0
    l.vx1 = vx1
    l.vy = vy
    const targetW = Math.max(1, Math.round(w * this.ledgeDpr))
    const targetH = Math.max(1, Math.round(LEDGE_H * this.ledgeDpr))
    if (l.w !== w || l.canvas.width !== targetW || l.canvas.height !== targetH) {
      l.w = w
      l.canvas.width = targetW
      l.canvas.height = targetH
      l.canvas.style.width = `${w}px`
      l.canvas.style.height = `${LEDGE_H}px`
      l.drawnSnow = -1
      l.empty = false
    }
    if (l.docX !== docX || l.docY !== docY) {
      l.docX = docX
      l.docY = docY
      l.canvas.style.transform = `translate3d(${docX}px, ${docY - LEDGE_OFFSET_Y}px, 0)`
    }
  }

  private refreshVisibleLedges() {
    this.visibleLedges.length = 0
    for (const l of this.ledges) {
      l.vx0 = l.docX - this.scrollX
      l.vx1 = l.vx0 + l.w
      l.vy = l.docY - this.scrollY
      if (l.vy >= -40 && l.vy <= this.h + 40 && l.vx1 > 0 && l.vx0 < this.w) {
        this.visibleLedges.push(l)
      }
    }
  }

  // ---- belső részek ----
  private onResize = () => this.resize()
  private onScroll = () => {
    this.scrollX = window.scrollX
    this.scrollY = window.scrollY
    this.refreshVisibleLedges()
  }
  private onVis = () => {
    if (document.hidden) { cancelAnimationFrame(this.raf) }
    else if (this.running) {
      cancelAnimationFrame(this.raf)
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.tick)
    }
  }
  private onDown = (e: PointerEvent) => this.burst(e.clientX, e.clientY, 16, 1)
  private onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const n = performance.now()
    if (n - this.lastTrail < (this.lowSpec ? 75 : 42)) return
    this.lastTrail = n
    const cnt = this.lowSpec ? 1 : 2
    for (let i = 0; i < cnt; i++) this.sparks.push({ x: e.clientX, y: e.clientY, vx: rnd(-30, 30), vy: rnd(-30, 30), r: rnd(2, 4), life: rnd(0.4, 0.9), max: 0.9, ci: this.pick(0.4) })
    this.capSparks()
  }
  private pick(focusWeight: number) { return Math.random() < focusWeight ? this.focus : (Math.random() * this.pal.length) | 0 }
  private capSparks() {
    const maxSparks = this.lowSpec ? 320 : 650
    if (this.sparks.length > maxSparks) this.sparks.splice(0, this.sparks.length - maxSparks)
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight
    const rawDpr = window.devicePixelRatio || 1
    this.dpr = this.tv || this.lowSpec ? 1 : this.midSpec ? Math.min(rawDpr, 1.15) : Math.min(rawDpr, 1.35)
    this.ledgeDpr = this.tv || this.lowSpec ? 1 : Math.min(rawDpr, 1.25)

    this.canvasBg.width = Math.round(w * this.dpr)
    this.canvasBg.height = Math.round(h * this.dpr)
    if (this.canvasFg) {
      this.canvasFg.width = Math.round(w * this.dpr)
      this.canvasFg.height = Math.round(h * this.dpr)
    }
    this.w = w; this.h = h
    this.sc = Math.max(0.6, Math.min(1.5, Math.min(w, h) / 900))
    const k = Math.min(1.35, Math.max(0.55, (w * h) / (1920 * 1080))) * (this.tv ? 0.6 : 1) * this.perfScale
    const no = Math.max(6, Math.round(12 * k)), nd = Math.max(24, Math.round(58 * k))
    while (this.orbs.length < no) this.orbs.push(this.newOrb())
    this.orbs.length = Math.min(this.orbs.length, no)
    while (this.dust.length < nd) this.dust.push(this.newDust())
    this.dust.length = Math.min(this.dust.length, nd)
    this.scanLedges(true)
    this.fitDrops()
    this.fitMists()
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
    if (now - this.last < 1000 / this.currentMaxFps - 1) return
    const dt = Math.min(0.05, (now - this.last) / 1000 || 0.016)
    this.last = now
    this.time += dt
    if (++this.frame % 30 === 0) this.additive = document.documentElement.dataset.theme !== 'light'

    const t0 = performance.now()
    this.step(dt)
    this.draw()
    const workMs = performance.now() - t0
    this.avgWorkMs = this.avgWorkMs * 0.92 + workMs * 0.08

    // Adaptív teljesítmény-figyelő: ha gyengébb PC-n megugrik a kirajzolási idő, simán visszaveszünk sűrűséget/FPS-t (feature-vesztés nélkül)
    if (now - this.lastPerfAdjust > 2000) {
      this.lastPerfAdjust = now
      if (this.avgWorkMs > 12 && this.perfScale > 0.56) {
        this.perfScale = Math.max(0.55, +(this.perfScale - 0.12).toFixed(2))
        this.currentMaxFps = Math.max(28, this.baseMaxFps - 12)
        this.syncPerfAttr()
        this.fitDrops()
        this.fitMists()
      } else if (this.avgWorkMs < 5.5 && this.perfScale < (this.lowSpec ? 0.72 : 1)) {
        this.perfScale = Math.min(this.lowSpec ? 0.75 : 1, +(this.perfScale + 0.08).toFixed(2))
        this.currentMaxFps = this.baseMaxFps
        this.syncPerfAttr()
        this.fitDrops()
        this.fitMists()
      }
    }
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
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].t <= this.time) {
        const q = this.queue[i]
        this.queue[i] = this.queue[this.queue.length - 1]
        this.queue.pop()
        q.fn()
      }
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]
      r.y += r.vy * dt; r.vy *= 1 - 0.6 * dt
      if (Math.random() < 0.75) this.sparks.push({ x: r.x + rnd(-2, 2), y: r.y, vx: rnd(-14, 14), vy: rnd(10, 50), r: rnd(2, 3.5), life: rnd(0.25, 0.5), max: 0.5, ci: r.ci })
      if (r.y <= r.ty || r.vy > -60) {
        this.explode(r.x, r.y, r.ci)
        this.rockets[i] = this.rockets[this.rockets.length - 1]
        this.rockets.pop()
      }
    }
    for (let i = this.papers.length - 1; i >= 0; i--) {
      const q = this.papers[i]
      q.y += q.vy * dt; q.x += (q.vx + Math.sin(this.time * 2.4 + q.ph) * 55) * dt; q.rot += q.vr * dt
      if (q.y > h + 20) {
        this.papers[i] = this.papers[this.papers.length - 1]
        this.papers.pop()
      }
    }

    // Felhők / ködfelhők mozgatása
    for (const m of this.mists) {
      m.x += m.vx * dt
      if (m.vx > 0 && m.x > w + 40) m.x = -m.w - 40
      else if (m.vx < 0 && m.x < -m.w - 40) m.x = w + 40
    }

    // Kártya-peremek ellenőrzése (ritkítva + csak látható kártyákra)
    this.scanLedges(false)

    // Időjárás és látható kártyákkal való ütközés
    const wk = this.wkind
    const isSnow = wk === 'snow'
    const isRainLike = wk === 'drizzle' || wk === 'rain' || wk === 'storm'

    if (this.drops.length) {
      const windTilt = wk === 'drizzle' ? 0.08 : wk === 'storm' ? 0.26 : 0.16
      const hitChance = wk === 'drizzle' ? 0.28 : wk === 'storm' ? 0.72 : 0.6
      const dropletMin = wk === 'drizzle' ? 1 : wk === 'storm' ? 3 : 2
      const vLedges = this.visibleLedges
      const hasLedges = vLedges.length > 0

      for (const d of this.drops) {
        const prevY = d.y
        d.y += d.v * dt
        d.x += (isSnow ? Math.sin(this.time * 0.9 + d.ph) * 24 : -d.v * windTilt) * dt

        let hit = false
        if (hasLedges && d.y >= -10 && d.y <= h + 15) {
          if (isSnow) {
            for (const l of vLedges) {
              if (d.x >= l.vx0 - 4 && d.x <= l.vx1 + 4 && prevY <= l.vy + 4 && d.y >= l.vy - 2) {
                hit = true
                l.snowDepth = Math.min(1, l.snowDepth + 0.02)
                break
              }
            }
          } else if (isRainLike) {
            for (const l of vLedges) {
              if (d.x >= l.vx0 + 2 && d.x <= l.vx1 - 2) {
                const snowOffset = l.snowDepth * 8 * this.sc
                const topY = l.vy - snowOffset
                if (prevY <= topY + 4 && d.y >= topY - 2 && Math.random() < hitChance) {
                  hit = true
                  this.createLedgeSplash(l, d.x - l.vx0, -snowOffset, dropletMin + ((Math.random() * 2) | 0))
                  if (l.snowDepth > 0) l.snowDepth = Math.max(0, l.snowDepth - 0.04)
                  break
                }
              }
            }
          }
        }

        if (hit || d.y > h + 30 || d.x < -80 || d.x > w + 340) {
          Object.assign(d, this.newDrop(false))
        }
      }
    }

    // Hófelhalmozódás / olvadás a kártyákon
    for (const l of this.ledges) {
      if (isSnow) {
        l.snowDepth = Math.min(1, l.snowDepth + dt * 0.032)
      } else if (l.snowDepth > 0) {
        l.snowDepth = Math.max(0, l.snowDepth - dt * (isRainLike ? 0.35 : 0.06))
      }
    }

    // Vihar villámcsapások időzítése
    if (wk === 'storm' && this.time > this.nextBolt) {
      this.spawnLightning()
      this.nextBolt = this.time + rnd(3.2, 8.2) / Math.max(1, this.wpow * 0.8)
    }

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      this.bolts[i].life -= dt
      if (this.bolts[i].life <= 0) {
        this.bolts[i] = this.bolts[this.bolts.length - 1]
        this.bolts.pop()
      }
    }

    // Csak látható kártyák fröccsenéseinek/gyűrűinek léptetése
    for (const l of this.ledges) {
      for (let i = l.splashes.length - 1; i >= 0; i--) {
        const s = l.splashes[i]
        s.life -= dt
        if (s.life <= 0) {
          l.splashes[i] = l.splashes[l.splashes.length - 1]
          l.splashes.pop()
          continue
        }
        s.vy += 450 * dt
        s.x += s.vx * dt
        s.y += s.vy * dt
      }
      for (let i = l.ripples.length - 1; i >= 0; i--) {
        const r = l.ripples[i]
        r.life -= dt
        if (r.life <= 0) {
          l.ripples[i] = l.ripples[l.ripples.length - 1]
          l.ripples.pop()
          continue
        }
        const prog = 1 - r.life / r.max
        r.r = 1 + (r.maxR - 1) * prog
      }
    }

    this.flash = Math.max(0, this.flash - dt * 3.4)
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]
      s.life -= dt
      if (s.life <= 0) {
        this.sparks[i] = this.sparks[this.sparks.length - 1]
        this.sparks.pop()
        continue
      }
      const drag = 1 - 2.2 * dt
      s.vx *= drag; s.vy = s.vy * drag + 90 * dt
      s.x += s.vx * dt; s.y += s.vy * dt
    }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      this.waves[i].t += dt
      if (this.waves[i].t > this.waves[i].max) {
        this.waves[i] = this.waves[this.waves.length - 1]
        this.waves.pop()
      }
    }
  }

  private spr(c: CanvasRenderingContext2D, ci: number, x: number, y: number, r: number, a: number) {
    c.globalAlpha = Math.max(0, Math.min(1, a))
    c.drawImage(this.sprites[ci], x - r, y - r, r * 2, r * 2)
  }

  /** Látható kártyák hósapkáinak, eső-csobbanásainak és vízgyűrűinek kirajzolása (zero shadowBlur, inkrementális hó-cache). */
  private drawLedges() {
    const isDark = this.additive
    const hWin = this.h
    for (const l of this.ledges) {
      const visible = l.vy >= -40 && l.vy <= hWin + 40 && l.vx1 > 0 && l.vx0 < this.w
      const hasSnow = l.snowDepth > 0.04 && l.w > 20
      const hasRipples = l.ripples.length > 0
      const hasSplashes = l.splashes.length > 0

      if (!hasSnow && !hasRipples && !hasSplashes) {
        if (!l.empty) {
          l.ctx.setTransform(1, 0, 0, 1, 0, 0)
          l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height)
          l.empty = true
          l.drawnSnow = -1
        }
        continue
      }

      if (!visible) continue

      // Ha csak hó van, és alig változott a vastagsága, nem rajzoljuk újra minden képkockán!
      if (!hasRipples && !hasSplashes && l.drawnSnow >= 0 && Math.abs(l.snowDepth - l.drawnSnow) < 0.015) {
        continue
      }

      l.empty = false
      l.drawnSnow = hasSnow ? l.snowDepth : -1
      const c = l.ctx
      c.setTransform(this.ledgeDpr, 0, 0, this.ledgeDpr, 0, 0)
      c.clearRect(0, 0, l.w, LEDGE_H)

      const y = LEDGE_OFFSET_Y

      // 1. Megmaradó hósapka a kártya tetején (olcsó alá-árnyékkal shadowBlur nélkül)
      if (hasSnow) {
        const h = l.snowDepth * 10 * this.sc
        const x0 = 2
        const x1 = l.w - 2

        c.beginPath()
        c.moveTo(x0 + 8, y + 2)
        c.lineTo(x1 - 8, y + 2)
        c.quadraticCurveTo(x1 + 1, y, x1, y - h * 0.6)

        const bumpW = 28 * this.sc
        const count = Math.max(2, Math.round((x1 - x0) / bumpW))
        const step = (x1 - x0) / count
        for (let i = count; i >= 0; i--) {
          const curX = x0 + i * step
          const prevX = x0 + Math.max(0, i - 1) * step
          const midX = (curX + prevX) / 2
          const varH = Math.sin(curX * 0.05 + l.seed) * 1.5
          c.quadraticCurveTo(midX, y - h - varH - 1, prevX, y - h * 0.7)
        }
        c.quadraticCurveTo(x0 - 1, y, x0 + 8, y + 2)
        c.closePath()

        c.lineWidth = 2.5
        c.strokeStyle = isDark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(20, 60, 110, 0.14)'
        c.stroke()

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

        c.fillStyle = isDark ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.85)'
        c.beginPath()
        for (let i = 1; i < count; i++) {
          const bx = x0 + i * step
          const by = y - h - Math.sin(bx * 0.05 + l.seed) * 1.5
          const rr = 1.15 * this.sc
          c.moveTo(bx + rr, by + 1.5)
          c.arc(bx, by + 1.5, rr, 0, TAU)
        }
        c.fill()
      }

      // 2. Eső-becsapódási vízgyűrűk
      if (hasRipples) {
        c.lineWidth = 1.2 * this.sc
        for (const rip of l.ripples) {
          const f = rip.life / rip.max
          c.strokeStyle = isDark ? `rgba(160, 230, 255, ${(f * 0.72).toFixed(2)})` : `rgba(40, 100, 200, ${(f * 0.58).toFixed(2)})`
          c.beginPath()
          c.ellipse(rip.x, y + rip.y, rip.r * 1.6, rip.r * 0.5, 0, 0, TAU)
          c.stroke()
        }
      }

      // 3. Eső-becsapódási vízcseppek (fröccsenés) egyetlen batch-ben!
      if (hasSplashes) {
        c.fillStyle = isDark ? 'rgba(180, 235, 255, 0.82)' : 'rgba(45, 110, 210, 0.75)'
        c.beginPath()
        for (const s of l.splashes) {
          c.moveTo(s.x + s.r, y + s.y)
          c.arc(s.x, y + s.y, s.r, 0, TAU)
        }
        c.fill()
      }
    }
  }

  private drawWeatherBg(cBg: CanvasRenderingContext2D, isDark: boolean) {
    const wk = this.wkind
    const t = this.time

    // Derült: finom napsütés a sarokban + lágy sugarak
    if (wk === 'clear') {
      const sx = this.w * 0.88
      const sy = this.h * 0.12
      const rad = Math.min(this.w, this.h) * 0.42
      cBg.globalCompositeOperation = isDark ? 'lighter' : 'source-over'
      cBg.globalAlpha = isDark ? 0.38 : 0.48
      cBg.drawImage(this.sunSprite, sx - rad, sy - rad, rad * 2, rad * 2)
      // 3 finom forgó fénysugár
      cBg.globalAlpha = isDark ? 0.045 : 0.075
      cBg.fillStyle = isDark ? '#ffe39a' : '#ffcf5c'
      for (let i = 0; i < 3; i++) {
        const ang = 2.25 + i * 0.28 + Math.sin(t * 0.35 + i) * 0.06
        const len = Math.max(this.w, this.h) * 1.15
        cBg.beginPath()
        cBg.moveTo(sx, sy)
        cBg.lineTo(sx + Math.cos(ang - 0.06) * len, sy + Math.sin(ang - 0.06) * len)
        cBg.lineTo(sx + Math.cos(ang + 0.06) * len, sy + Math.sin(ang + 0.06) * len)
        cBg.closePath()
        cBg.fill()
      }
      cBg.globalAlpha = 1
      return
    }

    // Háttér köd- vagy felhőrétegek (cloudy, fog, rain, storm)
    if (this.mists.length) {
      cBg.globalCompositeOperation = 'source-over'
      if (wk === 'fog') {
        cBg.fillStyle = isDark ? 'rgba(135, 165, 200, 0.07)' : 'rgba(145, 168, 196, 0.14)'
        cBg.fillRect(0, 0, this.w, this.h)
      } else if (wk === 'cloudy' && this.wpow > 1) {
        cBg.fillStyle = isDark ? 'rgba(65, 90, 130, 0.06)' : 'rgba(120, 145, 180, 0.08)'
        cBg.fillRect(0, 0, this.w, this.h)
      } else if (wk === 'storm') {
        cBg.fillStyle = isDark ? 'rgba(20, 30, 60, 0.12)' : 'rgba(60, 82, 125, 0.1)'
        cBg.fillRect(0, 0, this.w, this.h)
      }

      const spr = wk === 'cloudy'
        ? (isDark ? this.cloudDarkSprite : this.cloudLightSprite)
        : (isDark ? this.mistDarkSprite : this.mistLightSprite)

      for (const m of this.mists) {
        if (m.fg) continue
        const breath = 0.85 + 0.15 * Math.sin(t * 0.4 + m.ph)
        cBg.globalAlpha = m.a * breath
        cBg.drawImage(spr, m.x, m.y, m.w, m.h)
      }
      cBg.globalAlpha = 1
    }

    // Vihar villámcsapások + égi villanás
    if (this.bolts.length) {
      cBg.globalCompositeOperation = isDark ? 'lighter' : 'source-over'
      for (const b of this.bolts) {
        const f = Math.max(0, b.life / b.max)
        cBg.lineCap = 'round'
        cBg.lineJoin = 'round'
        // Széles fényudvar pass
        cBg.strokeStyle = isDark ? `rgba(120, 195, 255, ${(f * 0.45).toFixed(2)})` : `rgba(85, 115, 235, ${(f * 0.5).toFixed(2)})`
        cBg.lineWidth = 7 * this.sc
        cBg.beginPath()
        b.pts.forEach(([x, y], idx) => (idx === 0 ? cBg.moveTo(x, y) : cBg.lineTo(x, y)))
        for (const br of b.branches) br.forEach(([x, y], idx) => (idx === 0 ? cBg.moveTo(x, y) : cBg.lineTo(x, y)))
        cBg.stroke()

        // Éles fényes mag pass
        cBg.strokeStyle = isDark ? `rgba(245, 252, 255, ${f.toFixed(2)})` : `rgba(255, 255, 255, ${(f * 0.95).toFixed(2)})`
        cBg.lineWidth = 2 * this.sc
        cBg.stroke()
      }
    }

    if (this.flash > 0.02) {
      cBg.globalCompositeOperation = isDark ? 'lighter' : 'source-over'
      cBg.globalAlpha = this.flash * (isDark ? 0.24 : 0.34)
      cBg.fillStyle = isDark ? '#e8f0ff' : '#cddcff'
      cBg.fillRect(0, 0, this.w, this.h)
      cBg.globalAlpha = 1
    }
  }

  private draw() {
    const cBg = this.ctxBg
    const cFg = this.ctxFg ?? this.ctxBg
    const t = this.time
    const isDark = this.additive

    // 1. Háttér canvas (orbs, dust, hullámok, időjárási égbolt)
    cBg.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    cBg.clearRect(0, 0, this.w, this.h)
    cBg.globalCompositeOperation = isDark ? 'lighter' : 'source-over'
    const k = isDark ? 1 : 0.75

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
      cBg.strokeStyle = `rgba(${r},${g},${b},${((1 - p) * 0.85 * k).toFixed(2)})`
      cBg.lineWidth = 2 + 6 * (1 - p)
      cBg.stroke()
    }

    this.drawWeatherBg(cBg, isDark)

    // 2. Kártyákhoz rögzített hósapkák és becsapódások
    this.drawLedges()

    // 3. Előtér canvas (köd-pára, hulló csapadék, szikrák, konfetti)
    if (this.ctxFg) {
      cFg.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
      cFg.clearRect(0, 0, this.w, this.h)
    }

    // Finom előtér-ködfátyol (ködös / vihar)
    if (this.mists.length) {
      cFg.globalCompositeOperation = 'source-over'
      const mistSpr = isDark ? this.mistDarkSprite : this.mistLightSprite
      for (const m of this.mists) {
        if (!m.fg) continue
        cFg.globalAlpha = m.a * (0.85 + 0.15 * Math.sin(t * 0.45 + m.ph))
        cFg.drawImage(mistSpr, m.x, m.y, m.w, m.h)
      }
      cFg.globalAlpha = 1
    }

    // Időjárási csapadék: hó vagy batch-elt szitálás / eső / vihar
    if (this.drops.length) {
      const wk = this.wkind
      cFg.globalCompositeOperation = 'source-over'
      if (wk === 'snow') {
        const flk = isDark ? this.snowSprite : this.sprites[1]
        for (const d of this.drops) {
          cFg.globalAlpha = Math.min(1, d.a * 1.1)
          cFg.drawImage(flk, d.x - d.r * 1.6, d.y - d.r * 1.6, d.r * 3.2, d.r * 3.2)
        }
      } else {
        const tilt = wk === 'drizzle' ? 0.08 : wk === 'storm' ? 0.26 : 0.16
        const [r, g, b] = isDark
          ? (wk === 'storm' ? [170, 232, 255] : [135, 220, 255])
          : (wk === 'storm' ? [28, 72, 168] : [40, 96, 194])
        cFg.lineCap = 'round'
        cFg.lineWidth = (wk === 'drizzle' ? 1.25 : wk === 'storm' ? 2.3 : 1.9) * this.sc
        const alphas = wk === 'drizzle' ? [0.24, 0.36, 0.48] : wk === 'storm' ? [0.46, 0.68, 0.9] : [0.36, 0.56, 0.8]

        // 3 alpha-vödörbe csoportosítva: 300 draw call helyett mindössze 3 stroke() hívás!
        for (let bucket = 0; bucket < 3; bucket++) {
          cFg.strokeStyle = `rgba(${r},${g},${b},${alphas[bucket]})`
          cFg.beginPath()
          let any = false
          for (const d of this.drops) {
            if (d.bucket !== bucket) continue
            any = true
            cFg.moveTo(d.x, d.y)
            cFg.lineTo(d.x + d.len * tilt, d.y - d.len)
          }
          if (any) cFg.stroke()
        }
      }
      cFg.globalAlpha = 1
    }

    // Kattintás és mozgás szikrák az előtérben
    cFg.globalCompositeOperation = isDark ? 'lighter' : 'source-over'
    for (const s of this.sparks) {
      const f = s.life / s.max
      const al = Math.pow(Math.max(0, Math.min(1, f)), 1.4) * k
      this.spr(cFg, s.ci, s.x, s.y, s.r * (0.6 + 0.4 * f) * 2.4, al)
      this.spr(cFg, s.ci, s.x - s.vx * 0.018, s.y - s.vy * 0.018, s.r * 1.6, al * 0.6)
    }
    cFg.globalAlpha = 1

    // Ünneplés: rakéták és konfetti az előtérben (save/restore nélkül, közvetlen mátrixszal)
    cFg.globalCompositeOperation = 'source-over'
    for (const r of this.rockets) this.spr(cFg, this.focus, r.x, r.y, 12, 1)
    cFg.globalAlpha = 1
    if (this.papers.length) {
      const dpr = this.dpr
      for (const q of this.papers) {
        const cs = Math.cos(q.rot)
        const sn = Math.sin(q.rot)
        const sy = Math.cos(t * 5 + q.ph)
        cFg.setTransform(dpr * cs, dpr * sn, -dpr * sn * sy, dpr * cs * sy, q.x * dpr, q.y * dpr)
        cFg.fillStyle = q.colStr
        cFg.fillRect(-q.w * 0.5, -q.h * 0.5, q.w, q.h)
      }
      cFg.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
  }
}
