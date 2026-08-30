import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { Page } from '@/design/primitives/Page'
import { Card } from '@/design/primitives/Card'
import { Table, type Column } from '@/design/primitives/Table'
import { Stat } from '@/design/primitives/Stat'
import { SegGroup, Chip } from '@/design/primitives/Controls'
import { useQuery } from '@/data/api'
import { useFrame, useField } from '@/data/hooks'
import { isSocketSymbol } from '@/data/symbol'
import type { FlowFrame, FlowTapePrint, SpotFrame } from '@/contract/frames'

// ─────────────────────────────────────────────────────────────────────────────
// /v3/flow — replaces v2's /app/flow (components/pages/Flow.tsx).
//
// v2's page carried its own WebSocket, its own lightweight-charts renderer, a
// per-contract chain-stats poller (useContractStats/useLiveSpots) and a
// dislocation-velocity indicator built on local 1-minute bars. None of that
// machinery exists on this side of the port: live data comes ONLY through the
// `flow` frame (useFrame/useField), and REST history comes ONLY through the
// three /proxy endpoints v2 used, fetched with useQuery. What follows is the
// same filter strip, the same four-way premium split, the same tape columns —
// wired to what the v3 contract actually carries, with the gaps (the canvas
// chart, per-contract Vol/OI/IV) called out where they are rather than faked.
//
// ── The SPX-only ceiling ─────────────────────────────────────────────────────
// src/data/symbol.tsx says it plainly: "the `flow` frame is SPX prints only and
// there is no per-ticker source for them." v2 got away with a multi-ticker tape
// because its own WS pushed every root the recorder watched; v3's `flow` frame
// (contract/frames.ts) carries one tape for whatever the server is streaming,
// which today is SPX. A watchlist ticker other than SPX therefore shows
// whatever /proxy/flow-history has recorded for it and nothing live — this page
// says so on its face (below) instead of quietly relabeling SPX prints.
// ─────────────────────────────────────────────────────────────────────────────

type View = 'ticker' | 'combined'
type Scope = 'all' | 'exIdx'
type SideFilter = 'all' | 'buy' | 'sell'
type TypeFilter = 'all' | 'call' | 'put'
type ChartSpan = 'rth' | '24h'

const DEFAULT_TICKERS = [
  'SPX', 'SPY', 'QQQ', 'META', 'TSLA', 'AMZN', 'AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMD', 'NDX',
] as const

// Streamer roots carry suffixes a chip doesn't (SPX prints as "SPXW", etc.) —
// same table v2's Flow.tsx normalized with.
const ROOT_TO_TICKER: Record<string, string> = { SPXW: 'SPX', NDXP: 'NDX', RUTW: 'RUT', XSPW: 'XSP' }
const INDEX_TICKERS = new Set(['SPX', 'NDX', 'RUT', 'XSP', 'VIX', 'DJX'])
function normTicker(u: string): string {
  const up = u.toUpperCase()
  return ROOT_TO_TICKER[up] ?? up
}

const DEFAULT_MIN_PREMIUM = 15_000
// Net-drift floor, decoupled from the tape's Min Premium slider — same reasoning
// as v2: the drift read tracks the whole session's directional positioning, so
// cranking the tape's whale floor should not flatten it to zero.
const CHART_MIN_PREMIUM = 1_000
const WHALE_FLOOR = 500_000

