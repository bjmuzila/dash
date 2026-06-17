import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "http://localhost:3001";

function trimChainToStrikeWindow(json: any, windowEachSide: number) {
  if (!(windowEachSide >= 0)) return json;
  const items = Array.isArray(json?.data?.items) ? json.data.items : Array.isArray(json?.items) ? json.items : [];
  const spot = Number(json?.data?.underlyingPrice ?? json?.underlyingPrice ?? 0);
  if (!items.length || !(spot > 0)) return json;

  for (const expGroup of items) {
    const strikes = Array.isArray(expGroup?.strikes) ? expGroup.strikes : [];
    if (!strikes.length) continue;

    const sorted = [...strikes].sort((a, b) => {
      const as = Number(a?.["strike-price"] ?? a?.strikePrice ?? a?.strike ?? 0);
      const bs = Number(b?.["strike-price"] ?? b?.strikePrice ?? b?.strike ?? 0);
      return as - bs;
    });
    const atmIdx = sorted.reduce((bestIdx, row, idx) => {
      const strike = Number(row?.["strike-price"] ?? row?.strikePrice ?? row?.strike ?? 0);
      const bestStrike = Number(sorted[bestIdx]?.["strike-price"] ?? sorted[bestIdx]?.strikePrice ?? sorted[bestIdx]?.strike ?? 0);
      return Math.abs(strike - spot) < Math.abs(bestStrike - spot) ? idx : bestIdx;
    }, 0);
    const start = Math.max(0, atmIdx - windowEachSide);
    const end = Math.min(sorted.length, atmIdx + windowEachSide + 1);
    expGroup.strikes = sorted.slice(start, end);
  }

  return json;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker     = searchParams.get("ticker") ?? "SPX";
  const strikeWindow = Number(searchParams.get("strikeWindow") ?? NaN);
  const proxyParams = new URLSearchParams(searchParams);
  proxyParams.delete("ticker");
  proxyParams.delete("strikeWindow");
  if (!proxyParams.has("range")) proxyParams.set("range", "all");
  const qs = proxyParams.toString();
  const url = `${PROXY}/proxy/api/tt/chains/${encodeURIComponent(ticker)}${qs ? `?${qs}` : ""}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: "proxy error" }, { status: res.status });
    const json = trimChainToStrikeWindow(await res.json(), strikeWindow);
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
