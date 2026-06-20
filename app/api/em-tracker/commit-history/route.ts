import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { getDb } from "@/lib/db";

// Commit reviewed historical EM bands and evaluate them against weekly OHLC.
//
// POST /api/em-tracker/commit-history
//   { weeks: [ { week_start, week_label, rows: [ { ticker, up, down, em?, ref_close? } ] } ] }
//
// Flattens to per-ticker bands, then runs the engine's historical evaluator:
// fetches each ticker's realized weekly OHLC for the given week, computes
// breach (high/low poked outside) + result (close inside band = win), and saves.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Load the CommonJS server-v2 engine at runtime, bypassing webpack static
// bundling (see evaluate/route.ts).
function loadEngine() {
  const nodeRequire = eval("require") as NodeRequire;
  return nodeRequire(path.join(process.cwd(), "server-v2", "levels-engine.js"));
}

interface InRow { ticker: string; up: number; down: number; em?: number; ref_close?: number }
interface InWeek { week_start: string; week_label: string; rows: InRow[] }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const weeks: InWeek[] = Array.isArray(body?.weeks) ? body.weeks : [];
    if (!weeks.length) return NextResponse.json({ error: "No weeks supplied" }, { status: 400 });

    await getDb();

    const bands = weeks.flatMap((w) =>
      (w.rows || [])
        .filter((r) => r.ticker && Number.isFinite(Number(r.up)) && Number.isFinite(Number(r.down)))
        .map((r) => ({
          ticker: String(r.ticker).toUpperCase(),
          week_start: w.week_start,
          week_label: w.week_label,
          up: Number(r.up),
          down: Number(r.down),
          em: r.em != null ? Number(r.em) : undefined,
          ref_close: r.ref_close != null ? Number(r.ref_close) : undefined,
        }))
    );
    if (!bands.length) return NextResponse.json({ error: "No valid bands" }, { status: 400 });

    const base = `http://localhost:${process.env.PORT || 3000}`;
    const engine = loadEngine();
    const out = await engine.evaluateHistoricalWeeks(base, bands);

    return NextResponse.json({ ok: true, weeks: weeks.length, bands: bands.length, ...out });
  } catch (err) {
    console.error("[/api/em-tracker/commit-history POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
