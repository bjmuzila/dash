import '@/app/globals.css' // app's global stylesheet: dark html/body bg, margin:0, system font stack (--font-sans / --font-inter alias). Fixes the white frame + wrong font.
import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/components/auth/AuthProvider'
import LayoutShell from '@/components/shared/LayoutShell'
import MobileRedirect from '@/components/mobile/MobileRedirect'
// Existing Next client pages, compiled directly via the '@' alias + next/* shims.
import TradersDashboard from '@/components/pages/TradersDashboard'
import Analytics from '@/components/pages/Analytics'

// Heavy chart/data pages: code-split per MIGRATION.md (lazy + Suspense).
// /home uses a seed-swap wrapper (server /proxy/gex read → client /api fetch).
const Home         = lazy(() => import('./routes/HomeRoute'))
const OptionsChain = lazy(() => import('@/components/pages/OptionsChain'))
// /options (the "Options" toolbar tile) was removed 2026-08-12. Options Chain
// (/options-chain, above) is a different page and is unaffected.
// mult-greek/page.tsx is a server component; mount its client UI (named export).
const MultGreek    = lazy(() => import('@/app/mult-greek/MultGreekClient').then((m) => ({ default: m.MultGreekClient })))
const Em           = lazy(() => import('@/components/pages/Em'))
// /levels — universe-wide CB/CW/PW board. Client component under app/, so it
// is imported straight from '@/app' like MultGreekClient rather than through a
// components/pages wrapper.
const Levels       = lazy(() => import('@/app/levels/page'))
const Flow         = lazy(() => import('@/components/pages/Flow'))
// /premarket — the premarket prep board (regime, walls, flip, overnight
// context, expected range, playbook). Lives in components/pages/ like every
// other live-feed page: it rides lib/gexSocket, and anything under app/ gets
// prerendered by Next, which cannot open a socket. app/premarket/page.tsx is
// only a force-dynamic redirect to /app/premarket.
const Premarket    = lazy(() => import('@/components/pages/Premarket'))
// /board — the near-black card board. Same DashGrid machinery as the Options
// board (drag/resize/add/remove, layout saved per user), on a page-scoped
// palette that is deliberately NOT homeTheme while the look is being trialled.
const Board        = lazy(() => import('@/components/pages/Board'))
const EsCandles    = lazy(() => import('@/components/pages/EsCandles'))
const Scanner      = lazy(() => import('@/components/pages/Scanner'))
const Ict          = lazy(() => import('@/components/pages/Ict'))
const Trading      = lazy(() => import('@/components/pages/Trading'))
const Confidence   = lazy(() => import('@/components/pages/ConfidenceScore'))
const Fails        = lazy(() => import('@/components/pages/Fails'))
const EconCalendar = lazy(() => import('@/components/pages/EconomicCalendar'))
const TestLab      = lazy(() => import('@/components/pages/TestLab'))
const StrikeHistory = lazy(() => import('@/components/pages/StrikeHistory'))
const Replay       = lazy(() => import('@/components/pages/Replay'))
const LevelLog     = lazy(() => import('@/components/pages/LevelLog'))
// /guide — static site guide (GEX/DEX explainer + page directory). Linked from
// the account menu (UserMenu), not the toolbar: read once, referred back to.
const Guide        = lazy(() => import('@/app/guide/page'))

// ── Phone build (/m/*) ────────────────────────────────────────────────────────
// Seven purpose-built views for a 390px iPhone, each in its own chunk so a phone
// never downloads the desktop page it replaces. MobileRedirect (mounted below)
// sends phones here from the matching desktop route; see components/mobile/
// mobileNav.ts for the tab registry and the desktop<->mobile route map.
const MGex     = lazy(() => import('@/components/mobile/pages/MobileGex'))
const MHeatmap = lazy(() => import('@/components/mobile/pages/MobileHeatmap'))
const MEs      = lazy(() => import('@/components/mobile/pages/MobileEsCandles'))
const MChain   = lazy(() => import('@/components/mobile/pages/MobileChain'))
const MEm      = lazy(() => import('@/components/mobile/pages/MobileEm'))
// /m/prep replaced EM in the tab bar; /m/em stays routed so old links still work.
const MPrep    = lazy(() => import('@/components/mobile/pages/MobilePrep'))
const MEcon    = lazy(() => import('@/components/mobile/pages/MobileEcon'))

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
          <LayoutShell>
            <Routes>
              <Route path="/home" element={S(<Home />)} />
              <Route path="/traders-dashboard" element={<TradersDashboard />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/options-chain" element={S(<OptionsChain />)} />
              <Route path="/mult-greek" element={S(<MultGreek />)} />
              <Route path="/levels" element={S(<Levels />)} />
              <Route path="/em" element={S(<Em />)} />
              <Route path="/flow" element={S(<Flow />)} />
              <Route path="/premarket" element={S(<Premarket />)} />
              <Route path="/board" element={S(<Board />)} />
              <Route path="/es-candles" element={S(<EsCandles />)} />
              <Route path="/scanner" element={S(<Scanner />)} />
              <Route path="/level-log" element={S(<LevelLog />)} />
              <Route path="/strike-history" element={S(<StrikeHistory />)} />
              <Route path="/replay" element={S(<Replay />)} />
              <Route path="/ict" element={S(<Ict />)} />
              <Route path="/test" element={S(<TestLab />)} />
              <Route path="/trading" element={S(<Trading />)} />
              <Route path="/confidence-score" element={S(<Confidence />)} />
              <Route path="/fails" element={S(<Fails />)} />
              <Route path="/economic-calendar" element={S(<EconCalendar />)} />
              <Route path="/guide" element={S(<Guide />)} />

              {/* Phone build. Kept as explicit routes rather than a nested
                  layout so each one code-splits on its own. */}
              <Route path="/m" element={<Navigate to="/m/gex" replace />} />
              <Route path="/m/gex" element={S(<MGex />)} />
              <Route path="/m/heatmap" element={S(<MHeatmap />)} />
              <Route path="/m/es" element={S(<MEs />)} />
              <Route path="/m/chain" element={S(<MChain />)} />
              <Route path="/m/em" element={S(<MEm />)} />
              <Route path="/m/prep" element={S(<MPrep />)} />
              <Route path="/m/econ" element={S(<MEcon />)} />
              <Route path="*" element={<Navigate to="/traders-dashboard" replace />} />
            </Routes>
          </LayoutShell>
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}
