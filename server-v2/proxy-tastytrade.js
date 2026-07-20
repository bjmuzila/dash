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

const { useTheta, useThetaIndex } = require('./config/data-source');
const thetaAdapterQuotes = require('./proxy-thetadata'); // stock quotes when DATA_SOURCE=theta
const thetaAdapter = require('./proxy-thetadata');
const marketState = require('./state/market-state');
const { writeGexSnapshot } = require('./state/gex-history-writer');
const { writeFlowTape } = require('./state/flow-history-writer');
const { rehydrateAccumulator } = require('./state/flow-gex-rehydrate');
const { writeEsCandles, writeNqCandles } = require('./state/es-candle-writer');
const { recordSignals } = require('./state/momentum-bias-writer');
const { getMomentumBiasIndex } = require('../lib/momentumBias.js');
const lastEventStore = require('./state/last-event-store');
const { computeGexSummary } = require('./computation/gex-calculator');
const { emptyTotals, accumulateExposureTotals } = require('./computation/vex-chex');
const { FlowProcessor } = require('./computation/flow-processor');
const { FlowGexAccumulator } = require('./computation/flow-gex');
const { MultiFlowManager } = require('./multi-flow');
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
const RECOMPUTE_MS = Number(process.env.RECOMPUTE_MS || 5000);
// Off-hours recompute cadence — SPX options barely move, no need for 2s grind.
const RECOMPUTE_MS_OFFHOURS = Number(process.env.RECOMPUTE_MS_OFFHOURS || 15000);
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
// How long the ES Quote/Trade stream may go silent before the 5m candle flush
// takes over as the esFut writer. See _publishEsFutFromCandle.
const ES_TICK_STALE_MS = Number(process.env.ES_TICK_STALE_MS || 30000);
// Volume-only refresh cadence (Theta mode). OI is once-daily (OPRA ~06:30 ET)
// and never needs re-polling after coverage is ready. Volume builds intraday, so
// we refresh it separately at a slower rate — no need for every-60s full chain.
const VOL_REFRESH_MS = Number(process.env.VOL_REFRESH_MS || 2 * 60 * 1000); // 2 min
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
// Kill switch: when set, broadcast the GEX chart on the first recompute frame
// instead of waiting for the OI/greeks readiness gate. Fast load; the cold-start
// frame may briefly show BS-fallback gamma before backfill lands (self-corrects).
const GEX_GATE_DISABLED = /^(1|true|yes)$/i.test(process.env.GEX_GATE_DISABLED || '');
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

// Flow subscription strategy. Default (0) = per-contract STREAM per active window
// (cheap for few roots). Set FLOW_BULK_STREAM=1 to instead use ONE STREAM_BULK
// OPTION TRADE firehose filtered client-side to the roots we track (SPXW +
// FLOW_TICKERS). Bulk stops the JVM sub-count from scaling with ticker count —
// use it once FLOW_TICKERS / the scanner push you to many roots. Trade-off: Node
// parses the whole OPRA tape, so only flip it when going wide.
const FLOW_BULK_STREAM = process.env.FLOW_BULK_STREAM === '1';

// ES 5-minute candle broadcast cadence. The forming bar updates on nearly every
// flush while ES is live, so this is effectively how often the live candle
// repaints. 10s keeps it visibly live without one delta every ~5s.
const CANDLE_FLUSH_MS = Number(process.env.CANDLE_FLUSH_MS || 10000);

// ES 1-minute candle stream. OFF by default — it is a second dxLink subscription
// on top of {=5m} at 5x the bar rate, so it is opt-in per environment rather than
// something a deploy silently turns on. Set ES_1M_CANDLES=1 in .env.local.
const ES_1M_ENABLED = process.env.ES_1M_CANDLES === '1';
// Broadcast cadence for the 1m stream. Faster than the 5m flush because a 1m bar
// closes 5x as often and a 10s flush would land two closes in one delta.
const CANDLE_1M_FLUSH_MS = Number(process.env.CANDLE_1M_FLUSH_MS || 5000);
// Hard cap on the 1m bar array. 1 RTH session = 390 bars; 480 gives today plus a
// little overnight without ever approaching the 5m array's 600-bar/15-session
// reach. The es-candles page renders every bar it is handed — this cap IS the
// today-only window.
const ES_1M_MAX_BARS = Number(process.env.ES_1M_MAX_BARS || 480);

// ThetaData greeks poll cadence (DATA_SOURCE=theta only). Greeks/all is one bulk
// REST call per poll; 5s keeps gamma fresh against spot drift without burning the
// concurrency budget. No effect in TT mode.
const THETA_GREEKS_MS = Number(process.env.THETA_GREEKS_MS || 5000);
const THETA_GREEKS_MS_OFFHOURS = Number(process.env.THETA_GREEKS_MS_OFFHOURS || 60000);

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
    // TT's nested endpoint can return MULTIPLE items under one root query —
    // e.g. querying "SPX" returns both the AM-settled monthly (root-symbol
    // "SPX") and the PM-settled weekly (root-symbol "SPXW") as separate items,
    // which collide on the same expiration date on a monthly-expiration
    // Friday (today). Keep each item's own root-symbol on every contract so
    // callers can disambiguate instead of silently taking whichever item
    // happened to come first.
    const itemRoot = item['root-symbol'] || item['underlying-symbol'] || null;
    for (const exp of item.expirations || []) {
      const expiration = exp['expiration-date'];
      if (!expiration) continue;
      expSet.add(expiration);
      const dte = dteFromIso(expiration);
      const settlementType = exp['settlement-type'] || null; // "AM" | "PM"
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
            rootSymbol: itemRoot,
            settlementType,
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
            rootSymbol: itemRoot,
            settlementType,
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
 * Same, at 1-minute granularity.
 *
 * NOTE the slotKey shape is IDENTICAL to etFiveMinSlot's ('YYYY-MM-DDTHH:MM') —
 * it carries no interval. That is why es_candles is keyed
 * UNIQUE("slotKey","intervalMinutes"): the 1m bar at 09:30 and the 5m bar at
 * 09:30 produce the same slotKey, and under the old slotKey-only UNIQUE the 1m
 * write silently overwrote the 5m bar's close+volume. Any writer added here MUST
 * carry its intervalMinutes through to the upsert.
 * See scripts/migrate-es-candles-composite-key.sql.
 */
function etOneMinSlot(ts) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ts));
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === '24' ? '00' : map.hour;
  const date = `${map.year}-${map.month}-${map.day}`;
  const time = `${hour}:${map.minute}`;
  const slotKey = `${date}T${time}`;
  const slotMs = Math.floor(ts / 60000) * 60000;
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

/** True during the INDEX OPTIONS session, 9:30–16:15 ET (Mon–Fri). SPX/SPXW
 *  trade 15min past the 16:00 equity cash close (matches the afterClose 0DTE
 *  roll check in _recompute) — use this, not isRthEt(), to gate anything about
 *  the OPTIONS chain (volume/greeks polling, recompute cadence). isRthEt()
 *  stays 16:00-only for the underlying SPX cash-quote validity window. */
function isOptionsRthEt(ts = Date.now()) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(ts));
  if (wd === 'Sat' || wd === 'Sun') return false;
  const m = etMinutesNow(ts);
  return m >= 9 * 60 + 30 && m < 16 * 60 + 15; // 570 .. 975
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
  return { streamerSymbol: front['streamer-symbol'], ttSymbol: front['symbol'] || front['streamer-symbol'] };
}

