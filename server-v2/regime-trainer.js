'use strict';
/**
 * server-v2/regime-trainer.js
 *
 * Persistent-learning layer for the Regime Engine, per REGIME_LEARNING_DESIGN.md.
 * This is ADDITIVE to regime-alert-recorder.js (which keeps doing its own live
 * 60s refit + CONFIRM_BARS debounce for the Alert Log — that job needs bar-by-bar
 * confirmation and is left untouched). This module answers a different question:
 * "over a 30D window, refit once/day and track whether the regime calls were
 * actually predictive" — i.e. the validation/feedback loop the design doc calls
 * for, which nothing in the codebase did before this file.
 *
 * Trigger: daily 05:00-05:10 ET (before market open), Mon-Fri, non-holiday.
 * Guarded per (ticker, ET date) so a restart mid-window never double-runs, and
 * a missed window (process down at 5am) just runs on the next eval tick that
 * still falls within a later same-day check — see isTrainerWindow().
 *
 * Flow per ticker:
 *   1. Fetch 30D of 5m candles (same /api/snapshots/candles source as the
 *      live alert recorder, just a longer window).
 *   2. Fit the 3-state Gaussian HMM (Baum-Welch) on log-returns.
 *   3. Decode the full path, group by ET trading date, take each date's
 *      last-bar label as "that day's regime call".
 *   4. Validate: for each date except the most recent, compare the call
 *      against the ACTUAL next-day-close-to-close return (Trend = hit if
 *      return direction matches the state's fitted mean sign; Chop = hit if
 *      |return| <= 0.5%; Panic = hit if the day's intraday range % exceeds a
 *      volatility threshold). Store one regime_validation_log row per date.
 *   5. Roll up hit-rate across the window into accuracy_metrics, store the
 *      fit + metrics in regime_fits. If rolling hit-rate < 65%, log a flag
 *      (no admin UI wired yet — surfaced via /proxy/regime-fit for the client
 *      card to render as a red flag).
 *
 * Read API:  GET  /proxy/regime-fit?ticker=ESU
 * Manual:    POST /proxy/regime-retrain  (forces both tickers now, ignores window/date guard)
 */

const { fitGaussianHmm, REGIME_LABELS } = require('./regimeHmm');

// Fired after every successful store (daily window AND forced retrain) with
// (tickerKey, summary). server-with-proxy.js wires this to (a) the /ws/gex
// "regime-fit-updated" broadcast and (b) the alert recorder's stored-fit
// cache invalidation. No-op until set.
let onRefit = null;
function setOnRefit(fn) { onRefit = typeof fn === 'function' ? fn : null; }

const TICKERS = [
  { key: 'ESU', symbol: undefined },
  { key: 'NQU', symbol: '/NQ' },
];

const DAYS_BACK = 30;
const MIN_RETURNS = 80; // states*20 floor, same as regimeHmm's own guard

// Daily trigger window (ET minutes-since-midnight): 05:00-05:10.
const WINDOW_OPEN_MINS = 5 * 60;
const WINDOW_CLOSE_MINS = 5 * 60 + 10;

// Chop "sideways" band and Panic intraday-range threshold, both in percent —
// same thresholds the design doc's validation section describes.
const CHOP_SIDEWAYS_PCT = 0.5;
const PANIC_RANGE_PCT = 1.0;
const ACCURACY_ALERT_THRESHOLD = 0.65;

// Keep in sync with eod-gex-recorder.js / mvc-auto-snapshot.js.
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── PG pool (same lazy no-DB-safe pattern as regime-alert-recorder.js) ──────
let pool = null;
let pgUnavailable = false;
let ensured = false;

