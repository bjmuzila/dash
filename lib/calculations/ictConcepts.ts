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
  dir: Dir;          // ORIGINAL gap direction
  top: number;       // upper price bound of the gap
  bottom: number;    // lower price bound of the gap
  startTs: number;   // timestamp of candle 1
  ts: number;        // timestamp of candle 3 (gap confirmed here)
  mitigated: boolean;     // a later candle traded into the void (first touch)
  mitigatedTs: number | null;
  retouched: boolean;     // touched AGAIN after the first mitigation → box ends here
  retouchedTs: number | null;
  endTs: number | null;   // x where the box stops extending (2nd touch / break); null = still live to right edge
  spent: boolean;         // closed fully THROUGH the far side (gap is consumed)
  // Inversion: the gap was fully traded THROUGH (closed beyond the far side) AND
  // that break swept a liquidity pool → it flips polarity into an IFVG. When
  // inverted, `activeDir` is the NEW (opposite) direction the zone now defends.
  inverted: boolean;
  invertedTs: number | null;
  activeDir: Dir;    // dir the zone currently acts on (= dir, or flipped if inverted)
}

/**
 * 3-candle FVG: bullish gap = candle1.high < candle3.low (price ran up leaving
 * an unfilled void); bearish gap = candle1.low > candle3.high. A gap is
 * "mitigated" once a later candle trades back into the void. `minTicks` filters
 * noise gaps (ES tick = 0.25).
 *
 * Inversion (IFVG): if a later candle CLOSES fully through the gap (past the far
 * edge) and that same candle swept a liquidity pool (`sweepTimes`), the gap is
 * marked `inverted` and its `activeDir` flips — a broken bullish FVG becomes
 * bearish resistance and vice versa. Mitigated-but-not-inverted gaps are still
 * flagged so the caller can drop them from the display.
 */
export function detectFVGs(
  candles: IctCandle[],
  minTicks = 1,
  tick = 0.25,
  sweepTimes: Set<number> = new Set()
): FVG[] {
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
  for (const f of out) {
    for (let j = 0; j < candles.length; j++) {
      const k = candles[j];
      if (k.timestamp <= f.ts) continue;
      // Touched the void. First touch → mitigated. A LATER touch on a different
      // candle → retouched (the gap has now been used twice; caller removes it).
      const into = f.dir === "bull" ? k.low <= f.top : k.high >= f.bottom;
      if (into) {
        if (!f.mitigated) { f.mitigated = true; f.mitigatedTs = k.timestamp; }
        else if (f.mitigatedTs != null && k.timestamp > f.mitigatedTs && !f.retouched) {
          // 2nd time price passes through → the box ENDS here and is done.
          f.retouched = true; f.retouchedTs = k.timestamp; f.endTs = k.timestamp;
          break;
        }
      }
      // CLOSED fully through the far side → candidate inversion.
      const through = f.dir === "bull" ? k.close < f.bottom : k.close > f.top;
      if (through) {
        f.spent = true;
        if (f.endTs == null) f.endTs = k.timestamp; // box stops at the break
        // Only flips to an IFVG if that break also swept liquidity.
        if (sweepTimes.has(k.timestamp)) {
          f.inverted = true;
          f.invertedTs = k.timestamp;
          f.activeDir = f.dir === "bull" ? "bear" : "bull";
        }
        break; // the gap is spent either way (kept if inverted, dropped if not)
      }
    }
  }
  return out;
}
function mkFvg(dir: Dir, top: number, bottom: number, startTs: number, ts: number): FVG {
  return { dir, top, bottom, startTs, ts, mitigated: false, mitigatedTs: null,
           retouched: false, retouchedTs: null, endTs: null,
           spent: false, inverted: false, invertedTs: null, activeDir: dir };
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
  swept: boolean;        // OB candle took liquidity (broke prior candle's extreme)
  hasImbalance: boolean; // an FVG/imbalance followed the OB (validates it)
  valid: boolean;        // swept AND hasImbalance — a textbook ICT order block
}

