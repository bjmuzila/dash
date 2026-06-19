import { NextRequest } from "next/server";
import { forwardGet } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/em/<path>?<query>  →  /proxy/api/tt/<path>?<query>
 * Backs the Estimated Moves ("ES move") tab: option-marks, em-closes,
 * and market-data/history/:symbol all resolve through the internal proxy.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path } = await ctx.params;
  const tail = (path || []).map(encodeURIComponent).join("/");
  const qs = new URL(req.url).search; // includes leading "?"
  return forwardGet(`/proxy/api/tt/${tail}${qs}`);
}
