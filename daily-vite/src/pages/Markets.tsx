import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ApiError, markets, settings as settingsApi, type EarningsRow, type EconEvent } from '../api'
import { T, label, body, section, row, segment } from '../theme'

/**
 * The week ahead in the markets — the thing that makes this a planner for people
 * who watch the tape, rather than one more calendar.
 *
 * ONE request for the whole week. The upstream feed is cached hard on the server
 * (savedAt on the payload is when, not now), so re-asking buys nothing and costs
 * a lot: hammering the same provider is precisely what got the trading dashboard
 * rate-limited, and a rate-limited feed is a blank markets page for everyone in
 * the product at once, not just the person refreshing. Hence staleTime of ten
 * minutes and a single retry.
 *
 * Everything is Eastern time, because the events are: an 8:30 print is 8:30 in
 * New York whatever the phone holding this page thinks the time is.
 */

const TEN_MINUTES = 10 * 60 * 1000

type Filter = 'all' | 'high' | 'earnings'

/** Rank rather than equality — the feed has sent 'High', 'high' and
 *  'High Impact Expected' at different times for the same thing. */
const impactRank = (s: string) => {
  const v = (s || '').toLowerCase()
  if (v.includes('high')) return 3
  if (v.includes('med')) return 2
  if (v.includes('low')) return 1
  return 0
}
const impactColour = (s: string) => (impactRank(s) === 3 ? T.warn : T.faint)
const impactWord = (s: string) => {
  const r = impactRank(s)
  return r === 3 ? 'high' : r === 2 ? 'medium' : r === 1 ? 'low' : (s || '').toLowerCase() || 'n/a'
}

/** "Mon 25 Aug". Built from the parts, never from `new Date(iso)` — parsing a
 *  bare 'YYYY-MM-DD' treats it as UTC midnight and shows the previous day to
 *  anyone west of Greenwich, which is most of the customers. */
const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

const capFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** 'bmo' / 'Before Market Open' / null all mean the same three things to a
 *  reader, and "before the bell" is the one they say out loud. */
const sessionWord = (s: string | null) => {
  const v = (s || '').toLowerCase()
  if (v.includes('bmo') || v.includes('before') || v.includes('pre')) return 'Before the bell'
  if (v.includes('amc') || v.includes('after') || v.includes('post')) return 'After the bell'
  return 'Time not given'
}

