// ─────────────────────────────────────────────────────────────────────────────
// THE TPO ENGINE — sessions, structures, forward-fill, stats, open location.
//
// Transcribed 1:1 from v2's `lib/tpo.ts:1–425`, `lib/balanceImbalance.ts:56–119`
// (`groupRthByDate` and its helpers — the ONLY part of that module this tab
// reaches), `components/pages/Scanner.tsx:2246, 2656–2717, 2896–3042` and
// `components/scanner/TpoOpenLocation.tsx:1–137`, against the checklist in
// docs/parity/scanner.md Part F, rows F14–F34, F89–F94, F132–F190.
//
// WHAT THIS FILE IS. `buildTpoStructures` takes 5-minute RTH candles, builds one
// real TPO profile per session (one touch per 30-min period per price bin —
// TIME, not volume), extracts the auction structures at and inside each
// profile's extremes, and FORWARD-FILLS every one of them across every later
// session. `sessions` is the drawing; `structures` — and specifically `open`,
// the ones never repaired — is the product. A tail is nearly worthless intraday
// and very valuable as an untested level three weeks later; that asymmetry is
// the whole reason the forward-fill exists.
//
// SEVEN PIECES OF BUSINESS LOGIC THAT ARE NOT OBVIOUS FROM THE SCREEN:
//
//   1. RTH ONLY, AND THE RTH RULE IS ONE COMPARISON. `isRthBar` is
//      `minutes >= 570 && minutes < 960` in ET — INCLUSIVE at 09:30, EXCLUSIVE
//      at 16:00, so a 15:55 five-minute bar is the last one in and a 16:00 bar is
//      out. Globex is excluded deliberately: overnight single prints are a
//      thin-book artifact, not an auction failure, and folding them in poisons
//      every tail / excess / poor-high statistic downstream.
//   2. A BAR'S SESSION IS THE ET CALENDAR DATE OF ITS OWN TIMESTAMP. The
//      record's `date` column is only a FALLBACK, used when the timestamp fails
//      to parse. Because the window is 09:30–16:00 ET there is no
//      midnight-spanning case, so the two agree in practice — but the timestamp
//      is authoritative and a mis-stamped `date` column cannot move a bar.
//   3. ONE SHARED `Intl.DateTimeFormat`, MODULE-LEVEL. Constructing a formatter
//      per call is not a micro-optimisation here: over a multi-day candle set
//      (thousands of bars, each hit two to four times) it is the documented
//      cause of this tab freezing the entire dashboard on click. `hour === "24"`
//      is normalised to `"00"` — the `hour12:false` midnight quirk.
//   4. THE MEMO KEY IS BAR COUNT, NOT BAR CONTENT. See `barCountKey` in
//      tpoData.ts. A multi-day structure walk must not re-run on an intrabar
//      tick; spot moves, the scan does not.
//   5. TWO ADMISSION GATES, BOTH SILENT. A session needs `>= 6` RTH bars
//      (30 minutes = one full TPO period) to be attempted, and `buildTpoSession`
//      then returns null unless it produces `>= 3` price bins. A session that
//      opens and halts inside 25 minutes never becomes a `TpoSession` and is
//      invisible to every panel on this tab.
//   6. GRADING REQUIRES `ageSessions >= 1`. Calling a tail created twenty
//      minutes ago "untested" is lookahead bias in reverse — it drags every rate
//      down and makes the sample look worse than it is.
//   7. TIES GO UP, TWICE, IN OPPOSITE DIRECTIONS. The value-area walk takes the
//      HIGHER neighbour on a tie (`above >= below`), while the POC scan uses a
//      strict `>` so the LOWEST-priced bin wins a count tie. Both are
//      deliberate and both are copied.
//
// ── THE DELIBERATE DEPARTURES FROM v2 ────────────────────────────────────────
//
// 1. ONE VALUE-AREA WALK, NOT THREE. v2 implements the identical POC-outward
//    70% expansion — same `above >= below` tie rule, same `Math.max(0, …)`
//    guard, same `(lo > 0 || hi < len-1)` termination — in THREE places:
//    `buildTpoSession` (`lib/tpo.ts:221–227`) on TPO counts,
//    `TpoOpenLocation.mergeVA` (`TpoOpenLocation.tsx:35–39`) on merged counts,
//    and `vaBand` (`tpo-forecast-compute.ts:85–95`) on a normalised density.
//    `valueAreaWalk` below is written ONCE and takes the weights; the first two
//    call it, and the third lives server-side in the forecast route where this
//    module cannot reach it. Spec F200, "Do not port" 20.
//
// 2. THE ET FORMATTER IS SHARED WITH `TpoOpenLocation`'s `etMin`. v2's
//    `TpoOpenLocation.tsx:18–21` constructs a NEW `Intl.DateTimeFormat` inside
//    `etMin`, which is then called once per candle inside a `.find()` over the
//    whole multi-day array — the exact pattern `balanceImbalance.ts` fixed and
//    documented. Same options, same output; one formatter. v2's copy also omits
//    the `hour === "24"` normalisation, which cannot change an answer inside the
//    09:30–16:00 window (1440 and 0 both fail the test), so sharing the
//    normalised helper is safe.
//
// 3. THE DASHED-LINE COUNT IS THE DRAWN COUNT. See `// BUG (v2):` on
//    `openLevelsLegendLine` and `profileCardSubtitle`.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • `const today = res.sessions[res.sessions.length - 1] ?? null`
//   (`Scanner.tsx:2938`). Assigned, never referenced. Dead.
// • EVERYTHING IN `lib/balanceImbalance.ts` EXCEPT the grouping helpers.
//   `classifyDay`, `backtestQuadrants`, `rthBarsForDate`, `sessionDates`, the
//   `Quadrant` taxonomy, `CONFIRM_BARS` / `SETTLE_BARS` / `CONTRACTION_RATIO`
//   are unreachable from this tab — `lib/tpo.ts:42` imports `groupRthByDate` and
//   nothing else.
// • `lib/valueArea.ts`. It is NOT what backs this tab and folding it in would be
//   wrong, not merely redundant. `computeValueArea` is a VOLUME profile — it
//   spreads each bar's volume evenly across every bin its range touches — and it
//   is imported only by `lib/balanceImbalance.ts:20`, used only by
//   `backtestQuadrants`, which nothing here calls. The 70% value area on this
//   tab is TIME-based (TPO counts) and comes from `buildTpoSession`. The two
//   answer different questions and give DIFFERENT VAH/VAL on the same bars.
//   `computeValueArea` additionally computes an `lvn` (lowest local-minimum bin,
//   edges excluded) that Part F never shows. Spec F201.
// • `lib/marketSession.ts` — `isSessionLive`, `isSpxFeedLive`, `isTradingDay`,
//   `isHoliday`. NOTHING in Part F imports it. There is no holiday gate and no
//   market-hours gate anywhere in this tab: it polls, redraws and computes
//   identically at 03:00 on a Sunday as at 10:00 on a Tuesday. The only liveness
//   gate in v2 was `useWsLifecycle()` on the socket, which v3 replaces with
//   `@/data/hooks`. A holiday is not excluded — it simply produces no RTH bars
//   and therefore no session, which is why the omission has never been visible.
//   Spec F190.
//
// Spec: docs/parity/scanner.md Part F, rows F14–F34, F89–F94, F132–F190.
// ─────────────────────────────────────────────────────────────────────────────

import { alpha, LIGHT_BLUE, MOVE_DOWN, MOVE_UP, T } from '@/design/theme'
import { EM_DASH, pctOrDash } from '@/pages/scanner/format'
import type { EsCandle, TpoInstrument } from '@/pages/scanner/tpoData'
import {
  ageBucket,
  AGE_BUCKETS,
  baseRateFor,
  KIND_COLOR,
  KIND_LABEL,
  KIND_MEANING,
  KIND_ORDER,
  KIND_TITLE,
  POC_COLOR,
  type AgeBucket,
  type BaseRate,
  type BucketStat,
  type KindStat,
  type StructureKind,
} from '@/pages/scanner/tpoTaxonomy'

