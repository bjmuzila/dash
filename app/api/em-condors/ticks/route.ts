import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import {
  getDb,
  getEmCondors,
  getEmCondorTicks,
  insertEmCondorTicks,
  pruneEmCondorTicks,
  type EmCondorTick,
} from "@/lib/db";
import { mondayOf } from "@/lib/em-condor/compute";

// Intraday condor ticks — the hourly writer's endpoint.
//
// GET  /api/em-condors/ticks?week_start=2026-07-27  -> { ticks: [...] }
// GET  /api/em-condors/ticks?condor_id=42           -> { ticks: [...] }
//
// POST /api/em-condors/ticks
//   { week_start?, prune?: 120 }
//   -> snapshots every OPEN condor in that week from the live chain NBBO and
//      appends one tick each. Returns { ts, written, priced, errors }.
//
// One chain-quote call per (ticker, expiry) prices all four legs, so a full
// board is ~20 Theta calls — cheap enough to run at the top of every RTH hour.
// Settled condors are skipped: their P&L is already final.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function loadMarks() {
  const nodeRequire = eval("require") as NodeRequire;
  return nodeRequire(path.join(process.cwd(), "server-v2", "condor-marks.js"));
}

export async function GET(req: NextRequest) {
  try {
    await getDb();
    const p = req.nextUrl.searchParams;
    const week_start = (p.get("week_start") || "").trim();
    const condor_id = Number(p.get("condor_id")) || undefined;
    if (!week_start && !condor_id) {
      return NextResponse.json({ error: "Pass week_start or condor_id" }, { status: 400 });
    }
    const ticks = await getEmCondorTicks({
      week_start: week_start ? mondayOf(week_start) : undefined,
      condor_id,
    });
    return NextResponse.json({ ticks });
  } catch (err) {
    console.error("[/api/em-condors/ticks GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* default to this week */ }
    await getDb();

    const week_start = mondayOf(String(body.week_start || new Date().toISOString().slice(0, 10)));

    const condors = (await getEmCondors({ week_start })).filter(
      (c) => !c.result
        && c.put_long != null && c.put_short != null
        && c.call_short != null && c.call_long != null
    );
    if (!condors.length) {
      return NextResponse.json({
        ok: true, week_start, written: 0, priced: 0, errors: [],
        note: "No open condors with a full set of strikes for that week.",
      });
    }

    const engine = loadMarks();
    const { ts, ticks, errors } = (await engine.snapshotCondorsNow(condors)) as {
      ts: number; ticks: EmCondorTick[]; errors: string[];
    };

    const written = await insertEmCondorTicks(ticks);
    const priced = ticks.filter((t) => (t.legs_priced ?? 0) === 4).length;

    let pruned = 0;
    if (body.prune) pruned = await pruneEmCondorTicks(Number(body.prune) || 120);

    return NextResponse.json({
      ok: true,
      week_start,
      ts,
      condors: condors.length,
      priced,
      written,
      pruned,
      // A leg with a one-sided book prices as null on purpose — surfaced here so
      // a thin wing reads as "no quote", not as a flat P&L line.
      errors: errors.slice(0, 40),
    });
  } catch (err) {
    console.error("[/api/em-condors/ticks POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
