import '@/app/globals.css' // app's global stylesheet: dark html/body bg, margin:0, system font stack (--font-sans / --font-inter alias). Fixes the white frame + wrong font.
import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/components/auth/AuthProvider'
import LayoutShell from '@/components/shared/LayoutShell'
import MobileRedirect from '@/components/mobile/MobileRedirect'
// The client half of the v2 -> v3 move. Wraps LayoutShell so a route v3 already
// owns leaves for /v3 WITHOUT mounting the v2 page (and its socket) first. The
// table it reads is lib/v3Routes.ts, shared with middleware.ts.
import V3Redirect from './V3Redirect'
// THE LEGACY WING ONLY (2026-10-09, Brandon: "old pages needed to go").
// Every route v3 answers is in PORTED (lib/v3Routes.ts): middleware.ts sends a
// document request for one to /v3, and V3Redirect (below) does the same for an
// in-app click, BEFORE any route renders. So those 22 pages (home, traders
// dashboard, analytics, options chain, mult-greek, EM, flow, premarket, board,
// ES candles, scanner, replay, ICT, trading, fails, econ calendar and the
// /m/gex · heatmap · es · em · prep · econ phone views) were compiled into every
// build and never shown. They are gone from this SPA. What is left is exactly
// LEGACY_NAV: the pages v3 does not have yet.
// 2026-10-10 (Brandon: "only keep v2 stuff that's /app/test"): the v2 SPA is
// now Test Lab plus Levels, which Test Lab links to. Level Log, Strike History,
// Confidence Score and the /m/chain phone page were retired to
// Vanilla/retired-2026-10-10/. /level-log and /m/chain have v3 homes (see
// PORTED / MOBILE_TO_V3); the other two fall through to the catch-all.
const Levels        = lazy(() => import('@/components/legacy/LevelsPage'))
const TestLab       = lazy(() => import('@/components/pages/TestLab'))

const S = (el: ReactNode) => <Suspense fallback={null}>{el}</Suspense>

// Mirrors app/layout.tsx: AuthProvider > (body flex-column) > LayoutShell.
// LayoutShell renders the universal GlobalToolbar (+ Gex/Notes docks) around the
// routed page, exactly like the real Next app. The wrapper div replaces the Next
// body's `className="flex h-screen flex-col overflow-hidden"` (no Tailwind here).
export default function App() {
  return (
    <BrowserRouter basename="/app">
      <AuthProvider>
        {/* cb-app-viewport = 100dvh where supported, 100vh otherwise. Plain
            100vh on iOS Safari measures the viewport WITHOUT the collapsible
            URL bar, so the bottom tab bar sat ~80px below the fold. */}
        <div className="cb-app-viewport" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <MobileRedirect />
          {/* V3Redirect wraps the shell rather than sitting beside it: a ported
              route renders NOTHING here and leaves for /v3, instead of painting
              the v2 toolbar and opening the v2 socket on its way out. Routes
              that are still v2-only pass straight through. */}
          <V3Redirect>
            {/* chrome="v2-legacy" — the SPA is the legacy wing now, so it wears
                V3LegacyToolbar (v3 palette, v3 nav, a Legacy menu and ← Back to
                v3) instead of GlobalToolbar, whose strip is mostly items that
                redirect out from under the click. This is the ONLY call site
                that passes it; every Next route keeps the v2 toolbar. */}
            <LayoutShell chrome="v2-legacy">
              <Routes>
                <Route path="/levels" element={S(<Levels />)} />
                <Route path="/test" element={S(<TestLab />)} />
                {/* Anything else (a ported route V3Redirect is already leaving,
                    or an unknown path) goes to /traders-dashboard, which is
                    ported, so V3Redirect carries it on to /v3. */}
                <Route path="*" element={<Navigate to="/traders-dashboard" replace />} />
              </Routes>
            </LayoutShell>
          </V3Redirect>
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}
