'use strict';
/**
 * server-v2/far-cb-recorder.js
 *
 * "Watch This" scanner — finds the single highest OI+Vol net-GEX strike (the
 * "CB" level) across ALL expirations within FAR_CB_MAX_DTE_DAYS for each ticker
 * in the EM watchlist, and flags it when that strike sits unusually far OTM
 * (i.e. NOT the normal near-the-money CB) — % distance from spot > threshold.
 *
 * Answers: "is there a farther-out strike that's grown into the dominant GEX
 * level for this name, way outside where CB normally sits?"
 *
 * Basis: OI+Vol net GEX (netGEX + netVolGEX) — same canonical basis as
 * mvc-auto-snapshot.js / gex-calculator.js oiVolNet().
 *
 * Universe: the SCANNER universe (server-v2/scanner-tickers.js via
 * rosterStore.getSymbols('scanner')) plus customer-added tickers — see
 * far-cb-tickers.js getActiveRoster().
 *
 * Tables:
 *   far_cb_watch (date, symbol) — one row per ticker per day, upserted every
 *     sweep; only rows that ever crossed the OTM threshold are kept (a symbol
 *     that stops qualifying is deleted on its next sweep). Old dates pruned.
 *   far_cb_outcomes (symbol, strike, expiry) — the tracked flag itself.
 *   far_cb_contract_daily (symbol, strike, expiry, opt_type, date) — the daily
 *     PREMIUM for each tracked contract, from two writers:
 *       runContractProbe()    — NBBO mid on a FAR_CB_PROBE_MINS cadence during
 *                               RTH plus one pass after the close. Owns TODAY.
 *       runContractBackfill() — dxLink daily candles for past sessions (true
 *                               OHLC, so it outranks the probe's samples).
 *     Between them the premium history exists with no per-contract EOD feed.
 *
 * Wiring: startFarCbRecorder(PORT) from server-with-proxy.js.
 * Read:   GET  /proxy/far-cb-watch
 * Manual: POST /proxy/far-cb-watch-run      (force = bypass RTH gate)
 *         POST /proxy/far-cb-backfill-run   (?force=1 = ignore the covered marker)
 */

const { computeGexRows } = require('./computation/gex-calculator');
// Option data source. ThetaData was removed 2026-08-18 (see
// config/data-source.js); tt-snapshot is TastyTrade REST and is now the only
// provider. The *Theta-suffixed export names are kept because tt-snapshot is a
// drop-in with the same signatures — renaming them would touch every recorder
// for no behaviour change.
const _optSrc = require('./tt-snapshot');
const {
  fetchChainTheta,
  fetchGreeksTheta,
  fetchOpenInterestTheta,
  fetchVolumeTheta,
  fetchStockQuoteTheta,
  fetchIndexPriceTheta,
} = _optSrc;
const { getActiveRoster } = require('./far-cb-tickers');
const { fetchStockDailyHistoryTheta, fetchIndexDailyHistoryTheta } = _optSrc;

// Per-contract EOD history was the ONE leg TastyTrade cannot serve, so this
// used to call ThetaData directly (ungated, behind a 10-minute circuit breaker)
// even when DATA_SOURCE was tt.
//
// ThetaData is gone (2026-08-18) and so is that path. It had already been
// returning [] in practice — the breaker trips on the first failure — and
// dxLink is the better source anyway: fetchContractDailyBarsDx below replays
// the contract's own session bars with real OHLC + volume, verified 2026-08-11,
// rather than a single vendor EOD close. Callers already treat [] as "no bars"
// and fall back to the recorded daily probe.
async function fetchContractDailyBars() {
  return [];
}

// dxLink IS entitled for option Candle history on this account — verified
// 2026-08-11 against .FBL260821C23 and .SPY260821C640, both of which replayed a
// month of daily bars with real OHLC + volume. That makes dxLink the premium
// backfill source, and a better one than a vendor EOD close: these are the
// contract's own session bars, so a day carries a high and low, not one number.
// Read-only use of proxy-tastytrade + candle-history — neither file is modified.
const _candleHist = require('./candle-history');
const _tt = require('./proxy-tastytrade');

const INDEX_SYMBOLS = new Set(['SPX', 'NDX', 'VIX', 'RUT', 'XSP']);
const keyOf = (exp, strike, type) => `${exp}|${Number(strike)}|${type}`;
const oiVolNet = (r) => Number(r.netGEX ?? 0) + Number(r.netVolGEX ?? 0);
// Which contract a flag means: the OTM one at the strike. Strike ABOVE spot at
// the flag is an OTM CALL, strike BELOW spot is an OTM PUT — that is what "far
// OTM" meant when the row was written, and `side` already stores it.
//
// This used to key off the SIGN of gex_value_at_flag ("Call-side when >= 0"),
// which is a statement about dealer gamma at the strike, not about which
// contract is out of the money. A strike sitting well above spot with heavy put
// OI carries negative net GEX, so the tracker was quoting and charting an ITM
// put (e.g. IONQ $55P with spot at $46.52) instead of the $55 call the flag was
// about. Spot vs strike decides the type; the GEX sign is only a last-resort
// fallback for a row missing both `side` and `spot_at_flag`.
//
// One helper so the probe, the popup and the live quote enrichment can never
// disagree about which contract they mean.
const optTypeOf = (row) => {
  const side = row?.side;
  if (side === 'above') return 'C';
  if (side === 'below') return 'P';
  const strike = Number(row?.strike);
  const spot = Number(row?.spot_at_flag);
  if (Number.isFinite(strike) && Number.isFinite(spot) && spot > 0) {
    return strike >= spot ? 'C' : 'P';
  }
  return Number(row?.gex_value_at_flag) >= 0 ? 'C' : 'P';
};
// Theta's option-history routes select strikes by dollars-around-spot, so a
// far-OTM strike falls outside a default window — always pass the flag distance
// plus a cushion.
const strikeWindow = (strike, spotAtFlag) => Math.abs(Number(strike) - Number(spotAtFlag)) + 50;

// ── tunables (env-overridable) ───────────────────────────────────────────────

const SWEEP_MINS      = Number(process.env.FAR_CB_SWEEP_MINS || 30);
const MAX_DTE_DAYS     = Number(process.env.FAR_CB_MAX_DTE_DAYS || 30);
const OTM_THRESHOLD_PCT = Number(process.env.FAR_CB_OTM_PCT || 15); // "far OTM" cutoff
const STRIKE_RANGE_PCT = Number(process.env.FAR_CB_STRIKE_RANGE_PCT || 40); // ± around spot, %
const TICKER_DELAY_MS  = Number(process.env.FAR_CB_TICKER_DELAY_MS || 500);
const EXPIRY_DELAY_MS  = Number(process.env.FAR_CB_EXPIRY_DELAY_MS || 150);
const MAX_EXPIRIES     = Number(process.env.FAR_CB_MAX_EXPIRIES || 6); // cap Theta load/ticker
const RETENTION_DAYS   = Number(process.env.FAR_CB_RETENTION_DAYS || 7);
// How often the tracked contracts' premium is probed and written to
// far_cb_contract_daily during RTH. Each probe is one greeks snapshot per
// (symbol, expiry) that still has a live tracked flag — a handful of calls.
const PROBE_MINS       = Number(process.env.FAR_CB_PROBE_MINS || 15);
// How far back the dxLink premium backfill asks for daily bars. Also bounds
// which tracked flags are worth attempting — a flag older than this window has
// no candles left to fetch.
const BACKFILL_DAYS    = Number(process.env.FAR_CB_BACKFILL_DAYS || 60);
// Max contracts one backfill pass will walk. Each is its own short-lived dxLink
// connection taking a few seconds, so the pass is deliberately sequential.
const BACKFILL_LIMIT   = Number(process.env.FAR_CB_BACKFILL_LIMIT || 200);

