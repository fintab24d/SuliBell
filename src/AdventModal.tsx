import { useEffect, useState } from 'react'
import { previewBellSound, type BellSoundStyle } from './lib/sound'
import {
  ADVENT_BELL_META,
  ADVENT_DOORS,
  ADVENT_START_DATE,
  ADVENT_SUNDAYS,
  daysUntilDate,
  type AdventBellId,
  type AdventDoor,
  type AdventOpenResult,
  type AdventState,
  type HolidayThemeId,
  type HolidayThemeMode,
} from './lib/advent'

export type AdventModalTab = 'calendar' | 'settings'

/** 4 gyertyás Adventi koszorú SVG (3 lila + 1 rózsaszín örömgyertya, szerveridő alapján gyulladnak). */
export function AdventWreathIcon({
  litCount,
  size = 'sm',
}: {
  litCount: number
  size?: 'sm' | 'lg'
}) {
  const w = size === 'lg' ? 88 : 34
  const h = size === 'lg' ? 42 : 20
  const candles = [
    { x: 18, color: '#a855f7' }, // 1. Nov. 29. (lila)
    { x: 34, color: '#9333ea' }, // 2. Dec. 6. (lila)
    { x: 50, color: '#f472b6' }, // 3. Dec. 13. (rózsaszín)
    { x: 66, color: '#a855f7' }, // 4. Dec. 20. (lila)
  ]
  return (
    <svg
      className={`adv-wreath-svg adv-wreath-${size}`}
      width={w}
      height={h}
      viewBox="0 0 84 40"
      aria-label={`Adventi koszorú: ${litCount} / 4 gyertya ég`}
      role="img"
    >
      {/* Fenyőkoszorú alap */}
      <ellipse cx="42" cy="31" rx="37" ry="7.5" fill="#0f5132" stroke="#22c55e" strokeWidth="1.4" />
      <ellipse cx="42" cy="31" rx="28" ry="3.8" fill="#083320" />
      {/* Apró piros bogyók és arany díszek */}
      <circle cx="11" cy="31" r="2.2" fill="#e63946" />
      <circle cx="26" cy="34.5" r="1.9" fill="#ffd166" />
      <circle cx="42" cy="35.5" r="2.2" fill="#e63946" />
      <circle cx="58" cy="34.5" r="1.9" fill="#ffd166" />
      <circle cx="73" cy="31" r="2.2" fill="#e63946" />

      {/* 4 Adventi gyertya */}
      {candles.map((c, idx) => {
        const lit = idx < litCount
        return (
          <g key={c.x}>
            <rect
              x={c.x - 3.6}
              y="13"
              width="7.2"
              height="17"
              rx="2"
              fill={c.color}
              stroke="rgba(255,255,255,0.28)"
              strokeWidth="0.7"
              opacity={lit ? 1 : 0.48}
            />
            {/* Kanóc */}
            <line x1={c.x} y1="13" x2={c.x} y2="10.2" stroke="#1e293b" strokeWidth="1.2" />
            {lit && (
              <g className="adv-flame" style={{ transformOrigin: `${c.x}px 10px` }}>
                <ellipse cx={c.x} cy="6.8" rx="4.6" ry="5.4" fill="rgba(255,209,102,0.34)" />
                <path
                  d={`M ${c.x} 2 C ${c.x + 2.8} 6.2, ${c.x + 2.2} 10.2, ${c.x} 10.6 C ${c.x - 2.2} 10.2, ${c.x - 2.8} 6.2, ${c.x} 2 Z`}
                  fill="#ffb703"
                />
                <path
                  d={`M ${c.x} 4.6 C ${c.x + 1.3} 7.1, ${c.x + 1.0} 9.4, ${c.x} 9.8 C ${c.x - 1.0} 9.4, ${c.x - 1.3} 7.1, ${c.x} 4.6 Z`}
                  fill="#fff7cc"
                />
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Mini Mikulás-sapka díszítés pontosan a SuliBell csengő logó tetejére. */
export function SantaHatSvg() {
  return (
    <svg
      className="santa-hat-svg"
      viewBox="0 0 56 40"
      width="32"
      height="24"
      aria-hidden="true"
    >
      {/* Piros süveg, jobbra konyuló csúccsal */}
      <path
        d="M9 28 C11 11, 24 2, 39 9 C45 12, 49 16, 48 20 C43 16.5, 39 17.5, 42 28 Z"
        fill="#d90429"
        stroke="#ff4d6d"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
      {/* Enyhe belső fény-árnyék ív a sapka tetején */}
      <path
        d="M15 21 C18 11, 28 6.5, 38 11"
        fill="none"
        stroke="rgba(255, 255, 255, 0.28)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Ívelt, puha fehér szőrmeperem a csengő ívéhez igazítva */}
      <path
        d="M7 27 Q26 23.5 45 27 C47.2 27.4 48 31.8 45.2 33 Q26 30 6.8 33 C4 31.8 4.8 27.4 7 27 Z"
        fill="#f8fafc"
        stroke="#e2e8f0"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Fehér bojt a jobbra hajló csúcson */}
      <circle cx="49" cy="20" r="4.6" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
    </svg>
  )
}

/** Ünnepi karácsonyi zokni, mintha a SuliBell utolsó „l” betűje felhúzta volna a lábára. */
export function ChristmasStockingSvg() {
  return (
    <svg
      className="xmas-stocking-svg"
      viewBox="0 0 36 32"
      width="22"
      height="20"
      aria-hidden="true"
    >
      {/* Zokni fő piros teste + jobbra hajló zoknifej */}
      <path
        d="M4 6.5 L16 6.5 L16 15.5 C16 18.2, 19.5 19.2, 24.5 20 C29 20.8, 32.5 23.8, 31.2 26.8 C29.8 29.8, 22.5 30.2, 13.5 29.6 C7 29.2, 4 26, 4 20.5 Z"
        fill="#d90429"
        stroke="#ff4d6d"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Enyhe highlight csík a szárán */}
      <path
        d="M7.2 10.5 L7.2 18.5"
        fill="none"
        stroke="rgba(255, 255, 255, 0.24)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      {/* Meleg arany sarok- és orr-rész */}
      <path
        d="M4.1 20.5 C4.2 24.2, 6.2 26.6, 9.5 27.6 C9.6 23.8, 7.4 21.3, 4.1 20.5 Z"
        fill="#ffd166"
        opacity="0.92"
      />
      <path
        d="M25.8 20.3 C30.4 21.4, 32.3 24.1, 31.1 26.8 C30.3 28.5, 28.4 29.4, 26 29.6 C25.2 26.1, 25.2 22.8, 25.8 20.3 Z"
        fill="#ffd166"
        opacity="0.95"
      />
      {/* Pici fehér hópihe-dísz a zokni szárán */}
      <g stroke="#ffffff" strokeWidth="1.05" strokeLinecap="round" opacity="0.88">
        <line x1="10.2" y1="11.6" x2="10.2" y2="16.4" />
        <line x1="8.1" y1="12.8" x2="12.3" y2="15.2" />
        <line x1="12.3" y1="12.8" x2="8.1" y2="15.2" />
      </g>
      {/* Puha fehér szőrmepasszé + vékony arany díszcsík */}
      <rect x="2" y="1" width="16" height="6.8" rx="3.2" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="0.95" />
      <line x1="3.8" y1="7.2" x2="16.2" y2="7.2" stroke="#ffd166" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

interface WinterBreakStripProps {
  serverDate: string
  schoolDaysLeft: number
  hoursLeft: number
  isLastDay: boolean
  started: boolean
  onOpenAdvent?: () => void
}

/** Diszkrét Téli szünet visszaszámláló sáv a napi órarend mellé (az utolsó tanítási nap dec. 18., a szünet dec. 19-én kezdődik). */
export function WinterBreakStrip({
  serverDate,
  schoolDaysLeft,
  hoursLeft,
  isLastDay,
  started,
  onOpenAdvent,
}: WinterBreakStripProps) {
  // November 1. és december 26. között jelenítjük meg
  if (serverDate < '2026-11-01' || serverDate > '2026-12-26') return null

  return (
    <div className={`winter-strip${started ? ' started' : ''}`}>
      <div className="winter-strip-main">
        <span className="winter-ico" aria-hidden="true">
          {started ? '🎄' : '❄️'}
        </span>
        {started ? (
          <div className="winter-txt">
            <b>Elkezdődött a téli szünet!</b>
            <small>Kellemes pihenést és boldog ünnepeket!</small>
          </div>
        ) : isLastDay ? (
          <div className="winter-txt">
            <b>Utolsó tanítási nap a téli szünet előtt!</b>
            <small>
              {hoursLeft > 0
                ? `Már csak kb. ${hoursLeft} óra az utolsó csengőig — holnap (dec. 19.) indul a szünet!`
                : 'Mindjárt kicsengetnek a téli szünetre!'}
            </small>
          </div>
        ) : (
          <div className="winter-txt">
            <b>
              Téli szünetig (dec. 19.): még {schoolDaysLeft} tanítási nap
            </b>
            <small>
              {hoursLeft > 0 ? `≈ ${hoursLeft} óra az utolsó tanítási nap végéig (dec. 18.)` : 'Már nincs sok hátra!'}
            </small>
          </div>
        )}
      </div>
      {onOpenAdvent && (
        <button type="button" className="winter-adv-btn" onClick={onOpenAdvent}>
          🎁 Advent
        </button>
      )}
    </div>
  )
}

interface AdventModalProps {
  open: boolean
  initialTab: AdventModalTab
  onClose: () => void
  state: AdventState
  unlocked: {
    hasSnow: boolean
    hasSantaFrame: boolean
    hasSnakeSkin: boolean
    hasAurora: boolean
    hasGingerbread: boolean
    hasSurvivorBadge: boolean
    unlockedBells: AdventBellId[]
  }
  activeTheme: HolidayThemeId
  santaFrameActive: boolean
  effectiveBell: AdventBellId | null
  serverDate: string
  serverSynced: boolean
  litCandles: number
  potato: boolean
  muted: boolean
  customBellUrl?: string | null
  onOpenDoor: (day: number) => Promise<AdventOpenResult>
  onSetThemeMode: (mode: HolidayThemeMode) => void
  onToggleSnow: (force?: boolean) => void
  onToggleSantaFrame: (force?: boolean) => void
  onToggleSnakeSkin: (force?: boolean) => void
  onSetHolidayBell: (bell: AdventBellId | null) => void
}

export function AdventModal({
  open,
  initialTab,
  onClose,
  state,
  unlocked,
  activeTheme,
  santaFrameActive,
  effectiveBell,
  serverDate,
  serverSynced,
  litCandles,
  potato,
  muted,
  customBellUrl,
  onOpenDoor,
  onSetThemeMode,
  onToggleSnow,
  onToggleSantaFrame,
  onToggleSnakeSkin,
  onSetHolidayBell,
}: AdventModalProps) {
  const [tab, setTab] = useState<AdventModalTab>(initialTab)
  const [selectedDoor, setSelectedDoor] = useState<AdventDoor | null>(null)
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [openingDay, setOpeningDay] = useState<number | null>(null)
  const [testingBell, setTestingBell] = useState<BellSoundStyle | null>(null)

  useEffect(() => {
    if (open) {
      setTab(initialTab)
      setStatusMsg(null)
    }
  }, [open, initialTab])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const openedSet = new Set(state.openedDays)
  const daysToStart = serverDate < ADVENT_START_DATE ? daysUntilDate(serverDate, ADVENT_START_DATE) : 0

  const handleDoorClick = async (door: AdventDoor) => {
    if (openingDay !== null) return
    setOpeningDay(door.day)
    setStatusMsg(null)
    const res = await onOpenDoor(door.day)
    setOpeningDay(null)
    if (res.ok && res.door) {
      setSelectedDoor(res.door)
      if (res.newlyOpened) {
        setStatusMsg({ ok: true, text: `🎉 Kinyitottad a(z) ${res.door.day}. ablakot (${res.door.shortDate})!` })
      }
    } else if (res.error) {
      setStatusMsg({ ok: false, text: res.error })
    }
  }

  const handleTestBell = async (bellId: BellSoundStyle) => {
    setTestingBell(bellId)
    await previewBellSound(bellId, customBellUrl)
    window.setTimeout(() => {
      setTestingBell(cur => (cur === bellId ? null : cur))
    }, 2200)
  }

  return (
    <div
      className="mymodal-bg adv-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adv-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="panel adv-modal">
        <div className="adv-modal-head">
          <div>
            <div className="tag" style={{ marginBottom: 4 }}>
              🎄 SuliBell Karácsony &amp; Advent 2026
            </div>
            <h2 id="adv-modal-title">
              {tab === 'calendar' ? 'Adventi Kalendárium (Nov. 29. – Dec. 24.)' : 'Karácsonyi Skin & Ünnepi Extrák'}
            </h2>
          </div>
          <button type="button" className="vip-close" onClick={onClose} aria-label="Bezárás">
            ✕
          </button>
        </div>

        <div className="adv-wreath-banner">
          <AdventWreathIcon litCount={litCandles} size="lg" />
          <div className="adv-wreath-meta">
            <b>Adventi koszorú: {litCandles} / 4 gyertya ég</b>
            <div className="adv-sundays">
              {ADVENT_SUNDAYS.map((d, idx) => {
                const labels = ['Nov. 29.', 'Dec. 6.', 'Dec. 13.', 'Dec. 20.']
                const lit = idx < litCandles
                return (
                  <span key={d} className={`adv-sun-chip${lit ? ' lit' : ''}`}>
                    {lit ? '🕯️' : '○'} {labels[idx]}
                  </span>
                )
              })}
            </div>
          </div>
          <span
            className={`adv-time-pill${serverSynced ? ' ok' : ''}`}
            title="Az ablakok nyitása a szerver pontos ideje alapján történik"
          >
            {serverSynced ? `🛡️ Szerveridő: ${serverDate}` : '⏳ Szinkronizálás…'}
          </span>
        </div>

        <div className="vip-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'calendar'}
            className={tab === 'calendar' ? 'on' : ''}
            onClick={() => setTab('calendar')}
          >
            🎁 Kalendárium ({state.openedDays.length}/26)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'settings'}
            className={tab === 'settings' ? 'on' : ''}
            onClick={() => setTab('settings')}
          >
            🎄 Skin &amp; Extrák
          </button>
        </div>

        {tab === 'calendar' ? (
          <div className="adv-body">
            {daysToStart > 0 && (
              <div className="adv-countdown-note">
                ⏳ Az első ablak <b>november 29-én</b> (még <b>{daysToStart} nap</b>) nyílik ki szerveridő szerint! Addig is kipróbálhatod a Karácsonyi Skint és a hóesést a <b>🎄 Skin &amp; Extrák</b> fülön.
              </div>
            )}

            {statusMsg && (
              <div className={`vip-feedback ${statusMsg.ok ? 'ok' : 'err'}`} role="status">
                {statusMsg.ok ? '' : '🔒 '}
                {statusMsg.text}
              </div>
            )}

            {/* Kinyitott / kiválasztott ablak részletes kártyája */}
            {selectedDoor && (
              <div className={`adv-reveal${selectedDoor.rewardKind === 'grand' ? ' grand' : ''}`}>
                <div className="adv-reveal-top">
                  <span className="adv-reveal-ico" aria-hidden="true">{selectedDoor.icon}</span>
                  <div>
                    <small>
                      {selectedDoor.day}. ablak • {selectedDoor.shortDate} • {selectedDoor.category}
                    </small>
                    <h3>{selectedDoor.title}</h3>
                  </div>
                  <button
                    type="button"
                    className="vip-mini-btn"
                    onClick={() => setSelectedDoor(null)}
                    aria-label="Kártya bezárása"
                  >
                    ✕
                  </button>
                </div>

                <p className="adv-reveal-body">{selectedDoor.body}</p>

                {/* Gyors művelet gombok az adott jutalomhoz */}
                <div className="adv-reveal-actions">
                  {selectedDoor.rewardKind === 'snow' && (
                    <button
                      type="button"
                      className={state.snowEnabled ? 'on' : ''}
                      onClick={() => onToggleSnow()}
                    >
                      ❄️ Hóesés effekt: {state.snowEnabled ? 'BE ✓' : 'KI'}
                    </button>
                  )}

                  {selectedDoor.rewardKind === 'bell' && selectedDoor.bellId && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleTestBell(selectedDoor.bellId!)}
                      >
                        {testingBell === selectedDoor.bellId ? '🔊 Szól…' : '▶ Hang tesztelése'}
                      </button>
                      <button
                        type="button"
                        className={effectiveBell === selectedDoor.bellId ? 'on' : ''}
                        onClick={() =>
                          onSetHolidayBell(
                            effectiveBell === selectedDoor.bellId ? null : selectedDoor.bellId!
                          )
                        }
                      >
                        {effectiveBell === selectedDoor.bellId
                          ? '🔔 Aktív csengő ✓'
                          : '🔔 Beállítás csengőhangnak'}
                      </button>
                    </>
                  )}

                  {selectedDoor.rewardKind === 'theme' && selectedDoor.themeId && (
                    <button
                      type="button"
                      className={activeTheme === selectedDoor.themeId ? 'on' : ''}
                      onClick={() =>
                        onSetThemeMode(
                          activeTheme === selectedDoor.themeId ? 'auto' : selectedDoor.themeId!
                        )
                      }
                    >
                      {activeTheme === selectedDoor.themeId
                        ? '🎨 Aktív téma ✓ (Vissza)'
                        : `🎨 ${selectedDoor.themeId === 'aurora' ? 'Északi fény' : 'Mézeskalács'} aktiválása`}
                    </button>
                  )}

                  {selectedDoor.rewardKind === 'frame' && (
                    <button
                      type="button"
                      className={santaFrameActive ? 'on' : ''}
                      onClick={() => onToggleSantaFrame()}
                    >
                      🎅 Mikulás keret: {santaFrameActive ? 'BE ✓' : 'KI'}
                    </button>
                  )}

                  {selectedDoor.rewardKind === 'snake' && (
                    <button
                      type="button"
                      className={state.snakeSkinEnabled ? 'on' : ''}
                      onClick={() => onToggleSnakeSkin()}
                    >
                      🐍 Karácsonyi Snake skin: {state.snakeSkinEnabled ? 'BE ✓' : 'KI'}
                    </button>
                  )}
                </div>

                {/* Dec. 24-i főnyeremény: Ünnepi Üdvözlőkártya + Túlélő jelvény */}
                {selectedDoor.rewardKind === 'grand' && (
                  <div className="adv-greeting-card">
                    <div className="adv-survivor-emblem">
                      <span>🏅</span>
                      <b>SuliBell Téli Túlélő 2026</b>
                      <small>Exkluzív szentesti jelvény feloldva!</small>
                    </div>
                    <div className="adv-card-letter">
                      <h4>🎄 Boldog Karácsonyt kíván a SuliBell!</h4>
                      <p>
                        Köszönjük, hogy idén is velünk számoltad vissza a perceket a szünetekig!
                        Töltődj fel, egyél sok bejglit, pihend ki a félévet — januárban újra vár a csengő! ✨
                      </p>
                      <span className="adv-card-sign">— A SuliBell csapata ❄️🔔</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 26 ablak rácsa */}
            <div className="adv-grid">
              {ADVENT_DOORS.map(door => {
                const isOpened = openedSet.has(door.day)
                const isReady = !isOpened && serverSynced && serverDate >= door.date
                const isGrand = door.day === 26
                const isActive = selectedDoor?.day === door.day
                return (
                  <button
                    key={door.day}
                    type="button"
                    className={`adv-door${isOpened ? ' opened' : isReady ? ' ready' : ' locked'}${isGrand ? ' grand' : ''}${isActive ? ' active' : ''}`}
                    onClick={() => handleDoorClick(door)}
                    disabled={openingDay === door.day}
                    title={
                      isOpened
                        ? `${door.shortDate} — Kinyitva: ${door.title}`
                        : isReady
                          ? `${door.shortDate} — Kattints a kinyitáshoz!`
                          : `${door.shortDate} — Még zárva (szerveridő szerint)`
                    }
                  >
                    <span className="adv-door-top">
                      <b className="adv-door-num">{door.day}</b>
                      <small className="adv-door-date">{door.shortDate}</small>
                    </span>
                    <span className="adv-door-mid" aria-hidden="true">
                      {isOpened ? door.icon : isReady ? '🎁' : '🔒'}
                    </span>
                    <span className="adv-door-foot">
                      {isOpened
                        ? 'Megnéz ✓'
                        : isReady
                          ? 'Nyitható!'
                          : door.sundayNumber
                            ? `${door.sundayNumber}. advent`
                            : 'Zárva'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          /* 2. FÜL: Karácsonyi Skin, Hóesés, Ünnepi csengőhangok és feloldott extrák */
          <div className="adv-body">
            <section className="vip-sec">
              <div className="vip-sec-head">
                <h3>🎄 Karácsonyi / Adventi Téma</h3>
                <small>Nov. 29. – Dec. 26. között automatikus, de bármikor váltható</small>
              </div>
              <div className="adv-theme-opts">
                <button
                  type="button"
                  className={`adv-opt-btn${state.themeMode === 'auto' ? ' on' : ''}`}
                  onClick={() => onSetThemeMode('auto')}
                >
                  <span>✨ Automatikus</span>
                  <small>Nov. 29. – Dec. 26.</small>
                </button>
                <button
                  type="button"
                  className={`adv-opt-btn${state.themeMode === 'christmas' ? ' on' : ''}`}
                  onClick={() => onSetThemeMode('christmas')}
                >
                  <span>🎄 Karácsonyi</span>
                  <small>Fenyőzöld, piros &amp; arany</small>
                </button>
                <button
                  type="button"
                  className={`adv-opt-btn${state.themeMode === 'off' ? ' on' : ''}`}
                  onClick={() => onSetThemeMode('off')}
                >
                  <span>🚫 Kikapcsolva</span>
                  <small>Alapértelmezett kinézet</small>
                </button>
                <button
                  type="button"
                  className={`adv-opt-btn${state.themeMode === 'aurora' ? ' on' : ''}`}
                  disabled={!unlocked.hasAurora}
                  onClick={() => onSetThemeMode('aurora')}
                >
                  <span>{unlocked.hasAurora ? '🌌 Északi fény' : '🔒 Északi fény'}</span>
                  <small>{unlocked.hasAurora ? 'Feloldva!' : 'Dec. 10. (12. ablak)'}</small>
                </button>
                <button
                  type="button"
                  className={`adv-opt-btn${state.themeMode === 'gingerbread' ? ' on' : ''}`}
                  disabled={!unlocked.hasGingerbread}
                  onClick={() => onSetThemeMode('gingerbread')}
                >
                  <span>{unlocked.hasGingerbread ? '🍪 Mézeskalács' : '🔒 Mézeskalács'}</span>
                  <small>{unlocked.hasGingerbread ? 'Feloldva!' : 'Dec. 15. (17. ablak)'}</small>
                </button>
              </div>
            </section>

            {/* Hóesés + Mikulás keret + Snake skin kapcsolók */}
            <section className="vip-sec">
              <div className="vip-toggle-row">
                <div>
                  <h3>❄️ Hóesés háttéreffekt</h3>
                  <small>
                    Finom, nem zavaró, teljesítménybarát hóesés a háttérben.
                    {potato ? ' (Potato PC módban szünetel.)' : ''}
                  </small>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={state.snowEnabled}
                  className={`vip-switch${state.snowEnabled ? ' on' : ''}`}
                  onClick={() => onToggleSnow()}
                >
                  <span className="vip-switch-knob" />
                </button>
              </div>
            </section>

            <section className="vip-sec">
              <div className="vip-toggle-row">
                <div>
                  <h3>{unlocked.hasSantaFrame ? '🎅 Mikulás keret' : '🔒 Mikulás keret (Dec. 6.)'}</h3>
                  <small>
                    Ünnepi piros-arany keret a visszaszámláló köré, Mikulás-sapka a SuliBell csengőre és ünnepi zokni a logóra.
                  </small>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={santaFrameActive}
                  disabled={!unlocked.hasSantaFrame}
                  className={`vip-switch${santaFrameActive ? ' on' : ''}`}
                  onClick={() => onToggleSantaFrame()}
                >
                  <span className="vip-switch-knob" />
                </button>
              </div>
            </section>

            <section className="vip-sec">
              <div className="vip-toggle-row">
                <div>
                  <h3>{unlocked.hasSnakeSkin ? '🐍 Karácsonyi Snake skin' : '🔒 Karácsonyi Snake skin (Dec. 8.)'}</h3>
                  <small>
                    Piros-fehér cukorpálca kígyó Mikulás-sapkával és ajándékdobozokkal a Snake minijátékban.
                  </small>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={unlocked.hasSnakeSkin && state.snakeSkinEnabled}
                  disabled={!unlocked.hasSnakeSkin}
                  className={`vip-switch${unlocked.hasSnakeSkin && state.snakeSkinEnabled ? ' on' : ''}`}
                  onClick={() => onToggleSnakeSkin()}
                >
                  <span className="vip-switch-knob" />
                </button>
              </div>
            </section>

            {/* Ünnepi csengőhangok */}
            <section className="vip-sec">
              <div className="vip-sec-head">
                <h3>🔔 Adventi ünnepi csengőhangok</h3>
                <small>Web Audio API • az ablakok kinyitásával oldhatók fel</small>
              </div>
              {muted && (
                <p className="vip-mute-hint">
                  💡 A fejlécben kapcsold be a hangot, hogy csengetéskor is megszólaljon.
                </p>
              )}
              <div className="vip-sound-list">
                {ADVENT_BELL_META.map(b => {
                  const isUnlocked = unlocked.unlockedBells.includes(b.id)
                  const selected = effectiveBell === b.id
                  return (
                    <div key={b.id} className={`vip-sound-row${selected ? ' selected' : ''}`}>
                      <button
                        type="button"
                        className="vip-sound-pick"
                        disabled={!isUnlocked}
                        onClick={() => onSetHolidayBell(selected ? null : b.id)}
                      >
                        <span className="vip-sound-ico" aria-hidden="true">
                          {isUnlocked ? b.icon : '🔒'}
                        </span>
                        <span className="vip-sound-txt">
                          <b>{b.name}</b>
                          <small>
                            {isUnlocked ? b.desc : `Nyitás: ${b.dateLabel} (${b.doorDay}. ablak)`}
                          </small>
                        </span>
                        {selected && <span className="vip-check">Aktív ✓</span>}
                      </button>
                      <button
                        type="button"
                        className="vip-test-btn"
                        disabled={!isUnlocked}
                        onClick={() => handleTestBell(b.id)}
                        title={isUnlocked ? `${b.name} meghallgatása` : `Nyisd ki a(z) ${b.doorDay}. ablakot!`}
                      >
                        {testingBell === b.id ? '🔊 Szól…' : isUnlocked ? '▶ Teszt' : '🔒'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* Dec. 24-i főnyeremény jelvény státusz */}
            <section className="vip-sec">
              <div className="adv-badge-row">
                <span className="adv-badge-ico" aria-hidden="true">
                  {unlocked.hasSurvivorBadge ? '🏅' : '🔒'}
                </span>
                <div>
                  <b>SuliBell Téli Túlélő 2026 jelvény</b>
                  <small>
                    {unlocked.hasSurvivorBadge
                      ? 'Feloldva! A jelvényed büszkén látható a fejlécben is.'
                      : 'Szenteste (dec. 24., 26. ablak) főnyereménye az ünnepi üdvözlőkártyával!'}
                  </small>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
