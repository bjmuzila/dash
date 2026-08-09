import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './auth'
import Shell from './components/Shell'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import SetPin from './pages/SetPin'
import Welcome from './pages/Welcome'
import { T, SANS } from './theme'

const Today    = lazy(() => import('./pages/Today'))
const Todo     = lazy(() => import('./pages/Todo'))
const Lists    = lazy(() => import('./pages/Lists'))
const Journal  = lazy(() => import('./pages/Journal'))
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

/**
 * Module scope, so it survives Gate re-rendering on every route change but
 * resets on a real page load. React state can't do this job: Gate re-runs its
 * initialiser whenever it remounts, and a ref would reset with it.
 */
let splashShownThisLoad = false

/**
 * "Not now" on the PIN offer. Remembered FOREVER, not per session — a prompt
 * that comes back is a prompt you learn to dismiss without reading, and the
 * PIN card in Settings is always there for anyone who changes their mind.
 *
 * localStorage is fine for this and only this: it is a UI preference, not a
 * credential. Nothing about auth is stored client-side — the session and the
 * device token are both HttpOnly cookies.
 */
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
  const { user, loading, justSignedIn, clearJustSignedIn } = useAuth()
  // Re-render trigger only; splashShownThisLoad above is the real source of truth.
  const [, bump] = useState(0)

  if (loading) return <Booting />
  if (!user) return <Login />
  // A still-temporary password blocks the app entirely — not a dismissible
  // banner, and the landing screen must not sit in front of it.
  if (user.mustChangePassword) return <ChangePassword />

  const showWelcome = justSignedIn || !splashShownThisLoad
  const dismissWelcome = () => {
    splashShownThisLoad = true
    clearJustSignedIn()
    bump((n) => n + 1)
  }

  // Offered AFTER the welcome splash, never in front of it, and never to a
  // device that already has one. pinOnThisDevice comes from the hh_device
  // cookie via /me, so a second phone gets asked even though the account is
  // the same one.
  const offerPin = !showWelcome && !user.pinOnThisDevice && !pinOfferDeclined()
  const closePinOffer = (remember: boolean) => {
    if (remember) declinePinOffer()
    bump((n) => n + 1)
  }

  return (
    <>
      {/* Rendered OVER the app rather than instead of it, so Today is already
          mounted and painted behind the landing screen — dismissing lands on a
          finished screen instead of a spinner. */}
      {showWelcome && <Welcome onDone={dismissWelcome} />}
      {offerPin && (
        <SetPin onDone={() => closePinOffer(false)} onSkip={() => closePinOffer(true)} />
      )}
      <Shell>
      <Routes>
        <Route path="/today" element={S(<Today />)} />
        <Route path="/todo" element={S(<Todo />)} />
        <Route path="/lists" element={S(<Lists />)} />
        <Route path="/journal" element={S(<Journal />)} />
        {/* Habits and Projects lost their tab slots to Todo and Lists, but the
            screens and their data are untouched — reached from More. */}
        <Route path="/routines" element={S(<Routines />)} />
        <Route path="/projects" element={S(<Projects />)} />
        <Route path="/budget" element={S(<Budget />)} />
        <Route path="/settings" element={S(<Settings />)} />
        <Route path="*" element={<Navigate to="/today" replace />} />
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
