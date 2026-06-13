import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "https://dash-1-vq07.onrender.com";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${PROXY}/proxy/dxlink/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
