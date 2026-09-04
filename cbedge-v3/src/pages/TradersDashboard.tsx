import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Page } from '@/design/primitives/Page'
import { Card } from '@/design/primitives/Card'
import { Chip } from '@/design/primitives/Controls'
import { MOVE_DOWN, MOVE_UP, T, alpha } from '@/design/theme'
import { preload, useQuery } from '@/data/api'
// Type-only, so the wheel's module stays entirely inside its own lazy chunk —
// a value import here would pull wheelMath.ts into the route chunk.
import type { WheelPayload } from './tradersDashboard/wheelMath'

// ─────────────────────────────────────────────────────────────────────────────
// TRADERS DASHBOARD — the pre-market cockpit: a countdown to the next bell, the
// overnight overview, today's macro drivers, the S&P sector wheel, and the
// personal widgets (schedule / tasks / quick links) a trader edits once and
// reloads with every visit.
//
// The port of v2's /app/traders-dashboard (components/pages/TradersDashboard.tsx
// plus components/dashboard/SectorSunburst.tsx). The spec is
// docs/parity/traders-dashboard.md — 168 rows, one per rendered value. Change
// a threshold, a label or a sort here and change it there too; that file is
// what the next person diffs against, not this one.
//
// Deliberate departures from v2, all recorded in that file's build log:
//
//  1. TRENDING NOW IS SORTED HIGHEST → LOWEST. v2 rendered the API's
//     `[...top5, ...bottom5.reverse()]` array as-is, so the list ran best-first
//     and then worst-first — two descents with a cliff in the middle. Brandon,
//     2026-08-30: one ranking, positives down to negatives.
//  2. UP IS BLUE, DOWN IS RED (same call). v2's HOME_THEME.green is in fact a
//     light blue; it comes across as --color-move-up rather than being
//     recoloured to v3's green --color-up. See tokens.css.
//  3. PREFS ARE SERVER-BACKED AND NOWHERE ELSE — Postgres `td_user_prefs`, one
//     row per user, via /api/traders-dashboard. No localStorage copy: see the
//     note beside PREFS_URL for the two ways a local mirror breaks "per user".
//  4. NO SNAPSHOT BUTTON. v2's CopySnapButton needs a DOM-to-canvas renderer
//     v3 does not ship. Still open.
//  5. The Economic Calendar header button is inert — v3 has no /economic-calendar
//     route yet, and App.tsx's no-catch-all rule means a live link would 404.
//     Premarket Prep IS routed, so that one is a real link.
// ─────────────────────────────────────────────────────────────────────────────

// The wheel is the heaviest thing on the page and it sits third in the right
// column, below the fold on most windows. Its request is fired here at route
// entry (no waterfall — AGENTS.md non-negotiable 3); only its rendering waits.
// `SectorWheelCard`, not `SectorWheel`: a module basename that differs from a
// sibling's only in casing resolves to the WRONG FILE on Windows. See the
// header of ./tradersDashboard/wheelMath.ts.
const SectorWheel = lazy(() => import('./tradersDashboard/SectorWheelCard'))

// Nav intent is not the only place preload() earns its keep: this runs when the
// route's chunk is parsed, which is before the component has mounted.
preload('/api/spx-sunburst')

/** Server caches the sweep for 15 min; this just keeps the tab fresh. Mirrors
 *  POLL_MS in ./tradersDashboard/sectorWheel — kept as a literal here so that
 *  module stays out of this chunk. */
const WHEEL_POLL_MS = 5 * 60_000

// ── Types ────────────────────────────────────────────────────────────────────

interface ScheduleItem {
  id: string
  time: string
  label: string
}
interface TaskItem {
  id: string
  label: string
  done: boolean
}
interface LinkItem {
  id: string
  label: string
  href: string
}
interface CalEvent {
  date: string
  time_formatted: string
  title: string
  country: string
  impact: string
}
interface Driver {
  when: string
  title: string
  body: string
}
interface OverviewRow {
  summary: string
  drivers: Driver[]
  movers?: Mover[]
  generated_at: number
}
interface QuoteRow {
  price: number | null
  change: number | null
  pct: number | null
}
interface Mover {
  symbol: string
  name: string
  price: number | null
  pct: number | null
  preMarketPrice: number | null
  preMarketPct: number | null
}
interface WeatherRow {
  tempF: number
  condition: string
  place: string
}
interface PrefsRow {
  zip?: string | null
  schedule?: unknown
  tasks?: unknown
  links?: unknown
}

// ── Static data ──────────────────────────────────────────────────────────────

const FUTURES = [
  { sym: 'ES', yahoo: 'ES=F' },
  { sym: 'NQ', yahoo: 'NQ=F' },
  { sym: 'YM', yahoo: 'YM=F' },
] as const

