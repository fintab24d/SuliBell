import { memo, useEffect, useRef, useState } from 'react'
import { FxEngine, type CelebrateKind } from './lib/fx'
import { fxSound } from './lib/sound'
import { claimDailyAnimationOnce, claimEasterEggOnce } from './lib/animGuard'

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Neon háttér-réteg: részecskék, kattintás-szikrák, fényfolt a paneleken, csengetéskor robbanás. Csak a Neon stílusban él. */
const Fx = memo(function Fx({ phase, bellKey, day, tv, wx, night, sound, festiveSnow }: { phase: string; bellKey: string; day?: string; tv: boolean; wx?: number | null; night?: boolean; sound?: boolean; festiveSnow?: boolean }) {
  const refBg = useRef<HTMLCanvasElement>(null)
  const refFg = useRef<HTMLCanvasElement>(null)
  const eng = useRef<FxEngine | null>(null)
  const off = reduced()
  const dayRef = useRef(day || 'today')
  dayRef.current = day || 'today'

  // Csak a releváns propok változásakor induljon újra az engine
  useEffect(() => {
    if (off || !refBg.current || !refFg.current) return
    let e: FxEngine
    try { e = new FxEngine(refBg.current, refFg.current, tv) } catch { return }
    eng.current = e
    e.setPhase(phase)
    e.setNight(!!night)
    e.setFestiveSnow(!!festiveSnow)
    e.start()
    return () => { e.stop(); eng.current = null }
  }, [off, tv])

  useEffect(() => { eng.current?.setPhase(phase) }, [phase])
  useEffect(() => { if (eng.current) eng.current.onSound = sound ? fxSound : undefined }, [sound])
  useEffect(() => { eng.current?.setWeather(wx) }, [wx])      // valódi időjárás: eső, hó, vihar
  useEffect(() => { eng.current?.setNight(!!night) }, [night]) // napszak: nappal Nap, este Hold
  useEffect(() => { eng.current?.setFestiveSnow(!!festiveSnow) }, [festiveSnow]) // kapcsolható ünnepi hóesés
  useEffect(() => {                                                    // tűzijáték / konfetti a nagy pillanatokra
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail ?? {}
      eng.current?.celebrate(d.kind ?? 'both', d.power ?? 1, d.ox, d.oy)
    }
    window.addEventListener('sulibell:celebrate', on)
    return () => window.removeEventListener('sulibell:celebrate', on)
  }, [])

  // Állapotváltáskor (csengetés) szikra-robbanás a számlap körül; központilag egyszer játszódik le, betöltéskor nem.
  const prev = useRef('')
  useEffect(() => {
    if (!bellKey) return
    const was = prev.current
    prev.current = bellKey
    if (!was || was === bellKey || phase === 'closed' || phase === 'before') return
    if (!claimDailyAnimationOnce(dayRef.current, `bell-burst:${bellKey}`)) return
    const r = document.querySelector('.ring')?.getBoundingClientRect()
    eng.current?.bell(r ? r.left + r.width / 2 : window.innerWidth / 2, r ? r.top + r.height / 2 : window.innerHeight / 3, r ? r.width / 2 : 180)
  }, [bellKey])

  // Fényfolt: a panelek az egér alatt finoman felfénylenek (csak egérrel, cache-elt recttel, nulla layout thrashinggel).
  useEffect(() => {
    if (off || !matchMedia('(hover: hover)').matches) return
    let raf = 0
    let cachedEl: HTMLElement | null = null
    let cachedRect: DOMRect | null = null
    let cachedAt = 0
    const invalidate = () => { cachedRect = null }
    const on = (ev: PointerEvent) => {
      if (raf) return
      const ds = document.documentElement.dataset
      if (ds.potato === '1' || ds.perf === 'lite') return
      const clientX = ev.clientX
      const clientY = ev.clientY
      const target = ev.target as HTMLElement | null
      raf = requestAnimationFrame(() => {
        raf = 0
        const el = target?.closest?.('.panel, .ev, .stat, .wd') as HTMLElement | null
        if (!el) return
        const now = performance.now()
        if (el !== cachedEl || !cachedRect || now - cachedAt > 250) {
          cachedEl = el
          cachedRect = el.getBoundingClientRect()
          cachedAt = now
        }
        el.style.setProperty('--mx', `${Math.round(clientX - cachedRect.left)}px`)
        el.style.setProperty('--my', `${Math.round(clientY - cachedRect.top)}px`)
      })
    }
    window.addEventListener('pointermove', on, { passive: true })
    window.addEventListener('scroll', invalidate, { passive: true })
    window.addEventListener('resize', invalidate, { passive: true })
    return () => {
      window.removeEventListener('pointermove', on)
      window.removeEventListener('scroll', invalidate)
      window.removeEventListener('resize', invalidate)
      cancelAnimationFrame(raf)
    }
  }, [off])

  return off ? null : (
    <>
      <canvas ref={refBg} className="fxcanvas fxcanvas-bg" aria-hidden="true" />
      <canvas ref={refFg} className="fxcanvas-fg" aria-hidden="true" />
    </>
  )
})
export default Fx

