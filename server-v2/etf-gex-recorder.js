'use strict';
/**
 * server-v2/etf-gex-recorder.js
 *
 * Server-side recorder for PER-STRIKE net GEX history on every ticker that is
 * NOT on the live SPX feed — the sibling of the SPX pipeline that feeds the
 * ES-Candles heatmap, GEX bubbles and strike rail.
 *
 * The name is now a misnomer and is kept only because the env vars and the log
 * prefix are: as of 2026-08-16 the roster is the SCANNER MAIN lane, not just
 * two ETFs — SPY, QQQ, NDX, VIX and the mega-cap singles. See SYMBOLS below.
 *
 * SPX gets its per-strike rows from the LIVE dashboard feed: proxy-tastytrade
 * streams the chain, computation/gex-calculator.js reduces it, and
 * gex-history-writer.writeGexSnapshot() persists one row per strike per minute.
 * SPY/QQQ are not on that hot feed (nothing subscribes them tick-by-tick), so
 * this recorder polls their chains on its own interval and writes into the SAME
 * table through the SAME writer — with `symbol` set to the ticker.
 *
 * Everything downstream (the /api/snapshots/option-strike-gex-history reads, the
 * heatmap, the bubble trail, the rail) therefore needs no second code path: it
 * just passes ?symbol=SPY and gets the identical row shape back.
 *
 * Chain source: fetchExpirations / fetchChainFull from proxy-tastytrade — the
 * same REST calls state/ticker-wall-recorder.js already uses for its SPY/QQQ
 * 0DTE walls, so this adds no new upstream dependency.
 *
 * GEX convention (identical to ticker-wall-recorder and the client's chain math):
 *   netGEX(strike) = (callGamma·callOI − putGamma·putOI) · spot² · 0.01 · 100
 *   netVolGEX(strike) = (callGamma·callVol − putGamma·putVol) · spot² · 0.01 · 100
 *
 * RTH only (9:30–16:00 ET, weekdays): SPY/QQQ option chains outside those hours
 * are stale quotes, and writing them would put a flat, wrong column on the
 * heatmap for every overnight minute.
 *
 * Wiring: startEtfGexRecorder() from server-with-proxy.js.
 * Disable with ETF_GEX_RECORDER=0.
 */

const { fetchExpirations, fetchChainFull } = require('./proxy-tastytrade');
const { writeGexSnapshot } = require('./gex-history-writer');
const { SCANNER_HOT } = require('./scanner-tickers');
const { CORE_TICKERS } = require('./far-cb-tickers');

const INTERVAL_MS = Number(process.env.ETF_GEX_RECORDER_INTERVAL_MS || 60_000);

// ── Rosters: a HOT lane and a WIDE lane ──────────────────────────────────────
//
// SPX IS EXCLUDED FROM BOTH AND MUST STAY EXCLUDED. normGexSymbol() folds 'SPX'
// onto '$SPX' (_lib-db.cjs), which is exactly the key proxy-tastytrade writes
// every 30s off the streamed chain. Recording it here too would put two writers
// with different strike windows and different cadences on one key, and the
// heatmap's `DISTINCT ON (minute_bucket, strike) ORDER BY ..., timestamp DESC`
// would hand each minute to whichever landed last. The ES-Candles "ES" and
// "SPX" symbols both read $SPX and are already covered.
//
// ── HOT ─────────────────────────────────────────────────────────────────────
// The scanner's MAIN lane (scanner-tickers.js) — indices + mega-caps. Every
// tick, full ±STRIKE_SIDE ladder. Unchanged.
//
// Sourced from the FILE's MAIN list, deliberately NOT from roster-store. The
// Watchlists page can add fifty names to the scanner roster without anyone
// thinking about write volume; this recorder writes ~81 rows per symbol per
// minute into the table that caused the 2026-07 disk incident, so its roster is
// a reviewed, code-level decision. Override with ETF_GEX_SYMBOLS for a one-off.
const LIVE_FEED_SYMBOLS = new Set(['SPX', '$SPX']);
const SYMBOLS = (process.env.ETF_GEX_SYMBOLS
  ? String(process.env.ETF_GEX_SYMBOLS).split(',')
  : SCANNER_HOT)
  .map((s) => String(s).trim().toUpperCase())
  .filter(Boolean)
  .filter((s) => !LIVE_FEED_SYMBOLS.has(s));

