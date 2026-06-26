import { NextRequest, NextResponse } from "next/server";
import { getTdOverview, getLatestTdOverview, upsertTdOverview } from "@/lib/db";

// Shared daily overnight-market overview.
//   GET  → latest cached overview (read by the page; any signed-in user)
//   POST → cron writer (overview-generator.js), gated by the internal token
//          (same pattern as /api/es-gap; middleware lets the token through).

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
    const row = date ? await getTdOverview(date) : await getLatestTdOverview();
    if (!row) return NextResponse.json({ overview: null });
    return NextResponse.json({ overview: row });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!tokenOk(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await req.json();
    const date = String(body?.date || etDateStr());
    const summary = String(body?.summary || "").trim();
    const drivers = Array.isArray(body?.drivers) ? body.drivers : [];
    if (!summary) return NextResponse.json({ error: "summary required" }, { status: 400 });
    await upsertTdOverview(date, summary, drivers);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Save failed", detail: String(err) }, { status: 500 });
  }
}
