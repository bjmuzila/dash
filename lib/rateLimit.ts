// Best-effort in-memory per-key rate limiter for the auth routes.
//
// Scope/limits: single-container deployment, so one in-process Map is sufficient
// (counts reset on redeploy — acceptable for brute-force throttling, which only
// needs to blunt sustained automated attempts). If you ever scale to multiple
// instances, move this to Postgres/Redis so the window is shared.

type Bucket = { hits: number[]; blockedUntil: number };
const buckets = new Map<string, Bucket>();

// Periodically drop idle buckets so the Map can't grow unbounded.
const SWEEP_MS = 10 * 60_000;
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < SWEEP_MS) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (b.blockedUntil < now && (b.hits.length === 0 || b.hits[b.hits.length - 1] < now - SWEEP_MS)) {
      buckets.delete(k);
    }
  }
}

export type RateOptions = {
  windowMs: number; // sliding window length
  max: number; // max attempts within the window before blocking
  blockMs: number; // how long to block once max is exceeded
};

export type RateResult = { allowed: boolean; retryAfterSec: number };

/**
 * Record an attempt for `key` and report whether it's allowed. Call once per
 * incoming auth attempt (before doing the actual sign-in work).
 */
export function rateLimit(key: string, opts: RateOptions): RateResult {
  const now = Date.now();
  sweep(now);

  let b = buckets.get(key);
  if (!b) {
    b = { hits: [], blockedUntil: 0 };
    buckets.set(key, b);
  }

  if (b.blockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((b.blockedUntil - now) / 1000) };
  }

  // Drop hits outside the window, then record this one.
  const cutoff = now - opts.windowMs;
  b.hits = b.hits.filter((t) => t > cutoff);
  b.hits.push(now);

  if (b.hits.length > opts.max) {
    b.blockedUntil = now + opts.blockMs;
    b.hits = [];
    return { allowed: false, retryAfterSec: Math.ceil(opts.blockMs / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Clear a key's counters — call after a SUCCESSFUL login so honest users who
 *  fat-fingered a few times aren't penalized. */
export function rateLimitReset(key: string) {
  buckets.delete(key);
}

/** Extract the best client IP from proxy headers (Cloudflare → VPS → Next). */
export function clientIp(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
