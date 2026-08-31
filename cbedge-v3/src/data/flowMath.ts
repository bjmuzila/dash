// ─────────────────────────────────────────────────────────────────────────────
// /flow — the maths, the formats and the thresholds.
//
// TRANSCRIBED 1:1 from v2's components/pages/Flow.tsx. Not re-derived from a
// description: every constant, every rounding rule, every threshold below is
// the value that file uses, and the spec they were checked against is
// docs/parity/flow.md. If a number here disagrees with that document, the
// document is right and this file has drifted.
//
// Pure. No React, no fetch, no DOM — so the whole filter chain and the whole
// net-drift walk can be exercised without a browser.
// ─────────────────────────────────────────────────────────────────────────────

import type { FlowTapePrint } from '@/contract/frames'

// ── Thresholds ───────────────────────────────────────────────────────────────

/**
 * Premium at or above which a print is a "whale": rendered bold, and the only
 * rows that expand into a contract drawer. Matches the Big-OTM preset's floor.
 */
export const WHALE_FLOOR = 500_000

/** Min Premium slider ceiling, by view. Combined flow spans the whole market. */
export const PREMIUM_MAX = 1_000_000
export const PREMIUM_MAX_COMBINED = 5_000_000
export const PREMIUM_STEP = 10_000
export const PREMIUM_STEP_COMBINED = 50_000

/**
 * Default tape/whale premium floor. Kept LOW deliberately: the server coalesces
 * fills in a short window, so real SPX 0DTE flow is mostly many sub-$50K orders
 * and a high default hides nearly all of it.
 */
export const DEFAULT_MIN_PREMIUM = 15_000

/**
 * Net Drift chart floor, DECOUPLED from the tape's Min Premium slider. The
 * chart tracks full directional positioning (the whole hundreds-of-millions of
 * OTM flow in a day), so it aggregates everything above a tiny noise floor no
 * matter how high the whale slider is set. Cranking Min Premium for the tape
 * must not flatline the chart.
 */
export const CHART_MIN_PREMIUM = 1_000

/** Net-drift bucket width, seconds. Fixed bins give a proportional x-axis. */
export const BIN_SEC = 60

/**
 * How far back the incremental `?since` poll ALWAYS re-asks for, in seconds.
 *
 * Mirrors NETPREM_LATE_MS in server-v2/server-with-proxy.js. The server
 * re-scans that window for prints that arrived late (a replayed batch carries
 * older EXCHANGE timestamps) and then filters its response to `sec >= since` —
 * so this value has to be at least as wide, or the client throws away exactly
 * the bins the server just went and fetched. Keep the two in step.
 */
export const NET_LATE_SEC = 15 * 60

/** Rendered row cap. Totals still span the full filtered set. */
export const MAX_TAPE_ROWS = 800

export const DEFAULT_TICKERS = [
  'SPX', 'SPY', 'QQQ', 'META', 'TSLA', 'AMZN', 'AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMD', 'NDX',
] as const

export const RECENT_TICKERS_KEY = 'cb-v3-flow-recent-tickers'
export const RECENT_TICKERS_MAX = 7
export const NETBINS_CACHE_KEY = 'cb-v3-flow-netbins'

/** Streamer roots carry suffixes a chip does not (SPX streams as "SPXW"). */
const ROOT_TO_TICKER: Record<string, string> = { SPXW: 'SPX', NDXP: 'NDX', RUTW: 'RUT', XSPW: 'XSP' }

/** Normalized roots treated as indices by the Combined view's "All − Indices". */
export const INDEX_TICKERS: ReadonlySet<string> = new Set(['SPX', 'NDX', 'RUT', 'XSP', 'VIX', 'DJX'])

export function normTicker(u: string | null | undefined): string {
  const up = (u ?? '').toUpperCase()
  return ROOT_TO_TICKER[up] ?? up
}

// ── Formats ──────────────────────────────────────────────────────────────────

