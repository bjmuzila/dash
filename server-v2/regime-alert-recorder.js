'use strict';
/**
 * server-v2/regime-alert-recorder.js
 *
 * Server-side twin of the client "Regime Engine" HMM (lib/regimeHmm.ts /
 * app/test/page.tsx RegimeEngineTab) — refits the same 3-state Gaussian HMM
 * (Trend/Chop/Panic) on ESU/NQU 5m candles independently of any open browser
 * tab, and logs an ALERT every time the decoded state flips INTO Trend or
 * Panic. An alert stays OPEN until the regime flips away, at which point it's
 * closed out with the realized price reaction (return pts, max up/down
 * excursion in pts — plus the original % versions, bars elapsed) — i.e. "how
 * did the market actually react". A raw label flip only closes/opens an
 * alert once it holds for CONFIRM_BARS consecutive new bars (see below) —
 * otherwise a single noisy bar from the refit would open+close a spurious
 * alert every time it wobbled.
 *
 * Alerts-only, same spirit as signals-engine.js: nothing here places or sizes
 * a trade, it's an observability/backtest log.
 *
 * Persistence: self-creating `regime_alerts` PG table (no-ops without a DB).
 * Read API:    GET /proxy/regime-alerts?ticker=ESU&limit=50
 *
 * Wiring: require('./regime-alert-recorder').startRegimeAlertRecorder(PORT)
 *   after listen().
 */

const { fitGaussianHmm } = require('./regimeHmm');

const EVAL_MS = Number(process.env.REGIME_ALERT_EVAL_MS || 60_000);
const MIN_RETURNS = 80; // same floor as the client fit (states*20)
// The HMM is refit from scratch every cycle, and a full refit can relabel a
// near-tied bar for a single bar even when nothing really changed (same
// instability noted in the client fit comments below). Left unguarded, that
// used to open+close a brand-new alert on every such wobble ("new alert on
// every bar"). A raw label flip now only becomes a real open/close once it
// has held for CONFIRM_BARS consecutive NEW closed bars in a row — a
// momentary flip that reverts before then is treated as noise, not a
// separate alert.
const CONFIRM_BARS = Number(process.env.REGIME_ALERT_CONFIRM_BARS || 2);
const TICKERS = [
  { key: 'ESU', symbol: undefined }, // default table = es_candles
  { key: 'NQU', symbol: '/NQ' },     // nq_candles
];

// ── PG pool (lazy, no-DB-safe — same pattern as signals-engine.js) ──
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
      console.warn('[regime-alerts] pool error:', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[regime-alerts] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (ensured) return true;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS regime_alerts (
        id               BIGSERIAL   PRIMARY KEY,
        ticker           TEXT        NOT NULL,
        label            TEXT        NOT NULL,       -- 'Trend' | 'Panic'
        status           TEXT        NOT NULL DEFAULT 'open',
        start_ts         BIGINT      NOT NULL,
        start_price      REAL        NOT NULL,
        start_confidence REAL,
        end_ts           BIGINT,
        end_price        REAL,
        return_pct       REAL,
        max_up_pct       REAL,
        max_down_pct     REAL,
        bars_elapsed     INTEGER,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      -- Point-based (raw price-diff) results, added alongside the original
      -- percentage columns — ES/NQ futures traders think in points, not %, so
      -- the Alert Log now displays these instead. ADD COLUMN IF NOT EXISTS so
      -- this is safe to run against a table that already exists in prod.
      ALTER TABLE regime_alerts ADD COLUMN IF NOT EXISTS return_pts REAL;
      ALTER TABLE regime_alerts ADD COLUMN IF NOT EXISTS max_up_pts REAL;
      ALTER TABLE regime_alerts ADD COLUMN IF NOT EXISTS max_down_pts REAL;
      CREATE INDEX IF NOT EXISTS idx_regime_alerts_ticker_ts ON regime_alerts(ticker, start_ts DESC);
      CREATE INDEX IF NOT EXISTS idx_regime_alerts_status ON regime_alerts(status);
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error('[regime-alerts] ensureSchema error:', e.message);
    return false;
  }
}

async function openAlert({ ticker, label, ts, price, confidence }) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return null;
  try {
    const { rows } = await p.query(
      `INSERT INTO regime_alerts (ticker, label, status, start_ts, start_price, start_confidence)
       VALUES ($1,$2,'open',$3,$4,$5) RETURNING id`,
      [ticker, label, ts, price, confidence ?? null]
    );
    return rows[0]?.id ?? null;
  } catch (e) {
    console.warn('[regime-alerts] open insert failed:', e.message);
    return null;
  }
}

