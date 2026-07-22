import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/supabase/server";
import { getTradingFills, getTradeOverrides, upsertTradeOverride, type TradeOverride } from "@/lib/db";
import { matchRoundTrips, deriveAccountStats, classify, sessionDate, type Fill, type Trade } from "@/lib/journal/csv";

// Trade-level view of the journal (/trading), derived live from the persisted
// fills — nothing new is stored here except EDITS. trading_fills already
// keeps every execution (symbol, time, price, account); GET re-runs the same
// FIFO matching the importer uses so the UI can show per-trade rows (time
// in/out, price in/out, long/short) and a per-account rollup, then layers any
// saved edits on top (see trading_trade_overrides in lib/db.ts for why edits
// are a shadow row keyed to the trade's two fills, not a mutation of them).
//
//   GET                                            → { trades, accounts }
//   PATCH { openExtId, closeExtId, ...tradeFields } → edit one trade → { ok, trade }
//   DELETE ?openExtId=&closeExtId=                  → hide one trade → { ok }

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function overrideKey(openExtId: string, closeExtId: string) {
  return `${openExtId}|${closeExtId}`;
}

/** FIFO-derive trades, then swap in any saved edit / drop any saved delete. */
async function loadTrades(userId: string): Promise<Trade[]> {
  const fills = await getTradingFills(userId);
  const derived = matchRoundTrips(fills as unknown as Fill[]);
  const overrides = await getTradeOverrides(userId);
  if (!overrides.size) return derived;

  const out: Trade[] = [];
  for (const t of derived) {
    const o = overrides.get(overrideKey(t.open_ext_id, t.close_ext_id));
    if (!o) { out.push(t); continue; }
    if (o.deleted) continue;
    out.push({
      symbol: o.symbol, underlying: o.underlying, asset_type: o.asset_type as Trade["asset_type"],
      direction: o.direction as Trade["direction"], open_ts: o.open_ts, close_ts: o.close_ts,
      date: o.date, qty: o.qty, entry: o.entry, exit: o.exit, fees: o.fees, pnl: o.pnl,
      account: o.account, open_ext_id: t.open_ext_id, close_ext_id: t.close_ext_id,
    });
  }
  return out.sort((a, b) => a.close_ts - b.close_ts);
}

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ trades: [], accounts: [] }, { status: 401 });
    const trades = await loadTrades(session.userId);
    const accounts = deriveAccountStats(trades);
    return NextResponse.json({ trades, accounts });
  } catch (err) {
    console.error("[/api/journal/trades GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const openExtId = String(body.openExtId ?? "").trim();
    const closeExtId = String(body.closeExtId ?? "").trim();
    if (!openExtId || !closeExtId) {
      return NextResponse.json({ error: "openExtId and closeExtId are required" }, { status: 400 });
    }

    // The pair must belong to a trade THIS user's fills actually produced —
    // otherwise a guessed/foreign ext_id pair could plant an override with no
    // real trade behind it.
    const trades = await loadTrades(session.userId);
    const match = trades.find((t) => t.open_ext_id === openExtId && t.close_ext_id === closeExtId);
    if (!match) return NextResponse.json({ error: "trade not found" }, { status: 404 });

    const symbol = String(body.symbol ?? match.symbol).trim().toUpperCase() || match.symbol;
    const account = String(body.account ?? match.account ?? "").trim();
    const direction = body.direction === "short" ? "short" : body.direction === "long" ? "long" : match.direction;
    const openTs = Number.isFinite(Number(body.openTs)) ? Number(body.openTs) : match.open_ts;
    const closeTs = Number.isFinite(Number(body.closeTs)) ? Number(body.closeTs) : match.close_ts;
    const qty = Number.isFinite(Number(body.qty)) && Number(body.qty) > 0 ? Number(body.qty) : match.qty;
    const entry = Number.isFinite(Number(body.entry)) ? Number(body.entry) : match.entry;
    const exit = Number.isFinite(Number(body.exit)) ? Number(body.exit) : match.exit;
    const fees = Number.isFinite(Number(body.fees)) ? Number(body.fees) : match.fees;

    // classify() is a pure function of the symbol string, so re-deriving the
    // underlying/asset_type/multiplier here is always consistent with import
    // — no need to special-case "symbol didn't change".
    const cls = classify(symbol);
    const gross = (direction === "long" ? exit - entry : entry - exit) * qty * cls.multiplier;
    const pnl = gross - fees;

    const override: TradeOverride = {
      open_ext_id: openExtId, close_ext_id: closeExtId,
      symbol, underlying: cls.underlying, asset_type: cls.asset_type, direction,
      open_ts: openTs, close_ts: closeTs, date: sessionDate(closeTs),
      qty, entry, exit, fees, pnl, account, deleted: false,
    };
    await upsertTradeOverride(session.userId, override);

    return NextResponse.json({
      ok: true,
      trade: { ...override, open_ext_id: openExtId, close_ext_id: closeExtId } as Trade,
    });
  } catch (err) {
    console.error("[/api/journal/trades PATCH]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const openExtId = String(req.nextUrl.searchParams.get("openExtId") ?? "").trim();
    const closeExtId = String(req.nextUrl.searchParams.get("closeExtId") ?? "").trim();
    if (!openExtId || !closeExtId) {
      return NextResponse.json({ error: "openExtId and closeExtId are required" }, { status: 400 });
    }
    const trades = await loadTrades(session.userId);
    const match = trades.find((t) => t.open_ext_id === openExtId && t.close_ext_id === closeExtId);
    if (!match) return NextResponse.json({ error: "trade not found" }, { status: 404 });

    await upsertTradeOverride(session.userId, {
      open_ext_id: openExtId, close_ext_id: closeExtId,
      symbol: match.symbol, underlying: match.underlying, asset_type: match.asset_type,
      direction: match.direction, open_ts: match.open_ts, close_ts: match.close_ts, date: match.date,
      qty: match.qty, entry: match.entry, exit: match.exit, fees: match.fees, pnl: match.pnl,
      account: match.account, deleted: true,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/journal/trades DELETE]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
