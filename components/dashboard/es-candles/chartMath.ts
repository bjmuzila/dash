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
export const etDayKey = (ts: number) => ET_DAY_FMT.format(new Date(ts));
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

// 15:30 ET. In the last half hour, dealer gamma collapses onto 2–3 strikes into the
// close and |GEX| there dwarfs everything printed earlier in the session. Letting
// those minutes set the bubble scale makes them render enormous and squashes the
// whole rest of the day to dust — so they're excluded from the normalization and
// simply CLAMP at the pre-15:30 max instead. See the bubble draw.
export const BUBBLE_SCALE_CUTOFF_MIN = 15 * 60 + 30;

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

/** Minutes-since-ET-midnight for a slot timestamp. */
export function etMinutes(ts: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ts));
  const m: Record<string, string> = {};
  parts.forEach((p) => { m[p.type] = p.value; });
  return Number(m.hour) * 60 + Number(m.minute);
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
// The chart opens on the most recent DEFAULT_VIEW_BARS bars, not the whole
// loaded history. fitContent() crushed a full session (plus overnight) into the
// container, which left the candles hairline-thin and — worse — packed the
// 1-min GEX bubbles so tightly they merged into one solid rail.
//
// This is a BAR COUNT, not a duration, and that matters now that the card has a
// timeframe switcher. It used to be `4h / CANDLE_MS`, which is 48 bars at 5m —
// but the same 4h window at 1h would open the chart on FOUR bars. Holding the
// bar count fixed makes every interval open at identical visual density, which
// is the property the original comment was actually reaching for.
export const DEFAULT_VIEW_BARS = 60;
// Right gutter, in bars, so the newest candle isn't jammed against the price
// axis (fitContent leaves a similar gap).
export const DEFAULT_VIEW_RIGHT_PAD = 2;
// Show the last DEFAULT_VIEW_BARS of `barCount` bars. Falls back to fitContent
// when there isn't enough history to fill the window (early premarket, a thin
// replay slice), so a short session still fills the width instead of rendering
// a handful of bars stranded on the right.
export function applyDefaultView(chart: IChartApi | null, barCount: number) {
  if (!chart) return;
  const ts = chart.timeScale();
  try {
    if (barCount > DEFAULT_VIEW_BARS) {
      ts.setVisibleLogicalRange({
        from: barCount - DEFAULT_VIEW_BARS,
        to: barCount - 1 + DEFAULT_VIEW_RIGHT_PAD,
      });
    } else {
      ts.fitContent();
    }
  } catch {
    try { ts.fitContent(); } catch { /* ignore */ }
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