// ── WIDE (2026-08-27) ───────────────────────────────────────────────────────
// The far-CB core roster (far-cb-tickers.js CORE_TICKERS) minus the hot lane —
// 93 names as of today. It exists because /es-candles now offers those tickers
// in its symbol picker, and a ticker that charts candles under a permanently
// empty heatmap reads as a broken page rather than as "no gamma recorded here".
//
// ── EVERY MINUTE, not on a round-robin ──────────────────────────────────────
// The first cut at this lane rationed it: 12 names a tick, so a wide symbol got
// a column every ~8 minutes. That is wrong for the reader it exists for. The
// GEX BUBBLE TRAIL buckets to ONE MINUTE (`BubbleBucket = 1 | 5 | 'bar'` in
// slotStore.ts; `minuteColsRef` is keyed by the minute), so 8-minute spacing
// does not give a coarse trail — it gives a trail with seven empty minutes
// between every bubble, on a chart whose finest setting is one.
//
// So the wide lane is swept IN FULL every tick, exactly like the hot lane. What
// makes that fit in 60 seconds is CONCURRENCY (see sweep() and the two
// *_CONCURRENCY knobs below), not a smaller roster: 106 serial chain fetches at
// ~500ms each is ~80s; the same 106 six at a time is ~10s.
//
// ── The write volume, because this table has form ───────────────────────────
// option_strike_gex_history is the 2.9GB table from the 2026-07 disk incident,
// and per-minute × 93 names is genuinely a lot of rows. What holds it:
//
//   • A NARROWER LADDER for this lane — ±WIDE_STRIKE_SIDE (25) rather than the
//     hot lane's 40, so 51 rows a write instead of 81. This is the lever that
//     scales the whole thing linearly, and it is why the default is not 40.
//   • The nightly prune (state/retention-cleanup.js): front expiry only, 5-min
//     thinning outside RTH and past RETENTION_GEX_FULLRES_DAYS, everything
//     dropped past RETENTION_GEX_HISTORY_DAYS.
//
// Steady state at those numbers is roughly 6.7M rows for this lane against the
// hot lane's 1.5M. If that is more disk than the box has, the levers in order of
// bluntness: RETENTION_GEX_HISTORY_DAYS (10 → 5 nearly halves it, and
// /es-candles only ever shows five sessions), ETF_GEX_WIDE_STRIKE_SIDE (25 → 15
// takes off another 40%), then trimming ETF_GEX_WIDE_SYMBOLS.
//
// CORE_TICKERS and not getActiveRoster(), for the same reason the hot lane
// reads the file: the active roster is the scanner universe plus every
// customer-added ticker, so one person adding a name on a watchlist page would
// silently add permanent per-minute write volume here. Override with
// ETF_GEX_WIDE_SYMBOLS; disable the lane with ETF_GEX_WIDE=0.
const WIDE_SYMBOLS = (process.env.ETF_GEX_WIDE_SYMBOLS
  ? String(process.env.ETF_GEX_WIDE_SYMBOLS).split(',')
  : (Array.isArray(CORE_TICKERS) ? CORE_TICKERS : []))
  .map((s) => String(s).trim().toUpperCase())
  .filter(Boolean)
  .filter((s, i, a) => a.indexOf(s) === i)
  .filter((s) => !LIVE_FEED_SYMBOLS.has(s))
  .filter((s) => !SYMBOLS.includes(s));

