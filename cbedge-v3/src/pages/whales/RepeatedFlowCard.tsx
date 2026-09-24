import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { SegGroup, SegMenu } from '@/design/primitives/Controls'
import { readableError, useQuery } from '@/data/api'
import { fmtPremium, fmtStrike, fmtTime } from '@/data/flowMath'
import { TrackButton } from './TrackedAlertsCard'
import { ContractProbe, type ProbeAlertInfo } from '@/board/topFlow/ContractProbe'
import type { TopFlowRow } from '@/board/topFlow/TopFlowCard'

// ─────────────────────────────────────────────────────────────────────────────
// REPEATED FLOW (2026-09-24) — the same contract hit over and over.
//
// The archive above is "who swung $1M+". This is the other signal: a contract
// that keeps getting hit with $50K+ orders. Backed by /api/lse/repeated-flow,
// which groups every print at or above the floor by contract and keeps the
// ones hit at least MIN ORDERS times (5 is the floor; 10+ and 25+ are the
// stronger filters).
//
// Its own FLOOR, ORDERS and WINDOW controls — the page's ≥$1M floor is exactly
// what this section exists to look under. It does follow the page's ticker,
// C/P, side, DTE, strike and unreadable filters, so "SPY, 0DTE, OTM" narrows
// both at once.
//
// Only the last seven days exist below the whale floor (the retention sweep),
// so the window is TODAY or 5D, never the archive's 3M/ALL.
//
// GROUPED BY BURST (2026-09-24): WITHIN 30M / 1H / 2H / 4H / DAY is how
// tightly the orders must cluster. A 0DTE strike hit 120 times across the day
// is noise; hit 20 times inside 30 minutes is the signal. The server scores
// each contract on its DENSEST window of that length, so ORDERS, DIR, premium,
// FIRST and LAST all describe that one burst. ALL DAY is the whole range's
// count, for context. RANGE (TODAY / 5D) is separate: which sessions to scan.
//
// CLICK A ROW (2026-09-24) — the probe chart opens right under it, the same
// ContractProbe the prints table and Tracked contracts draw (⤢ pops it out).
// It used to load the contract into the lookup panel, which sits in the right
// rail far above this full-width section, so the click looked like it did
// nothing. The burst's average fill is the entry and its first order is the
// marker, so the chart reads "what has it done since the hammering started".
//
// SORT: every column header sorts (click again to flip). Client-side over the
// server's list (top 100 by order count). Phone gets a SORT menu instead.
//
// An "order" is a stored print — the capture has no sweep/block flag. The
// DIR column counts how one-sided the repetition was: 25 hits split 13/12 is
// churn, 25/0 is someone building.
// ─────────────────────────────────────────────────────────────────────────────

interface RepeatContract {
  osi: string
  ticker: string
  strike: string
  type: string
  expiry: string
  n: number
  bullN: number
  bearN: number
  total: number
  bull: number
  bear: number
  size: number
  avgPrice: number | null
  firstTs: number
  lastTs: number
  /** Whole-range totals for the contract, not just the burst. */
  nAll: number
  totalAll: number
}
interface RepeatResponse {
  range: { from: string; to: string }
  clamped: boolean
  retainDays: number
  minPremium: number
  minOrders: number
  windowMin?: number
  summary: { contracts: number; orders: number; premium: number }
  contracts: RepeatContract[]
  error?: string | null
}

const FLOORS = [
  { label: '≥$50K', value: 50_000 },
  { label: '≥$100K', value: 100_000 },
  { label: '≥$250K', value: 250_000 },
  { label: '≥$500K', value: 500_000 },
]
const ORDER_STOPS = [
  { label: '5+', value: 5, title: 'Hit at least 5 times' },
  { label: '10+', value: 10, title: 'Hit at least 10 times — stronger' },
  { label: '25+', value: 25, title: 'Hit at least 25 times — strongest' },
]
type RangeKey = '1d' | '5d'
const RANGES: Array<{ key: RangeKey; label: string; days: number; title: string }> = [
  { key: '1d', label: 'TODAY', days: 0, title: 'Scan today' },
  { key: '5d', label: '5D', days: 4, title: 'Scan the last five sessions' },
]
/** Cluster window in minutes — the orders must land inside one of these. */
const CLUSTERS: Array<{ label: string; value: number; title: string }> = [
  { label: '30M', value: 30, title: 'All the orders inside one 30-minute window' },
  { label: '1H', value: 60, title: 'All the orders inside one hour' },
  { label: '2H', value: 120, title: 'All the orders inside two hours' },
  { label: '4H', value: 240, title: 'All the orders inside four hours' },
  { label: 'DAY', value: 1440, title: 'Anywhere in the session — no clustering' },
]

