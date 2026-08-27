'use strict';
/**
 * server-v2/levels-engine.js
 *
 * Server-side port of the Estimated-Move + No-Short/No-Long-Zone math that
 * lives in components/dashboard/EstimatedMoves.tsx. It deliberately calls the
 * SAME Next API endpoints the browser uses (/api/quotes-batch, /api/expirations,
 * /api/chains, /api/em/option-marks, /api/dxlink/candles) over localhost, so the
 * chain parsing / normalization / NDX+futures edge cases can never drift from
 * the client. Only the pure math is duplicated here, not the data plumbing.
 *
 * Used by levels-auto-publish.js to compute weekly levels with no browser.
 */

// Publish roster lives in em-tickers.js (edit the list there, not here) — or,
// live, on the owner Watchlists page's EM list. getActiveSymbols() resolves the
// second over the first; SYMBOLS stays imported as the fallback and for the
// display-label mapping. em-tickers' own header says to prefer the async form
// anywhere an await is possible, and until 2026-08-27 this file did not.
const { SYMBOLS, ZONE_SYMBOLS, getActiveSymbols } = require('./em-tickers');

const DISPLAY_LABEL = { ESM: 'ESU', NQM: 'NQU', ESU6: 'ESU', NQM6: 'NQU' };
// Roster ticker -> QUOTE-feed symbol. 'BRK.B' quotes as BRK-B on Yahoo (the dot
// form returns an empty row, which is why it failed every run); its CHAIN symbol
// on TastyTrade is a third form, BRK/B — add a CHAIN_SYMBOL entry if the chain
// side also comes back empty.
const API_SYMBOL = { ESM: '/ESU26', NQM: '/NQ:XCME', SPX: '$SPX', NDX: '$NDX', 'BRK.B': 'BRK-B' };
// Roster ticker -> CHAIN-feed symbol. Berkshire B is a third spelling again:
// roster BRK.B, Yahoo BRK-B (API_SYMBOL above), TastyTrade BRK/B.
const CHAIN_SYMBOL = { SPX: '$SPX', NDX: '$NDX', 'BRK.B': 'BRK/B' };
const FUTURE_PROXY = { ESM: 'SPX', NQM: 'NDX' };

// dxLink weekly-candle symbol for the zone math (mirrors the client zoneSymbol).
const ZONE_HISTORY_SYMBOL = { ESM: '/ESU6{=w}', NQM: '/NQ{=w}' };
function zoneSymbol(ticker) {
  if (ZONE_HISTORY_SYMBOL[ticker]) return ZONE_HISTORY_SYMBOL[ticker];
  if (ticker === 'SPX') return '$SPX{=w}';
  if (ticker === 'NDX') return '$NDX{=w}';
  return `${ticker}{=w}`;
}
// NOTE: zoneSymbol()'s '/ESU6{=w}' resolves to Yahoo's CONTINUOUS "ES=F" series
// (see historyYahooSymbol in proxy-tastytrade.js) — it is NOT the ESU6 contract.
// It survives only for the long-history EM backfill map, never for zones.
/**
 * Quote roster for one run: the publish roster plus the alias/futures symbols
 * price resolution needs.
 *
 * A FUNCTION, not a module const. It was
 * `const QUOTE_SYMBOLS = [...SYMBOLS, ...]`, evaluated at require time off
 * em-tickers' static export — precisely what that file's own header warns
 * against ("SYMBOLS is frozen at require time and will not see an edit"). A
 * ticker added on the owner Watchlists page therefore never had a quote fetched
 * for it, so it failed the EM calc and sat in failedEm forever, for a reason
 * nothing on screen could explain.
 *
 * Falls back to SYMBOLS when handed nothing, so the entry points that do not
 * resolve a roster (the historical evaluators) behave exactly as before.
 */
function quoteSymbolsFor(roster) {
  return Array.from(new Set([
    ...(roster && roster.length ? roster : SYMBOLS),
    ...Object.values(API_SYMBOL), '/ESU26', '/NQU26', 'VIX',
  ]));
}

// Headline ETFs that MUST price every run — the customer /em page and the
// multi-greek / home EM bands read these. They sit contiguously in the roster,
// so one dropped bulk-sweep chunk zeroes all of them at once. Unlike an illiquid
// single name, a NaN here is always a sweep glitch (the quote IS available), so
// fetchAllQuotes re-fetches any unpriced one individually as a backstop.
const CRITICAL_QUOTE_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'DIA', 'SMH'];

