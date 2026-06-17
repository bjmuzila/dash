import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "http://localhost:3001";

export async function GET() {
  try {
    const res = await fetch(`${PROXY}/proxy/api/tt/vix`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ data: null, ok: false, error: "proxy error" });
    const json = await res.json();
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ data: null, ok: false, error: String(e) });
  }
}
