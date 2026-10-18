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

export async function ring(url?: string | null) {
  const c = ctx
  if (!c || c.state !== 'running') return          // nincs engedélyezve → csendben kihagyjuk
  if (url) {
    try { const s = c.createBufferSource(); s.buffer = await load(url); s.connect(c.destination); s.start(); return }
    catch { /* a saját hang nem játszható le: jön a beépített csengő */ }
  }
  const t0 = c.currentTime
  ;[880, 660, 880].forEach((f, i) => {
    const o = c.createOscillator(), g = c.createGain(), t = t0 + i * 0.7
    o.type = 'sine'; o.frequency.value = f
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65)
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.7)
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
