'use strict';
/**
 * server-v2/condor-marks.js
 *
 * Prices the weekly EM iron condors day-by-day so the Owner → Est. Moves BE →
 * Iron Condors tab can show how a position moved Monday → Friday instead of
 * only the Friday verdict.
 *
 * Per session it builds:
 *
 *     mark      = (put_short − put_long) + (call_short − call_long)      [debit to close]
 *     open_pnl  = (net_credit − mark) × multiplier × contracts
 *     pct_max   = open_pnl / max_profit
 *     cushion   = distance from the underlying close to the nearer SHORT strike
 *
 * DATA SOURCE — TastyTrade only. This module used to require proxy-thetadata
 * directly for per-contract EOD option history. That endpoint needs a paid Theta
 * tier and 403s on this account, so every leg came back null and "Refresh Marks"
 * reported 0 priced for every condor. TastyTrade has no per-contract daily
 * history equivalent, so the daily series is now ROLLED UP from the hourly TT
 * ticks the recorder already writes into em_condor_ticks:
 *
 *     day's leg prices = the last tick of that ET session that priced all four
 *                        legs (the 16:00 ET snapshot on a normal day)
 *
 * open_pnl/pct_max are RECOMPUTED here from the condor's current net_credit
 * rather than copied off the tick, so editing a credit after the fact reflows
 * the whole week instead of leaving a stale curve.
 *
 * Consequence worth knowing: a week the hourly recorder was not running for has
 * no ticks, so it gets underlying/cushion rows only and the per-leg mark stays
 * null. There is no way to backfill option prices after the fact without a paid
 * history feed — that is stated in the returned `errors`, never swallowed.
 *
 * Underlying daily OHLC comes from tt-snapshot's Yahoo daily feed (free, and
 * what the rest of the TT path already uses). Futures (ESM/NQM) have no options
 * chain here at all; those still get underlying rows built from the
 * es_candles / nq_candles 5m tables the app already streams, so cushion/breach
 * tracking works even though the condor mark can't be priced.
 */

// tt-snapshot pulls in proxy-tastytrade, which the proxy server has already
// loaded in this process. Required lazily anyway: this module is eval-required
// from a Next route handler, and a top-level require here would drag the whole
// TT client into that first request's load path for the sake of one daily-bar
// call that futures rows never make.
let _feed = null;
function feed() {
  if (!_feed) _feed = require('./tt-snapshot');
  return _feed;
}

// ── date helpers ────────────────────────────────────────────────────────────

/** ET calendar date (YYYY-MM-DD) for an epoch-ms instant. */
function etDateStr(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

/**
 * Normalize anything date-shaped to "YYYY-MM-DD", or "" if it isn't a date.
 *
 * node-postgres parses a DATE column into a JS Date, so `week_start` read back
 * off em_condors is an object — not the ISO string this module assumed. The old
 * `String(v).slice(0, 10)` turned that into "Mon Jul 27", which parsed to an
 * Invalid Date and surfaced two frames later as "RangeError: Invalid time
 * value". It went unnoticed because em_condors was empty every time these paths
 * ran; the first seeded week made it reachable.
 */
function ymdOf(v) {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  }
  const s = String(v == null ? '' : v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function addDays(ymd, n) {
  const base = ymdOf(ymd);
  // Name the bad input. A bare RangeError from toISOString says nothing about
  // which value was malformed or where it came from.
  if (!base) throw new Error(`addDays: not a date — ${JSON.stringify(ymd)}`);
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday (week_start) → that week's Friday expiration. */
function fridayOf(weekStart) {
  return addDays(weekStart, 4);
}

function toDate(ymd) {
  const base = ymdOf(ymd);
  if (!base) throw new Error(`toDate: not a date — ${JSON.stringify(ymd)}`);
  return new Date(`${base}T12:00:00Z`);
}

// ── symbol routing ──────────────────────────────────────────────────────────

const FUTURES = new Set(['ESM', 'ESU', 'ESZ', 'ESH', 'NQM', 'NQU', 'NQZ', 'NQH']);
const INDICES = new Set(['SPX', 'NDX', 'XSP', 'RUT', 'VIX']);

function isFutures(t) { return FUTURES.has(String(t || '').toUpperCase()); }

/**
 * Daily underlying OHLC for the window, from the Yahoo daily feed tt-snapshot
 * exposes. The *Theta suffix on these two names is historical — under
 * DATA_SOURCE=tt they resolve to Yahoo 1d bars, not ThetaData.
 */
async function underlyingDaily(ticker, startYmd, endYmd) {
  const t = String(ticker).toUpperCase();
  const start = toDate(startYmd);
  const end = toDate(endYmd);
  const f = feed();
  const bars = INDICES.has(t)
    ? await f.fetchIndexDailyHistoryTheta(t, start, end)
    : await f.fetchStockDailyHistoryTheta(t, start, end);
  return Array.isArray(bars) ? bars : [];
}

// ── database ────────────────────────────────────────────────────────────────

let _pool = null;
function pool() {
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) return null;
  const { Pool } = require('pg');
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
    max: 2,
    keepAlive: true,
  });
  _pool.on('error', (e) => {
    console.warn('[condor-marks] pool error (will reconnect):', e.message);
    try { _pool?.end().catch(() => {}); } catch { /* noop */ }
    _pool = null;
  });
  return _pool;
}

