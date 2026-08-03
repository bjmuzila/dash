import { NextResponse } from "next/server";

/**
 * Base URL of the internal server-v2 / legacy Tastytrade proxy.
 * next.config.js rewrites /proxy/:path* → this same base, but API route
 * handlers run server-side and must call it directly (rewrites only apply to
 * incoming browser requests, not server fetch()).
 */
export function proxyBase(): string {
  // server-v2 runs Next + the /proxy/* handlers in ONE process on PORT (3002 by
  // default per .env.local). Older notes say "proxy on 3001", but that was the
  // legacy dual-port stack. Default to the same-origin PORT so server-side
  // forwards hit the live process — hardcoding 3001 pointed at a dead port and
  // made /api/chains + /api/expirations fail (empty chain / empty expiry list).
  const base = process.env.PROXY_URL
    || `http://127.0.0.1:${process.env.PORT || "3002"}`;
  return base.replace(/\/$/, "");
}

/**
 * Forward a GET to a /proxy/* path on the internal proxy and pass the JSON
 * response straight back. Used by the thin /api/* adapters that the chain
 * pages (insights, options-chain, mult-greek, estimated-moves) fetch from.
 */
export async function forwardGet(proxyPath: string): Promise<NextResponse> {
  const url = `${proxyBase()}${proxyPath.startsWith("/") ? "" : "/"}${proxyPath}`;
  try {
    // Same-process server-to-server forward — treat it like the other in-process
    // callers (levels-engine, cron jobs) and attach the shared secret so
    // proxy-auth's PROXY_AUTH_REQUIRED gate doesn't reject it as anonymous.
    // Without this, every /api/* route that forwards to /proxy/* 401'd with
    // {"error":"no-token"} once that gate was enforced (broke /api/expirations,
    // /api/chains, and anything using this helper — silently, for weeks).
    const internalToken = process.env.INTERNAL_API_TOKEN;
    const res = await fetch(url, {
      cache: "no-store",
      headers: internalToken ? { "x-internal-token": internalToken } : {},
    });
    const text = await res.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return NextResponse.json(body as object, {
      status: res.status,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: String((err as Error)?.message || err) },
      { status: 502 }
    );
  }
}

/**
 * Re-emit a forwarded response with CDN cache headers, PRESERVING the upstream
 * status.
 *
 * WHY THIS EXISTS
 * ---------------
 * /api/expirations, /api/chains and /api/tt-quotes each ended with:
 *
 *     return new NextResponse(res.body, { ...res, headers });
 *
 * `res` is a NextResponse, and Response exposes `status` as a PROTOTYPE getter.
 * Object spread copies only own enumerable properties, so `{ ...res }` is `{}`
 * — the init carried no status and every forward collapsed to `200 OK`. A 502
 * from forwardGet reached the browser as a 200 whose body was
 * `{"error":"..."}`, so client code that branches on `res.ok` happily parsed
 * the error envelope as data. Worse, the `public, max-age=N` header applied on
 * the line above then let Cloudflare cache that failure as a good response for
 * the full TTL.
 *
 * This helper keeps the status and refuses to put a non-2xx in any cache.
 */
export function withCacheHeaders(res: Response, maxAgeSeconds: number): NextResponse {
  const headers = new Headers(res.headers);

  if (res.ok) {
    headers.set("Cache-Control", `public, max-age=${maxAgeSeconds}`);
  } else {
    // Never let an upstream failure sit in the edge cache.
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  }

  return new NextResponse(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
