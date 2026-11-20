import { useEffect, useState, type FormEvent } from 'react'
import { previewBellSound, type BellSoundStyle } from './lib/sound'
import {
  VIP_BELL_SOUNDS,
  VIP_THEMES,
  type Supporter,
  type TopClassStat,
  type VerifyVipResult,
  type VipPrefs,
  type VipStatus,
  type VipThemeId,
} from './lib/vip'

export type VipModalTab = 'vip' | 'supporters'

interface VipModalProps {
  open: boolean
  initialTab: VipModalTab
  onClose: () => void
  kofiUrl: string
  customBellUrl?: string | null
  muted?: boolean
  vipStatus: VipStatus
  vipPrefs: VipPrefs
  onUnlock: (code: string) => Promise<VerifyVipResult>
  onUpdatePrefs: (patch: Partial<VipPrefs>) => void
  onResetVip: () => void
  supporters: Supporter[]
  topClass: TopClassStat | null
  supportersLoading: boolean
}

export function VipModal({
  open,
  initialTab,
  onClose,
  kofiUrl,
  customBellUrl,
  muted,
  vipStatus,
  vipPrefs,
  onUnlock,
  onUpdatePrefs,
  onResetVip,
  supporters,
  topClass,
  supportersLoading,
}: VipModalProps) {
  const [tab, setTab] = useState<VipModalTab>(initialTab)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [showRedeemAgain, setShowRedeemAgain] = useState(false)
  const [testingSound, setTestingSound] = useState<BellSoundStyle | null>(null)

  useEffect(() => {
    if (open) {
      setTab(initialTab)
      setFeedback(null)
      setShowRedeemAgain(false)
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const trimmed = code.trim()
    if (!trimmed) {
      setFeedback({ ok: false, text: 'Írd be a kapott VIP kódot!' })
      return
    }
    setBusy(true)
    setFeedback(null)
    const res = await onUnlock(trimmed)
    setBusy(false)
    if (res.valid) {
      setCode('')
      setShowRedeemAgain(false)
      const tierLabel = res.tier === 'top' ? 'Top Támogató VIP' : 'Standard VIP'
      setFeedback({
        ok: true,
        text: `Sikeres feloldás! Aktív rang: ${tierLabel}. Most már minden kozmetikai extra elérhető.`,
      })
    } else {
      setFeedback({ ok: false, text: res.error || 'Érvénytelen vagy már felhasznált kód.' })
    }
  }

  const handleThemePick = (id: VipThemeId) => {
    if (!vipStatus.active) return
    onUpdatePrefs({ theme: id })
  }

  const handleSoundPick = (id: BellSoundStyle) => {
    if (!vipStatus.active) return
    onUpdatePrefs({ bellSound: id })
  }

  const handleTestSound = async (id: BellSoundStyle) => {
    setTestingSound(id)
    await previewBellSound(id, customBellUrl)
    window.setTimeout(() => {
      setTestingSound(cur => (cur === id ? null : cur))
    }, 1800)
  }

  return (
    <div
      className="mymodal-bg vip-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vip-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="panel vip-modal">
        <div className="vip-modal-head">
          <div>
            <div className="tag" style={{ marginBottom: 4 }}>
              {vipStatus.active ? '👑 SuliBell VIP Aktív' : '🔑 SuliBell VIP & Támogatók'}
            </div>
            <h2 id="vip-modal-title">
              {tab === 'vip'
                ? vipStatus.active
                  ? 'VIP Kozmetikai Extrák'
                  : 'VIP Feloldás'
                : 'Támogatók Fala'}
            </h2>
          </div>
          <button type="button" className="vip-close" onClick={onClose} aria-label="Bezárás">
            ✕
          </button>
        </div>

        <div className="vip-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'vip'}
            className={tab === 'vip' ? 'on' : ''}
            onClick={() => setTab('vip')}
          >
            {vipStatus.active ? '👑 VIP Extrák' : '🔑 VIP Feloldás'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'supporters'}
            className={tab === 'supporters' ? 'on' : ''}
            onClick={() => setTab('supporters')}
          >
            🏆 Támogatók fala {supporters.length > 0 ? `(${supporters.length})` : ''}
          </button>
        </div>

        {tab === 'vip' ? (
          <div className="vip-body">
            {vipStatus.active ? (
              <div className="vip-active-banner">
                <div className="vip-active-info">
                  <span className="vip-crown-ico" aria-hidden="true">👑</span>
                  <div>
                    <b>
                      {vipStatus.tier === 'top' ? '⭐ Top Támogató VIP aktív' : '💎 Standard VIP aktív'}
                    </b>
                    <small>A beállításaid automatikusan elmentődnek ebben a böngészőben.</small>
                  </div>
                </div>
                <div className="vip-active-btns">
                  <button
                    type="button"
                    className="vip-mini-btn"
                    onClick={() => setShowRedeemAgain(v => !v)}
                  >
                    {showRedeemAgain ? 'Mégse' : '🔑 Másik kód'}
                  </button>
                  <button
                    type="button"
                    className="vip-mini-btn danger"
                    onClick={() => {
                      onResetVip()
                      setFeedback(null)
                    }}
                    title="VIP státusz eltávolítása erről az eszközről"
                  >
                    Kikapcsolás
                  </button>
                </div>
              </div>
            ) : (
              <div className="vip-unlock-card">
                <p className="vip-intro">
                  Támogasd a SuliBell működését Ko-fi-n, és a kapott VIP kóddal oldj fel <b>extra színtémákat</b>,{' '}
                  <b>„Utolsó 1 perc” pulzáló fényeffektet</b> és <b>egyedi csengőhangokat</b>!
                  <br />
                  <small style={{ display: 'inline-block', marginTop: 6 }}>
                    💡 A Ko-fi üzenetbe írd bele a <b>Discord nevedet</b> és az <b>osztályodat</b> (pl.{' '}
                    <code>@nev 11.B</code>), így a SuliBell bot automatikusan elküldi a VIP kódodat Discord privát üzenetben, és felkerülsz a Támogatók falára!
                  </small>
                </p>
                <a
                  href={kofiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="kofi-cta vip-kofi-btn"
                >
                  <span aria-hidden="true">☕</span>
                  <span>Támogatás Ko-fi-n &amp; VIP kód szerzése</span>
                  <span aria-hidden="true">↗</span>
                </a>
              </div>
            )}

            {(!vipStatus.active || showRedeemAgain) && (
              <form className="vip-code-form" onSubmit={handleSubmit}>
                <label htmlFor="vip-code-input">VIP aktiváló kód</label>
                <div className="vip-code-row">
                  <input
                    id="vip-code-input"
                    type="text"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    placeholder="pl. SULI-VIP-2026"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                  />
                  <button type="submit" className="vip-submit-btn" disabled={busy}>
                    {busy ? 'Ellenőrzés…' : '🔓 Feloldás'}
                  </button>
                </div>
              </form>
            )}

            {feedback && (
              <div className={`vip-feedback ${feedback.ok ? 'ok' : 'err'}`} role="status">
                {feedback.ok ? '✅ ' : '⚠️ '}
                {feedback.text}
              </div>
            )}

            {/* Kozmetikai extrák szekció */}
            <div className={`vip-extras${vipStatus.active ? '' : ' locked'}`}>
              {!vipStatus.active && (
                <div className="vip-lock-note">
                  🔒 Ezek a kozmetikai extrák aktív VIP kóddal válnak használhatóvá (a csengőhangokat előre is meghallgathatod):
                </div>
              )}

              {/* 1. Extra színtémák */}
              <section className="vip-sec">
                <div className="vip-sec-head">
                  <h3>🎨 Extra színtémák</h3>
                  <small>Azonnal alkalmazva, böngészőben mentve</small>
                </div>
                <div className="vip-theme-grid">
                  {VIP_THEMES.map(t => {
                    const selected = vipStatus.active && vipPrefs.theme === t.id
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`vip-theme-card${selected ? ' selected' : ''}`}
                        disabled={!vipStatus.active}
                        onClick={() => handleThemePick(t.id)}
                        style={{ '--swatch': t.accent, '--swatch-bg': t.bg } as React.CSSProperties}
                      >
                        <span className="vip-swatch" aria-hidden="true">
                          <i />
                        </span>
                        <span className="vip-theme-meta">
                          <b>{t.name}</b>
                          <small>{t.desc}</small>
                        </span>
                        {selected && <span className="vip-check" aria-hidden="true">✓</span>}
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* 2. Utolsó 1 perc effekt */}
              <section className="vip-sec">
                <div className="vip-toggle-row">
                  <div>
                    <h3>⚡ „Utolsó 1 perc” fényeffekt</h3>
                    <small>
                      Ha kevesebb mint 60 másodperc van hátra az órából, finom pulzáló ragyogást ad a visszaszámláló köré.
                    </small>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={vipStatus.active && vipPrefs.lastMinuteEffect}
                    disabled={!vipStatus.active}
                    className={`vip-switch${vipStatus.active && vipPrefs.lastMinuteEffect ? ' on' : ''}`}
                    onClick={() => onUpdatePrefs({ lastMinuteEffect: !vipPrefs.lastMinuteEffect })}
                  >
                    <span className="vip-switch-knob" />
                  </button>
                </div>
              </section>

              {/* 3. Extra csengőhangok */}
              <section className="vip-sec">
                <div className="vip-sec-head">
                  <h3>🔔 Extra csengőhangok</h3>
                  <small>Web Audio API szintetizált hangok</small>
                </div>
                {muted && (
                  <p className="vip-mute-hint">
                    💡 Tipp: a fejlécben kapcsold be a hangot, hogy óravégén is automatikusan megszólaljon a kiválasztott csengő.
                  </p>
                )}
                <div className="vip-sound-list">
                  {VIP_BELL_SOUNDS.map(snd => {
                    const selected = vipStatus.active && vipPrefs.bellSound === snd.id
                    const isPlaying = testingSound === snd.id
                    return (
                      <div key={snd.id} className={`vip-sound-row${selected ? ' selected' : ''}`}>
                        <button
                          type="button"
                          className="vip-sound-pick"
                          disabled={!vipStatus.active}
                          onClick={() => handleSoundPick(snd.id)}
                        >
                          <span className="vip-sound-ico" aria-hidden="true">{snd.icon}</span>
                          <span className="vip-sound-txt">
                            <b>{snd.name}</b>
                            <small>{snd.desc}</small>
                          </span>
                          {selected && <span className="vip-check">Aktív ✓</span>}
                        </button>
                        <button
                          type="button"
                          className="vip-test-btn"
                          onClick={() => handleTestSound(snd.id)}
                          title={`${snd.name} meghallgatása`}
                        >
                          {isPlaying ? '🔊 Szól…' : '▶ Teszt'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="vip-body">
            {topClass && (
              <div className="sup-top-class">
                <span className="sup-trophy" aria-hidden="true">🏆</span>
                <div>
                  <small>Osztályok közötti támogatási verseny</small>
                  <b>Legtámogatóbb osztály: {topClass.className}</b>
                </div>
                <span className="sup-top-count">{topClass.count} támogatás</span>
              </div>
            )}

            {supportersLoading ? (
              <div className="sup-empty">Támogatók betöltése…</div>
            ) : supporters.length === 0 ? (
              <div className="sup-empty">
                <p>🌟 Még nincsenek megjelenített támogatók a falon — legyél te és az osztályod az első!</p>
                <a
                  href={kofiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="kofi-cta vip-kofi-btn"
                >
                  <span aria-hidden="true">☕</span>
                  <span>Támogatás Ko-fi-n</span>
                  <span aria-hidden="true">↗</span>
                </a>
              </div>
            ) : (
              <>
                <div className="sup-wall-list">
                  {supporters.map(s => (
                    <article
                      key={s.id}
                      className={`sup-card${s.is_top_tier ? ' top-tier' : ''}`}
                    >
                      <div className="sup-card-top">
                        <div className="sup-card-id">
                          <span className="sup-avatar" aria-hidden="true">
                            {s.is_top_tier ? '👑' : '💚'}
                          </span>
                          <b>{s.name}</b>
                          {s.class_name && (
                            <span className="sup-class-pill">{s.class_name}</span>
                          )}
                        </div>
                        <span className={`sup-tier-badge${s.is_top_tier ? ' top' : ''}`}>
                          {s.is_top_tier ? '⭐ Top Támogató' : '💎 VIP'}
                        </span>
                      </div>
                      {s.message && s.message.trim() && (
                        <p className="sup-msg">„{s.message.trim()}”</p>
                      )}
                    </article>
                  ))}
                </div>
                <div className="sup-wall-foot">
                  <a
                    href={kofiUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="kofi-cta vip-kofi-btn"
                  >
                    <span aria-hidden="true">☕</span>
                    <span>Támogasd te is a SuliBellt!</span>
                    <span aria-hidden="true">↗</span>
                  </a>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

interface SupporterTickerProps {
  supporters: Supporter[]
  onOpenWall?: () => void
  tv?: boolean
}

/** A fő visszaszámláló alatti diszkrét, 8 másodpercenként finom áttűnéssel rotálódó támogatói üzenetsáv. */
export function SupporterTicker({ supporters, onOpenWall, tv }: SupporterTickerProps) {
  const [idx, setIdx] = useState(0)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    setIdx(0)
    setFading(false)
  }, [supporters.length])

  useEffect(() => {
    if (supporters.length <= 1) return
    let swapTimer: number | undefined
    const interval = window.setInterval(() => {
      setFading(true)
      swapTimer = window.setTimeout(() => {
        setIdx(prev => (prev + 1) % supporters.length)
        setFading(false)
      }, 320)
    }, 8000)
    return () => {
      window.clearInterval(interval)
      if (swapTimer !== undefined) window.clearTimeout(swapTimer)
    }
  }, [supporters.length])

  if (supporters.length === 0) return null

  const cur = supporters[idx % supporters.length]
  if (!cur || !cur.message) return null

  const inner = (
    <div className={`sup-ticker-inner${fading ? ' is-fading' : ''}`}>
      <span className="sup-ticker-badge" aria-hidden="true">
        {cur.is_top_tier ? '👑' : '💚'}
      </span>
      <span className="sup-ticker-who">
        <b>{cur.name}</b>
        {cur.class_name && <small className="sup-ticker-cls">{cur.class_name}</small>}
      </span>
      <span className="sup-ticker-sep" aria-hidden="true">•</span>
      <span className="sup-ticker-msg">„{cur.message.trim()}”</span>
    </div>
  )

  if (onOpenWall && !tv) {
    return (
      <button
        type="button"
        className="sup-ticker clickable"
        onClick={onOpenWall}
        title="Támogatók falának megnyitása"
      >
        {inner}
      </button>
    )
  }

  return (
    <div className={`sup-ticker${tv ? ' tv-mode' : ''}`} aria-live="polite">
      {inner}
    </div>
  )
}
