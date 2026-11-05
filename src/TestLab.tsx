import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import App from './App'
import { supabase } from './lib/supabase'
import { enableAudio, ring } from './lib/sound'
import { toSec } from './lib/engine'
import { resetSandbox, updateSandbox, useSandbox } from './lib/sandbox'

const pad = (n: number) => String(n).padStart(2, '0')
const secToHMS = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`

export default function TestLab() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setIsAdmin(false)
      return
    }
    supabase
      .from('school_members')
      .select('school_id')
      .then(({ data }) => setIsAdmin(!!data?.length))
  }, [session])

  if (session === undefined || (session && isAdmin === undefined)) {
    return <main className="admin">Tesztlabor jogosultság ellenőrzése…</main>
  }

  if (!session) {
    return <TestLogin />
  }

  if (!isAdmin) {
    return (
      <main className="admin">
        <h1>🔒 Privát Tesztlabor</h1>
        <p>Ehhez az oldalhoz csak az iskola adminisztrátorai férhetnek hozzá.</p>
        <div className="row">
          <a className="btn" href="/">← Vissza a főoldalra</a>
          <button onClick={() => supabase.auth.signOut()}>Kilépés</button>
        </div>
      </main>
    )
  }

  return <SandboxWorkspace />
}

function TestLogin() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')

  const go = async (e: FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    if (error) setErr('Hibás email vagy jelszó.')
  }

  return (
    <main className="admin">
      <h1>🧪 Privát Admin Tesztlabor – Belépés</h1>
      <p style={{ opacity: 0.75, marginBottom: '1rem' }}>
        Ez a tesztoldal nyilvánosan nem látható. A belépéshez adminisztrátori fiók szükséges.
      </p>
      <form onSubmit={go} className="row">
        <input type="email" placeholder="Admin email" value={email} onChange={e => setEmail(e.target.value)} required />
        <input type="password" placeholder="Jelszó" value={pw} onChange={e => setPw(e.target.value)} required />
        <button>Belépés a Tesztlaborba</button>
      </form>
      {err && <p>{err}</p>}
    </main>
  )
}

function SandboxWorkspace() {
  const sb = useSandbox(true)
  const [open, setOpen] = useState(true)
  const [customLesson, setCustomLesson] = useState('2. óra')
  const [customKind, setCustomKind] = useState<'cancel' | 'substitute' | 'room' | 'info'>('cancel')
  const [customText, setCustomText] = useState('Elmarad (teszt)')

  const addQuickChange = (lesson_label: string, kind: 'cancel' | 'substitute' | 'room' | 'info', text: string) => {
    updateSandbox({
      extraChanges: [
        ...sb.extraChanges.filter(c => !(c.lesson_label === lesson_label && c.kind === kind)),
        { id: `sb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind, lesson_label, text },
      ],
    })
  }

  const removeChange = (id: string) => {
    updateSandbox({ extraChanges: sb.extraChanges.filter(c => c.id !== id) })
  }

  const setSimTime = (hms: string, opts?: { closedReason?: string | null; forceBreakMedia?: boolean }) => {
    updateSandbox({
      simSecs: toSec(hms),
      simClosedReason: opts?.closedReason ?? null,
      forceBreakMedia: opts?.forceBreakMedia ?? sb.forceBreakMedia,
    })
  }

  return (
    <div className="testlab-wrap">
      <aside className={`testlab-dock${open ? ' open' : ' collapsed'}`} aria-label="Admin Tesztlabor vezérlőpult">
        <div className="testlab-bar">
          <div className="testlab-title">
            <span className="testlab-badge">🔒 PRIVÁT TESZTLABOR</span>
            <b>Csak te látod — semmi nem módosítja az éles oldalt</b>
          </div>
          <div className="testlab-actions">
            <button
              type="button"
              className={!sb.simTv ? 'active' : ''}
              onClick={() => updateSandbox({ simTv: false })}
            >
              📱 Főoldal nézet
            </button>
            <button
              type="button"
              className={sb.simTv ? 'active' : ''}
              onClick={() => updateSandbox({ simTv: true })}
            >
              📺 Display (/display) nézet
            </button>
            <button type="button" onClick={() => resetSandbox()} title="Minden teszt beállítás alaphelyzetbe">
              ↺ Alaphelyzet
            </button>
            <a className="btn" href="/admin">← Admin felület</a>
            <button type="button" className="testlab-toggle" onClick={() => setOpen(o => !o)}>
              {open ? '▲ Vezérlő elrejtése' : '▼ Teszt vezérlőpult'}
            </button>
          </div>
        </div>

        {open && (
          <div className="testlab-grid">
            {/* 1. IDŐ ÉS FÁZIS SZIMULÁTOR */}
            <div className="testlab-card">
              <h3>⏱️ Idő- és Fázis-szimulátor</h3>
              <div className="testlab-btns">
                <button
                  type="button"
                  className={sb.simSecs === null && !sb.simClosedReason ? 'active' : ''}
                  onClick={() => updateSandbox({ simSecs: null, simClosedReason: null })}
                >
                  🟢 Valós élő idő
                </button>
                <button type="button" onClick={() => setSimTime('07:45:00')}>
                  🌅 Tanítás előtt (07:45)
                </button>
                <button type="button" onClick={() => setSimTime('08:20:00')}>
                  📚 1. óra (08:20)
                </button>
                <button type="button" onClick={() => setSimTime('08:44:50')}>
                  🔥 Utolsó 10 mp (08:44:50)
                </button>
                <button type="button" onClick={() => setSimTime('08:50:00', { forceBreakMedia: true })}>
                  🎉 Szünet + Videó/Zene (08:50)
                </button>
                <button type="button" onClick={() => setSimTime('15:15:00')}>
                  🏁 Tanítás után (15:15)
                </button>
                <button
                  type="button"
                  className={!!sb.simClosedReason ? 'active' : ''}
                  onClick={() =>
                    updateSandbox({
                      simClosedReason: sb.simClosedReason ? null : 'Teszt szünnap / Tanítás nélküli nap',
                    })
                  }
                >
                  🏖️ Pihenő / Szünnap mód
                </button>
              </div>
              <div className="testlab-row">
                <label>
                  Egyéni időpont:{' '}
                  <input
                    type="time"
                    step={1}
                    value={sb.simSecs !== null ? secToHMS(sb.simSecs) : '08:20:00'}
                    onChange={e => e.target.value && setSimTime(e.target.value.length === 5 ? `${e.target.value}:00` : e.target.value)}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={sb.forceBreakMedia}
                    onChange={e => updateSandbox({ forceBreakMedia: e.target.checked })}
                  />{' '}
                  Szünetben demó videó/zene kényszerítése
                </label>
              </div>
            </div>

            {/* 2. ÓRAREND-VÁLTOZÁSOK ÉS ELMARADÓ ÓRÁK */}
            <div className="testlab-card">
              <h3>🚫 Elmaradó órák & Helyettesítések tesztje</h3>
              <div className="testlab-btns">
                <button type="button" onClick={() => addQuickChange('1. óra', 'cancel', 'Matematika elmarad')}>
                  + 1. óra Elmarad
                </button>
                <button type="button" onClick={() => addQuickChange('2. óra', 'cancel', 'Történelem elmarad')}>
                  + 2. óra Elmarad
                </button>
                <button type="button" onClick={() => addQuickChange('7. óra', 'cancel', 'Utolsó óra elmarad')}>
                  + 7. óra Elmarad
                </button>
                <button type="button" onClick={() => addQuickChange('3. óra', 'substitute', 'Kovács tanárnő helyettesít')}>
                  + 3. óra Helyettesítés
                </button>
                <button type="button" onClick={() => addQuickChange('4. óra', 'room', '204-es terem')}>
                  + 4. óra Teremváltás
                </button>
                {sb.extraChanges.length > 0 && (
                  <button type="button" onClick={() => updateSandbox({ extraChanges: [] })}>
                    🗑️ Változások törlése ({sb.extraChanges.length})
                  </button>
                )}
              </div>
              <div className="testlab-row">
                <input
                  placeholder="pl. 5. óra"
                  value={customLesson}
                  onChange={e => setCustomLesson(e.target.value)}
                  style={{ width: '5.5rem' }}
                />
                <select value={customKind} onChange={e => setCustomKind(e.target.value as any)}>
                  <option value="cancel">Elmarad</option>
                  <option value="substitute">Helyettesítés</option>
                  <option value="room">Teremváltás</option>
                  <option value="info">Infó</option>
                </select>
                <input
                  placeholder="Megjegyzés"
                  value={customText}
                  onChange={e => setCustomText(e.target.value)}
                  style={{ flex: 1, minWidth: '7rem' }}
                />
                <button
                  type="button"
                  onClick={() => customLesson.trim() && addQuickChange(customLesson.trim(), customKind, customText.trim())}
                >
                  Hozzáad
                </button>
              </div>
              {sb.extraChanges.length > 0 && (
                <div className="testlab-tags">
                  {sb.extraChanges.map(c => (
                    <span key={c.id} className="testlab-tag">
                      <b>{c.lesson_label}</b> ({c.kind}): {c.text}
                      <button type="button" onClick={() => removeChange(c.id)}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 3. FRISSÍTÉS OVERLAY ÉS RIADÓ */}
            <div className="testlab-card">
              <h3>🔄 Homályos Frissítés & 🚨 Riadó képernyő</h3>
              <div className="testlab-btns">
                <button
                  type="button"
                  className={sb.maintMain ? 'active' : ''}
                  onClick={() => updateSandbox({ maintMain: !sb.maintMain })}
                >
                  {sb.maintMain ? '🟢 Főoldal Frissítés AKTÍV' : '⚪ Főoldal Frissítés teszt'}
                </button>
                <button
                  type="button"
                  className={sb.maintTv ? 'active' : ''}
                  onClick={() => updateSandbox({ maintTv: !sb.maintTv })}
                >
                  {sb.maintTv ? '🟢 Display Frissítés AKTÍV' : '⚪ Display Frissítés teszt'}
                </button>
                <button
                  type="button"
                  className={sb.alertActive ? 'active' : ''}
                  onClick={() => updateSandbox({ alertActive: !sb.alertActive })}
                >
                  {sb.alertActive ? '🚨 Riadó AKTÍV' : '🚨 Riadó képernyő teszt'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await enableAudio()
                    ring( null)
                  }}
                >
                  🔔 Csengőhang teszt
                </button>
              </div>
              <div className="testlab-row">
                <input
                  placeholder="Frissítés üzenete…"
                  value={sb.maintText}
                  onChange={e => updateSandbox({ maintText: e.target.value })}
                  style={{ flex: 1 }}
                />
                <input
                  placeholder="Riadó szövege…"
                  value={sb.alertText}
                  onChange={e => updateSandbox({ alertText: e.target.value })}
                  style={{ flex: 1 }}
                />
              </div>
            </div>

            {/* 4. TESZT KÖZLEMÉNY ÉS EBÉDMENÜ */}
            <div className="testlab-card">
              <h3>📢 Közlemény & 🍽️ Ebédmenü élő előnézet</h3>
              <div className="testlab-row">
                <input
                  placeholder="Teszt közlemény a fejlécben (pl. Ma 14:00-kor diáknap a tornateremben!)"
                  value={sb.testAnnouncement}
                  onChange={e => updateSandbox({ testAnnouncement: e.target.value })}
                  style={{ flex: 1 }}
                />
                {sb.testAnnouncement && (
                  <button type="button" onClick={() => updateSandbox({ testAnnouncement: '' })}>×</button>
                )}
              </div>
              <div className="testlab-row">
                <input
                  placeholder="Teszt mai ebéd (pl. Újházi tyúkhúsleves, Rántott sajt jázmin rizzsel)"
                  value={sb.testMenu}
                  onChange={e => updateSandbox({ testMenu: e.target.value })}
                  style={{ flex: 1 }}
                />
                {sb.testMenu && (
                  <button type="button" onClick={() => updateSandbox({ testMenu: '' })}>×</button>
                )}
              </div>
            </div>
          </div>
        )}
      </aside>

      <div className="testlab-stage">
        <App sandbox />
      </div>
    </div>
  )
}
