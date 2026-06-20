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

const SYMBOLS = [
  'ESM', 'NQM', 'SPY', 'QQQ', 'SPX', 'AAPL', 'AMD', 'AMZN', 'GOOGL',
  'META', 'MSFT', 'NVDA', 'TSLA', 'COIN', 'HOOD', 'IWM', 'NDX', 'NFLX', 'SMH', 'PLTR',
];

const DISPLAY_LABEL = { ESM: 'ESU', NQM: 'NQU', ESU6: 'ESU', NQM6: 'NQU' };
const API_SYMBOL = { ESM: '/ESU26', NQM: '/NQ:XCME', SPX: '$SPX', NDX: '$NDX' };
const CHAIN_SYMBOL = { SPX: '$SPX', NDX: '$NDX' };
const FUTURE_PROXY = { ESM: 'SPX', NQM: 'NDX' };

// dxLink weekly-candle symbol for the zone math (mirrors the client zoneSymbol).
const ZONE_HISTORY_SYMBOL = { ESM: '/ESU6{=w}', NQM: '/NQ{=w}' };
function zoneSymbol(ticker) {
  if (ZONE_HISTORY_SYMBOL[ticker]) return ZONE_HISTORY_SYMBOL[ticker];
  if (ticker === 'SPX') return '$SPX{=w}';
  if (ticker === 'NDX') return '$NDX{=w}';
  return `${ticker}{=w}`;
}
const QUOTE_SYMBOLS = Array.from(new Set([
  ...SYMBOLS, ...Object.values(API_SYMBOL), '/ESU26', '/NQU26', 'VIX',
]));

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

// ── chain normalization (verbatim port) ─────────────────────────────────────
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
  return { base, quoteCache: {}, quoteCacheTime: 0, directChainCache: {}, emClosesCache: null };
}

