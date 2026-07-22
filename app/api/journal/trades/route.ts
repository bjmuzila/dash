import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/supabase/server";
import { getTradingFills } from "@/lib/db";
import { matchRoundTrips, deriveAccountStats, type Fill } from "@/lib/journal/csv";

// Trade-level view of the journal (/trading), derived live from the persisted
// fills — nothing new is stored here. trading_fills already keeps every
// execution (symbol, time, price, account); this just re-runs the same FIFO
// matching the importer uses so the UI can show per-trade rows (time in/out,
// price in/out, long/short) and a per-account rollup ("today was a different
// account than the last 5 sessions").
//
//   GET → { trades, accounts }

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ trades: [], accounts: [] }, { status: 401 });
  try {
    const fills = await getTradingFills(session.userId);
    const trades = matchRoundTrips(fills as unknown as Fill[]);
    const accounts = deriveAccountStats(trades);
    return NextResponse.json({ trades, accounts });
  } catch (err) {
    console.error("[/api/journal/trades GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
