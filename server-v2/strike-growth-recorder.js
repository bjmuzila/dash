'use strict';
/**
 * server-v2/strike-growth-recorder.js
 *
 * Tracks PER-STRIKE GEX growth across a watchlist of tickers so a tracker page
 * can answer: "which strike is growing HUGE today?"
 *
 * For each active watchlist symbol we read the LIVE dxLink feed (see
 * TastytradeProxy.startStrikeGrowthFeed/getStrikeGrowthSnapshot in
 * proxy-tastytrade.js — a persistent multi-ticker subscription on the SAME
 * shared connection as the SPX GEX feed, not Theta). A newly-subscribed leg
 * has no streamed data for the first few seconds, so proxy-tastytrade.js
 * pre-warms it with one TT REST snapshot (fetchChainFull) right after
 * subscribing, then hands off to dxLink as live events land (same in-memory
 * maps — no mode switch on this side, snapshotTicker always just reads
 * whatever's current). Not Theta, not a steady-state REST poll — REST here
 * is a one-shot cold-start fill, not the data source. Keep
 * only the top TOP_N_EACH_SIDE strikes by combined net GEX on each side (call
 * side positive, put side negative) — the actual walls, not just whatever sits
 * near spot. The FIRST snapshot of the session per symbol is the "open"
 * baseline; every later snapshot stores delta_abs = now − open so the page can
 * rank strikes by absolute dollar gamma added since the open.
 *
 * Cadence: whole watchlist swept every SWEEP_MINS (default 5) during RTH. No
 * network fetch happens in the sweep itself — getStrikeGrowthSnapshot reads
 * in-memory feed maps (plus a 10-min-cached chain-structure lookup), so the
 * TICKER_DELAY_MS pacing here is just cold-cache-burst insurance, not the
 * heavy per-request pacing a REST/Theta path needed.
 *
 * Tables (self-created, like gex-history-writer's ensureVolColumn):
 *   strike_growth_watchlist(symbol PK, active bool, sort_idx int, added_at)
 *   strike_growth(date, symbol, strike, expiry, opt_type,
 *                 gex_now, gex_open, delta_abs, delta_pct, spot, ts,
 *                 PRIMARY KEY(date,symbol,strike,ts))
 *
 * Wiring: startStrikeGrowthRecorder(PORT, proxy) from server-with-proxy.js,
 * where `proxy` is the live TastytradeProxy instance (its dxLink connection is
 * shared — see proxy-tastytrade.js's STRIKE_GROWTH_FEED_* section). Manual
 * fire: POST /proxy/strike-growth-run.
 */

const { computeGexRows } = require('./computation/gex-calculator');
const { SCANNER_TICKERS, SCANNER_HOT } = require('./scanner-tickers');

// Set once by startStrikeGrowthRecorder(port, proxy) — the live TastytradeProxy
// instance whose shared dxLink connection this recorder reads from.
let _proxy = null;

// "Open" baseline = OI-only net GEX (netGEX). OI is yesterday's carried-over
// open interest (options don't trade until the open), so this is the positioning
// the day STARTED with, before any of today's volume.
const oiOnlyNet = (r) => Number(r.netGEX ?? 0);
// "Now" = volume-only net GEX (netVolGEX) — purely today's traded volume at the
// strike, no OI. This is the live build/decay we rank on.
const volOnlyNet = (r) => Number(r.netVolGEX ?? 0);

// ── Tunables (env-overridable) ───────────────────────────────────────────────

