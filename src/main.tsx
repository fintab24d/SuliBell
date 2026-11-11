import { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Cursor from './Cursor'
import './index.css'

const Admin = lazy(() => import('./Admin'))
const TestLab = lazy(() => import('./TestLab'))
const Install = lazy(() => import('./Install'))
const Vote = lazy(() => import('./Poll'))

const page = location.pathname.startsWith('/admin')
  ? <Admin />
  : location.pathname.startsWith('/teszt')
    ? <TestLab />
    : location.pathname.startsWith('/telepites')
      ? <Install />
      : location.pathname.startsWith('/szavazas')
        ? <Vote />
        : <App />

createRoot(document.getElementById('root')!).render(
  <>
    <Cursor />
    <Suspense fallback={<main><div className="panel"><div className="title">Betöltés…</div></div></main>}>
      {page}
    </Suspense>
  </>
)

// Alkalmazásként telepíthető + offline indulás (csak az élesített oldalon, HTTPS-en)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    let hadController = !!navigator.serviceWorker.controller
    let refreshing = false
    const onControllerChange = () => {
      if (!hadController) {
        hadController = true
        return
      }
      if (refreshing) return
      if (location.pathname.startsWith('/admin') || location.pathname.startsWith('/teszt')) return
      refreshing = true
      location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(reg => {
      const checkUpdate = () => {
        if (!document.hidden) reg.update().catch(() => {})
      }
      reg.update().catch(() => {})
      setInterval(checkUpdate, 5 * 60_000)
      document.addEventListener('visibilitychange', checkUpdate)
      window.addEventListener('focus', checkUpdate)
      window.addEventListener('pageshow', checkUpdate)
      window.addEventListener('online', checkUpdate)
    }).catch(() => {})
  })
}
