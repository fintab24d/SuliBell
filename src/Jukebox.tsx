import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from './lib/supabase'
import { fxSound } from './lib/sound'
import { parseVideo } from './lib/video'
import { voterId } from './Poll'
import { DISCORD_INVITE_URL, fetchDiscordSync, postToDiscord } from './lib/discord'
import { validateMediaSubmission } from './lib/moderation'

export type MediaKind = 'music' | 'video'

/**
 * Naponta váltakozik: egyik nap szüneti videók ('video'),
 * másik nap szüneti zenék ('music') mennek a szünetekben.
 */
export function mediaModeForDay(day: string): MediaKind {
  const ms = Date.parse(day + 'T00:00:00Z')
  const epochDay = Math.floor((Number.isNaN(ms) ? Date.now() : ms) / 86400000)
  return epochDay % 2 === 0 ? 'video' : 'music'
}

export interface SongWish {
  id: string
  day: string
  kind: MediaKind
  title: string
  by: string
  ytId?: string
  mp4Url?: string
  votes: number
  at: number
}

const QUICK_SONGS: { title: string; ytId: string }[] = [
  { title: 'Cartoon – On & On (NCS)', ytId: 'K4DyBUG242c' },
  { title: 'Elektronomia – Sky High', ytId: 'TW9d8vYrVFQ' },
  { title: 'Deaf Kev – Invincible', ytId: 'J2X5mJ3HDYE' },
  { title: 'Alan Walker – Fade', ytId: 'bM7SZ5SBzyY' },
  { title: 'Azahriah – 3korty', ytId: 'mR8_ld2wccU' },
  { title: 'DESH – Kukásautó', ytId: 'k7N-rC7c8H0' },
]

const QUICK_VIDEOS: { title: string; ytId: string }[] = [
  { title: 'Gyönyörű természet és tájak 4K', ytId: 'LXb3EKWsInQ' },
  { title: 'A Föld az űrből – NASA 4K felvételek', ytId: 'H999s0P1Er0' },
  { title: 'Megnyugtató óceán és korallzátony', ytId: '1ZYbU82GVz4' },
  { title: 'Svájci Alpok – látványos drónvideó', ytId: 'linlz7-Pnvw' },
  { title: 'Látványos fizikai kísérletek (Slow Mo)', ytId: 'r8BiI9a2N4U' },
]

const STORAGE_PREFIX = 'csengeto-jukebox-'
const VOTED_PREFIX = 'csengeto-jukebox-voted-'
const DELETED_PREFIX = 'csengeto-jukebox-del-'

/** A szüneti lejátszáshoz szükséges minimális szavazatszám */
export const MIN_VOTES_TO_PLAY = 5

/**
 * Napváltáskor eltávolítja az összes korábbi napról megmaradt helyi kívánságot,
 * szavazatot és törölt elemet, így az új nap mindig tiszta lappal indul.
 */
export function pruneOldJukeboxDays(currentDay: string) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (!k) continue
      if (
        (k.startsWith(STORAGE_PREFIX) && k !== STORAGE_PREFIX + currentDay) ||
        (k.startsWith(VOTED_PREFIX) && k !== VOTED_PREFIX + currentDay) ||
        (k.startsWith(DELETED_PREFIX) && k !== DELETED_PREFIX + currentDay)
      ) {
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
    const raw: SongWish[] = JSON.parse(localStorage.getItem(STORAGE_PREFIX + day) ?? '[]') || []
    const fallbackKind = mediaModeForDay(day)
    return raw
      .filter(s => s && s.id && (s.day === day || !s.day) && !del.has(s.id))
      .map(s => ({
        ...s,
        day: s.day || day,
        kind: s.kind || fallbackKind,
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
      const items = loadLocalSongs(day)
      for (const item of items) {
        if (!all.some(x => x.id === item.id)) all.push(item)
      }
    }
  } catch { /* ignore */ }
  return all.sort((a, b) => b.at - a.at)
}

function loadVotedSet(day: string): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem(VOTED_PREFIX + day) ?? '[]')
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveVotedSet(day: string, set: Set<string>) {
  try {
    localStorage.setItem(VOTED_PREFIX + day, JSON.stringify(Array.from(set)))
  } catch { /* ignore */ }
}

