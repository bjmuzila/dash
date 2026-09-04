'use strict';
/**
 * server-v2/daily-grades-recorder.js
 *
 * Grades the Daily Grades board after the close: one row per ticker, then one
 * summed row for the session. Feeds /owner/daily-grades.
 *
 * THE TWO HALVES ARE SEPARATE ON PURPOSE
 * --------------------------------------
 * 1. SEAL  — at 09:26 ET `buildSeal()` computes the board for every ticker on
 *    the scanner watchlist and stores it verbatim in `daily_grade_seals`:
 *
 *      floor / cap  daily-grades-levels.js, off the per-strike OI gamma ladder
 *                   in `eod_strike_gex` (oi_call_gex / oi_put_gex). 09:26 is
 *                   chosen to sit just after eod-strike-gex-recorder's 09:25 OI
 *                   re-stamp, so the ladder is the SETTLED overnight OI rather
 *                   than yesterday's intraday guess at it.
 *      apex (CB)    scanner_snapshots.cb — the strike carrying the largest
 *      flip         scanner_snapshots.gex_flip   |net GEX| / the flip, both as
 *      spot         live quote, falling back to  of the last scanner sweep.
 *                   the last scanner spot.
 *
 *    An external producer can still POST a board to /proxy/daily-grades-seal;
 *    same table, same lock. Nothing may rewrite a seal's levels after the open —
 *    that is the whole point of sealing — so the upsert refuses to touch
 *    `boards` once the session it names has started, unless force is passed.
 * 2. GRADE — after the close this reads the seal, pulls the session O/H/L/C for
 *    every sealed ticker, and scores it. The RAW O/H/L/C is stored alongside the
 *    grade, so changing the rubric later is a REGRADE
 *    (POST /proxy/daily-grades-regrade) over stored facts, not a refetch. Keep
 *    it that way: `gradeTicker()` below is a pure function of (sealed, ohlc) and
 *    must stay one.
 *
 * WHAT "CORRECT" MEANS — THE STRUCTURED SCORECARD (v2)
 * ----------------------------------------------------
 * The rubric is ordered the way a premarket read is ordered, and the whole of it
 * lives in daily-grades-scorecard.js (pure math, no I/O — read its header for
 * the reasoning). The short version:
 *
 *   1. REGIME FIRST. Net GEX sign and spot vs the gamma flip decide how every
 *      level below is expected to behave. Positive gamma: dealers hedge against
 *      the move, walls absorb, fades are the higher-probability play. Negative
 *      gamma: hedging is pro-cyclical, breaks accelerate. Sitting ON the flip is
 *      its own answer — chop, low conviction — not a coin flip between the two.
 *      A big call wall in negative gamma is NOT the same trade as the same wall
 *      in strong positive gamma, and until v2 this file scored them identically.
 *   2. WALL QUALITY, at seal time: how standout the bar is against its ladder,
 *      whether the peak is isolated or smeared across neighbours, distance from
 *      spot (0.3–1.0% is where a level is relevant but not already reached),
 *      alignment with the expected-move band, and round-number confluence.
 *   3. OVERNIGHT STABILITY. The premarket value is in the CHANGE, not the print.
 *      A wall that held its strike is a stronger lean; one that CHASED price
 *      overnight is a weaker fade and a more credible breakout level.
 *   4. THE CALL. Those three produce one sentence per ticker — fade the first
 *      test, expect the break, or stand down — stored with the seal.
 *   5. THE GRADE. After the close each level is scored against the table its own
 *      regime implies, and the CALL is scored on whether the reaction it named
 *      actually happened.
 *
 *   regime   (did the day behave like the regime said)      25
 *   cap      (call side)     +GEX: tagged+held 25 · untested 15 · broke 5 · gapped 0
 *                            −GEX: broke+accelerated 25 · gapped ran 22 · absorbed 16
 *                                  · broke+reverted 10 · never reached 8
 *                            flip: chop held 22 · chop broke 8 · chop gapped 4
 *   floor    (put side)      the same three tables, mirrored
 *   flip     (gamma flip)    held clean 25 · held after a test 18 · flipped 5
 *   apex     (CB)            magnet: |close − apex| as % of close, 25/21/15/8/0
 *   range    (floor→cap)     contained 25 · one side out 12 · both out 0
 *   reaction (the call)      hit 25 · partial 13 · untested 12/9 · missed 4–6
 *
 * QUALITY IS A WEIGHT. Each component's points-available are scaled by that
 * component's seal-time quality (floored at 0.25, capped at 1). A wall 3% away,
 * smeared over four strikes and outside the expected move, barely counts in
 * EITHER direction — which is the correction for the statistic that makes
 * published wall-hold rates look better than they are. Distant walls hold almost
 * always; counting those holds at full weight inflates the record.
 *
 * A ticker's score is weighted points / weighted points-available × 100, so a
 * name with no flip is not punished for a component it never had. Letter bands
 * are the house bands from _lib-pick-grade.cjs — A+ 85 / A 72 / B 58 / C 44 /
 * D 28 / F — deliberately, so a grade means the same thing on both boards.
 * `max_pts = 0` (nothing gradable) stores as status `no_levels` and NULL grade
 * rather than an F: an F is a claim about the board, and there was no board.
 *
 * THE SETUP SCORE IS SEPARATE FROM THE GRADE, on purpose. `setup_score` is what
 * the MAP was worth before the session touched it; `score` is what the session
 * did to it. A good map can have a bad day, and the record should be able to
 * tell those two apart rather than blaming the structure for the tape.
 *
 * The day row is the straight SUM of every graded ticker's points over the sum
 * of their points-available — NOT the mean of the per-ticker percentages, which
 * would let a one-level ticker swing the session as hard as a four-level one.
 *
 * OLD SESSIONS STILL REGRADE TO THEIR OLD NUMBERS. A seal with no scorecard on
 * it (anything sealed before v2) grades on the v1 path: positive-gamma wall
 * table, unit weights, no regime and no reaction component. Nothing in the back
 * catalogue moves because the rubric moved.
 *
 * Cadence: checks every 5m; seals once at/after 09:26 ET, grades once at/after
 *          16:20 ET, trading days only.
 * Wiring:  startDailyGradesRecorder(PORT) in server-with-proxy.js.
 * Routes:  GET  /proxy/daily-grades[?date=]      seal + grades + day roll-up
 *          GET  /proxy/daily-grades-history      one ticker, session by session
 *          GET  /proxy/daily-grades-days         the running day table
 *          POST /proxy/daily-grades-build        build + seal the board now
 *          POST /proxy/daily-grades-seal         store a board built elsewhere
 *          POST /proxy/daily-grades-run          grade now (manual fire)
 *          POST /proxy/daily-grades-regrade      re-score stored O/H/L/C
 */

// ── config ───────────────────────────────────────────────────────────────────

const { floorCeiling } = require('./daily-grades-levels');
const SC = require('./daily-grades-scorecard');

/** Seal time. Just after eod-strike-gex-recorder's 09:25 ET settled-OI re-stamp. */
const SEAL_HOUR = Number(process.env.DAILY_GRADES_SEAL_HOUR ?? 9);
const SEAL_MIN = Number(process.env.DAILY_GRADES_SEAL_MIN ?? 26);
/** How far back to look for a scanner sweep carrying CB / flip / spot. */
const SCANNER_LOOKBACK_DAYS = Number(process.env.DAILY_GRADES_SCANNER_LOOKBACK || 5);

const GRADE_HOUR = Number(process.env.DAILY_GRADES_HOUR ?? 16);
const GRADE_MIN = Number(process.env.DAILY_GRADES_MIN ?? 20);
const CHECK_MS = Number(process.env.DAILY_GRADES_CHECK_MS || 5 * 60 * 1000);
/** Simultaneous candle pulls. dxLink opens a short-lived subscription per call,
 *  so this is the knob that decides whether ~170 names is polite or a stampede. */
