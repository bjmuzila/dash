import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { auth as authApi, ApiError } from '../api'
import PinPad, { pinError } from '../components/PinPad'
import { T, display, label, body, textAction, SANS } from '../theme'

/**
 * "Set a 4-digit PIN" — offered once per device, after the first run, and
 * available forever after in Settings.
 *
 * It is an OFFER, not a gate. Skipping costs nothing: the account still works
 * exactly as it did, on the password. Anything that stands between somebody and
 * their grocery list had better be load-bearing, and this isn't.
 *
 * Two steps, choose then confirm, because a mistyped PIN you can't see would
 * otherwise lock the shortcut to a number you don't know. Getting the
 * confirmation wrong sends you back to step one rather than letting you retype
 * the confirmation — if the two didn't match, which one was the typo?
 */
export default function SetPin({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const { user, refresh } = useAuth()
  const [first, setFirst] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sending = useRef(false)
  const cb = useRef({ onDone, refresh })
  cb.current = { onDone, refresh }

  const stage = first === null ? 'choose' : 'confirm'

  useEffect(() => {
    if (pin.length !== 4 || sending.current) return

    if (stage === 'choose') {
      // Reject the obvious ones HERE as well as on the server, so a bad choice
      // is caught before you have typed it twice.
      const weak = /^(\d)\1{3}$/.test(pin) ? 'Pick a PIN that isn’t the same digit four times.'
        : ('0123456789'.includes(pin) || '9876543210'.includes(pin))
          ? 'Pick a PIN that isn’t four digits in a row.' : null
      if (weak) { setError(weak); setPin(''); return }
      setFirst(pin); setPin(''); setError(null)
      return
    }

    if (pin !== first) {
      setError('Those didn’t match. Start again.')
      setFirst(null); setPin('')
      return
    }

    sending.current = true
    setBusy(true)
    void (async () => {
      try {
        await authApi.setPin(pin)
        // Re-read /me so user.pinOnThisDevice flips true and nothing offers
        // this again on the next load.
        await cb.current.refresh()
        cb.current.onDone()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not save your PIN.')
        setFirst(null); setPin('')
      } finally {
        sending.current = false
        setBusy(false)
      }
    })()
  }, [pin, stage, first])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 40,
      background: T.paper, backgroundImage: T.glow, color: T.ink, fontFamily: SANS,
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflowY: 'auto',
      padding: 'max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))',
    }}>
      <div style={{ width: '100%', maxWidth: 340 }}>
        <div style={{ marginBottom: 28, textAlign: 'center' }}>
          <div style={label()}>{stage === 'choose' ? 'Quick sign-in' : 'Once more'}</div>
          <h1 style={{ ...display(28), marginTop: 8 }}>
            {stage === 'choose' ? 'Pick a 4-digit PIN' : 'Confirm your PIN'}
          </h1>
          {stage === 'choose' && (
            <p style={{ ...body(14), color: T.inkSoft, marginTop: 10, lineHeight: 1.5 }}>
              {user?.displayName ? `${user.displayName} — get` : 'Get'} back in with four taps
              instead of your password. It works on this device only.
            </p>
          )}
        </div>

        <PinPad
          value={pin}
          onChange={(v) => { setError(null); setPin(v) }}
          disabled={busy}
          shake={!!error}
        />

        {error && pinError(error)}

        <div style={{ textAlign: 'center', marginTop: 22 }}>
          {stage === 'confirm' ? (
            <button type="button" onClick={() => { setFirst(null); setPin(''); setError(null) }}
                    style={textAction()}>
              Start over
            </button>
          ) : (
            <button type="button" onClick={onSkip} style={textAction({ color: T.muted })}>
              Not now
            </button>
          )}
        </div>

        <div style={{
          ...label({ color: T.faint, letterSpacing: '0.06em' }),
          textAlign: 'center', marginTop: 26, lineHeight: 1.6,
        }}>
          Five wrong PINs and this device asks for your password again
        </div>
      </div>
    </div>
  )
}
