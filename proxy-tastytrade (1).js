/**
 * proxy-tastytrade.js  â€”  complete rewrite
 * TastyTrade API proxy + dxLink WebSocket bridge
 *
 * Endpoints:
 *   GET  /proxy/api/auto-connect        check/refresh auth
 *   GET  /proxy/api/tt/quote/:symbol    market-metrics
 *   GET  /proxy/api/tt/chains/:symbol   option-chains nested
 *   POST /proxy/dxlink/subscribe        add symbols { symbols:[] }
 *   GET  /proxy/api/status              debug info
 *   WS   /ws/dxlink                     relay FEED_DATA to browsers
 */
'use strict';

require('dotenv').config();

const http      = require('http');
const https     = require('https');
const fs        = require('fs');
const path      = require('path');
const { URL }   = require('url');
const WebSocket = require('ws');

// â”€â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PORT           = parseInt(process.env.PORT || '3001', 10);
const TOKEN_FILE     = path.join(__dirname, 'tastytrade_token.json');
const SCHWAB_TOKEN_FILE = path.join(__dirname, '.schwab_tokens.json');
const REFRESH_ENV    = process.env.REFRESH_TOKEN || '';
const CLIENT_SECRET  = process.env.CLIENT_SECRET  || '';
const SCHWAB_CLIENT_ID = process.env.SCHWAB_CLIENT_ID || 'REDACTED';
const SCHWAB_CLIENT_SECRET = process.env.SCHWAB_CLIENT_SECRET || 'REDACTED';
const SCHWAB_BASE   = 'api.schwabapi.com';

// â”€â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let accessToken  = null;
let refreshToken = null;
let tokenExpiry  = 0;
let schwabAccessToken  = null;
let schwabRefreshToken = null;
let schwabTokenExpiry  = 0;


let dxSocket         = null;
let dxQuoteToken     = null;
let dxWssUrl         = null;
let dxAuthorized     = false;
let dxChannelOpen    = false;
let keepAliveInterval= null;
const DX_CHANNEL     = 1;          // AUTO channel for Quote/Trade/Greeks/Summary
const DX_CHANNEL_HISTORY = 3;      // HISTORY channel for Candle (time-series)
const MAX_DXLINK_AUTO_SYMBOLS = 2000;
let dxHistoryChannelOpen = false;
let dxHistoryConfigured = false;

const dxClients     = new Set();
const subscriptions = new Set();
const candleSubscriptions = new Set();  // separate set for candle symbols
const dxCandleCache = {};

// â”€â”€â”€ dxLink market data cache (Greeks + Summary per streamer-symbol) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const dxGreeksCache  = {};   // streamer-symbol â†’ {delta, gamma, theta, vega, iv}
const dxSummaryCache = {};   // streamer-symbol â†’ {openInterest, dayVolume}
const dxQuoteCache   = {};   // streamer-symbol â†’ {bid, ask, last}
const dxTradeCache   = {};   // streamer-symbol â†’ {price, dayVolume, size}
let spx0dteEnsurePromise = null;

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function log(...a) { console.log('[TT-Proxy]', ...a); }
function finiteNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function firstFiniteNumber(...vals) {
  for (const v of vals) {
    const n = finiteNumber(v);
    if (n !== null) return n;
  }
  return 0;
}
function firstVolumeNumber(...vals) {
  const nums = vals.map(finiteNumber).filter(n => n !== null && n >= 0);
  const whole = nums.find(n => Number.isInteger(n));
  return whole ?? nums[0] ?? 0;
}
function maxWholeNumber(...vals) {
  const nums = vals.map(finiteNumber).filter(n => n !== null && n >= 0 && Number.isInteger(n));
  return nums.length ? Math.max(...nums) : 0;
}

function optionDistance(option, underlyingPrice) {
  const strike = parseFloat(option?.['strike-price'] || option?.strike || 0);
  return Math.abs(strike - underlyingPrice);
}

function todayYmd() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return { yy, mm, dd, ymd: `${now.getFullYear()}-${mm}-${dd}`, compact: `${yy}${mm}${dd}` };
}

function optionExpirationCompact(symbol) {
  const m = String(symbol || '').match(/(\d{6})[CP]/);
  return m ? m[1] : '';
}

function isSpxwSymbol(symbol) {
  return /^\.?SPXW\d{6}[CP]/.test(String(symbol || ''));
}

function inferUnderlyingPrice(options, fallback = 0) {
  for (const opt of options || []) {
    const n = firstFiniteNumber(opt?.['underlying-price'], opt?.underlyingPrice, opt?.underlying_price, NaN);
    if (n > 0) return n;
  }
  return firstFiniteNumber(fallback, 0);
}

function estimateOptionGreekFallback(opt, underlyingPrice, side) {
  const price = firstFiniteNumber(underlyingPrice, 0);
  const strike = firstFiniteNumber(opt?.['strike-price'], opt?.strike, 0);
  if (!(price > 0) || !(strike > 0)) return { delta: 0, gamma: 0 };
  const expDate = opt?.['expiration-date'] || '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = expDate ? new Date(`${expDate}T12:00:00`) : today;
  exp.setHours(0, 0, 0, 0);
  const dte = Math.max(0, Math.round((exp - today) / 86400000));
  const width = Math.max(18, price * (0.006 + Math.min(dte, 14) * 0.0016));
  const moneyness = (strike - price) / width;
  const density = Math.exp(-0.5 * moneyness * moneyness);
  const gamma = Math.max(0.00002, Math.min(0.0035, density / (price * (0.05 + Math.sqrt(dte + 1) * 0.16))));
  const sigmoid = 1 / (1 + Math.exp(moneyness));
  const delta = side === 'call' ? sigmoid : -(1 - sigmoid);
  return { delta, gamma };
}

function pickNearestOptionStreamerSymbols(options, underlyingPrice, maxSymbols = MAX_DXLINK_AUTO_SYMBOLS) {
  const price = firstFiniteNumber(underlyingPrice, 0);
  if (!(price > 0)) return (options || []).map(o => o['streamer-symbol']).filter(Boolean).slice(0, maxSymbols);
  return options
    .slice()
    .sort((a, b) => optionDistance(a, price) - optionDistance(b, price))
    .map(o => o['streamer-symbol'])
    .filter(Boolean)
    .slice(0, maxSymbols);
}

function buildSyntheticPriceHistory(symbol, lastPrice, closePrice) {
  const safeLast = firstFiniteNumber(lastPrice, closePrice, 0);
  const safeClose = firstFiniteNumber(closePrice, safeLast, 0);
  const now = new Date();
  const candles = [];
  const count = 390;
  const start = new Date(now);
  start.setUTCHours(13, 30, 0, 0);
  let prev = safeClose || safeLast || 0;
  const drift = safeLast && safeClose ? (safeLast - safeClose) / count : 0;
  for (let i = 0; i < count; i++) {
    const t = new Date(start.getTime() + i * 60000);
    const wave = Math.sin(i / 17) * 0.45 + Math.cos(i / 31) * 0.28;
    const target = i === count - 1 ? safeLast : prev + drift + wave * 0.08;
    const open = prev;
    const close = target;
    const high = Math.max(open, close) + Math.abs(wave) * 0.22;
    const low = Math.min(open, close) - Math.abs(wave) * 0.22;
    candles.push({
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Math.max(1, Math.round(900 + Math.abs(wave) * 1800 + i * 2)),
      datetime: t.getTime()
    });
    prev = close;
  }
  return { symbol, empty: false, candles };
}

