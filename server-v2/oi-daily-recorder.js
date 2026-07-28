'use strict';
/**
 * server-v2/oi-daily-recorder.js
 *
 * ONE snapshot per trading day of PER-STRIKE OPEN INTEREST across the full
 * scanner watchlist, so the Options Chain page can show a real day-over-day
 * ΔOI column next to GEX / DEX / VEX / CHEX.
 *
 * WHY ONCE A DAY (and why 9:32 ET):
 *   Open interest is not a live number. It is settled overnight by the OCC and
 *   republished by the exchanges in the pre-open window (~8–9 ET); it does NOT
 *   tick during the session. Snapshotting it every minute like GEX would write
 *   ~390 identical rows per strike per day for zero information.
 *
 *   So the useful "change in OI" is NOT today-9:30 vs today-now (that is flat by
 *   construction) — it is today's settled OI vs the PREVIOUS trading day's
 *   settled OI. That difference is the positioning actually opened or closed
 *   overnight: new OI = contracts that were opened and held, negative OI =
 *   contracts closed or expired out.
 *
 *   9:32 ET (not 9:30 sharp) is deliberate: it is late enough that every root's
 *   OI field has been refreshed for the day and the chain endpoints are warm,
 *   and early enough that the numbers still describe the book the day OPENED
 *   with, before anything about today's tape matters.
 *
 * WHAT IT WRITES:
 *   oi_daily(date, symbol, expiry, strike, call_oi, put_oi, spot, ts)
 *   One row per (date, symbol, expiry, strike). Strikes with no OI on either
 *   side are skipped — the dead tail of a chain is not worth a row per day.
 *   Upsert on the PK, so a manual re-run overwrites the day cleanly instead of
 *   duplicating it.
 *
 * READ PATH:
 *   GET /proxy/oi-change?symbol=SPX  (server-with-proxy.js) joins the two most
 *   recent snapshot dates for the symbol and returns call_oi/put_oi plus
 *   call_chg/put_chg per (expiry, strike). The chain page's OI tab renders that
 *   directly.
 *
 * SOURCE: fetchExpirations / fetchChainFull from proxy-tastytrade — the same
 * REST pair etf-gex-recorder.js uses. No new upstream dependency.
 *
 * COST: ~180 tickers × EXPIRY_DEPTH expiries, paced at TICKER_DELAY_MS. At the
 * defaults (6 expiries, 250ms) the sweep takes roughly 4–5 minutes of trickled
 * REST once per day. That is why it is a daily job and not a poll.
 *
 * Wiring: startOiDailyRecorder() from server-with-proxy.js.
 * Disable with OI_DAILY_RECORDER=0. Manual fire: POST /proxy/oi-daily-run.
 */

const { fetchExpirations, fetchChainFull } = require('./proxy-tastytrade');
const { SCANNER_TICKERS } = require('./scanner-tickers');

// ── Tunables (env-overridable) ───────────────────────────────────────────────

// Minute-of-day ET to fire the daily sweep. 572 = 9:32 ET.
const RUN_AT_MIN = Number(process.env.OI_DAILY_RUN_AT_MIN || 572);
// How many expirations forward, per ticker. The chain page shows up to 14
// columns, but OI beyond the front few months is nearly static and the row
// count scales linearly with this — 6 covers 0DTE through the front monthly
// for almost every root.
const EXPIRY_DEPTH = Math.max(1, Math.min(20, Number(process.env.OI_DAILY_EXPIRY_DEPTH || 6)));
// Pacing between upstream chain fetches, so the sweep trickles instead of
// hammering TT with ~1000 requests at once.
const TICKER_DELAY_MS = Number(process.env.OI_DAILY_DELAY_MS || 250);
// Retention. ΔOI only ever needs the last two snapshots, but keeping a month
// lets a future "OI trend" view read history without a schema change.
const RETAIN_DAYS = Math.max(2, Number(process.env.OI_DAILY_RETAIN_DAYS || 45));
// Roster. Defaults to the full scanner watchlist; override with a CSV to narrow.
const SYMBOLS = (process.env.OI_DAILY_SYMBOLS
  ? String(process.env.OI_DAILY_SYMBOLS).split(',')
  : SCANNER_TICKERS
).map((s) => String(s).trim().toUpperCase()).filter(Boolean);

