// ─────────────────────────────────────────────────────────────────────────────
// CB EDGE STUDIES — options flow on the chart: Net Premium and Vol / GEX Flow
// panes, and whale prints as markers. Vela native studies (common.ts).
//
//   Net Premium    the Net Premium card's lines in a pane under the chart:
//                  cumulative call premium, put premium and net (calls − puts)
//                  through each session, off the same per-minute bins
//                  (/proxy/flow-netprem — SQL over the whole session, not the
//                  tape's row cap). Past sessions are fetched once.
//                  SEVEN SESSIONS, EACH FROM 0 AT THE OPEN (2026-10-06,
//                  Brandon): up to 7 sessions back (the server keeps a per-
//                  minute archive of each finished day — flow_netprem_archive),
//                  and every session's lines start at 0 on the 09:30 ET open;
//                  anything printed before the open is left out.
//                  ES / NQ: THE GLOBEX NIGHT TOO (2026-10-09, Brandon: "net
//                  premium for es should show spx and should show overnight but
//                  at 9:30 open only show rth and start from 0. same with nq with
//                  ndx"). On a futures chart each futures session is two runs:
//                  the NIGHT from the 18:00 ET Globex open to 09:30 (SPX / NDX
//                  prints in that window — the index options' overnight
//                  session), from 0 at 18:00; then RTH from 0 again at 09:30, the
//                  night left out, running on to the 17:00 futures close. The
//                  runs are separate lines (two lanes, alternating), so the
//                  09:30 reset is a clean break, not a drop drawn across it; a
//                  readout series off the plot carries the whole line for the
//                  legend and the data window. A night with no recorded prints
//                  draws nothing. Bins are read by ET date as before (a night
//                  spans two), merged and placed by their own minute.
//                  ONE OR THE OTHER (2026-10-05, Brandon): "Calls and puts" on
//                  draws the calls line and the puts line and no net line; off,
//                  the net line alone (green above zero, red below).
//   Vol/GEX Flow   the Vol/GEX Flow card's series (/proxy/gex-vol-flow) in a
//                  pane: volume GEX as a histogram (green / red), OI GEX and the
//                  combined line — today's session, as the card.
//   Net GEX Flow   NET GEX FLOW (2026-10-07, Brandon): how net GEX is MOVING,
//                  not where it stands. Off the same /proxy/gex-vol-flow series,
//                  on the page's GEX switch (OI only / OI + Vol / Vol only):
//                  a histogram of each bar's change in net GEX (green: GEX added,
//                  red: GEX taken off) and a line of the change since the
//                  session's first reading. Today's session, as the card.
//   Net GEX        NET GEX (2026-10-07, Brandon): the ticker's overall net GEX
//                  through the day — every strike summed (all expiries by
//                  default), on the page's GEX switch — as a line, columns or
//                  both. Same series as Net GEX Flow: this is the level, that is
//                  its change.
//   Whale Prints   ≥ $1M option prints (/api/lse/whales — the Whales page's own
//                  feed, kept forever) as BUBBLES centred on the moment each
//                  ... TODAY ONLY BY DEFAULT (2026-10-07, Brandon): Days back
//                  counts trading days including today, so 1 is today's
//                  session (it used to reach back to yesterday's date too), and
//                  a Buys / sells setting shows only bought or only sold prints.
//                  On ES / NQ a day is the futures session (2026-10-09): from
//                  18:00 ET the evening before, so the night's SPX / NDX prints
//                  show on the Globex candles too. Strikes (2026-10-09, Brandon:
//                  "needs a OTM or all filter"): All strikes, or OTM only —
//                  calls struck at or above the underlying's price when they
//                  printed, puts at or below, the same test as the card's OTM
//                  cell. A print with no recorded spot is judged on its candle's
//                  close (on ES / NQ less that session's basis); with neither,
//                  OTM only leaves it out. A repaint, not a new read.
//                  printed and the underlying's price then, sized by premium:
//                  green bullish (calls bought, puts sold), red bearish, grey
//                  when the side is unknown.
//                  Hover for a short card of the prints. Drawn by a renderer
//                  layer — whaleLayer.ts, which has the size table. Bubble
//                  opacity % sets how solid the fill is (30 by default).
//                  Price zone (2026-10-10, Brandon: "a small box extending from
//                  the bubble high / low to the right"): a band as tall as the
//                  bubble, from its centre to the chart's right edge, in its
//                  colour — On hover (the default) for the bubble under the
//                  pointer, Every bubble, or Off. Drawn by the layer in pixels,
//                  so it stays the bubble's height at any zoom.
//
// ES charts read SPX's flow, NQ charts NDX's — the futures have no options here.
// ─────────────────────────────────────────────────────────────────────────────

import type { OHLCV, PriceLine, SeriesSpec } from '@luxalgo/vela'
import { tokenHexAlpha } from '@/design/theme'
import { DAY_MS, FUT_OPEN, RTH_OPEN, barAt, bool, studyImpl, etDateKey, etMinutesOfDay, etWallMs, getJson, int, money, provideLayer, seriesOf, sessionKey, sessionsOf, str, type StudyCtx } from './common'
import { stableSeriesId } from '@luxalgo/vela/plugin'
import { NETGEXFLOW_TYPE, NETGEX_STYLES, NETGEX_TYPE, NETPREM_TYPE, NP_MIN as MIN_PREM, VF_SCOPES as SCOPES, VF_SESSIONS as SESS, VOLFLOW_TYPE, WHALES_TYPE, WH_ACTION, WH_CAP, WH_EXP, WH_MIN, WH_MONEY, WH_OPACITY_DEF, WH_SIDE, WH_ZONE } from './index'
import { gexBasis, gexBasisShort } from '@/pages/vela/gexBasis'
import { WhaleLayer, type Tone, type WhaleBubble, type WhaleContext, type WhaleCtxLine, type WhalePayload } from './whaleLayer'
import { isPlausibleBasis, type BasisModel } from '@/board/gexCandles/basis'
import { loadBasis } from '@/pages/vela/wallsIndicator'

export const flowTicker = (c: StudyCtx) => (c.sym.fut === 'NQ' ? 'NDX' : c.sym.fut === 'ES' ? 'SPX' : c.sym.key)

// ═════════════════════════════════════════════════════════════════════════════
// Net Premium
// ═════════════════════════════════════════════════════════════════════════════


interface Bin {
  sec: number
  callNet: number
  putNet: number
}
interface NpS {
  sessions: number
  legs: boolean
  otm: boolean
  minPremium: number
}
const MIN_PREM_V = [1_000, 25_000, 100_000, 500_000]

