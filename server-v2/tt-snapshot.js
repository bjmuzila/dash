'use strict';
/**
 * server-v2/tt-snapshot.js
 *
 * TastyTrade-REST-backed drop-in for the option-snapshot functions that the
 * out-of-band recorders (eod-gex, far-cb, scanner, strike-growth, vol-pin) and
 * levels-engine normally import from proxy-thetadata.js.
 *
 * WHY: those recorders call Theta DIRECTLY, ungated by DATA_SOURCE. When the
 * ThetaData subscription is paused, every sweep would throw against a dead Theta
 * Terminal. This module exposes the SAME function names + return shapes, sourced
 * from TastyTrade REST (`/market-data/by-type`, which carries OI, volume, AND
 * greeks/IV) via proxy-tastytrade's already-tested fetchChainFull/fetchChain/
 * fetchUnderlyingQuotes. Each recorder picks its source off the SAME useTheta()
 * flag, so DATA_SOURCE=tt routes here and DATA_SOURCE=theta routes back with no
 * code change (see the require swaps in each recorder).
 *
 * COVERAGE:
 *   Live snapshots (full TT support): fetchChainTheta, fetchOpenInterestTheta,
 *     fetchVolumeTheta, fetchGreeksTheta, fetchQuoteTheta, buildExpiryRows,
 *     fetchIndexPriceTheta, fetchStockQuoteTheta.
 *   Underlying daily history (Yahoo daily 1d): fetchStockDailyHistoryTheta,
 *     fetchIndexDailyHistoryTheta.
 *   NO TT/free equivalent — benign stubs (empty + warn-once) so the daily crons
 *     keep running and only the historical-backfill / premium-popup legs degrade:
 *     fetchOptionDailyHistoryTheta, fetchEodHistoryTheta, fetchOiHistoryTheta,
 *     fetchGreeksEodHistoryTheta, fetchIndexEodTheta, fetchStockEodTheta.
 *
 * OVERLOAD GUARD: a 4s coalescing cache on fetchChainFull(root, exp) collapses
 * the OI+greeks+volume trio a recorder fires for one expiry (Promise.all) into a
 * single upstream by-type fetch, and existing per-ticker sweep delays still pace
 * the roster. getChainCached (10-min TTL) inside proxy-tastytrade caps the chain
 * pulls on top of that.
 */

const {
  fetchChain,
  fetchChainFull,
  fetchUnderlyingQuotes,
} = require('./proxy-tastytrade');
const { dteFromIso, firstFiniteNumber } = require('./computation/utils');

const n = firstFiniteNumber;
const keyOf = (exp, strike, type) => `${exp}|${Number(strike)}|${type}`;

// Mirror of proxy-tastytrade chainTicker() (not exported) — map weekly/alias
// roots back to the chain root so cache keys and Yahoo lookups line up.
function chainRoot(ticker) {
  const t = String(ticker || '').toUpperCase().replace(/^\./, '').replace(/^\$/, '');
  if (t === 'SPXW') return 'SPX';
  if (t === 'NDXP') return 'NDX';
  if (t === 'RUTW') return 'RUT';
  return t;
}

// ── coalescing cache for fetchChainFull(root, expiration) ───────────────────
// A recorder typically asks for OI, greeks AND volume for the same (root,exp)
// at once; without this each call would re-hit /market-data/by-type. Short TTL
// + in-flight sharing collapses them to one upstream fetch.
const _cfCache = new Map(); // `root|exp` -> { at, data }
const _cfInflight = new Map(); // `root|exp` -> Promise<data>
const CF_TTL_MS = Number(process.env.TT_SNAPSHOT_TTL_MS || 4000);

async function chainFullCached(root, expiration) {
  const key = `${root}|${expiration}`;
  const hit = _cfCache.get(key);
  if (hit && Date.now() - hit.at < CF_TTL_MS) return hit.data;
  const inflight = _cfInflight.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    const data = await fetchChainFull(root, expiration);
    _cfCache.set(key, { at: Date.now(), data });
    return data;
  })().finally(() => _cfInflight.delete(key));
  _cfInflight.set(key, p);
  return p;
}

// Return the strikes[] array for one expiration from a fetchChainFull payload.
function strikesForExp(full, expiration) {
  const items = full?.items || [];
  const eg = items.find((x) => x['expiration-date'] === expiration) || items[0];
  return eg?.strikes || [];
}

// Iterate {strike, type, side-object} across a strikes[] array.
function* eachSide(strikes) {
  for (const s of strikes) {
    const strike = Number(s['strike-price']);
    if (!(strike > 0)) continue;
    if (s.call) yield { strike, type: 'C', o: s.call };
    if (s.put) yield { strike, type: 'P', o: s.put };
  }
}

