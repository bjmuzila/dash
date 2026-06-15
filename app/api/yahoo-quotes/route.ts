import { NextRequest, NextResponse } from "next/server";

// Yahoo Finance — fetch a crumb+cookie first, then query quotes
// Crumb is session-scoped; cache it in module memory (resets on cold start)
let _crumb: string | null = null;
let _cookie: string | null = null;
let _crumbFetchedAt = 0;

async function getCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  const now = Date.now();
  // Refresh crumb every 30 minutes
  if (_crumb && _cookie && now - _crumbFetchedAt < 30 * 60 * 1000) {
    return { crumb: _crumb, cookie: _cookie };
  }

  try {
    // Step 1: get a session cookie from Yahoo Finance
    const initRes = await fetch("https://finance.yahoo.com/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html",
      },
      redirect: "follow",
    });

    const cookieHeader = initRes.headers.get("set-cookie") ?? "";
    // Extract A1 or A3 session cookie
    const cookieMatch = cookieHeader.match(/(A[13]=\S+?);/);
    const cookie = cookieMatch ? cookieMatch[1] : "";

    // Step 2: fetch crumb
    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cookie": cookie,
        "Accept": "text/plain",
      },
    });

    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.length < 3) return null;

    _crumb = crumb;
    _cookie = cookie;
    _crumbFetchedAt = now;
    return { crumb, cookie };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbols = searchParams.get("symbols") || "";
  if (!symbols) return NextResponse.json({ error: "symbols required" }, { status: 400 });

  const syms = symbols.split(",").map(s => s.trim()).filter(Boolean);

  try {
    const auth = await getCrumb();

    const fields = "regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketPreviousClose";
    const qs = `symbols=${encodeURIComponent(syms.join(","))}&fields=${fields}${auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : ""}`;
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?${qs}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        ...(auth?.cookie ? { "Cookie": auth.cookie } : {}),
      },
    });

    if (!res.ok) {
      // Reset crumb so next request refetches
      _crumb = null;
      _cookie = null;
      return NextResponse.json({ error: `Yahoo ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    const results: Array<Record<string, unknown>> = data?.quoteResponse?.result ?? [];

    const quotes: Record<string, { price: number | null; change: number | null; pct: number | null }> = {};
    results.forEach((r) => {
      const sym = String(r.symbol ?? "");
      quotes[sym] = {
        price:  r.regularMarketPrice         != null ? Number(r.regularMarketPrice)         : null,
        change: r.regularMarketChange        != null ? Number(r.regularMarketChange)        : null,
        pct:    r.regularMarketChangePercent != null ? Number(r.regularMarketChangePercent) : null,
      };
    });

    return NextResponse.json(quotes, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
