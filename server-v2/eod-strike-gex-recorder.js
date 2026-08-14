'use strict';
/**
 * server-v2/eod-strike-gex-recorder.js
 *
 * ONE end-of-day snapshot per trading day of PER-STRIKE NET GEX for the
 * WHOLE BOARD MINUS 0DTE, across the full scanner watchlist — so the Ticker
 * Lookup card's right pane can show a real day-over-day ΔGEX column next to
 * each strike instead of only ever showing today.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The right pane of Ticker Lookup answers "where is the structural gamma on
 * this name". That is a level read: Core, call wall, put wall, flip. What it
 * could NOT answer is "and what CHANGED" — whether the 6400 call wall got
 * built today or has been sitting there for a week, whether the put wall is
 * thickening under price or bleeding off. That question needs yesterday, and
 * nothing was storing yesterday for anything but $SPX/SPY/QQQ.
 *
 * ── WHY 16:05 ET, ONCE ──────────────────────────────────────────────────────
 * GEX on the OI+Vol basis is part settled (open interest) and part tape
 * (volume). The volume half is only final once the 16:00 print is in, which is
 * why atm-prem-recorder also fires at 16:05 rather than at the bell. Taking the
 * snapshot after the close makes each row "the board as this session ended",
 * so the day-over-day diff is session-to-session and not "3:40pm yesterday vs
 * 11:20am today".
 *
 * ── WHY THE SAME FORMULA AS THE CARD, NOT THE THETA SWEEP ───────────────────
 * /proxy/gex-by-strike-multi already returns a ladder shaped exactly like this
 * one, and it is deliberately NOT used. That sweep is ThetaData-sourced
 * (fetchGreeksTheta / fetchOpenInterestTheta in eod-gex-recorder.js). For $SPX
 * it is fine; for single names it comes back sparse, which is the documented
 * reason the Ticker Lookup card stopped reading it (see the big comment above
 * TickerLookupCard in components/pages/Analytics.tsx). If the recorded history
 * came from Theta and the live pane came from TastyTrade, the Δ column would be
 * differencing two different definitions of GEX and every number in it would be
 * noise. So this recorder re-implements the client's accumulateChainGreeks()
 * against the SAME fetchChainFull the card reads — OI+Vol basis, same spot,
 * same multiplier. See gexRowsForSymbol() for the line-by-line correspondence.
 *
 * ── WHAT IT WRITES ──────────────────────────────────────────────────────────
 *   eod_strike_gex(date, symbol, strike, net_gex, spot, expiry_count, ts)
 *   One row per (date, symbol, strike). PK upsert, so a manual re-fire
 *   overwrites the day cleanly instead of duplicating it.
 *
 *   Only WINDOW_SIDE strikes above and below the closing spot are kept
 *   (40 + 40 + the spot strike = 81 rows per symbol per day). The window is
 *   sliced off the strike INDEX, not a point distance, so a $2.50-wide chain
 *   and a $50-wide chain both give 40 rungs a side — the same rule tlWindow()
 *   uses on the client. The wings carry no useful gamma and would triple the
 *   table for nothing.
 *
 * ── READ PATH ───────────────────────────────────────────────────────────────
 *   GET /proxy/eod-strike-gex-change?symbol=NVDA[&date=YYYY-MM-DD]
 *   joins the two most recent snapshot DATES for the symbol and returns
 *   netGex / prevNetGex / chg per strike. The diff is computed IN POSTGRES,
 *   not in the browser — the client never holds yesterday's ladder.
 *
 *   GET /proxy/eod-strike-gex-board?top=5[&date=YYYY-MM-DD]
 *   the same read for the whole roster at once, ranked, for the owner board.
 *
 *   GET /proxy/eod-strike-gex-dates[?limit=90]
 *   which sessions are on file, newest first — populates the board's picker.
 *
 *   `date` on the first two is an AS-OF (latest session on or before it), not
 *   an exact match, so a date that a given symbol missed still answers.
 *
 * COST: ~169 tickers × every listed expiry, paced at TICKER_DELAY_MS. Uncapped
 * expiry depth is deliberate — "all expirations" has to mean all of them, and a
 * quarterly 300 days out is exactly the kind of strike that parks a wall the
 * front weeklies never show. The pacing is what keeps it polite; the sweep
 * trickles for several minutes once a day rather than hammering TT.
 *
 * Wiring: startEodStrikeGexRecorder() from server-with-proxy.js.
 * Disable with EOD_STRIKE_GEX_RECORDER=0.
 * Manual fire: POST /proxy/eod-strike-gex-run[?symbol=NVDA][&date=YYYY-MM-DD]
 */