/** Re-exported so a consumer of the engine does not need a second import for the
 *  tab's only number formatter. `pctOrDash(0)` is `"0%"` — zero is not null. */
export { pctOrDash }

// ── ENGINE CONSTANTS ─────────────────────────────────────────────────────────

/** One TPO period. Letters A, B, C… advance every 30 minutes from 09:30. */
export const TPO_PERIOD_MS = 30 * 60_000

/** ESU = 1 pt, NQU = 5 pt (F15). */
export function binSizeFor(instrument: TpoInstrument): number {
  return instrument === 'NQU' ? 5 : 1
}

export const DEFAULT_BIN_SIZE = 1

/** The value area is 70% of the session's TPO count. */
export const VA_PCT = 0.7

/**
 * One ES tick. Every band is widened by this on BOTH sides for the hit test,
 * because a zero-width band (naked POC, poor high, poor low) would otherwise be
 * untouchable by a floating-point comparison.
 */
export const TOUCH_PAD = 0.25

/** `>= 2` periods before a session is worth attempting: 6 five-minute bars. */
export const MIN_BARS_PER_SESSION = 6
/** Fewer than 3 price bins and `buildTpoSession` returns null. */
export const MIN_BINS_PER_SESSION = 3
/** A structure enters the stats only once at least one later session exists. */
export const GRADING_MIN_AGE_SESSIONS = 1

/** `TpoOpenLocation` mounts only at 2+ built sessions (F21). */
export const MIN_SESSIONS_FOR_OPEN_LOCATION = 2

/** Only this many open structures are drawn as dashed lines (F34). */
export const OPEN_LEVELS_DRAWN = 12

// ── RTH SESSION GROUPING ─────────────────────────────────────────────────────

/** 09:30 ET, in minutes since midnight. Inclusive. */
export const RTH_OPEN_MIN = 9 * 60 + 30
/** 16:00 ET. EXCLUSIVE — a 16:00 bar is not in the session. */
export const RTH_CLOSE_MIN = 16 * 60

/** See header note 3. One formatter, module scope, reused for every bar. */
const ET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export interface EtParts {
  /** `"YYYY-MM-DD"`, or `""` when the timestamp will not parse. */
  date: string
  /** Minutes since ET midnight, or `NaN` when the timestamp will not parse. */
  minutes: number
}

export function etParts(ts: number): EtParts {
  const d = new Date(Number(ts))
  if (isNaN(d.getTime())) return { date: '', minutes: NaN }
  const m: Record<string, string> = {}
  for (const x of ET_FMT.formatToParts(d)) m[x.type] = x.value
  // `hour12: false` renders midnight as "24" in some ICU builds.
  const hh = m.hour === '24' ? '00' : m.hour
  return { date: `${m.year}-${m.month}-${m.day}`, minutes: Number(hh) * 60 + Number(m.minute) }
}

/**
 * A bar whose timestamp will not parse gets `minutes: NaN`; BOTH comparisons are
 * then false, so it is silently dropped rather than landing in some session.
 */
export function isRthBar(ts: number): boolean {
  const { minutes } = etParts(ts)
  return minutes >= RTH_OPEN_MIN && minutes < RTH_CLOSE_MIN
}

/** The ET date of the bar's own timestamp, falling back to its `date` column. */
export function etSessionDate(c: EsCandle): string {
  return etParts(c.timestamp).date || c.date
}

/** Minutes since ET midnight — the form `TpoOpenLocation` wants. */
export function etMin(ts: number): number {
  return etParts(ts).minutes
}

/**
 * ONE PASS over the candle set: RTH bars only, grouped by ET session date, each
 * day sorted ascending afterwards. Blank dates are skipped.
 *
 * THIS IS THE ONLY RTH GATE IN THE WHOLE TAB. Every profile, every structure,
 * every statistic and every panel is downstream of this one function. An
 * all-overnight candle set yields an empty Map → no sessions → "Waiting on RTH
 * candles."
 *
 * The single pass matters: filtering and re-sorting the entire candle set once
 * per day is O(days × total bars), and with ~20 days of 5m history that is tens
 * of thousands of redundant comparisons — the other half of the freeze the
 * shared formatter fixed.
 */
export function groupRthByDate(candles: readonly EsCandle[]): Map<string, EsCandle[]> {
  const map = new Map<string, EsCandle[]>()
  for (const c of candles) {
    if (!isRthBar(c.timestamp)) continue
    const d = etSessionDate(c)
    if (!d) continue
    const arr = map.get(d)
    if (arr) arr.push(c)
    else map.set(d, [c])
  }
  for (const arr of map.values()) arr.sort((a, b) => a.timestamp - b.timestamp)
  return map
}

// ── THE ONE VALUE-AREA WALK ──────────────────────────────────────────────────

export interface ValueAreaIdx {
  /** Index of the highest-weight bin. Strict `>` scan: the LOWEST index wins a tie. */
  pocIdx: number
  /** Inclusive lower index of the value area. */
  loIdx: number
  /** Inclusive upper index of the value area. */
  hiIdx: number
}

/**
 * POC-outward expansion until `pct` of the total weight is captured.
 *
 * Written once; see departure 1. `weights` must be ordered by ascending price.
 * Works identically on TPO counts, on merged counts across sessions, and on a
 * normalised density — which is exactly why v2 had three copies of it.
 *
 * TWO TIE RULES, BOTH LOAD-BEARING:
 *   • the POC scan is strict `>`, so on equal counts the LOWEST-PRICED bin wins;
 *   • the expansion takes the higher neighbour when `above >= below`, so on
 *     equal neighbours the value area grows UP.
 *
 * The `-1` sentinel for an exhausted side, and the `Math.max(0, …)` on the
 * accumulator, are v2's: they let the loop keep running off one edge without the
 * sentinel polluting the total.
 */
export function valueAreaWalk(weights: readonly number[], pct = VA_PCT): ValueAreaIdx | null {
  if (!weights.length) return null
  let pocIdx = 0
  for (let i = 1; i < weights.length; i++) {
    if ((weights[i] ?? 0) > (weights[pocIdx] ?? 0)) pocIdx = i
  }
  const total = weights.reduce((s, x) => s + x, 0)
  const target = total * pct

  let loIdx = pocIdx
  let hiIdx = pocIdx
  let acc = weights[pocIdx] ?? 0
  while (acc < target && (loIdx > 0 || hiIdx < weights.length - 1)) {
    const below = loIdx > 0 ? (weights[loIdx - 1] ?? -1) : -1
    const above = hiIdx < weights.length - 1 ? (weights[hiIdx + 1] ?? -1) : -1
    if (above >= below) {
      hiIdx++
      acc += Math.max(0, above)
    } else {
      loIdx--
      acc += Math.max(0, below)
    }
  }
  return { pocIdx, loIdx, hiIdx }
}

// ── TYPES ────────────────────────────────────────────────────────────────────

export interface TpoBin {
  price: number
  count: number
  /**
   * Which 30-min periods touched this bin, IN ORDER. Index 0 = the 09:30 period
   * ("A"), 1 = 10:00 ("B"). This is what lets the profile draw real TPO letters
   * instead of anonymous boxes, and it makes the Initial Balance free: IB is
   * just periods 0 and 1.
   */
  periods: number[]
}

export interface TpoStructure {
  /** `` `${date}:${kind}:${priceLo}` `` — stable across rebuilds of the same session. */
  id: string
  /** The session that CREATED it, not the one it was tested in. */
  date: string
  kind: StructureKind
  /** Which end of the profile. `"up"` for a hole above the POC. */
  side: 'up' | 'down'
  priceLo: number
  priceHi: number
  /** The creating session's LAST bar timestamp, not its first. */
  createdTs: number

