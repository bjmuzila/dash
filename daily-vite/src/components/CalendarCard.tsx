import { useState, type FormEvent } from 'react'
import {
  calendar as calendarApi, ApiError,
  type CalendarDay, type CalendarEvent, type CalendarStatus,
} from '../api'
import { useCalendarEvents, useCalendarList, useCreateCalendarEvent } from '../hooks'
import { T, sectionTitle, label, body, section, row, display, input, button, segment, MONO } from '../theme'

/**
 * Today's calendar block.
 *
 * Every failure mode gets its own honest message. The one thing this must never
 * do is render an empty list when it doesn't actually know — "nothing on today"
 * and "we can't reach your calendar" look identical on screen but mean opposite
 * things, and one of them will make you miss something. Every calendar read
 * answers HTTP 200 with an `error` string in the body precisely so this card can
 * draw that difference instead of a blank space.
 *
 * The card leads with the DATE — serif, spelled out — and a seven-day strip with
 * today filled solid. Both are drawn from `date` alone, so they render even when
 * Google is unreachable: on a screen whose whole job is "what is today", the
 * date is the one thing that should never depend on a network call.
 */
export default function CalendarCard({ status, date }: { status: CalendarStatus; date: string }) {
  const { data, isLoading, error } = useCalendarEvents(status.connected, { date })
  const count = data?.events?.length
  const today = parseDay(date)

  return (
    <div style={section()}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span style={sectionTitle()}>Calendar</span>
        <span style={label()}>
          {typeof count === 'number' && count > 0
            ? `${count} event${count === 1 ? '' : 's'}`
            : today.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
        </span>
      </div>

      {/* "Saturday, August 9" — the weekday plain, the date italic. The italic
          is doing work: it separates the two halves without a second colour or
          a bullet, in a place where both would be noise. */}
      <div style={{ ...display(26), marginTop: 9 }}>
        {today.toLocaleDateString('en-US', { weekday: 'long' })},{' '}
        <em style={{ fontStyle: 'italic' }}>
          {today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
        </em>
      </div>

      <WeekStrip today={today} />

      <Body status={status} data={data} isLoading={isLoading} hadError={!!error} />

      {/* Writing is new here — the app this came from only ever read. It sits at the
          bottom of the day it adds to, under the events it will join. */}
      {status.connected && !data?.error && <AddEvent date={date} />}
    </div>
  )
}

/**
 * Mon–Sun around today, today filled solid.
 *
 * Read-only on purpose. It orients you inside the week — the thing you lose
 * track of — without implying you can tap through to Tuesday, which this app
 * has no screen for. The day it fills is the day the REST of the card is
 * about, so it can never disagree with the list underneath it.
 */
function WeekStrip({ today }: { today: Date }) {
  // Monday-first: getDay() is Sunday-0, so Sunday has to walk back six days,
  // not zero, or the strip renders a week ahead every Sunday.
  const offset = (today.getDay() + 6) % 7
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)
  const days = Array.from({ length: 7 }, (_, i) =>
    new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, margin: '14px 0 2px' }}>
      {days.map((d) => {
        const on = d.getDate() === today.getDate() && d.getMonth() === today.getMonth()
        return (
          <div key={d.toISOString()} style={{
            textAlign: 'center', padding: '8px 0 9px', borderRadius: 12,
            border: `1px solid ${on ? T.ink : T.rule}`,
            background: on ? T.ink
              : 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 34%), rgba(13,17,25,0.55)',
          }}>
            <div style={{
              fontFamily: MONO, fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: on ? T.paper : T.faint, opacity: on ? 0.7 : 1,
            }}>
              {d.toLocaleDateString('en-US', { weekday: 'short' })}
            </div>
            <div style={{ ...display(17), marginTop: 3, color: on ? T.paper : T.ink }}>
              {d.getDate()}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * A bare 'YYYY-MM-DD' built LOCALLY. `new Date('2026-08-09')` parses as UTC and
 * renders as the 8th anywhere west of Greenwich — which would print the wrong
 * weekday on the card every single day.
 */
function parseDay(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return new Date()
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function Body({ status, data, isLoading, hadError }: {
  status: CalendarStatus
  data: CalendarDay | undefined
  isLoading: boolean
  hadError: boolean
}) {
  if (!status.configured) return <Note>Google Calendar isn't set up on the server yet.</Note>
  if (!status.connected) {
    return (
      <>
        <Note>See today's events here.</Note>
        <Connect>Connect Google Calendar</Connect>
      </>
    )
  }
  // The status endpoint knows the stored connection is dead before any day is
  // fetched, so say so up front rather than letting the day come back 'revoked'.
  if (status.needsReconnect) {
    return (
      <>
        <Warn>Your Google connection stopped working. Reconnect to see events again.</Warn>
        <Connect>Reconnect</Connect>
      </>
    )
  }
  if (isLoading) return <Note>Loading…</Note>
  if (hadError) return <Warn>Couldn't load your calendar. It'll retry on its own.</Warn>

  if (data?.error === 'revoked') {
    return (
      <>
        <Warn>Access was revoked at Google. Reconnect to see events again.</Warn>
        <Connect>Reconnect</Connect>
      </>
    )
  }
  if (data?.error === 'not-connected') return <Connect>Connect Google Calendar</Connect>
  // Distinct from "nothing on today": every calendar was un-ticked, so this is
  // a settings problem the user can fix, not a quiet day.
  if (data?.error === 'none-selected') return <Note>No calendars selected — pick some in More.</Note>
  if (data?.error) return <Warn>Calendar is unavailable right now.</Warn>

  const events = data?.events ?? []

  return (
    <div>
      {events.length === 0 && <Note>Nothing on today.</Note>}
      {events.map((e) => <EventRow key={e.id} event={e} />)}
      <Upcoming from={data?.date} connected={status.connected} />
      {/* Some calendars answered and some didn't. Saying so beats implying the
          list is complete when it isn't. */}
      {!!data?.partialFailures && (
        <div style={label({ color: T.warn, marginTop: 10, letterSpacing: '0.06em' })}>
          One calendar couldn't be reached — this may not be everything
        </div>
      )}
    </div>
  )
}

function EventRow({ event, showDay }: { event: CalendarEvent; showDay?: boolean }) {
  return (
    <div style={row({
      alignItems: 'flex-start',
      padding: '11px 15px',
      // All-day events get a tinted band. They have no time to anchor them, so
      // without the band they read as an event at midnight sitting above
      // everything else.
      background: event.allDay ? 'rgba(255,255,255,0.05)' : 'transparent',
      // Negative margin so the band bleeds to the card's edges rather than
      // sitting in an inset box. −15 tracks section()'s padding — if that
      // padding changes, this changes with it.
      marginLeft: -15,
      marginRight: -15,
      borderRadius: event.allDay ? 9 : 0,
    })}>
      <div style={{
        flexShrink: 0, width: 52, fontFamily: MONO, fontSize: 11,
        color: T.muted, paddingTop: 2, letterSpacing: '0.02em',
      }}>
        {/* In Upcoming the DAY is the thing you need; "All day" with no date
            tells you an anniversary is coming but not when. Today's list is the
            opposite — the day is implied, so the time carries the information. */}
        {showDay ? dayOf(event.start) : event.allDay ? 'All day' : timeOf(event.start)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          ...body(15),
          wordBreak: 'break-word',
          // Tinted by which CALENDAR it came from, so a glance separates the
          // family calendar from a work one without a legend. Falls back to the
          // normal text colour when Google gives us nothing.
          color: event.colour || T.ink,
        }}>
          {event.summary}
        </div>
        {(event.location || showDay) && (
          <div style={label({ marginTop: 3, letterSpacing: '0.06em' })}>
            {[
              showDay ? (event.allDay ? 'All day' : timeOf(event.start)) : null,
              event.location,
              // `event.owner` is deliberately NOT rendered. It names whose
              // connection an event arrived through, which was worth saying when
              // two calendars were merged and is pure noise when there is only
              // ever one. The field stays on the type — the server still sends
              // it — so nothing here has to change if that ever comes back.
            ].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The next few events after today — the "don't forget Thursday" list.
 *
 * Its own request over a three-week range rather than a field on the day
 * payload. The endpoint answers a range natively, the server caches it beside
 * the day, and keeping it separate means a slow range query can never delay
 * today's list, which is the part you actually opened the app for.
 */
function Upcoming({ from, connected }: { from: string | undefined; connected: boolean }) {
  const start = from ? addDays(from, 1) : null
  const { data } = useCalendarEvents(connected && !!start, {
    from: start ?? undefined,
    to: start ? addDays(start, 20) : undefined,
  })

  // Silent on failure, deliberately: this is the secondary list, and an error
  // banner for it would sit under a day that loaded perfectly well and imply
  // the whole card is broken.
  const events = (data?.error ? [] : data?.events ?? []).slice(0, 5)
  if (!events.length) return null

  return (
    <div style={{ marginTop: 18, paddingTop: 12, borderTop: `1px solid ${T.rule}` }}>
      <div style={sectionTitle({ marginBottom: 2 })}>Upcoming</div>
      {events.map((e) => <EventRow key={e.id} event={e} showDay />)}
    </div>
  )
}

// ── Adding ───────────────────────────────────────────────────────────────────

/**
 * Add an event to Google, from the day you are already looking at.
 *
 * Collapsed to a single text action until you want it: this card's job is
 * reading the day, and a permanently open form would put three inputs between
 * the day's events and everything below it.
 *
 * Only WRITABLE calendars are offered. Google lists plenty a person can read and
 * not write — holidays, a colleague's diary, anything shared read-only — and
 * offering those means an insert that fails after the fact, with the event
 * apparently accepted and nowhere to be found.
 */
function AddEvent({ date }: { date: string }) {
  const [open, setOpen] = useState(false)
  const { data: list, isLoading: loadingList } = useCalendarList(open)
  const create = useCreateCalendarEvent()

  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')
  const [calendarId, setCalendarId] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        ...label({ color: T.accent }), background: 'none', border: 'none',
        cursor: 'pointer', padding: '12px 0 2px', minHeight: 44, textAlign: 'left',
      }}>
        + Add to calendar
      </button>
    )
  }

  const writable = (list?.calendars ?? []).filter((c) => c.writable)
  // Whatever the person picked, else the primary calendar, else the first thing
  // Google will accept a write on.
  const target = calendarId
    || writable.find((c) => c.primary)?.id
    || writable[0]?.id
    || ''

  const close = () => { setOpen(false); setTitle(''); setTime(''); setError(null) }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = title.trim()
    if (!t || !target || create.isPending) return
    setError(null)
    try {
      await create.mutateAsync({
        calendarId: target,
        title: t,
        // No time given means an all-day event on this date — 'YYYY-MM-DD' is
        // exactly what Google wants for that, and inventing 9am instead would
        // quietly put a birthday in a nine o'clock slot.
        ...(time
          ? { start: rfc3339(date, time), end: rfc3339(date, time, 60) }
          : { start: date, allDay: true }),
      })
      setTitle(''); setTime('')
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2400)
    } catch (err) {
      // Google's refusals are specific and worth repeating verbatim — "the
      // calendar is read-only", "the token no longer has write access". A
      // generic "couldn't save" sends someone to reconnect an account that was
      // never the problem.
      setError(err instanceof ApiError && err.message
        ? err.message
        : 'Google wouldn\'t accept that event.')
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 14, paddingTop: 13, borderTop: `1px solid ${T.rule}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span style={label()}>New event</span>
        {saved && <span style={label({ color: T.accent })}>Added ✓</span>}
      </div>

      <input
        style={{ ...input(), marginTop: 10 }}
        placeholder="What is it?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        enterKeyHint="done"
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 9, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="time" value={time} onChange={(e) => setTime(e.target.value)}
          aria-label="Start time"
          style={{ ...input(), width: 'auto', flex: 'none', minHeight: 38, padding: '7px 9px', fontSize: 16 }}
        />
        <span style={label({ letterSpacing: '0.06em' })}>
          {time ? 'one hour' : 'all day'}
        </span>
      </div>

      {loadingList && <div style={label({ marginTop: 10, letterSpacing: '0.06em' })}>Loading calendars…</div>}

      {!loadingList && writable.length === 0 && (
        <div style={label({ color: T.warn, marginTop: 10, letterSpacing: '0.06em' })}>
          {list?.error
            ? "Couldn't read your calendar list, so there's nowhere to add this."
            : 'None of your calendars can be written to.'}
        </div>
      )}

      {/* One calendar needs no picker — a segmented control with a single
          segment is a label pretending to be a choice. */}
      {writable.length > 1 && (
        <div style={{ display: 'flex', gap: 5, marginTop: 10, flexWrap: 'wrap' }}>
          {writable.map((c) => (
            <button key={c.id} type="button" onClick={() => setCalendarId(c.id)}
                    style={segment(c.id === target)}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" onClick={close} style={{ ...button('ghost'), flex: 1 }}>Cancel</button>
        <button type="submit" disabled={!title.trim() || !target || create.isPending}
                style={{ ...button(title.trim() && target ? 'primary' : 'ghost'), flex: 1 }}>
          {create.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>

      {error && <div style={label({ color: T.bad, marginTop: 10, letterSpacing: '0.06em' })}>{error}</div>}
    </form>
  )
}

/**
 * 'YYYY-MM-DD' + 'HH:MM' → RFC3339 with THIS browser's offset, optionally plus
 * some minutes.
 *
 * The offset is not decoration. Sending a bare '2026-08-09T09:00:00' lets Google
 * interpret it in the calendar's own timezone, so an event typed at 9am on a
 * phone in New York lands at 9am UTC on a calendar whose default is UTC — four
 * hours out, silently, and only on some calendars.
 */
function rfc3339(day: string, time: string, addMinutes = 0): string {
  const [y, m, d] = day.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const dt = new Date(y, m - 1, d, hh, mm + addMinutes)
  const p = (n: number) => String(n).padStart(2, '0')
  // getTimezoneOffset is minutes BEHIND UTC, so its sign is inverted from the
  // one RFC3339 prints.
  const off = -dt.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}` +
    `T${p(dt.getHours())}:${p(dt.getMinutes())}:00` +
    `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
}

/** Shift a 'YYYY-MM-DD' by whole days, staying in that format. Built through a
 *  local Date so month ends and leap years are the calendar's problem, not
 *  ours. */
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

/** "Thu 8" from an ISO instant or a bare date. */
function dayOf(iso: string | null): string {
  if (!iso) return ''
  // A bare 'YYYY-MM-DD' is a calendar day: build it locally so it can't shift.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getDate()}`
}

/**
 * A timed event's start comes back as RFC3339 WITH an offset
 * ("2026-08-06T09:30:00-04:00"). Parsing that and formatting in the browser's
 * own locale is correct here — unlike a bare date, the instant is unambiguous,
 * so there's no timezone trap. All-day events never reach this function.
 */
function timeOf(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(' ', '')
}

/** A real link, not a fetch — the browser must follow the redirect to Google. */
const Connect = ({ children }: { children: React.ReactNode }) => (
  <a href={calendarApi.connectUrl}
     style={{ ...label({ color: T.accent }), display: 'inline-block', marginTop: 12,
              textDecoration: 'none', minHeight: 40, paddingTop: 10 }}>
    {children} →
  </a>
)

const Note = ({ children }: { children: React.ReactNode }) => (
  <div style={{ ...body(14), color: T.muted, marginTop: 10 }}>{children}</div>
)

const Warn = ({ children }: { children: React.ReactNode }) => (
  <div style={{ ...body(14), color: T.warn, marginTop: 10 }}>{children}</div>
)