// How many chain fetches are in flight at once, per lane.
//
// This is the number that makes a per-minute full sweep possible, and the one
// that can hurt the upstream if it is set carelessly. Each worker still waits
// TICKER_DELAY_MS between ITS OWN symbols, so the request rate is roughly
// concurrency / (fetch + delay) — about 8/s at the defaults, against a REST API
// the scanners already poll on their own cadence.
//
// The hot lane gets a smaller number because it is 13 names: there is nothing to
// gain from six lanes for a list that finishes in seconds, and holding it back
// leaves the connection budget to the 93-name sweep behind it.
const HOT_CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.ETF_GEX_HOT_CONCURRENCY || 4)));
const WIDE_CONCURRENCY = Math.max(1, Math.min(24, Number(process.env.ETF_GEX_WIDE_CONCURRENCY || 6)));

// ── Strike window ────────────────────────────────────────────────────────────
// Strikes either side of spot, so one write is bounded at 2N+1 rows.
//
// It used to be UNCAPPED — every strike in the expiry with any book or tape. On
// two ETFs that was tolerable; on a fourteen-name roster it is the difference
// between a bounded table and the 2.9GB one. 40/side matches
// eod-strike-gex-recorder's WINDOW_SIDE, so the two per-strike tables cover the
// same ladder.
//
// COUNT, not a percentage of spot. A ±8% band is ~24 strikes on NVDA and ~3 on
// VIX, whose whole chain lives inside a few points — a percentage window is a
// different instrument on every underlying, which is not what a "same shape
// everywhere" recorder wants.
const STRIKE_SIDE = Math.max(5, Math.min(200, Number(process.env.ETF_GEX_STRIKE_SIDE || 40)));

// The WIDE lane's ladder. Narrower on purpose — see the roster note above for
// the arithmetic this is half of. 25/side still covers the walls and the flip on
// every name in that roster; what it drops is the dead tail beyond them, which
// the reader never plots and the retention prune would thin away anyway.
const WIDE_STRIKE_SIDE = Math.max(5, Math.min(200, Number(process.env.ETF_GEX_WIDE_STRIKE_SIDE || 25)));

// Pause between symbols so a fourteen-name sweep trickles instead of firing
// fourteen chain fetches at the same instant. Same idea as
// eod-strike-gex-recorder's TICKER_DELAY_MS, at a shorter interval because this
// one runs every minute rather than once a day.
const TICKER_DELAY_MS = Math.max(0, Number(process.env.ETF_GEX_TICKER_DELAY_MS || 250));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// How many expirations forward to record.
//
// DEFAULT 1 (0DTE only) ON PURPOSE. The ES-Candles heatmap requests front mode,
// which is served by getOptionStrikeGexSlotsWindowAny — a
// `DISTINCT ON (minute_bucket, strike) ... ORDER BY ..., timestamp DESC` that
// ignores expiry entirely. Recording a second expiry therefore does NOT add an
// optional extra column the UI can choose between: the 1DTE rows are written
// microseconds later than the 0DTE rows, so they win the DISTINCT ON for every
// strike the two ladders share and the "0DTE" heatmap silently becomes
// tomorrow's gamma profile with 0DTE fragments where the ladders differ.
//
// Raising this is only safe once the ETF read path asks for an explicit expiry
// instead of anyExpiry=1.
const EXPIRY_DEPTH = Math.max(1, Math.min(4, Number(process.env.ETF_GEX_EXPIRY_DEPTH || 1)));

// ── Time helpers ─────────────────────────────────────────────────────────────
function todayYmdET() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function isRthNowET() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => parts.find((x) => x.type === t)?.value ?? '';
  const wd = get('weekday');
  if (wd === 'Sat' || wd === 'Sun') return false;
  const mins = Number(get('hour')) * 60 + Number(get('minute'));
  return mins >= 570 && mins < 960; // 9:30–16:00 ET
}

// ── Chain → per-strike rows ──────────────────────────────────────────────────

// Expiration lists barely move intraday — a new listing appears once, and the
// front expiry rolls at a date boundary this cache is far shorter than. Without
// it the recorder spent one upstream call per symbol per visit purely to learn
// the same string again: 13 hot names a minute is ~780 calls an hour before the
// wide lane adds any. Keyed by (symbol, depth) with a 30-minute TTL, and an
// EMPTY result is deliberately not cached so a symbol that failed retries on the
// next visit rather than being written off for half an hour.
const EXPIRY_TTL_MS = Math.max(0, Number(process.env.ETF_GEX_EXPIRY_TTL_MS || 30 * 60_000));
const expiryCache = new Map(); // `${ticker}|${depth}` → { at, list }

