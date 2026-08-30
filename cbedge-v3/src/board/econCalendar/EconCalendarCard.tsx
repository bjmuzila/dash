import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@/data/api'
import { CardToolbar } from '@/design/primitives/Card'
import { Popover } from '../gexCandles/controls'

// ─────────────────────────────────────────────────────────────────────────────
// Economic Calendar & Earnings — v2's home-page panel, as a board card.
//
// TODAY ONLY, ET, sorted by time. An event more than an hour past its start is
// REMOVED, not dimmed — the print lands within the hour and after that the row
// is occupying a card that is about what is still coming. Earnings are woven
// into the day: pre-market before the first event, after-hours before the first
// event past 16:00, time-unconfirmed last.
//
// Was a rolling seven days with a dimmed tail. A week of scrolling is the wrong
// answer to "what is left today", which is the only question a card this size
// gets asked; the weekly view lives on the full page.
//
// Two fetches, once, on mount:
//   /api/calendar        { events, source }   ForexFactory + the President feed
//   /proxy/earnings-week { ok, rows }         this week, ≥ the recorder's mcap floor
//
// Neither is polled. A 60-second tick expires released rows off the card without
// touching the network, which is the only thing that actually changes minute to
// minute; the underlying calendar is a weekly file.
//
// Every impact colour is a token (--color-impact-*), matching v2's values, so
// the same importance reads as the same colour across both apps.
// ─────────────────────────────────────────────────────────────────────────────

interface CalEvent {
  date: string
  /** "HH:MM" 24h ET — the SORT key. */
  time: string
  /** "h:MM AM/PM" ET — the DISPLAY key. */
  time_formatted: string
  title: string
  country: string
  impact: string
  forecast: string
  previous: string
  actual: string
}
interface CalendarResponse {
  events?: CalEvent[]
  source?: string
}

interface EarnRow {
  date: string
  symbol: string
  company: string
  session: 'pre' | 'after' | 'unknown' | string
  market_cap: number
  eps_est: string | null
}
interface EarningsResponse {
  ok?: boolean
  rows?: EarnRow[]
}

// ── Impact ───────────────────────────────────────────────────────────────────
// Mapped to token names, never to values — the card reads the resolved colour
// through a CSS variable so tokens.css stays the only place a hex lives.

const IMPACT_VAR: Record<string, string> = {
  High: '--color-impact-high',
  Medium: '--color-impact-medium',
  Low: '--color-impact-low',
  Holiday: '--color-impact-holiday',
  President: '--color-impact-president',
}
const FADED_VAR = '--color-impact-faded'
const EARN_VAR = '--color-cal-accent'

function impactVar(impact: string): string {
  return IMPACT_VAR[impact] ?? '--color-impact-low'
}

const FILTER_OPTS: Array<{ value: string; label: string; varName: string }> = [
  { value: 'all-usd', label: 'All · USD', varName: '--color-cal-accent' },
  { value: 'high-usd', label: 'High · USD', varName: '--color-impact-high' },
  { value: 'high', label: 'High', varName: '--color-impact-high' },
  { value: 'medium-usd', label: 'Medium · USD', varName: '--color-impact-medium' },
  { value: 'medium', label: 'Medium', varName: '--color-impact-medium' },
  { value: 'low-usd', label: 'Low · USD', varName: '--color-impact-low' },
  { value: 'low', label: 'Low', varName: '--color-impact-low' },
  { value: 'trump', label: 'TRUMP', varName: '--color-impact-president' },
  { value: 'earnings', label: 'Earnings', varName: '--color-cal-accent' },
  { value: 'all', label: 'All', varName: '--color-fg' },
]

const DEFAULT_FILTERS = ['all-usd', 'trump', 'earnings']
const FILTER_KEY = 'cb-v3-econ-filters'

function passes(ev: CalEvent, active: Set<string>): boolean {
  if (active.has('all')) return true
  const usd = ev.country === 'USD'
  if (ev.impact === 'President') return active.has('trump')
  if (active.has('all-usd') && usd) return true
  const i = ev.impact.toLowerCase()
  if (active.has(i)) return true
  if (usd && active.has(`${i}-usd`)) return true
  return false
}

