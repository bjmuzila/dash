import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/components/auth/AuthProvider'
// Existing Next client pages, compiled directly via the '@' alias + next/* shims.
import TradersDashboard from '@/app/traders-dashboard/page'
import Analytics from '@/app/analytics/page'

// Heavy chart/data pages: code-split per MIGRATION.md (lazy + Suspense).
// /home uses a seed-swap wrapper (server /proxy/gex read → client /api fetch).
const Home         = lazy(() => import('./routes/HomeRoute'))
const OptionsChain = lazy(() => import('@/app/options-chain/page'))
// mult-greek/page.tsx is a server component; mount its client UI (named export).
const MultGreek    = lazy(() => import('@/app/mult-greek/MultGreekClient').then((m) => ({ default: m.MultGreekClient })))
const Em           = lazy(() => import('@/app/em/page'))
const Flow         = lazy(() => import('@/app/flow/page'))
const EsCandles    = lazy(() => import('@/app/es-candles/page'))
const Scanner      = lazy(() => import('@/app/scanner/page'))
const Ict          = lazy(() => import('@/app/ict/page'))
const Trading      = lazy(() => import('@/app/trading/page'))
const Greeks       = lazy(() => import('@/app/greeks/page'))
const Confidence   = lazy(() => import('@/app/confidence-score/page'))
const Fails        = lazy(() => import('@/app/fails/page'))
const Premarket    = lazy(() => import('@/app/premarket/page'))
const EconCalendar = lazy(() => import('@/app/economic-calendar/page'))

const S = (el: ReactNode) => <Suspense fallback={null}>{el}</Suspense>

// Served under /app in prod (see vite.config base:'/app/'), so the router
// basename is /app: the browser URL /app/scanner maps to route /scanner.
export default function App() {
  return (
    <BrowserRouter basename="/app">
      <AuthProvider>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0 }}>
          <Routes>
            <Route path="/traders-dashboard" element={<TradersDashboard />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/home" element={S(<Home />)} />
            <Route path="/options-chain" element={S(<OptionsChain />)} />
            <Route path="/mult-greek" element={S(<MultGreek />)} />
            <Route path="/em" element={S(<Em />)} />
            <Route path="/flow" element={S(<Flow />)} />
            <Route path="/es-candles" element={S(<EsCandles />)} />
            <Route path="/scanner" element={S(<Scanner />)} />
            <Route path="/ict" element={S(<Ict />)} />
            <Route path="/trading" element={S(<Trading />)} />
            <Route path="/greeks" element={S(<Greeks />)} />
            <Route path="/confidence-score" element={S(<Confidence />)} />
            <Route path="/fails" element={S(<Fails />)} />
            <Route path="/premarket" element={S(<Premarket />)} />
            <Route path="/economic-calendar" element={S(<EconCalendar />)} />
            <Route path="*" element={<Navigate to="/traders-dashboard" replace />} />
          </Routes>
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}
