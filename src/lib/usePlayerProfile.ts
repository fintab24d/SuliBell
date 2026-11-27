import { useCallback, useEffect, useState } from 'react'
import { resetVoterId, setVoterId, voterId } from './voter'
import { PLAYER_NAME_KEY, validatePlayerName } from './moderation'
import { isNameTakenByOther, isValidPin, normalizePlayerNameKey, sanitizePinInput } from './playerProfile'
import { supabase } from './supabase'

export const PROFILE_EVENT = 'sulibell-profile-changed'
export const FOCUS_PROFILE_EVENT = 'sulibell-focus-profile'

const HAS_PIN_KEY = 'sulibell-profile-haspin'
const PROFILE_EPOCH_KEY = 'sulibell-profile-epoch'
const CURRENT_EPOCH = 'pin-v1'

const syncedKeys = new Set<string>()
let epochChecked = false

function ensureProfileEpoch(): void {
  if (epochChecked || typeof window === 'undefined') return
  epochChecked = true
  try {
    if (localStorage.getItem(PROFILE_EPOCH_KEY) !== CURRENT_EPOCH) {
      localStorage.removeItem(PLAYER_NAME_KEY)
      localStorage.removeItem(HAS_PIN_KEY)
      const lbKeys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('csengeto-arena-lb-')) lbKeys.push(k)
      }
      for (const k of lbKeys) localStorage.removeItem(k)
      resetVoterId()
      localStorage.setItem(PROFILE_EPOCH_KEY, CURRENT_EPOCH)
    }
  } catch { /* ignore */ }
}

function readStoredName(): string {
  ensureProfileEpoch()
  try {
    return (localStorage.getItem(PLAYER_NAME_KEY) || '').trim()
  } catch {
    return ''
  }
}

function readStoredHasPin(): boolean {
  ensureProfileEpoch()
  try {
    return localStorage.getItem(HAS_PIN_KEY) === '1'
  } catch {
    return false
  }
}

function writeStoredProfile(value: string, hasPinFlag: boolean): void {
  try {
    if (value) {
      localStorage.setItem(PLAYER_NAME_KEY, value)
      localStorage.setItem(HAS_PIN_KEY, hasPinFlag ? '1' : '0')
    } else {
      localStorage.removeItem(PLAYER_NAME_KEY)
      localStorage.removeItem(HAS_PIN_KEY)
    }
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail: { name: value, hasPin: hasPinFlag } }))
}

function broadcastIdentityRefresh(): void {
  window.dispatchEvent(new Event('sulibell:champion-change'))
  window.dispatchEvent(new Event('sulibell:refresh'))
}

/**
 * Fókuszba hozza az aktív központi játékosprofil-kártyát,
 * vagy ha nincs látható kártya az oldalon, az App globális modalját nyitja meg.
 */
export function focusPlayerProfile(): void {
  window.dispatchEvent(new CustomEvent(FOCUS_PROFILE_EVENT, { cancelable: true }))
}

export interface SaveProfileResult {
  ok: boolean
  name?: string
  playerId?: string
  error?: string
  code?: 'invalid_name' | 'pin_invalid' | 'pin_required' | 'not_found' | 'no_pin' | 'wrong_pin' | 'locked' | 'network'
  existingName?: string
}

export interface PinResetRequestResult {
  ok: boolean
  alreadyPending?: boolean
  name?: string
  error?: string
  code?: 'not_found' | 'already_reset' | 'cooldown' | 'network'
}

export interface PlayerProfileState {
  name: string
  cleanName: string
  valid: boolean
  hasPin: boolean
  validationError?: string
  playerId: string
  saving: boolean
  saveError: string
  clearSaveError: () => void
  saveName: (rawName: string, pin?: string) => Promise<SaveProfileResult>
  loginWithPin: (rawName: string, pin: string) => Promise<SaveProfileResult>
  requestPinReset: (rawName: string, note?: string) => Promise<PinResetRequestResult>
  logout: () => void
}

