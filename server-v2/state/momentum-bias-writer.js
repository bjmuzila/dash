'use strict';
/**
 * server-v2/state/momentum-bias-writer.js
 *
 * Postgres writer + grader for Momentum Bias take-profit / reversal signals.
 * Mirrors the lazy-pool + no-op-without-DB pattern of es-candle-writer.js.
 *
 *   recordSignals(events)   — idempotent upsert into momentum_bias_signals
 *                             (ON CONFLICT(signal_key) DO NOTHING). Called from
 *                             the feed for CLOSED bars only (never the forming
 *                             bar, which repaints).
 *   gradePendingSignals()   — grades 'pending' rows by follow-through over the
 *                             next FOLLOW_BARS es_candles after trigger_ts.
 *
 * No-ops cleanly when DATABASE_URL is unset. Never throws into the caller.
 */

const FOLLOW_BARS = 6;      // 6 × 5m = 30m follow-through window
const WIN_R = 1.5;          // favorable must beat adverse by this to be a win
const GRADE_BATCH = 500;

let pool = null;
let pgUnavailable = false;
let _lastPoolWarn = 0;

function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) { pgUnavailable = true; return null; }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
        ? undefined
        : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[momentum-bias] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    console.error('[momentum-bias] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

function _isTransient(msg) {
  return /terminat|ECONNRESET|ETIMEDOUT|Connection|socket|server closed|after calling end|recovery mode|not yet accepting|cannot use a pool/i.test(msg);
}
function _onErr(e, ctx) {
  const msg = String(e?.message || '');
  if (_isTransient(msg)) {
    try { pool?.end().catch(() => {}); } catch {}
    pool = null;
    const now = Date.now();
    if (!_lastPoolWarn || now - _lastPoolWarn > 5000) {
      _lastPoolWarn = now;
      console.warn(`[momentum-bias] DB unavailable, will reconnect: ${msg.slice(0, 80)}`);
    }
  } else {
    console.warn(`[momentum-bias] ${ctx} failed:`, msg.slice(0, 140));
  }
}

/**
 * Upsert TP signal rows. Each event:
 *   { signalKey, date, symbol, dir('bull'|'bear'), triggerTs, slotKey, time,
 *     price, upBias, downBias, boundary, atr }
 * @param {object|object[]} events
 */
async function recordSignals(events) {
  const p = getPool();
  if (!p) return;
  const list = Array.isArray(events) ? events : [events];
  if (!list.length) return;
  for (const e of list) {
    const signalKey = String(e.signalKey || '');
    const triggerTs = Number(e.triggerTs);
    if (!signalKey || !(triggerTs > 0)) continue;
    try {
      await p.query(
        `INSERT INTO momentum_bias_signals
           (signal_key,date,symbol,dir,trigger_ts,slot_key,time,price,up_bias,down_bias,boundary,atr)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT(signal_key) DO NOTHING`,
        [
          signalKey, String(e.date || ''), String(e.symbol || '/ES'), String(e.dir || ''),
          triggerTs, String(e.slotKey || ''), String(e.time || ''),
          Number(e.price), Number(e.upBias), Number(e.downBias), Number(e.boundary),
          Number(e.atr || 0),
        ]
      );
    } catch (err) { _onErr(err, 'record'); return; }
  }
}

/**
 * Grade every 'pending' signal that now has FOLLOW_BARS closed bars after it.
 * Returns the number of rows graded. Safe to call on an interval.
 */
async function gradePendingSignals() {
  const p = getPool();
  if (!p) return 0;
  let graded = 0;
  try {
    const { rows: pending } = await p.query(
      `SELECT id, dir, trigger_ts, price, atr FROM momentum_bias_signals
       WHERE outcome = 'pending' ORDER BY trigger_ts ASC LIMIT $1`,
      [GRADE_BATCH]
    );
    for (const s of pending) {
      const { rows: fwd } = await p.query(
        `SELECT timestamp, high, low, close FROM es_candles
         WHERE timestamp > $1 ORDER BY timestamp ASC LIMIT $2`,
        [Number(s.trigger_ts), FOLLOW_BARS]
      );
      if (fwd.length < FOLLOW_BARS) continue; // not enough follow-through yet → stay pending

      const price = Number(s.price);
      let hi = -Infinity, lo = Infinity;
      for (const b of fwd) { hi = Math.max(hi, Number(b.high)); lo = Math.min(lo, Number(b.low)); }
      const isBull = s.dir === 'bull';
      const favorable = isBull ? (hi - price) : (price - lo); // move in the signal's direction
      const adverse = isBull ? (price - lo) : (hi - price);   // move against it
      const risk = Number(s.atr) > 0 ? Number(s.atr) : Math.max(1e-9, (hi - lo) / FOLLOW_BARS);
      const rMultiple = favorable / risk;

      let outcome;
      if (favorable >= risk && favorable >= WIN_R * adverse) outcome = 'win';
      else if (adverse >= risk && adverse > favorable) outcome = 'loss';
      else outcome = 'chop';

      const last = fwd[fwd.length - 1];
      await p.query(
        `UPDATE momentum_bias_signals
           SET outcome=$2, mfe=$3, mae=$4, r_multiple=$5, resolved_ts=$6, resolved_price=$7,
               updated_at=CURRENT_TIMESTAMP
         WHERE id=$1`,
        [s.id, outcome, favorable, adverse, rMultiple, Number(last.timestamp), Number(last.close)]
      );
      graded++;
    }
  } catch (err) { _onErr(err, 'grade'); }
  return graded;
}

module.exports = { recordSignals, gradePendingSignals, FOLLOW_BARS };
