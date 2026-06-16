"use server";

import { NextRequest, NextResponse } from "next/server";
import { getOptionStrikeRollingNetGex, insertOptionStrikeGexRows } from "@/lib/db";

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

    await insertOptionStrikeGexRows(
      rows.map((row) => ({
        timestamp: Number(row.timestamp),
        date: String(row.date ?? todayET()),
        expiry: String(row.expiry ?? ""),
        spot: Number(row.spot ?? 0),
        strike: Number(row.strike ?? 0),
        net_gex: Number(row.net_gex ?? 0),
      })).filter((row) => row.expiry && row.strike > 0 && Number.isFinite(row.net_gex))
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
    const expiry = searchParams.get("expiry") ?? "";
    const minutes = Math.max(1, Math.min(240, Number(searchParams.get("minutes") ?? 30)));

    if (!expiry) {
      return NextResponse.json({ error: "expiry is required" }, { status: 400 });
    }

    const sinceTimestamp = Date.now() - minutes * 60 * 1000;
    const rows = await getOptionStrikeRollingNetGex(date, expiry, sinceTimestamp);
    return NextResponse.json({ rows, minutes });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
