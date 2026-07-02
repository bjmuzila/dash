import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

function todayET(): string {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
    .toISOString()
    .slice(0, 10);
}

/** Monday date (YYYY-MM-DD) of the ISO week containing `ds`. */
function mondayOf(ds: string): string {
  const d = new Date(`${ds}T12:00:00Z`);
  const dow = d.getUTCDay();                 // 0 Sun … 6 Sat
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

type Row = { high: number; low: number; key: string };

/**
 * Cached PDH/PDL (kind='day') + PWH/PWL (kind='week') for a symbol, written by
 * server-v2/ref-levels-recorder.js (EOD + Sunday). Serves the most recent day
 * before today and the most recent completed week before this one.
 */
export async function GET(req: NextRequest) {
  try {
    const symbol = (new URL(req.url).searchParams.get("symbol") || "ES").toUpperCase();
    const today = todayET();
    const thisMon = mondayOf(today);

    const day = await queryOne<Row>(
      `SELECT high, low, key FROM ref_levels
       WHERE symbol = ? AND kind = 'day' AND key < ?
       ORDER BY key DESC LIMIT 1`,
      [symbol, today]
    );
    const week = await queryOne<Row>(
      `SELECT high, low, key FROM ref_levels
       WHERE symbol = ? AND kind = 'week' AND key < ?
       ORDER BY key DESC LIMIT 1`,
      [symbol, thisMon]
    );

    return NextResponse.json({
      symbol,
      pdh: day?.high ?? null,
      pdl: day?.low ?? null,
      pdDate: day?.key ?? null,
      pwh: week?.high ?? null,
      pwl: week?.low ?? null,
      pwWeek: week?.key ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
