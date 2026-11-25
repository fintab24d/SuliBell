import { useEffect, useRef, useState, type PointerEvent as PE } from 'react'
import { botDir, drawSnakeBoard, newGame, step, type G, type P, type SnakeSkin } from './lib/snake'
import { getAdventUnlocked, loadAdventState, saveAdventState } from './lib/advent'
import type { ChampionTier } from './lib/champions'
import { focusPlayerProfile, usePlayerProfile } from './lib/usePlayerProfile'

const COLS = 22
const ROWS = 14

const KEYS: Record<string, P> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
}

const bestGet = () => {
  try {
    return +(localStorage.getItem('snake-best') ?? 0)
  } catch {
    return 0
  }
}

export type SnakeDiff = 'easy' | 'normal' | 'hard' | 'extreme'

export const SNAKE_DIFFS: { id: SnakeDiff; label: string; ms: number; ptsPerApple: number }[] = [
  { id: 'easy', label: 'Könnyű', ms: 135, ptsPerApple: 10 },
  { id: 'normal', label: 'Normál', ms: 95, ptsPerApple: 15 },
  { id: 'hard', label: 'Nehéz', ms: 68, ptsPerApple: 25 },
  { id: 'extreme', label: 'Extrém', ms: 48, ptsPerApple: 40 },
]

const diffGet = (): SnakeDiff => {
  try {
    const v = localStorage.getItem('snake-diff')
    if (v === 'easy' || v === 'normal' || v === 'hard' || v === 'extreme') return v
  } catch { /* ignore */ }
  return 'normal'
}

const CHAMP_SKIN_KEY = 'snake-champ-skin'
const loadChampSkinPref = (): boolean => {
  try {
    return localStorage.getItem(CHAMP_SKIN_KEY) !== '0'
  } catch {
    return true
  }
}

export interface SnakeGameProps {
  tv?: boolean
  championTier?: ChampionTier | null
  locked?: boolean
  lockMessage?: string
  playsHint?: string | null
  schoolId?: string
  sound?: boolean
  onStartPlay?: () => void
  onGameOver?: (score: number, apples: number, diff: SnakeDiff, name: string) => void
}

