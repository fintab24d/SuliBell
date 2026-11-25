import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { fxSound } from './lib/sound'
import { voterId } from './Poll'
import { checkProfanity, isAnonymousName, validatePlayerName } from './lib/moderation'
import SnakeGame from './SnakeGame'
import { getChampionBadge, useChampions } from './lib/useChampions'
import { normalizePlayerNameKey } from './lib/playerProfile'
import { focusPlayerProfile, usePlayerProfile } from './lib/usePlayerProfile'

export type ArenaMode = 'reflex' | 'quiz' | 'snake'

export interface LeaderEntry {
  playerId: string
  name: string
  mode: ArenaMode
  score: number
  at: number
}

interface QuizQ {
  q: string
  opts: string[]
  ans: number
}

const TRIVIA_BANK: QuizQ[] = [
  { q: 'Hány perc egy tanóra és egy 15 perces szünet együtt?', opts: ['50 perc', '55 perc', '60 perc', '65 perc'], ans: 2 },
  { q: 'Melyik bolygó van legközelebb a Naphoz?', opts: ['Vénusz', 'Merkúr', 'Mars', 'Föld'], ans: 1 },
  { q: 'Mi a víz kémiai képlete?', opts: ['CO₂', 'H₂O', 'O₂', 'NaCl'], ans: 1 },
  { q: 'Hány fok egy háromszög belső szögeinek összege?', opts: ['90°', '180°', '270°', '360°'], ans: 1 },
  { q: 'Melyik évben volt az 1848-as forradalom után a kiegyezés?', opts: ['1849', '1867', '1896', '1914'], ans: 1 },
  { q: 'Hány bit 1 bájt (Byte)?', opts: ['4', '8', '16', '32'], ans: 1 },
  { q: 'Melyik a legnagyobb magyar tó?', opts: ['Velencei-tó', 'Tisza-tó', 'Balaton', 'Fertő tó'], ans: 2 },
  { q: 'Mennyi 2⁵ (kettő az ötödiken)?', opts: ['16', '25', '32', '64'], ans: 2 },
  { q: 'Ki írta a Pál utcai fiúkat?', opts: ['Móra Ferenc', 'Molnár Ferenc', 'Gárdonyi Géza', 'Jókai Mór'], ans: 1 },
  { q: 'Mi Magyarország legmagasabb csúcsa?', opts: ['Dobogókő', 'Kékes', 'Csóványos', 'Írott-kő'], ans: 1 },
  { q: 'Hány másodperc 3 és fél perc?', opts: ['180 mp', '200 mp', '210 mp', '230 mp'], ans: 2 },
  { q: 'Melyik gázból van legtöbb a Föld légkörében?', opts: ['Oxigén', 'Nitrogén', 'Szén-dioxid', 'Hidrogén'], ans: 1 },
  { q: 'Ki írta az Egri csillagokat?', opts: ['Jókai Mór', 'Mikszáth Kálmán', 'Gárdonyi Géza', 'Arany János'], ans: 2 },
  { q: 'Mi az arany vegyjele a periódusos rendszerben?', opts: ['Ag', 'Au', 'Fe', 'Gd'], ans: 1 },
  { q: 'Melyik évben koronázták meg Szent Istvánt?', opts: ['896', '955', '1000', '1083'], ans: 2 },
  { q: 'Hány megyéje (vármegyéje) van Magyarországnak?', opts: ['17', '18', '19', '20'], ans: 2 },
  { q: 'Melyik a világ leghosszabb folyója?', opts: ['Duna', 'Nílus', 'Volga', 'Mississippi'], ans: 1 },
  { q: 'Melyik szervünk termeli az inzulint?', opts: ['Máj', 'Vese', 'Hasnyálmirigy', 'Lép'], ans: 2 },
  { q: 'Mi a fény sebessége vákuumban megközelítőleg?', opts: ['30 000 km/s', '150 000 km/s', '300 000 km/s', '1 000 000 km/s'], ans: 2 },
  { q: 'Ki szerezte a Himnusz zenéjét?', opts: ['Liszt Ferenc', 'Erkel Ferenc', 'Kodály Zoltán', 'Bartók Béla'], ans: 1 },
  { q: 'Hány fok egy négyszög belső szögeinek összege?', opts: ['180°', '270°', '360°', '540°'], ans: 2 },
  { q: 'Melyik kontinensen található a Szahara sivatag?', opts: ['Ázsia', 'Afrika', 'Ausztrália', 'Dél-Amerika'], ans: 1 },
  { q: 'Melyik évben adták ki az Aranybullát?', opts: ['1222', '1241', '1301', '1456'], ans: 0 },
  { q: 'Mi a konyhasó kémiai képlete?', opts: ['KCl', 'NaCl', 'CaCO₃', 'NaOH'], ans: 1 },
  { q: 'Ki írta a Toldit?', opts: ['Petőfi Sándor', 'Arany János', 'Vörösmarty Mihály', 'Kölcsey Ferenc'], ans: 1 },
  { q: 'Melyik a Naprendszer legnagyobb bolygója?', opts: ['Szaturnusz', 'Jupiter', 'Uránusz', 'Neptunusz'], ans: 1 },
  { q: 'Hány oldalú egy szabályos hatszög?', opts: ['5', '6', '7', '8'], ans: 1 },
  { q: 'Mi Ausztrália fővárosa?', opts: ['Sydney', 'Melbourne', 'Canberra', 'Perth'], ans: 2 },
  { q: 'Melyik magyar feltaláló nevéhez fűződik a C-vitamin izolálása?', opts: ['Bíró László', 'Szent-Györgyi Albert', 'Neumann János', 'Jedlik Ányos'], ans: 1 },
  { q: 'Melyik HTTP státuszkód jelenti a „Nem található” hibát?', opts: ['200', '301', '404', '500'], ans: 2 },
  { q: 'Hány billentyű van egy szabványos zongorán?', opts: ['76', '84', '88', '92'], ans: 2 },
  { q: 'Melyik csata zajlott 1526. augusztus 29-én?', opts: ['Kenyérmezei csata', 'Mohácsi csata', 'Nándorfehérvári diadal', 'Muhi csata'], ans: 1 },
  { q: 'Mi a vas vegyjele?', opts: ['Va', 'Fe', 'Ir', 'Zn'], ans: 1 },
  { q: 'Hány napból áll egy szökőév?', opts: ['364', '365', '366', '367'], ans: 2 },
  { q: 'Melyik óceán a Föld legnagyobb óceánja?', opts: ['Atlanti-óceán', 'Indiai-óceán', 'Csendes-óceán', 'Jeges-tenger'], ans: 2 },
  { q: 'Ki írta a János vitézt?', opts: ['Petőfi Sándor', 'Arany János', 'József Attila', 'Ady Endre'], ans: 0 },
  { q: 'Mennyi 144 négyzetgyöke?', opts: ['11', '12', '13', '14'], ans: 1 },
  { q: 'Melyik város volt Magyarország fővárosa a középkorban Buda előtt?', opts: ['Debrecen', 'Székesfehérvár', 'Sopron', 'Pécs'], ans: 1 },
  { q: 'Milyen mértékegységgel mérjük az elektromos ellenállást?', opts: ['Amper', 'Volt', 'Ohm', 'Watt'], ans: 2 },
  { q: 'Melyik folyó folyik át Szegeden?', opts: ['Duna', 'Tisza', 'Rába', 'Dráva'], ans: 1 },
  { q: 'Ki írta A kőszívű ember fiait?', opts: ['Jókai Mór', 'Mikszáth Kálmán', 'Móricz Zsigmond', 'Kosztolányi Dezső'], ans: 0 },
  { q: 'Hány kromoszómája van egy egészséges emberi testi sejtnek?', opts: ['23', '44', '46', '48'], ans: 2 },
  { q: 'Melyik évben volt a tatárjárás Magyarországon?', opts: ['1095–1096', '1241–1242', '1348–1349', '1456'], ans: 1 },
  { q: 'Mi Kanada fővárosa?', opts: ['Toronto', 'Vancouver', 'Ottawa', 'Montreal'], ans: 2 },
  { q: 'Melyik prímszám az alábbiak közül?', opts: ['21', '27', '29', '33'], ans: 2 },
  { q: 'Ki írta a Légy jó mindhalálig című regényt?', opts: ['Móricz Zsigmond', 'Karinthy Frigyes', 'Babits Mihály', 'Molnár Ferenc'], ans: 0 },
  { q: 'Melyik elemnek a rendszáma az 1 a periódusos rendszerben?', opts: ['Hélium', 'Hidrogén', 'Lítium', 'Szén'], ans: 1 },
  { q: 'Melyik hegységben található a Kékes?', opts: ['Bükk', 'Mátra', 'Börzsöny', 'Bakony'], ans: 1 },
  { q: 'Hány játékos van egy kosárlabdacsapatban egyszerre a pályán?', opts: ['5', '6', '7', '11'], ans: 0 },
  { q: 'Melyik évben lépett ember először a Holdra?', opts: ['1961', '1965', '1969', '1972'], ans: 2 },
  { q: 'Mi a római C számjegye arab számmal?', opts: ['50', '100', '500', '1000'], ans: 1 },
  { q: 'Melyik vitamin keletkezik a bőrben napfény hatására?', opts: ['A-vitamin', 'B-vitamin', 'C-vitamin', 'D-vitamin'], ans: 3 },
  { q: 'Ki írta a Szózatot?', opts: ['Kölcsey Ferenc', 'Vörösmarty Mihály', 'Petőfi Sándor', 'Berzsenyi Dániel'], ans: 1 },
  { q: 'Melyik ország zászlaján látható juharlevél?', opts: ['Ausztrália', 'Kanada', 'Új-Zéland', 'Írország'], ans: 1 },
  { q: 'Hány bájt 1 kilobájt (binárisan, KiB)?', opts: ['512', '1000', '1024', '2048'], ans: 2 },
  { q: 'Melyik magyar királyunk uralkodott 1458 és 1490 között?', opts: ['Károly Róbert', 'Nagy Lajos', 'Hunyadi Mátyás', 'Zsigmond'], ans: 2 },
  { q: 'Melyik bolygót nevezik a „vörös bolygónak”?', opts: ['Vénusz', 'Mars', 'Jupiter', 'Merkúr'], ans: 1 },
  { q: 'Mennyi 3⁴ (három a negyediken)?', opts: ['27', '64', '81', '108'], ans: 2 },
  { q: 'Melyik a Föld legmélyebb tava?', opts: ['Tanganyika-tó', 'Bajkál-tó', 'Felső-tó', 'Viktória-tó'], ans: 1 },
  { q: 'Ki alkotta meg a bűvös kockát 1974-ben?', opts: ['Gábor Dénes', 'Rubik Ernő', 'Kempelen Farkas', 'Puskás Tivadar'], ans: 1 },
]