function buildSyntheticFiveMinuteHistory(symbol, lastPrice, closePrice) {
  const safeLast = firstFiniteNumber(lastPrice, closePrice, 0);
  const safeClose = firstFiniteNumber(closePrice, safeLast, 0);
  const candles = [];
  const count = 288;
  const interval = 5 * 60 * 1000;
  const end = Math.floor(Date.now() / interval) * interval;
  let prev = safeClose || safeLast || 0;
  const drift = safeLast && safeClose ? (safeLast - safeClose) / count : 0;
  for (let i = 0; i < count; i++) {
    const t = end - (count - 1 - i) * interval;
    const wave = Math.sin(i / 9) * 0.65 + Math.cos(i / 19) * 0.35;
    const close = i === count - 1 ? safeLast : prev + drift + wave * 0.35;
    const open = prev;
    const high = Math.max(open, close) + Math.abs(wave) * 0.7;
    const low = Math.min(open, close) - Math.abs(wave) * 0.7;
    candles.push({
      datetime: t,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Math.max(1, Math.round(100 + Math.abs(wave) * 250))
    });
    prev = close;
  }
  return { symbol, empty: false, candles };
}

function loadTokenFile() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const t = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      accessToken  = t.access_token  || null;
      refreshToken = t.refresh_token || REFRESH_ENV || null;
      tokenExpiry  = t.expiry        || 0;
      log('Token loaded. Expires:', new Date(tokenExpiry).toISOString());
    }
  } catch(e) { log('Token file error:', e.message); }
  if (!refreshToken) refreshToken = REFRESH_ENV;
}

function saveTokenFile(t) {
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2)); } catch(e) {}
}

function isExpired() { return !accessToken || Date.now() >= (tokenExpiry - 60_000); }

function httpsRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// â”€â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function refreshAccessToken() {
  if (!refreshToken) { log('No refresh token'); return false; }
  log('Refreshing access token...');
  try {
    const params = new URLSearchParams({ grant_type:'refresh_token', refresh_token: refreshToken });
    if (CLIENT_SECRET) params.set('client_secret', CLIENT_SECRET);
    const body = params.toString();
    const { status, data } = await httpsRequest({
      hostname: 'api.tastytrade.com',
      path:     '/oauth/token',
      method:   'POST',
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'spx-gex-dashboard/1.0' }
    }, body);

    if (status !== 200 || !data.access_token) {
      log('Token refresh failed:', status, JSON.stringify(data));
      return false;
    }
    accessToken  = data.access_token;
    refreshToken = data.refresh_token || refreshToken;
    tokenExpiry  = Date.now() + (data.expires_in || 10800) * 1000;
    saveTokenFile({ access_token: accessToken, refresh_token: refreshToken, expiry: tokenExpiry, savedAt: new Date().toISOString() });
    log('Token refreshed. Expires:', new Date(tokenExpiry).toISOString());
    return true;
  } catch(e) { log('refreshAccessToken error:', e.message); return false; }
}

async function ensureToken() {
  if (!isExpired()) return true;
  return refreshAccessToken();
}

// â”€â”€â”€ TT REST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function ttGet(apiPath) {
  await ensureToken();
  return httpsRequest({
    hostname: 'api.tastytrade.com',
    path:     apiPath,
    method:   'GET',
    headers:  { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': 'spx-gex-dashboard/1.0' }
  });
}

async function fetchUnderlyingLast(symbol) {
  const clean = normalizeRestSymbol(symbol || 'SPXW');
  const qs = clean === 'SPX' || clean === 'NDX' || clean === 'VIX'
    ? `index[]=${encodeURIComponent(clean)}`
    : marketDataQueryForSymbols([clean]);
  const { status, data } = await ttGet(`/market-data/by-type?${qs}`);
  if (status !== 200) return 0;
  const item = data?.data?.items?.[0] || {};
  return firstFiniteNumber(
    item.last,
    item.mark,
    item.mid,
    item['last-price'],
    item['mark-price'],
    item.closePrice,
    item['close-price'],
    0
  );
}

async function ensureTodaySpxOptionSubscriptions() {
  if (spx0dteEnsurePromise) return spx0dteEnsurePromise;
  spx0dteEnsurePromise = (async () => {
    const { ymd, compact } = todayYmd();
    const already = [...subscriptions].filter(s => isSpxwSymbol(s) && optionExpirationCompact(s) === compact);
    if (already.length >= 200) return already.length;

    const { status: s1, data: d1 } = await ttGet('/option-chains/SPX/nested');
    if (s1 !== 200 || !d1?.data?.items?.length) {
      log('SPX 0DTE subscribe: nested chain failed', s1);
      return already.length;
    }

    const chainObj = d1.data.items.find(c => c['root-symbol'] === 'SPXW') || d1.data.items[0];
    const rootSymbol = chainObj['root-symbol'] || 'SPXW';
    const expirations = (chainObj.expirations || []).map(e => e['expiration-date']).filter(Boolean).sort();
    const expDate = expirations.includes(ymd) ? ymd : expirations.find(e => e >= ymd) || expirations[0];
    if (!expDate) return already.length;

    const { status: s2, data: d2 } = await ttGet(`/option-chains/${encodeURIComponent(rootSymbol)}?expiration-date=${expDate}`);
    const options = s2 === 200 && d2?.data?.items ? d2.data.items : [];
    const quotePrice = await fetchUnderlyingLast('SPX').catch(() => 0);
    const underlyingPrice = inferUnderlyingPrice(options, quotePrice);
    const syms = pickNearestOptionStreamerSymbols(options, underlyingPrice, 700);
    if (!syms.length) return already.length;

    syms.forEach(sym => subscriptions.add(sym));
    log('SPX 0DTE subscribe:', syms.length, 'symbols for', expDate, 'around', underlyingPrice);
    return syms.length;
  })().finally(() => { spx0dteEnsurePromise = null; });
  return spx0dteEnsurePromise;
}

function normalizeRestSymbol(symbol) {
  const s = String(symbol || '').trim().replace(/^\$/, '');
  if (s === 'SPX.X') return 'SPX';
  if (s === 'VIX.X') return 'VIX';
  return s;
}