/** Finished sessions never change: one read each per page. */
const pastBins = new Map<string, Bin[]>()
/**
 * Reads still out, by URL, shared by every chart and every re-read (2026-10-06):
 * three charts × 7 sessions each, re-asked every 15 s while the server was slow,
 * stacked dozens of the same full-session query and the pane never filled.
 */
const pending = new Map<string, Promise<Bin[] | null>>()
/** A past session whose read failed is not asked again for this long. */
const RETRY_PAST_MS = 60_000
const failedAt = new Map<string, number>()

/**
 * One request per URL at a time, shared by every chart asking (2026-10-06: the
 * same Whale Prints read from four charts sat in the database together, 34 s each).
 */
const sharedPending = new Map<string, Promise<unknown>>()
/** Whale Prints ranges already read whole once (later reads skip the today-first step). */
const wholeRangeRead = new Set<string>()

/**
 * An answer is ALSO reused for SHARE_MS after it lands (2026-10-10, audit "300
 * users"). Sharing only the request in flight left three studies on the same URL
 * — Vol/GEX Flow and the two drawn off its series, each on its own 15 s timer —
 * sending three requests a cycle, because their timers almost never fire in the
 * same instant. SHARE_MS is under every caller's refresh, so each still gets an
 * answer from this cycle; the ones a few seconds apart now share one.
 */
const SHARE_MS = 10_000
const recent = new Map<string, { at: number; p: Promise<unknown> }>()
function remember(url: string, p: Promise<unknown>): void {
  void p.then(() => {
    recent.set(url, { at: Date.now(), p })
    if (recent.size > 200) {
      const cut = Date.now() - SHARE_MS
      for (const [k, v] of recent) if (v.at < cut) recent.delete(k)
    }
  })
}
function recentHit<T>(url: string): Promise<T> | null {
  const hit = recent.get(url)
  return hit && Date.now() - hit.at < SHARE_MS ? (hit.p as Promise<T>) : null
}

function sharedJson<T>(url: string): Promise<T | null> {
  const held = recentHit<T | null>(url)
  if (held) return held
  let p = sharedPending.get(url) as Promise<T | null> | undefined
  if (!p) {
    p = getJson<T>(url).finally(() => sharedPending.delete(url))
    sharedPending.set(url, p)
    remember(url, p)
  }
  return p
}

function readBins(url: string): Promise<Bin[] | null> {
  const held = recentHit<Bin[] | null>(url)
  if (held) return held
  let p = pending.get(url)
  if (!p) {
    p = getJson<{ bins?: { sec?: unknown; callNet?: unknown; putNet?: unknown }[] }>(url)
      .then((j) =>
        j
          ? (j.bins ?? [])
              .map((b) => ({ sec: Number(b.sec), callNet: Number(b.callNet) || 0, putNet: Number(b.putNet) || 0 }))
              .filter((b) => Number.isFinite(b.sec))
              .sort((a, b) => a.sec - b.sec)
          : null,
      )
      .finally(() => pending.delete(url))
    pending.set(url, p)
    remember(url, p)
  }
  return p
}

/** The filters a flow-bins read takes. */
interface BinFilter {
  sessions: number
  otm: boolean
  minPremium: number
}

const binsKey = (c: StudyCtx, s: BinFilter) => `${flowTicker(c)}|${s.sessions}|${s.otm}|${s.minPremium}`

/** The ET calendar date before `date` (YYYY-MM-DD). */
function dayBefore(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - 1)).toISOString().slice(0, 10)
}

/**
 * The ET dates whose bins a chart needs. Cash: one per session. A future: each
 * futures session D (18:00 the evening before to 17:00) is the night of D − 1
 * and the day of D, so both dates — never one later than today.
 */
function binDates(c: StudyCtx, sessions: number): string[] {
  const today = etDateKey(Date.now())
  if (!c.sym.fut) {
    const dates = sessionsOf(c.bars, (x) => etDateKey(x))
      .map((x) => x.key)
      .slice(-sessions)
    if (!dates.includes(today) && c.ctx.live) dates.push(today)
    return dates
  }
  const keys = sessionsOf(c.bars, (x) => sessionKey(x, true))
    .map((x) => x.key)
    .slice(-sessions)
  const live = sessionKey(Date.now(), true)
  if (!keys.includes(live) && c.ctx.live) keys.push(live)
  return [...new Set(keys.flatMap((k) => [dayBefore(k), k]))].filter((d) => d <= today).sort()
}

/** Each session's per-minute flow bins, by ET date (/proxy/flow-netprem). */
async function loadBins(c: StudyCtx, s: BinFilter): Promise<Map<string, Bin[]>> {
  const t = flowTicker(c)
  const today = etDateKey(Date.now())
  const dates = binDates(c, s.sessions)
  const out = new Map<string, Bin[]>()
  const urlOf = (d: string) =>
    `/proxy/flow-netprem?underlying=${encodeURIComponent(t)}&bin=60&date=${d}&minPremium=${s.minPremium}${s.otm ? '&otmOnly=1' : ''}`
  /** One session's bins into `out` (a past one kept for the page); true when it came back. */
  const fetchDay = async (d: string): Promise<boolean> => {
    const url = urlOf(d)
    const past = d !== today
    const cached = past ? pastBins.get(url) : undefined
    if (cached) {
      out.set(d, cached)
      return false
    }
    if (past && Date.now() - (failedAt.get(url) ?? 0) < RETRY_PAST_MS) return false
    const bins = await readBins(url)
    if (!bins) {
      if (past) failedAt.set(url, Date.now())
      return false
    }
    out.set(d, bins)
    if (past) pastBins.set(url, bins)
    return true
  }
  // TODAY FIRST (2026-10-06, load times): live, the chart waits only for today
  // and the past sessions already read; the others are fetched behind it and the
  // study repaints with them when they land. In a replay every session is awaited.
  const later = c.ctx.live ? dates.filter((d) => d !== today && !pastBins.has(urlOf(d))) : []
  await Promise.all(dates.filter((d) => !later.includes(d)).map(fetchDay))
  if (later.length) {
    void Promise.all(later.map(fetchDay)).then((got) => {
      if (got.some(Boolean)) c.refresh?.()
    })
  }
  return out
}

/**
 * Two running totals through each session on the chart, each from 0 at the
 * 09:30 ET open (prints before it are left out), one value per bar: `a` and `b`
 * are what a bin adds to each. Bars with no bin yet stay null.
 */
