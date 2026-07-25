import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname_ = path.dirname(fileURLToPath(import.meta.url))

// owner-vite — standalone Vite recreation of the /owner backend section.
// Mirrors home3-vite: the app talks to the Next backend over the SAME relative
// URLs the real app uses (/ws/*, /proxy/*, /api/*). In dev we proxy those to a
// running Next server so there is no CORS and WebSockets upgrade cleanly.
//
// VITE_BACKEND  — where the Next backend is served.
//   local:  http://localhost:3001  (repo-root `npm run dev`)
//   prod:   https://cbedge.net     (owner routes are auth-gated → set cookie)
// BACKEND_COOKIE / BACKEND_TOKEN — for prod: owner routes are paywalled and
//   auth-gated, so the proxy must present your session. Copy `document.cookie`
//   from an authenticated cbedge.net tab into BACKEND_COOKIE. (Not VITE_-prefixed
//   → stays server-side in this config, never shipped to the browser bundle.)
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
    proxy.on('proxyReqWs', (proxyReq) => {
      setHeaders(proxyReq)
      try { proxyReq.setHeader('origin', BACKEND) } catch { /* ignore */ }
    })
  }

  const httpTarget = { target: BACKEND, changeOrigin: true, secure: false, configure: auth }
  return {
    // tailwindcss(): utilities ONLY — src/pages/charts-ui/charts-ui.css imports
    // tailwindcss/theme.css + tailwindcss/utilities.css and deliberately skips
    // preflight, so no global reset lands on the existing inline-styled pages.
    // That stylesheet is imported from the lazy ChartsUI chunk, so it is not in
    // the initial payload either.
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(__dirname_, 'src') } },
    // Served at the ROOT of its own subdomain (owner.cbedge.net) → assets live at
    // /assets/*. Relative API paths (/api, /ws, /proxy) stay root-absolute and are
    // reverse-proxied to the dashboard backend by the owner.cbedge.net nginx.
    base: '/',
    css: { postcss: { plugins: [] } },
    server: {
      port: 5174,
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
