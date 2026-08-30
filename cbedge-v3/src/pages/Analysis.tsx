import { useEffect, useState, type ReactNode } from 'react'
import { Page } from '@/design/primitives/Page'
import { Card } from '@/design/primitives/Card'
import { Table, type Column } from '@/design/primitives/Table'
import { Stat } from '@/design/primitives/Stat'
import { SegGroup } from '@/design/primitives/Controls'
import { useQuery } from '@/data/api'
import { usePageSymbol } from '@/data/symbol'

// ─────────────────────────────────────────────────────────────────────────────
// Analysis — the pre-market/session read: estimated move, premarket tape,
// econ calendar, SPX confidence score, net greeks, initial balance, per-
// ticker walls, a ticker lookup and the AI strategy plan, on one scrolling
// grid. Routed at /v3/analytics ("Analysis" in the nav rail); replaces v2's
// components/pages/Analytics.tsx, whose ten independent cards (own polling
// fetch each, no tabs, no shared state) this file keeps in the same order
// with the same headings and per-card ticker pills. What changes is the
// plumbing (useQuery, not v2's useLiveData hook; Tailwind tokens, not
// HOME_THEME hex) and, for sections built on client-side chain math or a
// live candle feed this file has no access to, a stub Card naming exactly
// what is missing rather than a fabricated number:
//   - Multi Greek's peak-strike tiles and Net Greeks' QQQ/SPY branch both
//     need client-side OI+Vol math over `/api/chains` (accumulateChainGreeks
//     in v2) — outside this route's endpoint set, so stubbed, not faked.
//   - Ticker Lookup's ladder/replay/structural-board panes are a bespoke
//     chain+canvas renderer (~840 lines in v2) — stubbed, save for the one
//     REST read (`/api/eod-strike-gex-change`) cheap enough to wire for real.
//   - Initial Balance needs v2's live ES candle feed (useEsCandles) plus
//     lib/failLevels; there is no OHLC frame on the v3 socket (only
//     spot/gex/aux/flow/status) and no REST substitute, so it's stubbed.
//   - Economic Calendar delegates to a whole second component in v2
//     (EconCalendarPanel) — stubbed rather than partially reimplemented.
//   - Ticker Levels drops v2's `/proxy/scanner` freshness overlay and
//     free-text symbol search; `/proxy/walls` alone carries spot/call/put/CB
//     for a small fixed ticker list, enough for real numbers with one fetch.
//   - Estimated Move drops the live `/api/tt-quotes` overlay; v2 already
//     falls back to the weekly close with no quote, and that fallback is
//     what this port always uses.
// ─────────────────────────────────────────────────────────────────────────────

// ── shared formatting ───────────────────────────────────────────────────────
type Dir = 'up' | 'down' | 'flat'

// A stored level string ("6,112.5") or any numeric → a plain number.
function numOr(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function fmtNum(n: number | null | undefined, maxFrac = 0): string {
  return n == null || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: maxFrac })
}

// "+1.2B" / "-840M" — a raw dollar figure at the scale it actually is.
function fmtBig(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n >= 0 ? '+' : '-'
  const a = Math.abs(n)
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(0)}M`
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(0)}K`
  return `${sign}${a.toFixed(0)}`
}

function fmtPts(n: number | null | undefined, frac = 1): string {
  return n == null || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(frac)}`
}

function fmtPct(n: number | null | undefined, frac = 2): string {
  return n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(frac)}%`
}

function dirOf(n: number | null | undefined): Dir | undefined {
  if (n == null || !Number.isFinite(n)) return undefined
  return n > 0 ? 'up' : n < 0 ? 'down' : 'flat'
}

// For inline spans that color a number without going through <Stat>.
function dirClass(n: number | null | undefined): string {
  const d = dirOf(n)
  return d === 'up' ? 'text-up' : d === 'down' ? 'text-down' : d === 'flat' ? 'text-flat' : 'text-muted'
}

// ET today (YYYY-MM-DD) — the ?date= param every snapshot endpoint below wants.
function etDateISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

function nowEtClock(): { dow: number; mins: number } {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { dow: DOW[get('weekday')] ?? 0, mins: Number(get('hour')) * 60 + Number(get('minute')) }
}