const RTH_OPEN_MINS  = 9 * 60 + 30;
const RTH_CLOSE_MINS = 16 * 60;

const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── PG pool (same lazy pattern as oi-change-recorder.js) ─────────────────────

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
      console.warn('[far-cb] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[far-cb] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  if (_schemaReady) return true;
  const p = getPool();
  if (!p) return false;
  await p.query(`
    CREATE TABLE IF NOT EXISTS far_cb_watch (
      date        DATE              NOT NULL,
      symbol      TEXT              NOT NULL,
      strike      DOUBLE PRECISION  NOT NULL,
      expiry      TEXT              NOT NULL,
      gex_value   DOUBLE PRECISION  NOT NULL,
      spot        DOUBLE PRECISION  NOT NULL,
      otm_pct     DOUBLE PRECISION  NOT NULL,
      dte_days    INTEGER           NOT NULL,
      ts          TIMESTAMPTZ       NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_far_cb_watch_date ON far_cb_watch (date, otm_pct DESC);`);
  // Vol-only net GEX at the same flagged strike (companion to gex_value = OI+Vol).
  await p.query(`ALTER TABLE far_cb_watch ADD COLUMN IF NOT EXISTS gex_value_vol DOUBLE PRECISION;`);

  // Persistent outcome log — one row per (symbol, strike, expiry) ever flagged.
  // Not a win/loss grade, just the observed result: did spot ever reach that
  // strike before expiry, and how close did it get. Graded once daily after
  // close by runGrading().
  await p.query(`
    CREATE TABLE IF NOT EXISTS far_cb_outcomes (
      symbol            TEXT              NOT NULL,
      strike            DOUBLE PRECISION  NOT NULL,
      expiry            TEXT              NOT NULL,
      first_flagged     DATE              NOT NULL,
      spot_at_flag      DOUBLE PRECISION  NOT NULL,
      otm_pct_at_flag   DOUBLE PRECISION  NOT NULL,
      gex_value_at_flag DOUBLE PRECISION  NOT NULL,
      side              TEXT              NOT NULL,
      last_checked      DATE,
      last_spot         DOUBLE PRECISION,
      closest_pct       DOUBLE PRECISION,
      touched           BOOLEAN           NOT NULL DEFAULT FALSE,
      touched_date      DATE,
      status            TEXT              NOT NULL DEFAULT 'open',
      updated_at        TIMESTAMPTZ       NOT NULL DEFAULT now(),
      PRIMARY KEY (symbol, strike, expiry)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_far_cb_outcomes_status ON far_cb_outcomes (status, expiry);`);
  // When this flag's premium was last pulled from dxLink. Lets the backfill pass
  // skip contracts it has already covered — an expired one for good, a live one
  // until the next session adds a bar.
  await p.query(`ALTER TABLE far_cb_outcomes ADD COLUMN IF NOT EXISTS premium_backfilled_at TIMESTAMPTZ;`);

  // Daily premium probe for each tracked contract. This is OUR OWN recording of
  // the contract's price — not a vendor EOD series — so the row popup has a
  // premium history under any DATA_SOURCE, and keeps it after the contract
  // expires and stops quoting. `open` is the first probe of the session,
  // `close` the last, and high/low the extremes of the probes in between (probe
  // resolution, not true tick OHLC — `probes` says how many samples back it).
  await p.query(`
    CREATE TABLE IF NOT EXISTS far_cb_contract_daily (
      symbol     TEXT              NOT NULL,
      strike     DOUBLE PRECISION  NOT NULL,
      expiry     TEXT              NOT NULL,
      opt_type   TEXT              NOT NULL,
      date       DATE              NOT NULL,
      open       DOUBLE PRECISION,
      high       DOUBLE PRECISION,
      low        DOUBLE PRECISION,
      close      DOUBLE PRECISION,
      probes     INTEGER           NOT NULL DEFAULT 1,
      source     TEXT              NOT NULL DEFAULT 'probe',
      ts         TIMESTAMPTZ       NOT NULL DEFAULT now(),
      PRIMARY KEY (symbol, strike, expiry, opt_type, date)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_far_cb_contract_daily_lookup
                 ON far_cb_contract_daily (symbol, expiry, strike, opt_type, date);`);

  // ── one-time repair: contracts recorded under the wrong opt_type ───────────
  // Rows written while the type was inferred from the GEX sign point at the
  // opposite contract (an ITM put where the flag meant an OTM call, and the
  // mirror case). Drop those bars and clear premium_backfilled_at so the next
  // backfill pass refills the correct contract from dxLink.
  //
  // Self-limiting: once the wrong-typed bars are gone both statements match
  // nothing, so this is a no-op on every later boot.
  const CORRECT_TYPE_SQL = `CASE WHEN o.side = 'above' THEN 'C'
                                 WHEN o.side = 'below' THEN 'P'
                                 WHEN o.strike >= o.spot_at_flag THEN 'C'
                                 ELSE 'P' END`;
  try {
    const fixed = await p.query(`
      UPDATE far_cb_outcomes o
         SET premium_backfilled_at = NULL
       WHERE EXISTS (
         SELECT 1 FROM far_cb_contract_daily d
          WHERE d.symbol = o.symbol AND d.strike = o.strike AND d.expiry = o.expiry
            AND d.opt_type <> (${CORRECT_TYPE_SQL})
       )`);
    const dropped = await p.query(`
      DELETE FROM far_cb_contract_daily d
       USING far_cb_outcomes o
       WHERE d.symbol = o.symbol AND d.strike = o.strike AND d.expiry = o.expiry
         AND d.opt_type <> (${CORRECT_TYPE_SQL})`);
    if (fixed.rowCount || dropped.rowCount) {
      console.log(`[far-cb] opt_type repair — ${fixed.rowCount} flag(s) requeued, ${dropped.rowCount} wrong-side bar(s) dropped`);
    }
  } catch (e) {
    console.warn('[far-cb] opt_type repair skipped:', e.message);
  }

  _schemaReady = true;
  console.log(`[far-cb] schema ready — OTM threshold ${OTM_THRESHOLD_PCT}%, ${MAX_DTE_DAYS}d window`);
  return true;
}

// ── time helpers (mirrors strike-growth-recorder.js) ─────────────────────────

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