const DEFAULT_SCHEDULE: ScheduleItem[] = [
  { id: 's1', time: '08:00 AM', label: 'Coffee & Market Review' },
  { id: 's2', time: '08:30 AM', label: 'Daily Planning' },
  { id: 's3', time: '09:00 AM', label: 'Pre-Market Analysis' },
  { id: 's4', time: '09:30 AM', label: 'Market Open' },
]

const DEFAULT_TASKS: TaskItem[] = [
  { id: 't1', label: 'Review portfolio allocations', done: false },
  { id: 't2', label: 'Prepare presentation slides for the 2 PM meeting', done: false },
  { id: 't3', label: 'Quick workout (15 mins)', done: false },
  { id: 't4', label: 'Check pre-market volume on watch list', done: false },
]

// v3's own destination catalog, not v2's — the two apps do not share routes.
// Everything except LIVE_ROUTES below is a page this dashboard can point at
// once it exists; until then a configured link renders dimmed, the same way
// Shell.tsx's rail marks an unbuilt icon "coming soon" rather than 404ing.
const ALL_PAGES: { label: string; href: string }[] = [
  { label: 'Home', href: '/' },
  { label: 'Multi Greek', href: '/mult-greek' },
  { label: 'Traders Dashboard', href: '/traders-dashboard' },
  { label: 'Premarket Prep', href: '/premarket' },
  { label: 'Board', href: '/board' },
  { label: 'Options Chain', href: '/options-chain' },
  { label: 'Est. Moves', href: '/em' },
  { label: 'Analysis', href: '/analytics' },
  { label: 'Replay', href: '/replay' },
  { label: 'Flow', href: '/flow' },
  { label: 'ES Candles', href: '/es-candles' },
  { label: 'Scanner', href: '/scanner' },
  { label: 'Level Log', href: '/level-log' },
  { label: 'ICT', href: '/ict' },
  { label: 'Test Lab', href: '/test' },
  { label: 'Journal', href: '/trading' },
  // Not a dashboard page — the v2 door (src/pages/Legacy.tsx). Worth a Quick
  // Link slot for anyone whose day still runs through a page v3 has not ported.
  { label: 'v2 Legacy', href: '/legacy' },
]

// Which of the above actually have a <Route> in App.tsx today. The rest are
// real future destinations, not dead links, so they stay in the picker and
// render inert until they land — App.tsx's no-catch-all rule means a link to an
// unregistered route would hit NotFound, which is a worse lie than a tile that
// plainly says "coming soon". Keep this in step with App.tsx and with NAV in
// shell/Shell.tsx; those three lists move together.
const LIVE_ROUTES = new Set([
  '/',
  '/traders-dashboard',
  '/premarket',
  '/options-chain',
  '/analytics',
  '/flow',
  '/em',
  '/scanner',
  '/level-log',
  '/legacy',
  '/trading',
  '/test',
])

// Applies only to an account with no saved Quick Links yet. Everyone else keeps
// the set they arranged — which is why Premarket also gets a header button.
const DEFAULT_LINKS: LinkItem[] = [
  { id: 'l1', label: 'Premarket Prep', href: '/premarket' },
  { id: 'l2', label: 'Home', href: '/' },
  { id: 'l3', label: 'Multi Greek', href: '/mult-greek' },
  { id: 'l4', label: 'Analysis', href: '/analytics' },
]

/**
 * One accent per driver slot, cycling past four. v2's ramp
 * (cyan · orange · red · purple) through the token bridge — T.purple is
 * --color-dex, which is the closest thing v3 has to v2's dark-teal "purple".
 */
const DRIVER_COLORS = [T.cyan, T.orange, T.red, T.purple] as const

function driverColor(i: number): string {
  return DRIVER_COLORS[i % DRIVER_COLORS.length] ?? T.cyan
}

const uid = () => Math.random().toString(36).slice(2, 9)

