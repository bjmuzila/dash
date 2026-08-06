import { calendar as calendarApi, type CalendarDay, type CalendarEvent, type CalendarStatus } from '../api'
import { useCalendarEvents } from '../hooks'
import { T, card, labelCap } from '../theme'

/**
 * Today's calendar block.
 *
 * Every failure mode gets its own honest message. The one thing this must never
 * do is render an empty list when it doesn't actually know — "no events today"
 * and "we can't reach your calendar" look identical on screen but mean opposite
 * things, and one of them will make you miss something.
 */
export default function CalendarCard({ status, date }: { status: CalendarStatus; date: string }) {
  const { data, isLoading, error } = useCalendarEvents(status.connected, date)

  return (
    <section style={card()}>
      <div style={labelCap()}>Calendar</div>
      <Body status={status} data={data} isLoading={isLoading} hadError={!!error} />
    </section>
  )
}

function Body({ status, data, isLoading, hadError }: {
  status: CalendarStatus
  data: CalendarDay | undefined
  isLoading: boolean
  hadError: boolean
}) {
  if (!status.configured) {
    return <Note>Google Calendar isn't set up on the server yet.</Note>
  }
  if (!status.connected) {
    return (
      <>
        <Note>See today's events here.</Note>
        {/* A real link, not a fetch — the browser has to follow the redirect
            out to Google's consent screen and back. */}
        <a href={calendarApi.connectUrl} style={connectLink}>Connect Google Calendar</a>
      </>
    )
  }
  if (isLoading) return <Note>Loading…</Note>

  if (hadError) return <Warn>Couldn't load your calendar. It'll retry on its own.</Warn>

  if (data?.error === 'revoked') {
    return (
      <>
        <Warn>Access was revoked at Google. Reconnect to see events again.</Warn>
        <a href={calendarApi.connectUrl} style={connectLink}>Reconnect</a>
      </>
    )
  }
  if (data?.error === 'not-connected') {
    return <a href={calendarApi.connectUrl} style={connectLink}>Connect Google Calendar</a>
  }
  // Distinct from "nothing on today": every calendar was un-ticked, so this is
  // a settings problem the user can fix, not a quiet day.
  if (data?.error === 'none-selected') {
    return <Note>No calendars are selected — pick some in Settings.</Note>
  }
  if (data?.error) return <Warn>Calendar is unavailable right now.</Warn>

  const events = data?.events ?? []
  if (!events.length) return <Note>Nothing on the calendar today.</Note>

  return (
    <div style={{ marginTop: 6 }}>
      {events.map((e) => <EventRow key={e.id} event={e} />)}
      {/* Some calendars answered and some didn't. Saying so beats implying the
          list is complete when it isn't. */}
      {!!data?.partialFailures && (
        <div style={{ fontSize: 12, color: T.orange, marginTop: 10, fontWeight: 600 }}>
          One of your calendars couldn't be reached — this may not be everything.
        </div>
      )}
    </div>
  )
}

function EventRow({ event }: { event: CalendarEvent }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '10px 0', borderTop: `1px solid ${T.border}`,
    }}>
      <div style={{
        flexShrink: 0, width: 62, fontSize: 12, fontWeight: 800,
        color: event.allDay ? T.cyan : T.accent, paddingTop: 1,
      }}>
        {event.allDay ? 'All day' : timeOf(event.start)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, wordBreak: 'break-word' }}>
          {event.summary}
        </div>
        {event.location && (
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{event.location}</div>
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

const connectLink: React.CSSProperties = {
  display: 'inline-block', marginTop: 12, textDecoration: 'none',
  background: 'rgba(33,158,188,0.18)', border: `1px solid ${T.cyan}`,
  color: T.text, borderRadius: 12, minHeight: 46, padding: '13px 18px',
  fontSize: 15, fontWeight: 800, letterSpacing: '0.04em',
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 14, color: T.muted, marginTop: 10, lineHeight: 1.45 }}>{children}</div>
)

const Warn = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 14, color: T.orange, marginTop: 10, lineHeight: 1.45, fontWeight: 600 }}>
    {children}
  </div>
)