function daysBetween(fromYmd, toYmd) {
  const a = new Date(`${fromYmd}T12:00:00Z`);
  const b = new Date(`${toYmd}T12:00:00Z`);
  return Math.round((b - a) / 86400000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// pg DATE columns come back as JS Date objects built from LOCAL date parts
// (server tz). JSON.stringify then calls toISOString(), which reinterprets
// those local parts as UTC and shifts the clock (e.g. midnight ET -> "T04:00
// :00.000Z"), corrupting the calendar date shown to the user. Format using
// local getters (not UTC getters) so the string matches the true ET session
// date the row was written for.
function toYmd(d) {
  if (d == null) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── per-ticker scan ───────────────────────────────────────────────────────────

/**
 * Find the single highest |OI+Vol GEX| strike across all expiries within
 * MAX_DTE_DAYS for one ticker. Returns { strike, expiry, gexValue, spot,
 * otmPct, dteDays } or null if nothing usable.
 */
async function scanTicker(symbol) {
  let spot;
  if (INDEX_SYMBOLS.has(symbol.toUpperCase())) {
    spot = Number(await fetchIndexPriceTheta(symbol));
  } else {
    const quote = await fetchStockQuoteTheta(symbol);
    spot = Number(quote?.last ?? quote?.mark ?? 0);
  }
  if (!(spot > 0)) throw new Error(`spot 0 for ${symbol}`);

  const { contracts, expirations } = await fetchChainTheta(symbol);
  if (!expirations?.length) throw new Error(`no expirations ${symbol}`);

  const today = etDateStr();
  const targetExps = expirations
    .filter((e) => daysBetween(today, e) >= 0 && daysBetween(today, e) <= MAX_DTE_DAYS)
    .slice(0, MAX_EXPIRIES);
  if (!targetExps.length) throw new Error(`no expiries within ${MAX_DTE_DAYS}d for ${symbol}`);

  const loBound = spot * (1 - STRIKE_RANGE_PCT / 100);
  const hiBound = spot * (1 + STRIKE_RANGE_PCT / 100);

  let best = null; // { strike, expiry, gexValue, dteDays }

  for (const expiry of targetExps) {
    const expContracts = contracts.filter(
      (c) => c.expiration === expiry && c.strike >= loBound && c.strike <= hiBound
    );
    if (!expContracts.length) { await sleep(EXPIRY_DELAY_MS); continue; }

    let greekMap, oiMap, volMap;
    try {
      [greekMap, oiMap, volMap] = await Promise.all([
        fetchGreeksTheta(symbol, expiry).catch(() => new Map()),
        fetchOpenInterestTheta(symbol, expiry).catch(() => new Map()),
        fetchVolumeTheta(symbol, expiry).catch(() => new Map()),
      ]);
    } catch {
      await sleep(EXPIRY_DELAY_MS);
      continue;
    }

    const flatRows = [];
    for (const c of expContracts) {
      const k = keyOf(c.expiration, c.strike, c.type);
      const g = greekMap.get(k) || {};
      const oi = Number(oiMap.get(k)?.oi ?? 0);
      const vol = Number(volMap.get(k) ?? 0);
      const gamma = Math.abs(Number(g.gamma ?? 0));
      if (!(gamma > 0) && !(oi > 0) && !(vol > 0)) continue;
      flatRows.push({ strike: c.strike, side: c.type === 'C' ? 'call' : 'put', oi, volume: vol, gamma, delta: 0 });
    }

    if (flatRows.length) {
      const gexRows = computeGexRows(flatRows, spot);
      for (const r of gexRows) {
        const val = oiVolNet(r);
        if (!best || Math.abs(val) > Math.abs(best.gexValue)) {
          best = { strike: r.strike, expiry, gexValue: val, gexValueVol: Number(r.netVolGEX ?? 0), dteDays: daysBetween(today, expiry) };
        }
      }
    }
    await sleep(EXPIRY_DELAY_MS);
  }

  if (!best) return null;
  const otmPct = (Math.abs(best.strike - spot) / spot) * 100;
  return { ...best, spot, otmPct };
}

// ── persistence ───────────────────────────────────────────────────────────────

async function upsertOrClear(p, date, symbol, result) {
  if (result && result.otmPct > OTM_THRESHOLD_PCT) {
    await p.query(
      `INSERT INTO far_cb_watch (date, symbol, strike, expiry, gex_value, gex_value_vol, spot, otm_pct, dte_days, ts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
       ON CONFLICT (date, symbol) DO UPDATE SET
         strike = EXCLUDED.strike, expiry = EXCLUDED.expiry, gex_value = EXCLUDED.gex_value,
         gex_value_vol = EXCLUDED.gex_value_vol,
         spot = EXCLUDED.spot, otm_pct = EXCLUDED.otm_pct, dte_days = EXCLUDED.dte_days, ts = now()`,
      [date, symbol, result.strike, result.expiry, result.gexValue, result.gexValueVol ?? null, result.spot, result.otmPct, result.dteDays]
    );
    // Log this (symbol, strike, expiry) once — first time it's ever flagged.
    // Later sweeps that re-flag the same triple are no-ops here (ON CONFLICT
    // DO NOTHING); the daily grader is what evolves the row after that.
    const side = result.strike > result.spot ? 'above' : 'below';
    await p.query(
      `INSERT INTO far_cb_outcomes
         (symbol, strike, expiry, first_flagged, spot_at_flag, otm_pct_at_flag, gex_value_at_flag, side, last_checked, last_spot, closest_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$4,$5,$6)
       ON CONFLICT (symbol, strike, expiry) DO NOTHING`,
      [symbol, result.strike, result.expiry, date, result.spot, result.otmPct, result.gexValue, side]
    );
  } else {
    // No longer qualifies (or no data) — drop any stale row for today.
    await p.query(`DELETE FROM far_cb_watch WHERE date = $1 AND symbol = $2`, [date, symbol]);
  }
}

async function pruneOld(p) {
  await p.query(`DELETE FROM far_cb_watch WHERE date < CURRENT_DATE - INTERVAL '${RETENTION_DAYS} days'`);
}

// ── sweep ─────────────────────────────────────────────────────────────────────

async function runSweep(opts = {}) {
  const force = !!opts.force;
  if (!force && !isRthWindow()) return { skipped: 'outside RTH' };
  if (!(await ensureSchema())) return { skipped: 'no DB' };

  const p = getPool();
  const date = etDateStr();
  await pruneOld(p).catch((e) => console.warn('[far-cb] prune error:', e.message));

  const roster = (await getActiveRoster()).map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  console.log(`[far-cb] sweep ${date} — ${roster.length} symbols (curated + custom), OTM>${OTM_THRESHOLD_PCT}%, ${MAX_DTE_DAYS}d window`);

  let flagged = 0;
  const failed = [];
  for (const symbol of roster) {
    try {
      const result = await scanTicker(symbol);
      await upsertOrClear(p, date, symbol, result);
      if (result && result.otmPct > OTM_THRESHOLD_PCT) flagged += 1;
    } catch (e) {
      failed.push(`${symbol}:${e.message}`);
    }
    await sleep(TICKER_DELAY_MS);
  }
  console.log(`[far-cb] sweep done — ${flagged} flagged, ${failed.length} failed`);
  return { date, flagged, failed: failed.length, failures: failed.slice(0, 10) };
}

// ── daily outcome grading ─────────────────────────────────────────────────────

/**
 * Grade every OPEN outcome row once: pull daily OHLC from first_flagged through
 * today, check whether spot ever touched the strike (high >= strike for an
 * "above" side, low <= strike for "below"), and record the closest approach.
 * No win/loss judgement — just the observed result. Rows past their expiry
 * that were never touched flip to status='expired'; touched rows flip to
 * status='touched' and stop being re-graded.
 */
async function gradeOne(p, row) {
  const { symbol, strike, expiry, first_flagged, side } = row;
  const today = etDateStr();
  const fromDate = new Date(first_flagged);
  const toDate = new Date();

  let bars;
  try {
    bars = INDEX_SYMBOLS.has(symbol.toUpperCase())
      ? await fetchIndexDailyHistoryTheta(symbol, fromDate, toDate)
      : await fetchStockDailyHistoryTheta(symbol, fromDate, toDate);
  } catch (e) {
    console.warn(`[far-cb] grade ${symbol} — history fetch failed: ${e.message}`);
    return;
  }
  if (!bars?.length) return;

  let touched = row.touched;
  let touchedDate = row.touched_date;
  let closestPct = row.closest_pct;
  let lastSpot = row.last_spot;

  for (const b of bars) {
    const barDate = new Date(b.time).toISOString().slice(0, 10);
    lastSpot = b.close;
    const dist = side === 'above'
      ? Math.max(0, strike - b.high)
      : Math.max(0, b.low - strike);
    const distPct = (dist / strike) * 100;
    if (closestPct == null || distPct < closestPct) closestPct = distPct;
    if (!touched) {
      const hit = side === 'above' ? b.high >= strike : b.low <= strike;
      if (hit) { touched = true; touchedDate = barDate; }
    }
  }

  const expired = !touched && today > expiry;
  const status = touched ? 'touched' : expired ? 'expired' : 'open';

  await p.query(
    `UPDATE far_cb_outcomes SET
       last_checked = $1, last_spot = $2, closest_pct = $3,
       touched = $4, touched_date = $5, status = $6, updated_at = now()
     WHERE symbol = $7 AND strike = $8 AND expiry = $9`,
    [today, lastSpot, closestPct, touched, touchedDate, status, symbol, strike, expiry]
  );
}

async function runGrading() {
  if (!(await ensureSchema())) return { skipped: 'no DB' };
  const p = getPool();
  const { rows } = await p.query(
    `SELECT symbol, strike, expiry, first_flagged, side, touched, touched_date, closest_pct, last_spot
     FROM far_cb_outcomes WHERE status = 'open'`
  );
  console.log(`[far-cb] grading ${rows.length} open outcome(s)`);
  let ok = 0;
  const failed = [];
  for (const row of rows) {
    try { await gradeOne(p, row); ok += 1; }
    catch (e) { failed.push(`${row.symbol}:${e.message}`); }
    await sleep(200);
  }
  console.log(`[far-cb] grading done — ${ok} graded, ${failed.length} failed`);
  return { graded: ok, failed: failed.length };
}

// ── dxLink premium history (the backfill source) ──────────────────────────────

/**
 * dxFeed writes option strikes with no padding and no trailing zeros —
 * `.SPY260821C640`, `.SPY260821C22.5`. Format to match.
 */
function dxStrike(strike) {
  const n = Number(strike);
  if (!Number.isFinite(n) || !(n > 0)) return null;
  return String(Math.round(n * 1000) / 1000);
}

/**
 * The dxLink streamer symbol for one contract.
 *
 * Preferred path is TastyTrade's own chain, which carries `streamerSymbol` per
 * strike — authoritative, and already cached ~10 min inside proxy-tastytrade.
 * An EXPIRED contract has left the chain, so fall back to constructing dxFeed's
 * form. That reconstruction is only safe for plain equity roots: index options
 * pick a different root per settlement (SPX vs SPXW, NDX vs NDXP) and guessing
 * wrong yields a symbol that quietly returns nothing.
 */
async function resolveStreamerSymbol(symbol, expiry, strike, type) {
  const up = String(symbol).toUpperCase();
  try {
    const { contracts } = await _tt.fetchChain(up);
    const hit = (contracts || []).find(
      (c) => c.expiration === expiry
        && Math.abs(Number(c.strike) - Number(strike)) < 0.01
        && c.type === type
    );
    if (hit?.streamerSymbol) return hit.streamerSymbol;
  } catch (e) {
    console.warn(`[far-cb] chain lookup failed for ${up}: ${e.message}`);
  }
  if (INDEX_SYMBOLS.has(up)) return null;
  const ymd = String(expiry).slice(2).replace(/-/g, ''); // 2026-08-21 -> 260821
  const k = dxStrike(strike);
  if (!/^\d{6}$/.test(ymd) || !k) return null;
  return `.${up}${ymd}${type}${k}`;
}

/**
 * Daily bars for one contract off dxLink. `[]` on any failure — a contract that
 * never traded has no candles, which is indistinguishable from an unentitled
 * symbol and is handled the same way either side.
 */
async function fetchContractDailyBarsDx(symbol, expiry, strike, type, opts = {}) {
  const streamer = await resolveStreamerSymbol(symbol, expiry, strike, type);
  if (!streamer) return { streamer: null, bars: [] };
  const days = Number(opts.days) > 0 ? Number(opts.days) : BACKFILL_DAYS;
  try {
    const bars = await _candleHist.fetchIntradayCandles(
      streamer, '1d', Date.now() - days * 86400_000,
      {
        // cache:false is mandatory — candle-history keys its cache on
        // symbol|interval with no fromTime, so a cached single-session response
        // would be handed back for this multi-week pull (and worse, this pull
        // would poison the entry the live price line reads).
        cache: false,
        quietMs: Number(opts.quietMs) > 0 ? Number(opts.quietMs) : 2500,
        hardMs: Number(opts.hardMs) > 0 ? Number(opts.hardMs) : 25_000,
      }
    );
    return { streamer, bars: Array.isArray(bars) ? bars : [] };
  } catch (e) {
    console.warn(`[far-cb] dxLink candles failed ${streamer}: ${e.message}`);
    return { streamer, bars: [] };
  }
}

/**
 * Pull one tracked flag's premium history from dxLink into
 * far_cb_contract_daily. Bars before the flag date are dropped — the popup's
 * window starts at first_flagged, and the contract's life before anyone was
 * watching it is not what the row is about.
 */
async function backfillContractPremium(row, opts = {}) {
  const type = optTypeOf(row);
  const { streamer, bars } = await fetchContractDailyBarsDx(
    row.symbol, row.expiry, row.strike, type, opts
  );
  if (!bars.length) return { streamer, bars: [], written: 0 };
  const flagged = toYmd(row.first_flagged);
  const kept = flagged
    ? bars.filter((b) => new Date(b.time).toISOString().slice(0, 10) >= flagged)
    : bars;
  const written = await persistContractBars(row.symbol, row.strike, row.expiry, type, kept, 'dxlink');
  return { streamer, bars: kept, written };
}

/**
 * One-shot pass over every tracked flag whose premium history dxLink can still
 * serve. Sequential by design: each contract opens its own short-lived dxLink
 * connection, and firing dozens at once would be a self-inflicted rate limit.
 *
 * Re-running is cheap — `premium_backfilled_at` skips contracts already covered
 * (an expired one permanently, a live one until the next session). `force`
 * ignores the marker.
 */
async function runContractBackfill(opts = {}) {
  if (!(await ensureSchema())) return { skipped: 'no DB' };
  const p = getPool();
  if (!p) return { skipped: 'no DB' };

  const today = etDateStr();
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : BACKFILL_LIMIT;
  const force = !!opts.force;

  const { rows } = await p.query(
    `SELECT symbol, strike, expiry, first_flagged, gex_value_at_flag, spot_at_flag, side
       FROM far_cb_outcomes
      WHERE first_flagged >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
        AND ($2::bool
             OR premium_backfilled_at IS NULL
             OR (expiry >= $3 AND premium_backfilled_at < CURRENT_DATE))
      ORDER BY first_flagged DESC
      LIMIT $4`,
    [BACKFILL_DAYS, force, today, limit]
  );

  if (!rows.length) return { candidates: 0, filled: 0, written: 0, empty: 0 };
  console.log(`[far-cb] premium backfill — ${rows.length} contract(s) to try (dxLink daily bars)`);

  let filled = 0, written = 0, empty = 0;
  for (const row of rows) {
    try {
      const r = await backfillContractPremium(row, opts);
      if (r.written > 0) { filled += 1; written += r.written; } else { empty += 1; }
      await p.query(
        `UPDATE far_cb_outcomes SET premium_backfilled_at = now()
          WHERE symbol = $1 AND strike = $2 AND expiry = $3`,
        [row.symbol, Number(row.strike), row.expiry]
      );
    } catch (e) {
      console.warn(`[far-cb] backfill failed ${row.symbol} ${row.strike} ${row.expiry}: ${e.message}`);
    }
    await sleep(250);
  }
  console.log(`[far-cb] premium backfill done — ${filled} filled (${written} bars), ${empty} with nothing to serve`);
  return { candidates: rows.length, filled, written, empty };
}

// ── daily contract price probe ────────────────────────────────────────────────

/**
 * Record today's premium for every tracked contract that is still alive.
 *
 * This is the fix for "the contract price never updates": there is no
 * per-contract EOD feed under DATA_SOURCE=tt, so instead of asking a vendor for
 * history after the fact, we WRITE our own — one row per contract per session,
 * updated in place every PROBE_MINS. The first probe of the day sets `open`,
 * every later one moves `close` (and high/low), and the pass that runs after the
 * close leaves the settling mark behind. Rows survive expiry, so a contract that
 * has stopped quoting keeps the history it built while it was live.
 *
 * Price = the same NBBO mid (`mark`) the chain snapshot serves, one greeks call
 * per (symbol, expiry) group — not per contract.
 */
async function runContractProbe(opts = {}) {
  if (!(await ensureSchema())) return { skipped: 'no DB' };
  const p = getPool();
  if (!p) return { skipped: 'no DB' };

  const today = etDateStr();
  const { rows } = await p.query(
    `SELECT symbol, strike, expiry, spot_at_flag, gex_value_at_flag, side
       FROM far_cb_outcomes
      WHERE expiry >= $1`,
    [today]
  );
  if (!rows.length) return { date: today, probed: 0, missing: 0 };

  // One greeks snapshot per (symbol, expiry) covers every tracked strike in it.
  const groups = new Map();
  for (const r of rows) {
    const gk = `${r.symbol}|${r.expiry}`;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(r);
  }

  let probed = 0;
  let missing = 0;
  for (const [gk, groupRows] of groups) {
    const [symbol, expiry] = gk.split('|');
    const greekMap = await fetchGreeksTheta(symbol, expiry).catch(() => new Map());
    for (const r of groupRows) {
      const type = optTypeOf(r);
      const mark = Number(greekMap.get(keyOf(expiry, Number(r.strike), type))?.mark ?? 0);
      if (!(mark > 0)) { missing += 1; continue; }
      try {
        await p.query(
          `INSERT INTO far_cb_contract_daily
             (symbol, strike, expiry, opt_type, date, open, high, low, close, probes, source, ts)
           VALUES ($1,$2,$3,$4,$5,$6,$6,$6,$6,1,'probe',now())
           ON CONFLICT (symbol, strike, expiry, opt_type, date) DO UPDATE SET
             high   = GREATEST(far_cb_contract_daily.high, EXCLUDED.close),
             low    = LEAST(far_cb_contract_daily.low, EXCLUDED.close),
             close  = EXCLUDED.close,
             probes = far_cb_contract_daily.probes + 1,
             ts     = now()`,
          [symbol, Number(r.strike), expiry, type, today, mark]
        );
        probed += 1;
      } catch (e) {
        console.warn(`[far-cb] probe write failed ${symbol} ${r.strike}${type} ${expiry}: ${e.message}`);
      }
      await sleep(60);
    }
  }
  if (opts.verbose !== false) {
    console.log(`[far-cb] contract probe ${today} — ${probed} priced, ${missing} without a quote`);
  }
  return { date: today, probed, missing };
}

/**
 * Fold a per-contract daily series (dxLink candles, or Theta EOD if the Terminal
 * ever answers) into far_cb_contract_daily, so the history survives the vendor
 * going away and the contract expiring. Only sessions BEFORE today are written:
 * today's row belongs to the live probe, whose close is a current NBBO mid
 * rather than a half-formed session bar.
 */
async function persistContractBars(symbol, strike, expiry, type, bars, source = 'eod') {
  const p = getPool();
  if (!p || !bars?.length) return 0;
  const today = etDateStr();
  let written = 0;
  for (const b of bars) {
    const date = new Date(b.time).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= today) continue;
    const close = Number(b.close);
    if (!Number.isFinite(close) || !(close > 0)) continue;
    const open = Number.isFinite(Number(b.open)) ? Number(b.open) : close;
    const high = Number.isFinite(Number(b.high)) ? Number(b.high) : close;
    const low  = Number.isFinite(Number(b.low))  ? Number(b.low)  : close;
    try {
      await p.query(
        // A real session bar outranks the probe samples for that day — it has
        // the true high and low, which 15-minute sampling can only approximate.
        `INSERT INTO far_cb_contract_daily
           (symbol, strike, expiry, opt_type, date, open, high, low, close, probes, source, ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,now())
         ON CONFLICT (symbol, strike, expiry, opt_type, date) DO UPDATE SET
           open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
           close = EXCLUDED.close, source = EXCLUDED.source, ts = now()`,
        [symbol, Number(strike), expiry, type, date, open, high, low, close, source]
      );
      written += 1;
    } catch (e) {
      console.warn(`[far-cb] ${source} backfill write failed ${symbol} ${strike}${type} ${date}: ${e.message}`);
      break;
    }
  }
  return written;
}

/** Today's probe rows keyed like the quote cache, for the live-quote fallback. */
async function fetchProbeRowsForDate(date) {
  const p = getPool();
  if (!p) return new Map();
  try {
    const { rows } = await p.query(
      `SELECT symbol, strike, expiry, opt_type, open, close
         FROM far_cb_contract_daily WHERE date = $1`,
      [date]
    );
    return new Map(rows.map((r) => [`${r.symbol}|${r.expiry}|${Number(r.strike)}|${r.opt_type}`, r]));
  } catch (e) {
    console.warn('[far-cb] probe lookup failed:', e.message);
    return new Map();
  }
}

// ── outcome detail (popup) ────────────────────────────────────────────────────

/**
 * Day-by-day detail for one tracked flag, for the "Tracked results" row popup:
 * underlying close + day/day % change, alongside the watched contract's own
 * close + day/day $ and % change, from first_flagged through today.
 *
 * Contract type isn't stored directly — derived from the flag's side (strike
 * above spot at the flag = the OTM call, below = the OTM put) by optTypeOf.
 */
async function computeOutcomeDetail(symbol, strike, expiry) {
  if (!(await ensureSchema())) return { ok: false, error: 'no DB' };
  const p = getPool();
  if (!p) return { ok: false, error: 'no DB' };
  const { rows } = await p.query(
    `SELECT symbol, strike, expiry, first_flagged, spot_at_flag, otm_pct_at_flag,
            gex_value_at_flag, side, last_checked, last_spot, closest_pct, touched, touched_date, status
     FROM far_cb_outcomes WHERE symbol = $1 AND strike = $2 AND expiry = $3`,
    [symbol, strike, expiry]
  );
  const row = rows[0];
  if (!row) return { ok: false, error: 'not found' };

  const type = optTypeOf(row);
  const fromDate = new Date(row.first_flagged);
  const toDate = new Date();

  // Two independent sources for the contract's daily premium, merged below:
  //   1. Theta's per-contract EOD series — authoritative, but only exists when
  //      the Terminal is up (and never under the tt-snapshot stub).
  //   2. far_cb_contract_daily — our own probe, written every PROBE_MINS. Always
  //      present going forward, and it keeps working after the contract expires.
  // probeRows is reassignable: an unbacked contract triggers an on-demand
  // dxLink pull below and the fetched bars stand in for it.
  let [underlyingBars, contractBars, probeRows] = await Promise.all([
    (INDEX_SYMBOLS.has(symbol.toUpperCase())
      ? fetchIndexDailyHistoryTheta(symbol, fromDate, toDate)
      : fetchStockDailyHistoryTheta(symbol, fromDate, toDate)
    ).catch(() => []),
    fetchContractDailyBars(symbol, expiry, strike, type, fromDate, toDate, strikeWindow(strike, row.spot_at_flag)),
    p.query(
      `SELECT date, open, high, low, close FROM far_cb_contract_daily
        WHERE symbol = $1 AND strike = $2 AND expiry = $3 AND opt_type = $4
        ORDER BY date`,
      [symbol, Number(strike), expiry, type]
    ).then((r) => r.rows).catch(() => []),
  ]);

  // Keep whatever Theta could serve, so a later popup still has it once the
  // Terminal is paused or the contract stops quoting. Fire-and-forget: the
  // popup must not wait on a backfill write.
  if (contractBars.length) {
    persistContractBars(symbol, strike, expiry, type, contractBars, 'eod')
      .catch((e) => console.warn('[far-cb] EOD backfill failed:', e.message));
  }

  // Nothing recorded for this contract yet — a flag opened before the probe
  // existed, or one the scheduled backfill has not reached. Pull it from dxLink
  // NOW rather than showing a wall of dashes and filling it in on the second
  // open. Tighter windows than the batch pass: someone is watching a spinner.
  if (!contractBars.length && !probeRows.length) {
    try {
      const r = await backfillContractPremium(
        { symbol, strike, expiry, first_flagged: row.first_flagged, gex_value_at_flag: row.gex_value_at_flag },
        { quietMs: 1500, hardMs: 9000 }
      );
      if (r.bars.length) probeRows = r.bars.map((b) => ({
        date: new Date(b.time).toISOString().slice(0, 10),
        open: b.open, high: b.high, low: b.low, close: b.close,
      }));
      await p.query(
        `UPDATE far_cb_outcomes SET premium_backfilled_at = now()
          WHERE symbol = $1 AND strike = $2 AND expiry = $3`,
        [symbol, Number(strike), expiry]
      ).catch(() => {});
    } catch (e) {
      console.warn('[far-cb] on-demand backfill failed:', e.message);
    }
  }

  const contractByDay = new Map(
    contractBars.map((b) => [new Date(b.time).toISOString().slice(0, 10), b.close])
  );
  const probeByDay = new Map();
  for (const r of probeRows) {
    const d = toYmd(r.date);
    const close = Number(r.close);
    if (d && Number.isFinite(close) && close > 0) probeByDay.set(d, close);
  }

  // A probe-only day is still a real observation, so the popup must show it even
  // when the underlying bar list is the shorter of the two.
  const dayKeys = [...new Set([
    ...underlyingBars.map((b) => new Date(b.time).toISOString().slice(0, 10)),
    ...probeByDay.keys(),
  ])].sort();
  const spotByDay = new Map(
    underlyingBars.map((b) => [new Date(b.time).toISOString().slice(0, 10), b.close])
  );

  const days = [];
  let prevSpot = null;
  let prevContract = null;
  for (const dateStr of dayKeys) {
    // A probe-only day (the underlying bar hasn't posted yet) carries the last
    // known spot forward so the row isn't blank, but reports no spot change —
    // that would be a fabricated 0.00%.
    const hasSpotBar = spotByDay.has(dateStr);
    const spot = hasSpotBar ? Number(spotByDay.get(dateStr)) : prevSpot;
    if (spot == null) continue;
    const contractClose = contractByDay.has(dateStr)
      ? Number(contractByDay.get(dateStr))
      : probeByDay.has(dateStr) ? Number(probeByDay.get(dateStr)) : null;

    const spotPctChg = hasSpotBar && prevSpot != null && prevSpot > 0 ? ((spot - prevSpot) / prevSpot) * 100 : null;
    const contractDollarChg = prevContract != null && contractClose != null ? contractClose - prevContract : null;
    const contractPctChg = prevContract != null && prevContract > 0 && contractClose != null
      ? ((contractClose - prevContract) / prevContract) * 100
      : null;

    days.push({
      date: dateStr,
      spot,
      spotPctChg,
      contractClose,
      contractDollarChg,
      contractPctChg,
    });

    prevSpot = spot;
    if (contractClose != null) prevContract = contractClose;
  }

  return {
    ok: true,
    symbol,
    strike: Number(strike),
    expiry,
    type,
    firstFlagged: toYmd(row.first_flagged),
    spotAtFlag: Number(row.spot_at_flag),
    otmPctAtFlag: Number(row.otm_pct_at_flag),
    status: row.status,
    touched: row.touched,
    touchedDate: toYmd(row.touched_date),
    days,
  };
}

// ── live contract quote for the tracked-results table ─────────────────────────

/**
 * The Tracked-results table shows the flagged OTM contract's own price and its
 * % change since today's open, so the stats are readable without opening the
 * per-row detail popup.
 *
 * price  = live NBBO mid from the greeks snapshot (same `mark` the strike-detail
 *          popup uses — one call per (symbol, expiry) group, not per row).
 * open   = today's option EOD open when Theta can serve one, otherwise the first
 *          probe of the session out of far_cb_contract_daily. Without that
 *          fallback the % column was permanently blank under DATA_SOURCE=tt,
 *          where the option-history call is a stub.
 * Rows whose expiry has already passed have no live contract → both null.
 *
 * Type convention matches computeOutcomeDetail: strike above spot at flag → call.
 *
 * Cached 60s per contract — /proxy/far-cb-outcomes is polled by every open
 * scanner tab and Theta must not eat one call per row per poll.
 */
const QUOTE_TTL_MS = 60_000;
const _quoteCache = new Map(); // `${symbol}|${expiry}|${strike}|${type}` -> { ts, price, open }

// The enrichment used to run INLINE and SEQUENTIALLY inside the request: one
// Theta option-history call plus a hard 120ms sleep per tracked row. With 100
// rows that is minutes of wall clock — /proxy/far-cb-outcomes was timing out
// (524) and, because the browser caps a host at 6 connections, the stalled
// request starved every other fetch on the scanner page.
//
// It now runs as a background single-flight pass and the request only WAITS on
// it for a small budget. Whatever the cache holds when the budget expires is
// what ships; the rest lands in the cache and the next poll picks it up.
const QUOTE_WAIT_MS    = Number(process.env.FAR_CB_QUOTE_WAIT_MS || 2500);
const QUOTE_CONCURRENCY = Number(process.env.FAR_CB_QUOTE_CONCURRENCY || 5);
// Cap how many stale contracts one pass refreshes so a big backlog fills over
// successive polls instead of pinning Theta for a minute in one go.
const QUOTE_MAX_PER_PASS = Number(process.env.FAR_CB_QUOTE_MAX_PER_PASS || 60);

let _quoteFill = null; // in-flight background pass, shared by every open tab

const quoteKey = (r, type) => `${r.symbol}|${r.expiry}|${Number(r.strike)}|${type}`;

/** Snapshot of the cache for these rows — never fetches. */
function cachedQuotes(rows) {
  const out = new Map();
  for (const r of rows) {
    const ck = quoteKey(r, optTypeOf(r));
    const hit = _quoteCache.get(ck);
    // Serve a stale entry too: a slightly old mark beats a blank column, and
    // the background pass is already refreshing it.
    if (hit) out.set(ck, hit);
  }
  return out;
}

/** Resolve one contract's { price, open } and write it into the cache. */
async function refreshQuote(r, today, probesToday, greekMapFor) {
  const greekMap = await greekMapFor(r.symbol, r.expiry);
  const mark = Number(greekMap.get(keyOf(r.expiry, Number(r.strike), r.type))?.mark ?? 0);
  let open = null;
  // strike_range must be wide enough to keep a far-OTM strike inside Theta's
  // ±range window around today's spot — reuse the flag distance.
  const bars = await fetchContractDailyBars(
    r.symbol, r.expiry, Number(r.strike), r.type, today, today,
    strikeWindow(r.strike, r.spot_at_flag)
  ).catch(() => []);
  const o = Number(bars?.[0]?.open);
  if (Number.isFinite(o) && o > 0) open = o;
  if (open == null) {
    // No vendor bar (stubbed source, pre-open, or no trade) — use the first
    // probe we recorded for this contract today.
    const po = Number(probesToday.get(r.ck)?.open);
    if (Number.isFinite(po) && po > 0) open = po;
  }
  const entry = { ts: Date.now(), price: mark > 0 ? mark : null, open };
  _quoteCache.set(r.ck, entry);
  return entry;
}

/**
 * Background pass: refresh every contract whose cache entry is missing or older
 * than the TTL. Bounded concurrency, one greeks snapshot per (symbol, expiry)
 * shared across its rows, no per-row sleep.
 */
async function runQuoteFill(stale) {
  const today = etDateStr();
  const probesToday = await fetchProbeRowsForDate(today).catch(() => new Map());

  // One greeks snapshot per (symbol, expiry), de-duped across parallel workers.
  const greekCache = new Map();
  const greekMapFor = (symbol, expiry) => {
    const gk = `${symbol}|${expiry}`;
    if (!greekCache.has(gk)) {
      greekCache.set(gk, fetchGreeksTheta(symbol, expiry).catch(() => new Map()));
    }
    return greekCache.get(gk);
  };

  // Group-major ordering so workers running side by side tend to share a
  // snapshot rather than each opening a different (symbol, expiry).
  const queue = [...stale].sort((a, b) =>
    `${a.symbol}|${a.expiry}`.localeCompare(`${b.symbol}|${b.expiry}`)
  ).slice(0, QUOTE_MAX_PER_PASS);

  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const r = queue[i++];
      try { await refreshQuote(r, today, probesToday, greekMapFor); }
      catch (e) {
        // Cache the miss so a dead vendor doesn't get re-asked on every poll.
        _quoteCache.set(r.ck, { ts: Date.now(), price: null, open: null });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(QUOTE_CONCURRENCY, queue.length)) }, worker)
  );
}

