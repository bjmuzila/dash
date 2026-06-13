import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "https://vanila-8zn1.onrender.com";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker     = searchParams.get("ticker") ?? "SPX";
  const expiration = searchParams.get("expiration") ?? "";
  const range      = searchParams.get("range") ?? "all";
  const pageId     = searchParams.get("pageId") ?? "";

  const url = `${PROXY}/proxy/api/tt/chains/${encodeURIComponent(ticker)}?expiration=${encodeURIComponent(expiration)}&range=${range}&pageId=${encodeURIComponent(pageId)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: "proxy error" }, { status: res.status });
    const json = await res.json();
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
