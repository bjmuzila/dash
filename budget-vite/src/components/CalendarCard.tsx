import { calendar as calendarApi, type CalendarDay, type CalendarEvent, type CalendarStatus } from '../api'
import { useCalendarEvents } from '../hooks'
import { T, sectionTitle, label, body, section, row, display, MONO } from '../theme'

/**
 * Today's calendar block.
 *
 * Every failure mode gets its own honest message. The one thing this must never
 * do is render an empty list when it doesn't actually know — "nothing on today"
 * and "we can't reach your calendar" look identical on screen but mean opposite
 * things, and one of them will make you miss something.
 *
 * The card leads with the DATE — serif, spelled out — and a seven-day strip with
 * today filled solid. Both are drawn from `date` alone, so they render even when
 * Google is unreachable: on a screen whose whole job is "what is today", the
 * date is the one thing that should never depend on a network call.
 */
export default function CalendarCard({ status, date }: { status: CalendarStatus; date: string }) {
  const { data, isLoading, error } = useCalendarEvents(status.connected, date)
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
  const upcoming = data?.upcoming ?? []
  if (!events.length && !upcoming.length) return <Note>Nothing on the calendar today.</Note>

  return (
    <div>
      {events.length === 0 && <Note>Nothing on today.</Note>}
      {events.map((e) => <EventRow key={e.id} event={e} />)}
      {upcoming.length > 0 && <Upcoming events={upcoming} />}
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
            {[showDay ? (event.allDay ? 'All day' : timeOf(event.start)) : null, event.location]
              .filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    </div>
  )
}

/** The next few events after today — the "don't forget Thursday" list. */
function Upcoming({ events }: { events: CalendarEvent[] }) {
  return (
    <div style={{ marginTop: 18, paddingTop: 12, borderTop: `1px solid ${T.rule}` }}>
      <div style={sectionTitle({ marginBottom: 2 })}>Upcoming</div>
      {events.map((e) => <EventRow key={e.id} event={e} showDay />)}
    </div>
  )
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

