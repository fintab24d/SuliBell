import { useEffect, useRef, useState } from 'react'

type PeekSide = 'top' | 'right' | 'left'

interface RectBox {
  el: HTMLElement
  left: number
  top: number
  right: number
  bottom: number
}

interface PeekCandidate {
  el: HTMLElement
  side: PeekSide
  offsetRatio: number
  ratio: number
}

interface ActivePeek {
  key: number
  el: HTMLElement
  side: PeekSide
  offsetRatio: number
  left: number
  top: number
  width: number
  height: number
}

const SLOT_DIMS: Record<PeekSide, { w: number; h: number }> = {
  top: { w: 84, h: 68 },
  right: { w: 68, h: 84 },
  left: { w: 68, h: 84 },
}

const PEEK_DURATION_MS = 5400

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function computeSlotCoords(
  r: DOMRect,
  side: PeekSide,
  offsetRatio: number
): { left: number; top: number; width: number; height: number } {
  const { w, h } = SLOT_DIMS[side]
  if (side === 'top') {
    const minX = r.left + 16
    const maxX = Math.max(minX, r.right - w - 16)
    const left = clamp(r.left + offsetRatio * r.width - w / 2, minX, maxX)
    return { left: Math.round(left), top: Math.round(r.top - h + 2), width: w, height: h }
  }
  const minY = r.top + 12
  const maxY = Math.max(minY, r.bottom - h - 12)
  const top = clamp(r.top + offsetRatio * r.height - h / 2, minY, maxY)
  if (side === 'right') {
    return { left: Math.round(r.right - 2), top: Math.round(top), width: w, height: h }
  }
  return { left: Math.round(r.left - w + 2), top: Math.round(top), width: w, height: h }
}

/** Kiszámolja 4×4 mintaponttal, mekkora hányada látszik szabadon a jelölt kukucskáló sávnak. */
function getUnobstructedRatio(
  slot: { left: number; top: number; width: number; height: number },
  owner: HTMLElement,
  obstacles: RectBox[],
  vw: number,
  vh: number
): number {
  const cols = 4
  const rows = 4
  let free = 0
  const total = cols * rows
  for (let iy = 0; iy < rows; iy++) {
    const py = slot.top + ((iy + 0.5) / rows) * slot.height
    for (let ix = 0; ix < cols; ix++) {
      const px = slot.left + ((ix + 0.5) / cols) * slot.width
      if (px < 6 || px > vw - 6 || py < 6 || py > vh - 6) continue
      let blocked = false
      for (const obs of obstacles) {
        if (obs.el === owner || obs.el.contains(owner) || owner.contains(obs.el)) continue
        if (px >= obs.left && px <= obs.right && py >= obs.top && py <= obs.bottom) {
          blocked = true
          break
        }
      }
      if (!blocked) free++
    }
  }
  return free / total
}

