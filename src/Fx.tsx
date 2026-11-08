import { useEffect, useRef, useState } from 'react'
import { FxEngine } from './lib/fx'
import { fxSound } from './lib/sound'

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Neon háttér-réteg: részecskék, kattintás-szikrák, fényfolt a paneleken, csengetéskor robbanás. Csak a Neon stílusban él. */
export default function Fx({ phase, bellKey, tv, wx, sound }: { phase: string; bellKey: string; tv: boolean; wx?: number | null; sound?: boolean }) {
  const refBg = useRef<HTMLCanvasElement>(null)
  const refFg = useRef<HTMLCanvasElement>(null)
  const eng = useRef<FxEngine | null>(null)
  const off = reduced()

  // Csak a releváns propok változásakor induljon újra az engine
  useEffect(() => {
    if (off || !refBg.current || !refFg.current) return
    let e: FxEngine
    try { e = new FxEngine(refBg.current, refFg.current, tv) } catch { return }
    eng.current = e
    e.setPhase(phase)
    e.start()
    return () => { e.stop(); eng.current = null }
  }, [off, tv])

  useEffect(() => { eng.current?.setPhase(phase) }, [phase])
  useEffect(() => { if (eng.current) eng.current.onSound = sound ? fxSound : undefined }, [sound])
  useEffect(() => { eng.current?.setWeather(wx) }, [wx])      // valódi időjárás: eső, hó, vihar
  useEffect(() => {                                                    // tűzijáték / konfetti a nagy pillanatokra
    const on = (e: Event) => { const d = (e as CustomEvent).detail ?? {}; eng.current?.celebrate(d.kind ?? 'both', d.power ?? 1) }
    window.addEventListener('sulibell:celebrate', on)
    return () => window.removeEventListener('sulibell:celebrate', on)
  }, [])

  // Állapotváltáskor (csengetés) szikra-robbanás a számlap körül; betöltéskor nem.
  const prev = useRef('')
  useEffect(() => {
    if (!bellKey) return
    const was = prev.current
    prev.current = bellKey
    if (!was || was === bellKey || phase === 'closed' || phase === 'before') return
    const r = document.querySelector('.ring')?.getBoundingClientRect()
    eng.current?.bell(r ? r.left + r.width / 2 : window.innerWidth / 2, r ? r.top + r.height / 2 : window.innerHeight / 3, r ? r.width / 2 : 180)
  }, [bellKey])

  // Fényfolt: a panelek az egér alatt finoman felfénylenek (csak egérrel).
  useEffect(() => {
    if (off || !matchMedia('(hover: hover)').matches) return
    let raf = 0
    const on = (ev: PointerEvent) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const el = (ev.target as HTMLElement | null)?.closest?.('.panel, .ev, .stat, .wd') as HTMLElement | null
        if (!el) return
        const b = el.getBoundingClientRect()
        el.style.setProperty('--mx', `${ev.clientX - b.left}px`)
        el.style.setProperty('--my', `${ev.clientY - b.top}px`)
      })
    }
    window.addEventListener('pointermove', on, { passive: true })
    return () => { window.removeEventListener('pointermove', on); cancelAnimationFrame(raf) }
  }, [off])

  return off ? null : (
    <>
      <canvas ref={refBg} className="fxcanvas fxcanvas-bg" aria-hidden="true" />
      <canvas ref={refFg} className="fxcanvas-fg" aria-hidden="true" />
    </>
  )
}

/** Az utolsó 10 másodperc: hatalmas számok, élfény, gyűrű-lüktetés (másodpercenként újraindul). */
export function FinalCount({ phase, remaining }: { phase: string; remaining: number }) {
  if (!(phase === 'lesson' || phase === 'break' || phase === 'before') || remaining < 1 || remaining > 10) return null
  return <div key={remaining} className={`final ${phase}`} aria-hidden="true"><i /><b>{remaining}</b></div>
}

