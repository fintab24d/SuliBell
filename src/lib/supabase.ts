import { createClient, type RealtimeChannel } from '@supabase/supabase-js'

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
export const SCHOOL_SLUG: string = import.meta.env.VITE_SCHOOL_SLUG ?? 'demo'

/** Szinkron eltávolítja a csatornát a RealtimeClient belső listájából, hogy azonnali újranyitáskor ne dobjon hibát. */
function detachChannelSync(ch: RealtimeChannel | null | undefined) {
  if (!ch) return
  try {
    const rt = (supabase as any).realtime
    if (rt && typeof rt._remove === 'function') {
      rt._remove(ch)
    }
    const list = typeof supabase.getChannels === 'function' ? supabase.getChannels() : []
    const idx = list.indexOf(ch)
    if (idx >= 0) list.splice(idx, 1)
  } catch { /* ignore */ }
}

const origRemoveChannel = supabase.removeChannel.bind(supabase)
supabase.removeChannel = ((ch: RealtimeChannel) => {
  detachChannelSync(ch)
  try {
    return origRemoveChannel(ch).catch(() => 'error' as any)
  } catch {
    return Promise.resolve('ok' as any)
  }
}) as typeof supabase.removeChannel

const origChannel = supabase.channel.bind(supabase)
supabase.channel = ((topic: string, opts?: any) => {
  try {
    const realtimeTopic = `realtime:${topic}`
    const existing = supabase.getChannels().find(c => c.topic === realtimeTopic)
    if (existing) {
      const adapter = (existing as any).channelAdapter
      const st = (existing as any).state ?? adapter?.state
      const active =
        adapter?.isJoined?.() ||
        adapter?.isJoining?.() ||
        adapter?.isLeaving?.() ||
        st === 'joining' ||
        st === 'joined' ||
        st === 'leaving'
      if (active) {
        detachChannelSync(existing)
        try { Promise.resolve(existing.unsubscribe()).catch(() => {}) } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  const ch = origChannel(topic, opts)
  if (ch && !(ch as any).__sulibellSafe) {
    ;(ch as any).__sulibellSafe = true
    const origOn = ch.on.bind(ch)
    ch.on = ((type: any, filter: any, cb: any) => {
      try {
        return origOn(type, filter, cb)
      } catch {
        try {
          if (typeof (ch as any)._on === 'function') {
            return (ch as any)._on(type, filter, cb)
          }
        } catch { /* ignore */ }
        return ch
      }
    }) as typeof ch.on

    const origSubscribe = ch.subscribe.bind(ch)
    ch.subscribe = ((cb?: any, timeout?: number) => {
      try {
        return origSubscribe(cb, timeout)
      } catch {
        return ch
      }
    }) as typeof ch.subscribe
  }
  return ch
}) as typeof supabase.channel
