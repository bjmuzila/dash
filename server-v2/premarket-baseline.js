'use strict';
/**
 * server-v2/premarket-baseline.js
 *
 * Server-side "prior close" GEX baseline for the Premarket Prep page
 * (components/pages/Premarket.tsx) — the thing that makes "Biggest GEX Changes"
 * and the Net GEX "vs prior close" chip work.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The page used to take its OWN baseline: a localStorage snapshot
 * (`cb-premarket-eod-v1`) written by the page itself, once per session, only
 * while it was mounted between 15:40 and 16:10 ET. Three things were wrong with
 * that, and the first one is fatal:
 *
 *   1. NOBODY HAS THE PREMARKET PAGE OPEN AT 3:40 PM. The only writer of the
 *      snapshot was the one page that never runs in the write window, so the
 *      snapshot was never written, `baseline` was always null, and the card
 *      showed "No prior-close snapshot yet — this page captures one
 *      automatically between 15:40 and 16:10 ET" forever. A bootstrapping
 *      deadlock, not a warm-up period.
 *   2. localStorage is per-browser-per-device. Even if (1) were fixed, a new
 *      laptop, a phone, a private window or a cache clear started over.
 *   3. `baseline` additionally required the stored date to be STRICTLY BEFORE
 *      today, so the cold start was two sessions, not one.
 *
 * This module replaces all of it with one server-side answer every client
 * shares, available on day one because it is computed from settled history
 * rather than accumulated by sitting there.
 *
 * ── WHY NOT ONE OF THE EXISTING EOD TABLES ──────────────────────────────────
 * Three tables look like they already hold this. None of them do:
 *
 *   eod_gex               Scalars only (total_gex / _0dte / _ex0dte). No strikes.
 *   eod_strike_gex        Per-strike, but the WHOLE BOARD MINUS 0DTE collapsed
 *                         across expirations (PK is date+symbol+strike). The
 *                         premarket page renders ONE expiry — today's 0DTE /
 *                         front — so diffing it against a multi-expiry
 *                         aggregate is apples-to-oranges at every strike.
 *   option_strike_gex_history
 *                         Per-strike AND per-expiry, 30s resolution — the right
 *                         shape, and it does carry ~16:00 ET rows. But
 *                         state/retention-cleanup.js deletes every row whose
 *                         expiry is not MIN(expiry) for its (date, symbol) at
 *                         00:05–00:40 ET. On Thursday the front expiry is
 *                         Thursday's 0DTE, so Thursday's snapshot of FRIDAY's
 *                         expiry — precisely the baseline Friday premarket
 *                         needs — is gone before anyone opens the page.
 *
 * So the baseline is computed the way eod-dte-gamma-recorder.js computes its
 * DTE breakdown: off the settled ThetaData sweep that eod-gex-recorder already
 * knows how to do, via its exported computeHistoricalGexRows(symbol, date).
 * That returns flatRows carrying `expiration`, which is exactly the axis the
 * other tables threw away. Filter to the one expiry, run the SAME
 * computeGexRowsMultiExpiry the rest of the app runs, write it down.
 *
 * Because the source is settled history for a PAST date, this can be built on
 * demand at any hour — there is no window to miss and no cold start. The first
 * request of the morning pays one sweep; everyone after it reads the table.
 *
 * ── THE BASIS, AND WHY THE DEFAULT IS `oi` ──────────────────────────────────
 * Read this before changing the default. Every per-strike row here stores both
 * legs separately:
 *
 *   oi_gex   γ × OI     × S²      (the OI leg,     gexRows[].netGEX)
 *   vol_gex  γ × Volume × S²      (the volume leg, gexRows[].netVolGEX)
 *   net_gex  their sum             (the OI+Vol basis the app prints everywhere)
 *
 * The page's live per-strike number is netGEXOf(row, "net", spot), i.e. OI+Vol.
 * Diffing THAT against an OI+Vol baseline is what the old localStorage snapshot
 * did, and it is wrong premarket in a way that is easy to miss:
 *
 *     live(premarket) = γ_now  × (OI_settled + ~0)      × S_now²
 *     base(prior close) = γ_prev × (OI_settled + Vol_T) × S_prev²
 *
 * Yesterday's whole session volume sits in the baseline and in nothing on the
 * live side, so before the open EVERY strike prints a large negative Δ that is
 * just yesterday's volume leg falling off. It is an artifact of the basis, not
 * a position change, and it would have been the headline number on the card.
 *
 * On the `oi` basis both sides carry the SAME settled OI — OCC publishes
 * overnight, so the live chain premarket and the settled history for the prior
 * session agree — and the difference is what actually changed overnight:
 *
 *     Δ = γ_now × OI × S_now²  −  γ_prev × OI × S_prev²
 *
 * i.e. how each strike's dealer gamma RE-PRICED as spot moved overnight. That
 * is the premarket question ("where did the gamma migrate to"), and it is clean
 * — no double-counted session, no volume artifact. Hence `basis=oi` by default.
 *
 * `basis=oivol` is still served for callers that want the printed-everywhere
 * number and understand the artifact above. Do not make it the default.
 *
 * PER-STRIKE LEGS ARE ALWAYS SHIPPED (2026-08-24). `byStrike` stays on the
 * REQUESTED basis and is unchanged, but the response now also carries
 * `byStrikeOi` and `byStrikeVol` — the two legs, per strike, every time. The
 * totals already worked this way ("both totals always present, so a caller can
 * switch basis without a refetch"); the per-strike map did not, so a client
 * with a basis SWITCH had to refetch on every click or — worse — diff a
 * vol-basis live side against an OI-basis baseline and print a number that is
 * pure basis mismatch. The premarket Key Levels tiles have such a switch
 * (OI · OI+VOL · VOL) and read these two maps directly. Additive only:
 * `byStrike` keeps its old meaning, so nothing that predates this cares.
 *
 * ── THE CLOSE CAPTURE (2026-08-24) — READ THIS FIRST ────────────────────────
 * Everything above describes building the baseline from settled ThetaData
 * history. THAT SOURCE IS GONE. ThetaData was removed on 2026-08-18 and
 * server-v2/tt-snapshot.js now stubs fetchIndexEodTheta / fetchStockEodTheta /
 * fetchOiHistoryTheta / fetchGreeksEodHistoryTheta / fetchEodHistoryTheta to
 * benign empties, so eod-gex-recorder's computeHistoricalGexRows() throws
 * "no settle spot for <date>" on EVERY call. buildBaseline() therefore always
 * threw, getBaseline() walked back three sessions and returned ok:false, and
 * the page's "Biggest GEX Changes" card has been permanently empty ever since
 * — the same silent-deadlock shape as the localStorage snapshot it replaced,
 * one layer down.
 *
 * Nothing else in the repo could stand in for it either. The header above
 * already rules out eod_gex (scalars) and eod_strike_gex (every expiry
 * collapsed onto one strike, 0DTE dropped); option_strike_gex_history is
 * per-expiry but its SPX writer only ever writes the FRONT expiry, so the prior
 * session never held a ladder of the expiry this page shows; premarket_freeze
 * stores exactly one expiry — the one the snapshot was rendering, i.e. that
 * day's 0DTE. There is no table anywhere holding "yesterday's ladder for
 * today's expiry".
 *
 * So it is now RECORDED rather than reconstructed. captureSession() runs at
 * 16:05 ET (catch-up window open to 22:00 ET) and, for the next few listed
 * expirations, pulls the live TastyTrade chain through tt-snapshot, runs the
 * SAME computeGexRowsMultiExpiry the rest of the app runs, and writes the
 * result straight into the two tables below keyed `date = today`. The next
 * morning readCached() finds it on the first try and no build is attempted.
 *
 * Three consequences worth knowing:
 *   · The Theta path is KEPT as a fallback, unchanged. If DATA_SOURCE goes back
 *     to theta it starts working again and can still backfill older dates.
 *   · There is a ONE SESSION cold start — the first capture happens at the next
 *     close, and no amount of cleverness recovers a ladder nobody stored. The
 *     card says that out loud rather than showing a dash.
 *   · It captures the next THREE expirations, not one, so a page showing a
 *     non-0DTE front expiry (holiday weeks) and a recorder that missed a day
 *     both still have a board to diff against.
 *
 * ── SHAPE ───────────────────────────────────────────────────────────────────
 * Two tables, both keyed (date, symbol, expiry): `premarket_baseline` holds the
 * strikes, `premarket_baseline_meta` the derived scalars (spot, total, flip,
 * walls) so a consumer that only wants the header does not read 200 rows.
 * `date` is the SESSION THE SNAPSHOT DESCRIBES — the prior close — not the day
 * it was computed.
 *
 * Read path:  GET /api/premarket-baseline   (api-router.js, auth 'subscriber')
 * No /proxy/* route and no server-with-proxy.js edit: this module is required
 * directly by the in-process api-router.
 *
 * No-ops cleanly without DATABASE_URL — getBaseline() still computes and serves
 * the answer, it just cannot cache it between restarts.
 */