  // forward-filled across every LATER session
  /** First later bar whose range intersects the ±TOUCH_PAD band. */
  testedAt: number | null
  /** First later bar that closed the business. Null = still open. */
  repairedAt: number | null
  /** Distinct later SESSIONS that intersected the band, not bars. */
  touches: number
  /** Sessions elapsed as of the LAST LOADED session — not as of today. */
  ageSessions: number
}

export interface TpoSession {
  date: string
  /** Ascending by price. */
  bins: TpoBin[]
  maxCount: number
  poc: number
  vah: number
  val: number
  /** The RANGE midpoint `(high + low) / 2`, NOT the POC. The `M:` tag draws this. */
  mid: number
  high: number
  low: number
  /** First RTH bar's OPEN — what the AMT opening-type read conditions on. */
  open: number
  /** First two 30-min periods, 09:30–10:30. */
  ibHigh: number | null
  ibLow: number | null
  ibRange: number | null
  /** Count of 30-min periods that traded. Drives the split view's column count. */
  periods: number
  /** Bin prices with `count === 1`. */
  singles: number[]
  /** This session's structures, BEFORE the forward-fill writes into them. */
  structures: TpoStructure[]
}

export interface TpoResult {
  sessions: TpoSession[]
  /** ALL structures, forward-filled, oldest session first. */
  structures: TpoStructure[]
  /** `repairedAt === null` — the Open Business rail. NEWEST CREATED FIRST. */
  open: TpoStructure[]
  stats: KindStat[]
  buckets: BucketStat[]
  binSize: number
}

// ── ONE SESSION ──────────────────────────────────────────────────────────────

interface TpoPeriod {
  lo: number
  hi: number
  close: number
  ts: number
  lastTs: number
}

/**
 * Build one session's TPO profile and its structures.
 *
 * `bars` must be ONE session's RTH bars. Pass RTH only — see header note 1.
 *
 * The 5m bars are collapsed into 30-min periods and each period's CLOSE is kept.
 * That close is the entire reason excess can be told from a tail: without it a
 * rejection and a trend leg are the same shape, and they are opposite trades.
 *
 * Bins are `Math.floor(p / binSize) * binSize`, and a period touches every bin
 * from its low's bin to its high's bin inclusive (the `+ 1e-9` guards the
 * float accumulation in the loop). ONE touch per bin per period — this is TPO
 * (time), not volume.
 */
export function buildTpoSession(
  bars: readonly EsCandle[],
  date: string,
  binSize = DEFAULT_BIN_SIZE,
  vaPct = VA_PCT,
  periodMs = TPO_PERIOD_MS,
): TpoSession | null {
  if (!bars.length || !(binSize > 0)) return null
  const floorBin = (p: number) => Math.floor(p / binSize) * binSize

  const byPeriod = new Map<number, TpoPeriod>()
  for (const c of bars) {
    const k = Math.floor(c.timestamp / periodMs) * periodMs
    const p = byPeriod.get(k)
    if (!p) {
      byPeriod.set(k, { lo: c.low, hi: c.high, close: c.close, ts: k, lastTs: c.timestamp })
    } else {
      if (c.low < p.lo) p.lo = c.low
      if (c.high > p.hi) p.hi = c.high
      // `>=`, not `>`: two bars sharing a timestamp let the later-listed one win.
      if (c.timestamp >= p.lastTs) {
        p.close = c.close
        p.lastTs = c.timestamp
      }
    }
  }
  const periods = [...byPeriod.values()].sort((a, b) => a.ts - b.ts)
  if (!periods.length) return null

  const touched = new Map<number, number[]>()
  periods.forEach((p, idx) => {
    const b0 = floorBin(p.lo)
    const b1 = floorBin(p.hi)
    for (let b = b0; b <= b1 + 1e-9; b += binSize) {
      const arr = touched.get(b)
      if (arr) arr.push(idx)
      else touched.set(b, [idx])
    }
  })
  const bins: TpoBin[] = [...touched.entries()]
    .map(([price, ps]) => ({ price, count: ps.length, periods: ps }))
    .sort((a, b) => a.price - b.price)
  if (bins.length < MIN_BINS_PER_SESSION) return null

  const va = valueAreaWalk(bins.map((b) => b.count), vaPct)
  if (!va) return null
  const pocBin = bins[va.pocIdx]
  const vahBin = bins[va.hiIdx]
  const valBin = bins[va.loIdx]
  const topBin = bins[bins.length - 1]
  const botBin = bins[0]
  const lastPeriod = periods[periods.length - 1]
  if (!pocBin || !vahBin || !valBin || !topBin || !botBin || !lastPeriod) return null

  const high = Math.max(...bars.map((b) => b.high))
  const low = Math.min(...bars.map((b) => b.low))
  const poc = pocBin.price
  const vah = vahBin.price
  const val = valBin.price

  const ib = periods.slice(0, 2)
  const ibHigh = ib.length ? Math.max(...ib.map((p) => p.hi)) : null
  const ibLow = ib.length ? Math.min(...ib.map((p) => p.lo)) : null

  // ── singles → contiguous runs ───────────────────────────────────────────────
  const singleIdx = bins.map((b, i) => (b.count === 1 ? i : -1)).filter((i) => i >= 0)
  const runs: number[][] = []
  for (const i of singleIdx) {
    const last = runs[runs.length - 1]
    if (last && i === (last[last.length - 1] ?? -99) + 1) last.push(i)
    else runs.push([i])
  }

  const topIdx = bins.length - 1
  const botIdx = 0
  const ts = lastPeriod.lastTs
  const S: TpoStructure[] = []
  const mk = (kind: StructureKind, side: 'up' | 'down', lo: number, hi: number): TpoStructure => ({
    id: `${date}:${kind}:${lo}`,
    date,
    kind,
    side,
    priceLo: lo,
    priceHi: hi,
    createdTs: ts,
    testedAt: null,
    repairedAt: null,
    touches: 0,
    ageSessions: 0,
  })

  // `>= 2` for the extremes. Holes below have NO length requirement — header note 4
  // of tpoTaxonomy.ts.
  const topRun = runs.find((r) => r[r.length - 1] === topIdx && r.length >= 2)
  const botRun = runs.find((r) => r[0] === botIdx && r.length >= 2)

  if (topRun) {
    const loBin = bins[topRun[0] ?? 0]
    const hiBin = bins[topRun[topRun.length - 1] ?? 0]
    if (loBin && hiBin) {
      // EXCESS = the period that PRINTED the high closed back inside the body.
      const hiPeriod = periods.reduce((a, b) => (b.hi > a.hi ? b : a))
      const rejected = hiPeriod.close < loBin.price
      S.push(mk(rejected ? 'excess_high' : 'tail_high', 'up', loBin.price, hiBin.price))
    }
  } else if (topBin.count >= 2) {
    // Flat stack at the extreme, no tail → the auction ran out of TIME, not sellers.
    S.push(mk('poor_high', 'up', topBin.price, topBin.price))
  }

  if (botRun) {
    const loBin = bins[botRun[0] ?? 0]
    const hiBin = bins[botRun[botRun.length - 1] ?? 0]
    if (loBin && hiBin) {
      const loPeriod = periods.reduce((a, b) => (b.lo < a.lo ? b : a))
      const rejected = loPeriod.close > hiBin.price
      S.push(mk(rejected ? 'excess_low' : 'tail_low', 'down', loBin.price, hiBin.price))
    }
  } else if (botBin.count >= 2) {
    S.push(mk('poor_low', 'down', botBin.price, botBin.price))
  }

  // Holes = single runs touching NEITHER extreme. Thin zones inside the body.
  for (const r of runs) {
    if (r[r.length - 1] === topIdx || r[0] === botIdx) continue
    const loBin = bins[r[0] ?? 0]
    const hiBin = bins[r[r.length - 1] ?? 0]
    if (!loBin || !hiBin) continue
    // A hole's side is computed, not tabled: which half of the profile it is in.
    S.push(mk('hole', loBin.price >= poc ? 'up' : 'down', loBin.price, hiBin.price))
  }

  // Emitted for EVERY session, unconditionally. Zero width, at the POC.
  S.push(mk('naked_poc', 'up', poc, poc))

  return {
    date,
    bins,
    maxCount: pocBin.count,
    poc,
    vah,
    val,
    mid: (high + low) / 2,
    high,
    low,
    open: bars[0]?.open ?? 0,
    ibHigh,
    ibLow,
    ibRange: ibHigh != null && ibLow != null ? ibHigh - ibLow : null,
    periods: periods.length,
    singles: singleIdx.map((i) => bins[i]?.price ?? 0),
    structures: S,
  }
}

