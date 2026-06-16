import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Yahoo Finance v8 chart endpoint — no crumb required, one request per symbol
// We fetch in parallel then combine

type YahooQuote = { price: number | null; change: number | null; pct: number | null; time: number | null };

async function fetchOne(sym: string): Promise<YahooQuote> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d&includePrePost=true&_=${Date.now()}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Origin": "https://finance.yahoo.com",
        "Referer": "https://finance.yahoo.com/",
      },
      // Next.js fetch cache — revalidate every 60s
      cache: "no-store",
    });

    if (!res.ok) return { price: null, change: null, pct: null, time: null };

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) return { price: null, change: null, pct: null, time: null };

    const closes = result?.indicators?.quote?.[0]?.close;
    const lastClose = Array.isArray(closes) ? [...closes].reverse().find((v) => typeof v === "number" && Number.isFinite(v)) : null;
    const timestamps = result?.timestamp;
    const lastTime = Array.isArray(timestamps) ? [...timestamps].reverse().find((v) => typeof v === "number" && Number.isFinite(v)) : null;
    const price     = meta.regularMarketPrice ?? lastClose ?? null;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const change    = price != null && prevClose != null ? price - prevClose : null;
    const pct       = change != null && prevClose ? (change / prevClose) * 100 : null;
    const time      = meta.regularMarketTime ?? lastTime ?? null;

    return { price, change, pct, time };
  } catch {
    return { price: null, change: null, pct: null, time: null };
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbols = searchParams.get("symbols") || "";
  if (!symbols) return NextResponse.json({ error: "symbols required" }, { status: 400 });

  const syms = symbols.split(",").map(s => s.trim()).filter(Boolean);

  // Fetch all in parallel
  const results = await Promise.all(syms.map(sym => fetchOne(sym).then(q => ({ sym, q }))));

  const quotes: Record<string, YahooQuote> = {};
  results.forEach(({ sym, q }) => { quotes[sym] = q; });

  return NextResponse.json(quotes, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
  });
}
