import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { ApiError } from '../api'
import { T, display, label, button, input, SANS } from '../theme'

/**
 * The sign-in screen.
 *
 * Deliberately says nothing about what this is — no product name, no hint that
 * an account exists behind it. A stranger who lands here learns only that a
 * password is required.
 *
 * No "create account" and no "forgot password", because neither route exists.
 * Resets happen on the box:
 *   docker compose exec dashboard node server-v2/scripts/hh-user.js passwd <email> <new>
 */
export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
      setPassword('')
    } finally { setBusy(false) }
  }

  return (
    <div style={{
      minHeight: '100dvh', background: T.paper, backgroundImage: T.glow, color: T.ink, fontFamily: SANS,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))',
    }}>
      <form onSubmit={onSubmit} style={{ width: '100%', maxWidth: 340 }}>
        <div style={{ marginBottom: 28 }}>
          <div style={label()}>Household</div>
          <h1 style={{ ...display(32), marginTop: 8 }}>Home</h1>
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
      </form>
    </div>
  )
}
