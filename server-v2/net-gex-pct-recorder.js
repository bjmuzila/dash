'use strict';
/**
 * server-v2/net-gex-pct-recorder.js
 *
 * "Net GEX %" scanner — for every ticker on the EM watchlist (same roster the
 * Far-CB watcher uses), computes the signed net-GEX share of total gamma:
 *
 *     +GEX % = Σ (net GEX where > 0) ÷ Σ |net GEX|   × 100     (0 … 100)
 *
 * This is BYTE-FOR-BYTE the home page's "+GEX %" stat (HomeClient.tsx
 * `posGexPct`): per-STRIKE net first, then abs. 50 = neutral, 100 = pure long
 * gamma, 0 = pure short gamma. If you change the formula here, change it there
 * too — the whole point is that SPX reads the same on both surfaces.
 *
 * ...on the SAME basis as the home-page GEX chart (OI+Vol: netGEX + netVolGEX).
 * +100 = every dollar of gamma on the board is long/positive (pinned, dealers
 * long gamma); −100 = all short gamma (unstable). It's a normalized, cross-
 * ticker-comparable version of "net GEX", so a $2T name and a $5B name sit on
 * the same axis.
 *
 * Two numbers per ticker:
 *   near_pct — nearest (front) expiration only
 *   all_pct  — every expiration within MAX_DTE_DAYS, summed
 *
 * Table: net_gex_pct (date, symbol) — upserted every sweep.
 *
 * Wiring: startNetGexPctRecorder() from server-with-proxy.js.
 * Read:   GET  /proxy/net-gex-pct
 * Manual: POST /proxy/net-gex-pct-run   (force = bypass RTH gate)
 */

const { computeGexRows } = require('./computation/gex-calculator');
const {
  fetchChainTheta,
  fetchGreeksTheta,
  fetchOpenInterestTheta,
  fetchVolumeTheta,
  fetchStockQuoteTheta,
  fetchIndexPriceTheta,
} = require('./proxy-thetadata');
const { getActiveRoster } = require('./far-cb-tickers');

const INDEX_SYMBOLS = new Set(['SPX', 'NDX', 'VIX', 'RUT', 'XSP']);
const keyOf = (exp, strike, type) => `${exp}|${Number(strike)}|${type}`;

// ── tunables ────────────────────────────────────────────────────────────────
const SWEEP_MINS       = Number(process.env.NGP_SWEEP_MINS || 30);
const MAX_DTE_DAYS     = Number(process.env.NGP_MAX_DTE_DAYS || 30);
const STRIKE_RANGE_PCT = Number(process.env.NGP_STRIKE_RANGE_PCT || 40); // ± around spot
const MAX_EXPIRIES     = Number(process.env.NGP_MAX_EXPIRIES || 6);
const TICKER_DELAY_MS  = Number(process.env.NGP_TICKER_DELAY_MS || 500);
const EXPIRY_DELAY_MS  = Number(process.env.NGP_EXPIRY_DELAY_MS || 150);
const RETENTION_DAYS   = Number(process.env.NGP_RETENTION_DAYS || 30);

const RTH_OPEN_MINS  = 9 * 60 + 30;
const RTH_CLOSE_MINS = 16 * 60;

const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── PG pool ─────────────────────────────────────────────────────────────────
let pool = null;
let pgUnavailable = false;
let _schemaReady = false;

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
      console.warn('[net-gex-pct] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[net-gex-pct] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  if (_schemaReady) return true;
  const p = getPool();
  if (!p) return false;
  await p.query(`
    CREATE TABLE IF NOT EXISTS net_gex_pct (
      date         DATE              NOT NULL,
      symbol       TEXT              NOT NULL,
      spot         DOUBLE PRECISION  NOT NULL,
      near_expiry  TEXT,
      near_dte     INTEGER,
      near_pct     DOUBLE PRECISION,   -- signed −100..100, front expiry only
      near_net     DOUBLE PRECISION,   -- Σ netGEX (OI+Vol), front expiry
      near_abs     DOUBLE PRECISION,   -- Σ |netGEX|, front expiry
      near_pct_vol DOUBLE PRECISION,   -- same but vol-only basis
      all_pct      DOUBLE PRECISION,   -- signed −100..100, all expiries ≤ MAX_DTE
      all_net      DOUBLE PRECISION,
      all_abs      DOUBLE PRECISION,
      all_pct_vol  DOUBLE PRECISION,
      exp_count    INTEGER,
      ts           TIMESTAMPTZ       NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_net_gex_pct_date ON net_gex_pct (date, all_pct);`);
  _schemaReady = true;
  return true;
}

