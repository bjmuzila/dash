import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Page } from '@/design/primitives/Page'
import { Card } from '@/design/primitives/Card'
import { Table, type Column } from '@/design/primitives/Table'
import { Stat, type Direction } from '@/design/primitives/Stat'
import { Chip } from '@/design/primitives/Controls'
import { useQuery } from '@/data/api'

// ─────────────────────────────────────────────────────────────────────────────
// TradersDashboard — the pre-market cockpit: a countdown to the next bell, the
// overnight overview, today's macro drivers, and personal widgets (schedule /
// tasks / quick links) a trader edits once and reloads with every visit.
// Replaces v2's /app/traders-dashboard (components/pages/TradersDashboard.tsx).
//
// Two deliberate departures from v2:
//   1. Prefs (schedule/tasks/links/zip) were server-backed in v2 via
//      /api/traders-dashboard. v3 has no such route yet, so per the page spec
//      they live in localStorage under `cb-v3-td-*` keys instead — same
//      shape, same edit UX, persisted per browser like the Board layout and
//      rail order already are. Swapping this for a REST save later is a
//      change to load()/persist() only.
//   2. v2's gradient-text title and canvas-based snapshot button (homeTheme,
//      CopySnapButton) don't carry across — colour comes only from
//      src/design/tokens.css, and the snapshot needs a DOM-to-canvas
//      renderer this single file can't pull in, so it is left un-ported.
// ─────────────────────────────────────────────────────────────────────────────

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
//
// Scanner, Test Lab, Journal, ICT, ES Candles, Board and Multi Greek came out
// on 2026-08-30 — they are not future destinations any more, they are retired,
// so they are not in the picker either. Anyone with one saved in Quick Links keeps
// a dimmed tile (the render path already handles an href that is not in
// ALL_PAGES) until they edit it away.
const ALL_PAGES: { label: string; href: string }[] = [
  { label: 'Home', href: '/' },
  { label: 'Traders Dashboard', href: '/traders-dashboard' },
  { label: 'Premarket Prep', href: '/premarket' },
  { label: 'Options Chain', href: '/options-chain' },
  { label: 'Est. Moves', href: '/em' },
  { label: 'Analysis', href: '/analytics' },
  { label: 'Replay', href: '/replay' },
  { label: 'Flow', href: '/flow' },
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
])

// Applies only to a browser with no saved Quick Links yet.
const DEFAULT_LINKS: LinkItem[] = [
  { id: 'l1', label: 'Premarket Prep', href: '/premarket' },
  { id: 'l2', label: 'Home', href: '/' },
  { id: 'l3', label: 'Options Chain', href: '/options-chain' },
  { id: 'l4', label: 'Analysis', href: '/analytics' },
]

// One accent per driver slot, cycling if there are more than four. Kept as
// token pairs (text + bg) rather than a border colour, since border-<token>
// is only guaranteed generated for the semantic/level/calendar families.
const DRIVER_ACCENTS = [
  { text: 'text-accent', bg: 'bg-accent' },
  { text: 'text-warn', bg: 'bg-warn' },
  { text: 'text-down', bg: 'bg-down' },
  { text: 'text-series-4', bg: 'bg-series-4' },
] as const

/** Bounds-safe read of the ramp above: the modulo can only land in range, but
 *  an array index alone is `| undefined` under noUncheckedIndexedAccess. */
function driverAccent(i: number): { text: string; bg: string } {
  return DRIVER_ACCENTS[i % DRIVER_ACCENTS.length] ?? DRIVER_ACCENTS[0]
}

const uid = () => Math.random().toString(36).slice(2, 9)

// US equity-market full-day closures (NYSE/Cboe), ET date strings. Keep in
// sync with whatever server-side calendar v3 eventually gets.
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
])
const etDateStr = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const etWeekday = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(d)
const isTradingDay = (d: Date) => {
  const wd = etWeekday(d)
  return wd !== 'Sat' && wd !== 'Sun' && !MARKET_HOLIDAYS.has(etDateStr(d))
}

// ── localStorage persistence ─────────────────────────────────────────────────
// Same shape a server-backed /api/traders-dashboard route would round-trip —
// see the file header. Each loader validates its shape before trusting it, the
// same defensiveness Shell.tsx's loadOrder and BoardPage's loadLayout use for
// their own localStorage reads.

