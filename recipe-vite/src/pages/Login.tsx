import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { auth as authApi, ApiError } from '../api'
import PinPad, { pinError } from '../components/PinPad'
import { T, display, label, button, input, textAction, SANS } from '../theme'

/**
 * The sign-in screen. Two forms behind one door.
 *
 * QUICK SIGN-IN
 *   If this browser has been armed (see the PIN section of
 *   server-v2/_lib-household.cjs) we draw a keypad instead of the password
 *   form. That is decided by the SERVER, from the HttpOnly hh_device cookie —
 *   not by anything in localStorage — so there is no client-side flag to forge
 *   and nothing left behind on a browser that was never armed.
 *
 * WHAT A STRANGER SEES
 *   No product name, no hint an account exists, and with no device cookie, no
 *   name either — just a password form. The PIN screen greets you by name only
 *   because reaching it already required a secret cookie issued to this
 *   browser.
 *
 * No "create account" and no "forgot password", because neither route exists.
 * Resets happen on the box:
 *   docker compose exec dashboard node server-v2/scripts/hh-user.js passwd <email> <new>
 */
export default function Login() {
  const { signIn, signInWithPin } = useAuth()

  // null = still asking the server which form to draw. Rendering nothing for
  // that beat is deliberate: flashing the password form and then swapping it
  // for a keypad looks broken, and the round-trip is one local request.
  const [pinName, setPinName] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const [usePassword, setUsePassword] = useState(false)

  useEffect(() => {
    let alive = true
    authApi.pinStatus()
      .then((s) => { if (alive && s.hasPin) setPinName(s.displayName || '') })
      .catch(() => { /* unreachable server → password form, which says so */ })
      .finally(() => { if (alive) setChecked(true) })
    return () => { alive = false }
  }, [])

  const showPin = checked && pinName !== null && !usePassword

  return (
    <Frame>
      {!checked ? null : showPin ? (
        <PinSignIn
          name={pinName}
          onPin={signInWithPin}
          // Five wrong guesses (or a device the server no longer knows) burns
          // the row server-side — fall through to the password form rather than
          // leaving a pad up that can no longer succeed.
          onForget={() => { setPinName(null); setUsePassword(true) }}
          onUsePassword={() => setUsePassword(true)}
        />
      ) : (
        <PasswordSignIn onSignIn={signIn} onBackToPin={pinName !== null ? () => setUsePassword(false) : null} />
      )}
    </Frame>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100dvh', background: T.paper, backgroundImage: T.glow, color: T.ink, fontFamily: SANS,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))',
    }}>
      <div style={{ width: '100%', maxWidth: 340 }}>{children}</div>
    </div>
  )
}

// ── PIN ──────────────────────────────────────────────────────────────────────

function PinSignIn({ name, onPin, onForget, onUsePassword }: {
  name: string
  onPin: (pin: string) => Promise<void>
  onForget: () => void
  onUsePassword: () => void
}) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
        <h1 style={{ ...display(32), marginTop: 8 }}>{name || 'Cookbook'}</h1>
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

function PasswordSignIn({ onSignIn, onBackToPin }: {
  onSignIn: (email: string, password: string) => Promise<void>
  onBackToPin: (() => void) | null
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    try {
      await onSignIn(email.trim(), password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
      setPassword('')
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={onSubmit}>
      <div style={{ marginBottom: 28 }}>
        <div style={label()}>Kitchen</div>
        <h1 style={{ ...display(32), marginTop: 8 }}>Cookbook</h1>
      </div>

      <label style={{ display: 'block', marginBottom: 16 }}>
        <div style={label({ marginBottom: 7 })}>Email</div>
        <input style={input()} type="email" value={email}
               onChange={(e) => setEmail(e.target.value)}
               autoComplete="username" autoCapitalize="none" autoCorrect="off"
               spellCheck={false} inputMode="email" required />
      </label>

      <label style={{ display: 'block', marginBottom: 22 }}>
        <div style={label({ marginBottom: 7 })}>Password</div>
        <input style={input()} type="password" value={password}
               onChange={(e) => setPassword(e.target.value)}
               autoComplete="current-password" required />
      </label>

      {error && (
        <div role="alert" style={{
          ...label({ color: T.bad, letterSpacing: '0.06em' }),
          marginBottom: 18, paddingLeft: 10, borderLeft: `2px solid ${T.bad}`,
        }}>
          {error}
        </div>
      )}

      <button type="submit" disabled={busy}
              style={{ ...button('primary'), width: '100%', opacity: busy ? 0.5 : 1 }}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      {onBackToPin && (
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button type="button" onClick={onBackToPin} style={textAction()}>
            Use PIN instead
          </button>
        </div>
      )}
    </form>
  )
}
