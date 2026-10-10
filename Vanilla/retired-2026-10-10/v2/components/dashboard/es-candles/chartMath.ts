/**
 * Pure chart math for the ES Candles cards.
 *
 * Everything in here is side-effect free and React-free: ET calendar helpers,
 * the volume / TPO profile builders, the GEX column reducers and the heatmap
 * color ramp. It was all module-level inside app/es-candles/page.tsx; it moved
 * out so three chart cards can share one copy instead of the bundler shipping
 * the same helpers behind a component that is now instantiated N times.
 *
 * NOTHING here may read `window` at module scope — the /es-candles route is
 * still server-rendered by Next before the Vite SPA takes over.
 */

import type { UTCTimestamp, IChartApi } from "lightweight-charts";
import { findGEXFlip, type ChainRow } from "@/lib/calculations/calculations";
import type { RailRow } from "@/components/dashboard/EsGexRail";

export function toChartTime(ts: number): UTCTimestamp {
  return Math.floor(ts / 1000) as UTCTimestamp;
}

// ── GEX column shapes ────────────────────────────────────────────────────────
// One painted heatmap cell: a strike bucket at a given slot.
// netOiVol = gamma×(OI+vol), netVol = gamma×vol only. The active metric is
// chosen at draw time by gexMetric so the toggle re-renders without new data.
export type GexCell = { strike: number; netOiVol: number; netVol: number };
// `spot` = SPX at the moment this column's snapshot was taken. Strikes are in
// SPX space but the chart plots ES, so history is converted with a basis
// reconstructed PER SESSION from these spots (see basisForCols in the overlay
// draw). The live basis alone mis-places older columns: ES−SPX drifts with
// carry/dividends, decays into expiry, and steps at the quarterly roll.
// `flip` / `flipVol` are computed SERVER-SIDE on the untruncated ladder (see
// the heatmap branch in server-v2/api-router.js) and are authoritative. A
// truncated `cells` array cannot be used to rederive them: dropping strikes
// changes adjacency and can invent sign changes that the full profile does
// not have. Live WS columns have no flip field and fall back to the local
// scan below, which is correct there because WS frames are never truncated.
export type GexColumn = { slotTs: number; cells: GexCell[]; spot?: number; flip?: number | null; flipVol?: number | null };
export type GexMetric = "voloi" | "vol";

// ── ET calendar helpers ──────────────────────────────────────────────────────
// ET calendar date (YYYY-MM-DD) for a ms timestamp. Module-level so the overlay
// draw can group GEX columns into sessions for the per-session basis.
const ET_DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
/**
 * PERF: memoised on the UTC HOUR.
 *
 * The overlay draw calls this per stored GEX column (thousands) on every frame,
 * and `Intl.format` + `new Date` is not cheap at that rate. Hour buckets are
 * safe because ET's offset from UTC is always a whole number of hours (-5 / -4),
 * so an ET calendar date can never change part-way through a UTC hour.
 */
const ET_DAY_CACHE = new Map<number, string>();
export const etDayKey = (ts: number): string => {
  const key = Math.floor(ts / 3_600_000);
  const hit = ET_DAY_CACHE.get(key);
  if (hit !== undefined) return hit;
  const out = ET_DAY_FMT.format(new Date(ts));
  if (ET_DAY_CACHE.size > 20_000) ET_DAY_CACHE.clear();
  ET_DAY_CACHE.set(key, out);
  return out;
};
const ET_HHMM_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
export const fmtEtHM = (ts: number) => ET_HHMM_FMT.format(new Date(ts));

const ET_HM_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});

// ES trades at a POSITIVE carry to SPX (cost of carry − dividends). It is never
// negative and never a few hundred points. Anything outside this band is a data
// fault, whatever produced it — refuse it rather than bend every level by it.
export function isPlausibleBasis(b: number): boolean {
  return Number.isFinite(b) && b > 0 && b < 250;
}

/** Minutes past ET midnight for a timestamp. Used to fence off the closing auction. */
export function etMinutesOfDay(ts: number): number {
  const parts = ET_HM_FMT.formatToParts(new Date(ts));
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hh < 0 ? -1 : hh * 60 + mm;
}

