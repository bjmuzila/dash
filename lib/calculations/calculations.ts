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
  // Vanna (dDelta/dIV) exposure — OI-weighted and volume-weighted
  netVanna?: number;
  netVolVanna?: number;
  bid?: number;
  ask?: number;
  // Per-side contract price (mark, else bid/ask mid) for the strike-detail popup.
  callMark?: number;
  putMark?: number;
  type?: "call" | "put";
  // For GEX profile sweep (Black-Scholes gamma recomputed at each spot level)
  callIV?: number;  // as decimal (0.20 = 20%)
  putIV?:  number;
  dte?:    number;  // days to expiration
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

// "net" = OI + Volume (default), "vol" = volume only.
export type CalcMode = "net" | "vol";

function posOf(oi: number, vol: number, mode: CalcMode): number {
  return mode === "vol" ? vol : oi + vol;
}

// Position (contracts) for each side under the active basis. Exported so callers
// that need the raw contract count (not GEX) share the same OI+Vol / Vol-only rule.
export function callPosOf(row: ChainRow, mode: CalcMode = "net"): number {
  return posOf(row.callOI ?? 0, row.callVolume ?? 0, mode);
}
export function putPosOf(row: ChainRow, mode: CalcMode = "net"): number {
  return posOf(row.putOI ?? 0, row.putVolume ?? 0, mode);
}

// Resolve the spot a row's GEX should be priced on. Callers that know the chart's
// live spot pass it explicitly; otherwise fall back to the row's own spot fields.
// (Chart chain rows often lack spotPrice, which previously zeroed inlined math.)
function spotForRow(row: ChainRow, spot?: number): number {
  return spot && spot > 0 ? spot : Number(row.spotPrice ?? row.spot ?? 0);
}

// ── Single source of truth for per-strike GEX ────────────────────────────────
// calls +, puts −, abs(gamma) — matches the server calculator (gex-calculator.js).
// A stray negative gamma must never flip a side's sign. Every consumer (chart bars,
// chart tooltip, heatmap, header total, mobile) MUST go through these so the basis
// (OI+Vol default / Vol-only) is defined in exactly one place.
export function callGEXOf(row: ChainRow, mode: CalcMode = "net", spot?: number): number {
  const s = spotForRow(row, spot);
  return Math.abs(row.callGamma ?? 0) * callPosOf(row, mode) * s * s;
}
export function putGEXOf(row: ChainRow, mode: CalcMode = "net", spot?: number): number {
  const s = spotForRow(row, spot);
  return -(Math.abs(row.putGamma ?? 0) * putPosOf(row, mode) * s * s);
}
export function netGEXOf(row: ChainRow, mode: CalcMode = "net", spot?: number): number {
  return callGEXOf(row, mode, spot) + putGEXOf(row, mode, spot);
}

export function calculateNetGEX(row: ChainRow, mode: CalcMode = "net"): number {
  return netGEXOf(row, mode);
}

export function calculateNetDEX(
  row: ChainRow,
  spotPrice: number,
  mode: CalcMode = "net"
): number {
  const callPos = posOf(row.callOI ?? 0, row.callVolume ?? 0, mode);
  const putPos = posOf(row.putOI ?? 0, row.putVolume ?? 0, mode);

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
  const best = (spotPrice == null || !Number.isFinite(spotPrice))
    ? crossings[0]
    : crossings.reduce((best, c) =>
    Math.abs(c - spotPrice) < Math.abs(best - spotPrice) ? c : best
    );

  // A zero/negative flip point is almost always a bad fallback, not a real strike.
  return Number.isFinite(best) && best > 0 ? best : null;
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

// ─── GEX Profile (spot-sweep model) ──────────────────────────────────────────
// Recomputes dealer gamma exposure at 401 hypothetical spot levels using
// Black-Scholes gamma. Requires callIV/putIV/dte fields on ChainRow.
// Returns { levels, values } arrays for the profile curve (values in $B/1% move)
// and the interpolated gamma-zero flip point.

// Live fraction of the RTH session (09:30–16:00 ET) still remaining: 1 before
// the open, 0 at/after the close. Gives 0DTE a realistic time-to-expiry instead
// of the 1/262 full-day floor, which inflated the gamma-flip ~60pts intraday.
function rthFractionLeft(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false,
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const nowSec = g("hour") * 3600 + g("minute") * 60 + g("second");
  const open = 9.5 * 3600, close = 16 * 3600, len = close - open;
  return Math.min(Math.max((close - nowSec) / len, 0), 1);
}

function bsGamma(S: number, K: number, vol: number, T: number): number {
  if (T <= 0 || vol <= 0 || S <= 0 || K <= 0) return 0;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * vol * vol * T) / (vol * sqrtT);
  // norm.pdf(d1) = e^(-d1²/2) / sqrt(2π)
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return pdf / (S * vol * sqrtT);
}