// ── ET helpers ───────────────────────────────────────────────────────────────

const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const ET_HM = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function etDate(ms: number): string {
  return ET_DATE.format(new Date(ms))
}
function etMinutes(ms: number): number {
  const parts = ET_HM.formatToParts(new Date(ms))
  let h = 0
  let m = 0
  for (const p of parts) {
    if (p.type === 'hour') h = Number(p.value) % 24
    else if (p.type === 'minute') m = Number(p.value)
  }
  return h * 60 + m
}

/**
 * TODAY ONLY, ET.
 *
 * Was today → today+6. A seven-day window on a board card is a week's worth of
 * scrolling to answer "what is left today", which is the only question a card
 * this size is being asked. The weekly view still exists on the full page.
 *
 * Kept as a function returning a list so the day-header and earnings-weaving
 * code below is unchanged — it groups by date either way, and a one-day list is
 * the degenerate case of a seven-day one.
 */
function etWeekDays(now: number): string[] {
  return [etDate(now)]
}

function fullDayLabel(date: string, today: string): string {
  if (date === today) return 'TODAY'
  // Noon UTC, so the date cannot slide a day either way when re-read in ET.
  const d = new Date(`${date}T12:00:00Z`)
  return d
    .toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' })
    .toUpperCase()
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':')
  const hh = Number(h)
  const mm = Number(m)
  return Number.isFinite(hh) && Number.isFinite(mm) ? hh * 60 + mm : 0
}

/**
 * How long a released event stays on the card after its start.
 *
 * An hour, and then the row is REMOVED rather than dimmed. Thirty minutes and a
 * dimmed tail was the old behaviour: the print is what matters and it lands
 * within the hour, after which the row is just occupying a card that is now
 * about today alone.
 */
const DROP_AFTER_MIN = 60

/** Past its window, or on another ET date. Such rows are dropped, not dimmed. */
function isStale(ev: CalEvent, now: number): boolean {
  const today = etDate(now)
  if (ev.date < today) return true
  if (ev.date > today) return false
  return minutesOf(ev.time) + DROP_AFTER_MIN < etMinutes(now)
}

