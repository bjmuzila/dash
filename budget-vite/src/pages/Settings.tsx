import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { auth as authApi, calendar as calendarApi, ApiError } from '../api'
import PinPad from '../components/PinPad'
import { useSettings, useSaveSettings, useNotes, useCreateNote, useDeleteNote,
         useToday, useDisconnectCalendar, useSyncCalendar,
         useIcsFeeds, useAddIcsFeed, useRemoveIcsFeed, useUpdateIcsFeed } from '../hooks'
import type { IcsFeed } from '../api'
import CalendarPicker from '../components/CalendarPicker'
import { T, label, section, button, input } from '../theme'

export default function Settings() {
  const { user, signOut } = useAuth()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section style={section()}>
        <div style={label()}>Account</div>
        <div style={{ marginTop: 10, fontSize: 15, fontWeight: 700 }}>{user?.displayName}</div>
        <div style={{ fontSize: 13, color: T.muted, marginTop: 2 }}>{user?.email}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 8 }}>
          Budget profile: {user?.budgetProfileKey} · {user?.tz}
        </div>
      </section>

      <section style={section()}>
        <div style={label()}>More</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <a href="/routines" style={linkBtn}>Habits</a>
          <a href="/projects" style={linkBtn}>Projects</a>
        </div>
        <div style={label({ marginTop: 10, letterSpacing: '0.06em' })}>
          Still here — they just gave up their tab slots to Todo and Lists
        </div>
      </section>

      <WeatherSetting />
      <SlippingSetting />
      <SavedNotes />
      <QuickPinCard />
      <ChangePasswordCard />

      <GoogleCalendarCard />
      <IcsFeedsCard />

      <button onClick={() => void signOut()}
              style={{ ...button('ghost'), width: '100%', color: T.bad, borderColor: 'rgba(239,68,68,0.35)' }}>
        Sign out
      </button>
    </div>
  )
}

const linkBtn: React.CSSProperties = {
  ...label({ color: T.ink }),
  textDecoration: 'none', border: `1px solid ${T.ruleStrong}`, borderRadius: 3,
  padding: '10px 14px', minHeight: 38, display: 'inline-flex', alignItems: 'center',
}

// ── Google Calendar ──────────────────────────────────────────────────────────

/**
 * Connect / disconnect. Each person links their OWN Google account — the tokens
 * are per-user, so connecting yours tells the app nothing about anyone else's
 * calendar.
 *
 * The ?calendar= query param is how the OAuth callback reports back, since it
 * returns as a page navigation rather than a fetch.
 */
function GoogleCalendarCard() {
  const { data } = useToday()
  const disconnect = useDisconnectCalendar()
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

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
    // Strip the param so a refresh doesn't replay the message forever.
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  const status = data?.calendar

  return (
    <section style={section()}>
      <div style={label()}>Google Calendar</div>
      <div style={{ fontSize: 14, color: T.muted, marginTop: 8, lineHeight: 1.45 }}>
        Connect your own calendar so today's events show on the Today screen. Read-only —
        this app cannot create, change or delete an event.
      </div>

      {flash && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 10, fontSize: 14, fontWeight: 600,
          color: flash.kind === 'ok' ? T.good : T.bad,
          background: flash.kind === 'ok' ? 'rgba(142,202,230,0.10)' : 'rgba(239,68,68,0.10)',
          border: `1px solid ${flash.kind === 'ok' ? 'rgba(142,202,230,0.35)' : 'rgba(239,68,68,0.35)'}`,
        }}>{flash.text}</div>
      )}

      {!status?.configured ? (
        <div style={{ fontSize: 12, color: T.muted, marginTop: 10 }}>
          Not set up on the server (missing Google credentials).
        </div>
      ) : status.ownConnection ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 14, color: T.good, fontWeight: 700 }}>
            Connected{status.email ? ` — ${status.email}` : ''}
          </div>
          <SyncRow at={status.lastSyncedAt ?? null} />
          <CalendarPicker status={status} />
          <button
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
            style={{ ...button('ghost'), marginTop: 16, color: T.bad, borderColor: 'rgba(239,68,68,0.35)' }}
          >
            {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {/* Already fed by someone else's shared connection — say so, so this
              doesn't read as "broken, go connect something". */}
          {status.connected && status.source === 'household' && (
            <div style={{ fontSize: 14, color: T.good, fontWeight: 700, marginBottom: 12 }}>
              Showing {status.sharedBy ? `${status.sharedBy}'s` : 'the'} shared calendar.
              <span style={{ display: 'block', fontSize: 13, color: T.muted, fontWeight: 400, marginTop: 4 }}>
                Nothing to set up. Connect your own account below only if you also want
                your personal events on Today.
              </span>
              <SyncRow at={status.lastSyncedAt ?? null} />
            </div>
          )}
          {/* A real link, not a button with onClick — the browser must follow the
              redirect out to Google and back. A fetch would just get CORS-blocked. */}
          <a href={calendarApi.connectUrl} style={{
            display: 'inline-block', textDecoration: 'none',
            background: 'transparent', border: `1px solid ${T.accent}`,
            color: T.ink, borderRadius: 12, minHeight: 46, padding: '13px 18px',
            fontSize: 15, fontWeight: 800, letterSpacing: '0.04em',
          }}>
            {status.connected ? 'Connect my own calendar' : 'Connect Google Calendar'}
          </a>
        </div>
      )}
    </section>
  )
}

