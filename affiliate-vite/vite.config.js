import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname_ = path.dirname(fileURLToPath(import.meta.url))

// affiliate-vite — the affiliate program SPA served at affiliate.cbedge.net.
//
// DELIBERATELY STANDALONE, like budget-vite and unlike app-vite: no '@/app/...'
// alias into the Next app. This is a PUBLIC, signed-out marketing surface with
// its own identity system (aff_session); it must build and deploy without the
// trading dashboard's component tree, its global toolbar, or gexSocket. The
// theme is COPIED in under src/lib/theme.ts, not aliased.
//
// VITE_BACKEND — where the backend is served in dev.
//   local: http://localhost:3001   (repo-root `npm run dev`)
//   VPS  : http://127.0.0.1:3002 via an SSH tunnel, or https://affiliate.cbedge.net
// BACKEND_COOKIE — paste an aff_session cookie from a signed-in tab to develop
//   against live data. NOT VITE_-prefixed, so it never reaches the bundle.
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
      port: 5177,
      open: true,
      proxy: {
        '/api': httpTarget,
        // Mirrors the nginx rewrite so /r/CODE behaves the same in dev.
        '/r': { ...httpTarget, rewrite: (p) => `/api/aff/go?code=${p.replace(/^\/r\//, '')}` },
      },
    },
  }
})
