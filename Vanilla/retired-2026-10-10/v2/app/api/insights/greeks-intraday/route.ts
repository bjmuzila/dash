import { NextResponse } from "next/server";
import { pgQuery } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/insights/greeks-intraday — today's persisted net-greeks time series from
 * `greeks_ts` (written 24/7 by server-v2/greeks-ts-writer.js, the same table
 * server-v2/greeks-cross-alerts.js reads to fire cross alerts). The Greeks page
 * seeds its in-memory `history` from this on mount so the Zero-Line Crossings
 * panel reflects today's flips even before the live WS has produced any points
 * this session (previously this route was a 501 stub and the page's `history`
 * only ever grew from the live feed — restarting empty on every reload).
 */
export async function GET() {
  try {
    const etDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date()); // YYYY-MM-DD

    const rows = await pgQuery(
      `SELECT timestamp, price, "gexRaw","dexRaw","chexRaw","vexRaw", gex, dex, chex, vex
         FROM greeks_ts
        WHERE date = $1
        ORDER BY timestamp ASC
        LIMIT 3000`,
      [etDate],
    );

    const data = (rows?.rows ?? rows ?? []).map((r: any) => ({
      ts: Number(r.timestamp),
      spot: r.price != null ? Number(r.price) : null,
      gex: Number(r.gex ?? r.gexRaw ?? 0),
      dex: Number(r.dex ?? r.dexRaw ?? 0),
      chex: Number(r.chex ?? r.chexRaw ?? 0),
      vex: Number(r.vex ?? r.vexRaw ?? 0),
    }));

    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } },
    );
  } catch (err) {
    return NextResponse.json({ error: String((err as Error)?.message || err), data: [] }, { status: 502 });
  }
}

export async function POST() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