const CONCURRENCY = Math.max(1, Number(process.env.DAILY_GRADES_CONCURRENCY || 4));
/** Give up on a ticker's candles after this long and mark it ungraded. */
const CANDLE_TIMEOUT_MS = Number(process.env.DAILY_GRADES_CANDLE_TIMEOUT_MS || 20_000);
/** Fewest 1m bars that count as a real session. A half-day is ~210. */
const MIN_BARS = Number(process.env.DAILY_GRADES_MIN_BARS || 60);

/**
 * How many past sessions the expected-move read averages over.
 *
 * THE EM HERE IS REALIZED, NOT IMPLIED. It is the median true range of the last
 * N graded sessions out of `daily_grades` — a table this recorder already fills,
 * for exactly this roster, so it costs no new feed and no new table. It is used
 * only as a SCALE: "is this level somewhere today can plausibly reach", and
 * "did the session move more or less than it usually does". If an ATM-straddle
 * implied move ever lands in the database, feed it into `emBySymbol` and nothing
 * downstream changes — that function is the one seam.
 */
const EM_LOOKBACK = Number(process.env.DAILY_GRADES_EM_LOOKBACK || 20);
/** Fewest past sessions before a realized EM is worth quoting at all. */
const EM_MIN_SESSIONS = Number(process.env.DAILY_GRADES_EM_MIN_SESSIONS || 5);

/** Index roots dxLink carries under a `$` prefix. Extend via env, CSV of A:B. */
const STREAMER_OVERRIDES = (() => {
  const base = { SPX: '$SPX', NDX: '$NDX', VIX: '$VIX', RUT: '$RUT', DJI: '$DJI', XSP: '$XSP' };
  for (const pair of String(process.env.DAILY_GRADES_STREAMER_MAP || '').split(',')) {
    const [k, v] = pair.split(':').map((s) => (s || '').trim().toUpperCase());
    if (k && v) base[k] = v;
  }
  return base;
})();

// Keep in sync with gex-levels-history-recorder.js / eod-gex-recorder.js.
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── ET clock ─────────────────────────────────────────────────────────────────

function etDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: dowMap[get('weekday')], hour: Number(get('hour')) % 24, minute: Number(get('minute')) };
}

function isTradingDay(dateStr) {
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !MARKET_HOLIDAYS.has(dateStr);
}

/** Minutes ET is offset from UTC at a given instant (negative — e.g. -240 EDT). */
function etOffsetMinutesAt(ms) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const g = (t) => Number(p.find((x) => x.type === t)?.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return Math.round((asUtc - ms) / 60_000);
}

/**
 * Epoch ms for HH:MM ET on an ET calendar date. Two passes: the first offset is
 * read at the naive-UTC guess, the second at the corrected instant, which is
 * what makes the DST switch days land right.
 */
function etMs(dateStr, hour, minute) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const guess = Date.parse(`${dateStr}T${hh}:${mm}:00Z`);
  let ms = guess - etOffsetMinutesAt(guess) * 60_000;
  ms = guess - etOffsetMinutesAt(ms) * 60_000;
  return ms;
}

const rthStartMs = (dateStr) => etMs(dateStr, 9, 30);
const rthEndMs = (dateStr) => etMs(dateStr, 16, 0);

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
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[daily-grades] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[daily-grades] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (_schemaReady) return true;

  await p.query(`
    CREATE TABLE IF NOT EXISTS daily_grade_seals (
      date        DATE PRIMARY KEY,
      boards      JSONB NOT NULL,
      note        TEXT,
      sealed_at   TIMESTAMPTZ,
      source      TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS daily_grades (
      date           DATE NOT NULL,
      symbol         TEXT NOT NULL,
      sealed_spot    DOUBLE PRECISION,
      floor_lvl      DOUBLE PRECISION,
      cap_lvl        DOUBLE PRECISION,
      apex_lvl       DOUBLE PRECISION,
      flip_lvl       DOUBLE PRECISION,
      o              DOUBLE PRECISION,
      h              DOUBLE PRECISION,
      l              DOUBLE PRECISION,
      c              DOUBLE PRECISION,
      bars           INTEGER,
      cap_outcome    TEXT,
      floor_outcome  TEXT,
      flip_outcome   TEXT,
      apex_outcome   TEXT,
      range_outcome  TEXT,
      cap_pts        INTEGER,
      floor_pts      INTEGER,
      flip_pts       INTEGER,
      apex_pts       INTEGER,
      range_pts      INTEGER,
      pts            INTEGER,
      max_pts        INTEGER,
      score          DOUBLE PRECISION,
      grade          TEXT,
      reached_cap    BOOLEAN,
      reached_floor  BOOLEAN,
      reached_apex   BOOLEAN,
      crossed_flip   BOOLEAN,
      status         TEXT NOT NULL DEFAULT 'graded',
      source         TEXT,
      graded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol)
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_daily_grades_symbol ON daily_grades(symbol)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_daily_grades_grade ON daily_grades(grade)`);

  // ── v2: the structured scorecard ───────────────────────────────────────────
  //
  // Additive and forward-only. Every one of these is nullable, so a row written
  // by v1 stays exactly as it was and reads back as "no scorecard", which is the
  // state gradeTicker() falls back on. `scorecard` carries the WHOLE seal-time
  // read as JSONB so a regrade is still a pure re-score over stored facts — the
  // rubric can move again without needing the ladder back.
  for (const [col, type] of [
    ['scorecard', 'JSONB'],
    ['regime', 'TEXT'],
    ['regime_conf', 'DOUBLE PRECISION'],
    ['regime_outcome', 'TEXT'],
    ['regime_pts', 'DOUBLE PRECISION'],
    ['reaction_call', 'TEXT'],
    ['reaction_outcome', 'TEXT'],
    ['reaction_pts', 'DOUBLE PRECISION'],
    ['setup_score', 'DOUBLE PRECISION'],
    ['setup_grade', 'TEXT'],
    ['em_pct', 'DOUBLE PRECISION'],
    ['cap_quality', 'DOUBLE PRECISION'],
    ['floor_quality', 'DOUBLE PRECISION'],
    ['rubric', 'INTEGER'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await p.query(`ALTER TABLE daily_grades ADD COLUMN IF NOT EXISTS ${col} ${type}`);
  }

  // Points are now WEIGHTED by seal-time quality, so they are no longer whole
  // numbers. Widening in place keeps every stored row; the cast is exact for the
  // integers already there. Guarded so a restart is not a table rewrite.
  await widenToDouble(p, 'daily_grades', [
    'cap_pts', 'floor_pts', 'flip_pts', 'apex_pts', 'range_pts', 'pts', 'max_pts',
  ]);

  await p.query(`
    CREATE TABLE IF NOT EXISTS daily_grade_days (
      date             DATE PRIMARY KEY,
      tickers          INTEGER,
      graded           INTEGER,
      ungraded         INTEGER,
      pts              INTEGER,
      max_pts          INTEGER,
      score            DOUBLE PRECISION,
      grade            TEXT,
      a_plus           INTEGER,
      a                INTEGER,
      b                INTEGER,
      c                INTEGER,
      d                INTEGER,
      f                INTEGER,
      cap_tested       INTEGER,
      cap_held         INTEGER,
      floor_tested     INTEGER,
      floor_held       INTEGER,
      flip_held        INTEGER,
      apex_pinned      INTEGER,
      range_contained  INTEGER,
      graded_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  for (const [col, type] of [
    ['setup_score', 'DOUBLE PRECISION'],
    ['regime_held', 'INTEGER'],
    ['reaction_hit', 'INTEGER'],
    ['pos_regime', 'INTEGER'],
    ['neg_regime', 'INTEGER'],
    ['chop_regime', 'INTEGER'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await p.query(`ALTER TABLE daily_grade_days ADD COLUMN IF NOT EXISTS ${col} ${type}`);
  }
  await widenToDouble(p, 'daily_grade_days', ['pts', 'max_pts']);

  _schemaReady = true;
  return true;
}

/**
 * Widen INTEGER columns to DOUBLE PRECISION, only the ones that still need it.
 * ALTER ... TYPE rewrites the table, so this asks information_schema first and
 * does nothing on every restart after the first.
 */
async function widenToDouble(p, table, cols) {
  const { rows } = await p.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 AND column_name = ANY($2) AND data_type <> 'double precision'`,
    [table, cols],
  );
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    await p.query(`ALTER TABLE ${table} ALTER COLUMN ${r.column_name} TYPE DOUBLE PRECISION`);
    console.log(`[daily-grades] widened ${table}.${r.column_name} to double precision`);
  }
}

