import { useCallback, useEffect, useMemo, useState } from 'react'
import { zoned } from './engine'
import {
  ensureServerTimeSynced,
  isServerTimeSynced,
  startServerTimeSync,
  subscribeServerTime,
  trustedServerNowMs,
} from './serverTime'

export const ADVENT_START_DATE = '2026-11-29'
export const ADVENT_END_DATE = '2026-12-24'
export const XMAS_SEASON_END_DATE = '2026-12-26'
export const WINTER_BREAK_DATE = '2026-12-18'

/** 2026-os 4 adventi vasárnap (gyertyagyújtás dátumai, Europe/Budapest szerveridő szerint). */
export const ADVENT_SUNDAYS = [
  '2026-11-29',
  '2026-12-06',
  '2026-12-13',
  '2026-12-20',
] as const

export type HolidayThemeId = 'off' | 'christmas' | 'aurora' | 'gingerbread'
export type HolidayThemeMode = 'auto' | HolidayThemeId
export type AdventBellId = 'sleigh-bells' | 'jingle-8bit' | 'hohoho'

export type AdventRewardKind =
  | 'snow'
  | 'bell'
  | 'theme'
  | 'frame'
  | 'snake'
  | 'excuse'
  | 'prediction'
  | 'challenge'
  | 'grand'

export interface AdventDoor {
  day: number // 1..26
  date: string // YYYY-MM-DD (2026-11-29 .. 2026-12-24)
  shortDate: string // pl. "Nov. 29."
  icon: string
  category: string
  title: string
  body: string
  rewardKind: AdventRewardKind
  bellId?: AdventBellId
  themeId?: 'aurora' | 'gingerbread'
  sundayNumber?: 1 | 2 | 3 | 4
}

