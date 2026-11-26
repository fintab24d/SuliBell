import { memo, useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { voterId, setVoterId, resetVoterId } from './lib/voter'

export { voterId, setVoterId, resetVoterId }

export type PollT = { id: string; question: string; options: string[] }
const COL = ['var(--n-pink)', 'var(--n-cyan)', 'var(--n-amber)', 'var(--n-green)', 'var(--n-pink)', 'var(--n-cyan)']

/** Az aktív szavazás és az állása (valós időben + 30 mp-enként + fókuszváltáskor frissül). */
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
    if (!schoolId) return
    let lastWakeAt = 0
    void refresh()
    const onWake = () => {
      if (document.hidden) return
      const now = Date.now()
      if (now - lastWakeAt < 2500) return
      lastWakeAt = now
      void refresh()
    }
    const onRefresh = () => { void refresh() }
    const t = setInterval(() => { if (!document.hidden) void refresh() }, 30_000)
    const ch = supabase
      .channel(`sulibell-polls-pg-${schoolId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'polls', filter: `school_id=eq.${schoolId}` }, () => { void refresh() })
      .subscribe()
    window.addEventListener('sulibell:refresh', onRefresh)
    document.addEventListener('visibilitychange', onWake)
    document.addEventListener('resume', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('pageshow', onWake)
    return () => {
      clearInterval(t)
      supabase.removeChannel(ch)
      window.removeEventListener('sulibell:refresh', onRefresh)
      document.removeEventListener('visibilitychange', onWake)
      document.removeEventListener('resume', onWake)
      window.removeEventListener('focus', onWake)
      document.removeEventListener('pageshow', onWake)
    }
  }, [refresh, schoolId])
  return { poll, counts, refresh }
}

export const myVote = (id: string) => { try { const v = localStorage.getItem('vote-' + id); return v == null ? null : +v } catch { return null } }

/** Szavazó kártya: gombok, ha még nem szavaztál; eredménysávok, ha igen (vagy a TV-n mindig). */
export const PollCard = memo(function PollCard({ poll, counts, tv, qr, onVoted }: { poll: PollT; counts: number[]; tv?: boolean; qr?: string; onVoted?: () => void }) {
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
    {qr && <div className="pollqr"><img src={qr} alt="QR-kód a szavazáshoz" loading="lazy" decoding="async" /><span>Szavazz telefonon</span></div>}
  </section>
})
