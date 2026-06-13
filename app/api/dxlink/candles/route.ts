import { NextRequest, NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "https://vanila-8zn1.onrender.com";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.search || "";
  try {
    const res = await fetch(`${PROXY}/proxy/api/dxlink/candles${search}`, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    try {
      return NextResponse.json(JSON.parse(text), { status: res.status });
    } catch {
      return NextResponse.json(
        { error: "Invalid upstream JSON", detail: text.slice(0, 500) },
        { status: 502 }
      );
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
