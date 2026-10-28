import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase, SCHOOL_SLUG } from './lib/supabase'

type Msg = { role: 'user' | 'model'; text: string }
const TIPS = ['Mikor van a következő csengetés?', 'Mi az ebéd ma?', 'Mikor lesz a következő szünet?', 'Elmarad ma valamelyik óra?']

/** AI-asszisztens: a látogató kérdezhet az iskola adatairól, a választ a Supabase "ask" függvény (Gemini) adja. */
export default function Ask() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs, busy, open])

  const send = async (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    const history = msgs.slice(-6)
    setMsgs(m => [...m, { role: 'user', text: t }]); setQ(''); setBusy(true)
    let answer = 'Most nem tudok válaszolni, próbáld később.'
    try {
      const { data, error } = await supabase.functions.invoke('ask', { body: { slug: SCHOOL_SLUG, question: t, history } })
      if (data?.answer) answer = data.answer
      else if (data?.error) answer = data.error
      else if (error) {
        try { const j = await (error as any).context?.json?.(); if (j?.error) answer = j.error + (j.detail ? `\n(${j.detail})` : '') } catch { /* marad az általános üzenet */ }
      }
    } catch { /* hálózati hiba: marad az általános üzenet */ }
    setMsgs(m => [...m, { role: 'model', text: answer }]); setBusy(false)
  }
  const submit = (e: FormEvent) => { e.preventDefault(); send(q) }

  return <>
    <button className="askfab" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="Kérdezz az asszisztenstől">{open ? '✕' : '💬 Kérdezz'}</button>
    {open && <section className="askbox" role="dialog" aria-label="Asszisztens">
      <header><b>SuliBell asszisztens</b><small>AI válaszol, tévedhet. Fontos dolgot ellenőrizz.</small></header>
      <div className="askmsgs" aria-live="polite">
        {msgs.length === 0 && <div className="askhint"><p>Kérdezz az iskola csengetéséről, szüneteiről, az ebédről vagy a változásokról.</p>
          {TIPS.map(t => <button key={t} onClick={() => send(t)}>{t}</button>)}</div>}
        {msgs.map((m, i) => <p key={i} className={`askm ${m.role}`}>{m.text}</p>)}
        {busy && <p className="askm model askdots" aria-label="Gondolkodik"><i /><i /><i /></p>}
        <div ref={end} />
      </div>
      <form onSubmit={submit}><input value={q} maxLength={400} onChange={e => setQ(e.target.value)} placeholder="Írd be a kérdésed…" aria-label="Kérdés" /><button className="cta" disabled={busy || !q.trim()}>Küldés</button></form>
    </section>}
  </>
}
