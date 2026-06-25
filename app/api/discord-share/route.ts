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

    // Accept either multipart form-data (file uploads) or a JSON { content } body.
    const ct = request.headers.get("content-type") || "";
    let body: BodyInit;
    const headers: Record<string, string> = {};
    if (ct.includes("application/json")) {
      const json = await request.json().catch(() => ({}));
      const content = typeof json?.content === "string" ? json.content : "";
      if (!content.trim()) {
        return NextResponse.json({ ok: false, error: "Empty content" }, { status: 400 });
      }
      body = JSON.stringify({ content: content.slice(0, 1990) });
      headers["content-type"] = "application/json";
    } else {
      body = await request.formData();
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body,
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
