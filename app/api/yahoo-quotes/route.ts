import { NextRequest, NextResponse } from "next/server";

// Yahoo Finance v8 quote endpoint — no auth required, delayed data
const YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/spark";
const QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbols = searchParams.get("symbols") || "";
  if (!symbols) return NextResponse.json({ error: "symbols required" }, { status: 400 });

  const syms = symbols.split(",").map(s => s.trim()).filter(Boolean);

  try {
    const url = `${QUOTE_URL}?symbols=${encodeURIComponent(syms.join(","))}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketPreviousClose,shortName`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      next: { revalidate: 60 }, // cache 60s server-side
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Yahoo returned ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    const results: Array<Record<string, unknown>> = data?.quoteResponse?.result ?? [];

    const quotes: Record<string, { price: number | null; change: number | null; pct: number | null }> = {};
    results.forEach((r) => {
      const sym = String(r.symbol ?? "");
      quotes[sym] = {
        price:  r.regularMarketPrice  != null ? Number(r.regularMarketPrice)  : null,
        change: r.regularMarketChange != null ? Number(r.regularMarketChange) : null,
        pct:    r.regularMarketChangePercent != null ? Number(r.regularMarketChangePercent) : null,
      };
    });

    return NextResponse.json(quotes, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
