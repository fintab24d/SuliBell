// Csengő: ha az admin feltöltött hangfájlt, az szól; különben a beépített, szintetizált csengő.
let ctx: AudioContext | null = null
let cached: { url: string; data: AudioBuffer } | null = null
let loadingAudio: { url: string; promise: Promise<AudioBuffer> } | null = null
let bellActiveUntilMs = 0
let bellEndTimer: number | undefined
const bellListeners = new Set<(ringing: boolean) => void>()

export const audioReady = () => ctx?.state === 'running'
export const isBellRinging = () => Date.now() < bellActiveUntilMs

export function subscribeBellRinging(cb: (ringing: boolean) => void): () => void {
  bellListeners.add(cb)
  cb(isBellRinging())
  return () => {
    bellListeners.delete(cb)
  }
}

function notifyBellListeners(ringing: boolean) {
  bellListeners.forEach(cb => {
    try { cb(ringing) } catch { /* ignore */ }
  })
}

function markBellPlaying(durationSec: number) {
  const ms = Math.max(0, Math.round(durationSec * 1000)) + 250
  const nextUntil = Date.now() + ms
  if (nextUntil > bellActiveUntilMs) bellActiveUntilMs = nextUntil
  if (bellEndTimer !== undefined) window.clearTimeout(bellEndTimer)
  notifyBellListeners(true)
  bellEndTimer = window.setTimeout(() => {
    bellEndTimer = undefined
    if (Date.now() >= bellActiveUntilMs) {
      bellActiveUntilMs = 0
      notifyBellListeners(false)
    } else {
      markBellPlaying((bellActiveUntilMs - Date.now()) / 1000)
    }
  }, Math.max(50, bellActiveUntilMs - Date.now()))
}

/** Csak felhasználói kattintásból hívd: a böngésző autoplay-szabályait nem kerüljük meg. */
export async function enableAudio() {
  ctx ??= new AudioContext()
  await ctx.resume()
  return ctx.state === 'running'
}

async function load(url: string) {
  if (cached?.url === url) return cached.data
  if (loadingAudio?.url === url) return loadingAudio.promise
  const promise = (async () => {
    try {
      const r = await fetch(url)
      const data = await ctx!.decodeAudioData(await r.arrayBuffer())
      cached = { url, data }
      return data
    } finally {
      if (loadingAudio?.url === url) loadingAudio = null
    }
  })()
  loadingAudio = { url, promise }
  return promise
}
/** Előre betölti a saját hangot, hogy csengetéskor ne legyen késés. */
export function preload(url?: string | null) { if (url && ctx && ctx.state === 'running') load(url).catch(() => {}) }

export type BellKind = 'in' | 'out'

export type BellSoundStyle =
  | 'default'
  | 'retro-8bit'
  | 'soft-chord'
  | 'jingle-8bit'
  | 'sleigh-bells'
  | 'hohoho'