/**
 * ── Time-of-day gamma profile ────────────────────────────────────────────────
 * |net GEX| at the session's biggest strike is NOT stationary through the day.
 * It grows all morning and then runs away into the close: dealer gamma collapses
 * onto two or three strikes, and the numbers there are several times anything
 * printed at lunch. That is STRUCTURAL — it happens every single session — so it
 * is a property of the clock, not a signal about today.
 *
 * The previous fix was a cliff: ignore every minute from 15:30 on when setting
 * the bubble scale (the old `BUBBLE_SCALE_CUTOFF_MIN`). It stopped the close
 * from flattening the morning, but it also meant the last half hour carried no
 * information at all — every late wall clamped to the same maximum size, so a
 * genuinely enormous 15:50 pin drew exactly like an ordinary one.
 *
 * This table replaces it. It is the EXPECTED |GEX| of the biggest strike at a
 * given ET minute, as a multiple of its midday level, so the bubble scale can
 * divide it out and judge a 15:50 wall against what 15:50 normally looks like
 * instead of against noon.
 *
 * ── Calibration: measured, not guessed ──────────────────────────────────────
 * Source: `gex_strike_history.csv` at the repo root — 1.25M per-strike $SPX rows
 * over the six full sessions 2026-07-10 … 2026-07-17. For each minute of each
 * session take the largest |net_gex| on the board, divide by that day's own
 * median over 10:00–14:00 ET, then take the median across days. The shape came
 * out monotone and tight day to day:
 *
 *   09:30 0.73    11:30 1.00    13:30 1.33    15:20 2.59
 *   10:00 0.81    12:00 0.97    14:00 1.63    15:30 2.85
 *   10:30 0.83    12:30 1.02    14:30 2.01    15:50 3.10
 *   11:00 0.85    13:00 1.15    15:00 2.24    16:00 3.42
 *
 * — the biggest strike into the bell carries ~4.7x the gamma it carried at the
 * open, whatever the tape did.
 *
 * Re-derive it the same way if the profile ever drifts. The anchors below are
 * lightly smoothed to stay monotone (the raw 15:40 bin dips under 15:30 on a
 * six-session sample; that is noise, not a real lull).
 */
const GEX_TOD_ANCHORS: Array<[minuteOfDay: number, scale: number]> = [
  [9 * 60 + 30, 0.72],
  [10 * 60, 0.80],
  [10 * 60 + 30, 0.85],
  [11 * 60, 0.88],
  [11 * 60 + 30, 0.98],
  [12 * 60, 1.00],
  [12 * 60 + 30, 1.03],
  [13 * 60, 1.15],
  [13 * 60 + 30, 1.33],
  [14 * 60, 1.65],
  [14 * 60 + 30, 2.00],
  [15 * 60, 2.25],
  [15 * 60 + 30, 2.85],
  [16 * 60, 3.40],
];

/**
 * Expected |GEX| of the biggest strike at `minuteOfDay` ET, as a multiple of its
 * midday level. Piecewise-linear between the anchors and FLAT outside the cash
 * session — an overnight print is scaled like the open, which is the closest
 * thing to a quiet-book reference the profile has.
 */
export function gexTodScale(minuteOfDay: number): number {
  if (!Number.isFinite(minuteOfDay) || minuteOfDay < 0) return 1;
  const first = GEX_TOD_ANCHORS[0];
  const last = GEX_TOD_ANCHORS[GEX_TOD_ANCHORS.length - 1];
  if (minuteOfDay <= first[0]) return first[1];
  if (minuteOfDay >= last[0]) return last[1];
  for (let i = 1; i < GEX_TOD_ANCHORS.length; i++) {
    const [b, vb] = GEX_TOD_ANCHORS[i];
    if (minuteOfDay <= b) {
      const [a, va] = GEX_TOD_ANCHORS[i - 1];
      return va + (vb - va) * ((minuteOfDay - a) / (b - a));
    }
  }
  return 1;
}

// Cash session bounds in minutes past ET midnight. Single-sourced because three
// things now read them — isCashOpen below, etSessionStarted, and the replay
// transport's RTH/ETH switch — and a session that started at 09:30 in one place
// and 09:35 in another would be a genuinely miserable bug to see.
export const RTH_OPEN_MIN = 9 * 60 + 30;   // 09:30 ET
export const RTH_CLOSE_MIN = 16 * 60;      // 16:00 ET

// Is SPX CASH open (Mon–Fri 09:30–16:00 ET)? The live basis (ES − spot) is only
// measurable while cash trades. Out of hours `spot` is a frozen last print while ES
// keeps moving, so their difference stops being a basis at all.
export function isCashOpen(ts: number = Date.now()): boolean {
  const parts = ET_HM_FMT.formatToParts(new Date(ts));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (wd === "Sat" || wd === "Sun") return false;
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  if (hh < 0) return false;
  const mins = hh * 60 + mm;
  return mins >= RTH_OPEN_MIN && mins < RTH_CLOSE_MIN;
}

