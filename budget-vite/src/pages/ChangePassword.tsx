import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { auth as authApi, ApiError } from '../api'
import { T, card, button, input, labelCap, FONT, SHELL_GLOW } from '../theme'

/**
 * Forced password change. Shown instead of the app whenever the account still
 * carries must_change_password — i.e. it is still on the generated password
 * that was printed in a terminal. Changing it also signs every other device
 * out, so a password that was pasted into a chat stops being a way in.
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
    setBusy(true)
    setError(null)
    try {
      await authApi.changePassword(current, next)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
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
        padding: 'max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom))',
      }}
    >
      <form onSubmit={onSubmit} style={card({ width: '100%', maxWidth: 380, padding: 24 })}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 900 }}>Pick a password</div>
          <div style={{ fontSize: 14, color: T.muted, marginTop: 6, lineHeight: 1.45 }}>
            Hi {user?.displayName}. You're still on the temporary password. Choose your own
            to continue — this signs you out everywhere else.
          </div>
        </div>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={labelCap({ marginBottom: 6 })}>Temporary password</div>
          <input style={input()} type="password" value={current}
                 onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={labelCap({ marginBottom: 6 })}>New password</div>
          <input style={input()} type="password" value={next}
                 onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
          <div style={{ fontSize: 12, color: T.muted, marginTop: 6 }}>At least 10 characters.</div>
        </label>

        <label style={{ display: 'block', marginBottom: 20 }}>
          <div style={labelCap({ marginBottom: 6 })}>Confirm new password</div>
          <input style={input()} type="password" value={confirm}
                 onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </label>

        {error && (
          <div role="alert" style={{
            marginBottom: 16, padding: '10px 12px', borderRadius: 10, fontSize: 14, fontWeight: 600,
            color: T.red, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.35)',
          }}>{error}</div>
        )}

        <button type="submit" disabled={busy} style={{ ...button('primary'), width: '100%', opacity: busy ? 0.6 : 1 }}>
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
