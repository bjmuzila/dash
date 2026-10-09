import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// A TAB THAT WAS OPEN ACROSS A DEPLOY. Same fix as cbedge-v3/src/main.tsx.
//
// Every page in App.tsx (and every next/dynamic card, via shims/next-dynamic) is
// lazy(), and Vite names those chunks by content hash. A deploy writes new
// hashes and deletes the old files, so a tab still running the previous bundle
// gets a 404 the next time it lazy-loads something - the import rejects, React
// has nothing to render, and the whole app goes white.
//
// The edge container (deploy/edge) now keeps old chunks cached, so this should
// be rare; this is the backstop for a chunk the edge never saw. Vite fires
// `vite:preloadError` for exactly this case, and the right recovery is one
// reload onto the new build. A timestamp stops a genuinely missing asset (a
// broken build) from turning into a reload loop: a second failure within a
// minute of the last auto-reload is left to throw so it shows up in the
// console. (Unlike a plain once-per-session flag, a tab that stays open all day
// still recovers from the NEXT deploy too.)
const RELOADED_KEY = 'cb-app-stale-chunk-reloaded-at'
window.addEventListener('vite:preloadError', (e) => {
  let recent = true
  try {
    const last = Number(sessionStorage.getItem(RELOADED_KEY) || 0)
    recent = Date.now() - last < 60_000
    if (!recent) sessionStorage.setItem(RELOADED_KEY, String(Date.now()))
  } catch {
    /* private mode: treat as already tried rather than looping */
  }
  if (recent) return
  e.preventDefault()
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