// ── FORWARD-FILL ACROSS SESSIONS ─────────────────────────────────────────────

/**
 * Build every session in `candles`, then walk each structure forward through all
 * LATER sessions to mark when it was tested and when it was repaired.
 *
 *   tested   = a later bar's [low, high] intersects the ±TOUCH_PAD band.
 *   repaired = business closed:
 *                *_high / naked_poc(side "up") → some later bar high > priceHi
 *                *_low                          → some later bar low  < priceLo
 *                hole                           → a later session traded BOTH
 *                                                 above hi AND below lo, i.e. a
 *                                                 full traverse WITHIN ONE
 *                                                 SESSION (the flags reset per
 *                                                 session)
 *                naked_poc                      → the first bar that touches it
 *                                                 at all; being touched IS the
 *                                                 business, so tested and
 *                                                 repaired are one event
 *
 * NOTE the repair branch order: `hole` is tested BEFORE `naked_poc`, and
 * `naked_poc` before the `side` test — which is why the hardcoded `side: "up"`
 * on a naked POC is inert.
 *
 * `ageSessions` is measured from the LAST LOADED SESSION, not from today. Load a
 * 30-day window and a structure's age is its age within that window; the same
 * structure in a 5-day window has a smaller age and therefore a different age
 * bucket and possibly a different base rate. That is v2's behaviour and it is
 * why the stats move when the day selector moves.
 */
export function buildTpoStructures(
  candles: readonly EsCandle[],
  binSize = DEFAULT_BIN_SIZE,
): TpoResult {
  const grouped = groupRthByDate(candles)
  const dates = [...grouped.keys()].sort()

  const sessions: TpoSession[] = []
  for (const d of dates) {
    const bars = grouped.get(d) ?? []
    if (bars.length < MIN_BARS_PER_SESSION) continue
    const s = buildTpoSession(bars, d, binSize)
    if (s) sessions.push(s)
  }

  const all: TpoStructure[] = []
  for (let i = 0; i < sessions.length; i++) {
    const cur = sessions[i]
    if (!cur) continue
    const later = sessions.slice(i + 1)
    for (const st of cur.structures) {
      const lo = st.priceLo - TOUCH_PAD
      const hi = st.priceHi + TOUCH_PAD
      let touches = 0

      for (const s of later) {
        const bars = grouped.get(s.date) ?? []
        let touchedThisSession = false
        let above = false
        let below = false

        for (const b of bars) {
          if (b.high >= lo && b.low <= hi) {
            touchedThisSession = true
            if (st.testedAt == null) st.testedAt = b.timestamp
          }
          if (b.high > st.priceHi) above = true
          if (b.low < st.priceLo) below = true

          if (st.repairedAt == null) {
            const done =
              st.kind === 'hole'
                ? above && below
                : st.kind === 'naked_poc'
                  ? touchedThisSession
                  : st.side === 'up'
                    ? b.high > st.priceHi
                    : b.low < st.priceLo
            if (done) st.repairedAt = b.timestamp
          }
        }
        if (touchedThisSession) touches++
      }

      st.touches = touches
      st.ageSessions = sessions.length - 1 - i
      all.push(st)
    }
  }

  // ── stats rollup, per kind — header note 6 on why the age floor exists ──────
  const gradable = all.filter((s) => s.ageSessions >= GRADING_MIN_AGE_SESSIONS)
  const stats: KindStat[] = KIND_ORDER.map((kind) => {
    const g = gradable.filter((s) => s.kind === kind)
    const tested = g.filter((s) => s.testedAt != null)
    const repaired = g.filter((s) => s.repairedAt != null)
    const spans = tested
      .map((s) => sessionsBetween(sessions, s.date, s.testedAt ?? 0))
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b)
    return {
      kind,
      n: g.length,
      tested: tested.length,
      repaired: repaired.length,
      testRate: g.length ? tested.length / g.length : null,
      repairRate: g.length ? repaired.length / g.length : null,
      // UPPER median on an even count: `spans[len/2]` after an ascending sort.
      medSessionsToTest: spans.length ? (spans[Math.floor(spans.length / 2)] ?? null) : null,
    }
  })

  const buckets: BucketStat[] = []
  for (const kind of KIND_ORDER) {
    for (const bucket of AGE_BUCKETS) {
      const g = gradable.filter((s) => s.kind === kind && ageBucket(s.ageSessions) === bucket)
      const tested = g.filter((s) => s.testedAt != null).length
      buckets.push({
        kind,
        bucket,
        n: g.length,
        tested,
        testRate: g.length ? tested / g.length : null,
      })
    }
  }

  return {
    sessions,
    structures: all,
    // NEWEST CREATED FIRST. This order is the sort's final tie-break everywhere
    // downstream, and it is why `amtRead` takes the newest naked POC rather than
    // the nearest one — see the note there.
    open: all.filter((s) => s.repairedAt == null).sort((a, b) => b.createdTs - a.createdTs),
    stats,
    buckets,
    binSize,
  }
}

/**
 * How many sessions elapsed between a structure's creating session and the bar
 * that tested it.
 *
 * The approximation is v2's own: a session's structures all carry that session's
 * LAST bar timestamp, so `structures[0].createdTs` is used to date-bucket the
 * session. When no later session's `createdTs` reaches `ts` — which happens when
 * the test landed in the last loaded session itself — it falls back to the full
 * remaining span, `sessions.length - 1 - i`.
 */
function sessionsBetween(sessions: readonly TpoSession[], fromDate: string, ts: number): number | null {
  const i = sessions.findIndex((s) => s.date === fromDate)
  if (i < 0) return null
  for (let j = i + 1; j < sessions.length; j++) {
    const s = sessions[j]
    if (!s) continue
    const anyTs = s.structures[0]?.createdTs ?? 0
    if (anyTs >= ts) return j - i
  }
  return sessions.length - 1 - i
}

// ── THE OPEN RAIL ────────────────────────────────────────────────────────────

/** `"all"` shows everything; `"extremes"` is everything that is not a hole. */
export type TpoKindFilter = 'all' | 'extremes' | 'holes'

export const TPO_DEFAULT_KIND_FILTER: TpoKindFilter = 'all'

/**
 * @notWiredInV2
 *
 * THIS FILTER HAS NO CONTROL. `setKindFilter` is never called anywhere in
 * `Scanner.tsx` (the state is declared at 2898 and the setter is dropped on the
 * floor), and no segmented control renders for it. The filter is therefore
 * permanently `"all"` and the `"extremes"` and `"holes"` branches are
 * UNREACHABLE in v2 — they have never run for any user.
 *
 * Ported as a pure function so nothing is lost, and tagged so nothing is
 * shipped by accident. Step 3 must decide: either ship the segmented control
 * (three options, labels below) or delete the state and call `openRail` with
 * `"all"`. Shipping the state again with no control would be the same mistake
 * twice. Spec F3, "Do not port" 3, open question 2.
 */
export function filterByKind(
  rows: readonly TpoStructure[],
  filter: TpoKindFilter,
): TpoStructure[] {
  return rows.filter((s) => {
    if (filter === 'holes') return s.kind === 'hole'
    if (filter === 'extremes') return s.kind !== 'hole'
    return true
  })
}

/** @notWiredInV2 — the labels the missing control would need. */
export const KIND_FILTER_LABELS: Record<TpoKindFilter, string> = {
  all: 'All',
  extremes: 'Extremes',
  holes: 'Holes',
}