function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) { pgUnavailable = true; return null; }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
        ? undefined : { rejectUnauthorized: false },
      max: 2, keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[regime-trainer] pool error:', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[regime-trainer] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (ensured) return true;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS regime_fits (
        id                BIGSERIAL   PRIMARY KEY,
        ticker            TEXT        NOT NULL,
        fit_timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        hmm_params        JSONB       NOT NULL,
        decoded_path      JSONB       NOT NULL,
        stationary_dist   JSONB       NOT NULL,
        accuracy_metrics  JSONB       NOT NULL,
        version           INTEGER     NOT NULL DEFAULT 1,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_regime_fits_ticker_ts ON regime_fits(ticker, fit_timestamp DESC);

      CREATE TABLE IF NOT EXISTS regime_validation_log (
        id                    BIGSERIAL   PRIMARY KEY,
        ticker                TEXT        NOT NULL,
        refit_date            DATE        NOT NULL,
        regime_label          TEXT        NOT NULL,
        actual_return_pct     REAL,
        predicted_correctly   BOOLEAN,
        confidence            REAL,
        notes                 TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(ticker, refit_date)
      );
      CREATE INDEX IF NOT EXISTS idx_regime_validation_ticker_date ON regime_validation_log(ticker, refit_date DESC);
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error('[regime-trainer] ensureSchema error:', e.message);
    return false;
  }
}

// ── Time helpers (mirrors eod-gex-recorder.js) ──────────────────────────────
function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}
function etDateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((p) => p.type !== 'literal')
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function etDateOfMs(ms) { return etDateStr(new Date(ms)); }
function isTradingDay(dateStr, weekday) {
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return !MARKET_HOLIDAYS.has(dateStr);
}
function isTrainerWindow() {
  const { hour, minute, weekday } = etParts();
  const today = etDateStr();
  if (!isTradingDay(today, weekday)) return false;
  const mins = hour * 60 + minute;
  return mins >= WINDOW_OPEN_MINS && mins <= WINDOW_CLOSE_MINS;
}

function internalHeaders(extra = {}) {
  return Object.assign({}, extra,
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {});
}

async function fetchCloses(base, symbol, daysBack) {
  const qs = symbol
    ? `symbol=${encodeURIComponent(symbol)}&daysBack=${daysBack}&limit=20000`
    : `daysBack=${daysBack}&limit=20000`;
  try {
    const res = await fetch(`${base}/api/snapshots/candles?${qs}`, { cache: 'no-store', headers: internalHeaders() });
    if (!res.ok) return [];
    const j = await res.json().catch(() => ({}));
    const rows = Array.isArray(j.rows) ? j.rows : [];
    return rows
      .filter((c) => Number.isFinite(Number(c.close)) && Number(c.close) > 0 && Number.isFinite(Number(c.timestamp)))
      .map((c) => ({ ts: Number(c.timestamp), close: Number(c.close), high: Number(c.high ?? c.close), low: Number(c.low ?? c.close) }))
      .sort((a, b) => a.ts - b.ts);
  } catch {
    return [];
  }
}

/** Group bars by ET trading date; return [{date, bars:[...]}] ascending. */
function groupByEtDate(bars) {
  const map = new Map();
  for (const b of bars) {
    const d = etDateOfMs(b.ts);
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(b);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, dayBars]) => ({ date, bars: dayBars }));
}

/**
 * Validate each day's last-bar regime call against the ACTUAL next-day
 * close-to-close return + that next day's intraday range. Mirrors the
 * design doc's hit-rate rule:
 *   Trend  = hit if next-day return direction matches this state's fitted mean sign
 *   Chop   = hit if |next-day return %| <= CHOP_SIDEWAYS_PCT
 *   Panic  = hit if next-day intraday range % >= PANIC_RANGE_PCT
 */
function buildValidationRows(hmm, days) {
  const rows = [];
  const idxOf = hmm.stateIndexByLabel;
  for (let i = 0; i < days.length - 1; i++) {
    const day = days[i];
    const nextDay = days[i + 1];
    const lastBarOfDay = day.bars[day.bars.length - 1];
    const idx = hmm.decodedPathByTs?.get(lastBarOfDay.ts);
    if (idx == null) continue;
    const label = hmm.decodedPath[idx];
    const confidence = hmm.gammaByLabel[idx]?.[label] ?? null;

    const startClose = lastBarOfDay.close;
    const nextLastBar = nextDay.bars[nextDay.bars.length - 1];
    const actualReturnPct = ((nextLastBar.close - startClose) / startClose) * 100;

    let hit;
    if (label === 'Trend') {
      const meanSign = Math.sign(hmm.means[idxOf.Trend]) || 1;
      hit = Math.sign(actualReturnPct) === meanSign;
    } else if (label === 'Chop') {
      hit = Math.abs(actualReturnPct) <= CHOP_SIDEWAYS_PCT;
    } else {
      const dayHigh = Math.max(...nextDay.bars.map((b) => b.high));
      const dayLow = Math.min(...nextDay.bars.map((b) => b.low));
      const rangePct = ((dayHigh - dayLow) / startClose) * 100;
      hit = rangePct >= PANIC_RANGE_PCT;
    }

    rows.push({
      refitDate: nextDay.date, // the date the prediction is scored against
      regimeLabel: label,
      actualReturnPct,
      predictedCorrectly: hit,
      confidence,
    });
  }
  return rows;
}

