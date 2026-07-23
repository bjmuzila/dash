import { NextRequest, NextResponse } from "next/server";
import { forwardGet } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/mult-greek-gex-change?ticker=SPX&expiry=YYYY-MM-DD&strike=7400
 * Forwards to the internal proxy /proxy/mult-greek-gex-change, which returns
 * { data: { vNow, v15, v30, vOpen } } — the stored NET GEX for the /mult-greek
 * click card (server-v2/mult-greek-gex-recorder.js). The client diffs its live
 * cell value against these.
 */
export async function GET(req: NextRequest) {
  const qs = new URL(req.url).searchParams.toString();
  const res = await forwardGet(`/proxy/mult-greek-gex-change${qs ? `?${qs}` : ""}`);
  return new NextResponse(res.body, res);
}