export const ADVENT_DOORS: ReadonlyArray<AdventDoor> = [
  {
    day: 1,
    date: '2026-11-29',
    shortDate: 'Nov. 29.',
    icon: '❄️',
    category: '1. Adventi vasárnap • Effekt',
    title: 'Hóesés háttéreffekt',
    body: 'Meggyulladt az 1. adventi gyertya! Feloldottad a finom, teljesítménybarát téli hóesés effektet, amelyet bármikor ki- és bekapcsolhatsz a fejlécben vagy az ünnepi beállításoknál.',
    rewardKind: 'snow',
    sundayNumber: 1,
  },
  {
    day: 2,
    date: '2026-11-30',
    shortDate: 'Nov. 30.',
    icon: '📝',
    category: 'Tanár-kompatibilis kifogás',
    title: 'A fagyos házi esete',
    body: '„Tanárnő, a füzetem sajnos beleesett a reggeli dérbe, és a fizika törvényei szerint szó szerint befagyott rajta a házi feladat — de mire kiolvad, meglesz!”',
    rewardKind: 'excuse',
  },
  {
    day: 3,
    date: '2026-12-01',
    shortDate: 'Dec. 1.',
    icon: '🛷',
    category: 'Új csengőhang',
    title: 'Száncsengő jelzés',
    body: 'Üdv decemberben! Feloldottad a csilingelő Száncsengő csengőhangot (Web Audio API). Teszteld le, és állítsd be, ha igazi téli hangulatra vágysz kicsengetéskor!',
    rewardKind: 'bell',
    bellId: 'sleigh-bells',
  },
  {
    day: 4,
    date: '2026-12-02',
    shortDate: 'Dec. 2.',
    icon: '🔮',
    category: 'Ünnepi diák-jóslat',
    title: 'Röpdolgozat-védelem',
    body: 'A téli csillagállás szerint a héten egy váratlan felelés vagy röpdolgozat elkerül — vagy pont az a kérdés jön szembe, amit utoljára átfutottál a buszon!',
    rewardKind: 'prediction',
  },
  {
    day: 5,
    date: '2026-12-03',
    shortDate: 'Dec. 3.',
    icon: '🤝',
    category: 'Szüneti mini-kihívás',
    title: 'Jófejség-küldetés',
    body: 'Mai kihívás: kívánj mosolyogva szép napot egy olyan osztálytársadnak vagy tanárnak, akivel ritkábban szoktál beszélni! Garantáltan feldobja a napját.',
    rewardKind: 'challenge',
  },
  {
    day: 6,
    date: '2026-12-04',
    shortDate: 'Dec. 4.',
    icon: '🦌',
    category: 'Tanár-kompatibilis kifogás',
    title: 'Rudolf volt a tettes',
    body: '„A kutyám helyett ma reggel egy eltévedt rénszarvas kóstolt bele a munkafüzetembe — a megoldásokat szerencsére fejben még elmentettem!”',
    rewardKind: 'excuse',
  },
  {
    day: 7,
    date: '2026-12-05',
    shortDate: 'Dec. 5.',
    icon: '🥾',
    category: 'Mikulás-előesti jóslat',
    title: 'Csizmapucolós szerencse',
    body: 'Ha ma este kifényesíted a csizmád (vagy legalább rendet raksz a padodban/asztalodon), holnap dupla adag szerencse jár az iskolában — és talán csoki is!',
    rewardKind: 'prediction',
  },
  {
    day: 8,
    date: '2026-12-06',
    shortDate: 'Dec. 6.',
    icon: '🎅',
    category: 'Mikulás • 2. Adventi vasárnap',
    title: 'Mikulás keret feloldva!',
    body: 'Boldog Mikulást! Meggyulladt a 2. adventi gyertya, és megkaptad az ünnepi piros-arany Mikulás keretet a fő visszaszámláló köré, plusz a SuliBell csengőre kerülő Mikulás-sapkát és ünnepi zoknit!',
    rewardKind: 'frame',
    sundayNumber: 2,
  },
  {
    day: 9,
    date: '2026-12-07',
    shortDate: 'Dec. 7.',
    icon: '✊',
    category: 'Szüneti mini-kihívás',
    title: 'Offline 5 perc',
    body: 'A mai nagyszünetben tedd le 5 percre a telefont, és rendezzetek egy villám kő-papír-olló bajnokságot a padtársaddal vagy a haverokkal!',
    rewardKind: 'challenge',
  },
  {
    day: 10,
    date: '2026-12-08',
    shortDate: 'Dec. 8.',
    icon: '🐍',
    category: 'Ünnepi játékbőr (Snake)',
    title: 'Karácsonyi Snake skin',
    body: 'Feloldottad a Karácsonyi Snake skint! Piros-fehér cukorpálca-kígyó mini Mikulás-sapkával, havas fenyőpályán ajándékdobozokért (🎁) vadászva.',
    rewardKind: 'snake',
  },
  {
    day: 11,
    date: '2026-12-09',
    shortDate: 'Dec. 9.',
    icon: '⏰',
    category: 'Tanár-kompatibilis kifogás',
    title: 'Téli akksi-szindróma',
    body: '„Tanár úr, nem én aludtam el — a telefonom akkumulátora a hideg miatt hirtelen téli álmot aludt, de a SuliBellre azért időben ideértem!”',
    rewardKind: 'excuse',
  },
  {
    day: 12,
    date: '2026-12-10',
    shortDate: 'Dec. 10.',
    icon: '🌌',
    category: 'Új színpaletta',
    title: 'Északi fény (Aurora) téma',
    body: 'Sarkvidéki csoda! Feloldottad az Északi fény színpalettát smaragdzöld, jégkék és aurora-lila ragyogással. Egy kattintással kipróbálhatod!',
    rewardKind: 'theme',
    themeId: 'aurora',
  },
  {
    day: 13,
    date: '2026-12-11',
    shortDate: 'Dec. 11.',
    icon: '✨',
    category: 'Ünnepi diák-jóslat',
    title: 'A rejtett bónuszpont',
    body: 'Egy közelgő dolgozat sokkal barátibb lesz, mint amire számítasz — az egyetlen titok, hogy a végén még egyszer olvasd át a számolásokat!',
    rewardKind: 'prediction',
  },
  {
    day: 14,
    date: '2026-12-12',
    shortDate: 'Dec. 12.',
    icon: '🕹️',
    category: 'Új csengőhang',
    title: '8-bites Jingle Bells',
    body: 'Retro karácsony! Feloldottad a 8-bites Jingle Bells arcade chiptune csengőhangot. Hallgasd meg a Teszt gombbal, és kapcsolj rá óravégén!',
    rewardKind: 'bell',
    bellId: 'jingle-8bit',
  },
  {
    day: 15,
    date: '2026-12-13',
    shortDate: 'Dec. 13.',
    icon: '🕯️',
    category: 'Luca napja • 3. Adventi vasárnap',
    title: 'Luca-napi kihívás',
    body: 'Meggyulladt a 3., rózsaszín örömgyertya! Mai kihívás: írj fel magadnak egyetlen elmaradt dolgot vagy tanulnivalót, amit még a téli szünet előtt biztosan kipipálsz!',
    rewardKind: 'challenge',
    sundayNumber: 3,
  },
  {
    day: 16,
    date: '2026-12-14',
    shortDate: 'Dec. 14.',
    icon: '☁️',
    category: 'Tanár-kompatibilis kifogás',
    title: 'Hófelhőben ragadt beadandó',
    body: '„Feltöltöttem a házit a felhőbe, de a tél miatt valószínűleg hófelhő lett belőle és elfújta a szél — amint kitisztul a Wi-Fi, már küldöm is!”',
    rewardKind: 'excuse',
  },
  {
    day: 17,
    date: '2026-12-15',
    shortDate: 'Dec. 15.',
    icon: '🍪',
    category: 'Új színpaletta',
    title: 'Mézeskalács téma',
    body: 'Illatos, meleg ünnepi hangulat! Feloldottad a Mézeskalács színpalettát fahéjbarna, karamell, cukormáz és mézes arany színekkel.',
    rewardKind: 'theme',
    themeId: 'gingerbread',
  },
  {
    day: 18,
    date: '2026-12-16',
    shortDate: 'Dec. 16.',
    icon: '🚀',
    category: 'Ünnepi diák-jóslat',
    title: 'Már csak két lépés a szünet!',
    body: 'A jóslat mára: a legutolsó órától tartasz a legjobban, mégis az fog elrepülni a leggyorsabban — a téli szünet már karnyújtásnyira van!',
    rewardKind: 'prediction',
  },
  {
    day: 19,
    date: '2026-12-17',
    shortDate: 'Dec. 17.',
    icon: '🔔',
    category: 'Új csengőhang',
    title: 'Ho-ho-ho! Ünnepi csengő',
    body: 'Holnap az utolsó tanítási nap! Feloldottad a vidám, szintetizált Ho-ho-ho! ünnepi csengőeffektet. Próbáld ki azonnal!',
    rewardKind: 'bell',
    bellId: 'hohoho',
  },
  {
    day: 20,
    date: '2026-12-18',
    shortDate: 'Dec. 18.',
    icon: '🎉',
    category: 'Téli szünet előtti kihívás',
    title: 'Év végi pacsi-kör',
    body: 'Elérkezett december 18.! Mai kihívás: adj egy őszinte év végi dicséretet vagy nagy pacsit a padtársadnak, mielőtt becsapjátok a táskát a téli szünetre!',
    rewardKind: 'challenge',
  },
  {
    day: 21,
    date: '2026-12-19',
    shortDate: 'Dec. 19.',
    icon: '🛌',
    category: 'Szüneti kifogás',
    title: 'Agy-defragmentálás',
    body: '„Nem azért alszom még délben, mert lusta vagyok — hanem mert az agyam épp kötelező téli rendszerfrissítést futtat az őszi félév után!”',
    rewardKind: 'excuse',
  },
  {
    day: 22,
    date: '2026-12-20',
    shortDate: 'Dec. 20.',
    icon: '🌟',
    category: '4. Adventi vasárnap • Jóslat',
    title: 'Mind a 4 gyertya ég!',
    body: 'Teljes fényben ragyog az adventi koszorú! A 4. gyertya jóslata: az ünnepek alatt egy váratlan jó hír vagy emlékezetes pillanat vár rád, amire tavasszal is mosolyogva gondolsz.',
    rewardKind: 'prediction',
    sundayNumber: 4,
  },
  {
    day: 23,
    date: '2026-12-21',
    shortDate: 'Dec. 21.',
    icon: '☕',
    category: 'Téli napforduló kihívás',
    title: 'Forró csoki & chill',
    body: 'Az év legrövidebb napja! Mai mini-kihívás: készíts egy bögre forró teát vagy kakaót, és tarts legalább 1 óra teljesen nyugis, rohanásmentes pihenőt.',
    rewardKind: 'challenge',
  },
  {
    day: 24,
    date: '2026-12-22',
    shortDate: 'Dec. 22.',
    icon: '🍪',
    category: 'Ünnepi kifogás',
    title: 'Szigorú minőségellenőrzés',
    body: '„Nem én ettem meg a fél tepsi mézeskalácsot! Csak tudományos mintavételt végeztem, hogy biztosan tökéletes-e szentestére!”',
    rewardKind: 'excuse',
  },
  {
    day: 25,
    date: '2026-12-23',
    shortDate: 'Dec. 23.',
    icon: '🌠',
    category: 'Szenteste előtti jóslat',
    title: 'A holnapi varázslat',
    body: 'Már csak egyet kell aludni! A legjobb ajándék holnap nem a csomagolópapírban lesz, hanem abban a nyugalomban, hogy egy darabig nem szól a reggeli ébresztő.',
    rewardKind: 'prediction',
  },
  {
    day: 26,
    date: '2026-12-24',
    shortDate: 'Dec. 24.',
    icon: '🏆',
    category: 'Szenteste • Főnyeremény',
    title: 'SuliBell Téli Túlélő 2026',
    body: 'Gratulálunk, végigcsináltad a téli hajrát! Megkaptad az exkluzív „SuliBell Téli Túlélő 2026” jelvényt (amely a fejlécben is megjelenik) és a SuliBell ünnepi üdvözlőkártyáját. Békés, boldog karácsonyt!',
    rewardKind: 'grand',
  },
]

