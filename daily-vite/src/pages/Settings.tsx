import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth'
import {
  ApiError, auth as authApi, billing, calendar as calendarApi,
  settings as settingsApi,
  type BillingStatus, type GoogleCalendar, type SubStatus,
} from '../api'
import { T, label, body, section, input, button, segment, textAction } from '../theme'
import Collapsible from '../components/Collapsible'
import PinPad from '../components/PinPad'

/**
 * Settings — the "More" tab.
 *
 * The private version of this page answered one question: what do I want the app
 * to do? This one also has to answer the questions a customer asks — am I paying,
 * what happens if my card fails, how do I get out. Those belong on the same
 * screen as the weather ZIP, because a person looking for them looks under
 * Settings and nowhere else.
 *
 * The rule that runs through the whole file: state is described in plain words,
 * never in Stripe's. "past_due" means nothing to anybody; "your card was
 * declined, we're retrying it, you still have access" is the same fact and is
 * actionable.
 */

export default function Settings() {
  const { user, signOut } = useAuth()
  const isOwner = user?.role === 'owner'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <AccountCard />
      <SubscriptionCard isOwner={isOwner} />
      <GoogleCalendarCard />
      <WeatherCard />
      <MarketsFeedsCard />
      <QuickPinCard />
      <ChangePasswordCard />
      {/* Only the owner sees this, and only as a link — the page and the API
          behind it do their own checking, so this is a convenience rather than
          the thing keeping anybody out. */}
      {user?.admin && (
        <section style={section()}>
          <div style={label()}>Site</div>
          <p style={{ ...body(14), color: T.muted, marginTop: 8 }}>
            You're signed in as the site owner, so the app is open to you without a
            subscription.
          </p>
          <Link to="/admin" style={{ ...textAction(), display: 'inline-block', marginTop: 10, minHeight: 44 }}>
            Signups and billing →
          </Link>
        </section>
      )}

      <button
        onClick={() => void signOut()}
        style={{ ...button('ghost'), width: '100%', color: T.bad, borderColor: 'rgba(239,68,68,0.35)' }}
      >
        Sign out
      </button>
    </div>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

type Msg = { kind: 'ok' | 'err'; text: string }

/** The one flash-message style on this page. Colour carries the outcome; the
 *  sentence carries what to do about it. */
function Flash({ msg }: { msg: Msg | null }) {
  if (!msg) return null
  const ok = msg.kind === 'ok'
  return (
    <div style={{
      marginTop: 12, padding: '10px 12px', borderRadius: 10,
      ...body(14),
      color: ok ? T.good : T.bad,
      background: ok ? 'rgba(142,202,230,0.10)' : 'rgba(239,68,68,0.10)',
      border: `1px solid ${ok ? 'rgba(142,202,230,0.35)' : 'rgba(239,68,68,0.35)'}`,
    }}>
      {msg.text}
    </div>
  )
}

const Explain = ({ children }: { children: ReactNode }) => (
  <div style={{ ...body(14), color: T.muted, marginTop: 8, lineHeight: 1.45 }}>{children}</div>
)

const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

/** "3 September 2026" from an ISO timestamp. Safe to parse — unlike the app's
 *  date-only strings, these carry a time and a zone. */
const longDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null

// ── Account ──────────────────────────────────────────────────────────────────

/**
 * Who you are signed in as, and whether we can actually email you.
 *
 * The verification line is not housekeeping: a password reset goes by email, so
 * an unverified address is a person who can be locked out of an account they are
 * paying for. That is why the resend button sits here rather than in a nag
 * banner someone learns to dismiss.
 */
function AccountCard() {
  const { user, refresh, setUser } = useAuth()
  const [msg, setMsg] = useState<Msg | null>(null)
  const [busy, setBusy] = useState(false)
  // `null` means "not editing" and is deliberately distinct from an empty
  // string, which is a name someone has cleared and is about to be told off for.
  const [draftName, setDraftName] = useState<string | null>(null)

  const saveName = async () => {
    const name = (draftName ?? '').trim()
    if (!name) { setMsg({ kind: 'err', text: 'Your name can’t be empty.' }); return }
    setBusy(true); setMsg(null)
    try {
      const r = await authApi.updateProfile({ displayName: name })
      setUser(r.user)
      setDraftName(null)
      setMsg({ kind: 'ok', text: 'Saved.' })
    } catch (e) {
      setMsg({ kind: 'err', text: errText(e, 'Could not save your name.') })
    } finally { setBusy(false) }
  }

  const resend = async () => {
    setBusy(true); setMsg(null)
    try {
      const r = await authApi.resendVerification()
      // `sent: false` is a 200 — usually "already verified elsewhere". Saying
      // "sent!" when nothing was sent leaves someone waiting for a mail that
      // will never arrive.
      if (r.sent) setMsg({ kind: 'ok', text: 'Sent. Check your inbox — and the spam folder.' })
      else { await refresh(); setMsg({ kind: 'ok', text: 'Nothing to send — this address is already verified.' }) }
    } catch (e) {
      setMsg({ kind: 'err', text: errText(e, 'Could not send that just now.') })
    } finally { setBusy(false) }
  }

  return (
    <section style={section()}>
      <div style={label()}>Account</div>

      {draftName === null ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10 }}>
          <div style={{ ...body(16) }}>{user?.displayName || '—'}</div>
          <button onClick={() => setDraftName(user?.displayName ?? '')}
                  style={{ ...textAction(), minHeight: 44 }}>
            Edit
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            maxLength={80}
            aria-label="Your name"
            style={{ ...input(), flex: 1 }}
          />
          <button onClick={() => void saveName()} disabled={busy}
                  style={{ ...button('primary'), minHeight: 44 }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => { setDraftName(null); setMsg(null) }}
                  style={{ ...segment(false), minHeight: 44 }}>
            Cancel
          </button>
        </div>
      )}

      {/* The email address is shown, never edited. Changing it is an identity
          change that has to re-verify, and the server refuses it here for that
          reason — a settings form that silently moves an account to a new
          address is how one gets taken over from a stale session. */}
      <div style={{ ...body(14), color: T.muted, marginTop: 4, wordBreak: 'break-all' }}>{user?.email}</div>

      {user && !user.emailVerified ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...body(14), color: T.warn, lineHeight: 1.45 }}>
            This address hasn't been verified yet. Until it is, a password reset can't reach you.
          </div>
          <button onClick={() => void resend()} disabled={busy}
                  style={{ ...segment(false), minHeight: 44, marginTop: 10 }}>
            {busy ? 'Sending…' : 'Resend the verification email'}
          </button>
        </div>
      ) : (
        <div style={label({ marginTop: 10, letterSpacing: '0.08em', color: T.faint })}>
          Email verified · {user?.tz}
        </div>
      )}

      <Flash msg={msg} />
    </section>
  )
}

