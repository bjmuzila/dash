import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth'
import { auth as authApi, settings as settingsApi, money, ApiError, type AccountKind } from '../api'
import { T, display, label, body, section, button, input, textAction, SANS } from '../theme'

/**
 * First run, at /welcome. Three small things that make the app better, and not
 * one of them is required.
 *
 * The governing rule: NOTHING HERE BLOCKS. A household with no ZIP, no calendar
 * and no bank accounts is a completely usable app — Today still shows the day,
 * lists still work, tasks still work. Every step has a Skip that costs nothing
 * and every one of them can be done later in Settings. An onboarding flow that
 * holds the product hostage until you have connected your Google account is how
 * you lose somebody who has already paid.
 *
 * Where the flow resumes is computed rather than remembered, because step two is
 * a FULL-PAGE trip to Google's consent screen: the browser leaves this app
 * entirely and comes back to a fresh mount with all component state gone. Asking
 * a person to retype the ZIP they just saved — or worse, to connect the calendar
 * they just connected — would read as the connection having failed.
 */
export default function Onboarding() {
  const { user, setUser } = useAuth()
  const navigate = useNavigate()

  const s = useQuery({ queryKey: ['settings'], queryFn: () => settingsApi.get() })
  const [override, setOverride] = useState<number | null>(null)

  // Derived from what the account already has, so a return trip from Google
  // resumes where it left off. An outright failure to read settings falls back
  // to step one, which is harmless: the worst case is re-entering a ZIP.
  const derived = !s.data ? 0
    : !s.data.settings.weatherZip ? 0
    : user?.googleEmail ? 2
    : 1
  const step = override ?? derived

  /**
   * Marks the first run finished.
   *
   * The flag is persisted server-side rather than kept in memory or in
   * localStorage, and it has to be: step two of this flow navigates away to
   * Google's consent screen, so anything held in the tab is gone by the time
   * the person comes back — they would land straight back on step one having
   * just completed step two.
   *
   * The local `setUser` happens first so the navigation is instant. If the
   * write fails we still let them through: being sent through onboarding twice
   * is a small annoyance, and blocking someone out of the app they just paid
   * for over a bookkeeping flag is not.
   */
  const finish = () => {
    if (user) setUser({ ...user, onboarded: true })
    navigate('/today', { replace: true })
    void authApi.completeOnboarding().catch(() => { /* see above */ })
  }

  return (
    <div style={{
      minHeight: '100dvh', background: T.paper, backgroundImage: T.glow,
      color: T.ink, fontFamily: SANS,
      padding: 'max(28px, env(safe-area-inset-top)) 22px max(28px, env(safe-area-inset-bottom))',
    }}>
      <div style={{ width: '100%', maxWidth: 460, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <div style={label()}>
            {step >= 3 ? 'All set' : `Step ${step + 1} of 3 — skip any of them`}
          </div>
          <h1 style={{ ...display(30), marginTop: 8 }}>
            {step >= 3
              ? `You're ready${user?.displayName ? `, ${user.displayName}` : ''}.`
              : 'Three quick things'}
          </h1>
          <Progress step={step} />
        </div>

        {s.isLoading && override === null
          ? <div style={label({ color: T.faint })}>One moment…</div>
          : step === 0 ? <ZipStep onNext={() => setOverride(1)} />
          : step === 1 ? <CalendarStep connected={user?.googleEmail ?? null} onNext={() => setOverride(2)} />
          : step === 2 ? <AccountStep onNext={() => setOverride(3)} />
          : <DoneStep onStart={finish} />}

        {step < 3 && (
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <button type="button" onClick={finish} style={textAction({ color: T.faint })}>
              Skip all of this — take me to Today
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Three hairlines, filled as you go. Not a percentage — three steps do not
 *  need a number, they need a shape you can count at a glance. */
function Progress({ step }: { step: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          flex: 1, height: 3, borderRadius: 2,
          background: i <= step - 1 || step >= 3 ? T.accent : i === step ? T.ink : T.paperSunk,
          transition: 'background 160ms',
        }} />
      ))}
    </div>
  )
}

// ── 1. Weather ───────────────────────────────────────────────────────────────

function ZipStep({ onNext }: { onNext: () => void }) {
  const [zip, setZip] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    try {
      await settingsApi.save({ weatherZip: zip.trim() })
      onNext()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} style={section()}>
      <div style={label()}>Weather</div>
      <h2 style={{ ...display(21), marginTop: 8 }}>Where are you?</h2>
      <p style={{ ...body(15), color: T.inkSoft, marginTop: 8 }}>
        A US ZIP puts today's weather on your Today screen. Leave it out and that
        tile simply stays quiet — nothing else changes.
      </p>

      <div style={{ marginTop: 14 }}>
        <input
          style={{ ...input(), maxWidth: 160 }}
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="ZIP"
          aria-label="ZIP code"
        />
      </div>

      {error && <div style={{ ...label({ color: T.bad, letterSpacing: '0.06em' }), marginTop: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <button type="submit" disabled={busy || zip.length < 5}
                style={{ ...button('primary'), opacity: busy || zip.length < 5 ? 0.45 : 1 }}>
          {busy ? 'Saving…' : 'Save and continue'}
        </button>
        <button type="button" onClick={onNext} style={button('ghost')}>Skip</button>
      </div>
    </form>
  )
}

// ── 2. Calendar ──────────────────────────────────────────────────────────────

function CalendarStep({ connected, onNext }: { connected: string | null; onNext: () => void }) {
  return (
    <div style={section()}>
      <div style={label()}>Calendar</div>
      <h2 style={{ ...display(21), marginTop: 8 }}>
        {connected ? 'Calendar connected' : 'Bring your calendar in'}
      </h2>
      <p style={{ ...body(15), color: T.inkSoft, marginTop: 8 }}>
        {connected
          ? `Today will show what's on ${connected}. You can choose which calendars count, and whether to share them with the other person in your household, in Settings.`
          : 'Today can show what’s on your Google Calendar next to your tasks, so the day is one list instead of two apps. Read-only unless you add an event yourself.'}
      </p>

      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        {connected ? (
          <button type="button" onClick={onNext} style={button('primary')}>Continue</button>
        ) : (
          <>
            {/* A plain <a> and a real page navigation. Google's consent screen
                cannot be fetched, framed or XHR'd — the browser has to go there,
                and the server sends it back here when it's done. */}
            <a href={authApi.googleConnectUrl} style={{
              ...button('primary'), display: 'inline-flex', alignItems: 'center',
              justifyContent: 'center', textDecoration: 'none',
            }}>
              Connect Google Calendar
            </a>
            <button type="button" onClick={onNext} style={button('ghost')}>Skip</button>
          </>
        )}
      </div>
    </div>
  )
}

// ── 3. Money ─────────────────────────────────────────────────────────────────

const KINDS: { id: AccountKind; name: string }[] = [
  { id: 'checking', name: 'Checking' },
  { id: 'savings', name: 'Savings' },
  { id: 'credit', name: 'Credit card' },
  { id: 'cash', name: 'Cash' },
]

function AccountStep({ onNext }: { onNext: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('checking')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    try {
      await money.createAccount({ name: name.trim(), kind })
      onNext()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create that account.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={create} style={section()}>
      <div style={label()}>Money</div>
      <h2 style={{ ...display(21), marginTop: 8 }}>One account to start</h2>
      <p style={{ ...body(15), color: T.inkSoft, marginTop: 8 }}>
        The money screen needs somewhere to put a balance. Name it whatever you call
        it out loud — "Joint", "Chase", "the good one". You can add the rest later,
        and nothing here connects to a bank.
      </p>

      <div style={{ marginTop: 14 }}>
        <div style={label({ marginBottom: 7 })}>Account name</div>
        <input style={input()} value={name} onChange={(e) => setName(e.target.value)}
               placeholder="Joint checking" aria-label="Account name" />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={label({ marginBottom: 7 })}>Kind</div>
        <select style={input()} value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}
                aria-label="Account kind">
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </div>

      {error && <div style={{ ...label({ color: T.bad, letterSpacing: '0.06em' }), marginTop: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <button type="submit" disabled={busy || !name.trim()}
                style={{ ...button('primary'), opacity: busy || !name.trim() ? 0.45 : 1 }}>
          {busy ? 'Creating…' : 'Create and continue'}
        </button>
        <button type="button" onClick={onNext} style={button('ghost')}>Skip</button>
      </div>
    </form>
  )
}

// ── Done ─────────────────────────────────────────────────────────────────────

function DoneStep({ onStart }: { onStart: () => void }) {
  return (
    <div style={section()}>
      <p style={{ ...body(16), color: T.inkSoft, margin: 0 }}>
        Everything else lives in the app: invite the other person from Settings,
        add tasks from Today, plan the week's meals from Lists. Anything you
        skipped is waiting for you in Settings whenever you want it.
      </p>
      <button type="button" onClick={onStart} style={{ ...button('primary'), width: '100%', marginTop: 18 }}>
        Start
      </button>
    </div>
  )
}
