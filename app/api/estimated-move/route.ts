import { NextResponse } from "next/server";

const PROXY = process.env.PROXY_URL ?? "https://dash-1-vq07.onrender.com";

// Symbols to compute EM for, in order
const TICKERS = [
  { ticker: "SPX",  chainSym: "SPX",  isFuture: false },
  { ticker: "/ES",  chainSym: "SPX",  isFuture: true  },
  { ticker: "SPY",  chainSym: "SPY",  isFuture: false },
  { ticker: "QQQ",  chainSym: "QQQ",  isFuture: false },
  { ticker: "/NQ",  chainSym: "NDX",  isFuture: true  },
];

interface OptionRow {
  strike: number;
  type: "CALL" | "PUT";
  expiration: string;
  iv: number;
  bid: number;
  ask: number;
  last: number;
  dte: number;
}

function normalizeOptions(json: Record<string, unknown>): OptionRow[] {
  const raw: unknown[] =
    (json?.options as unknown[]) ??
    (json?.data as Record<string, unknown>)?.options as unknown[] ??
    [];
  return raw.map((o) => {
    const r = o as Record<string, unknown>;
    return {
      strike:     Number(r.strike     ?? r["strike-price"]     ?? 0),
      type:       String(r.type       ?? r["option-type"]       ?? "CALL").toUpperCase() as "CALL" | "PUT",
      expiration: String(r.expiration ?? r["expiration-date"]   ?? ""),
      iv:         Number(r.iv         ?? r.impliedVolatility     ?? 0),
      bid:        Number(r.bid        ?? r.bidPrice              ?? 0),
      ask:        Number(r.ask        ?? r.askPrice              ?? 0),
      last:       Number(r.last       ?? r.lastPrice             ?? 0),
      dte:        Number(r.dte        ?? r.daysToExpiration       ?? 0),
    };
  });
}

function mid(o: OptionRow): number {
  if (o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2;
  if (o.last > 0) return o.last;
  return 0;
}

async function fetchQuote(sym: string): Promise<{ close: number; prevClose: number }> {
  try {
    const r = await fetch(
      `${PROXY}/proxy/api/tt/quotes-batch?symbols=${encodeURIComponent(sym)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) throw new Error("quote failed");
    const json = await r.json() as { data?: { items?: Record<string, unknown>[] } };
    // quotes-batch returns { data: { items: [{ symbol, last, 'prev-close', ... }] } }
    const items = json?.data?.items ?? [];
    const entry = items.find((i) =>
      String(i.symbol).replace(/^\$/, "").toUpperCase() === sym.replace(/^\//, "").replace(/^\$/, "").toUpperCase()
    ) ?? items[0];
    if (!entry) return { close: 0, prevClose: 0 };
    const last = Number(entry.last ?? 0);
    const prev = Number((entry as Record<string, unknown>)["prev-close"] ?? entry.prevClose ?? 0);
    return { close: last || prev, prevClose: prev };
  } catch {
    return { close: 0, prevClose: 0 };
  }
}

async function getTargetExpiration(): Promise<string> {
  try {
    const r = await fetch(`${PROXY}/proxy/api/tt/gex-expirations`, {
      signal: AbortSignal.timeout(5000),
    });
    const json = await r.json() as Record<string, unknown>;
    const exps: string[] = (
      (json.expirations as string[]) ??
      (json.data as Record<string, unknown>)?.expirations as string[] ??
      []
    )
      .filter((e) => typeof e === "string")
      .filter((e) => new Date(e + "T16:00:00") >= new Date())
      .sort();

    // Prefer nearest Friday
    const friday = exps.find((e) => new Date(e + "T12:00:00").getDay() === 5);
    return friday ?? exps[0] ?? "";
  } catch {
    // Fallback: next Friday
    const d = new Date();
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
    return d.toISOString().split("T")[0];
  }
}

async function computeEM(
  ticker: string,
  chainSym: string,
  isFuture: boolean,
  expiration: string,
): Promise<{ ticker: string; close: number; em: number; up: number; down: number; expiration: string } | null> {
  try {
    const quoteSymbol = isFuture
      ? (ticker === "/ES" ? "/ESM6" : "/NQM6")
      : ticker;
    const indexSymbol = isFuture
      ? (ticker === "/ES" ? "SPX" : "NDX")
      : ticker;

    const [quoteData, indexData] = await Promise.all([
      fetchQuote(quoteSymbol),
      isFuture ? fetchQuote(indexSymbol) : Promise.resolve({ close: 0, prevClose: 0 }),
    ]);

    const close = quoteData.close;
    if (!close || close <= 0) return null;

    const indexClose = isFuture
      ? (indexData.prevClose > 0 ? indexData.prevClose : indexData.close || close)
      : close;

    // Fetch options chain
    const chainUrl =
      `${PROXY}/proxy/api/tt/chains/${encodeURIComponent(chainSym)}` +
      `?expiration=${encodeURIComponent(expiration)}&noSubscribe=1`;
    const chainRes = await fetch(chainUrl, { signal: AbortSignal.timeout(10_000) });
    if (!chainRes.ok) return null;
    const chainJson = await chainRes.json() as Record<string, unknown>;
    const options = normalizeOptions(chainJson).filter((o) => o.expiration === expiration);
    if (!options.length) return null;

    // Find ATM strike (closest to indexClose)
    const strikes = [...new Set(options.map((o) => o.strike))].sort(
      (a, b) => Math.abs(a - indexClose) - Math.abs(b - indexClose)
    );

    let em = 0;
    for (const strike of strikes) {
      const c = options.find((o) => o.strike === strike && o.type === "CALL");
      const p = options.find((o) => o.strike === strike && o.type === "PUT");
      if (!c || !p) continue;

      const dte = c.dte || p.dte || 7;
      const avgIV = (c.iv + p.iv) / 2;

      let candidate = 0;
      if (avgIV > 0 && dte > 0) {
        candidate = 0.84 * avgIV * indexClose * Math.sqrt(dte / 365);
      } else {
        const cMid = mid(c);
        const pMid = mid(p);
        if (cMid > 0 && pMid > 0) {
          candidate = (cMid + pMid) * 0.85;
        }
      }

      if (candidate > 0) {
        const pct = candidate / indexClose;
        if (pct >= 0.002 && pct <= 0.25) {
          em = candidate;
          break;
        }
      }
    }

    if (!em || !isFinite(em)) return null;

    const basis = isFuture ? close - indexClose : 0;
    return {
      ticker,
      close,
      em,
      up:   indexClose + em + basis,
      down: indexClose - em + basis,
      expiration,
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    let expiration = searchParams.get("expiration");

    if (!expiration) {
      expiration = await getTargetExpiration();
    }

    const results = await Promise.allSettled(
      TICKERS.map(({ ticker, chainSym, isFuture }) =>
        computeEM(ticker, chainSym, isFuture, expiration!)
      )
    );

    const rows = results
      .map((r) => (r.status === "fulfilled" ? r.value : null))
      .filter(Boolean);

    return NextResponse.json({
      expiration,
      date: new Date().toISOString().split("T")[0],
      rows,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err), rows: [] }, { status: 500 });
  }
}