function collectPeekCandidates(): { targets: HTMLElement[]; obstacles: RectBox[] } {
  const targetEls = Array.from(
    document.querySelectorAll<HTMLElement>('main .panel, main .bento-hdr, main .tv-hdr')
  ).filter(el => {
    if (el.closest('.mymodal-bg')) return false
    if (el.matches('.tv .panel')) return false
    const r = el.getBoundingClientRect()
    if (r.width < 160 || r.height < 64) return false
    return (
      r.bottom >= 20 &&
      r.top <= window.innerHeight - 20 &&
      r.right >= 20 &&
      r.left <= window.innerWidth - 20
    )
  })

  const obstacles: RectBox[] = []
  document
    .querySelectorAll<HTMLElement>('.panel, .bento-hdr, .tv-hdr, .app-nav, .mini-bell-bar, .winter-strip')
    .forEach(el => {
      if (el.matches('.tv .panel')) return
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return
      obstacles.push({ el, left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    })

  return { targets: targetEls, obstacles }
}

function pickPeekSlot(lastEl: HTMLElement | null): PeekCandidate | null {
  const { targets, obstacles } = collectPeekCandidates()
  if (!targets.length) return null
  const vw = window.innerWidth
  const vh = window.innerHeight
  const offsets = [0.26, 0.5, 0.74]
  const all: PeekCandidate[] = []

  for (const el of targets) {
    const r = el.getBoundingClientRect()
    if (r.width >= SLOT_DIMS.top.w + 32) {
      for (const off of offsets) {
        const coords = computeSlotCoords(r, 'top', off)
        all.push({
          el,
          side: 'top',
          offsetRatio: off,
          ratio: getUnobstructedRatio(coords, el, obstacles, vw, vh),
        })
      }
    }
    if (r.height >= SLOT_DIMS.right.h + 24) {
      for (const off of offsets) {
        const rightCoords = computeSlotCoords(r, 'right', off)
        all.push({
          el,
          side: 'right',
          offsetRatio: off,
          ratio: getUnobstructedRatio(rightCoords, el, obstacles, vw, vh),
        })
        const leftCoords = computeSlotCoords(r, 'left', off)
        all.push({
          el,
          side: 'left',
          offsetRatio: off,
          ratio: getUnobstructedRatio(leftCoords, el, obstacles, vw, vh),
        })
      }
    }
  }

  const pickFrom = (list: PeekCandidate[]) => {
    const diff = list.filter(c => c.el !== lastEl)
    const pool = diff.length ? diff : list
    return pool[Math.floor(Math.random() * pool.length)]
  }

  const clean = all.filter(c => c.ratio >= 0.85)
  if (clean.length) return pickFrom(clean)
  const fallback = all.filter(c => c.ratio >= 0.55)
  if (fallback.length) return pickFrom(fallback)
  return null
}

/** Aranyos, kártyaszélről kukucskáló Mikulás SVG pislogó szemekkel és két kesztyűs kézzel. */
function PeekingSantaSvg({ side }: { side: PeekSide }) {
  const cls =
    side === 'right'
      ? 'xmas-peek-svg rot-right'
      : side === 'left'
        ? 'xmas-peek-svg rot-left'
        : 'xmas-peek-svg'
  return (
    <svg className={cls} viewBox="0 0 88 72" width="84" height="68" aria-hidden="true">
      {/* Sapka piros része és fehér bojtja */}
      <path
        d="M21 31 C22 10, 42 4, 59 12 C67 15.5, 72 20, 71 25 C65 21.5, 61 23, 62 31 Z"
        fill="#d90429"
        stroke="#ff4d6d"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="72" cy="24" r="6" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
      {/* Arc alap */}
      <ellipse cx="44" cy="43" rx="19" ry="15" fill="#ffd7ba" stroke="#f4b897" strokeWidth="0.9" />
      {/* Szemöldökök */}
      <path d="M33 36.5 Q37 34.2 40.5 36.2" fill="none" stroke="#ffffff" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M47.5 36.2 Q51 34.2 55 36.5" fill="none" stroke="#ffffff" strokeWidth="2.3" strokeLinecap="round" />
      {/* Pislogó szemek csillanással */}
      <g className="santa-eye">
        <circle cx="37" cy="40.5" r="2.7" fill="#1e293b" />
        <circle cx="37.9" cy="39.5" r="0.95" fill="#ffffff" />
      </g>
      <g className="santa-eye">
        <circle cx="51" cy="40.5" r="2.7" fill="#1e293b" />
        <circle cx="51.9" cy="39.5" r="0.95" fill="#ffffff" />
      </g>
      {/* Rózsás pofi és piros orr */}
      <ellipse cx="30" cy="46.5" rx="4.2" ry="2.6" fill="rgba(244, 63, 94, 0.35)" />
      <ellipse cx="58" cy="46.5" rx="4.2" ry="2.6" fill="rgba(244, 63, 94, 0.35)" />
      <circle cx="44" cy="44.8" r="3.6" fill="#e63946" />
      <circle cx="45" cy="43.7" r="1.1" fill="rgba(255, 255, 255, 0.65)" />
      {/* Dús fehér szakáll és bajusz */}
      <path
        d="M23 47 C24 62, 33 69, 44 69 C55 69, 64 62, 65 47 C60 51, 53 49, 44 48 C35 49, 28 51, 23 47 Z"
        fill="#f8fafc"
        stroke="#e2e8f0"
        strokeWidth="1"
      />
      <path
        d="M44 46.5 C38 45.5, 32 49, 29 52.5 C33.5 53.5, 39.5 52, 44 49.5 C48.5 52, 54.5 53.5, 59 52.5 C56 49, 50 45.5, 44 46.5 Z"
        fill="#ffffff"
        stroke="#e2e8f0"
        strokeWidth="0.9"
      />
      {/* Sapka fehér szőrmepereme */}
      <rect x="20" y="27" width="46" height="8.5" rx="4.25" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1" />
      {/* Két pici kesztyűs kéz a kártya peremén */}
      <g>
        <rect x="13" y="61" width="12.5" height="8" rx="4" fill="#d90429" stroke="#ff4d6d" strokeWidth="1" />
        <rect x="62.5" y="61" width="12.5" height="8" rx="4" fill="#d90429" stroke="#ff4d6d" strokeWidth="1" />
        <rect x="14.5" y="59.5" width="9.5" height="3.2" rx="1.6" fill="#f8fafc" />
        <rect x="64" y="59.5" width="9.5" height="3.2" rx="1.6" fill="#f8fafc" />
      </g>
    </svg>
  )
}

/** Háttérben (kártyák mögött) időnként kíváncsian kikandikáló Mikulás — Dec. 5. után és csak karácsonyi skinben aktív. */
export function PeekingSantaBg({ enabled, fastPreview }: { enabled: boolean; fastPreview?: boolean }) {
  const [active, setActive] = useState<ActivePeek | null>(null)
  const lastElRef = useRef<HTMLElement | null>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    if (!enabled || prefersReducedMotion()) {
      setActive(null)
      return
    }
    let alive = true
    let mainTimer = 0
    let hideTimer = 0

    const nextDelay = (first: boolean) =>
      fastPreview
        ? first
          ? 1800
          : 8500 + Math.random() * 4000
        : first
          ? 8000 + Math.random() * 6000
          : 24000 + Math.random() * 18000

    const schedule = (first: boolean) => {
      window.clearTimeout(mainTimer)
      mainTimer = window.setTimeout(run, nextDelay(first))
    }

    const run = () => {
      if (!alive) return
      if (document.hidden) {
        schedule(false)
        return
      }
      const cand = pickPeekSlot(lastElRef.current)
      if (!cand) {
        schedule(false)
        return
      }
      lastElRef.current = cand.el
      const coords = computeSlotCoords(cand.el.getBoundingClientRect(), cand.side, cand.offsetRatio)
      seqRef.current += 1
      setActive({
        key: seqRef.current,
        el: cand.el,
        side: cand.side,
        offsetRatio: cand.offsetRatio,
        ...coords,
      })
      window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => {
        if (!alive) return
        setActive(null)
        schedule(false)
      }, PEEK_DURATION_MS)
    }

    schedule(true)
    return () => {
      alive = false
      window.clearTimeout(mainTimer)
      window.clearTimeout(hideTimer)
    }
  }, [enabled, fastPreview])

  // Ha az oldal görgetődik vagy átméreteződik, a kukucskáló Mikulás követi a kártyaszélt
  useEffect(() => {
    if (!active) return
    const reposition = () => {
      setActive(cur => {
        if (!cur || !cur.el.isConnected) return null
        const r = cur.el.getBoundingClientRect()
        if (r.width < 120 || r.height < 48) return null
        const next = computeSlotCoords(r, cur.side, cur.offsetRatio)
        if (
          next.left === cur.left &&
          next.top === cur.top &&
          next.width === cur.width &&
          next.height === cur.height
        ) {
          return cur
        }
        return { ...cur, ...next }
      })
    }
    window.addEventListener('scroll', reposition, { passive: true, capture: true })
    window.addEventListener('resize', reposition, { passive: true })
    return () => {
      window.removeEventListener('scroll', reposition, { capture: true })
      window.removeEventListener('resize', reposition)
    }
  }, [active?.key])

  if (!enabled || prefersReducedMotion()) return null

  return (
    <div className="xmas-peek-layer" aria-hidden="true">
      {active && (
        <div
          key={active.key}
          className={`xmas-peek-slot side-${active.side}`}
          style={{
            left: `${active.left}px`,
            top: `${active.top}px`,
            width: `${active.width}px`,
            height: `${active.height}px`,
          }}
        >
          <div className={`xmas-peek-actor side-${active.side}`}>
            <PeekingSantaSvg side={active.side} />
          </div>
        </div>
      )}
    </div>
  )
}

