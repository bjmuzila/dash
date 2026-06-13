import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "https://dash-1-vq07.onrender.com";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker") ?? "SPX";
  try {
    const res = await fetch(`${PROXY}/proxy/api/tt/expirations/${encodeURIComponent(ticker)}`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: "proxy error" }, { status: res.status });
    const json = await res.json();
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
