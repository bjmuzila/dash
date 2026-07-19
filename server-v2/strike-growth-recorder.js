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
const { useTheta } = require('./config/data-source');
// Option data source follows the SAME DATA_SOURCE flag as the main feed:
// Theta when on, TastyTrade REST (tt-snapshot) when the subscription is paused.
const {
  fetchChainTheta,
  fetchGreeksTheta,
  fetchOpenInterestTheta,
  fetchVolumeTheta,
  fetchStockQuoteTheta,
  fetchIndexPriceTheta,
} = useTheta() ? require('./proxy-thetadata') : require('./tt-snapshot');
const { SCANNER_TICKERS, SCANNER_HOT } = require('./scanner-tickers');

// Cash indices price off the index snapshot endpoint, NOT the stock-quote one
// (which returns "no data" for them). Equities/ETFs use the stock quote.
const INDEX_SYMBOLS = new Set(['SPX', 'NDX', 'VIX', 'RUT', 'XSP']);

// `exp|strike|type` key matching proxy-thetadata's keyOf()
const keyOf = (exp, strike, type) => `${exp}|${Number(strike)}|${type}`;

// "Open" baseline = OI-only net GEX (netGEX). OI is yesterday's carried-over
// open interest (options don't trade until the open), so this is the positioning
// the day STARTED with, before any of today's volume.
const oiOnlyNet = (r) => Number(r.netGEX ?? 0);
// "Now" = volume-only net GEX (netVolGEX) — purely today's traded volume at the
// strike, no OI. This is the live build/decay we rank on.
const volOnlyNet = (r) => Number(r.netVolGEX ?? 0);

// ── Tunables (env-overridable) ───────────────────────────────────────────────