function fmtMcap(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return ''
  return v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : `$${Math.round(v / 1e9)}B`
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function EventRow({ ev, faded }: { ev: CalEvent; faded: boolean }) {
  const col = `var(${faded ? FADED_VAR : impactVar(ev.impact)})`
  const hasValues = Boolean(ev.actual || ev.forecast || ev.previous)
  return (
    <div
      className="grid min-h-[44px] border-t border-line"
      style={{
        gridTemplateColumns: '62px 1fr',
        borderLeft: `3px solid ${col}`,
        opacity: faded ? 0.32 : 1,
        transition: 'opacity 400ms',
      }}
    >
      <div className="tabular flex items-center justify-center border-r border-line px-1 font-mono text-sm text-fg">
        {ev.time_formatted || ev.time || 'TBD'}
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-0.5 px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-2xs font-extrabold uppercase tracking-[0.1em]" style={{ color: col }}>
            {ev.impact}
          </span>
          <span className="text-xs font-semibold text-fg opacity-80">{ev.country}</span>
        </div>
        <div className={['text-sm leading-tight text-fg', ev.impact === 'High' ? 'font-bold' : ''].join(' ')}>
          {ev.title}
        </div>
        {hasValues && (
          <div className="tabular flex flex-wrap gap-2.5 font-mono text-xs">
            {ev.actual && (
              <span style={{ color: 'var(--color-cal-actual)' }}>
                A: <strong>{ev.actual}</strong>
              </span>
            )}
            {ev.forecast && <span style={{ color: 'var(--color-cal-forecast)' }}>F: {ev.forecast}</span>}
            {ev.previous && <span style={{ color: 'var(--color-cal-previous)' }}>P: {ev.previous}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

// Named rather than an array indexed by position. Under
// `noUncheckedIndexedAccess` an index read is `T | undefined`, and reaching for
// EARN_KINDS[1] and asserting it away would be pretending the compiler is wrong
// about something it is right about. Three constants have no index to check.
interface EarnKind {
  head: string
  sub: string
  title: string
}
const EARN_PRE: EarnKind = { head: 'PRE', sub: 'MKT', title: 'Premarket earnings' }
const EARN_AFTER: EarnKind = { head: 'AFTER', sub: 'HRS', title: 'After-hours earnings' }
const EARN_TBD: EarnKind = { head: 'TIME', sub: 'TBD', title: 'Time unconfirmed' }

function EarningsBlock({ rows, kind }: { rows: EarnRow[]; kind: EarnKind }) {
  if (!rows.length) return null
  const col = `var(${EARN_VAR})`
  return (
    <div
      className="grid min-h-[44px] border-t border-line"
      style={{ gridTemplateColumns: '62px 1fr', borderLeft: `3px solid ${col}` }}
      title={kind.title}
    >
      <div
        className="flex flex-col items-center justify-center border-r border-line font-mono text-2xs font-bold leading-tight"
        style={{ color: col }}
      >
        <span>{kind.head}</span>
        <span>{kind.sub}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
        {rows.map((r) => (
          <a
            key={`${r.date}-${r.symbol}`}
            href={`https://finance.yahoo.com/quote/${encodeURIComponent(r.symbol)}`}
            target="_blank"
            rel="noreferrer"
            title={`${r.company}${fmtMcap(r.market_cap) ? ` · ${fmtMcap(r.market_cap)}` : ''}${r.eps_est ? ` · est ${r.eps_est}` : ''}`}
            className="rounded-sm border border-line bg-surface2 px-1.5 py-0.5 font-mono text-2xs font-bold text-fg hover:bg-raised"
          >
            {r.symbol}
          </a>
        ))}
      </div>
    </div>
  )
}

// ── The card ─────────────────────────────────────────────────────────────────

function loadFilters(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null')
    return Array.isArray(parsed) && parsed.length ? parsed.map(String) : DEFAULT_FILTERS
  } catch {
    return DEFAULT_FILTERS
  }
}

export function EconCalendarCard() {
  const cal = useQuery<CalendarResponse>('/api/calendar', { staleMs: 600_000 })
  const earn = useQuery<EarningsResponse>('/proxy/earnings-week', { staleMs: 600_000 })

  const [now, setNow] = useState(() => Date.now())
  const [filters, setFilters] = useState<string[]>(() => loadFilters())
  const [menuOpen, setMenuOpen] = useState(false)

  // Moves rows from ahead → past. Not a refetch: the calendar is a weekly file
  // and re-pulling it every minute would be a lot of bytes for no new events.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const active = useMemo(() => new Set(filters), [filters])
  const toggle = (v: string) => {
    setFilters((prev) => {
      const next = prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]
      try {
        localStorage.setItem(FILTER_KEY, JSON.stringify(next))
      } catch {
        /* best-effort */
      }
      return next
    })
  }

  const today = etDate(now)
  const days = useMemo(() => etWeekDays(now), [now])
  const daySet = useMemo(() => new Set(days), [days])

  const events = useMemo(() => {
    const all = cal.data?.events ?? []
    return all
      .filter((e) => daySet.has(e.date) && passes(e, active))
      .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)))
  }, [cal.data, daySet, active])

  const earnByDate = useMemo(() => {
    const m = new Map<string, EarnRow[]>()
    for (const r of earn.data?.rows ?? []) {
      if (!daySet.has(r.date)) continue
      const list = m.get(r.date) ?? []
      list.push(r)
      m.set(r.date, list)
    }
    return m
  }, [earn.data, daySet])

  const showEarnings = active.has('all') || active.has('earnings')

  // No faded tail any more: an event more than DROP_AFTER_MIN past its start
  // leaves the card. `past` stays as an empty list so the "nothing today" check
  // and the render below read the same as before.
  const ahead = events.filter((e) => !isStale(e, now))
  const past: CalEvent[] = []

  /** Day headers + earnings weaving. Only the non-faded pass carries earnings. */
  const withSeparators = (list: CalEvent[], faded: boolean): ReactNode[] => {
    const out: ReactNode[] = []
    const byDate = new Map<string, CalEvent[]>()
    for (const e of list) {
      const arr = byDate.get(e.date) ?? []
      arr.push(e)
      byDate.set(e.date, arr)
    }
    // A day with earnings but no passing econ event still deserves a header —
    // otherwise the earnings silently vanish on a quiet macro day.
    if (!faded && showEarnings) {
      for (const d of earnByDate.keys()) if (!byDate.has(d) && d >= today) byDate.set(d, [])
    }

    for (const date of [...byDate.keys()].sort()) {
      const dayEvents = byDate.get(date)!
      out.push(
        <div
          key={`hdr-${date}-${faded ? 'p' : 'a'}`}
          className="sticky top-0 z-10 flex items-center gap-1.5 border-t border-line px-2.5 py-1"
          style={{ background: date === today ? 'var(--color-surface2)' : 'var(--color-surface)' }}
        >
          <span
            className="text-xs font-extrabold tracking-[0.1em]"
            style={{ color: date === today ? 'var(--color-cal-accent)' : 'var(--color-impact-low)' }}
          >
            {fullDayLabel(date, today)}
          </span>
          {date === today && (
            <span
              className="rounded-sm px-1 py-px text-2xs font-black tracking-[0.1em]"
              style={{ background: 'var(--color-cal-accent)', color: 'var(--color-bg)' }}
            >
              TODAY
            </span>
          )}
        </div>,
      )

      const dayEarn = !faded && showEarnings ? (earnByDate.get(date) ?? []) : []
      const bySession = (s: EarnRow['session']) =>
        dayEarn.filter((r) => (s === 'unknown' ? r.session !== 'pre' && r.session !== 'after' : r.session === s))

      const pre = bySession('pre')
      const after = bySession('after')
      const tbd = bySession('unknown')

      if (pre.length) out.push(<EarningsBlock key={`pre-${date}`} rows={pre} kind={EARN_PRE} />)

      let afterPlaced = after.length === 0
      dayEvents.forEach((ev, i) => {
        if (!afterPlaced && ev.time > '16:00') {
          out.push(<EarningsBlock key={`after-${date}`} rows={after} kind={EARN_AFTER} />)
          afterPlaced = true
        }
        out.push(<EventRow key={`${date}-${ev.time}-${i}-${faded ? 'p' : 'a'}`} ev={ev} faded={faded} />)
      })
      if (!afterPlaced) out.push(<EarningsBlock key={`after-${date}`} rows={after} kind={EARN_AFTER} />)
      if (tbd.length) out.push(<EarningsBlock key={`tbd-${date}`} rows={tbd} kind={EARN_TBD} />)
    }
    return out
  }

  const loading = cal.loading && !cal.data
  const nothing = !loading && ahead.length === 0 && past.length === 0 && earnByDate.size === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* One toolbar per card: the window caption and the filter go in the
          Card's header, not in a second bar underneath it. */}
      <CardToolbar>
        <span className="text-2xs uppercase tracking-[0.1em] text-muted opacity-60">Today · ET</span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold uppercase tracking-[0.08em] text-muted hover:bg-raised hover:text-fg"
          >
            Filter ({filters.length})
          </button>
          <Popover open={menuOpen} onClose={() => setMenuOpen(false)}>
            <div className="flex w-40 flex-col">
              {FILTER_OPTS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs hover:bg-raised"
                >
                  <span
                    className="flex h-3 w-3 shrink-0 items-center justify-center rounded-[2px] text-3xs leading-none"
                    style={{
                      border: `2px solid var(${o.varName})`,
                      background: active.has(o.value) ? `var(${o.varName})` : 'transparent',
                      color: 'var(--color-bg)',
                    }}
                  >
                    {active.has(o.value) ? '✓' : ''}
                  </span>
                  <span className={active.has(o.value) ? 'font-semibold text-fg' : 'text-muted opacity-50'}>
                    {o.label}
                  </span>
                </button>
              ))}
            </div>
          </Popover>
        </div>
      </CardToolbar>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-line">
        {loading && <div className="px-2.5 py-3 text-xs text-muted opacity-60">Loading…</div>}
        {nothing && <div className="px-2.5 py-3 text-xs text-muted opacity-60">Nothing left today.</div>}
        {withSeparators(ahead, false)}
        {past.length > 0 && <div className="border-t border-line" />}
        {withSeparators(past, true)}
      </div>
    </div>
  )
}
