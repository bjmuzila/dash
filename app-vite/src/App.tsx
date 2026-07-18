import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/components/auth/AuthProvider'
// The existing Next client pages, compiled directly via the '@' alias + next/* shims.
import TradersDashboard from '@/app/traders-dashboard/page'
import Analytics from '@/app/analytics/page'

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
            <Route path="*" element={<Navigate to="/traders-dashboard" replace />} />
          </Routes>
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}
