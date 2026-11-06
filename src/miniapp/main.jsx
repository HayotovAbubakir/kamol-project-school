import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import MainApp from './MainApp.jsx'
import './miniapp.css'

class MiniAppErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="miniapp min-h-[100svh] px-4 py-10 text-[var(--mini-text)]">
          <section className="mini-panel mx-auto max-w-sm rounded-3xl border p-5">
            <h1 className="text-lg font-bold">Sahifani ochib bo‘lmadi</h1>
            <p className="mt-2 text-sm text-[var(--mini-muted)]">Internetni tekshirib, ilovani qayta yuklang.</p>
            <button className="mini-action mt-4 min-h-11 w-full rounded-2xl px-4 font-bold" onClick={() => window.location.reload()}>
              Qayta yuklash
            </button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('miniapp-root')).render(
  <StrictMode>
    <MiniAppErrorBoundary>
      <MainApp />
    </MiniAppErrorBoundary>
  </StrictMode>,
)
