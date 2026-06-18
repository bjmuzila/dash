'use strict';
/**
 * server-v2/proxy-tastytrade.js
 *
 * Data fetching from Tastytrade + dxLink (dxFeed).
 *
 *   1. OAuth: exchange TT_REFRESH_TOKEN -> short-lived access token.
 *   2. REST: fetch SPX nested option chain (expirations + strikes).
 *   3. dxLink: get an API quote token, open the streamer WS, run the
 *      SETUP -> AUTH -> CHANNEL_REQUEST -> FEED_SETUP -> FEED_SUBSCRIPTION
 *      handshake, and ingest Quote / Summary / Greeks / Trade events.
 *   4. Compute greeks locally (Black-Scholes) from spot + IV + mid price.
 *   5. Build flat option rows and write GEX/flow results into market-state.
 *
 * This module is self-contained and writes ONLY to ./state/market-state.
 * It does not start an HTTP/WS server and is not wired into the app — the
 * entry point (server-with-proxy.js) decides when/whether to start it.
 *
 * Requires the `ws` package (already a dependency of the project).
 */

const WebSocket = require('ws');

const marketState = require('./state/market-state');
const { computeGexSummary } = require('./computation/gex-calculator');
const { emptyTotals, accumulateExposureTotals } = require('./computation/vex-chex');
const { FlowProcessor } = require('./computation/flow-processor');
const {
  parseOptionSymbol,
  yearsToExpiry,
  dteFromIso,
  bsGreeks,
  impliedVol,
  firstFiniteNumber,
  todayYmd,
} = require('./computation/utils');

const TT_BASE_URL = process.env.TT_BASE_URL || 'https://api.tastytrade.com';
const TT_CLIENT_ID = process.env.TT_CLIENT_ID || process.env.CLIENT_ID;
const TT_CLIENT_SECRET = process.env.TT_CLIENT_SECRET || process.env.CLIENT_SECRET;
const TT_REFRESH_TOKEN = process.env.TT_REFRESH_TOKEN || process.env.REFRESH_TOKEN;
const DXLINK_WS_URL = process.env.DXFEED_WS_URL || 'wss://tasty-openapi-ws.dxfeed.com/realtime';

const SYMBOL = 'SPX';
const RISK_FREE = Number(process.env.RISK_FREE_RATE || 0.045);
// Strike window around spot (in points) to subscribe — keeps dxLink load sane.
const STRIKE_WINDOW = Number(process.env.STRIKE_WINDOW || 400);
const RECOMPUTE_MS = Number(process.env.RECOMPUTE_MS || 2000);

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

let accessToken = null;
let accessTokenExp = 0;

