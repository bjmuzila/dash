#!/usr/bin/env node
/* CB (MVC) level dynamics through the RTH day — the eod-cb-reach report
 * FROZE the CB level as of 2pm, which assumes it's roughly static in the
 * final 2 hours. Brandon's point: it isn't — the CB level itself moves, and
 * maybe moves faster/more often late in the day. This script doesn't assume
 * an answer — it lays out every raw mvc_snapshots row (not just the pre-2pm
 * one) next to the nearest SPX spot, per day, so the actual data can be
 * eyeballed, plus a pooled stat comparing snapshot-to-snapshot CB movement
 * before 2pm vs during 2-4pm across all days.
 *
 * Run on VPS:  docker exec -i dashboard-dashboard-1 node - < scripts/backtest-cb-eod-dynamics.mjs
 * Env knobs:   DAYS (default 30), DETAIL_DAYS (default 8 — how many of the
 *              most recent days to print full per-snapshot timelines for)
 */
import pg from "pg";

const DAYS = Number(process.env.DAYS ?? 30);
const DETAIL_DAYS = Number(process.env.DETAIL_DAYS ?? 8);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sinceExpr = `(CURRENT_DATE - INTERVAL '${DAYS} days')::date::text`;

function etParts(ts) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ts));
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get("hour")), minute: Number(get("minute")) };
}
const etMinutes = (ts) => { const { hour, minute } = etParts(ts); return hour * 60 + minute; };
const etHM = (ts) => { const { hour, minute } = etParts(ts); return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`; };

// ── every CB (MVC) snapshot, full RTH, not just pre-2pm ────────────────────
const { rows: cbRowsRaw } = await pool.query(`
  SELECT date, timestamp AS ts, "strikeOIVol" AS cb, "mvcValueOIVol" AS cb_size_raw
  FROM mvc_snapshots
  WHERE "strikeOIVol" > 0 AND date >= ${sinceExpr}
  ORDER BY date, timestamp ASC
`);
const toB = (v) => (Number.isFinite(v) && Math.abs(v) > 1e5 ? v / 1e9 : v);
const cbByDate = new Map();
for (const r of cbRowsRaw) {
  const d = String(r.date);
  if (!cbByDate.has(d)) cbByDate.set(d, []);
  cbByDate.get(d).push({ ts: Number(r.ts), cb: Number(r.cb), cbSize: toB(Number(r.cb_size_raw)) });
}

// ── SPX spot across the whole RTH session, time-filtered in SQL (same lesson
//    as the other two scripts — this table is per-strike/per-minute, DISTINCT
//    on (date,ts,spot) drops the strike dimension so it stays small) ───────
const { rows: priceRows } = await pool.query(`
  SELECT DISTINCT date, timestamp AS ts, spot
  FROM option_strike_gex_history
  WHERE spot > 0 AND date >= ${sinceExpr}
    AND (to_timestamp(timestamp/1000.0) AT TIME ZONE 'America/New_York')::time BETWEEN '09:30' AND '16:00'
  ORDER BY date, timestamp ASC
`);
await pool.end();
console.log(`mvc_snapshots: ${cbRowsRaw.length} rows across ${cbByDate.size} days   option_strike_gex_history (RTH rows): ${priceRows.length}`);

const pricesByDate = new Map();
for (const r of priceRows) {
  const d = String(r.date);
  if (!pricesByDate.has(d)) pricesByDate.set(d, []);
  pricesByDate.get(d).push({ ts: Number(r.ts), spot: Number(r.spot) });
}
for (const arr of pricesByDate.values()) arr.sort((a, b) => a.ts - b.ts);

// nearest spot at-or-before a given ts (linear scan is fine — per-day arrays are small)
function spotNear(dayPrices, ts) {
  if (!dayPrices || !dayPrices.length) return null;
  let best = null;
  for (const p of dayPrices) { if (p.ts <= ts) best = p; else break; }
  return best ? best.spot : dayPrices[0].spot;
}

// data-quality guard, same reasoning as backtest-eod-cb-reach.mjs
const RANGE_CAP = Number(process.env.RANGE_CAP ?? 150);

// ── pooled stat: |ΔCB| per snapshot-to-snapshot step, pre-2pm vs 2-4pm ──────
let preN = 0, preSum = 0, postN = 0, postSum = 0;
const dates = [...cbByDate.keys()].sort();
for (const date of dates) {
  const snaps = cbByDate.get(date).slice().sort((a, b) => a.ts - b.ts);
  const dayPrices = pricesByDate.get(date);
  if (dayPrices) {
    const spots = dayPrices.map((p) => p.spot);
    if (Math.max(...spots) - Math.min(...spots) > RANGE_CAP) continue; // bad-data day, skip entirely
  }
  for (let i = 1; i < snaps.length; i++) {
    const a = snaps[i - 1], b = snaps[i];
    const delta = Math.abs(b.cb - a.cb);
    const atPm = etMinutes(b.ts) >= 14 * 60; // bucket the step by the LATER snapshot's time
    if (atPm) { postN++; postSum += delta; } else { preN++; preSum += delta; }
  }
}
console.log(`\n=== CB level movement per snapshot-step: pre-2pm vs 2-4pm ET (pooled, ${dates.length} days) ===`);
console.table([
  { window: "before 2pm", steps: preN, "avg |ΔCB| pt": preN ? +(preSum / preN).toFixed(1) : "-" },
  { window: "2-4pm", steps: postN, "avg |ΔCB| pt": postN ? +(postSum / postN).toFixed(1) : "-" },
]);

// ── per-day detail timelines for the most recent DETAIL_DAYS days ─────────
const recentDates = dates.slice(-DETAIL_DAYS);
for (const date of recentDates) {
  const snaps = cbByDate.get(date).slice().sort((a, b) => a.ts - b.ts);
  const dayPrices = pricesByDate.get(date);
  if (dayPrices) {
    const spots = dayPrices.map((p) => p.spot);
    if (Math.max(...spots) - Math.min(...spots) > RANGE_CAP) {
      console.log(`\n=== ${date} — SKIPPED (>${RANGE_CAP}pt range, bad spot data) ===`);
      continue;
    }
  }
  const rows = snaps.map((s, i) => {
    const spot = spotNear(dayPrices, s.ts);
    const prev = i > 0 ? snaps[i - 1] : null;
    return {
      time: etHM(s.ts),
      cb: Math.round(s.cb),
      "ΔCB": prev ? +(s.cb - prev.cb).toFixed(1) : "-",
      "cb $B": s.cbSize != null ? +s.cbSize.toFixed(1) : "-",
      spot: spot != null ? +spot.toFixed(2) : "-",
      "dist to CB": spot != null ? +(spot - s.cb).toFixed(1) : "-",
    };
  });
  console.log(`\n=== ${date} — every CB snapshot vs nearest SPX spot ===`);
  console.table(rows);
}