/** Collapse the streamed 5m futures bars into ET session days. */
async function futuresDaily(ticker, startYmd, endYmd) {
  const p = pool();
  if (!p) return [];
  const tbl = String(ticker).toUpperCase().startsWith('NQ') ? 'nq_candles' : 'es_candles';
  const from = Date.parse(`${startYmd}T00:00:00.000-05:00`);
  const to = Date.parse(`${endYmd}T23:59:59.000-05:00`);
  const { rows } = await p.query(
    `SELECT timestamp, open, high, low, close FROM ${tbl}
      WHERE timestamp >= $1 AND timestamp <= $2 ORDER BY timestamp ASC`,
    [from, to]
  );
  const byDay = new Map();
  for (const r of rows) {
    // BIGINT comes back as a string from pg — coerce or every compare lies.
    const ts = Number(r.timestamp);
    const o = Number(r.open), h = Number(r.high), l = Number(r.low), c = Number(r.close);
    if (!(ts > 0) || ![o, h, l, c].every(Number.isFinite) || !(c > 0)) continue;
    const dk = etDateStr(ts);
    const d = byDay.get(dk);
    if (!d) byDay.set(dk, { d: dk, open: o, high: h, low: l, close: c });
    else { d.high = Math.max(d.high, h); d.low = Math.min(d.low, l); d.close = c; }
  }
  return Array.from(byDay.values()).sort((a, b) => (a.d < b.d ? -1 : 1));
}

// ── leg pricing: daily rollup of the recorded TT ticks ──────────────────────

const px4 = (t) => [t.put_long_px, t.put_short_px, t.call_short_px, t.call_long_px];

/**
 * Last full-condor tick of each ET session, keyed by date.
 *
 * "Full" means all four legs quoted. A 3-leg tick is a different position, not
 * an approximation of this one, so it never becomes a day's close over a clean
 * one — but it IS kept as a fallback so the row still shows which wing went
 * unquotable instead of the day vanishing entirely.
 *
 * The tick rows carry prices for whatever strikes the condor had when the tick
 * was written. Re-striking a condor mid-week therefore leaves the earlier days
 * priced off the old wings; that is the honest record of what was actually
 * quoted, and re-deriving strikes is already a "this is a different position"
 * action everywhere else in the tracker.
 *
 * Never throws — a DB hiccup degrades to underlying-only rows.
 */
