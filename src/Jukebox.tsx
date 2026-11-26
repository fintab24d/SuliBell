import { memo, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from './lib/supabase'
import { fxSound } from './lib/sound'
import { parseYouTubeId, cleanSongTitle } from './lib/video'
import { voterId } from './Poll'
import { DISCORD_INVITE_URL, fetchDiscordSync, postToDiscord } from './lib/discord'
import { weekdayOf } from './lib/engine'
import { fetchYouTubeTitle, validateMediaSubmission } from './lib/moderation'
import { focusPlayerProfile, usePlayerProfile } from './lib/usePlayerProfile'
import { loadVipStatus } from './lib/vip'

export type MediaKind = 'music'

/** Igaz, ha a megadott nap (YYYY-MM-DD) hétvége (szombat vagy vasárnap). */
export function isJukeboxWeekend(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && weekdayOf(day) >= 6
}

export interface SongWish {
  id: string
  day: string
  kind: MediaKind
  title: string
  by: string
  ytId?: string
  votes: number
  at: number
  approved?: boolean
  approvedAt?: number
  vip?: boolean
}

const QUICK_SONGS: { title: string; ytId: string }[] = [
  { title: 'Cartoon – On & On (NCS)', ytId: 'K4DyBUG242c' },
  { title: 'Elektronomia – Sky High', ytId: 'TW9d8vYrVFQ' },
  { title: 'Deaf Kev – Invincible', ytId: 'J2X5mJ3HDYE' },
  { title: 'Alan Walker – Fade', ytId: 'bM7SZ5SBzyY' },
  { title: 'Azahriah – 3korty', ytId: 'mR8_ld2wccU' },
  { title: 'DESH – Kukásautó', ytId: 'k7N-rC7c8H0' },
]

const XMAS_QUICK_SONGS: { title: string; ytId: string }[] = [
  { title: 'Wham! – Last Christmas', ytId: 'E8gmARGvPlI' },
  { title: 'Mariah Carey – All I Want For Christmas Is You', ytId: 'yXQViqx6GMY' },
  { title: 'Shakin’ Stevens – Merry Christmas Everyone', ytId: 'N-PyWfVkjZc' },
]

const STORAGE_PREFIX = 'csengeto-jukebox-'
const DELETED_PREFIX = 'csengeto-jukebox-del-'
const SUB_PREFIX = 'csengeto-jukebox-sub-'

/**
 * Napváltáskor eltávolítja az összes korábbi napról megmaradt helyi kívánságot,
 * beküldési korlátot és törölt elemet, így az új nap mindig tiszta lappal indul.
 */
export function pruneOldJukeboxDays(currentDay: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(currentDay)) return
  const keep = new Set([
    STORAGE_PREFIX + currentDay,
    DELETED_PREFIX + currentDay,
    SUB_PREFIX + currentDay,
  ])
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith(STORAGE_PREFIX) && !keep.has(k)) {
        localStorage.removeItem(k)
      }
    }
  } catch { /* ignore */ }
}

function loadDeletedSet(day: string): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem(DELETED_PREFIX + day) ?? '[]')
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveDeletedSet(day: string, set: Set<string>) {
  try {
    localStorage.setItem(DELETED_PREFIX + day, JSON.stringify(Array.from(set)))
  } catch { /* ignore */ }
}

export function loadLocalSongs(day: string): SongWish[] {
  try {
    pruneOldJukeboxDays(day)
    const del = loadDeletedSet(day)
    const raw: any[] = JSON.parse(localStorage.getItem(STORAGE_PREFIX + day) ?? '[]') || []
    return raw
      .filter(s => s && s.id && (s.day === day || !s.day) && !del.has(s.id) && s.kind !== 'video')
      .map(s => ({
        id: String(s.id),
        day: s.day || day,
        kind: 'music' as const,
        title: String(s.title || ''),
        by: String(s.by || ''),
        ytId: s.ytId ? String(s.ytId) : undefined,
        votes: Number(s.votes) || 1,
        at: Number(s.at) || Date.now(),
      }))
  } catch {
    return []
  }
}

function saveLocalSongs(day: string, list: SongWish[]) {
  try {
    localStorage.setItem(STORAGE_PREFIX + day, JSON.stringify(list))
  } catch { /* ignore */ }
}

/** Az összes helyileg tárolt kívánság lekérése (admin moderációhoz több napra visszamenőleg is) */
export function loadAllLocalSongs(): SongWish[] {
  const all: SongWish[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(STORAGE_PREFIX)) continue
      const day = k.slice(STORAGE_PREFIX.length)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
      const del = loadDeletedSet(day)
      const items = loadLocalSongs(day)
      for (const item of items) {
        if (!del.has(item.id) && !all.some(x => x.id === item.id)) all.push(item)
      }
    }
  } catch { /* ignore */ }
  return all.sort((a, b) => b.at - a.at)
}

function loadSubmittedList(day: string): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(SUB_PREFIX + day) ?? '[]')
    return Array.isArray(arr) ? arr.map(String) : []
  } catch {
    return []
  }
}

function saveSubmittedList(day: string, list: string[]) {
  try {
    localStorage.setItem(SUB_PREFIX + day, JSON.stringify(list))
  } catch { /* ignore */ }
}

function countSubmittedEntries(list: string[], bk: string, byName?: string): number {
  const baseHits = list.filter(x => x === bk).length
  const norm = byName?.trim().toLowerCase()
  if (!norm) return baseHits
  const namedHits = list.filter(x => x === `${bk}::${norm}`).length
  return Math.max(baseHits, namedHits)
}

function sortSongs(list: SongWish[]): SongWish[] {
  return [...list]
    .sort((a, b) => Number(Boolean(b.vip)) - Number(Boolean(a.vip)) || a.at - b.at)
    .slice(0, 60)
}

