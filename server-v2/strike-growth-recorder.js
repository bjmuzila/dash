'use strict';
/**
 * server-v2/strike-growth-recorder.js
 *
 * Tracks PER-STRIKE GEX growth across a watchlist of tickers so a tracker page
 * can answer: "which strike is growing HUGE today?"
 *
 * For each active watchlist symbol we snapshot the per-strike OI+Vol net GEX
 * (the canonical `oiVolNet` basis from gex-calculator.js — same basis the
 * dashboard heatmap/chart/MVC use) for the front active expiry, limited to a
 * window of strikes around spot. The FIRST snapshot of the session per symbol
 * is the "open" baseline; every later snapshot stores delta_abs = now − open so
 * the page can rank strikes by absolute dollar gamma added since the open.
 *
 * Cadence: whole watchlist swept every SWEEP_MINS (default 30) during RTH,
 * tickers fetched SEQUENTIALLY with a small delay to protect the standalone
 * theta-terminal (which OOMs under burst load — run it with -Xmx1500m).
 *
 * Tables (self-created, like gex-history-writer's ensureVolColumn):
 *   strike_growth_watchlist(symbol PK, active bool, sort_idx int, added_at)
 *   strike_growth(date, symbol, strike, expiry, opt_type,
 *                 gex_now, gex_open, delta_abs, delta_pct, spot, ts,
 *                 PRIMARY KEY(date,symbol,strike,ts))
 *
 * Wiring: startStrikeGrowthRecorder(PORT) from server-with-proxy.js, next to
 * startEodGexRecorder(PORT). Manual fire: POST /proxy/strike-growth-run.
 */

const { computeGexRows } = require('./computation/gex-calculator');
const {
  fetchChainTheta,
  fetchGreeksTheta,
  fetchOpenInterestTheta,
  fetchVolumeTheta,
  fetchStockQuoteTheta,
} = require('./proxy-thetadata');
const { SPECIAL_TICKERS, EQUITY_TICKERS } = require('./em-tickers');

// `exp|strike|type` key matching proxy-thetadata's keyOf()
const keyOf = (exp, strike, type) => `${exp}|${Number(strike)}|${type}`;

// Per-strike OI+Vol net GEX — MUST match gex-calculator.oiVolNet so the page
// agrees with every other GEX surface in the app.
const oiVolNet = (r) => Number(r.netGEX ?? 0) + Number(r.netVolGEX ?? 0);
// OI-only net GEX = the "open" baseline. OI is yesterday's carried-over open
// interest (options don't trade until the open), so this is the positioning the
// day STARTED with, before any of today's volume. delta = (OI+Vol) − (OI-only).
const oiOnlyNet = (r) => Number(r.netGEX ?? 0);

// ── Tunables (env-overridable) ───────────────────────────────────────────────

// Minutes between full watchlist sweeps. 30 keeps Theta load survivable across
// the whole EM universe (per the user's "all EM, slow cadence" choice).
const SWEEP_MINS = Number(process.env.STRIKE_GROWTH_SWEEP_MINS || 30);
// Strikes to keep each side of spot per ticker (28 total at 14). Caps Theta work.
const STRIKES_EACH_SIDE = Number(process.env.STRIKE_GROWTH_STRIKES_SIDE || 14);
// Delay between tickers in a sweep (ms) — paces the standalone theta-terminal.
const TICKER_DELAY_MS = Number(process.env.STRIKE_GROWTH_TICKER_DELAY_MS || 600);
// Hard cap on active tickers fetched per sweep, belt-and-suspenders vs OOM.
const MAX_ACTIVE = Number(process.env.STRIKE_GROWTH_MAX_ACTIVE || 600);

// RTH window (ET minutes-since-midnight): 09:30–16:00.
const RTH_OPEN_MINS  = 9 * 60 + 30;  // 570
const RTH_CLOSE_MINS = 16 * 60;      // 960

// Market holidays — keep in sync with eod-gex-recorder.js / mvc-auto-snapshot.js
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── PG pool (same lazy pattern as eod-gex-recorder.js) ───────────────────────

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
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
        ? undefined
        : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[strike-growth] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[strike-growth] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

