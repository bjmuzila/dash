#!/usr/bin/env node
/* Balance/Imbalance (AMT quadrant) backtest against full es_candles/nq_candles
 * history in Postgres — the VPS-side twin of the client-side backtest already
 * shown on the /scanner "Balance / Imbalance" tab (lib/valueArea.ts +
 * lib/balanceImbalance.ts), which is capped at ~25 days because that's all the
 * browser loads via useEsCandles/useNqCandles. This script re-implements the
 * same algorithm standalone (no TS imports — piped as raw JS via `node -`,
 * same as the other backtest-*.mjs scripts) so it can run over the FULL
 * recorded history for a real sample size.
 *
 * For each RTH day: build the prior day's Value Area (POC/VAH/VAL, 70% volume
 * around POC, fixed-bin volume profile), then classify the day's bars into
 * Balance / Shift / Imbalance / Re-balance and grade:
 *   - did a Shift confirm into sustained Imbalance?
 *   - did Imbalance close the session on NEW value (outside the old VA), or
 *     revert back inside it by the close?
 *
 * Run on VPS:  docker exec -i dashboard-dashboard-1 node - < scripts/backtest-balance-imbalance.mjs
 * Env knobs:   SYMBOL (ES|NQ, default ES), DAYS (default 120),
 *              VA_PCT (default 0.70), CONFIRM_BARS (default 2),
 *              SETTLE_BARS (default 2), CONTRACTION_RATIO (default 0.6)
 */
import pg from "pg";

const SYMBOL = (process.env.SYMBOL ?? "ES").toUpperCase();
const DAYS = Number(process.env.DAYS ?? 120);
const VA_PCT = Number(process.env.VA_PCT ?? 0.70);
const CONFIRM_BARS = Number(process.env.CONFIRM_BARS ?? 2);
const SETTLE_BARS = Number(process.env.SETTLE_BARS ?? 2);
const CONTRACTION_RATIO = Number(process.env.CONTRACTION_RATIO ?? 0.6);

const table = SYMBOL === "NQ" ? "nq_candles" : "es_candles";
const symbolTag = SYMBOL === "NQ" ? "/NQ" : "/ES";
const binSize = SYMBOL === "NQ" ? 5 : 1;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sinceExpr = `(CURRENT_DATE - INTERVAL '${DAYS} days')::date::text`;

