import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { auth as authApi, ApiError } from '../api'
import { AuthFrame } from './SignIn'
import { T, display, label, body, button, textAction } from '../theme'

type State =
  | { kind: 'working' }
  | { kind: 'done'; already: boolean }
  | { kind: 'failed'; message: string }
  | { kind: 'no-token' }

/**
 * Confirm an email address from a link: /verify?token=…
 *
 * There is nothing to fill in, so this fires on mount and reports what
 * happened. Two details are load-bearing:
 *
 *   1. `fired` guards the call. React's StrictMode runs effects twice in
 *      development, and a verification token is single-use — the second call
 *      would come back "invalid or expired" and this screen would report a
 *      failure for a verification that had just succeeded. A ref, not state,
 *      because the guard has to hold within a single commit.
 *   2. `alreadyVerified` is a success, not an error. Clicking the link twice, or
 *      an email client prefetching it, is normal behaviour and must not be
 *      dressed up as something going wrong.
 */
export default function Verify() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const { user, refresh } = useAuth()
  const [state, setState] = useState<State>(token ? { kind: 'working' } : { kind: 'no-token' })
  const fired = useRef(false)

  useEffect(() => {
    if (!token || fired.current) return
    fired.current = true
    void (async () => {
      try {
        const res = await authApi.verify(token)
        setState({ kind: 'done', already: !!res.alreadyVerified })
        // Re-read /me so a signed-in session picks up emailVerified without a
        // reload — otherwise the app keeps nagging about an address that is now
        // confirmed.
        await refresh()
      } catch (err) {
        setState({
          kind: 'failed',
          message: err instanceof ApiError ? err.message : 'That link could not be checked.',
        })
      }
    })()
  }, [token, refresh])

  const onwards = user ? '/today' : '/sign-in'
  const onwardsLabel = user ? 'Go to Today' : 'Sign in'

  return (
    <AuthFrame>
      <div style={{ marginBottom: 22 }}>
        <div style={label()}>Email</div>
        <h1 style={{ ...display(28), marginTop: 8 }}>
          {state.kind === 'working' ? 'Checking…'
            : state.kind === 'done' ? (state.already ? 'Already confirmed' : 'Confirmed')
            : state.kind === 'no-token' ? 'That link is incomplete'
            : 'That link didn’t work'}
        </h1>

        <p style={{ ...body(15), color: T.inkSoft, marginTop: 12 }}>
          {state.kind === 'working' && 'One moment.'}
          {state.kind === 'done' && (state.already
            ? 'This address was already confirmed — nothing more to do.'
            : 'Your email address is confirmed. That is the address we use for password resets and household invites.')}
          {state.kind === 'no-token' && 'The link didn’t carry its token — some mail apps trim long URLs. Try opening it again from the email.'}
          {state.kind === 'failed' && state.message}
        </p>
      </div>

      {state.kind !== 'working' && (
        <Link to={onwards} style={{
          ...button('primary'), display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '100%', textDecoration: 'none',
        }}>
          {onwardsLabel}
        </Link>
      )}

      {/* Only offered to a signed-in session: resend-verification sends to the
          address on the current account, and there is no account to send to
          when nobody is signed in. */}
      {user && (state.kind === 'failed' || state.kind === 'no-token') && <Resend />}
    </AuthFrame>
  )
}

function Resend() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  if (state === 'sent') {
    return (
      <div style={{ ...label({ color: T.faint, letterSpacing: '0.06em' }), textAlign: 'center', marginTop: 14, lineHeight: 1.6 }}>
        A fresh link is on its way
      </div>
    )
  }

  return (
    <div style={{ textAlign: 'center', marginTop: 10 }}>
      <button
        type="button"
        disabled={state === 'sending'}
        onClick={() => {
          setState('sending')
          authApi.resendVerification()
            .then((r) => setState(r.sent ? 'sent' : 'failed'))
            .catch(() => setState('failed'))
        }}
        style={textAction({ color: state === 'failed' ? T.bad : T.accent })}
      >
        {state === 'sending' ? 'Sending…' : state === 'failed' ? 'Couldn’t send — try again' : 'Send me a new link'}
      </button>
    </div>
  )
}
