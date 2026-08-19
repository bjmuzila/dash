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
