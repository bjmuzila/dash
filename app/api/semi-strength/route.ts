import { NextResponse } from "next/server";
import { proxyBase } from "@/lib/proxyForward";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /api/semi-strength — Semiconductor Strength Index (SSI).
 *
 * A single 0–100 read on how strong semis are RIGHT NOW, sourced entirely from
 * ThetaData stock snapshots (via the in-process proxy's /proxy/quotes — the same
 * theta-first equity feed the watchlist uses; NOT Robinhood/Yahoo).
 *
 * Components:
 *   • SSI (headline)  — SMH-weight-weighted composite of each top holding's
 *                       intraday % move vs prior close, squashed to 0–100.
 *   • Breadth         — how many of the top holdings are green vs prior close
 *                       (equal-weight; catches NVDA masking the tape).
 *   • RS vs SPX / NQ  — SMH % move minus SPY / QQQ % move (leadership).
 *   • SOXL confirm    — is the 3× ETF pulling its ~3× weight, or lagging.
 *   • Per-name rows   — weight, %move, and contribution (weight × %move).
 */

// Top SMH holdings + their SMH weights (%). From the fund's published holdings;
// update if the roster drifts. Weights are renormalised over whatever names
// return a valid quote, so a missing name never distorts the composite.
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

type QuoteItem = { symbol: string; last?: number; mark?: number; close?: number; prevClose?: number };

// tanh squash → 0–100. SCALE = the % composite move that maps to ~88/12.
// ±1.5% intraday in the semis basket is a decisive day, so anchor there.
const SCALE = 1.5;
function toSSI(compositePct: number): number {
  const t = Math.tanh(compositePct / SCALE); // -1..1
  return Math.round((50 + 50 * t) * 10) / 10;
}

function ssiLabel(ssi: number): string {
  if (ssi >= 70) return "STRONG";
  if (ssi >= 57) return "FIRM";
  if (ssi > 43) return "NEUTRAL";
  if (ssi > 30) return "SOFT";
  return "WEAK";
}

// Intraday % vs prior close. Prefer live last, fall back to after-hours mark.
function pctOf(q: QuoteItem | undefined): number | null {
  if (!q) return null;
  const price = (q.last && q.last > 0 ? q.last : 0) || (q.mark && q.mark > 0 ? q.mark : 0);
  const prev = q.prevClose && q.prevClose > 0 ? q.prevClose : 0;
  if (!(price > 0) || !(prev > 0)) return null;
  return ((price - prev) / prev) * 100;
}

export async function GET() {
  const symbols = [...SEMIS.map((s) => s.sym), ...BENCH].join(",");
  const internalToken = process.env.INTERNAL_API_TOKEN;

  let items: QuoteItem[] = [];
  try {
    const res = await fetch(`${proxyBase()}/proxy/quotes?symbols=${encodeURIComponent(symbols)}`, {
      cache: "no-store",
      headers: internalToken ? { "x-internal-token": internalToken } : {},
    });
    if (res.ok) {
      const j = await res.json();
      items = j?.data?.items ?? [];
    }
  } catch {
    /* fall through to empty → nulls below */
  }

  const byS = new Map(items.map((q) => [String(q.symbol).toUpperCase(), q]));
  const priceOf = (q: QuoteItem | undefined) =>
    q ? (q.last && q.last > 0 ? q.last : q.mark && q.mark > 0 ? q.mark : null) : null;

  // Per-name rows (only names with a valid quote count toward the composite).
  const rows = SEMIS.map(({ sym, weight }) => {
    const q = byS.get(sym);
    const pct = pctOf(q);
    return { symbol: sym, weight, price: priceOf(q), prevClose: q?.prevClose ?? null, pct, up: pct == null ? null : pct > 0 };
  });

  const valid = rows.filter((r) => r.pct != null);
  const wSum = valid.reduce((a, r) => a + r.weight, 0);

  // Weighted composite % move (renormalised over the names that priced).
  const compositePct = wSum > 0 ? valid.reduce((a, r) => a + (r.weight / wSum) * (r.pct as number), 0) : 0;

  // Contribution to the composite (renormalised weight × %move), for ranking.
  const named = rows
    .map((r) => ({
      ...r,
      pct: r.pct == null ? null : Math.round(r.pct * 100) / 100,
      contribution: r.pct == null || wSum <= 0 ? null : Math.round((r.weight / wSum) * r.pct * 100) / 100,
    }))
    .sort((a, b) => (b.contribution ?? -Infinity) - (a.contribution ?? -Infinity));

  const ssi = toSSI(compositePct);

  // Breadth (equal-weight): how many top holdings are green vs prior close.
  const breadthTotal = valid.length;
  const breadthUp = valid.filter((r) => (r.pct as number) > 0).length;
  const breadthPct = breadthTotal > 0 ? Math.round((breadthUp / breadthTotal) * 100) : null;

  // Benchmark moves.
  const smhPct = pctOf(byS.get("SMH"));
  const soxlPct = pctOf(byS.get("SOXL"));
  const spyPct = pctOf(byS.get("SPY"));
  const qqqPct = pctOf(byS.get("QQQ"));

  // Relative strength: semis (SMH) vs the broad tape / broad tech.
  const rsSpx = smhPct != null && spyPct != null ? Math.round((smhPct - spyPct) * 100) / 100 : null;
  const rsNq = smhPct != null && qqqPct != null ? Math.round((smhPct - qqqPct) * 100) / 100 : null;

  // SOXL is 3× SMH — is it pulling its weight, or decaying/lagging?
  let soxlConfirm: { expected: number; actual: number; ratio: number | null; status: string } | null = null;
  if (smhPct != null && soxlPct != null) {
    const expected = Math.round(smhPct * 3 * 100) / 100;
    const ratio = Math.abs(expected) > 0.05 ? Math.round((soxlPct / expected) * 100) / 100 : null;
    const status =
      ratio == null ? "flat" : ratio >= 0.9 ? "confirming" : ratio >= 0.6 ? "soft" : "lagging";
    soxlConfirm = { expected, actual: Math.round(soxlPct * 100) / 100, ratio, status };
  }

  // Divergence flag: index green but breadth thin (few names carrying).
  const divergence =
    compositePct > 0.1 && breadthPct != null && breadthPct < 50
      ? "narrow-up"
      : compositePct < -0.1 && breadthPct != null && breadthPct > 50
      ? "narrow-down"
      : "aligned";

  return NextResponse.json(
    {
      source: "thetadata",
      updatedAt: new Date().toISOString(),
      ssi,
      ssiLabel: ssiLabel(ssi),
      compositePct: Math.round(compositePct * 100) / 100,
      breadthUp,
      breadthTotal,
      breadthPct,
      divergence,
      smhPct: smhPct == null ? null : Math.round(smhPct * 100) / 100,
      soxlPct: soxlPct == null ? null : Math.round(soxlPct * 100) / 100,
      spyPct: spyPct == null ? null : Math.round(spyPct * 100) / 100,
      qqqPct: qqqPct == null ? null : Math.round(qqqPct * 100) / 100,
      rsSpx,
      rsNq,
      soxlConfirm,
      names: named,
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
