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
  // expiration column is YYYY-MM-DD (Phase 0 confirmed). Only future-or-today,
  // and cap at 5 years out to strip bogus far-future Theta rows (e.g. 2088-xx-xx).
  const today = new Date().toISOString().slice(0, 10);
  const maxDate = String(new Date().getFullYear() + 5);
  const expirations = [...new Set(expRows.map((r) => r.expiration))]
    .filter((e) => e && e >= today && e.slice(0, 4) <= maxDate)
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
// FIX (2026-07-06 #3): SPX/SPXW are NOT gated to the 9:30-16:15 equity-style
// cash session like single-name options — Cboe runs SPX/VIX options on Global
// Trading Hours, effectively Sun ~8pm ET through Fri ~4:15pm ET, nearly 24x5.
// Both prior versions here (a `/v3/calendar/today` call that always failed
// closed, then a hardcoded 9:30-16:15 Mon-Fri clock check) wrongly zeroed
// volume outside a narrow equity RTH window that doesn't apply to this
// product. Dropped the gate entirely — same as fetchOpenInterestTheta/
// fetchGreeksTheta, which have never had one. A genuinely quiet moment (the
// short daily maintenance gap) just returns empty rows, already handled below
// as "no update, preserve prior" — no need to pre-guess it in JS.
async function fetchVolumeTheta(underlying = SYMBOL, expiration) {
  const root = thetaRoot(underlying);
  const out = new Map();
  const json = await thetaGet(
    `/v3/option/snapshot/ohlc?symbol=${encodeURIComponent(root)}&expiration=${expiration}`,
  );
  const flat = flatSnapshotRows(json);
  console.log(`[VOL_DEBUG] root=${root} rawRows=${flat.length} sample=${JSON.stringify(flat[0] || null).slice(0, 300)}`);
  // When the market is confirmed open today, all volume from the OHLC snapshot
  // is current-session volume — no stale-bar filtering needed.
  // The snapshot's `timestamp` field is YYYY-MM-DDTHH:mm:ss.SSS (ET, no Z).
  for (const row of flat) {
    const type = rightToType(row.right);
    const strike = Number(row.strike);
    if (!(strike > 0)) continue;
    const vol = Number(row.volume ?? row.day_volume) || 0;
    out.set(keyOf(row.expiration || expiration, strike, type), vol);
  }
  console.log(`[VOL_DEBUG] out.size=${out.size}`);
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
    // Snapshot rows also carry the contract NBBO — derive a mark (mid, else last)
    // so the strike-detail popup can show the OTM contract price without a second
    // REST call. Absent bid/ask (older snapshots) → mark 0, caller keeps prior.
    const bid = Number(row.bid), ask = Number(row.ask);
    const mark = bid > 0 && ask > 0 ? (bid + ask) / 2 : Number(row.last ?? row.close ?? 0);
    out.set(keyOf(row.expiration || expiration, strike, type), {
      gamma: Number(row.gamma),
      delta: Number(row.delta),
      theta: Number(row.theta),
      vega: Number(row.vega),
      // Theta names it implied_vol (first_order) / implied_volatility (varies);
      // accept either.
      iv: Number(row.implied_vol ?? row.implied_volatility ?? row.iv),
      mark: Number.isFinite(mark) && mark > 0 ? mark : 0,
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
// Theta v3 wants YYYYMMDD. Accept an ISO 'YYYY-MM-DD' string (strip dashes) OR a
// JS Date (the daily-history callers pass `new Date(...)`, which String()-ifies
// to "Sat Feb 14 2026 …" and 500s Theta with "Cannot parse date string").
const ymdCompact = (iso) => {
  if (!(iso instanceof Date) && /^\d{4}-\d{2}-\d{2}$/.test(String(iso))) {
    return String(iso).replace(/-/g, '');
  }
  const d = iso instanceof Date ? iso : new Date(iso);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  return String(iso).replace(/-/g, '');
};

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

async function fetchOiHistoryTheta(underlying, date, { strikeRange = 40, maxDte } = {}) {
  const root = thetaRoot(underlying);
  const d = ymdCompact(date);
  let json;
  try {
    json = await thetaGet(
      `/v3/option/history/open_interest?symbol=${encodeURIComponent(root)}&expiration=*&start_date=${d}&end_date=${d}&strike_range=${strikeRange}`,
    );
  } catch (e) {
    // Theta v3 rejects expiration=* when start_date/end_date == today ("Cannot
    // fetch current-day data without specifying an expiration") — historical
    // (past) dates are unaffected. Fall back to one call per expiration,
    // capped to maxDte if given so this doesn't blow up on LEAPS-heavy roots.
    if (!/current-day/i.test(e.message)) throw e;
    return fetchOiHistoryThetaByExpiration(root, d, { strikeRange, maxDte });
  }
  const out = new Map(); // `exp|strike|type` -> oi
  for (const r of flatSnapshotRows(json)) {
    const strike = Number(r.strike);
    if (!(strike > 0)) continue;
    out.set(`${r.expiration}|${strike}|${rightToType(r.right)}`, Number(r.open_interest) || 0);
  }
  return out;
}

// Fallback for fetchOiHistoryTheta when Theta refuses expiration=* (current
// day). `root` is already Theta-mapped, `d` is YYYYMMDD compact.
async function fetchOiHistoryThetaByExpiration(root, d, { strikeRange = 40, maxDte } = {}) {
  const expJson = await thetaGet(`/v3/option/list/expirations?symbol=${encodeURIComponent(root)}`);
  const expRows = rowsFromV3(expJson);
  const today = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  let expirations = [...new Set(expRows.map((r) => r.expiration))].filter((e) => e && e >= today);
  if (maxDte != null) {
    const cutoff = new Date(`${today}T12:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() + maxDte);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    expirations = expirations.filter((e) => e <= cutoffIso);
  }

  const out = new Map();
  for (const expiration of expirations) {
    const expCompact = expiration.replace(/-/g, '');
    let json;
    try {
      json = await thetaGet(
        `/v3/option/history/open_interest?symbol=${encodeURIComponent(root)}&expiration=${expCompact}&start_date=${d}&end_date=${d}&strike_range=${strikeRange}`,
      );
    } catch (e) {
      continue; // skip a bad expiration rather than fail the whole ticker
    }
    for (const r of flatSnapshotRows(json)) {
      const strike = Number(r.strike);
      if (!(strike > 0)) continue;
      out.set(`${r.expiration}|${strike}|${rightToType(r.right)}`, Number(r.open_interest) || 0);
    }
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
  // Stock snapshot uses nested shape { response:[{contract,data}] } — use flatSnapshotRows.
  // Fall back to rowsFromV3 for any endpoint variant that returns columnar format.
  const rows = flatSnapshotRows(json);
  const r = (rows.length ? rows : rowsFromV3(json))[0] || {};
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

/**
 * Today's total (lit + dark, consolidated) traded share volume for an equity —
 * used as the denominator for the /flow Dark Pool card's "% of volume traded
 * off-exchange" stat. Best-effort: returns 0 if the snapshot is empty/gated
 * (pre-open, or Theta blip) so the caller can omit the stat rather than show 0%.
 */
async function fetchStockDayVolumeTheta(symbol) {
  const json = await thetaGet(
    `/v3/stock/snapshot/ohlc?symbol=${encodeURIComponent(String(symbol).toUpperCase())}`,
  );
  const rows = flatSnapshotRows(json);
  const r = (rows.length ? rows : rowsFromV3(json))[0] || {};
  const vol = Number(r.volume ?? r.day_volume);
  return vol > 0 ? vol : 0;
}

/**
 * Daily total share volume over a date range — the multi-day (5D/7D) version of
 * fetchStockDayVolumeTheta, for the Dark Pool card's multi-session % stat.
 * Returns [{date:"YYYY-MM-DD", volume}] ascending; empty on failure.
 */
async function fetchStockDailyVolumeSeriesTheta(symbol, startDate, endDate) {
  const json = await thetaGet(
    `/v3/stock/history/eod?symbol=${encodeURIComponent(String(symbol).toUpperCase())}&start_date=${ymdCompact(startDate)}&end_date=${ymdCompact(endDate)}`,
  );
  return rowsFromV3(json)
    .map((r) => {
      let ymd = String(r.date ?? r.Date ?? '');
      if (ymd.length !== 8) return null;
      return {
        date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
        volume: Number(r.volume) || 0,
      };
    })
    .filter((x) => x && x.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
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

// Daily EOD OHLC bars over a date range, for the weekly-candle zone/eval math.
// Returns [{ time(ms, ET session date), open, high, low, close }] ascending.
// `date` column is a YYYYMMDD int; anchor each bar at that ET calendar day 00:00.
function _mapDailyOhlc(json) {
  return rowsFromV3(json)
    .map((r) => {
      let ymd = String(r.date ?? r.Date ?? '');
      if (ymd.length !== 8) { const iso = String(r.created ?? r.last_trade ?? ''); const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) ymd = m[1] + m[2] + m[3]; }
      const time = ymd.length === 8
        ? Date.parse(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00.000-05:00`)
        : NaN;
      return {
        time,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
      };
    })
    .filter((b) =>
      Number.isFinite(b.time) && Number.isFinite(b.open) && Number.isFinite(b.high)
      && Number.isFinite(b.low) && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.time - b.time);
}

async function fetchIndexDailyHistoryTheta(symbol, startDate, endDate) {
  const json = await thetaGet(
    `/v3/index/history/eod?symbol=${encodeURIComponent(symbol)}&start_date=${ymdCompact(startDate)}&end_date=${ymdCompact(endDate)}`,
  );
  return _mapDailyOhlc(json);
}

async function fetchStockDailyHistoryTheta(symbol, startDate, endDate) {
  const json = await thetaGet(
    `/v3/stock/history/eod?symbol=${encodeURIComponent(String(symbol).toUpperCase())}&start_date=${ymdCompact(startDate)}&end_date=${ymdCompact(endDate)}`,
  );
  return _mapDailyOhlc(json);
}

// Daily EOD close series for ONE specific contract (exact strike + type) over a
// date range — used by the far-CB "Tracked results" popup to show how the
// watched contract's premium moved day-to-day since it was flagged.
// Unlike fetchEodHistoryTheta (single-day, all-strikes, flatSnapshotRows takes
// only the LAST data point per entry), this walks the full per-contract
// data[] array so multi-day ranges aren't collapsed to one row.
// `strikeRangeDollars` must be wide enough to keep the target strike inside
// Theta's ±range-around-that-day's-spot window for every day in the range —
// callers should pass something like |strike - spot_at_flag| + a cushion.
async function fetchOptionDailyHistoryTheta(underlying, expiry, strike, type, startDate, endDate, strikeRangeDollars = 200) {
  const root = thetaRoot(underlying);
  const expCompact = ymdCompact(expiry);
  const json = await thetaGet(
    `/v3/option/history/eod?symbol=${encodeURIComponent(root)}&expiration=${expCompact}&start_date=${ymdCompact(startDate)}&end_date=${ymdCompact(endDate)}&strike_range=${Math.max(20, Math.ceil(strikeRangeDollars))}`,
  );
  const resp = json?.response || [];
  if (!Array.isArray(resp)) return [];
  const wantedRight = type === 'C' ? 'C' : 'P';
  const entry = resp.find(
    (e) => e?.contract && Number(e.contract.strike) === Number(strike) && rightToType(e.contract.right) === wantedRight,
  );
  if (!entry || !Array.isArray(entry.data)) return [];
  return entry.data
    .map((r) => {
      let ymd = String(r.date ?? '');
      const time = ymd.length === 8
        ? Date.parse(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00.000-05:00`)
        : NaN;
      return { time, close: Number(r.close), open: Number(r.open), high: Number(r.high), low: Number(r.low) };
    })
    .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.time - b.time);
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
  constructor({ onTrade, onIndex, onGreeks, getSpot = () => 0 } = {}) {
    this.onTrade = onTrade;
    this.onIndex = onIndex;   // (root, price) => void  — index price ticks (SPX/VIX)
    this.onGreeks = onGreeks; // (streamerSymbol, {gamma,delta,theta,vega,iv}) => void
    this.getSpot = getSpot;
    // Per-root spot overrides for non-SPX flow (MultiFlowManager fills these so
    // isOtm is computed against the correct underlying, not SPX). thetaRoot key.
    this.rootSpot = new Map();
    this.ws = null;
    this.nextId = 1;
    this.connected = false;
    this.closing = false;
    // Last time we actually dispatched a TRADE print — distinct from `connected`,
    // which just means the socket is open. A stuck/split-brain theta-terminal
    // session can stay "connected" while silently returning nothing, so the
    // watchdog (state/flow-watchdog.js) polls this instead of the close event.
    this.lastTradeAt = 0;
    // contractKey `root|expInt|strikeTenthCents|C|P` -> { bid, ask, t, streamerSymbol, strikeDollars, root }
    this.quotes = new Map();
    // remember subscriptions so we can resubscribe on reconnect
    this.subs = []; // [{root, expInt, strikeTenthCents, right}]
    this.indexSubs = []; // ["SPX","VIX"] index roots to (re)subscribe
    // Bulk (STREAM_BULK) mode: ONE option-trade subscription for the whole OPRA
    // tape, filtered client-side to bulkRoots. Used instead of per-contract subs
    // when scaling to many flow roots. Empty/false = per-contract mode (default).
    this.bulkTrades = false;
    this.bulkRoots = new Set(); // Theta roots to KEEP from the firehose (e.g. "SPXW","QQQ")
  }

  /** Add a Theta root to the bulk-stream keep-list (drops everything else). */
  addBulkRoot(root) {
    if (root) this.bulkRoots.add(String(root).toUpperCase());
  }

  /**
   * Subscribe the full OPRA option-trade firehose (STREAM_BULK). Every US option
   * trade arrives on this one subscription; _onMessage drops any root not in
   * bulkRoots. Trades TRADE only (no QUOTE) to match the per-contract path.
   */
  subscribeBulkTrades() {
    this.bulkTrades = true;
    if (!this.connected) return; // re-armed on open
    this._send({
      msg_type: 'STREAM_BULK',
      sec_type: 'OPTION',
      req_type: 'TRADE',
      add: true,
      id: this.nextId++,
    });
    console.log(`[THETA-WS] STREAM_BULK OPTION TRADE subscribed; keep-roots=${[...this.bulkRoots].join(',') || '(none)'}`);
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
      // Re-arm the bulk firehose if it was active (bulkRoots persists across reconnects).
      if (this.bulkTrades) this.subscribeBulkTrades();
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
   * Force-drop and reopen the socket even though `connected`/no error fired —
   * used by the flow watchdog when theta-terminal goes stuck-but-listening
   * (serves NOT_FOUND/empty responses instead of closing). `ws.terminate()`
   * skips the close handshake, which reliably fires our own `close` handler
   * and its existing 2s reconnect+resubscribe path.
   */
  forceReconnect() {
    console.warn('[THETA-WS] forceReconnect: no trades for too long, cycling socket');
    try { this.ws?.terminate(); } catch { /* noop */ }
  }

  /**
   * Subscribe TRADE only for one contract.
   * QUOTE + GREEKS pushes were dropped to cut JVM CPU: at ~700 contracts the
   * per-change QUOTE/GREEKS firehose dominated. Greeks now come from the 5s
   * bulk REST poll (_refreshGreeksTheta); inferSide falls back to the tick rule
   * when the quote cache stays null.
   * @param {{root,expInt,strikeTenthCents,right}} c
   */
  subscribeContract(c, record = true) {
    if (record) this.subs.push(c);
    if (!this.connected) return; // will flush on open
    for (const req_type of ['TRADE']) {
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
    console.log(`[THETA-WS] subscribed ${contracts.length} contracts (TRADE only) root=${root}`);
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
    // DEBUG: onTrade has never fired in production despite a confirmed-live
    // Theta firehose carrying real SPXW TRADE messages (verified via a raw
    // side-channel WS test). Log the bulk-gate decision for every SPXW
    // message (any type) the first several times so we can see whether it's
    // this gate, a downstream check, or something else eating them — capped
    // so it can't flood logs once the answer is captured.
    if (root === 'SPXW') {
      if (!this._spxwGateLogCount) this._spxwGateLogCount = 0;
      if (this._spxwGateLogCount < 15) {
        this._spxwGateLogCount++;
        const passes = !(this.bulkTrades && !this.bulkRoots.has(String(root).toUpperCase()));
        console.log(
          `[THETA-WS-DEBUG] SPXW msg type=${type} bulkTrades=${this.bulkTrades} ` +
          `bulkRoots=[${[...this.bulkRoots].join(',')}] gatePasses=${passes} ` +
          `strike=${contract.strike} right=${contract.right}`
        );
      }
    }
    // Bulk mode: the firehose carries the whole OPRA tape. Drop any root we don't
    // track BEFORE building a cache entry — this is the hot path, keep it cheap.
    if (this.bulkTrades && !this.bulkRoots.has(String(root).toUpperCase())) return;
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
      if (root === 'SPXW' && (this._spxwTradeLogCount ?? 0) < 15) {
        this._spxwTradeLogCount = (this._spxwTradeLogCount ?? 0) + 1;
        console.log(`[THETA-WS-DEBUG] SPXW TRADE dispatch: price=${price} size=${size} onTrade=${typeof this.onTrade}`);
      }
      if (!(price > 0) || !(size > 0)) return;
      const quote = (cache.bid != null && cache.ask != null)
        ? { bid: cache.bid, ask: cache.ask, t: cache.t }
        : null;
      // Prefer a per-root spot (set by MultiFlowManager for non-SPX roots) so
      // isOtm is correct; fall back to the SPX getSpot() for the core engine.
      const rootSpot = this.rootSpot.get(root);
      this.lastTradeAt = Date.now();
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

    // Greeks tick: pushed by Theta on every change. All five greeks arrive together
    // in msg.greeks. Only store fields that are finite & non-zero — a 4dp-zeroed
    // gamma must not clobber the BS fallback path in _recompute (same guard as the
    // REST snapshot path). iv field names vary by Theta version; accept all aliases.
    if (type === 'GREEKS' && msg.greeks && this.onGreeks) {
      if (!this._loggedGreeksKeys) { this._loggedGreeksKeys = true; console.log('[THETA-WS] first GREEKS msg keys:', Object.keys(msg.greeks).join(','), JSON.stringify(msg.greeks).slice(0, 200)); }
      const g = msg.greeks;
      const gamma = Number(g.gamma);
      const delta = Number(g.delta);
      const theta = Number(g.theta);
      const vega  = Number(g.vega);
      const iv    = Number(g.implied_vol ?? g.implied_volatility ?? g.iv ?? g.impliedVol);
      const entry = {
        gamma: Number.isFinite(gamma) && gamma !== 0 ? gamma : undefined,
        delta: Number.isFinite(delta)               ? delta : undefined,
        theta: Number.isFinite(theta)               ? theta : undefined,
        vega:  Number.isFinite(vega)                ? vega  : undefined,
        iv:    Number.isFinite(iv)    && iv > 0     ? iv    : undefined,
      };
      // Only fire callback if at least gamma or iv is present (same guard as REST).
      if (entry.gamma !== undefined || entry.iv !== undefined) {
        try { this.onGreeks(cache.streamerSymbol, entry); } catch { /* never kill the socket */ }
      }
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
  // No-op now: isThetaMarketOpen() computes live from ET time, no cache to clear.
  // Kept so the existing session-rollover call site doesn't need touching.
  resetCalendarCache: () => {},
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
  fetchIndexDailyHistoryTheta,
  fetchStockDailyHistoryTheta,
  fetchOptionDailyHistoryTheta,
  fetchGreeksEodHistoryTheta,
  fetchIndexPriceTheta,
  fetchStockQuoteTheta,
  fetchStockDayVolumeTheta,
  fetchStockDailyVolumeSeriesTheta,
};
