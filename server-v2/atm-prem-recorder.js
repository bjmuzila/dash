'use strict';
/**
 * server-v2/atm-prem-recorder.js
 *
 * ONE row per trading day per (symbol, month slot, band) of NEAR-THE-MONEY
 * OPTION PREMIUM TRADED — call notional and put notional, kept separate — for
 * the front and back MONTHLY expiration.
 *
 *   premium(side) = Σ over band strikes of  close_price × day_volume × 100
 *
 * That is dollars that changed hands in those contracts today, not open
 * interest and not gamma. The panel it feeds (/test?tab=premdiff, the "Prem
 * Diff" tab) plots put_prem − call_prem as a histogram under the underlying's
 * daily bars: below zero = call premium dominated the tape, above zero = put
 * premium did.
 *
 * WHY A NEW TABLE AND NOT A VIEW OVER SOMETHING EXISTING:
 *   Nothing in this database stores option VOLUME or PRICE. oi_daily stores
 *   settled open interest, option_strike_gex_history stores gammas and the
 *   OI/vol GEX products, eod_dte_gamma stores bucketed OI + net gamma. Premium
 *   traded cannot be reconstructed from any of them — the price leg simply is
 *   not there. Hence a recorder rather than a query.
 *
 * WHY MONTHLY EXPIRIES AND NOT "the next expiration":
 *   SPY/QQQ/SPX list M-W-F weeklies. "Front month" in the sense the panel means
 *   — where hedges, collars and overwrites actually sit — is the standard third
 *   Friday. Picking the literal nearest expiry would make the series flip
 *   between a 1DTE weekly and a 30DTE monthly day to day and the histogram
 *   would measure the calendar, not positioning. thirdFriday() below.
 *
 * WHY THREE BANDS:
 *   "ATM" is a judgement call, and it is the single knob that most changes what
 *   the histogram looks like. Rather than bake one in, each sweep writes the
 *   same day at ±1%, ±2% and ±5% of spot, and the UI switches between them with
 *   no refetch of upstream. Three rows per (symbol, slot) per day is nothing.
 *
 * WHAT IT WRITES:
 *   atm_prem_diff(date, symbol, slot, band_pct, expiry, spot, u_open, u_high,
 *                 u_low, u_close, call_prem, put_prem, call_vol, put_vol,
 *                 strikes, src, ts)
 *   PK (date, symbol, slot, band_pct) — upsert, so a manual re-run overwrites
 *   the day cleanly instead of duplicating it. `src` is 'live' for rows this
 *   recorder wrote off the live chain and 'dxlink' for rows atm-prem-backfill.js
 *   reconstructed from daily candles; they are NOT identical measurements (see
 *   the header of that file) and the UI labels backfilled bars.
 *
 * WHEN IT FIRES:
 *   16:05 ET, weekdays. Day volume on the TastyTrade chain is final by then and
 *   the 16:00 print is in. Earlier and the last five minutes of tape are
 *   missing; much later and the quotes start rolling to the next session.
 *
 * SOURCE: fetchExpirations / fetchChainFull from proxy-tastytrade — the same
 * REST pair oi-daily-recorder.js and etf-gex-recorder.js use. No new upstream
 * dependency, no change to any proxy file.
 *
 * Wiring: startAtmPremRecorder() from server-with-proxy.js.
 * Disable with ATM_PREM_RECORDER=0. Manual fire: runSweep({ date }).
 */

const { fetchExpirations, fetchChainFull } = require('./proxy-tastytrade');

// ── Tunables (env-overridable) ───────────────────────────────────────────────

// SPX is NOT here. Its front monthly (root SPX, AM-settled) carries ~1.4% of
// near-money SPX volume — the rest is SPXW dailies — so a front/back MONTHLY
// panel charts a contract almost nobody trades. See the note in PremDiffTab.
const SYMBOLS = String(process.env.ATM_PREM_SYMBOLS || 'SPY,QQQ,NVDA')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

