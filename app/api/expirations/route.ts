import { NextRequest, NextResponse } from "next/server";
import { forwardGet } from "@/lib/proxyForward";
import { cacheHeaders, CACHE_TTL } from "@/lib/cacheHeaders";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/expirations?ticker=SPX
 * Forwards to /proxy/api/tt/expirations/:ticker, returning
 * { data: { items: [{ "expiration-date", "expiration-type", ... }] } }.
 */
export async function GET(req: NextRequest) {
  const ticker = (new URL(req.url).searchParams.get("ticker") || "SPX").trim();
  const res = await forwardGet(`/proxy/api/tt/expirations/${encodeURIComponent(ticker)}`);

  // Add cache headers for Cloudflare
  const headers = new Headers(res.headers);
  Object.entries(cacheHeaders(CACHE_TTL.chains)).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return new NextResponse(res.body, { ...res, headers });
}
