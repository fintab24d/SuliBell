import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { pickVideos, type Vid } from './lib/video'

/** Az iskola szünet-videói (offline is megmaradnak); 5 percenként frissül. Ha az update12.sql még nem futott le, üres. */
export function useVideos(schoolId?: string) {
  const [v, setV] = useState<Vid[]>(() => { try { return JSON.parse(localStorage.getItem('csengeto-videos') ?? '[]') } catch { return [] } })
  useEffect(() => {
    if (!schoolId) return
    let alive = true
    const load = async () => {
      const { data, error } = await supabase.from('break_videos').select('id, url, title').eq('school_id', schoolId).order('created_at')
      if (error || !alive) return
      setV(data as Vid[]); try { localStorage.setItem('csengeto-videos', JSON.stringify(data)) } catch { /* nem baj */ }
    }
    load(); const t = setInterval(load, 300_000)
    return () => { alive = false; clearInterval(t) }
  }, [schoolId])
  return v
}

/** Szünetben lejátszott (néma, automatikusan induló) videó; egy szünet alatt ugyanaz marad. */
export default function BreakVideo({ list, breakKey }: { list: Vid[]; breakKey: string }) {
  const p = pickVideos(list, breakKey)
  if (!p) return null
  return <section className="panel full vid">
    <div className="tag">Szünet{p.title ? `: ${p.title}` : ''}</div>
    <div className="vframe">
      {p.yt
        ? <iframe key={p.yt} src={p.yt} title={p.title || 'Szünet-videó'} allow="autoplay; encrypted-media; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-presentation" referrerPolicy="strict-origin-when-cross-origin" loading="lazy" />
        : <video key={p.src} src={p.src} autoPlay muted loop playsInline />}
    </div>
  </section>
}