// Self-create tables + seed the watchlist from em-tickers on first use.
async function ensureSchema() {
  if (_schemaReady) return true;
  const p = getPool();
  if (!p) return false;
  await p.query(`
    CREATE TABLE IF NOT EXISTS strike_growth_watchlist (
      symbol    TEXT PRIMARY KEY,
      active    BOOLEAN NOT NULL DEFAULT TRUE,
      sort_idx  INTEGER NOT NULL DEFAULT 0,
      added_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS strike_growth (
      date       DATE        NOT NULL,
      symbol     TEXT        NOT NULL,
      strike     DOUBLE PRECISION NOT NULL,
      expiry     TEXT        NOT NULL,
      opt_type   TEXT        NOT NULL DEFAULT 'NET',
      gex_now    DOUBLE PRECISION NOT NULL,
      gex_open   DOUBLE PRECISION NOT NULL,
      delta_abs  DOUBLE PRECISION NOT NULL,
      delta_pct  DOUBLE PRECISION,
      spot       DOUBLE PRECISION,
      ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol, strike, ts)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_strike_growth_latest
                 ON strike_growth (date, symbol, ts DESC);`);

  // Seed watchlist once from the EM roster. Index/ETF core defaults ACTIVE; the
  // long tail is seeded inactive so the 30m sweep stays bounded until the user
  // toggles names on from the page. (Per "all EM, slow cadence" we still allow
  // the whole list, but seeding the tail inactive avoids a cold-start stampede.)
  const seedActive = new Set(['SPY', 'QQQ', 'IWM', 'SPX', 'NDX', 'NVDA', 'TSLA',
    'AAPL', 'AMZN', 'META', 'MSFT', 'GOOGL', 'AMD', 'PLTR', 'NFLX']);
  const roster = [...new Set([...SPECIAL_TICKERS, ...EQUITY_TICKERS])]
    .filter(Boolean).map((s) => String(s).toUpperCase());
  // Bulk insert, do nothing on conflict so user edits are never clobbered.
  let idx = 0;
  for (const sym of roster) {
    await p.query(
      `INSERT INTO strike_growth_watchlist (symbol, active, sort_idx)
       VALUES ($1, $2, $3) ON CONFLICT (symbol) DO NOTHING`,
      [sym, seedActive.has(sym), idx++]
    );
  }
  _schemaReady = true;
  console.log(`[strike-growth] schema ready — watchlist seeded (${roster.length} symbols, ${seedActive.size} active by default)`);
  return true;
}

// ── Time helpers (ported from eod-gex-recorder) ──────────────────────────────

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
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

function isRthWindow() {
  const { hour, minute, weekday } = etParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(etDateStr())) return false;
  const mins = hour * 60 + minute;
  return mins >= RTH_OPEN_MINS && mins <= RTH_CLOSE_MINS;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Per-ticker snapshot ──────────────────────────────────────────────────────

/**
 * Fetch per-strike OI+Vol net GEX for one ticker's front expiry, windowed to
 * STRIKES_EACH_SIDE strikes each side of spot. Returns { spot, expiry, rows }
 * where rows = [{ strike, gex }] (gex = oiVolNet dollars). Throws on bad data.
 */
async function snapshotTicker(chainTicker) {
  const quote = await fetchStockQuoteTheta(chainTicker);
  const spot = Number(quote?.last ?? quote?.mark ?? 0);
  if (!(spot > 0)) throw new Error(`spot 0 for ${chainTicker}`);

  const { contracts, expirations } = await fetchChainTheta(chainTicker);
  if (!expirations?.length) throw new Error(`no expirations ${chainTicker}`);
  const expiry = expirations[0]; // ascending → front active expiry
  const expContracts = contracts.filter((c) => c.expiration === expiry);
  if (!expContracts.length) throw new Error(`empty chain ${chainTicker} ${expiry}`);

  // Window the chain to ±STRIKES_EACH_SIDE strikes around spot BEFORE fetching
  // greeks/OI/vol — this is what keeps Theta load bounded.
  const uniqStrikes = [...new Set(expContracts.map((c) => Number(c.strike)))].sort((a, b) => a - b);
  // index of first strike >= spot
  let pivot = uniqStrikes.findIndex((s) => s >= spot);
  if (pivot < 0) pivot = uniqStrikes.length - 1;
  const lo = Math.max(0, pivot - STRIKES_EACH_SIDE);
  const hi = Math.min(uniqStrikes.length, pivot + STRIKES_EACH_SIDE);
  const keepStrikes = new Set(uniqStrikes.slice(lo, hi));
  const windowed = expContracts.filter((c) => keepStrikes.has(Number(c.strike)));
  if (!windowed.length) throw new Error(`no windowed strikes ${chainTicker}`);

  const [greekMap, oiMap, volMap] = await Promise.all([
    fetchGreeksTheta(chainTicker, expiry).catch(() => new Map()),
    fetchOpenInterestTheta(chainTicker, expiry).catch(() => new Map()),
    fetchVolumeTheta(chainTicker, expiry).catch(() => new Map()),
  ]);

  const flatRows = [];
  for (const c of windowed) {
    const k = keyOf(c.expiration, c.strike, c.type);
    const g = greekMap.get(k) || {};
    const oi = Number(oiMap.get(k)?.oi ?? 0);
    const vol = Number(volMap.get(k) ?? 0);
    const gamma = Math.abs(Number(g.gamma ?? 0));
    const delta = Math.abs(Number(g.delta ?? 0));
    if (!(gamma > 0) && !(oi > 0) && !(vol > 0)) continue;
    flatRows.push({
      strike: c.strike,
      side: c.type === 'C' ? 'call' : 'put',
      oi, volume: vol, gamma, delta,
    });
  }
  if (!flatRows.length) throw new Error(`no option rows ${chainTicker}`);

  const gexRows = computeGexRows(flatRows, spot);
  // gex = today's live OI+Vol; open = OI-only (yesterday's carried OI, pre-open).
  const rows = gexRows.map((r) => ({
    strike: r.strike,
    gex: oiVolNet(r),
    open: oiOnlyNet(r),
  }));
  return { spot, expiry, rows };
}

