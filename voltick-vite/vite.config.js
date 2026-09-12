import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname_ = path.dirname(fileURLToPath(import.meta.url))

// voltick-vite — the voltick.cbedge.net sandbox SPA. Same shape as owner-vite:
// the app talks to the CB Edge backend over the SAME relative URLs the real app
// uses (/api/*, /proxy/*, /ws/*). In prod those are reverse-proxied to the
// dashboard container by this app's own nginx (see nginx.conf). In dev they are
// proxied to a running backend so there is no CORS and WebSockets upgrade
// cleanly.
//
// VITE_BACKEND  — where the CB Edge backend is served.
//   local:  http://localhost:3001  (repo-root `npm run dev`)
//   prod:   https://cbedge.net     (gated routes need a session cookie)
// BACKEND_COOKIE / BACKEND_TOKEN — for pointing dev at prod: copy
//   `document.cookie` from an authenticated cbedge.net tab into BACKEND_COOKIE.
//   Not VITE_-prefixed, so it stays server-side in this config and never ships
//   to the browser bundle.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const BACKEND = env.VITE_BACKEND || 'http://localhost:3001'
  const WS_BACKEND = BACKEND.replace(/^http/, 'ws')
  const COOKIE = env.BACKEND_COOKIE || ''
  const TOKEN = env.BACKEND_TOKEN || ''

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
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname_, 'src') } },
    // Served at the ROOT of its own subdomain (voltick.cbedge.net) → assets live
    // at /assets/*. Relative API paths stay root-absolute.
    base: '/',
    server: {
      // 5174 is owner-vite, 5175 is free.
      port: 5175,
      open: true,
      proxy: {
        '/ws': { target: WS_BACKEND, ws: true, changeOrigin: true, secure: false, configure: auth },
        '/proxy': httpTarget,
        '/api': httpTarget,
      },
    },
  }
})
