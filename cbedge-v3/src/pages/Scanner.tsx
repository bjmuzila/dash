import { useMemo, useState } from 'react'
import { Page } from '@/design/primitives/Page'
import { Card, CardToolbar } from '@/design/primitives/Card'
import { Table, type Column } from '@/design/primitives/Table'
import { SegGroup, Chip } from '@/design/primitives/Controls'
import { useQuery } from '@/data/api'
import { usePageSymbol } from '@/data/symbol'

// ─────────────────────────────────────────────────────────────────────────────
// /v3/scanner — port of v2's /app/scanner (components/pages/Scanner.tsx).
//
// v2's Scanner page was seven tabs bolted onto one file, each grown out of a
// different lookback query or a bespoke canvas: GEX Levels, GEX Change Top,
// Pick Study, Strike Query, TPO Structures, IB Stats and Watch This. Four of
// those import a component this repo does not have (GexLevelsTab,
// GexChangeTop, PickStudyTab, IbStatsTab all live under v2's
// components/scanner/ and never shipped into this bundle); a fifth
// (TpoStructuresScanner) is defined in the v2 file itself but is a multi-day
// ES/NQ candle walk (buildTpoStructures / amtRead from lib/tpo · lib/amt,
// fed by useEsCandles/useNqCandles) with no v3 equivalent live-candle feed.
// Those five get a real Card, their real title, and a `// TODO(v3):` naming
// exactly what v2 symbol still needs porting — see the contract's "Scope
// realism" section. Only Strike Query and Watch This are straightforward
// REST reads and are wired for real below.
//
// Tab order and the "opens on GEX Change Top" default both come straight
// from v2's own header comment and its `useState<MainTab>("gexchangetop")`.
// ─────────────────────────────────────────────────────────────────────────────

type MainTab = 'gexlevels' | 'gexchangetop' | 'pickstudy' | 'strike' | 'tpo' | 'ibstats' | 'watch'

const TABS: { value: MainTab; label: string }[] = [
  { value: 'gexlevels', label: 'GEX Levels' },
  { value: 'gexchangetop', label: 'GEX Change Top' },
  { value: 'pickstudy', label: 'Pick Study' },
  { value: 'strike', label: 'Strike Query' },
  { value: 'tpo', label: 'TPO Structures' },
  { value: 'ibstats', label: 'IB Stats' },
  { value: 'watch', label: 'Watch This' },
]

// ── shared number formatting — never leave a raw float on screen ───────────

function fmtUsd(v: number | null | undefined, digits = 2): string {
  return v == null || !Number.isFinite(v) ? '—' : `$${v.toFixed(digits)}`
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  return v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`
}

/** Signed percent with a direction arrow, for the Max % / spot-change columns. */
function fmtSignedPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(digits)}%`
}

