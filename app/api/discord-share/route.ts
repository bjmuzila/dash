import { NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";

// Server-side owner gate (defense-in-depth — the UI buttons are cosmetic and can
// be bypassed by POSTing directly). Only the configured owner may push to the
// Discord webhook. If OWNER_USER_ID isn't set, fall back to any signed-in user
// so the owner can't lock themselves out; signed-out is always rejected.
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

export async function POST(request: Request) {
  try {
    const userId = await getServerUserId();
    const id = (userId || "").trim();
    const allowed = id !== "" && (OWNER_USER_ID ? id === OWNER_USER_ID : true);
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      console.error("[discord-share] DISCORD_WEBHOOK_URL is not configured");
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
    // Log server-side: the response body below is NOT reliably readable by the
    // client. Cloudflare intercepts a 502 from the origin and replaces the body
    // with its own branded "Bad gateway" page, so any error string returned here
    // is silently discarded before the browser sees it. The log is the only
    // channel that survives — never rely on the response body alone to debug.
    console.error("[discord-share] failed:", err);
    // 500, not 502: Cloudflare passes a 500 body through untouched but swallows
    // 502/504. Callers still see !res.ok either way.
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
