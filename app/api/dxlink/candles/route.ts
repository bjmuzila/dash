import { NextRequest } from "next/server";
import { forwardGet } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/dxlink/candles?symbol=SYM&start=<ms>&count=<n>
 * The zones tab requests weekly OHLC; the proxy exposes daily history at
 * /proxy/api/tt/market-data/history/:symbol (shape { data: { items: [...] } }),
 * which parseHistoryItems() in EstimatedMoves already normalizes.
 */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const symbol = (sp.get("symbol") || "").trim();
  if (!symbol) {
    return forwardGet(`/proxy/api/tt/market-data/history/`); // 4xx from proxy
  }
  const interval = sp.get("interval") || "1Week";
  return forwardGet(
    `/proxy/api/tt/market-data/history/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}`
  );
}