// ── Subscription ─────────────────────────────────────────────────────────────

const PLAN_WORD: Record<string, string> = { monthly: 'Monthly', annual: 'Annual' }

/**
 * The status in a sentence, not a status code.
 *
 * `past_due` is the one that matters most and the one every product gets wrong.
 * It does NOT mean access has stopped — the card is being retried over the next
 * couple of weeks and everything keeps working meanwhile. Flagging it red with
 * no explanation makes people think they've been cut off and email support about
 * an account that is working fine.
 */
function statusSentence(s: BillingStatus): { text: string; colour: string } {
  const ends = longDate(s.currentPeriodEnd)
  switch (s.status as SubStatus) {
    case 'active':
      return {
        colour: T.good,
        text: s.cancelAtPeriodEnd
          ? `Cancelled — you keep full access until ${ends ?? 'the end of the period'}, and nothing more will be charged.`
          : `Active${ends ? ` — renews on ${ends}` : ''}.`,
      }
    case 'trialing':
      return { colour: T.good, text: `Free trial${ends ? ` — becomes a paid plan on ${ends}` : ''}.` }
    case 'past_due':
      return {
        colour: T.warn,
        text: 'The last payment did not go through. Your card is being retried over the next few days and '
            + 'everything keeps working in the meantime — updating the card in Manage billing settles it immediately.',
      }
    case 'unpaid':
      return { colour: T.bad, text: 'The retries have run out and the subscription is unpaid. Update your card to restore access.' }
    case 'canceled':
      return { colour: T.muted, text: 'Cancelled. Start a new subscription any time — your data is still here.' }
    case 'paused':
      return { colour: T.muted, text: 'Paused.' }
    case 'incomplete':
      return { colour: T.warn, text: "Checkout was started but never finished, so nothing has been charged." }
    case 'incomplete_expired':
      return { colour: T.muted, text: 'That checkout expired. Nothing was charged.' }
    default:
      return { colour: T.muted, text: 'No subscription on this account yet.' }
  }
}