/**
 * "Last synced 4 minutes ago" + the on-demand Sync button.
 *
 * The two belong together: the timestamp is the only thing that tells you
 * whether pressing the button did anything, and pressing the button is the only
 * thing that moves the timestamp on demand.
 *
 * Sync is shown for a shared household connection too. The pull runs against
 * whichever connection feeds you, so someone reading their partner's shared
 * calendar can still ask for fresh events without owning the Google link.
 *
 * A Google failure comes back as `error` INSIDE a 200 (see api.calendar.sync),
 * so a resolved mutation is not by itself a successful sync — both are checked.
 */
function SyncRow({ at }: { at: string | null }) {
  const sync = useSyncCalendar()
  const failed = sync.isError || !!sync.data?.error

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <LastSynced at={at} />
        <button
          onClick={() => sync.mutate(undefined)}
          disabled={sync.isPending}
          style={{
            ...label({ color: T.accent }),
            background: 'none', border: 'none', padding: '8px 0',
            minHeight: 34, cursor: sync.isPending ? 'default' : 'pointer',
            opacity: sync.isPending ? 0.55 : 1,
          }}
        >
          {sync.isPending ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      {failed && (
        <div style={{ fontSize: 13, color: T.bad, marginTop: 2, fontWeight: 400 }}>
          Couldn't reach Google just now — your events are unchanged. Try again in a moment.
        </div>
      )}
      {!failed && sync.isSuccess && (
        <div style={{ fontSize: 13, color: T.muted, marginTop: 2, fontWeight: 400 }}>
          Up to date.
        </div>
      )}
    </div>
  )
}

/**
 * "Last synced 4 minutes ago" — when Google last actually answered for the
 * connection feeding this account.
 *
 * Read from `last_synced_at`, which the server stamps on a successful events
 * fetch — NOT from the token's `updated_at`, which moves on every silent
 * access-token refresh and would happily read "synced 30 seconds ago" for a
 * calendar that has been failing all day.
 *
 * Relative, not a timestamp: the only question anyone asks here is "is this
 * current?", and "4 minutes ago" answers it without arithmetic. The absolute
 * time is in the title attribute for when it isn't.
 */
function LastSynced({ at }: { at: string | null }) {
  if (!at) {
    return (
      <div style={label({ letterSpacing: '0.06em', color: T.faint })}>
        Not synced yet
      </div>
    )
  }
  const then = new Date(at)
  const mins = Math.max(0, Math.round((Date.now() - then.getTime()) / 60_000))
  const ago =
      mins < 1    ? 'just now'
    : mins < 60   ? `${mins} minute${mins === 1 ? '' : 's'} ago`
    : mins < 1440 ? `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? '' : 's'} ago`
    :               `${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? '' : 's'} ago`
  // A calendar that hasn't answered in over a day is stale enough to flag, but
  // it is not an error — Google may simply not have been asked.
  const stale = mins > 1440
  return (
    <div title={then.toLocaleString()}
         style={label({ letterSpacing: '0.06em', color: stale ? T.warn : T.muted })}>
      Last synced {ago}
    </div>
  )
}

