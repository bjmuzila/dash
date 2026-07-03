import { NextResponse } from "next/server";
import { proxyBase } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Top 5 up / top 5 down across the trading watchlist, ranked by change from the
// prior regular close using the broker feed (extended-hours aware). No API key.
// Keep in sync with server-v2/scanner-tickers.js (single-name/ETF universe;
// indices SPX/VIX/SPY/QQQ intentionally excluded from "movers").

const WATCHLIST: string[] = [
  // MAIN mega-caps
  "AAPL", "AMD", "AMZN", "GOOGL", "META", "MSFT", "NVDA", "SPCX", "TSLA",
  // SHARES
  "AAPU", "ASTS", "AVGO", "BYND", "CMG", "COIN", "CWVX", "ETHA", "FBL", "FIG",
  "GME", "HIMZ", "HOOD", "IBIT", "LLYX", "MSFU", "NFLX", "NOK", "NVDX", "OSCR",
  "PLTR", "PONY", "QBTS", "QUBT", "RGTI", "RIVN", "SLV", "SMCI", "SOFI", "SOUN",
  "SOXL", "TQQQ", "TSLL", "UUUU",
  // SPREADS
  "ABNB", "AFRM", "ARM", "BA", "BABA", "CCJ", "CHWY", "COST", "CRCL", "CRM",
  "CRWD", "CRWV", "DJT", "FDX", "GS", "HIMS", "INTC", "IREN", "IWM", "LAC",
  "LLY", "MA", "MARA", "MCD", "MRK", "MRNA", "MU", "NIO", "NKE", "NNE",
  "NXE", "OKLO", "OPEN", "OXY", "PDD", "PFE", "PTON", "RBLX", "RIOT", "RKLB",
  "ROKU", "SE", "SMH", "SNDK", "SNOW", "TGT", "TSM", "TTD", "U", "UNH",
  "UPS", "UPST", "V", "XPEV", "XYZ",
];

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

interface QuoteItem {
  symbol: string;
  last: number;
  mark: number;
  close: number;
  prevClose: number;
}

// True when NY clock is outside 9:30–16:00 (pre/post market) → tag moves as "PM".
function isExtendedHours(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const mins = h * 60 + m;
  return mins < 570 || mins >= 960; // before 9:30 or at/after 16:00
}

export async function GET() {
  try {
    const url = `${proxyBase()}/proxy/quotes?symbols=${encodeURIComponent(WATCHLIST.join(","))}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: `quotes proxy returned ${res.status}` }, { status: 502 });
    }
    const j = await res.json();
    const items = (j?.data?.items ?? []) as QuoteItem[];
    const extended = isExtendedHours();

    const ranked = items
      .map((q) => {
        const current = q.mark || q.last || 0;
        const base = q.prevClose || q.close || 0;
        if (!current || !base) return null;
        const change = current - base;
        const pct = (change / base) * 100;
        return {
          symbol: q.symbol,
          name: q.symbol,
          price: current,
          change,
          pct,
          preMarketPrice: extended ? current : null,
          preMarketPct: extended ? pct : null,
          volume: null,
        } as Mover;
      })
      .filter((m): m is Mover => m !== null)
      .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));

    const up = ranked.slice(0, 5);
    const down = ranked.slice(-5).reverse();
    // De-dupe when the universe is tiny (up and down could overlap).
    const seen = new Set<string>();
    const movers = [...up, ...down].filter((m) => (seen.has(m.symbol) ? false : seen.add(m.symbol)));

    return NextResponse.json(
      { movers, up, down, updatedAt: Date.now() },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json({ error: "Fetch failed", detail: String(err) }, { status: 500 });
  }
}