function SubscriptionCard({ isOwner }: { isOwner: boolean }) {
  const { data, isLoading } = useQuery({ queryKey: ['billing-status'], queryFn: billing.status })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)

  const openPortal = async () => {
    setBusy(true); setMsg(null)
    try {
      const r = await billing.portal()
      // Stripe hands back a single-use URL. A full navigation, not a fetch —
      // the portal is a hosted page and cannot be rendered inside this app.
      window.location.href = r.url
    } catch (e) {
      setMsg({ kind: 'err', text: errText(e, 'Could not open the billing portal.') })
      setBusy(false)
    }
  }

  const s = data
  const said = s ? statusSentence(s) : null

  return (
    <section style={section()}>
      <div style={label()}>Subscription</div>

      {isLoading && <Explain>Checking…</Explain>}

      {s && (
        <>
          <div style={{ ...body(16), marginTop: 10 }}>
            {s.plan ? `${PLAN_WORD[s.plan] || s.plan} plan` : 'No plan'}
          </div>
          <div style={{ ...body(14), color: said?.colour, marginTop: 6, lineHeight: 1.5 }}>
            {said?.text}
          </div>

          {!s.configured && (
            <Explain>Billing isn't set up on this server, so nothing here can be changed.</Explain>
          )}

          {isOwner ? (
            s.configured && (
              <button onClick={() => void openPortal()} disabled={busy}
                      style={{ ...button('primary'), width: '100%', marginTop: 14 }}>
                {busy ? 'Opening…' : 'Manage billing'}
              </button>
            )
          ) : (
            // The server can still answer `role` with something other than
            // owner — an account migrated from the old two-seat data, for
            // instance. It can read its own status but has no payment method to
            // open a portal against, so it gets a way to reach a human rather
            // than a button that would 403.
            <Explain>
              This account can't open the billing portal itself. Email{' '}
              <a href="mailto:support@cbedge.net" style={{ color: T.accent }}>support@cbedge.net</a>{' '}
              and we'll move the subscription onto it.
            </Explain>
          )}
        </>
      )}

      <Flash msg={msg} />
    </section>
  )
}

// ── Google Calendar ──────────────────────────────────────────────────────────

/**
 * Connect / disconnect, and which calendars are read.
 *
 * The connect button is a real <a>, not a fetch. The browser has to follow the
 * redirect out to Google's consent screen and back; an XHR would be CORS-blocked
 * and, worse, would fail silently. The callback reports its result by landing
 * back here with ?calendar=…, which is the only reason this component reads the
 * query string at all.
 */
