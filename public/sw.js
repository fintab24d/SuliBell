// Egyszerű service worker: az oldal internet nélkül is elindul, online állapotban viszont mindig a legfrissebb verziót adja.
const CACHE = 'sulibell-v4'
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      fetch('/', { cache: 'no-store' })
        .then(res => (res.ok ? c.put('/', res) : undefined))
        .catch(() => c.addAll(['/']))
    )
  )
  self.skipWaiting()
})
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url)
  if (r.method !== 'GET' || u.origin !== location.origin) return
  if (r.mode === 'navigate') {   // oldal: mindig a hálózatról kérjük a friss HTML-t, csak offline használjuk a tároltat
    e.respondWith(
      fetch(r, { cache: 'no-store' })
        .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/', copy)) } return res })
        .catch(() => caches.match('/'))
    )
    return
  }
  // Hash-elt Vite bundle (/assets/*): biztonságosan cache-elhető
  if (/^\/assets\//.test(u.pathname)) {
    e.respondWith(caches.match(r).then(hit => {
      if (hit) return hit
      return fetch(r).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)) } return res })
    }))
    return
  }
  // Minden más saját fájl (ikonok, manifest): előbb hálózat, offline esetén cache
  e.respondWith(
    fetch(r, { cache: 'no-cache' })
      .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)) } return res })
      .catch(() => caches.match(r))
  )
})

// Push-értesítések (az admin küldi a Supabase Edge Function-ön át)
self.addEventListener('push', e => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(d.title || 'SuliBell', {
    body: d.body || '', icon: '/icon-192.png', badge: '/favicon.png', data: { url: d.url || '/' },
  }))
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/'
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) { if ('navigate' in c) c.navigate(url); return c.focus() }
    return clients.openWindow(url)
  }))
})
