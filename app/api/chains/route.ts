import { NextRequest } from "next/server";
import { forwardGet } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/chains?ticker=SPX&expiration=YYYY-MM-DD&range=all
 * Forwards to the internal proxy /proxy/api/tt/chains/:ticker, which returns
 * { data: { items: [...], underlyingPrice, symbol } } — the nested shape the
 * options-chain / mult-greek / insights pages already parse.
 */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const ticker = (sp.get("ticker") || "SPX").trim();
  sp.delete("ticker");
  const qs = sp.toString();
  const path = `/proxy/api/tt/chains/${encodeURIComponent(ticker)}${qs ? `?${qs}` : ""}`;
  return forwardGet(path);
}