function GoogleCalendarCard() {
  const qc = useQueryClient()
  const { data: status } = useQuery({ queryKey: ['calendar-status'], queryFn: calendarApi.status })
  const [flash, setFlash] = useState<Msg | null>(null)

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('calendar')
    if (!param) return
    setFlash(
      param === 'connected' ? { kind: 'ok', text: 'Calendar connected.' }
      : param === 'access_denied' ? { kind: 'err', text: 'You cancelled at Google. Nothing was connected.' }
      : param === 'unconfigured' ? { kind: 'err', text: "Google isn't set up on the server yet." }
      : param === 'bad-state' ? { kind: 'err', text: 'That link expired. Start the connection again.' }
      : { kind: 'err', text: decodeURIComponent(param) },
    )
    void qc.invalidateQueries({ queryKey: ['calendar-status'] })
    // Strip the param so a refresh doesn't replay the message forever.
    window.history.replaceState({}, '', window.location.pathname)
  }, [qc])

  const disconnect = useMutation({
    mutationFn: calendarApi.disconnect,
    onSuccess: () => {
      setFlash({ kind: 'ok', text: 'Disconnected. Google was not asked for anything else.' })
      void qc.invalidateQueries({ queryKey: ['calendar-status'] })
      void qc.invalidateQueries({ queryKey: ['calendar-list'] })
      void qc.invalidateQueries({ queryKey: ['calendar'] })
      void qc.invalidateQueries({ queryKey: ['today'] })
    },
  })

  const right = !status?.configured ? 'unavailable'
    : status.needsReconnect ? 'reconnect'
    : status.connected ? 'connected' : 'not connected'

  return (
    <Collapsible variant="section" title="Google Calendar" right={right}>
      <Explain>
        Your own calendar, on the Today screen. Read-only — this app cannot create, change
        or delete an event in Google.
      </Explain>

      <Flash msg={flash} />

      {!status?.configured ? (
        <Explain>Not set up on this server (no Google credentials).</Explain>
      ) : status.needsReconnect ? (
        <div style={{ marginTop: 12 }}>
          {/* Access was revoked or the refresh token stopped working. Nothing is
              broken on this end and nothing was lost — but until someone presses
              this, the Today screen has no events and cannot say why. */}
          <div style={{ ...body(14), color: T.warn, lineHeight: 1.45 }}>
            The connection to {status.googleEmail || 'Google'} stopped working — usually because
            access was withdrawn in the Google account. Your settings are still here; reconnecting
            picks up where it left off.
          </div>
          <ConnectLink text="Connect again" />
        </div>
      ) : status.connected ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...body(14), color: T.good }}>
            Connected{status.googleEmail ? ` — ${status.googleEmail}` : ''}
          </div>
          <LastSynced at={status.lastSyncedAt ?? null} />
          <CalendarPicker />
          <button onClick={() => disconnect.mutate()} disabled={disconnect.isPending}
                  style={{ ...button('ghost'), marginTop: 16, color: T.bad, borderColor: 'rgba(239,68,68,0.35)' }}>
            {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ) : (
        <ConnectLink text="Connect Google Calendar" />
      )}
    </Collapsible>
  )
}

function ConnectLink({ text }: { text: string }) {
  return (
    <a
      href={authApi.googleConnectUrl}
      style={{
        display: 'inline-flex', alignItems: 'center', textDecoration: 'none',
        marginTop: 14, background: 'transparent', border: `1px solid ${T.accent}`,
        color: T.ink, borderRadius: 3, minHeight: 46, padding: '13px 18px',
        ...body(15),
      }}
    >
      {text}
    </a>
  )
}

/** Relative, because the only question anyone asks here is "is this current?" —
 *  and "4 minutes ago" answers it without arithmetic. */
function LastSynced({ at }: { at: string | null }) {
  if (!at) return <div style={label({ marginTop: 8, letterSpacing: '0.06em', color: T.faint })}>Not synced yet</div>
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000))
  const ago =
      mins < 1    ? 'just now'
    : mins < 60   ? `${mins} minute${mins === 1 ? '' : 's'} ago`
    : mins < 1440 ? `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? '' : 's'} ago`
    :               `${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? '' : 's'} ago`
  return (
    <div title={new Date(at).toLocaleString()}
         style={label({ marginTop: 8, letterSpacing: '0.06em', color: mins > 1440 ? T.warn : T.muted })}>
      Last synced {ago}
    </div>
  )
}

