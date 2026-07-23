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
// How many strikes to WRITE to strike_growth per side, per expiry — ranked by
// combined net GEX (gex_now+gex_open), not distance from spot. Keeps the table
// to the strikes that actually matter (real call/put walls) instead of a
// fixed spot-centered window. The subscription window that makes these strikes
// visible in the first place is STRIKE_GROWTH_FEED_WINDOW in proxy-tastytrade.js.
const TOP_N_EACH_SIDE = Number(process.env.STRIKE_GROWTH_TOP_N || 5);
// How many front expiries to snapshot per ticker. Must be <= the live feed's
// STRIKE_GROWTH_FEED_EXPIRIES (proxy-tastytrade.js) — a larger value here just
// gets clamped to whatever the feed actually subscribed. 3 = 0DTE+1DTE+2DTE,
// what getForwardBuildLeaderboard() needs to rank strikes accelerating ahead
// of today, not just today's front expiry.
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
    if (picked.length) out.push({ expiry, rows: picked });
  }
  if (!out.length) throw new Error(`no usable expiries ${chainTicker}`);
  return { spot: snap.spot, expiries: out };
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

// ── Forward Build: 0/1/2-DTE acceleration leaderboard ───────────────────────
// A DIFFERENT cut than the 0DTE/SWING split above. Question this answers: for
// EVERY active ticker's front 3 expiries (0DTE/1DTE/2DTE as of the latest
// recorded session), which strike is ACCELERATING — today's day-over-day Δ
// bigger than yesterday's Δ — not just biggest total growth? A strike quietly
// speeding up on tomorrow's or the day-after's expiry is where price may be
// headed before it ever becomes today's 0DTE. Needs EXPIRIES_PER_TICKER>=3
// (bumped 2->3 for this) and STRIKE_GROWTH_FEED_EXPIRIES>=3 in
// proxy-tastytrade.js so 2DTE actually gets subscribed/recorded at all.
// Pure read over rows the sweep already wrote — one query, no extra network
// call, computed in JS since the per-strike history here is small (top 5/side
// × 3 expiries × ~130 tickers × a few days ≈ a few thousand rows).
const FORWARD_BUILD_MIN_BASE = Number(process.env.STRIKE_GROWTH_FORWARD_MIN_BASE || 20e6);
const FORWARD_BUILD_LOOKBACK_DAYS = Number(process.env.STRIKE_GROWTH_FORWARD_LOOKBACK_DAYS || 3);

