import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { auth as authApi, ApiError } from '../api'
import { T, display, label, button, input, body, SANS } from '../theme'

/**
 * Forced password change. Shown instead of the app whenever the account still
 * carries must_change_password — i.e. it is still on the generated password
 * printed in a terminal. Changing it signs every other device out, so a
 * password that was pasted into a chat stops being a way in.
 */
export default function ChangePassword() {
  const { user, refresh, signOut } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (next !== confirm) { setError('The two new passwords do not match.'); return }
    if (next.length < 10) { setError('Use at least 10 characters.'); return }
    setBusy(true); setError(null)
    try {
      await authApi.changePassword(current, next)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally { setBusy(false) }
  }

  return (
    <div style={{
      minHeight: '100dvh', background: T.paper, backgroundImage: T.glow, color: T.ink, fontFamily: SANS,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))',
    }}>
      <form onSubmit={onSubmit} style={{ width: '100%', maxWidth: 340 }}>
        <div style={{ marginBottom: 24 }}>
          <div style={label()}>First sign-in</div>
          <h1 style={{ ...display(28), marginTop: 8 }}>Pick a password</h1>
          <p style={{ ...body(14), color: T.inkSoft, marginTop: 10 }}>
            Hi {user?.displayName}. You're still on the temporary password. Choose your own
            to continue — this signs you out everywhere else.
          </p>
        </div>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={label({ marginBottom: 7 })}>Temporary password</div>
          <input style={input()} type="password" value={current}
                 onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={label({ marginBottom: 7 })}>New password</div>
          <input style={input()} type="password" value={next}
                 onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
          <div style={label({ marginTop: 7, letterSpacing: '0.06em' })}>At least 10 characters</div>
        </label>
        <label style={{ display: 'block', marginBottom: 22 }}>
          <div style={label({ marginBottom: 7 })}>Confirm</div>
          <input style={input()} type="password" value={confirm}
                 onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </label>

        {error && (
          <div role="alert" style={{
            ...label({ color: T.bad, letterSpacing: '0.06em' }),
            marginBottom: 18, paddingLeft: 10, borderLeft: `2px solid ${T.bad}`,
          }}>{error}</div>
        )}

        <button type="submit" disabled={busy}
                style={{ ...button('primary'), width: '100%', opacity: busy ? 0.5 : 1 }}>
          {busy ? 'Saving…' : 'Save and continue'}
        </button>
        <button type="button" onClick={() => void signOut()}
                style={{ ...button('ghost'), width: '100%', marginTop: 10, color: T.muted }}>
          Sign out
        </button>
      </form>
    </div>
  )
}