/**
 * Which of your Google calendars are read.
 *
 * This picker IS the privacy control. Connecting Google grants us the whole
 * account; ticking a calendar here is what decides which of them ever reaches
 * the app, so someone can put their personal calendar on Today without pulling
 * their work diary in with it.
 */
function CalendarPicker() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['calendar-list'], queryFn: calendarApi.list })
  const save = useMutation({
    mutationFn: (b: { calendarIds?: string[] }) => calendarApi.select(b),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['calendar-list'] })
      void qc.invalidateQueries({ queryKey: ['calendar-status'] })
      void qc.invalidateQueries({ queryKey: ['calendar'] })
      void qc.invalidateQueries({ queryKey: ['today'] })
    },
  })

  if (isLoading) return <Explain>Loading your calendars…</Explain>
  if (data?.error) return <Explain>Couldn't load your calendar list just now.</Explain>

  const calendars: GoogleCalendar[] = data?.calendars ?? []
  if (!calendars.length) return null

  // null means "never chosen", which the server reads as primary-only. Drawing
  // that as the primary calendar ticked keeps the UI honest about what is
  // actually being read right now.
  const selected = data?.selected ?? calendars.filter((c) => c.primary).map((c) => c.id)
  const isOn = (id: string) => selected.includes(id)
  const toggle = (id: string) =>
    save.mutate({ calendarIds: isOn(id) ? selected.filter((x) => x !== id) : [...selected, id] })

  return (
    <div style={{ marginTop: 18 }}>
      <div style={label()}>Calendars to show</div>
      {calendars.map((c) => (
        <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                                   padding: '12px 0', minHeight: 44, borderTop: `1px solid ${T.rule}` }}>
          <input type="checkbox" checked={isOn(c.id)} onChange={() => toggle(c.id)}
                 disabled={save.isPending}
                 style={{ width: 20, height: 20, accentColor: T.ink, flexShrink: 0, margin: 0 }} />
          <span style={{ ...body(14), flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
            {c.name}
            {c.primary && <span style={label({ marginLeft: 8, letterSpacing: '0.1em', color: T.faint })}>main</span>}
          </span>
        </label>
      ))}

      {selected.length === 0 && (
        <div style={label({ color: T.warn, marginTop: 10, letterSpacing: '0.06em' })}>
          Nothing ticked — Today will have no events on it
        </div>
      )}
    </div>
  )
}

// ── Settings-backed cards ────────────────────────────────────────────────────

/** Both cards below write to the same row, so they share one save and one
 *  invalidation. Today reads these too — the weather tile and the markets
 *  strip both come off this payload — so it is refreshed as well. */
function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: settingsApi.save,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] })
      void qc.invalidateQueries({ queryKey: ['today'] })
      void qc.invalidateQueries({ queryKey: ['markets-week'] })
    },
  })
}

function WeatherCard() {
  const { data } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get })
  const save = useSaveSettings()
  const [zip, setZip] = useState<string | null>(null)

  // Seeded from the server once, then left alone so a background refetch can't
  // clobber what someone is halfway through typing.
  useEffect(() => {
    if (data && zip === null) setZip(data.settings.weatherZip ?? '')
  }, [data, zip])

  const value = zip ?? ''
  const valid = value === '' || /^\d{5}$/.test(value)
  const changed = !!data && valid && value !== (data.settings.weatherZip ?? '')

  return (
    <section style={section()}>
      <div style={label()}>Weather</div>
      <Explain>
        The ZIP behind the weather tile at the top of Today. Leave it blank and the tile
        simply doesn't appear — an empty field here is a setting, not a mistake.
      </Explain>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <input inputMode="numeric" maxLength={5} placeholder="27591" value={value}
               onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
               style={{ ...input(), width: 120, flex: 'none' }} />
        <button onClick={() => valid && save.mutate({ weatherZip: value })}
                disabled={!changed || save.isPending}
                style={{ ...button('primary'), marginLeft: 'auto', opacity: changed ? 1 : 0.4 }}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {!valid && (
        <div style={label({ color: T.bad, marginTop: 8, letterSpacing: '0.06em' })}>
          Five digits, or empty.
        </div>
      )}
    </section>
  )
}

