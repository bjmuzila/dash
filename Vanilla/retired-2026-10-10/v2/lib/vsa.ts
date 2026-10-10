/**
 * vsa.ts — volume-based "inefficient candle" classification (effort vs. result).
 *
 * NOT delta. There is no aggressor direction in a dxFeed Candle, only total
 * `volume`, so this measures the MAGNITUDE of effort against the RESULT in
 * price. True delta needs per-print TimeAndSale classification against the
 * quote, which previously saturated the streamer — deliberately not done here.
 * Everything below runs client-side on bars already in the pipeline: no new
 * subscription, no extra WS bandwidth, no server change.
 *
 * Two classes:
 *   churn — RVOL high, body small relative to range. Effort, no ground gained.
 *           Reads as absorption: passive size soaking up the aggression.
 *   thin  — RVOL low, body large relative to range. Ground gained, no effort.
 *           Reads as an unopposed run through empty book (imbalance/FVG-ish).
 *
 * RVOL, not raw volume, is what makes this work: a 09:30 bar always dwarfs an
 * 11:45 bar, so raw thresholds would just paint the open and lunch. The
 * baseline is per time-of-day slot ("HH:MM") across PRIOR sessions only.
 */

export interface VsaBar {
  timestamp: number;
  date?: string;
  slotKey?: string;
  time?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type VsaClass = "churn" | "thin" | "normal";

export interface VsaResult {
  cls: VsaClass;
  rvol: number;      // volume / median(same slot, prior sessions)
  bodyPct: number;   // |close-open| / (high-low), 0..1
  closePos: number;  // (close-low) / (high-low): 0 = at low, 1 = at high
}

export interface VsaTuning {
  /** RVOL at/above which a bar counts as heavy effort. */
  hiRvol: number;
  /** RVOL at/below which a bar counts as no effort. */
  loRvol: number;
  /** Body/range at/below which price gained no ground. */
  smallBody: number;
  /** Body/range at/above which price gained ground. */
  bigBody: number;
  /** How many prior sessions feed the per-slot baseline. */
  lookbackDays: number;
}

export const VSA_DEFAULTS: VsaTuning = {
  hiRvol: 1.8,
  loRvol: 0.6,
  smallBody: 0.3,
  bigBody: 0.7,
  lookbackDays: 10,
};

function slotOf(c: VsaBar): string {
  return (c.slotKey ?? "").slice(11, 16) || (c.time ?? "").slice(0, 5);
}

function dateOf(c: VsaBar): string {
  return c.date ?? (c.slotKey ?? "").slice(0, 10);
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * slot ("HH:MM") -> date ("YYYY-MM-DD") -> volume, over `history`.
 * Median across days (not mean) so one CPI print doesn't move the baseline for
 * that slot all week.
 */
export function buildSlotVolumeIndex(history: VsaBar[]): Map<string, Map<string, number>> {
  const idx = new Map<string, Map<string, number>>();
  for (const c of history) {
    const vol = Number(c.volume || 0);
    if (!(vol > 0)) continue;
    const slot = slotOf(c);
    const date = dateOf(c);
    if (!slot || !date) continue;
    let byDate = idx.get(slot);
    if (!byDate) { byDate = new Map(); idx.set(slot, byDate); }
    // Max, not overwrite: dxFeed candle volume is cumulative-per-bar, so a
    // late partial for the same slot must never shrink the recorded figure.
    byDate.set(date, Math.max(byDate.get(date) ?? 0, vol));
  }
  return idx;
}

/**
 * Baseline volume for `bar`'s slot, from the `lookbackDays` most recent
 * sessions STRICTLY BEFORE the bar's own date. Excluding the bar's own session
 * keeps a bar from being scored against a baseline it is itself part of —
 * self-reference here would be mild, but colors that quietly depend on their
 * own bar are how a chart starts lying to you.
 * Returns 0 when there isn't enough history to judge.
 */
export function slotBaseline(
  idx: Map<string, Map<string, number>>,
  bar: VsaBar,
  lookbackDays: number,
): number {
  const byDate = idx.get(slotOf(bar));
  if (!byDate) return 0;
  const self = dateOf(bar);
  const vols: number[] = [];
  const dates = [...byDate.keys()].filter((d) => d < self).sort().reverse().slice(0, lookbackDays);
  for (const d of dates) vols.push(byDate.get(d) as number);
  // Fewer than 3 prior sessions for this slot = no defensible baseline.
  return vols.length >= 3 ? median(vols) : 0;
}

/**
 * Classify one bar. `baseline` comes from slotBaseline(); a 0 baseline yields
 * "normal" (unknown, never guess).
 */
export function classifyBar(bar: VsaBar, baseline: number, t: VsaTuning): VsaResult {
  const range = bar.high - bar.low;
  const bodyPct = range > 0 ? Math.abs(bar.close - bar.open) / range : 0;
  const closePos = range > 0 ? (bar.close - bar.low) / range : 0.5;
  const rvol = baseline > 0 ? Number(bar.volume || 0) / baseline : 0;
  let cls: VsaClass = "normal";
  if (rvol > 0) {
    if (rvol >= t.hiRvol && bodyPct <= t.smallBody) cls = "churn";
    else if (rvol <= t.loRvol && bodyPct >= t.bigBody) cls = "thin";
  }
  return { cls, rvol, bodyPct, closePos };
}

/**
 * Classify every bar in `bars` against a baseline built from `history`.
 * Returns slotKey -> VsaResult.
 *
 * `formingBefore`: bars whose slot has not closed yet are SKIPPED (left
 * "normal"). A forming bar has partial volume and would always score as thin —
 * a guaranteed false signal on the live right edge. Pass Date.now() - 5min.
 */
export function classifyBars(
  bars: VsaBar[],
  history: VsaBar[],
  t: VsaTuning = VSA_DEFAULTS,
  formingBefore: number = Infinity,
): Map<string, VsaResult> {
  const idx = buildSlotVolumeIndex(history);
  const out = new Map<string, VsaResult>();
  for (const b of bars) {
    if (!b.slotKey) continue;
    if (b.timestamp > formingBefore) continue; // still forming — do not judge
    out.set(b.slotKey, classifyBar(b, slotBaseline(idx, b, t.lookbackDays), t));
  }
  return out;
}
