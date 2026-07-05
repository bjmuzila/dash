// ─── Balance / Imbalance quadrant classifier ────────────────────────────────
// Dalton-style Auction Market Theory read of today's session against the PRIOR
// RTH day's Value Area (see lib/valueArea.ts):
//
//   1. Balance    — price inside the prior day's Value Area (efficient market).
//   2. Shift      — a fresh break of VAH/VAL (break of value).
//   3. Imbalance  — the break sustains ≥ CONFIRM_BARS bars on the same side
//                   (trending, one-timeframe auction).
//   4. Re-balance — the imbalance leg's range contracts vs. its own recent
//                   bars, i.e. price stalls outside the old value area and
//                   starts hunting for new value (or is about to round-trip
//                   back inside it).
//
// This is a first-pass heuristic on 5m bars (no tick data) — thresholds below
// are tunable. classifyDay() gives the live/intraday read; backtestQuadrants()
// grades it against history so you can see whether Shift really leads to
// Imbalance, and whether Imbalance really finds new value.

import type { EsCandle } from "@/hooks/useEsCandles";
import { computeValueArea, type ValueArea } from "@/lib/valueArea";

export type Quadrant = "balance" | "shift" | "imbalance" | "rebalance";

export interface QuadrantPoint {
  ts: number;
  close: number;
  quadrant: Quadrant;
  side: "up" | "down" | null;
  changed: boolean;   // true = this bar is a fresh transition into `quadrant`
}

export interface QuadrantDayResult {
  date: string;
  va: ValueArea;
  points: QuadrantPoint[];
  current: QuadrantPoint | null;
  shiftEvents: number;
  imbalanceReached: number;
  foundNewValue: boolean | null;      // session closed outside the old VA
  revertedToBalance: boolean | null;  // session closed back inside the old VA
}

export interface BacktestSummary {
  days: QuadrantDayResult[];
  daysWithShift: number;
  daysWithImbalance: number;
  shiftToImbalanceRate: number;
  imbalanceToNewValueRate: number;
  imbalanceToRevertRate: number;
}

const CONFIRM_BARS = 2;        // bars sustained beyond VA to confirm Imbalance
const SETTLE_BARS = 2;         // trailing bars used to detect range contraction
const CONTRACTION_RATIO = 0.6; // recent-leg-range / prior-leg-range below this = Re-balance

const RTH_OPEN = 9 * 60 + 30;
const RTH_CLOSE = 16 * 60;

function etParts(ts: number) {
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return { date: "", minutes: NaN };
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const m: Record<string, string> = {};
  p.forEach((x) => { m[x.type] = x.value; });
  const hh = m.hour === "24" ? "00" : m.hour;
  return { date: `${m.year}-${m.month}-${m.day}`, minutes: Number(hh) * 60 + Number(m.minute) };
}

function isRthBar(ts: number): boolean {
  const { minutes } = etParts(ts);
  return minutes >= RTH_OPEN && minutes < RTH_CLOSE;
}

function etSessionDate(c: EsCandle): string {
  return etParts(c.timestamp).date || c.date;
}

export function rthBarsForDate(candles: EsCandle[], date: string): EsCandle[] {
  return candles
    .filter((c) => isRthBar(c.timestamp) && etSessionDate(c) === date)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** Distinct ET session dates present, sorted ascending. */
export function sessionDates(candles: EsCandle[]): string[] {
  return [...new Set(candles.map(etSessionDate).filter(Boolean))].sort();
}

/**
 * Classify one session's bars into the Balance/Shift/Imbalance/Re-balance
 * quadrants, using `va` (typically the PRIOR session's Value Area) as the
 * reference range.
 */
export function classifyDay(candles: EsCandle[], date: string, va: ValueArea): QuadrantDayResult {
  const today = rthBarsForDate(candles, date);
  const points: QuadrantPoint[] = [];

  let state: Quadrant = "balance";
  let side: "up" | "down" | null = null;
  let streak = 0;
  let legRanges: number[] = [];
  let shiftEvents = 0;
  let imbalanceReached = 0;
  let everShifted = false;

  for (const b of today) {
    const inVA = b.close <= va.vah && b.close >= va.val;
    let next: Quadrant = state;
    let nextSide = side;
    let changed = false;

    if (inVA) {
      if (state !== "balance") changed = true;
      next = "balance"; nextSide = null; streak = 0; legRanges = [];
    } else {
      const thisSide: "up" | "down" = b.close > va.vah ? "up" : "down";
      if (state === "balance" || thisSide !== side) {
        next = "shift"; nextSide = thisSide; streak = 1; legRanges = [b.high - b.low];
        shiftEvents++; everShifted = true; changed = true;
      } else {
        streak++;
        legRanges.push(b.high - b.low);
        if (state === "shift" && streak >= CONFIRM_BARS) {
          next = "imbalance"; changed = true; imbalanceReached++;
        } else if (state === "imbalance") {
          if (legRanges.length > SETTLE_BARS) {
            const recent = legRanges.slice(-SETTLE_BARS);
            const prior = legRanges.slice(0, -SETTLE_BARS);
            const recentAvg = recent.reduce((a, c) => a + c, 0) / recent.length;
            const priorAvg = prior.reduce((a, c) => a + c, 0) / Math.max(1, prior.length);
            next = priorAvg > 0 && recentAvg < priorAvg * CONTRACTION_RATIO ? "rebalance" : "imbalance";
            changed = next !== state;
          }
        }
        // else: stays in "shift" or "rebalance" until the next branch confirms it
      }
    }

    points.push({ ts: b.timestamp, close: b.close, quadrant: next, side: nextSide, changed });
    state = next; side = nextSide;
  }

  const lastClose = today[today.length - 1]?.close ?? null;
  const foundNewValue = everShifted && lastClose != null ? (lastClose > va.vah || lastClose < va.val) : null;
  const revertedToBalance = everShifted && lastClose != null ? (lastClose <= va.vah && lastClose >= va.val) : null;

  return {
    date, va, points,
    current: points[points.length - 1] ?? null,
    shiftEvents, imbalanceReached, foundNewValue, revertedToBalance,
  };
}

/**
 * Walk every session in `candles`, using each day's PRIOR RTH session as the
 * Value Area reference, and grade the outcome: does a Shift really confirm
 * into Imbalance, and does Imbalance really find new value vs. round-trip
 * back into the old range?
 */
export function backtestQuadrants(candles: EsCandle[]): BacktestSummary {
  const dates = sessionDates(candles);
  const days: QuadrantDayResult[] = [];

  for (let i = 1; i < dates.length; i++) {
    const prevBars = rthBarsForDate(candles, dates[i - 1]);
    if (prevBars.length < 5) continue;
    const va = computeValueArea(prevBars);
    if (!va) continue;
    const result = classifyDay(candles, dates[i], va);
    if (result.points.length) days.push(result);
  }

  const withShift = days.filter((d) => d.shiftEvents > 0);
  const withImbalance = withShift.filter((d) => d.imbalanceReached > 0);
  const newValue = withImbalance.filter((d) => d.foundNewValue);
  const reverted = withImbalance.filter((d) => d.revertedToBalance);

  return {
    days,
    daysWithShift: withShift.length,
    daysWithImbalance: withImbalance.length,
    shiftToImbalanceRate: withShift.length ? withImbalance.length / withShift.length : 0,
    imbalanceToNewValueRate: withImbalance.length ? newValue.length / withImbalance.length : 0,
    imbalanceToRevertRate: withImbalance.length ? reverted.length / withImbalance.length : 0,
  };
}
