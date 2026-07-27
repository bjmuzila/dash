import { NextResponse } from "next/server";
import { proxyBase } from "@/lib/proxyForward";
import { SPX_UNIVERSE, SPX_UNIVERSE_BY_TICKER, SPX_UNIVERSE_SYMBOLS } from "@/lib/spxSectorUniverse";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Sector sunburst feed for the Traders Dashboard.
 *
 * One quote sweep over the ~200 largest S&P names, joined to the checked-in
 * GICS map in lib/spxSectorUniverse.ts. Prices come from the same broker proxy
 * the premarket movers use (`/proxy/quotes`) — extended-hours aware, no API key.
 *
 * Refresh policy: the result is cached in-process for REFRESH_MS (default 15
 * min, override with SPX_SUNBURST_TTL_MS). Clients poll more often than that on
 * purpose — they just get the cached payload until it ages out, so N dashboard
 * tabs still cost one upstream sweep per window.
 */

const REFRESH_MS = Number(process.env.SPX_SUNBURST_TTL_MS ?? 15 * 60_000);
const CHUNK = 50;                 // symbols per upstream request
const STALE_GRACE_MS = 60 * 60_000; // serve a stale payload rather than nothing

interface QuoteItem {
  symbol: string;
  last: number;
  mark: number;
  close: number;
  prevClose: number;
}

export interface SunburstRow {
  /** Ticker. */
  t: string;
  /** GICS sector. */
  s: string;
  /** Industry. */
  i: string;
  /** Approximate market cap in $B — arc width only. */
  w: number;
  /** Percent change vs the prior regular close. */
  c: number;
}

export interface SunburstPayload {
  rows: SunburstRow[];
  updatedAt: number;
  /** How many of the universe actually returned a usable quote. */
  covered: number;
  universe: number;
  /** True when the upstream sweep failed and this is a previously cached body. */
  stale?: boolean;
}

let cache: { payload: SunburstPayload; ts: number } | null = null;
let inFlight: Promise<SunburstPayload> | null = null;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchQuotes(symbols: string[]): Promise<QuoteItem[]> {
  const internalToken = process.env.INTERNAL_API_TOKEN;
  const batches = chunk(symbols, CHUNK);
  const results = await Promise.all(
    batches.map(async (batch) => {
      const url = `${proxyBase()}/proxy/quotes?symbols=${encodeURIComponent(batch.join(","))}`;
      const res = await fetch(url, {
        cache: "no-store",
        headers: internalToken ? { "x-internal-token": internalToken } : {},
      });
      if (!res.ok) throw new Error(`quotes proxy returned ${res.status}`);
      const j = await res.json();
      return (j?.data?.items ?? []) as QuoteItem[];
    })
  );
  return results.flat();
}

async function build(): Promise<SunburstPayload> {
  const items = await fetchQuotes(SPX_UNIVERSE_SYMBOLS);

  const rows: SunburstRow[] = [];
  for (const q of items) {
    const meta = SPX_UNIVERSE_BY_TICKER[q.symbol];
    if (!meta) continue;                       // symbol we didn't ask about
    const current = q.mark || q.last || 0;
    const base = q.prevClose || q.close || 0;
    if (!current || !base) continue;           // no usable quote — drop the name
    rows.push({ t: meta.t, s: meta.s, i: meta.i, w: meta.capB, c: ((current - base) / base) * 100 });
  }

  return {
    rows,
    updatedAt: Date.now(),
    covered: rows.length,
    universe: SPX_UNIVERSE.length,
  };
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.ts < REFRESH_MS) {
    return NextResponse.json(cache.payload, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    });
  }

  // Collapse concurrent misses onto a single upstream sweep.
  if (!inFlight) {
    inFlight = build()
      .then((payload) => {
        cache = { payload, ts: Date.now() };
        return payload;
      })
      .finally(() => { inFlight = null; });
  }

  try {
    const payload = await inFlight;
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    });
  } catch (err) {
    // Upstream is down. A slightly old wheel beats an empty card.
    if (cache && now - cache.ts < REFRESH_MS + STALE_GRACE_MS) {
      return NextResponse.json(
        { ...cache.payload, stale: true },
        { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
      );
    }
    return NextResponse.json({ error: "Fetch failed", detail: String(err) }, { status: 502 });
  }
}
