import { memo, useEffect, useState } from 'react'
import type { Supporter } from './lib/vip'

export type VipModalTab = 'vip' | 'supporters'

export interface SupporterTickerProps {
  supporters: Supporter[]
  onOpenWall?: () => void
  tv?: boolean
}

/** A fő visszaszámláló alatti diszkrét, 8 másodpercenként finom áttűnéssel rotálódó támogatói üzenetsáv. */
export const SupporterTicker = memo(function SupporterTicker({ supporters, onOpenWall, tv }: SupporterTickerProps) {
  const [idx, setIdx] = useState(0)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    setIdx(0)
    setFading(false)
  }, [supporters.length])

  useEffect(() => {
    if (supporters.length <= 1) return
    let swapTimer: number | undefined
    const interval = window.setInterval(() => {
      setFading(true)
      swapTimer = window.setTimeout(() => {
        setIdx(prev => (prev + 1) % supporters.length)
        setFading(false)
      }, 320)
    }, 8000)
    return () => {
      window.clearInterval(interval)
      if (swapTimer !== undefined) window.clearTimeout(swapTimer)
    }
  }, [supporters.length])

  if (supporters.length === 0) return null

  const cur = supporters[idx % supporters.length]
  if (!cur || !cur.message) return null

  const inner = (
    <div className={`sup-ticker-inner${fading ? ' is-fading' : ''}`}>
      <span className="sup-ticker-badge" aria-hidden="true">
        {cur.is_top_tier ? '👑' : '💚'}
      </span>
      <span className="sup-ticker-who">
        <b>{cur.name}</b>
        {cur.class_name && <small className="sup-ticker-cls">{cur.class_name}</small>}
      </span>
      <span className="sup-ticker-sep" aria-hidden="true">•</span>
      <span className="sup-ticker-msg">„{cur.message.trim()}”</span>
    </div>
  )

  if (onOpenWall && !tv) {
    return (
      <button
        type="button"
        className="sup-ticker clickable"
        onClick={onOpenWall}
        title="Támogatók falának megnyitása"
      >
        {inner}
      </button>
    )
  }

  return (
    <div className={`sup-ticker${tv ? ' tv-mode' : ''}`} aria-live="polite">
      {inner}
    </div>
  )
})