async function getForwardBuildLeaderboard(opts = {}) {
  const limit = Math.min(200, Number(opts.limit) || 40);
  const minBase = Number(opts.minBase) || FORWARD_BUILD_MIN_BASE;
  if (!(await ensureSchema())) return { asOf: null, rows: [] };
  const p = getPool();
  const symbols = await getActiveSymbols(p);
  if (!symbols.length) return { asOf: null, rows: [] };

  // Last snapshot per (symbol,expiry,strike,date) over a short calendar window
  // (generous vs FORWARD_BUILD_LOOKBACK_DAYS=3 trading days to absorb weekends).
  const { rows: raw } = await p.query(
    `SELECT DISTINCT ON (symbol, expiry, strike, date)
       to_char(date, 'YYYY-MM-DD') AS date, symbol, strike, expiry,
       gex_now, gex_open, spot
     FROM strike_growth
     WHERE date >= (CURRENT_DATE - INTERVAL '9 days') AND symbol = ANY($1)
     ORDER BY symbol, expiry, strike, date, ts DESC`,
    [symbols]
  );
  if (!raw.length) return { asOf: null, rows: [] };

  // "Today" = the most recent session actually present, not wall-clock — so
  // this stays correct pre-open/after-hours when the latest sweep is stale.
  const asOf = raw.reduce((m, r) => (r.date > m ? r.date : m), raw[0].date);
  const asOfMs = new Date(`${asOf}T00:00:00Z`).getTime();

  // `symbol|expiry` -> { symbol, expiry, dte, spot, strikes: Map<strike, [{date,net}]> }
  const groups = new Map();
  for (const r of raw) {
    const expiry = String(r.expiry || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(expiry)) continue;
    const expMs = new Date(`${expiry.slice(0, 10)}T00:00:00Z`).getTime();
    const dte = Math.round((expMs - asOfMs) / 86400000);
    if (dte < 0 || dte > 2) continue; // only 0/1/2-DTE — the forward window this view is about
    const gk = `${r.symbol}|${expiry}`;
    if (!groups.has(gk)) groups.set(gk, { symbol: r.symbol, expiry, dte, spot: 0, strikes: new Map() });
    const g = groups.get(gk);
    if (Number(r.spot) > 0) g.spot = Number(r.spot);
    const sk = Number(r.strike);
    if (!g.strikes.has(sk)) g.strikes.set(sk, []);
    g.strikes.get(sk).push({ date: r.date, net: Number(r.gex_now || 0) + Number(r.gex_open || 0) });
  }

  const out = [];
  for (const g of groups.values()) {
    for (const [strike, pts] of g.strikes) {
      pts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const last = pts.slice(-FORWARD_BUILD_LOOKBACK_DAYS);
      if (last.length < 2) continue; // need at least one Δ to rank anything
      const latest = last[last.length - 1].net;
      if (Math.abs(latest) < minBase) continue; // tiny strikes → noisy % / accel, skip
      const deltaLast = last[last.length - 1].net - last[last.length - 2].net;
      // deltaPrev = the Δ BEFORE deltaLast (needs a 3rd point) — accel compares
      // the two, so a strike whose Δ is growing day-over-day ranks above one
      // that grew a lot once and has since flattened.
      const deltaPrev = last.length >= 3 ? last[last.length - 2].net - last[last.length - 3].net : null;
      const accel = deltaPrev != null ? deltaLast - deltaPrev : deltaLast;
      out.push({
        symbol: g.symbol, dte: g.dte, expiry: g.expiry, strike, spot: g.spot,
        side: latest >= 0 ? 'call' : 'put',
        trend: last.map((x) => ({ date: x.date, net: x.net })),
        delta_last: deltaLast, delta_prev: deltaPrev, accel,
        has_accel: deltaPrev != null,
      });
    }
  }

  out.sort((a, b) => {
    if (a.has_accel !== b.has_accel) return a.has_accel ? -1 : 1;
    return b.accel - a.accel;
  });

  return { asOf, rows: out.slice(0, limit) };
}

