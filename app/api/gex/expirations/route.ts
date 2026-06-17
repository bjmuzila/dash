import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "http://localhost:3001";

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

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
    const today = todayET();
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
