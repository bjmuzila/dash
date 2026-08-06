import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { auth as authApi, ApiError } from '../api'
import { T, card, button, input, labelCap } from '../theme'

export default function Settings() {
  const { user, signOut } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setMsg(null)
    try {
      await authApi.changePassword(current, next)
      setCurrent(''); setNext('')
      setMsg({ kind: 'ok', text: 'Password changed. Other devices were signed out.' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof ApiError ? err.message : 'Something went wrong.' })
    } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section style={card()}>
        <div style={labelCap()}>Account</div>
        <div style={{ marginTop: 10, fontSize: 15, fontWeight: 700 }}>{user?.displayName}</div>
        <div style={{ fontSize: 13, color: T.muted, marginTop: 2 }}>{user?.email}</div>
        <div style={{ fontSize: 12, color: T.muted, opacity: 0.6, marginTop: 8 }}>
          Budget profile: {user?.budgetProfileKey} · {user?.tz}
        </div>
      </section>

      <section style={card()}>
        <div style={labelCap()}>Change password</div>
        <form onSubmit={onSubmit} style={{ marginTop: 12 }}>
          <input style={{ ...input(), marginBottom: 10 }} type="password" placeholder="Current password"
                 value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          <input style={{ ...input(), marginBottom: 12 }} type="password" placeholder="New password (10+ characters)"
                 value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
          {msg && (
            <div style={{
              marginBottom: 12, padding: '10px 12px', borderRadius: 10, fontSize: 14, fontWeight: 600,
              color: msg.kind === 'ok' ? T.green : T.red,
              background: msg.kind === 'ok' ? 'rgba(142,202,230,0.10)' : 'rgba(239,68,68,0.10)',
              border: `1px solid ${msg.kind === 'ok' ? 'rgba(142,202,230,0.35)' : 'rgba(239,68,68,0.35)'}`,
            }}>{msg.text}</div>
          )}
          <button type="submit" disabled={busy} style={{ ...button('primary'), width: '100%', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </form>
      </section>

      <section style={card()}>
        <div style={labelCap()}>Google Calendar</div>
        <div style={{ fontSize: 14, color: T.muted, marginTop: 8, lineHeight: 1.45 }}>
          Connect your own calendar so today's events show on the Today screen. Read-only —
          nothing is ever written back.
        </div>
        <div style={{ fontSize: 12, color: T.muted, opacity: 0.55, marginTop: 10 }}>Not wired up yet.</div>
      </section>

      <button onClick={() => void signOut()} style={{ ...button('ghost'), width: '100%', color: T.red, borderColor: 'rgba(239,68,68,0.35)' }}>
        Sign out
      </button>
    </div>
  )
}
