/**
 * S&P 500 sector universe — the ~200 largest constituents by index weight,
 * mapped to GICS sector + industry, with an approximate market cap used ONLY
 * as the arc width in the sector sunburst.
 *
 * Why a static map: the broker quote feed (`/proxy/quotes`) returns prices, not
 * classifications. Sector/industry changes are a handful of names a year, so a
 * checked-in map is cheaper and more predictable than a second data provider.
 *
 * `capB` is approximate market cap in $B. It drives arc width only — never a
 * displayed number — so it does not need to be exact, but keep it in the right
 * order of magnitude or the wheel's proportions drift.
 *
 * GICS note: since the 2023 reclassification, payment processors (V, MA, AXP,
 * PYPL, FI, GPN) are Financials, and the retail staples (WMT, COST, TGT, KR,
 * DG) are Consumer Staples. This map follows that.
 */

export interface UniverseName {
  /** Ticker as the quote feed expects it. */
  t: string;
  /** GICS sector. */
  s: string;
  /** Industry bucket — the sunburst's middle ring. */
  i: string;
  /** Approximate market cap, $B. Arc width only. */
  capB: number;
}

export const SPX_UNIVERSE: UniverseName[] = [
  // ── Information Technology ─────────────────────────────────────────────────
  { t: "NVDA", s: "Information Technology", i: "Semiconductors", capB: 4200 },
  { t: "AVGO", s: "Information Technology", i: "Semiconductors", capB: 1400 },
  { t: "AMD",  s: "Information Technology", i: "Semiconductors", capB: 400 },
  { t: "QCOM", s: "Information Technology", i: "Semiconductors", capB: 180 },
  { t: "TXN",  s: "Information Technology", i: "Semiconductors", capB: 170 },
  { t: "MU",   s: "Information Technology", i: "Semiconductors", capB: 160 },
  { t: "ADI",  s: "Information Technology", i: "Semiconductors", capB: 120 },
  { t: "INTC", s: "Information Technology", i: "Semiconductors", capB: 110 },
  { t: "NXPI", s: "Information Technology", i: "Semiconductors", capB: 55 },
  { t: "AMAT", s: "Information Technology", i: "Semiconductor Equipment", capB: 180 },
  { t: "LRCX", s: "Information Technology", i: "Semiconductor Equipment", capB: 130 },
  { t: "KLAC", s: "Information Technology", i: "Semiconductor Equipment", capB: 110 },
  { t: "MSFT", s: "Information Technology", i: "Software", capB: 3700 },
  { t: "ORCL", s: "Information Technology", i: "Software", capB: 600 },
  { t: "CRM",  s: "Information Technology", i: "Software", capB: 250 },
  { t: "NOW",  s: "Information Technology", i: "Software", capB: 220 },
  { t: "INTU", s: "Information Technology", i: "Software", capB: 200 },
  { t: "ADBE", s: "Information Technology", i: "Software", capB: 180 },
  { t: "PANW", s: "Information Technology", i: "Software", capB: 130 },
  { t: "CRWD", s: "Information Technology", i: "Software", capB: 110 },
  { t: "SNPS", s: "Information Technology", i: "Software", capB: 80 },
  { t: "CDNS", s: "Information Technology", i: "Software", capB: 80 },
  { t: "FTNT", s: "Information Technology", i: "Software", capB: 75 },
  { t: "ADSK", s: "Information Technology", i: "Software", capB: 60 },
  { t: "ROP",  s: "Information Technology", i: "Software", capB: 55 },
  { t: "AAPL", s: "Information Technology", i: "Hardware & Devices", capB: 3400 },
  { t: "DELL", s: "Information Technology", i: "Hardware & Devices", capB: 70 },
  { t: "CSCO", s: "Information Technology", i: "Networking & Components", capB: 270 },
  { t: "ANET", s: "Information Technology", i: "Networking & Components", capB: 170 },
  { t: "APH",  s: "Information Technology", i: "Networking & Components", capB: 160 },
  { t: "GLW",  s: "Information Technology", i: "Networking & Components", capB: 60 },
  { t: "TEL",  s: "Information Technology", i: "Networking & Components", capB: 45 },
  { t: "IBM",  s: "Information Technology", i: "IT Services", capB: 280 },
  { t: "ACN",  s: "Information Technology", i: "IT Services", capB: 200 },

  // ── Communication Services ─────────────────────────────────────────────────
  { t: "GOOGL", s: "Communication Services", i: "Interactive Media", capB: 2400 },
  { t: "META",  s: "Communication Services", i: "Interactive Media", capB: 1600 },
  { t: "NFLX",  s: "Communication Services", i: "Entertainment", capB: 500 },
  { t: "DIS",   s: "Communication Services", i: "Entertainment", capB: 200 },
  { t: "TMUS",  s: "Communication Services", i: "Telecom", capB: 280 },
  { t: "VZ",    s: "Communication Services", i: "Telecom", capB: 200 },
  { t: "T",     s: "Communication Services", i: "Telecom", capB: 170 },
  { t: "CMCSA", s: "Communication Services", i: "Cable & Media", capB: 130 },
  { t: "CHTR",  s: "Communication Services", i: "Cable & Media", capB: 45 },

  // ── Consumer Discretionary ─────────────────────────────────────────────────
  { t: "AMZN", s: "Consumer Discretionary", i: "Internet Retail", capB: 2300 },
  { t: "BKNG", s: "Consumer Discretionary", i: "Internet Retail", capB: 180 },
  { t: "DASH", s: "Consumer Discretionary", i: "Internet Retail", capB: 90 },
  { t: "ABNB", s: "Consumer Discretionary", i: "Internet Retail", capB: 80 },
  { t: "TSLA", s: "Consumer Discretionary", i: "Automotive", capB: 900 },
  { t: "GM",   s: "Consumer Discretionary", i: "Automotive", capB: 60 },
  { t: "F",    s: "Consumer Discretionary", i: "Automotive", capB: 45 },
  { t: "HD",   s: "Consumer Discretionary", i: "Specialty Retail", capB: 380 },
  { t: "TJX",  s: "Consumer Discretionary", i: "Specialty Retail", capB: 140 },
  { t: "LOW",  s: "Consumer Discretionary", i: "Specialty Retail", capB: 130 },
  { t: "ORLY", s: "Consumer Discretionary", i: "Specialty Retail", capB: 70 },
  { t: "AZO",  s: "Consumer Discretionary", i: "Specialty Retail", capB: 55 },
  { t: "ROST", s: "Consumer Discretionary", i: "Specialty Retail", capB: 45 },
  { t: "NKE",  s: "Consumer Discretionary", i: "Apparel & Leisure", capB: 100 },
  { t: "MCD",  s: "Consumer Discretionary", i: "Restaurants", capB: 220 },
  { t: "SBUX", s: "Consumer Discretionary", i: "Restaurants", capB: 110 },
  { t: "CMG",  s: "Consumer Discretionary", i: "Restaurants", capB: 70 },
  { t: "MAR",  s: "Consumer Discretionary", i: "Hotels & Cruise", capB: 80 },
  { t: "HLT",  s: "Consumer Discretionary", i: "Hotels & Cruise", capB: 70 },
  { t: "RCL",  s: "Consumer Discretionary", i: "Hotels & Cruise", capB: 60 },

  // ── Consumer Staples ───────────────────────────────────────────────────────
  { t: "WMT",  s: "Consumer Staples", i: "Staples Retail", capB: 750 },
  { t: "COST", s: "Consumer Staples", i: "Staples Retail", capB: 400 },
  { t: "TGT",  s: "Consumer Staples", i: "Staples Retail", capB: 50 },
  { t: "KR",   s: "Consumer Staples", i: "Staples Retail", capB: 45 },
  { t: "PG",   s: "Consumer Staples", i: "Household & Personal", capB: 390 },
  { t: "CL",   s: "Consumer Staples", i: "Household & Personal", capB: 70 },
  { t: "KMB",  s: "Consumer Staples", i: "Household & Personal", capB: 45 },
  { t: "KO",   s: "Consumer Staples", i: "Beverages", capB: 310 },
  { t: "PEP",  s: "Consumer Staples", i: "Beverages", capB: 200 },
  { t: "MNST", s: "Consumer Staples", i: "Beverages", capB: 55 },
  { t: "KDP",  s: "Consumer Staples", i: "Beverages", capB: 45 },
  { t: "MDLZ", s: "Consumer Staples", i: "Food Products", capB: 90 },
  { t: "PM",   s: "Consumer Staples", i: "Tobacco", capB: 250 },
  { t: "MO",   s: "Consumer Staples", i: "Tobacco", capB: 100 },

  // ── Health Care ────────────────────────────────────────────────────────────
  { t: "LLY",  s: "Health Care", i: "Pharmaceuticals", capB: 800 },
  { t: "JNJ",  s: "Health Care", i: "Pharmaceuticals", capB: 400 },
  { t: "ABBV", s: "Health Care", i: "Pharmaceuticals", capB: 340 },
  { t: "MRK",  s: "Health Care", i: "Pharmaceuticals", capB: 220 },
  { t: "PFE",  s: "Health Care", i: "Pharmaceuticals", capB: 150 },
  { t: "BMY",  s: "Health Care", i: "Pharmaceuticals", capB: 110 },
  { t: "ZTS",  s: "Health Care", i: "Pharmaceuticals", capB: 60 },
  { t: "AMGN", s: "Health Care", i: "Biotech", capB: 160 },
  { t: "GILD", s: "Health Care", i: "Biotech", capB: 130 },
  { t: "VRTX", s: "Health Care", i: "Biotech", capB: 120 },
  { t: "REGN", s: "Health Care", i: "Biotech", capB: 60 },
  { t: "ABT",  s: "Health Care", i: "Medical Devices", capB: 220 },
  { t: "TMO",  s: "Health Care", i: "Life Science Tools", capB: 200 },
  { t: "ISRG", s: "Health Care", i: "Medical Devices", capB: 190 },
  { t: "DHR",  s: "Health Care", i: "Life Science Tools", capB: 160 },
  { t: "SYK",  s: "Health Care", i: "Medical Devices", capB: 140 },
  { t: "BSX",  s: "Health Care", i: "Medical Devices", capB: 140 },
  { t: "MDT",  s: "Health Care", i: "Medical Devices", capB: 120 },
  { t: "BDX",  s: "Health Care", i: "Medical Devices", capB: 60 },
  { t: "UNH",  s: "Health Care", i: "Managed Care", capB: 280 },
  { t: "CI",   s: "Health Care", i: "Managed Care", capB: 80 },
  { t: "ELV",  s: "Health Care", i: "Managed Care", capB: 70 },
  { t: "HCA",  s: "Health Care", i: "Providers & Distribution", capB: 90 },
  { t: "MCK",  s: "Health Care", i: "Providers & Distribution", capB: 90 },
  { t: "CVS",  s: "Health Care", i: "Providers & Distribution", capB: 90 },
  { t: "COR",  s: "Health Care", i: "Providers & Distribution", capB: 60 },

  // ── Financials ─────────────────────────────────────────────────────────────
  { t: "BRK.B", s: "Financials", i: "Diversified Holdings", capB: 1100 },
  { t: "JPM",  s: "Financials", i: "Banks", capB: 800 },
  { t: "BAC",  s: "Financials", i: "Banks", capB: 350 },
  { t: "WFC",  s: "Financials", i: "Banks", capB: 250 },
  { t: "C",    s: "Financials", i: "Banks", capB: 160 },
  { t: "USB",  s: "Financials", i: "Banks", capB: 80 },
  { t: "PNC",  s: "Financials", i: "Banks", capB: 70 },
  { t: "TFC",  s: "Financials", i: "Banks", capB: 60 },
  { t: "V",    s: "Financials", i: "Payments", capB: 650 },
  { t: "MA",   s: "Financials", i: "Payments", capB: 520 },
  { t: "AXP",  s: "Financials", i: "Payments", capB: 220 },
  { t: "COIN", s: "Financials", i: "Payments", capB: 90 },
  { t: "PYPL", s: "Financials", i: "Payments", capB: 80 },
  { t: "FI",   s: "Financials", i: "Payments", capB: 80 },
  { t: "MS",   s: "Financials", i: "Capital Markets", capB: 230 },
  { t: "BX",   s: "Financials", i: "Capital Markets", capB: 200 },
  { t: "GS",   s: "Financials", i: "Capital Markets", capB: 190 },
  { t: "SCHW", s: "Financials", i: "Capital Markets", capB: 170 },
  { t: "BLK",  s: "Financials", i: "Capital Markets", capB: 160 },
  { t: "SPGI", s: "Financials", i: "Capital Markets", capB: 160 },
  { t: "KKR",  s: "Financials", i: "Capital Markets", capB: 120 },
  { t: "ICE",  s: "Financials", i: "Capital Markets", capB: 100 },
  { t: "CME",  s: "Financials", i: "Capital Markets", capB: 90 },
  { t: "MCO",  s: "Financials", i: "Capital Markets", capB: 80 },
  { t: "APO",  s: "Financials", i: "Capital Markets", capB: 80 },
  { t: "ARES", s: "Financials", i: "Capital Markets", capB: 60 },
  { t: "PGR",  s: "Financials", i: "Insurance", capB: 140 },
  { t: "CB",   s: "Financials", i: "Insurance", capB: 110 },
  { t: "MMC",  s: "Financials", i: "Insurance", capB: 105 },
  { t: "AON",  s: "Financials", i: "Insurance", capB: 75 },
  { t: "AJG",  s: "Financials", i: "Insurance", capB: 65 },
  { t: "AFL",  s: "Financials", i: "Insurance", capB: 60 },
  { t: "TRV",  s: "Financials", i: "Insurance", capB: 55 },
  { t: "ALL",  s: "Financials", i: "Insurance", capB: 55 },

  // ── Industrials ────────────────────────────────────────────────────────────
  { t: "GE",   s: "Industrials", i: "Aerospace & Defense", capB: 290 },
  { t: "RTX",  s: "Industrials", i: "Aerospace & Defense", capB: 180 },
  { t: "BA",   s: "Industrials", i: "Aerospace & Defense", capB: 130 },
  { t: "LMT",  s: "Industrials", i: "Aerospace & Defense", capB: 100 },
  { t: "GD",   s: "Industrials", i: "Aerospace & Defense", capB: 90 },
  { t: "TDG",  s: "Industrials", i: "Aerospace & Defense", capB: 80 },
  { t: "NOC",  s: "Industrials", i: "Aerospace & Defense", capB: 70 },
  { t: "HWM",  s: "Industrials", i: "Aerospace & Defense", capB: 60 },
  { t: "AXON", s: "Industrials", i: "Aerospace & Defense", capB: 50 },
  { t: "CAT",  s: "Industrials", i: "Machinery", capB: 180 },
  { t: "HON",  s: "Industrials", i: "Machinery", capB: 140 },
  { t: "ETN",  s: "Industrials", i: "Machinery", capB: 130 },
  { t: "DE",   s: "Industrials", i: "Machinery", capB: 120 },
  { t: "MMM",  s: "Industrials", i: "Machinery", capB: 90 },
  { t: "PH",   s: "Industrials", i: "Machinery", capB: 80 },
  { t: "ITW",  s: "Industrials", i: "Machinery", capB: 75 },
  { t: "EMR",  s: "Industrials", i: "Machinery", capB: 60 },
  { t: "PCAR", s: "Industrials", i: "Machinery", capB: 55 },
  { t: "UNP",  s: "Industrials", i: "Transportation", capB: 130 },
  { t: "UPS",  s: "Industrials", i: "Transportation", capB: 80 },
  { t: "CSX",  s: "Industrials", i: "Transportation", capB: 70 },
  { t: "FDX",  s: "Industrials", i: "Transportation", capB: 60 },
  { t: "NSC",  s: "Industrials", i: "Transportation", capB: 55 },
  { t: "ADP",  s: "Industrials", i: "Commercial Services", capB: 120 },
  { t: "WM",   s: "Industrials", i: "Commercial Services", capB: 90 },
  { t: "CTAS", s: "Industrials", i: "Commercial Services", capB: 80 },
  { t: "RSG",  s: "Industrials", i: "Commercial Services", capB: 65 },
  { t: "PWR",  s: "Industrials", i: "Commercial Services", capB: 60 },
  { t: "GWW",  s: "Industrials", i: "Commercial Services", capB: 55 },
  { t: "URI",  s: "Industrials", i: "Commercial Services", capB: 55 },
  { t: "CPRT", s: "Industrials", i: "Commercial Services", capB: 50 },

  // ── Energy ─────────────────────────────────────────────────────────────────
  { t: "XOM",  s: "Energy", i: "Integrated Oil", capB: 550 },
  { t: "CVX",  s: "Energy", i: "Integrated Oil", capB: 290 },
  { t: "COP",  s: "Energy", i: "Exploration & Production", capB: 130 },
  { t: "EOG",  s: "Energy", i: "Exploration & Production", capB: 70 },
  { t: "WMB",  s: "Energy", i: "Midstream", capB: 70 },
  { t: "KMI",  s: "Energy", i: "Midstream", capB: 60 },
  { t: "OKE",  s: "Energy", i: "Midstream", capB: 60 },
  { t: "SLB",  s: "Energy", i: "Refining & Services", capB: 60 },
  { t: "MPC",  s: "Energy", i: "Refining & Services", capB: 55 },
  { t: "PSX",  s: "Energy", i: "Refining & Services", capB: 50 },

  // ── Utilities ──────────────────────────────────────────────────────────────
  { t: "NEE",  s: "Utilities", i: "Electric Utilities", capB: 160 },
  { t: "SO",   s: "Utilities", i: "Electric Utilities", capB: 110 },
  { t: "DUK",  s: "Utilities", i: "Electric Utilities", capB: 95 },
  { t: "CEG",  s: "Utilities", i: "Independent Power", capB: 90 },
  { t: "AEP",  s: "Utilities", i: "Electric Utilities", capB: 60 },
  { t: "VST",  s: "Utilities", i: "Independent Power", capB: 60 },
  { t: "SRE",  s: "Utilities", i: "Multi-Utilities", capB: 55 },
  { t: "D",    s: "Utilities", i: "Multi-Utilities", capB: 50 },

  // ── Real Estate ────────────────────────────────────────────────────────────
  { t: "PLD",  s: "Real Estate", i: "Industrial & Retail REITs", capB: 110 },
  { t: "AMT",  s: "Real Estate", i: "Infrastructure REITs", capB: 100 },
  { t: "WELL", s: "Real Estate", i: "Health & Residential REITs", capB: 90 },
  { t: "EQIX", s: "Real Estate", i: "Infrastructure REITs", capB: 80 },
  { t: "SPG",  s: "Real Estate", i: "Industrial & Retail REITs", capB: 60 },
  { t: "DLR",  s: "Real Estate", i: "Infrastructure REITs", capB: 60 },
  { t: "PSA",  s: "Real Estate", i: "Health & Residential REITs", capB: 55 },
  { t: "O",    s: "Real Estate", i: "Industrial & Retail REITs", capB: 50 },

  // ── Materials ──────────────────────────────────────────────────────────────
  { t: "LIN",  s: "Materials", i: "Industrial Gases", capB: 220 },
  { t: "APD",  s: "Materials", i: "Industrial Gases", capB: 80 },
  { t: "SHW",  s: "Materials", i: "Specialty Chemicals", capB: 90 },
  { t: "ECL",  s: "Materials", i: "Specialty Chemicals", capB: 70 },
  { t: "FCX",  s: "Materials", i: "Metals & Mining", capB: 70 },
  { t: "NEM",  s: "Materials", i: "Metals & Mining", capB: 60 },
];

/** Every ticker the sunburst needs a quote for. */
export const SPX_UNIVERSE_SYMBOLS: string[] = SPX_UNIVERSE.map((u) => u.t);

/** Ticker → classification, for joining quotes back to sectors. */
export const SPX_UNIVERSE_BY_TICKER: Record<string, UniverseName> =
  Object.fromEntries(SPX_UNIVERSE.map((u) => [u.t, u]));
