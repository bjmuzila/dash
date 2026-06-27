import { NextRequest, NextResponse } from "next/server";
import { getPremarketSummary, getLatestPremarketSummary, upsertPremarketSummary } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/premarket-summary — Claude-generated 5-bullet read of the global overnight
 * tape. Same storage discipline as /api/traders-dashboard/overview:
 *   GET  → latest cached row (read by the Analytics Premarket card; any user)
 *   POST → cron writer (premarket-summary-generator.js), gated by INTERNAL_API_TOKEN
 * The page never calls Claude — the daily cron generates and writes the bullets.
 */

function etDateStr(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d).filter((p) => p.type !== "literal")
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function tokenOk(req: NextRequest): boolean {
  const expected = process.env.INTERNAL_API_TOKEN;
  if (!expected) return true;
  return req.headers.get("x-internal-token") === expected;
}

export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get("date");
    const row = date ? await getPremarketSummary(date) : await getLatestPremarketSummary();
    if (!row) return NextResponse.json({ summary: null });
    return NextResponse.json({ summary: row });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!tokenOk(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await req.json();
    const date = String(body?.date || etDateStr());
    const bullets = Array.isArray(body?.bullets)
      ? body.bullets.filter((b: unknown): b is string => typeof b === "string").slice(0, 5)
      : [];
    if (!bullets.length) return NextResponse.json({ error: "bullets required" }, { status: 400 });
    await upsertPremarketSummary(date, bullets);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Save failed", detail: String(err) }, { status: 500 });
  }
}