function cumulate(
  bars: readonly OHLCV[],
  tfMs: number,
  data: Map<string, Bin[]>,
  a: (b: Bin) => number,
  b: (b: Bin) => number,
): { a: (number | null)[]; b: (number | null)[] } {
  const n = bars.length
  const outA = new Array<number | null>(n).fill(null)
  const outB = new Array<number | null>(n).fill(null)
  for (const ss of sessionsOf(bars, (x) => etDateKey(x))) {
    const bins = data.get(ss.key)
    if (!bins?.length) continue
    const openMs = etWallMs(ss.key, 9 * 60 + 30)
    let k = 0
    while (k < bins.length && bins[k]!.sec * 1000 < openMs) k++
    let ca = 0
    let cb = 0
    let seen = false
    for (let i = ss.from; i <= ss.to; i++) {
      if (bars[i]!.time + tfMs <= openMs) continue
      const end = bars[i]!.time + tfMs
      while (k < bins.length && bins[k]!.sec * 1000 < end) {
        ca += a(bins[k]!)
        cb += b(bins[k]!)
        k++
        seen = true
      }
      if (!seen) continue
      outA[i] = ca
      outB[i] = cb
      if (k >= bins.length && bars[i]!.time > bins[bins.length - 1]!.sec * 1000 + 30 * 60_000) break
    }
  }
  return { a: outA, b: outB }
}

/**
 * ES / NQ (see the header): two running totals per futures session — the night
 * from 0 at the 18:00 ET Globex open to 09:30, then RTH from 0 at 09:30 to the
 * session's end — plus each bar's run number (`seg`, consecutive runs alternate
 * parity), so the runs draw as separate lines. Bins come from every date read,
 * merged by minute; a bar straddling 09:30 only takes the night's bins.
 */
export function cumulateFut(
  bars: readonly OHLCV[],
  tfMs: number,
  data: Map<string, Bin[]>,
  a: (b: Bin) => number,
  b: (b: Bin) => number,
): { a: (number | null)[]; b: (number | null)[]; seg: number[] } {
  const n = bars.length
  const outA = new Array<number | null>(n).fill(null)
  const outB = new Array<number | null>(n).fill(null)
  const seg = new Array<number>(n).fill(-1)
  // every date's bins, one per minute (a night's prints sit under two ET dates)
  const merged = new Map<number, Bin>()
  for (const bins of data.values()) {
    for (const x of bins) {
      const m = merged.get(x.sec)
      if (m) {
        m.callNet += x.callNet
        m.putNet += x.putNet
      } else merged.set(x.sec, { ...x })
    }
  }
  const bins = [...merged.values()].sort((p, q) => p.sec - q.sec)
  if (!bins.length) return { a: outA, b: outB, seg }
  /** The first bin at or after `ms`. */
  const firstFrom = (ms: number) => {
    let lo = 0
    let hi = bins.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (bins[mid]!.sec * 1000 < ms) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  let runKey = ''
  let run = -1
  let segEnd = 0
  let k = 0
  let ca = 0
  let cb = 0
  let seen = false
  for (let i = 0; i < n; i++) {
    const t = bars[i]!.time
    const d = sessionKey(t, true)
    const rth = etDateKey(t) === d && etMinutesOfDay(t) >= RTH_OPEN
    const key = `${d}|${rth ? 'r' : 'n'}`
    if (key !== runKey) {
      runKey = key
      run++
      const start = rth ? etWallMs(d, RTH_OPEN) : etWallMs(dayBefore(d), FUT_OPEN)
      segEnd = rth ? etWallMs(d, FUT_OPEN) : etWallMs(d, RTH_OPEN)
      k = firstFrom(start)
      ca = 0
      cb = 0
      seen = false
    }
    const end = Math.min(t + tfMs, segEnd)
    while (k < bins.length && bins[k]!.sec * 1000 < end) {
      ca += a(bins[k]!)
      cb += b(bins[k]!)
      k++
      seen = true
    }
    if (!seen) continue
    outA[i] = ca
    outB[i] = cb
    seg[i] = run
  }
  return { a: outA, b: outB, seg }
}

/**
 * One line drawn as runs (ES / NQ Net Premium): its values on two lanes by the
 * run's parity, so no segment is drawn across a reset, and a readout series off
 * the plot under the line's own id, for the legend and the data window. Only
 * the lane holding the newest value shows its price chip.
 */
export function runSeries(
  type: string,
  key: string,
  ordinal: number,
  title: string,
  bars: readonly OHLCV[],
  values: readonly (number | null)[],
  seg: readonly number[],
  color: string,
  o: { width?: number; colors?: readonly (string | null)[] } = {},
): SeriesSpec[] {
  let newest = -1
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] != null) {
      newest = seg[i]! % 2
      break
    }
  }
  const out: SeriesSpec[] = []
  for (const lane of [0, 1]) {
    const vals = values.map((v, i) => (v != null && seg[i]! >= 0 && seg[i]! % 2 === lane ? v : null))
    if (!vals.some((v) => v != null)) continue
    const s = seriesOf(type, `${key}~${lane}`, 10 + ordinal * 2 + lane, title, bars, vals, color, { kind: 'line', width: o.width, colors: o.colors })
    out.push({
      ...s,
      id: stableSeriesId({ instanceId: type, kind: 'line', title: `${key}~${lane}`, ordinal: 10 + ordinal * 2 + lane }),
      display: { pane: true, priceScale: lane === newest, legend: false, dataWindow: false },
    })
  }
  out.push({
    ...seriesOf(type, key, ordinal, title, bars, values, color, { kind: 'line', width: o.width, colors: o.colors }),
    display: { pane: false, priceScale: false, legend: true, dataWindow: true },
  })
  return out
}

