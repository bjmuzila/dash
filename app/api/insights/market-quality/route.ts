import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/insights/market-quality — Market Quality Terminal data.
 *
 * Computes a 0-100 "Global Market Score" from five weighted pillars:
 *   Volatility (25%), Trend (20%), Breadth (20%), Momentum (25%), Macro (10%).
 *
 * All inputs come from the Yahoo Finance v8 chart endpoint (same source as
 * /api/quotes-batch). No Google Sheets / external credentials required.
 *
 * Returns the shape the MarketQualityTerminal component consumes.
 */

const SECTORS = ["XLE", "XLF", "XLK", "XLV", "XLY", "XLP", "XLI", "XLU", "XLB", "XLRE", "XLC"] as const;
// Symbols used to derive macro pillar.
const MACRO = { bonds: "TLT", dollar: "UUP" } as const;

interface Series {
  closes: number[];      // valid daily closes oldest→newest
  last: number | null;
  prevClose: number | null;
  pct: number | null;    // day % change
}

function yahooUrl(sym: string): string {
  return `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=6mo&includePrePost=false&_=${Date.now()}`;
}

async function fetchSeries(yahooSym: string): Promise<Series> {
  const empty: Series = { closes: [], last: null, prevClose: null, pct: null };
  try {
    const res = await fetch(yahooUrl(yahooSym), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: "https://finance.yahoo.com",
        Referer: "https://finance.yahoo.com/",
      },
      cache: "no-store",
    });
    if (!res.ok) return empty;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) return empty;
    const raw = result?.indicators?.quote?.[0]?.close;
    const closes: number[] = Array.isArray(raw)
      ? raw.filter((v: unknown): v is number => typeof v === "number" && Number.isFinite(v))
      : [];
    const last = meta.regularMarketPrice ?? (closes.length ? closes[closes.length - 1] : null);
    const prevClose =
      meta.regularMarketPreviousClose ??
      meta.previousClose ??
      (closes.length >= 2 ? closes[closes.length - 2] : null) ??
      meta.chartPreviousClose ??
      null;
    const pct = last != null && prevClose ? ((last - prevClose) / prevClose) * 100 : null;
    return { closes, last, prevClose, pct };
  } catch {
    return empty;
  }
}

