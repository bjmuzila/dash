import { NextRequest, NextResponse } from "next/server";
import {
  getDb,
  getEmTrackerRows,
  getEmTrackerSummary,
  getEmTrackerPendingForWeek,
  upsertEmTrackerRow,
  setEmTrackerResult,
  deleteEmTrackerRow,
  clearEmTracker,
  type EmTrackerRow,
} from "@/lib/db";
import { computeResult } from "@/lib/em-tracker/computeResult";

// EM Tracker — per-ticker weekly Estimated Move hit/miss record.
//
// GET  /api/em-tracker                 -> { summary: [...], rows: [...] }
// GET  /api/em-tracker?view=summary    -> { summary: [...] }
// GET  /api/em-tracker?ticker=SPX      -> { rows: [...] }   (one ticker's weeks)
//
// POST /api/em-tracker
//   single week:   { ticker, week_label, em, ref_close?, up?, down?, o?,h?,l?,c?, result?, note? }
//   bulk seed:     { rows: [ {ticker, week_label, em, ...}, ... ] }
//   set result:    { id, result: 'hit'|'miss' }
//
// DELETE /api/em-tracker?id=123

export async function GET(req: NextRequest) {
  try {
    await getDb();
    const view = req.nextUrl.searchParams.get("view");
    const ticker = (req.nextUrl.searchParams.get("ticker") || "").trim().toUpperCase();
    const weekStart = (req.nextUrl.searchParams.get("week_start") || "").trim();
    const status = (req.nextUrl.searchParams.get("status") || "").trim();

    if (weekStart && status === "pending") {
      return NextResponse.json({ rows: await getEmTrackerPendingForWeek(weekStart) });
    }
    if (view === "summary") {
      return NextResponse.json({ summary: await getEmTrackerSummary() });
    }
    if (ticker) {
      return NextResponse.json({ rows: await getEmTrackerRows(ticker) });
    }
    const [summary, rows] = await Promise.all([getEmTrackerSummary(), getEmTrackerRows()]);
    return NextResponse.json({ summary, rows });
  } catch (err) {
    console.error("[/api/em-tracker GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    await getDb();

    // set/override a single result
    if (body.id != null && (body.result === "hit" || body.result === "miss")) {
      await setEmTrackerResult(Number(body.id), body.result, "manual");
      return NextResponse.json({ ok: true });
    }

    // bulk seed / import
    const incoming: EmTrackerRow[] = Array.isArray(body.rows)
      ? body.rows
      : body.ticker
        ? [body]
        : [];
    if (!incoming.length) {
      return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
    }

    let saved = 0;
    for (const raw of incoming) {
      if (!raw.ticker || !raw.week_label || raw.em == null) continue;
      const row: EmTrackerRow = {
        ...raw,
        ticker: String(raw.ticker).toUpperCase(),
        em: Number(raw.em),
        result_source: raw.result_source ?? (Array.isArray(body.rows) ? "import" : "manual"),
      };
      // If OHLC + band are present and no explicit result given, compute it now.
      if (row.result == null) {
        const computed = computeResult(row);
        if (computed) row.result = computed;
      }
      await upsertEmTrackerRow(row);
      saved++;
    }
    return NextResponse.json({ ok: true, saved });
  } catch (err) {
    console.error("[/api/em-tracker POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await getDb();
    const params = req.nextUrl.searchParams;
    const all = params.get("all");
    const source = params.get("source");

    // Bulk reset: ?all=1 wipes going-forward rows; ?source=import|seed|auto|manual
    // wipes only that source. Verified 31-week history (JSON) is unaffected.
    if (all === "1" || source) {
      const removed = await clearEmTracker(source || undefined);
      return NextResponse.json({ ok: true, removed });
    }

    const id = Number(params.get("id"));
    if (!id) return NextResponse.json({ error: "Missing id (or pass ?all=1 / ?source=)" }, { status: 400 });
    await deleteEmTrackerRow(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/em-tracker DELETE]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