type SortKey =
  | 'ticker' | 'strike' | 'expiry' | 'n' | 'dir' | 'split'
  | 'size' | 'avgPrice' | 'firstTs' | 'lastTs' | 'span' | 'total' | 'nAll' | 'tracked'
type SortDir = 'asc' | 'desc'
const SORT_KEYS: SortKey[] = ['ticker', 'strike', 'expiry', 'n', 'dir', 'split', 'size', 'avgPrice', 'firstTs', 'lastTs', 'span', 'total', 'nAll', 'tracked']
/** First click sorts A→Z / smallest first on these; biggest first on the rest.
 *  SPAN is here because the tightest burst is the interesting end. */
const TEXT_SORTS: SortKey[] = ['ticker', 'expiry', 'span']
const PHONE_SORTS: Array<{ label: string; value: SortKey }> = [
  { label: 'ORDERS', value: 'n' },
  { label: 'TIGHTEST', value: 'span' },
  { label: 'ALL DAY', value: 'nAll' },
  { label: 'PREMIUM', value: 'total' },
  { label: 'DIR %', value: 'dir' },
  { label: 'LAST HIT', value: 'lastTs' },
  { label: 'FIRST HIT', value: 'firstTs' },
  { label: 'EXPIRY', value: 'expiry' },
  { label: 'TICKER', value: 'ticker' },
]

const SETTINGS_KEY = 'cb-v3-whales:repeated'
interface Saved { floor: number; minOrders: number; range: RangeKey; cluster: number; sortKey: SortKey; sortDir: SortDir }
const DEFAULTS: Saved = { floor: 50_000, minOrders: 5, range: '1d', cluster: 30, sortKey: 'n', sortDir: 'desc' }

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULTS
    const j = JSON.parse(raw) as Partial<Saved>
    return {
      floor: FLOORS.some((f) => f.value === j.floor) ? (j.floor as number) : DEFAULTS.floor,
      minOrders: ORDER_STOPS.some((o) => o.value === j.minOrders) ? (j.minOrders as number) : DEFAULTS.minOrders,
      range: j.range === '5d' ? '5d' : DEFAULTS.range,
      cluster: CLUSTERS.some((c) => c.value === j.cluster) ? (j.cluster as number) : DEFAULTS.cluster,
      sortKey: SORT_KEYS.includes(j.sortKey as SortKey) ? (j.sortKey as SortKey) : DEFAULTS.sortKey,
      sortDir: j.sortDir === 'asc' ? 'asc' : 'desc',
    }
  } catch {
    return DEFAULTS
  }
}

