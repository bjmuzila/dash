import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * SPX (^GSPC) 2-year daily-close feed for the Options page heatmap.
 *
 * Replaces the hand-scraped static snapshot in components/spx/spxHeatmapData.ts:
 * Yahoo's v8 chart endpoint (the same one /api/yahoo-quotes uses) does serve
 * automated requests, so the grid can just re-pull every day instead of being
 * frozen at whatever date the snapshot was taken.
 *
 * Refresh policy: cached in-process for REFRESH_MS (default 60 min, override
 * with SPX_HEATMAP_TTL_MS). The series only changes once a trading day, so
 * every dashboard tab polling hourly still costs at most one upstream call per
 * window. On an upstream failure a stale payload is served for up to
 * STALE_GRACE_MS rather than returning nothing — the client falls back to its
 * bundled snapshot only if even that is gone.
 */

const REFRESH_MS = Number(process.env.SPX_HEATMAP_TTL_MS ?? 60 * 60_000);
const STALE_GRACE_MS = 36 * 60 * 60_000; // a day-old grid still beats an empty card
const RANGE = "2y";

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Origin: "https://finance.yahoo.com",
  Referer: "https://finance.yahoo.com/",
};

export interface SpxHeatmapDay {
  /** ISO yyyy-mm-dd, ET calendar date. */
  date: string;
  close: number;
  /** Day-over-day return, e.g. 0.0123 = +1.23%. */
  ret: number;
}

export interface SpxHeatmapPayload {
  days: SpxHeatmapDay[];
  averageClose: number;
  updatedAt: number;
  /** True when the upstream pull failed and this is a previously cached body. */
  stale?: boolean;
}

let cache: { payload: SpxHeatmapPayload; ts: number } | null = null;
let inFlight: Promise<SpxHeatmapPayload> | null = null;

// Yahoo stamps each daily bar at the session open in UTC seconds, so the ET
// calendar date has to come out of a TZ-aware formatter — a plain
// toISOString().slice(0,10) lands on the wrong day for any bar before 20:00 UTC.
const etDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

async function build(): Promise<SpxHeatmapPayload> {
  const url =
    `https://query2.finance.yahoo.com/v8/finance/chart/%5EGSPC` +
    `?interval=1d&range=${RANGE}&includePrePost=false&_=${Date.now()}`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`yahoo chart returned ${res.status}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const stamps: unknown = result?.timestamp;
  const closes: unknown = result?.indicators?.quote?.[0]?.close;
  const adj: unknown = result?.indicators?.adjclose?.[0]?.adjclose;
  if (!Array.isArray(stamps) || !Array.isArray(closes)) {
    throw new Error("yahoo chart payload missing timestamp/close series");
  }

  // Dedupe by ET date and keep the last bar for that day — Yahoo occasionally
  // appends a partial in-progress bar alongside the settled one.
  const byDate = new Map<string, number>();
  for (let i = 0; i < stamps.length; i++) {
    const t = stamps[i];
    const c =
      typeof closes[i] === "number" && Number.isFinite(closes[i])
        ? (closes[i] as number)
        : Array.isArray(adj) && typeof adj[i] === "number" && Number.isFinite(adj[i])
          ? (adj[i] as number)
          : null;
    if (typeof t !== "number" || !Number.isFinite(t) || c == null || c <= 0) continue;
    byDate.set(etDate.format(new Date(t * 1000)), c);
  }

  const dates = Array.from(byDate.keys()).sort();
  if (dates.length < 2) throw new Error("yahoo chart returned too few usable bars");

  const days: SpxHeatmapDay[] = dates.map((date, i) => {
    const close = byDate.get(date)!;
    const prev = i === 0 ? null : byDate.get(dates[i - 1])!;
    return { date, close, ret: prev ? (close - prev) / prev : 0 };
  });

  return {
    days,
    averageClose: days.reduce((s, d) => s + d.close, 0) / days.length,
    updatedAt: Date.now(),
  };
}

export async function GET() {
  const now = Date.now();
  const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

  if (cache && now - cache.ts < REFRESH_MS) {
    return NextResponse.json(cache.payload, { headers: noStore });
  }

  // Collapse concurrent misses onto a single upstream pull.
  if (!inFlight) {
    inFlight = build()
      .then((payload) => {
        cache = { payload, ts: Date.now() };
        return payload;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  try {
    return NextResponse.json(await inFlight, { headers: noStore });
  } catch (err) {
    if (cache && now - cache.ts < REFRESH_MS + STALE_GRACE_MS) {
      return NextResponse.json({ ...cache.payload, stale: true }, { headers: noStore });
    }
    return NextResponse.json({ error: "Fetch failed", detail: String(err) }, { status: 502 });
  }
}