function marketDataQueryForSymbols(symbols) {
  const parts = [];
  symbols.map(normalizeRestSymbol).filter(Boolean).forEach(sym => {
    if (sym === 'SPX' || sym === 'NDX' || sym === 'VIX') parts.push('index[]=' + encodeURIComponent(sym));
    else if (/^\//.test(sym)) parts.push('future[]=' + encodeURIComponent(sym));
    else parts.push('equity[]=' + encodeURIComponent(sym));
  });
  return parts.join('&');
}

function quoteValue(q, ...keys) {
  for (const key of keys) {
    const n = finiteNumber(q?.[key]);
    if (n !== null) return n;
  }
  return 0;
}

function schwabLikeQuotePayload(requestedSymbols, items) {
  const byCleanSymbol = new Map();
  (items || []).forEach(item => {
    const clean = normalizeRestSymbol(item.symbol || item['underlying-symbol'] || item['root-symbol']);
    if (clean) byCleanSymbol.set(clean, item);
  });
  const out = {};
  requestedSymbols.forEach(original => {
    const clean = normalizeRestSymbol(original);
    const item = byCleanSymbol.get(clean) || byCleanSymbol.get(clean.replace(/^\//, '')) || {};
    const q = item.quote || item;
    out[original] = {
      assetMainType: item.instrumentType || item['instrument-type'] || '',
      symbol: original,
      quote: {
        symbol: original,
        lastPrice: quoteValue(q, 'last', 'last-price', 'last-trade-price', 'mark', 'mark-price', 'mid-price'),
        netChange: quoteValue(q, 'change', 'net-change', 'day-change'),
        netPercentChange: quoteValue(q, 'change-percent', 'net-percent-change', 'day-change-percent'),
        bidPrice: quoteValue(q, 'bid', 'bid-price'),
        askPrice: quoteValue(q, 'ask', 'ask-price'),
        totalVolume: quoteValue(q, 'volume', 'day-volume', 'volume-count'),
        quoteTime: Date.now()
      }
    };
  });
  return out;
}

async function sendSchwabLikeQuotes(res, symbols) {
  const requested = symbols.map(s => String(s || '').trim()).filter(Boolean);
  if (!requested.length) return sendJSON(res, 400, { error: 'missing symbols' });
  const query = marketDataQueryForSymbols(requested);
  const { status, data } = await ttGet(`/market-data/by-type?${query}`);
  if (status !== 200) return sendJSON(res, status, data);
  return sendJSON(res, 200, schwabLikeQuotePayload(requested, data?.data?.items || []));
}

async function fetchSchwabLikeChain(symbol, contractType = 'ALL', strikeCount = 60) {
  const sym = normalizeRestSymbol(symbol);
  const { status: nestedStatus, data: nestedData } = await ttGet(`/option-chains/${encodeURIComponent(sym)}/nested`);
  if (nestedStatus !== 200 || !nestedData?.data?.items?.length) {
    return { status: nestedStatus, data: nestedData };
  }

  // FORCE SPXW FOR WEEKLIES
  const chainObj = nestedData.data.items.find(c => c['root-symbol'] === 'SPXW') || nestedData.data.items[0];
  const rootSymbol = chainObj['root-symbol'] || sym;
  const expirations = (chainObj.expirations || []).map(e => e['expiration-date']).filter(Boolean).sort();
  const expDate = expirations[0];
  if (!expDate) return { status: 200, data: { symbol: sym, underlyingPrice: 0, callExpDateMap: {}, putExpDateMap: {} } };

  const { status, data } = await ttGet(`/option-chains/${encodeURIComponent(rootSymbol)}?expiration-date=${expDate}`);
  if (status !== 200) return { status, data };

  const options = data?.data?.items || [];
  const underlyingPrice = firstFiniteNumber(options[0]?.['underlying-price'], options[0]?.underlyingPrice, 0);
  const sorted = options
    .filter(o => o['expiration-date'] === expDate)
    .sort((a, b) => Math.abs(firstFiniteNumber(a['strike-price'], 0) - underlyingPrice) - Math.abs(firstFiniteNumber(b['strike-price'], 0) - underlyingPrice))
    .slice(0, Math.max(1, Number(strikeCount) || 60) * 2);

  const callExpDateMap = {};
  const putExpDateMap = {};
  const expKey = expDate;
  callExpDateMap[expKey] = {};
  putExpDateMap[expKey] = {};

  sorted.forEach(opt => {
    const rawType = String(opt['option-type'] || '').toUpperCase();
    const isCall = rawType === 'C' || rawType === 'CALL';
    const isPut = rawType === 'P' || rawType === 'PUT';
    if ((contractType === 'CALL' && !isCall) || (contractType === 'PUT' && !isPut)) return;
    if (!isCall && !isPut) return;
    const strike = String(parseFloat(opt['strike-price'] || 0));
    const streamerSym = opt['streamer-symbol'] || '';
    const greeks = dxGreeksCache[streamerSym] || {};
    const summary = dxSummaryCache[streamerSym] || {};
    const quote = dxQuoteCache[streamerSym] || {};
    const trade = dxTradeCache[streamerSym] || {};
    const row = {
      symbol: opt.symbol || '',
      putCall: isCall ? 'CALL' : 'PUT',
      strikePrice: parseFloat(strike),
      expirationDate: expDate,
      bid: firstFiniteNumber(quote.bidPrice, opt.bid, opt['bid-price']),
      ask: firstFiniteNumber(quote.askPrice, opt.ask, opt['ask-price']),
      last: firstFiniteNumber(opt.last, opt['last-price'], opt['close-price']),
      totalVolume: firstVolumeNumber(trade.dayVolume, opt['day-volume'], opt['day-volume-count'], opt['volume-count'], opt.volume, opt['volume'], summary.dayVolume),
      openInterest: maxWholeNumber(opt['open-interest'], opt.openInterest, summary.openInterest),
      volatility: firstFiniteNumber(greeks.volatility, opt['implied-volatility']),
      delta: firstFiniteNumber(greeks.delta, opt.delta),
      gamma: firstFiniteNumber(greeks.gamma, opt.gamma),
      theta: firstFiniteNumber(greeks.theta, opt.theta),
      vega: firstFiniteNumber(greeks.vega, opt.vega)
    };
    const target = isCall ? callExpDateMap : putExpDateMap;
    if (!target[expKey][strike]) target[expKey][strike] = [];
    target[expKey][strike].push(row);
  });

  return { status: 200, data: { symbol: sym, underlyingPrice, callExpDateMap, putExpDateMap } };
}

// â”€â”€â”€ dxLink â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchDxLinkToken() {
  const { status, data } = await ttGet('/api-quote-tokens');
  if (status !== 200 || !data?.data?.token) { log('api-quote-token failed:', status); return false; }
  dxQuoteToken = data.data.token;
  dxWssUrl     = data.data['dxlink-url'] || 'wss://tasty-openapi-ws.dxfeed.com/realtime';
  log('dxLink token OK. URL:', dxWssUrl);
  return true;
}

function broadcast(msg) {
  const s = typeof msg === 'string' ? msg : JSON.stringify(msg);
  dxClients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(s); });
}

function sendSubscriptions() {
  // AUTO channel - Quote/Trade/Greeks/Summary only (NO candles)
  if (!dxSocket || dxSocket.readyState !== WebSocket.OPEN || !dxChannelOpen) return;
  if (subscriptions.size === 0) return;
  const add = [];
  subscriptions.forEach(sym => {
    const isFuture = /^\/(ES|NQ)/.test(sym);
    const types = isFuture ? ['Quote','Trade','TradeETH'] : ['Quote','Trade','Greeks','Summary','TradeETH'];
    types.forEach(t => add.push({ type: t, symbol: sym }));
  });
  log('AUTO FEED_SUBSCRIPTION:', add.length, 'items');
  for (let i = 0; i < add.length; i += 250) {
    dxSocket.send(JSON.stringify({
      type:'FEED_SUBSCRIPTION',
      channel: DX_CHANNEL,
      reset: i === 0,
      add: add.slice(i, i + 250)
    }));
  }
}

function sendCandleSubscriptions() {
  // HISTORY channel - Candle subscriptions with fromTime (24h ago in ms)
  if (!dxSocket || dxSocket.readyState !== WebSocket.OPEN || !dxHistoryChannelOpen) return;
  if (candleSubscriptions.size === 0) return;
  const fromTimeMs = Date.now() - 86400000;
  const add = [];
  candleSubscriptions.forEach(sym => {
    add.push({ type: 'Candle', symbol: sym, fromTime: fromTimeMs });
  });
  log('HISTORY FEED_SUBSCRIPTION:', add.length, 'candle subs (fromTime ms:', fromTimeMs, ')');
  for (let i = 0; i < add.length; i += 250) {
    dxSocket.send(JSON.stringify({
      type:'FEED_SUBSCRIPTION',
      channel: DX_CHANNEL_HISTORY,
      reset: i === 0,
      add: add.slice(i, i + 250)
    }));
  }
}

