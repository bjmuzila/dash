import { NextRequest, NextResponse } from "next/server";
import { ownerOrInternal, gateDenied } from "@/lib/auth/ownerApiGate";
import { getDb, getEmCondorsUnsettled, setEmCondorSettlement } from "@/lib/db";
import { settle, touchedShort, mondayOf } from "@/lib/em-condor/compute";

// Settle weekly condors against the realized weekly close.
//
// POST /api/em-condors/evaluate
//   {}                          -> settle every unsettled condor that has a close
//   { week_start: "2026-07-20" }-> just that week
//
// The close comes from the em_tracker row for the same (ticker, week) — the EM
// evaluator already fetches and stores the realized weekly candle each Saturday,
// so this route adds no new market-data dependency. Run it AFTER
// /api/em-tracker/evaluate.
//
// A condor with no credit recorded still settles: P&L is then just the negative
// intrinsic, and the win/loss verdict comes out of the strikes alone.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Owner-only. Automated callers (condor-mark-recorder, em-tracker-auto-eval)
    // pass on x-internal-token; see lib/auth/ownerApiGate.ts.
    const gate = await ownerOrInternal(req);
    if (!gate.ok) return gateDenied(gate);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* no body */ }
    await getDb();

    const week_start = body.week_start ? mondayOf(String(body.week_start)) : undefined;
    const pending = await getEmCondorsUnsettled(week_start);

    let wins = 0, losses = 0, maxWins = 0, maxLosses = 0, pnl = 0, skipped = 0;
    const noCredit: string[] = [];

    for (const c of pending) {
      const close = c.wk_close != null ? Number(c.wk_close) : null;
      if (close == null || !Number.isFinite(close)) { skipped++; continue; }

      const s = settle(c, close);
      if (!s) { skipped++; continue; }

      const t = touchedShort(c, c.wk_high, c.wk_low);
      if (c.net_credit == null && c.put_credit == null && c.call_credit == null) {
        noCredit.push(`${c.ticker} ${c.week_label}`);
      }

      await setEmCondorSettlement(c.id!, {
        settle_price: close,
        intrinsic: s.intrinsic,
        pnl: s.pnl,
        result: s.result,
        outcome: s.outcome,
        breached_side: s.breached_side,
        touched_side: t.side,
        source: "auto",
      });

      if (s.result === "win") wins++; else losses++;
      if (s.outcome === "max_win") maxWins++;
      if (s.outcome === "max_loss") maxLosses++;
      pnl += s.pnl;
    }

    return NextResponse.json({
      ok: true,
      week_start: week_start ?? "all",
      settled: wins + losses,
      wins,
      losses,
      max_wins: maxWins,
      max_losses: maxLosses,
      pnl: Math.round(pnl * 100) / 100,
      skipped,
      // Surfaced rather than swallowed: these rows scored, but their P&L is
      // understated because no credit was ever entered.
      missing_credit: noCredit,
    });
  } catch (err) {
    console.error("[/api/em-condors/evaluate POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
