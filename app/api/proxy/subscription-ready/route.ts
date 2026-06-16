import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? (process.env.RENDER ? "https://vanila-8zn1.onrender.com" : "http://localhost:3001");

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${PROXY}/proxy/api/subscription-ready`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({ ready: true }));
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    // Non-fatal — chain page continues regardless
    return NextResponse.json({ ready: true, error: String(e) });
  }
}
