'use strict';
/**
 * server-v2/_lib-lse.cjs — London Strategic Edge (LSE) vault REST client.
 *
 * WHY THIS EXISTS
 *   The LSE "lse-data" Python SDK is a thin wrapper over a plain HTTP API. This
 *   repo is a single Node process, so rather than ship a second runtime (python3
 *   + pip + a spawn() per request, ~150MB on the image) we speak the same HTTP
 *   the SDK speaks. Everything below was read straight out of lse/client.py and
 *   lse/vault.py so the semantics match the SDK call-for-call.
 *
 * THE API
 *   Base   https://api.londonstrategicedge.com/vault
 *   Auth   x-api-key: <LSE_API_KEY>
 *   UA     the download host sits behind a CDN that bounces the default
 *          urllib/undici User-Agent, so we send an explicit one. Do not remove.
 *
 *   GET /catalog                        every (dataset, symbol) with tick counts
 *                                       and first_tick/last_tick history span
 *   GET /meta                           vault shape (datasets, timeframes)
 *   GET /candles                        symbol,timeframe,start,end,limit,order,dataset
 *   GET /options/chain                  underlying,type,expiry,strike[_min|_max],
 *                                       min_dte,max_dte,limit
 *   GET /options/flow                   underlying,type,min_premium,expiry,max_dte,
 *                                       start,end,order,limit
 *   GET /options/candles                ticker (OSI),start,end,order,limit
 *
 * THE ROW CAP IS THE WHOLE DESIGN PROBLEM
 *   Every endpoint caps at 5000 rows per call — so "download all the history"
 *   is not one request, it is a walk. pageCandles()/pageFlow() below do that
 *   walk and yield page by page so a route can STREAM CSV to the browser
 *   instead of buffering a multi-hundred-MB array in the server's heap.
 *
 * KEY HANDLING
 *   The key is read from process.env.LSE_API_KEY at call time (never cached at
 *   module load, so a restart-free .env.local edit takes effect). It is never
 *   logged and never returned to the client — hasKey() only reports presence.
 */

const VAULT_URL = 'https://api.londonstrategicedge.com/vault';
// The CDN in front of the vault 403s unknown/absent User-Agents. Matches the SDK.
const USER_AGENT = 'lse-data-sdk (+https://londonstrategicedge.com)';

/** The vault's hard per-request row cap. Asking for more is silently truncated. */
const MAX_LIMIT = 5000;

/** Every resolution the vault serves, coarsest last. */
const TIMEFRAMES = [
  '1s', '5s', '15s', '30s', '1m', '3m', '5m',
  '15m', '30m', '1h', '4h', '1d', '1w', '1mo',
];

/** dataset id → the label the SDK's catalog() puts on it. */
const CATEGORY_LABELS = {
  stocks: 'Stocks', fx: 'Forex', crypto: 'Crypto', etf: 'ETFs',
  index: 'Indices', commodity: 'Commodities', options: 'Options',
  eurex: 'Futures', economics: 'Economics', bonds: 'Bonds',
  volatility: 'Volatility', interest_rates: 'Interest rates',
  currency_index: 'Currency index',
};

class LseError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'LseError';
    this.status = status;
  }
}

function apiKey() {
  return String(process.env.LSE_API_KEY || '').trim();
}

