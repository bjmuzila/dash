import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { auth as authApi, ApiError } from '../api'
import { AuthFrame, FormError } from './SignIn'
import { T, display, label, body, button, input, textAction } from '../theme'

const MIN_PASSWORD = 10

/**
 * Set a new password from an emailed link: /reset?token=…
 *
 * The token is in the query string because it arrives from an email client,
 * which can only hand us a URL. It is read once, held in memory, and never
 * written anywhere — not localStorage, not a cookie of our own. It is a
 * single-use credential and it should leave no trace after the swap.
 *
 * A successful reset returns the signed-in user, so this hands it straight to
 * the auth context: making somebody type the password they just chose into a
 * sign-in form one second later is ceremony, and worse, it is the moment they
 * discover their typo.
 */
export default function Reset() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const { setUser } = useAuth()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A link that arrived without a token is almost always an email client that
  // mangled it, so say that rather than showing a form that cannot possibly
  // work.
  if (!token) {
    return (
      <AuthFrame>
        <div style={label()}>Reset password</div>
        <h1 style={{ ...display(28), marginTop: 8 }}>That link is incomplete</h1>
        <p style={{ ...body(15), color: T.inkSoft, marginTop: 12 }}>
          The reset link didn't carry its token — some mail apps trim long URLs.
          Try opening it again from the email, or ask for a fresh one.
        </p>
        <div style={{ marginTop: 20 }}>
          <Link to="/forgot" style={{ ...button('primary'), display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', textDecoration: 'none' }}>
            Send a new link
          </Link>
        </div>
      </AuthFrame>
    )
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (password !== confirm) { setError('The two passwords do not match.'); return }
    if (password.length < MIN_PASSWORD) { setError(`Use at least ${MIN_PASSWORD} characters.`); return }
    setBusy(true); setError(null)
    try {
      const { user } = await authApi.reset(token, password)
      // Router-driven, not a redirect: handing the user to the context is what
      // moves this browser into the signed-in world, and the router decides
      // whether that means the app, the paywall or a forced password change.
      setUser(user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally { setBusy(false) }
  }

  return (
    <AuthFrame>
      <form onSubmit={onSubmit}>
        <div style={{ marginBottom: 22 }}>
          <div style={label()}>Reset password</div>
          <h1 style={{ ...display(30), marginTop: 8 }}>Pick a new one</h1>
          <p style={{ ...body(14), color: T.inkSoft, marginTop: 10 }}>
            This signs you in straight away, and signs out anywhere the old password
            was still being used.
          </p>
        </div>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={label({ marginBottom: 7 })}>New password</div>
          <div style={{ ...label({ color: T.faint, letterSpacing: '0.06em' }), marginBottom: 7 }}>
            At least {MIN_PASSWORD} characters
          </div>
          <input style={input()} type="password" value={password}
                 onChange={(e) => setPassword(e.target.value)}
                 autoComplete="new-password" minLength={MIN_PASSWORD} required autoFocus />
        </label>

        <label style={{ display: 'block', marginBottom: 22 }}>
          <div style={label({ marginBottom: 7 })}>Confirm</div>
          <input style={input()} type="password" value={confirm}
                 onChange={(e) => setConfirm(e.target.value)}
                 autoComplete="new-password" required />
        </label>

        {error && <FormError>{error}</FormError>}

        <button type="submit" disabled={busy}
                style={{ ...button('primary'), width: '100%', opacity: busy ? 0.5 : 1 }}>
          {busy ? 'Saving…' : 'Save and sign in'}
        </button>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Link to="/forgot" style={textAction({ color: T.muted })}>Send a fresh link</Link>
        </div>
      </form>
    </AuthFrame>
  )
}