// ── chain structure — mirror of fetchChainTheta ─────────────────────────────
//   returns { expirations:string[], contracts:[{expiration,strike,type,dte}], root }
async function fetchChainTheta(underlying) {
  const root = chainRoot(underlying);
  const { expirations, contracts } = await fetchChain(root);
  const out = contracts.map((c) => ({
    expiration: c.expiration,
    strike: Number(c.strike),
    type: c.type,
    dte: Number.isFinite(c.dte) ? c.dte : dteFromIso(c.expiration),
  }));
  return { expirations, contracts: out, root };
}

// ── OPRA OI snapshot for one expiration — Map `exp|strike|type` -> { oi } ────
async function fetchOpenInterestTheta(underlying, expiration) {
  const root = chainRoot(underlying);
  const full = await chainFullCached(root, expiration);
  const out = new Map();
  for (const { strike, type, o } of eachSide(strikesForExp(full, expiration))) {
    out.set(keyOf(expiration, strike, type), {
      oi: n(o['open-interest'] ?? o.openInterest) || 0,
    });
  }
  return out; // empty => caller treats as "no update, keep prior"
}

// ── day-volume snapshot for one expiration — Map `exp|strike|type` -> number ─
async function fetchVolumeTheta(underlying, expiration) {
  const root = chainRoot(underlying);
  const full = await chainFullCached(root, expiration);
  const out = new Map();
  for (const { strike, type, o } of eachSide(strikesForExp(full, expiration))) {
    out.set(keyOf(expiration, strike, type), n(o.volume) || 0);
  }
  return out;
}

// ── greeks (first-order + gamma + IV) — Map -> { gamma,delta,theta,vega,iv,mark }
async function fetchGreeksTheta(underlying, expiration) {
  const root = chainRoot(underlying);
  const full = await chainFullCached(root, expiration);
  const out = new Map();
  for (const { strike, type, o } of eachSide(strikesForExp(full, expiration))) {
    const bid = n(o.bid), ask = n(o.ask);
    const mark = n(o.mark) || (bid > 0 && ask > 0 ? (bid + ask) / 2 : 0);
    out.set(keyOf(expiration, strike, type), {
      gamma: n(o.gamma),
      delta: n(o.delta),
      theta: n(o.theta),
      vega: n(o.vega),
      iv: n(o['implied-volatility']),
      mark: mark > 0 ? mark : 0,
    });
  }
  return out;
}

// ── NBBO quote snapshot — Map -> { bid, ask, bidSize, askSize } ──────────────
// TT by-type carries bid/ask but not sizes; sizes report 0.
async function fetchQuoteTheta(underlying, expiration) {
  const root = chainRoot(underlying);
  const full = await chainFullCached(root, expiration);
  const out = new Map();
  for (const { strike, type, o } of eachSide(strikesForExp(full, expiration))) {
    out.set(keyOf(expiration, strike, type), {
      bid: n(o.bid) || 0,
      ask: n(o.ask) || 0,
      bidSize: 0,
      askSize: 0,
    });
  }
  return out;
}

// ── convenience row set for one expiration — mirror of buildExpiryRows ───────
async function buildExpiryRows(underlying, expiration) {
  const root = chainRoot(underlying);
  const full = await chainFullCached(root, expiration);
  const rows = [];
  for (const { strike, type, o } of eachSide(strikesForExp(full, expiration))) {
    const oi = n(o['open-interest'] ?? o.openInterest);
    rows.push({
      expiration,
      strike,
      type,
      dte: dteFromIso(expiration),
      oi: oi > 0 ? oi : undefined, // undefined = keep prior (matches Theta convention)
      gamma: Number.isFinite(o.gamma) ? n(o.gamma) : undefined,
      delta: Number.isFinite(o.delta) ? n(o.delta) : undefined,
      theta: Number.isFinite(o.theta) ? n(o.theta) : undefined,
      vega: Number.isFinite(o.vega) ? n(o.vega) : undefined,
      iv: Number.isFinite(o['implied-volatility']) ? n(o['implied-volatility']) : undefined,
      source: 'tt',
    });
  }
  return rows;
}

// ── underlying prices ───────────────────────────────────────────────────────
// Index cash price (SPX/NDX/VIX/RUT…) — number or null.
async function fetchIndexPriceTheta(symbol) {
  const root = chainRoot(symbol);
  const q = (await fetchUnderlyingQuotes([root])).get(root);
  const px = n(q?.mark) || n(q?.last);
  return px > 0 ? px : null;
}

// Real-time equity quote — { last, mark, close, prevClose } or null (TT fallback shape).
async function fetchStockQuoteTheta(symbol) {
  const up = String(symbol).toUpperCase();
  const q = (await fetchUnderlyingQuotes([up])).get(up);
  if (!q) return null;
  const last = n(q.last), mark = n(q.mark);
  if (!(last > 0) && !(mark > 0)) return null;
  return {
    last: last > 0 ? last : mark,
    mark: mark > 0 ? mark : last,
    close: n(q.close) > 0 ? n(q.close) : 0,
    prevClose: n(q.prevClose) > 0 ? n(q.prevClose) : 0,
  };
}