// ── formatting (mirrors the client) ────────────────────────────────────────
function roundQuarter(n) { return Math.round(n * 4) / 4; }
function fmtPrice(ticker, num) {
  if (num === undefined || !Number.isFinite(num)) return null;
  const n = (ticker === 'ESM' || ticker === 'NQM') ? roundQuarter(num) : num;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtFuture(num) {
  if (num === undefined || !Number.isFinite(num)) return null;
  return roundQuarter(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Zone levels: ONLY ES/NQ trade in quarter ticks. Quarter-rounding SPY/AAPL/etc
// snapped penny-priced names to the nearest 0.25 (e.g. SPY far 771.77 -> 772.00),
// so zones print prices that can't exist. Route zones through fmtPrice, which
// quarter-rounds ESM/NQM and leaves everything else at 2dp.
const fmtZone = (ticker, num) => fmtPrice(ticker, num);
function fmtEm(num) {
  if (num === undefined || !Number.isFinite(num) || num < 0) return null;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}
function labelForDate(exp) {
  if (!exp) return null;
  return new Date(exp + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}
function daysTo(exp) {
  return Math.ceil((new Date(exp + 'T16:00:00').getTime() - Date.now()) / 86400000);
}
function mid(o) {
  if (o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2;
  if (o.mark > 0) return o.mark;
  if (o.last > 0) return o.last;
  // Last resort: the option's own settlement/prior close. Outside RTH TastyTrade
  // stops returning bid/ask/mark/IV for everything but the most liquid names, so
  // without this a weekend or after-hours pass throws "No usable strike" on two
  // thirds of the roster and those tickers keep serving last week's EM.
  if (o.close > 0) return o.close;
  return 0;
}

// ── week helpers (zones) ────────────────────────────────────────────────────
function getEtNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}
function getWeekKey(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const mondayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - mondayOffset);
  return d.toISOString().slice(0, 10);
}
/**
 * The Monday that starts the week a publish is FOR.
 *
 * The publish runs Friday after the close and its retry loop keeps running
 * Fri→Thu, so this can't be a fixed offset from "now": the old `now + 2 days`
 * landed on SUNDAY when called on a Friday, and getWeekKey() resolves a Sunday
 * back to the Monday of the week that just ENDED — seeding em_tracker against
 * the wrong week. Explicit instead: Fri/Sat/Sun → the next Monday; Mon–Thu →
 * the Monday of the week already in progress.
 */
function upcomingWeekKey(now = getEtNow()) {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  const day = d.getDay(); // 0=Sun .. 6=Sat
  if (day === 5 || day === 6 || day === 0) d.setDate(d.getDate() + ((8 - day) % 7 || 7));
  return getWeekKey(d);
}
function getCompletedWeekKey() {
  const now = getEtNow();
  const anchor = new Date(now);
  const minutes = anchor.getHours() * 60 + anchor.getMinutes();
  const day = anchor.getDay();
  if (day === 0) anchor.setDate(anchor.getDate() - 2);
  else if (day === 6) anchor.setDate(anchor.getDate() - 1);
  else if (day === 5 && minutes < 16 * 60) anchor.setDate(anchor.getDate() - 7);
  else if (day >= 1 && day <= 4) anchor.setDate(anchor.getDate() - (day + 2));
  return getWeekKey(anchor);
}
// ET calendar date (YYYY-MM-DD) for a ms timestamp. en-CA formats as ISO.
function etDateStr(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}
// First day inside a week whose bar poked outside the band. `days` = [{ t, high, low }].
// Returns { breach: 1|0|null, breach_day: 'YYYY-MM-DD'|null } — breach_day = the
// EARLIEST breaching day. Null breach when no daily bars / no band to test against.
function computeBreach(days, up, down) {
  if (!Array.isArray(days) || !days.length || !Number.isFinite(up) || !Number.isFinite(down)) {
    return { breach: null, breach_day: null };
  }
  const sorted = [...days].sort((a, b) => a.t - b.t);
  for (const d of sorted) {
    if (d.high > up || d.low < down) return { breach: 1, breach_day: etDateStr(d.t) };
  }
  return { breach: 0, breach_day: null };
}

// ── chain normalization (verbatim port) ─────────────────────────────────────
// Broker underlying spot from the chain payload. Indices (SPX ~7500) differ from
// Yahoo's ^GSPC (~6000); strikes are in the broker scale, so the ATM walk must
// center on this, not the Yahoo quote, or the straddle never matches.
function chainUnderlyingPrice(chain) {
  const c = chain || {};
  const d = c.data || {};
  const v = Number(
    d.underlyingPrice != null ? d.underlyingPrice
    : c.underlyingPrice != null ? c.underlyingPrice
    : d.underlying_price != null ? d.underlying_price
    : c.underlying_price != null ? c.underlying_price
    : 0
  );
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function normalizeOptions(chain) {
  const flat = [];
  const direct = Array.isArray(chain && chain.options) ? chain.options : [];
  direct.forEach((o) => {
    flat.push({
      symbol: o.symbol || o.optionSymbol || '',
      expiration: o.expiration || o.expirationDate,
      strike: Number(o.strike || o.strikePrice),
      type: String(o.optionType || o.type || '').toUpperCase(),
      bid: Number(o.bid || o.bidPrice || o['bid-price'] || 0),
      ask: Number(o.ask || o.askPrice || o['ask-price'] || 0),
      last: Number(o.last || o['last-price'] || o.lastPrice || 0),
      mark: Number(o.mark || o['mark-price'] || o['mid-price'] || o.midPrice || 0),
      close: Number(o.close || o['close-price'] || o['prev-close'] || o.prevClose || 0),
      iv: Number(o.iv || o.impliedVolatility || o['implied-volatility'] || o.volatility || 0),
      dte: Number(o.dte || o.daysToExpiration || 0),
    });
  });
  const nestedItems = Array.isArray(chain && chain.data && chain.data.items) ? chain.data.items : [];
  nestedItems.forEach((expGroup) => {
    const expiration = expGroup['expiration-date'] || expGroup.expirationDate || expGroup.expiration;
    const strikes = Array.isArray(expGroup.strikes) ? expGroup.strikes : [];
    strikes.forEach((strikeRow) => {
      const strike = Number(strikeRow['strike-price'] || strikeRow.strikePrice || strikeRow.strike);
      ['call', 'put'].forEach((side) => {
        const leg = strikeRow[side];
        if (!leg) return;
        flat.push({
          symbol: leg.symbol || '',
          expiration,
          strike,
          type: side.toUpperCase(),
          bid: Number(leg.bid || leg.bidPrice || leg['bid-price'] || 0),
          ask: Number(leg.ask || leg.askPrice || leg['ask-price'] || 0),
          last: Number(leg.last || leg['last-price'] || leg.lastPrice || 0),
          mark: Number(leg.mark || leg['mark-price'] || leg['mid-price'] || leg.midPrice || 0),
          close: Number(leg.close || leg['close-price'] || leg['prev-close'] || leg.prevClose || 0),
          iv: Number(leg.iv || leg['implied-volatility'] || leg.impliedVolatility || leg.volatility || 0),
          dte: Number(leg.dte || leg.daysToExpiration || daysTo(expiration)),
        });
      });
    });
  });
  return flat.filter((o) => o.expiration && Number.isFinite(o.strike));
}

function parseHistoryItems(json) {
  const items = (json && json.data && (json.data.items || json.data.candles)) || (json && json.candles) || [];
  return items.map((item) => {
    const rawTime = item.time ?? item.datetime ?? item.timestamp ?? item.startsAt ?? item.date;
    const time = typeof rawTime === 'number' ? rawTime
      : typeof rawTime === 'string' ? Date.parse(rawTime) : NaN;
    return { time, open: Number(item.open), high: Number(item.high), low: Number(item.low), close: Number(item.close) };
  }).filter((i) =>
    Number.isFinite(i.time) && Number.isFinite(i.open) && Number.isFinite(i.high)
    && Number.isFinite(i.low) && Number.isFinite(i.close) && i.close > 0
  ).sort((a, b) => a.time - b.time);
}

function buildZoneLevels(ticker, candles) {
  const ordered = [...candles].sort((a, b) => a.time - b.time);
  const open = ordered[0].open;
  const close = ordered[ordered.length - 1].close;
  const high = Math.max(...ordered.map((i) => i.high));
  const low = Math.min(...ordered.map((i) => i.low));
  const pivot = (high + low + close) / 3;
  const range = high - low;
  return {
    ticker, open, high, low, close, pivot, range,
    noLongNear: pivot + range,
    noLongFar: pivot + (1.382 * range),
    noShortNear: pivot - range,
    noShortFar: pivot - (1.382 * range),
  };
}

// ── engine: fetches against localhost Next API ──────────────────────────────
// All requests carry the internal shared-secret header so Clerk middleware lets
// them through (otherwise they're redirected to "/" and return landing-page
// HTML, which fails JSON parsing). The token is read from env at call time.
function internalHeaders(extra) {
  const token = process.env.INTERNAL_API_TOKEN;
  const h = Object.assign({}, extra);
  if (token) h['x-internal-token'] = token;
  return h;
}

function ifetch(url, opts = {}) {
  return fetch(url, Object.assign({ cache: 'no-store' }, opts, {
    headers: internalHeaders(opts.headers),
  }));
}

function makeEngine(base) {
  // `roster` is the run's resolved publish roster, set by computeAllLevels once
  // it has awaited getActiveSymbols(). Null on the entry points that never
  // resolve one (evaluateCompletedWeek, evaluateHistoricalWeeks), where
  // quoteSymbolsFor falls back to the static list — those read history rather
  // than publishing, so a roster edit does not apply to them.
  return { base, roster: null, quoteCache: {}, quoteCacheTime: 0, directChainCache: {}, emClosesCache: null };
}

async function getJson(url) {
  const r = await ifetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

// How long one publish run may reuse its quote sweep. This was 5 SECONDS, which
// was the single biggest source of "Invalid price for X: NaN" failures: a run
// walks the roster 4 tickers at a time with a 300ms pause, so the cache expired
// every few tickers and the ENTIRE roster-wide sweep (419 symbols = 11 chunked
// HTTP requests) re-ran ~12x a minute for the whole multi-minute publish. Yahoo
// rate-limits that and starts returning empty 200s, which zero out whole
// 40-symbol windows at a time. Measured on the 2026-07-26 20:53 run: 224 tickers
// failed on the quote — and 200 of them quoted perfectly fine through the exact
// same endpoint moments later. The quotes only need fetching once per run.
const QUOTE_CACHE_MS = 10 * 60 * 1000;

async function fetchAllQuotes(engine) {
  if (Date.now() - engine.quoteCacheTime < QUOTE_CACHE_MS && Object.keys(engine.quoteCache).length) {
    return engine.quoteCache;
  }
  // Chunk the quotes-batch call so a large roster (200+ tickers) doesn't blow the
  // query-string length limit. 40 symbols/request keeps the URL well under ~2KB.
  const CHUNK = 40;
  const map = {};
  const QUOTE_SYMBOLS = quoteSymbolsFor(engine.roster);
  for (let i = 0; i < QUOTE_SYMBOLS.length; i += CHUNK) {
    const part = QUOTE_SYMBOLS.slice(i, i + CHUNK);
    try {
      const json = await getJson(`${engine.base}/api/quotes-batch?symbols=${encodeURIComponent(part.join(','))}`);
      const items = (json && json.data && json.data.items) || [];
      items.forEach((q) => { map[q.symbol] = q; });
    } catch (e) {
      // A single flaky chunk must not abort the whole sweep — that would fail the
      // entire publish. Skip it and continue; the critical-symbol backstop below
      // re-fetches any headline ETF a dropped chunk left unpriced.
      console.log(`[levels-engine] quotes chunk ${i}-${i + part.length} failed — ${e.message}`);
    }
  }
  // A quote row is only usable if it carries a real price. Yahoo intermittently
  // returns an all-null row for index symbols ($NDX), which must NOT clobber a
  // sibling key (NDX) that does have the price — that was the cause of NDX/NQM
  // publishing as "Invalid price for NDX: NaN".
  const hasPrice = (x) => {
    const v = Number(x && (x.last ?? x.mark ?? x['prev-close'] ?? x.prevClose ?? x['day-close']));
    return Number.isFinite(v) && v > 0;
  };
  const aliases = {
    ESM: ['/ESU26', '/ESU6', '/ES:XCME', '/ES'],
    NQM: ['/NQU26', '/NQM6', '/NQ:XCME', '/NQ'],
    SPX: ['$SPX'], NDX: ['$NDX'], SPY: ['SPY'], QQQ: ['QQQ'],
  };
  Object.entries(aliases).forEach(([key, list]) => {
    // Prefer a PRICED source: first a priced alias, else the priced original,
    // else any alias, else leave whatever's there.
    const pricedAlias = list.find((a) => hasPrice(map[a]));
    if (pricedAlias) { map[key] = map[pricedAlias]; return; }
    if (hasPrice(map[key])) return; // keep the priced original (e.g. NDX)
    const anyAlias = list.find((a) => map[a]);
    if (anyAlias) map[key] = map[anyAlias];
  });

  // Backstop for EVERY unpriced symbol, not just the headline ETFs. A bulk-sweep
  // chunk can return an empty/partial 200 (not a thrown non-200) that silently
  // zeroes a whole 40-symbol window, and every name in it then publishes as
  // "Invalid price: NaN" even though the quote is perfectly available. This used
  // to re-ask only for SPY/QQQ/IWM/DIA/SMH, so a dropped window anywhere else in
  // the roster just became ~40 stale tickers for the week.
  //
  // Ordered so the headline ETFs are recovered first (they back the /em page and
  // the home EM bands), then everything else. Individual re-asks are cheap — on a
  // healthy run there are none, and on a bad one they're the difference between a
  // full roster and a third of it.
  const unpriced = [
    ...CRITICAL_QUOTE_SYMBOLS.filter((s) => !hasPrice(map[s])),
    ...QUOTE_SYMBOLS.filter((s) => !CRITICAL_QUOTE_SYMBOLS.includes(s) && !hasPrice(map[s])),
  ];
  if (unpriced.length) console.log(`[levels-engine] ${unpriced.length} symbol(s) unpriced after the bulk sweep — re-asking individually`);
  const stillUnpriced = [];
  for (const sym of unpriced) {
    for (let attempt = 0; attempt < 3 && !hasPrice(map[sym]); attempt++) {
      try {
        const json = await getJson(`${engine.base}/api/quotes-batch?symbols=${encodeURIComponent(sym)}`);
        const items = (json && json.data && json.data.items) || [];
        const row = items.find((q) => q.symbol === sym) || items[0];
        if (hasPrice(row)) { map[sym] = row; break; }
      } catch { /* transient — retry */ }
      await new Promise((r) => setTimeout(r, 120)); // don't re-create the storm
    }
    if (!hasPrice(map[sym])) stillUnpriced.push(sym);
  }
  if (stillUnpriced.length) {
    // Anything here quotes NOWHERE — in practice a delisted/renamed/acquired
    // ticker still sitting in em-tickers.js. Logged by name so the roster can be
    // pruned instead of carrying permanent failures.
    console.log(`[levels-engine] no quote anywhere for: ${stillUnpriced.join(', ')}`);
  }

  engine.quoteCache = map;
  engine.quoteCacheTime = Date.now();
  return map;
}

async function fetchQuoteDetail(ticker, engine) {
  const dxSym = API_SYMBOL[ticker] || ticker;
  const quotes = await fetchAllQuotes(engine);
  const priced = (x) =>
    x && Number.isFinite(Number(x.last ?? x.mark ?? x['prev-close'] ?? x.prevClose ?? x['day-close']))
    && Number(x.last ?? x.mark ?? x['prev-close'] ?? x.prevClose ?? x['day-close']) > 0;
  const candidates = [
    quotes[dxSym], quotes[ticker],
    quotes[String(dxSym).replace(/^\//, '')],
    quotes[String(ticker).replace(/^\//, '')],
    quotes[String(dxSym).replace(/^\$/, '')],
  ];
  const q = candidates.find(priced) || candidates.find(Boolean);
  if (!q) throw new Error(`${ticker} not in quotes-batch`);
  const prevClose = Number(q['prev-close'] || q.prevClose || 0);
  const dayClose = Number(q['day-close'] || 0);
  const isFutures = ticker === 'ESM' || ticker === 'NQM';
  const isIndex = ticker === 'SPX' || ticker === 'NDX';
  // NOTE the prevClose/dayClose tail on the equity branch. fetchAllQuotes'
  // hasPrice() already counts a row as priced when only prev-close is present,
  // so without it a row could pass the sweep's check and then throw "Invalid
  // price: NaN" here — the two must agree on what "priced" means.
  let close = isFutures && dayClose > 0 ? dayClose
    : isIndex && prevClose > 0 ? prevClose
    : Number(q.last || q.mark || ((q.bid + q.ask) / 2) || prevClose || dayClose);
  if (isFutures && !(dayClose > 0)) {
    try {
      if (!engine.emClosesCache) {
        const r = await ifetch(`${engine.base}/api/em/em-closes`);
        engine.emClosesCache = r.ok ? ((await r.json()).data || {}) : {};
      }
      const yc = ticker === 'ESM' ? engine.emClosesCache.es : engine.emClosesCache.nq;
      if (yc > 0) close = yc;
    } catch {}
  }
  if (isFutures && (!Number.isFinite(close) || close <= 0)) {
    const fb = Number(q.last ?? q.mark ?? q['prev-close'] ?? q.prevClose ?? 0);
    if (fb > 0) close = fb;
  }
  if (!Number.isFinite(close) || close <= 0) throw new Error(`Invalid price for ${ticker}: ${close}`);
  return { quote: q, close, prevClose };
}

async function fetchOptionMarks(engine, symbols) {
  const cleaned = symbols.map((s) => String(s || '').trim()).filter(Boolean);
  if (!cleaned.length) return {};
  const r = await ifetch(`${engine.base}/api/em/option-marks?symbols=${encodeURIComponent(cleaned.join(','))}`);
  if (!r.ok) return {};
  const json = await r.json();
  const map = {};
  ((json && json.data && json.data.items) || []).forEach((it) => { if (it && it.symbol) map[it.symbol] = it; });
  return map;
}

async function fetchChainDirect(engine, chainSym, targetExp) {
  const key = `${chainSym}:${targetExp}`;
  if (engine.directChainCache[key]) return engine.directChainCache[key];
  const urls = [
    `${engine.base}/api/chains?ticker=${encodeURIComponent(chainSym)}&expiration=${encodeURIComponent(targetExp)}&noSubscribe=1`,
    `${engine.base}/api/chains?ticker=${encodeURIComponent(chainSym)}&expiration=${encodeURIComponent(targetExp)}`,
  ];
  for (const url of urls) {
    try {
      const r = await ifetch(url);
      if (!r.ok) continue;
      const opts = normalizeOptions(await r.json()).filter((o) => o.expiration === targetExp);
      if (opts.length) { engine.directChainCache[key] = opts; return opts; }
    } catch {}
  }
  return null;
}

function getTargetExpiration(knownExpirations, expOverride) {
  if (expOverride) return expOverride;
  if (knownExpirations.length) {
    const inRange = knownExpirations.filter((exp) => { const d = daysTo(exp); return d >= 1 && d <= 10; });
    const friday = inRange.find((exp) => new Date(exp + 'T12:00:00').getDay() === 5);
    if (friday) return friday;
    const thursday = inRange.find((exp) => new Date(exp + 'T12:00:00').getDay() === 4);
    if (thursday) return thursday;
    if (inRange[0]) return inRange[0];
    return knownExpirations[0];
  }
  return '';
}

async function estimateMove(ticker, targetExp, engine) {
  const isIndex = ticker === 'SPX' || ticker === 'NDX';
  const isFutureProxy = !!FUTURE_PROXY[ticker];
  // The Yahoo quote-batch row can be null/all-zero (for $NDX and the NQ future).
  // Tolerate it for indices AND futures — both recover their level from the broker
  // chain underlyingPrice below (a future falls back to a zero basis).
  const tolerateMissingQuote = isIndex || isFutureProxy;
  let close = 0;
  let prevClose = 0;
  try {
    const detail = await fetchQuoteDetail(ticker, engine);
    close = detail.close;
    prevClose = detail.prevClose;
  } catch (e) {
    if (!tolerateMissingQuote) throw e;
  }
  if (!tolerateMissingQuote && (!Number.isFinite(close) || close <= 0)) throw new Error('No quote');
  if (!targetExp) throw new Error('No expiration selected');

  const isFuture = FUTURE_PROXY[ticker];
  const lookupSym = isFuture ? FUTURE_PROXY[ticker] : (CHAIN_SYMBOL[ticker] || ticker);
  const chainSym = (lookupSym || 'SPX').replace(/^\$/, '');

  const chainUrl = `${engine.base}/api/chains?ticker=${encodeURIComponent(chainSym)}&expiration=${encodeURIComponent(targetExp)}&noSubscribe=1`;
  const chain = await Promise.race([
    ifetch(chainUrl).then((r) => r.ok ? r.json() : { options: [] }).catch(() => ({ options: [] })),
    new Promise((res) => setTimeout(() => res({ options: [] }), 10000)),
  ]);

  let options = normalizeOptions(chain);
  let chainSpot = chainUnderlyingPrice(chain);
  // `close`/`last` count as priced: after hours those are often the ONLY fields
  // TastyTrade still returns, and a Friday-close straddle is exactly the mark a
  // next-week EM should be struck from.
  const isPriced = (o) => (o.bid > 0 && o.ask > 0) || o.mark > 0 || Number(o.iv || 0) > 0
    || Number(o.close || 0) > 0 || Number(o.last || 0) > 0;
  let effectiveExp = targetExp;
  let expOptions = options.filter((o) => o.expiration === effectiveExp);
  if (!expOptions.length || !expOptions.some(isPriced)) {
    const unpinned = await ifetch(`${engine.base}/api/chains?ticker=${encodeURIComponent(chainSym)}`)
      .then((r) => (r.ok ? r.json() : { options: [] })).catch(() => ({ options: [] }));
    const merged = normalizeOptions(unpinned);
    if (merged.length) options = merged;
    const unpinnedSpot = chainUnderlyingPrice(unpinned);
    if (unpinnedSpot > 0) chainSpot = unpinnedSpot;
    const pricedExps = [...new Set(options.filter(isPriced).map((o) => o.expiration))].filter(Boolean).sort();
    const allExps = [...new Set(options.map((o) => o.expiration))].filter(Boolean).sort();
    const pool = pricedExps.length ? pricedExps : allExps;
    // Never roll past the target week. A weekend-unpriced weekly must FAIL (and
    // hit the retry backoff) rather than silently become the monthly — that is
    // what published a 27-DTE 8/21 straddle as the 7/31 weekly EM.
    const maxSnap = new Date(Date.parse(targetExp + 'T12:00:00') + 3 * 86400000)
      .toISOString().slice(0, 10);
    const snapped = pool.find((e) => e >= targetExp && e <= maxSnap);
    if (!snapped) throw new Error(`no priced chain at ${targetExp}`);
    effectiveExp = snapped;
    expOptions = options.filter((o) => o.expiration === effectiveExp);
  }
  if (!expOptions.length) throw new Error('No options for expiration');

  if (expOptions.every((o) => Number(o.iv || 0) === 0)) {
    const direct = await fetchChainDirect(engine, chainSym, effectiveExp);
    if (direct) expOptions = direct;
  }

  // Proxy index quote only as a fallback when the chain gave no broker spot; the
  // $NDX Yahoo quote is often null and throws, so guard it.
  let indexQuote = null;
  if (isFuture && !(chainSpot > 0)) {
    try { indexQuote = await fetchQuoteDetail(lookupSym, engine); } catch { indexQuote = null; }
  }
  // Center the ATM strike walk on the broker spot (chainSpot) when available —
  // strikes are in that scale (SPX ~7500), not the Yahoo close (~6000).
  const quoteClose = isFuture
    ? (indexQuote && indexQuote.prevClose > 0 ? indexQuote.prevClose : (indexQuote ? indexQuote.close : 0))
    : close;
  const indexClose = chainSpot > 0 ? chainSpot : quoteClose;
  // Recover an index's display close from the broker spot when the Yahoo quote
  // was null, instead of throwing "Invalid price".
  if (isIndex && (!Number.isFinite(close) || close <= 0) && chainSpot > 0) close = chainSpot;
  if (!Number.isFinite(indexClose) || indexClose <= 0) throw new Error('No usable underlying price');

  // Bound the ATM-first strike walk (see EstimatedMoves.tsx): after-hours the
  // chain may have no IV/quote on most strikes; probing all of them serially via
  // option-marks caused a request storm + multi-second publish. Nearest few only.
  const MAX_STRIKE_TRIES = 8;
  const strikes = [...new Set(expOptions.map((o) => o.strike))]
    .sort((a, b) => Math.abs(a - indexClose) - Math.abs(b - indexClose))
    .slice(0, MAX_STRIKE_TRIES);
  if (!strikes.length) throw new Error('No strikes found');

  let strike = null;
  let em = 0;
  for (const candidateStrike of strikes) {
    let c = expOptions.find((o) => o.strike === candidateStrike && o.type === 'CALL');
    let p = expOptions.find((o) => o.strike === candidateStrike && o.type === 'PUT');
    if (!c || !p) continue;
    const candidateDte = c.dte || p.dte || daysTo(effectiveExp);
    let avgIV = (Number(c.iv || 0) + Number(p.iv || 0)) / 2;
    let candidateEm = 0;
    if (avgIV > 0 && candidateDte > 0) {
      candidateEm = 0.84 * avgIV * indexClose * Math.sqrt(candidateDte / 365);
    } else {
      // Only refetch marks when the chain leg has NO usable price (no bid/ask AND
      // no mark/last). The chain payload already carries a REST mark, so refetching
      // on every strike fired hundreds of /api/em/option-marks calls per ticker.
      const haveUsable = (o) => (o.bid > 0 && o.ask > 0) || Number(o.mark) > 0
        || Number(o.last) > 0 || Number(o.close) > 0;
      if ((!haveUsable(c) || !haveUsable(p)) && (c.symbol || p.symbol)) {
        const marks = await fetchOptionMarks(engine, [c.symbol, p.symbol].filter(Boolean));
        if (marks[c.symbol]) c = Object.assign({}, c, marks[c.symbol]);
        if (marks[p.symbol]) p = Object.assign({}, p, marks[p.symbol]);
        avgIV = (Number((c && c.iv) || 0) + Number((p && p.iv) || 0)) / 2;
      }
      const cMid = c ? mid(c) : 0;
      const pMid = p ? mid(p) : 0;
      if (cMid > 0 && pMid > 0) candidateEm = (cMid + pMid) * 0.85;
      else if (avgIV > 0 && candidateDte > 0) candidateEm = 0.84 * avgIV * indexClose * Math.sqrt(candidateDte / 365);
    }
    if (Number.isFinite(candidateEm) && candidateEm > 0) {
      const emPct = candidateEm / indexClose;
      if (emPct < 0.002 || emPct > 0.25) continue;
      strike = candidateStrike; em = candidateEm; break;
    }
  }
  if (!strike) throw new Error('No usable strike');
  if (!Number.isFinite(em) || em <= 0) throw new Error('EM zero');

  // Basis only when the future's own quote is valid; else 0 (center on proxy spot).
  const haveFutureClose = isFuture && Number.isFinite(close) && close > 0;
  const basis = haveFutureClose ? close - indexClose : 0;
  void prevClose;
  const displayClose = isFuture
    ? (haveFutureClose ? close : indexClose)
    : (chainSpot > 0 ? chainSpot : close);
  return { ticker, close: displayClose, em, up: indexClose + em + basis, down: indexClose - em + basis, expiration: effectiveExp, strike };
}

async function fetchWeeklyHistoryDx(engine, symbol) {
  const start = Date.now() - (140 * 24 * 60 * 60 * 1000);
  const url = `${engine.base}/api/dxlink/candles?symbol=${encodeURIComponent(symbol)}&start=${start}&count=12`;
  const r = await ifetch(url);
  const text = await r.text();
  if (!r.ok) throw new Error(`History failed for ${symbol}`);
  return parseHistoryItems(JSON.parse(text));
}

// Aggregate daily OHLC bars into Monday-anchored weekly bars matching the
// dxLink weekly shape { time, open, high, low, close }. `time` is set to the
// week's Monday 00:00 ET so getWeekKey() + the canonical-bar check downstream
// resolve to the correct week.
function weeklyFromDaily(daily) {
  const byWeek = new Map();
  for (const b of daily) {
    const wk = getWeekKey(new Date(b.time));
    let g = byWeek.get(wk);
    if (!g) { g = { wk, bars: [] }; byWeek.set(wk, g); }
    g.bars.push(b);
  }
  return Array.from(byWeek.values())
    .map(({ wk, bars }) => {
      bars.sort((a, b) => a.time - b.time);
      return {
        time: Date.parse(`${wk}T04:00:00.000Z`), // Monday 00:00 ET
        open: bars[0].open,
        close: bars[bars.length - 1].close,
        high: Math.max(...bars.map((x) => x.high)),
        low: Math.min(...bars.map((x) => x.low)),
        // Per-day bars kept so the evaluator can pin the FIRST breach day.
        days: bars.map((x) => ({ t: x.time, high: x.high, low: x.low })),
      };
    })
    .sort((a, b) => a.time - b.time);
}

// ── futures weekly candle: broker bars, NOT Yahoo ───────────────────────────
// /api/dxlink/candles is Yahoo-backed (historyYahooSymbol maps /ES* -> "ES=F"),
// which is a CONTINUOUS, roll-adjusted series — its weekly OHLC does not match
// the ESU6 contract you chart, so the zones came out ~120 pts off pivot. The
// authoritative bars are the ones the app already streams from /ESU26:XCME and
// persists 5m at a time into es_candles / nq_candles. Aggregate those instead.
//
// ETH week = Sunday 18:00 ET open -> Friday 17:00 ET close. Shifting each bar
// +6h before keying puts the Sunday-evening session into the week it belongs to.
const ETH_SHIFT_MS = 6 * 60 * 60 * 1000;
let _zonePool = null;
function zonePool() {
  if (_zonePool) return _zonePool;
  if (!process.env.DATABASE_URL) return null;
  const { Pool } = require('pg');
  _zonePool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
    max: 2,
    keepAlive: true,
  });
  _zonePool.on('error', (e) => {
    console.warn('[levels] zone pool error (will reconnect):', e.message);
    try { _zonePool?.end().catch(() => {}); } catch {}
    _zonePool = null;
  });
  return _zonePool;
}

async function fetchWeeklyHistoryFutures(ticker, daysBack = 140) {
  const p = zonePool();
  if (!p) throw new Error(`No DATABASE_URL — cannot build ${ticker} weekly zone candle`);
  const tbl = ticker === 'NQM' ? 'nq_candles' : 'es_candles';
  const since = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const { rows } = await p.query(
    `SELECT timestamp, open, high, low, close FROM ${tbl}
      WHERE timestamp >= $1 ORDER BY timestamp ASC`,
    [since]
  );
  const byWeek = new Map();
  for (const r of rows) {
    // BIGINT columns come back as strings from pg — coerce or every compare lies.
    const ts = Number(r.timestamp);
    const o = Number(r.open); const h = Number(r.high);
    const l = Number(r.low); const c = Number(r.close);
    if (!(ts > 0) || ![o, h, l, c].every(Number.isFinite) || !(c > 0)) continue;
    const wk = getWeekKey(new Date(ts + ETH_SHIFT_MS));
    let g = byWeek.get(wk);
    if (!g) { g = { wk, bars: [] }; byWeek.set(wk, g); }
    g.bars.push({ time: ts, open: o, high: h, low: l, close: c });
  }
  return Array.from(byWeek.values())
    .map(({ wk, bars }) => {
      bars.sort((a, b) => a.time - b.time);
      // Collapse the 5m bars into ET SESSION days (Sun-eve ETH → Monday via the
      // same +6h shift) so the evaluator can name the first breaching session.
      const byDay = new Map();
      for (const x of bars) {
        const dk = etDateStr(x.time + ETH_SHIFT_MS);
        const d = byDay.get(dk);
        if (!d) byDay.set(dk, { t: Date.parse(`${dk}T12:00:00.000Z`), high: x.high, low: x.low });
        else { d.high = Math.max(d.high, x.high); d.low = Math.min(d.low, x.low); }
      }
      return {
        time: Date.parse(`${wk}T04:00:00.000Z`), // Monday 00:00 ET — keys to `wk`
        open: bars[0].open,
        close: bars[bars.length - 1].close,
        high: Math.max(...bars.map((x) => x.high)),
        low: Math.min(...bars.map((x) => x.low)),
        days: Array.from(byDay.values()),
      };
    })
    .sort((a, b) => a.time - b.time);
}

// Weekly history from TastyTrade REST. Index route for SPX/NDX, stock route
// for equities. Futures (ESM/NQM) are handled by the dxLink path.
// (Name kept: the *Theta suffix is tt-snapshot's drop-in signature, not a
// provider. ThetaData was removed 2026-08-18.)
async function fetchWeeklyHistoryTheta(ticker, daysBack = 140) {
  const theta = require('./tt-snapshot');
  const end = new Date();
  const start = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  let daily;
  if (ticker === 'SPX' || ticker === 'NDX') {
    daily = await theta.fetchIndexDailyHistoryTheta(ticker, start, end);
  } else {
    daily = await theta.fetchStockDailyHistoryTheta(ticker, start, end);
  }
  return weeklyFromDaily(daily);
}

// Dispatch: futures stay on dxLink; index + equities pull from Theta.
// `ticker` is the candle ticker (SPX/NDX/ESM/NQM/equity), NOT the {=w} symbol.
async function fetchWeeklyHistory(engine, ticker, daysBack = 140) {
  if (ticker === 'ESM' || ticker === 'NQM') {
    return fetchWeeklyHistoryFutures(ticker, daysBack);
  }
  return fetchWeeklyHistoryTheta(ticker, daysBack);
}

// Zones for ONE ticker from last week's weekly candle. Shared by the weekly
// publisher and the on-demand /em-zones lookup so the math never drifts.
async function computeZonesForTicker(engine, ticker) {
  const targetWeek = getCompletedWeekKey();
  const bars = await fetchWeeklyHistory(engine, ticker);
  const exact = bars.find((i) => getWeekKey(new Date(i.time)) === targetWeek);
  // NO stale fallback. Previously this fell back to the newest available bar,
  // which silently published zones off an old (or rolled-contract) week — the
  // zones then sit hundreds of points from price with no error anywhere. If the
  // completed week's candle isn't there, fail loud so the publish is skipped.
  if (!exact) {
    const last = bars[bars.length - 1];
    const newest = last ? getWeekKey(new Date(last.time)) : 'none';
    throw new Error(`No weekly candle for ${ticker} week ${targetWeek} (newest=${newest})`);
  }

  // Futures weekly CLOSE = the official Friday settle, not the last 5m bar we
  // happened to record. es_candles stops at the last streamed bar (16:00-ish),
  // so its close ran ~5.75 pts hot vs the 17:00 ET settle and pushed the pivot
  // (and every zone) ~1.9 pts high. H/L from the bars are tick-exact; only the
  // close needs the settle. Falls back to the bar close if no settle is quoted.
  // Weekend-only: `prev-close` is Friday's settle on Sat/Sun, but midweek it's
  // just yesterday's settle — applying it then would corrupt the weekly close.
  // The publisher fires Sat 9am ET; weekday /em-zones lookups keep the bar close.
  const etDay = getEtNow().getDay();
  const isWeekend = etDay === 6 || etDay === 0;
  if ((ticker === 'ESM' || ticker === 'NQM') && isWeekend) {
    try {
      const quotes = await fetchAllQuotes(engine);
      const q = quotes[ticker] || {};
      const settle = Number(q['prev-close'] ?? q.prevClose ?? q['day-close']);
      if (Number.isFinite(settle) && settle > 0 && settle >= exact.low && settle <= exact.high) {
        return buildZoneLevels(ticker, [{ ...exact, close: settle }]);
      }
    } catch (e) {
      console.warn(`[levels] ${ticker} settle lookup failed, using bar close:`, e.message);
    }
  }
  return buildZoneLevels(ticker, [exact]);
}

// On-demand: zones for one ticker, formatted as the ticker_levels payload (same
// fields the weekly publisher writes). Used by /api/em-zones. `ticker` is the
// user/display symbol (e.g. AAPL, or ESU/NQU for futures rolls).
async function computeZonesPayload(base, ticker) {
  const engine = makeEngine(base);
  // Map display futures back to the candle symbol the zone math expects.
  const sym = ticker === 'ESU' ? 'ESM' : ticker === 'NQU' ? 'NQM' : ticker;
  const z = await computeZonesForTicker(engine, sym);
  const apiTicker = DISPLAY_LABEL[sym] ?? sym;
  return {
    ticker: apiTicker,
    label: apiTicker,
    pivot: fmtZone(sym, z.pivot),
    buy_near: fmtZone(sym, z.noShortNear),
    buy_far: fmtZone(sym, z.noShortFar),
    sell_near: fmtZone(sym, z.noLongNear),
    sell_far: fmtZone(sym, z.noLongFar),
  };
}

async function fetchNoShortNoLongZones(engine) {
  // Only the core ZONE_SYMBOLS are pre-published — zones are static for the week
  // (last week's OHLC), so the long-tail 200 compute zones on demand at lookup.
  // Resilient: a symbol with no weekly history must not abort the batch.
  const settled = await Promise.allSettled(
    ZONE_SYMBOLS.map((ticker) => computeZonesForTicker(engine, ticker))
  );
  return settled
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);
}

/**
 * Compute everything and return per-ticker payloads ready to POST to /api/levels.
 * EM rows for all SYMBOLS; buy/sell zones merged onto ESU/NQU.
 *
 * opts.only — optional array of RAW symbols (e.g. ['NVDA','BABA']) to restrict
 *   the roster. Used by the "retry not-found" path so a manual re-run recomputes
 *   only the tickers that failed, not all ~200.
 *
 * Returns { payloads, failReasons } where failReasons is a map of
 *   displayTicker -> short reason string for every requested symbol that did NOT
 *   produce an EM (either estimateMove threw, or it returned a null/empty em).
 */
async function computeAllLevels(base, opts = {}) {
  const engine = makeEngine(base);
  // The LIVE publish roster — em-tickers' file list with the owner Watchlists
  // page's EM overrides applied. Resolved once per run and stashed on the engine
  // so fetchAllQuotes sweeps quotes for exactly the names this run will publish.
  const full = await getActiveSymbols();
  engine.roster = full;
  // Subset roster for retries. opts.only may contain raw symbols OR display
  // labels (ESU/NQU). Keep a row if its raw name OR its display label is in the
  // wanted set — so a retry of "ESU" still maps to the raw ESM/ESU6 row.
  let roster = full;
  if (Array.isArray(opts.only) && opts.only.length) {
    const wanted = new Set(opts.only.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean));
    roster = full.filter((s) => wanted.has(s) || wanted.has(DISPLAY_LABEL[s] || s));
  }
  const failReasons = {}; // displayTicker -> reason

  // Known SPX expirations → pick the weekly target the EM calc uses.
  let knownExpirations = [];
  try {
    const json = await getJson(`${base}/api/expirations?ticker=SPX`);
    let raw = json.expirations || (json.data && (json.data.expirations || json.data.items)) || json.items || [];
    if (raw.length && typeof raw[0] === 'object') {
      raw = raw.map((e) => e['expiration-date'] || e.expirationDate || e.expiration || e.date || e);
    }
    const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    knownExpirations = raw.filter((e) => typeof e === 'string').filter((e) => e.slice(0, 10) >= todayET).sort();
  } catch (e) {
    console.log('[levels] expirations fetch failed:', e.message);
  }

  const targetExp = getTargetExpiration(knownExpirations, '');
  const expLabel = targetExp ? labelForDate(targetExp) : null;

  // Per-ticker EM, in small batches (mirrors client pacing).
  const byTicker = {};
  for (let i = 0; i < roster.length; i += 4) {
    const batch = roster.slice(i, i + 4);
    const results = await Promise.allSettled(batch.map((s) => estimateMove(s, targetExp, engine)));
    results.forEach((res, idx) => {
      const sym = batch[idx];
      const apiTicker = DISPLAY_LABEL[sym] ?? sym;
      if (res.status === 'fulfilled') {
        const row = res.value;
        const emStr = fmtEm(row.em);
        byTicker[apiTicker] = {
          ticker: apiTicker, label: apiTicker,
          close: fmtPrice(sym, row.close),
          em: emStr,
          up: fmtPrice(sym, row.up),
          down: fmtPrice(sym, row.down),
          exp_label: row.expiration ? labelForDate(row.expiration) : expLabel,
        };
        // Computed but the straddle didn't price → EM is null/empty.
        if (emStr == null || emStr === '') failReasons[apiTicker] = 'no EM (straddle unpriced)';
      } else {
        const reason = (res.reason && res.reason.message) || String(res.reason || 'failed');
        failReasons[apiTicker] = reason;
        console.log(`[levels] EM ${sym} failed: ${reason}`);
      }
    });
    if (i + 4 < roster.length) await new Promise((r) => setTimeout(r, 300));
  }

  // Zones for every symbol: noShort = Buy Zone, noLong = Sell Zone.
  // Skip on subset retries — zones are static for the week and already published;
  // a not-found retry only needs to recompute the missing EM rows.
  const isSubset = Array.isArray(opts.only) && opts.only.length;
  try {
    if (isSubset) throw { skip: true };
    const zones = await fetchNoShortNoLongZones(engine);
    zones.forEach((z) => {
      const apiTicker = DISPLAY_LABEL[z.ticker] ?? z.ticker;
      byTicker[apiTicker] = Object.assign({ ticker: apiTicker, label: apiTicker }, byTicker[apiTicker], {
        ticker: apiTicker, label: apiTicker,
        pivot: fmtZone(z.ticker, z.pivot),
        buy_near: fmtZone(z.ticker, z.noShortNear),
        buy_far: fmtZone(z.ticker, z.noShortFar),
        sell_near: fmtZone(z.ticker, z.noLongNear),
        sell_far: fmtZone(z.ticker, z.noLongFar),
      });
    });
  } catch (e) {
    if (!(e && e.skip)) console.log('[levels] zones failed:', e.message);
  }

  // targetExpLabel is the week the run was computed FOR ("7/31"). The publisher
  // uses it to blank the EM band on any row still carrying an older expiration,
  // so /em can never serve last week's (or a monthly's) straddle as this week's
  // move.
  return { payloads: Object.values(byTicker), failReasons, targetExpLabel: expLabel };
}

/**
 * Fetch the realized weekly CLOSE for one ticker for a given completed week key.
 * Uses the same dxLink weekly candles as the zone math. Returns the close of the
 * candle whose week == targetWeek (falls back to the latest <= targetWeek).
 */
async function fetchWeeklyClose(engine, ticker, targetWeek) {
  const bars = await fetchWeeklyHistory(engine, ticker);

  // A finalized weekly bar is anchored to the week's MONDAY open. While a week is
  // still trading, the feed also returns a SECOND, partial bar for that same week
  // (timestamped intraweek, e.g. Fri …T20:00:01Z) whose close is the live price —
  // NOT the realized weekly close. The old code did bars.find(week === target),
  // which grabbed whichever bar came first; when the evaluator ran early (before
  // the week finalized) that was the forming bar, scoring against a partial close
  // and flipping hit/miss. Fix: among bars for the target week, pick the one whose
  // timestamp IS the week's Monday boundary (the canonical weekly bar). If only a
  // forming/partial bar exists for the target week, refuse to score it.
  const weekStartMs = Date.parse(`${targetWeek}T04:00:00.000Z`); // Monday 00:00 ET
  const sameWeek = bars.filter((i) => getWeekKey(new Date(i.time)) === targetWeek);
  // Canonical = the bar anchored at (or before) the Monday open; among those, the
  // earliest-timestamped is the true weekly aggregate. Forming bars sit later.
  const canonical = sameWeek
    .filter((i) => i.time <= weekStartMs + 12 * 60 * 60 * 1000) // within Mon of week start
    .sort((a, b) => a.time - b.time)[0];

  // Refuse to score until the target week's trading has actually ended. The week
  // closes at Friday 16:00 ET; we require we're past that before trusting a close.
  // (Comparing week-keys is wrong here: on the Saturday scoring run, the completed
  // week and "now" share the same Monday, so a week-key check would reject the
  // legitimate run. We check the wall-clock Friday-close boundary instead.)
  const fridayCloseMs = Date.parse(`${targetWeek}T04:00:00.000Z`)  // Mon 00:00 ET
    + 4 * 24 * 60 * 60 * 1000   // → Friday 00:00 ET
    + 16 * 60 * 60 * 1000;      // → Friday 16:00 ET (cash close)
  if (Date.now() < fridayCloseMs) {
    throw new Error(`Week ${targetWeek} not yet closed for ${ticker} — refusing to score a forming candle`);
  }

  // Use the canonical (Monday-anchored) weekly bar. We deliberately do NOT fall
  // back to a forming same-week bar — scoring a partial close is exactly the bug
  // we're fixing. If the canonical bar for the target week is missing entirely,
  // fall back to the most recent OLDER completed week (better than nothing for a
  // backfill); never to an intraweek forming bar.
  const priorWeeks = bars.filter((i) => getWeekKey(new Date(i.time)) < targetWeek);
  const selected = canonical || priorWeeks[priorWeeks.length - 1] || null;
  if (!selected) throw new Error(`No finalized weekly candle for ${ticker} (week ${targetWeek})`);
  return { close: selected.close, high: selected.high, low: selected.low, open: selected.open, days: selected.days || [], week: getWeekKey(new Date(selected.time)) };
}

/**
 * Evaluate the just-completed week for every ticker that has a seeded em_tracker
 * row (week_start == completed week) still awaiting a result. For each, pull the
 * realized weekly close and decide:
 *
 *     win  = down <= close <= up        (closed INSIDE the EM band)
 *     loss = close < down or close > up (closed OUTSIDE)
 *
 * The band (up/down) was seeded the prior Saturday from that week's EM and
 * reference close, so there is no dependency on the current week's levels.
 *
 * POSTs realized OHLC + the close-based result to /api/em-tracker.
 */
async function evaluateCompletedWeek(base) {
  const engine = makeEngine(base);
  const completedWeek = getCompletedWeekKey();
  console.log(`[em-eval] evaluating completed week ${completedWeek}`);

  // Pull the rows seeded for that week that still need a result.
  let pending = [];
  try {
    const r = await ifetch(`${base}/api/em-tracker?week_start=${completedWeek}&status=pending`, {
      headers: process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
    });
    if (r.ok) pending = (await r.json()).rows || [];
  } catch (e) {
    console.log('[em-eval] fetch pending failed:', e.message);
  }
  if (!pending.length) { console.log('[em-eval] nothing seeded/pending for this week — skip'); return { evaluated: 0, hits: 0, misses: 0 }; }

  let hits = 0, misses = 0;
  for (let i = 0; i < pending.length; i += 4) {
    const batch = pending.slice(i, i + 4);
    const settled = await Promise.allSettled(batch.map(async (row) => {
      // Map the stored API ticker back to a weekly-candle symbol.
      const candleTicker = row.ticker === 'ESU' ? 'ESM' : row.ticker === 'NQU' ? 'NQM' : row.ticker;
      const { close, high, low, open, days } = await fetchWeeklyClose(engine, candleTicker, completedWeek);

      const up = Number(row.up);
      const down = Number(row.down);
      const em = Number(row.em);
      const ref = Number(row.ref_close);
      // Prefer explicit up/down band; fall back to ref +/- em.
      const hi = Number.isFinite(up) ? up : (Number.isFinite(ref) ? ref + em : null);
      const lo = Number.isFinite(down) ? down : (Number.isFinite(ref) ? ref - em : null);
      if (hi == null || lo == null) { console.log(`[em-eval] ${row.ticker}: no band, skip`); return; }

      const result = (close >= lo && close <= hi) ? 'hit' : 'miss';
      if (result === 'hit') hits += 1; else misses += 1;

      // Intraweek breach + the FIRST day it broke, from the week's daily bars.
      // Falls back to the weekly high/low when no per-day bars came through, so a
      // breach still registers (just without a day) rather than showing "no".
      let { breach, breach_day } = computeBreach(days, hi, lo);
      if (breach == null) breach = (high > hi || low < lo) ? 1 : 0;

      await ifetch(`${base}/api/em-tracker`, {
        method: 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {}
        ),
        body: JSON.stringify({
          ticker: row.ticker, week_label: row.week_label, week_start: completedWeek,
          em, ref_close: Number.isFinite(ref) ? ref : null,
          up: Number.isFinite(up) ? up : null, down: Number.isFinite(down) ? down : null,
          o: open, h: high, l: low, c: close,
          result, breach, breach_day, result_source: 'auto',
        }),
      });
      console.log(`[em-eval] ${row.ticker} ${row.week_label}: close ${close} band [${lo}, ${hi}] -> ${result}${breach ? ` (breach ${breach_day || 'day?'})` : ''}`);
    }));
    // Surface per-ticker failures instead of letting allSettled swallow them —
    // an empty weekly history or refused fetch now logs "TICKER skipped — reason".
    settled.forEach((s, j) => {
      if (s.status === 'rejected') console.log(`[em-eval] ${batch[j].ticker} skipped — ${(s.reason && s.reason.message) || s.reason}`);
    });
    if (i + 4 < pending.length) await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`[em-eval] done: ${hits} hit / ${misses} miss`);
  return { evaluated: hits + misses, hits, misses };
}

/**
 * Seed em_tracker rows for the UPCOMING week from freshly computed levels, so
 * next Saturday's evaluator has the band on record. Call right after the levels
 * publish. `payloads` is the array computeAllLevels() returns.
 */
async function seedUpcomingWeek(base, payloads) {
  const upcomingWeek = upcomingWeekKey(); // the coming Mon's week (internal join key — do not change)
  // Display label uses the week's FRIDAY (the expiration the EM band is actually
  // measured against), matching the legacy imported rows (e.g. "11/21" for the
  // week ending Fri 2025-11-21). week_start/upcomingWeek stays Monday-anchored
  // since evaluateCompletedWeek/getCompletedWeekKey match on that key.
  const fridayOfWeek = new Date(Date.parse(`${upcomingWeek}T12:00:00`) + 4 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const weekLabel = labelForDate(fridayOfWeek);
  const rows = payloads
    .filter((p) => p.em != null)
    .map((p) => ({
      ticker: p.ticker,
      week_label: weekLabel,
      week_start: upcomingWeek,
      em: Number(String(p.em).replace(/,/g, '')),
      ref_close: p.close != null ? Number(String(p.close).replace(/,/g, '')) : null,
      up: p.up != null ? Number(String(p.up).replace(/,/g, '')) : null,
      down: p.down != null ? Number(String(p.down).replace(/,/g, '')) : null,
      result_source: 'seed',
    }))
    .filter((r) => Number.isFinite(r.em) && r.em > 0);
  if (!rows.length) return 0;
  try {
    const r = await ifetch(`${base}/api/em-tracker`, {
      method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {}
      ),
      body: JSON.stringify({ rows }),
    });
    if (r.ok) { console.log(`[em-eval] seeded ${rows.length} rows for upcoming week ${upcomingWeek}`); return rows.length; }
  } catch (e) {
    console.log('[em-eval] seed failed:', e.message);
  }
  return 0;
}

/**
 * Fetch a deep weekly-candle history for one ticker (default ~3 years) and
 * return a map of weekKey -> { open, high, low, close } so historical weeks can
 * be looked up by their Monday ISO date.
 */
async function fetchWeeklyOhlcMap(engine, ticker, daysBack = 1100, count = 170) {
  let bars;
  if (ticker === 'ESM' || ticker === 'NQM') {
    // Deliberately still Yahoo here: this map is the ~3yr EM hit/miss BACKFILL,
    // and es_candles only goes back as far as the recorder. Zone publishing uses
    // fetchWeeklyHistoryFutures (broker bars) — do not "unify" these two.
    const start = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
    const url = `${engine.base}/api/dxlink/candles?symbol=${encodeURIComponent(zoneSymbol(ticker))}&start=${start}&count=${count}`;
    const r = await ifetch(url);
    if (!r.ok) throw new Error(`History failed for ${ticker}`);
    bars = parseHistoryItems(JSON.parse(await r.text()));
  } else {
    bars = await fetchWeeklyHistoryTheta(ticker, daysBack);
  }
  const map = {};
  for (const b of bars) map[getWeekKey(new Date(b.time))] = { open: b.open, high: b.high, low: b.low, close: b.close };
  return map;
}

/**
 * Historical backfill: for a set of { ticker, week_start, up, down } bands,
 * fetch each ticker's realized weekly OHLC for that week and compute:
 *   breach = high > up OR low < down   (intraweek poke outside the band)
 *   result = down <= close <= up ? 'hit' : 'miss'   (close-based win/loss)
 * POSTs the filled rows to /api/em-tracker. `bands` groups by ticker internally
 * so each ticker's deep history is fetched once.
 */
async function evaluateHistoricalWeeks(base, bands) {
  const engine = makeEngine(base);
  const byTicker = {};
  for (const b of bands) {
    const candleTicker = b.ticker === 'ESU' ? 'ESM' : b.ticker === 'NQU' ? 'NQM' : b.ticker;
    (byTicker[candleTicker] = byTicker[candleTicker] || []).push(b);
  }

  let hits = 0, misses = 0, breaches = 0, missingOhlc = 0, saved = 0;
  for (const [candleTicker, list] of Object.entries(byTicker)) {
    let ohlcMap = {};
    try { ohlcMap = await fetchWeeklyOhlcMap(engine, candleTicker); }
    catch (e) { console.log(`[em-hist] ${candleTicker} history failed: ${e.message}`); }

    for (const b of list) {
      const up = Number(b.up), down = Number(b.down);
      const em = Number.isFinite(b.em) ? Number(b.em) : (Number.isFinite(up) && Number.isFinite(down) ? (up - down) / 2 : null);
      const ref = Number.isFinite(b.ref_close) ? Number(b.ref_close) : (Number.isFinite(up) && Number.isFinite(down) ? (up + down) / 2 : null);
      const ohlc = ohlcMap[b.week_start];

      const row = {
        ticker: b.ticker, week_label: b.week_label, week_start: b.week_start,
        em: em != null ? em : 0,
        ref_close: ref, up, down,
        result_source: 'import',
      };

      if (ohlc) {
        const breach = (ohlc.high > up || ohlc.low < down) ? 1 : 0;
        const result = (ohlc.close >= down && ohlc.close <= up) ? 'hit' : 'miss';
        Object.assign(row, { o: ohlc.open, h: ohlc.high, l: ohlc.low, c: ohlc.close, breach, result });
        if (result === 'hit') hits++; else misses++;
        if (breach) breaches++;
      } else {
        missingOhlc++;
      }

      try {
        const resp = await ifetch(`${base}/api/em-tracker`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(row),
        });
        if (resp.ok) saved++;
      } catch (e) { console.log(`[em-hist] save ${b.ticker} ${b.week_start} failed: ${e.message}`); }
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[em-hist] saved ${saved} rows — ${hits} win / ${misses} loss, ${breaches} breaches, ${missingOhlc} no-OHLC`);
  return { saved, hits, misses, breaches, missingOhlc };
}

module.exports = {
  computeAllLevels, evaluateCompletedWeek, evaluateHistoricalWeeks, seedUpcomingWeek, SYMBOLS,
  computeZonesPayload, computeZonesForTicker,
};
