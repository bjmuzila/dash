import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './auth'

// The signed-out surface is eager. It is the first thing a stranger loads, it is
// the only thing a search engine indexes, and it is small — a lazy chunk here
// would buy nothing and cost a blank frame on the page that has to sell.
import Landing from './pages/Landing'
import Pricing from './pages/Pricing'
import SignIn from './pages/SignIn'
import SignUp from './pages/SignUp'
import Forgot from './pages/Forgot'
import Reset from './pages/Reset'
import Verify from './pages/Verify'
import { Terms, Privacy } from './pages/Legal'
import Paywall from './pages/Paywall'
import Onboarding from './pages/Onboarding'
import ChangePassword from './pages/ChangePassword'
import SetPin from './pages/SetPin'
import { T, SANS, label } from './theme'

// The app itself, lazily. Everything below this line belongs to a paying,
// signed-in customer, and a visitor reading the landing page should not be
// downloading the money screen. Shell is lazy for the same reason, even though
// it is not a page: it is the frame of the app, not of the website.
const Shell    = lazy(() => import('./components/Shell'))
const Today    = lazy(() => import('./pages/Today'))
const Todo     = lazy(() => import('./pages/Todo'))
const Lists    = lazy(() => import('./pages/Lists'))
const Journal  = lazy(() => import('./pages/Journal'))
const Routines = lazy(() => import('./pages/Routines'))
const Projects = lazy(() => import('./pages/Projects'))
const Money    = lazy(() => import('./pages/Money'))
const Markets  = lazy(() => import('./pages/Markets'))
const Settings = lazy(() => import('./pages/Settings'))

// staleTime 30s: this is a planner, not a market feed. Refetching on every
// focus is noise and burns phone battery for data that only changes when the
// person holding the phone types something.
const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

const S = (el: React.ReactNode) => <Suspense fallback={null}>{el}</Suspense>

/**
 * "Not now" on the PIN offer. Remembered FOREVER, not per session — a prompt
 * that comes back is a prompt you learn to dismiss without reading, and the PIN
 * card in Settings is always there for anyone who changes their mind.
 *
 * localStorage is fine for this and only this: it is a UI preference, not a
 * credential. Nothing about auth is stored client-side — the session and the
 * device token are both HttpOnly cookies.
 */
const PIN_SKIP_KEY = 'daily:pin-offer-declined'
const pinOfferDeclined = () => {
  try { return localStorage.getItem(PIN_SKIP_KEY) === '1' } catch { return true }
}
const declinePinOffer = () => {
  try { localStorage.setItem(PIN_SKIP_KEY, '1') } catch { /* private mode — just don't nag this load */ }
}

/**
 * Module scope, so it survives Gate re-rendering on every route change but
 * resets on a real page load. React state can't do this job: Gate re-runs its
 * initialiser whenever it remounts, and a ref would reset with it.
 */
let pinOfferSettledThisLoad = false

/**
 * THERE IS NO SPLASH SCREEN, AND THERE MUST NOT BE ONE.
 *
 * The private app this grew out of opened with a hand-drawn heart held for five
 * seconds. That was a private joke in a private app; it is not a feature, and
 * it is not something to reintroduce here as a logo animation, a
 * fade-in wordmark or a "loading your day" interstitial. Somebody who signs in
 * wants Today, and they want it now — every second of intro is a second charged
 * to a paying customer for nothing. Sign-in lands on Today immediately.
 */

/** Held only while the first /me round-trip settles. Without it, an already
 *  signed-in customer sees the marketing page flash on every cold start. */
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

/**
 * Redirect that keeps the query string.
 *
 * Stripe sends a customer back to a return URL of its own choosing, carrying
 * ?checkout=success. A plain <Navigate to="/paywall"> would drop that parameter
 * on the way past — and the parameter is the entire trigger for the post-payment
 * sync in Paywall. Losing it means somebody who has just been charged lands on a
 * page asking them to pay again.
 */
function KeepQuery({ to }: { to: string }) {
  const { search } = useLocation()
  return <Navigate to={{ pathname: to, search }} replace />
}

/**
 * The gate. Everyone using this app is in exactly one of four worlds, and this
 * is the only place that decides which:
 *
 *   1. Signed out — the marketing site and the account flows.
 *   2. Signed in on a password somebody else has seen — the forced change,
 *      in front of everything, including billing.
 *   3. Signed in without a live subscription — the paywall, plus the routes
 *      needed to fix billing or get out.
 *   4. Signed in and entitled — the app.
 *
 * `user.entitled` is read, never recomputed. The server owns that decision (see
 * api.ts); a second opinion derived from subscription.status in the browser is
 * how a paying customer ends up locked out by a rounding error in somebody's
 * understanding of Stripe.
 */
