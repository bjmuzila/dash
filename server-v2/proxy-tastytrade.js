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
const fs = require('fs');
const path = require('path');

const marketState = require('./state/market-state');
const { writeGexSnapshot } = require('./state/gex-history-writer');
const { writeEsCandles } = require('./state/es-candle-writer');
const lastEventStore = require('./state/last-event-store');
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
// SPX/SPXW reopen for the next ~23h session at 6PM ET. At that boundary the prior
// session's per-strike dayVolume + OI are stale; we force a re-pull rather than
// depend on dxFeed reliably pushing the reset (it does so only sometimes).
const SESSION_ROLL_HOUR_ET = Number(process.env.SESSION_ROLL_HOUR_ET || 18);
const SESSION_ROLL_CHECK_MS = Number(process.env.SESSION_ROLL_CHECK_MS || 60000);
// Idle mode persisted across restarts/reconnects so a page reload reflects it.
const IDLE_STATE_FILE = path.join(__dirname, '.idle-state.json');
// Last RTH cash-basis (broker spot − esFut), persisted so an overnight restart
// can still derive a display SPX from the live ES future.
const CASH_BASIS_FILE = path.join(__dirname, '.cash-basis.json');
// Dev-probe on-demand subscriptions auto-expire after this long.
const PROBE_TTL_MS = Number(process.env.PROBE_TTL_MS || 15 * 60 * 1000);
const OI_REFRESH_MS = Number(process.env.OI_REFRESH_MS || 60000);
// Hold the first GEX broadcast until OI backfill covers this fraction of active
// strikes — avoids rendering a half-filled chart while REST backfill completes.
const OI_READY_RATIO = Number(process.env.OI_READY_RATIO || 0.85);
// Plateau release for OI (mirrors the greeks plateau): far-OTM strikes often
// carry no OI, so coverage can stall below the ratio. Once it stops climbing
// above a floor for OI_PLATEAU_HITS consecutive backfills, release.
const OI_PLATEAU_EPS = Number(process.env.OI_PLATEAU_EPS || 0.01);
const OI_PLATEAU_HITS = Number(process.env.OI_PLATEAU_HITS || 3);
// (OI and greeks share one DTE-scaled plateau floor.)
// DTE-scaled plateau floor: SPX OI/volume thins out the further the expiry is,
// so a far-dated chain that's fully backfilled may still sit well below a
// near-dated one. The floor a plateau must clear therefore decreases with DTE.
// Tiers are [maxDte, floorFraction] — first match wins; last is the catch-all.
// Tune these once real per-DTE coverage is known.
const PLATEAU_FLOOR_TIERS = [
  [1, 0.80],   // 0–1 DTE (0DTE / next session): liquid, expect high coverage
  [3, 0.65],   // 2–3 DTE
  [7, 0.50],   // up to ~1 week
  [14, 0.40],  // up to ~2 weeks
  [Infinity, 0.30], // 2+ weeks out: accept a low plateau as complete
];
function plateauFloor(dte) {
  const d = Number.isFinite(dte) ? dte : 0;
  for (const [maxDte, floor] of PLATEAU_FLOOR_TIERS) {
    if (d <= maxDte) return floor;
  }
  return 0.30;
}
// Hold the first GEX broadcast until this fraction of in-window strikes carry a
// REAL streamed broker gamma (not the BS/ATM-IV fallback). Before greeks arrive,
// far/near-OTM strikes compute with fallback gamma and produce inflated bars —
// this gate prevents that half-warmed frame from ever reaching the chart.
const GREEKS_READY_RATIO = Number(process.env.GREEKS_READY_RATIO || 0.85);
// Plateau release: on thin expiries greeks coverage may never reach the ratio
// above. Once coverage stops climbing meaningfully (gain < PLATEAU_EPS) for
// PLATEAU_HITS consecutive recomputes AND a minimum floor is met, release the
// chart — the remaining strikes simply aren't going to stream a gamma.
const GREEKS_PLATEAU_EPS = Number(process.env.GREEKS_PLATEAU_EPS || 0.01); // <1% gain = flat
const GREEKS_PLATEAU_HITS = Number(process.env.GREEKS_PLATEAU_HITS || 3);  // ~6s at 2s recompute
// Plateau floors are DTE-scaled — see plateauFloor() below.
// Safety valve: broadcast anyway after this long, even if coverage is still low
// (some far-OTM strikes legitimately never report OI/greeks and shouldn't block forever).
const OI_READY_GRACE_MS = Number(process.env.OI_READY_GRACE_MS || 90000);
// SPX flow tape is aggregated and broadcast on this cadence (default 500ms),
// independent of the heavier GEX recompute loop.
const FLOW_AGGREGATE_MS = Number(process.env.FLOW_AGGREGATE_MS || 500);

// ES 5-minute candle broadcast cadence. The forming bar updates on nearly every
// flush while ES is live, so this is effectively how often the live candle
// repaints. 10s keeps it visibly live without one delta every ~5s.
const CANDLE_FLUSH_MS = Number(process.env.CANDLE_FLUSH_MS || 10000);

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
 * Fetch a nested option chain for any underlying (defaults to the feed SYMBOL).
 * @param {string} [underlying] e.g. "SPX", "AAPL"
 * @returns {Promise<{expirations:string[], contracts:Array}>}
 *   contracts: { streamerSymbol, expiration, strike, type, dte }
 */
async function fetchChain(underlying = SYMBOL) {
  const json = await ttGet(`/option-chains/${encodeURIComponent(String(underlying).toUpperCase())}/nested`);
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

// US equity-market full-day closures (ET date strings). ES futures trade an
// abbreviated session on these days but there is NO official daily settle, so
// TradingView's day-change skips them. Mirrors mvc-auto-snapshot.js — keep in
// sync. Extend before 2028.
const ES_NON_SETTLE_DATES = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// Manual ES day-change baseline override, keyed by the ET *trading date* it
// applies to. Empty in normal operation — the TT REST prev-close (CME Final
// settle) drives the baseline. Add an entry only if a future holiday session
// confuses the auto logic; entries auto-expire once the ET date passes the key.
const ES_MANUAL_BASELINE = new Map();

/**
 * Compute an ET 5-minute slot descriptor for an epoch-ms timestamp.
 * Returns { slotKey:'YYYY-MM-DDTHH:MM', date:'YYYY-MM-DD', time:'HH:MM', slotMs }
 * where slotMs is the epoch-ms of the slot start (floored to the 5-min boundary).
 */
function etFiveMinSlot(ts) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ts));
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === '24' ? '00' : map.hour;
  const slotMin = String(Math.floor(Number(map.minute || '0') / 5) * 5).padStart(2, '0');
  const date = `${map.year}-${map.month}-${map.day}`;
  const time = `${hour}:${slotMin}`;
  const slotKey = `${date}T${time}`;
  // Floor the original timestamp to the 5-min boundary for a stable slotMs.
  const slotMs = Math.floor(ts / 300000) * 300000;
  return { slotKey, date, time, slotMs };
}

/**
 * Minutes-since-midnight in ET for an epoch-ms timestamp (defaults to now).
 * Used to gate the pre-open volume reset: TastyTrade REST per-strike `volume`
 * carries the PRIOR session's cumulative figure until their backend resets at
 * the 9:30 ET cash open, so before 9:30 we force it to 0.
 */
function etMinutesNow(ts = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ts));
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === '24' ? 0 : Number(map.hour || 0);
  return hour * 60 + Number(map.minute || 0);
}

/** True before the 9:30 ET cash open — REST option volume is stale until then. */
function isPreOpenEt(ts = Date.now()) {
  return etMinutesNow(ts) < 9 * 60 + 30;
}

/** True during the RTH cash session 9:30–16:00 ET (Mon–Fri). The broker SPX
 *  quote is live in this window; outside it the cash-style quote goes stale, so
 *  the displayed SPX is derived from the live ES future instead. */
function isRthEt(ts = Date.now()) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(ts));
  if (wd === 'Sat' || wd === 'Sun') return false;
  const m = etMinutesNow(ts);
  return m >= 9 * 60 + 30 && m < 16 * 60; // 570 .. 960
}

/**
 * Resolve the front (nearest-expiry, active) /ES future's dxLink streamer symbol.
 * Uses the futures list for the ES product and picks the soonest non-expired
 * contract. Returns e.g. "/ESU25:XCME".
 */
async function resolveFrontEsSymbol() {
  const json = await ttGet(`/instruments/futures?product-code[]=ES`);
  const items = json?.data?.items || [];
  const today = todayYmd().ymd;
  const active = items
    .filter((it) => it['streamer-symbol'] && (it['expiration-date'] || '') >= today)
    .sort((a, b) => String(a['expiration-date']).localeCompare(String(b['expiration-date'])));
  const front = active[0] || items.find((it) => it['streamer-symbol']);
  if (!front?.['streamer-symbol']) throw new Error('No active ES future found');
  // streamer-symbol (e.g. /ESU26:XCME) is for dxLink; ttSymbol (the instrument's
  // own `symbol`, e.g. /ESU6) is what /market-data/by-type?future= expects.
  return { streamerSymbol: front['streamer-symbol'], ttSymbol: front['symbol'] || front['streamer-symbol'] };
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
// REST probe (any ticker) — used by /proxy/probe-rest for non-feed symbols.
// The live dxLink feed only covers one SYMBOL, so for arbitrary tickers we go
// straight to Tastytrade REST: fetch the chain, resolve/snap the strike, then
// pull contract-level market-data (quote / OI / volume).
// ---------------------------------------------------------------------------

// Cache chains so repeated polls for the same ticker don't re-fetch the full
// nested chain (SPX is ~30k contracts / multi-MB). The chain STRUCTURE (strikes
// + expirations) only changes intraday when new strikes list, so a multi-minute
// TTL is safe — per-strike marks/greeks/OI are pulled separately and fresher.
// Env-tunable so it can be dialed without a redeploy.
const _restChainCache = new Map(); // chainTicker -> { at, expirations, contracts }
const REST_CHAIN_TTL_MS = Number(process.env.REST_CHAIN_TTL_MS || 600_000); // 10 min
// Coalesce concurrent cache misses: when N tabs ask for the same cold chain in
// the same instant, they share ONE upstream fetch instead of N.
const _restChainInFlight = new Map(); // chainTicker -> Promise<entry>

// The Tastytrade option-chain endpoint is keyed by the ROOT underlying, not the
// weekly streamer root. Map common weekly/alias roots back to the chain root.
function chainTicker(ticker) {
  const t = String(ticker || '').toUpperCase().replace(/^\./, '');
  if (t === 'SPXW') return 'SPX';
  if (t === 'NDXP') return 'NDX';
  if (t === 'RUTW') return 'RUT';
  return t;
}

async function getChainCached(ticker) {
  const key = chainTicker(ticker);
  const hit = _restChainCache.get(key);
  if (hit && Date.now() - hit.at < REST_CHAIN_TTL_MS) return hit;
  // A fetch for this key is already running — await it rather than starting a
  // second identical upstream pull.
  const inflight = _restChainInFlight.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    const { expirations, contracts } = await fetchChain(key);
    const entry = { at: Date.now(), expirations, contracts };
    _restChainCache.set(key, entry);
    return entry;
  })().finally(() => _restChainInFlight.delete(key));
  _restChainInFlight.set(key, p);
  return p;
}

// CBOE delayed-quote symbol: index roots are underscore-prefixed (_SPX, _NDX…).
const CBOE_INDEX_ROOTS = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'XSP', 'DJX']);
function cboeSymbol(root) {
  return CBOE_INDEX_ROOTS.has(root) ? `_${root}` : root;
}
const _cboeCache = new Map(); // cboeSymbol -> { at, byOcc: Map<occNorm,{oi,volume,symbol}> }
const CBOE_TTL_MS = 60_000;