/** Determinisztikus napi véletlenszám-generátor (hogy mindenki ugyanazt a feladatsort kapja adott napon) */
function seededRng(seedStr: string) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h += 0x6d2b79f5
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Napi sorszám (epoch nap), hogy az egymást követő napok kérdéscsomagjai garantáltan eltérjenek */
function dayOffset(day: string): number {
  const ms = Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(ms) ? Math.floor(ms / 86400000) : 0
}

/** Adott napra determinisztikusan megkevert tudáspróba-sorrend (ismétlődés nélkül) */
function getDailyTriviaOrder(day: string): number[] {
  const n = TRIVIA_BANK.length
  const order = Array.from({ length: n }, (_, i) => i)
  const rng = seededRng(`trivia-deck-${day}`)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  // Naponta eltoljuk a csomagot, így két egymást követő napon még a kezdő kérdések sem fedhetnek át
  const shift = ((dayOffset(day) * 17) % n + n) % n
  return order.map((_, i) => order[(i + shift) % n])
}

function makeDailyQuestion(day: string, index: number): QuizQ {
  const rng = seededRng(`${day}-q-${index}`)
  // A kérdések 2/3-a napi egyedi tudáspróba (ismétlődés nélkül), minden 3. kérdés változatos fejszámolás/logika
  if (index % 3 !== 2) {
    const triviaSlot = index - Math.floor(index / 3)
    const deck = getDailyTriviaOrder(day)
    const base = TRIVIA_BANK[deck[triviaSlot % deck.length]]
    // A válaszlehetőségek sorrendjét is megkeverjük naponta
    const idxs = [0, 1, 2, 3]
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[idxs[i], idxs[j]] = [idxs[j], idxs[i]]
    }
    return {
      q: base.q,
      opts: idxs.map(i => base.opts[i]),
      ans: idxs.indexOf(base.ans),
    }
  }
  const kind = (Math.floor(rng() * 5) + dayOffset(day) + index) % 5
  let q = '', right = 0
  if (kind === 0) {
    const a = 14 + Math.floor(rng() * 45)
    const b = 12 + Math.floor(rng() * 42)
    right = a + b
    q = `${a} + ${b} = ?`
  } else if (kind === 1) {
    const a = 35 + Math.floor(rng() * 60)
    const b = 12 + Math.floor(rng() * 32)
    right = a - b
    q = `${a} − ${b} = ?`
  } else if (kind === 2) {
    const a = 4 + Math.floor(rng() * 12)
    const b = 3 + Math.floor(rng() * 12)
    right = a * b
    q = `${a} × ${b} = ?`
  } else if (kind === 3) {
    const b = 3 + Math.floor(rng() * 10)
    right = 4 + Math.floor(rng() * 12)
    const a = b * right
    q = `${a} ÷ ${b} = ?`
  } else {
    const a = 3 + Math.floor(rng() * 9)
    const b = 2 + Math.floor(rng() * 7)
    const c = 4 + Math.floor(rng() * 15)
    right = a * b + c
    q = `${a} × ${b} + ${c} = ?`
  }
  const deltas = [-10, -4, -3, -2, -1, 1, 2, 3, 4, 10]
  const wrongs = new Set<number>()
  while (wrongs.size < 3) {
    const d = deltas[Math.floor(rng() * deltas.length)]
    const cand = right + d
    if (cand !== right && cand > 0) wrongs.add(cand)
  }
  const all = [right, ...Array.from(wrongs)]
  // Megkeverjük
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return {
    q,
    opts: all.map(String),
    ans: all.indexOf(right),
  }
}

