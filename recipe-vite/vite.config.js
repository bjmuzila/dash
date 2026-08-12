import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname_ = path.dirname(fileURLToPath(import.meta.url))

// recipe-vite — the cookbook SPA served at recipe.cbedge.net.
//
// Mirrors budget-vite: the app talks to the same Node backend over relative
// URLs (/api/hh/*), and in dev those are proxied to a running backend so there
// is no CORS.
//
// DELIBERATELY STANDALONE. No '@/app/...' alias into the Next app and no import
// from budget-vite, even though the auth screens started life as a copy of
// budget-vite's. This app must build and deploy without the trading dashboard's
// component tree and without the household app — the copies then evolve
// independently instead of one breaking the other's build.
//
// VITE_BACKEND — where the household backend is served in dev.
//   local: http://localhost:3001   (repo-root `npm run dev`)
//   VPS  : http://178.156.137.36:3002 via an SSH tunnel, or https://recipe.cbedge.net
// BACKEND_COOKIE — paste an hh_session cookie from a signed-in tab to develop
//   against live data. NOT VITE_-prefixed, so it stays in this config and never
//   reaches the browser bundle.
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
      // 5175 is budget-vite. Both are often open at once.
      port: 5176,
      open: true,
      proxy: {
        '/api': httpTarget,
      },
    },
  }
})