async function resolveFrontNqSymbol() {
  const json = await ttGet(`/instruments/futures?product-code[]=NQ`);
  const items = json?.data?.items || [];
  const today = todayYmd().ymd;
  const active = items
    .filter((it) => it['streamer-symbol'] && (it['expiration-date'] || '') >= today)
    .sort((a, b) => String(a['expiration-date']).localeCompare(String(b['expiration-date'])));
  const front = active[0] || items.find((it) => it['streamer-symbol']);
  if (!front?.['streamer-symbol']) throw new Error('No active NQ future found');
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

// ---------------------------------------------------------------------------
// probeRest — Theta-primary, TT for OI comparison.
// Sources: chain=Theta, OI=Theta, greeks=Theta, volume=Theta, spot=Theta.
// TT REST is fetched in parallel solely for OI comparison (oiCompare panel).
// Quote (bid/ask) falls back to TT because Theta has no option bid/ask snapshot.
// ---------------------------------------------------------------------------

// Local key helper matching proxy-thetadata.js convention.
const _probeKeyOf = (exp, strike, type) => `${exp}|${Number(strike)}|${type}`;

/**
 * Probe any ticker via REST — Theta-primary data source.
 * Resolves the strike from Theta's chain, fetches OI/greeks/volume from Theta,
 * and also fetches TT OI so the /dev page can show a Theta vs TT comparison.
 * @param {object} a
 * @param {string} a.ticker   e.g. "SPXW", "AAPL"
 * @param {string} a.expiry   YYYY-MM-DD
 * @param {'C'|'P'} a.type
 * @param {number} a.strike
 */
// ---------------------------------------------------------------------------
// probeRestTT — TastyTrade-REST-primary probe (DATA_SOURCE=tt, Theta paused).
// Mirror of probeRest's result shape, but the strike is resolved from the TT
// chain and OI/greeks/vol/quote come from ONE /market-data/by-type row (TT
// delivers delta/gamma/theta/vega/IV) with spot from the live feed (index) or
// TT underlying. Greeks fall back to Black-Scholes for THIS side when TT's row
// is missing/degenerate, exactly like the Theta path. probeRest() delegates
// here when !useTheta(), so the Theta path is left untouched for theta mode.
// ---------------------------------------------------------------------------
async function probeRestTT({ ticker, expiry, type, strike }) {
  const n = firstFiniteNumber;
  const reqStrike = Number(strike);
  const root = chainTicker(ticker);
  const wantRoot = String(ticker || '').toUpperCase().replace(/^\./, '');

  const ttChain = await getChainCached(ticker).catch(() => ({ expirations: [], contracts: [] }));
  const cands = (ttChain.contracts || []).filter((c) => c.expiration === expiry && c.type === type);
  // On monthly Fridays TT returns both SPX (AM) and SPXW (PM) under one query —
  // prefer the root the user actually typed, else fall back to any match.
  const pool = cands.some((c) => c.rootSymbol === wantRoot)
    ? cands.filter((c) => c.rootSymbol === wantRoot)
    : cands;
  let best = null, bestDist = Infinity;
  for (const c of pool) {
    const d = Math.abs(Number(c.strike) - reqStrike);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  if (!best) {
    const expiryExists = (ttChain.expirations || []).includes(expiry);
    return {
      found: false,
      status: expiryExists ? 'no-strike' : 'no-expiry',
      source: 'tt',
      chainTicker: root,
      requestedStrike: Number.isFinite(reqStrike) ? reqStrike : null,
      resolvedStrike: null,
      availableExpirations: (ttChain.expirations || []).slice(0, 12),
    };
  }

  const occSymbol = best.occSymbol || null;
  const streamerSymbol = best.streamerSymbol || (root + '_' + expiry + '_' + type + best.strike);
  const meta = {
    resolvedSymbol: streamerSymbol,
    occSymbol,
    snapped: Number.isFinite(reqStrike) && best.strike !== reqStrike,
    requestedStrike: Number.isFinite(reqStrike) ? reqStrike : null,
    resolvedStrike: best.strike,
    source: 'tt',
  };

  const [ttItem, spot] = await Promise.all([
    occSymbol
      ? ttGet('/market-data/by-type?equity-option[]=' + encodeURIComponent(occSymbol))
          .then((j) => (j && j.data && j.data.items && j.data.items[0]) || null)
          .catch(() => null)
      : Promise.resolve(null),
    (async () => {
      // Prefer the live feed's published spot for the index root (RTH broker
      // spot, or ES+basis off-hours — same value the rest of the dashboard
      // shows); otherwise the per-ticker TT underlying mark/last.
      const live = Number(marketState.getState().spotDisplay) || 0;
      if (INDEX_ROOTS.has(root) && live > 0) return live;
      try { return (await fetchUnderlyingSpot(ticker)) || live || 0; } catch { return live || 0; }
    })(),
  ]);

  const it = ttItem || {};
  const bid = n(it.bid), ask = n(it.ask);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : (n(it.mark) || null);
  const mark = n(it.mark) || mid;
  const oi = n(it['open-interest']) || null;
  const vol = Number.isFinite(n(it.volume)) ? n(it.volume) : null;

  // TT greeks are delivered on the by-type row. Guard the degenerate all-zero
  // row (thin/0DTE ITM legs) the same way the Theta path guards g.*.
  const gIv = n(it['implied-volatility']) || n(it.volatility);
  const gDelta = n(it.delta), gGamma = n(it.gamma), gTheta = n(it.theta), gVega = n(it.vega);
  const ttGreeksValid = gIv > 0 && !(gGamma === 0 && gTheta === 0 && gVega === 0);

  const T = yearsToExpiry(best.expiration);
  const intrinsic = type === 'C' ? Math.max(spot - best.strike, 0) : Math.max(best.strike - spot, 0);
  const markForBs = [n(it.mark), mid].find((v) => v > intrinsic) ?? null;
  const ivForBs = ttGreeksValid
    ? gIv
    : (markForBs ? impliedVol({ price: markForBs, S: spot, K: best.strike, T, r: RISK_FREE, type }) : NaN);
  const bsRaw = (spot > 0 && T > 0 && ivForBs > 0)
    ? bsGreeks({ S: spot, K: best.strike, T, sigma: ivForBs, r: RISK_FREE, type })
    : null;
  // Same unit normalization as the Theta path: theta per-year -> per-day (/365),
  // vega per 1.00 vol -> per 1% vol (/100).
  const bs = bsRaw ? { ...bsRaw, theta: bsRaw.theta / 365, vega: bsRaw.vega / 100 } : null;

  const feeds = {
    Quote: { bid, ask, mid, mark, bidSize: 0, askSize: 0, _src: 'TT NBBO' },
    Trade: { last: n(it.last), volume: vol, _volumeSrc: 'TT', _src: 'TT last / vol' },
    Summary: {
      openInterest: oi,
      prevClose: n(it['prev-close']),
      prevCloseDate: it['prev-close-date'] ?? null,
      _src: 'TT OI / prevClose',
    },
    Greeks: {
      iv: ttGreeksValid ? gIv : (ivForBs > 0 ? ivForBs : null),
      delta: ttGreeksValid ? gDelta : (bs?.delta ?? null),
      gamma: ttGreeksValid ? gGamma : (bs?.gamma ?? null),
      theta: ttGreeksValid ? gTheta : (bs?.theta ?? null),
      vega: ttGreeksValid ? gVega : (bs?.vega ?? null),
      _src: ttGreeksValid ? 'TT' : 'Black-Scholes (calculated, this side)',
      bsIv: ivForBs > 0 ? ivForBs : null,
      bsDelta: bs?.delta ?? null,
      bsGamma: bs?.gamma ?? null,
      bsTheta: bs?.theta ?? null,
      bsVega: bs?.vega ?? null,
    },
  };

  const isCall = type === 'C';
  const sign = isCall ? 1 : -1;
  const eGamma = ttGreeksValid ? gGamma : (bs?.gamma ?? 0);
  const eDelta = ttGreeksValid ? gDelta : (bs?.delta ?? 0);
  const eVega = ttGreeksValid ? gVega : (bs?.vega ?? 0);
  const eTheta = ttGreeksValid ? gTheta : (bs?.theta ?? 0);
  const exposures = (spot > 0 && oi != null)
    ? {
        spot,
        oi,
        volume: vol,
        gex: sign * Math.abs(eGamma || 0) * oi * spot * spot,
        gexVol: sign * Math.abs(eGamma || 0) * (vol || 0) * spot * spot,
        dex: sign * Math.abs(eDelta || 0) * oi * 100 * spot,
        vex: sign * (eVega || 0) * oi * 100 * spot,
        thetaExp: sign * (eTheta || 0) * oi * 100 * spot,
        vannaExp: bs ? sign * (bs.vanna / 100) * oi * 100 * spot : null,
        charmExp: bs ? sign * (bs.charm / 365) * oi * 100 * spot : null,
      }
    : { spot, oi, volume: vol, gex: null, gexVol: null, dex: null, vex: null, thetaExp: null, vannaExp: null, charmExp: null };

  // No Theta to cross-check against in TT mode — report TT OI, theta side null.
  const oiCompare = { ok: true, match: false, theta: null, tt: oi, _src: 'TT only (Theta paused)' };

  const result = {
    eventType: 'THETA', // shape tag kept for client compatibility; meta.source='tt' marks origin
    eventSymbol: streamerSymbol,
    occSymbol,
    feeds,
    exposures,
    oiCompare,
  };
  return { ...meta, found: true, status: 'ready', source: 'tt', result };
}

async function probeRest({ ticker, expiry, type, strike }) {
  // DATA_SOURCE=tt: Theta paused -> resolve + price the probe entirely from
  // TastyTrade REST. The Theta path below is unchanged and used when useTheta().
  if (!useTheta()) return probeRestTT({ ticker, expiry, type, strike });
  const reqStrike = Number(strike);
  const root = chainTicker(ticker); // SPX, NDX, etc.

  // Fetch Theta chain (for strike resolution) + TT chain (for OCC symbol → TT OI compare).
  // Both are cached — this is typically sub-millisecond on a warm cache.
  const [thetaChain, ttChain] = await Promise.all([
    thetaAdapter.fetchChainTheta(root).catch(() => null),
    getChainCached(ticker).catch(() => ({ expirations: [], contracts: [] })),
  ]);

  // Resolve nearest strike from Theta chain.
  const thetaContracts = (thetaChain?.contracts || []).filter(
    (c) => c.expiration === expiry && c.type === type,
  );
  let best = null, bestDist = Infinity;
  for (const c of thetaContracts) {
    const d = Math.abs(Number(c.strike) - reqStrike);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  if (!best) {
    const expiryExists = (thetaChain?.expirations || []).includes(expiry);
    return {
      found: false,
      status: expiryExists ? 'no-strike' : 'no-expiry',
      source: 'theta',
      chainTicker: root,
      requestedStrike: Number.isFinite(reqStrike) ? reqStrike : null,
      resolvedStrike: null,
      availableExpirations: (thetaChain?.expirations || []).slice(0, 12),
    };
  }

  // Find matching TT contract for its OCC symbol (needed to query TT by-type).
  // On a monthly-expiration Friday, TT's nested chain can carry BOTH the
  // AM-settled monthly (root-symbol "SPX") and the PM-settled weekly
  // (root-symbol "SPXW") under the same expiration date/strike/type — filter
  // to the root the user actually typed first, and only fall back to an
  // unfiltered match for symbols where TT never tagged a root-symbol at all
  // (equities, or older cache entries).
  const wantRoot = String(ticker || '').toUpperCase().replace(/^\./, '');
  const ttCandidates = (ttChain?.contracts || []).filter(
    (c) => c.expiration === expiry && c.type === type &&
           Math.abs(Number(c.strike) - best.strike) < 0.01,
  );
  const ttContract =
    ttCandidates.find((c) => c.rootSymbol === wantRoot) ||
    (ttCandidates.some((c) => c.rootSymbol) ? null : ttCandidates[0]) ||
    null;
  const occSymbol = ttContract?.occSymbol || null;
  const streamerSymbol = ttContract?.streamerSymbol || `${root}_${expiry}_${type}${best.strike}`;

  const meta = {
    resolvedSymbol: streamerSymbol,
    occSymbol,
    snapped: Number.isFinite(reqStrike) && best.strike !== reqStrike,
    requestedStrike: Number.isFinite(reqStrike) ? reqStrike : null,
    resolvedStrike: best.strike,
    source: 'theta',
  };

  const probeKey = _probeKeyOf(expiry, best.strike, type);

  // Fetch all Theta snapshots + TT market-data (kept ONLY for the OI cross-
  // check panel — quote/greeks/mark are Theta-only, see fetchQuoteTheta).
  const [oiMap, greekMap, volMap, quoteMap, ttIt, spot] = await Promise.all([
    thetaAdapter.fetchOpenInterestTheta(root, expiry).catch(() => new Map()),
    thetaAdapter.fetchGreeksTheta(root, expiry).catch(() => new Map()),
    thetaAdapter.fetchVolumeTheta(root, expiry).catch(() => new Map()),
    thetaAdapter.fetchQuoteTheta(root, expiry).catch(() => new Map()),
    occSymbol
      ? ttGet(`/market-data/by-type?equity-option[]=${encodeURIComponent(occSymbol)}`)
          .then((j) => j?.data?.items?.[0] || null)
          .catch(() => null)
      : Promise.resolve(null),
    (async () => {
      // Pre/post-market, Theta's raw cash-index snapshot is frozen at the last
      // RTH print (SPX cash doesn't trade off-hours) while option NBBO keeps
      // moving with the futures-implied level — that mismatch was making ITM
      // legs look "priced below intrinsic" and killing the IV solve. Prefer
      // the live class's spotDisplay (RTH broker spot, or ES future + cash
      // basis off-hours — see _publishSpotDisplay), same value the rest of
      // the dashboard shows, and only fall back to the raw Theta snapshot if
      // spotDisplay hasn't been published yet (e.g. right after a restart).
      const live = Number(marketState.getState().spotDisplay) || 0;
      if (INDEX_ROOTS.has(root) && live > 0) return live;
      try {
        if (INDEX_ROOTS.has(root)) return await thetaAdapter.fetchIndexPriceTheta(root);
        const q = await thetaAdapter.fetchStockQuoteTheta(root);
        return q?.last || q?.mark || live || null;
      } catch { return live || null; }
    })(),
  ]);

  const thetaOI = oiMap.get(probeKey)?.oi ?? null;
  const thetaVol = volMap.get(probeKey) ?? null;
  const g = greekMap.get(probeKey) || {};
  const tq = quoteMap.get(probeKey) || {};

  const n = firstFiniteNumber;

  // Quote: Theta's own NBBO (docs.thetadata.us/operations/option_snapshot_quote.html)
  // — no more TT fallback here; TT is only used below for the OI cross-check.
  const bid = n(tq.bid);
  const ask = n(tq.ask);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
  const mark = mid;

  // Black-Scholes fallback greeks — calculated for THIS contract's side
  // (call/put), so a Theta gap never blanks delta/theta/etc: sign always
  // matches the side being watched. Uses Theta IV when present, otherwise
  // backs out IV from the live quote.
  const T = yearsToExpiry(best.expiration);
  // Theta sometimes returns a degenerate row for thin/0DTE ITM legs
  // (delta:1, gamma/theta/vega:0, iv missing) — don't treat that as real data.
  const thetaGreeksValid = g.iv > 0 && !(g.gamma === 0 && g.theta === 0 && g.vega === 0);
  // Theta-only mark for the IV solve — TT is quote-source for the Quote panel
  // only (Theta has no NBBO), never for computing greeks. g.mark comes from
  // Theta's own greeks/all snapshot (its bid/ask mid, else its last/close) —
  // use it if it clears intrinsic; otherwise there's no valid Theta price to
  // solve from, so leave it null rather than borrowing a TT price.
  const intrinsic = type === 'C' ? Math.max(spot - best.strike, 0) : Math.max(best.strike - spot, 0);
  // Two Theta-only candidates: the greeks snapshot's own embedded mark, and
  // the dedicated NBBO quote's mid — take whichever clears intrinsic first.
  const markForBs = [g.mark, mid].find((v) => v > intrinsic) ?? null;
  const ivForBs = thetaGreeksValid ? g.iv : (markForBs ? impliedVol({ price: markForBs, S: spot, K: best.strike, T, r: RISK_FREE, type }) : NaN);
  const bsRaw = (spot > 0 && T > 0 && ivForBs > 0)
    ? bsGreeks({ S: spot, K: best.strike, T, sigma: ivForBs, r: RISK_FREE, type })
    : null;
  // Normalize to conventional reporting units, same as the GEX greeks pass:
  //   theta: per-year -> per-day (÷365); vega: per 1.00 vol -> per 1% vol (÷100).
  // bsGreeks() returns raw annualized/unit-vol values, so leaving these unscaled
  // makes theta/vega read ~100x-365x too large (e.g. theta -78 instead of -0.21).
  const bs = bsRaw ? { ...bsRaw, theta: bsRaw.theta / 365, vega: bsRaw.vega / 100 } : null;

  const feeds = {
    Quote: {
      bid,            // Theta NBBO
      ask,            // Theta NBBO
      mid,            // Theta NBBO
      mark,           // Theta NBBO
      bidSize: n(tq.bidSize),
      askSize: n(tq.askSize),
      _src: 'Theta NBBO',
    },
    Trade: {
      // No Theta adapter for last-trade price yet (only OHLC volume) — this
      // one field still reads TT REST until fetchVolumeTheta is extended to
      // carry close/last from the OHLC snapshot.
      last: n(ttIt?.last),
      volume: thetaVol,           // Theta OHLC snapshot
      _volumeSrc: 'Theta',
      _src: 'TT last / Theta vol',
    },
    Summary: {
      openInterest: thetaOI,      // Theta OPRA OI — authoritative
      prevClose: n(ttIt?.['prev-close']),
      prevCloseDate: ttIt?.['prev-close-date'] ?? null,
      _src: 'Theta OI / TT prevClose',
    },
    Greeks: {
      // Theta live greeks when available; otherwise fall back to Black-Scholes
      // computed for THIS contract's side (call/put), so delta/theta always
      // carry the correct sign for the side being watched rather than nulling out.
      iv: thetaGreeksValid ? g.iv : (ivForBs > 0 ? ivForBs : null),
      delta: thetaGreeksValid ? g.delta : (bs?.delta ?? null),
      gamma: thetaGreeksValid ? g.gamma : (bs?.gamma ?? null),
      theta: thetaGreeksValid ? g.theta : (bs?.theta ?? null),
      vega: thetaGreeksValid ? g.vega : (bs?.vega ?? null),
      _src: thetaGreeksValid ? 'Theta' : 'Black-Scholes (calculated, this side)',
      // Pure Black-Scholes values (never Theta-live), for consumers that want
      // the BS-calculated greeks specifically regardless of Theta coverage
      // (e.g. the Watch tracker) — same ivForBs basis used for `bs` above.
      bsIv: ivForBs > 0 ? ivForBs : null,
      bsDelta: bs?.delta ?? null,
      bsGamma: bs?.gamma ?? null,
      bsTheta: bs?.theta ?? null,
      bsVega: bs?.vega ?? null,
    },
  };

  // Exposures use Theta OI + Theta greeks + Theta spot.
  const isCall = type === 'C';
  const sign = isCall ? 1 : -1;
  const oi = thetaOI;
  const vol = thetaVol;
  // Use the same validated greeks as the Greeks panel (thetaGreeksValid), not
  // raw g.* — otherwise a degenerate Theta row zeroes GEX/DEX/VEX even though
  // the panel above is showing the BS fallback values.
  const eGamma = thetaGreeksValid ? g.gamma : (bs?.gamma ?? 0);
  const eDelta = thetaGreeksValid ? g.delta : (bs?.delta ?? 0);
  const eVega = thetaGreeksValid ? g.vega : (bs?.vega ?? 0);
  const eTheta = thetaGreeksValid ? g.theta : (bs?.theta ?? 0);
  const exposures = (spot > 0 && oi != null)
    ? {
        spot,
        oi,
        volume: vol,
        gex: sign * Math.abs(eGamma || 0) * oi * spot * spot,
        gexVol: sign * Math.abs(eGamma || 0) * (vol || 0) * spot * spot,
        dex: sign * Math.abs(eDelta || 0) * oi * 100 * spot,
        vex: sign * (eVega || 0) * oi * 100 * spot,
        thetaExp: sign * (eTheta || 0) * oi * 100 * spot,
        vannaExp: bs ? sign * (bs.vanna / 100) * oi * 100 * spot : null,
        charmExp: bs ? sign * (bs.charm / 365) * oi * 100 * spot : null,
      }
    : { spot, oi, volume: vol, gex: null, gexVol: null, dex: null, vex: null, thetaExp: null, vannaExp: null, charmExp: null };

  // OI cross-check: Theta OPRA (authoritative) vs TT REST.
  const ttOI = n(ttIt?.['open-interest']) || null;
  let oiCompare = null;
  if (thetaOI != null && ttOI != null) {
    const diff = thetaOI - ttOI;
    const pctDiff = ttOI !== 0 ? (diff / ttOI) * 100 : null;
    oiCompare = { ok: true, match: true, theta: thetaOI, tt: ttOI, diff, pctDiff };
  } else {
    oiCompare = { ok: true, match: false, theta: thetaOI, tt: ttOI };
  }

  const result = {
    eventType: 'THETA',
    eventSymbol: streamerSymbol,
    occSymbol,
    feeds,
    exposures,
    oiCompare,
  };
  return { ...meta, found: true, status: 'ready', source: 'theta', result };
}

// ---------------------------------------------------------------------------
// Batched per-contract stats for the /flow tape's Vol / OI / IV columns.
//
// probeRest() is the single-contract path: it pulls the whole OI + greeks + vol
// snapshot for an expiry just to read ONE strike out of it. The tape needs the
// same three numbers for hundreds of rows at once, so calling probeRest per row
// would re-pull the same expiry snapshot hundreds of times.
//
// Instead we group by (root, expiry) — the natural unit of a Theta snapshot —
// pull each group's three maps ONCE, and return every strike|type in it. The
// caller then joins client-side. One tape render = one call per distinct expiry,
// not one per print.
//
// Snapshots are cached for CONTRACT_STATS_TTL_MS so a 15s client poll across
// several expiries doesn't hammer Theta; in-flight promises are shared so a
// burst of concurrent requests collapses into one upstream fetch per group.
// ---------------------------------------------------------------------------

const CONTRACT_STATS_TTL_MS = 20_000;
const CONTRACT_STATS_MAX_GROUPS = 16; // guard: one request can't fan out forever

const _statsCache = new Map();    // `${root}|${expiry}` -> { at, byKey }
const _statsInFlight = new Map(); // `${root}|${expiry}` -> Promise<byKey>

async function _statsForGroup(root, expiry) {
  const key = `${root}|${expiry}`;
  const hit = _statsCache.get(key);
  if (hit && Date.now() - hit.at < CONTRACT_STATS_TTL_MS) return hit.byKey;

  const inFlight = _statsInFlight.get(key);
  if (inFlight) return inFlight;

  const p = (async () => {
    const [oiMap, greekMap, volMap] = await Promise.all([
      thetaAdapter.fetchOpenInterestTheta(root, expiry).catch(() => new Map()),
      thetaAdapter.fetchGreeksTheta(root, expiry).catch(() => new Map()),
      thetaAdapter.fetchVolumeTheta(root, expiry).catch(() => new Map()),
    ]);

    // Union the three maps' keys: a contract can have volume but no greeks yet
    // (pre-open), or OI but no trades today. Missing legs stay null rather than
    // 0 so the UI can render "—" instead of a misleading zero.
    const byKey = {};
    const keys = new Set([...oiMap.keys(), ...greekMap.keys(), ...volMap.keys()]);
    for (const k of keys) {
      // Theta keys are `exp|strike|type` — same shape _probeKeyOf builds.
      const [, strike, type] = String(k).split('|');
      const g = greekMap.get(k) || {};
      const oi = oiMap.get(k)?.oi;
      const vol = volMap.get(k);
      byKey[`${strike}|${type}`] = {
        vol: Number.isFinite(vol) ? vol : null,
        oi: Number.isFinite(oi) ? oi : null,
        // Theta reports IV as a decimal (0.184). Keep it decimal here; the UI
        // owns the ×100 so the API stays unit-consistent with greeks.
        iv: Number.isFinite(g.iv) && g.iv > 0 ? g.iv : null,
        mark: Number.isFinite(g.mark) && g.mark > 0 ? g.mark : null,
      };
    }
    _statsCache.set(key, { at: Date.now(), byKey });
    return byKey;
  })().finally(() => _statsInFlight.delete(key));

  _statsInFlight.set(key, p);
  return p;
}

/**
 * Batched contract stats.
 * @param {Array<{ticker:string, expiry:string}>} groups
 * @returns {Promise<Object>} { "ROOT|EXPIRY": { "strike|type": {vol,oi,iv,mark} } }
 */
async function contractStats(groups) {
  // Normalize + dedupe: the tape sends one group per visible row, and most rows
  // share an expiry. chainTicker() folds SPXW -> SPX so streamer roots and chip
  // tickers collapse onto the same snapshot.
  const seen = new Map();
  for (const g of groups || []) {
    const root = chainTicker(String(g?.ticker || '').toUpperCase());
    const expiry = String(g?.expiry || '');
    if (!root || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) continue;
    seen.set(`${root}|${expiry}`, { root, expiry });
  }
  const wanted = [...seen.values()].slice(0, CONTRACT_STATS_MAX_GROUPS);

  const out = {};
  await Promise.all(
    wanted.map(async ({ root, expiry }) => {
      // allSettled semantics per group: one bad expiry must not blank the tape.
      try {
        out[`${root}|${expiry}`] = await _statsForGroup(root, expiry);
      } catch {
        out[`${root}|${expiry}`] = {};
      }
    }),
  );
  return { stats: out, groups: wanted.length, truncated: seen.size > wanted.length };
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

  // Equities: Theta when DATA_SOURCE=theta (per-symbol snapshot, TT fallback on
  // miss); else the TT by-type batch. Indices + futures unchanged below.
  const eqBack = new Map(equities.map((e) => [e, e]));
  if (useTheta()) {
    // Collect misses and fall back in ONE batched TT call. Doing it per symbol
    // meant a wide watchlist (the ~100-name movers universe) could fan out to
    // 100 individual TT requests whenever Theta was gated.
    const misses = [];
    await Promise.all([...eqBack.keys()].map(async (e) => {
      try {
        const q = await thetaAdapterQuotes.fetchStockQuoteTheta(e);
        if (q) { out.set(e, q); return; }
      } catch (err) {
        console.warn('[WATCH-QUOTES][theta]', e, String(err.message).slice(0, 120));
      }
      misses.push(e);
    }));
    if (misses.length) {
      console.warn(`[WATCH-QUOTES][theta] ${misses.length}/${eqBack.size} miss → TT fallback`);
      await batchParam('equity', misses, (v) => v);
    }
  } else {
    await batchParam('equity', [...eqBack.keys()], (v) => v);
  }
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

  // Futures: read directly from market-state (dxLink Quote/Trade/Summary stream).
  // ES and NQ are subscribed at startup; no TT REST call needed — avoids the
  // pending/hang that occurred when the TT session was idle or expired.
  if (futures.length) {
    const ms = marketState.getState();
    for (const fut of futures) {
      const orig = list.find((s) => s.toUpperCase() === fut) || fut;
      const product = futRoot(fut);
      const override = FUT_PREVCLOSE_OVERRIDE[product];
      if (product === 'ES') {
        const last = ms.esFut || 0;
        const pc = override != null ? override : (ms.esFutPrevClose || 0);
        if (last > 0) out.set(orig, { last, mark: last, close: pc, prevClose: pc });
      } else if (product === 'NQ') {
        const last = ms.nqFut || 0;
        const pc = override != null ? override : (ms.nqFutPrevClose || 0);
        if (last > 0) out.set(orig, { last, mark: last, close: pc, prevClose: pc });
      } else {
        console.warn(`[WATCH-QUOTES] unsupported future product: ${product} (${orig})`);
      }
    }
  }

  return out;
}

/**
 * Tastytrade-only batch OHLC for equities/ETFs — last, mark, close, prev-close
 * AND today's regular-session OPEN, all from TT /market-data/by-type. NO
 * ThetaData. Backs the Semi Strength index's "vs RTH open" basis. Keyed by the
 * uppercased symbol.
 *
 *   it.last / it.mark        → live price (updates pre/post market)
 *   it.close                 → today's regular (4pm) close
 *   it['prev-close']         → prior trading day's close
 *   it.open / open-price     → today's 09:30 ET open (field name varies by gateway)
 *
 * @param {string[]} symbols e.g. ["NVDA","SMH","SPY"]
 * @returns {Promise<Map<string,{last:number,mark:number,close:number,prevClose:number,open:number,high:number,low:number}>>}
 */
async function fetchUnderlyingDayOhlc(symbols) {
  const n = firstFiniteNumber;
  const out = new Map();
  const list = [...new Set((symbols || []).map((s) => String(s || '').trim().toUpperCase()).filter(Boolean))];
  if (!list.length) return out;
  const CHUNK = 90; // stay under TT's by-type URL/param cap
  for (let i = 0; i < list.length; i += CHUNK) {
    const batch = list.slice(i, i + CHUNK);
    const qs = batch.map((v) => `equity[]=${encodeURIComponent(v)}`).join('&');
    try {
      const json = await ttGet(`/market-data/by-type?${qs}`);
      const items = json?.data?.items || [];
      for (const it of items) {
        const sym = String(it.symbol || '').toUpperCase();
        if (!sym) continue;
        out.set(sym, {
          last: n(it.last),
          mark: n(it.mark),
          close: n(it.close),
          prevClose: n(it['prev-close']),
          // TT/dxFeed field name for the session open varies by gateway version —
          // accept the common aliases; 0 when the gateway omits it (caller gates on it).
          open: n(it.open) || n(it['open-price']) || n(it['day-open-price']) || n(it['open-price-regular']),
          high: n(it.high) || n(it['day-high-price']),
          low: n(it.low) || n(it['day-low-price']),
        });
      }
    } catch (err) {
      console.warn('[SEMI-OHLC] batch failed:', String(err.message).slice(0, 160));
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
    this.flowGexAccumulator = new FlowGexAccumulator(); // tracks dealer inventory for flow GEX
    this.contracts = new Map(); // streamerSymbol -> contract meta
    this.quotes = new Map(); // streamerSymbol -> { bid, ask, mid }
    this.summaries = new Map(); // streamerSymbol -> { oi, prevClose }
    this.greeks = new Map(); // streamerSymbol -> { iv, delta, gamma, theta, vega } (raw broker greeks)
    this.volumes = new Map(); // streamerSymbol -> dayVolume (from Trade events)
    this.restOI = new Map(); // streamerSymbol -> { oi, volume } from REST backfill
    this.restOISessionKey = null; // session key when restOI was last fetched (for staleness check)
    this.optSessionKey = null; // SPX session key (~6PM ET rollover) the OI/volume maps belong to
    this.sessionRollTimer = null; // self-rescheduling watcher that re-arms OI + clears volume at rollover
    this.oiCoverage = 0;      // 0..1 fraction of active strikes that have OI (last backfill)
    this.oiReady = false;     // true once OI coverage crosses threshold, plateaus, or grace elapses
    this.oiPlateauHits = 0;   // consecutive backfills with negligible OI-coverage gain
    this.greeksCoverage = 0;  // 0..1 fraction of in-window legs with a real streamed gamma
    this.chartReady = false;  // true once OI + greeks are warm (or grace elapses) — gates broadcast
    this.warmedExpiries = new Set(); // expiries already warmed once — switching back to them is instant (no re-gate)
    this.prevGreeksCoverage = 0; // greeks coverage at the previous recompute (plateau detection)
    this.greeksPlateauHits = 0;  // consecutive recomputes with negligible coverage gain
    this.firstSubAt = 0;      // ms timestamp of first subscribe (grace-period anchor)
    this.sessionCallPremium = 0;   // cumulative call premium for today's RTH session
    this.sessionPutPremium  = 0;   // cumulative put  premium for today's RTH session
    this.premiumLastPost = 0;      // epoch ms of last /api/snapshots/premium POST
    this.oiTimer = null;
    this.volTimer = null;
    this.flowTimer = null;
    this.premiumTimer = null;
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
    this.nqSymbol = null;   // resolved dxLink streamer symbol for front NQ future
    this.esCandleSymbol = null; // candle stream symbol, e.g. "/ESU26:XCME{=5m}"
    this.esCandles = new Map(); // slotKey -> { timestamp, date, slotKey, time, open, high, low, close, volume }
    this.esCandlesDirty = false; // set when a candle slot changed since last flush
    this.esCandlesDirtySlots = new Set(); // slotKeys changed since last flush (delta broadcast)
    this.candleFlushTimer = null;
    // NQ 5m candles — parallel to ES, own map/table/state so the ICT NQU tab has
    // an identical feed. dxLink delivers these on this.nqCandleSymbol ("…{=5m}").
    this.nqCandleSymbol = null; // e.g. "/NQU26:XCME{=5m}"
    this.nqCandles = new Map();
    this.nqCandlesDirty = false;
    this.nqCandlesDirtySlots = new Set();
    this.nqCandleFlushTimer = null;
    // ── ES 1-minute candles ────────────────────────────────────────────────────
    // A SECOND, independent dxLink candle subscription. dxLink aggregates
    // server-side by the {=Nm} suffix, so 1m detail does not exist anywhere in
    // the {=5m} stream — it cannot be derived client-side and needs its own
    // subscription, own map, own state key.
    //
    // Deliberately TODAY-ONLY and capped small: 1m is 5x the bar rate of 5m, and
    // the es-candles page renders every bar it's handed. dxFeed also only serves
    // ~7 days of 1m history regardless of what fromTime asks for (measured
    // 2026-07-16: a 30-day request returned 6 trading days), so a wide window
    // buys nothing anyway.
    this.es1mCandleSymbol = null; // e.g. "/ESU26:XCME{=1m}"
    this.es1mCandles = new Map();
    this.es1mCandlesDirty = false;
    this.es1mCandlesDirtySlots = new Set();
    this.es1mCandleFlushTimer = null;
    // Live front-ES/NQ quotes, used by _publishEsFut/_publishNqFut to clamp the
    // last trade into the current spread. Set by Quote handler; *LastTrade by Trade.
    this.esQuote = null;          // { bid, ask, mid } for the front ES future
    this.nqQuote = null;          // { bid, ask, mid } for the front NQ future
    this.nqLastTrade = 0;
    // Last time the ES Quote/Trade stream produced a usable price. 0 = never.
    // Gates the candle-driven esFut fallback (_publishEsFutFromCandle).
    this._esTickAt = 0;
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
      // Second aggregation off the SAME contract. Gated by ES_1M_CANDLES so the
      // extra stream can be killed without a redeploy if bandwidth/CPU bites.
      this.es1mCandleSymbol = ES_1M_ENABLED ? `${this.esSymbol}{=1m}` : null;
      console.log(`[FEED] ES front streamer=${this.esSymbol} ttSymbol=${this.esTtSymbol} candle=${this.esCandleSymbol}${this.es1mCandleSymbol ? ` +1m=${this.es1mCandleSymbol}` : ' (1m disabled)'}`);
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
    try {
      const nqRes = await resolveFrontNqSymbol();
      this.nqSymbol = nqRes.streamerSymbol;
      this.nqCandleSymbol = `${this.nqSymbol}{=5m}`;
      console.log(`[FEED] NQ front streamer=${this.nqSymbol} candle=${this.nqCandleSymbol}`);
    } catch (err) {
      console.warn('[FEED] NQ resolve failed:', err.message.slice(0, 120));
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

    // Options contract universe. DATA_SOURCE=theta builds the chain from Theta
    // (expirations + strikes), synthesizing a dxLink-style streamerSymbol so the
    // feed's streamerSymbol-keyed maps (this.contracts, _activeContracts, flow
    // tape) work unchanged. OI/greeks already match on exp|strike|type. In theta
    // mode the option contracts are NOT subscribed to dxLink (see _resubscribe);
    // dxLink carries only spot + ES/NQ candles. TT chain is the default path.
    let expirations; let contracts;
    if (useTheta()) {
      const tc = await thetaAdapterQuotes.fetchChainTheta(SYMBOL);
      expirations = tc.expirations;
      contracts = tc.contracts.map((c) => ({
        ...c,
        streamerSymbol: thetaAdapterQuotes.streamerSymbolFromContract({
          root: tc.root, expiration: thetaAdapterQuotes.toThetaStreamExp(c.expiration),
          strike: c.strike, right: c.type,
        }),
        occSymbol: null, // Theta has no OCC; OI/greeks match on exp|strike|type
      }));
      console.log(`[FEED][theta] chain built from Theta: ${contracts.length} contracts, ${expirations.length} expirations`);
    } else {
      ({ expirations, contracts } = await fetchChain());
    }
    marketState.setState({ symbol: SYMBOL });
    marketState.setExpirations(expirations);
    console.log(`[FEED] ${SYMBOL}: ${contracts.length} contracts, ${expirations.length} expirations`);
    console.log(`[FEED] expirations: ${expirations.slice(0, 8).join(', ')}${expirations.length > 8 ? ' …' : ''}`);

    // Default expiry = nearest (0DTE if present).
    const { ymd } = todayYmd();
    this.expiry = expirations.find((e) => e >= ymd) || expirations[0] || '';
    marketState.setExpiry(this.expiry);

    // Rebuild today's dealer inventory from flow_prints (already persisted by
    // the 500ms flow tape writer) so a mid-day process restart doesn't reset
    // Flow GEX to zero. Fire-and-forget; no-ops without DATABASE_URL.
    rehydrateAccumulator(this.flowGexAccumulator, this.expiry).catch(() => {});

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

    // Subscribe the parallel 5-minute NQ candle stream (drives the ICT NQU tab).
    if (this.nqCandleSymbol) {
      const fromTime = Date.now() - 15 * 86400_000;
      this.client.subscribeCandle(this.nqCandleSymbol, fromTime);
      console.log(`[FEED] subscribed NQ candles ${this.nqCandleSymbol} from ${new Date(fromTime).toISOString()}`);
      this.nqCandleFlushTimer = setInterval(() => this._flushNqCandles(), CANDLE_FLUSH_MS);
    }

    // ES 1-minute stream (ES_1M_CANDLES=1). fromTime is 2 DAYS, not the 15 the 5m
    // streams ask for: at 1m that is already ~780 RTH bars, the array is capped at
    // ES_1M_MAX_BARS anyway, and dxFeed only serves ~7 days of 1m regardless.
    // Asking for 15 days would buy nothing and cost a large connect-time burst.
    if (this.es1mCandleSymbol) {
      const fromTime = Date.now() - 2 * 86400_000;
      this.client.subscribeCandle(this.es1mCandleSymbol, fromTime);
      console.log(`[FEED] subscribed ES 1m candles ${this.es1mCandleSymbol} from ${new Date(fromTime).toISOString()}`);
      this.es1mCandleFlushTimer = setInterval(() => this._flushEs1mCandles(), CANDLE_1M_FLUSH_MS);
    }

    // Backfill OI + volume from REST now. OI is once-daily (OPRA ~06:30 ET) and
    // latches once coverage is ready — _scheduleOiRefresh stops polling at that
    // point. Volume builds intraday so a separate _scheduleVolRefresh keeps it
    // current every VOL_REFRESH_MS (default 2 min) during RTH without re-hitting OI.
    await this._refreshOI();
    this._scheduleOiRefresh();
    this._scheduleVolRefresh(); // volume-only refresh, independent of OI gate

    // Seed the SPX session key now, then watch for the ~6PM ET rollover so OI +
    // volume self-refresh across the session boundary without a restart.
    this.optSessionKey = this._sessionKey();
    this._scheduleSessionRoll();

    // Theta greeks: 5s bulk REST poll (_refreshGreeksTheta = one greeks/all
    // snapshot per poll). The per-contract GREEKS stream was removed — at ~700
    // contracts its per-change push firehose dominated JVM CPU. One bulk REST
    // call every 5s is far cheaper and fully covers the SPX-single-symbol GEX.
    // Seed once immediately so _recompute has data before the first poll.
    if (useTheta()) {
      await this._refreshGreeksTheta().catch(() => {}); // immediate seed

      // Self-rescheduling greeks REST poll (replaces the per-contract stream).
      // 5s RTH / 60s off-hours (THETA_GREEKS_MS[_OFFHOURS]).
      clearTimeout(this.greeksTimer);
      const scheduleGreeks = () => {
        const ms = isOptionsRthEt() ? THETA_GREEKS_MS : THETA_GREEKS_MS_OFFHOURS;
        this.greeksTimer = setTimeout(async () => {
          if (!this.idle && useTheta()) await this._refreshGreeksTheta().catch(() => {});
          scheduleGreeks();
        }, ms);
      };
      scheduleGreeks();

      // FPSS option Trade+Quote+Greeks stream. Trades → FlowProcessor (unchanged).
      // Greeks → this.greeks map directly, replacing the REST poll entirely.
      if (!this.thetaStream) {
        this.thetaStream = new thetaAdapter.ThetaStreamClient({
          getSpot: () => this.spot || marketState.getSpot(),
          onTrade: (print) => {
            // rawTape has read 0 in production despite a confirmed-live Theta
            // firehose — log the first several raw prints reaching this
            // handler (shape + any addPrint exception) so we can see exactly
            // where the chain breaks instead of guessing further blind.
            if (!this._flowPrintLogCount) this._flowPrintLogCount = 0;
            if (this._flowPrintLogCount < 10) {
              this._flowPrintLogCount++;
              console.log('[FLOW_DEBUG] onTrade fired:', JSON.stringify(print));
            }
            try {
              this.flow.addPrint(print);
              // Accumulate session-level call/put premium for the sparkline card.
              if (print.price > 0 && print.size > 0) {
                const parsed = parseOptionSymbol(print.streamerSymbol);
                if (parsed) {
                  const prem = print.price * print.size * 100;
                  if (parsed.type === 'C') this.sessionCallPremium += prem;
                  else this.sessionPutPremium += prem;
                } else {
                  // Log first few parse failures to catch symbol format issues
                  if (!this._premiumParseWarnCount) this._premiumParseWarnCount = 0;
                  if (this._premiumParseWarnCount++ < 3) {
                    console.warn('[premium-flow] parseOptionSymbol returned null for:', print.streamerSymbol);
                  }
                }
              }
            } catch (e) {
              if (!this._addPrintErrCount) this._addPrintErrCount = 0;
              if (this._addPrintErrCount++ < 5) {
                console.error('[FLOW_DEBUG] addPrint threw:', e?.message, JSON.stringify(print));
              }
            }
          },
          onIndex: (root, price) => this._onThetaIndex(root, price),
          onGreeks: (streamerSymbol, entry) => {
            // Write streamed greeks directly into the same map _recompute reads.
            // Merge with any existing entry so a partial tick (e.g. missing vega)
            // doesn't wipe fields that arrived on an earlier tick.
            const prev = this.greeks.get(streamerSymbol) || {};
            this.greeks.set(streamerSymbol, { ...prev, ...entry });
          },
        });
        this.thetaStream.connect();
        // Detects the "socket open but theta-terminal wedged, no real prints"
        // failure mode that a close/error-based reconnect can't see. See
        // state/flow-watchdog.js.
        require('./state/flow-watchdog').startFlowWatchdog(this.thetaStream);
      }
      this._subscribeThetaFlow();
      // Multi-ticker flow (FLOW_TICKERS): stream extra roots' near-spot option
      // trades into the SAME this.flow tape so the /flow page's non-SPX chips
      // populate. Flow-only — does NOT touch GEX/greeks (single-SYMBOL engine).
      // SPX-only lock: do NOT start MultiFlowManager unless FLOW_TICKERS_ENABLE=1.
      // (Even if it starts, FlowProcessor.addPrint now drops non-SPX prints.)
      if (process.env.FLOW_TICKERS_ENABLE === '1' && !this.multiFlow) {
        this.multiFlow = new MultiFlowManager({ thetaStream: this.thetaStream });
        this.multiFlow.start().catch((e) =>
          console.warn('[MULTIFLOW] start failed:', String(e?.message || e).slice(0, 160)));
      }
      // SPX/VIX spot from Theta's index price stream (separate INDEX_SOURCE flag).
      if (useThetaIndex()) {
        this.thetaStream.subscribeIndex('SPX');
        this.thetaStream.subscribeIndex('VIX');
        // Seed immediately from a REST snapshot so spot isn't 0 until the first tick.
        thetaAdapter.fetchIndexPriceTheta('SPX').then((p) => { if (p) this._onThetaIndex('SPX', p); }).catch(() => {});
        thetaAdapter.fetchIndexPriceTheta('VIX').then((p) => { if (p) this._onThetaIndex('VIX', p); }).catch(() => {});
      }
    }

    // Self-rescheduling recompute: 2s during RTH, 15s off-hours.
    // A fixed setInterval at 2s burned ~80% CPU overnight on a 1-vCPU host.
    const scheduleRecompute = () => {
      const ms = isOptionsRthEt() ? RECOMPUTE_MS : RECOMPUTE_MS_OFFHOURS;
      this.recomputeTimer = setTimeout(() => {
        if (!this.idle) this._recompute();
        scheduleRecompute();
      }, ms);
    };
    scheduleRecompute();
    // Aggregate + broadcast the flow tape every 500ms (independent of GEX).
    // Tape is multi-ticker (SPX engine + FLOW_TICKERS via MultiFlowManager);
    // SYMBOL here only labels the bucket, it does not filter the tape.
    this._flowDebugTick = 0;
    this.flowTimer = setInterval(() => {
      const bucket = this.flow.bucket(SYMBOL);
      marketState.setFlow(bucket);
      // Ingest the tape into the flow GEX accumulator (dealer inventory tracking).
      this.flowGexAccumulator.ingestTape(bucket.tape, this.expiry);
      // Persist the (coalesced, floor-filtered) tape so /flow can backfill today.
      // Fire-and-forget; no-ops without DATABASE_URL.
      writeFlowTape(bucket.tape);
      // Flow GEX has read as ~0 with no clear cause from static review alone —
      // throttled (~every 5s) visibility into the actual pipeline counts so it
      // can be diagnosed from `docker compose logs` instead of guessing again:
      // raw tape size, post-floor-filter size, and how many strikes currently
      // have non-zero dealer inventory for the active expiry.
      if (++this._flowDebugTick % 10 === 0) {
        const inv = this.flowGexAccumulator.getInventory(this.expiry);
        console.log(
          `[FLOW_DEBUG] expiry=${this.expiry} rawTape=${this.flow.tape.length} ` +
          `bucketTape=${bucket.tape.length} floor=$${this.flow.tapeFloorPremium} ` +
          `dealerStrikes=${inv.size}`
        );
      }
    }, FLOW_AGGREGATE_MS);

    // Post cumulative session call/put premium to /api/snapshots/premium every 30s
    // during RTH so the Analytics "SPX Premium Flow" sparkline card has data.
    this.premiumTimer = setInterval(async () => {
      const callAcc = this.sessionCallPremium;
      const putAcc  = this.sessionPutPremium;
      if (callAcc === 0 && putAcc === 0) {
        console.log('[premium-flow] skipping — no trades accumulated yet');
        return;
      }
      const now = Date.now();
      if (now - this.premiumLastPost < 29_000) return;
      this.premiumLastPost = now;
      const spot = this.spot || marketState.getSpot() || 0;
      const netPremium = callAcc - putAcc;
      const port = process.env.PORT || 3001;
      console.log(`[premium-flow] posting → call=$${(callAcc/1e6).toFixed(2)}M put=$${(putAcc/1e6).toFixed(2)}M net=$${(netPremium/1e6).toFixed(2)}M spot=${spot} port=${port}`);
      try {
        const r = await fetch(`http://localhost:${port}/api/snapshots/premium`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {}) },
          body: JSON.stringify({
            timestamp: now,
            callPremium: callAcc,
            putPremium:  putAcc,
            netPremium,
            spxPrice:    spot,
          }),
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          console.warn(`[premium-flow] POST failed ${r.status}: ${txt.slice(0, 200)}`);
        } else {
          console.log('[premium-flow] POST ok');
        }
      } catch (e) {
        console.warn('[premium-flow] POST error:', e.message);
      }
    }, 30_000);

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
          // Zero all active contracts so low-volume strikes don't fall back to stale REST volume
          for (const c of this._activeContracts()) {
            this.volumes.set(c.streamerSymbol, 0);
          }
          this.sessionCallPremium = 0;
          this.sessionPutPremium  = 0;
          thetaAdapter.resetCalendarCache(); // force re-check tomorrow's market open status
          this.warmedExpiries.clear(); // prior session's warm cache is now stale — force re-warm
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
    let filled = 0;

    // When expiry is next-day (not today's 0DTE), Theta WS won't push GREEKS —
    // refresh via REST on every OI poll so greeks stay current.
    if (useTheta() && this.expiry !== todayYmd().ymd) {
      this._refreshGreeksTheta().catch(() => {});
    }

    if (useTheta()) {
      // Theta path: one whole-expiry OPRA OI snapshot, matched to the active
      // contracts by strike+type (Theta has no streamerSymbol/OCC). OI keyed by
      // `exp|strike|type` from the adapter. Empty snapshot (pre-06:30 / weekend)
      // means "no update" — DON'T overwrite a known OI with empty (preserve the
      // existing dxFeed-era guard semantics).
      const exp = this.expiry; // YYYY-MM-DD
      const [oiMap, volMap] = await Promise.all([
        thetaAdapter.fetchOpenInterestTheta(SYMBOL, exp).catch(() => new Map()),
        thetaAdapter.fetchVolumeTheta(SYMBOL, exp).catch(() => new Map()),
      ]);
      if (oiMap.size === 0) {
        // legitimate empty — keep whatever restOI we already have, recount it
        for (const c of active) { if ((this.restOI.get(c.streamerSymbol)?.oi || 0) > 0) filled++; }
        console.log('[OI][theta] empty snapshot (pre-06:30/closed) — preserving prior OI');
      } else {
        for (const c of active) {
          const row = oiMap.get(`${exp}|${Number(c.strike)}|${c.type}`);
          if (row && Number.isFinite(row.oi)) {
            // Volume comes from the OHLC snapshot (volMap); fall back to any prior
            // value when this strike isn't in the (possibly empty) volume snapshot.
            const prev = this.restOI.get(c.streamerSymbol) || {};
            const vol = volMap.get(`${exp}|${Number(c.strike)}|${c.type}`);
            this.restOI.set(c.streamerSymbol, {
              oi: row.oi,
              volume: Number.isFinite(vol) ? vol : (prev.volume || 0),
              mark: prev.mark || 0,
            });
            if (row.oi > 0) filled++;
          } else if ((this.restOI.get(c.streamerSymbol)?.oi || 0) > 0) {
            filled++; // strike not in snapshot but we already had OI — keep it
          }
        }
      }
    } else {
      const occ = active.map((c) => c.occSymbol).filter(Boolean);
      const byOcc = await fetchOpenInterest(occ);
      for (const c of active) {
        const m = byOcc.get(normalizeOcc(c.occSymbol));
        if (m) {
          this.restOI.set(c.streamerSymbol, m);
          if (m.oi > 0) filled++;
        }
      }
    }
    const prevOiCoverage = this.oiCoverage;
    this.oiCoverage = active.length ? filled / active.length : 0;
    // Mark ready once coverage crosses the threshold (latched — never flips back).
    if (!this.oiReady && this.oiCoverage >= OI_READY_RATIO) {
      this.oiReady = true;
      this.oiPlateauHits = 0;
      console.log(`[OI] coverage ${(this.oiCoverage * 100).toFixed(0)}% ≥ ${(OI_READY_RATIO * 100).toFixed(0)}% — GEX broadcast enabled`);
      this._subscribeThetaFlow(); // subscribe now that active contracts are loaded
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
        this._subscribeThetaFlow(); // subscribe now that active contracts are loaded
      }
    }
    console.log(`[OI] REST backfill: ${filled}/${active.length} strikes with OI`);
    // Mark the session this REST data belongs to so we don't use stale volume
    // across session boundaries.
    this.restOISessionKey = this.optSessionKey;
    // Re-arm the Theta flow/trade subscription every poll, not just on the
    // one-time "became ready" edge above — the active window drifts with
    // spot, and a strike that enters the window later was never subscribed,
    // so it carries no live volume even after the OI-side fix. subscribeActive
    // re-sends the current leg list; safe/cheap to call repeatedly.
    this._subscribeThetaFlow();
  }

  /**
   * Theta greeks poll (DATA_SOURCE=theta only). One whole-expiry greeks/all
   * snapshot → fill this.greeks keyed by streamerSymbol, matched by strike+type.
   * _recompute already PREFERS this.greeks (gk.gamma) over BS, so populating it
   * makes Theta the primary greeks source with BS as the per-field fallback —
   * exactly the "Theta primary, BS fallback" decision. Vanna/charm stay BS in
   * _recompute for now (Theta has them too but wiring those is a later step).
   * NOTE: REST greeks round to 4dp — far-OTM wing gammas may read 0; BS fallback
   * covers those legs, so coverage/GEX don't break.
   */
  async _refreshGreeksTheta() {
    if (!useTheta()) return;
    const active = this._activeContracts();
    if (!active.length) return;
    const exp = this.expiry;
    const gMap = await thetaAdapter.fetchGreeksTheta(SYMBOL, exp).catch(() => new Map());
    if (gMap.size === 0) {
      // Theta has no live greeks snapshot outside the cash session — expected,
      // not an error. Stay quiet outside RTH; only log if empty DURING RTH.
      if (isOptionsRthEt()) console.log('[GREEKS][theta] empty snapshot');
      return;
    }
    let filled = 0;
    for (const c of active) {
      const g = gMap.get(`${exp}|${Number(c.strike)}|${c.type}`);
      if (!g) continue;
      // Only set fields that are finite & non-zero so a 4dp-zeroed gamma doesn't
      // clobber the BS fallback path in _recompute (which keys off gamma!==0).
      const entry = {
        iv: Number.isFinite(g.iv) && g.iv > 0 ? g.iv : undefined,
        delta: Number.isFinite(g.delta) ? g.delta : undefined,
        gamma: Number.isFinite(g.gamma) && g.gamma !== 0 ? g.gamma : undefined,
        theta: Number.isFinite(g.theta) ? g.theta : undefined,
        vega: Number.isFinite(g.vega) ? g.vega : undefined,
      };
      this.greeks.set(c.streamerSymbol, entry);
      if (entry.gamma !== undefined) filled++;
      // Contract mark rides along on the greeks/all snapshot NBBO. Quote streaming
      // is off (TRADE-only sub) so this is the only live mark source — write it
      // into restOI (preserving oi/volume) for the strike-detail popup price.
      if (Number.isFinite(g.mark) && g.mark > 0) {
        const prev = this.restOI.get(c.streamerSymbol) || {};
        this.restOI.set(c.streamerSymbol, { ...prev, mark: g.mark });
      }
    }
    console.log(`[GREEKS][theta] greeks/all: ${filled}/${active.length} strikes with non-zero gamma`);
  }

  /**
   * Subscribe the active SPXW window's contracts to the Theta Trade+Quote stream.
   * Idempotent per contract (the stream client de-dupes via its quote cache /
   * sub list). Called on start and whenever the active window shifts so the flow
   * tape tracks spot. No-op unless DATA_SOURCE=theta and the stream is up.
   */
  _subscribeThetaFlow() {
    if (!useTheta() || !this.thetaStream) return;
    const root = thetaAdapter.thetaRoot(SYMBOL);
    // Bulk mode: don't enumerate SPXW contracts — the firehose covers them. Just
    // register SPXW in the keep-list and arm the single bulk subscription once.
    // (subscribeBulkTrades is idempotent-safe: re-calling only re-sends the sub.)
    if (FLOW_BULK_STREAM) {
      this.thetaStream.addBulkRoot(root);
      if (!this._bulkArmed) { this.thetaStream.subscribeBulkTrades(); this._bulkArmed = true; }
      return;
    }
    const active = this._activeContracts();
    if (!active.length) return;
    // active contracts carry {strike,type,expiration}; only this expiry's legs
    const legs = active
      .filter((c) => c.expiration === this.expiry)
      .map((c) => ({ strike: c.strike, type: c.type, expiration: c.expiration }));
    this.thetaStream.subscribeActive(legs, root);
  }

  /**
   * Theta index price tick (INDEX_SOURCE=theta). Feeds the SAME fields the dxLink
   * Quote branch sets: SPX → this.spot (which _publishSpotDisplay + all GEX math
   * read; cash-basis seam preserved unchanged since it keys off this.spot), VIX →
   * aux. Indices tick only on change, so a quiet gap = unchanged; the last value
   * persists, which is the correct interpretation (no gap-fill needed).
   */
  _onThetaIndex(root, price) {
    if (!(price > 0)) return;
    if (root === 'SPX' || root === SYMBOL) {
      this.spot = price;
      // marketState.spot is the field /greeks (and any other direct spot
      // consumer) reads — push the corrected value, not the raw tick, so
      // those pages don't independently re-freeze off-hours the same way
      // the GEX chart did before _effectiveSpot() (see greeks-frozen-spot-
      // crosses.md: raw setSpot() calls were the actual upstream freeze).
      marketState.setSpot(this._effectiveSpot());
      this._publishSpotDisplay(); // refresh display SPX + RTH cash-basis capture
    } else if (root === 'VIX') {
      marketState.setAux({ vix: price });
    }
  }

  /**
   * Self-rescheduling OI refresh. Polls quickly (RECOMPUTE_MS) while the chart
   * is still gated on coverage, then settles to the normal OI_REFRESH_MS cadence
   * once ready. Keeps a single timer handle in this.oiTimer.
   */
  _scheduleOiRefresh() {
    if (this.oiTimer) { clearTimeout(this.oiTimer); this.oiTimer = null; }
    // Per-contract OI is static for the session, but WHICH contracts are in
    // scope is not: _activeContracts() windows around live spot, and spot
    // drifts all session. Stopping the poll entirely once "ready" (prior
    // behavior) meant strikes that drift INTO the window later never get
    // backfilled — they show OI 0 / empty on the chart even though Theta
    // has always had the number, because nothing ever asked for it again.
    // Keep polling at the slower OI_REFRESH_MS cadence after ready instead
    // of stopping — still far cheaper than the RECOMPUTE_MS warm-up pace,
    // and actually matches what this function's own comment always claimed.
    const delay = this.oiReady ? OI_REFRESH_MS : RECOMPUTE_MS;
    this.oiTimer = setTimeout(async () => {
      if (this.idle) { this._scheduleOiRefresh(); return; }
      try { await this._refreshOI(); } catch {}
      this._scheduleOiRefresh();
    }, delay);
  }

  /**
   * Volume-only refresh (Theta mode). OI is once-daily and latched after the
   * initial backfill — no need to re-fetch it. Volume builds intraday, so we
   * refresh it on a separate, slower timer without touching OI at all.
   * Only runs in Theta mode; TT mode gets volume from the dxLink Trade stream.
   */
  async _refreshVolume() {
    if (!useTheta()) return;
    const active = this._activeContracts();
    if (!active.length) return;
    const exp = this.expiry;
    const volMap = await thetaAdapter.fetchVolumeTheta(SYMBOL, exp).catch(() => new Map());
    if (!volMap.size) return; // pre-open / empty — leave existing volume untouched
    let updated = 0;
    for (const c of active) {
      const vol = volMap.get(`${exp}|${Number(c.strike)}|${c.type}`);
      if (Number.isFinite(vol)) {
        const prev = this.restOI.get(c.streamerSymbol) || {};
        this.restOI.set(c.streamerSymbol, { ...prev, volume: vol });
        updated++;
      }
    }
    if (updated) console.log(`[VOL][theta] refreshed volume for ${updated}/${active.length} strikes`);
  }

  /** Self-rescheduling volume refresh. FIX 2026-07-06: no longer gated to any
   *  equity-style RTH window — SPX/SPXW run on Cboe Global Trading Hours
   *  (~Sun 8pm ET through Fri 4:15pm ET, nearly 24x5), not the 9:30-16:00/16:15
   *  single-name options session. fetchVolumeTheta's own empty-response
   *  handling already covers the brief daily maintenance gap. Pauses when idle. */
  _scheduleVolRefresh() {
    if (this.volTimer) { clearTimeout(this.volTimer); this.volTimer = null; }
    this.volTimer = setTimeout(async () => {
      if (!this.idle) {
        try { await this._refreshVolume(); } catch {}
      }
      this._scheduleVolRefresh();
    }, VOL_REFRESH_MS);
  }

  /** Pick contracts for the active expiry within the strike window of spot. */
  _activeContracts() {
    // Window must center on the SAME spot _recompute() prices off (see
    // _effectiveSpot()) — centering on raw this.spot instead left the window
    // (and the dxLink subscription list) anchored to the frozen last-RTH
    // print while the GEX math had already moved to the corrected spot,
    // pushing the real ATM strikes off to one edge of the visible range.
    const effSpot = this._effectiveSpot ? this._effectiveSpot() : this.spot;
    const center = effSpot > 0 ? effSpot : null;
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
    if (this.nqSymbol) syms.add(this.nqSymbol);
    // In theta mode the option streamerSymbols are SYNTHETIC (not real dxLink
    // symbols) and option data comes from Theta — never subscribe them to dxLink.
    // dxLink carries spot + ES/NQ candles only.
    if (!useTheta()) {
      for (const c of this._activeContracts()) syms.add(c.streamerSymbol);
    }
    this.client.subscribe([...syms]);
    marketState.setStatus({ contractsSubscribed: syms.size });
  }

  setExpiry(expiry) {
    if (!expiry || expiry === this.expiry) return;
    this.expiry = expiry;
    marketState.setExpiry(expiry);
    // If we've already warmed this expiry once, its OI/greeks are cached on the
    // server — re-gating would force the user to wait out the grace timer again
    // for data that's effectively static. Skip the gate and broadcast at once.
    const alreadyWarm = this.warmedExpiries.has(expiry);
    // Re-gate (only for a not-yet-warmed expiry): OI + greeks must warm up before
    // we broadcast its chart, to avoid a half-rendered / inflated frame.
    this.oiReady = alreadyWarm;
    this.oiPlateauHits = 0;
    this.chartReady = alreadyWarm;
    this.prevGreeksCoverage = 0;
    this.greeksPlateauHits = 0;
    marketState.setStatus({ chartReady: alreadyWarm });
    this.firstSubAt = Date.now();
    this._resubscribe();
    // Backfill the new expiry's OI immediately, and resume fast polling until the
    // new expiry's coverage is ready again.
    this._refreshOI().catch(() => {}).finally(() => this._scheduleOiRefresh());
    // Re-seed greeks for the new expiry (WS stream only pushes for same-day 0DTE).
    this._refreshGreeksTheta().catch(() => {});
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
    if (px > 0) {
      // Mark the Quote/Trade stream as alive. The 5m candle flush uses this to
      // decide whether it must publish esFut itself (see _flushEsCandles): the
      // plain future Quote/Trade subscription can go silent for long stretches,
      // and a stale esFut freezes marketState.basis on whatever contract was
      // front when it last ticked — across a quarterly roll that's the EXPIRED
      // contract, and every SPX→ES level lands one calendar spread (~50pt) off.
      this._esTickAt = Date.now();
      marketState.setAux({ esFut: Math.round(px * 4) / 4 });
    }
    // Display SPX rides on ES off-hours; recompute it whenever ES moves.
    this._publishSpotDisplay();
  }

  /**
   * Fallback esFut writer, driven by the 5m candle stream. Only fires when the
   * ES Quote/Trade stream hasn't ticked within ES_TICK_STALE_MS — the candle
   * bars are the same broker feed on the SAME front contract, so this keeps
   * esFut (and therefore marketState.basis) alive and roll-correct instead of
   * frozen. A live Quote/Trade always wins; this never fights it.
   */
  _publishEsFutFromCandle(lastClose) {
    if (!(lastClose > 0)) return;
    if (Date.now() - (this._esTickAt || 0) < ES_TICK_STALE_MS) return; // live stream is healthy
    marketState.setAux({ esFut: Math.round(lastClose * 4) / 4 });
    this._publishSpotDisplay();
  }

  _publishNqFut() {
    const q = this.nqQuote || {};
    const bid = Number(q.bid) || 0;
    const ask = Number(q.ask) || 0;
    const last = Number(this.nqLastTrade) || 0;
    let px = 0;
    if (last > 0 && bid > 0 && ask > 0 && ask >= bid) {
      px = Math.min(Math.max(last, bid), ask);
    } else if (bid > 0 && ask > 0 && ask >= bid) {
      px = (bid + ask) / 2;
    } else if (last > 0) {
      px = last;
    } else if (bid > 0) {
      px = bid;
    } else if (ask > 0) {
      px = ask;
    }
    if (px > 0) marketState.setAux({ nqFut: Math.round(px * 4) / 4 });
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

  /**
   * Effective spot for GEX MATH (walls/flip/CB/max-pain/moneyness), not just
   * display. Previously _recompute() priced everything off this.spot even
   * off-hours, where this.spot is the last RTH broker print — frozen, same
   * bug _publishSpotDisplay() already works around for the display number.
   * On a day where the real level has actually moved (e.g. overnight/
   * pre-market), that froze every wall/flip/CB at the wrong center. Reuse
   * the identical RTH-vs-ES-basis logic here so the chart's math and its
   * displayed spot always agree.
   */
  _effectiveSpot() {
    const esFut = Number(marketState.getState().esFut) || 0;
    if (isRthEt() && this.spot > 0) return this.spot;
    if (esFut > 0 && this.cashBasis != null) return esFut + this.cashBasis;
    return this.spot; // last resort: stale broker quote (no ES/basis yet)
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
      // esFut is normally owned by the live ES Quote/Trade handler (_onEvent) —
      // writing it unconditionally from the candle close created two competing
      // writers at different values → visible flicker. But when that stream goes
      // SILENT, esFut freezes, marketState._recomputeBasis' freshness gate holds
      // the last basis, and across a quarterly roll that held basis belongs to the
      // expired contract (~50pt error on every SPX→ES level). So: candles publish
      // esFut only as a fallback, gated on the Quote/Trade stream being stale.
      this._publishEsFutFromCandle(lastClose);

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

    // ── Momentum Bias TP/reversal signals (recorded for grading) ──────────
    // Compute the bias index over the rolling candle array and record any TP
    // trigger that fired on a CLOSED bar. The last bar is still forming and its
    // crossunder repaints, so it is never recorded (same lesson as EM weekly
    // scoring). Idempotent on signal_key, so re-scanning the last few closed
    // bars each flush is harmless and cheap. Display is computed client-side
    // from the same lib/momentumBias module — the WS payload is left untouched.
    if (rows.length > 40) {
      try {
        const bias = getMomentumBiasIndex(
          rows.map((r) => ({ high: +r.high, low: +r.low, close: +r.close }))
        );
        const events = [];
        const formingIdx = rows.length - 1; // skip the forming bar
        for (let i = Math.max(2, rows.length - 5); i < formingIdx; i++) {
          const b = bias[i];
          if (!b || (!b.bullishTp && !b.bearishTp)) continue;
          const r = rows[i];
          const dir = b.bullishTp ? 'bull' : 'bear';
          // ATR = avg (high-low) over the 14 bars before the signal (grade scale).
          let atrSum = 0, atrN = 0;
          for (let k = Math.max(0, i - 14); k < i; k++) { atrSum += (+rows[k].high - +rows[k].low); atrN++; }
          events.push({
            signalKey: `${dir}:${r.slotKey}`,
            date: r.date, symbol: '/ES', dir,
            triggerTs: Number(r.timestamp), slotKey: r.slotKey, time: r.time,
            price: +r.close, upBias: b.momentumUpBias, downBias: b.momentumDownBias,
            boundary: b.boundary, atr: atrN ? atrSum / atrN : 0,
          });
        }
        if (events.length) recordSignals(events).catch(() => {});
      } catch (e) {
        console.warn('[momentum-bias] compute failed:', e.message);
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

  /**
   * NQ candle flush — the ES flush's simple twin. No day-change/baseline logic
   * (NQ's esFut-equivalent is published from the live Quote/Trade in _onEvent);
   * this only mirrors the bar array into state (silent full + small delta) and
   * persists real-volume bars to nq_candles.
   */
  _flushNqCandles() {
    if (!this.nqCandlesDirty) return;
    this.nqCandlesDirty = false;
    const dirtySlots = this.nqCandlesDirtySlots;
    this.nqCandlesDirtySlots = new Set();

    const rows = [...this.nqCandles.values()]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-600);

    // Full array only feeds the connect-time snapshot (silent → no full broadcast).
    marketState.setStateSilent({ nqCandles: rows });

    const delta = rows.filter((r) => dirtySlots.has(r.slotKey));
    if (delta.length) marketState.setState({ nqCandlesDelta: delta });

    writeNqCandles(rows.filter((r) => Number(r.volume) > 0)).catch(() => {});
  }

  /**
   * ES 1-minute flush. Same shape as the NQ twin — no baseline/esFut logic (the
   * 5m flush owns that; two writers publishing esFut at different aggregations
   * would fight), just state + delta + persist.
   *
   * The rows carry intervalMinutes:1 from the Candle handler, and writeEsCandles
   * passes that through to upsertEsCandle's ON CONFLICT("slotKey",
   * "intervalMinutes") — which is the ONLY reason these can share a table with
   * the 5m bars instead of overwriting them.
   */
  _flushEs1mCandles() {
    if (!this.es1mCandlesDirty) return;
    this.es1mCandlesDirty = false;
    const dirtySlots = this.es1mCandlesDirtySlots;
    this.es1mCandlesDirtySlots = new Set();

    const rows = [...this.es1mCandles.values()]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-ES_1M_MAX_BARS);

    // Trim the backing map too. The 5m map is left to grow (600 bars ≈ 15
    // sessions, harmless), but at 1m an untrimmed map grows 5x as fast and this
    // process is long-lived — the slice above would hide it while the Map leaked.
    if (this.es1mCandles.size > ES_1M_MAX_BARS * 2) {
      this.es1mCandles = new Map(rows.map((r) => [r.slotKey, r]));
    }

    marketState.setStateSilent({ es1mCandles: rows });

    const delta = rows.filter((r) => dirtySlots.has(r.slotKey));
    if (delta.length) marketState.setState({ es1mCandlesDelta: delta });

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
        // When INDEX_SOURCE=theta, Theta's index stream owns spot — ignore the
        // dxLink SPX quote so the two sources don't fight over this.spot.
        if (mid > 0 && !useThetaIndex()) {
          this.spot = mid;
          marketState.setSpot(this._effectiveSpot()); // corrected, not raw — see note above
          this._publishSpotDisplay(); // refresh display SPX + RTH basis capture
        }
        return;
      }
      if (sym === this.vixSymbol) {
        if (mid > 0 && !useThetaIndex()) marketState.setAux({ vix: mid });
        return;
      }
      if (sym === this.esSymbol) {
        if (bid > 0 || ask > 0) this.esQuote = { bid, ask, mid };
        this._publishEsFut();
        return;
      }
      if (sym === this.nqSymbol) {
        if (bid > 0 || ask > 0) this.nqQuote = { bid, ask, mid };
        this._publishNqFut();
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
        this._esSummarySettle = pc;
        marketState.setAux({ esFutPrevClose: pc });
      }
      if (sym === this.nqSymbol && pc > 0) {
        console.log(`[FEED] NQ Summary prevDayClosePrice=${pc} sym=${sym}`);
        marketState.setAux({ nqFutPrevClose: pc });
      }
      return;
    }

    if (ev.eventType === 'Trade') {
      if (sym === this.spotSymbol) {
        const px = Number(ev.price);
        if (px > 0 && !useThetaIndex()) {
          this.spot = px;
          marketState.setSpot(this._effectiveSpot()); // corrected, not raw — see note above
          this._publishSpotDisplay(); // refresh display SPX + RTH basis capture
        }
        return;
      }
      if (sym === this.vixSymbol) {
        const px = Number(ev.price);
        if (px > 0 && !useThetaIndex()) marketState.setAux({ vix: px });
        return;
      }
      if (sym === this.esSymbol) {
        const px = Number(ev.price);
        if (px > 0) {
          this.esLastTrade = px;
          this._publishEsFut();
        }
        return;
      }
      if (sym === this.nqSymbol) {
        const px = Number(ev.price);
        if (px > 0) {
          this.nqLastTrade = px;
          this._publishNqFut();
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
      // In Theta mode the FPSS Trade stream owns option flow — don't double-feed
      // FlowProcessor from the dxLink option Trade events too. (Volume capture
      // above is still fine; it's keyed per-symbol and idempotent.)
      if (useTheta()) return;
      const quote = this.quotes.get(sym) || null;
      const sz = Number(ev.size);
      // Contract-level IV / OI / volume arrive on their own Greeks + Summary +
      // Trade(dayVolume) events and are cached per streamer symbol; stamp the
      // latest onto this flow order so the tape can show them.
      const gk = this.greeks.get(sym);
      const sm = this.summaries.get(sym);
      const dvol = this.volumes.get(sym);
      this.flow.addPrint({
        streamerSymbol: sym,
        price: Number(ev.price),
        size: Number.isFinite(sz) ? sz : 0, // snapshot Trade events can omit size → NaN; guard it
        quote,
        // this.spot lags at 0 until the underlying streamer quote arrives; fall
        // back to the authoritative market-state spot (set on every quote + GEX
        // recompute) so isOtm is classified correctly from the very first print.
        spot: this.spot || marketState.getSpot(),
        iv: gk?.iv,
        oi: sm?.oi,
        volume: dvol,
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
      // Route by which stream this bar came from. THREE now: ES {=5m}, NQ {=5m},
      // ES {=1m}. The 1m stream must be checked explicitly — it shares the ES
      // contract, so anything falling through to an `isNq ? nq : es` test would
      // dump 1m bars straight into the 5m map and interleave two aggregations
      // into one series.
      const isNq = this.nqCandleSymbol && sym === this.nqCandleSymbol;
      const isEs1m = this.es1mCandleSymbol && sym === this.es1mCandleSymbol;
      const intervalMinutes = isEs1m ? 1 : 5;
      const { slotKey, date, time, slotMs } = isEs1m ? etOneMinSlot(barTime) : etFiveMinSlot(barTime);
      const map = isEs1m ? this.es1mCandles : isNq ? this.nqCandles : this.esCandles;
      const prev = map.get(slotKey);
      const merged = prev
        ? {
            ...prev,
            high: Math.max(prev.high, high),
            low: Math.min(prev.low, low),
            close, // last close wins
            volume: Math.max(prev.volume, volume), // dxFeed candle volume is cumulative-per-bar
          }
        : { timestamp: slotMs, date, slotKey, time, symbol: isNq ? '/NQ' : '/ES', intervalMinutes, source: 'dxlink', open, high, low, close, volume };
      map.set(slotKey, merged);
      // Track WHICH slots changed so the flush can broadcast just those bars
      // instead of the whole 600-bar array every cycle.
      if (isEs1m) { this.es1mCandlesDirty = true; this.es1mCandlesDirtySlots.add(slotKey); }
      else if (isNq) { this.nqCandlesDirty = true; this.nqCandlesDirtySlots.add(slotKey); }
      else { this.esCandlesDirty = true; this.esCandlesDirtySlots.add(slotKey); }
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
    if (!(this.spot > 0)) return; // bootstrap gate: need at least one real broker print
    // All GEX math below prices off `spot`, NOT this.spot directly — see
    // _effectiveSpot(): during RTH they're the same value, off-hours this is
    // the ES-future + cash-basis reconstruction (this.spot alone freezes at
    // the last RTH print and silently mis-centers every wall/flip/CB).
    const spot = this._effectiveSpot();

    // Auto-roll expiry: advance when the active expiry has passed, OR when
    // today's 0DTE has expired (after 4:15pm ET the 0DTE has no live OI/greeks
    // so pre-roll to next session's expiry).
    const { ymd } = todayYmd();
    const nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const afterClose = nowEt.getHours() > 16 || (nowEt.getHours() === 16 && nowEt.getMinutes() >= 15);
    const shouldRoll = this.expiry < ymd || (this.expiry === ymd && afterClose);
    if (shouldRoll) {
      const expirations = [...new Set([...this.contracts.values()].map(c => c.expiration))].sort();
      const next = expirations.find(e => e > ymd) || expirations.find(e => e >= ymd);
      if (next && next !== this.expiry) {
        console.log(`[FEED] auto-rolling expiry ${this.expiry} → ${next}`);
        this.setExpiry(next);
        return; // recompute next tick with new expiry
      }
    }

    // Pass 1: gather each contract's price/OI/volume and solve IV where the
    // price supports it. Track ATM IV (nearest strike with a good solve) to use
    // as a fallback for deep-ITM / illiquid legs whose IV can't be solved from a
    // near-intrinsic mark — those legs carry big OI and matter for GEX.
    const staged = [];
    let atmIV = 0;
    let atmDist = Infinity;
    // strike -> { C: iv, P: iv } for legs whose OWN price solved. A stale/
    // crossed quote (mid below intrinsic — happens on thin ITM 0DTE legs)
    // makes impliedVol() return NaN; the same-strike opposite side almost
    // always still solves (OTM legs have intrinsic 0, any positive price
    // works), and since gamma is identical for calls/puts at the same
    // strike/expiry/vol, that sibling IV is a far better fallback than the
    // nearest-distinct-strike atmIV (which can carry a very different skew).
    const strikeIV = new Map();

    const _dbgActive = this._activeContracts();
    if (process.env.GEX_DEBUG) {
      let _oiHits = 0, _gkHits = 0;
      for (const c of _dbgActive) {
        if ((this.restOI.get(c.streamerSymbol)?.oi || 0) > 0) _oiHits++;
        if (this.greeks.get(c.streamerSymbol)) _gkHits++;
      }
      console.log(`[GEX_DEBUG] _recompute: spot=${spot} expiry=${this.expiry} active=${_dbgActive.length} oiHits=${_oiHits} gkHits=${_gkHits} contractsMap=${this.contracts.size}`);
    }

    for (const c of _dbgActive) {
      const q = this.quotes.get(c.streamerSymbol);
      const s = this.summaries.get(c.streamerSymbol);
      const rest = this.restOI.get(c.streamerSymbol);
      const gk = this.greeks.get(c.streamerSymbol); // raw broker greeks (if any)
      const oi = (rest?.oi ?? 0) || (s?.oi ?? 0);
      // Current-session day-volume. Two sources, both cumulative-for-the-session:
      //   • liveVol  — dayVolume from the Trade stream (dxLink legacy path)
      //   • restVol  — Theta OHLC snapshot day-volume (the authoritative source
      //                under DATA_SOURCE=theta; see fetchVolumeTheta)
      // Max of the live Trade-stream dayVolume and the current-session REST volume.
      // Both are cumulative-for-session; max() means a stale/rollover 0 can't shadow
      // a good REST volume. The old restOISessionKey===optSessionKey gate was forcing
      // restVol to 0 here (while the /dev builder, which has no gate, rendered volume
      // fine) — dropped it so the home chart matches /dev.
      const liveVol = this.volumes.get(c.streamerSymbol);
      const vol = Math.max(Number(liveVol) || 0, Number(rest?.volume) || 0);
      const mid = q?.mid > 0 ? q.mid : rest?.mark || 0;

      // Skip only if there's truly nothing to contribute.
      if (!(mid > 0) && !(oi > 0) && !(vol > 0) && !gk) continue;

      const T = yearsToExpiry(c.expiration);
      // Prefer the broker's IV (stable); only solve from price if none was sent.
      let iv = gk?.iv > 0 ? gk.iv : 0;
      if (!(iv > 0) && mid > 0) {
        iv = impliedVol({ price: mid, S: spot, K: c.strike, T, r: RISK_FREE, type: c.type });
      }
      if (iv > 0) {
        const dist = Math.abs(c.strike - spot);
        if (dist < atmDist) {
          atmDist = dist;
          atmIV = iv;
        }
        const rec = strikeIV.get(c.strike) || {};
        rec[c.type] = iv;
        strikeIV.set(c.strike, rec);
      }
      staged.push({ c, oi, vol, T, iv, gk, mark: mid });
    }

    if (process.env.GEX_DEBUG && !staged.length) {
      console.log(`[GEX_DEBUG] BAIL: staged.length=0 (active=${_dbgActive.length}) — every active contract skipped at the mid/oi/vol/gk filter`);
    }

    if (!staged.length) return;

    // strike -> { C: gamma, P: gamma } for legs with a REAL non-zero broker
    // gamma — used as a last-resort fallback below.
    const strikeGamma = new Map();
    for (const st of staged) {
      const g = st.gk?.gamma;
      if (Number.isFinite(g) && g !== 0) {
        const rec = strikeGamma.get(st.c.strike) || {};
        rec[st.c.type] = g;
        strikeGamma.set(st.c.strike, rec);
      }
    }

    // NOTE: an earlier version of this fix forced both legs at a strike to
    // share the OTM side's gamma, on the assumption that put-call gamma parity
    // must hold. A raw pull direct from ThetaData's REST API (bypassing all of
    // our fallback logic) disproved that: at SPXW 7/8 7500, Theta's OWN live
    // greeks show call iv=3.34% / gamma=0.0485 vs put iv=55.25% / gamma=0.0034
    // — both are genuine broker values (not placeholders), just backed out
    // from very different quotes (the call trades barely above intrinsic late
    // in a 0DTE session, which legitimately solves to a much lower IV/higher
    // gamma than the OTM put). Forcing parity there was actively wrong, so
    // that override was removed — trust each leg's own broker gamma again.

    // Pass 2: compute greeks. Deep-ITM/illiquid legs (iv unsolved) fall back to
    // ATM IV so their gamma is non-zero and their OI counts toward GEX.
    const rows = [];
    for (const st of staged) {
      const { c, oi, vol, T, gk, mark } = st;
      const siblingType = c.type === 'C' ? 'P' : 'C';
      const siblingIV = strikeIV.get(c.strike)?.[siblingType] || 0;
      const iv = st.iv > 0 ? st.iv : (siblingIV > 0 ? siblingIV : atmIV);

      // BS is used to source vanna/charm (dxFeed Greeks has neither) and as the
      // fallback for delta/gamma/vega when no broker greeks arrived for a strike.
      // Fed with the RAW broker IV when available, so it's stable.
      let bs = { gamma: 0, delta: 0, theta: 0, vega: 0, vanna: 0, charm: 0 };
      if (iv > 0) {
        bs = bsGreeks({ S: spot, K: c.strike, T, sigma: iv, r: RISK_FREE, type: c.type });
      }

      // Prefer raw broker greeks for delta/gamma/vega; only when a leg's OWN
      // broker gamma is genuinely missing/zero (the known Theta 0DTE
      // placeholder case), borrow the same-strike sibling's real gamma before
      // falling to BS.
      const siblingGamma = strikeGamma.get(c.strike)?.[siblingType] || 0;
      const gamma = gk && Number.isFinite(gk.gamma) && gk.gamma !== 0 ? gk.gamma
        : (siblingGamma > 0 ? siblingGamma : bs.gamma);
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
        volContracts: (r.oi || 0) + (r.volume || 0),
        volOnly: r.volume || 0,
        spot,
      });
    }

    // Get dealer inventory for flow GEX calculation
    const flowInventory = this.flowGexAccumulator.getInventory(this.expiry);
    const { rows: gexRows, callWall, putWall, gexFlip, totalNetGex, totalFlowGex } = computeGexSummary(rows, spot, flowInventory);

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
    // chart on connect). Set GEX_GATE_DISABLED=1 to paint the first frame
    // immediately (fast load; first frame or two may show cold BS-fallback gamma
    // until OI backfill + first greeks poll land, self-corrects on next recompute).
    if (GEX_GATE_DISABLED && !this.chartReady) {
      this.chartReady = true;
      this.warmedExpiries.add(this.expiry);
      marketState.setStatus({ chartReady: true });
    }

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
      // Remember this expiry as warmed so switching back to it is instant.
      this.warmedExpiries.add(this.expiry);
      marketState.setStatus({ chartReady: true });
    }

    marketState.setGexUpdate({
      gexRows,
      spot,
      expiry: this.expiry,
      totals,
      callWall,
      putWall,
      gexFlip,
      totalNetGex,
      totalFlowGex,
    });

    // Flow is aggregated + broadcast on its own 500ms loop (see flowTimer).

    // Persist per-strike net GEX history (rate-limited, fire-and-forget).
    // Feeds the dashboard's rolling-net-GEX view via
    // /api/snapshots/option-strike-gex-history. No-ops without DATABASE_URL.
    writeGexSnapshot(gexRows, spot, this.expiry).catch(() => {});
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
    if (this.volTimer) clearTimeout(this.volTimer);
    if (this.flowTimer) clearInterval(this.flowTimer);
    if (this.premiumTimer) clearInterval(this.premiumTimer);
    if (this.thetaGreeksTimer) clearInterval(this.thetaGreeksTimer);
    this.recomputeTimer = null;
    this.oiTimer = null;
    this.volTimer = null;
    this.flowTimer = null;
    this.premiumTimer = null;
    this.thetaGreeksTimer = null;
    if (this.thetaStream) { this.thetaStream.close(); this.thetaStream = null; }
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

module.exports = { TastytradeProxy, fetchChain, fetchChainFull, fetchExpirations, fetchOptionMarks, fetchUnderlyingQuotes, fetchUnderlyingDayOhlc, fetchDailyHistory, probeRest, contractStats, getAccessToken, getQuoteToken, DxLinkClient, resolveFrontEsSymbol, resolveFrontNqSymbol };
