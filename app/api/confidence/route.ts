import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne, getEsCandles, type MvcRecord } from "@/lib/db";
import {
  scoreConfidence,
  type LevelContext,
  type HistoricalAnalogStats,
} from "@/lib/confidenceScore";

export const dynamic = "force-dynamic";

// ── Tunables (SPX points) ───────────────────────────────────────────────────
const HIT_PTS = 8;            // SPX pts within the MVC strike to count as a touch
const PIVOT_PTS = 10;         // reversal of >= this many pts after touch = pivot
const CHOP_BAND = 15;         // stayed within +/- this band of the level = chop
const ANALOG_GEX_TOL = 0.25;  // gex-dominance similarity window (fraction)
const ANALOG_MAX = 120;       // cap prior days scanned
const EM_FALLBACK_FRACT = 0.004; // EM proxy = 0.4% of price if no intraday range
const EM_FLOOR_FRACT = 0.006;    // EM never smaller than 0.6% of price (proximity/flip scale)

// ── ES → SPX conversion (cash basis) ─────────────────────────────────────────
// impliedSPX = es - (esClose - spxClose). The basis (esClose - spxClose) is the
// ES-to-cash spread fixed at the 4pm settle; we anchor it from the day's closing
// MVC snapshot (which carries both esPrice and spxPrice) and apply it to each
// 5-minute ES bar to reconstruct a true intraday SPX OHLC series.
const RTH_OPEN_MIN = 9 * 60 + 30; // 9:30am ET
const RTH_CLOSE_MIN = 16 * 60;    // 4:00pm ET

function etMinutesOf(slotKey: string): number | null {
  // slotKey "YYYY-MM-DDTHH:MM" — the HH:MM is already ET.
  const hh = Number(slotKey.slice(11, 13));
  const mm = Number(slotKey.slice(14, 16));
  return Number.isFinite(hh) && Number.isFinite(mm) ? hh * 60 + mm : null;
}

function todayET(): string {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
    .toISOString()
    .slice(0, 10);
}

/** Current ET minute-of-day (0..1439). */
function nowMinutesET(): number {
  const hhmm = new Date().toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit",
  });
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/**
 * Fraction of the RTH session elapsed (0..1), from the wall clock — independent
 * of snapshot cadence. Past dates = 1 (complete); before the open = 0.
 */
function sessionProgressET(date: string): number {
  if (date < todayET()) return 1;
  if (date > todayET()) return 0;
  const mins = nowMinutesET();
  if (mins <= RTH_OPEN_MIN) return 0;
  if (mins >= RTH_CLOSE_MIN) return 1;
  return (mins - RTH_OPEN_MIN) / (RTH_CLOSE_MIN - RTH_OPEN_MIN);
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Pick the active MVC PRICE level + signed GEX/DEX from a snapshot row.
 * NOTE: mvcValue* are $B GEX magnitudes, NOT prices. The price level is the
 * strike (strikeOIVol / strikeVolOnly). spxPrice is where price sat.
 */
/** The MVC strike for a single row (OI+Vol primary, Vol-only fallback). */
function strikeOf(r: MvcRecord): number | null {
  return num(r.strikeOIVol) ?? num(r.strikeVolOnly) ?? null;
}

/** A price sample tagged with its ET minute-of-day (for window slicing). */
type TimedPx = { min: number; px: number };

/** ET minute-of-day for a snapshot row, from its `time` field or timestamp. */
function rowMinutesET(r: MvcRecord): number | null {
  const t = String((r as { time?: unknown }).time ?? "");
  const mm = /^(\d{1,2}):(\d{2})/.exec(t);
  if (mm) return Number(mm[1]) * 60 + Number(mm[2]);
  const ms = Number(r.timestamp) || 0;
  if (!ms) return null;
  const hhmm = new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit",
  });
  const p = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return p ? Number(p[1]) * 60 + Number(p[2]) : null;
}

/** "HH:MM" ET for a snapshot row, from its `time` field or the timestamp. */
function rowTimeET(r: MvcRecord): string {
  const t = String((r as { time?: unknown }).time ?? "");
  if (/^\d{1,2}:\d{2}/.test(t)) return t.slice(0, 5);
  const ms = Number(r.timestamp) || 0;
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit",
  });
}

