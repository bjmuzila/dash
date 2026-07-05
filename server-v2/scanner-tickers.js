'use strict';
/**
 * server-v2/scanner-tickers.js
 *
 * The curated ticker universe for the SCANNERS (/scanner GEX + Strike Query) and
 * the multi-ticker FLOW tape. This is intentionally SEPARATE from em-tickers.js
 * (which drives the customer-facing /em levels page) — editing this list changes
 * only the scanners + flow, never /em.
 *
 * Groups mirror the trading watchlist categories:
 *   MAIN    — indices + mega-caps, the fast/hot lane (2-min sweeps).
 *   SHARES  — single-name shares bucket.
 *   SPREADS — spread candidates bucket.
 *
 * Consumed by:
 *   strike-growth-recorder.js — reconciles strike_growth_watchlist to this list
 *                               (active = all, hot = MAIN) on boot.
 *   multi-flow.js             — FLOW_TICKERS=SCANNER sources flow roots here.
 */

// Fast/hot lane — swept every HOT_MINS (2m) for near-live data.
const MAIN = [
  'SPY', 'QQQ', 'SPX', 'NDX', 'VIX',
  'AAPL', 'AMD', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'SPCX', 'TSLA',
];

const SHARES = [
  'AAPU', 'ASTS', 'AVGO', 'BYND', 'CMG', 'COIN', 'CWVX', 'ETHA', 'FBL', 'FIG',
  'GME', 'HIMZ', 'HOOD', 'IBIT', 'LLYX', 'MSFU', 'NFLX', 'NOK', 'NVDX', 'OSCR',
  'PLTR', 'PONY', 'QBTS', 'QUBT', 'RGTI', 'RIVN', 'SLV', 'SMCI', 'SOFI', 'SOUN',
  'SOXL', 'TQQQ', 'TSLL', 'UUUU',
];

const SPREADS = [
  'ABNB', 'AFRM', 'ARM', 'BA', 'BABA', 'CCJ', 'CHWY', 'COST', 'CRCL', 'CRM',
  'CRWD', 'CRWV', 'DJT', 'FDX', 'GS', 'HIMS', 'INTC', 'IREN', 'IWM', 'LAC',
  'LLY', 'MA', 'MARA', 'MCD', 'MRK', 'MRNA', 'MU', 'NIO', 'NKE', 'NNE',
  'NXE', 'OKLO', 'OPEN', 'OXY', 'PDD', 'PFE', 'PTON', 'RBLX', 'RIOT', 'RKLB',
  'ROKU', 'SE', 'SMH', 'SNDK', 'SNOW', 'TGT', 'TSM', 'TTD', 'U', 'UNH',
  'UPS', 'UPST', 'V', 'XPEV', 'XYZ',
];

// Full de-duped universe (order: MAIN → SHARES → SPREADS).
const SCANNER_TICKERS = [...new Set([...MAIN, ...SHARES, ...SPREADS])]
  .map((t) => String(t).trim().toUpperCase()).filter(Boolean);

// The hot/fast-lane subset.
const SCANNER_HOT = [...new Set(MAIN)].map((t) => String(t).trim().toUpperCase()).filter(Boolean);

module.exports = { SCANNER_TICKERS, SCANNER_HOT, MAIN, SHARES, SPREADS };
