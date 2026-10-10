'use strict';
/**
 * server-v2/forward-scanner-recorder.js
 *
 * FORWARD WALLS — the same call wall / put wall / CORE calculation as
 * scanner-recorder.js, but pointed at the next expiry that has NOT settled.
 *
 * WHY A SEPARATE TABLE AND NOT A COLUMN
 *   Every reader of scanner_snapshots assumes ONE expiry per symbol per session
 *   and takes the newest row:
 *     walls-recorder.sampleUniverse  SELECT DISTINCT ON (symbol) ... ts DESC
 *     walls-reach.getWatch           same shape
 *     walls-reach.buildSessionRows   the whole intraday path for a session
 *   The `expiry` column exists there but NOTHING filters on it. Writing
 *   forward rows into that table would make the walls recorder log a phantom
 *   change when tomorrow's strike differs from today's, make the watchlist
 *   quote a distance to a contract that is not trading, and interleave two
 *   expiries into one path in the reach study. So the forward horizon gets its
 *   own table and the intraday invariant stays intact.
 *
 * WHEN IT RUNS
 *   Post-close (16:10-18:00 ET) and pre-open (08:00-09:15 ET). Deliberately not
 *   during the session: the 0DTE sweep owns RTH, and doubling 168 tickers of
 *   Theta/TT load is exactly what the 3-wide governor in proxy-thetadata.js was
 *   added to prevent. The pre-open window ends where the intraday sweep begins.
 *
 * Wiring:      startForwardScanner() in server-with-proxy.js
 * Read API:    GET /proxy/walls-forward[?date=&symbol=]
 * Manual fire: POST /proxy/walls-forward-run { force?: true }
 */

const {
  snapshotTicker, parseScannerTickers, etDateStr, etParts, MARKET_HOLIDAYS,
} = require('./scanner-recorder');

/** Sweeps are 15m, not 5m — forward walls move on OI, which updates daily. */
const INTERVAL_MINS = Number(process.env.FORWARD_SCANNER_INTERVAL_MINS || 15);

/** Pre-open window: ends where scanner-recorder's own window opens (09:15). */
const PREOPEN_START = 8 * 60;
const PREOPEN_END = 9 * 60 + 15;
/** Post-close: starts after the 0DTE contract has settled and prices firm up. */
const POSTCLOSE_START = 16 * 60 + 10;
const POSTCLOSE_END = 18 * 60;

// ── PG ───────────────────────────────────────────────────────────────────────

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
      console.warn('[forward] pool error:', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[forward] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (ensured) return true;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS scanner_forward (
        date          TEXT        NOT NULL,   -- ET session the sweep ran in
        symbol        TEXT        NOT NULL,
        expiry        TEXT        NOT NULL,   -- the contract being measured
        ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        spot          REAL,
        total_net_gex REAL,
        call_wall     REAL,
        put_wall      REAL,
        gex_flip      REAL,
        cb            REAL,
        strikes       INTEGER,
        call_wall_gex REAL,
        put_wall_gex  REAL,
        cb_gex        REAL,
        PRIMARY KEY (date, symbol, expiry, ts)
      );
      CREATE INDEX IF NOT EXISTS scanner_fwd_lookup ON scanner_forward (date, symbol, ts DESC);
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error('[forward] ensureSchema error:', e.message);
    return false;
  }
}

// ── Expiry selection ─────────────────────────────────────────────────────────

/**
 * First expiry strictly AFTER today's ET date.
 *
 * Strictly after, not "first unsettled": during the pre-open window today's
 * 0DTE has not expired yet, but it is not the look-ahead contract either — the
 * intraday sweep already covers it. Returns null when the chain only carries
 * today, which is a real answer, not an error.
 */
function nextExpiryAfterToday(expirations, today = etDateStr()) {
  if (!Array.isArray(expirations)) return null;
  for (const e of expirations) if (String(e) > today) return String(e);
  return null;
}

// ── Window ───────────────────────────────────────────────────────────────────

