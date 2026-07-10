import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/social-media/day-list — the auto-generated copy/paste list for the Day
 * Posts tab. Rows are written by server-v2/day-post-writer.js at each slot's
 * time (premarket / midday / eod ET). GET ?date=YYYY-MM-DD (default: today ET).
 */

function todayET(): string {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const m: Record<string, string> = {};
  p.forEach((x) => { m[x.type] = x.value; });
  return `${m.year}-${m.month}-${m.day}`;
}

async function ensureTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS day_posts (
      date       TEXT NOT NULL,
      slot       TEXT NOT NULL,
      tweet      TEXT NOT NULL,
      data       JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (date, slot)
    )`);
}

export async function GET(req: NextRequest) {
  try {
    await ensureTable();
    const date = req.nextUrl.searchParams.get("date") || todayET();
    const { rows } = await getPool().query(
      `SELECT date, slot, tweet, created_at FROM day_posts WHERE date=$1
       ORDER BY CASE slot WHEN 'premarket' THEN 0 WHEN 'midday' THEN 1 WHEN 'eod' THEN 2 ELSE 3 END`,
      [date]
    );
    return NextResponse.json(
      { date, rows },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
    );
  } catch (err) {
    console.error("[/api/social-media/day-list]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
