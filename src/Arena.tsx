import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { fxSound } from './lib/sound'
import { voterId } from './Poll'

export interface LeaderEntry {
  playerId: string
  name: string
  mode: 'reflex' | 'quiz'
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

function makeDailyQuestion(day: string, index: number): QuizQ {
  const rng = seededRng(`${day}-q-${index}`)
  // Minden 3. kérdés tudáspróba, a többi pörgős fejszámolás
  if (index % 3 === 1) {
    const pick = TRIVIA_BANK[Math.floor(rng() * TRIVIA_BANK.length)]
    return pick
  }
  const kind = Math.floor(rng() * 3)
  let q = '', right = 0
  if (kind === 0) {
    const a = 12 + Math.floor(rng() * 38)
    const b = 11 + Math.floor(rng() * 35)
    right = a + b
    q = `${a} + ${b} = ?`
  } else if (kind === 1) {
    const a = 30 + Math.floor(rng() * 55)
    const b = 11 + Math.floor(rng() * 28)
    right = a - b
    q = `${a} − ${b} = ?`
  } else {
    const a = 4 + Math.floor(rng() * 11)
    const b = 3 + Math.floor(rng() * 11)
    right = a * b
    q = `${a} × ${b} = ?`
  }
  const deltas = [-10, -3, -2, -1, 1, 2, 3, 10]
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
const NAME_KEY = 'csengeto-arena-name'

function loadLocalLb(day: string): LeaderEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LB_PREFIX + day) ?? '[]') || []
  } catch {
    return []
  }
}

function saveLocalLb(day: string, list: LeaderEntry[]) {
  try {
    localStorage.setItem(LB_PREFIX + day, JSON.stringify(list))
  } catch { /* ignore */ }
}