export const ADVENT_BELL_META: ReadonlyArray<{
  id: AdventBellId
  doorDay: number
  dateLabel: string
  name: string
  desc: string
  icon: string
}> = [
  {
    id: 'sleigh-bells',
    doorDay: 3,
    dateLabel: 'Dec. 1.',
    name: 'Száncsengő',
    desc: 'Csilingelő fém száncsengők és téli csengő-akkord',
    icon: '🛷',
  },
  {
    id: 'jingle-8bit',
    doorDay: 14,
    dateLabel: 'Dec. 12.',
    name: '8-bites Jingle Bells',
    desc: 'Vidám retro arcade chiptune Jingle Bells dallam',
    icon: '🕹️',
  },
  {
    id: 'hohoho',
    doorDay: 19,
    dateLabel: 'Dec. 17.',
    name: 'Ho-ho-ho! csengő',
    desc: 'Játékos szintetizált Mikulás-effekt és csengőfinálé',
    icon: '🎅',
  },
]

export interface AdventState {
  openedDays: number[]
  themeMode: HolidayThemeMode
  snowEnabled: boolean
  santaFrameEnabled: boolean
  snakeSkinEnabled: boolean
  bellSound: AdventBellId | null
}

const STORAGE_KEY = 'sulibell_advent_2026_v1'
const ADVENT_EVENT = 'sulibell:advent-change'

