// Client-side ticker interaction tracking. Fire-and-forget: never blocks the UI
// and swallows all errors. Posts to /api/ticker-event (see that route for shape).
//
//   import { trackTickerClick, trackTickerRenders } from "@/lib/trackTicker";
//   onClick={() => trackTickerClick(row.symbol, "scanner")}
//   useEffect(() => trackTickerRenders(rows.map(r => r.symbol), "scanner"), [rows]);

const ENDPOINT = "/api/ticker-event";

function send(body: unknown): void {
  try {
    const json = JSON.stringify(body);
    // sendBeacon survives page navigation (ideal for click-through). Fall back to
    // fetch keepalive where beacon is unavailable.
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(ENDPOINT, new Blob([json], { type: "application/json" }));
      return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
      keepalive: true,
    }).catch(() => {});
  } catch { /* tracking must never throw */ }
}

/** Log a single ticker click. */
export function trackTickerClick(ticker: string, source = "scanner"): void {
  if (!ticker) return;
  send({ ticker, event: "click", source });
}

/** Log a batch of ticker impressions in one request (deduped server-side). */
export function trackTickerRenders(tickers: string[], source = "scanner"): void {
  const list = Array.from(new Set((tickers || []).filter(Boolean)));
  if (!list.length) return;
  send({ events: list.map((ticker) => ({ ticker, event: "render" })), source });
}