/**
 * Order block = the last opposing candle before a displacement leg, refined to
 * the ICT definition (per LiteFinance/ICT): a true OB also (1) SWEEPS LIQUIDITY
 * — the bearish OB candle breaks below the previous low (bullish OB) / the
 * bullish OB candle breaks above the previous high (bearish OB) — and (2) is
 * followed by an IMBALANCE (an FVG in the impulse away from it). We still emit
 * the raw block but flag `swept`, `hasImbalance` and `valid` so the page can
 * draw validated blocks solidly and weak ones faintly.
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
    const prev = candles[obIdx - 1];
    // Liquidity sweep: bullish OB (a down candle) should dip below the prior low;
    // bearish OB (an up candle) should poke above the prior high.
    const swept = !prev ? false :
      d.dir === "bull" ? ob.low < prev.low : ob.high > prev.high;
    // Imbalance after the OB: a 3-candle FVG straddling the impulse out of it.
    const a = candles[obIdx + 1], c3 = candles[obIdx + 3];
    const hasImbalance = !!a && !!c3 && (d.dir === "bull" ? c3.low > a.high : c3.high < a.low);
    out.push({
      dir: d.dir,
      top: ob.high,
      bottom: ob.low,
      ts: ob.timestamp,
      mitigated: candles.slice(obIdx + 2).some((c) =>
        d.dir === "bull" ? c.low <= ob.high && c.low >= ob.low : c.high >= ob.low && c.high <= ob.high),
      swept,
      hasImbalance,
      valid: swept && hasImbalance,
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

/**
 * Timestamps of candles that SWEPT a liquidity pool — i.e. pierced beyond a
 * clustered swing high (BSL) or low (SSL) that formed earlier. Used to qualify
 * an FVG break as an inversion (IFVG): a gap that breaks while sweeping
 * liquidity flips polarity instead of being discarded.
 */