function pickLevel(r: MvcRecord) {
  const level = num(r.strikeOIVol) ?? num(r.strikeVolOnly) ?? num(r.spxPrice) ?? 0;
  // GEX *at the MVC strike* (not the chain's net sum). Used as the dominance
  // numerator and as the level's signed-GEX regime input.
  const strikeGex =
    num(r.mvcValueOIVol) ?? num(r.mvcValueVolOnly) ?? num(r.totalNetGEX_OI) ?? 0;
  const netTotal = num(r.totalNetGEX_OI) ?? num(r.totalNetGEX_Vol) ?? 0;
  const netDex = num(r.totalNetDEX_OI) ?? num(r.totalNetDEX_Vol) ?? num(r.netDEXStrike) ?? 0;
  // Gross sum of |GEX| across strikes (dominance denominator). Old rows wrote
  // abs(netSum) here, which equals |strikeGex| only by accident — guard against
  // that degenerate case so dominance can't pin at exactly 100 on legacy data.
  const storedAbs = num(r.totalAbsNetGEX);
  const totalAbsNetGEX =
    storedAbs != null && storedAbs > Math.abs(strikeGex) * 1.0001
      ? storedAbs
      : Math.abs(netTotal); // legacy/degenerate → fall back to net-sum scale
  return {
    level,
    netGex: strikeGex,         // signed GEX at the level (regime + dominance numerator)
    netTotal,                  // chain net sum (kept for readouts)
    netDex,
    spx: num(r.spxPrice) ?? level,
    es: num(r.esPrice) ?? num(r.spxPrice) ?? level, // display reference only
    totalAbsNetGEX,
    gexFlip: num(r.gexFlip),
    ts: Number(r.timestamp) || 0,
  };
}

type Outcome = "hit" | "pivot" | "chop" | "miss";

/** Richer day diagnostics used to build the human-readable outcome card. */
interface OutcomeDetail {
  outcome: Outcome;
  touched: boolean;
  approachFromBelow: boolean; // price approached the level from underneath
  brokeThrough: boolean;      // closed/extended past the level after touch
  maxAway: number;            // largest reversal back the way price came (pts)
  maxBand: number;            // largest excursion from level either side (pts)
  overshoot: number;          // largest excursion PAST the level (pts) then back
}

/**
 * Classify how SPX behaved around `level` over a day's MVC snapshots.
 * Uses the intraday sequence of spxPrice (each snapshot is a sample point).
 * - hit   : price came within HIT_PTS of the level, then continued through
 * - pivot : after touching, reversed >= PIVOT_PTS back the way it came
 * - chop  : touched and stayed within +/- CHOP_BAND for the rest of the day
 * - miss  : never came within HIT_PTS of the level
 */
function classifyDay(level: number, spxSeries: number[]): OutcomeDetail {
  const base: OutcomeDetail = {
    outcome: "miss", touched: false, approachFromBelow: true,
    brokeThrough: false, maxAway: 0, maxBand: 0, overshoot: 0,
  };
  if (!spxSeries.length || !Number.isFinite(level)) return base;

  let touchedIdx = -1;
  for (let i = 0; i < spxSeries.length; i++) {
    if (Math.abs(spxSeries[i] - level) <= HIT_PTS) { touchedIdx = i; break; }
  }
  if (touchedIdx === -1) return base;

  const approachFromBelow = spxSeries[touchedIdx] <= level;
  let maxAway = 0;       // reversal excursion back the way price came
  let maxBand = 0;       // max distance from level (either side) after touch
  let overshoot = 0;     // furthest price pushed PAST the level (in travel direction)
  for (let i = touchedIdx; i < spxSeries.length; i++) {
    const d = spxSeries[i] - level;
    maxBand = Math.max(maxBand, Math.abs(d));
    const away = approachFromBelow ? level - spxSeries[i] : spxSeries[i] - level;
    maxAway = Math.max(maxAway, away);
    const past = approachFromBelow ? spxSeries[i] - level : level - spxSeries[i];
    overshoot = Math.max(overshoot, past);
  }
  const last = spxSeries[spxSeries.length - 1];
  const brokeThrough = approachFromBelow ? last - level > HIT_PTS : level - last > HIT_PTS;

  let outcome: Outcome = "hit";
  if (maxAway >= PIVOT_PTS) outcome = "pivot";
  else if (maxBand <= CHOP_BAND) outcome = "chop";

  return { outcome, touched: true, approachFromBelow, brokeThrough, maxAway, maxBand, overshoot };
}

