import { memo } from 'react'

export type AdventModalTab = 'calendar' | 'settings'

/** 4 gyertyás Adventi koszorú SVG (3 lila + 1 rózsaszín örömgyertya, szerveridő alapján gyulladnak). */
export const AdventWreathIcon = memo(function AdventWreathIcon({
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
})

/** Mini Mikulás-sapka díszítés pontosan a SuliBell csengő logó tetejére. */
export const SantaHatSvg = memo(function SantaHatSvg() {
  return (
    <svg
      className="santa-hat-svg"
      viewBox="0 0 56 40"
      width="32"
      height="24"
      aria-hidden="true"
    >
      <path
        d="M9 28 C11 11, 24 2, 39 9 C45 12, 49 16, 48 20 C43 16.5, 39 17.5, 42 28 Z"
        fill="#d90429"
        stroke="#ff4d6d"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
      <path
        d="M15 21 C18 11, 28 6.5, 38 11"
        fill="none"
        stroke="rgba(255, 255, 255, 0.28)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M7 27 Q26 23.5 45 27 C47.2 27.4 48 31.8 45.2 33 Q26 30 6.8 33 C4 31.8 4.8 27.4 7 27 Z"
        fill="#f8fafc"
        stroke="#e2e8f0"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <circle cx="49" cy="20" r="4.6" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
    </svg>
  )
})

/** Ünnepi karácsonyi zokni, mintha a SuliBell utolsó „l” betűje felhúzta volna a lábára. */
export const ChristmasStockingSvg = memo(function ChristmasStockingSvg() {
  return (
    <svg
      className="xmas-stocking-svg"
      viewBox="0 0 36 32"
      width="22"
      height="20"
      aria-hidden="true"
    >
      <path
        d="M4 6.5 L16 6.5 L16 15.5 C16 18.2, 19.5 19.2, 24.5 20 C29 20.8, 32.5 23.8, 31.2 26.8 C29.8 29.8, 22.5 30.2, 13.5 29.6 C7 29.2, 4 26, 4 20.5 Z"
        fill="#d90429"
        stroke="#ff4d6d"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d="M7.2 10.5 L7.2 18.5"
        fill="none"
        stroke="rgba(255, 255, 255, 0.24)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
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
      <g stroke="#ffffff" strokeWidth="1.05" strokeLinecap="round" opacity="0.88">
        <line x1="10.2" y1="11.6" x2="10.2" y2="16.4" />
        <line x1="8.1" y1="12.8" x2="12.3" y2="15.2" />
        <line x1="12.3" y1="12.8" x2="8.1" y2="15.2" />
      </g>
      <rect x="2" y="1" width="16" height="6.8" rx="3.2" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="0.95" />
      <line x1="3.8" y1="7.2" x2="16.2" y2="7.2" stroke="#ffd166" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
})

export interface WinterBreakStripProps {
  serverDate: string
  schoolDaysLeft: number
  hoursLeft: number
  isLastDay: boolean
  started: boolean
  onOpenAdvent?: () => void
}

/** Diszkrét Téli szünet visszaszámláló sáv a napi órarend mellé (az utolsó tanítási nap dec. 18., a szünet dec. 19-én kezdődik). */
export const WinterBreakStrip = memo(function WinterBreakStrip({
  serverDate,
  schoolDaysLeft,
  hoursLeft,
  isLastDay,
  started,
  onOpenAdvent,
}: WinterBreakStripProps) {
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
})
