import { NextRequest } from "next/server";
import { forwardGet, withCacheHeaders } from "@/lib/proxyForward";
import { CACHE_TTL } from "@/lib/cacheHeaders";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/tt-quotes?symbols=AAPL,SPX,/NQU26
 * Forwards to the broker proxy's /proxy/quotes — live underlying quotes that
 * update during extended hours (mark/last) plus today's regular close + prior
 * close, so the watchlist can show after-hours prices and the correct baseline.
 * Shape: { data: { items: [{ symbol, last, mark, close, prevClose }] } }
 */
export async function GET(req: NextRequest) {
  const symbols = (new URL(req.url).searchParams.get("symbols") || "").trim();
  const res = await forwardGet(`/proxy/quotes?symbols=${encodeURIComponent(symbols)}`);

  // Cache headers for Cloudflare — withCacheHeaders preserves the upstream
  // status and drops to no-store on a non-2xx (see lib/proxyForward.ts).
  return withCacheHeaders(res, CACHE_TTL.quotes);
}