export const structureMid = (s: TpoStructure): number => (s.priceLo + s.priceHi) / 2

/**
 * The open rail as the card sees it (F19): filtered, then — only when spot is
 * known — sorted by ABSOLUTE distance from spot, ascending.
 *
 * There is no tie-break. `Array.prototype.sort` is stable, so equal distances
 * keep `res.open`'s own order, which is `createdTs` DESC — newest first. When
 * spot is null the rail is left in that createdTs order entirely.
 */
export function openRail(
  open: readonly TpoStructure[],
  filter: TpoKindFilter,
  spot: number | null,
): TpoStructure[] {
  const rows = filterByKind(open, filter)
  if (spot == null) return rows
  return [...rows].sort(
    (a, b) => Math.abs(structureMid(a) - spot) - Math.abs(structureMid(b) - spot),
  )
}

/** The 12 nearest open structures — what the profile actually draws (F34). */
export function drawnLevels(rail: readonly TpoStructure[]): TpoStructure[] {
  return rail.slice(0, OPEN_LEVELS_DRAWN)
}

// ── CARD 1: TITLES, CONTROLS, LEGEND ─────────────────────────────────────────

/** `TPO profile + open levels — last 5 sessions`. Singular at exactly 1. */
export function profileCardTitle(shownCount: number): string {
  return `TPO profile + open levels — last ${shownCount} session${shownCount === 1 ? '' : 's'}`
}

/**
 * `ESU · 1-pt bins · 30-min periods · RTH · dashed lines = unfinished business (12)`
 *
 * BUG (v2): `Scanner.tsx:2971` interpolates `open.length` — the FULL filtered
 * open list, which is routinely 40+ — into a sentence about the dashed lines,
 * while `open.slice(0, 12)` is what gets drawn (F25). The count is the drawn
 * count here. The separator is U+00B7 MIDDLE DOT.
 */
export function profileCardSubtitle(
  instrument: TpoInstrument,
  binSize: number,
  drawnCount: number,
): string {
  return `${instrument} · ${binSize}-pt bins · 30-min periods · RTH · dashed lines = unfinished business (${drawnCount})`
}

/** Shown when no session survived the two admission gates. Also `TpoOpenLocation`'s. */
export const WAITING_ON_CANDLES = 'Waiting on RTH candles.'

/** Instrument pills, in strip order. */
export const INSTRUMENT_OPTIONS: readonly TpoInstrument[] = ['ESU', 'NQU']

/** Day pills. The label is `${n}D`. */
export function sessionChoiceLabel(n: number): string {
  return `${n}D`
}

export interface LegendEntry {
  /** The bold half. */
  term: string
  /** The plain half, including its leading separator. */
  gloss: string
  color: string
}

/**
 * The four legend entries under the profile (F89–F92), in order.
 *
 * NOTE WHAT IS MISSING: there is no `tail hi` / `tail lo` row. In v2 that was a
 * real problem — tails shared `poor hi/lo`'s orange, so an unlabelled tail on
 * the chart read as a "poor high, target it" when it means the opposite. This
 * port splits the two colours (see tpoTaxonomy.ts), which removes the
 * misreading; the missing row is still missing, and step 3 may want to add one.
 * Spec F94.
 */
export const PROFILE_LEGEND: readonly LegendEntry[] = [
  { term: 'naked POC', gloss: ' — magnet', color: KIND_COLOR.naked_poc },
  { term: 'poor hi/lo', gloss: ' — unfinished, target', color: KIND_COLOR.poor_high },
  { term: 'excess', gloss: ' — rejection, holds', color: KIND_COLOR.excess_high },
  { term: 'hole', gloss: ' — thin, runs through', color: KIND_COLOR.hole },
]

/**
 * `· dashed lines = the 12 open structures nearest spot`
 *
 * BUG (v2): `Scanner.tsx:2992` interpolates `open.length` here too, so with 40
 * open structures the line claims 40 dashed lines and 12 are drawn (F93). Takes
 * the DRAWN count. Spec "Do not port" 15.
 */
export function openLevelsLegendLine(drawnCount: number): string {
  return `· dashed lines = the ${drawnCount} open structures nearest spot`
}

// ── STRUCTURE STATS ──────────────────────────────────────────────────────────

export const STATS_SUMMARY_TITLE = 'Structure stats'
export const STATS_SUMMARY_NOTE = '· base rates by kind · tap to expand'
export const STATS_CARD_TITLE = 'Structure stats'

/** `12 sessions loaded · graded once ≥1 later session exists` — the `≥1` is
 *  `GRADING_MIN_AGE_SESSIONS`, so the copy and the code cannot drift. */
export function statsCardSubtitle(sessionCount: number): string {
  return `${sessionCount} sessions loaded · graded once ≥${GRADING_MIN_AGE_SESSIONS} later session exists`
}

/** Column headers, in order. There is NO colour ladder anywhere in this table. */
export const STATS_COLUMNS = ['kind', 'n', 'test %', 'repair %', 'med d'] as const

export const STATS_EMPTY = 'Not enough history loaded to grade anything yet.'

export interface StatsRow {
  kind: StructureKind
  label: string
  color: string
  n: number
  testPct: string
  repairPct: string
  /** The UPPER median sessions-to-test, or an em dash when nothing was tested. */
  medD: string
  chips: StatsChip[]
}

export interface StatsChip {
  bucket: AgeBucket
  testPct: string
  n: number
}

/**
 * The stats table, ready to render. Rows with `n === 0` are dropped entirely and
 * empty buckets are dropped from the chip line, so a kind whose buckets are all
 * empty shows its row with no chips.
 */
export function statsRows(res: TpoResult): StatsRow[] {
  return res.stats
    .filter((s) => s.n > 0)
    .map((s) => ({
      kind: s.kind,
      label: KIND_LABEL[s.kind],
      color: KIND_COLOR[s.kind],
      n: s.n,
      testPct: pctOrDash(s.testRate),
      repairPct: pctOrDash(s.repairRate),
      medD: s.medSessionsToTest != null ? String(s.medSessionsToTest) : EM_DASH,
      chips: res.buckets
        .filter((b) => b.kind === s.kind && b.n > 0)
        .map((b) => ({ bucket: b.bucket, testPct: pctOrDash(b.testRate), n: b.n })),
    }))
}

export function hasGradedStats(res: TpoResult): boolean {
  return res.stats.some((s) => s.n > 0)
}

// ── StructureRow — BUILT IN v2, RENDERED BY NOTHING ──────────────────────────

/**
 * @notWiredInV2
 *
 * `StructureRow` (`Scanner.tsx:2656–2717`) is fully written and fully styled and
 * IS MOUNTED NOWHERE. Not by `TpoStructuresScanner`, not anywhere else in the
 * repo. `GRID` (2654) exists only for it, and the `baseRateFor`, `ageBucket` and
 * `KIND_MEANING` imports at `Scanner.tsx:34` are used ONLY inside it.
 *
 * It is transcribed rather than dropped because it is the only surface in the
 * entire tab that explains what a base rate IS — "a base rate for the TYPE, not
 * a probability for this level" — and losing that sentence is exactly the
 * failure this port exists to prevent. It is tagged rather than shipped because
 * deciding it silently is the other failure. STEP 3 MUST DECIDE: ship the rail,
 * or delete this and the `TpoForwardMap` derivation below with it. There are two
 * competing designs for the same rail and neither has ever rendered.
 *
 * Spec F175–F184, "Do not port" 1, open question 1.
 */
export interface StructureRowView {
  kind: StructureKind
  /** Badge text. Full title, not the terse label — the row states the trade. */
  badge: string
  badgeColor: string
  /** Native `title=` on the badge. */
  badgeTooltip: string
  /** `6412.50–6415.00`, or one price for a zero-width kind. En dash. */
  band: string
  /** `7d`. */
  age: string
  /** Signed, 2 dp, or an em dash when spot is unknown. */
  dist: string
  distColor: string
  /** `"—"` for a hole regardless of what `baseRateFor` returned; see below. */
  baseRate: string
  /** `n=41`, or null when it is not shown. */
  sampleNote: string | null
  baseRateTooltip: string
  /** `3×` (U+00D7) or the literal `untested`. */
  touches: string
  touchesColor: string
}

