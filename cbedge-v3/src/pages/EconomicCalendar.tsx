// ─────────────────────────────────────────────────────────────────────────────
// ECONOMIC CALENDAR & EARNINGS — /v3/economic-calendar
//
// A port of v2's /app/economic-calendar (components/pages/EconomicCalendar.tsx,
// 1,303 lines). The SPEC is docs/parity/economic-calendar.md: one row per
// rendered value, 176 of them, and this page is finished when every row is
// ticked. The thresholds, the label wording, the insertion order of the woven
// earnings blocks and the exact set of fields are TRANSCRIBED from v2; only the
// palette and the render layer are new.
//
// TWO TABS over one feed:
//   Calendar — timed econ events with earnings WOVEN INTO the day.
//   Earnings — a five-column week board, one column per trading day.
//
// ── Decisions taken on the inventory (Brandon, 2026-09-03) ───────────────────
//   1. TYPE SIZES COLLAPSE DOWN. v2 uses 12px and 14px, neither on v3's scale
//      (9/10/11/13/15/18). 12 → text-xs (11), 14 → text-sm (13). Down rather
//      than up so the size ORDER survives everywhere — rounding 14 up to 15
//      would have made an event title larger than the board header's own title.
//   2. ALL TEN FILTERS SHIP. v2's page declared its own 8-key FILTER_OPTS,
//      dropping `all-usd` and `earnings` from the shared list. This page takes
//      the shared 10 from @/data/econCalendar — `earnings` is the only control
//      that can isolate the woven blocks, and this page had no other one.
//   3. LONG DAY LABEL. "MONDAY SEPTEMBER 1", v2's page wording, not the shared
//      module's "MONDAY SEP 1". See fullDayLabelLong in @/data/econCalendar.
//
// Four v2 defects fixed rather than transcribed (Part Q of the spec, each one
// its own recommendation there — none of them removes a value):
//   Q4 the date chip was gated on `lastRefresh` but rendered `today`, so it was
//      invisible until the first load and then never changed. It now shows the
//      ET date unconditionally and the refresh time beside it.
//   Q5 `source` was fetched and never read. A feed serving "unavailable" is now
//      named in the owner banner.
//   Q6 one `search` string was shared across both tabs, so a calendar query
//      silently filtered the earnings board. One query per tab.
//   Q9 the tab was not in the URL, so every shared link opened on Calendar.
//      `?tab=earnings`, the shape /v3/scanner already uses.
//
// ── Architecture notes ───────────────────────────────────────────────────────
// NO SOCKET. Three REST reads, fired in PARALLEL at entry through useQuery, so
// non-negotiables 2, 3, 4, 5 and 6 have nothing to bite on. The feeds do not
// poll: economic events are scheduled days ahead and the server caches for 30
// minutes. What ticks is `now`, once a minute, purely so the 30-minute
// staleness cutoff re-evaluates and events fade as they pass.
//
// useQuery rather than the useEconCalendar hook in @/data/econCalendar. That
// hook narrows ONCE, and this page needs TWO different narrowings out of one
// feed — the calendar tab is always the ~14/day anticipated set, while the
// board honours the Anticipated/All toggle. Reading the raw rows here also
// means the rail's prefetch actually primes what the page reads, and that the
// board card already holding /api/calendar pays for it once.
//
// FAILURE SEMANTICS WORTH KNOWING: /api/calendar answers HTTP 200 with an empty
// events array when the upstream is down, so an ok response tells you nothing.
// The real signal is `source` ("forexfactory" | "cache" | "saved" |
// "unavailable") plus `warning`. Both are owner-only chrome — they name
// upstream hosts, HTTP status codes and cache timestamps.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { query, useQuery } from '@/data/api'
import { useIsOwner } from '@/data/auth'
import {
  ANTICIPATED_PER_DAY,
  bucketCount,
  type CalEvent,
  type EarnBucket,
  type EarnRow,
  FILTER_OPTS,
  type FilterKey,
  fmtMcap,
  fullDayLabelLong,
  groupEarningsByDate,
  impactColor,
  isStale,
  etMonFri,
  etToday,
  passes,
  pickAnticipated,
} from '@/data/econCalendar'
import { Popover } from '@/design/primitives/Controls'
import { Page } from '@/design/primitives/Page'
import { CAL, SHADOW, T, V2, V2W, alpha } from '@/design/theme'
import { NO_TARGETS, type CopyShotTarget, useCopyShotTargets } from '@/shell/CopyShot'
import { ChipLogo } from './economicCalendar/ChipLogo'
import {
  BOARD,
  CHIP_GAP,
  CHIP_LOGO,
  CHIP_MIN,
  CHIP_W,
  dayDate,
  dayFull,
} from './economicCalendar/board'

// ── Endpoints ────────────────────────────────────────────────────────────────
// Both weeks in ONE request: the board's week toggle is a filter over rows in
// hand, so flipping it costs nothing and the camera captures whatever shows.
const URL_CAL = '/api/calendar'
const URL_QUOTE = '/api/calendar-quote'
const URL_EARN = '/proxy/earnings-week?week=both'
/** The server caches for 30 minutes; asking more often than half that is waste. */
const FEED_STALE_MS = 600_000
const CLOCK_MS = 60_000

interface CalendarResponse {
  events?: CalEvent[]
  source?: string
  warning?: string
  error?: string
}
interface QuoteResponse {
  quote?: string
}
interface EarningsResponse {
  ok?: boolean
  rows?: EarnRow[]
}

type TabKey = 'calendar' | 'earnings'
type ViewKey = 'anticipated' | 'all'

