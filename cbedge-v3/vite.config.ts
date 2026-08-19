import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// ─────────────────────────────────────────────────────────────────────────────
// cbedge-v3 build config.
//
// Two rules encoded here, both in service of load speed:
//
//  1. `base: '/v3/'` — v3 is served ALONGSIDE the v2 SPA, not instead of it.
//     v2 keeps /app/*, v3 takes /v3/*. Flip the default only when v3 is ready.
//
//  2. Manual chunking is deliberately minimal. React lands in its own chunk so
//     it stays cached across every deploy; everything else code-splits by route
//     via lazy(). Do NOT add vendor grouping "for tidiness" — a shared vendor
//     chunk means one dependency change invalidates the cache for all of them.
// ─────────────────────────────────────────────────────────────────────────────

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Where the real data lives. In dev we proxy to it so the app runs against
  // live server-v2 without CORS or a local backend. In prod it is same-origin.
  const backend = env.VITE_BACKEND_ORIGIN || 'http://127.0.0.1:3000'
  const wsBackend = backend.replace(/^http/, 'ws')

  return {
    base: '/v3/',
    plugins: [react(), tailwind()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5273,
      proxy: {
        '/api': { target: backend, changeOrigin: true },
        '/proxy': { target: backend, changeOrigin: true },
        '/ws': { target: wsBackend, ws: true, changeOrigin: true },
      },
    },
    build: {
      target: 'es2022',
      // Source maps are worth their weight — they cost nothing at runtime
      // (browsers only fetch them when devtools is open).
      sourcemap: true,
      cssCodeSplit: true,
      reportCompressedSize: false, // speeds the build; check-budgets.mjs measures for real
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Match precisely. `node_modules/react` also matches react-router,
            // react-is, and anything else prefixed "react" — which quietly
            // pulls unrelated packages into the long-lived cache chunk.
            if (
              /node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)
            ) {
              return 'react'
            }
            return undefined
          },
        },
      },
    },
  }
})