// Minutes between full watchlist sweeps. Cheap now (no network call per
// ticker — see header), so this mostly governs DoD-diff resolution.
const SWEEP_MINS = Number(process.env.STRIKE_GROWTH_SWEEP_MINS || 5);
// Fast-lane cadence for the small "hot" watchlist — swept far more often than the
// full roster so a handful of names stay near-live.
const HOT_MINS = Number(process.env.STRIKE_GROWTH_HOT_MINS || 2);
// REST spot backstop: how often to refresh EVERY roster ticker's live spot via
// TT /market-data/by-type. The dxLink feed only carries an underlying quote for
// roots it has actively subscribed, so other tickers showed a stale last-swept
// DB spot. This poll keeps every roster ticker's spot current (RTH + ext hours).
// Set to 0 to disable.
const SPOT_REFRESH_MINS = Number(process.env.STRIKE_GROWTH_SPOT_REFRESH_MINS || 15);
// Every sweep now ALSO refreshes the spots for exactly the symbols it is about
// to write, immediately before writing them (see runSweep). The poller above is
// only the between-sweeps backstop for readers like the Forward Build cards.
// Set STRIKE_GROWTH_PRESWEEP_SPOT=0 to fall back to the old behaviour (spot =
// whatever the feed maps last held, which on a dead subscription meant the
// recorded price could be a whole SPOT_REFRESH_MINS window old — the /replay
// ladder repeating one spot across many frames).
const PRESWEEP_SPOT = process.env.STRIKE_GROWTH_PRESWEEP_SPOT !== '0';
// Log a warning when a written spot is older than this (ms). Frozen spot is the
// failure this recorder is least able to notice on its own — the row still
// writes, the ladder still renders, the price is just wrong.
const SPOT_STALE_WARN_MS = Number(process.env.STRIKE_GROWTH_SPOT_STALE_WARN_MS || 90_000);
// How many strikes to WRITE to strike_growth per side, per expiry — ranked by
// combined net GEX (gex_now+gex_open), not distance from spot. Keeps the table
// to the strikes that actually matter (real call/put walls) instead of a
// fixed spot-centered window. The subscription window that makes these strikes
// visible in the first place is STRIKE_GROWTH_FEED_WINDOW in proxy-tastytrade.js.
const TOP_N_EACH_SIDE = Number(process.env.STRIKE_GROWTH_TOP_N || 5);
// How many front expiries to snapshot per ticker. Must be <= the live feed's
// STRIKE_GROWTH_FEED_EXPIRIES (proxy-tastytrade.js) — a larger value here just
// gets clamped to whatever the feed actually subscribed. 3 = 0DTE+1DTE+2DTE,
// so history exists for the next couple of expiries, not just today's front one.
const EXPIRIES_PER_TICKER = Number(process.env.STRIKE_GROWTH_EXPIRIES || 3);
// Delay between tickers in a sweep (ms) — insurance against a burst of cold
// fetchChain() cache misses on startup, not per-request network pacing.
const TICKER_DELAY_MS = Number(process.env.STRIKE_GROWTH_TICKER_DELAY_MS || 600);
// Hard cap on active tickers per sweep, belt-and-suspenders vs a runaway roster.
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
  // Latest-per-(symbol,expiry,strike,date) reads do
  //   DISTINCT ON (symbol, expiry, strike, date) ... ORDER BY symbol, expiry, strike, date, ts DESC
  // The two indexes above lead with `date`, so the planner couldn't satisfy that
  // ordering and fell back to a full multi-day roster scan + a huge in-memory
  // sort. This index matches the DISTINCT ON ordering exactly, so it becomes an
  // ordered index scan with no sort.
  await p.query(`CREATE INDEX IF NOT EXISTS idx_strike_growth_fb
                 ON strike_growth (symbol, expiry, strike, date, ts DESC);`);

  // Per-expiry CALL-SIDE / PUT-SIDE GEX totals, one row per (date,symbol,expiry,
  // sweep). strike_growth only keeps the TOP_N_EACH_SIDE strikes per side and
  // only their NET (calls minus puts at that strike), so you cannot recover a
  // call-vs-put share from it: summing per-strike nets answers "how much of the
  // net sits on positive strikes", not "how much gamma is calls vs puts".
  // These totals are summed over the FULL subscribed window
  // (STRIKE_GROWTH_FEED_WINDOW = ±20 strikes around spot), same OI+Vol basis as
  // gex_now+gex_open, so call_gex + put_gex is the expiry's true net over that
  // window. call_gex is >= 0, put_gex is <= 0 (the put term is already negated
  // by computeGexRows' dealer-sign convention).
  await p.query(`
    CREATE TABLE IF NOT EXISTS strike_growth_expiry (
      date      DATE NOT NULL,
      symbol    TEXT NOT NULL,
      expiry    TEXT NOT NULL,
      ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
      spot      DOUBLE PRECISION,
      call_gex  DOUBLE PRECISION NOT NULL,
      put_gex   DOUBLE PRECISION NOT NULL,
      strikes_n INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, symbol, expiry, ts)
    );
  `);
  // Matches the DISTINCT ON (symbol, expiry, date) ORDER BY … ts DESC used to
  // pull each expiry's latest totals.
  await p.query(`CREATE INDEX IF NOT EXISTS idx_strike_growth_expiry_latest
                 ON strike_growth_expiry (symbol, expiry, date, ts DESC);`);

  // Day-over-day: TWO rows per (date,symbol) — bucket '0DTE' (expiry = its own
  // session date) and 'SWING' (all later expiries, summed per strike) — each the
  // biggest day-over-day net-GEX (OI+Vol) strike, kept at its intraday PEAK.
  await p.query(`
    CREATE TABLE IF NOT EXISTS strike_dod_max (
      date      DATE NOT NULL,
      symbol    TEXT NOT NULL,
      bucket    TEXT NOT NULL DEFAULT 'ALL',
      strike    DOUBLE PRECISION,
      expiry    TEXT,
      spot      DOUBLE PRECISION,
      net_today DOUBLE PRECISION,
      net_yest  DOUBLE PRECISION,
      vol_today DOUBLE PRECISION,
      delta     DOUBLE PRECISION,
      peak_abs  DOUBLE PRECISION NOT NULL DEFAULT 0,
      ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol, bucket)
    );
  `);
  // vol_today added after first ship — self-heal older tables.
  await p.query(`ALTER TABLE strike_dod_max ADD COLUMN IF NOT EXISTS vol_today DOUBLE PRECISION`);
  // MIGRATION: bucket column + PK (date,symbol) -> (date,symbol,bucket).
  await p.query(`ALTER TABLE strike_dod_max ADD COLUMN IF NOT EXISTS bucket TEXT NOT NULL DEFAULT 'ALL'`);
  await p.query(`
    DO $$ DECLARE pk text;
    BEGIN
      SELECT string_agg(a.attname,',' ORDER BY array_position(c.conkey,a.attnum)) INTO pk
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
      WHERE c.conrelid='strike_dod_max'::regclass AND c.contype='p';
      IF pk = 'date,symbol' THEN
        ALTER TABLE strike_dod_max DROP CONSTRAINT strike_dod_max_pkey;
        ALTER TABLE strike_dod_max ADD CONSTRAINT strike_dod_max_pkey PRIMARY KEY (date,symbol,bucket);
        RAISE NOTICE 'strike_dod_max PK migrated to include bucket';
      END IF;
    END $$;
  `);

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