/** Abbreviated magnitude for GEX-scale numbers (v2's `fmtB`). */
function fmtCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}K`
  return `${sign}${abs.toFixed(0)}`
}

/** Dates arrive as YYYY-MM-DD, but some fields carry a time — trim to the day. */
function ymd(v: string | null | undefined): string {
  if (!v) return '—'
  return String(v).slice(0, 10)
}

const dirClass = (v: number | null | undefined) => (v == null ? 'text-muted' : v >= 0 ? 'text-up' : 'text-down')

// ══════════════════════════════════════════════════════════════════════════
//  STRIKE QUERY — top movers by strike for the board's symbol
//  (v2: StrikeQueryScanner, /proxy/strike-growth/by-expiry?symbol=…)
// ══════════════════════════════════════════════════════════════════════════

interface SqRow {
  symbol: string
  expiry: string
  strike: number
  gex_now: number
  delta_abs: number
  chg15: number | null
  chg30: number | null
  chg60: number | null
  spot?: number | null
}

interface StrikeGrowthResponse {
  ok: boolean
  rows: SqRow[]
}

type SqSortKey = 'strike' | 'gex_now' | 'chg15' | 'chg30' | 'chg60' | 'delta_abs'

const SQ_COLS: { key: SqSortKey; label: string }[] = [
  { key: 'strike', label: 'Strike' },
  { key: 'gex_now', label: 'GEX Now' },
  { key: 'chg15', label: 'Δ 15m' },
  { key: 'chg30', label: 'Δ 30m' },
  { key: 'chg60', label: 'Δ 60m' },
  { key: 'delta_abs', label: 'Delta Abs' },
]

const sqVal = (r: SqRow, c: SqSortKey): number => {
  const v = c === 'strike' ? r.strike : r[c]
  return v == null ? 0 : Number(v)
}

/**
 * v2 loaded this across an "ALL" watchlist by fetching
 * /proxy/strike-growth/watchlist first and then one by-expiry call per
 * ticker — a waterfall the contract rules out here. v3 scopes the tab to the
 * board's own symbol (the one the toolbar search box sets), fetched in one
 * parallel useQuery at mount. Multi-symbol "ALL" aggregation and the OTM%/
 * indices-exclusion card grid stay TODO.
 */
function StrikeQueryTab() {
  const { symbol } = usePageSymbol()
  const [expiry, setExpiry] = useState<string>('ALL')
  const [sort, setSort] = useState<{ col: SqSortKey; dir: 'asc' | 'desc' }>({ col: 'gex_now', dir: 'desc' })

  const { data, error, loading } = useQuery<StrikeGrowthResponse>(
    `/proxy/strike-growth/by-expiry?symbol=${encodeURIComponent(symbol)}`,
    { staleMs: 30_000, pollMs: 60_000 },
  )
  const rows = data?.rows ?? []

  const expiries = useMemo(() => [...new Set(rows.map((r) => r.expiry))].sort(), [rows])

  const toggleSort = (col: SqSortKey) =>
    setSort((p) => (p.col === col ? { col, dir: p.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' }))

  const shown = useMemo(() => {
    const filtered = expiry === 'ALL' ? rows : rows.filter((r) => r.expiry === expiry)
    return [...filtered].sort((a, b) => {
      const av = sqVal(a, sort.col)
      const bv = sqVal(b, sort.col)
      const cmp = sort.col === 'strike' ? bv - av : Math.abs(bv) - Math.abs(av)
      return sort.dir === 'desc' ? cmp : -cmp
    })
  }, [rows, expiry, sort])

  const columns: Column<SqRow>[] = [
    { key: 'expiry', header: 'Expiry', cell: (r) => r.expiry },
    {
      key: 'otm',
      header: 'OTM%',
      numeric: true,
      cell: (r) => (r.spot ? fmtPct((Math.abs(r.strike - r.spot) / r.spot) * 100) : '—'),
    },
    ...SQ_COLS.map(
      (c): Column<SqRow> => ({
        key: c.key,
        numeric: true,
        header: (
          <button
            type="button"
            onClick={() => toggleSort(c.key)}
            className={sort.col === c.key ? 'text-accent' : ''}
          >
            {c.label} {sort.col === c.key ? (sort.dir === 'desc' ? '↓' : '↑') : '⇅'}
          </button>
        ),
        cell: (r) =>
          c.key === 'strike'
            ? r.strike
            : c.key === 'gex_now' || c.key === 'delta_abs'
              ? fmtCompact(r[c.key])
              : (
                <span className={dirClass(r[c.key])}>{r[c.key] == null ? '—' : fmtCompact(r[c.key])}</span>
              ),
      }),
    ),
  ]

  return (
    <Card
      title="Strike GEX Query"
      stale={loading && rows.length === 0}
      actions={error ? <span className="text-xs text-down">stale — last good rows shown</span> : undefined}
    >
      <CardToolbar>
        <span className="text-xs text-muted">Board symbol: {symbol}</span>
        <SegGroup
          title="Expiry"
          value={expiry}
          onChange={setExpiry}
          options={[{ label: 'All expiries', value: 'ALL' }, ...expiries.map((e) => ({ label: e, value: e }))]}
        />
      </CardToolbar>
      <Table
        columns={columns}
        rows={shown}
        rowKey={(r, i) => `${r.symbol}-${r.expiry}-${r.strike}-${i}`}
        stale={loading && rows.length === 0}
        empty="No rows yet. Needs recorder history for this ticker."
      />
    </Card>
  )
}

// ══════════════════════════════════════════════════════════════════════════
//  WATCH THIS — Far CB: farther-out CB levels + outcome tracking
//  (v2: WatchThisScanner)
// ══════════════════════════════════════════════════════════════════════════

interface WatchRow {
  symbol: string
  strike: number
  expiry: string
  gex_value: number
  gex_value_vol?: number | null
  spot: number
  otm_pct: number
  dte_days: number
}

interface FarCbTickersResponse {
  ok: boolean
  rows: WatchRow[]
  threshold?: number | null
}

/** Far-CB tickers grid — the flagged, farther-out CB levels across the scanner universe. */
function FarCbTickersGrid() {
  const { data, error, loading, refetch } = useQuery<FarCbTickersResponse>('/api/far-cb-tickers', {
    staleMs: 60_000,
    pollMs: 120_000,
  })
  const rows = data?.rows ?? []
  const threshold = data?.threshold ?? 15

  const [newTicker, setNewTicker] = useState('')
  const [adding, setAdding] = useState(false)
  const [addStatus, setAddStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  const addTicker = async () => {
    const sym = newTicker.trim().toUpperCase()
    if (!sym) return
    setAdding(true)
    setAddStatus(null)
    try {
      const res = await fetch('/api/far-cb-tickers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'Add failed')
      setAddStatus({ ok: true, msg: `${sym} added — appears after the next sweep.` })
      setNewTicker('')
      refetch()
    } catch (e) {
      setAddStatus({ ok: false, msg: e instanceof Error ? e.message : 'Add failed' })
    } finally {
      setAdding(false)
    }
  }

  return (
    <Card
      title="Watch This — Far CB"
      actions={error ? <span className="text-xs text-down">stale — last good rows shown</span> : undefined}
    >
      <CardToolbar>
        <input
          value={newTicker}
          onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addTicker()
          }}
          placeholder="Add a ticker (e.g. RDDT)"
          maxLength={6}
          spellCheck={false}
          className="w-32 rounded-sm border border-line bg-surface px-2 py-0.5 text-xs uppercase text-fg outline-none focus:border-accent"
        />
        <Chip label={adding ? 'Adding…' : '+ Add'} on={false} onClick={() => void addTicker()} />
        {addStatus && (
          <span className={`text-xs ${addStatus.ok ? 'text-up' : 'text-down'}`}>{addStatus.msg}</span>
        )}
      </CardToolbar>
      <p className="mb-2 text-xs text-muted">
        Highest GEX strike within 30d expirations, far OTM vs spot · flagged when &gt;{threshold}% away from
        spot
      </p>
      {rows.length === 0 && !loading && !error && (
        <p className="p-4 text-center text-sm text-faint">
          Nothing flagged right now — no watchlist ticker has an unusually far-OTM dominant CB level.
        </p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => {
          const up = r.gex_value >= 0
          return (
            <div key={`${r.symbol}-${r.expiry}-${r.strike}`} className="rounded-md border border-line bg-surface2 p-3">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="flex items-baseline gap-2">
                  <span className={`font-bold ${up ? 'text-up' : 'text-down'}`}>{r.symbol}</span>
                  <span className={`tabular text-xs ${up ? 'text-up' : 'text-down'}`}>{fmtUsd(r.spot)}</span>
                </span>
                <span className="text-[10px] font-bold tracking-wide text-accent">WATCH THIS</span>
              </div>
              <div className="mb-1 text-xs font-bold text-accent">
                {fmtUsd(r.strike, 0)} <span className="font-normal text-muted">· {r.expiry} · {r.dte_days}d</span>
              </div>
              <div className="mb-2 text-xs leading-relaxed text-muted">
                Highest GEX level is the {fmtUsd(r.strike, 0)} strike ({r.expiry}), {r.otm_pct.toFixed(0)}% away
                from spot — {up ? 'call-side' : 'put-side'} dominant.
              </div>
              <div className="flex gap-3 text-xs">
                <span className={dirClass(r.gex_value)}>
                  <span className="text-muted">OI+VOL </span>
                  {fmtCompact(r.gex_value)}
                </span>
                <span className={dirClass(r.gex_value_vol)}>
                  <span className="text-muted">VOL </span>
                  {r.gex_value_vol != null ? fmtCompact(r.gex_value_vol) : '—'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

interface OutcomeRow {
  symbol: string
  strike: number
  expiry: string
  first_flagged: string
  spot_at_flag: number
  otm_pct_at_flag: number
  side: 'above' | 'below'
  touched_date: string | null
  closest_pct: number | null
  status: 'open' | 'touched' | 'expired'
  opt_type?: 'C' | 'P' | null
  opt_entry?: number | null
  opt_entry_date?: string | null
  opt_high?: number | null
  opt_pct_high?: number | null
}

interface FarCbOutcomesResponse {
  ok: boolean
  rows: OutcomeRow[]
}

interface OutcomeDetailDay {
  date: string
  spot: number
  spotPctChg: number | null
  contractClose: number | null
  contractDollarChg: number | null
  contractPctChg: number | null
}

interface OutcomeDetail {
  ok: boolean
  error?: string
  symbol: string
  strike: number
  expiry: string
  type: 'C' | 'P'
  firstFlagged: string
  status: 'open' | 'touched' | 'expired'
  days: OutcomeDetailDay[]
}

type OutcomeStatus = 'all' | 'open' | 'touched' | 'expired' | 'results'

type OutcomeSortKey =
  | 'symbol'
  | 'strike'
  | 'expiry'
  | 'first_flagged'
  | 'opt_entry'
  | 'opt_high'
  | 'opt_pct_high'
  | 'spot_at_flag'
  | 'otm_pct_at_flag'
  | 'closest_pct'
  | 'touched_date'
  | 'status'

/** open → touched → expired, so a status sort reads as a lifecycle, not A–Z. */
const STATUS_RANK: Record<OutcomeRow['status'], number> = { open: 0, touched: 1, expired: 2 }

const OUTCOME_SORT_VALUE: Record<OutcomeSortKey, (r: OutcomeRow) => string | number | null> = {
  symbol: (r) => r.symbol,
  strike: (r) => r.strike,
  expiry: (r) => r.expiry,
  first_flagged: (r) => r.first_flagged,
  opt_entry: (r) => r.opt_entry ?? null,
  opt_high: (r) => r.opt_high ?? null,
  opt_pct_high: (r) => r.opt_pct_high ?? null,
  spot_at_flag: (r) => r.spot_at_flag,
  otm_pct_at_flag: (r) => r.otm_pct_at_flag,
  closest_pct: (r) => r.closest_pct ?? null,
  touched_date: (r) => ymd(r.touched_date) === '—' ? null : ymd(r.touched_date),
  status: (r) => STATUS_RANK[r.status] ?? 99,
}

/** Nulls sink to the bottom in both directions, same as v2's sortOutcomes. */
function sortOutcomes(rows: OutcomeRow[], sort: { key: OutcomeSortKey; dir: 'asc' | 'desc' }): OutcomeRow[] {
  const pick = OUTCOME_SORT_VALUE[sort.key]
  const mul = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = pick(a)
    const bv = pick(b)
    const aNull = av == null || av === ''
    const bNull = bv == null || bv === ''
    if (aNull && bNull) return 0
    if (aNull) return 1
    if (bNull) return -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul
    return String(av).localeCompare(String(bv)) * mul
  })
}

const outcomeKey = (o: OutcomeRow) => `${o.symbol}|${o.expiry}|${o.strike}`

/** Day-by-day detail for one tracked flag, rendered inline under the outcomes table. */
function OutcomeDetailPanel({ picked }: { picked: OutcomeRow }) {
  const qs = new URLSearchParams({
    symbol: picked.symbol,
    strike: String(picked.strike),
    expiry: picked.expiry,
  }).toString()
  const { data, error, loading } = useQuery<OutcomeDetail>(`/proxy/far-cb-outcome-detail?${qs}`, {
    staleMs: 60_000,
  })

  if (loading && !data) return <p className="p-2 text-xs text-faint">Loading day-by-day detail…</p>
  if (error || data?.error) {
    return <p className="p-2 text-xs text-down">{data?.error ?? 'Failed to load day-by-day detail.'}</p>
  }
  if (!data) return null

  const dayCols: Column<OutcomeDetailDay>[] = [
    { key: 'date', header: 'Date', cell: (d) => d.date },
    { key: 'spot', header: 'Spot', numeric: true, cell: (d) => fmtUsd(d.spot) },
    {
      key: 'spotPctChg',
      header: 'Spot %',
      numeric: true,
      cell: (d) => <span className={dirClass(d.spotPctChg)}>{fmtSignedPct(d.spotPctChg)}</span>,
    },
    { key: 'contractClose', header: 'Contract', numeric: true, cell: (d) => fmtUsd(d.contractClose) },
    {
      key: 'contractPctChg',
      header: 'Contract %',
      numeric: true,
      cell: (d) => <span className={dirClass(d.contractPctChg)}>{fmtSignedPct(d.contractPctChg)}</span>,
    },
  ]

  return (
    <div className="border-t border-line/50 bg-surface2 p-2">
      <p className="mb-1 text-xs text-muted">
        {data.symbol} {fmtUsd(data.strike, 0)} {data.type} · {data.expiry} · flagged {ymd(data.firstFlagged)}
      </p>
      <Table columns={dayCols} rows={data.days} rowKey={(d) => d.date} empty="No day-by-day rows yet." />
    </div>
  )
}

/** Tracked-results table: did the flagged strike ever get touched? (v2: the flat OutcomeRow table half of WatchThisScanner). */
function CbOutcomesTable() {
  const [status, setStatus] = useState<OutcomeStatus>('all')
  const [sort, setSort] = useState<{ key: OutcomeSortKey; dir: 'asc' | 'desc' }>({
    key: 'first_flagged',
    dir: 'desc',
  })
  const [openKey, setOpenKey] = useState<string | null>(null)

  // "results" is a client-side day-bucket roll-up over the full table — see the
  // TODO below. The flat statuses below it are the endpoint's own filter.
  const fetchStatus = status === 'results' ? 'all' : status
  const { data, error, loading } = useQuery<FarCbOutcomesResponse>(
    `/proxy/far-cb-outcomes?status=${fetchStatus}&limit=100`,
    { staleMs: 30_000, pollMs: 60_000 },
  )
  const rows = data?.rows ?? []
  const sorted = useMemo(() => sortOutcomes(rows, sort), [rows, sort])

  const toggleSort = (key: OutcomeSortKey) =>
    setSort((p) => (p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))

  const th = (label: string, key: OutcomeSortKey): Column<OutcomeRow> => ({
    key,
    numeric: key !== 'symbol' && key !== 'expiry' && key !== 'first_flagged' && key !== 'touched_date' && key !== 'status',
    header: (
      <button type="button" onClick={() => toggleSort(key)} className={sort.key === key ? 'text-accent' : ''}>
        {label} {sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '▾'}
      </button>
    ),
    cell: () => null, // overwritten per-column below
  })

  const columns: Column<OutcomeRow>[] = [
    { ...th('Symbol', 'symbol'), cell: (o) => o.symbol },
    {
      ...th('Strike', 'strike'),
      cell: (o) => <span className={o.side === 'above' ? 'text-up' : 'text-down'}>{fmtUsd(o.strike, 0)}</span>,
    },
    { ...th('Expiry', 'expiry'), cell: (o) => o.expiry },
    { ...th('Flagged', 'first_flagged'), cell: (o) => ymd(o.first_flagged) },
    {
      ...th('Entry', 'opt_entry'),
      cell: (o) => (o.opt_entry != null ? `${fmtUsd(o.opt_entry)}${o.opt_type ? ` ${o.opt_type}` : ''}` : '—'),
    },
    { ...th('High', 'opt_high'), cell: (o) => fmtUsd(o.opt_high) },
    {
      ...th('Max %', 'opt_pct_high'),
      cell: (o) => <span className={dirClass(o.opt_pct_high)}>{fmtSignedPct(o.opt_pct_high)}</span>,
    },
    { ...th('Flagged Spot', 'spot_at_flag'), cell: (o) => fmtUsd(o.spot_at_flag) },
    { ...th('OTM at flag', 'otm_pct_at_flag'), cell: (o) => fmtPct(o.otm_pct_at_flag, 0) },
    { ...th('Closest', 'closest_pct'), cell: (o) => fmtPct(o.closest_pct) },
    { ...th('Touched', 'touched_date'), cell: (o) => ymd(o.touched_date) },
    {
      ...th('Status', 'status'),
      cell: (o) => (
        <span
          className={
            o.status === 'touched' ? 'text-accent' : o.status === 'expired' ? 'text-faint' : 'text-up'
          }
        >
          {o.status.toUpperCase()}
        </span>
      ),
    },
    // Table has no per-row click hook (it is deliberately generic — see
    // Table.tsx), so v2's "click any row to expand" becomes a per-row button
    // in its own trailing column instead of a click handler on the <tr>.
    {
      key: 'detail',
      header: '',
      align: 'center',
      cell: (o) => (
        <Chip
          label={outcomeKey(o) === openKey ? 'Hide' : 'Detail'}
          on={outcomeKey(o) === openKey}
          onClick={() => setOpenKey((k) => (k === outcomeKey(o) ? null : outcomeKey(o)))}
          title="Day-by-day detail for this flag"
        />
      ),
    },
  ]

  const picked = sorted.find((o) => outcomeKey(o) === openKey) ?? null

  return (
    <Card
      title="Tracked results"
      actions={error ? <span className="text-xs text-down">stale — last good rows shown</span> : undefined}
    >
      <CardToolbar>
        <SegGroup
          value={status}
          onChange={setStatus}
          options={(['all', 'open', 'touched', 'expired', 'results'] as const).map((s) => ({
            label: s.charAt(0).toUpperCase() + s.slice(1),
            value: s,
          }))}
        />
      </CardToolbar>
      <p className="mb-2 text-xs text-muted">
        Graded daily ~16:10 ET · no win/loss, just whether spot reached the strike · click a row for
        day-by-day detail · click a column to sort
      </p>
      {status === 'results' ? (
        // TODO(v3): port groupOutcomesByDay + ResultsByDay from v2's Scanner.tsx —
        // the day-bucketed "opened / touched / expired per date" roll-up over the
        // full 300-row `/proxy/far-cb-outcomes?status=all&limit=300&quotes=0` set.
        <p className="p-4 text-sm text-faint">
          Results view (one row per date, opened/touched/expired counts) is not ported yet — see
          groupOutcomesByDay/ResultsByDay in v2's Scanner.tsx.
        </p>
      ) : (
        <>
          <Table
            columns={columns}
            rows={sorted}
            rowKey={(o) => outcomeKey(o)}
            rowClassName={(o) => (outcomeKey(o) === openKey ? 'bg-raised' : undefined)}
            stale={loading && rows.length === 0}
            empty="No tracked flags yet."
          />
          {picked && <OutcomeDetailPanel picked={picked} />}
        </>
      )}
    </Card>
  )
}

function WatchThisTab() {
  return (
    <>
      <FarCbTickersGrid />
      <CbOutcomesTable />
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════
//  TODO stubs — v2 sections backed by machinery not in this bundle.
//  Each renders its real title and names the exact v2 symbol to port.
// ══════════════════════════════════════════════════════════════════════════

// TODO(v3): port GexLevelsTab from v2's components/scanner/GexLevelsTab.tsx —
// the SqueezeMetrics-style GEX dashboard (moved into Scanner 2026-08-16).
function GexLevelsTab() {
  return (
    <Card title="GEX Levels">
      <p className="text-sm text-faint">
        SqueezeMetrics-style GEX dashboard not yet ported — see GexLevelsTab in v2's
        components/scanner/GexLevelsTab.tsx.
      </p>
    </Card>
  )
}

// TODO(v3): port GexChangeTop from v2's components/scanner/GexChangeTop.tsx —
// biggest cross-ticker GEX movers. This is v2's default landing tab.
function GexChangeTopTab() {
  return (
    <Card title="GEX Change Top">
      <p className="text-sm text-faint">
        Biggest cross-ticker GEX movers not yet ported — see GexChangeTop in v2's
        components/scanner/GexChangeTop.tsx.
      </p>
    </Card>
  )
}

// TODO(v3): port PickStudyTab from v2's components/scanner/PickStudyTab.tsx —
// what the graded GEX Change Top picks had in common at capture.
function PickStudyTab() {
  return (
    <Card title="Pick Study">
      <p className="text-sm text-faint">
        Graded-pick study not yet ported — see PickStudyTab in v2's
        components/scanner/PickStudyTab.tsx.
      </p>
    </Card>
  )
}

// TODO(v3): port TpoStructuresScanner from v2's components/pages/Scanner.tsx —
// a multi-day Market Profile ("open business" + AMT read) walk over ES/NQ
// candles, built from buildTpoStructures/amtRead (lib/tpo, lib/amt) and fed
// by useEsCandles/useNqCandles. v3 has no live-candle feed those hooks need.
function TpoStructuresTab() {
  return (
    <Card title="TPO Structures">
      <p className="text-sm text-faint">
        Market Profile "open business" + AMT read not yet ported — see TpoStructuresScanner in v2's
        components/pages/Scanner.tsx (buildTpoStructures/amtRead, lib/tpo · lib/amt).
      </p>
    </Card>
  )
}

// TODO(v3): port IbStatsTab from v2's components/scanner/IbStatsTab.tsx —
// initial-balance statistics.
function IbStatsTab() {
  return (
    <Card title="IB Stats">
      <p className="text-sm text-faint">
        Initial-balance statistics not yet ported — see IbStatsTab in v2's
        components/scanner/IbStatsTab.tsx.
      </p>
    </Card>
  )
}

// ══════════════════════════════════════════════════════════════════════════
//  PAGE SHELL — tab switcher
// ══════════════════════════════════════════════════════════════════════════

export default function ScannerPage() {
  // v2 opened /scanner on GEX Change Top (2026-08-21); kept here for parity
  // even though that tab is a TODO stub in v3 today.
  const [tab, setTab] = useState<MainTab>('gexchangetop')

  return (
    <Page
      title="Scanner"
      actions={<SegGroup value={tab} onChange={setTab} options={TABS.map((t) => ({ label: t.label, value: t.value }))} />}
    >
      {tab === 'gexlevels' && <GexLevelsTab />}
      {tab === 'gexchangetop' && <GexChangeTopTab />}
      {tab === 'pickstudy' && <PickStudyTab />}
      {tab === 'strike' && <StrikeQueryTab />}
      {tab === 'tpo' && <TpoStructuresTab />}
      {tab === 'ibstats' && <IbStatsTab />}
      {tab === 'watch' && <WatchThisTab />}
    </Page>
  )
}
