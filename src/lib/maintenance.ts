import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

export const MAINT_PREFIX = '__MAINT__:'
export const MAINT_PREP_MS = 10_000
const LOCAL_KEY = 'csengeto-maint-state'
const RELOADED_KEY = 'csengeto-reloaded-at'
const PAGE_LOADED_AT = Date.now()

export interface MaintState {
  main: boolean
  tv: boolean
  text: string
  mainStartsAt?: number
  tvStartsAt?: number
  reloadAt?: number
}

export const DEFAULT_MAINT: MaintState = {
  main: false,
  tv: false,
  text: 'Az oldal jelenleg frissül, kérjük várj néhány pillanatot…',
}

export function isMaintAnnouncement(text?: string | null): boolean {
  return typeof text === 'string' && text.startsWith(MAINT_PREFIX)
}

function normalize(p: any): MaintState {
  const r = Number(p?.reloadAt)
  const ms = Number(p?.mainStartsAt)
  const ts = Number(p?.tvStartsAt)
  return {
    main: !!p?.main,
    tv: !!p?.tv,
    text: typeof p?.text === 'string' && p.text.trim() ? p.text.trim() : DEFAULT_MAINT.text,
    mainStartsAt: p?.main && Number.isFinite(ms) && ms > 0 ? ms : undefined,
    tvStartsAt: p?.tv && Number.isFinite(ts) && ts > 0 ? ts : undefined,
    reloadAt: Number.isFinite(r) && r > 0 ? r : undefined,
  }
}

export function parseMaintFromAnnouncements(
  announcements?: { id?: string; text: string; active_until?: string | null }[] | null
): MaintState | null {
  if (!Array.isArray(announcements)) return null
  const row = announcements.find(a => isMaintAnnouncement(a?.text))
  if (!row) return null
  try {
    return normalize(JSON.parse(row.text.slice(MAINT_PREFIX.length)))
  } catch {
    return null
  }
}

function loadLocalMaint(): MaintState | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    return raw ? normalize(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function saveLocalMaint(st: MaintState) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(st))
  } catch { /* ignore */ }
}

function maybeReload(reloadAt?: number) {
  if (location.pathname.startsWith('/admin') || location.pathname.startsWith('/teszt')) return
  if (!reloadAt || reloadAt <= PAGE_LOADED_AT) return
  try {
    if (localStorage.getItem(RELOADED_KEY) === String(reloadAt)) return
    localStorage.setItem(RELOADED_KEY, String(reloadAt))
  } catch { /* ignore */ }
  setTimeout(() => location.reload(), 120)
}

/**
 * Élőben figyeli és szinkronizálja a "Frissítés folyamatban" (karbantartási) állapotot
 * külön a főoldalra (main) és külön a /display (tv) kijelzőre.
 */