/**
 * Is this timestamp on a Saturday or Sunday in ET?
 *
 * Exists because "there are rows for that day" is NOT the same as "that day
 * traded". The TastyTrade streamer keeps its last-known greeks cached, and
 * gex-history-writer has no market-hours gate — so all weekend it writes a
 * frozen copy of Friday's book once a minute, stamped with Saturday's date.
 * Any "newest day with data" rule walks straight into those.
 */
export function isEtWeekend(ts: number): boolean {
  const wd = ET_HM_FMT.formatToParts(new Date(ts)).find((p) => p.type === "weekday")?.value ?? "";
  return wd === "Sat" || wd === "Sun";
}

/**
 * Has TODAY's cash session started (or already finished) in ET?
 *
 * Differs from isCashOpen in the one way the GEX backfill cares about: this
 * stays true after 16:00, because the question is not "can I read a live basis"
 * but "does today have any recorded GEX history to find at all". False on a
 * weekend and before 09:30 on a weekday — exactly the windows where a 24h
 * lookback can fail to reach the last session that actually traded (Saturday
 * evening is already more than 24h past Friday's close), and where the caller
 * must widen its request instead of coming back empty.
 *
 * Holidays read as `true` here — the ET calendar is all this knows. That is
 * safe: the consumer only uses a `false` to ASK FOR MORE, so a holiday just
 * behaves like today, and the day-of-data anchoring downstream still falls back
 * to the newest session present in whatever comes back.
 */
export function etSessionStarted(ts: number = Date.now()): boolean {
  const parts = ET_HM_FMT.formatToParts(new Date(ts));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (wd === "Sat" || wd === "Sun") return false;
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  if (hh < 0) return false;
  return hh * 60 + mm >= RTH_OPEN_MIN;
}

/**
 * Minutes-since-ET-midnight for a slot timestamp.
 *
 * PERF: the formatter is module-level, like every other formatter in this file.
 * It used to be constructed PER CALL, and this function is called per MVC point
 * per overlay frame (EsChartCard's CB/flip draw) — hundreds of
 * `new Intl.DateTimeFormat` per frame, ~10-40us each. That was several ms of
 * every single repaint, from one missing hoist.
 *
 * There is also a small memo on the result: consecutive callers ask about the
 * same handful of timestamps (a column's slot, then its cells), and `formatToParts`
 * is the expensive part even with the formatter cached.
 */
const ET_MIN_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
});
// Minute-resolution key → minutes-past-ET-midnight. A trading day is 1440 keys;
// the cap is generous enough that a multi-session draw never thrashes it.
const ET_MIN_CACHE = new Map<number, number>();
export function etMinutes(ts: number): number {
  const key = Math.floor(ts / 60_000);
  const hit = ET_MIN_CACHE.get(key);
  if (hit !== undefined) return hit;
  const parts = ET_MIN_FMT.formatToParts(new Date(ts));
  const m: Record<string, string> = {};
  parts.forEach((p) => { m[p.type] = p.value; });
  const out = Number(m.hour) * 60 + Number(m.minute);
  if (ET_MIN_CACHE.size > 20_000) ET_MIN_CACHE.clear();
  ET_MIN_CACHE.set(key, out);
  return out;
}

/**
 * UTC ms of ET midnight for the ET day containing `ts`.
 *
 * Derived by subtracting the wall-clock minutes-since-midnight rather than by
 * constructing a Date from a formatted string, so it is correct on both DST
 * transition days without a timezone-offset table.
 */
export function etMidnightMs(ts: number): number {
  const mins = etMinutes(ts);
  const secs = new Date(ts).getUTCSeconds();
  const ms = new Date(ts).getUTCMilliseconds();
  return ts - mins * 60_000 - secs * 1000 - ms;
}

// ── Volume profile ───────────────────────────────────────────────────────────
// Volume-by-price profile + value-area levels, derived from candle OHLCV.
export type ProfileBin = { price: number; volume: number };
export type VolumeProfile = {
  bins: ProfileBin[];      // ascending by price
  maxVol: number;
  poc: number | null;      // point of control (max-volume price)
  vah: number | null;      // value area high
  val: number | null;      // value area low
  lvn: number | null;      // most significant low-volume node inside the range
};

/**
 * Build a session volume profile from candle OHLCV. Tick volume isn't available
 * per price, so each candle's volume is spread evenly across the price bins its
 * [low, high] range touches (standard candle-based profile approximation).
 * Value area = the contiguous 70% of volume around the POC.
 */