// ── the seal ─────────────────────────────────────────────────────────────────

const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * Coerce a posted payload into { date, boards, note, sealedAt }. Throws on junk.
 *
 * The five levels are coerced to numbers-or-null because the board's contract is
 * that they are numeric; EVERYTHING ELSE on a board is carried through
 * untouched. That matters as of v2: the scorecard, the walls, the expected move
 * and the ladder diagnostics all ride on the board, and a normaliser that
 * rebuilt only the five levels would silently drop the entire premarket read on
 * its way into the table.
 */
function normalizeSeal(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('payload must be an object');
  const boardsIn = payload.boards;
  if (!boardsIn || typeof boardsIn !== 'object') throw new Error('payload.boards missing');
  const boards = {};
  for (const [t, v] of Object.entries(boardsIn)) {
    if (!v || typeof v !== 'object') continue;
    boards[String(t).toUpperCase()] = {
      ...v,
      apex: num(v.apex), cap: num(v.cap), flip: num(v.flip),
      floor: num(v.floor), spot: num(v.spot),
    };
  }
  if (!Object.keys(boards).length) throw new Error('payload.boards has no tickers');
  const date = String(payload.sealed_for_session || payload.date || etDateStr()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`bad session date: ${date}`);
  return {
    date,
    boards,
    note: payload.note == null ? null : String(payload.note),
    sealedAt: payload.sealed_at ? new Date(payload.sealed_at) : new Date(),
  };
}

/**
 * Store a sealed board.
 *
 * A seal is immutable once its session has opened — re-POSTing the same date
 * after 09:30 ET updates only the note, never the levels, because a board you
 * can edit mid-session is not a sealed board and grading it proves nothing.
 * `force` exists for backfilling a session you have the original file for.
 */
async function sealBoard(payload, { source = 'api', force = false } = {}) {
  if (!(await ensureSchema())) return { ok: false, error: 'no database' };
  const p = getPool();
  const { date, boards, note, sealedAt } = normalizeSeal(payload);

  const existing = await p.query(`SELECT date FROM daily_grade_seals WHERE date = $1`, [date]);
  const sessionOpen = Date.now() >= rthStartMs(date);
  if (existing.rowCount && sessionOpen && !force) {
    await p.query(
      `UPDATE daily_grade_seals SET note = COALESCE($2, note), updated_at = now() WHERE date = $1`,
      [date, note],
    );
    return { ok: true, date, tickers: Object.keys(boards).length, locked: true };
  }

  await p.query(
    `INSERT INTO daily_grade_seals (date, boards, note, sealed_at, source, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, $5, now())
     ON CONFLICT (date) DO UPDATE SET
       boards = EXCLUDED.boards, note = EXCLUDED.note,
       sealed_at = EXCLUDED.sealed_at, source = EXCLUDED.source, updated_at = now()`,
    [date, JSON.stringify(boards), note, sealedAt, source],
  );
  return { ok: true, date, tickers: Object.keys(boards).length, locked: false };
}

async function getSeal(date) {
  if (!(await ensureSchema())) return null;
  const p = getPool();
  const q = date
    ? await p.query(`SELECT * FROM daily_grade_seals WHERE date = $1`, [date])
    : await p.query(`SELECT * FROM daily_grade_seals ORDER BY date DESC LIMIT 1`);
  return q.rows[0] || null;
}

// ── building the seal ────────────────────────────────────────────────────────

/**
 * Most recent session in `eod_strike_gex` that actually carries the OI gamma
 * legs. Pre-open this is yesterday's ladder, re-stamped at 09:25 with the
 * settled overnight OI — which is exactly the input the level math wants. The
 * legs are nullable with no backfill (nothing before 2026-08-19 has them), so
 * this asks the table rather than assuming "yesterday".
 */
async function latestLadderDate(p, onOrBefore) {
  const { rows } = await p.query(
    `SELECT to_char(max(date), 'YYYY-MM-DD') AS d
       FROM eod_strike_gex
      WHERE oi_call_gex IS NOT NULL AND date <= $1::date`,
    [onOrBefore],
  );
  return rows[0]?.d || null;
}

/**
 * symbol → { strikes[], call[], put[], callMass, putMass } for one session,
 * strikes ascending.
 *
 * The two legs are stored abs because the level math and the wall-quality math
 * both want magnitudes; the SIGNED net is carried separately as callMass −
 * putMass, and is the fallback regime read for a symbol with no scanner sweep.
 */
async function ladderBySymbol(p, ladderDate) {
  const { rows } = await p.query(
    `SELECT symbol, strike, oi_call_gex, oi_put_gex
       FROM eod_strike_gex
      WHERE date = $1::date AND oi_call_gex IS NOT NULL
      ORDER BY symbol, strike`,
    [ladderDate],
  );
  const out = new Map();
  for (const r of rows) {
    const sym = String(r.symbol).toUpperCase().replace(/^\$/, '');
    let e = out.get(sym);
    if (!e) { e = { strikes: [], call: [], put: [], callMass: 0, putMass: 0 }; out.set(sym, e); }
    const c = Math.abs(Number(r.oi_call_gex) || 0);
    const pu = Math.abs(Number(r.oi_put_gex) || 0);
    e.strikes.push(Number(r.strike));
    e.call.push(c);
    e.put.push(pu);
    e.callMass += c;
    e.putMass += pu;
  }
  return out;
}

/**
 * symbol → the newest scanner sweep within the lookback.
 *
 * Pre-open the newest sweep is yesterday's 16:00 row, which is the right value
 * to seal with: it is the last thing the board actually was.
 *
 * v2 also reads `total_net_gex` (the regime's first input) and the true
 * `call_wall` / `put_wall` with the gamma sitting AT each — columns the sweep
 * has always written and this recorder had never asked for. cap/floor stay the
 * percentile levels they have always been; the walls ride alongside so the
 * scorecard can score the peak the read is actually about.
 */
async function scannerLevels(p, onOrBefore) {
  const { rows } = await p.query(
    `SELECT DISTINCT ON (symbol) symbol, ts, spot, cb, gex_flip,
            total_net_gex, call_wall, put_wall, call_wall_gex, put_wall_gex, cb_gex
       FROM scanner_snapshots
      WHERE date <= $1 AND date > to_char($1::date - $2::int, 'YYYY-MM-DD')
      ORDER BY symbol, ts DESC`,
    [onOrBefore, SCANNER_LOOKBACK_DAYS],
  );
  const out = new Map();
  for (const r of rows) {
    out.set(String(r.symbol).toUpperCase().replace(/^\$/, ''), {
      spot: num(r.spot), cb: num(r.cb), flip: num(r.gex_flip),
      netGex: num(r.total_net_gex),
      callWall: num(r.call_wall), putWall: num(r.put_wall),
      callWallGex: num(r.call_wall_gex), putWallGex: num(r.put_wall_gex),
      cbGex: num(r.cb_gex),
    });
  }
  return out;
}

/**
 * symbol → expected move for the session, as a percent of spot.
 *
 * The MEDIAN true range of the last EM_LOOKBACK graded sessions, read out of
 * `daily_grades` — the table this recorder fills, for this roster. Median rather
 * than mean because one CPI day should not become the whole month's expectation.
 *
 * A symbol with fewer than EM_MIN_SESSIONS on file gets null, and every consumer
 * treats a null EM as "no opinion" rather than substituting a guess: the
 * EM-alignment sub-score goes neutral and the components that need a scale fall
 * back to a fixed percentage at reduced weight. That is the honest failure mode
 * for a fresh database.
 *
 * THIS IS A REALIZED READ, NOT AN IMPLIED ONE, and nothing downstream pretends
 * otherwise. Swapping in an ATM-straddle EM means changing this function and
 * nothing else.
 */