/** `$1.23M` / `$45.6K` / `$789`. Negative gets a leading `-`; positives get no sign. */
export function fmtPremium(val: number): string {
  const a = Math.abs(val)
  const sign = val < 0 ? '-' : ''
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(1)}K`
  return `${sign}$${a.toFixed(0)}`
}

/**
 * Vol / OI cells. `null` means "the chain snapshot has not produced this
 * contract yet" (pre-open, or a strike outside the snapshot) — render an em
 * dash rather than 0, which would read as a real "no interest here".
 *
 * Note the 10K threshold, not 1K: four-digit volumes stay readable in full.
 */
export function fmtStat(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 10_000) return `${(v / 1_000).toFixed(1)}K`
  return v.toLocaleString()
}

/**
 * Cost to buy ONE contract (option price × 100 shares) — distinct from the
 * order's total Premium, which is price × size × 100.
 */
export function fmtContractCost(price: number): string {
  const cost = price * 100
  if (cost >= 1_000_000) return `$${(cost / 1_000_000).toFixed(2)}M`
  if (cost >= 1_000) return `$${(cost / 1_000).toFixed(1)}K`
  return `$${cost.toFixed(2)}`
}

/** Print-time underlying spot. 0 and undefined both read as unknown. */
export function fmtSpot(spot: number | undefined): string {
  if (!spot) return '—'
  return spot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** `09:31:04 AM`, ET. */
export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

/**
 * `08:58` — 24-hour ET, used to spell out the 24H axis window, whose bounds are
 * data-derived rather than the fixed 9:30–4:00. Deliberately a different locale
 * from fmtTime: this is an axis extent, not a print time.
 */
export function fmtEtHm(utcSec: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(utcSec * 1000))
}

/**
 * `12s` / `5m` / `1h 4m` — how long ago something was, for a staleness read.
 *
 * Coarse on purpose. The question a live panel has to answer is "is this feed
 * still arriving", and to the second is noise for that; a minute count is the
 * granularity anyone actually acts on.
 */
export function fmtAgo(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—'
  if (sec < 60) return `${Math.floor(sec)}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/**
 * How long a live surface may go without a new print before it says so.
 *
 * Three minutes. Not an error — a genuinely quiet name goes minutes between
 * prints and that is information too. It is the line past which "nothing is
 * happening" and "nothing is arriving" stop being distinguishable by looking,
 * so the card stops making the reader guess and prints the age.
 */
export const STALE_AFTER_SEC = 180

/** `+12.3%` / `-4.0%` — the drawer's since-fill figures, which DO carry a `+`. */
export function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

