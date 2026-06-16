import { NextResponse } from "next/server";
import { computeGexSummary } from "@/lib/math/gex";
import { computeGEXProfile } from "@/lib/math/calculations";
import type { ChainRow } from "@/lib/math/calculations";

const PROXY = process.env.PROXY_URL ?? "https://vanila-8zn1.onrender.com";

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const expiry = searchParams.get("expiry") ?? "";

    // Use the full chains endpoint — it fetches TT REST OI + live dxLink greeks.
    // gex-chain only reads dxGreeksCache (subscription-only, often sparse).
    const chainUrl = expiry
      ? `${PROXY}/proxy/api/tt/chains/SPX?expiration=${encodeURIComponent(expiry)}&range=all`
      : `${PROXY}/proxy/api/tt/chains/SPX?range=all`;

    const res = await fetch(chainUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) throw new Error(`Proxy returned ${res.status}`);

    const data: ProxyChainResponse = await res.json();
    const items = data?.data?.items ?? [];
    const spotPrice: number = data?.data?.underlyingPrice ?? 0;

    // Flatten nested expGroup → strike structure into per-strike ChainRows.
    // Merge all expirations when no expiry filter, or just the selected one.
    const strikeMap = new Map<number, ChainRow>();
    // Per-expiration rows for BS spot-sweep profile (needs correct DTE per row)
    const profileRows: ChainRow[] = [];

    for (const expGroup of items) {
      const expDate = expGroup["expiration-date"];
      if (expiry && expDate !== expiry) continue;

      for (const strikeObj of expGroup.strikes ?? []) {
        const strike = parseFloat(strikeObj["strike-price"] ?? "0");
        if (!strike || !isFinite(strike)) continue;

        const c = strikeObj.call ?? {};
        const p = strikeObj.put  ?? {};

        const callOI     = Number(c["open-interest"] ?? c.openInterest ?? 0);
        const putOI      = Number(p["open-interest"] ?? p.openInterest ?? 0);
        const callVolume = Number(c.volume ?? 0);
        const putVolume  = Number(p.volume ?? 0);
        const callGamma  = Math.abs(Number(c.gamma ?? 0));
        const putGamma   = Math.abs(Number(p.gamma ?? 0));
        const callDelta  = Number(c.delta ?? 0);
        const putDelta   = Number(p.delta ?? 0);
        const callIV     = Number(c["implied-volatility"] ?? c.impliedVolatility ?? 0);
        const putIV      = Number(p["implied-volatility"] ?? p.impliedVolatility ?? 0);
        const dte        = Number(expGroup["days-to-expiration"] ?? expGroup.daysToExpiration ?? 0);

        const spot = spotPrice || strike; // fallback prevents zero
        const callGEX = callGamma * callOI  * spot * spot;
        const putGEX  = putGamma  * putOI   * spot * spot * -1;
        const netGEX  = callGEX + putGEX;

        const netVolGEX = (callGamma * callVolume * spot * spot) -
                          (putGamma  * putVolume  * spot * spot);
        const netDEX    = (callDelta * callOI     * spot * 100) -
                          (Math.abs(putDelta) * putOI  * spot * 100);
        const volNetDEX = (callDelta * callVolume * spot * 100) -
                          (Math.abs(putDelta) * putVolume * spot * 100);

        // Vanna = dDelta/dIV ≈ delta*(1-delta)/IV per contract, scaled by spot*100 notional
        // For puts: use |putDelta|*(1-|putDelta|)/putIV (puts flip sign vs calls)
        const sqrtT      = Math.sqrt(Math.max(dte, 0.5) / 365);
        const callVanna1 = callIV > 0 ? callDelta * (1 - callDelta) * sqrtT / callIV : 0;
        const putVanna1  = putIV  > 0 ? Math.abs(putDelta) * (1 - Math.abs(putDelta)) * sqrtT / putIV : 0;
        const VANNA_SCALE = spot * 100;
        const netVanna    = (callVanna1 * callOI    - putVanna1 * putOI)    * VANNA_SCALE;
        const netVolVanna = (callVanna1 * callVolume - putVanna1 * putVolume) * VANNA_SCALE;

        // Per-expiration row for profile sweep (IV + DTE must stay per-expiration)
        if ((callIV > 0 || putIV > 0) && (callOI > 0 || putOI > 0)) {
          profileRows.push({ strike, callOI, putOI, callIV, putIV, dte });
        }

        // Merge expirations: accumulate OI/volume across dates for same strike
        const existing = strikeMap.get(strike);
        if (existing) {
          existing.callOI!      += callOI;
          existing.putOI!       += putOI;
          existing.callVolume!  += callVolume;
          existing.putVolume!   += putVolume;
          existing.callGEX!     += callGEX;
          existing.putGEX!      += putGEX;
          existing.netGEX!      += netGEX;
          existing.netVolGEX!   += netVolGEX;
          existing.netDEX!      += netDEX;
          existing.volNetDEX!   += volNetDEX;
          existing.netVanna!    += netVanna;
          existing.netVolVanna! += netVolVanna;
          // Keep minimum DTE so 0DTE filter correctly identifies nearest expiry
          if (dte < (existing.dte ?? Infinity)) existing.dte = dte;
          // average greeks (weighted by OI)
          if (callOI > 0) existing.callGamma = callGamma;
          if (putOI  > 0) existing.putGamma  = putGamma;
          if (callOI > 0) existing.callDelta = callDelta;
          if (putOI  > 0) existing.putDelta  = putDelta;
        } else {
          strikeMap.set(strike, {
            strike,
            spotPrice: spot,
            callOI,    putOI,
            callVolume, putVolume,
            callGamma,  putGamma,
            callDelta,  putDelta,
            callGEX,    putGEX,
            netGEX,
            netVolGEX,
            netDEX,
            volNetDEX,
            netVanna,
            netVolVanna,
            callIV,    putIV,    dte,
          });
        }
      }
    }

    const chain = [...strikeMap.values()].sort((a, b) => a.strike - b.strike);

    // Also pull gexFlip/walls from the dedicated gex endpoint (uses gexLevelCache)
    // as a fast supplemental source. Don't fail if it errors.
    let gexFlip: number | null = null;
    let callWall: number | undefined;
    let putWall:  number | undefined;
    try {
      const gexMeta = await fetch(`${PROXY}/proxy/api/tt/gex`, {
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      if (gexMeta.ok) {
        const gexJson = await gexMeta.json();
        gexFlip  = gexJson?.data?.gamma_flip_spx  ?? null;
        callWall = gexJson?.data?.call_wall_spx    ?? undefined;
        putWall  = gexJson?.data?.put_wall_spx     ?? undefined;
      }
    } catch { /* non-fatal */ }

    const summary = computeGexSummary(chain, spotPrice);
    // Use per-expiration rows for profile sweep so each row has its correct DTE
    const profile = computeGEXProfile(profileRows.length >= 5 ? profileRows : chain, spotPrice);

    return NextResponse.json({
      timestamp:  Date.now(),
      spotPrice,
      expiration: expiry || null,
      callWall:   summary.callWall  ?? callWall,
      putWall:    summary.putWall   ?? putWall,
      gexFlip:    profile?.flipPoint ?? summary.gexFlip ?? gexFlip,
      chain,
      summary,
      profile,   // { levels: number[], values: number[], flipPoint: number|null }
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
        totalNetGEXFormatted: "—",
        isPositiveGamma: false,
      },
      error: msg,
    });
  }
}
