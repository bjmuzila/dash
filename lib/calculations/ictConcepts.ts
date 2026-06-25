/**
 * ictConcepts.ts — Inner Circle Trader (ICT) concept detection over OHLC candles.
 *
 * Pure, framework-agnostic functions consumed by the /ict page. Every detector
 * takes the same `IctCandle[]` (5-min ES bars from useEsCandles) and returns
 * plain data the chart overlays + the signal panel render.
 *
 * Concepts implemented (mirrors innercircletrader.net "Most Important ICT
 * Concepts" list, translated from forex discretionary rules into deterministic
 * candle math):
 *   • Fair Value Gap (imbalance)      — 3-candle gap, with mitigation tracking
 *   • Displacement                    — large-bodied impulse legs
 *   • Order Block                     — last opposing candle before displacement
 *   • Swing pivots                    — fractal highs/lows (lookback k)
 *   • Market structure: BOS / CHOCH / MSS over the swing sequence
 *   • Liquidity pools (BSL / SSL)     — equal highs/lows + swing liquidity
 *   • Premium / Discount + OTE        — fib zones of the active dealing range
 *   • Kill zones / Silver Bullet / Macros — ET session time windows
 *   • Daily bias                      — prior-day range + displacement read
 *
 * All time logic is America/New_York (ET), matching the rest of the dashboard.
 */

export interface IctCandle {
  timestamp: number; // ms epoch (bar open)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  date?: string;     // "YYYY-MM-DD" ET (optional; derived if absent)
}

export type Dir = "bull" | "bear";

// ── ET helpers ───────────────────────────────────────────────────────────────

/** Minutes since ET midnight for a ms timestamp. */
export function etMinutes(ts: number): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ts));
  const m: Record<string, string> = {};
  p.forEach((x) => { m[x.type] = x.value; });
  return (Number(m.hour) % 24) * 60 + Number(m.minute);
}

/** ET calendar date "YYYY-MM-DD" for a ms timestamp. */
export function etDate(ts: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ts));
}

// ── Fair Value Gaps (imbalance) ──────────────────────────────────────────────

export interface FVG {
  dir: Dir;
  top: number;       // upper price bound of the gap
  bottom: number;    // lower price bound of the gap
  startTs: number;   // timestamp of candle 1
  ts: number;        // timestamp of candle 3 (gap confirmed here)
  mitigated: boolean;
  mitigatedTs: number | null;
}

/**
 * 3-candle FVG: bullish gap = candle1.high < candle3.low (price ran up leaving
 * an unfilled void); bearish gap = candle1.low > candle3.high. A gap is
 * "mitigated" once a later candle trades back into the void. `minTicks` filters
 * noise gaps (ES tick = 0.25).
 */
export function detectFVGs(candles: IctCandle[], minTicks = 1, tick = 0.25): FVG[] {
  const out: FVG[] = [];
  const minGap = minTicks * tick;
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2], c = candles[i];
    // Bullish FVG
    if (c.low - a.high >= minGap) {
      out.push(mkFvg("bull", c.low, a.high, a.timestamp, c.timestamp));
    }
    // Bearish FVG
    else if (a.low - c.high >= minGap) {
      out.push(mkFvg("bear", a.low, c.high, a.timestamp, c.timestamp));
    }
  }
  // Mitigation: did any LATER candle trade into the void?
  for (const f of out) {
    for (let j = 0; j < candles.length; j++) {
      const k = candles[j];
      if (k.timestamp <= f.ts) continue;
      const into = f.dir === "bull" ? k.low <= f.top : k.high >= f.bottom;
      if (into) { f.mitigated = true; f.mitigatedTs = k.timestamp; break; }
    }
  }
  return out;
}
function mkFvg(dir: Dir, top: number, bottom: number, startTs: number, ts: number): FVG {
  return { dir, top, bottom, startTs, ts, mitigated: false, mitigatedTs: null };
}

// ── Displacement (impulse) ───────────────────────────────────────────────────

export interface Displacement {
  dir: Dir;
  startTs: number;
  endTs: number;
  startPrice: number;
  endPrice: number;
  bodyRatio: number; // size vs recent average range
}

/**
 * Displacement = a run of strong same-direction candles whose bodies dwarf the
 * recent average range. We scan for candles whose body ≥ `mult`× the trailing
 * `lookback`-bar average true range, then merge consecutive same-direction
 * impulse candles into one leg.
 */