// ── Time helpers ─────────────────────────────────────────────────────────────

function todayYmdET() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

/** { weekday, minutes } in ET, so the scheduler never depends on server TZ. */
function nowET() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => parts.find((x) => x.type === t)?.value ?? '';
  return { weekday: get('weekday'), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

// Market holidays — keep in sync with eod-gex-recorder.js /
// strike-growth-recorder.js / mvc-auto-snapshot.js.
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

/**
 * Weekday AND not a market holiday. Sat/Sun alone is not enough: on a holiday
 * the chains still answer, so the sweep would trickle for four minutes and
 * write a snapshot under a date the market never opened — leaving the OI tab
 * to label the next session's baseline as a day that doesn't exist as a
 * trading day.
 */
function isTradingDayET() {
  const { weekday } = nowET();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return !MARKET_HOLIDAYS.has(todayYmdET());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── PG pool (same lazy pattern as strike-growth-recorder.js) ─────────────────

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
      console.warn('[oi-daily] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[oi-daily] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  if (_schemaReady) return true;
  const p = getPool();
  if (!p) return false;
  await p.query(`
    CREATE TABLE IF NOT EXISTS oi_daily (
      date     DATE             NOT NULL,
      symbol   TEXT             NOT NULL,
      expiry   TEXT             NOT NULL,
      strike   DOUBLE PRECISION NOT NULL,
      call_oi  INTEGER          NOT NULL DEFAULT 0,
      put_oi   INTEGER          NOT NULL DEFAULT 0,
      spot     DOUBLE PRECISION,
      ts       TIMESTAMPTZ      NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol, expiry, strike)
    );
  `);
  // The read path is always "latest two dates for this symbol", optionally
  // narrowed to a set of expiries. Leading with symbol keeps that a small
  // ordered index scan even once the table holds every watchlist ticker.
  await p.query(`CREATE INDEX IF NOT EXISTS idx_oi_daily_symbol_date
                 ON oi_daily (symbol, date DESC);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_oi_daily_lookup
                 ON oi_daily (symbol, expiry, date DESC, strike);`);
  // Cheap "which days do we actually have?" probe for the UI's baseline label.
  await p.query(`CREATE INDEX IF NOT EXISTS idx_oi_daily_date ON oi_daily (date);`);
  _schemaReady = true;
  return true;
}

// ── Chain → per-strike OI rows ───────────────────────────────────────────────

const int = (o, ...keys) => {
  if (!o) return 0;
  for (const k of keys) {
    const v = parseInt(o[k] ?? 0, 10);
    if (Number.isFinite(v) && v) return v;
  }
  return 0;
};

/** The next `depth` expirations for a ticker, today-or-later, ascending. */
async function resolveExpiries(ticker, depth) {
  const { items } = await fetchExpirations(ticker).catch(() => ({ items: [] }));
  const today = todayYmdET();
  return (items || [])
    .map((it) => String(it['expiration-date'] || '').slice(0, 10))
    .filter((d) => d && d >= today)
    .sort()
    .slice(0, depth);
}

/**
 * One expiration's ladder reduced to { spot, rows: [{strike, callOI, putOI}] }.
 * Strikes with zero OI on BOTH sides are dropped (see header).
 */
async function snapshotExpiryOi(ticker, expiry) {
  const { items, underlyingPrice } = await fetchChainFull(ticker, expiry);
  const spot = Number(underlyingPrice) || 0;
  if (!Array.isArray(items) || !items.length) return { spot, rows: [] };

  const rows = [];
  for (const group of items) {
    const groupExp = String(group['expiration-date'] || '').slice(0, 10);
    if (groupExp && groupExp !== expiry) continue;
    for (const it of group.strikes || []) {
      const strike = parseFloat(it['strike-price'] || 0);
      if (!(strike > 0)) continue;
      const callOI = int(it.call, 'open-interest', 'openInterest');
      const putOI = int(it.put, 'open-interest', 'openInterest');
      if (!callOI && !putOI) continue;
      rows.push({ strike, callOI, putOI });
    }
  }
  rows.sort((a, b) => a.strike - b.strike);
  return { spot, rows };
}

/** Bulk upsert one expiry's rows. Chunked so the parameter list stays sane. */
async function writeRows(date, symbol, expiry, spot, rows) {
  const p = getPool();
  if (!p || !rows.length) return 0;
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [date, symbol, expiry, spot];
    slice.forEach((r) => {
      const a = params.push(r.strike);
      const b = params.push(r.callOI);
      const c = params.push(r.putOI);
      values.push(`($1,$2,$3,$${a},$${b},$${c},$4,now())`);
    });
    // A re-run for the same day overwrites rather than erroring — that is what
    // makes POST /proxy/oi-daily-run safe to fire by hand after a bad morning.
    // eslint-disable-next-line no-await-in-loop
    await p.query(
      `INSERT INTO oi_daily (date, symbol, expiry, strike, call_oi, put_oi, spot, ts)
       VALUES ${values.join(',')}
       ON CONFLICT (date, symbol, expiry, strike) DO UPDATE
         SET call_oi = EXCLUDED.call_oi,
             put_oi  = EXCLUDED.put_oi,
             spot    = EXCLUDED.spot,
             ts      = EXCLUDED.ts`,
      params,
    );
    written += slice.length;
  }
  return written;
}

async function prune() {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(`DELETE FROM oi_daily WHERE date < (CURRENT_DATE - $1::int)`, [RETAIN_DAYS]);
  } catch (e) {
    console.warn('[oi-daily] prune failed:', e.message);
  }
}