function MarketsFeedsCard() {
  const { data } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get })
  const save = useSaveSettings()
  const s = data?.settings

  return (
    <section style={section()}>
      <div style={label()}>Markets</div>
      <Explain>
        What the Markets tab carries, and what shows on Today. Turning a feed off hides it
        everywhere — nothing is fetched for it either.
      </Explain>

      <Toggle
        on={s?.showEconCalendar ?? false}
        disabled={!s || save.isPending}
        onChange={(v) => save.mutate({ showEconCalendar: v })}
        title="Economic calendar"
        note="CPI, payrolls, Fed days — with the forecast and the previous print."
      />
      <Toggle
        on={s?.showEarnings ?? false}
        disabled={!s || save.isPending}
        onChange={(v) => save.mutate({ showEarnings: v })}
        title="Earnings"
        note="Who reports each day, before or after the bell."
      />
    </section>
  )
}

function Toggle({ on, disabled, onChange, title, note }: {
  on: boolean; disabled: boolean; onChange: (v: boolean) => void; title: string; note: string
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer',
                    padding: '13px 0', minHeight: 44, borderTop: `1px solid ${T.rule}`, marginTop: 8 }}>
      <input type="checkbox" checked={on} disabled={disabled}
             onChange={(e) => onChange(e.target.checked)}
             style={{ width: 20, height: 20, accentColor: T.ink, flexShrink: 0, margin: '2px 0 0' }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ ...body(14), display: 'block' }}>{title}</span>
        <span style={{ ...body(13), color: T.muted, display: 'block', marginTop: 3 }}>{note}</span>
      </span>
    </label>
  )
}

// ── Quick sign-in (PIN) ──────────────────────────────────────────────────────

/**
 * Arm, change or forget the four-digit PIN for THIS browser.
 *
 * The honest explanation, kept from the private app because it is the reason
 * four digits is defensible: the PIN is only half a credential. The other half
 * is an HttpOnly token bound to this browser, which JavaScript never sees and
 * which nothing else can present. Four digits typed on a stranger's phone are
 * worth nothing; four digits plus this device are worth a session. That is also
 * why everything on this card is device-scoped — it reads differently on the
 * phone than on the laptop even though it is the same account — and why
 * `devices` is the one account-wide number here.
 */
