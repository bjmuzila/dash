import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The dashboard talks to your Next backend over the SAME relative URLs the real
// app uses (/ws/gex, /proxy/*, /api/*). In dev we proxy those to your running
// server so there is no CORS and the WebSocket upgrades cleanly.
//
// VITE_BACKEND  — where the site is served.
//   local:  http://localhost:3001  (repo-root `npm run dev`)
//   prod:   https://cbedge.net     (recommended for live GEX — local /ws/gex
//                                    does not stream recurring gex frames)
// BACKEND_COOKIE / BACKEND_TOKEN — only needed for prod: prod is paywalled and
//   WS-auth-gated, so the proxy must present your session. As the owner, copy
//   `document.cookie` from an authenticated cbedge.net tab into BACKEND_COOKIE.
//   (Not VITE_-prefixed → stays server-side in this config, never shipped to the
//   browser bundle.)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const BACKEND = env.VITE_BACKEND || 'http://localhost:3001'
  const WS_BACKEND = BACKEND.replace(/^http/, 'ws')
  const COOKIE = env.BACKEND_COOKIE || ''
  const TOKEN = env.BACKEND_TOKEN || ''

  // Attach owner auth to every proxied request (http + ws upgrade) so prod's
  // paywall/WS gate lets it through. No-op when the vars are unset (local dev).
  const auth = (proxy) => {
    const setHeaders = (proxyReq) => {
      if (COOKIE) proxyReq.setHeader('cookie', COOKIE)
      if (TOKEN) proxyReq.setHeader('authorization', `Bearer ${TOKEN}`)
    }
    proxy.on('proxyReq', setHeaders)
    // On the WS upgrade, also present the backend's own origin so the /ws/gex
    // server's same-origin check doesn't close the socket before it opens
    // (the browser's Origin is the Vite port, which the backend rejects).
    proxy.on('proxyReqWs', (proxyReq) => {
      setHeaders(proxyReq)
      try { proxyReq.setHeader('origin', BACKEND) } catch { /* ignore */ }
    })
  }

  const httpTarget = { target: BACKEND, changeOrigin: true, secure: false, configure: auth }
  return {
    plugins: [react()],
    // Served under cbedge.net/home3/ in prod → asset URLs must be prefixed so
    // /home3/assets/*.js resolve. Relative API paths (/ws/gex, /proxy, /api)
    // stay root-absolute and hit the same-origin backend directly.
    base: '/home3/',
    // Inline an empty PostCSS config so Vite does NOT walk up into the parent
    // Next repo's postcss.config.js (Tailwind with no content) — that leak is
    // what produced the "content option is missing or empty" warning.
    css: { postcss: { plugins: [] } },
    server: {
      port: 5173,
      open: true,
      proxy: {
        '/ws': { target: WS_BACKEND, ws: true, changeOrigin: true, secure: false, configure: auth },
        '/proxy': httpTarget,
        '/api': httpTarget,
        '/signals.txt': httpTarget,
        '/landing-bg.png': httpTarget,
        '/cb-edge-logo.png': httpTarget,
      },
    },
  }
})
