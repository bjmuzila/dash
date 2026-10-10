'use strict';
/**
 * server-v2/eod-dte-gamma-recorder.js
 *
 * Persists the EOD dealer-gamma-by-DTE snapshot.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * eod-gex-recorder.js already sweeps every listed expiration through ThetaData
 * at the close and collapses it to two scalars: `total_gex` and
 * `total_gex_ex0dte`. The per-strike gamma and OI that sweep pulls are thrown
 * away once the totals are computed, and nothing else in the schema stores
 * per-strike gamma (option_strike_gex_history keeps net_gex, which already has
 * gamma baked in and is not separable).
 *
 * So a DTE breakdown cannot be reconstructed after the fact — it has to be
 * computed at snapshot time, from the sweep that is already happening, and
 * written down. That is all this module does.
 *
 * ── Timing ────────────────────────────────────────────────────────────────
 * Anchored to the same 15:55 ET window the existing recorder uses
 * (WINDOW_OPEN_MINS = 955). That is not cosmetic: 0DTE contracts settle at the
 * close, so a snapshot taken at 16:00 records their gamma as zero and the most
 * interesting row in the table disappears.
 *
 * ── Safety ────────────────────────────────────────────────────────────────
 * Idempotent per (date, symbol, bucket) via ON CONFLICT, so a re-run or a
 * process restart inside the window overwrites rather than duplicating. No-ops
 * cleanly without DATABASE_URL.
 */

const { bucketChain } = require('./computation/dte-buckets.js');

let pool = null;
let pgUnavailable = false;
let _schemaReady = false;

function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) { pgUnavailable = true; return null; }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[eod-dte-gamma] pool error:', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[eod-dte-gamma] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

/**
 * One row per (date, symbol, bucket). Rollups (`ex0dte`, `all`) are stored as
 * rows too, flagged by `is_rollup`, so a consumer can render them without
 * recomputing — but the flag means a naive `SUM(net_gamma)` over the table
 * cannot silently double-count.
 */
async function ensureSchema() {
  if (_schemaReady) return true;
  const p = getPool();
  if (!p) return false;
  await p.query(`
    CREATE TABLE IF NOT EXISTS eod_dte_gamma (
      date         DATE             NOT NULL,
      symbol       TEXT             NOT NULL,
      bucket       TEXT             NOT NULL,
      label        TEXT             NOT NULL,
      dte_label    TEXT             NOT NULL,
      is_rollup    BOOLEAN          NOT NULL DEFAULT FALSE,
      sort_order   INTEGER          NOT NULL DEFAULT 0,
      expirations  INTEGER          NOT NULL DEFAULT 0,
      strikes      INTEGER          NOT NULL DEFAULT 0,
      call_oi      BIGINT           NOT NULL DEFAULT 0,
      put_oi       BIGINT           NOT NULL DEFAULT 0,
      net_gamma    DOUBLE PRECISION NOT NULL DEFAULT 0,
      basis        TEXT             NOT NULL DEFAULT 'convention',
      measured_cov DOUBLE PRECISION NOT NULL DEFAULT 0,
      spot         DOUBLE PRECISION,
      computed_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol, bucket)
    );
  `);
  // The read path is always "latest N sessions for this symbol, in bucket
  // order", so lead with symbol and sort descending by date.
  await p.query(`CREATE INDEX IF NOT EXISTS idx_eod_dte_gamma_symbol_date
                 ON eod_dte_gamma (symbol, date DESC, sort_order);`);
  _schemaReady = true;
  return true;
}

/**
 * Attach measured signed flow + OI deltas to the strikes we actually have them
 * for, so near-dated buckets can use the measured basis instead of the
 * call+/put− convention.
 *
 * Reads Postgres rather than reaching into the live proxy's
 * FlowGexAccumulator on purpose: this works whether or not the recorder shares
 * a process with the feed, and it survives a mid-session restart because
 * flow_prints is already persisted every 500ms by
 * state/flow-history-writer.js.
 *
 * Strikes with no match are left untouched, and dte-buckets.js falls back to
 * the convention basis for them — see the `canMeasure` branch there.
 *
 * @param {Array} strikes rows from the EOD chain sweep (mutated in place)
 * @param {{symbol:string, date:string, underlying?:string}} ctx
 * @param {object} [poolOverride] injected pool, for tests
 * @returns {Promise<{flowStrikes:number, oiStrikes:number}>}
 */
