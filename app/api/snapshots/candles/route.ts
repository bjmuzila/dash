import { NextRequest, NextResponse } from "next/server";
import { upsertEsCandle, getEsCandles, upsertNqCandle, getNqCandles } from "@/lib/db";

/** "/NQ" (any NQ-ish symbol) selects the nq_candles table; everything else = ES. */
function isNq(sym?: string | null): boolean {
  return !!sym && /nq/i.test(sym);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Accept single candle or array
    const candles = Array.isArray(body) ? body : [body];
    for (const c of candles) {
      const upsert = isNq(c.symbol) ? upsertNqCandle : upsertEsCandle;
      await upsert({
        timestamp:       Number(c.timestamp),
        date:            String(c.date),
        slotKey:         String(c.slotKey),
        time:            String(c.time ?? ""),
        symbol:          String(c.symbol ?? "/ES"),
        intervalMinutes: Number(c.intervalMinutes ?? 5),
        source:          String(c.source ?? "dxlink"),
        open:            Number(c.open),
        high:            Number(c.high),
        low:             Number(c.low),
        close:           Number(c.close),
        volume:          Number(c.volume),
        avgVolume:       Number(c.avgVolume ?? 0),
      });
    }
    return NextResponse.json({ ok: true, count: candles.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date     = searchParams.get("date")     ?? undefined;
    const daysBack = searchParams.get("daysBack") ? Number(searchParams.get("daysBack")) : undefined;
    const limit    = Math.min(Number(searchParams.get("limit") ?? 2000), 10000);
    const rows     = isNq(searchParams.get("symbol"))
      ? await getNqCandles(date, daysBack, limit)
      : await getEsCandles(date, daysBack, limit);
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
