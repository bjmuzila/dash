import { NextResponse } from "next/server";

const PROXY = "http://localhost:3001";

export async function GET() {
  try {
    const res = await fetch(`${PROXY}/proxy/api/tt/vix`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: "proxy error" }, { status: res.status });
    const json = await res.json();
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
