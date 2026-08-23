import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { auth as authApi, ApiError } from '../api'
import PinPad, { pinError } from '../components/PinPad'
import { T, display, label, body, button, input, textAction, SANS, SERIF } from '../theme'

/**
 * Three ways through one door.
 *
 * QUICK SIGN-IN leads, when this browser has been armed. That is decided by the
 * SERVER from the HttpOnly dy_device cookie — not by anything in localStorage —
 * so there is no client-side flag to forge and nothing left behind on a browser
 * that was never armed. Four taps beats typing a password on a phone, and this
 * is a phone app first.
 *
 * EMAIL AND PASSWORD is the fallback, and the only form a stranger ever sees.
 *
 * GOOGLE is a plain <a> and a full-page navigation, never a fetch. The browser
 * has to actually follow the redirect to Google's consent screen; XHR would hit
 * CORS and, if it somehow didn't, would land the consent page inside a JSON
 * parse. Coming back from that round trip is also the only way this screen can
 * be handed an error it didn't generate itself, which is what `?error=` is for.
 */
export default function SignIn() {
  const { signIn, signInWithPin } = useAuth()
  const [params] = useSearchParams()

  // null = still asking the server which form to draw. Rendering nothing for
  // that beat is deliberate: flashing the password form and then swapping it
  // for a keypad looks broken, and the round-trip is one local request.
  const [pinName, setPinName] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const [usePassword, setUsePassword] = useState(false)

  useEffect(() => {
    let alive = true
    authApi.pinStatus()
      // Everyone armed on this browser, not just one. On a shared tablet the
      // pad has to greet both people — the PIN is what picks the account.
      .then((s) => {
        if (!alive || !s.hasPin) return
        setPinName((s.names ?? []).join(' or '))
      })
      .catch(() => { /* unreachable server → password form, which says so */ })
      .finally(() => { if (alive) setChecked(true) })
    return () => { alive = false }
  }, [])

  const showPin = checked && pinName !== null && !usePassword
  const roundTripError = googleError(params.get('error'))

  return (
    <AuthFrame>
      {!checked ? null : showPin ? (
        <PinSignIn
          name={pinName}
          error={roundTripError}
          onPin={signInWithPin}
          // Five wrong guesses (or a device the server no longer knows) burns
          // the row server-side — fall through to the password form rather than
          // leaving a pad up that can no longer succeed.
          onForget={() => { setPinName(null); setUsePassword(true) }}
          onUsePassword={() => setUsePassword(true)}
        />
      ) : (
        <PasswordSignIn
          onSignIn={signIn}
          roundTripError={roundTripError}
          onBackToPin={pinName !== null ? () => setUsePassword(false) : null}
        />
      )}
    </AuthFrame>
  )
}

/**
 * The narrow centred frame every signed-out account screen sits in — sign-in,
 * sign-up, the two token flows, the invite. Exported from here rather than from
 * a shared component file because those are all pages, and this is the page
 * that defines what the shape looks like.
 */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div style={{
      minHeight: '100dvh', background: T.paper, backgroundImage: T.glow,
      color: T.ink, fontFamily: SANS,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))',
    }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <Link to="/" style={{
            fontFamily: SERIF, fontSize: 20, fontWeight: 500, letterSpacing: '-0.015em',
            color: T.ink, textDecoration: 'none',
          }}>
            Daily
          </Link>
        </div>
        {children}
      </div>
    </div>
  )
}

/** The shared one-line error block. Left border rather than a filled box: on
 *  near-black, a red panel behind small text is harder to read than the text
 *  itself, which defeats the point. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" style={{
      ...label({ color: T.bad, letterSpacing: '0.06em' }),
      marginBottom: 18, paddingLeft: 10, borderLeft: `2px solid ${T.bad}`, lineHeight: 1.6,
    }}>
      {children}
    </div>
  )
}

/**
 * The `?error=` codes come back on the redirect from a Google round trip, so
 * this screen has to explain a failure that happened three redirects ago and
 * left no other trace. Anything unrecognised still gets shown WITH its code:
 * "something went wrong" gives a support conversation nothing to work with,
 * whereas a person reading a code back over the phone gives it everything.
 *
 * Sign-in with Google is switched off — accounts here are email and password
 * only — so in normal use the codes that land here come from a CALENDAR link
 * that bounced back to this screen because the session had expired. The
 * disabled case is handled explicitly anyway: somebody with an old bookmark, or
 * a consent screen still open in another tab, deserves a straight answer rather
 * than a bare code.
 */
function googleError(code: string | null): string | null {
  if (!code) return null
  const known: Record<string, string> = {
    google_denied: 'You cancelled at the Google screen. Nothing happened.',
    access_denied: 'You cancelled at the Google screen. Nothing happened.',
    google_failed: 'That didn’t complete. Sign in with your email and password.',
    'google-signin-disabled': 'Daily accounts use an email address and a password. Sign in below — you can link Google Calendar afterwards, in More.',
    'google-unavailable': 'The Google connection isn’t available right now. Signing in with your password still works.',
    no_account: 'No Daily account is linked to that Google address yet. Create one with your email first.',
    state: 'That sign-in attempt expired before it came back. Start it again.',
    expired: 'That sign-in attempt expired before it came back. Start it again.',
  }
  return known[code] || `That didn’t complete (${code}). Sign in with your email and password.`
}