const etYmd = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
const money = (v: number | null | undefined) => fmtPremium(Number(v ?? 0))
const num = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString())
const fmtExpiry = (iso: string) => {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
/** How long the burst took, first order to last. */
const fmtSpan = (r: { firstTs: number; lastTs: number }) => {
  const m = Math.max(0, Math.round((r.lastTs - r.firstTs) / 60_000))
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}
const fmtWhen = (ts: number, multiDay: boolean) => {
  if (!ts) return '—'
  if (!multiDay) return fmtTime(ts)
  const md = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit' }).format(new Date(ts))
  return `${md} ${fmtTime(ts)}`
}

export interface RepeatedFlowFilters {
  ticker: string
  type: '' | 'C' | 'P'
  action: '' | 'BUY' | 'SELL'
  moneyness: 'all' | 'otm'
  maxDte: number | null
  maxPrice: number | null
  showUnreadable: boolean
}

/** The Tracked-contracts identity — same shape as alertsStore's contractKey. */
export const repeatKey = (r: Pick<RepeatContract, 'ticker' | 'strike' | 'type' | 'expiry'>) =>
  `${r.ticker}|${Number(r.strike)}|${r.type === 'P' ? 'P' : 'C'}|${r.expiry}`

export type { RepeatContract }

export function RepeatedFlowCard({ filters, phone = false, trackedKeys, busyKey, onTrack }: {
  filters: RepeatedFlowFilters
  /** Unused since the row opens its own probe — kept so callers still compile. */
  onOpen?: (ticker: string, strike: number, expiry: string, type: string) => void
  phone?: boolean
  /** Keys (repeatKey) already in Tracked contracts. */
  trackedKeys: { has: (k: string) => boolean }
  busyKey: string | null
  /** Track, or untrack when already tracked — the button is a toggle. */
  onTrack: (r: RepeatContract) => void
}) {
  const [saved] = useState<Saved>(loadSaved)
  const [floor, setFloor] = useState(saved.floor)
  const [minOrders, setMinOrders] = useState(saved.minOrders)
  const [range, setRange] = useState<RangeKey>(saved.range)
  const [cluster, setCluster] = useState<number>(saved.cluster)
  const [sortKey, setSortKey] = useState<SortKey>(saved.sortKey)
  const [sortDir, setSortDir] = useState<SortDir>(saved.sortDir)
  // The contract whose probe is open under its row. One at a time.
  const [openOsi, setOpenOsi] = useState<string | null>(null)
  const toggle = (osi: string) => setOpenOsi((cur) => (cur === osi ? null : osi))

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ floor, minOrders, range, cluster, sortKey, sortDir }))
    } catch { /* best-effort */ }
  }, [floor, minOrders, range, cluster, sortKey, sortDir])

  const sortBy = (k: SortKey) => {
    if (k === sortKey) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return }
    setSortKey(k)
    setSortDir(TEXT_SORTS.includes(k) ? 'asc' : 'desc')
  }

  const span = RANGES.find((w) => w.key === range) ?? RANGES[0]!
  const to = etYmd(new Date())
  const from = etYmd(new Date(Date.now() - span.days * 86_400_000))

  const url = useMemo(() => {
    const sp = new URLSearchParams({ from, to, min_premium: String(floor), min_orders: String(minOrders) })
    sp.set('window_min', String(cluster))
    const t = filters.ticker.trim().toUpperCase()
    if (t) sp.set('ticker', t)
    if (filters.type) sp.set('type', filters.type)
    if (filters.action) sp.set('action', filters.action)
    if (filters.moneyness === 'otm') sp.set('moneyness', 'otm')
    if (filters.maxDte !== null) sp.set('max_dte', String(filters.maxDte))
    if (filters.maxPrice !== null) sp.set('max_price', String(filters.maxPrice))
    if (filters.showUnreadable) sp.set('sides', 'all')
    return `/api/lse/repeated-flow?${sp.toString()}`
  }, [from, to, floor, minOrders, filters, cluster])

  const q = useQuery<RepeatResponse>(url, { staleMs: 30_000, pollMs: 60_000 })
  const d = q.data
  const multiDay = range === '5d'
  const clusterLabel = CLUSTERS.find((c) => c.value === cluster)?.label ?? `${cluster}M`
  const err = d?.error ? readableError(d.error) : q.error ? `Could not load repeated flow — ${readableError(q.error)}.` : null

  const size = phone ? 'touch' : 'sm'
  const controls = (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <SegGroup<string>
        size={size}
        title="WITHIN — how tightly the orders must cluster. 20 hits inside 30 minutes, not 120 across the day"
        options={CLUSTERS.map((c) => ({ label: c.label, value: String(c.value), title: c.title }))}
        value={String(cluster)}
        onChange={(v) => setCluster(Number(v))}
      />
      <SegGroup<RangeKey>
        size={size}
        title="Which sessions to scan — only the last seven days are kept below the whale floor"
        options={RANGES.map((w) => ({ label: w.label, value: w.key, title: w.title }))}
        value={range}
        onChange={setRange}
      />
      <SegGroup<string>
        size={size}
        title="Minimum times the same contract was hit"
        options={ORDER_STOPS.map((o) => ({ label: o.label, value: String(o.value), title: o.title }))}
        value={String(minOrders)}
        onChange={(v) => setMinOrders(Number(v))}
      />
      <SegMenu<string>
        size={size}
        label="PER ORDER"
        title="Each print on the contract must be at least this much premium"
        options={FLOORS.map((f) => ({ label: f.label, value: String(f.value) }))}
        value={String(floor)}
        defaultValue={String(DEFAULTS.floor)}
        onChange={(v) => setFloor(Number(v))}
      />
      {phone && (
        <>
          <SegMenu<SortKey>
            size={size}
            label="SORT"
            title="Row order"
            options={PHONE_SORTS}
            value={sortKey}
            defaultValue={DEFAULTS.sortKey}
            onChange={(k) => { setSortKey(k); setSortDir(TEXT_SORTS.includes(k) ? 'asc' : 'desc') }}
          />
          <button
            type="button"
            onClick={() => setSortDir((x) => (x === 'asc' ? 'desc' : 'asc'))}
            title="Flip the order"
            className="rounded-sm border border-line px-2 py-1 text-2xs font-bold text-fg"
          >
            {sortDir === 'asc' ? '▲' : '▼'}
          </button>
        </>
      )}
      <span className="ml-auto text-2xs text-fg">
        {q.loading && !d
          ? 'loading…'
          : d
            ? `${num(d.summary.contracts)} contracts · ${num(d.summary.orders)} orders · ${money(d.summary.premium)}`
            : ''}
      </span>
    </div>
  )

  const dirOf = (r: RepeatContract) => {
    const dir = r.bullN + r.bearN
    if (dir === 0) return { label: '—', pct: null as number | null, ink: 'text-fg' }
    const bull = r.bullN >= r.bearN
    const pct = Math.round(((bull ? r.bullN : r.bearN) / dir) * 100)
    return { label: bull ? 'BULL' : 'BEAR', pct, ink: bull ? 'text-up' : 'text-down' }
  }

  // Signed lean for the DIR sort: +100 all bullish … -100 all bearish, so
  // descending puts the most one-sided bulls first and ascending the bears.
  const leanOf = (r: RepeatContract) => {
    const dir = r.bullN + r.bearN
    return dir > 0 ? ((r.bullN - r.bearN) / dir) * 100 : 0
  }
  const list = useMemo(() => {
    const src = d?.contracts ?? []
    const val = (r: RepeatContract): number | string => {
      switch (sortKey) {
        case 'ticker': return r.ticker
        case 'strike': return Number(r.strike) || 0
        case 'expiry': return r.expiry
        case 'dir': return leanOf(r)
        case 'split': return r.bullN - r.bearN
        case 'avgPrice': return r.avgPrice ?? -Infinity
        case 'span': return r.lastTs - r.firstTs
        case 'tracked': return trackedKeys.has(repeatKey(r)) ? 1 : 0
        default: return r[sortKey]
      }
    }
    const sign = sortDir === 'asc' ? 1 : -1
    return src.slice().sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      const c = typeof va === 'string' || typeof vb === 'string'
        ? String(va).localeCompare(String(vb))
        : (va as number) - (vb as number)
      return c * sign || b.n - a.n || b.total - a.total
    })
  }, [d, sortKey, sortDir, trackedKeys])

  const th = (k: SortKey, label: string, align: 'left' | 'right' = 'left', title?: string): ReactNode => (
    <th
      key={k}
      onClick={() => sortBy(k)}
      title={title ? `${title} — click to sort` : 'Click to sort'}
      aria-sort={sortKey === k ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={[
        'cursor-pointer select-none whitespace-nowrap px-2 py-2 font-bold hover:text-fg',
        align === 'right' ? 'text-right' : 'text-left',
        sortKey === k ? 'text-fg' : '',
      ].join(' ')}
    >
      {label}
      {sortKey === k && <span className="ml-0.5 text-accent">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  )

  /** The burst, dressed as the row ContractProbe draws. */
  const probeRow = (r: RepeatContract): TopFlowRow => ({
    id: `repeat:${r.osi}:${r.firstTs}`,
    ts: r.firstTs,
    osi: r.osi,
    underlying: r.ticker,
    type: r.type === 'P' ? 'P' : 'C',
    strike: Number(r.strike),
    expiry: r.expiry,
    dte: null,
    size: r.size > 0 ? Math.round(r.size) : null,
    price: r.avgPrice,
    premium: r.total,
    spot: null,
    side: null, action: null, sideReason: null,
    bid: null, ask: null, quoteAgeMs: null, vol: null, oi: null,
  })
  /**
   * The pop-out trade card + 📸 Snapshot — the same template the Tracked
   * contracts use (ContractProbe's `alertInfo`), dressed for a burst: the
   * headline is the burst, the pill says how many orders and which day.
   */
  const alertInfoOf = (r: RepeatContract): ProbeAlertInfo => {
    const bits = [`Repeated flow · ${num(r.n)} orders`, money(r.total)]
    if (r.size > 0) bits.push(`${num(Math.round(r.size))} ct${r.avgPrice != null ? ` @ ${r.avgPrice.toFixed(2)}` : ''}`)
    // Date FIRST, always — the picture cannot be hovered. The second stamp
    // drops the date when the burst stayed inside one session.
    const dFirst = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(r.firstTs))
    const dLast = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(r.lastTs))
    bits.push(`${dFirst} ${fmtTime(r.firstTs)} → ${dLast === dFirst ? '' : `${dLast} `}${fmtTime(r.lastTs)}`)
    const expMs = Date.parse(`${String(r.expiry).slice(0, 10)}T16:00:00-04:00`)
    const days = Number.isFinite(expMs) ? Math.max(0, Math.ceil((expMs - Date.now()) / 864e5)) : null
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })
      .format(new Date(r.firstTs)).toUpperCase()
    return {
      shotId: `repeat:${r.osi}`,
      shotLabel: 'Repeated flow',
      file: `repeated-${r.ticker}-${r.strike}${r.type}-${r.expiry}`,
      headline: bits.join(' · '),
      dteLabel: days != null ? `${days}d` : null,
      trackedAt: r.firstTs,
      badge: `REPEATED ${r.n}× · ${day}`,
    }
  }
  const probe = (r: RepeatContract) => (
    <div className="flex min-h-[380px] flex-col rounded-sm border border-line bg-surface">
      <ContractProbe
        key={`repeat:${r.osi}`}
        row={probeRow(r)}
        onClose={() => setOpenOsi(null)}
        entryAt={r.firstTs}
        alertInfo={alertInfoOf(r)}
      />
    </div>
  )

  const emptyNote = (
    <div className="px-3 py-3 text-sm text-fg">
      No contract was hit {minOrders}+ times at {FLOORS.find((f) => f.value === floor)?.label ?? money(floor)} per order
      {cluster < 1440 ? ` inside one ${clusterLabel} window` : ''}
      {multiDay ? ' in the last five sessions' : ' today'}.
    </div>
  )

  return (
    <div className="flex min-h-0 flex-col rounded-md border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.11em] text-fg">Repeated flow</h2>
        <span className="ml-auto text-2xs text-fg">
          same contract, {minOrders}+ orders{cluster < 1440 ? ` within ${clusterLabel}` : ''}
        </span>
      </div>
      {controls}
      {err && <div className="border-b border-line bg-warn/5 px-3 py-2 text-xs text-warn">{err}</div>}

      {phone ? (
        <div className="py-1">
          {list.map((r) => {
            const dir = dirOf(r)
            return (
              // A div, not a <button>: the row carries a TRACK button, and a
              // button inside a button is invalid HTML.
              <Fragment key={r.osi}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={openOsi === r.osi}
                onClick={() => toggle(r.osi)}
                onKeyDown={(e) => { if (e.key === 'Enter') toggle(r.osi) }}
                className={[
                  'block w-full cursor-pointer border-b border-line px-3 py-2 text-left active:bg-raised',
                  openOsi === r.osi ? 'bg-raised' : '',
                ].join(' ')}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-fg">
                    {r.ticker} {fmtStrike(Number(r.strike))}{r.type}{' '}
                    <span className="text-xs font-normal text-fg">{fmtExpiry(r.expiry)}</span>
                  </span>
                  <span className={['tabular shrink-0 text-sm font-semibold', dir.ink].join(' ')}>{money(r.total)}</span>
                </span>
                <span className="mt-0.5 flex items-baseline justify-between gap-2 text-2xs text-fg">
                  <span className="tabular">
                    <span className="font-bold text-fg">×{r.n}</span>
                    {cluster < 1440 ? ` in ${fmtSpan(r)}` : ''}
                    {r.nAll > r.n ? <span> · of {r.nAll}</span> : null}
                    {' · '}
                    <span className={dir.ink}>{dir.label}{dir.pct != null ? ` ${dir.pct}%` : ''}</span>
                    {r.avgPrice != null ? ` · avg ${r.avgPrice.toFixed(2)}` : ''}
                  </span>
                  <span className="tabular">{fmtWhen(r.firstTs, multiDay)} → {fmtWhen(r.lastTs, multiDay)}</span>
                </span>
                <span className="mt-1.5 flex justify-end">
                  <TrackButton
                    tracked={trackedKeys.has(repeatKey(r))}
                    busy={busyKey === repeatKey(r)}
                    onClick={() => onTrack(r)}
                  />
                </span>
              </div>
              {openOsi === r.osi && <div className="border-b border-line bg-surface2 p-2">{probe(r)}</div>}
              </Fragment>
            )
          })}
          {!list.length && !q.loading && emptyNote}
        </div>
      ) : (
        <div className={[openOsi ? 'max-h-[820px]' : 'max-h-[420px]', 'min-h-0 overflow-auto'].join(' ')}>
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-[1] bg-surface">
              <tr className="text-2xs uppercase tracking-[0.09em] text-fg">
                {th('ticker', 'Ticker')}
                {th('strike', 'Contract')}
                {th('expiry', 'Exp')}
                {th('n', 'Orders', 'right', 'Most times this contract was hit inside one WITHIN window, each order at or above the per-order floor')}
                {th('span', 'Span', 'right', 'First order to last order of the burst')}
                {th('dir', 'Dir', 'left', 'Which way the orders lean, by COUNT of readable orders. Buying calls or selling puts is bullish. Sorts most one-sided bullish first')}
                {th('split', 'Bull / Bear', 'right', 'Orders bullish / bearish')}
                {th('size', 'Contracts', 'right')}
                {th('avgPrice', 'Avg px', 'right', 'Average per-contract fill across the orders')}
                {th('firstTs', 'First', 'right', 'First order of the burst')}
                {th('lastTs', 'Last', 'right', 'Last order of the burst')}
                {th('total', 'Premium', 'right', 'Premium inside the burst')}
                {th('nAll', 'All range', 'right', 'Orders on this contract across the whole range, burst or not')}
                {th('tracked', 'Track', 'right', 'Keep this contract in Tracked contracts, at the bottom of the page')}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const dir = dirOf(r)
                return (
                  <Fragment key={r.osi}>
                  <tr
                    onClick={() => toggle(r.osi)}
                    aria-expanded={openOsi === r.osi}
                    title={openOsi === r.osi ? 'Close the chart' : 'Open the chart'}
                    className={[
                      'cursor-pointer border-t border-line hover:bg-raised',
                      openOsi === r.osi ? 'bg-raised' : '',
                    ].join(' ')}
                  >
                    <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-fg">
                      <span className="mr-1 text-2xs text-fg">{openOsi === r.osi ? '▾' : '▸'}</span>
                      {r.ticker}
                    </td>
                    <td className="tabular px-2 py-1.5 text-fg">{fmtStrike(Number(r.strike))}{r.type}</td>
                    <td className="px-2 py-1.5 text-fg">{fmtExpiry(r.expiry)}</td>
                    <td className="tabular px-2 py-1.5 text-right font-bold text-fg">×{r.n}</td>
                    <td className="tabular whitespace-nowrap px-2 py-1.5 text-right text-fg">{fmtSpan(r)}</td>
                    <td className={['px-2 py-1.5 font-semibold', dir.ink].join(' ')}>
                      {dir.label}{dir.pct != null ? <span className="ml-1 text-2xs">{dir.pct}%</span> : null}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">
                      <span className="text-up">{r.bullN}</span>
                      <span className="text-fg"> / </span>
                      <span className="text-down">{r.bearN}</span>
                    </td>
                    <td className="tabular px-2 py-1.5 text-right text-fg">{num(Math.round(r.size))}</td>
                    <td className="tabular px-2 py-1.5 text-right text-fg">{r.avgPrice != null ? r.avgPrice.toFixed(2) : '—'}</td>
                    <td className="tabular whitespace-nowrap px-2 py-1.5 text-right text-fg">{fmtWhen(r.firstTs, multiDay)}</td>
                    <td className="tabular whitespace-nowrap px-2 py-1.5 text-right text-fg">{fmtWhen(r.lastTs, multiDay)}</td>
                    <td
                      className={['tabular px-2 py-1.5 text-right font-semibold', dir.ink].join(' ')}
                      title={`${money(r.bull)} bullish vs ${money(r.bear)} bearish`}
                    >{money(r.total)}</td>
                    <td
                      className="tabular whitespace-nowrap px-2 py-1.5 text-right text-fg"
                      title={`${num(r.nAll)} orders · ${money(r.totalAll)} across the range`}
                    >×{r.nAll}</td>
                    <td className="px-2 py-1 text-right">
                      <TrackButton
                        compact
                        tracked={trackedKeys.has(repeatKey(r))}
                        busy={busyKey === repeatKey(r)}
                        onClick={() => onTrack(r)}
                      />
                    </td>
                  </tr>
                  {openOsi === r.osi && (
                    <tr>
                      <td colSpan={14} className="border-t border-line bg-surface2 p-2">{probe(r)}</td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {!list.length && !q.loading && emptyNote}
        </div>
      )}
    </div>
  )
}