// ── Indicators ────────────────────────────────────────────────────────────────

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  const slice = values.slice(-(period + 1));
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Annualized realized vol (%) from last `period` daily log returns. */
function realizedVol(values: number[], period = 10): number | null {
  if (values.length < period + 1) return null;
  const slice = values.slice(-(period + 1));
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) rets.push(Math.log(slice[i] / slice[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function pctReturn(values: number[], days: number): number | null {
  if (values.length < days + 1) return null;
  const a = values[values.length - 1 - days];
  const b = values[values.length - 1];
  if (!a) return null;
  return ((b - a) / a) * 100;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const round = (v: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

// ── Pillar scoring ──────────────────────────────────────────────────────────

/** Higher = healthier (lower VIX). Maps VIX 12→~92, 20→~60, 30→~20, 40→0. */
function scoreVolatility(vix: number | null): number {
  if (vix == null) return 50;
  return clamp(round(100 - (vix - 11) * 3.2));
}

/** Trend: SPX vs its own moving averages + slope. */
function scoreTrend(spx: Series): { score: number; bullish: boolean; regime: string } {
  const c = spx.closes;
  const last = spx.last ?? (c.length ? c[c.length - 1] : null);
  const sma20 = sma(c, 20);
  const sma50 = sma(c, 50);
  if (last == null || sma20 == null || sma50 == null) return { score: 50, bullish: false, regime: "Neutral" };
  let s = 50;
  s += last > sma20 ? 17 : -17;
  s += last > sma50 ? 17 : -17;
  s += sma20 > sma50 ? 16 : -16;
  const score = clamp(round(s));
  const bullish = score >= 55;
  return { score, bullish, regime: bullish ? "Bullish" : score <= 45 ? "Bearish" : "Neutral" };
}

/** Breadth: how many sectors trade above their 50-day SMA. */
function scoreBreadth(sectorSeries: Record<string, Series>): { score: number; above: number; total: number } {
  let above = 0;
  let total = 0;
  for (const sym of SECTORS) {
    const ser = sectorSeries[sym];
    const ma = ser ? sma(ser.closes, 50) : null;
    const last = ser?.last ?? null;
    if (ma == null || last == null) continue;
    total++;
    if (last > ma) above++;
  }
  if (total === 0) return { score: 50, above: 0, total: 0 };
  return { score: clamp(round((above / total) * 100)), above, total };
}

/** Momentum: SPX RSI-14 centered + 5d return tilt. */
function scoreMomentum(spx: Series): { score: number; rsi: number | null; ret5: number | null } {
  const r = rsi(spx.closes, 14);
  const ret5 = pctReturn(spx.closes, 5);
  if (r == null) return { score: 50, rsi: null, ret5 };
  // RSI 50 → 50 score; scale ±50 RSI points to ±45 score, then nudge by 5d return.
  let s = 50 + (r - 50) * 0.9;
  if (ret5 != null) s += clamp(ret5 * 4, -10, 10);
  return { score: clamp(round(s)), rsi: r, ret5 };
}

/** Macro: bonds (TLT) + dollar (UUP) day moves. Risk-on = bonds soft, dollar soft. */
function scoreMacro(bonds: Series, dollar: Series): {
  score: number; bondPct: number | null; dollarPct: number | null;
} {
  const bondPct = bonds.pct;
  const dollarPct = dollar.pct;
  let s = 50;
  if (bondPct != null) s += clamp(-bondPct * 8, -20, 20);   // falling bonds = risk-on
  if (dollarPct != null) s += clamp(-dollarPct * 12, -20, 20); // soft dollar = risk-on
  return { score: clamp(round(s)), bondPct, dollarPct };
}

// ── Assessment text (rule-based, no LLM) ───────────────────────────────────────

function buildAssessment(p: {
  global: number; vol: number; trend: number; breadth: number; momentum: number; macro: number;
  vix: number | null; vixFalling: boolean; regime: string; above: number; total: number;
  rsi: number | null; topSector: { sym: string; pct: number } | null;
  bottomSector: { sym: string; pct: number } | null; bondPct: number | null; dollarPct: number | null;
}): string {
  const parts: string[] = [];
  parts.push(`The current environment scores ${p.global}/100, ${p.global >= 60 ? "above" : "near"} the 40/100 threshold for active sizing.`);
  if (p.vix != null) parts.push(`VIX at ${p.vix.toFixed(1)} (${p.vix < 15 ? "low" : p.vix < 22 ? "moderate" : "elevated"}, ${p.vixFalling ? "falling" : "rising"} — ${p.vix < 22 ? "constructive" : "cautionary"}).`);
  parts.push(`Market regime: ${p.regime}.`);
  parts.push(`Breadth is ${p.breadth >= 60 ? "broad" : p.breadth >= 40 ? "moderate" : "narrow"} with ${p.above}/${p.total} sectors above their 50d SMA.`);
  if (p.rsi != null) parts.push(`RSI-14 at ${p.rsi.toFixed(0)} signals ${p.rsi >= 70 ? "overbought momentum" : p.rsi >= 55 ? "momentum strength" : p.rsi <= 30 ? "oversold conditions" : p.rsi <= 45 ? "momentum weakness" : "neutral momentum"}.`);
  if (p.topSector && p.bottomSector) parts.push(`Sector rotation: ${p.topSector.sym} ${p.topSector.pct >= 0 ? "+" : ""}${p.topSector.pct.toFixed(1)}% leading, ${p.bottomSector.sym} ${p.bottomSector.pct >= 0 ? "+" : ""}${p.bottomSector.pct.toFixed(1)}% lagging.`);
  if (p.bondPct != null) parts.push(`Bonds ${p.bondPct >= 0 ? "bid" : "soft"} ${p.bondPct >= 0 ? "↑" : "↓"}.`);
  if (p.dollarPct != null) parts.push(`Dollar ${p.dollarPct >= 0 ? "strengthening ↑" : "softening ↓"}.`);
  return parts.join(" ");
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function GET() {
  // Fetch everything in parallel.
  const symbolList = ["^VIX", "^GSPC", MACRO.bonds, MACRO.dollar, ...SECTORS];
  const fetched = await Promise.all(symbolList.map((s) => fetchSeries(s).then((r) => [s, r] as const)));
  const map = new Map(fetched);

  const vixSer = map.get("^VIX")!;
  const spxSer = map.get("^GSPC")!;
  const bondsSer = map.get(MACRO.bonds)!;
  const dollarSer = map.get(MACRO.dollar)!;

  const sectorSeries: Record<string, Series> = {};
  for (const sym of SECTORS) sectorSeries[sym] = map.get(sym)!;

  // Pillars
  const vix = vixSer.last;
  const vixFalling = (vixSer.pct ?? 0) <= 0;
  const volScore = scoreVolatility(vix);
  const trend = scoreTrend(spxSer);
  const breadth = scoreBreadth(sectorSeries);
  const momentum = scoreMomentum(spxSer);
  const macro = scoreMacro(bondsSer, dollarSer);

  const weights = { volatility: 0.25, trend: 0.2, breadth: 0.2, momentum: 0.25, macro: 0.1 };
  const global = round(
    volScore * weights.volatility +
    trend.score * weights.trend +
    breadth.score * weights.breadth +
    momentum.score * weights.momentum +
    macro.score * weights.macro
  );

  // Sector 5-day performance, sorted desc.
  const sectorPerf = SECTORS.map((sym) => {
    const ser = sectorSeries[sym];
    const ret5 = pctReturn(ser.closes, 5);
    return { sym, pct: ret5 != null ? round(ret5, 2) : 0 };
  }).sort((a, b) => b.pct - a.pct);

  const topSector = sectorPerf.length ? sectorPerf[0] : null;
  const bottomSector = sectorPerf.length ? sectorPerf[sectorPerf.length - 1] : null;

  const sizingLabel = global >= 70 ? "FULL" : global >= 50 ? "REDUCED" : global >= 35 ? "REDUCED" : "MINIMAL";
  const sizingNote = global >= 70 ? "Full position sizing" : global >= 50 ? "Half position sizing" : global >= 35 ? "Reduced sizing — wait for confirmation" : "Minimal sizing — defensive";
  const banner = global >= 70 ? "CLEAR" : global >= 50 ? "CAUTION" : global >= 35 ? "CAUTION" : "DANGER";

  const assessment = buildAssessment({
    global, vol: volScore, trend: trend.score, breadth: breadth.score,
    momentum: momentum.score, macro: macro.score,
    vix, vixFalling, regime: trend.regime, above: breadth.above, total: breadth.total,
    rsi: momentum.rsi, topSector, bottomSector,
    bondPct: macro.bondPct, dollarPct: macro.dollarPct,
  });

  const payload = {
    asOf: new Date().toISOString(),
    global,
    banner,
    sizingLabel,
    sizingNote,
    source: "yahoo",
    weights,
    pillars: {
      volatility: {
        score: volScore,
        vix: vix != null ? round(vix, 2) : null,
        vixFalling,
        realized10d: realizedVol(spxSer.closes, 10),
      },
      trend: {
        score: trend.score,
        regime: trend.regime,
        bullish: trend.bullish,
        spx: spxSer.last != null ? round(spxSer.last, 2) : null,
        sma20: sma(spxSer.closes, 20),
        sma50: sma(spxSer.closes, 50),
      },
      breadth: {
        score: breadth.score,
        above: breadth.above,
        total: breadth.total,
      },
      momentum: {
        score: momentum.score,
        rsi: momentum.rsi != null ? round(momentum.rsi, 1) : null,
        ret5: momentum.ret5 != null ? round(momentum.ret5, 2) : null,
      },
      macro: {
        score: macro.score,
        bondPct: macro.bondPct != null ? round(macro.bondPct, 2) : null,
        dollarPct: macro.dollarPct != null ? round(macro.dollarPct, 2) : null,
        bondLast: bondsSer.last != null ? round(bondsSer.last, 2) : null,
      },
    },
    sectors: sectorPerf,
    assessment,
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
  });
}
