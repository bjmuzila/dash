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
  // Everything — including getServerSession() — is inside this try/catch now.
  // It used to run before the try block; any throw there (or anywhere else)
  // escaped our error handling entirely and Next served its own HTML error
  // page instead of JSON, which is what broke the client's res.json() call
  // ("Unexpected token '<'") instead of showing a real error message.
  try {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
      const existingFills = await getTradingFills(session.userId);
      const crossSource = crossSourceWarning(existingFills, parsed.days.map((d) => d.date), parsed.broker);
      return NextResponse.json({
        ok: true,
        preview: true,
        broker: parsed.broker,
        header: parsed.header,
        counts: { fills: parsed.fills.length, trades: parsed.trades.length, days: parsed.days.length },
        days: parsed.days,
        trades: parsed.trades.slice(0, 50),
        skipped: parsed.skipped,
        warnings: [...warningsFor(parsed.unknownRoots, parsed.skipped, parsed.fills), ...crossSource],
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

/**
 * If any of this file's session dates already have fills from a DIFFERENT
 * broker/source, flag it before commit. This is the "raw execution export"
 * + "already-matched trade export" collision — e.g. a Rithmic fills CSV and
 * a TPT completed-trades CSV covering the same session both get imported —
 * which would double every trade FIFO-matches after (both sets share the
 * same account+symbol, so they get matched against each other). Not fatal
 * (a legitimately different account trading the same day is fine), just
 * surfaced so it's a conscious choice, not a silent double-count.
 *
 * Takes the user's fills already fetched by the caller (one query) instead of
 * querying per date — a multi-month statement can cover 50+ distinct dates,
 * and 50+ sequential round-trips was slow enough to occasionally time out.
 */
function crossSourceWarning(existingFills: { date: string; source: string }[], dates: string[], incomingSource: string): string[] {
  const touched = new Set(dates);
  const otherSources = new Set<string>();
  for (const f of existingFills) {
    if (touched.has(f.date) && f.source && f.source !== incomingSource) otherSources.add(f.source);
  }
  if (!otherSources.size) return [];
  return [
    `${dates.length === 1 ? "This date" : "Some of these dates"} already ha${dates.length === 1 ? "s" : "ve"} fills imported from a different source ` +
    `(${[...otherSources].join(", ")}). If that's the SAME trading activity re-exported from a different tool ` +
    `(e.g. a raw fills export vs. an already-matched trades export), importing both will double-count every trade. ` +
    `Only proceed if this file covers different trades or a different account than what's already there.`,
  ];
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
