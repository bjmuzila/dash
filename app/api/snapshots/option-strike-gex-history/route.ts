import { NextRequest, NextResponse } from "next/server";
import {
  getOptionStrikeRollingNetGex,
  getOptionStrikeNetGexAsOf,
  getOptionStrikeNetGexAtOpen,
  insertOptionStrikeGexRows,
} from "@/lib/db";

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

    const normalized = rows
      .map((row) => ({
        timestamp: Number(row.timestamp ?? Date.now()),
        date: String(row.date ?? todayET()),
        expiry: String(row.expiry ?? ""),
        spot: Number(row.spot ?? 0),
        strike: Number(row.strike ?? 0),
        net_gex: Number(row.net_gex ?? 0),
      }))
      .filter((row) => row.expiry && row.strike > 0 && Number.isFinite(row.net_gex));

    await insertOptionStrikeGexRows(normalized);

    return NextResponse.json({ ok: true, count: normalized.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") ?? todayET();
    const expiry = searchParams.get("expiry") ?? "";
    const mode = searchParams.get("mode") ?? "rolling";

    if (!expiry) {
      return NextResponse.json({ error: "expiry is required", rows: [] });
    }

    // mode=point → per-strike net GEX baselines at the open + each requested age
    // (minutes ago). The popup subtracts these from the live value to get the
    // rolling difference for the open/5m/15m/30m boxes.
    if (mode === "point") {
      const ages = (searchParams.get("ages") ?? "5,15,30")
        .split(",")
        .map((a) => Math.max(1, Math.min(240, Number(a.trim()))))
        .filter((a) => Number.isFinite(a));
      const now = Date.now();

      const [openRows, ...ageRowSets] = await Promise.all([
        getOptionStrikeNetGexAtOpen(date, expiry),
        ...ages.map((m) => getOptionStrikeNetGexAsOf(date, expiry, now - m * 60 * 1000)),
      ]);

      // baselines[strike] = { open, "5", "15", "30" } net GEX values.
      const baselines: Record<number, Record<string, number>> = {};
      const put = (strike: number, key: string, v: number) => {
        (baselines[strike] ??= {})[key] = v;
      };
      for (const r of openRows) put(r.strike, "open", r.net_gex);
      ages.forEach((m, i) => {
        for (const r of ageRowSets[i]) put(r.strike, String(m), r.net_gex);
      });

      return NextResponse.json({ mode: "point", ages, baselines });
    }

    const minutes = Math.max(1, Math.min(240, Number(searchParams.get("minutes") ?? 30)));
    const sinceTimestamp = Date.now() - minutes * 60 * 1000;
    const rows = await getOptionStrikeRollingNetGex(date, expiry, sinceTimestamp);
    return NextResponse.json({ rows, minutes });
  } catch (err) {
    return NextResponse.json({ error: String(err), rows: [] });
  }
}