/**
 * How many names the board shows.
 *
 * "Anticipated" is the shared rule in @/data/econCalendar — mcap ≥ $25B, OR on
 * the maintained interest list, then topped up to ~14/day by size. "All" is
 * every name Nasdaq lists for the week: several hundred a day, which is a
 * legitimate thing to want and a terrible default.
 *
 * This exists at ALL because the recorder used to do the narrowing server-side
 * with a hard $25B cut, so "all" was never reachable from the UI — the missing
 * names had never been stored.
 */
const VIEW_OPTS: Array<{ value: ViewKey; label: string; hint: string }> = [
  { value: 'anticipated', label: 'Anticipated', hint: 'Most-watched names, ~14 per day' },
  { value: 'all', label: 'All', hint: 'Every name on the Nasdaq calendar' },
]

/**
 * Earnings market-cap floor for the dropdown.
 *
 * A pure client-side narrowing of rows already in hand — changing it never
 * refetches. 0 = show whatever the feed returned, which is the honest default:
 * a hardcoded floor here would silently re-hide the names the recorder was
 * widened to include when its own floor came out.
 */
const MCAP_OPTS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'All caps' },
  { value: 1e9, label: '≥ $1B' },
  { value: 10e9, label: '≥ $10B' },
  { value: 25e9, label: '≥ $25B' },
  { value: 100e9, label: '≥ $100B' },
  { value: 1e12, label: '≥ $1T' },
]

// ── Session kinds ────────────────────────────────────────────────────────────
// `board` is the week-board's session label — shorter than `title` because it
// sits in a ~200px column. Coloured per session so PRE and AFTER are
// distinguishable at a glance; they used to share one accent.
type EarnKind = 'pre' | 'after' | 'tbd'
const EARN_KIND: Record<EarnKind, { top: string; sub: string; title: string; board: string; color: string }> = {
  pre: { top: 'PRE', sub: 'MARKET', title: 'Premarket earnings', board: 'Premarket', color: CAL.accent },
  after: { top: 'AFTER', sub: 'HOURS', title: 'After-hours earnings', board: 'After hours', color: V2.orange },
  // Deliberately desaturated: guessing a session would put a name on the wrong
  // side of the close, which is worse than saying the time is unconfirmed.
  tbd: { top: 'TIME', sub: 'TBD', title: 'Time unconfirmed', board: 'Time unconfirmed', color: T.text },
}

/**
 * "SEP 1–SEP 5" for a list of ET dates. Tolerates a short list rather than
 * indexing into it blind — the feed decides how many days come back.
 */
function rangeLabel(days: string[], sep = '–'): string {
  const a = days[0]
  const b = days[days.length - 1]
  if (!a || !b) return ''
  return `${dayDate(a)}${sep}${dayDate(b)}`
}

/** The week toggle's tooltip. Spaces around the dash, as v2 has it. */
function weekRangeLabel(offsetWeeks: 0 | 1): string {
  return rangeLabel(etMonFri(offsetWeeks), ' – ')
}