const {
  computeGexRowsMultiExpiry, totalNetGex, findGexFlip, findCallWall, findPutWall,
} = require('./computation/gex-calculator');

// eod-gex-recorder owns the settled-history sweep (ThetaData OI + greeks + EOD
// prices, with a Black-Scholes fallback for strikes Theta has no greek for) and
// exports it. gex-levels-history-recorder.js requires it the same way for its
// own catch-up pass, so this is an established edge and not a new coupling.
// It does NOT require this module back — no cycle.
const { computeHistoricalGexRows } = require('./eod-gex-recorder');

const DEFAULT_SYMBOL = '$SPX';

/** How many sessions of baselines to keep. Tiny table; generous is free. */
const RETAIN_DAYS = (() => {
  const n = Math.floor(Number(process.env.PREMARKET_BASELINE_RETAIN_DAYS));
  // Interpolated into SQL below, so it must be a plain positive integer or the
  // DELETE becomes a syntax error that only shows up as a silent prune failure.
  return Number.isFinite(n) && n > 0 ? n : 45;
})();

/**
 * If the immediately prior session has no usable settled data (a Theta gap, a
 * half-day, an expiry that was not listed yet), walk back this many further
 * sessions before giving up. The response reports which date it landed on.
 */
const MAX_WALKBACK = 3;

/** Market holidays — keep in sync with eod-gex-recorder.js / mvc-auto-snapshot.js. */
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── ET helpers ───────────────────────────────────────────────────────────────

