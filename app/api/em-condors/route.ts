import { NextRequest, NextResponse } from "next/server";
import { ownerOrInternal, gateDenied } from "@/lib/auth/ownerApiGate";
import {
  getDb,
  getEmCondors,
  getEmCondorSummary,
  upsertEmCondor,
  setEmCondorSettlement,
  reopenEmCondor,
  deleteEmCondor,
  clearEmCondors,
  type EmCondorRow,
} from "@/lib/db";
import { settle, validateLegs, mondayOf, weekLabel } from "@/lib/em-condor/compute";

// EM Iron Condors — the weekly condor written against each ticker's EM band.
//
// GET  /api/em-condors                     -> { summary: [...], rows: [...] }
// GET  /api/em-condors?view=summary        -> { summary: [...] }
// GET  /api/em-condors?ticker=SPX          -> { rows: [...] }
// GET  /api/em-condors?week_start=2026-07-27 -> { rows: [...] }  (one Monday)
//
// POST /api/em-condors
//   upsert one:    { ticker, week_start, put_long, put_short, call_short, call_long, ... }
//   upsert many:   { rows: [ ... ] }
//   force result:  { id, result: 'win'|'loss' }
//   re-open:       { id, reopen: true }
//
// DELETE /api/em-condors?id=123
// DELETE /api/em-condors?all=1            (or ?week_start=YYYY-MM-DD)

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Owner-only. Automated callers (condor-mark-recorder, em-tracker-auto-eval)
    // pass on x-internal-token; see lib/auth/ownerApiGate.ts.
    const gate = await ownerOrInternal(req);
    if (!gate.ok) return gateDenied(gate);

    await getDb();
    const p = req.nextUrl.searchParams;
    const view = p.get("view");
    const ticker = (p.get("ticker") || "").trim().toUpperCase();
    const week_start = (p.get("week_start") || "").trim();

    if (view === "summary") {
      return NextResponse.json({ summary: await getEmCondorSummary() });
    }
    if (ticker || week_start) {
      return NextResponse.json({
        rows: await getEmCondors({
          ticker: ticker || undefined,
          week_start: week_start ? mondayOf(week_start) : undefined,
        }),
      });
    }
    const [summary, rows] = await Promise.all([getEmCondorSummary(), getEmCondors()]);
    return NextResponse.json({ summary, rows });
  } catch (err) {
    console.error("[/api/em-condors GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Owner-only. Automated callers (condor-mark-recorder, em-tracker-auto-eval)
    // pass on x-internal-token; see lib/auth/ownerApiGate.ts.
    const gate = await ownerOrInternal(req);
    if (!gate.ok) return gateDenied(gate);

    const body = await req.json();
    await getDb();

    // Re-open a settled condor so the evaluator can score it again.
    if (body.id != null && body.reopen) {
      await reopenEmCondor(Number(body.id));
      return NextResponse.json({ ok: true });
    }

    // Manual win/loss override. P&L is recomputed from the stored legs when a
    // settle price is supplied, otherwise only the verdict is stamped.
    if (body.id != null && (body.result === "win" || body.result === "loss")) {
      const rows = await getEmCondors();
      const row = rows.find((r) => r.id === Number(body.id));
      const px = body.settle_price != null ? Number(body.settle_price)
        : row?.wk_close != null ? Number(row.wk_close) : null;
      const s = row && px != null ? settle(row, px) : null;
      await setEmCondorSettlement(Number(body.id), {
        settle_price: px,
        intrinsic: s?.intrinsic ?? null,
        pnl: s?.pnl ?? null,
        result: body.result,
        outcome: s?.outcome ?? null,
        breached_side: s?.breached_side ?? null,
        source: "manual",
      });
      return NextResponse.json({ ok: true });
    }

    const incoming: EmCondorRow[] = Array.isArray(body.rows)
      ? body.rows
      : body.ticker
        ? [body as EmCondorRow]
        : [];
    if (!incoming.length) {
      return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
    }

    let saved = 0;
    const rejected: Array<{ ticker: string; week_start: string; reasons: string[] }> = [];
    for (const raw of incoming) {
      if (!raw.ticker || !raw.week_start) continue;
      const week_start = mondayOf(String(raw.week_start));
      const problems = validateLegs(raw);
      // A row with no strikes yet is a legal placeholder; a row with SOME strikes
      // that don't form a condor is a mistake and is refused rather than stored.
      const anyLeg = [raw.put_long, raw.put_short, raw.call_short, raw.call_long]
        .some((v) => v != null && Number.isFinite(Number(v)));
      if (anyLeg && problems.length) {
        rejected.push({ ticker: raw.ticker, week_start, reasons: problems });
        continue;
      }

      const row: EmCondorRow = {
        ...raw,
        ticker: String(raw.ticker).toUpperCase(),
        week_start,
        week_label: raw.week_label || weekLabel(week_start),
        contracts: raw.contracts != null ? Number(raw.contracts) : 1,
        multiplier: raw.multiplier != null ? Number(raw.multiplier) : 100,
        result_source: raw.result_source ?? "manual",
      };
      // Keep net_credit consistent with the two leg credits when both are given.
      if (row.net_credit == null && (row.put_credit != null || row.call_credit != null)) {
        row.net_credit = Number(row.put_credit ?? 0) + Number(row.call_credit ?? 0);
      }
      // Explicitly blank a credit the caller cleared (COALESCE would keep the old
      // value otherwise, silently re-introducing a deleted number).
      const clear = (["put_credit", "call_credit", "net_credit", "note"] as const)
        .filter((k) => k in raw && raw[k] == null);

      await upsertEmCondor(row, clear as string[]);
      saved++;
    }
    return NextResponse.json({ ok: true, saved, rejected });
  } catch (err) {
    console.error("[/api/em-condors POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    // Owner-only. Automated callers (condor-mark-recorder, em-tracker-auto-eval)
    // pass on x-internal-token; see lib/auth/ownerApiGate.ts.
    const gate = await ownerOrInternal(req);
    if (!gate.ok) return gateDenied(gate);

    await getDb();
    const p = req.nextUrl.searchParams;
    const all = p.get("all");
    const week_start = (p.get("week_start") || "").trim();

    if (all === "1" || week_start) {
      const removed = await clearEmCondors(week_start ? mondayOf(week_start) : undefined);
      return NextResponse.json({ ok: true, removed });
    }
    const id = Number(p.get("id"));
    if (!id) return NextResponse.json({ error: "Missing id (or pass ?all=1 / ?week_start=)" }, { status: 400 });
    await deleteEmCondor(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/em-condors DELETE]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