function Gate() {
  const { user, loading, offline, justSignedIn, clearJustSignedIn } = useAuth()
  // Re-render trigger only; pinOfferSettledThisLoad above is the real source of
  // truth. Declared before any early return, because hooks have to be.
  const [, bump] = useState(0)

  // A fresh sign-in re-opens the PIN offer even if this page load had already
  // settled it. The device PIN belongs to the account rather than to the
  // browser, so signing out and back in — on a borrowed laptop, say — has to
  // get the same offer the first sign-in on this device got.
  useEffect(() => {
    if (!justSignedIn) return
    pinOfferSettledThisLoad = false
    clearJustSignedIn()
    bump((n) => n + 1)
  }, [justSignedIn, clearJustSignedIn])

  if (loading) return <Booting />

  // ── 1. Signed out ──────────────────────────────────────────────────────────
  if (!user) {
    return (
      <>
        {offline && <OfflineNote />}
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/sign-up" element={<SignUp />} />
          <Route path="/forgot" element={<Forgot />} />
          <Route path="/reset" element={<Reset />} />
          <Route path="/verify" element={<Verify />} />
          {/* Terms and privacy are routes in every world, signed in or not.
              Somebody reading the cancellation terms is usually somebody about
              to cancel; making them sign out first is hostile and pointless. */}
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          {/* Any app path asked for by a signed-out browser — a bookmark, a
              home-screen icon, a shared link — becomes a sign-in, not a 404 and
              not the landing page. Landing them on marketing copy when they
              asked for their own grocery list is the wrong answer to a session
              that simply expired. */}
          <Route path="*" element={<Navigate to="/sign-in" replace />} />
        </Routes>
      </>
    )
  }

  // ── 2. A password somebody else has seen ───────────────────────────────────
  // In front of everything, including the paywall: an account whose credentials
  // are known to a third party should be repaired before it is sold to.
  if (user.mustChangePassword) return <ChangePassword />

  // ── 3. Signed in, not paying ───────────────────────────────────────────────
  if (!user.entitled) {
    return (
      <>
        {offline && <OfflineNote />}
        <Routes>
          <Route path="/paywall" element={<Paywall />} />
          {/* Signed in, the pricing page IS the paywall — same plans, plus the
              status of whatever subscription they already had. */}
          <Route path="/pricing" element={<Paywall />} />
          {/* Settings stays open. It holds sign-out, the email address and the
              subscription itself, and locking somebody out of it while their
              card is declined turns a billing problem into an unfixable
              account. */}
          <Route path="/settings" element={S(<Settings />)} />
          {/* Verification links keep working while unpaid — the address is how
              a password reset reaches them. */}
          <Route path="/verify" element={<Verify />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="*" element={<KeepQuery to="/paywall" />} />
        </Routes>
      </>
    )
  }

  // ── 4. The app ─────────────────────────────────────────────────────────────

  // First run. Route-driven rather than an overlay, so /welcome is a real place
  // that can be reloaded and linked to. Onboarding itself blocks nothing — every
  // step in it is skippable.
  if (!user.onboarded) {
    return (
      <Routes>
        <Route path="/welcome" element={<Onboarding />} />
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    )
  }

  // Offered AFTER the first run, never in front of it, and never to a device
  // that already has one. pinOnThisDevice comes from the dy_device cookie via
  // /me, so a second phone gets asked even though the account is the same one.
  const offerPin = !pinOfferSettledThisLoad && !user.pinOnThisDevice && !pinOfferDeclined()
  const closePinOffer = (remember: boolean) => {
    pinOfferSettledThisLoad = true
    if (remember) declinePinOffer()
    bump((n) => n + 1)
  }

  return (
    <>
      {offline && <OfflineNote />}
      {/* Rendered OVER the app rather than instead of it, so Today is already
          mounted and painted behind the offer — dismissing lands on a finished
          screen instead of a spinner. */}
      {offerPin && (
        <SetPin onDone={() => closePinOffer(false)} onSkip={() => closePinOffer(true)} />
      )}
      {S(
        <Shell>
          <Routes>
            {/* The tabbed screens — what Shell's bottom bar points at. */}
            <Route path="/today" element={S(<Today />)} />
            <Route path="/todo" element={S(<Todo />)} />
            <Route path="/lists" element={S(<Lists />)} />
            <Route path="/markets" element={S(<Markets />)} />
            <Route path="/money" element={S(<Money />)} />
            <Route path="/settings" element={S(<Settings />)} />
            {/* No tab of their own — reached from More, and from links on Today. */}
            <Route path="/journal" element={S(<Journal />)} />
            <Route path="/routines" element={S(<Routines />)} />
            <Route path="/projects" element={S(<Projects />)} />
            {/* Onboarding is done; the bookmark somebody kept should not replay it. */}
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/welcome" element={<Navigate to="/today" replace />} />
            <Route path="*" element={<Navigate to="/today" replace />} />
          </Routes>
        </Shell>,
      )}
    </>
  )
}

/**
 * A quiet strip when /me could not be reached at all (status 0 — see auth.tsx).
 * It is not an error dialog and it does not sign anybody out: the app keeps
 * whatever it already had on screen, because a phone that loses signal in a
 * supermarket should still show the list it already loaded.
 */
function OfflineNote() {
  return (
    <div role="status" style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60,
      background: T.paperRaised, borderBottom: `1px solid ${T.rule}`,
      padding: 'max(6px, env(safe-area-inset-top)) 12px 6px',
      textAlign: 'center',
      ...label({ color: T.warn, letterSpacing: '0.1em' }),
    }}>
      Offline — showing what we already had
    </div>
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
