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
 * WHAT "CORRECT" MEANS. Each level is scored on two questions, because either
 * alone is misleading. RESPECT: did price close back on the side the seal left
 * it on? REACH: did price actually get to the level at all? A cap that price
 * never came within a mile of was not "respected" — it was untested, and it
 * scores lower than one that got tagged and rejected. A cap that got tagged and
 * broken scores lower still. That ordering is the rubric.
 *
 *   cap    (call-gamma p80)          tagged+held 25 · untested 15 · tagged+broke 5 · gapped through 0
 *   floor  (put-gamma p20)           same four, mirrored
 *   flip   (gamma flip)              held clean 25 · held after a test 18 · flipped 5
 *   apex   (CB)                      magnet: |close − apex| as % of close, 25/21/15/8/0
 *   range  (floor→cap band)          contained 25 · one side out 12 · both out 0
 *
 * A ticker's score is points / points-available × 100, so a name with no flip is
 * not punished for the missing component. Letter bands are the house bands from
 * _lib-pick-grade.cjs — A+ 85 / A 72 / B 58 / C 44 / D 28 / F — deliberately, so
 * a grade means the same thing on both boards. `max_pts = 0` (nothing gradable)
 * stores as status `no_levels` and NULL grade rather than an F: an F is a claim
 * about the board, and there was no board.
 *
 * The day row is the straight SUM of every graded ticker's points over the sum
 * of their points-available — NOT the mean of the per-ticker percentages, which
 * would let a one-level ticker swing the session as hard as a four-level one.
 *
 * Cadence: checks every 5m; seals once at/after 09:26 ET, grades once at/after
 *          16:20 ET, trading days only.
 * Wiring:  startDailyGradesRecorder(PORT) in server-with-proxy.js.
 * Routes:  GET  /proxy/daily-grades[?date=]      seal + grades + day roll-up
 *          POST /proxy/daily-grades-build        build + seal the board now
 *          POST /proxy/daily-grades-seal         store a board built elsewhere
 *          POST /proxy/daily-grades-run          grade now (manual fire)
 *          POST /proxy/daily-grades-regrade      re-score stored O/H/L/C
 */

// ── config ───────────────────────────────────────────────────────────────────

const { floorCeiling } = require('./daily-grades-levels');

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

  _schemaReady = true;
  return true;
}

// ── the seal ─────────────────────────────────────────────────────────────────

