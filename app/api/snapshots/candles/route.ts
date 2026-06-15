import { NextRequest, NextResponse } from "next/server";
import { upsertEsCandle, getEsCandles } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Accept single candle or array
    const candles = Array.isArray(body) ? body : [body];
    for (const c of candles) {
      await upsertEsCandle({
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
    const rows     = await getEsCandles(date, daysBack, limit);
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