const SCHEDULE_KEY = 'cb-v3-td-schedule'
const TASKS_KEY = 'cb-v3-td-tasks'
const LINKS_KEY = 'cb-v3-td-links'
const ZIP_KEY = 'cb-v3-td-zip'

function loadJson<T>(key: string, isValid: (v: unknown) => v is T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    return isValid(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}
function persistJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* best-effort — the in-memory value still works for this session */
  }
}

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
const isScheduleArr = (v: unknown): v is ScheduleItem[] => Array.isArray(v) && v.length > 0 && v.every(isScheduleItem)
const isTaskArr = (v: unknown): v is TaskItem[] => Array.isArray(v) && v.length > 0 && v.every(isTaskItem)
const isLinkArr = (v: unknown): v is LinkItem[] => Array.isArray(v) && v.length > 0 && v.every(isLinkItem)

function loadZip(): string {
  try {
    const raw = localStorage.getItem(ZIP_KEY)
    return raw && /^\d{5}$/.test(raw) ? raw : ''
  } catch {
    return ''
  }
}

// ── Formatting ───────────────────────────────────────────────────────────────

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}
function pctDirection(n: number | null | undefined): Direction | undefined {
  if (n == null || Number.isNaN(n)) return undefined
  return n > 0 ? 'up' : n < 0 ? 'down' : 'flat'
}

// ── Response guards (calendar's shape is a bare array on some deployments and
// {events:[...]} on others — the same ambiguity v2 defended against) ─────────

function hasEventsField(v: unknown): v is { events: unknown } {
  return typeof v === 'object' && v !== null && 'events' in v
}

// ── Small header widgets ─────────────────────────────────────────────────────

function ComingSoonPill({ icon, label }: { icon: string; label: string }) {
  return (
    <span
      title={`${label} — coming soon`}
      className="inline-flex shrink-0 cursor-not-allowed items-center gap-1.5 whitespace-nowrap rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-faint opacity-50"
    >
      <span aria-hidden>{icon}</span>
      {label}
    </span>
  )
}

function WeatherWidget({
  zip,
  zipInput,
  onZipInput,
  onSubmit,
  onClear,
  weather,
  stale,
}: {
  zip: string
  zipInput: string
  onZipInput: (v: string) => void
  onSubmit: () => void
  onClear: () => void
  weather: WeatherRow | undefined
  stale: boolean
}) {
  if (weather) {
    return (
      <div className={stale ? 'stale text-right' : 'text-right'}>
        <div className="text-lg font-semibold text-up">
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
      <button type="submit" className="rounded-sm border border-line px-2 py-1 text-xs font-semibold text-accent">
        Set
      </button>
      {zip && <span className="text-xs text-faint">loading…</span>}
    </form>
  )
}

// ── Countdown card ───────────────────────────────────────────────────────────

function useCountdown() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  return useMemo(() => {
    if (!now) return { countdown: '--:--:--', targetLabel: '9:30 AM EST', phase: 'open' as const, dateStr: '' }
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(now)
    const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0)
    let hh = get('hour')
    if (hh === 24) hh = 0
    const nowSec = hh * 3600 + get('minute') * 60 + get('second')
    const OPEN = 9 * 3600 + 30 * 60
    const CLOSE = 16 * 3600
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
    <Card title={phase === 'close' ? 'Countdown to Market Close' : 'Countdown to Market Open'}>
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <div className="tabular text-6xl font-extrabold tracking-wide text-fg">{countdown}</div>
        <div className="text-sm text-muted">{targetLabel}</div>
      </div>
    </Card>
  )
}

// ── Overnight overview card ──────────────────────────────────────────────────

