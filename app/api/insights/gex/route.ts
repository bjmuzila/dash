import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "http://localhost:3001";

function normalizeGexPayload(json: any) {
  const data = json?.data ?? json ?? {};
  return {
    ...data,
    data,
    netGex: data.netGex ?? data.totalNetGEX ?? data.net_gex ?? null,
    totalNetGEX: data.totalNetGEX ?? data.netGex ?? data.net_gex ?? null,
    gammaFlip: data.gammaFlip ?? data.gammaZero ?? data.gexFlip ?? null,
    gexFlip: data.gexFlip ?? data.gammaFlip ?? data.gammaZero ?? null,
    callWall: data.callWall ?? null,
    putWall: data.putWall ?? null,
    mvcStrike: data.mvcStrike ?? data.mvc?.strike ?? null,
  };
}

export async function GET() {
  try {
    const res = await fetch(`${PROXY}/proxy/api/tt/gex`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(normalizeGexPayload({ error: "proxy error" }));
    }
    const json = await res.json();
    return NextResponse.json(normalizeGexPayload(json));
  } catch (e) {
    return NextResponse.json(normalizeGexPayload({ error: String(e) }));
  }
}