// ── Forward Build STRUCTURE: per-ticker 0/1/2-DTE GEX ladder + DoD Δ per strike ─
// Same source rows as the leaderboard above, but a DIFFERENT shape: instead of
// ranking individual accelerating strikes across the whole roster, this groups
// by ticker and, for each of the front 0/1/2-DTE expiries, returns the CURRENT
// wall structure (top strikes each side, from the latest session) plus each
// strike's day-over-day Δ vs the SAME expiry's prior session. Feeds the
// grouped, collapsible "Forward Build" structure tab: see where each ticker's
// gamma is stacking and which strikes are building/leaving day to day.
//
// Δ availability note (data-driven, not a UI choice): an expiry first enters the
// recorded window when it's 2DTE (1 point -> no Δ), becomes 1DTE the next session
// (2 points -> 1 Δ) and 0DTE the session after (3 points). So 0DTE/1DTE strikes
// normally have a Δ; a freshly-appeared 2DTE strike shows "—" until it has a
// prior session to compare against.
async function getForwardBuildStructure(opts = {}) {
  const maxTickers = Math.min(600, Number(opts.limit) || 400);
  if (!(await ensureSchema())) return { asOf: null, tickers: [] };
  const p = getPool();
  const symbols = await getActiveSymbols(p); // sort_idx order (hot/majors first)
  if (!symbols.length) return { asOf: null, tickers: [] };
  const order = new Map(symbols.map((s, i) => [s, i]));

  const { rows: raw } = await p.query(
    `SELECT DISTINCT ON (symbol, expiry, strike, date)
       to_char(date, 'YYYY-MM-DD') AS date, symbol, strike, expiry,
       gex_now, gex_open, spot
     FROM strike_growth
     WHERE date >= (CURRENT_DATE - INTERVAL '9 days') AND symbol = ANY($1)
     ORDER BY symbol, expiry, strike, date, ts DESC`,
    [symbols]
  );
  if (!raw.length) return { asOf: null, tickers: [] };

  const asOf = raw.reduce((m, r) => (r.date > m ? r.date : m), raw[0].date);
  const asOfMs = new Date(`${asOf}T00:00:00Z`).getTime();

  // symbol -> { spot, exps: Map<expiry, { dte, strikes: Map<strike, [{date,net}]> }> }
  const bySym = new Map();
  for (const r of raw) {
    const expiry = String(r.expiry || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(expiry)) continue;
    const dte = Math.round(
      (new Date(`${expiry.slice(0, 10)}T00:00:00Z`).getTime() - asOfMs) / 86400000
    );
    if (dte < 0 || dte > 2) continue;
    if (!bySym.has(r.symbol)) bySym.set(r.symbol, { spot: 0, exps: new Map() });
    const s = bySym.get(r.symbol);
    if (Number(r.spot) > 0) s.spot = Number(r.spot);
    if (!s.exps.has(expiry)) s.exps.set(expiry, { dte, strikes: new Map() });
    const e = s.exps.get(expiry);
    const sk = Number(r.strike);
    if (!e.strikes.has(sk)) e.strikes.set(sk, []);
    e.strikes.get(sk).push({ date: r.date, net: Number(r.gex_now || 0) + Number(r.gex_open || 0) });
  }

  const tickers = [];
  for (const [symbol, s] of bySym) {
    const dtes = [];
    for (const [expiry, e] of s.exps) {
      const strikes = [];
      for (const [strike, pts] of e.strikes) {
        pts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        // Only show strikes that are part of the CURRENT (asOf) structure — a
        // strike whose latest recorded point is stale rotated out of the walls.
        if (pts[pts.length - 1].date !== asOf) continue;
        const net = pts[pts.length - 1].net;
        const prev = pts.length >= 2 ? pts[pts.length - 2].net : null;
        strikes.push({
          strike,
          side: net >= 0 ? 'call' : 'put',
          net,
          delta: prev != null ? net - prev : null,
        });
      }
      if (!strikes.length) continue;
      strikes.sort((a, b) => b.strike - a.strike); // high -> low, spot sits in the middle
      const netTotal = strikes.reduce((a, r) => a + r.net, 0);
      const calls = strikes.filter((r) => r.net > 0);
      const puts = strikes.filter((r) => r.net < 0);
      const callWall = calls.length ? calls.reduce((m, r) => (r.net > m.net ? r : m)) : null;
      const putWall = puts.length ? puts.reduce((m, r) => (r.net < m.net ? r : m)) : null;
      dtes.push({
        dte: e.dte, expiry, netTotal, strikes,
        callWall: callWall ? { strike: callWall.strike, net: callWall.net } : null,
        putWall: putWall ? { strike: putWall.strike, net: putWall.net } : null,
      });
    }
    if (!dtes.length) continue;
    dtes.sort((a, b) => a.dte - b.dte);
    // Prefer the LIVE in-memory spot (updated on every underlying Quote/Trade)
    // over the last-swept DB spot, which lags by up to a sweep (≤5 min). The GEX
    // structure/walls are still from the last sweep — only the spot marker is
    // live. Falls back to the DB spot when the feed has no live value (e.g. this
    // process just restarted, or after hours).
    const liveSpot = _proxy?.getStrikeGrowthSpot ? Number(_proxy.getStrikeGrowthSpot(symbol)) : 0;
    tickers.push({ symbol, spot: liveSpot > 0 ? liveSpot : s.spot, dtes });
  }

  tickers.sort((a, b) => (order.get(a.symbol) ?? 1e9) - (order.get(b.symbol) ?? 1e9));
  return { asOf, tickers: tickers.slice(0, maxTickers) };
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

  // Keep the live dxLink feed's roster in sync with this sweep's symbol list.
  // Additive (see startStrikeGrowthFeed in proxy-tastytrade.js) — safe to call
  // every sweep, including the small hot-lane subset, without dropping tickers
  // the full sweep already subscribed.
  if (_proxy) {
    await _proxy.startStrikeGrowthFeed(symbols).catch((e) =>
      console.warn('[strike-growth] feed subscribe:', e.message));
  }

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
    await sleep(TICKER_DELAY_MS); // insurance vs a cold fetchChain() cache-miss burst
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
  return () => { if (_timer) clearInterval(_timer); };
}

module.exports = {
  startStrikeGrowthRecorder,
  runSweep,
  ensureSchema,
  getPool,
  snapshotTicker,
  rollupDayOverDay,
  getForwardBuildLeaderboard,
  getForwardBuildStructure,
};
