import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { queryAll } from "@/lib/db";
import { proxyBase } from "@/lib/proxyForward";

// Owner-only research endpoint. Runs the edge backtests we built in chat as
// re-runnable panels for /owner/backtests. Read-only SELECTs against Postgres.
//
// SECURITY: fails CLOSED — unset/mismatched OWNER_USER_ID → 403.
// Usage: GET /api/backtests?test=cb-size | confidence | dex-preflip | gamma-wall
export const dynamic = "force-dynamic";
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

// ── tiny stats helpers ────────────────────────────────────────────────────────
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
const round = (v: number, d = 1) => { const p = 10 ** d; return Math.round(v * p) / p; };

// ══════════════════════════════════════════════════════════════════════════════
// 1. CB size → reach   (confidence_log ⋈ mvc_snapshots)
// ══════════════════════════════════════════════════════════════════════════════
async function cbSize(tol: number) {
  const rows = await queryAll<{
    date: string; level: number; raw_size: number; pct: number | null;
    touched: number; held: number; broke: number;
  }>(
    `SELECT c.date, c.level, MAX(ABS(m."mvcValueOIVol")) AS raw_size, MAX(m."pctOI_Vol") AS pct,
            c.touched, c.held, c.broke
     FROM confidence_log c
     JOIN mvc_snapshots m ON m.date = c.date AND ABS(m."strikeOIVol" - c.level) <= ?
     WHERE c.graded_at IS NOT NULL AND c.level > 0
     GROUP BY c.date, c.level, c.touched, c.held, c.broke
     ORDER BY c.date`,
    [tol],
  );
  // UNIT FIX: mvcValueOIVol is $B from import-mvc.js but raw $ from auto-snapshot-mvc.js.
  const toB = (v: number) => (Math.abs(v) > 1e5 ? Math.abs(v) / 1e9 : Math.abs(v));
  const data = rows.map((r) => ({
    date: r.date, level: Math.round(num(r.level)), size: round(toB(num(r.raw_size)), 1),
    pct: r.pct == null ? null : Math.round(num(r.pct)),
    touched: !!r.touched, held: !!r.held, broke: !!r.broke,
    outcome: r.touched ? (r.held ? "held" : r.broke ? "broke" : "-") : "-",
  }));

  const detail = data.map((d) => ({
    date: d.date, level: d.level, "size $B": d.size, "pct %": d.pct ?? "-",
    touched: d.touched ? "yes" : "no", outcome: d.outcome,
  }));

  // size terciles
  const buckets: Record<string, unknown>[] = [];
  if (data.length >= 3) {
    const sorted = [...data].sort((a, b) => a.size - b.size);
    const t1 = sorted[Math.floor(sorted.length / 3)].size;
    const t2 = sorted[Math.floor((2 * sorted.length) / 3)].size;
    const grp = (d: (typeof data)[0]) => (d.size <= t1 ? 0 : d.size <= t2 ? 1 : 2);
    const labels = [`small (≤${round(t1, 1)}B)`, "mid", `large (>${round(t2, 1)}B)`];
    for (let b = 0; b < 3; b++) {
      const g = data.filter((d) => grp(d) === b);
      const tt = g.filter((d) => d.touched);
      buckets.push({
        bucket: labels[b], n: g.length,
        "touched %": pct(tt.length, g.length),
        "held % (of touched)": tt.length ? pct(tt.filter((d) => d.held).length, tt.length) : "-",
      });
    }
  }
  const touched = data.filter((d) => d.touched), missed = data.filter((d) => !d.touched);
  return {
    detail, buckets,
    note: `${data.length} levels · avg size touched ${round(mean(touched.map((d) => d.size)), 1)}B vs missed ${round(mean(missed.map((d) => d.size)), 1)}B. Bigger CB ⇒ more likely reached; hold stays high regardless of size.`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. Confidence calibration   (confidence_log)
// ══════════════════════════════════════════════════════════════════════════════
async function confidence() {
  const rows = await queryAll<{
    date: string; level: number; regime: string | null; reach: number; pivot: number;
    chop: number; brk: number; touched: number; held: number; broke: number; actual_outcome: string | null;
  }>(
    `SELECT date, level, regime, reach, pivot, chop, "break" AS brk,
            touched, held, broke, actual_outcome
     FROM confidence_log WHERE graded_at IS NOT NULL ORDER BY date`,
  );
  const scale = Math.max(...rows.map((r) => num(r.reach)), 0) > 1.5 ? 100 : 1;
  const P = (v: unknown) => num(v) / scale;

  const detail = rows.map((r) => ({
    date: r.date, level: Math.round(num(r.level)), regime: r.regime ?? "-",
    "reach %": Math.round(100 * P(r.reach)), touched: r.touched ? "yes" : "no",
    "hold pred %": Math.round(100 * (P(r.pivot) + P(r.chop))),
    result: r.touched ? (r.held ? "held" : "broke") : "-", outcome: r.actual_outcome ?? "-",
  }));

  const touched = rows.filter((r) => r.touched);
  const cal = [
    { metric: "REACH (all days)", "predicted %": Math.round(100 * mean(rows.map((r) => P(r.reach)))), "actual %": pct(touched.length, rows.length) },
  ];
  if (touched.length) {
    cal.push({ metric: "HOLD (of touched)", "predicted %": Math.round(100 * mean(touched.map((r) => P(r.pivot) + P(r.chop)))), "actual %": pct(touched.filter((r) => r.held).length, touched.length) });
    cal.push({ metric: "BREAK (of touched)", "predicted %": Math.round(100 * mean(touched.map((r) => P(r.brk)))), "actual %": pct(touched.filter((r) => r.broke).length, touched.length) });
  }
  // reach by predicted bucket
  const rb = [[0, 0.4, "low <40%"], [0.4, 0.7, "mid 40-70%"], [0.7, 1.01, "high >70%"]] as const;
  const reachBuckets = rb.map(([lo, hi, lbl]) => {
    const g = rows.filter((r) => P(r.reach) >= lo && P(r.reach) < hi);
    return { bucket: lbl, n: g.length, "actual reached %": g.length ? pct(g.filter((r) => r.touched).length, g.length) : "-" };
  });
  return {
    detail, calibration: cal, reachBuckets,
    note: `${rows.length} graded days, ${touched.length} touched. Reach score discriminates well; hold is under-predicted (walls hold more than scored), break is over-predicted.`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. DEX pre-flip alert   (greeks_ts, RTH 5-min buckets)
// ══════════════════════════════════════════════════════════════════════════════
async function dexPreflip(greek: "dex" | "gex", hitAbs: number, lookMin: number, minPRange: number, edges: boolean) {
  const col = greek === "gex" ? "gex" : "dex";
  const rows = await queryAll<{ date: string; ts: string; val: number }>(
    `SELECT date, timestamp AS ts, ${col} AS val FROM greeks_ts
     WHERE ticker='SPXW' AND ${col} IS NOT NULL AND "time" >= '09:30' AND "time" < '16:00'
     ORDER BY date, timestamp ASC`,
  );
  const BUCKET_MS = 5 * 60_000;
  const rng = (a: number[]) => Math.max(...a) - Math.min(...a);
  const byDate = new Map<string, { ts: number; val: number }[]>();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push({ ts: Number(r.ts), val: num(r.val) });
  }
  const etMins = (ms: number) => {
    const s = new Date(ms).toLocaleString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
    return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  };
  const etHour = (ms: number) => Math.floor(etMins(ms) / 60);
  const inEdges = (ms: number) => { const m = etMins(ms); return (m >= 570 && m < 690) || (m >= 840 && m < 960); };

  function bucketsFor(day: { ts: number; val: number }[]) {
    const m = new Map<number, number[]>();
    for (const r of day) { const k = Math.floor(r.ts / BUCKET_MS); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r.val); }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ ts: k * BUCKET_MS, avg: mean(v), range: rng(v), lo: Math.min(...v), hi: Math.max(...v) }));
  }
  function alertsFor(bk: ReturnType<typeof bucketsFor>, mult: number) {
    const out: { ts: number; hit: boolean; flip: boolean }[] = [];
    for (let i = 3; i < bk.length; i++) {
      const b = bk[i], prior = bk.slice(i - 3, i);
      const priAvgRange = mean(prior.map((p) => p.range)) || 1e-9;
      const priWinRange = rng(prior.flatMap((p) => [p.lo, p.hi])) || 1e-9;
      const priWinAvg = mean(prior.map((p) => p.avg));
      if (priAvgRange < minPRange) continue;
      if (!(b.range >= mult * priAvgRange && Math.abs(b.avg - priWinAvg) < priWinRange)) continue;
      const fwd = bk.filter((x) => x.ts > b.ts && x.ts <= b.ts + lookMin * 60_000);
      let hit = false, flip = false;
      for (const f of fwd) {
        if (Math.abs(f.avg - b.avg) >= hitAbs) hit = true;
        if (Math.sign(f.avg) && Math.sign(b.avg) && Math.sign(f.avg) !== Math.sign(b.avg)) flip = true;
      }
      out.push({ ts: b.ts, hit: hit || flip, flip });
    }
    return out;
  }

  const summary: Record<string, unknown>[] = [];
  const hourly: Record<string, unknown>[] = [];
  for (const mult of [2, 3]) {
    let total = 0, hits = 0, flips = 0;
    const byHour = new Map<number, { n: number; h: number }>();
    for (const day of byDate.values()) {
      let a = alertsFor(bucketsFor(day), mult);
      if (edges) a = a.filter((x) => inEdges(x.ts));
      total += a.length; hits += a.filter((x) => x.hit).length; flips += a.filter((x) => x.flip).length;
      for (const x of a) { const hr = etHour(x.ts); const e = byHour.get(hr) ?? { n: 0, h: 0 }; e.n++; if (x.hit) e.h++; byHour.set(hr, e); }
    }
    summary.push({ threshold: `${mult}×`, alerts: total, hits, "hit %": pct(hits, total), flips });
    for (const hr of [...byHour.keys()].sort((a, b) => a - b)) {
      const e = byHour.get(hr)!;
      hourly.push({ threshold: `${mult}×`, "ET hour": `${String(hr).padStart(2, "0")}:00`, alerts: e.n, hits: e.h, "hit %": pct(e.h, e.n) });
    }
  }
  return { summary, hourly, note: `${greek.toUpperCase()} · ${byDate.size} RTH days · hit = |Δ| ≥ $${hitAbs}B or flip within ${lookMin}m${edges ? " · edges only (open/close)" : ""}.` };
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. Gamma wall pin / reject   (option_strike_gex_history)
// ══════════════════════════════════════════════════════════════════════════════
async function gammaWall(tol: number, near: number, minRange: number) {
  const rows = await queryAll<{ date: string; wall: number; open_spot: number; close_spot: number; lo: number; hi: number }>(
    `WITH snap AS (
       SELECT date, timestamp AS ts, spot, strike, net_gex FROM option_strike_gex_history
       WHERE spot > 0 AND net_gex IS NOT NULL AND EXTRACT(DOW FROM date::date) BETWEEN 1 AND 5
     ),
     spots AS (SELECT DISTINCT date, ts, spot FROM snap),
     day AS (SELECT date, MIN(ts) open_ts, MAX(ts) close_ts, MIN(spot) lo, MAX(spot) hi FROM spots GROUP BY date),
     open_spot  AS (SELECT s.date, MIN(s.spot) spot FROM spots s JOIN day d ON s.date=d.date AND s.ts=d.open_ts  GROUP BY s.date),
     close_spot AS (SELECT s.date, MIN(s.spot) spot FROM spots s JOIN day d ON s.date=d.date AND s.ts=d.close_ts GROUP BY s.date),
     open_strikes AS (
       SELECT sn.date, sn.strike, SUM(sn.net_gex) g FROM snap sn
       JOIN day d ON sn.date=d.date AND sn.ts=d.open_ts JOIN open_spot o ON o.date=sn.date
       WHERE ABS(sn.strike - o.spot) <= ? GROUP BY sn.date, sn.strike
     ),
     wall AS (SELECT DISTINCT ON (date) date, strike wall FROM open_strikes ORDER BY date, g DESC)
     SELECT d.date, w.wall, o.spot open_spot, c.spot close_spot, d.lo, d.hi
     FROM day d JOIN wall w ON w.date=d.date JOIN open_spot o ON o.date=d.date JOIN close_spot c ON c.date=d.date
     WHERE d.open_ts < d.close_ts AND (d.hi - d.lo) >= ? ORDER BY d.date`,
    [near, minRange],
  );
  let days = 0, pulled = 0, sumO = 0, sumC = 0, approached = 0, rejected = 0;
  const detail = rows.map((r) => {
    const wall = num(r.wall), sO = num(r.open_spot), sC = num(r.close_spot), hi = num(r.hi), lo = num(r.lo);
    const openD = Math.abs(sO - wall), closeD = Math.abs(sC - wall);
    if (closeD < openD) pulled++;
    days++; sumO += openD; sumC += closeD;
    let side = "at-spot", app = false, rej = false;
    if (wall > sO + tol) { side = "resist"; app = hi >= wall - tol; if (app) rej = sC <= wall + tol; }
    else if (wall < sO - tol) { side = "support"; app = lo <= wall + tol; if (app) rej = sC >= wall - tol; }
    if (app) { approached++; if (rej) rejected++; }
    return { date: r.date, wall: Math.round(wall), open: Math.round(sO), close: Math.round(sC), "openΔ": Math.round(openD), "closeΔ": Math.round(closeD), side, approached: app ? "yes" : "-", result: app ? (rej ? "REJECT" : "broke") : "-" };
  });
  return {
    detail,
    summary: [
      { metric: "Avg dist to wall — open", value: `${round(sumO / (days || 1), 1)} pt` },
      { metric: "Avg dist to wall — close", value: `${round(sumC / (days || 1), 1)} pt` },
      { metric: "Pulled toward wall by close", value: `${pulled}/${days} (${pct(pulled, days)}%)` },
      { metric: "Approached wall", value: `${approached}/${days}` },
      { metric: "Rejected (of approached)", value: approached ? `${rejected}/${approached} (${pct(rejected, approached)}%)` : "-" },
    ],
    note: `${days} sessions. Pin holds only if close-distance < open-distance and pulled% > 50. Wall = largest positive net-GEX strike near spot at open.`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. Normalized GEX per strike   (live chain, one ticker + expiration)
// Normalized GEX (%) = |strike net GEX| / Σ|net GEX across all strikes| × 100.
// Same OI+Vol GEX formula as parseExpiration() in app/options-chain/page.tsx:
//   gex = (callGamma·callCount − putGamma·putCount) · spot² · 0.01 · 100
//   count = open-interest + volume
// ══════════════════════════════════════════════════════════════════════════════
async function normalizedGex(ticker: string, expiration: string) {
  const url = `${proxyBase()}/proxy/api/tt/chains/${encodeURIComponent(ticker)}?expiration=${encodeURIComponent(expiration)}&range=all`;
  const internalToken = process.env.INTERNAL_API_TOKEN;
  const res = await fetch(url, {
    cache: "no-store",
    headers: internalToken ? { "x-internal-token": internalToken } : {},
  });
  if (!res.ok) throw new Error(`chain fetch failed: HTTP ${res.status}`);
  const json = await res.json();
  const data = (json?.data ?? {}) as { underlyingPrice?: unknown; items?: unknown[] };
  const spot = num(data.underlyingPrice);
  if (!spot) throw new Error(`no live spot for ${ticker} — check ticker`);

  const allGroups = (data.items ?? []) as { "expiration-date"?: string; strikes?: unknown[] }[];
  const groups = allGroups.filter((g) => String(g["expiration-date"] ?? "").slice(0, 10) === expiration.slice(0, 10));
  const target = groups.length ? groups : allGroups; // fall back if TT already scoped to one expiry
  if (!target.length) throw new Error(`no chain data for ${ticker} ${expiration} — check the expiration date`);

  const S = spot;
  const rows: { strike: number; gex: number }[] = [];
  for (const g of target) {
    for (const item of (g.strikes ?? []) as Record<string, unknown>[]) {
      const strike = num(item["strike-price"]);
      if (!strike) continue;
      const c = item.call as Record<string, unknown> | undefined;
      const p = item.put as Record<string, unknown> | undefined;
      const cnt = (o: Record<string, unknown> | undefined) =>
        o ? (num(o["open-interest"] ?? o.openInterest) + num(o.volume)) : 0;
      const cc = cnt(c), pc = cnt(p);
      if (!cc && !pc) continue;
      const gex = (num(c?.gamma) * cc - num(p?.gamma) * pc) * S * S * 0.01 * 100;
      rows.push({ strike, gex });
    }
  }
  if (!rows.length) throw new Error(`no strikes with OI/volume for ${ticker} ${expiration}`);

  const totalAbs = rows.reduce((s, r) => s + Math.abs(r.gex), 0);
  const detail = rows
    .map((r) => ({
      strike: r.strike,
      "net GEX": Math.round(r.gex),
      "normalized %": totalAbs > 0 ? round((Math.abs(r.gex) / totalAbs) * 100, 2) : 0,
    }))
    .sort((a, b) => b.strike - a.strike);

  return {
    detail,
    note: `${ticker.toUpperCase()} · ${expiration} · spot ${round(spot, 2)} · ${detail.length} strikes. Normalized GEX (%) = |strike net GEX| / Σ|net GEX| × 100.`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
export async function GET(req: NextRequest) {
  const userId = await getServerUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!OWNER_USER_ID || userId !== OWNER_USER_ID) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const q = req.nextUrl.searchParams;
  const test = q.get("test");
  const n = (k: string, d: number) => { const v = Number(q.get(k)); return Number.isFinite(v) ? v : d; };
  try {
    let body: unknown;
    if (test === "cb-size") body = await cbSize(n("tol", 10));
    else if (test === "confidence") body = await confidence();
    else if (test === "dex-preflip")
      body = await dexPreflip((q.get("greek") === "gex" ? "gex" : "dex"), n("hitAbs", 50), n("lookMin", 20), n("minPRange", 5), q.get("edges") === "1");
    else if (test === "gamma-wall") body = await gammaWall(n("tol", 5), n("near", 150), n("minRange", 5));
    else if (test === "normalized-gex") body = await normalizedGex((q.get("ticker") || "SPX").trim().toUpperCase(), (q.get("expiration") || "").trim());
    else return NextResponse.json({ error: "unknown test" }, { status: 400 });
    return NextResponse.json({ ok: true, test, ...(body as object) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
