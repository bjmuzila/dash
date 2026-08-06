import { calendar as calendarApi, type CalendarDay, type CalendarEvent, type CalendarStatus } from '../api'
import { useCalendarEvents } from '../hooks'
import { T, label, body, section, row, MONO } from '../theme'

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
        <span style={label()}>Calendar</span>
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
  if (!events.length) return <Note>Nothing on the calendar today.</Note>

  return (
    <div>
      {events.map((e) => <EventRow key={e.id} event={e} />)}
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

function EventRow({ event }: { event: CalendarEvent }) {
  return (
    <div style={row({ alignItems: 'flex-start', padding: '11px 0' })}>
      <div style={{
        flexShrink: 0, width: 52, fontFamily: MONO, fontSize: 11,
        color: event.allDay ? T.muted : T.ink, paddingTop: 2, letterSpacing: '0.02em',
      }}>
        {event.allDay ? 'All day' : timeOf(event.start)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...body(15), wordBreak: 'break-word' }}>{event.summary}</div>
        {event.location && (
          <div style={label({ marginTop: 3, letterSpacing: '0.06em' })}>{event.location}</div>
        )}
      </div>
    </div>
  )
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