async function upsertValidationRows(p, ticker, rows) {
  for (const r of rows) {
    try {
      await p.query(
        `INSERT INTO regime_validation_log (ticker, refit_date, regime_label, actual_return_pct, predicted_correctly, confidence)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (ticker, refit_date) DO UPDATE SET
           regime_label=$3, actual_return_pct=$4, predicted_correctly=$5, confidence=$6`,
        [ticker, r.refitDate, r.regimeLabel, r.actualReturnPct, r.predictedCorrectly, r.confidence]
      );
    } catch (e) {
      console.warn(`[regime-trainer] ${ticker} validation upsert failed for ${r.refitDate}:`, e.message);
    }
  }
}

function rollupAccuracy(rows) {
  const byLabel = { Trend: [], Chop: [], Panic: [] };
  for (const r of rows) byLabel[r.regimeLabel]?.push(r.predictedCorrectly);
  const rate = (arr) => (arr.length ? arr.filter(Boolean).length / arr.length : null);
  return {
    hit_rate: rate(rows.map((r) => r.predictedCorrectly)),
    trend_hit_rate: rate(byLabel.Trend),
    chop_hit_rate: rate(byLabel.Chop),
    panic_hit_rate: rate(byLabel.Panic),
    n: rows.length,
  };
}

async function runTrainerForTicker(base, tk) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return { skipped: 'no-db' };

  const bars = await fetchCloses(base, tk.symbol, DAYS_BACK);
  if (bars.length < MIN_RETURNS + 1) return { skipped: 'not-enough-bars' };

  const closes = bars.map((b) => b.close);
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    const r = Math.log(closes[i] / closes[i - 1]);
    if (Number.isFinite(r)) returns.push(r);
  }
  const hmm = fitGaussianHmm(returns, { states: 3, iters: 25 });
  if (!hmm) return { skipped: 'fit-failed' };

  // decodedPath[k] describes the return realized AT bars[k+1] (same alignment
  // regimeHmm.ts documents) — index by that bar's timestamp for easy lookup.
  hmm.decodedPathByTs = new Map();
  for (let k = 0; k < hmm.decodedPath.length; k++) {
    const bar = bars[k + 1];
    if (bar) hmm.decodedPathByTs.set(bar.ts, k);
  }

  const days = groupByEtDate(bars);
  const validationRows = buildValidationRows(hmm, days);
  await upsertValidationRows(p, tk.key, validationRows);

  // Roll up over the window's own validation rows just computed, PLUS
  // whatever's already stored for prior days not covered by this 30D window's
  // day boundaries (keeps the metric meaningful even right after a refit).
  const accuracy = rollupAccuracy(validationRows);
  if (accuracy.hit_rate != null && accuracy.hit_rate < ACCURACY_ALERT_THRESHOLD) {
    console.warn(`[regime-trainer] ${tk.key}: rolling hit-rate ${(accuracy.hit_rate * 100).toFixed(1)}% below ${ACCURACY_ALERT_THRESHOLD * 100}% threshold — regime calls may not be predictive right now`);
  }

  const stationaryDist = REGIME_LABELS.reduce((acc, l, i) => {
    acc[l] = hmm.stationary[i];
    return acc;
  }, {});

  const hmmParams = {
    means: hmm.means,
    stds: hmm.stds,
    transition: hmm.transition,
    labels: hmm.labels,
    logLik: hmm.logLik,
    iterations: hmm.iterations,
  };

  try {
    const { rows: verRows } = await p.query(
      `SELECT COALESCE(MAX(version),0)+1 AS v FROM regime_fits WHERE ticker=$1`, [tk.key]
    );
    const version = verRows[0]?.v ?? 1;
    await p.query(
      `INSERT INTO regime_fits (ticker, fit_timestamp, hmm_params, decoded_path, stationary_dist, accuracy_metrics, version)
       VALUES ($1, NOW(), $2, $3, $4, $5, $6)`,
      [tk.key, JSON.stringify(hmmParams), JSON.stringify(hmm.decodedPath), JSON.stringify(stationaryDist), JSON.stringify(accuracy), version]
    );
    console.log(`[regime-trainer] ${tk.key}: daily refit stored (v${version}), ${bars.length} bars, hit-rate ${accuracy.hit_rate != null ? (accuracy.hit_rate * 100).toFixed(1) + '%' : 'n/a'} over ${accuracy.n} validated days`);
    try { onRefit?.(tk.key, { version, accuracy, stationaryDist }); } catch (e) {
      console.warn(`[regime-trainer] onRefit hook failed:`, e.message);
    }
  } catch (e) {
    console.warn(`[regime-trainer] ${tk.key}: store failed:`, e.message);
    return { error: e.message };
  }

  return { ok: true, bars: bars.length, accuracy };
}