const { fetchExpirations, fetchChainFull } = require('./proxy-tastytrade');
const { SCANNER_TICKERS } = require('./scanner-tickers');
const rosterStore = require('./roster-store');

// ── Tunables (env-overridable) ───────────────────────────────────────────────

// Minute-of-day ET to fire. 965 = 16:05 ET — five minutes past the bell, so the
// chain's day-volume field is settled. Same slot atm-prem-recorder uses.
const RUN_AT_MIN = Number(process.env.EOD_STRIKE_GEX_RUN_AT_MIN || 965);
// Latest minute the catch-up window stays open. 22:00 ET, so a VPS restarted at
// 7pm still captures the session instead of silently losing the day.
const WINDOW_CLOSE_MIN = Number(process.env.EOD_STRIKE_GEX_CLOSE_MIN || 1320);
// Strikes kept EACH WAY from the closing spot. 40 + 40 + the spot strike.
const WINDOW_SIDE = Math.max(5, Math.min(200, Number(process.env.EOD_STRIKE_GEX_SIDE || 40)));
// 0 = uncapped (every listed expiry, which is what "all expirations" means).
// Set a number to cap depth if a sweep ever needs to be shortened.
const EXPIRY_DEPTH = Math.max(0, Number(process.env.EOD_STRIKE_GEX_EXPIRY_DEPTH || 0));
// Parallel chain fetches WITHIN one symbol. The client card uses 6 because it
// runs from one browser; this runs from the VPS against every ticker in a row,
// so it matches the server-side sweep's 4.
const EXPIRY_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.EOD_STRIKE_GEX_CONCURRENCY || 4)));
// Pacing between symbols, so ~169 tickers trickle instead of stampeding.
const TICKER_DELAY_MS = Number(process.env.EOD_STRIKE_GEX_DELAY_MS || 300);
// Retention. This series IS the history — the whole point is day-over-day and
// eventually week-over-week, so it keeps far more than the two days a bare Δ
// needs. ~400 days ≈ a full year of sessions plus slack.
const RETAIN_DAYS = Math.max(3, Number(process.env.EOD_STRIKE_GEX_RETAIN_DAYS || 400));

// Roster override. Resolved PER SWEEP, never frozen at module load — a ticker
// added on the owner Watchlists page has to start recording that same evening,
// and a `const` binding here would never see the edit (see the note at the head
// of scanner-tickers.js).
const ENV_SYMBOLS = process.env.EOD_STRIKE_GEX_SYMBOLS
  ? String(process.env.EOD_STRIKE_GEX_SYMBOLS).split(',').map((s) => String(s).trim().toUpperCase()).filter(Boolean)
  : null;

async function resolveSymbols() {
  if (ENV_SYMBOLS && ENV_SYMBOLS.length) return ENV_SYMBOLS;
  try {
    const live = await rosterStore.getSymbols('scanner');
    if (live.length) return live;
  } catch (e) {
    console.warn('[eod-strike-gex] roster resolve failed, using baseline:', e.message);
  }
  return SCANNER_TICKERS.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
}

/** Synchronous best-effort view, for log lines and the boot check only. */
function symbolsSync() {
  if (ENV_SYMBOLS && ENV_SYMBOLS.length) return ENV_SYMBOLS;
  const live = rosterStore.getSymbolsSync('scanner');
  return live.length ? live : SCANNER_TICKERS.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
}

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

// Market holidays — keep in sync with eod-gex-recorder.js / oi-daily-recorder.js
// / gex-levels-history-recorder.js / mvc-auto-snapshot.js.
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

/**
 * Weekday AND not a market holiday. Sat/Sun alone is not enough: on a holiday
 * the chains still answer, so the sweep would write a full snapshot under a
 * date the market never opened — and the next real session's Δ would then be
 * measured against a day that never traded.
 */