async function tickRollup(condorId, startYmd, endYmd) {
  const out = { byDate: new Map(), error: null, ticks: 0 };
  if (!(Number(condorId) > 0)) { out.error = 'no condor id'; return out; }
  const p = pool();
  if (!p) { out.error = 'no DATABASE_URL — cannot read em_condor_ticks'; return out; }

  // Pad the epoch window generously and filter on the ET date afterwards, so
  // the boundary is right in both EST and EDT without hardcoding an offset.
  const from = Date.parse(`${startYmd}T00:00:00Z`) - 36 * 3600 * 1000;
  const to = Date.parse(`${endYmd}T00:00:00Z`) + 60 * 3600 * 1000;

  try {
    const { rows } = await p.query(
      `SELECT ts, underlying, put_long_px, put_short_px, call_short_px, call_long_px, legs_priced
         FROM em_condor_ticks
        WHERE condor_id = $1 AND ts >= $2 AND ts <= $3
        ORDER BY ts ASC`,
      [Number(condorId), from, to]
    );
    for (const r of rows) {
      const ts = Number(r.ts);
      if (!(ts > 0)) continue;
      const d = etDateStr(ts);
      if (d < startYmd || d > endYmd) continue;
      out.ticks++;
      const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
      const t = {
        ts,
        underlying: num(r.underlying),
        put_long_px: num(r.put_long_px),
        put_short_px: num(r.put_short_px),
        call_short_px: num(r.call_short_px),
        call_long_px: num(r.call_long_px),
      };
      const full = px4(t).every((v) => v != null);
      const prev = out.byDate.get(d);
      // Later beats earlier at the same completeness; complete always beats
      // partial, so a thin 15:00 wing can't overwrite a clean 14:00 close.
      if (!prev || (full && !prev.full) || (full === prev.full && ts >= prev.ts)) {
        out.byDate.set(d, { ...t, full });
      }
    }
  } catch (e) {
    out.error = e && e.message ? e.message : String(e);
  }
  return out;
}

// ── main ────────────────────────────────────────────────────────────────────

/**
 * Price ONE condor across its week.
 *
 * @param {object} c  { id, ticker, week_start, put_long, put_short, call_short,
 *                      call_long, net_credit, contracts, multiplier, ref_price }
 * @param {object} [opts] { through }  last session to price (default: today ET)
 * @returns {Promise<{ rows: Array, errors: string[], legs_available: number }>}
 */