/** Column ids in `GRID` order. The px widths are step 3's; the ORDER is not. */
export const STRUCTURE_ROW_COLUMNS = [
  'badge',
  'band',
  'age',
  'dist',
  'baseRate',
  'touches',
] as const

/**
 * The base-rate tooltip. This is the sentence the rail exists for.
 *
 * `scope === "none"` says why there is no number; the other two scopes quote the
 * number and then say what it is NOT. `Math.round((rate ?? 0) * 100)` matches
 * `pctOrDash`'s rounding so the tooltip and the cell cannot disagree.
 */
export function structureBaseRateTooltip(
  kind: StructureKind,
  ageSessions: number,
  base: BaseRate,
): string {
  if (base.scope === 'none') {
    return `Not enough graded ${KIND_LABEL[kind]} structures yet to quote a rate (n=${base.n}).`
  }
  const where = base.scope === 'bucket' ? `aged ${ageBucket(ageSessions)}` : '(all ages)'
  return (
    `${Math.round((base.rate ?? 0) * 100)}% of ${KIND_LABEL[kind]} structures ${where} were ` +
    `eventually tested — n=${base.n}. This is a base rate for the TYPE, not a probability for this level.`
  )
}

/** `6412.50–6415.00`, or a single price when the band has no width. En dash U+2013. */
export function priceBand(s: TpoStructure): string {
  return s.priceHi > s.priceLo
    ? `${s.priceLo.toFixed(2)}–${s.priceHi.toFixed(2)}`
    : s.priceLo.toFixed(2)
}

/**
 * @notWiredInV2 — see `StructureRowView`.
 *
 * Two v2 no-op ternaries are collapsed rather than carried:
 *   • the base-rate colour was `base.rate == null ? HT.text : HT.text` — both
 *     branches identical, so it is just `T.text` here;
 *   • `btn()`'s active/inactive colour has the same shape (see tpoProfile.ts).
 *
 * The HOLE EXCEPTION is real and is kept: a hole renders `"—"` for its base rate
 * whatever `baseRateFor` returns, and its `n=` note is suppressed with it. A hole
 * is not a level you target, so a "how often is it tested" rate would invite
 * exactly the trade its `KIND_MEANING` forbids.
 *
 * DISTANCE COLOUR is the one genuinely directional colour in this row, so it
 * takes `MOVE_UP` / `MOVE_DOWN` rather than the categorical `T.green` / `T.red`.
 * Zero is UP — the test is `dist >= 0`.
 */
export function deriveStructureRow(
  s: TpoStructure,
  spot: number | null,
  base: BaseRate,
): StructureRowView {
  const dist = spot != null ? structureMid(s) - spot : null
  const isHole = s.kind === 'hole'
  return {
    kind: s.kind,
    badge: KIND_TITLE[s.kind],
    badgeColor: KIND_COLOR[s.kind],
    badgeTooltip: KIND_MEANING[s.kind],
    band: priceBand(s),
    age: `${s.ageSessions}d`,
    dist: dist == null ? EM_DASH : `${dist >= 0 ? '+' : ''}${dist.toFixed(2)}`,
    distColor: dist == null ? T.text : dist >= 0 ? MOVE_UP : MOVE_DOWN,
    baseRate: isHole ? EM_DASH : pctOrDash(base.rate),
    sampleNote: !isHole && base.rate != null ? `n=${base.n}` : null,
    baseRateTooltip: structureBaseRateTooltip(s.kind, s.ageSessions, base),
    touches: s.testedAt ? `${s.touches}×` : 'untested',
    touchesColor: s.testedAt ? T.orange : T.text,
  }
}

/** @notWiredInV2 — the rail's own base-rate lookup, for whoever ships it. */
export function structureRowBase(res: TpoResult, s: TpoStructure): BaseRate {
  return baseRateFor(res, s.kind, s.ageSessions)
}

// ── TpoOpenLocation — RTH open vs previous values ────────────────────────────

export const OPEN_LOCATION_TITLE = 'RTH open vs previous values'

/**
 * The Monday of `dateStr`'s ISO week, as `YYYY-MM-DD`.
 *
 * `getUTCDay()` returns 0 for Sunday, so the back-step is `(dow + 6) % 7` —
 * Sunday steps back 6 days to the PRECEDING Monday, not forward. Everything is
 * done in UTC on a `T00:00:00Z` date so no local timezone can shift the day.
 */
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const dow = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export interface MergedValue {
  poc: number
  vah: number
  val: number
  /** The highest and lowest MERGED BIN prices, not the sessions' true high/low. */
  high: number
  low: number
}

/**
 * Merge several sessions' bins into one profile and take its 70% value area.
 *
 * Counts are summed per price across sessions, then `valueAreaWalk` does the
 * expansion — the same walk `buildTpoSession` uses, which is departure 1.
 * Returns null below 3 merged bins, which is what puts "No prior-week value."
 * on screen.
 */
export function mergeVA(sessions: readonly TpoSession[]): MergedValue | null {
  const m = new Map<number, number>()
  for (const s of sessions) {
    for (const b of s.bins) m.set(b.price, (m.get(b.price) || 0) + b.count)
  }
  const bins = [...m.entries()]
    .map(([price, count]) => ({ price, count }))
    .sort((a, b) => a.price - b.price)
  if (bins.length < MIN_BINS_PER_SESSION) return null
  const va = valueAreaWalk(bins.map((b) => b.count), VA_PCT)
  if (!va) return null
  const poc = bins[va.pocIdx]
  const vah = bins[va.hiIdx]
  const val = bins[va.loIdx]
  const top = bins[bins.length - 1]
  const bot = bins[0]
  if (!poc || !vah || !val || !top || !bot) return null
  return { poc: poc.price, vah: vah.price, val: val.price, high: top.price, low: bot.price }
}

export type OpenLocation = 'above' | 'below' | 'inside'

export interface OpenLocationData {
  /** Today's RTH open price, or null before 09:30 ET. */
  openPx: number | null
  prior: TpoSession
  week: MergedValue | null
  /** Nearest open naked-POC / poor level strictly ABOVE the anchor. */
  nkUp: TpoStructure | null
  nkDn: TpoStructure | null
  /** `openPx ?? spot ?? prior.poc` — the three-step fallback the levels hang off. */
  anchor: number
}

/**
 * Everything `TpoOpenLocation` needs, or null for its waiting state.
 *
 * THE OPEN IS THE FIRST RTH BAR'S `open`, NOT ITS CLOSE (F134) — the card is a
 * Dalton open-type read, and where the session opened is the whole input. It is
 * found by scanning the candle array in order for the first bar on the latest
 * date inside 09:30–16:00 ET, so it is available at 09:30 without waiting on the
 * IB.
 *
 * PRIOR SESSION is the last BUILT session strictly before the latest candle
 * date — built, so a day that failed the admission gates is skipped rather than
 * producing an empty prior.
 *
 * PRIOR WEEK is every built session in the calendar week before the latest
 * date's week, merged. `mondayOf(wkMon - 7 days)` is `wkMon - 7 days` (it is
 * already a Monday); the expression is v2's and is kept because it is what makes
 * the half-open range `[prevMonday, thisMonday)` obvious.
 *
 * OPEN LEVEL CANDIDATES are naked POCs and poor highs/lows ONLY — excess, tails
 * and holes are excluded here, because this card answers "what is price drawn
 * toward" and those three are not targets. `ageSessions >= 1` gives each one at
 * least a session to resolve. A structure exactly AT the anchor is dropped by
 * both sides (both tests are strict).
 */
