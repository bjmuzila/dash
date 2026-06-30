'use strict';
/**
 * server-v2/proxy-thetadata.js  (Phase 1 — REST adapter, behind DATA_SOURCE flag)
 *
 * OPTIONS + INDEX ingestion from ThetaData, producing the SAME internal rows the
 * computation layer (gex-calculator / vex-chex / flow-processor) already consumes.
 * The migration is entirely in this left-edge adapter; nothing downstream changes.
 *
 * This first pass is REST-only (chain / OI / greeks snapshots). The option Trade
 * stream (FPSS WS) is a later pass and lands here too. Futures stay on TT/dxLink.
 *
 * Validated Phase 0 (2026-06-29, see docs/THETADATA_MIGRATION.md §9b):
 *   - v3 renamed query param `root` -> `symbol`; expiration is `YYYY-MM-DD`.
 *   - REST returns CSV by default (we request &format=json for robust parsing).
 *   - REST strikes are in DOLLARS ("7600.000"); the x1000 1/10-cent encoding is
 *     STREAMING-ONLY and must never be applied to REST params.
 *   - OPRA OI snapshot is a once-daily ~06:30 ET value; empty != zero.
 *   - Theta uses SPXW (weeklies, where 0DTE lives) and SPX (AM monthly) as
 *     DISTINCT roots — never collapse them.
 */

const WebSocket = require('ws');
const { THETA_BASE_URL, THETA_WS_URL } = require('./config/data-source');
const { dteFromIso } = require('./computation/utils');

const SYMBOL = (process.env.SYMBOL || 'SPX').toUpperCase();
// 0DTE/weeklies live on the SPXW root on Theta. Keep SPX (monthly AM-settled)
// separate. For a generic underlying we pass it through; only SPX maps to SPXW.
function thetaRoot(underlying = SYMBOL) {
  const u = String(underlying || SYMBOL).toUpperCase();
  if (u === 'SPX' || u === 'SPXW') return 'SPXW';
  return u;
}

