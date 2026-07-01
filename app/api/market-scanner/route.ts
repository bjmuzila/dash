import { NextResponse } from "next/server";
import { proxyBase } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── Config ────────────────────────────────────────────────────────────────────

const TICKERS = [
  { sym: "SPX", yahoo: "^GSPC", ivSym: "^VIX",  hasLiveGex: true  },
  { sym: "SPY", yahoo: "SPY",   ivSym: "^VIX",  hasLiveGex: false },
  { sym: "QQQ", yahoo: "QQQ",   ivSym: "^VXN",  hasLiveGex: false },
  { sym: "VIX", yahoo: "^VIX",  ivSym: "^VVIX", hasLiveGex: false },
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TickerAnalytics {
  symbol: string;
  spot: number | null;
  change1d: number | null;
  pct1d: number | null;

  score: number;
  rating: "HIGH" | "LOW" | "PASS";
  direction: "LONG" | "SHORT" | "NEUTRAL";
  strategy: string;
  thesis: string;

  regime: string;
  marketStructure: string;

  ivRank: number | null;
  iv1dChange: number | null;
  callSpec: number | null;

  em1d: number | null;
  em1w: number | null;
  em30d: number | null;

  trend: "up" | "down" | "sideways";
  momentum: "strong" | "weakening" | "neutral";
  extension: "extended" | "neutral" | "contracted";
  realizedVol20d: number | null;
  alignment: "aligned" | "conflicting" | "neutral";

  gexFlip: number | null;
  gexPer1pct: number | null;
  maxGexStrike: number | null;
  gexExpiringPct: number | null;
  gexExpiringDate: string | null;

  pcIvRatio: number | null;
  pcIvSpread: number | null;

  callsOI: number | null;
  putsOI: number | null;
  pcrOI: number | null;
  pcrVol: number | null;
  pcrDelta30d: number | null;

  updatedAt: string;
}

// ── Yahoo helpers ─────────────────────────────────────────────────────────────

const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://finance.yahoo.com",
  Referer: "https://finance.yahoo.com/",
};

interface YSeries {
  closes: number[];
  timestamps: number[];
  last: number | null;
  prevClose: number | null;
  change: number | null;
  pct: number | null;
}