export function buildVolumeProfile(
  candles: Array<{ high: number; low: number; close: number; open: number; volume: number }>,
  binSize: number
): VolumeProfile {
  const empty: VolumeProfile = { bins: [], maxVol: 0, poc: null, vah: null, val: null, lvn: null };
  if (!candles.length || !(binSize > 0)) return empty;
  let lo = Infinity, hi = -Infinity;
  for (const c of candles) { if (c.low < lo) lo = c.low; if (c.high > hi) hi = c.high; }
  if (!(hi > lo)) return empty;

  const floorBin = (p: number) => Math.floor(p / binSize) * binSize;
  const vol = new Map<number, number>();
  for (const c of candles) {
    const b0 = floorBin(c.low), b1 = floorBin(c.high);
    const n = Math.max(1, Math.round((b1 - b0) / binSize) + 1);
    const per = (c.volume || 0) / n;
    for (let b = b0; b <= b1 + 1e-9; b += binSize) vol.set(b, (vol.get(b) ?? 0) + per);
  }
  const bins: ProfileBin[] = [...vol.entries()]
    .map(([price, volume]) => ({ price, volume }))
    .sort((a, b) => a.price - b.price);
  if (!bins.length) return empty;

  let pocIdx = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i].volume > bins[pocIdx].volume) pocIdx = i;
  const total = bins.reduce((s, b) => s + b.volume, 0);
  const target = total * 0.7;

  // Expand around the POC until 70% of volume is captured (value area).
  let loI = pocIdx, hiI = pocIdx, acc = bins[pocIdx].volume;
  while (acc < target && (loI > 0 || hiI < bins.length - 1)) {
    const below = loI > 0 ? bins[loI - 1].volume : -1;
    const above = hiI < bins.length - 1 ? bins[hiI + 1].volume : -1;
    if (above >= below) { hiI++; acc += Math.max(0, above); }
    else { loI--; acc += Math.max(0, below); }
  }

  // LVN: lowest-volume bin inside the traded range (local minimum), excluding edges.
  let lvnIdx = -1;
  for (let i = 1; i < bins.length - 1; i++) {
    if (bins[i].volume < bins[i - 1].volume && bins[i].volume < bins[i + 1].volume) {
      if (lvnIdx < 0 || bins[i].volume < bins[lvnIdx].volume) lvnIdx = i;
    }
  }

  return {
    bins,
    maxVol: bins[pocIdx].volume,
    poc: bins[pocIdx].price,
    vah: bins[hiI].price,
    val: bins[loI].price,
    lvn: lvnIdx >= 0 ? bins[lvnIdx].price : null,
  };
}

// ── TPO (Time Price Opportunity) profile ────────────────────────────────────
// Classic "letter chart" market profile, but rendered as light-gray boxes
// instead of letters. Counts are TPO touches (one per 30-min period that
// traded at a price), NOT volume — same 70%-expansion value-area algorithm as
// buildVolumeProfile above, just fed period-touch counts instead of volume.
export const TPO_PERIOD_MS = 30 * 60_000;
export type TpoBin = { price: number; count: number };
export type TpoProfile = {
  bins: TpoBin[];
  maxCount: number;
  poc: number | null;   // point of control
  vah: number | null;   // value area high
  val: number | null;   // value area low
  mid: number | null;   // session range midpoint
  startTs: number | null; // chart x-anchor: first candle of this session
  endTs: number | null;   // chart x-anchor: where the profile's box-width ends
};

/**
 * Build a TPO profile from candles.
 *
 * `periodMs` is the TPO period — classically 30 minutes (TPO_PERIOD_MS), but the
 * caller raises it to the bar size on higher timeframes, because a period
 * smaller than a bar gives every candle its own period and the "profile" just
 * restates the candles.
 *
 * A bin is counted ONCE per period that traded there, no matter how many candles
 * inside that period touched it — that is what makes this a time profile rather
 * than a second volume profile. Each candle marks every bin its [low, high]
 * spans, deduped per period by a Set of bin prices.
 *
 * Value area is the same contiguous-70%-around-the-POC expansion buildVolumeProfile
 * uses, fed touch counts instead of volume, so VAH/VAL mean the same thing on
 * both profiles. `mid` is the session RANGE midpoint (high+low)/2 — a different
 * level from the POC and drawn separately.
 *
 * startTs/endTs are left null: only the caller knows which session window these
 * candles were sliced from, and it assigns both right after this returns.
 */