/** Fetch + cache CBOE's full delayed option chain, indexed by normalized OCC. */
async function fetchCboeChain(root) {
  const sym = cboeSymbol(root);
  const cached = _cboeCache.get(sym);
  if (cached && Date.now() - cached.at < CBOE_TTL_MS) return cached;
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(sym)}.json`;
  // CBOE's CDN WAF 401s bare server requests; mimic a browser-originated fetch.
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      Origin: 'https://www.cboe.com',
      Referer: 'https://www.cboe.com/',
    },
  });
  if (!r.ok) { const e = new Error(`CBOE ${sym} -> ${r.status}`); e.status = r.status; throw e; }
  const data = await r.json();
  const rows = data?.data?.options || [];
  const byOcc = new Map();
  for (const o of rows) {
    // CBOE `option` looks like "SPXW250620P05000000" — same OCC body we use.
    if (!o?.option) continue;
    byOcc.set(normalizeOcc(o.option), {
      oi: Number.isFinite(o.open_interest) ? o.open_interest : null,
      volume: Number.isFinite(o.volume) ? o.volume : null,
      symbol: o.option,
    });
  }
  const entry = { at: Date.now(), byOcc };
  _cboeCache.set(sym, entry);
  return entry;
}

/**
 * Independent open-interest cross-check for a SINGLE option contract via CBOE's
 * public delayed-quotes feed (no auth — Yahoo's v7 options endpoint now 401s).
 * Dev-page only: matches by OCC contract symbol so the page can show our OI
 * (TastyTrade) beside CBOE's for the exact same strike — to debug OI mismatches.
 *
 * Return shape keeps the `yahoo`/`yahooVolume` keys so the dev UI is unchanged;
 * `source` reports the real provider.
 * @param {object} a
 * @param {string} a.root      chain root, e.g. "SPX" / "AAPL"
 * @param {string} a.occSymbol our OCC symbol (spaces removed = CBOE `option`)
 * @param {string} a.expiry    YYYY-MM-DD (unused by CBOE; full chain returned)
 * @param {number} a.oursOI    our (TastyTrade) open interest for the contract
 */
async function fetchYahooContractOI({ root, occSymbol, oursOI }) {
  try {
    const { byOcc } = await fetchCboeChain(root);
    const want = normalizeOcc(occSymbol);
    // SPX weeklies trade under the SPXW body on CBOE too; try the swap as a fallback.
    let hit = byOcc.get(want);
    if (!hit && root === 'SPX') hit = byOcc.get(want.replace(/^SPX(?=\d)/, 'SPXW'));
    if (!hit) {
      return { source: 'cboe', ok: true, match: false, underlying: cboeSymbol(root), contractSymbol: want, yahooContracts: byOcc.size };
    }
    const refOI = Number.isFinite(hit.oi) ? hit.oi : null;
    const ours = Number.isFinite(oursOI) ? oursOI : null;
    return {
      source: 'cboe',
      ok: true,
      match: true,
      underlying: cboeSymbol(root),
      contractSymbol: hit.symbol,
      ours,
      yahoo: refOI, // key kept for UI compatibility; value is CBOE OI
      diff: ours != null && refOI != null ? ours - refOI : null,
      pctDiff: ours != null && refOI > 0 ? ((ours - refOI) / refOI) * 100 : null,
      yahooVolume: Number.isFinite(hit.volume) ? hit.volume : null,
    };
  } catch (err) {
    return { source: 'cboe', ok: false, status: err?.status ? `HTTP ${err.status}` : String(err?.message || err).slice(0, 120) };
  }
}

/**
 * Probe any ticker via REST. Resolves the requested strike to the nearest real
 * chain contract, then fetches its market-data.
 * @param {object} a
 * @param {string} a.ticker   e.g. "AAPL"
 * @param {string} a.expiry   YYYY-MM-DD
 * @param {'C'|'P'} a.type
 * @param {number} a.strike
 */
async function probeRest({ ticker, expiry, type, strike }) {
  const reqStrike = Number(strike);
  const { expirations, contracts } = await getChainCached(ticker);

  // Nearest real strike for this expiry + side.
  let best = null, bestDist = Infinity;
  for (const c of contracts) {
    if (c.expiration !== expiry || c.type !== type) continue;
    const d = Math.abs(Number(c.strike) - reqStrike);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  if (!best) {
    // Help the caller: report whether the expiry even exists for this ticker,
    // and a few valid expiries to pick from.
    const expiryExists = expirations.includes(expiry);
    return {
      found: false,
      status: expiryExists ? 'no-strike' : 'no-expiry',
      source: 'rest',
      chainTicker: chainTicker(ticker),
      requestedStrike: Number.isFinite(reqStrike) ? reqStrike : null,
      resolvedStrike: null,
      availableExpirations: expirations.slice(0, 12),
    };
  }

  const meta = {
    resolvedSymbol: best.streamerSymbol,
    occSymbol: best.occSymbol,
    snapped: Number.isFinite(reqStrike) && best.strike !== reqStrike,
    requestedStrike: Number.isFinite(reqStrike) ? reqStrike : null,
    resolvedStrike: best.strike,
  };

  // Contract-level market data for the OCC symbol. The by-type item carries
  // quote, trade, summary AND greek fields — group them into the four feed
  // types the dev page renders, and pass the raw item through so nothing hides.
  // NOTE: TastyTrade REST by-type prices SPX/NDX index options under
  // equity-option[] (confirmed working); index-option[] returned nothing.
  const qs = `equity-option[]=${encodeURIComponent(best.occSymbol)}`;
  const json = await ttGet(`/market-data/by-type?${qs}`);
  const it = json?.data?.items?.[0] || null;
  if (!it) {
    return { ...meta, found: false, status: 'no-data', source: 'rest' };
  }
  const n = firstFiniteNumber;
  const bid = n(it.bid);
  const ask = n(it.ask);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : null;

  const feeds = {
    Quote: {
      bid,
      ask,
      mid,
      mark: n(it.mark) || mid,
      bidSize: n(it['bid-size']),
      askSize: n(it['ask-size']),
    },
    Trade: {
      last: n(it.last),
      lastSize: n(it['last-size']),
      volume: n(it.volume),
      dayOpen: n(it.open),
      dayHigh: n(it['day-high-price']) || n(it.high),
      dayLow: n(it['day-low-price']) || n(it.low),
    },
    Summary: {
      openInterest: n(it['open-interest']),
      prevClose: n(it['prev-close']),
      prevCloseDate: it['prev-close-date'] ?? null,
      close: n(it.close),
    },
    Greeks: {
      iv: n(it['implied-volatility']) || n(it.volatility),
      delta: n(it.delta),
      gamma: n(it.gamma),
      theta: n(it.theta),
      vega: n(it.vega),
      rho: n(it.rho),
    },
  };

  // Underlying spot — needed for net-greek exposures. Best-effort; if it fails
  // the exposures fall back to null rather than throwing the whole probe.
  let spot = null;
  try {
    const root = chainTicker(ticker);
    const INDEX_ROOTS = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'XSP', 'DJX']);
    const param = INDEX_ROOTS.has(root) ? `index=${encodeURIComponent(root)}` : `equity=${encodeURIComponent(root)}`;
    const uj = await ttGet(`/market-data/by-type?${param}`);
    const u = uj?.data?.items?.[0];
    spot = n(u?.mark) || n(u?.last) || n(u?.['prev-close']) || null;
  } catch { /* spot stays null */ }

  // Per-contract NET GREEKS, using the dashboard's exact conventions
  // (vex-chex.js / gex-calculator.js):
  //   GEX  = |gamma| × OI × spot²        (call +, put −)
  //   DEX  = |delta| × OI × 100 × spot   (call +, put −)
  //   VEX(vega exposure) = vega × OI × 100 × spot   (call +, put −)
  //   ThetaExp           = theta × OI × 100 × spot  (sign per dashboard charm split)
  // Vanna/charm exposure need vanna/charm greeks, which this REST feed does not
  // provide → reported as null.
  const isCall = type === 'C';
  const sign = isCall ? 1 : -1;
  const oi = n(it['open-interest']);
  const vol = n(it.volume);
  const g = feeds.Greeks;
  // Vanna/charm are not in the REST greeks feed — derive them from Black-Scholes
  // exactly as the live path does (_recompute): per-year BS, then unit-scaled
  // (vanna ÷100 per 1% vol, charm ÷365 per day). Needs IV + time-to-expiry.
  const T = yearsToExpiry(best.expiration);
  const bs = (spot > 0 && g.iv > 0 && T > 0)
    ? bsGreeks({ S: spot, K: best.strike, T, sigma: g.iv, r: RISK_FREE, type })
    : null;
  const exposures = (spot > 0)
    ? {
        spot,
        oi,
        volume: vol,
        gex: sign * Math.abs(g.gamma || 0) * oi * spot * spot,
        gexVol: sign * Math.abs(g.gamma || 0) * vol * spot * spot,
        dex: sign * Math.abs(g.delta || 0) * oi * 100 * spot,
        vex: sign * (g.vega || 0) * oi * 100 * spot,
        thetaExp: sign * (g.theta || 0) * oi * 100 * spot,
        vannaExp: bs ? sign * (bs.vanna / 100) * oi * 100 * spot : null,
        charmExp: bs ? sign * (bs.charm / 365) * oi * 100 * spot : null,
      }
    : { spot: null, oi, volume: vol, gex: null, gexVol: null, dex: null, vex: null, thetaExp: null, vannaExp: null, charmExp: null };

  // Independent OI cross-check (Yahoo) for THIS one contract — dev-page A/B test
  // for our persistent open-interest discrepancies. Best-effort; never throws.
  const oiCompare = await fetchYahooContractOI({
    root: chainTicker(ticker),
    occSymbol: best.occSymbol,
    expiry: best.expiration,
    oursOI: oi,
  });

  const result = {
    eventType: 'REST',
    eventSymbol: best.streamerSymbol,
    occSymbol: best.occSymbol,
    feeds,
    exposures,
    oiCompare, // { ours, yahoo, diff, pctDiff, match, ... } — OI sanity check
    raw: it, // full unmodified market-data item — every field, nothing dropped
  };
  return { ...meta, found: true, status: 'ready', source: 'rest', result };
}

// ---------------------------------------------------------------------------
// Full nested chain for the React pages (/api/chains, /api/expirations)
// The options-chain and mult-greek pages expect the legacy nested shape:
//   { data: { items: [{ "expiration-date", strikes: [{ "strike-price",
//     call:{...greeks/oi/vol}, put:{...} }] }], underlyingPrice, rootSymbol } }
// We rebuild it from the cached contracts + a batched /market-data/by-type pull
// (which carries greeks, OI, volume, mark per OCC option). Index-wide; works for
// any ticker, after-hours included (REST snapshot, not the live dxLink feed).
// ---------------------------------------------------------------------------

const INDEX_ROOTS = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'XSP', 'DJX']);

/** Best-effort underlying spot via REST market-data. Returns 0 on failure. */
async function fetchUnderlyingSpot(ticker) {
  const n = firstFiniteNumber;
  try {
    const root = chainTicker(ticker);
    const param = INDEX_ROOTS.has(root) ? `index=${encodeURIComponent(root)}` : `equity=${encodeURIComponent(root)}`;
    const uj = await ttGet(`/market-data/by-type?${param}`);
    const u = uj?.data?.items?.[0];
    return n(u?.mark) || n(u?.last) || n(u?.['prev-close']) || 0;
  } catch {
    return 0;
  }
}

/**
 * Batch underlying quotes via Tastytrade REST /market-data/by-type for a mix of
 * equities, indices and futures. The `mark`/`last` fields update during extended
 * hours, so this backs the watchlist's real-time AFTER-HOURS prices (vs Yahoo's
 * delayed series). Returns a map keyed by the caller's original symbol.
 *
 *   item.mark / item.last  → live price (updates in pre/post market)
 *   item.close             → today's regular-session (4pm) close
 *   item['prev-close']     → prior trading day's close
 *
 * @param {string[]} symbols user symbols, e.g. ["AAPL","SPX","/NQU26"]
 * @returns {Promise<Map<string,{last:number,mark:number,close:number,prevClose:number}>>}
 */
async function fetchUnderlyingQuotes(symbols) {
  const n = firstFiniteNumber;
  const out = new Map();
  const list = (symbols || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!list.length) return out;

  const equities = [];
  const indices = [];
  const futures = []; // { sym }
  for (const sym of list) {
    const up = sym.toUpperCase();
    if (up.startsWith('/')) futures.push(up);
    else if (INDEX_ROOTS.has(chainTicker(up))) indices.push(chainTicker(up));
    else equities.push(up);
  }

  // Manual prev-close overrides for futures — keyed by product root (matches
  // /ESU26, /ESU6, /ES:XCME, etc). Use ONLY to patch a holiday session with no
  // CME settle; clear once a clean settle prints, or it freezes the baseline at
  // a stale value and the day-change %/+- goes wildly wrong (e.g. NQ stuck at the
  // pre-Juneteenth 30719.75 → bogus "down ~1050"). Empty in normal operation:
  // TT REST prev-close (the official prior 4pm daily settle) drives the baseline.
  const FUT_PREVCLOSE_OVERRIDE = {
    // NQ: 0000.00,  // last-resort manual patch; normally derived from RTH 4pm close
    // ES: 0000.00,
  };
  const futRoot = (sym) => {
    const m = String(sym || '').toUpperCase().match(/^\/([A-Z]+)/);
    return m ? m[1].replace(/[FGHJKMNQUVXZ]\d{0,2}$/, '') : '';
  };

  const assign = (origSym, it) => {
    const override = FUT_PREVCLOSE_OVERRIDE[futRoot(origSym)];
    const prevClose = override != null ? override : n(it?.['prev-close']);
    out.set(origSym, {
      last: n(it?.last),
      mark: n(it?.mark),
      // In EXT the baseline is `close` (today's regular close); for the broken
      // holiday session use the override there too so EXT day-change is right.
      close: override != null ? override : n(it?.close),
      prevClose,
    });
  };

  // Equities + indices: one batched by-type call per class.
  const batchParam = async (param, vals, mapBack) => {
    if (!vals.length) return;
    const qs = vals.map((v) => `${param}[]=${encodeURIComponent(v)}`).join('&');
    try {
      const json = await ttGet(`/market-data/by-type?${qs}`);
      const items = json?.data?.items || [];
      const byName = new Map(items.map((it) => [String(it.symbol || '').toUpperCase(), it]));
      for (const v of vals) {
        const it = byName.get(String(v).toUpperCase());
        if (it) assign(mapBack(v), it);
      }
    } catch (err) {
      console.warn('[WATCH-QUOTES] batch failed:', String(err.message).slice(0, 160));
    }
  };

  // Equities pass through; indices map root→original (SPXW→SPX already collapsed).
  const eqBack = new Map(equities.map((e) => [e, e]));
  await batchParam('equity', [...eqBack.keys()], (v) => v);
  // Build index original-symbol map (root → first original that produced it).
  const idxOriginals = new Map();
  for (const sym of list) {
    const up = sym.toUpperCase();
    if (!up.startsWith('/') && INDEX_ROOTS.has(chainTicker(up))) {
      const root = chainTicker(up);
      if (!idxOriginals.has(root)) idxOriginals.set(root, sym);
    }
  }
  await batchParam('index', [...new Set(indices)], (root) => idxOriginals.get(root) || root);

  // Futures: the watchlist uses synthetic symbols like /NQU26 that are NOT real
  // Tastytrade symbols (TT uses /NQU6, single-digit year). Querying by symbol
  // 404s ("No streamer-symbol"), so resolve the FRONT active contract by product
  // code instead, then pull its by-type quote with the real TT symbol.
  for (const fut of futures) {
    const orig = list.find((s) => s.toUpperCase() === fut) || fut;
    const product = futRoot(fut); // e.g. /NQU26 -> NQ
    try {
      const ttSymbol = await resolveFrontFutureTtSymbol(product);
      if (!ttSymbol) { console.warn(`[WATCH-QUOTES] no front contract for ${product}`); continue; }
      const json = await ttGet(`/market-data/by-type?future[]=${encodeURIComponent(ttSymbol)}`);
      const it = json?.data?.items?.[0];
      if (it) {
        const override = FUT_PREVCLOSE_OVERRIDE[futRoot(orig)];
        if (override != null && override > 0) {
          assign(orig, { ...it, 'prev-close': override, close: override });
        } else {
          assign(orig, it);
        }
        // DIAGNOSTIC: dump every settle-ish field TT returns for the NQ front
        // contract so we can pin which one is the 4pm RTH close (29747.25) vs the
        // globex print. Remove once the right field is wired in.
        if (futRoot(orig) === 'NQ') {
          console.log(`[WATCH-QUOTES] ${orig} ttSym=${ttSymbol} last=${it.last} mark=${it.mark} close=${it.close} prev-close=${it['prev-close']} prev-close-date=${it['prev-close-date']} settlement=${it['settlement-price'] ?? it.settlement ?? 'n/a'} day-open=${it.open}`);
        }
      }
    } catch (err) {
      console.warn(`[WATCH-QUOTES] future ${fut} failed:`, String(err.message).slice(0, 120));
    }
  }

  return out;
}

// Cache the front-contract TT symbol per product code for a few minutes — the
// front contract only changes at the quarterly roll, so we don't re-query the
// futures list on every poll.
const _frontFutCache = new Map(); // productCode -> { at, ttSymbol }
const FRONT_FUT_TTL_MS = 5 * 60 * 1000;

/** Resolve the front (nearest non-expired) active future's TT market-data symbol
 *  for a product code (e.g. "NQ" -> "/NQU6"). Returns null on failure. */
async function resolveFrontFutureTtSymbol(productCode) {
  const code = String(productCode || '').toUpperCase();
  if (!code) return null;
  const hit = _frontFutCache.get(code);
  if (hit && Date.now() - hit.at < FRONT_FUT_TTL_MS) return hit.ttSymbol;
  const json = await ttGet(`/instruments/futures?product-code[]=${encodeURIComponent(code)}`);
  const items = json?.data?.items || [];
  const today = todayYmd().ymd;
  const active = items
    .filter((it) => (it['streamer-symbol'] || it.symbol) && (it['expiration-date'] || '') >= today)
    .sort((a, b) => String(a['expiration-date']).localeCompare(String(b['expiration-date'])));
  const front = active[0] || items.find((it) => it.symbol || it['streamer-symbol']);
  const ttSymbol = front?.symbol || front?.['streamer-symbol'] || null;
  if (ttSymbol) _frontFutCache.set(code, { at: Date.now(), ttSymbol });
  return ttSymbol;
}

/**
 * Fetch market-data (greeks + OI + volume + mark) for a list of OCC option
 * symbols, batched. Keyed by normalized OCC symbol.
 * @param {string[]} occSymbols
 * @param {'equity-option'|'index-option'} [optionParam] by-type param name.
 *   Index options (SPX/NDX/RUT/...) MUST be requested under `index-option[]`;
 *   `equity-option[]` returns NO items for them, which silently zeroed out every
 *   NDX/NDXP strike (and NQU, which proxies to the NDX chain) → blank EM rows.
 * @returns {Promise<Map<string, object>>}
 */
async function fetchOptionMarketData(occSymbols, optionParam = 'equity-option') {
  const out = new Map();
  const n = firstFiniteNumber;
  const symbols = occSymbols.filter(Boolean);
  const BATCH = 100;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const chunk = symbols.slice(i, i + BATCH);
    const qs = chunk.map((s) => `${optionParam}[]=${encodeURIComponent(s)}`).join('&');
    let json;
    try {
      json = await ttGet(`/market-data/by-type?${qs}`);
    } catch (err) {
      console.warn('[CHAIN-MD] batch failed:', String(err.message).slice(0, 160));
      continue;
    }
    // DEBUG: dump the raw first item ONCE PER PARAM (so we see both equity-option
    // and index-option responses). Also report how many items came back vs asked.
    // Remove once the mark/IV field mapping is confirmed.
    fetchOptionMarketData._dumped = fetchOptionMarketData._dumped || new Set();
    if (!fetchOptionMarketData._dumped.has(optionParam)) {
      fetchOptionMarketData._dumped.add(optionParam);
      const items = json?.data?.items || [];
      console.log('[CHAIN-MD DEBUG] param=%s asked=%d got=%d rawItem0=%s',
        optionParam, chunk.length, items.length,
        items.length ? JSON.stringify(items[0]) : '(none)');
    }
    for (const it of json?.data?.items || []) {
      if (!it.symbol) continue;
      const bid = n(it.bid), ask = n(it.ask);
      out.set(normalizeOcc(it.symbol), {
        oi: n(it['open-interest']),
        volume: n(it.volume),
        delta: n(it.delta),
        gamma: n(it.gamma),
        theta: n(it.theta),
        vega: n(it.vega),
        iv: n(it['implied-volatility']) || n(it.volatility),
        bid,
        ask,
        mark: n(it.mark) || (bid > 0 && ask > 0 ? (bid + ask) / 2 : 0),
      });
    }
  }
  return out;
}

/**
 * Build the legacy nested chain payload for a ticker + optional expiration.
 * @param {string} ticker
 * @param {string} [expiration] YYYY-MM-DD; when omitted, includes the nearest
 *   expiration plus up to two more (0DTE prioritized).
 * @returns {Promise<{items:Array, underlyingPrice:number, rootSymbol:string, symbol:string}>}
 */
async function fetchChainFull(ticker, expiration = '') {
  const root = chainTicker(ticker);
  const { expirations, contracts } = await getChainCached(ticker);

  // Decide which expirations to include.
  let targetExps;
  if (expiration) {
    targetExps = expirations.filter((e) => e === expiration);
    if (!targetExps.length) targetExps = [expiration];
  } else {
    const today = todayYmd().ymd;
    const future = expirations.filter((e) => e >= today);
    if (future[0] === today) {
      targetExps = [today, ...future.filter((e) => e !== today).slice(0, 2)];
    } else {
      targetExps = future.slice(0, 3);
    }
  }
  const expSet = new Set(targetExps);

  const scoped = contracts.filter((c) => expSet.has(c.expiration));
  // TastyTrade REST by-type prices SPX/NDX index options under equity-option[]
  // (confirmed working); index-option[] returned nothing and broke SPX.
  const mdMap = await fetchOptionMarketData(scoped.map((c) => c.occSymbol), 'equity-option');
  const underlyingPrice = await fetchUnderlyingSpot(ticker);
  // Before 9:30 ET, REST `volume` still holds the prior session's cumulative
  // total — zero it so the new session starts clean. OI is untouched.
  const preOpen = isPreOpenEt();

  // Group into nested expGroups -> strikes -> { call, put }.
  const expMap = new Map();
  for (const c of scoped) {
    if (!expMap.has(c.expiration)) {
      expMap.set(c.expiration, { 'expiration-date': c.expiration, _strikes: new Map() });
    }
    const eg = expMap.get(c.expiration);
    const key = String(c.strike);
    if (!eg._strikes.has(key)) eg._strikes.set(key, { 'strike-price': key });
    const md = mdMap.get(normalizeOcc(c.occSymbol)) || {};
    const side = c.type === 'C' ? 'call' : 'put';
    eg._strikes.get(key)[side] = {
      symbol: c.occSymbol || '',
      'streamer-symbol': c.streamerSymbol || '',
      'open-interest': md.oi || 0,
      openInterest: md.oi || 0,
      volume: preOpen ? 0 : (md.volume || 0),
      delta: md.delta || 0,
      gamma: md.gamma || 0,
      theta: md.theta || 0,
      vega: md.vega || 0,
      'implied-volatility': md.iv || 0,
      bid: md.bid || 0,
      ask: md.ask || 0,
      mark: md.mark || 0,
    };
  }

  const items = [...expMap.values()]
    .map((eg) => ({
      'expiration-date': eg['expiration-date'],
      strikes: [...eg._strikes.values()].sort(
        (a, b) => parseFloat(a['strike-price']) - parseFloat(b['strike-price'])
      ),
    }))
    .sort((a, b) => String(a['expiration-date']).localeCompare(String(b['expiration-date'])));

  return { items, underlyingPrice, rootSymbol: root, symbol: root };
}

/**
 * Per-contract marks for a list of OCC option symbols — backs
 * /api/em/option-marks (the EstimatedMoves IV=0 straddle fallback). Returns the
 * legacy shape { items: [{ symbol, iv, bid, ask, mark, last, ... }] } the client
 * Object.assigns onto its option rows. TastyTrade REST by-type prices both equity
 * AND index (SPX/NDX) options under equity-option[].
 *
 * @param {string[]} symbols OCC option symbols (e.g. "SPXW  260624C07380000")
 * @returns {Promise<{items:Array}>}
 */
async function fetchOptionMarks(symbols) {
  const n = firstFiniteNumber;
  const clean = (symbols || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!clean.length) return { items: [] };

  const map = await fetchOptionMarketData(clean, 'equity-option'); // keyed by normalizeOcc
  const items = [];
  for (const occ of clean) {
    const md = map.get(normalizeOcc(occ));
    if (!md) continue;
    items.push({
      symbol: occ,
      iv: n(md.iv),
      bid: n(md.bid),
      ask: n(md.ask),
      mark: n(md.mark),
      last: n(md.mark) || (md.bid > 0 && md.ask > 0 ? (md.bid + md.ask) / 2 : 0),
    });
  }
  return { items };
}

/**
 * Build the expirations list in the legacy shape:
 *   { items: [{ "expiration-date", "expiration-type", "root-symbol" }], ... }
 */
async function fetchExpirations(ticker) {
  const root = chainTicker(ticker);
  const { expirations } = await getChainCached(ticker);
  const today = todayYmd().ymd;
  const items = expirations
    .filter((e) => e >= today)
    .map((d) => ({
      'expiration-date': d,
      'expiration-type': 'Weekly',
      'root-symbol': root,
    }));
  return { items, symbol: root, rootSymbol: root };
}

// ---------------------------------------------------------------------------
// Market-data history (weekly candles) — backs /api/dxlink/candles, which the
// Estimated-Moves "No Short / No Long Zones" tab uses for weekly OHLC. server-v2
// originally had no history route (every request 404'd: "unknown proxy route").
//
// Source = Yahoo Finance, matching the legacy server/ stack. Tastytrade's
// /market-data/history REST endpoint 400s for this use, so the old code already
// relied on Yahoo (query1.finance.yahoo.com/v8/finance/chart). Yahoo serves
// weekly bars directly (interval=1wk) for equities, indices and futures, no
// auth required.
// ---------------------------------------------------------------------------

const _historyCache = new Map(); // yahooSym -> { ts, payload }
const HISTORY_TTL_MS = 15 * 60 * 1000;

// Index / futures roots Yahoo addresses under special tickers; equities pass
// through unchanged. Mirrors the legacy yahooSymbolMap.
const YAHOO_SYMBOL = {
  SPX: '^GSPC', NDX: '^NDX', RUT: '^RUT', VIX: '^VIX', DJX: '^DJI', XSP: '^GSPC',
};

/**
 * Translate a zone/history request symbol into a Yahoo Finance ticker.
 * The client sends dxLink forms like "AAPL{=w}", "$SPX{=w}", "/ESU6{=w}",
 * "/NQ{=w}". We strip the aggregation suffix and map indices/futures.
 */
function historyYahooSymbol(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/\{=[^}]*\}$/, ''); // strip {=w} / {=1w}
  s = s.replace(/^\$/, '');         // $SPX -> SPX
  if (/^\/ES/i.test(s)) return 'ES=F';
  if (/^\/NQ/i.test(s)) return 'NQ=F';
  if (/^\/RTY/i.test(s)) return 'RTY=F';
  if (s.startsWith('/')) return s.slice(1).toUpperCase() + '=F'; // other future, best effort
  s = s.toUpperCase();
  return YAHOO_SYMBOL[s] || s;
}

/**
 * Fetch ~1y of WEEKLY OHLC for any symbol from Yahoo. Returns the normalized
 * shape { data: { items: [{ time(ms), open, high, low, close, volume }] } }
 * that the client's parseHistoryItems() already understands.
 */
async function fetchDailyHistory(rawSymbol) {
  const yahoo = historyYahooSymbol(rawSymbol);
  if (!yahoo) throw new Error('Invalid history symbol');

  const cached = _historyCache.get(yahoo);
  if (cached && Date.now() - cached.ts < HISTORY_TTL_MS) return cached.payload;

  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const period1 = period2 - 86400 * 400; // ~13 months
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}`
    + `?period1=${period1}&period2=${period2}&interval=1wk`;

  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Yahoo ${yahoo} -> ${r.status}`);
  const data = await r.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo ${yahoo}: no result`);

  const stamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const items = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const open = Number(q.open?.[i]);
    const high = Number(q.high?.[i]);
    const low = Number(q.low?.[i]);
    const close = Number(q.close?.[i]);
    if (![open, high, low, close].every(Number.isFinite) || close <= 0) continue;
    items.push({ time: Number(stamps[i]) * 1000, open, high, low, close, volume: Number(q.volume?.[i] || 0) });
  }

  const payload = { data: { items } };
  _historyCache.set(yahoo, { ts: Date.now(), payload });
  return payload;
}

