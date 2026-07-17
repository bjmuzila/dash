import { NextResponse } from "next/server";
import { proxyBase } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/semi-strength — Semiconductor Strength Index (SSI).
 *
 * A single 0–100 read on how strong semis are RIGHT NOW, sourced entirely from
 * Tastytrade market-data (via the in-process proxy's /proxy/semi-quotes). No
 * ThetaData, no Robinhood, no Yahoo — last / prev-close / today's RTH open all
 * come from one TT batch.
 *
 * TWO baselines, because they answer different questions:
 *   • vs Prior Close — the full move including the overnight session.
 *   • vs RTH Open    — the cash-session move only (09:30 ET open → now). On a
 *                      day that gaps down overnight but rips at the open, this is
 *                      the read that shows semis are actually hot intraday.
 *
 * Each basis carries: SSI (headline), weighted composite %, equal-weight breadth
 * (guards a lone mega-cap faking a broad move), RS vs SPX/NQ, a SOXL 3× check,
 * and per-name contributions.
 */

// Top SMH holdings + their SMH weights (%). Update if the roster drifts; weights
// are renormalised over whatever names price, so a missing name never distorts.
const SEMIS: { sym: string; weight: number }[] = [
  { sym: "NVDA", weight: 20.70 },
  { sym: "TSM",  weight: 9.09 },
  { sym: "AVGO", weight: 6.12 },
  { sym: "AMD",  weight: 5.71 },
  { sym: "AMAT", weight: 5.12 },
  { sym: "ASML", weight: 5.11 },
  { sym: "MU",   weight: 4.95 },
  { sym: "TXN",  weight: 4.69 },
  { sym: "KLAC", weight: 4.62 },
  { sym: "LRCX", weight: 4.58 },
];

// Benchmarks: SMH (semis ETF), SOXL (3× semis), SPY (S&P), QQQ (Nasdaq-100).
const BENCH = ["SMH", "SOXL", "SPY", "QQQ"] as const;

type QuoteItem = { symbol: string; last?: number; mark?: number; close?: number; prevClose?: number; open?: number; high?: number; low?: number };

// tanh squash → 0–100. SCALE = the % composite move that maps to ~88/12.
const SCALE = 1.5;
const toSSI = (compositePct: number) => Math.round((50 + 50 * Math.tanh(compositePct / SCALE)) * 10) / 10;
const ssiLabel = (ssi: number) =>
  ssi >= 70 ? "STRONG" : ssi >= 57 ? "FIRM" : ssi > 43 ? "NEUTRAL" : ssi > 30 ? "SOFT" : "WEAK";

const r2 = (n: number) => Math.round(n * 100) / 100;

type Merged = { sym: string; weight: number; price: number | null; prevClose: number | null; open: number | null };

async function getJson(path: string, token?: string): Promise<any> {
  try {
    const res = await fetch(`${proxyBase()}${path}`, {
      cache: "no-store",
      headers: token ? { "x-internal-token": token } : {},
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const symbols = [...SEMIS.map((s) => s.sym), ...BENCH].join(",");
  const token = process.env.INTERNAL_API_TOKEN;

  const q = await getJson(`/proxy/semi-quotes?symbols=${encodeURIComponent(symbols)}`, token);

  const quotes: QuoteItem[] = q?.data?.items ?? [];
  const qBy = new Map(quotes.map((x) => [String(x.symbol).toUpperCase(), x]));

  const priceOf = (sym: string): number | null => {
    const x = qBy.get(sym);
    if (!x) return null;
    if (x.last && x.last > 0) return x.last;
    if (x.mark && x.mark > 0) return x.mark;
    return null;
  };
  const posOr = (v: number | undefined | null): number | null => (v && v > 0 ? v : null);

  const merge = (sym: string, weight: number): Merged => ({
    sym,
    weight,
    price: priceOf(sym),
    prevClose: posOr(qBy.get(sym)?.prevClose),
    open: posOr(qBy.get(sym)?.open),
  });

  const semiRows = SEMIS.map((s) => merge(s.sym, s.weight));
  const benchRows = new Map(BENCH.map((b) => [b, merge(b, 0)]));

  type Basis = "prevClose" | "open";
  const baseVal = (m: Merged, basis: Basis) => (basis === "prevClose" ? m.prevClose : m.open);
  const pct = (m: Merged, basis: Basis): number | null => {
    const b = baseVal(m, basis);
    return m.price != null && b != null ? ((m.price - b) / b) * 100 : null;
  };

  function buildView(basis: Basis) {
    const rows = semiRows.map((m) => {
      const p = pct(m, basis);
      return { symbol: m.sym, weight: m.weight, price: m.price, baseline: baseVal(m, basis), pct: p, up: p == null ? null : p > 0 };
    });
    const valid = rows.filter((r) => r.pct != null);
    const wSum = valid.reduce((a, r) => a + r.weight, 0);
    const compositePct = wSum > 0 ? valid.reduce((a, r) => a + (r.weight / wSum) * (r.pct as number), 0) : 0;

    const names = rows
      .map((r) => ({
        ...r,
        pct: r.pct == null ? null : r2(r.pct),
        contribution: r.pct == null || wSum <= 0 ? null : r2((r.weight / wSum) * r.pct),
      }))
      .sort((a, b) => (b.contribution ?? -Infinity) - (a.contribution ?? -Infinity));

    const ssi = toSSI(compositePct);
    const breadthTotal = valid.length;
    const breadthUp = valid.filter((r) => (r.pct as number) > 0).length;
    const breadthPct = breadthTotal > 0 ? Math.round((breadthUp / breadthTotal) * 100) : null;

    const smhPct = pct(benchRows.get("SMH")!, basis);
    const soxlPct = pct(benchRows.get("SOXL")!, basis);
    const spyPct = pct(benchRows.get("SPY")!, basis);
    const qqqPct = pct(benchRows.get("QQQ")!, basis);

    const rsSpx = smhPct != null && spyPct != null ? r2(smhPct - spyPct) : null;
    const rsNq = smhPct != null && qqqPct != null ? r2(smhPct - qqqPct) : null;

    let soxlConfirm: { expected: number; actual: number; ratio: number | null; status: string } | null = null;
    if (smhPct != null && soxlPct != null) {
      const expected = r2(smhPct * 3);
      const ratio = Math.abs(expected) > 0.05 ? r2(soxlPct / expected) : null;
      const status = ratio == null ? "flat" : ratio >= 0.9 ? "confirming" : ratio >= 0.6 ? "soft" : "lagging";
      soxlConfirm = { expected, actual: r2(soxlPct), ratio, status };
    }

    const divergence =
      compositePct > 0.1 && breadthPct != null && breadthPct < 50 ? "narrow-up"
      : compositePct < -0.1 && breadthPct != null && breadthPct > 50 ? "narrow-down"
      : "aligned";

    return {
      available: breadthTotal > 0,
      ssi, ssiLabel: ssiLabel(ssi),
      compositePct: r2(compositePct),
      breadthUp, breadthTotal, breadthPct, divergence,
      smhPct: smhPct == null ? null : r2(smhPct),
      soxlPct: soxlPct == null ? null : r2(soxlPct),
      spyPct: spyPct == null ? null : r2(spyPct),
      qqqPct: qqqPct == null ? null : r2(qqqPct),
      rsSpx, rsNq, soxlConfirm, names,
    };
  }

  const rthOpen = buildView("open");
  // RTH-open basis is only meaningful once today's 09:30 bar exists (SMH open > 0
  // and at least one name priced its open).
  const rthOpenAvailable = benchRows.get("SMH")!.open != null && rthOpen.breadthTotal > 0;

  return NextResponse.json(
    {
      source: "thetadata",
      updatedAt: new Date().toISOString(),
      rthOpenAvailable,
      prevClose: buildView("prevClose"),
      rthOpen,
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
