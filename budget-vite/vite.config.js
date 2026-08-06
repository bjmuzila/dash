import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname_ = path.dirname(fileURLToPath(import.meta.url))

// budget-vite — the household life-OS SPA served at budget.cbedge.net.
//
// Mirrors owner-vite: the app talks to the same Node backend over relative URLs
// (/api/hh/*, /api/budget*), and in dev those are proxied to a running backend
// so there is no CORS.
//
// DELIBERATELY STANDALONE. No '@/app/...' alias into the Next app, unlike
// app-vite. This app must build and deploy without the trading dashboard's
// component tree, its global toolbar, or gexSocket. When the budget UI is
// ported over in phase 1 step 6 it gets COPIED in under src/, not aliased —
// the two apps then evolve independently instead of one breaking the other.
//
// VITE_BACKEND — where the household backend is served in dev.
//   local: http://localhost:3001   (repo-root `npm run dev`)
//   VPS  : http://178.156.137.36:3002 via an SSH tunnel, or https://budget.cbedge.net
// BACKEND_COOKIE — paste an hh_session cookie from a signed-in budget tab to
//   develop against live data. NOT VITE_-prefixed, so it stays in this config
//   and never reaches the browser bundle.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const BACKEND = env.VITE_BACKEND || 'http://localhost:3001'
  const COOKIE = env.BACKEND_COOKIE || ''

  const auth = (proxy) => {
    proxy.on('proxyReq', (proxyReq) => {
      if (COOKIE) proxyReq.setHeader('cookie', COOKIE)
    })
  }

  const httpTarget = { target: BACKEND, changeOrigin: true, secure: false, configure: auth }

  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname_, 'src') } },
    // Served at the ROOT of its own subdomain → assets live at /assets/*.
    base: '/',
    build: { outDir: 'dist', sourcemap: false },
    server: {
      port: 5175,
      open: true,
      proxy: {
        '/api': httpTarget,
      },
    },
  }
})