export function buildTpoProfile(
  candles: Array<{ timestamp: number; high: number; low: number }>,
  binSize: number,
  periodMs: number = TPO_PERIOD_MS
): TpoProfile {
  const empty: TpoProfile = {
    bins: [], maxCount: 0, poc: null, vah: null, val: null, mid: null, startTs: null, endTs: null,
  };
  if (!candles.length || !(binSize > 0) || !(periodMs > 0)) return empty;

  const floorBin = (p: number) => Math.floor(p / binSize) * binSize;
  // period start -> the set of bins that period traded at.
  const periods = new Map<number, Set<number>>();
  let lo = Infinity, hi = -Infinity;
  for (const c of candles) {
    if (!isFinite(c.high) || !isFinite(c.low) || !(c.high >= c.low)) continue;
    if (c.low < lo) lo = c.low;
    if (c.high > hi) hi = c.high;
    const p = Math.floor(c.timestamp / periodMs) * periodMs;
    let set = periods.get(p);
    if (!set) { set = new Set<number>(); periods.set(p, set); }
    const b0 = floorBin(c.low), b1 = floorBin(c.high);
    for (let b = b0; b <= b1 + 1e-9; b += binSize) set.add(b);
  }
  if (!periods.size || !(hi >= lo)) return empty;

  const counts = new Map<number, number>();
  for (const set of periods.values()) {
    for (const b of set) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const bins: TpoBin[] = [...counts.entries()]
    .map(([price, count]) => ({ price, count }))
    .sort((a, b) => a.price - b.price);
  if (!bins.length) return empty;

  let pocIdx = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i].count > bins[pocIdx].count) pocIdx = i;
  const total = bins.reduce((s, b) => s + b.count, 0);
  const target = total * 0.7;

  let loI = pocIdx, hiI = pocIdx, acc = bins[pocIdx].count;
  while (acc < target && (loI > 0 || hiI < bins.length - 1)) {
    const below = loI > 0 ? bins[loI - 1].count : -1;
    const above = hiI < bins.length - 1 ? bins[hiI + 1].count : -1;
    if (above >= below) { hiI++; acc += Math.max(0, above); }
    else { loI--; acc += Math.max(0, below); }
  }

  return {
    bins,
    maxCount: bins[pocIdx].count,
    poc: bins[pocIdx].price,
    vah: bins[hiI].price,
    val: bins[loI].price,
    mid: (hi + lo) / 2,
    startTs: null,
    endTs: null,
  };
}

// ── GEX column slotting ──────────────────────────────────────────────────────
// Heatmap column bucket. 1-min: snapshots arrive every ~30s, so each column is
// the latest snapshot in that minute. Columns are carried forward to the next
// column's left edge, so the band stays continuous.
//
// This is STORAGE granularity for the GEX column map and is deliberately
// independent of the chart's bar size — a 1h chart still stores 1-min columns
// and buckets them for painting at draw time.
export const SLOT_MS = 60_000;
export function slotFloorMs(ts: number): number {
  return Math.floor(ts / SLOT_MS) * SLOT_MS;
}

// ── Line colors ──────────────────────────────────────────────────────────────
// Spot / last-price line. Same gray as PDH/PDL so the "reference, not signal"
// lines read as one family.
export const SPOT_LINE_GRAY = "#9ca3af";
// Estimated-move bands — violet, deliberately clear of the gray session lines,
// the blue overnight lines, the amber IB lines and the cyan/red GEX walls.
export const EM_VIOLET = "#a78bfa";

/**
 * Parse a price out of a ticker_levels field.
 *
 * levels-engine.js stores these via toLocaleString, so they arrive as formatted
 * strings ("7,650.25"). Number() on that is NaN. Values under 1000 (SPY, QQQ)
 * carry no separator and parse fine either way — which is exactly what makes
 * skipping this a bug that only ever shows up on ES and SPX.
 */