function isTradingDayET() {
  const { weekday } = nowET();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return !MARKET_HOLIDAYS.has(todayYmdET());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── PG pool (same lazy pattern as oi-daily-recorder.js) ──────────────────────

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
      console.warn('[eod-strike-gex] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[eod-strike-gex] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  if (_schemaReady) return true;
  const p = getPool();
  if (!p) return false;
  await p.query(`
    CREATE TABLE IF NOT EXISTS eod_strike_gex (
      date         DATE             NOT NULL,
      symbol       TEXT             NOT NULL,
      strike       DOUBLE PRECISION NOT NULL,
      net_gex      DOUBLE PRECISION NOT NULL,
      spot         DOUBLE PRECISION,
      expiry_count INTEGER,
      ts           TIMESTAMPTZ      NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol, strike)
    );
  `);
  // The read path is always "the latest two dates for THIS symbol", so leading
  // with symbol keeps it a small ordered index scan even once the table holds a
  // year of the full watchlist.
  await p.query(`CREATE INDEX IF NOT EXISTS idx_eod_strike_gex_symbol_date
                 ON eod_strike_gex (symbol, date DESC);`);
  // Cheap "which days do we actually have?" probe + the retention sweep.
  await p.query(`CREATE INDEX IF NOT EXISTS idx_eod_strike_gex_date
                 ON eod_strike_gex (date);`);
  _schemaReady = true;
  return true;
}

// ── Chain → per-strike GEX ───────────────────────────────────────────────────

/** Numeric greek off a leg, treating "" / null / NaN as 0. */
const num = (o, k) => {
  const v = o?.[k];
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : 0;
};

/**
 * OI + VOLUME, the contract count this basis uses.
 *
 * This is the half of the formula most likely to be "cleaned up" later into
 * plain open interest, so: it is intentional, and it must not change without
 * changing the client. The Ticker Lookup card, the Multi Greek card and the
 * Options Chain ⅀ Total column all count `open-interest + volume`, and the
 * card's own footer says "OI+Vol basis". Recording plain OI here would make the
 * Δ column subtract a different number from the one printed beside it.
 */
const cnt = (o) => {
  if (!o) return 0;
  const oi = parseInt(String(o['open-interest'] ?? o.openInterest ?? 0), 10) || 0;
  const vol = parseInt(String(o.volume ?? 0), 10) || 0;
  return oi + vol;
};

/** The expirations to sweep: every listed date strictly AFTER today ET. */
async function resolveBoardExpiries(ticker) {
  const { items } = await fetchExpirations(ticker).catch(() => ({ items: [] }));
  const today = todayYmdET();
  // Strictly `> today`, never `>=`. ISO dates compare correctly as strings, so
  // this drops both 0DTE and anything stale the listing still carries — the
  // same ex-0DTE rule the card's right pane applies. Same-day gamma dwarfs the
  // rest of the board and decays to nothing by the close, so including it would
  // make every snapshot mostly a picture of that day's pin.
  const all = [...new Set((items || [])
    .map((it) => String(it['expiration-date'] || '').slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d > today))].sort();
  return EXPIRY_DEPTH > 0 ? all.slice(0, EXPIRY_DEPTH) : all;
}

/**
 * Accumulate one chain payload's per-strike GEX into `acc`.
 *
 * LINE-FOR-LINE the client's accumulateChainGreeks() gex term in
 * components/pages/Analytics.tsx:
 *
 *     e.gex += (gamma(call) * cc - gamma(put) * pc) * S * S * 0.01 * 100
 *
 * where cc/pc are OI+Vol and S is the payload's own underlyingPrice. Keeping
 * these identical is the entire reason this file does not call the existing
 * Theta sweep — see the header.
 *
 * The one deliberate divergence is Math.abs() on each gamma. TastyTrade returns
 * gamma POSITIVE for both calls and puts, so on real data abs() is a no-op and
 * the two implementations agree exactly. It is here as a guard: the put leg's
 * short-gamma polarity comes from the MINUS sign in the formula, not from the
 * greek, so if upstream ever delivered a signed (negative) put gamma the
 * `- pGamma * pc` term would turn ADDITIVE and every put-heavy strike would
 * silently flip positive in the recorded history. etf-gex-recorder.js carries
 * the same guard for the same reason.
 */
function accumulateChainGex(payload, acc) {
  const data = payload?.data ?? payload;
  const items = Array.isArray(data?.items) ? data.items : [];
  const S = Number(data?.underlyingPrice) || 0;
  if (!(S > 0) || !items.length) return 0;
  const mult = S * S * 0.01 * 100;
  for (const group of items) {
    for (const s of group?.strikes || []) {
      const strike = parseFloat(String(s['strike-price'] ?? 0));
      if (!(strike > 0)) continue;
      const c = s.call;
      const p = s.put;
      const cc = cnt(c);
      const pc = cnt(p);
      // No book AND no tape is a dead strike — skip it rather than write the
      // whole inert tail of every chain.
      if (cc === 0 && pc === 0) continue;
      const gex = (Math.abs(num(c, 'gamma')) * cc - Math.abs(num(p, 'gamma')) * pc) * mult;
      if (!Number.isFinite(gex)) continue;
      acc.set(strike, (acc.get(strike) ?? 0) + gex);
    }
  }
  return S;
}

/**
 * The whole board for one symbol, ex-0DTE, summed per strike.
 * Returns { spot, expiryCount, rows: [{ strike, gex }] } ascending by strike.
 */
async function gexRowsForSymbol(symbol) {
  const expiries = await resolveBoardExpiries(symbol);
  if (!expiries.length) return { spot: 0, expiryCount: 0, rows: [] };

  const acc = new Map();
  let spot = 0;
  let ok = 0;
  const queue = [...expiries];

  const worker = async () => {
    while (queue.length) {
      const exp = queue.shift();
      if (!exp) return;
      try {
        // eslint-disable-next-line no-await-in-loop
        const payload = await fetchChainFull(symbol, exp);
        const S = accumulateChainGex(payload, acc);
        if (S > 0) { spot = S; ok += 1; }
      } catch {
        // One dead expiry must not blank the symbol — it just narrows the
        // board, and expiryCount records how narrow it actually got.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(EXPIRY_CONCURRENCY, expiries.length) }, worker));

  const rows = [...acc.entries()]
    .map(([strike, gex]) => ({ strike, gex }))
    .filter((r) => Number.isFinite(r.strike) && r.strike > 0 && Number.isFinite(r.gex) && r.gex !== 0)
    .sort((a, b) => a.strike - b.strike);

  return { spot, expiryCount: ok, rows };
}

/**
 * WINDOW_SIDE strikes above + the spot strike + WINDOW_SIDE below.
 *
 * Sliced off the strike INDEX, not a point distance — the same rule tlWindow()
 * uses on the client — so a $2.50-wide chain and a $50-wide chain both give 40
 * rungs a side instead of one giving four and the other four hundred.
 *
 * With no spot the ladder is centred on its own middle rather than dropped: an
 * unpriced snapshot is still a usable Δ baseline, and losing the day entirely
 * because underlyingPrice came back empty is the worse failure.
 */
function windowRows(rows, spot) {
  if (!rows.length) return [];
  const anchor = spot > 0 ? spot : rows[Math.floor(rows.length / 2)].strike;
  let ai = 0;
  for (let i = 1; i < rows.length; i++) {
    if (Math.abs(rows[i].strike - anchor) < Math.abs(rows[ai].strike - anchor)) ai = i;
  }
  return rows.slice(Math.max(0, ai - WINDOW_SIDE), ai + WINDOW_SIDE + 1);
}

/** Bulk upsert one symbol's windowed ladder. Chunked so $n stays sane. */
async function writeRows(date, symbol, spot, expiryCount, rows) {
  const p = getPool();
  if (!p || !rows.length) return 0;
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [date, symbol, spot, expiryCount];
    slice.forEach((r) => {
      const a = params.push(r.strike);
      const b = params.push(r.gex);
      values.push(`($1,$2,$${a},$${b},$3,$4,now())`);
    });
    // Upsert, so a manual re-fire after a bad close overwrites the day instead
    // of erroring — that is what makes POST /proxy/eod-strike-gex-run safe.
    // eslint-disable-next-line no-await-in-loop
    await p.query(
      `INSERT INTO eod_strike_gex (date, symbol, strike, net_gex, spot, expiry_count, ts)
       VALUES ${values.join(',')}
       ON CONFLICT (date, symbol, strike) DO UPDATE
         SET net_gex      = EXCLUDED.net_gex,
             spot         = EXCLUDED.spot,
             expiry_count = EXCLUDED.expiry_count,
             ts           = EXCLUDED.ts`,
      params,
    );
    written += slice.length;
  }
  return written;
}

/**
 * Clear a symbol's stale rows for the day before writing the new window.
 *
 * The window MOVES: if price rallied, today's 40-a-side band no longer covers
 * yesterday's lowest strikes. A pure upsert would leave the previous run's
 * out-of-window rows sitting under the same (date, symbol) — harmless for a
 * first write, wrong for a re-fire, where the day would end up holding the
 * union of two windows.
 */
async function clearDay(date, symbol) {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(`DELETE FROM eod_strike_gex WHERE date = $1::date AND symbol = $2`, [date, symbol]);
  } catch (e) {
    console.warn(`[eod-strike-gex] clear ${symbol} ${date} failed:`, e.message);
  }
}

async function prune() {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(`DELETE FROM eod_strike_gex WHERE date < (CURRENT_DATE - $1::int)`, [RETAIN_DAYS]);
  } catch (e) {
    console.warn('[eod-strike-gex] prune failed:', e.message);
  }
}

// ── Sweep ────────────────────────────────────────────────────────────────────

let _running = false;
let _lastRunDate = null;

/**
 * Full watchlist sweep. Returns a summary the manual-fire route echoes.
 * `symbols` narrows the roster (the manual route's ?symbol= param).
 */
async function runSweep({ symbols = null, date = null } = {}) {
  // Claim BEFORE the first await. ensureSchema() does a real round trip on the
  // first call (and again after a pool error resets _schemaReady), so a
  // check-then-await-then-set guard leaves a window where a double-clicked
  // manual fire starts two concurrent sweeps — thousands of upstream chain
  // requests at once, which is exactly what the pacing exists to prevent.
  if (_running) return { ok: false, error: 'sweep already running' };
  _running = true;
  if (!(await ensureSchema())) { _running = false; return { ok: false, error: 'no DB' }; }

  const roster = (symbols && symbols.length) ? symbols : await resolveSymbols();
  const day = date || todayYmdET();
  const started = Date.now();
  let tickersOk = 0;
  let tickersFailed = 0;
  let rowsWritten = 0;
  const failures = [];

  try {
    for (const symbol of roster) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { spot, expiryCount, rows } = await gexRowsForSymbol(symbol);
        const win = windowRows(rows, spot);
        if (!win.length) {
          tickersFailed += 1;
          failures.push(`${symbol}: empty board`);
        } else {
          // eslint-disable-next-line no-await-in-loop
          await clearDay(day, symbol);
          // eslint-disable-next-line no-await-in-loop
          rowsWritten += await writeRows(day, symbol, spot || null, expiryCount, win);
          tickersOk += 1;
        }
      } catch (e) {
        tickersFailed += 1;
        failures.push(`${symbol}: ${e?.message || e}`);
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(TICKER_DELAY_MS);
    }
    await prune();
  } finally {
    _running = false;
  }

  // NOTE: runSweep deliberately does NOT set _lastRunDate. The scheduler owns
  // that claim (see startEodStrikeGexRecorder). If this claimed the day too, a
  // manual single-symbol fire — POST /proxy/eod-strike-gex-run?symbol=NVDA at
  // 14:00 to spot-check the endpoint — would mark the day done and silently
  // cancel the 16:05 full-watchlist sweep.
  const secs = Math.round((Date.now() - started) / 1000);
  // ok=false when nothing landed. Every per-ticker failure is swallowed above,
  // so without this an expired upstream session at 16:05 would fail all ~169
  // tickers, write zero rows, and still report success — which the scheduler
  // would read as "day done" and never retry. Losing a session silently is
  // worse than a noisy retry, and a lost session is a permanent hole in the Δ.
  const ok = rowsWritten > 0;
  const summary = {
    ok, date: day, tickersOk, tickersFailed, rowsWritten, seconds: secs,
    ...(ok ? {} : { error: 'sweep wrote no rows' }),
    failures: failures.slice(0, 10),
  };
  console[ok ? 'log' : 'warn'](
    `[eod-strike-gex] sweep ${ok ? 'done' : 'FAILED'} ${day} — ${tickersOk} ok / ${tickersFailed} failed, ` +
    `${rowsWritten} rows in ${secs}s`,
  );
  return summary;
}