// ---------------------------------------------------------------------------
// Prior-RTH-session 4pm close for futures (self-correcting day-change baseline).
//
// TT REST prev-close for /NQ (and /ES) returns the GLOBEX/extended print, not the
// 16:00 ET RTH settle TradingView anchors to — e.g. NQ showed a globex value
// while the real 2026-06-24 4pm close was 29747.25. To get the right baseline we
// pull Yahoo 5-minute bars, pick the most recent PRIOR ET session's 16:00 bar
// close (the 4pm RTH settle), skip non-settle dates, and cache it for the day.
// Keyed by Yahoo future symbol (NQ=F, ES=F, ...). Returns null on any failure so
// the caller can fall back to TT prev-close.
const _futRthCloseCache = new Map(); // yahooSym -> { ymd, close, fetchedAt }
const FUT_RTH_CLOSE_TTL_MS = 5 * 60 * 1000;

function etYmdHm(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const g = (t) => parts.find((p) => p.type === t)?.value || '';
  let hh = g('hour'); if (hh === '24') hh = '00';
  return { ymd: `${g('year')}-${g('month')}-${g('day')}`, hm: `${hh}:${g('minute')}` };
}

/**
 * Most recent prior-session 16:00 ET (4pm RTH) close for a future, from Yahoo 5m
 * bars. Returns a number, or null on failure. `nonSettle` is a Set of YYYY-MM-DD
 * ET dates to skip (holidays/weekends with no official settle).
 */
