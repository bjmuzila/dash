/**
 * Chart timeframe: the 1m / 5m / 15m / 30m / 1h switcher and the rollup that
 * backs it.
 *
 * ── Why the higher timeframes are built client-side ─────────────────────────
 * The server publishes exactly TWO ES aggregations: `esCandles` (5m) and
 * `es1mCandles` (1m). They are separate dxLink subscriptions ({=5m} / {=1m}),
 * not two views of one series, which is why useEsCandles types its interval as
 * `1 | 5` and hard-splits rather than merging.
 *
 * 15m / 30m / 1h are exact integer multiples of the 5m bar, so they are derived
 * here from bars the browser already holds. That is deliberate and it is the
 * fast path: `nativeIntervalFor` only ever returns 1 or 5, so moving between
 * 5m → 15m → 30m → 1h never changes useEsCandles' `intervalMinutes` dependency.
 * No map wipe, no SQLite re-query, no ETF refetch, no websocket churn — the
 * switch is a pure in-memory re-bucket of data that is already loaded.
 *
 * Adding native 15m/30m/1h streams later (dxLink subscription + es_candles rows
 * + a WS field) would buy deeper history than the page's 2-day window and
 * nothing else. Until that window is the binding constraint, this is strictly
 * cheaper.
 */

import { etDayKey, etMidnightMs, etMinutes } from "./chartMath";
import type { EsCandleRecord } from "@/lib/snapdb";

export type ChartInterval = 1 | 5 | 15 | 30 | 60;

/** Order matters — this drives the toolbar SegGroup. */
export const CHART_INTERVALS: ChartInterval[] = [1, 5, 15, 30, 60];

export const INTERVAL_LABEL: Record<ChartInterval, string> = {
  1: "1m", 5: "5m", 15: "15m", 30: "30m", 60: "1h",
};

export const intervalMs = (i: ChartInterval): number => i * 60_000;

export function isChartInterval(v: unknown): v is ChartInterval {
  return typeof v === "number" && (CHART_INTERVALS as number[]).includes(v);
}

/**
 * Which server aggregation an interval actually fetches. Everything above 5m
 * rides the 5m stream and is rolled up locally.
 */
export const nativeIntervalFor = (i: ChartInterval): 1 | 5 => (i === 1 ? 1 : 5);

// Session anchors, minutes past ET midnight.
const RTH_OPEN_MIN = 9 * 60 + 30;  // 09:30 ET
const RTH_CLOSE_MIN = 16 * 60;     // 16:00 ET

/**
 * Start (ms) of the bucket containing `ts`, on a grid anchored to the ET
 * session rather than to the epoch.
 *
 * Anchoring to 09:30 ET is what makes every RTH bar full-size: an epoch-aligned
 * 1h grid puts the open in the middle of the 09:00 bar, so the first bar of the
 * day is a 30-minute stub and every later bar straddles the half hour.
 *
 * `breakAtClose` (default on) adds a second anchor at 16:00 ET. Without it the
 * 1h grid runs 15:30 → 16:30 and the RTH closing bar swallows thirty minutes of
 * thin post-close ETH prints — corrupting both its volume and the day's closing
 * print, which is the one bar people actually read. With it, RTH's last hourly
 * bar is a short 15:30–16:00 and the evening session re-grids from 16:00.
 *
 * Overnight bars (before 09:30) anchor to the PREVIOUS ET day's 16:00, so the
 * grid stays contiguous across midnight instead of restarting at a new day's
 * open. With `breakAtClose` off the anchor is simply the day's 09:30: 24h is an
 * integer multiple of 15/30/60 min, so consecutive days' grids meet exactly and
 * the negative side of the floor divides backwards correctly on its own.
 */