// The next premarket session's date. The VPS cron writes it ~08:00 ET on
// weekdays; after 4pm ET, or on a weekend, roll forward to the next weekday.
function nextPremarketDate(): string {
  const { dow, mins } = nowEtClock()
  const rollForward = mins >= 16 * 60 || dow === 0 || dow === 6
  const base = new Date(`${etDateISO()}T12:00:00-05:00`)
  let add = rollForward ? 1 : 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getTime() + add * 86_400_000)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) break
    add++
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(base.getTime() + add * 86_400_000),
  )
}

// True while current ET wall-clock is between 09:00 and 16:00 on a weekday —
// the window the strategy generator actually runs in.
function isStrategyWindow(): boolean {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  if (get('weekday') === 'Sat' || get('weekday') === 'Sun') return false
  const mins = Number(get('hour')) * 60 + Number(get('minute'))
  return mins >= 9 * 60 && mins < 16 * 60
}

// ── /api/levels, /api/es-gap, /api/premarket-summary ────────────────────────
interface LevelsResp {
  close?: string
  up?: string
  down?: string
  error?: string
}
interface EsGapResp {
  gap?: { prior_close?: number; gap_pts?: number } | null
}
interface PremarketSummaryResp {
  summary?: { date?: string; bullets?: string[] } | null
  error?: string
}

// ── /api/confidence ──────────────────────────────────────────────────────────
interface MvcSegment {
  strike: number
  from: string // "HH:MM" ET
  to: string
  outcome: 'hit' | 'pivot' | 'chop' | 'miss'
}
interface ConfidenceResp {
  level?: number
  price?: number
  spx?: number
  thresholds?: { hitPts?: number }
  score?: { hit?: number; pivot?: number; chop?: number; break?: number }
  mvcTimeline?: MvcSegment[]
  error?: string
}

function hhmmToMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

// The MVC segment active at a target ET minute — the last one whose window
// had started by then, falling back to the first segment of the day.
function segmentAt(timeline: MvcSegment[] | undefined, targetMin: number): MvcSegment | null {
  if (!timeline?.length) return null
  let best: MvcSegment | null = null
  for (const seg of timeline) {
    const from = hhmmToMin(seg.from)
    if (from != null && from <= targetMin) best = seg
  }
  return best ?? timeline[0] ?? null
}

const MVC_CHECKPOINTS: Array<{ label: string; min: number }> = [
  { label: '9:45', min: 9 * 60 + 45 },
  { label: '10:30', min: 10 * 60 + 30 },
  { label: '12:00', min: 12 * 60 },
]

function outcomeChip(o: MvcSegment['outcome'] | null | undefined): { text: string; cls: string } {
  if (o == null) return { text: '—', cls: 'text-muted' }
  if (o === 'miss') return { text: 'MISS', cls: 'text-down' }
  if (o === 'hit' || o === 'pivot') return { text: 'HIT', cls: 'text-up' }
  return { text: 'HIT · CHOP', cls: 'text-warn' }
}

// ── /api/snapshots/greeks ────────────────────────────────────────────────────
interface GreeksTsRow {
  timestamp: number
  gex: number
  dex: number
  chex: number
  vex: number
}
interface GreeksTsResp {
  rows?: GreeksTsRow[]
}
// Stored as $B for gex/dex, $M for chex/vex — scale to raw dollars for fmtBig.
const GREEK_SCALE: Record<keyof Omit<GreeksTsRow, 'timestamp'>, number> = {
  gex: 1e9,
  dex: 1e9,
  chex: 1e6,
  vex: 1e6,
}
type NgTicker = 'SPX' | 'QQQ' | 'SPY'
const NG_OPTIONS = (['SPX', 'QQQ', 'SPY'] as const).map((t) => ({ label: t, value: t as NgTicker }))

// The row whose timestamp is closest to (latestTs - minsAgo), within ±tolMin.
function rowNearestAgo(rows: GreeksTsRow[], latestTs: number, minsAgo: number, tolMin = 6): GreeksTsRow | null {
  const target = Number(latestTs) - minsAgo * 60_000
  let best: GreeksTsRow | null = null
  let bestDiff = Infinity
  for (const r of rows) {
    const diff = Math.abs(Number(r.timestamp) - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = r
    }
  }
  return best && bestDiff <= tolMin * 60_000 ? best : null
}