/** The Yahoo quote page a ticker chip links to, on both tabs. */
function quoteHref(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`
}

/** Cap and EPS estimate, one hover away — where a per-name detail belongs. */
function chipTitle(r: EarnRow): string {
  return `${r.company || r.symbol} · ${fmtMcap(r.market_cap)}${r.eps_est ? ` · est ${r.eps_est}` : ''}`
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE PAGE
// ═════════════════════════════════════════════════════════════════════════════

export default function EconomicCalendar() {
  const [params, setParams] = useSearchParams()
  const activeTab: TabKey = params.get('tab') === 'earnings' ? 'earnings' : 'calendar'
  const setTab = (t: TabKey) => {
    const next = new URLSearchParams(params)
    if (t === 'calendar') next.delete('tab')
    else next.set('tab', t)
    setParams(next, { replace: true })
  }

  // Owner-only chrome. `isOwner` is false while loading, so nothing flashes for
  // a customer. Same fail-closed rule as v2's: the claim OR an explicit id
  // match, never a bare "is signed in".
  const { isOwner } = useIsOwner()

  const cal = useQuery<CalendarResponse>(URL_CAL, { staleMs: FEED_STALE_MS })
  const quote = useQuery<QuoteResponse>(URL_QUOTE, { staleMs: FEED_STALE_MS })
  const earn = useQuery<EarningsResponse>(URL_EARN, { staleMs: FEED_STALE_MS })

  const [now, setNow] = useState(() => Date.now())
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(() => new Set<FilterKey>(['all']))
  const [dropOpen, setDropOpen] = useState(false)
  const [capOpen, setCapOpen] = useState(false)
  const [mcapMin, setMcapMin] = useState(0)
  /** 0 = this week, 1 = next. The feed carries both, so this is a filter. */
  const [earnWeek, setEarnWeek] = useState<0 | 1>(0)
  const [earnView, setEarnView] = useState<ViewKey>('anticipated')
  // Q6: ONE QUERY PER TAB. v2 shared a single string, so typing "fed" on the
  // calendar tab silently filtered the earnings board by "fed".
  const [calSearch, setCalSearch] = useState('')
  const [earnSearch, setEarnSearch] = useState('')

  // Moves rows from active → stale. NOT a refetch: the calendar is a weekly
  // file and re-pulling it every minute would be a lot of bytes for no events.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => clearInterval(id)
  }, [])

  /**
   * Manual refresh. `refetch()` alone honours the stale window, and the whole
   * point of pressing a refresh button is to go and ask again — so the three
   * URLs are re-queried at staleMs 0 first and the hooks then read the fresh
   * cache. Dedupe still applies, so the board card sharing /api/calendar makes
   * no second request.
   */
  const reload = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([
        query(URL_CAL, { staleMs: 0 }).catch(() => null),
        query(URL_QUOTE, { staleMs: 0 }).catch(() => null),
        query(URL_EARN, { staleMs: 0 }).catch(() => null),
      ])
      cal.refetch()
      quote.refetch()
      earn.refetch()
      setLastRefresh(new Date().toLocaleTimeString())
    } finally {
      setRefreshing(false)
    }
  }, [cal, quote, earn])

  // ── Derivations ────────────────────────────────────────────────────────────

  const today = etToday()

  /**
   * Sorted date-then-time. The server sorts too, but the fallback paths
   * (cache, saved events.json) merge two sources and the page renders in row
   * order, so the sort is load-bearing rather than defensive.
   */
  const events = useMemo<CalEvent[]>(() => {
    const list = cal.data?.events
    if (!Array.isArray(list)) return []
    return [...list].sort((a, b) =>
      a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time),
    )
  }, [cal.data])

  const earnings = useMemo<EarnRow[]>(() => earn.data?.rows ?? [], [earn.data])

  /** The cap floor. Applied BEFORE bucketing, so a day left with no qualifying
   *  names drops out of the Map entirely and its separator stops rendering —
   *  rather than showing an empty PRE/AFTER strip. */
  const capped = useCallback(
    (rows: EarnRow[]) => (mcapMin > 0 ? rows.filter((r) => r.market_cap >= mcapMin) : rows),
    [mcapMin],
  )

  /**
   * The CALENDAR tab's earnings, ALWAYS the anticipated subset.
   *
   * pickAnticipated is not optional here. The feed is the whole Nasdaq calendar
   * (~500 names a day) and a 400-chip block wedged between two timed events is
   * not a calendar. "Show me everything" lives on the earnings tab.
   */
  const earnByDate = useMemo(
    () => groupEarningsByDate(capped(pickAnticipated(earnings))),
    [earnings, capped],
  )

  /** Mon–Fri of the selected week. etMonFri rolls weekends FORWARD, exactly as
   *  the recorder's weekMonFri does, so "this week" on a Saturday is the week
   *  that starts Monday — the same week the server stored. */
  const boardDays = useMemo(() => etMonFri(earnWeek), [earnWeek])

  /** The EARNINGS tab's week board — honours the week and view toggles, and is
   *  allowed to show everything (`perDay <= 0` returns the lot). */
  const boardByDate = useMemo(() => {
    const inWeek = earnings.filter((r) => boardDays.includes(r.date))
    return groupEarningsByDate(
      capped(pickAnticipated(inWeek, earnView === 'all' ? 0 : ANTICIPATED_PER_DAY)),
    )
  }, [earnings, boardDays, earnView, capped])

  /** Names renderable at the current floor, for the MCAP button's label.
   *  Counted off the bucketed Map for the tab IN VIEW, not off the raw feed, so
   *  the number matches what is on screen. */
  const earnShown = useMemo(() => {
    let n = 0
    for (const b of (activeTab === 'earnings' ? boardByDate : earnByDate).values()) n += bucketCount(b)
    return n
  }, [earnByDate, boardByDate, activeTab])

  const mcapLabel = MCAP_OPTS.find((o) => o.value === mcapMin)?.label ?? 'All caps'

  const toggleFilter = (key: FilterKey) => {
    setActiveFilters((prev) => {
      if (key === 'all') return new Set<FilterKey>(['all'])
      const next = new Set(prev)
      next.delete('all')
      if (next.has(key)) {
        next.delete(key)
        if (next.size === 0) next.add('all')
      } else {
        next.add(key)
      }
      return next
    })
  }

  const filterLabel = activeFilters.has('all')
    ? 'ALL'
    : [...activeFilters].map((k) => FILTER_OPTS.find((o) => o.value === k)?.label ?? k).join(' + ')

  /** Earnings are woven into the calendar tab when "All" or "Earnings" is on.
   *  Selecting only "Earnings" isolates them — no econ event passes. */
  const showEarnings = activeFilters.has('all') || activeFilters.has('earnings')

  const calQ = calSearch.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      events.filter(
        (ev) =>
          passes(ev, activeFilters) &&
          (!calQ ||
            (ev.title || '').toLowerCase().includes(calQ) ||
            (ev.country || '').toLowerCase().includes(calQ)),
      ),
    [events, activeFilters, calQ],
  )
  const activeEvents = filtered.filter((e) => !isStale(e, now))
  const staleEvents = filtered.filter((e) => isStale(e, now))

  // ── The earnings tab's sections ────────────────────────────────────────────
  const earnQ = earnSearch.trim().toLowerCase()
  const earningsSections = useMemo(() => {
    const matches = (r: EarnRow) =>
      !earnQ || r.symbol.toLowerCase().includes(earnQ) || (r.company || '').toLowerCase().includes(earnQ)
    return [...boardByDate.keys()]
      .sort()
      .flatMap((date) => {
        const b = boardByDate.get(date)
        if (!b) return []
        const s = { date, pre: b.pre.filter(matches), after: b.after.filter(matches), tbd: b.tbd.filter(matches) }
        return s.pre.length || s.after.length || s.tbd.length ? [s] : []
      })
  }, [boardByDate, earnQ])

  // ── 📸 The camera ──────────────────────────────────────────────────────────
  //
  // v2 carried its own "⧉ Copy" button and switched what it photographed by
  // tab: the earnings tab captured the BOARD ALONE (it carries its own header
  // and signature, so the pasted image is a self-contained card rather than a
  // screenshot of an app) and the calendar tab captured the whole page.
  //
  // Same two targets, same rule, published to the one camera that lives in the
  // toolbar. v3 captures through <foreignObject>, so v2's html2canvas
  // workarounds — data-cap-center, data-cap-swatch, the concrete mono fallback
  // stack, the scroll-box expand/restore dance — do not come across. What DOES
  // come across is `lazy={false}` on the board's logos: any capture engine
  // clones the DOM as it stands, and a chip the browser has not fetched yet
  // captures empty.
  const pageRef = useRef<HTMLDivElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const boardMounted = activeTab === 'earnings' && earningsSections.length > 0
  const shotTargets = useMemo<CopyShotTarget[]>(
    () =>
      boardMounted
        ? [
            {
              id: 'econ-calendar:board',
              icon: '📅',
              label: 'Earnings week board',
              group: 'This page',
              meta: `${earnWeek === 0 ? 'This week' : 'Next week'} · ${earnShown} names`,
              file: `earnings-${earnWeek === 0 ? 'this' : 'next'}-week-${today}`,
              resolve: () => boardRef.current,
            },
          ]
        : activeTab === 'calendar'
          ? [
              {
                id: 'econ-calendar:page',
                icon: '📅',
                label: 'Economic Calendar',
                group: 'This page',
                meta: today,
                file: `econ-calendar-${today}`,
                resolve: () => pageRef.current,
              },
            ]
          : NO_TARGETS,
    [boardMounted, activeTab, earnWeek, earnShown, today],
  )
  useCopyShotTargets(shotTargets)

  // ── Feed health (owner only) ───────────────────────────────────────────────
  // Q5: `source` is read now. v2 fetched it and threw it away, so a feed
  // serving "unavailable" looked identical to a quiet week.
  const feedSource = cal.data?.source ?? null
  const feedWarning = cal.data?.warning ?? null
  const feedError = cal.error?.message ?? cal.data?.error ?? null
  const loadingCal = cal.loading && events.length === 0
  const loadingEarn = earn.loading && earnings.length === 0

  return (
    <Page fill>
      <div ref={pageRef} className="flex min-h-0 flex-1 flex-col" style={{ background: V2.bg }}>
        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2"
          style={{
            background: V2W.panelBgStrong,
            backdropFilter: 'blur(16px)',
            borderBottomColor: V2W.border,
          }}
        >
          <div className="flex flex-wrap items-center gap-3">
            {/* Served from the v2 public/ root, which is the same origin. */}
            <img src="/cb-edge-logo.png" alt="CB Edge" className="block h-5 w-auto shrink-0" />
            <span className="text-xs font-extrabold uppercase tracking-[0.15em] text-fg">
              Economic Calendar
            </span>
            {/* Q4: unconditional. v2 gated this on `lastRefresh` and then printed
                `today`, so it was invisible until the first load and never once
                showed the thing it was gated on. */}
            <span
              className="tabular rounded-sm px-2 py-0.5 font-mono text-xs text-fg"
              style={{ background: V2W.panelBg }}
            >
              {today}
              {lastRefresh ? ` · ${lastRefresh}` : ''}
            </span>

            <Seg
              options={[
                { value: 'calendar', label: 'Calendar' },
                { value: 'earnings', label: 'Earnings' },
              ]}
              value={activeTab}
              onChange={setTab}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Impact filters — calendar tab only. Multi-select, menu stays open. */}
            {activeTab === 'calendar' && (
              <div className="relative">
                <PillButton onClick={() => setDropOpen((o) => !o)}>
                  {filterLabel} <span className="text-2xs">▾</span>
                </PillButton>
                <Popover open={dropOpen} onClose={() => setDropOpen(false)}>
                  <div className="min-w-[180px]">
                    {FILTER_OPTS.map((o) => {
                      const on = activeFilters.has(o.value)
                      return (
                        <MenuRow key={o.value} on={on} onClick={() => toggleFilter(o.value)}>
                          <span
                            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] text-2xs font-black"
                            style={{
                              border: `2px solid ${o.color}`,
                              background: on ? o.color : 'transparent',
                              color: V2.badgeInk,
                            }}
                          >
                            {on ? '✓' : ''}
                          </span>
                          <span
                            className="text-sm font-semibold"
                            style={{ color: on ? CAL.accent : T.text }}
                          >
                            {o.label}
                          </span>
                        </MenuRow>
                      )
                    })}
                  </div>
                </Popover>
              </div>
            )}

            {/* Week + breadth — earnings tab only. Both are filters over rows
                already in hand: no refetch, no spinner. */}
            {activeTab === 'earnings' && (
              <>
                <Seg
                  options={[
                    { value: 0 as const, label: 'This wk', title: weekRangeLabel(0) },
                    { value: 1 as const, label: 'Next wk', title: weekRangeLabel(1) },
                  ]}
                  value={earnWeek}
                  onChange={setEarnWeek}
                />
                <Seg
                  options={VIEW_OPTS.map((o) => ({ value: o.value, label: o.label, title: o.hint }))}
                  value={earnView}
                  onChange={setEarnView}
                />
              </>
            )}

            {/* Market-cap floor. On BOTH tabs: the calendar tab weaves the same
                rows between events, so the floor has to be reachable there too
                or the chips can only be thinned from a tab you are not on. */}
            <div className="relative">
              <PillButton
                onClick={() => setCapOpen((o) => !o)}
                title="Minimum market cap for earnings names"
              >
                <span className="font-extrabold tracking-[0.06em]" style={{ color: CAL.accent }}>
                  MCAP
                </span>
                {mcapLabel}
                <span className="tabular font-mono text-2xs" style={{ color: CAL.low }}>
                  {earnShown}
                </span>
                <span className="text-2xs">▾</span>
              </PillButton>
              <Popover open={capOpen} onClose={() => setCapOpen(false)}>
                <div className="min-w-[170px]">
                  {MCAP_OPTS.map((o) => {
                    const on = o.value === mcapMin
                    return (
                      <MenuRow
                        key={o.value}
                        on={on}
                        onClick={() => {
                          setMcapMin(o.value)
                          setCapOpen(false)
                        }}
                      >
                        <span
                          className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-3xs font-black"
                          style={{
                            border: `2px solid ${CAL.accent}`,
                            background: on ? CAL.accent : 'transparent',
                            color: V2.badgeInk,
                          }}
                        >
                          {on ? '✓' : ''}
                        </span>
                        <span className="text-sm font-semibold" style={{ color: on ? CAL.accent : T.text }}>
                          {o.label}
                        </span>
                      </MenuRow>
                    )
                  })}
                </div>
              </Popover>
            </div>

            <input
              type="text"
              value={activeTab === 'earnings' ? earnSearch : calSearch}
              onChange={(e) =>
                activeTab === 'earnings' ? setEarnSearch(e.target.value) : setCalSearch(e.target.value)
              }
              placeholder={activeTab === 'earnings' ? 'Search ticker…' : 'Search…'}
              aria-label={activeTab === 'earnings' ? 'Search ticker' : 'Search events'}
              className="w-[140px] rounded-sm border px-2.5 py-1 text-xs text-fg outline-none"
              style={{ background: alpha(SHADOW, 0.4), borderColor: V2W.border }}
            />

            <PillButton onClick={() => void reload()} disabled={refreshing} hideFromCapture>
              {refreshing ? '…' : '↻ Now'}
            </PillButton>
          </div>
        </div>

        {/* ── Quote of the day — calendar tab only ─────────────────────────── */}
        {activeTab === 'calendar' && quote.data?.quote && (
          <div
            className="shrink-0 border-b px-5 py-2.5 text-center"
            style={{
              background: V2W.panelBgStrong,
              backdropFilter: 'blur(16px)',
              borderBottomColor: V2W.border,
            }}
          >
            <span className="text-sm italic leading-loose text-fg">&ldquo;{quote.data.quote}&rdquo;</span>
          </div>
        )}

        {/* ── Feed health — OWNER ONLY. Names upstream hosts, HTTP status codes
            and cache timestamps: diagnostics, not customer copy. ──────────── */}
        {activeTab === 'calendar' && isOwner && !feedError && (feedWarning || feedSource === 'unavailable') && (
          <div
            className="shrink-0 border-b px-4 py-1.5 text-xs"
            style={{
              color: CAL.medium,
              background: alpha(CAL.medium, 0.06),
              borderBottomColor: alpha(CAL.medium, 0.25),
            }}
          >
            ⚠ {feedWarning ?? `Economic feed source: ${feedSource}.`}
          </div>
        )}

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {activeTab === 'earnings' ? (
            loadingEarn ? (
              <Loading />
            ) : (
              <EarningsBoard
                boardRef={boardRef}
                sections={earningsSections}
                today={today}
                earnWeek={earnWeek}
                allRows={earnings}
                boardDays={boardDays}
                mcapMin={mcapMin}
                mcapLabel={mcapLabel}
                earnShown={earnShown}
              />
            )
          ) : feedError && isOwner ? (
            // Raw fetch error, owner only. Customers fall through to the
            // neutral empty line below rather than seeing upstream status text.
            <div
              className="m-4 rounded border p-4 text-sm"
              style={{
                color: CAL.high,
                borderColor: alpha(CAL.high, 0.3),
                background: alpha(CAL.high, 0.05),
              }}
            >
              ⚠ {feedError}
            </div>
          ) : loadingCal ? (
            <Loading />
          ) : filtered.length === 0 ? (
            <div className="p-5 text-sm text-fg">No events match.</div>
          ) : (
            <>
              <DayStream
                events={activeEvents}
                faded={false}
                today={today}
                earnByDate={showEarnings ? earnByDate : null}
              />
              {staleEvents.length > 0 && (
                <>
                  {activeEvents.length > 0 && <div className="my-0.5 h-px" style={{ background: V2W.border }} />}
                  {/* Earnings are never woven into the stale section. */}
                  <DayStream events={staleEvents} faded today={today} earnByDate={null} />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Page>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
//  SHARED CHROME
// ═════════════════════════════════════════════════════════════════════════════

function Loading() {
  return <div className="mt-16 text-center text-sm text-fg">Loading…</div>
}

/** v2's homeButtonStyle, as one component so no call site re-derives it. */
function PillButton({
  children,
  onClick,
  disabled,
  title,
  hideFromCapture = false,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
  /** Kept out of the PNG. v2 spelled this data-noshot; v3's engine reads
   *  data-capture-hide. Only matters for the whole-page (calendar tab) shot —
   *  the board capture excludes the toolbar outright. */
  hideFromCapture?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-2xs font-bold uppercase tracking-[0.08em] disabled:opacity-45"
      style={{
        border: `1px solid ${alpha(CAL.accent, 0.25)}`,
        background: `linear-gradient(180deg, ${alpha(CAL.accent, 0.12)}, ${alpha(CAL.accent, 0.04)})`,
        color: CAL.accent,
      }}
      {...(hideFromCapture ? { 'data-capture-hide': '' } : null)}
    >
      {children}
    </button>
  )
}

/**
 * v2's segmented pill group — tabs, week toggle, view toggle, all the same
 * shape. Not `design/primitives/Controls`'s SegGroup: this page's active state
 * is a SOLID accent fill with dark ink, which is v2's language on this surface
 * and is what the board's TODAY pill matches.
 */
function Seg<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; title?: string }>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div
      className="flex gap-1 rounded-md border p-0.5"
      style={{ background: V2W.panelBg, borderColor: V2W.border }}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            title={o.title}
            onClick={() => onChange(o.value)}
            className="rounded px-3 py-1 text-xs font-extrabold uppercase tracking-[0.06em] transition-colors"
            style={{
              background: on ? CAL.accent : 'transparent',
              color: on ? V2.badgeInk : T.text,
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** One row in either dropdown. Hover tint only when not selected. */
function MenuRow({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick()
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2"
      style={{
        background: on
          ? `linear-gradient(180deg, ${alpha(CAL.accent, 0.16)}, ${alpha(CAL.accent, 0.04)})`
          : hover
            ? alpha(CAL.accent, 0.1)
            : 'transparent',
        border: `1px solid ${on ? alpha(CAL.accent, 0.3) : 'transparent'}`,
      }}
    >
      {children}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
//  CALENDAR TAB
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Day separators, event rows, and the earnings woven between them.
 *
 * INSERTION ORDER, transcribed exactly — this is the part of the page that a
 * rebuild-from-description loses:
 *   1. PRE block, immediately after the day separator, before every event.
 *   2. AFTER block, immediately BEFORE the first event later than 16:00 ET.
 *   3. If no event is past 16:00, the AFTER block goes at the end of the day.
 *   4. TBD block always LAST — an unconfirmed time has no position in the day's
 *      sequence, so anchoring it anywhere earlier would imply one.
 */
function DayStream({
  events,
  faded,
  today,
  earnByDate,
}: {
  events: CalEvent[]
  faded: boolean
  today: string
  /** null on the stale pass — earnings are never woven into it. */
  earnByDate: Map<string, EarnBucket> | null
}) {
  const byDate = new Map<string, CalEvent[]>()
  for (const ev of events) {
    const list = byDate.get(ev.date)
    if (list) list.push(ev)
    else byDate.set(ev.date, [ev])
  }

  const out: ReactNode[] = []
  let i = 0
  for (const [date, evs] of byDate) {
    const isTod = date === today
    out.push(
      <div
        key={`sep-${faded ? 's' : 'a'}-${date}`}
        className="flex items-center gap-2 border-t px-4 py-1.5"
        style={{ background: isTod ? V2W.todayRow : V2W.panelBg, borderTopColor: V2W.border }}
      >
        {/* White on every day, today included — the accent pill and the tinted
            row already mark today, and a dimmed label made every other date
            read as disabled. */}
        <span className="text-xs font-extrabold tracking-[0.1em] text-fg">
          {fullDayLabelLong(date, today)}
        </span>
        {isTod && (
          <span
            className="rounded-sm px-1.5 py-px text-2xs font-black tracking-[0.1em]"
            style={{ background: CAL.accent, color: V2.badgeInk }}
          >
            TODAY
          </span>
        )}
      </div>,
    )

    const bucket = faded ? null : (earnByDate?.get(date) ?? null)
    if (bucket?.pre.length) out.push(<EarnRowBlock key={`pre-${date}`} kind="pre" rows={bucket.pre} />)

    const afterIdx = evs.findIndex((e) => (e.time || '00:00') > '16:00')
    evs.forEach((ev, k) => {
      if (bucket?.after.length && afterIdx >= 0 && k === afterIdx) {
        out.push(<EarnRowBlock key={`aft-${date}`} kind="after" rows={bucket.after} />)
      }
      out.push(<EventRow key={`${ev.date}-${ev.time}-${i++}`} ev={ev} faded={faded} />)
    })
    if (bucket?.after.length && afterIdx < 0) {
      out.push(<EarnRowBlock key={`aft-${date}`} kind="after" rows={bucket.after} />)
    }
    if (bucket?.tbd.length) out.push(<EarnRowBlock key={`tbd-${date}`} kind="tbd" rows={bucket.tbd} />)
  }
  return <>{out}</>
}

function EventRow({ ev, faded }: { ev: CalEvent; faded: boolean }) {
  const col = faded ? CAL.faded : impactColor(ev.impact)
  const body = faded ? CAL.faded : T.text
  const hasValues = Boolean(ev.actual || ev.forecast || ev.previous)
  return (
    <div
      className="grid min-h-[52px] border-t transition-opacity duration-[400ms]"
      style={{
        gridTemplateColumns: '80px 1fr',
        borderTopColor: V2W.border,
        borderLeft: `3px solid ${col}`,
        background: faded
          ? V2.bg
          : `linear-gradient(90deg, ${alpha(col, 0.06)} 0%, transparent 35%), ${V2.bg}`,
        opacity: faded ? 0.32 : 1,
      }}
    >
      <div
        className="flex flex-col justify-center gap-0.5 border-r px-3 py-2"
        style={{
          borderRightColor: V2W.border,
          boxShadow: faded ? 'none' : `inset -1px 0 8px ${alpha(col, 0.09)}`,
        }}
      >
        <span className="tabular font-mono text-sm" style={{ color: body }}>
          {ev.time_formatted || ev.time || 'TBD'}
        </span>
      </div>

      <div className="flex min-w-0 flex-col justify-center gap-[3px] px-3.5 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-2xs font-extrabold uppercase tracking-[0.1em]" style={{ color: col }}>
            {ev.impact}
          </span>
          <span className="text-xs font-semibold" style={{ color: body }}>
            {ev.country}
          </span>
        </div>
        <div
          className={['text-sm leading-tight', ev.impact === 'High' ? 'font-bold' : 'font-medium'].join(' ')}
          style={{ color: body }}
        >
          {ev.title}
        </div>
        {hasValues && (
          <div className="tabular mt-0.5 flex flex-wrap gap-3.5 font-mono text-xs">
            {ev.actual && (
              <span style={{ color: faded ? CAL.faded : CAL.actual }}>
                A: <strong>{ev.actual}</strong>
              </span>
            )}
            {ev.forecast && (
              <span style={{ color: faded ? CAL.faded : CAL.forecast }}>F: {ev.forecast}</span>
            )}
            {/* WHITE, not grey. A/F/P is already colour-coded green/amber and a
                grey "previous" was the one body value that read as disabled
                rather than as data. */}
            {ev.previous && <span style={{ color: body }}>P: {ev.previous}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

/** One earnings block woven into the calendar table — same grid as an event row. */
function EarnRowBlock({ kind, rows }: { kind: EarnKind; rows: EarnRow[] }) {
  const k = EARN_KIND[kind]
  return (
    <div
      className="grid min-h-[52px] border-t"
      style={{
        gridTemplateColumns: '80px 1fr',
        borderTopColor: V2W.border,
        borderLeft: `3px solid ${k.color}`,
        background: `linear-gradient(90deg, ${alpha(k.color, 0.07)} 0%, transparent 40%), ${V2.bg}`,
      }}
    >
      <div
        className="flex flex-col justify-center border-r px-3 py-2"
        style={{ borderRightColor: V2W.border, boxShadow: `inset -1px 0 8px ${alpha(k.color, 0.09)}` }}
      >
        <span className="font-mono text-xs font-extrabold leading-tight" style={{ color: k.color }}>
          {k.top}
        </span>
        <span className="font-mono text-2xs" style={{ color: CAL.low }}>
          {k.sub}
        </span>
      </div>

      <div className="flex min-w-0 flex-col justify-center gap-1.5 px-3.5 py-2">
        <span className="text-2xs font-extrabold uppercase tracking-[0.1em]" style={{ color: k.color }}>
          {k.title}
        </span>
        <div className="flex flex-wrap" style={{ gap: CHIP_GAP }}>
          {rows.map((r) => (
            <a
              key={r.symbol}
              href={quoteHref(r.symbol)}
              target="_blank"
              rel="noreferrer"
              title={chipTitle(r)}
              className="flex shrink-0 flex-col items-center gap-1 no-underline"
              style={{ width: CHIP_W }}
            >
              <ChipLogo sym={r.symbol} company={r.company} size={34} radius={8} />
              <span
                className="tabular overflow-hidden text-ellipsis whitespace-nowrap font-mono text-2xs font-bold tracking-[0.02em] text-fg"
                style={{ maxWidth: CHIP_W }}
              >
                {r.symbol}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
//  EARNINGS TAB — the week board
// ═════════════════════════════════════════════════════════════════════════════

interface Section {
  date: string
  pre: EarnRow[]
  after: EarnRow[]
  tbd: EarnRow[]
}

/**
 * A WEEK BOARD, one column per trading day.
 *
 * The old v2 layout was the calendar's own row grid: a full-width band per
 * session with a fixed 80px time gutter and the chips flowing left. A week with
 * four names on Tuesday spent a 2000px-wide row on four 46px chips, so the tab
 * was mostly empty background down the right-hand side, and five days stacked
 * into a page taller than the fold for ~25 names.
 *
 * Columns fix both halves: the width is divided between the days instead of
 * being handed to one row, and the whole week lands in one screen — which is
 * also what makes the tab worth pasting into a chat as a single image.
 *
 * `auto-fit`, not `repeat(5)`: the feed decides how many days come back.
 */
function EarningsBoard({
  boardRef,
  sections,
  today,
  earnWeek,
  allRows,
  boardDays,
  mcapMin,
  mcapLabel,
  earnShown,
}: {
  boardRef: RefObject<HTMLDivElement | null>
  sections: Section[]
  today: string
  earnWeek: 0 | 1
  allRows: EarnRow[]
  boardDays: string[]
  mcapMin: number
  mcapLabel: string
  earnShown: number
}) {
  if (sections.length === 0) {
    // NAME THE REASON. "No earnings match." reads as an empty feed, but the
    // usual cause is a cap floor set two clicks ago and forgotten — or a week
    // the recorder has not swept yet.
    const inWeek = allRows.filter((r) => boardDays.includes(r.date)).length
    const why =
      allRows.length === 0
        ? 'No earnings loaded.'
        : inWeek === 0
          ? `Nothing stored for ${rangeLabel(boardDays)} yet.`
          : mcapMin > 0 && earnShown === 0
            ? `No earnings ${mcapLabel} this week — try a lower cap.`
            : 'No earnings match.'
    return <div className="p-5 text-sm text-fg">{why}</div>
  }

  // The first and last RENDERED dates, not boardDays[0]/[4]: a week whose
  // Monday has no qualifying names reads "SEP 2 – SEP 5", which is what the
  // board actually shows.
  const first = sections[0]?.date ?? ''
  const last = sections[sections.length - 1]?.date ?? ''

  return (
    <div ref={boardRef} className="p-3" style={{ background: V2.bg }}>
      {/* Board header — INSIDE the capture target, so the copied image carries
          the mark and the week it covers without any app chrome.

          The right-hand side is ONE run of text. It used to carry a "N NAMES"
          pill, an ANTICIPATED / ALL NAMES pill and a cap-floor pill, and every
          one of them was telling the reader something the board already says —
          each day column prints its own count, and the columns themselves ARE
          the view. A signature does not need a legend. */}
      <div
        className="mb-2.5 flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5"
        style={{ border: `1px solid ${BOARD.edge}`, background: BOARD.header }}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-black tracking-[0.14em] text-fg">
            {earnWeek === 0 ? 'EARNINGS THIS WEEK' : 'EARNINGS NEXT WEEK'}
          </span>
          <span className="tabular font-mono text-xs leading-tight tracking-[0.04em] text-fg">
            {dayDate(first)} – {dayDate(last)}
          </span>
        </div>
        <span className="tabular ml-auto font-mono text-xs font-extrabold leading-none text-fg">
          cbedge.net
        </span>
      </div>

      <div
        className="grid items-start gap-2.5"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}
      >
        {sections.map((s) => (
          <DayColumn key={`earn-col-${s.date}`} section={s} isToday={s.date === today} />
        ))}
      </div>

      {/* Signature. Bottom-right, under the grid rather than beside the title:
          the header's left edge is the week's own label and a mark there was
          competing with it. Down here it reads as the SOURCE of the board,
          which is what it is once the image is pasted somewhere else.

          cbedge3.0.png is a 3.4:1 banner with a TRANSPARENT ground, so 56px tall
          lands it at ~190px wide. The transparency matters: the .jpg carried a
          baked-in black plate, and the board's ground is near-black but not
          black, so the plate showed as a faintly different rectangle. Inside
          boardRef, so the capture carries it. */}
      <div className="flex justify-end pt-3">
        <img src="/cbedge3.0.png" alt="CB Edge" className="block h-14 w-auto" />
      </div>
    </div>
  )
}

function DayColumn({ section, isToday }: { section: Section; isToday: boolean }) {
  const { date, pre, after, tbd } = section
  const n = pre.length + after.length + tbd.length
  return (
    <div
      className="flex min-w-0 flex-col overflow-hidden rounded-xl"
      style={{
        border: `1px solid ${isToday ? BOARD.edgeToday : BOARD.edge}`,
        background: isToday ? BOARD.cardToday : BOARD.card,
      }}
    >
      {/* THREE-COLUMN GRID, not a flex row, because the date has to sit in the
          MIDDLE of the strip. A flex row with the count pushed right by
          margin-left:auto centres nothing — the date lands wherever the count's
          width leaves it, so a column showing "11" put its date a few px left of
          one showing "1". Equal 1fr outer tracks make the middle track's centre
          the strip's centre whatever either side holds.

          ONE SIZE AND ONE FAMILY for every run in the strip. They used to be
          10px mono and 13px sans, which the live page reconciles with
          align-items:center and a capture does not; the contrast is carried by
          weight and colour instead, which any renderer reproduces exactly. */}
      <div
        className="grid items-center px-2.5 py-2.5"
        style={{
          gridTemplateColumns: '1fr auto 1fr',
          background: isToday ? BOARD.headToday : BOARD.head,
        }}
      >
        <span />
        <span className="flex items-center justify-center gap-1.5">
          <span
            className="tabular font-mono text-xs font-black leading-none tracking-[0.1em]"
            style={{ color: CAL.accent }}
          >
            {dayFull(date)}
          </span>
          <span className="tabular font-mono text-xs font-extrabold leading-none tracking-[0.04em] text-fg">
            {dayDate(date)}
          </span>
          {isToday && (
            <span
              className="tabular rounded-[3px] px-1.5 py-[3px] font-mono text-2xs font-black leading-none tracking-[0.1em]"
              style={{ background: CAL.accent, color: V2.badgeInk }}
            >
              TODAY
            </span>
          )}
        </span>
        <span className="tabular justify-self-end font-mono text-xs font-bold leading-none text-fg opacity-60">
          {n}
        </span>
      </div>

      {pre.length > 0 && <SessionBlock kind="pre" rows={pre} />}
      {after.length > 0 && <SessionBlock kind="after" rows={after} />}
      {tbd.length > 0 && <SessionBlock kind="tbd" rows={tbd} />}
    </div>
  )
}

function SessionBlock({ kind, rows }: { kind: EarnKind; rows: EarnRow[] }) {
  const k = EARN_KIND[kind]
  return (
    <div className="px-2.5 pb-2.5 pt-2" style={{ borderTop: `1px solid ${BOARD.rule}` }}>
      <div className="mb-2 flex items-center">
        {/* The dot lives INSIDE the label, not beside it. As a flex sibling it
            centred on the ROW, whose height is set by the tallest line box, so
            a 6px dot sat on the line's middle while the 9px all-caps label's
            cap band sits above that. Nested in a line-height:1 inline-block it
            is baseline-aligned and centres to within a third of a pixel. */}
        <span
          className="inline-block text-3xs font-black uppercase leading-none tracking-[0.12em]"
          style={{ color: k.color }}
        >
          <span
            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: k.color }}
          />
          {k.board}
        </span>
        <span className="tabular ml-auto font-mono text-3xs font-bold leading-none text-fg opacity-60">
          {rows.length}
        </span>
      </div>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CHIP_MIN}px, 1fr))` }}
      >
        {rows.map((r) => (
          <EarnChip key={r.symbol} row={r} />
        ))}
      </div>
    </div>
  )
}

