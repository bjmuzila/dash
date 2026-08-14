import { NextRequest } from "next/server";
import { forwardGet } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/eod-strike-gex-dates[?limit=90]
 *
 * Which end-of-day sessions are actually on file, newest first — the source for
 * the ΔGEX Board's date picker. Forwards to /proxy/eod-strike-gex-dates, which
 * calls listStrikeGexDates() in server-v2/eod-strike-gex-recorder.js and
 * returns { ok, dates: ['YYYY-MM-DD', …] }.
 *
 * The list is read from the recorded rows rather than generated as a calendar:
 * a market holiday, a failed sweep, or the day the roster was first recorded
 * are all invisible to a calendar and would put dead entries in the picker.
 * Retention is ~400 days, so this is the whole recorded history.
 *
 * FALLBACK ONLY. The live path is register('/api/eod-strike-gex-dates') in
 * server-v2/api-router.js.
 *
 * NO CDN CACHE: a new session appears in this list at 16:05 ET, and an edge
 * cache would hide it for the rest of the TTL.
 */
export async function GET(req: NextRequest) {
  const limit = Number(new URL(req.url).searchParams.get("limit") || 90);
  const qs = Number.isFinite(limit) && limit > 0 ? `?limit=${Math.floor(limit)}` : "";
  return forwardGet(`/proxy/eod-strike-gex-dates${qs}`);
}
