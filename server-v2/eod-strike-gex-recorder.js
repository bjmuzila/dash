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
 * ── THE FOUR BASES, AND THE BUG THAT FORCED THE SPLIT ───────────────────────
 * Until 2026-08-19 this table stored ONE number per strike: net_gex, on the
 * OI+Vol basis, i.e. |gamma| x (open_interest + volume). The day-over-day diff
 * of that number is broken, and not in the small way "16:05 is a bit early"
 * suggests.
 *
 * OI does not settle at the close. OCC publishes overnight and the figure the
 * chain carries at 16:05 on session T is the file settled through T-1's close.
 * Volume, on the same response, is T's full session. So a row is
 *
 *     row(T) = OI(T-1) + Vol(T)
 *
 * and the diff the board draws expands to
 *
 *     row(T) - row(T-1) = [OI(T-1) - OI(T-2)] + [Vol(T) - Vol(T-1)]
 *
 * The left bracket is the NET result of session T-1's trading. The right
 * bracket SUBTRACTS Vol(T-1), the GROSS of that same session. Session T-1
 * therefore appears in the Δ twice, once net and once gross, with opposite
 * signs — a name that traded heavy on Tuesday and quiet on Wednesday prints a
 * large negative Δ on Wednesday that has nothing to do with Wednesday. It is a
 * contamination, not a lag, and no scheduling change alone fixes it.
 *
 * So the table now carries the halves apart, and the read path takes a `basis`:
 *
 *   oivol — net_gex, the ORIGINAL series, untouched and still the default.
 *           Kept because a year of history is on it and because the level (as
 *           opposed to the diff) is the number every other surface in the app
 *           prints. Its Δ still has the double-count described above; the UI
 *           says so rather than the table quietly changing meaning.
 *   oi    — oi_gex, |gamma| x open_interest only. Re-stamped the next morning
 *           (see below) so BOTH sides of a diff are settled files and the Δ is
 *           a true session-over-session ΔOI. This is the honest structural read.
 *   vol   — vol_gex, |gamma| x volume only. Same-session by construction, so
 *           its LEVEL is "how much gamma actually traded today". Its Δ is a
 *           second difference (today's turnover vs yesterday's) and is the
 *           least useful of the four — the level is the read.
 *   flow  — flow_gex, signed DEALER INVENTORY x gamma, from the tape. The only
 *           basis of the four that knows direction. See getFlowLadder().
 *
 * net_gex/call_gex/put_gex are computed by the UNCHANGED expressions, so the
 * legacy series is bit-for-bit what it was. oi_gex + vol_gex therefore agrees
 * with net_gex only to float noise, not exactly — history continuity beat
 * exact additivity of the new columns, deliberately.
 *
 * ── THE MORNING OI RE-STAMP ─────────────────────────────────────────────────
 * A second, cheaper pass at 09:25 ET rewrites the PREVIOUS session's oi_*
 * columns off the freshly settled file, and stamps oi_stamped_date so a reader
 * can tell a settled row from a provisional one. Nothing else is touched: the
 * evening's net_gex, call_gex, put_gex and vol_* stay exactly as recorded.
 *
 * That is what makes the `oi` basis a real ΔOI. Without it, oi_gex on row(T)
 * would be OI(T-1) and the diff would be lagged one session — correct in shape
 * but describing the wrong day.
 *
 * ── WHY OI CANNOT TELL YOU DIRECTION (AND WHAT flow DOES ABOUT IT) ──────────
 * accumulateChainGex signs the legs by CONVENTION: calls +, puts -, both on
 * |gamma| x count. That is an assumption about who opened the position, not a
 * measurement, and open interest carries no side. A 6400 call strike with 40k
 * OI is dealer-short-gamma or dealer-long-gamma depending on whether the public
 * bought those calls or wrote them, and no amount of OI arithmetic can tell
 * those apart. Every one of the first three bases inherits that blindness.
 *
 * The flow basis does not. It is built from bid/ask-classified prints in
 * flow_prints, mirrored into a dealer position (taker buys -> dealer short,
 * taker sells -> dealer long), so its sign is measured rather than assumed. The
 * price is coverage: read the caveats in getFlowLadder() before trusting it —
 * it is premium-floored, it is a session quantity rather than a book, and for
 * anything but SPX it covers only the near-spot front-expiry window the
 * streamer subscribes to.
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
 *   eod_strike_gex(date, symbol, strike, net_gex, spot, expiry_count, ts,
 *                  call_gex, put_gex,
 *                  oi_gex,   oi_call_gex,   oi_put_gex,   oi_stamped_date,
 *                  vol_gex,  vol_call_gex,  vol_put_gex,
 *                  flow_gex, flow_call_gex, flow_put_gex, flow_prints)
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
 *   GET /proxy/eod-strike-gex-live?symbol=NVDA[&force=1]
 *   the SAME ladder shape, but the "now" side is computed off the live chain
 *   instead of read from the table, against the symbol's last recorded close.
 *   Writes NOTHING. Read the big comment above getStrikeGexLive() before using
 *   it — intraday, OI is last night's settled file and volume is only part
 *   accrued, so that Δ is today's tape building, NOT a session-over-session
 *   change. Cached per symbol for a minute; `force=1` bypasses the cache.
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

// ── OI RE-STAMP (see "THE MORNING OI RE-STAMP" in the header) ───────────────
// Minute-of-day ET for the pass that rewrites the PREVIOUS session's oi_*
// columns off the settled OI file. 565 = 09:25 ET — after OCC's overnight file
// is live on the feed, before 09:30 starts accruing today's volume.
const RESTAMP_AT_MIN = Number(process.env.EOD_STRIKE_GEX_RESTAMP_AT_MIN || 565);
// Latest minute the re-stamp may START. 11:00 ET. Wider than "before the bell"
// looks reckless but is not: this pass reads ONLY `open-interest`, which is a
// settled file that does not move again until tonight, so a sweep that crosses
// the open reads exactly the same number at 09:26 and at 10:40. The window is
// bounded at all only so a process booted mid-afternoon does not re-stamp a
// session the evening sweep is about to overwrite anyway.
const RESTAMP_CLOSE_MIN = Number(process.env.EOD_STRIKE_GEX_RESTAMP_CLOSE_MIN || 660);
// Set to 0 to disable the morning pass and leave oi_* as the provisional 16:05
// read (oi_stamped_date then stays NULL and the read path labels it as such).
const RESTAMP_ENABLED = process.env.EOD_STRIKE_GEX_RESTAMP !== '0';

