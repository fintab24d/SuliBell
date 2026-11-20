import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import type { BellSoundStyle } from './sound'

export type VipTier = 'standard' | 'top'
export type VipThemeId = 'neon-green' | 'cyberpunk-purple' | 'blood-red' | 'oled-black' | 'gold-vip'

export interface VipStatus {
  active: boolean
  tier: VipTier | null
  unlockedAt?: number
}

export interface VipPrefs {
  theme: VipThemeId
  lastMinuteEffect: boolean
  bellSound: BellSoundStyle
}

export interface Supporter {
  id: string
  name: string
  class_name: string | null
  message: string | null
  is_top_tier: boolean
  created_at: string
}

export interface TopClassStat {
  className: string
  count: number
}

const VIP_STATUS_KEY = 'sulibell_vip_status_v1'
const VIP_PREFS_KEY = 'sulibell_vip_prefs_v1'
const VIP_EVENT = 'sulibell:vip-change'

export const VIP_THEMES: ReadonlyArray<{
  id: VipThemeId
  name: string
  desc: string
  accent: string
  bg: string
}> = [
  { id: 'neon-green', name: 'Neonzöld', desc: 'Klasszikus SuliBell', accent: '#39ff7a', bg: '#05060d' },
  { id: 'cyberpunk-purple', name: 'Cyberpunk Lila', desc: 'Neon ibolya ragyogás', accent: '#b026ff', bg: '#090414' },
  { id: 'blood-red', name: 'Vérvörös', desc: 'Intenzív karmazsin', accent: '#ff2a55', bg: '#110409' },
  { id: 'oled-black', name: 'Tiszta OLED Fekete', desc: 'Mélysötét #000000', accent: '#e5e7eb', bg: '#000000' },
  { id: 'gold-vip', name: 'Arany VIP', desc: 'Arany keret a számlálón', accent: '#ffd700', bg: '#0d0a03' },
]

export const VIP_BELL_SOUNDS: ReadonlyArray<{
  id: BellSoundStyle
  name: string
  desc: string
  icon: string
}> = [
  { id: 'default', name: 'Alap csengő', desc: 'Klasszikus iskolai dallamcsengő', icon: '🔔' },
  { id: 'retro-8bit', name: '8-bites retro', desc: 'Arcade chiptune dallam (Web Audio)', icon: '🕹️' },
  { id: 'soft-chord', name: 'Lágy akkord', desc: 'Meleg, nyugtató szintetizált akkord', icon: '🎹' },
]

const DEFAULT_STATUS: VipStatus = { active: false, tier: null }
const DEFAULT_PREFS: VipPrefs = {
  theme: 'neon-green',
  lastMinuteEffect: true,
  bellSound: 'default',
}