/**
 * Spot-only variant, mirroring proxy-thetadata's fetchStockSpotTheta so callers
 * that just need a price are adapter-agnostic. On TT this is already the same
 * call — the quote never depended on prevClose here — so it's a straight alias,
 * kept explicit so swapping DATA_SOURCE can't silently change scanner behaviour.
 */
async function fetchStockSpotTheta(symbol) {
  return fetchStockQuoteTheta(symbol);
}

// ── underlying DAILY history (Yahoo, interval=1d) ───────────────────────────
// Matches Theta's fetchStock/IndexDailyHistoryTheta return: [{time(ms),open,high,low,close,volume}].
const YAHOO_SYMBOL = {
  SPX: '^GSPC', NDX: '^NDX', RUT: '^RUT', VIX: '^VIX', DJX: '^DJI', XSP: '^GSPC', SPXW: '^GSPC',
};
function yahooSym(symbol) {
  const s = chainRoot(symbol);
  if (YAHOO_SYMBOL[s]) return YAHOO_SYMBOL[s];
  // Yahoo writes CLASS SHARES with a dash, never a dot: BRK.B -> BRK-B,
  // BF.B -> BF-B. The roster (em-tickers.js) uses the dot form and TastyTrade a
  // slash (BRK/B), so translate here rather than adding a map entry per class
  // share. Without this yahooDaily 404s, catches, and returns [] — which
  // surfaces four layers up as the misleading "No finalized weekly candle for
  // BRK.B", leaving the ticker ungradeable in em_tracker forever.
  return s.includes('.') ? s.replace(/\./g, '-') : s;
}
async function yahooDaily(symbol, startDate, endDate) {
  const ysym = yahooSym(symbol);
  const p1 = Math.floor(new Date(startDate).getTime() / 1000);
  const p2 = Math.floor(new Date(endDate).getTime() / 1000) + 86400;
  if (!Number.isFinite(p1) || !Number.isFinite(p2)) return [];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}`
    + `?period1=${p1}&period2=${p2}&interval=1d`;
  let json;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    if (!r.ok) throw new Error(`yahoo ${r.status}`);
    json = await r.json();
  } catch (err) {
    console.warn('[tt-snapshot] yahoo daily failed:', ysym, String(err.message).slice(0, 120));
    return [];
  }
  const res = json?.chart?.result?.[0];
  const ts = res?.timestamp || [];
  const q = res?.indicators?.quote?.[0] || {};
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const close = Number(q.close?.[i]);
    if (!Number.isFinite(close) || !(close > 0)) continue;
    out.push({
      time: ts[i] * 1000,
      open: Number(q.open?.[i]) || close,
      high: Number(q.high?.[i]) || close,
      low: Number(q.low?.[i]) || close,
      close,
      volume: Number(q.volume?.[i]) || 0,
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}
const fetchStockDailyHistoryTheta = (symbol, startDate, endDate) => yahooDaily(symbol, startDate, endDate);
const fetchIndexDailyHistoryTheta = (symbol, startDate, endDate) => yahooDaily(symbol, startDate, endDate);

// ── stubs: no TT/free equivalent (per-option history) ───────────────────────
// Return benign empties (all call sites already .catch/guard) so daily crons run
// and only historical-backfill / premium-popup detail degrade. Warn once each.
const _warned = new Set();
function warnOnce(fn) {
  if (_warned.has(fn)) return;
  _warned.add(fn);
  console.warn(`[tt-snapshot] ${fn}: no TastyTrade equivalent (Theta off) — returning empty; backfill/detail for this leg is paused until DATA_SOURCE=theta.`);
}
const fetchOptionDailyHistoryTheta = async () => { warnOnce('fetchOptionDailyHistoryTheta'); return []; };
const fetchEodHistoryTheta = async () => { warnOnce('fetchEodHistoryTheta'); return []; };
const fetchOiHistoryTheta = async () => { warnOnce('fetchOiHistoryTheta'); return new Map(); };
const fetchGreeksEodHistoryTheta = async () => { warnOnce('fetchGreeksEodHistoryTheta'); return new Map(); };
const fetchIndexEodTheta = async () => { warnOnce('fetchIndexEodTheta'); return null; };
const fetchStockEodTheta = async () => { warnOnce('fetchStockEodTheta'); return null; };

module.exports = {
  fetchChainTheta,
  fetchOpenInterestTheta,
  fetchVolumeTheta,
  fetchGreeksTheta,
  fetchQuoteTheta,
  buildExpiryRows,
  fetchIndexPriceTheta,
  fetchStockQuoteTheta,
  fetchStockSpotTheta,
  fetchStockDailyHistoryTheta,
  fetchIndexDailyHistoryTheta,
  // benign stubs (no TT equivalent)
  fetchOptionDailyHistoryTheta,
  fetchEodHistoryTheta,
  fetchOiHistoryTheta,
  fetchGreeksEodHistoryTheta,
  fetchIndexEodTheta,
  fetchStockEodTheta,
};