/** The next `depth` expirations for a ticker, today-or-later, ascending. */
async function resolveExpiries(ticker, depth) {
  const key = `${ticker}|${depth}`;
  const hit = expiryCache.get(key);
  // The date check is what makes a 30-minute TTL safe across the roll: a cache
  // entry taken at 15:50 must not still be serving yesterday's front expiry at
  // 09:35 the next morning.
  const today = todayYmdET();
  if (hit && hit.day === today && Date.now() - hit.at < EXPIRY_TTL_MS && hit.list.length) return hit.list;

  const { items } = await fetchExpirations(ticker).catch(() => ({ items: [] }));
  const list = (items || [])
    .map((it) => String(it['expiration-date'] || '').slice(0, 10))
    .filter((d) => d && d >= today)
    .sort()
    .slice(0, depth);
  if (list.length) expiryCache.set(key, { at: Date.now(), day: today, list });
  return list;
}

const num = (o, k) => (o ? parseFloat(o[k]) || 0 : 0);
const int = (o, ...keys) => {
  if (!o) return 0;
  for (const k of keys) {
    const v = parseInt(o[k] ?? 0, 10);
    if (Number.isFinite(v) && v) return v;
  }
  return 0;
};

/**
 * One expiration's strike ladder reduced to the writer's row shape.
 * Returns { spot, rows: [{ strike, netGEX, netVolGEX, netDEX, volNetDEX,
 * callGamma, putGamma, callDelta, putDelta }] }.
 */
async function snapshotStrikes(ticker, expiry, strikeSide = STRIKE_SIDE) {
  const side = Math.max(5, Math.min(200, Number(strikeSide) || STRIKE_SIDE));
  const { items, underlyingPrice } = await fetchChainFull(ticker, expiry);
  const spot = Number(underlyingPrice) || 0;
  if (!(spot > 0) || !Array.isArray(items) || !items.length) return { spot, rows: [] };

  // spot² · 0.01 · 100 — 1% underlying move, 100 shares per contract. Same
  // multiplier the SPX path and ticker-wall-recorder use, so the values are
  // directly comparable across underlyings.
  const mult = spot * spot * 0.01 * 100;
  const rows = [];

  for (const group of items) {
    const groupExp = String(group['expiration-date'] || '').slice(0, 10);
    if (groupExp && groupExp !== expiry) continue;
    for (const it of group.strikes || []) {
      const strike = parseFloat(it['strike-price'] || 0);
      if (!(strike > 0)) continue;
      const c = it.call;
      const p = it.put;
      // ABS IS LOAD-BEARING. Gamma is positive for both calls and puts; the put
      // leg's short-gamma polarity comes from the MINUS sign in the netGEX
      // formula below, not from the greek. If the upstream ever delivers a
      // signed (negative) put gamma, `- pGamma * pOI` becomes ADDITIVE and that
      // strike silently flips POSITIVE — the recorded ETF history then
      // disagrees in SIGN with every other vendor there. computation/
      // gex-calculator.js and the client's strikeGex() both abs their gammas;
      // this path did not, which is the only sign asymmetry left in the repo.
      const cGamma = Math.abs(num(c, 'gamma'));
      const pGamma = Math.abs(num(p, 'gamma'));
      const cDelta = num(c, 'delta');
      const pDelta = num(p, 'delta');
      const cOI = int(c, 'open-interest', 'openInterest');
      const pOI = int(p, 'open-interest', 'openInterest');
      const cVol = int(c, 'volume', 'day-volume');
      const pVol = int(p, 'volume', 'day-volume');
      // A strike with no book AND no tape is noise — skip it rather than write
      // a zero row per minute per strike for the whole dead tail of the chain.
      if (!cOI && !pOI && !cVol && !pVol) continue;
      rows.push({
        strike,
        netGEX: (cGamma * cOI - pGamma * pOI) * mult,
        netVolGEX: (cGamma * cVol - pGamma * pVol) * mult,
        // DEX = delta × OI × spot × 100, the same convention gex-calculator.js
        // uses for the SPX path — including subtracting the put term rather
        // than adding it, so the two engines' numbers stay comparable.
        // Omitted until now, which is why option_strike_gex_history had
        // with_dex = 0 for every ETF while $SPX had it: the writer stores
        // net_dex, but this path never supplied it.
        netDEX: (cDelta * cOI - pDelta * pOI) * spot * 100,
        volNetDEX: (cDelta * cVol - pDelta * pVol) * spot * 100,
        callGamma: cGamma,
        putGamma: pGamma,
        callDelta: cDelta,
        putDelta: pDelta,
      });
    }
  }

  rows.sort((a, b) => a.strike - b.strike);

  // ── Trim to ±side around spot ──────────────────────────────────────────────
  // Centred on the strike nearest spot rather than on a price band, so the
  // window is the same COUNT on every underlying (see STRIKE_SIDE). Applied
  // after the book/tape filter, so it is N live strikes a side, not N slots
  // of a chain that may be half dead.
  //
  // `side` is a parameter, not the module const, because the WIDE lane records a
  // narrower ladder than the hot one. It still defaults to STRIKE_SIDE, so the
  // exported two-arg form every other caller uses is unchanged.
  if (rows.length > side * 2 + 1) {
    let atm = 0;
    for (let i = 1; i < rows.length; i++) {
      if (Math.abs(rows[i].strike - spot) < Math.abs(rows[atm].strike - spot)) atm = i;
    }
    const lo = Math.max(0, Math.min(atm - side, rows.length - (side * 2 + 1)));
    return { spot, rows: rows.slice(lo, lo + side * 2 + 1) };
  }
  return { spot, rows };
}