export function liquiditySweepTimes(candles: IctCandle[], pools: LiquidityPool[], tolTicks = 4, tick = 0.25): Set<number> {
  const tol = tolTicks * tick;
  const sweeps = new Set<number>();
  for (const p of pools) {
    for (const c of candles) {
      if (c.timestamp <= p.ts) continue;
      const pierced = p.side === "BSL" ? c.high > p.price + tol : c.low < p.price - tol;
      if (pierced) { sweeps.add(c.timestamp); break; } // first candle to take the pool
    }
  }
  return sweeps;
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
  { id: "nyam",     label: "NY AM Killzone",     startMin: 7 * 60,         endMin: 10 * 60,        kind: "killzone" },
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

// ── Signal (generic point-in-time event for the simpler models) ──────────────

export interface IctSignal {
  kind: "inducement" | "turtleSoup" | "judas" | "breaker" | "cisd" | "model2022";
  dir: Dir;
  price: number;
  ts: number;
  note?: string;
}

// ── Inducement (IDM) ─────────────────────────────────────────────────────────
/**
 * Inducement = a minor swing that gets swept just before the real move. Heuristic:
 * a short-term pivot whose level is taken (wick beyond it) by a LATER candle that
 * then closes back on the original side — a trap sweep. We tag the sweeping
 * candle. dir = the expected real-move direction (opposite the sweep).
 */
export function detectInducement(candles: IctCandle[], pivots: Pivot[]): IctSignal[] {
  const out: IctSignal[] = [];
  const byIdx = pivots;
  for (const p of byIdx) {
    for (let i = p.idx + 1; i < Math.min(candles.length, p.idx + 12); i++) {
      const c = candles[i];
      if (p.type === "high") {
        if (c.high > p.price && c.close < p.price) { // swept the high, closed back below
          out.push({ kind: "inducement", dir: "bear", price: p.price, ts: c.timestamp, note: "buy-side swept" });
          break;
        }
      } else {
        if (c.low < p.price && c.close > p.price) { // swept the low, closed back above
          out.push({ kind: "inducement", dir: "bull", price: p.price, ts: c.timestamp, note: "sell-side swept" });
          break;
        }
      }
    }
  }
  return dedupeByTs(out);
}

// ── Turtle Soup ──────────────────────────────────────────────────────────────
/**
 * Turtle Soup = false breakout at relative-equal highs/lows, then reversal.
 * Heuristic: a liquidity pool (clustered equal H/L, count ≥ 2) that gets swept
 * by a candle which closes back inside — the classic failed-breakout reversal.
 */
export function detectTurtleSoup(candles: IctCandle[], pools: LiquidityPool[], tolTicks = 4, tick = 0.25): IctSignal[] {
  const tol = tolTicks * tick;
  const out: IctSignal[] = [];
  for (const p of pools) {
    if (p.count < 2) continue; // needs relative-equal cluster
    for (const c of candles) {
      if (c.timestamp <= p.ts) continue;
      if (p.side === "BSL" && c.high > p.price + tol && c.close < p.price) {
        out.push({ kind: "turtleSoup", dir: "bear", price: p.price, ts: c.timestamp, note: "EQH swept, failed" });
        break;
      }
      if (p.side === "SSL" && c.low < p.price - tol && c.close > p.price) {
        out.push({ kind: "turtleSoup", dir: "bull", price: p.price, ts: c.timestamp, note: "EQL swept, failed" });
        break;
      }
    }
  }
  return dedupeByTs(out);
}

// ── Judas Swing ──────────────────────────────────────────────────────────────
/**
 * Judas Swing = the false move right after a session open that reverses. ICT
 * frames it at the London (2:00 ET) and NY (9:30 ET) opens. Heuristic: in the
 * first hour after the open, price pushes one way (sweeps the open's initial
 * extreme) then closes back through the open price → the real move is opposite.
 */
export function detectJudas(candles: IctCandle[]): IctSignal[] {
  const out: IctSignal[] = [];
  const opens = [120, 570]; // London 02:00, NY 09:30 (minutes ET)
  const days = [...new Set(candles.map((c) => c.date || etDate(c.timestamp)))];
  for (const day of days) {
    const dayBars = candles.filter((c) => (c.date || etDate(c.timestamp)) === day);
    for (const openMin of opens) {
      // First bar at/after the open, plus the next ~12 bars (1h).
      const win = dayBars.filter((c) => { const m = etMinutes(c.timestamp); return m >= openMin && m < openMin + 60; });
      if (win.length < 3) continue;
      const openPx = win[0].open;
      let hi = -Infinity, lo = Infinity, hiTs = 0, loTs = 0;
      for (const c of win) { if (c.high > hi) { hi = c.high; hiTs = c.timestamp; } if (c.low < lo) { lo = c.low; loTs = c.timestamp; } }
      const last = win[win.length - 1].close;
      // Pushed up first then closed below open → bearish Judas (real move down).
      if (hiTs < loTs && last < openPx) out.push({ kind: "judas", dir: "bear", price: hi, ts: hiTs, note: "false high at open" });
      else if (loTs < hiTs && last > openPx) out.push({ kind: "judas", dir: "bull", price: lo, ts: loTs, note: "false low at open" });
    }
  }
  return dedupeByTs(out);
}

// ── Breaker Block ────────────────────────────────────────────────────────────
/**
 * Breaker = an order block that price breaks structure through, then retests
 * from the other side as continuation S/R. Heuristic: for each structure break,
 * take the opposing OB just before it; if a later candle returns to that OB zone
 * after the break, it's an active breaker in the break direction.
 */
export function detectBreakers(candles: IctCandle[], obs: OrderBlock[], structure: StructureEvent[]): IctSignal[] {
  const out: IctSignal[] = [];
  for (const s of structure) {
    // OB on the opposite side of the break, formed before it.
    const ob = obs
      .filter((o) => o.ts < s.ts && o.dir !== s.dir)
      .sort((a, b) => b.ts - a.ts)[0];
    if (!ob) continue;
    const retest = candles.some((c) => c.timestamp > s.ts && c.low <= ob.top && c.high >= ob.bottom);
    if (retest) out.push({ kind: "breaker", dir: s.dir, price: s.dir === "bull" ? ob.top : ob.bottom, ts: s.ts, note: "OB flipped on BOS" });
  }
  return dedupeByTs(out);
}

// ── CISD (Change in State of Delivery) ───────────────────────────────────────
/**
 * CISD = the first opposing close after a run of same-direction deliveries.
 * Heuristic: ≥3 consecutive same-colour closes, then a candle that closes back
 * through the open of the FIRST candle in that run → delivery state flips.
 */
export function detectCISD(candles: IctCandle[], minRun = 3): IctSignal[] {
  const out: IctSignal[] = [];
  let i = 0;
  while (i < candles.length) {
    const dir: Dir = candles[i].close >= candles[i].open ? "bull" : "bear";
    let j = i;
    while (j + 1 < candles.length && (candles[j + 1].close >= candles[j + 1].open ? "bull" : "bear") === dir) j++;
    const runLen = j - i + 1;
    if (runLen >= minRun && j + 1 < candles.length) {
      const runOpen = candles[i].open;
      const next = candles[j + 1];
      if (dir === "bull" && next.close < runOpen) out.push({ kind: "cisd", dir: "bear", price: runOpen, ts: next.timestamp, note: "delivery flipped down" });
      if (dir === "bear" && next.close > runOpen) out.push({ kind: "cisd", dir: "bull", price: runOpen, ts: next.timestamp, note: "delivery flipped up" });
    }
    i = j + 1;
  }
  return dedupeByTs(out);
}

// ── 2022 Model ───────────────────────────────────────────────────────────────
/**
 * The "2022 model": liquidity sweep (Turtle Soup) → MSS → entry on the resulting
 * FVG/IFVG in the break direction. Heuristic: a Turtle-Soup signal followed
 * within ~10 bars by a same-direction MSS, with an FVG present after the MSS.
 */
export function detect2022Model(turtle: IctSignal[], structure: StructureEvent[], fvgs: FVG[]): IctSignal[] {
  const out: IctSignal[] = [];
  for (const ts of turtle) {
    const mss = structure.find((s) => s.kind === "MSS" && s.dir === ts.dir && s.ts > ts.ts && s.ts - ts.ts <= 10 * 300_000);
    if (!mss) continue;
    const fvg = fvgs.find((f) => f.activeDir === ts.dir && f.ts >= mss.ts && f.ts - mss.ts <= 10 * 300_000);
    if (fvg) out.push({ kind: "model2022", dir: ts.dir, price: mss.price, ts: mss.ts, note: "sweep→MSS→FVG" });
  }
  return dedupeByTs(out);
}

// ── Power of 3 (PO3 / AMD) ───────────────────────────────────────────────────
export interface PO3 {
  date: string;
  accLow: number; accHigh: number;   // Asian accumulation range
  manipExtreme: number | null;       // London manipulation wick
  manipDir: Dir | null;
  distDir: Dir | null;               // NY distribution direction
}
/**
 * Daily Accumulation→Manipulation→Distribution read. Asian range (20:00–24:00
 * ET prior) = accumulation; the London session extreme that pokes outside it =
 * manipulation; the NY close relative to the Asian range = distribution dir.
 */
export function detectPO3(candles: IctCandle[]): PO3[] {
  const out: PO3[] = [];
  const days = [...new Set(candles.map((c) => c.date || etDate(c.timestamp)))].sort();
  for (const day of days) {
    const bars = candles.filter((c) => (c.date || etDate(c.timestamp)) === day);
    const asia = bars.filter((c) => { const m = etMinutes(c.timestamp); return m >= 1200 || m < 120; });
    const london = bars.filter((c) => { const m = etMinutes(c.timestamp); return m >= 120 && m < 420; });
    const ny = bars.filter((c) => { const m = etMinutes(c.timestamp); return m >= 570 && m < 960; });
    if (!asia.length) continue;
    const accLow = Math.min(...asia.map((c) => c.low));
    const accHigh = Math.max(...asia.map((c) => c.high));
    let manipExtreme: number | null = null, manipDir: Dir | null = null;
    for (const c of london) {
      if (c.high > accHigh && (manipExtreme == null || c.high > manipExtreme)) { manipExtreme = c.high; manipDir = "bull"; }
      if (c.low < accLow && (manipExtreme == null || c.low < manipExtreme)) { manipExtreme = c.low; manipDir = "bear"; }
    }
    let distDir: Dir | null = null;
    if (ny.length) { const close = ny[ny.length - 1].close; distDir = close > (accHigh + accLow) / 2 ? "bull" : "bear"; }
    out.push({ date: day, accLow, accHigh, manipExtreme, manipDir, distDir });
  }
  return out;
}

// ── IRL / ERL (Internal vs External Range Liquidity) ─────────────────────────
export interface RangeLiquidity {
  erlHigh: number | null; erlLow: number | null;     // external = dealing-range swing extremes
  internal: Array<{ top: number; bottom: number; kind: "fvg" | "ob" }>; // internal liquidity inside the range
}
/**
 * ERL = the swing high/low extremes of the active dealing range. IRL = the FVGs
 * and order blocks sitting INSIDE that range (price oscillates IRL↔ERL).
 */
export function detectRangeLiquidity(range: DealingRange | null, fvgs: FVG[], obs: OrderBlock[]): RangeLiquidity {
  if (!range) return { erlHigh: null, erlLow: null, internal: [] };
  const inRange = (top: number, bottom: number) => bottom >= range.low && top <= range.high;
  const internal: RangeLiquidity["internal"] = [];
  for (const f of fvgs) if (!f.spent && inRange(f.top, f.bottom)) internal.push({ top: f.top, bottom: f.bottom, kind: "fvg" });
  for (const o of obs) if (!o.mitigated && inRange(o.top, o.bottom)) internal.push({ top: o.top, bottom: o.bottom, kind: "ob" });
  return { erlHigh: range.high, erlLow: range.low, internal };
}

// ── Candle Range Theory (CRT) ────────────────────────────────────────────────
export interface CRT {
  hi: number; lo: number; eq: number;  // range candle high/low/equilibrium
  ts: number;                          // the range candle (most recent completed HTF-ish candle)
  sweep: Dir | null;                   // which extreme the next bars swept
}
/**
 * CRT framed on the prior completed hour: that hour's H/L is the range, its mid
 * the equilibrium. We then see which extreme the following bars swept (the
 * expected delivery is toward the opposite extreme).
 */
export function detectCRT(candles: IctCandle[]): CRT | null {
  if (candles.length < 14) return null;
  // Group the last ~3h into hourly buckets (ET), use the most recent COMPLETED hour.
  const hourKey = (ts: number) => `${etDate(ts)}-${Math.floor(etMinutes(ts) / 60)}`;
  const groups = new Map<string, IctCandle[]>();
  for (const c of candles) {
    const k = hourKey(c.timestamp);
    const arr = groups.get(k);
    if (arr) arr.push(c); else groups.set(k, [c]);
  }
  const keys = [...groups.keys()];
  if (keys.length < 2) return null;
  const rangeKey = keys[keys.length - 2]; // prior completed hour
  const bars = groups.get(rangeKey)!;
  const hi = Math.max(...bars.map((c) => c.high));
  const lo = Math.min(...bars.map((c) => c.low));
  const eq = (hi + lo) / 2;
  const ts = bars[0].timestamp;
  const after = candles.filter((c) => c.timestamp > bars[bars.length - 1].timestamp);
  let sweep: Dir | null = null;
  for (const c of after) { if (c.high > hi) { sweep = "bull"; break; } if (c.low < lo) { sweep = "bear"; break; } }
  return { hi, lo, eq, ts, sweep };
}

function dedupeByTs<T extends { ts: number; kind?: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  return arr.filter((x) => { const k = `${x.kind ?? ""}:${x.ts}`; return seen.has(k) ? false : (seen.add(k), true); });
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
  // Newly auto-detected models:
  inducement: IctSignal[];
  turtleSoup: IctSignal[];
  judas: IctSignal[];
  breakers: IctSignal[];
  cisd: IctSignal[];
  model2022: IctSignal[];
  po3: PO3[];
  rangeLiquidity: RangeLiquidity;
  crt: CRT | null;
}

/** One call → every ICT read for the candle set. */
export function analyzeICT(candles: IctCandle[]): IctAnalysis {
  const pivots = detectPivots(candles, 2);
  const displacement = detectDisplacement(candles);
  // Liquidity first → its sweep timestamps qualify which FVG breaks invert (IFVG).
  const liquidity = detectLiquidity(candles, pivots);
  const sweepTimes = liquiditySweepTimes(candles, liquidity);
  const fvgs = detectFVGs(candles, 8, 0.25, sweepTimes);
  const orderBlocks = detectOrderBlocks(candles, displacement);
  const structure = detectStructure(candles, pivots);
  const range = dealingRange(pivots);
  const turtleSoup = detectTurtleSoup(candles, liquidity);
  return {
    fvgs,
    displacement,
    orderBlocks,
    pivots,
    structure,
    liquidity,
    range,
    bias: dailyBias(candles),
    inducement: detectInducement(candles, pivots),
    turtleSoup,
    judas: detectJudas(candles),
    breakers: detectBreakers(candles, orderBlocks, structure),
    cisd: detectCISD(candles),
    model2022: detect2022Model(turtleSoup, structure, fvgs),
    po3: detectPO3(candles),
    rangeLiquidity: detectRangeLiquidity(range, fvgs, orderBlocks),
    crt: detectCRT(candles),
  };
}
