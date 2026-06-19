import { NextResponse } from "next/server";

/**
 * Base URL of the internal server-v2 / legacy Tastytrade proxy.
 * next.config.js rewrites /proxy/:path* → this same base, but API route
 * handlers run server-side and must call it directly (rewrites only apply to
 * incoming browser requests, not server fetch()).
 */
export function proxyBase(): string {
  return (process.env.PROXY_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
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
