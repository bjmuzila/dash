// ─── Fail-level detection ────────────────────────────────────────────────────
// Look-above-and-fail / look-below-and-fail tracking against key reference
// levels (overnight H/L, previous-day H/L, previous-week H/L), computed entirely
// from the 5-minute ES futures candles already streamed by useEsCandles.
//
// All math is done in ES points. The caller converts level prices to SPX-display
// values via the live basis (esFut - spx) if desired.

import type { EsCandle } from "@/hooks/useEsCandles";

export type LevelKind =
  | "onHigh" | "onLow"          // overnight high / low
  | "pdHigh" | "pdLow"          // previous day high / low
  | "pwHigh" | "pwLow";         // previous week high / low

export type Direction = "above" | "below";

export interface RefLevel {
  kind: LevelKind;
  label: string;       // "Overnight High"
  short: string;       // "ON-H"
  price: number;       // ES points
  side: Direction;     // which side a *break* would be (high levels -> above)
}

export interface FailEvent {
  kind: LevelKind;
  label: string;
  short: string;
  direction: Direction;      // "above" = look-above-and-fail (rejection from above)
  level: number;             // ES level price
  pierceTs: number;          // ts of the bar that first pierced
  failTs: number;            // ts of the bar that confirmed the fail (close back through)
  extreme: number;           // furthest the price poked past the level (ES)
  pokePts: number;           // |extreme - level|
  closeBack: number;         // close of the failing bar (ES)
  followThruPts: number;     // how far price ran the *other* way after the fail (ES)
}

export interface LevelStatus {
  level: RefLevel;
  state: "idle" | "testing" | "above" | "below" | "failed";
  // "testing": price currently poking past the level (not yet confirmed)
  // "above"/"below": price is cleanly on that side (broken & holding)
  // "failed": most recent interaction today was a fail back through
  lastEvent: FailEvent | null;
  distancePts: number | null;   // signed distance of last close to level (close - level)
}

export interface FailStat {
  kind: LevelKind;
  label: string;
  tests: number;        // total interactions (pierces) over the window
  fails: number;        // how many of those rejected (failed back through)
  breaks: number;       // how many followed through (held the break)
  failRate: number;     // fails / tests, 0..1
}

// ── ET helpers ────────────────────────────────────────────────────────────────

function etParts(ts: number) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ts));
  const m: Record<string, string> = {};
  p.forEach((x) => { m[x.type] = x.value; });
  const hh = m.hour === "24" ? "00" : m.hour;
  return {
    date: `${m.year}-${m.month}-${m.day}`,
    minutes: Number(hh) * 60 + Number(m.minute),
  };
}

const RTH_OPEN = 9 * 60 + 30;   // 09:30 ET
const RTH_CLOSE = 16 * 60;      // 16:00 ET

function isRthBar(ts: number): boolean {
  const { minutes } = etParts(ts);
  return minutes >= RTH_OPEN && minutes < RTH_CLOSE;
}

// Distinct sorted trading dates present in the candle set.
function tradingDates(candles: EsCandle[]): string[] {
  return [...new Set(candles.map((c) => c.date).filter(Boolean))].sort();
}

