import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Yahoo Finance predefined screener — "day_gainers" returns premarket gainers
// when queried before market open; during RTH it reflects session gainers.
// No API key required.

export interface Mover {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  pct: number | null;
  preMarketPrice: number | null;
  preMarketPct: number | null;
  volume: number | null;
}

export async function GET() {
  try {
    const url =
      "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved" +
      "?scrIds=day_gainers&count=25&fields=symbol,shortName,regularMarketPrice," +
      "regularMarketChange,regularMarketChangePercent,preMarketPrice," +
      "preMarketChangePercent,regularMarketVolume";

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Origin: "https://finance.yahoo.com",
        Referer: "https://finance.yahoo.com/",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Yahoo screener returned ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const quotes: unknown[] =
      data?.finance?.result?.[0]?.quotes ??
      data?.finance?.result?.[0]?.results ??
      [];

    // Filter out ETFs/funds that clutter the list, keep equities
    const filtered = (quotes as Record<string, unknown>[])
      .filter((q) => {
        const qt = String(q.quoteType ?? "");
        return qt === "EQUITY" || qt === "" || qt === "ETF";
      })
      .slice(0, 10);

    const movers: Mover[] = filtered.map((q) => ({
      symbol: String(q.symbol ?? ""),
      name: String(q.shortName ?? q.longName ?? q.symbol ?? ""),
      price: typeof q.regularMarketPrice === "number" ? q.regularMarketPrice : null,
      change: typeof q.regularMarketChange === "number" ? q.regularMarketChange : null,
      pct:
        typeof q.regularMarketChangePercent === "number"
          ? q.regularMarketChangePercent
          : null,
      preMarketPrice:
        typeof q.preMarketPrice === "number" ? q.preMarketPrice : null,
      preMarketPct:
        typeof q.preMarketChangePercent === "number"
          ? q.preMarketChangePercent
          : null,
      volume:
        typeof q.regularMarketVolume === "number" ? q.regularMarketVolume : null,
    }));

    return NextResponse.json(
      { movers, updatedAt: Date.now() },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Fetch failed", detail: String(err) },
      { status: 500 }
    );
  }
}
