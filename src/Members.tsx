import { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

const AREAS: [string, string][] = [['ai', '✨ AI Asszisztens használata'], ['menu', 'Étlap'], ['changes', 'Mai változások'], ['announcements', 'Közlemények'], ['calendar', 'Naptár (ünnepnapok, visszaszámlálók, különleges napok)'],
  ['schedules', 'Csengetési rendek'], ['polls', 'Szavazás'], ['videos', 'Szünet-videók'], ['push', 'Értesítések küldése'], ['settings', 'Beállítások (logó, hang, időjárás, kiemelt közlemény, verzió)']]
type M = { user_id: string; email: string; perms: string[] | null }

/** Adminok és jogosultságaik (csak teljes jogú admin látja). Egy admin csak a megadott területeket szerkesztheti. */
export default function Members({ sid }: { sid: string }) {
  const [list, setList] = useState<M[] | null>(null)
  const [msg, setMsg] = useState('')
  const [nu, setNu] = useState<{ email: string; full: boolean; perms: string[] }>({ email: '', full: false, perms: ['menu'] })

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_members', { sid })
    if (error) { setList(null); setMsg('A jogosultságok még nincsenek bekapcsolva: futtasd le a supabase/update15.sql fájlt.'); return }
    setList(data as M[]); setMsg('')
  }, [sid])
  useEffect(() => { load() }, [load])

  const save = async (email: string, perms: string[] | null) => {
    const { error } = await supabase.rpc('set_member', { sid, p_email: email, p_perms: perms })
    setMsg(error ? 'Hiba: ' + error.message : 'Mentve'); await load()
  }
  const toggle = (arr: string[], k: string) => arr.includes(k) ? arr.filter(x => x !== k) : [...arr, k]

  const picker = (full: boolean, perms: string[], onFull: (v: boolean) => void, onPerms: (p: string[]) => void) => <div className="permbox">
    <label><input type="checkbox" checked={full} onChange={e => onFull(e.target.checked)} /> <b>Teljes jogú</b> (mindent szerkeszthet, adminokat kezelhet)</label>
    {!full && <div className="permgrid">{AREAS.map(([k, n]) => <label key={k}><input type="checkbox" checked={perms.includes(k)} onChange={() => onPerms(toggle(perms, k))} /> {n}</label>)}
      <button type="button" onClick={() => onPerms(['menu'])}>Csak étlap</button></div>}
  </div>

  return <section><h2>Adminok és jogosultságok</h2>
    {msg && <p role="status">{msg}</p>}
    {list && <>
      <p>Itt adhatod meg, hogy ki mit szerkeszthet. Új admin fiókját előbb a Supabase <b>Authentication → Users</b> részén kell létrehozni, utána az e-mail-címével itt hozzáadhatod.</p>
      {list.map(m => <Row key={m.user_id} m={m} picker={picker} onSave={save} onDel={async () => {
        const { error } = await supabase.rpc('remove_member', { sid, p_user: m.user_id }); setMsg(error ? 'Hiba: ' + error.message : 'Törölve'); await load()
      }} />)}
      <div className="polladm"><b>Új admin hozzáadása</b>
        <div className="row"><input type="email" placeholder="E-mail-cím" value={nu.email} onChange={e => setNu({ ...nu, email: e.target.value })} /></div>
        {picker(nu.full, nu.perms, full => setNu({ ...nu, full }), perms => setNu({ ...nu, perms }))}
        <button disabled={!nu.email.trim() || (!nu.full && !nu.perms.length)} onClick={async () => { await save(nu.email, nu.full ? null : nu.perms); setNu({ email: '', full: false, perms: ['menu'] }) }}>Hozzáadás</button></div>
    </>}
  </section>
}

function Row({ m, picker, onSave, onDel }: { m: M; picker: (f: boolean, p: string[], of: (v: boolean) => void, op: (p: string[]) => void) => unknown; onSave: (e: string, p: string[] | null) => void; onDel: () => void }) {
  const [full, setFull] = useState(m.perms === null)
  const [perms, setPerms] = useState<string[]>(m.perms ?? ['menu'])
  return <div className="polladm"><b>{m.email}</b> {m.perms === null ? '(teljes jogú)' : `(${m.perms.length} terület)`}
    {picker(full, perms, setFull, setPerms) as never}
    <div className="row"><button onClick={() => onSave(m.email, full ? null : perms)}>Mentés</button><button onClick={onDel}>Eltávolítás</button></div></div>
}
