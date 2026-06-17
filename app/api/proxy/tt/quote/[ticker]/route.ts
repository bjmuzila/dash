import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "http://localhost:3001";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  try {
    const res = await fetch(
      `${PROXY}/proxy/api/tt/quote/${encodeURIComponent(ticker)}`,
      { cache: "no-store", signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return NextResponse.json({ error: "proxy error" }, { status: res.status });
    return NextResponse.json(await res.json());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