const DEFAULT_STATE: AdventState = {
  openedDays: [],
  themeMode: 'auto',
  snowEnabled: false,
  santaFrameEnabled: false,
  snakeSkinEnabled: false,
  bellSound: null,
}

export function getServerBudapestDate(nowMs?: number): string {
  const ms = typeof nowMs === 'number' ? nowMs : trustedServerNowMs()
  return zoned(new Date(ms), 'Europe/Budapest').date
}

export function isChristmasSeason(date: string): boolean {
  return date >= ADVENT_START_DATE && date <= XMAS_SEASON_END_DATE
}

/** Igaz, ha a megadott YYYY-MM-DD szerveridő december 5. után van (azaz dec. 6–31.). */
export function isAfterDec5(date: string): boolean {
  if (!date || date.length < 10) return false
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  return month === 12 && day > 5
}

export function getLitAdventCandles(date: string): number {
  let count = 0
  for (const d of ADVENT_SUNDAYS) {
    if (date >= d) count++
  }
  return count
}

export function daysUntilDate(fromDate: string, toDate: string): number {
  const a = Date.UTC(+fromDate.slice(0, 4), +fromDate.slice(5, 7) - 1, +fromDate.slice(8, 10))
  const b = Date.UTC(+toDate.slice(0, 4), +toDate.slice(5, 7) - 1, +toDate.slice(8, 10))
  return Math.round((b - a) / 86400000)
}

export function loadAdventState(): AdventState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const p = JSON.parse(raw)
    const openedDays: number[] = Array.isArray(p?.openedDays)
      ? Array.from(
          new Set<number>(
            (p.openedDays as unknown[])
              .map(n => Number(n))
              .filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 26)
          )
        ).sort((a, b) => a - b)
      : []
    const validModes: HolidayThemeMode[] = ['auto', 'off', 'christmas', 'aurora', 'gingerbread']
    const themeMode: HolidayThemeMode = validModes.includes(p?.themeMode) ? p.themeMode : 'auto'
    const validBells: AdventBellId[] = ['sleigh-bells', 'jingle-8bit', 'hohoho']
    const bellSound: AdventBellId | null = validBells.includes(p?.bellSound) ? p.bellSound : null
    return {
      openedDays,
      themeMode,
      snowEnabled: p?.snowEnabled === true,
      santaFrameEnabled: p?.santaFrameEnabled === true,
      snakeSkinEnabled: p?.snakeSkinEnabled === true,
      bellSound,
    }
  } catch {
    return DEFAULT_STATE
  }
}