async function priceCondorWeek(c, opts = {}) {
  const ticker = String(c.ticker).toUpperCase();
  const weekStart = ymdOf(c.week_start);
  if (!weekStart) return { rows: [], errors: [`${ticker}: bad week_start ${JSON.stringify(c.week_start)}`], legs_available: 0 };
  const expiry = fridayOf(weekStart);
  const todayEt = etDateStr(Date.now());
  // A malformed `through` falls back to today rather than sorting to "" and
  // silently reporting every week as "not started".
  const through = ymdOf(opts.through) || todayEt;
  // Never ask for sessions past expiration or past today.
  const end = [expiry, through].sort()[0];
  if (end < weekStart) return { rows: [], errors: ['week has not started'], legs_available: 0 };

  const mult = Number(c.multiplier) > 0 ? Number(c.multiplier) : 100;
  const qty = Number(c.contracts) > 0 ? Number(c.contracts) : 1;
  const credit = Number(c.net_credit);
  const hasCredit = Number.isFinite(credit) && credit !== 0;

  const errors = [];

  // underlying
  let under = [];
  try {
    under = isFutures(ticker)
      ? await futuresDaily(ticker, weekStart, end)
      : (await underlyingDaily(ticker, weekStart, end)).map((b) => ({
          d: etDateStr(b.time), open: b.open, high: b.high, low: b.low, close: b.close,
        }));
  } catch (e) {
    errors.push(`${ticker} underlying: ${e && e.message ? e.message : String(e)}`);
  }

  // legs — futures never had an options chain here, so skip rather than 4× fail
  let legs = null;
  if (!isFutures(ticker)) {
    legs = await tickRollup(c.id, weekStart, end);
    if (legs.error) {
      errors.push(`${ticker} ticks: ${legs.error}`);
    } else if (!legs.ticks) {
      // The single most likely reason a board reads "0 priced". Say it plainly:
      // there is no historical option feed to backfill from on this account.
      errors.push(
        `${ticker}: no recorded TT ticks for ${weekStart}→${end} — daily marks roll up `
        + 'from the hourly snapshots, so only weeks the recorder ran for can be priced'
      );
    }
  } else {
    errors.push(`${ticker}: futures — no options chain, underlying only`);
  }

  // Union of every session we have ANY data for, so a leg that stopped trading
  // doesn't silently truncate the week.
  const dates = new Set(under.map((u) => u.d));
  if (legs) for (const d of legs.byDate.keys()) dates.add(d);

  const putShort = Number(c.put_short), callShort = Number(c.call_short);
  const rows = [];
  for (const d of Array.from(dates).sort()) {
    if (d < weekStart || d > end) continue;
    const u = under.find((x) => x.d === d) || null;
    const t = legs ? legs.byDate.get(d) || null : null;

    const px = t
      ? {
          put_long_px: t.put_long_px,
          put_short_px: t.put_short_px,
          call_short_px: t.call_short_px,
          call_long_px: t.call_long_px,
        }
      : { put_long_px: null, put_short_px: null, call_short_px: null, call_long_px: null };

    const priced = Object.values(px).filter((v) => v != null && Number.isFinite(v)).length;
    // A mark is only meaningful with all four legs — a 3-leg "mark" is a
    // different position, not an approximation of this one.
    const mark = priced === 4
      ? (px.put_short_px - px.put_long_px) + (px.call_short_px - px.call_long_px)
      : null;
    // Recomputed from the condor's CURRENT credit, not copied off the tick, so
    // a credit stamped or corrected after the fact reflows the whole week.
    const openPnl = mark != null && hasCredit ? (credit - mark) * mult * qty : null;
    const maxProfit = hasCredit ? credit * mult * qty : null;

    // Session close from the daily feed; the tick's own spot is the fallback for
    // a day the daily bar hasn't printed yet (today, pre-settle).
    const close = u && Number.isFinite(u.close)
      ? Number(u.close)
      : (t && t.underlying != null ? t.underlying : null);
    const cushion = close != null && Number.isFinite(putShort) && Number.isFinite(callShort)
      ? Math.min(callShort - close, close - putShort)
      : null;

    rows.push({
      d,
      underlying: close,
      under_high: u ? u.high : null,
      under_low: u ? u.low : null,
      ...px,
      mark,
      open_pnl: openPnl,
      pct_max: openPnl != null && maxProfit ? openPnl / maxProfit : null,
      cushion,
      legs_priced: priced,
      source: 'tt',
    });
  }

  return { rows, errors, legs_available: legs && legs.ticks ? 4 : 0 };
}

/**
 * Price many condors. Sequential across condors: each is one small local DB read
 * plus one daily-bar call, and firing 20 of those at once buys nothing but a
 * rate-limit on the daily feed.
 */
async function priceCondors(condors, opts = {}) {
  const out = [];
  const errors = [];
  for (const c of condors) {
    try {
      const r = await priceCondorWeek(c, opts);
      out.push({ condor_id: c.id, ticker: c.ticker, rows: r.rows });
      errors.push(...r.errors);
    } catch (e) {
      errors.push(`${c.ticker}: ${e && e.message ? e.message : String(e)}`);
      out.push({ condor_id: c.id, ticker: c.ticker, rows: [] });
    }
  }
  return { results: out, errors };
}

// ── live intraday snapshot (hourly writer) ──────────────────────────────────
//
// The TastyTrade chain behind /api/chains carries bid/ask/mark for the whole
// expiration in one call — the same payload the Estimated-Move engine prices its
// straddles from — so one round trip prices all four legs of every condor on
// that expiry. These ticks are also what the EOD rollup above reads, which makes
// the hourly writer the only thing standing between a week and a blank chart.