export function detectDisplacement(candles: IctCandle[], lookback = 14, mult = 1.6): Displacement[] {
  if (candles.length < lookback + 2) return [];
  const ranges = candles.map((c) => c.high - c.low);
  const out: Displacement[] = [];
  let cur: Displacement | null = null;
  for (let i = lookback; i < candles.length; i++) {
    const c = candles[i];
    let avg = 0;
    for (let j = i - lookback; j < i; j++) avg += ranges[j];
    avg /= lookback;
    const body = Math.abs(c.close - c.open);
    const dir: Dir = c.close >= c.open ? "bull" : "bear";
    const strong = avg > 0 && body >= avg * mult;
    if (strong) {
      if (cur && cur.dir === dir) {
        cur.endTs = c.timestamp; cur.endPrice = c.close;
        cur.bodyRatio = Math.max(cur.bodyRatio, body / avg);
      } else {
        if (cur) out.push(cur);
        cur = { dir, startTs: candles[i - 1].timestamp, endTs: c.timestamp,
                startPrice: candles[i - 1].open, endPrice: c.close, bodyRatio: body / avg };
      }
    } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

// ── Order Blocks ─────────────────────────────────────────────────────────────

export interface OrderBlock {
  dir: Dir;          // bull OB = demand (last down candle before up impulse)
  top: number;
  bottom: number;
  ts: number;        // timestamp of the OB candle
  mitigated: boolean;
}

/**
 * Order block = the last opposing candle immediately before a displacement leg.
 * Bullish OB (demand) = last bearish candle before a bullish impulse; bearish
 * OB (supply) = last bullish candle before a bearish impulse. Range = that
 * candle's high/low. Marked mitigated once price returns into it.
 */
export function detectOrderBlocks(candles: IctCandle[], disp: Displacement[]): OrderBlock[] {
  const byTs = new Map<number, number>();
  candles.forEach((c, i) => byTs.set(c.timestamp, i));
  const out: OrderBlock[] = [];
  for (const d of disp) {
    const startIdx = byTs.get(d.startTs);
    if (startIdx == null) continue;
    // Walk back to the last candle of the OPPOSITE colour before the impulse.
    let obIdx = -1;
    for (let k = startIdx; k >= Math.max(0, startIdx - 6); k--) {
      const c = candles[k];
      const cDir: Dir = c.close >= c.open ? "bull" : "bear";
      if (cDir !== d.dir) { obIdx = k; break; }
    }
    if (obIdx < 0) continue;
    const ob = candles[obIdx];
    out.push({
      dir: d.dir,
      top: ob.high,
      bottom: ob.low,
      ts: ob.timestamp,
      mitigated: candles.slice(obIdx + 2).some((c) =>
        d.dir === "bull" ? c.low <= ob.high && c.low >= ob.low : c.high >= ob.low && c.high <= ob.high),
    });
  }
  // De-dup by ts.
  const seen = new Set<number>();
  return out.filter((o) => (seen.has(o.ts) ? false : (seen.add(o.ts), true)));
}

// ── Swing pivots + market structure ──────────────────────────────────────────

export interface Pivot { type: "high" | "low"; price: number; ts: number; idx: number; }

/** Fractal swing pivots: a high higher than `k` bars each side (and vice versa). */
export function detectPivots(candles: IctCandle[], k = 2): Pivot[] {
  const out: Pivot[] = [];
  for (let i = k; i < candles.length - k; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) out.push({ type: "high", price: candles[i].high, ts: candles[i].timestamp, idx: i });
    if (isLow) out.push({ type: "low", price: candles[i].low, ts: candles[i].timestamp, idx: i });
  }
  return out.sort((a, b) => a.idx - b.idx);
}

export interface StructureEvent {
  kind: "BOS" | "CHOCH" | "MSS";
  dir: Dir;          // direction of the break
  price: number;     // the swing level that was broken
  ts: number;        // timestamp of the candle that broke it
}

/**
 * Market structure from the close sequence vs swing pivots.
 *   • BOS   — break of a swing in the SAME direction as the prevailing trend
 *             (continuation).
 *   • CHOCH — first break AGAINST the prevailing trend (trend reversal sign).
 *   • MSS   — a CHOCH that is confirmed by displacement through the level
 *             (we flag the CHOCH as MSS when the breaking candle body is large).
 */
export function detectStructure(candles: IctCandle[], pivots: Pivot[]): StructureEvent[] {
  const events: StructureEvent[] = [];
  if (!pivots.length) return events;
  let trend: Dir | null = null;
  let lastHigh: Pivot | null = null;
  let lastLow: Pivot | null = null;

  // Average body for the MSS displacement test.
  const avgBody = candles.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / Math.max(1, candles.length);

  let pi = 0;
  for (let i = 0; i < candles.length; i++) {
    // Absorb any pivots confirmed at/before this bar.
    while (pi < pivots.length && pivots[pi].idx <= i) {
      const p = pivots[pi];
      if (p.type === "high") lastHigh = p; else lastLow = p;
      pi++;
    }
    const c = candles[i];
    const body = Math.abs(c.close - c.open);
    // Break of swing high (bullish break).
    if (lastHigh && c.close > lastHigh.price && lastHigh.idx < i) {
      const kind = trend === "bear" ? (body >= avgBody * 1.6 ? "MSS" : "CHOCH") : "BOS";
      events.push({ kind, dir: "bull", price: lastHigh.price, ts: c.timestamp });
      trend = "bull"; lastHigh = null;
    }
    // Break of swing low (bearish break).
    else if (lastLow && c.close < lastLow.price && lastLow.idx < i) {
      const kind = trend === "bull" ? (body >= avgBody * 1.6 ? "MSS" : "CHOCH") : "BOS";
      events.push({ kind, dir: "bear", price: lastLow.price, ts: c.timestamp });
      trend = "bear"; lastLow = null;
    }
  }
  return events;
}

// ── Liquidity pools (BSL / SSL) ──────────────────────────────────────────────

export interface LiquidityPool {
  side: "BSL" | "SSL"; // buy-side (above) / sell-side (below)
  price: number;
  ts: number;          // most recent touch
  count: number;       // how many swings cluster here (equal highs/lows)
  swept: boolean;      // has price traded beyond it after formation?
}

/**
 * Liquidity = resting orders at swing highs (BSL) / lows (SSL). We cluster
 * pivots whose prices are within `tol` and report each cluster as a pool, with
 * a "swept" flag when a later candle pierced it.
 */
export function detectLiquidity(candles: IctCandle[], pivots: Pivot[], tolTicks = 4, tick = 0.25): LiquidityPool[] {
  const tol = tolTicks * tick;
  const highs = pivots.filter((p) => p.type === "high");
  const lows = pivots.filter((p) => p.type === "low");
  const lastTs = candles.length ? candles[candles.length - 1].timestamp : 0;

  const cluster = (ps: Pivot[], side: "BSL" | "SSL"): LiquidityPool[] => {
    const used = new Array(ps.length).fill(false);
    const pools: LiquidityPool[] = [];
    for (let i = 0; i < ps.length; i++) {
      if (used[i]) continue;
      const group = [ps[i]]; used[i] = true;
      for (let j = i + 1; j < ps.length; j++) {
        if (!used[j] && Math.abs(ps[j].price - ps[i].price) <= tol) { group.push(ps[j]); used[j] = true; }
      }
      const price = group.reduce((s, g) => s + g.price, 0) / group.length;
      const ts = Math.max(...group.map((g) => g.ts));
      const swept = candles.some((c) => c.timestamp > ts && (side === "BSL" ? c.high > price + tol : c.low < price - tol));
      pools.push({ side, price, ts, count: group.length, swept });
    }
    return pools;
  };
  const pools = [...cluster(highs, "BSL"), ...cluster(lows, "SSL")];
  // Prefer the freshest, multi-touch, unswept pools near the end of the session.
  return pools
    .sort((a, b) => (b.count - a.count) || (b.ts - a.ts))
    .filter((p) => lastTs - p.ts < 30 * 60 * 60 * 1000);
}

// ── Premium / Discount + OTE ─────────────────────────────────────────────────

export interface DealingRange {
  high: number;
  low: number;
  eq: number;       // equilibrium (0.5)
  premiumFrom: number; // = eq (above eq = premium)
  discountTo: number;  // = eq (below eq = discount)
  ote: { from: number; to: number }; // 0.62–0.79 retrace zone, dir-aware
  dir: Dir;         // leg direction the OTE is measured against
}

/**
 * Dealing range = the most recent confirmed swing-high↔swing-low leg. Premium =
 * above equilibrium (0.5), discount = below. OTE = 0.62–0.79 retracement of the
 * leg (the ICT optimal-trade-entry band).
 */
export function dealingRange(pivots: Pivot[]): DealingRange | null {
  const hi = [...pivots].reverse().find((p) => p.type === "high");
  const lo = [...pivots].reverse().find((p) => p.type === "low");
  if (!hi || !lo) return null;
  const high = hi.price, low = lo.price;
  if (!(high > low)) return null;
  const eq = (high + low) / 2;
  const span = high - low;
  // Leg direction: whichever pivot is more recent defines the impulse we retrace.
  const dir: Dir = hi.idx > lo.idx ? "bull" : "bear";
  const ote = dir === "bull"
    ? { from: high - span * 0.62, to: high - span * 0.79 }   // retrace down into discount
    : { from: low + span * 0.62, to: low + span * 0.79 };     // retrace up into premium
  return { high, low, eq, premiumFrom: eq, discountTo: eq, ote, dir };
}

// ── Kill zones / Silver Bullet / Macros ──────────────────────────────────────

export interface TimeWindow {
  id: string;
  label: string;
  startMin: number; // minutes since ET midnight
  endMin: number;
  kind: "killzone" | "silver" | "macro";
}

// ICT time windows in ET (New York local). Source: innercircletrader.net.
export const ICT_WINDOWS: TimeWindow[] = [
  { id: "asia",     label: "Asian Killzone",     startMin: 20 * 60,        endMin: 24 * 60,        kind: "killzone" },
  { id: "london",   label: "London Killzone",    startMin: 2 * 60,         endMin: 5 * 60,         kind: "killzone" },
  { id: "nyam",     label: "NY AM Killzone",     startMin: 7 * 60,         endMin: 9 * 60,         kind: "killzone" },
  { id: "nypm",     label: "NY PM Killzone",     startMin: 13 * 60 + 30,   endMin: 16 * 60,        kind: "killzone" },
  { id: "silver1",  label: "Silver Bullet (AM)", startMin: 10 * 60,        endMin: 11 * 60,        kind: "silver" },
  { id: "silver2",  label: "Silver Bullet (PM)", startMin: 14 * 60,        endMin: 15 * 60,        kind: "silver" },
  { id: "macroAm",  label: "NY AM Macro",        startMin: 9 * 60 + 50,    endMin: 10 * 60 + 10,   kind: "macro" },
  { id: "macroPm",  label: "NY PM Macro",        startMin: 13 * 60 + 10,   endMin: 13 * 60 + 40,   kind: "macro" },
];

/** Which ICT windows is a timestamp currently inside? */
export function activeWindows(ts: number): TimeWindow[] {
  const m = etMinutes(ts);
  return ICT_WINDOWS.filter((w) =>
    w.startMin <= w.endMin ? m >= w.startMin && m < w.endMin : m >= w.startMin || m < w.endMin);
}

// ── Daily bias ───────────────────────────────────────────────────────────────

export interface DailyBias {
  dir: Dir | "neutral";
  reason: string;
  prevHigh: number | null;
  prevLow: number | null;
}

/**
 * Lightweight daily bias: compare today's developing close vs the prior day's
 * range and the net displacement of the session. Bullish when price is working
 * above the prior-day midpoint with net bullish displacement (aiming for PDH /
 * BSL); bearish in the mirror case (aiming for PDL / SSL).
 */
export function dailyBias(candles: IctCandle[]): DailyBias {
  if (!candles.length) return { dir: "neutral", reason: "no data", prevHigh: null, prevLow: null };
  const days = [...new Set(candles.map((c) => c.date || etDate(c.timestamp)))].sort();
  if (days.length < 2) return { dir: "neutral", reason: "need prior session", prevHigh: null, prevLow: null };
  const today = days[days.length - 1], prev = days[days.length - 2];
  let ph = -Infinity, pl = Infinity;
  for (const c of candles) {
    const d = c.date || etDate(c.timestamp);
    if (d === prev) { if (c.high > ph) ph = c.high; if (c.low < pl) pl = c.low; }
  }
  const todays = candles.filter((c) => (c.date || etDate(c.timestamp)) === today);
  if (!todays.length || !Number.isFinite(ph)) return { dir: "neutral", reason: "session forming", prevHigh: null, prevLow: null };
  const last = todays[todays.length - 1].close;
  const mid = (ph + pl) / 2;
  if (last > mid) return { dir: "bull", reason: "trading above prior-day midpoint → draw on PDH / BSL", prevHigh: ph, prevLow: pl };
  if (last < mid) return { dir: "bear", reason: "trading below prior-day midpoint → draw on PDL / SSL", prevHigh: ph, prevLow: pl };
  return { dir: "neutral", reason: "at prior-day equilibrium", prevHigh: ph, prevLow: pl };
}

// ── Aggregate ────────────────────────────────────────────────────────────────

export interface IctAnalysis {
  fvgs: FVG[];
  displacement: Displacement[];
  orderBlocks: OrderBlock[];
  pivots: Pivot[];
  structure: StructureEvent[];
  liquidity: LiquidityPool[];
  range: DealingRange | null;
  bias: DailyBias;
}

/** One call → every ICT read for the candle set. */
export function analyzeICT(candles: IctCandle[]): IctAnalysis {
  const pivots = detectPivots(candles, 2);
  const displacement = detectDisplacement(candles);
  return {
    fvgs: detectFVGs(candles),
    displacement,
    orderBlocks: detectOrderBlocks(candles, displacement),
    pivots,
    structure: detectStructure(candles, pivots),
    liquidity: detectLiquidity(candles, pivots),
    range: dealingRange(pivots),
    bias: dailyBias(candles),
  };
}
