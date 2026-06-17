import { NextRequest, NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "http://localhost:3001";
const BLOCKED_SYMBOLS = new Set([
  "2YY",
  "2Y",
  "/2YY",
  "^TNX",
  "US10Y",
  "TNX.X",
  "UST10Y",
  "CL:NYMEX:N26",
  "/CL",
]);

function isBlockedSymbol(symbol: string) {
  return BLOCKED_SYMBOLS.has(symbol.trim().toUpperCase());
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbols = (searchParams.get("symbols") || "")
    .split(",")
    .map((symbol) => symbol.trim())
    .filter((symbol) => symbol && !isBlockedSymbol(symbol))
    .join(",");
  const qs = symbols ? `?symbols=${encodeURIComponent(symbols)}` : "";
  try {
    const res = await fetch(`${PROXY}/proxy/api/tt/quotes-batch${qs}`, {
      headers: { "Cache-Control": "no-cache" },
    });
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    return NextResponse.json({ data: { items: [] }, error: String(e) });
  }
}
