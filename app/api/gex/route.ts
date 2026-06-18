import { NextResponse } from "next/server";
import { computeGexSummary } from "@/lib/calculations/gex";
import { computeGEXProfile } from "@/lib/calculations/calculations";
import type { ChainRow } from "@/lib/calculations/calculations";

const PROXY = process.env.PROXY_URL ?? "http://127.0.0.1:3001";

function normalizeFlipPoint(value: unknown, spotPrice: number): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (spotPrice > 0) {
    const lo = spotPrice * 0.95;
    const hi = spotPrice * 1.05;
    if (num < lo || num > hi) return null;
  }
  return num;
}

function todayEtYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function resolveSpxExpiry(expiry: string): Promise<string> {
  const today = todayEtYmd();
  if (expiry && /^\d{4}-\d{2}-\d{2}$/.test(expiry) && expiry >= today) return expiry;

  const res = await fetch(`${PROXY}/proxy/api/tt/expirations/SPX`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return expiry || today;

  const json = await res.json().catch(() => null);
  const items = Array.isArray(json?.data?.items) ? json.data.items : [];
  const next = items
    .map((item: any) => String(item?.["expiration-date"] ?? ""))
    .filter((date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today)
    .sort()[0];

  return next || expiry || today;
}

async function fetchGexChain(expiry: string): Promise<any> {
  const resolvedExpiry = await resolveSpxExpiry(expiry);
  const chainQs = new URLSearchParams({ range: "all", noCache: "1", noSubscribe: "1" });
  if (resolvedExpiry) chainQs.set("expiration", resolvedExpiry);

  const res = await fetch(`${PROXY}/proxy/api/tt/chains/SPX?${chainQs.toString()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.ok) return { ...(await res.json()), __resolvedExpiry: resolvedExpiry, __source: "chains" };

  const fastQs = new URLSearchParams();
  if (resolvedExpiry) fastQs.set("expiry", resolvedExpiry);
  const fastRes = await fetch(`${PROXY}/proxy/api/tt/gex-chain${fastQs.toString() ? `?${fastQs.toString()}` : ""}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (fastRes.ok) return { ...(await fastRes.json()), __resolvedExpiry: resolvedExpiry, __source: "gex-chain" };

  throw new Error("chains and gex-chain endpoints failed");
}

function flattenChain(data: any, fallbackSpot = 0): ChainRow[] {
  if (Array.isArray(data?.rows)) {
    const spot = Number(data?.spot ?? fallbackSpot ?? 0);
    return data.rows
      .map((row: any) => ({
        strike: Number(row?.strike ?? 0),
        spotPrice: spot,
        callOI: Number(row?.callOI ?? 0),
        putOI: Number(row?.putOI ?? 0),
        callVolume: Number(row?.callVolume ?? row?.callVol ?? 0),
        putVolume: Number(row?.putVolume ?? row?.putVol ?? 0),
        callGamma: Number(row?.callGamma ?? 0),
        putGamma: Number(row?.putGamma ?? 0),
        callDelta: Number(row?.callDelta ?? 0),
        putDelta: Number(row?.putDelta ?? 0),
        callGEX: Number(row?.callGEX ?? 0),
        putGEX: Number(row?.putGEX ?? 0),
        netGEX: Number(row?.netGEX ?? 0),
        netVolGEX: Number(row?.netVolGEX ?? 0),
        netDEX: Number(row?.netDEX ?? 0),
        volNetDEX: Number(row?.volNetDEX ?? 0),
        dte: Number(row?.dte ?? 0),
        callIV: Number(row?.callIV ?? 0),
        putIV: Number(row?.putIV ?? 0),
        type: "call",
      } as ChainRow))
      .filter((row: ChainRow) => row.strike > 0)
      .sort((a: ChainRow, b: ChainRow) => a.strike - b.strike);
  }

  const items = Array.isArray(data?.data?.items) ? data.data.items : Array.isArray(data?.items) ? data.items : [];
  const underlyingPrice = Number(data?.data?.underlyingPrice ?? data?.underlyingPrice ?? fallbackSpot ?? 0);
  const rows: ChainRow[] = [];

  for (const expGroup of items) {
    const exp = String(expGroup?.["expiration-date"] ?? expGroup?.expirationDate ?? "");
    const strikes = Array.isArray(expGroup?.strikes) ? expGroup.strikes : [];
    for (const strikeRow of strikes) {
      const strike = Number(strikeRow?.["strike-price"] ?? strikeRow?.strikePrice ?? strikeRow?.strike ?? 0);
      const call = strikeRow?.call ?? null;
      const put = strikeRow?.put ?? null;
      if (!(strike > 0)) continue;

      const callOI = Number(call?.["open-interest"] ?? call?.openInterest ?? 0);
      const putOI = Number(put?.["open-interest"] ?? put?.openInterest ?? 0);
      const callVol = Number(call?.dayVolume ?? call?.volume ?? 0);
      const putVol = Number(put?.dayVolume ?? put?.volume ?? 0);
      const callGamma = Math.abs(Number(call?.gamma ?? 0));
      const putGamma = Math.abs(Number(put?.gamma ?? 0));
      const callDelta = Number(call?.delta ?? 0);
      const putDelta = Number(put?.delta ?? 0);
      const callIV = Number(call?.["implied-volatility"] ?? call?.impliedVolatility ?? 0);
      const putIV = Number(put?.["implied-volatility"] ?? put?.impliedVolatility ?? 0);
      const spot = underlyingPrice || strike;

      const callGEX = callGamma * callOI * spot * spot;
      const putGEX = putGamma * putOI * spot * spot * -1;

      rows.push({
        strike,
        spotPrice: spot,
        callOI,
        putOI,
        callVolume: callVol,
        putVolume: putVol,
        callGamma,
        putGamma,
        callDelta,
        putDelta,
        callGEX,
        putGEX,
        netGEX: callGEX + putGEX,
        netVolGEX: callGamma * callVol * spot * spot - putGamma * putVol * spot * spot,
        netDEX: callDelta * callOI * spot * 100 - Math.abs(putDelta) * putOI * spot * 100,
        volNetDEX: callDelta * callVol * spot * 100 - Math.abs(putDelta) * putVol * spot * 100,
        dte: exp ? Math.max(0, Math.round((new Date(`${exp}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)) : 0,
        callIV,
        putIV,
        type: "call",
      } as ChainRow);
    }
  }

  return rows.sort((a, b) => a.strike - b.strike);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const expiry = searchParams.get("expiry") ?? "";
    const data = await fetchGexChain(expiry);
    const resolvedExpiry = String((data?.__resolvedExpiry ?? expiry) || "");
    const chain = flattenChain(data);
    const spotPrice = Number(data?.spot ?? data?.data?.underlyingPrice ?? data?.underlyingPrice ?? chain[0]?.spotPrice ?? 0);

    const summary = computeGexSummary(chain, spotPrice);
    const profile = computeGEXProfile(chain, spotPrice);
    const resolvedGexFlip =
      normalizeFlipPoint(profile?.flipPoint, spotPrice) ??
      normalizeFlipPoint(summary.gexFlip, spotPrice) ??
      normalizeFlipPoint(data?.gexFlip, spotPrice);

    return NextResponse.json({
      timestamp: Number(data?.ts ?? Date.now()),
      spotPrice,
      expiration: resolvedExpiry || null,
      callWall: summary.callWall ?? (Number(data?.callWall ?? data?.data?.callWall ?? 0) || null),
      putWall: summary.putWall ?? (Number(data?.putWall ?? data?.data?.putWall ?? 0) || null),
      gexFlip: resolvedGexFlip,
      chain,
      summary,
      profile,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/gex]", msg);

    return NextResponse.json({
      timestamp: Date.now(),
      spotPrice: null,
      chain: [],
      summary: {
        gexFlip: null,
        callWall: null,
        putWall: null,
        totalNetGEX: 0,
        totalNetGEXFormatted: "-",
        isPositiveGamma: false,
      },
      error: msg,
    });
  }
}
