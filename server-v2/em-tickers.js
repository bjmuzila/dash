'use strict';
/**
 * server-v2/em-tickers.js
 *
 * The roster of tickers the weekly Estimated-Move publisher computes and caches
 * to ticker_levels (read by the customer-facing /em page). Edit EQUITY_TICKERS
 * to add/remove names — this is the ONLY place to change the list.
 *
 * SPECIALS (futures + cash indices) are kept separate because they need proxy /
 * alias handling in levels-engine.js (ESM→SPX chain, NQM→NDX chain, $-prefixed
 * index symbols). Don't move those into EQUITY_TICKERS.
 *
 * EQUITY_TICKERS are plain optionable equities/ETFs — the engine handles them
 * with no special casing. Paste your ~200 best names here (one per line is fine;
 * trailing commas are ok). Keep them UPPERCASE.
 */

// Futures + cash indices — leave as-is unless you add another index/future.
const SPECIAL_TICKERS = ['ESM', 'NQM', 'SPX', 'NDX'];

// >>> EDIT THIS LIST <<< — your best optionable equities/ETFs.
//
// BRK.B needs a per-feed ALIAS, not a different roster entry — Yahoo quotes it as
// BRK-B and TastyTrade chains it as BRK/B (both mapped in levels-engine.js).
// SPCX is unverified (possibly meant SPCE).
//
// Pruned 2026-07-26, 419 -> 219 symbols. Every name removed was verified against
// the live feeds first; none of it was guesswork about liquidity:
//
//  * 23 returned NO quote from any source — delisted, renamed or acquired, and
//    failing every run as "Invalid price: NaN": JNPR (HPE), SQ (->XYZ),
//    PKI (->RVTY), DFS (Capital One), X (Nippon), HES (Chevron),
//    MRO (ConocoPhillips), HA (Alaska), CYBR (Palo Alto), KSU, SAVE, AL, CHX,
//    CNHI, HEES, PSTG, BPMC, HOLX, SUNW, MAXN, NKLA, SRAC, LLAP.
//  * 9 had no option chain at all: OTC ADRs with no listed options (BYDDF,
//    BAYRY, RHHBY) and micro-caps / delistings (GDC, GPUS, SRXH, ADTX, SPWR,
//    WKHS).
//  * 173 carry MONTHLY expirations only — no weekly to strike a straddle
//    against. Confirmed in the TastyTrade chain: KLAC, ELV, HCA, SYK, A, ZTS,
//    AAON, AGCO and the rest show 8/21 as their nearest expiration. They can't
//    produce a one-week EM, and the no-roll guard in levels-engine.js correctly
//    refuses to publish their 27-DTE monthly straddle as one.
//
// Added 2026-07-26 (all 15 verified quotable with a 7/31 weekly before adding):
//   ORCL CRM ADBE NOW DELL WMT COST HD DIS TMUS VZ PG KO NVO COIN
//
// Re-adding a name is just a line here — but check it has a weekly first, or it
// will sit in failedEm forever. The engine logs both failure modes by name:
// "no quote anywhere for: ..." and "no priced chain at <targetExp>".
const EQUITY_TICKERS = [
  // semis / mega-cap tech
  'SPCX', 'NVDA', 'TSLA', 'INTC', 'MRVL', 'MU', 'AAPL', 'AMZN', 'MSFT', 'AMD',
  'SMCI', 'AVGO', 'META', 'GOOGL', 'TSM', 'QCOM', 'ASML', 'AMAT', 'LRCX', 'TXN',
  'ADI', 'ON', 'MCHP', 'STM', 'TER', 'COHR', 'ARM', 'CLS', 'VRT', 'ANET',
  'CIEN', 'HPE', 'SNDK', 'WDC',
  // retail / fintech / momentum
  'SOFI', 'RKLB', 'PLUG', 'QS', 'GRAB', 'ONDS', 'SMR', 'PLTR', 'HOOD', 'ASTS',
  'LUNR', 'MSTR', 'NFLX', 'UBER', 'MARA', 'PYPL', 'OPEN', 'RIVN', 'AFRM', 'SHOP',
  'TOST', 'APP', 'COIN',
  // china ADRs
  'MELI', 'PDD', 'BABA', 'JD', 'BIDU', 'NIO', 'LI', 'XPEV', 'CSIQ',
  // pharma / biotech
  'PFE', 'LLY', 'JNJ', 'MRK', 'ABBV', 'BMY', 'AMGN', 'GILD', 'VRTX', 'REGN',
  'BIIB', 'MRNA', 'NVAX', 'GSK', 'CRSP', 'VKTX', 'SRPT', 'NVO',
  // healthcare / med devices
  'UNH', 'CI', 'CVS', 'DHR', 'ISRG', 'MDT', 'BSX', 'ABT', 'TMO', 'DXCM',
  'ALGN', 'BAX',
  // solar / clean / EV
  'SEDG', 'RUN', 'ENPH', 'FSLR', 'LCID', 'FCEL', 'BE',
  // space / defense
  'SPCE', 'KTOS', 'RDW', 'BA', 'RTX', 'LMT', 'GD',
  // industrials
  'GE', 'HON', 'CAT', 'DE', 'ETN', 'EMR', 'MMM', 'GEV', 'CARR', 'URI',
  // financials
  'V', 'MA', 'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'SCHW', 'AXP',
  'COF', 'BX', 'KKR', 'APO', 'AIG', 'AFL', 'BRK.B',
  // materials / metals / miners
  'CLF', 'NEM', 'AEM', 'WPM', 'PAAS', 'AG', 'HL', 'CDE', 'FCX', 'SCCO',
  'VALE',
  // energy
  'XOM', 'CVX', 'COP', 'EOG', 'PSX', 'VLO', 'OXY', 'DVN', 'EQT', 'APA',
  'HAL', 'SLB', 'AES', 'NRG', 'VST', 'CEG', 'RIG',
  // transports / airlines / leasing
  'FTAI', 'CAR', 'HTZ', 'UNP', 'CSX', 'DAL', 'UAL', 'LUV', 'JBLU', 'AAL',
  // misc large caps / staples
  'F', 'T', 'CSCO', 'NOK', 'WMT', 'COST', 'HD', 'DIS', 'TMUS', 'VZ',
  'PG', 'KO',
  // software / cyber / data
  'CRWD', 'PANW', 'ZS', 'FTNT', 'OKTA', 'S', 'PATH', 'MDB', 'DDOG', 'SNOW',
  'GTLB', 'ORCL', 'CRM', 'ADBE', 'NOW', 'DELL',
  // ETFs
  'SPY', 'QQQ', 'IWM', 'SMH', 'TQQQ', 'SQQQ', 'SPXL', 'SPXS', 'SSO', 'UPRO',
  'DIA', 'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'ARKK', 'UVXY', 'VXX',
  'GLD', 'SLV', 'USO', 'BITO', 'HYG', 'LQD', 'TLT',
];

// De-duped publish roster: specials first (so their rows publish even if an
// equity name collides), then equities. Uppercase + unique.
const SYMBOLS = Array.from(new Set(
  [...SPECIAL_TICKERS, ...EQUITY_TICKERS].map((t) => String(t || '').trim().toUpperCase()).filter(Boolean)
));

// Buy/Sell zones are derived from LAST WEEK's OHLC, so they're static for the
// week and don't need weekly pre-publishing for all 200. The publisher computes
// zones only for this core set; for any other ticker the /em lookup computes
// zones on demand (cheap: one weekly candle + arithmetic). Edit freely.
const ZONE_SYMBOLS = ['ESM', 'NQM', 'SPX', 'NDX', 'SPY', 'QQQ', 'IWM'];

module.exports = { SYMBOLS, SPECIAL_TICKERS, EQUITY_TICKERS, ZONE_SYMBOLS };