const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Coerce a posted payload into { date, boards, note, sealedAt }. Throws on junk. */
function normalizeSeal(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('payload must be an object');
  const boardsIn = payload.boards;
  if (!boardsIn || typeof boardsIn !== 'object') throw new Error('payload.boards missing');
  const boards = {};
  for (const [t, v] of Object.entries(boardsIn)) {
    if (!v || typeof v !== 'object') continue;
    boards[String(t).toUpperCase()] = {
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

/** symbol → { strikes[], call[], put[] } for one session, strikes ascending. */
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
    if (!e) { e = { strikes: [], call: [], put: [] }; out.set(sym, e); }
    e.strikes.push(Number(r.strike));
    e.call.push(Math.abs(Number(r.oi_call_gex) || 0));
    e.put.push(Math.abs(Number(r.oi_put_gex) || 0));
  }
  return out;
}

/**
 * symbol → { spot, cb, flip } from the newest scanner sweep within the lookback.
 * Pre-open the newest sweep is yesterday's 16:00 row, which is the right value
 * to seal with: it is the last thing the board actually was.
 */
async function scannerLevels(p, onOrBefore) {
  const { rows } = await p.query(
    `SELECT DISTINCT ON (symbol) symbol, ts, spot, cb, gex_flip
       FROM scanner_snapshots
      WHERE date <= $1 AND date > to_char($1::date - $2::int, 'YYYY-MM-DD')
      ORDER BY symbol, ts DESC`,
    [onOrBefore, SCANNER_LOOKBACK_DAYS],
  );
  const out = new Map();
  for (const r of rows) {
    out.set(String(r.symbol).toUpperCase().replace(/^\$/, ''), {
      spot: num(r.spot), cb: num(r.cb), flip: num(r.gex_flip),
    });
  }
  return out;
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

  const [ladders, levels] = await Promise.all([
    ladderBySymbol(p, ladderDate),
    scannerLevels(p, session),
  ]);
  if (!ladders.size) return { ok: false, error: `ladder ${ladderDate} is empty` };

  const symbols = [...new Set([...ladders.keys(), ...levels.keys()])].sort();
  const spots = await liveSpots(symbols);

  const boards = {};
  let withLevels = 0;
  for (const sym of symbols) {
    const lad = ladders.get(sym);
    const lv = levels.get(sym) || {};
    const fc = lad ? floorCeiling(lad.strikes, lad.call, lad.put) : null;
    if (fc) withLevels++;
    boards[sym] = {
      // The five the board renders.
      floor: fc ? fc.floor : null,
      cap: fc ? fc.cap : null,
      apex: lv.cb ?? null,
      flip: lv.flip ?? null,
      spot: spots.get(sym) ?? lv.spot ?? null,
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
    };
  }

  const r = await sealBoard({
    boards,
    sealed_for_session: session,
    sealed_at: new Date().toISOString(),
    note: `Daily grades. floor/cap = empirical percentile of the ${ladderDate} settled-OI `
      + 'gamma ladder; CB and flip from the last scanner sweep. Sealed before the open '
      + 'and graded after the close.',
  }, { source: 'engine', force });

  console.log(
    `[daily-grades] sealed ${session} — ${symbols.length} tickers, `
    + `${withLevels} with floor/cap from the ${ladderDate} ladder`
    + (r.locked ? ' (LOCKED: session already open, levels untouched)' : ''),
  );
  return { ...r, ladderDate, tickers: symbols.length, withLevels };
}

// ── the rubric (PURE — no I/O, no clock) ─────────────────────────────────────

const GRADE_BANDS = (pts) =>
  pts >= 85 ? 'A+' : pts >= 72 ? 'A' : pts >= 58 ? 'B' : pts >= 44 ? 'C' : pts >= 28 ? 'D' : 'F';

/** cap and floor share this shape; `side` is which side of the level the seal left price on. */
function gradeWall(level, side, o, h, l, c) {
  if (level == null) return null;
  const inside = side === 'below' ? (v) => v <= level : (v) => v >= level;
  const reached = side === 'below' ? h >= level : l <= level;
  const openedThrough = !inside(o);
  const closedInside = inside(c);

  if (openedThrough && !closedInside) return { outcome: 'gapped_through', pts: 0, reached };
  if (reached && closedInside) return { outcome: 'tagged_held', pts: 25, reached };
  if (!reached && closedInside) return { outcome: 'untested_held', pts: 15, reached };
  return { outcome: 'tagged_broke', pts: 5, reached };
}

/**
 * Score one ticker. Pure function of the sealed board and the realized session —
 * every caller (the nightly run, the regrade route, a backtest) gets the same
 * answer from the same two inputs. Do not reach for a clock or a fetch in here.
 */
function gradeTicker(sealed, ohlc) {
  const { floor = null, cap = null, apex = null, flip = null, spot = null } = sealed || {};
  const o = num(ohlc?.o), h = num(ohlc?.h), l = num(ohlc?.l), c = num(ohlc?.c);

  const empty = {
    parts: {}, pts: null, maxPts: 0, score: null, grade: null,
    reachedCap: null, reachedFloor: null, reachedApex: null, crossedFlip: null,
    status: 'no_levels',
  };
  if (floor == null && cap == null && apex == null && flip == null) return empty;
  if (o == null || h == null || l == null || c == null) return { ...empty, status: 'no_candles' };

  const parts = {};

  // cap — strongest POSITIVE gex. The seal's own spot decides which side it was on.
  parts.cap = gradeWall(cap, cap != null && spot != null && spot > cap ? 'above' : 'below', o, h, l, c);
  // floor — strongest NEGATIVE gex, mirrored.
  parts.floor = gradeWall(floor, floor != null && spot != null && spot < floor ? 'below' : 'above', o, h, l, c);

  // flip — did the sealed regime survive, and did it survive untested?
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
  }

  // apex (CB) — a magnet, so it is scored on where the close LANDED, not on a side.
  let reachedApex = null;
  if (apex != null && c > 0) {
    reachedApex = l <= apex && h >= apex;
    const distPct = (Math.abs(c - apex) / c) * 100;
    const pts = distPct <= 0.25 ? 25 : distPct <= 0.5 ? 21 : distPct <= 1 ? 15 : distPct <= 2 ? 8 : 0;
    const outcome = distPct <= 0.25 ? 'pinned' : distPct <= 0.5 ? 'close' : distPct <= 1 ? 'near' : distPct <= 2 ? 'loose' : 'far';
    parts.apex = { outcome, pts, distPct: Number(distPct.toFixed(4)) };
  }

  // range — did the floor→cap band contain the session? Only meaningful when the
  // band is the right way round; floor above cap is a legitimate board, not a
  // range, and it scores nothing rather than scoring backwards.
  if (floor != null && cap != null && cap > floor) {
    const outs = (h > cap ? 1 : 0) + (l < floor ? 1 : 0);
    parts.range = outs === 0
      ? { outcome: 'contained', pts: 25 }
      : outs === 1 ? { outcome: 'one_side_out', pts: 12 } : { outcome: 'both_out', pts: 0 };
  }

  let pts = 0;
  let maxPts = 0;
  for (const v of Object.values(parts)) {
    if (!v) continue;
    pts += v.pts;
    maxPts += 25;
  }
  if (!maxPts) return { ...empty, status: 'no_levels' };

  const score = Number(((pts / maxPts) * 100).toFixed(2));
  return {
    parts,
    pts,
    maxPts,
    score,
    grade: GRADE_BANDS(score),
    reachedCap: parts.cap ? parts.cap.reached : null,
    reachedFloor: parts.floor ? parts.floor.reached : null,
    reachedApex,
    crossedFlip,
    status: 'graded',
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
  await p.query(
    `INSERT INTO daily_grades (
       date, symbol, sealed_spot, floor_lvl, cap_lvl, apex_lvl, flip_lvl,
       o, h, l, c, bars,
       cap_outcome, floor_outcome, flip_outcome, apex_outcome, range_outcome,
       cap_pts, floor_pts, flip_pts, apex_pts, range_pts,
       pts, max_pts, score, grade,
       reached_cap, reached_floor, reached_apex, crossed_flip,
       status, source, graded_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,
       $8,$9,$10,$11,$12,
       $13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22,
       $23,$24,$25,$26,
       $27,$28,$29,$30,
       $31,$32, now()
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
       status = EXCLUDED.status, source = EXCLUDED.source, graded_at = now()`,
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
    ],
  );
}

