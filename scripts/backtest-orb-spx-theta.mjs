#!/usr/bin/env node
/* 5-min and 15-min Opening Range Breakout (ORB) stats for SPX — sourced
 * directly from ThetaData's real intraday OHLC history instead of
 * reconstructing bars from the ~1/min option_strike_gex_history spot
 * snapshots (see scripts/backtest-orb-spx.mjs, which was a stopgap because
 * no dedicated SPX candle table exists in this app).
 *
 * ThetaData v3 has a real intraday index history endpoint:
 *   GET /v3/index/history/ohlc?symbol=SPX&start_date=...&end_date=...&interval=5m
 * (confirmed against https://docs.thetadata.us/operations/index_history_ohlc.html,
 * 2026-07-05). Requires Index Standard+ (the same tier this app already uses
 * for live SPX spot). Bars use real SIP trade data — true 5m highs/lows, not
 * a coarse 1/min reconstruction.
 *
 * MUST run inside the dashboard container (or anywhere THETA_BASE_URL points
 * at the live Theta Terminal) — same as proxy-thetadata.js's thetaGet:
 *   docker exec -i dashboard-dashboard-1 node - < scripts/backtest-orb-spx-theta.mjs
 * No DATABASE_URL / Postgres needed at all.
 *
 * Only fetches ONE bar series (interval=5m, 09:30-16:00 ET). Both ORB windows
 * are read off it exactly like scripts/backtest-orb.mjs does for /ES:
 *   - 5-min ORB  = bars[0]        (09:30-09:35)
 *   - 15-min ORB = bars[0..2]     (09:30-09:45)
 * Requests are chunked to <=30 calendar days (Theta's multi-day history cap).
 *
 * Env knobs: DAYS (default 60)
 */

const DAYS = Number(process.env.DAYS ?? 60);
const THETA_BASE_URL = (process.env.THETA_BASE_URL || 'http://127.0.0.1:25503').replace(/\/+$/, '');

async function thetaGet(pathAndQuery) {
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const url = `${THETA_BASE_URL}${pathAndQuery}${sep}format=json`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Theta GET ${pathAndQuery} -> ${res.status} ${text.slice(0, 240)}`);
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    throw new Error(`Theta ${pathAndQuery} non-JSON (tier/permission?): ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}
function rowsFromV3(json) {
  const fmt = json?.header?.format || json?.format;
  const resp = json?.response || json?.data || [];
  if (Array.isArray(fmt)) return resp.map((row) => { const o = {}; fmt.forEach((c, i) => { o[c] = row[i]; }); return o; });
  return Array.isArray(resp) ? resp : [];
}

const ymdCompact = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
function addDays(d, n) { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; }

// Chunk [start,end] into <=30-calendar-day windows (Theta's history request cap).
function* chunkRange(start, end, maxDays = 30) {
  let cur = new Date(start);
  while (cur <= end) {
    const chunkEnd = addDays(cur, maxDays - 1) > end ? end : addDays(cur, maxDays - 1);
    yield [new Date(cur), new Date(chunkEnd)];
    cur = addDays(chunkEnd, 1);
  }
}

// Theta returns timestamps as bare ET wall-clock strings (exchange-local, no
// offset — session hours match 09:30-16:00 directly), so parse the string
// fields directly rather than round-tripping through JS Date/UTC conversion.
function parseBar(row) {
  const [datePart, timePart] = String(row.timestamp).split('T');
  const [hh, mm] = timePart.split(':').map(Number);
  return {
    date: datePart,
    minutesOfDay: hh * 60 + mm,
    hm: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close),
  };
}

const today = new Date();
const startDate = addDays(today, -DAYS);

let allRows = [];
for (const [chunkStart, chunkEnd] of chunkRange(startDate, today)) {
  const q = `/v3/index/history/ohlc?symbol=SPX&start_date=${ymdCompact(chunkStart)}&end_date=${ymdCompact(chunkEnd)}&interval=5m&start_time=09:30:00&end_time=16:00:00`;
  const json = await thetaGet(q);
  allRows = allRows.concat(rowsFromV3(json));
}
console.log(`Theta index/history/ohlc (SPX, 5m, RTH): ${allRows.length} bars`);
if (!allRows.length) { console.log('No bars returned. Check Index subscription tier / THETA_BASE_URL.'); process.exit(0); }

const barsByDate = new Map();
for (const row of allRows) {
  const b = parseBar(row);
  if (!barsByDate.has(b.date)) barsByDate.set(b.date, []);
  barsByDate.get(b.date).push(b);
}

let skippedNoOpen = 0, skippedNoAfter = 0;

function computeOrbStats(windowBars) {
  const perDay = [];
  for (const [date, barsRaw] of barsByDate) {
    const bars = barsRaw.slice().sort((a, b) => a.minutesOfDay - b.minutesOfDay);
    if (bars[0].minutesOfDay !== 9 * 60 + 30) { skippedNoOpen++; continue; }
    if (bars.length <= windowBars) { skippedNoAfter++; continue; }

    const orbBars = bars.slice(0, windowBars);
    const orbHigh = Math.max(...orbBars.map((b) => b.high));
    const orbLow = Math.min(...orbBars.map((b) => b.low));
    const rest = bars.slice(windowBars);

    let highBreakHm = null, lowBreakHm = null, maxExtHigh = 0, maxExtLow = 0;
    for (const b of rest) {
      if (b.high > orbHigh) { if (highBreakHm == null) highBreakHm = b.hm; maxExtHigh = Math.max(maxExtHigh, b.high - orbHigh); }
      if (b.low < orbLow) { if (lowBreakHm == null) lowBreakHm = b.hm; maxExtLow = Math.max(maxExtLow, orbLow - b.low); }
    }
    const highBroken = highBreakHm != null, lowBroken = lowBreakHm != null;
    const firstSide = highBroken && lowBroken ? (highBreakHm < lowBreakHm ? "high" : "low") : highBroken ? "high" : lowBroken ? "low" : "none";
    const breach = highBroken && lowBroken ? "double" : highBroken || lowBroken ? "single" : "none";

    perDay.push({
      date,
      "orb range": +(orbHigh - orbLow).toFixed(2),
      "first break": firstSide,
      breach,
      "ext beyond high": highBroken ? +maxExtHigh.toFixed(2) : "-",
      "ext beyond low": lowBroken ? +maxExtLow.toFixed(2) : "-",
      "high break at": highBreakHm ?? "-",
      "low break at": lowBreakHm ?? "-",
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
  console.log(`\n=== ${label}: extension beyond broken boundary (SPX points) ===`);
  console.table([
    { side: "beyond high", n: highExts.length, avg: avg(highExts), max: max(highExts) },
    { side: "beyond low", n: lowExts.length, avg: avg(lowExts), max: max(lowExts) },
  ]);
}

report(computeOrbStats(1), "5-MIN ORB (SPX, Theta, 09:30-09:35 range)");
report(computeOrbStats(3), "15-MIN ORB (SPX, Theta, 09:30-09:45 range)");

if (skippedNoOpen) console.log(`\n(Skipped ${skippedNoOpen} day(s) missing a clean 09:30 first bar.)`);
if (skippedNoAfter) console.log(`(Skipped ${skippedNoAfter} day(s) with no bars after the ORB window.)`);
