import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne, type MvcRecord } from "@/lib/db";
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

function todayET(): string {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
    .toISOString()
    .slice(0, 10);
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pick the active MVC PRICE level + signed GEX/DEX from a snapshot row.
 * NOTE: mvcValue* are $B GEX magnitudes, NOT prices. The price level is the
 * strike (strikeOIVol / strikeVolOnly). spxPrice is where price sat.
 */
function pickLevel(r: MvcRecord) {
  const level = num(r.strikeOIVol) ?? num(r.strikeVolOnly) ?? num(r.spxPrice) ?? 0;
  const netGex = num(r.totalNetGEX_OI) ?? num(r.totalNetGEX_Vol) ?? 0;
  const netDex = num(r.totalNetDEX_OI) ?? num(r.totalNetDEX_Vol) ?? num(r.netDEXStrike) ?? 0;
  return {
    level,
    netGex,
    netDex,
    spx: num(r.spxPrice) ?? level,
    es: num(r.esPrice) ?? num(r.spxPrice) ?? level, // display reference only
    totalAbsNetGEX: num(r.totalAbsNetGEX) ?? Math.abs(netGex),
    gexFlip: num(r.gexFlip),
    ts: Number(r.timestamp) || 0,
  };
}

type Outcome = "hit" | "pivot" | "chop" | "miss";

/**
 * Classify how SPX behaved around `level` over a day's MVC snapshots.
 * Uses the intraday sequence of spxPrice (each snapshot is a sample point).
 * - hit   : price came within HIT_PTS of the level, then continued through
 * - pivot : after touching, reversed >= PIVOT_PTS back the way it came
 * - chop  : touched and stayed within +/- CHOP_BAND for the rest of the day
 * - miss  : never came within HIT_PTS of the level
 */
function classifyFromSpxSeries(level: number, spxSeries: number[]): Outcome {
  if (!spxSeries.length || !Number.isFinite(level)) return "miss";

  let touchedIdx = -1;
  for (let i = 0; i < spxSeries.length; i++) {
    if (Math.abs(spxSeries[i] - level) <= HIT_PTS) { touchedIdx = i; break; }
  }
  if (touchedIdx === -1) return "miss";

  const approachFromBelow = spxSeries[touchedIdx] <= level;
  let maxAway = 0; // reversal excursion back the way price came
  let maxBand = 0; // max distance from level (either side) after touch
  for (let i = touchedIdx; i < spxSeries.length; i++) {
    const d = spxSeries[i] - level;
    maxBand = Math.max(maxBand, Math.abs(d));
    const away = approachFromBelow ? level - spxSeries[i] : spxSeries[i] - level;
    maxAway = Math.max(maxAway, away);
  }

  if (maxAway >= PIVOT_PTS) return "pivot";
  if (maxBand <= CHOP_BAND) return "chop";
  return "hit"; // broke through
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || todayET();
    const emOverride = num(searchParams.get("em"));
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
    const emSize =
      emOverride ?? (intradayRange > 0 ? intradayRange : refPrice * EM_FALLBACK_FRACT);
    const sessionProgress = Math.min(1, todayRows.length / 24); // ~24 snaps ≈ full day

    // 2) Find historical analog days (same gamma regime + similar GEX dominance)
    //    and classify each from its own SPX series — no ES candles needed.
    const priorDays = await queryAll<{ date: string }>(
      `SELECT DISTINCT date FROM mvc_snapshots WHERE date < ? ORDER BY date DESC LIMIT ?`,
      [date, ANALOG_MAX]
    );

    const curGexMag = cur.totalAbsNetGEX > 0 ? Math.abs(cur.netGex) / cur.totalAbsNetGEX : 0;
    const curRegime = Math.sign(cur.netGex);

    let hits = 0, pivots = 0, chops = 0, sampleSize = 0;
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
      if (outcome === "hit") hits++;
      else if (outcome === "pivot") pivots++;
      else if (outcome === "chop") chops++;
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
          }
        : null;

    // 3) Score (SPX-based).
    const ctx: LevelContext = {
      level: cur.level,
      price: cur.spx,
      emSize,
      totalAbsNetGEX: cur.totalAbsNetGEX,
      netGexAtLevel: cur.netGex,
      netDexAtLevel: cur.netDex,
      gexFlip: cur.gexFlip,
      isOpexOr0DTE,
      sessionProgress,
    };
    const result = scoreConfidence(ctx, history);

    return NextResponse.json({
      date,
      level: cur.level,
      price: cur.spx,
      spx: cur.spx,
      es: cur.es,
      emSize,
      netGex: cur.netGex,
      netDex: cur.netDex,
      gexFlip: cur.gexFlip,
      gexMagnitude: curGexMag,
      sessionProgress,
      score: result,
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
