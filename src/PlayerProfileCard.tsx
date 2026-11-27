import { memo, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { rankProfileSuggestions, sanitizePinInput } from './lib/playerProfile'
import { supabase } from './lib/supabase'
import { FOCUS_PROFILE_EVENT, usePlayerProfile } from './lib/usePlayerProfile'

interface PlayerProfileCardProps {
  schoolId?: string
  compact?: boolean
  modal?: boolean
  onSaved?: () => void
}

type CardMode = 'view' | 'edit' | 'login' | 'forgot'

const knownNamesCache = new Map<string, { names: string[]; at: number }>()
const KNOWN_NAMES_TTL_MS = 30_000

export const PlayerProfileCard = memo(function PlayerProfileCard({ schoolId, compact = false, modal = false, onSaved }: PlayerProfileCardProps) {
  const { cleanName, valid, hasPin, saving, saveError, clearSaveError, saveName, loginWithPin, requestPinReset, logout } = usePlayerProfile(schoolId)
  const [mode, setMode] = useState<CardMode>(() => (!valid || !hasPin || modal ? 'edit' : 'view'))
  const [draft, setDraft] = useState(cleanName)
  const [pin, setPin] = useState('')
  const [forgotNote, setForgotNote] = useState('')
  const [forgotDone, setForgotDone] = useState<{ text: string; name: string } | null>(null)
  const [forgotCanResetNow, setForgotCanResetNow] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const [loginHint, setLoginHint] = useState('')
  const [knownNames, setKnownNames] = useState<string[]>(() => (schoolId ? knownNamesCache.get(schoolId)?.names ?? [] : []))
  const [showSuggest, setShowSuggest] = useState(false)
  const [activeSuggest, setActiveSuggest] = useState(0)
  const [pulse, setPulse] = useState(false)
  const cardRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pinInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if ((mode !== 'login' && mode !== 'forgot') || !schoolId) return
    const hit = knownNamesCache.get(schoolId)
    if (hit && Date.now() - hit.at < KNOWN_NAMES_TTL_MS) {
      setKnownNames(hit.names)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('player_profiles')
          .select('player_name')
          .eq('school_id', schoolId)
          .order('updated_at', { ascending: false })
          .limit(200)
        if (!cancelled && !error && Array.isArray(data)) {
          const names = data.map((r: any) => String(r.player_name ?? '').trim()).filter(Boolean)
          knownNamesCache.set(schoolId, { names, at: Date.now() })
          setKnownNames(names)
        }
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [mode, schoolId])

  const suggestions = useMemo(
    () => (mode === 'login' || mode === 'forgot' ? rankProfileSuggestions(draft, knownNames, 5) : []),
    [mode, draft, knownNames],
  )

  useEffect(() => {
    setActiveSuggest(0)
  }, [draft, mode])

  const pickSuggestion = (picked: string) => {
    setDraft(picked)
    setShowSuggest(false)
    if (saveError) clearSaveError()
    if (mode === 'login') {
      window.setTimeout(() => pinInputRef.current?.focus(), 20)
    }
  }

  useEffect(() => {
    if (!valid && mode === 'view') {
      setMode('edit')
    }
  }, [valid, mode])

  useEffect(() => {
    if (mode === 'view') {
      setDraft(cleanName)
      setPin('')
      setLoginHint('')
    }
  }, [cleanName, mode])

  useEffect(() => {
    const onFocusRequest = (ev: Event) => {
      if (modal) return
      ev.preventDefault()
      setMode('edit')
      setDraft(cleanName)
      setPin('')
      setLoginHint('')
      clearSaveError()
      setPulse(true)
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      window.setTimeout(() => inputRef.current?.focus(), 140)
      window.setTimeout(() => setPulse(false), 1500)
    }
    window.addEventListener(FOCUS_PROFILE_EVENT, onFocusRequest)
    return () => window.removeEventListener(FOCUS_PROFILE_EVENT, onFocusRequest)
  }, [cleanName, clearSaveError, modal])

  const submitSave = async (e: FormEvent) => {
    e.preventDefault()
    const res = await saveName(draft, pin)
    if (res.ok) {
      setPin('')
      setLoginHint('')
      setMode('view')
      onSaved?.()
      return
    }
    if (res.code === 'pin_required') {
      setDraft(res.existingName || draft)
      setPin('')
      setLoginHint(`A(z) ${res.existingName || draft} név már foglalt! Ha ez a te profilod, add meg a 4 jegyű PIN-kódod a belépéshez — ha más vagy, válassz másik nevet.`)
      setMode('login')
      window.setTimeout(() => pinInputRef.current?.focus(), 80)
    }
  }

  const submitLogin = async (e: FormEvent) => {
    e.preventDefault()
    const res = await loginWithPin(draft, pin)
    if (res.ok) {
      setPin('')
      setLoginHint('')
      setMode('view')
      onSaved?.()
    }
  }

  const submitForgotPin = async (e: FormEvent) => {
    e.preventDefault()
    setForgotDone(null)
    setForgotCanResetNow(false)
    const res = await requestPinReset(draft, forgotNote)
    if (res.ok) {
      const targetName = res.name || draft.trim()
      setForgotNote('')
      setForgotDone({
        name: targetName,
        text: res.alreadyPending
          ? `⏳ Ehhez a profilhoz (${targetName}) már van függőben lévő PIN-nullázási kérelem — az admin hamarosan intézi!`
          : `✅ Jelzés elküldve az adminnak (${targetName})! Amint nullázza a PIN-kódod, új 4 jegyű PIN-nel vissza tudsz lépni.`,
      })
      return
    }
    if (res.code === 'already_reset') {
      setForgotCanResetNow(true)
    }
  }

  const pinRequired = !valid || !hasPin

  return (
    <section
      ref={cardRef}
      className={`panel profile-card${compact ? ' compact' : ''}${pulse ? ' profile-pulse' : ''}${pinRequired ? ' missing' : ''}`}
      aria-label="Központi játékosprofil"
    >
      <div className="panel-h">
        <h2><span>👤</span> Játékosprofil</h2>
        <span className={`badge ${valid && hasPin ? 'ok' : 'warn'}`}>
          {valid && hasPin ? '🔒 PIN védve' : valid ? 'PIN hiányzik' : 'Nincs név'}
        </span>
      </div>

      {valid && hasPin && mode === 'view' ? (
        <div className="profile-saved">
          <div className="profile-identity">
            <span className="profile-avatar" aria-hidden="true">🪪</span>
            <div className="profile-meta">
              <strong className="profile-name">{cleanName}</strong>
              <span className="profile-hint">Minden játékban és a zenekérésnél ez jelenik meg. Másik gépen a PIN-eddel léphetsz be.</span>
            </div>
          </div>
          <div className="profile-actions">
            <button
              type="button"
              className="profile-edit-btn"
              onClick={() => {
                setDraft(cleanName)
                setPin('')
                setLoginHint('')
                clearSaveError()
                setMode('edit')
                window.setTimeout(() => inputRef.current?.focus(), 60)
              }}
            >
              ✏️ Módosítás
            </button>
            <button
              type="button"
              className="profile-logout-btn"
              title="Kilépés ebből a böngészőből (pl. közös iskolai gépen)"
              onClick={() => {
                logout()
                setDraft('')
                setPin('')
                setLoginHint('')
                setMode('edit')
              }}
            >
              🚪 Kilépés
            </button>
          </div>
        </div>
      ) : mode === 'login' ? (
        <form className="profile-form" onSubmit={submitLogin}>
          {loginHint ? (
            <p className="profile-login-banner">🔑 {loginHint}</p>
          ) : (
            <p className="profile-desc">
              Írd be a meglévő neved és a hozzá tartozó 4 jegyű PIN-kódot — az eredményeid és bajnoki kereted is átjön ide!
            </p>
          )}
          <div className="profile-row">
            <div className="profile-name-ac">
              <input
                ref={inputRef}
                type="text"
                placeholder="Osztály + név (pl. 10.A Dani) *"
                maxLength={24}
                autoComplete="off"
                role="combobox"
                aria-expanded={showSuggest && suggestions.length > 0}
                aria-autocomplete="list"
                value={draft}
                onFocus={() => setShowSuggest(true)}
                onBlur={() => window.setTimeout(() => setShowSuggest(false), 140)}
                onChange={e => {
                  setDraft(e.target.value)
                  setShowSuggest(true)
                  if (saveError) clearSaveError()
                }}
                onKeyDown={e => {
                  if (!showSuggest || suggestions.length === 0) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActiveSuggest(i => (i + 1) % suggestions.length)
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActiveSuggest(i => (i - 1 + suggestions.length) % suggestions.length)
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    pickSuggestion(suggestions[activeSuggest] ?? suggestions[0])
                  } else if (e.key === 'Escape') {
                    setShowSuggest(false)
                  }
                }}
                disabled={saving}
              />
              {showSuggest && suggestions.length > 0 && (
                <ul className="profile-suggest-menu" role="listbox" aria-label="Meglévő játékosnevek">
                  {suggestions.map((sug, idx) => (
                    <li
                      key={sug}
                      role="option"
                      aria-selected={idx === activeSuggest}
                      className={`profile-suggest-item${idx === activeSuggest ? ' active' : ''}`}
                      onMouseDown={e => {
                        e.preventDefault()
                        pickSuggestion(sug)
                      }}
                    >
                      <span>👤 {sug}</span>
                      <small>Kattints a kiválasztáshoz</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="profile-pin-wrap">
              <input
                ref={pinInputRef}
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="PIN *"
                maxLength={4}
                value={pin}
                onChange={e => {
                  setPin(sanitizePinInput(e.target.value))
                  if (saveError) clearSaveError()
                }}
                disabled={saving}
                aria-label="4 jegyű PIN-kód"
              />
              <button
                type="button"
                className="profile-pin-toggle"
                onClick={() => setShowPin(v => !v)}
                tabIndex={-1}
                title={showPin ? 'PIN elrejtése' : 'PIN mutatása'}
                aria-label={showPin ? 'PIN elrejtése' : 'PIN mutatása'}
              >
                {showPin ? '🙈' : '👁️'}
              </button>
            </div>
            <button type="submit" className="cta" disabled={saving || !draft.trim() || pin.length !== 4}>
              {saving ? '⏳…' : '🔓 Belépés'}
            </button>
            <button
              type="button"
              className="profile-cancel-btn"
              onClick={() => {
                clearSaveError()
                setLoginHint('')
                setPin('')
                setMode(valid && hasPin && !modal ? 'view' : 'edit')
              }}
              disabled={saving}
            >
              ← Vissza
            </button>
          </div>
          <div className="profile-sub-links">
            <button
              type="button"
              className="profile-link-btn profile-forgot-btn"
              onClick={() => {
                clearSaveError()
                setForgotDone(null)
                setForgotCanResetNow(false)
                setMode('forgot')
                window.setTimeout(() => inputRef.current?.focus(), 60)
              }}
              disabled={saving}
            >
              🆘 Elfelejtettem a PIN-kódot → Jelzés az adminnak
            </button>
          </div>
          {saveError && <p className="profile-err" role="alert">⚠️ {saveError}</p>}
        </form>
      ) : mode === 'forgot' ? (
        <form className="profile-form" onSubmit={submitForgotPin}>
          <p className="profile-desc">
            Válaszd ki vagy írd be a neved, és jelezd az adminnak, hogy nullázza a PIN-kódod. Amint elfogadja, ugyanazzal a névvel új 4 jegyű PIN-t állíthatsz be!
          </p>
          <div className="profile-row">
            <div className="profile-name-ac">
              <input
                ref={inputRef}
                type="text"
                placeholder="Osztály + név (pl. 10.A Dani) *"
                maxLength={24}
                autoComplete="off"
                role="combobox"
                aria-expanded={showSuggest && suggestions.length > 0}
                aria-autocomplete="list"
                value={draft}
                onFocus={() => setShowSuggest(true)}
                onBlur={() => window.setTimeout(() => setShowSuggest(false), 140)}
                onChange={e => {
                  setDraft(e.target.value)
                  setShowSuggest(true)
                  setForgotDone(null)
                  setForgotCanResetNow(false)
                  if (saveError) clearSaveError()
                }}
                onKeyDown={e => {
                  if (!showSuggest || suggestions.length === 0) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActiveSuggest(i => (i + 1) % suggestions.length)
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActiveSuggest(i => (i - 1 + suggestions.length) % suggestions.length)
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    pickSuggestion(suggestions[activeSuggest] ?? suggestions[0])
                  } else if (e.key === 'Escape') {
                    setShowSuggest(false)
                  }
                }}
                disabled={saving}
              />
              {showSuggest && suggestions.length > 0 && (
                <ul className="profile-suggest-menu" role="listbox" aria-label="Meglévő játékosnevek">
                  {suggestions.map((sug, idx) => (
                    <li
                      key={sug}
                      role="option"
                      aria-selected={idx === activeSuggest}
                      className={`profile-suggest-item${idx === activeSuggest ? ' active' : ''}`}
                      onMouseDown={e => {
                        e.preventDefault()
                        pickSuggestion(sug)
                      }}
                    >
                      <span>👤 {sug}</span>
                      <small>Kattints a kiválasztáshoz</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <input
              type="text"
              className="profile-note-input"
              placeholder="Megjegyzés az adminnak (opcionális, pl. osztály / miért kell)"
              maxLength={140}
              value={forgotNote}
              onChange={e => setForgotNote(e.target.value)}
              disabled={saving}
            />
            <button type="submit" className="cta" disabled={saving || !draft.trim()}>
              {saving ? '⏳ Küldés…' : '📨 Jelzés küldése az adminnak'}
            </button>
            <button
              type="button"
              className="profile-cancel-btn"
              onClick={() => {
                clearSaveError()
                setForgotDone(null)
                setForgotCanResetNow(false)
                setMode('login')
                window.setTimeout(() => pinInputRef.current?.focus(), 60)
              }}
              disabled={saving}
            >
              ← Vissza a belépéshez
            </button>
          </div>
          {forgotDone && (
            <p className="profile-ok" role="status">{forgotDone.text}</p>
          )}
          {saveError && (
            <div className="profile-err-wrap">
              <p className="profile-err" role="alert">⚠️ {saveError}</p>
              {forgotCanResetNow && (
                <button
                  type="button"
                  className="cta"
                  onClick={() => {
                    clearSaveError()
                    setForgotCanResetNow(false)
                    setPin('')
                    setMode('edit')
                    window.setTimeout(() => pinInputRef.current?.focus(), 60)
                  }}
                >
                  🔓 Új PIN beállítása most
                </button>
              )}
            </div>
          )}
        </form>
      ) : (
        <form className="profile-form" onSubmit={submitSave}>
          <p className="profile-desc">
            {valid && hasPin
              ? 'Itt módosíthatod a neved vagy adhatsz meg új 4 jegyű PIN-kódot (hagyd üresen a PIN-t, ha marad a régi).'
              : 'Add meg egyszer az osztályod, neved és egy 4 jegyű PIN-kódot! Így bármilyen másik gépen vagy telefonon vissza tudsz lépni a profilodba.'}
          </p>
          <div className="profile-row">
            <input
              ref={inputRef}
              type="text"
              placeholder="Osztály + név (pl. 10.A Dani) *"
              maxLength={24}
              autoFocus={modal}
              value={draft}
              onChange={e => {
                setDraft(e.target.value)
                if (saveError) clearSaveError()
              }}
              disabled={saving}
            />
            <div className="profile-pin-wrap">
              <input
                ref={pinInputRef}
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                autoComplete="new-password"
                placeholder={valid && hasPin ? 'Új PIN (opc.)' : '4 jegyű PIN *'}
                maxLength={4}
                value={pin}
                onChange={e => {
                  setPin(sanitizePinInput(e.target.value))
                  if (saveError) clearSaveError()
                }}
                disabled={saving}
                aria-label="4 jegyű PIN-kód"
              />
              <button
                type="button"
                className="profile-pin-toggle"
                onClick={() => setShowPin(v => !v)}
                tabIndex={-1}
                title={showPin ? 'PIN elrejtése' : 'PIN mutatása'}
                aria-label={showPin ? 'PIN elrejtése' : 'PIN mutatása'}
              >
                {showPin ? '🙈' : '👁️'}
              </button>
            </div>
            <button
              type="submit"
              className="cta"
              disabled={saving || !draft.trim() || (pinRequired && pin.length !== 4)}
            >
              {saving ? '⏳…' : '💾 Mentés'}
            </button>
            {valid && hasPin && !modal && (
              <button
                type="button"
                className="profile-cancel-btn"
                onClick={() => {
                  setDraft(cleanName)
                  setPin('')
                  clearSaveError()
                  setMode('view')
                }}
                disabled={saving}
              >
                Mégse
              </button>
            )}
          </div>
          {!valid && (
            <div className="profile-sub-links">
              <button
                type="button"
                className="profile-link-btn"
                onClick={() => {
                  clearSaveError()
                  setLoginHint('')
                  setPin('')
                  setMode('login')
                  window.setTimeout(() => inputRef.current?.focus(), 60)
                }}
              >
                🔑 Már van profilom másik gépen → Belépés PIN-nel
              </button>
            </div>
          )}
          {saveError && <p className="profile-err" role="alert">⚠️ {saveError}</p>}
        </form>
      )}
    </section>
  )
})