/**
 * The day row. Points are SUMMED across tickers and divided by the summed
 * points-available — not averaged over per-ticker percentages, which would give
 * a one-level ticker the same weight as a four-level one.
 */
async function rollUpDay(date) {
  const p = getPool();
  const { rows } = await p.query(
    `SELECT symbol, pts, max_pts, grade, status,
            cap_outcome, floor_outcome, flip_outcome, apex_outcome, range_outcome
       FROM daily_grades WHERE date = $1`,
    [date],
  );
  if (!rows.length) return null;

  const graded = rows.filter((r) => r.status === 'graded');
  const pts = graded.reduce((s, r) => s + (Number(r.pts) || 0), 0);
  const maxPts = graded.reduce((s, r) => s + (Number(r.max_pts) || 0), 0);
  const score = maxPts ? Number(((pts / maxPts) * 100).toFixed(2)) : null;
  const count = (fn) => graded.filter(fn).length;

  const day = {
    date,
    tickers: rows.length,
    graded: graded.length,
    ungraded: rows.length - graded.length,
    pts,
    maxPts,
    score,
    grade: score == null ? null : GRADE_BANDS(score),
    aPlus: count((r) => r.grade === 'A+'),
    a: count((r) => r.grade === 'A'),
    b: count((r) => r.grade === 'B'),
    c: count((r) => r.grade === 'C'),
    d: count((r) => r.grade === 'D'),
    f: count((r) => r.grade === 'F'),
    capTested: count((r) => r.cap_outcome === 'tagged_held' || r.cap_outcome === 'tagged_broke'),
    capHeld: count((r) => r.cap_outcome === 'tagged_held' || r.cap_outcome === 'untested_held'),
    floorTested: count((r) => r.floor_outcome === 'tagged_held' || r.floor_outcome === 'tagged_broke'),
    floorHeld: count((r) => r.floor_outcome === 'tagged_held' || r.floor_outcome === 'untested_held'),
    flipHeld: count((r) => r.flip_outcome === 'held_clean' || r.flip_outcome === 'held_after_test'),
    apexPinned: count((r) => r.apex_outcome === 'pinned' || r.apex_outcome === 'close'),
    rangeContained: count((r) => r.range_outcome === 'contained'),
  };

  await p.query(
    `INSERT INTO daily_grade_days (
       date, tickers, graded, ungraded, pts, max_pts, score, grade,
       a_plus, a, b, c, d, f,
       cap_tested, cap_held, floor_tested, floor_held, flip_held, apex_pinned, range_contained,
       graded_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, now())
     ON CONFLICT (date) DO UPDATE SET
       tickers = EXCLUDED.tickers, graded = EXCLUDED.graded, ungraded = EXCLUDED.ungraded,
       pts = EXCLUDED.pts, max_pts = EXCLUDED.max_pts, score = EXCLUDED.score, grade = EXCLUDED.grade,
       a_plus = EXCLUDED.a_plus, a = EXCLUDED.a, b = EXCLUDED.b, c = EXCLUDED.c,
       d = EXCLUDED.d, f = EXCLUDED.f,
       cap_tested = EXCLUDED.cap_tested, cap_held = EXCLUDED.cap_held,
       floor_tested = EXCLUDED.floor_tested, floor_held = EXCLUDED.floor_held,
       flip_held = EXCLUDED.flip_held, apex_pinned = EXCLUDED.apex_pinned,
       range_contained = EXCLUDED.range_contained, graded_at = now()`,
    [
      day.date, day.tickers, day.graded, day.ungraded, day.pts, day.maxPts, day.score, day.grade,
      day.aPlus, day.a, day.b, day.c, day.d, day.f,
      day.capTested, day.capHeld, day.floorTested, day.floorHeld,
      day.flipHeld, day.apexPinned, day.rangeContained,
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
 */
async function regradeSession(date) {
  if (!(await ensureSchema())) return null;
  const p = getPool();
  const { rows } = await p.query(
    `SELECT symbol, sealed_spot, floor_lvl, cap_lvl, apex_lvl, flip_lvl, o, h, l, c, bars
       FROM daily_grades WHERE date = $1`,
    [date],
  );
  if (!rows.length) return null;

  for (const r of rows) {
    const sealed = {
      spot: r.sealed_spot, floor: r.floor_lvl, cap: r.cap_lvl, apex: r.apex_lvl, flip: r.flip_lvl,
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
  sealBoard,
  getSeal,
  gradeTicker,
  rollUpDay,
  ensureSchema,
  getPool,
};