async function getAccessToken() {
  const now = Date.now();
  if (accessToken && now < accessTokenExp - 30000) return accessToken;
  if (!TT_REFRESH_TOKEN || !TT_CLIENT_SECRET || !TT_CLIENT_ID) {
    throw new Error('Missing TT_REFRESH_TOKEN / TT_CLIENT_SECRET / TT_CLIENT_ID');
  }
  // Tastytrade OAuth2 token endpoint authenticates the client via HTTP Basic
  // (client_id:client_secret in the Authorization header). Credentials in the
  // body are rejected at the gateway with an nginx 401. The body carries only
  // the grant.
  // Defensive trim: a trailing newline/space in an env var corrupts the Basic
  // header or the grant body (a common cause of nginx 401 vs a working curl).
  const cid = String(TT_CLIENT_ID).trim();
  const csecret = String(TT_CLIENT_SECRET).trim();
  const rtoken = String(TT_REFRESH_TOKEN).trim();

  console.log('[OAUTH] lens', {
    base: TT_BASE_URL,
    cid: cid.length,
    csecret: csecret.length,
    rtoken: rtoken.length,
    cidHead: cid.slice(0, 8),
  });

  const basic = Buffer.from(`${cid}:${csecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: rtoken,
  }).toString();

  const r = await fetch(`${TT_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  const text = await r.text().catch(() => '');
  if (!r.ok) {
    throw new Error(`OAuth failed: ${r.status} ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text);
  accessToken = json.access_token;
  accessTokenExp = now + (json.expires_in ? json.expires_in * 1000 : 15 * 60 * 1000);
  marketState.setStatus({ ttAuthenticated: true });
  return accessToken;
}

async function ttGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`${TT_BASE_URL}${path}`, {
    headers: { Authorization: token, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`TT GET ${path} -> ${res.status} ${await res.text().catch(() => '')}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Option chain
// ---------------------------------------------------------------------------

/**
 * Fetch the SPX nested option chain.
 * @returns {Promise<{expirations:string[], contracts:Array}>}
 *   contracts: { streamerSymbol, expiration, strike, type, dte }
 */
async function fetchChain() {
  const json = await ttGet(`/option-chains/${SYMBOL}/nested`);
  const items = json?.data?.items || [];
  const contracts = [];
  const expSet = new Set();

  for (const item of items) {
    for (const exp of item.expirations || []) {
      const expiration = exp['expiration-date'];
      if (!expiration) continue;
      expSet.add(expiration);
      const dte = dteFromIso(expiration);
      for (const strikeObj of exp.strikes || []) {
        const strike = Number(strikeObj['strike-price']);
        if (!(strike > 0)) continue;
        if (strikeObj['call-streamer-symbol']) {
          contracts.push({
            streamerSymbol: strikeObj['call-streamer-symbol'],
            expiration,
            strike,
            type: 'C',
            dte,
          });
        }
        if (strikeObj['put-streamer-symbol']) {
          contracts.push({
            streamerSymbol: strikeObj['put-streamer-symbol'],
            expiration,
            strike,
            type: 'P',
            dte,
          });
        }
      }
    }
  }

  const expirations = [...expSet].sort();
  return { expirations, contracts };
}

/** Get a dxLink API quote token + url from Tastytrade. */
async function getQuoteToken() {
  const json = await ttGet('/api-quote-tokens');
  const token = json?.data?.token;
  const url = json?.data?.['dxlink-url'] || DXLINK_WS_URL;
  if (!token) throw new Error('No dxLink quote token returned');
  return { token, url };
}

// ---------------------------------------------------------------------------
// dxLink client
// ---------------------------------------------------------------------------

class DxLinkClient {
  constructor({ url, token, onEvent, onStatus }) {
    this.url = url;
    this.token = token;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.ws = null;
    this.channel = 1;
    this.keepalive = null;
    this.authed = false;
    this.pending = []; // symbols queued before channel is open
    this.channelOpen = false;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.on('open', () => this._send({ type: 'SETUP', channel: 0, version: '0.1-js', keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 }));
    this.ws.on('message', (raw) => this._onMessage(raw));
    this.ws.on('close', () => {
      this.authed = false;
      this.channelOpen = false;
      this._stopKeepalive();
      this.onStatus?.({ dxlinkConnected: false });
    });
    this.ws.on('error', (err) => {
      this.onStatus?.({ dxlinkConnected: false, lastError: `dxlink: ${err.message}` });
    });
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.type) {
      case 'SETUP':
        // Server SETUP ack — now authorize.
        this._send({ type: 'AUTH', channel: 0, token: this.token });
        break;
      case 'AUTH_STATE':
        if (msg.state === 'AUTHORIZED') {
          this.authed = true;
          this.onStatus?.({ dxlinkConnected: true });
          this._startKeepalive();
          this._send({ type: 'CHANNEL_REQUEST', channel: this.channel, service: 'FEED', parameters: { contract: 'AUTO' } });
        }
        break;
      case 'CHANNEL_OPENED':
        if (msg.channel === this.channel) {
          this._send({
            type: 'FEED_SETUP',
            channel: this.channel,
            acceptAggregationPeriod: 1,
            acceptDataFormat: 'COMPACT',
            acceptEventFields: {
              Quote: ['eventType', 'eventSymbol', 'bidPrice', 'askPrice', 'bidSize', 'askSize'],
              Greeks: ['eventType', 'eventSymbol', 'volatility', 'delta', 'gamma', 'theta', 'vega', 'rho'],
              Summary: ['eventType', 'eventSymbol', 'openInterest', 'dayVolume', 'prevDayClosePrice'],
              Trade: ['eventType', 'eventSymbol', 'price', 'size', 'dayVolume'],
            },
          });
          this.channelOpen = true;
          if (this.pending.length) {
            this.subscribe(this.pending.splice(0));
          }
        }
        break;
      case 'FEED_CONFIG':
        break;
      case 'FEED_DATA':
        this._handleFeedData(msg.data);
        break;
      case 'KEEPALIVE':
        break;
      default:
        break;
    }
  }

  /**
   * COMPACT feed data is [eventTypeName, [field, field, ...], eventTypeName, [...]].
   * Each field array is flat: values laid out per the FEED_SETUP field order.
   */
  _handleFeedData(data) {
    if (!Array.isArray(data)) return;
    for (let i = 0; i < data.length; i += 2) {
      const eventType = data[i];
      const values = data[i + 1];
      if (!Array.isArray(values)) continue;
      const fields = COMPACT_FIELDS[eventType];
      if (!fields) continue;
      const stride = fields.length;
      for (let off = 0; off + stride <= values.length; off += stride) {
        const ev = { eventType };
        for (let f = 0; f < stride; f++) ev[fields[f]] = values[off + f];
        this.onEvent?.(ev);
      }
    }
  }

  /** Subscribe to a list of {type, symbol} or raw symbol strings. */
  subscribe(symbols) {
    if (!this.channelOpen) {
      this.pending.push(...symbols);
      return;
    }
    const add = symbols.flatMap((s) => {
      const sym = typeof s === 'string' ? s : s.symbol;
      // One subscription per event type we care about.
      return ['Quote', 'Greeks', 'Summary', 'Trade'].map((type) => ({ type, symbol: sym }));
    });
    // dxLink limits message size — chunk it.
    const CHUNK = 500;
    for (let i = 0; i < add.length; i += CHUNK) {
      this._send({ type: 'FEED_SUBSCRIPTION', channel: this.channel, add: add.slice(i, i + CHUNK) });
    }
  }

  _startKeepalive() {
    this._stopKeepalive();
    this.keepalive = setInterval(() => this._send({ type: 'KEEPALIVE', channel: 0 }), 30000);
  }

  _stopKeepalive() {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
  }

  close() {
    this._stopKeepalive();
    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
  }
}

// Field order MUST match FEED_SETUP acceptEventFields above (minus eventType,
// which COMPACT still includes as element 0 of each row — we include it).
const COMPACT_FIELDS = {
  Quote: ['eventType', 'eventSymbol', 'bidPrice', 'askPrice', 'bidSize', 'askSize'],
  Greeks: ['eventType', 'eventSymbol', 'volatility', 'delta', 'gamma', 'theta', 'vega', 'rho'],
  Summary: ['eventType', 'eventSymbol', 'openInterest', 'dayVolume', 'prevDayClosePrice'],
  Trade: ['eventType', 'eventSymbol', 'price', 'size', 'dayVolume'],
};

// ---------------------------------------------------------------------------
// Feed orchestrator
// ---------------------------------------------------------------------------

class TastytradeProxy {
  constructor() {
    this.client = null;
    this.flow = new FlowProcessor();
    this.contracts = new Map(); // streamerSymbol -> contract meta
    this.quotes = new Map(); // streamerSymbol -> { bid, ask, mid }
    this.summaries = new Map(); // streamerSymbol -> { oi, volume }
    this.spot = 0;
    this.spotSymbol = null; // underlying SPX streamer symbol
    this.expiry = '';
    this.recomputeTimer = null;
  }

  async start() {
    await getAccessToken();
    const { expirations, contracts } = await fetchChain();
    marketState.setExpirations(expirations);

    // Default expiry = nearest (0DTE if present).
    const { ymd } = todayYmd();
    this.expiry = expirations.find((e) => e >= ymd) || expirations[0] || '';
    marketState.setExpiry(this.expiry);

    // dxLink streamer symbol for the SPX index itself.
    this.spotSymbol = 'SPX'; // index quote symbol on dxFeed
    for (const c of contracts) this.contracts.set(c.streamerSymbol, c);

    const { token, url } = await getQuoteToken();
    this.client = new DxLinkClient({
      url,
      token,
      onEvent: (ev) => this._onEvent(ev),
      onStatus: (s) => marketState.setStatus(s),
    });
    this.client.connect();

    // Subscribe to spot + the active-expiry contracts in the strike window.
    this._resubscribe();

    this.recomputeTimer = setInterval(() => this._recompute(), RECOMPUTE_MS);
    return this;
  }

  /** Pick contracts for the active expiry within the strike window of spot. */
  _activeContracts() {
    const center = this.spot > 0 ? this.spot : null;
    const out = [];
    for (const c of this.contracts.values()) {
      if (c.expiration !== this.expiry) continue;
      if (center && Math.abs(c.strike - center) > STRIKE_WINDOW) continue;
      out.push(c);
    }
    return out;
  }

  _resubscribe() {
    if (!this.client) return;
    const syms = new Set([this.spotSymbol]);
    for (const c of this._activeContracts()) syms.add(c.streamerSymbol);
    this.client.subscribe([...syms]);
    marketState.setStatus({ contractsSubscribed: syms.size });
  }

  setExpiry(expiry) {
    if (!expiry || expiry === this.expiry) return;
    this.expiry = expiry;
    marketState.setExpiry(expiry);
    this._resubscribe();
  }

  _onEvent(ev) {
    marketState.setStatus({ lastFeedAt: Date.now() });
    const sym = ev.eventSymbol;
    if (!sym) return;

    if (ev.eventType === 'Quote') {
      const bid = Number(ev.bidPrice);
      const ask = Number(ev.askPrice);
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
      if (sym === this.spotSymbol) {
        if (mid > 0) {
          this.spot = mid;
          marketState.setSpot(mid);
        }
        return;
      }
      this.quotes.set(sym, { bid, ask, mid, bidSize: Number(ev.bidSize), askSize: Number(ev.askSize) });
      return;
    }

    if (ev.eventType === 'Summary') {
      this.summaries.set(sym, {
        oi: firstFiniteNumber(ev.openInterest),
        volume: firstFiniteNumber(ev.dayVolume),
        prevClose: firstFiniteNumber(ev.prevDayClosePrice),
      });
      return;
    }

    if (ev.eventType === 'Trade') {
      if (sym === this.spotSymbol) {
        const px = Number(ev.price);
        if (px > 0) {
          this.spot = px;
          marketState.setSpot(px);
        }
        return;
      }
      const quote = this.quotes.get(sym) || null;
      this.flow.addPrint({ streamerSymbol: sym, price: Number(ev.price), size: Number(ev.size), quote });
      return;
    }
    // Greeks event ignored on purpose: per chosen design we compute greeks
    // locally via Black-Scholes. (Switch here to consume broker greeks.)
  }

  /** Build flat rows, compute greeks locally, write GEX + flow to state. */
  _recompute() {
    if (!(this.spot > 0)) return;
    const rows = [];

    for (const c of this._activeContracts()) {
      const q = this.quotes.get(c.streamerSymbol);
      const s = this.summaries.get(c.streamerSymbol);
      const mid = q?.mid;
      if (!(mid > 0)) continue;

      const T = yearsToExpiry(c.expiration);
      const iv = impliedVol({ price: mid, S: this.spot, K: c.strike, T, r: RISK_FREE, type: c.type });
      if (!(iv > 0)) continue;
      const g = bsGreeks({ S: this.spot, K: c.strike, T, sigma: iv, r: RISK_FREE, type: c.type });

      rows.push({
        strike: c.strike,
        side: c.type === 'C' ? 'call' : 'put',
        oi: s?.oi ?? 0,
        volume: s?.volume ?? 0,
        gamma: g.gamma,
        delta: g.delta,
        theta: g.theta,
        vega: g.vega,
        vanna: g.vanna,
        charm: g.charm,
        iv,
        dte: c.dte,
      });
    }

    if (!rows.length) return;

    // Aggregate exposure totals (GEX/DEX/VEX/CHEX/Vega).
    const totals = emptyTotals();
    for (const r of rows) {
      accumulateExposureTotals({
        totals,
        isCall: r.side === 'call',
        gamma: r.gamma,
        delta: r.delta,
        theta: r.theta,
        vega: r.vega,
        vanna: r.vanna,
        charm: r.charm,
        contracts: r.oi,
        spot: this.spot,
      });
    }

    const { rows: gexRows, callWall, putWall, gexFlip, totalNetGex } = computeGexSummary(rows, this.spot);

    marketState.setGexUpdate({
      gexRows,
      spot: this.spot,
      expiry: this.expiry,
      totals,
      callWall,
      putWall,
      gexFlip,
      totalNetGex,
    });

    marketState.setFlow(this.flow.bucket(SYMBOL));
  }

  stop() {
    if (this.recomputeTimer) clearInterval(this.recomputeTimer);
    this.recomputeTimer = null;
    this.client?.close();
  }
}

module.exports = { TastytradeProxy, fetchChain, getAccessToken, getQuoteToken, DxLinkClient };