// ── FLOW BASIS ──────────────────────────────────────────────────────────────
// Which underlyings get a signed dealer-inventory ladder written into flow_*.
// SPX/SPY/QQQ to start: SPX because the core feed engine streams its full
// active window, SPY/QQQ because MultiFlowManager already carries them. Every
// other symbol gets NULL flow_* columns, which the read path reports as "this
// basis has no data for this name" rather than as a flat zero board.
//
// Widening this list is cheap (one extra grouped read per symbol) but
// MEANINGLESS unless the root is actually streaming into flow_prints — that
// table only holds what the streamer subscribed to. Check FLOW_TICKERS and
// multi-flow.js before adding a name here.
const FLOW_GEX_SYMBOLS = new Set(
  String(process.env.EOD_STRIKE_GEX_FLOW_SYMBOLS || 'SPX,SPY,QQQ')
    .split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean),
);

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
  // CALL/PUT LEGS — added 2026-08-18, after the table had ~a year of rows.
  //
  // net_gex is the SUM of a positive call leg and a negative put leg, and the
  // sum is lossy: "net GEX fell" is equally consistent with call gamma coming
  // off and put gamma piling on. accumulateChainGex() always had both halves
  // and threw them away. Now it keeps them.
  //
  // NULLABLE, and there is deliberately NO BACKFILL — the chains those rows
  // were built from are gone, so every date before the migration has NULL legs
  // and the read path reports that honestly rather than inventing a split. Do
  // not "fix" this by deriving legs from net_gex; it cannot be done.
  //
  // ADD COLUMN IF NOT EXISTS so a redeploy against an existing table is a
  // no-op rather than an error, in the same spirit as the CREATE above.
  await p.query(`ALTER TABLE eod_strike_gex ADD COLUMN IF NOT EXISTS call_gex DOUBLE PRECISION;`);
  await p.query(`ALTER TABLE eod_strike_gex ADD COLUMN IF NOT EXISTS put_gex  DOUBLE PRECISION;`);

  // THE FOUR BASES — added 2026-08-19. See the header for why the single
  // OI+Vol number could not produce an honest day-over-day Δ.
  //
  // Same NULLABLE / NO BACKFILL rule as the legs above, and for the same
  // reason: the chains these rows were built from are gone. Every date before
  // this migration has NULL on all of them, and the read path reports that as
  // "this basis has no data for this session" rather than drawing a flat zero
  // board. Do NOT try to derive oi_gex from net_gex — the split is exactly the
  // information net_gex threw away.
  // THE FLOW GROSS LEGS — added with the rest on 2026-08-19.
  //
  // flow_call_gex is a NET of two opposite events: gamma the dealer took ON by
  // buying calls from the public, and gamma they took OFF by selling calls to
  // it. A strike where the dealer bought 5,000 and sold 5,000 nets to zero and
  // is indistinguishable from a strike nothing traded at — which is exactly the
  // ambiguity the whole basis split exists to remove, reappearing one level
  // down. So the four gross components are stored, not just the two nets.
  //
  // FULLY ADDITIVE, on purpose:
  //   flow_call_gex = flow_call_buy_gex + flow_call_sell_gex
  //   flow_put_gex  = flow_put_buy_gex  + flow_put_sell_gex
  //   flow_gex      = all four
  // *_buy_gex is always >= 0 (dealer long that leg) and *_sell_gex always <= 0
  // (dealer short it), so a reader can add any subset and get something true.
  for (const col of [
    'oi_gex', 'oi_call_gex', 'oi_put_gex',
    'vol_gex', 'vol_call_gex', 'vol_put_gex',
    'flow_gex', 'flow_call_gex', 'flow_put_gex',
    'flow_call_buy_gex', 'flow_call_sell_gex',
    'flow_put_buy_gex', 'flow_put_sell_gex',
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await p.query(`ALTER TABLE eod_strike_gex ADD COLUMN IF NOT EXISTS ${col} DOUBLE PRECISION;`);
  }
  // ── PER-BASIS CAPTURE TIMESTAMPS ────────────────────────────────────────
  //
  // `ts` is the INSERT clock and always has been. That is not the same fact as
  // "when was this data true", and on this table the two can be minutes apart
  // (the sweep paces ~169 symbols) or a whole session apart (a re-stamped oi_*
  // was read the next morning, not at the 16:05 write). A reader comparing two
  // bases needs to know each one's own as-of, not the row's.
  //
  //   captured_at      — when the chain read for THIS symbol began. Covers
  //                      oivol, vol, and oi while it is still provisional.
  //   oi_captured_at   — when the settled-OI read began. NULL until the morning
  //                      pass runs, at which point oi_* is as of THIS instant
  //                      and no longer as of captured_at.
  //   flow_captured_at — when the flow aggregate was computed off flow_prints.
  //
  // Read start, not write finish: a symbol whose chain sweep takes 40 seconds
  // describes the book as it was when the fetch went out, and stamping the
  // INSERT would date it 40 seconds late every time.
  await p.query(`ALTER TABLE eod_strike_gex ADD COLUMN IF NOT EXISTS captured_at      TIMESTAMPTZ;`);
  await p.query(`ALTER TABLE eod_strike_gex ADD COLUMN IF NOT EXISTS oi_captured_at   TIMESTAMPTZ;`);
  await p.query(`ALTER TABLE eod_strike_gex ADD COLUMN IF NOT EXISTS flow_captured_at TIMESTAMPTZ;`);
  // Which settled-OI file the oi_* columns came from.
  //   NULL      → provisional: written by the 16:05 sweep off the file settled
  //               through the PREVIOUS session, never re-stamped. Diffing two
  //               of these is lagged one session.
  //   = date    → settled: the 09:25 pass rewrote it off this session's own
  //               settled file. Diffing two of these is a true ΔOI.
  // A reader must be able to tell the two apart, so this is a stored fact and
  // not an inference from `ts`.
  await p.query(`ALTER TABLE eod_strike_gex ADD COLUMN IF NOT EXISTS oi_stamped_date DATE;`);
  // How many classified prints backed this strike's flow_gex. 0/NULL is the
  // honest "no tape here", which is a different statement from "flow gamma
  // netted to zero" — the ladder needs to tell those apart.
  await p.query(`ALTER TABLE eod_strike_gex ADD COLUMN IF NOT EXISTS flow_prints INTEGER;`);
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
 * The two contract counts, kept APART.
 *
 * `oi + vol` is still the OI+Vol basis and still what net_gex is built from —
 * that has not changed and must not, because the Ticker Lookup card, the Multi
 * Greek card and the Options Chain ⅀ Total column all count
 * `open-interest + volume` and the card's footer says "OI+Vol basis". Recording
 * plain OI into net_gex would make the Δ column subtract a different number
 * from the one printed beside it.
 *
 * What changed on 2026-08-19 is that the halves are now ALSO kept separately,
 * because their day-over-day diffs are not commensurable: OI at 16:05 is the
 * file settled through the PREVIOUS close while volume is this session's, so
 * summing them first and differencing second double-counts a session (header,
 * "THE FOUR BASES"). Returning the pair lets accumulateChainGex build all three
 * OI/vol ladders in one pass over the chain.
 */
const counts = (o) => {
  if (!o) return { oi: 0, vol: 0 };
  const oi = parseInt(String(o['open-interest'] ?? o.openInterest ?? 0), 10) || 0;
  const vol = parseInt(String(o.volume ?? 0), 10) || 0;
  return { oi, vol };
};

/**
 * The expirations to sweep.
 *
 * `bucket` = 'board' (default) → every listed date strictly AFTER today ET.
 * `bucket` = 'zerodte'         → today ET only.
 *
 * ── WHY 0DTE IS LIVE-ONLY, AND IS NOT A NEW COLUMN ──────────────────────────
 * The obvious design was a second expiry bucket in eod_strike_gex, and it is
 * the wrong one. The recorded sweep fires at 16:05 ET — AFTER the close, by
 * which point today's 0DTE has expired. Storing it would store a ladder of
 * zeros under a column implying it meant something, every single day, forever.
 *
 * Intraday it is the opposite: 0DTE is the fastest-moving gamma on the board
 * and it is the half the recorded series structurally cannot see. So the split
 * is exposed on the LIVE route only, where "now" is a real moment inside the
 * session, and the table keeps its ex-0DTE definition unchanged.
 */
async function resolveBoardExpiries(ticker, bucket = 'board') {
  const { items } = await fetchExpirations(ticker).catch(() => ({ items: [] }));
  const today = todayYmdET();
  if (bucket === 'zerodte') {
    const has = (items || [])
      .map((it) => String(it['expiration-date'] || '').slice(0, 10))
      .some((d) => d === today);
    return has ? [today] : [];
  }
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
function accumulateChainGex(payload, acc, expiry = '', gammaAcc = null) {
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
      const cCnt = counts(c);
      const pCnt = counts(p);
      const cc = cCnt.oi + cCnt.vol;
      const pc = pCnt.oi + pCnt.vol;
      // No book AND no tape is a dead strike — skip it rather than write the
      // whole inert tail of every chain.
      if (cc === 0 && pc === 0) continue;
      const cGamma = Math.abs(num(c, 'gamma'));
      const pGamma = Math.abs(num(p, 'gamma'));
      // The two legs, kept apart. `callLeg` is always >= 0 and `putLeg` always
      // <= 0, and callLeg + putLeg is EXACTLY the old single expression — the
      // net number is bit-for-bit what it was before the split, which is what
      // lets the legs land alongside a year of history without a discontinuity.
      //
      // The four basis legs below are computed as SEPARATE products rather than
      // by re-deriving them from callLeg/putLeg, so each is exact on its own
      // terms. The consequence, stated plainly because someone will one day
      // write an assertion about it: oi_gex + vol_gex agrees with net_gex only
      // to float noise. That is the accepted trade — a year of net_gex history
      // must not shift by an ulp to make the new columns sum prettily.
      const callLeg = cGamma * cc * mult;
      const putLeg = -pGamma * pc * mult;
      const oiCallLeg = cGamma * cCnt.oi * mult;
      const oiPutLeg = -pGamma * pCnt.oi * mult;
      const volCallLeg = cGamma * cCnt.vol * mult;
      const volPutLeg = -pGamma * pCnt.vol * mult;
      if (!Number.isFinite(callLeg) || !Number.isFinite(putLeg)) continue;

      let cur = acc.get(strike);
      if (!cur) {
        cur = {
          gex: 0, callGex: 0, putGex: 0,
          oiGex: 0, oiCallGex: 0, oiPutGex: 0,
          volGex: 0, volCallGex: 0, volPutGex: 0,
        };
        acc.set(strike, cur);
      }
      cur.gex += callLeg + putLeg;
      cur.callGex += callLeg;
      cur.putGex += putLeg;
      cur.oiGex += oiCallLeg + oiPutLeg;
      cur.oiCallGex += oiCallLeg;
      cur.oiPutGex += oiPutLeg;
      cur.volGex += volCallLeg + volPutLeg;
      cur.volCallGex += volCallLeg;
      cur.volPutGex += volPutLeg;

      // PER-EXPIRY GAMMA, for the flow basis only.
      //
      // Flow inventory in flow_prints is keyed by (expiration, strike): the
      // same strike carries different gamma on a weekly and on a LEAP, so
      // folding inventory across expiries first and multiplying by one gamma
      // afterwards would be wrong by whatever the term structure is. Keeping
      // the per-expiry gamma here lets getFlowLadder() multiply each expiry's
      // inventory by ITS OWN gamma and only then sum into the strike.
      //
      // `mult` rides along because it is a function of the spot captured on
      // THIS response, and the flow pass runs after the sweep has moved on.
      if (gammaAcc && expiry) {
        gammaAcc.set(`${expiry}|${strike}`, { cGamma, pGamma, mult });
      }
    }
  }
  return S;
}

/**
 * The whole board for one symbol, ex-0DTE, summed per strike.
 * Returns { spot, expiryCount, rows: [{ strike, gex }] } ascending by strike.
 */
async function gexRowsForSymbol(symbol, bucket = 'board', { wantGamma = false } = {}) {
  // Stamped BEFORE the first fetch: this is the moment the book being described
  // was read, not the moment the write finished. See the captured_at note in
  // ensureSchema for why the difference matters.
  const capturedAt = new Date();
  const expiries = await resolveBoardExpiries(symbol, bucket);
  if (!expiries.length) return { spot: 0, expiryCount: 0, rows: [], gamma: null, capturedAt };

  const acc = new Map();
  // Only allocated when a caller is going to build a flow ladder — for the
  // other ~166 names this stays null and the sweep costs exactly what it did.
  const gammaAcc = wantGamma ? new Map() : null;
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
        const S = accumulateChainGex(payload, acc, exp, gammaAcc);
        if (S > 0) { spot = S; ok += 1; }
      } catch {
        // One dead expiry must not blank the symbol — it just narrows the
        // board, and expiryCount records how narrow it actually got.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(EXPIRY_CONCURRENCY, expiries.length) }, worker));

  const rows = [...acc.entries()]
    .map(([strike, v]) => ({
      strike,
      gex: v.gex, callGex: v.callGex, putGex: v.putGex,
      oiGex: v.oiGex, oiCallGex: v.oiCallGex, oiPutGex: v.oiPutGex,
      volGex: v.volGex, volCallGex: v.volCallGex, volPutGex: v.volPutGex,
    }))
    // The `gex !== 0` filter stays on the OI+Vol net, unchanged, so the recorded
    // strike SET is identical to what it has always been. Filtering on any of
    // the new bases would silently change which rungs exist and break the
    // continuity of the level series.
    .filter((r) => Number.isFinite(r.strike) && r.strike > 0 && Number.isFinite(r.gex) && r.gex !== 0)
    .sort((a, b) => a.strike - b.strike);

  return { spot, expiryCount: ok, rows, gamma: gammaAcc, capturedAt };
}

/**
 * OPEN-INTEREST-ONLY ladder, for the 09:25 re-stamp.
 *
 * Same walk as gexRowsForSymbol but it reads `open-interest` and nothing else,
 * because that is the only field on the chain that has changed meaning since
 * last night: OCC settled overnight and the file now describes the PREVIOUS
 * session's close. `volume` on this same response is either yesterday's stale
 * figure or already accruing today's — either way it is not the volume that
 * belongs on the row being re-stamped, which is why this deliberately does not
 * touch vol_* or net_gex.
 */