// ── Subscribed feeds (ICS / webcal) ──────────────────────────────────────────

/**
 * Paste a team or school .ics link and its events land on Today.
 *
 * This exists because subscribing the same link inside Google works but updates
 * on Google's schedule — a practice added this morning can be missing tonight.
 * Read directly, a feed is never more than 30 minutes behind.
 *
 * Read-only in both directions: nothing here can change the publisher's
 * calendar, and removing a feed removes only our copy.
 */
function IcsFeedsCard() {
  const { data, isLoading } = useIcsFeeds()
  const addFeed = useAddIcsFeed()
  const [url, setUrl] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = url.trim()
    if (!v || addFeed.isPending) return
    addFeed.mutate(v, { onSuccess: () => setUrl('') })
  }

  const mine = data?.feeds ?? []
  const shared = data?.shared ?? []

  return (
    <section style={section()}>
      <div style={label()}>
        Subscribed feeds
        {mine.length > 0 && (
          <span style={label({ marginLeft: 8, color: T.faint, letterSpacing: '0.1em' })}>
            {mine.length}
          </span>
        )}
      </div>
      <div style={{ fontSize: 14, color: T.muted, marginTop: 8, lineHeight: 1.45 }}>
        A team or school calendar link (.ics or webcal). Its events show on Today next to
        your Google ones, and it's re-read every half hour — faster than Google picks up
        the same link. Read-only.
      </div>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/calendar.ics"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={{ ...input(), flex: 1, minWidth: 0 }}
        />
        <button type="submit" disabled={!url.trim() || addFeed.isPending}
                style={{ ...button('ghost'), flexShrink: 0 }}>
          {addFeed.isPending ? 'Adding…' : 'Add'}
        </button>
      </form>

      {/* The server's message, verbatim — "That link didn't return a calendar"
          tells you what to do; a generic failure doesn't. */}
      {addFeed.isError && (
        <div style={{ fontSize: 13, color: T.bad, marginTop: 8 }}>
          {(addFeed.error as ApiError)?.message || 'Could not add that feed.'}
        </div>
      )}

      {isLoading && <div style={{ ...label({ color: T.faint }), marginTop: 12 }}>Loading…</div>}

      {mine.map((f) => <FeedRow key={f.id} feed={f} />)}

      {shared.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={label({ color: T.faint, letterSpacing: '0.06em' })}>
            Shared with you
          </div>
          {shared.map((f) => <FeedRow key={f.id} feed={f} />)}
        </div>
      )}
    </section>
  )
}

