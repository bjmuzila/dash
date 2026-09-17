import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/design/tokens.css'
import { startSocket } from '@/data/socket'
import App from '@/App'

// Order matters. startSocket() adopts the connection the inline script in
// index.html already opened and drains anything that buffered during bundle
// download — so it must run BEFORE the first render, not inside an effect.
// A useEffect here would give back most of the head start the early boot buys.
startSocket()

// ─────────────────────────────────────────────────────────────────────────────
// A TAB THAT WAS OPEN ACROSS A DEPLOY.
//
// Every route and most cards in v3 are `lazy()`, and Vite names those chunks by
// content hash — `snapshot-BfbFVooa.js`. A deploy writes new hashes and DELETES
// the old files, so a tab still running the previous `index-*.js` asks for
// chunks that are no longer on the VPS. It gets a 404 and a
// `TypeError: Failed to fetch dynamically imported module`, and whatever the
// user just clicked silently does nothing — the first time anyone noticed was
// the CopyShot camera, but it is every lazy thing in the app, and it has been
// true since the first lazy route landed.
//
// Vite fires `vite:preloadError` for exactly this. The page IS stale, so the
// only correct recovery is to reload it. Guarded by a session flag so a genuine
// missing asset (a broken build) cannot become a reload loop — the second
// failure in a session is left to throw, which is what puts it in the console
// where it belongs.
// ─────────────────────────────────────────────────────────────────────────────
const RELOADED_KEY = 'cb-v3-stale-chunk-reloaded'
window.addEventListener('vite:preloadError', (e) => {
  let already = true
  try {
    already = sessionStorage.getItem(RELOADED_KEY) === '1'
    if (!already) sessionStorage.setItem(RELOADED_KEY, '1')
  } catch {
    /* private mode: treat as already tried rather than looping */
  }
  if (already) return
  e.preventDefault()
  window.location.reload()
})

// Dev-only handle for the console and for scripts/ws-scope-check.mjs.
// Tree-shaken out of the production bundle.
if (import.meta.env.DEV) {
  void Promise.all([import('@/data/store'), import('@/data/socket')]).then(([store, socket]) => {
    ;(window as unknown as { __CB_DEV__: unknown }).__CB_DEV__ = {
      subscribe: store.subscribe,
      read: store.read,
      stats: store.stats,
      socketState: socket.socketState,
    }
  })
}

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