// US equity-market full-day closures (NYSE/Cboe), ET date strings. Keep in sync
// with server-v2. Full-day only — a 13:00 early close still counts down to
// 16:00, which is v2's behaviour and deliberately kept (Brandon, 2026-08-30:
// the tape is not moving either way).
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
])
const etDateStr = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const etWeekday = (d: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(d)
const isTradingDay = (d: Date) => {
  const wd = etWeekday(d)
  return wd !== 'Sat' && wd !== 'Sun' && !MARKET_HOLIDAYS.has(etDateStr(d))
}

// ── Prefs: Postgres, per user, and nowhere else ──────────────────────────────
//
// `/api/traders-dashboard` -> server-v2/api-router.js (`auth: 'subscriber'`) ->
// lib/db.ts `getTdPrefs` / `upsertTdPrefs` -> Postgres `td_user_prefs`, one row
// per `clerk_user_id`, upserted with `::jsonb` + ON CONFLICT. The ZIP, the
// schedule, the tasks and the quick links all live in that row and travel with
// the account.
//
// THERE IS NO LOCAL COPY, deliberately. An earlier cut of this page mirrored
// all four into localStorage so the first paint showed the saved widgets rather
// than the sample ones. That is a per-BROWSER store wearing a per-user store's
// clothes, and it fails in the two ways that matter:
//
//   • a second person signing in on this browser sees the first one's ZIP and
//     routine for as long as the GET takes;
//   • a value cleared on the server (`zip: null`) is silently resurrected from
//     the mirror, so the page shows a ZIP that is not in the database.
//
// So the row is the only truth. The page renders the defaults for the few
// hundred ms the GET takes, exactly as v2 did. `useQuery`'s cache already
// spares a client-side navigation back to this page from refetching.
//
// One thing v2 got wrong and this does not: a save in flight is not lost when
// the page unmounts or the tab closes — see flush() below.

const PREFS_URL = '/api/traders-dashboard'
/** Long enough that typing a task label is one request, short enough to feel instant. */
const SAVE_DEBOUNCE_MS = 400

function asRecord(x: unknown): Record<string, unknown> | null {
  return typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : null
}
const isScheduleItem = (x: unknown): x is ScheduleItem => {
  const o = asRecord(x)
  return !!o && typeof o.id === 'string' && typeof o.time === 'string' && typeof o.label === 'string'
}
const isTaskItem = (x: unknown): x is TaskItem => {
  const o = asRecord(x)
  return !!o && typeof o.id === 'string' && typeof o.label === 'string' && typeof o.done === 'boolean'
}
const isLinkItem = (x: unknown): x is LinkItem => {
  const o = asRecord(x)
  return !!o && typeof o.id === 'string' && typeof o.label === 'string' && typeof o.href === 'string'
}
// Non-empty on purpose, exactly as v2: an empty saved array falls back to the
// DEFAULT rather than rendering an empty card, so "delete every task" does not
// persist. Kept because changing it is a data decision, not a port decision.
const isScheduleArr = (v: unknown): v is ScheduleItem[] =>
  Array.isArray(v) && v.length > 0 && v.every(isScheduleItem)
const isTaskArr = (v: unknown): v is TaskItem[] => Array.isArray(v) && v.length > 0 && v.every(isTaskItem)
const isLinkArr = (v: unknown): v is LinkItem[] => Array.isArray(v) && v.length > 0 && v.every(isLinkItem)

// ── Formatting ───────────────────────────────────────────────────────────────

/** `"+1.23%"` / `"-1.23%"`, 2dp, em dash when there is nothing to show. */
function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}
/**
 * Blue up, red down, muted when there is no value. Note `0` reads as UP — v2's
 * `(pct ?? 0) >= 0`, kept so a flat future prints "+0.00%" in blue and not in
 * a third colour that means nothing.
 */
function moveColor(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return T.muted
  return n >= 0 ? MOVE_UP : MOVE_DOWN
}

// Calendar's shape is a bare array on some deployments and {events:[…]} on
// others — the same ambiguity v2 defended against.
function hasEventsField(v: unknown): v is { events: unknown } {
  return typeof v === 'object' && v !== null && 'events' in v
}

// ── Header widgets ───────────────────────────────────────────────────────────

const HEADER_BTN =
  'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3.5 py-2 text-sm font-bold tracking-[0.04em] no-underline transition-colors'

/** v2's resting fill for the Premarket Prep button. */
const PREMARKET_BG = `linear-gradient(180deg, ${alpha(T.orange, 0.2)}, ${alpha(T.orange, 0.06)})`

function ComingSoonPill({ icon, label }: { icon: string; label: string }) {
  return (
    <span
      title={`${label} — coming soon`}
      className={`${HEADER_BTN} cursor-not-allowed border-line text-faint opacity-50`}
    >
      <span aria-hidden>{icon}</span>
      {label}
      <span>→</span>
    </span>
  )
}

