import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "https://vanila-8zn1.onrender.com";

export async function GET() {
  try {
    // Use the dedicated expirations endpoint — reads TT nested chain directly
    const r = await fetch(`${PROXY}/proxy/api/tt/expirations/SPX`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Proxy ${r.status}`);

    const data = await r.json();
    // Response: { data: { items: [{expiration-date, expiration-type, ...}] } }
    const items: Array<{ "expiration-date"?: string }> = data?.data?.items ?? [];
    const today = new Date().toISOString().split("T")[0];
    const expirations = items
      .map((i) => i["expiration-date"] ?? "")
      .filter((e) => typeof e === "string" && e.length === 10 && e >= today)
      .sort();

    return NextResponse.json({ expirations, today });
  } catch (err) {
    return NextResponse.json({ expirations: [], today: "", error: String(err) });
  }
}