async function computeOutcomeQuotes(rows) {
  const today = etDateStr();
  const live = rows.filter((r) => r.expiry >= today);
  if (!live.length) return new Map();

  const now = Date.now();
  const stale = [];
  for (const r of live) {
    const type = optTypeOf(r);
    const ck = quoteKey(r, type);
    const hit = _quoteCache.get(ck);
    if (!hit || now - hit.ts >= QUOTE_TTL_MS) stale.push({ ...r, type, ck });
  }

  if (stale.length && !_quoteFill) {
    _quoteFill = runQuoteFill(stale)
      .catch((e) => { console.warn('[far-cb] quote fill failed:', e.message); })
      .finally(() => { _quoteFill = null; });
  }

  // Wait only for the budget. Whatever is cached by then is what we return —
  // the pass keeps running and the next poll sees the rest.
  if (_quoteFill) {
    await Promise.race([_quoteFill, sleep(QUOTE_WAIT_MS)]);
  }

  return cachedQuotes(live);
}

/**
 * Entry and running high for every tracked contract, from OUR OWN recorded
 * daily series.
 *
 * This is the pair the scanner reports, and neither of them is "now". The flag
 * is a thesis with a date on it — this contract, from the day it was flagged —
 * so what it is worth is what it did SINCE that day: what you would have paid
 * (entry) and the best it ever offered (high). The old columns were the live
 * mid and its move off TODAY'S open, which measures this morning rather than
 * the flag, resets every session, and reads as a loss on a contract that has
 * doubled since it was flagged and is merely off its intraday high.
 *
 *   entry = the first price recorded on or after first_flagged — the session
 *           `open` where there is one, else that day's close.
 *   high  = the highest `high` on or after first_flagged.
 *
 * Bars BEFORE first_flagged are excluded on purpose: the backfill pulls a
 * contract's whole life, and a high printed a week before the flag was never
 * on offer to anyone reading this table.
 *
 * Returns `${symbol}|${expiry}|${strike}|${type}` -> { entry, high, entryDate }.
 */
