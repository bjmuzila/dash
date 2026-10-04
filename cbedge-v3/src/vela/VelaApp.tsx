import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ReplayDockHost } from '@/design/primitives/ReplayDock'
import { useIsPhone } from '@/design/useIsPhone'

// ─────────────────────────────────────────────────────────────────────────────
// vela.cbedge.net — Vela on its own host.
//
// THIS IS NOT A FORK. It mounts the same pages/Vela.tsx that cbedge.net/v3/vela
// does; a fix to the page is a fix here on the next build. What this file adds
// is only the frame the v3 Shell would otherwise provide:
//
//   /     the desktop workspace. A phone is sent to /m, unless the URL carries
//         ?desktop (the "show me the desktop site" escape hatch).
//   /m    the phone workspace — <Vela phone />, its own saved document
//         (`cb-v3-vela-m`), exactly like /v3/m/vela.
//
// ── What is deliberately NOT here ────────────────────────────────────────────
//   · No rail, no toolbar, no notes, no alerts pill, no CopyShot menu. Vela
//     draws its own topbar and camera; the CB Edge chrome around it belongs to
//     CB Edge.
//   · No PageSymbolProvider. Vela only reads the page symbol to seed a FIRST
//     visit and to mirror the active chart into the toolbar's ticker box; with
//     no toolbar, the context's default (SPX, a no-op setter) is exactly right,
//     and the provider would log every open as a "home" ticker event in the
//     board's analytics.
//   · No PageVisitBeacon. It labels rows from the v3 NAV table and would pull
//     the whole Shell into this bundle to do it.
//
// ── Who gets in ──────────────────────────────────────────────────────────────
// Nothing here checks. The gate is nginx (deploy/vela/nginx.conf →
// auth_request → /api/vela/verify), which answers BEFORE a byte of this bundle
// is sent. A React gate would already have shipped the app it was hiding.
//
// ReplayDockHost: Vela's bar replay docks its transport through
// design/primitives/ReplayDock, which portals into this host. In v3 the Shell
// provides it; without one the dock would render inline inside the chart frame.
// ─────────────────────────────────────────────────────────────────────────────

const Vela = lazy(() => import('@/pages/Vela'))

/** `/` — the desktop workspace, or a hand-off to `/m` on a phone. */
function DesktopRoute() {
  const isPhone = useIsPhone()
  const { search } = useLocation()
  if (isPhone && !new URLSearchParams(search).has('desktop')) {
    return <Navigate to={{ pathname: '/m', search }} replace />
  }
  return <Vela />
}

/** Non-negotiable 9: an unknown path says so instead of quietly showing the chart. */
function NotFound() {
  const { pathname } = useLocation()
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm">
      <span className="text-lg text-fg">No such page</span>
      <span className="tabular text-faint">{pathname}</span>
      <a className="text-muted underline" href="/">
        Open Vela
      </a>
    </div>
  )
}

export default function VelaApp() {
  return (
    <BrowserRouter>
      <div className="cb-viewport flex flex-col overflow-hidden bg-bg text-fg">
        <ReplayDockHost>
          <Suspense fallback={<div className="min-h-0 flex-1" />}>
            <Routes>
              <Route path="/" element={<DesktopRoute />} />
              <Route path="/m" element={<Vela phone />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ReplayDockHost>
      </div>
    </BrowserRouter>
  )
}
