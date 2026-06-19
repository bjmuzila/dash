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
    const res = await fetch(url, { cache: "no-store" });
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
