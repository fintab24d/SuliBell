import { supabase } from './supabase'

export const KOFI_PREFIX = '__KOFI__:'
const LOCAL_KEY = 'csengeto-kofi-v1'
export const DEFAULT_KOFI_URL = 'https://ko-fi.com'

export interface KofiDonor {
  id: string
  name: string
  amount: number
  currency: string
  message?: string
  discord?: string
  vipGranted?: boolean
  count?: number
  at: number
}

export interface KofiConfig {
  url: string
  enabled: boolean
  subtitle?: string
  donors: KofiDonor[]
}

const DEFAULT_CONFIG: KofiConfig = {
  url: DEFAULT_KOFI_URL,
  enabled: true,
  subtitle: 'Támogasd a SuliBell fejlesztését Ko-fi-n! Írd be a Discord neved az üzenetbe az automatikus 💎 VIP rangért!',
  donors: [],
}

export function isKofiAnnouncement(text?: string | null): boolean {
  return typeof text === 'string' && text.startsWith(KOFI_PREFIX)
}

function normalizeUrl(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_KOFI_URL
  const s = raw.trim()
  if (!s) return DEFAULT_KOFI_URL
  if (/^https?:\/\//i.test(s)) return s
  if (s.includes('ko-fi.com')) return `https://${s}`
  return `https://ko-fi.com/${s.replace(/^@+/, '')}`
}

function currencyWeight(curr: string): number {
  const c = (curr || 'HUF').toUpperCase()
  if (c === 'EUR' || c === '€') return 400
  if (c === 'USD' || c === '$') return 380
  if (c === 'GBP' || c === '£') return 470
  return 1
}

export function formatDonationAmount(amount: number, currency: string): string {
  const c = (currency || 'HUF').toUpperCase()
  const num = Number.isFinite(amount) ? amount : 0
  if (c === 'HUF' || c === 'FT') {
    return `${Math.round(num).toLocaleString('hu-HU')} Ft`
  }
  if (c === 'EUR' || c === '€') {
    return `${num % 1 === 0 ? num : num.toFixed(2)} €`
  }
  if (c === 'USD' || c === '$') {
    return `$${num % 1 === 0 ? num : num.toFixed(2)}`
  }
  return `${num} ${c}`
}

function normalizeDonors(raw: unknown): KofiDonor[] {
  if (!Array.isArray(raw)) return []
  const out: KofiDonor[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const name = typeof it.name === 'string' ? it.name.trim().slice(0, 48) : ''
    if (!name) continue
    const amount = Math.max(0, Number(it.amount) || 0)
    const currency = typeof it.currency === 'string' && it.currency.trim() ? it.currency.trim().toUpperCase().slice(0, 6) : 'HUF'
    out.push({
      id: typeof it.id === 'string' && it.id ? it.id : `kf-${Math.random().toString(36).slice(2, 9)}`,
      name,
      amount,
      currency,
      message: typeof it.message === 'string' && it.message.trim() ? it.message.trim().slice(0, 120) : undefined,
      discord: typeof it.discord === 'string' && it.discord.trim() ? it.discord.trim().slice(0, 40) : undefined,
      vipGranted: Boolean(it.vipGranted),
      count: Math.max(1, Number(it.count) || 1),
      at: Number(it.at) || Date.now(),
    })
  }
  return out.sort((a, b) => {
    const wa = a.amount * currencyWeight(a.currency)
    const wb = b.amount * currencyWeight(b.currency)
    if (wb !== wa) return wb - wa
    return b.at - a.at
  })
}

export function normalizeKofiConfig(raw: unknown): KofiConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG }
  const obj = raw as Record<string, unknown>
  return {
    url: normalizeUrl(obj.url),
    enabled: obj.enabled !== false,
    subtitle: typeof obj.subtitle === 'string' && obj.subtitle.trim()
      ? obj.subtitle.trim().slice(0, 160)
      : DEFAULT_CONFIG.subtitle,
    donors: normalizeDonors(obj.donors),
  }
}

export function parseKofiFromAnnouncements(
  announcements?: { id?: string; text: string; active_until?: string | null }[] | null
): KofiConfig {
  if (Array.isArray(announcements)) {
    const row = announcements.find(a => isKofiAnnouncement(a?.text))
    if (row) {
      try {
        const cfg = normalizeKofiConfig(JSON.parse(row.text.slice(KOFI_PREFIX.length)))
        try { localStorage.setItem(LOCAL_KEY, JSON.stringify(cfg)) } catch { /* ignore */ }
        return cfg
      } catch {
        return { ...DEFAULT_CONFIG }
      }
    }
    return { ...DEFAULT_CONFIG }
  }
  try {
    const cached = localStorage.getItem(LOCAL_KEY)
    return cached ? normalizeKofiConfig(JSON.parse(cached)) : { ...DEFAULT_CONFIG }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export async function saveKofiToDb(schoolId: string, cfg: KofiConfig) {
  const clean = normalizeKofiConfig(cfg)
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(clean)) } catch { /* ignore */ }
  const payload = KOFI_PREFIX + JSON.stringify(clean)

  const { data: existing } = await supabase
    .from('announcements')
    .select('id')
    .eq('school_id', schoolId)
    .like('text', `${KOFI_PREFIX}%`)

  if (existing && existing.length > 0) {
    const firstId = existing[0].id
    if (existing.length > 1) {
      await supabase
        .from('announcements')
        .delete()
        .in('id', existing.slice(1).map((r: { id: string }) => r.id))
    }
    return supabase.from('announcements').update({ text: payload, active_until: null }).eq('id', firstId)
  }
  return supabase.from('announcements').insert({ school_id: schoolId, text: payload, active_until: null })
}

export async function grantDiscordVipRole(discordUser: string, donorName?: string, amountStr?: string): Promise<{ ok: boolean; memberName?: string; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('discord-bridge', {
      body: {
        action: 'grant_vip',
        discordUser: discordUser.trim(),
        donorName,
        amountStr,
      },
    })
    if (error) return { ok: false, error: error.message }
    return data || { ok: false, error: 'Ismeretlen válasz' }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Hálózati hiba' }
  }
}
