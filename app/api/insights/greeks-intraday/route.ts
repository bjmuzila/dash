import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "http://localhost:3001";

function normalizeIntradayPayload(json: any) {
  const records = Array.isArray(json?.records) ? json.records : Array.isArray(json?.data?.records) ? json.data.records : [];
  return {
    ok: json?.ok ?? true,
    records,
    data: { records },
    error: json?.error ?? null,
  };
}

export async function GET() {
  try {
    const r = await fetch(`${PROXY}/proxy/api/greeks-intraday`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) throw new Error(`Proxy ${r.status}`);
    const data = await r.json();
    return NextResponse.json(normalizeIntradayPayload(data));
  } catch (err) {
    return NextResponse.json(normalizeIntradayPayload({ ok: false, records: [], error: String(err) }));
  }
}
