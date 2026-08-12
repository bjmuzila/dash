import { NextRequest, NextResponse } from "next/server";
import { ownerOrInternal, gateDenied } from "@/lib/auth/ownerApiGate";
import path from "node:path";
import {
  getDb,
  getEmCondors,
  getEmCondorMarks,
  upsertEmCondorMarks,
  type EmCondorMark,
} from "@/lib/db";
import { mondayOf } from "@/lib/em-condor/compute";

// Day-by-day condor valuation across the week.
//
// GET  /api/em-condors/marks?week_start=2026-07-27   -> { marks: [...] }
// GET  /api/em-condors/marks?condor_id=42            -> { marks: [...] }
//
// POST /api/em-condors/marks
//   { week_start?: "2026-07-27", ticker?: "SPX", through?: "2026-07-29" }
//   -> rolls the recorded TastyTrade snapshots (em_condor_ticks) up into one
//      row per condor per session, returns { priced, rows, errors }
//
// TastyTrade has no per-contract daily option history, so this is a rollup of
// what the hourly recorder captured, not a historical re-pricing: a week the
// recorder never ran for gets underlying/cushion rows only, and says so in
// `errors`. Cheap enough to hit freely — the UI drives it from the "Refresh
// Marks" button and the recorder fires it once at 16:15 ET.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Load the CommonJS pricing module at runtime, bypassing webpack's static
// bundling of server-only CJS (same trick as em-tracker/evaluate).
function loadMarks() {
  const nodeRequire = eval("require") as NodeRequire;
  return nodeRequire(path.join(process.cwd(), "server-v2", "condor-marks.js"));
}

interface PricedRow extends EmCondorMark { d: string }
interface PricedResult { condor_id: number; ticker: string; rows: PricedRow[] }

export async function GET(req: NextRequest) {
  try {
    // Owner-only. Automated callers (condor-mark-recorder, em-tracker-auto-eval)
    // pass on x-internal-token; see lib/auth/ownerApiGate.ts.
    const gate = await ownerOrInternal(req);
    if (!gate.ok) return gateDenied(gate);

    await getDb();
    const p = req.nextUrl.searchParams;
    const week_start = (p.get("week_start") || "").trim();
    const condor_id = Number(p.get("condor_id")) || undefined;
    if (!week_start && !condor_id) {
      return NextResponse.json({ error: "Pass week_start or condor_id" }, { status: 400 });
    }
    const marks = await getEmCondorMarks({
      week_start: week_start ? mondayOf(week_start) : undefined,
      condor_id,
    });
    return NextResponse.json({ marks });
  } catch (err) {
    console.error("[/api/em-condors/marks GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Owner-only. Automated callers (condor-mark-recorder, em-tracker-auto-eval)
    // pass on x-internal-token; see lib/auth/ownerApiGate.ts.
    const gate = await ownerOrInternal(req);
    if (!gate.ok) return gateDenied(gate);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* default to this week */ }
    await getDb();

    const week_start = mondayOf(String(body.week_start || new Date().toISOString().slice(0, 10)));
    const ticker = body.ticker ? String(body.ticker).toUpperCase() : undefined;

    const condors = (await getEmCondors({ week_start, ticker })).filter(
      (c) => c.put_long != null && c.put_short != null && c.call_short != null && c.call_long != null
    );
    if (!condors.length) {
      return NextResponse.json({
        ok: true, week_start, priced: 0, rows: 0, errors: [],
        note: "No condors with a full set of strikes for that week.",
      });
    }

    const engine = loadMarks();
    const { results, errors } = (await engine.priceCondors(
      condors,
      body.through ? { through: String(body.through) } : {}
    )) as { results: PricedResult[]; errors: string[] };

    let rows = 0;
    let priced = 0;
    for (const r of results) {
      if (!r.rows?.length) continue;
      rows += await upsertEmCondorMarks(r.condor_id, r.rows);
      // "priced" counts condors that got at least one full 4-leg mark — the
      // number that actually produced a P&L curve, not just underlying rows.
      if (r.rows.some((x) => (x.legs_priced ?? 0) === 4)) priced++;
    }

    const marks = await getEmCondorMarks({ week_start });
    return NextResponse.json({
      ok: true,
      week_start,
      condors: condors.length,
      priced,
      rows,
      // Surfaced, not swallowed: a session with no snapshot to roll up is the
      // difference between "flat week" and "no data", and those look identical
      // on a chart.
      errors: errors.slice(0, 40),
      marks,
    });
  } catch (err) {
    console.error("[/api/em-condors/marks POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