// ── Sweep ────────────────────────────────────────────────────────────────────

let _running = false;
let _lastRunDate = null;

/**
 * Full watchlist sweep. Returns a summary so the manual-fire route can echo it.
 * `symbols` narrows the roster (used by the manual route's ?symbol= param).
 */
async function runSweep({ symbols = SYMBOLS, date = null } = {}) {
  // Claim BEFORE the first await. ensureSchema() does a real round trip on
  // first call (and again after a pool error resets _schemaReady), so a
  // check-then-await-then-set guard leaves a window where a double-clicked
  // manual fire starts two concurrent sweeps — ~2000 upstream chain requests
  // at once, which is exactly what TICKER_DELAY_MS exists to prevent.
  if (_running) return { ok: false, error: 'sweep already running' };
  _running = true;
  if (!(await ensureSchema())) { _running = false; return { ok: false, error: 'no DB' }; }
  const day = date || todayYmdET();
  const started = Date.now();
  let tickersOk = 0;
  let tickersFailed = 0;
  let rowsWritten = 0;
  const failures = [];

  try {
    for (const symbol of symbols) {
      let wroteAny = false;
      try {
        // eslint-disable-next-line no-await-in-loop
        const expiries = await resolveExpiries(symbol, EXPIRY_DEPTH);
        if (!expiries.length) {
          failures.push(`${symbol}: no expirations`);
          tickersFailed += 1;
          continue;
        }
        for (const expiry of expiries) {
          // eslint-disable-next-line no-await-in-loop
          const { spot, rows } = await snapshotExpiryOi(symbol, expiry);
          if (rows.length) {
            // eslint-disable-next-line no-await-in-loop
            rowsWritten += await writeRows(day, symbol, expiry, spot || null, rows);
            wroteAny = true;
          }
          // eslint-disable-next-line no-await-in-loop
          await sleep(TICKER_DELAY_MS);
        }
        if (wroteAny) tickersOk += 1;
        else { tickersFailed += 1; failures.push(`${symbol}: empty chain`); }
      } catch (e) {
        tickersFailed += 1;
        failures.push(`${symbol}: ${e?.message || e}`);
      }
    }
    await prune();
  } finally {
    _running = false;
  }

  // NOTE: runSweep deliberately does NOT set _lastRunDate. The scheduler owns
  // that claim (see startOiDailyRecorder). If this function claimed the day
  // too, a manual single-symbol fire — POST /proxy/oi-daily-run?symbol=SPX at
  // 9:00 to spot-check the endpoint — would mark the day done and silently
  // cancel the 9:32 full-watchlist sweep.
  const secs = Math.round((Date.now() - started) / 1000);
  // ok=false when nothing landed. Every per-ticker failure is swallowed above
  // (resolveExpiries has its own .catch, and the per-symbol try/catch takes the
  // rest), so without this an expired upstream session at 9:32 would fail all
  // ~180 tickers, write zero rows, and still report success — which the
  // scheduler would read as "day done" and never retry. Losing a day's OI
  // silently is worse than a noisy retry.
  const ok = rowsWritten > 0;
  const summary = {
    ok, date: day, tickersOk, tickersFailed, rowsWritten, seconds: secs,
    ...(ok ? {} : { error: 'sweep wrote no rows' }),
    // Only the first few failures — a full 180-entry list in the log helps nobody.
    failures: failures.slice(0, 10),
  };
  console[ok ? 'log' : 'warn'](
    `[oi-daily] sweep ${ok ? 'done' : 'FAILED'} ${day} — ${tickersOk} ok / ${tickersFailed} failed, ` +
    `${rowsWritten} rows in ${secs}s`,
  );
  return summary;
}