function WeatherWidget({
  zipInput,
  onZipInput,
  onSubmit,
  onClear,
  weather,
}: {
  zipInput: string
  onZipInput: (v: string) => void
  onSubmit: () => void
  onClear: () => void
  weather: WeatherRow | undefined
}) {
  if (weather) {
    return (
      <div className="text-right">
        <div className="text-xl font-bold leading-tight" style={{ color: MOVE_UP }}>
          <span aria-hidden>☀</span> {weather.tempF}°F
        </div>
        <div className="text-xs text-muted">
          {weather.condition}, {weather.place}
        </div>
        <div className="mt-1">
          <Chip label="Change ZIP" on={false} onClick={onClear} />
        </div>
      </div>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className="flex items-center gap-1.5"
    >
      <input
        value={zipInput}
        onChange={(e) => onZipInput(e.target.value)}
        placeholder="ZIP"
        maxLength={5}
        className="w-20 rounded-sm border border-line bg-surface2 px-2 py-1 text-xs text-fg outline-none focus:border-accent"
      />
      <button
        type="submit"
        className="rounded-sm border border-line px-2 py-1 text-xs font-semibold text-accent"
      >
        Set
      </button>
    </form>
  )
}

// ── Countdown ────────────────────────────────────────────────────────────────

function useCountdown() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  return useMemo(() => {
    if (!now) return { countdown: '--:--:--', targetLabel: '9:30 AM EST', phase: 'open' as const, dateStr: '' }
    // Browser-local, as v2 — this is the visitor's date, not the session's.
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })

    // Time-of-day in ET seconds, correct regardless of the browser's zone.
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(now)
    const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0)
    let hh = get('hour')
    if (hh === 24) hh = 0 // some ICU builds emit 24 for midnight
    const nowSec = hh * 3600 + get('minute') * 60 + get('second')
    const OPEN = 9 * 3600 + 30 * 60 // 9:30 AM ET
    const CLOSE = 16 * 3600 // 4:00 PM ET
    const tradingToday = isTradingDay(now)
    const isOpen = tradingToday && nowSec >= OPEN && nowSec < CLOSE

    let deltaSec: number
    let label: string
    let phase: 'open' | 'close'

    if (isOpen) {
      phase = 'close'
      deltaSec = CLOSE - nowSec
      label = 'Target: 4:00 PM EST'
    } else {
      phase = 'open'
      if (tradingToday && nowSec < OPEN) {
        deltaSec = OPEN - nowSec
        label = 'Target: 9:30 AM EST'
      } else {
        const secToMidnight = 86400 - nowSec
        const dayCursor = new Date(now)
        let addedDays = 0
        do {
          dayCursor.setDate(dayCursor.getDate() + 1)
          addedDays++
        } while (!isTradingDay(dayCursor) && addedDays < 14)
        deltaSec = secToMidnight + (addedDays - 1) * 86400 + OPEN
        const wd = dayCursor.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' })
        label = `Target: ${wd} 9:30 AM EST`
      }
    }

    let s = Math.max(0, deltaSec)
    const days = Math.floor(s / 86400)
    s %= 86400
    const h = String(Math.floor(s / 3600)).padStart(2, '0')
    s %= 3600
    const m = String(Math.floor(s / 60)).padStart(2, '0')
    const hms = `${h}:${m}:${String(s % 60).padStart(2, '0')}`
    return { countdown: days > 0 ? `${days}d ${hms}` : hms, targetLabel: label, phase, dateStr }
  }, [now])
}

function CountdownCard({
  countdown,
  targetLabel,
  phase,
}: {
  countdown: string
  targetLabel: string
  phase: 'open' | 'close'
}) {
  return (
    <Card>
      <div className="flex flex-col items-center gap-2 px-5 py-7 text-center">
        <div className="text-lg font-semibold text-fg">
          {phase === 'close' ? 'Countdown to Market Close' : 'Countdown to Market Open'}
        </div>
        <div
          className="tabular font-extrabold text-fg"
          style={{ fontSize: 'clamp(48px, 8vw, 84px)', letterSpacing: 2, lineHeight: 1.05 }}
        >
          {countdown}
        </div>
        <div className="text-sm text-muted">{targetLabel}</div>
      </div>
    </Card>
  )
}

// ── Overnight overview ───────────────────────────────────────────────────────

const SECTION_LABEL = 'mb-2.5 text-xs font-bold uppercase tracking-[0.12em] text-muted'

