// Part L — Economic Calendar. v2 mounts its full EconCalendarPanel here with
// `todayOnly hideToolbar`, so this card is that panel in its narrowest
// configuration: TODAY only, no filter dropdown, no refresh button, no quote.
//
// The DATA is already v3's — data/econCalendar.ts carries the fetch, the
// bucketing, the staleness rule and the impact ramp, and it is shared with the
// board's own calendar card. Only the RENDERER is here, because v2's markup for
// this panel is specific: a 62px time gutter, a 3px left border in the impact
// colour, a horizontal gradient wash that fades out by 35%, and earnings rows
// woven into the day rather than listed under it.
//
// WHAT hideToolbar TAKES AWAY, and what it does not: the filter menu is gone
// from the UI but the FILTER IS STILL APPLIED. The fixed set is
// {all-usd, trump, earnings}, so this card shows every USD event, every
// presidential item, and earnings — and silently drops non-USD High/Medium/Low
// events. That is v2's behaviour and it is easy to mistake for missing data.

import type { ReactNode } from 'react'
import {
  fullDayLabel,
  groupEarningsByDate,
  impactColor,
  isStale,
  useEconCalendar,
  etToday,
  fmtMcap,
  passes,
  type CalEvent,
  type EarnRow,
  type FilterKey,
} from '@/data/econCalendar'
import { useIsOwner } from '@/data/auth'
import { FS, AnalysisCard } from '../kit'
import { CAL, V2, V2W, alpha } from '@/design/theme'

/** Fixed for this card — v2's default set, with no way to change it here. */
const FILTERS: Set<FilterKey> = new Set<FilterKey>(['all-usd', 'trump', 'earnings'])

const CHIP_W = 40
const CHIP_GAP = 8

