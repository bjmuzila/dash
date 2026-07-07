import { NextRequest, NextResponse } from "next/server";
import { forwardGet } from "@/lib/proxyForward";
import { cacheHeaders, CACHE_TTL } from "@/lib/cacheHeaders";

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

  // Add cache headers for Cloudflare
  const headers = new Headers(res.headers);
  Object.entries(cacheHeaders(CACHE_TTL.quotes)).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return new NextResponse(res.body, { ...res, headers });
}
