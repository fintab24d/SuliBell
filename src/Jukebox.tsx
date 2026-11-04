import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from './lib/supabase'
import { fxSound } from './lib/sound'
import { parseVideo } from './lib/video'
import { voterId } from './Poll'

export interface SongWish {
  id: string
  title: string
  by: string
  ytId?: string
  votes: number
  at: number
}

const QUICK_SONGS: { title: string; ytId?: string }[] = [
  { title: 'Azahriah – 3korty' },
  { title: 'DESH – Kukásautó' },
  { title: 'T. Danny – Megmondtam' },
  { title: 'The Weeknd – Blinding Lights' },
  { title: 'Daft Punk – One More Time' },
  { title: 'Avicii – Levels' },
]

const STORAGE_PREFIX = 'csengeto-jukebox-'
const VOTED_PREFIX = 'csengeto-jukebox-voted-'

function loadLocalSongs(day: string): SongWish[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_PREFIX + day) ?? '[]') || []
  } catch {
    return []
  }
}

function saveLocalSongs(day: string, list: SongWish[]) {
  try {
    localStorage.setItem(STORAGE_PREFIX + day, JSON.stringify(list))
  } catch { /* ignore */ }
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
    .slice(0, 15)
}

function mergeSong(list: SongWish[], incoming: SongWish): SongWish[] {
  const norm = incoming.title.trim().toLowerCase()
  const idx = list.findIndex(x => x.id === incoming.id || x.title.trim().toLowerCase() === norm)
  if (idx >= 0) {
    const cur = list[idx]
    const updated: SongWish = {
      ...cur,
      votes: Math.max(cur.votes, incoming.votes),
      ytId: cur.ytId || incoming.ytId,
      by: cur.by || incoming.by,
    }
    const next = [...list]
    next[idx] = updated
    return sortSongs(next)
  }
  return sortSongs([...list, incoming])
}

