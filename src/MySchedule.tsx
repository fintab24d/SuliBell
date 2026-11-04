import { useEffect, useState } from 'react'
import type { Lesson } from './lib/engine'
import { supabase } from './lib/supabase'

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
  'Fizika', 'Kémia', 'Biosz', 'Föci', 'Tesi', '☕ Lyukasóra', '🚫 Elmarad',
]

/** Kép átméretezése és tömörítése base64 formátumba az AI felismeréshez (mint az AdminAi-ban). */
function compressImage(file: File): Promise<{ mime: string; data: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const max = 1400
      let w = img.width, h = img.height
      if (w > max || h > max) {
        if (w > h) { h = Math.round((h * max) / w); w = max }
        else { w = Math.round((w * max) / h); h = max }
      }
      const cv = document.createElement('canvas')
      cv.width = w; cv.height = h
      cv.getContext('2d')!.drawImage(img, 0, 0, w, h)
      const dataUrl = cv.toDataURL('image/jpeg', 0.82)
      resolve({ mime: 'image/jpeg', data: dataUrl.split(',')[1] })
      URL.revokeObjectURL(img.src)
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

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
  const isFree = /(lyukas|elmarad|nincs\s*óra|szabad)/i.test(entry.subject)
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

  // AI Kép / Kréta képernyőkép importáló állapotok
  const [aiFiles, setAiFiles] = useState<File[]>([])
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState('')

  useEffect(() => {
    if (open) {
      setDraft(map)
      const d = defaultWeekday >= 1 && defaultWeekday <= 5 ? defaultWeekday : 1
      setDay(d)
      setActivePos(lessons[0]?.position ?? 1)
      setAiMsg('')
      setAiFiles([])
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
    const idx = slots.findIndex(s => s.position === activePos)
    if (idx >= 0 && idx + 1 < slots.length) {
      setActivePos(slots[idx + 1].position)
    }
  }

  const runAiImport = async () => {
    if ((!aiFiles.length && !aiPrompt.trim()) || aiBusy) return
    setAiBusy(true)
    setAiMsg('⏳ Kép elemzése és órák kiolvasása...')
    try {
      const images = await Promise.all(aiFiles.slice(0, 5).map(compressImage))
      const { data, error } = await supabase.functions.invoke('ask', {
        body: {
          mode: 'timetable',
          images,
          prompt: aiPrompt.trim(),
          default_weekday: day,
        },
      })
      if (error || data?.error) {
        let msg = data?.error || error?.message || 'Ismeretlen hiba'
        try {
          const j = await (error as any)?.context?.json?.()
          if (j?.error) msg = j.error
        } catch { /* ignore */ }
        setAiMsg('❌ Hiba: ' + msg)
      } else if (Array.isArray(data?.days) && data.days.length > 0) {
        const next: MyScheduleMap = { ...draft }
        let total = 0
        for (const dItem of data.days) {
          const w = Number(dItem.weekday)
          if (w < 1 || w > 5 || !Array.isArray(dItem.lessons)) continue
          const dMap: Record<number, MyLessonEntry> = { ...(next[String(w)] ?? {}) }
          for (const lItem of dItem.lessons) {
            const pos = Number(lItem.position)
            const subject = String(lItem.subject ?? '').trim().slice(0, 32)
            const room = String(lItem.room ?? '').trim().slice(0, 16)
            if (pos >= 1 && pos <= 12 && (subject || room)) {
              dMap[pos] = { subject, room }
              total++
            }
          }
          next[String(w)] = dMap
        }
        setDraft(next)
        onSave(next)
        setAiFiles([])
        setAiPrompt('')
        const firstDay = Number(data.days[0]?.weekday)
        if (firstDay >= 1 && firstDay <= 5) setDay(firstDay)
        setAiMsg(`✅ ${data.summary || `${total} óra sikeresen beolvasva és elmentve!`}`)
      } else {
        setAiMsg('⚠️ Nem sikerült órákat találni a képen. Próbálj élesebb képernyőképet!')
      }
    } catch (err) {
      setAiMsg('❌ Hiba történt: ' + String(err))
    } finally {
      setAiBusy(false)
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

        <div className="my-ai-box">
          <div className="my-ai-top">
            <b>✨ Automatikus kitöltés Kréta képernyőképből / fotóból (AI)</b>
            <small>Tölts fel 1–5 képernyőképet a Kréta / Filc órarendedről (vagy fotót a papír órarendről), és az AI másodpercek alatt kitölti a napjaidat!</small>
          </div>
          <div className="my-ai-row">
            <label className="btn">
              📷 {aiFiles.length ? `${aiFiles.length} kép kiválasztva` : 'Kép kiválasztása'}
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={e => setAiFiles(Array.from(e.target.files ?? []).slice(0, 5))}
              />
            </label>
            {aiFiles.length > 0 && (
              <button type="button" onClick={() => setAiFiles([])} title="Képek törlése">✕</button>
            )}
            <input
              type="text"
              className="my-ai-inp"
              placeholder="Vagy írd le (pl. Hétfő 1. Matek 204, 2. Töri 108)..."
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
            />
            <button
              type="button"
              className="cta"
              disabled={aiBusy || (!aiFiles.length && !aiPrompt.trim())}
              onClick={runAiImport}
            >
              {aiBusy ? '⏳ Beolvasás...' : '✨ Beolvasás'}
            </button>
          </div>
          {aiMsg && <p className="my-ai-msg" role="status">{aiMsg}</p>}
        </div>

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
                {subj}
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
