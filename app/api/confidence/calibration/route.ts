import { NextRequest, NextResponse } from "next/server";
import { queryAll, upsertConfidenceLog, getGradedConfidenceLog, type MvcRecord } from "@/lib/db";
import { scoreConfidence, type LevelContext } from "@/lib/confidenceScore";

export const dynamic = "force-dynamic";

// ── Grading thresholds (SPX points) — must match the live outcome read ───────
const HIT_PTS = 8;      // within this of the level = a touch
const PIVOT_PTS = 10;   // reversal >= this after touch = pivot (defended)
const CHOP_BAND = 15;   // stayed within this band after touch = chop (held)
const MAX_DAYS = 250;   // cap days scanned per backfill

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function todayET(): string {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
    .toISOString()
    .slice(0, 10);
}

/** MVC strike + signed GEX/DEX/scale from one snapshot row (mirrors live route). */
function pickLevel(r: MvcRecord) {
  const level = num(r.strikeOIVol) ?? num(r.strikeVolOnly) ?? num(r.spxPrice) ?? 0;
  const strikeGex = num(r.mvcValueOIVol) ?? num(r.mvcValueVolOnly) ?? num(r.totalNetGEX_OI) ?? 0;
  const netTotal = num(r.totalNetGEX_OI) ?? num(r.totalNetGEX_Vol) ?? 0;
  const netDex = num(r.totalNetDEX_OI) ?? num(r.totalNetDEX_Vol) ?? num(r.netDEXStrike) ?? 0;
  const storedAbs = num(r.totalAbsNetGEX);
  const totalAbsNetGEX =
    storedAbs != null && storedAbs > Math.abs(strikeGex) * 1.0001 ? storedAbs : Math.abs(netTotal);
  return {
    level,
    netGex: strikeGex,
    netDex,
    // spot:0 / sub-1000 = feed not populated, not a real index print → treat as
    // missing (matches /api/confidence) so it can't poison classify/refPrice.
    spx: (() => { const v = num(r.spxPrice); return v != null && v > 1000 ? v : level; })(),
    totalAbsNetGEX,
    gexFlip: num(r.gexFlip),
  };
}

type Outcome = "pivot" | "chop" | "hit" | "miss";

/** Classify how SPX behaved around `level` over the day's snapshot series. */
function classifyDay(level: number, spx: number[]): { outcome: Outcome; touched: boolean } {
  if (!spx.length || !Number.isFinite(level)) return { outcome: "miss", touched: false };
  let ti = -1;
  for (let i = 0; i < spx.length; i++) {
    if (Math.abs(spx[i] - level) <= HIT_PTS) { ti = i; break; }
  }
  if (ti === -1) return { outcome: "miss", touched: false };
  const fromBelow = spx[ti] <= level;
  let maxAway = 0, maxBand = 0;
  for (let i = ti; i < spx.length; i++) {
    const d = spx[i] - level;
    maxBand = Math.max(maxBand, Math.abs(d));
    maxAway = Math.max(maxAway, fromBelow ? level - spx[i] : spx[i] - level);
  }
  let outcome: Outcome = "hit"; // touched + broke through (neither pivot nor chop)
  if (maxAway >= PIVOT_PTS) outcome = "pivot";
  else if (maxBand <= CHOP_BAND) outcome = "chop";
  return { outcome, touched: true };
}

/** Brier score for a single binary prediction vs outcome (lower = better). */
const brier = (p: number, actual: number) => (p - actual) ** 2;

/** Bucket a 0..1 probability into a 5-bin label. */
function bucketOf(p: number): string {
  if (p < 0.2) return "0–20%";
  if (p < 0.4) return "20–40%";
  if (p < 0.6) return "40–60%";
  if (p < 0.8) return "60–80%";
  return "80–100%";
}

interface BucketAgg { bucket: string; n: number; predSum: number; actualSum: number; }