function FeedRow({ feed }: { feed: IcsFeed }) {
  const removeFeed = useRemoveIcsFeed()
  const updateFeed = useUpdateIcsFeed()
  const [confirming, setConfirming] = useState(false)

  return (
    <div style={{ borderTop: `1px solid ${T.rule}`, padding: '12px 0' }}>
      <div style={{ fontSize: 14, color: T.ink, wordBreak: 'break-word', fontWeight: 600 }}>
        {feed.name || feed.url}
      </div>
      <div style={label({ marginTop: 4, letterSpacing: '0.06em', color: T.faint })}>
        {[
          feed.sharedBy ? `from ${feed.sharedBy}` : null,
          typeof feed.eventCount === 'number' ? `${feed.eventCount} events` : null,
          feed.fetchedAt ? `read ${agoOf(feed.fetchedAt)}` : 'not read yet',
        ].filter(Boolean).join(' · ')}
      </div>
      {/* An error here is not fatal — the last good copy is still being shown,
          which is the whole reason the body is cached. Say both halves. */}
      {feed.lastError && (
        <div style={{ fontSize: 13, color: T.warn, marginTop: 4 }}>
          Last read failed ({feed.lastError}) — still showing the previous copy.
        </div>
      )}

      {feed.mine && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={feed.shareWithHousehold}
              onChange={(e) => updateFeed.mutate({ id: feed.id, patch: { shareWithHousehold: e.target.checked } })}
              disabled={updateFeed.isPending}
              style={{ width: 18, height: 18, accentColor: T.ink, margin: 0 }}
            />
            <span style={{ fontSize: 13, color: T.muted }}>Show on the other person's Today</span>
          </label>

          {confirming ? (
            <span style={{ display: 'inline-flex', gap: 14, alignItems: 'center' }}>
              <button onClick={() => removeFeed.mutate(feed.id)} disabled={removeFeed.isPending}
                      style={{ ...label({ color: T.bad }), background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer' }}>
                {removeFeed.isPending ? 'Removing…' : 'Really remove'}
              </button>
              <button onClick={() => setConfirming(false)}
                      style={{ ...label({ color: T.muted }), background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer' }}>
                Cancel
              </button>
            </span>
          ) : (
            <button onClick={() => setConfirming(true)}
                    style={{ ...label({ color: T.muted }), background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer' }}>
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** "4 minutes ago" — same shape as LastSynced, without the stale warning. */
function agoOf(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  if (mins < 1440) {
    const h = Math.round(mins / 60)
    return `${h} hour${h === 1 ? '' : 's'} ago`
  }
  const d = Math.round(mins / 1440)
  return `${d} day${d === 1 ? '' : 's'} ago`
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
    <section style={section()}>
      <div style={label()}>Slipping threshold</div>
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
        <div style={{ color: T.bad, fontSize: 13, fontWeight: 600, marginTop: 8 }}>
          Pick a whole number between 1 and 365.
        </div>
      )}
    </section>
  )
}

// ── Weather ──────────────────────────────────────────────────────────────────

/**
 * The ZIP behind Today's weather tile.
 *
 * Per person, not per household: two people who live together can still be in
 * two places, and one shared value would be wrong for whoever travelled.
 * Clearing it turns the tile off, so an empty field is a valid saved state and
 * must not read as an error.
 */
function WeatherSetting() {
  const { data } = useSettings()
  const save = useSaveSettings()
  const [zip, setZip] = useState<string | null>(null)

  useEffect(() => {
    if (data && zip === null) setZip(data.settings.weatherZip ?? '')
  }, [data, zip])

  const value = zip ?? ''
  const valid = value === '' || /^\d{5}$/.test(value)
  const changed = !!data && valid && value !== (data.settings.weatherZip ?? '')

  return (
    <section style={section()}>
      <div style={label()}>Weather</div>
      <div style={{ fontSize: 14, color: T.muted, marginTop: 8, lineHeight: 1.45 }}>
        US ZIP for the tile at the top of Today. Defaults to 27591 — change it if
        you're somewhere else, or clear it to hide the tile. Yours only.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <input
          inputMode="numeric" maxLength={5} placeholder="27591"
          value={value} onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
          style={{ ...input(), width: 120, flex: 'none' }}
        />
        <button
          onClick={() => valid && save.mutate({ weatherZip: value })}
          disabled={!changed || save.isPending}
          style={{ ...button('primary'), marginLeft: 'auto', opacity: changed ? 1 : 0.4 }}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {!valid && (
        <div style={{ color: T.bad, fontSize: 13, fontWeight: 600, marginTop: 8 }}>
          Five digits, or empty.
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

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = body.trim()
    if (!t || create.isPending) return
    setBody('')
    // No visibility choice — everything in this app is shared. See
    // server-v2/household-routes.cjs.
    try { await create.mutateAsync({ body: t }) }
    catch { setBody(t) }
  }

  const list = data?.notes ?? []

  return (
    <section style={section()}>
      <div style={label()}>Saved notes</div>
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
              padding: '10px 0', borderTop: `1px solid ${T.rule}`,
            }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.45, wordBreak: 'break-word' }}>
                {nt.body}
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

// ── Quick sign-in (4-digit PIN) ──────────────────────────────────────────────

/**
 * Arm, change or forget the PIN for THIS browser.
 *
 * Everything here is device-scoped: `hasPinOnThisDevice` comes from the
 * HttpOnly hh_device cookie, so this card reads differently on your phone than
 * on the laptop even though it is the same account. `devices` is the only
 * account-wide number, and it exists for one reason — "forget everywhere",
 * which is what you press when a phone goes missing.
 */
function QuickPinCard() {
  const { refresh } = useAuth()
  const [info, setInfo] = useState<{ hasPinOnThisDevice: boolean; devices: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [first, setFirst] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const sending = useRef(false)

  const load = () => { authApi.pinInfo().then(setInfo).catch(() => setInfo(null)) }
  useEffect(load, [])

  const reset = () => { setFirst(null); setPin(''); setEditing(false) }

  useEffect(() => {
    if (!editing || pin.length !== 4 || sending.current) return

    if (first === null) {
      const weak = /^(\d)\1{3}$/.test(pin) ? 'Not the same digit four times.'
        : ('0123456789'.includes(pin) || '9876543210'.includes(pin))
          ? 'Not four digits in a row.' : null
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
      } catch (err) {
        setMsg({ kind: 'err', text: err instanceof ApiError ? err.message : 'Could not save your PIN.' })
        setFirst(null); setPin('')
      } finally { sending.current = false; setBusy(false) }
    })()
  }, [pin, editing, first, refresh])

  const forget = async (allDevices: boolean) => {
    setBusy(true); setMsg(null)
    try {
      await authApi.removePin(allDevices)
      await refresh()
      load()
      reset()
      setMsg({ kind: 'ok', text: allDevices ? 'Quick sign-in removed everywhere.' : 'This device will ask for your password.' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof ApiError ? err.message : 'Something went wrong.' })
    } finally { setBusy(false) }
  }

  const has = !!info?.hasPinOnThisDevice
  const others = Math.max(0, (info?.devices ?? 0) - (has ? 1 : 0))

  return (
    <section style={section()}>
      <div style={label()}>Quick sign-in</div>
      <div style={{ fontSize: 14, color: T.muted, marginTop: 8, lineHeight: 1.45 }}>
        A 4-digit PIN gets you back in without typing your password. It is tied to this
        device alone — the PIN by itself is useless anywhere else, and five wrong
        entries make this device ask for the password again.
      </div>

      {msg && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 10, fontSize: 14, fontWeight: 600,
          color: msg.kind === 'ok' ? T.good : T.bad,
          background: msg.kind === 'ok' ? 'rgba(142,202,230,0.10)' : 'rgba(239,68,68,0.10)',
          border: `1px solid ${msg.kind === 'ok' ? 'rgba(142,202,230,0.35)' : 'rgba(239,68,68,0.35)'}`,
        }}>{msg.text}</div>
      )}

      {editing ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ ...label({ letterSpacing: '0.08em' }), textAlign: 'center', marginBottom: 16 }}>
            {first === null ? 'Choose a PIN' : 'Enter it again'}
          </div>
          <PinPad value={pin} onChange={(v) => { setMsg(null); setPin(v) }} disabled={busy} />
          <button type="button" onClick={reset}
                  style={{ ...button('ghost'), width: '100%', marginTop: 16 }}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: has ? T.good : T.muted }}>
            {info === null ? '—' : has ? 'On for this device' : 'Off for this device'}
            {others > 0 && (
              <span style={{ display: 'block', fontSize: 13, color: T.muted, fontWeight: 400, marginTop: 4 }}>
                Also set up on {others} other {others === 1 ? 'device' : 'devices'}.
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button type="button" disabled={busy}
                    onClick={() => { setMsg(null); setFirst(null); setPin(''); setEditing(true) }}
                    style={{ ...button('primary') }}>
              {has ? 'Change PIN' : 'Set a PIN'}
            </button>
            {has && (
              <button type="button" disabled={busy} onClick={() => void forget(false)}
                      style={{ ...button('ghost'), color: T.bad, borderColor: 'rgba(239,68,68,0.35)' }}>
                Forget this device
              </button>
            )}
            {others > 0 && (
              <button type="button" disabled={busy} onClick={() => void forget(true)}
                      style={{ ...button('ghost'), color: T.bad, borderColor: 'rgba(239,68,68,0.35)' }}>
                Forget everywhere
              </button>
            )}
          </div>
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
    <section style={section()}>
      <div style={label()}>Change password</div>
      <form onSubmit={onSubmit} style={{ marginTop: 12 }}>
        <input style={{ ...input(), marginBottom: 10 }} type="password" placeholder="Current password"
               value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        <input style={{ ...input(), marginBottom: 12 }} type="password" placeholder="New password (10+ characters)"
               value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
        {msg && (
          <div style={{
            marginBottom: 12, padding: '10px 12px', borderRadius: 10, fontSize: 14, fontWeight: 600,
            color: msg.kind === 'ok' ? T.good : T.bad,
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