// ── /proxy/walls ─────────────────────────────────────────────────────────────
interface WallsTickerRow {
  symbol: string
  spot: number | null
  call_wall: number | null
  put_wall: number | null
  cb: number | null
}
interface WallsResp {
  ok?: boolean
  date?: string
  tickers?: WallsTickerRow[]
  error?: string
}
const TL_TICKERS = ['SPX', 'SPY', 'QQQ', 'NDX'] as const
type TlTicker = (typeof TL_TICKERS)[number]
const TL_OPTIONS = TL_TICKERS.map((t) => ({ label: t, value: t }))

// ── /api/strategy ─────────────────────────────────────────────────────────────
interface StrategyLevel {
  label?: string
  price?: string | number
  note?: string
}
interface StrategyIdea {
  direction?: 'long' | 'short'
  entry?: string
  stop?: string
  target?: string
  rationale?: string
}
interface StrategyPlan {
  bias?: 'long' | 'short' | 'neutral'
  headline?: string
  summary?: string
  levels?: StrategyLevel[]
  idea?: StrategyIdea
  triggers?: string[]
  risk?: string
}
interface StrategyResp {
  strategy?: { date?: string; plan?: StrategyPlan } | null
  error?: string
}

// ── /api/eod-strike-gex-change ───────────────────────────────────────────────
// The day-over-day ΔGEX series (computed server-side, one row per strike).
// Ticker Lookup's ladder is a TODO stub below, but this one read is cheap
// enough — and explicitly part of this route's endpoint set — to wire for
// real even before the ladder that would chart it exists.
interface EodChangeResp {
  ok?: boolean
  symbol?: string
  prevDate?: string | null
  rows?: unknown[]
  error?: string
}

// ── 1. TICKER LOOKUP (stub) ──────────────────────────────────────────────────
function TickerLookupStub() {
  // TODO(v3): port TickerLookupCard from v2 Analytics.tsx (~lines 2366-3208):
  // a per-expiry OI+Vol GEX ladder (left pane, built on /api/chains), the
  // ex-0DTE structural board summed across every listed expiration (right
  // pane, /api/expirations + one /api/chains call per expiry) and session
  // replay. All three are bespoke DOM/canvas renderers, not a plain useQuery.
  const { symbol } = usePageSymbol()
  const chgQ = useQuery<EodChangeResp>(`/api/eod-strike-gex-change?symbol=${encodeURIComponent(symbol)}`, {
    pollMs: 3_600_000,
  })
  const n = chgQ.data?.ok ? (chgQ.data.rows?.length ?? 0) : 0

  return (
    <Card title="Ticker Lookup" actions={<span className="tabular text-xs text-muted">{symbol}</span>}>
      <p className="text-xs text-faint">
        The live GEX ladder, structural board and session replay are a bespoke chain renderer — not ported yet.
      </p>
      <p className="mt-1 text-xs text-faint">
        {chgQ.loading
          ? 'Loading day-over-day ΔGEX…'
          : n > 0
            ? `${n} strikes with a recorded day-over-day ΔGEX for ${symbol} (vs ${chgQ.data?.prevDate ?? 'prior session'}).`
            : `No day-over-day ΔGEX recorded yet for ${symbol}.`}
      </p>
    </Card>
  )
}

// ── 2. MULTI GREEK (stub) ────────────────────────────────────────────────────
type MgTicker = 'SPX' | 'QQQ' | 'SPY'
const MG_OPTIONS = (['SPX', 'QQQ', 'SPY'] as const).map((t) => ({ label: t, value: t as MgTicker }))

function MultiGreekStub() {
  // TODO(v3): wire `/api/chains?ticker=…&range=all` and port
  // accumulateChainGreeks()/computePeakGreeks() from v2 Analytics.tsx to
  // compute the four peak-strike (GEX/DEX/CHEX/VEX) tiles client-side.
  const [tk, setTk] = useState<MgTicker>('SPX')
  return (
    <Card title="Multi Greek" actions={<SegGroup options={MG_OPTIONS} value={tk} onChange={setTk} />}>
      <p className="text-xs text-faint">
        Peak GEX/DEX/CHEX/VEX strikes for {tk} need client-side chain math — not ported yet.
      </p>
    </Card>
  )
}

