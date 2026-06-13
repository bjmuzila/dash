import { NextRequest, NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "https://vanila-8zn1.onrender.com";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.search || "";
  try {
    const res = await fetch(`${PROXY}/proxy/api/dxlink/candles${search}`, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.arrayBuffer();
    const headers = new Headers();
    res.headers.forEach((value, key) => {
      if (!["transfer-encoding", "connection"].includes(key)) headers.set(key, value);
    });
    headers.set("Access-Control-Allow-Origin", "*");
    return new NextResponse(body, { status: res.status, headers });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
