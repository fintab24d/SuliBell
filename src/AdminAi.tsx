import { useState, type FormEvent } from 'react'
import { supabase } from './lib/supabase'

/** Kép átméretezése és tömörítése base64 formátumba, hogy gyorsan átmenjen az Edge Functionnek. */
function compressImage(file: File): Promise<{ mime: string; data: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const max = 1400
      let w = img.width, h = img.height
      if (w > max || h > max) {
        if (w > h) { h = Math.round(h * max / w); w = max }
        else { w = Math.round(w * max / h); h = max }
      }
      const cv = document.createElement('canvas')
      cv.width = w; cv.height = h
      cv.getContext('2d')!.drawImage(img, 0, 0, w, h)
      const dataUrl = cv.toDataURL('image/jpeg', 0.82)
      resolve({ mime: 'image/jpeg', data: dataUrl.split(',')[1] })
      URL.revokeObjectURL(img.src)
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

export default function AdminAi({ schoolId, onDone }: { schoolId: string; onDone: () => void }) {
  const [prompt, setPrompt] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState('')

  const run = async (e: FormEvent) => {
    e.preventDefault()
    if ((!prompt.trim() && !file) || busy) return
    setBusy(true); setRes('Feldolgozás és mentés folyamatban...')
    try {
      const image = file ? await compressImage(file) : undefined
      const { data, error } = await supabase.functions.invoke('ask', {
        body: { mode: 'admin', school_id: schoolId, prompt: prompt.trim(), image },
      })
      if (data?.summary) {
        setRes('✅ ' + data.summary)
        setPrompt(''); setFile(null)
        onDone()
      } else if (data?.error) {
        setRes('❌ ' + data.error)
      } else if (error) {
        let msg = error.message
        try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error } catch {}
        setRes('❌ Hiba: ' + msg)
      }
    } catch (err) {
      setRes('❌ Hiba történt: ' + String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="polladm" style={{ borderColor: 'var(--brand)', boxShadow: '0 0 24px -8px var(--brand)' }}>
      <h2>✨ AI Asszisztens (Gyors kitöltés szövegből vagy képből)</h2>
      <p style={{ color: 'var(--mut)', margin: '0 0 10px' }}>
        Tölts fel egy fotót az étlapról vagy a tanév rendjéről, vagy írd le simán, mit állítsak be (pl. <i>„Jövő héten hétfőn gulyásleves és palacsinta, kedden bolognai”</i> vagy <i>„Téli szünet 2026. dec. 21-től 2027. jan. 3-ig”</i>).
      </p>
      <form onSubmit={run} className="row">
        <input
          style={{ flex: 1, minWidth: '18rem' }}
          placeholder="Írd le, mit szeretnél beállítani (kép mellé üresen is hagyhatod)..."
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
        />
        <label className="btn">
          📷 {file ? file.name.slice(0, 18) : 'Kép csatolása'}
          <input type="file" accept="image/*" hidden onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {file && <button type="button" onClick={() => setFile(null)}>✕</button>}
        <button className="cta" disabled={busy || (!prompt.trim() && !file)}>
          {busy ? 'Dolgozom...' : 'Végrehajtás'}
        </button>
      </form>
      {res && <p role="status" style={{ margin: '8px 0 0', fontWeight: 600 }}>{res}</p>}
    </section>
  )
}
