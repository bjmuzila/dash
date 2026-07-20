'use strict';
/**
 * server-v2/eod-gex-recorder.js
 *
 * Records EOD (end-of-day) GEX for $SPX, SPY, and QQQ into the `eod_gex`
 * Postgres table. One row per (date, symbol), upserted so a retry in the
 * same window cleanly overwrites.
 *
 * Trigger window: 3:55–4:05 PM ET (Mon–Fri, market trading days).
 * Piggybacked on mvc-auto-snapshot: wired from server-with-proxy.js alongside
 * startMvcAutoSnapshot(). Migrate to a standalone Task Scheduler script later.
 *
 * GEX computation:
 *   - $SPX  — reads totalNetGex + spot from in-process market-state via
 *             /proxy/gex (no re-computation; the live header value).
 *   - SPY / QQQ — fetches chain + greeks + OI + volume directly from ThetaData
 *                 (TT is futures-only: NQU/ESU), then runs computeGexRows (same
 *                 gex-calculator.js used everywhere) to produce totalNetGex.
 *
 * Guard: if Greeks/OI are missing for most strikes (< MIN_POPULATED_STRIKES
 * strikes with non-zero gamma AND non-zero OI), SKIP the write and log.
 * Never writes 0 / partial GEX.
 */

const { computeGexRows, totalNetGex } = require('./computation/gex-calculator');
const { useTheta } = require('./config/data-source');
// Option data source follows the SAME DATA_SOURCE flag as the main feed:
// Theta when on, TastyTrade REST (tt-snapshot) when the subscription is paused.
const {
  fetchChainTheta,
  fetchGreeksTheta,
  fetchOpenInterestTheta,
  fetchVolumeTheta,
  fetchStockQuoteTheta,
  fetchOiHistoryTheta,
  fetchGreeksEodHistoryTheta,
  fetchEodHistoryTheta,
  fetchIndexEodTheta,
  fetchStockEodTheta,
} = useTheta() ? require('./proxy-thetadata') : require('./tt-snapshot');
const { bsGreeks, impliedVol, yearsToExpiry } = require('./computation/utils');

// `exp|strike|type` key matching proxy-thetadata's keyOf()
const keyOf = (exp, strike, type) => `${exp}|${Number(strike)}|${type}`;

// Symbol → /proxy/gex ticker key used in the API.
// $SPX uses the live market-state (no re-fetch needed).
// SPY / QQQ are fetched on-demand from the TT chain proxy.
const EOD_SYMBOLS = [
  { symbol: '$SPX', fetchMode: 'state' },
  { symbol: 'SPY',  fetchMode: 'chain', chainTicker: 'SPY'  },
  { symbol: 'QQQ',  fetchMode: 'chain', chainTicker: 'QQQ'  },
];

// Minimum number of strikes with gamma AND OI present to trust the data.
const MIN_POPULATED_STRIKES = 20;

// EOD window: 15:55–16:05 ET (minutes-since-midnight)
const WINDOW_OPEN_MINS  = 15 * 60 + 55; // 955
const WINDOW_CLOSE_MINS = 16 * 60 +  5; // 965

// Morning settled-OI window: OPRA settled OI posts ~06:30 ET. We re-run the
// PRIOR trading day every 30 min from 06:30 until 09:30 ET, overwriting that
// date's row with settled-OI GEX. At/after 09:30, if the value matches the
// previous poll (OI stopped moving), we "bake it in" and stop re-running.
const AM_OPEN_MINS    =  6 * 60 + 30; // 390  (06:30)
const AM_BAKE_MINS    =  9 * 60 + 30; // 570  (09:30 — bake-in checkpoint)
const AM_POLL_EVERY_MS = 30 * 60 * 1000; // 30 min

// Market holidays (ET dates) — keep in sync with mvc-auto-snapshot.js
const MARKET_HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── PG pool (same lazy pattern as gex-history-writer.js) ─────────────────────

let pool = null;
let pgUnavailable = false;

