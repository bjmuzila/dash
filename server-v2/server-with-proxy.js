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
const { fetchOptionDailyHistoryTheta, fetchOptionIntradayTheta } = require('./proxy-thetadata');
const { startEodGexRecorder } = require('./eod-gex-recorder');
const { getEsSpxBasis } = require('./es-spx-basis');
const { startGreeksTsWriter } = require('./greeks-ts-writer');
const { startStrikeGrowthRecorder } = require('./strike-growth-recorder');
const { startGreekScannerRecorder, runSnapshot: runGreekSnapshot, ensureSchema: greekEnsureSchema, getPool: greekGetPool } = require('./greek-scanner-recorder');
const { startVolPinRecorder, runSweep: runVolPinSweep, ensureSchema: volPinEnsureSchema, getPool: volPinGetPool } = require('./vol-pin-recorder');
const { startFarCbRecorder, runSweep: runFarCbSweep, runGrading: runFarCbGrading, ensureSchema: farCbEnsureSchema, getPool: farCbGetPool, computeOutcomeDetail: farCbOutcomeDetail, enrichOutcomesWithQuotes: farCbEnrichOutcomes, toYmd: farCbToYmd, OTM_THRESHOLD_PCT: FAR_CB_OTM_PCT } = require('./far-cb-recorder');
const { startScannerRecorder, runSweep: runScannerSweep, ensureSchema: scannerEnsureSchema, getPool: scannerGetPool, parseScannerTickers } = require('./scanner-recorder');
const {
  startSignalsEngine, getRecentSignals: getSignalRows, runOnce: runSignalsOnce,
  ALERT_CATALOG: SIGNAL_ALERT_CATALOG, listAlertSettings: listSignalAlertSettings,
  setAlertEnabled: setSignalAlertEnabled,
} = require('./signals-engine');
const { checkProxyAccess } = require('./proxy-auth');
const { initObservability, captureError } = require('./observability');

const PORT = parseInt(process.env.PORT || '3001', 10);
const DEV = process.env.NODE_ENV !== 'production';

// Maintenance mode: when ON, the Next middleware serves /maintenance to every
// non-owner request. Toggled at runtime from the owner dashboard; defaults from
// MAINTENANCE_MODE env at boot (resets to that default on restart/redeploy).
let maintenanceMode = process.env.MAINTENANCE_MODE === '1' || process.env.MAINTENANCE_MODE === 'true';

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
        let body = '';
        req.on('data', (d) => { body += d; });
        req.on('end', () => {
          try {
            const { expiry } = JSON.parse(body);
            if (expiry && proxy) { proxy.setExpiry(expiry); sendJson(res, 200, { ok: true, expiry }); }
            else sendJson(res, 400, { error: 'missing expiry or proxy not ready' });
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

/**
 * True when an epoch-ms timestamp falls inside the RTH cash session
 * (09:30–16:00 America/New_York). Uses Intl in the ET zone rather than a UTC
 * offset so DST is handled — a hardcoded -5/-4 gets this wrong twice a year.
 * Half-days (13:00 close) still pass; they're just short, not misaligned.
 */
function isRthEt(ms) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms));
  const hh = Number(p.find((x) => x.type === 'hour')?.value);
  const mm = Number(p.find((x) => x.type === 'minute')?.value);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false;
  const mins = hh * 60 + mm;
  return mins >= 9 * 60 + 30 && mins <= 16 * 60;
}

/**
 * SQL mirror of isRthEt() for the row-selecting queries below, so "does this
 * date have a session worth drawing" is answered in Postgres instead of by
 * pulling the day and counting survivors in JS. `timestamp` is BIGINT ms, so
 * /1000.0 → to_timestamp() → shift into ET → compare the clock time. Uses the
 * named zone (not a fixed offset) for the same DST reason as isRthEt. Alias the
 * column (h.timestamp) — bare `timestamp` in an expression collides with the
 * type-literal syntax.
 */
const RTH_ET_SQL = `
  (timezone('America/New_York', to_timestamp(h.timestamp / 1000.0)))::time
    BETWEEN TIME '09:30' AND TIME '16:00'`;

