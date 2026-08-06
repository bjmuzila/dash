import { useCalendarList, useSaveCalendarSelection } from '../hooks'
import type { CalendarStatus } from '../api'
import { T, labelCap } from '../theme'

/**
 * Which calendars appear on Today, and whether the household sees them.
 *
 * This picker IS the privacy control. "Share with the household" exposes only
 * the calendars ticked here — never the whole Google account — so one person
 * can link a family calendar without also handing over their work diary.
 */
export default function CalendarPicker({ status }: { status: CalendarStatus }) {
  const hasOwn = !!status.ownConnection
  const { data, isLoading } = useCalendarList(hasOwn)
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

  const toggle = (id: string) => {
    const next = isOn(id) ? selected.filter((x) => x !== id) : [...selected, id]
    save.mutate({ calendarIds: next })
  }

  const sharing = data?.shareWithHousehold ?? false

  return (
    <div style={{ marginTop: 16 }}>
      <div style={labelCap()}>Calendars to show</div>
      <div style={{ fontSize: 13, color: T.muted, marginTop: 6, lineHeight: 1.45 }}>
        A calendar you share with someone else is its own calendar here — tick it to get
        those events on Today.
      </div>

      <div style={{ marginTop: 10 }}>
        {calendars.map((c) => (
          <label
            key={c.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer',
              padding: '11px 0', borderTop: `1px solid ${T.border}`,
            }}
          >
            <input
              type="checkbox"
              checked={isOn(c.id)}
              onChange={() => toggle(c.id)}
              disabled={save.isPending}
              style={{ width: 20, height: 20, accentColor: T.cyan, flexShrink: 0, margin: 0 }}
            />
            {c.color && (
              <span style={{
                width: 10, height: 10, borderRadius: 3, background: c.color, flexShrink: 0,
              }} />
            )}
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, wordBreak: 'break-word' }}>
              {c.name}
              {c.primary && (
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', color: T.muted, marginLeft: 8 }}>
                  YOURS
                </span>
              )}
            </span>
          </label>
        ))}
      </div>

      {selected.length === 0 && (
        <div style={{ fontSize: 13, color: T.orange, fontWeight: 600, marginTop: 10 }}>
          Nothing ticked — Today's calendar card will be empty.
        </div>
      )}

      <label
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 11, cursor: 'pointer',
          marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.border}`,
        }}
      >
        <input
          type="checkbox"
          checked={sharing}
          onChange={(e) => save.mutate({ shareWithHousehold: e.target.checked })}
          disabled={save.isPending}
          style={{ width: 20, height: 20, accentColor: T.cyan, flexShrink: 0, margin: '2px 0 0' }}
        />
        <span style={{ fontSize: 14, lineHeight: 1.45 }}>
          Show these on the other person's Today too
          <span style={{ display: 'block', fontSize: 12, color: T.muted, marginTop: 3 }}>
            Only the calendars ticked above — they never see the rest of your account, and
            they don't need to connect anything.
          </span>
        </span>
      </label>
    </div>
  )
}

const Muted = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 13, color: T.muted, marginTop: 12 }}>{children}</div>
)
