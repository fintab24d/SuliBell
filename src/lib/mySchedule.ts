import { useCallback, useEffect, useState } from 'react'
import type { Lesson } from './engine'

export interface MyLessonEntry {
  subject: string
  room: string
}

/** Map: weekday ("1".."5") -> lesson position (number) -> { subject, room } */
export type MyScheduleMap = Record<string, Record<number, MyLessonEntry>>

const STORAGE_KEY = 'csengeto-my-schedule-v1'

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

  const update = useCallback((next: MyScheduleMap) => {
    setMap(next)
    saveMySchedule(next)
  }, [])

  const getEntry = useCallback((weekday: number, pos?: number): MyLessonEntry | undefined => {
    if (!pos) return undefined
    const e = map[String(weekday)]?.[pos]
    if (!e || (!e.subject.trim() && !e.room.trim())) return undefined
    return { subject: e.subject.trim(), room: e.room.trim() }
  }, [map])

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