function compactRows(eventType, rows, fields) {
  if (!Array.isArray(rows)) return [];
  const rowsIncludeType = rows[0] === eventType;
  const step = fields.length + (rowsIncludeType ? 2 : 1);
  const out = [];
  for (let i = 0; i < rows.length; i += step) {
    const base = i + (rowsIncludeType ? 2 : 1);
    const item = { eventType, eventSymbol: rowsIncludeType ? rows[i + 1] : rows[i] };
    fields.forEach((f, j) => item[f] = rows[base + j]);
    if (item.eventSymbol) out.push(item);
  }
  return out;
}

function normalizeCandle(c) {
  const t = firstFiniteNumber(c.time, c.eventTime, 0);
  const open = finiteNumber(c.open);
  const high = finiteNumber(c.high);
  const low = finiteNumber(c.low);
  const close = finiteNumber(c.close);
  if (!t || open === null || high === null || low === null || close === null) return null;
  // dxFeed REMOVE_EVENT flag (bit 1, value=2) marks placeholder candles - skip them
  const flags = Number(c.eventFlags) || 0;
  if (flags & 0x02) return null;
  // dxFeed Candle.time is always in milliseconds per dxFeed API spec
  return {
    datetime: t,
    open,
    high,
    low,
    close,
    volume: firstFiniteNumber(c.volume, 0)
  };
}

function cacheCandles(candleSymbol, rows) {
  if (!dxCandleCache[candleSymbol]) dxCandleCache[candleSymbol] = new Map();
  const cache = dxCandleCache[candleSymbol];
  rows.forEach(row => {
    const c = normalizeCandle(row);
    if (c) cache.set(c.datetime, c);
  });
  const sortedKeys = [...cache.keys()].sort((a, b) => a - b);
  while (sortedKeys.length > 288) cache.delete(sortedKeys.shift());
}

function cacheTradeAsFiveMinuteCandle(sym, price, size) {
  const p = finiteNumber(price);
  if (!/^\/(ES|NQ)/.test(sym) || p === null || p <= 0) return;
  const bucket = Math.floor(Date.now() / 300000) * 300000;
  const candleSymbol = `${sym}{=5m}`;
  if (!dxCandleCache[candleSymbol]) dxCandleCache[candleSymbol] = new Map();
  const cache = dxCandleCache[candleSymbol];
  const prev = cache.get(bucket);
  const volume = firstFiniteNumber(size, 0);
  cache.set(bucket, prev ? {
    datetime: bucket,
    open: prev.open,
    high: Math.max(prev.high, p),
    low: Math.min(prev.low, p),
    close: p,
    volume: (prev.volume || 0) + volume
  } : {
    datetime: bucket,
    open: p,
    high: p,
    low: p,
    close: p,
    volume
  });
  const sortedKeys = [...cache.keys()].sort((a, b) => a - b);
  while (sortedKeys.length > 288) cache.delete(sortedKeys.shift());
}

function normalizeRequestedCandleSymbols(sym) {
  const raw = String(sym || '');
  const match = raw.match(/^(.*?)(\{=.*\})$/);
  if (!match) return [raw];
  const base = match[1];
  const suffix = match[2];
  const out = new Set([raw]);
  if (/^\/?ES/.test(base)) {
    out.add(`/ES:XCME${suffix}`);
    out.add(`/ESM6${suffix}`);
    out.add(`/ESM26${suffix}`);
  }
  if (/^\/?NQ/.test(base)) {
    out.add(`/NQ:XCME${suffix}`);
    out.add(`/NQM6${suffix}`);
    out.add(`/NQM26${suffix}`);
  }
  return [...out];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForOptionData(streamerSymbols, timeoutMs = 4500) {
  const sample = [...new Set((streamerSymbols || []).filter(Boolean))];
  if (!sample.length) return;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let readyCount = 0;
    for (const sym of sample) {
      const hasGreeks = !!dxGreeksCache[sym] && Object.keys(dxGreeksCache[sym]).length > 0;
      const hasSummary = !!dxSummaryCache[sym] && Object.keys(dxSummaryCache[sym]).length > 0;
      if (hasGreeks && hasSummary) readyCount++;
    }
    if (readyCount >= Math.max(20, Math.floor(sample.length * 0.75))) return;
    await sleep(120);
  }
}

