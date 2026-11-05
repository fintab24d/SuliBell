// Tiszta időlogika: nincs benne UI, nincs benne hálózat. Minden számítás a megadott időzónában történik.
export interface Lesson { id: string; label: string; start_time: string; end_time: string; position: number }
export interface Schedule { id: string; name: string; weekdays: number[]; is_default: boolean; lessons: Lesson[] }
export interface DayChange { id?: string; day?: string; kind: string; lesson_label: string; text?: string }
export type Phase = 'closed' | 'before' | 'lesson' | 'break' | 'after'
export interface BellState {
  phase: Phase; current?: Lesson; next?: Lesson
  remaining: number   // másodperc a következő csengetésig
  progress: number    // 0..1 az aktuális óra/szünet előrehaladása
  soon: boolean       // 60 mp-en belül csengetés
  reason?: string
}

export const toSec = (t: string) => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + (s || 0) }

const dtfCache = new Map<string, Intl.DateTimeFormat>()
function getZonedFormatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    dtfCache.set(tz, f)
  }
  return f
}

/** A pillanat dátuma, napszaka és hétköznapja az adott időzónában (a nyári/téli időszámítást az Intl kezeli). */
export function zoned(now: Date, tz: string) {
  const p = Object.fromEntries(getZonedFormatter(tz).formatToParts(now).map(x => [x.type, x.value]))
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    secs: +p.hour * 3600 + +p.minute * 60 + +p.second,
    weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1,
  }
}

/** Az adott napra érvényes rend: napra szabott, különben az alapértelmezett (csak hétköznap). */
export function pickSchedule(list: Schedule[], weekday: number) {
  return list.find(s => s.weekdays.includes(weekday)) ?? (weekday <= 5 ? list.find(s => s.is_default) : undefined)
}

/** Eldönti, hogy egy változás-bejegyzés (pl. "7. óra", "6-8. óra", "1., 2. óra") vonatkozik-e az adott tanórára. */
export function changeMatchesLesson(c: DayChange, lesson: Lesson, maxPos?: number): boolean {
  const lbl = (c.lesson_label ?? '').trim().toLowerCase()
  const txt = (c.text ?? '').trim().toLowerCase()
  const combined = `${lbl} ${c.kind === 'cancel' ? txt : ''}`
  if (!lbl && !txt) return false
  if (/\b(minden|összes|egész\s*nap)\b/i.test(combined)) return true
  if (lbl && lbl === lesson.label.trim().toLowerCase()) return true
  if (maxPos && lesson.position === maxPos && /\butolsó\b/i.test(combined)) return true
  if (lesson.position === 1 && /\belső\b/i.test(combined)) return true

  const src = lbl || txt
  const rangeRe = /(\d+)\s*\.?\s*[-–—]\s*(\d+)/g
  let rm: RegExpExecArray | null
  let matchedNum = false
  while ((rm = rangeRe.exec(src)) !== null) {
    matchedNum = true
    const a = Number(rm[1]), b = Number(rm[2])
    if (lesson.position >= Math.min(a, b) && lesson.position <= Math.max(a, b)) return true
  }

  const cleaned = src.replace(rangeRe, ' ')
  const numRe = /\b(\d+)\b/g
  let nm: RegExpExecArray | null
  while ((nm = numRe.exec(cleaned)) !== null) {
    matchedNum = true
    if (Number(nm[1]) === lesson.position) return true
  }
  return !matchedNum && false
}

/** Eldönti, hogy az adott tanóra elmarad-e a mai változások (kind === 'cancel') vagy a saját órarend alapján. */
export function isLessonCancelled(
  lesson: Lesson,
  dayChanges: DayChange[] = [],
  isMyFree?: boolean,
  maxPos?: number
): boolean {
  if (isMyFree) return true
  return dayChanges.some(c => {
    const isCancel = c.kind === 'cancel' || /\belmarad\b/i.test(c.text ?? '') || /\belmarad\b/i.test(c.lesson_label ?? '')
    return isCancel && changeMatchesLesson(c, lesson, maxPos)
  })
}

