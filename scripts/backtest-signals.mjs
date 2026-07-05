#!/usr/bin/env node
/* Backtest for server-v2/signals-engine.js (the alert stream that would feed
 * the trading bot). Unlike the other scripts/backtest-*.mjs files, this one
 * does NOT re-derive the detection logic in SQL — it imports the REAL,
 * production `evaluateFrame` (flip cross / wall reject+break / CB / confluence)
 * and the REAL `findCallWall/findPutWall/findGexFlip` wall-selection functions
 * and replays them against historical Postgres data. Same code path as live,
 * so results reflect what would actually have fired — not a re-implementation
 * that can drift from production.
 *
 * Data sources (all already written by the live pipeline):
 *   es_candles              — 5m ES OHLC → priceEs + PDH/PDL/POC context
 *   option_strike_gex_history — 1m per-strike net GEX → call/put wall + flip,
 *                                 recomputed per snapshot via the same
 *                                 findCallWall/findPutWall/findGexFlip used live
 *   mvc_snapshots            — ~30m CB/MVC level + size (RTH)
 *
 * NOT included in this pass: the Bzila Confluence v2 sub-signal. It needs a
 * historical DEX + flow-score time series at matching granularity that isn't
 * confirmed to exist yet — grading it would be lower-fidelity than the primary
 * four setups, so it's left out rather than faked. Add it once DEX/flow history
 * is confirmed (greeks_ts has dex; flow/premium history would need checking).
 *
 * Grading: for each fired signal, scan forward (same session date only) up to
 * LOOKMIN minutes. WIN if price moves WIN pts in the signal's direction before
 * moving STOP pts against it; LOSS if stop hits first (or both hit in the same
 * bar — treated as a loss, conservative); UNRESOLVED if neither hits within the
 * window.
 *
 * Run on VPS:  docker exec -i dashboard-dashboard-1 node scripts/backtest-signals.mjs
 *              (run BY PATH, not piped via stdin like the other backtest-*.mjs
 *              scripts — this one has relative imports to ../server-v2/*, and
 *              `node -` has no real file path so those imports can't resolve.)
 * Env knobs:   DAYS (default 30), LOOKMIN (default 60), WIN (default 5), STOP (default 3)
 */
import pg from "pg";
import signalsEngine from "../server-v2/signals-engine.js";
import gexCalc from "../server-v2/computation/gex-calculator.js";

const { evaluateFrame, computeContextLevels } = signalsEngine;
const { findCallWall, findPutWall, findGexFlip } = gexCalc;

const DAYS    = Number(process.env.DAYS ?? 30);
const LOOKMIN = Number(process.env.LOOKMIN ?? 60);
const WIN     = Number(process.env.WIN ?? 5);
const STOP    = Number(process.env.STOP ?? 3);
const LOOKBARS = Math.max(1, Math.round(LOOKMIN / 5));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── pull the three source tables ────────────────────────────────────────────
// ::date strips the time component before the ::text cast — otherwise the
// comparison string is "2026-06-05 00:00:00" which lexically sorts AFTER the
// plain "2026-06-05" date rows, silently dropping the boundary day.
const sinceExpr = `(CURRENT_DATE - INTERVAL '${DAYS} days')::date::text`;

const { rows: bars } = await pool.query(`
  SELECT timestamp AS ts, date, open, high, low, close, volume
  FROM es_candles
  WHERE symbol = '/ES' AND "intervalMinutes" = 5 AND date >= ${sinceExpr}
  ORDER BY timestamp ASC
`);

const { rows: gexRowsRaw } = await pool.query(`
  SELECT date, timestamp AS ts, spot, strike, net_gex AS "netGEX", net_vol_gex AS "netVolGEX"
  FROM option_strike_gex_history
  WHERE spot > 0 AND date >= ${sinceExpr}
  ORDER BY timestamp ASC
`);

const { rows: cbRowsRaw } = await pool.query(`
  SELECT date, timestamp AS ts, "strikeOIVol" AS cb, "mvcValueOIVol" AS cb_size_raw
  FROM mvc_snapshots
  WHERE "strikeOIVol" > 0 AND date >= ${sinceExpr}
  ORDER BY timestamp ASC
`);

await pool.end();

if (!bars.length) { console.log(`No es_candles rows in the last ${DAYS} days. Nothing to backtest.`); process.exit(0); }

// ── build a per-snapshot GEX timeline: {ts, spot, callWall, putWall, gexFlip} ──
// reusing the SAME wall/flip functions the live pipeline uses, on the SAME
// {strike, netGEX, netVolGEX} row shape computeGexRows() produces live.
const gexByTs = new Map();
for (const r of gexRowsRaw) {
  const key = Number(r.ts);
  if (!gexByTs.has(key)) gexByTs.set(key, { ts: key, spot: Number(r.spot), rows: [] });
  gexByTs.get(key).rows.push({ strike: Number(r.strike), netGEX: Number(r.netGEX) || 0, netVolGEX: Number(r.netVolGEX) || 0 });
}
const gexTimeline = [...gexByTs.values()].sort((a, b) => a.ts - b.ts).map((g) => ({
  ts: g.ts, spot: g.spot,
  callWall: findCallWall(g.rows, g.spot),
  putWall: findPutWall(g.rows, g.spot),
  gexFlip: findGexFlip(g.rows, g.spot),
}));