// Minutes between full watchlist sweeps. 5m gives exact 15/30/60-min lookbacks
// (3/6/12 sweeps back) but is the heaviest on the standalone theta-terminal —
// keep the ACTIVE watchlist tight at 5m to avoid OOM. Raise via env if needed.
const SWEEP_MINS = Number(process.env.STRIKE_GROWTH_SWEEP_MINS || 5);
// Fast-lane cadence for the small "hot" watchlist — swept far more often than the
// full ~380-name roster so a handful of names stay near-live. Keep the hot list
// short (a few dozen max) or this loses its speed advantage.
const HOT_MINS = Number(process.env.STRIKE_GROWTH_HOT_MINS || 2);
// Strikes to keep each side of spot per ticker (28 total at 14). Caps Theta work.
const STRIKES_EACH_SIDE = Number(process.env.STRIKE_GROWTH_STRIKES_SIDE || 14);
// How many front expiries to snapshot per ticker. 1 = nearest expiration only —
// keeps Theta load minimal across the full ~380-name EM roster. THIS IS THE LOAD
// MULTIPLIER: each expiry = a full greeks/OI/vol fetch, so N ≈ N× the calls.
// Raise via env (e.g. 14 for the full chain matrix) if load headroom allows.
const EXPIRIES_PER_TICKER = Number(process.env.STRIKE_GROWTH_EXPIRIES || 1);
// Delay between expiry fetches within one ticker (ms) — extra pacing for Theta.
const EXPIRY_DELAY_MS = Number(process.env.STRIKE_GROWTH_EXPIRY_DELAY_MS || 150);
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
      hot       BOOLEAN NOT NULL DEFAULT FALSE,
      sort_idx  INTEGER NOT NULL DEFAULT 0,
      added_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // MIGRATION: add hot column to pre-existing tables (idempotent).
  await p.query(`ALTER TABLE strike_growth_watchlist ADD COLUMN IF NOT EXISTS hot BOOLEAN NOT NULL DEFAULT FALSE;`);
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
      PRIMARY KEY (date, symbol, strike, expiry, ts)
    );
  `);
  // MIGRATION: the original table keyed (date,symbol,strike,ts) — no expiry — so
  // it could only hold ONE expiry per strike. Multi-expiry needs expiry IN the
  // PK. Rebuild the PK on existing tables (idempotent: only acts if the old key
  // shape is present). Safe because a same-ts upsert just overwrites.
  await p.query(`
    DO $$
    DECLARE pk_cols text;
    BEGIN
      SELECT string_agg(a.attname, ',' ORDER BY array_position(c.conkey, a.attnum))
        INTO pk_cols
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.conrelid = 'strike_growth'::regclass AND c.contype = 'p';
      IF pk_cols = 'date,symbol,strike,ts' THEN
        ALTER TABLE strike_growth DROP CONSTRAINT strike_growth_pkey;
        ALTER TABLE strike_growth
          ADD CONSTRAINT strike_growth_pkey
          PRIMARY KEY (date, symbol, strike, expiry, ts);
        RAISE NOTICE 'strike_growth PK migrated to include expiry';
      END IF;
    END $$;
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_strike_growth_latest
                 ON strike_growth (date, symbol, expiry, ts DESC);`);
  // Supports the 15/30/60-min lateral lookbacks (per symbol+expiry+strike, by ts).
  await p.query(`CREATE INDEX IF NOT EXISTS idx_strike_growth_lookback
                 ON strike_growth (date, symbol, expiry, strike, ts DESC);`);

  // Day-over-day: one row per (date,symbol) = the biggest day-over-day net-GEX
  // (OI+Vol) strike, kept at its intraday PEAK (running max) across the session.
  await p.query(`
    CREATE TABLE IF NOT EXISTS strike_dod_max (
      date      DATE NOT NULL,
      symbol    TEXT NOT NULL,
      strike    DOUBLE PRECISION,
      expiry    TEXT,
      spot      DOUBLE PRECISION,
      net_today DOUBLE PRECISION,
      net_yest  DOUBLE PRECISION,
      vol_today DOUBLE PRECISION,
      delta     DOUBLE PRECISION,
      peak_abs  DOUBLE PRECISION NOT NULL DEFAULT 0,
      ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol)
    );
  `);
  // vol_today added after first ship — self-heal older tables.
  await p.query(`ALTER TABLE strike_dod_max ADD COLUMN IF NOT EXISTS vol_today DOUBLE PRECISION`);

  // Seed watchlist once from the full EM roster (~380 names). All seed ACTIVE so
  // a fresh DB/redeploy records the entire EM list from the start — the roster is
  // bounded (SPECIAL_TICKERS + EQUITY_TICKERS, well under MAX_ACTIVE). Pacing
  // (TICKER_DELAY_MS) + theta-terminal heap are the load levers, not the count.
  // RECONCILE the watchlist to the curated scanner universe on every boot. This
  // is the source of truth: to change the scanner/flow universe, edit
  // scanner-tickers.js and redeploy. MAIN = hot (fast lane); everything else in
  // the list = active on the 5-min sweep; anything NOT in the list is deactivated
  // (kept as a row so history survives, but no longer swept).
  const roster = [...new Set(SCANNER_TICKERS)].map((s) => String(s).toUpperCase());
  const hotSet = new Set(SCANNER_HOT.map((s) => String(s).toUpperCase()));
  let idx = 0;
  for (const sym of roster) {
    await p.query(
      `INSERT INTO strike_growth_watchlist (symbol, active, hot, sort_idx)
       VALUES ($1, TRUE, $2, $3)
       ON CONFLICT (symbol) DO UPDATE SET active = TRUE, hot = EXCLUDED.hot, sort_idx = EXCLUDED.sort_idx`,
      [sym, hotSet.has(sym), idx++]
    );
  }
  // Deactivate everything not in the curated list (replace-universe semantics).
  const off = await p.query(
    `UPDATE strike_growth_watchlist SET active = FALSE, hot = FALSE WHERE symbol <> ALL($1)`,
    [roster]
  );
  _schemaReady = true;
  console.log(`[strike-growth] schema ready — universe reconciled to scanner list (${roster.length} active, ${hotSet.size} hot, ${off.rowCount} deactivated)`);
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

// Build the per-strike rows for ONE expiry, windowed to ±STRIKES_EACH_SIDE
// strikes around spot. Returns [{ strike, gex, open }] or [] if no usable data.
async function snapshotOneExpiry(chainTicker, expiry, expContracts, spot) {
  // Window the chain to ±STRIKES_EACH_SIDE strikes around spot BEFORE fetching
  // greeks/OI/vol — this is what keeps Theta load bounded per expiry.
  const uniqStrikes = [...new Set(expContracts.map((c) => Number(c.strike)))].sort((a, b) => a - b);
  let pivot = uniqStrikes.findIndex((s) => s >= spot);
  if (pivot < 0) pivot = uniqStrikes.length - 1;
  const lo = Math.max(0, pivot - STRIKES_EACH_SIDE);
  const hi = Math.min(uniqStrikes.length, pivot + STRIKES_EACH_SIDE);
  const keepStrikes = new Set(uniqStrikes.slice(lo, hi));
  const windowed = expContracts.filter((c) => keepStrikes.has(Number(c.strike)));
  if (!windowed.length) return [];

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
    flatRows.push({ strike: c.strike, side: c.type === 'C' ? 'call' : 'put', oi, volume: vol, gamma, delta });
  }
  if (!flatRows.length) return [];

  const gexRows = computeGexRows(flatRows, spot);
  // gex = volume-only (today's traded volume); open = OI-only (carried OI, pre-open).
  return gexRows.map((r) => ({ strike: r.strike, gex: volOnlyNet(r), open: oiOnlyNet(r) }));
}

/**
 * Snapshot the front EXPIRIES_PER_TICKER expiries for one ticker, each windowed
 * to ±STRIKES_EACH_SIDE strikes around spot. Returns { spot, expiries:[{expiry,
 * rows}] }. Expiries are fetched SEQUENTIALLY with EXPIRY_DELAY_MS pacing — this
 * is the load multiplier vs the old front-only recorder, so it's paced hard.
 */
async function snapshotTicker(chainTicker) {
  let spot;
  if (INDEX_SYMBOLS.has(chainTicker.toUpperCase())) {
    spot = Number(await fetchIndexPriceTheta(chainTicker));
  } else {
    const quote = await fetchStockQuoteTheta(chainTicker);
    spot = Number(quote?.last ?? quote?.mark ?? 0);
  }
  if (!(spot > 0)) throw new Error(`spot 0 for ${chainTicker}`);

  const { contracts, expirations } = await fetchChainTheta(chainTicker);
  if (!expirations?.length) throw new Error(`no expirations ${chainTicker}`);
  const targetExps = expirations.slice(0, EXPIRIES_PER_TICKER); // ascending → front N

  const out = [];
  for (const expiry of targetExps) {
    const expContracts = contracts.filter((c) => c.expiration === expiry);
    if (!expContracts.length) continue;
    try {
      const rows = await snapshotOneExpiry(chainTicker, expiry, expContracts, spot);
      if (rows.length) out.push({ expiry, rows });
    } catch (e) {
      console.warn(`[strike-growth] ${chainTicker} ${expiry} — ${e.message}`);
    }
    await sleep(EXPIRY_DELAY_MS); // pace Theta between expiries
  }
  if (!out.length) throw new Error(`no usable expiries ${chainTicker}`);
  return { spot, expiries: out };
}

// ── Sweep ────────────────────────────────────────────────────────────────────

async function getActiveSymbols(p, onlyHot = false) {
  const where = onlyHot ? 'active = TRUE AND hot = TRUE' : 'active = TRUE';
  const { rows } = await p.query(
    `SELECT symbol FROM strike_growth_watchlist
     WHERE ${where} ORDER BY sort_idx ASC, symbol ASC LIMIT $1`,
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
       ON CONFLICT (date, symbol, strike, expiry, ts) DO UPDATE SET
         gex_now = EXCLUDED.gex_now, delta_abs = EXCLUDED.delta_abs,
         delta_pct = EXCLUDED.delta_pct, spot = EXCLUDED.spot`,
      [date, symbol, strike, expiry, gex, open, deltaAbs, deltaPct, spot, ts]
    );
  }
}

