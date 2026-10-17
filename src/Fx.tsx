import { useEffect, useRef, useState } from 'react'
import { FxEngine } from './lib/fx'

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Neon háttér-réteg: részecskék, kattintás-szikrák, fényfolt a paneleken, csengetéskor robbanás. Csak a Neon stílusban él. */
export default function Fx({ phase, bellKey, tv }: { phase: string; bellKey: string; tv: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const eng = useRef<FxEngine | null>(null)
  const off = reduced()

  useEffect(() => {
    if (off || !ref.current) return
    let e: FxEngine
    try { e = new FxEngine(ref.current, tv) } catch { return }
    eng.current = e
    e.setPhase(phase)
    e.start()
    return () => { e.stop(); eng.current = null }
  }, [off, tv])

  useEffect(() => { eng.current?.setPhase(phase) }, [phase])

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

  return off ? null : <canvas ref={ref} className="fxcanvas" aria-hidden="true" />
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