/** `$1.23M` / `$45.6K` / `$7.89` — the drawer's contract-price scale. */
export function fmtUsd(v: number): string {
  const a = Math.abs(v)
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${v.toFixed(2)}`
}

export function fmtNum(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : v.toLocaleString()
}

// ── Directional read ─────────────────────────────────────────────────────────

/** Bullish = buy calls / sell puts. Bearish = sell calls / buy puts. */
export function isBullish(side: string, type: string): boolean {
  const buy = side === 'buy'
  const call = type === 'C'
  return (buy && call) || (!buy && !call)
}

// ── ET session maths ─────────────────────────────────────────────────────────
//
// Every bound below is a WALL-CLOCK ET time converted to UTC seconds, and the
// conversion corrects a UTC guess against the ET offset rather than assuming
// one. That is what makes it survive both DST transitions without a table.

export function etDateParts(now: Date): { y: number; m: number; d: number } {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0')
  return { y: get('year'), m: get('month'), d: get('day') }
}

export function etWallToUtcSec(y: number, m: number, d: number, hh: number, mm: number): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const asET = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'America/New_York' })).getTime()
  const asUTC = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  return Math.floor((guess + (asUTC - asET)) / 1000)
}

/** Today's ET session date as `YYYY-MM-DD`. Matches the server's todayYmdET(). */
export function todayYmdET(): string {
  const { y, m, d } = etDateParts(new Date())
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** RTH (9:30–16:00 ET) for an explicit session date, as UTC seconds. */
export function rthBoundsForYmd(ymd: string): { openSec: number; closeSec: number } {
  const [y, m, d] = ymd.split('-').map(Number)
  return {
    openSec: etWallToUtcSec(y ?? 0, m ?? 1, d ?? 1, 9, 30),
    closeSec: etWallToUtcSec(y ?? 0, m ?? 1, d ?? 1, 16, 0),
  }
}

export function rthBoundsToday(): { openSec: number; closeSec: number } {
  return rthBoundsForYmd(todayYmdET())
}

/**
 * The full ET calendar day (00:00–24:00) for a session date, as UTC seconds.
 *
 * The hard outer clamp for the 24H axis: `flow_prints.date` is stamped with the
 * ET day at write time, so a row on date D can carry any ts inside D — pre-open,
 * RTH, or the Cboe global session in the evening — and nothing outside it.
 */
export function etDayBoundsForYmd(ymd: string): { startSec: number; endSec: number } {
  const [y, m, d] = ymd.split('-').map(Number)
  return {
    startSec: etWallToUtcSec(y ?? 0, m ?? 1, d ?? 1, 0, 0),
    endSec: etWallToUtcSec(y ?? 0, m ?? 1, d ?? 1, 24, 0),
  }
}

/**
 * DTE relative to the SESSION DATE being viewed — NOT to "today".
 *
 * Measuring from today's midnight made every past session's 0DTE flow go
 * negative on lookback (a 7/29 expiry viewed on 7/30 scored −1), so any active
 * DTE filter — including the 0–7DTE ≥$500K preset, whose dteMin of 0 rejects
 * anything negative — silently dropped the whole 0DTE tape for that day. It
 * looked correct live and wrong the moment the date rolled over.
 *
 * Both sides parse as UTC midnight so the subtraction is a clean whole-day
 * count with no DST/offset drift. Keep in step with buildFlowPrintsWhere()'s
 * dteMin/dteMax SQL in server-v2/server-with-proxy.js, which measures against
 * the queried date for the same reason — or the chart and the tape will
 * disagree about what "0DTE" means for a historical date.
 */
export function dteOf(expiration: string | undefined, sessionYmd: string): number | null {
  if (!expiration) return null
  const exp = Date.parse(`${expiration}T00:00:00Z`)
  const base = Date.parse(`${sessionYmd}T00:00:00Z`)
  if (!Number.isFinite(exp) || !Number.isFinite(base)) return null
  return Math.round((exp - base) / 86_400_000)
}

// ── The filter chain ─────────────────────────────────────────────────────────

export type SideFilter = 'all' | 'buy' | 'sell'
export type TypeFilter = 'all' | 'C' | 'P'
export type View = 'ticker' | 'combined'
export type Scope = 'all' | 'exIdx'
export type ChartSpan = 'rth' | '24h'

export interface FlowFilters {
  side: SideFilter
  optType: TypeFilter
  minPremium: number
  minSize: number
  expiry: string
  dteMin: number
  dteMax: number | null
  otmOnly: boolean
}

/**
 * Everything except the ticker/scope gate, which the caller applies first.
 * Order is v2's, and it matters only for cost, not for the answer.
 *
 * Two details that are easy to lose:
 *   • a null DTE is REJECTED whenever any DTE bound is set — an undated print
 *     cannot be shown to satisfy "0 to 7 days";
 *   • `isOtm` is tri-state on the wire, and `!isOtm` correctly rejects null.
 *     An unknown moneyness is not an OTM print.
 */
export function passesFilters(o: FlowTapePrint, f: FlowFilters, sessionYmd: string): boolean {
  if (f.side !== 'all' && o.side !== f.side) return false
  if (f.optType !== 'all' && o.type !== f.optType) return false
  if (f.otmOnly && !o.isOtm) return false
  if (Number(o.premium || 0) < f.minPremium) return false
  if (Number(o.size || 0) < f.minSize) return false
  if (f.expiry !== 'all' && o.expiration !== f.expiry) return false
  if (f.dteMin > 0 || f.dteMax != null) {
    const d = dteOf(o.expiration, sessionYmd)
    if (d == null) return false
    if (d < f.dteMin) return false
    if (f.dteMax != null && d > f.dteMax) return false
  }
  return true
}

/** The coalescing key. Same identity flow_prints uses as its PRIMARY KEY. */
export function printIdentity(o: FlowTapePrint): string {
  return `${o.ts}|${o.symbol}|${o.side}`
}

/**
 * Persisted ∪ live, deduped by coalescing key with LIVE WINNING, ascending by
 * ts. Live is only merged for today: on a historical date the socket is still
 * pushing the current session and must not bleed into it.
 */
export function mergeTape(
  history: readonly FlowTapePrint[],
  live: readonly FlowTapePrint[],
  isToday: boolean,
): FlowTapePrint[] {
  const byKey = new Map<string, FlowTapePrint>()
  for (const o of history) byKey.set(printIdentity(o), o)
  if (isToday) for (const o of live) byKey.set(printIdentity(o), o)
  return [...byKey.values()].sort((a, b) => a.ts - b.ts)
}

// ── Net drift ────────────────────────────────────────────────────────────────

export interface NetBin {
  sec: number
  callNet: number
  putNet: number
  callVol: number
  putVol: number
  /**
   * The underlying's level during this minute — the mean of `spot` over the
   * bin's prints, which is that minute's level (spot is stamped identically on
   * every print in a minute). Absent when no print in the bin carried one.
   *
   * Served by /proxy/flow-netprem. It rides in the SAME aggregate as the drift
   * numbers on purpose: see buildSpotSeries.
   */
  spot?: number
}

export interface NetPoint {
  time: number
  /** Absent = whitespace: the axis spans here but there is no value yet. */
  value?: number
}
export interface VolPoint extends NetPoint {
  /** 'up' when calls led the minute (ties count as up), 'down' otherwise. */
  lean?: 'up' | 'down'
}

export interface NetSeries {
  callPts: NetPoint[]
  putPts: NetPoint[]
  volPts: VolPoint[]
  lastCall: number
  lastPut: number
  openSec: number
  closeSec: number
  hasData: boolean
  byBin: Map<number, NetBin>
}

/**
 * Walk the server's per-minute aggregate into cumulative net-drift lines on a
 * fixed grid.
 *
 * The grid is the point. Fixed 1-minute bins across [openSec, closeSec] give a
 * proportional axis that spans the whole session BEFORE the data fills it —
 * bins up to "now" carry the running total, later bins are whitespace. Letting
 * the chart fit its content instead would re-scale the axis on every poll and
 * float the day's shape to the right.
 *
 * RTH span = the classic hardcoded 9:30–4:00 grid.
 * 24H span = widened to the extent of the bins the server actually returned,
 *   clamped to the ET calendar day so one mis-stamped ts cannot stretch the
 *   axis across a week, then SNAPPED to the bin grid — the loop steps by
 *   BIN_SEC from openSec, and an unaligned start would miss every bin by a
 *   constant offset. RTH always stays inside the window, so the familiar
 *   9:30–4:00 shape is still there.
 *
 * 24H exists because SPX now trades nearly around the clock: a day whose only
 * prints landed at 08:58 and 21:30 drew as a flat zero line on the RTH grid,
 * which silently discarded both.
 */
export function buildNetSeries(
  netBins: readonly NetBin[],
  opts: { isToday: boolean; date: string; chartSpan: ChartSpan; now?: number },
): NetSeries {
  const rth = opts.isToday ? rthBoundsToday() : rthBoundsForYmd(opts.date)
  let openSec = rth.openSec
  let closeSec = rth.closeSec

  if (opts.chartSpan === '24h') {
    const day = etDayBoundsForYmd(opts.isToday ? todayYmdET() : opts.date)
    let lo = openSec
    let hi = closeSec
    for (const b of netBins) {
      if (b.sec >= day.startSec && b.sec < lo) lo = b.sec
      if (b.sec <= day.endSec && b.sec > hi) hi = b.sec
    }
    openSec = Math.floor(lo / BIN_SEC) * BIN_SEC
    closeSec = Math.ceil(hi / BIN_SEC) * BIN_SEC
  }

  const byBin = new Map<number, NetBin>()
  for (const b of netBins) byBin.set(b.sec, b)
  const hasData = netBins.length > 0

  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000)

  // ── The fill horizon. ──
  //
  // Whitespace exists for ONE reason: to hold the axis open across the part of
  // the session that has not happened yet. It must never open a hole in the
  // middle of a line, and `nowSec` on its own is not a safe edge for that.
  //
  // This is v2's recurring "gaps in the chart" bug and it has two causes, both
  // of which put REAL bins past "now":
  //
  //   • Clock skew. `nowSec` is the BROWSER's clock. A machine a few minutes
  //     behind the server turned every bin in that window into whitespace — a
  //     break in the line that opened and closed as the clock drifted, which is
  //     exactly the "ever so often" part.
  //   • The late-print re-scan. The server re-stamps late prints back into
  //     their own minute (NET_LATE_SEC), so a poll can legitimately return a
  //     bin stamped ahead of where the client thinks the session edge is.
  //
  // So the horizon is the LATER of the clock edge and the last bin that
  // actually carries data. Past that, everything is genuinely future and draws
  // as whitespace. A bin holding data is also never whitespaced regardless —
  // see the `b` test in the loop.
  let lastDataSec = -Infinity
  for (const b of netBins) if (b.sec > lastDataSec) lastDataSec = b.sec
  const horizon = Math.max(nowSec + BIN_SEC, lastDataSec)

  const callPts: NetPoint[] = []
  const putPts: NetPoint[] = []
  const volPts: VolPoint[] = []
  let call = 0
  let put = 0

  for (let t = openSec; t <= closeSec; t += BIN_SEC) {
    const b = byBin.get(t)
    if (b) {
      call += b.callNet
      put += b.putNet
    }
    if (b || t <= horizon) {
      callPts.push({ time: t, value: call })
      putPts.push({ time: t, value: put })
      const cv = b ? b.callVol : 0
      const pv = b ? b.putVol : 0
      volPts.push({ time: t, value: cv + pv, lean: cv >= pv ? 'up' : 'down' })
    } else {
      callPts.push({ time: t })
      putPts.push({ time: t })
      volPts.push({ time: t })
    }
  }

  return { callPts, putPts, volPts, lastCall: call, lastPut: put, openSec, closeSec, hasData, byBin }
}

// ── Spot overlay ─────────────────────────────────────────────────────────────

export interface SpotSeries {
  /**
   * On the drift chart's exact minute grid: a value at every minute from the
   * first bin that carried a level up to the fill horizon, whitespace either
   * side. See buildSpotSeries.
   */
  pts: NetPoint[]
  /** Newest level in the window, 0 when no bin carried one. */
  last: number
}

/** Half-width of the keep band, in MADs. See buildSpotSeries. */
const SPOT_MAD_K = 8
/** Floor on the keep band as a fraction of the median, for a quiet session. */
const SPOT_BAND_MIN = 0.015
/** Ceiling on the keep band. Nothing legitimate is ±12% intraday on an index. */
const SPOT_BAND_MAX = 0.12

function median(sorted: readonly number[]): number {
  const n = sorted.length
  if (n === 0) return 0
  const mid = n >> 1
  return n % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

/**
 * The underlying's own path across the session, for the Net Drift overlay.
 *
 * ── Same rows, same grid, same span as the drift lines ───────────────────────
 *
 * This reads /proxy/flow-netprem's per-bin `spot` — the SAME aggregate, over
 * the SAME rows, that buildNetSeries walks into the call and put lines. That is
 * the whole point of it living here rather than in a second fetch.
 *
 * It used to be derived from the raw tape (/proxy/flow-history), and that tape
 * is capped at the newest 20k rows. On a busy ticker the cap lands mid-morning,
 * so the overlay began at 10:50 while the drift lines — fed by the uncapped
 * aggregate — began at 9:30: two lines on one x-axis covering different spans.
 * Reading the bins removes the possibility rather than papering over it, since
 * there is now exactly one source for where this chart's minutes are.
 *
 * ── The grid ─────────────────────────────────────────────────────────────────
 *
 * Identical walk to buildNetSeries: openSec → closeSec in BIN_SEC steps, values
 * up to the same horizon (the later of the clock edge and the last bin holding
 * data, so a skewed browser clock or a late-stamped print cannot punch a hole),
 * whitespace past it. A minute with no print carries the last known level
 * forward rather than being dropped — the level did not stop existing because
 * nobody traded, and a held value keeps the line on the grid instead of letting
 * the series interpolate a straight diagonal across the gap.
 *
 * Nothing is held BACKWARD: before the first bin that carried a spot there is
 * whitespace, not a flat lead-in inventing an opening level.
 *
 * ── Why the outlier band survived the rewrite ────────────────────────────────
 *
 * `spot` is not clean. flow-processor.js writes whatever the underlying quote
 * said at coalesce time, and a stuck quote has already mislabelled a whole
 * midday SPX session once (see the ⚠ note on `isOtm` in contract/frames.ts).
 * The server's per-bin mean handles a single bad print inside a minute; it does
 * nothing about a minute that is wholly wrong, and because the overlay is
 * autoscaled ONE 2× outlier flattens the real intraday range into a straight
 * line and draws the rest as square-wave spikes.
 *
 * So the session-level pass stays: take the median of the per-minute levels,
 * then the median absolute deviation from it, and keep only minutes within
 * SPOT_MAD_K MADs. MAD rather than a fixed percent because it ADAPTS — a
 * wide-range day widens the band on its own, so a real selloff is not clipped.
 * Clamped to [1.5%, 12%] of the median so a dead-flat session cannot collapse
 * the band to nothing and an outlier-heavy one cannot blow it wide open.
 *
 * A rejected minute is dropped, not replaced with a guess; the carry-forward
 * then bridges it with the last level that passed.
 */
export function buildSpotSeries(
  netBins: readonly NetBin[],
  opts: { openSec: number; closeSec: number; now?: number },
): SpotSeries {
  // ── Pass 1: the bins that carry a level, on the grid. ──
  const byBin = new Map<number, number>()
  for (const b of netBins) {
    const v = b.spot
    if (v == null || !Number.isFinite(v) || v <= 0) continue
    const sec = Math.floor(b.sec / BIN_SEC) * BIN_SEC
    if (sec < opts.openSec || sec > opts.closeSec) continue
    byBin.set(sec, v)
  }
  if (byBin.size === 0) return { pts: [], last: 0 }

  // ── Pass 2: the robust band. ──
  const vals = [...byBin.values()].sort((a, b) => a - b)
  const med = median(vals)
  const mad = median(vals.map((v) => Math.abs(v - med)).sort((a, b) => a - b))
  const tol = Math.min(
    med * SPOT_BAND_MAX,
    Math.max(mad * SPOT_MAD_K, med * SPOT_BAND_MIN),
  )
  for (const [sec, v] of [...byBin]) if (Math.abs(v - med) > tol) byBin.delete(sec)
  if (byBin.size === 0) return { pts: [], last: 0 }

  // ── Pass 3: the same walk buildNetSeries makes. ──
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000)
  let lastDataSec = -Infinity
  for (const sec of byBin.keys()) if (sec > lastDataSec) lastDataSec = sec
  const horizon = Math.max(nowSec + BIN_SEC, lastDataSec)

  const pts: NetPoint[] = []
  let held: number | undefined
  let last = 0
  for (let t = opts.openSec; t <= opts.closeSec; t += BIN_SEC) {
    const v = byBin.get(t)
    if (v !== undefined) {
      held = v
      last = v
    }
    if (held !== undefined && (v !== undefined || t <= horizon)) pts.push({ time: t, value: held })
    else pts.push({ time: t })
  }

  return { pts, last }
}

// ── Totals ───────────────────────────────────────────────────────────────────

export interface PremSplit {
  count: number
  prem: number
  buyCall: number
  buyPut: number
  sellCall: number
  sellPut: number
}

export interface Totals extends PremSplit {
  callPrem: number
  putPrem: number
}

/** Sum the four buy/sell × call/put buckets over a filtered set of rows. */
export function sumTotals(rows: readonly FlowTapePrint[]): Totals {
  let prem = 0
  let callPrem = 0
  let putPrem = 0
  let buyCall = 0
  let buyPut = 0
  let sellCall = 0
  let sellPut = 0
  for (const o of rows) {
    const p = o.premium || 0
    prem += p
    if (o.type === 'C') {
      callPrem += p
      if (o.side === 'buy') buyCall += p
      else sellCall += p
    } else {
      putPrem += p
      if (o.side === 'buy') buyPut += p
      else sellPut += p
    }
  }
  return { count: rows.length, prem, callPrem, putPrem, buyCall, buyPut, sellCall, sellPut }
}

/** The SQL split, widened to the two derived columns the tape header shows. */
export function totalsFromSplit(s: PremSplit): Totals {
  return {
    ...s,
    callPrem: s.buyCall + s.sellCall,
    putPrem: s.buyPut + s.sellPut,
  }
}

// ── Recents (browser-cached) ─────────────────────────────────────────────────

export function loadRecentTickers(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_TICKERS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr)
      ? arr.filter((t): t is string => typeof t === 'string').slice(0, RECENT_TICKERS_MAX)
      : []
  } catch {
    return []
  }
}

export function pushRecentTicker(list: readonly string[], ticker: string): string[] {
  const t = ticker.toUpperCase()
  const next = [t, ...list.filter((x) => x !== t)].slice(0, RECENT_TICKERS_MAX)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(RECENT_TICKERS_KEY, JSON.stringify(next))
    } catch {
      /* quota — a lost recents list is not worth an error */
    }
  }
  return next
}