const LB_PREFIX = 'csengeto-arena-lb-'

function loadLocalLb(day: string): LeaderEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LB_PREFIX + day) ?? '[]') || []
    return Array.isArray(raw) ? raw.filter(item => item && item.name && !isAnonymousName(item.name) && checkProfanity(item.name).clean) : []
  } catch {
    return []
  }
}

function saveLocalLb(day: string, list: LeaderEntry[]) {
  try {
    const cleanList = list.filter(item => item && item.name && !isAnonymousName(item.name) && checkProfanity(item.name).clean)
    localStorage.setItem(LB_PREFIX + day, JSON.stringify(cleanList))
  } catch { /* ignore */ }
}

function mergeLeaderboard(existing: LeaderEntry[], incoming: LeaderEntry): LeaderEntry[] {
  const byId = new Map<string, LeaderEntry>()
  for (const item of [...existing, incoming]) {
    if (!item || !item.name || isAnonymousName(item.name) || !checkProfanity(item.name).clean || item.score <= 0) continue
    const key = `${item.playerId || normalizePlayerNameKey(item.name)}-${item.mode}`
    const prev = byId.get(key)
    if (!prev || item.score > prev.score || (item.score === prev.score && item.at >= prev.at)) {
      byId.set(key, item)
    }
  }
  const byName = new Map<string, LeaderEntry>()
  for (const item of byId.values()) {
    const nKey = `${normalizePlayerNameKey(item.name)}-${item.mode}`
    const prev = byName.get(nKey)
    if (!prev || item.score > prev.score || (item.score === prev.score && item.at < prev.at)) {
      byName.set(nKey, item)
    }
  }
  return Array.from(byName.values())
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, 24)
}

