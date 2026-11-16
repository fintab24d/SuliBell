import { useEffect, useRef } from 'react'

/** Egyedi Windows-stílusú neon egérkurzor: hardveres OS kurzorkép (nulla késleltetés) + kattintási szikrahullám.
 *  Csak egérrel, finom mutatóval (hover: hover) és mozgáscsökkentés nélkül él; a TV-módban (/display) nincs.
 *  A billentyűzetes fókuszkeret érintetlen marad. Beágyazás: a main.tsx-ben, minden oldalon. */
export default function Cursor() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (location.pathname.startsWith('/display')) return
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const el = root.current
    if (!el) return

    const html = document.documentElement
    html.classList.add('cursor-on')

    const up = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const p = document.createElement('div')              // szikra-kör a kattintás helyén
      p.className = 'cur-pop'
      p.style.left = `${e.clientX}px`
      p.style.top = `${e.clientY}px`
      p.innerHTML = '<i></i>'
      p.addEventListener('animationend', () => p.remove(), { once: true })
      el.appendChild(p)
    }

    window.addEventListener('pointerup', up, { passive: true })
    return () => {
      html.classList.remove('cursor-on')
      window.removeEventListener('pointerup', up)
    }
  }, [])

  return <div ref={root} className="cur" aria-hidden="true" />
}
