/**
 * Közös, szerverhez szinkronizált pontos idő (PC, TV, telefon mindenhol ugyanazt mutatja).
 *
 * Működés:
 * - Az eszköz saját rendszerórájához (Date.now()) képesti eltolást (offsetMs) méri meg
 *   NTP-stílusú RTT/2 kompenzációval a Supabase Edge Function (`GET /functions/v1/discord-bridge`)
 *   pontos szerverideje alapján.
 * - Fallbackként a saját webes origin HTTP `Date` fejlécét is képes használni.
 * - Az offsetet 30 percig localStorage-ban is megőrzi az azonnali pontos első kirajzoláshoz,
 *   és induláskor, 5 percenként, valamint tab-visszatéréskor újraméri.
 */

const CACHE_KEY = 'sulibell_server_time_offset_v1'
const CACHE_MAX_AGE_MS = 30 * 60_000
const RESYNC_INTERVAL_MS = 5 * 60_000
const MIN_RESYNC_GAP_MS = 45_000

type Listener = (offsetMs: number) => void
const listeners = new Set<Listener>()

let serverOffsetMs = 0
let lastSyncSuccessAt = 0
let syncedInSession = false
let anchorServerMs = 0
let anchorPerfMs = 0
let inFlight: Promise<number> | null = null
let started = false

function loadCachedOffset(): number {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return 0
    const parsed = JSON.parse(raw)
    if (
      typeof parsed?.offset === 'number' &&
      Number.isFinite(parsed.offset) &&
      typeof parsed?.at === 'number' &&
      Math.abs(Date.now() - parsed.at) < CACHE_MAX_AGE_MS
    ) {
      return parsed.offset
    }
  } catch {
    // ignore storage errors
  }
  return 0
}

function saveCachedOffset(offset: number) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ offset, at: Date.now() }))
  } catch {
    // ignore storage errors
  }
}

serverOffsetMs = loadCachedOffset()

/** Az aktuális pontos (szerverhez igazított) idő ezredmásodpercben. */
export function serverNowMs(): number {
  if (syncedInSession && typeof performance !== 'undefined') {
    return Math.round(anchorServerMs + (performance.now() - anchorPerfMs))
  }
  return Date.now() + serverOffsetMs
}

/**
 * Hitelesített szerveridő (pl. Adventi Kalendáriumhoz):
 * ha a munkamenetben már történt élő szerverszinkron, a monoton performance.now()
 * horgony alapján számol, így az eszköz órájának átállításával nem csapható be.
 */
export function trustedServerNowMs(): number {
  return serverNowMs()
}

/** Igaz, ha a jelenlegi munkamenetben már kaptunk hiteles élő szerveridőt. */
export function isServerTimeSynced(): boolean {
  return syncedInSession
}

/** Biztosítja, hogy legyen hitelesített élő szerveridő (ha még nincs, azonnal szinkronizál). */
export async function ensureServerTimeSynced(): Promise<boolean> {
  if (syncedInSession) return true
  await syncServerTime(true)
  return syncedInSession
}

/** A jelenleg alkalmazott időeltolás ezredmásodpercben (szerver - kliens). */
export function getServerTimeOffsetMs(): number {
  return serverOffsetMs
}

