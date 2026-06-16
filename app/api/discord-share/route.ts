import { NextResponse } from "next/server";

// Forwards a multipart Discord webhook post through the local proxy,
// using the proxy's .env-backed Discord relay.
const PROXY_WEBHOOK_URL =
  `${process.env.PROXY_URL ?? "https://vanila-8zn1.onrender.com"}/proxy/api/discord-webhook`;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const res = await fetch(PROXY_WEBHOOK_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Webhook proxy returned ${res.status}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
