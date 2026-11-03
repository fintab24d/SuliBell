import { useEffect, useState } from 'react'
import type { Lesson } from './lib/engine'

export interface MyLessonEntry {
  subject: string
  room: string
}

/** Map: weekday ("1".."5") -> lesson position (number) -> { subject, room } */
export type MyScheduleMap = Record<string, Record<number, MyLessonEntry>>

const STORAGE_KEY = 'csengeto-my-schedule-v1'

const DAYS: { id: number; name: string; short: string }[] = [
  { id: 1, name: 'Hétfő', short: 'H' },
  { id: 2, name: 'Kedd', short: 'K' },
  { id: 3, name: 'Szerda', short: 'Sze' },
  { id: 4, name: 'Csütörtök', short: 'Cs' },
  { id: 5, name: 'Péntek', short: 'P' },
]

const QUICK_SUBJECTS = [
  'Matek', 'Magyar', 'Töri', 'Angol', 'Német', 'Info',
  'Fizika', 'Kémia', 'Biosz', 'Föci', 'Tesi', 'Lyukasóra',
]

export function loadMySchedule(): MyScheduleMap {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') || {}
  } catch {
    return {}
  }
}

export function saveMySchedule(map: MyScheduleMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    window.dispatchEvent(new Event('sulibell:myschedule'))
  } catch { /* ignore */ }
}

