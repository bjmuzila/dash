import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface EarningsRow {
  symbol: string;
  company: string;
  callTime: string; // "BMO" | "AMC" | "TNS" | ""
  marketCap: number; // 0 if unknown
}

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

// Yahoo's visualization endpoint backs the earnings calendar page.
async function fetchYahooEarnings(day: string): Promise<EarningsRow[]> {
  const body = {
    sortType: "ASC",
    entityIdType: "earnings",
    sortField: "companyshortname",
    includeFields: ["ticker", "companyshortname", "startdatetimetype"],
    query: {
      operator: "and",
      operands: [
        { operator: "gte", operands: ["startdatetime", `${day}T00:00:00.000Z`] },
        { operator: "lt", operands: ["startdatetime", `${day}T23:59:59.999Z`] },
        { operator: "eq", operands: ["region", "us"] },
      ],
    },
    offset: 0,
    size: 100,
  };

  const res = await fetch(
    "https://query1.finance.yahoo.com/v1/finance/visualization?lang=en-US&region=US",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.finance?.result?.[0];
  const cols: string[] = (result?.documents?.[0]?.columns ?? []).map((c: any) => c.id);
  const rows: any[][] = result?.documents?.[0]?.rows ?? [];
  const ix = (id: string) => cols.indexOf(id);
  return rows
    .map((r) => ({
      symbol: String(r[ix("ticker")] ?? "").toUpperCase(),
      company: String(r[ix("companyshortname")] ?? ""),
      callTime: String(r[ix("startdatetimetype")] ?? ""),
      marketCap: 0,
    }))
    .filter((r) => r.symbol);
}

// Batch market caps from Yahoo quote endpoint (chunks of 50).
async function attachMarketCaps(rows: EarningsRow[]): Promise<void> {
  const symbols = rows.map((r) => r.symbol);
  const capBySym = new Map<string, number>();
  for (let i = 0; i < symbols.length; i += 50) {
    const chunk = symbols.slice(i, i + 50);
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(","))}`,
        {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
          cache: "no-store",
        }
      );
      if (!res.ok) continue;
      const j = await res.json();
      for (const q of j?.quoteResponse?.result ?? []) {
        if (q?.symbol) capBySym.set(String(q.symbol).toUpperCase(), Number(q.marketCap) || 0);
      }
    } catch {
      /* leave caps at 0 for this chunk */
    }
  }
  for (const r of rows) r.marketCap = capBySym.get(r.symbol) ?? 0;
}

export async function GET() {
  const day = etToday();
  try {
    const rows = await fetchYahooEarnings(day);
    await attachMarketCaps(rows);
    rows.sort((a, b) => b.marketCap - a.marketCap); // highest market cap first
    return NextResponse.json(
      { date: day, count: rows.length, earnings: rows },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { date: day, count: 0, earnings: [], error: e?.message ?? "fetch failed" },
      { status: 200 }
    );
  }
}