function localBase() {
  return `http://localhost:${process.env.PORT || 3001}`;
}

function internalHeaders() {
  return process.env.INTERNAL_API_TOKEN
    ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN }
    : {};
}

async function getJson(pathname) {
  const res = await fetch(`${localBase()}${pathname}`, {
    // The /api/* gate redirects an unauthenticated call to "/" — following it
    // would hand back landing HTML as a 200.
    redirect: 'manual',
    headers: internalHeaders(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathname} ${res.status}: ${text.slice(0, 160)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${pathname} returned non-JSON (${res.status})`);
  }
}

/**
 * One leg's price.
 *
 * NBBO mid when both sides quote, else the chain's REST `mark`. The mark is what
 * makes this work outside RTH, when bid/ask are 0 across the board and a
 * bid/ask-only rule would null every leg. `last` is deliberately not used: a
 * stale print on a far wing is worse than admitting we have no price.
 */
function legMid(leg) {
  if (!leg) return null;
  const bid = Number(leg.bid ?? leg['bid-price']);
  const ask = Number(leg.ask ?? leg['ask-price']);
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  const mark = Number(leg.mark ?? leg['mark-price'] ?? leg['mid-price']);
  return mark > 0 ? mark : null;
}

/** Broker spot off the chain payload, if it carries one. */
function chainSpot(json) {
  const v = Number(
    json?.data?.underlyingPrice ?? json?.underlyingPrice
    ?? json?.data?.['underlying-price'] ?? json?.data?.underlying_price ?? 0
  );
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Every strike on one expiration, indexed `strike|C` / `strike|P`, plus the
 * underlying spot when the payload carries it. Handles both chain shapes:
 * nested (data.items[].strikes[].call/put) and flat (options[]).
 */
async function chainMids(ticker, expiryIso) {
  const json = await getJson(
    `/api/chains?ticker=${encodeURIComponent(ticker)}`
    + `&expiration=${encodeURIComponent(expiryIso)}&noSubscribe=1`
  );
  const out = new Map();
  const want = String(expiryIso).slice(0, 10);

  const items = Array.isArray(json?.data?.items) ? json.data.items : [];
  for (const grp of items) {
    const exp = grp?.['expiration-date'] || grp?.expirationDate || grp?.expiration;
    if (exp && String(exp).slice(0, 10) !== want) continue;
    const strikes = Array.isArray(grp?.strikes) ? grp.strikes : [];
    for (const row of strikes) {
      const strike = Number(row?.['strike-price'] ?? row?.strikePrice ?? row?.strike);
      if (!(strike > 0)) continue;
      const c = legMid(row?.call);
      const p = legMid(row?.put);
      if (c != null) out.set(`${strike}|C`, c);
      if (p != null) out.set(`${strike}|P`, p);
    }
  }

  const flat = Array.isArray(json?.options) ? json.options : [];
  for (const o of flat) {
    const exp = o?.expiration || o?.expirationDate;
    if (exp && String(exp).slice(0, 10) !== want) continue;
    const strike = Number(o?.strike ?? o?.strikePrice);
    if (!(strike > 0)) continue;
    const right = String(o?.optionType || o?.type || '').toUpperCase().startsWith('C') ? 'C' : 'P';
    const m = legMid(o);
    if (m != null && !out.has(`${strike}|${right}`)) out.set(`${strike}|${right}`, m);
  }

  return { mids: out, spot: chainSpot(json) };
}

/**
 * Underlying print, for the cushion column. Only called when the chain payload
 * didn't carry a spot. Indices are keyed with a $ prefix in quotes-batch, so try
 * both forms before giving up.
 */
async function spotNow(ticker) {
  const t = String(ticker).toUpperCase();
  const candidates = INDICES.has(t) ? [`$${t}`, t] : [t];
  const json = await getJson(
    `/api/quotes-batch?symbols=${encodeURIComponent(candidates.join(','))}`
  );
  const items = Array.isArray(json?.data?.items) ? json.data.items : [];
  const bySymbol = new Map(items.map((q) => [String(q?.symbol), q]));
  for (const sym of candidates) {
    const q = bySymbol.get(sym);
    if (!q) continue;
    const v = Number(q.last ?? q.mark ?? q['prev-close'] ?? q.prevClose);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/**
 * Snapshot the CURRENT value of a set of condors — the hourly writer's payload.
 *
 * One chain-quote call per (ticker, expiry) prices all four legs at once, so a
 * 20-name board costs ~20 TT calls. Returns one tick per condor; condors whose
 * legs aren't all quotable are returned with mark null rather than dropped, so a
 * thin wing is visible as a gap instead of vanishing from the series.
 */
async function snapshotCondorsNow(condors) {
  const ts = Date.now();
  const errors = [];
  const ticks = [];

  // group by (ticker, expiry) so each chain is fetched once
  const groups = new Map();
  for (const c of condors) {
    const ticker = String(c.ticker).toUpperCase();
    if (isFutures(ticker)) continue; // no options chain for the futures roots
    const weekStart = ymdOf(c.week_start);
    if (!weekStart) {
      // One unparseable row must not take the whole board down — the old code
      // threw out of the grouping loop and killed every condor's tick.
      errors.push(`${ticker}: bad week_start ${JSON.stringify(c.week_start)}`);
      continue;
    }
    const key = `${ticker}|${fridayOf(weekStart)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  for (const [key, list] of groups) {
    const [ticker, expiry] = key.split('|');
    let mids = new Map();
    let spot = null;
    try {
      const chain = await chainMids(ticker, expiry);
      mids = chain.mids;
      spot = chain.spot;
    } catch (e) {
      errors.push(`${ticker} chain: ${e && e.message ? e.message : String(e)}`);
    }
    // Only a second round trip when the chain didn't carry the underlying.
    if (spot == null) {
      try {
        spot = await spotNow(ticker);
      } catch (e) {
        errors.push(`${ticker} spot: ${e && e.message ? e.message : String(e)}`);
      }
    }

    for (const c of list) {
      const px = {
        put_long_px: mids.get(`${Number(c.put_long)}|P`) ?? null,
        put_short_px: mids.get(`${Number(c.put_short)}|P`) ?? null,
        call_short_px: mids.get(`${Number(c.call_short)}|C`) ?? null,
        call_long_px: mids.get(`${Number(c.call_long)}|C`) ?? null,
      };
      const priced = Object.values(px).filter((v) => v != null && Number.isFinite(v)).length;
      const mark = priced === 4
        ? (px.put_short_px - px.put_long_px) + (px.call_short_px - px.call_long_px)
        : null;

      const mult = Number(c.multiplier) > 0 ? Number(c.multiplier) : 100;
      const qty = Number(c.contracts) > 0 ? Number(c.contracts) : 1;
      const credit = Number(c.net_credit);
      const hasCredit = Number.isFinite(credit) && credit !== 0;
      const openPnl = mark != null && hasCredit ? (credit - mark) * mult * qty : null;
      const maxProfit = hasCredit ? credit * mult * qty : null;

      const ps = Number(c.put_short), cs = Number(c.call_short);
      const cushion = spot != null && Number.isFinite(ps) && Number.isFinite(cs)
        ? Math.min(cs - spot, spot - ps)
        : null;

      ticks.push({
        condor_id: c.id,
        ticker,
        ts,
        underlying: spot,
        ...px,
        mark,
        open_pnl: openPnl,
        pct_max: openPnl != null && maxProfit ? openPnl / maxProfit : null,
        cushion,
        legs_priced: priced,
        source: 'tt',
      });
    }
  }

  return { ts, ticks, errors };
}

module.exports = {
  priceCondorWeek, priceCondors, snapshotCondorsNow, fridayOf, etDateStr,
};