/** Részletes rénszarvasos Mikulás-szán arany csillagpor-nyommal és Rudolf fénylő orrával. */
function SantaSleighSvg() {
  return (
    <svg className="xmas-sleigh-svg" viewBox="0 0 300 76" width="248" height="63" aria-hidden="true">
      <defs>
        <linearGradient id="sleighTrailGrad" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#ffd166" stopOpacity="0" />
          <stop offset="100%" stopColor="#ffd166" stopOpacity="0.65" />
        </linearGradient>
      </defs>

      {/* Csillogó arany csillagpor-nyom a szán mögött */}
      <path d="M4 44 Q42 36, 74 44" fill="none" stroke="url(#sleighTrailGrad)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M14 52 Q48 47, 74 52" fill="none" stroke="url(#sleighTrailGrad)" strokeWidth="1.6" strokeLinecap="round" />
      <g className="sleigh-sparkle" fill="#ffe599">
        <circle cx="16" cy="39" r="1.5" />
        <circle cx="30" cy="49" r="1.9" />
        <circle cx="44" cy="35" r="1.7" />
        <circle cx="56" cy="46" r="2.2" />
        <circle cx="65" cy="38" r="1.4" />
      </g>

      {/* Arany szántalp */}
      <path
        d="M52 57 Q82 61, 114 56 Q124 54, 128 48"
        fill="none"
        stroke="#ffd166"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
      <line x1="72" y1="51" x2="70" y2="58" stroke="#ffd166" strokeWidth="2" />
      <line x1="100" y1="50" x2="102" y2="57" stroke="#ffd166" strokeWidth="2" />

      {/* Zöld-arany ajándékzsák a szán hátulján */}
      <path
        d="M61 36 C56 26, 65 20, 75 23 C81 25, 83 34, 78 40 Z"
        fill="#198754"
        stroke="#ffd166"
        strokeWidth="1.1"
      />

      {/* Piros szán-test arany szegéllyel */}
      <path
        d="M60 39 Q82 40, 102 35 C110 33, 118 39, 117 48 C116 52, 104 53, 88 53 L64 53 C58 53, 55 46, 60 39 Z"
        fill="#d90429"
        stroke="#ffd166"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />

      {/* Mikulás a szánban, integető kézzel */}
      <g>
        <path d="M84 37 C83 27, 94 25, 97 36 Z" fill="#d90429" />
        <path d="M95 30 L103 22" stroke="#d90429" strokeWidth="3.2" strokeLinecap="round" />
        <circle cx="104" cy="21" r="2.1" fill="#ffffff" />
        <circle cx="90" cy="22" r="4.6" fill="#ffd7ba" />
        <path d="M85.5 24 Q90 30, 94.5 24 Z" fill="#f8fafc" />
        <path d="M85 19.5 C86 12, 92 11, 96 15 C93 15.5, 92 17, 93 19.5 Z" fill="#d90429" />
        <circle cx="96.5" cy="15" r="1.9" fill="#ffffff" />
        <rect x="85" y="18.2" width="10" height="2.6" rx="1.3" fill="#ffffff" />
      </g>

      {/* Arany gyeplők */}
      <path d="M112 39 Q142 46, 178 39" fill="none" stroke="rgba(255, 209, 102, 0.78)" strokeWidth="1.2" />
      <path d="M113 41 Q165 49, 232 37" fill="none" stroke="rgba(255, 209, 102, 0.78)" strokeWidth="1.2" />

      {/* 1. Hátsó rénszarvas */}
      <g transform="translate(152, 18)">
        <ellipse cx="22" cy="24" rx="13" ry="6.2" fill="#8b5a2b" />
        <path d="M30 22 L36 12 L42 13 L44 16 L36 19 L34 25 Z" fill="#8b5a2b" />
        {/* Agancs */}
        <path d="M36 12 L34 4 M35 8 L31 6 M36 7 L39 5" fill="none" stroke="#d9b382" strokeWidth="1.4" strokeLinecap="round" />
        {/* Vágtázó lábak */}
        <path d="M12 27 L5 36 M17 28 L14 38 M29 27 L37 36 M33 26 L42 32" stroke="#704520" strokeWidth="2.2" strokeLinecap="round" />
        <rect x="29.5" y="18.5" width="6.5" height="2.6" rx="1" transform="rotate(-35 30 19)" fill="#d90429" />
      </g>

      {/* 2. Első rénszarvas (Rudolf fénylő piros orral) */}
      <g transform="translate(212, 14)">
        <ellipse cx="22" cy="24" rx="13.5" ry="6.5" fill="#9c6633" />
        <path d="M30 22 L37 11 L44 12.5 L46 16 L37 19 L34 25 Z" fill="#9c6633" />
        {/* Agancs */}
        <path d="M37 11 L35 3 M36 7 L31 5 M37 6 L41 4" fill="none" stroke="#e6c69c" strokeWidth="1.45" strokeLinecap="round" />
        {/* Vágtázó lábak */}
        <path d="M12 27 L4 35 M17 28 L13 38 M29 27 L38 35 M34 25 L43 30" stroke="#7a4c23" strokeWidth="2.3" strokeLinecap="round" />
        <rect x="30" y="18" width="7" height="2.7" rx="1" transform="rotate(-35 30 19)" fill="#d90429" />
        {/* Rudolf piros fénylő orra */}
        <g className="rudolph-nose">
          <circle cx="46.5" cy="14.5" r="5" fill="rgba(255, 45, 75, 0.42)" />
          <circle cx="46.5" cy="14.5" r="2.4" fill="#ff2a4b" />
        </g>
      </g>
    </svg>
  )
}

