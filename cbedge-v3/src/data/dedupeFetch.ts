/**
 * Collapses identical GETs into a single network request.
 *
 * WHY: the /es-candles heatmap backfill
 * (/api/snapshots/option-strike-gex-history) fires twice on load with byte-for-
 * byte identical query strings — ~400ms and several hundred KB of duplicated
 * work on the critical path. The effect already guards on a `fetchKey`, but that
 * guard only catches re-fires it can *see*; a remount, a StrictMode double
 * invoke, or two components asking for the same window all slip past it.
 *
 * Two callers asking for the exact same URL can only want the same bytes, so
 * sharing one request is always correct. Each caller gets its own Response
 * clone, so bodies are independently readable.
 *
 * ── holdMs ──────────────────────────────────────────────────────────────────
 * By default the entry is dropped the moment the request settles: this is a
 * concurrency collapser, not a cache, and a later call always hits the network.
 *
 * That default has a sharp edge. It only collapses callers that OVERLAP IN
 * TIME, so whether N callers become 1 request or N requests depends entirely on
 * how long the first one takes. Speed up anything upstream — resolve an expiry
 * from sessionStorage instead of over the wire, say — and two firings that used
 * to overlap now land 50ms apart and both go out. The duplicate rate is a
 * function of unrelated latency, which is not a property you want on a 400 kB
 * request on the critical path.
 *
 * `holdMs` keeps the settled entry for that many milliseconds, so re-fires
 * within the window are served from it regardless of timing. Use it where the
 * caller genuinely cannot want different bytes that soon — the heatmap backfill
 * is history whose newest column is kept current by /ws/gex, so a 20s-old
 * response and a fresh one differ by at most one minute-column that the socket
 * is about to overwrite anyway.
 *
 * Do NOT set holdMs on a live quote or chain read. Those want the network every
 * time and only want the concurrency collapse. For genuinely slow-moving data
 * with a known refresh cadence, reach for lib/sharedCache.ts instead — it caches
 * the parsed value and can persist it across a reload.
 *
 * Held responses stay buffered in memory for the window (the body is never
 * consumed — every caller reads a clone), so keep holdMs to seconds, not
 * minutes, on anything large.
 */

const inflight = new Map<string, Promise<Response>>();

function keyOf(url: string, init?: RequestInit): string {
  const method = (init?.method || "GET").toUpperCase();
  return `${method} ${url}`;
}

export function dedupeFetch(url: string, init?: RequestInit, holdMs = 0): Promise<Response> {
  // Only idempotent reads are safe to share.
  const method = (init?.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return fetch(url, init);

  const key = keyOf(url, init);
  const existing = inflight.get(key);
  // .clone() so every caller — including the first — reads its own body.
  if (existing) return existing.then((r) => r.clone());

  const drop = () => {
    if (inflight.get(key) === p) inflight.delete(key);
  };
  const p = fetch(url, init).then(
    (r) => {
      // A REJECTION is never held: a blip must not be replayed to every caller
      // for the rest of the window. Only a settled success gets the hold.
      if (holdMs > 0) setTimeout(drop, holdMs);
      else drop();
      return r;
    },
    (e) => {
      drop();
      throw e;
    }
  );
  inflight.set(key, p);
  return p.then((r) => r.clone());
}
