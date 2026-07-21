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
// 6. GEX / DEX flip cross → forward MFE/MAE   (option_strike_gex_history + greek_snapshots)
// Reconstructs the intraday zero-gamma (GEX) and zero-net-delta (DEX, 0DTE) flip
// per snapshot as the cumulative-exposure zero-cross nearest spot, detects when
// SPX crosses it, and measures forward favorable/adverse excursion. Reports both
// continuation (trade the cross) and fade (reverse) since MFE/MAE simply swap.
// Guards: chain must bracket spot & flip within ±band; price must move (kills
// frozen-quote phantoms); DEX spot re-sourced from the clean option-table path.
// ══════════════════════════════════════════════════════════════════════════════
type XSnap = { t: number; spot: number; flip: number };
type XPx = { t: number; spot: number };
type XCross = { d: string; time: string; dir: number; spot0: number; flip: number; mfe: number; mae: number };

async function gexDexCross(horizonMin: number, hit: number, band: number, days: number, gapMin: number) {
  const cut = Date.now() - days * 86_400_000;
  const Hm = horizonMin * 60_000, GAP = gapMin * 60_000, TOL = 180_000;
  const etd = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const et = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });

  // clean SPX price path (spot in option_strike_gex_history is the SPX index)
  const pxRows = await queryAll<{ t: string; spot: number }>(
    `SELECT timestamp AS t, MAX(spot) spot FROM option_strike_gex_history
     WHERE spot IS NOT NULL AND timestamp > ? GROUP BY timestamp ORDER BY timestamp`, [cut]);
  const P: XPx[] = pxRows.map((r) => ({ t: Number(r.t), spot: num(r.spot) }));
  if (P.length < 2) throw new Error("no SPX price path in window");

  const flipFrom = (rows: { strike: number; v: number }[], spot: number): number | null => {
    if (rows.length < 40) return null;
    if (!(rows[0].strike < spot && rows[rows.length - 1].strike > spot)) return null;
    let cum = 0, best: number | null = null, bd = 1e9, pS: number | null = null, pC = 0;
    for (const r of rows) {
      const nc = cum + r.v;
      if (pS != null && ((pC <= 0 && nc > 0) || (pC >= 0 && nc < 0)) && nc - pC !== 0) {
        const k = pS + (r.strike - pS) * (0 - pC) / (nc - pC);
        const d = Math.abs(k - spot);
        if (d < bd && d <= band) { bd = d; best = k; }
      }
      pS = r.strike; pC = nc; cum = nc;
    }
    return best;
  };
  const nearestSpot = (t: number): number | null => {
    let lo = 0, hi = P.length - 1;
    if (t < P[0].t - TOL || t > P[hi].t + TOL) return null;
    while (lo < hi) { const m = (lo + hi) >> 1; if (P[m].t < t) lo = m + 1; else hi = m; }
    let best = P[lo];
    for (const j of [lo - 1, lo]) if (j >= 0 && j < P.length && Math.abs(P[j].t - t) < Math.abs(best.t - t)) best = P[j];
    return Math.abs(best.t - t) <= TOL ? best.spot : null;
  };
  const exc = (t0: number, spot0: number, dir: number) => {
    const st = P.findIndex((p) => p.t > t0);
    if (st < 0) return null;
    let mu = 0, md = 0, cnt = 0;
    for (let i = st; i < P.length; i++) { const p = P[i]; if (p.t > t0 + Hm) break; const dd = p.spot - spot0; if (dd > mu) mu = dd; if (dd < md) md = dd; cnt++; }
    if (!cnt) return null;
    return { mfe: dir > 0 ? mu : -md, mae: dir > 0 ? -md : mu };
  };
  const crossesOf = (series: XSnap[]): XCross[] => {
    const byD = new Map<string, XSnap[]>();
    for (const r of series) { const d = etd(r.t); if (!byD.has(d)) byD.set(d, []); byD.get(d)!.push(r); }
    const out: XCross[] = [];
    for (const rows of byD.values()) {
      rows.sort((a, b) => a.t - b.t);
      let lt = -1e15, ld = 0;
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1], b = rows[i];
        if (a.spot === b.spot) continue;
        const pa = a.spot - a.flip, pb = b.spot - b.flip;
        if (!pa || !pb) continue;
        if ((pa < 0 && pb > 0) || (pa > 0 && pb < 0)) {
          const dir = pb > 0 ? 1 : -1;
          if (dir === ld && b.t - lt < GAP) continue;
          lt = b.t; ld = dir;
          const e = exc(b.t, b.spot, dir);
          if (!e) continue;
          out.push({ d: etd(b.t), time: et(b.t), dir, spot0: round(b.spot, 2), flip: round(b.flip, 2), mfe: round(e.mfe, 1), mae: round(e.mae, 1) });
        }
      }
    }
    return out;
  };
  const buildSeries = async (sql: string, reSourceSpot: boolean): Promise<XSnap[]> => {
    const rows = await queryAll<{ t: string; strike: number; v: number; spot: number }>(sql, [cut]);
    const map = new Map<number, { spot: number; rows: { strike: number; v: number }[] }>();
    for (const r of rows) { const k = Math.round(Number(r.t)); if (!map.has(k)) map.set(k, { spot: num(r.spot), rows: [] }); map.get(k)!.rows.push({ strike: num(r.strike), v: num(r.v) }); }
    const ser: XSnap[] = [];
    for (const [k, o] of map) {
      const f = flipFrom(o.rows, o.spot);
      if (f == null) continue;
      const sp = reSourceSpot ? nearestSpot(k) : o.spot;
      if (sp == null) continue;
      ser.push({ t: k, spot: sp, flip: f });
    }
    return ser.sort((a, b) => a.t - b.t);
  };

  const gexCr = crossesOf(await buildSeries(
    `SELECT timestamp AS t, strike, SUM(net_gex) v, MAX(spot) spot FROM option_strike_gex_history
     WHERE timestamp > ? GROUP BY timestamp, strike ORDER BY timestamp, strike`, false));
  const dexCr = crossesOf(await buildSeries(
    `SELECT EXTRACT(EPOCH FROM ts) * 1000 AS t, strike, SUM(delta_net) v, MAX(spot) spot FROM greek_snapshots
     WHERE symbol='SPX' AND expiry = date AND delta_net IS NOT NULL AND EXTRACT(EPOCH FROM ts) * 1000 > ?
     GROUP BY ts, strike ORDER BY ts, strike`, true));

  const stat = (label: string, cr: XCross[]) => {
    const up = cr.filter((x) => x.dir > 0), dn = cr.filter((x) => x.dir < 0);
    const hc = (g: XCross[]) => (g.length ? pct(g.filter((x) => x.mfe >= hit).length, g.length) : 0);
    const hf = (g: XCross[]) => (g.length ? pct(g.filter((x) => x.mae >= hit).length, g.length) : 0);
    return {
      signal: label, n: cr.length,
      "cont hit %": hc(cr), "cont MFE": round(mean(cr.map((x) => x.mfe)), 2), "cont MAE": round(mean(cr.map((x) => x.mae)), 2),
      "fade hit %": hf(cr), "fade MFE": round(mean(cr.map((x) => x.mae)), 2), "fade MAE": round(mean(cr.map((x) => x.mfe)), 2),
      "up hit %": hc(up), "dn hit %": hc(dn),
    };
  };

  const detail = [...gexCr.map((x) => ({ signal: "GEX", ...x })), ...dexCr.map((x) => ({ signal: "DEX", ...x }))]
    .sort((a, b) => (a.d === b.d ? (a.time < b.time ? -1 : 1) : a.d < b.d ? -1 : 1))
    .map((x) => ({ signal: x.signal, date: x.d, time: x.time, dir: x.dir > 0 ? "UP" : "DN", spot: x.spot0, flip: x.flip, MFE: x.mfe, MAE: x.mae }));

  const from = etd(P[0].t), to = etd(P[P.length - 1].t);
  return {
    summary: [stat("GEX flip (0γ)", gexCr), stat("DEX flip (0Δ)", dexCr)],
    detail,
    note: `${from}→${to} · GEX ${gexCr.length} crosses, DEX ${dexCr.length} · horizon ${horizonMin}m · "hit" = favorable ≥ ${hit}pt · flip band ±${band}pt. "cont" = trade the cross (continuation), "fade" = reverse (MFE/MAE swap). Small sample — directional only.`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. Strike GEX since touch   (option_strike_gex_history)
// How much has net GEX at a given strike grown / bled since price last tagged it.
// Touch = first snapshot in the window where |spot − strike| ≤ band. Compares that
// snapshot's summed net_gex to the latest, plus peak/trough since the touch.
// net_gex is raw $ (≈1e9 = $1B); summed across all expiries at the strike.
// ══════════════════════════════════════════════════════════════════════════════
async function strikeTouch(strike: number, band: number, days: number) {
  const cut = Date.now() - days * 86_400_000;
  const et = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const B = (v: number) => round(v / 1e9, 3);
  const rows = await queryAll<{ t: string; spot: number; gex: number }>(
    `SELECT timestamp AS t, MAX(spot) spot, SUM(net_gex) gex
       FROM option_strike_gex_history
      WHERE strike = ? AND timestamp > ? AND spot IS NOT NULL
      GROUP BY timestamp ORDER BY timestamp`, [strike, cut]);
  if (rows.length < 2) throw new Error(`no data for strike ${strike} in last ${days}d`);
  const S = rows.map((r) => ({ t: Number(r.t), spot: num(r.spot), gex: num(r.gex) }));
  const touchIdx = S.findIndex((r) => Math.abs(r.spot - strike) <= band);
  if (touchIdx < 0) throw new Error(`spot never within ±${band}pt of ${strike} in last ${days}d`);
  const touch = S[touchIdx], now = S[S.length - 1], since = S.slice(touchIdx);
  const peak = since.reduce((a, b) => (b.gex > a.gex ? b : a));
  const trough = since.reduce((a, b) => (b.gex < a.gex ? b : a));
  const d = now.gex - touch.gex;
  const p = touch.gex ? round((100 * d) / Math.abs(touch.gex), 1) : 0;
  let touches = 0, wasOut = true;
  for (const r of S) { const inb = Math.abs(r.spot - strike) <= band; if (inb && wasOut) touches++; wasOut = !inb; }
  const sg = (v: number) => `${v >= 0 ? "+" : ""}${v}`;
  const step = Math.max(1, Math.ceil(since.length / 60));
  const detail = since.filter((_, i) => i % step === 0 || i === since.length - 1)
    .map((r) => ({ time: et(r.t), spot: round(r.spot, 2), "GEX $B": B(r.gex) }));
  return {
    summary: [
      { metric: "Touched (first tag)", when: et(touch.t), spot: round(touch.spot, 2), "GEX $B": B(touch.gex) },
      { metric: "Now", when: et(now.t), spot: round(now.spot, 2), "GEX $B": B(now.gex) },
      { metric: "Δ since touch", when: `${sg(B(d))} $B`, spot: "", "GEX $B": `${sg(p)}%` },
      { metric: "Peak since touch", when: et(peak.t), spot: "", "GEX $B": B(peak.gex) },
      { metric: "Trough since touch", when: et(trough.t), spot: "", "GEX $B": B(trough.gex) },
    ],
    detail,
    note: `Strike ${strike} · ${touches} touch(es) within ±${band}pt in last ${days}d · touch = first tag. GEX ${d >= 0 ? "grew" : "lost"} ${B(Math.abs(d))} $B (${sg(p)}%) since first tag. net_gex summed across all expiries.`,
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
    else if (test === "gex-dex-cross") body = await gexDexCross(n("horizon", 30), n("hit", 5), n("band", 60), n("days", 30), n("gap", 5));
    else if (test === "strike-touch") body = await strikeTouch(n("strike", 7500), n("band", 0.75), n("days", 1));
    else return NextResponse.json({ error: "unknown test" }, { status: 400 });
    return NextResponse.json({ ok: true, test, ...(body as object) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
