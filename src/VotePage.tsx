import { useEffect, useState } from 'react'
import { APP_NAME } from './lib/brand'
import { SCHOOL_SLUG, supabase } from './lib/supabase'
import { PollCard, usePoll } from './Poll'

/** /szavazas: a TV-n lévő QR-kód ide visz; egyetlen kérdés, nagy gombok. */
export default function VotePage() {
  const [sid, setSid] = useState<string>()
  const [state, setState] = useState<'load' | 'ok' | 'err'>('load')
  useEffect(() => {
    document.documentElement.dataset.theme = localStorage.getItem('theme') ?? 'dark'
    document.documentElement.dataset.style = localStorage.getItem('style') ?? 'neon'
    document.title = `Szavazás – ${APP_NAME}`
    supabase.from('schools').select('id').eq('slug', SCHOOL_SLUG).single().then(({ data }) => {
      if (data) {
        setSid(data.id)
        setState('ok')
      } else {
        setState('err')
      }
    })
  }, [])
  const { poll, counts, refresh } = usePoll(sid)
  return (
    <main className="install">
      {state === 'err' ? (
        <section className="panel"><p>Az oldal most nem érhető el.</p></section>
      ) : poll ? (
        <PollCard poll={poll} counts={counts} onVoted={refresh} />
      ) : (
        <section className="panel">
          <h1>{APP_NAME}</h1>
          <p>{state === 'load' ? 'Betöltés…' : 'Most nincs aktív szavazás.'}</p>
        </section>
      )}
      <a className="btn" href="/">Tovább az oldalra</a>
    </main>
  )
}
