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
const { writeGexSnapshot } = require('./state/gex-history-writer');
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

const SYMBOL = (process.env.SYMBOL || 'SPX').toUpperCase();
const RISK_FREE = Number(process.env.RISK_FREE_RATE || 0.045);
// Strike window around spot to subscribe — keeps dxLink load sane. SPX trades in
// hundreds of points; equities like NVDA in tens, so a percentage band is safer
// than a fixed point window. Default: 8% of spot.
const STRIKE_WINDOW_PCT = Number(process.env.STRIKE_WINDOW_PCT || 0.08);
const STRIKE_WINDOW = process.env.STRIKE_WINDOW ? Number(process.env.STRIKE_WINDOW) : null;
const RECOMPUTE_MS = Number(process.env.RECOMPUTE_MS || 2000);
const OI_REFRESH_MS = Number(process.env.OI_REFRESH_MS || 60000);

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
      // nginx/WAF in front of Tastytrade 401s requests with undici's default
      // User-Agent; a conventional UA (as PowerShell/curl send) passes.
      'User-Agent': process.env.TT_USER_AGENT || 'spx-gex-dashboard/1.0',
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

const TT_UA = process.env.TT_USER_AGENT || 'spx-gex-dashboard/1.0';

async function ttGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`${TT_BASE_URL}${path}`, {
    headers: {
      // OAuth2 access tokens use the Bearer scheme.
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': TT_UA,
    },
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
            occSymbol: strikeObj['call'], // OCC symbol for REST market-data
            expiration,
            strike,
            type: 'C',
            dte,
          });
        }
        if (strikeObj['put-streamer-symbol']) {
          contracts.push({
            streamerSymbol: strikeObj['put-streamer-symbol'],
            occSymbol: strikeObj['put'],
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

/**
 * Resolve an underlying symbol to its instrument class, REST market-data param,
 * and the authoritative dxLink streamer symbol.
 *
 * The three classes use different symbols on Tastytrade REST AND different
 * streamer symbols on dxLink — and futures additionally rewrite the year and
 * append an exchange suffix (e.g. /ESU6 -> /ESU26:XCME). The only reliable
 * streamer symbol is the instrument record's `streamer-symbol` field, so we
 * read it rather than construct it.
 *
 * @param {string} symbol user symbol, e.g. "SPX", "NVDA", "/ESU6"
 * @returns {Promise<{symbol,klass,marketDataParam,streamerSymbol}>}
 */
async function resolveUnderlying(symbol) {
  const sym = symbol.trim().toUpperCase();

  // Future: leading slash.
  if (sym.startsWith('/')) {
    const enc = encodeURIComponent(sym);
    const json = await ttGet(`/instruments/futures?symbol[]=${enc}`);
    const item = json?.data?.items?.[0];
    const streamerSymbol = item?.['streamer-symbol'];
    if (!streamerSymbol) throw new Error(`No streamer-symbol for future ${sym}`);
    return { symbol: sym, klass: 'future', marketDataParam: `future=${enc}`, streamerSymbol };
  }

  // Index: known index roots. Tastytrade indices stream under the plain symbol.
  const INDEX_ROOTS = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'XSP', 'DJX']);
  if (INDEX_ROOTS.has(sym)) {
    return { symbol: sym, klass: 'index', marketDataParam: `index=${sym}`, streamerSymbol: sym };
  }

  // Equity: look up the instrument record for the real streamer symbol.
  try {
    const json = await ttGet(`/instruments/equities/${encodeURIComponent(sym)}`);
    const streamerSymbol = json?.data?.['streamer-symbol'] || sym;
    return { symbol: sym, klass: 'equity', marketDataParam: `equity=${sym}`, streamerSymbol };
  } catch {
    // Fall back to plain symbol if the lookup fails.
    return { symbol: sym, klass: 'equity', marketDataParam: `equity=${sym}`, streamerSymbol: sym };
  }
}

/** Get a dxLink API quote token + url from Tastytrade. */
async function getQuoteToken() {
  const json = await ttGet('/api-quote-tokens');
  const token = json?.data?.token;
  const url = json?.data?.['dxlink-url'] || DXLINK_WS_URL;
  if (!token) throw new Error('No dxLink quote token returned');
  return { token, url };
}

/**
 * REST backfill for open interest + volume across a set of OCC option symbols.
 * dxFeed Summary snapshots are unreliable per-strike, so we pull OI/volume for
 * the whole active chain from Tastytrade's market-data endpoint in batches.
 *
 * @param {string[]} occSymbols
 * @returns {Promise<Map<string,{oi:number,volume:number}>>} keyed by OCC symbol
 */
/** Normalize an OCC symbol for matching (strip all whitespace, upper-case). */
function normalizeOcc(sym) {
  return String(sym || '').replace(/\s+/g, '').toUpperCase();
}

async function fetchOpenInterest(occSymbols) {
  const out = new Map();
  const symbols = occSymbols.filter(Boolean);
  const BATCH = 100; // keep query string within limits
  for (let i = 0; i < symbols.length; i += BATCH) {
    const chunk = symbols.slice(i, i + BATCH);
    const qs = chunk.map((s) => `equity-option[]=${encodeURIComponent(s)}`).join('&');
    let json;
    try {
      json = await ttGet(`/market-data/by-type?${qs}`);
    } catch (err) {
      console.warn('[OI] batch failed:', err.message.slice(0, 200));
      continue;
    }
    const items = json?.data?.items || [];
    for (const it of items) {
      const sym = it.symbol;
      if (!sym) continue;
      // Key by normalized symbol (strip all whitespace) so OCC padding
      // differences between the chain and market-data responses can't break
      // the lookup. SPX padding happened to match; NVDA's did not.
      // Capture a REST price (mark, else mid) as a fallback for greeks when no
      // live stream quote has arrived for a contract.
      const mark = firstFiniteNumber(it.mark) || firstFiniteNumber(it.mid);
      out.set(normalizeOcc(sym), {
        oi: firstFiniteNumber(it['open-interest']),
        volume: firstFiniteNumber(it.volume),
        mark: mark > 0 ? mark : 0,
      });
    }
  }
  return out;
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
    this.summaries = new Map(); // streamerSymbol -> { oi, prevClose }
    this.greeks = new Map(); // streamerSymbol -> { iv, delta, gamma, theta, vega } (raw broker greeks)
    this.volumes = new Map(); // streamerSymbol -> dayVolume (from Trade events)
    this.restOI = new Map(); // streamerSymbol -> { oi, volume } from REST backfill
    this.oiTimer = null;
    this.spot = 0;
    this.spotSymbol = null; // resolved dxLink streamer symbol for the underlying
    this.underlying = null; // { symbol, klass, marketDataParam, streamerSymbol }
    this.expiry = '';
    this.recomputeTimer = null;
  }

  async start() {
    await getAccessToken();

    // Resolve underlying class + real dxLink streamer symbol BEFORE subscribing.
    // Futures/indices/equities differ on both Tastytrade and dxLink; the
    // instrument record's streamer-symbol is the only reliable source.
    this.underlying = await resolveUnderlying(SYMBOL);
    console.log(`[FEED] ${SYMBOL} resolved: class=${this.underlying.klass} streamer=${this.underlying.streamerSymbol}`);

    // Underlying prev close + last from REST (uses class-correct param).
    try {
      const md = await ttGet(`/market-data/by-type?${this.underlying.marketDataParam}`);
      const it = md?.data?.items?.[0];
      if (it) {
        marketState.setState({
          prevClose: firstFiniteNumber(it['prev-close']),
          prevCloseDate: it['prev-close-date'] || null,
        });
        console.log(`[FEED] ${SYMBOL} prev-close=${it['prev-close']} last=${it.last}`);
      }
    } catch (err) {
      console.warn('[FEED] prev-close fetch failed:', err.message.slice(0, 120));
    }

    const { expirations, contracts } = await fetchChain();
    marketState.setState({ symbol: SYMBOL });
    marketState.setExpirations(expirations);
    console.log(`[FEED] ${SYMBOL}: ${contracts.length} contracts, ${expirations.length} expirations`);
    console.log(`[FEED] expirations: ${expirations.slice(0, 8).join(', ')}${expirations.length > 8 ? ' …' : ''}`);

    // Default expiry = nearest (0DTE if present).
    const { ymd } = todayYmd();
    this.expiry = expirations.find((e) => e >= ymd) || expirations[0] || '';
    marketState.setExpiry(this.expiry);

    // Use the resolved dxLink streamer symbol for the underlying quote.
    // e.g. /ESU6 -> /ESU26:XCME ; SPX -> SPX ; NVDA -> NVDA
    this.spotSymbol = this.underlying.streamerSymbol;
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

    // Backfill OI/volume from REST now, then refresh periodically (OI only
    // changes once per day, but volume drifts — refresh every 60s).
    await this._refreshOI();
    this.oiTimer = setInterval(() => this._refreshOI(), OI_REFRESH_MS);

    this.recomputeTimer = setInterval(() => this._recompute(), RECOMPUTE_MS);
    return this;
  }

  /** Pull OI + volume for the active chain from REST into this.restOI. */
  async _refreshOI() {
    const active = this._activeContracts();
    if (!active.length) return;
    const occ = active.map((c) => c.occSymbol).filter(Boolean);
    const byOcc = await fetchOpenInterest(occ);
    let filled = 0;
    for (const c of active) {
      const m = byOcc.get(normalizeOcc(c.occSymbol));
      if (m) {
        this.restOI.set(c.streamerSymbol, m);
        if (m.oi > 0) filled++;
      }
    }
    console.log(`[OI] REST backfill: ${filled}/${active.length} strikes with OI`);
  }

  /** Pick contracts for the active expiry within the strike window of spot. */
  _activeContracts() {
    const center = this.spot > 0 ? this.spot : null;
    // Fixed point window if set, else a percentage band around spot.
    const band = STRIKE_WINDOW != null ? STRIKE_WINDOW : (center ? center * STRIKE_WINDOW_PCT : Infinity);
    const out = [];
    for (const c of this.contracts.values()) {
      if (c.expiration !== this.expiry) continue;
      if (center && Math.abs(c.strike - center) > band) continue;
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
      // Open interest is the authoritative per-day value from Summary. dxFeed
      // pushes it once (and on day rollover); never overwrite a known OI with
      // an empty later Summary.
      const prev = this.summaries.get(sym) || {};
      const oi = firstFiniteNumber(ev.openInterest);
      this.summaries.set(sym, {
        oi: oi > 0 ? oi : prev.oi || 0,
        prevClose: firstFiniteNumber(ev.prevDayClosePrice) || prev.prevClose || 0,
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
      // dayVolume on the Trade event is the running daily volume for the
      // contract — the correct source for per-strike volume (Summary has none).
      const dv = firstFiniteNumber(ev.dayVolume);
      if (dv > 0) this.volumes.set(sym, dv);
      const quote = this.quotes.get(sym) || null;
      this.flow.addPrint({ streamerSymbol: sym, price: Number(ev.price), size: Number(ev.size), quote });
      return;
    }
    if (ev.eventType === 'Greeks') {
      // Raw broker greeks from dxFeed. Preferred over locally-solved BS greeks:
      // the broker's IV is far less noisy than solving IV from a tick price.
      // (No vanna/charm in this event — those are derived in _recompute.)
      const gamma = firstFiniteNumber(ev.gamma);
      const delta = firstFiniteNumber(ev.delta);
      const vega = firstFiniteNumber(ev.vega);
      const theta = firstFiniteNumber(ev.theta);
      const iv = firstFiniteNumber(ev.volatility);
      // Only store if we got at least a usable gamma or IV.
      if (gamma || iv) {
        this.greeks.set(sym, { iv, delta, gamma, theta, vega });
      }
      return;
    }
  }

  /** Build flat rows, compute greeks locally, write GEX + flow to state. */
  _recompute() {
    if (!(this.spot > 0)) return;

    // Pass 1: gather each contract's price/OI/volume and solve IV where the
    // price supports it. Track ATM IV (nearest strike with a good solve) to use
    // as a fallback for deep-ITM / illiquid legs whose IV can't be solved from a
    // near-intrinsic mark — those legs carry big OI and matter for GEX.
    const staged = [];
    let atmIV = 0;
    let atmDist = Infinity;

    for (const c of this._activeContracts()) {
      const q = this.quotes.get(c.streamerSymbol);
      const s = this.summaries.get(c.streamerSymbol);
      const rest = this.restOI.get(c.streamerSymbol);
      const gk = this.greeks.get(c.streamerSymbol); // raw broker greeks (if any)
      const oi = (rest?.oi ?? 0) || (s?.oi ?? 0);
      const vol = this.volumes.get(c.streamerSymbol) || rest?.volume || 0;
      const mid = q?.mid > 0 ? q.mid : rest?.mark || 0;

      // Skip only if there's truly nothing to contribute.
      if (!(mid > 0) && !(oi > 0) && !(vol > 0) && !gk) continue;

      const T = yearsToExpiry(c.expiration);
      // Prefer the broker's IV (stable); only solve from price if none was sent.
      let iv = gk?.iv > 0 ? gk.iv : 0;
      if (!(iv > 0) && mid > 0) {
        iv = impliedVol({ price: mid, S: this.spot, K: c.strike, T, r: RISK_FREE, type: c.type });
      }
      if (iv > 0) {
        const dist = Math.abs(c.strike - this.spot);
        if (dist < atmDist) {
          atmDist = dist;
          atmIV = iv;
        }
      }
      staged.push({ c, oi, vol, T, iv, gk });
    }

    if (!staged.length) return;

    // Pass 2: compute greeks. Deep-ITM/illiquid legs (iv unsolved) fall back to
    // ATM IV so their gamma is non-zero and their OI counts toward GEX.
    const rows = [];
    for (const st of staged) {
      const { c, oi, vol, T, gk } = st;
      const iv = st.iv > 0 ? st.iv : atmIV;

      // BS is used to source vanna/charm (dxFeed Greeks has neither) and as the
      // fallback for delta/gamma/vega when no broker greeks arrived for a strike.
      // Fed with the RAW broker IV when available, so it's stable.
      let bs = { gamma: 0, delta: 0, theta: 0, vega: 0, vanna: 0, charm: 0 };
      if (iv > 0) {
        bs = bsGreeks({ S: this.spot, K: c.strike, T, sigma: iv, r: RISK_FREE, type: c.type });
      }

      // Prefer raw broker greeks for delta/gamma/vega; fall back to BS per-field.
      const gamma = gk && Number.isFinite(gk.gamma) && gk.gamma !== 0 ? gk.gamma : bs.gamma;
      const delta = gk && Number.isFinite(gk.delta) && gk.delta !== 0 ? gk.delta : bs.delta;
      const theta = gk && Number.isFinite(gk.theta) && gk.theta !== 0 ? gk.theta : bs.theta;
      const vega  = gk && Number.isFinite(gk.vega)  && gk.vega  !== 0 ? gk.vega  : bs.vega;

      // Normalize to conventional reporting units:
      //   theta/charm: per-year -> per-day  (÷365)
      //   vega/vanna : per 1.00 vol -> per 1% vol  (÷100)
      // Broker theta/vega already arrive in conventional units, so only the
      // BS-derived vanna/charm get the unit scaling.
      rows.push({
        strike: c.strike,
        side: c.type === 'C' ? 'call' : 'put',
        oi,
        volume: vol,
        gamma,
        delta,
        theta: gk ? theta : theta / 365,
        vega: gk ? vega : vega / 100,
        vanna: bs.vanna / 100,   // always BS-derived (not in broker feed)
        charm: bs.charm / 365,   // always BS-derived
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

    // Persist per-strike net GEX history (rate-limited, fire-and-forget).
    // Feeds the dashboard's rolling-net-GEX view via
    // /api/snapshots/option-strike-gex-history. No-ops without DATABASE_URL.
    writeGexSnapshot(gexRows, this.spot, this.expiry).catch(() => {});
  }

  stop() {
    if (this.recomputeTimer) clearInterval(this.recomputeTimer);
    if (this.oiTimer) clearInterval(this.oiTimer);
    this.recomputeTimer = null;
    this.oiTimer = null;
    this.client?.close();
  }
}

module.exports = { TastytradeProxy, fetchChain, getAccessToken, getQuoteToken, DxLinkClient };
