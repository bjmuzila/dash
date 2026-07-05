#!/usr/bin/env node
/* 5-min and 15-min Opening Range Breakout (ORB) stats for /ES, built from the
 * 5m es_candles bars already recorded (symbol='/ES', intervalMinutes=5). No
 * 1m data needed: the 15m ORB range is just the high/low across the first
 * three 5m bars (09:30-09:45), the 5m ORB range is just the first bar
 * (09:30-09:35).
 *
 * For each RTH day computes:
 *   - which side (high/low) is broken FIRST after the ORB window closes
 *   - single-side vs double-side (both) breach vs no-break-at-all
 *   - max extension (in ES points) beyond whichever boundary got broken
 *
 * Days are skipped if the first recorded bar isn't exactly 09:30 ET (gap in
 * the feed that day) or if there are no bars after the ORB window closes.
 *
 * Run on VPS:  docker exec -i dashboard-dashboard-1 node - < scripts/backtest-orb.mjs
 * Env knobs:   DAYS (default 60)
 */
import pg from "pg";

const DAYS = Number(process.env.DAYS ?? 60);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sinceExpr = `(CURRENT_DATE - INTERVAL '${DAYS} days')::date::text`;

function etParts(ts) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ts));
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get("hour")), minute: Number(get("minute")) };
}
const etMinutes = (ts) => { const { hour, minute } = etParts(ts); return hour * 60 + minute; };
const etHM = (ts) => { const { hour, minute } = etParts(ts); return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`; };

const { rows } = await pool.query(`
  SELECT date, timestamp AS ts, open, high, low, close
  FROM es_candles
  WHERE symbol = '/ES' AND "intervalMinutes" = 5 AND date >= ${sinceExpr}
    AND (to_timestamp(timestamp/1000.0) AT TIME ZONE 'America/New_York')::time BETWEEN '09:30' AND '16:00'
  ORDER BY date, timestamp ASC
`);
await pool.end();
console.log(`es_candles (5m, RTH): ${rows.length} bars`);
if (!rows.length) { console.log(`No 5m es_candles rows in the last ${DAYS} days. Nothing to backtest.`); process.exit(0); }

const barsByDate = new Map();
for (const r of rows) {
  const d = String(r.date);
  if (!barsByDate.has(d)) barsByDate.set(d, []);
  barsByDate.get(d).push({ ts: Number(r.ts), open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close) });
}

let skippedNoOpen = 0, skippedNoAfter = 0;

function computeOrbStats(windowBars) {
  const perDay = [];
  for (const [date, bars] of barsByDate) {
    bars.sort((a, b) => a.ts - b.ts);
    if (etMinutes(bars[0].ts) !== 9 * 60 + 30) { skippedNoOpen++; continue; }
    if (bars.length <= windowBars) { skippedNoAfter++; continue; }

    const orbBars = bars.slice(0, windowBars);
    const orbHigh = Math.max(...orbBars.map((b) => b.high));
    const orbLow = Math.min(...orbBars.map((b) => b.low));
    const rest = bars.slice(windowBars);

    let highBreakTs = null, lowBreakTs = null, maxExtHigh = 0, maxExtLow = 0;
    for (const b of rest) {
      if (b.high > orbHigh) { if (highBreakTs == null) highBreakTs = b.ts; maxExtHigh = Math.max(maxExtHigh, b.high - orbHigh); }
      if (b.low < orbLow) { if (lowBreakTs == null) lowBreakTs = b.ts; maxExtLow = Math.max(maxExtLow, orbLow - b.low); }
    }
    const highBroken = highBreakTs != null, lowBroken = lowBreakTs != null;
    const firstSide = highBroken && lowBroken ? (highBreakTs < lowBreakTs ? "high" : "low") : highBroken ? "high" : lowBroken ? "low" : "none";
    const breach = highBroken && lowBroken ? "double" : highBroken || lowBroken ? "single" : "none";

    perDay.push({
      date,
      "orb range": +(orbHigh - orbLow).toFixed(2),
      "first break": firstSide,
      breach,
      "ext beyond high": highBroken ? +maxExtHigh.toFixed(2) : "-",
      "ext beyond low": lowBroken ? +maxExtLow.toFixed(2) : "-",
      "high break at": highBreakTs ? etHM(highBreakTs) : "-",
      "low break at": lowBreakTs ? etHM(lowBreakTs) : "-",
    });
  }
  perDay.sort((a, b) => a.date.localeCompare(b.date));
  return perDay;
}

const pct = (n, total) => (total ? Math.round((100 * n) / total) + "%" : "-");
const avg = (a) => (a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : "-");
const max = (a) => (a.length ? +Math.max(...a).toFixed(2) : "-");

function report(perDay, label) {
  console.log(`\n\n########## ${label} (n=${perDay.length} days) ##########`);
  if (!perDay.length) { console.log("No qualifying days."); return; }

  console.log(`\n=== ${label}: per-day ===`);
  console.table(perDay);

  const n = perDay.length;
  const sideCounts = { high: 0, low: 0, none: 0 };
  const breachCounts = { single: 0, double: 0, none: 0 };
  for (const d of perDay) { sideCounts[d["first break"]]++; breachCounts[d.breach]++; }

  console.log(`\n=== ${label}: which side breaks first ===`);
  console.table([
    { side: "high first", n: sideCounts.high, pct: pct(sideCounts.high, n) },
    { side: "low first", n: sideCounts.low, pct: pct(sideCounts.low, n) },
    { side: "neither broke", n: sideCounts.none, pct: pct(sideCounts.none, n) },
  ]);

  console.log(`\n=== ${label}: single vs double breach ===`);
  console.table([
    { type: "single-side", n: breachCounts.single, pct: pct(breachCounts.single, n) },
    { type: "double (both sides)", n: breachCounts.double, pct: pct(breachCounts.double, n) },
    { type: "no break (inside)", n: breachCounts.none, pct: pct(breachCounts.none, n) },
  ]);

  const highExts = perDay.filter((d) => d["ext beyond high"] !== "-").map((d) => d["ext beyond high"]);
  const lowExts = perDay.filter((d) => d["ext beyond low"] !== "-").map((d) => d["ext beyond low"]);
  console.log(`\n=== ${label}: extension beyond broken boundary (ES points) ===`);
  console.table([
    { side: "beyond high", n: highExts.length, avg: avg(highExts), max: max(highExts) },
    { side: "beyond low", n: lowExts.length, avg: avg(lowExts), max: max(lowExts) },
  ]);
}

report(computeOrbStats(1), "5-MIN ORB (09:30-09:35 range)");
report(computeOrbStats(3), "15-MIN ORB (09:30-09:45 range)");

if (skippedNoOpen) console.log(`\n(Skipped ${skippedNoOpen} day-window instance(s) missing a clean 09:30 first bar.)`);
if (skippedNoAfter) console.log(`(Skipped ${skippedNoAfter} day-window instance(s) with no bars after the ORB window.)`);
