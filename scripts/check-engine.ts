// Futtatás: npm run check  (Node 22.6+). Az időlogikát ellenőrzi, hálózat nélkül.
import assert from 'node:assert/strict'
import { computeState, instantOf, isLessonCancelled, nextSchoolDay, pickSchedule, schoolDaysBetween, zoned, type Lesson, type Schedule } from '../src/lib/engine.ts'
import { buildMusicWindows, computeMusicTimeline, type SyncTrack, type SyncWish } from '../src/lib/musicSync.ts'
import { computeChampions, getChampionBounds, type ChampionScoreRow } from '../src/lib/champions.ts'

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

ok('musicSync: ablakok generálása 8 és 6 órás rendből', () => {
  const fullWin = buildMusicWindows(lessons)
  assert.equal(fullWin.length, 8) // m + b1..b7, nincs a (15:10 > 15:00)
  assert.equal(fullWin[0].key, 'm')
  assert.equal(fullWin[0].start, 7 * 3600 + 45 * 60)
  assert.equal(fullWin[0].end, 8 * 3600)
  assert.equal(fullWin[7].key, 'b7')
  const shortWin = buildMusicWindows(lessons.slice(0, 6)) // vége: 13:20
  assert.equal(shortWin[shortWin.length - 1].key, 'a')
  assert.equal(shortWin[shortWin.length - 1].start, 13 * 3600 + 20 * 60)
  assert.equal(shortWin[shortWin.length - 1].end, 15 * 3600)
})

const testRadio: SyncTrack[] = [
  { id: 'r1', title: 'Rádió 1', ytId: 'aaaaaaaaaa1', dur: 200 },
  { id: 'r2', title: 'Rádió 2', ytId: 'aaaaaaaaaa2', dur: 200 },
  { id: 'r3', title: 'Rádió 3', ytId: 'aaaaaaaaaa3', dur: 200 },
]

ok('musicSync: rádió kitölti az ablakot és pontos az offset', () => {
  const win = buildMusicWindows(lessons)
  const tl = computeMusicTimeline({ windows: win, wishes: [], radio: testRadio, nowSec: 7 * 3600 + 45 * 60 + 250 })
  assert.equal(tl.current?.kind, 'radio')
  assert.equal(tl.current?.track.id, 'r2')
  assert.equal(tl.current?.offset, 50)
})

ok('musicSync: szünet közben érkező kívánság a futó rádiószám után indul', () => {
  const win = buildMusicWindows(lessons)
  // Szünet 1 (b1): 08:45:00 - 08:55:00 (600 mp). Reggeli 15 perc (900 mp) = 4.5 rádiószám (4*200 + 100), így b1-ben r3 (k=5 -> k%3 = 2) indul 08:45-kor 200 mp-re -> 08:48:20.
  const wish: SyncWish = { id: 'w1', title: 'Wish 1', ytId: 'bbbbbbbbbb1', atSec: 8 * 3600 + 46 * 60, dur: 180 }
  const atRadio = computeMusicTimeline({ windows: win, wishes: [wish], radio: testRadio, nowSec: 8 * 3600 + 46 * 60 + 30 })
  assert.equal(atRadio.current?.kind, 'radio') // nem szakítja félbe
  const atWish = computeMusicTimeline({ windows: win, wishes: [wish], radio: testRadio, nowSec: 8 * 3600 + 45 * 60 + 210 })
  assert.equal(atWish.current?.kind, 'wish')
  assert.equal(atWish.current?.wishId, 'w1')
  assert.equal(atWish.current?.offset, 10)
})

ok('musicSync: 90 mp alatti maradék időben nem indul kívánság, következő ablakba csúszik', () => {
  const winCustom = [
    { key: 'b1', start: 0, end: 280 }, // 200 mp rádió + 80 mp maradt (< 90 mp)
    { key: 'b2', start: 3000, end: 3600 },
  ]
  const wish: SyncWish = { id: 'w1', title: 'Wish 1', ytId: 'bbbbbbbbbb1', atSec: 150, dur: 180 }
  const tlB1 = computeMusicTimeline({ windows: winCustom, wishes: [wish], radio: testRadio, nowSec: 210 })
  assert.equal(tlB1.current?.kind, 'radio')
  assert.equal(tlB1.startedWishIds.has('w1'), false)
  const tlB2 = computeMusicTimeline({ windows: winCustom, wishes: [wish], radio: testRadio, nowSec: 3010 })
  assert.equal(tlB2.current?.kind, 'wish')
  assert.equal(tlB2.current?.wishId, 'w1')
  assert.equal(tlB2.current?.offset, 10)
})

