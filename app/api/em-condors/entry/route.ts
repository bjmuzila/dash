import { NextRequest, NextResponse } from "next/server";
import { ownerOrInternal, gateDenied } from "@/lib/auth/ownerApiGate";
import path from "node:path";
import { getDb, getEmCondors, upsertEmCondor, type EmCondorRow } from "@/lib/db";
import { mondayOf, weekLabel } from "@/lib/em-condor/compute";

// Entry credit — the price you'd have collected opening the condor.
//
// GET  /api/em-condors/entry?week_start=2026-07-27
//        -> { week_start, rows: [...] }   preview only, nothing saved
//
// POST /api/em-condors/entry
//        { week_start?, overwrite?, tickers?: [...] }
//        -> { ok, week_start, condors, priced, written, skipped, rows, errors }
//
// The math is the same one the hourly writer already runs. snapshotCondorsNow()
// returns, per condor, a `mark` built from live NBBO mids:
//
//     mark = (put_short_px − put_long_px) + (call_short_px − call_long_px)
//
// On an OPEN position that is the debit to close. At entry the identical number
// is the credit collected, so this route splits it into its two spreads and
// stamps put_credit / call_credit / net_credit onto the row.
//
// Non-destructive by default: a condor that already carries a credit is skipped,
// so a hand-typed real fill is never overwritten by a mid-based estimate. Pass
// overwrite:true to restamp.
//
// Basis note: these are NBBO MIDS, matching how the ticks and EOD marks price the
// same legs — so day-1 open_pnl starts at zero and every later number is
// apples-to-apples. You sell a condor, so a real fill lands below mid; treat the
// stamped credit as the mark-to-market entry, not a claimed execution.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Columns forced to EXCLUDED (i.e. overwritten) when overwrite:true. */
const CREDIT_COLS = ["put_credit", "call_credit", "net_credit"];

function loadMarks() {
  const nodeRequire = eval("require") as NodeRequire;
  return nodeRequire(path.join(process.cwd(), "server-v2", "condor-marks.js"));
}

interface SnapshotTick {
  condor_id: number;
  ticker: string;
  put_long_px: number | null;
  put_short_px: number | null;
  call_short_px: number | null;
  call_long_px: number | null;
  mark: number | null;
  legs_priced: number | null;
}

interface EntryRow {
  condor_id: number;
  ticker: string;
  put_credit: number | null;
  call_credit: number | null;
  net_credit: number | null;
  legs_priced: number;
  had_credit: boolean;
  skipped?: string;
}

/** Round a credit to cents — option premia are quoted there and the extra float
 *  noise off a mid calculation only makes the UI's inputs look wrong. */
function cents(v: number): number {
  return Math.round(v * 100) / 100;
}

