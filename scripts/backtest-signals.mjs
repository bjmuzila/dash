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
 *              If it still OOMs at the default DAYS, raise the container's
 *              heap instead of assuming there's another leak:
 *                docker exec -i -e NODE_OPTIONS=--max-old-space-size=4096 \
 *                  dashboard-dashboard-1 node scripts/backtest-signals.mjs
 * Env knobs:   DAYS (default 7), LOOKMIN (default 60), WIN (default 5), STOP (default 3)
 */
import pg from "pg";
import signalsEngine from "../server-v2/signals-engine.js";
import gexCalc from "../server-v2/computation/gex-calculator.js";

const { evaluateFrame, computeContextLevels } = signalsEngine;
const { findCallWall, findPutWall, findGexFlip } = gexCalc;

// DAYS defaults small (7) on purpose — option_strike_gex_history is a
// per-STRIKE, per-MINUTE table (100+ strikes × every minute), so 30 days can
// be tens of millions of rows pulled into one Node process. Raise it once you
// know how much history actually exists / how much memory it costs.
const DAYS    = Number(process.env.DAYS ?? 7);
const LOOKMIN = Number(process.env.LOOKMIN ?? 60);
const WIN     = Number(process.env.WIN ?? 5);
const STOP    = Number(process.env.STOP ?? 3);
const LOOKBARS = Math.max(1, Math.round(LOOKMIN / 5));
const REGIME_ENABLED = process.env.REGIME_HMM === "1";
const VITERBI_PERSIST = Number(process.env.VITERBI_PERSIST ?? 2);

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
console.log(`es_candles: ${bars.length} bars`);

if (!bars.length) { console.log(`No es_candles rows in the last ${DAYS} days. Nothing to backtest.`); process.exit(0); }

// ── build a per-snapshot GEX timeline: {ts, spot, callWall, putWall, gexFlip} ──
// reusing the SAME wall/flip functions the live pipeline uses, on the SAME
// {strike, netGEX, netVolGEX} row shape computeGexRows() produces live.
//
// option_strike_gex_history is written every ~60s (per-strike), which is 5x
// finer than the 5m es_candles we're actually walking — pull only the LATEST
// snapshot per 5-minute bucket (DISTINCT ON) instead of every minute, so we're
// not hauling 5x more strike-level rows into memory than the replay can use.
async function buildGexTimeline() {
  const { rows } = await pool.query(`
    WITH picked AS (
      SELECT DISTINCT ON (date, (timestamp / 300000))
        date, timestamp AS ts
      FROM option_strike_gex_history
      WHERE spot > 0 AND date >= ${sinceExpr}
      ORDER BY date, (timestamp / 300000), timestamp DESC
    )
    SELECT h.timestamp AS ts, h.spot, h.strike, h.net_gex AS "netGEX", h.net_vol_gex AS "netVolGEX"
    FROM option_strike_gex_history h
    JOIN picked p ON p.date = h.date AND p.ts = h.timestamp
    ORDER BY h.timestamp ASC
  `);
  console.log(`option_strike_gex_history: ${rows.length} rows (5m-bucketed)`);
  const byTs = new Map();
  for (const r of rows) {
    const key = Number(r.ts);
    if (!byTs.has(key)) byTs.set(key, { ts: key, spot: Number(r.spot), rows: [] });
    byTs.get(key).rows.push({ strike: Number(r.strike), netGEX: Number(r.netGEX) || 0, netVolGEX: Number(r.netVolGEX) || 0 });
  }
  // `rows` and the per-ts `byTs` groups fall out of scope on return and become
  // GC-eligible immediately — nothing raw is retained at module scope.
  return [...byTs.values()].sort((a, b) => a.ts - b.ts).map((g) => ({
    ts: g.ts, spot: g.spot,
    callWall: findCallWall(g.rows, g.spot),
    putWall: findPutWall(g.rows, g.spot),
    gexFlip: findGexFlip(g.rows, g.spot),
  }));
}
const gexTimeline = await buildGexTimeline();

// ── CB (MVC) timeline, size normalised to $B (mixed-units bug — see memory) ──
async function buildCbTimeline() {
  const { rows } = await pool.query(`
    SELECT timestamp AS ts, "strikeOIVol" AS cb, "mvcValueOIVol" AS cb_size_raw
    FROM mvc_snapshots
    WHERE "strikeOIVol" > 0 AND date >= ${sinceExpr}
    ORDER BY timestamp ASC
  `);
  const toB = (v) => (Number.isFinite(v) && Math.abs(v) > 1e5 ? v / 1e9 : v);
  return rows
    .map((r) => ({ ts: Number(r.ts), cb: Number(r.cb), cbSize: toB(Number(r.cb_size_raw)) }))
    .filter((r) => r.cb > 0)
    .sort((a, b) => a.ts - b.ts);
}
const cbTimeline = await buildCbTimeline();
console.log(`mvc_snapshots: ${cbTimeline.length} usable rows`);

await pool.end();

// ── HMM regime inference (CALM/TRANSITIONAL/CRISIS) ────────────────────────
// States: 0=CALM, 1=TRANSITIONAL, 2=CRISIS
// Fixed HMM parameters tuned empirically from typical distributions
const STATES = ["CALM", "TRANSITIONAL", "CRISIS"];
const STATE_IDX = { CALM: 0, TRANSITIONAL: 1, CRISIS: 2 };

// Transition matrix: P(next_state | current_state)
// Calm→Calm high, Crisis→Crisis high, middle state flexible
const transitionMatrix = [
  [0.80, 0.15, 0.05],  // CALM → [CALM, TRANS, CRISIS]
  [0.20, 0.50, 0.30],  // TRANS → [CALM, TRANS, CRISIS]
  [0.10, 0.30, 0.60],  // CRISIS → [CALM, TRANS, CRISIS]
];

