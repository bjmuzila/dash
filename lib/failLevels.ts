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
  // ── upgraded LAF/LBF fields ──
  riskPts: number;           // stop distance = probe extreme → reclaim (ES); the trade's 1R
  oppositeLevel: number | null;   // opposite reference price (PDH↔PDL / ONH↔ONL)
  // ── scaled targets (entry → opposite reference) ──
  t1: number | null;         // 50% of the way to the opposite level
  t2: number | null;         // the full opposite reference level
  t3: number | null;         // 2× the entry→opposite distance (measured-move extension)
  tiersHit: 0 | 1 | 2 | 3;   // furthest scaled target reached by the actual move
  maxFavPts: number;         // max favorable excursion from entry before stop-out (ES)
  maxR: number | null;       // maxFavPts / riskPts
  wickPct: number;           // rejection-wick size on the probe side, as % of the reclaim bar range
  lowVolProbe: boolean;      // probe bar volume below its recent baseline (lack of conviction)
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
  // Coerce: prod historical bars arrive with a STRING timestamp (pg BIGINT→JSON),
  // and new Date('1782187200000') is Invalid Date — which silently NaN'd every
  // RTH check and dropped prev-day/week levels. Number() makes it epoch ms again.
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return { date: "", minutes: NaN }; // guard: invalid/missing ts (prod feed)
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
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

// True ET session date of a bar, derived from its timestamp rather than the
// upstream `c.date`/slotKey tag (which can mis-date globex bars across the UTC
// midnight boundary and pollute prev-day RTH H/L). Use for RTH grouping.
function etSessionDate(c: EsCandle): string {
  return etParts(c.timestamp).date || c.date;
}

// RTH-only bars for a given ET session date, grouped by true ET date.
function rthBarsForDate(candles: EsCandle[], date: string): EsCandle[] {
  return candles.filter((c) => isRthBar(c.timestamp) && etSessionDate(c) === date);
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
    const pdBars = rthBarsForDate(candles, prevDate);
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
    const pwBars = candles.filter((c) => isRthBar(c.timestamp) && weekKey(etSessionDate(c)) === lastWeek);
    const pw = hiLo(pwBars);
    if (pw) {
      out.push({ kind: "pwHigh", label: "Prev Week High", short: "PWH", price: pw.high, side: "above" });
      out.push({ kind: "pwLow",  label: "Prev Week Low",  short: "PWL", price: pw.low,  side: "below" });
    }
  }

  return out;
}

// ── Fail detection ───────────────────────────────────────────────────────────

// Per-level cap on how many *interactions* (pierces) we evaluate per session.
// PWH/PWL only fade on the first 2 attempts; the rest of the day is ignored.
function attemptCap(kind: LevelKind): number {
  return kind === "pwHigh" || kind === "pwLow" ? 2 : Infinity;
}

// ── LAF/LBF fail criteria (ES points) ──
const PROBE_MIN_PTS = 0.5;    // below this = noise, not a real sweep
const PROBE_MAX_PTS = 12;     // beyond this the excursion is acceptance, not a sweep
const WICK_MIN_PCT = 0.5;     // reclaim bar must reject ≥50% of its range on the probe side
const ACCEPT_CLOSES = 2;      // 2 consecutive closes beyond the level = acceptance (no fail)

// Opposite-reference lookup so a fail can target the mirror level for R:R.
const OPPOSITE_KIND: Record<LevelKind, LevelKind> = {
  onHigh: "onLow", onLow: "onHigh",
  pdHigh: "pdLow", pdLow: "pdHigh",
  pwHigh: "pwLow", pwLow: "pwHigh",
};

function barRange(b: EsCandle): number {
  return Math.max(1e-9, b.high - b.low);
}

// Price of the opposite reference (PDH↔PDL / ONH↔ONL / PWH↔PWL) from a level set.
function oppositePriceFor(levels: RefLevel[], lv: RefLevel): number | null {
  const opp = levels.find((l) => l.kind === OPPOSITE_KIND[lv.kind]);
  return opp ? opp.price : null;
}