function etDateStr(d = new Date()) {
  // en-CA formats as YYYY-MM-DD, which is what every date column here stores.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function isTradingDay(dateStr) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' })
    .format(new Date(`${dateStr}T12:00:00Z`));
  if (wd === 'Sat' || wd === 'Sun') return false;
  return !MARKET_HOLIDAYS.has(dateStr);
}

/** Previous trading day for a YYYY-MM-DD (skips weekends + holidays). */
function prevTradingDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  for (let i = 0; i < 10; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const iso = d.toISOString().slice(0, 10);
    if (isTradingDay(iso)) return iso;
  }
  return null;
}

/**
 * Allowlist, not a passthrough. This is a `subscriber` route whose miss path
 * starts a full settled-chain ThetaData sweep, so an arbitrary `symbol` is an
 * arbitrary amount of upstream work per request — and each distinct value is a
 * distinct de-dupe key, so nothing coalesces a loop over them. Matches the
 * page's own SYMBOLS list.
 */
const ALLOWED_SYMBOLS = new Set(['$SPX', 'SPY', 'QQQ']);

function normSymbol(sym) {
  const s = String(sym ?? '').trim().toUpperCase();
  if (!s || s === 'SPX' || s === '$SPX') return DEFAULT_SYMBOL;
  return ALLOWED_SYMBOLS.has(s) ? s : null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// ── PG pool (same lazy, no-DB-safe pattern as eod-gex-recorder.js) ───────────

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
      max: 3,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
        ? false
        : { rejectUnauthorized: false },
    });
    pool.on('error', (e) => console.warn('[premarket-baseline] pool error:', e.message));
    return pool;
  } catch (e) {
    console.warn('[premarket-baseline] pg unavailable — running cache-less:', e.message);
    pgUnavailable = true;
    return null;
  }
}

let _schemaJob = null;

async function ensureSchema() {
  if (_schemaReady) return getPool();
  // CREATE TABLE / CREATE INDEX ... IF NOT EXISTS are NOT race-free in Postgres:
  // two concurrent runs hit `duplicate key ... pg_type_typname_nsp_index`. The
  // first caller after a cold start owns the DDL and everyone else awaits it.
  if (_schemaJob) return _schemaJob;
  _schemaJob = (async () => runSchema())().finally(() => { _schemaJob = null; });
  return _schemaJob;
}