export function buildOpenLocation(
  res: TpoResult,
  spot: number | null,
  candles: readonly EsCandle[],
): OpenLocationData | null {
  if (!candles.length || res.sessions.length < MIN_SESSIONS_FOR_OPEN_LOCATION) return null
  const latestDate = candles[candles.length - 1]?.date
  if (!latestDate) return null

  const openBar = candles.find(
    (c) =>
      c.date === latestDate &&
      etMin(c.timestamp) >= RTH_OPEN_MIN &&
      etMin(c.timestamp) < RTH_CLOSE_MIN,
  )
  const openPx = openBar?.open ?? null

  const prior = [...res.sessions].reverse().find((s) => s.date < latestDate) ?? null
  if (!prior) return null

  const wkMon = mondayOf(latestDate)
  const prevMon = mondayOf(
    new Date(new Date(`${wkMon}T00:00:00Z`).getTime() - 7 * 864e5).toISOString().slice(0, 10),
  )
  const week = mergeVA(res.sessions.filter((s) => s.date < wkMon && s.date >= prevMon))

  const anchor = openPx ?? spot ?? prior.poc
  const opens = res.open.filter(
    (s) =>
      (s.kind === 'naked_poc' || s.kind === 'poor_high' || s.kind === 'poor_low') &&
      s.ageSessions >= 1,
  )
  const nkUp =
    opens
      .filter((s) => structureMid(s) > anchor)
      .sort((a, b) => structureMid(a) - structureMid(b))[0] ?? null
  const nkDn =
    opens
      .filter((s) => structureMid(s) < anchor)
      .sort((a, b) => structureMid(b) - structureMid(a))[0] ?? null

  return { openPx, prior, week, nkUp, nkDn, anchor }
}

/**
 * Where the open sits relative to a value area. Both tests are STRICT, so an
 * open exactly ON the VAH is `"inside"`.
 */
export function locationOf(open: number | null, vah: number, val: number): OpenLocation | null {
  if (open == null) return null
  return open > vah ? 'above' : open < val ? 'below' : 'inside'
}

/**
 * The banner tone. `"above"` and `"below"` are genuinely directional here — the
 * banner says which way the session opened — so they take the move pair. Both
 * `"inside"` AND the null case take `LIGHT_BLUE`; the null case reaches it by
 * falling off the end of v2's ternary rather than by being asked for, which is
 * worth knowing but produces the right answer.
 */
export function openLocationTone(loc: OpenLocation | null): string {
  return loc === 'above' ? MOVE_UP : loc === 'below' ? MOVE_DOWN : LIGHT_BLUE
}

export const OPEN_LOCATION_BANNER: Record<'none' | OpenLocation, string> = {
  none: "Prior RTH session hasn't opened yet",
  inside: 'Open INSIDE prior value',
  above: 'Open ABOVE prior value',
  below: 'Open BELOW prior value',
}

/** The lean paragraph under the banner. One per location, plus the pre-open case. */
export const OPEN_LOCATION_LEAN: Record<'none' | OpenLocation, string> = {
  none: 'Levels below are prior session values — the open read fills in at 09:30 ET.',
  inside:
    'Rotational / balanced lean. Two-sided trade likely inside prior value; the pd VAH/VAL edges ' +
    'are fade zones back toward pd POC. Break-and-accept beyond an edge flips to the outside-value case.',
  above:
    'Higher open. If price ACCEPTS above pd VAH (holds, builds value) → trend up, target the open ' +
    'levels above. If it REJECTS back below pd VAH → failed auction, rotate down toward pd POC / into prior value.',
  below:
    'Lower open. If price ACCEPTS below pd VAL (holds, builds value) → trend down, target the open ' +
    'levels below. If it REJECTS back above pd VAL → failed auction, rotate up toward pd POC / into prior value.',
}

export const OPEN_LOCATION_COLUMN_RIGHT = 'Prior week & open levels'
export const OPEN_LOCATION_NO_WEEK = 'No prior-week value.'
export const OPEN_LOCATION_FOOTNOTE =
  '"open ±" = where the RTH open printed relative to each level. Prior-week value merges the prior ' +
  "calendar week's RTH profiles; open levels are the nearest unfinished naked POC / poor high-low above and below."

/** `Prior day (2026-08-29)`. */
export function openLocationColumnLeft(priorDate: string): string {
  return `Prior day (${priorDate})`
}

/**
 * `open 6410.25 · spot 6414.00 · vs prior day + prior week + open levels`.
 * Both prefixes drop out independently.
 */
export function openLocationSubtitle(open: number | null, spot: number | null): string {
  const o = open != null ? `open ${open.toFixed(2)} · ` : ''
  const s = spot != null ? `spot ${spot.toFixed(2)} · ` : ''
  return `${o}${s}vs prior day + prior week + open levels`
}

export interface RefRow {
  label: string
  /** 2 dp. */
  price: string
  color: string
  /** `open +3.25`, or null when there is no open yet. */
  delta: string | null
  deltaColor: string | null
}

/**
 * One reference row.
 *
 * RETURNS NULL WHEN THE PRICE IS NULL, and the row disappears entirely — that is
 * v2's `Ref` returning null, and it is why the `"↑ open level"` / `"↓ open
 * level"` fallback labels below are UNREACHABLE: they are only used when the
 * structure is missing, which is exactly when the price is null and the row is
 * gone. Kept anyway so the port does not quietly change what happens if a future
 * caller passes a price without a structure.
 *
 * The `open ±` delta is `open - price`, and ZERO COUNTS AS POSITIVE (`rel >= 0`).
 */
export function refRow(
  label: string,
  price: number | null | undefined,
  open: number | null,
  color?: string,
): RefRow | null {
  if (price == null) return null
  const rel = open == null ? null : open - price
  return {
    label,
    price: price.toFixed(2),
    color: color ?? T.text,
    delta: rel == null ? null : `open ${rel >= 0 ? '+' : ''}${rel.toFixed(2)}`,
    deltaColor: rel == null ? null : rel >= 0 ? MOVE_UP : MOVE_DOWN,
  }
}

/** `↑ Poor high` — the title's first half, before the ` — `. */
export function openLevelLabel(s: TpoStructure | null, dir: '↑' | '↓'): string {
  if (!s) return `${dir} open level`
  return `${dir} ${KIND_TITLE[s.kind].split(' — ')[0]}`
}

/**
 * The two reference columns, ready to render. Nulls are already dropped.
 *
 * pd VAH / pd VAL / pw VAH / pw VAL take `LIGHT_BLUE` (the value-area edges);
 * pd POC / pw POC take `POC_COLOR`, which is where v2's two-oranges collision is
 * collapsed — the canvas `P:` tag and these DOM refs are now one colour for one
 * idea. pd high / pd low take the default ink. The up/down open levels are
 * directional and take the move pair.
 */
export function openLocationColumns(
  data: OpenLocationData,
): { left: RefRow[]; right: RefRow[]; weekMissing: boolean } {
  const { openPx, prior, week, nkUp, nkDn } = data
  const O = openPx
  const left = [
    refRow('pd high', prior.high, O),
    refRow('pd VAH', prior.vah, O, LIGHT_BLUE),
    refRow('pd POC', prior.poc, O, POC_COLOR),
    refRow('pd VAL', prior.val, O, LIGHT_BLUE),
    refRow('pd low', prior.low, O),
  ].filter((r): r is RefRow => r != null)

  const right = [
    ...(week
      ? [
          refRow('pw VAH', week.vah, O, LIGHT_BLUE),
          refRow('pw POC', week.poc, O, POC_COLOR),
          refRow('pw VAL', week.val, O, LIGHT_BLUE),
        ]
      : []),
    refRow(openLevelLabel(nkUp, '↑'), nkUp ? structureMid(nkUp) : null, O, MOVE_UP),
    refRow(openLevelLabel(nkDn, '↓'), nkDn ? structureMid(nkDn) : null, O, MOVE_DOWN),
  ].filter((r): r is RefRow => r != null)

  return { left, right, weekMissing: week == null }
}

// ── TpoForwardMap — ALSO BUILT IN v2, ALSO RENDERED BY NOTHING ───────────────

