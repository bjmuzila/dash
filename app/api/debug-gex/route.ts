import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "http://127.0.0.1:3001";

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);
  const results: Record<string, unknown> = { proxy: PROXY, today };

  // 1. Hit chains endpoint directly
  try {
    const r = await fetch(`${PROXY}/proxy/api/tt/chains/SPX?range=all&expiration=${today}&noCache=1`, {
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    const data = await r.json();
    const items = data?.data?.items ?? [];
    const firstExp = items[0];
    const strikes = firstExp?.strikes ?? [];
    const sample = strikes.slice(0, 5).map((s: Record<string, unknown>) => {
      const call = s.call as Record<string, unknown> ?? {};
      const put = s.put as Record<string, unknown> ?? {};
      return {
        strike: s["strike-price"],
        callOI: call["open-interest"] ?? call.openInterest,
        putOI: put["open-interest"] ?? put.openInterest,
        callGamma: call.gamma,
        putGamma: put.gamma,
      };
    });
    results.chains = {
      status: r.status,
      context: data?.context,
      underlyingPrice: data?.data?.underlyingPrice,
      expGroups: items.length,
      strikesInFirst: strikes.length,
      sampleStrikes: sample,
    };
  } catch (e: unknown) {
    results.chains = { error: e instanceof Error ? e.message : String(e) };
  }

  // 2. Hit gex-chain endpoint (reads directly from dxGreeksCache)
  try {
    const r = await fetch(`${PROXY}/proxy/api/tt/gex-chain?expiry=${today}`, {
      cache: "no-store", signal: AbortSignal.timeout(5_000),
    });
    const data = await r.json();
    const rows = data?.rows ?? [];
    const nonZero = rows.filter((r: Record<string, unknown>) => Number(r.netGEX) !== 0);
    results.gexChain = {
      status: r.status,
      totalRows: rows.length,
      nonZeroRows: nonZero.length,
      spot: data?.spot,
      sampleNonZero: nonZero.slice(0, 5).map((r: Record<string, unknown>) => ({
        strike: r.strike, callOI: r.callOI, putOI: r.putOI,
        callGamma: r.callGamma, putGamma: r.putGamma, netGEX: r.netGEX,
      })),
    };
  } catch (e: unknown) {
    results.gexChain = { error: e instanceof Error ? e.message : String(e) };
  }

  // 3. Check proxy health
  try {
    const r = await fetch(`${PROXY}/health`, { signal: AbortSignal.timeout(3_000) });
    results.proxyHealth = { status: r.status, ok: r.ok };
  } catch (e: unknown) {
    results.proxyHealth = { error: e instanceof Error ? e.message : String(e) };
  }

  // 4. Hit CBOE directly
  try {
    const r = await fetch("https://cdn.cboe.com/api/global/delayed_quotes/options/_SPXW.json", {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const text = await r.text();
    let cboeData: unknown;
    try { cboeData = JSON.parse(text); } catch { cboeData = null; }
    const opts = (cboeData as Record<string,unknown>)?.data?.options ?? [];
    results.cboe = { status: r.status, totalContracts: (opts as unknown[]).length, textPreview: text.slice(0, 200) };
  } catch (e: unknown) {
    results.cboe = { error: e instanceof Error ? e.message : String(e) };
  }

  // 5. Check TT REST OI directly — does /option-chains return open-interest?
  try {
    const r = await fetch(`${PROXY}/proxy/api/tt/raw-chain-sample`, {
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) results.ttRestOI = await r.json();
    else results.ttRestOI = { status: r.status };
  } catch (e: unknown) {
    results.ttRestOI = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(results, { status: 200 });
}