async function runSchema() {
  const p = getPool();
  if (!p) return null;
  await p.query(`
    CREATE TABLE IF NOT EXISTS premarket_baseline (
      date    DATE             NOT NULL,
      symbol  TEXT             NOT NULL,
      expiry  TEXT             NOT NULL,
      strike  DOUBLE PRECISION NOT NULL,
      net_gex DOUBLE PRECISION NOT NULL,
      oi_gex  DOUBLE PRECISION,
      vol_gex DOUBLE PRECISION,
      PRIMARY KEY (date, symbol, expiry, strike)
    )
  `);
  // The read is always "the one snapshot for this symbol+expiry, newest session
  // at or before X", so lead with symbol+expiry and sort descending by date.
  await p.query(`CREATE INDEX IF NOT EXISTS idx_pmk_baseline_lookup
                 ON premarket_baseline (symbol, expiry, date DESC)`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS premarket_baseline_meta (
      date          DATE             NOT NULL,
      symbol        TEXT             NOT NULL,
      expiry        TEXT             NOT NULL,
      spot          DOUBLE PRECISION,
      total_net_gex DOUBLE PRECISION,
      total_oi_gex  DOUBLE PRECISION,
      total_vol_gex DOUBLE PRECISION,
      flip          DOUBLE PRECISION,
      call_wall     DOUBLE PRECISION,
      put_wall      DOUBLE PRECISION,
      strikes       INTEGER          NOT NULL DEFAULT 0,
      source        TEXT,
      computed_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol, expiry)
    )
  `);
  _schemaReady = true;
  return p;
}

// ── settled-sweep cache ──────────────────────────────────────────────────────
//
// computeHistoricalGexRows sweeps the WHOLE settled chain (strikeRange 500,
// every expiration) — the expensive part by a wide margin. A morning that has
// to build more than one expiry (SPX 0DTE plus a front expiry for a holiday
// week, say) should pay for exactly one sweep, so the flatRows are held briefly
// and then dropped. Deliberately ONE entry and a short TTL: these arrays are
// large and this is a burst-coalescer, not a cache.

const SWEEP_TTL_MS = 10 * 60_000;
let _sweep = null;         // { key, at, spot, flatRows }
const _sweepInflight = new Map();

async function sweepSettled(symbol, session) {
  const key = `${symbol}|${session}`;
  if (_sweep && _sweep.key === key && Date.now() - _sweep.at < SWEEP_TTL_MS) {
    return { spot: _sweep.spot, flatRows: _sweep.flatRows };
  }
  if (_sweepInflight.has(key)) return _sweepInflight.get(key);

  const job = (async () => {
    const { spot, flatRows } = await computeHistoricalGexRows(symbol, session);
    _sweep = { key, at: Date.now(), spot, flatRows };
    return { spot, flatRows };
  })().finally(() => _sweepInflight.delete(key));

  _sweepInflight.set(key, job);
  return job;
}

// ── build ────────────────────────────────────────────────────────────────────

/** Per-strike rows in the response/table shape, from one expiry's flatRows. */
function rowsFor(flatRows, spot, expiry) {
  const forExpiry = flatRows.filter((r) => r.expiration === expiry);
  if (!forExpiry.length) return null;
  // Single expiry by construction, so the multi-expiry helper is a no-op here.
  // Used anyway so this and eod-gex-recorder's 0DTE total stay provably the
  // same math — see zeroDteTotalFromFlatRows for the same note.
  const gexRows = computeGexRowsMultiExpiry(forExpiry, spot);
  if (!gexRows.length) return null;
  return gexRows;
}

const _buildInflight = new Map();

/**
 * Known-missing (symbol|session|expiry) keys. Without this, an expiry the
 * settled history genuinely lacks costs FOUR full chain sweeps on every single
 * page load: the walk-back evicts the one-entry `_sweep` as it goes, so nothing
 * is warm the next time round, and `_buildInflight` only coalesces requests
 * that overlap in time. Short TTL — a Theta gap that fills should self-heal
 * within a few minutes.
 */
const MISS_TTL_MS = 5 * 60_000;
const _misses = new Map();

function isMiss(key) {
  const at = _misses.get(key);
  if (at == null) return false;
  if (Date.now() - at < MISS_TTL_MS) return true;
  _misses.delete(key);
  return false;
}

function noteMiss(key) {
  _misses.set(key, Date.now());
  if (_misses.size > 200) {
    for (const k of _misses.keys()) { _misses.delete(k); if (_misses.size <= 100) break; }
  }
}

/**
 * Compute AND persist the baseline for one (symbol, session, expiry).
 * Throws when the settled chain has no rows for that expiry on that session.
 */
async function buildBaseline(symbol, session, expiry) {
  const key = `${symbol}|${session}|${expiry}`;
  if (_buildInflight.has(key)) return _buildInflight.get(key);

  const job = (async () => {
    const { spot, flatRows } = await sweepSettled(symbol, session);
    const gexRows = rowsFor(flatRows, spot, expiry);
    if (!gexRows) {
      throw new Error(`${symbol}: no ${expiry} rows in the ${session} settled chain`);
    }

    const strikes = gexRows
      .map((r) => ({
        strike: Number(r.strike),
        oi: Number(r.netGEX ?? 0),
        vol: Number(r.netVolGEX ?? 0),
      }))
      .filter((r) => Number.isFinite(r.strike) && r.strike > 0)
      .sort((a, b) => a.strike - b.strike);

    const meta = {
      date: session,
      symbol,
      expiry,
      spot: Number(spot),
      // Flip/walls are on the OI+Vol basis because that is what findGexFlip /
      // findCallWall / findPutWall consume (oiVolNet) everywhere else in the
      // app. Keeping them on the app's basis matters more than matching the
      // per-strike default here — they are levels, not deltas, so the volume
      // artifact described in the header does not apply to them.
      totalNetGex: totalNetGex(gexRows),
      totalOiGex: strikes.reduce((s, r) => s + r.oi, 0),
      totalVolGex: strikes.reduce((s, r) => s + r.vol, 0),
      flip: findGexFlip(gexRows, spot),
      callWall: findCallWall(gexRows, spot),
      putWall: findPutWall(gexRows, spot),
      strikes: strikes.length,
      source: 'theta-settled',
    };

    await persist(meta, strikes);
    return { meta, strikes };
  })().finally(() => _buildInflight.delete(key));

  _buildInflight.set(key, job);
  return job;
}

/**
 * Cache the computed baseline. NEVER throws: the caller already holds the
 * answer, and a DB blip must not turn a good build into "no prior-session
 * board" — which is exactly what it would look like, because buildBaseline's
 * rejection is indistinguishable from a Theta gap and sends getBaseline
 * walking back through three more full chain sweeps.
 */
async function persist(meta, strikes) {
  let p = null;
  let client = null;
  try {
    p = await ensureSchema();
    if (!p) return;                 // no DB — served, just not cached
    client = await p.connect();
  } catch (e) {
    console.warn('[premarket-baseline] cache unavailable:', e.message);
    if (client) client.release();
    return;
  }

  try {
    await client.query('BEGIN');

    // Upsert rather than DELETE-then-INSERT: two processes building the same
    // key would both see an empty table after their DELETE and the loser would
    // take a PK violation and throw its work away.
    const CHUNK = 1000;             // 7 params/row — well under the 65535 bind cap
    for (let i = 0; i < strikes.length; i += CHUNK) {
      const slice = strikes.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      let n = 0;
      for (const r of slice) {
        values.push(`($${++n}, $${++n}, $${++n}, $${++n}, $${++n}, $${++n}, $${++n})`);
        params.push(meta.date, meta.symbol, meta.expiry, r.strike, r.oi + r.vol, r.oi, r.vol);
      }
      await client.query(
        `INSERT INTO premarket_baseline (date, symbol, expiry, strike, net_gex, oi_gex, vol_gex)
         VALUES ${values.join(', ')}
         ON CONFLICT (date, symbol, expiry, strike) DO UPDATE SET
           net_gex = EXCLUDED.net_gex,
           oi_gex  = EXCLUDED.oi_gex,
           vol_gex = EXCLUDED.vol_gex`,
        params
      );
    }

    // Strikes a previous build wrote that this one no longer lists (a narrower
    // settled band, a delisted strike) would otherwise linger and be diffed
    // against forever.
    if (strikes.length) {
      await client.query(
        `DELETE FROM premarket_baseline
          WHERE date = $1 AND symbol = $2 AND expiry = $3
            AND NOT (strike = ANY($4::double precision[]))`,
        [meta.date, meta.symbol, meta.expiry, strikes.map((r) => r.strike)]
      );
    }

    await client.query(
      `INSERT INTO premarket_baseline_meta
         (date, symbol, expiry, spot, total_net_gex, total_oi_gex, total_vol_gex,
          flip, call_wall, put_wall, strikes, source, computed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       ON CONFLICT (date, symbol, expiry) DO UPDATE SET
         spot = EXCLUDED.spot,
         total_net_gex = EXCLUDED.total_net_gex,
         total_oi_gex = EXCLUDED.total_oi_gex,
         total_vol_gex = EXCLUDED.total_vol_gex,
         flip = EXCLUDED.flip,
         call_wall = EXCLUDED.call_wall,
         put_wall = EXCLUDED.put_wall,
         strikes = EXCLUDED.strikes,
         source = EXCLUDED.source,
         computed_at = now()`,
      [meta.date, meta.symbol, meta.expiry, meta.spot, meta.totalNetGex,
        meta.totalOiGex, meta.totalVolGex, meta.flip, meta.callWall, meta.putWall,
        meta.strikes, meta.source]
    );
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* already gone */ }
    console.warn('[premarket-baseline] persist failed:', e.message);
  } finally {
    client.release();
  }

  prune().catch(() => {});
}

let _lastPrune = 0;
async function prune() {
  if (Date.now() - _lastPrune < 6 * 3600_000) return;
  _lastPrune = Date.now();
  const p = getPool();
  if (!p) return;
  const cutoff = `CURRENT_DATE - INTERVAL '${RETAIN_DAYS} days'`;
  await p.query(`DELETE FROM premarket_baseline WHERE date < ${cutoff}`);
  await p.query(`DELETE FROM premarket_baseline_meta WHERE date < ${cutoff}`);
}

// ── read ─────────────────────────────────────────────────────────────────────

async function readCached(symbol, session, expiry) {
  const p = await ensureSchema();
  if (!p) return null;
  const { rows: metaRows } = await p.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, symbol, expiry, spot,
            total_net_gex, total_oi_gex, total_vol_gex,
            flip, call_wall, put_wall, strikes, source, computed_at
       FROM premarket_baseline_meta
      WHERE date = $1 AND symbol = $2 AND expiry = $3`,
    [session, symbol, expiry]
  );
  if (!metaRows.length) return null;
  const m = metaRows[0];
  const { rows: strikeRows } = await p.query(
    `SELECT strike, net_gex, oi_gex, vol_gex
       FROM premarket_baseline
      WHERE date = $1 AND symbol = $2 AND expiry = $3
      ORDER BY strike`,
    [session, symbol, expiry]
  );
  if (!strikeRows.length) return null;
  return {
    meta: {
      date: m.date, symbol: m.symbol, expiry: m.expiry, spot: num(m.spot),
      totalNetGex: num(m.total_net_gex), totalOiGex: num(m.total_oi_gex),
      totalVolGex: num(m.total_vol_gex), flip: num(m.flip),
      callWall: num(m.call_wall), putWall: num(m.put_wall),
      strikes: Number(m.strikes) || strikeRows.length,
      source: m.source, computedAt: m.computed_at,
    },
    strikes: strikeRows.map((r) => ({
      strike: Number(r.strike), oi: num(r.oi_gex) ?? 0, vol: num(r.vol_gex) ?? 0,
    })),
  };
}

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The one entry point.
 *
 * @param {object}  opts
 * @param {string} [opts.symbol='$SPX']
 * @param {string}  opts.expiry     YYYY-MM-DD — the expiry the PAGE is showing.
 * @param {string} [opts.today]     YYYY-MM-DD ET; the baseline is the prior session.
 * @param {string} [opts.basis='oi']  'oi' | 'oivol' — see the header.
 * @param {boolean}[opts.build=true]  false = cache-only (no Theta sweep).
 *
 * @returns {Promise<object>} the /api/premarket-baseline body.
 */
