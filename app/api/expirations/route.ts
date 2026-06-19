import { NextRequest } from "next/server";
import { forwardGet } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/expirations?ticker=SPX
 * Forwards to /proxy/api/tt/expirations/:ticker, returning
 * { data: { items: [{ "expiration-date", "expiration-type", ... }] } }.
 */
export async function GET(req: NextRequest) {
  const ticker = (new URL(req.url).searchParams.get("ticker") || "SPX").trim();
  return forwardGet(`/proxy/api/tt/expirations/${encodeURIComponent(ticker)}`);
}