/** Az utolsó 10 másodperc: hatalmas számok, élfény, gyűrű-lüktetés (másodpercenként újraindul). */
export const FinalCount = memo(function FinalCount({ phase, remaining }: { phase: string; remaining: number }) {
  if (!(phase === 'lesson' || phase === 'break' || phase === 'before') || remaining < 1 || remaining > 10) return null
  return <div key={remaining} className={`final ${phase}`} aria-hidden="true"><i /><b>{remaining}</b></div>
})

/** Csengetéskor rövid felirat: "Becsengettek" / "Kicsengettek" / "Vége a tanításnak". Központilag csak egyszer játszódik le. */
export const BellFlash = memo(function BellFlash({ bellKey, day, phase, label }: { bellKey: string; day?: string; phase: string; label?: string }) {
  const [msg, setMsg] = useState<{ id: string; phase: string; title: string; sub: string } | null>(null)
  const prev = useRef('')
  const dayRef = useRef(day || 'today')
  dayRef.current = day || 'today'
  useEffect(() => {
    if (!bellKey) return
    const was = prev.current
    prev.current = bellKey
    if (!was || was === bellKey) return          // első betöltés: nincs villanás
    if (!claimDailyAnimationOnce(dayRef.current, `bell-banner:${bellKey}`)) return
    if (phase === 'lesson') setMsg({ id: bellKey, phase, title: 'Becsengettek', sub: label ?? '' })
    else if (phase === 'break') setMsg({ id: bellKey, phase, title: 'Kicsengettek', sub: 'Szünet' })
    else if (phase === 'after') setMsg({ id: bellKey, phase, title: 'Vége a tanításnak', sub: 'Szép napot!' })
    else return
    const t = setTimeout(() => setMsg(null), 2700)
    return () => clearTimeout(t)
  }, [bellKey])
  return msg ? <div key={msg.id} className={`bellbanner ${msg.phase}`} role="status"><b>{msg.title}</b>{msg.sub && <span>{msg.sub}</span>}</div> : null
})

/** Nagy pillanatok és rejtett Easter Eggek (minden animáció központilag csak egyszer játszódik le):
 *  - Visszaszámláló 0 / hétvége előtti utolsó óra
 *  - Logó 5× kattintás (Parti mód) / ?party
 *  - Konami-kód (↑↑↓↓←→←→BA) → 8-bites árkád mód
 *  - Titkos begépelt szavak (matrix, cica/miau, szunet/pihi, sulibell)
 *  - Nagy óra 7× kattintás → Időutazó mód
 *  - Verziószám 5× kattintás → Kódmágus mód
 *  - Időjárás ikon 5× kattintás → Időjárás-varázslat */
