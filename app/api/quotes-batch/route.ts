import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/quotes-batch — batch day-change quotes for the sidebar + toolbar.
 *
 * Backed by Yahoo Finance v8 chart endpoint (no crumb required). Maps the
 * dashboard's internal symbols (SPX, /ESU26, VIX, equities) to Yahoo tickers,
 * fetches in parallel, and returns the shape the existing consumers expect:
 *   { data: { items: [{ symbol, last, "prev-close", "percent-change", change }] } }
 */

// Map dashboard symbols → Yahoo tickers. Futures/indices need special tickers.
function toYahoo(sym: string): string {
  const s = sym.trim().toUpperCase();
  if (s === "SPX" || s === "$SPX") return "^GSPC";
  if (s === "VIX") return "^VIX";
  if (s === "NDX") return "^NDX";
  if (s === "RUT") return "^RUT";
  if (s.startsWith("/ES")) return "ES=F";
  if (s.startsWith("/NQ")) return "NQ=F";
  if (s.startsWith("/")) return s.slice(1) + "=F";
  return s; // equities/ETFs pass through (SPY, QQQ, NVDA, …)
}

type YahooQuote = { price: number | null; prevClose: number | null; change: number | null; pct: number | null };

async function fetchOne(yahooSym: string): Promise<YahooQuote> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=5d&includePrePost=true&_=${Date.now()}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: "https://finance.yahoo.com",
        Referer: "https://finance.yahoo.com/",
      },
      cache: "no-store",
    });
    if (!res.ok) return { price: null, prevClose: null, change: null, pct: null };
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) return { price: null, prevClose: null, change: null, pct: null };

    const closes = result?.indicators?.quote?.[0]?.close;
    // Valid daily closes, oldest→newest. The last is today's (or latest) close;
    // the one before it is the true prior-session close.
    const validCloses = Array.isArray(closes)
      ? closes.filter((v) => typeof v === "number" && Number.isFinite(v))
      : [];
    const lastClose = validCloses.length ? validCloses[validCloses.length - 1] : null;
    const seriesPrevClose = validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null;

    const price = meta.regularMarketPrice ?? lastClose ?? null;
    // IMPORTANT: meta.chartPreviousClose is the close BEFORE the chart's range
    // window (≈a week ago for range=5d) — NOT yesterday. Using it inflates the
    // day %. Prefer Yahoo's actual prior-session close, then the second-to-last
    // candle, and only fall back to chartPreviousClose as a last resort.
    // For the day %, the live price (regularMarketPrice) must be compared to the
    // SAME session's prior close. With includePrePost the second-to-last daily
    // candle is the true prior-session close and is consistent with the live
    // price; meta.regularMarketPreviousClose can lag a session for futures and
    // inflates the % — only fall back to it when the candle series is missing.
    const prevClose =
      seriesPrevClose ??
      meta.regularMarketPreviousClose ??
      meta.previousClose ??
      meta.chartPreviousClose ??
      null;
    const change = price != null && prevClose != null ? price - prevClose : null;
    const pct = change != null && prevClose ? (change / prevClose) * 100 : null;
    return { price, prevClose, change, pct };
  } catch {
    return { price: null, prevClose: null, change: null, pct: null };
  }
}

export async function GET(req: NextRequest) {
  const symbols = new URL(req.url).searchParams.get("symbols") || "";
  if (!symbols) return NextResponse.json({ data: { items: [] } });

  const syms = symbols.split(",").map((s) => s.trim()).filter(Boolean);
  // Dedupe Yahoo tickers so we don't fetch /ESU26 and /ES:XCME twice.
  const pairs = syms.map((sym) => ({ sym, yahoo: toYahoo(sym) }));
  const uniqueYahoo = [...new Set(pairs.map((p) => p.yahoo))];
  const fetched = await Promise.all(uniqueYahoo.map((y) => fetchOne(y).then((q) => [y, q] as const)));
  const byYahoo = new Map(fetched);

  const items = pairs.map(({ sym, yahoo }) => {
    const q = byYahoo.get(yahoo) ?? { price: null, prevClose: null, change: null, pct: null };
    return {
      symbol: sym,
      last: q.price,
      "prev-close": q.prevClose,
      change: q.change,
      "percent-change": q.pct,
    };
  });

  return NextResponse.json(
    { data: { items } },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