function playRetro8Bit(c: AudioContext, kind: BellKind = 'in'): number {
  const t0 = c.currentTime
  // 8-bites retro chiptune csengő (klasszikus arcade arpeggio + basszus)
  const melody: Array<{ f: number; delay: number; dur: number }> = [
    { f: 523.25, delay: 0.0, dur: 0.14 },   // C5
    { f: 659.25, delay: 0.14, dur: 0.14 },  // E5
    { f: 783.99, delay: 0.28, dur: 0.14 },  // G5
    { f: 1046.5, delay: 0.42, dur: 0.28 },  // C6
    { f: 783.99, delay: 0.74, dur: 0.14 },  // G5
    { f: 1046.5, delay: 0.88, dur: 0.42 },  // C6
    { f: 987.77, delay: 1.38, dur: 0.14 },  // B5
    { f: 1046.5, delay: 1.52, dur: 0.14 },  // C6
    { f: 1318.5, delay: 1.66, dur: 0.55 },  // E6
  ]
  const bass: Array<{ f: number; delay: number; dur: number }> = [
    { f: 130.81, delay: 0.0, dur: 0.40 },   // C3
    { f: 196.0, delay: 0.42, dur: 0.40 },   // G3
    { f: 130.81, delay: 0.88, dur: 0.44 },  // C3
    { f: 164.81, delay: 1.38, dur: 0.82 },  // E3
  ]

  if (kind === 'out') {
    melody.push(
      { f: 1046.5, delay: 2.32, dur: 0.14 }, // C6
      { f: 1174.66, delay: 2.48, dur: 0.14 }, // D6
      { f: 1318.51, delay: 2.64, dur: 0.16 }, // E6
      { f: 1567.98, delay: 2.82, dur: 0.26 }, // G6
      { f: 1318.51, delay: 3.12, dur: 0.14 }, // E6
      { f: 1567.98, delay: 3.28, dur: 0.22 }, // G6
      { f: 2093.0, delay: 3.54, dur: 0.95 },  // C7 (hosszú győzelmi záróhang)
    )
    bass.push(
      { f: 174.61, delay: 2.32, dur: 0.48 }, // F3
      { f: 196.0, delay: 2.82, dur: 0.68 },  // G3
      { f: 130.81, delay: 3.54, dur: 0.95 }, // C3
    )
  }

  melody.forEach(({ f, delay, dur }) => {
    const at = t0 + delay
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'square'
    o.frequency.setValueAtTime(f, at)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.14, at + 0.01)
    g.gain.setValueAtTime(0.12, at + Math.max(0.02, dur - 0.04))
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    o.connect(g).connect(c.destination)
    o.start(at)
    o.stop(at + dur + 0.03)
  })

  bass.forEach(({ f, delay, dur }) => {
    const at = t0 + delay
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'triangle'
    o.frequency.setValueAtTime(f, at)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.16, at + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    o.connect(g).connect(c.destination)
    o.start(at)
    o.stop(at + dur + 0.03)
  })
  return kind === 'out' ? 4.6 : 2.3
}

function playSoftChord(c: AudioContext, kind: BellKind = 'in'): number {
  const t0 = c.currentTime
  // Lágy, nyugtató Fmaj9 -> Cmaj9 lebegő akkord-jelzés (kicsengőnél extra G6 -> Cmaj9 lezárással)
  const chords = [
    { delay: 0.0, dur: 1.7, freqs: [349.23, 440.0, 523.25, 659.25, 783.99] }, // Fmaj9
    { delay: 1.35, dur: 2.2, freqs: [261.63, 392.0, 493.88, 587.33, 659.25] }, // Cmaj9
  ]
  if (kind === 'out') {
    chords.push(
      { delay: 3.1, dur: 1.8, freqs: [392.0, 493.88, 587.33, 659.25, 880.0] },   // G6/9
      { delay: 4.4, dur: 2.8, freqs: [261.63, 329.63, 392.0, 493.88, 587.33, 783.99] }, // Cmaj9 finálé
    )
  }
  chords.forEach(({ delay, dur, freqs }) => {
    freqs.forEach((f, idx) => {
      const at = t0 + delay + idx * 0.045
      const o = c.createOscillator(), g = c.createGain()
      o.type = idx % 2 === 0 ? 'sine' : 'triangle'
      o.frequency.setValueAtTime(f, at)
      o.detune.setValueAtTime((idx - 2) * 3, at)
      const peak = idx === 0 ? 0.14 : 0.085
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(peak, at + 0.18)
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
      o.connect(g).connect(c.destination)
      o.start(at)
      o.stop(at + dur + 0.06)
    })
  })
  return kind === 'out' ? 7.3 : 3.8
}