function connectDxLink() {
  if (!dxWssUrl || !dxQuoteToken) { log('No dxLink token/URL'); return; }
  if (dxSocket && (dxSocket.readyState === WebSocket.OPEN || dxSocket.readyState === WebSocket.CONNECTING)) return;

  log('Connecting dxLink:', dxWssUrl);
  dxSocket      = new WebSocket(dxWssUrl);
  dxAuthorized  = false;
  dxChannelOpen = false;
  dxHistoryChannelOpen = false;
  dxHistoryConfigured = false;

  dxSocket.on('open', () => {
    log('dxLink open â†’ SETUP');
    dxSocket.send(JSON.stringify({ type:'SETUP', channel:0, version:'0.1-DXF-JS/0.3.0', keepaliveTimeout:60, acceptKeepaliveTimeout:60 }));
    clearInterval(keepAliveInterval);
    keepAliveInterval = setInterval(() => {
      if (dxSocket?.readyState === WebSocket.OPEN) dxSocket.send(JSON.stringify({ type:'KEEPALIVE', channel:0 }));
    }, 30_000);
  });

  dxSocket.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'AUTH_STATE') {
      if (msg.state === 'UNAUTHORIZED') {
        log('AUTH_STATE UNAUTHORIZED â†’ sending AUTH');
        dxSocket.send(JSON.stringify({ type:'AUTH', channel:0, token: dxQuoteToken }));
      } else if (msg.state === 'AUTHORIZED') {
        log('AUTH_STATE AUTHORIZED â†’ CHANNEL_REQUEST (AUTO + HISTORY)');
        dxAuthorized = true;
        // Open AUTO channel for Quote/Trade/Greeks/Summary
        dxSocket.send(JSON.stringify({ type:'CHANNEL_REQUEST', channel: DX_CHANNEL, service:'FEED', parameters:{ contract:'AUTO' } }));
        // Open dedicated HISTORY channel for Candle (time-series snapshots require HISTORY)
        dxSocket.send(JSON.stringify({ type:'CHANNEL_REQUEST', channel: DX_CHANNEL_HISTORY, service:'FEED', parameters:{ contract:'HISTORY' } }));
      }
    }
    else if (msg.type === 'CHANNEL_OPENED' && msg.channel === DX_CHANNEL) {
      log('AUTO CHANNEL_OPENED â†’ FEED_SETUP');
      dxChannelOpen = true;
      dxSocket.send(JSON.stringify({
        type:'FEED_SETUP', channel: DX_CHANNEL,
        acceptAggregationPeriod: 0.1, acceptDataFormat:'COMPACT',
        acceptEventFields:{
          Quote:   ['eventType','eventSymbol','bidPrice','askPrice','bidSize','askSize'],
          Trade:   ['eventType','eventSymbol','price','dayVolume','size'],
          TradeETH:['eventType','eventSymbol','price','dayVolume','size'],
          Greeks:  ['eventType','eventSymbol','volatility','delta','gamma','theta','rho','vega'],
          Summary: ['eventType','eventSymbol','openInterest','dayVolume','dayOpenPrice','dayHighPrice','dayLowPrice','prevDayClosePrice']
        }
      }));
      sendSubscriptions();
    }
    else if (msg.type === 'CHANNEL_OPENED' && msg.channel === DX_CHANNEL_HISTORY) {
      log('HISTORY CHANNEL_OPENED â†’ FEED_SETUP for Candles');
      dxHistoryChannelOpen = true;
      dxSocket.send(JSON.stringify({
        type:'FEED_SETUP', channel: DX_CHANNEL_HISTORY,
        acceptAggregationPeriod: 0.1, acceptDataFormat:'COMPACT',
        acceptEventFields:{
          Candle: ['eventType','eventSymbol','eventFlags','index','time','sequence','count','open','high','low','close','volume','vwap','bidVolume','askVolume','impVolatility']
        }
      }));
      dxHistoryConfigured = true;
      sendCandleSubscriptions();
    }
    else if (msg.type === 'FEED_DATA') {
      // COMPACT format: data = [eventType, [sym, val1, val2, ...], ...]
      // Cache Greeks/Summary/Quote for option chain enrichment
      if (Array.isArray(msg.data) && msg.data.length >= 2) {
        const eventType = msg.data[0];
        const rows = msg.data[1];
        if (typeof eventType === 'string' && Array.isArray(rows)) {
          // COMPACT: rows = [sym, v1, v2, sym, v1, v2, ...]
          // Fields defined by FEED_SETUP acceptEventFields order
          const greeksFields  = ['volatility','delta','gamma','theta','rho','vega'];
          const summaryFields = ['openInterest','dayVolume','dayOpenPrice','dayHighPrice','dayLowPrice','prevDayClosePrice'];
          const quoteFields   = ['bidPrice','askPrice','bidSize','askSize'];
          const tradeFields   = ['price','dayVolume','size'];
          const candleFields  = ['eventFlags','index','time','sequence','count','open','high','low','close','volume','vwap','bidVolume','askVolume','impVolatility'];
          const rowsIncludeType = rows[0] === eventType;
          const fieldCount = eventType === 'Greeks' ? greeksFields.length + (rowsIncludeType ? 2 : 1)
                           : eventType === 'Summary' ? summaryFields.length + (rowsIncludeType ? 2 : 1)
                           : eventType === 'Quote'   ? quoteFields.length + (rowsIncludeType ? 2 : 1)
                           : (eventType === 'Trade' || eventType === 'TradeETH') ? tradeFields.length + (rowsIncludeType ? 2 : 1)
                           : eventType === 'Candle' ? candleFields.length + (rowsIncludeType ? 2 : 1) : 0;
          if (eventType === 'Candle') {
            const candles = compactRows(eventType, rows, candleFields);
            const bySymbol = {};
            candles.forEach(c => {
              if (!bySymbol[c.eventSymbol]) bySymbol[c.eventSymbol] = [];
              bySymbol[c.eventSymbol].push(c);
            });
            Object.entries(bySymbol).forEach(([sym, list]) => cacheCandles(sym, list));
            // Normalize before broadcast so browser gets proper millisecond timestamps
            const normalizedForBroadcast = candles.map(c => {
              const n = normalizeCandle(c);
              if (!n) return null;
              return { ...n, eventSymbol: c.eventSymbol, eventType: c.eventType };
            }).filter(Boolean);
            broadcast({ type: 'CANDLE_DATA', data: normalizedForBroadcast });
            return;
          }
          if (fieldCount > 0) {
            for (let i = 0; i < rows.length; i += fieldCount) {
              const sym = rowsIncludeType ? rows[i + 1] : rows[i];
              const base = i + (rowsIncludeType ? 2 : 1);
              if (!sym) continue;
              if (eventType === 'Greeks') {
                dxGreeksCache[sym] = {};
                greeksFields.forEach((f, j) => dxGreeksCache[sym][f] = rows[base + j]);
              } else if (eventType === 'Summary') {
                dxSummaryCache[sym] = {};
                summaryFields.forEach((f, j) => dxSummaryCache[sym][f] = rows[base + j]);
              } else if (eventType === 'Quote') {
                dxQuoteCache[sym] = {};
                quoteFields.forEach((f, j) => dxQuoteCache[sym][f] = rows[base + j]);
              } else if (eventType === 'Trade' || eventType === 'TradeETH') {
                dxTradeCache[sym] = dxTradeCache[sym] || {};
                tradeFields.forEach((f, j) => dxTradeCache[sym][f] = rows[base + j]);
                cacheTradeAsFiveMinuteCandle(sym, dxTradeCache[sym].price, dxTradeCache[sym].size);
              }
            }
          }
        }
      }
      broadcast(msg);
    }
    else if (msg.type === 'KEEPALIVE') {
      dxSocket.send(JSON.stringify({ type:'KEEPALIVE', channel:0 }));
    }
    else if (msg.type === 'ERROR') {
      log('dxLink ERROR:', JSON.stringify(msg));
    }
  });

  dxSocket.on('close', (code, reason) => {
    log(`dxLink closed (${code}) â€” reconnecting in 5s`);
    dxAuthorized = dxChannelOpen = dxHistoryChannelOpen = dxHistoryConfigured = false;
    clearInterval(keepAliveInterval);
    dxSocket = null;
    if (dxClients.size > 0) setTimeout(async () => {
      await ensureToken(); await fetchDxLinkToken(); connectDxLink();
    }, 5000);
  });

  dxSocket.on('error', e => log('dxLink error:', e.message));
}