async function getJson(url) {
  const r = await ifetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function fetchAllQuotes(engine) {
  if (Date.now() - engine.quoteCacheTime < 5000) return engine.quoteCache;
  const json = await getJson(`${engine.base}/api/quotes-batch?symbols=${encodeURIComponent(QUOTE_SYMBOLS.join(','))}`);
  const items = (json && json.data && json.data.items) || [];
  const map = {};
  items.forEach((q) => { map[q.symbol] = q; });
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
  let close = isFutures && dayClose > 0 ? dayClose
    : isIndex && prevClose > 0 ? prevClose
    : Number(q.last || q.mark || ((q.bid + q.ask) / 2));
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
  const { close, prevClose } = await fetchQuoteDetail(ticker, engine);
  if (!Number.isFinite(close) || close <= 0) throw new Error('No quote');
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
  const isPriced = (o) => (o.bid > 0 && o.ask > 0) || o.mark > 0 || Number(o.iv || 0) > 0;
  let effectiveExp = targetExp;
  let expOptions = options.filter((o) => o.expiration === effectiveExp);
  if (!expOptions.length || !expOptions.some(isPriced)) {
    const unpinned = await ifetch(`${engine.base}/api/chains?ticker=${encodeURIComponent(chainSym)}`)
      .then((r) => (r.ok ? r.json() : { options: [] })).catch(() => ({ options: [] }));
    const merged = normalizeOptions(unpinned);
    if (merged.length) options = merged;
    const pricedExps = [...new Set(options.filter(isPriced).map((o) => o.expiration))].filter(Boolean).sort();
    const allExps = [...new Set(options.map((o) => o.expiration))].filter(Boolean).sort();
    const pool = pricedExps.length ? pricedExps : allExps;
    const snapped = pool.find((e) => e >= targetExp) || pool[pool.length - 1];
    if (snapped) { effectiveExp = snapped; expOptions = options.filter((o) => o.expiration === effectiveExp); }
  }
  if (!expOptions.length) throw new Error('No options for expiration');

  if (expOptions.every((o) => Number(o.iv || 0) === 0)) {
    const direct = await fetchChainDirect(engine, chainSym, effectiveExp);
    if (direct) expOptions = direct;
  }

  const indexQuote = isFuture ? await fetchQuoteDetail(lookupSym, engine) : null;
  const indexClose = isFuture ? (indexQuote.prevClose > 0 ? indexQuote.prevClose : indexQuote.close) : close;

  const strikes = [...new Set(expOptions.map((o) => o.strike))]
    .sort((a, b) => Math.abs(a - indexClose) - Math.abs(b - indexClose));
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
      if (!(c.bid > 0 && c.ask > 0) || !(p.bid > 0 && p.ask > 0)) {
        if (c.symbol || p.symbol) {
          const marks = await fetchOptionMarks(engine, [c.symbol, p.symbol].filter(Boolean));
          if (marks[c.symbol]) c = Object.assign({}, c, marks[c.symbol]);
          if (marks[p.symbol]) p = Object.assign({}, p, marks[p.symbol]);
          avgIV = (Number((c && c.iv) || 0) + Number((p && p.iv) || 0)) / 2;
        }
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

  const basis = isFuture ? close - indexClose : 0;
  void prevClose;
  return { ticker, close, em, up: indexClose + em + basis, down: indexClose - em + basis, expiration: effectiveExp, strike };
}

async function fetchWeeklyHistory(engine, symbol) {
  const start = Date.now() - (140 * 24 * 60 * 60 * 1000);
  const url = `${engine.base}/api/dxlink/candles?symbol=${encodeURIComponent(symbol)}&start=${start}&count=12`;
  const r = await ifetch(url);
  const text = await r.text();
  if (!r.ok) throw new Error(`History failed for ${symbol}`);
  return parseHistoryItems(JSON.parse(text));
}

async function fetchNoShortNoLongZones(engine) {
  const targetWeek = getCompletedWeekKey();
  // Every symbol on the Estimated Moves page, each via its dxLink weekly symbol.
  const configs = SYMBOLS.map((ticker) => ({ ticker, historySymbol: zoneSymbol(ticker) }));
  // Resilient: a symbol with no weekly history must not abort the batch.
  const settled = await Promise.allSettled(configs.map(async ({ ticker, historySymbol }) => {
    const bars = await fetchWeeklyHistory(engine, historySymbol);
    const exact = bars.find((i) => getWeekKey(new Date(i.time)) === targetWeek);
    const candidates = bars.filter((i) => getWeekKey(new Date(i.time)) <= targetWeek);
    const selected = exact || candidates[candidates.length - 1] || bars[bars.length - 1];
    if (!selected) throw new Error(`No weekly candles for ${ticker}`);
    return buildZoneLevels(ticker, [selected]);
  }));
  return settled
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);
}

/**
 * Compute everything and return an array of per-ticker payloads ready to POST
 * to /api/levels. EM rows for all SYMBOLS; buy/sell zones merged onto ESU/NQU.
 */
async function computeAllLevels(base) {
  const engine = makeEngine(base);

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
  for (let i = 0; i < SYMBOLS.length; i += 4) {
    const batch = SYMBOLS.slice(i, i + 4);
    const results = await Promise.allSettled(batch.map((s) => estimateMove(s, targetExp, engine)));
    results.forEach((res, idx) => {
      const sym = batch[idx];
      const apiTicker = DISPLAY_LABEL[sym] ?? sym;
      if (res.status === 'fulfilled') {
        const row = res.value;
        byTicker[apiTicker] = {
          ticker: apiTicker, label: apiTicker,
          close: fmtPrice(sym, row.close),
          em: fmtEm(row.em),
          up: fmtPrice(sym, row.up),
          down: fmtPrice(sym, row.down),
          exp_label: row.expiration ? labelForDate(row.expiration) : expLabel,
        };
      } else {
        console.log(`[levels] EM ${sym} failed: ${(res.reason && res.reason.message) || res.reason}`);
      }
    });
    if (i + 4 < SYMBOLS.length) await new Promise((r) => setTimeout(r, 300));
  }

  // Zones for every symbol: noShort = Buy Zone, noLong = Sell Zone.
  try {
    const zones = await fetchNoShortNoLongZones(engine);
    zones.forEach((z) => {
      const apiTicker = DISPLAY_LABEL[z.ticker] ?? z.ticker;
      byTicker[apiTicker] = Object.assign({ ticker: apiTicker, label: apiTicker }, byTicker[apiTicker], {
        ticker: apiTicker, label: apiTicker,
        pivot: fmtFuture(z.pivot),
        buy_near: fmtFuture(z.noShortNear),
        buy_far: fmtFuture(z.noShortFar),
        sell_near: fmtFuture(z.noLongNear),
        sell_far: fmtFuture(z.noLongFar),
      });
    });
  } catch (e) {
    console.log('[levels] zones failed:', e.message);
  }

  return Object.values(byTicker);
}

/**
 * Fetch the realized weekly CLOSE for one ticker for a given completed week key.
 * Uses the same dxLink weekly candles as the zone math. Returns the close of the
 * candle whose week == targetWeek (falls back to the latest <= targetWeek).
 */
async function fetchWeeklyClose(engine, ticker, targetWeek) {
  const bars = await fetchWeeklyHistory(engine, zoneSymbol(ticker));
  const exact = bars.find((i) => getWeekKey(new Date(i.time)) === targetWeek);
  const candidates = bars.filter((i) => getWeekKey(new Date(i.time)) <= targetWeek);
  const selected = exact || candidates[candidates.length - 1] || bars[bars.length - 1];
  if (!selected) throw new Error(`No weekly candle for ${ticker}`);
  return { close: selected.close, high: selected.high, low: selected.low, open: selected.open, week: getWeekKey(new Date(selected.time)) };
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
    const r = await ifetch(`${base}/api/em-tracker?week_start=${completedWeek}&status=pending`);
    if (r.ok) pending = (await r.json()).rows || [];
  } catch (e) {
    console.log('[em-eval] fetch pending failed:', e.message);
  }
  if (!pending.length) { console.log('[em-eval] nothing seeded/pending for this week — skip'); return { evaluated: 0, hits: 0, misses: 0 }; }

  let hits = 0, misses = 0;
  for (let i = 0; i < pending.length; i += 4) {
    const batch = pending.slice(i, i + 4);
    await Promise.allSettled(batch.map(async (row) => {
      // Map the stored API ticker back to a weekly-candle symbol.
      const candleTicker = row.ticker === 'ESU' ? 'ESM' : row.ticker === 'NQU' ? 'NQM' : row.ticker;
      const { close, high, low, open } = await fetchWeeklyClose(engine, candleTicker, completedWeek);

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
          result, result_source: 'auto',
        }),
      });
      console.log(`[em-eval] ${row.ticker} ${row.week_label}: close ${close} band [${lo}, ${hi}] -> ${result}`);
    }));
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
  const upcomingWeek = getWeekKey(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)); // the coming Mon's week
  const weekLabel = labelForDate(upcomingWeek);
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
  const start = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
  const url = `${engine.base}/api/dxlink/candles?symbol=${encodeURIComponent(zoneSymbol(ticker))}&start=${start}&count=${count}`;
  const r = await ifetch(url);
  if (!r.ok) throw new Error(`History failed for ${ticker}`);
  const bars = parseHistoryItems(JSON.parse(await r.text()));
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
};
