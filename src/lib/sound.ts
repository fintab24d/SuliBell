// Csengő: ha az admin feltöltött hangfájlt, az szól; különben a beépített, szintetizált csengő.
let ctx: AudioContext | null = null
let cached: { url: string; data: AudioBuffer } | null = null
export const audioReady = () => ctx?.state === 'running'

/** Csak felhasználói kattintásból hívd: a böngésző autoplay-szabályait nem kerüljük meg. */
export async function enableAudio() {
  ctx ??= new AudioContext()
  await ctx.resume()
  return ctx.state === 'running'
}

async function load(url: string) {
  if (cached?.url === url) return cached.data
  const r = await fetch(url)
  const data = await ctx!.decodeAudioData(await r.arrayBuffer())
  cached = { url, data }
  return data
}
/** Előre betölti a saját hangot, hogy csengetéskor ne legyen késés. */
export function preload(url?: string | null) { if (url && ctx && ctx.state === 'running') load(url).catch(() => {}) }

export type BellSoundStyle = 'default' | 'retro-8bit' | 'soft-chord'

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

/** Felhasználói kattintásból hívható tesztelő a VIP csengőhangokhoz. */
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
  else if (kind === 'pop') { tone('sine', 260, 70, t, 0.14, 0.5); burst(t, 0.14, 3200, 800, 0.8, 0.45, 'bandpass'); for (let i = 0; i < 6; i++) burst(t + 0.1 + Math.random() * 0.5, 0.04, 5000, 2500, 1.2, 0.06, 'highpass') }
  else [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone('triangle', f, f, t + i * 0.13, i === 5 ? 0.6 : 0.18, 0.18))
  setTimeout(() => out.disconnect(), 2500)
}