ok('musicSync: törölt kívánság helyén filler szól, későbbi slotok nem tolódnak', () => {
  const win = [{ key: 'b1', start: 0, end: 1000 }]
  const w1Active: SyncWish = { id: 'w1', title: 'W1', ytId: 'bbbbbbbbbb1', atSec: 0, dur: 180 }
  const w1Removed: SyncWish = { ...w1Active, removed: true }
  const w2: SyncWish = { id: 'w2', title: 'W2', ytId: 'bbbbbbbbbb2', atSec: 50, dur: 150 }

  const tl1Active = computeMusicTimeline({ windows: win, wishes: [w1Active, w2], radio: testRadio, nowSec: 10 })
  const tl1Removed = computeMusicTimeline({ windows: win, wishes: [w1Removed, w2], radio: testRadio, nowSec: 10 })
  assert.equal(tl1Active.current?.kind, 'wish')
  assert.equal(tl1Removed.current?.kind, 'filler')
  assert.equal(tl1Removed.current?.start, tl1Active.current?.start)
  assert.equal(tl1Removed.current?.end, tl1Active.current?.end)

  // W2 azután ugyanabban az időben és k=0 értékkel indul
  const tl2Active = computeMusicTimeline({ windows: win, wishes: [w1Active, w2], radio: testRadio, nowSec: 200 })
  const tl2Removed = computeMusicTimeline({ windows: win, wishes: [w1Removed, w2], radio: testRadio, nowSec: 200 })
  assert.equal(tl2Removed.current?.kind, 'wish')
  assert.equal(tl2Removed.current?.wishId, 'w2')
  assert.equal(tl2Removed.current?.start, tl2Active.current?.start)
  assert.equal(tl2Removed.current?.end, tl2Active.current?.end)
  // utána lévő rádió sem csúszik el
  const tl3Active = computeMusicTimeline({ windows: win, wishes: [w1Active, w2], radio: testRadio, nowSec: 350 })
  const tl3Removed = computeMusicTimeline({ windows: win, wishes: [w1Removed, w2], radio: testRadio, nowSec: 350 })
  assert.equal(tl3Removed.current?.kind, 'radio')
  assert.equal(tl3Removed.current?.track.id, tl3Active.current?.track.id)
  assert.equal(tl3Removed.current?.start, tl3Active.current?.start)
})

ok('champions: ISO hét és hónap határok + hátralévő napok', () => {
  // 2026-11-24 kedd (hétfő: 2026-11-23, előző hét: 2026-11-16..2026-11-22, előző hónap: október)
  const b = getChampionBounds('2026-11-24')
  assert.equal(b.curWeekStart, '2026-11-23')
  assert.equal(b.prevWeekStart, '2026-11-16')
  assert.equal(b.prevWeekEnd, '2026-11-22')
  assert.equal(b.daysLeftInWeek, 5)
  assert.equal(b.prevMonthStart, '2026-10-01')
  assert.equal(b.prevMonthEnd, '2026-10-31')
  assert.equal(b.daysLeftInMonth, 6)
  // Január -> előző év december
  const bJan = getChampionBounds('2026-01-05')
  assert.equal(bJan.prevMonthStart, '2025-12-01')
  assert.equal(bJan.prevMonthEnd, '2025-12-31')
})

ok('champions: heti és havi győztesek szétválasztása', () => {
  const rows: ChampionScoreRow[] = [
    // Október (havi): P1 nyer 2x, P2 1x
    { day: '2026-10-05', mode: 'snake', playerId: 'p1', name: '10.A Anna', score: 300, at: 10 },
    { day: '2026-10-06', mode: 'snake', playerId: 'p1', name: '10.A Anna', score: 400, at: 20 },
    { day: '2026-10-07', mode: 'reflex', playerId: 'p2', name: '11.D Bence', score: 500, at: 30 },
    // Előző hét (11.16–11.22): P2 nyer 2x, P1 1x
    { day: '2026-11-17', mode: 'snake', playerId: 'p2', name: '11.D Bence', score: 450, at: 40 },
    { day: '2026-11-18', mode: 'quiz', playerId: 'p2', name: '11.D Bence', score: 250, at: 50 },
    { day: '2026-11-19', mode: 'reflex', playerId: 'p1', name: '10.A Anna', score: 600, at: 60 },
    // Aktuális hét (11.23–): P3 vezet
    { day: '2026-11-23', mode: 'snake', playerId: 'p3', name: '9.A Csaba', score: 700, at: 70 },
  ]
  const st = computeChampions(rows, '2026-11-24')
  assert.equal(st.monthlyChampion?.playerId, 'p1')
  assert.equal(st.monthlyChampion?.wins, 2)
  assert.equal(st.weeklyChampion?.playerId, 'p2')
  assert.equal(st.weeklyChampion?.wins, 2)
  assert.equal(st.currentWeekTop[0]?.playerId, 'p3')
})