// ── Read helpers (back the /proxy/eod-strike-gex-* endpoints) ───────────────

/**
 * Normalise an "as of" date param to YYYY-MM-DD, or null.
 *
 * Anything that is not exactly YYYY-MM-DD becomes null — i.e. "latest", the
 * behaviour every caller had before the date param existed. Deliberately NOT
 * passed through to Postgres to let it parse: a loose string reaches the query
 * as a `$n::date` cast, and a cast failure is a 500 out of a URL a reader can
 * type. Falling back to latest is the safe read.
 */
function normDate(v) {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Every session date that has recorded rows, newest first.
 *
 * Backs the ΔGEX Board's date picker. Reads DISTINCT date off
 * idx_eod_strike_gex_date, so it stays an index-only scan as the table grows to
 * a year of the full watchlist — this is a picker populate, not a report.
 */
async function listStrikeGexDates(limit = 90) {
  if (!(await ensureSchema())) return { ok: false, error: 'no DB' };
  const p = getPool();
  const n = Math.max(1, Math.min(400, Number(limit) || 90));
  const { rows } = await p.query(
    `SELECT DISTINCT to_char(date, 'YYYY-MM-DD') AS d
       FROM eod_strike_gex ORDER BY d DESC LIMIT $1`,
    [n],
  );
  return { ok: true, dates: rows.map((r) => r.d) };
}

/**
 * Per-strike GEX for one symbol as of a session, with the day-over-day change.
 *
 * `date` (optional, YYYY-MM-DD) is an AS-OF, not an exact match: the two most
 * recent snapshot dates ON OR BEFORE it. Omitted → the latest two, which is the
 * original behaviour. As-of rather than equality so a date typed into the URL,
 * or a picker entry from a symbol that missed that particular sweep, still
 * answers with the closest session it actually has instead of an empty ladder.
 *
 * Every row carries BOTH readings, so the client can switch between absolute
 * levels and the Δ without a second request:
 *   netGex  — the level at `date`
 *   chg     — that level minus the prior session's
 *
 * Takes the two most recent snapshot DATES that exist for the symbol — not
 * "today and yesterday" by calendar, which would break after a holiday, a
 * three-day weekend, or a missed run — and FULL JOINs them.
 *
 * FULL, not LEFT: the recorded window follows spot, and dead strikes are never
 * written at all. So a strike that carried real gamma yesterday and is out of
 * today's window (or went inert) has a `prev` row and NO `cur` row. Anchoring
 * on cur would discard exactly the largest negative changes — the wall that
 * came OFF, which is half of what this column exists to show.
 *
 * Returns { ok, symbol, date, prevDate, spot, prevSpot, rows:[{strike, netGex,
 * prevNetGex, chg, hadPrev}] }. Before a second snapshot ever lands, prevDate
 * is null and every chg reads 0 — the client renders that as "no baseline yet"
 * rather than as a board that did not move.
 */
async function getStrikeGexChange(symbol, { date = null } = {}) {
  if (!(await ensureSchema())) return { ok: false, error: 'no DB' };
  const p = getPool();
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym) return { ok: false, error: 'symbol required' };
  const asOf = normDate(date);

  // to_char, not the raw DATE: node-postgres turns a DATE into a JS Date at
  // LOCAL midnight, so formatting it back to YYYY-MM-DD shifts by a day on any
  // server east of UTC. Keeping it text end-to-end removes that whole class of
  // off-by-one, and `$n::date` casts it back for the comparisons below.
  const { rows: dateRows } = await p.query(
    `SELECT DISTINCT to_char(date, 'YYYY-MM-DD') AS d
       FROM eod_strike_gex
      WHERE symbol = $1
        AND ($2::text IS NULL OR date <= $2::date)
      ORDER BY d DESC LIMIT 2`,
    [sym, asOf],
  );
  if (!dateRows.length) {
    return { ok: true, symbol: sym, date: null, prevDate: null, spot: null, prevSpot: null, rows: [] };
  }

  const curDate = dateRows[0].d;
  const prevDate = dateRows[1]?.d ?? null;

  const { rows } = await p.query(
    `SELECT COALESCE(cur.strike, prev.strike)                     AS strike,
            COALESCE(cur.net_gex, 0)                              AS net_gex,
            COALESCE(prev.net_gex, 0)                             AS prev_net_gex,
            COALESCE(cur.net_gex, 0) - COALESCE(prev.net_gex, 0)  AS chg,
            (prev.strike IS NOT NULL)                             AS had_prev,
            MAX(cur.spot)  OVER ()                                AS cur_spot,
            MAX(prev.spot) OVER ()                                AS prev_spot
       FROM (SELECT * FROM eod_strike_gex
              WHERE symbol = $1 AND date = $2::date) cur
       FULL JOIN (SELECT * FROM eod_strike_gex
                   WHERE symbol = $1 AND date = $3::date) prev
         ON prev.strike = cur.strike
      ORDER BY 1`,
    [sym, curDate, prevDate],
  );

  return {
    ok: true,
    symbol: sym,
    date: curDate,
    prevDate,
    spot: rows.length ? (Number(rows[0].cur_spot) || null) : null,
    prevSpot: rows.length ? (Number(rows[0].prev_spot) || null) : null,
    rows: rows.map((r) => ({
      strike: Number(r.strike),
      netGex: Number(r.net_gex) || 0,
      prevNetGex: prevDate ? Number(r.prev_net_gex) || 0 : 0,
      chg: prevDate ? Number(r.chg) || 0 : 0,
      hadPrev: !!r.had_prev,
    })),
  };
}

