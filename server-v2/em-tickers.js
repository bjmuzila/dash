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
// NOTE: BRK.B may need to be BRK-B/BRK/B depending on the feed; SPCX is unverified
// (possibly meant SPCE). Any name that can't price just won't get a row.
const EQUITY_TICKERS = [
  // semis / mega-cap tech
  'SPCX', 'NVDA', 'TSLA', 'INTC', 'MRVL', 'MU', 'AAPL', 'AMZN', 'MSFT', 'AMD',
  'SMCI', 'AVGO', 'META', 'GOOGL', 'TSM', 'QCOM', 'ASML', 'AMAT', 'LRCX', 'KLAC',
  'TXN', 'ADI', 'NXPI', 'MPWR', 'ON', 'SWKS', 'QRVO', 'MCHP', 'STM', 'CRUS',
  'SLAB', 'MTSI', 'POWI', 'DIOD', 'SMTC', 'VSH', 'FORM', 'ACLS', 'UCTT', 'ENTG',
  'TER', 'AEIS', 'COHR', 'VECO', 'CAMT', 'NVMI', 'ONTO', 'PLAB', 'XPER', 'AMKR',
  'FLEX', 'ARM', 'CLS', 'VRT', 'ANET', 'CIEN', 'JNPR', 'HPE', 'NTAP', 'PSTG', 'SNDK', 'WDC',
  // retail / fintech / momentum
  'SOFI', 'RKLB', 'AMC', 'PLUG', 'QS', 'GRAB', 'ONDS', 'SMR', 'BFLY', 'PLTR',
  'HOOD', 'ASTS', 'LUNR', 'MSTR', 'NFLX', 'UBER', 'MARA', 'PYPL', 'OPEN', 'RIVN',
  'GDC', 'GPUS', 'SRXH', 'ADTX', 'MARA', 'AFRM', 'SQ', 'SHOP', 'TOST', 'APP',
  // china ADRs
  'MELI', 'PDD', 'BABA', 'JD', 'TCOM', 'BIDU', 'YMM', 'NIO', 'LI', 'XPEV', 'BYDDF', 'DQ', 'JKS', 'CSIQ',
  // pharma / biotech
  'PFE', 'LLY', 'JNJ', 'MRK', 'ABBV', 'BMY', 'AMGN', 'GILD', 'VRTX', 'REGN',
  'BIIB', 'MRNA', 'BNTX', 'NVAX', 'AZN', 'SNY', 'GSK', 'NVS', 'BAYRY', 'RHHBY',
  'ROG', 'INCY', 'EXEL', 'BPMC', 'CRSP', 'EDIT', 'NTLA', 'BEAM', 'RCKT', 'VKTX',
  'MDGL', 'CYTK', 'SRPT', 'PTCT', 'UTHR', 'INSM', 'HALO', 'AMRN', 'HRTX', 'ACAD',
  'NBIX', 'ALNY',
  // healthcare / med devices
  'UNH', 'CI', 'ELV', 'CVS', 'HCA', 'DHR', 'ISRG', 'SYK', 'MDT', 'BSX', 'ABT',
  'TMO', 'IQV', 'VEEV', 'DXCM', 'PODD', 'RMD', 'EW', 'ZTS', 'IDXX', 'MTD', 'WAT',
  'A', 'ILMN', 'TECH', 'CRL', 'BIO', 'HOLX', 'XRAY', 'ALGN', 'COO', 'BAX', 'BDX',
  'STE', 'WST', 'RVTY', 'DGX', 'LH', 'PKI', 'TFX',
  // solar / clean / EV
  'SEDG', 'RUN', 'ENPH', 'FSLR', 'SPWR', 'SUNW', 'MAXN', 'LCID', 'WKHS', 'NKLA',
  'HYLN', 'BLNK', 'EVGO', 'CHPT', 'FCEL', 'BEEM', 'BE',
  // space / defense
  'SPCE', 'KTOS', 'SPIR', 'SRAC', 'RDW', 'BKSY', 'MNTS', 'LLAP', 'BA', 'RTX',
  'LMT', 'NOC', 'GD', 'HII', 'TXT', 'TDG',
  // industrials
  'GE', 'HON', 'CAT', 'DE', 'PCAR', 'CMI', 'ETN', 'ITW', 'PH', 'EMR', 'MMM',
  'GEV', 'JCI', 'TT', 'CARR', 'OTIS', 'PWR', 'EME', 'FIX', 'APG', 'ACM', 'FLR',
  'J', 'KBR', 'TTEK', 'WMS', 'TREX', 'AAON', 'AZZ', 'BLDR', 'EXP', 'WAB', 'TRN',
  'GBX', 'FSS', 'OSK', 'TEX', 'ALG', 'AGCO', 'CNHI', 'URI', 'HRI', 'HEES',
  // financials
  'V', 'MA', 'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'SCHW', 'AXP', 'COF', 'DFS',
  'SYF', 'ALLY', 'BX', 'KKR', 'APO', 'CG', 'AIG', 'PRU', 'MET', 'AFL', 'LNC',
  'UNM', 'CNO', 'BRK.B',
  // materials / metals / miners
  'MLM', 'VMC', 'CX', 'X', 'NUE', 'STLD', 'CLF', 'RS', 'CMC', 'ATI', 'CRS',
  'WOR', 'GGB', 'SID', 'NEM', 'GOLD', 'AEM', 'FNV', 'WPM', 'RGLD', 'PAAS', 'AG',
  'HL', 'CDE', 'FCX', 'SCCO', 'BHP', 'RIO', 'VALE',
  // energy
  'XOM', 'CVX', 'COP', 'EOG', 'MPC', 'PSX', 'VLO', 'HES', 'OXY', 'FANG', 'DVN',
  'EQT', 'MRO', 'APA', 'HAL', 'SLB', 'BKR', 'FTI', 'CHX', 'NOV', 'HP', 'PTEN',
  'OII', 'WHD', 'NBR', 'AES', 'NRG', 'VST', 'CEG', 'RIG',
  // transports / airlines / leasing
  'FTAI', 'AER', 'AL', 'CAR', 'HTZ', 'R', 'JBHT', 'NSC', 'UNP', 'CSX', 'KSU',
  'DAL', 'UAL', 'LUV', 'SAVE', 'JBLU', 'ALK', 'HA', 'SKYW', 'AAL',
  // misc large caps / staples
  'F', 'T', 'CSCO', 'NOK',
  // software / cyber / data
  'CRWD', 'PANW', 'ZS', 'FTNT', 'OKTA', 'CYBR', 'S', 'PATH', 'MDB', 'DDOG',
  'SNOW', 'HUBS', 'ESTC', 'GTLB',
  // ETFs
  'SPY', 'QQQ', 'IWM', 'SMH', 'TQQQ', 'SQQQ', 'SPXL', 'SPXS', 'QLD', 'SSO',
  'UPRO', 'DIA', 'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'ARKK', 'UVXY', 'VXX',
  'GLD', 'SLV', 'USO', 'BITO', 'HYG', 'LQD', 'TLT', 'BND',
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