/**
 * The trading session the 3D map should be showing, rolling at 08:00 ET rather
 * than midnight. Between the close and 08:00 the next morning there is nothing
 * new worth showing — the new contract has no recorded surface yet — so a
 * midnight rollover would blank the map overnight and then show a 1-tower stub
 * through the pre-market. Holding the finished session until 08:00 keeps the
 * last real terrain up, then hands over to the new contract.
 *
 * Returns YYYY-MM-DD in ET. Weekends/holidays are NOT special-cased here; the
 * caller falls back to the most recent date that actually has RTH rows, which
 * covers them (and any day the feed was down) without a holiday calendar.
 *
 * NOTE this is only the ANCHOR — the newest session the caller may show, not
 * the one it will. Because the fallback requires an RTH row, the real handover
 * to the new contract happens at the first 09:30 write, not at 08:00; this just
 * stops the walk-back from reaching past today.
 */
function sessionYmdET(now = Date.now()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false, hour: '2-digit',
  }).formatToParts(new Date(now));
  const hh = Number(p.find((x) => x.type === 'hour')?.value);
  // Before 08:00 ET we're still "yesterday's session" — step back a day.
  const anchor = Number.isFinite(hh) && hh < 8 ? now - 24 * 3600_000 : now;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(anchor));
}

/**
 * mode=series — the whole session as a strike × time grid, for the /gex-3d
 * terrain map. The default (mode=point) answers "what was strike K N minutes
 * ago"; this answers "what did the entire surface do all day", which is a
 * different query shape (one pass, grouped by snapshot timestamp) and must not
 * be faked by looping `point` over 30 ages — that's 30 round-trips.
 *
 * option_strike_gex_history is written once/60s with a SHARED timestamp across
 * every strike in the snapshot (see gex-history-writer), so grouping on the raw
 * timestamp gives clean columns with no bucketing needed.
 *
 * Returns { mode:"series", basis, expiry, date, strikes[], times[], rows[][],
 *           spotPath[], updatedAt } where rows[t][s] is net GEX in raw units
 * (client scales) and null means "no row recorded for that strike/time".
 */
