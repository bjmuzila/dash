import '@/app/globals.css' // app's global stylesheet: dark html/body bg, margin:0, system font stack (--font-sans / --font-inter alias). Fixes the white frame + wrong font.
import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/components/auth/AuthProvider'
import LayoutShell from '@/components/shared/LayoutShell'
// Existing Next client pages, compiled directly via the '@' alias + next/* shims.
import TradersDashboard from '@/components/pages/TradersDashboard'
import Analytics from '@/components/pages/Analytics'

// Heavy chart/data pages: code-split per MIGRATION.md (lazy + Suspense).
// /home uses a seed-swap wrapper (server /proxy/gex read → client /api fetch).
const Home         = lazy(() => import('./routes/HomeRoute'))
const OptionsChain = lazy(() => import('@/components/pages/OptionsChain'))
const Options      = lazy(() => import('@/components/pages/Options'))
// mult-greek/page.tsx is a server component; mount its client UI (named export).
const MultGreek    = lazy(() => import('@/app/mult-greek/MultGreekClient').then((m) => ({ default: m.MultGreekClient })))
const Em           = lazy(() => import('@/components/pages/Em'))
const Flow         = lazy(() => import('@/components/pages/Flow'))
const EsCandles    = lazy(() => import('@/components/pages/EsCandles'))
const Scanner      = lazy(() => import('@/components/pages/Scanner'))
const Ict          = lazy(() => import('@/components/pages/Ict'))
const Trading      = lazy(() => import('@/components/pages/Trading'))
const Confidence   = lazy(() => import('@/components/pages/ConfidenceScore'))
const Fails        = lazy(() => import('@/components/pages/Fails'))
const Premarket    = lazy(() => import('@/components/pages/Premarket'))
const EconCalendar = lazy(() => import('@/components/pages/EconomicCalendar'))
const TestLab      = lazy(() => import('@/components/pages/TestLab'))
const StrikeHistory = lazy(() => import('@/components/pages/StrikeHistory'))
const Replay       = lazy(() => import('@/components/pages/Replay'))

const S = (el: ReactNode) => <Suspense fallback={null}>{el}</Suspense>

// Mirrors app/layout.tsx: AuthProvider > (body flex-column) > LayoutShell.
// LayoutShell renders the universal GlobalToolbar (+ Gex/Notes docks) around the
// routed page, exactly like the real Next app. The wrapper div replaces the Next
// body's `className="flex h-screen flex-col overflow-hidden"` (no Tailwind here).
export default function App() {
  return (
    <BrowserRouter basename="/app">
      <AuthProvider>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
          <LayoutShell>
            <Routes>
              <Route path="/home" element={S(<Home />)} />
              <Route path="/traders-dashboard" element={<TradersDashboard />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/options-chain" element={S(<OptionsChain />)} />
              <Route path="/options" element={S(<Options />)} />
              <Route path="/mult-greek" element={S(<MultGreek />)} />
              <Route path="/em" element={S(<Em />)} />
              <Route path="/flow" element={S(<Flow />)} />
              <Route path="/es-candles" element={S(<EsCandles />)} />
              <Route path="/scanner" element={S(<Scanner />)} />
              <Route path="/strike-history" element={S(<StrikeHistory />)} />
              <Route path="/replay" element={S(<Replay />)} />
              <Route path="/ict" element={S(<Ict />)} />
              <Route path="/test" element={S(<TestLab />)} />
              <Route path="/trading" element={S(<Trading />)} />
              <Route path="/confidence-score" element={S(<Confidence />)} />
              <Route path="/fails" element={S(<Fails />)} />
              <Route path="/premarket" element={S(<Premarket />)} />
              <Route path="/economic-calendar" element={S(<EconCalendar />)} />
              <Route path="*" element={<Navigate to="/traders-dashboard" replace />} />
            </Routes>
          </LayoutShell>
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}