function fmtPremium(val: number): string {
  const a = Math.abs(val)
  const sign = val < 0 ? '-' : ''
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(1)}K`
  return `${sign}$${a.toFixed(0)}`
}
function fmtContractCost(price: number): string {
  const cost = price * 100
  if (cost >= 1_000_000) return `$${(cost / 1_000_000).toFixed(2)}M`
  if (cost >= 1_000) return `$${(cost / 1_000).toFixed(1)}K`
  return `$${cost.toFixed(2)}`
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

// ── ET day/session math, ported verbatim in spirit from v2's Flow.tsx (same
// DST-safe wall-clock trick) — needed for DTE (measured from TODAY, not from
// each print's own stamp) and for the RTH window the net-drift readout sums. ──
function etDateParts(now: Date): { y: number; m: number; d: number } {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0')
  return { y: get('year'), m: get('month'), d: get('day') }
}
function etWallToUtcSec(y: number, m: number, d: number, hh: number, mm: number): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const asET = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'America/New_York' })).getTime()
  const asUTC = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  return Math.floor((guess + (asUTC - asET)) / 1000)
}
function todayYmdET(): string {
  const { y, m, d } = etDateParts(new Date())
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function rthBoundsTodaySec(): { openSec: number; closeSec: number } {
  const { y, m, d } = etDateParts(new Date())
  return { openSec: etWallToUtcSec(y, m, d, 9, 30), closeSec: etWallToUtcSec(y, m, d, 16, 0) }
}
// DTE relative to TODAY's ET date, not to each print's own timestamp — a
// yesterday's-session 0DTE print must not read as -1DTE today. Both sides
// parsed as UTC midnight so the subtraction is a clean whole-day count.
function dteOf(expiration: string | undefined, todayYmd: string): number | null {
  if (!expiration) return null
  const exp = Date.parse(`${expiration}T00:00:00Z`)
  const base = Date.parse(`${todayYmd}T00:00:00Z`)
  if (!Number.isFinite(exp) || !Number.isFinite(base)) return null
  return Math.round((exp - base) / 86_400_000)
}

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  return sp.toString()
}

interface NetBin {
  sec: number
  callNet: number
  putNet: number
}
interface FlowHistoryResponse {
  tape: FlowTapePrint[]
}
interface NetPremResponse {
  bins: NetBin[]
}
interface PremSplit {
  count: number
  prem: number
  buyCall: number
  buyPut: number
  sellCall: number
  sellPut: number
}
interface PremSplitResponse {
  split: PremSplit
}

type FlowRow = FlowTapePrint & { tickerNorm: string }

function toRow(p: FlowTapePrint): FlowRow {
  return { ...p, tickerNorm: normTicker(p.underlying) }
}
function rowKey(r: FlowTapePrint): string {
  return `${r.ts}|${r.underlying}|${r.side}|${r.strike}|${r.type}`
}

export default function Flow() {
  const [view, setView] = useState<View>('ticker')
  const [scope, setScope] = useState<Scope>('all')

  const [tickerList, setTickerList] = useState<string[]>([...DEFAULT_TICKERS])
  const [active, setActive] = useState<string>(DEFAULT_TICKERS[0])
  const [tickerInput, setTickerInput] = useState('')

  const [side, setSide] = useState<SideFilter>('all')
  const [optType, setOptType] = useState<TypeFilter>('all')
  const [minPremium, setMinPremium] = useState(DEFAULT_MIN_PREMIUM)
  const [minSize, setMinSize] = useState(0)
  const [expiry, setExpiry] = useState('all')
  const [dteMin, setDteMin] = useState(0)
  const [dteMax, setDteMax] = useState<number | null>(null)
  const [otmOnly, setOtmOnly] = useState(true)
  const [chartSpan, setChartSpan] = useState<ChartSpan>('rth')

  const todayYmd = todayYmdET()
  const premiumMax = view === 'combined' ? 5_000_000 : 1_000_000
  const premiumStep = view === 'combined' ? 50_000 : 10_000

  function selectTicker(raw: string) {
    const t = raw.trim().toUpperCase()
    if (!t) return
    setTickerList((prev) => (prev.includes(t) ? prev : [...prev, t]))
    setActive(t)
    setTickerInput('')
  }
  function resetFilters() {
    setSide('all'); setOptType('all'); setMinPremium(DEFAULT_MIN_PREMIUM); setMinSize(0)
    setExpiry('all'); setDteMin(0); setDteMax(null); setOtmOnly(true)
  }
  function applyBigOtmPreset() {
    setView('combined'); setScope('all'); setSide('all'); setOptType('all')
    setMinSize(0); setExpiry('all'); setMinPremium(500_000); setDteMin(0); setDteMax(7); setOtmOnly(true)
  }
  const presetActive = view === 'combined' && minPremium === 500_000 && dteMin === 0 && dteMax === 7 && otmOnly

  // ── Fetches, fired in parallel, no waterfall. Each url is null when the
  // active view has no use for it, which is how useQuery is told to skip it. ──
  const historyUrl = useMemo(() => {
    const params: Record<string, string | number | undefined> = {
      limit: view === 'combined' ? 2000 : 1000,
      minPremium: minPremium > 0 ? minPremium : undefined,
    }
    if (view === 'ticker') params.underlying = active
    return `/proxy/flow-history?${buildQuery(params)}`
  }, [view, active, minPremium])

  const netBinsUrl = useMemo(() => {
    if (view !== 'ticker') return null
    return `/proxy/flow-netprem?${buildQuery({
      underlying: active,
      bin: 60,
      minPremium: CHART_MIN_PREMIUM,
      side: side !== 'all' ? side : undefined,
      type: optType !== 'all' ? optType : undefined,
      expiry: expiry !== 'all' ? expiry : undefined,
      dteMin: dteMin > 0 ? dteMin : undefined,
      dteMax: dteMax ?? undefined,
      otmOnly: otmOnly ? 1 : undefined,
    })}`
  }, [view, active, side, optType, expiry, dteMin, dteMax, otmOnly])

  const premSplitUrl = useMemo(() => {
    if (view !== 'combined') return null
    return `/proxy/flow-premsplit?${buildQuery({
      exIdx: scope === 'exIdx' ? 1 : undefined,
      side: side !== 'all' ? side : undefined,
      type: optType !== 'all' ? optType : undefined,
      minPremium: minPremium > 0 ? minPremium : undefined,
      minSize: minSize > 0 ? minSize : undefined,
      expiry: expiry !== 'all' ? expiry : undefined,
      dteMin: dteMin > 0 ? dteMin : undefined,
      dteMax: dteMax ?? undefined,
      otmOnly: otmOnly ? 1 : undefined,
    })}`
  }, [view, scope, side, optType, minPremium, minSize, expiry, dteMin, dteMax, otmOnly])

  const historyQ = useQuery<FlowHistoryResponse>(historyUrl, { pollMs: 15_000 })
  const netBinsQ = useQuery<NetPremResponse>(netBinsUrl, { pollMs: 5_000 })
  const premSplitQ = useQuery<PremSplitResponse>(premSplitUrl, { pollMs: 15_000 })

  // Live prints. The frame is SPX-only today (see the header note above), but
  // reading it through useFrame rather than inventing a per-ticker filter here
  // means this page picks up more tickers for free the day the server does.
  const flowFrame = useFrame<FlowFrame>('flow')
  const liveTape = flowFrame?.data.tape ?? []
  // Live SPX spot — the one underlying with a real-time price on this socket —
  // used below to turn %OTM from a frozen print-time flag into a live figure.
  const spot = useField<SpotFrame, number | undefined>('spot', (f) => f?.data.spot)

  // ── Merge persisted ∪ live, deduped by print identity (live wins), newest
  // first — same shape as v2's `merged`/`mergedCombined`. ──
  const rowsAll = useMemo(() => {
    const byKey = new Map<string, FlowRow>()
    for (const p of historyQ.data?.tape ?? []) byKey.set(rowKey(p), toRow(p))
    for (const p of liveTape) byKey.set(rowKey(p), toRow(p))
    return [...byKey.values()].sort((a, b) => b.ts - a.ts)
  }, [historyQ.data, liveTape])

  const scopedRows = useMemo(() => {
    if (view === 'ticker') return rowsAll.filter((r) => r.tickerNorm === active)
    if (scope === 'exIdx') return rowsAll.filter((r) => !INDEX_TICKERS.has(r.tickerNorm))
    return rowsAll
  }, [rowsAll, view, active, scope])

  const expiryOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of scopedRows) if (r.expiration) set.add(r.expiration)
    return [...set].sort()
  }, [scopedRows])

  const filteredRows = useMemo(() => {
    return scopedRows.filter((r) => {
      if (side !== 'all' && r.side !== side) return false
      if (optType !== 'all' && r.type !== optType) return false
      if (otmOnly && !r.isOtm) return false
      if (r.premium < minPremium) return false
      if (r.size < minSize) return false
      if (expiry !== 'all' && r.expiration !== expiry) return false
      if (dteMin > 0 || dteMax != null) {
        const d = dteOf(r.expiration, todayYmd)
        if (d == null) return false
        if (d < dteMin) return false
        if (dteMax != null && d > dteMax) return false
      }
      return true
    })
  }, [scopedRows, side, optType, otmOnly, minPremium, minSize, expiry, dteMin, dteMax, todayYmd])

  const MAX_TAPE_ROWS = 500
  const visibleRows = filteredRows.slice(0, MAX_TAPE_ROWS)

  // ── Premium split (the four totals tiles). Combined view prefers the SQL
  // split — exact over the FULL filtered session — and only falls back to
  // summing the capped tape while that request is in flight. ──
  const totals = useMemo(() => {
    if (view === 'combined' && premSplitQ.data) {
      const s = premSplitQ.data.split
      return { count: s.count, prem: s.prem, buyCall: s.buyCall, buyPut: s.buyPut, sellCall: s.sellCall, sellPut: s.sellPut }
    }
    let prem = 0, buyCall = 0, buyPut = 0, sellCall = 0, sellPut = 0
    for (const r of filteredRows) {
      prem += r.premium
      if (r.type === 'call') { if (r.side === 'buy') buyCall += r.premium; else sellCall += r.premium }
      else { if (r.side === 'buy') buyPut += r.premium; else sellPut += r.premium }
    }
    return { count: filteredRows.length, prem, buyCall, buyPut, sellCall, sellPut }
  }, [view, premSplitQ.data, filteredRows])

  // ── Net-drift totals for the ticker view. Sums the SQL-aggregated bins from
  // /proxy/flow-netprem — the same source v2's canvas chart drew from — so the
  // readout stays right even though the chart itself is a stub below. ──
  const netTotals = useMemo(() => {
    const bins = netBinsQ.data?.bins ?? []
    let call = 0, put = 0
    if (chartSpan === 'rth') {
      const { openSec, closeSec } = rthBoundsTodaySec()
      for (const b of bins) if (b.sec >= openSec && b.sec <= closeSec) { call += b.callNet; put += b.putNet }
    } else {
      for (const b of bins) { call += b.callNet; put += b.putNet }
    }
    return { call, put }
  }, [netBinsQ.data, chartSpan])

  function otmCell(r: FlowRow): ReactNode {
    // Live percentage only where a live spot exists at all — SPX, off the
    // `spot` frame. Every other ticker falls back to the print-time OTM flag,
    // which is honest about being frozen rather than quietly wrong.
    if (isSocketSymbol(r.tickerNorm) && spot != null && spot > 0) {
      const pct = ((r.type === 'call' ? r.strike - spot : spot - r.strike) / spot) * 100
      return <span className={pct >= 0 ? 'text-accent' : 'text-down'}>{pct.toFixed(1)}%</span>
    }
    return <span className="text-muted">{r.isOtm ? 'OTM' : 'ITM'}</span>
  }

  // Vol / OI / IV have no source in the v3 contract: FlowTapePrint carries the
  // print itself, not a live per-contract chain lookup. v2 filled these from
  // useContractStats/useLiveSpots (hooks/useContractStats.ts), which resolves
  // Vol/OI/IV per (ticker, expiry) off /api/chains — a REST surface this file
  // cannot reach without turning into that hook's whole batching machinery.
  // TODO(v3): port useContractStats/useLiveSpots from v2's
  // hooks/useContractStats.ts so these three columns read live instead of "—".
  const columns: Column<FlowRow>[] = useMemo(
    () => [
      { key: 'time', header: 'Time', cell: (r) => fmtTime(r.ts), width: '76px' },
      { key: 'ticker', header: 'Ticker', cell: (r) => r.tickerNorm, width: '64px' },
      { key: 'exp', header: 'Exp', cell: (r) => r.expiration || '—', width: '84px' },
      { key: 'strike', header: 'Strike', cell: (r) => r.strike.toLocaleString(), numeric: true },
      {
        key: 'cp', header: 'C/P', align: 'center', width: '40px',
        cell: (r) => (
          <span className={r.type === 'call' ? 'text-up' : r.type === 'put' ? 'text-down' : 'text-muted'}>
            {r.type === 'call' ? 'C' : r.type === 'put' ? 'P' : r.type}
          </span>
        ),
      },
      {
        key: 'side', header: 'Side', width: '52px',
        cell: (r) => <span className={r.side === 'buy' ? 'text-up' : 'text-down'}>{r.side.toUpperCase()}</span>,
      },
      { key: 'price', header: 'Price', cell: (r) => `$${r.price.toFixed(2)}`, numeric: true },
      { key: 'size', header: 'Size', cell: (r) => r.size.toLocaleString(), numeric: true },
      {
        key: 'premium', header: 'Premium', numeric: true,
        cell: (r) => (
          <span className={r.premium >= WHALE_FLOOR ? 'font-bold' : undefined}>{fmtPremium(r.premium)}</span>
        ),
      },
      {
        key: 'costctr', numeric: true,
        header: <span title="Cost of one contract (price × 100)">Cost/Ctr</span>,
        cell: (r) => fmtContractCost(r.price),
      },
      {
        key: 'vol', numeric: true,
        header: <span title="Contract's traded volume today — not wired in v3 yet, see the TODO above the column list">Vol</span>,
        cell: () => '—',
      },
      {
        key: 'oi', numeric: true,
        header: <span title="Contract's current open interest — not wired in v3 yet, see the TODO above the column list">OI</span>,
        cell: () => '—',
      },
      {
        key: 'iv', numeric: true,
        header: <span title="Current implied volatility — not wired in v3 yet, see the TODO above the column list">IV</span>,
        cell: () => '—',
      },
      {
        key: 'otm', numeric: true,
        header: <span title="Strike vs LIVE underlying spot. + = OTM, − = now ITM. Live only for SPX; other tickers show the print-time flag.">%OTM</span>,
        cell: otmCell,
      },
      {
        key: 'dte', numeric: true,
        header: <span title="Calendar days to expiration">DTE</span>,
        cell: (r) => { const d = dteOf(r.expiration, todayYmd); return d == null ? '—' : `${d}d` },
      },
    ],
    [todayYmd, spot],
  )

  const combinedLabel = scope === 'exIdx' ? 'All − Indices' : 'All Tickers'
  const tapeLabel = view === 'combined' ? combinedLabel : active

  return (
    <Page title="Options Flow">
      {/* ── View, watchlist/scope, and the full filter strip. ── */}
      <Card
        title="Flow — Filters"
        actions={<Chip label="Reset" on={false} onClick={resetFilters} title="Clear side/type/premium/size/expiry/DTE/moneyness back to defaults" />}
      >
        <div className="flex flex-wrap items-center gap-3">
          <SegGroup
            options={[{ label: 'By Ticker', value: 'ticker' as View }, { label: 'Combined', value: 'combined' as View }]}
            value={view}
            onChange={setView}
          />
          <Chip
            label="0–7DTE ≥$500K OTM"
            on={presetActive}
            onClick={applyBigOtmPreset}
            title="Combined · 0–7 DTE · ≥$500K premium · OTM only"
          />
        </div>

        {/* The ceiling described at the top of this file — said once, here,
            rather than left for the tape to imply by going quiet. */}
        <p className="mt-2 text-xs text-faint">
          Live prints stream for SPX only (the `flow` frame carries no other ticker). Watchlist tickers besides SPX
          show historical prints from /proxy/flow-history only — nothing arrives for them live.
        </p>

        {view === 'ticker' ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted">
              Watchlist ({tickerList.length})
            </span>
            {tickerList.map((t) => (
              <Chip key={t} label={t} on={t === active} onClick={() => selectTicker(t)} />
            ))}
            <input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') selectTicker(tickerInput) }}
              placeholder="+ add ticker"
              spellCheck={false}
              autoCapitalize="characters"
              className="w-28 rounded-sm border border-line bg-surface px-2 py-0.5 text-xs uppercase text-fg outline-none placeholder:normal-case placeholder:text-muted focus:border-accent"
            />
            <Chip label="Go" on={false} onClick={() => selectTicker(tickerInput)} />
          </div>
        ) : (
          <div className="mt-3">
            <SegGroup
              options={[{ label: 'All', value: 'all' as Scope }, { label: 'All − Indices', value: 'exIdx' as Scope }]}
              value={scope}
              onChange={setScope}
              title="Combined tape scope"
            />
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Side</span>
            <SegGroup
              options={[
                { label: 'All', value: 'all' as SideFilter },
                { label: 'Buy', value: 'buy' as SideFilter },
                { label: 'Sell', value: 'sell' as SideFilter },
              ]}
              value={side}
              onChange={setSide}
            />
          </div>
          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Type</span>
            <SegGroup
              options={[
                { label: 'All', value: 'all' as TypeFilter },
                { label: 'Call', value: 'call' as TypeFilter },
                { label: 'Put', value: 'put' as TypeFilter },
              ]}
              value={optType}
              onChange={setOptType}
            />
          </div>
          <div className="col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
              Min Premium <span className="text-accent">{minPremium === 0 ? 'Any' : fmtPremium(minPremium)}</span>
            </span>
            <input
              type="range" min={0} max={premiumMax} step={premiumStep}
              value={minPremium}
              onChange={(e) => setMinPremium(Number(e.target.value))}
              className="w-full accent-[color:var(--color-accent)]"
            />
          </div>
          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Min Size</span>
            <input
              type="number" min={0} placeholder="contracts" value={minSize || ''}
              onChange={(e) => setMinSize(Number(e.target.value) || 0)}
              className="w-full rounded-sm border border-line bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-accent"
            />
          </div>
          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Expiry</span>
            <select
              value={expiry} onChange={(e) => setExpiry(e.target.value)}
              className="w-full rounded-sm border border-line bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-accent"
            >
              <option value="all">All</option>
              {expiryOptions.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Min DTE</span>
            <input
              type="number" min={0} placeholder="days" value={dteMin || ''}
              onChange={(e) => setDteMin(Number(e.target.value) || 0)}
              className="w-full rounded-sm border border-line bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-accent"
            />
          </div>
          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Max DTE</span>
            <input
              type="number" min={0} placeholder="days" value={dteMax ?? ''}
              onChange={(e) => setDteMax(e.target.value === '' ? null : Number(e.target.value))}
              className="w-full rounded-sm border border-line bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-accent"
            />
          </div>
          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Moneyness</span>
            <SegGroup
              options={[{ label: 'All', value: 'all' }, { label: 'OTM', value: 'otm' }]}
              value={otmOnly ? 'otm' : 'all'}
              onChange={(v) => setOtmOnly(v === 'otm')}
            />
          </div>
          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Chart Span</span>
            <SegGroup
              options={[
                { label: 'RTH', value: 'rth' as ChartSpan, title: 'Regular trading hours only (9:30–4:00 ET)' },
                { label: '24H', value: '24h' as ChartSpan, title: 'Full session, including pre-open and overnight prints' },
              ]}
              value={chartSpan}
              onChange={setChartSpan}
            />
          </div>
        </div>
        {historyQ.error && (
          <p className="mt-3 text-xs text-down">History fetch failed — filters above are working from live prints only.</p>
        )}
      </Card>

      {/* ── Totals tiles ── */}
      <Card
        title="Premium Split"
        actions={<span className="text-xs text-muted">{view === 'combined' ? 'Full session — SQL' : 'Filtered tape'}</span>}
        stale={view === 'combined' && premSplitQ.loading && !premSplitQ.data}
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="BUY CALLS" value={fmtPremium(totals.buyCall)} direction="up" />
          <Stat label="BUY PUTS" value={fmtPremium(totals.buyPut)} direction="down" />
          <Stat label="SELL CALL" value={fmtPremium(totals.sellCall)} direction="down" />
          <Stat label="SELL PUT" value={fmtPremium(totals.sellPut)} direction="up" />
        </div>
        {view === 'combined' && premSplitQ.error && (
          <p className="mt-3 text-xs text-down">Premium-split query failed — totals above are summed from the capped tape instead.</p>
        )}
      </Card>

      {/* ── Net Drift (Premium) — canvas chart NOT ported, see TODO below. ── */}
      {view === 'ticker' && (
        <Card title={<>Net Drift (Premium) — <span className="text-accent">{active}</span></>}>
          <div className="flex flex-wrap items-center justify-center gap-6 pb-2 text-xs font-semibold">
            <span className="text-up">● Calls {fmtPremium(netTotals.call)}</span>
            <span className="text-down">● Puts {fmtPremium(netTotals.put)}</span>
            <span className="text-muted">Net {fmtPremium(netTotals.call + netTotals.put)}</span>
          </div>
          {/*
            v2 drew this as a lightweight-charts line/histogram pair — cumulative
            call vs put net premium per minute bin, plus a volume histogram and a
            crosshair tooltip listing the OTM prints in the hovered minute (the
            `createChart`/callSeries/putSeries/volSeries effect and the
            subscribeCrosshairMove tooltip builder in components/pages/Flow.tsx,
            roughly lines 780–926). That renderer is not ported here; the two
            totals above come from the SAME /proxy/flow-netprem bins the chart
            drew from, summed client-side over whichever window (RTH/24H) is
            selected above.
          */}
          <p className="text-xs text-faint">
            The cumulative net-drift line chart itself is not yet ported to v3 — the totals above are real, aggregated
            from the same {chartSpan === 'rth' ? 'RTH (9:30–4:00 ET)' : '24-hour'} bins the v2 chart drew.
          </p>
          {/* TODO(v3): port FlowPage's lightweight-charts net-drift renderer
              (createChart + LineSeries/HistogramSeries + subscribeCrosshairMove,
              components/pages/Flow.tsx ~L780–926) once a charting primitive
              exists in v3's design system. */}
          {netBinsQ.error && (
            <p className="text-xs text-down">Net-drift history unavailable — totals above may be stale.</p>
          )}
        </Card>
      )}

      {/* ── Tape ── */}
      <Card
        title={`Flow Tape — ${tapeLabel}`}
        actions={
          <span className="tabular text-xs text-muted">
            <strong className="text-fg">{totals.count.toLocaleString()}</strong> orders · Total{' '}
            <strong className="text-fg">{fmtPremium(totals.prem)}</strong>
          </span>
        }
        flush
        stale={historyQ.loading && filteredRows.length === 0}
      >
        <Table
          columns={columns}
          rows={visibleRows}
          rowKey={(r, i) => `${rowKey(r)}-${i}`}
          empty={<span>No {tapeLabel} flow matches the current filters.</span>}
        />
        {filteredRows.length > MAX_TAPE_ROWS && (
          <p className="p-2 text-center text-xs text-faint">
            Showing newest {MAX_TAPE_ROWS.toLocaleString()} of {filteredRows.length.toLocaleString()} — tighten filters to narrow.
          </p>
        )}
      </Card>
    </Page>
  )
}