function etParts(ts) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ts));
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get("hour")), minute: Number(get("minute")) };
}
const etHM = (ts) => { const { hour, minute } = etParts(ts); return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`; };

const { rows } = await pool.query(`
  SELECT date, timestamp AS ts, open, high, low, close, volume
  FROM ${table}
  WHERE symbol = '${symbolTag}' AND "intervalMinutes" = 5 AND date >= ${sinceExpr}
    AND (to_timestamp(timestamp/1000.0) AT TIME ZONE 'America/New_York')::time BETWEEN '09:30' AND '16:00'
  ORDER BY date, timestamp ASC
`);
await pool.end();
console.log(`${table} (5m, RTH, ${symbolTag}): ${rows.length} bars`);
if (!rows.length) { console.log(`No 5m ${table} rows in the last ${DAYS} days. Nothing to backtest.`); process.exit(0); }

const barsByDate = new Map();
for (const r of rows) {
  const d = String(r.date);
  if (!barsByDate.has(d)) barsByDate.set(d, []);
  barsByDate.get(d).push({
    ts: Number(r.ts), open: Number(r.open), high: Number(r.high),
    low: Number(r.low), close: Number(r.close), volume: Number(r.volume) || 0,
  });
}
for (const bars of barsByDate.values()) bars.sort((a, b) => a.ts - b.ts);
const dates = [...barsByDate.keys()].sort();

// ── Value Area: fixed-bin volume profile, POC-expansion to VA_PCT of volume ─
// Same algorithm as lib/valueArea.ts / app/es-candles's buildVolumeProfile.
function computeValueArea(bars) {
  if (!bars.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { if (b.low < lo) lo = b.low; if (b.high > hi) hi = b.high; }
  if (!(hi > lo)) return null;

  const floorBin = (p) => Math.floor(p / binSize) * binSize;
  const vol = new Map();
  for (const b of bars) {
    if (!(b.volume > 0)) continue;
    const b0 = floorBin(b.low), b1 = floorBin(b.high);
    const n = Math.max(1, Math.round((b1 - b0) / binSize) + 1);
    const per = b.volume / n;
    for (let p = b0; p <= b1 + 1e-9; p += binSize) vol.set(p, (vol.get(p) ?? 0) + per);
  }
  const bins = [...vol.entries()].map(([price, volume]) => ({ price, volume })).sort((a, b) => a.price - b.price);
  if (!bins.length) return null;

  let pocIdx = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i].volume > bins[pocIdx].volume) pocIdx = i;
  const totalVolume = bins.reduce((s, b) => s + b.volume, 0);
  if (!(totalVolume > 0)) return null;
  const target = totalVolume * VA_PCT;

  let loI = pocIdx, hiI = pocIdx, acc = bins[pocIdx].volume;
  while (acc < target && (loI > 0 || hiI < bins.length - 1)) {
    const below = loI > 0 ? bins[loI - 1].volume : -1;
    const above = hiI < bins.length - 1 ? bins[hiI + 1].volume : -1;
    if (above >= below) { hiI++; acc += Math.max(0, above); }
    else { loI--; acc += Math.max(0, below); }
  }
  return { poc: bins[pocIdx].price, vah: bins[hiI].price, val: bins[loI].price, totalVolume };
}

// ── Quadrant state machine — same as lib/balanceImbalance.ts classifyDay() ──
function classifyDay(bars, va) {
  let state = "balance", side = null, streak = 0, legRanges = [];
  let shiftEvents = 0, imbalanceReached = 0, everShifted = false;
  const points = [];

  for (const b of bars) {
    const inVA = b.close <= va.vah && b.close >= va.val;
    let next = state, nextSide = side, changed = false;

    if (inVA) {
      if (state !== "balance") changed = true;
      next = "balance"; nextSide = null; streak = 0; legRanges = [];
    } else {
      const thisSide = b.close > va.vah ? "up" : "down";
      if (state === "balance" || thisSide !== side) {
        next = "shift"; nextSide = thisSide; streak = 1; legRanges = [b.high - b.low];
        shiftEvents++; everShifted = true; changed = true;
      } else {
        streak++;
        legRanges.push(b.high - b.low);
        if (state === "shift" && streak >= CONFIRM_BARS) {
          next = "imbalance"; changed = true; imbalanceReached++;
        } else if (state === "imbalance" && legRanges.length > SETTLE_BARS) {
          const recent = legRanges.slice(-SETTLE_BARS);
          const prior = legRanges.slice(0, -SETTLE_BARS);
          const recentAvg = recent.reduce((a, c) => a + c, 0) / recent.length;
          const priorAvg = prior.reduce((a, c) => a + c, 0) / Math.max(1, prior.length);
          next = priorAvg > 0 && recentAvg < priorAvg * CONTRACTION_RATIO ? "rebalance" : "imbalance";
          changed = next !== state;
        }
      }
    }
    points.push({ ts: b.ts, close: b.close, quadrant: next, changed });
    state = next; side = nextSide;
  }

  const lastClose = bars[bars.length - 1]?.close ?? null;
  const foundNewValue = everShifted && lastClose != null ? (lastClose > va.vah || lastClose < va.val) : null;
  const revertedToBalance = everShifted && lastClose != null ? (lastClose <= va.vah && lastClose >= va.val) : null;
  return { points, shiftEvents, imbalanceReached, foundNewValue, revertedToBalance, finalState: points[points.length - 1]?.quadrant ?? null };
}

// ── walk every day using the PRIOR day's VA ─────────────────────────────────
const perDay = [];
let skippedThinPrevDay = 0, skippedNoVA = 0;
for (let i = 1; i < dates.length; i++) {
  const prevBars = barsByDate.get(dates[i - 1]);
  if (prevBars.length < 5) { skippedThinPrevDay++; continue; }
  const va = computeValueArea(prevBars);
  if (!va) { skippedNoVA++; continue; }
  const todayBars = barsByDate.get(dates[i]);
  const result = classifyDay(todayBars, va);
  const firstChange = result.points.find((p) => p.changed && p.quadrant === "shift");
  perDay.push({
    date: dates[i],
    "prev VAL": +va.val.toFixed(2),
    "prev POC": +va.poc.toFixed(2),
    "prev VAH": +va.vah.toFixed(2),
    "shift events": result.shiftEvents,
    "reached imbalance": result.imbalanceReached > 0 ? "yes" : "no",
    "first shift at": firstChange ? etHM(firstChange.ts) : "-",
    "close": +todayBars[todayBars.length - 1].close.toFixed(2),
    "found new value": result.foundNewValue == null ? "-" : result.foundNewValue ? "yes" : "no",
    "reverted to balance": result.revertedToBalance == null ? "-" : result.revertedToBalance ? "yes" : "no",
    "end state": result.finalState,
  });
}

if (!perDay.length) { console.log("No qualifying day-pairs (need a real prior day + today's bars). Nothing to report."); process.exit(0); }

console.log(`\n=== Per-day quadrant read (${symbolTag}, VA=${Math.round(VA_PCT * 100)}%, confirm=${CONFIRM_BARS} bars, settle=${SETTLE_BARS} bars, contraction<${CONTRACTION_RATIO}) ===`);
console.table(perDay);

const withShift = perDay.filter((d) => d["shift events"] > 0);
const withImbalance = withShift.filter((d) => d["reached imbalance"] === "yes");
const newValue = withImbalance.filter((d) => d["found new value"] === "yes");
const reverted = withImbalance.filter((d) => d["reverted to balance"] === "yes");
const pct = (n, total) => (total ? Math.round((100 * n) / total) + "%" : "-");

console.log(`\n=== Outcome summary (n=${perDay.length} days) ===`);
console.table([
  { metric: "Days with a Shift", n: withShift.length, pct: pct(withShift.length, perDay.length) },
  { metric: "Shift -> confirmed Imbalance", n: withImbalance.length, pct: pct(withImbalance.length, withShift.length) },
  { metric: "Imbalance -> closed on NEW value", n: newValue.length, pct: pct(newValue.length, withImbalance.length) },
  { metric: "Imbalance -> reverted to Balance", n: reverted.length, pct: pct(reverted.length, withImbalance.length) },
]);

console.log("\n=== End-of-day state distribution ===");
const stateCounts = new Map();
for (const d of perDay) stateCounts.set(d["end state"], (stateCounts.get(d["end state"]) ?? 0) + 1);
console.table([...stateCounts.entries()].map(([state, n]) => ({ state, n, pct: pct(n, perDay.length) })));

if (skippedThinPrevDay) console.log(`\n(Skipped ${skippedThinPrevDay} day(s) whose prior session had <5 RTH bars.)`);
if (skippedNoVA) console.log(`(Skipped ${skippedNoVA} day(s) where a Value Area couldn't be built from the prior session.)`);