// ── Sweep ────────────────────────────────────────────────────────────────────

async function getActiveSymbols(p) {
  const { rows } = await p.query(
    `SELECT symbol FROM strike_growth_watchlist
     WHERE active = TRUE ORDER BY sort_idx ASC, symbol ASC LIMIT $1`,
    [MAX_ACTIVE]
  );
  return rows.map((r) => r.symbol);
}

async function writeSnapshot(p, date, symbol, expiry, spot, ts, rows) {
  // rows: [{ strike, gex (OI+Vol now), open (OI-only baseline) }].
  // delta = today's volume contribution on top of carried-over OI positioning.
  for (const { strike, gex, open } of rows) {
    const deltaAbs = gex - open;
    const deltaPct = Math.abs(open) > 1 ? (deltaAbs / Math.abs(open)) * 100 : null;
    await p.query(
      `INSERT INTO strike_growth
         (date, symbol, strike, expiry, opt_type, gex_now, gex_open, delta_abs, delta_pct, spot, ts)
       VALUES ($1,$2,$3,$4,'NET',$5,$6,$7,$8,$9,$10)
       ON CONFLICT (date, symbol, strike, ts) DO UPDATE SET
         gex_now = EXCLUDED.gex_now, delta_abs = EXCLUDED.delta_abs,
         delta_pct = EXCLUDED.delta_pct, spot = EXCLUDED.spot`,
      [date, symbol, strike, expiry, gex, open, deltaAbs, deltaPct, spot, ts]
    );
  }
}

/**
 * One full sweep over the active watchlist. Sequential, paced. Returns a small
 * summary. `force` skips the RTH gate (for the manual /proxy route + dry runs).
 */
async function runSweep(opts = {}) {
  const force = !!opts.force;
  if (!force && !isRthWindow()) return { skipped: 'outside RTH' };
  if (!(await ensureSchema())) return { skipped: 'no DB' };

  const p = getPool();
  const date = etDateStr();
  const ts = new Date().toISOString();
  const symbols = await getActiveSymbols(p);
  const done = [];
  const failed = [];

  console.log(`[strike-growth] sweep ${date} — ${symbols.length} active symbols`);
  for (const symbol of symbols) {
    try {
      const { spot, expiry, rows } = await snapshotTicker(symbol);
      await writeSnapshot(p, date, symbol, expiry, spot, ts, rows);
      done.push(symbol);
    } catch (e) {
      failed.push(`${symbol}:${e.message}`);
      console.warn(`[strike-growth] ${symbol} — ${e.message}`);
    }
    await sleep(TICKER_DELAY_MS); // pace theta-terminal
  }
  console.log(`[strike-growth] sweep done — ${done.length} ok, ${failed.length} failed`);
  return { date, ts, ok: done.length, failed: failed.length, failures: failed.slice(0, 10) };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;
// Run sweeps aligned-ish to the cadence: poll each minute, fire when the ET
// minute is a multiple of SWEEP_MINS and we're inside RTH, de-duped per minute.
let _lastSweepKey = null;

function startStrikeGrowthRecorder(_port) {
  console.log(`[strike-growth] enabled — ${SWEEP_MINS}m sweeps during RTH, ${STRIKES_EACH_SIDE}±strikes/ticker, ${TICKER_DELAY_MS}ms/ticker pacing`);
  const tick = async () => {
    if (!isRthWindow()) return;
    const { hour, minute } = etParts();
    if (minute % SWEEP_MINS !== 0) return;
    const key = `${etDateStr()} ${hour}:${minute}`;
    if (key === _lastSweepKey) return; // already swept this minute
    _lastSweepKey = key;
    try { await runSweep(); }
    catch (e) { console.warn('[strike-growth] sweep error:', e.message); }
  };
  _timer = setInterval(() => { void tick(); }, 60_000);
  _timer.unref?.();
  return () => { if (_timer) clearInterval(_timer); };
}

module.exports = {
  startStrikeGrowthRecorder,
  runSweep,
  ensureSchema,
  getPool,
  snapshotTicker,
};