export interface GEXProfile {
  levels: number[];
  values: number[];          // net GEX in $B per 1% move at each level
  flipPoint: number | null;  // interpolated gamma-zero
}

export function computeGEXProfile(
  chain: ChainRow[],
  spot: number,
  dataMode: "oi-vol" | "vol-only" = "oi-vol",
): GEXProfile | null {
  // Contract basis per data mode (matches the bar chart's OI+Vol / Vol Only toggle):
  //   oi-vol   → open interest + volume (default)
  //   vol-only → volume only
  const cm: CalcMode = dataMode === "vol-only" ? "vol" : "net";
  const callContracts = (r: ChainRow) => posOf(r.callOI ?? 0, r.callVolume ?? 0, cm);
  const putContracts = (r: ChainRow) => posOf(r.putOI ?? 0, r.putVolume ?? 0, cm);

  // Need at least some rows with IV data + contracts under the active basis
  const rows = chain.filter(r =>
    (r.callIV ?? 0) > 0 && (r.putIV ?? 0) > 0 &&
    callContracts(r) + putContracts(r) > 0 &&
    (r.dte ?? 0) >= 0
  );
  if (rows.length < 5) return null;

  // Match reference (SqueezeMetrics/perfiliev) gamma-profile script exactly:
  //   levels = linspace(0.8*spot, 1.2*spot, 60)
  const lo = spot * 0.8, hi = spot * 1.2;
  const N = 60;
  const levels: number[] = Array.from({ length: N }, (_, i) => lo + (hi - lo) * (i / (N - 1)));
  const values: number[] = [];

  for (const S of levels) {
    let net = 0;
    for (const r of rows) {
      // Reference annualization: trading days / 262. For 0DTE, use the live RTH
      // fraction remaining (floored to ~1 five-min bar) instead of a full day,
      // so the gamma-flip tracks real intraday decay.
      const dte = r.dte ?? 0;
      const T = dte <= 0
        ? Math.max(rthFractionLeft(), 1 / 78) / 262
        : dte / 262;
      const callG = bsGamma(S, r.strike, r.callIV!, T);
      const putG  = bsGamma(S, r.strike, r.putIV!,  T);
      // TotalGEX(P) = Σ BS_gamma(P,K,IV,T) × contracts × 100 × P²
      net += callContracts(r) * 100 * S * S * callG;
      net -= putContracts(r) * 100 * S * S * putG;
    }
    values.push(net / 1e9);
  }

  // Gamma flip: collect ALL sign changes, then take the one nearest spot.
  //   zeroGamma = posStrike − (posStrike − negStrike) × posGamma/(posGamma − negGamma)
  // (Sharp 0DTE gamma can produce spurious far-tail crossings; the regime flip is
  //  the crossing closest to spot, matching findGEXFlip's bar-based behavior.)
  // (ChainRow carries no expiration date, so the reference's Ex-Next / Ex-Monthly
  //  series are omitted — neither is plotted; only the All-Expiries curve + flip are.)
  const crossings: number[] = [];
  for (let i = 0; i < values.length - 1; i++) {
    const a = values[i], b = values[i + 1];
    if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) {
      const z = levels[i + 1] - ((levels[i + 1] - levels[i]) * b / (b - a));
      if (Number.isFinite(z)) crossings.push(z);
    }
  }
  let flipPoint: number | null = crossings.length
    ? crossings.reduce((best, c) => (Math.abs(c - spot) < Math.abs(best - spot) ? c : best))
    : null;
  if (flipPoint !== null) flipPoint = Math.round(flipPoint * 10) / 10;

  return { levels, values, flipPoint };
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
