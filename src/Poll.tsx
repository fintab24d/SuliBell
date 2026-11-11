import { useCallback, useEffect, useState } from 'react'
import { supabase, SCHOOL_SLUG } from './lib/supabase'
import { APP_NAME } from './lib/brand'

export type PollT = { id: string; question: string; options: string[] }
const COL = ['var(--n-pink)', 'var(--n-cyan)', 'var(--n-amber)', 'var(--n-green)', 'var(--n-pink)', 'var(--n-cyan)']

/** Névtelen szavazó-azonosító (csak ezen az eszközön él, hogy ne lehessen többször szavazni). */
export const voterId = () => {
  try {
    let v = localStorage.getItem('voter')
    if (!v) { v = crypto.randomUUID(); localStorage.setItem('voter', v) }
    return v
  } catch { return 'anon-' + Math.random().toString(36).slice(2, 12) }
}

/** Az aktív szavazás és az állása (valós időben + 5 mp-enként + fókuszváltáskor frissül). */
export function usePoll(schoolId?: string) {
  const [poll, setPoll] = useState<PollT | null>(null)
  const [counts, setCounts] = useState<number[]>([])
  const refresh = useCallback(async () => {
    if (!schoolId) return
    const { data, error } = await supabase.from('polls').select('id, question, options').eq('school_id', schoolId).eq('active', true).maybeSingle()
    if (error) return                       // update11.sql még nincs lefuttatva: nincs szavazás
    setPoll(data as PollT | null)
    if (data) { const c = await supabase.rpc('poll_counts', { p_poll: data.id }); if (!c.error) setCounts((c.data as number[]) ?? []) }
    else setCounts([])
  }, [schoolId])
  useEffect(() => {
    refresh()
    const onWake = () => { if (!document.hidden) refresh() }
    const onRefresh = () => { refresh() }
    const t = setInterval(() => { if (!document.hidden) refresh() }, 5000)
    const ch = schoolId
      ? supabase
          .channel(`sulibell-polls-pg-${schoolId}-${Math.random().toString(36).slice(2, 8)}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'polls', filter: `school_id=eq.${schoolId}` }, () => refresh())
          .subscribe()
      : null
    window.addEventListener('sulibell:refresh', onRefresh)
    document.addEventListener('visibilitychange', onWake)
    document.addEventListener('resume', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('pageshow', onWake)
    return () => {
      clearInterval(t)
      if (ch) supabase.removeChannel(ch)
      window.removeEventListener('sulibell:refresh', onRefresh)
      document.removeEventListener('visibilitychange', onWake)
      document.removeEventListener('resume', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('pageshow', onWake)
    }
  }, [refresh, schoolId])
  return { poll, counts, refresh }
}

export const myVote = (id: string) => { try { const v = localStorage.getItem('vote-' + id); return v == null ? null : +v } catch { return null } }

/** Szavazó kártya: gombok, ha még nem szavaztál; eredménysávok, ha igen (vagy a TV-n mindig). */
export function PollCard({ poll, counts, tv, qr, onVoted }: { poll: PollT; counts: number[]; tv?: boolean; qr?: string; onVoted?: () => void }) {
  const [mine, setMine] = useState<number | null>(() => myVote(poll.id))
  const [err, setErr] = useState('')
  const total = counts.reduce((a, b) => a + b, 0)
  const top = Math.max(0, ...counts)
  const vote = async (i: number) => {
    const { error } = await supabase.rpc('cast_vote', { p_poll: poll.id, p_opt: i, p_voter: voterId() })
    if (error) return setErr('Nem sikerült szavazni.')
    try { localStorage.setItem('vote-' + poll.id, String(i)) } catch { /* nem baj */ }
    setMine(i); setErr(''); onVoted?.()
  }
  const showBars = tv || mine != null
  return <section className="panel poll full">
    <div className="tag">Szavazás</div>
    <h2>{poll.question}</h2>
    <div className="pollopts">
      {poll.options.map((o, i) => showBars
        ? <div key={i} className={`pbar ${counts[i] === top && top > 0 ? 'lead' : ''}`} style={{ '--c': COL[i], '--w': `${total ? Math.round((counts[i] ?? 0) / total * 100) : 0}%` } as any}>
            <i /><span>{mine === i ? `✓ ${o}` : o}</span><b>{total ? Math.round((counts[i] ?? 0) / total * 100) : 0}%</b></div>
        : <button key={i} className="popt" style={{ '--c': COL[i] } as any} onClick={() => vote(i)}>{o}</button>)}
    </div>
    {err && <p className="meta">{err}</p>}
    {showBars && <p className="meta">{total} szavazat{mine != null && !tv ? ', köszönjük!' : ''}</p>}
    {qr && <div className="pollqr"><img src={qr} alt="QR-kód a szavazáshoz" /><span>Szavazz telefonon</span></div>}
  </section>
}

/** /szavazas: a TV-n lévő QR-kód ide visz; egyetlen kérdés, nagy gombok. */
export default function Vote() {
  const [sid, setSid] = useState<string>()
  const [state, setState] = useState<'load' | 'ok' | 'err'>('load')
  useEffect(() => {
    document.documentElement.dataset.theme = localStorage.getItem('theme') ?? 'dark'
    document.documentElement.dataset.style = localStorage.getItem('style') ?? 'neon'
    document.title = `Szavazás – ${APP_NAME}`
    supabase.from('schools').select('id').eq('slug', SCHOOL_SLUG).single().then(({ data }) => { if (data) { setSid(data.id); setState('ok') } else setState('err') })
  }, [])
  const { poll, counts, refresh } = usePoll(sid)
  return <main className="install">
    {state === 'err' ? <section className="panel"><p>Az oldal most nem érhető el.</p></section>
      : poll ? <PollCard poll={poll} counts={counts} onVoted={refresh} />
      : <section className="panel"><h1>{APP_NAME}</h1><p>{state === 'load' ? 'Betöltés…' : 'Most nincs aktív szavazás.'}</p></section>}
    <a className="btn" href="/">Tovább az oldalra</a>
  </main>
}