async function getBaseline({
  symbol: symIn = DEFAULT_SYMBOL, expiry, today: todayIn, basis: basisIn = 'oi',
  build = true,
} = {}) {
  const symbol = normSymbol(symIn);
  const basis = basisIn === 'oivol' ? 'oivol' : 'oi';

  if (!symbol) {
    return { ok: false, error: `symbol must be one of ${[...ALLOWED_SYMBOLS].join(', ')}`, basis };
  }
  if (!YMD.test(String(expiry || ''))) {
    return { ok: false, error: 'expiry required (YYYY-MM-DD)', symbol, basis };
  }

  // `today` is a caller convenience (testing, a client whose clock disagrees),
  // not a history browser — an unbounded value would let one request sweep any
  // date Theta carries. Anything outside a few days of now falls back to now.
  const nowEt = etDateStr();
  let today = nowEt;
  if (YMD.test(String(todayIn || ''))) {
    const drift = Math.abs(Date.parse(`${todayIn}T12:00:00Z`) - Date.parse(`${nowEt}T12:00:00Z`));
    if (Number.isFinite(drift) && drift <= 7 * 86400_000) today = todayIn;
  }

  const tried = [];
  let session = prevTradingDay(today);

  for (let i = 0; session && i <= MAX_WALKBACK; i++) {
    tried.push(session);

    // An expiry that already expired on or before the candidate session can
    // never be the page's live expiry — bail rather than walking back further
    // into dates where it does not exist either.
    if (expiry < session) break;

    const missKey = `${symbol}|${session}|${expiry}`;
    let hit = null;
    try {
      hit = await readCached(symbol, session, expiry);
    } catch (e) {
      console.warn('[premarket-baseline] cache read failed:', e.message);
    }

    if (!hit && build && !isMiss(missKey)) {
      try {
        hit = await buildBaseline(symbol, session, expiry);
      } catch (e) {
        // Theta gap / expiry not listed that session — try the session before.
        noteMiss(missKey);
        console.warn(`[premarket-baseline] ${symbol} ${session} ${expiry}: ${e.message}`);
      }
    }

    if (hit) return shape(hit, { symbol, expiry, today, basis, tried });

    session = prevTradingDay(session);
  }

  return {
    ok: false,
    symbol, expiry, basis,
    date: null,
    error: build
      // Named precisely, because the two causes need different reactions: a
      // board that was never captured heals by itself at the next close, a
      // Theta gap does not.
      ? 'no prior-session board for this expiry — the close capture writes it at 16:05 ET'
      : 'not cached',
    tried,
  };
}