// Sunday-anchored ISO-ish week key (YYYY-Www) so "previous week" groups cleanly.
function weekKey(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function hiLo(bars: EsCandle[]): { high: number; low: number } | null {
  if (!bars.length) return null;
  let high = -Infinity, low = Infinity;
  for (const b of bars) {
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
  }
  return Number.isFinite(high) && Number.isFinite(low) ? { high, low } : null;
}

// ── Reference levels ────────────────────────────────────────────────────────────

/**
 * Build the reference levels relevant to *today*:
 *   overnight H/L  — the prior 18:00 ET → today 09:30 ET globex session
 *   prev-day H/L   — last completed RTH session before today
 *   prev-week H/L  — full range of the most recent completed prior week
 */
export function computeRefLevels(candles: EsCandle[], todayDate: string): RefLevel[] {
  const out: RefLevel[] = [];
  if (!candles.length) return out;

  // Overnight: all bars dated yesterday after RTH close + today before RTH open.
  // Simpler & robust: every non-RTH bar whose ET date is today OR the prior
  // session date, that occurs before today's RTH open.
  const onBars = candles.filter((c) => {
    if (c.date > todayDate) return false;
    const { date, minutes } = etParts(c.timestamp);
    if (date === todayDate) return minutes < RTH_OPEN;           // today, pre-open
    // prior session evening (after the previous RTH close)
    return minutes >= RTH_CLOSE;
  });
  // Keep only the most recent overnight block (today pre-open + nearest prior eve).
  const dates = tradingDates(candles);
  const prevDate = dates.filter((d) => d < todayDate).pop();
  const onRecent = onBars.filter((c) => {
    const { date } = etParts(c.timestamp);
    return date === todayDate || date === prevDate;
  });
  const on = hiLo(onRecent);
  if (on) {
    out.push({ kind: "onHigh", label: "Overnight High", short: "ON-H", price: on.high, side: "above" });
    out.push({ kind: "onLow",  label: "Overnight Low",  short: "ON-L", price: on.low,  side: "below" });
  }

  // Previous day RTH H/L.
  if (prevDate) {
    const pdBars = candles.filter((c) => c.date === prevDate && isRthBar(c.timestamp));
    const pd = hiLo(pdBars);
    if (pd) {
      out.push({ kind: "pdHigh", label: "Prev Day High", short: "PDH", price: pd.high, side: "above" });
      out.push({ kind: "pdLow",  label: "Prev Day Low",  short: "PDL", price: pd.low,  side: "below" });
    }
  }

  // Previous week full range (most recent completed week before today's week).
  const thisWeek = weekKey(todayDate);
  const priorWeeks = [...new Set(dates.map(weekKey))].filter((w) => w < thisWeek).sort();
  const lastWeek = priorWeeks.pop();
  if (lastWeek) {
    const pwBars = candles.filter((c) => weekKey(c.date) === lastWeek && isRthBar(c.timestamp));
    const pw = hiLo(pwBars);
    if (pw) {
      out.push({ kind: "pwHigh", label: "Prev Week High", short: "PWH", price: pw.high, side: "above" });
      out.push({ kind: "pwLow",  label: "Prev Week Low",  short: "PWL", price: pw.low,  side: "below" });
    }
  }

  return out;
}

// ── Fail detection ───────────────────────────────────────────────────────────

/**
 * Scan a chronological bar series against one level for look-above / look-below
 * fails. A fail = price pierces the level intrabar (high>level for an "above"
 * level, or low<level for a "below" level) but a subsequent bar closes back
 * through it within `confirmBars`.
 *
 * `bufferPts` ignores trivial pokes (noise) — default 0.5 ES pts.
 */
function scanLevel(
  bars: EsCandle[],
  level: RefLevel,
  bufferPts: number,
  confirmBars: number,
): FailEvent[] {
  const events: FailEvent[] = [];
  const { price, side } = level;
  let i = 0;

  while (i < bars.length) {
    const b = bars[i];
    const pierced = side === "above"
      ? b.high > price + bufferPts
      : b.low < price - bufferPts;

    if (!pierced) { i++; continue; }

    // Track the extreme poke, then look ahead for a close back through.
    let extreme = side === "above" ? b.high : b.low;
    let j = i;
    let failed = false;
    let failBar: EsCandle | null = null;

    const lookEnd = Math.min(bars.length - 1, i + confirmBars);
    for (j = i; j <= lookEnd; j++) {
      const bj = bars[j];
      extreme = side === "above" ? Math.max(extreme, bj.high) : Math.min(extreme, bj.low);
      const closedBack = side === "above" ? bj.close < price : bj.close > price;
      if (closedBack) { failed = true; failBar = bj; break; }
    }

    if (failed && failBar) {
      // Follow-through = how far it ran the opposite way over the next few bars.
      const ftEnd = Math.min(bars.length - 1, j + confirmBars);
      let ft = 0;
      for (let k = j; k <= ftEnd; k++) {
        const move = side === "above" ? price - bars[k].low : bars[k].high - price;
        if (move > ft) ft = move;
      }
      events.push({
        kind: level.kind,
        label: level.label,
        short: level.short,
        direction: side,
        level: price,
        pierceTs: b.timestamp,
        failTs: failBar.timestamp,
        extreme,
        pokePts: Math.abs(extreme - price),
        closeBack: failBar.close,
        followThruPts: ft,
      });
      i = j + 1;   // resume after the fail
    } else {
      // Clean break (held) — skip past this interaction so we don't double-count.
      i = lookEnd + 1;
    }
  }
  return events;
}

export interface FailScanResult {
  events: FailEvent[];          // all fails today, newest last
  statuses: LevelStatus[];      // live per-level state
  stats: FailStat[];            // hit-rate over the supplied window
}

/**
 * Today's live status + the day's fail events for each reference level.
 * `todayBars` should be today's chronological 5m bars (RTH + any pre-open).
 */
export function scanToday(
  levels: RefLevel[],
  todayBars: EsCandle[],
  opts: { bufferPts?: number; confirmBars?: number } = {},
): { events: FailEvent[]; statuses: LevelStatus[] } {
  const bufferPts = opts.bufferPts ?? 0.5;
  const confirmBars = opts.confirmBars ?? 2;
  const bars = [...todayBars].sort((a, b) => a.timestamp - b.timestamp);
  const last = bars[bars.length - 1];

  const events: FailEvent[] = [];
  const statuses: LevelStatus[] = [];

  for (const lv of levels) {
    const evs = scanLevel(bars, lv, bufferPts, confirmBars);
    events.push(...evs);

    let state: LevelStatus["state"] = "idle";
    let distancePts: number | null = null;
    if (last) {
      distancePts = last.close - lv.price;
      const pokeNow = lv.side === "above"
        ? last.high > lv.price + bufferPts
        : last.low < lv.price - bufferPts;
      const cleanBreak = lv.side === "above" ? last.close > lv.price : last.close < lv.price;
      const lastEv = evs[evs.length - 1];
      const recentlyFailed = lastEv && last.timestamp - lastEv.failTs <= confirmBars * 5 * 60_000;

      if (pokeNow && !cleanBreak) state = "testing";
      else if (cleanBreak) state = lv.side === "above" ? "above" : "below";
      else if (recentlyFailed) state = "failed";
      else state = "idle";
    }

    statuses.push({
      level: lv,
      state,
      lastEvent: evs[evs.length - 1] ?? null,
      distancePts,
    });
  }

  events.sort((a, b) => a.failTs - b.failTs);
  return { events, statuses };
}

/**
 * Historical hit-rate: rebuild each prior day's levels and scan that day's RTH
 * bars, so we measure how often each level type rejects vs breaks. Window =
 * however many trading days are present in `candles` (capped by `maxDays`).
 */
export function computeStats(candles: EsCandle[], maxDays = 20): { stats: FailStat[]; log: FailEvent[] } {
  const dates = tradingDates(candles);
  const recent = dates.slice(-maxDays);
  const agg = new Map<LevelKind, { label: string; tests: number; fails: number }>();
  const log: FailEvent[] = [];

  for (let d = 1; d < recent.length; d++) {
    const day = recent[d];
    const levels = computeRefLevels(candles, day);
    const dayBars = candles
      .filter((c) => c.date === day && isRthBar(c.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp);
    if (!dayBars.length) continue;

    for (const lv of levels) {
      const evs = scanLevel(dayBars, lv, 0.5, 2);
      // Count interactions: a "test" is any pierce; pierces that became events
      // are fails, the rest were clean breaks.
      const pierces = countPierces(dayBars, lv, 0.5, 2);
      const e = agg.get(lv.kind) ?? { label: lv.label, tests: 0, fails: 0 };
      e.tests += pierces;
      e.fails += evs.length;
      agg.set(lv.kind, e);
      log.push(...evs);
    }
  }

  const stats: FailStat[] = [...agg.entries()].map(([kind, v]) => ({
    kind,
    label: v.label,
    tests: v.tests,
    fails: v.fails,
    breaks: Math.max(0, v.tests - v.fails),
    failRate: v.tests > 0 ? v.fails / v.tests : 0,
  }));
  // Stable ordering matching level kind order.
  const order: LevelKind[] = ["onHigh", "onLow", "pdHigh", "pdLow", "pwHigh", "pwLow"];
  stats.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  log.sort((a, b) => b.failTs - a.failTs);
  return { stats, log };
}

// Count distinct pierces (interactions) of a level, mirroring scanLevel's
// non-overlapping advance so tests >= fails always holds.
function countPierces(bars: EsCandle[], level: RefLevel, bufferPts: number, confirmBars: number): number {
  let i = 0, n = 0;
  const { price, side } = level;
  while (i < bars.length) {
    const b = bars[i];
    const pierced = side === "above" ? b.high > price + bufferPts : b.low < price - bufferPts;
    if (!pierced) { i++; continue; }
    n++;
    let j = i;
    const lookEnd = Math.min(bars.length - 1, i + confirmBars);
    let failedAt = -1;
    for (j = i; j <= lookEnd; j++) {
      const closedBack = side === "above" ? bars[j].close < price : bars[j].close > price;
      if (closedBack) { failedAt = j; break; }
    }
    i = failedAt >= 0 ? failedAt + 1 : lookEnd + 1;
  }
  return n;
}