// Biggest day-over-day net-GEX (OI+Vol) strike per symbol, kept at its intraday
// PEAK. "yesterday" = most recent prior date in strike_growth (holidays/weekends
// need no calendar). Grain = symbol+strike (front expiry), so an expired front
// doesn't break the compare on roll days. Pure SQL over rows the sweep already
// wrote — no extra Theta load.
async function rollupDayOverDay(p, date) {
  await p.query(`
    WITH prev AS (
      SELECT DISTINCT ON (symbol, strike) symbol, strike, (gex_now + gex_open) AS net
      FROM strike_growth WHERE date < $1
      ORDER BY symbol, strike, date DESC, ts DESC
    ),
    cur AS (
      SELECT DISTINCT ON (symbol, strike) symbol, strike, expiry, spot,
             (gex_now + gex_open) AS net, gex_now AS vol
      FROM strike_growth WHERE date = $1
      ORDER BY symbol, strike, ts DESC
    ),
    d AS (
      SELECT c.symbol, c.strike, c.expiry, c.spot,
             c.net AS net_today, p.net AS net_yest, c.vol AS vol_today, (c.net - p.net) AS delta
      FROM cur c JOIN prev p USING (symbol, strike)
    ),
    top AS (
      SELECT DISTINCT ON (symbol) symbol, strike, expiry, spot, net_today, net_yest, vol_today, delta
      FROM d ORDER BY symbol, abs(delta) DESC
    )
    INSERT INTO strike_dod_max
      (date, symbol, strike, expiry, spot, net_today, net_yest, vol_today, delta, peak_abs, ts)
    SELECT $1, symbol, strike, expiry, spot, net_today, net_yest, vol_today, delta, abs(delta), now()
    FROM top
    ON CONFLICT (date, symbol) DO UPDATE SET
      strike=EXCLUDED.strike, expiry=EXCLUDED.expiry, spot=EXCLUDED.spot,
      net_today=EXCLUDED.net_today, net_yest=EXCLUDED.net_yest,
      vol_today=EXCLUDED.vol_today, delta=EXCLUDED.delta, peak_abs=EXCLUDED.peak_abs, ts=now()
    WHERE EXCLUDED.peak_abs > strike_dod_max.peak_abs
  `, [date]);
}

