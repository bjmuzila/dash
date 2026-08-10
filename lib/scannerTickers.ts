// ─────────────────────────────────────────────────────────────────────────────
// lib/scannerTickers.ts — SINGLE FRONTEND SOURCE for the scanner ticker universe.
//
// WHY THIS FILE EXISTS
// Before 2026-07-28 this list was copy-pasted into three places that each drifted
// independently: components/shared/TickerListDropdown.tsx, app/options-chain/
// page.tsx, and app/api/premarket-movers/route.ts. When the server list changed,
// the pickers kept offering tickers that were no longer being swept — you'd pick
// one and silently get an empty chart. Everything client-side now imports here.
//
// THE REAL SOURCE OF TRUTH IS THE SERVER: server-v2/scanner-tickers.js as the
// baseline, PLUS the runtime `roster_overrides` layer in
// server-v2/roster-store.js (edited from the owner Watchlists page). Both are
// resolved behind GET /proxy/scanner-tickers. Prefer useScannerTickers() so the
// UI follows the server without a redeploy — a ticker added on the owner page
// appears in every picker on the next load, and never lands in these arrays.
//
// The static arrays below are a BUILD-TIME FALLBACK for SSR and for the endpoint
// being unreachable — they will go stale, and that is fine, because they are
// only ever a first paint.
//
// Mirrors the server-v2/scanner-tickers.js BASELINE @ 2026-08-10 (169 tickers).
// ─────────────────────────────────────────────────────────────────────────────
//
// NOTE: this module is intentionally FREE of React and of any "use client"
// directive, so server code (app/api/premarket-movers/route.ts) can import the
// constants. The client hook lives in lib/useScannerTickers.ts.
// ─────────────────────────────────────────────────────────────────────────────

// Fast/hot lane — indices + mega-caps (MAIN in the server file).
export const SCANNER_MAIN: string[] = [
  "SPY", "QQQ", "SPX", "NDX", "VIX", "AAPL", "AMD", "AMZN", "GOOGL", "META",
  "MSFT", "NVDA", "SPCX", "TSLA",
];

export const SCANNER_SHARES: string[] = [
  "ASTS", "AVGO", "COIN", "ETHA", "FIG", "GME", "HOOD", "IBIT", "NFLX", "NOK",
  "PLTR", "QBTS", "QUBT", "RBLX", "RGTI", "RIVN", "SLV", "SMCI", "SOFI", "SOUN",
  "SOXL", "TQQQ", "TSLL",
];

export const SCANNER_SPREADS: string[] = [
  "ARM", "BA", "BABA", "COST", "CRCL", "CRM", "CRWD", "CRWV", "GS", "HIMS",
  "INTC", "IREN", "IWM", "LLY", "MARA", "MCD", "MRNA", "MU", "NIO", "NKE",
  "OKLO", "OPEN", "OXY", "PDD", "PFE", "RIOT", "RKLB", "SMH", "SNDK", "TSM",
  "TTD", "UNH", "UPS", "V",
];

// Option-volume leaders, sourced from the tastytrade "High Options Volume"
// public watchlist. Refresh alongside the server file.
export const SCANNER_OPTVOL: string[] = [
  "ORCL", "SKHY", "MSTR", "WBD", "WULF", "NBIS", "MRVL", "PYPL", "BE", "IBM",
  "BAC", "ONDS", "GOOG", "NOW", "QXO", "SLS", "BMNR", "BTDR", "FRMI", "WEN",
  "CORZ", "ADBE", "PBR", "CIFR", "WMT", "BB", "IONQ", "TLT", "HYG", "FXI",
  "DRAM", "EWZ", "EEM", "XLF", "GLD", "LQD", "EFA", "USO", "XLE", "GDX",
  "KWEB", "EWY", "ARKK", "IGV", "SOXX", "DIA", "WOLF", "UBER", "T", "F",
  "GLW", "VZ", "AAL", "KO", "CSX", "CMCSA", "SNAP", "FCX", "JPM", "AMAT",
  "QCOM", "JNJ", "PATH", "BSX", "DIS", "NU", "LRCX", "SHOP", "CLS", "GM",
  "XOM", "CVNA", "DELL", "LVS", "UNP", "CCL", "ASML", "CAT", "HPQ", "C",
  "CVS", "CVX", "NVO", "MMM", "DKNG", "DVN", "OWL", "RTX", "XSP", "RUT",
  "XLC", "XLY", "XLV", "SQQQ", "SOXS", "VXX", "IEF", "BNO",
];

// Index roots — no shares trade, so they are excluded from movers-style scans.
export const INDEX_SYMBOLS: string[] = [
  "SPX", "NDX", "VIX", "RUT", "XSP",
];

// Funds — excluded from movers-style scans (they track, they don't move).
export const ETF_SYMBOLS: string[] = [
  "SPY", "QQQ", "IWM", "SMH", "SLV", "IBIT", "ETHA", "SOXL", "TQQQ", "TSLL",
  "SQQQ", "SOXS", "VXX", "IEF", "BNO", "TLT", "HYG", "FXI", "DRAM", "EWZ",
  "EEM", "XLF", "GLD", "LQD", "EFA", "USO", "XLE", "GDX", "KWEB", "EWY",
  "ARKK", "IGV", "SOXX", "DIA", "XLC", "XLY", "XLV", "SKHY",
];

/** Static fallback universe (169). Prefer useScannerTickers() at runtime. */
export const SCANNER_TICKERS: string[] = [
  ...new Set([...SCANNER_MAIN, ...SCANNER_SHARES, ...SCANNER_SPREADS, ...SCANNER_OPTVOL]),
].map((t) => t.trim().toUpperCase()).filter(Boolean);

const INDEX_SET = new Set(INDEX_SYMBOLS);
const ETF_SET = new Set(ETF_SYMBOLS);

/** Single names only — indices and funds stripped. Used by /api/premarket-movers. */
export const SCANNER_MOVERS: string[] = SCANNER_TICKERS.filter(
  (t) => !INDEX_SET.has(t) && !ETF_SET.has(t),
);
