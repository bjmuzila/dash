import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// app-vite — the customer dashboard SPA. Compiles the EXISTING Next client
// pages (app/**/page.tsx) directly by aliasing '@' to the repo root and
// shimming the three next/* modules those pages touch. Talks to the Next
// backend over the SAME relative URLs the real app uses (/api, /proxy, /ws);
// in dev we proxy them to a running backend so there is no CORS.
//
// VITE_BACKEND   — backend origin. local: http://localhost:3001  prod: https://cbedge.net
// BACKEND_COOKIE — (prod only) an authenticated cbedge.net document.cookie so the
//                  proxy passes the paywall / WS auth gate. Not VITE_-prefixed → stays
//                  server-side, never shipped in the browser bundle.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const BACKEND = env.VITE_BACKEND || 'http://localhost:3001'
  const WS_BACKEND = BACKEND.replace(/^http/, 'ws')
  const COOKIE = env.BACKEND_COOKIE || ''
  const TOKEN = env.BACKEND_TOKEN || ''

  const auth = (proxy: any) => {
    const setHeaders = (proxyReq: any) => {
      if (COOKIE) proxyReq.setHeader('cookie', COOKIE)
      if (TOKEN) proxyReq.setHeader('authorization', `Bearer ${TOKEN}`)
    }
    proxy.on('proxyReq', setHeaders)
    proxy.on('proxyReqWs', (proxyReq: any) => {
      setHeaders(proxyReq)
      try { proxyReq.setHeader('origin', BACKEND) } catch { /* ignore */ }
    })
  }
  const httpTarget = { target: BACKEND, changeOrigin: true, secure: false, configure: auth }

  return {
    plugins: [react()],
    // Served under cbedge.net/app/ in prod → asset URLs prefixed so /app/assets/*
    // resolve. Relative API paths stay root-absolute and hit the same-origin backend.
    base: '/app/',
    resolve: {
      alias: [
        // exact next/* shims MUST come before the '@' rule
        { find: 'next/link', replacement: path.resolve(__dirname, 'src/shims/next-link.tsx') },
        { find: 'next/navigation', replacement: path.resolve(__dirname, 'src/shims/next-navigation.ts') },
        { find: 'next/dynamic', replacement: path.resolve(__dirname, 'src/shims/next-dynamic.tsx') },
        // '@/...' → repo root (resolves @/components, @/hooks, @/lib, @/app)
        { find: /^@\//, replacement: REPO_ROOT + '/' },
      ],
    },
    // Inline empty PostCSS so Vite doesn't walk up into the Next repo's
    // postcss.config.js (Tailwind with no content) and warn.
    css: { postcss: { plugins: [] } },
    server: {
      port: 5174,
      open: true,
      proxy: {
        '/ws': { target: WS_BACKEND, ws: true, changeOrigin: true, secure: false, configure: auth },
        '/proxy': httpTarget,
        '/api': httpTarget,
      },
    },
  }
})