/**
 * One full sweep over the active watchlist. Sequential, paced. Returns a small
 * summary. `force` skips the RTH gate (for the manual /proxy route + dry runs).
 */
async function runSweep(opts = {}) {
  const force = !!opts.force;
  const onlyHot = !!opts.onlyHot;
  if (!force && !isRthWindow()) return { skipped: 'outside RTH' };
  if (!(await ensureSchema())) return { skipped: 'no DB' };

  const p = getPool();
  const date = etDateStr();
  const ts = new Date().toISOString();
  const symbols = await getActiveSymbols(p, onlyHot);
  const done = [];
  const failed = [];

  console.log(`[strike-growth] ${onlyHot ? 'HOT ' : ''}sweep ${date} — ${symbols.length} symbols`);
  for (const symbol of symbols) {
    try {
      const { spot, expiries } = await snapshotTicker(symbol);
      for (const { expiry, rows } of expiries) {
        await writeSnapshot(p, date, symbol, expiry, spot, ts, rows);
      }
      done.push(`${symbol}(${expiries.length}exp)`);
    } catch (e) {
      failed.push(`${symbol}:${e.message}`);
      console.warn(`[strike-growth] ${symbol} — ${e.message}`);
    }
    await sleep(TICKER_DELAY_MS); // pace theta-terminal
  }
  console.log(`[strike-growth] sweep done — ${done.length} ok, ${failed.length} failed`);

  // Day-over-day rollup: recompute the biggest overnight→now mover per symbol
  // from the rows just written, keep the intraday peak. Cheap SQL, best-effort.
  try { await rollupDayOverDay(p, date); }
  catch (e) { console.warn('[strike-growth/dod]', e.message); }

  return { date, ts, ok: done.length, failed: failed.length, failures: failed.slice(0, 10) };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;
// Run sweeps aligned-ish to the cadence: poll each minute, fire when the ET
// minute is a multiple of SWEEP_MINS and we're inside RTH, de-duped per minute.
let _lastSweepKey = null;
let _lastHotKey = null;
// SEPARATE guards so the fast lane isn't starved by a long full sweep. The full
// roster (~400 names) can take ~10 min; if the hot lane shared one mutex it would
// almost never fire. Each guard only blocks a second sweep OF THE SAME KIND, so
// a 15-name hot sweep can run concurrently with the full sweep — at most 2 paced
// Theta requests overlap, well under the burst that OOMs theta-terminal.
let _fullSweeping = false;
let _hotSweeping = false;

function startStrikeGrowthRecorder(_port) {
  console.log(`[strike-growth] enabled — ${SWEEP_MINS}m full sweeps + ${HOT_MINS}m hot-lane during RTH, ${STRIKES_EACH_SIDE}±strikes/ticker, ${TICKER_DELAY_MS}ms/ticker pacing`);
  const tick = async () => {
    if (!isRthWindow()) return;
    const { hour, minute } = etParts();

    // Fast lane: hot list every HOT_MINS. Independent of the full sweep.
    if (minute % HOT_MINS === 0) {
      const hotKey = `${etDateStr()} ${hour}:${minute}`;
      if (hotKey !== _lastHotKey && !_hotSweeping) {
        _lastHotKey = hotKey;
        _hotSweeping = true;
        runSweep({ onlyHot: true })
          .catch((e) => console.warn('[strike-growth] hot sweep error:', e.message))
          .finally(() => { _hotSweeping = false; });
      }
    }

    // Full roster every SWEEP_MINS.
    if (minute % SWEEP_MINS === 0) {
      const key = `${etDateStr()} ${hour}:${minute}`;
      if (key !== _lastSweepKey && !_fullSweeping) {
        _lastSweepKey = key;
        _fullSweeping = true;
        runSweep()
          .catch((e) => console.warn('[strike-growth] sweep error:', e.message))
          .finally(() => { _fullSweeping = false; });
      }
    }
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
  rollupDayOverDay,
};
