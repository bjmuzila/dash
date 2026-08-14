import { NextRequest } from "next/server";
import { forwardGet } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/eod-strike-gex-board?top=5
 *
 * Whole-board day-over-day ΔGEX ranking for the owner ΔGEX Board page: every
 * symbol on the scanner watchlist, its net Δ and its top N strikes by |Δ|, in
 * ONE call. Forwards to /proxy/eod-strike-gex-board, which calls
 * getStrikeGexBoard() in server-v2/eod-strike-gex-recorder.js and returns
 * { ok, top, symbols: [{ symbol, date, prevDate, spot, net, absTot,
 *   strikes: [{ strike, chg }] }] } sorted by |absTot| desc.
 *
 * Each symbol is diffed against ITS OWN two most recent snapshot dates, not a
 * board-wide date — a name added to the roster last week, or one whose chain
 * failed at 16:05, would otherwise read as flat.
 *
 * FALLBACK ONLY. The live path is register('/api/eod-strike-gex-board') in
 * server-v2/api-router.js; this file exists so the board still works when
 * API_ROUTER is not enabled, matching the sibling eod-strike-gex-change
 * adapter and every other /api/* adapter kept during the migration.
 *
 * This file's absence is what broke the page: with no route.ts and no
 * registration in api-router.js, /api/eod-strike-gex-board fell through to the
 * app/api/[...proxy] catch-all, which answers 501 {"error":"not implemented"}
 * — the literal text the board card was printing.
 *
 * NO CDN CACHE, deliberately. The data only changes once a day, but caching it
 * at the edge would pin a stale baseline date across the 16:05 ET write for the
 * whole TTL — on the one read of the day that matters. forwardGet already emits
 * no-store; this route passes that straight through.
 */
export async function GET(req: NextRequest) {
  const raw = Number(new URL(req.url).searchParams.get("top") || 5);
  const qs = Number.isFinite(raw) && raw > 0 ? `?top=${Math.floor(raw)}` : "";
  return forwardGet(`/proxy/eod-strike-gex-board${qs}`);
}
