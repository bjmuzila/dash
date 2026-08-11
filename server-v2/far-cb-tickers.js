'use strict';
/**
 * server-v2/far-cb-tickers.js
 *
 * Ticker universe for the "Watch This" (far-CB) scanner.
 *
 * 2026-08-11: the sweep universe is now the SCANNER universe — the same list the
 * /scanner GEX + Strike Query tabs and the flow tape run on
 * (server-v2/scanner-tickers.js, resolved through rosterStore.getSymbols
 * ('scanner') so the owner Watchlists page still applies). Watch This is a
 * scanner tab; running it off its own private roster meant a name added to the
 * scanner universe never appeared here.
 *
 * CORE_TICKERS below is kept as the historical curated list. It is NO LONGER the
 * sweep baseline — it stays exported because roster-store.js still surfaces it
 * as the 'farcb' list on the owner Watchlists page, and because it documents the
 * original "in positions" set. Editing it no longer changes what gets swept;
 * edit scanner-tickers.js (or the Watchlists page's Scanner list) instead.
 *
 * Custom tickers = far_cb_custom_tickers table (Postgres, same DB as the
 * Next.js app's lib/db.ts) — any signed-in customer can add one via
 * POST /api/far-cb-tickers; getActiveRoster() reads them live, no redeploy.
 * They still stack on top of the scanner universe.
 */

// scanner-tickers.js is a plain array module that requires nothing, so a
// top-level require is safe. roster-store (which requires THIS file) still has
// to be pulled in lazily inside getActiveRoster to avoid the cycle.
const scannerBase = require('./scanner-tickers');

const CORE_TICKERS = [
  // Indices / broad ETFs
  'SPX', 'SPY', 'QQQ', 'NDX', 'IWM', 'RSP', 'MAGS', 'VIX', 'TLT', 'UVXY',
  // Mega-cap / mains
  'AAPL', 'AMD', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'SPCX', 'TSLA',
  // Shares
  'AAPU', 'ASTS', 'AVGO', 'BYND', 'CMG', 'COIN', 'CWVX', 'ETHA', 'FBL', 'FIG',
  'GME', 'HIMZ', 'HOOD', 'IBIT', 'LLYX', 'MSFU', 'NFLX', 'NOK', 'NVDX', 'OSCR',
  'PLTR', 'PONY', 'QBTS', 'QUBT', 'RGTI', 'RIVN', 'SLV', 'SMCI', 'SOFI', 'SOUN',
  'SOXL', 'TQQQ', 'TSLL', 'UUUU',
  // Spreads
  'ABNB', 'AFRM', 'ARM', 'BA', 'BABA', 'CCJ', 'CHWY', 'COST', 'CRCL', 'CRM',
  'CRWD', 'CRWV', 'DJT', 'FDX', 'GS', 'HIMS', 'INTC', 'IREN', 'LAC', 'LLY',
  'MA', 'MARA', 'MCD', 'MRK', 'MRNA', 'MU', 'NIO', 'NKE', 'NNE', 'NXE', 'OKLO',
  'OPEN', 'OXY', 'PDD', 'PFE', 'PTON', 'RBLX', 'RIOT', 'RKLB', 'ROKU', 'SE',
  'SMH', 'SNDK', 'SNOW', 'TGT', 'TSM', 'TTD', 'U', 'UNH', 'UPS', 'UPST', 'V',
  'XPEV', 'XYZ',
];

// ── customer-added tickers (shared Postgres, same table lib/db.ts writes) ────

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
      console.warn('[far-cb-tickers] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    pgUnavailable = true;
    return null;
  }
}

/** Active customer-added tickers only (far_cb_custom_tickers). */
async function getCustomTickers() {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      `SELECT symbol FROM far_cb_custom_tickers WHERE active = TRUE`
    );
    return rows.map((r) => String(r.symbol).toUpperCase());
  } catch (e) {
    console.warn('[far-cb-tickers] custom ticker fetch failed, using CORE only:', e.message);
    return [];
  }
}

/**
 * Scanner universe ∪ active customer-added tickers.
 *
 * Two layers, in precedence order:
 *   1. roster_overrides('scanner') — the owner Watchlists page's Scanner list,
 *                                    which itself falls back to the
 *                                    scanner-tickers.js buckets when the DB has
 *                                    no overrides. Adds AND removes.
 *   2. far_cb_custom_tickers       — any signed-in customer, add-only.
 *
 * Safe if the DB is unavailable (falls back to the scanner-tickers.js file
 * baseline).
 *
 * roster-store is required lazily: it requires THIS module for the 'farcb'
 * baseline, so a top-level require would be a cycle.
 */
async function getActiveRoster() {
  let core = [...scannerBase.SCANNER_TICKERS];
  try {
    const resolved = await require('./roster-store').getSymbols('scanner');
    if (resolved.length) core = resolved;
  } catch (e) {
    console.warn('[far-cb-tickers] scanner roster unavailable, using the file baseline:', e.message);
  }
  const custom = await getCustomTickers();
  return [...new Set([
    ...core.map((s) => String(s).trim().toUpperCase()).filter(Boolean),
    ...custom,
  ])];
}

module.exports = { CORE_TICKERS, getActiveRoster, getCustomTickers };
