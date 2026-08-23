import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth'
import { household, ApiError } from '../api'
import { AuthFrame, FormError } from './SignIn'
import { T, display, label, body, section, button, input, textAction } from '../theme'

const MIN_PASSWORD = 10

/**
 * Accept a household invite: /join?token=…
 *
 * The invite is PEEKED before anything is asked for. Somebody who follows a link
 * out of an email should see who invited them and to what before they are shown
 * a password field — a bare form on an unfamiliar domain asking you to choose a
 * password is indistinguishable from a phishing page, and the fix is simply to
 * show them what they already know to be true.
 *
 * Joining does not create a second subscription. The invited person lands inside
 * the household that invited them, on the seat their host is already paying for,
 * which is why this flow never touches billing.
 */
export default function Join() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const { setUser } = useAuth()

  const peek = useQuery({
    queryKey: ['invite', token],
    queryFn: () => household.peekInvite(token),
    enabled: !!token,
    // One shot. A dead invite is dead — retrying makes an already-slow screen
    // slower and does not change the answer.
    retry: false,
  })

  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!token) return <DeadInvite reason="The link didn’t carry its token — some mail apps trim long URLs. Try opening it again from the email." />
  if (peek.isLoading) return <AuthFrame><div style={label({ color: T.faint })}>Checking the invite…</div></AuthFrame>

  // Pulled into a local first, so what follows is narrowed against something
  // that cannot change underneath it — `peek.data` is a property on a query
  // result and reads as optional everywhere it is touched.
  //
  // peekInvite answers 200 with ok:false for an expired, revoked or
  // already-used invite, so a successful request is not the same as a valid
  // invite and both have to be checked.
  const invite = peek.data
  if (peek.isError || !invite || !invite.ok) {
    return (
      <DeadInvite reason={
        invite?.error
        || 'This invite has expired, been revoked, or was already used. Ask whoever sent it to invite you again.'
      } />
    )
  }

  const { householdName, inviterName, email } = invite

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (password.length < MIN_PASSWORD) { setError(`Use at least ${MIN_PASSWORD} characters.`); return }
    setBusy(true); setError(null)
    try {
      const res = await household.join({
        token,
        password,
        displayName: displayName.trim() || undefined,
      })
      // Signed in and inside the household in one step — the router takes it
      // from here.
      setUser(res.user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally { setBusy(false) }
  }

  return (
    <AuthFrame>
      <form onSubmit={onSubmit}>
        <div style={{ marginBottom: 20 }}>
          <div style={label()}>Invitation</div>
          <h1 style={{ ...display(28), marginTop: 8 }}>
            {inviterName ? `${inviterName} invited you` : 'You’ve been invited'}
          </h1>
          <p style={{ ...body(15), color: T.inkSoft, marginTop: 12 }}>
            {householdName
              ? <>Join <strong style={{ fontWeight: 500 }}>{householdName}</strong> on Daily — the same lists, meals, tasks and money, from both of your phones.</>
              : <>Join their household on Daily — the same lists, meals, tasks and money, from both of your phones.</>}
          </p>
        </div>

        <div style={section({ marginBottom: 20, padding: 13 })}>
          <div style={label({ color: T.faint, letterSpacing: '0.08em' })}>Your account</div>
          <div style={{ ...body(15), marginTop: 6, wordBreak: 'break-all' }}>
            {email || 'The address this invite was sent to'}
          </div>
          <div style={{ ...label({ color: T.faint, letterSpacing: '0.06em' }), marginTop: 8, lineHeight: 1.6 }}>
            Nothing to pay — you join the subscription they already have
          </div>
        </div>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={label({ marginBottom: 7 })}>Choose a password</div>
          <div style={{ ...label({ color: T.faint, letterSpacing: '0.06em' }), marginBottom: 7 }}>
            At least {MIN_PASSWORD} characters
          </div>
          <input style={input()} type="password" value={password}
                 onChange={(e) => setPassword(e.target.value)}
                 autoComplete="new-password" minLength={MIN_PASSWORD} required />
        </label>

        <label style={{ display: 'block', marginBottom: 22 }}>
          <div style={label({ marginBottom: 7 })}>Your name</div>
          <input style={input()} type="text" value={displayName}
                 onChange={(e) => setDisplayName(e.target.value)}
                 autoComplete="name"
                 placeholder={inviterName ? `What ${inviterName} calls you` : 'What they call you'} />
        </label>

        {error && <FormError>{error}</FormError>}

        <button type="submit" disabled={busy}
                style={{ ...button('primary'), width: '100%', opacity: busy ? 0.5 : 1 }}>
          {busy ? 'Joining…' : 'Join the household'}
        </button>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Link to="/sign-in" style={textAction({ color: T.muted })}>I already have an account</Link>
        </div>
      </form>
    </AuthFrame>
  )
}

function DeadInvite({ reason }: { reason: string }) {
  return (
    <AuthFrame>
      <div style={{ marginBottom: 22 }}>
        <div style={label()}>Invitation</div>
        <h1 style={{ ...display(28), marginTop: 8 }}>This invite isn’t usable</h1>
        <p style={{ ...body(15), color: T.inkSoft, marginTop: 12 }}>{reason}</p>
      </div>
      <Link to="/" style={{
        ...button('ghost'), display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100%', textDecoration: 'none',
      }}>
        See what Daily is
      </Link>
      <div style={{ textAlign: 'center', marginTop: 10 }}>
        <Link to="/sign-in" style={textAction({ color: T.muted })}>Sign in instead</Link>
      </div>
    </AuthFrame>
  )
}