/**
 * @notWiredInV2
 *
 * `components/scanner/TpoForwardMap.tsx` is a complete 142-line card with its
 * own role taxonomy, its own tone ladder and the ONLY base-rate COLOUR ramp in
 * the whole tab. `Scanner.tsx:38` imports it. Nothing renders it. No user has
 * ever seen it.
 *
 * It and `StructureRow` above are TWO COMPETING DESIGNS FOR THE SAME RAIL and
 * neither is live: `StructureRow` is a flat list of every open structure with a
 * base rate per row, `TpoForwardMap` is a directional read — five levels above
 * spot, five below, each tagged with what it DOES to price. Step 3 must pick one
 * or drop both; shipping neither a third time is the outcome to avoid.
 *
 * Spec F.12, "Do not port" 2, open question 1.
 */
export type ForwardRole = 'target' | 'magnet' | 'hold' | 'thru'

export interface ForwardRoleDef {
  /** The uppercase chip on the row. */
  tag: string
  tone: ForwardRole
}

/**
 * What each structure DOES to price, which is a different question from what it
 * IS. Two kinds can share a role (both poor highs and poor lows are targets) and
 * one role can be reached by opposite kinds (excess high is resistance, excess
 * low is support — the same "it held" tone).
 */
export const FORWARD_ROLE: Record<StructureKind, ForwardRoleDef> = {
  poor_high: { tag: 'target', tone: 'target' },
  poor_low: { tag: 'target', tone: 'target' },
  naked_poc: { tag: 'magnet', tone: 'magnet' },
  excess_high: { tag: 'resistance', tone: 'hold' },
  excess_low: { tag: 'support', tone: 'hold' },
  tail_high: { tag: 'continuation', tone: 'hold' },
  tail_low: { tag: 'continuation', tone: 'hold' },
  hole: { tag: 'accelerant', tone: 'thru' },
}

/**
 * @notWiredInV2
 *
 * NOTE THE INCONSISTENCY, WHICH IS v2's: a hole is `T.flat` in `KIND_COLOR` (the
 * spine, the dashed line, the legend) and RED here, because this card colours by
 * ROLE rather than by kind and "price runs through, never target it" is the
 * warning tone in its scheme. Transcribed as written. If this rail ships, the
 * two colour systems have to be reconciled — one structure should not be two
 * colours on one page.
 */
export function forwardToneColor(t: ForwardRole): string {
  return t === 'target' ? T.orange : t === 'magnet' ? LIGHT_BLUE : t === 'hold' ? T.green : T.red
}

/** The base-rate ramp's boundaries. Both `>=`. */
export const FORWARD_RATE_GOOD = 0.6
export const FORWARD_RATE_FAIR = 0.4

/**
 * @notWiredInV2
 *
 * The only base-rate colour ladder in Part F, and the reason the forward map is
 * worth keeping if the rail comes back:
 *
 *   null       → 53% ink   ("no sample")
 *   rate >= .6 → MOVE_UP   ("usually revisited")
 *   rate >= .4 → T.orange
 *   otherwise  → MOVE_DOWN
 *
 * This one IS directional in meaning — a high test rate is the outcome you are
 * betting on — so it takes the move pair rather than the categorical pair.
 */
export function forwardRateColor(rate: number | null): string {
  if (rate == null) return alpha(T.text, 0.53)
  if (rate >= FORWARD_RATE_GOOD) return MOVE_UP
  if (rate >= FORWARD_RATE_FAIR) return T.orange
  return MOVE_DOWN
}

export interface ForwardRow {
  structure: TpoStructure
  /** The band midpoint — what the row prints and sorts on. */
  mid: number
  base: BaseRate
  role: ForwardRoleDef
  color: string
  /** `72%`, or an em dash. */
  rateText: string
  rateColor: string
  /** `18p` — absolute distance from spot, whole points. */
  distText: string
  /** `Poor high — unfinished · 7d`. */
  detail: string
}

export interface ForwardMap {
  above: ForwardRow[]
  below: ForwardRow[]
  /** Nearest ACTIONABLE level each way — a target or a magnet, falling back to
   *  the nearest row of any role. */
  leadUp: ForwardRow | null
  leadDn: ForwardRow | null
}

/**
 * @notWiredInV2 — see `ForwardRole`.
 *
 * Open business only, `ageSessions >= 1` (give each level a session to resolve),
 * split at spot, five each way, nearest first.
 *
 * `spot ?? 0` is v2's: with no spot every level is "above" 0 and the card would
 * be nonsense — which is why the component bails to "Waiting on spot." before it
 * ever renders this. The fallback is therefore unreachable in practice and is
 * kept so the function is total.
 */
export function buildForwardMap(res: TpoResult, spot: number | null): ForwardMap {
  const open = res.open.filter((s) => s.ageSessions >= 1)
  const px = spot ?? 0
  const toRow = (s: TpoStructure): ForwardRow => {
    const base = baseRateFor(res, s.kind, s.ageSessions)
    const role = FORWARD_ROLE[s.kind]
    return {
      structure: s,
      mid: structureMid(s),
      base,
      role,
      color: forwardToneColor(role.tone),
      rateText: base.rate == null ? EM_DASH : `${Math.round(base.rate * 100)}%`,
      rateColor: forwardRateColor(base.rate),
      distText: `${Math.abs(structureMid(s) - px).toFixed(0)}p`,
      detail: `${KIND_TITLE[s.kind]} · ${s.ageSessions}d`,
    }
  }
  const up = open
    .filter((s) => structureMid(s) > px)
    .map(toRow)
    .sort((a, b) => a.mid - b.mid)
  const dn = open
    .filter((s) => structureMid(s) < px)
    .map(toRow)
    .sort((a, b) => b.mid - a.mid)
  const lead = (rows: ForwardRow[]): ForwardRow | null =>
    rows.find((r) => r.role.tone === 'target' || r.role.tone === 'magnet') ?? rows[0] ?? null
  return {
    above: up.slice(0, FORWARD_LADDER_LEN),
    below: dn.slice(0, FORWARD_LADDER_LEN),
    leadUp: lead(up),
    leadDn: lead(dn),
  }
}

export const FORWARD_LADDER_LEN = 5

/** `target 6432.00 (Poor high)`, or an em dash. */
export function forwardLeanText(row: ForwardRow | null): string {
  if (!row) return EM_DASH
  return `${row.role.tag} ${row.mid.toFixed(2)} (${KIND_TITLE[row.structure.kind].split(' — ')[0]})`
}

/** @notWiredInV2 — every string the forward map would print. */
export const FORWARD_MAP_COPY = {
  title: 'TPO forward map — unfinished business vs spot',
  waitingOnSpot: 'Waiting on spot.',
  headUp: '↑ next above',
  headDn: '↓ next below',
  colAbove: 'Above spot',
  colBelow: 'Below spot',
  emptyAbove: 'No open structure above.',
  emptyBelow: 'No open structure below.',
  rateTooltip: 'base-rate test probability for this kind at this age',
  legendMagnet: 'untested fair value, pulls price in',
  legendHold: 'rejection that held, fade back',
  legendThru: 'thin zone, price runs through — never a target.',
} as const

/**
 * `spot 6414.00 · 22 sessions · open business only · base rate = prior on the
 * type, not this price` — the same disclaimer `StructureRow`'s tooltip makes,
 * which is the sentence both dead rails exist to say.
 */
export function forwardMapSubtitle(spot: number, sessionCount: number): string {
  return `spot ${spot.toFixed(2)} · ${sessionCount} sessions · open business only · base rate = prior on the type, not this price`
}

/**
 * The forward map's legend takes the second half of `poor_high`'s meaning
 * string — `KIND_MEANING.poor_high.split(" — ")[1]` — as the gloss for "target".
 * Transcribed rather than re-typed so the two cannot drift.
 */
export function forwardLegendTarget(): string {
  return KIND_MEANING.poor_high.split(' — ')[1] ?? ''
}
