import { useCalendarList, useSaveCalendarSelection } from '../hooks'
import type { CalendarStatus } from '../api'
import { T, label, body, row } from '../theme'

/**
 * Which calendars appear on Today, and whether the household sees them.
 *
 * This picker IS the privacy control. "Share with the household" exposes only
 * the calendars ticked here — never the whole Google account — so one person
 * can link a family calendar without also handing over their work diary.
 */
export default function CalendarPicker({ status }: { status: CalendarStatus }) {
  const hasOwn = !!status.ownConnection
  const { data, isLoading, isFetching, refetch } = useCalendarList(hasOwn)
  const save = useSaveCalendarSelection()

  if (!hasOwn) return null
  if (isLoading) return <Muted>Loading your calendars…</Muted>
  if (data?.error === 'revoked') return <Muted>Reconnect to choose calendars.</Muted>
  if (data?.error) return <Muted>Couldn't load your calendar list.</Muted>

  const calendars = data?.calendars ?? []
  if (!calendars.length) return null

  // null means "never chosen", which the server reads as primary-only. Showing
  // that as the primary calendar ticked keeps the UI honest about what's
  // actually being read right now.
  const selected = data?.selected ?? calendars.filter((c) => c.primary).map((c) => c.id)
  const isOn = (id: string) => selected.includes(id)
  const toggle = (id: string) =>
    save.mutate({ calendarIds: isOn(id) ? selected.filter((x) => x !== id) : [...selected, id] })
  const sharing = data?.shareWithHousehold ?? false

  return (
    <div style={{ marginTop: 18 }}>
      {/* The list is cached for 5 minutes, so a calendar created in Google a
          moment ago would otherwise not be here yet. Refresh re-asks Google
          now — the server never caches this call, so one press is enough. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <div style={{ ...label(), flex: 1 }}>
          Calendars to show
          <span style={label({ marginLeft: 8, color: T.faint, letterSpacing: '0.1em' })}>
            {calendars.length} found
          </span>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          style={{
            ...label({ color: T.accent }),
            background: 'none', border: 'none', padding: '4px 0',
            cursor: isFetching ? 'default' : 'pointer', opacity: isFetching ? 0.55 : 1,
          }}
        >
          {isFetching ? 'Checking…' : 'Refresh list'}
        </button>
      </div>
      <div style={{ ...body(13), color: T.muted, marginTop: 6 }}>
        Every calendar this Google account can read is listed — your own, shared, subscribed,
        holidays. A calendar shared with you is its own calendar here; tick it to get those
        events. Just made one in Google? Press Refresh list.
      </div>

      <div style={{ marginTop: 6 }}>
        {calendars.map((c) => (
          <label key={c.id} style={row({ cursor: 'pointer', padding: '11px 0' })}>
            <input type="checkbox" checked={isOn(c.id)} onChange={() => toggle(c.id)}
                   disabled={save.isPending}
                   style={{ width: 18, height: 18, accentColor: T.ink, flexShrink: 0, margin: 0 }} />
            {c.color && (
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color, flexShrink: 0 }} />
            )}
            <span style={{ ...body(14), flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
              {c.name}
              {c.primary && <span style={label({ marginLeft: 8, letterSpacing: '0.1em' })}>yours</span>}
              {/* Unticked in Google's own sidebar. It can still be shown here —
                  this flag only explains why a calendar you never see in Google
                  is in this list. */}
              {!c.selectedInGoogle && !c.primary && (
                <span style={label({ marginLeft: 8, letterSpacing: '0.1em', color: T.faint })}>
                  hidden in google
                </span>
              )}
            </span>
          </label>
        ))}
      </div>

      {selected.length === 0 && (
        <div style={label({ color: T.warn, marginTop: 10, letterSpacing: '0.06em' })}>
          Nothing ticked — the calendar card will be empty
        </div>
      )}

      <label style={{ ...row({ alignItems: 'flex-start', marginTop: 6, cursor: 'pointer' }) }}>
        <input type="checkbox" checked={sharing}
               onChange={(e) => save.mutate({ shareWithHousehold: e.target.checked })}
               disabled={save.isPending}
               style={{ width: 18, height: 18, accentColor: T.ink, flexShrink: 0, margin: '2px 0 0' }} />
        <span style={{ ...body(14) }}>
          Show these on the other person's Today too
          <span style={{ ...body(13), color: T.muted, display: 'block', marginTop: 3 }}>
            Only the calendars ticked above — they never see the rest of your account,
            and they don't need to connect anything.
          </span>
        </span>
      </label>
    </div>
  )
}

const Muted = ({ children }: { children: React.ReactNode }) => (
  <div style={{ ...body(13), color: T.muted, marginTop: 12 }}>{children}</div>
)
