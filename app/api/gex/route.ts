import { NextResponse } from "next/server";
import { computeGexSummary } from "@/lib/math/gex";
import { computeGEXProfile } from "@/lib/math/calculations";
import type { ChainRow } from "@/lib/math/calculations";

const PROXY = process.env.PROXY_URL ?? "http://127.0.0.1:3001";

interface ProxyGexRow {
  strike?: number;
  dte?: number;
  callGamma?: number;
  callDelta?: number;
  callOI?: number;
  callVol?: number;
  putGamma?: number;
  putDelta?: number;
  putOI?: number;
  putVol?: number;
  callGEX?: number;
  putGEX?: number;
  netGEX?: number;
}

interface ProxyGexChainResponse {
  spot?: number;
  callWall?: number;
  putWall?: number;
  gexFlip?: number;
  ts?: number;
  rows?: ProxyGexRow[];
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

async function fetchGexChain(expiry: string): Promise<ProxyGexChainResponse> {
  const qs = expiry ? `?expiry=${encodeURIComponent(expiry)}` : "";
  const res = await fetch(`${PROXY}/proxy/api/tt/gex-chain${qs}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
  return res.json();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const expiry = searchParams.get("expiry") ?? "";
    const data = await fetchGexChain(expiry);
    const spotPrice = Number(data?.spot ?? 0);

    const chain: ChainRow[] = (data?.rows ?? [])
      .map((row) => {
        const strike = Number(row.strike ?? 0);
        const callOI = Number(row.callOI ?? 0);
        const putOI = Number(row.putOI ?? 0);
        const callVolume = Number(row.callVol ?? 0);
        const putVolume = Number(row.putVol ?? 0);
        const callGamma = Math.abs(Number(row.callGamma ?? 0));
        const putGamma = Math.abs(Number(row.putGamma ?? 0));
        const callDelta = Number(row.callDelta ?? 0);
        const putDelta = Number(row.putDelta ?? 0);
        const dte = Number(row.dte ?? 0);
        const spot = spotPrice || strike;
        const callGEX = Number(row.callGEX ?? callGamma * callOI * spot * spot);
        const putGEX = Number(row.putGEX ?? putGamma * putOI * spot * spot * -1);
        const netGEX = Number(row.netGEX ?? callGEX + putGEX);

        return {
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
          netVolGEX: callGamma * callVolume * spot * spot - putGamma * putVolume * spot * spot,
          netDEX: callDelta * callOI * spot * 100 - Math.abs(putDelta) * putOI * spot * 100,
          volNetDEX: callDelta * callVolume * spot * 100 - Math.abs(putDelta) * putVolume * spot * 100,
          dte,
          callIV: 0,
          putIV: 0,
        };
      })
      .filter((row) => Number.isFinite(row.strike) && row.strike > 0)
      .sort((a, b) => a.strike - b.strike);

    const summary = computeGexSummary(chain, spotPrice);
    const profile = computeGEXProfile(chain, spotPrice);
    const resolvedGexFlip =
      normalizeFlipPoint(profile?.flipPoint, spotPrice) ??
      normalizeFlipPoint(summary.gexFlip, spotPrice) ??
      normalizeFlipPoint(data?.gexFlip, spotPrice);

    return NextResponse.json({
      timestamp: Number(data?.ts ?? Date.now()),
      spotPrice,
      expiration: expiry || null,
      callWall: summary.callWall ?? (Number(data?.callWall ?? 0) || null),
      putWall: summary.putWall ?? (Number(data?.putWall ?? 0) || null),
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
