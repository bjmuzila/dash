import { NextRequest } from "next/server";
import { forwardGet } from "@/lib/proxyForward";

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
  return forwardGet(`/proxy/quotes?symbols=${encodeURIComponent(symbols)}`);
}