export default function Markets() {
  const [filter, setFilter] = useState<Filter>('all')

  const week = useQuery({
    queryKey: ['markets-week'],
    queryFn: markets.week,
    staleTime: TEN_MINUTES,
    retry: 1,
  })
  // Someone who turned a feed off should not see it here, on Today, or anywhere
  // else. This is read, not defaulted: assuming both on until settings arrive
  // would flash a calendar at the one person who has explicitly hidden it.
  const prefs = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get })

  const showEcon = prefs.data?.settings.showEconCalendar ?? true
  const showEarnings = prefs.data?.settings.showEarnings ?? true

  const data = week.data

  const byDay = useMemo(() => {
    const days = data?.days ?? []
    const econ = new Map<string, EconEvent[]>()
    const earn = new Map<string, EarningsRow[]>()
    for (const d of days) { econ.set(d, []); earn.set(d, []) }
    for (const e of data?.econ.events ?? []) econ.get(e.date)?.push(e)
    for (const r of data?.earnings.rows ?? []) earn.get(r.date)?.push(r)
    // Highest impact first inside a day, then by time. What you want off a
    // glance at a day is "is there anything big in here", and sorting by clock
    // buries an 8:30 CPI under three 8:00 nothings.
    for (const list of econ.values()) {
      list.sort((a, b) => impactRank(b.impact) - impactRank(a.impact) || a.time.localeCompare(b.time))
    }
    for (const list of earn.values()) {
      list.sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0))
    }
    return { days, econ, earn }
  }, [data])

  if (week.isLoading) return <div style={{ ...body(14), color: T.muted }}>Loading…</div>
  if (week.error) {
    return (
      <div>
        <div style={{ ...body(15), color: T.bad }}>
          {week.error instanceof ApiError ? week.error.message : 'Could not load this week.'}
        </div>
        <button onClick={() => void week.refetch()}
                style={{ ...segment(false), minHeight: 44, marginTop: 14 }}>
          Try again
        </button>
      </div>
    )
  }
  if (!data) return null

  if (!showEcon && !showEarnings) {
    return (
      <div>
        <div style={section()}>
          <div style={{ ...body(15), lineHeight: 1.5 }}>
            Both feeds are switched off, so there is nothing to show here.
          </div>
          <Link to="/settings" style={{ ...label({ color: T.accent }), display: 'inline-flex',
                                        minHeight: 44, alignItems: 'center', textDecoration: 'none' }}>
            Turn one back on in Settings ›
          </Link>
        </div>
      </div>
    )
  }

  // Which filters are worth offering depends on what's switched on: a "high
  // impact only" tab with the econ calendar hidden would filter an empty set.
  const filters: { id: Filter; text: string }[] = [
    { id: 'all', text: 'All' },
    ...(showEcon ? [{ id: 'high' as Filter, text: 'High impact' }] : []),
    ...(showEarnings ? [{ id: 'earnings' as Filter, text: 'Earnings' }] : []),
  ]
  const active = filters.some((f) => f.id === filter) ? filter : 'all'

  const econVisible = showEcon && active !== 'earnings'
  const earnVisible = showEarnings && active !== 'high'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={label({ letterSpacing: '0.1em', color: T.faint })}>
        The week ahead · Eastern time
      </div>

      {/*
        The warning and the note are rendered VERBATIM and above everything else,
        whenever the server sends them. This is the whole reason they exist: on
        the trading dashboard a hard upstream failure rendered as an ordinary
        quiet week — no events, no error, nothing wrong-looking — and nobody
        noticed for six weeks. An empty calendar and a broken calendar look
        identical unless something says which one you are looking at, so these
        lines are never summarised, never styled as an error, and never dropped
        because the page "looks fine".
      */}
      {showEcon && data.econ.warning && <Notice text={data.econ.warning} />}
      {showEarnings && data.earnings.note && <Notice text={data.earnings.note} />}

      {filters.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {filters.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
                    style={{ ...segment(active === f.id), minHeight: 44 }}>
              {f.text}
            </button>
          ))}
        </div>
      )}

      {byDay.days.map((d) => {
        const events = (byDay.econ.get(d) ?? []).filter((e) => active !== 'high' || impactRank(e.impact) === 3)
        const rows = byDay.earn.get(d) ?? []
        const showEvents = econVisible ? events : []
        const showRows = earnVisible ? rows : []
        const highCount = (byDay.econ.get(d) ?? []).filter((e) => impactRank(e.impact) === 3).length
        // "Nothing scheduled" is only true under All. Under a filter the honest
        // sentence is that nothing MATCHES — otherwise a day full of medium
        // prints reads as a day off.
        const emptyText = showEvents.length || showRows.length ? null
          : active === 'high' ? 'Nothing high impact.'
          : active === 'earnings' ? 'Nobody reporting.'
          : 'Nothing scheduled.'

        return (
          <div key={d} style={section()}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <div style={{ ...body(15), flex: 1 }}>{dayLabel(d)}</div>
              {econVisible && highCount > 0 && (
                <div style={label({ color: T.warn, letterSpacing: '0.08em' })}>
                  {highCount} high impact
                </div>
              )}
            </div>

            {/* A day with nothing on it says so. Blank space under a date reads
                as "still loading" and sends people back to pull-to-refresh. */}
            {emptyText && (
              <div style={{ ...body(13), color: T.muted, marginTop: 10 }}>{emptyText}</div>
            )}

            {showEvents.map((e, i) => <EventRow key={`${e.date}-${e.time}-${e.title}-${i}`} e={e} />)}

            {showRows.length > 0 && (
              <>
                {showEvents.length > 0 && (
                  <div style={label({ marginTop: 14, letterSpacing: '0.1em', color: T.faint })}>Reporting</div>
                )}
                {showRows.map((r) => <EarningRow key={`${r.date}-${r.symbol}`} r={r} />)}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The server's own sentence, unedited. Quiet — orange, not red: it is telling
 *  you the data may be stale, not that the app is broken. */
function Notice({ text }: { text: string }) {
  return (
    <div style={{ ...body(13), color: T.warn, lineHeight: 1.5 }}>
      {text}
    </div>
  )
}

function EventRow({ e }: { e: EconEvent }) {
  const high = impactRank(e.impact) === 3
  const figures = [
    e.actual ? `actual ${e.actual}` : null,
    e.forecast ? `forecast ${e.forecast}` : null,
    e.previous ? `prev ${e.previous}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div style={row({ alignItems: 'flex-start' })}>
      <span style={label({ width: 54, flexShrink: 0, letterSpacing: '0.06em',
                           color: high ? T.warn : T.muted })}>
        {e.time_formatted || e.time || '—'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...body(14), wordBreak: 'break-word', color: high ? T.ink : T.inkSoft }}>
          {e.title}
        </div>
        <div style={label({ marginTop: 3, letterSpacing: '0.08em', color: impactColour(e.impact) })}>
          {impactWord(e.impact)}
          {e.country ? ` · ${e.country}` : ''}
        </div>
        {figures && (
          <div style={label({ marginTop: 3, letterSpacing: '0.06em', color: T.faint })}>
            {figures}
          </div>
        )}
      </div>
    </div>
  )
}

function EarningRow({ r }: { r: EarningsRow }) {
  const cap = r.market_cap ? `$${capFmt.format(r.market_cap)}` : null
  const eps = r.eps_est === null ? null : `est ${r.eps_est.toFixed(2)}`

  return (
    <div style={row({ alignItems: 'flex-start' })}>
      <span style={label({ width: 54, flexShrink: 0, letterSpacing: '0.06em', color: T.accent })}>
        {r.symbol}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...body(14), wordBreak: 'break-word' }}>{r.company || r.symbol}</div>
        <div style={label({ marginTop: 3, letterSpacing: '0.08em', color: T.faint })}>
          {[sessionWord(r.session), cap, eps].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  )
}