function playJingle8Bit(c: AudioContext, kind: BellKind = 'in'): number {
  const t0 = c.currentTime
  // 8-bites Jingle Bells (klasszikus chiptune refrén: E-E-E, E-E-E, E-G-C-D-E...)
  const E5 = 659.25, G5 = 783.99, C5 = 523.25, D5 = 587.33, F5 = 698.46
  const melody: Array<{ f: number; delay: number; dur: number }> = [
    { f: E5, delay: 0.00, dur: 0.14 },
    { f: E5, delay: 0.17, dur: 0.14 },
    { f: E5, delay: 0.34, dur: 0.30 },
    { f: E5, delay: 0.68, dur: 0.14 },
    { f: E5, delay: 0.85, dur: 0.14 },
    { f: E5, delay: 1.02, dur: 0.30 },
    { f: E5, delay: 1.36, dur: 0.14 },
    { f: G5, delay: 1.53, dur: 0.14 },
    { f: C5, delay: 1.70, dur: 0.20 },
    { f: D5, delay: 1.93, dur: 0.12 },
    { f: E5, delay: 2.08, dur: 0.48 },
    { f: F5, delay: 2.62, dur: 0.14 },
    { f: F5, delay: 2.79, dur: 0.14 },
    { f: F5, delay: 2.96, dur: 0.18 },
    { f: E5, delay: 3.17, dur: 0.14 },
    { f: E5, delay: 3.34, dur: 0.14 },
    { f: G5, delay: 3.51, dur: 0.14 },
    { f: G5, delay: 3.68, dur: 0.14 },
    { f: F5, delay: 3.85, dur: 0.14 },
    { f: D5, delay: 4.02, dur: 0.14 },
    { f: C5, delay: 4.19, dur: 0.56 },
  ]
  const bass: Array<{ f: number; delay: number; dur: number }> = [
    { f: 130.81, delay: 0.00, dur: 0.62 }, // C3
    { f: 130.81, delay: 0.68, dur: 0.62 }, // C3
    { f: 130.81, delay: 1.36, dur: 0.68 }, // C3
    { f: 164.81, delay: 2.08, dur: 0.48 }, // E3
    { f: 174.61, delay: 2.62, dur: 0.52 }, // F3
    { f: 130.81, delay: 3.17, dur: 0.32 }, // C3
    { f: 196.00, delay: 3.51, dur: 0.64 }, // G3
    { f: 130.81, delay: 4.19, dur: 0.58 }, // C3
  ]

  if (kind === 'out') {
    const C6 = 1046.5
    melody.push(
      { f: G5, delay: 4.92, dur: 0.14 },
      { f: E5, delay: 5.09, dur: 0.14 },
      { f: G5, delay: 5.26, dur: 0.14 },
      { f: C6, delay: 5.44, dur: 0.42 },
      { f: G5, delay: 5.92, dur: 0.14 },
      { f: C6, delay: 6.10, dur: 0.85 },
    )
    bass.push(
      { f: 196.0, delay: 4.92, dur: 0.46 },
      { f: 130.81, delay: 5.44, dur: 0.44 },
      { f: 130.81, delay: 6.10, dur: 0.85 },
    )
  }

  melody.forEach(({ f, delay, dur }) => {
    const at = t0 + delay
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'square'
    o.frequency.setValueAtTime(f, at)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.13, at + 0.01)
    g.gain.setValueAtTime(0.11, at + Math.max(0.02, dur - 0.04))
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    o.connect(g).connect(c.destination)
    o.start(at)
    o.stop(at + dur + 0.03)
  })

  bass.forEach(({ f, delay, dur }) => {
    const at = t0 + delay
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'triangle'
    o.frequency.setValueAtTime(f, at)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.16, at + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    o.connect(g).connect(c.destination)
    o.start(at)
    o.stop(at + dur + 0.03)
  })
  return kind === 'out' ? 7.0 : 4.85
}

function playSleighBells(c: AudioContext, kind: BellKind = 'in'): number {
  const t0 = c.currentTime
  // Csilingelő száncsengő: ritmikus fémcsengő-csokor + meleg csillogó akkord
  const shakes = [0.0, 0.20, 0.40, 0.72, 0.92, 1.12, 1.44, 1.62, 1.80, 2.02]
  if (kind === 'out') {
    shakes.push(2.75, 2.95, 3.15, 3.45, 3.65, 3.85, 4.18)
  }
  const buf = noiseBuf(c)
  shakes.forEach((delay, idx) => {
    const at = t0 + delay
    const accent = idx % 3 === 0 || idx === shakes.length - 1 ? 1.15 : 0.78
    const dur = idx === shakes.length - 1 ? 0.42 : 0.16

    // Magas csilingelő szűrt zaj-réteg (száncsengő golyócskák)
    const src = c.createBufferSource()
    const bp = c.createBiquadFilter()
    const g = c.createGain()
    src.buffer = buf
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(5800 + (idx % 3) * 650, at)
    bp.Q.setValueAtTime(2.6, at)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.18 * accent, at + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    src.connect(bp).connect(g).connect(c.destination)
    src.start(at, (idx * 0.07) % 0.4, dur + 0.04)

    // Fényes harangjáték felhangok
    const freqs = [2637.02, 3520.0, 4186.01] // E7, A7, C8
    freqs.forEach((f, fi) => {
      const o = c.createOscillator(), og = c.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(f * (1 + (fi - 1) * 0.006), at)
      og.gain.setValueAtTime(0.0001, at)
      og.gain.linearRampToValueAtTime(0.045 * accent, at + 0.008)
      og.gain.exponentialRampToValueAtTime(0.0001, at + dur * 1.45)
      o.connect(og).connect(c.destination)
      o.start(at)
      o.stop(at + dur * 1.55)
    })
  })

  // Meleg záró karácsonyi csengő-akkord (C6-E6-G6)
  const finaleStart = kind === 'out' ? 4.18 : 2.02
  ;[1046.5, 1318.51, 1567.98].forEach((f, i) => {
    const at = t0 + finaleStart + i * 0.05
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'triangle'
    o.frequency.setValueAtTime(f, at)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.11, at + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, at + (kind === 'out' ? 1.5 : 1.1))
    o.connect(g).connect(c.destination)
    o.start(at)
    o.stop(at + (kind === 'out' ? 1.56 : 1.16))
  })
  return kind === 'out' ? 5.8 : 3.2
}

