// Csengő: ha az admin feltöltött hangfájlt, az szól; különben a beépített, szintetizált csengő.
let ctx: AudioContext | null = null
let cached: { url: string; data: AudioBuffer } | null = null
let loadingAudio: { url: string; promise: Promise<AudioBuffer> } | null = null
export const audioReady = () => ctx?.state === 'running'

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

export type BellSoundStyle =
  | 'default'
  | 'retro-8bit'
  | 'soft-chord'
  | 'jingle-8bit'
  | 'sleigh-bells'
  | 'hohoho'

function playRetro8Bit(c: AudioContext) {
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
}

function playSoftChord(c: AudioContext) {
  const t0 = c.currentTime
  // Lágy, nyugtató Fmaj9 -> Cmaj9 lebegő akkord-jelzés
  const chords = [
    { delay: 0.0, dur: 1.7, freqs: [349.23, 440.0, 523.25, 659.25, 783.99] }, // Fmaj9
    { delay: 1.35, dur: 2.2, freqs: [261.63, 392.0, 493.88, 587.33, 659.25] }, // Cmaj9
  ]
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
}

function playJingle8Bit(c: AudioContext) {
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
}

function playSleighBells(c: AudioContext) {
  const t0 = c.currentTime
  // Csilingelő száncsengő: ritmikus fémcsengő-csokor + meleg csillogó akkord
  const shakes = [0.0, 0.20, 0.40, 0.72, 0.92, 1.12, 1.44, 1.62, 1.80, 2.02]
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
  ;[1046.5, 1318.51, 1567.98].forEach((f, i) => {
    const at = t0 + 2.02 + i * 0.05
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'triangle'
    o.frequency.setValueAtTime(f, at)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.11, at + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.1)
    o.connect(g).connect(c.destination)
    o.start(at)
    o.stop(at + 1.16)
  })
}

function playHoHoHo(c: AudioContext) {
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

  // Ünnepi csilingelő finálé a Ho-Ho-Ho után
  ;[783.99, 987.77, 1174.66, 1567.98].forEach((f, idx) => {
    const at = t0 + 1.42 + idx * 0.09
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(f, at)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.14, at + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.65)
    o.connect(g).connect(c.destination)
    o.start(at)
    o.stop(at + 0.7)
  })
}

/** Felhasználói kattintásból hívható tesztelő a VIP és ünnepi csengőhangokhoz. */
export async function previewBellSound(style: BellSoundStyle, url?: string | null) {
  const ok = await enableAudio()
  if (!ok) return false
  await ring(url, style)
  return true
}

export async function ring(url?: string | null, style: BellSoundStyle = 'default') {
  const c = ctx
  if (!c || c.state !== 'running') return          // nincs engedélyezve → csendben kihagyjuk
  if (style === 'retro-8bit') {
    playRetro8Bit(c)
    return
  }
  if (style === 'soft-chord') {
    playSoftChord(c)
    return
  }
  if (style === 'jingle-8bit') {
    playJingle8Bit(c)
    return
  }
  if (style === 'sleigh-bells') {
    playSleighBells(c)
    return
  }
  if (style === 'hohoho') {
    playHoHoHo(c)
    return
  }
  if (url) {
    try { const s = c.createBufferSource(); s.buffer = await load(url); s.connect(c.destination); s.start(); return }
    catch { /* a saját hang nem játszható le: jön a beépített csengő */ }
  }
  const t0 = c.currentTime
  // Iskolai dallamcsengő: hosszabb, teltebb hangzás harmonikus felhangokkal (~7 mp a korábbi 2 mp helyett)
  const notes = [
    { f: 880, delay: 0.0, dur: 1.1 },    // A5
    { f: 659.25, delay: 0.75, dur: 1.1 }, // E5
    { f: 880, delay: 1.5, dur: 1.3 },    // A5
    { f: 659.25, delay: 2.4, dur: 1.1 }, // E5
    { f: 880, delay: 3.15, dur: 1.1 },   // A5
    { f: 1046.5, delay: 3.9, dur: 1.3 }, // C6
    { f: 880, delay: 4.8, dur: 2.2 },    // A5 (hosszú, zengő záróhang)
  ]

  notes.forEach(({ f, delay, dur }) => {
    const at = t0 + delay
    // Alaphang (meleg, tiszta szinusz)
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'sine'
    o.frequency.value = f
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(0.35, at + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    o.connect(g).connect(c.destination)
    o.start(at)
    o.stop(at + dur + 0.05)

    // Fémcsengő / csőharang felhang (természetes csengő-fény a leütéskor)
    const o2 = c.createOscillator(), g2 = c.createGain()
    o2.type = 'triangle'
    o2.frequency.value = f * 2
    g2.gain.setValueAtTime(0.0001, at)
    g2.gain.exponentialRampToValueAtTime(0.08, at + 0.015)
    g2.gain.exponentialRampToValueAtTime(0.0001, at + Math.min(0.45, dur))
    o2.connect(g2).connect(c.destination)
    o2.start(at)
    o2.stop(at + Math.min(0.5, dur))
  })
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