async function oiRowsForSymbol(symbol) {
  const capturedAt = new Date();
  const expiries = await resolveBoardExpiries(symbol, 'board');
  if (!expiries.length) return { spot: 0, expiryCount: 0, rows: [], capturedAt };

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
        const data = payload?.data ?? payload;
        const items = Array.isArray(data?.items) ? data.items : [];
        const S = Number(data?.underlyingPrice) || 0;
        if (!(S > 0) || !items.length) continue;
        const mult = S * S * 0.01 * 100;
        for (const group of items) {
          for (const s of group?.strikes || []) {
            const strike = parseFloat(String(s['strike-price'] ?? 0));
            if (!(strike > 0)) continue;
            const oiC = counts(s.call).oi;
            const oiP = counts(s.put).oi;
            if (oiC === 0 && oiP === 0) continue;
            const callLeg = Math.abs(num(s.call, 'gamma')) * oiC * mult;
            const putLeg = -Math.abs(num(s.put, 'gamma')) * oiP * mult;
            if (!Number.isFinite(callLeg) || !Number.isFinite(putLeg)) continue;
            const cur = acc.get(strike);
            if (cur) {
              cur.oiGex += callLeg + putLeg;
              cur.oiCallGex += callLeg;
              cur.oiPutGex += putLeg;
            } else {
              acc.set(strike, { oiGex: callLeg + putLeg, oiCallGex: callLeg, oiPutGex: putLeg });
            }
          }
        }
        spot = S;
        ok += 1;
      } catch {
        // Same rule as the evening sweep: one dead expiry narrows the ladder
        // rather than losing the symbol.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(EXPIRY_CONCURRENCY, expiries.length) }, worker));

  const rows = [...acc.entries()]
    .map(([strike, v]) => ({ strike, ...v }))
    .filter((r) => Number.isFinite(r.strike) && r.strike > 0 && Number.isFinite(r.oiGex))
    .sort((a, b) => a.strike - b.strike);

  return { spot, expiryCount: ok, rows, capturedAt };
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

// ── FLOW BASIS: signed dealer inventory × gamma ─────────────────────────────
//
// The other three bases all sign their legs by CONVENTION — calls positive,
// puts negative, on |gamma| × an unsigned contract count. Open interest carries
// no side, so none of them can tell "the public bought 40k of the 6400 calls"
// (dealer short gamma) from "the public wrote 40k of them" (dealer long). This
// basis is the one that can, because it is built from prints that were
// classified against the prevailing bid/ask and then mirrored:
//
//     taker BUY  → dealer SOLD    → dealer short that contract
//     taker SELL → dealer BOUGHT  → dealer long that contract
//
// which is the same rule FlowGexAccumulator.ingestTape and
// flow-gex-rehydrate.rebuildInventoryFromFlowPrints already apply live. This
// function is the end-of-day, per-strike, all-expiries version of that read,
// and it deliberately reuses the SQL shape of the rehydrate query so the two
// definitions of "dealer inventory" cannot drift apart.
//
// POLARITY: both legs use the SAME sign, unlike the OI bases. Negating the put
// term there converts "customer long puts" into "dealer implicitly short"; here
// that conversion is already baked into the inventory's sign, so doing it again
// would double-negate. Dealer long (either side) = positive gamma contribution.
// See the long comment on FlowGexAccumulator.computeFlowGEX, which says the same.
//
// ── READ THESE FOUR CAVEATS BEFORE TRUSTING THE NUMBER ──────────────────────
// 1. PREMIUM-FLOORED. flow_prints only holds prints above FLOW_TAPE_FLOOR
//    (default $5,000 premium). This is block/sweep flow, NOT the whole tape, so
//    flow_gex is systematically smaller in magnitude than vol_gex and the two
//    are not comparable in size. It answers "which way did the SIZE lean", not
//    "how much traded".
// 2. COVERAGE IS NOT THE CHAIN. Only SPX gets a full active window (the core
//    engine streams it). SPY/QQQ come through MultiFlowManager, which
//    subscribes a near-spot band (FLOW_STRIKE_WINDOW_PCT, default ±6%) of the
//    NEAREST expiry only. So a SPY flow ladder is front-expiry and near-money
//    by construction — a wall four months out is invisible to it, and its
//    absence is not evidence.
// 3. UNCLASSIFIED PRINTS ARE DROPPED, not guessed. FlowProcessor coerces
//    mid/unknown prints to side:'buy' for the display tape but tags them
//    bucket:'neutral'; including those would bias the whole ladder short. The
//    `bucket <> 'neutral'` filter below is load-bearing.
// 4. IT IS A SESSION, NOT A BOOK. Dealer inventory here resets every morning —
//    it is what dealers took on TODAY, not what they are carrying. So the LEVEL
//    is the read. A day-over-day Δ of it is a second difference ("did today
//    lean harder than yesterday") and is almost never the question.
/**
 * Per-strike flow GEX for one symbol on one session, from flow_prints.
 *
 * @param {string} symbol
 * @param {string} date 'YYYY-MM-DD'
 * @param {Map<string,{cGamma,pGamma,mult}>} gamma per-expiry `exp|strike` gamma
 *   captured during the same chain sweep (see accumulateChainGex).
 * @returns {Promise<Map<number,{flowGex,flowCallGex,flowPutGex,prints}>>}
 */
async function getFlowLadder(symbol, date, gamma) {
  const out = new Map();
  const p = getPool();
  if (!p || !gamma || !gamma.size) return out;

  let rows;
  try {
    ({ rows } = await p.query(
      `SELECT expiration, strike, type, side, SUM(size) AS vol, COUNT(*) AS n
         FROM flow_prints
        WHERE date = $1
          AND underlying_norm = $2
          AND strike IS NOT NULL
          AND size IS NOT NULL
          AND expiration IS NOT NULL
          AND (bucket IS NULL OR bucket <> 'neutral')
          AND side IN ('buy','sell')
        GROUP BY expiration, strike, type, side`,
      [date, symbol],
    ));
  } catch (e) {
    // A missing flow_prints table (a deploy without the flow writer) must not
    // take the whole sweep down — the other three bases are unaffected.
    console.warn(`[eod-strike-gex] flow read ${symbol} ${date} failed:`, e.message);
    return out;
  }
  if (!rows.length) return out;

  // (expiration|strike) → dealer position per leg, kept GROSS.
  //
  // callLong is contracts the dealer ended up LONG (the public sold them);
  // callShort is contracts the dealer ended up SHORT (the public bought them).
  // Netting these here would throw away the distinction between a quiet strike
  // and a busy two-way one before it ever reached the table — see the schema
  // comment above the flow gross columns.
  const inv = new Map();
  for (const r of rows) {
    const strike = Number(r.strike);
    const vol = Number(r.vol);
    if (!(strike > 0) || !(vol > 0)) continue;
    const key = `${r.expiration}|${strike}`;
    let v = inv.get(key);
    if (!v) {
      v = { callLong: 0, callShort: 0, putLong: 0, putShort: 0, prints: 0 };
      inv.set(key, v);
    }
    v.prints += Number(r.n) || 0;
    // Mirror: a taker BUY leaves the dealer SHORT that contract; a taker SELL
    // leaves the dealer LONG it.
    const dealerShort = r.side === 'buy';
    if (r.type === 'C') {
      if (dealerShort) v.callShort += vol; else v.callLong += vol;
    } else if (r.type === 'P') {
      if (dealerShort) v.putShort += vol; else v.putLong += vol;
    }
  }

  for (const [key, v] of inv) {
    const g = gamma.get(key);
    // No gamma for this (expiry, strike) means the evening chain sweep never
    // saw it — an expiry that failed, or a strike outside what the chain
    // returned. Skipped rather than assumed: a flow print with no gamma has no
    // GEX, and inventing one from a neighbouring strike would be fabrication.
    if (!g) continue;
    const strike = Number(key.split('|')[1]);
    if (!(strike > 0)) continue;
    // SAME polarity on both legs — the sign is already in the inventory, so
    // long is positive and short is negative on calls and puts alike. (The OI
    // bases negate the put term to turn "customer long puts" into "dealer
    // implicitly short"; here that conversion has already happened.)
    const callBuy = g.cGamma * v.callLong * g.mult;
    const callSell = -g.cGamma * v.callShort * g.mult;
    const putBuy = g.pGamma * v.putLong * g.mult;
    const putSell = -g.pGamma * v.putShort * g.mult;
    if (![callBuy, callSell, putBuy, putSell].every(Number.isFinite)) continue;
    let cur = out.get(strike);
    if (!cur) {
      cur = {
        flowGex: 0, flowCallGex: 0, flowPutGex: 0,
        flowCallBuyGex: 0, flowCallSellGex: 0,
        flowPutBuyGex: 0, flowPutSellGex: 0,
        prints: 0,
      };
      out.set(strike, cur);
    }
    cur.flowCallBuyGex += callBuy;
    cur.flowCallSellGex += callSell;
    cur.flowPutBuyGex += putBuy;
    cur.flowPutSellGex += putSell;
    // Rolled up from the gross components, so the additive identity in the
    // schema comment holds by construction rather than by coincidence.
    cur.flowCallGex += callBuy + callSell;
    cur.flowPutGex += putBuy + putSell;
    cur.flowGex += callBuy + callSell + putBuy + putSell;
    cur.prints += v.prints;
  }
  return out;
}

/** Bulk upsert one symbol's windowed ladder. Chunked so $n stays sane. */
async function writeRows(date, symbol, spot, expiryCount, rows, capturedAt = null, flowCapturedAt = null) {
  const p = getPool();
  if (!p || !rows.length) return 0;
  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    // $5 = captured_at (chain read start), $6 = flow_captured_at. Both per
    // SYMBOL, not per sweep — a 169-name sweep spans minutes and each name's
    // book was read at its own moment.
    const params = [date, symbol, spot, expiryCount, capturedAt, flowCapturedAt];
    const values = [];
    slice.forEach((r) => {
      const ph = [
        r.strike, r.gex, r.callGex ?? null, r.putGex ?? null,
        r.oiGex ?? null, r.oiCallGex ?? null, r.oiPutGex ?? null,
        r.volGex ?? null, r.volCallGex ?? null, r.volPutGex ?? null,
        r.flowGex ?? null, r.flowCallGex ?? null, r.flowPutGex ?? null,
        r.flowCallBuyGex ?? null, r.flowCallSellGex ?? null,
        r.flowPutBuyGex ?? null, r.flowPutSellGex ?? null,
        r.flowPrints ?? null,
      ].map((v) => `$${params.push(v)}`);
      values.push(`($1,$2,${ph[0]},${ph[1]},$3,$4,now(),${ph.slice(2).join(',')},$5,$6)`);
    });
    // Upsert, so a manual re-fire after a bad close overwrites the day instead
    // of erroring — that is what makes POST /proxy/eod-strike-gex-run safe.
    //
    // oi_stamped_date is NOT in this statement, deliberately. The evening sweep
    // writes a PROVISIONAL oi_gex (settled through the previous close), and
    // leaving the stamp NULL is what marks it as such. Only the 09:25 pass sets
    // it. A re-fire of the evening sweep correctly clears any stamp back to
    // NULL — the row it just overwrote is provisional again.
    // eslint-disable-next-line no-await-in-loop
    await p.query(
      `INSERT INTO eod_strike_gex
         (date, symbol, strike, net_gex, spot, expiry_count, ts, call_gex, put_gex,
          oi_gex, oi_call_gex, oi_put_gex,
          vol_gex, vol_call_gex, vol_put_gex,
          flow_gex, flow_call_gex, flow_put_gex,
          flow_call_buy_gex, flow_call_sell_gex,
          flow_put_buy_gex, flow_put_sell_gex, flow_prints,
          captured_at, flow_captured_at)
       VALUES ${values.join(',')}
       ON CONFLICT (date, symbol, strike) DO UPDATE
         SET net_gex            = EXCLUDED.net_gex,
             spot               = EXCLUDED.spot,
             expiry_count       = EXCLUDED.expiry_count,
             ts                 = EXCLUDED.ts,
             call_gex           = EXCLUDED.call_gex,
             put_gex            = EXCLUDED.put_gex,
             oi_gex             = EXCLUDED.oi_gex,
             oi_call_gex        = EXCLUDED.oi_call_gex,
             oi_put_gex         = EXCLUDED.oi_put_gex,
             vol_gex            = EXCLUDED.vol_gex,
             vol_call_gex       = EXCLUDED.vol_call_gex,
             vol_put_gex        = EXCLUDED.vol_put_gex,
             flow_gex           = EXCLUDED.flow_gex,
             flow_call_gex      = EXCLUDED.flow_call_gex,
             flow_put_gex       = EXCLUDED.flow_put_gex,
             flow_call_buy_gex  = EXCLUDED.flow_call_buy_gex,
             flow_call_sell_gex = EXCLUDED.flow_call_sell_gex,
             flow_put_buy_gex   = EXCLUDED.flow_put_buy_gex,
             flow_put_sell_gex  = EXCLUDED.flow_put_sell_gex,
             flow_prints        = EXCLUDED.flow_prints,
             captured_at        = EXCLUDED.captured_at,
             flow_captured_at   = EXCLUDED.flow_captured_at,
             -- A re-fire of the evening sweep makes oi_* provisional again, so
             -- BOTH the settled marker and its timestamp have to clear. Leaving
             -- oi_captured_at behind would date a provisional read to the
             -- morning pass that no longer applies to it.
             oi_stamped_date    = NULL,
             oi_captured_at     = NULL`,
      params,
    );
    written += slice.length;
  }
  return written;
}