// ── Read helper (used by /proxy/oi-change) ───────────────────────────────────

/**
 * Day-over-day OI change for a symbol.
 *
 * Takes the two most recent snapshot DATES that exist for the symbol (not
 * "today and yesterday" by calendar — that would break after a holiday or a
 * missed run) and left-joins the newer onto the older, so a strike that is new
 * today still comes back with its full OI as the change.
 *
 * `expiries` (optional array) narrows the result to the expiry columns the
 * chain page is actually showing.
 */
async function getOiChange(symbol, expiries = null) {
  if (!(await ensureSchema())) return { ok: false, error: 'no DB' };
  const p = getPool();
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym) return { ok: false, error: 'symbol required' };

  // to_char, not the raw DATE: node-postgres turns a DATE into a JS Date at
  // LOCAL midnight, so formatting it back to YYYY-MM-DD shifts by a day on any
  // server east of UTC. Keeping it text end-to-end removes that whole class of
  // off-by-one, and `$n::date` casts it back for the comparison below.
  const { rows: dateRows } = await p.query(
    `SELECT DISTINCT to_char(date, 'YYYY-MM-DD') AS d
       FROM oi_daily WHERE symbol = $1 ORDER BY d DESC LIMIT 2`,
    [sym],
  );
  if (!dateRows.length) return { ok: true, symbol: sym, date: null, prevDate: null, rows: [] };

  const curDate = dateRows[0].d;
  const prevDate = dateRows[1]?.d ?? null;

  const params = [sym, curDate];
  let expFilter = '';
  if (Array.isArray(expiries) && expiries.length) {
    params.push(expiries);
    // COALESCE, not cur.expiry: on a FULL JOIN row that exists only in `prev`
    // (a strike closed out overnight), cur.expiry is NULL and a bare
    // `cur.expiry = ANY(...)` would filter that unwind straight back out.
    expFilter = `AND COALESCE(cur.expiry, prev.expiry) = ANY($${params.length}::text[])`;
  }
  // prev is $N — appended last so the ANY() index above stays stable.
  params.push(prevDate);
  const prevIdx = params.length;

  // FULL JOIN, not LEFT. The sweep drops strikes with zero OI on both sides
  // (no point writing the dead tail of every chain), so a strike that was fully
  // closed or expired out overnight has a `prev` row and NO `cur` row. Anchoring
  // on cur would discard exactly the largest negative changes — the unwinds this
  // tab exists to show. COALESCE on both sides makes a missing row read as 0.
  const { rows } = await p.query(
    `SELECT COALESCE(cur.expiry, prev.expiry)              AS expiry,
            COALESCE(cur.strike, prev.strike)              AS strike,
            COALESCE(cur.call_oi, 0)                       AS call_oi,
            COALESCE(cur.put_oi, 0)                        AS put_oi,
            COALESCE(cur.call_oi, 0) - COALESCE(prev.call_oi, 0) AS call_chg,
            COALESCE(cur.put_oi, 0)  - COALESCE(prev.put_oi, 0)  AS put_chg,
            (prev.strike IS NOT NULL)                      AS had_prev
       FROM (SELECT * FROM oi_daily
              WHERE symbol = $1 AND date = $2::date) cur
       FULL JOIN (SELECT * FROM oi_daily
                   WHERE symbol = $1 AND date = $${prevIdx}::date) prev
         ON prev.expiry = cur.expiry
        AND prev.strike = cur.strike
      WHERE TRUE ${expFilter}
      ORDER BY 1, 2`,
    params,
  );

  return {
    ok: true,
    symbol: sym,
    date: curDate,
    prevDate,
    rows: rows.map((r) => ({
      expiry: r.expiry,
      strike: Number(r.strike),
      callOI: Number(r.call_oi) || 0,
      putOI: Number(r.put_oi) || 0,
      callChg: prevDate ? Number(r.call_chg) || 0 : 0,
      putChg: prevDate ? Number(r.put_chg) || 0 : 0,
      hadPrev: !!r.had_prev,
    })),
  };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