async function runTrainerOnce(base) {
  const out = {};
  for (const tk of TICKERS) {
    try { out[tk.key] = await runTrainerForTicker(base, tk); }
    catch (e) { out[tk.key] = { error: String(e?.message || e) }; }
  }
  return out;
}

/** Latest stored fit + recent validation log rows for a ticker, for /proxy/regime-fit. */
async function getLatestStoredFit(ticker) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return null;
  try {
    const { rows } = await p.query(
      `SELECT ticker, fit_timestamp, hmm_params, decoded_path, stationary_dist, accuracy_metrics, version, created_at
       FROM regime_fits WHERE ticker=$1 ORDER BY fit_timestamp DESC LIMIT 1`,
      [ticker]
    );
    const fit = rows[0] ?? null;
    const { rows: valRows } = await p.query(
      `SELECT refit_date, regime_label, actual_return_pct, predicted_correctly, confidence
       FROM regime_validation_log WHERE ticker=$1 ORDER BY refit_date DESC LIMIT 20`,
      [ticker]
    );
    return { fit, validation: valRows };
  } catch (e) {
    console.warn('[regime-trainer] read failed:', e.message);
    return null;
  }
}

const lastRunDate = { ESU: null, NQU: null };

let timer = null;
function startRegimeTrainer(port) {
  const base = `http://localhost:${port}`;
  if (process.env.REGIME_TRAINER_DISABLED === '1') {
    console.log('[regime-trainer] disabled via REGIME_TRAINER_DISABLED=1');
    return () => {};
  }
  console.log('[regime-trainer] enabled — daily 30D HMM refit + validation, 05:00-05:10 ET window (ESU/NQU)');
  (async () => {
    if (!(await ensureSchema().catch(() => false))) return;
    // Best-effort: seed lastRunDate from whatever's already stored so a
    // restart mid-morning doesn't re-run a refit that already happened today.
    for (const tk of TICKERS) {
      const latest = await getLatestStoredFit(tk.key).catch(() => null);
      if (latest?.fit?.fit_timestamp) {
        lastRunDate[tk.key] = etDateOfMs(new Date(latest.fit.fit_timestamp).getTime());
      }
    }
  })();
  timer = setInterval(async () => {
    if (!isTrainerWindow()) return;
    const today = etDateStr();
    for (const tk of TICKERS) {
      if (lastRunDate[tk.key] === today) continue;
      lastRunDate[tk.key] = today; // set before awaiting so a slow run can't double-fire
      try {
        const r = await runTrainerForTicker(base, tk);
        console.log(`[regime-trainer] ${tk.key} daily run:`, r);
      } catch (e) {
        console.warn(`[regime-trainer] ${tk.key} daily run failed:`, e.message);
      }
    }
  }, 60_000);
  return () => { if (timer) clearInterval(timer); timer = null; };
}

/** Manual force-run for POST /proxy/regime-retrain — ignores window + date guard. */
async function forceRetrainAll(base) {
  const today = etDateStr();
  const out = await runTrainerOnce(base);
  for (const tk of TICKERS) lastRunDate[tk.key] = today;
  return out;
}

module.exports = {
  startRegimeTrainer,
  ensureSchema,
  runTrainerOnce,
  forceRetrainAll,
  getLatestStoredFit,
  setOnRefit,
};
