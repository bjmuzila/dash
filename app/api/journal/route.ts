import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/supabase/server";
import {
  getTradingJournals,
  insertTradingJournal,
  updateTradingJournal,
  deleteTradingJournal,
  type TradingJournalInput,
} from "@/lib/db";

// Trading journal (/trading). Replaces the old localStorage key
// "trading_journals" — entries now live in Postgres, scoped to the signed-in
// user. The user_id ALWAYS comes from the session, never the request body.
//
//   GET                                   → { rows }
//   POST   { ...entry }                   → create   → { row }
//   PATCH  { id, ...entry }               → edit     → { row }
//   DELETE ?id=<id>                       → remove   → { ok }

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Shape + clamp a client body into a storable row. Rejects a missing date. */
function parseBody(body: Record<string, unknown>): TradingJournalInput | null {
  const date = String(body.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const winRate = Math.min(100, Math.max(0, num(body.winRate ?? body.win_rate)));
  return {
    date,
    net_pnl: num(body.netPnl ?? body.net_pnl),
    trades: Math.max(0, num(body.trades)),
    win_rate: winRate,
    avg_win: num(body.avgWin ?? body.avg_win),
    avg_loss: num(body.avgLoss ?? body.avg_loss),
    profit_factor: num(body.profitFactor ?? body.profit_factor),
    avg_mae: num(body.avgMAE ?? body.avg_mae),
    avg_mfe: num(body.avgMFE ?? body.avg_mfe),
    commissions: num(body.commissions),
    notes: body.notes ? String(body.notes).slice(0, 4000) : null,
    kind: String(body.kind ?? "manual") === "verified" ? "verified" : "manual",
  };
}

export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ rows: [] }, { status: 401 });
  try {
    const rows = await getTradingJournals(session.userId);
    return NextResponse.json({ rows });
  } catch (err) {
    console.error("[/api/journal GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const entry = parseBody(body);
    if (!entry) return NextResponse.json({ error: "valid date (YYYY-MM-DD) required" }, { status: 400 });
    const row = await insertTradingJournal(session.userId, entry);
    return NextResponse.json({ ok: true, row });
  } catch (err) {
    console.error("[/api/journal POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const id = Number(body.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
    const entry = parseBody(body);
    if (!entry) return NextResponse.json({ error: "valid date (YYYY-MM-DD) required" }, { status: 400 });
    const row = await updateTradingJournal(session.userId, id, entry);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, row });
  } catch (err) {
    console.error("[/api/journal PATCH]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
    await deleteTradingJournal(session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/journal DELETE]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
