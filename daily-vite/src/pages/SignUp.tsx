import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { auth as authApi, billing, ApiError, type Plan } from '../api'
import { AuthFrame, FormError } from './SignIn'
import { PlanChoice } from './Pricing'
import { T, display, label, body, section, button, input, textAction } from '../theme'

/** The only password rule, and it is a length. Said BEFORE the field, because a
 *  rule you learn by failing a submit is a rule that cost you a password you had
 *  already decided on. */
const MIN_PASSWORD = 10

/**
 * Create an account, then pay for it. Two steps on one screen.
 *
 * The order matters and is not negotiable: the account exists before checkout
 * does, because Stripe needs something to attach a subscription to and because
 * an abandoned checkout must leave behind a real account someone can come back
 * and finish from — not a dangling Stripe customer with no way to sign in.
 *
 * DELIBERATELY, the new user is NOT pushed into the auth context after signup.
 * The signup response already set the session cookie, so they are signed in as
 * far as the server is concerned — but calling setUser here would swap the
 * router into the signed-in-but-unpaid world and unmount this component in the
 * middle of choosing a plan. Leaving the context alone keeps the flow on one
 * screen. If they wander off and come back, the visibility re-check in auth.tsx
 * picks the session up and lands them on the paywall, which offers exactly the
 * same plans — so there is no way to get stranded, only a longer route.
 */
export default function SignUp() {
  // The address, carried forward only so step two can say whose account it just
  // made. Nothing else about the new account is kept in component state — the
  // session cookie is the account, and the server is the only thing holding it.
  const [email, setEmail] = useState<string | null>(null)

  return (
    <AuthFrame>
      {email ? <ChoosePlan email={email} /> : <CreateAccount onDone={setEmail} />}
    </AuthFrame>
  )
}

// ── Step 1: the account ──────────────────────────────────────────────────────

function CreateAccount({ onDone }: { onDone: (email: string) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`)
      return
    }
    setBusy(true); setError(null)
    try {
      const res = await authApi.signup({
        email: email.trim(),
        password,
        displayName: displayName.trim() || undefined,
        // The browser's own zone, sent once at signup so the very first Today
        // screen already rolls over at the right midnight. Guessing UTC and
        // fixing it in Settings later means a new customer's first impression is
        // a day that ends at 7pm.
        tz: guessTimezone(),
      })
      // needsCheckout is the server telling us this account has nothing to bill
      // against yet. It is false only for an account that somehow arrived
      // entitled already, in which case there is no plan to pick — reload and
      // let the router put them wherever they belong.
      if (res.needsCheckout) onDone(email.trim())
      else window.location.assign('/today')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={onSubmit}>
      <div style={{ marginBottom: 24 }}>
        <div style={label()}>Step 1 of 2</div>
        <h1 style={{ ...display(30), marginTop: 8 }}>Create your account</h1>
        <p style={{ ...body(14), color: T.inkSoft, marginTop: 10 }}>
          Then pick a plan. A card is required — Daily has no free tier.
        </p>
      </div>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <div style={label({ marginBottom: 7 })}>Email</div>
        <input style={input()} type="email" value={email}
               onChange={(e) => setEmail(e.target.value)}
               autoComplete="email" autoCapitalize="none" autoCorrect="off"
               spellCheck={false} inputMode="email" required />
      </label>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <div style={label({ marginBottom: 7 })}>Password</div>
        {/* Above the input, not below it. */}
        <div style={{ ...label({ color: T.faint, letterSpacing: '0.06em' }), marginBottom: 7 }}>
          At least {MIN_PASSWORD} characters — that's the only rule
        </div>
        <input style={input()} type="password" value={password}
               onChange={(e) => setPassword(e.target.value)}
               autoComplete="new-password" minLength={MIN_PASSWORD} required />
      </label>

      <label style={{ display: 'block', marginBottom: 22 }}>
        <div style={label({ marginBottom: 7 })}>Your name</div>
        <input style={input()} type="text" value={displayName}
               onChange={(e) => setDisplayName(e.target.value)}
               autoComplete="name" placeholder="What we should call you" />
      </label>

      {error && <FormError>{error}</FormError>}

      <button type="submit" disabled={busy}
              style={{ ...button('primary'), width: '100%', opacity: busy ? 0.5 : 1 }}>
        {busy ? 'Creating…' : 'Continue to plans'}
      </button>


      <div style={{ textAlign: 'center', marginTop: 22, ...body(14), color: T.inkSoft }}>
        Already have an account? <Link to="/sign-in" style={{ color: T.accent }}>Sign in</Link>
      </div>
      <div style={{ textAlign: 'center', marginTop: 4 }}>
        <Link to="/pricing" style={textAction({ color: T.muted })}>See the plans first</Link>
      </div>
    </form>
  )
}

/** Falls back to an empty string rather than a guess: the server has its own
 *  default, and a confidently wrong zone is worse than none. */
function guessTimezone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined } catch { return undefined }
}

// ── Step 2: the plan ─────────────────────────────────────────────────────────

function ChoosePlan({ email }: { email: string }) {
  const q = useQuery({ queryKey: ['plans'], queryFn: () => billing.plans() })
  const [busy, setBusy] = useState<Plan['id'] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const choose = async (plan: Plan['id']) => {
    if (busy) return
    setBusy(plan); setError(null)
    try {
      const { url } = await billing.checkout(plan)
      // A full-page navigation to a Stripe-hosted page. Not a fetch, not an
      // iframe: the card form has to be on Stripe's own origin, which is most of
      // what keeps card numbers out of this app entirely.
      window.location.assign(url)
      // Deliberately no setBusy(null) after this — the navigation is already in
      // flight and re-enabling the buttons would invite a second checkout
      // session in the half-second before the page changes.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open checkout.')
      setBusy(null)
    }
  }

  const plans = q.data?.plans ?? []

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <div style={label()}>Step 2 of 2</div>
        <h1 style={{ ...display(30), marginTop: 8 }}>Pick a plan</h1>
        <p style={{ ...body(14), color: T.inkSoft, marginTop: 10 }}>
          Your account is created — you're signed in as {email}. Payment happens on
          Stripe's own page.
        </p>
      </div>

      {q.isLoading && <div style={label({ color: T.faint })}>Loading plans…</div>}

      {!q.isLoading && !plans.length && (
        <div style={section()}>
          <div style={label()}>Plans unavailable</div>
          <p style={{ ...body(14), color: T.inkSoft, marginTop: 8 }}>
            Your account is safe and you're signed in. Reload this page to try again,
            or sign in later and finish from the billing screen.
          </p>
        </div>
      )}

      {error && <div style={{ marginTop: 16 }}><FormError>{error}</FormError></div>}

      {/* The same cards as the pricing page and the paywall, so the price
          somebody decided on three screens ago is rendered by the same code
          that renders the one they are about to be charged. At 360px the
          shared auto-fit grid resolves to a single column on its own. */}
      {!!plans.length && (
        <div style={{ marginTop: 4 }}>
          <PlanChoice plans={plans} busy={busy} onChoose={choose} />
        </div>
      )}

      <div style={{ ...label({ color: T.faint, letterSpacing: '0.06em' }), marginTop: 22, lineHeight: 1.7 }}>
        Cancel any time from Settings · Every screen on both plans
      </div>
    </div>
  )
}
