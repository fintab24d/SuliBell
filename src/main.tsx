import { Component, Suspense, lazy, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Cursor from './Cursor'
import './index.css'

const Admin = lazy(() => import('./Admin'))
const TestLab = lazy(() => import('./TestLab'))
const Install = lazy(() => import('./Install'))
const Vote = lazy(() => import('./VotePage'))

const page = location.pathname.startsWith('/admin')
  ? <Admin />
  : location.pathname.startsWith('/teszt')
    ? <TestLab />
    : location.pathname.startsWith('/telepites')
      ? <Install />
      : location.pathname.startsWith('/szavazas')
        ? <Vote />
        : <App />

class ErrorBoundary extends Component<{ children: ReactNode; fallbackNull?: boolean }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('SuliBell render hiba:', error)
    if (!this.props.fallbackNull && /dynamically imported module|Loading chunk|module script/i.test(error?.message ?? '')) {
      ;(window as any).__sbRecover?.()
    }
  }

  render() {
    if (this.state.error) {
      if (this.props.fallbackNull) return null
      return (
        <main style={{ padding: 24, display: 'grid', placeItems: 'center', minHeight: '100svh' }}>
          <div className="panel" style={{ maxWidth: 480, textAlign: 'center', padding: 24 }}>
            <div className="tag" style={{ marginBottom: 10 }}>⚠️ Váratlan hiba</div>
            <h2 style={{ marginTop: 0 }}>Az oldal megjelenítése megszakadt</h2>
            <p className="meta" style={{ wordBreak: 'break-word' }}>
              {this.state.error.message || 'Ismeretlen megjelenítési hiba.'}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
              <button
                type="button"
                className="cta"
                onClick={() => {
                  if (typeof (window as any).__sbHardReload === 'function') {
                    ;(window as any).__sbHardReload()
                  } else {
                    location.reload()
                  }
                }}
              >
                🔄 Oldal újratöltése
              </button>
              {location.pathname !== '/' && (
                <a className="btn" href="/" style={{ textDecoration: 'none' }}>
                  ← Főoldal
                </a>
              )}
            </div>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}

window.addEventListener('vite:preloadError', ev => {
  ev.preventDefault()
  if (typeof (window as any).__sbRecover === 'function') {
    ;(window as any).__sbRecover()
  } else {
    location.reload()
  }
})

;(window as any).__sbMounted = true

createRoot(document.getElementById('root')!).render(
  <>
    <ErrorBoundary fallbackNull>
      <Cursor />
    </ErrorBoundary>
    <ErrorBoundary>
      <Suspense fallback={<main><div className="panel"><div className="title">Betöltés…</div></div></main>}>
        {page}
      </Suspense>
    </ErrorBoundary>
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