export function computeState(
  secs: number,
  lessons: Lesson[],
  closedReason?: string,
  noSchool = false,
  cancelledLessons: Lesson[] = []
): BellState {
  const L = [...lessons].sort((a, b) => a.position - b.position)
  if (closedReason || noSchool || !L.length)
    return { phase: 'closed', remaining: 0, progress: 0, soon: false, reason: closedReason ?? 'Ma nincs tanítás.' }
  const curCancelled = cancelledLessons.find(cl => secs >= toSec(cl.start_time) && secs < toSec(cl.end_time))
  const mk = (phase: Phase, from: number, to: number, o: Partial<BellState>): BellState => ({
    phase, remaining: to - secs, progress: Math.min(1, Math.max(0, (secs - from) / (to - from))),
    soon: to - secs <= 60, ...o })
  if (secs < toSec(L[0].start_time)) {
    const firstCancelledStart = cancelledLessons.length > 0 ? Math.min(...cancelledLessons.map(cl => toSec(cl.start_time))) : 0
    const fromSec = curCancelled ? firstCancelledStart : 0
    return mk('before', fromSec, toSec(L[0].start_time), {
      next: L[0],
      reason: curCancelled ? `${curCancelled.label} elmarad` : undefined,
    })
  }
  for (let i = 0; i < L.length; i++) {
    const s = toSec(L[i].start_time), e = toSec(L[i].end_time)
    if (secs >= s && secs < e) return mk('lesson', s, e, { current: L[i], next: L[i + 1] })
    const n = L[i + 1]
    if (n && secs >= e && secs < toSec(n.start_time)) {
      return mk('break', e, toSec(n.start_time), {
        next: n,
        reason: curCancelled ? `Szünet (${curCancelled.label} elmarad)` : undefined,
      })
    }
  }
  return {
    phase: 'after',
    remaining: 0,
    progress: 1,
    soon: false,
    reason: curCancelled ? `Vége a tanításnak (${curCancelled.label} elmarad)` : undefined,
  }
}

export const fmtHM = (t: string) => t.slice(0, 5)
export const fmtCount = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`
}

// ---- Következő tanítási nap (hétvégén, ünnepnapon, tanítás után) ----
const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000
export const addDays = (d: string, n: number) => new Date((dayNum(d) + n) * 86400000).toISOString().slice(0, 10)

/** A következő nap (legfeljebb 60 napon belül), amelyen van csengetési rend és nincs zárva az iskola. */
export function nextSchoolDay(today: string, schedules: Schedule[], closed: { day: string }[], overrides: Record<string, string> = {}) {
  for (let i = 1; i <= 60; i++) {
    const date = addDays(today, i)
    const weekday = ((new Date(dayNum(date) * 86400000).getUTCDay() + 6) % 7) + 1
    const schedule = scheduleFor(date, schedules, overrides)
    if (schedule && schedule.lessons.length > 0 && !closed.some(c => c.day === date)) return { date, weekday, schedule }
  }
}

/** Az adott helyi dátum+napszak valódi időpillanata (ms). Az óraátállást is helyesen kezeli. */
export function instantOf(date: string, secs: number, tz: string) {
  let t = dayNum(date) * 86400000 + secs * 1000
  for (let i = 0; i < 2; i++) { const z = zoned(new Date(t), tz); t += ((dayNum(date) - dayNum(z.date)) * 86400 + secs - z.secs) * 1000 }
  return t
}

export const weekdayOf = (d: string) => ((new Date(dayNum(d) * 86400000).getUTCDay() + 6) % 7) + 1
/** Tanítási napok száma [from, to] között (mindkét végpont beleszámít). */
export function schoolDaysBetween(from: string, to: string, schedules: Schedule[], closed: { day: string }[], overrides: Record<string, string> = {}) {
  let n = 0
  for (let d = from, i = 0; d <= to && i < 800; d = addDays(d, 1), i++) {
    const sch = scheduleFor(d, schedules, overrides)
    if (sch && sch.lessons.length > 0 && !closed.some(c => c.day === d)) n++
  }
  return n
}

/** Az adott dátum rendje: ha az adminban konkrét napra rendeltek rendet, az az erősebb; különben a hét napja szerinti. */
export function scheduleFor(date: string, schedules: Schedule[], overrides: Record<string, string> = {}) {
  const id = overrides[date]
  return (id ? schedules.find(s => s.id === id) : undefined) ?? pickSchedule(schedules, weekdayOf(date))
}
