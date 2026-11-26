import { memo, useState, type FormEvent } from 'react'
import { DISCORD_INVITE_URL, submitFeedbackToDiscord } from './lib/discord'
import { checkProfanity } from './lib/moderation'

const COOLDOWN_KEY = 'sulibell_feedback_last_v1'
const COOLDOWN_MS = 60_000

type FeedbackKind = 'bug' | 'idea'

function readLastSent(): number {
  try {
    const n = Number(localStorage.getItem(COOLDOWN_KEY) || '0')
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

function saveLastSent(ts: number) {
  try {
    localStorage.setItem(COOLDOWN_KEY, String(ts))
  } catch {
    // ignore storage errors
  }
}

/** Főoldali Hibajelentés & Ötletek kártya: beépített azonnali küldés a Discord fórumra + Discord szobák leírása. */
export default memo(function FeedbackPanel() {
  const [mode, setMode] = useState<FeedbackKind | null>(null)
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [by, setBy] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  const toggleMode = (next: FeedbackKind) => {
    setStatus(null)
    setMode(cur => (cur === next ? null : next))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!mode || sending) return

    const cleanTitle = title.trim()
    const cleanDetails = details.trim()
    const cleanBy = by.trim()

    if (cleanTitle.length < 3) {
      setStatus({ ok: false, text: 'Adj meg legalább 3 karakteres rövid címet!' })
      return
    }
    if (cleanDetails.length < 5) {
      setStatus({ ok: false, text: 'Írj legalább pár szót a részletekről (min. 5 karakter)!' })
      return
    }

    const profTitle = checkProfanity(cleanTitle)
    const profDetails = checkProfanity(cleanDetails)
    const profBy = cleanBy ? checkProfanity(cleanBy) : { clean: true }
    if (!profTitle.clean || !profDetails.clean || !profBy.clean) {
      setStatus({
        ok: false,
        text: 'Kérjük, fogalmazz iskolabarát, kulturált stílusban!',
      })
      return
    }

    const elapsed = Date.now() - readLastSent()
    if (elapsed < COOLDOWN_MS) {
      const leftSec = Math.ceil((COOLDOWN_MS - elapsed) / 1000)
      setStatus({
        ok: false,
        text: `Várj még ${leftSec} másodpercet a következő beküldés előtt!`,
      })
      return
    }

    setSending(true)
    setStatus(null)
    const res = await submitFeedbackToDiscord({
      kind: mode,
      title: cleanTitle,
      details: cleanDetails,
      by: cleanBy || undefined,
    })
    setSending(false)

    if (res.ok) {
      saveLastSent(Date.now())
      setStatus({
        ok: true,
        text:
          mode === 'bug'
            ? '✅ Köszi! A hibajelentésed megérkezett a Discord #🐛-hibajelentés szobába.'
            : '✅ Köszi! Az ötleted megérkezett a Discord #💡-ötletek-javaslatok szobába.',
      })
      setTitle('')
      setDetails('')
      setMode(null)
    } else {
      setStatus({ ok: false, text: res.error || 'A küldés nem sikerült. Próbáld meg Discordon!' })
    }
  }

  return (
    <section className="panel feedback-panel">
      <div className="tag">💬 Hibajelentés &amp; Ötletek</div>

      <p className="feedback-desc">
        Találtál egy hibát az oldalon, vagy van egy jó ötleted a SuliBellhez? Írd meg{' '}
        <b>közvetlenül itt</b> az űrlapon (azonnal továbbítjuk a fejlesztőknek), vagy csatlakozz a{' '}
        <b>Discord szerverre</b>, ahol meg is beszélhetjük és szavazhatsz mások ötleteire!
      </p>

      <div className="feedback-channels">
        <span>
          🐛 Hibajelentés: <code>#🐛-hibajelentés</code>
        </span>
        <span>
          💡 Ötletek: <code>#💡-ötletek-javaslatok</code>
        </span>
      </div>

      <div className="feedback-actions">
        <button
          type="button"
          className={mode === 'bug' ? 'on' : ''}
          onClick={() => toggleMode('bug')}
          aria-expanded={mode === 'bug'}
        >
          🐛 Hiba bejelentése
        </button>
        <button
          type="button"
          className={mode === 'idea' ? 'on' : ''}
          onClick={() => toggleMode('idea')}
          aria-expanded={mode === 'idea'}
        >
          💡 Ötlet írása
        </button>
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn feedback-discord-btn"
        >
          💬 Discord megnyitása
        </a>
      </div>

      {status && (
        <div className={`feedback-msg ${status.ok ? 'ok' : 'err'}`} role="status">
          {status.text}
        </div>
      )}

      {mode && (
        <form className="feedback-form" onSubmit={handleSubmit}>
          <div className="feedback-form-head">
            <b>{mode === 'bug' ? '🐛 Mit vettél észre?' : '💡 Mi az ötleted?'}</b>
            <small>Közvetlenül a Discord fórumra kerül</small>
          </div>

          <input
            type="text"
            placeholder={
              mode === 'bug'
                ? 'Rövid cím (pl. Telefonon elcsúszik az órarend)'
                : 'Ötlet címe (pl. Új téma vagy minijáték javaslat)'
            }
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={80}
            required
          />

          <textarea
            placeholder={
              mode === 'bug'
                ? 'Írd le röviden, mi történt, milyen eszközön/böngészőben láttad, és hogyan jött elő…'
                : 'Írd le az ötleted részletesebben — hogyan működne, miért lenne jó a suliban?'
            }
            value={details}
            onChange={e => setDetails(e.target.value)}
            maxLength={800}
            rows={3}
            required
          />

          <input
            type="text"
            placeholder="Neved / osztályod (opcionális, pl. Peti 10.B)"
            value={by}
            onChange={e => setBy(e.target.value)}
            maxLength={40}
          />

          <div className="feedback-form-btns">
            <button type="submit" className="cta" disabled={sending}>
              {sending ? 'Küldés…' : '📤 Küldés a fejlesztőknek'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode(null)
                setStatus(null)
              }}
              disabled={sending}
            >
              Mégse
            </button>
          </div>
        </form>
      )}
    </section>
  )
})
