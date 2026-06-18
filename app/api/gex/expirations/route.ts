import { NextResponse } from "next/server";

/**
 * /api/gex/expirations — thin adapter over server-v2 /proxy/expirations.
 * Returns { expiry, expirations: string[] }.
 */
export const dynamic = "force-dynamic";

function proxyBase(): string {
  return (
    process.env.PROXY_V2_URL ||
    `http://127.0.0.1:${process.env.PORT || "3001"}`
  ).replace(/\/$/, "");
}

export async function GET() {
  try {
    const res = await fetch(`${proxyBase()}/proxy/expirations`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `proxy returned ${res.status}`, expirations: [] },
        { status: 502 }
      );
    }
    const v2 = await res.json();
    return NextResponse.json({
      expiry: v2.expiry ?? null,
      expirations: Array.isArray(v2.expirations) ? v2.expirations : [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: String((err as Error)?.message || err), expirations: [] },
      { status: 502 }
    );
  }
}
