import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { ok: false, error: "DISCORD_WEBHOOK_URL is not configured" },
        { status: 500 },
      );
    }

    const form = await request.formData();
    const res = await fetch(webhookUrl, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const detail = await res.text().then(t => t.slice(0, 500)).catch(() => "");
      throw new Error(`Discord webhook returned ${res.status}${detail ? `: ${detail}` : ""}`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
