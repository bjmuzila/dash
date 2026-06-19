import { NextResponse } from "next/server";
import { proxyBase } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/insights/gex — server-computed GEX state for the Insights Exposure tab.
 * Reads /proxy/gex (same source the GEX heatmap uses), which returns
 * { spot, totals, gexRows, callWall, putWall, gexFlip, totalNetGex, ... } with
 * populated greeks. We pass `totals`/`spot`/`updatedAt` straight through (the
 * Exposure cards build their snapshot from `totals`) AND also expose the
 * snake_case GexData fields the lower GEX gauge / wall section reads.
 */
export async function GET() {
  try {
    const res = await fetch(`${proxyBase()}/proxy/gex`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: `proxy ${res.status}` }, { status: res.status });
    }
    const p = await res.json();
    const totals = p?.totals ?? null;
    const callGexB = totals ? Number(totals.totalGEX ?? 0) / 1e9 : null; // net; call/put split not separately summed server-side
    const data = {
      // Pass-through for the Exposure-card snapshot builder.
      spot: p?.spot ?? null,
      totals,
      updatedAt: p?.updatedAt ?? Date.now(),
      // snake_case fields consumed by the GEX gauge / walls section.
      net_gex_billions: totals ? Number(totals.totalGEX ?? 0) / 1e9 : null,
      call_gex_billions: callGexB,
      put_gex_billions: null,
      call_wall_spx: p?.callWall ?? null,
      put_wall_spx: p?.putWall ?? null,
      gamma_flip_spx: p?.gexFlip ?? null,
      spx_spot: p?.spot ?? null,
    };
    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json({ error: String((err as Error)?.message || err) }, { status: 502 });
  }
}