function playHoHoHo(c: AudioContext, kind: BellKind = 'in'): number {
  const t0 = c.currentTime
  // Játékos szintetizált "Ho-Ho-Ho!" Mikulás-formáns + ünnepi harangjáték
  const hos = [
    { delay: 0.05, f0: 196.0, f1: 158.0, dur: 0.34 },
    { delay: 0.46, f0: 174.6, f1: 140.0, dur: 0.34 },
    { delay: 0.87, f0: 155.5, f1: 118.0, dur: 0.48 },
  ]
  hos.forEach(({ delay, f0, f1, dur }) => {
    const at = t0 + delay
    const o = c.createOscillator()
    const o2 = c.createOscillator()
    const fLow = c.createBiquadFilter()
    const fMid = c.createBiquadFilter()
    const g = c.createGain()

    o.type = 'sawtooth'
    o2.type = 'triangle'
    o.frequency.setValueAtTime(f0, at)
    o.frequency.exponentialRampToValueAtTime(f1, at + dur)
    o2.frequency.setValueAtTime(f0 * 0.5, at)
    o2.frequency.exponentialRampToValueAtTime(f1 * 0.5, at + dur)

    // "O" magánhangzó formáns szűrő (~480 Hz + ~880 Hz)
    fLow.type = 'bandpass'
    fLow.frequency.setValueAtTime(470, at)
    fLow.Q.setValueAtTime(3.2, at)

    fMid.type = 'peaking'
    fMid.frequency.setValueAtTime(860, at)
    fMid.Q.setValueAtTime(2.5, at)
    fMid.gain.setValueAtTime(6, at)

    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.28, at + 0.04)
    g.gain.setValueAtTime(0.24, at + dur * 0.62)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)

    o.connect(fLow)
    o2.connect(fLow)
    fLow.connect(fMid).connect(g).connect(c.destination)
    o.start(at); o2.start(at)
    o.stop(at + dur + 0.04); o2.stop(at + dur + 0.04)
  })

  // Ünnepi csilingelő finálé a Ho-Ho-Ho után (kicsengőnél extra emelkedett harangsor)
  const notes = kind === 'out'
    ? [783.99, 987.77, 1174.66, 1567.98, 1318.51, 1567.98, 1975.53, 2349.32]
    : [783.99, 987.77, 1174.66, 1567.98]
  notes.forEach((f, idx) => {
    const at = t0 + 1.42 + idx * 0.14
    const dur = idx === notes.length - 1 && kind === 'out' ? 1.45 : 0.65
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(f, at)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.14, at + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    o.connect(g).connect(c.destination)
    o.start(at)
    o.stop(at + dur + 0.05)
  })
  return kind === 'out' ? 3.9 : 2.4
}

/**
 * Modern, rétegezett „okosiskolai” harangjáték-csengő meleg visszhanggal és kompresszorral:
 * - Becsengő ('in'): lendületes, tiszta ~4,4 mp-es D-dúr/9-es hívódallam
 * - Kicsengő ('out'): hosszabb (~8,8 mp), kétrészes ünnepélyes dallam Dmaj9 fináléval
 */
