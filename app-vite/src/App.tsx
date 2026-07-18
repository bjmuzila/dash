import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/components/auth/AuthProvider'
// The existing Next client pages, compiled directly via the '@' alias + next/* shims.
import TradersDashboard from '@/app/traders-dashboard/page'
import Analytics from '@/app/analytics/page'

// Heavy chart pages: code-split per MIGRATION.md (lazy + Suspense).
const OptionsChain = lazy(() => import('@/app/options-chain/page'))
// mult-greek/page.tsx is a server component; mount its client UI (named export) directly.
const MultGreek = lazy(() =>
  import('@/app/mult-greek/MultGreekClient').then((m) => ({ default: m.MultGreekClient }))
)

// Served under /app in prod (see vite.config base:'/app/'), so the router
// basename is /app: the browser URL /app/analytics maps to route /analytics.
export default function App() {
  return (
    <BrowserRouter basename="/app">
      <AuthProvider>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0 }}>
          <Routes>
            <Route path="/traders-dashboard" element={<TradersDashboard />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/options-chain" element={<Suspense fallback={null}><OptionsChain /></Suspense>} />
            <Route path="/mult-greek" element={<Suspense fallback={null}><MultGreek /></Suspense>} />
            <Route path="*" element={<Navigate to="/traders-dashboard" replace />} />
          </Routes>
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}
