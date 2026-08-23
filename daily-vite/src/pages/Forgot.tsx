import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { auth as authApi, ApiError } from '../api'
import { AuthFrame, FormError } from './SignIn'
import { T, display, label, body, button, input, textAction } from '../theme'

/**
 * Ask for a reset link.
 *
 * THE CONFIRMATION IS THE SAME WHETHER OR NOT THE ADDRESS EXISTS. That is not
 * an oversight and it is not a missing feature — please do not "fix" it.
 *
 * The server answers /auth/forgot identically for a known and an unknown
 * address on purpose. If this screen said "no account with that email", the
 * form would become a free tool for checking whether any given person has a
 * Daily account, which is exactly the kind of question a stranger should not be
 * able to ask about somebody's household app. The cost is one confused person
 * who typed their address wrong; the alternative cost is everybody's membership
 * being publicly enumerable. The wording below is written to take the sting out
 * of that trade: it says "if there is an account", so a typo still has an
 * explanation on screen.
 *
 * The only failure this screen shows is a transport failure — a request that
 * never landed. Anything the server actually answered is a success here.
 */
export default function Forgot() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    try {
      await authApi.forgot(email.trim())
      setSent(true)
    } catch (err) {
      // Rate limiting and "we couldn't reach the server" are the only things
      // worth surfacing. Both are about the request, not about the account.
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally { setBusy(false) }
  }

  if (sent) {
    return (
      <AuthFrame>
        <div style={{ marginBottom: 20 }}>
          <div style={label()}>Check your email</div>
          <h1 style={{ ...display(28), marginTop: 8 }}>On its way</h1>
          <p style={{ ...body(15), color: T.inkSoft, marginTop: 12 }}>
            If there's an account for <strong style={{ fontWeight: 500 }}>{email.trim()}</strong>,
            a reset link is in your inbox. It's good for one use and expires before
            long, so use it while you're here.
          </p>
          <p style={{ ...body(14), color: T.faint, marginTop: 10 }}>
            Nothing yet? Check spam, then try again — and check the address for typos
            while you're at it.
          </p>
        </div>
        <Link to="/sign-in" style={{ ...button('ghost'), display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', textDecoration: 'none' }}>
          Back to sign in
        </Link>
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <button type="button" onClick={() => setSent(false)} style={textAction({ color: T.muted })}>
            Use a different address
          </button>
        </div>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame>
      <form onSubmit={onSubmit}>
        <div style={{ marginBottom: 22 }}>
          <div style={label()}>Password</div>
          <h1 style={{ ...display(30), marginTop: 8 }}>Reset it</h1>
          <p style={{ ...body(14), color: T.inkSoft, marginTop: 10 }}>
            Tell us the address on the account and we'll send a link to set a new
            password.
          </p>
        </div>

        <label style={{ display: 'block', marginBottom: 22 }}>
          <div style={label({ marginBottom: 7 })}>Email</div>
          <input style={input()} type="email" value={email}
                 onChange={(e) => setEmail(e.target.value)}
                 autoComplete="username" autoCapitalize="none" autoCorrect="off"
                 spellCheck={false} inputMode="email" required autoFocus />
        </label>

        {error && <FormError>{error}</FormError>}

        <button type="submit" disabled={busy}
                style={{ ...button('primary'), width: '100%', opacity: busy ? 0.5 : 1 }}>
          {busy ? 'Sending…' : 'Send the link'}
        </button>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Link to="/sign-in" style={textAction({ color: T.muted })}>Back to sign in</Link>
        </div>
      </form>
    </AuthFrame>
  )
}