// â”€â”€â”€ HTTP Server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'*', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'*', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS' });
    return res.end();
  }

  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;
  log(req.method, p);

  // ── HEALTH CHECK ──────────────────────────────────────────────
  if (p === '/health') {
    if (!schwabAccessToken && fs.existsSync(SCHWAB_TOKEN_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(SCHWAB_TOKEN_FILE, 'utf8'));
        if (saved.accessToken && saved.expiresAt && Date.now() < saved.expiresAt) {
          schwabAccessToken = saved.accessToken;
          schwabRefreshToken = saved.refreshToken;
          schwabTokenExpiry = saved.expiresAt;
        }
      } catch(e) {}
    }
    const REDIRECT_URI = 'https://127.0.0.1:3001/callback';
    const params = new URLSearchParams({ client_id: SCHWAB_CLIENT_ID, redirect_uri: REDIRECT_URI });
    return sendJSON(res, 200, {
      ok: true, port: PORT,
      schwab_connected: !!(schwabAccessToken && Date.now() < schwabTokenExpiry),
      tastytrade_connected: !!(accessToken && Date.now() < tokenExpiry),
      authUrl: `https://api.schwabapi.com/v1/oauth/authorize?response_type=code&${params}`,
      redirectUri: REDIRECT_URI
    });
  }

  // ── SCHWAB PROXY ROUTES ───────────────────────────────────────
  if (p.startsWith('/proxy/schwab/')) {
    if (!schwabAccessToken) return sendJSON(res, 401, { error: 'Schwab not connected' });
    const schwabPath = p.replace('/proxy/schwab', '') + (u.search || '');
    const opts = {
      hostname: SCHWAB_BASE, port: 443, path: schwabPath, method: 'GET',
      headers: { 'Authorization': `Bearer ${schwabAccessToken}`, 'Accept': 'application/json' }
    };
    const schwabReq = https.request(opts, schwabRes => {
      let raw = '';
      schwabRes.on('data', c => raw += c);
      schwabRes.on('end', () => {
        try {
          const data = JSON.parse(raw);
          res.writeHead(schwabRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch(e) {
          res.writeHead(schwabRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(raw);
        }
      });
    });
    schwabReq.on('error', err => sendJSON(res, 502, { error: err.message }));
    schwabReq.end();
    return;
  }

  if (req.method === 'GET' && (p === '/proxy/api/auto-connect' || p === '/proxy/auto-connect')) {
    const ok = await ensureToken();
    return sendJSON(res, 200, {
      connected: ok,
      hasToken: !!accessToken,
      access_token: accessToken,
      tokenExpiry,
      dxConnected: dxSocket?.readyState === WebSocket.OPEN,
      dxAuthorized
    });
  }

  if (req.method === 'POST' && p === '/proxy/refresh') {
    const ok = await refreshAccessToken();
    return ok
      ? sendJSON(res, 200, { access_token: accessToken, refresh_token: refreshToken })
      : sendJSON(res, 401, { error: 'Refresh failed' });
  }

  if (req.method === 'GET' && p.startsWith('/proxy/api/tt/quote/')) {
    const sym = decodeURIComponent(p.slice('/proxy/api/tt/quote/'.length));
    const { status, data } = await ttGet(`/market-metrics?symbols=${sym.split(',').map(s => encodeURIComponent(s.trim())).join(',')}`);
    return sendJSON(res, status, data);
  }

  if (req.method === 'GET' && (p === '/proxy/api/mark' || p === '/proxy/api/mark/')) {
    const rawSymbols = u.searchParams.getAll('symbol');
    const single = u.searchParams.get('symbols') || u.searchParams.get('sym') || '';
    const requested = [...rawSymbols, ...single.split(',')]
      .map(s => String(s || '').trim())
      .filter(Boolean);
    const symbols = requested.length ? requested : ['SPX'];
    const query = symbols.map(s => encodeURIComponent(String(s).replace(/^\$/, ''))).join(',');
    const { status, data } = await ttGet(`/market-metrics?symbols=${query}`);
    return sendJSON(res, status, data);
  }

  if (req.method === 'GET' && p === '/proxy/api/marketdata/v1/quotes') {
    const symbols = String(u.searchParams.get('symbols') || '')
      .split(',')
      .map(s => decodeURIComponent(s))
      .filter(Boolean);
    return sendSchwabLikeQuotes(res, symbols);
  }

  if (req.method === 'GET' && p === '/proxy/api/schwab/quotes-batch') {
    const symbols = String(u.searchParams.get('symbols') || '')
      .split(',')
      .map(s => decodeURIComponent(s))
      .filter(Boolean);
    return sendSchwabLikeQuotes(res, symbols);
  }

  if (req.method === 'GET' && p.startsWith('/proxy/api/schwab/quote/')) {
    const sym = decodeURIComponent(p.slice('/proxy/api/schwab/quote/'.length));
    return sendSchwabLikeQuotes(res, [sym]);
  }

  if (req.method === 'GET' && p === '/proxy/api/marketdata/v1/chains') {
    const sym = u.searchParams.get('symbol') || 'SPX';
    const contractType = String(u.searchParams.get('contractType') || 'ALL').toUpperCase();
    const strikeCount = parseInt(u.searchParams.get('strikeCount') || '60', 10);
    const { status, data } = await fetchSchwabLikeChain(sym, contractType, strikeCount);
    return sendJSON(res, status, data);
  }

  if (req.method === 'GET' && p.startsWith('/proxy/api/schwab/chains/')) {
    const sym = decodeURIComponent(p.slice('/proxy/api/schwab/chains/'.length));
    const { status, data } = await fetchSchwabLikeChain(sym, 'ALL', 60);
    return sendJSON(res, status, data);
  }

  if (req.method === 'GET' && p === '/proxy/api/marketdata/v1/pricehistory') {
    const rawSymbol = String(u.searchParams.get('symbol') || 'SPX').replace(/^\$/, '');
    const symbol = rawSymbol === 'SPX.X' ? 'SPX' : rawSymbol;
    let parts = [];
    if (symbol === 'SPX') parts = ['index[]=SPX'];
    else if (symbol === 'NDX') parts = ['index[]=NDX'];
    else if (symbol === 'VIX.X' || symbol === 'VIX') parts = ['index[]=VIX'];
    else if (/^\/ES/i.test(symbol)) parts = ['future[]=' + encodeURIComponent('/ESM6')];
    else if (/^\/NQ/i.test(symbol)) parts = ['future[]=' + encodeURIComponent('/NQM6')];
    else parts = ['equity[]=' + encodeURIComponent(symbol)];
    const { status, data } = await ttGet(`/market-data/by-type?${parts.join('&')}`);
    const item = data?.data?.items?.[0] || {};
    const q = item.quote || item;
    const last = firstFiniteNumber(
      q.last,
      q['last-price'],
      q['last-trade-price'],
      q.mark,
      q['mark-price'],
      q['mid-price'],
      q.closePrice
    );
    const close = firstFiniteNumber(
      q.closePrice,
      q['close-price'],
      last - firstFiniteNumber(q.netChange, q['net-change'], 0),
      last
    );
    return sendJSON(res, status === 200 ? 200 : 200, buildSyntheticPriceHistory(symbol, last, close));
  }

  // â”€â”€ GET /proxy/api/tt/quotes-batch  â€” market-data/by-type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Query: ?equity[]=SPY&equity[]=AAPL&index[]=SPX&index[]=VIX&future[]=/ESM26
  if (req.method === 'GET' && p === '/proxy/api/tt/quotes-batch') {
    const qs = u.search ? u.search.slice(1) : '';
    const { status, data } = await ttGet(`/market-data/by-type?${qs}`);
    return sendJSON(res, status, data);
  }

  if (req.method === 'GET' && p.startsWith('/proxy/api/tt/chains/')) {
    let sym = decodeURIComponent(p.slice('/proxy/api/tt/chains/'.length).split('?')[0]);
    sym = sym.replace(/^\$/, '');
    const exp = u.searchParams.get('expiration') || '';

    const { status: s1, data: d1 } = await ttGet(`/option-chains/${encodeURIComponent(sym)}/nested`);
    if (s1 !== 200 || !d1?.data?.items?.length) {
      return sendJSON(res, s1, d1);
    }

    // TT nested chain: items = array of chain objects, each with expirations[]
    // Prefer SPXW (weeklys) for SPX to get 0DTE and 5-point strike density
    const chainObj = d1.data.items.find(c => c['root-symbol'] === 'SPXW') || d1.data.items[0];
    const rootSymbol = chainObj['root-symbol'] || sym;
    const expirations = chainObj.expirations || [];
    log('chains root-symbol:', rootSymbol, 'expirations:', expirations.length);

    // Step 2: fetch full option chain for root symbol to get strikes+OI+greeks
    // Filter to requested expiration or nearest few
    let targetExps = expirations.map(e => e['expiration-date']).filter(Boolean).sort();
    if (exp) targetExps = targetExps.filter(e => e === exp);
    else targetExps = targetExps.slice(0, 8); // near-term expirations for DTE-specific GEX views

    // Fetch full chain (non-nested) which returns individual option records
    const chainResponses = await Promise.all(targetExps.map(expDate => (
      ttGet(`/option-chains/${encodeURIComponent(rootSymbol)}?expiration-date=${expDate}`)
        .then(result => ({ expDate, ...result }))
        .catch(error => ({ expDate, status: 500, data: null, error }))
    )));

    let allOptions = [];
    for (const { status: s2, data: d2 } of chainResponses) {
      if (s2 === 200 && d2?.data?.items) {
        allOptions = allOptions.concat(d2.data.items);
      }
    }
    
    const targetExpSet = new Set(targetExps);
    const filteredOptions = allOptions.filter(o => targetExpSet.has(o['expiration-date']));
    log('chains total options fetched:', allOptions.length, 'â†’ returned full strike set:', filteredOptions.length);

    // Subscribe filtered streamer-symbols to dxLink for Greeks, Summary, Quote, and Trade volume
    const quotePrice = await fetchUnderlyingLast(sym).catch(() => 0);
    const underlyingPrice = inferUnderlyingPrice(allOptions, quotePrice);
    const streamerSyms = pickNearestOptionStreamerSymbols(filteredOptions, underlyingPrice);
    if (streamerSyms.length && dxSocket && dxSocket.readyState === WebSocket.OPEN && dxChannelOpen) {
      const add = [];
      streamerSyms.forEach(sym => {
        add.push({ type: 'Greeks',  symbol: sym });
        add.push({ type: 'Summary', symbol: sym });
        add.push({ type: 'Quote',   symbol: sym });
        add.push({ type: 'Trade',   symbol: sym });
        add.push({ type: 'TradeETH', symbol: sym });
        subscriptions.add(sym);
      });
      for (let i = 0; i < add.length; i += 250) {
        dxSocket.send(JSON.stringify({ type: 'FEED_SUBSCRIPTION', channel: DX_CHANNEL, reset: false, add: add.slice(i, i + 250) }));
      }
      const prioritySymbols = filteredOptions
        .slice()
        .sort((a, b) => {
          const aDist = Math.abs(parseFloat(a['strike-price'] || 0) - underlyingPrice);
          const bDist = Math.abs(parseFloat(b['strike-price'] || 0) - underlyingPrice);
          return aDist - bDist;
        })
        .slice(0, 400)
        .map(o => o['streamer-symbol'])
        .filter(Boolean);
      await waitForOptionData(prioritySymbols.length ? prioritySymbols : streamerSyms.slice(0, 400));
      log('Subscribed', streamerSyms.length, 'nearest option symbols to dxLink');
    }

    // Build nested structure: data.data.items = array of expGroups
    const expMap = {};
    for (const opt of filteredOptions) {
      const expDate = opt['expiration-date'] || '';
      const strikePrice = parseFloat(opt['strike-price'] || 0);
      const rawType = (opt['option-type'] || '').toUpperCase();
      const side = rawType === 'C' ? 'call' : rawType === 'P' ? 'put' : rawType.toLowerCase();
      if (!expDate || !strikePrice || !side || (side !== 'call' && side !== 'put')) continue;
      if (!expMap[expDate]) expMap[expDate] = { 'expiration-date': expDate, strikes: {} };
      if (!expMap[expDate].strikes[strikePrice]) expMap[expDate].strikes[strikePrice] = { 'strike-price': String(strikePrice) };
      const streamerSym = opt['streamer-symbol'] || '';
      const greeks  = dxGreeksCache[streamerSym]  || {};
      const summary = dxSummaryCache[streamerSym] || {};
      const quote   = dxQuoteCache[streamerSym]   || {};
      const trade   = dxTradeCache[streamerSym]   || {};
      const fallbackGreeks = estimateOptionGreekFallback(opt, underlyingPrice, side);
      const liveDelta = finiteNumber(greeks.delta);
      const liveGamma = finiteNumber(greeks.gamma);
      expMap[expDate].strikes[strikePrice][side] = {
        symbol:               opt.symbol || '',
        'streamer-symbol':    streamerSym,
        'open-interest':      maxWholeNumber(opt['open-interest'], opt.openInterest, summary.openInterest),
        volume:               firstVolumeNumber(trade.dayVolume, opt['day-volume'], opt['day-volume-count'], opt['volume-count'], opt.volume, opt['volume'], summary.dayVolume),
        _rawOpenInterest:     opt['open-interest'] ?? opt.openInterest ?? null,
        _summaryOpenInterest: summary.openInterest ?? null,
        _rawVolume:           opt.volume ?? opt['volume'] ?? opt['day-volume'] ?? null,
        _tradeDayVolume:      trade.dayVolume ?? null,
        _summaryDayVolume:    summary.dayVolume ?? null,
        bid:                  firstFiniteNumber(quote.bidPrice),
        ask:                  firstFiniteNumber(quote.askPrice),
        last:                 0,
        delta:                liveDelta !== null && Math.abs(liveDelta) > 0 ? liveDelta : fallbackGreeks.delta,
        gamma:                liveGamma !== null && liveGamma > 0 ? liveGamma : fallbackGreeks.gamma,
        theta:                firstFiniteNumber(greeks.theta),
        vega:                 firstFiniteNumber(greeks.vega),
        'implied-volatility': firstFiniteNumber(greeks.volatility),
      };
    }

    // Convert map to items array
    const items = Object.values(expMap).map(eg => ({
      'expiration-date': eg['expiration-date'],
      strikes: Object.values(eg.strikes),
    })).sort((a, b) => a['expiration-date'].localeCompare(b['expiration-date']));

    const cachedGreeks = Object.keys(dxGreeksCache).length;
    log('chains built items:', items.length, 'first strikes:', items[0]?.strikes?.length, '| dxLink greeks cached:', cachedGreeks);
    return sendJSON(res, 200, { data: { items }, context: '/option-chains/' + sym + '/nested' });
  }

  if (req.method === 'POST' && p === '/proxy/dxlink/subscribe') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { symbols } = JSON.parse(body);
        if (Array.isArray(symbols)) {
          symbols.forEach(s => normalizeRequestedCandleSymbols(s).forEach(sym => subscriptions.add(sym)));
          sendSubscriptions();
        }
      } catch(e) {}
      sendJSON(res, 200, { ok:true, subscriptions:[...subscriptions] });
    });
    return;
  }

  if (req.method === 'GET' && p === '/proxy/api/status') {
    const candleStats = {};
    for (const [key, cache] of Object.entries(dxCandleCache)) {
      candleStats[key] = {
        count: cache.size,
        oldest: cache.size ? new Date(Math.min(...cache.keys())).toISOString() : null,
        newest: cache.size ? new Date(Math.max(...cache.keys())).toISOString() : null
      };
    }
    return sendJSON(res, 200, {
      proxy:'tastytrade', tokenValid:!isExpired(), tokenExpiry:new Date(tokenExpiry).toISOString(),
      dxState: dxSocket ? ['CONNECTING','OPEN','CLOSING','CLOSED'][dxSocket.readyState] : 'null',
      dxAuthorized, dxChannelOpen, dxHistoryChannelOpen,
      subscriptions:[...subscriptions], candleSubscriptions:[...candleSubscriptions],
      browserClients:dxClients.size,
      candleCache: candleStats
    });
  }

  if (req.method === 'GET' && p === '/proxy/api/dxlink/candles') {
    const symbol = String(u.searchParams.get('symbol') || '/ESM6{=5m}');
    log('Candles HTTP request for symbol:', symbol);
    
    const candidates = [
      symbol,
      ...normalizeRequestedCandleSymbols(symbol),
      symbol.replace('/ESM26', '/ESM6').replace('/NQM26', '/NQM6'),
      symbol.replace('/ESM6', '/ESM26').replace('/NQM6', '/NQM26'),
      symbol.replace(/^\/ES[^{}]*/, '/ES:XCME'),
      symbol.replace(/^\/NQ[^{}]*/, '/NQ:XCME'),
    ];
    
    // Ensure dxLink is connected and HISTORY channel is ready
    if (!dxSocket || dxSocket.readyState !== WebSocket.OPEN) {
      log('dxLink not connected for candles request');
      return sendJSON(res, 503, { error: 'dxLink not connected', empty: true, candles: [] });
    }
    
    if (!dxHistoryChannelOpen) {
      log('HISTORY channel not open - waiting for reconnect...');
      return sendJSON(res, 503, { error: 'HISTORY channel not ready', empty: true, candles: [] });
    }

    // Directly subscribe to candle symbols on HISTORY channel (bypassing candleSubscriptions set)
    const fromTimeMs = Date.now() - 86400000;
    const candleSubs = candidates.filter(s => /\{=/.test(s));
    
    if (candleSubs.length > 0) {
      log(`HTTP endpoint subscribing to ${candleSubs.length} candle(s) on HISTORY channel for 24h`);
      const removeList = candleSubs.map(s => ({ type: 'Candle', symbol: s }));
      const addList = candleSubs.map(s => ({ type: 'Candle', symbol: s, fromTime: fromTimeMs }));
      
      // Remove any stale subscriptions
      dxSocket.send(JSON.stringify({
        type: 'FEED_SUBSCRIPTION',
        channel: DX_CHANNEL_HISTORY,
        reset: false,
        remove: removeList
      }));
      
      // Subscribe with fromTime
      dxSocket.send(JSON.stringify({
        type: 'FEED_SUBSCRIPTION',
        channel: DX_CHANNEL_HISTORY,
        reset: false,
        add: addList
      }));
    }

    // Wait for candles to arrive in cache
    const waitStart = Date.now();
    const targetCount = 200;
    const waitTimeout = 8000;  // 8s timeout for initial data
    
    while (Date.now() - waitStart < waitTimeout) {
      // Check all candidate cache keys
      let bestCache = null;
      let bestCount = 0;
      for (const candidate of candidates) {
        const c = dxCandleCache[candidate];
        if (c && c.size > bestCount) {
          bestCache = c;
          bestCount = c.size;
        }
      }
      
      if (bestCount >= targetCount) {
        const candles = [...bestCache.values()].sort((a, b) => a.datetime - b.datetime);
        log(`HTTP: Returning ${candles.length} candles from cache (found ${bestCount} after ${Date.now() - waitStart}ms)`);
        return sendJSON(res, 200, { symbol: [...candidates].find((s, i) => dxCandleCache[s]?.size === bestCount), empty: false, candles: candles.slice(-288) });
      }
      
      await sleep(200);
    }

    // After timeout, return whatever we have (even if less than targetCount)
    let finalCache = null;
    let finalCount = 0;
    for (const candidate of candidates) {
      const c = dxCandleCache[candidate];
      if (c && c.size > finalCount) {
        finalCache = c;
        finalCount = c.size;
      }
    }
    
    if (finalCache && finalCount > 0) {
      const candles = [...finalCache.values()].sort((a, b) => a.datetime - b.datetime);
      log(`HTTP: Timeout reached. Returning ${candles.length} candles (less than target)`);
      return sendJSON(res, 200, { empty: false, candles: candles.slice(-288) });
    }

    log('HTTP: No candles received after 8s - returning empty');
    return sendJSON(res, 200, { empty: true, candles: [] });
  }

  sendJSON(res, 404, { error:'Unknown route', path:p });
});