async function closeAlertRow(id, { ts, price, returnPct, maxUpPct, maxDownPct, returnPts, maxUpPts, maxDownPts, bars }) {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      `UPDATE regime_alerts SET status='closed', end_ts=$2, end_price=$3,
         return_pct=$4, max_up_pct=$5, max_down_pct=$6, bars_elapsed=$7,
         return_pts=$8, max_up_pts=$9, max_down_pts=$10
       WHERE id=$1`,
      [id, ts, price, returnPct, maxUpPct, maxDownPct, bars, returnPts, maxUpPts, maxDownPts]
    );
  } catch (e) {
    console.warn('[regime-alerts] close update failed:', e.message);
  }
}

/** Recent alerts (open + closed), newest first — for the Regime Engine tab. */
async function getRecentAlerts({ ticker = '', limit = 50 } = {}) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return [];
  const where = [];
  const params = [];
  if (ticker) { params.push(ticker); where.push(`ticker = $${params.length}`); }
  params.push(Math.min(200, Math.max(1, limit)));
  const sql = `SELECT id, ticker, label, status, start_ts, start_price, start_confidence,
                      end_ts, end_price, return_pct, max_up_pct, max_down_pct,
                      return_pts, max_up_pts, max_down_pts, bars_elapsed
               FROM regime_alerts
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY start_ts DESC LIMIT $${params.length}`;
  try {
    const { rows } = await p.query(sql, params);
    return rows;
  } catch (e) {
    console.warn('[regime-alerts] read failed:', e.message);
    return [];
  }
}

// Internal server-to-server calls carry a shared-secret header instead of a
// session (see middleware.ts) — without this the request gets redirected to
// "/" and comes back as 200 landing-page HTML, which silently parses to
// `{}` below, i.e. "not enough bars" forever. Same pattern as ref-levels-recorder.js.
function internalHeaders(extra = {}) {
  return Object.assign({}, extra,
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {});
}

// ── candle fetch — through the Next.js API, the same tables/rows the client
// hooks (useEsCandles/useNqCandles) read, so the server sees identical history.
async function fetchCloses(base, symbol) {
  const qs = symbol ? `symbol=${encodeURIComponent(symbol)}&daysBack=10&limit=5000` : `daysBack=10&limit=5000`;
  try {
    const res = await fetch(`${base}/api/snapshots/candles?${qs}`, { cache: 'no-store', headers: internalHeaders() });
    if (!res.ok) return [];
    const j = await res.json().catch(() => ({}));
    const rows = Array.isArray(j.rows) ? j.rows : [];
    return rows
      .filter((c) => Number.isFinite(Number(c.close)) && Number(c.close) > 0 && Number.isFinite(Number(c.timestamp)))
      .map((c) => ({ ts: Number(c.timestamp), close: Number(c.close) }))
      .sort((a, b) => a.ts - b.ts);
  } catch {
    return [];
  }
}

// mem[ticker] = { lastLabel, openId, openLabel, openStartTs, openStartPrice,
//   lastBarTs, candidateLabel, candidateCount }
// candidateLabel/candidateCount track an as-yet-unconfirmed flip: a raw label
// change only becomes a real open/close once it's held for CONFIRM_BARS
// consecutive new bars (see CONFIRM_BARS above).
const mem = {
  ESU: { lastLabel: null, openId: null, openLabel: null, openStartTs: null, openStartPrice: null,
         lastBarTs: null, candidateLabel: null, candidateCount: 0 },
  NQU: { lastLabel: null, openId: null, openLabel: null, openStartTs: null, openStartPrice: null,
         lastBarTs: null, candidateLabel: null, candidateCount: 0 },
};

// latestFit[ticker] = { fittedAt, bars: [{ts,close}], hmm } — the canonical,
// single-source-of-truth HMM fit each ticker's browser tabs read via
// GET /proxy/regime-state instead of re-fitting client-side (which repainted
// on every refresh: same algorithm, but each tab cold-refit on whatever data
// window happened to be loaded at that moment, and near-tied states relabel
// under tiny data deltas). One fit here, every client renders the same one.
const latestFit = { ESU: null, NQU: null };

function getLatestFit(tickerKey) {
  return latestFit[tickerKey] ?? null;
}