/**
 * Rewrite one symbol's oi_* columns for one session off the settled OI file.
 *
 * UPDATE, never INSERT: this pass corrects rows the evening sweep already
 * wrote. A strike that has settled OI but no recorded row is one the evening
 * sweep excluded (dead on the OI+Vol basis, or outside the ±WINDOW_SIDE band),
 * and adding it here would make the row SET of a session depend on which pass
 * ran last — the level series has to keep one definition of "which rungs exist".
 *
 * Touches oi_gex, oi_call_gex, oi_put_gex and oi_stamped_date and NOTHING else.
 * net_gex, call_gex, put_gex and vol_* are the evening's record of a settled
 * close and stay exactly as they were; the whole point of the basis split is
 * that correcting OI no longer means rewriting the legacy series.
 */
async function restampOi(date, symbol, rows, capturedAt = null) {
  const p = getPool();
  if (!p || !rows.length) return 0;
  const CHUNK = 400;
  let touched = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const strikes = slice.map((r) => r.strike);
    const oi = slice.map((r) => r.oiGex);
    const oiC = slice.map((r) => r.oiCallGex);
    const oiP = slice.map((r) => r.oiPutGex);
    // eslint-disable-next-line no-await-in-loop
    const { rowCount } = await p.query(
      `UPDATE eod_strike_gex g
          SET oi_gex          = v.oi,
              oi_call_gex     = v.oic,
              oi_put_gex      = v.oip,
              oi_stamped_date = $1::date,
              oi_captured_at  = $7
         FROM (SELECT unnest($3::double precision[]) AS strike,
                      unnest($4::double precision[]) AS oi,
                      unnest($5::double precision[]) AS oic,
                      unnest($6::double precision[]) AS oip) v
        WHERE g.date = $1::date AND g.symbol = $2 AND g.strike = v.strike`,
      [date, symbol, strikes, oi, oiC, oiP, capturedAt],
    );
    touched += rowCount || 0;
  }
  return touched;
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
  let flowSymbols = 0;
  const failures = [];

  try {
    for (const symbol of roster) {
      try {
        const wantFlow = FLOW_GEX_SYMBOLS.has(symbol);
        // eslint-disable-next-line no-await-in-loop
        const { spot, expiryCount, rows, gamma, capturedAt } = await gexRowsForSymbol(symbol, 'board', { wantGamma: wantFlow });
        // Its own stamp: the flow aggregate runs after the chain sweep for this
        // symbol finishes, so it is a later moment than captured_at even though
        // both land in the same INSERT.
        let flowCapturedAt = null;
        const win = windowRows(rows, spot);
        if (!win.length) {
          tickersFailed += 1;
          failures.push(`${symbol}: empty board`);
        } else {
          // FLOW BASIS, for the handful of names that stream into flow_prints.
          // Folded onto the SAME windowed rows rather than written as its own
          // ladder: a strike with flow but no OI+Vol row does not exist on this
          // board, and one row set per (date, symbol) is what keeps every basis
          // describing the same rungs.
          //
          // Failure here is contained — the other three bases are already in
          // `win` and land regardless. A flow outage must not cost a session.
          if (wantFlow) {
            try {
              flowCapturedAt = new Date();
              // eslint-disable-next-line no-await-in-loop
              const flow = await getFlowLadder(symbol, day, gamma);
              if (flow.size) {
                for (const r of win) {
                  const f = flow.get(r.strike);
                  if (!f) continue;
                  r.flowGex = f.flowGex;
                  r.flowCallGex = f.flowCallGex;
                  r.flowPutGex = f.flowPutGex;
                  r.flowCallBuyGex = f.flowCallBuyGex;
                  r.flowCallSellGex = f.flowCallSellGex;
                  r.flowPutBuyGex = f.flowPutBuyGex;
                  r.flowPutSellGex = f.flowPutSellGex;
                  r.flowPrints = f.prints;
                }
                flowSymbols += 1;
              } else {
                flowCapturedAt = null; // nothing landed — do not date an absence
                failures.push(`${symbol}: no classified flow prints for ${day}`);
              }
            } catch (e) {
              flowCapturedAt = null;
              failures.push(`${symbol}: flow basis failed (${e?.message || e})`);
            }
          }
          // eslint-disable-next-line no-await-in-loop
          await clearDay(day, symbol);
          // eslint-disable-next-line no-await-in-loop
          rowsWritten += await writeRows(day, symbol, spot || null, expiryCount, win, capturedAt, flowCapturedAt);
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
    ok, date: day, tickersOk, tickersFailed, rowsWritten, flowSymbols, seconds: secs,
    ...(ok ? {} : { error: 'sweep wrote no rows' }),
    failures: failures.slice(0, 10),
  };
  console[ok ? 'log' : 'warn'](
    `[eod-strike-gex] sweep ${ok ? 'done' : 'FAILED'} ${day} — ${tickersOk} ok / ${tickersFailed} failed, ` +
    `${rowsWritten} rows, ${flowSymbols} with flow, in ${secs}s`,
  );
  return summary;
}

// ── The morning OI re-stamp ─────────────────────────────────────────────────
//
// WHY THIS PASS EXISTS, IN ONE LINE: at 16:05 the chain's open-interest field
// is the file OCC settled through the PREVIOUS close, so the oi_* columns the
// evening sweep writes describe the wrong session. This corrects them once the
// real file lands overnight.
//
// It re-stamps the LATEST RECORDED SESSION, which on a normal Wednesday morning
// is Tuesday's rows. Explicitly not "yesterday by calendar" — after a holiday
// or a long weekend the latest recorded session is several days back, and that
// is still exactly the session whose settled file is now on the feed.
//
// GUARD: never re-stamps a row dated today. Today's rows can only exist if a
// manual re-fire wrote them, and their OI is provisional by definition until
// TOMORROW morning — stamping them settled would be a lie, and a load-bearing
// one, since the whole value of the `oi` basis is that both sides of a diff
// carry the stamp.
//
// COST: one more full chain sweep of the roster, same shape and same pacing as
// the evening one. That is the honest price of a correct ΔOI; there is no
// cheaper source for settled open interest than the chain itself.
let _restamping = false;
let _lastRestampDate = null;

/**
 * @param {object} [opts]
 * @param {string[]|null} [opts.symbols] narrow the roster (manual route)
 * @param {string|null}   [opts.date] force a session; default = latest recorded
 */
async function runOiRestamp({ symbols = null, date = null } = {}) {
  if (_restamping) return { ok: false, error: 'restamp already running' };
  _restamping = true;
  try {
    if (!(await ensureSchema())) return { ok: false, error: 'no DB' };
    const p = getPool();
    const today = todayYmdET();

    // Which session are we correcting? The latest recorded one STRICTLY BEFORE
    // today, resolved from the table rather than from the calendar.
    let target = normDate(date);
    if (!target) {
      const { rows } = await p.query(
        `SELECT to_char(MAX(date), 'YYYY-MM-DD') AS d
           FROM eod_strike_gex WHERE date < $1::date`,
        [today],
      );
      target = rows[0]?.d ?? null;
    }
    if (!target) return { ok: false, error: 'no recorded session to re-stamp' };
    if (target >= today) return { ok: false, error: `refusing to stamp ${target} settled — its OI file lands tomorrow` };

    const roster = (symbols && symbols.length) ? symbols : await resolveSymbols();
    const started = Date.now();
    let tickersOk = 0;
    let tickersFailed = 0;
    let rowsTouched = 0;
    const failures = [];

    for (const symbol of roster) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { rows, capturedAt } = await oiRowsForSymbol(symbol);
        if (!rows.length) {
          tickersFailed += 1;
          failures.push(`${symbol}: empty OI board`);
        } else {
          // eslint-disable-next-line no-await-in-loop
          const n = await restampOi(target, symbol, rows, capturedAt);
          rowsTouched += n;
          // 0 rows touched is not a failure: the symbol may simply have no rows
          // on that date (added to the roster since), and the UPDATE correctly
          // did nothing.
          tickersOk += 1;
        }
      } catch (e) {
        tickersFailed += 1;
        failures.push(`${symbol}: ${e?.message || e}`);
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(TICKER_DELAY_MS);
    }

    const secs = Math.round((Date.now() - started) / 1000);
    const ok = rowsTouched > 0;
    console[ok ? 'log' : 'warn'](
      `[eod-strike-gex] OI re-stamp ${ok ? 'done' : 'FAILED'} for ${target} — ` +
      `${tickersOk} ok / ${tickersFailed} failed, ${rowsTouched} rows in ${secs}s`,
    );
    return {
      ok, date: target, tickersOk, tickersFailed, rowsTouched, seconds: secs,
      ...(ok ? {} : { error: 're-stamp touched no rows' }),
      failures: failures.slice(0, 10),
    };
  } finally {
    _restamping = false;
  }
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
/** NULL stays null; anything numeric becomes a number. Never 0-for-missing. */
function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normDate(v) {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * BASIS → the three columns that back it. See "THE FOUR BASES" in the header.
 *
 * This map is the ONLY place a basis name becomes a column name, and every read
 * below goes through normBasis() to reach it. That is a security boundary as
 * much as a tidiness one: these identifiers are interpolated into SQL (Postgres
 * has no parameter form for a column name), so an unvalidated basis string
 * would be an injection. normBasis falls back to 'oivol' for anything not
 * literally one of these four keys — never passes the input through.
 */
const BASIS_COLS = {
  oivol: { net: 'net_gex', call: 'call_gex', put: 'put_gex' },
  oi: { net: 'oi_gex', call: 'oi_call_gex', put: 'oi_put_gex' },
  vol: { net: 'vol_gex', call: 'vol_call_gex', put: 'vol_put_gex' },
  flow: { net: 'flow_gex', call: 'flow_call_gex', put: 'flow_put_gex' },
};
const BASES = Object.keys(BASIS_COLS);

/**
 * WHICH TIMESTAMP DATES A BASIS. Each one is a different read of a different
 * source at a different moment, so "when was this data run" has four answers,
 * not one.
 *
 *   oivol / vol — captured_at, the chain read.
 *   oi          — oi_captured_at once the morning pass has settled it;
 *                 captured_at while it is still the provisional 16:05 read.
 *                 COALESCE, in that order, is the whole rule.
 *   flow        — flow_captured_at, the flow_prints aggregate.
 *
 * All three fall back to `ts` (the INSERT clock) for rows written before these
 * columns existed — a coarser answer, but a true one, and better than a NULL
 * the page has to explain.
 */
const BASIS_STAMP = {
  oivol: ['captured_at', 'ts'],
  vol: ['captured_at', 'ts'],
  oi: ['oi_captured_at', 'captured_at', 'ts'],
  flow: ['flow_captured_at', 'captured_at', 'ts'],
};

/** `COALESCE(alias.a, alias.b, …)` for a basis's stamp chain. */
const stampExpr = (bas, alias) =>
  `COALESCE(${BASIS_STAMP[normBasis(bas)].map((c) => `${alias}.${c}`).join(', ')})`;

/** Anything unrecognised reads as the legacy basis — same rule as normDate. */
function normBasis(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(BASIS_COLS, s) ? s : 'oivol';
}

/**
 * LEG — which half of a basis the ladder is made of. Orthogonal to `basis`:
 * basis picks the contract count, leg picks which option type's gamma.
 *
 *   net  — call leg + put leg. The default and the only reading with a
 *          meaningful zero crossing (see the badge note below).
 *   call — the call leg alone.
 *   put  — the put leg alone.
 *
 * WHAT THE SIGN MEANS PER BASIS, because it differs and the difference matters:
 *
 *   oivol / oi / vol — the legs are signed by CONVENTION, so `call` is always
 *     >= 0 and `put` always <= 0, everywhere, by construction. A call-leg
 *     ladder is therefore a one-sided picture of WHERE call gamma sits, not a
 *     directional read; it can never cross zero and has no flip.
 *   flow — the legs are signed by MEASUREMENT (dealer long positive, short
 *     negative), so either leg can take either sign. "Dealers are short call
 *     gamma at 6400 and long put gamma at 6300" is a sentence only this basis
 *     can produce, and the leg selector is how you read it.
 *
 * On the three unsigned bases `net` is call + put and the sum is lossy in the
 * documented way; splitting it is exactly how you recover "did the call wall
 * come off, or did put gamma pile on".
 */
const LEG_COLS = { net: 'net', call: 'call', put: 'put' };
const LEGS = Object.keys(LEG_COLS);

function normLeg(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEG_COLS, s) ? s : 'net';
}

/**
 * (basis, leg) → the one column the ladder's level/Δ is read from.
 *
 * Same security boundary as BASIS_COLS: this is where a request parameter
 * becomes a SQL identifier, and both inputs come through norm* first, so the
 * output is always one of twelve literals from that table.
 */
function levelCol(bas, leg) {
  return BASIS_COLS[normBasis(bas)][normLeg(leg)];
}

/**
 * The four gross flow components. Only non-NULL on the flow basis, and only for
 * sessions since the migration — everything else reads them as NULL, which the
 * client renders as "not recorded" rather than as zero.
 */
const FLOW_GROSS_COLS = {
  callBuy: 'flow_call_buy_gex',
  callSell: 'flow_call_sell_gex',
  putBuy: 'flow_put_buy_gex',
  putSell: 'flow_put_sell_gex',
};

/**
 * Every session date that has recorded rows, newest first.
 *
 * Backs the ΔGEX Board's date picker. Reads DISTINCT date off
 * idx_eod_strike_gex_date, so it stays an index-only scan as the table grows to
 * a year of the full watchlist — this is a picker populate, not a report.
 */
async function listStrikeGexDates(limit = 90, { basis = 'oivol', leg = 'net' } = {}) {
  if (!(await ensureSchema())) return { ok: false, error: 'no DB' };
  const p = getPool();
  const n = Math.max(1, Math.min(400, Number(limit) || 90));
  const bas = normBasis(basis);
  const lg = normLeg(leg);
  // Basis AND leg scoped: the picker must offer the sessions this exact reading
  // can answer for. Both dimensions have their own migration date — the legs
  // landed 2026-08-18 and the bases 2026-08-19 — so an unfiltered list would
  // offer a year of dates that draw an empty ladder on anything but oivol/net.
  const LVL = levelCol(bas, lg);
  const { rows } = await p.query(
    `SELECT DISTINCT to_char(date, 'YYYY-MM-DD') AS d
       FROM eod_strike_gex
      WHERE ${LVL} IS NOT NULL
      ORDER BY d DESC LIMIT $1`,
    [n],
  );
  return { ok: true, basis: bas, leg: lg, dates: rows.map((r) => r.d) };
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
async function getStrikeGexChange(symbol, { date = null, basis = 'oivol', leg = 'net' } = {}) {
  if (!(await ensureSchema())) return { ok: false, error: 'no DB' };
  const p = getPool();
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym) return { ok: false, error: 'symbol required' };
  const asOf = normDate(date);
  const bas = normBasis(basis);
  const lg = normLeg(leg);
  const C = BASIS_COLS[bas];
  // The level/Δ column follows the LEG; the call/put columns beside it are
  // always the full pair, so the ladder can show "you are reading the call leg,
  // and here is the put leg it was split from" without a second request.
  const LVL = levelCol(bas, lg);
  const gross = bas === 'flow' ? FLOW_GROSS_COLS : null;
  // The as-of for THIS basis, both sides. Not the row's `ts` — see BASIS_STAMP.

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

  // `basis` selects which trio of columns backs netGex/callGex/putGex. The row
  // SHAPE is identical across all four, so the client's ladder renders any of
  // them unchanged — only the MEANING of the number differs, which is why the
  // basis is echoed back and the page is required to label it.
  //
  // COALESCE(...,0) on the level is safe for `oivol` (NOT NULL since day one)
  // but NOT self-evidently so for the three new ones, where NULL means "this
  // session predates the migration" or "this name has no flow". `hasBasis`
  // below is what distinguishes a genuine zero board from an unrecorded one;
  // the client must check it before drawing.
  const { rows } = await p.query(
    `SELECT COALESCE(cur.strike, prev.strike)                       AS strike,
            COALESCE(cur.${LVL}, 0)                                 AS net_gex,
            COALESCE(prev.${LVL}, 0)                                AS prev_net_gex,
            COALESCE(cur.${LVL}, 0) - COALESCE(prev.${LVL}, 0)      AS chg,
            (prev.strike IS NOT NULL)                               AS had_prev,
            -- has_cur/has_prev are the PRE-COALESCE truth. The level columns
            -- above are COALESCEd to 0 for arithmetic, which destroys exactly
            -- the distinction that matters most on the three new bases:
            -- "recorded as zero" vs "never recorded". These two carry it.
            (cur.${LVL} IS NOT NULL)                                AS has_cur,
            (prev.${LVL} IS NOT NULL)                               AS has_prev,
            -- Legs stay NULL-able all the way to the client. NOT COALESCEd to
            -- 0: a date recorded before the migration has no legs, and a zero
            -- would render as "no call gamma here" instead of "not recorded".
            cur.${C.call}                                           AS call_gex,
            cur.${C.put}                                            AS put_gex,
            prev.${C.call}                                          AS prev_call_gex,
            prev.${C.put}                                           AS prev_put_gex,
            cur.flow_prints                                         AS flow_prints,
            ${gross ? `
            -- The four GROSS flow components. flow_call_gex is a net of two
            -- opposite events, so a strike where the dealer bought 5k and sold
            -- 5k nets to zero and reads identically to one nothing traded at.
            -- These take that ambiguity back out. Additive:
            -- call_buy + call_sell = call leg, all four = flow_gex.
            cur.${gross.callBuy}                                    AS f_call_buy,
            cur.${gross.callSell}                                   AS f_call_sell,
            cur.${gross.putBuy}                                     AS f_put_buy,
            cur.${gross.putSell}                                    AS f_put_sell,
            prev.${gross.callBuy}                                   AS pf_call_buy,
            prev.${gross.callSell}                                  AS pf_call_sell,
            prev.${gross.putBuy}                                    AS pf_put_buy,
            prev.${gross.putSell}                                   AS pf_put_sell,` : ''}
            MAX(cur.spot)  OVER ()                                  AS cur_spot,
            MAX(prev.spot) OVER ()                                  AS prev_spot,
            -- MAX, not MIN: the sweep paces across the roster, so within one
            -- symbol every row shares a stamp anyway; MAX is simply the latest
            -- moment any part of this ladder was true.
            MAX(${stampExpr(bas, 'cur')})  OVER ()                   AS cur_at,
            MAX(${stampExpr(bas, 'prev')}) OVER ()                   AS prev_at,
            -- Settled-OI provenance, both sides. The oi basis is only a true
            -- session-over-session ΔOI when BOTH carry a stamp; the client
            -- says so when they do not.
            BOOL_OR(cur.oi_stamped_date  IS NOT NULL) OVER ()        AS cur_settled,
            BOOL_OR(prev.oi_stamped_date IS NOT NULL) OVER ()        AS prev_settled
       FROM (SELECT * FROM eod_strike_gex
              WHERE symbol = $1 AND date = $2::date) cur
       FULL JOIN (SELECT * FROM eod_strike_gex
                   WHERE symbol = $1 AND date = $3::date) prev
         ON prev.strike = cur.strike
      ORDER BY 1`,
    [sym, curDate, prevDate],
  );

  const hasBasis = rows.some((r) => r.has_cur);

  return {
    ok: true,
    symbol: sym,
    date: curDate,
    prevDate,
    basis: bas,
    leg: lg,
    spot: rows.length ? (Number(rows[0].cur_spot) || null) : null,
    prevSpot: rows.length ? (Number(rows[0].prev_spot) || null) : null,
    rows: rows.map((r) => ({
      strike: Number(r.strike),
      netGex: Number(r.net_gex) || 0,
      prevNetGex: prevDate ? Number(r.prev_net_gex) || 0 : 0,
      chg: prevDate ? Number(r.chg) || 0 : 0,
      hadPrev: !!r.had_prev,
      callGex: numOrNull(r.call_gex),
      putGex: numOrNull(r.put_gex),
      prevCallGex: prevDate ? numOrNull(r.prev_call_gex) : null,
      prevPutGex: prevDate ? numOrNull(r.prev_put_gex) : null,
      // Only meaningful on the flow basis: how many classified prints backed
      // this rung. NULL/0 = no tape here, which is not the same as "netted out".
      ...(bas === 'flow' ? {
        flowPrints: numOrNull(r.flow_prints),
        // Gross decomposition — what the net was made of. *Buy is dealer LONG
        // that leg (>= 0), *Sell is dealer SHORT it (<= 0).
        callBuyGex: numOrNull(r.f_call_buy),
        callSellGex: numOrNull(r.f_call_sell),
        putBuyGex: numOrNull(r.f_put_buy),
        putSellGex: numOrNull(r.f_put_sell),
        prevCallBuyGex: prevDate ? numOrNull(r.pf_call_buy) : null,
        prevCallSellGex: prevDate ? numOrNull(r.pf_call_sell) : null,
        prevPutBuyGex: prevDate ? numOrNull(r.pf_put_buy) : null,
        prevPutSellGex: prevDate ? numOrNull(r.pf_put_sell) : null,
      } : {}),
    })),
    // Whether the split is available on BOTH sides. The client needs one flag,
    // not 81 null checks, to decide between showing the split and explaining
    // why it cannot.
    hasLegs: rows.some((r) => r.call_gex != null),
    hasPrevLegs: !!prevDate && rows.some((r) => r.prev_call_gex != null),
    // FALSE = this basis has nothing recorded for this session/symbol. A board
    // of zeros and an unrecorded board look identical once COALESCEd, and the
    // difference matters enormously — "SPY had no flow" vs "we did not record
    // flow for SPY". The page must branch on this, not on the row values.
    hasBasis,
    hasPrevBasis: !!prevDate && rows.some((r) => r.has_prev),
    // Whether the gross split is available. Separate from hasBasis: a flow
    // session recorded before the gross columns shipped has a real net ladder
    // and NULL components, and the page must offer the net without implying it
    // can decompose it.
    hasGross: !!gross && rows.some((r) => r.f_call_buy != null || r.f_put_buy != null),
    // Δ-validity on the `oi` basis. Both stamped → a true session-over-session
    // ΔOI. Either missing → the OI half is lagged and the page must say so.
    oiSettled: !!rows[0]?.cur_settled,
    prevOiSettled: !!rows[0]?.prev_settled,
    /**
     * WHEN THIS BASIS WAS ACTUALLY RUN, both sides. Every basis is a different
     * read of a different source at a different moment — `oi` after a re-stamp
     * is a full session newer than the `vol` sitting in the same row — so the
     * page must print the stamp for the basis on screen, never the row's write
     * clock. ISO here; the client formats to ET.
     */
    capturedAt: rows[0]?.cur_at ? new Date(rows[0].cur_at).toISOString() : null,
    prevCapturedAt: rows[0]?.prev_at ? new Date(rows[0].prev_at).toISOString() : null,
  };
}

// ── LIVE read: last recorded close vs the chain RIGHT NOW ───────────────────
//
// getStrikeGexChange() answers "close vs close". This answers "close vs NOW":
// the prior side is still the symbol's most recent recorded session, but the
// current side is computed on demand off the live chain instead of read out of
// eod_strike_gex.
//
// ── WHAT THIS NUMBER ACTUALLY IS ────────────────────────────────────────────
// NOT a one-day Δ, and it must never be labelled as one. The OI+Vol basis is
// half settled open interest and half day volume:
//   • OI is last night's settled file and does not move until tomorrow's.
//   • Volume starts at zero at 09:30 and accrues all session.
// So `chg` here is, in the main, TODAY'S TAPE ACCUMULATING on top of a fixed OI
// base. At 09:31 it reads ~0 and it grows through the day — that is the whole
// signal, not a bug. The header of this file explains why the recorded sweep
// waits until 16:05 for exactly this reason; this route deliberately breaks
// that rule, so the client is required to say so on the page.
//
// ── NOTHING IS WRITTEN ──────────────────────────────────────────────────────
// This never touches eod_strike_gex. An intraday row in that table would become
// tomorrow's Δ baseline and would silently corrupt the recorded series — which
// is also why this is a separate function and not runSweep() with a flag.
//
// ── COST ────────────────────────────────────────────────────────────────────
// One symbol × every listed expiry, ex-0DTE — the same work one slice of the
// nightly sweep does, i.e. a few seconds of TastyTrade chain fetches. That is
// far too expensive to run per render or per rail click, so results are cached
// per symbol for LIVE_TTL_MS and concurrent callers share one in-flight sweep.
// The client's ↻ passes force=1, which skips the cache but still joins an
// in-flight job rather than starting a second one.
const LIVE_TTL_MS = Math.max(5_000, Number(process.env.EOD_STRIKE_GEX_LIVE_TTL_MS || 60_000));
// Bounded so a long-running process cannot accumulate a ladder per symbol
// forever. This is a cache, not a store.
const LIVE_CACHE_MAX = 220;

/** symbol → { at, payload }. */
const _liveCache = new Map();
/** symbol → Promise, so N callers on one symbol cost ONE chain sweep. */
const _liveInflight = new Map();

/**
 * The symbol's most recent recorded session: its date, its ladder and its spot.
 * ONE date, not two — the other side of this comparison is the live chain.
 */
async function latestRecordedLadder(sym, bas = 'oivol', lg = 'net') {
  if (!(await ensureSchema())) return { prevDate: null, prevSpot: null, prevMap: new Map() };
  const C = BASIS_COLS[normBasis(bas)];
  const LVL = levelCol(bas, lg);
  const p = getPool();
  // to_char for the same reason getStrikeGexChange uses it — a raw DATE comes
  // back as a JS Date at LOCAL midnight and formats back a day early east of
  // UTC.
  const { rows: dr } = await p.query(
    `SELECT to_char(MAX(date), 'YYYY-MM-DD') AS d FROM eod_strike_gex WHERE symbol = $1`,
    [sym],
  );
  const prevDate = dr[0]?.d ?? null;
  if (!prevDate) return { prevDate: null, prevSpot: null, prevMap: new Map() };

  const { rows } = await p.query(
    `SELECT strike, ${LVL} AS net_gex, spot, ${C.call} AS call_gex, ${C.put} AS put_gex,
            oi_stamped_date, ${stampExpr(bas, 'eod_strike_gex')} AS captured_at
       FROM eod_strike_gex WHERE symbol = $1 AND date = $2::date`,
    [sym, prevDate],
  );
  const prevMap = new Map();
  let prevSpot = null;
  let prevSettled = false;
  let prevAt = null;
  for (const r of rows) {
    prevMap.set(Number(r.strike), {
      gex: Number(r.net_gex) || 0,
      callGex: numOrNull(r.call_gex),
      putGex: numOrNull(r.put_gex),
    });
    if (prevSpot == null && Number(r.spot) > 0) prevSpot = Number(r.spot);
    if (r.oi_stamped_date != null) prevSettled = true;
    if (prevAt == null && r.captured_at != null) prevAt = r.captured_at;
  }
  return { prevDate, prevSpot, prevMap, prevSettled, prevAt };
}

/**
 * The uncached body of getStrikeGexLive(). Never call this directly.
 *
 * BASIS ON THE LIVE ROUTE: oivol / oi / vol are all computable straight off the
 * chain, so all three are live-able. `flow` is NOT — it needs classified prints
 * out of flow_prints, which the streamer is still writing for the open session,
 * and a half-written session is not a ladder. Asking for flow here returns an
 * explicit error rather than silently falling back to another basis, because a
 * silent fallback would put an unsigned OI number under a header that says the
 * sign was measured.
 */
async function computeStrikeGexLive(sym, bas = 'oivol', lg = 'net') {
  if (bas === 'flow') {
    return {
      ok: false,
      error: 'flow basis has no live read — it is built from the recorded session tape',
    };
  }
  // Recorded side first: it is a cheap indexed read, and if the chain sweep
  // below throws we have paid nothing for it.
  const { prevDate, prevSpot, prevMap, prevSettled, prevAt } = await latestRecordedLadder(sym, bas, lg);

  // The ex-0DTE board (comparable to the recorded close) and today's 0DTE
  // (which the recorded series structurally cannot contain — see
  // resolveBoardExpiries) are fetched TOGETHER, because they are one answer:
  // "what does the book look like now, and how much of that is expiring today".
  // Separate round trips would let a reader see them from different seconds.
  const [board, zero] = await Promise.all([
    gexRowsForSymbol(sym, 'board'),
    gexRowsForSymbol(sym, 'zerodte').catch(() => ({ spot: 0, expiryCount: 0, rows: [] })),
  ]);
  const { spot, expiryCount, rows } = board;
  if (!rows.length) return { ok: false, error: `no live chain data for ${sym}` };

  // The same ±WINDOW_SIDE index slice the recorder writes, so the live ladder
  // and the recorded one are the same SHAPE and the union below stays ~81 rungs
  // rather than the whole chain.
  const win = windowRows(rows, spot);
  // Which field off the live row this basis reads. The chain carries all three,
  // so the basis is a projection here rather than a different fetch.
  const basePick = bas === 'oi'
    ? (r) => ({ gex: r.oiGex, callGex: r.oiCallGex, putGex: r.oiPutGex })
    : bas === 'vol'
      ? (r) => ({ gex: r.volGex, callGex: r.volCallGex, putGex: r.volPutGex })
      : (r) => ({ gex: r.gex, callGex: r.callGex, putGex: r.putGex });
  // …then the LEG projects the level out of that pair. callGex/putGex stay the
  // full pair regardless, so the ladder can still show what the leg was split
  // from without a second fetch — same contract as the recorded route.
  const pick = (r) => {
    const b = basePick(r);
    return { ...b, gex: lg === 'call' ? b.callGex : lg === 'put' ? b.putGex : b.gex };
  };
  const liveMap = new Map(win.map((r) => [r.strike, { ...r, ...pick(r) }]));

  // UNION of both windows, not just the live one — the same reason
  // getStrikeGexChange FULL JOINs instead of LEFT JOINing. A strike that
  // carried real gamma at the close and has gone inert (or fallen out of the
  // window as spot moved) is the single biggest negative change there is, and
  // anchoring on the live side would discard exactly those.
  const strikes = [...new Set([...liveMap.keys(), ...prevMap.keys()])].sort((a, b) => a - b);

  const out = strikes.map((strike) => {
    const cur = liveMap.get(strike);
    const netGex = cur?.gex ?? 0;
    const prior = prevDate ? (prevMap.get(strike) ?? null) : null;
    const prevNetGex = prior?.gex ?? 0;
    return {
      strike,
      netGex,
      prevNetGex,
      chg: prevDate ? netGex - prevNetGex : 0,
      hadPrev: prevMap.has(strike),
      // Live ALWAYS has the legs — they come straight off the chain, so unlike
      // the recorded side there is no pre-migration gap to explain here.
      callGex: cur ? cur.callGex : null,
      putGex: cur ? cur.putGex : null,
      prevCallGex: prior ? prior.callGex : null,
      prevPutGex: prior ? prior.putGex : null,
    };
  });

  // 0DTE rides along as a SUMMARY, not a second ladder: the question it answers
  // is "how much of what I am looking at expires tonight", and that is a number
  // and a handful of strikes, not 81 more rungs.
  // Projected through the SAME basis as the ladder above — a 0DTE share
  // computed on OI+Vol under a "volume only" header would be comparing two
  // different quantities and the share would be nonsense.
  const zeroWin = (zero.rows.length ? windowRows(zero.rows, zero.spot || spot) : [])
    .map((r) => ({ ...r, ...pick(r) }));
  const zeroNet = zeroWin.reduce((t, r) => t + r.gex, 0);
  const zeroAbs = zeroWin.reduce((t, r) => t + Math.abs(r.gex), 0);

  const today = todayYmdET();
  return {
    ok: true,
    symbol: sym,
    // Shaped exactly like getStrikeGexChange so the client's ladder renders it
    // unchanged. `live` is what tells the client to relabel — the ladder maths
    // is identical, only the MEANING of the "now" column differs.
    date: today,
    prevDate,
    spot: spot > 0 ? spot : null,
    prevSpot,
    rows: out,
    live: true,
    asOf: new Date().toISOString(),
    expiryCount,
    hasLegs: true,
    hasPrevLegs: [...prevMap.values()].some((v) => v.callGex != null),
    basis: bas,
    leg: lg,
    // Live never has the gross flow split — it only exists on the flow basis,
    // which has no live read at all.
    hasGross: false,
    // Live is ALWAYS computed off the chain, so the current side of an `oi`
    // read is whatever OI the feed is carrying right now — which is last
    // night's settled file. It is therefore never "settled for today", and the
    // prior side is settled only if the morning pass reached it.
    oiSettled: false,
    prevOiSettled: !!prevSettled,
    // Live's current side is read at THIS instant by definition; the prior side
    // keeps whatever moment its recorded basis was captured at.
    capturedAt: new Date().toISOString(),
    prevCapturedAt: prevAt ? new Date(prevAt).toISOString() : null,
    hasBasis: true,
    hasPrevBasis: [...prevMap.values()].some((v) => Number.isFinite(v.gex)),
    // null (not zero) when the symbol has no expiry dated today at all — "this
    // name has no 0DTE" and "its 0DTE nets to zero" are different facts.
    zeroDte: zeroWin.length
      ? {
        net: zeroNet,
        abs: zeroAbs,
        strikes: [...zeroWin].sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex)).slice(0, 5)
          .map((r) => ({ strike: r.strike, gex: r.gex, callGex: r.callGex, putGex: r.putGex })),
        // What share of everything on screen expires tonight. The reason this
        // summary exists: a board that is mostly 0DTE is a different object
        // from one that is mostly structural, and the ladder cannot show it.
        shareOfAbs: zeroAbs + out.reduce((t, r) => t + Math.abs(r.netGex), 0) === 0
          ? 0
          : zeroAbs / (zeroAbs + out.reduce((t, r) => t + Math.abs(r.netGex), 0)),
      }
      : null,
    // The post-16:05 case: today's sweep has already landed, so the "prior"
    // side IS today's close and `chg` collapses to post-close chain drift
    // rather than a session's build. The client warns instead of pretending.
    prevIsToday: prevDate === today,
    marketDay: isTradingDayET(),
  };
}

