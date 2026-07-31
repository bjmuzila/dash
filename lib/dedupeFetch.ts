"use client";

/**
 * Collapses concurrent identical GETs into a single network request.
 *
 * WHY: the /es-candles heatmap backfill
 * (/api/snapshots/option-strike-gex-history) fires twice on load with byte-for-
 * byte identical query strings — ~400ms and several hundred KB of duplicated
 * work on the critical path. The effect already guards on a `fetchKey`, but that
 * guard only catches re-fires it can *see*; a remount, a StrictMode double
 * invoke, or two components asking for the same window all slip past it.
 *
 * Two callers asking for the exact same URL at the exact same moment can only
 * want the same bytes, so sharing one request is always correct. Each caller
 * gets its own Response clone, so bodies are independently readable.
 *
 * Deliberately NOT a cache: the entry is dropped the moment the request
 * settles, so a later call always hits the network. Nothing goes stale.
 */

const inflight = new Map<string, Promise<Response>>();

function keyOf(url: string, init?: RequestInit): string {
  const method = (init?.method || "GET").toUpperCase();
  return `${method} ${url}`;
}

export function dedupeFetch(url: string, init?: RequestInit): Promise<Response> {
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
      drop();
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