// ── time helpers ────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function etParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(d);
  const g = (t) => f.find((p) => p.type === t)?.value || '';
  return { y: g('year'), m: g('month'), d: g('day'), hh: +g('hour'), mm: +g('minute'), wd: g('weekday') };
}
function etDateStr(d = new Date()) {
  const { y, m, d: dd } = etParts(d);
  return `${y}-${m}-${dd}`;
}
function isRthWindow() {
  const { hh, mm, wd } = etParts();
  if (wd === 'Sat' || wd === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(etDateStr())) return false;
  const mins = hh * 60 + mm;
  return mins >= RTH_OPEN_MINS && mins <= RTH_CLOSE_MINS;
}
function daysBetween(fromYmd, toYmd) {
  const a = Date.UTC(+fromYmd.slice(0, 4), +fromYmd.slice(5, 7) - 1, +fromYmd.slice(8, 10));
  const b = Date.UTC(+toYmd.slice(0, 4), +toYmd.slice(5, 7) - 1, +toYmd.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

// ── per-ticker scan ─────────────────────────────────────────────────────────
/**
 * Returns { spot, near:{expiry,dte,net,abs,pct,pctVol}, all:{net,abs,pct,pctVol,expCount} }
 */
async function scanTicker(symbol) {
  let spot;
  if (INDEX_SYMBOLS.has(symbol.toUpperCase())) {
    spot = Number(await fetchIndexPriceTheta(symbol));
  } else {
    const quote = await fetchStockQuoteTheta(symbol);
    spot = Number(quote?.last ?? quote?.mark ?? 0);
  }
  if (!(spot > 0)) throw new Error(`spot 0 for ${symbol}`);

  const { contracts, expirations } = await fetchChainTheta(symbol);
  if (!expirations?.length) throw new Error(`no expirations ${symbol}`);

  const today = etDateStr();
  const targetExps = expirations
    .filter((e) => daysBetween(today, e) >= 0 && daysBetween(today, e) <= MAX_DTE_DAYS)
    .sort()
    .slice(0, MAX_EXPIRIES);
  if (!targetExps.length) throw new Error(`no expiries within ${MAX_DTE_DAYS}d for ${symbol}`);

  const loBound = spot * (1 - STRIKE_RANGE_PCT / 100);
  const hiBound = spot * (1 + STRIKE_RANGE_PCT / 100);

  let near = null;
  let allNet = 0, allAbs = 0, allNetVol = 0, allAbsVol = 0, expCount = 0;

  for (const expiry of targetExps) {
    const expContracts = contracts.filter(
      (c) => c.expiration === expiry && c.strike >= loBound && c.strike <= hiBound
    );
    if (!expContracts.length) { await sleep(EXPIRY_DELAY_MS); continue; }

    let greekMap, oiMap, volMap;
    try {
      [greekMap, oiMap, volMap] = await Promise.all([
        fetchGreeksTheta(symbol, expiry).catch(() => new Map()),
        fetchOpenInterestTheta(symbol, expiry).catch(() => new Map()),
        fetchVolumeTheta(symbol, expiry).catch(() => new Map()),
      ]);
    } catch {
      await sleep(EXPIRY_DELAY_MS);
      continue;
    }

    const flatRows = [];
    for (const c of expContracts) {
      const k = keyOf(c.expiration, c.strike, c.type);
      const g = greekMap.get(k) || {};
      const oi = Number(oiMap.get(k)?.oi ?? 0);
      const vol = Number(volMap.get(k) ?? 0);
      const gamma = Math.abs(Number(g.gamma ?? 0));
      if (!(gamma > 0) && !(oi > 0) && !(vol > 0)) continue;
      flatRows.push({ strike: c.strike, side: c.type === 'C' ? 'call' : 'put', oi, volume: vol, gamma, delta: 0 });
    }
    if (!flatRows.length) { await sleep(EXPIRY_DELAY_MS); continue; }

    const gexRows = computeGexRows(flatRows, spot);
    // IDENTICAL to the home page's "+GEX %" (HomeClient.tsx posGexPct):
    //   pos-share = Σ (net GEX where net > 0) ÷ Σ |net GEX|   × 100   → 0…100
    // Per-STRIKE net, then abs. 50 = neutral, 100 = pure long gamma, 0 = pure
    // short gamma. Keep this in lockstep with HomeClient or the two surfaces
    // will disagree on the same ticker.
    let pos = 0, abs = 0, posVol = 0, absVol = 0;
    for (const r of gexRows) {
      const v = Number(r.netGEX ?? 0) + Number(r.netVolGEX ?? 0); // OI+Vol basis
      if (v > 0) pos += v;
      abs += Math.abs(v);

      const vv = Number(r.netVolGEX ?? 0);                        // vol-only basis
      if (vv > 0) posVol += vv;
      absVol += Math.abs(vv);
    }
    const net = pos, netVol = posVol; // stored in near_net/all_net as the +GEX numerator

    expCount += 1;
    allNet += net; allAbs += abs; allNetVol += netVol; allAbsVol += absVol;

    if (!near) {
      near = {
        expiry,
        dte: daysBetween(today, expiry),
        net, abs,
        pct: abs > 0 ? (net / abs) * 100 : null,
        pctVol: absVol > 0 ? (netVol / absVol) * 100 : null,
      };
    }
    await sleep(EXPIRY_DELAY_MS);
  }

  if (!near || !expCount) return null;

  return {
    spot,
    near,
    all: {
      net: allNet,
      abs: allAbs,
      pct: allAbs > 0 ? (allNet / allAbs) * 100 : null,
      pctVol: allAbsVol > 0 ? (allNetVol / allAbsVol) * 100 : null,
      expCount,
    },
  };
}

// ── persistence ─────────────────────────────────────────────────────────────
async function upsert(p, date, symbol, r) {
  await p.query(
    `INSERT INTO net_gex_pct
       (date, symbol, spot, near_expiry, near_dte, near_pct, near_net, near_abs, near_pct_vol,
        all_pct, all_net, all_abs, all_pct_vol, exp_count, ts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
     ON CONFLICT (date, symbol) DO UPDATE SET
       spot = EXCLUDED.spot,
       near_expiry = EXCLUDED.near_expiry, near_dte = EXCLUDED.near_dte,
       near_pct = EXCLUDED.near_pct, near_net = EXCLUDED.near_net,
       near_abs = EXCLUDED.near_abs, near_pct_vol = EXCLUDED.near_pct_vol,
       all_pct = EXCLUDED.all_pct, all_net = EXCLUDED.all_net,
       all_abs = EXCLUDED.all_abs, all_pct_vol = EXCLUDED.all_pct_vol,
       exp_count = EXCLUDED.exp_count, ts = now()`,
    [
      date, symbol, r.spot,
      r.near.expiry, r.near.dte, r.near.pct, r.near.net, r.near.abs, r.near.pctVol,
      r.all.pct, r.all.net, r.all.abs, r.all.pctVol, r.all.expCount,
    ]
  );
}

async function pruneOld(p) {
  await p.query(`DELETE FROM net_gex_pct WHERE date < CURRENT_DATE - INTERVAL '${RETENTION_DAYS} days'`);
}

// ── sweep ───────────────────────────────────────────────────────────────────
async function runSweep(opts = {}) {
  const force = !!opts.force;
  if (!force && !isRthWindow()) return { skipped: 'outside RTH' };
  if (!(await ensureSchema())) return { skipped: 'no DB' };

  const p = getPool();
  const date = etDateStr();
  await pruneOld(p).catch((e) => console.warn('[net-gex-pct] prune error:', e.message));

  const roster = (await getActiveRoster()).map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  console.log(`[net-gex-pct] sweep ${date} — ${roster.length} symbols, ${MAX_DTE_DAYS}d window`);

  let wrote = 0;
  const failed = [];
  for (const symbol of roster) {
    try {
      const result = await scanTicker(symbol);
      if (result) { await upsert(p, date, symbol, result); wrote += 1; }
    } catch (e) {
      failed.push(`${symbol}:${e.message}`);
    }
    await sleep(TICKER_DELAY_MS);
  }
  console.log(`[net-gex-pct] sweep done — ${wrote} written, ${failed.length} failed`);
  return { date, wrote, failed: failed.length, failures: failed.slice(0, 10) };
}

// ── scheduler ───────────────────────────────────────────────────────────────
function startNetGexPctRecorder() {
  const tick = () => {
    runSweep().catch((e) => console.warn('[net-gex-pct] sweep error:', e.message));
  };
  setTimeout(tick, 45_000);                       // first pass shortly after boot
  setInterval(tick, Math.max(5, SWEEP_MINS) * 60_000);
  console.log(`[net-gex-pct] recorder started — every ${SWEEP_MINS}m during RTH`);
}

module.exports = {
  startNetGexPctRecorder,
  runSweep,
  ensureSchema,
  getPool,
  scanTicker,
  MAX_DTE_DAYS,
};