// ---------------------------------------------------------------------------
// Low-level v3 REST. Theta serves JSON when asked; we ask. Errors surface the
// body so the FREE-tier "requires a value subscription" gate is legible.
// ---------------------------------------------------------------------------
async function thetaGet(pathAndQuery) {
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const url = `${THETA_BASE_URL}${pathAndQuery}${sep}format=json`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Theta GET ${pathAndQuery} -> ${res.status} ${text.slice(0, 240)}`);
  }
  // Theta's permission/upgrade messages come back 200 with a plaintext body, not
  // JSON — detect and throw so callers don't silently parse an error as data.
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    throw new Error(`Theta ${pathAndQuery} non-JSON (tier/permission?): ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

/**
 * Theta v3 JSON responses are { header: { format: [...] }, response: [[...row]] }.
 * Map each row array into an object keyed by the declared column names.
 */
function rowsFromV3(json) {
  const fmt = json?.header?.format || json?.format;
  const resp = json?.response || json?.data || [];
  if (Array.isArray(fmt)) {
    return resp.map((row) => {
      const o = {};
      fmt.forEach((col, i) => { o[col] = row[i]; });
      return o;
    });
  }
  // Some endpoints already return arrays of objects.
  return Array.isArray(resp) ? resp : [];
}

/**
 * Snapshot endpoints (open_interest, greeks, quote) return a NESTED JSON shape:
 *   { response: [ { contract:{right,expiration,symbol,strike}, data:[{...}] } ] }
 * (The CSV variant flattens this; JSON does not.) Flatten each entry into one
 * row = contract fields + the latest data row's fields. Returns [] for the
 * list/* endpoints whose rows are already flat objects.
 */
function flatSnapshotRows(json) {
  const resp = json?.response || [];
  if (!Array.isArray(resp)) return [];
  const out = [];
  for (const entry of resp) {
    if (entry && entry.contract && Array.isArray(entry.data)) {
      const last = entry.data[entry.data.length - 1] || {};
      out.push({ ...entry.contract, ...last });
    } else if (entry && typeof entry === 'object') {
      out.push(entry); // already flat
    }
  }
  return out;
}

const rightToType = (r) => (String(r || '').toUpperCase().startsWith('C') ? 'C' : 'P');
const keyOf = (expIso, strike, type) => `${expIso}|${Number(strike)}|${type}`;

// ---------------------------------------------------------------------------
// Chain structure: expirations + strikes  (mirror of TT fetchChain output)
//   returns { expirations:string[], contracts:[{expiration,strike,type,dte}] }
// Note: drops streamerSymbol/occSymbol — Theta keys by root+exp+strike+right.
// ---------------------------------------------------------------------------
async function fetchChainTheta(underlying = SYMBOL) {
  const root = thetaRoot(underlying);
  const expJson = await thetaGet(`/v3/option/list/expirations?symbol=${encodeURIComponent(root)}`);
  const expRows = rowsFromV3(expJson);
  // expiration column is YYYY-MM-DD (Phase 0 confirmed). Only future-or-today.
  const today = new Date().toISOString().slice(0, 10);
  const expirations = [...new Set(expRows.map((r) => r.expiration))]
    .filter((e) => e && e >= today)
    .sort();

  const contracts = [];
  for (const expiration of expirations) {
    const strikeJson = await thetaGet(
      `/v3/option/list/strikes?symbol=${encodeURIComponent(root)}&expiration=${expiration}`,
    );
    const dte = dteFromIso(expiration);
    for (const row of rowsFromV3(strikeJson)) {
      const strike = Number(row.strike);
      if (!(strike > 0)) continue;
      // Theta lists a strike once; both rights exist on the chain. Emit C and P
      // rows to match the TT contract list shape (one row per side).
      contracts.push({ expiration, strike, type: 'C', dte });
      contracts.push({ expiration, strike, type: 'P', dte });
    }
  }
  return { expirations, contracts, root };
}

// ---------------------------------------------------------------------------
// Whole-chain OPRA OI snapshot for one expiration.
//   returns Map keyed by `exp|strike|type` -> { oi }
// Empty response (pre-06:30 / weekend / holiday) is a legit "reuse yesterday's",
// NOT zero — caller must preserve a known OI rather than overwrite with empty.
// ---------------------------------------------------------------------------
async function fetchOpenInterestTheta(underlying = SYMBOL, expiration) {
  const root = thetaRoot(underlying);
  const out = new Map();
  const json = await thetaGet(
    `/v3/option/snapshot/open_interest?symbol=${encodeURIComponent(root)}&expiration=${expiration}`,
  );
  for (const row of flatSnapshotRows(json)) {
    const type = rightToType(row.right);
    const strike = Number(row.strike);
    if (!(strike > 0)) continue;
    out.set(keyOf(row.expiration || expiration, strike, type), {
      oi: Number(row.open_interest) || 0,
    });
  }
  return out; // may be empty pre-06:30 — caller treats empty as "no update"
}

// ---------------------------------------------------------------------------
// Whole-chain day-VOLUME snapshot for one expiration.
//   returns Map keyed by `exp|strike|type` -> volume (number)
// OHLC snapshot carries today's traded volume per contract. Like OI, an empty
// response (pre-open / weekend) is "no update" — caller preserves prior volume.
// Feeds netVolGEX (the Vol-Only column); without it Volume Net GEX is blank.
// ---------------------------------------------------------------------------
async function fetchVolumeTheta(underlying = SYMBOL, expiration) {
  const root = thetaRoot(underlying);
  const out = new Map();
  const json = await thetaGet(
    `/v3/option/snapshot/ohlc?symbol=${encodeURIComponent(root)}&expiration=${expiration}`,
  );
  // The OHLC snapshot returns each contract's LAST available bar. For strikes
  // that traded today the bar is today's; for untraded strikes it's a stale bar
  // from a prior session (e.g. last week). Counting that stale volume spikes
  // vol-GEX on near-untraded expiries, so only keep volume whose bar timestamp
  // is today's date — otherwise treat it as 0 (no volume this session).
  const todayIso = new Date().toISOString().slice(0, 10);
  for (const row of flatSnapshotRows(json)) {
    const type = rightToType(row.right);
    const strike = Number(row.strike);
    if (!(strike > 0)) continue;
    const isToday = String(row.timestamp || '').slice(0, 10) === todayIso;
    const vol = isToday ? (Number(row.volume ?? row.day_volume) || 0) : 0;
    out.set(keyOf(row.expiration || expiration, strike, type), vol);
  }
  return out; // may be empty pre-open — caller treats empty as "no update"
}

// ---------------------------------------------------------------------------
// Whole-chain greeks snapshot (first-order + IV) for one expiration.
//   returns Map keyed by `exp|strike|type` -> { gamma, delta, theta, vega, iv }
// Theta primary for OPTIONS greeks (per user). Vanna/charm stay BS-derived
// downstream — Theta's standard greeks don't include them (doc §5.2).
// ---------------------------------------------------------------------------
async function fetchGreeksTheta(underlying = SYMBOL, expiration) {
  const root = thetaRoot(underlying);
  const out = new Map();
  // v3 route uses a SLASH not underscore: greeks/all (NOT greeks_all). GEX needs
  // GAMMA, which is a second-order greek — it is NOT in greeks/first_order
  // (delta/theta/vega/rho only). greeks/all carries gamma for every strike in one
  // call, which is exactly what kills the GREEKS_READY_RATIO warm-up gate.
  const json = await thetaGet(
    `/v3/option/snapshot/greeks/all?symbol=${encodeURIComponent(root)}&expiration=${expiration}`,
  );
  for (const row of flatSnapshotRows(json)) {
    const type = rightToType(row.right);
    const strike = Number(row.strike);
    if (!(strike > 0)) continue;
    out.set(keyOf(row.expiration || expiration, strike, type), {
      gamma: Number(row.gamma),
      delta: Number(row.delta),
      theta: Number(row.theta),
      vega: Number(row.vega),
      // Theta names it implied_vol (first_order) / implied_volatility (varies);
      // accept either.
      iv: Number(row.implied_vol ?? row.implied_volatility ?? row.iv),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Convenience: build a fully-populated row set for one expiration the way the
// computation layer wants it — chain x {oi, greeks}. Empty OI is preserved as
// undefined (caller keeps the prior value), never coerced to 0.
// ---------------------------------------------------------------------------
async function buildExpiryRows(underlying = SYMBOL, expiration) {
  const [{ contracts }, oiMap, greekMap] = await Promise.all([
    fetchChainTheta(underlying).then((c) => ({
      contracts: c.contracts.filter((k) => k.expiration === expiration),
    })),
    fetchOpenInterestTheta(underlying, expiration).catch(() => new Map()),
    fetchGreeksTheta(underlying, expiration).catch(() => new Map()),
  ]);
  return contracts.map((c) => {
    const k = keyOf(c.expiration, c.strike, c.type);
    const oi = oiMap.get(k);
    const g = greekMap.get(k) || {};
    return {
      expiration: c.expiration,
      strike: c.strike,
      type: c.type,
      dte: c.dte,
      oi: oi ? oi.oi : undefined, // undefined = no OPRA update yet (reuse prior)
      gamma: Number.isFinite(g.gamma) ? g.gamma : undefined,
      delta: Number.isFinite(g.delta) ? g.delta : undefined,
      theta: Number.isFinite(g.theta) ? g.theta : undefined,
      vega: Number.isFinite(g.vega) ? g.vega : undefined,
      iv: Number.isFinite(g.iv) ? g.iv : undefined,
      source: 'theta',
    };
  });
}

// ---------------------------------------------------------------------------
// Historical backfill (Phase 5). EOD report + OI history for a single date.
// Both return the nested {contract,data[]} shape → flatSnapshotRows. Strike in
// dollars; right CALL/PUT. `strike_range=n` trims to ±n strikes around that
// date's spot server-side (no need to know historical spot up front).
// ---------------------------------------------------------------------------
const ymdCompact = (iso) => String(iso).replace(/-/g, '');

async function fetchEodHistoryTheta(underlying, date, { strikeRange = 40, maxDte } = {}) {
  const root = thetaRoot(underlying);
  const d = ymdCompact(date);
  let q = `/v3/option/history/eod?symbol=${encodeURIComponent(root)}&expiration=*&start_date=${d}&end_date=${d}&strike_range=${strikeRange}`;
  if (maxDte != null) q += `&max_dte=${maxDte}`;
  const json = await thetaGet(q);
  // one row per contract; take the single EOD data point
  return flatSnapshotRows(json).map((r) => ({
    expiration: r.expiration,
    strike: Number(r.strike),
    type: rightToType(r.right),
    close: Number(r.close),
    volume: Number(r.volume) || 0,
    bid: Number(r.bid),
    ask: Number(r.ask),
  })).filter((r) => r.strike > 0);
}

async function fetchOiHistoryTheta(underlying, date, { strikeRange = 40 } = {}) {
  const root = thetaRoot(underlying);
  const d = ymdCompact(date);
  const json = await thetaGet(
    `/v3/option/history/open_interest?symbol=${encodeURIComponent(root)}&expiration=*&start_date=${d}&end_date=${d}&strike_range=${strikeRange}`,
  );
  const out = new Map(); // `exp|strike|type` -> oi
  for (const r of flatSnapshotRows(json)) {
    const strike = Number(r.strike);
    if (!(strike > 0)) continue;
    out.set(`${r.expiration}|${strike}|${rightToType(r.right)}`, Number(r.open_interest) || 0);
  }
  return out;
}

/**
 * Historical EOD greeks for the whole chain on one date (greeks-true backfill).
 * Path mirrors the snapshot slash convention: history/greeks/eod (the docs'
 * `greeks_eod` is an operationId). Tries the slash form, falls back to underscore.
 * Returns Map `exp|strike|type` -> { gamma, delta }. PRO-gated; caller catches.
 */
async function fetchGreeksEodHistoryTheta(underlying, date, { strikeRange = 40 } = {}) {
  const root = thetaRoot(underlying);
  const d = ymdCompact(date);
  const qs = `symbol=${encodeURIComponent(root)}&expiration=*&start_date=${d}&end_date=${d}&strike_range=${strikeRange}`;
  let json;
  try {
    json = await thetaGet(`/v3/option/history/greeks/eod?${qs}`);
  } catch (e) {
    json = await thetaGet(`/v3/option/history/greeks_eod?${qs}`);
  }
  const out = new Map();
  for (const r of flatSnapshotRows(json)) {
    const strike = Number(r.strike);
    if (!(strike > 0)) continue;
    out.set(`${r.expiration}|${strike}|${rightToType(r.right)}`, {
      gamma: Number(r.gamma),
      delta: Number(r.delta),
    });
  }
  return out;
}

/**
 * Real-time index price snapshot (SPX/VIX). Needs Index Standard+. Returns the
 * last price, or null if unavailable/gated. Index ticks only on change, so this
 * is the authoritative last value (no staleness inference needed).
 */
async function fetchIndexPriceTheta(symbol) {
  const json = await thetaGet(`/v3/index/snapshot/price?symbol=${encodeURIComponent(symbol)}`);
  const rows = rowsFromV3(json);
  const price = Number(rows[0]?.price);
  return price > 0 ? price : null;
}

/**
 * Real-time stock quote snapshot (equities only — never indices/futures).
 * v3 stock snapshot returns bid/ask + prev-close; mark = midpoint. Returns
 * { last, mark, close, prevClose } shaped like fetchUnderlyingQuotes' assign(),
 * or null if unavailable/gated so the caller can fall back to TT.
 */
async function fetchStockQuoteTheta(symbol) {
  const json = await thetaGet(
    `/v3/stock/snapshot/quote?symbol=${encodeURIComponent(String(symbol).toUpperCase())}`,
  );
  const r = rowsFromV3(json)[0] || {};
  const bid = Number(r.bid), ask = Number(r.ask);
  const mark = bid > 0 && ask > 0 ? (bid + ask) / 2 : Number(r.last ?? r.price);
  const last = Number(r.last ?? r.price ?? mark);
  const prevClose = Number(r.prev_close ?? r.prevClose);
  if (!(last > 0) && !(mark > 0)) return null;
  return {
    last: last > 0 ? last : mark,
    mark: mark > 0 ? mark : last,
    close: Number(r.close) > 0 ? Number(r.close) : 0,
    prevClose: prevClose > 0 ? prevClose : 0,
  };
}

async function fetchIndexEodTheta(symbol, date) {
  const d = ymdCompact(date);
  const json = await thetaGet(
    `/v3/index/history/eod?symbol=${encodeURIComponent(symbol)}&start_date=${d}&end_date=${d}`,
  );
  const rows = rowsFromV3(json);
  const close = Number(rows[0]?.close);
  return close > 0 ? close : null;
}

// EOD close for an equity (SPY/QQQ) on a past date. Mirrors fetchIndexEodTheta
// but on the stock history route. Returns the close, or null if unavailable.
async function fetchStockEodTheta(symbol, date) {
  const d = ymdCompact(date);
  const json = await thetaGet(
    `/v3/stock/history/eod?symbol=${encodeURIComponent(String(symbol).toUpperCase())}&start_date=${d}&end_date=${d}`,
  );
  const rows = rowsFromV3(json);
  const close = Number(rows[0]?.close);
  return close > 0 ? close : null;
}

// ---------------------------------------------------------------------------
// Streaming symbology helpers
// ---------------------------------------------------------------------------
// Streaming strike is 1/10th of a cent: $7600 -> 7600000. (REST uses dollars;
// don't cross the wires — Phase 0 §9b.)
const toThetaStreamStrike = (dollars) => Math.round(Number(dollars) * 1000);
const fromThetaStreamStrike = (tenthCents) => Number(tenthCents) / 1000;
// Theta exp is a YYYYMMDD int on the stream; REST is YYYY-MM-DD.
const toThetaStreamExp = (iso) => Number(String(iso).replace(/-/g, ''));

/**
 * Synthesize the dxLink-style streamer symbol that FlowProcessor.parseOptionSymbol
 * decodes (`.ROOT YYMMDD C/P STRIKE`, e.g. ".SPXW260629C7600"). Theta gives us
 * root/exp/strike/right; we reuse the SAME string format the TT path emits so
 * addPrint() and the SPX-only tape filter work unchanged.
 */
function streamerSymbolFromContract({ root, expiration, strike, right }) {
  const expInt = String(expiration); // "20260629"
  const yymmdd = expInt.slice(2); // "260629"
  const cp = String(right).toUpperCase().startsWith('C') ? 'C' : 'P';
  // strike here is in DOLLARS already (we convert at the call site)
  const k = Number.isInteger(strike) ? String(strike) : String(strike);
  return `.${root}${yymmdd}${cp}${k}`;
}

// ---------------------------------------------------------------------------
// FPSS streaming client (Standard+). ONE process-wide WS. Subscribes the option
// TRADE + QUOTE streams for a set of contracts, maintains a per-contract quote
// cache, and emits normalized trade prints to a callback in the exact shape
// FlowProcessor.addPrint expects: { streamerSymbol, price, size, quote, spot }.
// ---------------------------------------------------------------------------
class ThetaStreamClient {
  /**
   * @param {object} opts
   * @param {(print:{streamerSymbol:string,price:number,size:number,quote:object|null,spot:number})=>void} opts.onTrade
   * @param {() => number} [opts.getSpot] supplies current spot for each print
   */
  constructor({ onTrade, onIndex, getSpot = () => 0 } = {}) {
    this.onTrade = onTrade;
    this.onIndex = onIndex; // (root, price) => void  — index price ticks (SPX/VIX)
    this.getSpot = getSpot;
    // Per-root spot overrides for non-SPX flow (MultiFlowManager fills these so
    // isOtm is computed against the correct underlying, not SPX). thetaRoot key.
    this.rootSpot = new Map();
    this.ws = null;
    this.nextId = 1;
    this.connected = false;
    this.closing = false;
    // contractKey `root|expInt|strikeTenthCents|C|P` -> { bid, ask, t, streamerSymbol, strikeDollars, root }
    this.quotes = new Map();
    // remember subscriptions so we can resubscribe on reconnect
    this.subs = []; // [{root, expInt, strikeTenthCents, right}]
    this.indexSubs = []; // ["SPX","VIX"] index roots to (re)subscribe
  }

  _ckey(root, expInt, strikeTenthCents, right) {
    return `${root}|${expInt}|${strikeTenthCents}|${right}`;
  }

  connect() {
    if (this.ws) return;
    this.closing = false;
    const ws = new WebSocket(THETA_WS_URL);
    this.ws = ws;
    ws.on('open', () => {
      this.connected = true;
      console.log(`[THETA-WS] connected ${THETA_WS_URL}`);
      // (re)subscribe everything we know about
      const pending = this.subs.slice();
      this.subs = [];
      for (const s of pending) this.subscribeContract(s, /*record*/ true);
      const idx = this.indexSubs.slice();
      this.indexSubs = [];
      for (const root of idx) this.subscribeIndex(root, /*record*/ true);
    });
    ws.on('message', (buf) => this._onMessage(buf));
    ws.on('close', () => {
      this.connected = false;
      this.ws = null;
      if (this.closing) return;
      console.warn('[THETA-WS] closed — reconnecting in 2s');
      setTimeout(() => this.connect(), 2000);
    });
    ws.on('error', (e) => {
      console.warn('[THETA-WS] error:', String(e?.message || e).slice(0, 160));
      try { ws.close(); } catch { /* noop */ }
    });
  }

  _send(obj) {
    if (this.ws && this.connected) {
      try { this.ws.send(JSON.stringify(obj)); } catch { /* noop */ }
    }
  }

  /**
   * Subscribe TRADE + QUOTE for one contract.
   * @param {{root,expInt,strikeTenthCents,right}} c
   */
  subscribeContract(c, record = true) {
    if (record) this.subs.push(c);
    if (!this.connected) return; // will flush on open
    for (const req_type of ['TRADE', 'QUOTE']) {
      this._send({
        msg_type: 'STREAM',
        sec_type: 'OPTION',
        req_type,
        add: true,
        id: this.nextId++, // MUST increment per request (auto-resubscribe relies on it)
        contract: {
          root: c.root,
          expiration: String(c.expInt),
          strike: String(c.strikeTenthCents),
          right: c.right,
        },
      });
    }
  }

  /**
   * Subscribe a batch of active contracts (dollars-strike + ISO exp in, encoded here).
   * @param {Array<{strike:number,type:'C'|'P',expiration:string}>} contracts
   * @param {string} root e.g. "SPXW"
   */
  subscribeActive(contracts, root) {
    for (const k of contracts) {
      const expInt = toThetaStreamExp(k.expiration);
      const strikeTenthCents = toThetaStreamStrike(k.strike);
      const right = k.type === 'C' ? 'C' : 'P';
      const ckey = this._ckey(root, expInt, strikeTenthCents, right);
      // Already subscribed (seeded quote cache) — skip so repeated window-shift
      // calls don't bloat this.subs with duplicates or re-send TRADE+QUOTE.
      if (this.quotes.has(ckey)) continue;
      // seed the quote cache entry so trades before the first quote still resolve
      this.quotes.set(ckey, {
        bid: null, ask: null, t: 0,
        streamerSymbol: streamerSymbolFromContract({ root, expiration: expInt, strike: k.strike, right }),
        strikeDollars: k.strike, root,
      });
      this.subscribeContract({ root, expInt, strikeTenthCents, right });
    }
    console.log(`[THETA-WS] subscribed ${contracts.length} contracts (TRADE+QUOTE) root=${root}`);
  }

  /**
   * Subscribe an index price stream (SPX / VIX). sec_type INDEX, req_type TRADE,
   * contract is just { root }. Index reports ~1/sec and ONLY on price change.
   */
  subscribeIndex(root, record = true) {
    if (record && !this.indexSubs.includes(root)) this.indexSubs.push(root);
    if (!this.connected) return;
    this._send({
      msg_type: 'STREAM',
      sec_type: 'INDEX',
      req_type: 'TRADE',
      add: true,
      id: this.nextId++,
      contract: { root },
    });
    console.log(`[THETA-WS] subscribed INDEX price stream root=${root}`);
  }

  _onMessage(buf) {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    const type = msg?.header?.type;
    const contract = msg?.contract;
    if (!contract) return;

    // Index price tick (SPX/VIX): sec_type INDEX, no strike/right. Handle first
    // and return — the option-contract logic below assumes strike/right exist.
    if (contract.security_type === 'INDEX' || (contract.root && contract.strike == null && contract.right == null)) {
      if (type === 'TRADE' && msg.trade) {
        const price = Number(msg.trade.price);
        if (price > 0 && this.onIndex) {
          try { this.onIndex(contract.root, price); } catch { /* never kill the socket */ }
        }
      }
      return;
    }

    const root = contract.root;
    const expInt = contract.expiration;
    const strikeTenthCents = contract.strike;
    const right = String(contract.right).toUpperCase().startsWith('C') ? 'C' : 'P';
    const ckey = this._ckey(root, expInt, strikeTenthCents, right);
    let cache = this.quotes.get(ckey);
    if (!cache) {
      // unsolicited / not pre-seeded — build a cache entry on the fly
      cache = {
        bid: null, ask: null, t: 0,
        streamerSymbol: streamerSymbolFromContract({ root, expiration: expInt, strike: fromThetaStreamStrike(strikeTenthCents), right }),
        strikeDollars: fromThetaStreamStrike(strikeTenthCents), root,
      };
      this.quotes.set(ckey, cache);
    }

    if (type === 'QUOTE' && msg.quote) {
      const bid = Number(msg.quote.bid);
      const ask = Number(msg.quote.ask);
      if (Number.isFinite(bid)) cache.bid = bid;
      if (Number.isFinite(ask)) cache.ask = ask;
      cache.t = Date.now();
      return;
    }

    if (type === 'TRADE' && msg.trade) {
      const price = Number(msg.trade.price);
      const size = Number(msg.trade.size);
      if (!(price > 0) || !(size > 0)) return;
      const quote = (cache.bid != null && cache.ask != null)
        ? { bid: cache.bid, ask: cache.ask, t: cache.t }
        : null;
      // Prefer a per-root spot (set by MultiFlowManager for non-SPX roots) so
      // isOtm is correct; fall back to the SPX getSpot() for the core engine.
      const rootSpot = this.rootSpot.get(root);
      try {
        this.onTrade({
          streamerSymbol: cache.streamerSymbol,
          price,
          size,
          quote,
          spot: (rootSpot > 0 ? rootSpot : this.getSpot()) || 0,
        });
      } catch { /* never let one bad print kill the socket */ }
    }
  }

  close() {
    this.closing = true;
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
    this.connected = false;
  }
}

module.exports = {
  thetaRoot,
  thetaGet,
  rowsFromV3,
  fetchChainTheta,
  fetchOpenInterestTheta,
  fetchVolumeTheta,
  fetchGreeksTheta,
  buildExpiryRows,
  toThetaStreamStrike,
  toThetaStreamExp,
  streamerSymbolFromContract,
  ThetaStreamClient,
  fetchEodHistoryTheta,
  fetchOiHistoryTheta,
  fetchIndexEodTheta,
  fetchStockEodTheta,
  fetchGreeksEodHistoryTheta,
  fetchIndexPriceTheta,
  fetchStockQuoteTheta,
};
