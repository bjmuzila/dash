'use strict';
/**
 * server-v2/regime-alert-recorder.js
 *
 * Server-side twin of the client "Regime Engine" HMM (lib/regimeHmm.ts /
 * app/test/page.tsx RegimeEngineTab) — refits the same 3-state Gaussian HMM
 * (Trend/Chop/Panic) on ESU/NQU 5m candles independently of any open browser
 * tab, and logs an ALERT every time the decoded state flips INTO Trend or
 * Panic. An alert stays OPEN until the regime flips away, at which point it's
 * closed out with the realized price reaction (return %, max up/down
 * excursion, bars elapsed) — i.e. "how did the market actually react".
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

async function closeAlertRow(id, { ts, price, returnPct, maxUpPct, maxDownPct, bars }) {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      `UPDATE regime_alerts SET status='closed', end_ts=$2, end_price=$3,
         return_pct=$4, max_up_pct=$5, max_down_pct=$6, bars_elapsed=$7
       WHERE id=$1`,
      [id, ts, price, returnPct, maxUpPct, maxDownPct, bars]
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
                      end_ts, end_price, return_pct, max_up_pct, max_down_pct, bars_elapsed
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

// ── candle fetch — through the Next.js API, the same tables/rows the client
// hooks (useEsCandles/useNqCandles) read, so the server sees identical history.
async function fetchCloses(base, symbol) {
  const qs = symbol ? `symbol=${encodeURIComponent(symbol)}&daysBack=10&limit=5000` : `daysBack=10&limit=5000`;
  try {
    const res = await fetch(`${base}/api/snapshots/candles?${qs}`, { cache: 'no-store' });
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

// mem[ticker] = { lastLabel, openId, openLabel, openStartTs, openStartPrice }
const mem = {
  ESU: { lastLabel: null, openId: null, openLabel: null, openStartTs: null, openStartPrice: null },
  NQU: { lastLabel: null, openId: null, openLabel: null, openStartTs: null, openStartPrice: null },
};

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

  const label = hmm.currentLabel;
  const confidence = hmm.currentProbs[label];
  const nowBar = bars[bars.length - 1];
  const m = mem[tk.key];

  if (m.lastLabel == null) {
    // First observation this process lifetime — establish a baseline only.
    // We didn't see this regime start, so don't synthesize a fake alert for it.
    m.lastLabel = label;
    return { init: label };
  }

  if (label !== m.lastLabel) {
    // Close an open alert whenever we flip AWAY from its label.
    if (m.openId != null) {
      const windowBars = bars.filter((b) => b.ts > m.openStartTs && b.ts <= nowBar.ts);
      let maxUp = 0, maxDown = 0;
      for (const b of windowBars) {
        const chg = ((b.close - m.openStartPrice) / m.openStartPrice) * 100;
        if (chg > maxUp) maxUp = chg;
        if (chg < maxDown) maxDown = chg;
      }
      const returnPct = ((nowBar.close - m.openStartPrice) / m.openStartPrice) * 100;
      await closeAlertRow(m.openId, {
        ts: nowBar.ts, price: nowBar.close, returnPct, maxUpPct: maxUp, maxDownPct: maxDown,
        bars: windowBars.length,
      });
      console.log(`[regime-alerts] closed ${tk.key} ${m.openLabel} alert #${m.openId} — ${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}% over ${windowBars.length} bars`);
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
  }
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
  runOnce,
  _mem: mem,
};
