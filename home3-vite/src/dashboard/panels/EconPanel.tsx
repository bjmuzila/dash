import { useEffect, useState } from 'react'
import { C } from '../theme'

// Economic calendar — reads /api/calendar (the same feed EconCalendarPanel uses)
// and lists today's + this week's events with impact coloring.
type CalEvent = {
  date: string
  time?: string
  time_formatted?: string
  impact?: string
  title?: string
  event?: string
  name?: string
  country?: string
  actual?: string
  forecast?: string
  previous?: string
}

function impactColor(impact?: string): string {
  const i = (impact ?? '').toLowerCase()
  if (i.startsWith('high')) return C.red
  if (i.startsWith('med')) return C.orange
  if (i.startsWith('low')) return '#5a7a98'
  return '#5a7a98'
}

function etToday(): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return p
}

export default function EconPanel() {
  const [events, setEvents] = useState<CalEvent[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const r = await fetch('/api/calendar', { cache: 'no-store' })
        if (!r.ok) { if (live) setErr(`backend ${r.status}`); return }
        const j = await r.json()
        const evs: CalEvent[] = (j.events ?? []).slice().sort((a: CalEvent, b: CalEvent) =>
          a.date !== b.date ? a.date.localeCompare(b.date) : (a.time ?? '').localeCompare(b.time ?? ''))
        if (live) { setEvents(evs); setErr(null) }
      } catch { if (live) setErr('backend unreachable') }
    }
    load()
    const id = setInterval(load, 60000)
    return () => { live = false; clearInterval(id) }
  }, [])

  if (err) return <div style={{ padding: 24, color: '#5a6b85', fontSize: 12 }}>Calendar: {err}. Reads <code style={{ color: C.cyan }}>/api/calendar</code>.</div>
  if (!events) return <div style={{ padding: 24, color: '#5a6b85', fontSize: 12 }}>Loading calendar…</div>

  const today = etToday()
  // today's remaining + upcoming this week (next ~7 days), cap 40.
  const upcoming = events.filter((e) => e.date >= today).slice(0, 40)
  if (!upcoming.length) return <div style={{ padding: 24, color: '#5a6b85', fontSize: 12 }}>No upcoming events.</div>

  let lastDate = ''
  return (
    <div style={{ padding: '4px 0' }}>
      {upcoming.map((e, i) => {
        const col = impactColor(e.impact)
        const showDate = e.date !== lastDate
        lastDate = e.date
        const title = e.title ?? e.event ?? e.name ?? '—'
        return (
          <div key={`${e.date}-${e.time}-${i}`}>
            {showDate && (
              <div style={{ padding: '10px 14px 4px', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', color: C.cyan, textTransform: 'uppercase' }}>
                {e.date === today ? 'Today' : e.date}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 10, alignItems: 'center', padding: '7px 14px', borderLeft: `3px solid ${col}`, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#cdd8e6' }}>{e.time_formatted || e.time || 'TBD'}</span>
              <span style={{ fontSize: 12.5, color: '#e8eef7' }}>
                {e.country && <span style={{ fontSize: 10, fontWeight: 700, color: '#7f92a8', marginRight: 6 }}>{e.country}</span>}
                {title}
              </span>
              <span style={{ fontSize: 9, fontWeight: 800, color: col, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{e.impact ?? ''}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
