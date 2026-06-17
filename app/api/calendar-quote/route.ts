import { NextResponse } from "next/server";

export const revalidate = 3600; // cache 1hr

export async function GET() {
  const proxyBase = process.env.PROXY_URL ?? "http://127.0.0.1:3001";
  try {
    const res = await fetch(`${proxyBase}/proxy/api/quote-of-day`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Upstream ${res.status}` }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