/** Minute-of-day ET to fire. 965 = 16:05. */
const RUN_AT_MIN = Number(process.env.ATM_PREM_RUN_AT_MIN || 965);
/** Stop retrying after this minute (20:00 ET) — past it the chain is tomorrow's. */
const RUN_UNTIL_MIN = Number(process.env.ATM_PREM_RUN_UNTIL_MIN || 1200);

/** Bands written every sweep, as ± percent of spot. */
const BANDS = [1, 2, 5];

/** Pacing between chain fetches so the sweep trickles instead of bursting. */
const FETCH_DELAY_MS = Number(process.env.ATM_PREM_FETCH_DELAY_MS || 400);

const CONTRACT_MULTIPLIER = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Time helpers ─────────────────────────────────────────────────────────────

function todayYmdET() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function nowET() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => parts.find((x) => x.type === t)?.value ?? '';
  return {
    weekday: get('weekday'),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function isTradingDayET() {
  const { weekday } = nowET();
  return weekday !== 'Sat' && weekday !== 'Sun';
}

/**
 * The standard monthly expiration for a given year/month: the THIRD FRIDAY,
 * as 'YYYY-MM-DD'.
 *
 * Deliberately computed rather than read off the chain's `expiration-type`.
 * TastyTrade tags SPY's third Friday as "Weekly" (every SPY expiry in the
 * current listing comes back "Weekly"), so filtering on that field returns
 * either everything or nothing depending on the root. The third Friday is a
 * calendar fact; compute it.
 *
 * Holiday note: when the third Friday is a market holiday the listed expiry
 * moves to Thursday. resolveMonthlies() handles that by snapping to the closest
 * LISTED expiry within 2 days rather than demanding an exact match.
 */
function thirdFriday(year, month /* 1-12 */) {
  // Day-of-week of the 1st, in UTC (no DST hazard for a pure date calc).
  const first = new Date(Date.UTC(year, month - 1, 1));
  const dow = first.getUTCDay();           // 0=Sun … 5=Fri
  const firstFriday = 1 + ((5 - dow + 7) % 7);
  const d = firstFriday + 14;
  const mm = String(month).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Roots whose standard monthly is AM-SETTLED, where the last trading day is the
 * session BEFORE the expiration date.
 *
 * This is not trivia — it decides whether expiration day belongs to the expiring
 * month or the next one. SPY/QQQ/NVDA monthlies are PM-settled and trade all the
 * way through the expiration Friday's close, so that Friday's tape belongs to
 * the expiring contract. SPX's does not trade at all that day; the settlement
 * print is struck from the open. Treating it as still-front leaves the series
 * with an empty front leg on every monthly expiration.
 *
 * Measured: the first four-symbol backfill produced a front leg on 250 of 250
 * sessions for SPY, QQQ and NVDA, but 238 of 250 for SPX — and the 12 missing
 * days were exactly the 12 monthly expirations in the window.
 */
const AM_SETTLED_ROOTS = new Set(['SPX', 'XSP', 'NDX', 'RUT', 'VIX', 'DJX']);

/**
 * The n-th monthly expiry target on/after `ymd` (n=0 → front, n=1 → back).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.amSettled] roll one day early — see AM_SETTLED_ROOTS.
 */
function monthlyTarget(ymd, n, { amSettled = false } = {}) {
  let [y, m] = ymd.split('-').map(Number);
  // Has this month's monthly stopped being tradeable? For a PM-settled root
  // that is "the third Friday is behind us"; for an AM-settled one the
  // expiration day itself already has no tape, so it rolls a session earlier.
  const spent = (tf) => (amSettled ? tf <= ymd : tf < ymd);
  if (spent(thirdFriday(y, m))) { m += 1; if (m > 12) { m = 1; y += 1; } }
  for (let i = 0; i < n; i++) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return thirdFriday(y, m);
}

const daysBetween = (a, b) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;

/**
 * Front and back monthly expiries for `ymd`, snapped to what the root actually
 * lists. Returns { front, back } of 'YYYY-MM-DD' (either may be null).
 */
async function resolveMonthlies(ticker, ymd, listed = null) {
  let dates = listed;
  if (!dates) {
    const { items } = await fetchExpirations(ticker).catch(() => ({ items: [] }));
    dates = (items || [])
      .map((it) => String(it['expiration-date'] || '').slice(0, 10))
      .filter(Boolean);
  }
  const forward = [...new Set(dates)].filter((d) => d >= ymd).sort();
  const snap = (target) => {
    if (!target) return null;
    if (forward.includes(target)) return target;
    // Holiday shift: accept the closest listed expiry within 2 calendar days.
    const near = forward
      .filter((d) => daysBetween(d, target) <= 2)
      .sort((a, b) => daysBetween(a, target) - daysBetween(b, target));
    return near[0] ?? null;
  };
  const am = AM_SETTLED_ROOTS.has(String(ticker || '').toUpperCase().replace(/^\$/, ''));
  return {
    front: snap(monthlyTarget(ymd, 0, { amSettled: am })),
    back: snap(monthlyTarget(ymd, 1, { amSettled: am })),
  };
}

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
      console.warn('[atm-prem] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[atm-prem] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  if (_schemaReady) return true;
  const p = getPool();
  if (!p) return false;
  await p.query(`
    CREATE TABLE IF NOT EXISTS atm_prem_diff (
      date      DATE             NOT NULL,
      symbol    TEXT             NOT NULL,
      slot      TEXT             NOT NULL,
      band_pct  REAL             NOT NULL,
      expiry    TEXT             NOT NULL,
      spot      DOUBLE PRECISION,
      u_open    DOUBLE PRECISION,
      u_high    DOUBLE PRECISION,
      u_low     DOUBLE PRECISION,
      u_close   DOUBLE PRECISION,
      call_prem DOUBLE PRECISION NOT NULL DEFAULT 0,
      put_prem  DOUBLE PRECISION NOT NULL DEFAULT 0,
      call_vol  BIGINT           NOT NULL DEFAULT 0,
      put_vol   BIGINT           NOT NULL DEFAULT 0,
      strikes   INTEGER          NOT NULL DEFAULT 0,
      src       TEXT             NOT NULL DEFAULT 'live',
      ts        TIMESTAMPTZ      NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol, slot, band_pct)
    );
  `);
  // The only read shape is "this symbol, this band, last N sessions, both
  // slots" — one ordered index scan.
  await p.query(`CREATE INDEX IF NOT EXISTS idx_atm_prem_lookup
                 ON atm_prem_diff (symbol, band_pct, date DESC);`);
  _schemaReady = true;
  return true;
}

// ── Chain → premium ──────────────────────────────────────────────────────────

const num = (o, ...keys) => {
  if (!o) return 0;
  for (const k of keys) {
    const v = parseFloat(o[k]);
    if (Number.isFinite(v)) return v;
  }
  return 0;
};

const int = (o, ...keys) => {
  if (!o) return 0;
  for (const k of keys) {
    const v = parseInt(o[k] ?? 0, 10);
    if (Number.isFinite(v) && v) return v;
  }
  return 0;
};

/**
 * Per-contract price used for the notional.
 *
 * `mark` first (TastyTrade supplies it and it is the midpoint), then an
 * explicit bid/ask mid, then last. NOT `last` first: a strike whose only print
 * of the day was a stale 09:31 fill would otherwise price the whole day's
 * volume off it. A zero price yields a zero contribution rather than being
 * dropped, so `strikes` still counts the strike as covered.
 */
function contractPrice(leg) {
  const mark = num(leg, 'mark');
  if (mark > 0) return mark;
  const bid = num(leg, 'bid');
  const ask = num(leg, 'ask');
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  if (ask > 0) return ask / 2;
  const last = num(leg, 'last', 'close-price', 'prev-close');
  return last > 0 ? last : 0;
}

/**
 * Reduce one expiration's ladder to per-band premium totals.
 *
 * Returns { spot, bands: { [pct]: { callPrem, putPrem, callVol, putVol, strikes } } }.
 */
function reduceChain(items, underlyingPrice, expiry, bands = BANDS) {
  const spot = Number(underlyingPrice) || 0;
  const out = {};
  for (const b of bands) out[b] = { callPrem: 0, putPrem: 0, callVol: 0, putVol: 0, strikes: 0 };
  if (!(spot > 0) || !Array.isArray(items) || !items.length) return { spot, bands: out };

  const widest = Math.max(...bands);

  for (const group of items) {
    const groupExp = String(group['expiration-date'] || '').slice(0, 10);
    if (groupExp && expiry && groupExp !== expiry) continue;
    for (const it of group.strikes || []) {
      const strike = parseFloat(it['strike-price'] || 0);
      if (!(strike > 0)) continue;
      const distPct = Math.abs(strike - spot) / spot * 100;
      if (distPct > widest) continue;

      const cVol = int(it.call, 'volume', 'day-volume');
      const pVol = int(it.put, 'volume', 'day-volume');
      const cPrem = contractPrice(it.call) * cVol * CONTRACT_MULTIPLIER;
      const pPrem = contractPrice(it.put) * pVol * CONTRACT_MULTIPLIER;

      for (const b of bands) {
        if (distPct > b) continue;
        const acc = out[b];
        acc.callPrem += cPrem;
        acc.putPrem += pPrem;
        acc.callVol += cVol;
        acc.putVol += pVol;
        acc.strikes += 1;
      }
    }
  }
  return { spot, bands: out };
}

/**
 * Underlying daily OHLC for the session, best-effort.
 *
 * Used only to draw the price bars in the panel. A failure here must not lose
 * the premium row — every caller treats null as "close only", falling back to
 * the chain's underlyingPrice.
 */
async function fetchDailyBar(symbol) {
  try {
    const { fetchIntradayCandles } = require('./candle-history');
    const rows = await fetchIntradayCandles(symbol, '1d', Date.now() - 6 * 86400_000, { cache: false });
    if (!Array.isArray(rows) || !rows.length) return null;
    const last = rows[rows.length - 1];
    return {
      open: Number(last.open) || null,
      high: Number(last.high) || null,
      low: Number(last.low) || null,
      close: Number(last.close) || null,
    };
  } catch (e) {
    console.warn(`[atm-prem] ${symbol}: daily bar unavailable (${e.message})`);
    return null;
  }
}

// ── Write ────────────────────────────────────────────────────────────────────

async function upsertRows(rows) {
  const p = getPool();
  if (!p || !rows.length) return 0;
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO atm_prem_diff
           (date, symbol, slot, band_pct, expiry, spot, u_open, u_high, u_low, u_close,
            call_prem, put_prem, call_vol, put_vol, strikes, src, ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
         ON CONFLICT (date, symbol, slot, band_pct) DO UPDATE SET
           expiry = EXCLUDED.expiry, spot = EXCLUDED.spot,
           u_open = EXCLUDED.u_open, u_high = EXCLUDED.u_high,
           u_low = EXCLUDED.u_low, u_close = EXCLUDED.u_close,
           call_prem = EXCLUDED.call_prem, put_prem = EXCLUDED.put_prem,
           call_vol = EXCLUDED.call_vol, put_vol = EXCLUDED.put_vol,
           strikes = EXCLUDED.strikes, src = EXCLUDED.src, ts = now()`,
        [r.date, r.symbol, r.slot, r.bandPct, r.expiry, r.spot,
         r.uOpen ?? null, r.uHigh ?? null, r.uLow ?? null, r.uClose ?? null,
         r.callPrem, r.putPrem, r.callVol, r.putVol, r.strikes, r.src || 'live'],
      );
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

// ── Sweep ────────────────────────────────────────────────────────────────────

let _running = false;
let _lastRunDate = null;

/**
 * One day's capture across every configured symbol.
 * @param {object} opts
 * @param {string} [opts.date] session date (defaults to today ET)
 * @param {string[]} [opts.symbols] override the symbol list
 */
async function runSweep({ date, symbols } = {}) {
  if (_running) return { ok: false, error: 'already running' };
  _running = true;
  const day = date || todayYmdET();
  const syms = symbols?.length ? symbols : SYMBOLS;
  const written = [];
  const errors = {};

  try {
    if (!(await ensureSchema())) return { ok: false, error: 'no database' };

    for (const symbol of syms) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { front, back } = await resolveMonthlies(symbol, day);
        if (!front) { errors[symbol] = 'no monthly expiry listed'; continue; }

        // eslint-disable-next-line no-await-in-loop
        const bar = await fetchDailyBar(symbol);

        for (const [slot, expiry] of [['front', front], ['back', back]]) {
          if (!expiry) continue;
          // eslint-disable-next-line no-await-in-loop
          await sleep(FETCH_DELAY_MS);
          // eslint-disable-next-line no-await-in-loop
          const chain = await fetchChainFull(symbol, expiry).catch(() => null);
          if (!chain) { errors[`${symbol}:${slot}`] = 'chain fetch failed'; continue; }
          const { spot, bands } = reduceChain(chain.items, chain.underlyingPrice, expiry);
          if (!(spot > 0)) { errors[`${symbol}:${slot}`] = 'no spot'; continue; }

          for (const b of BANDS) {
            const acc = bands[b];
            written.push({
              date: day, symbol, slot, bandPct: b, expiry, spot,
              uOpen: bar?.open ?? null, uHigh: bar?.high ?? null,
              uLow: bar?.low ?? null, uClose: bar?.close ?? spot,
              callPrem: acc.callPrem, putPrem: acc.putPrem,
              callVol: acc.callVol, putVol: acc.putVol,
              strikes: acc.strikes, src: 'live',
            });
          }
        }
      } catch (e) {
        errors[symbol] = e.message;
      }
    }

    const n = await upsertRows(written);
    const ok = n > 0;
    console.log(`[atm-prem] sweep ${day}: ${n} rows across ${syms.length} symbols` +
      (Object.keys(errors).length ? ` · errors: ${JSON.stringify(errors)}` : ''));
    return { ok, date: day, rows: n, errors };
  } finally {
    _running = false;
  }
}

// ── Read (used by /api/atm-prem-diff) ────────────────────────────────────────

/**
 * The series behind the panel: one entry per session, front and back premium
 * side by side.
 *
 * @param {object} opts
 * @param {string} opts.symbol
 * @param {number} [opts.bandPct] 1 | 2 | 5
 * @param {number} [opts.days] sessions back from the latest recorded date
 */
async function getSeries({ symbol, bandPct = 5, days = 260 } = {}) {
  const p = getPool();
  if (!p) return { rows: [], symbol, bandPct, error: 'no database' };
  await ensureSchema();
  const sym = String(symbol || 'SPY').trim().toUpperCase();
  const band = BANDS.includes(Number(bandPct)) ? Number(bandPct) : 5;
  const limit = Math.max(20, Math.min(1000, Number(days) || 260));

  const { rows } = await p.query(
    `SELECT date, slot, expiry, spot, u_open, u_high, u_low, u_close,
            call_prem, put_prem, call_vol, put_vol, strikes, src
       FROM atm_prem_diff
      WHERE symbol = $1 AND band_pct = $2
        AND date >= (SELECT COALESCE(MAX(date), CURRENT_DATE) - ($3::int)
                       FROM atm_prem_diff WHERE symbol = $1 AND band_pct = $2)
      ORDER BY date ASC, slot ASC`,
    [sym, band, Math.round(limit * 1.5)],
  );

  // Collapse the two slot rows per date into one bar the chart can render.
  const byDate = new Map();
  const ymd = (d) => (d instanceof Date
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(d)
    : String(d).slice(0, 10));

  for (const r of rows) {
    const key = ymd(r.date);
    if (!byDate.has(key)) {
      byDate.set(key, {
        date: key,
        open: r.u_open != null ? Number(r.u_open) : null,
        high: r.u_high != null ? Number(r.u_high) : null,
        low: r.u_low != null ? Number(r.u_low) : null,
        close: r.u_close != null ? Number(r.u_close) : Number(r.spot),
        spot: Number(r.spot),
        src: r.src,
        front: null, back: null,
      });
    }
    const bar = byDate.get(key);
    const leg = {
      expiry: r.expiry,
      callPrem: Number(r.call_prem) || 0,
      putPrem: Number(r.put_prem) || 0,
      callVol: Number(r.call_vol) || 0,
      putVol: Number(r.put_vol) || 0,
      strikes: Number(r.strikes) || 0,
      // Sign convention, and it is the whole point of the panel:
      // POSITIVE = put premium dominated, NEGATIVE = call premium dominated.
      diff: (Number(r.put_prem) || 0) - (Number(r.call_prem) || 0),
    };
    if (r.slot === 'front') bar.front = leg; else bar.back = leg;
    if (bar.open == null && r.u_open != null) bar.open = Number(r.u_open);
  }

  const series = [...byDate.values()].slice(-limit);
  return { symbol: sym, bandPct: band, bands: BANDS, rows: series };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

function startAtmPremRecorder() {
  if (_timer) return;
  if (process.env.ATM_PREM_RECORDER === '0') {
    console.log('[atm-prem] recorder disabled (ATM_PREM_RECORDER=0)');
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
      if (minutes < RUN_AT_MIN || minutes >= RUN_UNTIL_MIN) return;
      _lastRunDate = day; // claim the day BEFORE awaiting
      runSweep({ date: day })
        .then((r) => {
          if (!r?.ok) {
            console.warn(`[atm-prem] sweep did not land (${r?.error || 'unknown'}) — will retry`);
            _lastRunDate = null;
          }
        })
        .catch((e) => {
          console.warn('[atm-prem] sweep error:', e.message);
          _lastRunDate = null;
        });
    } catch (e) {
      console.warn('[atm-prem] scheduler error:', e.message);
    }
  };

  _timer = setInterval(check, 60_000);
  if (_timer.unref) _timer.unref();
  setTimeout(check, 45_000);

  // The intraday (1-minute) recorder is started from here rather than getting
  // its own hook in server-with-proxy.js. One boot call owns "ATM premium
  // capture" — daily and intraday are the same measurement at two resolutions,
  // and splitting the wiring means a future change touches the proxy server
  // file again for no reason. Loaded defensively for the same reason its
  // neighbours are: a failure here must cost one panel, not boot.
  try {
    require('./atm-prem-intraday-recorder').startAtmPremIntradayRecorder();
  } catch (e) {
    console.warn('[atm-prem-intraday] recorder not started:', e.message);
  }

  const hh = String(Math.floor(RUN_AT_MIN / 60)).padStart(2, '0');
  const mm = String(RUN_AT_MIN % 60).padStart(2, '0');
  console.log(
    `[atm-prem] recorder started — ${SYMBOLS.join('/')}, front+back monthly, ` +
    `bands ±${BANDS.join('/')}%, once daily at ${hh}:${mm} ET`,
  );
}

module.exports = {
  startAtmPremRecorder,
  runSweep,
  getSeries,
  ensureSchema,
  getPool,
  upsertRows,
  reduceChain,
  resolveMonthlies,
  thirdFriday,
  monthlyTarget,
  AM_SETTLED_ROOTS,
  BANDS,
  CONTRACT_MULTIPLIER,
};
