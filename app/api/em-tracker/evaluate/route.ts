import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import {
  getDb,
  getEmTrackerUnevaluated,
  setEmTrackerResult,
  updateEmTrackerOhlc,
} from "@/lib/db";
import { computeResult } from "@/lib/em-tracker/computeResult";

// Evaluate completed-week EM results from weekly OHLC.
//
// POST /api/em-tracker/evaluate
//   default: run the full Saturday evaluator (fetch last week's weekly close for
//            every seeded ticker, decide win/loss = close inside the EM band).
//            Identical to the automatic Saturday 9am job — this is the manual
//            "Evaluate Now" trigger.
//   { ohlc: [...] }: just fill supplied OHLC onto existing rows then score them
//            (used for backfilling a specific week by hand).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Load the CommonJS server-v2 engine at runtime. We bypass webpack's static
// bundling (which can't resolve a server-only CJS module and throws
// "Critical dependency") by resolving require through a non-analyzable path.
function loadEngine() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeRequire = eval("require") as NodeRequire;
  return nodeRequire(path.join(process.cwd(), "server-v2", "levels-engine.js"));
}

export async function POST(req: NextRequest) {
  try {
    await getDb();

    let ohlc: Array<{ ticker: string; week_label: string; o?: number; h: number; l: number; c?: number }> = [];
    try {
      const body = await req.json();
      if (Array.isArray(body?.ohlc)) ohlc = body.ohlc;
    } catch {
      /* no body */
    }

    // Manual OHLC backfill path.
    if (ohlc.length) {
      for (const k of ohlc) {
        if (!k.ticker || !k.week_label) continue;
        await updateEmTrackerOhlc(k.ticker, k.week_label, { o: k.o, h: k.h, l: k.l, c: k.c });
      }
      const pending = await getEmTrackerUnevaluated();
      let hits = 0, misses = 0;
      for (const row of pending) {
        const result = computeResult(row);
        if (!result) continue;
        await setEmTrackerResult(row.id!, result, "auto");
        if (result === "hit") hits++; else misses++;
      }
      return NextResponse.json({ ok: true, evaluated: hits + misses, hits, misses, mode: "ohlc-backfill" });
    }

    // Default path: run the same evaluator the Saturday cron uses.
    const base = `http://localhost:${process.env.PORT || 3000}`;
    const engine = loadEngine();
    const out = await engine.evaluateCompletedWeek(base);
    return NextResponse.json({ ok: true, ...out, mode: "weekly" });
  } catch (err) {
    console.error("[/api/em-tracker/evaluate POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