/** Időnként elrepülő Mikulás-szán az oldal tetején — Dec. 5. után és csak karácsonyi skinben aktív. */
export function FlyingSleighTop({ enabled, fastPreview }: { enabled: boolean; fastPreview?: boolean }) {
  const [flight, setFlight] = useState<{
    key: number
    dir: 'ltr' | 'rtl'
    topPx: number
    durMs: number
  } | null>(null)
  const dirRef = useRef<'ltr' | 'rtl'>('ltr')
  const seqRef = useRef(0)

  useEffect(() => {
    if (!enabled || prefersReducedMotion()) {
      setFlight(null)
      return
    }
    let alive = true
    let waitTimer = 0
    let endTimer = 0

    const nextDelay = (first: boolean) =>
      fastPreview
        ? first
          ? 3200
          : 17000 + Math.random() * 6000
        : first
          ? 16000 + Math.random() * 8000
          : 45000 + Math.random() * 30000

    const schedule = (first: boolean) => {
      window.clearTimeout(waitTimer)
      waitTimer = window.setTimeout(launch, nextDelay(first))
    }

    const launch = () => {
      if (!alive) return
      if (document.hidden) {
        schedule(false)
        return
      }
      const dir = dirRef.current
      dirRef.current = dir === 'ltr' ? 'rtl' : 'ltr'
      const durMs = window.innerWidth < 640 ? 9500 : 12500
      const topPx = 4 + Math.round(Math.random() * 12)
      seqRef.current += 1
      setFlight({ key: seqRef.current, dir, topPx, durMs })

      window.clearTimeout(endTimer)
      endTimer = window.setTimeout(() => {
        if (!alive) return
        setFlight(null)
        schedule(false)
      }, durMs + 250)
    }

    schedule(true)
    return () => {
      alive = false
      window.clearTimeout(waitTimer)
      window.clearTimeout(endTimer)
    }
  }, [enabled, fastPreview])

  if (!enabled || prefersReducedMotion()) return null

  return (
    <div className="xmas-sleigh-layer" aria-hidden="true">
      {flight && (
        <div
          key={flight.key}
          className={`xmas-sleigh-runner ${flight.dir}`}
          style={{
            top: `${flight.topPx}px`,
            animationDuration: `${flight.durMs}ms`,
          }}
        >
          <div className="xmas-sleigh-bob">
            <div className={`xmas-sleigh-flip ${flight.dir}`}>
              <SantaSleighSvg />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
