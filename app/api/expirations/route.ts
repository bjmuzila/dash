import { NextRequest } from "next/server";
import { forwardGet, withCacheHeaders } from "@/lib/proxyForward";
import { CACHE_TTL } from "@/lib/cacheHeaders";

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

  // Cache headers for Cloudflare — withCacheHeaders preserves the upstream
  // status and drops to no-store on a non-2xx (see lib/proxyForward.ts).
  return withCacheHeaders(res, CACHE_TTL.chains);
}
