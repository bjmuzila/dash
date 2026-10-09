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
 *      plus fetchVolumeTheta() for that same expiry — one more whole-chain call,
 *      because every level here is OI+VOLUME net GEX (see toGexRows),
 *   4. computeGexSummary() → total net GEX, call/put walls, gex flip,
 *   5. write ONE aggregate row into scanner_snapshots.
 *
 * The /proxy/scanner endpoint ranks the latest row per ticker.
 *
 * Wiring: startScannerRecorder(PORT) from server-with-proxy.js.
 * Manual fire: POST /proxy/scanner-run
 * No-op unless SCANNER_TICKERS is set and DATABASE_URL is available.
 */

// ThetaData was removed 2026-08-18 (see config/data-source.js). tt-snapshot is
// TastyTrade REST and is now the only options provider; it is a drop-in with
// the same *Theta-suffixed signatures, which is why those names survive here.
const optSrc = require('./tt-snapshot');
const {
  computeGexSummary, computeGexRows, computeGexRowsMultiExpiry,
  findCallWall, findPutWall, findGexFlip,
} = require('./computation/gex-calculator');
const V = require('./scanner-variants');

// 2026-08-27: 5m -> 1m. The walls/CORE grid still writes on its own 15m slot
// clock; this is how FRESH the sample under each slot is, and a 5-minute-old
// wall on a 15-minute grid meant a third of the slot could already be wrong.
// A sweep that outruns the interval is skipped, not queued — see the scheduler.
const INTERVAL_MINS = Number(process.env.SCANNER_INTERVAL_MINS || 1);
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
const rosterStore = require('./roster-store');

/** Explicit env override, if any. Wins over both the file and the DB overrides
 * so an ops-level "sweep only these three" still works. */
function envTickers() {
  const env = String(process.env.SCANNER_TICKERS || '').trim();
  if (!env || env.toUpperCase() === 'SCANNER') return null;
  return env.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
}

/**
 * SYNCHRONOUS universe. Kept for the boot-time "is the recorder idle?" check
 * and for GET /proxy/scanner-tickers' fallback path. Reads roster-store's warm
 * cache, so it reflects owner edits once primeRosters() has run — but prefer
 * resolveScannerTickers() anywhere an await is possible.
 */
function parseScannerTickers() {
  const env = envTickers();
  if (env) return env;
  const live = rosterStore.getSymbolsSync('scanner');
  return live.length ? live : [...DEFAULT_SCANNER_TICKERS];
}

/**
 * The universe to actually sweep: file baseline + roster_overrides, resolved
 * fresh (15s cache in roster-store). This is what makes an add/remove from the
 * owner Watchlists page land on the NEXT sweep instead of the next deploy.
 */
async function resolveScannerTickers() {
  const env = envTickers();
  if (env) return env;
  try {
    const live = await rosterStore.getSymbols('scanner');
    if (live.length) return live;
  } catch (e) {
    console.warn('[scanner] roster resolve failed, using baseline:', e.message);
  }
  return [...DEFAULT_SCANNER_TICKERS];
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

    // ── scanner_variants — the SAME levels under the other three readings ────
    //
    // A SEPARATE TABLE, for the reason forward-scanner-recorder.js spells out
    // above its own: every existing reader of scanner_snapshots takes
    // `SELECT DISTINCT ON (symbol) ... ORDER BY ts DESC` and assumes ONE row per
    // symbol per sweep. walls-recorder.sampleUniverse, walls-reach.getWatch,
    // walls-reach.buildSessionRows and /proxy/scanner all do exactly that.
    // Adding an expiry_scope/basis column to that table would hand each of them
    // an arbitrary one of four rows. So the default variant (0dte + oivol) keeps
    // writing into scanner_snapshots UNCHANGED — nothing that worked yesterday
    // reads anything new — and all four variants are ALSO written here, so the
    // variant-aware readers have one uniform source.
    //
    // `expiry` is the contract the levels came from: for '0dte' the nearest
    // listed expiration, for 'agg' the NEAREST of the ones summed. `expiries`
    // says how many were summed, so a reader can tell a 1-expiry aggregate from
    // a 4-expiry one rather than guessing.
    await p.query(`
      CREATE TABLE IF NOT EXISTS scanner_variants (
        date          TEXT        NOT NULL,
        symbol        TEXT        NOT NULL,
        ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expiry_scope  TEXT        NOT NULL,
        basis         TEXT        NOT NULL,
        expiry        TEXT        NOT NULL DEFAULT '',
        expiries      INTEGER     NOT NULL DEFAULT 1,
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
        PRIMARY KEY (date, symbol, ts, expiry_scope, basis)
      );
      CREATE INDEX IF NOT EXISTS scanner_var_lookup
        ON scanner_variants (date, symbol, expiry_scope, basis, ts DESC);
    `);

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
      const p = await optSrc.fetchIndexPriceTheta(root);
      return p > 0 ? p : 0;
    }
    const getSpot = optSrc.fetchStockSpotTheta || optSrc.fetchStockQuoteTheta;
    const q = await getSpot(root);
    return q && q.mark > 0 ? q.mark : (q && q.last > 0 ? q.last : 0);
  } catch {
    return 0;
  }
}