function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) { pgUnavailable = true; return null; }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
        ? undefined
        : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[eod-gex] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    console.error('[eod-gex] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

function etDateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((p) => p.type !== 'literal')
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isEodWindow() {
  const { hour, minute, weekday } = etParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const today = etDateStr();
  if (MARKET_HOLIDAYS.has(today)) return false;
  const mins = hour * 60 + minute;
  return mins >= WINDOW_OPEN_MINS && mins <= WINDOW_CLOSE_MINS;
}

function isTradingDay(dateStr, weekday) {
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return !MARKET_HOLIDAYS.has(dateStr);
}

// Previous trading day for a YYYY-MM-DD (skips weekends + holidays).
function prevTradingDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  for (let i = 0; i < 10; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const iso = d.toISOString().slice(0, 10);
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(d);
    if (isTradingDay(iso, wd)) return iso;
  }
  return null;
}

// True only inside the morning settled-OI poll window (06:30–09:30 ET) on a
// trading day. The 09:30 tick is the bake-in checkpoint (still returns true).
function isAmWindow() {
  const { hour, minute, weekday } = etParts();
  const today = etDateStr();
  if (!isTradingDay(today, weekday)) return false;
  const mins = hour * 60 + minute;
  return mins >= AM_OPEN_MINS && mins <= AM_BAKE_MINS;
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

/**
 * Get totalNetGex + totalFlowGex + spot for $SPX from /proxy/gex (reads market-state directly).
 * Returns null if data is not ready.
 */
async function fetchSpxState(base) {
  const res = await fetch(`${base}/proxy/gex`, {
    cache: 'no-store',
    headers: process.env.INTERNAL_API_TOKEN
      ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
  });
  if (!res.ok) throw new Error(`/proxy/gex returned ${res.status}`);
  const v2 = await res.json();

  const gexRows = Array.isArray(v2.gexRows) ? v2.gexRows : [];
  const spot = Number(v2.spot ?? 0);
  const tng = Number(v2.totalNetGex ?? 0);
  const tfg = Number(v2.totalFlowGex ?? 0);

  if (!(spot > 0)) throw new Error('spot is 0 in market-state');

  // Guard: count strikes with gamma + OI populated
  const populated = gexRows.filter(
    (r) => (r.callGamma > 0 || r.putGamma > 0) && (r.callOI > 0 || r.putOI > 0)
  ).length;
  if (populated < MIN_POPULATED_STRIKES) {
    throw new Error(`$SPX: only ${populated} populated strikes (min ${MIN_POPULATED_STRIKES}) — skipping`);
  }

  return { totalNetGex: tng, totalFlowGex: tfg, spot };
}

/**
 * Fetch chain for SPY/QQQ directly from ThetaData (TT is futures-only now),
 * compute GEX with gex-calculator.js (same function the dashboard header uses).
 * Pulls the nearest expiry's chain + greeks (gamma/delta) + OPRA OI + day
 * volume, then runs computeGexRows. Returns null if the chain is not ready.
 */
async function fetchChainGex(_base, chainTicker) {
  // 1) Spot from Theta stock snapshot.
  const quote = await fetchStockQuoteTheta(chainTicker);
  const spot = Number(quote?.last ?? quote?.mark ?? 0);
  if (!(spot > 0)) throw new Error(`spot is 0 for ${chainTicker} (Theta quote)`);

  // 2) Chain → nearest future-or-today expiry.
  const { contracts, expirations } = await fetchChainTheta(chainTicker);
  if (!expirations?.length) throw new Error(`no expirations for ${chainTicker}`);
  const expiry = expirations[0]; // sorted ascending in fetchChainTheta
  const expContracts = contracts.filter((c) => c.expiration === expiry);
  if (!expContracts.length) throw new Error(`empty chain for ${chainTicker} ${expiry}`);

  // 3) Greeks + OI + volume snapshots for that expiry (parallel).
  const [greekMap, oiMap, volMap] = await Promise.all([
    fetchGreeksTheta(chainTicker, expiry).catch(() => new Map()),
    fetchOpenInterestTheta(chainTicker, expiry).catch(() => new Map()),
    fetchVolumeTheta(chainTicker, expiry).catch(() => new Map()),
  ]);

  // 4) Flatten into { strike, side, oi, volume, gamma, delta } rows.
  const flatRows = [];
  for (const c of expContracts) {
    const k = keyOf(c.expiration, c.strike, c.type);
    const g = greekMap.get(k) || {};
    const oi = Number(oiMap.get(k)?.oi ?? 0);
    const vol = Number(volMap.get(k) ?? 0);
    const gamma = Math.abs(Number(g.gamma ?? 0));
    const delta = Math.abs(Number(g.delta ?? 0));
    if (!(gamma > 0) && !(oi > 0)) continue;
    flatRows.push({
      strike: c.strike,
      side: c.type === 'C' ? 'call' : 'put',
      oi,
      volume: vol,
      gamma,
      delta,
    });
  }

  if (!flatRows.length) throw new Error(`no valid option rows for ${chainTicker}`);

  // Run same GEX computation as gex-calculator.js (reused, not re-implemented)
  const gexRows = computeGexRows(flatRows, spot);

  // Guard
  const populated = gexRows.filter(
    (r) => (r.callGamma > 0 || r.putGamma > 0) && (r.callOI > 0 || r.putOI > 0)
  ).length;
  if (populated < MIN_POPULATED_STRIKES) {
    throw new Error(`${chainTicker}: only ${populated} populated strikes — skipping`);
  }

  const tng = totalNetGex(gexRows);
  return { totalNetGex: tng, totalFlowGex: 0, spot }; // SPY/QQQ: no dealer inventory, flow GEX = 0
}

// ── Upsert ────────────────────────────────────────────────────────────────────

// `source` marks how the row was produced, so a derived row is never mistaken
// for a real settle:
//   'live'         — PM window, provisional (intraday) OI
//   'theta'        — recomputed from Theta history w/ settled OPRA OI (best)
//   'mvc_snapshot' — LAST RESORT: last MVC/CB 5m snapshot of that session
//
// The prod table predates both `total_flow_gex` and `source` — it was created
// with (date, symbol, total_gex, spot, computed_at) only. Every live PM/AM write
// referenced total_flow_gex and therefore threw ("column ... does not exist"),
// which is why the ONLY rows in eod_gex came from the backfill script. Self-heal
// the schema on first write rather than requiring a manual migration.
let _colsChecked = false;
async function ensureColumns(p) {
  if (_colsChecked) return;
  _colsChecked = true;
  try {
    await p.query(`ALTER TABLE eod_gex ADD COLUMN IF NOT EXISTS total_flow_gex DOUBLE PRECISION DEFAULT 0`);
    await p.query(`ALTER TABLE eod_gex ADD COLUMN IF NOT EXISTS source TEXT`);
  } catch (e) {
    _colsChecked = false; // let a later write retry
    console.warn('[eod-gex] could not ensure columns:', e.message);
  }
}

async function upsertEodGex(date, symbol, total_gex, total_flow_gex, spot, computed_at, source = 'live') {
  const p = getPool();
  if (!p) { console.warn('[eod-gex] no DB — skipping write'); return; }
  await ensureColumns(p);
  await p.query(
    `INSERT INTO eod_gex (date, symbol, total_gex, total_flow_gex, spot, computed_at, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (date, symbol) DO UPDATE SET
       total_gex      = EXCLUDED.total_gex,
       total_flow_gex = EXCLUDED.total_flow_gex,
       spot           = EXCLUDED.spot,
       computed_at    = EXCLUDED.computed_at,
       source         = EXCLUDED.source`,
    [date, symbol, total_gex, total_flow_gex, spot, computed_at, source]
  );
}

// Dates in [from, to] (inclusive) that are trading days but have NO eod_gex row
// for `symbol`. Used by the boot catch-up.
async function missingDates(symbol, fromDate, toDate) {
  const p = getPool();
  if (!p) return [];
  const { rows } = await p.query(
    `SELECT date FROM eod_gex WHERE symbol = $1 AND date BETWEEN $2 AND $3`,
    [symbol, fromDate, toDate]
  );
  const have = new Set(rows.map((r) => String(r.date).slice(0, 10)));
  const out = [];
  const d = new Date(`${fromDate}T12:00:00Z`);
  const end = new Date(`${toDate}T12:00:00Z`);
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(d);
    if (isTradingDay(iso, wd) && !have.has(iso)) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// ── MVC/CB snapshot fallback ─────────────────────────────────────────────────
//
// The MVC auto-collector writes a snapshot every 5m during RTH, so the LAST row
// of a session (~15:55 ET) is a close-enough stand-in for an EOD row when Theta
// has no history for that date. Provisional OI and $SPX only — strictly a
// fallback, tagged source='mvc_snapshot' so it stays visibly second-class.
async function fetchMvcFallback(symbol, date) {
  if (symbol !== '$SPX') throw new Error(`${symbol}: MVC fallback is $SPX-only`);
  const p = getPool();
  if (!p) throw new Error('no DB');
  const { rows } = await p.query(
    `SELECT "totalNetGEX_OI", "spxPrice", time
       FROM mvc_snapshots
      WHERE date = $1 AND "spxPrice" > 0
      ORDER BY timestamp DESC
      LIMIT 1`,
    [date]
  );
  const r = rows[0];
  if (!r) throw new Error(`no MVC snapshot for ${date}`);
  const tng = Number(r.totalNetGEX_OI);
  const spot = Number(r.spxPrice);
  if (!Number.isFinite(tng) || !(spot > 0)) throw new Error(`bad MVC snapshot for ${date}`);
  return { totalNetGex: tng, spot, snapTime: r.time };
}

// ── Main collection ───────────────────────────────────────────────────────────

async function collectEodGex(base, opts = {}) {
  const force = !!opts.force;
  if (!force && !isEodWindow()) return; // silent skip outside window (unless forced)

  const date = etDateStr();
  const computedAt = new Date().toISOString();
  console.log(`[eod-gex] ${force ? 'manual run' : 'EOD window'} — recording for ${date}`);

  const saved = [];
  for (const { symbol, fetchMode, chainTicker } of EOD_SYMBOLS) {
    try {
      let result;
      if (fetchMode === 'state') {
        result = await fetchSpxState(base);
      } else {
        result = await fetchChainGex(base, chainTicker);
      }

      const { totalNetGex: tng, totalFlowGex: tfg, spot } = result;

      if (!Number.isFinite(tng) || !Number.isFinite(spot) || !(spot > 0)) {
        console.warn(`[eod-gex] ${symbol}: invalid totalNetGex=${tng} spot=${spot} — skip`);
        continue;
      }

      await upsertEodGex(date, symbol, tng, tfg || 0, spot, computedAt, 'live');
      saved.push(symbol);
      console.log(
        `[eod-gex] ${symbol} ${date} — GEX ${tng >= 0 ? '+' : ''}${(tng / 1e9).toFixed(3)}B  flow ${tfg >= 0 ? '+' : ''}${((tfg || 0) / 1e9).toFixed(3)}B  spot=${spot.toFixed(2)}`
      );
    } catch (e) {
      console.warn(`[eod-gex] ${symbol} — ${e.message}`);
    }
  }
  return { date, saved };
}

// ── Morning settled-OI recompute (historical, all from Theta) ───────────────────

// Resolve the EOD spot for a symbol on a past date.
async function fetchSettleSpot(symbol, date) {
  if (symbol === '$SPX') return fetchIndexEodTheta('SPX', date);
  return fetchStockEodTheta(symbol, date); // SPY / QQQ
}

// Recompute per-strike GEX rows for ONE symbol on a PAST date entirely from
// Theta history: settled OPRA OI + EOD greeks + EOD volume + settle spot.
// Returns { gexRows, spot } or throws if data is incomplete.
async function computeHistoricalGexRows(symbol, date) {
  // thetaRoot() strips the '$' and maps SPX→SPXW. It previously did NOT strip
  // the '$', so '$SPX' went to Theta verbatim and every history call came back
  // empty ("no historical rows"). Pass the bare root to be explicit.
  const root = symbol === '$SPX' ? 'SPX' : symbol;
  // Wide strike band so the EOD TOTAL isn't truncated to ±40 around spot.
  const SR = { strikeRange: 500 };
  const [spot, oiMap, greekMap, eodRows] = await Promise.all([
    fetchSettleSpot(symbol, date),
    fetchOiHistoryTheta(root, date, SR).catch(() => new Map()),
    fetchGreeksEodHistoryTheta(root, date, SR).catch(() => new Map()),
    fetchEodHistoryTheta(root, date, SR).catch(() => []),
  ]);

  if (!(Number(spot) > 0)) throw new Error(`${symbol}: no settle spot for ${date}`);

  // EOD price+volume map keyed exp|strike|type from EOD history rows.
  // Price (mid, falling back to close) lets us back out IV for the BS fallback
  // when Theta has no historical greek for a strike.
  const eodMap = new Map();
  for (const r of eodRows) {
    const bid = Number(r.bid), ask = Number(r.ask), close = Number(r.close);
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : (close > 0 ? close : 0);
    eodMap.set(keyOf(r.expiration, r.strike, r.type), { volume: Number(r.volume) || 0, price: mid });
  }

  // Anchor T to the settle instant of `date` (~16:00 ET ≈ 20:00 UTC), NOT now,
  // so historical BS greeks use the correct time-to-expiry.
  const asOf = new Date(`${date}T20:00:00Z`).getTime();

  let bsFilled = 0;
  const flatRows = [];
  for (const [k, oi] of oiMap) {
    const [expiration, strikeStr, type] = k.split('|');
    const strike = Number(strikeStr);
    if (!(strike > 0)) continue;

    const g = greekMap.get(k) || {};
    const eod = eodMap.get(k) || {};
    let gamma = Math.abs(Number(g.gamma ?? 0));
    let delta = Math.abs(Number(g.delta ?? 0));

    // BS fallback: Theta had no historical greek for this strike. Back out IV
    // from the EOD price and compute gamma/delta with the same bsGreeks the
    // live feed uses. T from expiry; r default inside bsGreeks.
    if (!(gamma > 0) && Number(eod.price) > 0) {
      const T = yearsToExpiry(expiration, asOf);
      if (T > 0) {
        const sigma = impliedVol({ price: eod.price, S: Number(spot), K: strike, T, type });
        if (sigma > 0) {
          const bg = bsGreeks({ S: Number(spot), K: strike, T, sigma, type });
          gamma = Math.abs(bg.gamma);
          delta = Math.abs(bg.delta);
          if (gamma > 0) bsFilled++;
        }
      }
    }

    const oiN = Number(oi) || 0;
    if (!(gamma > 0) && !(oiN > 0)) continue;
    flatRows.push({
      strike,
      side: type === 'C' ? 'call' : 'put',
      oi: oiN,
      volume: Number(eod.volume ?? 0),
      gamma,
      delta,
    });
  }
  if (bsFilled > 0) console.log(`[eod-gex/am] ${symbol} ${date} — BS-filled gamma for ${bsFilled} strikes`);

  if (!flatRows.length) throw new Error(`${symbol}: no historical rows for ${date}`);

  const gexRows = computeGexRows(flatRows, Number(spot));
  const populated = gexRows.filter(
    (r) => (r.callGamma > 0 || r.putGamma > 0) && (r.callOI > 0 || r.putOI > 0)
  ).length;
  if (populated < MIN_POPULATED_STRIKES) {
    throw new Error(`${symbol}: only ${populated} populated strikes for ${date} — skip`);
  }
  return { gexRows, spot: Number(spot) };
}

// Back-compat wrapper: EOD callers only need the total + spot.
async function computeHistoricalEodGex(symbol, date) {
  const { gexRows, spot } = await computeHistoricalGexRows(symbol, date);
  return { totalNetGex: totalNetGex(gexRows), spot };
}

// Per-(date|symbol) bake-in state. Once baked, the symbol is skipped for that
// date. `last` holds the previous poll's total so we can detect "no change".
const _amState = new Map(); // key `date|symbol` -> { last:number, baked:boolean }

// Run the morning settled-OI pass for the prior trading day. Overwrites each
// symbol's row; at/after 09:30 ET, if a symbol's total matches the previous
// poll, marks it baked (stops re-running it for that date).
async function collectMorningEodGex(opts = {}) {
  const force = !!opts.force;
  if (!force && !isAmWindow()) return;

  const today = etDateStr();
  const date = opts.date || prevTradingDay(today);
  if (!date) { console.warn('[eod-gex/am] no prior trading day resolved'); return; }

  const { hour, minute } = etParts();
  const atBakeCheckpoint = (hour * 60 + minute) >= AM_BAKE_MINS;
  const computedAt = new Date().toISOString();

  const done = [];
  for (const { symbol } of EOD_SYMBOLS) {
    const sk = `${date}|${symbol}`;
    const st = _amState.get(sk) || { last: null, baked: false };
    if (st.baked) { done.push(`${symbol}(baked)`); continue; }

    try {
      const { totalNetGex: tng, spot } = await computeHistoricalEodGex(symbol, date);
      if (!Number.isFinite(tng) || !(spot > 0)) {
        console.warn(`[eod-gex/am] ${symbol} ${date}: invalid tng=${tng} spot=${spot} — skip`);
        continue;
      }

      // NOTE: this used to be upsertEodGex(date, symbol, tng, spot, computedAt) —
      // 5 args into a 6-arg signature, so `spot` landed in total_flow_gex and
      // computedAt in spot. The settled pass has no flow GEX (history has no
      // dealer inventory), so pass 0 explicitly.
      await upsertEodGex(date, symbol, tng, 0, spot, computedAt, 'theta');

      // Bake-in: at/after 09:30, if unchanged from the previous poll, freeze it.
      const unchanged = st.last != null && Math.abs(st.last - tng) < 1; // ~$1 of GEX
      const baked = atBakeCheckpoint && unchanged;
      _amState.set(sk, { last: tng, baked });

      done.push(`${symbol}${baked ? '(baked)' : ''}`);
      console.log(
        `[eod-gex/am] ${symbol} ${date} — settled GEX ${tng >= 0 ? '+' : ''}${(tng / 1e9).toFixed(3)}B  spot=${spot.toFixed(2)}${baked ? '  [BAKED]' : ''}`
      );
    } catch (e) {
      console.warn(`[eod-gex/am] ${symbol} ${date} — ${e.message}`);
    }
  }

  // Memory hygiene: drop state for dates older than the one we just processed.
  for (const k of _amState.keys()) {
    if (k.split('|')[0] < date) _amState.delete(k);
  }
  return { date, done };
}

// ── Boot catch-up ────────────────────────────────────────────────────────────
//
// The PM pass only fires if the process happens to be up during 3:55–4:05 ET.
// A redeploy or restart that straddles that window silently loses the day (this
// is exactly how 2026-07-09 and 07-10 went missing). On boot, look back
// CATCHUP_DAYS trading days and fill any hole:
//
//   1. Theta history (settled OI)  → source='theta'      [preferred]
//   2. last MVC/CB 5m snapshot     → source='mvc_snapshot' [$SPX only, last resort]
//
// Never overwrites an existing row, so it's safe to run on every boot.
const CATCHUP_DAYS = 5;
const CATCHUP_DELAY_MS = 90_000; // let Theta finish connecting first

async function catchUpMissing(opts = {}) {
  const lookback = Number(opts.days || CATCHUP_DAYS);
  const today = etDateStr();

  // Window = [lookback trading days back, prior trading day]. Today is excluded:
  // its row is the PM pass's job and isn't "missing" until the close.
  const to = prevTradingDay(today);
  if (!to) return;
  let from = to;
  for (let i = 1; i < lookback; i++) {
    const p = prevTradingDay(from);
    if (!p) break;
    from = p;
  }

  const filled = [];
  for (const { symbol } of EOD_SYMBOLS) {
    let gaps = [];
    try { gaps = await missingDates(symbol, from, to); }
    catch (e) { console.warn(`[eod-gex/catchup] ${symbol} — gap scan failed: ${e.message}`); continue; }
    if (!gaps.length) continue;

    console.log(`[eod-gex/catchup] ${symbol} — ${gaps.length} missing day(s): ${gaps.join(', ')}`);
    for (const date of gaps) {
      const computedAt = new Date().toISOString();

      // 1) Theta history (settled OI) — the real fix.
      try {
        const { totalNetGex: tng, spot } = await computeHistoricalEodGex(symbol, date);
        if (Number.isFinite(tng) && spot > 0) {
          await upsertEodGex(date, symbol, tng, 0, spot, computedAt, 'theta');
          filled.push(`${symbol}:${date}(theta)`);
          console.log(`[eod-gex/catchup] ${symbol} ${date} — theta  GEX ${tng >= 0 ? '+' : ''}${(tng / 1e9).toFixed(3)}B  spot=${spot.toFixed(2)}`);
          continue;
        }
      } catch (e) {
        console.warn(`[eod-gex/catchup] ${symbol} ${date} — theta failed: ${e.message}`);
      }

      // 2) MVC/CB snapshot fallback ($SPX only). Provisional OI, ~15:55 ET.
      try {
        const { totalNetGex: tng, spot, snapTime } = await fetchMvcFallback(symbol, date);
        await upsertEodGex(date, symbol, tng, 0, spot, computedAt, 'mvc_snapshot');
        filled.push(`${symbol}:${date}(mvc)`);
        console.log(`[eod-gex/catchup] ${symbol} ${date} — MVC fallback @ ${snapTime} ET  GEX ${tng >= 0 ? '+' : ''}${(tng / 1e9).toFixed(3)}B  spot=${spot.toFixed(2)}  [PROVISIONAL OI]`);
      } catch (e) {
        console.warn(`[eod-gex/catchup] ${symbol} ${date} — no fallback: ${e.message}`);
      }
    }
  }

  if (filled.length) console.log(`[eod-gex/catchup] filled ${filled.length}: ${filled.join(', ')}`);
  else console.log('[eod-gex/catchup] no gaps in the last ' + lookback + ' trading days');
  return { from, to, filled };
}

// ── Scheduler ────────────────────────────────────────────────────────────────
// Polls every minute. When inside the 3:55–4:05 ET window on a trading day,
// records once per symbol. A second tick inside the window upserts (overwrites),
// so the 4:00 PM close price wins if the 3:55 spot was still mid-session.
//
// NOTE: This intentionally fires multiple times inside the window — each fires
// an upsert so the latest reading wins. The guard in isEodWindow() gates it.

let _pollTimer = null;
let _amTimer = null;

function startEodGexRecorder(port) {
  const base = `http://localhost:${port}`;

  console.log('[eod-gex] enabled — PM: 60s poll in 3:55–4:05 ET (provisional OI); AM: 30min poll 6:30–9:30 ET recomputes prior day w/ settled OI, bakes in at 9:30; boot catch-up backfills the last ' + CATCHUP_DAYS + ' trading days');

  // Boot catch-up: a restart that straddled 3:55–4:05 ET loses the day outright.
  // Delayed so Theta has time to connect before we ask it for history.
  setTimeout(() => {
    catchUpMissing().catch((e) => console.warn('[eod-gex/catchup] error:', e.message));
  }, CATCHUP_DELAY_MS).unref?.();

  // PM provisional pass (live intraday OI at the close).
  const pmTick = async () => {
    if (!isEodWindow()) return;
    try { await collectEodGex(base); }
    catch (e) { console.warn('[eod-gex] pm tick error:', e.message); }
  };
  _pollTimer = setInterval(() => { void pmTick(); }, 60_000);
  _pollTimer.unref?.();

  // AM settled pass (overwrite prior day with settled OPRA OI; bake-in at 9:30).
  const amTick = async () => {
    if (!isAmWindow()) return;
    try { await collectMorningEodGex(); }
    catch (e) { console.warn('[eod-gex] am tick error:', e.message); }
  };
  _amTimer = setInterval(() => { void amTick(); }, AM_POLL_EVERY_MS);
  _amTimer.unref?.();

  return () => {
    if (_pollTimer) clearInterval(_pollTimer);
    if (_amTimer) clearInterval(_amTimer);
  };
}

module.exports = {
  startEodGexRecorder,
  collectEodGex,
  collectMorningEodGex,
  computeHistoricalEodGex,
  computeHistoricalGexRows,
  catchUpMissing,
  missingDates,
};
