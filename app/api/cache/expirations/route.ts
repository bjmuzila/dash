import { NextRequest, NextResponse } from "next/server";
import { getCachedExpirations, upsertExpirationCache } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get("ticker") ?? "SPX";
    const data = await getCachedExpirations(ticker);
    return NextResponse.json({ data, hit: data !== null });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ticker = body.ticker ?? "SPX";
    const expirations: string[] = Array.isArray(body.expirations) ? body.expirations : [];
    await upsertExpirationCache(ticker, expirations, body.raw ?? body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