export function sessionBucketStart(ts: number, stepMin: number, breakAtClose = true): number {
  const stepMs = stepMin * 60_000;
  const midnight = etMidnightMs(ts);
  const open = midnight + RTH_OPEN_MIN * 60_000;

  if (!breakAtClose) {
    // Math.floor rounds toward −∞, so pre-open bars grid backwards from 09:30.
    return open + Math.floor((ts - open) / stepMs) * stepMs;
  }

  const close = midnight + RTH_CLOSE_MIN * 60_000;
  let anchor: number;
  if (ts >= close) {
    anchor = close;
  } else if (ts >= open) {
    anchor = open;
  } else {
    // Previous ET day's 16:00. `midnight - 1` lands one ms before this day, so
    // etMidnightMs of it resolves the prior ET day even across a DST shift.
    anchor = etMidnightMs(midnight - 1) + RTH_CLOSE_MIN * 60_000;
  }
  return anchor + Math.floor((ts - anchor) / stepMs) * stepMs;
}

/** "HH:MM" ET for a timestamp. Built from minutes rather than a formatter so
 *  midnight is "00:00" and never the "24:00" some ICU builds emit. */
function etHhMm(ts: number): string {
  const m = etMinutes(ts);
  const hh = Math.floor(m / 60) % 24;
  return `${String(hh).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export interface RollupOptions {
  /** Force a bucket boundary at 16:00 ET. See sessionBucketStart. */
  breakAtClose?: boolean;
  /**
   * Drop the oldest bucket when it starts before the first source bar's own
   * bucket boundary would allow — i.e. when the 2-day window sliced through it.
   * A half-built leading bar prints a wrong open and a wrong volume.
   */
  dropLeadingPartial?: boolean;
  /** Bars older than this are already gone; used to detect the sliced bucket. */
  cutoffMs?: number;
}

/**
 * Roll an ascending 5m series up to `step` minutes.
 *
 * Returns the SAME ARRAY REFERENCE when `step <= 5`, so the 1m and 5m paths pay
 * nothing and downstream `useMemo`s don't see a new identity every render.
 *
 * Rules:
 *  - No synthetic bars. A bucket exists iff at least one source bar fell in it,
 *    so weekends and feed outages render as a contiguous jump — exactly what
 *    the 5m series already does.
 *  - The newest bucket is emitted with whatever bars exist so far and updates in
 *    place as they arrive. At 1h that means the right-hand bar moves for an
 *    hour, which is correct and matches every charting package.
 *  - `slotKey` stays `YYYY-MM-DDTHH:MM` — the prior-day basis anchor filters on
 *    `slotKey.slice(11,16) === "16:00"` and the session grouping parses the date
 *    half, so changing this format silently breaks the ES/SPX basis.
 */
export function rollupCandles(
  src: EsCandleRecord[],
  step: ChartInterval,
  opts: RollupOptions = {},
): EsCandleRecord[] {
  if (step <= 5 || src.length === 0) return src;
  const { breakAtClose = true, dropLeadingPartial = true, cutoffMs } = opts;

  const out: EsCandleRecord[] = [];
  let cur: EsCandleRecord | null = null;
  let curStart = -1;

  for (const bar of src) {
    if (!bar || !Number.isFinite(bar.timestamp)) continue;
    const start = sessionBucketStart(bar.timestamp, step, breakAtClose);
    if (start !== curStart) {
      if (cur) out.push(cur);
      curStart = start;
      cur = {
        timestamp: start,
        date: etDayKey(start),
        slotKey: `${etDayKey(start)}T${etHhMm(start)}`,
        time: etHhMm(start),
        symbol: bar.symbol,
        intervalMinutes: step,
        source: bar.source,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: Number(bar.volume || 0),
      };
      continue;
    }
    // Same bucket — extend it. `open` is the first bar's open and never moves.
    if (cur) {
      if (bar.high > cur.high) cur.high = bar.high;
      if (bar.low < cur.low) cur.low = bar.low;
      cur.close = bar.close;
      cur.volume += Number(bar.volume || 0);
    }
  }
  if (cur) out.push(cur);

  // The 2-day window is applied to the 5m source BEFORE rollup (rolling first
  // and cutting after would leave a truncated bucket wherever the cutoff fell).
  // What survives that ordering is a leading bucket whose start predates the
  // cutoff — genuinely incomplete, so drop it.
  if (dropLeadingPartial && out.length > 1 && cutoffMs != null && out[0].timestamp < cutoffMs) {
    out.shift();
  }
  return out;
}
