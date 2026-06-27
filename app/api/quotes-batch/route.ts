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

type YahooQuote = { price: number | null; prevClose: number | null; change: number | null; pct: number | null; spark?: number[]; session?: "REG" | "EXT" };

// Offset (minutes) from UTC for America/New_York at a given instant — handles DST.
function nyOffsetMinutes(d: Date): number {
  const s = d.toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" });
  const m = s.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!m) return -300;
  const h = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  return h * 60 + (h < 0 ? -mm : mm);
}

// Two independent things:
//  • startSec = sparkline RESET boundary — the later of today's 09:30 ET and
//    20:00 ET (or yesterday's 20:00 ET before 09:30). The line restarts here.
//  • session  = REG when 09:30–16:00 ET, EXT every other time. (The reset at
//    20:00 does NOT change the label — only the clock-time window does.)
function sessionBoundary(now: Date): { startSec: number; session: "REG" | "EXT" } {
  const off = nyOffsetMinutes(now);
  // Current ET wall-clock minutes since midnight.
  const etMs = now.getTime() + off * 60_000;
  const etDate = new Date(etMs);
  const etMin = etDate.getUTCHours() * 60 + etDate.getUTCMinutes();
  const OPEN = 9 * 60 + 30;  // 09:30 — RTH open + reset
  const CLOSE = 16 * 60;     // 16:00 — RTH close
  const EVE = 20 * 60;       // 20:00 — evening reset

  // ET midnight of the current ET day, as a real UTC instant.
  const etMidnightUtcMs = Date.UTC(etDate.getUTCFullYear(), etDate.getUTCMonth(), etDate.getUTCDate()) - off * 60_000;
  const at = (mins: number) => Math.floor((etMidnightUtcMs + mins * 60_000) / 1000);

  // REG only during 09:30–16:00 ET; everything else is EXT.
  const session: "REG" | "EXT" = etMin >= OPEN && etMin < CLOSE ? "REG" : "EXT";

  // Reset boundary (independent of the label).
  let startSec: number;
  if (etMin >= EVE) startSec = at(EVE);          // after 20:00 → evening reset
  else if (etMin >= OPEN) startSec = at(OPEN);   // 09:30–20:00 → morning reset
  else startSec = at(EVE) - 86_400;              // before 09:30 → prior 20:00

  return { startSec, session };
}

const YH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://finance.yahoo.com",
  Referer: "https://finance.yahoo.com/",
};

// Intraday close series for the sparkline. The window RESETS at 09:30 ET and
// 20:00 ET: only candles at/after the most recent boundary are kept, so the
// line starts fresh each session. Includes pre/post candles so the overnight
// (EXT) window has data. Downsamples to ~24 points to keep the payload tiny.
async function fetchSpark(yahooSym: string): Promise<{ spark: number[]; session: "REG" | "EXT" }> {
  const { startSec, session } = sessionBoundary(new Date());
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=5m&range=2d&includePrePost=true&_=${Date.now()}`;
    const res = await fetch(url, { headers: YH_HEADERS, cache: "no-store" });
    if (!res.ok) return { spark: [], session };
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const ts: number[] = result?.timestamp ?? [];
    const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];
    // Keep only points at/after the current session boundary, in order.
    const valid: number[] = [];
    // Also keep every finite close (any session) as a closed-market fallback.
    const allValid: number[] = [];
    for (let i = 0; i < closes.length; i++) {
      const c = closes[i];
      const t = ts[i];
      if (typeof c === "number" && Number.isFinite(c)) {
        allValid.push(c);
        if (typeof t === "number" && t >= startSec) valid.push(c);
      }
    }
    // Market closed → current session has no fresh candles. Fall back to the
    // last session's curve (the tail of the 2-day series) so the line still
    // shows shape instead of collapsing to the "—" placeholder.
    let series = valid;
    if (series.length < 2) {
      if (allValid.length < 2) return { spark: [], session };
      series = allValid.slice(-78); // ~ last full RTH session of 5m bars
    }
    // Downsample to at most 24 evenly-spaced points.
    const MAX = 24;
    if (series.length <= MAX) return { spark: series, session };
    const step = series.length / MAX;
    const out: number[] = [];
    for (let i = 0; i < MAX; i++) out.push(series[Math.floor(i * step)]);
    out.push(series[series.length - 1]);
    return { spark: out, session };
  } catch {
    return { spark: [], session };
  }
}

async function fetchOne(yahooSym: string, withSpark = false): Promise<YahooQuote> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=5d&includePrePost=true&_=${Date.now()}`;
    const res = await fetch(url, { headers: YH_HEADERS, cache: "no-store" });
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
    const sp = withSpark ? await fetchSpark(yahooSym) : undefined;
    return { price, prevClose, change, pct, spark: sp?.spark, session: sp?.session };
  } catch {
    return { price: null, prevClose: null, change: null, pct: null };
  }
}

export async function GET(req: NextRequest) {
  const url0 = new URL(req.url);
  const symbols = url0.searchParams.get("symbols") || "";
  // ?spark=1 → also return a downsampled intraday close-series per symbol.
  const withSpark = url0.searchParams.get("spark") === "1";
  if (!symbols) return NextResponse.json({ data: { items: [] } });

  const syms = symbols.split(",").map((s) => s.trim()).filter(Boolean);
  // Dedupe Yahoo tickers so we don't fetch /ESU26 and /ES:XCME twice.
  const pairs = syms.map((sym) => ({ sym, yahoo: toYahoo(sym) }));
  const uniqueYahoo = [...new Set(pairs.map((p) => p.yahoo))];
  const fetched = await Promise.all(uniqueYahoo.map((y) => fetchOne(y, withSpark).then((q) => [y, q] as const)));
  const byYahoo = new Map(fetched);

  const items = pairs.map(({ sym, yahoo }) => {
    const q = byYahoo.get(yahoo) ?? { price: null, prevClose: null, change: null, pct: null };
    return {
      symbol: sym,
      last: q.price,
      "prev-close": q.prevClose,
      change: q.change,
      "percent-change": q.pct,
      ...(withSpark ? { spark: q.spark ?? [], session: q.session ?? "REG" } : {}),
    };
  });

  return NextResponse.json(
    { data: { items } },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