async function handleGexHistorySeries(req, res, { expiry, basis, col }) {
  const { searchParams } = new URL(req.url || '/', 'http://localhost');
  const dateParam = searchParams.get('date');
  const windowSize = Math.max(4, Math.min(60, Number(searchParams.get('window')) || 13));
  // Cap raised to 400 so a caller can ask for TRUE 1-minute columns (a full RTH
  // session is ~390 minutes). The old 120 cap silently downsampled and the
  // client had no way to tell it was looking at every-Nth-minute point samples.
  const maxCols = Math.max(4, Math.min(400, Number(searchParams.get('buckets')) || 30));

  const pool = getHistPool();
  const empty = { mode: 'series', basis, expiry, date: dateParam || null, strikes: [], times: [], rows: [], spotPath: [] };
  if (!pool) return sendJson(res, 200, empty);

  // Resolve the session to show. Explicit ?date wins; otherwise take the 08:00-ET
  // session anchor and walk back to the most recent date that actually has RTH
  // rows (covers weekends, holidays, and feed outages without a holiday calendar).
  //
  // The RTH predicate is load-bearing, not a tidy-up: the writer is not RTH-gated
  // (it persists whenever the feed is up), so from 08:00 ET the anchor rolls to
  // today and today already HAS rows — premarket ones. Matching on mere existence
  // therefore locked onto today, and the RTH filter further down then dropped
  // every column, so the map went blank from 08:00 until the first 09:30 write
  // instead of holding yesterday's terrain. Requiring an RTH row here means a
  // date is only chosen if it can actually produce columns.
  let date = dateParam;
  if (!date) {
    const anchor = sessionYmdET();
    const { rows: dr } = await pool.query(
      `SELECT h.date FROM option_strike_gex_history h
        WHERE h.date <= $1 AND ${RTH_ET_SQL}
        ORDER BY h.date DESC LIMIT 1`,
      [anchor]
    );
    date = dr[0]?.date || anchor;
  }

  // Resolve the contract. Explicit ?expiry wins; otherwise the expiry with the
  // most rows on that date — NOT marketState's live expiry, which has already
  // rolled to the new 0DTE by the time we're still displaying yesterday's map.
  let useExpiry = expiry;
  if (!searchParams.get('expiry')) {
    // Counted over RTH rows only, to match the date resolution above — an expiry
    // that leads on premarket volume but has no session rows would win the count
    // and then yield an empty grid.
    const { rows: er } = await pool.query(
      `SELECT h.expiry, COUNT(*) AS n FROM option_strike_gex_history h
        WHERE h.date = $1 AND ${RTH_ET_SQL}
        GROUP BY h.expiry ORDER BY n DESC LIMIT 1`,
      [date]
    );
    if (er[0]?.expiry) useExpiry = er[0].expiry;
  }
  empty.date = date;
  empty.expiry = useExpiry;
  if (!useExpiry) return sendJson(res, 200, empty);

  const { rows: raw } = await pool.query(
    `SELECT timestamp, strike, spot, ${col} AS val
       FROM option_strike_gex_history
      WHERE date = $1 AND expiry = $2 AND ${col} IS NOT NULL
      ORDER BY timestamp ASC, strike ASC`,
    [date, useExpiry]
  );
  if (!raw.length) return sendJson(res, 200, empty);

  // Group into snapshot columns keyed by the shared write timestamp.
  const byTs = new Map();
  for (const r of raw) {
    const ts = Number(r.timestamp);
    let e = byTs.get(ts);
    if (!e) { e = { ts, spot: Number(r.spot), vals: new Map() }; byTs.set(ts, e); }
    e.vals.set(Number(r.strike), Number(r.val));
  }
  // RTH only (09:30–16:00 ET). The writer runs whenever the feed is up, so
  // without this the terrain grows a long overnight/premarket tail of near-flat
  // columns that squeezes the actual session into a sliver of the Z axis.
  const rth = [...byTs.values()].filter((c) => isRthEt(c.ts)).sort((a, b) => a.ts - b.ts);
  if (!rth.length) return sendJson(res, 200, empty);

  // The writer persists once per 60s, so the RTH columns ARE the 1-minute
  // series — snapped to the minute here to absorb the few seconds of jitter in
  // when each write actually lands (dedupe keeps the last write in a minute).
  const byMinute = new Map();
  for (const c of rth) byMinute.set(Math.floor(c.ts / 60_000), c);
  const minuteCols = [...byMinute.values()].sort((a, b) => a.ts - b.ts);

  // Downsample to ≤ maxCols. NOTE this PICKS every-Nth minute rather than
  // averaging the ones between — a tower is always exactly one minute's
  // snapshot, never a blend. `strideMin` is echoed so the client can say so
  // honestly instead of implying each tower spans that many minutes.
  let cols = minuteCols;
  if (cols.length > maxCols) {
    const picked = [];
    for (let i = 0; i < maxCols; i++) picked.push(cols[Math.round((i * (cols.length - 1)) / (maxCols - 1))]);
    cols = picked;
  }
  const strideMin = cols.length > 1
    ? Math.max(1, Math.round((cols[1].ts - cols[0].ts) / 60_000))
    : 1;

  // Strike window centered on the LATEST spot, snapped to the strike grid that
  // actually has data (SPX records 5s and 10s — don't assume a step).
  const latest = cols[cols.length - 1];
  const allStrikes = [...new Set(raw.map((r) => Number(r.strike)))].sort((a, b) => a - b);
  const center = Number(latest.spot) || allStrikes[Math.floor(allStrikes.length / 2)];
  let ci = 0;
  for (let i = 1; i < allStrikes.length; i++) {
    if (Math.abs(allStrikes[i] - center) < Math.abs(allStrikes[ci] - center)) ci = i;
  }
  const strikes = allStrikes.slice(Math.max(0, ci - windowSize), ci + windowSize + 1);

  const rows = cols.map((c) => strikes.map((k) => {
    const v = c.vals.get(k);
    return Number.isFinite(v) ? v : null;
  }));

  // minutes=1 → also return the UNDOWNSAMPLED 1-minute grid. The 3D map's
  // bubbles are a per-minute per-strike |GEX| plot (same idea as the ES Candles
  // bubbles: area ∝ |GEX|); drawing them off the downsampled terrain columns
  // made them a redundant restatement of the terrain instead of their own,
  // finer-grained read of the session. ~390 RTH minutes × ~27 strikes.
  const payload = {
    mode: 'series',
    basis,
    expiry: useExpiry,
    date,
    /** True when this is a finished session being held up until 08:00 ET. */
    stale: date !== sessionYmdET(),
    strikes,
    times: cols.map((c) => c.ts),
    rows,
    spotPath: cols.map((c) => (Number.isFinite(Number(c.spot)) ? Number(c.spot) : null)),
    updatedAt: latest.ts,
    // Each column is ONE minute's snapshot; strideMin is the gap between the
    // minutes that survived downsampling (1 = every minute, nothing dropped).
    strideMin,
    minutesAvailable: minuteCols.length,
  };

  if (searchParams.get('minutes') === '1') {
    payload.minuteTimes = minuteCols.map((c) => c.ts);
    payload.minuteRows = minuteCols.map((c) => strikes.map((k) => {
      const v = c.vals.get(k);
      return Number.isFinite(v) ? v : null;
    }));
  }

  sendJson(res, 200, payload);
}

