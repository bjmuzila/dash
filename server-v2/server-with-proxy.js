'use strict';
/**
 * server-v2/server-with-proxy.js
 *
 * Main entry point for the from-scratch proxy. Brings up everything in-process
 * (no child proxy process):
 *
 *   - Loads .env.local then .env.
 *   - Prepares Next.js and an http.Server.
 *   - Mounts REST snapshot endpoints under /proxy/*.
 *   - Attaches the /ws/gex WebSocket broadcaster.
 *   - Starts the Tastytrade + dxLink feed (writes into market-state).
 *   - Routes client {type:'setExpiry'} WS commands to the live proxy.
 *
 * Run standalone:   node server-v2/server-with-proxy.js
 *
 * NOTE: This is the NEW stack and is intentionally NOT referenced by
 * package.json yet. Wiring is left to the operator.
 */

const { createServer } = require('http');
// WHATWG URL is used instead of the deprecated url.parse().
const path = require('path');
const zlib = require('zlib');
const dotenv = require('dotenv');

const ROOT_DIR = path.resolve(__dirname, '..');
// .env.local is the single source of truth. Load it with override:true so its
// values win over any leftover shell environment variables (e.g. a stray
// SYMBOL=NVDA that would otherwise hijack the SPX home-page feed). The legacy
// .env is intentionally NOT loaded — it held stale tokens/PORT that conflicted.
dotenv.config({ path: path.join(ROOT_DIR, '.env.local'), override: true });

const next = require('next');
const marketState = require('./state/market-state');
const { getFlowGexHistoryWindow } = require('./state/flow-gex-history');
const { startTickerWallRecorder, getWallHistory: getTickerWallHistory } = require('./state/ticker-wall-recorder');
const { buildSnapshot, createGexWsServer, getWsBandwidth } = require('./websocket-server');
const { TastytradeProxy, probeRest, contractStats, fetchChainFull, fetchExpirations, fetchOptionMarks, fetchUnderlyingQuotes, fetchUnderlyingDayOhlc, fetchDailyHistory } = require('./proxy-tastytrade');
const { etEpochMs } = require('./computation/utils');
// Optional feature modules — loaded defensively so a missing or broken file can
// NEVER take down the whole origin on boot. A hard `require` that throws here
// crash-loops the container → Cloudflare 502 for the entire site. (This bit us
// once: state/etf-candle-recorder.js was gitignored by the `state/` rule and
// never shipped, so its hard require killed boot. Recorder now lives in
// server-v2/ root and loads under try/catch regardless.)
let fetchIntradayCandles = async () => { throw new Error('candle-history module unavailable'); };
try { ({ fetchIntradayCandles } = require('./candle-history')); }
catch (e) { console.warn('[candles] candle-history not loaded:', e.message); }
let startEtfCandleRecorder = () => {};
try { ({ startEtfCandleRecorder } = require('./etf-candle-recorder')); }
catch (e) { console.warn('[etf-candle] recorder not loaded:', e.message); }
// SPY/QQQ per-strike GEX. Same defensive load as the candle recorder above: a
// broken chain-fetch dependency here must degrade the ETF heatmap, not kill
// boot for the whole dashboard.
let startEtfGexRecorder = () => {};
try { ({ startEtfGexRecorder } = require('./etf-gex-recorder')); }
catch (e) { console.warn('[etf-gex] recorder not loaded:', e.message); }
const { startEodGexRecorder } = require('./eod-gex-recorder');
// Once-a-day (9:32 ET) per-strike OPEN INTEREST snapshot across the scanner
// watchlist. Backs the Options Chain page's OI tab and its day-over-day ΔOI.
// OI is a settled overnight number, so this is a daily job, not a poll — see
// the header of oi-daily-recorder.js. Loaded defensively: a broken chain-fetch
// dependency here must degrade one tab, not kill boot for the whole dashboard.
let startOiDailyRecorder = () => {};
try { ({ startOiDailyRecorder } = require('./oi-daily-recorder')); }
catch (e) { console.warn('[oi-daily] recorder not loaded:', e.message); }
// Once-a-day (16:05 ET) per-strike NET GEX snapshot of the whole board minus
// 0DTE, across the scanner watchlist → eod_strike_gex. Backs the Ticker Lookup
// card's day-over-day ΔGEX column. Uses the SAME TastyTrade chain + OI+Vol
// formula the card itself reads, so the Δ and the level beside it are the same
// definition of GEX — see the header of eod-strike-gex-recorder.js. Same
// defensive load as its neighbours: a broken chain-fetch dependency degrades
// one column, it does not kill boot.
let startEodStrikeGexRecorder = () => {};
try { ({ startEodStrikeGexRecorder } = require('./eod-strike-gex-recorder')); }
catch (e) { console.warn('[eod-strike-gex] recorder not loaded:', e.message); }
// Daily (16:05 ET) near-the-money PREMIUM TRADED snapshot: call and put notional
// for the front and back monthly at ±1/2/5% of spot → atm_prem_diff. Backs the
// Test Lab "Prem Diff" tab. Same defensive load as its neighbours above — a
// broken chain-fetch dependency must degrade one panel, not kill boot.
let startAtmPremRecorder = () => {};
try { ({ startAtmPremRecorder } = require('./atm-prem-recorder')); }
catch (e) { console.warn('[atm-prem] recorder not loaded:', e.message); }
// Backs the /mult-greek click card's 15m/30m/open NET GEX change. Optional —
// load defensively so a missing/broken module can't crash the origin.
let multGreekGexRecorder = null;
try { multGreekGexRecorder = require('./mult-greek-gex-recorder'); }
catch (e) { console.warn('[mult-greek-gex] recorder not loaded:', e.message); }
const { getEsSpxBasis } = require('./es-spx-basis');
const { startGreeksTsWriter } = require('./greeks-ts-writer');
const { startStrikeGrowthRecorder } = require('./strike-growth-recorder');
const { startGreekScannerRecorder, runSnapshot: runGreekSnapshot, ensureSchema: greekEnsureSchema, getPool: greekGetPool } = require('./greek-scanner-recorder');
const { startFarCbRecorder, runSweep: runFarCbSweep, runGrading: runFarCbGrading, runContractBackfill: runFarCbBackfill, ensureSchema: farCbEnsureSchema, getPool: farCbGetPool, computeOutcomeDetail: farCbOutcomeDetail, enrichOutcomesWithQuotes: farCbEnrichOutcomes, toYmd: farCbToYmd, OTM_THRESHOLD_PCT: FAR_CB_OTM_PCT } = require('./far-cb-recorder');
const { startScannerRecorder, runSweep: runScannerSweep, ensureSchema: scannerEnsureSchema, getPool: scannerGetPool, parseScannerTickers } = require('./scanner-recorder');
const { startWallsRecorder, runSlot: runWallsSlot, getWalls } = require('./walls-recorder');
const { startWallsReach, runReachBackfill, runCalibration, getReach, attachRank,
  getWatch, runWatchAlerts, getAlerts, startWallsWatch } = require('./walls-reach');
const { startForwardScanner, runForwardSweep, getForward } = require('./forward-scanner-recorder');
const { startGexChangeTopRecorder, runOnce: runGexChangeTop, getHistory: getGexChangeTopHistory, getPickHistory: getGexChangeTopPickHistory, getResults: getGexChangeTopResults, runResults: runGexChangeTopResults, getStudy: getGexChangeTopStudy, getCalibration: getGexChangeTopCalibration, fitProjRule: fitGexChangeTopRule, getRuleState: getGexChangeTopRuleState, storeRule: storeGexChangeTopRule } = require('./gex-change-top-recorder');
const {
  startSignalsEngine, getRecentSignals: getSignalRows, runOnce: runSignalsOnce,
  ALERT_CATALOG: SIGNAL_ALERT_CATALOG, listAlertSettings: listSignalAlertSettings,
  setAlertEnabled: setSignalAlertEnabled,
} = require('./signals-engine');
// Runtime-editable layer over the CB Edge ticker rosters (scanner / em / far-cb).
// Baselines still live in scanner-tickers.js, em-tickers.js and far-cb-tickers.js;
// this adds a roster_overrides table on top so the owner Watchlists page can add,
// remove and move tickers without a redeploy. Serves /proxy/rosters + /proxy/roster.
const rosterStore = require('./roster-store');
const { checkProxyAccess } = require('./proxy-auth');
const { verifyWsRequest } = require('./ws-auth');
// In-process replacement for app/api/* Next routes. Handles only routes it has
// registered; everything else falls through to Next. Gated by API_ROUTER=1 at
// the mount point below so it is a no-op until deliberately enabled.
const { handleApiRoute } = require('./api-router');
const { initObservability, captureError } = require('./observability');

const PORT = parseInt(process.env.PORT || '3001', 10);
const DEV = process.env.NODE_ENV !== 'production';

// Maintenance mode: when ON, the Next middleware serves /maintenance to every
// non-owner request. Toggled at runtime from the owner dashboard; defaults from
// MAINTENANCE_MODE env at boot (resets to that default on restart/redeploy).
let maintenanceMode = process.env.MAINTENANCE_MODE === '1' || process.env.MAINTENANCE_MODE === 'true';

// ---------------------------------------------------------------------------
// Contract history helpers (/proxy/option-history)
// ---------------------------------------------------------------------------
//
// The /flow tape's contract drawer used to read ONLY from ThetaData, which broke
// the moment the box moved to DATA_SOURCE=tt: the Terminal is a sibling
// container, THETA_BASE_URL still said 127.0.0.1, and every drawer open came
// back a bad gateway. dxLink already streams Candle events for option symbols
// (verified: ".SPXW260731P6300{=5m}" replays real OHLC), and the tape's rows
// already carry the exact streamer symbol — so the drawer can be served from the
// same feed the rest of the page runs on, with no Terminal in the path.

// Display ticker -> option STREAMER root. Inverse of flow-processor's
// ROOT_TO_TICKER: index weeklies stream under a different root than the chip
// label (SPX -> SPXW). Equities pass through unchanged.
const TICKER_TO_STREAMER_ROOT = { SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW', XSP: 'XSPW' };

/**
 * Build a dxFeed option streamer symbol: ".SPXW260731P6300".
 *
 * Only a FALLBACK — callers that came from the tape should pass the row's own
 * `symbol`, which is the exact string the feed published. This reconstruction
 * can't know that e.g. SPX monthly AM-settled contracts stream under root "SPX"
 * rather than "SPXW", so a hand-built symbol is a best guess, not gospel.
 */
function buildStreamerSymbol(ticker, expiry, strike, type) {
  const root = TICKER_TO_STREAMER_ROOT[ticker] || ticker;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(expiry || ''));
  if (!root || !m) return '';
  const yymmdd = `${m[1].slice(2)}${m[2]}${m[3]}`;
  // dxFeed writes the strike with no trailing zeros: 6300, 745.5 — not 6300.00.
  const k = Number(strike);
  if (!(k > 0)) return '';
  const strikeStr = Number.isInteger(k) ? String(k) : String(k).replace(/0+$/, '').replace(/\.$/, '');
  return `.${root}${yymmdd}${type === 'P' ? 'P' : 'C'}${strikeStr}`;
}

/** RTH bounds (09:30 / 16:00 ET) for a YYYY-MM-DD, as epoch ms. */
function etSessionOpenMs(ymd) { return etEpochMs(ymd, 9, 30); }
function etSessionCloseMs(ymd) { return etEpochMs(ymd, 16, 0); }

// ---------------------------------------------------------------------------
// REST snapshot router (/proxy/*)
// ---------------------------------------------------------------------------

// Security headers applied to EVERY response (Next pages + proxy routes).
// Set before any routing/writeHead so they ride along on all responses.
function applySecurityHeaders(req, res) {
  // Only assert HSTS on HTTPS (behind the TLS-terminating proxy: x-forwarded-proto).
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (proto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // CSP. 'unsafe-eval' removed — no first-party code needs eval()/new Function();
  // it only widened the XSS blast radius. 'unsafe-inline' is retained for now
  // because Next 15's inline bootstrap/hydration scripts require either a
  // per-request nonce (needs HTML-stream interception in this custom server —
  // tracked as a P1 follow-up) or 'unsafe-inline'. If a dependency breaks
  // without eval, prefer fixing/replacing that dependency over re-adding it.
  // CSP_REPORT_ONLY=1 emits the header in report-only mode for safe rollout.
  const cspHeader = process.env.CSP_REPORT_ONLY === '1'
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';
  // Dev-only relaxation: Next's Fast Refresh runtime needs eval() to work, and
  // without it a CSP violation can abort client script execution before React
  // hydrates -- every button/click handler goes dead, even though the page
  // renders fine (SSR markup isn't affected). Production never sets this.
  const scriptSrc = process.env.NODE_ENV === 'production'
    ? "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://static.ads-twitter.com; "
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com https://static.ads-twitter.com; ";
  res.setHeader(
    cspHeader,
    "default-src 'self'; " +
      scriptSrc +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob: https:; " +
      "font-src 'self' data:; " +
      "connect-src 'self' https: wss:; " +
      "frame-ancestors 'self'; " +
      "base-uri 'self'; " +
      "form-action 'self'; " +
      "object-src 'none'"
  );
  // Don't advertise the stack.
  res.removeHeader('X-Powered-By');
}

// Optional comma-separated allowlist (e.g. "https://cbedge.net,https://www.cbedge.net").
// The /proxy surface is same-origin (browser → same host) and now auth-gated, so
// no CORS header is needed by default. We ONLY emit Access-Control-Allow-Origin
// when the request's Origin is explicitly allowlisted — never the "*" wildcard,
// which both leaks data cross-site and is invalid alongside cookie auth.
const CORS_ALLOWLIST = new Set(
  (process.env.PROXY_CORS_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
);

// Bodies at/above this size get gzipped when the client accepts it. Big /proxy
// payloads (flow-history tape = multi-MB of repeated JSON keys) compress
// 80–90%; tiny ones aren't worth the CPU.
const SEND_JSON_GZIP_MIN = 1024;

/**
 * @param {object} [opts]
 * @param {string} [opts.cacheControl] override the default no-store — used for
 *   immutable historical-session responses so the browser can cache them.
 */
function sendJson(res, code, obj, req, opts) {
  let body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': (opts && opts.cacheControl) || 'no-store',
  };
  const vary = [];
  const origin = req?.headers?.origin;
  if (origin && CORS_ALLOWLIST.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    vary.push('Origin');
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  // Gzip large bodies when the caller passed `req` (needed for the
  // Accept-Encoding check). Callers that omit req just send identity.
  const acceptEnc = String(req?.headers?.['accept-encoding'] || '');
  if (body.length >= SEND_JSON_GZIP_MIN && /\bgzip\b/i.test(acceptEnc)) {
    try {
      body = zlib.gzipSync(Buffer.from(body), { level: 6 });
      headers['Content-Encoding'] = 'gzip';
      vary.push('Accept-Encoding');
    } catch { /* fall back to identity */ }
  }
  if (vary.length) headers['Vary'] = vary.join(', ');
  res.writeHead(code, headers);
  res.end(body);
}

/**
 * Read + JSON.parse a request body. Resolves `{}` on an empty or malformed
 * body so a caller can treat "no body" and "bad body" the same way; the 100KB
 * ceiling matches the ad-hoc readers elsewhere in this file.
 */
function readJsonBody(req, limit = 1e5) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > limit) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// Cache-Control for a session-scoped payload: past ET sessions are immutable,
// so let the browser keep them for a day; today's stays no-store.
function sessionCacheOpts(date) {
  return date && date < todayYmdET()
    ? { cacheControl: 'public, max-age=86400' }
    : undefined;
}

/**
 * Handle a /proxy/* request. Returns true if handled.
 * @returns {boolean}
 */
async function handleProxyRest(req, res) {
  const { pathname } = new URL(req.url || '/', 'http://localhost');
  if (!pathname || !pathname.startsWith('/proxy/')) return false;

  const state = marketState.getState();

  switch (pathname) {
    case '/proxy/snapshot':
      sendJson(res, 200, buildSnapshot(state));
      return true;
    case '/proxy/gex': {
      const url = new URL(req.url || '/', 'http://localhost');
      const basis = url.searchParams.get('basis') || 'net'; // net | vol | flow
      sendJson(res, 200, {
        symbol: state.symbol,
        spot: state.spot,
        // Spot freshness — how long ago the index feed last moved spot. Consumers
        // (greeks writer, owner health) use this to detect a frozen index stream.
        spotAt: state.spotAt || 0,
        spotAgeMs: state.spotAt ? Date.now() - state.spotAt : null,
        prevClose: state.prevClose,
        prevCloseDate: state.prevCloseDate,
        expiry: state.expiry,
        expirations: state.expirations,
        gexRows: state.gexRows,
        totals: state.totals,
        callWall: state.callWall,
        putWall: state.putWall,
        gexFlip: state.gexFlip,
        totalNetGex: state.totalNetGex,
        totalFlowGex: state.totalFlowGex || 0, // flow GEX from dealer inventory
        basis, // echo requested basis so client knows which mode to display
        updatedAt: state.updatedAt,
      });
      return true;
    }
    case '/proxy/flow':
      sendJson(res, 200, state.flow || {});
      return true;
    case '/proxy/flow-gex-history': {
      // Reconstructs per-minute Flow GEX history for a window of strikes
      // around spot, entirely from Postgres (flow_prints tape + the
      // call_gamma/put_gamma snapshots in option_strike_gex_history) — no
      // in-memory dependency, works for any strike that had recorded tape
      // today. See server-v2/state/flow-gex-history.js for the reconstruction.
      const url = new URL(req.url || '/', 'http://localhost');
      const expiration = url.searchParams.get('expiration') || state.expiry;
      const date = url.searchParams.get('date') || undefined;
      const windowSize = Math.max(1, Math.min(50, Number(url.searchParams.get('window')) || 20));
      // Optional single-strike fast path — see flow-gex-history.js for why
      // this matters (the contract-flow popup only needs one strike and the
      // full ±20-strike window query was timing out).
      const strikeParam = url.searchParams.get('strike');
      const strike = strikeParam != null && strikeParam !== '' ? Number(strikeParam) : undefined;
      const spot = state.spot;
      const result = await getFlowGexHistoryWindow({ spot, expiration, date, windowSize, strike });
      sendJson(res, 200, result);
      return true;
    }
    case '/proxy/expirations':
      if (req.method === 'POST') {
        // POST { expiry: 'YYYY-MM-DD' } to manually switch the active expiry.
        //
        // Same caveat as the WS SET_EXPIRY path above: one process-wide value
        // that also steers the history recorder. Tagged 'client-http' so
        // setExpiry() drops it while GEX_EXPIRY_LOCK is on, and reports the
        // refusal rather than answering ok:true for a switch that did not
        // happen — a silent 200 here is how a caller ends up believing the feed
        // moved when it did not.
        let body = '';
        req.on('data', (d) => { body += d; });
        req.on('end', () => {
          try {
            const { expiry } = JSON.parse(body);
            if (!expiry || !proxy) {
              sendJson(res, 400, { error: 'missing expiry or proxy not ready' });
              return;
            }
            proxy.setExpiry(expiry, 'client-http');
            const active = proxy.expiry;
            if (active === expiry) sendJson(res, 200, { ok: true, expiry: active });
            else sendJson(res, 409, {
              ok: false,
              expiry: active,
              requested: expiry,
              error: 'expiry is locked to the feed/recorder — set GEX_EXPIRY_LOCK=0 to allow client switching',
            });
          } catch { sendJson(res, 400, { error: 'invalid JSON' }); }
        });
        return true;
      }
      {
        const url = new URL(req.url || '/', 'http://localhost');
        const ticker = url.searchParams.get('ticker') || url.searchParams.get('root') || url.searchParams.get('symbol') || 'SPXW';
        try {
          const { items } = await fetchExpirations(ticker);
          const expirations = items.map((it) => it['expiration-date']);
          sendJson(res, 200, { expiry: state.expiry, expirations });
        } catch (e) {
          // Fall back to the frozen boot-time snapshot if the live REST fetch fails.
          sendJson(res, 200, { expiry: state.expiry, expirations: state.expirations, warning: String(e?.message || e) });
        }
      }
      return true;
    case '/proxy/status':
      sendJson(res, 200, {
        ...state.status,
        spot: state.spot,
        spotAt: state.spotAt || 0,
        spotAgeMs: state.spotAt ? Date.now() - state.spotAt : null,
        updatedAt: state.updatedAt,
      });
      return true;
    case '/proxy/health':
      sendJson(res, 200, { ok: true, ts: Date.now() });
      return true;
    case '/proxy/self-metrics': {
      // The app's own footprint, reported from inside the container. Hetzner's
      // cloud API exposes CPU + network but NOT memory, so the owner dashboard's
      // memory box reads this instead. rss = resident set size (real RAM held).
      const mu = process.memoryUsage();
      sendJson(res, 200, {
        rss: mu.rss,
        heapUsed: mu.heapUsed,
        heapTotal: mu.heapTotal,
        external: mu.external,
        uptimeSec: Math.round(process.uptime()),
        // Live /ws/gex outbound bandwidth: bytes/min split by frame type (gex vs
        // flow vs snapshot…) + cumulative totals. null until the WS server attaches.
        wsBandwidth: getWsBandwidth(),
        ts: Date.now(),
      });
      return true;
    }
    default:
      // Async routes are handled below (return false so they fall through).
      break;
  }

  // /proxy/es-spx-basis
  // The ONE trustworthy ES−SPX basis: our es_candles 16:00 ET close (the charted
  // contract → roll-correct) minus Yahoo ^GSPC's close (independent of the broker
  // feed, whose "SPX" spot actually tracks ES and poisons every other basis path).
  // { basis, esClose, spxClose, date } — or { basis: null } when unavailable, which
  // callers must NOT coerce to 0.
  if (pathname === '/proxy/es-spx-basis') {
    getEsSpxBasis()
      .then((b) => sendJson(res, 200, b ?? { basis: null }))
      .catch((e) => sendJson(res, 500, { error: 'es-spx-basis failed', detail: String(e?.message || e) }));
    return true;
  }

  // /proxy/mult-greek-gex-grid?ticker=SPX&expiry=YYYY-MM-DD
  // Bulk form of the below: { data: { cells: { <strike>: { vNow, v5, v15, v30 } } } }
  // for EVERY recorded strike on that expiry, in one round trip.
  if (pathname === '/proxy/mult-greek-gex-grid') {
    const u = new URL(req.url || '/', 'http://localhost');
    const ticker = (u.searchParams.get('ticker') || '').trim().toUpperCase();
    const expiry = (u.searchParams.get('expiry') || '').trim();
    if (!ticker || !expiry) { sendJson(res, 400, { error: 'ticker, expiry required' }); return true; }
    if (!multGreekGexRecorder?.queryGexGrid) { sendJson(res, 200, { data: null }); return true; }
    multGreekGexRecorder.queryGexGrid(ticker, expiry)
      .then((data) => sendJson(res, 200, { data }))
      .catch((e) => sendJson(res, 500, { error: 'mult-greek-gex-grid failed', detail: String(e?.message || e) }));
    return true;
  }

  // /proxy/mult-greek-gex-change?ticker=SPX&expiry=YYYY-MM-DD&strike=7400
  // Stored { vNow, v15, v30, vOpen } NET GEX for one /mult-greek cell
  // (mult-greek-gex-recorder). The client diffs its live value against these.
  if (pathname === '/proxy/mult-greek-gex-change') {
    const u = new URL(req.url || '/', 'http://localhost');
    const ticker = (u.searchParams.get('ticker') || '').trim().toUpperCase();
    const expiry = (u.searchParams.get('expiry') || '').trim();
    const strike = Number(u.searchParams.get('strike'));
    if (!ticker || !expiry || !Number.isFinite(strike)) {
      sendJson(res, 400, { error: 'ticker, expiry, strike required' });
      return true;
    }
    if (!multGreekGexRecorder?.queryGexChange) { sendJson(res, 200, { data: null }); return true; }
    multGreekGexRecorder.queryGexChange(ticker, expiry, strike)
      .then((data) => sendJson(res, 200, { data }))
      .catch((e) => sendJson(res, 500, { error: 'mult-greek-gex-change failed', detail: String(e?.message || e) }));
    return true;
  }

  // /proxy/gex-history?expiry=YYYY-MM-DD&ages=5,15,30
  // Returns per-strike net GEX baselines as of N minutes ago, shaped for
  // useStrikeGexHistory: { mode:"point", ages:[...], baselines:{ strike:{ "5":x,... } } }.
  if (pathname === '/proxy/gex-history') {
    handleGexHistory(req, res).catch((e) => {
      sendJson(res, 500, { error: 'gex-history failed', detail: String(e?.message || e) });
    });
    return true;
  }

  // /proxy/wall-history?ticker=NDX&ages=5,15,30,60
  // Server-recorded call/put GEX wall for NDX/SPY/QQQ (ticker-wall-recorder.js),
  // shaped for the Walls & Flows tab: { ages:[...], windows:[{age,callWall,putWall}] }.
  // Unlike /proxy/gex-history (SPX only, per-strike), this reads pre-computed
  // wall snapshots so it survives regardless of whether a browser is open.
  if (pathname === '/proxy/wall-history') {
    const wallUrl = new URL(req.url || '/', 'http://localhost');
    const ticker = (wallUrl.searchParams.get('ticker') || '').trim().toUpperCase();
    const ages = (wallUrl.searchParams.get('ages') || '5,15,30,60')
      .split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
    if (!ticker || !ages.length) {
      sendJson(res, 200, { ages, windows: [] });
      return true;
    }
    getTickerWallHistory(ticker, ages)
      .then((result) => sendJson(res, 200, result))
      .catch((e) => sendJson(res, 500, { error: 'wall-history failed', detail: String(e?.message || e) }));
    return true;
  }

  // /proxy/flow-history?date=YYYY-MM-DD&limit=2000
  // Returns today's persisted flow tape as FlowOrder[] (oldest-first).
  if (pathname === '/proxy/flow-history') {
    handleFlowHistory(req, res).catch((e) => {
      sendJson(res, 500, { error: 'flow-history failed', detail: String(e?.message || e) });
    });
    return true;
  }

  // /proxy/flow-netprem?underlying=SPX&date=YYYY-MM-DD&bin=60
  // Per-bin net premium + volume for one ticker (aggregated server-side so the
  // chart never has to pull raw prints — SPX alone is hundreds of k/day).
  if (pathname === '/proxy/flow-netprem') {
    handleFlowNetPrem(req, res).catch((e) => {
      sendJson(res, 500, { error: 'flow-netprem failed', detail: String(e?.message || e) });
    });
    return true;
  }

  // /proxy/flow-premsplit?date=&minPremium=&exIdx=1&… — buy/sell × call/put
  // premium totals over the full filtered session, computed in SQL.
  if (pathname === '/proxy/flow-premsplit') {
    handleFlowPremSplit(req, res).catch((e) => {
      sendJson(res, 500, { error: 'flow-premsplit failed', detail: String(e?.message || e) });
    });
    return true;
  }

  // /proxy/gex-vol-flow?bin=300&scope=front — today's net VOL GEX by time
  // bucket (plus the OI leg and spot), for the Vol GEX Flow tab / card.
  if (pathname === '/proxy/gex-vol-flow') {
    handleGexVolFlow(req, res).catch((e) => {
      sendJson(res, 500, { error: 'gex-vol-flow failed', detail: String(e?.message || e) });
    });
    return true;
  }

  // /proxy/candles-intraday?symbol=SPY&interval=1m&daysBack=1
  // Intraday OHLC for any dxLink symbol (SPY/QQQ price lines), collected via a
  // short-lived isolated dxLink candle subscription (see candle-history.js).
  // Returns { symbol, interval, candles: [{ time, open, high, low, close, volume }] }.
  if (pathname === '/proxy/candles-intraday') {
    const u = new URL(req.url || '/', 'http://localhost');
    const symbol = (u.searchParams.get('symbol') || '').trim().toUpperCase();
    const interval = (u.searchParams.get('interval') || '1m').trim();
    const daysBack = Math.max(1, Math.min(5, Number(u.searchParams.get('daysBack') || 1) || 1));
    if (!symbol) { sendJson(res, 400, { error: 'symbol required' }); return true; }
    // Prefer an explicit fromMs (client pins it to today's ET session start);
    // fall back to daysBack. Never look back more than 7d (dxFeed's 1m limit).
    const fromMsRaw = Number(u.searchParams.get('fromMs'));
    const floor = Date.now() - 7 * 86_400_000;
    const fromTime = Number.isFinite(fromMsRaw) && fromMsRaw > floor
      ? fromMsRaw
      : Date.now() - daysBack * 86_400_000;
    fetchIntradayCandles(symbol, interval, fromTime)
      .then((candles) => sendJson(res, 200, { symbol, interval, candles }))
      .catch((e) => sendJson(res, 502, { error: 'candles-intraday failed', detail: String(e?.message || e), symbol }));
    return true;
  }

  sendJson(res, 404, { error: 'unknown proxy route', path: pathname });
  return true;
}

// ── /proxy/gex-history ─────────────────────────────────────────────────────
let _histPool = null;
let _histPoolDown = false;
function getHistPool() {
  if (_histPoolDown) return null;
  if (_histPool) return _histPool;
  if (!process.env.DATABASE_URL) { _histPoolDown = true; return null; }
  try {
    const { Pool } = require('pg');
    _histPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    _histPool.on('error', (e) => {
      console.warn('[gex-history-read] pool error (will reconnect):', e.message);
      try { _histPool?.end().catch(() => {}); } catch {}
      _histPool = null;
    });
    return _histPool;
  } catch (e) {
    console.error('[gex-history-read] pg unavailable:', e.message);
    _histPoolDown = true;
    return null;
  }
}

function todayYmdET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// `flow_prints.underlying_norm` is normally added lazily by the WRITE side
// (state/flow-history-writer.js ensureTable(), run on the first flushed print
// of the day). On a day with zero live flow traffic (market closed, or the
// writer hasn't ticked yet) that column never gets created — but the READ
// path (below) filters on it unconditionally, so every ticker-scoped request
// 500s identically with "column underlying_norm does not exist", which looks
// like a per-ticker bug but isn't. Mirror the same idempotent migration here
// so reads don't depend on writes having happened first.
let _flowSchemaEnsured = false;
async function ensureFlowPrintsSchema(pool) {
  if (_flowSchemaEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flow_prints (
        ts          BIGINT       NOT NULL,
        date        TEXT         NOT NULL,
        symbol      TEXT         NOT NULL,
        underlying  TEXT,
        expiration  TEXT,
        strike      REAL,
        type        TEXT,
        side        TEXT         NOT NULL,
        action      TEXT,
        bucket      TEXT,
        price       REAL,
        size        INTEGER,
        premium     REAL,
        is_otm      BOOLEAN,
        PRIMARY KEY (ts, symbol, side)
      )
    `);
    await pool.query('ALTER TABLE flow_prints ADD COLUMN IF NOT EXISTS underlying_norm TEXT');
    await pool.query('ALTER TABLE flow_prints ADD COLUMN IF NOT EXISTS spot REAL');
    await pool.query('CREATE INDEX IF NOT EXISTS flow_prints_date_norm_ts_idx ON flow_prints (date, underlying_norm, ts)');
    // Covering index for /proxy/flow-netprem: that query filters on type/side/
    // premium/is_otm, none of which are in the index above, so a hot ticker
    // (SPX 0DTE, hundreds of k prints/day) forces a heap fetch per matching row
    // on every 5s poll. INCLUDE-ing the filtered+summed columns here lets
    // Postgres answer straight from the index (index-only scan) instead.
    await pool.query('CREATE INDEX IF NOT EXISTS flow_prints_netprem_covering_idx ON flow_prints (date, underlying_norm, ts) INCLUDE (type, side, premium, size, is_otm)');
    // Combined (no-ticker) tape pull filters on `premium` alone. With the full
    // roster recording (millions of prints/day) the date-only path degenerates
    // into a seq scan — measured 11s on 4.3M rows, which blows past the client
    // fetch and silently yields an empty tape. Index the exact shape of that
    // query so it becomes an index range scan.
    await pool.query('CREATE INDEX IF NOT EXISTS flow_prints_date_prem_ts_idx ON flow_prints (date, premium DESC, ts DESC)');
    await pool.query('UPDATE flow_prints SET underlying_norm = upper(underlying) WHERE underlying_norm IS NULL AND underlying IS NOT NULL');
    _flowSchemaEnsured = true;
  } catch (e) {
    console.warn('[flow-history-read] schema ensure failed (will retry next request):', e.message);
  }
}

async function handleGexHistory(req, res) {
  const { searchParams } = new URL(req.url || '/', 'http://localhost');
  const expiry = searchParams.get('expiry') || marketState.getState().expiry || '';
  const ages = (searchParams.get('ages') || '5,15,30')
    .split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  // basis=vol   → per-strike VOL-ONLY baselines (net_vol_gex), for the heatmap's
  //               Vol GEX Speed column.
  // basis=oivol → the OI+Vol COMPOSITE (net_gex + net_vol_gex). This is what the
  //               home heatmap's NET GEX column actually displays
  //               (toHeatmapRows: netGEX + netVolGEX), so a Δ against a plain
  //               net_gex baseline was computing (OI+Vol) − (OI only) — i.e. the
  //               volume component, not a change over time. That read as absurd
  //               percentages whenever volume GEX outweighed OI GEX.
  // Default stays net_gex so every existing caller is unchanged.
  const basisParam = searchParams.get('basis');
  const basis = basisParam === 'vol' ? 'vol' : basisParam === 'oivol' ? 'oivol' : 'net';
  const col = basis === 'vol'
    ? 'net_vol_gex'
    : basis === 'oivol'
      ? '(net_gex + COALESCE(net_vol_gex, 0))'
      : 'net_gex';

  if (!expiry || !ages.length) {
    return sendJson(res, 200, { mode: 'point', basis, ages, baselines: {} });
  }
  const pool = getHistPool();
  if (!pool) {
    return sendJson(res, 200, { mode: 'point', basis, ages, baselines: {} });
  }

  const date = todayYmdET();
  const now = Date.now();
  const baselines = {};

  // For each age, pick — per strike — the row whose timestamp is closest to
  // (now − age minutes). DISTINCT ON keeps one row per strike, ordered by
  // proximity to the target time.
  // COALESCE(...) is never NULL, so the composite basis must null-guard on the
  // underlying net_gex column instead of the expression.
  const nullGuard = basis === 'oivol' ? 'net_gex' : col;
  for (const age of ages) {
    const target = now - age * 60_000;
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (strike) strike, ${col} AS val
         FROM option_strike_gex_history
        WHERE date = $1 AND expiry = $2 AND timestamp <= $3 AND ${nullGuard} IS NOT NULL
        ORDER BY strike, ABS(timestamp - $4) ASC`,
      [date, expiry, target, target]
    );
    for (const r of rows) {
      const strike = Number(r.strike);
      const v = Number(r.val);
      if (!Number.isFinite(strike) || !Number.isFinite(v)) continue;
      (baselines[strike] ||= {})[String(age)] = v;
    }
  }

  sendJson(res, 200, { mode: 'point', basis, ages, baselines });
}