/**
 * Cached, de-duplicated wrapper around computeStrikeGexLive().
 *
 * `force` skips the CACHE but deliberately still joins an in-flight sweep: two
 * fast clicks on ↻ must not fire two full chain sweeps at TastyTrade.
 */
async function getStrikeGexLive(symbol, { force = false, basis = 'oivol', leg = 'net' } = {}) {
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym) return { ok: false, error: 'symbol required' };
  const bas = normBasis(basis);
  const lg = normLeg(leg);
  // The cache and the in-flight de-dupe are keyed by SYMBOL+BASIS+LEG, not
  // symbol. Keying on symbol alone would serve an `oi` ladder to a `vol`
  // request for the next 60 seconds — the same rungs, silently the wrong
  // number — and dropping the leg would do the same for call vs put.
  const key = `${sym}|${bas}|${lg}`;

  const now = Date.now();
  const hit = _liveCache.get(key);
  if (!force && hit && now - hit.at < LIVE_TTL_MS) {
    return { ...hit.payload, cached: true, ageMs: now - hit.at };
  }

  let job = _liveInflight.get(key);
  if (!job) {
    job = computeStrikeGexLive(sym, bas, lg)
      .then((val) => {
        if (val?.ok) {
          if (_liveCache.size >= LIVE_CACHE_MAX) {
            // Map iterates in insertion order, so the first key is the oldest
            // WRITE. Good enough for a TTL cache — this is a bound, not an LRU.
            const oldest = _liveCache.keys().next().value;
            if (oldest !== undefined) _liveCache.delete(oldest);
          }
          _liveCache.set(key, { at: Date.now(), payload: val });
        }
        return val;
      })
      .catch((e) => ({ ok: false, error: String(e?.message || e) }))
      .finally(() => { _liveInflight.delete(key); });
    _liveInflight.set(key, job);
  }

  const res = await job;
  return res?.ok ? { ...res, cached: false, ageMs: 0 } : res;
}