/** Neon Snake (bővített pontszorzós + Arany Bajnok skinnel és toplista beküldéssel). */
export default function SnakeGame({
  tv = false,
  championTier = null,
  locked = false,
  lockMessage,
  playsHint,
  schoolId,
  sound: _sound,
  onStartPlay,
  onGameOver,
}: SnakeGameProps) {
  const cv = useRef<HTMLCanvasElement>(null)
  const g = useRef<G>(newGame(COLS, ROWS))
  const q = useRef<P[]>([])
  const [mode, setMode] = useState<'demo' | 'play' | 'over'>('demo')
  const m = useRef(mode)
  m.current = mode
  const [apples, setApples] = useState(0)
  const [best, setBest] = useState(bestGet)
  const [diff, setDiff] = useState<SnakeDiff>(diffGet)
  const diffRef = useRef(diff)
  diffRef.current = diff
  const [xmasUnlocked, setXmasUnlocked] = useState(() => getAdventUnlocked(loadAdventState().openedDays).hasSnakeSkin)
  const [xmasEnabled, setXmasEnabled] = useState(() => loadAdventState().snakeSkinEnabled)
  const [champPref, setChampPref] = useState<boolean>(loadChampSkinPref)

  const skin: SnakeSkin =
    championTier && champPref
      ? 'champion'
      : xmasUnlocked && xmasEnabled
        ? 'christmas'
        : 'neon'
  const skinRef = useRef<SnakeSkin>(skin)
  skinRef.current = skin

  useEffect(() => {
    const syncSkin = () => {
      const st = loadAdventState()
      setXmasUnlocked(getAdventUnlocked(st.openedDays).hasSnakeSkin)
      setXmasEnabled(st.snakeSkinEnabled)
      setChampPref(loadChampSkinPref())
    }
    window.addEventListener('sulibell:advent-change', syncSkin)
    window.addEventListener('sulibell:champion-change', syncSkin)
    window.addEventListener('storage', syncSkin)
    return () => {
      window.removeEventListener('sulibell:advent-change', syncSkin)
      window.removeEventListener('sulibell:champion-change', syncSkin)
      window.removeEventListener('storage', syncSkin)
    }
  }, [])

  const selectSkin = (target: SnakeSkin) => {
    if (target === 'champion') {
      if (!championTier) return
      setChampPref(true)
      try { localStorage.setItem(CHAMP_SKIN_KEY, '1') } catch { /* ignore */ }
      return
    }
    if (championTier) {
      setChampPref(false)
      try { localStorage.setItem(CHAMP_SKIN_KEY, '0') } catch { /* ignore */ }
    }
    if (target === 'christmas' && xmasUnlocked) {
      setXmasEnabled(true)
      saveAdventState({ ...loadAdventState(), snakeSkinEnabled: true })
    } else {
      setXmasEnabled(false)
      saveAdventState({ ...loadAdventState(), snakeSkinEnabled: false })
    }
  }

  const wait = useRef(0)
  const profile = usePlayerProfile(schoolId)
  const playerName = profile.valid ? profile.cleanName : ''
  const playerNameRef = useRef(playerName)
  playerNameRef.current = playerName
  const [nameErr, setNameErr] = useState('')

  useEffect(() => {
    if (profile.valid && nameErr) setNameErr('')
  }, [profile.valid, nameErr])

  const changeDiff = (d: SnakeDiff) => {
    setDiff(d)
    try { localStorage.setItem('snake-diff', d) } catch { /* ignore */ }
  }

  const ptsPerApple = SNAKE_DIFFS.find(d => d.id === diff)?.ptsPerApple ?? 15
  const calcPoints = (appleCount: number, d: SnakeDiff) => {
    const mult = SNAKE_DIFFS.find(x => x.id === d)?.ptsPerApple ?? 15
    return Math.min(5000, appleCount * mult)
  }
  const score = calcPoints(apples, diff)

  const onStartRef = useRef(onStartPlay)
  onStartRef.current = onStartPlay
  const onOverRef = useRef(onGameOver)
  onOverRef.current = onGameOver
  const deadSentRef = useRef(false)

  const start = () => {
    if (locked) {
      setNameErr(lockMessage || 'Ebben a szünetben már elérted a játékszám-korlátot.')
      return
    }
    if (!profile.valid) {
      setNameErr(profile.validationError || 'A játékhoz add meg a neved a Játékosprofil kártyán!')
      focusPlayerProfile()
      return
    }
    setNameErr('')
    deadSentRef.current = false
    onStartRef.current?.()
    g.current = newGame(COLS, ROWS)
    q.current = []
    setApples(0)
    setMode('play')
  }

  useEffect(() => {
    const draw = () => {
      const c = cv.current
      if (!c) return
      const w = c.clientWidth || 440
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr)
        c.height = Math.round((w * ROWS / COLS) * dpr)
      }
      const x = c.getContext('2d')!
      drawSnakeBoard(x, c.width, c.height, g.current, skinRef.current, performance.now())
    }
    const tick = () => {
      if (document.hidden) return
      const G = g.current
      if (m.current === 'over') {
        draw()
        return
      }
      if (m.current === 'demo') {
        if (G.dead) {
          if (++wait.current > 10) {
            wait.current = 0
            g.current = newGame(COLS, ROWS)
          }
        } else {
          step(G, botDir(G))
        }
        setApples(G.score)
      } else {
        step(G, q.current.shift())
        setApples(G.score)
        if (G.dead) {
          setMode('over')
          const pts = calcPoints(G.score, diffRef.current)
          setBest(b => {
            const v = Math.max(b, pts)
            try { localStorage.setItem('snake-best', String(v)) } catch { /* ignore */ }
            return v
          })
          if (!deadSentRef.current) {
            deadSentRef.current = true
            if (pts > 0) onOverRef.current?.(pts, G.score, diffRef.current, playerNameRef.current)
          }
        }
      }
      draw()
    }
    draw()
    const speedMs = tv ? 85 : (SNAKE_DIFFS.find(d => d.id === diff)?.ms ?? 95)
    const t = setInterval(tick, speedMs)
    window.addEventListener('resize', draw)
    return () => {
      clearInterval(t)
      window.removeEventListener('resize', draw)
    }
  }, [tv, diff])

  useEffect(() => {
    if (tv) return
    const on = (e: KeyboardEvent) => {
      const d = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key]
      if (m.current === 'play' && d) {
        e.preventDefault()
        if (q.current.length < 2) q.current.push(d)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [tv])

  const p0 = useRef<P | null>(null)
  const down = (e: PE<HTMLCanvasElement>) => {
    p0.current = { x: e.clientX, y: e.clientY }
  }
  const up = (e: PE<HTMLCanvasElement>) => {
    const a = p0.current
    p0.current = null
    if (!a || tv) return
    const dx = e.clientX - a.x
    const dy = e.clientY - a.y
    if (Math.hypot(dx, dy) < 24) {
      if (m.current !== 'play') start()
      return
    }
    if (m.current === 'play' && q.current.length < 2) {
      q.current.push(Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) })
    }
  }

  return (
    <div className="snake">
      <div className="snakehud">
        <span>🐍 Snake</span>
        {playerName && <span>Játékos: <b>{playerName}</b></span>}
        <span>
          {mode === 'demo' ? (tv ? 'Gépi játékos' : 'Bemutató') : 'Pont'}: <b>{score}</b>
          {mode !== 'demo' && <small style={{ opacity: 0.75 }}> ({apples} 🍎)</small>}
        </span>
        <span>Rekord: <b>{best} p</b></span>
      </div>

      {!tv && (
        <div className="snakediff" role="group" aria-label="Nehézségi szint és kinézet">
          <span>Nehézség:</span>
          {SNAKE_DIFFS.map(d => (
            <button
              key={d.id}
              type="button"
              className={diff === d.id ? 'on' : ''}
              onClick={() => changeDiff(d.id)}
              disabled={mode === 'play'}
              title={`${d.ptsPerApple} pont / alma`}
            >
              {d.label} ({d.ptsPerApple}p)
            </button>
          ))}
          {(championTier || xmasUnlocked) && (
            <>
              <button
                type="button"
                className={skin === 'neon' ? 'on' : ''}
                onClick={() => selectSkin('neon')}
              >
                ⚡ Alap
              </button>
              {xmasUnlocked && (
                <button
                  type="button"
                  className={skin === 'christmas' ? 'on' : ''}
                  onClick={() => selectSkin(skin === 'christmas' ? 'neon' : 'christmas')}
                  title="Adventi Karácsonyi Snake kinézet"
                >
                  🎄 Karácsonyi
                </button>
              )}
              {championTier && (
                <button
                  type="button"
                  className={skin === 'champion' ? 'on champ-skin-btn' : 'champ-skin-btn'}
                  onClick={() => selectSkin(skin === 'champion' ? 'neon' : 'champion')}
                  title="Exkluzív arany Bajnok Snake kinézet"
                >
                  👑 Bajnok skin
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="snakescreen">
        <canvas ref={cv} onPointerDown={down} onPointerUp={up} aria-label="Snake játék" />
        {tv && (
          <div className="tvplay">
            📱 Játssz te is! Menj fel a <b>{location.host}</b> oldalra, vagy nyisd meg az alkalmazást.
          </div>
        )}
        {!tv && mode !== 'play' && (
          <div className="snakeover">
            {mode === 'over' && (
              <b>
                Vége! {score} pont ({apples} 🍎 × {ptsPerApple}p)
              </b>
            )}
            {!profile.valid && (
              <div style={{ margin: '6px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <small style={{ color: '#ffb02e' }}>
                  🔒 {nameErr || 'A játékhoz előbb állítsd be a neved a Játékosprofil kártyán!'}
                </small>
                <button type="button" className="profile-chip-cta" onClick={() => focusPlayerProfile()}>
                  👤 Név megadása
                </button>
              </div>
            )}
            {profile.valid && nameErr && (
              <small style={{ color: '#ff3b5c', display: 'block', margin: '4px 0' }}>⚠️ {nameErr}</small>
            )}
            {playsHint && (
              <p style={{ color: locked ? '#facc15' : '#4ade80', fontSize: '0.82rem', margin: '4px 0', fontWeight: 600 }}>
                {playsHint}
              </p>
            )}
            <button type="button" className="cta" onClick={start} disabled={locked}>
              {locked ? '⏸️ Elérted a szüneti limitet' : mode === 'over' ? '🔄 Újra' : '▶ Játssz te is'}
            </button>
            <small>Nyilak / WASD, vagy húzd az ujjad</small>
          </div>
        )}
      </div>
    </div>
  )
}