function playModernBell(c: AudioContext, kind: BellKind = 'in'): number {
  const t0 = c.currentTime
  const comp = c.createDynamicsCompressor()
  comp.threshold.setValueAtTime(-16, t0)
  comp.knee.setValueAtTime(18, t0)
  comp.ratio.setValueAtTime(4, t0)

  const master = c.createGain()
  master.gain.setValueAtTime(0.88, t0)
  comp.connect(master).connect(c.destination)

  // Finom sztereó visszhang-busz a koncerttermi csengőtérhez
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(2800, t0)

  const d1 = c.createDelay(1.0)
  d1.delayTime.setValueAtTime(0.19, t0)
  const d2 = c.createDelay(1.0)
  d2.delayTime.setValueAtTime(0.29, t0)

  const fb1 = c.createGain()
  fb1.gain.setValueAtTime(0.22, t0)
  const fb2 = c.createGain()
  fb2.gain.setValueAtTime(0.22, t0)
  const wet = c.createGain()
  wet.gain.setValueAtTime(0.22, t0)

  lp.connect(d1)
  lp.connect(d2)
  d1.connect(fb1).connect(d1)
  d2.connect(fb2).connect(d2)
  d1.connect(wet)
  d2.connect(wet)
  wet.connect(comp)

  const strikeChime = (freq: number, at: number, dur: number, vol = 0.24, accent = false) => {
    // 1. Tiszta alaphang
    const o1 = c.createOscillator(), g1 = c.createGain()
    o1.type = 'sine'
    o1.frequency.setValueAtTime(freq, at)
    g1.gain.setValueAtTime(0.0001, at)
    g1.gain.linearRampToValueAtTime(vol, at + 0.012)
    g1.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    o1.connect(g1)
    g1.connect(comp)
    g1.connect(lp)
    o1.start(at)
    o1.stop(at + dur + 0.06)

    // 2. Finom detune shimmer
    const o2 = c.createOscillator(), g2 = c.createGain()
    o2.type = 'sine'
    o2.frequency.setValueAtTime(freq * 1.003, at)
    g2.gain.setValueAtTime(0.0001, at)
    g2.gain.linearRampToValueAtTime(vol * 0.42, at + 0.016)
    g2.gain.exponentialRampToValueAtTime(0.0001, at + dur * 0.92)
    o2.connect(g2).connect(comp)
    o2.start(at)
    o2.stop(at + dur + 0.05)

    // 3. 2. felhang (triangle, gyorsabb lecsengés)
    const o3 = c.createOscillator(), g3 = c.createGain()
    o3.type = 'triangle'
    o3.frequency.setValueAtTime(freq * 2, at)
    g3.gain.setValueAtTime(0.0001, at)
    g3.gain.linearRampToValueAtTime(vol * 0.26, at + 0.008)
    g3.gain.exponentialRampToValueAtTime(0.0001, at + Math.min(0.65, dur * 0.48))
    o3.connect(g3)
    g3.connect(comp)
    g3.connect(lp)
    o3.start(at)
    o3.stop(at + Math.min(0.7, dur * 0.52))

    // 4. Fémes csőharang / glockenspiel csillanás a leütéskor
    const o4 = c.createOscillator(), g4 = c.createGain()
    o4.type = 'sine'
    o4.frequency.setValueAtTime(freq * 2.756, at)
    g4.gain.setValueAtTime(0.0001, at)
    g4.gain.linearRampToValueAtTime(vol * (accent ? 0.19 : 0.12), at + 0.005)
    g4.gain.exponentialRampToValueAtTime(0.0001, at + 0.22)
    o4.connect(g4).connect(comp)
    o4.start(at)
    o4.stop(at + 0.25)

    // 5. Meleg alsó oktáv a kiemelt / záró hangokhoz
    if (accent) {
      const o5 = c.createOscillator(), g5 = c.createGain()
      o5.type = 'sine'
      o5.frequency.setValueAtTime(freq * 0.5, at)
      g5.gain.setValueAtTime(0.0001, at)
      g5.gain.linearRampToValueAtTime(vol * 0.45, at + 0.025)
      g5.gain.exponentialRampToValueAtTime(0.0001, at + dur)
      o5.connect(g5).connect(comp)
      o5.start(at)
      o5.stop(at + dur + 0.06)
    }
  }

  // Hangjegyek frekvenciái (D-dúr / Dmaj9)
  const D4 = 293.66, E4 = 329.63, G4 = 392.00, A4 = 440.00
  const D5 = 587.33, E5 = 659.25, Fs5 = 739.99, G5 = 783.99, A5 = 880.00, B5 = 987.77
  const D6 = 1174.66, E6 = 1318.51

  if (kind === 'in') {
    // Becsengő (~4.4 mp): lendületes emelkedő hívódallam + telt záróakkord
    const seq: Array<{ f: number; delay: number; dur: number; vol?: number; accent?: boolean }> = [
      { f: D5, delay: 0.00, dur: 0.95, vol: 0.23, accent: true },
      { f: Fs5, delay: 0.38, dur: 0.95, vol: 0.22 },
      { f: A5, delay: 0.76, dur: 1.05, vol: 0.24 },
      { f: D6, delay: 1.16, dur: 1.25, vol: 0.25, accent: true },
      // Rövid szünet után telt A5 + D6 záróakkord D4 alappal
      { f: D4, delay: 2.05, dur: 2.25, vol: 0.22 },
      { f: A5, delay: 2.05, dur: 2.15, vol: 0.21 },
      { f: D6, delay: 2.12, dur: 2.25, vol: 0.24, accent: true },
    ]
    seq.forEach(n => strikeChime(n.f, t0 + n.delay, n.dur, n.vol, n.accent))
    window.setTimeout(() => { try { master.disconnect() } catch { /* ignore */ } }, 5800)
    return 4.4
  }

  // Kicsengő (~8.8 mp): kétrészes modern dallamcsengő Dmaj9 fináléval
  const outSeq: Array<{ f: number; delay: number; dur: number; vol?: number; accent?: boolean }> = [
    // 1. frázis (0.0s – 3.5s) + lágy alapharmónia
    { f: D4, delay: 0.00, dur: 1.75, vol: 0.16 },
    { f: A5, delay: 0.00, dur: 0.95, vol: 0.24 },
    { f: Fs5, delay: 0.42, dur: 0.95, vol: 0.22 },
    { f: G4, delay: 0.84, dur: 1.45, vol: 0.15 },
    { f: G5, delay: 0.84, dur: 0.95, vol: 0.22 },
    { f: D5, delay: 1.26, dur: 1.20, vol: 0.24, accent: true },

    { f: E4, delay: 1.86, dur: 1.35, vol: 0.15 },
    { f: E5, delay: 1.86, dur: 0.90, vol: 0.21 },
    { f: G5, delay: 2.24, dur: 0.90, vol: 0.22 },
    { f: B5, delay: 2.62, dur: 1.00, vol: 0.23 },
    { f: A4, delay: 3.00, dur: 1.35, vol: 0.16 },
    { f: A5, delay: 3.00, dur: 1.35, vol: 0.24, accent: true },

    // 2. frázis: emelkedett finálé (3.8s – 8.8s)
    { f: D6, delay: 3.85, dur: 1.05, vol: 0.24, accent: true },
    { f: B5, delay: 4.28, dur: 0.95, vol: 0.22 },
    { f: A5, delay: 4.70, dur: 0.95, vol: 0.22 },
    { f: Fs5, delay: 5.12, dur: 0.95, vol: 0.21 },
    { f: G5, delay: 5.54, dur: 0.90, vol: 0.22 },
    { f: A5, delay: 5.92, dur: 0.95, vol: 0.23 },
    { f: B5, delay: 6.30, dur: 1.05, vol: 0.24 },
    // Gazdag, hosszan zengő Dmaj9 záróakkord (D4, A4, D5, F#5, A5, E6)
    { f: D4, delay: 6.72, dur: 2.08, vol: 0.19 },
    { f: A4, delay: 6.75, dur: 2.05, vol: 0.16 },
    { f: D5, delay: 6.78, dur: 2.02, vol: 0.18 },
    { f: Fs5, delay: 6.81, dur: 1.99, vol: 0.16 },
    { f: A5, delay: 6.84, dur: 1.96, vol: 0.17 },
    { f: D6, delay: 6.72, dur: 2.08, vol: 0.25, accent: true },
    { f: E6, delay: 6.88, dur: 1.92, vol: 0.14 },
  ]
  outSeq.forEach(n => strikeChime(n.f, t0 + n.delay, n.dur, n.vol, n.accent))
  window.setTimeout(() => { try { master.disconnect() } catch { /* ignore */ } }, 10200)
  return 8.8
}