// ── Tick ─────────────────────────────────────────────────────────────────────

/** Record one symbol's front expiry(s) at the given ladder width. */
async function recordSymbol(symbol, strikeSide) {
  const expiries = await resolveExpiries(symbol, EXPIRY_DEPTH);
  if (!expiries.length) {
    console.warn(`[etf-gex] ${symbol}: no expirations returned — skipping`);
    return;
  }
  for (const expiry of expiries) {
    // eslint-disable-next-line no-await-in-loop
    const { spot, rows } = await snapshotStrikes(symbol, expiry, strikeSide);
    if (!rows.length || !(spot > 0)) continue;
    // writeGexSnapshot throttles per (symbol, expiry) at
    // GEX_PG_WRITE_INTERVAL_MS, so each expiry gets its own minute slot
    // rather than the first one of the tick swallowing the rest.
    // eslint-disable-next-line no-await-in-loop
    await writeGexSnapshot(rows, spot, expiry, symbol);
  }
}

/**
 * Walk a list with bounded concurrency, pausing between names WITHIN each
 * worker, never throwing.
 *
 * `concurrency` workers pull from one shared cursor, so a slow symbol delays
 * only its own lane and the others keep draining the list — which is the whole
 * point, and is why this is a worker pool rather than Promise.all over chunks
 * (a chunked barrier runs at the speed of its slowest member, every chunk).
 *
 * The per-worker TICKER_DELAY_MS is deliberately kept from the serial version.
 * It is what stops N workers becoming N-requests-per-instant: each lane paces
 * itself, so the aggregate rate is bounded by concurrency/(fetch + delay)
 * instead of by however fast the upstream can accept a burst. Worker k also
 * starts k delays in, so the very first requests of a tick fan out rather than
 * landing together.
 */
async function sweep(list, strikeSide, concurrency) {
  if (!list.length) return;
  let cursor = 0;
  const lanes = Math.max(1, Math.min(concurrency, list.length));
  const worker = async (lane) => {
    if (lane && TICKER_DELAY_MS) await sleep(lane * TICKER_DELAY_MS);
    for (;;) {
      const idx = cursor++;
      if (idx >= list.length) return;
      const symbol = list[idx];
      try {
        await recordSymbol(symbol, strikeSide); // eslint-disable-line no-await-in-loop
      } catch (e) {
        console.warn(`[etf-gex] ${symbol} snapshot failed:`, e.message);
      }
      if (TICKER_DELAY_MS) await sleep(TICKER_DELAY_MS); // eslint-disable-line no-await-in-loop
    }
  };
  await Promise.all(Array.from({ length: lanes }, (_, k) => worker(k)));
}

