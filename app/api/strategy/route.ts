import { NextRequest, NextResponse } from "next/server";
import { getDailyStrategy, getLatestDailyStrategy, upsertDailyStrategy } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/strategy — Claude-generated full daily trade strategy for the Analytics
 * strategy-builder card. Same storage discipline as /api/premarket-summary:
 *   GET  → latest cached row (read by the StrategyBuilder card; any user)
 *   POST → cron writer (strategy-generator.js), gated by INTERNAL_API_TOKEN
 * The page never calls Claude — the daily cron generates and writes the plan.
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
    const row = date ? await getDailyStrategy(date) : await getLatestDailyStrategy();
    if (!row) return NextResponse.json({ strategy: null });
    // plan is JSONB — already an object from pg, but coerce if it arrives as text.
    const plan = typeof row.plan === "string" ? JSON.parse(row.plan) : row.plan;
    return NextResponse.json({ strategy: { ...row, plan } });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!tokenOk(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await req.json();
    const date = String(body?.date || etDateStr());
    const plan = body?.plan;
    if (!plan || typeof plan !== "object") {
      return NextResponse.json({ error: "plan object required" }, { status: 400 });
    }
    await upsertDailyStrategy(date, plan);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Save failed", detail: String(err) }, { status: 500 });
  }
}