async function enrichWithFlowAndOi(strikes, { symbol, date, underlying = 'SPX' }, poolOverride) {
  const p = poolOverride || getPool();
  if (!p || !Array.isArray(strikes) || !strikes.length) {
    return { flowStrikes: 0, oiStrikes: 0 };
  }

  const byKey = new Map();
  for (const s of strikes) byKey.set(`${s.expiration}|${Number(s.strike)}`, s);

  let flowStrikes = 0;
  let oiStrikes = 0;

  // ── signed flow ──────────────────────────────────────────────────────────
  // Same shape as state/flow-gex-rehydrate.js: exclude neutral/unclassifiable
  // prints so they can't leak in as taker buys and bias the book short.
  try {
    const { rows } = await p.query(
      `SELECT expiration, strike, type, side, SUM(size) AS vol
         FROM flow_prints
        WHERE date = $1
          AND (underlying_norm = $2 OR underlying_norm = $2 || 'W')
          AND strike IS NOT NULL AND size IS NOT NULL AND expiration IS NOT NULL
          AND (bucket IS NULL OR bucket <> 'neutral')
          AND side IN ('buy','sell')
        GROUP BY expiration, strike, type, side`,
      [date, String(underlying).toUpperCase()]
    );
    for (const r of rows) {
      const s = byKey.get(`${r.expiration}|${Number(r.strike)}`);
      if (!s) continue;
      if (!s.inventory) {
        s.inventory = { callBuyVol: 0, callSellVol: 0, putBuyVol: 0, putSellVol: 0 };
        flowStrikes += 1;
      }
      const v = Number(r.vol) || 0;
      const isCall = String(r.type).toUpperCase().startsWith('C');
      // taker buy -> dealer sold; taker sell -> dealer bought
      if (r.side === 'buy') {
        if (isCall) s.inventory.callSellVol += v; else s.inventory.putSellVol += v;
      } else if (isCall) s.inventory.callBuyVol += v; else s.inventory.putBuyVol += v;
    }
  } catch (e) {
    console.warn('[eod-dte-gamma] flow enrichment skipped:', e.message);
  }

  // ── OI deltas ────────────────────────────────────────────────────────────
  // Today's snapshot minus the most recent PRIOR one. Using the prior available
  // date rather than "yesterday" means a gap in the oi_daily sweep widens the
  // delta window instead of silently dropping the day.
  try {
    const oiSymbol = String(symbol).replace(/^\$/, '').toUpperCase();
    const { rows } = await p.query(
      `WITH two AS (
         SELECT DISTINCT date FROM oi_daily
          WHERE symbol = $1 AND date <= $2::date
          ORDER BY date DESC LIMIT 2
       )
       SELECT date::text AS date, expiry, strike, call_oi, put_oi
         FROM oi_daily
        WHERE symbol = $1 AND date IN (SELECT date FROM two)`,
      [oiSymbol, date]
    );
    const dates = [...new Set(rows.map((r) => r.date))].sort();
    if (dates.length === 2) {
      const [prev, cur] = dates;
      const snap = new Map();
      for (const r of rows) {
        snap.set(`${r.date}|${r.expiry}|${Number(r.strike)}`, {
          callOi: Number(r.call_oi) || 0,
          putOi: Number(r.put_oi) || 0,
        });
      }
      for (const [key, s] of byKey) {
        const [exp, strike] = key.split('|');
        const a = snap.get(`${cur}|${exp}|${Number(strike)}`);
        const b = snap.get(`${prev}|${exp}|${Number(strike)}`);
        if (!a || !b) continue;
        s.callOiDelta = a.callOi - b.callOi;
        s.putOiDelta = a.putOi - b.putOi;
        oiStrikes += 1;
      }
    }
  } catch (e) {
    console.warn('[eod-dte-gamma] OI-delta enrichment skipped:', e.message);
  }

  // A strike with flow but NO OI baseline cannot use the default 'oi'
  // estimator (magnitude would be zero, silently voiding it). Drop the
  // inventory so it falls back to convention rather than reporting a zero.
  for (const s of byKey.values()) {
    if (s.inventory && s.callOiDelta == null && s.putOiDelta == null) {
      delete s.inventory;
      flowStrikes -= 1;
    }
  }

  return { flowStrikes: Math.max(0, flowStrikes), oiStrikes };
}

/**
 * Compute the DTE breakdown for one session and write it.
 *
 * @param {object} args
 * @param {string} args.date        'YYYY-MM-DD' session date
 * @param {string} args.symbol      e.g. '$SPX' — matches eod_gex's convention
 * @param {number} args.spot        underlying at the snapshot instant
 * @param {Array}  args.strikes     flattened all-expirations chain (see
 *                                  computation/dte-buckets.js for the shape)
 * @param {boolean} [args.enrich=true] pull flow + OI deltas from Postgres so
 *                                  near-dated buckets can use the measured basis
 * @param {string} [args.underlying='SPX'] flow_prints underlying_norm to match
 * @param {object} [args.opts]      passed through to bucketChain
 * @returns {Promise<{written:number, totals:object}|null>} null if no DB
 */