function mergeLeaderboard(existing: LeaderEntry[], incoming: LeaderEntry): LeaderEntry[] {
  const map = new Map<string, LeaderEntry>()
  for (const item of [...existing, incoming]) {
    if (!item || !item.name || item.score <= 0) continue
    const key = `${item.playerId || item.name}-${item.mode}`
    const prev = map.get(key)
    if (!prev || item.score > prev.score) {
      map.set(key, item)
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, 12)
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

    // Opcionális DB toplista lekérés (update17.sql)
    supabase.rpc('get_arena_leaderboard', { p_school: schoolId, p_day: day }).then(({ data, error }) => {
      if (!alive || error || !data) return
      setBoard(prev => {
        let next = [...prev]
        for (const r of data as any[]) {
          next = mergeLeaderboard(next, {
            playerId: r.player_id,
            name: r.player_name,
            mode: r.mode === 'quiz' ? 'quiz' : 'reflex',
            score: r.score,
            at: Date.parse(r.created_at) || Date.now(),
          })
        }
        saveLocalLb(day, next)
        return next
      })
    })

    // Realtime csatorna
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
    }).subscribe()
    chanRef.current = ch

    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel(`sulibell-arena-${schoolId}`)
      bc.onmessage = ev => {
        if (!alive || !ev.data?.entry) return
        setBoard(prev => {
          const next = mergeLeaderboard(prev, ev.data.entry)
          saveLocalLb(day, next)
          return next
        })
      }
      bcRef.current = bc
    } catch { /* ignore */ }

    return () => {
      alive = false
      supabase.removeChannel(ch)
      chanRef.current = null
      try { bc?.close() } catch { /* ignore */ }
      bcRef.current = null
    }
  }, [schoolId, day])

  const submitScore = useCallback((name: string, mode: 'reflex' | 'quiz', score: number) => {
    if (score <= 0) return
    const cleanName = (name.trim() || 'Névtelen Diák').slice(0, 22)
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

  return { board, submitScore }
}

interface CellTarget {
  cell: number
  kind: 'normal' | 'gold' | 'bomb'
  born: number
}

export default function Arena({
  schoolId,
  day,
  phase,
  tv,
  sound,
}: {
  schoolId?: string
  day: string
  phase: string
  tv?: boolean
  sound?: boolean
}) {
  const { board, submitScore } = useArenaLeaderboard(schoolId, day)
  const [tab, setTab] = useState<'reflex' | 'quiz'>('reflex')
  const [name, setName] = useState(() => {
    try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' }
  })
  const [openDuringLesson, setOpenDuringLesson] = useState(false)

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

  const saveName = (v: string) => {
    setName(v)
    try { localStorage.setItem(NAME_KEY, v) } catch { /* ignore */ }
  }

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
    }
  }, [rState, rScore, name, submitScore])

  const startReflex = () => {
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
    }
  }, [qState, qScore, name, submitScore])

  const startQuiz = () => {
    qSubmitted.current = false
    setQScore(0)
    setQStreak(0)
    setQTime(30)
    setQIdx(0)
    setQState('play')
  }

  const answerQuiz = (optIndex: number) => {
    if (qState !== 'play') return
    const cur = makeDailyQuestion(day, qIdx)
    if (optIndex === cur.ans) {
      if (sound) fxSound('pop', 0)
      const bonus = 15 + qStreak * 5
      setQScore(s => s + bonus)
      setQStreak(s => s + 1)
      setQFlash('ok')
    } else {
      if (sound) fxSound('boom', 0)
      setQStreak(0)
      setQScore(s => Math.max(0, s - 5))
      setQFlash('bad')
    }
    setTimeout(() => setQFlash(null), 260)
    setQIdx(i => i + 1)
  }

  const modeBoard = board.filter(b => b.mode === tab).slice(0, 5)
  const curQ = makeDailyQuestion(day, qIdx)

  // TV nézet: kompakt Napi Toplista kártya
  if (tv) {
    if (board.length === 0) return null
    const top5 = board.slice(0, 5)
    return (
      <section className="panel arena-tv">
        <div className="tag">🏆 Szüneti Mini-Aréna – Mai Toplista</div>
        <ol className="arena-lb">
          {top5.map((b, i) => (
            <li key={`${b.playerId}-${b.mode}-${i}`} className={i === 0 ? 'gold' : ''}>
              <span className="rk">{i === 0 ? '👑' : `${i + 1}.`}</span>
              <b>{b.name}</b>
              <span className="chip">{b.mode === 'reflex' ? '⚡ Reflex' : '🧠 Kvíz'}</span>
              <strong className="pts">{b.score} pt</strong>
            </li>
          ))}
        </ol>
      </section>
    )
  }

  // Tanóra alatt alapból összecsukva, hogy ne vonja el a figyelmet, de kinyitható
  const collapsed = phase === 'lesson' && !openDuringLesson && rState !== 'play' && qState !== 'play'

  return (
    <section className="panel full arena">
      <div className="arena-head">
        <div>
          <div className="tag" style={{ marginBottom: 4 }}>⚡ Szüneti Mini-Aréna & Napi Toplista</div>
          <p className="meta" style={{ margin: 0 }}>
            20–30 másodperces kihívások az egész iskolának – döntsd meg a napi rekordot!
          </p>
        </div>
        {phase === 'lesson' && (
          <button type="button" onClick={() => setOpenDuringLesson(v => !v)}>
            {collapsed ? '🎮 Megnyitás óra közben' : 'Elrejtés'}
          </button>
        )}
      </div>

      {collapsed ? (
        <div className="arena-collapsed">
          <span>📚 Épp tanóra tart – a Mini-Aréna szünetben automatikusan kinyílik!</span>
          {board[0] && (
            <b>👑 Mai csúcstartó: {board[0].name} ({board[0].score} pt)</b>
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
                  ⚡ Neon Reflex (20 mp)
                </button>
                <button
                  type="button"
                  className={tab === 'quiz' ? 'on' : ''}
                  onClick={() => setTab('quiz')}
                >
                  🧠 Napi Villám-Kvíz (30 mp)
                </button>
              </div>
              <input
                type="text"
                className="arena-name"
                placeholder="Beceneved + osztály (pl. Dani 10.B)"
                maxLength={20}
                value={name}
                onChange={e => saveName(e.target.value)}
              />
            </div>

            {tab === 'reflex' ? (
              <div className="reflex-box">
                <div className="arena-hud">
                  <span>Pont: <b>{rScore}</b></span>
                  <span>Szorzó: <b className="combo">{rCombo}×</b></span>
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
                      {rState === 'over' && <h3>Vége! {rScore} pontot szereztél 🎉</h3>}
                      <p>Kapd el a felvillanó ⚡ és ⭐ célpontokat, de kerüld a 💣 bombát!</p>
                      <button type="button" className="cta" onClick={startReflex}>
                        {rState === 'over' ? '🔄 Újra próbálom' : '▶ Indítás (20 mp)'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className={`quiz-box ${qFlash ? `flash-${qFlash}` : ''}`}>
                <div className="arena-hud">
                  <span>Pont: <b>{qScore}</b></span>
                  <span>Sorozat: <b className="combo">🔥 {qStreak}</b></span>
                  <span>Idő: <b>{qTime} mp</b></span>
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
                      {qState === 'over' && <h3>Szép munka! {qScore} pont 🧠</h3>}
                      <p>Ma minden diák pontosan ugyanazt a kérdéssort kapja. Hányat tudsz hibátlanul 30 mp alatt?</p>
                      <button type="button" className="cta" onClick={startQuiz}>
                        {qState === 'over' ? '🔄 Újra próbálom' : '▶ Napi Kvíz indítása (30 mp)'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="arena-side">
            <div className="tag" style={{ marginBottom: 10 }}>
              🏆 Mai Toplista ({tab === 'reflex' ? 'Neon Reflex' : 'Napi Kvíz'})
            </div>
            {modeBoard.length === 0 ? (
              <p className="meta">Még senki nem állított fel rekordot ma ebben a módban. Legyél te az első!</p>
            ) : (
              <ol className="arena-lb">
                {modeBoard.map((b, i) => (
                  <li key={`${b.playerId}-${i}`} className={i === 0 ? 'gold' : ''}>
                    <span className="rk">{i === 0 ? '👑' : `${i + 1}.`}</span>
                    <b>{b.name}</b>
                    <strong className="pts">{b.score} pt</strong>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
