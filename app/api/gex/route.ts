import { NextResponse } from "next/server";
import { computeGexSummary } from "@/lib/math/gex";
import { computeGEXProfile } from "@/lib/math/calculations";
import type { ChainRow } from "@/lib/math/calculations";

const PROXY = process.env.PROXY_URL ?? "http://localhost:3001";

interface ProxyOption {
  "open-interest"?: number;
  openInterest?: number;
  volume?: number;
  delta?: number;
  gamma?: number;
  bid?: number;
  ask?: number;
  last?: number;
  "implied-volatility"?: number;
  impliedVolatility?: number;
}

interface ProxyStrike {
  "strike-price": string;
  call?: ProxyOption;
  put?: ProxyOption;
}

interface ProxyExpGroup {
  "expiration-date": string;
  "days-to-expiration"?: number;
  daysToExpiration?: number;
  strikes: ProxyStrike[];
}

interface ProxyChainResponse {
  data?: {
    items?: ProxyExpGroup[];
    underlyingPrice?: number;
  };
}

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

async function fetchChainResponse(expiry: string): Promise<Response> {
  const urls = expiry
    ? [
        `${PROXY}/proxy/api/tt/chains/SPX?expiration=${encodeURIComponent(expiry)}&range=all&awaitDX=1`,
        `${PROXY}/proxy/api/tt/chains/SPX?expiration=${encodeURIComponent(expiry)}&range=all&noSubscribe=1`,
      ]
    : [`${PROXY}/proxy/api/tt/chains/SPX?range=all&noSubscribe=1`];

  let lastError: unknown = null;

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) return res;
      lastError = new Error(`Proxy returned ${res.status}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "Proxy request failed"));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const expiry = searchParams.get("expiry") ?? "";

    const res = await fetchChainResponse(expiry);
    const data: ProxyChainResponse = await res.json();
    const items = data?.data?.items ?? [];
    const spotPrice: number = data?.data?.underlyingPrice ?? 0;

    const strikeMap = new Map<number, ChainRow>();
    const profileRows: ChainRow[] = [];

    for (const expGroup of items) {
      const expDate = expGroup["expiration-date"];
      if (expiry && expDate !== expiry) continue;

      for (const strikeObj of expGroup.strikes ?? []) {
        const strike = parseFloat(strikeObj["strike-price"] ?? "0");
        if (!strike || !isFinite(strike)) continue;

        const c = strikeObj.call ?? {};
        const p = strikeObj.put ?? {};

        const callOI = Number(c["open-interest"] ?? c.openInterest ?? 0);
        const putOI = Number(p["open-interest"] ?? p.openInterest ?? 0);
        const callVolume = Number(c.volume ?? 0);
        const putVolume = Number(p.volume ?? 0);
        const callGamma = Math.abs(Number(c.gamma ?? 0));
        const putGamma = Math.abs(Number(p.gamma ?? 0));
        const callDelta = Number(c.delta ?? 0);
        const putDelta = Number(p.delta ?? 0);
        const callIV = Number(c["implied-volatility"] ?? c.impliedVolatility ?? 0);
        const putIV = Number(p["implied-volatility"] ?? p.impliedVolatility ?? 0);
        const dte = Number(expGroup["days-to-expiration"] ?? expGroup.daysToExpiration ?? 0);

        const spot = spotPrice || strike;
        const callGEX = callGamma * callOI * spot * spot;
        const putGEX = putGamma * putOI * spot * spot * -1;
        const netGEX = callGEX + putGEX;

        const netVolGEX = callGamma * callVolume * spot * spot - putGamma * putVolume * spot * spot;
        const netDEX = callDelta * callOI * spot * 100 - Math.abs(putDelta) * putOI * spot * 100;
        const volNetDEX = callDelta * callVolume * spot * 100 - Math.abs(putDelta) * putVolume * spot * 100;

        const sqrtT = Math.sqrt(Math.max(dte, 0.5) / 365);
        const callVanna1 = callIV > 0 ? callDelta * (1 - callDelta) * sqrtT / callIV : 0;
        const putVanna1 = putIV > 0 ? Math.abs(putDelta) * (1 - Math.abs(putDelta)) * sqrtT / putIV : 0;
        const VANNA_SCALE = spot * 100;
        const netVanna = (callVanna1 * callOI - putVanna1 * putOI) * VANNA_SCALE;
        const netVolVanna = (callVanna1 * callVolume - putVanna1 * putVolume) * VANNA_SCALE;

        if ((callIV > 0 || putIV > 0) && (callOI > 0 || putOI > 0)) {
          profileRows.push({ strike, callOI, putOI, callIV, putIV, dte });
        }

        const existing = strikeMap.get(strike);
        if (existing) {
          existing.callOI! += callOI;
          existing.putOI! += putOI;
          existing.callVolume! += callVolume;
          existing.putVolume! += putVolume;
          existing.callGEX! += callGEX;
          existing.putGEX! += putGEX;
          existing.netGEX! += netGEX;
          existing.netVolGEX! += netVolGEX;
          existing.netDEX! += netDEX;
          existing.volNetDEX! += volNetDEX;
          existing.netVanna! += netVanna;
          existing.netVolVanna! += netVolVanna;
          if (dte < (existing.dte ?? Infinity)) existing.dte = dte;
          if (callOI > 0) existing.callGamma = callGamma;
          if (putOI > 0) existing.putGamma = putGamma;
          if (callOI > 0) existing.callDelta = callDelta;
          if (putOI > 0) existing.putDelta = putDelta;
        } else {
          strikeMap.set(strike, {
            strike,
            spotPrice: spot,
            callOI,
            putOI,
            callVolume,
            putVolume,
            callGamma,
            putGamma,
            callDelta,
            putDelta,
            callGEX,
            putGEX,
            netGEX,
            netVolGEX,
            netDEX,
            volNetDEX,
            netVanna,
            netVolVanna,
            callIV,
            putIV,
            dte,
          });
        }
      }
    }

    const chain = [...strikeMap.values()].sort((a, b) => a.strike - b.strike);

    let gexFlip: number | null = null;
    let callWall: number | undefined;
    let putWall: number | undefined;
    try {
      const gexMeta = await fetch(`${PROXY}/proxy/api/tt/gex`, {
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      if (gexMeta.ok) {
        const gexJson = await gexMeta.json();
        gexFlip = gexJson?.data?.gamma_flip_spx ?? null;
        callWall = gexJson?.data?.call_wall_spx ?? undefined;
        putWall = gexJson?.data?.put_wall_spx ?? undefined;
      }
    } catch {}

    const summary = computeGexSummary(chain, spotPrice);
    const profile = computeGEXProfile(profileRows.length >= 5 ? profileRows : chain, spotPrice);

    const resolvedGexFlip =
      normalizeFlipPoint(profile?.flipPoint, spotPrice) ??
      normalizeFlipPoint(summary.gexFlip, spotPrice) ??
      normalizeFlipPoint(gexFlip, spotPrice);

    return NextResponse.json({
      timestamp: Date.now(),
      spotPrice,
      expiration: expiry || null,
      callWall: summary.callWall ?? callWall,
      putWall: summary.putWall ?? putWall,
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