// ── PIN ──────────────────────────────────────────────────────────────────────

function PinSignIn({ name, error: initialError, onPin, onForget, onUsePassword }: {
  name: string
  error: string | null
  onPin: (pin: string) => Promise<void>
  onForget: () => void
  onUsePassword: () => void
}) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
  // A ref, not the `busy` state, guards re-entry: state would have to be in the
  // dep array, and flipping it would re-run this effect mid-flight.
  const sending = useRef(false)
  // Read through a ref so the callbacks can stay out of the dep array — they
  // are inline arrows in the parent and would otherwise change identity on
  // every render and re-trigger the submit.
  const cb = useRef({ onPin, onForget })
  cb.current = { onPin, onForget }

  // Submit on the fourth digit rather than on a button press — a confirm tap
  // for a fixed-length secret is pure ceremony. Driven by the value rather than
  // by the keypad's handler so a physical keyboard behaves identically.
  useEffect(() => {
    if (pin.length !== 4 || sending.current) return
    sending.current = true
    setBusy(true)
    void (async () => {
      try {
        await cb.current.onPin(pin)
        // Success unmounts this screen — nothing to clean up.
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Something went wrong.')
        setPin('')
        // The server forgot this device (five bad guesses, or the row is gone).
        // Hold the message on screen for a beat, then fall back to the password
        // form — a keypad that can no longer succeed is worse than no keypad.
        if (err instanceof ApiError && err.body?.forget) setTimeout(() => cb.current.onForget(), 1600)
      } finally {
        sending.current = false
        setBusy(false)
      }
    })()
  }, [pin])

  return (
    <div>
      <div style={{ marginBottom: 30, textAlign: 'center' }}>
        <div style={label()}>Welcome back</div>
        {/* Two names ride on one line here — step the size down rather than let
            "Brandon or Heather" wrap mid-name. */}
        <h1 style={{ ...display(name.length > 14 ? 23 : 32), marginTop: 8 }}>{name || 'Daily'}</h1>
        <div style={label({ color: T.faint, letterSpacing: '0.08em', marginTop: 10 })}>
          Enter your PIN
        </div>
      </div>

      <PinPad
        value={pin}
        onChange={(v) => { setError(null); setPin(v) }}
        disabled={busy}
        shake={!!error}
      />

      {error && pinError(error)}

      <div style={{ textAlign: 'center', marginTop: 22 }}>
        <button type="button" onClick={onUsePassword} style={textAction()}>
          Use password instead
        </button>
      </div>
    </div>
  )
}

// ── Password ─────────────────────────────────────────────────────────────────

function PasswordSignIn({ onSignIn, onBackToPin, roundTripError }: {
  onSignIn: (email: string, password: string) => Promise<void>
  onBackToPin: (() => void) | null
  roundTripError: string | null
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(roundTripError)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    try {
      await onSignIn(email.trim(), password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
      // Clear the password, keep the email. Retyping an address you already got
      // right is the small indignity that makes a failed sign-in feel punitive.
      setPassword('')
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={onSubmit}>
      <div style={{ marginBottom: 26 }}>
        <div style={label()}>Sign in</div>
        <h1 style={{ ...display(30), marginTop: 8 }}>Welcome back</h1>
      </div>

      <label style={{ display: 'block', marginBottom: 16 }}>
        <div style={label({ marginBottom: 7 })}>Email</div>
        <input style={input()} type="email" value={email}
               onChange={(e) => setEmail(e.target.value)}
               autoComplete="username" autoCapitalize="none" autoCorrect="off"
               spellCheck={false} inputMode="email" required />
      </label>

      <label style={{ display: 'block', marginBottom: 10 }}>
        <div style={label({ marginBottom: 7 })}>Password</div>
        <input style={input()} type="password" value={password}
               onChange={(e) => setPassword(e.target.value)}
               autoComplete="current-password" required />
      </label>

      <div style={{ marginBottom: 20 }}>
        <Link to="/forgot" style={textAction({ color: T.muted })}>Forgot your password?</Link>
      </div>

      {error && <FormError>{error}</FormError>}

      <button type="submit" disabled={busy}
              style={{ ...button('primary'), width: '100%', opacity: busy ? 0.5 : 1 }}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>


      <div style={{ textAlign: 'center', marginTop: 22, ...body(14), color: T.inkSoft }}>
        No account yet? <Link to="/sign-up" style={{ color: T.accent }}>Create one</Link>
      </div>

      {onBackToPin && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button type="button" onClick={onBackToPin} style={textAction()}>
            Use PIN instead
          </button>
        </div>
      )}
    </form>
  )
}
