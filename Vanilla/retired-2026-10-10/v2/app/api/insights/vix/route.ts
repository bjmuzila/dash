import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/insights/vix — VIX / volatility panel data for the Insights VIX tab.
 *
 * Sourced from the Yahoo Finance v8 chart endpoint (same as /api/quotes-batch).
 * Returns:
 *   vix_spot      — current 30D VIX (^VIX)
 *   vix_1d        — 1-day VIX (^VIX1D) when available, else a near-term proxy
 *   realized_10d  — annualized 10D realized vol of SPX (%)
 *   iv_rank       — VIX rank within trailing 1Y range (%)
 *   iv_percentile — % of trailing 1Y days with VIX below current (%)
 */

interface Series {
  closes: number[];
  last: number | null;
}

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

export async function GET() {
  const [vix, vix1d, spx] = await Promise.all([
    fetchSeries("^VIX", "1y"),
    fetchSeries("^VIX1D", "1mo"),
    fetchSeries("^GSPC", "1mo"),
  ]);

  const vixSpot = vix.last;
  // Prefer true VIX1D; fall back to VIX spot as a neutral proxy when unavailable.
  const vix1dVal = vix1d.last ?? vixSpot;
  const realized10d = realizedVol(spx.closes, 10);

  // IV rank/percentile from trailing 1Y VIX history.
  let ivRank: number | null = null;
  let ivPercentile: number | null = null;
  if (vixSpot != null && vix.closes.length > 20) {
    const hist = vix.closes;
    const min = Math.min(...hist);
    const max = Math.max(...hist);
    if (max > min) ivRank = ((vixSpot - min) / (max - min)) * 100;
    const below = hist.filter((v) => v < vixSpot).length;
    ivPercentile = (below / hist.length) * 100;
  }

  const round = (v: number | null, d = 2) =>
    v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;

  return NextResponse.json(
    {
      data: {
        vix_spot: round(vixSpot),
        vix_1d: round(vix1dVal),
        realized_10d: round(realized10d),
        iv_rank: round(ivRank, 1),
        iv_percentile: round(ivPercentile, 1),
        source: "yahoo",
      },
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