function QuickPinCard() {
  const { refresh } = useAuth()
  const [info, setInfo] = useState<{ hasPinOnThisDevice: boolean; devices: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [first, setFirst] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)
  const sending = useRef(false)

  const load = () => { authApi.pinInfo().then(setInfo).catch(() => setInfo(null)) }
  useEffect(load, [])

  const reset = () => { setFirst(null); setPin(''); setEditing(false) }

  // Entered twice, and refused if it is trivially guessable. Four digits are
  // only safe alongside the device token; making 1111 the common case would
  // still hand anyone who picks up an unlocked phone the account.
  useEffect(() => {
    if (!editing || pin.length !== 4 || sending.current) return

    if (first === null) {
      const weak = /^(\d)\1{3}$/.test(pin) ? 'Not the same digit four times.'
        : ('0123456789'.includes(pin) || '9876543210'.includes(pin)) ? 'Not four digits in a row.'
        : null
      if (weak) { setMsg({ kind: 'err', text: weak }); setPin(''); return }
      setFirst(pin); setPin(''); setMsg(null)
      return
    }
    if (pin !== first) {
      setMsg({ kind: 'err', text: 'Those didn’t match. Start again.' })
      setFirst(null); setPin('')
      return
    }

    sending.current = true
    setBusy(true)
    void (async () => {
      try {
        await authApi.setPin(pin)
        await refresh()
        load()
        reset()
        setMsg({ kind: 'ok', text: 'PIN saved for this device.' })
      } catch (e) {
        setMsg({ kind: 'err', text: errText(e, 'Could not save your PIN.') })
        setFirst(null); setPin('')
      } finally { sending.current = false; setBusy(false) }
    })()
  }, [pin, editing, first, refresh])

  const forget = async () => {
    setBusy(true); setMsg(null)
    try {
      await authApi.removePin()
      await refresh()
      load()
      reset()
      setMsg({ kind: 'ok', text: 'This device will ask for your password from now on.' })
    } catch (e) {
      setMsg({ kind: 'err', text: errText(e, 'Something went wrong.') })
    } finally { setBusy(false) }
  }

  const has = !!info?.hasPinOnThisDevice
  const others = Math.max(0, (info?.devices ?? 0) - (has ? 1 : 0))

  return (
    <Collapsible variant="section" title="Quick sign-in" right={info === null ? '' : has ? 'on' : 'off'}>
      <Explain>
        A four-digit PIN gets you back in without typing your password. It only works on this
        browser: the PIN is half the credential and a token stored in this device is the other
        half, which is why four digits are enough here and would be nowhere near enough for a
        password. Five wrong tries and this device asks for the password again.
      </Explain>

      <Flash msg={msg} />

      {editing ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ ...label({ letterSpacing: '0.08em' }), textAlign: 'center', marginBottom: 16 }}>
            {first === null ? 'Choose a PIN' : 'Enter it again'}
          </div>
          <PinPad value={pin} onChange={(v) => { setMsg(null); setPin(v) }} disabled={busy} />
          <button type="button" onClick={reset} style={{ ...button('ghost'), width: '100%', marginTop: 16 }}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...body(14), color: has ? T.good : T.muted }}>
            {info === null ? '—' : has ? 'On for this device' : 'Off for this device'}
          </div>
          {others > 0 && (
            <div style={{ ...body(13), color: T.muted, marginTop: 4 }}>
              Also set up on {others} other {others === 1 ? 'device' : 'devices'}.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button type="button" disabled={busy}
                    onClick={() => { setMsg(null); setFirst(null); setPin(''); setEditing(true) }}
                    style={button('primary')}>
              {has ? 'Change PIN' : 'Set a PIN'}
            </button>
            {has && (
              <button type="button" disabled={busy} onClick={() => void forget()}
                      style={{ ...button('ghost'), color: T.bad, borderColor: 'rgba(239,68,68,0.35)' }}>
                Forget this device
              </button>
            )}
          </div>
        </div>
      )}
    </Collapsible>
  )
}

// ── Password ─────────────────────────────────────────────────────────────────

function ChangePasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    // A mistyped new password signs every other device out and then locks you
    // out of the one you are holding. Confirming is cheap; that is not.
    if (next !== confirm) {
      setMsg({ kind: 'err', text: 'The two new passwords do not match.' })
      return
    }
    setBusy(true); setMsg(null)
    try {
      await authApi.changePassword(current, next)
      setCurrent(''); setNext(''); setConfirm('')
      setMsg({ kind: 'ok', text: 'Password changed. Every other device was signed out.' })
    } catch (err) {
      setMsg({ kind: 'err', text: errText(err, 'Something went wrong.') })
    } finally { setBusy(false) }
  }

  return (
    <Collapsible variant="section" title="Password">
      <form onSubmit={onSubmit} style={{ marginTop: 12 }}>
        <input style={{ ...input(), marginBottom: 10 }} type="password" placeholder="Current password"
               value={current} onChange={(e) => setCurrent(e.target.value)}
               autoComplete="current-password" required />
        <input style={{ ...input(), marginBottom: 10 }} type="password" placeholder="New password (10+ characters)"
               value={next} onChange={(e) => setNext(e.target.value)}
               autoComplete="new-password" required />
        <input style={{ ...input(), marginBottom: 12 }} type="password" placeholder="Confirm new password"
               value={confirm} onChange={(e) => setConfirm(e.target.value)}
               autoComplete="new-password" required />
        <Flash msg={msg} />
        <button type="submit" disabled={busy}
                style={{ ...button('primary'), width: '100%', marginTop: 12, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </Collapsible>
  )
}