async function compute(week_start: string, opts: { overwrite?: boolean; tickers?: string[] }) {
  const only = opts.tickers?.length
    ? new Set(opts.tickers.map((t) => String(t).toUpperCase()))
    : null;

  // Open condors with a complete set of strikes. A settled week is history — its
  // entry price is whatever was recorded at the time and must not be restamped.
  const candidates = (await getEmCondors({ week_start })).filter(
    (c) => !c.result
      && c.put_long != null && c.put_short != null
      && c.call_short != null && c.call_long != null
      && (!only || only.has(String(c.ticker).toUpperCase()))
  );

  const hasCredit = (c: { net_credit?: number | null; put_credit?: number | null; call_credit?: number | null }) => {
    const net = Number(c.net_credit);
    if (Number.isFinite(net) && net !== 0) return true;
    const p = Number(c.put_credit), k = Number(c.call_credit);
    return (Number.isFinite(p) && p !== 0) || (Number.isFinite(k) && k !== 0);
  };

  const targets = opts.overwrite ? candidates : candidates.filter((c) => !hasCredit(c));
  if (!targets.length) return { candidates, targets, rows: [] as EntryRow[], errors: [] as string[] };

  const engine = loadMarks();
  const { ticks, errors } = (await engine.snapshotCondorsNow(targets)) as {
    ticks: SnapshotTick[]; errors: string[];
  };

  const byId = new Map(candidates.map((c) => [c.id as number, c]));
  const rows: EntryRow[] = ticks.map((t) => {
    const legs = t.legs_priced ?? 0;
    const base: EntryRow = {
      condor_id: t.condor_id,
      ticker: t.ticker,
      put_credit: null,
      call_credit: null,
      net_credit: null,
      legs_priced: legs,
      had_credit: hasCredit(byId.get(t.condor_id) ?? {}),
    };
    if (legs !== 4) {
      // One-sided book on a wing → chainMids drops that leg. A 3-leg "credit"
      // would silently understate the structure, so refuse it outright.
      return { ...base, skipped: `only ${legs}/4 legs quoted` };
    }
    const put_credit = cents((t.put_short_px as number) - (t.put_long_px as number));
    const call_credit = cents((t.call_short_px as number) - (t.call_long_px as number));
    const net_credit = cents(put_credit + call_credit);
    if (!(net_credit > 0)) {
      // Shorts cheaper than longs is not a condor you'd open — almost always a
      // stale or crossed quote. Surface it instead of stamping a bad entry.
      return { ...base, put_credit, call_credit, net_credit, skipped: "net credit <= 0" };
    }
    return { ...base, put_credit, call_credit, net_credit };
  });

  return { candidates, targets, rows, errors };
}

export async function GET(req: NextRequest) {
  try {
    // Owner-only. Automated callers (condor-mark-recorder, em-tracker-auto-eval)
    // pass on x-internal-token; see lib/auth/ownerApiGate.ts.
    const gate = await ownerOrInternal(req);
    if (!gate.ok) return gateDenied(gate);

    await getDb();
    const p = req.nextUrl.searchParams;
    const week_start = mondayOf(p.get("week_start") || new Date().toISOString().slice(0, 10));
    const { candidates, targets, rows, errors } = await compute(week_start, {
      overwrite: p.get("overwrite") === "true",
    });
    return NextResponse.json({
      week_start,
      week_label: weekLabel(week_start),
      condors: candidates.length,
      eligible: targets.length,
      rows,
      errors: errors.slice(0, 40),
    });
  } catch (err) {
    console.error("[/api/em-condors/entry GET]", err);
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
    try { body = await req.json(); } catch { /* empty body = this week */ }
    await getDb();

    const week_start = mondayOf(String(body.week_start || new Date().toISOString().slice(0, 10)));
    const label = weekLabel(week_start);
    const overwrite = body.overwrite === true;

    const { candidates, targets, rows, errors } = await compute(week_start, {
      overwrite,
      tickers: Array.isArray(body.tickers) ? (body.tickers as string[]) : undefined,
    });

    if (!targets.length) {
      return NextResponse.json({
        ok: true, week_start, week_label: label,
        condors: candidates.length, priced: 0, written: 0, skipped: 0, rows: [], errors: [],
        note: candidates.length
          ? "Every open condor this week already carries a credit — pass overwrite:true to restamp."
          : "No open condors with a full set of strikes for that week.",
      });
    }

    let written = 0;
    let skipped = 0;
    for (const r of rows) {
      if (r.skipped || r.net_credit == null) { skipped++; continue; }
      const row: EmCondorRow = {
        ticker: r.ticker,
        week_start,
        week_label: label,
        put_credit: r.put_credit,
        call_credit: r.call_credit,
        net_credit: r.net_credit,
      };
      // result_source deliberately untouched: this stamps a price, not a verdict,
      // and the COALESCE upsert leaves every other column alone.
      await upsertEmCondor(row, overwrite ? CREDIT_COLS : []);
      written++;
    }

    return NextResponse.json({
      ok: true,
      week_start,
      week_label: label,
      condors: targets.length,
      priced: rows.filter((r) => r.legs_priced === 4).length,
      written,
      skipped,
      rows,
      errors: errors.slice(0, 40),
    });
  } catch (err) {
    console.error("[/api/em-condors/entry POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