export const netPremImpl = studyImpl<NpS, Map<string, Bin[]>>({
  settings: (i) => ({
    sessions: int(i.sessions, 1, 1, 7),
    legs: bool(i.legs, true),
    otm: bool(i.otm, true),
    minPremium: MIN_PREM_V[Math.max(0, (MIN_PREM as readonly string[]).indexOf(str(i.min, MIN_PREM[0])))] ?? 1_000,
  }),
  dataKey: binsKey,
  load: loadBins,
  refreshMs: 15_000,
  render: (c, s, data) => {
    const { bars, tfMs } = c
    if (!bars.length || !data || tfMs >= DAY_MS) return {}
    // ES / NQ: the night, then RTH from 0 at 09:30 (header); cash: from 0 at the open
    const fut = !!c.sym.fut
    const { a: calls, b: puts, seg } = fut
      ? cumulateFut(bars, tfMs, data, (b) => b.callNet, (b) => b.putNet)
      : { ...cumulate(bars, tfMs, data, (b) => b.callNet, (b) => b.putNet), seg: null }
    const up = tokenHexAlpha('--color-up', 1)
    const down = tokenHexAlpha('--color-down', 1)
    const net = calls.map((v, i) => (v == null ? null : v - puts[i]!))
    const netC = net.map((v) => (v == null ? null : v >= 0 ? up : down))
    const T = NETPREM_TYPE
    const series: SeriesSpec[] = []
    if (seg && net.some((v) => v != null)) {
      if (s.legs) {
        series.push(...runSeries(T, 'calls', 1, 'Calls', bars, calls, seg, up, { width: 1.6 }))
        series.push(...runSeries(T, 'puts', 2, 'Puts', bars, puts, seg, down, { width: 1.6 }))
      } else {
        series.push(...runSeries(T, 'net', 0, 'Net', bars, net, seg, up, { width: 2, colors: netC }))
      }
    } else if (net.some((v) => v != null)) {
      // one or the other: the calls and puts lines, or the net line, never all three
      if (s.legs) {
        series.push(seriesOf(T, 'calls', 1, 'Calls', bars, calls, up, { kind: 'line', width: 1.6 }))
        series.push(seriesOf(T, 'puts', 2, 'Puts', bars, puts, down, { kind: 'line', width: 1.6 }))
      } else {
        series.push(seriesOf(T, 'net', 0, 'Net', bars, net, up, { kind: 'line', width: 2, colors: netC }))
      }
    }
    const priceLines: PriceLine[] = [{ id: `${T}:zero`, paneId: '', price: 0, color: tokenHexAlpha('--color-muted', 0.35), width: 1, lineStyle: 'dashed' }]
    return { series, priceLines }
  },
})

// ═════════════════════════════════════════════════════════════════════════════
// Vol / GEX Flow
// ═════════════════════════════════════════════════════════════════════════════


interface VfS {
  front: boolean
  eth: boolean
  bin: number
  oi: boolean
  combined: boolean
}
interface VfPoint {
  ts: number
  volGex: number
  oiGex: number
  combined: number
}

/**
 * Today's Vol/GEX Flow series (/proxy/gex-vol-flow); one request per URL at a time, shared.
 * ES / NQ (2026-10-09, Brandon: "all indicators for voltick category should show
 * es overnight or globex session"): always `session=globex` — from 18:00 ET the
 * evening before, so the night, the cash session and this evening all draw on the
 * futures candles. The Session input is a cash chart's choice.
 */
async function readVolFlow(c: StudyCtx, front: boolean, eth: boolean, bin: number): Promise<VfPoint[]> {
  const t = flowTicker(c)
  const symbol = t === 'SPX' || t === 'NDX' || t === 'RUT' ? `$${t}` : t
  const session = c.sym.fut ? 'globex' : eth ? 'eth' : 'rth'
  const j = await sharedJson<{ ok?: boolean; points?: Record<string, unknown>[] }>(
    `/proxy/gex-vol-flow?bin=${bin}&session=${session}&scope=${front ? 'front' : 'all'}&symbol=${encodeURIComponent(symbol)}`,
  )
  if (!j || j.ok === false || !Array.isArray(j.points)) return []
  return j.points
    .map((p) => ({ ts: Number(p.ts), volGex: Number(p.volGex), oiGex: Number(p.oiGex), combined: Number(p.combined) }))
    .filter((p) => Number.isFinite(p.ts))
    .sort((a, b) => a.ts - b.ts)
}

export const volFlowImpl = studyImpl<VfS, VfPoint[]>({
  settings: (i) => ({
    front: str(i.scope, SCOPES[0]) === SCOPES[1],
    eth: str(i.session, SESS[0]) === SESS[1],
    bin: int(i.bin, 60, 60, 900),
    oi: bool(i.oi, false),
    combined: bool(i.combined, true),
  }),
  dataKey: (c, s) => `${flowTicker(c)}|${c.sym.fut ? 'globex' : s.eth}|${s.front}|${s.bin}`,
  load: (c, s) => readVolFlow(c, s.front, s.eth, s.bin),
  refreshMs: 15_000,
  render: (c, s, pts) => {
    const { bars, tfMs } = c
    if (!bars.length || !pts?.length || tfMs >= DAY_MS) return {}
    const n = bars.length
    const vol = new Array<number | null>(n).fill(null)
    const volC = new Array<string | null>(n).fill(null)
    const oi = new Array<number | null>(n).fill(null)
    const comb = new Array<number | null>(n).fill(null)
    const up = tokenHexAlpha('--color-vt-chart-up', 0.7)
    const dn = tokenHexAlpha('--color-vt-chart-down', 0.7)
    const first = pts[0]!.ts
    const lastTs = pts[pts.length - 1]!.ts
    let k = -1
    for (let i = 0; i < n; i++) {
      const t = bars[i]!.time
      if (t + tfMs <= first) continue
      if (t > lastTs + tfMs) break
      while (k + 1 < pts.length && pts[k + 1]!.ts < t + tfMs) k++
      const p = pts[k]
      if (!p) continue
      if (Number.isFinite(p.volGex)) {
        vol[i] = p.volGex
        volC[i] = p.volGex >= 0 ? up : dn
      }
      if (Number.isFinite(p.oiGex)) oi[i] = p.oiGex
      if (Number.isFinite(p.combined)) comb[i] = p.combined
    }
    const T = VOLFLOW_TYPE
    const series: SeriesSpec[] = [seriesOf(T, 'vol', 0, 'Vol GEX', bars, vol, up, { kind: 'histogram', colors: volC })]
    if (s.oi) series.push(seriesOf(T, 'oi', 1, 'OI GEX', bars, oi, tokenHexAlpha('--color-vt-accent-text', 0.9), { kind: 'line', width: 1.4 }))
    if (s.combined) series.push(seriesOf(T, 'comb', 2, 'Combined', bars, comb, tokenHexAlpha('--color-vt-paper', 0.9), { kind: 'line', width: 1.6 }))
    return { series }
  },
})

// ═════════════════════════════════════════════════════════════════════════════
// Net GEX Flow
// ═════════════════════════════════════════════════════════════════════════════

interface NgS {
  front: boolean
  eth: boolean
  bars: boolean
  line: boolean
}

/** Net GEX on the page's GEX switch, from one Vol/GEX Flow point. */
function netGexOf(p: VfPoint): number {
  const b = gexBasis()
  return b === 'oi' ? p.oiGex : b === 'vol' ? p.volGex : p.combined
}