export function parseLevelNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Default zoom ─────────────────────────────────────────────────────────────
// THE NEWEST CANDLE IS ALWAYS ON SCREEN. Everything else is about where the LEFT
// edge goes.
//
// Two earlier versions each got half of it:
//
//   1. The last DEFAULT_VIEW_BARS bars, a fixed count. Written to stop
//      fitContent() crushing a full session plus overnight into the container,
//      and it did — but 60 bars is 5 hours at 5m and FIFTY MINUTES at 1m, so on
//      the intervals people use it opened deep inside the day with the morning
//      off-screen.
//   2. The cash session RESERVED — 09:30 to 16:00 of the newest session with RTH
//      bars, with the right edge at the session's last SLOT rather than at the
//      newest bar. Correct framing on a finished day, and wrong the rest of the
//      time: at 09:35 it drew five candles against six hours of empty space, and
//      overnight it framed the previous RTH block while the live candles sat off
//      the right edge entirely. "The candles need to open inside the chart."
//
// The rule now, in order:
//
//   RIGHT  the newest bar (plus a small gutter). Non-negotiable — a default view
//          that does not contain the candle currently printing is broken however
//          nice the rest of the framing is.
//   LEFT   the cash open of the newest RTH session, so a normal intraday load
//          opens on 09:30 → now and grows into the full 09:30–16:00 frame as the
//          day fills.
//   CAP    never more than one session's WIDTH back from the newest bar. This is
//          what stops a Sunday-evening load from spanning Friday 09:30 → Sunday
//          20:30 in the name of "anchor on the cash open".
//   FLOOR  never fewer than MIN_VIEW_MS of bars. At 09:35 the cash open is
//          fifteen minutes away and five candles across a whole chart is not a
//          chart; the left edge falls back into premarket until two hours of tape
//          is on screen.
export const DEFAULT_VIEW_BARS = 60;
// Right gutter, in bars, so the newest candle isn't jammed against the price
// axis (fitContent leaves a similar gap).
export const DEFAULT_VIEW_RIGHT_PAD = 2;
// A little air before the open, so the 09:30 bar isn't welded to the left edge.
const RTH_VIEW_LEFT_PAD = 1;
// The FLOOR. Two hours of tape, whatever the interval — 120 bars at 1m, 24 at
// 5m, 2 at 1h. Below this the chart reads as empty rather than as early.
const MIN_VIEW_MS = 2 * 60 * 60_000;
// The CAP: one cash session. Also the fallback width when there is no RTH bar to
// anchor on at all (a pure overnight series, a thin replay slice).
const SESSION_VIEW_MS = (RTH_CLOSE_MIN - RTH_OPEN_MIN) * 60_000;
// Bound on the backward walk to the session's first bar. The walk stops at the
// day boundary and at 09:30 anyway; this is a guard so a pathological bar array
// (duplicate timestamps, a 1m series with weeks of history) can't turn a fit
// into a long Intl-formatting loop.
const RTH_WALK_MAX = 800;

/**
 * Frame the chart on load.
 *
 * `bars` must be the rows the series is CURRENTLY showing — during replay that
 * is the filtered slice, not the full history, or the logical indices below
 * point at the wrong candles.
 *
 * `candleMs` converts the two time bounds above into bar counts. Without it both
 * degrade to the old fixed-bar-count view, which is wrong-ish but never broken.
 */
export function applyDefaultView(
  chart: IChartApi | null,
  bars: ReadonlyArray<{ timestamp: number }> | number,
  candleMs = 0,
) {
  if (!chart) return;
  const ts = chart.timeScale();
  // Legacy call shape (a bare bar count) — no timestamps, so neither the cash
  // open nor the two-hour floor can be located. Keep the old behaviour rather
  // than guess.
  if (typeof bars === "number") {
    try {
      if (bars > DEFAULT_VIEW_BARS) {
        ts.setVisibleLogicalRange({ from: bars - DEFAULT_VIEW_BARS, to: bars - 1 + DEFAULT_VIEW_RIGHT_PAD });
      } else {
        ts.fitContent();
      }
    } catch { try { ts.fitContent(); } catch { /* ignore */ } }
    return;
  }

  const n = bars.length;
  const fallback = () => {
    try {
      if (n > DEFAULT_VIEW_BARS) {
        ts.setVisibleLogicalRange({ from: n - DEFAULT_VIEW_BARS, to: n - 1 + DEFAULT_VIEW_RIGHT_PAD });
      } else {
        ts.fitContent();
      }
    } catch { try { ts.fitContent(); } catch { /* ignore */ } }
  };
  if (!n) { fallback(); return; }
  if (!(candleMs > 0)) { fallback(); return; }

  try {
    const endIdx = n - 1;                 // the newest bar — always on screen
    const slots = (ms: number) => Math.max(1, Math.ceil(ms / candleMs));
    const minSlots = slots(MIN_VIEW_MS);
    const capSlots = slots(SESSION_VIEW_MS);

    const inRth = (t: number) => {
      const m = etMinutesOfDay(t);
      return m >= RTH_OPEN_MIN && m < RTH_CLOSE_MIN;
    };
    // Newest RTH bar, searching backwards, then back to that session's open.
    // Bounded by capSlots + the walk guard: an RTH open further back than one
    // session is going to lose to the cap anyway, so there is no reason to walk
    // days of overnight tape to find it.
    let openIdx = -1;
    {
      let rthIdx = -1;
      const scanLimit = Math.min(n, Math.max(capSlots * 2, 64), RTH_WALK_MAX);
      for (let k = 0; k < scanLimit; k++) {
        const i = endIdx - k;
        if (i < 0) break;
        if (inRth(bars[i].timestamp)) { rthIdx = i; break; }
      }
      if (rthIdx >= 0) {
        const dayKey = etDayKey(bars[rthIdx].timestamp);
        openIdx = rthIdx;
        for (let k = 0; openIdx > 0 && k < RTH_WALK_MAX; k++) {
          const prev = bars[openIdx - 1].timestamp;
          if (etDayKey(prev) !== dayKey || !inRth(prev)) break;
          openIdx--;
        }
      }
    }

    // LEFT: the cash open, capped at one session back, floored at two hours.
    let from = openIdx >= 0 ? openIdx : endIdx - capSlots + 1;
    if (from < endIdx - capSlots + 1) from = endIdx - capSlots + 1;   // cap
    if (endIdx - from + 1 < minSlots) from = endIdx - minSlots + 1;   // floor
    ts.setVisibleLogicalRange({
      from: from - RTH_VIEW_LEFT_PAD,
      to: endIdx + DEFAULT_VIEW_RIGHT_PAD,
    });
  } catch {
    fallback();
  }
}

