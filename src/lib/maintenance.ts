import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

export const MAINT_PREFIX = '__MAINT__:'
const LOCAL_KEY = 'csengeto-maint-state'

export interface MaintState {
  main: boolean
  tv: boolean
  text: string
}

export const DEFAULT_MAINT: MaintState = {
  main: false,
  tv: false,
  text: 'Az oldal jelenleg frissül, kérjük várj néhány pillanatot…',
}

export function isMaintAnnouncement(text?: string | null): boolean {
  return typeof text === 'string' && text.startsWith(MAINT_PREFIX)
}

export function parseMaintFromAnnouncements(
  announcements?: { id?: string; text: string; active_until?: string | null }[] | null
): MaintState | null {
  if (!Array.isArray(announcements)) return null
  const row = announcements.find(a => isMaintAnnouncement(a?.text))
  if (!row) return null
  try {
    const parsed = JSON.parse(row.text.slice(MAINT_PREFIX.length))
    return {
      main: !!parsed.main,
      tv: !!parsed.tv,
      text: typeof parsed.text === 'string' && parsed.text.trim()
        ? parsed.text.trim()
        : DEFAULT_MAINT.text,
    }
  } catch {
    return null
  }
}

function loadLocalMaint(): MaintState | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    return {
      main: !!p.main,
      tv: !!p.tv,
      text: typeof p.text === 'string' && p.text.trim() ? p.text.trim() : DEFAULT_MAINT.text,
    }
  } catch {
    return null
  }
}

function saveLocalMaint(st: MaintState) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(st))
  } catch { /* ignore */ }
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

  // Ha az announcements betöltődik a useSchool-ból, szinkronizáljuk
  useEffect(() => {
    if (!Array.isArray(initialAnnouncements)) return
    const fromAnn = parseMaintFromAnnouncements(initialAnnouncements)
    const next = fromAnn ?? DEFAULT_MAINT
    setMaint(next)
    saveLocalMaint(next)
  }, [initialAnnouncements])

  useEffect(() => {
    if (!schoolId) return
    let alive = true

    const fetchLatest = async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, text')
        .eq('school_id', schoolId)
        .like('text', `${MAINT_PREFIX}%`)
      if (!alive || error) return
      const next = parseMaintFromAnnouncements(data as any) ?? DEFAULT_MAINT
      setMaint(next)
      saveLocalMaint(next)
    }

    fetchLatest()
    const timer = setInterval(fetchLatest, 15_000)

    const ch = supabase.channel(`sulibell-maint-${schoolId}`, {
      config: { broadcast: { self: false } },
    })
    ch.on('broadcast', { event: 'maint' }, (msg: any) => {
      const p = msg?.payload
      if (!alive || !p) return
      const next: MaintState = {
        main: !!p.main,
        tv: !!p.tv,
        text: typeof p.text === 'string' && p.text.trim() ? p.text.trim() : DEFAULT_MAINT.text,
      }
      setMaint(next)
      saveLocalMaint(next)
    }).subscribe()
    chanRef.current = ch

    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel(`sulibell-maint-${schoolId}`)
      bc.onmessage = ev => {
        if (!alive || !ev.data) return
        const next: MaintState = {
          main: !!ev.data.main,
          tv: !!ev.data.tv,
          text: typeof ev.data.text === 'string' && ev.data.text.trim() ? ev.data.text.trim() : DEFAULT_MAINT.text,
        }
        setMaint(next)
        saveLocalMaint(next)
      }
      bcRef.current = bc
    } catch { /* ignore */ }

    return () => {
      alive = false
      clearInterval(timer)
      supabase.removeChannel(ch)
      chanRef.current = null
      try { bc?.close() } catch { /* ignore */ }
      bcRef.current = null
    }
  }, [schoolId])

  const updateMaint = useCallback(async (patch: Partial<MaintState>) => {
    const next: MaintState = {
      main: patch.main !== undefined ? patch.main : maint.main,
      tv: patch.tv !== undefined ? patch.tv : maint.tv,
      text: (patch.text !== undefined ? patch.text : maint.text).trim() || DEFAULT_MAINT.text,
    }
    setMaint(next)
    saveLocalMaint(next)

    // Azonnali élő szórás minden nyitott főoldal és /display fülnek
    chanRef.current?.send({
      type: 'broadcast',
      event: 'maint',
      payload: next,
    }).catch?.(() => {})
    try { bcRef.current?.postMessage(next) } catch { /* ignore */ }

    if (!schoolId) return { error: null }

    // Mentés a Supabase announcements táblába (speciális __MAINT__: sorba)
    await supabase
      .from('announcements')
      .delete()
      .eq('school_id', schoolId)
      .like('text', `${MAINT_PREFIX}%`)

    if (next.main || next.tv) {
      const payloadStr = MAINT_PREFIX + JSON.stringify(next)
      const { error } = await supabase
        .from('announcements')
        .insert({ school_id: schoolId, text: payloadStr, active_until: null })
      return { error }
    }
    return { error: null }
  }, [schoolId, maint])

  return { maint, updateMaint }
}