// â”€â”€â”€ WebSocket Bridge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const wss = new WebSocket.Server({ server, path:'/ws/dxlink' });

wss.on('connection', ws => {
  log('Browser WS connected');
  dxClients.add(ws);
  if (!dxSocket || dxSocket.readyState === WebSocket.CLOSED) {
    ensureToken().then(() => fetchDxLinkToken().then(() => connectDxLink()));
  }
  ws.on('message', async raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'subscribe' && Array.isArray(msg.symbols)) {
        if (msg.spxSubscribe) {
          const { compact } = todayYmd();
          [...subscriptions].forEach(s => {
            if (isSpxwSymbol(s) && optionExpirationCompact(s) !== compact) subscriptions.delete(s);
          });
          await ensureTodaySpxOptionSubscriptions();
        }
        msg.symbols.forEach(s => {
          normalizeRequestedCandleSymbols(s).forEach(sym => {
            if (/\{=/.test(sym)) {
              candleSubscriptions.add(sym);
            } else {
              subscriptions.add(sym);
            }
          });
        });
        sendSubscriptions();
        sendCandleSubscriptions();
      }
    } catch(e) {}
  });
  ws.on('close', () => {
    dxClients.delete(ws);
    log('Browser WS disconnected. Remaining:', dxClients.size);
    if (dxClients.size === 0 && dxSocket) { clearInterval(keepAliveInterval); dxSocket.close(); dxSocket = null; }
  });
  ws.on('error', e => log('Browser WS error:', e.message));
});