export function loadVipStatus(): VipStatus {
  try {
    const raw = localStorage.getItem(VIP_STATUS_KEY)
    if (!raw) return DEFAULT_STATUS
    const parsed = JSON.parse(raw)
    if (parsed && parsed.active === true) {
      const tier: VipTier = parsed.tier === 'top' ? 'top' : 'standard'
      return {
        active: true,
        tier,
        unlockedAt: typeof parsed.unlockedAt === 'number' ? parsed.unlockedAt : undefined,
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_STATUS
}

export function saveVipStatus(status: VipStatus) {
  try {
    if (!status.active) {
      localStorage.removeItem(VIP_STATUS_KEY)
    } else {
      localStorage.setItem(VIP_STATUS_KEY, JSON.stringify(status))
    }
    window.dispatchEvent(new Event(VIP_EVENT))
  } catch {
    // ignore
  }
}

export function loadVipPrefs(): VipPrefs {
  try {
    const raw = localStorage.getItem(VIP_PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw)
    const validTheme = VIP_THEMES.some(t => t.id === parsed?.theme) ? (parsed.theme as VipThemeId) : 'neon-green'
    const validSound = VIP_BELL_SOUNDS.some(s => s.id === parsed?.bellSound)
      ? (parsed.bellSound as BellSoundStyle)
      : 'default'
    return {
      theme: validTheme,
      lastMinuteEffect: parsed?.lastMinuteEffect !== false,
      bellSound: validSound,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function saveVipPrefs(prefs: VipPrefs) {
  try {
    localStorage.setItem(VIP_PREFS_KEY, JSON.stringify(prefs))
    window.dispatchEvent(new Event(VIP_EVENT))
  } catch {
    // ignore
  }
}

export function applyVipThemeToDom(status: VipStatus, prefs: VipPrefs) {
  if (typeof document === 'undefined') return
  if (status.active && prefs.theme && prefs.theme !== 'neon-green') {
    document.documentElement.dataset.vipTheme = prefs.theme
  } else {
    delete document.documentElement.dataset.vipTheme
  }
}

if (typeof window !== 'undefined') {
  applyVipThemeToDom(loadVipStatus(), loadVipPrefs())
}

export interface VerifyVipResult {
  valid: boolean
  tier?: VipTier
  usedCount?: number
  maxUses?: number
  error?: string
}

export async function verifyVipCodeRpc(inputCode: string): Promise<VerifyVipResult> {
  const clean = inputCode.trim()
  if (!clean) {
    return { valid: false, error: 'Add meg a VIP kódot!' }
  }
  if (!supabase) {
    return { valid: false, error: 'A Supabase kapcsolat jelenleg nem elérhető.' }
  }
  try {
    const { data, error } = await supabase.rpc('verify_vip_code', { input_code: clean })
    if (error) {
      return { valid: false, error: `Ellenőrzési hiba: ${error.message}` }
    }
    if (data && data.valid === true) {
      const tier: VipTier = data.tier === 'top' ? 'top' : 'standard'
      return {
        valid: true,
        tier,
        usedCount: typeof data.used_count === 'number' ? data.used_count : undefined,
        maxUses: typeof data.max_uses === 'number' ? data.max_uses : undefined,
      }
    }
    if (data?.reason === 'limit_reached') {
      return { valid: false, error: 'Ez a VIP kód már elérte a maximális felhasználási limitet.' }
    }
    return { valid: false, error: 'Érvénytelen VIP kód. Ellenőrizd az elírást!' }
  } catch {
    return { valid: false, error: 'Hálózati hiba történt a kód ellenőrzése közben.' }
  }
}

export function useVip() {
  const [status, setStatus] = useState<VipStatus>(loadVipStatus)
  const [prefs, setPrefs] = useState<VipPrefs>(loadVipPrefs)

  useEffect(() => {
    applyVipThemeToDom(status, prefs)
  }, [status, prefs])

  useEffect(() => {
    const sync = () => {
      setStatus(loadVipStatus())
      setPrefs(loadVipPrefs())
    }
    window.addEventListener(VIP_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(VIP_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const unlockWithCode = useCallback(async (code: string): Promise<VerifyVipResult> => {
    const res = await verifyVipCodeRpc(code)
    if (res.valid && res.tier) {
      const next: VipStatus = {
        active: true,
        tier: res.tier,
        unlockedAt: Date.now(),
      }
      saveVipStatus(next)
      setStatus(next)
    }
    return res
  }, [])

  const updatePrefs = useCallback((patch: Partial<VipPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch }
      saveVipPrefs(next)
      return next
    })
  }, [])

  const resetVip = useCallback(() => {
    saveVipStatus(DEFAULT_STATUS)
    setStatus(DEFAULT_STATUS)
  }, [])

  return { status, prefs, unlockWithCode, updatePrefs, resetVip }
}

function normalizeClassName(raw?: string | null): string {
  if (!raw) return ''
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

export function computeTopClass(supporters: Supporter[]): TopClassStat | null {
  const counts = new Map<string, { label: string; count: number }>()
  for (const s of supporters) {
    const norm = normalizeClassName(s.class_name)
    if (!norm) continue
    const cur = counts.get(norm)
    if (cur) {
      cur.count += 1
    } else {
      counts.set(norm, { label: s.class_name!.trim().toUpperCase(), count: 1 })
    }
  }
  let best: TopClassStat | null = null
  for (const { label, count } of counts.values()) {
    if (!best || count > best.count) {
      best = { className: label, count }
    }
  }
  return best
}

export function useSupporters() {
  const [supporters, setSupporters] = useState<Supporter[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!supabase) {
      setLoading(false)
      return
    }
    try {
      const { data, error } = await supabase
        .from('supporters')
        .select('id, name, class_name, message, is_top_tier, created_at')
        .eq('is_approved', true)
        .order('is_top_tier', { ascending: false })
        .order('created_at', { ascending: false })
      if (!error && Array.isArray(data)) {
        setSupporters(data as Supporter[])
      }
    } catch {
      // ignore offline
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    if (!supabase) return
    const ch = supabase
      .channel('sulibell-supporters')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supporters' }, () => {
        void refresh()
      })
      .subscribe()
    return () => {
      supabase?.removeChannel(ch)
    }
  }, [refresh])

  const topClass = useMemo(() => computeTopClass(supporters), [supporters])
  const withMessages = useMemo(
    () => supporters.filter(s => typeof s.message === 'string' && s.message.trim().length > 0),
    [supporters]
  )

  return { supporters, withMessages, topClass, loading, refresh }
}