async function emBySymbol(p, onOrBefore) {
  const { rows } = await p.query(
    `SELECT symbol,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY (h - l) / NULLIF(o, 0) * 100) AS em_pct,
            count(*) AS n
       FROM (
         SELECT symbol, o, h, l,
                row_number() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
           FROM daily_grades
          WHERE date < $1::date AND o IS NOT NULL AND h IS NOT NULL
            AND l IS NOT NULL AND o > 0
       ) s
      WHERE rn <= $2::int
      GROUP BY symbol`,
    [onOrBefore, EM_LOOKBACK],
  );
  const out = new Map();
  for (const r of rows) {
    if (Number(r.n) < EM_MIN_SESSIONS) continue;
    const v = num(r.em_pct);
    if (v != null && v > 0) out.set(String(r.symbol).toUpperCase(), v);
  }
  return out;
}

/**
 * The previous session's sealed boards, for the overnight-stability read.
 * Strictly before `session` and newest-first, so a long weekend or a missed seal
 * compares against the last board that actually existed rather than nothing.
 */
async function prevBoards(p, session) {
  const { rows } = await p.query(
    `SELECT date, boards FROM daily_grade_seals WHERE date < $1::date ORDER BY date DESC LIMIT 1`,
    [session],
  );
  if (!rows.length) return { date: null, boards: {} };
  return { date: etDateStr(new Date(rows[0].date)), boards: rows[0].boards || {} };
}

/** Live spots for the roster, best-effort. Falls back to the scanner spot. */
async function liveSpots(symbols) {
  try {
    const { fetchUnderlyingQuotes } = require('./proxy-tastytrade');
    const m = await fetchUnderlyingQuotes(symbols);
    const out = new Map();
    for (const sym of symbols) {
      const q = m?.get(sym);
      const v = num(q?.last ?? q?.mark ?? q?.close);
      if (v) out.set(sym, v);
    }
    return out;
  } catch (e) {
    console.warn('[daily-grades] live spots unavailable, using scanner spot:', e.message);
    return new Map();
  }
}

/**
 * Build the board for `date` and seal it.
 *
 * The roster is every symbol that has BOTH an OI ladder and a scanner sweep —
 * i.e. the scanner watchlist, arrived at from the data rather than from a second
 * copy of the list. A symbol with a ladder but no sweep still gets a board with
 * floor and cap and a null CB/flip; a symbol with neither is simply absent, and
 * the page shows it as "not graded" against the live watchlist.
 */
async function buildSeal(date, { force = false } = {}) {
  if (!(await ensureSchema())) return { ok: false, error: 'no database' };
  const p = getPool();
  const session = date || etDateStr();

  const ladderDate = await latestLadderDate(p, session);
  if (!ladderDate) return { ok: false, error: 'no OI ladder on file' };

  const [ladders, levels, ems, prev] = await Promise.all([
    ladderBySymbol(p, ladderDate),
    scannerLevels(p, session),
    emBySymbol(p, session).catch((e) => {
      console.warn('[daily-grades] expected move unavailable:', e.message);
      return new Map();
    }),
    prevBoards(p, session).catch(() => ({ date: null, boards: {} })),
  ]);
  if (!ladders.size) return { ok: false, error: `ladder ${ladderDate} is empty` };

  const symbols = [...new Set([...ladders.keys(), ...levels.keys()])].sort();
  const spots = await liveSpots(symbols);

  const boards = {};
  let withLevels = 0;
  let withScorecard = 0;
  const regimeCount = { positive: 0, negative: 0, transition: 0, unknown: 0 };
  for (const sym of symbols) {
    const lad = ladders.get(sym);
    const lv = levels.get(sym) || {};
    const fc = lad ? floorCeiling(lad.strikes, lad.call, lad.put) : null;
    if (fc) withLevels++;

    const spot = spots.get(sym) ?? lv.spot ?? null;
    const flip = lv.flip ?? null;
    const apex = lv.cb ?? null;
    const cap = fc ? fc.cap : null;
    const floor = fc ? fc.floor : null;
    // The scanner's chain total is the primary regime input; the ladder's own
    // signed mass is the fallback for a name the sweep missed. They answer the
    // same question off different inputs, so either alone is usable.
    const netGex = lv.netGex ?? (lad ? lad.callMass - lad.putMass : null);
    const emPct = ems.get(sym) ?? null;

    // ── the premarket scorecard ──────────────────────────────────────────────
    // Regime, wall quality, overnight stability and the call, all of it computed
    // ONCE here and frozen into the seal. The grader never recomputes any of it:
    // a scorecard that could move after the open is not a sealed call, and the
    // whole point of grading is that the claim was made in advance.
    let scorecard = null;
    try {
      scorecard = SC.buildScorecard({
        spot, flip, netGex,
        capLevel: cap, floorLevel: floor, apexLevel: apex,
        strikes: lad ? lad.strikes : [],
        callGex: lad ? lad.call : [],
        putGex: lad ? lad.put : [],
        emPct,
        prev: prev.boards[sym] || null,
      });
      if (scorecard) {
        withScorecard++;
        regimeCount[scorecard.regime] = (regimeCount[scorecard.regime] || 0) + 1;
      }
    } catch (e) {
      console.warn(`[daily-grades] scorecard ${sym}:`, e.message);
    }

    boards[sym] = {
      // The five the board renders.
      floor,
      cap,
      apex,
      flip,
      spot,
      // The rest of what the math saw, carried so a disagreement between the
      // two methods is inspectable instead of thrown away.
      ceiling_emp: fc ? fc.ceilingEmp : null,
      floor_emp: fc ? fc.floorEmp : null,
      ceiling_bell: fc ? fc.ceilingBell : null,
      floor_bell: fc ? fc.floorBell : null,
      mu_call: fc ? fc.muCall : null,
      sd_call: fc ? fc.sdCall : null,
      mu_put: fc ? fc.muPut : null,
      sd_put: fc ? fc.sdPut : null,
      strikes: fc ? fc.strikes : 0,
      // v2 — the structured read. `call_wall` / `put_wall` are the TRUE peaks
      // from the sweep, kept next to (not instead of) the percentile cap/floor:
      // they are two different readings of the same board and the page shows
      // both rather than quietly swapping one for the other.
      net_gex: netGex,
      em_pct: emPct,
      call_wall: lv.callWall ?? null,
      put_wall: lv.putWall ?? null,
      call_wall_gex: lv.callWallGex ?? null,
      put_wall_gex: lv.putWallGex ?? null,
      cb_gex: lv.cbGex ?? null,
      prev_session: prev.date,
      scorecard,
    };
  }

  const r = await sealBoard({
    boards,
    sealed_for_session: session,
    sealed_at: new Date().toISOString(),
    note: `Daily grades v${SC.SCORECARD_VERSION}. floor/cap = empirical percentile of the `
      + `${ladderDate} settled-OI gamma ladder; CB, flip, net GEX and the call/put walls from `
      + 'the last scanner sweep. Each ticker carries a premarket scorecard — regime first, then '
      + 'wall quality, overnight stability against '
      + (prev.date ? `the ${prev.date} seal` : 'no prior seal')
      + ', and one expected-reaction call. Expected move is the median true range of the last '
      + `${EM_LOOKBACK} graded sessions (realized, not implied). Sealed before the open and `
      + 'graded after the close against the table its own regime implies.',
  }, { source: 'engine', force });

  console.log(
    `[daily-grades] sealed ${session} — ${symbols.length} tickers, `
    + `${withLevels} with floor/cap from the ${ladderDate} ladder, ${withScorecard} scored `
    + `(+GEX ${regimeCount.positive} · −GEX ${regimeCount.negative} · flip ${regimeCount.transition})`
    + (r.locked ? ' (LOCKED: session already open, levels untouched)' : ''),
  );
  return { ...r, ladderDate, tickers: symbols.length, withLevels, withScorecard, regimes: regimeCount };
}

// ── the rubric (PURE — no I/O, no clock) ─────────────────────────────────────

