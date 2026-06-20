import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { proxyBase } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/em-zones?ticker=AAPL
 *
 * On-demand Buy/Sell zones for any ticker. Zones derive from LAST WEEK's weekly
 * OHLC, so they're static for the whole week — the weekly publisher only
 * pre-computes the core names; everything else is computed here on first lookup
 * and CACHED into ticker_levels (NULL-aware upsert, so it never clobbers EM).
 *
 * Returns the zone fields { ticker, pivot, buy_near, buy_far, sell_near, sell_far }.
 */
export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get("ticker") || "").trim().toUpperCase();
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  // Compute zones via the server-v2 engine adapter.
  let zone: {
    ticker?: string; label?: string; pivot?: string | null;
    buy_near?: string | null; buy_far?: string | null;
    sell_near?: string | null; sell_far?: string | null;
  } | null = null;
  try {
    const url = `${proxyBase()}/proxy/api/tt/em-zones?ticker=${encodeURIComponent(ticker)}`;
    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.data) {
      return NextResponse.json({ error: json?.error || "zone compute failed" }, { status: 502 });
    }
    zone = json.data;
  } catch (err) {
    return NextResponse.json({ error: String((err as Error)?.message || err) }, { status: 502 });
  }

  // Cache to ticker_levels (NULL-aware upsert — leaves em/up/down untouched).
  try {
    const pool = await getDb();
    const t = (zone!.ticker || ticker).toUpperCase();
    await pool.query(
      `INSERT INTO ticker_levels (ticker, label, pivot, buy_near, buy_far, sell_near, sell_far)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(ticker) DO UPDATE SET
         label     = CASE WHEN EXCLUDED.label     IS NOT NULL THEN EXCLUDED.label     ELSE ticker_levels.label     END,
         pivot     = CASE WHEN EXCLUDED.pivot     IS NOT NULL THEN EXCLUDED.pivot     ELSE ticker_levels.pivot     END,
         buy_near  = CASE WHEN EXCLUDED.buy_near  IS NOT NULL THEN EXCLUDED.buy_near  ELSE ticker_levels.buy_near  END,
         buy_far   = CASE WHEN EXCLUDED.buy_far   IS NOT NULL THEN EXCLUDED.buy_far   ELSE ticker_levels.buy_far   END,
         sell_near = CASE WHEN EXCLUDED.sell_near IS NOT NULL THEN EXCLUDED.sell_near ELSE ticker_levels.sell_near END,
         sell_far  = CASE WHEN EXCLUDED.sell_far  IS NOT NULL THEN EXCLUDED.sell_far  ELSE ticker_levels.sell_far  END,
         updated_at = CURRENT_TIMESTAMP`,
      [
        t, zone!.label ?? t,
        zone!.pivot ?? null, zone!.buy_near ?? null, zone!.buy_far ?? null,
        zone!.sell_near ?? null, zone!.sell_far ?? null,
      ]
    );
  } catch (err) {
    // Caching is best-effort — still return the computed zones.
    console.error("[/api/em-zones cache]", err);
  }

  return NextResponse.json(zone);
}
