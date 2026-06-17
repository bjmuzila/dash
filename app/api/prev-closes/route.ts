import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "http://localhost:3001";

export async function GET() {
  try {
    const res = await fetch(`${PROXY}/proxy/api/tt/prev-closes`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return NextResponse.json({}, { status: res.status });
    return NextResponse.json(await res.json());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