function OverviewCard({
  overview,
  events,
  quotes,
  movers,
  quotesStale,
  moversStale,
  quotesFailed,
}: {
  overview: OverviewRow | undefined
  events: CalEvent[]
  quotes: Record<string, QuoteRow>
  movers: Mover[]
  quotesStale: boolean
  moversStale: boolean
  quotesFailed: boolean
}) {
  // Drivers: the AI overview's own list when it has generated, else today's
  // high-impact USD calendar rows, so the column is never empty.
  const drivers: Driver[] = useMemo(() => {
    if (overview?.drivers?.length) return overview.drivers.slice(0, 4)
    const etToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
    return events
      .filter((e) => e.date === etToday && e.country === 'USD' && /high/i.test(e.impact))
      .slice(0, 4)
      .map((e) => ({ when: e.time_formatted || 'Today', title: e.title, body: `High-impact USD event · ${e.country}` }))
  }, [overview, events])

  // ONE ranking, highest positive down to lowest negative (Brandon,
  // 2026-08-30). v2 printed the API's array untouched, which was five winners
  // best-first followed by five losers worst-first — a second descent starting
  // over halfway down the list.
  const shownMovers = useMemo(() => {
    const src = movers.length ? movers : (overview?.movers ?? [])
    const pctOf = (m: Mover) => m.preMarketPct ?? m.pct
    return [...src].sort((a, b) => {
      const x = pctOf(a)
      const y = pctOf(b)
      // A row with no percent cannot be ranked; park it at the bottom rather
      // than letting NaN scramble the comparator.
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      return y - x
    })
  }, [movers, overview])

  return (
    <Card
      title={<span>📈 Overnight Market Overview</span>}
      actions={
        overview && Number(overview.generated_at) > 0 ? (
          <span className="text-2xs text-muted">
            Generated{' '}
            {new Date(Number(overview.generated_at)).toLocaleTimeString('en-US', {
              timeZone: 'America/New_York',
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            ET
          </span>
        ) : undefined
      }
    >
      <div className="mb-5 border-l-[3px] pl-3.5 text-sm leading-relaxed text-muted" style={{ borderColor: T.cyan }}>
        {overview ? (
          <>
            <strong className="text-fg">Sentiment:</strong> {overview.summary}
          </>
        ) : (
          <span className="text-faint">
            Today&apos;s overview is generated automatically at 7:00 AM ET. Check back shortly.
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="min-w-0">
          <div className={SECTION_LABEL}>📉 Overnight Futures (Live)</div>
          <div className={quotesStale ? 'stale mb-5 flex gap-2.5' : 'mb-5 flex gap-2.5'}>
            {FUTURES.map((f) => {
              const pct = quotes[f.yahoo]?.pct ?? null
              return (
                <div
                  key={f.sym}
                  className="flex-1 rounded-md border border-line bg-surface2 px-1.5 py-2.5 text-center"
                >
                  <div className="text-xs font-bold text-muted">{f.sym}</div>
                  <div className="tabular text-sm font-bold" style={{ color: moveColor(pct) }}>
                    {fmtPct(pct)}
                  </div>
                </div>
              )
            })}
          </div>
          {quotesFailed && (
            <div className="mb-2 text-xs" style={{ color: MOVE_DOWN }}>
              Live quotes unavailable — showing last known values.
            </div>
          )}

          <div className={SECTION_LABEL}>🔥 Trending Now</div>
          {shownMovers.length ? (
            <div className={moversStale ? 'stale flex flex-col gap-1' : 'flex flex-col gap-1'}>
              {shownMovers.map((m) => {
                const displayPct = m.preMarketPct ?? m.pct
                return (
                  <div
                    key={m.symbol}
                    className="flex items-center justify-between rounded-sm border border-line bg-surface2 px-2 py-1"
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-bold" style={{ color: T.cyan }}>
                        {m.symbol}
                      </span>
                      {/* v2 truncates at 18 characters. /api/premarket-movers
                          sets name = symbol, so a live row prints the ticker
                          twice; only the 07:00 overview payload carries a real
                          company name. Kept as v2 had it — see the parity
                          file's build log. */}
                      <span className="ml-1.5 text-2xs text-muted">
                        {m.name.length > 18 ? `${m.name.slice(0, 18)}…` : m.name}
                      </span>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="tabular text-xs font-bold" style={{ color: moveColor(displayPct) }}>
                        {fmtPct(displayPct)}
                      </span>
                      {m.preMarketPct != null && <span className="ml-1 text-2xs text-muted">PM</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-line bg-surface2 px-3 py-3.5 text-center text-xs text-muted">
              Available after 7 AM ET overview generates.
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className={SECTION_LABEL}>🗓 Key Drivers Today</div>
          <div className="flex flex-col gap-3">
            {drivers.length ? (
              drivers.map((d, i) => {
                const c = driverColor(i)
                return (
                  <div key={d.title + i} className="border-l-[3px] py-2 pl-3" style={{ borderColor: c }}>
                    <div
                      className="text-2xs font-bold uppercase tracking-[0.08em]"
                      style={{ color: c }}
                    >
                      {d.when}
                    </div>
                    <div className="my-0.5 font-bold text-fg">{d.title}</div>
                    <div className="text-xs leading-snug text-muted">{d.body}</div>
                  </div>
                )
              })
            ) : (
              <div className="text-xs text-muted">No major USD events scheduled today.</div>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ── Schedule / Tasks / Links ─────────────────────────────────────────────────

const EDIT_INPUT =
  'min-w-0 rounded-sm border border-line bg-surface2 px-2 py-1 text-sm text-fg outline-none focus:border-accent'
const ADD_BTN = 'mt-3 self-start rounded-sm border border-line px-2 py-1 text-xs font-semibold'

function ScheduleCard({ schedule, onChange }: { schedule: ScheduleItem[]; onChange: (next: ScheduleItem[]) => void }) {
  const [editing, setEditing] = useState(false)
  return (
    <Card
      title={<span style={{ color: T.red }}>🕐 Morning Schedule</span>}
      actions={<Chip label={editing ? 'Done' : 'Edit'} on={editing} onClick={() => setEditing((v) => !v)} />}
    >
      <div className="mb-3 text-xs text-muted">
        These are sample times — tap{' '}
        <span className="font-bold" style={{ color: T.cyan }}>
          Edit
        </span>{' '}
        to swap in your own routine.
      </div>
      <div className="flex flex-col gap-2.5">
        {schedule.map((s, i) =>
          editing ? (
            <div key={s.id} className="flex items-center gap-1.5">
              <input
                value={s.time}
                onChange={(e) => onChange(schedule.map((x) => (x.id === s.id ? { ...x, time: e.target.value } : x)))}
                className={`${EDIT_INPUT} w-[90px]`}
              />
              <input
                value={s.label}
                onChange={(e) => onChange(schedule.map((x) => (x.id === s.id ? { ...x, label: e.target.value } : x)))}
                className={`${EDIT_INPUT} flex-1`}
              />
              <button
                type="button"
                onClick={() => onChange(schedule.filter((x) => x.id !== s.id))}
                className="text-xs"
                style={{ color: MOVE_DOWN }}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ) : (
            <div key={s.id} className="flex items-center gap-3">
              {/* Mono and nowrap, no fixed width — v2's rule. A width would
                  clip a longer time string rather than pushing the label. */}
              <span className="shrink-0 whitespace-nowrap font-mono text-xs font-bold text-muted">{s.time}</span>
              {/* The last row is the one that matters — "Market Open". */}
              <span className={i === schedule.length - 1 ? 'font-bold text-fg' : 'font-medium text-fg'}>
                {s.label}
              </span>
            </div>
          ),
        )}
      </div>
      {editing && (
        <button
          type="button"
          onClick={() => onChange([...schedule, { id: uid(), time: '09:00 AM', label: 'New item' }])}
          className={ADD_BTN}
          style={{ color: T.cyan }}
        >
          + Add
        </button>
      )}
    </Card>
  )
}

function TasksCard({ tasks, onChange }: { tasks: TaskItem[]; onChange: (next: TaskItem[]) => void }) {
  const [editing, setEditing] = useState(false)
  const completed = tasks.filter((t) => t.done).length
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0

  return (
    <Card
      title={<span style={{ color: MOVE_UP }}>✅ Pre-Market Tasks</span>}
      actions={<Chip label={editing ? 'Done' : 'Edit'} on={editing} onClick={() => setEditing((v) => !v)} />}
    >
      <div className="mb-3 text-xs text-muted">
        Sample tasks — tap{' '}
        <span className="font-bold" style={{ color: MOVE_UP }}>
          Edit
        </span>{' '}
        to make them your own.
      </div>
      <div className="flex flex-col gap-3">
        {tasks.map((t) =>
          editing ? (
            <div key={t.id} className="flex items-center gap-1.5">
              <input
                value={t.label}
                onChange={(e) => onChange(tasks.map((x) => (x.id === t.id ? { ...x, label: e.target.value } : x)))}
                className={`${EDIT_INPUT} flex-1`}
              />
              <button
                type="button"
                onClick={() => onChange(tasks.filter((x) => x.id !== t.id))}
                className="text-xs"
                style={{ color: MOVE_DOWN }}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ) : (
            <label key={t.id} className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={t.done}
                onChange={() => onChange(tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}
                className="mt-0.5 h-4 w-4"
                style={{ accentColor: MOVE_UP }}
              />
              <span className={t.done ? 'text-sm text-muted line-through' : 'text-sm text-fg'}>{t.label}</span>
            </label>
          ),
        )}
      </div>
      {editing ? (
        <button
          type="button"
          onClick={() => onChange([...tasks, { id: uid(), label: 'New task', done: false }])}
          className={ADD_BTN}
          style={{ color: MOVE_UP }}
        >
          + Add
        </button>
      ) : (
        <div className="mt-[18px]">
          <div className="mb-1.5 flex justify-between text-xs text-muted">
            <span>Task Progress</span>
            <span className="tabular">{progress}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface2">
            <div
              className="h-full transition-[width] duration-300"
              style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${T.cyan}, ${MOVE_UP})` }}
            />
          </div>
        </div>
      )}
    </Card>
  )
}

function QuickLinksCard({ links, onChange }: { links: LinkItem[]; onChange: (next: LinkItem[]) => void }) {
  const [editing, setEditing] = useState(false)
  return (
    <Card
      title={<span style={{ color: T.cyan }}>🔗 Quick Links</span>}
      actions={<Chip label={editing ? 'Done' : 'Edit'} on={editing} onClick={() => setEditing((v) => !v)} />}
    >
      <div className="flex flex-col gap-2.5">
        {links.map((l) =>
          editing ? (
            <div key={l.id} className="flex items-center gap-1.5">
              <select
                value={l.href}
                onChange={(e) => {
                  const page = ALL_PAGES.find((p) => p.href === e.target.value)
                  onChange(links.map((x) => (x.id === l.id ? { ...x, href: e.target.value, label: page?.label ?? x.label } : x)))
                }}
                className={`${EDIT_INPUT} flex-1`}
              >
                {ALL_PAGES.map((p) => (
                  <option key={p.href} value={p.href}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onChange(links.filter((x) => x.id !== l.id))}
                className="text-xs"
                style={{ color: MOVE_DOWN }}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ) : LIVE_ROUTES.has(l.href) ? (
            <Link
              key={l.id}
              to={l.href}
              className="flex items-center justify-between rounded-md border border-line bg-surface2 px-3.5 py-2.5 text-sm font-semibold text-fg no-underline transition-colors hover:border-accent hover:bg-raised"
            >
              <span>{l.label}</span>
              <span style={{ color: T.cyan }}>→</span>
            </Link>
          ) : (
            <span
              key={l.id}
              title={`${l.label} — coming soon`}
              className="flex cursor-not-allowed items-center justify-between rounded-md border border-line bg-surface2 px-3.5 py-2.5 text-sm font-semibold text-faint opacity-50"
            >
              <span>{l.label}</span>
              <span>→</span>
            </span>
          ),
        )}
      </div>
      {editing && (
        <button
          type="button"
          onClick={() => {
            const p = ALL_PAGES.find((x) => !links.some((l) => l.href === x.href)) ?? ALL_PAGES[0]
            if (!p) return
            onChange([...links, { id: uid(), label: p.label, href: p.href }])
          }}
          className={ADD_BTN}
          style={{ color: T.cyan }}
        >
          + Add
        </button>
      )}
    </Card>
  )
}

/** What the wheel's card looks like while its chunk is still in flight. */
function WheelFallback() {
  return (
    <Card title="S&P Sector Wheel">
      <div className="px-3 py-12 text-center text-xs text-muted opacity-60">Loading sector data…</div>
    </Card>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TradersDashboardPage() {
  const { countdown, targetLabel, phase, dateStr } = useCountdown()

  // The DEFAULTS are what renders until the row comes back — no local seed, see
  // the note beside PREFS_URL.
  const [schedule, setSchedule] = useState<ScheduleItem[]>(DEFAULT_SCHEDULE)
  const [tasks, setTasks] = useState<TaskItem[]>(DEFAULT_TASKS)
  const [links, setLinks] = useState<LinkItem[]>(DEFAULT_LINKS)
  const [zip, setZip] = useState('')
  const [zipInput, setZipInput] = useState('')
  /** Nothing is POSTed before the GET has answered, or the load overwrites the save. */
  const loadedRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<PrefsRow>({})

  /**
   * POST whatever is queued, right now.
   *
   * `keepalive` is the point: this also runs from `pagehide`, where a normal
   * fetch is cancelled the moment the document goes away and the last edit is
   * simply lost. keepalive hands the request to the browser to finish on its
   * own. (64KB cap — a schedule and a task list are nowhere near it.)
   */
  const flush = useCallback((keepalive = false) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const body = pending.current
    if (!Object.keys(body).length) return
    pending.current = {}
    void fetch(PREFS_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive,
    }).catch(() => {
      /* nothing local to fall back on by design — the row is the only store */
    })
  }, [])

  // ── Load ──
  // The row is authoritative for every field, INCLUDING an absent one: a ZIP
  // cleared on the server has to clear here too, which is exactly what a local
  // mirror used to prevent.
  useEffect(() => {
    let active = true
    fetch(PREFS_URL, { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<PrefsRow>) : null))
      .then((j) => {
        if (!active || !j) return
        if (isScheduleArr(j.schedule)) setSchedule(j.schedule)
        if (isTaskArr(j.tasks)) setTasks(j.tasks)
        if (isLinkArr(j.links)) setLinks(j.links)
        const saved = typeof j.zip === 'string' && /^\d{5}$/.test(j.zip.trim()) ? j.zip.trim() : ''
        setZip(saved)
        setZipInput(saved)
      })
      .catch(() => {
        /* 401, offline, route down — the sample widgets stay on screen, and
           loadedRef stays gated below so nothing overwrites the real row */
      })
      .finally(() => {
        if (active) loadedRef.current = true
      })
    return () => {
      active = false
    }
  }, [])

  // ── Save ──
  // Debounced for real. v2's helper was captioned "(debounced)" and was not, so
  // every keystroke in an edit field was its own POST.
  const savePrefs = useCallback(
    (patch: PrefsRow) => {
      if (!loadedRef.current) return
      pending.current = { ...pending.current, ...patch }
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => flush(false), SAVE_DEBOUNCE_MS)
    },
    [flush],
  )

  // A debounce that drops its last write on unmount is a debounce that eats
  // edits: set a ZIP and click away inside 400ms and v2 would have saved it,
  // this would not have. Both exits are covered — leaving the page, and closing
  // the tab.
  useEffect(() => {
    const onHide = () => flush(true)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      flush(true)
    }
  }, [flush])

  const updSchedule = useCallback(
    (next: ScheduleItem[]) => {
      setSchedule(next)
      savePrefs({ schedule: next })
    },
    [savePrefs],
  )
  const updTasks = useCallback(
    (next: TaskItem[]) => {
      setTasks(next)
      savePrefs({ tasks: next })
    },
    [savePrefs],
  )
  const updLinks = useCallback(
    (next: LinkItem[]) => {
      setLinks(next)
      savePrefs({ links: next })
    },
    [savePrefs],
  )
  const submitZip = useCallback(() => {
    const z = zipInput.trim()
    if (!/^\d{5}$/.test(z)) return // v2 fails silently here too
    setZip(z)
    savePrefs({ zip: z })
  }, [zipInput, savePrefs])
  const clearZip = useCallback(() => {
    setZip('')
    setZipInput('')
    savePrefs({ zip: null })
  }, [savePrefs])

  // Every request this page needs, fired in parallel at the top of the
  // component — no card below waits on another card's request to resolve.
  const futuresSymbols = FUTURES.map((f) => f.yahoo).join(',')
  const quotesQ = useQuery<Record<string, QuoteRow>>(
    `/api/yahoo-quotes?symbols=${encodeURIComponent(futuresSymbols)}`,
    { pollMs: 60_000 },
  )
  const calendarQ = useQuery<unknown>('/api/calendar', { staleMs: 5 * 60_000 })
  const overviewQ = useQuery<{ overview?: OverviewRow }>('/api/traders-dashboard/overview', { staleMs: 5 * 60_000 })
  const moversQ = useQuery<{ movers?: Mover[] }>('/api/premarket-movers', { pollMs: 5 * 60_000 })
  const weatherQ = useQuery<WeatherRow>(zip ? `/api/weather?zip=${zip}` : null)
  const wheelQ = useQuery<WheelPayload>('/api/spx-sunburst', { pollMs: WHEEL_POLL_MS })

  const events = useMemo<CalEvent[]>(() => {
    const j = calendarQ.data
    if (Array.isArray(j)) return j as CalEvent[]
    if (hasEventsField(j) && Array.isArray(j.events)) return j.events as CalEvent[]
    return []
  }, [calendarQ.data])

  const quotes = quotesQ.data ?? {}
  const overview = overviewQ.data?.overview
  const movers = moversQ.data?.movers ?? []

  return (
    <Page
      title={
        <div>
          <div>Traders Dashboard</div>
          <div className="text-xs font-normal text-muted">{dateStr}</div>
        </div>
      }
      actions={
        <div className="flex flex-wrap items-center justify-end gap-3.5">
          {/* The page you want BEFORE this one, so it sits in the header rather
              than down in Quick Links. */}
          <Link
            to="/premarket"
            className={HEADER_BTN}
            style={{ borderColor: alpha(T.orange, 0.55), background: PREMARKET_BG, color: T.text }}
            // Inline, as v2 had it: the resting background is a gradient set in
            // the style attribute, and a :hover class cannot beat that.
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = T.orange
              e.currentTarget.style.background = alpha(T.orange, 0.28)
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = alpha(T.orange, 0.55)
              e.currentTarget.style.background = PREMARKET_BG
            }}
          >
            <span aria-hidden>🌅</span>
            <span>Premarket Prep</span>
            <span style={{ color: T.orange }}>→</span>
          </Link>
          <ComingSoonPill icon="🗓" label="Economic Calendar" />
          <WeatherWidget
            zipInput={zipInput}
            onZipInput={setZipInput}
            onSubmit={submitZip}
            onClear={clearZip}
            weather={weatherQ.data}
          />
        </div>
      }
    >
      {/* 17:10 is v2's minmax(0,1.7fr) minmax(0,1fr), to the decimal. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[17fr_10fr]">
        {/* LEFT COLUMN */}
        <div className="flex min-w-0 flex-col gap-5">
          <CountdownCard countdown={countdown} targetLabel={targetLabel} phase={phase} />
          <OverviewCard
            overview={overview}
            events={events}
            quotes={quotes}
            movers={movers}
            quotesStale={quotesQ.loading && quotesQ.data === undefined}
            moversStale={moversQ.loading && moversQ.data === undefined}
            quotesFailed={!!quotesQ.error}
          />
        </div>

        {/* RIGHT COLUMN */}
        <div className="flex min-w-0 flex-col gap-5">
          <ScheduleCard schedule={schedule} onChange={updSchedule} />
          <TasksCard tasks={tasks} onChange={updTasks} />
          <Suspense fallback={<WheelFallback />}>
            <SectorWheel payload={wheelQ.data} failed={!!wheelQ.error} />
          </Suspense>
          <QuickLinksCard links={links} onChange={updLinks} />
        </div>
      </div>
    </Page>
  )
}
