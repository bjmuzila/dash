import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/supabase/server";
import {
  insertTradingFills, getTradingFills, upsertTradingJournalDay,
  type TradingFill,
} from "@/lib/db";
import {
  importCsv, matchRoundTrips, deriveDays,
  type BrokerId, type ColumnMap, type Fill,
} from "@/lib/journal/csv";

// Broker-CSV import for the /trading journal.
//
//   POST { csv, broker?, map?, commit:false }  → PREVIEW: parse only, write
//        nothing, return the detected broker, the derived day rows, a sample of
//        trades, and any warnings (unknown futures roots, skipped rows).
//   POST { csv, broker?, map?, commit:true }   → COMMIT: insert the fills
//        (dedup on ext_id), then RE-DERIVE every affected day from ALL of the
//        user's fills — not just this file's — and upsert those day rows.
//
// Re-deriving from the full fill history (rather than from the uploaded file
// alone) is the whole point of storing fills: a position opened Monday and
// closed Tuesday only books P&L when the closing file arrives, and a statement
// that overlaps a previous import corrects the day instead of double-counting.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CSV_BYTES = 8 * 1024 * 1024;   // ~8MB — a decade of retail fills

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const csv = String(body.csv ?? "");
    if (!csv.trim()) return NextResponse.json({ error: "csv required" }, { status: 400 });
    if (csv.length > MAX_CSV_BYTES) {
      return NextResponse.json({ error: "file too large (max 8MB)" }, { status: 413 });
    }
    const broker = body.broker ? (String(body.broker) as BrokerId) : undefined;
    const map = (body.map ?? undefined) as ColumnMap | undefined;
    const commit = body.commit === true;

    const parsed = importCsv(csv, broker, map);

    if (!parsed.fills.length) {
      return NextResponse.json({
        error: "No executions found in that file.",
        broker: parsed.broker,
        header: parsed.header,
        skipped: parsed.skipped,
      }, { status: 422 });
    }

    // ── Preview ──────────────────────────────────────────────────────────────
    if (!commit) {
      return NextResponse.json({
        ok: true,
        preview: true,
        broker: parsed.broker,
        header: parsed.header,
        counts: { fills: parsed.fills.length, trades: parsed.trades.length, days: parsed.days.length },
        days: parsed.days,
        trades: parsed.trades.slice(0, 50),
        skipped: parsed.skipped,
        warnings: warningsFor(parsed.unknownRoots, parsed.skipped, parsed.fills),
      });
    }

    // ── Commit ───────────────────────────────────────────────────────────────
    const inserted = await insertTradingFills(session.userId, parsed.fills as TradingFill[]);

    // Re-derive the affected days from the user's ENTIRE fill history so
    // cross-file positions and overlapping statements come out right.
    const all = await getTradingFills(session.userId);
    const trades = matchRoundTrips(all as unknown as Fill[]);
    const days = deriveDays(trades);

    const touched = new Set(parsed.days.map((d) => d.date));
    const affected = days.filter((d) => touched.has(d.date));
    const rows = [];
    for (const d of affected) {
      const row = await upsertTradingJournalDay(session.userId, d);
      if (row) rows.push(row);
    }

    return NextResponse.json({
      ok: true,
      preview: false,
      broker: parsed.broker,
      inserted,                                    // NEW fills written
      duplicates: parsed.fills.length - inserted,  // already had these
      days: rows,
      warnings: warningsFor(parsed.unknownRoots, parsed.skipped, parsed.fills),
    });
  } catch (err) {
    console.error("[/api/journal/import]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** Human-readable caveats surfaced in the preview so nothing lands silently wrong. */
function warningsFor(unknownRoots: string[], skipped: number, fills: Fill[]): string[] {
  const w: string[] = [];
  if (unknownRoots.length) {
    w.push(
      `Unknown futures contract${unknownRoots.length > 1 ? "s" : ""}: ${unknownRoots.join(", ")}. ` +
      `No point value on file, so P&L for these is computed at 1×/point and will be wrong. ` +
      `Add the root to FUTURES_MULT in lib/journal/csv.ts before relying on it.`
    );
  }
  if (skipped) {
    w.push(`${skipped} row${skipped > 1 ? "s" : ""} skipped (summary lines, cash movements, or missing price/qty/time).`);
  }
  if (fills.every((f) => f.fees === 0)) {
    w.push("No commission column found — commissions will read $0 and net P&L is gross.");
  }
  return w;
}
