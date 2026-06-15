import { NextRequest, NextResponse } from "next/server";
import { getBzilaStrikeGexHistory, insertBzilaStrikeGexRows } from "@/lib/db";

function todayET(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now)
    .filter((part) => part.type !== "literal")
    .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {} as Record<string, string>);

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rows: Record<string, unknown>[] = Array.isArray(body)
      ? body
      : Array.isArray(body?.rows)
        ? body.rows
        : [body];

    await insertBzilaStrikeGexRows(
      rows.map((row) => ({
        timestamp: Number(row.timestamp),
        date: String(row.date ?? todayET()),
        expiry: String(row.expiry ?? ""),
        spot: Number(row.spot ?? 0),
        strike: Number(row.strike ?? 0),
        bucket: row.bucket === "below" ? "below" : "above",
        rank_index: Number(row.rank_index ?? 0),
        call_gex: Number(row.call_gex ?? 0),
        put_gex: Number(row.put_gex ?? 0),
        net_gex: Number(row.net_gex ?? 0),
        net_gex_change: Number(row.net_gex_change ?? 0),
      }))
    );

    return NextResponse.json({ ok: true, count: rows.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") ?? todayET();
    const limit = Math.min(Number(searchParams.get("limit") ?? 5000), 10000);
    const rows = await getBzilaStrikeGexHistory(date, limit);
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