/** Back-compat wrapper for analog scanning (label only). */
function classifyFromSpxSeries(level: number, spxSeries: number[]): Outcome {
  return classifyDay(level, spxSeries).outcome;
}

/** Per-segment interaction stats for one MVC strike over its own window. */
interface SegmentStats extends OutcomeDetail {
  closestApproach: number;   // smallest |price - strike| seen in window (pts)
  minToTouch: number | null; // minutes from window start until first touch
  priceAtStart: number | null;
  distAtStart: number;       // |priceAtStart - strike|
}

/**
 * Classify a strike over a time-sliced, timestamped SPX window. `win` must be
 * pre-filtered to the segment's active window (min >= activation). `startMin` is
 * the window's start for time-to-touch.
 */
function classifySegment(strike: number, win: TimedPx[], startMin: number): SegmentStats {
  const det = classifyDay(strike, win.map((s) => s.px));
  let closest = Infinity;
  let minToTouch: number | null = null;
  for (const s of win) {
    const d = Math.abs(s.px - strike);
    if (d < closest) closest = d;
    if (minToTouch == null && d <= HIT_PTS) minToTouch = Math.max(0, s.min - startMin);
  }
  return {
    ...det,
    closestApproach: Number.isFinite(closest) ? closest : Infinity,
    minToTouch,
    priceAtStart: win.length ? win[0].px : null,
    distAtStart: win.length ? Math.abs(win[0].px - strike) : Infinity,
  };
}

const fmtPts = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "—");

type DayScenario = {
  /** Stable key for UI coloring. */
  kind: "reversal" | "pinned" | "false-break" | "breakout" | "squeeze" | "cascade" | "chop" | "approaching" | "untouched";
  wall: "call" | "put" | "neutral";
  title: string;        // archetype name
  status: string;       // short status: Hit / Pinned / Broke through / etc.
  detail: string;       // one-line description of what happened
  forward: string;      // "if this → then that" next-move guidance
  provisional: boolean; // true while session still in progress
};

/**
 * Map the day's mechanics + gamma regime to one of the call/put-wall archetypes.
 * `regime`: +1 positive GEX (call-wall behaviors), -1 negative GEX (put-wall).
 */
// Within this many SPX pts of the level (but not a touch) = "approaching".
// Pure price distance — the Estimated Move plays no role in the outcome read.
const APPROACH_PTS = 40;

