import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/scanner/market-quality — "Market Quality Terminal" data for the Scanner
 * page's Market Quality tab. Rebuilt scoring engine (the original
 * components/insights/MarketQualityTerminal.tsx + Insights page were removed
 * 2026-06-24). Sourced entirely from Yahoo Finance daily closes (same
 * query2.finance.yahoo.com/v8/finance/chart pattern as /api/insights/vix and
 * /api/yahoo-quotes) — no dependency on the internal Theta/dxLink feed.
 *
 * Five pillars, weighted into one Global Market Score (0-100):
 *   Volatility  25%  — VIX level + 5D trend + 1Y percentile rank
 *   Trend       20%  — SPY vs 20/50/200D SMA, QQQ vs 50D SMA, RSI-14
 *   Breadth     20%  — # of 11 SPDR sectors trading above their 50D SMA
 *   Momentum    25%  — # of sectors positive over 5D + SPY's own 5D return
 *   Macro       10%  — 20D bond (TLT) trend + 20D dollar (UUP) trend
 */

const SECTORS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLC", "XLU", "XLRE", "XLY", "XLB", "XLP"] as const;
const SECTOR_NAMES: Record<string, string> = {
  XLK: "Technology", XLF: "Financials", XLE: "Energy", XLV: "Health Care",
  XLI: "Industrials", XLC: "Comm Services", XLU: "Utilities", XLRE: "Real Estate",
  XLY: "Cons. Discretionary", XLB: "Materials", XLP: "Cons. Staples",
};

interface Series { closes: number[]; last: number | null }

function yahooUrl(sym: string, range: string): string {
  return `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}&includePrePost=false&_=${Date.now()}`;
}

