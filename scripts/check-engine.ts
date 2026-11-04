// Futtatás: npm run check  (Node 22.6+). Az időlogikát ellenőrzi, hálózat nélkül.
import assert from 'node:assert/strict'
import { computeState, instantOf, isLessonCancelled, nextSchoolDay, pickSchedule, schoolDaysBetween, zoned, type Lesson, type Schedule } from '../src/lib/engine.ts'

const A = [['08:00','08:45'],['08:55','09:40'],['09:50','10:35'],['10:45','11:30'],['11:40','12:25'],['12:35','13:20'],['13:30','14:15'],['14:25','15:10']]
const lessons: Lesson[] = A.map(([s, e], i) => ({ id: `l${i + 1}`, label: `${i + 1}. óra`, start_time: s, end_time: e, position: i + 1 }))
const at = (iso: string, closed?: string[]) => {
  const z = zoned(new Date(iso), 'Europe/Budapest')
  const sch = pickSchedule([{ id: 's', name: 'N', weekdays: [], is_default: true, lessons }], z.weekday)
  return { z, st: computeState(z.secs, sch?.lessons ?? [], closed?.includes(z.date) ? 'Ünnepnap' : undefined, !sch) }
}
let n = 0; const ok = (name: string, f: () => void) => { f(); n++; console.log('  ok', name) }

ok('08:44:59 → óra vége előtt 1 mp, "hamarosan"', () => { const { st } = at('2026-10-05T06:44:59Z'); assert.equal(st.phase, 'lesson'); assert.equal(st.remaining, 1); assert.ok(st.soon) })
ok('08:45:00 → szünet, 10 perc', () => { const { st } = at('2026-10-05T06:45:00Z'); assert.equal(st.phase, 'break'); assert.equal(st.remaining, 600); assert.equal(st.next?.label, '2. óra') })
ok('08:55:00 → 2. óra kezdődik', () => { const { st } = at('2026-10-05T06:55:00Z'); assert.equal(st.phase, 'lesson'); assert.equal(st.current?.label, '2. óra') })
ok('tanítás előtt: 07:30 → 1800 mp', () => { const { st } = at('2026-10-05T05:30:00Z'); assert.equal(st.phase, 'before'); assert.equal(st.remaining, 1800) })
ok('tanítás után: 15:10', () => { assert.equal(at('2026-10-05T13:10:00Z').st.phase, 'after') })
ok('progress: 12:00 az 5. órában = 20/45', () => { const { st } = at('2026-10-05T10:00:00Z'); assert.equal(st.current?.label, '5. óra'); assert.ok(Math.abs(st.progress - 20 / 45) < 1e-9) })
ok('DST: nyári (CEST) és téli (CET) 08:00 ugyanaz', () => {
  assert.equal(at('2026-03-30T06:00:00Z').st.current?.label, '1. óra')   // CEST, UTC+2
  assert.equal(at('2026-10-26T07:00:00Z').st.current?.label, '1. óra')   // CET, UTC+1 (átállás után)
  assert.equal(at('2026-03-27T07:00:00Z').st.current?.label, '1. óra') })  // CET (átállás előtt)
ok('hétvége: nincs tanítás', () => { const { st } = at('2026-10-24T08:00:00Z'); assert.equal(st.phase, 'closed'); assert.equal(st.reason, 'Ma nincs tanítás.') })
ok('ünnepnap: 2026-10-23 zárva', () => { const { st } = at('2026-10-23T08:00:00Z', ['2026-10-23']); assert.equal(st.phase, 'closed'); assert.equal(st.reason, 'Ünnepnap') })
ok('napra szabott rend (péntek) elsőbbséget élvez', () => {
  const s: Schedule[] = [{ id: 'a', name: 'N', weekdays: [], is_default: true, lessons }, { id: 'b', name: 'P', weekdays: [5], is_default: false, lessons: [] }]
  assert.equal(pickSchedule(s, 5)?.id, 'b'); assert.equal(pickSchedule(s, 2)?.id, 'a'); assert.equal(pickSchedule(s, 6), undefined) })
const sch: Schedule[] = [{ id: 's', name: 'N', weekdays: [], is_default: true, lessons }]
ok('következő tanítási nap: szombatról hétfő', () => assert.equal(nextSchoolDay('2026-10-24', sch, [])?.date, '2026-10-26'))
ok('ünnepnap átugrása: hétfő zárva → kedd', () => assert.equal(nextSchoolDay('2026-10-24', sch, [{ day: '2026-10-26' }])?.date, '2026-10-27'))
ok('zárt péntek után hétfő', () => assert.equal(nextSchoolDay('2026-10-22', sch, [{ day: '2026-10-23' }])?.date, '2026-10-26'))
ok('visszaszámlálás pontos a tavaszi óraátállás fölött (42 óra)', () =>
  assert.equal(Math.round((instantOf('2026-03-30', 8 * 3600, 'Europe/Budapest') - Date.parse('2026-03-28T12:00:00Z')) / 1000), 42 * 3600))
ok('visszaszámlálás pontos az őszi óraátállás fölött (43 óra)', () =>
  assert.equal(Math.round((instantOf('2026-10-26', 8 * 3600, 'Europe/Budapest') - Date.parse('2026-10-24T12:00:00Z')) / 1000), 43 * 3600))
ok('tanítási napok száma: egy teljes hét = 5', () => assert.equal(schoolDaysBetween('2026-10-26', '2026-10-30', sch, []), 5))
ok('tanítási napok száma: ünnepnap levonva', () => assert.equal(schoolDaysBetween('2026-10-26', '2026-10-30', sch, [{ day: '2026-10-28' }]), 4))
ok('tanítási napok száma: hétvége = 0, fordított tartomány = 0', () => { assert.equal(schoolDaysBetween('2026-10-24', '2026-10-25', sch, []), 0); assert.equal(schoolDaysBetween('2026-10-26', '2026-10-25', sch, []), 0) })
ok('elmaradó 7–8. óra: 6. óra után (13:20) vége a tanításnak', () => {
  const chgs = [{ kind: 'cancel', lesson_label: '7-8. óra', text: 'Elmarad' }]
  const active = lessons.filter(l => !isLessonCancelled(l, chgs, false, 8))
  const cancelled = lessons.filter(l => isLessonCancelled(l, chgs, false, 8))
  assert.equal(active.length, 6)
  const st = computeState(13 * 3600 + 35 * 60, active, undefined, false, cancelled)
  assert.equal(st.phase, 'after')
  assert.equal(st.reason, 'Vége a tanításnak (7. óra elmarad)')
})
ok('elmaradó 2. óra: 1. óra után (08:45) egyből a 3. óráig (09:50) számol a szünet', () => {
  const chgs = [{ kind: 'cancel', lesson_label: '2. óra' }]
  const active = lessons.filter(l => !isLessonCancelled(l, chgs, false, 8))
  const cancelled = lessons.filter(l => isLessonCancelled(l, chgs, false, 8))
  const st = computeState(9 * 3600, active, undefined, false, cancelled)
  assert.equal(st.phase, 'break')
  assert.equal(st.next?.label, '3. óra')
  assert.equal(st.remaining, 50 * 60)
  assert.equal(st.reason, 'Szünet (2. óra elmarad)')
})
console.log(`TZ=${process.env.TZ ?? '(rendszer)'}: ${n} teszt OK`)
