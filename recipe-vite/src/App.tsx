import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './auth'
import Shell from './components/Shell'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import SetPin from './pages/SetPin'
import { T, SANS } from './theme'

const Cookbook = lazy(() => import('./pages/Cookbook'))
const Recipe   = lazy(() => import('./pages/Recipe'))
const Add      = lazy(() => import('./pages/Add'))
const Settings = lazy(() => import('./pages/Settings'))

// staleTime 30s, matching budget-vite: this is a two-person cookbook, not a
// feed. Refetching on every focus is noise and burns phone battery.
const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

const S = (el: React.ReactNode) => <Suspense fallback={null}>{el}</Suspense>

/** "Not now" on the PIN offer — remembered forever. A prompt that comes back is
 *  one you learn to dismiss without reading, and Settings always has the card.
 *  localStorage is fine for this and ONLY this: it is a UI preference, not a
 *  credential. Both the session and the device token are HttpOnly cookies. */
const PIN_SKIP_KEY = 'hh:pin-offer-declined'
const pinOfferDeclined = () => {
  try { return localStorage.getItem(PIN_SKIP_KEY) === '1' } catch { return true }
}
const declinePinOffer = () => {
  try { localStorage.setItem(PIN_SKIP_KEY, '1') } catch { /* private mode — just don't nag this load */ }
}

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
  const [, bump] = useState(0)

  if (loading) return <Booting />
  if (!user) return <Login />
  // A still-temporary password blocks the app entirely — not a dismissible banner.
  if (user.mustChangePassword) return <ChangePassword />

  const offerPin = !user.pinOnThisDevice && !pinOfferDeclined()
  const closePinOffer = (remember: boolean) => {
    if (remember) declinePinOffer()
    bump((n) => n + 1)
  }

  return (
    <>
      {offerPin && (
        <SetPin onDone={() => closePinOffer(false)} onSkip={() => closePinOffer(true)} />
      )}
      <Shell>
        <Routes>
          <Route path="/cookbook" element={S(<Cookbook />)} />
          {/* Saved is the cookbook filtered to favourites — same screen, same
              query key shape, one prop. A second component would be a copy of
              Cookbook that drifts. */}
          <Route path="/saved" element={S(<Cookbook favoritesOnly />)} />
          <Route path="/r/:id" element={S(<Recipe />)} />
          <Route path="/add" element={S(<Add />)} />
          <Route path="/settings" element={S(<Settings />)} />
          <Route path="*" element={<Navigate to="/cookbook" replace />} />
        </Routes>
      </Shell>
    </>
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
