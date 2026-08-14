import { NextRequest } from "next/server";
import { forwardGet } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/eod-strike-gex-change?symbol=NVDA[&date=YYYY-MM-DD]
 *
 * Per-strike GEX for one symbol as of a session, with the day-over-day Δ —
 * backing both the Ticker Lookup card's Δ 1D column and the owner ΔGEX Board's
 * detail ladder. Forwards to /proxy/eod-strike-gex-change, which FULL JOINs the
 * two relevant end-of-day snapshots written by
 * server-v2/eod-strike-gex-recorder.js and returns
 * { ok, symbol, date, prevDate, spot, prevSpot,
 *   rows: [{ strike, netGex, prevNetGex, chg, hadPrev }] }.
 *
 * Every row carries both readings — `netGex` is the absolute level at `date`,
 * `chg` is that level minus the prior session's — so a client can switch
 * between levels and Δ without a second request.
 *
 * `date` is an AS-OF (the latest session on or before it, and the one before
 * that), not an exact match: a holiday, a long weekend, or a symbol that missed
 * that particular 16:05 run still answers with the closest session it actually
 * has instead of an empty ladder. Omitted → the latest two, which is what this
 * route did before the param existed. Validated against YYYY-MM-DD here rather
 * than forwarded raw, since the proxy casts it to ::date.
 *
 * FALLBACK ONLY. The live path is register('/api/eod-strike-gex-change') in
 * server-v2/api-router.js; this file exists so the column still works when
 * API_ROUTER is not enabled, matching how every other /api/* adapter in this
 * directory is kept during the migration.
 *
 * NO CDN CACHE, deliberately — unlike /api/chains this is not a hot poll. It is
 * a once-a-day series read once an hour per ticker, and caching it at the edge
 * would pin a stale baseline date across the 16:05 ET write for the whole TTL,
 * on the one day of the week the column is most interesting. forwardGet already
 * emits no-store; this route passes that straight through.
 */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const q = new URLSearchParams();

  const symbol = (sp.get("symbol") || "").trim().toUpperCase();
  if (symbol) q.set("symbol", symbol);

  const date = (sp.get("date") || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) q.set("date", date);

  const qs = q.toString() ? `?${q}` : "";
  return forwardGet(`/proxy/eod-strike-gex-change${qs}`);
}