export function saveAdventState(state: AdventState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    window.dispatchEvent(new Event(ADVENT_EVENT))
  } catch {
    // ignore storage errors
  }
}

export function getAdventUnlocked(openedDays: number[]) {
  const set = new Set(openedDays)
  const unlockedBells = ADVENT_BELL_META.filter(b => set.has(b.doorDay)).map(b => b.id)
  return {
    hasSnow: set.has(1),
    hasSantaFrame: set.has(8),
    hasSnakeSkin: set.has(10),
    hasAurora: set.has(12),
    hasGingerbread: set.has(17),
    hasSurvivorBadge: set.has(26),
    unlockedBells,
  }
}

export function resolveActiveHolidayTheme(
  state: AdventState,
  serverDate: string,
  hasCustomVipTheme = false
): HolidayThemeId {
  const unlocked = getAdventUnlocked(state.openedDays)
  if (state.themeMode === 'off') return 'off'
  if (state.themeMode === 'christmas') return 'christmas'
  if (state.themeMode === 'aurora') return unlocked.hasAurora ? 'aurora' : 'off'
  if (state.themeMode === 'gingerbread') return unlocked.hasGingerbread ? 'gingerbread' : 'off'
  // 'auto': Nov 29 – Dec 26 között alapból aktív a Karácsonyi téma (ha nincs egyedi VIP téma kiválasztva)
  if (isChristmasSeason(serverDate) && !hasCustomVipTheme) return 'christmas'
  return 'off'
}

export function applyHolidayDom(activeTheme: HolidayThemeId, santaFrameActive: boolean) {
  if (typeof document === 'undefined') return
  if (activeTheme !== 'off') {
    document.documentElement.dataset.holidayTheme = activeTheme
  } else {
    delete document.documentElement.dataset.holidayTheme
  }
  if (santaFrameActive) {
    document.documentElement.dataset.santaFrame = '1'
  } else {
    delete document.documentElement.dataset.santaFrame
  }
}

export interface AdventOpenResult {
  ok: boolean
  door?: AdventDoor
  newlyOpened?: boolean
  error?: string
}