export const Celebrate = memo(function Celebrate({ phase, day, awayDays, events, enabled, sound, allowEasterEggs = true }: { phase: string; day?: string; awayDays: number; events: { id: string; title: string; left: number }[]; enabled: boolean; sound?: boolean; allowEasterEggs?: boolean }) {
  const [msg, setMsg] = useState<{ id: number; title: string; sub: string } | null>(null)
  const eggTimerRef = useRef<number>(0)
  const dayRef = useRef(day || 'today')
  dayRef.current = day || 'today'

  const fire = (title: string, sub: string, kind: CelebrateKind = 'both', power = 1, originEl?: Element | null) => {
    if (enabled && sound) fxSound('fanfare', 0)
    let ox: number | undefined
    let oy: number | undefined
    if (originEl) {
      const r = originEl.getBoundingClientRect()
      ox = r.left + r.width * 0.5
      oy = r.top + r.height * 0.5
    }
    if (enabled) window.dispatchEvent(new CustomEvent('sulibell:celebrate', { detail: { kind, power, ox, oy } }))
    setMsg({ id: Date.now() + Math.random(), title, sub })
  }

  const flashHtmlClass = (cls: string, ms = 7500) => {
    const h = document.documentElement
    h.classList.remove('egg-arcade', 'egg-matrix', 'egg-gold', 'egg-warp')
    h.classList.add(cls)
    if (eggTimerRef.current) window.clearTimeout(eggTimerRef.current)
    eggTimerRef.current = window.setTimeout(() => {
      h.classList.remove('egg-arcade', 'egg-matrix', 'egg-gold', 'egg-warp')
    }, ms)
  }

  useEffect(() => () => {
    if (eggTimerRef.current) window.clearTimeout(eggTimerRef.current)
    document.documentElement.classList.remove('egg-arcade', 'egg-matrix', 'egg-gold', 'egg-warp')
  }, [])

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4400); return () => clearTimeout(t) }, [msg?.id])

  // 1) Visszaszámláló nullára ér
  const seen = useRef<Map<string, number>>(new Map())
  const first = useRef(true)
  const key = events.map(e => `${e.id}:${e.left > 0 ? 1 : 0}`).join()
  useEffect(() => {
    for (const e of events) {
      const was = seen.current.get(e.id)
      if (!first.current && was != null && was > 0 && e.left <= 0 && e.left > -120) {
        if (claimDailyAnimationOnce(dayRef.current, `celebrate-ev:${e.id}`)) {
          fire(e.title, 'Megérkeztünk!', 'both', 1.4)
        }
      }
      seen.current.set(e.id, e.left)
    }
    first.current = false
  }, [key])

  // 2) Vége az utolsó tanítási órának hétvége / ünnep előtt
  const prevPhase = useRef('')
  useEffect(() => {
    if (prevPhase.current === 'lesson' && phase === 'after' && awayDays >= 2) {
      if (claimDailyAnimationOnce(dayRef.current, `celebrate-weekend:${dayRef.current}`)) {
        fire('Jó hétvégét!', awayDays > 3 ? 'Pihenjetek jól!' : 'Szép pihenést!', 'both', 1.3)
      }
    }
    prevPhase.current = phase
  }, [phase])

  // 3) Kattintásos & URL Easter Eggek + DevTools konzol üzenet
  useEffect(() => {
    if (!allowEasterEggs) {
      if (eggTimerRef.current) window.clearTimeout(eggTimerRef.current)
      document.documentElement.classList.remove('egg-arcade', 'egg-matrix', 'egg-gold', 'egg-warp')
      return
    }
    const clicks: Record<string, { n: number; t: number }> = {}
    const bump = (id: string, need: number, windowMs = 3000) => {
      const now = Date.now(), cur = clicks[id]
      const n = !cur || now - cur.t > windowMs ? 1 : cur.n + 1
      clicks[id] = { n, t: now }
      if (n >= need) { clicks[id] = { n: 0, t: 0 }; return true }
      return false
    }

    const onClick = (e: Event) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      const brandEl = target.closest('.brand')
      const clockEl = target.closest('.timebox')
      const verEl = target.closest('.foot .ver')
      const wxEl = target.closest('.wx')
      if (brandEl && bump('brand', 5)) {
        if (!claimEasterEggOnce('egg:brand')) return
        fire('Parti!', 'Szuper rejtett funkciót találtál', 'both', 1.6, brandEl)
      } else if (clockEl && bump('clock', 7)) {
        if (!claimEasterEggOnce('egg:clock')) return
        flashHtmlClass('egg-warp', 6500)
        fire('⏳ Időutazó mód!', 'Sajnos az órát így sem tudod előretekerni a kicsengetésig 😅', 'warp', 1.5, clockEl)
      } else if (verEl && bump('ver', 5)) {
        if (!claimEasterEggOnce('egg:ver')) return
        fire('🛠️ Kódmágus!', 'Ezt a titkot a diákok 99%-a sosem találja meg. Szép munka!', 'hacker', 1.4, verEl)
      } else if (wxEl && bump('wx', 5)) {
        if (!claimEasterEggOnce('egg:wx')) return
        fire('🌦️ Időjárás-varázsló!', 'Hószünetet ugyan nem tudunk rendelni, de jár egy varázs-kavalkád ✨', 'weather', 1.3, wxEl)
      }
    }

    window.addEventListener('click', onClick)
    let partyTimer: number | undefined
    if (/[?&]party\b/.test(location.search)) {
      partyTimer = window.setTimeout(() => {
        if (claimEasterEggOnce('egg:party-url')) fire('Parti!', 'SuliBell', 'both', 1.2)
      }, 1200)
    }
    return () => {
      window.removeEventListener('click', onClick)
      if (partyTimer) window.clearTimeout(partyTimer)
    }
  }, [enabled, sound, allowEasterEggs])

  // 4) Billentyűs Easter Eggek: Konami-kód + titkos varázsszavak (input mezőkön kívül)
  useEffect(() => {
    if (!allowEasterEggs) return
    const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']
    let kIdx = 0
    let buf = ''

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el?.closest?.('input,textarea,select,[contenteditable="true"]')) return

      const raw = e.key
      const low = raw.length === 1 ? raw.toLowerCase() : raw

      // Konami-kód vizsgálata
      if (low === KONAMI[kIdx]) {
        kIdx++
        if (kIdx === KONAMI.length) {
          kIdx = 0
          if (claimEasterEggOnce('egg:konami')) {
            flashHtmlClass('egg-arcade', 8000)
            fire('👾 KONAMI-KÓD FELOLDVA!', 'Titkos 8-bites árkád mód aktiválva (+1000 tiszteletpont!)', 'arcade', 1.6)
          }
        }
      } else {
        kIdx = low === KONAMI[0] ? 1 : 0
      }

      // Titkos begépelt szavak (ékezet nélkül is működik)
      if (low.length === 1 && /[a-z]/.test(low)) {
        buf = (buf + low).slice(-14)
        if (buf.endsWith('matrix')) {
          buf = ''
          if (claimEasterEggOnce('egg:matrix')) {
            flashHtmlClass('egg-matrix', 8000)
            fire('🕶️ Mátrix-mód!', '„Nem a csengő késik, a Mátrix hajlik meg.”', 'matrix', 1.4)
          }
        } else if (buf.endsWith('cica') || buf.endsWith('miau')) {
          buf = ''
          if (claimEasterEggOnce('egg:cats')) {
            fire('🐱 Titkos Iskolamacska!', 'Miaú! A folyosói kabalamacska áldását adta a napodra.', 'cats', 1.25)
          }
        } else if (buf.endsWith('szunet') || buf.endsWith('pihi')) {
          buf = ''
          if (claimEasterEggOnce('egg:chill')) {
            fire('🛋️ Szünet-idézés!', 'Hivatalosan is szünetre szavaztál (sajnos a csengő dönt 😅).', 'chill', 1.25)
          }
        } else if (buf.endsWith('sulibell')) {
          buf = ''
          if (claimEasterEggOnce('egg:gold')) {
            flashHtmlClass('egg-gold', 8000)
            fire('🔔 Arany Harang!', 'Megtaláltad a névadó titkos varázsszót!', 'gold', 1.6)
          }
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, sound, allowEasterEggs])

  // 5) Egyszeri titkos üzenet a DevTools konzolban
  useEffect(() => {
    if (!allowEasterEggs) return
    try {
      console.log(
        '%c🔔 SuliBell Titkos Konzol %c Gratulálok, megtaláltad a fejlesztői konzolt! Tipp: ↑↑↓↓←→←→BA vagy gépeld be az üres oldalon: matrix, cica, sulibell 😉',
        'background:linear-gradient(90deg,#ff4fc3,#2de2ff);color:#05060d;font-weight:800;padding:3px 8px;border-radius:6px',
        'color:#9ca6cc;font-weight:600'
      )
    } catch { /* ignore */ }
  }, [allowEasterEggs])

  return msg ? <div key={msg.id} className="bellbanner after party" role="status"><b>{msg.title}</b><span>{msg.sub}</span></div> : null
})