export function subscribeServerTime(cb: Listener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function applyOffset(nextOffset: number, estimatedServerNowMs?: number, perfAt?: number) {
  const prev = serverOffsetMs
  const wasSynced = syncedInSession
  const nowPerf = typeof perfAt === 'number' && Number.isFinite(perfAt)
    ? perfAt
    : (typeof performance !== 'undefined' ? performance.now() : 0)
  const srvNow = typeof estimatedServerNowMs === 'number' && Number.isFinite(estimatedServerNowMs)
    ? estimatedServerNowMs
    : Date.now() + nextOffset

  syncedInSession = true
  anchorServerMs = srvNow
  anchorPerfMs = nowPerf

  // Kisebb mint 150 ms jitter esetén tartsuk stabilan a meglévő eltolást (ne ugráljon feleslegesen)
  if (lastSyncSuccessAt > 0 && Math.abs(nextOffset - prev) < 150) {
    lastSyncSuccessAt = Date.now()
    saveCachedOffset(prev)
    if (!wasSynced) {
      listeners.forEach(fn => {
        try { fn(prev) } catch { /* ignore */ }
      })
    }
    return
  }
  serverOffsetMs = Math.round(nextOffset)
  lastSyncSuccessAt = Date.now()
  saveCachedOffset(serverOffsetMs)
  if (!wasSynced || Math.abs(serverOffsetMs - prev) >= 150) {
    listeners.forEach(fn => {
      try { fn(serverOffsetMs) } catch { /* ignore */ }
    })
  }
}

async function probeSupabaseTime(): Promise<{ offset: number; rtt: number; serverNow: number; perfAt: number } | null> {
  const sbUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '')
  if (!sbUrl) return null
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 3500)
  try {
    const t0 = performance.now()
    const res = await fetch(`${sbUrl}/functions/v1/discord-bridge?action=time&t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      signal: ctrl.signal,
    })
    const t1 = performance.now()
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    const serverMs = typeof data?.now === 'number' && Number.isFinite(data.now) ? data.now : NaN
    if (!Number.isFinite(serverMs)) return null
    const rtt = Math.max(0, t1 - t0)
    const estimatedNow = serverMs + rtt / 2
    return { offset: estimatedNow - Date.now(), rtt, serverNow: estimatedNow, perfAt: t1 }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function probeOriginDateHeader(): Promise<{ offset: number; rtt: number; serverNow: number; perfAt: number } | null> {
  if (typeof window === 'undefined' || !window.location?.origin?.startsWith('http')) return null
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 3000)
  try {
    const t0 = performance.now()
    const res = await fetch(`${window.location.origin}/?ts=${Date.now()}`, {
      method: 'HEAD',
      cache: 'no-store',
      signal: ctrl.signal,
    })
    const t1 = performance.now()
    const hdr = res.headers.get('date')
    if (!hdr) return null
    const parsed = Date.parse(hdr)
    if (!Number.isFinite(parsed)) return null
    const rtt = Math.max(0, t1 - t0)
    // A HTTP Date egész másodperc pontosságú, ezért +500 ms átlagkorrekció + RTT/2
    const estimatedNow = parsed + 500 + rtt / 2
    return { offset: estimatedNow - Date.now(), rtt, serverNow: estimatedNow, perfAt: t1 }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Két gyors mérésből kiválasztja a legalacsonyabb késleltetésű (legpontosabb) szerveridő-eltolást.
 */
export async function syncServerTime(force = false): Promise<number> {
  if (!force && syncedInSession && lastSyncSuccessAt > 0 && Date.now() - lastSyncSuccessAt < MIN_RESYNC_GAP_MS) {
    return serverOffsetMs
  }
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const samples: Array<{ offset: number; rtt: number; serverNow: number; perfAt: number }> = []
      const first = await probeSupabaseTime()
      if (first) {
        samples.push(first)
        // Ha az első kérés TLS handshake miatt > 220 ms volt, vegyünk egy 2. tűpontos mintát
        if (first.rtt > 220) {
          const second = await probeSupabaseTime()
          if (second) samples.push(second)
        }
      } else {
        const fallback = await probeOriginDateHeader()
        if (fallback) samples.push(fallback)
      }

      if (samples.length > 0) {
        samples.sort((a, b) => a.rtt - b.rtt)
        applyOffset(samples[0].offset, samples[0].serverNow, samples[0].perfAt)
      }
    } finally {
      inFlight = null
    }
    return serverOffsetMs
  })()

  return inFlight
}

/** Elindítja az automatikus háttér-időszinkronizálást (egyszer fut le alkalmazás-szinten). */
export function startServerTimeSync() {
  if (started || typeof window === 'undefined') return
  started = true

  void syncServerTime(true)

  window.setInterval(() => {
    if (!document.hidden) void syncServerTime(true)
  }, RESYNC_INTERVAL_MS)

  const onResume = () => {
    if (!document.hidden) void syncServerTime(false)
  }
  document.addEventListener('visibilitychange', onResume)
  window.addEventListener('online', () => void syncServerTime(true))
  window.addEventListener('focus', onResume)
}
