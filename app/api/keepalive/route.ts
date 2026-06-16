import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "https://vanila-8zn1.onrender.com";

export async function GET() {
  const start = Date.now();
  try {
    const res = await fetch(`${PROXY}/proxy/api/health`, { // lightweight ping — no auth needed
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const ms = Date.now() - start;
    return NextResponse.json({ ok: res.ok, status: res.status, ms });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), ms: Date.now() - start }, { status: 500 });
  }
}
