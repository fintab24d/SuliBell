import { supabase } from './supabase'

export const PARTNERS_PREFIX = '__PARTNERS__:'
const LOCAL_KEY = 'csengeto-partners-v1'

export interface PartnerSite {
  id: string
  name: string
  url: string
  desc?: string
  icon?: string
}

export function isPartnersAnnouncement(text?: string | null): boolean {
  return typeof text === 'string' && text.startsWith(PARTNERS_PREFIX)
}

function normalizeUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  return `https://${s}`
}

function normalizeList(raw: unknown): PartnerSite[] {
  if (!Array.isArray(raw)) return []
  const out: PartnerSite[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const name = typeof it.name === 'string' ? it.name.trim().slice(0, 60) : ''
    const url = typeof it.url === 'string' ? normalizeUrl(it.url) : ''
    if (!name || !url) continue
    out.push({
      id: typeof it.id === 'string' && it.id ? it.id : `p-${Math.random().toString(36).slice(2, 9)}`,
      name,
      url,
      desc: typeof it.desc === 'string' && it.desc.trim() ? it.desc.trim().slice(0, 80) : undefined,
      icon: typeof it.icon === 'string' && it.icon.trim() ? it.icon.trim().slice(0, 8) : '🌐',
    })
  }
  return out
}

export function parsePartnersFromAnnouncements(
  announcements?: { id?: string; text: string; active_until?: string | null }[] | null
): PartnerSite[] {
  if (Array.isArray(announcements)) {
    const row = announcements.find(a => isPartnersAnnouncement(a?.text))
    if (row) {
      try {
        const list = normalizeList(JSON.parse(row.text.slice(PARTNERS_PREFIX.length)))
        try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)) } catch { /* ignore */ }
        return list
      } catch {
        return []
      }
    }
    return []
  }
  try {
    return normalizeList(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]'))
  } catch {
    return []
  }
}

export async function savePartnersToDb(schoolId: string, list: PartnerSite[]) {
  const clean = normalizeList(list)
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(clean)) } catch { /* ignore */ }
  const payload = PARTNERS_PREFIX + JSON.stringify(clean)

  const { data: existing } = await supabase
    .from('announcements')
    .select('id')
    .eq('school_id', schoolId)
    .like('text', `${PARTNERS_PREFIX}%`)

  if (existing && existing.length > 0) {
    const firstId = existing[0].id
    if (existing.length > 1) {
      await supabase
        .from('announcements')
        .delete()
        .in('id', existing.slice(1).map((r: any) => r.id))
    }
    if (clean.length === 0) {
      return supabase.from('announcements').delete().eq('id', firstId)
    }
    return supabase.from('announcements').update({ text: payload, active_until: null }).eq('id', firstId)
  } else if (clean.length > 0) {
    return supabase.from('announcements').insert({ school_id: schoolId, text: payload, active_until: null })
  }
  return { error: null }
}