export function useMaintenance(
  schoolId: string | undefined,
  initialAnnouncements?: { id?: string; text: string; active_until?: string | null }[] | null
) {
  const [maint, setMaint] = useState<MaintState>(() => {
    return parseMaintFromAnnouncements(initialAnnouncements) ?? loadLocalMaint() ?? DEFAULT_MAINT
  })
  const chanRef = useRef<any>(null)
  const bcRef = useRef<BroadcastChannel | null>(null)
  const initAnnRef = useRef(initialAnnouncements)

  const apply = useCallback((next: MaintState) => {
    setMaint(next)
    saveLocalMaint(next)
    try {
      if (!next.main) localStorage.removeItem('csengeto-maint-dl-main')
      if (!next.tv) localStorage.removeItem('csengeto-maint-dl-tv')
    } catch { /* ignore */ }
    maybeReload(next.reloadAt)
  }, [])

  useEffect(() => {
    if (!Array.isArray(initialAnnouncements)) return
    const parsed = parseMaintFromAnnouncements(initialAnnouncements)
    // Első rendereléskor a gyorsítótárból betöltött üres lista ne írja felül a helyi aktív karbantartást;
    // amint friss hálózati adat érkezik (vagy van aktív karbantartás a listában), azonnal alkalmazzuk.
    if (initialAnnouncements === initAnnRef.current && !parsed) return
    initAnnRef.current = initialAnnouncements
    apply(parsed ?? DEFAULT_MAINT)
  }, [initialAnnouncements, apply])

  useEffect(() => {
    if (!schoolId) return
    let alive = true

    const fetchLatest = async (force = false) => {
      if (!force && document.hidden) return
      const { data, error } = await supabase
        .from('announcements')
        .select('id, text')
        .eq('school_id', schoolId)
        .like('text', `${MAINT_PREFIX}%`)
      if (!alive || error) return
      apply(parseMaintFromAnnouncements(data as any) ?? DEFAULT_MAINT)
    }

    fetchLatest(true)
    const timer = setInterval(() => fetchLatest(false), 4_000)

    const ch = supabase.channel(`sulibell-maint-${schoolId}`, {
      config: { broadcast: { self: false } },
    })
    ch.on('broadcast', { event: 'maint' }, (msg: any) => {
      if (!alive || !msg?.payload) return
      apply(normalize(msg.payload))
    }).on('postgres_changes', { event: '*', schema: 'public', table: 'announcements', filter: `school_id=eq.${schoolId}` }, () => {
      fetchLatest(true)
    }).subscribe()
    chanRef.current = ch

    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel(`sulibell-maint-${schoolId}`)
      bc.onmessage = ev => {
        if (!alive || !ev.data) return
        apply(normalize(ev.data))
      }
      bcRef.current = bc
    } catch { /* ignore */ }

    const onWake = () => { if (!document.hidden) fetchLatest(true) }
    const onRefresh = () => { fetchLatest(true) }
    window.addEventListener('sulibell:refresh', onRefresh)
    document.addEventListener('visibilitychange', onWake)
    document.addEventListener('resume', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('pageshow', onWake)

    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('sulibell:refresh', onRefresh)
      document.removeEventListener('visibilitychange', onWake)
      document.removeEventListener('resume', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('pageshow', onWake)
      supabase.removeChannel(ch)
      chanRef.current = null
      try { bc?.close() } catch { /* ignore */ }
      bcRef.current = null
    }
  }, [schoolId, apply])

  const updateMaint = useCallback(async (patch: Partial<MaintState> & { forceReload?: boolean; immediate?: boolean }) => {
    const now = Date.now()
    const main = patch.main !== undefined ? patch.main : maint.main
    const tv = patch.tv !== undefined ? patch.tv : maint.tv
    const finished = (maint.main && !main) || (maint.tv && !tv)
    const mainStartsAt = !main
      ? undefined
      : patch.mainStartsAt !== undefined
        ? patch.mainStartsAt
        : !maint.main
          ? (patch.immediate ? now : now + MAINT_PREP_MS)
          : maint.mainStartsAt
    const tvStartsAt = !tv
      ? undefined
      : patch.tvStartsAt !== undefined
        ? patch.tvStartsAt
        : !maint.tv
          ? (patch.immediate ? now : now + MAINT_PREP_MS)
          : maint.tvStartsAt

    const next: MaintState = {
      main,
      tv,
      text: (patch.text !== undefined ? patch.text : maint.text).trim() || DEFAULT_MAINT.text,
      mainStartsAt,
      tvStartsAt,
      reloadAt: finished || patch.forceReload ? now : maint.reloadAt,
    }
    apply(next)

    chanRef.current?.send({
      type: 'broadcast',
      event: 'maint',
      payload: next,
    }).catch?.(() => {})
    try { bcRef.current?.postMessage(next) } catch { /* ignore */ }

    if (!schoolId) return { error: null }

    await supabase
      .from('announcements')
      .delete()
      .eq('school_id', schoolId)
      .like('text', `${MAINT_PREFIX}%`)

    if (next.main || next.tv || next.reloadAt) {
      const { error } = await supabase
        .from('announcements')
        .insert({ school_id: schoolId, text: MAINT_PREFIX + JSON.stringify(next), active_until: null })
      return { error }
    }
    return { error: null }
  }, [schoolId, maint, apply])

  return { maint, updateMaint }
}
