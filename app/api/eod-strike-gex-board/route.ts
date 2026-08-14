import { NextRequest } from "next/server";
import { forwardGet } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/eod-strike-gex-board?top=5[&date=YYYY-MM-DD]
 *
 * Whole-board day-over-day ΔGEX ranking for the owner ΔGEX Board page: every
 * symbol on the scanner watchlist, its net Δ and its top N strikes by |Δ|, in
 * ONE call. Forwards to /proxy/eod-strike-gex-board, which calls
 * getStrikeGexBoard() in server-v2/eod-strike-gex-recorder.js and returns
 * { ok, top, date, symbols: [{ symbol, date, prevDate, spot,
 *   net, absTot, strikes: [{ strike, chg }],
 *   gexNet, gexAbs, gexStrikes: [{ strike, gex }] }] } sorted by |absTot| desc.
 *
 * The `gex*` fields are the ABSOLUTE per-strike level at that session; the
 * others are the Δ against the session before it. Both ship in one response
 * because the board toggles between the two views client-side, and a mode
 * switch must not cost a round trip.
 *
 * Each symbol is diffed against ITS OWN two most recent snapshot dates, not a
 * board-wide date — a name added to the roster last week, or one whose chain
 * failed at 16:05, would otherwise read as flat.
 *
 * `date` is an AS-OF (the session on or before it), not an exact match, so a
 * date a given symbol missed still answers with what it has. Validated against
 * YYYY-MM-DD here rather than forwarded raw: the proxy casts it to ::date, and
 * a cast failure would be a 500 out of a URL a reader can type. Dropped when
 * malformed, which the recorder reads as "latest".
 *
 * FALLBACK ONLY. The live path is register('/api/eod-strike-gex-board') in
 * server-v2/api-router.js; this file exists so the board still works when
 * API_ROUTER is not enabled, matching the sibling eod-strike-gex-change
 * adapter and every other /api/* adapter kept during the migration.
 *
 * NO CDN CACHE, deliberately. The data only changes once a day, but caching it
 * at the edge would pin a stale baseline date across the 16:05 ET write for the
 * whole TTL — on the one read of the day that matters. forwardGet already emits
 * no-store; this route passes that straight through.
 */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const q = new URLSearchParams();

  const top = Number(sp.get("top") || 5);
  if (Number.isFinite(top) && top > 0) q.set("top", String(Math.floor(top)));

  const date = (sp.get("date") || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) q.set("date", date);

  const qs = q.toString() ? `?${q}` : "";
  return forwardGet(`/proxy/eod-strike-gex-board${qs}`);
}
