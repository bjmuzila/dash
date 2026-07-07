'use strict';
/**
 * server-v2/darkpool-routes.js
 *
 * REST handlers for the /flow page's per-ticker Dark Pool section:
 *   - /proxy/darkpool-history  raw tape backfill (today's session by default)
 *   - /proxy/darkpool-accum    cumulative volume/notional bins — Intraday
 *                              (minute bins, resets each session) or 5D/7D
 *                              (one bin per session, client walks a running total)
 *
 * Mirrors the query/cache shape of /proxy/flow-history and /proxy/flow-netprem
 * in server-with-proxy.js so the two feeds feel identical to the frontend.
 * Both handlers auto-track any requested ticker on the live stream client so a
 * chip added on the page starts recording going forward without a restart.
 */

const { getPool } = require('./state/darkpool-history-writer');
const { EXCHANGE_NAMES } = require('./darkpool-stream');

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function todayYmdET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// ET midnight (epoch ms) for a "YYYY-MM-DD" session date — DST-correct via the
// same guess-then-correct trick used elsewhere (darkpool-stream.js, /flow page).
function etMidnightUtcMsFromYmd(ymd) {
  const [y, mo, d] = String(ymd).split('-').map(Number);
  const guessUtc = Date.UTC(y, mo - 1, d, 0, 0, 0);
  const asET = new Date(new Date(guessUtc).toLocaleString('en-US', { timeZone: 'America/New_York' })).getTime();
  const asUTC = new Date(new Date(guessUtc).toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  return guessUtc + (asUTC - asET);
}

let schemaEnsured = false;
async function ensureSchema(pool) {
  if (schemaEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS darkpool_prints (
        ts               BIGINT       NOT NULL,
        date             TEXT         NOT NULL,
        underlying       TEXT         NOT NULL,
        underlying_norm  TEXT         NOT NULL,
        seq              BIGINT       NOT NULL DEFAULT 0,
        price            REAL,
        size             INTEGER,
        notional         REAL,
        exchange         SMALLINT,
        condition        SMALLINT,
        PRIMARY KEY (underlying, date, seq)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS darkpool_prints_date_norm_ts_idx ON darkpool_prints (date, underlying_norm, ts)');
    schemaEnsured = true;
  } catch (e) {
    console.warn('[darkpool-routes] schema ensure failed (will retry next request):', e.message);
  }
}

// Lazily required to avoid a require-cycle at module load (darkpool-recorder
// requires darkpool-stream; this file only needs it for the runtime add-hook).
function autoTrack(ticker) {
  try { require('./darkpool-recorder').addTrackedTicker(ticker); } catch { /* recorder not started yet */ }
}

const _historyCache = new Map(); // key -> { at, payload }
const HISTORY_TTL_MS = 4000;

async function handleDarkpoolHistory(req, res) {
  const { searchParams } = new URL(req.url || '/', 'http://localhost');
  const date = searchParams.get('date') || todayYmdET();
  const underlying = (searchParams.get('underlying') || searchParams.get('symbol') || '').toUpperCase();
  let limit = Number(searchParams.get('limit') || 2000);
  if (!Number.isFinite(limit) || limit <= 0) limit = 2000;
  limit = Math.min(limit, 20000);

  if (underlying) autoTrack(underlying);

  const cacheKey = `${date}|${underlying}|${limit}`;
  const hit = _historyCache.get(cacheKey);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return sendJson(res, 200, hit.payload);

  const pool = getPool();
  if (!pool) return sendJson(res, 200, { date, tape: [] });
  await ensureSchema(pool);

  const params = [date];
  let where = 'date = $1';
  if (underlying) {
    params.push(underlying);
    where += ` AND underlying_norm = $${params.length}`;
  }
  params.push(limit);
  const limitIdx = params.length;

  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT * FROM (
         SELECT ts, underlying, price, size, notional, exchange, condition
           FROM darkpool_prints
          WHERE ${where}
          ORDER BY ts DESC
          LIMIT $${limitIdx}
       ) t ORDER BY ts ASC`,
      params
    ));
  } catch (e) {
    return sendJson(res, 500, { error: 'darkpool-history failed', detail: String(e?.message || e) });
  }

  const tape = rows.map((r) => ({
    ts: Number(r.ts),
    underlying: r.underlying,
    price: Number(r.price),
    size: Number(r.size),
    notional: Number(r.notional),
    exchange: r.exchange != null ? Number(r.exchange) : null,
    exchangeName: r.exchange != null ? (EXCHANGE_NAMES[Number(r.exchange)] || String(r.exchange)) : null,
    condition: r.condition != null ? Number(r.condition) : null,
  }));

  const payload = { date, tape };
  _historyCache.set(cacheKey, { at: Date.now(), payload });
  sendJson(res, 200, payload);
}

const _accumCache = new Map(); // key -> { at, payload }
const ACCUM_TTL_MS = 4000;

async function handleDarkpoolAccum(req, res) {
  const { searchParams } = new URL(req.url || '/', 'http://localhost');
  const underlying = (searchParams.get('underlying') || searchParams.get('symbol') || '').toUpperCase();
  const win = (searchParams.get('window') || 'intraday').toLowerCase();
  const date = searchParams.get('date') || todayYmdET();
  let binSec = Number(searchParams.get('bin') || 60);
  if (!Number.isFinite(binSec) || binSec <= 0) binSec = 60;

  if (!underlying) return sendJson(res, 200, { window: win, bins: [] });
  autoTrack(underlying);

  const cacheKey = `${underlying}|${win}|${date}|${binSec}`;
  const hit = _accumCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ACCUM_TTL_MS) return sendJson(res, 200, hit.payload);

  const pool = getPool();
  if (!pool) return sendJson(res, 200, { window: win, bins: [] });
  await ensureSchema(pool);

  let bins = [];
  try {
    if (win === '5d' || win === '7d') {
      const n = win === '5d' ? 5 : 7;
      const { rows } = await pool.query(
        `SELECT date, sum(size)::bigint AS volume, sum(notional) AS notional, count(*)::bigint AS trades
           FROM darkpool_prints
          WHERE underlying_norm = $1
          GROUP BY date
          ORDER BY date DESC
          LIMIT $2`,
        [underlying, n]
      );
      bins = rows
        .map((r) => ({
          t: etMidnightUtcMsFromYmd(r.date),
          date: r.date,
          volume: Number(r.volume) || 0,
          notional: Number(r.notional) || 0,
          trades: Number(r.trades) || 0,
        }))
        .sort((a, b) => a.t - b.t);
    } else {
      // Intraday: minute bins (or whatever `bin` seconds) for one session.
      const binMs = Math.round(binSec) * 1000;
      const { rows } = await pool.query(
        `SELECT (ts / $3::bigint) * $3::bigint AS binms,
                sum(size)::bigint AS volume, sum(notional) AS notional, count(*)::bigint AS trades
           FROM darkpool_prints
          WHERE date = $1 AND underlying_norm = $2
          GROUP BY binms
          ORDER BY binms ASC`,
        [date, underlying, binMs]
      );
      bins = rows.map((r) => ({
        t: Number(r.binms),
        volume: Number(r.volume) || 0,
        notional: Number(r.notional) || 0,
        trades: Number(r.trades) || 0,
      }));
    }
  } catch (e) {
    return sendJson(res, 500, { error: 'darkpool-accum failed', detail: String(e?.message || e) });
  }

  const payload = { window: win, date, bins };
  _accumCache.set(cacheKey, { at: Date.now(), payload });
  sendJson(res, 200, payload);
}

module.exports = { handleDarkpoolHistory, handleDarkpoolAccum };