// Emission matrix: P(return | state) — Gaussian likelihood (simplified to buckets)
// return in [-0.04, 0.04]; buckets: tight=CALM, wide=CRISIS
function emissionProb(dailyReturn, state) {
  const absRet = Math.abs(dailyReturn);
  const sigma = [0.0063, 0.0137, 0.0289][state]; // std from your diagram
  // Gaussian: exp(-(x²/2σ²)) / √(2πσ²)
  const exponent = -(dailyReturn * dailyReturn) / (2 * sigma * sigma);
  return Math.exp(exponent) / (sigma * Math.sqrt(2 * Math.PI));
}

// Viterbi decoder: returns most likely state sequence + log-likelihood
function viterbi(dailyReturns) {
  const T = dailyReturns.length;
  const N = STATES.length;
  const path = Array(T).fill(0).map(() => Array(N));
  const prob = Array(T).fill(0).map(() => Array(N));

  // t=0: uniform prior
  for (let s = 0; s < N; s++) {
    prob[0][s] = (1 / N) * emissionProb(dailyReturns[0], s);
    path[0][s] = [s];
  }

  // forward pass
  for (let t = 1; t < T; t++) {
    for (let s = 0; s < N; s++) {
      let maxProb = -Infinity;
      let bestPrev = 0;
      for (let prevS = 0; prevS < N; prevS++) {
        const p = prob[t - 1][prevS] * transitionMatrix[prevS][s] * emissionProb(dailyReturns[t], s);
        if (p > maxProb) { maxProb = p; bestPrev = prevS; }
      }
      prob[t][s] = maxProb;
      path[t][s] = [...path[t - 1][bestPrev], s];
    }
  }

  // best final state
  let bestState = 0, bestProb = prob[T - 1][0];
  for (let s = 1; s < N; s++) {
    if (prob[T - 1][s] > bestProb) { bestProb = prob[T - 1][s]; bestState = s; }
  }

  return path[T - 1][bestState];
}

// Calculate daily returns and run Viterbi
const dailyReturns = [];
const uniqueDates = [];
for (let i = 1; i < bars.length; i++) {
  const curr = Number(bars[i].close);
  const prev = Number(bars[i - 1].close);
  if (String(bars[i].date) !== String(bars[i - 1].date)) {
    // Day boundary: take RTH close-to-close if available, else intra-day
    dailyReturns.push((curr - prev) / prev);
    uniqueDates.push(String(bars[i].date));
  }
}

let viterbiPath = [];
let stateByDate = new Map();
if (REGIME_ENABLED && dailyReturns.length > 0) {
  viterbiPath = viterbi(dailyReturns);
  for (let i = 0; i < viterbiPath.length; i++) {
    stateByDate.set(uniqueDates[i], viterbiPath[i]);
  }
  console.log(`HMM Viterbi path (last 10): ${viterbiPath.slice(-10).map((s) => STATES[s]).join(" → ")}`);
}

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

// Track regime persistence: count consecutive bars in current state
let currentState = 0, statePersistence = 0, lastStateChange = -1;

for (let i = 0; i < bars.length; i++) {
  const bar = bars[i];
  const ts = Number(bar.ts);
  while (gi + 1 < gexTimeline.length && gexTimeline[gi + 1].ts <= ts) gi++;
  while (ci + 1 < cbTimeline.length && cbTimeline[ci + 1].ts <= ts) ci++;
  if (gi < 0 || ci < 0) continue; // no snapshot yet to forward-fill from
  const gs = gexTimeline[gi], cs = cbTimeline[ci];

  // Update regime persistence tracker
  if (REGIME_ENABLED && stateByDate.has(String(bar.date))) {
    const state = stateByDate.get(String(bar.date));
    if (state !== currentState) {
      currentState = state;
      statePersistence = 1;
      lastStateChange = i;
    } else {
      statePersistence++;
    }
  }

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
    if (REGIME_ENABLED) {
      sig.regime = STATES[currentState];
      sig.regimeState = currentState;
      sig.regimePersistence = statePersistence;
      // Filter: only fire if regime persistence >= threshold
      if (statePersistence < VITERBI_PERSIST) continue;
    }
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
const byRegime = REGIME_ENABLED ? summarize(graded, (r) => r.regime) : null;

const totalResolved = graded.filter((r) => r.result !== "unresolved").length;
const totalWin = graded.filter((r) => r.result === "win").length;

const hmmMsg = REGIME_ENABLED ? ` [HMM regime enabled, viterbi-persist=${VITERBI_PERSIST}]` : "";
console.log(`Signals backtest — ${bars.length} bars (${barsByDate.size} sessions), ${DAYS}d lookback, ${LOOKMIN}m window, win=${WIN}pt stop=${STOP}pt${hmmMsg}\n`);
console.log(`${fired.length} signals fired, ${totalResolved} resolved, overall win% ${totalResolved ? Math.round((100 * totalWin) / totalResolved) : "-"}%\n`);

console.log("=== By setup (kind) ===");
console.table(byKind);
console.log("\n=== By score bucket ===");
console.table(byScore);

if (byRegime) {
  console.log("\n=== By regime (HMM) ===");
  console.table(byRegime);
}

console.log("\n=== Last 25 signals ===");
console.table(
  graded.slice(-25).map((s) => ({
    date: s.sessionDate, kind: s.kind, dir: s.direction, level: s.levelName ?? "-",
    price: s.priceEs, score: s.score, regime: s.regime ?? "-", result: s.result,
  })),
);