ok('champions: napi több játékmód győzelem összegzése + holtverseny összpont alapján', () => {
  const rows: ChampionScoreRow[] = [
    // Előző hét: P1 ugyanazon a napon nyer snake + quiz-ben (2 győzelem, össz 500 p)
    { day: '2026-11-16', mode: 'snake', playerId: 'p1', name: 'A1', score: 200, at: 10 },
    { day: '2026-11-16', mode: 'quiz', playerId: 'p1', name: 'A1', score: 300, at: 20 },
    // P2 nyer 2 különböző napon reflexben (2 győzelem, össz 800 p -> P2 nyer holtversenynél!)
    { day: '2026-11-17', mode: 'reflex', playerId: 'p2', name: 'B2', score: 400, at: 30 },
    { day: '2026-11-18', mode: 'reflex', playerId: 'p2', name: 'B2', score: 400, at: 40 },
    // Második helyezett adott napon nem kap győzelmet
    { day: '2026-11-16', mode: 'snake', playerId: 'p3', name: 'C3', score: 150, at: 5 },
  ]
  const st = computeChampions(rows, '2026-11-24')
  assert.equal(st.weeklyChampion?.playerId, 'p2')
  assert.equal(st.weeklyChampion?.wins, 2)
  assert.equal(st.weeklyChampion?.totalScore, 800)
})

const { normalizePlayerNameKey, isNameTakenByOther, sanitizePinInput, isValidPin } = await import('../src/lib/playerProfile.ts')
if (normalizePlayerNameKey('  10.A   Dániel ') !== '10.a daniel') {
  throw new Error('normalizePlayerNameKey hibás normalizálás')
}
if (!isNameTakenByOther('10.a   DÁNIEL', 'p2', [{ playerId: 'p1', name: '10.A Dániel' }])) {
  throw new Error('isNameTakenByOther nem ismerte fel a foglalt nevet')
}
if (isNameTakenByOther('10.a Dániel', 'p1', [{ playerId: 'p1', name: '10.A Dániel' }])) {
  throw new Error('isNameTakenByOther a saját nevet is foglaltnak jelölte')
}
if (isNameTakenByOther('10.B Márk', 'p2', [{ playerId: 'p1', name: '10.A Dániel' }])) {
  throw new Error('isNameTakenByOther szabad nevet tiltott')
}
if (sanitizePinInput('12a345') !== '1234') {
  throw new Error('sanitizePinInput hibás PIN szűrés')
}
if (!isValidPin('4821') || isValidPin('123')) {
  throw new Error('isValidPin hibás validáció')
}

const { cleanSongTitle } = await import('../src/lib/video.ts')
const titleCases: [string, string][] = [
  ['Alan Walker - Faded (Official Music Video)', 'Alan Walker - Faded'],
  ['DESH - Kukásautó [Official Lyric Video] (4K HD)', 'DESH - Kukásautó'],
  ['Dua Lipa - Levitating (feat. DaBaby) | Official Video', 'Dua Lipa - Levitating (feat. DaBaby)'],
  ['Azahriah - 3korty (Hivatalos Videoklip) [Dalszöveggel]', 'Azahriah - 3korty'],
  ['Billie Eilish - Birds of a Feather (Official Audio)', 'Billie Eilish - Birds of a Feather'],
]
for (const [raw, expected] of titleCases) {
  const actual = cleanSongTitle(raw)
  if (actual !== expected) {
    throw new Error(`cleanSongTitle("${raw}") = "${actual}", várt: "${expected}"`)
  }
}

console.log(`TZ=${process.env.TZ ?? '(rendszer)'}: ${n} teszt OK`)