/**
 * One ticker tile: LOGO, then TICKER. Nothing else.
 *
 * The market-cap line is gone. It was the same number three times over — the
 * board is already ordered by cap and the chips are already picked by it — and
 * it cost a third line on every tile, which is what made a nine-name Wednesday
 * taller than the fold. Cap and EPS estimate are one hover away in `title`.
 *
 * `width:100%` + `text-center` on the label is what actually centres it:
 * align-items only centres the SPAN, not the text inside a span that stretches
 * to the column.
 */
function EarnChip({ row }: { row: EarnRow }) {
  return (
    <a
      href={quoteHref(row.symbol)}
      target="_blank"
      rel="noreferrer"
      title={chipTitle(row)}
      className="flex min-w-0 flex-col items-center justify-start gap-1.5 rounded-[9px] px-1 py-2 no-underline"
      style={{ background: BOARD.tile, border: `1px solid ${BOARD.rule}` }}
    >
      {/* lazy={false}: this board is the capture target, and any capture engine
          clones the DOM as it stands — a chip the browser has not fetched yet
          captures empty. */}
      <ChipLogo sym={row.symbol} company={row.company} size={CHIP_LOGO} radius={10} lazy={false} />
      <span className="tabular w-full overflow-hidden text-ellipsis whitespace-nowrap text-center font-mono text-xs font-extrabold leading-none tracking-[0.02em] text-fg">
        {row.symbol}
      </span>
    </a>
  )
}