async function runOnceForTicker(base, tk) {
  const bars = await fetchCloses(base, tk.symbol);
  if (bars.length < MIN_RETURNS + 1) return { skipped: 'not-enough-bars' };
  const closes = bars.map((b) => b.close);
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    const r = Math.log(closes[i] / closes[i - 1]);
    if (Number.isFinite(r)) returns.push(r);
  }
  const hmm = fitGaussianHmm(returns, { states: 3, iters: 25 });
  if (!hmm) return { skipped: 'fit-failed' };

  latestFit[tk.key] = { fittedAt: Date.now(), bars, hmm };

  const label = hmm.currentLabel;
  const confidence = hmm.currentProbs[label];
  const nowBar = bars[bars.length - 1];
  const m = mem[tk.key];

  if (m.lastLabel == null) {
    // First observation this process lifetime — establish a baseline only.
    // We didn't see this regime start, so don't synthesize a fake alert for it.
    m.lastLabel = label;
    m.lastBarTs = nowBar.ts;
    return { init: label };
  }

  // The recorder runs every EVAL_MS (60s) but bars only close every 5m, so
  // most cycles see the exact same `bars` array (fetchCloses returns nothing
  // new) and would refit to an identical result anyway. Still, only let a
  // NEW closed bar advance the confirmation counter below — re-running the
  // fit against unchanged data must never count as a fresh observation.
  if (nowBar.ts === m.lastBarTs) {
    return { label, confidence, open: m.openId, unchanged: true };
  }
  m.lastBarTs = nowBar.ts;

  if (label === m.lastLabel) {
    // Regime confirmed unchanged on this bar — clear any pending flip candidate.
    m.candidateLabel = null;
    m.candidateCount = 0;
    return { label, confidence, open: m.openId };
  }

  // label !== m.lastLabel: a full HMM refit relabeled the current bar. Don't
  // act on it yet — require the SAME new label to hold for CONFIRM_BARS
  // consecutive new bars before treating it as a real flip. A one-bar wobble
  // that reverts before then never opens or closes anything, which is what
  // used to cause a spurious alert on every noisy bar.
  if (m.candidateLabel === label) {
    m.candidateCount += 1;
  } else {
    m.candidateLabel = label;
    m.candidateCount = 1;
  }
  if (m.candidateCount < CONFIRM_BARS) {
    return { label, confidence, open: m.openId, pendingFlip: `${label} (${m.candidateCount}/${CONFIRM_BARS})` };
  }

  // Confirmed flip — close the open alert (if any) and open a new one.
  if (m.openId != null) {
    const windowBars = bars.filter((b) => b.ts > m.openStartTs && b.ts <= nowBar.ts);
    let maxUp = 0, maxDown = 0, maxUpPts = 0, maxDownPts = 0;
    for (const b of windowBars) {
      const diff = b.close - m.openStartPrice;
      const chg = (diff / m.openStartPrice) * 100;
      if (chg > maxUp) maxUp = chg;
      if (chg < maxDown) maxDown = chg;
      if (diff > maxUpPts) maxUpPts = diff;
      if (diff < maxDownPts) maxDownPts = diff;
    }
    const returnPts = nowBar.close - m.openStartPrice;
    const returnPct = (returnPts / m.openStartPrice) * 100;
    await closeAlertRow(m.openId, {
      ts: nowBar.ts, price: nowBar.close, returnPct, maxUpPct: maxUp, maxDownPct: maxDown,
      returnPts, maxUpPts, maxDownPts, bars: windowBars.length,
    });
    console.log(`[regime-alerts] closed ${tk.key} ${m.openLabel} alert #${m.openId} — ${returnPts >= 0 ? '+' : ''}${returnPts.toFixed(2)} pts over ${windowBars.length} bars`);
    m.openId = null; m.openLabel = null; m.openStartTs = null; m.openStartPrice = null;
  }
  // Open a new alert if we flipped INTO Trend or Panic.
  if (label === 'Trend' || label === 'Panic') {
    const id = await openAlert({ ticker: tk.key, label, ts: nowBar.ts, price: nowBar.close, confidence });
    if (id != null) {
      m.openId = id; m.openLabel = label; m.openStartTs = nowBar.ts; m.openStartPrice = nowBar.close;
      console.log(`[regime-alerts] opened ${tk.key} ${label} alert #${id} @ ${nowBar.close} (${Math.round(confidence * 100)}% confidence)`);
    }
  }
  m.lastLabel = label;
  m.candidateLabel = null;
  m.candidateCount = 0;
  return { label, confidence, open: m.openId };
}

async function runOnce(base) {
  const out = {};
  for (const tk of TICKERS) {
    try { out[tk.key] = await runOnceForTicker(base, tk); }
    catch (e) { out[tk.key] = { error: String(e?.message || e) }; }
  }
  return out;
}

let timer = null;
function startRegimeAlertRecorder(port) {
  const base = `http://localhost:${port}`;
  if (process.env.REGIME_ALERT_RECORDER_DISABLED === '1') {
    console.log('[regime-alerts] disabled via REGIME_ALERT_RECORDER_DISABLED=1');
    return () => {};
  }
  console.log(`[regime-alerts] enabled — HMM regime-flip alert recorder every ${EVAL_MS}ms (ESU/NQU)`);
  ensureSchema().catch(() => {});
  timer = setInterval(() => { void runOnce(base); }, EVAL_MS);
  void runOnce(base); // fire once immediately so the table isn't empty for a full EVAL_MS
  return () => { if (timer) clearInterval(timer); timer = null; };
}

module.exports = {
  startRegimeAlertRecorder,
  ensureSchema,
  getPool,
  getRecentAlerts,
  getLatestFit,
  runOnce,
  _mem: mem,
};