export function useMySchedule() {
  const [map, setMap] = useState<MyScheduleMap>(loadMySchedule)

  useEffect(() => {
    const sync = () => setMap(loadMySchedule())
    window.addEventListener('sulibell:myschedule', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('sulibell:myschedule', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const update = (next: MyScheduleMap) => {
    setMap(next)
    saveMySchedule(next)
  }

  const getEntry = (weekday: number, pos?: number): MyLessonEntry | undefined => {
    if (!pos) return undefined
    const e = map[String(weekday)]?.[pos]
    if (!e || (!e.subject.trim() && !e.room.trim())) return undefined
    return { subject: e.subject.trim(), room: e.room.trim() }
  }

  const hasAny = Object.values(map).some(d =>
    Object.values(d ?? {}).some(e => e?.subject?.trim() || e?.room?.trim())
  )

  return { map, update, getEntry, hasAny }
}

/** Formázott cím a saját órarenddel kiegészítve */
export function formatMyLesson(lesson: Lesson | undefined, entry: MyLessonEntry | undefined): {
  title: string
  sub?: string
  room?: string
  isFree?: boolean
} {
  if (!lesson) return { title: '' }
  if (!entry || !entry.subject) {
    return { title: lesson.label, room: entry?.room || undefined }
  }
  const isFree = /lyukas/i.test(entry.subject)
  return {
    title: entry.subject,
    sub: lesson.label,
    room: entry.room || undefined,
    isFree,
  }
}

export function MyScheduleModal({
  open,
  onClose,
  lessons,
  defaultWeekday,
  map,
  onSave,
}: {
  open: boolean
  onClose: () => void
  lessons: Lesson[]
  defaultWeekday: number
  map: MyScheduleMap
  onSave: (m: MyScheduleMap) => void
}) {
  const initialDay = defaultWeekday >= 1 && defaultWeekday <= 5 ? defaultWeekday : 1
  const [day, setDay] = useState<number>(initialDay)
  const [draft, setDraft] = useState<MyScheduleMap>(map)
  const [activePos, setActivePos] = useState<number>(1)

  useEffect(() => {
    if (open) {
      setDraft(map)
      const d = defaultWeekday >= 1 && defaultWeekday <= 5 ? defaultWeekday : 1
      setDay(d)
      setActivePos(lessons[0]?.position ?? 1)
    }
  }, [open, map, defaultWeekday])

  if (!open) return null

  const slots = lessons.length > 0
    ? [...lessons].sort((a, b) => a.position - b.position)
    : Array.from({ length: 8 }, (_, i) => ({ id: String(i + 1), position: i + 1, label: `${i + 1}. óra`, start_time: '', end_time: '' }))

  const dayMap = draft[String(day)] ?? {}

  const setSlot = (pos: number, field: 'subject' | 'room', val: string) => {
    const cur = dayMap[pos] ?? { subject: '', room: '' }
    const nextDay = { ...dayMap, [pos]: { ...cur, [field]: val } }
    setDraft({ ...draft, [String(day)]: nextDay })
  }

  const pickQuick = (subj: string) => {
    setSlot(activePos, 'subject', subj)
    // Automatikusan lépjen a következő órára a villámgyors kitöltéshez
    const idx = slots.findIndex(s => s.position === activePos)
    if (idx >= 0 && idx + 1 < slots.length) {
      setActivePos(slots[idx + 1].position)
    }
  }

  const clearDay = () => {
    const next = { ...draft }
    delete next[String(day)]
    setDraft(next)
  }

  const saveAndClose = () => {
    onSave(draft)
    onClose()
  }

  return (
    <div className="mymodal-bg" role="dialog" aria-modal="true" aria-label="Saját órarend beállítása" onClick={e => { if (e.target === e.currentTarget) saveAndClose() }}>
      <div className="panel mymodal">
        <div className="mymodal-head">
          <div>
            <div className="tag" style={{ marginBottom: 4 }}>Személyes órarend</div>
            <h2>📚 Saját tantárgyaim és termeim</h2>
          </div>
          <button onClick={saveAndClose} title="Mentés és bezárás">✕</button>
        </div>
        <p className="meta">
          Írd be vagy válaszd ki egy érintéssel az óráidat! Csak a saját eszközödön tároljuk, és a számláló automatikusan a te tantárgyadat és termedet mutatja.
        </p>

        <div className="mydays" role="tablist">
          {DAYS.map(d => {
            const count = Object.values(draft[String(d.id)] ?? {}).filter(x => x?.subject?.trim()).length
            return (
              <button
                key={d.id}
                role="tab"
                aria-selected={day === d.id}
                className={day === d.id ? 'on' : ''}
                onClick={() => { setDay(d.id); setActivePos(slots[0]?.position ?? 1) }}
              >
                <span>{d.name}</span>
                {count > 0 && <small className="mybadge">{count}</small>}
              </button>
            )
          })}
        </div>

        <div className="myquick">
          <small>Gyorsválasztó ({activePos}. órához):</small>
          <div className="mychips">
            {QUICK_SUBJECTS.map(subj => (
              <button key={subj} type="button" className="qchip" onClick={() => pickQuick(subj)}>
                {subj === 'Lyukasóra' ? '☕ Lyukasóra' : subj}
              </button>
            ))}
          </div>
        </div>

        <div className="myslots">
          {slots.map(s => {
            const entry = dayMap[s.position] ?? { subject: '', room: '' }
            const isSel = activePos === s.position
            return (
              <div
                key={s.position}
                className={`myslot ${isSel ? 'sel' : ''}`}
                onClick={() => setActivePos(s.position)}
              >
                <b className="myslot-lbl">{s.label}</b>
                <input
                  type="text"
                  placeholder="Tantárgy (pl. Matek)"
                  maxLength={32}
                  value={entry.subject}
                  onFocus={() => setActivePos(s.position)}
                  onChange={e => setSlot(s.position, 'subject', e.target.value)}
                />
                <input
                  type="text"
                  className="myslot-room"
                  placeholder="Terem (pl. 204)"
                  maxLength={16}
                  value={entry.room}
                  onFocus={() => setActivePos(s.position)}
                  onChange={e => setSlot(s.position, 'room', e.target.value)}
                />
                {(entry.subject || entry.room) && (
                  <button
                    type="button"
                    className="myslot-del"
                    title="Törlés"
                    onClick={e => {
                      e.stopPropagation()
                      const nextDay = { ...dayMap }
                      delete nextDay[s.position]
                      setDraft({ ...draft, [String(day)]: nextDay })
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="mymodal-foot">
          <button type="button" onClick={clearDay}>Nap ürítése</button>
          <button type="button" className="cta" onClick={saveAndClose}>✓ Mentés és kész</button>
        </div>
      </div>
    </div>
  )
}
