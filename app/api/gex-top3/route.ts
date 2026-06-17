import { NextResponse } from "next/server";

const PROXY_URL = `${process.env.PROXY_URL ?? "http://localhost:3001"}/proxy/api/tt/gex-top-3`;

export async function GET() {
  try {
    const res = await fetch(PROXY_URL, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: String(err), rows: [] },
      { status: 502 }
    );
  }
}
