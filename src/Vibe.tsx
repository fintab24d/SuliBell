import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { supabase } from './lib/supabase'
import { fxSound } from './lib/sound'

export interface VibeItem {
  id: string
  emoji: string
  label: string
  color: string
}

export const VIBES: VibeItem[] = [
  { id: 'fire', emoji: '🔥', label: 'Pörgés', color: '#ff4fc3' },
  { id: 'party', emoji: '🎉', label: 'Szünet!', color: '#39ff7a' },
  { id: 'sleep', emoji: '😴', label: 'Álmos', color: '#8a5cff' },
  { id: 'mind', emoji: '🤯', label: 'Kemény', color: '#ffb02e' },
  { id: 'coffee', emoji: '☕', label: 'Kávét!', color: '#2de2ff' },
  { id: 'love', emoji: '❤️', label: 'Szuper', color: '#ff4f6a' },
]

interface FloatEmoji {
  uid: number
  emoji: string
  color: string
  x: number
  drift: number
  size: number
  dur: number
}

const STORAGE_PREFIX = 'csengeto-vibe-'

function loadLocalCounts(day: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_PREFIX + day) ?? '{}') || {}
  } catch {
    return {}
  }
}

function saveLocalCounts(day: string, c: Record<string, number>) {
  try {
    localStorage.setItem(STORAGE_PREFIX + day, JSON.stringify(c))
  } catch { /* ignore */ }
}