// ── /proxy/flow-history ────────────────────────────────────────────────────
// Returns persisted flow prints for a date (default today ET), shaped as the
// client FlowOrder[] so the /flow page can seed before the live WS takes over.
// Root variants so an "SPX" filter also matches the streamer root "SPXW", etc.
const FLOW_TICKER_ROOTS = { SPX: ['SPX', 'SPXW'], NDX: ['NDX', 'NDXP'], RUT: ['RUT', 'RUTW'], XSP: ['XSP', 'XSPW'] };
function flowRootsFor(t) {
  const up = String(t || '').toUpperCase();
  return FLOW_TICKER_ROOTS[up] || [up];
}

// Same idea as _netPremCache: several /flow tabs (or a quick back-and-forth
// ticker switch) polling the same date|underlying|limit collapse to one query
// per TTL instead of one per request.
const _flowHistoryCache = new Map(); // key -> { at: ms, payload }
const FLOW_HISTORY_TTL_MS = 4000;

async function handleFlowHistory(req, res) {
  const { searchParams } = new URL(req.url || '/', 'http://localhost');
  const date = searchParams.get('date') || todayYmdET();
  // Honor an explicit ?underlying/?symbol (e.g. SPY/QQQ for the Condition card);
  // default to SPX when absent so bare callers keep the old SPX seed behavior.
  const underlying = (searchParams.get('underlying') || searchParams.get('symbol') || 'SPX').trim().toUpperCase();
  let limit = Number(searchParams.get('limit') || 5000);
  if (!Number.isFinite(limit) || limit <= 0) limit = 5000;
  limit = Math.min(limit, 20000);
  // Optional premium floor applied IN SQL (before the newest-N cap) so a combined
  // all-tickers pull can span the whole session: 20k *big* prints reach far
  // further back than 20k raw prints market-wide.
  let minPremium = Number(searchParams.get('minPremium') || 0);
  if (!Number.isFinite(minPremium) || minPremium < 0) minPremium = 0;

  const cacheKey = `${date}|${underlying.toUpperCase()}|${limit}|${minPremium}`;
  const hit = _flowHistoryCache.get(cacheKey);
  if (hit && Date.now() - hit.at < FLOW_HISTORY_TTL_MS) return sendJson(res, 200, hit.payload, req, sessionCacheOpts(date));

  const pool = getHistPool();
  if (!pool) return sendJson(res, 200, { date, tape: [] }, req);
  await ensureFlowPrintsSchema(pool);

  // Optional per-ticker filter. With the full roster recording, an unfiltered
  // newest-N cap drops a single ticker's early-session prints — so when the
  // client asks for one ticker, pull THAT ticker's whole day instead.
  const params = [date];
  let where = 'date = $1';
  if (underlying) {
    params.push(flowRootsFor(underlying));
    // underlying_norm is a plain indexed column (date, underlying_norm, ts);
    // upper(underlying) = ANY(...) can't use a btree index and forces a
    // per-row scan of the whole date partition.
    where += ` AND underlying_norm = ANY($${params.length})`;
  }
  if (minPremium > 0) {
    params.push(minPremium);
    where += ` AND premium >= $${params.length}`;
  }
  params.push(limit);
  const limitIdx = params.length;

  // Newest `limit` rows, then re-sorted oldest-first to match the live tape.
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT ts, symbol, underlying, expiration, strike, type, side, action,
              bucket, price, size, premium, is_otm, spot
         FROM flow_prints
        WHERE ${where}
        ORDER BY ts DESC
        LIMIT $${limitIdx}
     ) t ORDER BY ts ASC`,
    params
  );

  const tape = rows.map((r) => ({
    ts: Number(r.ts),
    symbol: r.symbol,
    underlying: r.underlying ?? undefined,
    expiration: r.expiration ?? undefined,
    strike: Number(r.strike),
    type: r.type,
    side: r.side,
    action: r.action,
    bucket: r.bucket,
    price: Number(r.price),
    size: Number(r.size),
    premium: Number(r.premium),
    isOtm: r.is_otm === true,
    spot: r.spot != null ? Number(r.spot) : undefined,
  }));

  const payload = { date, tape };
  _flowHistoryCache.set(cacheKey, { at: Date.now(), payload });
  sendJson(res, 200, payload, req, sessionCacheOpts(date));
}

// ── /proxy/flow-netprem ────────────────────────────────────────────────────
// Per-bin (default 60s) net premium + contract volume for one ticker, computed
// in SQL over the FULL session — not subject to the /proxy/flow-history 20k
// raw-row cap, so a busy ticker (SPX 0DTE) still gets the whole 9:30–4:00
// session on the chart even when the tape-backfill cap would truncate the
// early morning. The client walks these bins into cumulative net-drift lines
// on a fixed 9:30–4:00 grid, so the browser never pulls raw prints for the
// chart itself.
// Accepts the same filters as the tape (side/type/premium/size/expiry/dte/otm)
// so the chart moves with the filter panel exactly like the tape does.
// Per-key bin cache. Unlike the old 6s-TTL payload cache, entries for TODAY are
// long-lived and refreshed INCREMENTALLY: once a key has done its one full-
// session GROUP BY, every later poll only scans rows newer than the last bin
// (minus a small overlap for late-flushed prints) and merges. Historical dates
// are immutable, so those entries are simply reused until evicted.
const _netPremCache = new Map(); // key -> { at: ms, date, binMs, bins: [] }
// Freshness window for TODAY entries — must be >= the client poll interval (5s)
// or the cache expires between polls and never saves a query for a single viewer.
const NETPREM_TTL_MS = 4000;
// Re-scan this many trailing bins on an incremental refresh: the flow writer
// flushes in batches, so a print can land in the DB a minute+ after its ts.
const NETPREM_OVERLAP_BINS = 3;
// …and re-scan at least this far back in wall-clock terms, regardless of where
// the last populated bin sits.
//
// Prints now carry their EXCHANGE timestamp (see stampFlowTime in
// proxy-tastytrade.js), so a batch the feed replays lands in bins MINUTES older
// than the newest bin already cached. An overlap anchored only to the last
// populated bin cannot see those rows, and because the cache is otherwise
// append-only they'd stay invisible until the entry was evicted — the chart
// would keep showing a flat stretch that the raw table had already filled in.
// Fifteen minutes covers a realistic replay while keeping the incremental query
// on the covering index instead of a full-session scan.
const NETPREM_LATE_MS = Number(process.env.NETPREM_LATE_MS || 15 * 60_000);

/**
 * Shared tape-filter WHERE builder for flow_prints — used by /proxy/flow-netprem
 * and /proxy/flow-premsplit so the chart, the split and the tape all agree on
 * what a filter means. Returns { where, params }.
 * @param {object} f parsed filters (see parseFlowFilters)
 * @param {number|null} sinceMs only rows with ts >= sinceMs (incremental refresh)
 */
function buildFlowPrintsWhere(f, sinceMs = null) {
  const params = [f.date];
  let where = 'date = $1';
  if (f.underlying) {
    params.push(flowRootsFor(f.underlying));
    where += ` AND underlying_norm = ANY($${params.length})`;
  }
  if (f.exIdx) {
    // "All − Indices" scope: exclude the index roots (both plain + streamer forms).
    params.push(['SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'RUTW', 'XSP', 'XSPW', 'VIX', 'DJX']);
    where += ` AND (underlying_norm IS NULL OR underlying_norm <> ALL($${params.length}))`;
  }
  if (f.side === 'buy' || f.side === 'sell') {
    params.push(f.side);
    where += ` AND side = $${params.length}`;
  }
  if (f.type === 'C' || f.type === 'P') {
    params.push(f.type);
    where += ` AND type = $${params.length}`;
  }
  if (f.minPremium > 0) {
    params.push(f.minPremium);
    where += ` AND premium >= $${params.length}`;
  }
  if (f.minSize > 0) {
    params.push(f.minSize);
    where += ` AND size >= $${params.length}`;
  }
  if (f.expiry !== 'all') {
    params.push(f.expiry);
    where += ` AND expiration = $${params.length}`;
  }
  // DTE is measured against the SESSION DATE being queried ($1, pushed above),
  // NOT CURRENT_DATE. With CURRENT_DATE, every past session's 0DTE flow scored
  // −1 or lower on lookback (a 7/29 expiry queried on 7/30), so any dteMin >= 0
  // — including the 0–7DTE whale preset — silently excluded the day's 0DTE prints
  // while quietly admitting the NEXT day's expiry as "0DTE". Mirrors dteOf() in
  // app/flow/page.tsx; change both together or the chart and tape will disagree.
  if (f.dteMin > 0) {
    params.push(f.dteMin);
    where += ` AND (expiration::date - $1::date) >= $${params.length}`;
  }
  if (f.dteMax != null) {
    params.push(f.dteMax);
    where += ` AND (expiration::date - $1::date) <= $${params.length}`;
  }
  if (f.otmOnly) {
    where += ' AND is_otm = true';
  }
  if (sinceMs != null) {
    params.push(sinceMs);
    where += ` AND ts >= $${params.length}`;
  }
  return { where, params };
}

function parseFlowFilters(searchParams) {
  const date = searchParams.get('date') || todayYmdET();
  // Honor an explicit ?underlying= (mirrors handleFlowHistory's pattern above),
  // defaulting to SPX. The old SPX-only hardcode is gone now that non-SPX flow
  // is ingested via the shared dxLink connection (see proxy-tastytrade.js
  // _startTtMultiFlow) instead of the Theta-based MultiFlowManager, so
  // flow-netprem / flow-premsplit can return any ticker's tape, not just SPX.
  const underlying = (searchParams.get('underlying') || 'SPX').trim().toUpperCase();
  let minPremium = Number(searchParams.get('minPremium') || 0);
  if (!Number.isFinite(minPremium) || minPremium < 0) minPremium = 0;
  let minSize = Number(searchParams.get('minSize') || 0);
  if (!Number.isFinite(minSize) || minSize < 0) minSize = 0;
  let dteMin = Number(searchParams.get('dteMin') || 0);
  if (!Number.isFinite(dteMin) || dteMin < 0) dteMin = 0;
  const dteMaxRaw = searchParams.get('dteMax');
  return {
    date,
    underlying,
    exIdx: false,
    side: (searchParams.get('side') || 'all').toLowerCase(),
    type: (searchParams.get('type') || 'all').toUpperCase(),
    minPremium,
    minSize,
    expiry: searchParams.get('expiry') || 'all',
    dteMin,
    dteMax: dteMaxRaw != null && dteMaxRaw !== '' ? Number(dteMaxRaw) : null,
    otmOnly: searchParams.get('otmOnly') === '1',
  };
}

function flowFilterCacheKey(f, binMs) {
  return [f.date, f.underlying, f.exIdx ? 1 : 0, binMs, f.side, f.type, f.minPremium, f.minSize, f.expiry, f.dteMin, f.dteMax, f.otmOnly ? 1 : 0].join('|');
}

async function queryNetPremBins(pool, f, binMs, sinceMs) {
  const { where, params } = buildFlowPrintsWhere(f, sinceMs);
  params.push(binMs);
  const binIdx = params.length;
  const { rows } = await pool.query(
    `SELECT (ts / $${binIdx}::bigint) * $${binIdx}::bigint AS binms,
            sum(CASE WHEN type = 'C' THEN (CASE WHEN side = 'buy' THEN premium ELSE -premium END) ELSE 0 END) AS call_net,
            sum(CASE WHEN type = 'P' THEN (CASE WHEN side = 'buy' THEN premium ELSE -premium END) ELSE 0 END) AS put_net,
            sum(CASE WHEN type = 'C' THEN size ELSE 0 END) AS call_vol,
            sum(CASE WHEN type = 'P' THEN size ELSE 0 END) AS put_vol
       FROM flow_prints
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1`,
    params
  );
  return rows.map((r) => ({
    sec: Math.floor(Number(r.binms) / 1000),
    callNet: Number(r.call_net) || 0,
    putNet: Number(r.put_net) || 0,
    callVol: Number(r.call_vol) || 0,
    putVol: Number(r.put_vol) || 0,
  }));
}

/**
 * Full bin set for a filter key, via the incremental cache.
 *  - miss            → full-session GROUP BY, cache it
 *  - today, stale    → GROUP BY only ts >= lastBin − overlap, merge into cache
 *  - today, fresh    → cache as-is
 *  - past date       → cache as-is (immutable session)
 */
async function getNetPremBins(f, binMs) {
  const key = flowFilterCacheKey(f, binMs);
  const now = Date.now();
  const hit = _netPremCache.get(key);
  const isToday = f.date === todayYmdET();
  if (hit && (!isToday || now - hit.at < NETPREM_TTL_MS)) return hit.bins;

  const pool = getHistPool();
  if (!pool) return hit ? hit.bins : [];
  await ensureFlowPrintsSchema(pool);

  if (hit && isToday && hit.bins.length) {
    // Incremental refresh: re-scan the trailing overlap window, widened to at
    // least NETPREM_LATE_MS of wall clock so replayed prints stamped with older
    // exchange times are picked up (see the constant's comment).
    const lastSec = hit.bins[hit.bins.length - 1].sec;
    const overlapMs = (lastSec - (NETPREM_OVERLAP_BINS - 1) * Math.floor(binMs / 1000)) * 1000;
    const sinceMs = Math.min(overlapMs, now - NETPREM_LATE_MS);
    const fresh = await queryNetPremBins(pool, f, binMs, sinceMs);
    const sinceSec = Math.floor(sinceMs / 1000);
    const bins = hit.bins.filter((b) => b.sec < sinceSec).concat(fresh);
    _netPremCache.set(key, { at: Date.now(), date: f.date, binMs, bins });
    return bins;
  }

  const bins = await queryNetPremBins(pool, f, binMs, null);
  _netPremCache.set(key, { at: Date.now(), date: f.date, binMs, bins });
  // Bound the map: today keys idle >10min and any non-today-date keys beyond the
  // cap get dropped (historical entries are cheap to rebuild on demand).
  if (_netPremCache.size > 400) {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [k, v] of _netPremCache) if (v.at < cutoff) _netPremCache.delete(k);
  }
  return bins;
}

async function handleFlowNetPrem(req, res) {
  const { searchParams } = new URL(req.url || '/', 'http://localhost');
  const f = parseFlowFilters(searchParams);
  let binSec = Number(searchParams.get('bin') || 60);
  if (!Number.isFinite(binSec) || binSec <= 0) binSec = 60;
  const binMs = Math.round(binSec) * 1000;
  // Incremental client poll: ?since=<sec> returns only bins at/after that time
  // (client keeps its earlier bins). Cuts the steady-state 5s poll from the
  // whole session to the live edge.
  const sinceRaw = searchParams.get('since');
  const since = sinceRaw != null && sinceRaw !== '' ? Number(sinceRaw) : null;

  const bins = await getNetPremBins(f, binMs);
  const out = since != null && Number.isFinite(since) ? bins.filter((b) => b.sec >= since) : bins;
  sendJson(res, 200, { date: f.date, binSec, partial: since != null, bins: out }, req, sessionCacheOpts(f.date));
}

// ── /proxy/flow-premsplit ──────────────────────────────────────────────────
// Buy/sell × call/put premium totals over the FULL filtered session, in SQL.
// Lets the Combined view show exact totals without shipping 20k raw prints to
// the browser just to sum four numbers. Same filter language as flow-netprem,
// plus exIdx=1 for the "All − Indices" scope.
const _premSplitCache = new Map(); // key -> { at, payload }
const PREMSPLIT_TTL_MS = 6000;

async function handleFlowPremSplit(req, res) {
  const { searchParams } = new URL(req.url || '/', 'http://localhost');
  const f = parseFlowFilters(searchParams);
  const key = flowFilterCacheKey(f, 'split');
  const hit = _premSplitCache.get(key);
  if (hit && Date.now() - hit.at < PREMSPLIT_TTL_MS) return sendJson(res, 200, hit.payload, req, sessionCacheOpts(f.date));

  const pool = getHistPool();
  if (!pool) return sendJson(res, 200, { date: f.date, split: null }, req);
  await ensureFlowPrintsSchema(pool);

  const { where, params } = buildFlowPrintsWhere(f);
  const { rows } = await pool.query(
    `SELECT count(*)::bigint AS n,
            coalesce(sum(premium), 0) AS prem,
            coalesce(sum(CASE WHEN type = 'C' AND side = 'buy'  THEN premium ELSE 0 END), 0) AS buy_call,
            coalesce(sum(CASE WHEN type = 'P' AND side = 'buy'  THEN premium ELSE 0 END), 0) AS buy_put,
            coalesce(sum(CASE WHEN type = 'C' AND side = 'sell' THEN premium ELSE 0 END), 0) AS sell_call,
            coalesce(sum(CASE WHEN type = 'P' AND side = 'sell' THEN premium ELSE 0 END), 0) AS sell_put
       FROM flow_prints
      WHERE ${where}`,
    params
  );
  const r = rows[0] || {};
  const payload = {
    date: f.date,
    split: {
      count: Number(r.n) || 0,
      prem: Number(r.prem) || 0,
      buyCall: Number(r.buy_call) || 0,
      buyPut: Number(r.buy_put) || 0,
      sellCall: Number(r.sell_call) || 0,
      sellPut: Number(r.sell_put) || 0,
    },
  };
  _premSplitCache.set(key, { at: Date.now(), payload });
  if (_premSplitCache.size > 200) {
    const cutoff = Date.now() - 60_000;
    for (const [k, v] of _premSplitCache) if (v.at < cutoff) _premSplitCache.delete(k);
  }
  sendJson(res, 200, payload, req, sessionCacheOpts(f.date));
}

// ── /proxy/gex-vol-flow ────────────────────────────────────────────────────
// Intraday flow of NET VOL GEX for today's ET session, bucketed server-side.
//
// Reads option_strike_gex_history — the same table the ES-Candles heatmap and
// the strike-popup baselines come off. It is written ~1/min by the recorder and
// pruned to 48h, so "today" is always warm and the whole session is a small scan.
//
// Bucketing rule: within each bucket take the LAST reading per (expiry, strike),
// NOT an average. These are point-in-time positioning snapshots; averaging
// smears the level and makes the bucket-over-bucket delta meaningless.
//
// scope=front (default) pins to the front expiry, derived from the most recent
// snapshot rather than from the calendar — each session is recorded under its
// own front-expiry string, so assuming "front == today's date" breaks on any
// day the recorder rolls late. scope=all sums every expiry in the window.
const _volFlowCache = new Map(); // key -> { at, payload }
const VOLFLOW_TTL_MS = 20_000;   // recorder writes ~1/min; 20s keeps polls cheap

async function handleGexVolFlow(req, res) {
  const { searchParams } = new URL(req.url || '/', 'http://localhost');

  // Floor is 60s because the recorder writes ~1/min — a smaller bucket cannot
  // surface a reading that does not exist, it just splits the same rows across
  // empty buckets and draws a staircase.
  let binSec = Number(searchParams.get('bin') || 300);
  if (!Number.isFinite(binSec) || binSec <= 0) binSec = 300;
  binSec = Math.max(60, Math.min(3600, Math.round(binSec)));
  const binMs = binSec * 1000;

  const scope = searchParams.get('scope') === 'all' ? 'all' : 'front';
  const expiryParam = (searchParams.get('expiry') || '').trim();
  // session=rth (default) → 09:30–16:00 ET only. The overnight tail carries no
  // new prints: values just persist until the chain resets, which reads on the
  // chart as a long flat line and a phantom step. eth = the whole ET day.
  const session = searchParams.get('session') === 'eth' ? 'eth' : 'rth';

  // option_strike_gex_history is MULTI-SYMBOL (the `symbol` column defaults to
  // '$SPX'; gex-history-writer.js normalises 'SPX' → '$SPX' and SPY/QQQ pass
  // their own ticker). Every query below MUST scope to one underlying — summing
  // across symbols mixes unrelated chains that happen to share an expiry date,
  // which inflates the dollar series and badly skews the positive share.
  const symbol = (searchParams.get('symbol') || '$SPX').trim().toUpperCase();

  const key = `${binMs}|${scope}|${expiryParam}|${session}|${symbol}`;
  const hit = _volFlowCache.get(key);
  if (hit && Date.now() - hit.at < VOLFLOW_TTL_MS) return sendJson(res, 200, hit.payload, req);

  const pool = getHistPool();
  if (!pool) return sendJson(res, 200, { ok: false, reason: 'no-db', expiry: null, binSec, points: [] }, req);

  // ET midnight → epoch ms, computed in SQL so the app server's TZ can't drift
  // it. date_trunc runs on the ET wall clock, then converts back to timestamptz.
  const DAY_START = `(extract(epoch from date_trunc('day', now() AT TIME ZONE 'America/New_York')
                      AT TIME ZONE 'America/New_York') * 1000)::bigint`;

  // RTH clamp on the ET wall clock. Half-days are not special-cased: an early
  // close just means the 13:00–16:00 stretch has no rows, which plots as a
  // shorter session rather than a wrong one.
  const RTH_ONLY = session === 'rth'
    ? `AND (to_timestamp(timestamp / 1000.0) AT TIME ZONE 'America/New_York')::time
             >= TIME '09:30'
       AND (to_timestamp(timestamp / 1000.0) AT TIME ZONE 'America/New_York')::time
             <  TIME '16:00'`
    : '';

  // Every expiry with rows in the selected window, for the panel's expiry
  // chooser. Sent on every response so the picker's options can't drift from
  // what is actually plottable — an expiry that would render an empty chart
  // never appears in the list. Session-filtered, so the row counts shown in the
  // picker match the chart, and so the front derivation below counts only the
  // rows the user is actually looking at.
  const { rows: expRows } = await pool.query(
    `SELECT expiry, COUNT(*)::int AS row_count, MAX(timestamp) AS last_ts
       FROM option_strike_gex_history
      WHERE timestamp >= ${DAY_START}
        ${RTH_ONLY}
        AND (symbol IS NULL OR symbol = $1)
      GROUP BY expiry
      ORDER BY expiry ASC`,
    [symbol]
  );
  const expiries = expRows.map((r) => ({
    expiry: r.expiry,
    rows: Number(r.row_count) || 0,
    lastTs: Number(r.last_ts) || 0,
  }));

  // Front expiry = the expiry the SESSION actually traded, i.e. the one holding
  // the most rows in today's window — NOT the one on the newest snapshot.
  //
  // The newest-snapshot rule is the obvious one and it is wrong here. The feed's
  // front-expiry roll fires AFTER the cash close and sets the expiry to the day
  // that just ended, so on 2026-07-31 every RTH row was written under expiry
  // 2026-07-30 (00:00–16:14, 291k rows) and only the post-close tail carried
  // 2026-07-31 (16:15 on, 100k rows). Deriving from the last snapshot picked the
  // 100k tail and silently dropped the entire session — the chart opened at
  // 4:30 PM with the day's actual flow missing.
  //
  // Row count survives that: the traded session always dominates the after-hours
  // tail, and on a day where the roll behaves the two rules agree. Ties break on
  // the nearer expiry. If the roll is ever fixed upstream this still returns the
  // same answer, so it is safe to leave in place.
  // Derived from the `expiries` list already fetched above rather than a second
  // GROUP BY — same numbers, one less round trip.
  let expiry = expiryParam;
  if (!expiry && scope === 'front') {
    const best = expiries.reduce(
      (m, e) => (m == null || e.rows > m.rows || (e.rows === m.rows && e.expiry < m.expiry) ? e : m),
      /** @type {{expiry:string,rows:number,lastTs:number}|null} */ (null)
    );
    expiry = best?.expiry || '';
  }

  const { rows } = await pool.query(
    `WITH src AS (
       SELECT (timestamp / $1::bigint) * $1::bigint AS bucket_ms,
              timestamp, expiry, strike, spot, net_gex, net_vol_gex
         FROM option_strike_gex_history
        WHERE timestamp >= ${DAY_START}
          ${RTH_ONLY}
          AND ($2 = '' OR expiry = $2)
          AND (symbol IS NULL OR symbol = $3)
     ),
     -- ONE snapshot per (bucket, expiry): the newest write that landed in it.
     -- The writer stamps every strike of a batch with the same instant, so
     -- timestamp = MAX(timestamp) selects exactly that one write's rows.
     --
     -- This replaced a DISTINCT ON (bucket_ms, expiry, strike) … ORDER BY
     -- timestamp DESC, which took the newest row PER STRIKE and therefore
     -- UNIONED the strike sets of every write that landed in the bucket. One
     -- write per slot is the intent (see the grid-slot throttle in
     -- gex-history-writer.js), but a restart, a drifting writer, or a second
     -- process pointed at the same DB breaks that, and the union then carries
     -- strikes from two different spot centres at once. Observed live: 493
     -- distinct strikes in a single 30s bucket where the feed only ever
     -- subscribes ±8% of spot (~250 strikes) — which inflated the dollar series
     -- and pushed the positive share to 87% against the Levels strip's 50%.
     slot AS (
       SELECT bucket_ms, expiry, MAX(timestamp) AS ts
         FROM src
        GROUP BY bucket_ms, expiry
     ),
     latest AS (
       SELECT s.bucket_ms, s.spot, s.net_gex, s.net_vol_gex
         FROM src s
         JOIN slot k
           ON k.bucket_ms = s.bucket_ms
          AND k.expiry = s.expiry
          AND k.ts = s.timestamp
     )
     SELECT bucket_ms,
            MAX(spot)                                AS spot,
            SUM(COALESCE(net_vol_gex, 0))            AS vol_gex,
            SUM(COALESCE(net_gex, 0))                AS oi_gex,
            -- Positive-share legs for the "+GEX %" view on the Vol GEX Flow tab.
            -- Summed over the SAME per-strike rows, in the same pass — the share
            -- has to be built from the strikes, and a signed bucket total can't
            -- be decomposed back into them afterwards.
            --
            -- Basis is net_gex + net_vol_gex, i.e. OI+Vol, NOT net_gex alone.
            -- net_gex is the OI leg ONLY (net_vol_gex is the volume leg; see
            -- gex-history-writer.js and the oiVol() helper in
            -- lib/calculations/calculations.ts). The home Levels strip's
            -- "+GEX %" tile reads netGEXOf(row,'net') = OI+Vol, so summing the
            -- OI leg alone here put the two badly out of step — 75% on the tab
            -- against 26% on the tile, same chain, same minute.
            SUM(GREATEST(COALESCE(net_gex, 0) + COALESCE(net_vol_gex, 0), 0)) AS pos_gex,
            SUM(ABS(COALESCE(net_gex, 0) + COALESCE(net_vol_gex, 0)))         AS abs_gex,
            COUNT(*)::int                            AS strikes
       FROM latest
      GROUP BY bucket_ms
      ORDER BY bucket_ms ASC`,
    [binMs, expiry || '', symbol]
  );

  let prev = null;
  const points = rows.map((r) => {
    const volGex = Number(r.vol_gex) || 0;
    const oiGex = Number(r.oi_gex) || 0;
    const posGex = Number(r.pos_gex) || 0;
    const absGex = Number(r.abs_gex) || 0;
    const p = {
      ts: Number(r.bucket_ms),
      spot: Number(r.spot) || 0,
      volGex,
      oiGex,
      combined: volGex + oiGex,
      // Bucket-over-bucket change in the vol leg — the "flow" of the flow.
      dVol: prev == null ? null : volGex - prev,
      // Share of the bucket's |net GEX| (OI+Vol) that is positive, 0–100. Same
      // definition AND same basis as the home Levels strip's "+GEX %" tile:
      // 100 = pure long-gamma chain, 0 = pure short. null rather than 0 on an
      // empty bucket, so the chart puts a gap there instead of drawing a dive to
      // zero that never happened.
      posGex,
      absGex,
      posPct: absGex > 0 ? (posGex / absGex) * 100 : null,
      strikes: Number(r.strikes) || 0,
    };
    prev = volGex;
    return p;
  });

  const payload = { ok: true, scope, session, symbol, expiry: expiry || null, binSec, expiries, points };
  _volFlowCache.set(key, { at: Date.now(), payload });
  if (_volFlowCache.size > 32) {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [k, v] of _volFlowCache) if (v.at < cutoff) _volFlowCache.delete(k);
  }
  sendJson(res, 200, payload, req);
}

// ── Netprem prewarm ─────────────────────────────────────────────────────────
// Keep the /flow chart's DEFAULT filter keys hot for the common tickers so the
// FIRST viewer of the day hits the incremental cache instead of paying the
// full-session GROUP BY. Runs during RTH only; each tick is an incremental
// refresh after the first. Disable with NETPREM_PREWARM=0.
const NETPREM_PREWARM_TICKERS = (process.env.NETPREM_PREWARM_TICKERS || 'SPX')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
if (process.env.NETPREM_PREWARM !== '0' && NETPREM_PREWARM_TICKERS.length) {
  const prewarmTick = async () => {
    // RTH gate (rough): Mon–Fri 9:25–16:05 ET so the open is already warm.
    const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = et.getDay();
    const mins = et.getHours() * 60 + et.getMinutes();
    if (day === 0 || day === 6 || mins < 9 * 60 + 25 || mins > 16 * 60 + 5) return;
    for (const t of NETPREM_PREWARM_TICKERS) {
      try {
        // Mirrors the /flow page's default filter state: minPremium=50k, OTM only.
        await getNetPremBins({
          date: todayYmdET(), underlying: t, exIdx: false, side: 'all', type: 'all',
          minPremium: 50_000, minSize: 0, expiry: 'all', dteMin: 0, dteMax: null, otmOnly: true,
        }, 60_000);
      } catch { /* pool down / query failed — try again next tick */ }
    }
  };
  const prewarmId = setInterval(prewarmTick, 5000);
  prewarmId.unref?.();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  // Error monitoring + crash guards first, so anything during boot is captured.
  initObservability();

  const app = next({ dev: DEV, dir: ROOT_DIR });
  const handle = app.getRequestHandler();
  await app.prepare();

  // Forward-declared so the request handler can reference the live proxy.
  let proxy = null;

  // Injected deps for the in-process API router (api-router.js). Stateless, so
  // built once. internalFetch mirrors what the old app/api/* thin routes did:
  // hop to this same server's /proxy/* with the internal-token bypass attached.
  const apiCtx = {
    sendJson,
    verifyWsRequest,
    ownerUserId: (process.env.OWNER_USER_ID || '').trim(),
    port: PORT,
    internalToken: process.env.INTERNAL_API_TOKEN,
    internalFetch: (pathname, init = {}) => {
      const headers = { ...(init.headers || {}) };
      if (process.env.INTERNAL_API_TOKEN) headers['x-internal-token'] = process.env.INTERNAL_API_TOKEN;
      return fetch(`http://127.0.0.1:${PORT}${pathname}`, { ...init, headers });
    },
  };

  const server = createServer(async (req, res) => {
    applySecurityHeaders(req, res);
    try {
      // Idle control (POST /proxy/idle { idle: true|false }) — toggles the feed.
      const { pathname } = new URL(req.url || '/', 'http://localhost');

      // ── /proxy/* access gate ────────────────────────────────────────────────
      // middleware.ts excludes /proxy from the Next matcher, so this is the ONLY
      // place these routes get authenticated. Reads → subscriber, writes → owner,
      // a tiny allowlist → public, cron → x-internal-token. No-op unless
      // PROXY_AUTH_REQUIRED=1. Must run before any /proxy/* handling below.
      if (pathname.startsWith('/proxy/')) {
        const verdict = await checkProxyAccess(req, pathname, req.method || 'GET');
        if (!verdict.ok) {
          sendJson(res, verdict.code, { error: verdict.reason });
          return;
        }
      }
      if (pathname === '/proxy/idle' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          let idle = true;
          try { idle = !!JSON.parse(body || '{}').idle; } catch {}
          proxy?.setIdle(idle);
          sendJson(res, 200, { ok: true, idle: marketState.getState().status.idle });
        });
        return;
      }
      if (pathname === '/proxy/idle' && req.method === 'GET') {
        sendJson(res, 200, { idle: marketState.getState().status.idle });
        return;
      }
      // Maintenance mode read/toggle. The Next middleware polls the GET to decide
      // whether to serve /maintenance to non-owner requests.
      //   GET  /proxy/maintenance            → { maintenance }
      //   POST /proxy/maintenance { on: bool } → { maintenance }
      if (pathname === '/proxy/maintenance' && req.method === 'GET') {
        sendJson(res, 200, { maintenance: maintenanceMode });
        return;
      }
      if (pathname === '/proxy/maintenance' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          try { maintenanceMode = !!JSON.parse(body || '{}').on; } catch {}
          console.log(`[SERVER-V2] maintenance mode → ${maintenanceMode ? 'ON' : 'OFF'}`);
          sendJson(res, 200, { maintenance: maintenanceMode });
        });
        return;
      }
      // Manual weekly-levels publish. The auto-publisher only fires Saturday, so
      // this lets you (re)publish on demand — e.g. after editing the ticker list
      // or for the first load — without overwriting on every restart.
      //   POST /proxy/levels-publish   body: { confirm: "PUBLISH" }   // REQUIRED
      //
      // SERVER-SIDE GATE: a full-roster publish overwrites the frozen weekly
      // snapshot the customer /em page reads, so it must NOT be triggerable by a
      // bare POST (deploy hook, curl, an interrupted boot-time run, etc.). The
      // two browser confirm() pop-ups guard the UI; this token guards the wire.
      // Only the gated "Publish Now" buttons send { confirm: "PUBLISH" }.
      if (pathname === '/proxy/levels-publish' && req.method === 'POST') {
        const { runWeeklyWithRetry, isPublishing } = require('./levels-auto-publish');
        if (isPublishing()) { sendJson(res, 200, { started: false, running: true }); return; }
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
        req.on('end', () => {
          let confirm = '';
          try { confirm = String(JSON.parse(raw || '{}').confirm || ''); } catch {}
          if (confirm !== 'PUBLISH') {
            console.log('[levels-pub] manual publish REJECTED — missing/!= confirm token');
            sendJson(res, 400, { started: false, error: 'confirm token required' });
            return;
          }
          // Fire-and-forget: a full-roster publish takes minutes. Kick it off and
          // return immediately; the owner page polls /proxy/levels-status for the
          // result. Errors are captured into lastRun by publishOnce itself.
          // Use runWeeklyWithRetry (not publishOnce) so the weekend stragglers
          // get the same +30m/+2h/+6h/+24h/+36h/+50h backoff the Saturday auto
          // run gets — a bare publishOnce leaves them stale until a manual retry.
          runWeeklyWithRetry(`http://localhost:${PORT}`, 'manual').catch((e) => {
            console.log('[levels-pub] manual run error:', e && e.message);
          });
          sendJson(res, 200, { started: true, running: true });
        });
        return;
      }
      // Retry ONLY the not-found tickers from the last run (no full re-publish).
      // Recomputes just lastRun.failedEm; merges the result so names that now
      // price drop off the list. POST /proxy/levels-retry-failed
      if (pathname === '/proxy/levels-retry-failed' && req.method === 'POST') {
        const { publishOnce, isPublishing, getLastRun } = require('./levels-auto-publish');
        if (isPublishing()) { sendJson(res, 200, { started: false, running: true }); return; }
        const lr = getLastRun();
        const only = Array.isArray(lr?.failedEm)
          ? lr.failedEm.map((f) => (typeof f === 'string' ? f : f && f.ticker)).filter(Boolean)
          : [];
        if (!only.length) { sendJson(res, 200, { started: false, running: false, reason: 'nothing to retry' }); return; }
        publishOnce(`http://localhost:${PORT}`, 'retry', { only }).catch((e) => {
          console.log('[levels-pub] retry run error:', e && e.message);
        });
        sendJson(res, 200, { started: true, running: true, count: only.length });
        return;
      }
      // Last publish-run summary + whether a run is in progress (for the owner
      // page; survives a page refresh, resets on server restart).
      //   GET /proxy/levels-status
      if (pathname === '/proxy/levels-status' && req.method === 'GET') {
        const { getLastRun, isPublishing } = require('./levels-auto-publish');
        sendJson(res, 200, { lastRun: getLastRun() || null, running: isPublishing() });
        return;
      }
      // Reconnect the live TT/dxLink feed in place (stop + start). Recovers from a
      // dropped dxLink socket or expired TT auth without a Render restart.
      //   POST /proxy/reconnect
      if (pathname === '/proxy/reconnect' && req.method === 'POST') {
        if (!proxy || typeof proxy.reconnect !== 'function') {
          sendJson(res, 503, { ok: false, error: 'proxy not ready' });
          return;
        }
        proxy.reconnect()
          .then(() => sendJson(res, 200, { ok: true }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // Manually fire the EOD GEX recorder (the 3:55–4:05 ET window may have been
      // missed, e.g. server was idle/asleep). POST /proxy/eod-gex-run
      if (pathname === '/proxy/eod-gex-run' && req.method === 'POST') {
        const { collectEodGex } = require('./eod-gex-recorder');
        collectEodGex(`http://localhost:${PORT}`, { force: true })
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // ── GEX Levels daily history (forever-persisted key level changes) ────
      //   GET /proxy/gex-levels-history?symbol=$SPX&limit=3650
      if (pathname === '/proxy/gex-levels-history' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./gex-levels-history-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '$SPX').trim();
            const limit = Math.min(10000, Number(u.searchParams.get('limit') || 3650));
            const { rows } = await p.query(
              `SELECT to_char(date, 'YYYY-MM-DD') AS date, symbol, spot, resistance, support,
                      neutral, dollar_gamma, cpg_ratio, r2, s2, open_int, curve,
                      EXTRACT(EPOCH FROM updated_at) * 1000 AS t
               FROM gex_levels_history
               WHERE symbol = $1 ORDER BY date DESC LIMIT $2`,
              [symbol, limit]
            );
            sendJson(res, 200, { ok: true, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // ── Per-strike net GEX across expirations (all + ex-0DTE) ─────────────
      //   GET /proxy/gex-by-strike-multi?symbol=$SPX
      //
      // /proxy/gex above is ONE expiry (0DTE for SPX). This is the same
      // per-strike ladder widened to the whole board, returned twice: every
      // listed expiration, and every listed expiration except the 0DTE one.
      // Feeds the two extra "Net gamma exposure by strike" cards on /test.
      //
      // Both ladders are OI+Vol (gamma × (OI + volume) × spot²) via
      // computeGexRows, so they line up with eod_gex.total_gex_0dte /
      // total_gex_ex0dte and with the 0DTE card already on the page.
      //
      // Cached ~60s server-side (GEX_MULTI_TTL_MS): the sweep is one upstream
      // fetch per expiration, so it must not ride the page's 15s poll.
      if (pathname === '/proxy/gex-by-strike-multi' && req.method === 'GET') {
        (async () => {
          try {
            const { getLiveGexRowsMulti } = require('./eod-gex-recorder');
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '$SPX').trim();
            // Spot comes from the live feed so every ladder on the page shares
            // one underlying price; an explicit ?spot= is honored for testing.
            const st = marketState.getState();
            const spot = Number(u.searchParams.get('spot')) || Number(st.spot) || 0;
            if (!(spot > 0)) { sendJson(res, 503, { ok: false, error: 'no spot yet' }); return; }
            // Session date defines what "0DTE" means; default to today ET.
            const sessionDate = (u.searchParams.get('date') || '').trim() || todayYmdET();
            const payload = await getLiveGexRowsMulti(symbol, sessionDate, spot);
            sendJson(res, 200, { ok: true, ...payload });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // ── Day-over-day GEX movers ──────────────────────────────────────────
      //   GET /proxy/strike-dod?limit=1000
      // Latest session's biggest OI+Vol net-GEX day-over-day mover per ticker
      // (one row per symbol, kept at its intraday peak). Feeds the /test DoD tab.
      if (pathname === '/proxy/strike-dod' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const limit = Math.min(2000, Number(u.searchParams.get('limit') || 1000));
            const dateParam = (u.searchParams.get('date') || '').trim();
            const isDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam);
            // Bucket filter: '' = both 0DTE + SWING; '0DTE'/'SWING' = one.
            const bkt = (u.searchParams.get('bucket') || '').toUpperCase();
            const bktF = (bkt === '0DTE' || bkt === 'SWING') ? bkt : '';
            let rows;
            if (isDate) {
              // Historical snapshot for a specific session: frozen peak columns
              // only. Now/30m/60m/4h are session-relative (now()), so they don't
              // apply to a past date — return null and let the UI hide them.
              ({ rows } = await p.query(
                `SELECT to_char(date,'YYYY-MM-DD') AS date, symbol, bucket, strike, expiry, spot,
                        net_today, net_yest, vol_today, delta, peak_abs,
                        NULL::double precision AS net_now,
                        EXTRACT(EPOCH FROM ts) * 1000 AS t,
                        NULL::double precision AS chg_30m,
                        NULL::double precision AS chg_60m,
                        NULL::double precision AS chg_4h
                 FROM strike_dod_max
                 WHERE date = $1 AND bucket IN ('0DTE','SWING') AND ($3 = '' OR bucket = $3)
                 ORDER BY peak_abs DESC LIMIT $2`,
                [dateParam, limit, bktF]
              ));
            } else {
              // Live (latest session): frozen peak + LIVE Now/30m/60m/4h. For SWING
              // the stored strike spans multiple expiries, so live net is SUMMED
              // across the bucket's expiries (latest snap per expiry), matching how
              // net_today was rolled up. 0DTE sums its single same-day expiry.
              const net = (extra) => `
                SELECT COALESCE(sum(x.net),0) AS n FROM (
                  SELECT DISTINCT ON (sg.expiry) (sg.gex_now + sg.gex_open) AS net
                  FROM strike_growth sg
                  WHERE sg.date=b.date AND sg.symbol=b.symbol AND sg.strike=b.strike
                    AND (CASE WHEN b.bucket='SWING'
                              THEN sg.expiry <> to_char(sg.date,'YYYY-MM-DD')
                              ELSE sg.expiry =  to_char(sg.date,'YYYY-MM-DD') END)
                    ${extra}
                  ORDER BY sg.expiry, sg.ts DESC
                ) x`;
              ({ rows } = await p.query(
                `WITH base AS (
                   SELECT * FROM strike_dod_max
                   WHERE date = (SELECT max(date) FROM strike_dod_max)
                     AND bucket IN ('0DTE','SWING') AND ($2 = '' OR bucket = $2)
                 )
                 SELECT to_char(b.date,'YYYY-MM-DD') AS date, b.symbol, b.bucket, b.strike, b.expiry, b.spot,
                        b.net_today, b.net_yest, b.vol_today, b.delta, b.peak_abs,
                        nn.n AS net_now,
                        EXTRACT(EPOCH FROM b.ts) * 1000 AS t,
                        (nn.n - l30.n)  AS chg_30m,
                        (nn.n - l60.n)  AS chg_60m,
                        (nn.n - l240.n) AS chg_4h
                 FROM base b
                 LEFT JOIN LATERAL (${net(``)}) nn ON true
                 LEFT JOIN LATERAL (${net(`AND sg.ts <= now() - interval '30 minutes'`)})  l30  ON true
                 LEFT JOIN LATERAL (${net(`AND sg.ts <= now() - interval '60 minutes'`)})  l60  ON true
                 LEFT JOIN LATERAL (${net(`AND sg.ts <= now() - interval '240 minutes'`)}) l240 ON true
                 ORDER BY b.peak_abs DESC LIMIT $1`,
                [limit, bktF]
              ));
            }
            sendJson(res, 200, { ok: true, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Available sessions for the DoD date picker (newest first, with row count).
      //   GET /proxy/strike-dod-dates
      if (pathname === '/proxy/strike-dod-dates' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const { rows } = await p.query(
              `SELECT to_char(date,'YYYY-MM-DD') AS date, count(*)::int AS n
               FROM strike_dod_max GROUP BY date ORDER BY date DESC LIMIT 400`
            );
            sendJson(res, 200, { ok: true, dates: rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Per-ticker multi-day history: each day's frozen peak mover for one symbol.
      //   GET /proxy/strike-dod-history?symbol=NVDA&limit=120
      if (pathname === '/proxy/strike-dod-history' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            if (!symbol) { sendJson(res, 400, { ok: false, error: 'symbol required' }); return; }
            const limit = Math.min(365, Number(u.searchParams.get('limit') || 120));
            const hb = (u.searchParams.get('bucket') || '').toUpperCase();
            const hbF = (hb === '0DTE' || hb === 'SWING') ? hb : '0DTE';
            const { rows } = await p.query(
              `SELECT to_char(date, 'YYYY-MM-DD') AS date, bucket, strike, expiry, spot,
                      net_today, net_yest, vol_today, delta, peak_abs
               FROM strike_dod_max WHERE symbol = $1 AND bucket = $3
               ORDER BY date DESC LIMIT $2`,
              [symbol, limit, hbF]
            );
            sendJson(res, 200, { ok: true, symbol, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Per-symbol, per-STRIKE day-over-day growth: EVERY strike for one ticker
      // with its prior-session net GEX vs the latest snapshot, so you can see
      // WHICH strike is growing (not just the single top mover strike_dod_max
      // keeps). Computed live from strike_growth using the same 0DTE/SWING
      // predicate + (gex_now+gex_open) basis as rollupDayOverDay.
      //   GET /proxy/strike-dod-strikes?symbol=NVDA&bucket=0DTE&floor=50000000&limit=400
      if (pathname === '/proxy/strike-dod-strikes' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            if (!symbol) { sendJson(res, 400, { ok: false, error: 'symbol required' }); return; }
            const bk = (u.searchParams.get('bucket') || '0DTE').toUpperCase();
            // Same self-classifying predicate rollupDayOverDay uses (row vs ITS date).
            const pred = bk === 'SWING'
              ? `expiry <> to_char(date,'YYYY-MM-DD')`
              : `expiry =  to_char(date,'YYYY-MM-DD')`;
            // Min |net_yest| a strike needs before we report a % (tiny bases → fake 900%).
            const floor = Math.max(0, Number(u.searchParams.get('floor') || 50e6));
            const limit = Math.min(1000, Number(u.searchParams.get('limit') || 400));
            const { rows } = await p.query(
              `WITH cur_d AS (
                 SELECT max(date) AS d FROM strike_growth WHERE symbol=$1 AND ${pred}
               ),
               prev_d AS (
                 SELECT max(date) AS d FROM strike_growth
                 WHERE symbol=$1 AND ${pred} AND date < (SELECT d FROM cur_d)
               ),
               cur_e AS (
                 SELECT DISTINCT ON (expiry, strike) strike, expiry, spot,
                        (gex_now + gex_open) AS net, gex_now AS vol
                 FROM strike_growth
                 WHERE symbol=$1 AND date=(SELECT d FROM cur_d) AND ${pred}
                 ORDER BY expiry, strike, ts DESC
               ),
               prev_e AS (
                 SELECT DISTINCT ON (expiry, strike) strike, (gex_now + gex_open) AS net
                 FROM strike_growth
                 WHERE symbol=$1 AND date=(SELECT d FROM prev_d) AND ${pred}
                 ORDER BY expiry, strike, ts DESC
               ),
               cur AS (
                 SELECT strike, max(spot) AS spot, sum(net) AS net_now,
                        sum(vol) AS vol_today, min(expiry) AS expiry
                 FROM cur_e GROUP BY strike
               ),
               prev AS ( SELECT strike, sum(net) AS net_yest FROM prev_e GROUP BY strike )
               SELECT c.strike, c.expiry, c.spot, c.net_now,
                      COALESCE(pv.net_yest, 0) AS net_yest, c.vol_today,
                      (c.net_now - COALESCE(pv.net_yest, 0)) AS delta,
                      CASE WHEN abs(COALESCE(pv.net_yest, 0)) >= $2
                           THEN (c.net_now - pv.net_yest) / abs(pv.net_yest) * 100
                           ELSE NULL END AS growth_pct,
                      (pv.net_yest IS NULL) AS is_new,
                      (SELECT to_char(d,'YYYY-MM-DD') FROM cur_d)  AS date,
                      (SELECT to_char(d,'YYYY-MM-DD') FROM prev_d) AS prev_date
               FROM cur c LEFT JOIN prev pv USING (strike)
               ORDER BY abs(c.net_now - COALESCE(pv.net_yest, 0)) DESC
               LIMIT $3`,
              [symbol, floor, limit]
            );
            sendJson(res, 200, { ok: true, symbol, bucket: bk, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Manual fire (testing): POST /proxy/gex-levels-history-run
      if (pathname === '/proxy/gex-levels-history-run' && req.method === 'POST') {
        const { collectGexLevelsHistory } = require('./gex-levels-history-recorder');
        collectGexLevelsHistory(`http://localhost:${PORT}`, { force: true })
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // ── Earnings calendar (weekly, mcap ≥ $100B) ─────────────────────────
      //   GET /proxy/earnings-week  → today → Friday, one row per name
      if (pathname === '/proxy/earnings-week' && req.method === 'GET') {
        (async () => {
          try {
            const { getWeekRows, MIN_MCAP } = require('./earnings-calendar-recorder');
            const rows = await getWeekRows();
            sendJson(res, 200, { ok: true, minMcap: MIN_MCAP, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Logo resolver: GET /proxy/ticker-logo?sym=ASML&name=ASML+Holding
      // 302 → transparent PNG (ticker-logos repo, else Wikidata/Commons P154).
      if (pathname === '/proxy/ticker-logo' && req.method === 'GET') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const sym = (u.searchParams.get('sym') || '').toUpperCase().trim();
            const name = u.searchParams.get('name') || '';
            const url = await require('./ticker-logo').resolveLogo(sym, name);
            if (!url) { res.writeHead(404); res.end('no logo'); return; }
            res.writeHead(302, { Location: url, 'Cache-Control': 'public, max-age=86400' });
            res.end();
          } catch (e) { res.writeHead(502); res.end(String(e?.message || e)); }
        })();
        return;
      }
      // Manual fire: POST /proxy/earnings-week-run?week=this|next
      if (pathname === '/proxy/earnings-week-run' && req.method === 'POST') {
        const u = new URL(req.url, `http://localhost:${PORT}`);
        const week = u.searchParams.get('week') === 'next' ? 'next' : 'this';
        require('./earnings-calendar-recorder').runSweep(week)
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // ── Daily open-interest snapshot ─────────────────────────────────────
      // Day-over-day ΔOI per (expiry, strike) for one symbol. Backs the
      // Options Chain page's OI tab.
      //   GET /proxy/oi-change?symbol=SPX[&expiries=2026-07-28,2026-07-29]
      // Returns { ok, symbol, date, prevDate, rows:[{expiry,strike,callOI,
      // putOI,callChg,putChg,hadPrev}] }. date/prevDate are the two most recent
      // snapshot DATES that exist for the symbol — not calendar today/yesterday
      // — so a holiday or a missed 9:32 run degrades to "compare against the
      // last day we actually have" instead of returning nothing. Before the
      // second snapshot ever lands, prevDate is null and every change reads 0.
      if (pathname === '/proxy/oi-change' && req.method === 'GET') {
        (async () => {
          try {
            const { getOiChange } = require('./oi-daily-recorder');
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            if (!symbol) { sendJson(res, 400, { ok: false, error: 'symbol required' }); return; }
            const expParam = (u.searchParams.get('expiries') || '').trim();
            const expiries = expParam
              ? expParam.split(',').map((s) => s.trim().slice(0, 10)).filter(Boolean)
              : null;
            const out = await getOiChange(symbol, expiries);
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Manual fire of the daily OI sweep (normally automatic at 9:32 ET).
      // Safe to re-run: writes are upserts keyed (date,symbol,expiry,strike).
      //   POST /proxy/oi-daily-run[?symbol=SPX][&date=YYYY-MM-DD]
      if (pathname === '/proxy/oi-daily-run' && req.method === 'POST') {
        (async () => {
          try {
            const { runSweep } = require('./oi-daily-recorder');
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const one = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            const date = (u.searchParams.get('date') || '').trim() || null;
            const out = await runSweep({ ...(one ? { symbols: [one] } : {}), date });
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // ── End-of-day per-strike GEX snapshot ───────────────────────────────
      //
      // ── `basis` (all four read routes) ───────────────────────────────────
      // Every route below takes an optional &basis= choosing WHICH number the
      // ladder is made of. Anything unrecognised reads as `oivol`, the original
      // behaviour, so an old client keeps working byte-for-byte.
      //
      //   oivol (default) — |gamma| x (OI + volume). The legacy series, ~a year
      //                     of history. Its LEVEL is what every other surface
      //                     in the app prints. Its Δ double-counts a session:
      //                     OI at 16:05 is settled through the PREVIOUS close
      //                     while volume is today's, so the diff adds
      //                     ΔOI(T-1) and subtracts Vol(T-1) — the same
      //                     session's trading, once net and once gross. Kept as
      //                     the default anyway; the page labels it.
      //   oi              — |gamma| x open interest, re-stamped next morning
      //                     off the settled file. Both sides of a diff are then
      //                     settled and the Δ is a true ΔOI. The honest
      //                     structural read. Response carries oiSettled /
      //                     prevOiSettled so a caller can tell whether the
      //                     re-stamp actually reached both sides.
      //   vol             — |gamma| x volume. Same-session by construction, so
      //                     the LEVEL ("how much gamma traded today") is the
      //                     read; its Δ is a second difference.
      //   flow            — signed DEALER INVENTORY x gamma, from classified
      //                     prints in flow_prints. The only basis that knows
      //                     direction rather than assuming it. SPX/SPY/QQQ
      //                     only, premium-floored, and for SPY/QQQ limited to
      //                     the near-spot front-expiry window the streamer
      //                     subscribes to — read getFlowLadder()'s four
      //                     caveats in the recorder before trusting it.
      //
      // ── `leg` (all four read routes) ─────────────────────────────────────
      // Orthogonal to basis: basis picks the contract count, leg picks which
      // option type's gamma. net (default) | call | put. Unrecognised → net.
      //
      // What the sign means DIFFERS by basis, and the difference is the point:
      //   oivol/oi/vol — legs are signed by CONVENTION, so call is always >= 0
      //     and put always <= 0 at every strike. A single-leg ladder there
      //     shows WHERE that type's gamma sits; it cannot cross zero and has
      //     no flip. Splitting the net is how you tell "the call wall came
      //     off" from "put gamma piled on", which the sum cannot.
      //   flow — legs are signed by MEASUREMENT, so either can take either
      //     sign. "Dealers are short call gamma at 6400 and long put gamma at
      //     6300" is a sentence only this basis can produce.
      //
      // The rail ranks on the same column the ladder draws. The structural
      // BADGES (flip, walls, sign flips) deliberately stay on the NET column
      // whatever the leg — they are properties of the two legs together, and a
      // monotonic single-leg running total has no crossing to find.
      //
      // On basis=flow the change route additionally returns the four GROSS
      // components per strike (callBuyGex/callSellGex/putBuyGex/putSellGex,
      // plus their prev twins) and `hasGross`. flow_call_gex is a net of two
      // opposite events, so a strike where the dealer bought 5k and sold 5k
      // nets to zero and reads identically to one nothing traded at; the gross
      // split takes that ambiguity back out. They are additive:
      // callBuy + callSell = the call leg, all four = flow_gex.
      //
      // ── WHEN WAS IT RUN ──────────────────────────────────────────────────
      // Every response carries `capturedAt` (and `prevCapturedAt` on the change
      // route) resolved FOR THE ACTIVE BASIS — not the row's write clock.
      //
      // This matters because the four bases are four reads of different sources
      // at different moments, and two of them can be a full session apart
      // INSIDE ONE ROW: `vol` was captured at the 16:05 chain sweep, while
      // `oi` on that same row was re-read from the settled OCC file at 09:25
      // the next morning. There is no single "when was this row run".
      //
      //   oivol / vol  → captured_at        (chain read start for that symbol)
      //   oi           → oi_captured_at, else captured_at while provisional
      //   flow         → flow_captured_at   (the flow_prints aggregate)
      // all falling back to `ts` for rows written before these columns existed.
      //
      // Read START, not write finish: a symbol whose sweep takes 40s describes
      // the book as of when the fetch went out. The board route carries a
      // per-SYMBOL `capturedAt` for the same reason — the sweep paces across
      // ~169 names over several minutes, so they genuinely differ.
      //
      // Responses echo `basis` and `leg` and carry `hasBasis`. hasBasis=false
      // means the reading has NOTHING recorded for that session/symbol — a zero
      // board and an unrecorded board are indistinguishable once COALESCEd, and
      // the difference matters, so callers must branch on the flag not the
      // values. `hasGross` is the same statement for the gross split, which has
      // its own (later) migration date than the flow net.
      //
      // Day-over-day ΔGEX per strike for one symbol, whole board ex-0DTE.
      // Backs the Ticker Lookup card's Δ column.
      //   GET /proxy/eod-strike-gex-change?symbol=NVDA[&date=YYYY-MM-DD][&basis=oi]
      // Returns { ok, symbol, date, prevDate, spot, prevSpot, rows:[{strike,
      // netGex, prevNetGex, chg, hadPrev}] }. date/prevDate are the two most
      // recent snapshot DATES that exist for the symbol — not calendar
      // today/yesterday — so a holiday, a long weekend or a missed 16:05 run
      // degrades to "compare against the last session we actually have"
      // instead of returning nothing. Before the second snapshot ever lands,
      // prevDate is null and every chg reads 0.
      //
      // `date` is an AS-OF, not an exact match: the latest snapshot on or
      // before it, and the one before that. Omitted → latest, byte-for-byte the
      // behaviour this endpoint had before the param existed. A malformed value
      // is ignored rather than 400'd (normDate in the recorder) — this is a URL
      // a reader can type, and falling back to latest is the safe read.
      if (pathname === '/proxy/eod-strike-gex-change' && req.method === 'GET') {
        (async () => {
          try {
            const { getStrikeGexChange } = require('./eod-strike-gex-recorder');
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            if (!symbol) { sendJson(res, 400, { ok: false, error: 'symbol required' }); return; }
            const out = await getStrikeGexChange(symbol, {
              date: u.searchParams.get('date'),
              basis: u.searchParams.get('basis'),
              leg: u.searchParams.get('leg'),
            });
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Whole-board ranking for the owner ΔGEX page: every symbol, its net Δ
      // and its top N strikes by |Δ|, in ONE query.
      //   GET /proxy/eod-strike-gex-board?top=5[&date=YYYY-MM-DD]
      // Returns { ok, top, date, symbols:[{symbol,date,prevDate,spot,net,absTot,
      // strikes:[{strike,chg}],gexNet,gexAbs,gexStrikes:[{strike,gex}]}] }
      // sorted by |absTot| desc. Each symbol is diffed against ITS OWN two
      // latest snapshot dates — a name added to the roster last week, or one
      // whose chain failed at 16:05, has a different pair than the rest, and a
      // board-wide date would show it as flat.
      //
      // The gex* fields are the ABSOLUTE per-strike level at `date`, alongside
      // the Δ. Both ship in one response because the board switches between the
      // two views client-side and a mode toggle must not cost a round trip.
      // `date` is an AS-OF, same as the change endpoint.
      if (pathname === '/proxy/eod-strike-gex-board' && req.method === 'GET') {
        (async () => {
          try {
            const { getStrikeGexBoard } = require('./eod-strike-gex-recorder');
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const out = await getStrikeGexBoard(
              Number(u.searchParams.get('top') || 5),
              {
                date: u.searchParams.get('date'),
                basis: u.searchParams.get('basis'),
                leg: u.searchParams.get('leg'),
              },
            );
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Which sessions are on file, newest first — populates the board's date
      // picker. Retention is ~400 days, so this is the whole recorded history.
      //   GET /proxy/eod-strike-gex-dates[?limit=90]
      // Returns { ok, dates:['YYYY-MM-DD', …] }.
      if (pathname === '/proxy/eod-strike-gex-dates' && req.method === 'GET') {
        (async () => {
          try {
            const { listStrikeGexDates } = require('./eod-strike-gex-recorder');
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const out = await listStrikeGexDates(
              Number(u.searchParams.get('limit') || 90),
              { basis: u.searchParams.get('basis'), leg: u.searchParams.get('leg') },
            );
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // The same per-strike ladder, but with the "now" side computed LIVE off
      // the chain instead of read out of eod_strike_gex. Prior side is the
      // symbol's most recent RECORDED close. Backs the ΔGEX Board's Live toggle
      // on the Prior → now tab.
      //   GET /proxy/eod-strike-gex-live?symbol=NVDA[&force=1]
      // Returns the getStrikeGexChange shape plus { live:true, asOf, cached,
      // ageMs, expiryCount, prevIsToday, marketDay }.
      //
      // READ-ONLY: it never writes to eod_strike_gex. An intraday row there
      // would become tomorrow's Δ baseline and corrupt the recorded series.
      //
      // ONE SYMBOL ONLY, and no board-wide equivalent by design — this re-runs
      // every listed expiry for the name, which is one slice of the nightly
      // sweep. The recorder caches it per symbol for a minute and de-dupes
      // concurrent callers; `force=1` skips the cache (the client's ↻) but
      // still joins an in-flight sweep rather than starting a second one.
      if (pathname === '/proxy/eod-strike-gex-live' && req.method === 'GET') {
        (async () => {
          try {
            const { getStrikeGexLive } = require('./eod-strike-gex-recorder');
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            if (!symbol) { sendJson(res, 400, { ok: false, error: 'symbol required' }); return; }
            const force = /^(1|true|yes)$/i.test(u.searchParams.get('force') || '');
            const out = await getStrikeGexLive(symbol, {
              force,
              basis: u.searchParams.get('basis'),
              leg: u.searchParams.get('leg'),
            });
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Manual fire of the EOD per-strike GEX sweep (normally automatic at
      // 16:05 ET). Safe to re-run: the day's rows for each symbol are cleared
      // and rewritten, so a re-fire replaces the window rather than unioning
      // two of them.
      //   POST /proxy/eod-strike-gex-run[?symbol=NVDA][&date=YYYY-MM-DD]
      if (pathname === '/proxy/eod-strike-gex-run' && req.method === 'POST') {
        (async () => {
          try {
            const { runSweep } = require('./eod-strike-gex-recorder');
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const one = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            const date = (u.searchParams.get('date') || '').trim() || null;
            const out = await runSweep({ ...(one ? { symbols: [one] } : {}), date });
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Manual fire of the morning OI re-stamp (normally automatic at 09:25 ET).
      //   POST /proxy/eod-strike-gex-restamp[?symbol=NVDA][&date=YYYY-MM-DD]
      //
      // Rewrites the oi_* columns of the LATEST RECORDED SESSION (or `date`)
      // off the settled OI file now on the chain, and stamps oi_stamped_date.
      // Touches nothing else — net_gex, call_gex, put_gex and vol_* are the
      // evening's record of a settled close and stay exactly as they were.
      //
      // Safe to re-run: it is an UPDATE keyed on (date, symbol, strike) and
      // never inserts, so a second fire writes the same numbers again.
      //
      // REFUSES a date >= today ET. Today's open interest does not settle until
      // tonight, so stamping today's rows would put a false "settled" marker on
      // the one fact the oi basis depends on being true.
      if (pathname === '/proxy/eod-strike-gex-restamp' && req.method === 'POST') {
        (async () => {
          try {
            const { runOiRestamp } = require('./eod-strike-gex-recorder');
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const one = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            const date = (u.searchParams.get('date') || '').trim() || null;
            const out = await runOiRestamp({ ...(one ? { symbols: [one] } : {}), date });
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // ── Strike-growth tracker ────────────────────────────────────────────
      // Ranked latest snapshot: which strikes grew most vs today's open.
      //   GET /proxy/strike-growth?min=0&type=all&symbol=NVDA&limit=200
      if (pathname === '/proxy/strike-growth' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            const side = (u.searchParams.get('type') || 'all').toLowerCase(); // all|call|put
            const minAbs = Number(u.searchParams.get('min') || 0);
            const limit = Math.min(1000, Number(u.searchParams.get('limit') || 200));
            // Latest ts per (date,symbol) today; rank by |delta_abs| desc.
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
            const params = [today];
            // Qualify with sg.* — the LATERAL joins below add tables that also
            // have symbol/strike/spot, so unqualified refs are ambiguous (502).
            let sideFilter = '';
            if (side === 'call') sideFilter = 'AND sg.strike >= sg.spot';
            else if (side === 'put') sideFilter = 'AND sg.strike < sg.spot';
            let symFilter = '';
            if (symbol) { params.push(symbol); symFilter = `AND sg.symbol = $${params.length}`; }
            params.push(minAbs); const minIdx = params.length;
            params.push(limit); const limIdx = params.length;
            // chg15/30/60 = Δ in volume-only Now GEX over the trailing window.
            // For each latest strike row we find the snapshot for that same
            // (symbol,strike) whose ts is closest to (latest.ts − N min) and
            // subtract its gex_now. LATERAL keeps it per-row and indexed.
            const lookback = (mins, alias) => `
              LEFT JOIN LATERAL (
                SELECT h.gex_now FROM strike_growth h
                WHERE h.date = $1 AND h.symbol = sg.symbol AND h.strike = sg.strike
                  AND h.ts <= sg.ts - INTERVAL '${mins} minutes'
                ORDER BY h.ts DESC LIMIT 1
              ) ${alias} ON TRUE`;
            const sql = `
              WITH latest AS (
                SELECT symbol, MAX(ts) AS ts FROM strike_growth
                WHERE date = $1 GROUP BY symbol
              )
              SELECT sg.symbol, sg.strike, sg.expiry, sg.gex_now, sg.gex_open,
                     sg.delta_abs, sg.delta_pct, sg.spot, sg.ts,
                     (sg.gex_now - b15.gex_now) AS chg15,
                     (sg.gex_now - b30.gex_now) AS chg30,
                     (sg.gex_now - b60.gex_now) AS chg60
              FROM strike_growth sg
              JOIN latest l ON l.symbol = sg.symbol AND l.ts = sg.ts
              ${lookback(15, 'b15')}
              ${lookback(30, 'b30')}
              ${lookback(60, 'b60')}
              WHERE sg.date = $1 ${symFilter} ${sideFilter}
                AND ABS(sg.delta_abs) >= $${minIdx}
              ORDER BY ABS(sg.delta_abs) DESC
              LIMIT $${limIdx}`;
            const { rows } = await p.query(sql, params);
            sendJson(res, 200, { ok: true, date: today, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Intraday series for one strike (sparkline).
      //   GET /proxy/strike-growth/series?symbol=NVDA&strike=180
      if (pathname === '/proxy/strike-growth/series' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            const strike = Number(u.searchParams.get('strike') || 0);
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
            const { rows } = await p.query(
              `SELECT ts, gex_now, delta_abs FROM strike_growth
               WHERE date = $1 AND symbol = $2 AND strike = $3 ORDER BY ts ASC`,
              [today, symbol, strike]
            );
            sendJson(res, 200, { ok: true, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // ── Replay: metadata (which symbols/dates are replay-able) ───────────
      //   GET /proxy/strike-growth/replay-meta[?symbol=MSFT]
      // symbols = distinct recorded roots within the strike_growth retention
      // window; dates = distinct session dates for ?symbol (newest first).
      if (pathname === '/proxy/strike-growth/replay-meta' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            const symsQ = await p.query(
              `SELECT DISTINCT symbol FROM strike_growth
               WHERE date::date >= CURRENT_DATE - INTERVAL '7 days'
               ORDER BY symbol ASC`
            );
            let dates = [];
            if (symbol) {
              const dQ = await p.query(
                `SELECT DISTINCT date FROM strike_growth
                 WHERE symbol = $1 AND date::date >= CURRENT_DATE - INTERVAL '7 days'
                 ORDER BY date DESC`,
                [symbol]
              );
              dates = dQ.rows.map((r) => r.date);
            }
            sendJson(res, 200, { ok: true, symbols: symsQ.rows.map((r) => r.symbol), dates });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // ── Replay: per-strike net-GEX frames for one symbol+date ────────────
      //   GET /proxy/strike-growth/frames?symbol=MSFT[&date=YYYY-MM-DD]
      // One frame per snapshot ts: { ts, spot, strikes:[{strike, net}] } where
      // net = total net GEX (gex_now + gex_open), summed across expiries at the
      // strike. Drives the /replay time-scrubber. Defaults to today (ET).
      if (pathname === '/proxy/strike-growth/frames' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            if (!symbol) { sendJson(res, 400, { ok: false, error: 'symbol required' }); return; }
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
            const date = (u.searchParams.get('date') || today).trim();
            // front_expiry / n_expiry ride along on the same grouped scan so the
            // replay stamp can label which expiry the frame covers (the front
            // active one can roll intraday) without a second round-trip.
            const { rows } = await p.query(
              `SELECT ts, strike, MAX(spot) AS spot, SUM(gex_now + gex_open) AS net,
                      MIN(expiry) AS front_expiry, COUNT(DISTINCT expiry) AS n_expiry
               FROM strike_growth
               WHERE date = $1 AND symbol = $2
               GROUP BY ts, strike
               ORDER BY ts ASC, strike ASC`,
              [date, symbol]
            );
            const byTs = new Map();
            const allExp = new Set();
            for (const r of rows) {
              const k = new Date(r.ts).toISOString();
              let f = byTs.get(k);
              if (!f) { f = { ts: k, spot: Number(r.spot) || 0, strikes: [], expiry: null, expiryCount: 0 }; byTs.set(k, f); }
              f.strikes.push({ strike: Number(r.strike), net: Number(r.net) || 0 });
              const exp = r.front_expiry == null ? null : String(r.front_expiry);
              if (exp) {
                allExp.add(exp);
                if (!f.expiry || exp < f.expiry) f.expiry = exp;
              }
              f.expiryCount = Math.max(f.expiryCount, Number(r.n_expiry) || 0);
            }
            sendJson(res, 200, {
              ok: true, symbol, date,
              expiries: Array.from(allExp).sort(),
              frames: Array.from(byTs.values()),
            });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // ── Replay: per-EXPIRY frames for one symbol+date ────────────────────
      //   GET /proxy/strike-growth/frames-by-expiry?symbol=NVDA[&date=YYYY-MM-DD]
      // Drives the Options Chain page's in-grid replay mode. The /frames route
      // above sums every expiry into one ladder, which is right for a single
      // ladder and wrong for a grid whose columns ARE expiries — so this one
      // keeps them apart.
      //
      // Payload is deliberately positional (`cells: [expiryIdx, strike, net,
      // vol]`) rather than an array of objects: a busy session is ~200 frames ×
      // 3 expiries × 30 strikes, and object keys repeated 18k times is most of
      // the response. `expiries` is the index table.
      //   net = gex_now + gex_open (OI + volume, matches the chain's OI+Vol view)
      //   vol = gex_now            (today's traded volume only, the Vol Only view)
      if (pathname === '/proxy/strike-growth/frames-by-expiry' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            if (!symbol) { sendJson(res, 400, { ok: false, error: 'symbol required' }); return; }
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
            const date = (u.searchParams.get('date') || today).trim();
            // One row per (ts, expiry, strike) — that's the table's PK grain, so
            // the aggregates only ever fold a single row. Kept as aggregates to
            // stay identical in shape to /frames above if the PK ever widens.
            const { rows } = await p.query(
              `SELECT ts, expiry, strike, MAX(spot) AS spot,
                      SUM(gex_now + gex_open) AS net, SUM(gex_now) AS vol
                 FROM strike_growth
                WHERE date = $1 AND symbol = $2
                GROUP BY ts, expiry, strike
                ORDER BY ts ASC, expiry ASC, strike ASC`,
              [date, symbol]
            );
            const expIdx = new Map();   // expiry -> index into `expiries`
            const expiries = [];
            const byTs = new Map();
            for (const r of rows) {
              const exp = String(r.expiry ?? '');
              if (!exp) continue;
              let ei = expIdx.get(exp);
              if (ei === undefined) { ei = expiries.length; expIdx.set(exp, ei); expiries.push(exp); }
              const k = new Date(r.ts).toISOString();
              let f = byTs.get(k);
              if (!f) { f = { ts: k, spot: Number(r.spot) || 0, cells: [] }; byTs.set(k, f); }
              // spot is per-sweep, so every row in a frame carries the same one;
              // take the first non-zero rather than trusting row order.
              if (!(f.spot > 0)) f.spot = Number(r.spot) || 0;
              f.cells.push([ei, Number(r.strike), Number(r.net) || 0, Number(r.vol) || 0]);
            }
            // Expiries in date order, with the frame cells re-pointed at the
            // sorted index — the grid renders columns left-to-right by date and
            // should not have to sort a parallel array to do it.
            const sorted = [...expiries].sort();
            const remap = new Map(expiries.map((e, i) => [i, sorted.indexOf(e)]));
            const frames = Array.from(byTs.values()).map((f) => ({
              ts: f.ts, spot: f.spot,
              cells: f.cells.map(([ei, k, net, vol]) => [remap.get(ei), k, net, vol]),
            }));
            sendJson(res, 200, { ok: true, symbol, date, expiries: sorted, frames });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // All-expiry change map for the options-chain change-mode overlay.
      //   GET /proxy/strike-growth/by-expiry?symbol=NVDA
      // Returns latest snapshot per (expiry,strike) with chg15/30/60 (volume-GEX
      // Δ over the trailing window). Lets the chain color every expiry column.
      if (pathname === '/proxy/strike-growth/by-expiry' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            if (!symbol) { sendJson(res, 400, { ok: false, error: 'symbol required' }); return; }
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
            // Latest ts per (symbol,expiry) today, then per-strike chg lookbacks.
            const lookback = (mins, alias) => `
              LEFT JOIN LATERAL (
                SELECT h.gex_now FROM strike_growth h
                WHERE h.date = $1 AND h.symbol = sg.symbol AND h.expiry = sg.expiry
                  AND h.strike = sg.strike AND h.ts <= sg.ts - INTERVAL '${mins} minutes'
                ORDER BY h.ts DESC LIMIT 1
              ) ${alias} ON TRUE`;
            const sql = `
              WITH latest AS (
                SELECT symbol, expiry, MAX(ts) AS ts FROM strike_growth
                WHERE date = $1 AND symbol = $2 GROUP BY symbol, expiry
              )
              SELECT sg.expiry, sg.strike, sg.gex_now, sg.delta_abs, sg.spot,
                     (sg.gex_now - b15.gex_now) AS chg15,
                     (sg.gex_now - b30.gex_now) AS chg30,
                     (sg.gex_now - b60.gex_now) AS chg60
              FROM strike_growth sg
              JOIN latest l ON l.symbol = sg.symbol AND l.expiry = sg.expiry AND l.ts = sg.ts
              ${lookback(15, 'b15')}
              ${lookback(30, 'b30')}
              ${lookback(60, 'b60')}
              WHERE sg.date = $1 AND sg.symbol = $2`;
            const { rows } = await p.query(sql, [today, symbol]);
            sendJson(res, 200, { ok: true, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // GEX% split — positive vs negative share of net GEX, per ticker, for the
      // front N expiries. Feeds the scanner's "GEX%" tab.
      //   GET /proxy/strike-growth/gex-pct[&expiries=3][&date=YYYY-MM-DD]
      // net = gex_now + gex_open (the same "net" frames/rollups use). Per
      // (symbol,expiry) at that expiry's LATEST snapshot today:
      //   pos_gex = Σ net where net>0   neg_gex = Σ net where net<0 (negative)
      //   pos_pct = pos/(pos+|neg|)·100 — computed client-side off these sums.
      // BOTH bases ship in every response: pos_gex/neg_gex are OI+Vol (net) and
      // pos_vol/neg_vol are today's traded gamma alone (gex_now). The tab's
      // basis switcher flips between them client-side — no second round trip.
      // NOTE the recorder only stores the top STRIKE_GROWTH_TOP_N strikes per
      // side, so this is the split across the strikes that carry the exposure,
      // not a whole-chain figure. n_strikes is returned so the UI can say so.
      // Falls back to the most recent recorded date when today is empty
      // (pre-open / weekend), and reports which date it used.
      if (pathname === '/proxy/strike-growth/gex-pct' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
            const asOf = (u.searchParams.get('date') || today).trim();
            const nExp = Math.max(1, Math.min(10, Number(u.searchParams.get('expiries') || 3)));
            const sql = `
              WITH d AS (
                SELECT MAX(date) AS date FROM strike_growth WHERE date <= $1
              ),
              -- Each symbol's most recent successful sweep. Every expiry in a
              -- sweep shares one ts (see the recorder's sweep loop), so this
              -- pins "as of now" per symbol.
              sym_latest AS (
                SELECT sg.symbol, MAX(sg.ts) AS ts
                FROM strike_growth sg
                JOIN strike_growth_watchlist w
                  ON w.symbol = sg.symbol AND w.active
                CROSS JOIN d
                WHERE sg.date = d.date
                GROUP BY sg.symbol
              ),
              -- Only the expiries present in THAT sweep. Ranking over every
              -- expiry seen today instead lets one that has since rolled off (a
              -- 0DTE that expired, a ticker whose front three moved) keep slot 1
              -- with stale numbers AND pushes the real third expiry past the cut.
              current_exp AS (
                SELECT DISTINCT sg.symbol, sg.expiry, sg.ts
                FROM strike_growth sg
                JOIN sym_latest sl ON sl.symbol = sg.symbol AND sl.ts = sg.ts
                WHERE sg.date = (SELECT date FROM d)
              ),
              ranked AS (
                SELECT symbol, expiry, ts,
                       ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY expiry ASC) AS exp_idx
                FROM current_exp
              )
              SELECT sg.symbol,
                     sg.expiry,
                     r.exp_idx,
                     MAX(sg.spot) AS spot,
                     MAX(sg.ts)   AS ts,
                     COALESCE(SUM(CASE WHEN (sg.gex_now + sg.gex_open) > 0
                                       THEN (sg.gex_now + sg.gex_open) END), 0) AS pos_gex,
                     COALESCE(SUM(CASE WHEN (sg.gex_now + sg.gex_open) < 0
                                       THEN (sg.gex_now + sg.gex_open) END), 0) AS neg_gex,
                     COUNT(*) FILTER (WHERE (sg.gex_now + sg.gex_open) > 0) AS n_pos,
                     COUNT(*) FILTER (WHERE (sg.gex_now + sg.gex_open) < 0) AS n_neg,
                     -- VOLUME-ONLY basis: today's traded gamma alone (gex_now),
                     -- with the carried OI book (gex_open) left out. Same shape
                     -- as the net columns so the UI can switch bases with no
                     -- refetch. Note the strike SET is still ranked by net, so
                     -- this is the volume split across the strikes the recorder
                     -- tracks — the same caveat the net basis carries.
                     COALESCE(SUM(CASE WHEN sg.gex_now > 0 THEN sg.gex_now END), 0) AS pos_vol,
                     COALESCE(SUM(CASE WHEN sg.gex_now < 0 THEN sg.gex_now END), 0) AS neg_vol,
                     COUNT(*) FILTER (WHERE sg.gex_now > 0) AS n_pos_vol,
                     COUNT(*) FILTER (WHERE sg.gex_now < 0) AS n_neg_vol
              FROM strike_growth sg
              JOIN ranked r
                ON r.symbol = sg.symbol AND r.expiry = sg.expiry AND r.ts = sg.ts
              WHERE sg.date = (SELECT date FROM d) AND r.exp_idx <= $2
              GROUP BY sg.symbol, sg.expiry, r.exp_idx
              ORDER BY sg.symbol ASC, r.exp_idx ASC`;
            const { rows } = await p.query(sql, [asOf, nExp]);
            const dateUsed = rows.length
              ? (await p.query(`SELECT MAX(date) AS date FROM strike_growth WHERE date <= $1`, [asOf])).rows[0]?.date
              : null;
            sendJson(res, 200, {
              ok: true,
              date: dateUsed ? new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(dateUsed)) : asOf,
              stale: dateUsed ? String(dateUsed).slice(0, 10) !== today : false,
              expiries: nExp,
              rows: rows.map((r) => ({
                symbol: r.symbol,
                expiry: r.expiry,
                exp_idx: Number(r.exp_idx),
                spot: Number(r.spot) || 0,
                ts: r.ts,
                pos_gex: Number(r.pos_gex) || 0,
                neg_gex: Number(r.neg_gex) || 0,
                n_pos: Number(r.n_pos) || 0,
                n_neg: Number(r.n_neg) || 0,
                // volume-only basis (gex_now, no carried OI)
                pos_vol: Number(r.pos_vol) || 0,
                neg_vol: Number(r.neg_vol) || 0,
                n_pos_vol: Number(r.n_pos_vol) || 0,
                n_neg_vol: Number(r.n_neg_vol) || 0,
              })),
            });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Cross-ticker SCANNER: top movers by Δ over a window, stocks-only, with a
      // vs-today z-score so abnormally-large moves surface (not just big numbers).
      //   GET /proxy/strike-growth/scanner?window=15&limit=10&sort=z&minZ=0
      //   window=15|30|60  sort=z|abs|otm|pct|score
      //   (z=anomaly, abs=raw Δ, pct=%vsopen, score=0.6·|Δ|+0.4·|%| blend)
      if (pathname === '/proxy/strike-growth/scanner' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const win = [5, 15, 30, 60].includes(Number(u.searchParams.get('window'))) ? Number(u.searchParams.get('window')) : 15;
            const limit = Math.min(100, Number(u.searchParams.get('limit') || 10));
            const sort = (u.searchParams.get('sort') || 'z').toLowerCase(); // z | abs | otm | pct
            const minZ = Number(u.searchParams.get('minZ') || 0);
            // OTM weight aggressiveness: weight = 1 + otmDist * k. Higher k pushes
            // far-OTM strikes up the ranking harder. Tunable via ?otmK= or env.
            const otmK = Number(u.searchParams.get('otmK') || process.env.STRIKE_GROWTH_OTM_K || 8);
            // Hard OTM-distance floor (fraction, e.g. 0.02 = 2%). Unlike the otm
            // *weighting* above, this actually excludes near-the-money strikes
            // from the candidate pool so far-OTM strikes aren't drowned out.
            const minOtm = Math.max(0, Number(u.searchParams.get('minOtm') || 0));
            // Direction filter combining side + GEX growth:
            //   pos = strike ABOVE spot AND rising GEX  (Δ>0) → OTM call-side building
            //   neg = strike BELOW spot AND falling GEX (Δ<0) → OTM put-side building
            //   build = either of the above — the strike's OWN side is growing. Decaying
            //           strikes (e.g. big -Δ above spot) are noise and get excluded.
            const dir = ['pos', 'neg', 'build'].includes((u.searchParams.get('dir') || '').toLowerCase())
              ? u.searchParams.get('dir').toLowerCase() : 'all';
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
            // Indices/ETFs excluded — stocks only.
            const EXCLUDE = ['SPX','NDX','VIX','RUT','XSP','SPY','QQQ','IWM','DIA'];
            // changes: every snapshot's Δ-vs-(window)-min-ago, per symbol/expiry/strike.
            // Then per strike: latest Δ + mean/stddev of today's Δ series → z-score.
            // Combined-score weights (image spec: 0.6·|Δ| + 0.4·|%|), overridable via query.
            const wAbs = Math.max(0, Math.min(1, Number(u.searchParams.get('wAbs') || 0.6)));
            const wPct = Math.max(0, Math.min(1, Number(u.searchParams.get('wPct') || 0.4)));
            const orderCol = sort === 'abs'   ? 'ABS(latest_chg)'
                           : sort === 'otm'   ? 'ABS(weighted_chg)'
                           : sort === 'pct'   ? 'ABS(pct_open)'
                           : sort === 'score' ? 'score'
                           : 'ABS(z_score)';
            const sql = `
              WITH changes AS (
                SELECT sg.symbol, sg.expiry, sg.strike, sg.ts, sg.spot, sg.delta_pct,
                       (sg.gex_now - b.gex_now) AS chg
                FROM strike_growth sg
                JOIN LATERAL (
                  SELECT gex_now FROM strike_growth h
                  WHERE h.date = sg.date AND h.symbol = sg.symbol AND h.expiry = sg.expiry
                    AND h.strike = sg.strike AND h.ts <= sg.ts - INTERVAL '${win} minutes'
                  ORDER BY h.ts DESC LIMIT 1
                ) b ON TRUE
                WHERE sg.date = $1 AND sg.symbol <> ALL($2)
                  -- Only the active (curated) universe — skips deactivated old-roster
                  -- rows still present in today's table, which is what made this slow.
                  AND sg.symbol IN (SELECT symbol FROM strike_growth_watchlist WHERE active = TRUE)
                  -- Bound to recent history so the scan stays fast late in the session.
                  AND sg.ts > (now() - INTERVAL '4 hours')
              ),
              stats AS (
                SELECT symbol, expiry, strike,
                       avg(chg) AS mean_chg, stddev_pop(chg) AS sd_chg,
                       count(*) AS n,
                       (array_agg(chg       ORDER BY ts DESC))[1] AS latest_chg,
                       (array_agg(spot      ORDER BY ts DESC))[1] AS spot,
                       (array_agg(delta_pct ORDER BY ts DESC))[1] AS pct_open,
                       (array_agg(ts        ORDER BY ts DESC))[1] AS latest_ts
                FROM changes GROUP BY symbol, expiry, strike
              ),
              scored AS (
                SELECT s.symbol, s.expiry, s.strike, s.latest_chg, s.mean_chg, s.sd_chg, s.n, s.spot, s.pct_open,
                       CASE WHEN s.sd_chg > 0 THEN (s.latest_chg - s.mean_chg) / s.sd_chg ELSE 0.0 END AS z_score,
                       CASE WHEN s.spot > 0 THEN ABS(s.strike - s.spot) / s.spot ELSE 0.0 END AS otm_dist,
                       s.latest_chg * (1 + (CASE WHEN s.spot > 0 THEN ABS(s.strike - s.spot) / s.spot ELSE 0.0 END) * $5) AS weighted_chg
                FROM stats s
                WHERE s.n >= 2 AND s.latest_chg IS NOT NULL
                  AND (CASE WHEN s.sd_chg > 0 THEN ABS((s.latest_chg - s.mean_chg)/s.sd_chg) ELSE 0 END) >= $3
              )
              SELECT symbol, expiry, strike, latest_chg, mean_chg, sd_chg, n, spot,
                     z_score AS z, otm_dist, weighted_chg, pct_open,
                     -- Combined score: min-max normalize |Δ| and |%| across the
                     -- candidate set, blend (image: 0.6·|Δ| + 0.4·|%|), scaled 0..100.
                     -- Each term COALESCE→0 so a null/zero denominator can't null the score.
                     (${wAbs} * COALESCE(ABS(latest_chg) / NULLIF(MAX(ABS(latest_chg)) OVER (), 0), 0)
                    + ${wPct} * COALESCE(ABS(pct_open)  / NULLIF(MAX(ABS(pct_open))  OVER (), 0), 0)) * 100 AS score
              FROM scored
              WHERE otm_dist >= $6
                AND ($7 = 'all'
                  OR ($7 = 'pos' AND spot > 0 AND strike > spot AND latest_chg > 0)
                  OR ($7 = 'neg' AND spot > 0 AND strike < spot AND latest_chg < 0)
                  OR ($7 = 'build' AND spot > 0 AND ((strike > spot AND latest_chg > 0)
                                                  OR (strike < spot AND latest_chg < 0))))
              ORDER BY ${orderCol} DESC NULLS LAST
              LIMIT $4`;
            const { rows } = await p.query(sql, [today, EXCLUDE, minZ, limit, otmK, minOtm, dir]);
            sendJson(res, 200, { ok: true, window: win, sort, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Watchlist read.  GET /proxy/strike-growth/watchlist
      if (pathname === '/proxy/strike-growth/watchlist' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const { rows } = await p.query(
              `SELECT symbol, active, hot, sort_idx FROM strike_growth_watchlist
               ORDER BY hot DESC, active DESC, sort_idx ASC, symbol ASC`
            );
            sendJson(res, 200, { ok: true, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Watchlist edit.  POST /proxy/strike-growth/watchlist
      //   { symbol:"NVDA", active:true }            → toggle/add
      //   { symbol:"NVDA", remove:true }            → delete row
      if (pathname === '/proxy/strike-growth/watchlist' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          (async () => {
            try {
              const { ensureSchema, getPool } = require('./strike-growth-recorder');
              if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
              const p = getPool();
              const j = JSON.parse(body || '{}');
              // Bulk activate every seeded EM ticker so the whole roster is recorded.
              //   { activateAll:true }  → set active=TRUE on all rows
              if (j.activateAll) {
                const r = await p.query(`UPDATE strike_growth_watchlist SET active = TRUE WHERE active = FALSE`);
                sendJson(res, 200, { ok: true, activated: r.rowCount });
                return;
              }
              const symbol = String(j.symbol || '').toUpperCase().trim();
              if (!symbol) { sendJson(res, 400, { ok: false, error: 'symbol required' }); return; }
              if (j.remove) {
                await p.query(`DELETE FROM strike_growth_watchlist WHERE symbol = $1`, [symbol]);
              } else if (typeof j.hot === 'boolean') {
                // Toggle fast-lane membership without touching active.
                await p.query(
                  `INSERT INTO strike_growth_watchlist (symbol, active, hot, sort_idx)
                   VALUES ($1, TRUE, $2, 0) ON CONFLICT (symbol) DO UPDATE SET hot = EXCLUDED.hot`,
                  [symbol, j.hot]
                );
              } else {
                const active = j.active !== false;
                await p.query(
                  `INSERT INTO strike_growth_watchlist (symbol, active, sort_idx)
                   VALUES ($1, $2, 0) ON CONFLICT (symbol) DO UPDATE SET active = EXCLUDED.active`,
                  [symbol, active]
                );
              }
              sendJson(res, 200, { ok: true });
            } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
          })();
        });
        return;
      }
      // Manually fire a watchlist sweep now (ignores RTH gate).
      //   POST /proxy/strike-growth-run
      if (pathname === '/proxy/strike-growth-run' && req.method === 'POST') {
        const { runSweep } = require('./strike-growth-recorder');
        runSweep({ force: true })
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // Manually fire a greeks_ts write now (ignores RTH gate). Feeds the
      // Analytics "Net Greeks" card. POST /proxy/greeks-ts-run
      if (pathname === '/proxy/greeks-ts-run' && req.method === 'POST') {
        const { collectGreeksTs } = require('./greeks-ts-writer');
        collectGreeksTs(`http://localhost:${PORT}`, { force: true })
          .then(() => sendJson(res, 200, { ok: true }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // ── Greek Sensitivity Scanner ─────────────────────────────────────────
      // GET /proxy/greek-scanner?mode=charm|vanna|gamma|tg&window=15|30|60&limit=25
      //   mode: charm = charm exposure shifts (delta decay)
      //         vanna = vanna exposure shifts (delta↔IV sensitivity)
      //         gamma = gamma momentum / acceleration
      //         tg    = theta-gamma imbalance (|charm| × |gamma| composite)
      if (pathname === '/proxy/greek-scanner' && req.method === 'GET') {
        (async () => {
          try {
            if (!(await greekEnsureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = greekGetPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const win   = [15, 30, 60].includes(Number(u.searchParams.get('window'))) ? Number(u.searchParams.get('window')) : 15;
            const limit = Math.min(100, Number(u.searchParams.get('limit') || 25));
            const mode  = ['charm','vanna','gamma','tg'].includes(u.searchParams.get('mode')) ? u.searchParams.get('mode') : 'charm';
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

            // Pick the metric column for change-tracking.
            const metricCol = mode === 'vanna' ? 'vanna_net'
                            : mode === 'gamma' ? 'gamma_net'
                            : 'charm_net';   // charm + tg both start with charm

            const sql = `
              WITH changes AS (
                SELECT gs.symbol, gs.expiry, gs.strike, gs.ts, gs.spot,
                       gs.charm_net, gs.vanna_net, gs.gamma_net, gs.delta_net,
                       (gs.${metricCol} - b.${metricCol}) AS metric_chg
                FROM greek_snapshots gs
                JOIN LATERAL (
                  SELECT ${metricCol} FROM greek_snapshots h
                  WHERE h.date = gs.date AND h.symbol = gs.symbol AND h.strike = gs.strike
                    AND h.ts <= gs.ts - INTERVAL '${win} minutes'
                  ORDER BY h.ts DESC LIMIT 1
                ) b ON TRUE
                WHERE gs.date = $1
              ),
              stats AS (
                SELECT symbol, expiry, strike,
                       AVG(metric_chg) AS mean_chg, STDDEV_POP(metric_chg) AS sd_chg,
                       COUNT(*) AS n,
                       (ARRAY_AGG(metric_chg  ORDER BY ts DESC))[1] AS latest_chg,
                       (ARRAY_AGG(charm_net   ORDER BY ts DESC))[1] AS charm_now,
                       (ARRAY_AGG(vanna_net   ORDER BY ts DESC))[1] AS vanna_now,
                       (ARRAY_AGG(gamma_net   ORDER BY ts DESC))[1] AS gamma_now,
                       (ARRAY_AGG(delta_net   ORDER BY ts DESC))[1] AS delta_now,
                       (ARRAY_AGG(spot        ORDER BY ts DESC))[1] AS spot_now
                FROM changes
                GROUP BY symbol, expiry, strike
              ),
              scored AS (
                SELECT *,
                  CASE WHEN sd_chg > 0 THEN (latest_chg - mean_chg) / sd_chg ELSE NULL END AS z_score,
                  ABS(charm_now) * ABS(gamma_now) / GREATEST(ABS(delta_now), 1e6) AS tg_score
                FROM stats
                WHERE n >= 2 AND latest_chg IS NOT NULL
              )
              SELECT symbol, expiry, strike, latest_chg, mean_chg, sd_chg, n, z_score,
                     charm_now, vanna_now, gamma_now, delta_now, spot_now, tg_score
              FROM scored
              ORDER BY ${mode === 'tg' ? 'tg_score' : 'ABS(latest_chg)'} DESC NULLS LAST
              LIMIT $2`;

            const { rows } = await p.query(sql, [today, limit]);
            sendJson(res, 200, { ok: true, window: win, mode, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Manual snapshot fire: POST /proxy/greek-scanner-run
      if (pathname === '/proxy/greek-scanner-run' && req.method === 'POST') {
        runGreekSnapshot(`http://localhost:${PORT}`, { force: true })
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }

      // ── Multi-ticker GEX Scanner ──────────────────────────────────────────
      // GET /proxy/scanner?sort=gex|flip&limit=50&any=1
      //   Latest row per ticker for today, ranked by |total net GEX| (default)
      //   or distance of spot from the GEX flip. any=1 drops the "today only"
      //   filter and returns each symbol's most recent row regardless of date
      //   (market closed / weekend — last available snapshot, e.g. Friday's
      //   close, instead of an empty result). Response marks each row `stale`
      //   (its `date` !== today) so the client can flag it.
      //
      //   `cb` / `cb_gex` (Core Bullseye — the highest |GEX| strike) are in the
      //   SELECT as of 2026-08-13. scanner-recorder.js has always WRITTEN them;
      //   the read just never returned them, so every consumer of this endpoint
      //   got the two walls and no core. /levels draws all three, and reading
      //   CB from /proxy/walls instead would have meant a second request at
      //   15-minute slot granularity for a number already sitting in this row.
      //   Purely additive — existing callers see two extra fields.
      if (pathname === '/proxy/scanner' && req.method === 'GET') {
        (async () => {
          try {
            if (!(await scannerEnsureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = scannerGetPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const sort  = ['gex', 'flip'].includes(u.searchParams.get('sort')) ? u.searchParams.get('sort') : 'gex';
            const limit = Math.min(200, Number(u.searchParams.get('limit') || 50));
            const any = u.searchParams.get('any') === '1';
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
            const sql = any
              ? `SELECT DISTINCT ON (symbol)
                        symbol, date, ts, spot, expiry, total_net_gex, call_wall, put_wall, gex_flip,
                        cb, cb_gex, strikes
                 FROM scanner_snapshots
                 ORDER BY symbol, ts DESC`
              : `SELECT DISTINCT ON (symbol)
                        symbol, date, ts, spot, expiry, total_net_gex, call_wall, put_wall, gex_flip,
                        cb, cb_gex, strikes
                 FROM scanner_snapshots
                 WHERE date = $1
                 ORDER BY symbol, ts DESC`;
            const { rows } = await p.query(sql, any ? [] : [today]);
            for (const r of rows) r.stale = String(r.date) !== today;
            rows.sort((a, b) => {
              if (sort === 'flip') {
                const da = a.gex_flip != null ? Math.abs(a.spot - a.gex_flip) : Infinity;
                const db = b.gex_flip != null ? Math.abs(b.spot - b.gex_flip) : Infinity;
                return da - db;
              }
              return Math.abs(b.total_net_gex ?? 0) - Math.abs(a.total_net_gex ?? 0);
            });
            sendJson(res, 200, { ok: true, sort, rows: rows.slice(0, limit) });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // ── Walls (call wall / put wall / CB tracking) ────────────────────────
      // GET /proxy/walls?date=YYYY-MM-DD          → day summary, one row/ticker
      // GET /proxy/walls?date=…&symbol=SPX        → that ticker's level log +
      //                                             every classified hit event
      // Levels are stored change-only, so the day summary carries the last
      // written value forward per level type; `open` holds the 09:29 baseline
      // so the client can show the session delta without re-reading the log.
      //
      // The day summary is then decorated by walls-reach.attachRank(), which
      // adds ATR distance / bucket / out-of-sample reach score per level plus
      // the `rank` block the page's ladder and ranked list draw from. It never
      // throws: if the calibration snapshot is missing the walls still render.
      if (pathname === '/proxy/walls' && req.method === 'GET') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = u.searchParams.get('symbol') || undefined;
            const out = await getWalls({
              date: u.searchParams.get('date') || undefined,
              symbol,
            });
            // Only the universe view carries a ranking — the per-symbol view is
            // a log, not a leaderboard.
            const body = (!symbol && out?.ok) ? await attachRank(out) : out;
            sendJson(res, body.ok ? 200 : 503, body);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // ── Reach study behind the ranking ────────────────────────────────────
      // GET /proxy/walls-reach?date=…            → global ladder + per-symbol grid
      // GET /proxy/walls-reach?date=…&symbol=SPX → that symbol's curve vs global
      if (pathname === '/proxy/walls-reach' && req.method === 'GET') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const out = await getReach({
              date: u.searchParams.get('date') || undefined,
              symbol: u.searchParams.get('symbol') || undefined,
            });
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Manual backfill / recalibration:
      //   POST /proxy/walls-reach-run { from?, to?, symbols?, rebuild?, calibrateOnly?, asOf? }
      // A full history replay is long-running — this responds when it finishes,
      // so drive it from the VPS rather than a browser tab.
      if (pathname === '/proxy/walls-reach-run' && req.method === 'POST') {
        let reachBody = '';
        req.on('data', (c) => { reachBody += c; if (reachBody.length > 1e5) req.destroy(); });
        req.on('end', () => {
          let opts = {};
          try { opts = JSON.parse(reachBody || '{}'); } catch {}
          (async () => {
            const backfill = opts.calibrateOnly === true ? null : await runReachBackfill({
              from: opts.from || null,
              to: opts.to || null,
              symbols: Array.isArray(opts.symbols) && opts.symbols.length ? opts.symbols : null,
              rebuild: opts.rebuild === true,
            });
            const calibration = await runCalibration({ asOf: opts.asOf || null });
            return { backfill, calibration };
          })()
            .then((r) => sendJson(res, 200, { ok: true, result: r }))
            .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        });
        return;
      }
      // Live watchlist: GET /proxy/walls-watch[?date=&maxAtr=]
      //   → { levels:[...] } — every level currently within maxAtr of spot,
      //     nearest first, with today's attempt history and whether price is
      //     closing on it. Polled by the Walls tab; cheap enough for 30s.
      //   Distance is the claim. Whether the level HOLDS is not — see the
      //   control-arm note in walls-reach.js.
      if (pathname === '/proxy/walls-watch' && req.method === 'GET') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const maxAtr = Number(u.searchParams.get('maxAtr'));
            const out = await getWatch({
              date: u.searchParams.get('date') || undefined,
              maxAtr: Number.isFinite(maxAtr) && maxAtr > 0 ? maxAtr : undefined,
            });
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Forward walls: GET /proxy/walls-forward[?date=&symbol=]
      //   The SAME wall calculation on the next unexpired contract, from its own
      //   table. Never mixed into scanner_snapshots — see the header note in
      //   forward-scanner-recorder.js for why that would corrupt three readers.
      if (pathname === '/proxy/walls-forward' && req.method === 'GET') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const out = await getForward({
              date: u.searchParams.get('date') || undefined,
              symbol: u.searchParams.get('symbol') || undefined,
            });
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Manual forward sweep: POST /proxy/walls-forward-run { force?, symbols? }
      if (pathname === '/proxy/walls-forward-run' && req.method === 'POST') {
        let fb = '';
        req.on('data', (c) => { fb += c; if (fb.length > 1e5) req.destroy(); });
        req.on('end', () => {
          let o = {};
          try { o = JSON.parse(fb || '{}'); } catch {}
          runForwardSweep({
            force: o.force === true,
            symbols: Array.isArray(o.symbols) && o.symbols.length ? o.symbols : null,
          })
            .then((r) => sendJson(res, 200, { ok: true, result: r }))
            .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        });
        return;
      }
      // Alert feed: GET /proxy/walls-alerts[?date=&limit=]
      //   → { alerts:[...] } newest first. Written by the 5m watch sweep when a
      //     level comes inside 0.25x ATR while closing. Rendered on the Walls
      //     tab — there is deliberately no email/push channel for these.
      if (pathname === '/proxy/walls-alerts' && req.method === 'GET') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const out = await getAlerts({
              date: u.searchParams.get('date') || undefined,
              limit: Number(u.searchParams.get('limit')) || undefined,
            });
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Manual alert sweep: POST /proxy/walls-watch-run { force?: true }
      // force bypasses the RTH gate so the wiring can be tested off-hours.
      if (pathname === '/proxy/walls-watch-run' && req.method === 'POST') {
        let wb = '';
        req.on('data', (c) => { wb += c; if (wb.length > 1e5) req.destroy(); });
        req.on('end', () => {
          let o = {};
          try { o = JSON.parse(wb || '{}'); } catch {}
          runWatchAlerts({ force: o.force === true, dryRun: o.dryRun === true })
            .then((r) => sendJson(res, 200, { ok: true, result: r }))
            .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        });
        return;
      }
      // Manual slot fire: POST /proxy/walls-run  { slot?: 0-26, force?: true }
      // force bypasses the trading-day gate; slot lets you re-run / backfill a
      // specific capture (writes are idempotent on (date,symbol,level,slot)).
      if (pathname === '/proxy/walls-run' && req.method === 'POST') {
        let wallsBody = '';
        req.on('data', (c) => { wallsBody += c; if (wallsBody.length > 1e5) req.destroy(); });
        req.on('end', () => {
          let opts = {};
          try { opts = JSON.parse(wallsBody || '{}'); } catch {}
          runWallsSlot({
            slot: opts.slot != null ? Number(opts.slot) : null,
            force: opts.force === true,
          })
            .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
            .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        });
        return;
      }
      // Manual sweep fire: POST /proxy/scanner-run
      if (pathname === '/proxy/scanner-run' && req.method === 'POST') {
        runScannerSweep({ force: true })
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // Hourly "very strong" GEX-change top 5 — recorded history for the viewer tab.
      //   GET /proxy/gex-change-top?date=YYYY-MM-DD  → { ok, date, hours:[{hour,ts,rows[]}] }
      if (pathname === '/proxy/gex-change-top' && req.method === 'GET') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const date = u.searchParams.get('date') || undefined;
            const out = await getGexChangeTopHistory({ date });
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // One pick's auto-probed option price / net GEX for a single ET session —
      // what the scanner's GEX Change Top card flips over to chart.
      //   GET /proxy/gex-change-top-history?id=<watch_id>&date=YYYY-MM-DD
      //     → { ok, watch_id, date, contract, points:[{ts,mark,net_gex}] }
      // Read-only and limited to watch_ids referenced by a gex_change_top row.
      if (pathname === '/proxy/gex-change-top-history' && req.method === 'GET') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const out = await getGexChangeTopPickHistory({
              watchId: u.searchParams.get('id'),
              date: u.searchParams.get('date') || undefined,
            });
            sendJson(res, out.ok ? 200 : 404, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // EOD scorecard — how every auto-probed pick actually performed: peak mark
      // after the probe (and when it printed), low, and close.
      //   GET /proxy/gex-change-top-results?date=YYYY-MM-DD
      //     → { ok, date, frozen, rows:[…] }   frozen=false ⇒ computed live
      if (pathname === '/proxy/gex-change-top-results' && req.method === 'GET') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const out = await getGexChangeTopResults({ date: u.searchParams.get('date') || undefined });
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // PICK STUDY — what did the A/B picks have in common?
      //   GET /proxy/gex-change-top-study?days=60&by=<feature>&cohort=selected|shadow|all
      //     → { ok, by, label, note, overall, cohorts, buckets:[…], features:[…] }
      //
      // Read-only aggregate over gex_change_top_results joined back to each
      // pick's FIRST gex_change_top row (the only capture-time feature source
      // that cannot leak the outcome). Buckets one feature at a time and reports
      // the hit rate per bucket, recomputed on each half of the window so a
      // split can be checked out-of-sample on the spot. `cohort=shadow` reads the
      // picks the board did NOT take — the control group.
      if (pathname === '/proxy/gex-change-top-study' && req.method === 'GET') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const out = await getGexChangeTopStudy({
              days: u.searchParams.get('days') || undefined,
              by: u.searchParams.get('by') || undefined,
              cohort: u.searchParams.get('cohort') || undefined,
            });
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // CALIBRATION — grading the grader. For each grade the projection rule
      // predicted AT CAPTURE, what did those picks actually do?
      //   GET /proxy/gex-change-top-calibration?days=60&cohort=selected
      //     → { ok, armed, rows:[{ projected, n, pctGood, actual:{…} }], … }
      // armed=false (the shipping default) means no projection rule is
      // configured, so there is nothing to calibrate yet.
      if (pathname === '/proxy/gex-change-top-calibration' && req.method === 'GET') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const out = await getGexChangeTopCalibration({
              days: u.searchParams.get('days') || undefined,
              cohort: u.searchParams.get('cohort') || undefined,
            });
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // PROJECTION RULE — the thing calibration is calibrating.
      //
      //   GET  /proxy/gex-change-top-rule
      //     → { ok, armed, source, terms, pinnedBy, auto, thresholds, lastFit }
      //   POST /proxy/gex-change-top-rule-fit?days=90&cohort=selected&apply=1
      //     → runs the auto-fit over the study's own bucket tables. Without
      //       apply it is a DRY RUN: the terms it would arm, plus every bucket
      //       it rejected and why. With apply=1 it stores the rule (unless a
      //       hand-written config file is pinning it).
      //   POST /proxy/gex-change-top-rule    body { rule } | { clear: true }
      //     → pin a rule by hand, or clear the stored one and go inert again.
      //
      // Writes are owner-only: proxy-auth gates every non-GET on /proxy/*.
      if (pathname === '/proxy/gex-change-top-rule' && req.method === 'GET') {
        (async () => {
          try { sendJson(res, 200, await getGexChangeTopRuleState()); }
          catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      if (pathname === '/proxy/gex-change-top-rule-fit' && req.method === 'POST') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const apply = ['1', 'true', 'yes'].includes(String(u.searchParams.get('apply') || '').toLowerCase());
            const out = await fitGexChangeTopRule({
              days: u.searchParams.get('days') ? Number(u.searchParams.get('days')) : undefined,
              cohort: u.searchParams.get('cohort') || undefined,
              apply,
              by: 'manual',
            });
            sendJson(res, out.ok ? 200 : 503, out);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      if (pathname === '/proxy/gex-change-top-rule' && req.method === 'POST') {
        (async () => {
          try {
            const body = await readJsonBody(req);
            if (body && body.clear) {
              await storeGexChangeTopRule(null);
            } else if (body && body.rule) {
              await storeGexChangeTopRule(body.rule, { by: 'manual' });
            } else {
              sendJson(res, 400, { ok: false, error: 'body must be { rule } or { clear: true }' });
              return;
            }
            sendJson(res, 200, await getGexChangeTopRuleState());
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Manual EOD freeze: POST /proxy/gex-change-top-eod  (owner-only via proxy-auth)
      if (pathname === '/proxy/gex-change-top-eod' && req.method === 'POST') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const r = await runGexChangeTopResults({ date: u.searchParams.get('date') || undefined });
            sendJson(res, 200, { ok: true, result: r ?? null });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Manual capture fire: POST /proxy/gex-change-top-run
      if (pathname === '/proxy/gex-change-top-run' && req.method === 'POST') {
        runGexChangeTop({ force: true })
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // GET /proxy/scanner-tickers — the configured ticker universe, used to
      // populate the Options Positioning ticker picker on the client.
      //
      // Resolved through roster-store: scanner-tickers.js baseline + the
      // roster_overrides rows written from the owner Watchlists page. Same
      // { ok, tickers } shape as before. An explicit SCANNER_TICKERS env still
      // wins, and a dead Postgres degrades to the file — parseScannerTickers()
      // handles both, so this can never answer with an empty list.
      if (pathname === '/proxy/scanner-tickers' && req.method === 'GET') {
        (async () => {
          try {
            const { resolveScannerTickers } = require('./scanner-recorder');
            sendJson(res, 200, { ok: true, tickers: await resolveScannerTickers() });
          } catch (e) {
            console.warn('[roster] scanner-tickers resolve failed, serving baseline:', e?.message || e);
            sendJson(res, 200, { ok: true, tickers: parseScannerTickers(), stale: true });
          }
        })();
        return;
      }

      // ── Editable rosters (owner Watchlists page) ─────────────────────────
      //
      // The CB Edge ticker lists — scanner / em / far-cb — as
      // "file baseline + roster_overrides", so a ticker can be added, removed
      // or moved between buckets without a redeploy. See roster-store.js for
      // the resolution rules and the fail-soft behaviour.
      //
      //   GET  /proxy/rosters                → every list, resolved
      //   GET  /proxy/rosters?list=scanner   → one list
      //   POST /proxy/roster                 → { list, action, symbol, bucket? }
      //   POST /proxy/roster-reset           → { list, symbol? }  (revert to file)
      //
      // Writes are OWNER-only: proxy-auth gates every non-GET on /proxy/*.
      if (pathname === '/proxy/rosters' && req.method === 'GET') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const one = (u.searchParams.get('list') || '').trim().toLowerCase();
            if (one) {
              sendJson(res, 200, { ok: true, roster: await rosterStore.getRoster(one) });
              return;
            }
            const all = await rosterStore.getAllRosters();
            sendJson(res, 200, { ok: true, lists: rosterStore.LIST_IDS, rosters: all });
          } catch (e) { sendJson(res, 400, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      if (pathname === '/proxy/roster' && req.method === 'POST') {
        (async () => {
          try {
            const body = await readJsonBody(req);
            const out = await rosterStore.applyEdit({
              list: String(body?.list || '').trim().toLowerCase(),
              action: String(body?.action || '').trim().toLowerCase(),
              symbol: body?.symbol,
              bucket: body?.bucket,
              note: body?.note,
            });
            sendJson(res, out.ok ? 200 : 400, out);
          } catch (e) { sendJson(res, 400, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      if (pathname === '/proxy/roster-reset' && req.method === 'POST') {
        (async () => {
          try {
            const body = await readJsonBody(req);
            const out = await rosterStore.resetOverrides({
              list: String(body?.list || '').trim().toLowerCase(),
              symbol: body?.symbol || null,
            });
            sendJson(res, out.ok ? 200 : 400, out);
          } catch (e) { sendJson(res, 400, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }

      // Manual fire: POST /proxy/retention-cleanup-run  (bypasses the 00:05-00:40
      // ET window + the once-per-day gate; for testing the nightly prune on demand)
      if (pathname === '/proxy/retention-cleanup-run' && req.method === 'POST') {
        require('./state/retention-cleanup').runCleanup({ force: true })
          .then((r) => sendJson(res, 200, r))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }

      // ── Far CB Watch ─────────────────────────────────────────────────────
      // GET /proxy/far-cb-watch — today's flagged tickers (highest OI+Vol GEX
      // strike within 30d sits > OTM_THRESHOLD_PCT% away from spot), ranked by
      // how far OTM. Each row = one "Watch this" card.
      if (pathname === '/proxy/far-cb-watch' && req.method === 'GET') {
        (async () => {
          try {
            if (!(await farCbEnsureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = farCbGetPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') || 50)));
            const { rows } = await p.query(
              `SELECT symbol, strike, expiry, gex_value, gex_value_vol, spot, otm_pct, dte_days, date
               FROM far_cb_watch
               WHERE date = (SELECT MAX(date) FROM far_cb_watch)
               ORDER BY otm_pct DESC
               LIMIT $1`,
              [limit]
            );
            sendJson(res, 200, { ok: true, rows, threshold: FAR_CB_OTM_PCT, asOf: new Date().toISOString() });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Manual sweep fire: POST /proxy/far-cb-watch-run (force = bypass RTH gate)
      if (pathname === '/proxy/far-cb-watch-run' && req.method === 'POST') {
        runFarCbSweep({ force: true })
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }

      // GET /proxy/far-cb-outcomes?status=all|open|touched|expired&limit=100
      // The tracked result of every far-CB flag ever logged — not win/loss,
      // just whether spot ever reached the strike and how close it got.
      if (pathname === '/proxy/far-cb-outcomes' && req.method === 'GET') {
        (async () => {
          try {
            if (!(await farCbEnsureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = farCbGetPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const status = (u.searchParams.get('status') || 'all').toLowerCase();
            const limit  = Math.min(300, Math.max(1, Number(u.searchParams.get('limit') || 100)));
            const where = [];
            const params = [];
            if (['open', 'touched', 'expired'].includes(status)) { params.push(status); where.push(`status = $${params.length}`); }
            params.push(limit);
            const sql = `
              SELECT symbol, strike, expiry, first_flagged, spot_at_flag, otm_pct_at_flag,
                     gex_value_at_flag, side, last_checked, last_spot, closest_pct,
                     touched, touched_date, status
              FROM far_cb_outcomes
              ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
              ORDER BY first_flagged DESC
              LIMIT $${params.length}`;
            const { rows } = await p.query(sql, params);
            const fmtRows = rows.map((r) => ({
              ...r,
              first_flagged: farCbToYmd(r.first_flagged),
              touched_date: farCbToYmd(r.touched_date),
              last_checked: farCbToYmd(r.last_checked),
            }));
            // Attach the flagged contract's ENTRY (its price the day it was
            // flagged), the HIGH it has printed since, and the move between the
            // two, so the Tracked-results table scores each flag from the flag
            // date instead of from this morning's open.
            const quoted = await farCbEnrichOutcomes(fmtRows);
            sendJson(res, 200, { ok: true, rows: quoted, asOf: new Date().toISOString() });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // GET /proxy/far-cb-outcome-detail?symbol=&strike=&expiry=
      // Day-by-day detail for one tracked flag's row popup: underlying close +
      // day/day %, and the watched contract's own close + day/day $ and %,
      // from first_flagged through today.
      if (pathname === '/proxy/far-cb-outcome-detail' && req.method === 'GET') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = String(u.searchParams.get('symbol') || '').trim().toUpperCase();
            const strike = Number(u.searchParams.get('strike'));
            const expiry = String(u.searchParams.get('expiry') || '').trim();
            if (!symbol || !(strike > 0) || !expiry) {
              sendJson(res, 400, { ok: false, error: 'symbol, strike, expiry required' });
              return;
            }
            const detail = await farCbOutcomeDetail(symbol, strike, expiry);
            sendJson(res, detail.ok ? 200 : 404, detail);
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Manual grade fire: POST /proxy/far-cb-grade-run
      if (pathname === '/proxy/far-cb-grade-run' && req.method === 'POST') {
        runFarCbGrading()
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // Manual premium backfill: POST /proxy/far-cb-backfill-run[?force=1]
      // Pulls each tracked flag's daily bars from dxLink into
      // far_cb_contract_daily. Runs itself at boot and after the close; this is
      // the on-demand handle. force=1 re-pulls contracts already marked covered.
      // Sequential and several seconds per contract — the response can take a
      // while on a large roster, which is why the recorder logs progress.
      if (pathname === '/proxy/far-cb-backfill-run' && req.method === 'POST') {
        const force = /[?&]force=1\b/.test(req.url || '');
        runFarCbBackfill({ force })
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }

      // GET /proxy/signals?limit=50&since=<ms>&kind=<kind>
      // Recent actionable GEX/CB signals (newest first) for the ES Candles
      // Signals panel and the trading bot. Alerts-only; never places orders.
      if (pathname === '/proxy/signals' && req.method === 'GET') {
        (async () => {
          try {
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') || 50)));
            const since = Number(u.searchParams.get('since') || 0) || 0;
            const kind  = u.searchParams.get('kind') || '';
            const rows = await getSignalRows({ limit, since, kind });
            sendJson(res, 200, { ok: true, rows, asOf: new Date().toISOString() });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // POST /proxy/signals-run — force one detection pass now (bypasses the
      // session/warmup gate). For manual testing from the dashboard or curl.
      if (pathname === '/proxy/signals-run' && req.method === 'POST') {
        runSignalsOnce(`http://localhost:${PORT}`, { force: true })
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }

      // Fire a single MVC snapshot now (ignores the auto on/off switch, still
      // requires RTH + a live chain). POST /proxy/mvc-snapshot
      if (pathname === '/proxy/mvc-snapshot' && req.method === 'POST') {
        const { collectOnce } = require('./mvc-auto-snapshot');
        // ?force=1 (manual owner button) overrides the outside-RTH guard.
        const force = /[?&]force=1\b/.test(req.url || '');
        const base = `http://localhost:${PORT}`;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        (async () => {
          let r = await collectOnce(base, { manual: true, force });
          // On force, an empty chain usually means the feed isn't subscribed
          // (outside RTH). Reconnect to rebuild the chain, wait, then retry once.
          if (force && r && r.ok === false && r.error === 'empty chain'
              && proxy && typeof proxy.reconnect === 'function') {
            console.log('[mvc-snapshot] empty chain on force — reconnecting feed and retrying');
            try { await proxy.reconnect(); } catch (e) { console.log('[mvc-snapshot] reconnect failed:', e?.message || e); }
            // Give the feed time to resubscribe + the chain to populate.
            for (let i = 0; i < 8; i++) {
              await sleep(2000);
              r = await collectOnce(base, { manual: true, force });
              if (!r || r.ok !== false || r.error !== 'empty chain') break;
            }
          }
          sendJson(res, 200, r ?? { ok: false, error: 'no result' });
        })().catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // Fire a single /preview delayed-snapshot now (ignores the RTH gate on
      // force — e.g. seeding the weekend page from Friday's last-known chain).
      // POST /proxy/preview-snapshot?force=1
      if (pathname === '/proxy/preview-snapshot' && req.method === 'POST') {
        const { collectOnce } = require('./preview-snapshot-recorder');
        const force = /[?&]force=1\b/.test(req.url || '');
        const base = `http://localhost:${PORT}`;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        (async () => {
          let r = await collectOnce(base, { force });
          // On force, an empty chain usually means the feed isn't subscribed
          // (outside RTH/weekend). Reconnect to rebuild it, wait, retry once.
          if (force && r && r.ok === false && r.error === 'empty chain'
              && proxy && typeof proxy.reconnect === 'function') {
            console.log('[preview-snapshot] empty chain on force — reconnecting feed and retrying');
            try { await proxy.reconnect(); } catch (e) { console.log('[preview-snapshot] reconnect failed:', e?.message || e); }
            for (let i = 0; i < 8; i++) {
              await sleep(2000);
              r = await collectOnce(base, { force });
              if (!r || r.ok !== false || r.error !== 'empty chain') break;
            }
          }
          sendJson(res, 200, r ?? { ok: false, error: 'no result' });
        })().catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // Fire a single /home full-chain static snapshot now (ignores the RTH
      // gate on force — e.g. seeding the weekend /home from Friday's close).
      // POST /proxy/home-snapshot?force=1
      if (pathname === '/proxy/home-snapshot' && req.method === 'POST') {
        const { collectOnce } = require('./home-snapshot-recorder');
        const force = /[?&]force=1\b/.test(req.url || '');
        const base = `http://localhost:${PORT}`;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        (async () => {
          let r = await collectOnce(base, { force });
          if (force && r && r.ok === false && r.error === 'empty chain'
              && proxy && typeof proxy.reconnect === 'function') {
            console.log('[home-snapshot] empty chain on force — reconnecting feed and retrying');
            try { await proxy.reconnect(); } catch (e) { console.log('[home-snapshot] reconnect failed:', e?.message || e); }
            for (let i = 0; i < 8; i++) {
              await sleep(2000);
              r = await collectOnce(base, { force });
              if (!r || r.ok !== false || r.error !== 'empty chain') break;
            }
          }
          sendJson(res, 200, r ?? { ok: false, error: 'no result' });
        })().catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // Send the morning budget briefing email right now (bypasses the 08:00 ET
      // gate). POST /proxy/budget-email-run
      // Fire-and-forget: the run drives a headless browser and takes ~40s, which
      // is long enough for the client/socket to give up. Ack immediately and let
      // it finish in the background — watch the logs for the result.
      if (pathname === '/proxy/budget-email-run' && req.method === 'POST') {
        const { runOnce } = require('./budget-email');
        sendJson(res, 202, { ok: true, queued: true, note: 'sending in background — see [budget-email] in logs' });
        runOnce(`http://localhost:${PORT}`)
          .catch((e) => console.error('[budget-email] manual run failed:', e?.message || e));
        return;
      }
      // Fire a single /mult-greek static snapshot now (ignores the RTH gate on
      // force). POST /proxy/mult-greek-snapshot?force=1
      if (pathname === '/proxy/mult-greek-snapshot' && req.method === 'POST') {
        const { collectOnce } = require('./mult-greek-snapshot-recorder');
        const force = /[?&]force=1\b/.test(req.url || '');
        const base = `http://localhost:${PORT}`;
        collectOnce(base, { force })
          .then((r) => sendJson(res, 200, r ?? { ok: false, error: 'no result' }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // Generate the pre-market AI summary now (ignores the 8am schedule).
      // POST /proxy/premarket-summary-run
      if (pathname === '/proxy/premarket-summary-run' && req.method === 'POST') {
        const { generate } = require('./premarket-summary-generator');
        generate(`http://localhost:${PORT}`)
          .then(() => sendJson(res, 200, { ok: true }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // Generate the daily AI strategy now (ignores the 08:20 schedule).
      // POST /proxy/strategy-run
      if (pathname === '/proxy/strategy-run' && req.method === 'POST') {
        const { generate } = require('./strategy-generator');
        generate(`http://localhost:${PORT}`)
          .then(() => sendJson(res, 200, { ok: true }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // Toggle the MVC auto-collector on/off at runtime, or read its state.
      //   GET  /proxy/mvc-auto            → { enabled }
      //   POST /proxy/mvc-auto { on: bool } → { enabled }
      if (pathname === '/proxy/mvc-auto' && req.method === 'GET') {
        const { isMvcAutoEnabled } = require('./mvc-auto-snapshot');
        sendJson(res, 200, { enabled: isMvcAutoEnabled() });
        return;
      }
      if (pathname === '/proxy/mvc-auto' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          const { setMvcAutoEnabled, isMvcAutoEnabled } = require('./mvc-auto-snapshot');
          let on = true;
          try { on = !!JSON.parse(body || '{}').on; } catch {}
          setMvcAutoEnabled(on);
          sendJson(res, 200, { enabled: isMvcAutoEnabled() });
        });
        return;
      }
      // Live per-alert-key toggles for the signals engine (bzila floods etc.) —
      // DB-backed, no redeploy needed. The engine polls the DB every ~20s, and
      // setAlertEnabled() also updates its in-memory cache immediately on write.
      //   GET  /proxy/signal-alerts                    → { alerts: [{key,label,group,enabled}] }
      //   POST /proxy/signal-alerts { key, enabled }    → { ok: true }
      if (pathname === '/proxy/signal-alerts' && req.method === 'GET') {
        listSignalAlertSettings()
          .then((alerts) => sendJson(res, 200, { alerts }))
          .catch((e) => sendJson(res, 502, { error: String(e?.message || e) }));
        return;
      }
      if (pathname === '/proxy/signal-alerts' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          let parsed = {};
          try { parsed = JSON.parse(body || '{}'); } catch {}
          const key = typeof parsed.key === 'string' ? parsed.key : '';
          const hasEnabled = typeof parsed.enabled === 'boolean';
          if (!key || !hasEnabled) {
            sendJson(res, 400, { error: 'key (string) and enabled (boolean) required' });
            return;
          }
          if (!SIGNAL_ALERT_CATALOG.some((a) => a.key === key)) {
            sendJson(res, 400, { error: `unknown alert key: ${key}` });
            return;
          }
          setSignalAlertEnabled(key, parsed.enabled)
            .then(() => sendJson(res, 200, { ok: true }))
            .catch((e) => sendJson(res, 502, { error: String(e?.message || e) }));
        });
        return;
      }
      // Dev probe: raw feed data for a single built symbol from the live maps
      // (same source as the GEX chart). GET /proxy/probe?symbol=...&feed=Greeks
      if (pathname === '/proxy/probe' && req.method === 'GET') {
        const url = new URL(req.url || '/', 'http://localhost');
        const symbol = url.searchParams.get('symbol') || '';
        const feed = url.searchParams.get('feed') || 'Greeks';
        const t0 = Date.now();
        if (!proxy || typeof proxy.probeSymbol !== 'function') {
          sendJson(res, 503, { error: 'proxy not ready', symbol, feed, elapsedMs: Date.now() - t0 });
          return;
        }
        const probe = await proxy.probeSymbol(symbol, feed);
        sendJson(res, 200, { ...probe, symbol, elapsedMs: Date.now() - t0 });
        return;
      }
      // REST probe for ANY ticker (the live feed only covers one SYMBOL).
      // GET /proxy/probe-rest?ticker=AAPL&expiry=2026-06-22&type=P&strike=190
      if (pathname === '/proxy/probe-rest' && req.method === 'GET') {
        const url = new URL(req.url || '/', 'http://localhost');
        const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
        const expiry = url.searchParams.get('expiry') || '';
        const type = (url.searchParams.get('type') || 'P').toUpperCase() === 'C' ? 'C' : 'P';
        const strike = Number(url.searchParams.get('strike'));
        const t0 = Date.now();
        if (!ticker || !expiry) {
          sendJson(res, 400, { error: 'ticker and expiry required', ticker, expiry, elapsedMs: Date.now() - t0 });
          return;
        }
        try {
          const probe = await probeRest({ ticker, expiry, type, strike });
          sendJson(res, 200, { ...probe, ticker, expiry, elapsedMs: Date.now() - t0 });
        } catch (e) {
          sendJson(res, 502, { error: String(e?.message || e), ticker, expiry, source: 'rest', elapsedMs: Date.now() - t0 });
        }
        return;
      }
      // Batched per-contract Vol / OI / IV for the /flow tape columns. The tape
      // has hundreds of rows but only a handful of distinct expiries, so this
      // takes GROUPS (ticker:expiry) rather than contracts and returns every
      // strike|type in each group for the client to join against.
      // GET /proxy/contract-stats?groups=SPX:2026-07-24,NVDA:2026-08-15
      if (pathname === '/proxy/contract-stats' && req.method === 'GET') {
        const url = new URL(req.url || '/', 'http://localhost');
        const raw = url.searchParams.get('groups') || '';
        const groups = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const [ticker, expiry] = s.split(':');
            return { ticker, expiry };
          });
        if (!groups.length) {
          sendJson(res, 400, { error: 'groups required, e.g. groups=SPX:2026-07-24' });
          return;
        }
        const t0 = Date.now();
        try {
          const out = await contractStats(groups);
          sendJson(res, 200, { ...out, elapsedMs: Date.now() - t0 });
        } catch (e) {
          sendJson(res, 502, { error: String(e?.message || e), elapsedMs: Date.now() - t0 });
        }
        return;
      }
      // Price history for ONE contract — feeds the /flow tape's contract drawer.
      //
      // Always INTRADAY, and always anchored to the alert: `start` is the print's
      // session, `end` is either that same session ("Today") or the current one
      // ("All"). There is no pre-alert history by design — bars from before the
      // order printed can't say anything about how it did, and they stretch the
      // price axis until the part you care about is a flat line.
      //
      // Interval scales with the span so a long-dated print can't ask for tens of
      // thousands of 5m bars.
      // GET /proxy/option-history?ticker=SPX&expiry=2026-07-24&strike=6400&type=C&start=2026-07-15&end=2026-07-15
      if (pathname === '/proxy/option-history' && req.method === 'GET') {
        const url = new URL(req.url || '/', 'http://localhost');
        const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
        const expiry = url.searchParams.get('expiry') || '';
        const type = (url.searchParams.get('type') || 'C').toUpperCase() === 'P' ? 'P' : 'C';
        const strike = Number(url.searchParams.get('strike'));
        // The tape row's OWN streamer symbol, when the caller has it. Preferred
        // over reconstruction — see buildStreamerSymbol.
        const symbolParam = (url.searchParams.get('symbol') || '').trim().toUpperCase();
        const todayEt = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        const start = url.searchParams.get('start') || todayEt;
        const end = url.searchParams.get('end') || start;
        const t0 = Date.now();
        if (!ticker || !expiry || !(strike > 0)) {
          sendJson(res, 400, { error: 'ticker, expiry and strike required' });
          return;
        }
        try {
          const spot = await fetchUnderlyingQuotes([ticker])
            .then((m) => Number(m.get(ticker)?.last || m.get(ticker)?.mark) || 0)
            .catch(() => 0);

          const spanDays = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000));
          const interval = spanDays <= 3 ? '5m' : spanDays <= 10 ? '15m' : spanDays <= 30 ? '1h' : '4h';

          let bars = [];
          let source = 'dxlink';

          // ── Primary: dxLink candles, the same feed the tape itself rides on.
          const streamer = symbolParam || buildStreamerSymbol(ticker, expiry, strike, type);
          if (streamer) {
            const fromMs = etSessionOpenMs(start);
            const toMs = Math.min(etSessionCloseMs(end), Date.now());
            // cache:false is REQUIRED here: candle-history keys its cache on
            // `symbol|interval` with no window in the key, so a cached one-session
            // pull would be handed straight back to an "All" request spanning
            // days (and vice versa). hardMs is raised over the default because a
            // thin far-OTM contract dribbles its snapshot out slowly.
            const rows = await fetchIntradayCandles(streamer, interval, fromMs, {
              cache: false, quietMs: 900, hardMs: 9000,
            }).catch((e) => {
              console.warn('[OPTION-HISTORY] dxlink', streamer, '->', String(e?.message || e).slice(0, 200));
              return [];
            });
            bars = (Array.isArray(rows) ? rows : []).filter((b) => b.time >= fromMs && b.time <= toMs);
          }

          // (A ThetaData fallback lived here for when dxLink returned nothing.
          // It was already gated on DATA_SOURCE=theta — calling it under tt is
          // what produced the old bad-gateway drawer, since the Terminal was not
          // necessarily running — so it has been dead for as long as the stack
          // has been on tt. ThetaData was removed 2026-08-18; dxLink is the only
          // source now and an empty `bars` is reported honestly.)

          sendJson(res, 200, { bars, start, end, interval, spot, source, symbol: streamer, elapsedMs: Date.now() - t0 });
        } catch (e) {
          // Log the upstream Theta message server-side — the browser only sees
          // the status, and "502" alone tells you nothing about which param the
          // terminal rejected.
          const msg = String(e?.message || e);
          console.warn('[OPTION-HISTORY]', ticker, expiry, strike, type, start, end, '->', msg.slice(0, 300));
          sendJson(res, 502, { error: msg, ticker, expiry, strike, type, start, end, elapsedMs: Date.now() - t0 });
        }
        return;
      }
      // Dev probe: live dealer inventory (buy/sell net) for one strike, from the
      // SAME FlowGexAccumulator the WS GEX chart's flowGEX is computed from
      // (server-v2/computation/gex-calculator.js flowGEX branch). Lets /owner/dev
      // show the real dealer-inventory flow GEX instead of the vol-basis proxy.
      // GET /proxy/flow-inventory?expiry=2026-06-22&strike=190
      if (pathname === '/proxy/flow-inventory' && req.method === 'GET') {
        const url = new URL(req.url || '/', 'http://localhost');
        const expiry = url.searchParams.get('expiry') || '';
        const strike = Number(url.searchParams.get('strike'));
        if (!proxy || !proxy.flowGexAccumulator) {
          sendJson(res, 503, { error: 'proxy not ready', expiry, strike });
          return;
        }
        const inv = proxy.flowGexAccumulator.getInventory(expiry).get(strike) || null;
        sendJson(res, 200, { expiry, strike, inventory: inv });
        return;
      }
      // Underlying watchlist quotes (broker, after-hours aware) for the toolbar
      // dropdown. GET /proxy/quotes?symbols=AAPL,SPX,/NQU26
      // Returns { items: [{ symbol, last, mark, close, prevClose }] } — mark/last
      // update in pre/post market; close = today's 4pm regular close.
      if (pathname === '/proxy/quotes' && req.method === 'GET') {
        const url = new URL(req.url || '/', 'http://localhost');
        const symbols = (url.searchParams.get('symbols') || '')
          .split(',').map((s) => s.trim()).filter(Boolean);
        try {
          const map = await fetchUnderlyingQuotes(symbols);
          const items = symbols.map((sym) => {
            const q = map.get(sym) || {};
            return { symbol: sym, last: q.last || 0, mark: q.mark || 0, close: q.close || 0, prevClose: q.prevClose || 0 };
          });
          sendJson(res, 200, { data: { items } });
        } catch (e) {
          sendJson(res, 502, { error: String(e?.message || e) });
        }
        return;
      }
      // Semi Strength quotes — Tastytrade ONLY (no ThetaData). last / prev-close /
      // today's RTH open per equity, for the SSI's dual baseline (vs prior close +
      // vs 09:30 open). GET /proxy/semi-quotes?symbols=NVDA,SMH,SPY
      //   → { items:[{symbol,last,mark,close,prevClose,open,high,low}] }
      if (pathname === '/proxy/semi-quotes' && req.method === 'GET') {
        const url = new URL(req.url || '/', 'http://localhost');
        const symbols = (url.searchParams.get('symbols') || '')
          .split(',').map((s) => s.trim()).filter(Boolean);
        try {
          const map = await fetchUnderlyingDayOhlc(symbols);
          const items = symbols.map((sym) => {
            const q = map.get(String(sym).toUpperCase()) || {};
            return {
              symbol: sym,
              last: q.last || 0, mark: q.mark || 0, close: q.close || 0,
              prevClose: q.prevClose || 0, open: q.open || 0, high: q.high || 0, low: q.low || 0,
            };
          });
          sendJson(res, 200, { data: { items } });
        } catch (e) {
          sendJson(res, 502, { error: String(e?.message || e) });
        }
        return;
      }
      // ── Legacy nested chain adapters ─────────────────────────────────────
      // The options-chain / mult-greek / insights pages fetch /api/chains and
      // /api/expirations, which forward here as /proxy/api/tt/chains/:ticker and
      // /proxy/api/tt/expirations/:ticker. server-v2 didn't implement these
      // (only the single-symbol live feed routes), so both pages got a 404 and
      // showed no data / an empty expiry dropdown. These adapters rebuild the
      // legacy nested payload from REST for ANY ticker, after-hours included.
      {
        const expMatch = pathname.match(/^\/proxy\/api\/tt\/expirations\/(.+)$/);
        if (req.method === 'GET' && expMatch) {
          const ticker = decodeURIComponent(expMatch[1]).split('?')[0];
          try {
            const data = await fetchExpirations(ticker);
            sendJson(res, 200, { data });
          } catch (e) {
            sendJson(res, 502, { error: String(e?.message || e), ticker });
          }
          return;
        }
        // Market-data history: /proxy/api/tt/market-data/history/:symbol
        // Backs /api/dxlink/candles (the zones tab). fetchDailyHistory() returns
        // WEEKLY OHLC bars (from Yahoo) ready for the client's zone math.
        const histMatch = pathname.match(/^\/proxy\/api\/tt\/market-data\/history\/(.+)$/);
        if (req.method === 'GET' && histMatch) {
          const symbol = decodeURIComponent(histMatch[1]).split('?')[0];
          try {
            sendJson(res, 200, await fetchDailyHistory(symbol));
          } catch (e) {
            sendJson(res, 502, { error: String(e?.message || e), symbol });
          }
          return;
        }
        // On-demand zones: /proxy/api/tt/em-zones?ticker=AAPL
        // Buy/Sell zones from last week's weekly candle for ANY ticker (the
        // long-tail names the weekly publisher doesn't pre-compute). Static for
        // the week; the Next /api/em-zones route caches the result.
        if (req.method === 'GET' && pathname === '/proxy/api/tt/em-zones') {
          const url = new URL(req.url || '/', 'http://localhost');
          const ticker = (url.searchParams.get('ticker') || '').trim().toUpperCase();
          if (!ticker) { sendJson(res, 400, { error: 'ticker required' }); return; }
          try {
            const { computeZonesPayload } = require('./levels-engine');
            const data = await computeZonesPayload(`http://localhost:${PORT}`, ticker);
            sendJson(res, 200, { data });
          } catch (e) {
            sendJson(res, 502, { error: String(e?.message || e), ticker });
          }
          return;
        }
        // Option marks: /proxy/api/tt/option-marks?symbols=OCC1,OCC2
        // Backs /api/em/option-marks — the EstimatedMoves IV=0 straddle fallback.
        // Without this adapter every per-strike call 404'd (log spam) and the
        // fallback got no marks. Index OCC symbols are routed to index-option[].
        if (req.method === 'GET' && pathname === '/proxy/api/tt/option-marks') {
          const url = new URL(req.url || '/', 'http://localhost');
          const symbols = (url.searchParams.get('symbols') || '')
            .split(',').map((s) => s.trim()).filter(Boolean);
          try {
            // Serve from the live subscriber when it fully covers the request
            // (no upstream pull); fall back to REST otherwise.
            const live = proxy?.serveOptionMarksFromLive?.(symbols) || null;
            const data = live || await fetchOptionMarks(symbols);
            sendJson(res, 200, { data, source: live ? 'live' : 'rest' });
          } catch (e) {
            sendJson(res, 502, { error: String(e?.message || e) });
          }
          return;
        }
        const chainMatch = pathname.match(/^\/proxy\/api\/tt\/chains\/(.+)$/);
        if (req.method === 'GET' && chainMatch) {
          const url = new URL(req.url || '/', 'http://localhost');
          const ticker = decodeURIComponent(chainMatch[1]).split('?')[0];
          const expiration = url.searchParams.get('expiration') || '';
          try {
            // Serve from the live subscriber when it fully covers the request
            // (active SPX expiry, in-window strikes) — no upstream REST pull.
            // Returns null when not fully covered → fall back to REST unchanged.
            const live = proxy?.serveChainFromLive?.(ticker, expiration) || null;
            const data = live || await fetchChainFull(ticker, expiration);
            sendJson(res, 200, { data, context: live ? 'live' : 'rest' });
          } catch (e) {
            sendJson(res, 502, { error: String(e?.message || e), ticker });
          }
          return;
        }
      }

      if (await handleProxyRest(req, res)) return;
    } catch (err) {
      captureError(err, { route: req.url, method: req.method });
      sendJson(res, 500, { error: String(err?.message || err) });
      return;
    }
    // In-process API routes (api-router.js) run just before the Next fallthrough.
    // Only registered routes are handled here; unregistered /api/* still falls
    // through to Next. Kill-switch: unset/0 → 100% Next (no behavior change).
    if (process.env.API_ROUTER === '1') {
      try {
        if (await handleApiRoute(req, res, apiCtx)) return;
      } catch (err) {
        captureError(err, { route: req.url, method: req.method, at: 'api-router' });
        sendJson(res, 500, { error: String(err?.message || err) }, req);
        return;
      }
    }
    // Next's handler parses the URL itself when not provided one.
    handle(req, res);
  });

  // Attach WS broadcaster (/ws/gex).
  const { wss, broadcastEvent } = createGexWsServer(server, { log: console });

  // Start the live feed — UNLESS idle was left ON. Idle is now a true bandwidth
  // kill-switch, so a restart while idle must stay paused (no dxLink, no quotes,
  // no broadcasts) until the owner toggles it back on from the dashboard.
  proxy = new TastytradeProxy();

  // Start the feed with bounded retry. Theta (sibling container) may not be
  // ready at boot even with compose `depends_on: service_healthy` — the v3 jar
  // download + auth handshake can lag the healthcheck. Without retry, a single
  // "fetch failed" left the feed dead (spot:0 / cold first load) until a manual
  // restart. We now re-attempt with backoff until it starts, then a watchdog
  // (below) keeps it warm. Respects the idle kill-switch: if the owner left idle
  // ON, we never start — that's a deliberate pause, not a failure.
  async function startFeedWithRetry() {
    if (proxy.idle || TastytradeProxy.idlePersisted()) {
      proxy.idle = true;
      marketState.setStatus({ idle: true });
      console.log('[SERVER-V2] idle persisted ON — feed left paused (toggle off to start)');
      return;
    }
    let attempt = 0;
    // backoff: 2s, 4s, 8s … capped at 30s, retry forever (Theta will come up)
    for (;;) {
      try {
        await proxy.start();
        console.log(`[SERVER-V2] Tastytrade/dxLink feed started${attempt ? ` (after ${attempt} retr${attempt === 1 ? 'y' : 'ies'})` : ''}`);
        marketState.setError(null);
        return;
      } catch (err) {
        attempt++;
        const waitMs = Math.min(2000 * 2 ** (attempt - 1), 30000);
        console.error(`[SERVER-V2] Feed failed to start (attempt ${attempt}): ${err.message} — retrying in ${waitMs / 1000}s`);
        marketState.setError(`feed: ${err.message} (retrying)`);
        if (proxy.idle) { console.log('[SERVER-V2] idle toggled ON during retry — stopping feed start'); return; }
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
  await startFeedWithRetry();

  // Keep-warm watchdog: every 30s, if the feed is NOT idle-paused but has gone
  // unhealthy (Theta blip, dropped dxLink, no recent frames), kick it back to
  // life so the dashboard is always warm — no cold load waiting for the next
  // page visit. Idle stays sacred: when the owner pauses, we leave it paused.
  //
  // Runs 24/7 (no RTH gate, unlike flow-watchdog) — this is the dxLink feed
  // itself, which is expected to stay live off-hours too, and the "flow
  // stopped overnight, had to restart it by hand" incident (2026-07-23) was
  // exactly this loop silently retrying with no page. If auto-restart hasn't
  // brought it back within FEED_STALE_ALERT_MS, email/push via the same
  // sendAlert channel flow-watchdog uses, then again on recovery.
  const FEED_WARM_INTERVAL_MS = 30000;
  const FEED_STALE_ALERT_MS = Number(process.env.FEED_STALE_ALERT_MS || 5 * 60_000);
  const { sendAlert } = require('./state/alerts');
  let feedUnhealthySince = 0;
  let feedStaleAlerted = false;
  setInterval(async () => {
    if (!proxy || proxy.idle) return;            // paused on purpose — don't touch
    let healthy = false;
    try {
      // Prefer an explicit health signal if the proxy exposes one; otherwise
      // fall back to "do we have a live spot". spot:0 == feed is cold.
      if (typeof proxy.isHealthy === 'function') healthy = !!proxy.isHealthy();
      else healthy = ((proxy.spot || marketState.getSpot?.() || 0) > 0);
    } catch { healthy = false; }
    if (healthy) {
      if (feedStaleAlerted) {
        const downMin = Math.round((Date.now() - feedUnhealthySince) / 60000);
        sendAlert({
          key: 'dxlink-feed-recovered',
          subject: 'CB Edge: dxLink feed recovered',
          message: `The Tastytrade/dxLink feed came back on its own after ~${downMin} min down. No action needed.`,
        }).catch(() => {});
      }
      feedUnhealthySince = 0;
      feedStaleAlerted = false;
      return;
    }
    if (!feedUnhealthySince) feedUnhealthySince = Date.now();
    console.warn('[SERVER-V2] keep-warm: feed looks cold (no live spot) — restarting feed');
    try {
      if (typeof proxy.stop === 'function') { try { await proxy.stop(); } catch {} }
      await startFeedWithRetry();
    } catch (err) {
      console.error('[SERVER-V2] keep-warm restart failed:', err.message);
    }
    if (!feedStaleAlerted && Date.now() - feedUnhealthySince > FEED_STALE_ALERT_MS) {
      feedStaleAlerted = true;
      const downMin = Math.round((Date.now() - feedUnhealthySince) / 60000);
      sendAlert({
        key: 'dxlink-feed-stale',
        subject: 'CB Edge: dxLink feed down',
        message: `The Tastytrade/dxLink feed has been down ~${downMin} min. Automatic restarts are running every `
          + `${FEED_WARM_INTERVAL_MS / 1000}s but haven't recovered it — check the box (docker compose logs -f `
          + 'app) or restart the container by hand.',
      }).catch(() => {});
    }
  }, FEED_WARM_INTERVAL_MS).unref();

  // Route client commands (e.g. expiry switch) to the live proxy.
  // Dashboard sends { type:'SET_EXPIRY', expiry }; also accept 'setExpiry'.
  //
  // The expiry is process-wide, not per-connection, and it also selects what
  // gex-history-writer stamps on the rows it persists — so this message lets any
  // one browser redirect the recorder for everybody. It is tagged 'client-ws' and
  // dropped by setExpiry() while GEX_EXPIRY_LOCK is on (the default); see the
  // EXPIRY_LOCK block in proxy-tastytrade.js.
  wss.on('client-message', ({ parsed }) => {
    const t = parsed?.type;
    if ((t === 'SET_EXPIRY' || t === 'setExpiry') && proxy) {
      proxy.setExpiry(parsed.expiry, 'client-ws');
    }
    if ((t === 'SET_IDLE' || t === 'setIdle') && proxy) {
      proxy.setIdle(!!parsed.idle);
    }
  });

  server.listen(PORT, () => {
    console.log(`[SERVER-V2] listening on http://localhost:${PORT}  (ws ${PORT}/ws/gex, rest /proxy/*)`);
    // Resolve the editable rosters BEFORE the recorders take their first pass,
    // so the synchronous accessors (multi-flow's constructor, the oi-daily idle
    // check) see baseline+overrides rather than the bare file. Fire-and-forget:
    // every consumer falls back to its file baseline until this lands, so a slow
    // or missing DB delays nothing.
    rosterStore.primeRosters().catch(() => {});
    // In-process MVC auto-collector: writes a snapshot every 5m during RTH.
    require('./mvc-auto-snapshot').startMvcAutoSnapshot(PORT);
    // EOD GEX recorder: upserts one row per ($SPX/SPY/QQQ) at 3:55–4:05 ET.
    startEodGexRecorder(PORT);
    // SPY/QQQ 1-min candle recorder: persists today's session bars into
    // etf_candles every 60s during RTH (feeds the /test Condition price line's
    // history going forward). Isolated dxLink fetch — see state/etf-candle-recorder.
    startEtfCandleRecorder();
    // SPY/QQQ per-strike GEX recorder: polls their option chains every 60s
    // during RTH and writes one row per strike into option_strike_gex_history
    // with symbol='SPY'/'QQQ' — the same table and writer the live SPX feed
    // uses. Backs the ES-Candles page's SPY/QQQ heatmap, bubbles and rail.
    startEtfGexRecorder();
    // Daily per-strike OPEN INTEREST snapshot (9:32 ET, weekdays) across the
    // scanner watchlist → oi_daily. OI settles overnight and does not tick
    // intraday, so one snapshot a day is the whole signal; the Options Chain
    // OI tab diffs today's row against the previous snapshot date to show what
    // positioning was actually opened or closed overnight.
    startOiDailyRecorder();
    // Daily per-strike NET GEX snapshot (16:05 ET, weekdays) of the whole
    // board minus 0DTE, across the scanner watchlist → eod_strike_gex. Fires
    // after the close because the OI+Vol basis is half day-volume, which is
    // only final once the 16:00 print is in. ±40 strikes around the closing
    // spot per symbol; the Ticker Lookup Δ column diffs today's row against
    // the previous snapshot date to show which walls were built or taken off.
    startEodStrikeGexRecorder();
    // Daily near-the-money PREMIUM TRADED snapshot (16:05 ET, weekdays) →
    // atm_prem_diff. Fires after the close because it reads the chain's DAY
    // VOLUME, which is only final once the 16:00 print is in. One row per
    // (symbol, front/back monthly, band); the Prem Diff panel plots put premium
    // minus call premium from it. This is the ONLY thing that grows the series
    // forward — atm-prem-backfill.js can rebuild the past from dxLink candles,
    // but today's tape has to be captured today.
    startAtmPremRecorder();
    // GEX Levels history recorder: persists the /test GEX Levels "History of
    // key level changes" row (walls/flip/$gamma/CPG/R2/S2/OI) forever in PG.
    require('./gex-levels-history-recorder').startGexLevelsHistoryRecorder(PORT);
    // Earnings calendar: Sat 09:00 ET scrape of next Mon–Fri from Nasdaq,
    // mcap ≥ $100B → earnings_calendar (feeds /economic-calendar bottom strip).
    require('./earnings-calendar-recorder').startEarningsCalendarRecorder();
    // Day-post writer: auto-generates the premarket/midday/EOD X posts
    // (Anthropic via /api/social-media/day-post) into day_posts at their slot
    // times, so the Social Media → Day Posts tab has a ready copy/paste list.
    require('./day-post-writer').startDayPostWriter(PORT);
    // Per-strike GEX growth recorder: sweeps the watchlist during RTH and stores
    // delta-vs-open per strike (feeds /strike-growth tracker + DoD Movers tabs).
    // Reads the LIVE dxLink feed (not Theta/REST) — pass the shared proxy so
    // startStrikeGrowthFeed() can subscribe on the same connection.
    startStrikeGrowthRecorder(PORT, proxy);
    // Per-strike Greek snapshots: records gamma/delta/vanna/charm per strike
    // every 5m for the Greek Sensitivity Scanner (/scanner Greeks tab).
    startGreekScannerRecorder(PORT);
    // Far CB Watch: flags EM-watchlist tickers whose single highest OI+Vol GEX
    // strike (within 30d expirations) sits unusually far OTM vs spot.
    startFarCbRecorder();
    // Multi-ticker GEX scanner: bulk-REST whole-chain snapshot per SCANNER_TICKERS
    // root every 5m (total net GEX / walls / flip / CB). Idle unless SCANNER_TICKERS set.
    startScannerRecorder();
    // Walls: call wall / put wall / CB tracked across the scanner universe on a
    // fixed clock (09:29 open + every 15m to 16:00). Reads scanner_snapshots —
    // no extra Theta load — and writes change-only rows into walls_log plus
    // classified touch events into wall_events. Feeds /proxy/walls + the owner
    // Results → Walls tab.
    startWallsRecorder();
    // Reach Rank: the distance model layered on top of Walls. Nightly at 16:45
    // ET it replays the session into wall_reach (how far each level sat in ATR
    // units, and whether price got there) and re-snapshots wall_calibration
    // as_of TOMORROW — so tomorrow's live ranking scores every level against a
    // curve fitted only on sessions it has never seen. Feeds /proxy/walls-reach
    // and decorates /proxy/walls.
    startWallsReach();
    // Proximity alerts: every 5m during RTH, anything that just came inside
    // 0.25x ATR of a level WHILE CLOSING is written to wall_alerts and shows up
    // in the Walls tab's alert feed. No email, no push — on-page only.
    startWallsWatch();
    // Forward walls: the next unexpired contract, swept pre-open and post-close
    // into its own table so the 0DTE stack's one-expiry-per-session invariant
    // is never violated.
    startForwardScanner();
    // Hourly "very strong" GEX-change recorder: at the top of each RTH hour,
    // scores the strike_growth universe (60m window), keeps the top 5 ★ Very
    // strong strikes (|Δ| >= $500k & |% vs open| >= 30%) into gex_change_top.
    // Feeds /proxy/gex-change-top + the scanner "GEX Change Top" tab.
    // PORT is passed so the recorder can auto-probe each pick through the
    // origin's own /api/watch (internal-token hop) — see the recorder header.
    startGexChangeTopRecorder(PORT);
    // NDX/SPY/QQQ 0DTE call/put wall recorder: writes one row per ticker every
    // 60s so the Walls & Flows tab's 5/15/30/60m windows persist server-side
    // instead of depending on a browser tab staying open. NDX runs 24/7;
    // SPY/QQQ only tick during RTH. Feeds /proxy/wall-history.
    startTickerWallRecorder();
    // Net greeks time-series: writes $SPX net GEX/DEX/CHEX/VEX every 5m during
    // RTH into greeks_ts (feeds the Analytics "Net Greeks" card).
    startGreeksTsWriter(PORT);
    // In-process weekly publisher for the customer /em page: computes EM + zones
    // server-side and POSTs each ticker to /api/levels (Sat ~09:00 ET, then
    // auto-retries unpriced tickers on a backoff). No startup publish by design.
    require('./levels-auto-publish').startLevelsAutoPublish(PORT);
    // In-process weekly EM Tracker evaluator: every Sat ~09:00 ET scores last
    // week's close vs the EM band (win = closed inside) and POSTs to /api/em-tracker.
    require('./em-tracker-auto-eval').startEmTrackerAutoEval(PORT);
    // In-process condor price tracker: hourly (10:00-16:00 ET) it snapshots the
    // live NBBO mid on all four legs of every OPEN condor in the current week
    // into em_condor_ticks; at 16:15 ET it re-prices the week off Theta's EOD
    // history into em_condor_marks (the series the Iron Condors tab reads) and
    // prunes ticks older than 120 days. Weekdays only; every fire is idempotent.
    require('./condor-mark-recorder').startCondorMarkRecorder(PORT);
    // Morning budget briefing: daily 08:00 ET, emails the owner a written
    // summary + screenshots of /owner/budget (Overview + Prop). Force a send
    // any time via POST /proxy/budget-email-run.
    require('./budget-email').startBudgetEmail(PORT);
    // Overnight ES gap tracker: DISABLED — CPU cost not worth it (5-min RTH cron).
    // Re-enable by uncommenting: require('./es-gap-tracker').startEsGapTracker(PORT);
    // In-process ICT setup recorder: every 5m during RTH detects every live ICT
    // setup (same analyzeICT the /ict page renders), records new ones, and grades
    // pending ones by follow-through → /api/ict-setups.
    require('./ict-setup-tracker').startIctSetupTracker(PORT);
    // EOD IB results: daily at 16:30 ET, computes the finished session's Initial
    // Balance + 14-rule scoreboard (ES+NQ) from the persisted 5m candles →
    // ib_daily_results, read by the IB Stats tab's Daily Results table.
    require('./ib-results-recorder').startIbResultsRecorder(PORT);
    // TPO profile recorder: nightly at 16:30 ET, builds the finished RTH session's
    // TPO time-profile (same period/bin/POC/VA logic as lib/tpo.ts) and snapshots
    // the ~10:30 ET GEX walls/flip from option_strike_gex_history → tpo_profiles.
    // Feeds the profile forecaster (analyze/tpo_forecast*.py); its whole job is to
    // accumulate {realized profile + IB-close state + 10:30 GEX} history so the
    // GEX-vs-IB test becomes runnable once there's enough overlap.
    require('./tpo-profiles-recorder').startTpoProfilesRecorder();
    // Momentum Bias grader: grades pending TP/reversal signals (recorded inline
    // by the feed in _flushEsCandles) via follow-through every 5m → the
    // momentum_bias_signals table. Read via /api/momentum-bias.
    require('./momentum-bias-tracker').startMomentumBiasGrader();
    // GEX/CB actionable signal engine for the ES Candles page: every few seconds
    // during the futures session it turns the live heatmap levels (flip cross,
    // Call/Put wall reject+break, CB reaction, level confluence) into long/short
    // ES signals → trade_signals table (+ optional Discord). Alerts only, no
    // orders. Read via /proxy/signals; force a pass via POST /proxy/signals-run.
    startSignalsEngine(PORT);
    // Econ-calendar countdown alerts: polls /api/calendar every 20s and appends
    // "5 minutes to <event>" / "1 minute to <event>" lines to public/signals.txt
    // for High/Medium impact events, read by the home SignalsFeed as [Econ] chips.
    require('./econ-alert-recorder').startEconAlertRecorder(PORT);
    // Discord relay: mirrors public/signals.txt (hand-authored + AUTO econ block)
    // into the signals Discord channel. Engine signals (/proxy/signals) reach the
    // same channel via signals-engine.js's own SIGNALS_DISCORD_WEBHOOK — point
    // both env vars at the same webhook and Discord matches the home feed.
    require('./discord-relay').startDiscordRelay();
    // Reference-levels cache: writes PDH/PDL after RTH close (16:05 ET) and
    // PWH/PWL on Sunday into ref_levels, so the Analytics Levels card reads them
    // via /api/ref-levels instead of recomputing from 20 days of ES candles.
    require('./ref-levels-recorder').startRefLevelsRecorder(PORT);
    // Delayed preview feed for signed-up-but-unpaid users (/preview page):
    // every 30m during RTH, snapshots spot + call/put wall + gamma flip from
    // the same /api/gex the paid dashboard reads → preview_snapshots.
    require('./preview-snapshot-recorder').startPreviewSnapshotRecorder(PORT);
    // Delayed FULL-chain feed for /home in "delayed" mode (unpaid signed-in
    // users): every 30m during RTH, snapshots the entire hot /proxy/gex
    // payload → home_static_snapshots, so unpaid /home renders the same chart
    // component as paid users, just frozen.
    require('./home-snapshot-recorder').startHomeSnapshotRecorder(PORT);
    // Delayed feed for /mult-greek in "delayed" mode (unpaid signed-in users):
    // every 30m during RTH, snapshots the SPX/SPY/QQQ chain at one shared
    // near-dated expiry → mult_greek_static_snapshots.
    require('./mult-greek-snapshot-recorder').startMultGreekSnapshotRecorder(PORT);
    // Per-strike NET GEX history (SPX/SPY/QQQ/IWM, 4 closest expiries) every 60s
    // during RTH → mult_greek_gex_ring/open, backing the /mult-greek click card's
    // 15m/30m/open change. Guarded — never crash startup if it fails to load.
    try { multGreekGexRecorder?.startMultGreekGexRecorder?.(PORT); }
    catch (e) { console.warn('[mult-greek-gex] start failed:', e.message); }
    // Multi Greek LADDERS snapshot → Discord, every 15m on the wall-clock
    // boundary during RTH. Same picture the page's 🗒 LADDERS button produces
    // (SPX/SPY/QQQ front-expiry CB/CW/PW + spot), drawn in headless Chromium and
    // posted to the CB Edge Signals channel (HOME_SIGNALS_DISCORD_WEBHOOK /
    // SIGNALS_DISCORD_WEBHOOK), overridable via MG_LADDER_DISCORD_WEBHOOK.
    // Guarded — never crash startup if puppeteer/chromium is missing.
    try { require('./mg-ladder-discord').startMgLadderDiscord(PORT); }
    catch (e) { console.warn('[mg-ladder] start failed:', e.message); }
    // Owner options watchlist: every 60s during market hours, refreshes every
    // watched contract's greeks/price/flow → /api/watch (writes watch_snapshots)
    // so the /owner/watch history keeps filling even when the page is closed.
    require('./watch-recorder').startWatchRecorder(PORT);
    // CB contract trade tracker: every 60s from 09:44-16:10 ET it opens the due
    // checkpoint (9:45/10:30/12:00) by probing the CB-strike 0DTE contract on
    // TastyTrade — the same /proxy/probe-rest pipeline /owner/probe and
    // /api/watch use — buys it when the mark is <= $1.00, re-prices every open
    // trade, sells the first poll SPX is inside the 5-10 pt band of the CB, and
    // marks out the rest at the bell → cb_trades / cb_trade_ticks, read by the
    // owner Results → Confidence → Trades tab. TT has no per-contract history,
    // so these live polls are the ONLY record — a session the process is down
    // for cannot be backfilled afterwards. Guarded so an optional feature module
    // can never take the origin down on boot (the etf-candle-recorder lesson).
    try { require('./cb-trade-recorder').startCbTradeRecorder(PORT); }
    catch (e) { console.warn('[cb-trades] start failed:', e.message); }

    // Nightly retention prune (00:05-00:40 ET): deletes aged-out rows from the
    // high-volume tape/snapshot tables (flow_prints, option_strike_gex_history,
    // strike_growth, darkpool_prints, etc. — see server-v2/state/retention-cleanup.js
    // for the full list + per-table cutoffs) and runs a plain VACUUM (ANALYZE)
    // afterward. Deliberately never runs VACUUM FULL unattended — that needs up
    // to 2x a table's on-disk size free and running it blind on a tight disk is
    // what took the DB down in the first place; reclaiming actual file size back
    // stays a manual, monitored step (scripts/db-prune.sql).
    require('./state/retention-cleanup').startRetentionCleanup();

    // Traders Dashboard overnight overview: at ~07:00 ET (weekdays) Claude
    // web-searches what moved markets overnight and writes td_overview.
    require('./overview-generator').startOverviewGenerator(PORT);

    // Analytics Premarket card: at ~08:00 ET (weekdays) Claude turns the global
    // overnight tape + SPX gap/fair-value into a 5-bullet read → premarket_summary.
    require('./premarket-summary-generator').startPremarketSummaryGenerator(PORT);

    // Analytics strategy-builder card: at ~08:20 ET (weekdays) Claude turns the
    // morning positioning/levels/calendar snapshot into a full daily SPX/ES
    // strategy → daily_strategy.
    require('./strategy-generator').startStrategyGenerator(PORT);
  });

  const shutdown = () => {
    console.log('[SERVER-V2] shutting down...');
    proxy?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[SERVER-V2] fatal:', err);
  try { captureError(err, { kind: 'boot-fatal' }); } catch {}
  process.exit(1);
});