/**
 * Reduce one stored GEX column to the rail bars + CB + Call/Put Wall + Flip.
 *
 * Flip = the zero-cross, computed with findGEXFlip so it agrees with the home
 * page by construction.
 *
 * CB = the single largest gamma concentration in the column, SIGN-BLIND: the
 * strike with the biggest |net|, whether that net is positive or negative. On
 * SPX this number comes from mvc_snapshots instead; the ETFs have no such
 * recorder, and this is the same quantity read straight off the ladder.
 *
 * ── cbAware ──────────────────────────────────────────────────────────────────
 * Off (the default), the walls are just the largest positive / largest negative
 * net — which means that when CB is positive, CB and the Call Wall are the SAME
 * STRIKE printed under two labels, and the second real level goes unnamed.
 *
 * On, the side CB came from yields its top slot: CB positive ⇒ the Call Wall is
 * that side's SECOND-strongest strike; CB negative ⇒ the Put Wall is. The other
 * side is untouched either way, since CB never consumed it. Three tiles, three
 * distinct levels.
 *
 * It's a flag rather than the rule because SPX must not take it: there the walls
 * arrive from the live /ws/gex feed, which ranks them plainly, and a replay
 * scrub that quietly re-pointed the Call Wall one strike over would disagree
 * with the very chart it is replaying.
 *
 * Three callers, one rule: replay scrubbing (the column at the cursor), the ETF
 * rail/stat derivation, and the ETF price-line publisher. Extracted so they
 * cannot drift into three different definitions of "the wall".
 */
export function deriveColumnLevels(
  col: GexColumn | null | undefined,
  metric: GexMetric,
  opts?: { cbAware?: boolean },
): { railRows: RailRow[]; cb: number | null; callWall: number | null; putWall: number | null; gexFlip: number | null } | null {
  if (!col || !col.cells.length) return null;
  const railRows: RailRow[] = col.cells.map((c) => ({
    strike: c.strike, net: metric === "vol" ? c.netVol : c.netOiVol,
  }));
  // CB first — the walls below are defined relative to it.
  let cb: number | null = null, cbNet = 0, cbAbs = 0;
  for (const r of railRows) {
    const a = Math.abs(r.net);
    if (a > cbAbs) { cbAbs = a; cb = r.strike; cbNet = r.net; }
  }
  // Rank each side independently. Sorting rather than a single max pass because
  // cbAware needs the runner-up, not just the winner.
  const pos = railRows.filter((r) => r.net > 0).sort((a, b) => b.net - a.net);
  const neg = railRows.filter((r) => r.net < 0).sort((a, b) => a.net - b.net);
  const cbAware = opts?.cbAware === true;
  const callIdx = cbAware && cbNet > 0 ? 1 : 0;
  const putIdx = cbAware && cbNet < 0 ? 1 : 0;
  // Null, not a fall back to index 0: if CB is the ONLY strike on its side there
  // is no second-strongest, and repeating CB under a wall label would read as
  // two levels agreeing when it is one level counted twice.
  const callWall = pos[callIdx]?.strike ?? null;
  const putWall = neg[putIdx]?.strike ?? null;
  const gexFlip = findGEXFlip(
    col.cells.map((c) => ({ strike: c.strike, netGEX: c.netOiVol })) as ChainRow[],
    col.spot,
  );
  return { railRows, cb, callWall, putWall, gexFlip };
}