/** Élő emoji-eső és iskolai hangulat-szinkronizáció (Supabase Realtime + BroadcastChannel + opcionális DB). */
export function useVibe(schoolId: string | undefined, day: string, sound?: boolean) {
  const [counts, setCounts] = useState<Record<string, number>>(() => loadLocalCounts(day))
  const [floats, setFloats] = useState<FloatEmoji[]>([])
  const [cooldown, setCooldown] = useState(false)
  const chanRef = useRef<any>(null)
  const bcRef = useRef<BroadcastChannel | null>(null)
  const uidRef = useRef(1)
  const soundRef = useRef(sound)
  soundRef.current = sound

  useEffect(() => {
    setCounts(loadLocalCounts(day))
  }, [day])

  const spawnEmoji = useCallback((vibeId: string, burst = 1) => {
    const v = VIBES.find(x => x.id === vibeId) ?? VIBES[0]
    const added: FloatEmoji[] = Array.from({ length: burst }, (_, i) => ({
      uid: uidRef.current++,
      emoji: v.emoji,
      color: v.color,
      x: 12 + Math.random() * 76,
      drift: (Math.random() - 0.5) * 90,
      size: 1.9 + Math.random() * 1.1 + (burst > 1 && i === 0 ? 0.5 : 0),
      dur: 2.6 + Math.random() * 1.2,
    }))
    setFloats(prev => [...prev.slice(-28), ...added])
    if (soundRef.current) fxSound('pop', (added[0].x - 50) / 50)
  }, [])

  // Elhalt lebegő emojik takarítása
  useEffect(() => {
    if (!floats.length) return
    const t = setTimeout(() => {
      setFloats(prev => prev.slice(Math.min(prev.length, 3)))
    }, 3200)
    return () => clearTimeout(t)
  }, [floats])

  // Opcionális DB lekérdezés + Realtime csatorna
  useEffect(() => {
    if (!schoolId || !day) return
    let alive = true

    // Napi összesítés lekérése induláskor, 25 mp-enként és ablakváltáskor
    const loadDb = async (force = false) => {
      if (!force && document.hidden) return
      const { data, error } = await supabase.rpc('get_vibe_counts', { p_school: schoolId, p_day: day })
      if (!alive || error || !data) return
      const dbMap: Record<string, number> = {}
      for (const row of data as { vibe: string; cnt: number }[]) dbMap[row.vibe] = row.cnt
      setCounts(prev => {
        const merged = { ...prev }
        for (const k of Object.keys(dbMap)) merged[k] = Math.max(merged[k] ?? 0, dbMap[k])
        saveLocalCounts(day, merged)
        return merged
      })
    }
    loadDb(true)
    const pollTimer = window.setInterval(() => loadDb(false), 25_000)
    const onWake = () => { if (!document.hidden) loadDb(true) }
    const onRefresh = () => { loadDb(true) }
    window.addEventListener('sulibell:refresh', onRefresh)
    document.addEventListener('visibilitychange', onWake)
    document.addEventListener('resume', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('pageshow', onWake)

    // Supabase Realtime Broadcast csatorna (minden eszköz és a TV között élőben)
    const ch = supabase.channel(`sulibell-vibe-${schoolId}`, {
      config: { broadcast: { self: false } },
    })
    ch.on('broadcast', { event: 'react' }, (msg: any) => {
      const payload = msg?.payload
      if (!alive || !payload?.vibe) return
      spawnEmoji(payload.vibe, 2)
      setCounts(prev => {
        const next = { ...prev, [payload.vibe]: (prev[payload.vibe] ?? 0) + 1 }
        saveLocalCounts(day, next)
        return next
      })
    }).subscribe()
    chanRef.current = ch

    // Helyi BroadcastChannel (azonnali szinkron ugyanazon a gépen megnyitott fülek, pl. / és /display között)
    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel(`sulibell-vibe-${schoolId}`)
      bc.onmessage = ev => {
        if (!alive || !ev.data?.vibe) return
        spawnEmoji(ev.data.vibe, 2)
        setCounts(prev => {
          const next = { ...prev, [ev.data.vibe]: (prev[ev.data.vibe] ?? 0) + 1 }
          saveLocalCounts(day, next)
          return next
        })
      }
      bcRef.current = bc
    } catch { /* ignore */ }

    return () => {
      alive = false
      clearInterval(pollTimer)
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
  }, [schoolId, day, spawnEmoji])

  const sendVibe = (vibeId: string) => {
    if (cooldown) return
    setCooldown(true)
    setTimeout(() => setCooldown(false), 750)

    spawnEmoji(vibeId, 3)
    setCounts(prev => {
      const next = { ...prev, [vibeId]: (prev[vibeId] ?? 0) + 1 }
      saveLocalCounts(day, next)
      return next
    })

    // Küldés élőben a többi diáknak és a TV-nek
    chanRef.current?.send({
      type: 'broadcast',
      event: 'react',
      payload: { vibe: vibeId, t: Date.now() },
    }).catch?.(() => {})
    try { bcRef.current?.postMessage({ vibe: vibeId, t: Date.now() }) } catch { /* ignore */ }

    // Opcionális DB mentés (ha az update17.sql aktív)
    if (schoolId) {
      supabase.rpc('add_vibe', { p_school: schoolId, p_day: day, p_vibe: vibeId }).then(() => {})
    }
  }

  return { counts, floats, sendVibe, cooldown }
}

/** Lebegő emoji-eső réteg a képernyőn (főoldalon és TV-n is) */
export function VibeOverlay({ floats }: { floats: FloatEmoji[] }) {
  if (!floats.length) return null
  return (
    <div className="vibe-sky" aria-hidden="true">
      {floats.map(f => (
        <span
          key={f.uid}
          className="vibe-fly"
          style={{
            left: `${f.x}%`,
            '--drift': `${f.drift}px`,
            '--sz': `${f.size}rem`,
            '--dur': `${f.dur}s`,
            '--vc': f.color,
          } as CSSProperties}
        >
          {f.emoji}
        </span>
      ))}
    </div>
  )
}

/** Interaktív Hangulat- és Reakciófal panel */
export function VibePanel({
  counts,
  onSend,
  cooldown,
  tv,
}: {
  counts: Record<string, number>
  onSend: (id: string) => void
  cooldown: boolean
  tv?: boolean
}) {
  const total = VIBES.reduce((acc, v) => acc + (counts[v.id] ?? 0), 0)
  const topVibe = total > 0
    ? [...VIBES].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))[0]
    : null
  const topPct = topVibe && total > 0 ? Math.round(((counts[topVibe.id] ?? 0) / total) * 100) : 0

  if (tv) {
    if (total === 0) return null
    return (
      <section className="panel vibe-tv">
        <div className="vibe-tv-row">
          <div className="tag" style={{ margin: 0 }}>Élő iskolai hangulat</div>
          {topVibe && (
            <span className="vibe-topbadge" style={{ '--vc': topVibe.color } as CSSProperties}>
              {topVibe.emoji} {topVibe.label} ({topPct}%) • {total} reakció ma
            </span>
          )}
        </div>
        <div className="vibe-meter">
          {VIBES.map(v => {
            const c = counts[v.id] ?? 0
            if (!c) return null
            return (
              <i
                key={v.id}
                style={{ width: `${(c / total) * 100}%`, background: v.color }}
                title={`${v.label}: ${c}`}
              />
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <section className="panel full vibe-panel">
      <div className="vibe-head">
        <div>
          <div className="tag" style={{ marginBottom: 4 }}>Élő Hangulat- és Reakciófal</div>
          <p className="meta" style={{ margin: 0 }}>
            Küldj egy reakciót – élőben felrepül mindenkinél és a folyosói TV-n is!
          </p>
        </div>
        {topVibe && (
          <div className="vibe-dom" style={{ '--vc': topVibe.color } as CSSProperties}>
            <span>Mostani hangulat:</span>
            <b>{topVibe.emoji} {topVibe.label} ({topPct}%)</b>
          </div>
        )}
      </div>

      <div className="vibe-btns">
        {VIBES.map(v => {
          const cnt = counts[v.id] ?? 0
          return (
            <button
              key={v.id}
              type="button"
              disabled={cooldown}
              className="vibe-btn"
              style={{ '--vc': v.color } as CSSProperties}
              onClick={() => onSend(v.id)}
            >
              <span className="vibe-emo" aria-hidden="true">{v.emoji}</span>
              <span className="vibe-lbl">{v.label}</span>
              <b className="vibe-cnt">{cnt}</b>
            </button>
          )
        })}
      </div>

      {total > 0 && (
        <div className="vibe-meter" aria-label="Mai hangulat megoszlása">
          {VIBES.map(v => {
            const c = counts[v.id] ?? 0
            if (!c) return null
            return (
              <i
                key={v.id}
                style={{ width: `${(c / total) * 100}%`, background: v.color }}
                title={`${v.label}: ${c}`}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