function shape({ meta, strikes }, { symbol, expiry, today, basis, tried }) {
  const pick = basis === 'oivol' ? (r) => r.oi + r.vol : (r) => r.oi;
  const byStrike = {};
  // Both legs, always — see PER-STRIKE LEGS in the header. Built in the same
  // pass as `byStrike` so a caller that switches basis never refetches, and can
  // never accidentally diff one basis against another.
  const byStrikeOi = {};
  const byStrikeVol = {};
  for (const r of strikes) {
    const k = String(r.strike);
    byStrike[k] = pick(r);
    byStrikeOi[k] = r.oi;
    byStrikeVol[k] = r.vol;
  }
  const total = basis === 'oivol'
    ? (meta.totalNetGex ?? (meta.totalOiGex ?? 0) + (meta.totalVolGex ?? 0))
    : meta.totalOiGex;

  return {
    ok: true,
    symbol,
    expiry,
    /** The session this baseline DESCRIBES — the prior close. */
    date: meta.date,
    /** The ET date the caller asked "prior to". */
    asOf: today,
    basis,
    spot: meta.spot,
    /** Net GEX on the requested basis — compare against the live same-basis sum. */
    netGex: total,
    /** Both totals always present, so a caller can switch basis without a refetch. */
    totalOiGex: meta.totalOiGex,
    totalVolGex: meta.totalVolGex,
    totalNetGex: meta.totalNetGex,
    /** Levels are OI+Vol regardless of `basis` — see the header. */
    flip: meta.flip,
    callWall: meta.callWall,
    putWall: meta.putWall,
    strikes: meta.strikes,
    byStrike,
    /**
     * The two legs, per strike, on EVERY response regardless of `basis`.
     *   oi  → γ × OI     × S²   (compare against the live chain's OI leg)
     *   vol → γ × Volume × S²   (compare against netGEXOf(row, "vol", spot))
     * OI+Vol for a strike is their sum. A client with a basis switch reads
     * these; `byStrike` above stays on the requested basis for older callers.
     */
    byStrikeOi,
    byStrikeVol,
    source: meta.source,
    computedAt: meta.computedAt ?? null,
    /** More than one entry means the immediately prior session had no data. */
    tried,
  };
}

// ── THE CLOSE CAPTURE ────────────────────────────────────────────────────────
//
// See "THE CLOSE CAPTURE" in the header for why this exists at all. In short:
// the settled-history source this module was built on no longer answers, so the
// prior-session board is now WRITTEN at the close instead of reconstructed the
// next morning.

/** Runs at 16:05 ET; the window stays open so a late restart still captures. */
const CAPTURE_AT_MIN = 16 * 60 + 5;
const CAPTURE_CLOSE_MIN = 22 * 60;

/**
 * How many listed expirations forward to store. ONE would be enough on a normal
 * Monday→Tuesday, and is wrong the moment the page is not on a 0DTE (holiday
 * weeks, an expiry that is not listed daily) or the recorder misses a session.
 * Three is two spare boards for a few hundred rows each.
 */
const CAPTURE_EXPIRIES = (() => {
  const n = Math.floor(Number(process.env.PREMARKET_BASELINE_CAPTURE_EXPIRIES));
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : 3;
})();

/** Matches the page's symbol picker, filtered through the same allowlist. */
const CAPTURE_SYMBOLS = String(
  process.env.PREMARKET_BASELINE_CAPTURE_SYMBOLS || '$SPX,SPY,QQQ')
  .split(',').map((s) => normSymbol(s)).filter(Boolean);

/** Politeness gap between chain pulls so one capture never bursts the proxy. */
const CAPTURE_PACE_MS = Math.max(0,
  Number(process.env.PREMARKET_BASELINE_CAPTURE_PACE_MS) || 400);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * tt-snapshot is required LAZILY. It pulls in proxy-tastytrade, which is a
 * heavy module with its own boot side effects, and this file is required by
 * api-router at module-load time — eagerly requiring it here would reorder that
 * boot for every process that merely serves the READ path. Nothing in the read
 * path touches it.
 */
let _tt = null;
function ttSnapshot() {
  if (!_tt) _tt = require('./tt-snapshot');
  return _tt;
}