/** Presence only — the key itself never leaves this module. */
function hasKey() {
  return apiKey().length > 0;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * GET a vault path. `params` is an object; null/undefined/'' entries are dropped
 * (the SDK does the same, and an empty `start=` is a 400 upstream).
 */
async function vaultGet(path, params = {}, { timeoutMs = 60000 } = {}) {
  const key = apiKey();
  if (!key) {
    throw new LseError(503, 'LSE_API_KEY is not set on this server');
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    qs.append(k, String(v));
  }
  const url = `${VAULT_URL}${path}${qs.toString() ? `?${qs}` : ''}`;

  let resp;
  try {
    resp = await fetch(url, {
      headers: { 'x-api-key': key, 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Timeouts and transport failures surface as LseError too, so callers only
    // ever need one catch. status 0 = no HTTP response was received.
    throw new LseError(0, `request failed before an HTTP response: ${e?.message || e}`);
  }

  const text = await resp.text();
  if (!resp.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j.detail || j.message || text;
    } catch { /* upstream returned non-JSON; use the raw body */ }
    throw new LseError(resp.status, String(msg).slice(0, 300));
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new LseError(502, `vault returned non-JSON for ${path}`);
  }
}

// ---------------------------------------------------------------------------
// Normalisation (verbatim from the SDK so rows match what the Python returns)
// ---------------------------------------------------------------------------

const TIME_KEYS = new Set([
  'timestamp', 'ts', 'minute', 'datetime', 'last_trade_at',
  'updated_at', 'created_at', 'accepted_date', 'fetched_at',
]);

/** "YYYY-MM-DD hh:mm:ss" → "YYYY-MM-DDThh:mm:ssZ" so downstream parsers agree. */
function isoify(rows) {
  for (const r of rows) {
    for (const k of TIME_KEYS) {
      const v = r[k];
      if (typeof v === 'string' && v.length >= 19 && v[10] === ' ') {
        r[k] = `${v.replace(' ', 'T')}Z`;
      }
    }
  }
  return rows;
}

/**
 * Give every row a `timestamp`, whatever the vault called its time column.
 *
 * WHY: candles() renames the vault's `ts` to `timestamp` because that has
 * always been this API's contract — but the OPTIONS endpoints were left
 * un-renamed, and their rows come back keyed on something else (a live probe
 * of /options/candles returned a row whose `timestamp` was undefined). Two
 * things broke on that: the page printed an empty time column, and — worse and
 * silently — pageOptionsFlow() reads `timestamp` as its paging cursor, so an
 * `all=1` sweep of the tape read one page, computed an empty cursor, filtered
 * every subsequent row out and stopped, reporting a complete pull.
 *
 * MIRRORS rather than renames: the vault's own column stays in the row (and in
 * the CSV) so nothing about the upstream shape is hidden, and `timestamp` is
 * added alongside as the one key every consumer here can rely on.
 */
const TIME_CANDIDATES = ['timestamp', 'ts', 'minute', 'datetime', 'time', 'bar_time', 'traded_at'];

function withTimestamp(rows) {
  for (const r of rows) {
    if (r.timestamp !== undefined && r.timestamp !== null) continue;
    for (const k of TIME_CANDIDATES) {
      if (k !== 'timestamp' && r[k] !== undefined && r[k] !== null) { r.timestamp = r[k]; break; }
    }
  }
  return rows;
}

function clampLimit(n, fallback = MAX_LIMIT) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(Math.floor(v), MAX_LIMIT);
}

// ---------------------------------------------------------------------------
// Catalog (cached — it is ~22k rows and changes daily at most)
// ---------------------------------------------------------------------------

let catalogCache = null;
let catalogAt = 0;
const CATALOG_TTL_MS = 10 * 60 * 1000;

/** Raw /catalog rows: { dataset, symbol, ticks, first_tick, last_tick, years, ... }. */
async function rawCatalog(force = false) {
  if (!force && catalogCache && Date.now() - catalogAt < CATALOG_TTL_MS) {
    return catalogCache;
  }
  const rows = await vaultGet('/catalog', {}, { timeoutMs: 90000 });
  catalogCache = Array.isArray(rows) ? rows : [];
  catalogAt = Date.now();
  return catalogCache;
}

/** Catalog shaped the way the SDK's catalog() presents it, plus the raw ticks. */
async function catalog({ dataset, search, force } = {}) {
  const rows = await rawCatalog(force);
  let out = rows.map((r) => ({
    symbol: r.symbol || '',
    name: r.name || '',
    dataset: r.dataset || '',
    category: CATEGORY_LABELS[r.dataset] ||
      String(r.dataset || '').replace(/\b\w/g, (c) => c.toUpperCase()),
    ticks: r.ticks ?? null,
    years: r.years ?? null,
    first: r.first_tick ?? null,
    last: r.last_tick ?? null,
    country: r.country_name || null,
  }));
  if (dataset) {
    const want = String(dataset).toLowerCase();
    out = out.filter((x) => x.dataset.toLowerCase() === want);
  }
  if (search) {
    const q = String(search).toLowerCase();
    out = out.filter((x) =>
      x.symbol.toLowerCase().includes(q) || x.name.toLowerCase().includes(q));
  }
  out.sort((a, b) => a.dataset.localeCompare(b.dataset) || a.symbol.localeCompare(b.symbol));
  return out;
}

/** The distinct dataset ids present, with a row count each — drives the UI picker. */
async function datasets() {
  const rows = await rawCatalog();
  const counts = new Map();
  for (const r of rows) {
    const d = r.dataset || '';
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({
      id,
      label: CATEGORY_LABELS[id] || id.replace(/\b\w/g, (c) => c.toUpperCase()),
      count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The first tick date the vault holds for a symbol — this is what powers
 * start=MAX (the Python script's "all history" option) without guessing.
 */
async function firstTickFor(symbol, dataset) {
  const rows = await rawCatalog();
  const want = String(symbol || '').toUpperCase();
  const hits = rows.filter((r) => String(r.symbol || '').toUpperCase() === want &&
    (!dataset || r.dataset === dataset));
  for (const h of hits) {
    if (h.first_tick) return String(h.first_tick).slice(0, 10);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Time-series
// ---------------------------------------------------------------------------

/**
 * One page of OHLCV. Mirrors client.candles(): the vault labels the bar-open
 * time `ts`, the SDK's public contract has always said `timestamp`, and fx
 * candles carry no consolidated volume — keep both fixups so a CSV pulled here
 * is byte-comparable with one pulled from the Python.
 */
async function candles({ symbol, timeframe = '1m', start, end, limit, order = 'asc', dataset } = {}) {
  if (!symbol) throw new LseError(400, 'symbol is required');
  const tf = String(timeframe).toLowerCase();
  if (!TIMEFRAMES.includes(tf)) {
    throw new LseError(400, `timeframe '${timeframe}' is invalid (use one of ${TIMEFRAMES.join(', ')})`);
  }
  const rows = await vaultGet('/candles', {
    symbol, timeframe: tf, order, limit: clampLimit(limit), dataset, start, end,
  });
  for (const r of rows) {
    if ('ts' in r) { r.timestamp = r.ts; delete r.ts; }
    if (r.volume === undefined) r.volume = 0.0;
  }
  return isoify(rows);
}

/**
 * Walk the whole range, page by page, yielding each page as it lands.
 *
 * The vault caps a call at 5000 rows, so a year of 1m bars is ~26 calls. We
 * page forward on the bar time (order is forced to 'asc' — paging backwards on
 * a cursor you also filter on is how you lose a bar at every seam) and dedupe
 * on `timestamp`, because `start` is inclusive and the last bar of page N is
 * the first bar of page N+1.
 *
 * `maxRows` is a seatbelt, not a feature: without it a fat-fingered "1s since
 * 2003" walks for hours. The caller gets told when it trips.
 */
async function* pageCandles({ symbol, timeframe = '1m', start, end, dataset, maxRows = 2_000_000 } = {}) {
  let cursor = start;
  let seen = 0;
  let lastStamp = null;
  for (;;) {
    const page = await candles({
      symbol, timeframe, start: cursor, end, dataset,
      limit: MAX_LIMIT, order: 'asc',
    });
    if (!page.length) return;
    // Drop the overlap row(s) carried over from the previous page's tail.
    const fresh = lastStamp ? page.filter((r) => String(r.timestamp) > lastStamp) : page;
    if (!fresh.length) return;
    lastStamp = String(fresh[fresh.length - 1].timestamp);
    seen += fresh.length;
    if (seen >= maxRows) {
      yield { rows: fresh.slice(0, fresh.length - (seen - maxRows)), truncated: true };
      return;
    }
    yield { rows: fresh, truncated: false };
    // A short page means the range is exhausted.
    if (page.length < MAX_LIMIT) return;
    cursor = lastStamp;
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const OPTION_TYPES = { c: 'call', call: 'call', calls: 'call', p: 'put', put: 'put', puts: 'put' };

function normType(type) {
  if (!type) return null;
  const t = OPTION_TYPES[String(type).toLowerCase()];
  if (!t) throw new LseError(400, `type must be 'call' or 'put', got '${type}'`);
  return t;
}

/**
 * Resolve a ticker or company name to a ticker, the way client._resolve_underlying
 * does: an exact catalog symbol always wins; otherwise match names within the
 * options dataset (prefix first, then shortest) so "apple" lands on Apple Inc.
 * rather than Apple Hospitality REIT.
 */
async function resolveUnderlying(query) {
  const q = String(query || '').trim();
  if (!q) throw new LseError(400, 'underlying is required');
  let rows;
  try {
    rows = await rawCatalog();
  } catch {
    return q.toUpperCase(); // catalog briefly unreachable — assume a ticker
  }
  const upper = q.toUpperCase();
  if (rows.some((r) => String(r.symbol || '').toUpperCase() === upper)) return upper;
  const ql = q.toLowerCase();
  const pool = rows.filter((r) => r.dataset === 'options');
  const hits = (pool.length ? pool : rows)
    .filter((r) => String(r.name || '').toLowerCase().includes(ql));
  if (!hits.length) return upper;
  hits.sort((a, b) => {
    const ap = String(a.name).toLowerCase().startsWith(ql) ? 0 : 1;
    const bp = String(b.name).toLowerCase().startsWith(ql) ? 0 : 1;
    return ap - bp || String(a.name).length - String(b.name).length;
  });
  return hits[0].symbol;
}

const OSI_RE = /^[A-Z][A-Z0-9.]{0,5}\d{6}[CP]\d{8}$/;

/** underlying + strike + expiry + type → an OSI ticker (AAPL260612C00205000). */
async function toOsi(contract, { strike, expiry, type } = {}) {
  const raw = String(contract || '').trim().toUpperCase();
  if (strike === undefined && expiry === undefined && type === undefined) {
    if (!OSI_RE.test(raw)) {
      throw new LseError(400,
        `'${contract}' is not an option contract; pass an OSI ticker like ` +
        'AAPL260612C00205000, or an underlying plus strike, expiry and type');
    }
    return raw;
  }
  if (strike === undefined || expiry === undefined || type === undefined ||
      strike === '' || expiry === '' || type === '') {
    throw new LseError(400, 'strike, expiry and type are all required when addressing a contract by its parts');
  }
  const right = normType(type);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiry));
  if (!m) throw new LseError(400, `expiry must be YYYY-MM-DD, got '${expiry}'`);
  const yymmdd = `${m[1].slice(2)}${m[2]}${m[3]}`;
  const root = await resolveUnderlying(contract);
  const strikeInt = Math.round(Number(strike) * 1000);
  if (!Number.isFinite(strikeInt)) throw new LseError(400, `strike must be a number, got '${strike}'`);
  return `${root}${yymmdd}${right === 'call' ? 'C' : 'P'}${String(strikeInt).padStart(8, '0')}`;
}

/** Current chain for an underlying: price, IV, greeks, today's volume/premium. */
async function optionsChain({ underlying, type, expiry, strike, strikeMin, strikeMax, minDte, maxDte, limit } = {}) {
  const sym = await resolveUnderlying(underlying);
  const params = { underlying: sym, limit: clampLimit(limit) };
  const t = normType(type);
  if (t) params.type = t;
  if (expiry) params.expiry = expiry;
  if (strike !== undefined && strike !== null && strike !== '') params.strike = strike;
  if (strikeMin !== undefined && strikeMin !== null && strikeMin !== '') params.strike_min = strikeMin;
  if (strikeMax !== undefined && strikeMax !== null && strikeMax !== '') params.strike_max = strikeMax;
  if (minDte !== undefined && minDte !== null && minDte !== '') params.min_dte = parseInt(minDte, 10);
  if (maxDte !== undefined && maxDte !== null && maxDte !== '') params.max_dte = parseInt(maxDte, 10);
  return withTimestamp(isoify(await vaultGet('/options/chain', params, { timeoutMs: 90000 })));
}

/** Option prints (time and sales) — trailing week. Omit underlying to sweep all. */
async function optionsFlow({ underlying, type, minPremium, expiry, maxDte, start, end, order = 'desc', limit } = {}) {
  const params = { order, limit: clampLimit(limit), start, end };
  if (underlying) params.underlying = await resolveUnderlying(underlying);
  const t = normType(type);
  if (t) params.type = t;
  if (minPremium !== undefined && minPremium !== null && minPremium !== '') params.min_premium = minPremium;
  if (expiry) params.expiry = expiry;
  if (maxDte !== undefined && maxDte !== null && maxDte !== '') params.max_dte = parseInt(maxDte, 10);
  return withTimestamp(isoify(await vaultGet('/options/flow', params, { timeoutMs: 90000 })));
}

/** Page the tape backwards on print time — flow is served newest-first. */
async function* pageOptionsFlow(opts = {}) {
  const maxRows = opts.maxRows ?? 500_000;
  let end = opts.end;
  let seen = 0;
  let lastStamp = null;
  for (;;) {
    const page = await optionsFlow({ ...opts, end, order: 'desc', limit: MAX_LIMIT });
    if (!page.length) return;
    const stampOf = (r) => String(r.timestamp ?? '');
    if (!stampOf(page[0])) {
      // No time column to page on. Yield what we have and stop, flagged — the
      // alternative is an infinite loop or a partial pull reported as whole.
      yield { rows: page, truncated: true };
      return;
    }
    const fresh = lastStamp ? page.filter((r) => stampOf(r) < lastStamp) : page;
    if (!fresh.length) return;
    lastStamp = stampOf(fresh[fresh.length - 1]);
    seen += fresh.length;
    if (seen >= maxRows) {
      yield { rows: fresh.slice(0, fresh.length - (seen - maxRows)), truncated: true };
      return;
    }
    yield { rows: fresh, truncated: false };
    if (page.length < MAX_LIMIT) return;
    end = lastStamp;
  }
}

/** 1m premium OHLC for one contract, with volume, premium and averaged greeks. */
async function optionCandles({ contract, strike, expiry, type, start, end, order = 'asc', limit } = {}) {
  const ticker = await toOsi(contract, { strike, expiry, type });
  return withTimestamp(isoify(await vaultGet('/options/candles', {
    ticker, order, limit: clampLimit(limit), start, end,
  }, { timeoutMs: 90000 })));
}

/** The vault's own shape report — datasets, candle classes, timeframes. */
async function meta() {
  return vaultGet('/meta');
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v).replace(/"/g, '""');
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Column order from the first row, so a CSV reads the way the API answered. */
function csvColumns(rows) {
  const cols = [];
  const seen = new Set();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) { seen.add(k); cols.push(k); }
    }
  }
  return cols;
}

function csvHeader(cols) {
  return `${cols.map(csvCell).join(',')}\n`;
}

function csvRows(rows, cols) {
  let out = '';
  for (const r of rows) {
    out += `${cols.map((c) => csvCell(r[c])).join(',')}\n`;
  }
  return out;
}

/** Whole-array convenience for the small (single-call) endpoints. */
function toCsv(rows) {
  if (!rows || !rows.length) return '';
  const cols = csvColumns(rows);
  return csvHeader(cols) + csvRows(rows, cols);
}

module.exports = {
  withTimestamp,
  VAULT_URL,
  MAX_LIMIT,
  TIMEFRAMES,
  CATEGORY_LABELS,
  LseError,
  hasKey,
  vaultGet,
  catalog,
  datasets,
  firstTickFor,
  candles,
  pageCandles,
  optionsChain,
  optionsFlow,
  pageOptionsFlow,
  optionCandles,
  resolveUnderlying,
  toOsi,
  meta,
  toCsv,
  csvColumns,
  csvHeader,
  csvRows,
};