/**
 * Net GEX at the END of each bar (the last reading inside it), today's bars only:
 * the level the flow is measured off. Null where the series has no reading yet.
 */
export function gexAtBarEnds(bars: readonly { time: number }[], tfMs: number, pts: readonly VfPoint[], of: (p: VfPoint) => number): (number | null)[] {
  const n = bars.length
  const out = new Array<number | null>(n).fill(null)
  if (!pts.length) return out
  const first = pts[0]!.ts
  const lastTs = pts[pts.length - 1]!.ts
  let k = -1
  for (let i = 0; i < n; i++) {
    const t = bars[i]!.time
    if (t + tfMs <= first) continue
    if (t > lastTs) break
    while (k + 1 < pts.length && pts[k + 1]!.ts < t + tfMs) k++
    const p = pts[k]
    if (!p) continue
    const v = of(p)
    if (Number.isFinite(v)) out[i] = v
  }
  return out
}

export const netGexFlowImpl = studyImpl<NgS, VfPoint[]>({
  settings: (i) => ({
    front: str(i.scope, SCOPES[0]) === SCOPES[1],
    eth: str(i.session, SESS[0]) === SESS[1],
    bars: bool(i.bars, true),
    line: bool(i.line, true),
  }),
  // the GEX switch is not in the key: one read carries all three books, a switch only repaints
  dataKey: (c, s) => `${flowTicker(c)}|${s.front}|${c.sym.fut ? 'globex' : s.eth}`,
  load: (c, s) => readVolFlow(c, s.front, s.eth, 60),
  refreshMs: 15_000,
  render: (c, s, pts) => {
    const { bars, tfMs } = c
    if (!bars.length || !pts?.length || tfMs >= DAY_MS) return {}
    const level = gexAtBarEnds(bars, tfMs, pts, netGexOf)
    const n = bars.length
    const delta = new Array<number | null>(n).fill(null)
    const deltaC = new Array<string | null>(n).fill(null)
    const since = new Array<number | null>(n).fill(null)
    const up = tokenHexAlpha('--color-vt-chart-up', 0.7)
    const dn = tokenHexAlpha('--color-vt-chart-down', 0.7)
    // the session's first reading is the zero the line is measured from
    const base = netGexOf(pts[0]!)
    let prev: number | null = null
    for (let i = 0; i < n; i++) {
      const v = level[i]
      if (v == null) continue
      // a bar's flow: the change from the bar before (the first bar: from the first reading)
      const d = v - (prev ?? base)
      delta[i] = d
      deltaC[i] = d >= 0 ? up : dn
      since[i] = v - base
      prev = v
    }
    const T = NETGEXFLOW_TYPE
    const book = gexBasisShort()
    const series: SeriesSpec[] = []
    if (s.bars) series.push(seriesOf(T, 'delta', 0, `Δ net GEX (${book})`, bars, delta, up, { kind: 'histogram', colors: deltaC }))
    if (s.line) series.push(seriesOf(T, 'since', 1, `Since open (${book})`, bars, since, tokenHexAlpha('--color-vt-accent-text', 0.95), { kind: 'line', width: 1.8 }))
    const priceLines: PriceLine[] = [{ id: `${T}:zero`, paneId: '', price: 0, color: tokenHexAlpha('--color-muted', 0.35), width: 1, lineStyle: 'dashed' }]
    return { series, priceLines }
  },
})

// ═════════════════════════════════════════════════════════════════════════════
// Net GEX (the level)
// ═════════════════════════════════════════════════════════════════════════════

interface NlS {
  front: boolean
  eth: boolean
  line: boolean
  cols: boolean
}

export const netGexImpl = studyImpl<NlS, VfPoint[]>({
  settings: (i) => {
    const style = str(i.style, NETGEX_STYLES[0])
    return {
      front: str(i.scope, SCOPES[0]) === SCOPES[1],
      eth: str(i.session, SESS[0]) === SESS[1],
      line: style !== NETGEX_STYLES[1],
      cols: style !== NETGEX_STYLES[0],
    }
  },
  dataKey: (c, s) => `${flowTicker(c)}|${s.front}|${c.sym.fut ? 'globex' : s.eth}`,
  load: (c, s) => readVolFlow(c, s.front, s.eth, 60),
  refreshMs: 15_000,
  render: (c, s, pts) => {
    const { bars, tfMs } = c
    if (!bars.length || !pts?.length || tfMs >= DAY_MS) return {}
    const level = gexAtBarEnds(bars, tfMs, pts, netGexOf)
    const up = tokenHexAlpha('--color-vt-chart-up', 0.75)
    const dn = tokenHexAlpha('--color-vt-chart-down', 0.75)
    const colors = level.map((v) => (v == null ? null : v >= 0 ? up : dn))
    const T = NETGEX_TYPE
    const title = `Net GEX (${gexBasisShort()})`
    const series: SeriesSpec[] = []
    if (s.cols) series.push(seriesOf(T, 'cols', 0, s.line ? `${title} bars` : title, bars, level, up, { kind: 'histogram', colors }))
    if (s.line) series.push(seriesOf(T, 'line', 1, title, bars, level, tokenHexAlpha('--color-vt-accent-text', 0.95), { kind: 'line', width: 2 }))
    const priceLines: PriceLine[] = [{ id: `${T}:zero`, paneId: '', price: 0, color: tokenHexAlpha('--color-muted', 0.35), width: 1, lineStyle: 'dashed' }]
    return { series, priceLines }
  },
})

// ═════════════════════════════════════════════════════════════════════════════
// Whale prints
// ═════════════════════════════════════════════════════════════════════════════


interface WhRow {
  ts: number
  type: 'C' | 'P' | null
  strike: number | null
  expiry: string | null
  size: number | null
  price: number | null
  premium: number
  action: 'BUY' | 'SELL' | null
  underlying: string | null
  /** The underlying's price when it printed. */
  spot: number | null
}
/** The prints, plus — on ES / NQ — each session's basis (SPX / NDX prints sit at index prices). */
interface WhData {
  rows: WhRow[]
  basis: BasisModel | null
  /** ES / NQ: the first futures session's 18:00 ET open — prints before it are the session before's. */
  fromMs?: number
}
interface WhS {
  minPremium: number
  days: number
  side: 'all' | 'C' | 'P'
  /** Bought prints, sold prints, or both. */
  action: 'all' | 'BUY' | 'SELL'
  cap: number
  size: number
  /** Bubble fill opacity, 0.05..1 (the Bubble opacity % setting). */
  fill: number
  text: boolean
  exp: 'all' | '0dte' | 'week' | 'no0dte'
  /** Out-of-the-money prints only (the Strikes setting). */
  otm: boolean
  /** The Price zone setting: a band from the bubble right, for the hovered bubble, every bubble, or none. */
  zone: 'hover' | 'all' | 'off'
}
const WH_MIN_V = [1e6, 2e6, 5e6, 10e6]
const WH_CAP_V = [25e6, 10e6, 50e6, 100e6]
/** Bubble radius bounds, px at 100% (whaleLayer.ts has the table). */
export const R_MIN = 5
export const R_MAX = 26

