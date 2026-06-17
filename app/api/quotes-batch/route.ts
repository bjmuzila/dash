import { NextRequest, NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "http://localhost:3001";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbols = searchParams.get("symbols") || "";
  const qs = symbols ? `?symbols=${encodeURIComponent(symbols)}` : "";
  try {
    const res = await fetch(`${PROXY}/proxy/api/tt/quotes-batch${qs}`, {
      headers: { "Cache-Control": "no-cache" },
    });
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