async function fetchYahoo(sym: string, range = "1y"): Promise<YSeries> {
  const empty: YSeries = { closes: [], timestamps: [], last: null, prevClose: null, change: null, pct: null };
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}&includePrePost=false&_=${Date.now()}`;
    const res = await fetch(url, { headers: YAHOO_HEADERS, cache: "no-store" });
    if (!res.ok) return empty;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return empty;
    const meta = result.meta ?? {};
    const raw: unknown[] = result.indicators?.quote?.[0]?.close ?? [];
    const closes = (raw as (number | null)[]).filter((v): v is number => typeof v === "number" && isFinite(v));
    const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
    const last = meta.regularMarketPrice ?? (closes.length ? closes[closes.length - 1] : null);
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? (closes.length > 1 ? closes[closes.length - 2] : null);
    const change = last != null && prevClose != null ? last - prevClose : null;
    const pct = change != null && prevClose ? (change / prevClose) * 100 : null;
    return { closes, timestamps, last, prevClose, change, pct };
  } catch {
    return empty;
  }
}

// ── Math helpers ──────────────────────────────────────────────────────────────

function ivRank(current: number, series: number[]): number | null {
  if (!series.length || current == null) return null;
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  if (hi === lo) return 50;
  return Math.round(((current - lo) / (hi - lo)) * 100);
}

function realizedVol(closes: number[], period = 20): number | null {
  if (closes.length < period + 1) return null;
  const slice = closes.slice(-(period + 1));
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) rets.push(Math.log(slice[i] / slice[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
  return Math.round(Math.sqrt(variance * 252) * 100 * 10) / 10;
}

// Simple linear regression slope over last N closes (normalised to daily %)
function trendSlope(closes: number[], period = 20): number {
  if (closes.length < 2) return 0;
  const s = closes.slice(-period);
  const n = s.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += s[i]; sumXY += i * s[i]; sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  return (slope / (s[0] || 1)) * 100; // daily % slope
}

// Momentum: compare 5d avg vs 20d avg
function momentum(closes: number[]): "strong" | "weakening" | "neutral" {
  if (closes.length < 20) return "neutral";
  const avg5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const avg20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const slope = trendSlope(closes, 20);
  const diff = (avg5 - avg20) / avg20;
  if (Math.abs(slope) > 0.1 && Math.abs(diff) > 0.005) return "strong";
  if (Math.abs(diff) < 0.002 && Math.abs(slope) < 0.05) return "weakening";
  return "neutral";
}

// Extension: how far price is from 20d MA in % terms
function extensionLevel(closes: number[]): "extended" | "neutral" | "contracted" {
  if (closes.length < 20) return "neutral";
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const last = closes[closes.length - 1];
  const pct = (last - ma20) / ma20;
  if (Math.abs(pct) > 0.04) return "extended";
  if (Math.abs(pct) < 0.01) return "contracted";
  return "neutral";
}

// Expected move from annualized IV + DTE
function expectedMove(spot: number, ivAnnualized: number, dte: number): number {
  return Math.round((spot * (ivAnnualized / 100) * Math.sqrt(dte / 365)) * 10) / 10;
}

// ── GEX fetch for SPX ─────────────────────────────────────────────────────────

interface GexSnap {
  gexFlip: number | null;
  gexPer1pct: number | null;
  maxGexStrike: number | null;
  gexExpiringPct: number | null;
  gexExpiringDate: string | null;
  callWall: number | null;
  putWall: number | null;
  callsOI: number | null;
  putsOI: number | null;
  pcrOI: number | null;
  callSpec: number | null;
}

async function fetchGexSnap(): Promise<GexSnap> {
  const empty: GexSnap = {
    gexFlip: null, gexPer1pct: null, maxGexStrike: null,
    gexExpiringPct: null, gexExpiringDate: null,
    callWall: null, putWall: null, callsOI: null, putsOI: null,
    pcrOI: null, callSpec: null,
  };
  try {
    // Call proxy/gex directly (same loopback as other server-side routes — avoids
    // round-tripping through the public domain like the old `${origin}/api/gex` did).
    const res = await fetch(`${proxyBase()}/proxy/gex`, { cache: "no-store" });
    if (!res.ok) return empty;
    const v = await res.json();
    // proxy/gex returns { gexRows, spot, expiry, callWall, putWall, gexFlip, totalNetGex, totals }
    const chain: { strike: number; callOI?: number; callVolume?: number; putOI?: number; putVolume?: number; netGEX?: number }[] = v.gexRows ?? [];

    // Compute PCR & call spec from chain
    let callsOI = 0, putsOI = 0, callsVol = 0, putsVol = 0;
    chain.forEach(r => {
      callsOI  += r.callOI     ?? 0;
      putsOI   += r.putOI      ?? 0;
      callsVol += r.callVolume ?? 0;
      putsVol  += r.putVolume  ?? 0;
    });
    const totalOI  = callsOI  + putsOI;
    const totalVol = callsVol + putsVol;
    const pcrOI   = putsOI  > 0 && callsOI  > 0 ? Math.round((putsOI  / callsOI)  * 100) / 100 : null;
    const callSpec = totalVol > 0 ? Math.round((callsVol / totalVol) * 100) : totalOI > 0 ? Math.round((callsOI / totalOI) * 100) : null;

    // Max GEX strike
    let maxGexStrike: number | null = null;
    let maxGex = -Infinity;
    chain.forEach(r => {
      const g = Math.abs(r.netGEX ?? 0);
      if (g > maxGex) { maxGex = g; maxGexStrike = r.strike; }
    });

    // GEX/1% move — approximate: totalNetGex / (spot * 0.01)
    const spot = v.spot ?? null;
    const gexPer1pct = v.totalNetGex != null && spot && spot > 0
      ? Math.round((v.totalNetGex / (spot * 0.01)) / 1e9 * 100) / 100
      : null;

    // Expiry field from proxy
    const gexExpiringDate: string | null = v.expiry ?? null;

    return {
      gexFlip: v.gexFlip ?? null,
      gexPer1pct,
      maxGexStrike,
      gexExpiringPct: null, // would need expiry breakdown
      gexExpiringDate,
      callWall: v.callWall ?? null,
      putWall: v.putWall ?? null,
      callsOI: callsOI || null,
      putsOI: putsOI || null,
      pcrOI,
      callSpec,
    };
  } catch {
    return empty;
  }
}

// ── Scoring + regime ──────────────────────────────────────────────────────────

function computeAnalytics(
  sym: string,
  spot: number,
  closes: number[],
  ivr: number | null,
  rv20: number | null,
  iv1dChange: number | null,
  gex: GexSnap,
): Omit<TickerAnalytics, "symbol" | "spot" | "change1d" | "pct1d" | "ivRank" | "iv1dChange" | "realizedVol20d" | "updatedAt" | "callsOI" | "putsOI" | "pcrOI" | "callSpec" | "gexFlip" | "gexPer1pct" | "maxGexStrike" | "gexExpiringPct" | "gexExpiringDate"> {
  const slope = trendSlope(closes, 20);
  const mom = momentum(closes);
  const ext = extensionLevel(closes);
  const ivrN = ivr ?? 50;

  // Trend direction from 20d slope
  const trend: "up" | "down" | "sideways" =
    slope > 0.08 ? "up" : slope < -0.08 ? "down" : "sideways";

  // Alignment: GEX flip vs spot
  let alignment: "aligned" | "conflicting" | "neutral" = "neutral";
  if (gex.gexFlip != null) {
    const aboveFlip = spot > gex.gexFlip;
    if (trend === "up" && aboveFlip) alignment = "aligned";
    else if (trend === "down" && !aboveFlip) alignment = "aligned";
    else if (trend !== "sideways") alignment = "conflicting";
  }

  // Regime
  let regime: string;
  if (trend === "sideways") {
    regime = "RANGE BOUND";
  } else if (ivrN > 60) {
    regime = "TRENDING HIGH VOL";
  } else {
    regime = "TRENDING LOW VOL";
  }

  // Market structure
  let marketStructure: string;
  if (ext === "extended" && alignment === "conflicting") {
    marketStructure = "MEAN REVERSION FAVORED";
  } else if (ivrN > 65 && mom === "strong") {
    marketStructure = "VOLATILITY EXPANSION RISK";
  } else if (trend !== "sideways" && alignment === "aligned") {
    marketStructure = "TREND CONTINUATION LIKELY";
  } else {
    marketStructure = "MIXED / WATCH";
  }

  // Direction
  let direction: "LONG" | "SHORT" | "NEUTRAL";
  if (ext === "extended" && mom === "weakening") {
    direction = "NEUTRAL";
  } else if (trend === "up") {
    direction = "LONG";
  } else if (trend === "down") {
    direction = "SHORT";
  } else {
    direction = "NEUTRAL";
  }

  // Strategy
  let strategy: string;
  if (ivrN > 55 && alignment === "conflicting") {
    strategy = "VOL PREMIUM";
  } else if (ext === "extended" && mom === "weakening") {
    strategy = "MEAN REVERSION";
  } else if (trend !== "sideways" && mom === "strong" && ivrN < 50) {
    strategy = "DIRECTIONAL";
  } else if (trend === "sideways" && ivrN < 35) {
    strategy = "PASS";
  } else {
    strategy = "MEAN REVERSION";
  }

  if (sym === "VIX") {
    // VIX gets special treatment — it's a volatility instrument
    direction = "NEUTRAL";
    strategy = ivrN > 50 ? "VOL PREMIUM" : "PASS";
    if (trend === "up") regime = "VOLATILITY EXPANSION";
    else if (trend === "down") regime = "VOL COMPRESSION";
  }

  // Thesis
  const THESIS: Record<string, string> = {
    "VOL PREMIUM": "Sell premium, fade extensions, collect decay",
    "MEAN REVERSION": "Fade extensions, target MA mean reversion",
    "DIRECTIONAL": "Long breakouts, buy dips to MA",
    "PASS": "Long with defined risk, reduced size; tighten stops",
  };
  const thesis = THESIS[strategy] ?? "Monitor; conflicting signals";

  // Score (0–10)
  let score = 5;
  if (trend !== "sideways") score += 1;
  if (mom === "strong") score += 1;
  if (alignment === "aligned") score += 1;
  if (alignment === "conflicting") score -= 1;
  if (ext === "extended") score -= 1;
  if (ivrN > 60) score += 1; // vol opportunities
  if (strategy === "PASS") score = Math.min(score, 2);
  if (sym === "VIX") score = Math.round(ivrN / 10);
  score = Math.max(0, Math.min(10, score));

  // Rating
  const rating: "HIGH" | "LOW" | "PASS" =
    strategy === "PASS" ? "PASS" : score >= 6 ? "HIGH" : "LOW";

  // Expected moves using IV (approximation: ivrN maps to ~annualized IV)
  // VIX level is approx the 30d IV for SPX in %; for others rough estimate
  const approxIV = ivrN * 0.8 + 10; // rough: IVR 50 → ~50% IV, IVR 0 → ~10%
  const em1d  = spot ? Math.round((spot * (approxIV / 100) * Math.sqrt(1 / 365)) * 10) / 10 : null;
  const em1w  = spot ? Math.round((spot * (approxIV / 100) * Math.sqrt(7 / 365)) * 10) / 10 : null;
  const em30d = spot ? Math.round((spot * (approxIV / 100) * Math.sqrt(30 / 365)) * 10) / 10 : null;

  // Skew approximations — would need actual chains for real values
  const pcIvRatio = pcrLookup(ivrN, trend);
  const pcIvSpread = Math.round((pcIvRatio - 1) * 100) / 1000;

  // PCR Vol — rough estimate
  const pcrVol = pcrLookup(ivrN, trend) * (trend === "up" ? 0.85 : 1.1);

  return {
    score,
    rating,
    direction,
    strategy,
    thesis,
    regime,
    marketStructure,
    em1d,
    em1w,
    em30d,
    trend,
    momentum: mom,
    extension: ext,
    alignment,
    pcIvRatio,
    pcIvSpread,
    pcrVol: Math.round(pcrVol * 100) / 100,
    pcrDelta30d: null,
  };
}

// Rough PCR estimation from IVR and trend
function pcrLookup(ivr: number, trend: "up" | "down" | "sideways"): number {
  const base = 1.0 + (ivr - 50) * 0.005;
  if (trend === "up") return Math.round((base - 0.1) * 100) / 100;
  if (trend === "down") return Math.round((base + 0.1) * 100) / 100;
  return Math.round(base * 100) / 100;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  // 1. Fetch all Yahoo series in parallel
  const [spxS, spyS, qqqS, vixS, vxnS, vvixS] = await Promise.all([
    fetchYahoo("^GSPC"),
    fetchYahoo("SPY"),
    fetchYahoo("QQQ"),
    fetchYahoo("^VIX"),
    fetchYahoo("^VXN").catch(() => ({ closes: [], timestamps: [], last: null, prevClose: null, change: null, pct: null })),
    fetchYahoo("^VVIX").catch(() => ({ closes: [], timestamps: [], last: null, prevClose: null, change: null, pct: null })),
  ]);

  // 2. Fetch live GEX for SPX
  const gexSnap = await fetchGexSnap();

  // 3. Compute IV rank for each (VIX as proxy for SPX/SPY; VXN for QQQ; VVIX for VIX)
  const vixCurrent = vixS.last ?? 20;
  const vxnCurrent = vxnS.last ?? vixCurrent;
  const vvixCurrent = vvixS.last ?? 80;

  const spxIvr = ivRank(vixCurrent, vixS.closes);
  const spyIvr = ivRank(vixCurrent, vixS.closes);
  const qqqIvr = ivRank(vxnCurrent, vxnS.closes.length > 50 ? vxnS.closes : vixS.closes);
  const vixIvr = ivRank(vvixCurrent, vvixS.closes.length > 50 ? vvixS.closes : vixS.closes);

  const spxRv = realizedVol(spxS.closes);
  const spyRv = realizedVol(spyS.closes);
  const qqqRv = realizedVol(qqqS.closes);
  const vixRv = realizedVol(vixS.closes);

  // 4. IV 1d change (VIX 1d change as proxy)
  const vixChange1d = vixS.change;
  const vxnChange1d = vxnS.change;

  // Dummy gex for non-SPX
  const emptyGex: GexSnap = {
    gexFlip: null, gexPer1pct: null, maxGexStrike: null,
    gexExpiringPct: null, gexExpiringDate: null,
    callWall: null, putWall: null, callsOI: null, putsOI: null,
    pcrOI: null, callSpec: null,
  };

  const now = new Date().toISOString();

  const results: TickerAnalytics[] = [
    buildTicker("SPX", spxS, spxIvr, spxRv, vixChange1d, gexSnap, now),
    buildTicker("SPY", spyS, spyIvr, spyRv, vixChange1d, emptyGex, now),
    buildTicker("QQQ", qqqS, qqqIvr, qqqRv, vxnChange1d, emptyGex, now),
    buildTicker("VIX", vixS, vixIvr, vixRv, vvixS.change, emptyGex, now),
  ];

  return NextResponse.json({ tickers: results, updatedAt: now });
}

function buildTicker(
  sym: string,
  series: YSeries,
  ivr: number | null,
  rv20: number | null,
  iv1dChange: number | null,
  gex: GexSnap,
  now: string,
): TickerAnalytics {
  const spot = series.last;
  if (!spot || series.closes.length < 5) {
    return {
      symbol: sym, spot, change1d: series.change, pct1d: series.pct,
      score: 0, rating: "PASS", direction: "NEUTRAL",
      strategy: "PASS", thesis: "Data unavailable",
      regime: "UNKNOWN", marketStructure: "UNKNOWN",
      ivRank: ivr, iv1dChange, callSpec: gex.callSpec,
      em1d: null, em1w: null, em30d: null,
      trend: "sideways", momentum: "neutral", extension: "neutral",
      realizedVol20d: rv20, alignment: "neutral",
      gexFlip: gex.gexFlip, gexPer1pct: gex.gexPer1pct,
      maxGexStrike: gex.maxGexStrike, gexExpiringPct: gex.gexExpiringPct,
      gexExpiringDate: gex.gexExpiringDate,
      pcIvRatio: null, pcIvSpread: null,
      callsOI: gex.callsOI, putsOI: gex.putsOI,
      pcrOI: gex.pcrOI, pcrVol: null, pcrDelta30d: null,
      updatedAt: now,
    };
  }

  const computed = computeAnalytics(sym, spot, series.closes, ivr, rv20, iv1dChange, gex);

  return {
    symbol: sym,
    spot,
    change1d: series.change,
    pct1d: series.pct,
    ivRank: ivr,
    iv1dChange,
    realizedVol20d: rv20,
    callSpec: gex.callSpec,
    gexFlip: gex.gexFlip,
    gexPer1pct: gex.gexPer1pct,
    maxGexStrike: gex.maxGexStrike,
    gexExpiringPct: gex.gexExpiringPct,
    gexExpiringDate: gex.gexExpiringDate,
    callsOI: gex.callsOI,
    putsOI: gex.putsOI,
    pcrOI: gex.pcrOI,
    ...computed,
    updatedAt: now,
  };
}
