import { calendar as calendarApi, type CalendarDay, type CalendarEvent, type CalendarStatus } from '../api'
import { useCalendarEvents } from '../hooks'
import { T, sectionTitle, label, body, section, row, MONO } from '../theme'

/**
 * Today's calendar block.
 *
 * Every failure mode gets its own honest message. The one thing this must never
 * do is render an empty list when it doesn't actually know — "nothing on today"
 * and "we can't reach your calendar" look identical on screen but mean opposite
 * things, and one of them will make you miss something.
 */
export default function CalendarCard({ status, date }: { status: CalendarStatus; date: string }) {
  const { data, isLoading, error } = useCalendarEvents(status.connected, date)
  const count = data?.events?.length

  return (
    <div style={section()}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span style={sectionTitle()}>Calendar</span>
        {typeof count === 'number' && count > 0 && (
          <span style={label()}>{count} event{count === 1 ? '' : 's'}</span>
        )}
      </div>
      <Body status={status} data={data} isLoading={isLoading} hadError={!!error} />
    </div>
  )
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
      padding: '11px 10px',
      // All-day events get a tinted band. They have no time to anchor them, so
      // without the band they read as an event at midnight sitting above
      // everything else.
      background: event.allDay ? 'rgba(255,255,255,0.05)' : 'transparent',
      // Negative margin so the band bleeds to the section edges rather than
      // sitting in an inset box.
      marginLeft: -10,
      marginRight: -10,
      borderRadius: event.allDay ? 3 : 0,
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