function mergeSong(list: SongWish[], incoming: SongWish, deleted?: Set<string>): SongWish[] {
  if (deleted && deleted.has(incoming.id)) return list
  const norm = incoming.title.trim().toLowerCase()
  const idx = list.findIndex(
    x =>
      x.id === incoming.id ||
      (!!incoming.ytId && x.ytId === incoming.ytId) ||
      (x.kind === incoming.kind && x.title.trim().toLowerCase() === norm)
  )
  if (idx >= 0) {
    const cur = list[idx]
    if (deleted && deleted.has(cur.id)) return list
    const updated: SongWish = {
      ...cur,
      votes: Math.max(cur.votes, incoming.votes),
      ytId: cur.ytId || incoming.ytId,
      by: cur.by || incoming.by,
      kind: 'music',
      day: cur.day || incoming.day,
      at: cur.at && incoming.at ? Math.min(cur.at, incoming.at) : (cur.at || incoming.at),
      vip: Boolean(cur.vip || incoming.vip),
    }
    const next = [...list]
    next[idx] = updated
    return sortSongs(next)
  }
  return sortSongs([...list, incoming])
}

export function useJukebox(schoolId: string | undefined, day: string, sound?: boolean, breakKey?: string) {
  const [songs, setSongs] = useState<SongWish[]>(() => loadLocalSongs(day))
  const [pendingSongs, setPendingSongs] = useState<SongWish[]>([])
  const [ghosts, setGhosts] = useState<SongWish[]>([])
  const [submitted, setSubmitted] = useState<string[]>(() => loadSubmittedList(day))
  const [isVip, setIsVip] = useState<boolean>(() => loadVipStatus().active)
  const [discordChannels, setDiscordChannels] = useState<{ music: string }>({
    music: '#🎵-zenekérés-ötletek',
  })
  const chanRef = useRef<any>(null)
  const bcRef = useRef<BroadcastChannel | null>(null)
  const soundRef = useRef(sound)
  soundRef.current = sound
  const songsRef = useRef(songs)
  songsRef.current = songs
  const pendingRef = useRef(pendingSongs)
  pendingRef.current = pendingSongs

  useEffect(() => {
    const syncVip = () => setIsVip(loadVipStatus().active)
    const onVipStorage = (e: StorageEvent) => {
      if (!e.key || e.key === 'sulibell_vip_status_v1') syncVip()
    }
    window.addEventListener('sulibell:vip-change', syncVip)
    window.addEventListener('storage', onVipStorage)
    return () => {
      window.removeEventListener('sulibell:vip-change', syncVip)
      window.removeEventListener('storage', onVipStorage)
    }
  }, [])

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return
    pruneOldJukeboxDays(day)
    setSongs(loadLocalSongs(day))
    setPendingSongs([])
    setGhosts([])
    setSubmitted(loadSubmittedList(day))
    const onStorage = (e: StorageEvent) => {
      if (e.key === SUB_PREFIX + day) setSubmitted(loadSubmittedList(day))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [day])

  const maxSongsPerBreak = isVip ? 2 : 1

  const submittedCountInBreak = useCallback((byName?: string) => {
    if (!breakKey) return 0
    return countSubmittedEntries(submitted, breakKey, byName)
  }, [breakKey, submitted])

  const hasSubmittedInBreak = useCallback((byName?: string) => {
    if (!breakKey) return false
    return submittedCountInBreak(byName) >= maxSongsPerBreak
  }, [breakKey, submittedCountInBreak, maxSongsPerBreak])

  const applyDeleteLocal = useCallback((songId: string, targetDay?: string) => {
    const d = targetDay || day
    const localList = loadLocalSongs(d)
    const found =
      (d === day ? songsRef.current.find(s => s.id === songId) : undefined) ??
      localList.find(s => s.id === songId)
    const del = loadDeletedSet(d)
    del.add(songId)
    saveDeletedSet(d, del)
    const existing = localList.filter(s => s.id !== songId)
    saveLocalSongs(d, existing)
    if (d === day) {
      setSongs(prev => prev.filter(s => s.id !== songId))
      setPendingSongs(prev => prev.filter(s => s.id !== songId))
      if (found?.ytId) {
        setGhosts(prev => (prev.some(g => g.id === found.id) ? prev : [...prev, found]))
      }
    }
  }, [day])

  useEffect(() => {
    if (!schoolId || !day) return
    let alive = true
    const recentCreatedAt = new Map<string, number>()

    const syncFromDb = async () => {
      const { data, error }: any = await supabase.rpc('get_jukebox_state', { p_school: schoolId, p_day: day })
      if (!alive) return
      if (error || !Array.isArray(data)) {
        // Régebbi DB migráció esetén visszaesünk get_jukebox_songs-ra
        const fallback: any = await supabase.rpc('get_jukebox_songs', { p_school: schoolId, p_day: day })
        if (!alive || fallback.error || !Array.isArray(fallback.data)) return
        const del = loadDeletedSet(day)
        const dbIds = new Set<string>()
        const fbSongs: SongWish[] = []
        for (const r of fallback.data) {
          if (r.kind === 'video') continue
          const sid = String(r.song_id)
          if (del.has(sid)) continue
          dbIds.add(sid)
          fbSongs.push({
            id: sid,
            day,
            kind: 'music',
            title: cleanSongTitle(String(r.title)),
            by: String(r.requester ?? ''),
            ytId: r.yt_id ? String(r.yt_id) : undefined,
            votes: Number(r.votes) || 1,
            at: Date.parse(r.created_at) || Date.now(),
            approved: true,
          })
        }
        setSongs(prev => {
          let next: SongWish[] = []
          for (const item of fbSongs) {
            next = mergeSong(next, item, del)
          }
          // Csak Discord vagy épp most beküldött (optimista) elemek maradnak helyben
          const nowMs = Date.now()
          for (const old of prev) {
            if (del.has(old.id) || dbIds.has(old.id)) continue
            if (old.id.startsWith('dc-') || (old.approved !== false && nowMs - old.at < 8_000)) {
              next = mergeSong(next, old, del)
            }
          }
          saveLocalSongs(day, next)
          return next
        })
        return
      }

      const del = loadDeletedSet(day)
      const dbActive: SongWish[] = []
      const dbPending: SongWish[] = []
      const dbGhosts: SongWish[] = []
      const dbIds = new Set<string>()

      for (const r of data) {
        if (r.kind === 'video') continue
        const sid = String(r.song_id)
        dbIds.add(sid)
        const cleanedTitle = cleanSongTitle(String(r.title ?? ''))
        if (r.deleted) {
          del.add(sid)
          const ytId = r.yt_id ? String(r.yt_id).trim() : ''
          const ttl = cleanedTitle.trim()
          if (r.approved !== false && ytId && ttl && ttl !== '(törölve)' && ttl !== '(lejátszva)') {
            dbGhosts.push({
              id: sid,
              day,
              kind: 'music',
              title: ttl,
              by: String(r.requester ?? ''),
              ytId,
              votes: Number(r.votes) || 1,
              at: Date.parse(r.approved_at || r.created_at) || Date.now(),
            })
          }
          continue
        }
        if (del.has(sid)) continue
        const isApproved = r.approved !== false
        const createdMs = Date.parse(r.created_at) || Date.now()
        const approvedMs = r.approved_at ? Date.parse(r.approved_at) || createdMs : createdMs
        const item: SongWish = {
          id: sid,
          day,
          kind: 'music',
          title: cleanedTitle,
          by: String(r.requester ?? ''),
          ytId: r.yt_id ? String(r.yt_id) : undefined,
          votes: Number(r.votes) || 1,
          at: isApproved ? approvedMs : createdMs,
          approved: isApproved,
          approvedAt: r.approved_at ? approvedMs : undefined,
          vip: Boolean(r.is_vip),
        }
        if (isApproved) dbActive.push(item)
        else dbPending.push(item)
      }
      saveDeletedSet(day, del)

      setGhosts(prev => {
        const next: SongWish[] = [...dbGhosts]
        for (const old of prev) {
          if (!old.ytId || next.some(x => x.id === old.id)) continue
          if (old.id.startsWith('dc-') || !dbIds.has(old.id)) {
            next.push(old)
          }
        }
        return next
      })

      setPendingSongs(prev => {
        const next = [...dbPending]
        const nowMs = Date.now()
        for (const old of prev) {
          if (del.has(old.id) || dbIds.has(old.id)) continue
          const createdTs = recentCreatedAt.get(old.id) ?? old.at
          if (nowMs - createdTs < 10_000) next.push(old)
        }
        return sortSongs(next)
      })

      setSongs(prev => {
        let next: SongWish[] = []
        for (const item of dbActive) {
          next = mergeSong(next, item, del)
        }
        const nowMs = Date.now()
        for (const old of prev) {
          if (del.has(old.id) || dbIds.has(old.id)) continue
          const createdTs = recentCreatedAt.get(old.id) ?? old.at
          if (old.id.startsWith('dc-') || (old.approved !== false && nowMs - createdTs < 8_000)) {
            next = mergeSong(next, old, del)
          }
        }
        saveLocalSongs(day, next)
        return next
      })
    }

    // Discord #🎵-zenekérés-ötletek szinkronizáció
    const syncFromDiscord = async () => {
      const res = await fetchDiscordSync()
      if (!alive) return
      if (res.channels) {
        setDiscordChannels(prev => {
          const music = res.channels?.music || prev.music
          return prev.music === music ? prev : { music }
        })
      }
      if (!res.songs.length) return
      const del = loadDeletedSet(day)
      const dcGhosts: SongWish[] = []
      setSongs(prev => {
        let next = prev.filter(s => !del.has(s.id))
        for (const ds of res.songs) {
          // Napváltáskor a korábbi napokról beküldött elemek törlődnek/nem jelennek meg a mai napon!
          if (ds.day !== day) continue
          const item: SongWish = {
            id: ds.id,
            day,
            kind: 'music',
            title: cleanSongTitle(ds.title),
            by: ds.by,
            ytId: ds.ytId,
            votes: ds.votes,
            at: ds.at,
            approved: true,
            vip: Boolean(ds.vip) || ds.by.includes('💎'),
          }
          if (del.has(ds.id)) {
            if (ds.ytId) dcGhosts.push(item)
            continue
          }
          next = mergeSong(next, item, del)
        }
        saveLocalSongs(day, next)
        return next
      })
      if (dcGhosts.length > 0) {
        setGhosts(prev => {
          const next = [...prev]
          for (const g of dcGhosts) {
            if (!next.some(x => x.id === g.id)) next.push(g)
          }
          return next
        })
      }
    }

    const syncAll = async () => {
      await syncFromDb()
      await syncFromDiscord()
    }

    syncAll()
    const pollTimer = setInterval(() => {
      if (!document.hidden) syncAll()
    }, 10_000)

    const onResume = () => {
      if (!document.hidden) syncAll()
    }
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('focus', onResume)
    window.addEventListener('pageshow', onResume)
    window.addEventListener('sulibell:refresh', onResume)

    // Realtime csatorna (Broadcast) + egyedi DB postgres_changes csatorna
    const ch = supabase.channel(`sulibell-jukebox-${schoolId}`, {
      config: { broadcast: { self: false } },
    })
    const pgCh = supabase
      .channel(`sulibell-jukebox-pg-${schoolId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jukebox_songs', filter: `school_id=eq.${schoolId}` }, () => {
        if (!alive) return
        syncFromDb()
      })
      .subscribe()
    ch.on('broadcast', { event: 'song' }, (msg: any) => {
      const payload = msg?.payload
      if (!alive || !payload?.song) return
      const incoming = payload.song as SongWish
      const itemDay = incoming.day || day
      const del = loadDeletedSet(itemDay)
      if (del.has(incoming.id)) return
      if (itemDay === day) {
        recentCreatedAt.set(incoming.id, Date.now())
        setSongs(prev => {
          const next = mergeSong(prev, incoming, del)
          saveLocalSongs(day, next)
          return next
        })
      } else {
        const cur = loadLocalSongs(itemDay)
        saveLocalSongs(itemDay, mergeSong(cur, incoming, del))
      }
    })
    ch.on('broadcast', { event: 'pending' }, (msg: any) => {
      const payload = msg?.payload
      if (!alive || !payload?.song) return
      const incoming = payload.song as SongWish
      const itemDay = incoming.day || day
      const del = loadDeletedSet(itemDay)
      if (del.has(incoming.id) || itemDay !== day) return
      recentCreatedAt.set(incoming.id, Date.now())
      setPendingSongs(prev => mergeSong(prev, { ...incoming, approved: false }, del))
    })
    ch.on('broadcast', { event: 'approve' }, (msg: any) => {
      const payload = msg?.payload
      if (!alive || !payload?.id) return
      const songId = String(payload.id)
      const targetDay = payload.day ? String(payload.day) : day
      if (targetDay === day) {
        const found = pendingRef.current.find(s => s.id === songId)
        if (found) {
          setPendingSongs(prev => prev.filter(s => s.id !== songId))
          setSongs(prev => {
            const next = mergeSong(prev, { ...found, approved: true, at: Date.now() })
            saveLocalSongs(day, next)
            return next
          })
        }
        void syncFromDb()
      }
    })
    ch.on('broadcast', { event: 'delete' }, (msg: any) => {
      const payload = msg?.payload
      if (!alive || !payload?.id) return
      applyDeleteLocal(String(payload.id), payload.day ? String(payload.day) : day)
    })
    ch.on('broadcast', { event: 'clear_all' }, (msg: any) => {
      const payload = msg?.payload
      if (!alive) return
      const targetDay = payload?.day ? String(payload.day) : day
      const current = loadLocalSongs(targetDay)
      const del = loadDeletedSet(targetDay)
      current.forEach(s => del.add(s.id))
      saveDeletedSet(targetDay, del)
      saveLocalSongs(targetDay, [])
      if (targetDay === day) {
        setSongs([])
        setPendingSongs([])
      }
    })
    ch.on('broadcast', { event: 'sync_req' }, () => {
      if (!alive || songsRef.current.length === 0) return
      ch.send({
        type: 'broadcast',
        event: 'sync_res',
        payload: { songs: songsRef.current, day },
      }).catch?.(() => {})
    })
    ch.on('broadcast', { event: 'sync_res' }, (msg: any) => {
      const list = msg?.payload?.songs
      const resDay = msg?.payload?.day || day
      if (!alive || !Array.isArray(list) || resDay !== day) return
      const del = loadDeletedSet(day)
      setSongs(prev => {
        let next = [...prev]
        for (const item of list) {
          if (item && item.id && !del.has(item.id)) {
            next = mergeSong(next, item as SongWish, del)
          }
        }
        saveLocalSongs(day, next)
        return next
      })
    })
    ch.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        ch.send({ type: 'broadcast', event: 'sync_req', payload: { day } }).catch?.(() => {})
      }
    })
    chanRef.current = ch

    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel(`sulibell-jukebox-${schoolId}`)
      bc.onmessage = ev => {
        if (!alive || !ev.data) return
        if (ev.data.type === 'delete' && ev.data.id) {
          applyDeleteLocal(String(ev.data.id), ev.data.day ? String(ev.data.day) : day)
          return
        }
        if (ev.data.type === 'pending' && ev.data.song) {
          const incoming = ev.data.song as SongWish
          const itemDay = incoming.day || day
          const del = loadDeletedSet(itemDay)
          if (!del.has(incoming.id) && itemDay === day) {
            setPendingSongs(prev => mergeSong(prev, { ...incoming, approved: false }, del))
          }
          return
        }
        if (ev.data.type === 'approve' && ev.data.id) {
          const songId = String(ev.data.id)
          const targetDay = ev.data.day ? String(ev.data.day) : day
          if (targetDay === day) {
            const found = pendingRef.current.find(s => s.id === songId)
            if (found) {
              setPendingSongs(prev => prev.filter(s => s.id !== songId))
              setSongs(prev => {
                const next = mergeSong(prev, { ...found, approved: true, at: Date.now() })
                saveLocalSongs(day, next)
                return next
              })
            }
            void syncFromDb()
          }
          return
        }
        if (ev.data.type === 'clear_all') {
          const targetDay = ev.data.day ? String(ev.data.day) : day
          const current = loadLocalSongs(targetDay)
          const del = loadDeletedSet(targetDay)
          current.forEach(s => del.add(s.id))
          saveDeletedSet(targetDay, del)
          saveLocalSongs(targetDay, [])
          if (targetDay === day) {
            setSongs([])
            setPendingSongs([])
          }
          return
        }
        if (ev.data.song) {
          const incoming = ev.data.song as SongWish
          const itemDay = incoming.day || day
          const del = loadDeletedSet(itemDay)
          if (del.has(incoming.id)) return
          if (itemDay === day) {
            setSongs(prev => {
              const next = mergeSong(prev, incoming, del)
              saveLocalSongs(day, next)
              return next
            })
          } else {
            const cur = loadLocalSongs(itemDay)
            saveLocalSongs(itemDay, mergeSong(cur, incoming, del))
          }
        }
      }
      bcRef.current = bc
    } catch { /* ignore */ }

    return () => {
      alive = false
      clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('focus', onResume)
      window.removeEventListener('pageshow', onResume)
      window.removeEventListener('sulibell:refresh', onResume)
      supabase.removeChannel(ch)
      supabase.removeChannel(pgCh)
      chanRef.current = null
      try { bc?.close() } catch { /* ignore */ }
      bcRef.current = null
    }
  }, [schoolId, day, applyDeleteLocal])

  const broadcastSong = useCallback((song: SongWish) => {
    chanRef.current?.send({
      type: 'broadcast',
      event: 'song',
      payload: { song },
    }).catch?.(() => {})
    try { bcRef.current?.postMessage({ song }) } catch { /* ignore */ }
  }, [])

  const addSong = useCallback((rawTitle: string, rawBy: string, rawUrl?: string, explicitYtId?: string): { ok: boolean; reason?: 'invalid' | 'duplicate' | 'break_limit' } => {
    if (isJukeboxWeekend(day)) return { ok: false, reason: 'invalid' }
    const cleanTitle = cleanSongTitle(rawTitle).slice(0, 80)
    if (!cleanTitle) return { ok: false, reason: 'invalid' }
    const cleanBy = rawBy.trim().slice(0, 24)
    if (!cleanBy) return { ok: false, reason: 'invalid' }
    const ytId = explicitYtId || (rawUrl?.trim() ? parseYouTubeId(rawUrl.trim()) : parseYouTubeId(rawTitle.trim())) || undefined
    if (!ytId) return { ok: false, reason: 'invalid' }

    if (breakKey) {
      const latestSub = loadSubmittedList(day)
      const count = Math.max(
        countSubmittedEntries(submitted, breakKey, cleanBy),
        countSubmittedEntries(latestSub, breakKey, cleanBy)
      )
      if (count >= maxSongsPerBreak) {
        return { ok: false, reason: 'break_limit' }
      }
    }

    const existing = [...songs, ...pendingSongs].find(
      x => (!!ytId && x.ytId === ytId) || x.title.trim().toLowerCase() === cleanTitle.toLowerCase()
    )
    if (existing) {
      return { ok: false, reason: 'duplicate' }
    }

    const created: SongWish = {
      id: 'jb-' + Math.random().toString(36).slice(2, 10),
      day,
      kind: 'music',
      title: cleanTitle,
      by: cleanBy,
      ytId,
      votes: 1,
      at: Date.now(),
      approved: false,
      vip: isVip,
    }

    const del = loadDeletedSet(day)
    del.delete(created.id)
    saveDeletedSet(day, del)

    setPendingSongs(prev => mergeSong(prev, created))

    if (breakKey) {
      setSubmitted(prev => {
        const latest = loadSubmittedList(day)
        const base = latest.length >= prev.length ? latest : prev
        const next = [...base, breakKey, `${breakKey}::${cleanBy.toLowerCase()}`]
        saveSubmittedList(day, next)
        return next
      })
    }

    if (soundRef.current) fxSound('pop', 0)
    chanRef.current?.send({
      type: 'broadcast',
      event: 'pending',
      payload: { song: created },
    }).catch?.(() => {})
    try { bcRef.current?.postMessage({ type: 'pending', song: created }) } catch { /* ignore */ }

    postToDiscord({
      kind: 'jukebox',
      title: created.title,
      by: created.by,
      ytId: created.ytId,
    })

    if (schoolId) {
      supabase.rpc('submit_jukebox_wish', {
        p_school: schoolId,
        p_day: day,
        p_id: created.id,
        p_title: created.title,
        p_by: created.by,
        p_yt: created.ytId ?? null,
        p_media: null,
        p_kind: 'music',
        p_voter: voterId(),
        p_vip: isVip,
      }).then(() => {})
    }
    return { ok: true }
  }, [schoolId, day, breakKey, songs, pendingSongs, submitted, isVip, maxSongsPerBreak])

  const approveSong = useCallback(async (songId: string, targetDay?: string): Promise<{ error?: string }> => {
    const d = targetDay || day
    if (schoolId) {
      const { error: rpcErr } = await supabase.rpc('admin_approve_jukebox_song', {
        p_school: schoolId,
        p_day: d,
        p_id: songId,
      })
      if (rpcErr) return { error: rpcErr.message }
    }
    const found = pendingRef.current.find(s => s.id === songId)
    if (d === day && found) {
      const approvedItem: SongWish = { ...found, approved: true, approvedAt: Date.now(), at: Date.now() }
      setPendingSongs(prev => prev.filter(s => s.id !== songId))
      setSongs(prev => {
        const next = mergeSong(prev, approvedItem)
        saveLocalSongs(day, next)
        return next
      })
    }
    chanRef.current?.send({
      type: 'broadcast',
      event: 'approve',
      payload: { id: songId, day: d },
    }).catch?.(() => {})
    try { bcRef.current?.postMessage({ type: 'approve', id: songId, day: d }) } catch { /* ignore */ }
    return {}
  }, [schoolId, day])

  const removeSong = useCallback(async (songId: string, targetDay?: string): Promise<{ error?: string }> => {
    const d = targetDay || day
    applyDeleteLocal(songId, d)
    chanRef.current?.send({
      type: 'broadcast',
      event: 'delete',
      payload: { id: songId, day: d },
    }).catch?.(() => {})
    try { bcRef.current?.postMessage({ type: 'delete', id: songId, day: d }) } catch { /* ignore */ }

    if (schoolId) {
      const { error: rpcErr } = await supabase.rpc('admin_delete_jukebox_song', {
        p_school: schoolId,
        p_day: d,
        p_id: songId,
      })
      if (rpcErr) {
        // Tartalék régi DB esetén + RLS közvetlen törlés
        await supabase.rpc('delete_jukebox_song', { p_school: schoolId, p_id: songId }).then(() => {})
        const { error: delErr } = await supabase.from('jukebox_songs').update({ deleted: true }).eq('school_id', schoolId).eq('song_id', songId)
        if (delErr) {
          const { error: hardDelErr } = await supabase.from('jukebox_songs').delete().eq('school_id', schoolId).eq('song_id', songId)
          if (hardDelErr) return { error: hardDelErr.message }
        }
      }
    }
    return {}
  }, [schoolId, day, applyDeleteLocal])

  const finishSong = useCallback(async (songId: string, targetDay?: string) => {
    const d = targetDay || day
    applyDeleteLocal(songId, d)
    chanRef.current?.send({
      type: 'broadcast',
      event: 'delete',
      payload: { id: songId, day: d },
    }).catch?.(() => {})
    try { bcRef.current?.postMessage({ type: 'delete', id: songId, day: d }) } catch { /* ignore */ }

    if (schoolId) {
      await supabase.rpc('mark_jukebox_played', {
        p_school: schoolId,
        p_day: d,
        p_id: songId,
      }).then(() => {})
    }
  }, [schoolId, day, applyDeleteLocal])

  const clearAllSongs = useCallback(async (targetDay?: string): Promise<{ error?: string }> => {
    const d = targetDay || day
    const current = [...songsRef.current, ...loadLocalSongs(d)]
    const del = loadDeletedSet(d)
    current.forEach(s => del.add(s.id))
    saveDeletedSet(d, del)
    saveLocalSongs(d, [])
    if (d === day) {
      setSongs([])
      setPendingSongs([])
    }

    chanRef.current?.send({
      type: 'broadcast',
      event: 'clear_all',
      payload: { day: d },
    }).catch?.(() => {})
    try { bcRef.current?.postMessage({ type: 'clear_all', day: d }) } catch { /* ignore */ }

    if (schoolId) {
      const { error: clrErr } = await supabase.rpc('admin_clear_jukebox_day', { p_school: schoolId, p_day: d })
      if (clrErr) {
        await supabase.from('jukebox_songs').delete().eq('school_id', schoolId).eq('day', d)
      }
      // A Discordról szinkronizált elemek tombstone mentése, hogy ne jelenjenek meg újra
      for (const s of current) {
        if (s.id.startsWith('dc-')) {
          await supabase.rpc('admin_delete_jukebox_song', { p_school: schoolId, p_day: s.day || d, p_id: s.id }).then(() => {})
        }
      }
    }
    return {}
  }, [schoolId, day])

  return { songs, pendingSongs, ghosts, channels: discordChannels, isVip, maxSongsPerBreak, submittedCountInBreak, hasSubmittedInBreak, addSong, approveSong, removeSong, finishSong, clearAllSongs }
}

export default memo(function Jukebox({
  schoolId,
  day,
  breakKey,
  tv,
  sound,
  christmas,
  playedIds,
  nowPlayingId,
}: {
  schoolId?: string
  day: string
  breakKey?: string
  tv?: boolean
  sound?: boolean
  christmas?: boolean
  playedIds?: Set<string>
  nowPlayingId?: string
}) {
  const { songs, pendingSongs, channels, isVip, maxSongsPerBreak, submittedCountInBreak, hasSubmittedInBreak, addSong } = useJukebox(schoolId, day, sound, breakKey)
  const queue = songs.filter(s => !playedIds?.has(s.id) || s.id === nowPlayingId)
  const weekend = isJukeboxWeekend(day)
  const profile = usePlayerProfile(schoolId)
  const by = profile.valid ? profile.cleanName : ''
  const [ytUrl, setYtUrl] = useState('')
  const [pickedYtId, setPickedYtId] = useState<string | undefined>(undefined)
  const [autoTitle, setAutoTitle] = useState('')
  const [fetchingTitle, setFetchingTitle] = useState(false)
  const [titleError, setTitleError] = useState('')
  const [err, setErr] = useState('')
  const [justSubmitted, setJustSubmitted] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const alreadySubmittedBreak = hasSubmittedInBreak(by)
  const leftInBreak = Math.max(0, maxSongsPerBreak - submittedCountInBreak(by))
  const detectedYtId = pickedYtId || (ytUrl.trim() ? parseYouTubeId(ytUrl.trim()) : null) || undefined

  useEffect(() => {
    if (pickedYtId) {
      setFetchingTitle(false)
      setTitleError('')
      return
    }
    const id = ytUrl.trim() ? parseYouTubeId(ytUrl.trim()) : null
    if (!id) {
      setAutoTitle('')
      setFetchingTitle(false)
      setTitleError('')
      return
    }
    let cancelled = false
    setFetchingTitle(true)
    setTitleError('')
    const timer = window.setTimeout(async () => {
      const res = await fetchYouTubeTitle(id)
      if (cancelled) return
      setFetchingTitle(false)
      if (res.ok && res.title) {
        setAutoTitle(res.title)
        setTitleError('')
      } else {
        setAutoTitle('')
        setTitleError(res.error || 'Nem sikerült lekérni a szám címét a YouTube-ról.')
      }
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [ytUrl, pickedYtId])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setErr('')
    if (!profile.valid) {
      setErr('A zenekéréshez előbb állítsd be a neved a Játékosprofil kártyán!')
      focusPlayerProfile()
      return
    }
    if (hasSubmittedInBreak(by)) {
      setErr('Ebben a szünetben már küldtél be zenét! Egy ember egy szünetben csak 1 kívánságot küldhet be.')
      return
    }

    const parsedYtId = ytUrl.trim() ? parseYouTubeId(ytUrl.trim()) : null
    const finalYtId = pickedYtId || parsedYtId || undefined

    if (!finalYtId) {
      setErr('Érvényes YouTube-linket (watch, youtu.be, shorts) adj meg!')
      return
    }

    setSubmitting(true)
    try {
      let resolvedTitle = autoTitle.trim()
      if (!resolvedTitle) {
        const fetched = await fetchYouTubeTitle(finalYtId)
        if (!fetched.ok || !fetched.title) {
          setErr(fetched.error || 'Nem sikerült lekérni a szám címét a YouTube-ról. Ellenőrizd a linket!')
          return
        }
        resolvedTitle = fetched.title
        setAutoTitle(resolvedTitle)
      }

      // 1. Névtelen beküldés tiltása + 2. Káromkodás, NSFW & Explicit szűrő (párhuzamosan, gyorsítótárazva)
      const check = await validateMediaSubmission({
        title: resolvedTitle,
        by: by.trim(),
        ytId: finalYtId,
        url: ytUrl.trim() || `https://youtu.be/${finalYtId}`,
      })

      if (!check.valid) {
        setErr(check.error || 'A beküldés nem felel meg az iskolai szabályzatnak.')
        return
      }

      const cleanBy = check.cleanBy || by.trim()

      const res = addSong(check.cleanTitle || resolvedTitle, cleanBy, ytUrl, finalYtId)
      if (!res.ok) {
        if (res.reason === 'break_limit') {
          setErr(`Ebben a szünetben már elérted a limitet (${maxSongsPerBreak} kívánság/szünet).`)
        } else if (res.reason === 'duplicate') {
          setErr('Ez a szám már szerepel a mai várólistán!')
        } else {
          setErr('Érvénytelen beküldés — ellenőrizd a megadott YouTube-linket és a neved!')
        }
        return
      }
      setYtUrl('')
      setPickedYtId(undefined)
      setAutoTitle('')
      setTitleError('')
      setJustSubmitted(true)
      setShowForm(false)
    } finally {
      setSubmitting(false)
    }
  }

  // TV nézet: kompakt Következő számok kártya (hétvégén elrejtve)
  if (tv) {
    if (weekend || queue.length === 0) return null
    const top3 = queue.slice(0, 3)
    return (
      <section className="panel jukebox-tv">
        <div className="tag" style={{ marginBottom: 4 }}>
          🎵 Szüneti Zenegép — Következő számok
        </div>
        <ol className="jb-list tv-jb">
          {top3.map((s, i) => (
            <li key={s.id} className={`${i === 0 ? 'lead' : ''}${s.vip ? ' vip' : ''}`}>
              <span className="jb-rk">{i === 0 ? '▶' : `${i + 1}.`}</span>
              <div className="jb-info">
                <b>{cleanSongTitle(s.title)}</b>
                {s.by && <small>küldi: {s.by}</small>}
              </div>
              <span className="jb-votes">
                {s.vip ? '👑 VIP • ' : ''}
                {s.id === nowPlayingId ? '▶ Most szól' : i === 0 ? '▶ Következő' : `#${i + 1}`}
              </span>
            </li>
          ))}
        </ol>
      </section>
    )
  }

  const quickItems = christmas ? [...XMAS_QUICK_SONGS, ...QUICK_SONGS.slice(0, 4)] : QUICK_SONGS
  const musicRoom = channels.music || '#🎵-zenekérés-ötletek'

  if (weekend) {
    return (
      <section className="panel jukebox">
        <div className="jb-head">
          <div>
            <div className="tag" style={{ marginBottom: 4 }}>
              🎵 Szüneti Zenegép
            </div>
            <p className="meta" style={{ margin: 0 }}>
              Hétvégén a zenebeküldés és a szüneti lejátszás szünetel — hétfőn az első szünettel újra indul!
            </p>
          </div>
        </div>
        <div className="jb-empty">
          <span>🛌 Pihenj egyet hétvégén! Tanítási napokon újra vár a kívánságlista.</span>
        </div>
      </section>
    )
  }

  return (
    <section className="panel jukebox">
      <div className="jb-head">
        <div>
          <div className="tag" style={{ marginBottom: 4 }}>
            🎵 Szüneti Zenegép &amp; SuliRádió
          </div>
          <p className="meta" style={{ margin: 0 }}>
            {`A beküldött zenék érkezési sorrendben szólnak reggel 07:45-től, a szünetekben és tanítás után 15:00-ig! Ha épp nincs kívánság, automatikusan a 📻 SuliRádió szól — küldj be itt egy YouTube-linket vagy írj a Discord ${musicRoom} szobába!`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <a
            href={DISCORD_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 12, border: '1px solid var(--line)', background: 'rgba(88,101,242,.18)' }}
            title={`Zenekérés a hivatalos SuliBell Discord szerveren (${musicRoom})`}
          >
            💬 Discord
          </a>
          <button
            type="button"
            className={showForm ? 'on' : 'cta'}
            onClick={() => { setShowForm(v => !v); setErr(''); setJustSubmitted(false) }}
          >
            {showForm ? '✕ Bezárás' : '➕ Zene beküldése'}
          </button>
        </div>
      </div>

      {justSubmitted && (
        <div className="jb-ok-banner" role="status">
          ✅ Beküldve! A zenéd admin jóváhagyásra vár — amint elfogadják, bekerül a szüneti műsorba.
        </div>
      )}

      {showForm && (
        <form className="jb-form" onSubmit={submit}>
          <div className="jb-quick">
            <small>Gyors zene tippek (1 kattintás):</small>
            <div className="jb-chips">
              {quickItems.map(q => (
                <button
                  key={q.title}
                  type="button"
                  className={`qchip ${pickedYtId === q.ytId ? 'on' : ''}`}
                  onClick={() => {
                    setPickedYtId(q.ytId)
                    setAutoTitle(q.title)
                    setYtUrl(`https://youtu.be/${q.ytId}`)
                    setTitleError('')
                    setErr('')
                  }}
                >
                  🎵 {q.title}
                </button>
              ))}
            </div>
          </div>

          <div className="jb-inputs">
            {isVip && (
              <p className="jb-vip-hint">
                👑 VIP elsőbbség aktív: ebben a szünetben még <b>{leftInBreak} / {maxSongsPerBreak}</b> zenét kérhetsz, és elfogadás után soron kívül szólal meg!
              </p>
            )}
            <input
              type="url"
              placeholder="Illeszd be a YouTube-linket (watch, youtu.be, shorts) *"
              required
              value={ytUrl}
              onChange={e => {
                setYtUrl(e.target.value)
                setPickedYtId(undefined)
                setErr('')
              }}
            />
            {detectedYtId && (
              <div className="jb-yt-preview">
                <img src={`https://i.ytimg.com/vi/${detectedYtId}/mqdefault.jpg`} alt="" />
                <div>
                  {fetchingTitle ? (
                    <small>⏳ Szám címének lekérése a YouTube-ról…</small>
                  ) : autoTitle ? (
                    <>
                      <small>YouTube-cím felismerve:</small>
                      <b>🎵 {autoTitle}</b>
                    </>
                  ) : (
                    <small style={{ color: 'var(--warn)' }}>{titleError || 'Nem található cím ehhez a videóhoz.'}</small>
                  )}
                </div>
              </div>
            )}
            <div className="jb-row2">
              {profile.valid ? (
                <div className="jb-sender-chip">
                  <span>👤 Küldő: <b>{by}</b></span>
                  <button
                    type="button"
                    className="jb-edit-profile"
                    onClick={() => focusPlayerProfile()}
                    title="Név módosítása a Játékosprofilban"
                    aria-label="Név módosítása"
                  >
                    ✏️
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="profile-chip-cta"
                  onClick={() => focusPlayerProfile()}
                >
                  👤 Add meg a neved a beküldéshez
                </button>
              )}
              <button
                type="submit"
                className="cta"
                disabled={submitting || fetchingTitle || !detectedYtId || !profile.valid || alreadySubmittedBreak}
              >
                {alreadySubmittedBreak ? '⏸️ Már küldtél be' : submitting ? '⏳ Küldés…' : '🚀 Beküldés'}
              </button>
            </div>
            {alreadySubmittedBreak && (
              <small style={{ color: '#facc15', fontWeight: 600 }}>
                ⏸️ Ebben a szünetben már elérted a keretedet ({maxSongsPerBreak} kívánság / szünet).
              </small>
            )}
            {err && <small style={{ color: 'var(--warn)', fontWeight: 600 }}>{err}</small>}
            <small style={{ color: 'var(--mut)', fontSize: '0.8rem', marginTop: 4, display: 'block' }}>
              🛡️ Szabályok: Elég bemásolnod a YouTube-linket — a szám címét automatikusan letisztítva kérjük le és ellenőrizzük. Szünetenként {maxSongsPerBreak} számot küldhetsz be ({isVip ? '👑 VIP: 2/szünet + soron kívüli lejátszás' : 'VIP ranggal: 2/szünet + soron kívüli lejátszás'}). A beküldött zenék admin jóváhagyás után kerülnek be a szüneti sorba; ha nincs jóváhagyott kívánság, a 📻 SuliRádió szól!
            </small>
          </div>
        </form>
      )}

      {queue.length === 0 ? (
        <div className="jb-empty">
          <span>
            📻 Még nincs mai jóváhagyott diák-kívánság — reggel 07:45-től, a szünetekben és tanítás után 15:00-ig a <b>SuliRádió</b> gondoskodik a zenéről! Küldj be egy YouTube-linket, és admin elfogadás után megszólal!
          </span>
        </div>
      ) : (
        <ol className="jb-list">
          {queue.slice(0, 8).map((s, i) => {
            const ytWatchUrl = s.ytId
              ? `https://youtu.be/${s.ytId}`
              : `https://www.youtube.com/results?search_query=${encodeURIComponent(s.title)}`
            const displayTitle = cleanSongTitle(s.title)
            return (
              <li key={s.id} className={`jb-item ${i === 0 ? 'lead' : ''}${s.vip ? ' vip' : ''}`}>
                <div className="jb-main">
                  <span className="jb-rk">
                    {i === 0 ? (
                      <span className="eq" aria-label="Következő a sorban">
                        <i /><i /><i />
                      </span>
                    ) : (
                      `${i + 1}.`
                    )}
                  </span>
                  <div className="jb-info">
                    <b>{displayTitle}</b>
                    <div className="jb-sub">
                      {s.by && <small>Küldi: {s.by}</small>}
                      {s.vip && (
                        <span className="pill jb-vip-pill" style={{ fontSize: '0.7rem', padding: '1px 6px' }}>
                          👑 VIP
                        </span>
                      )}
                      <span
                        className="pill"
                        style={{
                          fontSize: '0.72rem',
                          padding: '1px 6px',
                          background: i === 0 ? 'rgba(34,197,94,0.18)' : 'rgba(56,189,248,0.14)',
                          color: i === 0 ? '#4ade80' : '#7dd3fc',
                          border: `1px solid ${i === 0 ? 'rgba(34,197,94,0.35)' : 'rgba(56,189,248,0.35)'}`,
                          fontWeight: 600,
                        }}
                      >
                        {s.id === nowPlayingId ? '▶ Most szól' : i === 0 ? '▶ Következő a sorban' : `⏳ #${i + 1} a sorban`}
                      </span>
                      <a
                        href={ytWatchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="jb-link"
                        title="Megnyitás YouTube-on"
                      >
                        🔗 YouTube
                      </a>
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {pendingSongs.length > 0 && (
        <div className="jb-pending-box">
          <div className="jb-pending-head">
            <span>⏳ Jóváhagyásra vár ({pendingSongs.length})</span>
            <small>Amint az admin elfogadja, bekerül a sorba</small>
          </div>
          <ul className="jb-pending-list">
            {pendingSongs.slice(0, 6).map(s => (
              <li key={s.id} className="jb-pending-item">
                <span className="jb-pending-title">🎵 {cleanSongTitle(s.title)}</span>
                <span className="jb-pending-meta">
                  {s.vip && <span className="pill jb-vip-pill" style={{ fontSize: '0.7rem', padding: '1px 6px' }}>👑 VIP</span>}
                  {s.by && <small>Küldi: {s.by}</small>}
                  <span className="pill jb-pending-pill">⏳ Adminra vár</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
})