const GRADE_BANDS = SC.GRADE_BANDS;

/**
 * Score one ticker. Pure function of the sealed board and the realized session —
 * every caller (the nightly run, the regrade route, a backtest) gets the same
 * answer from the same two inputs. Do not reach for a clock or a fetch in here.
 *
 * `sealed.scorecard` is the seal-time read (regime, wall quality, the call). It
 * decides WHICH table each level is scored against and HOW MUCH each component
 * weighs. A seal without one grades on the v1 path — positive-gamma tables, unit
 * weights, no regime and no reaction component — so the back catalogue regrades
 * to exactly the numbers it already had.
 */
function gradeTicker(sealed, ohlc) {
  const { floor = null, cap = null, apex = null, flip = null, spot = null } = sealed || {};
  const sc = sealed?.scorecard || null;
  const regime = sc?.regime || 'unknown';
  const o = num(ohlc?.o), h = num(ohlc?.h), l = num(ohlc?.l), c = num(ohlc?.c);

  const empty = {
    parts: {}, pts: null, maxPts: 0, score: null, grade: null,
    reachedCap: null, reachedFloor: null, reachedApex: null, crossedFlip: null,
    status: 'no_levels', scorecard: sc, regime: sc ? regime : null,
  };
  if (floor == null && cap == null && apex == null && flip == null) return empty;
  if (o == null || h == null || l == null || c == null) return { ...empty, status: 'no_candles' };

  const emPct = num(sc?.em_pct);
  // The follow-through test wants POINTS, not percent — a break is only a break
  // once it has travelled a real distance past the level.
  const emAbs = emPct != null && spot != null ? (emPct / 100) * spot : null;

  const parts = {};
  const weights = {};
  /**
   * Component weight. With NO scorecard this is flatly 1 for every component —
   * that is what makes a v1 session regrade to the exact number it already had.
   * Weighting only ever applies to a board that was actually scored at seal.
   */
  const w = (q) => (sc ? SC.weightOf(q) : 1);

  // 1. REGIME. The component the old rubric had no place for, and the one that
  //    says whether the map was being followed at all that morning.
  const reg = SC.gradeRegime(regime, { o, h, l, c }, emPct);
  if (reg) {
    parts.regime = reg;
    weights.regime = w(0.5 + 0.5 * (sc?.regime_conf ?? 0));
  }

  // 2. cap / floor, each against the table its own regime implies, each weighted
  //    by the wall's seal-time quality. A level nobody could have traded barely
  //    counts in either direction.
  parts.cap = SC.gradeWall(
    cap, cap != null && spot != null && spot > cap ? 'above' : 'below',
    regime, { o, h, l, c }, emAbs,
  );
  if (parts.cap) weights.cap = w(sc?.walls?.cap?.quality);

  parts.floor = SC.gradeWall(
    floor, floor != null && spot != null && spot < floor ? 'below' : 'above',
    regime, { o, h, l, c }, emAbs,
  );
  if (parts.floor) weights.floor = w(sc?.walls?.floor?.quality);

  // 3. flip — did the sealed regime survive, and did it survive untested? The
  //    outcome table is regime-independent (the flip IS the regime boundary),
  //    but a flip price was never going to argue with carries less weight.
  let crossedFlip = null;
  if (flip != null && spot != null) {
    const sealedAbove = spot > flip;
    const closedAbove = c > flip;
    crossedFlip = sealedAbove ? l <= flip : h >= flip;
    parts.flip = !closedAbove !== !sealedAbove
      ? { outcome: 'flipped', pts: 5 }
      : crossedFlip
        ? { outcome: 'held_after_test', pts: 18 }
        : { outcome: 'held_clean', pts: 25 };
    weights.flip = w(sc?.flip?.quality ?? (0.4 + 0.6 * (sc?.regime_conf ?? 0.5)));
  }

  // 4. apex (CB) — a magnet, so it is scored on where the close LANDED, not on a
  //    side. Weighted by how isolated and how reachable that strike was.
  let reachedApex = null;
  if (apex != null && c > 0) {
    reachedApex = l <= apex && h >= apex;
    const distPct = (Math.abs(c - apex) / c) * 100;
    const pts = distPct <= 0.25 ? 25 : distPct <= 0.5 ? 21 : distPct <= 1 ? 15 : distPct <= 2 ? 8 : 0;
    const outcome = distPct <= 0.25 ? 'pinned' : distPct <= 0.5 ? 'close' : distPct <= 1 ? 'near' : distPct <= 2 ? 'loose' : 'far';
    parts.apex = { outcome, pts, distPct: Number(distPct.toFixed(4)) };
    weights.apex = w(sc?.apex?.quality);
  }

  // 5. range — did the floor→cap band contain the session? Only meaningful when
  //    the band is the right way round; floor above cap is a legitimate board,
  //    not a range, and it scores nothing rather than scoring backwards.
  if (floor != null && cap != null && cap > floor) {
    const outs = (h > cap ? 1 : 0) + (l < floor ? 1 : 0);
    parts.range = outs === 0
      ? { outcome: 'contained', pts: 25 }
      : outs === 1 ? { outcome: 'one_side_out', pts: 12 } : { outcome: 'both_out', pts: 0 };
    const qs = [sc?.walls?.cap?.quality, sc?.walls?.floor?.quality].filter((v) => typeof v === 'number');
    weights.range = w(qs.length ? qs.reduce((a, b) => a + b, 0) / qs.length : undefined);
  }

  // 6. reaction — did the CALL happen? This is what makes the board answerable
  //    for the sentence it published, not only for the levels underneath it.
  const rx = SC.gradeReaction(sc, { o, h, l, c }, emAbs, emPct);
  if (rx) {
    parts.reaction = rx;
    weights.reaction = w(0.5 + 0.5 * (sc?.call_conf ?? 0));
  }

  let pts = 0;
  let maxPts = 0;
  for (const [k, v] of Object.entries(parts)) {
    if (!v) continue;
    const wt = weights[k] ?? 1;
    pts += v.pts * wt;
    maxPts += SC.COMPONENT_PTS * wt;
    v.weight = Number(wt.toFixed(3));
  }
  if (!maxPts) return { ...empty, status: 'no_levels' };

  const score = Number(((pts / maxPts) * 100).toFixed(2));
  return {
    parts,
    weights,
    pts: Number(pts.toFixed(2)),
    maxPts: Number(maxPts.toFixed(2)),
    score,
    grade: GRADE_BANDS(score),
    reachedCap: parts.cap ? parts.cap.reached : null,
    reachedFloor: parts.floor ? parts.floor.reached : null,
    reachedApex,
    crossedFlip,
    status: 'graded',
    scorecard: sc,
    regime: sc ? regime : null,
  };
}

// ── session O/H/L/C ──────────────────────────────────────────────────────────

const streamerFor = (symbol) => STREAMER_OVERRIDES[symbol] || symbol;

/** Shared secret for the loopback call — see proxy-auth.js. Empty when unset. */
const INTERNAL_HEADERS = process.env.INTERNAL_API_TOKEN
  ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN }
  : {};

/** dxLink candle times arrive as seconds on some feeds and ms on others. */
const toMs = (t) => (Number(t) < 1e12 ? Number(t) * 1000 : Number(t));

/**
 * RTH O/H/L/C for one ticker on one session, off /proxy/candles-intraday.
 * Bars are filtered to 09:30–16:00 ET of `date` — the raw pull starts 30m early
 * so the 09:30 bar is never clipped by a boundary rounding difference.
 */
