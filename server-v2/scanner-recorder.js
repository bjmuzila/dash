'use strict';
/**
 * server-v2/scanner-recorder.js
 *
 * MULTI-TICKER GEX scanner. Unlike greek-scanner-recorder.js (SPX-only, sourced
 * from the in-process /proxy/gex state), this sweeps an arbitrary list of roots
 * (SCANNER_TICKERS) using Theta REST bulk snapshots — one whole-chain call per
 * root per sweep — so it scales cheaply by ticker count and never touches the
 * stream or the single-SYMBOL SPX engine.
 *
 * Per sweep, for each root:
 *   1. fetch chain (expirations + contracts),
 *   2. resolve spot (index snapshot vs. stock snapshot),
 *   3. buildExpiryRows() for the nearest expiry (OI + greeks in one call each),
 *   4. computeGexSummary() → total net GEX, call/put walls, gex flip,
 *   5. write ONE aggregate row into scanner_snapshots.
 *
 * The /proxy/scanner endpoint ranks the latest row per ticker.
 *
 * Wiring: startScannerRecorder(PORT) from server-with-proxy.js.
 * Manual fire: POST /proxy/scanner-run
 * No-op unless SCANNER_TICKERS is set and DATABASE_URL is available.
 */

const { useTheta } = require('./config/data-source');
const thetaAdapter = useTheta() ? require('./proxy-thetadata') : require('./tt-snapshot');
const { computeGexSummary } = require('./computation/gex-calculator');

const INTERVAL_MINS = Number(process.env.SCANNER_INTERVAL_MINS || 5);
const MIN_STRIKES = 10; // guard: skip a ticker whose chain came back too thin

// Indices priced via /index snapshot; everything else via /stock snapshot.
const INDEX_ROOTS = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'VIX', 'RUT', 'XSP', 'DJX']);

const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

const { SCANNER_TICKERS: DEFAULT_SCANNER_TICKERS } = require('./scanner-tickers');

function parseScannerTickers() {
  const env = String(process.env.SCANNER_TICKERS || '').trim();
  // Default to the curated scanner universe; env override still wins if set.
  if (!env) return [...DEFAULT_SCANNER_TICKERS];
  if (env.toUpperCase() === 'SCANNER') return [...DEFAULT_SCANNER_TICKERS];
  return env.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
}