// ── 3. ESTIMATED MOVE ────────────────────────────────────────────────────────
type EmTicker = 'ESU' | 'NQU' | 'SPX' | 'SPY' | 'QQQ'
const EM_OPTIONS = (['ESU', 'NQU', 'SPX', 'SPY', 'QQQ'] as const).map((t) => ({ label: t, value: t as EmTicker }))

function EstimatedMoveCard() {
  const [tk, setTk] = useState<EmTicker>('SPX')
  const lvQ = useQuery<LevelsResp>(`/api/levels?ticker=${tk}`, { pollMs: 120_000 })

  const up = numOr(lvQ.data?.up)
  const down = numOr(lvQ.data?.down)
  const close = numOr(lvQ.data?.close)
  const midpoint = up != null && down != null ? (up + down) / 2 : null
  // Live spot needs /api/tt-quotes, which isn't in this route's endpoint set —
  // fall back to the weekly close (or the EM midpoint), same as v2 does when
  // no quote is available.
  const spot = close != null && close > 0 ? close : midpoint
  const ready = up != null && down != null && spot != null

  const distUp = ready ? up! - spot! : 0
  const distDown = ready ? spot! - down! : 0
  const nearerUp = distUp <= distDown
  const near = nearerUp ? distUp : distDown
  const crossed = near < 0

  return (
    <Card title="Estimated Move" actions={<SegGroup options={EM_OPTIONS} value={tk} onChange={setTk} />}>
      {lvQ.loading && !lvQ.data ? (
        <p className="text-xs text-faint">Loading…</p>
      ) : !ready ? (
        <p className="text-xs text-faint">No published EM for {tk}.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="EM Up" value={fmtNum(up)} direction="up" size="sm" />
            <Stat label={close != null && close > 0 ? 'Close' : 'Mid'} value={fmtNum(spot, 2)} size="sm" />
            <Stat label="EM Down" value={fmtNum(down)} direction="down" size="sm" />
          </div>
          <div className="flex flex-col gap-1 border-t border-line pt-3">
            <span className="text-xs text-muted">
              Distance to nearer band ({nearerUp ? 'Up' : 'Down'}){crossed ? ' · crossed' : ''}
            </span>
            <div className="flex items-baseline gap-2">
              <span className={`tabular text-lg font-medium ${crossed ? 'text-down' : 'text-up'}`}>
                {crossed ? '-' : ''}
                {fmtPts(Math.abs(near))} pts
              </span>
              <span className="tabular text-xs text-faint">{fmtPct((Math.abs(near) / spot!) * 100)}</span>
            </div>
          </div>
        </div>
      )}
      {lvQ.error && lvQ.data && <p className="mt-2 text-xs text-down">Refresh failed — showing last published EM.</p>}
    </Card>
  )
}