/** Csengetéskor rövid felirat: "Becsengettek" / "Kicsengettek" / "Vége a tanításnak". */
export function BellFlash({ bellKey, phase, label }: { bellKey: string; phase: string; label?: string }) {
  const [msg, setMsg] = useState<{ id: string; phase: string; title: string; sub: string } | null>(null)
  const prev = useRef('')
  useEffect(() => {
    if (!bellKey) return
    const was = prev.current
    prev.current = bellKey
    if (!was || was === bellKey) return          // első betöltés: nincs villanás
    if (phase === 'lesson') setMsg({ id: bellKey, phase, title: 'Becsengettek', sub: label ?? '' })
    else if (phase === 'break') setMsg({ id: bellKey, phase, title: 'Kicsengettek', sub: 'Szünet' })
    else if (phase === 'after') setMsg({ id: bellKey, phase, title: 'Vége a tanításnak', sub: 'Szép napot!' })
    else return
    const t = setTimeout(() => setMsg(null), 2700)
    return () => clearTimeout(t)
  }, [bellKey])
  return msg ? <div key={msg.id} className={`bellbanner ${msg.phase}`} role="status"><b>{msg.title}</b>{msg.sub && <span>{msg.sub}</span>}</div> : null
}

/** Nagy pillanatok: egy visszaszámláló nullára ér, hétvége / ünnep előtt vége a tanításnak, vagy a logóra 5-ször kattintanak (parti mód).
 *  Tűzijátékot és konfettit indít, és feliratot mutat. Az effektek a Fx rétegen át jelennek meg. */
export function Celebrate({ phase, awayDays, events, enabled, sound }: { phase: string; awayDays: number; events: { id: string; title: string; left: number }[]; enabled: boolean; sound?: boolean }) {
  const [msg, setMsg] = useState<{ id: number; title: string; sub: string } | null>(null)
  const fire = (title: string, sub: string, kind: 'fireworks' | 'confetti' | 'both' = 'both', power = 1) => {
    if (enabled && sound) fxSound('fanfare', 0)
    if (enabled) window.dispatchEvent(new CustomEvent('sulibell:celebrate', { detail: { kind, power } }))
    setMsg({ id: Date.now(), title, sub })
  }
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4200); return () => clearTimeout(t) }, [msg?.id])

  // 1) Visszaszámláló nullára ér
  const seen = useRef<Map<string, number>>(new Map())
  const first = useRef(true)
  const key = events.map(e => `${e.id}:${e.left > 0 ? 1 : 0}`).join()
  useEffect(() => {
    for (const e of events) {
      const was = seen.current.get(e.id)
      if (!first.current && was != null && was > 0 && e.left <= 0 && e.left > -120) fire(e.title, 'Megérkeztünk!', 'both', 1.4)
      seen.current.set(e.id, e.left)
    }
    first.current = false
  }, [key])

  // 2) Vége az utolsó tanítási órának hétvége / ünnep előtt
  const prevPhase = useRef('')
  useEffect(() => {
    if (prevPhase.current === 'lesson' && phase === 'after' && awayDays >= 2) fire('Jó hétvégét!', awayDays > 3 ? 'Pihenjetek jól!' : 'Szép pihenést!', 'both', 1.3)
    prevPhase.current = phase
  }, [phase])

  // 3) Parti mód: a logóra 5 kattintás 3 mp-en belül (vagy a címben ?party)
  useEffect(() => {
    let n = 0, t = 0
    const on = (e: Event) => {
      if (!(e.target as HTMLElement | null)?.closest?.('.brand')) return
      const now = Date.now(); n = now - t > 3000 ? 1 : n + 1; t = now
      if (n >= 5) { n = 0; fire('Parti!', 'Szuper rejtett funkciót találtál', 'both', 1.6) }
    }
    window.addEventListener('click', on)
    if (/[?&]party\b/.test(location.search)) setTimeout(() => fire('Parti!', 'SuliBell', 'both', 1.2), 1200)
    return () => window.removeEventListener('click', on)
  }, [enabled, sound])

  return msg ? <div key={msg.id} className="bellbanner after party" role="status"><b>{msg.title}</b><span>{msg.sub}</span></div> : null
}