/** Bullish = call bought / put sold; bearish = put bought / call sold; null when the side is unknown. */
function biasOf(r: WhRow): 1 | -1 | 0 {
  if (!r.action || !r.type) return 0
  return (r.action === 'BUY') === (r.type === 'C') ? 1 : -1
}

/** Area follows premium up to `cap`, never under R_MIN or over R_MAX, then the size setting. */
export function bubbleRadius(premium: number, cap: number, size = 1): number {
  const k = cap > 0 && premium > 0 ? Math.sqrt(premium / cap) : 0
  return Math.max(R_MIN, Math.min(R_MAX, R_MAX * k)) * size
}

/** `$2.4M`, `$12M`, `$850K` — `money` without a trailing `.0`. */
const short = (v: number) => money(v).replace(/\.0(?=[KMB])/, '')

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** `0DTE` on its own expiry day, else `Oct 5` (`Jan 15 ’27` in another year). */
function expiryText(expiry: string | null, printedOn: string): string {
  if (!expiry) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry)
  if (!m) return expiry
  if (expiry.slice(0, 10) === printedOn) return '0DTE'
  const txt = `${MON[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}`
  return m[1] === printedOn.slice(0, 4) ? txt : `${txt} ’${m[1]!.slice(2)}`
}

const strikeText = (k: number | null) => (k == null ? '' : Number.isInteger(k) ? String(k) : String(+k.toFixed(2)))

/** One print as the card says it: `Bought 758 Call · Oct 5`. */
export function printLine(r: WhRow): string {
  const verb = r.action === 'BUY' ? 'Bought' : r.action === 'SELL' ? 'Sold' : ''
  const kind = r.type === 'C' ? 'Call' : r.type === 'P' ? 'Put' : 'option'
  const contract = [verb, strikeText(r.strike), kind].filter(Boolean).join(' ')
  const exp = expiryText(r.expiry, etDateKey(r.ts))
  return exp ? `${contract} · ${exp}` : contract
}

const DAY_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })
const TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
/** `Fri, Oct 2 · 9:55 AM`, or `… · 9:55 – 10:20 AM` when the prints span time. */
function whenText(rows: readonly WhRow[]): string {
  let lo = Infinity
  let hi = -Infinity
  for (const r of rows) {
    lo = Math.min(lo, r.ts)
    hi = Math.max(hi, r.ts)
  }
  const a = TIME_FMT.format(lo)
  const b = TIME_FMT.format(hi)
  // `9:55 – 10:20 AM` within a half of the day, `11:50 AM – 12:10 PM` across noon
  const span = a === b ? a : `${a.slice(-2) === b.slice(-2) ? a.slice(0, -3) : a} – ${b}`
  return `${DAY_FMT.format(lo)} · ${span}`
}

const CARD_ROWS = 5

/** Days from the print's ET date to the expiry (0 = same day; null when unknown). */
function dteOf(r: WhRow): number | null {
  if (!r.expiry) return null
  const e = Date.parse(`${r.expiry.slice(0, 10)}T12:00:00Z`)
  const d = Date.parse(`${etDateKey(r.ts)}T12:00:00Z`)
  return Number.isFinite(e) && Number.isFinite(d) ? Math.round((e - d) / DAY_MS) : null
}

/** The Expiry setting: 0DTE only, this week (expiring by that week's Friday), or skip 0DTE. */
function expOk(r: WhRow, exp: WhS['exp']): boolean {
  if (exp === 'all') return true
  const dte = dteOf(r)
  if (dte == null) return exp === 'no0dte'
  if (exp === '0dte') return dte === 0
  if (exp === 'no0dte') return dte !== 0
  // this week: on or before that week's Friday
  const wd = new Date(`${etDateKey(r.ts)}T12:00:00Z`).getUTCDay()
  return dte >= 0 && dte <= Math.max(0, 5 - wd)
}

/** How far out of the money, as a fraction of `spot` (negative: in the money); null when it can't be told. */
function otmDistance(r: WhRow, spot: number | null): number | null {
  if (r.strike == null || spot == null || !(spot > 0) || !r.type) return null
  return r.type === 'C' ? (r.strike - spot) / spot : (spot - r.strike) / spot
}

/** `4.6%` out of the money (a negative distance is in the money), from the underlying's price then. */
function moneyness(r: WhRow): { k: string; v: string } | null {
  const d = otmDistance(r, r.spot)
  if (d == null) return null
  return { k: d >= 0 ? 'OTM' : 'ITM', v: `${Math.abs(d * 100).toFixed(1)}%` }
}

/** `Put sold · bullish` — the contract, what was done with it, what that leans. */
function printTitle(r: WhRow): string {
  const kind = r.type === 'C' ? 'Call' : r.type === 'P' ? 'Put' : 'Option'
  const verb = r.action === 'BUY' ? ' bought' : r.action === 'SELL' ? ' sold' : ''
  const b = biasOf(r)
  return `${kind}${verb} · ${b > 0 ? 'bullish' : b < 0 ? 'bearish' : 'side unknown'}`
}

