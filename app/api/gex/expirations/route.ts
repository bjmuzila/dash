import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? (process.env.RENDER ? "https://vanila-8zn1.onrender.com" : "http://localhost:3001");

export async function GET() {
  try {
    // Use the dedicated expirations endpoint — reads TT nested chain directly
    const r = await fetch(`${PROXY}/proxy/api/tt/expirations/SPX`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Proxy ${r.status}`);

    const data = await r.json();
    // Response: { data: { items: [{expiration-date, expiration-type, strike-count, ...}] } }
    const items: Array<{
      "expiration-date"?: string;
      "expiration-type"?: string;
      "strike-count"?: number;
    }> = data?.data?.items ?? [];
    const today = new Date().toISOString().split("T")[0];
    const expirations = items
      .map((item) => ({
        date: item["expiration-date"] ?? "",
        type: item["expiration-type"] ?? "",
        strikeCount: Number(item["strike-count"] ?? 0),
      }))
      .filter((item) => typeof item.date === "string" && item.date.length === 10 && item.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      expirations: expirations.map((item) => item.date),
      items: expirations,
      today,
    });
  } catch (err) {
    return NextResponse.json({ expirations: [], items: [], today: "", error: String(err) });
  }
}