export function useAdvent(hasCustomVipTheme = false) {
  const [state, setState] = useState<AdventState>(loadAdventState)
  const [serverSynced, setServerSynced] = useState<boolean>(isServerTimeSynced)
  const [serverDate, setServerDate] = useState<string>(() => getServerBudapestDate())

  useEffect(() => {
    startServerTimeSync()
    const refreshDate = () => {
      setServerSynced(isServerTimeSynced())
      setServerDate(getServerBudapestDate())
    }
    refreshDate()
    const unsub = subscribeServerTime(refreshDate)
    const timer = window.setInterval(refreshDate, 30_000)
    return () => {
      unsub()
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const sync = () => setState(loadAdventState())
    window.addEventListener(ADVENT_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(ADVENT_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const unlocked = useMemo(() => getAdventUnlocked(state.openedDays), [state.openedDays])
  const activeTheme = useMemo(
    () => resolveActiveHolidayTheme(state, serverDate, hasCustomVipTheme),
    [state, serverDate, hasCustomVipTheme]
  )
  const santaFrameActive = unlocked.hasSantaFrame && state.santaFrameEnabled
  const effectiveSnakeSkin: 'neon' | 'christmas' =
    unlocked.hasSnakeSkin && state.snakeSkinEnabled ? 'christmas' : 'neon'
  const effectiveBell: AdventBellId | null =
    state.bellSound && unlocked.unlockedBells.includes(state.bellSound) ? state.bellSound : null
  const litCandles = useMemo(() => getLitAdventCandles(serverDate), [serverDate])
  const inSeason = useMemo(() => isChristmasSeason(serverDate), [serverDate])

  // Elérhető (kinyitható, még ki nem nyitott) ablakok száma — szigorúan szerveridő alapján!
  const availableCount = useMemo(() => {
    if (!serverSynced) return 0
    const opened = new Set(state.openedDays)
    return ADVENT_DOORS.filter(d => d.date <= serverDate && !opened.has(d.day)).length
  }, [serverSynced, serverDate, state.openedDays])

  useEffect(() => {
    applyHolidayDom(activeTheme, santaFrameActive)
  }, [activeTheme, santaFrameActive])

  const patchState = useCallback((updater: (prev: AdventState) => AdventState) => {
    setState(prev => {
      const next = updater(prev)
      saveAdventState(next)
      return next
    })
  }, [])

  const openDoor = useCallback(
    async (day: number): Promise<AdventOpenResult> => {
      const door = ADVENT_DOORS.find(d => d.day === day)
      if (!door) return { ok: false, error: 'Ismeretlen ablak.' }

      // Már korábban kinyitott ablak bármikor visszanézhető (offline is)
      const current = loadAdventState()
      if (current.openedDays.includes(day)) {
        return { ok: true, door, newlyOpened: false }
      }

      // Új ablak kinyitásához kötelező az élő szerveridő-hitelesítés (csalás ellen)
      const okSync = await ensureServerTimeSynced()
      const liveDate = getServerBudapestDate(trustedServerNowMs())
      setServerSynced(okSync)
      setServerDate(liveDate)

      if (!okSync) {
        return {
          ok: false,
          error: 'Az ablak kinyitásához internetkapcsolat (szerveridő-ellenőrzés) szükséges, hogy ne lehessen előre lesni!',
        }
      }

      if (liveDate < door.date) {
        const diff = daysUntilDate(liveDate, door.date)
        return {
          ok: false,
          error:
            diff === 1
              ? `Ez az ablak holnap (${door.shortDate}) nyílik ki szerveridő szerint!`
              : `Ez az ablak még zárva van — ${door.shortDate} napján nyitható ki (még ${diff} nap)!`,
        }
      }

      // Kinyitás + releváns jutalom azonnali kényelmes aktiválása
      patchState(prev => {
        if (prev.openedDays.includes(day)) return prev
        const nextOpened = [...prev.openedDays, day].sort((a, b) => a - b)
        const next: AdventState = { ...prev, openedDays: nextOpened }
        if (door.rewardKind === 'snow') next.snowEnabled = true
        if (door.rewardKind === 'frame') next.santaFrameEnabled = true
        if (door.rewardKind === 'snake') next.snakeSkinEnabled = true
        return next
      })

      try {
        window.dispatchEvent(
          new CustomEvent('sulibell:celebrate', {
            detail: { kind: door.rewardKind === 'grand' ? 'gold' : 'christmas', power: door.rewardKind === 'grand' ? 1.5 : 1 },
          })
        )
      } catch {
        // ignore
      }

      return { ok: true, door, newlyOpened: true }
    },
    [patchState]
  )

  const setThemeMode = useCallback(
    (themeMode: HolidayThemeMode) => {
      patchState(prev => ({
        ...prev,
        themeMode,
        // Ha a felhasználó kézzel bekapcsolja a karácsonyi skint, kényelmesen indulhat a hóesés is, ha még nem döntött ellene
      }))
    },
    [patchState]
  )

  const toggleSnow = useCallback(
    (force?: boolean) => {
      patchState(prev => ({
        ...prev,
        snowEnabled: typeof force === 'boolean' ? force : !prev.snowEnabled,
      }))
    },
    [patchState]
  )

  const toggleSantaFrame = useCallback(
    (force?: boolean) => {
      patchState(prev => ({
        ...prev,
        santaFrameEnabled: typeof force === 'boolean' ? force : !prev.santaFrameEnabled,
      }))
    },
    [patchState]
  )

  const toggleSnakeSkin = useCallback(
    (force?: boolean) => {
      patchState(prev => ({
        ...prev,
        snakeSkinEnabled: typeof force === 'boolean' ? force : !prev.snakeSkinEnabled,
      }))
    },
    [patchState]
  )

  const setHolidayBell = useCallback(
    (bellSound: AdventBellId | null) => {
      patchState(prev => ({ ...prev, bellSound }))
    },
    [patchState]
  )

  return {
    state,
    unlocked,
    activeTheme,
    santaFrameActive,
    effectiveSnakeSkin,
    effectiveBell,
    serverDate,
    serverSynced,
    litCandles,
    inSeason,
    availableCount,
    openDoor,
    setThemeMode,
    toggleSnow,
    toggleSantaFrame,
    toggleSnakeSkin,
    setHolidayBell,
  }
}
