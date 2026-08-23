import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname_ = path.dirname(fileURLToPath(import.meta.url))

// daily-vite — the PUBLIC, paid life-OS served at daily.cbedge.net.
//
// A sibling of budget-vite, not a fork of it in the git sense: it was copied
// once and the two now evolve separately, which is the whole point. budget is
// two people who trust each other completely; this one has customers. Changing
// the private app must never be able to change what a paying stranger sees, and
// a shared component library between them would guarantee that it eventually
// does.
//
// DELIBERATELY STANDALONE. No '@/app/...' alias into the Next app, unlike
// app-vite. This app builds and deploys without the trading dashboard's
// component tree, its global toolbar, or gexSocket — it talks to its own
// backend (server-v2/daily-server.js) over relative /api/daily/* URLs, and in
// dev those are proxied so there is no CORS.
//
// VITE_BACKEND — where the daily backend is served in dev.
//   local: http://localhost:3011   (node server-v2/daily-server.js)
//   VPS  : http://127.0.0.1:3011 via an SSH tunnel, or https://daily.cbedge.net
// BACKEND_COOKIE — paste a dy_session cookie from a signed-in tab to develop
//   against live data. NOT VITE_-prefixed, so it stays in this config and never
//   reaches the browser bundle.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const BACKEND = env.VITE_BACKEND || 'http://localhost:3011'
  const COOKIE = env.BACKEND_COOKIE || ''

  const auth = (proxy) => {
    proxy.on('proxyReq', (proxyReq) => {
      if (COOKIE) proxyReq.setHeader('cookie', COOKIE)
    })
  }

  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname_, 'src') } },
    // Served at the ROOT of its own subdomain → assets live at /assets/*.
    base: '/',
    build: { outDir: 'dist', sourcemap: false },
    server: {
      port: 5176,
      open: true,
      proxy: {
        // Only /api. This app has no reason to reach /ws or /proxy, and not
        // proxying them in dev keeps that true by accident as well as on purpose.
        '/api': { target: BACKEND, changeOrigin: true, secure: false, configure: auth },
      },
    },
  }
})