/**
 * Look-Above-and-Fail / Look-Below-and-Fail detection (PDH/PDL/ONH/ONL focus).
 *
 * A fail requires ALL of:
 *   1. Probe  — the level is pierced by PROBE_MIN..PROBE_MAX pts (a liquidity
 *      sweep, not noise and not a runaway acceptance move).
 *   2. No acceptance — price does NOT post ACCEPT_CLOSES consecutive bar closes
 *      beyond the level during the look-ahead window.
 *   3. Reclaim bar — a bar closes back *inside* the level AND, on the probe side,
 *      shows a rejection wick ≥ WICK_MIN_PCT of its range, AND forms a lower-high
 *      (LAF) / higher-low (LBF) versus the probe bar.
 *
 * Risk = probe extreme → reclaim close (the 1R stop sits just beyond the sweep).
 * Target = opposite reference level (PDH↔PDL, ONH↔ONL) when available.
 *
 * `oppositePrice` supplies the mirror level for the R:R target (may be null).
 */
function scanLevel(
  bars: EsCandle[],
  level: RefLevel,
  bufferPts: number,
  confirmBars: number,
  oppositePrice?: number | null,
): FailEvent[] {
  const events: FailEvent[] = [];
  const { price, side } = level;
  const above = side === "above";
  const maxAttempts = attemptCap(level.kind);

  // Overnight levels (ONH/ONL) are only tradable during the RTH session — an
  // overnight sweep of its own level isn't a fade. Restrict ON scans to RTH bars.
  const onlyRth = level.kind === "onHigh" || level.kind === "onLow";
  const scanBars = onlyRth ? bars.filter((b) => isRthBar(b.timestamp)) : bars;
  bars = scanBars;

  let attempts = 0;
  let i = 0;

  while (i < bars.length) {
    if (attempts >= maxAttempts) break;
    const b = bars[i];
    const pierced = above ? b.high > price + bufferPts : b.low < price - bufferPts;
    if (!pierced) { i++; continue; }
    attempts++;

    let extreme = above ? b.high : b.low;
    let consecBeyond = 0;       // running count of closes beyond → detects acceptance
    let accepted = false;
    let failBar: EsCandle | null = null;
    let j = i;

    const lookEnd = Math.min(bars.length - 1, i + confirmBars + ACCEPT_CLOSES);
    for (j = i; j <= lookEnd; j++) {
      const bj = bars[j];
      extreme = above ? Math.max(extreme, bj.high) : Math.min(extreme, bj.low);

      const closedBeyond = above ? bj.close > price : bj.close < price;
      if (closedBeyond) {
        consecBeyond++;
        if (consecBeyond >= ACCEPT_CLOSES) { accepted = true; break; } // acceptance → no fade
        continue;
      }
      consecBeyond = 0;

      // Candidate reclaim bar: closed back inside. Validate wick + lower-high/higher-low.
      const closedBack = above ? bj.close < price : bj.close > price;
      if (!closedBack) continue;
      const wick = above ? (bj.high - bj.close) : (bj.close - bj.low);
      const wickPct = wick / barRange(bj);
      const structureOk = above ? bj.high < extreme : bj.low > extreme; // lower-high / higher-low vs probe extreme
      if (wickPct >= WICK_MIN_PCT && structureOk) { failBar = bj; break; }
    }

    const probePts = Math.abs(extreme - price);
    const validProbe = probePts >= PROBE_MIN_PTS && probePts <= PROBE_MAX_PTS;

    if (!accepted && failBar && validProbe) {
      const entry = failBar.close;
      const riskPts = Math.abs(extreme - entry) || PROBE_MIN_PTS; // stop beyond the sweep

      // Reward = max favorable excursion from ENTRY over the rest of the session,
      // measured until the trade would have stopped out (price back through the
      // probe extreme). A real runner gets full credit; a quick reversal gets cut.
      // For a fade-long (below level) favorable = price rising above entry.
      const stopPrice = extreme;                 // beyond the sweep wick
      let ft = 0;
      for (let k = j + 1; k < bars.length; k++) {
        const bk = bars[k];
        // stopped out?
        const stopped = above ? bk.high >= stopPrice : bk.low <= stopPrice;
        const fav = above ? entry - bk.low : bk.high - entry; // favorable move from entry
        if (fav > ft) ft = fav;
        if (stopped) break;
      }
      const oppositeLevel = oppositePrice ?? null;

      // ── Scaled targets, in the trade's favorable direction ──
      // Fade-long (below level): targets are ABOVE entry. Fade-short: BELOW.
      // dir = +1 for long, -1 for short.
      const dir = above ? -1 : 1;
      let t1: number | null = null, t2: number | null = null, t3: number | null = null;
      let tiersHit: 0 | 1 | 2 | 3 = 0;
      if (oppositeLevel != null) {
        const oppDist = Math.abs(entry - oppositeLevel);
        t1 = entry + dir * oppDist * 0.5;   // 50% of the way to opposite
        t2 = entry + dir * oppDist;          // full opposite reference
        t3 = entry + dir * oppDist * 2;      // 2× measured move
        // Furthest target the actual peak (entry + dir*maxFav) reached.
        const peak = entry + dir * ft;
        const reached = (tp: number) => dir > 0 ? peak >= tp : peak <= tp;
        if (reached(t3)) tiersHit = 3;
        else if (reached(t2)) tiersHit = 2;
        else if (reached(t1)) tiersHit = 1;
      }
      const maxR = riskPts > 0 ? ft / riskPts : null;
      const wick = above ? (failBar.high - failBar.close) : (failBar.close - failBar.low);

      const baseVol = (b as EsCandle).avg5 ?? (b as EsCandle).avg14 ?? null;
      const probeVol = Number((b as EsCandle).volume ?? 0);
      const lowVolProbe = baseVol != null && probeVol > 0 ? probeVol < baseVol : false;

      events.push({
        kind: level.kind,
        label: level.label,
        short: level.short,
        direction: side,
        level: price,
        pierceTs: b.timestamp,
        failTs: failBar.timestamp,
        extreme,
        pokePts: probePts,
        closeBack: entry,
        followThruPts: ft,
        riskPts,
        oppositeLevel,
        t1, t2, t3,
        tiersHit,
        maxFavPts: ft,
        maxR,
        wickPct: wick / barRange(failBar),
        lowVolProbe,
      });
      i = j + 1;
    } else {
      // Acceptance, runaway probe, or no valid reclaim — advance past the interaction.
      i = (accepted ? j : lookEnd) + 1;
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
    const evs = scanLevel(bars, lv, bufferPts, confirmBars, oppositePriceFor(levels, lv));
    events.push(...evs);

    let state: LevelStatus["state"] = "idle";
    let distancePts: number | null = null;
    // ON levels only go live (testing/break/fail) during RTH; outside RTH they
    // stay idle even if price is poking them overnight.
    const onLevel = lv.kind === "onHigh" || lv.kind === "onLow";
    const liveOk = last ? (!onLevel || isRthBar(last.timestamp)) : false;
    if (last) distancePts = last.close - lv.price; // distance always shown
    if (last && liveOk) {
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
    const dayBars = rthBarsForDate(candles, day)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (!dayBars.length) continue;

    for (const lv of levels) {
      const evs = scanLevel(dayBars, lv, 0.5, 2, oppositePriceFor(levels, lv));
      // Count interactions: a "test" is any valid probe (sweep within bounds);
      // probes that became events are fails, the rest were breaks/acceptance.
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
  const maxAttempts = attemptCap(level.kind);
  // ON levels: RTH bars only (mirror scanLevel).
  if (level.kind === "onHigh" || level.kind === "onLow") {
    bars = bars.filter((b) => isRthBar(b.timestamp));
  }
  while (i < bars.length) {
    if (n >= maxAttempts) break;
    const b = bars[i];
    const pierced = side === "above" ? b.high > price + bufferPts : b.low < price - bufferPts;
    if (!pierced) { i++; continue; }
    n++;
    let j = i;
    // Mirror scanLevel's window (confirm + acceptance lookahead) and advance to the
    // first close back inside, or past the whole window on acceptance/break.
    const lookEnd = Math.min(bars.length - 1, i + confirmBars + ACCEPT_CLOSES);
    let closedBackAt = -1;
    for (j = i; j <= lookEnd; j++) {
      const closedBack = side === "above" ? bars[j].close < price : bars[j].close > price;
      if (closedBack) { closedBackAt = j; break; }
    }
    i = closedBackAt >= 0 ? closedBackAt + 1 : lookEnd + 1;
  }
  return n;
}

// ─── Auction Market Theory (AMT) layer ────────────────────────────────────────
// Today's Initial Balance, day-type classification, and a per-level AMT read of
// each reference level (overnight = thin/weak acceptance, prior-day/week = strong
// acceptance). No value-area / volume-profile — pure price + IB. All ES points.

export type DayType =
  | "trend-up" | "trend-down" | "balance" | "reversal-up" | "reversal-down" | "forming";

export interface InitialBalance {
  high: number;
  low: number;
  mid: number;
  locked: boolean;        // true once past 10:30 ET
  brokeHigh: boolean;     // price extended above IB high
  brokeLow: boolean;      // price extended below IB low
}

export interface AmtLevelRead {
  kind: LevelKind;
  label: string;
  short: string;
  acceptance: "strong" | "weak";   // PDH/PDL/PWH/PWL = strong, ON = thin/weak
  read: string;                    // AMT one-liner
  bias: "long" | "short" | "neutral";
}

export interface AmtResult {
  ib: InitialBalance | null;
  dayType: DayType;
  dayTypeLabel: string;
  dayTypeDetail: string;
  levelReads: AmtLevelRead[];
  bias: { lean: "long" | "short" | "neutral"; text: string };
}

const IB_OPEN = 9 * 60 + 30;    // 09:30
const IB_END = 10 * 60 + 30;    // 10:30 ET

function etMinutes(ts: number): number {
  return etParts(ts).minutes;
}

/** Today's Initial Balance from the 09:30–10:30 ET bars. */
function computeIb(todayBars: EsCandle[]): InitialBalance | null {
  const ibBars = todayBars.filter((b) => {
    const m = etMinutes(b.timestamp);
    return m >= IB_OPEN && m < IB_END;
  });
  const hl = hiLo(ibBars);
  if (!hl) return null;
  const last = todayBars[todayBars.length - 1];
  const lastMin = last ? etMinutes(last.timestamp) : IB_OPEN;
  const post = todayBars.filter((b) => etMinutes(b.timestamp) >= IB_END);
  const brokeHigh = post.some((b) => b.high > hl.high);
  const brokeLow = post.some((b) => b.low < hl.low);
  return {
    high: hl.high,
    low: hl.low,
    mid: (hl.high + hl.low) / 2,
    locked: lastMin >= IB_END,
    brokeHigh,
    brokeLow,
  };
}

/**
 * AMT read for today: IB interaction, day-type classification, and per-level
 * acceptance reads — no value area.
 */
export function computeAmt(candles: EsCandle[], todayDate: string): AmtResult {
  const levels = computeRefLevels(candles, todayDate);
  const todayBars = candles
    .filter((c) => c.date === todayDate)
    .sort((a, b) => a.timestamp - b.timestamp);

  const ib = computeIb(todayBars);

  const rthToday = todayBars.filter((b) => isRthBar(b.timestamp));
  const last = rthToday[rthToday.length - 1] ?? todayBars[todayBars.length - 1];
  const close = last?.close ?? null;

  // ── Day-type classification (IB-driven) ──
  let dayType: DayType = "forming";
  let dayTypeLabel = "Forming";
  let dayTypeDetail = "Auction still developing — IB not yet locked.";

  if (ib && close != null) {
    const range = ib.high - ib.low || 1;
    const ext = Math.max(0, close - ib.high, ib.low - close);
    const extMult = ext / range;
    if (ib.brokeHigh && !ib.brokeLow && close > ib.high) {
      dayType = "trend-up"; dayTypeLabel = "Trend ↑";
      dayTypeDetail = `Sustained above IB high${extMult >= 1 ? " with range extension" : ""}.`;
    } else if (ib.brokeLow && !ib.brokeHigh && close < ib.low) {
      dayType = "trend-down"; dayTypeLabel = "Trend ↓";
      dayTypeDetail = `Sustained below IB low${extMult >= 1 ? " with range extension" : ""}.`;
    } else if (ib.brokeHigh && close < ib.low) {
      dayType = "reversal-down"; dayTypeLabel = "Reversal ↓";
      dayTypeDetail = "Took out highs early, then rotated back below IB.";
    } else if (ib.brokeLow && close > ib.high) {
      dayType = "reversal-up"; dayTypeLabel = "Reversal ↑";
      dayTypeDetail = "Took out lows early, then rotated back above IB.";
    } else if (ib.brokeHigh && ib.brokeLow) {
      dayType = "balance"; dayTypeLabel = "Balance / Two-sided";
      dayTypeDetail = "Probed both IB extremes — rotational, mean-reverting auction.";
    } else if (ib.locked) {
      dayType = "balance"; dayTypeLabel = "Balance";
      dayTypeDetail = "Holding inside IB — range-bound; fade the extremes.";
    }
  }

  // ── Per-level AMT reads ──
  const levelReads: AmtLevelRead[] = levels.map((lv) => {
    const isOn = lv.kind === "onHigh" || lv.kind === "onLow";
    const acceptance: AmtLevelRead["acceptance"] = isOn ? "weak" : "strong";
    const isHigh = lv.side === "above";

    let read: string;
    let bias: AmtLevelRead["bias"];
    if (isOn) {
      read = `Thin overnight ${isHigh ? "high" : "low"} — prime probe/fade target; poor ${isHigh ? "highs" : "lows"} reverse.`;
      bias = "neutral";
    } else {
      read = `Prior-session ${isHigh ? "high" : "low"} — strong ${isHigh ? "resistance" : "support"} on a retest.`;
      bias = isHigh ? "short" : "long";
    }
    return { kind: lv.kind, label: lv.label, short: lv.short, acceptance, read, bias };
  });

  // ── Overall bias ──
  let lean: "long" | "short" | "neutral" = "neutral";
  let text = "Two-sided auction — trade the reference levels, no strong directional lean.";
  if (dayType === "trend-up") { lean = "long"; text = "Trend up — favor break-&-retest longs above IB/PDH; stops below IB low."; }
  else if (dayType === "trend-down") { lean = "short"; text = "Trend down — favor break-&-retest shorts below IB/PDL; stops above IB high."; }
  else if (dayType === "reversal-up") { lean = "long"; text = "Reversal up — early low taken then reclaimed; long back above IB."; }
  else if (dayType === "reversal-down") { lean = "short"; text = "Reversal down — poor high then back below IB; short the rollover."; }
  else if (dayType === "balance") { lean = "neutral"; text = "Balance day — fade ONH/PDH and ONL/PDL back toward the IB mid; avoid the middle."; }

  return {
    ib,
    dayType,
    dayTypeLabel,
    dayTypeDetail,
    levelReads,
    bias: { lean, text },
  };
}

// ─── AMT entry triggers ───────────────────────────────────────────────────────
// Rule-based scalping setups built on the reference levels + IB. Each trigger is
// detected from completed 5m ES bars and carries entry/stop/target guidance in
// ES points. Direction long/short; freshness = bars since it fired.

export type TriggerKind =
  | "break-retest-long"     // A: ONH/PDH break & retest holds
  | "break-retest-short"    // D: ONL/PDL breakdown & retest fails
  | "ib-extension-long"     // C: IB-high break that also clears ONH
  | "ib-extension-short"    // C': IB-low break that also clears ONL
  | "poor-high-short"       // E: probe above PDH/ONH then rolls over
  | "poor-low-long"         // E': probe below PDL/ONL then reclaims
  | "balance-break-short"   // F: balance breaks down, leaves LVN
  | "balance-break-long";   // F: balance breaks up

export interface Trigger {
  kind: TriggerKind;
  code: string;             // "A" / "D" / "E" …
  title: string;
  direction: "long" | "short";
  ref: string;              // reference level short, e.g. "PDH"
  ts: number;               // bar ts the trigger confirmed
  barsAgo: number;          // how many 5m bars since it fired (0 = current)
  entry: number;            // suggested entry (ES)
  stop: number;             // suggested stop (ES)
  target: number;           // suggested target (ES)
  confluence: string;       // checklist note
  active: boolean;          // fresh enough to still be actionable
}

const FRESH_BARS = 4;       // a trigger stays "active" ~20 min after firing

function rrTarget(entry: number, stop: number, mult: number): number {
  return entry + (entry - stop) * mult;
}

/**
 * Detect AMT entry triggers from today's RTH bars given the reference levels and
 * AMT context. Returns newest-first. Levels are matched by kind so we can label
 * the reference (PDH/ONH/…); VA/IB come from `amt`.
 */
export function detectTriggers(
  candles: EsCandle[],
  todayDate: string,
  amt?: AmtResult,
): Trigger[] {
  const ctx = amt ?? computeAmt(candles, todayDate);
  const levels = computeRefLevels(candles, todayDate);
  const bars = candles
    .filter((c) => c.date === todayDate && isRthBar(c.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (bars.length < 2) return [];

  const lastIdx = bars.length - 1;
  const ib = ctx.ib;
  const byKind = new Map(levels.map((l) => [l.kind, l]));
  const out: Trigger[] = [];
  const buf = 0.5;

  const push = (t: Omit<Trigger, "barsAgo" | "active">) => {
    const idx = bars.findIndex((b) => b.timestamp === t.ts);
    const barsAgo = idx >= 0 ? lastIdx - idx : 999;
    out.push({ ...t, barsAgo, active: barsAgo <= FRESH_BARS });
  };

  // Helper: did price break a high-level then pull back and hold above it?
  const highLevels: Array<["PDH" | "ONH", LevelKind]> = [["ONH", "onHigh"], ["PDH", "pdHigh"]];
  const lowLevels: Array<["PDL" | "ONL", LevelKind]> = [["ONL", "onLow"], ["PDL", "pdLow"]];

  // ── A: Break & retest long (ONH/PDH) ──
  for (const [ref, kind] of highLevels) {
    const lv = byKind.get(kind);
    if (!lv) continue;
    for (let i = 1; i < bars.length - 1; i++) {
      const broke = bars[i].close > lv.price + buf && bars[i - 1].close <= lv.price + buf;
      if (!broke) continue;
      // look for a pullback that retests then closes back up
      for (let j = i + 1; j <= Math.min(bars.length - 1, i + 4); j++) {
        const retest = bars[j].low <= lv.price + buf && bars[j].close > lv.price && bars[j].close >= bars[j].open;
        if (retest) {
          const entry = bars[j].close;
          const stop = Math.min(lv.price - buf, bars[j].low) - buf;
          push({ kind: "break-retest-long", code: "A", title: `${ref} Break & Retest`, direction: "long", ref, ts: bars[j].timestamp, entry, stop, target: rrTarget(entry, stop, 2), confluence: "Break held on retest — pair with HVN / GEX support.", });
          break;
        }
      }
    }
  }

  // ── D: Breakdown & retest short (ONL/PDL) ──
  for (const [ref, kind] of lowLevels) {
    const lv = byKind.get(kind);
    if (!lv) continue;
    for (let i = 1; i < bars.length - 1; i++) {
      const broke = bars[i].close < lv.price - buf && bars[i - 1].close >= lv.price - buf;
      if (!broke) continue;
      for (let j = i + 1; j <= Math.min(bars.length - 1, i + 4); j++) {
        const retest = bars[j].high >= lv.price - buf && bars[j].close < lv.price && bars[j].close <= bars[j].open;
        if (retest) {
          const entry = bars[j].close;
          const stop = Math.max(lv.price + buf, bars[j].high) + buf;
          push({ kind: "break-retest-short", code: "D", title: `${ref} Breakdown & Retest`, direction: "short", ref, ts: bars[j].timestamp, entry, stop, target: rrTarget(entry, stop, 2), confluence: "Failed retest from below — pair with HVN / GEX resistance.", });
          break;
        }
      }
    }
  }

  // ── E: Poor-high rejection short (probe above then roll over) ──
  for (const [ref, kind] of highLevels) {
    const lv = byKind.get(kind);
    if (!lv) continue;
    for (let i = 1; i < bars.length; i++) {
      const probe = bars[i].high > lv.price + buf;
      const rejected = bars[i].close < lv.price && bars[i].close < bars[i].open;
      if (probe && rejected) {
        const entry = bars[i].close;
        const stop = bars[i].high + buf;
        push({ kind: "poor-high-short", code: "E", title: `Poor High @ ${ref}`, direction: "short", ref, ts: bars[i].timestamp, entry, stop, target: rrTarget(entry, stop, 2), confluence: "Weak acceptance above the high — fade the poor high.", });
      }
    }
  }

  // ── E': Poor-low rejection long (probe below then reclaim) ──
  for (const [ref, kind] of lowLevels) {
    const lv = byKind.get(kind);
    if (!lv) continue;
    for (let i = 1; i < bars.length; i++) {
      const probe = bars[i].low < lv.price - buf;
      const reclaimed = bars[i].close > lv.price && bars[i].close > bars[i].open;
      if (probe && reclaimed) {
        const entry = bars[i].close;
        const stop = bars[i].low - buf;
        push({ kind: "poor-low-long", code: "E", title: `Poor Low @ ${ref}`, direction: "long", ref, ts: bars[i].timestamp, entry, stop, target: rrTarget(entry, stop, 2), confluence: "Weak acceptance below the low — reclaim long off the poor low.", });
      }
    }
  }

  // ── C / C': IB breakout extension that also clears ONH/ONL ──
  if (ib && ib.locked) {
    const onH = byKind.get("onHigh");
    const onL = byKind.get("onLow");
    for (let i = 1; i < bars.length; i++) {
      if (etMinutes(bars[i].timestamp) < IB_END) continue;
      const clearsHi = bars[i].close > ib.high + buf && (!onH || bars[i].close > onH.price);
      const prevBelow = bars[i - 1].close <= ib.high + buf;
      if (clearsHi && prevBelow) {
        const entry = bars[i].close;
        const stop = ib.low - buf;
        push({ kind: "ib-extension-long", code: "C", title: "IB-High Extension", direction: "long", ref: "IBH", ts: bars[i].timestamp, entry, stop, target: entry + (ib.high - ib.low) * 2, confluence: "IB-high break clearing ONH — expansion; target 2× IB range.", });
      }
      const clearsLo = bars[i].close < ib.low - buf && (!onL || bars[i].close < onL.price);
      const prevAbove = bars[i - 1].close >= ib.low - buf;
      if (clearsLo && prevAbove) {
        const entry = bars[i].close;
        const stop = ib.high + buf;
        push({ kind: "ib-extension-short", code: "C", title: "IB-Low Extension", direction: "short", ref: "IBL", ts: bars[i].timestamp, entry, stop, target: entry - (ib.high - ib.low) * 2, confluence: "IB-low break clearing ONL — expansion; target 2× IB range.", });
      }
    }
  }

  // ── F: Balance-to-imbalance break (out of ON range) ──
  const onH = byKind.get("onHigh");
  const onL = byKind.get("onLow");
  if (onH && onL) {
    for (let i = 2; i < bars.length; i++) {
      // crude "balance": prior two bars inside the ON range
      const inBal = bars[i - 1].high <= onH.price && bars[i - 1].low >= onL.price &&
                    bars[i - 2].high <= onH.price && bars[i - 2].low >= onL.price;
      if (!inBal) continue;
      if (bars[i].close < onL.price - buf) {
        const entry = bars[i].close;
        const stop = onH.price + buf;
        push({ kind: "balance-break-short", code: "F", title: "Balance → Imbalance ↓", direction: "short", ref: "ONL", ts: bars[i].timestamp, entry, stop, target: rrTarget(entry, stop, 1.5), confluence: "Break below balance low on volume — imbalance breakout.", });
      } else if (bars[i].close > onH.price + buf) {
        const entry = bars[i].close;
        const stop = onL.price - buf;
        push({ kind: "balance-break-long", code: "F", title: "Balance → Imbalance ↑", direction: "long", ref: "ONH", ts: bars[i].timestamp, entry, stop, target: rrTarget(entry, stop, 1.5), confluence: "Break above balance high on volume — imbalance breakout.", });
      }
    }
  }

  // De-dup identical (kind, ts) and sort newest-first.
  const seen = new Set<string>();
  const dedup = out.filter((t) => {
    const k = `${t.kind}-${t.ts}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  dedup.sort((a, b) => b.ts - a.ts);
  return dedup;
}
