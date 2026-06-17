import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("http://127.0.0.1:3001/health", {
      signal: AbortSignal.timeout(3000),
    });
    // Proxy is up if we get any response (even 404 is ok, means server is alive)
    return NextResponse.json({ ok: res.status < 500 }, { status: 200 });
  } catch {
    // Proxy not reachable
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
