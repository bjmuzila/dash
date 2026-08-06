import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { ApiError } from '../api'
import { T, card, button, input, labelCap, FONT, SHELL_GLOW } from '../theme'

/**
 * The sign-in screen at budget.cbedge.net.
 *
 * Deliberately says nothing about what this is. No product name, no "CB Edge",
 * no hint that an account exists behind it — a stranger who lands here learns
 * only that a password is required.
 *
 * There is no "create account" and no "forgot password" link, because there is
 * no route behind either. Password resets happen on the box:
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
    setBusy(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
      // On success the provider swaps this screen out — nothing to do here.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: T.ink,
        backgroundImage: SHELL_GLOW,
        color: T.text,
        fontFamily: FONT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Respect the iPhone notch/home indicator.
        padding: 'max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom))',
      }}
    >
      <form onSubmit={onSubmit} style={card({ width: '100%', maxWidth: 380, padding: 24 })}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: '0.02em' }}>Home</div>
          <div style={{ ...labelCap({ marginTop: 6, opacity: 0.7 }) }}>Sign in</div>
        </div>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={labelCap({ marginBottom: 6 })}>Email</div>
          <input
            style={input()}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            required
          />
        </label>

        <label style={{ display: 'block', marginBottom: 20 }}>
          <div style={labelCap({ marginBottom: 6 })}>Password</div>
          <input
            style={input()}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: '10px 12px',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              color: T.red,
              background: 'rgba(239,68,68,0.10)',
              border: '1px solid rgba(239,68,68,0.35)',
            }}
          >
            {error}
          </div>
        )}

        <button type="submit" disabled={busy} style={{ ...button('primary'), width: '100%', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
