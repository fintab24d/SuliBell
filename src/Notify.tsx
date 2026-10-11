import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

const KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''
/** A VAPID nyilvános kulcs (base64url) átalakítása a böngésző által várt bájtokká. */
const keyBytes = (s: string) => {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
const supported = () => !!KEY && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** Feliratkozás/leiratkozás az értesítésekre. iPhone-on csak a főképernyőre telepített alkalmazásban jelenik meg (az Apple így engedi). */
export default function NotifyButton({ schoolId }: { schoolId?: string }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  useEffect(() => {
    if (!supported()) return
    navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription())
      .then(s => setOn(!!s && Notification.permission === 'granted')).catch(() => {})
  }, [])
  if (!supported() || !schoolId) return null

  const toggle = async () => {
    setBusy(true); setNote('')
    try {
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      if (on && existing) { await existing.unsubscribe(); setOn(false); return }   // a szerveren a lejárt sor a következő küldéskor törlődik
      if ((await Notification.requestPermission()) !== 'granted') { setNote('Az értesítések le vannak tiltva a böngészőben.'); return }
      const sub = existing ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) })
      const j = sub.toJSON()
      const { error } = await supabase.from('push_subscriptions').insert({ school_id: schoolId, endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth })
      if (error && error.code !== '23505') throw error      // 23505: ez az eszköz már fel van iratkozva
      setOn(true)
    } catch { setNote('Nem sikerült bekapcsolni az értesítést.') } finally { setBusy(false) }
  }
  return <>
    <button aria-pressed={on} className={on ? 'on' : ''} disabled={busy} onClick={toggle}>{on ? '🔔 Értesítések: be' : '🔔 Értesítések'}</button>
    {note && <span className="pill">{note}</span>}
  </>
}