/** Spot for the capture. Index roots quote as an index; SPY/QQQ as equities. */
async function captureSpot(symbol) {
  const tt = ttSnapshot();
  if (symbol === DEFAULT_SYMBOL) {
    const px = await tt.fetchIndexPriceTheta('SPX');
    return Number(px) > 0 ? Number(px) : null;
  }
  const q = await tt.fetchStockQuoteTheta(symbol);
  const px = Number(q?.last) || Number(q?.mark) || Number(q?.close);
  return px > 0 ? px : null;
}

/**
 * One expiry's per-strike GEX rows off the LIVE chain.
 *
 * The three maps come from one upstream `/market-data/by-type` fetch (tt-
 * snapshot coalesces them for 4s) and are keyed identically — `exp|strike|type`
 * — so they line up by construction rather than by matching on floats.
 *
 * The key union is deliberate: TastyTrade can carry OI on a strike whose greeks
 * are momentarily absent and vice versa, and iterating either map alone drops
 * those strikes silently. A missing gamma contributes zero, which is the honest
 * answer for a strike we cannot price; a missing OI likewise.
 */
async function liveExpiryRows(symbol, expiry, spot) {
  const tt = ttSnapshot();
  const [oiMap, volMap, grkMap] = await Promise.all([
    tt.fetchOpenInterestTheta(symbol, expiry),
    tt.fetchVolumeTheta(symbol, expiry),
    tt.fetchGreeksTheta(symbol, expiry),
  ]);

  const keys = new Set([...oiMap.keys(), ...grkMap.keys(), ...volMap.keys()]);
  const flat = [];
  for (const k of keys) {
    // keyOf() is `${exp}|${strike}|${type}` and none of the three parts can
    // contain a pipe, so a plain split is exact.
    const [, strikeStr, type] = String(k).split('|');
    const strike = Number(strikeStr);
    if (!(strike > 0) || (type !== 'C' && type !== 'P')) continue;
    const g = grkMap.get(k) || {};
    flat.push({
      expiration: expiry,
      strike,
      side: type === 'C' ? 'call' : 'put',
      oi: Number(oiMap.get(k)?.oi ?? 0),
      volume: Number(volMap.get(k) ?? 0),
      gamma: Number(g.gamma ?? 0),
      delta: Number(g.delta ?? 0),
      iv: Number(g.iv ?? 0),
      mark: Number(g.mark ?? 0),
    });
  }
  if (!flat.length) return null;

  // Same helper the Theta path used, for the same reason: this and every other
  // GEX number in the app must be provably the same math.
  const gexRows = computeGexRowsMultiExpiry(flat, spot);
  return gexRows.length ? gexRows : null;
}

/** Turn gexRows into the (meta, strikes) pair `persist` wants and store it. */
async function storeRows(symbol, session, expiry, spot, gexRows) {
  const strikes = gexRows
    .map((r) => ({
      strike: Number(r.strike),
      oi: Number(r.netGEX ?? 0),
      vol: Number(r.netVolGEX ?? 0),
    }))
    .filter((r) => Number.isFinite(r.strike) && r.strike > 0)
    // A strike that prices to exactly zero on BOTH legs was not priced at all —
    // TastyTrade was missing its gamma on this pull, or it carries no OI and no
    // volume. Storing that zero is worse than storing nothing: `strikeDeltas`
    // on the page skips strikes the baseline never listed, but a listed ZERO is
    // diffed, so tomorrow the strike would print its entire live gamma as
    // overnight "change". Two floats cancelling to an exact 0 does not happen.
    .filter((r) => r.oi !== 0 || r.vol !== 0)
    .sort((a, b) => a.strike - b.strike);
  if (!strikes.length) return null;

  const meta = {
    date: session,
    symbol,
    expiry,
    spot: Number(spot),
    totalNetGex: totalNetGex(gexRows),
    totalOiGex: strikes.reduce((s, r) => s + r.oi, 0),
    totalVolGex: strikes.reduce((s, r) => s + r.vol, 0),
    flip: findGexFlip(gexRows, spot),
    callWall: findCallWall(gexRows, spot),
    putWall: findPutWall(gexRows, spot),
    strikes: strikes.length,
    // Distinguishable from 'theta-settled' in the meta table and in the API
    // response, so a board's provenance is never a guess.
    source: 'tt-close',
  };
  await persist(meta, strikes);
  return { meta, strikes };
}

/**
 * Capture every symbol's next few expirations for ONE session.
 * Returns how many (symbol, expiry) boards were written.
 *
 * Never throws: a capture is best-effort by nature (one symbol's chain being
 * briefly unavailable must not cost the other two theirs), and the only caller
 * is a timer.
 */