async function fetchSessionOhlc(base, symbol, date) {
  const start = rthStartMs(date);
  const end = rthEndMs(date);
  const url = `${base}/proxy/candles-intraday?symbol=${encodeURIComponent(streamerFor(symbol))}`
    + `&interval=1m&fromMs=${start - 30 * 60_000}`;

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), CANDLE_TIMEOUT_MS);
  let json;
  try {
    // proxy-auth gates every /proxy/* route once PROXY_AUTH_REQUIRED=1, and this
    // is a server-to-server call with no session cookie — without the shared
    // secret every candle pull comes back 401 and the whole roster grades as
    // `no_candles`. Same header the other in-process callers send.
    const r = await fetch(url, { signal: ctl.signal, headers: INTERNAL_HEADERS });
    if (!r.ok) return { ok: false, reason: `http ${r.status}` };
    json = await r.json();
  } catch (e) {
    return { ok: false, reason: String(e?.message || e).slice(0, 120) };
  } finally {
    clearTimeout(t);
  }

  const bars = (Array.isArray(json?.candles) ? json.candles : [])
    .map((k) => ({ t: toMs(k.time), o: num(k.open), h: num(k.high), l: num(k.low), c: num(k.close) }))
    .filter((k) => Number.isFinite(k.t) && k.t >= start && k.t < end && k.o != null && k.c != null)
    .sort((a, b) => a.t - b.t);

  if (bars.length < MIN_BARS) return { ok: false, reason: `only ${bars.length} bars`, bars: bars.length };

  return {
    ok: true,
    bars: bars.length,
    o: bars[0].o,
    h: Math.max(...bars.map((k) => k.h)),
    l: Math.min(...bars.map((k) => k.l)),
    c: bars[bars.length - 1].c,
  };
}