async function fetchFutRthPrevClose(rawSymbol, nonSettle = ES_NON_SETTLE_DATES) {
  const yahoo = historyYahooSymbol(rawSymbol);
  if (!yahoo) return null;

  const today = todayYmd().ymd;
  const hit = _futRthCloseCache.get(yahoo);
  if (hit && hit.ymd === today && Date.now() - hit.fetchedAt < FUT_RTH_CLOSE_TTL_MS) return hit.close;

  try {
    // includePrePost=false → regular-session bars only, so the single 15:55 bar
    // per date is the RTH close (not an overnight/globex 15:55 bar from the 24h
    // futures feed, which was poisoning the baseline ~29514 vs the real 29747.25).
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}`
      + `?range=7d&interval=5m&includePrePost=false`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Yahoo ${yahoo} 5m -> ${r.status}`);
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    const stamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];

    // Collect each ET session's RTH-close bar (the 4pm settle), excluding today
    // and non-settle dates, then take the most recent. Yahoo stamps 5m bars at
    // their OPEN, so the bar covering 15:55–16:00 is labeled 15:55 — that bar's
    // close is the 16:00 print. Accept 15:55 (preferred) and fall back to a 16:00
    // stamp if a feed ever uses close-stamped bars.
    const closeByDate = new Map();   // 15:55 close
    const closeByDate1600 = new Map(); // 16:00 close (fallback)
    for (let i = 0; i < stamps.length; i += 1) {
      const c = Number(closes[i]);
      if (!Number.isFinite(c) || c <= 0) continue;
      const { ymd, hm } = etYmdHm(stamps[i] * 1000);
      if (ymd === today || nonSettle.has(ymd)) continue;
      if (hm === '15:55') closeByDate.set(ymd, c);
      else if (hm === '16:00') closeByDate1600.set(ymd, c);
    }
    if (!closeByDate.size && closeByDate1600.size) {
      for (const [k, v] of closeByDate1600) closeByDate.set(k, v);
    }
    const dates = [...closeByDate.keys()].sort();
    const prevDate = dates[dates.length - 1];
    const close = prevDate ? closeByDate.get(prevDate) : null;
    if (close && close > 0) {
      console.log(`[FUT-RTH-CLOSE] ${yahoo} prevSettleDate=${prevDate} close=${close} (sessions: ${dates.join(',')})`);
      _futRthCloseCache.set(yahoo, { ymd: today, close, fetchedAt: Date.now() });
      return close;
    }
  } catch (err) {
    console.warn(`[FUT-RTH-CLOSE] ${rawSymbol}:`, String(err.message).slice(0, 140));
  }
  return null;
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
              // TimeAndSale = true tick-by-tick time & sales (real per-print size +
              // exchange aggressorSide). Used for the ES footprint bubbles, which
              // the conflated Trade event under-reported. Verified streaming for ES
              // on the api-quote token with size + BUY/SELL aggressorSide.
              TimeAndSale: ['eventType', 'eventSymbol', 'time', 'price', 'size', 'aggressorSide'],
              Candle: ['eventType', 'eventSymbol', 'time', 'open', 'high', 'low', 'close', 'volume'],
            },
          });
          this.channelOpen = true;
          if (this.pending.length) {
            const queued = this.pending.splice(0);
            const candleSubs = queued.filter((q) => q && q.__candle);
            const regular = queued.filter((q) => !(q && q.__candle));
            if (regular.length) this.subscribe(regular);
            for (const c of candleSubs) {
              this._send({ type: 'FEED_SUBSCRIPTION', channel: this.channel, add: [c.sub] });
            }
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

  /**
   * Subscribe to a Candle stream for one symbol. dxLink candle symbols carry a
   * period suffix, e.g. "/ESU26:XCME{=5m}". Passing fromTime (epoch ms) makes
   * dxFeed replay a historical snapshot of bars since that time, then stream
   * live updates for the forming bar.
   * @param {string} candleSymbol full candle symbol incl. {=5m}
   * @param {number} [fromTime] epoch ms for historical snapshot start
   */
  subscribeCandle(candleSymbol, fromTime) {
    const sub = { type: 'Candle', symbol: candleSymbol };
    if (fromTime != null) sub.fromTime = fromTime;
    if (!this.channelOpen) {
      this.pending.push({ __candle: true, sub });
      return;
    }
    this._send({ type: 'FEED_SUBSCRIPTION', channel: this.channel, add: [sub] });
  }

  /** Remove feed subscriptions for the given streamer symbols (all event types). */
  unsubscribe(symbols) {
    if (!this.channelOpen) {
      this.pending = (this.pending || []).filter((s) => {
        const sym = typeof s === 'string' ? s : s.symbol;
        return !symbols.includes(sym);
      });
      return;
    }
    const remove = symbols.flatMap((s) => {
      const sym = typeof s === 'string' ? s : s.symbol;
      return ['Quote', 'Greeks', 'Summary', 'Trade'].map((type) => ({ type, symbol: sym }));
    });
    const CHUNK = 500;
    for (let i = 0; i < remove.length; i += CHUNK) {
      this._send({ type: 'FEED_SUBSCRIPTION', channel: this.channel, remove: remove.slice(i, i + CHUNK) });
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
  TimeAndSale: ['eventType', 'eventSymbol', 'time', 'price', 'size', 'aggressorSide'],
  Candle: ['eventType', 'eventSymbol', 'time', 'open', 'high', 'low', 'close', 'volume'],
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
    this.optSessionKey = null; // SPX session key (~6PM ET rollover) the OI/volume maps belong to
    this.sessionRollTimer = null; // self-rescheduling watcher that re-arms OI + clears volume at rollover
    this.oiCoverage = 0;      // 0..1 fraction of active strikes that have OI (last backfill)
    this.oiReady = false;     // true once OI coverage crosses threshold, plateaus, or grace elapses
    this.oiPlateauHits = 0;   // consecutive backfills with negligible OI-coverage gain
    this.greeksCoverage = 0;  // 0..1 fraction of in-window legs with a real streamed gamma
    this.chartReady = false;  // true once OI + greeks are warm (or grace elapses) — gates broadcast
    this.prevGreeksCoverage = 0; // greeks coverage at the previous recompute (plateau detection)
    this.greeksPlateauHits = 0;  // consecutive recomputes with negligible coverage gain
    this.firstSubAt = 0;      // ms timestamp of first subscribe (grace-period anchor)
    this.oiTimer = null;
    this.flowTimer = null;
    this.idle = (() => {
      try { return !!JSON.parse(fs.readFileSync(IDLE_STATE_FILE, 'utf8')).idle; }
      catch { return false; }
    })();
    this.spot = 0;
    // Cash-basis = (broker spot − esFut), captured while the live RTH SPX quote
    // is fresh. Off-hours the SPX quote goes stale, so we publish a DISPLAY spot
    // of (esFut + cashBasis) that tracks the live ES future. Persisted across the
    // session via disk so an overnight restart still has a basis to derive from.
    this.cashBasis = (() => {
      try { const v = Number(JSON.parse(fs.readFileSync(CASH_BASIS_FILE, 'utf8')).basis); return Number.isFinite(v) ? v : 0; }
      catch { return 0; }
    })();
    this.spotSymbol = null; // resolved dxLink streamer symbol for the underlying
    this.underlying = null; // { symbol, klass, marketDataParam, streamerSymbol }
    this.vixSymbol = null;  // resolved dxLink streamer symbol for VIX
    this.esSymbol = null;   // resolved dxLink streamer symbol for front ES future
    this.esCandleSymbol = null; // candle stream symbol, e.g. "/ESU26:XCME{=5m}"
    this.esCandles = new Map(); // slotKey -> { timestamp, date, slotKey, time, open, high, low, close, volume }
    this.esCandlesDirty = false; // set when a candle slot changed since last flush
    this.esCandlesDirtySlots = new Set(); // slotKeys changed since last flush (delta broadcast)
    this.candleFlushTimer = null;
    // Live front-ES quote, used by _publishEsFut to clamp the last trade into the
    // current spread (TradingView-style last-price display). Set by the Quote
    // handler; esLastTrade is set by the Trade handler.
    this.esQuote = null;          // { bid, ask, mid } for the front ES future
    this.expiry = '';
    this.recomputeTimer = null;
    // Dev-probe on-demand subscriptions: streamerSymbol -> { since, timer, gotAt }.
    // These are strikes/expiries NOT in the active GEX window that the /dev page
    // asked to inspect. Auto-removed after PROBE_TTL_MS.
    this.probeSubs = new Map();
  }

  /**
   * Fetch the front ES future's prior-session settle from Tastytrade REST and
   * store it as this._esRestSettle — baseline priority tier #1 for ES day-change
   * (see the baseline-priority comment in _flushEsCandles). The plain ES
   * subscription often never delivers a dxLink Summary, so without this the
   * day-change permanently falls back to the candle 15:55 close (~6pt off the
   * official CME settle). Never overwrites a Summary-sourced settle; sets only on
   * a valid positive number so a bad fetch can't zero out a good baseline.
   */
  async _refreshEsSettle() {
    if (!this.esTtSymbol) return;
    try {
      const md = await ttGet(`/market-data/by-type?future[]=${encodeURIComponent(this.esTtSymbol)}`);
      const it = md?.data?.items?.[0];
      const pc = firstFiniteNumber(it?.['prev-close']);
      if (pc > 0) {
        this._esRestSettle = pc;
        if (pc !== this._lastLoggedEsRestSettle) {
          this._lastLoggedEsRestSettle = pc;
          console.log(`[FEED] ES REST settle=${pc} (TT prev-close, baseline tier 1) sym=${this.esTtSymbol}`);
        }
      }
    } catch (err) {
      console.warn('[FEED] ES settle refresh failed:', err.message.slice(0, 120));
    }
  }

  /** Read the persisted idle flag without constructing a feed. Lets the boot
   *  path decide whether to start the feed at all when idle was left ON. */
  static idlePersisted() {
    try { return !!JSON.parse(fs.readFileSync(IDLE_STATE_FILE, 'utf8')).idle; }
    catch { return false; }
  }

  async start() {
    await getAccessToken();

    // Resolve underlying class + real dxLink streamer symbol BEFORE subscribing.
    // Futures/indices/equities differ on both Tastytrade and dxLink; the
    // instrument record's streamer-symbol is the only reliable source.
    this.underlying = await resolveUnderlying(SYMBOL);
    console.log(`[FEED] ${SYMBOL} resolved: class=${this.underlying.klass} streamer=${this.underlying.streamerSymbol}`);

    // Resolve auxiliary quotes: VIX index + front ES future (best-effort).
    try {
      const vix = await resolveUnderlying('VIX');
      this.vixSymbol = vix.streamerSymbol;
      // Prior close for VIX day-change (same REST source as the underlying).
      try {
        const md = await ttGet(`/market-data/by-type?${vix.marketDataParam}`);
        const it = md?.data?.items?.[0];
        const pc = firstFiniteNumber(it?.['prev-close']);
        if (pc > 0) marketState.setAux({ vixPrevClose: pc });
      } catch (err) {
        console.warn('[FEED] VIX prev-close failed:', err.message.slice(0, 120));
      }
    } catch (err) {
      console.warn('[FEED] VIX resolve failed:', err.message.slice(0, 120));
    }
    try {
      const esRes = await resolveFrontEsSymbol();
      this.esSymbol = esRes.streamerSymbol;     // dxLink streamer symbol (/ESU26:XCME)
      this.esTtSymbol = esRes.ttSymbol;         // TT instrument symbol for REST (/ESU6)
      this.esCandleSymbol = `${this.esSymbol}{=5m}`;
      console.log(`[FEED] ES front streamer=${this.esSymbol} ttSymbol=${this.esTtSymbol} candle=${this.esCandleSymbol}`);
      // Prior close for ES future day-change.
      // The authoritative baseline is dxLink Summary.prevDayClosePrice (official
      // exchange settle for the current session, set in _onEvent). The REST
      // /market-data/by-type prev-close lags a session and was producing a wrong
      // day-% (e.g. 7508 vs the real 7564.25 settle), so use it ONLY as a seed
      // before Summary arrives — never let it overwrite a Summary-sourced value.
      await this._refreshEsSettle();
      // Refresh hourly so the baseline self-updates across the daily settlement
      // rollover (~5-6pm ET) without a server restart.
      if (!this._esSettleTimer) {
        this._esSettleTimer = setInterval(() => this._refreshEsSettle().catch(() => {}), 60 * 60 * 1000);
      }
    } catch (err) {
      console.warn('[FEED] ES resolve failed:', err.message.slice(0, 120));
    }

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
    this.firstSubAt = Date.now();
    this.oiReady = false;
    this.oiPlateauHits = 0;
    this.chartReady = false;
    this.prevGreeksCoverage = 0;
    this.greeksPlateauHits = 0;
    this._resubscribe();

    // Subscribe to the 5-minute ES candle stream. fromTime requests a historical
    // snapshot of the past ~15 sessions of 5m bars, then live forming-bar updates.
    if (this.esCandleSymbol) {
      const fromTime = Date.now() - 15 * 86400_000;
      this.client.subscribeCandle(this.esCandleSymbol, fromTime);
      console.log(`[FEED] subscribed ES candles ${this.esCandleSymbol} from ${new Date(fromTime).toISOString()}`);
      // Flush aggregated candles to state + DB on a steady cadence.
      this.candleFlushTimer = setInterval(() => this._flushEsCandles(), CANDLE_FLUSH_MS);
    }

    // Backfill OI/volume from REST now, then refresh periodically (OI only
    // changes once per day, but volume drifts — refresh every 60s once ready).
    // Until coverage is ready, poll fast (every RECOMPUTE_MS) so a partial first
    // backfill fills in within seconds instead of waiting a full 60s cycle.
    await this._refreshOI();
    this._scheduleOiRefresh();

    // Seed the SPX session key now, then watch for the ~6PM ET rollover so OI +
    // volume self-refresh across the session boundary without a restart.
    this.optSessionKey = this._sessionKey();
    this._scheduleSessionRoll();

    this.recomputeTimer = setInterval(() => this._recompute(), RECOMPUTE_MS);
    // Aggregate + broadcast the SPX flow tape every 500ms (independent of GEX).
    this.flowTimer = setInterval(() => {
      marketState.setFlow(this.flow.bucket(SYMBOL));
    }, FLOW_AGGREGATE_MS);

    // start() is the resume path for idle-OFF, and also runs on cold boot. Either
    // way the feed is now live, so the in-memory flag is OFF. (setIdle persists
    // the flag itself; we don't tear down here — a persisted-idle cold boot is
    // handled by the caller checking the file before calling start().)
    this.idle = false;
    marketState.setStatus({ idle: false });
    return this;
  }

  /**
   * SPX session key. SPX/SPXW trade a ~23h session that reopens ~6PM ET, so the
   * "session day" is the ET calendar date AFTER 6PM (a trade at 8PM Mon belongs
   * to Tue's session). Used to detect the session rollover independently of
   * dxFeed — which only *sometimes* pushes a fresh Summary/dayVolume reset at the
   * boundary, leaving OI + volume (and thus the GEX chart) frozen at yesterday.
   */
  _sessionKey(now = new Date()) {
    const hourStr = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', hour12: false,
    }).format(now);
    const etHour = Number(hourStr) % 24;
    const base = todayYmd().ymd;
    if (etHour >= SESSION_ROLL_HOUR_ET) {
      // After the reopen → belongs to the NEXT ET calendar day's session.
      const d = new Date(`${base}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    return base;
  }

  /**
   * Watch for the SPX session rollover (~6PM ET). When the session key advances,
   * the prior session's per-strike dayVolume is stale and OI must be re-pulled:
   * clear this.volumes (so an expired dayVolume can't linger as a REST fallback)
   * and re-arm the OI backfill (oiReady=false → fast re-poll until coverage warms).
   * Self-reschedules each minute; cheap and dxFeed-independent.
   */
  _scheduleSessionRoll() {
    if (this.sessionRollTimer) { clearTimeout(this.sessionRollTimer); this.sessionRollTimer = null; }
    this.sessionRollTimer = setTimeout(() => {
      if (!this.idle) {
        const key = this._sessionKey();
        if (this.optSessionKey && key !== this.optSessionKey) {
          console.log(`[SESSION] SPX rollover ${this.optSessionKey} → ${key}: clearing stale volume + re-arming OI`);
          this.volumes.clear();
          this.oiReady = false;
          this.oiPlateauHits = 0;
          this._refreshOI().catch(() => {}).finally(() => this._scheduleOiRefresh());
        }
        this.optSessionKey = key;
      }
      this._scheduleSessionRoll();
    }, SESSION_ROLL_CHECK_MS);
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
    const prevOiCoverage = this.oiCoverage;
    this.oiCoverage = active.length ? filled / active.length : 0;
    // Mark ready once coverage crosses the threshold (latched — never flips back).
    if (!this.oiReady && this.oiCoverage >= OI_READY_RATIO) {
      this.oiReady = true;
      this.oiPlateauHits = 0;
      console.log(`[OI] coverage ${(this.oiCoverage * 100).toFixed(0)}% ≥ ${(OI_READY_RATIO * 100).toFixed(0)}% — GEX broadcast enabled`);
    } else if (!this.oiReady) {
      // Plateau: some expiries (esp. thinner ones) never reach the ratio because
      // far-OTM strikes legitimately carry no OI. Once coverage stops climbing
      // above a DTE-scaled floor, treat the backfill as complete and release.
      const floor = plateauFloor(dteFromIso(this.expiry));
      const gain = this.oiCoverage - prevOiCoverage;
      if (this.oiCoverage >= floor && gain < OI_PLATEAU_EPS) {
        this.oiPlateauHits = (this.oiPlateauHits || 0) + 1;
      } else {
        this.oiPlateauHits = 0;
      }
      if (this.oiPlateauHits >= OI_PLATEAU_HITS) {
        this.oiReady = true;
        console.log(`[OI] coverage plateaued at ${(this.oiCoverage * 100).toFixed(0)}% (floor ${(floor * 100).toFixed(0)}% @ ${dteFromIso(this.expiry)}DTE) — GEX broadcast enabled`);
      }
    }
    console.log(`[OI] REST backfill: ${filled}/${active.length} strikes with OI`);
  }

  /**
   * Self-rescheduling OI refresh. Polls quickly (RECOMPUTE_MS) while the chart
   * is still gated on coverage, then settles to the normal OI_REFRESH_MS cadence
   * once ready. Keeps a single timer handle in this.oiTimer.
   */
  _scheduleOiRefresh() {
    if (this.oiTimer) { clearTimeout(this.oiTimer); this.oiTimer = null; }
    // OI is static for the session and live volume comes from the dxLink Trade
    // stream (this.volumes), not REST — rest.volume is only a startup fallback.
    // So once coverage is ready we stop polling entirely; the 60s loop was a
    // 24/7 upstream bleed (full chain ×5 batches/min) for data that no longer
    // changes. setExpiry() re-arms it by clearing oiReady before calling here.
    if (this.oiReady) return;
    this.oiTimer = setTimeout(async () => {
      if (this.idle) { this._scheduleOiRefresh(); return; }
      try { await this._refreshOI(); } catch {}
      this._scheduleOiRefresh();
    }, RECOMPUTE_MS);
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
    if (this.vixSymbol) syms.add(this.vixSymbol);
    if (this.esSymbol) syms.add(this.esSymbol);
    for (const c of this._activeContracts()) syms.add(c.streamerSymbol);
    this.client.subscribe([...syms]);
    marketState.setStatus({ contractsSubscribed: syms.size });
  }

  setExpiry(expiry) {
    if (!expiry || expiry === this.expiry) return;
    this.expiry = expiry;
    marketState.setExpiry(expiry);
    // Re-gate: the new expiry's OI + greeks must warm up before we broadcast its chart.
    this.oiReady = false;
    this.oiPlateauHits = 0;
    this.chartReady = false;
    this.prevGreeksCoverage = 0;
    this.greeksPlateauHits = 0;
    marketState.setStatus({ chartReady: false });
    this.firstSubAt = Date.now();
    this._resubscribe();
    // Backfill the new expiry's OI immediately, and resume fast polling until the
    // new expiry's coverage is ready again.
    this._refreshOI().catch(() => {}).finally(() => this._scheduleOiRefresh());
  }

  /**
   * Idle mode: pause the recompute/flow/OI loops to quiet the feed without a
   * full teardown. Resuming restarts the loops. Reflected in market-state status
   * (`idle`) so the dashboard can show the cogwheel red.
   * @param {boolean} idle
   */
  setIdle(idle) {
    const next = !!idle;
    if (next === this.idle) return;
    // Persist + reflect the intent immediately so a page refresh (or a restart
    // mid-transition) sees the new state even though the bring-up is async.
    this.idle = next;
    try { fs.writeFileSync(IDLE_STATE_FILE, JSON.stringify({ idle: next }), 'utf8'); } catch {}
    marketState.setStatus({ idle: next });

    // Idle is now a TRUE kill-switch, not a compute pause: ON tears down the
    // dxLink/TT socket (stops inbound quotes) and all loop timers (stops the
    // GEX/flow/snapshot broadcasts) — zero bandwidth in and out. OFF re-runs the
    // full feed bring-up. We reuse stop()/start() (the same pair reconnect()
    // uses) so there's one battle-tested teardown path. start() is async; guard
    // against overlapping bring-ups from a double-click.
    if (next) {
      try { this.stop(); } catch (e) { console.warn('[IDLE] stop() failed:', e && e.message); }
      console.log('[IDLE] feed stopped — bandwidth paused');
    } else {
      if (this._resuming) return;
      this._resuming = true;
      marketState.setStatus({ reconnecting: true });
      Promise.resolve()
        .then(() => this.start())
        .then(() => { console.log('[IDLE] feed resumed'); })
        .catch((e) => { console.warn('[IDLE] resume start() failed:', e && e.message); })
        .finally(() => { this._resuming = false; marketState.setStatus({ reconnecting: false }); });
    }
  }

  /**
   * Push the current 5m ES candle map into market-state (for WS broadcast) and
   * persist changed bars to Postgres. Throttled by the 5s flush timer; only does
   * work when a candle slot changed since the last flush. Per-slot avgVolume
   * (5/14-day baselines) is computed client-side from SQLite history, so the
   * server stores raw bars only.
   */
  /**
   * Publish the ES live price (esFut), snapped to the 0.25 tick. Source priority:
   * the last traded price CLAMPED into the current bid/ask — this matches
   * TradingView's last-price display while following the market when the spread
   * moves past a stale print. Falls back to the mid, then bid/ask, then last
   * trade. Single esFut writer; setAux dedupes so identical snaps don't rebroadcast.
   */
  _publishEsFut() {
    const q = this.esQuote || {};
    const bid = Number(q.bid) || 0;
    const ask = Number(q.ask) || 0;
    const last = Number(this.esLastTrade) || 0;
    let px = 0;
    if (last > 0 && bid > 0 && ask > 0 && ask >= bid) {
      px = Math.min(Math.max(last, bid), ask); // clamp last into [bid, ask]
    } else if (bid > 0 && ask > 0 && ask >= bid) {
      px = (bid + ask) / 2;
    } else if (last > 0) {
      px = last;
    } else if (bid > 0) {
      px = bid;
    } else if (ask > 0) {
      px = ask;
    }
    if (px > 0) marketState.setAux({ esFut: Math.round(px * 4) / 4 });
    // Display SPX rides on ES off-hours; recompute it whenever ES moves.
    this._publishSpotDisplay();
  }

  /**
   * Publish the DISPLAY SPX (broadcast as `spotDisplay`, separate from this.spot
   * which stays the broker quote that all GEX math is priced on).
   *   • During RTH (9:30–16:00 ET): the live broker spot is fresh → publish it,
   *     and capture cashBasis = spot − esFut for off-hours use.
   *   • Outside RTH: the SPX quote is stale → publish esFut + cashBasis so the
   *     number tracks the live ES future instead of freezing.
   * Same 7500-scale as the walls/MVC — no instrument change, just keeps SPX live.
   */
  _publishSpotDisplay() {
    const esFut = Number(marketState.getState().esFut) || 0;
    let display = 0;
    if (isRthEt() && this.spot > 0) {
      display = this.spot;
      if (esFut > 0) {
        const basis = this.spot - esFut;
        // Only persist on a meaningful change to avoid disk churn every tick.
        if (Math.abs(basis - this.cashBasis) > 0.01) {
          this.cashBasis = basis;
          try { fs.writeFileSync(CASH_BASIS_FILE, JSON.stringify({ basis, at: Date.now() })); } catch {}
        }
      }
    } else if (esFut > 0) {
      display = esFut + this.cashBasis; // ES-derived overnight
    } else if (this.spot > 0) {
      display = this.spot; // last resort: stale broker quote
    }
    if (display > 0) marketState.setAux({ spotDisplay: Math.round(display * 100) / 100 });
  }

  _flushEsCandles() {
    if (!this.esCandlesDirty) return;
    this.esCandlesDirty = false;
    const dirtySlots = this.esCandlesDirtySlots;
    this.esCandlesDirtySlots = new Set();

    const rows = [...this.esCandles.values()]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-600); // cap payload: ~15 sessions of RTH 5m bars

    // Keep the FULL array in state so a newly-connecting client still gets the
    // complete history in its connect-time snapshot. setStateSilent does NOT emit
    // 'change', so this no longer triggers a full-array broadcast every 5s — the
    // recurring update goes out as a small esCandlesDelta below.
    marketState.setStateSilent({ esCandles: rows });

    // ── Derive ESU live price + day-change baseline from the candle stream ──
    // The plain /ESU26:XCME Quote/Trade/Summary subscription delivers no events
    // (only the {=5m} candle stream does), so esFut/esFutPrevClose never got set
    // and the toolbar fell back to Yahoo — mismatching price vs baseline. The
    // candle bars ARE the broker feed, so use them for BOTH values to keep them
    // on the same source. Latest bar close = live price; the final bar of the
    // most recent PRIOR trading date = the day-change baseline (4pm settle ≈ the
    // last RTH bar). rows are sorted ascending by timestamp.
    if (rows.length) {
      const last = rows[rows.length - 1];
      const lastClose = Number(last.close);
      // NOTE: do NOT set esFut here. The live ES Quote/Trade handler (_onEvent)
      // already publishes esFut from the real-time bid/ask mid. Writing it again
      // from the 5s candle close created two competing writers at different
      // values → the visible flicker. Candles are used ONLY for the baseline.

      const todayDate = last.date;

      // Manual override for holiday-confused sessions: if today's ET date has an
      // entry, use CME's official prior settle. Tomorrow the key won't match, so
      // normal baseline logic resumes automatically.
      const manual = ES_MANUAL_BASELINE.get(todayDate);

      // The day-change baseline must be the prior SETTLE session's 4:00pm ET close
      // (matching TradingView). Two corrections vs a naive "last bar of yesterday":
      //   1. Use the 15:55 bar close (the 4:00pm settle), not the ~17:00 Globex
      //      close — ES trades past 16:00 so the final bar is ~16pts off settle.
      //   2. Skip non-settle dates (weekends + market holidays, e.g. Juneteenth
      //      2026-06-19) — those have no official daily close, so TradingView's
      //      prior close is the last real settle before them (e.g. Thu 06-18).
      // Build the list of distinct prior dates that have a real 15:55 settle bar
      // and aren't holidays, then take the most recent.
      const settleByDate = new Map();
      for (const r of rows) {
        if (r.date === todayDate) continue;
        if (ES_NON_SETTLE_DATES.has(r.date)) continue;
        if (r.time === "15:55" && Number(r.close) > 0) settleByDate.set(r.date, Number(r.close));
      }
      const settleDates = [...settleByDate.keys()].sort(); // ascending
      const prevDate = settleDates.length ? settleDates[settleDates.length - 1] : "";
      const prevClose = prevDate ? settleByDate.get(prevDate) : 0;

      // Baseline source priority for the day-change:
      //   0. Manual override for today (holiday-confused sessions) — CME settle.
      //   1. CME official settlement via TT REST prev-close (_esRestSettle).
      //   2. dxLink Summary settle (_esSummarySettle), if ever delivered.
      //   3. Candle 15:55 close — last-resort fallback only; ~6pt off official.
      if (manual > 0) {
        if (manual !== this._lastLoggedEsBaseline) {
          this._lastLoggedEsBaseline = manual;
          console.log(`[FEED] ES baseline=${manual} (MANUAL override for ${todayDate}; CME settle) live=${lastClose} -> chg=${(lastClose - manual).toFixed(2)}`);
        }
        marketState.setAux({ esFutPrevClose: manual });
      } else if (this._esRestSettle > 0 && !(this._esSummarySettle > 0)) {
        // Tier 1: CME official settle via TT REST (_refreshEsSettle). Preferred
        // over the candle close; Summary (tier 2, published from _onEvent) still
        // wins if it ever arrives.
        if (this._esRestSettle !== this._lastLoggedEsBaseline) {
          this._lastLoggedEsBaseline = this._esRestSettle;
          console.log(`[FEED] ES baseline=${this._esRestSettle} (REST settle) live=${lastClose} -> chg=${(lastClose - this._esRestSettle).toFixed(2)}`);
        }
        marketState.setAux({ esFutPrevClose: this._esRestSettle });
      } else if (prevClose > 0 && !(this._esRestSettle > 0) && !(this._esSummarySettle > 0)) {
        if (prevClose !== this._lastLoggedEsBaseline) {
          this._lastLoggedEsBaseline = prevClose;
          console.log(`[FEED] ES baseline=${prevClose} prevSettleDate=${prevDate} live=${lastClose} -> chg=${(lastClose - prevClose).toFixed(2)} (candle FALLBACK; no REST/Summary settle; skipped non-settle: ${[...ES_NON_SETTLE_DATES].filter(d => d > prevDate && d < todayDate).join(",") || "none"})`);
        }
        marketState.setAux({ esFutPrevClose: prevClose });
      }
    }

    // Broadcast ONLY the bars that changed this cycle (typically the forming bar,
    // plus a just-closed one). The client merges by slotKey, so a partial array
    // updates the chart correctly without re-sending all 600 bars every 5s.
    const delta = rows.filter((r) => dirtySlots.has(r.slotKey));
    if (delta.length) marketState.setState({ esCandlesDelta: delta });

    // Persist only bars with real volume (skip empty forming snapshots).
    writeEsCandles(rows.filter((r) => Number(r.volume) > 0)).catch(() => {});
  }

  _onEvent(ev) {
    marketState.setStatus({ lastFeedAt: Date.now() });
    const sym = ev.eventSymbol;
    if (!sym) return;

    // Record first-arrival time for dev-probe on-demand subscriptions.
    const ps = this.probeSubs.get(sym);
    if (ps && ps.gotAt == null) ps.gotAt = Date.now();

    // Persist the last event per (symbol, feedType) so the /dev probe can recall
    // a value overnight when the market is closed and no new events arrive.
    if (ev.eventType) {
      // Defer one tick so the per-branch map writes below have landed, then
      // store the normalized feed object the probe will read back.
      const evType = ev.eventType;
      queueMicrotask(() => {
        const normalized = this._readFeed(sym, evType);
        if (normalized) lastEventStore.record(sym, evType, normalized);
      });
    }

    if (ev.eventType === 'Quote') {
      const bid = Number(ev.bidPrice);
      const ask = Number(ev.askPrice);
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
      if (sym === this.spotSymbol) {
        if (mid > 0) {
          this.spot = mid;
          marketState.setSpot(mid);
          this._publishSpotDisplay(); // refresh display SPX + RTH basis capture
        }
        return;
      }
      if (sym === this.vixSymbol) {
        if (mid > 0) marketState.setAux({ vix: mid });
        return;
      }
      if (sym === this.esSymbol) {
        // Keep the live bid/ask so ES Trade ticks can be classified as
        // aggressive-buy (>= ask) vs aggressive-sell (<= bid) for the footprint.
        if (bid > 0 || ask > 0) this.esQuote = { bid, ask, mid };
        // Re-publish on each Quote so a moving spread drags the price with the
        // live market (clamps a stale last-trade into the new bid/ask).
        this._publishEsFut();
        return;
      }
      this.quotes.set(sym, { bid, ask, mid, bidSize: Number(ev.bidSize), askSize: Number(ev.askSize), t: Date.now() });
      return;
    }

    if (ev.eventType === 'Summary') {
      // Open interest is the authoritative per-day value from Summary. dxFeed
      // pushes it once (and on day rollover); never overwrite a known OI with
      // an empty later Summary.
      const prev = this.summaries.get(sym) || {};
      const oi = firstFiniteNumber(ev.openInterest);
      const pc = firstFiniteNumber(ev.prevDayClosePrice);
      this.summaries.set(sym, {
        oi: oi > 0 ? oi : prev.oi || 0,
        prevClose: pc || prev.prevClose || 0,
      });
      // dxLink prevDayClosePrice is the exchange's official prior-session
      // settle for the CURRENT session. On a Sunday/holiday reopen this is
      // Friday's settle — more accurate than the connect-time REST prev-close,
      // which can lag a session. Prefer it for the ES day-change baseline.
      if (sym === this.esSymbol && pc > 0) {
        console.log(`[FEED] ES Summary prevDayClosePrice=${pc} (authoritative baseline) sym=${sym}`);
        this._esSummarySettle = pc; // exchange settle wins over candle-derived
        marketState.setAux({ esFutPrevClose: pc });
      }
      return;
    }

    if (ev.eventType === 'Trade') {
      if (sym === this.spotSymbol) {
        const px = Number(ev.price);
        if (px > 0) {
          this.spot = px;
          marketState.setSpot(px);
          this._publishSpotDisplay(); // refresh display SPX + RTH basis capture
        }
        return;
      }
      if (sym === this.vixSymbol) {
        const px = Number(ev.price);
        if (px > 0) marketState.setAux({ vix: px });
        return;
      }
      if (sym === this.esSymbol) {
        const px = Number(ev.price);
        if (px > 0) {
          // ES Trade drives the live price (esFut): last trade CLAMPED into the
          // live bid/ask, which matches TradingView's last-price display while
          // tracking the market on a wide spread.
          this.esLastTrade = px;
          this._publishEsFut();
        }
        return;
      }
      // dayVolume on the Trade event is the running daily volume for the
      // contract — the correct source for per-strike volume (Summary has none).
      // Store live dayVolume even when it's 0: presence in the map means the
      // stream has delivered an authoritative current-session figure, so the
      // recompute can trust it over the stale prior-session REST volume.
      const dv = firstFiniteNumber(ev.dayVolume);
      if (Number.isFinite(dv)) this.volumes.set(sym, dv);
      const quote = this.quotes.get(sym) || null;
      const sz = Number(ev.size);
      this.flow.addPrint({
        streamerSymbol: sym,
        price: Number(ev.price),
        size: Number.isFinite(sz) ? sz : 0, // snapshot Trade events can omit size → NaN; guard it
        quote,
        // this.spot lags at 0 until the underlying streamer quote arrives; fall
        // back to the authoritative market-state spot (set on every quote + GEX
        // recompute) so isOtm is classified correctly from the very first print.
        spot: this.spot || marketState.getSpot(),
      });
      return;
    }

    if (ev.eventType === 'Candle') {
      // 5-minute ES bars (historical snapshot on subscribe, then live forming bar).
      // dxFeed Candle `time` is the bar-start epoch ms. NaN volume on a forming
      // bar is treated as 0.
      const barTime = Number(ev.time);
      const open = Number(ev.open);
      const high = Number(ev.high);
      const low = Number(ev.low);
      const close = Number(ev.close);
      let volume = Number(ev.volume);
      if (!Number.isFinite(volume)) volume = 0;
      if (!(barTime > 0) || !(open > 0) || !(high > 0) || !(low > 0) || !(close > 0)) return;
      const { slotKey, date, time, slotMs } = etFiveMinSlot(barTime);
      const prev = this.esCandles.get(slotKey);
      const merged = prev
        ? {
            ...prev,
            high: Math.max(prev.high, high),
            low: Math.min(prev.low, low),
            close, // last close wins
            volume: Math.max(prev.volume, volume), // dxFeed candle volume is cumulative-per-bar
          }
        : { timestamp: slotMs, date, slotKey, time, symbol: '/ES', intervalMinutes: 5, source: 'dxlink', open, high, low, close, volume };
      this.esCandles.set(slotKey, merged);
      this.esCandlesDirty = true;
      // Track WHICH slots changed so the flush can broadcast just those bars
      // instead of the whole 600-bar array every cycle.
      this.esCandlesDirtySlots.add(slotKey);
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
    // Idle is a hard kill-switch: even if a reconnect/session-roll re-armed the
    // timer, do no work (and broadcast nothing) while paused.
    if (this.idle) return;
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
      // Current-session volume = live dayVolume from the Trade stream. SPX trades
      // ~23h/day, so this is the authoritative source. The REST `volume` field
      // carries PRIOR-session cumulative volume that hasn't reset for the new
      // session (esp. on near-untraded future expiries), which previously made
      // stale strikes spike vol-GEX and wrongly rank as MVC — only fall back to
      // it when the live stream has genuinely never delivered a print.
      const liveVol = this.volumes.get(c.streamerSymbol);
      const vol = liveVol != null ? liveVol : (rest?.volume || 0);
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
      staged.push({ c, oi, vol, T, iv, gk, mark: mid });
    }

    if (!staged.length) return;

    // Pass 2: compute greeks. Deep-ITM/illiquid legs (iv unsolved) fall back to
    // ATM IV so their gamma is non-zero and their OI counts toward GEX.
    const rows = [];
    for (const st of staged) {
      const { c, oi, vol, T, gk, mark } = st;
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
        mark,                    // live contract price (quote mid, else REST mark)
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

    // Greeks coverage: fraction of in-window legs that carried a REAL streamed
    // broker gamma this pass. Legs without one fall back to BS/ATM-IV gamma,
    // which is the source of the inflated cold-start bars — so we hold the chart
    // until most legs have a genuine gamma.
    const greekLegs = staged.reduce(
      (n, st) => n + (st.gk && Number.isFinite(st.gk.gamma) && st.gk.gamma !== 0 ? 1 : 0),
      0
    );
    this.greeksCoverage = staged.length ? greekLegs / staged.length : 0;

    // Gate: don't broadcast the GEX chart until BOTH OI backfill AND broker
    // greeks have substantially filled in (avoids the half-rendered / inflated
    // chart on connect).
    if (!this.chartReady) {
      // Plateau detection: thin expiries (e.g. far-dated, illiquid) may never
      // reach GREEKS_READY_RATIO. Count consecutive recomputes where coverage
      // barely moved; once it's been flat long enough above a floor, the data
      // has effectively arrived and we release rather than wait out the grace.
      const greeksFloor = plateauFloor(dteFromIso(this.expiry));
      const gain = this.greeksCoverage - this.prevGreeksCoverage;
      if (this.greeksCoverage >= greeksFloor && gain < GREEKS_PLATEAU_EPS) {
        this.greeksPlateauHits += 1;
      } else {
        this.greeksPlateauHits = 0;
      }
      this.prevGreeksCoverage = this.greeksCoverage;

      const graceElapsed = this.firstSubAt && (Date.now() - this.firstSubAt) >= OI_READY_GRACE_MS;
      const covered = this.oiReady && this.greeksCoverage >= GREEKS_READY_RATIO;
      const plateaued = this.oiReady && this.greeksPlateauHits >= GREEKS_PLATEAU_HITS;

      if (covered) {
        this.chartReady = true;
        console.log(`[READY] OI ${(this.oiCoverage * 100).toFixed(0)}% + greeks ${(this.greeksCoverage * 100).toFixed(0)}% — GEX broadcast enabled`);
      } else if (plateaued) {
        this.chartReady = true;
        console.log(`[READY] greeks plateaued at ${(this.greeksCoverage * 100).toFixed(0)}% (OI ${(this.oiCoverage * 100).toFixed(0)}%) — GEX broadcast enabled`);
      } else if (graceElapsed) {
        this.chartReady = true;
        console.log(`[READY] grace elapsed at OI ${(this.oiCoverage * 100).toFixed(0)}% / greeks ${(this.greeksCoverage * 100).toFixed(0)}% — GEX broadcast enabled`);
      } else {
        marketState.setStatus({ chartReady: false, oiCoverage: this.oiCoverage, greeksCoverage: this.greeksCoverage });
        return; // hold the frame until both OI and greeks are ready
      }
      marketState.setStatus({ chartReady: true });
    }

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

    // Flow is aggregated + broadcast on its own 500ms loop (see flowTimer).

    // Persist per-strike net GEX history (rate-limited, fire-and-forget).
    // Feeds the dashboard's rolling-net-GEX view via
    // /api/snapshots/option-strike-gex-history. No-ops without DATABASE_URL.
    writeGexSnapshot(gexRows, this.spot, this.expiry).catch(() => {});
  }

  /**
   * Dev probe: return the latest cached feed event for a single built streamer
   * symbol, drawn from the SAME live maps that feed the GEX chart. Used by the
   * /dev test page to inspect raw proxy data per strike.
   * @param {string} builtSymbol e.g. ".SPXW260618P7265"
   * @param {string} feedType "Greeks" | "Quote" | "Trade" | "Summary"
   * @returns {{ found: boolean, feedType: string, result: object|null }}
   */
  /** True if the symbol is already covered by the active GEX-window subscription. */
  _isActiveSub(sym) {
    for (const c of this._activeContracts()) {
      if (c.streamerSymbol === sym) return true;
    }
    return false;
  }

  /**
   * Subscribe to a single symbol on demand (for the dev probe) if it isn't
   * already in the active GEX window. Records the subscribe time and schedules
   * an auto-unsubscribe after PROBE_TTL_MS. Idempotent.
   */
  _ensureProbeSub(sym) {
    if (!sym || this._isActiveSub(sym) || this.probeSubs.has(sym)) return;
    const entry = { since: Date.now(), gotAt: null, timer: null };
    entry.timer = setTimeout(() => this._dropProbeSub(sym), PROBE_TTL_MS);
    this.probeSubs.set(sym, entry);
    try { this.client?.subscribe([sym]); } catch { /* noop */ }
    console.log(`[PROBE] subscribed ${sym} (auto-drop in ${Math.round(PROBE_TTL_MS / 60000)}m)`);
  }

  /** Remove a dev-probe on-demand subscription and its cached data. */
  _dropProbeSub(sym) {
    const e = this.probeSubs.get(sym);
    if (!e) return;
    if (e.timer) clearTimeout(e.timer);
    this.probeSubs.delete(sym);
    // Don't tear down a symbol the chart is now using.
    if (!this._isActiveSub(sym)) {
      try { this.client?.unsubscribe([sym]); } catch { /* noop */ }
      this.quotes.delete(sym);
      this.greeks.delete(sym);
      this.summaries.delete(sym);
      this.volumes.delete(sym);
    }
    console.log(`[PROBE] unsubscribed ${sym}`);
  }

  _readFeed(sym, ft) {
    switch (ft) {
      case 'Greeks': {
        const g = this.greeks.get(sym);
        return g ? { eventType: 'Greeks', eventSymbol: sym, volatility: g.iv, delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega } : null;
      }
      case 'Quote': {
        const q = this.quotes.get(sym);
        return q ? { eventType: 'Quote', eventSymbol: sym, bid: q.bid, ask: q.ask, mid: q.mid } : null;
      }
      case 'Trade': {
        const v = this.volumes.get(sym);
        return v != null ? { eventType: 'Trade', eventSymbol: sym, dayVolume: v } : null;
      }
      case 'Summary': {
        const s = this.summaries.get(sym);
        const rest = this.restOI.get(sym);
        return (s || rest) ? { eventType: 'Summary', eventSymbol: sym, openInterest: s?.oi ?? rest?.oi ?? null, prevClose: s?.prevClose ?? null, restVolume: rest?.volume ?? null } : null;
      }
      default: return null;
    }
  }

  /**
   * Resolve a probe request to a REAL chain streamer symbol.
   *
   * The /dev page builds a symbol by formatting whatever strike was typed
   * (e.g. 7500 -> .SPXW260622P7500), but the feed only ever emits the exact
   * streamer symbols from the option chain (e.g. .SPXW260622P7495). If the typed
   * strike isn't a real chain strike, the built symbol never matches any event
   * and the probe shows nothing. So:
   *   1. If the built symbol matches a chain contract exactly, use it.
   *   2. Otherwise snap to the nearest available strike for that expiry+side and
   *      return that contract's real streamer symbol, flagging that we snapped.
   *
   * @returns {{ sym:string, snapped:boolean, requestedStrike:number|null, resolvedStrike:number|null }}
   */
  _resolveChainSymbol(builtSymbol) {
    const built = String(builtSymbol || '').trim();
    // Exact hit — the typed strike is a real chain strike.
    if (this.contracts.has(built)) {
      const c = this.contracts.get(built);
      return { sym: built, snapped: false, requestedStrike: c?.strike ?? null, resolvedStrike: c?.strike ?? null };
    }
    // Parse the built symbol: .SPXW + YYMMDD + (C|P) + strike
    const m = /^(\.[A-Z]+)(\d{6})([CP])(\d+(?:\.\d+)?)$/.exec(built);
    if (!m) return { sym: built, snapped: false, requestedStrike: null, resolvedStrike: null };
    const [, , yymmdd, cp, strikeStr] = m;
    const reqStrike = Number(strikeStr);
    const expiry = `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
    const type = cp; // 'C' | 'P'

    // Find the nearest real strike for this expiry + side.
    let best = null;
    let bestDist = Infinity;
    for (const c of this.contracts.values()) {
      if (c.expiration !== expiry || c.type !== type) continue;
      const d = Math.abs(Number(c.strike) - reqStrike);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    if (!best) return { sym: built, snapped: false, requestedStrike: reqStrike, resolvedStrike: null };
    return {
      sym: best.streamerSymbol,
      snapped: best.streamerSymbol !== built,
      requestedStrike: reqStrike,
      resolvedStrike: best.strike,
    };
  }

  /**
   * Dev probe. Returns cached feed data for a built symbol; if not yet
   * subscribed, subscribes on demand and returns a pending status the /dev page
   * can poll. Reports how long data took to arrive (waitedMs).
   */
  async probeSymbol(builtSymbol, feedType = 'Greeks') {
    const ft = String(feedType || 'Greeks');
    // Resolve the typed/built symbol to a real chain streamer symbol (snapping
    // to the nearest strike if the exact one isn't in the chain).
    const resolved = this._resolveChainSymbol(builtSymbol);
    const sym = resolved.sym;
    // Echoed back so the page can show which real contract was probed and
    // whether the typed strike had to be snapped to the nearest chain strike.
    const meta = {
      resolvedSymbol: sym,
      snapped: resolved.snapped,
      requestedStrike: resolved.requestedStrike,
      resolvedStrike: resolved.resolvedStrike,
    };
    const active = this._isActiveSub(sym);
    const result = this._readFeed(sym, ft);
    const sub = this.probeSubs.get(sym);

    if (result != null) {
      // Time from on-demand subscribe to first event (0 if it was already live).
      const waitedMs = sub && sub.gotAt != null ? sub.gotAt - sub.since : 0;
      return { ...meta, found: true, status: 'ready', feedType: ft, result, waitedMs, source: active ? 'active' : (sub ? 'probe' : 'cache') };
    }

    // Subscribe on demand so a live value can fill in if the feed is open.
    if (!active) this._ensureProbeSub(sym);
    const since = this.probeSubs.get(sym)?.since ?? Date.now();
    const waited = Date.now() - since;

    // No live event in the maps. Return a remembered value IMMEDIATELY rather
    // than spinning — the live map was already checked above, so RTH fresh data
    // still wins; this only fires when the feed has nothing right now.
    //   - in-memory tier is synchronous and free → check every call.
    //   - DB tier costs a round-trip → only consult it on the FIRST poll
    //     (waited≈0), so repeat polls stay fast and don't hammer Postgres.
    const stale = lastEventStore.getMem(sym, ft)
      || (waited < 750 ? await lastEventStore.getDb(sym, ft) : null);
    if (stale && stale.result != null) {
      return {
        ...meta,
        found: true,
        status: 'stale',
        feedType: ft,
        result: stale.result,
        waitedMs: 0,
        source: 'stale',
        staleAt: stale.seenAt,
        staleAgeMs: Date.now() - stale.seenAt,
      };
    }

    // Nothing cached anywhere yet — report pending; the page can keep polling.
    return { ...meta, found: false, status: 'pending', feedType: ft, result: null, waitedMs: waited, ttlMs: PROBE_TTL_MS };
  }

  /**
   * Serve a nested chain payload from the LIVE subscriber maps instead of a
   * fresh Tastytrade REST pull — but ONLY when this subscriber fully covers the
   * request. Returns the SAME shape as fetchChainFull(); returns null to signal
   * "not covered — fall back to REST".
   *
   * Coverage requires ALL of:
   *   - ticker root === the subscribed SYMBOL (the feed only streams one underlying)
   *   - the requested expiration === this.expiry (the active gated expiry), OR no
   *     expiration was requested and this.expiry is the nearest (matches the REST
   *     default closely enough that the chart pages request it explicitly anyway)
   *   - this.spot > 0 (needed to define the in-window strike set)
   *   - every in-window strike on the active expiry has at least one streamed leg
   *
   * The strike set served is exactly _activeContracts() — the ±window the feed
   * subscribes. If the page asks for a wider chain, this can't fully serve it, so
   * we return null and let REST handle the whole request (all-or-nothing — no
   * partial/blank strikes, no mixed staleness).
   *
   * @param {string} ticker
   * @param {string} [expiration] YYYY-MM-DD
   * @returns {{items:Array, underlyingPrice:number, rootSymbol:string, symbol:string}|null}
   */
  serveChainFromLive(ticker, expiration = '') {
    // Set CHAIN_LIVE_DEBUG=1 to log which gate sends a request to REST instead
    // of serving it live. Remove once the live path is confirmed in production.
    const dbg = process.env.CHAIN_LIVE_DEBUG === '1';
    const miss = (reason) => {
      if (dbg) console.log(`[CHAIN-LIVE] ${ticker}/${expiration || '(nearest)'} -> REST: ${reason}`);
      return null;
    };
    const root = chainTicker(ticker);
    // Only the subscribed underlying is live.
    if (root !== SYMBOL) return miss(`root ${root} !== feed ${SYMBOL}`);
    // Must have a spot to define the window, and the feed must be warmed up.
    if (!(this.spot > 0)) return miss('no spot yet');
    if (!this.chartReady) return miss('chart not ready (feed warming/closed)');
    // Only the active expiry is streamed. An explicit request for a different
    // expiry can't be served live.
    if (expiration && expiration !== this.expiry) return miss(`expiry ${expiration} !== active ${this.expiry}`);
    const exp = this.expiry;
    if (!exp) return miss('no active expiry');

    const active = this._activeContracts();
    if (!active.length) return miss('no active contracts in window');

    // Build the nested {call, put} strike map from live state. Bail to REST the
    // moment a strike has no streamed data at all — a partial live chain would
    // silently blank real strikes.
    const strikes = new Map(); // strikeKey -> { 'strike-price', call?, put? }
    for (const c of active) {
      const q = this.quotes.get(c.streamerSymbol);
      const gk = this.greeks.get(c.streamerSymbol);
      const s = this.summaries.get(c.streamerSymbol);
      const rest = this.restOI.get(c.streamerSymbol);
      const liveVol = this.volumes.get(c.streamerSymbol);

      // Require *some* live signal for this leg; otherwise we can't claim full
      // live coverage — fall back to REST for the whole request.
      if (!q && !gk && !s && !rest) return miss(`leg ${c.streamerSymbol} has no live data (of ${active.length} in-window)`);

      const oi = (rest?.oi ?? 0) || (s?.oi ?? 0);
      const volume = liveVol != null ? liveVol : (rest?.volume || 0);
      const bid = q?.bid || 0;
      const ask = q?.ask || 0;
      const mark = q?.mid > 0 ? q.mid : (rest?.mark || 0);

      const key = String(c.strike);
      if (!strikes.has(key)) strikes.set(key, { 'strike-price': key });
      const side = c.type === 'C' ? 'call' : 'put';
      strikes.get(key)[side] = {
        symbol: c.occSymbol || '',
        'streamer-symbol': c.streamerSymbol || '',
        'open-interest': oi || 0,
        openInterest: oi || 0,
        volume: volume || 0,
        delta: gk?.delta || 0,
        gamma: gk?.gamma || 0,
        theta: gk?.theta || 0,
        vega: gk?.vega || 0,
        'implied-volatility': gk?.iv || 0,
        bid,
        ask,
        mark,
      };
    }

    const items = [{
      'expiration-date': exp,
      strikes: [...strikes.values()].sort(
        (a, b) => parseFloat(a['strike-price']) - parseFloat(b['strike-price'])
      ),
    }];
    return { items, underlyingPrice: this.spot, rootSymbol: root, symbol: root };
  }

  /**
   * Serve option marks for a list of OCC symbols from the LIVE maps. Returns the
   * same { items:[{symbol, iv, bid, ask, mark, last}] } shape as fetchOptionMarks
   * — but ONLY if EVERY requested symbol is present live; otherwise null (→ REST).
   * @param {string[]} occSymbols
   * @returns {{items:Array}|null}
   */
  serveOptionMarksFromLive(occSymbols) {
    const clean = (occSymbols || []).map((s) => String(s || '').trim()).filter(Boolean);
    if (!clean.length) return null;
    // Index live contracts by normalized OCC so we can match the requested OCC
    // symbols against the streamer symbols we hold.
    const byOcc = new Map();
    for (const c of this.contracts.values()) {
      if (c.occSymbol) byOcc.set(normalizeOcc(c.occSymbol), c);
    }
    const items = [];
    for (const occ of clean) {
      const c = byOcc.get(normalizeOcc(occ));
      if (!c) return null; // unknown symbol — REST handles the whole batch
      const q = this.quotes.get(c.streamerSymbol);
      const gk = this.greeks.get(c.streamerSymbol);
      const rest = this.restOI.get(c.streamerSymbol);
      const bid = q?.bid || 0;
      const ask = q?.ask || 0;
      const mark = q?.mid > 0 ? q.mid : (rest?.mark || 0);
      // No live price for this contract — can't fully serve. Fall back.
      if (!(mark > 0) && !(bid > 0) && !(ask > 0)) return null;
      items.push({
        symbol: occ,
        iv: gk?.iv || 0,
        bid,
        ask,
        mark,
        last: mark || (bid > 0 && ask > 0 ? (bid + ask) / 2 : 0),
      });
    }
    return { items };
  }

  stop() {
    for (const [, e] of this.probeSubs) { if (e.timer) clearTimeout(e.timer); }
    this.probeSubs.clear();
    if (this.recomputeTimer) clearInterval(this.recomputeTimer);
    if (this.oiTimer) clearTimeout(this.oiTimer);
    if (this.flowTimer) clearInterval(this.flowTimer);
    this.recomputeTimer = null;
    this.oiTimer = null;
    this.flowTimer = null;
    this.client?.close();
  }

  /**
   * Tear down the live dxLink/TT connection and re-establish it from scratch.
   * Used by the owner dashboard "Reconnect Feed" button to recover from a dropped
   * dxLink socket or expired TT auth without a full Render restart.
   */
  async reconnect() {
    marketState.setStatus({ reconnecting: true });
    try { this.stop(); } catch {}
    // Honor persisted idle: if the owner left the feed paused, a reconnect must
    // NOT silently bring it back (that was the old "idle reverts" bug). Stay
    // down and reflect idle; otherwise do a clean start.
    if (TastytradeProxy.idlePersisted()) {
      this.idle = true;
      marketState.setStatus({ idle: true, reconnecting: false });
      console.log('[RECONNECT] idle persisted ON — feed left paused');
      return true;
    }
    this.idle = false;
    await this.start();
    marketState.setStatus({ reconnecting: false });
    return true;
  }
}

module.exports = { TastytradeProxy, fetchChain, fetchChainFull, fetchExpirations, fetchOptionMarks, fetchUnderlyingQuotes, fetchDailyHistory, probeRest, getAccessToken, getQuoteToken, DxLinkClient };