export function EconCalendarCard() {
  const { events, earnings, quote: _quote, source, warning, error, loading, now } =
    useEconCalendar({ withQuote: false, week: 'both' })
  const { isOwner } = useIsOwner()

  const today = etToday()
  const activeDays = [today]

  const earnByDate = groupEarningsByDate(earnings)
  const showEarnings = FILTERS.has('all') || FILTERS.has('earnings')
  const anyEarnings = showEarnings && activeDays.some((d) => earnByDate.has(d))

  const dayEvents = events
    .filter((e) => activeDays.includes(e.date) && passes(e, FILTERS))
    .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time)))

  const activeEvents = dayEvents.filter((e) => !isStale(e, now))
  const staleEvents = dayEvents.filter((e) => isStale(e, now))

  return (
    <AnalysisCard flush>
      {/* Header — the hideToolbar variant: a name and a date, no controls, and
          NO 📅 emoji (that belongs to the toolbar-visible form). */}
      <div
        style={{
          padding: '5px 10px',
          background: V2W.panelBgStrong,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: `1px solid ${V2W.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
          position: 'relative',
          zIndex: 30,
        }}
      >
        <span
          style={{
            fontSize: FS.micro,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: V2.text,
            fontWeight: 700,
          }}
        >
          Economic Calendar
        </span>
        <span style={{ fontSize: FS.micro, color: CAL.low, marginLeft: 2 }}>{today}</span>
      </div>

      {/* Feed health — OWNER ONLY. It names upstream hosts, status codes and
          cache timestamps: diagnostics, not customer copy. A customer sees no
          banner either way, because when data is present it is real data and
          when it is not they get the plain empty line below. */}
      {isOwner && !loading && !error && warning && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'flex-start',
            padding: '5px 10px',
            borderTop: `1px solid ${V2W.border}`,
            background:
              source === 'unavailable' ? alpha(CAL.high, 0.1) : alpha(CAL.medium, 0.1),
            color: source === 'unavailable' ? CAL.high : CAL.medium,
            fontSize: FS.micro,
            lineHeight: 1.35,
          }}
        >
          <span style={{ flexShrink: 0 }}>⚠</span>
          <span style={{ wordBreak: 'break-word' }}>{warning}</span>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ color: V2.text, fontSize: FS.caption, padding: '8px 10px' }}>Loading…</div>
        ) : error && isOwner ? (
          // The raw fetch error, owner only — it can carry upstream hostnames
          // and status text. Customers fall through to the neutral line below.
          <div
            style={{ color: CAL.high, fontSize: FS.micro, padding: '6px 10px', wordBreak: 'break-all' }}
          >
            ⚠ {error}
          </div>
        ) : dayEvents.length === 0 && !anyEarnings ? (
          <div style={{ color: V2.text, fontSize: FS.caption, padding: '8px 10px' }}>
            {isOwner && warning
              ? 'No events available — see the notice above.'
              : 'No events this week.'}
          </div>
        ) : (
          <>
            <DaySections
              events={activeEvents}
              faded={false}
              today={today}
              activeDays={activeDays}
              earnByDate={earnByDate}
              showEarnings={showEarnings}
            />
            {staleEvents.length > 0 && (
              <>
                {activeEvents.length > 0 && (
                  <div style={{ height: 1, background: V2W.border, margin: '2px 0' }} />
                )}
                <DaySections
                  events={staleEvents}
                  faded
                  today={today}
                  activeDays={activeDays}
                  earnByDate={earnByDate}
                  showEarnings={showEarnings}
                />
              </>
            )}
          </>
        )}
      </div>
    </AnalysisCard>
  )
}

/**
 * Events grouped under day separators, with earnings woven IN rather than
 * listed after: premarket names ahead of the day's first event, after-hours
 * before the first event later than 16:00 (or at the end when there is none),
 * and unconfirmed-time names last.
 *
 * The tbd bucket goes last because it has no place in the day's sequence, and
 * anchoring it anywhere earlier would imply one. Before that bucket existed
 * those names were dropped outright, which is most of what "lots of names
 * missing" was.
 */
function DaySections({
  events,
  faded,
  today,
  activeDays,
  earnByDate,
  showEarnings,
}: {
  events: CalEvent[]
  faded: boolean
  today: string
  activeDays: string[]
  earnByDate: ReturnType<typeof groupEarningsByDate>
  showEarnings: boolean
}) {
  const out: ReactNode[] = []
  const byDate = new Map<string, CalEvent[]>()
  events.forEach((ev) => {
    if (!byDate.has(ev.date)) byDate.set(ev.date, [])
    byDate.get(ev.date)!.push(ev)
  })
  // Seed days that have earnings but no passing econ events, so a quiet day
  // still renders its earnings instead of nothing.
  if (!faded && showEarnings) {
    for (const d of activeDays) {
      if (earnByDate.has(d) && !byDate.has(d)) byDate.set(d, [])
    }
  }

  let i = 0
  for (const [date, evs] of [...byDate].sort((a, b) => a[0].localeCompare(b[0]))) {
    const isToday = date === today
    out.push(
      <div
        key={`sep-${faded ? 's' : 'a'}-${date}`}
        style={{
          padding: '4px 10px',
          background: isToday ? V2W.todayRow : V2W.panelBg,
          borderTop: `1px solid ${V2W.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: FS.caption,
            fontWeight: 800,
            color: isToday ? CAL.accent : CAL.low,
            letterSpacing: '0.1em',
          }}
        >
          {fullDayLabel(date, today)}
        </span>
        {isToday && (
          <span
            style={{
              fontSize: FS.micro,
              fontWeight: 900,
              background: CAL.accent,
              color: V2.badgeInk,
              padding: '1px 5px',
              borderRadius: 2,
              letterSpacing: '0.1em',
            }}
          >
            TODAY
          </span>
        )}
      </div>,
    )

    const bucket = faded || !showEarnings ? null : earnByDate.get(date)
    if (bucket?.pre.length) out.push(<EarnBlock key={`pre-${date}`} kind="pre" rows={bucket.pre} />)

    const afterIdx = evs.findIndex((e) => (e.time || '00:00') > '16:00')
    evs.forEach((ev, k) => {
      if (bucket?.after.length && afterIdx >= 0 && k === afterIdx) {
        out.push(<EarnBlock key={`aft-${date}`} kind="after" rows={bucket.after} />)
      }
      out.push(<EventRow key={`${ev.date}-${ev.time}-${i++}`} ev={ev} faded={faded} />)
    })
    if (bucket?.after.length && afterIdx < 0) {
      out.push(<EarnBlock key={`aft-${date}`} kind="after" rows={bucket.after} />)
    }
    if (bucket?.tbd.length) out.push(<EarnBlock key={`tbd-${date}`} kind="tbd" rows={bucket.tbd} />)
  }

  return <>{out}</>
}