/** Felhasználói kattintásból hívható tesztelő a VIP és ünnepi csengőhangokhoz. */
export async function previewBellSound(style: BellSoundStyle, url?: string | null, kind: BellKind = 'in') {
  const ok = await enableAudio()
  if (!ok) return false
  await ring(url, style, kind)
  return true
}

export async function ring(url?: string | null, style: BellSoundStyle = 'default', kind: BellKind = 'in') {
  const c = ctx
  if (!c || c.state !== 'running') return          // nincs engedélyezve → csendben kihagyjuk
  if (style === 'retro-8bit') {
    markBellPlaying(playRetro8Bit(c, kind))
    return
  }
  if (style === 'soft-chord') {
    markBellPlaying(playSoftChord(c, kind))
    return
  }
  if (style === 'jingle-8bit') {
    markBellPlaying(playJingle8Bit(c, kind))
    return
  }
  if (style === 'sleigh-bells') {
    markBellPlaying(playSleighBells(c, kind))
    return
  }
  if (style === 'hohoho') {
    markBellPlaying(playHoHoHo(c, kind))
    return
  }
  if (url) {
    markBellPlaying(2)
    try {
      const buf = await load(url)
      markBellPlaying(buf.duration || 4)
      const s = c.createBufferSource()
      s.buffer = buf
      s.connect(c.destination)
      s.start()
      return
    }
    catch { /* a saját hang nem játszható le: jön a beépített csengő */ }
  }
  markBellPlaying(playModernBell(c, kind))
}