export function useJukebox(schoolId: string | undefined, day: string, sound?: boolean) {
  const [songs, setSongs] = useState<SongWish[]>(() => loadLocalSongs(day))
  const [voted, setVoted] = useState<Set<string>>(() => loadVotedSet(day))
  const chanRef = useRef<any>(null)
  const bcRef = useRef<BroadcastChannel | null>(null)
  const soundRef = useRef(sound)
  soundRef.current = sound

  useEffect(() => {
    setSongs(loadLocalSongs(day))
    setVoted(loadVotedSet(day))
  }, [day])

  useEffect(() => {
    if (!schoolId || !day) return
    let alive = true

    // Opcionális DB lekérés (update17.sql)
    supabase.rpc('get_jukebox_songs', { p_school: schoolId, p_day: day }).then(({ data, error }: any) => {
      if (!alive || error || !Array.isArray(data)) return
      setSongs(prev => {
        let next = [...prev]
        for (const r of data) {
          next = mergeSong(next, {
            id: String(r.song_id),
            title: String(r.title),
            by: String(r.requester ?? ''),
            ytId: r.yt_id ? String(r.yt_id) : undefined,
            votes: Number(r.votes) || 1,
            at: Date.parse(r.created_at) || Date.now(),
          })
        }
        saveLocalSongs(day, next)
        return next
      })
    })

    // Realtime csatorna
    const ch = supabase.channel(`sulibell-jukebox-${schoolId}`, {
      config: { broadcast: { self: false } },
    })
    ch.on('broadcast', { event: 'song' }, (msg: any) => {
      const payload = msg?.payload
      if (!alive || !payload?.song) return
      setSongs(prev => {
        const next = mergeSong(prev, payload.song as SongWish)
        saveLocalSongs(day, next)
        return next
      })
    }).subscribe()
    chanRef.current = ch

    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel(`sulibell-jukebox-${schoolId}`)
      bc.onmessage = ev => {
        if (!alive || !ev.data?.song) return
        setSongs(prev => {
          const next = mergeSong(prev, ev.data.song as SongWish)
          saveLocalSongs(day, next)
          return next
        })
      }
      bcRef.current = bc
    } catch { /* ignore */ }

    return () => {
      alive = false
      supabase.removeChannel(ch)
      chanRef.current = null
      try { bc?.close() } catch { /* ignore */ }
      bcRef.current = null
    }
  }, [schoolId, day])

  const broadcastSong = useCallback((song: SongWish) => {
    chanRef.current?.send({
      type: 'broadcast',
      event: 'song',
      payload: { song },
    }).catch?.(() => {})
    try { bcRef.current?.postMessage({ song }) } catch { /* ignore */ }
  }, [])

  const addSong = useCallback((rawTitle: string, rawBy: string, rawUrl?: string) => {
    const cleanTitle = rawTitle.trim().slice(0, 60)
    if (!cleanTitle) return
    const cleanBy = rawBy.trim().slice(0, 24)
    const parsed = rawUrl ? parseVideo(rawUrl) : parseVideo(rawTitle)
    const ytId = parsed?.kind === 'yt' ? parsed.id : undefined

    const existing = songs.find(x => x.title.trim().toLowerCase() === cleanTitle.toLowerCase())
    const created: SongWish = existing
      ? { ...existing, votes: existing.votes + 1, ytId: existing.ytId || ytId, by: existing.by || cleanBy }
      : {
          id: 'sg-' + Math.random().toString(36).slice(2, 10),
          title: cleanTitle,
          by: cleanBy,
          ytId,
          votes: 1,
          at: Date.now(),
        }

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
  }, [schoolId, day, songs, broadcastSong])

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

  return { songs, voted, addSong, voteSong }
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
  const { songs, voted, addSong, voteSong } = useJukebox(schoolId, day, sound)
  const [title, setTitle] = useState('')
  const [by, setBy] = useState(() => {
    try { return localStorage.getItem('csengeto-arena-name') ?? '' } catch { return '' }
  })
  const [ytUrl, setYtUrl] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    if (by.trim()) {
      try { localStorage.setItem('csengeto-arena-name', by.trim()) } catch { /* ignore */ }
    }
    addSong(title, by, ytUrl)
    setTitle('')
    setYtUrl('')
    setShowForm(false)
  }

  // TV nézet: kompakt Top 3 Kívánságlista kártya
  if (tv) {
    if (songs.length === 0) return null
    const top3 = songs.slice(0, 3)
    return (
      <section className="panel jukebox-tv">
        <div className="tag" style={{ marginBottom: 4 }}>🎵 Szüneti Zenegép — Kívánságlista</div>
        <ol className="jb-list tv-jb">
          {top3.map((s, i) => (
            <li key={s.id} className={i === 0 ? 'lead' : ''}>
              <span className="jb-rk">{i === 0 ? '👑' : `${i + 1}.`}</span>
              <div className="jb-info">
                <b>{s.title}</b>
                {s.by && <small>küldi: {s.by}</small>}
              </div>
              <span className="jb-votes">🔥 {s.votes}</span>
            </li>
          ))}
        </ol>
      </section>
    )
  }

  return (
    <section className="panel jukebox">
      <div className="jb-head">
        <div>
          <div className="tag" style={{ marginBottom: 4 }}>🎵 Szüneti Zenegép & Kívánságlista</div>
          <p className="meta" style={{ margin: 0 }}>
            Küldd be a kedvenc számodat a szünetre, vagy szavazz a listán szereplő zenékre!
          </p>
        </div>
        <button type="button" className={showForm ? 'on' : 'cta'} onClick={() => setShowForm(v => !v)}>
          {showForm ? '✕ Bezárás' : '➕ Zene beküldése'}
        </button>
      </div>

      {showForm && (
        <form className="jb-form" onSubmit={submit}>
          <div className="jb-quick">
            <small>Gyors tippek:</small>
            <div className="jb-chips">
              {QUICK_SONGS.map(q => (
                <button
                  key={q.title}
                  type="button"
                  className="qchip"
                  onClick={() => setTitle(q.title)}
                >
                  🎵 {q.title}
                </button>
              ))}
            </div>
          </div>

          <div className="jb-inputs">
            <input
              type="text"
              placeholder="Előadó – Szám címe (pl. Azahriah – 3korty) *"
              maxLength={60}
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
            <div className="jb-row2">
              <input
                type="text"
                placeholder="Ki küldi? (pl. 10.B / Dani)"
                maxLength={24}
                value={by}
                onChange={e => setBy(e.target.value)}
              />
              <input
                type="url"
                placeholder="YouTube link (opcionális)"
                value={ytUrl}
                onChange={e => setYtUrl(e.target.value)}
              />
              <button type="submit" className="cta" disabled={!title.trim()}>
                🚀 Beküldés
              </button>
            </div>
          </div>
        </form>
      )}

      {songs.length === 0 ? (
        <div className="jb-empty">
          <span>🎧 Még nincs mai kívánság. Legyél te az első, aki bedob egy számot a szünetre!</span>
        </div>
      ) : (
        <ol className="jb-list">
          {songs.slice(0, 8).map((s, i) => {
            const isVoted = voted.has(s.id)
            const isPlaying = playingId === s.id
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
                      {s.ytId ? (
                        <button
                          type="button"
                          className="jb-link"
                          onClick={() => setPlayingId(isPlaying ? null : s.id)}
                        >
                          {isPlaying ? '⏹ Elrejtés' : '▶ Lejátszás'}
                        </button>
                      ) : (
                        <a
                          href={ytSearchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="jb-link"
                        >
                          🔍 YouTube
                        </a>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`jb-vote ${isVoted ? 'voted' : ''}`}
                    disabled={isVoted}
                    onClick={() => voteSong(s.id)}
                    title={isVoted ? 'Már szavaztál erre' : 'Szavazok erre a számra!'}
                  >
                    <span>🔥</span>
                    <b>{s.votes}</b>
                  </button>
                </div>

                {isPlaying && s.ytId && (
                  <div className="jb-player">
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${s.ytId}?autoplay=1&rel=0`}
                      title={s.title}
                      allow="autoplay; encrypted-media; picture-in-picture"
                      sandbox="allow-scripts allow-same-origin allow-presentation"
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