function sortSongs(list: SongWish[]): SongWish[] {
  return [...list]
    .sort((a, b) => b.votes - a.votes || a.at - b.at)
    .slice(0, 20)
}

function mergeSong(list: SongWish[], incoming: SongWish, deleted?: Set<string>): SongWish[] {
  if (deleted && deleted.has(incoming.id)) return list
  const norm = incoming.title.trim().toLowerCase()
  const idx = list.findIndex(x => x.id === incoming.id || (x.kind === incoming.kind && x.title.trim().toLowerCase() === norm))
  if (idx >= 0) {
    const cur = list[idx]
    if (deleted && deleted.has(cur.id)) return list
    const updated: SongWish = {
      ...cur,
      votes: Math.max(cur.votes, incoming.votes),
      ytId: cur.ytId || incoming.ytId,
      mp4Url: cur.mp4Url || incoming.mp4Url,
      by: cur.by || incoming.by,
      kind: cur.kind || incoming.kind,
      day: cur.day || incoming.day,
    }
    const next = [...list]
    next[idx] = updated
    return sortSongs(next)
  }
  return sortSongs([...list, incoming])
}

export function useJukebox(schoolId: string | undefined, day: string, sound?: boolean) {
  const mode = mediaModeForDay(day)
  const [songs, setSongs] = useState<SongWish[]>(() => loadLocalSongs(day))
  const [voted, setVoted] = useState<Set<string>>(() => loadVotedSet(day))
  const chanRef = useRef<any>(null)
  const bcRef = useRef<BroadcastChannel | null>(null)
  const soundRef = useRef(sound)
  soundRef.current = sound
  const songsRef = useRef(songs)
  songsRef.current = songs

  useEffect(() => {
    pruneOldJukeboxDays(day)
    setSongs(loadLocalSongs(day))
    setVoted(loadVotedSet(day))
  }, [day])

  const applyDeleteLocal = useCallback((songId: string, targetDay?: string) => {
    const d = targetDay || day
    const del = loadDeletedSet(d)
    del.add(songId)
    saveDeletedSet(d, del)
    const existing = loadLocalSongs(d).filter(s => s.id !== songId)
    saveLocalSongs(d, existing)
    if (d === day) {
      setSongs(prev => prev.filter(s => s.id !== songId))
    }
  }, [day])

  useEffect(() => {
    if (!schoolId || !day) return
    let alive = true

    // Opcionális DB lekérés (update17.sql)
    supabase.rpc('get_jukebox_songs', { p_school: schoolId, p_day: day }).then(({ data, error }: any) => {
      if (!alive || error || !Array.isArray(data)) return
      const del = loadDeletedSet(day)
      setSongs(prev => {
        let next = prev.filter(s => !del.has(s.id))
        for (const r of data) {
          const sid = String(r.song_id)
          if (del.has(sid)) continue
          next = mergeSong(next, {
            id: sid,
            day,
            kind: (r.kind === 'video' || r.kind === 'music') ? r.kind : mode,
            title: String(r.title),
            by: String(r.requester ?? ''),
            ytId: r.yt_id ? String(r.yt_id) : undefined,
            mp4Url: r.media_url ? String(r.media_url) : undefined,
            votes: Number(r.votes) || 1,
            at: Date.parse(r.created_at) || Date.now(),
          }, del)
        }
        saveLocalSongs(day, next)
        return next
      })
    })

    // Discord #🎵-zenekérés-ötletek szinkronizáció (20 másodpercenként)
    const syncFromDiscord = async () => {
      const res = await fetchDiscordSync()
      if (!alive || !res.songs.length) return
      const del = loadDeletedSet(day)
      setSongs(prev => {
        let next = prev.filter(s => !del.has(s.id))
        for (const ds of res.songs) {
          if (del.has(ds.id)) continue
          // Napváltáskor a korábbi napokról beküldött elemek törlődnek/nem jelennek meg a mai napon!
          if (ds.day !== day) continue
          next = mergeSong(next, {
            id: ds.id,
            day,
            kind: mode,
            title: ds.title,
            by: ds.by,
            ytId: ds.ytId,
            votes: ds.votes,
            at: ds.at,
          }, del)
        }
        saveLocalSongs(day, next)
        return next
      })
    }
    syncFromDiscord()
    const dcTimer = setInterval(syncFromDiscord, 20_000)

    // Realtime csatorna
    const ch = supabase.channel(`sulibell-jukebox-${schoolId}`, {
      config: { broadcast: { self: false } },
    })
    ch.on('broadcast', { event: 'song' }, (msg: any) => {
      const payload = msg?.payload
      if (!alive || !payload?.song) return
      const incoming = payload.song as SongWish
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
      if (targetDay === day) setSongs([])
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
        if (ev.data.type === 'clear_all') {
          const targetDay = ev.data.day ? String(ev.data.day) : day
          const current = loadLocalSongs(targetDay)
          const del = loadDeletedSet(targetDay)
          current.forEach(s => del.add(s.id))
          saveDeletedSet(targetDay, del)
          saveLocalSongs(targetDay, [])
          if (targetDay === day) setSongs([])
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
      clearInterval(dcTimer)
      supabase.removeChannel(ch)
      chanRef.current = null
      try { bc?.close() } catch { /* ignore */ }
      bcRef.current = null
    }
  }, [schoolId, day, mode, applyDeleteLocal])

  const broadcastSong = useCallback((song: SongWish) => {
    chanRef.current?.send({
      type: 'broadcast',
      event: 'song',
      payload: { song },
    }).catch?.(() => {})
    try { bcRef.current?.postMessage({ song }) } catch { /* ignore */ }
  }, [])

  const addSong = useCallback((rawTitle: string, rawBy: string, rawUrl?: string, explicitYtId?: string) => {
    const cleanTitle = rawTitle.trim().slice(0, 60)
    if (!cleanTitle) return false
    const cleanBy = rawBy.trim().slice(0, 24)
    if (!cleanBy) return false
    const parsed = rawUrl?.trim() ? parseVideo(rawUrl.trim()) : parseVideo(rawTitle.trim())
    const ytId = explicitYtId || (parsed?.kind === 'yt' ? parsed.id : undefined)
    const mp4Url = parsed?.kind === 'file' ? parsed.src : undefined

    // Videó-napon kötelező vagy ajánlott az érvényes videólink / gyors tipp
    if (mode === 'video' && !ytId && !mp4Url && rawUrl?.trim()) {
      return false
    }

    const existing = songs.find(x => x.title.trim().toLowerCase() === cleanTitle.toLowerCase())
    if (existing && voted.has(existing.id)) {
      // Erre a számra már szavazott a felhasználó, többször nem szavazhat rá!
      return false
    }

    const created: SongWish = existing
      ? {
          ...existing,
          votes: existing.votes + 1,
          ytId: existing.ytId || ytId,
          mp4Url: existing.mp4Url || mp4Url,
          by: existing.by || cleanBy,
        }
      : {
          id: 'jb-' + Math.random().toString(36).slice(2, 10),
          day,
          kind: mode,
          title: cleanTitle,
          by: cleanBy,
          ytId,
          mp4Url,
          votes: 1,
          at: Date.now(),
        }

    const del = loadDeletedSet(day)
    del.delete(created.id)
    saveDeletedSet(day, del)

    setSongs(prev => {
      const next = mergeSong(prev, created)
      saveLocalSongs(day, next)
      return next
    })

    setVoted(prev => {
      const next = new Set(prev)
      next.add(created.id)
      saveVotedSet(day, next)
      return next
    })

    if (soundRef.current) fxSound('pop', 0)
    broadcastSong(created)

    if (!existing) {
      postToDiscord({
        kind: 'jukebox',
        title: created.title,
        by: created.by,
        ytId: created.ytId,
        mediaKind: created.kind,
      })
    }

    if (schoolId) {
      supabase.rpc('submit_jukebox_song', {
        p_school: schoolId,
        p_day: day,
        p_id: created.id,
        p_title: created.title,
        p_by: created.by,
        p_yt: created.ytId ?? null,
      }).then(() => {})
    }
    return true
  }, [schoolId, day, mode, songs, broadcastSong])

  const voteSong = useCallback((songId: string) => {
    if (voted.has(songId)) return
    const found = songs.find(s => s.id === songId)
    if (!found) return
    const updated: SongWish = { ...found, votes: found.votes + 1 }

    setSongs(prev => {
      const next = prev.map(s => (s.id === songId ? updated : s))
      const sorted = sortSongs(next)
      saveLocalSongs(day, sorted)
      return sorted
    })

    setVoted(prev => {
      const next = new Set(prev)
      next.add(songId)
      saveVotedSet(day, next)
      return next
    })

    if (soundRef.current) fxSound('pop', 0.2)
    broadcastSong(updated)

    if (schoolId) {
      supabase.rpc('vote_jukebox_song', {
        p_school: schoolId,
        p_day: day,
        p_id: songId,
        p_voter: voterId(),
      }).then(() => {})
    }
  }, [schoolId, day, songs, voted, broadcastSong])

  const removeSong = useCallback(async (songId: string, targetDay?: string) => {
    const d = targetDay || day
    applyDeleteLocal(songId, d)
    chanRef.current?.send({
      type: 'broadcast',
      event: 'delete',
      payload: { id: songId, day: d },
    }).catch?.(() => {})
    try { bcRef.current?.postMessage({ type: 'delete', id: songId, day: d }) } catch { /* ignore */ }

    if (schoolId) {
      await supabase.rpc('delete_jukebox_song', { p_school: schoolId, p_id: songId }).then(() => {})
      await supabase.from('jukebox_songs').delete().eq('school_id', schoolId).eq('song_id', songId).then(() => {})
      await supabase.from('break_videos').delete().eq('id', songId).then(() => {})
    }
  }, [schoolId, day, applyDeleteLocal])

  const clearAllSongs = useCallback(async (targetDay?: string) => {
    const d = targetDay || day
    const current = loadLocalSongs(d)
    const del = loadDeletedSet(d)
    current.forEach(s => del.add(s.id))
    saveDeletedSet(d, del)
    saveLocalSongs(d, [])
    if (d === day) setSongs([])

    chanRef.current?.send({
      type: 'broadcast',
      event: 'clear_all',
      payload: { day: d },
    }).catch?.(() => {})
    try { bcRef.current?.postMessage({ type: 'clear_all', day: d }) } catch { /* ignore */ }

    if (schoolId) {
      await supabase.from('jukebox_songs').delete().eq('school_id', schoolId).eq('day', d).then(() => {})
    }
  }, [schoolId, day])

  return { songs, voted, mode, addSong, voteSong, removeSong, clearAllSongs }
}

export default function Jukebox({
  schoolId,
  day,
  tv,
  sound,
}: {
  schoolId?: string
  day: string
  tv?: boolean
  sound?: boolean
}) {
  const { songs, voted, mode, addSong, voteSong } = useJukebox(schoolId, day, sound)
  const isVideoDay = mode === 'video'
  const [title, setTitle] = useState('')
  const [by, setBy] = useState(() => {
    try { return localStorage.getItem('csengeto-arena-name') ?? '' } catch { return '' }
  })
  const [ytUrl, setYtUrl] = useState('')
  const [pickedYtId, setPickedYtId] = useState<string | undefined>(undefined)
  const [err, setErr] = useState('')
  const [showForm, setShowForm] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!title.trim()) return

    const parsed = ytUrl.trim() ? parseVideo(ytUrl.trim()) : parseVideo(title.trim())
    const explicitOrParsedYt = pickedYtId || (parsed?.kind === 'yt' ? parsed.id : undefined)

    if (isVideoDay && !pickedYtId && !ytUrl.trim() && !parsed) {
      setErr('Videó-napon adj meg egy YouTube / videó linket, vagy válassz a gyors tippek közül!')
      return
    }
    if (ytUrl.trim() && !parsed) {
      setErr('Érvényes YouTube-linket (watch, youtu.be, shorts) vagy .mp4 linket adj meg!')
      return
    }

    // 1. Névtelen beküldés tiltása + 2. Káromkodás & NSFW szűrő
    const check = await validateMediaSubmission({
      title: title.trim(),
      by: by.trim(),
      ytId: explicitOrParsedYt,
    })

    if (!check.valid) {
      setErr(check.error || 'A beküldés nem felel meg az iskolai szabályzatnak.')
      return
    }

    const cleanBy = check.cleanBy || by.trim()
    try { localStorage.setItem('csengeto-arena-name', cleanBy) } catch { /* ignore */ }

    const ok = addSong(check.cleanTitle || title, cleanBy, ytUrl, pickedYtId)
    if (!ok) {
      setErr('Erre a számra vagy videóra már szavaztál korábban! Egy ember csak egyszer szavazhat.')
      return
    }
    setTitle('')
    setYtUrl('')
    setPickedYtId(undefined)
    setShowForm(false)
  }

  // TV nézet: kompakt Top 3 Kívánságlista kártya
  if (tv) {
    if (songs.length === 0) return null
    const top3 = songs.slice(0, 3)
    return (
      <section className="panel jukebox-tv">
        <div className="tag" style={{ marginBottom: 4 }}>
          {isVideoDay ? '🎬 Mai Szüneti Videók — Top 3' : '🎵 Mai Szüneti Zenegép — Top 3'}
        </div>
        <ol className="jb-list tv-jb">
          {top3.map((s, i) => (
            <li key={s.id} className={i === 0 ? 'lead' : ''}>
              <span className="jb-rk">{i === 0 ? '👑' : `${i + 1}.`}</span>
              <div className="jb-info">
                <b>{s.title}</b>
                {s.by && <small>küldi: {s.by}</small>}
              </div>
              <span className="jb-votes">
                {s.votes >= MIN_VOTES_TO_PLAY ? `🔥 ${s.votes} (✅ Kész)` : `⏳ ${s.votes}/${MIN_VOTES_TO_PLAY}`}
              </span>
            </li>
          ))}
        </ol>
      </section>
    )
  }

  const quickItems = isVideoDay ? QUICK_VIDEOS : QUICK_SONGS

  return (
    <section className="panel jukebox">
      <div className="jb-head">
        <div>
          <div className="tag" style={{ marginBottom: 4 }}>
            {isVideoDay
              ? '🎬 Szüneti Videók & Kívánságlista (Ma: Videó-nap • Holnap: Zene-nap)'
              : '🎵 Szüneti Zenegép & Kívánságlista (Ma: Zene-nap • Holnap: Videó-nap)'}
          </div>
          <p className="meta" style={{ margin: 0 }}>
            {isVideoDay
              ? 'Ma a szünetekben videók mennek! Küldj be videót itt vagy a Discord #🎵-zenekérés-ötletek szobában — automatikusan megjelenik az oldalon!'
              : 'Ma a szünetekben zenék szólnak! Küldd be a kedvenc számodat itt vagy a Discord #🎵-zenekérés-ötletek szobában — automatikusan szinkronizálódik!'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <a
            href={DISCORD_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 12, border: '1px solid var(--line)', background: 'rgba(88,101,242,.18)' }}
            title="Zenekérés a hivatalos SuliBell Discord szerveren"
          >
            💬 Discord
          </a>
          <button
            type="button"
            className={showForm ? 'on' : 'cta'}
            onClick={() => { setShowForm(v => !v); setErr('') }}
          >
            {showForm ? '✕ Bezárás' : isVideoDay ? '➕ Videó beküldése' : '➕ Zene beküldése'}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="jb-form" onSubmit={submit}>
          <div className="jb-quick">
            <small>{isVideoDay ? 'Gyors videó tippek (1 kattintás):' : 'Gyors zene tippek (1 kattintás):'}</small>
            <div className="jb-chips">
              {quickItems.map(q => (
                <button
                  key={q.title}
                  type="button"
                  className={`qchip ${pickedYtId === q.ytId ? 'on' : ''}`}
                  onClick={() => {
                    setTitle(q.title)
                    setPickedYtId(q.ytId)
                    setYtUrl(`https://youtu.be/${q.ytId}`)
                    setErr('')
                  }}
                >
                  {isVideoDay ? '🎬' : '🎵'} {q.title}
                </button>
              ))}
            </div>
          </div>

          <div className="jb-inputs">
            <input
              type="text"
              placeholder={
                isVideoDay
                  ? 'Videó címe (pl. Látványos természet 4K / Vicces összeállítás) *'
                  : 'Előadó – Szám címe (pl. Azahriah – 3korty) *'
              }
              maxLength={60}
              required
              value={title}
              onChange={e => { setTitle(e.target.value); setErr('') }}
            />
            <div className="jb-row2">
              <input
                type="text"
                placeholder="Ki küldi? (pl. 10.B / Dani) *"
                maxLength={24}
                required
                value={by}
                onChange={e => { setBy(e.target.value); setErr('') }}
              />
              <input
                type="url"
                placeholder={isVideoDay ? 'YouTube vagy .mp4 link (https://...) *' : 'YouTube link a szüneti lejátszáshoz (ajánlott)'}
                value={ytUrl}
                required={isVideoDay && !pickedYtId}
                onChange={e => {
                  setYtUrl(e.target.value)
                  setPickedYtId(undefined)
                  setErr('')
                }}
              />
              <button type="submit" className="cta" disabled={!title.trim() || !by.trim()}>
                🚀 Beküldés
              </button>
            </div>
            {err && <small style={{ color: 'var(--warn)', fontWeight: 600 }}>{err}</small>}
            <small style={{ color: 'var(--mut)', fontSize: '0.8rem', marginTop: 4, display: 'block' }}>
              🛡️ Szabályok: A név megadása kötelező (névtelenül nem küldhető be). A szüneti lejátszáshoz legalább {MIN_VOTES_TO_PLAY} szavazat szükséges. Egy ember csak egyszer szavazhat egy számra. Lejátszás után automatikusan törlődik a listából, napváltáskor pedig az összes megmaradt kívánság törlődik.
            </small>
          </div>
        </form>
      )}

      {songs.length === 0 ? (
        <div className="jb-empty">
          <span>
            {isVideoDay
              ? '🎬 Még nincs mai szüneti videó. Küldj be egyet, és a szünetben ez fog menni!'
              : '🎧 Még nincs mai zene-kívánság. Legyél te az első, aki bedob egy számot a szünetre!'}
          </span>
        </div>
      ) : (
        <ol className="jb-list">
          {songs.slice(0, 8).map((s, i) => {
            const isVoted = voted.has(s.id)
            const ytSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(s.title)}`
            return (
              <li key={s.id} className={`jb-item ${i === 0 ? 'lead' : ''}`}>
                <div className="jb-main">
                  <span className="jb-rk">
                    {i === 0 ? (
                      <span className="eq" aria-label="1. hely">
                        <i /><i /><i />
                      </span>
                    ) : (
                      `${i + 1}.`
                    )}
                  </span>
                  <div className="jb-info">
                    <b>{s.title}</b>
                    <div className="jb-sub">
                      {s.by && <small>Küldi: {s.by}</small>}
                      <span
                        className="pill"
                        style={{
                          fontSize: '0.72rem',
                          padding: '1px 6px',
                          background: s.votes >= MIN_VOTES_TO_PLAY ? 'rgba(34,197,94,0.18)' : 'rgba(234,179,8,0.18)',
                          color: s.votes >= MIN_VOTES_TO_PLAY ? '#4ade80' : '#facc15',
                          border: `1px solid ${s.votes >= MIN_VOTES_TO_PLAY ? 'rgba(34,197,94,0.35)' : 'rgba(234,179,8,0.35)'}`,
                          fontWeight: 600,
                        }}
                      >
                        {s.votes >= MIN_VOTES_TO_PLAY ? '✅ Lejátszásra kész' : `⏳ ${s.votes}/${MIN_VOTES_TO_PLAY} szavazat`}
                      </span>
                      <a
                        href={ytSearchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="jb-link"
                        title="Keresés a YouTube-on"
                      >
                        🔍 YouTube
                      </a>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`jb-vote ${isVoted ? 'voted' : ''}`}
                    disabled={isVoted}
                    onClick={() => voteSong(s.id)}
                    title={isVoted ? 'Már szavaztál erre' : 'Szavazok erre!'}
                  >
                    <span>🔥</span>
                    <b>{s.votes}</b>
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