/**
 * PER-SYMBOL STRUCTURAL SUMMARY — what the rail badges read.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 * The rail ranks 169 names by |Δ| alone, so a symbol whose gamma flip jumped
 * seven strikes on a modest dollar change sorts below five names that did
 * nothing structurally interesting. You cannot see it without opening it, and
 * opening 169 names is the thing this page exists to avoid.
 *
 * ── WHY THIS IS NODE AND NOT SQL ────────────────────────────────────────────
 * The flip is a zero crossing of the LOCAL (kernel-weighted) net gamma profile
 * — an O(strikes x grid) scan, not a window function. It was expressible in
 * Postgres under the old running-total rule; under this one it is not worth
 * trying, and it never should have been two implementations anyway: the client
 * carries the same definition in GexGrowth.tsx and the two must agree exactly
 * or the rail badge contradicts the tile it opens. This pulls the per-strike
 * rows ONE time and reduces them here, so there is one definition per side and
 * they are line-for-line the same.
 *
 * The wire cost is what matters and it is unchanged: ~169 symbols × ~81 strikes
 * × 2 dates is a few tens of thousands of rows over a local socket, reduced to
 * one small object per symbol before it reaches the browser. The board endpoint
 * still answers in one round trip and still sends the browser a ranking, not a
 * ladder.
 *
 * Returns Map<symbol, { flipNow, flipPrev, flipMove, flips, callWall, putWall,
 * wallChg, structScore }>.
 */
