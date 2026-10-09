// FIRST, before anything else evaluates: this account's settings into
// localStorage (Vela's layout, charts, indicators, drawings, watchlists,
// scripts), and changes back to the account. Same as src/main.tsx; see
// data/prefsSync.ts.
import '@/data/prefsSync'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/design/tokens.css'
import { startSocket } from '@/data/socket'
import { bootUiTheme } from '@/design/uiTheme'
import VelaApp from '@/vela/VelaApp'

// ─────────────────────────────────────────────────────────────────────────────
// Entry for vela.cbedge.net — the standalone Vela build (`npm run build:vela`,
// vela.html). The twin of src/main.tsx minus the board: same tokens, same
// socket, same theme boot, then VelaApp instead of App.
//
// The socket opens at module scope for the same reason main.tsx does it there:
// Vela's ES / NQ tail reads the futures frames through watchFrame, and the
// sooner the connection is up the sooner the last bar fills. vela.html carries
// an EMPTY boot record, so this is a plain connect, not a hand-off.
// ─────────────────────────────────────────────────────────────────────────────

startSocket()

// Applies the stored palette before the first paint. Vela then pins Voltick on
// mount (pinUiTheme in pages/Vela.tsx), so this only covers the first frames.
bootUiTheme()

// A deploy replaces the hashed chunks; a tab opened before it asks for a chunk
// that no longer exists. Reload to pick up the new build — the same handler
// src/main.tsx installs, under its own key so a reload spent on one host is not
// mistaken for one spent on the other.
//
// At most once per RELOAD_GAP_MS, not once per session (2026-10-09). Vela stays
// open all day and some days carry several deploys; with a once-per-session
// guard, the second deploy left lazy chunks (studies, legend, picker) failing
// until a manual reload. The gap still stops a reload loop if a chunk is
// genuinely missing from the new build too.
const RELOADED_KEY = 'cb-vela-stale-chunk-reloaded'
const RELOAD_GAP_MS = 10 * 60_000
window.addEventListener('vite:preloadError', (e) => {
  let recent = true
  try {
    const last = Number(sessionStorage.getItem(RELOADED_KEY) || 0)
    recent = Number.isFinite(last) && last > 0 && Date.now() - last < RELOAD_GAP_MS
    if (!recent) sessionStorage.setItem(RELOADED_KEY, String(Date.now()))
  } catch {
    /* private mode: treat as already tried rather than looping */
  }
  if (recent) return
  e.preventDefault()
  window.location.reload()
})

// The entry is appended by the loader once the settings answer (vite.config.ts,
// holdEntryForPrefs), so in principle it can run before the parser reaches #root.
function mount(): void {
  const root = document.getElementById('root')
  if (!root) throw new Error('#root missing from vela.html')
  createRoot(root).render(
    <StrictMode>
      <VelaApp />
    </StrictMode>,
  )
}
if (document.getElementById('root') || document.readyState !== 'loading') mount()
else document.addEventListener('DOMContentLoaded', mount, { once: true })