// ── CB (MVC) timeline, size normalised to $B (mixed-units bug — see memory) ──
const toB = (v) => (Number.isFinite(v) && Math.abs(v) > 1e5 ? v / 1e9 : v);
const cbTimeline = cbRowsRaw
  .map((r) => ({ ts: Number(r.ts), cb: Number(r.cb), cbSize: toB(Number(r.cb_size_raw)) }))
  .filter((r) => r.cb > 0)
  .sort((a, b) => a.ts - b.ts);

// ── group candle bars by session date, for same-day forward grading ────────
const barsByDate = new Map();
for (const b of bars) {
  const d = String(b.date);
  if (!barsByDate.has(d)) barsByDate.set(d, []);
  barsByDate.get(d).push(b);
}

// computeContextLevels only ever needs the last ~2-3 sessions (prior-day RTH +
// overnight window + today's bars for POC) — map once up front, then hand it a
// bounded rolling slice per bar. Re-slicing+remapping the WHOLE prefix on every
// iteration (bars.slice(0, i+1).map(...)) is what OOM'd the container: O(n²)
// allocation over a multi-thousand-bar history.
const ctxBars = bars.map((c) => ({ timestamp: Number(c.ts), high: Number(c.high), low: Number(c.low), volume: Number(c.volume) }));
const CTX_WINDOW = 800; // ~2-3 trading sessions of 5m bars — plenty for PDH/PDL/POC

// ── walk the candles in order, forward-filling the latest known GEX/CB
//    snapshot at each bar (two-pointer, both timelines already sorted) ──────
const mem = { prev: null, levels: {}, cooldowns: new Map() };
let gi = -1, ci = -1;
const fired = [];
for (let i = 0; i < bars.length; i++) {
  const bar = bars[i];
  const ts = Number(bar.ts);
  while (gi + 1 < gexTimeline.length && gexTimeline[gi + 1].ts <= ts) gi++;
  while (ci + 1 < cbTimeline.length && cbTimeline[ci + 1].ts <= ts) ci++;
  if (gi < 0 || ci < 0) continue; // no snapshot yet to forward-fill from
  const gs = gexTimeline[gi], cs = cbTimeline[ci];

  const frame = {
    ts,
    priceEs: Number(bar.close),
    basis: Number(bar.close) - gs.spot,
    callSpx: gs.callWall,
    putSpx: gs.putWall,
    flipSpx: gs.gexFlip,
    cbSpx: cs.cb,
    cbSize: cs.cbSize,
    ctx: computeContextLevels(ctxBars.slice(Math.max(0, i - CTX_WINDOW + 1), i + 1), ts),
  };

  for (const sig of evaluateFrame(frame, mem)) {
    sig.sessionDate = bar.date;
    sig.barIndex = i;
    fired.push(sig);
  }
}

if (!fired.length) { console.log(`Walked ${bars.length} bars, 0 signals fired. Nothing to grade.`); process.exit(0); }

// ── grade each signal: forward scan within the same session date only ──────
function grade(sig) {
  const dayBars = barsByDate.get(sig.sessionDate) || [];
  const idx = dayBars.findIndex((b) => Number(b.ts) === sig.ts);
  if (idx < 0) return "unresolved";
  const dir = sig.direction === "long" ? 1 : -1;
  const target = sig.priceEs + dir * WIN;
  const stop = sig.priceEs - dir * STOP;
  const maxIdx = Math.min(dayBars.length - 1, idx + LOOKBARS);
  for (let j = idx + 1; j <= maxIdx; j++) {
    const b = dayBars[j];
    const hitStop = dir > 0 ? Number(b.low) <= stop : Number(b.high) >= stop;
    const hitTarget = dir > 0 ? Number(b.high) >= target : Number(b.low) <= target;
    if (hitStop) return "loss";       // conservative: stop-and-target-same-bar = loss
    if (hitTarget) return "win";
  }
  return "unresolved";
}

const graded = fired.map((s) => ({ ...s, result: grade(s) }));

// ── aggregate ────────────────────────────────────────────────────────────────
function summarize(rows, keyFn) {
  const byKey = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    const e = byKey.get(k) || { n: 0, win: 0, loss: 0, unresolved: 0 };
    e.n++; e[r.result]++;
    byKey.set(k, e);
  }
  return [...byKey.entries()].map(([k, e]) => ({
    key: k, fired: e.n, win: e.win, loss: e.loss, unresolved: e.unresolved,
    "win% (resolved)": e.win + e.loss ? `${Math.round((100 * e.win) / (e.win + e.loss))}%` : "-",
  }));
}

const byKind = summarize(graded, (r) => r.kind);
const scoreBucket = (s) => (s.score <= 2 ? "score 1-2" : s.score === 3 ? "score 3" : "score 4-5");
const byScore = summarize(graded, scoreBucket);

const totalResolved = graded.filter((r) => r.result !== "unresolved").length;
const totalWin = graded.filter((r) => r.result === "win").length;

console.log(`Signals backtest — ${bars.length} bars (${barsByDate.size} sessions), ${DAYS}d lookback, ${LOOKMIN}m window, win=${WIN}pt stop=${STOP}pt\n`);
console.log(`${fired.length} signals fired, ${totalResolved} resolved, overall win% ${totalResolved ? Math.round((100 * totalWin) / totalResolved) : "-"}%\n`);

console.log("=== By setup (kind) ===");
console.table(byKind);
console.log("\n=== By score bucket ===");
console.table(byScore);

console.log("\n=== Last 25 signals ===");
console.table(
  graded.slice(-25).map((s) => ({
    date: s.sessionDate, kind: s.kind, dir: s.direction, level: s.levelName ?? "-",
    price: s.priceEs, score: s.score, result: s.result,
  })),
);