async function computeEntryHighs() {
  const p = getPool();
  if (!p) return new Map();
  try {
    const { rows } = await p.query(
      `SELECT d.symbol, d.strike, d.expiry, d.opt_type,
              MAX(d.high) AS high,
              MIN(d.date) AS entry_date,
              (ARRAY_AGG(COALESCE(d.open, d.close) ORDER BY d.date))[1] AS entry
         FROM far_cb_contract_daily d
         JOIN far_cb_outcomes o
           ON o.symbol = d.symbol AND o.strike = d.strike AND o.expiry = d.expiry
        WHERE d.date >= o.first_flagged
        GROUP BY d.symbol, d.strike, d.expiry, d.opt_type`
    );
    const out = new Map();
    for (const r of rows) {
      const entry = Number(r.entry);
      const high = Number(r.high);
      out.set(`${r.symbol}|${r.expiry}|${Number(r.strike)}|${r.opt_type}`, {
        entry: Number.isFinite(entry) && entry > 0 ? entry : null,
        high: Number.isFinite(high) && high > 0 ? high : null,
        entryDate: toYmd(r.entry_date),
      });
    }
    return out;
  } catch (e) {
    console.warn('[far-cb] entry/high lookup failed:', e.message);
    return new Map();
  }
}

/**
 * Attach the contract columns to outcome rows: opt_entry / opt_high /
 * opt_pct_high, plus opt_price (the live mid) which is still carried for the
 * popup and for folding into the high below.
 *
 * The live mid is folded into the high because the probe only samples every
 * PROBE_MINS: a contract printing its best bid of the week right now would
 * otherwise show a high from fifteen minutes ago. Entry is never touched by it.
 *
 * The two halves fail independently. Entry and high come from our own table and
 * survive a dead vendor; only opt_price needs Theta, so a quote outage empties
 * one column instead of all three.
 */