/**
 * WHOLE-BOARD ranking — every symbol, its net ΔGEX, and its top N strikes by
 * |Δ|, in ONE query.
 *
 * WHY THIS EXISTS: the owner board renders ~169 names at once. Calling
 * getStrikeGexChange() per symbol would be 169 round trips to render one page,
 * each returning 81 rows the rail does not draw. This returns the ranking the
 * rail actually needs — the drill-in still uses the per-symbol route, because
 * that is one request for the one name you clicked.
 *
 * Each symbol is diffed against ITS OWN two most recent snapshot dates, not a
 * board-wide "today and yesterday". A ticker added to the roster last week, or
 * one whose chain failed at 16:05, has a different pair of dates than the rest
 * — anchoring the whole board on one date pair would silently show those names
 * as flat (or as an enormous fake change against nothing).
 *
 * `date` (optional, YYYY-MM-DD) is an AS-OF: each symbol's latest two dates ON
 * OR BEFORE it. Omitted → its latest two, the original behaviour. As-of, not
 * equality, for the same reason as getStrikeGexChange — a symbol that missed
 * that one sweep still answers with the session it actually has.
 *
 * TWO rankings come back per symbol, because the board reads in two modes and
 * one round trip has to serve both:
 *   net / absTot / strikes          — the Δ vs the prior session
 *   gexNet / gexAbs / gexStrikes    — the ABSOLUTE level at `date`
 * The Δ figures are computed on the FULL JOIN (a strike that fell out of the
 * window is the biggest negative change there is); the level figures are
 * computed on the cur side only, since a strike with no `cur` row has no level
 * to report — it is absent, not zero.
 *
 * Returns { ok, top, date, symbols: [{ symbol, date, prevDate, spot, net,
 * absTot, strikes: [{ strike, chg }], gexNet, gexAbs,
 * gexStrikes: [{ strike, gex }] }] } sorted by |absTot| desc — the rail's
 * default order; the client re-sorts for level mode off gexAbs/gexNet.
 * Symbols with only ONE snapshot are returned with net/absTot 0 and no Δ
 * strikes, so the rail can show them as "awaiting baseline" instead of dropping
 * them — their LEVEL figures are still real and still render.
 */