async function getStrikeGexBadges(pairs, bas = 'oivol') {
  const out = new Map();
  if (!pairs.length) return out;
  const p = getPool();
  if (!p) return out;
  // BASIS-aware, deliberately NOT leg-aware — always the NET column.
  //
  // Every figure this function produces (gamma flip, call wall, put wall, sign
  // flips) is a property of the two legs TOGETHER. The flip is a sign change in
  // net gamma, and on the three unsigned bases the call leg is >= 0 and the put
  // leg <= 0 at every strike by construction — so a single-leg profile is
  // one-signed everywhere and can never change sign. Computing a "flip" on
  // it would return null for every symbol on the board, or worse, a number from
  // a curve that has no crossing to find. Walls have the same problem: the call
  // wall is the largest POSITIVE rung above spot, and on a put-leg ladder there
  // are none.
  //
  // So the badges describe the book, and the ladder beside them describes the
  // leg you asked for. Those are different questions and the badge answers the
  // one that still means something.
  const C = BASIS_COLS[normBasis(bas)];

  // One query for every (symbol, date) pair the board already resolved, so the
  // badge and the row beside it can never be describing different sessions.
  const syms = pairs.map((x) => x.symbol);
  const curDates = pairs.map((x) => x.date);
  const prevDates = pairs.map((x) => x.prevDate || x.date);
  const { rows } = await p.query(
    `SELECT g.symbol, to_char(g.date,'YYYY-MM-DD') AS d, g.strike, g.${C.net} AS net_gex, g.spot
       FROM eod_strike_gex g
       JOIN (SELECT unnest($1::text[]) AS symbol,
                    unnest($2::date[]) AS cur,
                    unnest($3::date[]) AS prev) w
         ON w.symbol = g.symbol AND (g.date = w.cur OR g.date = w.prev)
      ORDER BY g.symbol, g.date, g.strike`,
    [syms, curDates, prevDates],
  );

  /**
   * GAMMA FLIP — zero crossings of the LOCAL net gamma profile. Line-for-line
   * the same rule as flipCrossings() in owner-vite/src/pages/GexGrowth.tsx; if
   * you change one, change both, or the rail badge will disagree with the tile
   * it opens.
   *
   * REPLACED THE RUNNING-TOTAL RULE ON 2026-08-21. The cumulative starts at 0
   * and ends at the book's net, so on a put-dominant chain it falls through the
   * put side and never climbs back — no crossing, no badge, for most SPX
   * sessions. And where it did print, the level was set by how much far-OTM put
   * gamma sat at the bottom of the recorded window rather than by anything
   * dealers hedge at spot. Dealer gamma at a price is dominated by the strikes
   * NEAR that price, so the exposure with price at S is the book weighted by a
   * bell centred on S, and the flip is where that profile changes sign.
   *
   * The kernel width is SMOOTHING, not a volatility claim: 1% of spot blends
   * the weekly and quarterly gamma the ladder stacks together, floored at two
   * strike spacings so a wide-strike name does not collapse onto one rung.
   */
  const FLIP_KERNEL_PCT = 0.01;
  const FLIP_GRID_STEPS = 240;
  const spacing = (ks) => {
    if (ks.length < 2) return 1;
    const gaps = [];
    for (let i = 1; i < ks.length; i++) { const g = ks[i] - ks[i - 1]; if (g > 0) gaps.push(g); }
    if (!gaps.length) return 1;
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  };
  const localGamma = (ks, vs, S, w) => {
    let g = 0;
    for (let i = 0; i < ks.length; i++) {
      const z = (ks[i] - S) / w;
      if (z > 4 || z < -4) continue;
      g += vs[i] * Math.exp(-0.5 * z * z);
    }
    return g;
  };
  const crossings = (ladder, spotRef) => {
    if (!ladder || ladder.length < 3) return [];
    const asc = [...ladder].sort((a, b) => a.strike - b.strike);
    const ks = asc.map((r) => r.strike);
    const vs = asc.map((r) => r.gex);
    const lo = ks[0], hi = ks[ks.length - 1];
    if (!(hi > lo)) return [];
    const ref = spotRef > 0 ? spotRef : ks[Math.floor(ks.length / 2)];
    const w = Math.max(ref * FLIP_KERNEL_PCT, spacing(ks) * 2);
    const res = [];
    let pS = lo, pG = localGamma(ks, vs, lo, w);
    for (let i = 1; i <= FLIP_GRID_STEPS; i++) {
      const S = lo + ((hi - lo) * i) / FLIP_GRID_STEPS;
      const G = localGamma(ks, vs, S, w);
      if ((pG < 0 && G >= 0) || (pG > 0 && G <= 0)) {
        const t = G === pG ? 0 : (0 - pG) / (G - pG);
        res.push(pS + t * (S - pS));
      }
      pS = S; pG = G;
    }
    return res;
  };
  const nearest = (xs, target) =>
    xs.length ? xs.reduce((b, x) => (Math.abs(x - target) < Math.abs(b - target) ? x : b), xs[0]) : null;

  // symbol → date → ladder
  const bySym = new Map();
  for (const r of rows) {
    const sym = r.symbol;
    if (!bySym.has(sym)) bySym.set(sym, new Map());
    const byDate = bySym.get(sym);
    if (!byDate.has(r.d)) byDate.set(r.d, []);
    byDate.get(r.d).push({ strike: Number(r.strike), gex: Number(r.net_gex) || 0, spot: Number(r.spot) || 0 });
  }

  for (const { symbol, date, prevDate } of pairs) {
    const byDate = bySym.get(symbol);
    if (!byDate) continue;
    const cur = byDate.get(date) || [];
    const prev = prevDate ? byDate.get(prevDate) || [] : [];
    if (!cur.length) continue;
    const spot = cur.find((r) => r.spot > 0)?.spot || cur[Math.floor(cur.length / 2)].strike;

    const flipNow = nearest(crossings(cur, spot), spot);
    const flipPrev = prev.length ? nearest(crossings(prev, spot), spot) : null;

    // Strikes that crossed zero overnight — a change of KIND, which is why it
    // gets its own count instead of folding into the |Δ| ranking.
    const prevAt = new Map(prev.map((r) => [r.strike, r.gex]));
    let flips = 0;
    for (const r of cur) {
      const q = prevAt.get(r.strike);
      if (q != null && q !== 0 && r.gex !== 0 && Math.sign(q) !== Math.sign(r.gex)) flips += 1;
    }

    const above = cur.filter((r) => r.strike > spot);
    const below = cur.filter((r) => r.strike < spot);
    const callWall = above.length ? above.reduce((b, r) => (r.gex > b.gex ? r : b), above[0]) : null;
    const putWall = below.length ? below.reduce((b, r) => (r.gex < b.gex ? r : b), below[0]) : null;
    const wallChg = callWall && prevAt.has(callWall.strike) ? callWall.gex - prevAt.get(callWall.strike) : null;

    const flipMove = flipNow != null && flipPrev != null ? flipNow - flipPrev : null;
    // A flip can do four things overnight, and only ONE of them is a distance.
    // Scoring on `flipMove` alone silently rates the other two at zero: a book
    // whose crossing left the recorded window entirely — because the negative
    // leg deepened until the running total never gets back to zero — is one of
    // the largest structural changes there is, and it produces a null, not a
    // big number. `vanished` and `appeared` are therefore scored as events.
    const flipState =
      flipNow != null && flipPrev != null ? (flipNow === flipPrev ? 'stable' : 'moved')
        : flipNow == null && flipPrev != null ? 'vanished'
          : flipNow != null && flipPrev == null ? 'appeared'
            : 'none';

    // Structural movement expressed in PERCENT OF SPOT, so one score ranks a
    // $6 name against a $6,000 index. Flip migration and sign flips are the two
    // things the |Δ| sort is blind to, so they are the two things it counts.
    // The appear/vanish constant is deliberately large — those are step changes,
    // not small ones — but finite, so a genuinely enormous migration can still
    // outrank them.
    const structScore =
      (flipMove != null && spot > 0 ? Math.abs(flipMove / spot) * 100 : 0)
      + (flipState === 'vanished' || flipState === 'appeared' ? 3 : 0)
      + flips * 0.25;

    out.set(symbol, {
      flipNow, flipPrev, flipMove, flipState, flips,
      callWall: callWall && callWall.gex > 0 ? callWall.strike : null,
      putWall: putWall && putWall.gex < 0 ? putWall.strike : null,
      wallChg,
      structScore,
    });
  }
  return out;
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
async function getStrikeGexBoard(topN = 5, { date = null, basis = 'oivol', leg = 'net' } = {}) {
  if (!(await ensureSchema())) return { ok: false, error: 'no DB' };
  const p = getPool();
  const top = Math.max(1, Math.min(40, Number(topN) || 5));
  const asOf = normDate(date);
  const bas = normBasis(basis);
  const lg = normLeg(leg);
  // The rail ranks on the SAME column the ladder draws — otherwise clicking the
  // top name on a call-leg board would open a ladder ranked by something else.
  const LVL = levelCol(bas, lg);

  // ONE pass. `d` ranks each symbol's own dates; `cur`/`prv` pick its latest
  // two; `j` FULL JOINs them (full, not left — a strike that fell out of the
  // window entirely is the biggest negative change there is); `agg` and the two
  // `ranked` CTEs are computed off that same CTE so the totals and the top-N
  // lists can never disagree about what the numbers were.
  //
  // The top-N lists are json_agg'd rather than LEFT JOINed as rows: joining two
  // independent rank lists on the same query would cross-product them (top²
  // rows per symbol, 4k+ rows to render 169 names). One row per symbol instead.
  // BASIS-AWARE DATE RESOLUTION. `d` filters to sessions that actually have a
  // value on THIS basis, which is what keeps the rail honest across all four:
  //   • pre-migration dates have NULL oi_/vol_/flow_ and drop out, instead of
  //     ranking as an enormous fake Δ against a zero board;
  //   • on `flow`, only the FLOW_GEX_SYMBOLS have rows at all, so the rail
  //     shrinks to those names rather than listing 169 flat zeros.
  // Without this filter every new basis would look like it had a year of
  // history the moment it shipped.
  const sql = `
    WITH d AS (
      SELECT symbol, date,
             dense_rank() OVER (PARTITION BY symbol ORDER BY date DESC) AS rk
        FROM (SELECT DISTINCT symbol, date FROM eod_strike_gex
               WHERE ($2::text IS NULL OR date <= $2::date)
                 AND ${LVL} IS NOT NULL) s
    ),
    cur AS (SELECT symbol, date FROM d WHERE rk = 1),
    prv AS (SELECT symbol, date FROM d WHERE rk = 2),
    c AS (SELECT e.* FROM eod_strike_gex e JOIN cur ON cur.symbol = e.symbol AND cur.date = e.date),
    p AS (SELECT e.* FROM eod_strike_gex e JOIN prv ON prv.symbol = e.symbol AND prv.date = e.date),
    j AS (
      SELECT COALESCE(c.symbol, p.symbol)                          AS symbol,
             COALESCE(c.strike, p.strike)                          AS strike,
             COALESCE(c.${LVL}, 0) - COALESCE(p.${LVL}, 0)         AS chg,
             c.${LVL}                                              AS lvl,
             c.spot                                                AS spot,
             c.oi_stamped_date                                     AS cur_stamp,
             p.oi_stamped_date                                     AS prev_stamp,
             -- Per-symbol as-of for THIS basis, so the rail can show that a
             -- name's chain failed at 16:05 and it is reading an older moment
             -- than the rows above it.
             ${stampExpr(bas, 'c')}                                AS cur_at
        FROM c FULL JOIN p ON p.symbol = c.symbol AND p.strike = c.strike
    ),
    agg AS (
      SELECT symbol,
             SUM(chg)                                            AS net,
             SUM(ABS(chg))                                       AS abs_tot,
             SUM(COALESCE(lvl, 0))                               AS gex_net,
             SUM(ABS(COALESCE(lvl, 0)))                          AS gex_abs,
             MAX(spot)                                           AS spot,
             BOOL_OR(cur_stamp  IS NOT NULL)                     AS cur_settled,
             BOOL_OR(prev_stamp IS NOT NULL)                     AS prev_settled,
             MAX(cur_at)                                         AS cur_at
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
           a.cur_settled, a.prev_settled, a.cur_at,
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
      // Only consulted on the `oi` basis: is this name's Δ a true settled ΔOI,
      // or is one side still the provisional 16:05 read?
      oiSettled: !!r.cur_settled,
      prevOiSettled: !!r.prev_settled,
      capturedAt: r.cur_at ? new Date(r.cur_at).toISOString() : null,
    };
  });

  // Structural badges, merged in from ONE extra query over the same
  // (symbol, date, prevDate) triples the ranking above just resolved. Failure
  // here degrades the rail to its old behaviour — the badge column disappears
  // and every number on the page is still correct — so it must never take the
  // board down with it.
  try {
    const badges = await getStrikeGexBadges(
      symbols.map((x) => ({ symbol: x.symbol, date: x.date, prevDate: x.prevDate })),
      bas,
    );
    for (const x of symbols) x.badge = badges.get(x.symbol) ?? null;
  } catch (e) {
    console.warn('[eod-strike-gex] badges failed (rail falls back to plain):', e.message);
    for (const x of symbols) x.badge = null;
  }

  return { ok: true, top, date: asOf, basis: bas, leg: lg, symbols };
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

  // ── The 09:25 OI re-stamp, on the same minute poll ────────────────────────
  //
  // Separate claim (_lastRestampDate) and separate guard (_restamping) from the
  // evening sweep, because they are different jobs on different sessions: this
  // one corrects YESTERDAY's rows, the evening one writes TODAY's. Sharing a
  // day-claim would make whichever ran first cancel the other.
  //
  // Runs on trading days only. A settled file does land on a holiday morning
  // for the prior session, but the roster's chains are not being quoted, and a
  // 169-symbol sweep against a closed market is a lot of upstream traffic for a
  // number that will still be there on the next open.
  const checkRestamp = () => {
    try {
      if (!RESTAMP_ENABLED) return;
      if (_restamping || _running) return;
      if (!isTradingDayET()) return;
      const day = todayYmdET();
      if (_lastRestampDate === day) return;
      const { minutes } = nowET();
      if (minutes < RESTAMP_AT_MIN || minutes >= RESTAMP_CLOSE_MIN) return;
      _lastRestampDate = day; // claim before awaiting, same reason as below
      runOiRestamp()
        .then((r) => {
          // Release on a pass that touched nothing so the next tick retries —
          // but NOT when the reason is "no recorded session to re-stamp", which
          // is a permanent state for today (a fresh table, or a first run) and
          // would otherwise retry every minute until 11:00.
          if (!r?.ok && !/no recorded session/.test(r?.error || '')) {
            console.warn(`[eod-strike-gex] re-stamp did not land (${r?.error || 'unknown'}) — will retry`);
            _lastRestampDate = null;
          }
        })
        .catch((e) => {
          console.warn('[eod-strike-gex] re-stamp error:', e.message);
          _lastRestampDate = null;
        });
    } catch (e) {
      console.warn('[eod-strike-gex] re-stamp scheduler error:', e.message);
    }
  };

  const check = () => {
    checkRestamp();
    try {
      if (_running) return;
      if (_restamping) return; // never two full chain sweeps at once
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

  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  console.log(
    `[eod-strike-gex] recorder started — ${symbolsSync().length} symbols × ` +
    `${EXPIRY_DEPTH > 0 ? EXPIRY_DEPTH : 'all'} expiries (ex-0DTE), ±${WINDOW_SIDE} strikes, ` +
    `once daily at ${hhmm(RUN_AT_MIN)} ET, ${RETAIN_DAYS}d retention (roster re-resolved each sweep); ` +
    `bases oivol/oi/vol + flow for [${[...FLOW_GEX_SYMBOLS].join(',') || 'none'}]; ` +
    `OI re-stamp ${RESTAMP_ENABLED ? `at ${hhmm(RESTAMP_AT_MIN)} ET` : 'DISABLED'}`,
  );
}

module.exports = {
  startEodStrikeGexRecorder,
  runSweep,
  runOiRestamp,
  getStrikeGexChange,
  getStrikeGexLive,
  getStrikeGexBoard,
  getStrikeGexBadges,
  getFlowLadder,
  listStrikeGexDates,
  ensureSchema,
  getPool,
  gexRowsForSymbol,
  oiRowsForSymbol,
  windowRows,
  normBasis,
  normLeg,
  levelCol,
  BASES,
  LEGS,
  BASIS_COLS,
  FLOW_GROSS_COLS,
  FLOW_GEX_SYMBOLS,
};
