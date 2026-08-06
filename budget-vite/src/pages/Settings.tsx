import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { auth as authApi, ApiError } from '../api'
import { useSettings, useSaveSettings, useNotes, useCreateNote, useDeleteNote } from '../hooks'
import { T, card, button, input, labelCap } from '../theme'

export default function Settings() {
  const { user, signOut } = useAuth()

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

      <SlippingSetting />
      <SavedNotes />
      <ChangePasswordCard />

      <section style={card()}>
        <div style={labelCap()}>Google Calendar</div>
        <div style={{ fontSize: 14, color: T.muted, marginTop: 8, lineHeight: 1.45 }}>
          Connect your own calendar so today's events show on the Today screen. Read-only —
          nothing is ever written back.
        </div>
        <div style={{ fontSize: 12, color: T.muted, opacity: 0.55, marginTop: 10 }}>Not wired up yet.</div>
      </section>

      <button onClick={() => void signOut()}
              style={{ ...button('ghost'), width: '100%', color: T.red, borderColor: 'rgba(239,68,68,0.35)' }}>
        Sign out
      </button>
    </div>
  )
}

// ── Slipping threshold ───────────────────────────────────────────────────────

function SlippingSetting() {
  const { data } = useSettings()
  const save = useSaveSettings()
  const [days, setDays] = useState('')

  // Seeded from the server once it arrives, then left alone so typing isn't
  // clobbered by a background refetch.
  useEffect(() => {
    if (data && days === '') setDays(String(data.settings.slippingDays))
  }, [data, days])

  const n = Number(days)
  const valid = Number.isInteger(n) && n >= 1 && n <= 365
  const changed = data && valid && n !== data.settings.slippingDays

  return (
    <section style={card()}>
      <div style={labelCap()}>Slipping threshold</div>
      <div style={{ fontSize: 14, color: T.muted, marginTop: 8, lineHeight: 1.45 }}>
        Flag an open task on Today once it's gone untouched this many days. Yours only —
        it doesn't change anyone else's.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <input
          type="number" min={1} max={365} inputMode="numeric"
          value={days} onChange={(e) => setDays(e.target.value)}
          style={{ ...input(), width: 100, flex: 'none' }}
        />
        <span style={{ fontSize: 14, color: T.muted }}>days</span>
        <button
          onClick={() => valid && save.mutate({ slippingDays: n })}
          disabled={!changed || save.isPending}
          style={{ ...button('primary'), marginLeft: 'auto', opacity: changed ? 1 : 0.4 }}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {days !== '' && !valid && (
        <div style={{ color: T.red, fontSize: 13, fontWeight: 600, marginTop: 8 }}>
          Pick a whole number between 1 and 365.
        </div>
      )}
    </section>
  )
}

// ── Saved notes (the Resurfacing pool) ───────────────────────────────────────

function SavedNotes() {
  const { user } = useAuth()
  const { data } = useNotes()
  const create = useCreateNote()
  const del = useDeleteNote()
  const [body, setBody] = useState('')
  const [shared, setShared] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = body.trim()
    if (!t || create.isPending) return
    setBody('')
    try { await create.mutateAsync({ body: t, visibility: shared ? 'shared' : 'private' }) }
    catch { setBody(t) }
  }

  const list = data?.notes ?? []

  return (
    <section style={card()}>
      <div style={labelCap()}>Saved notes</div>
      <div style={{ fontSize: 14, color: T.muted, marginTop: 8, lineHeight: 1.45 }}>
        Quotes, reminders, anything worth seeing again. Today surfaces one a day, rotating.
      </div>

      <form onSubmit={submit} style={{ marginTop: 12 }}>
        <textarea
          value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="Something worth remembering…"
          rows={3}
          style={{ ...input(), resize: 'vertical', minHeight: 72, lineHeight: 1.45 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <button
            type="button" onClick={() => setShared((v) => !v)}
            style={{
              appearance: 'none', minHeight: 38, padding: '8px 13px', borderRadius: 9,
              fontSize: 13, fontWeight: 700, cursor: 'pointer', color: T.text,
              background: shared ? 'rgba(33,158,188,0.18)' : 'transparent',
              border: `1px solid ${shared ? 'rgba(33,158,188,0.5)' : T.hairline}`,
            }}
          >
            {shared ? '✓ Shared' : 'Private'}
          </button>
          <button type="submit" disabled={!body.trim() || create.isPending}
                  style={{ ...button('primary'), marginLeft: 'auto', opacity: body.trim() ? 1 : 0.4 }}>
            Save
          </button>
        </div>
      </form>

      {list.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {list.map((nt) => (
            <div key={nt.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '10px 0', borderTop: `1px solid ${T.border}`,
            }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.45, wordBreak: 'break-word' }}>
                {nt.body}
                {nt.visibility === 'shared' && (
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', color: T.cyan, marginLeft: 8 }}>
                    SHARED
                  </span>
                )}
              </div>
              {nt.owner_id === user?.id && (
                <button onClick={() => del.mutate(nt.id)} aria-label="Delete note"
                        style={{ flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer',
                                 color: T.muted, fontSize: 18, lineHeight: 1, padding: '0 4px', minHeight: 32 }}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Password ─────────────────────────────────────────────────────────────────

function ChangePasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setMsg(null)
    try {
      await authApi.changePassword(current, next)
      setCurrent(''); setNext('')
      setMsg({ kind: 'ok', text: 'Password changed. Other devices were signed out.' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof ApiError ? err.message : 'Something went wrong.' })
    } finally { setBusy(false) }
  }

  return (
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
  )
}
