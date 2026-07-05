#!/usr/bin/env node
/* 5-min and 15-min Opening Range Breakout (ORB) stats for SPX.
 *
 * There is no dedicated spx_candles table, so this is built from the SPX spot
 * ticks already recorded in option_strike_gex_history (one snapshot per
 * strike per write, all sharing the same `spot` — rate-limited to ~1/60s by
 * the GEX writer, see server-v2/state/gex-history-writer.js). That means
 * resolution here is ~1 sample/minute, NOT true tick data: intra-minute
 * wicks between snapshots can be missed, so ORB highs/lows and break
 * timestamps are coarser than the ES version (scripts/backtest-orb.mjs),
 * which reads true 5m OHLC bars. Treat this as directionally useful, not
 * precise to the point.
 *
 * ORB window is defined by ELAPSED TIME from each day's first snapshot
 * (not bar-index like the ES script), since a missing/late snapshot would
 * otherwise silently shift which "bar" counts as bar 0. A day is skipped if
 * its first snapshot lands more than MAX_START_DELAY_MIN minutes after the
 * 09:30 open (late/gated start — see chartReady grace period in
 * proxy-tastytrade.js), since the ORB window would already be stale.
 *
 * For each RTH day computes:
 *   - which side (high/low) is broken FIRST after the ORB window closes
 *   - single-side vs double-side (both) breach vs no-break-at-all
 *   - max extension (in SPX points) beyond whichever boundary got broken
 *
 * Run on VPS:  docker exec -i dashboard-dashboard-1 node - < scripts/backtest-orb-spx.mjs
 * Env knobs:   DAYS (default 60), MAX_START_DELAY_MIN (default 5)
 */
import pg from "pg";

const DAYS = Number(process.env.DAYS ?? 60);
const MAX_START_DELAY_MIN = Number(process.env.MAX_START_DELAY_MIN ?? 5);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sinceExpr = `(CURRENT_DATE - INTERVAL '${DAYS} days')::date::text`;

function etParts(ts) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ts));
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get("hour")), minute: Number(get("minute")) };
}
const etMinutes = (ts) => { const { hour, minute } = etParts(ts); return hour * 60 + minute; };
const etHM = (ts) => { const { hour, minute } = etParts(ts); return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`; };

// DISTINCT on (date,timestamp,spot): option_strike_gex_history is per-strike,
// so a raw SELECT would return one row per strike per snapshot — collapse to
// one row per snapshot (learned the hard way in backtest-signals.mjs).
const { rows } = await pool.query(`
  SELECT DISTINCT date, timestamp AS ts, spot
  FROM option_strike_gex_history
  WHERE spot > 0 AND date >= ${sinceExpr}
    AND (to_timestamp(timestamp/1000.0) AT TIME ZONE 'America/New_York')::time BETWEEN '09:30' AND '16:00'
  ORDER BY date, timestamp ASC
`);
await pool.end();
console.log(`option_strike_gex_history (SPX spot snapshots, RTH): ${rows.length}`);
if (!rows.length) { console.log(`No spot rows in the last ${DAYS} days. Nothing to backtest.`); process.exit(0); }

const ticksByDate = new Map();
for (const r of rows) {
  const d = String(r.date);
  if (!ticksByDate.has(d)) ticksByDate.set(d, []);
  ticksByDate.get(d).push({ ts: Number(r.ts), spot: Number(r.spot) });
}

// Data-quality guard, same reasoning as backtest-eod-cb-reach.mjs: a real SPX
// RTH-day range is almost never >150pt. Rows that blow past that are almost
// certainly bad spot data, not real price action.
const RANGE_CAP = Number(process.env.RANGE_CAP ?? 150);

let skippedLateStart = 0, skippedBadRange = 0;

function computeOrbStats(windowMinutes) {
  const perDay = [];
  for (const [date, ticksRaw] of ticksByDate) {
    const ticks = ticksRaw.slice().sort((a, b) => a.ts - b.ts);
    const spots = ticks.map((t) => t.spot);
    if (Math.max(...spots) - Math.min(...spots) > RANGE_CAP) { skippedBadRange++; continue; }

    const firstTs = ticks[0].ts;
    if (etMinutes(firstTs) > 9 * 60 + 30 + MAX_START_DELAY_MIN) { skippedLateStart++; continue; }

    const orbEndTs = firstTs + windowMinutes * 60_000;
    const orbTicks = ticks.filter((t) => t.ts <= orbEndTs);
    const rest = ticks.filter((t) => t.ts > orbEndTs);
    if (!orbTicks.length || !rest.length) continue;

    const orbHigh = Math.max(...orbTicks.map((t) => t.spot));
    const orbLow = Math.min(...orbTicks.map((t) => t.spot));

    let highBreakTs = null, lowBreakTs = null, maxExtHigh = 0, maxExtLow = 0;
    for (const t of rest) {
      if (t.spot > orbHigh) { if (highBreakTs == null) highBreakTs = t.ts; maxExtHigh = Math.max(maxExtHigh, t.spot - orbHigh); }
      if (t.spot < orbLow) { if (lowBreakTs == null) lowBreakTs = t.ts; maxExtLow = Math.max(maxExtLow, orbLow - t.spot); }
    }
    const highBroken = highBreakTs != null, lowBroken = lowBreakTs != null;
    const firstSide = highBroken && lowBroken ? (highBreakTs < lowBreakTs ? "high" : "low") : highBroken ? "high" : lowBroken ? "low" : "none";
    const breach = highBroken && lowBroken ? "double" : highBroken || lowBroken ? "single" : "none";

    perDay.push({
      date,
      "orb open": etHM(firstTs),
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
  console.log(`\n=== ${label}: extension beyond broken boundary (SPX points) ===`);
  console.table([
    { side: "beyond high", n: highExts.length, avg: avg(highExts), max: max(highExts) },
    { side: "beyond low", n: lowExts.length, avg: avg(lowExts), max: max(lowExts) },
  ]);
}

report(computeOrbStats(5), "5-MIN ORB (SPX, ~09:30-09:35 window)");
report(computeOrbStats(15), "15-MIN ORB (SPX, ~09:30-09:45 window)");

if (skippedLateStart) console.log(`\n(Skipped ${skippedLateStart} day(s) whose first snapshot landed >${MAX_START_DELAY_MIN}min after 09:30 open.)`);
if (skippedBadRange) console.log(`(Skipped ${skippedBadRange} day(s) with a >${RANGE_CAP}pt RTH range as bad spot data.)`);