/** Build a reliability table for one prediction series (predicted vs realized). */
function reliability(pairs: Array<{ p: number; actual: number }>) {
  const order = ["0–20%", "20–40%", "40–60%", "60–80%", "80–100%"];
  const map = new Map<string, BucketAgg>();
  for (const b of order) map.set(b, { bucket: b, n: 0, predSum: 0, actualSum: 0 });
  let brierSum = 0;
  for (const { p, actual } of pairs) {
    const b = map.get(bucketOf(p))!;
    b.n++; b.predSum += p; b.actualSum += actual;
    brierSum += brier(p, actual);
  }
  const rows = order
    .map((b) => map.get(b)!)
    .filter((b) => b.n > 0)
    .map((b) => ({
      bucket: b.bucket,
      n: b.n,
      predicted: Math.round((b.predSum / b.n) * 100),
      actual: Math.round((b.actualSum / b.n) * 100),
    }));
  return {
    rows,
    sample: pairs.length,
    brier: pairs.length ? Math.round((brierSum / pairs.length) * 1000) / 1000 : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const refresh = new URL(req.url).searchParams.get("refresh") === "1";

    // 1) Backfill: re-score + grade every completed day from snapshot history.
    if (refresh) {
      const days = await queryAll<{ date: string }>(
        `SELECT DISTINCT date FROM mvc_snapshots WHERE date < ? ORDER BY date DESC LIMIT ?`,
        [todayET(), MAX_DAYS]
      );

      // First pass builds a regime/dominance map so analog history can be derived
      // the same way the live route does — but for calibration we score from the
      // live structural prior only (no history blend) to measure the model's OWN
      // predictive power, not a self-referential blend. So no history is passed.
      for (const { date } of days) {
        const rows = await queryAll<MvcRecord>(
          `SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp ASC LIMIT 2000`,
          [date]
        );
        if (!rows.length) continue;

        // Score the FINAL snapshot's level (the day's settled MVC).
        const last = rows[rows.length - 1];
        const cur = pickLevel(last);
        const spx = rows.map((r) => num(r.spxPrice)).filter((v): v is number => v != null && v > 1000);
        const refPrice = cur.spx || spx[spx.length - 1] || cur.level || 0;
        const intradayRange = spx.length > 1 ? (Math.max(...spx) - Math.min(...spx)) / 2 : 0;
        const proxScale = Math.max(intradayRange, refPrice * 0.003);
        const emSize = Math.max(intradayRange > 0 ? intradayRange : refPrice * 0.004, refPrice * 0.006);

        const ctx: LevelContext = {
          level: cur.level,
          price: cur.spx,
          emSize,
          intradayRange: proxScale,
          totalAbsNetGEX: cur.totalAbsNetGEX,
          netGexAtLevel: cur.netGex,
          netDexAtLevel: cur.netDex,
          gexFlip: cur.gexFlip,
          sessionProgress: 1, // completed day
        };
        const score = scoreConfidence(ctx, null); // structural prior only

        const { outcome, touched } = classifyDay(cur.level, spx);
        const held = touched ? (outcome === "pivot" || outcome === "chop" ? 1 : 0) : null;
        const broke = touched ? (outcome === "hit" ? 1 : 0) : null;

        await upsertConfidenceLog({
          date,
          level: cur.level,
          regime: score.factors.gammaRegime,
          reach: score.hit,
          pivot: score.pivot,
          chop: score.chop,
          break: score.break,
          netWallBias: score.netWallBias,
          scored_at: Date.now(),
          touched: touched ? 1 : 0,
          actual_outcome: outcome,
          held,
          broke,
          graded_at: Date.now(),
        });
      }
    }

    // 2) Aggregate the graded log into reliability tables.
    const log = await getGradedConfidenceLog();

    // Reach: predicted P(touch) vs actual touch.
    const reachPairs = log
      .filter((r) => r.touched != null)
      .map((r) => ({ p: clamp(r.reach / 100, 0, 1), actual: r.touched! }));

    // Conditional outcomes — only days where the level WAS touched.
    const touched = log.filter((r) => r.touched === 1);
    // Reject: predicted P(reject | touch) vs actual held (pivot|chop).
    const rejectPairs = touched
      .filter((r) => r.held != null)
      .map((r) => ({ p: clamp(r.pivot / 100, 0, 1), actual: r.held! }));
    // Break: predicted P(break | touch) vs actual break-through.
    const breakPairs = touched
      .filter((r) => r.broke != null)
      .map((r) => ({ p: clamp(r.break / 100, 0, 1), actual: r.broke! }));

    const reach = reliability(reachPairs);
    const reject = reliability(rejectPairs);
    const brk = reliability(breakPairs);

    // Net Wall Bias directional accuracy: when bias > 0 it predicts "held"; when
    // < 0 it predicts "broke". Accuracy among touched, decisive days.
    let biasRight = 0, biasN = 0;
    for (const r of touched) {
      if (r.held == null || r.netWallBias == null) continue;
      if (Math.abs(r.netWallBias) < 1) continue; // skip ~neutral
      biasN++;
      const predHold = r.netWallBias > 0;
      if ((predHold && r.held === 1) || (!predHold && r.held === 0)) biasRight++;
    }

    return NextResponse.json({
      gradedDays: log.length,
      touchedDays: touched.length,
      reach,
      reject,
      break: brk,
      netWallBias: {
        sample: biasN,
        accuracy: biasN ? Math.round((biasRight / biasN) * 100) : null,
      },
      thresholds: { hitPts: HIT_PTS, pivotPts: PIVOT_PTS, chopBand: CHOP_BAND },
      heldRule: "held = pivot OR chop; broke = clean break-through",
      note:
        log.length < 20
          ? "Low sample — treat as indicative only. Reliability stabilizes past ~30–50 graded days."
          : "Compare predicted vs actual per bucket: close = well-calibrated. Brier < 0.25 beats a coin flip.",
    });
  } catch (err) {
    console.error("[/api/confidence/calibration]", err);
    return NextResponse.json({ error: "Calibration error", detail: String(err) }, { status: 500 });
  }
}