async function captureSession(session = etDateStr()) {
  const tt = ttSnapshot();
  let written = 0;

  for (const symbol of CAPTURE_SYMBOLS) {
    let spot = null;
    let expirations = [];
    try {
      const [px, chain] = await Promise.all([
        captureSpot(symbol),
        tt.fetchChainTheta(symbol),
      ]);
      spot = px;
      expirations = chain?.expirations || [];
    } catch (e) {
      console.warn(`[premarket-baseline] capture ${symbol}: chain unavailable — ${e.message}`);
      continue;
    }
    if (!(Number(spot) > 0)) {
      console.warn(`[premarket-baseline] capture ${symbol}: no spot, skipped`);
      continue;
    }

    // Strictly AFTER the session being captured. Today's expiry has already
    // expired by 16:05 and would store a ladder of zeros — the same reason
    // eod-strike-gex-recorder drops it.
    const targets = [...new Set(expirations.map(String))]
      .filter((e) => YMD.test(e) && e > session)
      .sort()
      .slice(0, CAPTURE_EXPIRIES);

    for (const expiry of targets) {
      try {
        const gexRows = await liveExpiryRows(symbol, expiry, spot);
        if (!gexRows) {
          console.warn(`[premarket-baseline] capture ${symbol} ${expiry}: empty chain`);
          continue;
        }
        const out = await storeRows(symbol, session, expiry, spot, gexRows);
        if (out) {
          written++;
          console.log(`[premarket-baseline] captured ${symbol} ${session} → ${expiry} (${out.meta.strikes} strikes)`);
        }
      } catch (e) {
        console.warn(`[premarket-baseline] capture ${symbol} ${expiry} failed: ${e.message}`);
      }
      if (CAPTURE_PACE_MS) await sleep(CAPTURE_PACE_MS);
    }
  }

  return written;
}

let _capturedFor = null;
/**
 * The tick fires every 5 minutes and a full capture (3 symbols × 3 expiries,
 * paced) can outlast that on a slow chain. Without this a second run would
 * start mid-flight, double every upstream pull and race the first one's upserts
 * for the same primary keys.
 */
let _capturing = false;

async function captureTick() {
  if (_capturing) return;
  try {
    if (process.env.PREMARKET_BASELINE_CAPTURE === '0') return;
    if (!CAPTURE_SYMBOLS.length) return;
    const today = etDateStr();
    if (_capturedFor === today) return;
    if (!isTradingDay(today)) return;
    const mins = etMinutes();
    if (mins < CAPTURE_AT_MIN || mins > CAPTURE_CLOSE_MIN) return;
    _capturing = true;
    const written = await captureSession(today);
    // Latch only on success, same as the warm-up: a 16:05 hiccup must not cost
    // the whole session's board when the window is open until 22:00.
    if (written > 0) _capturedFor = today;
  } catch (e) {
    console.warn('[premarket-baseline] capture tick failed:', e.message);
  } finally {
    _capturing = false;
  }
}

// ── warm-up ──────────────────────────────────────────────────────────────────
//
// Purely an optimisation: without it the first person to open the page in the
// morning waits on a full settled-chain sweep. With it that sweep has already
// happened. Never required for correctness — getBaseline() builds on demand.
// PREMARKET_BASELINE_WARMUP=0 disables.

const WARMUP_SYMBOL = normSymbol(process.env.PREMARKET_BASELINE_SYMBOL || DEFAULT_SYMBOL);
const WARMUP_OPEN_MIN = 6 * 60;        // 06:00 ET
const WARMUP_CLOSE_MIN = 9 * 60 + 35;  // 09:35 ET
let _warmTimer = null;
let _warmedFor = null;

function etMinutes(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return Number(p.hour) * 60 + Number(p.minute);
}

async function warmTick() {
  try {
    const today = etDateStr();
    if (_warmedFor === today) return;
    if (!isTradingDay(today)) return;
    const mins = etMinutes();
    if (mins < WARMUP_OPEN_MIN || mins > WARMUP_CLOSE_MIN) return;
    // The page pins today's 0DTE, and SPX lists an expiry every session, so
    // today's date IS the expiry to warm. Anything else builds on demand.
    const r = await getBaseline({ symbol: WARMUP_SYMBOL, expiry: today, today });
    if (r.ok) {
      // Only latch on success — a Theta hiccup at 06:05 must not cost the whole
      // morning's warm-up. getBaseline() de-dupes concurrent builds, so
      // retrying every 5 min until it lands is cheap.
      _warmedFor = today;
      console.log(`[premarket-baseline] warmed ${WARMUP_SYMBOL} ${today} from ${r.date} (${r.strikes} strikes)`);
    } else {
      console.warn(`[premarket-baseline] warm-up found nothing for ${today}: ${r.error}`);
    }
  } catch (e) {
    console.warn('[premarket-baseline] warm-up failed:', e.message);
  }
}

/**
 * ONE timer for both jobs, deliberately.
 *
 * They are the two halves of the same thing — captureTick WRITES the board at
 * the close, warmTick READS it back the next morning — and their windows do not
 * overlap, so each tick is one cheap clock check and at most one job. Splitting
 * them into two intervals would double the wake-ups for no gain, and would let
 * PREMARKET_BASELINE_WARMUP=0 silently disable the capture as well, which is
 * exactly backwards: the capture is now the load-bearing half.
 */
function startPremarketBaseline() {
  if (_warmTimer) return;
  const tick = async () => {
    if (process.env.PREMARKET_BASELINE_WARMUP !== '0') await warmTick();
    await captureTick();
  };
  _warmTimer = setInterval(() => { tick().catch(() => {}); }, 5 * 60_000);
  if (typeof _warmTimer.unref === 'function') _warmTimer.unref();
  // Nudge once shortly after boot so a restart inside either window still runs.
  const kick = setTimeout(() => { tick().catch(() => {}); }, 30_000);
  if (typeof kick.unref === 'function') kick.unref();
}

module.exports = {
  getBaseline,
  buildBaseline,
  startPremarketBaseline,
  // exported for tests / manual pokes
  captureSession,
  prevTradingDay,
  etDateStr,
};