async function enrichOutcomesWithQuotes(rows) {
  const [quotes, series] = await Promise.all([
    computeOutcomeQuotes(rows).catch((e) => {
      console.warn('[far-cb] outcome quote enrich failed:', e.message);
      return new Map();
    }),
    computeEntryHighs(),
  ]);
  return rows.map((r) => {
    const type = optTypeOf(r);
    const ck = `${r.symbol}|${r.expiry}|${Number(r.strike)}|${type}`;
    const price = quotes.get(ck)?.price ?? null;
    const s = series.get(ck);
    const entry = s?.entry ?? null;
    const high = price != null && s?.high != null ? Math.max(s.high, price)
      : (s?.high ?? price ?? null);
    return {
      ...r,
      opt_type: type,
      opt_price: price,
      opt_entry: entry,
      opt_entry_date: s?.entryDate ?? null,
      opt_high: high,
      opt_pct_high: entry != null && high != null && entry > 0
        ? ((high - entry) / entry) * 100
        : null,
    };
  });
}

// ── scheduler ─────────────────────────────────────────────────────────────────

let _timer = null;
let _sweeping = false;
let _probing = false;
let _lastKey = null;
let _lastProbeKey = null;
let _lastGradeDate = null;
let _lastCloseProbeDate = null;
let _backfilling = false;
let _lastBackfillDate = null;