// ── 4. PREMARKET ─────────────────────────────────────────────────────────────
function PremarketCard() {
  const today = etDateISO()
  const sumQ = useQuery<PremarketSummaryResp>('/api/premarket-summary', { pollMs: 5 * 60_000 })
  const gapQ = useQuery<EsGapResp>(`/api/es-gap?date=${today}`, { pollMs: 5 * 60_000 })

  const bullets = sumQ.data?.summary?.bullets ?? []
  const sumDate = sumQ.data?.summary?.date ?? null
  const nextDate = nextPremarketDate()
  // A stored summary is only valid for the NEXT premarket session — anything
  // else (Friday's read on a Monday, or the prior session after 4pm) is stale.
  const isStale = sumDate !== nextDate
  const g = gapQ.data?.gap ?? null
  const gapPts = g?.gap_pts ?? null

  return (
    <Card title="Premarket" actions={<span className="tabular text-xs text-muted">{isStale ? nextDate : (sumDate ?? '')}</span>}>
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {sumQ.loading && !sumQ.data ? (
          <p className="text-xs text-faint">Loading…</p>
        ) : bullets.length === 0 || isStale ? (
          <p className="text-xs text-faint">Summary will be up at 8:00 AM Eastern.</p>
        ) : (
          <ul className="flex flex-1 flex-col gap-2 overflow-y-auto text-pretty pl-4 text-sm text-fg list-disc">
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
        {gapPts != null && (
          <div className="border-t border-line pt-2 text-xs text-muted">
            /ES gap: <span className={dirClass(gapPts)}>{fmtPts(gapPts, 2)} pts</span>
            {g?.prior_close ? ` (${fmtPct((gapPts / g.prior_close) * 100)})` : ''}
          </div>
        )}
        {sumQ.error && sumQ.data && <p className="text-xs text-down">Refresh failed — showing last summary.</p>}
      </div>
    </Card>
  )
}

// ── 5. ECONOMIC CALENDAR (stub) ──────────────────────────────────────────────
function EconCalendarStub() {
  // TODO(v3): port components/dashboard/EconCalendarPanel.tsx — impact-colored
  // event rows, day separators, A:/F:/P: figures, stale-event fading and the
  // earnings logo strip v2 renders at the bottom of this card.
  return (
    <Card title="Economic Calendar">
      <p className="text-xs text-faint">
        The full calendar panel (impact-colored rows, earnings strip) is not ported yet.
      </p>
    </Card>
  )
}

// ── 6. CONFIDENCE SCORE ───────────────────────────────────────────────────────
function ConfidenceCard() {
  const today = etDateISO()
  const q = useQuery<ConfidenceResp>(`/api/confidence?date=${today}`, { pollMs: 120_000 })

  const s = q.data?.score
  const score = s?.hit != null ? Math.round(s.hit) : null
  const mvc = q.data?.level ?? null
  const px = q.data?.price ?? q.data?.spx ?? null
  const distToMvc = mvc != null && px != null ? px - mvc : null
  const hitPts = q.data?.thresholds?.hitPts ?? 8
  const band: 'HIT' | 'PIVOT' | 'CHOP' | null =
    s == null
      ? null
      : (s.hit ?? 0) >= (s.pivot ?? 0) && (s.hit ?? 0) >= (s.chop ?? 0)
        ? 'HIT'
        : (s.pivot ?? 0) >= (s.chop ?? 0)
          ? 'PIVOT'
          : 'CHOP'
  const bandCls = band === 'HIT' ? 'text-up' : band === 'CHOP' ? 'text-down' : 'text-flat'
  const bandBgCls = band === 'HIT' ? 'bg-up' : band === 'CHOP' ? 'bg-down' : 'bg-flat'

  type CpRow = { label: string; min: number; seg: MvcSegment | null }
  const rows: CpRow[] = MVC_CHECKPOINTS.map((cp) => ({ ...cp, seg: segmentAt(q.data?.mvcTimeline, cp.min) }))
  const columns: Column<CpRow>[] = [
    { key: 'time', header: 'Time', cell: (r) => r.label },
    { key: 'cb', header: 'CB', cell: (r) => (r.seg ? fmtNum(r.seg.strike) : '—'), numeric: true },
    {
      key: 'outcome',
      header: 'Outcome',
      cell: (r) => {
        const chip = outcomeChip(r.seg?.outcome)
        return <span className={`text-xs font-semibold ${chip.cls}`}>{chip.text}</span>
      },
    },
  ]

  return (
    <Card
      title={
        <>
          Confidence Score <span className="ml-1 text-[10px] font-bold text-warn">BETA</span>
        </>
      }
    >
      {q.loading && !q.data ? (
        <p className="text-xs text-faint">Waiting for today's first CB snapshot.</p>
      ) : score == null ? (
        <p className="text-xs text-faint">Waiting for today's first CB snapshot.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-1">
              <span className={`tabular text-2xl font-semibold ${bandCls}`}>{score}</span>
              <span className="text-xs text-muted">/100</span>
            </div>
            <span className={`text-sm font-semibold tracking-wide ${bandCls}`}>{band}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-sm bg-surface2">
            <div className={`h-full ${bandBgCls}`} style={{ width: `${score}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Current SPX CB" value={fmtNum(mvc)} size="sm" />
            <Stat
              label="Distance to CB"
              value={fmtPts(distToMvc)}
              direction={distToMvc == null ? undefined : Math.abs(distToMvc) <= hitPts ? 'up' : 'flat'}
              size="sm"
            />
          </div>
          <div className="min-h-0 flex-1">
            <Table columns={columns} rows={rows} rowKey={(r) => r.label} />
          </div>
        </div>
      )}
      {q.error && q.data && <p className="mt-1 text-xs text-down">Refresh failed — showing last confidence read.</p>}
    </Card>
  )
}

// ── 7. NET GREEKS ─────────────────────────────────────────────────────────────
function NetGreeksCard() {
  // TODO(v3): wire `/api/chains?ticker=…&range=all` and port computeNetGreeks()
  // from v2 Analytics.tsx (GreeksCard) so the QQQ/SPY branch below sums a live
  // chain instead of showing its not-ported note.
  const [tk, setTk] = useState<NgTicker>('SPX')
  const isSpx = tk === 'SPX'
  const today = etDateISO()

  // Today's series (ascending). Empty pre-open/overnight — the writer is
  // RTH-gated — so a latest-row fallback covers the prior session instead.
  const seriesQ = useQuery<GreeksTsResp>(isSpx ? `/api/snapshots/greeks?date=${today}&limit=5000` : null, {
    pollMs: 120_000,
  })
  const fallbackQ = useQuery<GreeksTsResp>(isSpx ? '/api/snapshots/greeks?limit=1' : null, { pollMs: 60_000 })

  const todayRows = seriesQ.data?.rows ?? []
  const usingFallback = isSpx && todayRows.length === 0 && (fallbackQ.data?.rows?.length ?? 0) > 0
  const rows = usingFallback ? (fallbackQ.data!.rows as GreeksTsRow[]) : todayRows
  const cur = usingFallback ? (rows[0] ?? null) : rows.length ? rows[rows.length - 1] : null
  const ago15 = cur && !usingFallback ? rowNearestAgo(rows, cur.timestamp, 15) : null
  const ago30 = cur && !usingFallback ? rowNearestAgo(rows, cur.timestamp, 30) : null

  const keys: Array<{ label: string; k: keyof typeof GREEK_SCALE }> = [
    { label: 'Net GEX', k: 'gex' },
    { label: 'Net DEX', k: 'dex' },
    { label: 'Net CHEX', k: 'chex' },
    { label: 'Net VEX', k: 'vex' },
  ]
  const valueFor = (k: keyof typeof GREEK_SCALE) => (cur ? cur[k] * GREEK_SCALE[k] : null)
  const deltaFor = (k: keyof typeof GREEK_SCALE, ago: GreeksTsRow | null) =>
    cur && ago ? (cur[k] - ago[k]) * GREEK_SCALE[k] : null

  const loading = isSpx && seriesQ.loading && fallbackQ.loading && !cur

  return (
    <Card
      title="Net Greeks"
      actions={
        <>
          <SegGroup options={NG_OPTIONS} value={tk} onChange={setTk} />
          <span className="tabular text-[10px] text-muted">
            {!isSpx ? 'needs live chain' : usingFallback ? 'last session' : 'now · Δ15m · Δ30m'}
          </span>
        </>
      }
    >
      {!isSpx ? (
        <p className="text-xs text-faint">{tk} totals need a client-side chain sum — not ported yet.</p>
      ) : loading || !cur ? (
        <p className="text-xs text-faint">
          {seriesQ.error ? `Failed to load — ${seriesQ.error.message}` : 'No greeks series yet.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {keys.map(({ label, k }) => {
            const v = valueFor(k)
            const d15 = deltaFor(k, ago15)
            const d30 = deltaFor(k, ago30)
            return (
              <Stat
                key={k}
                label={label}
                value={fmtBig(v)}
                direction={dirOf(v)}
                sub={`15m ${d15 == null ? '—' : fmtBig(d15)} · 30m ${d30 == null ? '—' : fmtBig(d30)}`}
              />
            )
          })}
        </div>
      )}
      {isSpx && seriesQ.error && cur && (
        <p className="mt-2 text-xs text-down">Refresh failed — showing last known greeks.</p>
      )}
    </Card>
  )
}

// ── 8. INITIAL BALANCE (stub) ────────────────────────────────────────────────
function InitialBalanceStub() {
  // TODO(v3): port IbCard from v2 Analytics.tsx. It reads useEsCandles() (a
  // live 1-minute ES OHLC feed) and computeAmt() from lib/failLevels to
  // derive the 9:30-10:30 ET IB high/low/mid, a day-type/bias read and the
  // "rules in play" list. Neither exists in v3 yet — there is no OHLC candle
  // frame on the socket (spot/gex/aux/flow/status only), so this needs a new
  // data path, not just a useQuery call.
  return (
    <Card title="Initial Balance" actions={<span className="text-xs text-muted">ES</span>}>
      <p className="text-xs text-faint">
        IB high/low/mid and the day-type read need a live ES candle feed — not ported yet.
      </p>
    </Card>
  )
}

// ── 9. TICKER LEVELS ──────────────────────────────────────────────────────────
function TickerLevelsCard() {
  const today = etDateISO()
  const [tk, setTk] = useState<TlTicker>('SPX')
  const wallsQ = useQuery<WallsResp>(`/proxy/walls?date=${today}`, { pollMs: 120_000 })

  const rows = wallsQ.data?.tickers ?? []
  const row = rows.find((t) => t.symbol.toUpperCase() === tk) ?? null
  const corePending = !!wallsQ.data && rows.length === 0

  const distCall = row?.spot != null && row.call_wall != null ? row.call_wall - row.spot : null
  const distPut = row?.spot != null && row.put_wall != null ? row.spot - row.put_wall : null
  const nearerCall = distCall != null && (distPut == null || distCall <= distPut)
  const near = nearerCall ? distCall : distPut
  const crossed = near != null && near < 0
  const distCore = row?.spot != null && row.cb != null ? row.cb - row.spot : null

  return (
    <Card title="Ticker Levels" actions={<SegGroup options={TL_OPTIONS} value={tk} onChange={setTk} />}>
      {wallsQ.loading && !wallsQ.data ? (
        <p className="text-xs text-faint">Waiting on today's first walls run.</p>
      ) : !row ? (
        <p className="text-xs text-faint">
          {corePending ? "Waiting on today's first recorder run." : `No walls row for ${tk} yet.`}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Spot" value={fmtNum(row.spot, 2)} size="sm" />
            <Stat label="Call Wall" value={fmtNum(row.call_wall, 2)} size="sm" />
            <Stat label="Put Wall" value={fmtNum(row.put_wall, 2)} size="sm" />
          </div>
          <div className="flex items-center justify-between border-t border-line pt-3">
            <Stat label="Core (CB)" value={fmtNum(row.cb, 2)} size="sm" />
            <span className={`tabular text-xs ${dirClass(distCore)}`}>{fmtPts(distCore)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">
              Distance to nearer wall ({nearerCall ? 'Call' : 'Put'}){crossed ? ' · through' : ''}
            </span>
            <span className={`tabular text-lg font-medium ${near == null ? 'text-muted' : crossed ? 'text-down' : 'text-up'}`}>
              {near == null ? '—' : `${crossed ? '-' : ''}${fmtPts(Math.abs(near))} pts`}
            </span>
          </div>
        </div>
      )}
      {wallsQ.error && wallsQ.data && <p className="mt-2 text-xs text-down">Refresh failed — showing last known walls.</p>}
    </Card>
  )
}

// ── 10. STRATEGY BUILDER (full-width) ────────────────────────────────────────
function StrategyBuilderCard() {
  const [active, setActive] = useState(isStrategyWindow)
  // Re-check every minute so the card gates itself in/out without a reload.
  useEffect(() => {
    const id = setInterval(() => setActive(isStrategyWindow()), 60_000)
    return () => clearInterval(id)
  }, [])

  const q = useQuery<StrategyResp>(active ? '/api/strategy' : null, { pollMs: 5 * 60_000 })
  const plan = q.data?.strategy?.plan ?? null
  const planDate = q.data?.strategy?.date ?? null
  const today = etDateISO()
  const isStale = planDate != null && planDate !== today
  const ready = !!plan && (!!plan.summary || !!plan.headline)

  const levelColumns: Column<StrategyLevel>[] = [
    { key: 'label', header: 'Level', cell: (l) => l.label ?? '—' },
    {
      key: 'price',
      header: 'Price',
      cell: (l) =>
        l.price == null || l.price === '' ? (
          '—'
        ) : (
          <>
            {String(l.price)} <span className="text-faint">SPX</span>
          </>
        ),
      numeric: true,
    },
    { key: 'note', header: 'Note', cell: (l) => l.note ?? '' },
  ]

  return (
    <Card
      title={
        <>
          Strategy Builder <span className="ml-1 text-[10px] font-bold text-warn">NOT FINANCIAL ADVICE</span>
        </>
      }
      actions={
        planDate && active ? (
          <span className={`tabular text-xs ${isStale ? 'text-warn' : 'text-muted'}`}>
            {isStale ? `last · ${planDate}` : planDate}
          </span>
        ) : undefined
      }
    >
      {!active ? (
        <p className="text-xs text-faint">Available 9:00 AM – 4:00 PM ET on weekdays.</p>
      ) : q.loading && !q.data ? (
        <p className="text-xs text-faint">Loading…</p>
      ) : !ready ? (
        <p className="text-xs text-faint">No strategy yet — regenerates hourly on weekdays (~7am–4pm ET).</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={[
                'rounded-md border px-3 py-1 text-xs font-semibold uppercase tracking-wide',
                plan!.bias === 'long' ? 'border-up text-up' : plan!.bias === 'short' ? 'border-down text-down' : 'border-flat text-flat',
              ].join(' ')}
            >
              {plan!.bias ?? 'neutral'}
            </span>
            {plan!.headline && <span className="text-sm font-medium text-fg">{plan!.headline}</span>}
          </div>

          {plan!.summary && <p className="text-sm leading-relaxed text-fg">{plan!.summary}</p>}

          <div className="grid grid-cols-1 gap-4 border-t border-line pt-3 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-accent">Key levels</span>
              <Table columns={levelColumns} rows={plan!.levels ?? []} rowKey={(l, i) => `${l.label ?? i}-${i}`} empty="—" />
            </div>

            <div className="flex flex-col gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-warn">Primary idea</span>
              {plan!.idea ? (
                <div className="flex flex-col gap-2 rounded-md border border-line p-3">
                  <span
                    className={[
                      'text-sm font-semibold',
                      plan!.idea.direction === 'long' ? 'text-up' : plan!.idea.direction === 'short' ? 'text-down' : 'text-flat',
                    ].join(' ')}
                  >
                    {plan!.idea.direction === 'long' ? '▲ LONG' : plan!.idea.direction === 'short' ? '▼ SHORT' : '—'}
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="Entry" value={plan!.idea.entry ?? '—'} size="sm" />
                    <Stat label="Stop" value={plan!.idea.stop ?? '—'} direction="down" size="sm" />
                    <Stat label="Target" value={plan!.idea.target ?? '—'} direction="up" size="sm" />
                  </div>
                  {plan!.idea.rationale && <span className="text-xs text-muted">{plan!.idea.rationale}</span>}
                </div>
              ) : (
                <span className="text-xs text-faint">—</span>
              )}

              <span className="text-xs font-semibold uppercase tracking-wide text-up">Confirmation triggers</span>
              {(plan!.triggers?.length ?? 0) === 0 ? (
                <span className="text-xs text-faint">—</span>
              ) : (
                <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-fg">
                  {plan!.triggers!.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {plan!.risk && (
            <p className="border-t border-line pt-2 text-xs text-muted">
              <span className="font-semibold text-warn">RISK · </span>
              {plan!.risk}
            </p>
          )}
        </div>
      )}
      {q.error && q.data && <p className="mt-1 text-xs text-down">Refresh failed — showing last plan.</p>}
    </Card>
  )
}

// ── PAGE ──────────────────────────────────────────────────────────────────────
// v2's grid was 4 columns wide with two full-width rows (Ticker Lookup at the
// top, Strategy Builder at the bottom); everything else was one cell each.
// Same shape here, collapsing to fewer columns on a narrower viewport.
export default function AnalysisPage(): ReactNode {
  return (
    <Page title="Analysis">
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="md:col-span-2 xl:col-span-4">
          <TickerLookupStub />
        </div>
        <MultiGreekStub />
        <EstimatedMoveCard />
        <PremarketCard />
        <EconCalendarStub />
        <ConfidenceCard />
        <NetGreeksCard />
        <InitialBalanceStub />
        <TickerLevelsCard />
        <div className="md:col-span-2 xl:col-span-4">
          <StrategyBuilderCard />
        </div>
      </div>
    </Page>
  )
}