/** Run `worker` over `items` at most CONCURRENCY at a time, in order. */
async function mapPool(items, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

// ── writes ───────────────────────────────────────────────────────────────────

async function upsertGrade(date, symbol, sealed, ohlc, g, source) {
  const p = getPool();
  const sc = sealed?.scorecard || null;
  // RAW points per component, before the weight — the weight is recoverable from
  // the scorecard and a raw 25 is what the rubric table actually says. Storing
  // the weighted number here would make two rubric changes indistinguishable.
  await p.query(
    `INSERT INTO daily_grades (
       date, symbol, sealed_spot, floor_lvl, cap_lvl, apex_lvl, flip_lvl,
       o, h, l, c, bars,
       cap_outcome, floor_outcome, flip_outcome, apex_outcome, range_outcome,
       cap_pts, floor_pts, flip_pts, apex_pts, range_pts,
       pts, max_pts, score, grade,
       reached_cap, reached_floor, reached_apex, crossed_flip,
       status, source,
       scorecard, regime, regime_conf, regime_outcome, regime_pts,
       reaction_call, reaction_outcome, reaction_pts,
       setup_score, setup_grade, em_pct, cap_quality, floor_quality, rubric,
       graded_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,
       $8,$9,$10,$11,$12,
       $13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22,
       $23,$24,$25,$26,
       $27,$28,$29,$30,
       $31,$32,
       $33::jsonb,$34,$35,$36,$37,
       $38,$39,$40,
       $41,$42,$43,$44,$45,$46,
       now()
     )
     ON CONFLICT (date, symbol) DO UPDATE SET
       sealed_spot = EXCLUDED.sealed_spot, floor_lvl = EXCLUDED.floor_lvl,
       cap_lvl = EXCLUDED.cap_lvl, apex_lvl = EXCLUDED.apex_lvl, flip_lvl = EXCLUDED.flip_lvl,
       o = EXCLUDED.o, h = EXCLUDED.h, l = EXCLUDED.l, c = EXCLUDED.c, bars = EXCLUDED.bars,
       cap_outcome = EXCLUDED.cap_outcome, floor_outcome = EXCLUDED.floor_outcome,
       flip_outcome = EXCLUDED.flip_outcome, apex_outcome = EXCLUDED.apex_outcome,
       range_outcome = EXCLUDED.range_outcome,
       cap_pts = EXCLUDED.cap_pts, floor_pts = EXCLUDED.floor_pts, flip_pts = EXCLUDED.flip_pts,
       apex_pts = EXCLUDED.apex_pts, range_pts = EXCLUDED.range_pts,
       pts = EXCLUDED.pts, max_pts = EXCLUDED.max_pts, score = EXCLUDED.score, grade = EXCLUDED.grade,
       reached_cap = EXCLUDED.reached_cap, reached_floor = EXCLUDED.reached_floor,
       reached_apex = EXCLUDED.reached_apex, crossed_flip = EXCLUDED.crossed_flip,
       status = EXCLUDED.status, source = EXCLUDED.source,
       scorecard = EXCLUDED.scorecard, regime = EXCLUDED.regime,
       regime_conf = EXCLUDED.regime_conf, regime_outcome = EXCLUDED.regime_outcome,
       regime_pts = EXCLUDED.regime_pts,
       reaction_call = EXCLUDED.reaction_call, reaction_outcome = EXCLUDED.reaction_outcome,
       reaction_pts = EXCLUDED.reaction_pts,
       setup_score = EXCLUDED.setup_score, setup_grade = EXCLUDED.setup_grade,
       em_pct = EXCLUDED.em_pct, cap_quality = EXCLUDED.cap_quality,
       floor_quality = EXCLUDED.floor_quality, rubric = EXCLUDED.rubric,
       graded_at = now()`,
    [
      date, symbol, sealed.spot ?? null, sealed.floor ?? null, sealed.cap ?? null,
      sealed.apex ?? null, sealed.flip ?? null,
      ohlc?.o ?? null, ohlc?.h ?? null, ohlc?.l ?? null, ohlc?.c ?? null, ohlc?.bars ?? null,
      g.parts.cap?.outcome ?? null, g.parts.floor?.outcome ?? null, g.parts.flip?.outcome ?? null,
      g.parts.apex?.outcome ?? null, g.parts.range?.outcome ?? null,
      g.parts.cap?.pts ?? null, g.parts.floor?.pts ?? null, g.parts.flip?.pts ?? null,
      g.parts.apex?.pts ?? null, g.parts.range?.pts ?? null,
      g.pts, g.maxPts, g.score, g.grade,
      g.reachedCap, g.reachedFloor, g.reachedApex, g.crossedFlip,
      g.status, source,
      sc ? JSON.stringify(sc) : null,
      sc?.regime ?? null, sc?.regime_conf ?? null,
      g.parts.regime?.outcome ?? null, g.parts.regime?.pts ?? null,
      sc?.call ?? null, g.parts.reaction?.outcome ?? null, g.parts.reaction?.pts ?? null,
      sc?.setup ?? null, sc?.setup_grade ?? null, sc?.em_pct ?? null,
      sc?.walls?.cap?.quality ?? null, sc?.walls?.floor?.quality ?? null,
      sc?.v ?? 1,
    ],
  );
}

/**
 * The day row. Points are SUMMED across tickers and divided by the summed
 * points-available — not averaged over per-ticker percentages, which would give
 * a one-level ticker the same weight as a four-level one.
 */
/**
 * The v2 outcome vocabulary, grouped by what the count is asking.
 *
 * TESTED and HELD have to be sets, not string equality, because the same event
 * has a different NAME in each regime — a wall that was reached and rejected is
 * `tagged_held` in positive gamma, `absorbed` in negative gamma and `chop_held`
 * on the flip. The counts are about what price DID, so they collapse the three
 * vocabularies back into one question. `held` here means "closed back inside",
 * which is deliberately NOT the same as "scored well": in negative gamma a hold
 * scores below a break, and the day row shows both numbers so the difference is
 * visible rather than averaged away.
 */
const WALL_TESTED = new Set([
  'tagged_held', 'tagged_broke',                       // positive
  'absorbed', 'broke_accelerated', 'broke_reverted',   // negative
  'chop_held', 'chop_broke',                           // transition
]);
const WALL_HELD = new Set([
  'tagged_held', 'untested_held',
  'absorbed', 'untested_quiet',
  'chop_held',
]);

async function rollUpDay(date) {
  const p = getPool();
  const { rows } = await p.query(
    `SELECT symbol, pts, max_pts, grade, status, regime, setup_score,
            cap_outcome, floor_outcome, flip_outcome, apex_outcome, range_outcome,
            regime_outcome, reaction_outcome
       FROM daily_grades WHERE date = $1`,
    [date],
  );
  if (!rows.length) return null;

  const graded = rows.filter((r) => r.status === 'graded');
  const pts = graded.reduce((s, r) => s + (Number(r.pts) || 0), 0);
  const maxPts = graded.reduce((s, r) => s + (Number(r.max_pts) || 0), 0);
  const score = maxPts ? Number(((pts / maxPts) * 100).toFixed(2)) : null;
  const count = (fn) => graded.filter(fn).length;

  // Mean over the names that HAVE a setup score. A v1 row has none and must not
  // be read as a zero-quality map — it is a map nobody scored.
  const setups = graded.map((r) => Number(r.setup_score)).filter((v) => Number.isFinite(v));
  const setupScore = setups.length
    ? Number((setups.reduce((a, b) => a + b, 0) / setups.length).toFixed(2))
    : null;

  const day = {
    date,
    tickers: rows.length,
    graded: graded.length,
    ungraded: rows.length - graded.length,
    pts: Number(pts.toFixed(2)),
    maxPts: Number(maxPts.toFixed(2)),
    score,
    grade: score == null ? null : GRADE_BANDS(score),
    aPlus: count((r) => r.grade === 'A+'),
    a: count((r) => r.grade === 'A'),
    b: count((r) => r.grade === 'B'),
    c: count((r) => r.grade === 'C'),
    d: count((r) => r.grade === 'D'),
    f: count((r) => r.grade === 'F'),
    capTested: count((r) => WALL_TESTED.has(r.cap_outcome)),
    capHeld: count((r) => WALL_HELD.has(r.cap_outcome)),
    floorTested: count((r) => WALL_TESTED.has(r.floor_outcome)),
    floorHeld: count((r) => WALL_HELD.has(r.floor_outcome)),
    flipHeld: count((r) => r.flip_outcome === 'held_clean' || r.flip_outcome === 'held_after_test'),
    apexPinned: count((r) => r.apex_outcome === 'pinned' || r.apex_outcome === 'close'),
    rangeContained: count((r) => r.range_outcome === 'contained'),
    // v2 — how the session treated the READ, not just the levels.
    setupScore,
    regimeHeld: count((r) => r.regime_outcome === 'regime_held'),
    reactionHit: count((r) => r.reaction_outcome === 'call_hit'),
    posRegime: count((r) => r.regime === 'positive'),
    negRegime: count((r) => r.regime === 'negative'),
    chopRegime: count((r) => r.regime === 'transition'),
  };

  await p.query(
    `INSERT INTO daily_grade_days (
       date, tickers, graded, ungraded, pts, max_pts, score, grade,
       a_plus, a, b, c, d, f,
       cap_tested, cap_held, floor_tested, floor_held, flip_held, apex_pinned, range_contained,
       setup_score, regime_held, reaction_hit, pos_regime, neg_regime, chop_regime,
       graded_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
               $22,$23,$24,$25,$26,$27, now())
     ON CONFLICT (date) DO UPDATE SET
       tickers = EXCLUDED.tickers, graded = EXCLUDED.graded, ungraded = EXCLUDED.ungraded,
       pts = EXCLUDED.pts, max_pts = EXCLUDED.max_pts, score = EXCLUDED.score, grade = EXCLUDED.grade,
       a_plus = EXCLUDED.a_plus, a = EXCLUDED.a, b = EXCLUDED.b, c = EXCLUDED.c,
       d = EXCLUDED.d, f = EXCLUDED.f,
       cap_tested = EXCLUDED.cap_tested, cap_held = EXCLUDED.cap_held,
       floor_tested = EXCLUDED.floor_tested, floor_held = EXCLUDED.floor_held,
       flip_held = EXCLUDED.flip_held, apex_pinned = EXCLUDED.apex_pinned,
       range_contained = EXCLUDED.range_contained,
       setup_score = EXCLUDED.setup_score, regime_held = EXCLUDED.regime_held,
       reaction_hit = EXCLUDED.reaction_hit, pos_regime = EXCLUDED.pos_regime,
       neg_regime = EXCLUDED.neg_regime, chop_regime = EXCLUDED.chop_regime,
       graded_at = now()`,
    [
      day.date, day.tickers, day.graded, day.ungraded, day.pts, day.maxPts, day.score, day.grade,
      day.aPlus, day.a, day.b, day.c, day.d, day.f,
      day.capTested, day.capHeld, day.floorTested, day.floorHeld,
      day.flipHeld, day.apexPinned, day.rangeContained,
      day.setupScore, day.regimeHeld, day.reactionHit,
      day.posRegime, day.negRegime, day.chopRegime,
    ],
  );
  return day;
}

// ── the run ──────────────────────────────────────────────────────────────────

/**
 * Grade one session. Idempotent: re-running overwrites the same (date, symbol)
 * rows and re-rolls the day. Returns null when there is nothing to do, so the
 * scheduler can keep its latch unset and try again later.
 */
async function gradeSession(base, dateArg, { force = false } = {}) {
  if (!(await ensureSchema())) { console.warn('[daily-grades] no database — skipping'); return null; }
  const date = dateArg || etDateStr();

  if (!force && !isTradingDay(date)) return null;

  const seal = await getSeal(date);
  if (!seal) {
    console.warn(`[daily-grades] no sealed board for ${date} — nothing to grade`);
    return null;
  }
  if (!force && Date.now() < rthEndMs(date)) {
    console.warn(`[daily-grades] ${date} has not closed yet — skipping`);
    return null;
  }

  const boards = seal.boards || {};
  const symbols = Object.keys(boards).sort();
  const t0 = Date.now();
  console.log(`[daily-grades] grading ${date} — ${symbols.length} tickers, ${CONCURRENCY} at a time`);

  let ok = 0;
  let skipped = 0;
  await mapPool(symbols, async (symbol) => {
    const sealed = boards[symbol] || {};
    let ohlc = null;
    let status = null;
    try {
      const r = await fetchSessionOhlc(base, symbol, date);
      if (r.ok) ohlc = r;
      else status = r.reason;
    } catch (e) {
      status = String(e?.message || e).slice(0, 120);
    }

    const g = gradeTicker(sealed, ohlc);
    if (g.status !== 'graded') {
      skipped++;
      if (status) console.warn(`[daily-grades] ${symbol}: ${status}`);
    } else ok++;

    try {
      await upsertGrade(date, symbol, sealed, ohlc, g, 'auto');
    } catch (e) {
      console.warn(`[daily-grades] write ${symbol}:`, e.message);
    }
  });

  const day = await rollUpDay(date);
  console.log(
    `[daily-grades] ${date} done — ${ok} graded, ${skipped} skipped, `
    + `day ${day?.score ?? '—'} (${day?.grade ?? '—'}) in ${Math.round((Date.now() - t0) / 1000)}s`,
  );
  // Nothing graded at all is a WIRING fault, not a market outcome — an auth
  // rejection, a dead feed, a bad base URL. Say so once, loudly, instead of
  // leaving a zeroed day row to be read as "the board was wrong today".
  if (ok === 0 && symbols.length) {
    console.error(
      `[daily-grades] ${date} graded NOTHING across ${symbols.length} tickers — `
      + 'that is a plumbing failure, not a result. Check the per-ticker reasons above '
      + `(401 ⇒ INTERNAL_API_TOKEN missing/wrong for the loopback call).`,
    );
  }
  return { date, graded: ok, skipped, day };
}

/**
 * Re-score a session from the O/H/L/C already on disk. No network. This is the
 * whole reason the raw session is stored next to the grade: a rubric change is
 * a regrade, and a regrade is instant and reproducible.
 *
 * The seal-time SCORECARD is stored on the row too, so a v2 regrade re-scores
 * against the regime and the wall quality that were sealed that morning rather
 * than against today's read of them. A row with no scorecard falls back to the
 * seal (a v1 session backfilled by a later build may have one on the seal but
 * not yet on the grade row) and, failing that, to the v1 path.
 */
async function regradeSession(date) {
  if (!(await ensureSchema())) return null;
  const p = getPool();
  const { rows } = await p.query(
    `SELECT symbol, sealed_spot, floor_lvl, cap_lvl, apex_lvl, flip_lvl, o, h, l, c, bars, scorecard
       FROM daily_grades WHERE date = $1`,
    [date],
  );
  if (!rows.length) return null;

  const seal = await getSeal(date);
  const boards = seal?.boards || {};

  for (const r of rows) {
    const sealed = {
      spot: r.sealed_spot, floor: r.floor_lvl, cap: r.cap_lvl, apex: r.apex_lvl, flip: r.flip_lvl,
      scorecard: r.scorecard || boards[r.symbol]?.scorecard || null,
    };
    const ohlc = r.o == null ? null : { o: r.o, h: r.h, l: r.l, c: r.c, bars: r.bars };
    await upsertGrade(date, r.symbol, sealed, ohlc, gradeTicker(sealed, ohlc), 'regrade');
  }
  const day = await rollUpDay(date);
  console.log(`[daily-grades] regraded ${date} — ${rows.length} tickers, day ${day?.score ?? '—'}`);
  return { date, regraded: rows.length, day };
}

/** Everything /proxy/daily-grades serves: the seal, the grades, the day row. */
async function readSession(date) {
  if (!(await ensureSchema())) return null;
  const p = getPool();
  const seal = await getSeal(date);
  if (!seal) return null;
  const d = etDateStr(new Date(seal.date));
  const [grades, day] = await Promise.all([
    p.query(`SELECT * FROM daily_grades WHERE date = $1 ORDER BY symbol`, [d]),
    p.query(`SELECT * FROM daily_grade_days WHERE date = $1`, [d]),
  ]);
  return {
    boards: seal.boards,
    note: seal.note,
    sealed_at: seal.sealed_at,
    sealed_for_session: d,
    grades: grades.rows,
    day: day.rows[0] || null,
  };
}

// ── history ──────────────────────────────────────────────────────────────────
//
// The grade tables have always been keyed by date — `daily_grades` on
// (date, symbol), `daily_grade_days` on date — so every session ever graded is
// still on disk. Nothing below writes; these are the two READ paths the board
// was missing, and they are why the tables are keyed that way in the first
// place.

/** Ceiling on a history window, so a hand-typed `?days=99999` can't scan the table. */
const HISTORY_MAX_DAYS = 500;
const HISTORY_DEFAULT_DAYS = 60;

function historyLimit(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return HISTORY_DEFAULT_DAYS;
  return Math.min(Math.floor(n), HISTORY_MAX_DAYS);
}

/**
 * One ticker's grade, session by session, newest first. Rides
 * `idx_daily_grades_symbol`.
 *
 * Ungraded sessions (no levels, no candles) come back too — a gap in the record
 * IS part of the record, and dropping them would make a name look better
 * attended than it was. `day_score` / `day_grade` ride along from the roll-up so
 * a row reads against the session it sat in: a C on a day the whole board scored
 * 48 is not the same C as one on a day the board scored 84.
 */
async function readTickerHistory(symbol, days) {
  if (!(await ensureSchema())) return null;
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) throw new Error('symbol required');
  const p = getPool();
  const limit = historyLimit(days);

  const { rows } = await p.query(
    `SELECT g.*, d.score AS day_score, d.grade AS day_grade
       FROM daily_grades g
       LEFT JOIN daily_grade_days d ON d.date = g.date
      WHERE g.symbol = $1
      ORDER BY g.date DESC
      LIMIT $2`,
    [sym, limit],
  );
  const out = rows.map((r) => ({ ...r, date: etDateStr(new Date(r.date)) }));

  // Summed over the graded rows only — an ungraded session has no score and
  // must not drag the average down.
  const scored = out.filter((r) => r.score != null);
  const pts = out.reduce((a, r) => a + (r.pts || 0), 0);
  const maxPts = out.reduce((a, r) => a + (r.max_pts || 0), 0);
  const counts = {};
  for (const r of out) if (r.grade) counts[r.grade] = (counts[r.grade] || 0) + 1;

  return {
    symbol: sym,
    days: limit,
    rows: out,
    summary: {
      sessions: out.length,
      graded: scored.length,
      ungraded: out.length - scored.length,
      pts,
      max_pts: maxPts,
      // Same arithmetic rollUpDay() uses: summed points over summed
      // points-available, NOT the mean of the per-session percentages.
      score: maxPts > 0 ? (pts / maxPts) * 100 : null,
      grade: maxPts > 0 ? GRADE_BANDS((pts / maxPts) * 100) : null,
      best: scored.length ? Math.max(...scored.map((r) => r.score)) : null,
      worst: scored.length ? Math.min(...scored.map((r) => r.score)) : null,
      counts,
    },
  };
}

