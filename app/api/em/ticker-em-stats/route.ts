import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db";

export const dynamic = "force-dynamic";

interface TrackerRow {
  em: number;
  week_start: string | null;
}

/**
 * GET /api/em/ticker-em-stats?ticker=SPX
 *
 * Returns per-ticker EM averages from em_tracker:
 *   recentAvg  = avg of last 4 weeks with a real em value
 *   midAvg     = avg of last 12 weeks with a real em value
 */
export async function GET(req: NextRequest) {
  try {
    const ticker = (req.nextUrl.searchParams.get("ticker") || "").trim().toUpperCase();
    if (!ticker) {
      return NextResponse.json({ error: "ticker required" }, { status: 400 });
    }

    const rows = await queryAll<TrackerRow>(
      `SELECT em, week_start FROM em_tracker
       WHERE ticker = $1 AND em IS NOT NULL AND em > 0
       ORDER BY week_start DESC NULLS LAST
       LIMIT 12`,
      [ticker]
    );

    if (!rows.length) {
      return NextResponse.json({ ticker, recentAvg: null, midAvg: null, sampleSize: 0 });
    }

    const ems = rows.map((r) => Number(r.em)).filter((n) => Number.isFinite(n) && n > 0);
    const recentSlice = ems.slice(0, 4);
    const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

    return NextResponse.json({
      ticker,
      recentAvg: recentSlice.length ? avg(recentSlice) : null,
      midAvg: ems.length ? avg(ems) : null,
      sampleSize: ems.length,
    });
  } catch (err) {
    console.error("[/api/em/ticker-em-stats]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