// â”€â”€â”€ Start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Pre-warm: fetch SPX chain + subscribe all streamer-symbols to dxLink at startup
async function prewarmCache() {
  log('Pre-warming dxLink cache for SPX options...');
  try {
    // Get nested chain to find root symbol
    const { status: s1, data: d1 } = await ttGet('/option-chains/SPX/nested');
    if (s1 !== 200 || !d1?.data?.items?.length) { log('Prewarm: nested chain failed', s1); return; }
    const chainObj = d1.data.items.find(c => c['root-symbol'] === 'SPXW') || d1.data.items[0];
    const rootSymbol = chainObj['root-symbol'] || 'SPXW';
    const expirations = (chainObj.expirations || []).map(e => e['expiration-date']).filter(Boolean).sort().slice(0, 1);
    log('Prewarm: fetching', expirations.length, 'expirations (0DTE only) for', rootSymbol);

    let allOptions = [];
    for (const expDate of expirations) {
      const { status: s2, data: d2 } = await ttGet(`/option-chains/${encodeURIComponent(rootSymbol)}?expiration-date=${expDate}`);
      if (s2 === 200 && d2?.data?.items) {
        allOptions = allOptions.concat(d2.data.items);
      }
    }
    
    const quotePrice = await fetchUnderlyingLast('SPX').catch(() => 0);
    const underlyingPrice = inferUnderlyingPrice(allOptions, quotePrice || 5800);
    const allSyms = pickNearestOptionStreamerSymbols(allOptions, underlyingPrice, 500);
    log('Prewarm: got', allOptions.length, 'options; subscribing nearest', allSyms.length, 'around', underlyingPrice);

    // Wait for dxLink to be ready, then subscribe
    const waitAndSubscribe = () => {
      if (!dxSocket || dxSocket.readyState !== WebSocket.OPEN || !dxChannelOpen) {
        setTimeout(waitAndSubscribe, 1000);
        return;
      }
      const add = [];
      allSyms.forEach(sym => {
        add.push({ type: 'Greeks',  symbol: sym });
        add.push({ type: 'Summary', symbol: sym });
        add.push({ type: 'Quote',   symbol: sym });
        add.push({ type: 'Trade',   symbol: sym });
        add.push({ type: 'TradeETH', symbol: sym });
        subscriptions.add(sym);
      });
      for (let i = 0; i < add.length; i += 250) {
        dxSocket.send(JSON.stringify({ type: 'FEED_SUBSCRIPTION', channel: DX_CHANNEL, reset: false, add: add.slice(i, i + 250) }));
      }
      log('Prewarm: subscribed', allSyms.length, 'nearest option symbols to dxLink - cache will be ready in ~5s');
    };
    waitAndSubscribe();
  } catch(e) { log('Prewarm error:', e.message); }
}

server.listen(PORT, async () => {
  log(`Proxy running on port ${PORT}`);
  loadTokenFile();
  const ok = await refreshAccessToken();
  if (ok) {
    const dxOk = await fetchDxLinkToken();
    if (dxOk) {
      connectDxLink();
      // Pre-warm cache after dxLink connects (~3s)
      setTimeout(prewarmCache, 3000);
    }
  } else {
    log('âš  Token refresh failed â€” check .env REFRESH_TOKEN');
  }
  // Auto-refresh every 90 min
  setInterval(async () => {
    if (isExpired()) {
      const ok = await refreshAccessToken();
      if (ok) { await fetchDxLinkToken(); if (!dxSocket || dxSocket.readyState !== WebSocket.OPEN) connectDxLink(); }
    }
  }, 90 * 60 * 1000);
});