function EventRow({ ev, faded }: { ev: CalEvent; faded: boolean }) {
  const col = faded ? CAL.faded : impactColor(ev.impact)
  const ink = faded ? CAL.faded : V2.text

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '62px 1fr',
        borderTop: `1px solid ${V2W.border}`,
        borderLeft: `3px solid ${col}`,
        // 0x0f/255 ≈ 5.9% — v2 writes it as a hex alpha suffix on the colour.
        background: faded
          ? V2.bg
          : `linear-gradient(90deg, ${alpha(col, 0.059)} 0%, transparent 35%), ${V2.bg}`,
        opacity: faded ? 0.32 : 1,
        transition: 'opacity 0.4s',
        minHeight: 48,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '6px 8px',
          borderRight: `1px solid ${V2W.border}`,
          // 0x18/255 ≈ 9.4%.
          boxShadow: faded ? 'none' : `inset -1px 0 8px ${alpha(col, 0.094)}`,
          gap: 2,
        }}
      >
        <span style={{ fontSize: FS.body, color: ink, fontFamily: 'var(--font-mono)' }}>
          {ev.time_formatted || ev.time || 'TBD'}
        </span>
      </div>

      <div
        style={{
          padding: '6px 8px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 3,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            style={{
              fontSize: FS.micro,
              fontWeight: 800,
              color: col,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            {ev.impact}
          </span>
          <span style={{ fontSize: FS.caption, color: ink, fontWeight: 600 }}>{ev.country}</span>
        </div>

        <div
          style={{
            fontSize: FS.body,
            color: ink,
            fontWeight: ev.impact === 'High' ? 700 : 500,
            lineHeight: 1.3,
          }}
        >
          {ev.title}
        </div>

        {(ev.actual || ev.forecast || ev.previous) && (
          <div style={{ display: 'flex', gap: 10, marginTop: 1 }}>
            {ev.actual && (
              <span
                style={{
                  fontSize: FS.caption,
                  color: faded ? CAL.faded : CAL.actual,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                A: <strong>{ev.actual}</strong>
              </span>
            )}
            {ev.forecast && (
              <span
                style={{
                  fontSize: FS.caption,
                  color: faded ? CAL.faded : CAL.forecast,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                F: {ev.forecast}
              </span>
            )}
            {ev.previous && (
              <span
                style={{
                  fontSize: FS.caption,
                  color: faded ? CAL.faded : CAL.previous,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                P: {ev.previous}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

type EarnKind = 'pre' | 'after' | 'tbd'

/** `tbd` is desaturated so it never reads as a confirmed session at a glance. */
const EARN_KIND: Record<EarnKind, { top: string; sub: string; title: string; color: string }> = {
  pre: { top: 'PRE', sub: 'MKT', title: 'Premarket earnings', color: CAL.accent },
  after: { top: 'AFTER', sub: 'HRS', title: 'After-hours earnings', color: CAL.accent },
  tbd: { top: 'TIME', sub: 'TBD', title: 'Time unconfirmed', color: CAL.previous },
}

function EarnBlock({ kind, rows }: { kind: EarnKind; rows: EarnRow[] }) {
  const k = EARN_KIND[kind]
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '62px 1fr',
        borderTop: `1px solid ${V2W.border}`,
        borderLeft: `3px solid ${k.color}`,
        // 0x12/255 ≈ 7%.
        background: `linear-gradient(90deg, ${alpha(k.color, 0.071)} 0%, transparent 40%), ${V2.bg}`,
        minHeight: 48,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '6px 8px',
          borderRight: `1px solid ${V2W.border}`,
          boxShadow: `inset -1px 0 8px ${alpha(k.color, 0.094)}`,
        }}
      >
        <span
          style={{
            fontSize: FS.micro,
            color: k.color,
            fontFamily: 'var(--font-mono)',
            fontWeight: 800,
            lineHeight: 1.25,
          }}
        >
          {k.top}
        </span>
        <span style={{ fontSize: FS.micro, color: CAL.low, fontFamily: 'var(--font-mono)' }}>{k.sub}</span>
      </div>

      <div
        style={{
          padding: '6px 8px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        <span
          style={{
            fontSize: FS.micro,
            fontWeight: 800,
            color: k.color,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          {k.title}
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: CHIP_GAP }}>
          {rows.map((e) => (
            <a
              key={e.symbol}
              href={`https://finance.yahoo.com/quote/${e.symbol}`}
              target="_blank"
              rel="noreferrer"
              title={`${e.company || e.symbol} · ${fmtMcap(e.market_cap)}${e.eps_est ? ` · est ${e.eps_est}` : ''}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                flexShrink: 0,
                width: CHIP_W,
                textDecoration: 'none',
              }}
            >
              {/* v2 renders a ChipLogo here: local mirror → /proxy/ticker-logo →
                  a text chip. v3 has no ChipLogo yet, so this is the text chip
                  its own last fallback would have produced — the same shape and
                  the same size, without a half-ported image pipeline. */}
              <span
                style={{
                  width: CHIP_W,
                  height: CHIP_W,
                  borderRadius: 6,
                  border: `1px solid ${V2W.border}`,
                  background: V2W.wash04,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: FS.small,
                  fontWeight: 800,
                  color: V2.text,
                  fontFamily: 'var(--font-mono)',
                  overflow: 'hidden',
                }}
              >
                {e.symbol.slice(0, 4)}
              </span>
              <span
                style={{
                  fontSize: FS.micro,
                  fontWeight: 700,
                  color: V2.text,
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.02em',
                  maxWidth: CHIP_W,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {e.symbol}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
