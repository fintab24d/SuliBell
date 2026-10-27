import { useEffect, useRef, type CSSProperties } from 'react'

// Elemek, amelyek fölött a kurzor "kattintható" állapotba vált / szövegbeviteli (I-beam) alakot vesz fel.
const CLICK = 'a[href],button,[role="button"],label.btn,select,summary,input[type="checkbox"],input[type="radio"],input[type="button"],input[type="submit"],input[type="file"],input[type="range"],input[type="color"],.popt'
const TEXT = 'textarea,[contenteditable="true"],input:not([type="checkbox"],[type="radio"],[type="button"],[type="submit"],[type="file"],[type="range"],[type="color"])'
const TRAIL = 5

/** Egyedi neon egérkurzor: pontos pont + puhán követő gyűrű + halvány csóva.
 *  Csak egérrel, finom mutatóval (hover: hover) és mozgáscsökkentés nélkül él; a TV-módban (/display) nincs.
 *  A billentyűzetes fókuszkeret érintetlen marad. Beágyazás: a main.tsx-ben, minden oldalon. */
export default function Cursor() {
  const root = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const dot = useRef<HTMLDivElement>(null)
  const trail = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    if (location.pathname.startsWith('/display')) return
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const el = root.current, rg = ring.current, dt = dot.current
    if (!el || !rg || !dt) return

    const html = document.documentElement
    html.classList.add('cursor-on')                       // a valódi kurzort csak most rejtjük el
    const tx = { x: -100, y: -100 }                        // célpont (az egér)
    const rp = { x: -100, y: -100 }                        // gyűrű
    const tp = Array.from({ length: TRAIL }, () => ({ x: -100, y: -100 }))
    let raf = 0, seen = false

    const put = (n: HTMLElement | null, p: { x: number; y: number }) => { if (n) n.style.transform = `translate3d(${p.x}px,${p.y}px,0)` }
    const loop = () => {
      rp.x += (tx.x - rp.x) * 0.2; rp.y += (tx.y - rp.y) * 0.2
      let px = rp.x, py = rp.y, moving = Math.abs(tx.x - rp.x) + Math.abs(tx.y - rp.y) > 0.3
      tp.forEach((t, i) => { t.x += (px - t.x) * 0.32; t.y += (py - t.y) * 0.32; px = t.x; py = t.y; put(trail.current[i], t); if (Math.abs(t.x - rp.x) + Math.abs(t.y - rp.y) > 0.3) moving = true })
      put(rg, rp)
      raf = moving ? requestAnimationFrame(loop) : 0      // ha minden elért a célig, a ciklus leáll
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop) }

    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      tx.x = e.clientX; tx.y = e.clientY
      if (!seen) { seen = true; rp.x = tx.x; rp.y = tx.y; tp.forEach(t => { t.x = tx.x; t.y = tx.y }) }   // első mozdulatnál nincs "berepülés"
      put(dt, tx)
      el.classList.add('on')
      kick()
    }
    const over = (e: PointerEvent) => {
      const t = e.target as Element | null
      const text = !!t?.closest?.(TEXT), click = !text && !!t?.closest?.(CLICK) && !(t.closest('button,input,select') as HTMLButtonElement | null)?.disabled
      el.classList.toggle('text', text); el.classList.toggle('link', click)
    }
    const down = (e: PointerEvent) => { if (e.pointerType === 'mouse') el.classList.add('down') }
    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      el.classList.remove('down')
      const p = document.createElement('div')              // szikra-kör a kattintás helyén
      p.className = 'cur-pop'; p.style.left = `${e.clientX}px`; p.style.top = `${e.clientY}px`
      p.innerHTML = '<i></i>'
      p.addEventListener('animationend', () => p.remove(), { once: true })
      el.appendChild(p)
    }
    const out = (e: MouseEvent) => { if (!e.relatedTarget) el.classList.remove('on') }   // az ablakot elhagyta
    const hide = () => { if (document.hidden) el.classList.remove('on') }

    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerover', over, { passive: true })
    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    document.addEventListener('mouseout', out)
    document.addEventListener('visibilitychange', hide)
    return () => {
      cancelAnimationFrame(raf)
      html.classList.remove('cursor-on')
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerover', over)
      window.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up)
      document.removeEventListener('mouseout', out); document.removeEventListener('visibilitychange', hide)
    }
  }, [])

  return <div ref={root} className="cur" aria-hidden="true">
    {Array.from({ length: TRAIL }, (_, i) => <div key={i} className="cur-t" ref={n => { trail.current[i] = n }} style={{ '--k': i } as CSSProperties}><i /></div>)}
    <div ref={ring} className="cur-ring"><i /></div>
    <div ref={dot} className="cur-dot"><i /></div>
  </div>
}