export function usePlayerProfile(schoolId?: string): PlayerProfileState {
  const [name, setName] = useState<string>(() => readStoredName())
  const [hasPin, setHasPin] = useState<boolean>(() => readStoredHasPin())
  const [playerId, setPlayerId] = useState<string>(() => {
    ensureProfileEpoch()
    return voterId()
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    const sync = () => {
      setName(readStoredName())
      setHasPin(readStoredHasPin())
      setPlayerId(voterId())
    }
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === PLAYER_NAME_KEY || e.key === HAS_PIN_KEY || e.key === 'voter') sync()
    }
    window.addEventListener(PROFILE_EVENT, sync)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(PROFILE_EVENT, sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  // Profil és PIN-állapot szinkronizálása Supabase-ből a jelenlegi playerId-hoz
  useEffect(() => {
    if (!schoolId || !playerId) return
    const syncKey = `${schoolId}:${playerId}`
    if (syncedKeys.has(syncKey)) return
    syncedKeys.add(syncKey)

    let cancelled = false
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('player_profiles')
          .select('player_name, has_pin')
          .eq('school_id', schoolId)
          .eq('player_id', playerId)
          .maybeSingle()
        if (cancelled || error) return
        if (!data) {
          // Ha az adatbázisban törölve lett a korábban mentett profil, helyben is ürítjük
          if (readStoredName() && readStoredHasPin()) {
            writeStoredProfile('', false)
          }
          return
        }
        const remoteName = String((data as any).player_name ?? '').trim()
        const remoteHasPin = Boolean((data as any).has_pin)
        if (!remoteName) return
        const local = readStoredName()
        const localPin = readStoredHasPin()
        if (!local || local !== remoteName || localPin !== remoteHasPin) {
          writeStoredProfile(remoteName, remoteHasPin)
        }
      } catch {
        // Tábla/oszlop még nem létezik vagy hálózati hiba
      }
    })()

    return () => { cancelled = true }
  }, [schoolId, playerId])

  const validation = validatePlayerName(name, true)
  const cleanName = validation.valid && validation.cleanName ? validation.cleanName : name.trim()

  const clearSaveError = useCallback(() => setSaveError(''), [])

  const saveName = useCallback(async (rawName: string, rawPin = ''): Promise<SaveProfileResult> => {
    const res = validatePlayerName(rawName, true)
    if (!res.valid || !res.cleanName) {
      const msg = res.error ?? 'Érvénytelen név.'
      setSaveError(msg)
      return { ok: false, code: 'invalid_name', error: msg }
    }

    const cleanPin = sanitizePinInput(rawPin)
    const needsPin = !validation.valid || !hasPin
    if ((cleanPin && !isValidPin(cleanPin)) || (needsPin && !isValidPin(cleanPin))) {
      const msg = 'Adj meg egy pontosan 4 számjegyű PIN-kódot (pl. 4821)!'
      setSaveError(msg)
      return { ok: false, code: 'pin_invalid', error: msg }
    }

    const nextName = res.cleanName
    const curId = voterId()
    setSaving(true)
    setSaveError('')

    try {
      if (schoolId) {
        const { data, error } = await supabase.rpc('save_player_profile', {
          p_school: schoolId,
          p_player: curId,
          p_name: nextName,
          p_pin: cleanPin || null,
          p_name_key: normalizePlayerNameKey(nextName),
        })

        if (!error && data && typeof data === 'object') {
          const payload = data as {
            ok?: boolean
            error?: string
            name?: string
            player_id?: string
            existing_name?: string
          }
          if (payload.ok === false) {
            if (payload.error === 'pin_required') {
              const existingName = payload.existing_name || nextName
              const msg = `A(z) ${existingName} név már foglalt! Ha ez a te profilod, lépj be a 4 jegyű PIN-kódoddal.`
              setSaveError(msg)
              return { ok: false, code: 'pin_required', existingName, error: msg }
            }
            if (payload.error === 'pin_invalid') {
              const msg = 'Adj meg egy 4 számjegyű PIN-kódot (pl. 4821)!'
              setSaveError(msg)
              return { ok: false, code: 'pin_invalid', error: msg }
            }
            const msg = 'Nem sikerült menteni a profilt. Próbáld újra!'
            setSaveError(msg)
            return { ok: false, error: msg }
          }

          const finalId = (payload.player_id || curId).trim()
          const finalName = (payload.name || nextName).trim()
          if (finalId !== curId) {
            setVoterId(finalId)
            setPlayerId(finalId)
          }
          syncedKeys.add(`${schoolId}:${finalId}`)
          writeStoredProfile(finalName, true)
          setName(finalName)
          setHasPin(true)
          broadcastIdentityRefresh()
          return { ok: true, name: finalName, playerId: finalId }
        }

        // Fallback az update28.sql lefuttatása előtti környezethez
        const { data: recentScores } = await supabase
          .from('arena_scores')
          .select('player_id, player_name')
          .eq('school_id', schoolId)
          .order('updated_at', { ascending: false })
          .limit(300)

        if (recentScores && isNameTakenByOther(nextName, curId, recentScores.map(r => ({
          playerId: String(r.player_id ?? ''),
          name: String(r.player_name ?? ''),
        })))) {
          const msg = 'Ez a név már szerepel a toplistán másik játékosnál! Válassz másikat.'
          setSaveError(msg)
          return { ok: false, code: 'pin_required', error: msg }
        }
      }

      writeStoredProfile(nextName, true)
      setName(nextName)
      setHasPin(true)
      broadcastIdentityRefresh()
      return { ok: true, name: nextName, playerId: curId }
    } catch {
      const msg = 'Hálózati hiba történt mentés közben.'
      setSaveError(msg)
      return { ok: false, code: 'network', error: msg }
    } finally {
      setSaving(false)
    }
  }, [schoolId, validation.valid, hasPin])

  const loginWithPin = useCallback(async (rawName: string, rawPin: string): Promise<SaveProfileResult> => {
    const res = validatePlayerName(rawName, true)
    if (!res.valid || !res.cleanName) {
      const msg = res.error ?? 'Add meg az osztályod és neved!'
      setSaveError(msg)
      return { ok: false, code: 'invalid_name', error: msg }
    }
    const cleanPin = sanitizePinInput(rawPin)
    if (!isValidPin(cleanPin)) {
      const msg = 'Írd be a 4 számjegyű PIN-kódodat!'
      setSaveError(msg)
      return { ok: false, code: 'pin_invalid', error: msg }
    }
    if (!schoolId) {
      const msg = 'A többgépes belépéshez élő szerverkapcsolat szükséges.'
      setSaveError(msg)
      return { ok: false, code: 'network', error: msg }
    }

    setSaving(true)
    setSaveError('')
    try {
      const { data, error } = await supabase.rpc('login_player_profile', {
        p_school: schoolId,
        p_name: res.cleanName,
        p_pin: cleanPin,
      })

      if (error || !data || typeof data !== 'object') {
        const msg = 'A PIN-es belépés még nem elérhető (futtasd az update28.sql frissítést!).'
        setSaveError(msg)
        return { ok: false, code: 'network', error: msg }
      }

      const payload = data as {
        ok?: boolean
        error?: string
        player_id?: string
        name?: string
        attempts_left?: number
        retry_sec?: number
      }

      if (payload.ok === false) {
        if (payload.error === 'not_found') {
          const msg = 'Még nincs ilyen névvel regisztrált profil — válaszd az új név létrehozását!'
          setSaveError(msg)
          return { ok: false, code: 'not_found', error: msg }
        }
        if (payload.error === 'no_pin') {
          const msg = 'Ehhez a névhez nullázták a PIN-t — válaszd a Mentés nézetet, és adj meg egy új 4 jegyű PIN-t!'
          setSaveError(msg)
          return { ok: false, code: 'no_pin', error: msg }
        }
        if (payload.error === 'locked') {
          const mins = Math.max(1, Math.ceil((payload.retry_sec ?? 300) / 60))
          const msg = `Túl sok hibás PIN! Próbáld újra kb. ${mins} perc múlva.`
          setSaveError(msg)
          return { ok: false, code: 'locked', error: msg }
        }
        if (payload.error === 'wrong_pin') {
          const left = payload.attempts_left ?? 1
          const msg = `Hibás PIN-kód! Még ${left} próbálkozásod maradt.`
          setSaveError(msg)
          return { ok: false, code: 'wrong_pin', error: msg }
        }
        const msg = 'Sikertelen belépés. Próbáld újra!'
        setSaveError(msg)
        return { ok: false, error: msg }
      }

      const targetId = String(payload.player_id || '').trim()
      const targetName = String(payload.name || res.cleanName).trim()
      if (targetId) {
        setVoterId(targetId)
        setPlayerId(targetId)
        syncedKeys.add(`${schoolId}:${targetId}`)
      }
      writeStoredProfile(targetName, true)
      setName(targetName)
      setHasPin(true)
      broadcastIdentityRefresh()
      return { ok: true, name: targetName, playerId: targetId }
    } catch {
      const msg = 'Hálózati hiba történt belépés közben.'
      setSaveError(msg)
      return { ok: false, code: 'network', error: msg }
    } finally {
      setSaving(false)
    }
  }, [schoolId])

  const requestPinReset = useCallback(async (rawName: string, note = ''): Promise<PinResetRequestResult> => {
    const res = validatePlayerName(rawName, true)
    if (!res.valid || !res.cleanName) {
      const msg = res.error ?? 'Add meg vagy válaszd ki a neved!'
      setSaveError(msg)
      return { ok: false, code: 'not_found', error: msg }
    }
    if (!schoolId) {
      const msg = 'A jelzés küldéséhez élő szerverkapcsolat szükséges.'
      setSaveError(msg)
      return { ok: false, code: 'network', error: msg }
    }

    const nKey = normalizePlayerNameKey(res.cleanName)
    const cdKey = `sulibell-pin-reset-ts-${nKey}`
    try {
      const lastTs = Number(localStorage.getItem(cdKey) || '0')
      if (lastTs > 0 && Date.now() - lastTs < 60_000) {
        const msg = 'Nemrég már küldtél jelzést ehhez a névhez, várj egy picit!'
        setSaveError(msg)
        return { ok: false, code: 'cooldown', error: msg }
      }
    } catch { /* ignore */ }

    setSaving(true)
    setSaveError('')
    try {
      const { data, error } = await supabase.rpc('request_pin_reset', {
        p_school: schoolId,
        p_name: res.cleanName,
        p_note: note.trim().slice(0, 140),
      })

      if (error || !data || typeof data !== 'object') {
        const msg = 'Nem sikerült elküldeni a jelzést az adminnak. Próbáld meg újra!'
        setSaveError(msg)
        return { ok: false, code: 'network', error: msg }
      }

      const payload = data as {
        ok?: boolean
        error?: string
        already_pending?: boolean
        name?: string
      }

      if (payload.ok === false) {
        if (payload.error === 'already_reset') {
          const msg = 'Ennek a profilnak már nullázva van a PIN-kódja! Lépj vissza és adj meg egy új 4 jegyű PIN-t.'
          setSaveError(msg)
          return { ok: false, code: 'already_reset', name: payload.name || res.cleanName, error: msg }
        }
        const msg = 'Nem található ilyen nevű mentett profil. Válaszd ki a pontos neved a listából!'
        setSaveError(msg)
        return { ok: false, code: 'not_found', error: msg }
      }

      try {
        localStorage.setItem(cdKey, String(Date.now()))
      } catch { /* ignore */ }

      return {
        ok: true,
        alreadyPending: Boolean(payload.already_pending),
        name: String(payload.name || res.cleanName),
      }
    } catch {
      const msg = 'Hálózati hiba történt a jelzés küldésekor.'
      setSaveError(msg)
      return { ok: false, code: 'network', error: msg }
    } finally {
      setSaving(false)
    }
  }, [schoolId])

  const logout = useCallback(() => {
    syncedKeys.clear()
    const freshId = resetVoterId()
    setPlayerId(freshId)
    setName('')
    setHasPin(false)
    setSaveError('')
    writeStoredProfile('', false)
    broadcastIdentityRefresh()
  }, [])

  return {
    name,
    cleanName,
    valid: validation.valid,
    hasPin,
    validationError: validation.error,
    playerId,
    saving,
    saveError,
    clearSaveError,
    saveName,
    loginWithPin,
    requestPinReset,
    logout,
  }
}