async function fetchSeries(sym: string, range = "1y"): Promise<Series> {
  const empty: Series = { closes: [], last: null };
  try {
    const res = await fetch(yahooUrl(sym, range), {
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
    return { closes, last };
  } catch {
    return empty;
  }
}

const sma = (closes: number[], period: number): number | null => {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
};

/** % change from N trading days ago to the latest close. */
const pctChangeN = (closes: number[], n: number): number | null => {
  if (closes.length < n + 1) return null;
  const then = closes[closes.length - 1 - n];
  const now = closes[closes.length - 1];
  if (!then) return null;
  return ((now - then) / then) * 100;
};

/** Wilder's RSI-14 from a daily close series. */
function rsi14(closes: number[]): number | null {
  const period = 14;
  if (closes.length < period + 1) return null;
  const slice = closes.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export async function GET() {
  const symbols = ["SPY", "QQQ", "^VIX", "TLT", "UUP", ...SECTORS];
  const seriesList = await Promise.all(symbols.map((s) => fetchSeries(s, "1y")));
  const bySym: Record<string, Series> = {};
  symbols.forEach((s, i) => { bySym[s] = seriesList[i]; });

  const spy = bySym["SPY"], qqq = bySym["QQQ"], vix = bySym["^VIX"], tlt = bySym["TLT"], uup = bySym["UUP"];

  const haveCore = spy.last != null && vix.last != null;
  if (!haveCore) {
    return NextResponse.json({ error: "quote fetch failed" }, { status: 503 });
  }

  // ── VOLATILITY (25%) ──────────────────────────────────────────────────────
  const vixSpot = vix.last as number;
  const vix5dChg = pctChangeN(vix.closes, 5) ?? 0;
  let ivPercentile: number | null = null;
  if (vix.closes.length > 20) {
    const hist = vix.closes;
    const below = hist.filter((v) => v < vixSpot).length;
    ivPercentile = (below / hist.length) * 100;
  }
  const levelScore = clamp(100 - (vixSpot - 10) * 4, 0, 100);
  const trendScoreVix = clamp(50 - vix5dChg * 3, 0, 100);
  const pctileScore = clamp(100 - (ivPercentile ?? 50), 0, 100);
  const volatilityScore = Math.round(0.4 * levelScore + 0.3 * trendScoreVix + 0.3 * pctileScore);
  const vixTrendLabel = vix5dChg > 3 ? "Rising" : vix5dChg < -3 ? "Falling" : "Flat";

  // ── TREND (20%) ───────────────────────────────────────────────────────────
  const spySma20 = sma(spy.closes, 20), spySma50 = sma(spy.closes, 50), spySma200 = sma(spy.closes, 200);
  const qqqSma50 = sma(qqq.closes, 50);
  const spyLast = spy.last as number;
  const qqqLast = qqq.last;
  const spy20Pts = spySma20 != null ? (spyLast > spySma20 ? 10 : -10) : 0;
  const spy50Pts = spySma50 != null ? (spyLast > spySma50 ? 15 : -15) : 0;
  const spy200Pts = spySma200 != null ? (spyLast > spySma200 ? 20 : -20) : 0;
  const qqq50Pts = qqqSma50 != null && qqqLast != null ? (qqqLast > qqqSma50 ? 15 : -15) : 0;
  const rsi = rsi14(spy.closes);
  const rsiPts = rsi != null ? clamp((rsi - 50) * 1.0, -20, 20) : 0;
  const trendScore = Math.round(clamp(50 + spy20Pts + spy50Pts + spy200Pts + qqq50Pts + rsiPts, 0, 100));
  const spyBull50 = spySma50 != null && spyLast > spySma50;
  const spyBull200 = spySma200 != null && spyLast > spySma200;
  const trendRegime = spyBull200 && spyBull50 ? "Bullish" : !spyBull200 && !spyBull50 ? "Bearish" : "Mixed";

  // ── BREADTH (20%) — % of 11 sectors above their 50D SMA ─────────────────
  const sectorSeries = SECTORS.map((sym) => ({ sym, s: bySym[sym] }));
  const sectorBreadth = sectorSeries.map(({ sym, s }) => {
    const sma50 = sma(s.closes, 50);
    const above = sma50 != null && s.last != null ? s.last > sma50 : null;
    return { sym, above };
  });
  const validBreadth = sectorBreadth.filter((r) => r.above != null);
  const aboveCount = validBreadth.filter((r) => r.above).length;
  const breadthScore = validBreadth.length ? Math.round((aboveCount / validBreadth.length) * 100) : 50;
  const participationLabel = validBreadth.length === 0 ? "N/A" : aboveCount >= validBreadth.length * 0.75 ? "Broad" : aboveCount <= validBreadth.length * 0.25 ? "Narrow" : "Mixed";

  // ── MOMENTUM (25%) — sector 5D breadth + SPY 5D return ───────────────────
  const sector5d = sectorSeries.map(({ sym, s }) => ({ sym, chg5d: pctChangeN(s.closes, 5) }));
  const validMom = sector5d.filter((r) => r.chg5d != null) as { sym: string; chg5d: number }[];
  const positiveCount = validMom.filter((r) => r.chg5d > 0).length;
  const ratioScore = validMom.length ? (positiveCount / validMom.length) * 100 : 50;
  const spy5dChg = pctChangeN(spy.closes, 5) ?? 0;
  const spy5dScore = clamp(50 + spy5dChg * 10, 0, 100);
  const momentumScore = Math.round(0.5 * ratioScore + 0.5 * spy5dScore);
  const sortedMom = [...validMom].sort((a, b) => b.chg5d - a.chg5d);
  const leader = sortedMom[0] ?? null;
  const laggard = sortedMom[sortedMom.length - 1] ?? null;
  const spread = leader && laggard ? leader.chg5d - laggard.chg5d : null;
  const rotationLabel = spread == null ? "N/A" : spread < 1.5 ? "Uniform" : spread < 4 ? "Rotating" : "Sharp Rotation";

  // ── MACRO (10%) — bonds + dollar 20D trend ───────────────────────────────
  const tlt20d = pctChangeN(tlt.closes, 20) ?? 0;
  const uup20d = pctChangeN(uup.closes, 20) ?? 0;
  const uup5d = pctChangeN(uup.closes, 5);
  const macroScore = Math.round(clamp(50 + tlt20d * 5 - uup20d * 5, 0, 100));
  const bondTrendLabel = tlt20d > 0.5 ? "Rising" : tlt20d < -0.5 ? "Falling" : "Flat";
  const dollarTrendLabel = uup20d > 0.5 ? "Strengthening" : uup20d < -0.5 ? "Weakening" : "Flat";

  // ── GLOBAL SCORE + WEIGHTS ────────────────────────────────────────────────
  const weights = { volatility: 0.25, trend: 0.20, breadth: 0.20, momentum: 0.25, macro: 0.10 };
  const weighted = {
    volatility: volatilityScore * weights.volatility,
    trend: trendScore * weights.trend,
    breadth: breadthScore * weights.breadth,
    momentum: momentumScore * weights.momentum,
    macro: macroScore * weights.macro,
  };
  const globalScoreRaw = weighted.volatility + weighted.trend + weighted.breadth + weighted.momentum + weighted.macro;
  const globalScore = Math.round(globalScoreRaw);

  let banner: { label: string; tone: "green" | "cyan" | "orange" | "red"; sizing: string };
  if (globalScore >= 75) banner = { label: "FAVORABLE", tone: "green", sizing: "Full position sizing" };
  else if (globalScore >= 60) banner = { label: "CONSTRUCTIVE", tone: "cyan", sizing: "Normal position sizing" };
  else if (globalScore >= 40) banner = { label: "CAUTION", tone: "orange", sizing: "Half position sizing" };
  else if (globalScore >= 25) banner = { label: "DEFENSIVE", tone: "orange", sizing: "Quarter position sizing" };
  else banner = { label: "RISK OFF", tone: "red", sizing: "Minimal / no new sizing" };

  const sectorBars = sector5d
    .map((r) => ({ symbol: r.sym, name: SECTOR_NAMES[r.sym], chg5d: r.chg5d != null ? round1(r.chg5d) : null }))
    .filter((r) => r.chg5d != null)
    .sort((a, b) => (b.chg5d as number) - (a.chg5d as number));

  const assessment = [
    `The current environment scores ${globalScore}/100${globalScore >= 35 && globalScore < 45 ? ", near the 40-point threshold for active sizing" : ""}.`,
    `VIX at ${round1(vixSpot)}${ivPercentile != null ? ` (${Math.round(ivPercentile)}th percentile — ${vixTrendLabel.toLowerCase()})` : ""}, ${volatilityScore >= 60 ? "constructive" : volatilityScore >= 40 ? "mixed" : "concerning"}.`,
    `Market regime: ${trendRegime}.`,
    `Breadth is ${participationLabel.toLowerCase()} with ${aboveCount}/${validBreadth.length} sectors above their 50d SMA.`,
    rsi != null ? `RSI-14 at ${round1(rsi)} signals ${rsi >= 70 ? "overbought momentum" : rsi <= 30 ? "oversold conditions" : "moderate momentum"}.` : "",
    leader && laggard ? `Sector rotation is ${rotationLabel} with ${leader.sym} +${round1(leader.chg5d)}% leading and ${laggard.sym} ${round1(laggard.chg5d)}% lagging.` : "",
    `Bonds ${bondTrendLabel.toLowerCase()}, Dollar ${dollarTrendLabel.toLowerCase()}${uup5d != null ? ` (${uup5d >= 0 ? "+" : ""}${round1(uup5d)}% 5D)` : ""}.`,
  ].filter(Boolean).join(" ");

  return NextResponse.json(
    {
      data: {
        asOf: new Date().toISOString(),
        globalScore,
        banner,
        pillars: {
          volatility: { score: volatilityScore, weight: weights.volatility, weighted: round1(weighted.volatility),
            vixLevel: round1(vixSpot), vixTrend: vixTrendLabel, ivPercentile: ivPercentile != null ? Math.round(ivPercentile) : null,
            putCall: null },
          trend: { score: trendScore, weight: weights.trend, weighted: round1(weighted.trend),
            regime: trendRegime, spyVs20: spySma20 != null ? spyLast > spySma20 : null,
            spyVs50: spySma50 != null ? spyLast > spySma50 : null, spyVs200: spySma200 != null ? spyLast > spySma200 : null,
            qqqVs50: qqqSma50 != null && qqqLast != null ? qqqLast > qqqSma50 : null, rsi14: rsi != null ? round1(rsi) : null },
          breadth: { score: breadthScore, weight: weights.breadth, weighted: round1(weighted.breadth),
            aboveCount, total: validBreadth.length, participation: participationLabel,
            sectors: sectorBreadth.map((r) => ({ symbol: r.sym, above: r.above })) },
          momentum: { score: momentumScore, weight: weights.momentum, weighted: round1(weighted.momentum),
            positiveCount, total: validMom.length, spread: spread != null ? round1(spread) : null,
            leader: leader ? { symbol: leader.sym, chg5d: round1(leader.chg5d) } : null,
            laggard: laggard ? { symbol: laggard.sym, chg5d: round1(laggard.chg5d) } : null,
            rotation: rotationLabel },
          macro: { score: macroScore, weight: weights.macro, weighted: round1(weighted.macro),
            tltLast: tlt.last != null ? round1(tlt.last) : null, tltTrend: bondTrendLabel,
            uupTrend: dollarTrendLabel, uup5d: uup5d != null ? round1(uup5d) : null },
        },
        sectorBars,
        assessment,
        source: "yahoo",
      },
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