// ---- Ünnepi hangok (tűzijáték, konfetti): szintetizált, külön fájl nélkül ----
let noise: AudioBuffer | null = null
const noiseBuf = (c: AudioContext) => {
  if (!noise) { noise = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1 }
  return noise
}
export type FxSoundKind = 'launch' | 'boom' | 'pop' | 'fanfare'
/** pan: -1 (bal) … 1 (jobb). Csak akkor szól, ha a hang engedélyezve van. */
export function fxSound(kind: FxSoundKind, pan = 0) {
  const c = ctx
  if (!c || c.state !== 'running') return
  const t = c.currentTime
  const out = c.createGain(); out.gain.value = 1
  const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan))
  out.connect(p).connect(c.destination)
  const tone = (type: OscillatorType, f0: number, f1: number, at: number, dur: number, vol: number) => {
    const o = c.createOscillator(), g = c.createGain()
    o.type = type; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur)
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + Math.min(0.03, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    o.connect(g).connect(out); o.start(at); o.stop(at + dur + 0.05)
  }
  const burst = (at: number, dur: number, f0: number, f1: number, q: number, vol: number, kindF: BiquadFilterType = 'lowpass') => {
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain()
    s.buffer = noiseBuf(c); f.type = kindF; f.Q.value = q
    f.frequency.setValueAtTime(f0, at); f.frequency.exponentialRampToValueAtTime(f1, at + dur)
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    s.connect(f).connect(g).connect(out); s.start(at, Math.random() * 0.4, dur + 0.05)
  }
  if (kind === 'launch') { tone('sine', 380, 1500, t, 0.5, 0.05); burst(t, 0.5, 1800, 3500, 1, 0.03, 'highpass') }
  else if (kind === 'boom') {
    tone('sine', 120, 38, t, 0.7, 0.55); burst(t, 0.8, 2200, 180, 0.7, 0.55)
    for (let i = 0; i < 9; i++) burst(t + 0.25 + Math.random() * 0.8, 0.05, 6000, 3000, 1.5, 0.12 + Math.random() * 0.1, 'highpass')   // sistergés
  }
  else if (kind === 'pop') {
    // Lágy, tiszta buborék/marimba kattintáshang (zajmentes)
    tone('sine', 440, 740, t, 0.085, 0.22)
    tone('triangle', 880, 1180, t + 0.018, 0.07, 0.08)
  }
  else [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone('triangle', f, f, t + i * 0.13, i === 5 ? 0.6 : 0.18, 0.18))
  setTimeout(() => out.disconnect(), 2500)
}
