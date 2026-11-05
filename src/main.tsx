import { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Cursor from './Cursor'
import './index.css'

const Admin = lazy(() => import('./Admin'))
const Install = lazy(() => import('./Install'))
const Vote = lazy(() => import('./Poll'))

const page = location.pathname.startsWith('/admin')
  ? <Admin />
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
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}
