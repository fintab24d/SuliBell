/**
 * Tiszta (import-mentes) heti és havi Nagy Győztes számító logika a Mini-Aréna + Snake toplistához.
 * Node tesztekből és böngészőből egyaránt futtatható.
 */

export type ChampionTier = 'weekly' | 'monthly'

export interface ChampionScoreRow {
  day: string
  mode: string
  playerId: string
  name: string
  score: number
  at: number
}

export interface ChampionEntry {
  playerId: string
  name: string
  wins: number
  totalScore: number
  rank: number
}

export interface ChampionsState {
  weeklyChampion: ChampionEntry | null
  monthlyChampion: ChampionEntry | null
  currentWeekTop: ChampionEntry[]
  currentMonthTop: ChampionEntry[]
  prevMonthLabel: string
  curMonthLabel: string
  daysLeftInWeek: number
  daysLeftInMonth: number
  prevWeekKey: string
  prevMonthKey: string
}

const HU_MONTHS = [
  'január',
  'február',
  'március',
  'április',
  'május',
  'június',
  'július',
  'augusztus',
  'szeptember',
  'október',
  'november',
  'december',
] as const

const pad2 = (n: number) => String(n).padStart(2, '0')

function addDaysUtc(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, (d || 1) + delta))
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`
}

export interface ChampionBounds {
  prevWeekStart: string
  prevWeekEnd: string
  curWeekStart: string
  curWeekEnd: string
  prevMonthStart: string
  prevMonthEnd: string
  curMonthStart: string
  curMonthEnd: string
  minStart: string
  prevMonthLabel: string
  curMonthLabel: string
  daysLeftInWeek: number
  daysLeftInMonth: number
  prevWeekKey: string
  prevMonthKey: string
}

export function getChampionBounds(day: string): ChampionBounds {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim())
  const y = m ? Number(m[1]) : 2026
  const mo = m ? Number(m[2]) : 1
  const d = m ? Number(m[3]) : 1
  const dt = new Date(Date.UTC(y, mo - 1, d))
  const weekday = ((dt.getUTCDay() + 6) % 7) + 1 // 1 = Hétfő .. 7 = Vasárnap

  const curWeekStart = addDaysUtc(day, -(weekday - 1))
  const curWeekEnd = addDaysUtc(curWeekStart, 6)
  const prevWeekStart = addDaysUtc(curWeekStart, -7)
  const prevWeekEnd = addDaysUtc(curWeekStart, -1)

  const curMonthStart = `${y}-${pad2(mo)}-01`
  const lastCurMonthDay = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const curMonthEnd = `${y}-${pad2(mo)}-${pad2(lastCurMonthDay)}`

  const prevY = mo === 1 ? y - 1 : y
  const prevMo = mo === 1 ? 12 : mo - 1
  const prevMonthStart = `${prevY}-${pad2(prevMo)}-01`
  const lastPrevMonthDay = new Date(Date.UTC(prevY, prevMo, 0)).getUTCDate()
  const prevMonthEnd = `${prevY}-${pad2(prevMo)}-${pad2(lastPrevMonthDay)}`

  const minStart = prevWeekStart < prevMonthStart ? prevWeekStart : prevMonthStart

  return {
    prevWeekStart,
    prevWeekEnd,
    curWeekStart,
    curWeekEnd,
    prevMonthStart,
    prevMonthEnd,
    curMonthStart,
    curMonthEnd,
    minStart,
    prevMonthLabel: HU_MONTHS[prevMo - 1] ?? '',
    curMonthLabel: HU_MONTHS[mo - 1] ?? '',
    daysLeftInWeek: Math.max(0, 7 - weekday),
    daysLeftInMonth: Math.max(0, lastCurMonthDay - d),
    prevWeekKey: prevWeekStart,
    prevMonthKey: prevMonthStart.slice(0, 7),
  }
}

export function emptyChampionsState(day: string): ChampionsState {
  const b = getChampionBounds(day)
  return {
    weeklyChampion: null,
    monthlyChampion: null,
    currentWeekTop: [],
    currentMonthTop: [],
    prevMonthLabel: b.prevMonthLabel,
    curMonthLabel: b.curMonthLabel,
    daysLeftInWeek: b.daysLeftInWeek,
    daysLeftInMonth: b.daysLeftInMonth,
    prevWeekKey: b.prevWeekKey,
    prevMonthKey: b.prevMonthKey,
  }
}

function aggregateWinners(winners: ChampionScoreRow[], start: string, end: string, limit: number): ChampionEntry[] {
  const map = new Map<string, { playerId: string; name: string; latestDay: string; latestAt: number; wins: number; totalScore: number; firstWin: number }>()
  for (const w of winners) {
    if (w.day < start || w.day > end) continue
    const prev = map.get(w.playerId)
    if (!prev) {
      map.set(w.playerId, {
        playerId: w.playerId,
        name: w.name,
        latestDay: w.day,
        latestAt: w.at,
        wins: 1,
        totalScore: w.score,
        firstWin: w.at,
      })
    } else {
      prev.wins += 1
      prev.totalScore += w.score
      if (w.at < prev.firstWin) prev.firstWin = w.at
      if (w.day > prev.latestDay || (w.day === prev.latestDay && w.at >= prev.latestAt)) {
        prev.latestDay = w.day
        prev.latestAt = w.at
        prev.name = w.name
      }
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.wins - a.wins || b.totalScore - a.totalScore || a.firstWin - b.firstWin)
    .slice(0, limit)
    .map((e, i) => ({
      playerId: e.playerId,
      name: e.name,
      wins: e.wins,
      totalScore: e.totalScore,
      rank: i + 1,
    }))
}

/** Minden (nap, játékmód) páros #1 győzteséből kiszámolja a heti és havi bajnokokat. */
export function computeChampions(rows: ChampionScoreRow[], day: string): ChampionsState {
  const b = getChampionBounds(day)
  const bestPerDayMode = new Map<string, ChampionScoreRow>()

  for (const r of rows) {
    if (!r || !r.day || !r.playerId || !r.name || r.score <= 0) continue
    if (r.day < b.minStart || r.day > day) continue
    const key = `${r.day}|${r.mode}`
    const cur = bestPerDayMode.get(key)
    if (!cur || r.score > cur.score || (r.score === cur.score && r.at < cur.at)) {
      bestPerDayMode.set(key, r)
    }
  }

  const dailyWinners = Array.from(bestPerDayMode.values())
  return {
    weeklyChampion: aggregateWinners(dailyWinners, b.prevWeekStart, b.prevWeekEnd, 1)[0] ?? null,
    monthlyChampion: aggregateWinners(dailyWinners, b.prevMonthStart, b.prevMonthEnd, 1)[0] ?? null,
    currentWeekTop: aggregateWinners(dailyWinners, b.curWeekStart, day, 3),
    currentMonthTop: aggregateWinners(dailyWinners, b.curMonthStart, day, 3),
    prevMonthLabel: b.prevMonthLabel,
    curMonthLabel: b.curMonthLabel,
    daysLeftInWeek: b.daysLeftInWeek,
    daysLeftInMonth: b.daysLeftInMonth,
    prevWeekKey: b.prevWeekKey,
    prevMonthKey: b.prevMonthKey,
  }
}

export function championsFromRpcRows(
  rows: Array<{ period: string; rank: number; player_id: string; player_name: string; wins: number; total_score: number }>,
  day: string
): ChampionsState {
  const base = emptyChampionsState(day)
  const toEntry = (r: (typeof rows)[number]): ChampionEntry => ({
    playerId: String(r.player_id),
    name: String(r.player_name),
    wins: Number(r.wins) || 0,
    totalScore: Number(r.total_score) || 0,
    rank: Number(r.rank) || 1,
  })
  const curWeek: ChampionEntry[] = []
  const curMonth: ChampionEntry[] = []
  for (const r of rows) {
    const entry = toEntry(r)
    if (r.period === 'prev_week' && entry.rank === 1) base.weeklyChampion = entry
    else if (r.period === 'prev_month' && entry.rank === 1) base.monthlyChampion = entry
    else if (r.period === 'cur_week') curWeek.push(entry)
    else if (r.period === 'cur_month') curMonth.push(entry)
  }
  base.currentWeekTop = curWeek.sort((a, b) => a.rank - b.rank).slice(0, 3)
  base.currentMonthTop = curMonth.sort((a, b) => a.rank - b.rank).slice(0, 3)
  return base
}