async function getStrikeGexBoard(topN = 5, { date = null } = {}) {
  if (!(await ensureSchema())) return { ok: false, error: 'no DB' };
  const p = getPool();
  const top = Math.max(1, Math.min(40, Number(topN) || 5));
  const asOf = normDate(date);

  // ONE pass. `d` ranks each symbol's own dates; `cur`/`prv` pick its latest
  // two; `j` FULL JOINs them (full, not left — a strike that fell out of the
  // window entirely is the biggest negative change there is); `agg` and the two
  // `ranked` CTEs are computed off that same CTE so the totals and the top-N
  // lists can never disagree about what the numbers were.
  //
  // The top-N lists are json_agg'd rather than LEFT JOINed as rows: joining two
  // independent rank lists on the same query would cross-product them (top²
  // rows per symbol, 4k+ rows to render 169 names). One row per symbol instead.
  const sql = `
    WITH d AS (
      SELECT symbol, date,
             dense_rank() OVER (PARTITION BY symbol ORDER BY date DESC) AS rk
        FROM (SELECT DISTINCT symbol, date FROM eod_strike_gex
               WHERE ($2::text IS NULL OR date <= $2::date)) s
    ),
    cur AS (SELECT symbol, date FROM d WHERE rk = 1),
    prv AS (SELECT symbol, date FROM d WHERE rk = 2),
    c AS (SELECT e.* FROM eod_strike_gex e JOIN cur ON cur.symbol = e.symbol AND cur.date = e.date),
    p AS (SELECT e.* FROM eod_strike_gex e JOIN prv ON prv.symbol = e.symbol AND prv.date = e.date),
    j AS (
      SELECT COALESCE(c.symbol, p.symbol)                        AS symbol,
             COALESCE(c.strike, p.strike)                        AS strike,
             COALESCE(c.net_gex, 0) - COALESCE(p.net_gex, 0)     AS chg,
             c.net_gex                                           AS lvl,
             c.spot                                              AS spot
        FROM c FULL JOIN p ON p.symbol = c.symbol AND p.strike = c.strike
    ),
    agg AS (
      SELECT symbol,
             SUM(chg)                                            AS net,
             SUM(ABS(chg))                                       AS abs_tot,
             SUM(COALESCE(lvl, 0))                               AS gex_net,
             SUM(ABS(COALESCE(lvl, 0)))                          AS gex_abs,
             MAX(spot)                                           AS spot
        FROM j GROUP BY symbol
    ),
    ranked AS (
      SELECT symbol, strike, chg,
             row_number() OVER (PARTITION BY symbol ORDER BY ABS(chg) DESC, strike) AS rn
        FROM j WHERE chg <> 0
    ),
    ranked_lvl AS (
      SELECT symbol, strike, lvl,
             row_number() OVER (PARTITION BY symbol ORDER BY ABS(lvl) DESC, strike) AS rn
        FROM j WHERE lvl IS NOT NULL AND lvl <> 0
    ),
    tops AS (
      SELECT symbol, json_agg(json_build_object('strike', strike, 'chg', chg) ORDER BY rn) AS s
        FROM ranked WHERE rn <= $1 GROUP BY symbol
    ),
    tops_lvl AS (
      SELECT symbol, json_agg(json_build_object('strike', strike, 'gex', lvl) ORDER BY rn) AS s
        FROM ranked_lvl WHERE rn <= $1 GROUP BY symbol
    )
    SELECT a.symbol,
           a.net, a.abs_tot, a.gex_net, a.gex_abs, a.spot,
           to_char(cur.date, 'YYYY-MM-DD')                       AS cur_date,
           to_char(prv.date, 'YYYY-MM-DD')                       AS prev_date,
           COALESCE(t.s,  '[]'::json)                            AS strikes,
           COALESCE(tl.s, '[]'::json)                            AS gex_strikes
      FROM agg a
      LEFT JOIN cur      ON cur.symbol = a.symbol
      LEFT JOIN prv      ON prv.symbol = a.symbol
      LEFT JOIN tops     t  ON t.symbol  = a.symbol
      LEFT JOIN tops_lvl tl ON tl.symbol = a.symbol
     ORDER BY ABS(a.abs_tot) DESC, a.symbol`;

  const { rows } = await p.query(sql, [top, asOf]);

  const symbols = rows.map((r) => {
    // prevDate null = the symbol has no session before this one. Its net/absTot
    // are then a diff against nothing, so they are forced to 0 here rather than
    // reported as a day-one landslide. The LEVEL figures are untouched — they
    // need no baseline.
    const hasBaseline = r.prev_date != null;
    return {
      symbol: r.symbol,
      date: r.cur_date,
      prevDate: r.prev_date ?? null,
      spot: Number(r.spot) || null,
      net: hasBaseline ? Number(r.net) || 0 : 0,
      absTot: hasBaseline ? Number(r.abs_tot) || 0 : 0,
      strikes: hasBaseline
        ? (r.strikes || []).map((k) => ({ strike: Number(k.strike), chg: Number(k.chg) || 0 }))
        : [],
      gexNet: Number(r.gex_net) || 0,
      gexAbs: Number(r.gex_abs) || 0,
      gexStrikes: (r.gex_strikes || []).map((k) => ({ strike: Number(k.strike), gex: Number(k.gex) || 0 })),
    };
  });

  return { ok: true, top, date: asOf, symbols };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

/**
 * Minute-poll rather than a single setTimeout to the next 16:05 — a poll
 * survives process restarts and clock drift, and the _lastRunDate guard keeps
 * it to exactly one sweep per day.
 */
function startEodStrikeGexRecorder() {
  if (_timer) return;
  if (process.env.EOD_STRIKE_GEX_RECORDER === '0') {
    console.log('[eod-strike-gex] recorder disabled (EOD_STRIKE_GEX_RECORDER=0)');
    return;
  }
  if (!symbolsSync().length) return;

  const check = () => {
    try {
      if (_running) return;
      if (!isTradingDayET()) return;
      const day = todayYmdET();
      if (_lastRunDate === day) return;
      const { minutes } = nowET();
      // Fire at RUN_AT_MIN, or on any later boot the same evening — the close is
      // a settled snapshot, so capturing it at 19:40 after a restart is just as
      // correct as capturing it at 16:05.
      if (minutes < RUN_AT_MIN || minutes >= WINDOW_CLOSE_MIN) return;
      _lastRunDate = day; // claim the day BEFORE awaiting, so a sweep that runs
                          // for eight minutes can't be double-fired by ticks
      runSweep({ date: day })
        .then((r) => {
          // Release the claim on a sweep that landed nothing (dead upstream, no
          // DB) so the next tick retries. The window runs to 22:00 ET, which is
          // hours of retries for a number that no longer moves.
          if (!r?.ok) {
            console.warn(`[eod-strike-gex] sweep did not land (${r?.error || 'unknown'}) — will retry`);
            _lastRunDate = null;
          }
        })
        .catch((e) => {
          console.warn('[eod-strike-gex] sweep error:', e.message);
          _lastRunDate = null;
        });
    } catch (e) {
      console.warn('[eod-strike-gex] scheduler error:', e.message);
    }
  };

  _timer = setInterval(check, 60_000);
  if (_timer.unref) _timer.unref();
  // First check shortly after boot so an evening restart still backfills today.
  setTimeout(check, 45_000);

  const hh = String(Math.floor(RUN_AT_MIN / 60)).padStart(2, '0');
  const mm = String(RUN_AT_MIN % 60).padStart(2, '0');
  console.log(
    `[eod-strike-gex] recorder started — ${symbolsSync().length} symbols × ` +
    `${EXPIRY_DEPTH > 0 ? EXPIRY_DEPTH : 'all'} expiries (ex-0DTE), ±${WINDOW_SIDE} strikes, ` +
    `once daily at ${hh}:${mm} ET, ${RETAIN_DAYS}d retention (roster re-resolved each sweep)`,
  );
}

module.exports = {
  startEodStrikeGexRecorder,
  runSweep,
  getStrikeGexChange,
  getStrikeGexBoard,
  listStrikeGexDates,
  ensureSchema,
  getPool,
  gexRowsForSymbol,
  windowRows,
};
