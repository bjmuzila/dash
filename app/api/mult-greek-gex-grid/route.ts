import { NextRequest, NextResponse } from "next/server";
import { forwardGet } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/mult-greek-gex-grid?ticker=SPX&expiry=YYYY-MM-DD
 * Forwards to the internal proxy /proxy/mult-greek-gex-grid, which returns
 * { data: { ticker, expiry, cells: { <strike>: { vNow, v5, v15, v30 } } } } —
 * the stored NET GEX baselines for EVERY recorded strike on that expiry
 * (server-v2/mult-greek-gex-recorder.js).
 *
 * This is the bulk form of /api/mult-greek-gex-change. The ladder's Δ bar mode
 * needs a baseline for every visible cell, so it pulls one grid per expiry
 * column instead of one request per cell.
 */
export async function GET(req: NextRequest) {
  const qs = new URL(req.url).searchParams.toString();
  const res = await forwardGet(`/proxy/mult-greek-gex-grid${qs ? `?${qs}` : ""}`);
  return new NextResponse(res.body, res);
}
