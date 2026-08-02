"use client";

/**
 * TTL-scoped JSON cache shared by every component in the tab.
 *
 * WHY THIS EXISTS
 * ───────────────
 * /es-candles renders 1–3 EsChartCards. Several of the things a card fetches
 * are not per-card at all — they are page-global facts:
 *
 *   • /api/snapshots/mvc          SPX central-band history. Identical bytes for
 *                                 every ES card. Was 11.6 kB × 3 on load.
 *   • /proxy/es-spx-basis         ONE number (plus a day map). Was fetched 4×.
 *   • /api/eod-gex?symbol=$SPX    Prior-day closes. Same for every card.
 *   • /api/levels?ticker=X        Weekly published band. Two separate effects in
 *                                 the SAME card ask for it, and sibling cards on
 *                                 the same symbol ask again.
 *
 * dedupeFetch (lib/dedupeFetch.ts) already collapses *concurrent* identical GETs
 * and drops the entry the moment the request settles. That is the right tool for
 * a request that must never be stale — the heatmap backfill. It does nothing for
 * the case here: three cards whose 60 s polls are 40 ms apart, or a card that
 * mounts a second after its siblings. Those are sequential, not concurrent, so
 * dedupeFetch sees no overlap and every one of them hits the network.
 *
 * This module keeps the resolved value for a caller-supplied TTL. Within the
 * TTL a caller gets the cached promise and issues no request at all.
 *
 * RELATIONSHIP TO dedupeFetch
 * ───────────────────────────
 * Use dedupeFetch when staleness is unacceptable and you only want to collapse
 * simultaneous callers. Use cachedJson when the data has a known refresh cadence
 * and serving it a few seconds old is not just acceptable but is already what
 * the polling interval implies.
 *
 * TTL RULE OF THUMB: half the caller's poll interval. That guarantees a real
 * poll tick always crosses the TTL and fetches fresh, while sibling components
 * polling on the same cadence a few ms apart share one response.
 *
 * PERSISTENCE
 * ───────────
 * `persist: true` additionally mirrors the value into sessionStorage, so a
 * reload or a client-side navigation back to the page reuses it instead of
 * refetching. Only for slow-moving data where a stale read cannot mislead —
 * the weekly EM band, prior-day closes, the ES/SPX basis. Never for anything
 * that ticks. sessionStorage (not localStorage) on purpose: the cache should
 * not outlive the tab.
 */

const MEM = new Map<string, Entry>();

type Entry = {
  /** ms epoch the underlying fetch RESOLVED. 0 while still in flight. */
  at: number;
  promise: Promise<unknown>;
};

export class HttpError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

export type CachedJsonOpts = {
  /** How long a resolved value stays servable. Default 30 s. */
  ttlMs?: number;
  /** Mirror into sessionStorage so a reload can reuse it. Slow-moving data only. */
  persist?: boolean;
  init?: RequestInit;
};

const SS_PREFIX = "shared-cache:";

function readSession(url: string, ttlMs: number): unknown | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(SS_PREFIX + url);
    if (!raw) return undefined;
    const { at, v } = JSON.parse(raw) as { at: number; v: unknown };
    // A clock that moved backwards (sleep/resume, NTP correction) would make a
    // stale entry look fresh forever. Treat any negative age as expired.
    const age = Date.now() - at;
    if (!(age >= 0 && age < ttlMs)) {
      window.sessionStorage.removeItem(SS_PREFIX + url);
      return undefined;
    }
    return v;
  } catch {
    return undefined;
  }
}

function writeSession(url: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SS_PREFIX + url, JSON.stringify({ at: Date.now(), v: value }));
  } catch {
    // Quota, private mode, or a value with a cycle. The memory tier still works;
    // persistence is an optimisation and is never load-bearing.
  }
}

/**
 * GET `url` as JSON, reusing a recent result when one exists.
 *
 * Rejects with HttpError on a non-2xx so callers can branch on `.status` the way
 * they used to branch on `res.ok` / `res.status`. A rejection is NOT cached —
 * the entry is dropped so the next caller retries immediately.
 */
export function cachedJson<T = unknown>(url: string, opts: CachedJsonOpts = {}): Promise<T> {
  const { ttlMs = 30_000, persist = false, init } = opts;

  const hit = MEM.get(url);
  // at === 0 means in flight: join it regardless of TTL. Two callers a
  // millisecond apart must not both open a socket.
  if (hit && (hit.at === 0 || Date.now() - hit.at < ttlMs)) return hit.promise as Promise<T>;

  if (persist) {
    const stored = readSession(url, ttlMs);
    if (stored !== undefined) {
      const entry: Entry = { at: Date.now(), promise: Promise.resolve(stored) };
      MEM.set(url, entry);
      return entry.promise as Promise<T>;
    }
  }

  const entry: Entry = { at: 0, promise: Promise.resolve(undefined) };
  entry.promise = fetch(url, { cache: "no-store", ...init })
    .then(async (res) => {
      if (!res.ok) throw new HttpError(res.status, url);
      const json = (await res.json()) as unknown;
      entry.at = Date.now();
      if (persist) writeSession(url, json);
      return json;
    })
    .catch((e) => {
      // Never cache a failure: a blip would otherwise blank the band for a whole
      // TTL. Only drop OUR entry — a newer one may already have replaced it.
      if (MEM.get(url) === entry) MEM.delete(url);
      throw e;
    });

  MEM.set(url, entry);
  return entry.promise as Promise<T>;
}

/**
 * Force the next `cachedJson` for these URLs to hit the network.
 * `match` is tested against the full URL — pass a prefix string or a RegExp.
 * Call this from a manual Refresh button, not from an effect.
 */
export function invalidate(match?: string | RegExp): void {
  if (match === undefined) {
    MEM.clear();
    if (typeof window !== "undefined") {
      try {
        for (const k of Object.keys(window.sessionStorage)) {
          if (k.startsWith(SS_PREFIX)) window.sessionStorage.removeItem(k);
        }
      } catch { /* nothing to clean up */ }
    }
    return;
  }
  const hits = (u: string) => (typeof match === "string" ? u.startsWith(match) : match.test(u));
  for (const k of [...MEM.keys()]) if (hits(k)) MEM.delete(k);
  if (typeof window !== "undefined") {
    try {
      for (const k of Object.keys(window.sessionStorage)) {
        if (k.startsWith(SS_PREFIX) && hits(k.slice(SS_PREFIX.length))) window.sessionStorage.removeItem(k);
      }
    } catch { /* nothing to clean up */ }
  }
}