/** W3's body for one bubble (whaleLayer.ts draws it). */
function contextOf(rows: WhRow[], tone: Tone, priceLabel: string, lean: number | null, rank: number, day: string): WhaleContext {
  const sorted = rows.slice().sort((a, z) => z.premium - a.premium)
  const today = day === etDateKey(Date.now())
  const rankText = `#${rank} ${today ? 'today' : 'that day'}`
  if (rows.length === 1) {
    const r = rows[0]!
    const dte = dteOf(r)
    const m = moneyness(r)
    const cells: { k: string; v: string }[] = [
      { k: 'STRIKE', v: strikeText(r.strike) || '—' },
      { k: 'EXPIRY', v: expiryText(r.expiry, day) || '—' },
      { k: 'DTE', v: dte == null ? '—' : String(dte) },
      m ?? { k: 'OTM', v: '—' },
      { k: 'SIZE', v: r.size == null ? '—' : Math.round(r.size).toLocaleString('en-US') },
      { k: 'PRICE', v: r.price == null ? '—' : r.price.toFixed(2) },
      { k: 'SPOT', v: r.spot == null ? '—' : r.spot.toFixed(2) },
      { k: 'TIME', v: TIME_FMT.format(r.ts) },
    ]
    return { title: printTitle(r), lean, cells, lines: [], foot: DAY_FMT.format(r.ts), rank: rankText }
  }
  const side = tone === 'up' ? 'bullish' : tone === 'down' ? 'bearish' : 'side unknown'
  const lines = sorted.slice(0, CARD_ROWS).map((r): WhaleCtxLine => {
    const b = biasOf(r)
    const glyph = r.action === 'BUY' ? '▲' : r.action === 'SELL' ? '▼' : '•'
    const exp = expiryText(r.expiry, day)
    const dte = dteOf(r)
    return {
      text: `${glyph} ${[strikeText(r.strike), r.type ?? ''].filter(Boolean).join(' ')}${exp ? ` · ${exp}` : ''}`,
      dte: dte == null ? '' : `${dte} DTE`,
      amount: short(r.premium),
      tone: b > 0 ? 'up' : b < 0 ? 'down' : 'mid',
    }
  })
  const span = whenText(rows).split(' · ').slice(1).join(' · ')
  return { title: `${rows.length} prints · ${side}`, lean, cells: [], lines, foot: `${span} · ${priceLabel}`, rank: rankText }
}

function bubbleOf(id: string, t: number, price: number, rows: WhRow[], amount: number, tone: Tone, head: string, s: WhS, priceLabel: string, ctx: WhaleContext): WhaleBubble {
  const sorted = rows.slice().sort((a, z) => z.premium - a.premium)
  const sign = tone === 'up' ? '+' : tone === 'down' ? '−' : ''
  const n = rows.length
  return {
    id,
    t,
    price,
    r: bubbleRadius(amount, s.cap, s.size),
    tone,
    label: s.text ? short(amount) : '',
    card: {
      head,
      net: tone === 'mid' ? short(amount) : `${sign}${short(amount)}`,
      when: `${whenText(rows)} · ${priceLabel}${n > 1 ? ` · ${n} prints` : ''}`,
      rows: sorted.slice(0, CARD_ROWS).map((r) => {
        const b = biasOf(r)
        return { text: printLine(r), amount: short(r.premium), tone: b > 0 ? 'up' : b < 0 ? 'down' : 'mid' }
      }),
      more: Math.max(0, n - CARD_ROWS),
      ctx,
    },
  }
}

/**
 * One bubble per print, centred on the moment it printed and the underlying's price
 * then (`spot`; on ES / NQ, SPX / NDX's price plus that session's basis). Prints in the
 * same minute on the same side — one order filled in pieces — are one bubble at their
 * premium-weighted price, sized by their total. A print with no recorded spot sits on
 * its bar's close.
 */
function whaleBubbles(c: StudyCtx, s: WhS, data: WhData | null): WhaleBubble[] {
  const { bars, tfMs } = c
  const rows = data?.rows
  if (!bars.length || !rows?.length) return []
  const fut = c.sym.fut
  const basis = data!.basis
  const shiftFor = (ts: number): number | null => {
    if (!fut) return 0
    if (!basis) return null
    const b = basis.days.get(etDateKey(ts)) ?? basis.basis
    return isPlausibleBasis(b, basis.max) ? b : null
  }
  const first = bars[0]!.time
  // the end of the newest bar, or, mid-replay, the replay clock (a print later in a
  // candle that is still building tick by tick has not happened yet)
  const lastEnd = Math.min(bars[bars.length - 1]!.time + Math.max(tfMs, 60_000), c.until)
  const groups = new Map<string, WhRow[]>()
  for (const r of rows) {
    if (s.side !== 'all' && r.type !== s.side) continue
    if (s.action !== 'all' && r.action !== s.action) continue
    if (!expOk(r, s.exp)) continue
    if (r.ts < first || r.ts >= lastEnd) continue
    if (data!.fromMs != null && r.ts < data!.fromMs) continue
    if (s.otm) {
      // the recorded spot, else the candle's close in index terms (ES / NQ: less that session's basis)
      let spot = r.spot
      if (spot == null) {
        const i = barAt(bars, r.ts, tfMs)
        const sh = i < 0 ? null : shiftFor(r.ts)
        spot = i < 0 || sh == null ? null : bars[i]!.close - sh
      }
      const d = otmDistance(r, spot)
      if (d == null || d < 0) continue
    }
    const key = `${Math.floor(r.ts / 60_000)}|${biasOf(r)}`
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }
  // Each day's bubbles, for the card's context: where this one RANKS that day by
  // premium, and the day's LEAN — the bullish share of the day's whale premium
  // (bullish + bearish, side-unknown left out) from the first print to this one
  const byDay = new Map<string, { key: string; total: number; ts: number; bias: number }[]>()
  for (const [key, g] of groups) {
    const total = g.reduce((t, r) => t + r.premium, 0)
    const ts = g.reduce((t, r) => t + r.ts * r.premium, 0) / total
    const day = etDateKey(ts)
    const list = byDay.get(day) ?? []
    list.push({ key, total, ts, bias: biasOf(g[0]!) })
    byDay.set(day, list)
  }
  const rankOf = new Map<string, number>()
  const leanOf = new Map<string, number | null>()
  for (const list of byDay.values()) {
    list
      .slice()
      .sort((a, z) => z.total - a.total)
      .forEach((x, k) => rankOf.set(x.key, k + 1))
    let bull = 0
    let bear = 0
    for (const x of list.slice().sort((a, z) => a.ts - z.ts)) {
      if (x.bias > 0) bull += x.total
      else if (x.bias < 0) bear += x.total
      leanOf.set(x.key, bull + bear > 0 ? bull / (bull + bear) : null)
    }
  }
  const out: WhaleBubble[] = []
  for (const [key, g] of groups) {
    const total = g.reduce((t, r) => t + r.premium, 0)
    const bias = biasOf(g[0]!)
    const ts = g.reduce((t, r) => t + r.ts * r.premium, 0) / total
    const withSpot = g.filter((r) => r.spot != null && r.spot > 0)
    const shift = shiftFor(ts)
    let price: number
    let label: string
    const underlyingName = flowTicker(c)
    if (withSpot.length && shift != null) {
      const w = withSpot.reduce((t, r) => t + r.premium, 0)
      const spot = withSpot.reduce((t, r) => t + r.spot! * r.premium, 0) / w
      price = spot + shift
      label = fut ? `${underlyingName} ${spot.toFixed(2)} (${fut} ${price.toFixed(2)})` : `${underlyingName} ${spot.toFixed(2)}`
    } else {
      const i = barAt(bars, ts, tfMs)
      if (i < 0) continue
      price = bars[i]!.close
      label = `bar close ${price.toFixed(2)}`
    }
    const tone: Tone = bias > 0 ? 'up' : bias < 0 ? 'down' : 'mid'
    const head = bias > 0 ? 'Bullish' : bias < 0 ? 'Bearish' : 'Side unknown'
    const ctx = contextOf(g, tone, label, leanOf.get(key) ?? null, rankOf.get(key) ?? 1, etDateKey(ts))
    out.push(bubbleOf(key, ts, price, g, total, tone, head, s, label, ctx))
  }
  // the biggest few hundred, when a long window holds more
  return out.sort((a, b) => b.r - a.r).slice(0, 400)
}