// Overrun guard. A tick is a long run of chain fetches and setInterval does not
// care whether the last one finished — without this, a slow upstream turns into
// overlapping ticks that pile more requests onto a feed that is already
// struggling, which is how a blip becomes an outage.
//
// Skipping costs one minute of columns for every symbol, and the alternative
// costs more. It is also the signal to act on: if this fires regularly, the
// concurrency is too low (or the upstream too slow) for a per-minute full
// sweep, and the tick-duration warning below names the knobs.
let ticking = false;

async function tick() {
  if (!isRthNowET()) return;
  if (ticking) {
    console.warn('[etf-gex] previous tick still running — skipping this one');
    return;
  }
  ticking = true;
  const t0 = Date.now();
  try {
    // HOT first and in full, then WIDE in full. Sequential lanes rather than one
    // merged pool: the hot names are what the live pages are watching, and they
    // should not be queued behind ninety-three others for their first column of
    // the minute.
    await sweep(SYMBOLS, STRIKE_SIDE, HOT_CONCURRENCY);

    if (process.env.ETF_GEX_WIDE !== '0' && WIDE_SYMBOLS.length) {
      await sweep(WIDE_SYMBOLS, WIDE_STRIKE_SIDE, WIDE_CONCURRENCY);
    }
  } finally {
    ticking = false;
    const ms = Date.now() - t0;
    if (ms > INTERVAL_MS) {
      console.warn(
        `[etf-gex] tick took ${Math.round(ms / 1000)}s (> ${INTERVAL_MS / 1000}s interval) — ` +
        'raise ETF_GEX_WIDE_CONCURRENCY, or trim ETF_GEX_WIDE_SYMBOLS',
      );
    }
  }
}

let _timer = null;

function startEtfGexRecorder() {
  if (_timer) return;
  if (process.env.ETF_GEX_RECORDER === '0') {
    console.log('[etf-gex] recorder disabled (ETF_GEX_RECORDER=0)');
    return;
  }
  if (!SYMBOLS.length && !WIDE_SYMBOLS.length) return;
  _timer = setInterval(() => {
    tick().catch((e) => console.warn('[etf-gex] tick error:', e.message));
  }, INTERVAL_MS);
  if (_timer.unref) _timer.unref();
  // Stagger the first run behind the other recorders so boot doesn't fire a
  // burst of chain fetches at the same instant.
  setTimeout(() => {
    tick().catch((e) => console.warn('[etf-gex] initial tick error:', e.message));
  }, 25_000);
  const wideOn = process.env.ETF_GEX_WIDE !== '0' && WIDE_SYMBOLS.length;
  console.log(
    `[etf-gex] recorder started — hot ${SYMBOLS.length} per-strike GEX (RTH), ` +
    `±${STRIKE_SIDE} strikes, ${EXPIRY_DEPTH} expiry(s), every ${INTERVAL_MS / 1000}s, ` +
    `${HOT_CONCURRENCY} concurrent, ${TICKER_DELAY_MS}ms apart: ${SYMBOLS.join(',')}`,
  );
  if (wideOn) {
    console.log(
      `[etf-gex] wide lane — ${WIDE_SYMBOLS.length} far-CB symbols, FULL sweep every tick, ` +
      `±${WIDE_STRIKE_SIDE} strikes, ${WIDE_CONCURRENCY} concurrent`,
    );
  } else {
    console.log('[etf-gex] wide lane off');
  }
}

module.exports = {
  startEtfGexRecorder, snapshotStrikes, resolveExpiries, tick,
  // Exported so an owner/health page can report what is actually being recorded
  // instead of re-deriving both rosters from the env vars.
  SYMBOLS, WIDE_SYMBOLS,
};