async function handleGexHistory(req, res) {
  const { searchParams } = new URL(req.url || '/', 'http://localhost');
  const expiry = searchParams.get('expiry') || marketState.getState().expiry || '';
  const ages = (searchParams.get('ages') || '5,15,30')
    .split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  // basis=vol → per-strike VOL-ONLY baselines (net_vol_gex) for the heatmap's
  // Vol GEX Speed column. Default stays net_gex so existing callers are unchanged.
  const basis = searchParams.get('basis') === 'vol' ? 'vol' : 'net';
  const col = basis === 'vol' ? 'net_vol_gex' : 'net_gex';

  // mode=series → full-session strike × time grid (/gex-3d). Default is the
  // original point-in-time baseline shape; existing callers are untouched.
  if (searchParams.get('mode') === 'series') {
    return handleGexHistorySeries(req, res, { expiry, basis, col });
  }

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
  for (const age of ages) {
    const target = now - age * 60_000;
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (strike) strike, ${col} AS val
         FROM option_strike_gex_history
        WHERE date = $1 AND expiry = $2 AND timestamp <= $3 AND ${col} IS NOT NULL
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
  const underlying = searchParams.get('underlying') || searchParams.get('symbol') || '';
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
  if (f.dteMin > 0) {
    params.push(f.dteMin);
    where += ` AND (expiration::date - CURRENT_DATE) >= $${params.length}`;
  }
  if (f.dteMax != null) {
    params.push(f.dteMax);
    where += ` AND (expiration::date - CURRENT_DATE) <= $${params.length}`;
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
  const underlying = (searchParams.get('underlying') || searchParams.get('symbol') || '').toUpperCase();
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
    exIdx: searchParams.get('exIdx') === '1',
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
    // Incremental refresh: re-scan only the trailing overlap window.
    const lastSec = hit.bins[hit.bins.length - 1].sec;
    const sinceMs = (lastSec - (NETPREM_OVERLAP_BINS - 1) * Math.floor(binMs / 1000)) * 1000;
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

// ── Netprem prewarm ─────────────────────────────────────────────────────────
// Keep the /flow chart's DEFAULT filter keys hot for the common tickers so the
// FIRST viewer of the day hits the incremental cache instead of paying the
// full-session GROUP BY. Runs during RTH only; each tick is an incremental
// refresh after the first. Disable with NETPREM_PREWARM=0.
const NETPREM_PREWARM_TICKERS = (process.env.NETPREM_PREWARM_TICKERS || 'SPX,SPY,QQQ')
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
        const { publishOnce, isPublishing } = require('./levels-auto-publish');
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
          publishOnce(`http://localhost:${PORT}`, 'manual').catch((e) => {
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
                        symbol, date, ts, spot, expiry, total_net_gex, call_wall, put_wall, gex_flip, strikes
                 FROM scanner_snapshots
                 ORDER BY symbol, ts DESC`
              : `SELECT DISTINCT ON (symbol)
                        symbol, date, ts, spot, expiry, total_net_gex, call_wall, put_wall, gex_flip, strikes
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
      // Manual sweep fire: POST /proxy/scanner-run
      if (pathname === '/proxy/scanner-run' && req.method === 'POST') {
        runScannerSweep({ force: true })
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // GET /proxy/scanner-tickers — the configured ticker universe (SCANNER_TICKERS),
      // used to populate the Options Positioning ticker picker on the client.
      if (pathname === '/proxy/scanner-tickers' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, tickers: parseScannerTickers() });
        return;
      }

      // ── Volatility Pinning Scanner ────────────────────────────────────────
      // GET /proxy/vol-pin-scanner?limit=25&minSnapshots=3
      //
      // Returns ranked pin candidates with:
      //   spread_trend   — is IV-RV spread contracting? (negative = shrinking)
      //   range_trend    — is price range contracting? (negative = tightening)
      //   pin_dist_pct   — |spot - pin_strike| / spot
      //   pin_score      — composite: higher = more likely to pin
      if (pathname === '/proxy/vol-pin-scanner' && req.method === 'GET') {
        (async () => {
          try {
            if (!(await volPinEnsureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = volPinGetPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const limit       = Math.min(100, Number(u.searchParams.get('limit') || 25));
            const minSnaps    = Math.max(2,   Number(u.searchParams.get('minSnapshots') || 3));
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

            // For each symbol: latest snapshot + trend of last 4 snapshots.
            const sql = `
              WITH latest AS (
                SELECT DISTINCT ON (symbol)
                  symbol, expiry, ts, spot, atm_strike, atm_iv, atm_call_iv, atm_put_iv,
                  pin_strike, pin_strike_oi, day_hi, day_lo, range_pct, rv_ann, iv_rv_spread
                FROM vol_pin_snapshots
                WHERE date = $1 AND atm_iv > 0
                ORDER BY symbol, ts DESC
              ),
              trend AS (
                SELECT symbol,
                  COUNT(*) AS n_snaps,
                  -- spread trend: slope approx = last_spread - first_spread over last 4 snaps
                  (ARRAY_AGG(iv_rv_spread ORDER BY ts DESC))[1]
                    - (ARRAY_AGG(iv_rv_spread ORDER BY ts ASC))[1] AS spread_delta,
                  (ARRAY_AGG(range_pct ORDER BY ts DESC))[1]
                    - (ARRAY_AGG(range_pct ORDER BY ts ASC))[1] AS range_delta
                FROM (
                  SELECT symbol, ts, iv_rv_spread, range_pct
                  FROM vol_pin_snapshots
                  WHERE date = $1 AND iv_rv_spread IS NOT NULL
                  ORDER BY symbol, ts DESC
                ) sub
                GROUP BY symbol
              )
              SELECT l.*,
                t.n_snaps, t.spread_delta, t.range_delta,
                CASE WHEN l.pin_strike > 0 AND l.spot > 0
                     THEN ABS(l.spot - l.pin_strike) / l.spot ELSE NULL END AS pin_dist_pct,
                -- Pin score: higher = more attractive pin candidate.
                -- Components: spread contraction (negative spread_delta good),
                --             range contraction (negative range_delta good),
                --             proximity to pin strike.
                CASE WHEN l.pin_strike > 0 AND l.spot > 0 AND l.atm_iv > 0 AND t.n_snaps >= $2 THEN
                  (CASE WHEN t.spread_delta < 0 THEN -t.spread_delta * 3 ELSE 0 END)
                  + (CASE WHEN t.range_delta < 0 THEN -t.range_delta * 100 ELSE 0 END)
                  + GREATEST(0, 0.05 - ABS(l.spot - l.pin_strike)/l.spot) * 40
                ELSE 0 END AS pin_score
              FROM latest l
              LEFT JOIN trend t ON t.symbol = l.symbol
              WHERE t.n_snaps >= $2
              ORDER BY pin_score DESC NULLS LAST
              LIMIT $3`;

            const { rows } = await p.query(sql, [today, minSnaps, limit]);
            sendJson(res, 200, { ok: true, rows, asOf: new Date().toISOString() });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Manual sweep fire: POST /proxy/vol-pin-run
      if (pathname === '/proxy/vol-pin-run' && req.method === 'POST') {
        runVolPinSweep({ force: true })
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }

      // ── Vol Pin Event Log ────────────────────────────────────────────────
      // GET /proxy/vol-pin-events?days=14&limit=200
      // Persisted history of first-time PINNING/SQUEEZING occurrences per
      // symbol/day (written by vol-pin-recorder's logPinEvents on each sweep).
      if (pathname === '/proxy/vol-pin-events' && req.method === 'GET') {
        (async () => {
          try {
            if (!(await volPinEnsureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = volPinGetPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const days  = Math.min(90, Math.max(1, Number(u.searchParams.get('days') || 14)));
            const limit = Math.min(500, Math.max(1, Number(u.searchParams.get('limit') || 200)));
            const cutoff = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
              .format(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
            const { rows } = await p.query(
              `SELECT date, symbol, status, ts, spot, pin_strike, pin_dist_pct,
                      iv_rv_spread, spread_delta, range_pct, range_delta
               FROM vol_pin_events
               WHERE date >= $1
               ORDER BY ts DESC
               LIMIT $2`,
              [cutoff, limit],
            );
            sendJson(res, 200, { ok: true, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
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
            // Attach the flagged contract's live price + % since today's open so
            // the Tracked-results table shows it without opening the row popup.
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
        const todayEt = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        const start = url.searchParams.get('start') || todayEt;
        const end = url.searchParams.get('end') || start;
        const t0 = Date.now();
        if (!ticker || !expiry || !(strike > 0)) {
          sendJson(res, 400, { error: 'ticker, expiry and strike required' });
          return;
        }
        try {
          // Strikes are selected by `strike_range` (dollars around that day's
          // spot), so a far-OTM strike needs a cushion wide enough to stay inside
          // the window — a default range would simply not return the contract.
          const spot = await fetchUnderlyingQuotes([ticker])
            .then((m) => Number(m.get(ticker)?.last || m.get(ticker)?.mark) || 0)
            .catch(() => 0);
          const cushion = spot > 0 ? Math.abs(strike - spot) + spot * 0.15 : strike * 0.25;

          const spanDays = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000));
          const interval = spanDays <= 3 ? '5m' : spanDays <= 10 ? '15m' : spanDays <= 30 ? '1h' : '4h';

          const bars = await fetchOptionIntradayTheta(
            ticker, expiry, strike, type, start, interval, cushion, end,
          );
          sendJson(res, 200, { bars, start, end, interval, spot, elapsedMs: Date.now() - t0 });
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
  const FEED_WARM_INTERVAL_MS = 30000;
  setInterval(async () => {
    if (!proxy || proxy.idle) return;            // paused on purpose — don't touch
    let healthy = false;
    try {
      // Prefer an explicit health signal if the proxy exposes one; otherwise
      // fall back to "do we have a live spot". spot:0 == feed is cold.
      if (typeof proxy.isHealthy === 'function') healthy = !!proxy.isHealthy();
      else healthy = ((proxy.spot || marketState.getSpot?.() || 0) > 0);
    } catch { healthy = false; }
    if (healthy) return;
    console.warn('[SERVER-V2] keep-warm: feed looks cold (no live spot) — restarting feed');
    try {
      if (typeof proxy.stop === 'function') { try { await proxy.stop(); } catch {} }
      await startFeedWithRetry();
    } catch (err) {
      console.error('[SERVER-V2] keep-warm restart failed:', err.message);
    }
  }, FEED_WARM_INTERVAL_MS).unref();

  // Route client commands (e.g. expiry switch) to the live proxy.
  // Dashboard sends { type:'SET_EXPIRY', expiry }; also accept 'setExpiry'.
  wss.on('client-message', ({ parsed }) => {
    const t = parsed?.type;
    if ((t === 'SET_EXPIRY' || t === 'setExpiry') && proxy) {
      proxy.setExpiry(parsed.expiry);
    }
    if ((t === 'SET_IDLE' || t === 'setIdle') && proxy) {
      proxy.setIdle(!!parsed.idle);
    }
  });

  server.listen(PORT, () => {
    console.log(`[SERVER-V2] listening on http://localhost:${PORT}  (ws ${PORT}/ws/gex, rest /proxy/*)`);
    // In-process MVC auto-collector: writes a snapshot every 5m during RTH.
    require('./mvc-auto-snapshot').startMvcAutoSnapshot(PORT);
    // EOD GEX recorder: upserts one row per ($SPX/SPY/QQQ) at 3:55–4:05 ET.
    startEodGexRecorder(PORT);
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
    // Per-strike GEX growth recorder: sweeps the watchlist every 30m during RTH
    // and stores delta-vs-open per strike (feeds /strike-growth tracker page).
    startStrikeGrowthRecorder(PORT);
    // Per-strike Greek snapshots: records gamma/delta/vanna/charm per strike
    // every 5m for the Greek Sensitivity Scanner (/scanner Greeks tab).
    startGreekScannerRecorder(PORT);
    // Vol-pin snapshots: ATM IV, RV, pin strike, range per equity ticker every 5m.
    startVolPinRecorder();
    // Far CB Watch: flags EM-watchlist tickers whose single highest OI+Vol GEX
    // strike (within 30d expirations) sits unusually far OTM vs spot.
    startFarCbRecorder();
    // Multi-ticker GEX scanner: bulk-REST whole-chain snapshot per SCANNER_TICKERS
    // root every 5m (total net GEX / walls / flip). Idle unless SCANNER_TICKERS set.
    startScannerRecorder();
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
    // Owner options watchlist: every 60s during market hours, refreshes every
    // watched contract's greeks/price/flow → /api/watch (writes watch_snapshots)
    // so the /owner/watch history keeps filling even when the page is closed.
    require('./watch-recorder').startWatchRecorder(PORT);

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