/** The ET date `n` weekdays before `date` (YYYY-MM-DD); a weekend `date` steps back from Friday. */
export function tradingDaysBack(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  let t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12)
  const wd = () => new Date(t).getUTCDay()
  while (wd() === 0 || wd() === 6) t -= DAY_MS
  for (let k = 0; k < n; ) {
    t -= DAY_MS
    if (wd() !== 0 && wd() !== 6) k++
  }
  return new Date(t).toISOString().slice(0, 10)
}

export const whalesImpl = studyImpl<WhS, WhData>({
  settings: (i) => {
    const side = str(i.side, WH_SIDE[0])
    return {
      minPremium: WH_MIN_V[Math.max(0, (WH_MIN as readonly string[]).indexOf(str(i.min, WH_MIN[0])))] ?? 1e6,
      days: int(i.days, 1, 1, 30),
      side: side === WH_SIDE[1] ? 'C' : side === WH_SIDE[2] ? 'P' : 'all',
      action: ((a) => (a === WH_ACTION[1] ? 'BUY' : a === WH_ACTION[2] ? 'SELL' : 'all'))(str(i.action, WH_ACTION[0])),
      cap: WH_CAP_V[Math.max(0, (WH_CAP as readonly string[]).indexOf(str(i.cap, WH_CAP[0])))] ?? 25e6,
      size: int(i.size, 100, 50, 200) / 100,
      fill: int(i.opacity, WH_OPACITY_DEF, 5, 100) / 100,
      text: bool(i.text, true),
      exp: (['all', '0dte', 'week', 'no0dte'] as const)[Math.max(0, (WH_EXP as readonly string[]).indexOf(str(i.exp, WH_EXP[0])))] ?? 'all',
      otm: str(i.money, WH_MONEY[0]) === WH_MONEY[1],
      zone: ((z) => (z === WH_ZONE[1] ? 'all' : z === WH_ZONE[2] ? 'off' : 'hover'))(str(i.zone, WH_ZONE[0])),
    }
  },
  dataKey: (c, s) => `${flowTicker(c)}|${s.minPremium}|${s.days}`,
  load: async (c, s, fresh) => {
    // Days back from now, or in a replay from the bar it started at, reaching on
    // past it so the prints still to come are loaded and revealed as it plays.
    const now = Date.now()
    const anchor = c.ctx.live ? now : Math.min(now, c.bars[c.bars.length - 1]?.time ?? now)
    const to = etDateKey(Math.min(now, anchor + Math.max(s.days, 5) * DAY_MS))
    // `days` trading days counting the anchor's own: 1 = that day alone. On ES / NQ
    // a day is the futures session, which opens at 18:00 ET the evening before
    const fut = !!c.sym.fut
    const firstDay = tradingDaysBack(fut ? sessionKey(anchor, true) : etDateKey(anchor), s.days - 1)
    const from = fut ? dayBefore(firstDay) : firstDay
    const fromMs = fut ? etWallMs(from, FUT_OPEN) : undefined
    // rows_only=1: the print list alone, without the Whales page's six roll-ups
    const urlFor = (a: string, b: string) =>
      `/api/lse/whales?from=${a}&to=${b}&ticker=${encodeURIComponent(flowTicker(c))}&min_premium=${s.minPremium}&sort=time&limit=500&rows_only=1`
    const fullUrl = urlFor(from, to)
    const today = etDateKey(now)
    // TODAY FIRST (2026-10-06, load times): the chart's first read live asks for
    // today's whales only and draws them; the whole range follows behind and the
    // study repaints with it. Every later read (and a replay) is the whole range.
    const quick = c.ctx.live && !fresh && from < today && !wholeRangeRead.has(fullUrl)
    const [j, basis] = await Promise.all([
      sharedJson<{ rows?: Record<string, unknown>[] }>(quick ? urlFor(today, today) : fullUrl),
      c.sym.fut ? loadBasis(c.sym.fut) : Promise.resolve(null),
    ])
    if (quick) {
      void sharedJson<unknown>(fullUrl).then((all) => {
        if (!all) return
        wholeRangeRead.add(fullUrl)
        c.refresh?.()
      })
    } else wholeRangeRead.add(fullUrl)
    const rows = (j?.rows ?? [])
      .map((r): WhRow => ({
        ts: typeof r.ts === 'number' ? r.ts : Date.parse(String(r.ts ?? '')),
        type: r.type === 'C' || r.type === 'P' ? r.type : null,
        strike: Number.isFinite(Number(r.strike)) ? Number(r.strike) : null,
        expiry: typeof r.expiry === 'string' ? r.expiry : null,
        size: Number.isFinite(Number(r.size)) ? Number(r.size) : null,
        price: Number.isFinite(Number(r.price)) ? Number(r.price) : null,
        premium: Number(r.premium) || 0,
        action: r.action === 'BUY' || r.action === 'SELL' ? r.action : null,
        underlying: typeof r.underlying === 'string' ? r.underlying : null,
        spot: Number.isFinite(Number(r.spot)) && Number(r.spot) > 0 ? Number(r.spot) : null,
      }))
      .filter((r) => Number.isFinite(r.ts) && r.premium > 0)
    return { rows, basis, fromMs }
  },
  refreshMs: 60_000,
  // repaint as the forming bar moves: in a tick replay that is how a print appears
  // the minute it printed, not when its candle completes
  everyTick: true,
  // the bubbles are the layer's (whaleLayer.ts) — nothing for the drawing primitives
  render: () => ({}),
  layer: (c, s, data): WhalePayload | null => {
    const bubbles = whaleBubbles(c, s, data)
    return bubbles.length ? { bubbles, fill: s.fill, zone: s.zone } : null
  },
})

provideLayer(WHALES_TYPE, () => new WhaleLayer())
