// Ported from shared/calculations.js

export interface ChainRow {
  strike: number;
  spotPrice?: number;
  spot?: number;
  callOI?: number;
  callVolume?: number;
  putOI?: number;
  putVolume?: number;
  callGamma?: number;
  putGamma?: number;
  callDelta?: number;
  putDelta?: number;
  callGEX?: number;
  putGEX?: number;
  netGEX?: number;
  netVolGEX?: number;
  netDEX?: number;
  volNetDEX?: number;
  bid?: number;
  ask?: number;
  type?: "call" | "put";
}

export function densifyChainRows(chain: ChainRow[], step = 5): ChainRow[] {
  if (!chain.length) return [];

  const sorted = [...chain].sort((a, b) => a.strike - b.strike);
  const byStrike = new Map<number, ChainRow>();
  for (const row of sorted) byStrike.set(row.strike, row);

  const minStrike = sorted[0].strike;
  const maxStrike = sorted[sorted.length - 1].strike;
  const start = Math.floor(minStrike / step) * step;
  const end = Math.ceil(maxStrike / step) * step;
  const spotPrice = sorted[0].spotPrice ?? sorted[0].spot ?? 0;

  const rows: ChainRow[] = [];
  for (let strike = start; strike <= end; strike += step) {
    const existing = byStrike.get(strike);
    rows.push(
      existing ?? {
        strike,
        spotPrice,
        callOI: 0,
        callVolume: 0,
        putOI: 0,
        putVolume: 0,
        callGamma: 0,
        putGamma: 0,
        callDelta: 0,
        putDelta: 0,
        callGEX: 0,
        putGEX: 0,
        netGEX: 0,
      }
    );
  }

  return rows;
}

export type CalcMode = "net" | "vol";

export function calculateNetGEX(row: ChainRow, mode: CalcMode = "net"): number {
  const spot = Number(row.spotPrice ?? row.spot ?? 0);
  const callPos =
    mode === "vol"
      ? (row.callVolume ?? 0)
      : (row.callOI ?? 0) + (row.callVolume ?? 0);
  const putPos =
    mode === "vol"
      ? (row.putVolume ?? 0)
      : (row.putOI ?? 0) + (row.putVolume ?? 0);

  const callGEX = (row.callGamma ?? 0) * callPos * spot * spot;
  const putGEX = (row.putGamma ?? 0) * putPos * spot * spot * -1;
  return callGEX + putGEX;
}

export function calculateNetDEX(
  row: ChainRow,
  spotPrice: number,
  mode: CalcMode = "net"
): number {
  const callPos =
    mode === "vol"
      ? (row.callVolume ?? 0)
      : (row.callOI ?? 0) + (row.callVolume ?? 0);
  const putPos =
    mode === "vol"
      ? (row.putVolume ?? 0)
      : (row.putOI ?? 0) + (row.putVolume ?? 0);

  return ((row.callDelta ?? 0) * callPos - (row.putDelta ?? 0) * putPos) * spotPrice * 100;
}

export function calculateCumulativeDEX(
  chain: ChainRow[],
  atmStrike: number,
  spotPrice: number,
  mode: CalcMode = "net"
): number {
  const sorted = [...chain].sort((a, b) => a.strike - b.strike);
  let cumDEX = 0;
  for (const row of sorted) {
    if (row.strike <= atmStrike) {
      cumDEX += calculateNetDEX(row, spotPrice, mode);
    } else {
      break;
    }
  }
  return cumDEX;
}

export function findGEXFlip(chain: ChainRow[], spotPrice?: number): number | null {
  // Find the strike where net GEX profile crosses zero (gamma flip / gamma zero).
  // Uses linear interpolation between adjacent strikes — equivalent to the
  // spot-sweep model when per-strike gamma is approximately flat between strikes.
  const sorted = [...chain]
    .filter(r => Number.isFinite(r.netGEX))
    .sort((a, b) => a.strike - b.strike);
  if (!sorted.length) return null;

  const crossings: number[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i].netGEX!;
    const b = sorted[i + 1].netGEX!;

    if (a === 0) { crossings.push(sorted[i].strike); continue; }
    if (b === 0) { crossings.push(sorted[i + 1].strike); continue; }

    // Sign change → linear interpolation for sub-strike precision
    if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
      const sA = sorted[i].strike, sB = sorted[i + 1].strike;
      const zero = sA + (sB - sA) * (Math.abs(a) / (Math.abs(a) + Math.abs(b)));
      if (Number.isFinite(zero)) crossings.push(Math.round(zero * 10) / 10);
    }
  }

  if (!crossings.length) return null;

  // Return the crossing closest to spot (or the first if no spot provided)
  if (spotPrice == null || !Number.isFinite(spotPrice)) return crossings[0];
  return crossings.reduce((best, c) =>
    Math.abs(c - spotPrice) < Math.abs(best - spotPrice) ? c : best
  );
}

export function findCallWall(chain: ChainRow[]): number | undefined {
  return chain.reduce((max, row) =>
    (row.callGEX ?? 0) > (max.callGEX ?? 0) ? row : max,
    chain[0]
  )?.strike;
}

export function findPutWall(chain: ChainRow[]): number | undefined {
  return chain.reduce((max, row) =>
    Math.abs(row.putGEX ?? 0) > Math.abs(max.putGEX ?? 0) ? row : max,
    chain[0]
  )?.strike;
}

export function formatGEX(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "-";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${(abs / 1e3).toFixed(2)}K`;
}

export function formatStrike(strike: number): string {
  return strike.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function calculateDailyEstimatedMove(
  chain: ChainRow[],
  spotPrice: number
): number | null {
  if (!chain?.length) return null;
  const atmStrike = Math.round(spotPrice / 5) * 5;
  const atmCall = chain.find((o) => o.strike === atmStrike && o.type === "call");
  const atmPut = chain.find((o) => o.strike === atmStrike && o.type === "put");
  if (!atmCall || !atmPut) return null;
  const callMid = ((atmCall.bid ?? 0) + (atmCall.ask ?? 0)) / 2;
  const putMid = ((atmPut.bid ?? 0) + (atmPut.ask ?? 0)) / 2;
  return Math.round((callMid + putMid) / 2 * 0.84 * 100) / 100;
}