function buildDayScenario(
  d: OutcomeDetail,
  regime: number,
  level: number,
  price: number,
  provisional: boolean,
): DayScenario {
  const wall: DayScenario["wall"] = regime > 0 ? "call" : regime < 0 ? "put" : "neutral";
  const fwd = provisional ? "Live: " : "";

  // Not yet touched.
  if (!d.touched) {
    const dist = Math.abs(price - level);
    if (dist <= APPROACH_PTS) {
      return {
        kind: "approaching", wall,
        title: regime < 0 ? "Approaching Put Wall" : "Approaching Call Wall",
        status: "Not yet hit",
        detail: `Price ${fmtPts(dist)} pts from the ${level.toFixed(0)} level — in range to interact.`,
        forward: regime < 0
          ? `${fwd}If it tags the floor → watch for a V-reversal/squeeze; a clean slice through → volatility cascade lower.`
          : `${fwd}If it tags the wall → expect resistance/pin; a convincing break → GEX migration higher.`,
        provisional,
      };
    }
    return {
      kind: "untouched", wall,
      title: "Level Untouched",
      status: "Not hit",
      detail: `Price stayed ${fmtPts(dist)} pts away from ${level.toFixed(0)} — level never came into play.`,
      forward: `${fwd}Out of range for now; level only matters if price travels back toward ${level.toFixed(0)}.`,
      provisional,
    };
  }

  // Touched — branch by regime then mechanics.
  if (regime < 0) {
    // Negative GEX → put-wall behaviors (sharper, directional).
    if (d.outcome === "pivot") {
      return {
        kind: "squeeze", wall,
        title: "Hit & V-Reversed (Squeeze)",
        status: "Hit → reversed up",
        detail: `Tagged the floor and snapped back ${fmtPts(d.maxAway)} pts — short covering / put monetization.`,
        forward: `${fwd}If the squeeze holds above the level → continuation higher; failure back below → retest of the floor.`,
        provisional,
      };
    }
    if (d.outcome === "hit" && d.brokeThrough) {
      return {
        kind: "cascade", wall,
        title: "Break-Through & Volatility Cascade",
        status: "Broke through",
        detail: `Sliced through the level (${fmtPts(d.maxBand)} pts beyond) — forced selling / amplified downside.`,
        forward: `${fwd}If it stays below → cascade can extend to the next wall; reclaim of ${level.toFixed(0)} → squeeze risk.`,
        provisional,
      };
    }
    return {
      kind: "chop", wall,
      title: "Hit & Chopped",
      status: "Hit → choppy",
      detail: `Lingered at the level with wide ${fmtPts(d.maxBand)}-pt swings — unstable, high-vol churn.`,
      forward: `${fwd}Negative-gamma chop resolves sharply: a decisive break either way tends to run — trade the break, not the middle.`,
      provisional,
    };
  }

  // Positive GEX → call-wall behaviors (lower vol, magnet/pinning).
  if (d.outcome === "pivot") {
    return {
      kind: "reversal", wall,
      title: "Hit & Reversed",
      status: "Hit → reversed",
      detail: `Touched the level and turned ${fmtPts(d.maxAway)} pts away — dealer selling resistance held.`,
      forward: `${fwd}If price stays rejected → fade back toward the flip; a re-test that holds → breakout odds rise.`,
      provisional,
    };
  }
  if (d.outcome === "hit" && d.brokeThrough && d.overshoot >= PIVOT_PTS && d.maxAway >= HIT_PTS) {
    return {
      kind: "false-break", wall,
      title: "Hit, Over-Shot & Faded (False Break)",
      status: "False break",
      detail: `Poked ${fmtPts(d.overshoot)} pts past the level, exhausted, then got dragged back.`,
      forward: `${fwd}If it closes back below → failed breakout, fade lower; reclaim of the high → real breakout.`,
      provisional,
    };
  }
  if (d.outcome === "hit" && d.brokeThrough) {
    return {
      kind: "breakout", wall,
      title: "Clean Breakout & GEX Migration",
      status: "Broke through",
      detail: `Pushed convincingly through (${fmtPts(d.maxBand)} pts beyond) — flow rolls higher, wall migrates up.`,
      forward: `${fwd}If it holds above → new wall sets higher (regime shift); loss of the level → snap-back risk.`,
      provisional,
    };
  }
  return {
    kind: "pinned", wall,
    title: "Pinned / Consolidated",
    status: "Pinned",
    detail: `Trapped at the strike in tight ${fmtPts(d.maxBand)}-pt chop — positive-gamma magnet effect.`,
    forward: `${fwd}If pinning persists into the close → expect a settle near ${level.toFixed(0)}; a break of the band → directional move.`,
    provisional,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || todayET();
    // Only treat `em` as an override when the param is actually present —
    // num(null) returns 0 (finite), which would otherwise zero out emSize.
    const emParam = searchParams.get("em");
    const emOverride = emParam != null ? num(emParam) : null;
    const isOpexOr0DTE = searchParams.get("opex") === "1";

    // 1) Current level = latest MVC snapshot for the date.
    const latest = await queryOne<MvcRecord>(
      `SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp DESC LIMIT 1`,
      [date]
    );
    if (!latest) {
      return NextResponse.json({ error: "No MVC snapshot for date", date }, { status: 404 });
    }
    const cur = pickLevel(latest);

    // Today's SPX series (all snapshots) for EM proxy + session progress.
    const todayRows = await queryAll<MvcRecord>(
      `SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp ASC LIMIT 2000`,
      [date]
    );
    const todaySpx = todayRows.map((r) => num(r.spxPrice)).filter((v): v is number => v != null);
    const intradayRange =
      todaySpx.length > 1 ? (Math.max(...todaySpx) - Math.min(...todaySpx)) / 2 : 0;
    const refPrice = cur.spx || todaySpx[todaySpx.length - 1] || cur.level || 0;
    // Proximity scale for scoring: realized half-range, floored modestly (0.3% of
    // price) so it's never degenerate early but stays tighter than the EM floor —
    // this is what gives the scores real strike-to-strike contrast.
    const proxScale = Math.max(intradayRange, refPrice * 0.003);
    // EM scale for proximity/flip. The realized intraday half-range is too small
    // early in the session (and often smaller than the MVC↔price gap), which floors
    // proximity & flip-proximity at 0 all day. Floor it at 0.6% of price.
    const emFloor = refPrice * EM_FLOOR_FRACT;
    const emSize = Math.max(
      emOverride ?? (intradayRange > 0 ? intradayRange : refPrice * EM_FALLBACK_FRACT),
      emFloor
    );
    // Session progress from the RTH clock (cadence-independent: works for 5m,
    // 30m, or any snapshot interval). Past dates are complete.
    const sessionProgress = sessionProgressET(date);

    // 2) Find historical analog days (same gamma regime + similar GEX dominance)
    //    and classify each from its own SPX series — no ES candles needed.
    const priorDays = await queryAll<{ date: string }>(
      `SELECT DISTINCT date FROM mvc_snapshots WHERE date < ? ORDER BY date DESC LIMIT ?`,
      [date, ANALOG_MAX]
    );

    const curGexMag = cur.totalAbsNetGEX > 0 ? Math.abs(cur.netGex) / cur.totalAbsNetGEX : 0;
    const curRegime = Math.sign(cur.netGex);

    let hits = 0, pivots = 0, chops = 0, sampleSize = 0;
    // Same-cluster rejection tracking: a prior analog "rejected" when its MVC
    // strike sat within REJECT_CLUSTER_PTS of TODAY's level AND price pivoted
    // away from it. sessionsSinceDefense = analog-index of the most recent such
    // defense (0 = a defense among the most recent analog day scanned).
    const REJECT_CLUSTER_PTS = 15;
    let clusterTouches = 0, clusterRejections = 0;
    let sessionsSinceDefense: number | null = null;
    let analogIdx = -1;
    const drop = { regime: 0, dominance: 0, noSeries: 0, neverEngaged: 0, noRef: 0 };
    const analogDetail: Array<{ date: string; level: number; gexMag: number; outcome: Outcome }> = [];

    for (const d of priorDays) {
      const dayRows = await queryAll<MvcRecord>(
        `SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp ASC LIMIT 2000`,
        [d.date]
      );
      if (!dayRows.length) { drop.noRef++; continue; }

      const ref = pickLevel(dayRows[0]);
      const pastGexMag = ref.totalAbsNetGEX > 0 ? Math.abs(ref.netGex) / ref.totalAbsNetGEX : 0;
      const pastRegime = Math.sign(ref.netGex);

      if (pastRegime !== curRegime) { drop.regime++; continue; }
      if (Math.abs(pastGexMag - curGexMag) > ANALOG_GEX_TOL) { drop.dominance++; continue; }

      const spxSeries = dayRows.map((r) => num(r.spxPrice)).filter((v): v is number => v != null);
      if (spxSeries.length < 2) { drop.noSeries++; continue; }

      const outcome = classifyFromSpxSeries(ref.level, spxSeries);
      if (outcome === "miss") { drop.neverEngaged++; continue; }
      sampleSize++;
      analogIdx++;
      if (outcome === "hit") hits++;
      else if (outcome === "pivot") pivots++;
      else if (outcome === "chop") chops++;

      // Same-cluster rejection rate: only count analogs whose MVC strike was in
      // the SAME price cluster as today's level — that's "this wall's" defense
      // history, not the whole regime's. A pivot = a rejection (defended).
      if (Math.abs(ref.level - cur.level) <= REJECT_CLUSTER_PTS) {
        clusterTouches++;
        if (outcome === "pivot") {
          clusterRejections++;
          if (sessionsSinceDefense == null) sessionsSinceDefense = analogIdx; // most-recent first
        }
      }
      if (analogDetail.length < 30)
        analogDetail.push({ date: d.date, level: ref.level, gexMag: pastGexMag, outcome });
    }

    const history: HistoricalAnalogStats | null =
      sampleSize > 0
        ? {
            sampleSize,
            hitRate: (hits + pivots + chops) / sampleSize, // engaged the level
            pivotRate: pivots / sampleSize,
            chopRate: chops / sampleSize,
            // Same-cluster defense history (this wall, not the whole regime).
            rejectionRate: clusterTouches > 0 ? clusterRejections / clusterTouches : 0,
            sessionsSinceDefense: sessionsSinceDefense ?? undefined,
          }
        : null;

    // Relative GEX rank of the current level among TODAY's distinct MVC strikes.
    // Each snapshot stores only its own MVC strike's GEX, so we rank by the peak
    // |GEX| seen at each distinct strike today: 1.0 = the day's dominant magnet,
    // 0.8 = 2nd, 0.6 = 3rd… A normalized stand-in for raw GEX size.
    function gexRankFor(level: number, rows: MvcRecord[]): number {
      const peak = new Map<number, number>(); // strike → max |gex|
      for (const r of rows) {
        const k = strikeOf(r);
        if (k == null) continue;
        const g = Math.abs(num(r.mvcValueOIVol) ?? num(r.mvcValueVolOnly) ?? num(r.totalNetGEX_OI) ?? 0);
        const key = Math.round(k);
        peak.set(key, Math.max(peak.get(key) ?? 0, g));
      }
      if (peak.size === 0) return 1;
      const ranked = [...peak.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
      const idx = ranked.indexOf(Math.round(level));
      const rank = idx < 0 ? ranked.length - 1 : idx; // unseen → treat as lowest
      return clamp(1 - rank * 0.2, 0.2, 1); // 1.0, 0.8, 0.6, 0.4, 0.2 floor
    }
    const curGexRank = gexRankFor(cur.level, todayRows);

    // 3) Score (SPX-based).
    const ctx: LevelContext = {
      level: cur.level,
      price: cur.spx,
      emSize,
      intradayRange: proxScale,
      totalAbsNetGEX: cur.totalAbsNetGEX,
      netGexAtLevel: cur.netGex,
      netDexAtLevel: cur.netDex,
      gexFlip: cur.gexFlip,
      isOpexOr0DTE,
      sessionProgress,
      gexRank: curGexRank,
    };
    const result = scoreConfidence(ctx, history);

    // 4) Today's own outcome vs the MVC level (provisional during RTH, final at close).
    const isFinal = date < todayET() || sessionProgress >= 0.95;

    // Reconstruct a true 5-minute SPX intraday series from ES candles using the
    // day's cash basis (esClose - spxClose). The basis is derived from the SAME
    // feed pair we convert: the ES candle nearest the 4pm settle vs the SPX
    // close from snapshots. Falls back to the sparse 30-min spxPrice snapshots
    // when no candles exist OR when the converted series fails a sanity check.
    // Timestamped SPX series: each sample tagged with its ET-minute so segments
    // can be scored against their OWN window (from when a strike became the MVC).
    let spxTimed: TimedPx[] = todayRows
      .map((r) => ({ min: rowMinutesET(r), px: num(r.spxPrice) }))
      .filter((s): s is TimedPx => s.min != null && s.px != null);
    let seriesSource: "es5m" | "snapshots" = "snapshots";
    let basis: number | null = null;
    try {
      const esCandles = await getEsCandles(date, undefined, 2000);
      const rth = esCandles
        .map((c) => ({ c, m: etMinutesOf(c.slotKey) }))
        .filter((x): x is { c: typeof esCandles[number]; m: number } =>
          x.m != null && x.m >= RTH_OPEN_MIN && x.m <= RTH_CLOSE_MIN);

      // SPX close reference = last valid snapshot spxPrice of the day (the settle).
      const spxClose = todaySpx.length ? todaySpx[todaySpx.length - 1] : (num(latest.spxPrice) ?? cur.spx);

      if (rth.length && Number.isFinite(spxClose) && spxClose > 0) {
        // ES candle nearest 4pm = basis anchor on the SAME feed we're converting.
        let esCloseBar = rth[rth.length - 1].c;
        let bestDelta = Math.abs(rth[rth.length - 1].m - RTH_CLOSE_MIN);
        for (const { c, m } of rth) {
          const dlt = Math.abs(m - RTH_CLOSE_MIN);
          if (dlt < bestDelta) { bestDelta = dlt; esCloseBar = c; }
        }
        const esClose = Number(esCloseBar.close);
        if (Number.isFinite(esClose)) {
          basis = esClose - spxClose; // ES trades above cash → basis ≳ 0

          const timed: TimedPx[] = [];
          for (const { c, m } of rth) {
            for (const v of [c.open, c.high, c.low, c.close]) {
              const n = Number(v);
              if (Number.isFinite(n)) timed.push({ min: m, px: n - basis });
            }
          }
          // Sanity: converted close lands on the SPX close (basis is self-
          // consistent) AND the series is on the SPX scale. Guards feed/scale drift.
          const onScale = timed.length >= 4 &&
            timed.every((s) => Math.abs(s.px - cur.level) < 500) &&
            Math.abs((esClose - basis) - spxClose) < 1;
          if (onScale) { spxTimed = timed; seriesSource = "es5m"; }
          else { basis = null; } // reject; fall back to snapshots
        }
      }
    } catch (e) {
      console.warn("[/api/confidence] ES→SPX series fallback:", e);
    }

    // Ensure the snapshot fallback always includes the latest price so a level
    // sitting on current price is never falsely reported as untouched.
    if (seriesSource === "snapshots" && Number.isFinite(cur.spx) && cur.spx > 0) {
      const lastMin = spxTimed.length ? spxTimed[spxTimed.length - 1].min : RTH_CLOSE_MIN;
      spxTimed = [...spxTimed, { min: lastMin, px: cur.spx }];
    }

    const spxSeriesForDay = spxTimed.map((s) => s.px);
    const dayDetail = classifyDay(cur.level, spxSeriesForDay);
    const scenario = buildDayScenario(
      dayDetail, curRegime, cur.level, refPrice, !isFinal,
    );
    const dayOutcome = {
      ...scenario,
      final: isFinal,
      touched: dayDetail.touched,
      outcome: dayDetail.outcome,
      maxAway: Math.round(dayDetail.maxAway),
      maxBand: Math.round(dayDetail.maxBand),
      overshoot: Math.round(dayDetail.overshoot),
      seriesSource,                              // "es5m" = true 5m SPX, "snapshots" = 30m fallback
      basis: basis != null ? Math.round(basis * 100) / 100 : null,
      bars: seriesSource === "es5m" ? Math.round(spxSeriesForDay.length / 4) : todaySpx.length,
    };

    // 4b) MVC timeline — the MVC strike can migrate intraday (e.g. snapped 10x,
    //     changed 5x). Each distinct strike is treated as a fresh MVC: it gets
    //     its OWN confidence score (from that strike's snapshot stats) and its own
    //     outcome read, evaluated against price action FROM when it became the MVC
    //     (window-forward) — i.e. a new score that determines if it would hit.
    type Segment = {
      strike: number; from: string; to: string; fromMin: number; toMin: number;
      snaps: number; act: ReturnType<typeof pickLevel>;
    };
    const segments: Segment[] = [];
    for (const r of todayRows) {
      const k = strikeOf(r);
      if (k == null) continue;
      const t = rowTimeET(r);
      const mn = rowMinutesET(r) ?? RTH_OPEN_MIN;
      const last = segments[segments.length - 1];
      if (last && Math.abs(last.strike - k) < 0.5) {
        last.to = t || last.to;
        last.toMin = mn;
        last.snaps++;
      } else {
        segments.push({ strike: k, from: t, to: t, fromMin: mn, toMin: mn, snaps: 1, act: pickLevel(r) });
      }
    }

    const mvcTimeline = segments.map((seg, i) => {
      const isLast = i === segments.length - 1;
      // Window-forward series: from this strike's activation onward (its own life).
      const win = spxTimed.filter((s) => s.min >= seg.fromMin);
      const stats = classifySegment(seg.strike, win, seg.fromMin);
      const sc = buildDayScenario(stats, Math.sign(seg.act.netGex) || curRegime, seg.strike, refPrice, !isFinal && isLast);

      // Fresh confidence score for THIS strike using its activation-snapshot stats.
      const segCtx: LevelContext = {
        level: seg.strike,
        price: seg.act.spx,
        emSize,
        intradayRange: proxScale,
        totalAbsNetGEX: seg.act.totalAbsNetGEX,
        netGexAtLevel: seg.act.netGex,
        netDexAtLevel: seg.act.netDex,
        gexFlip: seg.act.gexFlip,
        isOpexOr0DTE,
        sessionProgress,
        gexRank: gexRankFor(seg.strike, todayRows),
      };
      // The cluster rejection history was measured around cur.level — only apply
      // it to segments in that same price cluster; others get the regime rates
      // without a misattributed defense boost.
      const segHistory: HistoricalAnalogStats | null = history
        ? Math.abs(seg.strike - cur.level) <= REJECT_CLUSTER_PTS
          ? history
          : { ...history, rejectionRate: 0, sessionsSinceDefense: undefined }
        : null;
      const segScore = scoreConfidence(segCtx, segHistory);

      return {
        strike: seg.strike,
        from: seg.from,
        to: seg.to,
        snaps: seg.snaps,
        current: isLast,
        // Outcome read
        kind: sc.kind,
        title: sc.title,
        status: sc.status,
        detail: sc.detail,
        forward: sc.forward,
        touched: stats.touched,
        outcome: stats.outcome,
        maxAway: Math.round(stats.maxAway),
        maxBand: Math.round(stats.maxBand),
        overshoot: Math.round(stats.overshoot),
        closestApproach: Number.isFinite(stats.closestApproach) ? Math.round(stats.closestApproach) : null,
        minToTouch: stats.minToTouch,
        // Distance SPX was from this strike when it became the MVC. Prefer the
        // time-series window start; fall back to the activation snapshot's own SPX
        // (always present) when no intraday SPX series exists for the date.
        distAtStart: Number.isFinite(stats.distAtStart)
          ? Math.round(stats.distAtStart)
          : seg.act.spx != null && Number.isFinite(seg.act.spx)
            ? Math.round(Math.abs(seg.act.spx - seg.strike))
            : null,
        // Per-strike confidence score
        score: { hit: segScore.hit, pivot: segScore.pivot, chop: segScore.chop, break: segScore.break, netWallBias: segScore.netWallBias },
        gexRank: Math.round(segScore.factors.gexRank * 100),
        rejectionRate: Math.round(segScore.factors.rejectionRate * 100),
        gammaRegime: segScore.factors.gammaRegime,
        // Activation stats for the expandable detail
        stats: {
          spxAtActivation: seg.act.spx != null ? Math.round(seg.act.spx * 100) / 100 : null,
          netGex: Math.round(seg.act.netGex),
          netDex: Math.round(seg.act.netDex),
          gexFlip: seg.act.gexFlip != null ? Math.round(seg.act.gexFlip * 100) / 100 : null,
          gexDominance: Math.round((seg.act.totalAbsNetGEX > 0 ? Math.abs(seg.act.netGex) / seg.act.totalAbsNetGEX : 0) * 100),
        },
      };
    });
    const mvcSummary = {
      distinctStrikes: segments.length,
      changes: Math.max(0, segments.length - 1),
      engaged: mvcTimeline.filter((s) => s.touched).length,
    };

    return NextResponse.json({
      date,
      level: cur.level,
      price: cur.spx,
      spx: cur.spx,
      es: cur.es,
      emSize,
      netGex: cur.netTotal,
      netDex: cur.netDex,
      gexFlip: cur.gexFlip,
      gexMagnitude: curGexMag,
      gexRank: curGexRank,
      sessionProgress,
      score: result,
      dayOutcome,
      mvcTimeline,
      mvcSummary,
      history,
      analogs: analogDetail,
      thresholds: {
        hitPts: HIT_PTS,
        pivotPts: PIVOT_PTS,
        chopBand: CHOP_BAND,
        analogGexTol: ANALOG_GEX_TOL,
        analogMax: ANALOG_MAX,
      },
      debug: {
        priorDaysScanned: priorDays.length,
        curRegime,
        curGexMag,
        todaySnapshots: todayRows.length,
        dropped: drop,
      },
    });
  } catch (err) {
    console.error("[/api/confidence]", err);
    return NextResponse.json({ error: "Confidence error", detail: String(err) }, { status: 500 });
  }
}