/**
 * The running session table: one row per graded date, newest first.
 * `daily_grade_days` was already exactly this — it just had no route out.
 */
async function readDayHistory(days) {
  if (!(await ensureSchema())) return null;
  const p = getPool();
  const limit = historyLimit(days);
  const { rows } = await p.query(
    `SELECT * FROM daily_grade_days ORDER BY date DESC LIMIT $1`,
    [limit],
  );
  const out = rows.map((r) => ({ ...r, date: etDateStr(new Date(r.date)) }));

  const pts = out.reduce((a, r) => a + (r.pts || 0), 0);
  const maxPts = out.reduce((a, r) => a + (r.max_pts || 0), 0);
  const scored = out.filter((r) => r.score != null);

  return {
    days: limit,
    rows: out,
    summary: {
      sessions: out.length,
      pts,
      max_pts: maxPts,
      score: maxPts > 0 ? (pts / maxPts) * 100 : null,
      grade: maxPts > 0 ? GRADE_BANDS((pts / maxPts) * 100) : null,
      best: scored.length ? Math.max(...scored.map((r) => r.score)) : null,
      worst: scored.length ? Math.min(...scored.map((r) => r.score)) : null,
    },
  };
}

// ── scheduler ────────────────────────────────────────────────────────────────

let _timer = null;
let _lastGradedDate = null;
let _lastSealedDate = null;

function startDailyGradesRecorder(port) {
  const base = `http://localhost:${port}`;
  const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  console.log(
    `[daily-grades] enabled — seals ${hhmm(SEAL_HOUR, SEAL_MIN)} ET, `
    + `grades ${hhmm(GRADE_HOUR, GRADE_MIN)} ET, trading days `
    + '→ daily_grade_seals / daily_grades / daily_grade_days',
  );

  const tick = () => {
    const today = etDateStr();
    if (!isTradingDay(today)) return;
    const { hour, minute } = etParts();
    const mins = hour * 60 + minute;

    // Seal first — the same tick can seal in the morning and grade in the
    // afternoon, and the two latches are separate so a failed seal does not
    // block the grade (there may be a board POSTed from elsewhere).
    if (_lastSealedDate !== today && mins >= SEAL_HOUR * 60 + SEAL_MIN && mins < GRADE_HOUR * 60 + GRADE_MIN) {
      buildSeal(today)
        .then((r) => { if (r?.ok) _lastSealedDate = today; })
        .catch((e) => console.warn('[daily-grades] seal:', e.message));
      return;
    }

    if (_lastGradedDate === today) return;
    if (mins < GRADE_HOUR * 60 + GRADE_MIN) return;

    gradeSession(base, today)
      .then((r) => { if (r) _lastGradedDate = today; })
      .catch((e) => console.warn('[daily-grades] run:', e.message));
  };

  setTimeout(tick, 90_000).unref?.();
  _timer = setInterval(tick, CHECK_MS);
  _timer.unref?.();
  return () => { if (_timer) clearInterval(_timer); };
}

module.exports = {
  startDailyGradesRecorder,
  buildSeal,
  gradeSession,
  regradeSession,
  readSession,
  readTickerHistory,
  readDayHistory,
  sealBoard,
  getSeal,
  gradeTicker,
  rollUpDay,
  ensureSchema,
  getPool,
  // v2 — the scorecard's own seams, exposed for the selftest and for anything
  // that wants to re-derive a premarket read without going through a seal.
  scorecard: SC,
  emBySymbol,
  prevBoards,
  WALL_TESTED,
  WALL_HELD,
};
