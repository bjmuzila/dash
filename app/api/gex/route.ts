import { NextRequest, NextResponse } from "next/server";

/**
 * /api/gex — thin adapter over the server-v2 in-process proxy (/proxy/gex).
 *
 * server-v2 runs Next + proxy in the same process, so we call it on the same
 * origin. Override with PROXY_V2_URL if the proxy is hosted elsewhere.
 *
 * Response is shaped to match what existing callers expect:
 *   { chain: ChainRow[], spotPrice, expiration, callWall, putWall, gexFlip,
 *     totalNetGex, prevClose, updatedAt }
 */
export const dynamic = "force-dynamic";

function proxyBase(): string {
  return (
    process.env.PROXY_V2_URL ||
    `http://127.0.0.1:${process.env.PORT || "3001"}`
  ).replace(/\/$/, "");
}

export async function GET(req: NextRequest) {
  const expiry = new URL(req.url).searchParams.get("expiry") || "";

  try {
    const res = await fetch(`${proxyBase()}/proxy/gex`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `proxy /proxy/gex returned ${res.status}`, chain: [] },
        { status: 502 }
      );
    }
    const v2 = await res.json();

    // Map server-v2 field names → the dashboard's expected shape.
    return NextResponse.json({
      chain: Array.isArray(v2.gexRows) ? v2.gexRows : [],
      spotPrice: Number(v2.spot ?? 0),
      expiration: v2.expiry ?? expiry ?? null,
      expirations: v2.expirations ?? undefined,
      callWall: v2.callWall ?? null,
      putWall: v2.putWall ?? null,
      gexFlip: v2.gexFlip ?? null,
      totalNetGex: v2.totalNetGex ?? null,
      totals: v2.totals ?? null,
      prevClose: v2.prevClose ?? null,
      prevCloseDate: v2.prevCloseDate ?? null,
      updatedAt: v2.updatedAt ?? null,
      symbol: v2.symbol ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String((err as Error)?.message || err), chain: [] },
      { status: 502 }
    );
  }
}