/**
 * GEX heatmap color (ES Candles page variant). Positive GEX = cyan
 * (41,182,246), negative = red (255,71,87). The 3 largest magnitudes get fixed
 * rank floors so the dominant walls always stand out; everything else follows a
 * curve scaled by `intensity`.
 *
 * Tuned vs. the home page's metricBg() so the LIGHTER (low-magnitude) zones are
 * actually readable instead of washing out:
 *   • exponent 0.6 (was 1.4 > 1, which crushed lows toward 0) — sub-1 lifts the
 *     low/mid end so faint cells gain alpha quickly.
 *   • intensity multiplies the eased curve OUTSIDE the pow (was inside, where it
 *     compounded the crush), so the slider scales the whole field linearly.
 *   • non-top-3 ceiling raised 0.18 → 0.30, floor 0.02 → 0.04, but still kept
 *     strictly below the rank-3 wall (0.35) so the wall hierarchy is preserved.
 */
export function gexColor(value: number, maxValue: number, intensity: number, top3: number[]): string | null {
  const n = value || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return null;
  const pos = n >= 0;
  const rank = top3.indexOf(Math.abs(n)) + 1;
  if (rank === 1) return pos ? "rgba(41,182,246,0.90)" : "rgba(255,71,87,0.90)";
  if (rank === 2) return pos ? "rgba(41,182,246,0.55)" : "rgba(255,71,87,0.55)";
  if (rank === 3) return pos ? "rgba(41,182,246,0.35)" : "rgba(255,71,87,0.35)";
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio, 0.6);
  const alpha = Math.min(0.30, 0.04 + eased * (intensity || 0.1) * 0.26);
  return pos ? `rgba(41,182,246,${alpha.toFixed(3)})` : `rgba(255,71,87,${alpha.toFixed(3)})`;
}

// ── Heatmap colour, the fast path ────────────────────────────────────────────
//
// gexColor() above is the readable reference implementation and stays the single
// source of truth for the CURVE. It is not usable in the heatmap's inner loop,
// though: it builds an `rgba()` STRING per cell, and the draw then ran a regex
// replace + parseFloat + a second toFixed(3) over that string to apply the
// distance fade — four string operations and a CSS colour parse, per cell, per
// frame, over ~100k cells.
//
// So the loop uses the two helpers below instead:
//   gexAlphaOf() → the same curve, returning a NUMBER (0 = don't paint)
//   gexPaint()   → alpha × fade → an interned string from a fixed palette
//
// Quantising to 1/256 is invisible (the canvas composites in 8-bit alpha anyway)
// and means `fillStyle` only ever sees one of ~512 strings, which the browser
// parses once and caches.

/** Alpha for a heatmap cell, 0 = paint nothing. Same curve as gexColor(). */
export function gexAlphaOf(value: number, maxValue: number, intensity: number, top3: number[]): number {
  const n = value || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return 0;
  const rank = top3.indexOf(Math.abs(n)) + 1;
  if (rank === 1) return 0.90;
  if (rank === 2) return 0.55;
  if (rank === 3) return 0.35;
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio, 0.6);
  return Math.min(0.30, 0.04 + eased * (intensity || 0.1) * 0.26);
}

const GEX_STEPS = 256;
const GEX_POS_PAL: Array<string | null> = new Array(GEX_STEPS + 1).fill(null);
const GEX_NEG_PAL: Array<string | null> = new Array(GEX_STEPS + 1).fill(null);

/**
 * Interned `rgba()` for a cell. `alpha` is the gexAlphaOf() result already
 * multiplied by any distance fade. Positive GEX = cyan, negative = red — the
 * same two hues gexColor() uses.
 */
export function gexPaint(pos: boolean, alpha: number): string | null {
  if (!(alpha > 0.002)) return null;
  const q = alpha >= 1 ? GEX_STEPS : (Math.round(alpha * GEX_STEPS) | 0);
  if (q <= 0) return null;
  const pal = pos ? GEX_POS_PAL : GEX_NEG_PAL;
  let s = pal[q];
  if (s == null) {
    const a = (q / GEX_STEPS).toFixed(3);
    s = pos ? `rgba(41,182,246,${a})` : `rgba(255,71,87,${a})`;
    pal[q] = s;
  }
  return s;
}