// Grade once daily inside this ET window (minutes-since-midnight) — well after
// the close so the day's final OHLC bar is posted, but same-day so it doesn't
// silently slip to the next morning if the server restarts overnight.
const GRADE_WINDOW_START_MINS = 16 * 60 + 10; // 16:10 ET
const GRADE_WINDOW_END_MINS   = 20 * 60;      // 20:00 ET

function startFarCbRecorder() {
  console.log(`[far-cb] enabled — ${SWEEP_MINS}m sweeps during RTH, OTM>${OTM_THRESHOLD_PCT}%, ≤${MAX_DTE_DAYS}d, ${PROBE_MINS}m contract probe, daily grading ~16:10 ET`);
  const probe = (why) => {
    if (_probing) return;
    _probing = true;
    runContractProbe()
      .catch((e) => console.warn(`[far-cb] ${why} probe error:`, e.message))
      .finally(() => { _probing = false; });
  };
  const backfill = (why) => {
    if (_backfilling) return;
    _backfilling = true;
    runContractBackfill()
      .catch((e) => console.warn(`[far-cb] ${why} backfill error:`, e.message))
      .finally(() => { _backfilling = false; });
  };

  const tick = async () => {
    const { hour, minute } = etParts();
    const mins = hour * 60 + minute;

    if (isRthWindow() && minute % SWEEP_MINS === 0) {
      const key = `${etDateStr()} ${hour}:${minute}`;
      if (key !== _lastKey && !_sweeping) {
        _lastKey = key;
        _sweeping = true;
        runSweep()
          .catch((e) => console.warn('[far-cb] sweep error:', e.message))
          .finally(() => { _sweeping = false; });
      }
    }

    // Contract premium probe — every PROBE_MINS during RTH. This is what builds
    // far_cb_contract_daily, so the popup's CONTRACT columns fill in day by day
    // instead of waiting on a per-contract EOD feed that may not exist.
    if (isRthWindow() && minute % PROBE_MINS === 0) {
      const pKey = `${etDateStr()} ${hour}:${minute}`;
      if (pKey !== _lastProbeKey) {
        _lastProbeKey = pKey;
        probe('scheduled');
      }
    }

    // Daily outcome grading — once per day, first tick inside the window. The
    // closing probe rides along so the last write of the session is the
    // settling mark, even if the process restarted during the day.
    if (mins >= GRADE_WINDOW_START_MINS && mins <= GRADE_WINDOW_END_MINS) {
      const gKey = etDateStr();
      if (gKey !== _lastGradeDate) {
        _lastGradeDate = gKey;
        runGrading().catch((e) => console.warn('[far-cb] grading error:', e.message));
      }
      if (gKey !== _lastCloseProbeDate) {
        _lastCloseProbeDate = gKey;
        probe('close');
      }
      // After the close, pull the day's real session bars for every live flag —
      // dxLink's OHLC replaces that day's probe samples with the true high/low,
      // and picks up any flag opened since the last pass.
      if (gKey !== _lastBackfillDate) {
        _lastBackfillDate = gKey;
        setTimeout(() => backfill('daily'), 60_000);
      }
    }
  };
  _timer = setInterval(() => { void tick(); }, 60_000);
  _timer.unref?.();
  setTimeout(() => {
    runSweep()
      .catch((e) => console.warn('[far-cb] initial sweep error:', e.message))
      .finally(() => probe('startup'));
  }, 30_000);
  // Startup backfill, well clear of the sweep so the two don't contend. This is
  // what fills in flags that predate the probe — it runs once per boot and then
  // skips whatever premium_backfilled_at says is already covered.
  setTimeout(() => backfill('startup'), 150_000);
  return () => { if (_timer) clearInterval(_timer); };
}

module.exports = {
  startFarCbRecorder,
  runSweep,
  runGrading,
  runContractProbe,
  runContractBackfill,
  ensureSchema,
  getPool,
  scanTicker,
  computeOutcomeDetail,
  computeEntryHighs,
  enrichOutcomesWithQuotes,
  toYmd,
  OTM_THRESHOLD_PCT,
  MAX_DTE_DAYS,
};
