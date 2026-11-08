import { useEffect, useState } from 'react'

export interface SandboxConfig {
  simTv: boolean
  /** Ha nem null, akkor a valós idő helyett ez a másodperc-érték (0..86399) ketyeg */
  simSecs: number | null
  /** Ha meg van adva, szünnapot/hétvégét szimulál ezzel az indokkal */
  simClosedReason: string | null
  /** Frissítés/karbantartás képernyő tesztelése */
  maintMain: boolean
  maintTv: boolean
  maintText: string
  /** Kiemelt teljes képernyős riadó/közlemény tesztelése */
  alertActive: boolean
  alertText: string
  /** Teszt változások (elmaradó órák, helyettesítés, teremváltás) */
  extraChanges: { id: string; kind: string; lesson_label: string; text: string }[]
  /** Teszt ebédmenü */
  testMenu: string
  /** Teszt közlemény */
  testAnnouncement: string
  /** Szüneti videó/zene kényszerített tesztelése */
  forceBreakMedia: boolean
  /** Szüneti média típusa a tesztlaborban ('music' = Visualizer, 'video' = Videó) */
  breakMediaKind: 'music' | 'video'
  /** Teszt időjárási kód (pl. 61 = eső, 71 = hó, 95 = vihar, null = valós időjárás) */
  simWeatherCode: number | null
}

export const DEFAULT_SANDBOX: SandboxConfig = {
  simTv: false,
  simSecs: null,
  simClosedReason: null,
  maintMain: false,
  maintTv: false,
  maintText: 'Teszt frissítés folyamatban – ezt csak te látod a teszt oldalon!',
  alertActive: false,
  alertText: 'Teszt riadó / fontos közlemény az egész képernyőn!',
  extraChanges: [],
  testMenu: '',
  testAnnouncement: '',
  forceBreakMedia: true,
  breakMediaKind: 'music',
  simWeatherCode: null,
}

const EVT = 'sulibell:sandbox-change'
let currentSandbox: SandboxConfig = { ...DEFAULT_SANDBOX }

export function getSandbox(): SandboxConfig {
  return currentSandbox
}

export function updateSandbox(patch: Partial<SandboxConfig>) {
  currentSandbox = { ...currentSandbox, ...patch }
  window.dispatchEvent(new Event(EVT))
}

export function resetSandbox() {
  currentSandbox = { ...DEFAULT_SANDBOX }
  window.dispatchEvent(new Event(EVT))
}

export function useSandbox(enabled: boolean) {
  const [cfg, setCfg] = useState<SandboxConfig>(() => getSandbox())

  useEffect(() => {
    if (!enabled) return
    const sync = () => setCfg({ ...getSandbox() })
    window.addEventListener(EVT, sync)
    return () => window.removeEventListener(EVT, sync)
  }, [enabled])

  // Ha szimulált idő van beállítva, másodpercenként léptetjük előre, hogy a visszaszámláló élőben ketyegjen
  useEffect(() => {
    if (!enabled || cfg.simSecs === null) return
    const t = setInterval(() => {
      if (currentSandbox.simSecs !== null) {
        currentSandbox = { ...currentSandbox, simSecs: (currentSandbox.simSecs + 1) % 86400 }
        setCfg({ ...currentSandbox })
      }
    }, 1000)
    return () => clearInterval(t)
  }, [enabled, cfg.simSecs !== null])

  return cfg
}