// ── PG pool ──────────────────────────────────────────────────────────────────

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
      console.warn('[scanner] pool error:', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[scanner] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (ensured) return true;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS scanner_snapshots (
        date          TEXT        NOT NULL,
        symbol        TEXT        NOT NULL,
        ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        spot          REAL,
        expiry        TEXT        NOT NULL DEFAULT '',
        total_net_gex REAL,
        call_wall     REAL,
        put_wall      REAL,
        gex_flip      REAL,
        strikes       INTEGER,
        PRIMARY KEY (date, symbol, ts)
      );
      CREATE INDEX IF NOT EXISTS idx_scanner_date_sym ON scanner_snapshots(date, symbol);
    `);
    // CB = Core Bullseye: the single strike carrying the largest |net GEX| on
    // the chain (unsided — not a wall, not the flip). Added for the Walls
    // recorder; rows written before this column exists stay NULL.
    await p.query('ALTER TABLE scanner_snapshots ADD COLUMN IF NOT EXISTS cb REAL');
    // Net GEX AT each level's own strike (OI + vol), not the chain total. The
    // sweep already has per-strike GEX in memory from computeGexSummary and was
    // discarding everything but the summary — so this costs zero extra upstream
    // calls and answers "did GEX build at this wall as price approached", which
    // total_net_gex cannot. Forward-only: nothing reconstructs it for past days.
    for (const c of ['call_wall_gex', 'put_wall_gex', 'cb_gex']) {
      await p.query(`ALTER TABLE scanner_snapshots ADD COLUMN IF NOT EXISTS ${c} REAL`); // eslint-disable-line no-await-in-loop
    }
    ensured = true;
    return true;
  } catch (e) {
    console.error('[scanner] ensureSchema error:', e.message);
    return false;
  }
}

// ── Time helpers ───────────────────────────────────────────────────────────────

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

function etDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

/**
 * The sweep window opens 15m BEFORE the bell, not at it.
 *
 * walls-recorder.js slot 0 fires at 09:29 for the open baseline and samples the
 * newest scanner_snapshots row per symbol, rejecting anything older than 12
 * minutes (MAX_SAMPLE_AGE_MINS) and anything not stamped with today's ET date.
 * With a 09:30 floor that table is empty at 09:29, so slot 0 could never be
 * captured and the walls first appeared at 09:45. Opening at 09:15 puts 2-3
 * sweeps on the board before slot 0 reads, all inside its freshness window.
 */
const SWEEP_START_MINS = 9 * 60 + 15;
const SWEEP_END_MINS = 16 * 60;

function inSweepWindow() {
  const { hour, minute, weekday } = etParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(etDateStr())) return false;
  const mins = hour * 60 + minute;
  return mins >= SWEEP_START_MINS && mins < SWEEP_END_MINS;
}

// ── Spot + per-ticker snapshot ───────────────────────────────────────────────

/**
 * Spot for one root. Equities go through the adapter's SPOT-ONLY call, not
 * fetchStockQuoteTheta: on Theta the latter returns null whenever it can't
 * establish prevClose, which costs a second upstream request per symbol and
 * dropped ~1/3 of the universe on the first sweep of the day. The scanner never
 * uses prevClose — it needs a price for computeGexSummary and nothing else.
 * Older adapters without the split still work via the fallback.
 */
async function resolveSpot(root) {
  try {
    if (INDEX_ROOTS.has(root)) {
      const p = await thetaAdapter.fetchIndexPriceTheta(root);
      return p > 0 ? p : 0;
    }
    const getSpot = thetaAdapter.fetchStockSpotTheta || thetaAdapter.fetchStockQuoteTheta;
    const q = await getSpot(root);
    return q && q.mark > 0 ? q.mark : (q && q.last > 0 ? q.last : 0);
  } catch {
    return 0;
  }
}

/** buildExpiryRows() rows -> gex-calculator input rows ({side,oi,gamma,...}). */
function toGexRows(expiryRows) {
  return expiryRows.map((r) => ({
    strike: r.strike,
    side: r.type === 'C' ? 'call' : 'put',
    oi: Number(r.oi ?? 0),
    volume: 0, // OI-basis scanner; volume can be layered in later if needed
    gamma: Number(r.gamma ?? 0),
    delta: Number(r.delta ?? 0),
    theta: Number(r.theta ?? 0),
    vega: Number(r.vega ?? 0),
    iv: Number(r.iv ?? 0),
    dte: r.dte,
  }));
}

/**
 * CB / Core Bullseye — the strike with the largest absolute OI+Vol net GEX
 * anywhere on the chain. Same pick as mvc-auto-snapshot.js makes for SPX, just
 * evaluated per scanner root. Unlike the walls it is not sided against spot.
 */
function findCoreBullseye(gexRows) {
  if (!gexRows?.length) return null;
  const net = (r) => Math.abs(Number(r.netGEX ?? 0) + Number(r.netVolGEX ?? 0));
  const best = gexRows.reduce((b, r) => (net(r) > net(b) ? r : b), gexRows[0]);
  return net(best) > 0 ? Number(best.strike) : null;
}

/**
 * Signed OI+Vol net GEX sitting at one strike. Same basis findCoreBullseye ranks
 * on, but signed — the sign is the point when watching a wall build or bleed.
 * Returns null when the strike isn't on the chain.
 */
function gexAtStrike(gexRows, strike) {
  if (!gexRows?.length || !(strike > 0)) return null;
  const r = gexRows.find((x) => Number(x.strike) === Number(strike));
  if (!r) return null;
  const v = Number(r.netGEX ?? 0) + Number(r.netVolGEX ?? 0);
  return Number.isFinite(v) ? v : null;
}

/**
 * Snapshot one root: the aggregate summary, or { err } naming why it failed.
 * The three failure modes used to collapse into one "thin/no-spot" string,
 * which made a quote outage look identical to a genuinely thin chain.
 */
async function snapshotTicker(root) {
  const chain = await thetaAdapter.fetchChainTheta(root).catch(() => null);
  const expiry = chain?.expirations?.[0];
  if (!expiry) return { err: 'no-chain' };

  const [spot, expiryRows] = await Promise.all([
    resolveSpot(root),
    thetaAdapter.buildExpiryRows(root, expiry).catch(() => []),
  ]);
  if (!(spot > 0)) return { err: 'no-spot' };

  const gexRows = toGexRows(expiryRows).filter((r) => r.oi > 0 || r.gamma !== 0);
  if (gexRows.length < MIN_STRIKES) return { err: `thin-${gexRows.length}` };

  const summary = computeGexSummary(gexRows, spot);
  const cb = findCoreBullseye(summary.rows);
  return {
    symbol: root,
    spot,
    expiry,
    totalNetGex: summary.totalNetGex,
    callWall: summary.callWall,
    putWall: summary.putWall,
    gexFlip: summary.gexFlip,
    cb,
    callWallGex: gexAtStrike(summary.rows, summary.callWall),
    putWallGex: gexAtStrike(summary.rows, summary.putWall),
    cbGex: gexAtStrike(summary.rows, cb),
    strikes: summary.rows.length,
  };
}

// ── Sweep ────────────────────────────────────────────────────────────────────

async function runSweep({ force = false } = {}) {
  if (!force && !inSweepWindow()) return { skipped: 'outside sweep window' };

  const tickers = parseScannerTickers();
  if (!tickers.length) return { skipped: 'no SCANNER_TICKERS' };

  const p = getPool();
  if (!p || !(await ensureSchema())) return { skipped: 'no DB' };

  const date = etDateStr();
  const now = new Date();
  let written = 0;
  const errors = [];

  for (const root of tickers) {
    // Sequential — keep Theta REST load gentle across many roots.
    try {
      const s = await snapshotTicker(root); // eslint-disable-line no-await-in-loop
      if (!s || s.err) { errors.push(`${root}:${s?.err || 'null'}`); continue; }
      await p.query( // eslint-disable-line no-await-in-loop
        `INSERT INTO scanner_snapshots
           (date, symbol, ts, spot, expiry, total_net_gex, call_wall, put_wall, gex_flip, cb, strikes,
            call_wall_gex, put_wall_gex, cb_gex)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT DO NOTHING`,
        [date, root, now, s.spot, s.expiry, s.totalNetGex, s.callWall, s.putWall, s.gexFlip, s.cb, s.strikes,
          s.callWallGex, s.putWallGex, s.cbGex],
      );
      written++;
    } catch (e) {
      errors.push(`${root}:${String(e?.message || e).slice(0, 60)}`);
    }
  }

  console.log(`[scanner] wrote ${written}/${tickers.length} tickers @ ${now.toISOString()}${errors.length ? ` (skipped: ${errors.join(', ')})` : ''}`);
  return { ok: true, written, total: tickers.length, date, errors };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

function startScannerRecorder() {
  if (!parseScannerTickers().length) {
    console.log('[scanner] no SCANNER_TICKERS configured — recorder idle.');
    return;
  }
  const ms = INTERVAL_MINS * 60 * 1000;
  _timer = setInterval(() => {
    runSweep().catch((e) => console.warn('[scanner] sweep error:', e.message));
  }, ms);
  if (_timer.unref) _timer.unref();
  // Initial run after 12s so the terminal/feed can warm up.
  setTimeout(() => {
    runSweep().catch((e) => console.warn('[scanner] initial error:', e.message));
  }, 12_000);
  console.log(`[scanner] recorder started — sweeping ${parseScannerTickers().join(', ')} every ${INTERVAL_MINS}m`);
}

module.exports = { startScannerRecorder, runSweep, ensureSchema, getPool, parseScannerTickers, findCoreBullseye, gexAtStrike };
