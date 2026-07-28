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
 *   OPTVOL  — option-volume leaders not already covered above.
 *
 * Consumed by:
 *   strike-growth-recorder.js — reconciles strike_growth_watchlist to this list
 *                               (active = all, hot = MAIN) on boot.
 *   multi-flow.js             — FLOW_TICKERS=SCANNER sources flow roots here.
 *
 * ---------------------------------------------------------------------------
 * 2026-07-28 revision — pruned illiquid names, backfilled from tastytrade.
 *
 * REMOVED (45) — no meaningful option volume, so GEX% was computed off a
 * handful of strikes and read as noise:
 *   illiquid meme/retail : BYND DJT HTZ LAC LCID NNE NXE OSCR PONY PTON RKT UUUU
 *   other illiquid       : ABNB AFRM CCJ CHWY CMG FDX FHN KORU KRE MA MRK RBLX
 *                          ROKU SE SNOW TGT U UPST VFC XBI XLB XLI XLP XLU
 *                          XPEV XYZ
 *   single-stock levered/covered-call ETFs (GEX is a wrapper artifact, not
 *   dealer positioning in the underlying):
 *                          AAPU CWVX FBL HIMZ LLYX MSFU NVDX
 *   NOTE: TSLL is the same kind of instrument and is still in SHARES; SOXL and
 *   TQQQ are index-levered (different case) and were kept.
 *
 * ADDED (52) — sourced live from the tastytrade "High Options Volume" public
 * watchlist (GET /public-watchlists/High%20Options%20Volume, 198 names as of
 * 2026-07-28). Speculative/low-quality names on that list were deliberately
 * NOT backfilled: AAOI ACHR AMC APLD BBAI CAPR CLF CLSK DBX ECHO EOSE JBLU
 * JOBY KEEL LAES NN NVDL NVTS POET PSKY QGEN QS REPL RUN RZLV SMR SNXX TE
 * TSLR VG. Add any of them back by hand if you want them.
 *
 * Net: 161 → 168 tickers. Sweep cost scales with this count — if the 2-min
 * hot lane or the full sweep starts lagging, trim OPTVOL first (MAIN is the
 * only group on the fast cadence).
 * ---------------------------------------------------------------------------
 */

// Fast/hot lane — swept every HOT_MINS (2m) for near-live data.
const MAIN = [
  'SPY', 'QQQ', 'SPX', 'NDX', 'VIX',
  'AAPL', 'AMD', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'SPCX', 'TSLA',
];

const SHARES = [
  'ASTS', 'AVGO', 'COIN', 'ETHA', 'FIG', 'GME', 'HOOD', 'IBIT', 'NFLX', 'NOK',
  'PLTR', 'QBTS', 'QUBT', 'RGTI', 'RIVN', 'SLV', 'SMCI', 'SOFI', 'SOUN', 'SOXL',
  'TQQQ', 'TSLL',
];

const SPREADS = [
  'ARM', 'BA', 'BABA', 'COST', 'CRCL', 'CRM', 'CRWD', 'CRWV', 'GS', 'HIMS',
  'INTC', 'IREN', 'IWM', 'LLY', 'MARA', 'MCD', 'MRNA', 'MU', 'NIO', 'NKE',
  'OKLO', 'OPEN', 'OXY', 'PDD', 'PFE', 'RIOT', 'RKLB', 'SMH', 'SNDK', 'TSM',
  'TTD', 'UNH', 'UPS', 'V',
];

// Option-volume leaders not already in MAIN/SHARES/SPREADS.
// Sourced from tastytrade "High Options Volume" public watchlist, 2026-07-28.
// Refresh: see scripts/refresh-optvol.js (or re-pull the watchlist by hand).
const OPTVOL = [
  // carried over from the previous RH-scan snapshot
  'ORCL', 'SKHY', 'MSTR', 'WBD', 'WULF', 'NBIS', 'MRVL', 'PYPL', 'BE', 'IBM',
  'BAC', 'ONDS', 'GOOG', 'NOW', 'QXO', 'SLS', 'BMNR', 'BTDR', 'FRMI', 'WEN',
  'CORZ', 'ADBE', 'PBR', 'CIFR', 'WMT', 'BB', 'IONQ',
  // ETFs carried over
  'TLT', 'HYG', 'FXI', 'DRAM', 'EWZ', 'EEM', 'XLF', 'GLD', 'LQD', 'EFA',
  'USO', 'XLE', 'GDX', 'KWEB', 'EWY', 'ARKK', 'IGV', 'SOXX', 'DIA',
  // --- new 2026-07-28: large-cap / liquid single names ---
  'WOLF', 'UBER', 'T', 'F', 'GLW', 'VZ', 'AAL', 'KO', 'CSX', 'CMCSA',
  'SNAP', 'FCX', 'JPM', 'AMAT', 'QCOM', 'JNJ', 'PATH', 'BSX', 'DIS', 'NU',
  'LRCX', 'SHOP', 'CLS', 'GM', 'XOM', 'CVNA', 'DELL', 'LVS', 'UNP', 'CCL',
  'ASML', 'CAT', 'HPQ', 'C', 'CVS', 'CVX', 'NVO', 'MMM', 'DKNG', 'DVN',
  'OWL', 'RTX',
  // --- new 2026-07-28: indices + sector/vol ETFs ---
  'XSP', 'RUT', 'XLC', 'XLY', 'XLV', 'SQQQ', 'SOXS', 'VXX', 'IEF', 'BNO',
];

// Full de-duped universe (order: MAIN → SHARES → SPREADS → OPTVOL).
const SCANNER_TICKERS = [...new Set([...MAIN, ...SHARES, ...SPREADS, ...OPTVOL])]
  .map((t) => String(t).trim().toUpperCase()).filter(Boolean);

// The hot/fast-lane subset.
const SCANNER_HOT = [...new Set(MAIN)].map((t) => String(t).trim().toUpperCase()).filter(Boolean);

module.exports = { SCANNER_TICKERS, SCANNER_HOT, MAIN, SHARES, SPREADS, OPTVOL };