export function useArenaLeaderboard(schoolId: string | undefined, day: string) {
  const [board, setBoard] = useState<LeaderEntry[]>(() => loadLocalLb(day))
  const chanRef = useRef<any>(null)
  const bcRef = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    setBoard(loadLocalLb(day))
  }, [day])

  useEffect(() => {
    if (!schoolId || !day) return
    let alive = true

    const loadBoard = async (force = false) => {
      if (!force && document.hidden) return
      const { data, error } = await supabase.rpc('get_arena_leaderboard', { p_school: schoolId, p_day: day })
      if (!alive || error || !Array.isArray(data)) return
      let next: LeaderEntry[] = []
      for (const r of data as any[]) {
        next = mergeLeaderboard(next, {
          playerId: r.player_id,
          name: r.player_name,
          mode: r.mode === 'quiz' ? 'quiz' : r.mode === 'snake' ? 'snake' : 'reflex',
          score: r.score,
          at: Date.parse(r.created_at) || Date.now(),
        })
      }
      setBoard(next)
      saveLocalLb(day, next)
    }

    loadBoard(true)
    const pollTimer = window.setInterval(() => loadBoard(false), 20_000)

    // Realtime csatorna + egyedi DB postgres_changes csatorna
    const ch = supabase.channel(`sulibell-arena-${schoolId}`, {
      config: { broadcast: { self: false } },
    })
    ch.on('broadcast', { event: 'score' }, (msg: any) => {
      const payload = msg?.payload
      if (!alive || !payload?.entry) return
      setBoard(prev => {
        const next = mergeLeaderboard(prev, payload.entry)
        saveLocalLb(day, next)
        return next
      })
    })
    ch.on('broadcast', { event: 'delete_score' }, (msg: any) => {
      const { playerId, name, mode } = msg?.payload || {}
      if (!alive) return
      setBoard(prev => {
        const next = prev.filter(x => {
          if (playerId && x.playerId === playerId && (!mode || x.mode === mode)) return false
          if (name && x.name.toLowerCase() === name.toLowerCase() && (!mode || x.mode === mode)) return false
          return true
        })
        saveLocalLb(day, next)
        return next
      })
    })
    ch.on('broadcast', { event: 'clear_scores' }, () => {
      if (!alive) return
      setBoard([])
      saveLocalLb(day, [])
    })
    ch.subscribe()
    chanRef.current = ch

    const pgCh = supabase
      .channel(`sulibell-arena-pg-${schoolId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arena_scores', filter: `school_id=eq.${schoolId}` }, () => {
        loadBoard(true)
      })
      .subscribe()

    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel(`sulibell-arena-${schoolId}`)
      bc.onmessage = ev => {
        if (!alive || !ev.data) return
        if (ev.data.type === 'delete_score') {
          const { playerId, name, mode } = ev.data
          setBoard(prev => {
            const next = prev.filter(x => {
              if (playerId && x.playerId === playerId && (!mode || x.mode === mode)) return false
              if (name && x.name.toLowerCase() === name.toLowerCase() && (!mode || x.mode === mode)) return false
              return true
            })
            saveLocalLb(day, next)
            return next
          })
          return
        }
        if (ev.data.type === 'clear_scores') {
          setBoard([])
          saveLocalLb(day, [])
          return
        }
        if (ev.data.entry) {
          setBoard(prev => {
            const next = mergeLeaderboard(prev, ev.data.entry)
            saveLocalLb(day, next)
            return next
          })
        }
      }
      bcRef.current = bc
    } catch { /* ignore */ }

    const onWake = () => { if (!document.hidden) loadBoard(true) }
    const onRefresh = () => { loadBoard(true) }
    window.addEventListener('sulibell:refresh', onRefresh)
    document.addEventListener('visibilitychange', onWake)
    document.addEventListener('resume', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('pageshow', onWake)

    return () => {
      alive = false
      clearInterval(pollTimer)
      window.removeEventListener('sulibell:refresh', onRefresh)
      document.removeEventListener('visibilitychange', onWake)
      document.removeEventListener('resume', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('pageshow', onWake)
      supabase.removeChannel(ch)
      supabase.removeChannel(pgCh)
      chanRef.current = null
      try { bc?.close() } catch { /* ignore */ }
      bcRef.current = null
    }
  }, [schoolId, day])

  const submitScore = useCallback((name: string, mode: ArenaMode, score: number) => {
    if (score <= 0) return
    const validation = validatePlayerName(name, true)
    if (!validation.valid || !validation.cleanName) return
    const cleanName = validation.cleanName
    const entry: LeaderEntry = {
      playerId: voterId(),
      name: cleanName,
      mode,
      score,
      at: Date.now(),
    }

    setBoard(prev => {
      const prevTop = prev.filter(x => x.mode === mode)[0]?.score ?? 0
      const next = mergeLeaderboard(prev, entry)
      saveLocalLb(day, next)
      if (score > prevTop && score >= 50) {
        window.dispatchEvent(new CustomEvent('sulibell:celebrate', { detail: { kind: 'confetti', power: 1.1 } }))
      }
      return next
    })

    chanRef.current?.send({
      type: 'broadcast',
      event: 'score',
      payload: { entry },
    }).catch?.(() => {})
    try { bcRef.current?.postMessage({ entry }) } catch { /* ignore */ }

    if (schoolId) {
      supabase.rpc('submit_arena_score', {
        p_school: schoolId,
        p_day: day,
        p_player: entry.playerId,
        p_name: entry.name,
        p_mode: entry.mode,
        p_score: entry.score,
      }).then(() => {})
    }
  }, [schoolId, day])

  const removeLeaderEntry = useCallback(async (playerId?: string, mode?: string, name?: string) => {
    setBoard(prev => {
      const next = prev.filter(x => {
        if (playerId && x.playerId === playerId && (!mode || x.mode === mode)) return false
        if (name && x.name.toLowerCase() === name.toLowerCase() && (!mode || x.mode === mode)) return false
        return true
      })
      saveLocalLb(day, next)
      return next
    })

    chanRef.current?.send({
      type: 'broadcast',
      event: 'delete_score',
      payload: { playerId, name, mode },
    }).catch?.(() => {})
    try { bcRef.current?.postMessage({ type: 'delete_score', playerId, name, mode }) } catch { /* ignore */ }

    if (schoolId) {
      let q = supabase.from('arena_scores').delete().eq('school_id', schoolId).eq('day', day)
      if (playerId) q = q.eq('player_id', playerId)
      if (mode) q = q.eq('mode', mode)
      if (name && !playerId) q = q.eq('player_name', name)
      await q.then(() => {})
    }
  }, [schoolId, day])

  const clearLeaderboard = useCallback(async () => {
    setBoard([])
    saveLocalLb(day, [])

    chanRef.current?.send({
      type: 'broadcast',
      event: 'clear_scores',
      payload: {},
    }).catch?.(() => {})
    try { bcRef.current?.postMessage({ type: 'clear_scores' }) } catch { /* ignore */ }

    if (schoolId) {
      await supabase.from('arena_scores').delete().eq('school_id', schoolId).eq('day', day).then(() => {})
    }
  }, [schoolId, day])

  return { board, submitScore, removeLeaderEntry, clearLeaderboard }
}

interface CellTarget {
  cell: number
  kind: 'normal' | 'gold' | 'bomb'
  born: number
}

const PLAYS_PREFIX = 'csengeto-arena-plays-'
const QOFFSET_PREFIX = 'csengeto-arena-qoffset-'
const OLD_PLAYED_PREFIX = 'csengeto-arena-played-'

function pruneOldArenaDays(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (!k) continue
      if (
        (k.startsWith(PLAYS_PREFIX) && k !== PLAYS_PREFIX + day) ||
        (k.startsWith(QOFFSET_PREFIX) && k !== QOFFSET_PREFIX + day) ||
        (k.startsWith(OLD_PLAYED_PREFIX) && k !== OLD_PLAYED_PREFIX + day)
      ) {
        localStorage.removeItem(k)
      }
    }
  } catch { /* ignore */ }
}

function loadBreakPlays(day: string): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAYS_PREFIX + day) ?? '{}')
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const clean: Record<string, number> = {}
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) clean[k] = Math.floor(v)
      }
      return clean
    }
    return {}
  } catch {
    return {}
  }
}

function saveBreakPlays(day: string, map: Record<string, number>) {
  try {
    localStorage.setItem(PLAYS_PREFIX + day, JSON.stringify(map))
  } catch { /* ignore */ }
}

function loadQuizOffset(day: string): number {
  try {
    const n = Number(localStorage.getItem(QOFFSET_PREFIX + day) ?? '0')
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
  } catch {
    return 0
  }
}

function saveQuizOffset(day: string, offset: number) {
  try {
    localStorage.setItem(QOFFSET_PREFIX + day, String(Math.max(0, Math.floor(offset))))
  } catch { /* ignore */ }
}

export default memo(function Arena({
  schoolId,
  day,
  phase,
  breakKey,
  breakTotalSec,
  tv,
  sound,
}: {
  schoolId?: string
  day: string
  phase: string
  breakKey?: string
  breakTotalSec?: number
  tv?: boolean
  sound?: boolean
}) {
  const { board, submitScore } = useArenaLeaderboard(schoolId, day)
  const { champions, myTier, frameEnabled, toggleFrame, justWon, refresh: refreshChampions } = useChampions(schoolId, day)
  const [tab, setTab] = useState<ArenaMode>('reflex')
  const [raceTab, setRaceTab] = useState<'week' | 'month'>('week')
  const profile = usePlayerProfile(schoolId)
  const name = profile.valid ? profile.cleanName : ''
  const [nameError, setNameError] = useState('')
  const [openDuringLesson, setOpenDuringLesson] = useState(false)

  const [breakPlays, setBreakPlays] = useState<Record<string, number>>(() => loadBreakPlays(day))
  const [qBaseIdx, setQBaseIdx] = useState(() => loadQuizOffset(day))

  const isBreak = phase === 'break' && (breakTotalSec ?? 0) <= 3600
  const currentBreakId = isBreak && breakKey ? breakKey : ''
  const breakMins = Math.round((breakTotalSec ?? 600) / 60)
  const isLongBreak = (breakTotalSec ?? 0) > 600
  const maxPlaysPerBreak = isLongBreak ? Math.max(3, Math.floor(breakMins / 5)) : 1
  const reflexPlayCount = currentBreakId ? (breakPlays[`${currentBreakId}:reflex`] ?? 0) : 0
  const quizPlayCount = currentBreakId ? (breakPlays[`${currentBreakId}:quiz`] ?? 0) : 0
  const snakePlayCount = currentBreakId ? (breakPlays[`${currentBreakId}:snake`] ?? 0) : 0
  const reflexLocked = !!currentBreakId && reflexPlayCount >= maxPlaysPerBreak
  const quizLocked = !!currentBreakId && quizPlayCount >= maxPlaysPerBreak
  const snakeLocked = !!currentBreakId && snakePlayCount >= maxPlaysPerBreak
  const reflexLeft = currentBreakId ? Math.max(0, maxPlaysPerBreak - reflexPlayCount) : null
  const quizLeft = currentBreakId ? Math.max(0, maxPlaysPerBreak - quizPlayCount) : null
  const snakeLeft = currentBreakId ? Math.max(0, maxPlaysPerBreak - snakePlayCount) : null

  const markBreakPlayed = useCallback((mode: ArenaMode) => {
    if (!currentBreakId) return
    const k = `${currentBreakId}:${mode}`
    setBreakPlays(prev => {
      const latest = loadBreakPlays(day)
      const next = { ...prev, ...latest, [k]: Math.max(prev[k] ?? 0, latest[k] ?? 0) + 1 }
      saveBreakPlays(day, next)
      return next
    })
  }, [day, currentBreakId])

  // --- Reflex játék állapot ---
  const [rState, setRState] = useState<'idle' | 'play' | 'over'>('idle')
  const [rScore, setRScore] = useState(0)
  const [rCombo, setRCombo] = useState(1)
  const [rTime, setRTime] = useState(20)
  const [targets, setTargets] = useState<CellTarget[]>([])

  // --- Kvíz játék állapot ---
  const [qState, setQState] = useState<'idle' | 'play' | 'over'>('idle')
  const [qScore, setQScore] = useState(0)
  const [qStreak, setQStreak] = useState(0)
  const [qTime, setQTime] = useState(30)
  const [qIdx, setQIdx] = useState(0)
  const [qFlash, setQFlash] = useState<'ok' | 'bad' | null>(null)

  useEffect(() => {
    pruneOldArenaDays(day)
    setBreakPlays(loadBreakPlays(day))
    setQBaseIdx(loadQuizOffset(day))
    setQIdx(0)
  }, [day])

  useEffect(() => {
    if (profile.valid && nameError) {
      setNameError('')
    }
  }, [profile.valid, nameError])

  // Reflex játék időzítő és célpont-generálás
  useEffect(() => {
    if (rState !== 'play') return
    const timer = setInterval(() => {
      setRTime(t => {
        if (t <= 1) {
          setRState('over')
          return 0
        }
        return t - 1
      })
    }, 1000)

    const spawner = setInterval(() => {
      const now = Date.now()
      setTargets(prev => {
        const fresh = prev.filter(x => now - x.born < (x.kind === 'gold' ? 1150 : 1650))
        if (fresh.length >= 3) return fresh
        const used = new Set(fresh.map(x => x.cell))
        const free = Array.from({ length: 12 }, (_, i) => i).filter(i => !used.has(i))
        if (!free.length) return fresh
        const cell = free[Math.floor(Math.random() * free.length)]
        const r = Math.random()
        const kind: CellTarget['kind'] = r < 0.16 ? 'gold' : r < 0.28 ? 'bomb' : 'normal'
        return [...fresh, { cell, kind, born: now }]
      })
    }, 420)

    return () => {
      clearInterval(timer)
      clearInterval(spawner)
    }
  }, [rState])

  // Ha véget ér a Reflex játék, beküldjük a pontszámot
  const rSubmitted = useRef(false)
  useEffect(() => {
    if (rState === 'over' && !rSubmitted.current) {
      rSubmitted.current = true
      submitScore(name, 'reflex', rScore)
      window.setTimeout(() => void refreshChampions(), 400)
    }
  }, [rState, rScore, name, submitScore, refreshChampions])

  const startReflex = () => {
    if (reflexLocked) {
      setNameError(
        maxPlaysPerBreak > 1
          ? `Ebben a ${breakMins} perces szünetben már elérted a ${maxPlaysPerBreak} játékos limitet!`
          : 'Ebben a szünetben már játszottál! Szünetenként 1 játék engedélyezett.'
      )
      return
    }
    if (!profile.valid) {
      setNameError(profile.validationError || 'A játékhoz add meg a neved a Játékosprofil kártyán!')
      focusPlayerProfile()
      return
    }
    markBreakPlayed('reflex')
    setNameError('')
    rSubmitted.current = false
    setRScore(0)
    setRCombo(1)
    setRTime(20)
    setTargets([
      { cell: Math.floor(Math.random() * 12), kind: 'normal', born: Date.now() },
    ])
    setRState('play')
  }

  const hitCell = (idx: number) => {
    if (rState !== 'play') return
    const hit = targets.find(t => t.cell === idx)
    if (!hit) {
      setRCombo(1)
      return
    }
    setTargets(prev => prev.filter(t => t.cell !== idx))
    if (hit.kind === 'bomb') {
      if (sound) fxSound('boom', 0)
      setRCombo(1)
      setRScore(s => Math.max(0, s - 15))
    } else {
      if (sound) fxSound('pop', ((idx % 4) - 1.5) / 2)
      const base = hit.kind === 'gold' ? 25 : 10
      setRScore(s => s + base * rCombo)
      setRCombo(c => Math.min(5, c + 1))
    }
  }

  // Kvíz időzítő
  useEffect(() => {
    if (qState !== 'play') return
    const timer = setInterval(() => {
      setQTime(t => {
        if (t <= 1) {
          setQState('over')
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [qState])

  const qSubmitted = useRef(false)
  useEffect(() => {
    if (qState === 'over' && !qSubmitted.current) {
      qSubmitted.current = true
      submitScore(name, 'quiz', qScore)
      window.setTimeout(() => void refreshChampions(), 400)
    }
  }, [qState, qScore, name, submitScore, refreshChampions])

  const startQuiz = () => {
    if (quizLocked) {
      setNameError(
        maxPlaysPerBreak > 1
          ? `Ebben a ${breakMins} perces szünetben már elérted a ${maxPlaysPerBreak} kvízjátékos limitet!`
          : 'Ebben a szünetben már játszottál! Szünetenként 1 játék engedélyezett.'
      )
      return
    }
    if (!profile.valid) {
      setNameError(profile.validationError || 'A kvízhez add meg a neved a Játékosprofil kártyán!')
      focusPlayerProfile()
      return
    }
    markBreakPlayed('quiz')
    setNameError('')
    qSubmitted.current = false
    setQScore(0)
    setQStreak(0)
    setQTime(30)
    setQBaseIdx(loadQuizOffset(day))
    setQIdx(0)
    setQState('play')
  }

  const answerQuiz = (optIndex: number) => {
    if (qState !== 'play') return
    const absIdx = qBaseIdx + qIdx
    const cur = makeDailyQuestion(day, absIdx)
    if (optIndex === cur.ans) {
      if (sound) fxSound('pop', 0)
      const bonus = 15 + qStreak * 5
      setQScore(s => s + bonus)
      setQStreak(s => s + 1)
      setQTime(t => t + 5)
      setQFlash('ok')
    } else {
      if (sound) fxSound('boom', 0)
      setQStreak(0)
      setQScore(s => Math.max(0, s - 5))
      setQTime(t => {
        const next = Math.max(0, t - 10)
        if (next <= 0) setQState('over')
        return next
      })
      setQFlash('bad')
    }
    saveQuizOffset(day, absIdx + 1)
    setTimeout(() => setQFlash(null), 260)
    setQIdx(i => i + 1)
  }

  const modeChip = (m: ArenaMode) => (m === 'quiz' ? '🧠 Kvíz' : m === 'snake' ? '🐍 Snake' : '⚡ Reflex')
  const renderChampBadge = (pid: string) => {
    const tier = getChampionBadge(champions, pid)
    if (!tier) return null
    return (
      <span className={`champ-badge ${tier}`} title={tier === 'monthly' ? 'Havi Nagy Győztes' : 'Heti Nagy Győztes'}>
        {tier === 'monthly' ? '💎 Havi Bajnok' : '🏆 Heti Bajnok'}
      </span>
    )
  }

  const modeBoard = board.filter(b => b.mode === tab).slice(0, 5)
  const curQ = makeDailyQuestion(day, qBaseIdx + qIdx)

  // TV nézet: kompakt Napi Toplista kártya + Nagy Győztes sáv
  if (tv) {
    if (board.length === 0 && !champions.weeklyChampion && !champions.monthlyChampion) return null
    const top4 = board.slice(0, 4)
    return (
      <section className="panel arena-tv">
        <div className="tag" style={{ marginBottom: 6 }}>🏆 Szüneti Aréna — Napi Toplista</div>
        {top4.length > 0 && (
          <ol className="arena-lb">
            {top4.map((b, i) => (
              <li key={`${b.playerId}-${b.mode}-${i}`} className={i === 0 ? 'gold' : ''}>
                <span className="rk">{i === 0 ? '👑' : `${i + 1}.`}</span>
                <b>
                  {b.name}
                  {renderChampBadge(b.playerId)}
                </b>
                <span className="chip">{modeChip(b.mode)}</span>
                <strong className="pts">{b.score} p</strong>
              </li>
            ))}
          </ol>
        )}
        {(champions.weeklyChampion || champions.monthlyChampion) && (
          <div className="tv-champ-bar">
            {champions.weeklyChampion && (
              <span>🏆 Heti Bajnok: <b>{champions.weeklyChampion.name}</b> ({champions.weeklyChampion.wins} győzelem)</span>
            )}
            {champions.monthlyChampion && (
              <span>💎 Havi Bajnok: <b>{champions.monthlyChampion.name}</b> ({champions.monthlyChampion.wins} győzelem)</span>
            )}
          </div>
        )}
      </section>
    )
  }

  const inLesson = phase === 'lesson'
  const collapsed = inLesson && !openDuringLesson && rState !== 'play' && qState !== 'play'

  return (
    <section className="panel arena">
      <div className="arena-head">
        <div className="tag" style={{ margin: 0 }}>🎮 Szüneti Mini-Aréna &amp; Napi Toplista</div>
        {inLesson && (
          <button type="button" onClick={() => setOpenDuringLesson(v => !v)}>
            {collapsed ? 'Megnyitás óra alatt is' : 'Elrejtés'}
          </button>
        )}
      </div>

      {collapsed ? (
        <div className="arena-collapsed">
          <span>📚 Most tanóra van — a Mini-Aréna a következő szünetben automatikusan kinyílik!</span>
          {board[0] && (
            <span>
              👑 Mai rekorder: <b>{board[0].name}</b> ({board[0].score} pont)
            </span>
          )}
        </div>
      ) : (
        <div className="arena-grid">
          <div className="arena-play">
            <div className="arena-bar">
              <div className="arena-tabs">
                <button
                  type="button"
                  className={tab === 'reflex' ? 'on' : ''}
                  onClick={() => setTab('reflex')}
                >
                  ⚡ Csengő-Reflex (20 mp)
                </button>
                <button
                  type="button"
                  className={tab === 'quiz' ? 'on' : ''}
                  onClick={() => setTab('quiz')}
                >
                  🧠 Napi Villámkvíz (30 mp)
                </button>
                <button
                  type="button"
                  className={tab === 'snake' ? 'on' : ''}
                  onClick={() => setTab('snake')}
                >
                  🐍 Neon Snake
                </button>
              </div>
              <div className="arena-name-wrap">
                {profile.valid ? (
                  <button
                    type="button"
                    className="profile-chip"
                    onClick={() => focusPlayerProfile()}
                    title="Játékosprofil szerkesztése"
                  >
                    <span>👤 {name}</span>
                    <small>✏️</small>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="profile-chip-cta"
                    onClick={() => focusPlayerProfile()}
                  >
                    👤 Név beállítása
                  </button>
                )}
              </div>
            </div>

            {nameError && (
              <div className="arena-name-warn" role="alert" style={{ color: '#ff3b5c', padding: '6px 12px', fontSize: '0.85rem', fontWeight: 600, background: 'rgba(255, 59, 92, 0.1)', borderRadius: 8, marginBottom: 8 }}>
                ⚠️ {nameError}
              </div>
            )}

            {tab === 'reflex' ? (
              <div className="reflex-box">
                <div className="arena-hud">
                  <span>Pont: <b>{rScore}</b></span>
                  <span>Kombo: <b className="combo">{rCombo}×</b></span>
                  <span>Idő: <b>{rTime} mp</b></span>
                </div>

                <div className="reflex-grid">
                  {Array.from({ length: 12 }, (_, idx) => {
                    const t = targets.find(x => x.cell === idx)
                    return (
                      <button
                        key={idx}
                        type="button"
                        className={`rcell ${t ? `active ${t.kind}` : ''}`}
                        onClick={() => hitCell(idx)}
                        aria-label={`Mező ${idx + 1}`}
                      >
                        {t?.kind === 'gold' ? '⭐' : t?.kind === 'bomb' ? '💣' : t ? '⚡' : ''}
                      </button>
                    )
                  })}

                  {rState !== 'play' && (
                    <div className="arena-over">
                      {rState === 'over' && <h3>🎉 Vége! Pontszámod: {rScore}</h3>}
                      <p>Kapd el a felvillanó ⚡ (+10) és ⭐ (+25) csempéket, de kerüld a 💣 bombát!</p>
                      {!profile.valid && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, margin: '4px 0' }}>
                          <p style={{ color: '#ffb02e', fontSize: '0.85rem', margin: 0 }}>
                            🔒 {profile.validationError || 'Add meg a neved a Játékosprofil kártyán a játék indításához!'}
                          </p>
                          <button type="button" className="profile-chip-cta" onClick={() => focusPlayerProfile()}>
                            👤 Név megadása
                          </button>
                        </div>
                      )}
                      {reflexLocked ? (
                        <p style={{ color: '#facc15', fontSize: '0.85rem', margin: '4px 0', fontWeight: 600 }}>
                          {maxPlaysPerBreak > 1
                            ? `⏸️ Ebben a ${breakMins} perces szünetben már lejátszottad mind a(z) ${maxPlaysPerBreak} engedélyezett Reflex kört! A következő szünetben újra játszhatsz.`
                            : '⏸️ Ebben a szünetben már játszottál! Szünetenként 1 játék engedélyezett, a következő szünetben újra játszhatsz!'}
                        </p>
                      ) : isLongBreak && reflexLeft !== null ? (
                        <p style={{ color: '#4ade80', fontSize: '0.85rem', margin: '4px 0', fontWeight: 600 }}>
                          ⏱️ Hosszú szünet ({breakMins} perc): ebben a szünetben még {reflexLeft} / {maxPlaysPerBreak} Reflex kör indítható!
                        </p>
                      ) : !isBreak && phase !== 'lesson' && (
                        <p style={{ color: '#4ade80', fontSize: '0.85rem', margin: '4px 0', fontWeight: 600 }}>
                          🎉 Tanítási szüneten kívül (pl. téli szünet, hétvége): korlátlan a játék!
                        </p>
                      )}
                      <button type="button" className="cta" onClick={startReflex} disabled={reflexLocked}>
                        {reflexLocked
                          ? '⏸️ Elérted a szüneti limitet'
                          : rState === 'over'
                            ? isLongBreak && reflexLeft !== null
                              ? `🔄 Újra próbálom (még ${reflexLeft}/${maxPlaysPerBreak})`
                              : '🔄 Újra próbálom'
                            : isLongBreak && reflexLeft !== null
                              ? `⚡ Játék indítása (20 mp • ${reflexLeft}/${maxPlaysPerBreak})`
                              : '⚡ Játék indítása (20 mp)'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : tab === 'quiz' ? (
              <div className={`quiz-box ${qFlash ? `flash-${qFlash}` : ''}`}>
                <div className="arena-hud">
                  <span>Pont: <b>{qScore}</b></span>
                  <span>Széria: <b className="combo">🔥 {qStreak}</b></span>
                  <span>
                    Idő: <b>{qTime} mp</b>
                    {qFlash === 'ok' && <b style={{ color: '#4ade80', marginLeft: 6 }}>+5 mp</b>}
                    {qFlash === 'bad' && <b style={{ color: '#ff4f6a', marginLeft: 6 }}>−10 mp</b>}
                  </span>
                </div>

                <div className="quiz-stage">
                  {qState === 'play' ? (
                    <>
                      <div className="quiz-q">
                        <small>{qIdx + 1}. kérdés</small>
                        <h3>{curQ.q}</h3>
                      </div>
                      <div className="quiz-opts">
                        {curQ.opts.map((o, i) => (
                          <button key={i} type="button" onClick={() => answerQuiz(i)}>
                            {o}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="arena-over static">
                      {qState === 'over' && <h3>🎉 Szép munka! Pontszámod: {qScore}</h3>}
                      <p>Mindenki ugyanazt a napi feladatsort kapja! Helyes válasz: <b>+5 mp</b>, hibás válasz: <b>−10 mp</b>.</p>
                      {!profile.valid && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, margin: '4px 0' }}>
                          <p style={{ color: '#ffb02e', fontSize: '0.85rem', margin: 0 }}>
                            🔒 {profile.validationError || 'Add meg a neved a Játékosprofil kártyán a kvíz indításához!'}
                          </p>
                          <button type="button" className="profile-chip-cta" onClick={() => focusPlayerProfile()}>
                            👤 Név megadása
                          </button>
                        </div>
                      )}
                      {quizLocked ? (
                        <p style={{ color: '#facc15', fontSize: '0.85rem', margin: '4px 0', fontWeight: 600 }}>
                          {maxPlaysPerBreak > 1
                            ? `⏸️ Ebben a ${breakMins} perces szünetben már lejátszottad mind a(z) ${maxPlaysPerBreak} engedélyezett Kvíz kört! A következő szünetben újra játszhatsz.`
                            : '⏸️ Ebben a szünetben már játszottál! Szünetenként 1 játék engedélyezett, a következő szünetben újra játszhatsz!'}
                        </p>
                      ) : isLongBreak && quizLeft !== null ? (
                        <p style={{ color: '#4ade80', fontSize: '0.85rem', margin: '4px 0', fontWeight: 600 }}>
                          ⏱️ Hosszú szünet ({breakMins} perc): ebben a szünetben még {quizLeft} / {maxPlaysPerBreak} Kvíz kör indítható (új kérdésekkel)!
                        </p>
                      ) : !isBreak && phase !== 'lesson' && (
                        <p style={{ color: '#4ade80', fontSize: '0.85rem', margin: '4px 0', fontWeight: 600 }}>
                          🎉 Tanítási szüneten kívül (pl. téli szünet, hétvége): korlátlan a játék!
                        </p>
                      )}
                      <button type="button" className="cta" onClick={startQuiz} disabled={quizLocked}>
                        {quizLocked
                          ? '⏸️ Elérted a szüneti limitet'
                          : qState === 'over'
                            ? isLongBreak && quizLeft !== null
                              ? `🔄 Újra próbálom (még ${quizLeft}/${maxPlaysPerBreak})`
                              : '🔄 Újra próbálom'
                            : isLongBreak && quizLeft !== null
                              ? `🧠 Kvíz indítása (30 mp • ${quizLeft}/${maxPlaysPerBreak})`
                              : '🧠 Kvíz indítása (30 mp)'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="arena-snake-wrap">
                <SnakeGame
                  tv={false}
                  championTier={myTier}
                  locked={snakeLocked}
                  lockMessage={
                    maxPlaysPerBreak > 1
                      ? `Ebben a ${breakMins} perces szünetben már elérted a ${maxPlaysPerBreak} Snake kört!`
                      : 'Ebben a szünetben már játszottál Snake-et! A következő szünetben újra játszhatsz.'
                  }
                  playsHint={
                    snakeLocked
                      ? maxPlaysPerBreak > 1
                        ? `⏸️ Ebben a ${breakMins} perces szünetben már lejátszottad mind a(z) ${maxPlaysPerBreak} Snake kört!`
                        : '⏸️ Ebben a szünetben már játszottál! Szünetenként 1 Snake kör engedélyezett.'
                      : isLongBreak && snakeLeft !== null
                        ? `⏱️ Hosszú szünet (${breakMins} perc): még ${snakeLeft} / ${maxPlaysPerBreak} Snake kör indítható!`
                        : !isBreak && phase !== 'lesson'
                          ? '🎉 Tanítási szüneten kívül: korlátlan a játék!'
                          : null
                  }
                  schoolId={schoolId}
                  sound={sound}
                  onStartPlay={() => markBreakPlayed('snake')}
                  onGameOver={(pts) => {
                    submitScore(name, 'snake', pts)
                    window.setTimeout(() => void refreshChampions(), 400)
                  }}
                />
              </div>
            )}
          </div>

          <div className="arena-side">
            <div className="tag" style={{ marginBottom: 10 }}>
              🏆 Mai Toplista ({modeChip(tab)})
            </div>
            {modeBoard.length === 0 ? (
              <p className="meta">Még senki nem szerzett pontot ma ebben a módban. Legyél te az első!</p>
            ) : (
              <ol className="arena-lb">
                {modeBoard.map((b, i) => (
                  <li key={`${b.playerId}-${i}`} className={i === 0 ? 'gold' : ''}>
                    <span className="rk">{i === 0 ? '👑' : `${i + 1}.`}</span>
                    <b>
                      {b.name}
                      {renderChampBadge(b.playerId)}
                    </b>
                    <strong className="pts">{b.score} p</strong>
                  </li>
                ))}
              </ol>
            )}

            <div className="champ-box">
              <div className="champ-head">
                <div className="tag" style={{ margin: 0 }}>👑 Heti &amp; Havi Nagy Győztesek</div>
                <small className="champ-sub">Minden napi #1 helyezés (Reflex, Kvíz, Snake) 1 győzelmet ér!</small>
              </div>

              {myTier && (
                <div className={`champ-reward ${myTier}`}>
                  <div className="champ-reward-txt">
                    <b>
                      {justWon ? '🎉 Gratulálunk, új bajnoki cím! ' : '✨ Aktív bajnok: '}
                      {myTier === 'monthly' ? '💎 Havi Nagy Győztes vagy!' : '🏆 Heti Nagy Győztes vagy!'}
                    </b>
                    <small>Feloldva: 👑 Arany Bajnok Snake skin + exkluzív {myTier === 'monthly' ? 'gyémánt' : 'arany'} oldalkeret</small>
                  </div>
                  <button type="button" className={frameEnabled ? 'on' : ''} onClick={toggleFrame}>
                    {frameEnabled ? '✨ Keret: BE' : '✨ Keret: KI'}
                  </button>
                </div>
              )}

              <div className="champ-cards">
                <div className="champ-card weekly">
                  <span className="champ-label">🏆 Heti Nagy Győztes</span>
                  {champions.weeklyChampion ? (
                    <>
                      <b>{champions.weeklyChampion.name}</b>
                      <small>{champions.weeklyChampion.wins} napi győzelem • {champions.weeklyChampion.totalScore} p</small>
                    </>
                  ) : (
                    <small style={{ opacity: 0.75 }}>Még nincs előző heti győztes</small>
                  )}
                </div>
                <div className="champ-card monthly">
                  <span className="champ-label">💎 Havi Nagy Győztes ({champions.prevMonthLabel})</span>
                  {champions.monthlyChampion ? (
                    <>
                      <b>{champions.monthlyChampion.name}</b>
                      <small>{champions.monthlyChampion.wins} napi győzelem • {champions.monthlyChampion.totalScore} p</small>
                    </>
                  ) : (
                    <small style={{ opacity: 0.75 }}>Még nincs lezárt havi győztes</small>
                  )}
                </div>
              </div>

              <div className="champ-race">
                <div className="champ-race-tabs">
                  <button
                    type="button"
                    className={raceTab === 'week' ? 'on' : ''}
                    onClick={() => setRaceTab('week')}
                  >
                    📅 Ezen a héten ({champions.daysLeftInWeek === 0 ? 'utolsó nap!' : `még ${champions.daysLeftInWeek} nap`})
                  </button>
                  <button
                    type="button"
                    className={raceTab === 'month' ? 'on' : ''}
                    onClick={() => setRaceTab('month')}
                  >
                    🗓️ {champions.curMonthLabel} ({champions.daysLeftInMonth === 0 ? 'utolsó nap!' : `még ${champions.daysLeftInMonth} nap`})
                  </button>
                </div>
                {(() => {
                  const raceList = raceTab === 'week' ? champions.currentWeekTop : champions.currentMonthTop
                  return raceList.length === 0 ? (
                    <p className="meta" style={{ margin: '6px 0 0', fontSize: '0.82rem' }}>
                      Még nincs napi győztes ebben az időszakban — szerezz ma első helyet!
                    </p>
                  ) : (
                    <ol className="arena-lb champ-race-list">
                      {raceList.map(c => (
                        <li key={c.playerId} className={c.rank === 1 ? 'gold' : ''}>
                          <span className="rk">{c.rank === 1 ? '👑' : `${c.rank}.`}</span>
                          <b>{c.name}</b>
                          <span className="pts">{c.wins} győzelem</span>
                        </li>
                      ))}
                    </ol>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
})