// Rank one expiry's legs by combined net GEX (gex_now+gex_open, same "net"
// rollupDayOverDay already uses) and keep the top TOP_N_EACH_SIDE on the call
// side (positive) and put side (negative). Returns [{ strike, gex, open }].
function pickTopEachSide(legRows, spot) {
  const flatRows = legRows
    .filter((r) => r.gamma > 0 || r.oi > 0 || r.volume > 0)
    .map((r) => ({ strike: r.strike, side: r.type === 'C' ? 'call' : 'put', oi: r.oi, volume: r.volume, gamma: r.gamma }));
  if (!flatRows.length) return [];

  const gexRows = computeGexRows(flatRows, spot);
  // gex = volume-only (today's traded volume); open = OI-only (carried OI, pre-open).
  const scored = gexRows.map((r) => {
    const gex = volOnlyNet(r), open = oiOnlyNet(r);
    return { strike: r.strike, gex, open, net: gex + open };
  });
  const topCalls = scored.filter((r) => r.net > 0).sort((a, b) => b.net - a.net).slice(0, TOP_N_EACH_SIDE);
  const topPuts = scored.filter((r) => r.net < 0).sort((a, b) => a.net - b.net).slice(0, TOP_N_EACH_SIDE);
  return [...topCalls, ...topPuts].map(({ strike, gex, open }) => ({ strike, gex, open }));
}

/**
 * CALL-SIDE and PUT-SIDE GEX totals for one expiry, summed over EVERY strike in
 * the feed's subscribed window — not the top-N the ladder stores, and never
 * netted call-against-put within a strike. This is what a call/put share
 * ("+62% / −38%") is built from.
 *
 * Basis matches the per-strike `net` the rest of this file uses (OI + Vol):
 *   call side = callGEX(OI)  + callGamma × callVolume × S²   → >= 0
 *   put side  = putGEX(OI)   − putGamma  × putVolume  × S²   → <= 0
 * computeGexRows already negates the put OI term (dealer-sign convention), so
 * callGEX + putGEX = netGEX and the two sums add back to the expiry's net.
 * The per-side VOLUME terms aren't returned by computeGexRows (it only exposes
 * the combined netVolGEX), so they're rebuilt here from the gamma/volume fields
 * it does return.
 */