/**
 * buildExpiryRows() rows -> gex-calculator input rows ({side,oi,gamma,...}).
 *
 * `volMap` is fetchVolumeTheta()'s Map, keyed `expiration|strike|type` exactly as
 * both adapters build it. It MUST be populated: every level this recorder writes
 * (call wall, put wall, CORE, and the per-level *_gex columns) is ranked on
 * oiVolNet = netGEX + netVolGEX, and netVolGEX is zero without volume — so an
 * OI-only sweep silently produced OI-only walls that disagreed with the
 * dashboard chart / heatmap / MVC, which all read the OI+Vol basis.
 *
 * A missing key means "no volume reported for that contract" (pre-open, or a
 * strike that hasn't traded), which is a true 0, not a gap to interpolate.
 */
function toGexRows(expiryRows, volMap = null) {
  const volOf = (r) => {
    if (!volMap) return 0;
    const v = Number(volMap.get(`${r.expiration}|${Number(r.strike)}|${r.type}`) ?? 0);
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  return expiryRows.map((r) => ({
    // Carried so computeGexRowsMultiExpiry() can group by contract on the
    // aggregate leg. Ignored entirely by the single-expiry path.
    expiration: r.expiration,
    strike: r.strike,
    side: r.type === 'C' ? 'call' : 'put',
    oi: Number(r.oi ?? 0),
    volume: volOf(r),
    gamma: Number(r.gamma ?? 0),
    delta: Number(r.delta ?? 0),
    theta: Number(r.theta ?? 0),
    vega: Number(r.vega ?? 0),
    iv: Number(r.iv ?? 0),
    dte: r.dte,
  }));
}

/**
 * The signed net-GEX metric for a basis. 'oivol' is netGEX + netVolGEX — open
 * interest and today's volume, the historical default and what the dashboard
 * chart / heatmap / MVC read. 'vol' is netVolGEX alone: same gamma weighting,
 * the book removed, so it answers "where is TODAY'S flow building" rather than
 * "where is the gamma that is on the book".
 *
 * Matches gex-calculator's own wallMetric() for the same two names, so a wall
 * and the CORE are never ranked on different quantities.
 */
function basisNet(basis) {
  if (basis === 'vol') return (r) => Number(r.netVolGEX ?? 0);
  // 'oi' (2026-10-07): open interest alone — gex-calculator's wallMetric('oi')
  if (basis === 'oi') return (r) => Number(r.netGEX ?? 0);
  return (r) => Number(r.netGEX ?? 0) + Number(r.netVolGEX ?? 0);
}

/**
 * CB / Core Bullseye — the strike with the largest absolute net GEX anywhere on
 * the chain, under `basis`. Same pick as mvc-auto-snapshot.js makes for SPX,
 * just evaluated per scanner root. Unlike the walls it is not sided against
 * spot. Default basis keeps the old OI+Vol behaviour to the strike.
 */
function findCoreBullseye(gexRows, basis = V.DEFAULT_BASIS) {
  if (!gexRows?.length) return null;
  const metric = basisNet(basis);
  const net = (r) => Math.abs(metric(r));
  const best = gexRows.reduce((b, r) => (net(r) > net(b) ? r : b), gexRows[0]);
  return net(best) > 0 ? Number(best.strike) : null;
}

/**
 * Signed net GEX sitting at one strike, under `basis`. Same quantity
 * findCoreBullseye ranks on, but signed — the sign is the point when watching a
 * wall build or bleed. Returns null when the strike isn't on the chain.
 */
function gexAtStrike(gexRows, strike, basis = V.DEFAULT_BASIS) {
  if (!gexRows?.length || !(strike > 0)) return null;
  const r = gexRows.find((x) => Number(x.strike) === Number(strike));
  if (!r) return null;
  const v = basisNet(basis)(r);
  return Number.isFinite(v) ? v : null;
}

/**
 * Levels off an ALREADY-COMPUTED row set, under one basis.
 *
 * The CB is picked first and then EXCLUDED from both walls, for the reason
 * snapshotTicker() spells out below: the biggest node on the chain is usually
 * also the biggest positive node above spot, so without the exclusion the call
 * wall and the CORE collapse onto one strike and the day records two levels
 * where there are three.
 */
function levelsFor(rows, spot, basis) {
  const metric = basisNet(basis);
  const cb = findCoreBullseye(rows, basis);
  const callWall = findCallWall(rows, spot, { exclude: cb, basis });
  const putWall = findPutWall(rows, spot, { exclude: cb, basis });
  return {
    totalNetGex: rows.reduce((sum, r) => sum + metric(r), 0),
    callWall,
    putWall,
    gexFlip: findGexFlip(rows, spot),
    cb,
    callWallGex: gexAtStrike(rows, callWall, basis),
    putWallGex: gexAtStrike(rows, putWall, basis),
    cbGex: gexAtStrike(rows, cb, basis),
    strikes: rows.length,
  };
}

/**
 * Snapshot one root: the aggregate summary, or { err } naming why it failed.
 * The three failure modes used to collapse into one "thin/no-spot" string,
 * which made a quote outage look identical to a genuinely thin chain.
 */
async function snapshotTicker(root, { pick = null } = {}) {
  const chain = await optSrc.fetchChainTheta(root).catch(() => null);
  const exps = chain?.expirations ?? [];
  // `pick` lets the forward recorder reuse this whole path for a different
  // contract. Default stays expirations[0] — the nearest, i.e. 0DTE intraday.
  const expiry = pick ? pick(exps) : exps[0];
  if (!expiry) return { err: 'no-chain' };

  // Volume rides alongside, not after: on the TT adapter it reads the SAME cached
  // whole-chain payload buildExpiryRows already pulled (free); on Theta it is one
  // extra snapshot call per root per sweep. Failure degrades to an OI-only basis
  // for this one root rather than dropping it.
  const [spot, expiryRows, volMap] = await Promise.all([
    resolveSpot(root),
    optSrc.buildExpiryRows(root, expiry).catch(() => []),
    typeof optSrc.fetchVolumeTheta === 'function'
      ? optSrc.fetchVolumeTheta(root, expiry).catch(() => null)
      : Promise.resolve(null),
  ]);
  if (!(spot > 0)) return { err: 'no-spot' };
  if (!volMap?.size) console.warn(`[scanner] ${root} ${expiry}: no volume — OI-only basis this sweep`);

  // Keep a strike that has traded today even with zero OI — it still carries
  // netVolGEX, so dropping it would hide a wall that is being built right now.
  const gexRows = toGexRows(expiryRows, volMap)
    .filter((r) => r.oi > 0 || r.volume > 0 || r.gamma !== 0);
  if (gexRows.length < MIN_STRIKES) return { err: `thin-${gexRows.length}` };

  const summary = computeGexSummary(gexRows, spot);
  const cb = findCoreBullseye(summary.rows);
  // THREE DISTINCT LEVELS. summary.callWall / summary.putWall are picked without
  // knowing what the CB is, and the CB is very often the same strike as one of
  // them (the biggest node on the chain is usually the biggest positive node
  // above spot). That wrote a row whose call wall and core were one number, so a
  // levels view drew a single line and the wall price has to trade through AFTER
  // the core was never recorded at all. Re-pick both walls with the CB excluded:
  // when they were already different this is a no-op, and when they collided the
  // wall falls back to the next strike out.
  const callWall = findCallWall(summary.rows, spot, { exclude: cb });
  const putWall = findPutWall(summary.rows, spot, { exclude: cb });
  return {
    symbol: root,
    spot,
    expiry,
    totalNetGex: summary.totalNetGex,
    callWall,
    putWall,
    gexFlip: summary.gexFlip,
    cb,
    callWallGex: gexAtStrike(summary.rows, callWall),
    putWallGex: gexAtStrike(summary.rows, putWall),
    cbGex: gexAtStrike(summary.rows, cb),
    strikes: summary.rows.length,
  };
}

/**
 * Snapshot one root under EVERY variant that is due this sweep.
 *
 * ONE chain structure fetch, then one whole-chain payload per expiration —
 * tt-snapshot's 4s coalescing cache means OI, greeks and volume for the same
 * (root, expiry) collapse to a single upstream call, so the cost is
 * "expirations touched", not "fields read".
 *
 * The two BASES are free: they are the same computed rows ranked on a different
 * quantity. Only the aggregate leg costs anything upstream, which is why it runs
 * on its own sub-cadence (V.AGG_EVERY_N_SWEEPS) rather than every minute.
 *
 * Returns { symbol, spot, variants: [...] } or { err } naming why it failed.
 */
/** Raw gex-calculator input rows for one expiration, thin strikes dropped. */
async function expiryGexRows(root, expiry) {
  const [expiryRows, volMap] = await Promise.all([
    optSrc.buildExpiryRows(root, expiry).catch(() => []),
    typeof optSrc.fetchVolumeTheta === 'function'
      ? optSrc.fetchVolumeTheta(root, expiry).catch(() => null)
      : Promise.resolve(null),
  ]);
  if (!volMap?.size) console.warn(`[scanner] ${root} ${expiry}: no volume — OI-only basis this sweep`);
  // Keep a strike that has traded today even with zero OI — it still carries
  // netVolGEX, so dropping it would hide a wall being built right now. On the
  // 'vol' basis that strike IS the signal.
  return toGexRows(expiryRows, volMap).filter((r) => r.oi > 0 || r.volume > 0 || r.gamma !== 0);
}

/**
 * NON-0DTE: the expirations the aggregate leg sums — every listed one strictly
 * AFTER today (ET), nearest first, the set the Options Chain's ⅀ Total and Ticker
 * Lookup's right pane read (scanner-variants.js). The env caps apply only when set.
 */
function aggExpiries(chain, today = etDateStr()) {
  const exps = (chain?.expirations ?? []).filter((e) => /^\d{4}-\d{2}-\d{2}/.test(String(e)) && String(e).slice(0, 10) > today);
  let picked = [...new Set(exps)].sort();
  if (V.AGG_MAX_DTE > 0) {
    const dteOf = new Map();
    for (const c of chain?.contracts ?? []) {
      if (!dteOf.has(c.expiration) && Number.isFinite(Number(c.dte))) dteOf.set(c.expiration, Number(c.dte));
    }
    picked = picked.filter((e) => { const d = dteOf.get(e); return d == null || d <= V.AGG_MAX_DTE; });
  }
  return V.AGG_MAX_EXPIRIES > 0 ? picked.slice(0, V.AGG_MAX_EXPIRIES) : picked;
}

/**
 * The aggregate ('agg') variants for one root: every expiration after today,
 * per-expiry ladders summed per strike. [] when nothing is listed past today or
 * the merged board is too thin. `chain` / `spot` are reused when the caller has them.
 */
async function aggVariantsFor(root, { chain = null, spot = 0 } = {}) {
  const ch = chain ?? (await optSrc.fetchChainTheta(root).catch(() => null));
  const picked = aggExpiries(ch);
  if (!picked.length) return [];
  const px = spot > 0 ? spot : await resolveSpot(root);
  if (!(px > 0)) return [];
  const chunks = [];
  for (const e of picked) {
    chunks.push(await expiryGexRows(root, e)); // eslint-disable-line no-await-in-loop
  }
  const flat = chunks.flat();
  if (!flat.length) return [];
  // Per-expiry ladders computed independently, then summed per strike —
  // gamma is per contract and cannot be pooled before the exposure math.
  const merged = computeGexRowsMultiExpiry(flat, px);
  if (merged.length < MIN_STRIKES) return [];
  return V.BASES.map((basis) => ({
    scope: 'agg', basis, expiry: picked[0], expiries: picked.length, spot: px,
    ...levelsFor(merged, px, basis),
  }));
}

async function snapshotTickerVariants(root, { includeAgg = false } = {}) {
  const chain = await optSrc.fetchChainTheta(root).catch(() => null);
  const exps = chain?.expirations ?? [];
  const front = exps[0];
  if (!front) return { err: 'no-chain' };

  const spot = await resolveSpot(root);
  if (!(spot > 0)) return { err: 'no-spot' };

  const variants = [];

  // ── 0DTE leg: chain.expirations[0], the nearest listed contract ────────────
  const frontRaw = await expiryGexRows(root, front);
  if (frontRaw.length < MIN_STRIKES) return { err: `thin-${frontRaw.length}` };
  const frontRows = computeGexRows(frontRaw, spot);
  for (const basis of V.BASES) {
    variants.push({ scope: '0dte', basis, expiry: front, expiries: 1, ...levelsFor(frontRows, spot, basis) });
  }

  // ── aggregate leg (Non-0DTE): runs on its own loop now (runAggSweep). Only a
  // caller that asks for it here gets it inline (a manual one-root fire).
  if (includeAgg) variants.push(...(await aggVariantsFor(root, { chain, spot })));

  return { symbol: root, spot, variants };
}

// ── Batched insert ──────────────────────────────────────────────────────────

const SNAP_COLS = ['date', 'symbol', 'ts', 'spot', 'expiry', 'total_net_gex', 'call_wall', 'put_wall',
  'gex_flip', 'cb', 'strikes', 'call_wall_gex', 'put_wall_gex', 'cb_gex'];
const VAR_COLS = ['date', 'symbol', 'ts', 'expiry_scope', 'basis', 'expiry', 'expiries', 'spot',
  'total_net_gex', 'call_wall', 'put_wall', 'gex_flip', 'cb', 'strikes', 'call_wall_gex',
  'put_wall_gex', 'cb_gex'];

/** One multi-row INSERT … ON CONFLICT DO NOTHING, chunked under the 65535-param cap. */
async function insertMany(p, table, cols, rows) {
  const CHUNK = Math.floor(30000 / cols.length);
  for (let start = 0; start < rows.length; start += CHUNK) {
    const slice = rows.slice(start, start + CHUNK);
    const params = [];
    const tuples = slice.map((r) => {
      const ph = r.map((v) => { params.push(v); return `$${params.length}`; });
      return `(${ph.join(',')})`;
    });
    await p.query( // eslint-disable-line no-await-in-loop
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`,
      params,
    );
  }
}

// ── Sweep ────────────────────────────────────────────────────────────────────

/** Sweep counter — drives the aggregate leg's sub-cadence. Process-lifetime. */
let _sweepN = 0;

async function runSweep({ force = false } = {}) {
  if (!force && !inSweepWindow()) return { skipped: 'outside sweep window' };

  // Re-resolved every sweep so an owner edit lands here, not on the next deploy.
  const tickers = await resolveScannerTickers();
  if (!tickers.length) return { skipped: 'no SCANNER_TICKERS' };

  const p = getPool();
  if (!p || !(await ensureSchema())) return { skipped: 'no DB' };

  const date = etDateStr();
  const now = new Date();
  let written = 0;
  let variantRows = 0;
  const errors = [];

  // The aggregate (Non-0DTE) leg is NOT run here any more: the whole board after
  // today is too many chain calls for a 1-minute sweep. runAggSweep, below, owns it.
  _sweepN += 1;
  const includeAgg = false;

  // BATCHED WRITES (2026-10-09 audit). This used to send one INSERT per row —
  // 1 into scanner_snapshots plus one per variant, ~7 statements per root, ~780
  // a minute across the roster, each its own round trip and commit. Rows are now
  // buffered and flushed as multi-row INSERTs every FLUSH_EVERY roots and once at
  // the end, so a sweep is a handful of statements. Same rows, same `ts` (the
  // sweep start, as before), same ON CONFLICT DO NOTHING. Flushing every N roots
  // rather than only at the end keeps the board filling during a long sweep —
  // walls-recorder's slot sampler reads whatever is newest when it fires.
  const FLUSH_EVERY = 20;
  const snapRows = [];
  const varRows = [];
  let pendingRoots = 0;
  const flush = async () => {
    if (snapRows.length) {
      const rows = snapRows.splice(0);
      await insertMany(p, 'scanner_snapshots', SNAP_COLS, rows);
      written += rows.length;
    }
    if (varRows.length) {
      const rows = varRows.splice(0);
      await insertMany(p, 'scanner_variants', VAR_COLS, rows);
      variantRows += rows.length;
    }
    pendingRoots = 0;
  };
  const flushSafe = async () => {
    try { await flush(); } catch (e) {
      // One failed batch must not abort the rest of the sweep: log it and keep
      // going. Those roots are re-sampled on the next sweep a minute later.
      errors.push(`batch:${String(e?.message || e).slice(0, 60)}`);
    }
  };

  for (const root of tickers) {
    // Sequential — keep upstream REST load gentle across many roots.
    try {
      const s = await snapshotTickerVariants(root, { includeAgg }); // eslint-disable-line no-await-in-loop
      if (!s || s.err) { errors.push(`${root}:${s?.err || 'null'}`); continue; }

      // The DEFAULT variant still owns scanner_snapshots, byte for byte as
      // before. Every reader of that table — walls-recorder.sampleUniverse,
      // walls-reach, /proxy/scanner, the forward sweep — keeps seeing exactly
      // one row per symbol per sweep, on the nearest expiry, OI+Vol basis.
      const def = s.variants.find((v) => v.scope === V.DEFAULT_SCOPE && v.basis === V.DEFAULT_BASIS);
      if (def) {
        snapRows.push([date, root, now, s.spot, def.expiry, def.totalNetGex, def.callWall, def.putWall, def.gexFlip,
          def.cb, def.strikes, def.callWallGex, def.putWallGex, def.cbGex]);
      }
      if (V.VARIANTS_ENABLED) {
        for (const v of s.variants) {
          varRows.push([date, root, now, v.scope, v.basis, v.expiry, v.expiries, s.spot, v.totalNetGex,
            v.callWall, v.putWall, v.gexFlip, v.cb, v.strikes, v.callWallGex, v.putWallGex, v.cbGex]);
        }
      }
      pendingRoots++;
      if (pendingRoots >= FLUSH_EVERY) await flushSafe(); // eslint-disable-line no-await-in-loop
    } catch (e) {
      errors.push(`${root}:${String(e?.message || e).slice(0, 60)}`);
    }
  }
  await flushSafe();

  console.log(`[scanner] wrote ${written}/${tickers.length} tickers${V.VARIANTS_ENABLED ? ` · ${variantRows} variant rows${includeAgg ? ' (incl. agg)' : ''}` : ''} @ ${now.toISOString()}${errors.length ? ` (skipped: ${errors.join(', ')})` : ''}`);
  return { ok: true, written, variantRows, includeAgg, total: tickers.length, date, errors };
}

// ── Non-0DTE sweep: its own loop ─────────────────────────────────────────────
//
// Every root, every expiration after today, summed per strike (aggVariantsFor),
// written to scanner_variants as scope 'agg' — the rows walls-recorder samples on
// its 15-minute slots for the Non-0DTE walls (Vela's Voltick Path / CB Walls on
// Non-0DTE, the Level Log's Wall Migration). AGG_CONCURRENCY roots at a time; a
// pass that outlasts AGG_INTERVAL_MINS is not overlapped.

let _aggInFlight = false;

async function runAggSweep({ force = false } = {}) {
  if (!V.VARIANTS_ENABLED) return { skipped: 'variants off' };
  if (!force && !inSweepWindow()) return { skipped: 'outside sweep window' };
  if (_aggInFlight) return { skipped: 'previous agg sweep still running' };
  _aggInFlight = true;
  const t0 = Date.now();
  try {
    const tickers = await resolveScannerTickers();
    if (!tickers.length) return { skipped: 'no SCANNER_TICKERS' };
    const p = getPool();
    if (!p || !(await ensureSchema())) return { skipped: 'no DB' };
    const date = etDateStr();
    const queue = [...tickers];
    let rows = 0;
    let roots = 0;
    let expiries = 0;
    const errors = [];
    const worker = async () => {
      while (queue.length) {
        const root = queue.shift();
        if (!root) return;
        try {
          const vs = await aggVariantsFor(root); // eslint-disable-line no-await-in-loop
          if (!vs.length) { errors.push(`${root}:none`); continue; }
          // stamped when ITS board was read, not when the pass began: a pass takes minutes
          const now = new Date();
          // One statement per root (all its bases) instead of one per row.
          await insertMany(p, 'scanner_variants', VAR_COLS, vs.map((v) => ( // eslint-disable-line no-await-in-loop
            [date, root, now, v.scope, v.basis, v.expiry, v.expiries, v.spot, v.totalNetGex,
              v.callWall, v.putWall, v.gexFlip, v.cb, v.strikes, v.callWallGex, v.putWallGex, v.cbGex])));
          rows += vs.length;
          roots++;
          expiries += vs[0].expiries || 0;
        } catch (e) {
          errors.push(`${root}:${String(e?.message || e).slice(0, 60)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(V.AGG_CONCURRENCY, queue.length) }, worker));
    const secs = Math.round((Date.now() - t0) / 1000);
    console.log(`[scanner] agg (Non-0DTE) wrote ${roots}/${tickers.length} roots · ${rows} rows · ${expiries} expiries summed · ${secs}s${errors.length ? ` (skipped: ${errors.slice(0, 20).join(', ')}${errors.length > 20 ? ` +${errors.length - 20}` : ''})` : ''}`);
    return { ok: true, roots, rows, expiries, secs, total: tickers.length, date, errors };
  } finally {
    _aggInFlight = false;
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;
/**
 * A sweep walks the whole universe sequentially and can easily outlast a
 * 1-minute interval. Overlapping sweeps would double the upstream rate for no
 * extra data — the second one would be re-reading rows the first is still
 * writing — so a tick that lands while one is running is SKIPPED, not queued.
 * Skipping is the right call over queueing: the next tick is 60s away and
 * carries fresher numbers than the one that was dropped.
 */
let _sweepInFlight = false;

async function tickSweep(label) {
  if (_sweepInFlight) {
    console.warn(`[scanner] ${label} skipped — previous sweep still running`);
    return;
  }
  _sweepInFlight = true;
  try {
    await runSweep();
  } catch (e) {
    console.warn(`[scanner] ${label} error:`, e.message);
  } finally {
    _sweepInFlight = false;
  }
}

function startScannerRecorder() {
  if (!parseScannerTickers().length) {
    console.log('[scanner] no SCANNER_TICKERS configured — recorder idle.');
    return;
  }
  const ms = INTERVAL_MINS * 60 * 1000;
  _timer = setInterval(() => { void tickSweep('sweep'); }, ms);
  if (_timer.unref) _timer.unref();
  // Initial run after 12s so the terminal/feed can warm up.
  setTimeout(() => { void tickSweep('initial sweep'); }, 12_000);
  // The Non-0DTE board, on its own loop (runAggSweep): first pass a minute in,
  // after the 0DTE sweep has warmed the chain caches.
  if (V.VARIANTS_ENABLED) {
    const aggTick = () => {
      runAggSweep().catch((e) => console.warn('[scanner] agg sweep error:', e.message));
    };
    const aggTimer = setInterval(aggTick, V.AGG_INTERVAL_MINS * 60 * 1000);
    if (aggTimer.unref) aggTimer.unref();
    setTimeout(aggTick, 60_000);
  }
  // The roster is re-resolved per sweep, so this line is a snapshot of the
  // universe at boot, not a fixed roster for the process lifetime.
  console.log(`[scanner] recorder started — ${parseScannerTickers().length} roots every ${INTERVAL_MINS}m (roster re-resolved each sweep)${V.VARIANTS_ENABLED ? ` · variants on, Non-0DTE board every ${V.AGG_INTERVAL_MINS}m on its own loop (every expiry after today${V.AGG_MAX_EXPIRIES > 0 ? `, ≤${V.AGG_MAX_EXPIRIES}` : ''}${V.AGG_MAX_DTE > 0 ? `, ≤${V.AGG_MAX_DTE}DTE` : ''}, ${V.AGG_CONCURRENCY} at a time)` : ' · variants off'}`);
}

module.exports = {
  startScannerRecorder, runSweep, runAggSweep, aggVariantsFor, aggExpiries, ensureSchema, getPool, parseScannerTickers, resolveScannerTickers,
  findCoreBullseye, gexAtStrike, basisNet, levelsFor, snapshotTickerVariants,
  // shared with forward-scanner-recorder.js so both sweeps compute a wall the
  // same way — one definition of call wall / put wall / CORE, two horizons.
  snapshotTicker, MARKET_HOLIDAYS, etDateStr, etParts,
};