/**
 * Checks every minute whether it is time to fire. A minute-poll (rather than a
 * single setTimeout to the next 9:32) survives process restarts and clock
 * drift, and the _lastRunDate guard keeps it to exactly one sweep per day.
 */
function startOiDailyRecorder() {
  if (_timer) return;
  if (process.env.OI_DAILY_RECORDER === '0') {
    console.log('[oi-daily] recorder disabled (OI_DAILY_RECORDER=0)');
    return;
  }
  if (!SYMBOLS.length) return;

  const check = () => {
    try {
      if (_running) return;
      if (!isTradingDayET()) return;
      const day = todayYmdET();
      if (_lastRunDate === day) return;
      const { minutes } = nowET();
      // Fire at RUN_AT_MIN, or on any later boot that same session (a server
      // restarted at 10:15 should still capture the day's OI — it is a settled
      // number, it does not go stale by mid-session).
      if (minutes < RUN_AT_MIN || minutes >= 960) return;
      _lastRunDate = day; // claim the day BEFORE awaiting, so a slow sweep
                          // can't be double-fired by the next minute tick
      runSweep({ date: day })
        .then((r) => {
          // Release the claim on a sweep that landed nothing (dead upstream,
          // no DB) so the next minute tick retries. The window runs to 16:00,
          // which is plenty of retries — and OI is a settled number, so a
          // snapshot taken at 10:40 after a bad 9:32 is just as correct.
          if (!r?.ok) {
            console.warn(`[oi-daily] sweep did not land (${r?.error || 'unknown'}) — will retry`);
            _lastRunDate = null;
          }
        })
        .catch((e) => {
          console.warn('[oi-daily] sweep error:', e.message);
          _lastRunDate = null; // let it retry next minute
        });
    } catch (e) {
      console.warn('[oi-daily] scheduler error:', e.message);
    }
  };

  _timer = setInterval(check, 60_000);
  if (_timer.unref) _timer.unref();
  // First check shortly after boot so a mid-session restart backfills today.
  setTimeout(check, 40_000);

  const hh = String(Math.floor(RUN_AT_MIN / 60)).padStart(2, '0');
  const mm = String(RUN_AT_MIN % 60).padStart(2, '0');
  console.log(
    `[oi-daily] recorder started — ${SYMBOLS.length} symbols × ${EXPIRY_DEPTH} expiries, ` +
    `once daily at ${hh}:${mm} ET, ${RETAIN_DAYS}d retention`,
  );
}

module.exports = {
  startOiDailyRecorder,
  runSweep,
  getOiChange,
  ensureSchema,
  getPool,
  snapshotExpiryOi,
  resolveExpiries,
};