function sideTotals(legRows, spot) {
  const flatRows = legRows
    .filter((r) => r.gamma > 0 || r.oi > 0 || r.volume > 0)
    .map((r) => ({ strike: r.strike, side: r.type === 'C' ? 'call' : 'put', oi: r.oi, volume: r.volume, gamma: r.gamma }));
  if (!flatRows.length) return null;
  const s2 = spot * spot;
  let call = 0, put = 0, n = 0;
  for (const r of computeGexRows(flatRows, spot)) {
    call += Number(r.callGEX || 0) + Number(r.callGamma || 0) * Number(r.callVolume || 0) * s2;
    put += Number(r.putGEX || 0) - Number(r.putGamma || 0) * Number(r.putVolume || 0) * s2;
    n++;
  }
  return { callGex: call, putGex: put, strikes: n };
}

/**
 * Snapshot the front EXPIRIES_PER_TICKER expiries for one ticker straight off
 * the live dxLink feed (TastytradeProxy.getStrikeGrowthSnapshot) — no network
 * call, just a read of the in-memory feed maps the shared connection already
 * keeps warm. Returns { spot, expiries:[{expiry, rows}] } where rows is only
 * the top TOP_N_EACH_SIDE strikes per side, ranked by combined net GEX.
 */
async function snapshotTicker(chainTicker) {
  if (!_proxy) throw new Error('dxLink feed not wired (no proxy passed to startStrikeGrowthRecorder)');
  const snap = await _proxy.getStrikeGrowthSnapshot(chainTicker);
  if (!snap) throw new Error(`no live snapshot yet for ${chainTicker} (feed still warming up)`);
  if (!(snap.spot > 0)) throw new Error(`spot 0 for ${chainTicker}`);

  const targetExps = snap.expiries.slice(0, EXPIRIES_PER_TICKER);
  const out = [];
  for (const { expiry, rows: legRows } of targetExps) {
    const picked = pickTopEachSide(legRows, snap.spot);
    // Side totals come from the FULL window (legRows), deliberately not from
    // `picked` — the whole point is a share that isn't truncated to the walls.
    if (picked.length) out.push({ expiry, rows: picked, totals: sideTotals(legRows, snap.spot) });
  }
  if (!out.length) throw new Error(`no usable expiries ${chainTicker}`);
  return { spot: snap.spot, spotAgeMs: Number(snap.spotAgeMs ?? Infinity), expiries: out };
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

/** One row per (date, symbol, expiry, sweep): the full-window call/put split. */
async function writeExpiryTotals(p, date, symbol, expiry, spot, ts, totals) {
  if (!totals) return;
  await p.query(
    `INSERT INTO strike_growth_expiry
       (date, symbol, expiry, ts, spot, call_gex, put_gex, strikes_n)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (date, symbol, expiry, ts) DO UPDATE SET
       spot = EXCLUDED.spot, call_gex = EXCLUDED.call_gex,
       put_gex = EXCLUDED.put_gex, strikes_n = EXCLUDED.strikes_n`,
    [date, symbol, expiry, ts, spot, totals.callGex, totals.putGex, totals.strikes]
  );
}

// Biggest day-over-day net-GEX (OI+Vol) strike per symbol, kept at its intraday
// PEAK. "yesterday" = most recent prior date in strike_growth (holidays/weekends
// need no calendar). Grain = symbol+strike (front expiry), so an expired front
// doesn't break the compare on roll days. Pure SQL over rows the sweep already
// wrote — no extra Theta load.
async function rollupDayOverDay(p, date) {
  // 0DTE (expiry = its own session date) and SWING (all later expiries, summed
  // per strike) as SEPARATE day-over-day movers per symbol. The predicate self-
  // classifies each row vs ITS date, so cur(today) and prev(last session) share it.
  for (const [bucket, pred] of [
    ['0DTE',  `expiry =  to_char(date,'YYYY-MM-DD')`],
    ['SWING', `expiry <> to_char(date,'YYYY-MM-DD')`],
  ]) {
    await p.query(`
      WITH cur_e AS (
        SELECT DISTINCT ON (symbol, expiry, strike) symbol, expiry, strike, spot,
               (gex_now + gex_open) AS net, gex_now AS vol
        FROM strike_growth WHERE date = $1 AND ${pred}
        ORDER BY symbol, expiry, strike, ts DESC
      ),
      prev_e AS (
        SELECT DISTINCT ON (symbol, expiry, strike) symbol, expiry, strike,
               (gex_now + gex_open) AS net
        FROM strike_growth
        WHERE date = (SELECT max(date) FROM strike_growth WHERE date < $1 AND ${pred})
          AND ${pred}
        ORDER BY symbol, expiry, strike, ts DESC
      ),
      cur AS (
        SELECT symbol, strike, max(spot) AS spot, sum(net) AS net, sum(vol) AS vol,
               min(expiry) AS expiry
        FROM cur_e GROUP BY symbol, strike
      ),
      prev AS ( SELECT symbol, strike, sum(net) AS net FROM prev_e GROUP BY symbol, strike ),
      d AS (
        SELECT c.symbol, c.strike, c.expiry, c.spot,
               c.net AS net_today, pv.net AS net_yest, c.vol AS vol_today,
               (c.net - pv.net) AS delta
        FROM cur c JOIN prev pv USING (symbol, strike)
      ),
      top AS ( SELECT DISTINCT ON (symbol) * FROM d ORDER BY symbol, abs(delta) DESC )
      INSERT INTO strike_dod_max
        (date, symbol, bucket, strike, expiry, spot, net_today, net_yest, vol_today, delta, peak_abs, ts)
      SELECT $1, symbol, $2, strike, expiry, spot, net_today, net_yest, vol_today, delta, abs(delta), now()
      FROM top
      ON CONFLICT (date, symbol, bucket) DO UPDATE SET
        strike=EXCLUDED.strike, expiry=EXCLUDED.expiry, spot=EXCLUDED.spot,
        net_today=EXCLUDED.net_today, net_yest=EXCLUDED.net_yest,
        vol_today=EXCLUDED.vol_today, delta=EXCLUDED.delta, peak_abs=EXCLUDED.peak_abs, ts=now()
      WHERE EXCLUDED.peak_abs > strike_dod_max.peak_abs
    `, [date, bucket]);
  }
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
  const symbols = await getActiveSymbols(p, onlyHot);
  const done = [];
  const failed = [];
  let stale = 0;

  // Keep the live dxLink feed's roster in sync with this sweep's symbol list.
  // Additive (see startStrikeGrowthFeed in proxy-tastytrade.js) — safe to call
  // every sweep, including the small hot-lane subset, without dropping tickers
  // the full sweep already subscribed.
  if (_proxy) {
    await _proxy.startStrikeGrowthFeed(symbols).catch((e) =>
      console.warn('[strike-growth] feed subscribe:', e.message));
  }

  // Refresh the spot for exactly the symbols this sweep is about to write,
  // right before writing them. One batched TT call per 90 symbols (the hot lane
  // is a single call), and it makes the recorded price fresh BY CONSTRUCTION
  // instead of depending on every root's dxLink underlying subscription being
  // alive — the failure mode that made /replay repeat one spot for minutes.
  // The live feed still wins for streamed roots: any event that lands after
  // this overwrites the REST value.
  if (PRESWEEP_SPOT && _proxy?.refreshStrikeGrowthSpots) {
    await _proxy.refreshStrikeGrowthSpots(symbols).catch((e) =>
      console.warn('[strike-growth] pre-sweep spot refresh:', String(e?.message || e).slice(0, 160)));
  }

  console.log(`[strike-growth] ${onlyHot ? 'HOT ' : ''}sweep ${date} — ${symbols.length} symbols`);
  for (const symbol of symbols) {
    try {
      const { spot, spotAgeMs, expiries } = await snapshotTicker(symbol);
      // Stamp each ticker at the moment ITS spot was read, not at the moment the
      // sweep started. A full roster takes minutes to walk, so one shared ts
      // labelled late tickers with a clock they never saw — in /replay that
      // reads as the price standing still and then jumping. Every strike_growth
      // query is scoped to a single symbol (DISTINCT ON / MAX(ts) per symbol),
      // so per-symbol timestamps change nothing downstream.
      const ts = new Date().toISOString();
      if (spotAgeMs > SPOT_STALE_WARN_MS) {
        stale++;
        console.warn(`[strike-growth] ${symbol} — spot ${spot} is ${Math.round(spotAgeMs / 1000)}s old (no live underlying event; check the dxLink subscription)`);
      }
      for (const { expiry, rows, totals } of expiries) {
        await writeSnapshot(p, date, symbol, expiry, spot, ts, rows);
        await writeExpiryTotals(p, date, symbol, expiry, spot, ts, totals);
      }
      done.push(`${symbol}(${expiries.length}exp)`);
    } catch (e) {
      failed.push(`${symbol}:${e.message}`);
      console.warn(`[strike-growth] ${symbol} — ${e.message}`);
    }
    await sleep(TICKER_DELAY_MS); // insurance vs a cold fetchChain() cache-miss burst
  }
  console.log(`[strike-growth] sweep done — ${done.length} ok, ${failed.length} failed, ${stale} stale-spot`);

  // Day-over-day rollup: recompute the biggest overnight→now mover per symbol
  // from the rows just written, keep the intraday peak. Cheap SQL, best-effort.
  try { await rollupDayOverDay(p, date); }
  catch (e) { console.warn('[strike-growth/dod]', e.message); }

  return { date, ok: done.length, failed: failed.length, staleSpot: stale, failures: failed.slice(0, 10) };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;
let _spotTimer = null;

// REST spot backstop: fetch fresh underlying marks for the whole active roster
// and push them into the proxy's live strikeGrowthSpot map (which the feed's
// strike-window picker reads). Runs on its own cadence, independent of the
// RTH-gated sweeps, so spots stay current for every ticker — not just the ones
// the dxLink feed subscribes.
async function refreshRosterSpots() {
  if (!_proxy?.refreshStrikeGrowthSpots) return;
  try {
    if (!(await ensureSchema())) return;
    const symbols = await getActiveSymbols(getPool());
    if (!symbols.length) return;
    const n = await _proxy.refreshStrikeGrowthSpots(symbols);
    if (n) console.log(`[strike-growth] REST spot backstop: refreshed ${n}/${symbols.length} spots`);
  } catch (e) {
    console.warn('[strike-growth] spot backstop error:', String(e?.message || e).slice(0, 160));
  }
}
// Run sweeps aligned-ish to the cadence: poll each minute, fire when the ET
// minute is a multiple of SWEEP_MINS and we're inside RTH, de-duped per minute.
let _lastSweepKey = null;
let _lastHotKey = null;
// SEPARATE guards so the fast lane isn't starved by a long full sweep. Each
// guard only blocks a second sweep OF THE SAME KIND, so a small hot sweep can
// run concurrently with the full sweep — both just read in-memory feed maps
// now, so there's no Theta-style burst risk to guard against, but the
// de-dupe still matters so a slow DB write doesn't double-fire a sweep.
let _fullSweeping = false;
let _hotSweeping = false;

/**
 * @param {number} _port unused, kept for call-site symmetry with the other
 *   startXRecorder(PORT) functions in server-with-proxy.js.
 * @param {import('./proxy-tastytrade').TastytradeProxy} proxy the live feed
 *   instance whose shared dxLink connection this recorder reads from. Without
 *   it every sweep fails fast with "dxLink feed not wired".
 */
function startStrikeGrowthRecorder(_port, proxy) {
  _proxy = proxy || null;
  if (!_proxy) {
    console.warn('[strike-growth] started WITHOUT a proxy instance — every sweep will fail until this is wired (see startStrikeGrowthRecorder call site in server-with-proxy.js)');
  }
  console.log(`[strike-growth] enabled — ${SWEEP_MINS}m full sweeps + ${HOT_MINS}m hot-lane during RTH, top ${TOP_N_EACH_SIDE} each side × ${EXPIRIES_PER_TICKER} expiries/ticker, dxLink-fed (no REST/Theta)`);
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

  // REST spot backstop poller (every SPOT_REFRESH_MINS; 0 disables). First run is
  // delayed ~20s so the TT session is authenticated before the first REST call.
  if (SPOT_REFRESH_MINS > 0 && _proxy?.refreshStrikeGrowthSpots) {
    console.log(`[strike-growth] REST spot backstop enabled — every ${SPOT_REFRESH_MINS}m for the full roster`);
    setTimeout(() => { void refreshRosterSpots(); }, 20_000).unref?.();
    _spotTimer = setInterval(() => { void refreshRosterSpots(); }, SPOT_REFRESH_MINS * 60_000);
    _spotTimer.unref?.();
  }

  return () => {
    if (_timer) clearInterval(_timer);
    if (_spotTimer) clearInterval(_spotTimer);
  };
}

module.exports = {
  startStrikeGrowthRecorder,
  runSweep,
  ensureSchema,
  getPool,
  snapshotTicker,
  rollupDayOverDay,
};
