import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './auth'
import Shell from './components/Shell'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import { T, SANS } from './theme'

const Today    = lazy(() => import('./pages/Today'))
const Routines = lazy(() => import('./pages/Routines'))
const Projects = lazy(() => import('./pages/Projects'))
const Budget   = lazy(() => import('./pages/Budget'))
const Settings = lazy(() => import('./pages/Settings'))

// staleTime 30s: this is a household app, not a market feed. Refetching on
// every focus is noise and burns phone battery for data that changes when one
// of two people types something.
const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

const S = (el: React.ReactNode) => <Suspense fallback={null}>{el}</Suspense>

/** Splash while the first /me round-trip settles — prevents a login flash. */
function Booting() {
  return (
    <div style={{
      height: '100dvh', display: 'grid', placeItems: 'center',
      background: T.paper, backgroundImage: T.glow, color: T.faint, fontFamily: SANS, fontSize: 14,
    }}>
      …
    </div>
  )
}

function Gate() {
  const { user, loading } = useAuth()
  if (loading) return <Booting />
  if (!user) return <Login />
  // A still-temporary password blocks the app entirely — not a dismissible banner.
  if (user.mustChangePassword) return <ChangePassword />
  return (
    <Shell>
      <Routes>
        <Route path="/today" element={S(<Today />)} />
        <Route path="/routines" element={S(<Routines />)} />
        <Route path="/projects" element={S(<Projects />)} />
        <Route path="/budget" element={S(<Budget />)} />
        <Route path="/settings" element={S(<Settings />)} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Routes>
    </Shell>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
