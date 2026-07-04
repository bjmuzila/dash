'use strict';
/**
 * server-v2/far-cb-tickers.js
 *
 * Ticker universe for the "Watch This" (far-CB) scanner. Deliberately NOT the
 * full ~380-name EM watchlist — this is a curated core list (Brandon's actual
 * TradingView "In positions" set, futures/crypto/macro-index rows stripped
 * since they're not optionable single names Theta can chain), plus any
 * customer-added tickers on top.
 *
 * CORE_TICKERS = static, edited here + redeployed.
 * Custom tickers = far_cb_custom_tickers table (Postgres, same DB as the
 * Next.js app's lib/db.ts) — any signed-in customer can add one via
 * POST /api/far-cb-tickers; getActiveRoster() reads them live, no redeploy.
 */

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

/** CORE_TICKERS ∪ active customer-added tickers. Safe if DB is unavailable
 * (falls back to CORE_TICKERS only). */
async function getActiveRoster() {
  const p = getPool();
  if (!p) return [...CORE_TICKERS];
  try {
    const { rows } = await p.query(
      `SELECT symbol FROM far_cb_custom_tickers WHERE active = TRUE`
    );
    const custom = rows.map((r) => String(r.symbol).toUpperCase());
    return [...new Set([...CORE_TICKERS, ...custom])];
  } catch (e) {
    console.warn('[far-cb-tickers] custom ticker fetch failed, using CORE only:', e.message);
    return [...CORE_TICKERS];
  }
}

module.exports = { CORE_TICKERS, getActiveRoster };
