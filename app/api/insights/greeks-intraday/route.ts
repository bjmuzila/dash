import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "https://vanila-8zn1.onrender.com";

export async function GET() {
  try {
    const r = await fetch(`${PROXY}/proxy/api/greeks-intraday`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) throw new Error(`Proxy ${r.status}`);
    const data = await r.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ ok: false, records: [], error: String(err) });
  }
}