const MOVER_COLUMNS: Column<Mover>[] = [
  {
    key: 'symbol',
    header: 'Sym',
    width: '64px',
    cell: (m) => <span className="font-semibold text-accent">{m.symbol}</span>,
  },
  {
    key: 'name',
    header: 'Name',
    cell: (m) => <span className="text-faint">{m.name.length > 22 ? `${m.name.slice(0, 22)}…` : m.name}</span>,
  },
  {
    key: 'chg',
    header: 'Chg',
    numeric: true,
    cell: (m) => {
      const pct = m.preMarketPct ?? m.pct
      const dir = pctDirection(pct)
      const cls = dir === 'up' ? 'text-up' : dir === 'down' ? 'text-down' : 'text-flat'
      return (
        <span>
          <span className={cls}>{fmtPct(pct)}</span>
          {m.preMarketPct != null && <span className="ml-1 text-faint">PM</span>}
        </span>
      )
    },
  },
]

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
  // high-impact USD calendar rows as a fallback so the card is never empty.
  const drivers: Driver[] = useMemo(() => {
    if (overview?.drivers?.length) return overview.drivers.slice(0, 4)
    const etToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
    return events
      .filter((e) => e.date === etToday && e.country === 'USD' && /high/i.test(e.impact))
      .slice(0, 4)
      .map((e) => ({ when: e.time_formatted || 'Today', title: e.title, body: `High-impact USD event · ${e.country}` }))
  }, [overview, events])

  const shownMovers = movers.length ? movers : (overview?.movers ?? [])

  return (
    <Card
      title="Overnight Market Overview"
      actions={
        overview && Number(overview.generated_at) > 0 ? (
          <span className="text-xs text-faint">
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
      <div className="mb-4 border-l-2 border-accent pl-3 text-sm leading-relaxed text-muted">
        {overview ? (
          <>
            <strong className="text-fg">Sentiment:</strong> {overview.summary}
          </>
        ) : (
          <span className="text-faint">Today&apos;s overview is generated automatically at 7:00 AM ET. Check back shortly.</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Overnight Futures</div>
          <div className={quotesStale ? 'stale mb-4 flex gap-2' : 'mb-4 flex gap-2'}>
            {FUTURES.map((f) => (
              <div key={f.sym} className="flex-1 rounded-md border border-line bg-surface2 px-1.5 py-2 text-center">
                <Stat label={f.sym} value={fmtPct(quotes[f.yahoo]?.pct)} direction={pctDirection(quotes[f.yahoo]?.pct)} size="sm" />
              </div>
            ))}
          </div>
          {quotesFailed && <div className="mb-2 text-xs text-down">Live quotes unavailable — showing last known values.</div>}

          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Trending Now</div>
          {shownMovers.length ? (
            <div className={moversStale ? 'stale' : ''}>
              <Table columns={MOVER_COLUMNS} rows={shownMovers} rowKey={(m) => m.symbol} />
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-line bg-surface2 px-3 py-3 text-center text-xs text-faint">
              Available after 7 AM ET overview generates.
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Key Drivers Today</div>
          <div className="flex flex-col gap-3">
            {drivers.length ? (
              drivers.map((d, i) => {
                const accent = driverAccent(i)
                return (
                  <div key={d.title + i} className="flex gap-2.5">
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${accent.bg}`} aria-hidden />
                    <div className="min-w-0">
                      <div className={`text-2xs font-bold uppercase tracking-wider ${accent.text}`}>{d.when}</div>
                      <div className="my-0.5 font-semibold text-fg">{d.title}</div>
                      <div className="text-xs leading-snug text-muted">{d.body}</div>
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="text-xs text-faint">No major USD events scheduled today.</div>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ── Schedule / Tasks / Links cards ───────────────────────────────────────────

function ScheduleCard({ schedule, onChange }: { schedule: ScheduleItem[]; onChange: (next: ScheduleItem[]) => void }) {
  const [editing, setEditing] = useState(false)
  return (
    <Card title="Morning Schedule" actions={<Chip label={editing ? 'Done' : 'Edit'} on={editing} onClick={() => setEditing((v) => !v)} />}>
      <div className="mb-3 text-xs text-faint">
        These are sample times — tap <span className="font-semibold text-accent">Edit</span> to swap in your own routine.
      </div>
      <div className="flex flex-col gap-2">
        {schedule.map((s, i) =>
          editing ? (
            <div key={s.id} className="flex items-center gap-1.5">
              <input
                value={s.time}
                onChange={(e) => onChange(schedule.map((x) => (x.id === s.id ? { ...x, time: e.target.value } : x)))}
                className="w-24 rounded-sm border border-line bg-surface2 px-2 py-1 text-xs text-fg outline-none focus:border-accent"
              />
              <input
                value={s.label}
                onChange={(e) => onChange(schedule.map((x) => (x.id === s.id ? { ...x, label: e.target.value } : x)))}
                className="min-w-0 flex-1 rounded-sm border border-line bg-surface2 px-2 py-1 text-xs text-fg outline-none focus:border-accent"
              />
              <button onClick={() => onChange(schedule.filter((x) => x.id !== s.id))} className="text-xs text-faint hover:text-down">
                ✕
              </button>
            </div>
          ) : (
            <div key={s.id} className="flex items-center gap-3">
              <span className="tabular w-20 shrink-0 text-xs font-semibold text-muted">{s.time}</span>
              <span className={i === schedule.length - 1 ? 'font-semibold text-fg' : 'text-fg'}>{s.label}</span>
            </div>
          ),
        )}
      </div>
      {editing && (
        <button
          onClick={() => onChange([...schedule, { id: uid(), time: '09:00 AM', label: 'New item' }])}
          className="mt-3 rounded-sm border border-line px-2 py-1 text-xs font-semibold text-accent"
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
    <Card title="Pre-Market Tasks" actions={<Chip label={editing ? 'Done' : 'Edit'} on={editing} onClick={() => setEditing((v) => !v)} />}>
      <div className="mb-3 text-xs text-faint">
        Sample tasks — tap <span className="font-semibold text-up">Edit</span> to make them your own.
      </div>
      <div className="flex flex-col gap-2.5">
        {tasks.map((t) =>
          editing ? (
            <div key={t.id} className="flex items-center gap-1.5">
              <input
                value={t.label}
                onChange={(e) => onChange(tasks.map((x) => (x.id === t.id ? { ...x, label: e.target.value } : x)))}
                className="min-w-0 flex-1 rounded-sm border border-line bg-surface2 px-2 py-1 text-xs text-fg outline-none focus:border-accent"
              />
              <button onClick={() => onChange(tasks.filter((x) => x.id !== t.id))} className="text-xs text-faint hover:text-down">
                ✕
              </button>
            </div>
          ) : (
            <label key={t.id} className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={t.done}
                onChange={() => onChange(tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span className={t.done ? 'text-sm text-muted line-through' : 'text-sm text-fg'}>{t.label}</span>
            </label>
          ),
        )}
      </div>
      {editing ? (
        <button
          onClick={() => onChange([...tasks, { id: uid(), label: 'New task', done: false }])}
          className="mt-3 rounded-sm border border-line px-2 py-1 text-xs font-semibold text-up"
        >
          + Add
        </button>
      ) : (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs text-muted">
            <span>Task Progress</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface2">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
    </Card>
  )
}

// The sector-rotation sunburst is a bespoke D3/canvas visualisation
// (components/dashboard/SectorSunburst.tsx in v2) with its own data fetching
// and rendering pipeline — too much to fold into this file per the page
// contract's scope rule. The card stays in its v2 position, named honestly.
// TODO(v3): port components/dashboard/SectorSunburst.tsx as its own module
// under src/design/ or src/pages/, then render it here.
function SectorRotationCard() {
  return (
    <Card title="Sector Rotation">
      <div className="py-6 text-center text-xs text-faint">Sector rotation sunburst not yet ported — see v2 SectorSunburst.tsx.</div>
    </Card>
  )
}

function QuickLinksCard({ links, onChange }: { links: LinkItem[]; onChange: (next: LinkItem[]) => void }) {
  const [editing, setEditing] = useState(false)
  return (
    <Card title="Quick Links" actions={<Chip label={editing ? 'Done' : 'Edit'} on={editing} onClick={() => setEditing((v) => !v)} />}>
      <div className="flex flex-col gap-2">
        {links.map((l) =>
          editing ? (
            <div key={l.id} className="flex items-center gap-1.5">
              <select
                value={l.href}
                onChange={(e) => {
                  const page = ALL_PAGES.find((p) => p.href === e.target.value)
                  onChange(links.map((x) => (x.id === l.id ? { ...x, href: e.target.value, label: page?.label ?? x.label } : x)))
                }}
                className="min-w-0 flex-1 rounded-sm border border-line bg-surface2 px-2 py-1 text-xs text-fg outline-none focus:border-accent"
              >
                {ALL_PAGES.map((p) => (
                  <option key={p.href} value={p.href}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button onClick={() => onChange(links.filter((x) => x.id !== l.id))} className="text-xs text-faint hover:text-down">
                ✕
              </button>
            </div>
          ) : LIVE_ROUTES.has(l.href) ? (
            <Link
              key={l.id}
              to={l.href}
              className="flex items-center justify-between rounded-md border border-line bg-surface2 px-3 py-2 text-sm font-semibold text-fg no-underline transition-colors hover:border-accent hover:bg-raised"
            >
              <span>{l.label}</span>
              <span className="text-accent">→</span>
            </Link>
          ) : (
            <span
              key={l.id}
              title={`${l.label} — coming soon`}
              className="flex cursor-not-allowed items-center justify-between rounded-md border border-line bg-surface2 px-3 py-2 text-sm font-semibold text-faint opacity-50"
            >
              <span>{l.label}</span>
              <span>→</span>
            </span>
          ),
        )}
      </div>
      {editing && (
        <button
          onClick={() => {
            const p = ALL_PAGES.find((x) => !links.some((l) => l.href === x.href)) ?? ALL_PAGES[0]
            if (!p) return
            onChange([...links, { id: uid(), label: p.label, href: p.href }])
          }}
          className="mt-3 rounded-sm border border-line px-2 py-1 text-xs font-semibold text-accent"
        >
          + Add
        </button>
      )}
    </Card>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TradersDashboardPage() {
  const { countdown, targetLabel, phase, dateStr } = useCountdown()

  // Personal widgets — localStorage only, see the file header for why this
  // differs from v2's server round trip.
  const [schedule, setSchedule] = useState<ScheduleItem[]>(() => loadJson(SCHEDULE_KEY, isScheduleArr, DEFAULT_SCHEDULE))
  const [tasks, setTasks] = useState<TaskItem[]>(() => loadJson(TASKS_KEY, isTaskArr, DEFAULT_TASKS))
  const [links, setLinks] = useState<LinkItem[]>(() => loadJson(LINKS_KEY, isLinkArr, DEFAULT_LINKS))
  const [zip, setZip] = useState<string>(() => loadZip())
  const [zipInput, setZipInput] = useState(zip)

  const updSchedule = (next: ScheduleItem[]) => {
    setSchedule(next)
    persistJson(SCHEDULE_KEY, next)
  }
  const updTasks = (next: TaskItem[]) => {
    setTasks(next)
    persistJson(TASKS_KEY, next)
  }
  const updLinks = (next: LinkItem[]) => {
    setLinks(next)
    persistJson(LINKS_KEY, next)
  }
  const submitZip = () => {
    const z = zipInput.trim()
    if (!/^\d{5}$/.test(z)) return
    setZip(z)
    persistJson(ZIP_KEY, z)
  }
  const clearZip = () => {
    setZip('')
    setZipInput('')
    try {
      localStorage.removeItem(ZIP_KEY)
    } catch {
      /* best-effort */
    }
  }

  // Every fetch this page needs, fired in parallel at the top of the
  // component — no card below waits on another card's request to resolve.
  const futuresSymbols = FUTURES.map((f) => f.yahoo).join(',')
  const quotesQ = useQuery<Record<string, QuoteRow>>(`/api/yahoo-quotes?symbols=${encodeURIComponent(futuresSymbols)}`, { pollMs: 60_000 })
  const calendarQ = useQuery<unknown>('/api/calendar', { staleMs: 5 * 60_000 })
  const overviewQ = useQuery<{ overview?: OverviewRow }>('/api/traders-dashboard/overview', { staleMs: 5 * 60_000 })
  const moversQ = useQuery<{ movers?: Mover[] }>('/api/premarket-movers', { pollMs: 5 * 60_000 })
  const weatherQ = useQuery<WeatherRow>(zip ? `/api/weather?zip=${zip}` : null)

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
        <div className="flex flex-wrap items-center justify-end gap-3">
          <ComingSoonPill icon="🌅" label="Premarket Prep" />
          <ComingSoonPill icon="🗓" label="Economic Calendar" />
          <WeatherWidget
            zip={zip}
            zipInput={zipInput}
            onZipInput={setZipInput}
            onSubmit={submitZip}
            onClear={clearZip}
            weather={weatherQ.data}
            stale={!!weatherQ.error}
          />
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[7fr_4fr]">
        {/* LEFT COLUMN */}
        <div className="flex min-w-0 flex-col gap-4">
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
        <div className="flex min-w-0 flex-col gap-4">
          <ScheduleCard schedule={schedule} onChange={updSchedule} />
          <TasksCard tasks={tasks} onChange={updTasks} />
          <SectorRotationCard />
          <QuickLinksCard links={links} onChange={updLinks} />
        </div>
      </div>
    </Page>
  )
}