async function recordDteGamma({ date, symbol, spot, strikes, enrich = true, underlying = 'SPX', opts = {} }) {
  let enrichment = { flowStrikes: 0, oiStrikes: 0 };
  if (enrich) {
    await ensureSchema();
    enrichment = await enrichWithFlowAndOi(strikes, { symbol, date, underlying });
  }

  const snap = bucketChain({ sessionDate: date, spot, strikes }, opts);

  const ok = await ensureSchema();
  if (!ok) {
    console.warn('[eod-dte-gamma] no DATABASE_URL — computed but not persisted');
    return null;
  }
  const p = getPool();

  const rows = [
    ...snap.buckets.map((b, i) => ({ ...b, isRollup: false, sort: i })),
    ...snap.rollups.map((r, i) => ({
      ...r, isRollup: true, sort: 100 + i, measuredCoverage: 0,
    })),
  ];

  let written = 0;
  for (const r of rows) {
    await p.query(
      `INSERT INTO eod_dte_gamma
         (date, symbol, bucket, label, dte_label, is_rollup, sort_order,
          expirations, strikes, call_oi, put_oi, net_gamma, basis, measured_cov,
          spot, computed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
       ON CONFLICT (date, symbol, bucket) DO UPDATE SET
         label        = EXCLUDED.label,
         dte_label    = EXCLUDED.dte_label,
         is_rollup    = EXCLUDED.is_rollup,
         sort_order   = EXCLUDED.sort_order,
         expirations  = EXCLUDED.expirations,
         strikes      = EXCLUDED.strikes,
         call_oi      = EXCLUDED.call_oi,
         put_oi       = EXCLUDED.put_oi,
         net_gamma    = EXCLUDED.net_gamma,
         basis        = EXCLUDED.basis,
         measured_cov = EXCLUDED.measured_cov,
         spot         = EXCLUDED.spot,
         computed_at  = now()`,
      [
        date, symbol, r.key, r.label, r.dteLabel, r.isRollup, r.sort,
        r.expirations || 0, r.strikes || 0,
        Math.round(r.callOi || 0), Math.round(r.putOi || 0),
        r.netGamma || 0, r.basis || 'convention', r.measuredCoverage || 0,
        spot || null,
      ]
    );
    written += 1;
  }

  console.log(
    `[eod-dte-gamma] ${symbol} ${date}: ${written} rows · ` +
    `net ${(snap.totals.net / 1e9).toFixed(2)}B · ` +
    `0DTE ${(snap.totals.zeroDte / 1e9).toFixed(2)}B · ` +
    `ex-0DTE ${(snap.totals.ex0dte / 1e9).toFixed(2)}B · ` +
    `measured ${enrichment.flowStrikes} strikes (OI baseline on ${enrichment.oiStrikes})`
  );
  return { written, totals: snap.totals, snapshot: snap, enrichment };
}

/**
 * Read back the most recent sessions. Returned ascending by date and in bucket
 * order so the UI can render without re-sorting.
 *
 * @param {{symbol?:string, date?:string, limitDays?:number}} q
 * @returns {Promise<Array>}
 */
async function getDteGamma({ symbol = '$SPX', date = '', limitDays = 30 } = {}) {
  const ok = await ensureSchema();
  if (!ok) return [];
  const p = getPool();

  if (date) {
    const { rows } = await p.query(
      `SELECT date::text AS date, symbol, bucket, label, dte_label, is_rollup,
              expirations, strikes, call_oi, put_oi, net_gamma, basis,
              measured_cov, spot
         FROM eod_dte_gamma
        WHERE symbol = $1 AND date = $2::date
        ORDER BY sort_order`,
      [symbol, date]
    );
    return rows;
  }

  const { rows } = await p.query(
    `WITH recent AS (
       SELECT DISTINCT date FROM eod_dte_gamma
        WHERE symbol = $1 ORDER BY date DESC LIMIT $2
     )
     SELECT g.date::text AS date, g.symbol, g.bucket, g.label, g.dte_label,
            g.is_rollup, g.expirations, g.strikes, g.call_oi, g.put_oi,
            g.net_gamma, g.basis, g.measured_cov, g.spot
       FROM eod_dte_gamma g
       JOIN recent r ON r.date = g.date
      WHERE g.symbol = $1
      ORDER BY g.date ASC, g.sort_order ASC`,
    [symbol, Math.max(1, Math.min(365, limitDays))]
  );
  return rows;
}

module.exports = { ensureSchema, enrichWithFlowAndOi, recordDteGamma, getDteGamma };
