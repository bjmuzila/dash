import { NextRequest, NextResponse } from "next/server";
import { upsertIbLevels, getIbLevels } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET  /api/snapshots/ib?date=YYYY-MM-DD  → { row: IbLevelsRecord | null }
 * POST /api/snapshots/ib  body: IbLevelsRecord → { ok, locked }
 *
 * Upsert is a no-op once the row is locked (IB frozen post-10:30 ET), so a
 * later recompute can never overwrite the locked high/low/range.
 */
export async function GET(req: NextRequest) {
  try {
    const date = new URL(req.url).searchParams.get("date") ?? "";
    if (!date) return NextResponse.json({ row: null });
    const row = await getIbLevels(date);
    return NextResponse.json({ row });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b?.date) return NextResponse.json({ error: "date required" }, { status: 400 });
    await upsertIbLevels({
      date: String(b.date),
      symbol: String(b.symbol ?? "/ES"),
      timestamp: Number(b.timestamp ?? Date.now()),
      locked: Number(b.locked ?? 0),
      high: Number(b.high ?? 0),
      low: Number(b.low ?? 0),
      mid: Number(b.mid ?? 0),
      range: Number(b.range ?? 0),
      rangePct: Number(b.rangePct ?? 0),
      openPrice: Number(b.openPrice ?? 0),
      lowFirst: b.lowFirst == null ? null : Number(b.lowFirst),
      barCount: Number(b.barCount ?? 0),
    });
    // Return the authoritative stored row (may already be locked from earlier).
    const row = await getIbLevels(String(b.date));
    return NextResponse.json({ ok: true, locked: row?.locked ?? 0, row });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
