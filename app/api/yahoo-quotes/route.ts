import { NextRequest, NextResponse } from "next/server";

// Yahoo Finance v8 chart endpoint — no crumb required, one request per symbol
// We fetch in parallel then combine

async function fetchOne(sym: string): Promise<{ price: number | null; change: number | null; pct: number | null }> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://finance.yahoo.com",
        "Referer": "https://finance.yahoo.com/",
      },
      // Next.js fetch cache — revalidate every 60s
      next: { revalidate: 60 },
    });

    if (!res.ok) return { price: null, change: null, pct: null };

    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return { price: null, change: null, pct: null };

    const price     = meta.regularMarketPrice ?? null;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const change    = price != null && prevClose != null ? price - prevClose : null;
    const pct       = change != null && prevClose ? (change / prevClose) * 100 : null;

    return { price, change, pct };
  } catch {
    return { price: null, change: null, pct: null };
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbols = searchParams.get("symbols") || "";
  if (!symbols) return NextResponse.json({ error: "symbols required" }, { status: 400 });

  const syms = symbols.split(",").map(s => s.trim()).filter(Boolean);

  // Fetch all in parallel
  const results = await Promise.all(syms.map(sym => fetchOne(sym).then(q => ({ sym, q }))));

  const quotes: Record<string, { price: number | null; change: number | null; pct: number | null }> = {};
  results.forEach(({ sym, q }) => { quotes[sym] = q; });

  return NextResponse.json(quotes, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" },
  });
}
