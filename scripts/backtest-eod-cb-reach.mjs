#!/usr/bin/env node
/* EOD CB (MVC) reach report — for the "watch the last 2 hours, trade the CB
 * level" bot idea. For each RTH day: freeze the CB level as of 2:00pm ET (the
 * last mvc_snapshots row at or before 14:00 — what a bot would actually know
 * at that moment), then track SPX spot (from option_strike_gex_history.spot)
 * through the 2:00-4:00pm ET window and report whether/when price touches
 * that level before the cash close.
 *
 * This is a REPORT, not a signal engine — no detection logic to reuse, so
 * (unlike backtest-signals.mjs) it only needs `pg` and can be piped via stdin
 * same as the other simple backtest-*.mjs scripts.
 *
 * Touch tolerance defaults to 1.5pt (same CB_TOUCH default signals-engine.js
 * uses) so this stays comparable to that engine's own touch/reject logic.
 *
 * Run on VPS:  docker exec -i dashboard-dashboard-1 node - < scripts/backtest-eod-cb-reach.mjs
 * Env knobs:   DAYS (default 30), TOL (default 1.5)
 */
import pg from "pg";

const DAYS = Number(process.env.DAYS ?? 30);
const TOL  = Number(process.env.TOL ?? 1.5);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sinceExpr = `(CURRENT_DATE - INTERVAL '${DAYS} days')::date::text`;

// ── ET time-of-day helpers (epoch ms → minutes since midnight ET) ──────────
function etParts(ts) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ts));
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get("hour")), minute: Number(get("minute")) };
}
const etMinutes = (ts) => { const { hour, minute } = etParts(ts); return hour * 60 + minute; };
const etHM = (ts) => { const { hour, minute } = etParts(ts); return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`; };

// ── CB (MVC) level per day, small table — pull whole thing, pick in JS ─────
const { rows: cbRowsRaw } = await pool.query(`
  SELECT date, timestamp AS ts, "strikeOIVol" AS cb, "mvcValueOIVol" AS cb_size_raw
  FROM mvc_snapshots
  WHERE "strikeOIVol" > 0 AND date >= ${sinceExpr}
  ORDER BY date, timestamp ASC
`);
const toB = (v) => (Number.isFinite(v) && Math.abs(v) > 1e5 ? v / 1e9 : v);
const cbByDate = new Map();
for (const r of cbRowsRaw) {
  const ts = Number(r.ts);
  if (etMinutes(ts) > 14 * 60) continue; // only snapshots AT OR BEFORE 2:00pm ET
  const d = String(r.date);
  const prev = cbByDate.get(d);
  if (!prev || ts > prev.ts) cbByDate.set(d, { ts, cb: Number(r.cb), cbSize: toB(Number(r.cb_size_raw)) });
}

// ── SPX spot through the 2-4pm ET window, time-filtered IN SQL (learned the
//    hard way on backtest-signals.mjs: option_strike_gex_history is per-
//    strike/per-minute — DISTINCT on (date,ts,spot) drops the strike dimension
//    entirely so this stays small regardless of chain size) ────────────────
const { rows: priceRows } = await pool.query(`
  SELECT DISTINCT date, timestamp AS ts, spot
  FROM option_strike_gex_history
  WHERE spot > 0 AND date >= ${sinceExpr}
    AND (to_timestamp(timestamp/1000.0) AT TIME ZONE 'America/New_York')::time BETWEEN '14:00' AND '16:00'
  ORDER BY date, timestamp ASC
`);
await pool.end();
console.log(`mvc_snapshots (≤2pm ET, usable days): ${cbByDate.size}   option_strike_gex_history (2-4pm window rows): ${priceRows.length}`);

const pricesByDate = new Map();
for (const r of priceRows) {
  const d = String(r.date);
  if (!pricesByDate.has(d)) pricesByDate.set(d, []);
  pricesByDate.get(d).push({ ts: Number(r.ts), spot: Number(r.spot) });
}

// ── build the per-day report ─────────────────────────────────────────────
const days = [];
for (const [date, prices] of pricesByDate) {
  const cbRow = cbByDate.get(date);
  if (!cbRow || !prices.length) continue; // no known CB by 2pm, or no price data that day
  prices.sort((a, b) => a.ts - b.ts);
  const cb = cbRow.cb;
  const first = prices[0], last = prices[prices.length - 1];
  let minAbsDist = Infinity, touchedAt = null;
  for (const p of prices) {
    const d = Math.abs(p.spot - cb);
    if (d < minAbsDist) minAbsDist = d;
    if (touchedAt == null && d <= TOL) touchedAt = p.ts;
  }
  days.push({
    date,
    cb: Math.round(cb),
    "cb $B": cbRow.cbSize != null ? +cbRow.cbSize.toFixed(1) : "-",
    side: first.spot > cb ? "above" : "below",
    "spot@2pm": +first.spot.toFixed(2),
    "dist@2pm": +(first.spot - cb).toFixed(1),
    "spot@close": +last.spot.toFixed(2),
    "dist@close": +(last.spot - cb).toFixed(1),
    "min dist": +minAbsDist.toFixed(1),
    touched: minAbsDist <= TOL ? "yes" : "no",
    "touched at": touchedAt ? etHM(touchedAt) : "-",
  });
}
days.sort((a, b) => a.date.localeCompare(b.date));

if (!days.length) { console.log("No days with both a known 2pm CB level and 2-4pm price data. Nothing to report."); process.exit(0); }

console.log(`\n=== Per-day: SPX vs CB (frozen as of 2pm ET), tolerance ±${TOL}pt ===`);
console.table(days);

// ── aggregate: touch rate overall, by side, by 2pm distance bucket ─────────
const touched = days.filter((d) => d.touched === "yes");
console.log(`\nTouched by close: ${touched.length}/${days.length} (${Math.round((100 * touched.length) / days.length)}%)`);

function bucketBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    const e = m.get(k) || { n: 0, touched: 0 };
    e.n++; if (r.touched === "yes") e.touched++;
    m.set(k, e);
  }
  return [...m.entries()].map(([key, e]) => ({ key, n: e.n, touched: e.touched, "touched %": Math.round((100 * e.touched) / e.n) }));
}

console.log("\n=== By side (2pm position relative to CB) ===");
console.table(bucketBy(days, (d) => d.side));

console.log("\n=== By |distance| at 2pm ===");
console.table(bucketBy(days, (d) => {
  const dist = Math.abs(d["dist@2pm"]);
  return dist <= 5 ? "≤5pt" : dist <= 15 ? "5-15pt" : dist <= 30 ? "15-30pt" : ">30pt";
}));