function inForwardWindow(d = new Date()) {
  const { hour, minute, weekday } = etParts(d);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(etDateStr(d))) return false;
  const m = hour * 60 + minute;
  return (m >= PREOPEN_START && m < PREOPEN_END)
    || (m >= POSTCLOSE_START && m < POSTCLOSE_END);
}

// ── Sweep ────────────────────────────────────────────────────────────────────

async function runForwardSweep({ force = false, symbols = null } = {}) {
  if (!force && !inForwardWindow()) return { skipped: 'outside forward window' };

  const tickers = symbols?.length ? symbols : parseScannerTickers();
  if (!tickers.length) return { skipped: 'no SCANNER_TICKERS' };

  const p = getPool();
  if (!p || !(await ensureSchema())) return { skipped: 'no DB' };

  const date = etDateStr();
  const now = new Date();
  const pick = (exps) => nextExpiryAfterToday(exps, date);
  let written = 0;
  const errors = [];

  for (const root of tickers) {
    try {
      const s = await snapshotTicker(root, { pick }); // eslint-disable-line no-await-in-loop
      if (!s || s.err) { errors.push(`${root}:${s?.err || 'null'}`); continue; }
      await p.query( // eslint-disable-line no-await-in-loop
        `INSERT INTO scanner_forward
           (date, symbol, expiry, ts, spot, total_net_gex, call_wall, put_wall,
            gex_flip, cb, strikes, call_wall_gex, put_wall_gex, cb_gex)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT DO NOTHING`,
        [date, root, s.expiry, now, s.spot, s.totalNetGex, s.callWall, s.putWall,
          s.gexFlip, s.cb, s.strikes, s.callWallGex, s.putWallGex, s.cbGex],
      );
      written++;
    } catch (e) {
      errors.push(`${root}:${String(e?.message || e).slice(0, 60)}`);
    }
  }

  console.log(`[forward] wrote ${written}/${tickers.length} @ ${now.toISOString()}`
    + `${errors.length ? ` (skipped: ${errors.length})` : ''}`);
  return { ok: true, written, total: tickers.length, date, errors };
}

// ── Read ─────────────────────────────────────────────────────────────────────

/** Newest forward row per symbol for `date`, with the contract it describes. */
async function getForward({ date, symbol } = {}) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return { ok: false, error: 'no DB' };
  const day = date || etDateStr();

  if (symbol) {
    const { rows } = await p.query(
      `SELECT ts, expiry, spot, total_net_gex, call_wall, put_wall, gex_flip, cb,
              strikes, call_wall_gex, put_wall_gex, cb_gex
         FROM scanner_forward WHERE date = $1 AND symbol = $2
        ORDER BY ts DESC LIMIT 60`,
      [day, String(symbol).toUpperCase()],
    );
    return { ok: true, date: day, symbol: String(symbol).toUpperCase(), rows };
  }

  const { rows } = await p.query(
    `SELECT DISTINCT ON (symbol)
            symbol, expiry, ts, spot, call_wall, put_wall, cb, total_net_gex,
            call_wall_gex, put_wall_gex, cb_gex
       FROM scanner_forward WHERE date = $1
      ORDER BY symbol, ts DESC`,
    [day],
  );
  return { ok: true, date: day, asof: rows[0]?.ts ?? null, tickers: rows };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

function startForwardScanner() {
  if (!parseScannerTickers().length) {
    console.log('[forward] no SCANNER_TICKERS — forward recorder idle.');
    return;
  }
  _timer = setInterval(() => {
    runForwardSweep().catch((e) => console.warn('[forward] sweep error:', e.message));
  }, INTERVAL_MINS * 60 * 1000);
  if (_timer.unref) _timer.unref();
  console.log('[forward] next-expiry recorder started — '
    + `08:00-09:15 and 16:10-18:00 ET every ${INTERVAL_MINS}m`);
}

module.exports = {
  startForwardScanner, runForwardSweep, getForward, ensureSchema, getPool,
  nextExpiryAfterToday, inForwardWindow,
};
