import { NextRequest } from "next/server";
import { forwardGet } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/eod-strike-gex-change?symbol=NVDA
 *
 * Day-over-day per-strike ΔGEX for the whole board ex-0DTE, backing the Ticker
 * Lookup card's Δ 1D column. Forwards to /proxy/eod-strike-gex-change, which
 * FULL JOINs the two most recent end-of-day snapshots written by
 * server-v2/eod-strike-gex-recorder.js and returns
 * { ok, symbol, date, prevDate, spot, prevSpot,
 *   rows: [{ strike, netGex, prevNetGex, chg, hadPrev }] }.
 *
 * FALLBACK ONLY. The live path is register('/api/eod-strike-gex-change') in
 * server-v2/api-router.js; this file exists so the column still works when
 * API_ROUTER is not enabled, matching how every other /api/* adapter in this
 * directory is kept during the migration.
 *
 * NO CDN CACHE, deliberately — unlike /api/chains this is not a hot poll. It is
 * a once-a-day series read once an hour per ticker, and caching it at the edge
 * would pin a stale baseline date across the 16:05 ET write for the whole TTL,
 * on the one day of the week the column is most interesting. forwardGet already
 * emits no-store; this route passes that straight through.
 */
export async function GET(req: NextRequest) {
  const symbol = (new URL(req.url).searchParams.get("symbol") || "").trim().toUpperCase();
  const qs = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  return forwardGet(`/proxy/eod-strike-gex-change${qs}`);
}
