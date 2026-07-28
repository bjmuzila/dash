// ─────────────────────────────────────────────────────────────────────────────
// owner-vite/src/pages/watchlists/data.ts
//
// STATIC REFERENCE SNAPSHOT — deliberately not wired to any API.
// Captured 2026-07-28. These are copies for eyeballing, not a source of truth.
//
//   owner: "mine"       -> mirrors a file in server-v2/. If that file changes,
//                          this page goes stale and nothing will warn you.
//   owner: "tastytrade" -> exported from the tastytrade platform. Tastytrade
//                          rebuilds several of these daily.
//
// Two lists were transcribed from screenshots rather than a CSV export and are
// marked partial: the row list was cut off at the bottom of the capture. Export
// them as CSV from tastytrade to complete them.
// ─────────────────────────────────────────────────────────────────────────────

export type WatchGroup = {
  id: string;
  label: string;
  note: string;
  symbols: string[];
};

export type WatchList = {
  id: string;
  label: string;
  owner: "mine" | "tastytrade";
  source: string;
  blurb: string;
  groups: WatchGroup[];
};

export const SNAPSHOT_DATE = "2026-07-28";

export const WATCHLISTS: WatchList[] = [
  {
    id: "scanner",
    label: "Scanner Universe",
    owner: "mine",
    source: "server-v2/scanner-tickers.js",
    blurb:
      "Drives the /scanner tabs (GEX Scanner, Strike Query, GEX%), the oi-daily recorder and the strike-growth sweep. MAIN is the 2-minute hot lane; everything else sweeps every 5 minutes.",
    groups: [
      {
        id: "main",
        label: "MAIN",
        note: "Hot lane — 2-minute sweeps",
        symbols: [
          "SPY", "QQQ", "SPX", "NDX", "VIX", "AAPL", "AMD", "AMZN", "GOOGL", "META",
          "MSFT", "NVDA", "SPCX", "TSLA",
        ],
      },
      {
        id: "shares",
        label: "SHARES",
        note: "Single-name shares bucket",
        symbols: [
          "ASTS", "AVGO", "COIN", "ETHA", "FIG", "GME", "HOOD", "IBIT", "NFLX", "NOK",
          "PLTR", "QBTS", "QUBT", "RGTI", "RIVN", "SLV", "SMCI", "SOFI", "SOUN", "SOXL",
          "TQQQ", "TSLL",
        ],
      },
      {
        id: "spreads",
        label: "SPREADS",
        note: "Spread candidates",
        symbols: [
          "ARM", "BA", "BABA", "COST", "CRCL", "CRM", "CRWD", "CRWV", "GS", "HIMS",
          "INTC", "IREN", "IWM", "LLY", "MARA", "MCD", "MRNA", "MU", "NIO", "NKE",
          "OKLO", "OPEN", "OXY", "PDD", "PFE", "RIOT", "RKLB", "SMH", "SNDK", "TSM",
          "TTD", "UNH", "UPS", "V",
        ],
      },
      {
        id: "optvol",
        label: "OPTVOL",
        note: "Option-volume leaders, pruned against TT High Options Volume",
        symbols: [
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
        ],
      },
    ],
  },
  {
    id: "em",
    label: "EM Roster",
    owner: "mine",
    source: "server-v2/em-tickers.js",
    blurb:
      "Estimated-Moves roster behind the customer-facing /em levels page, and the flow tape while FLOW_TICKERS=EM. Pruned 419 -> 219 on 2026-07-26; names without a weekly expiration cannot produce a one-week EM.",
    groups: [
      {
        id: "special",
        label: "SPECIAL",
        note: "Futures + cash indices",
        symbols: [
          "ESM", "NQM", "SPX", "NDX",
        ],
      },
      {
        id: "equity",
        label: "EQUITY",
        note: "Optionable equities and ETFs",
        symbols: [
          "SPCX", "NVDA", "TSLA", "INTC", "MRVL", "MU", "AAPL", "AMZN", "MSFT", "AMD",
          "SMCI", "AVGO", "META", "GOOGL", "TSM", "QCOM", "ASML", "AMAT", "LRCX", "TXN",
          "ADI", "ON", "MCHP", "STM", "TER", "COHR", "ARM", "CLS", "VRT", "ANET",
          "CIEN", "HPE", "SNDK", "WDC", "SOFI", "RKLB", "PLUG", "QS", "GRAB", "ONDS",
          "SMR", "PLTR", "HOOD", "ASTS", "LUNR", "MSTR", "NFLX", "UBER", "MARA", "PYPL",
          "OPEN", "RIVN", "AFRM", "SHOP", "TOST", "APP", "COIN", "MELI", "PDD", "BABA",
          "JD", "BIDU", "NIO", "LI", "XPEV", "CSIQ", "PFE", "LLY", "JNJ", "MRK",
          "ABBV", "BMY", "AMGN", "GILD", "VRTX", "REGN", "BIIB", "MRNA", "NVAX", "GSK",
          "CRSP", "VKTX", "SRPT", "NVO", "UNH", "CI", "CVS", "DHR", "ISRG", "MDT",
          "BSX", "ABT", "TMO", "DXCM", "ALGN", "BAX", "SEDG", "RUN", "ENPH", "FSLR",
          "LCID", "FCEL", "BE", "SPCE", "KTOS", "RDW", "BA", "RTX", "LMT", "GD",
          "GE", "HON", "CAT", "DE", "ETN", "EMR", "MMM", "GEV", "CARR", "URI",
          "V", "MA", "JPM", "BAC", "WFC", "C", "GS", "MS", "SCHW", "AXP",
          "COF", "BX", "KKR", "APO", "AIG", "AFL", "BRK.B", "CLF", "NEM", "AEM",
          "WPM", "PAAS", "AG", "HL", "CDE", "FCX", "SCCO", "VALE", "XOM", "CVX",
          "COP", "EOG", "PSX", "VLO", "OXY", "DVN", "EQT", "APA", "HAL", "SLB",
          "AES", "NRG", "VST", "CEG", "RIG", "FTAI", "CAR", "HTZ", "UNP", "CSX",
          "DAL", "UAL", "LUV", "JBLU", "AAL", "F", "T", "CSCO", "NOK", "WMT",
          "COST", "HD", "DIS", "TMUS", "VZ", "PG", "KO", "CRWD", "PANW", "ZS",
          "FTNT", "OKTA", "S", "PATH", "MDB", "DDOG", "SNOW", "GTLB", "ORCL", "CRM",
          "ADBE", "NOW", "DELL", "SPY", "QQQ", "IWM", "SMH", "TQQQ", "SQQQ", "SPXL",
          "SPXS", "SSO", "UPRO", "DIA", "XLK", "XLF", "XLE", "XLV", "XLI", "XLY",
          "ARKK", "UVXY", "VXX", "GLD", "SLV", "USO", "BITO", "HYG", "LQD", "TLT",
        ],
      },
      {
        id: "zone",
        label: "ZONE",
        note: "Zone symbols",
        symbols: [
          "ESM", "NQM", "SPX", "NDX", "SPY", "QQQ", "IWM",
        ],
      },
    ],
  },
  {
    id: "farcb",
    label: "Far-CB Core",
    owner: "mine",
    source: "server-v2/far-cb-tickers.js",
    blurb:
      "CORE_TICKERS for the Far CB Watch scanner — flags names whose highest OI+Vol GEX strike within 30 days sits further than OTM_THRESHOLD_PCT from spot.",
    groups: [
      {
        id: "core",
        label: "CORE",
        note: "Far-CB core roster",
        symbols: [
          "SPX", "SPY", "QQQ", "NDX", "IWM", "RSP", "MAGS", "VIX", "TLT", "UVXY",
          "AAPL", "AMD", "AMZN", "GOOGL", "META", "MSFT", "NVDA", "SPCX", "TSLA", "AAPU",
          "ASTS", "AVGO", "BYND", "CMG", "COIN", "CWVX", "ETHA", "FBL", "FIG", "GME",
          "HIMZ", "HOOD", "IBIT", "LLYX", "MSFU", "NFLX", "NOK", "NVDX", "OSCR", "PLTR",
          "PONY", "QBTS", "QUBT", "RGTI", "RIVN", "SLV", "SMCI", "SOFI", "SOUN", "SOXL",
          "TQQQ", "TSLL", "UUUU", "ABNB", "AFRM", "ARM", "BA", "BABA", "CCJ", "CHWY",
          "COST", "CRCL", "CRM", "CRWD", "CRWV", "DJT", "FDX", "GS", "HIMS", "INTC",
          "IREN", "LAC", "LLY", "MA", "MARA", "MCD", "MRK", "MRNA", "MU", "NIO",
          "NKE", "NNE", "NXE", "OKLO", "OPEN", "OXY", "PDD", "PFE", "PTON", "RBLX",
          "RIOT", "RKLB", "ROKU", "SE", "SMH", "SNDK", "SNOW", "TGT", "TSM", "TTD",
          "U", "UNH", "UPS", "UPST", "V", "XPEV", "XYZ",
        ],
      },
    ],
  },
  {
    id: "tt-hov",
    label: "High Options Volume",
    owner: "tastytrade",
    source: "tastytrade · High Options Volume · CSV export",
    blurb:
      "The reference the scanner OPTVOL group is pruned against. Tastytrade rebuilds this daily, so treat it as point-in-time.",
    groups: [
      {
        id: "all",
        label: "HIGH OPTIONS VOLUME",
        note: "198 symbols as of 2026-07-28",
        symbols: [
          "SPY", "QQQ", "NVDA", "TSLA", "AAPL", "IWM", "INTC", "MSFT", "SPCX", "RIVN",
          "AMZN", "TLT", "WBD", "EEM", "ORCL", "PLTR", "IBIT", "SLV", "LQD", "NFLX",
          "HYG", "SOFI", "DRAM", "TQQQ", "XLF", "NOK", "MSTR", "IREN", "NOW", "XLE",
          "BMNR", "MARA", "PYPL", "UBER", "ETHA", "RUN", "SMCI", "BAC", "AMC", "TSLL",
          "HOOD", "T", "WULF", "FIG", "GME", "ONDS", "PFE", "FRMI", "F", "BABA",
          "WMT", "VZ", "AAL", "CORZ", "EWZ", "KO", "OPEN", "CMCSA", "GDX", "SNAP",
          "FCX", "RGTI", "SOUN", "CLF", "KEEL", "KWEB", "PATH", "TTD", "BSX", "PBR",
          "NIO", "NU", "EOSE", "POET", "NKE", "FXI", "JOBY", "BB", "RZLV", "IEF",
          "JBLU", "CCL", "SMR", "ACHR", "QUBT", "CLSK", "RIOT", "QS", "NVO", "LAES",
          "WEN", "DKNG", "PSKY", "VXX", "BBAI", "OXY", "DVN", "OWL", "TE", "SPX",
          "MU", "VIX", "SMH", "AMD", "GOOGL", "META", "USO", "SKHY", "WOLF", "GOOG",
          "IGV", "AVGO", "GLD", "TSM", "BE", "NBIS", "CRWV", "CIFR", "APLD", "MRVL",
          "NDX", "VG", "EFA", "RKLB", "HIMS", "IONQ", "QBTS", "CRM", "BA", "COIN",
          "CSX", "NVTS", "IBM", "ASTS", "JPM", "ARKK", "ADBE", "XLC", "QCOM", "JNJ",
          "CRCL", "NVDL", "DIS", "SQQQ", "SHOP", "QGEN", "OKLO", "GM", "XOM", "UPS",
          "SLS", "CVNA", "LVS", "DIA", "CRWD", "XLY", "PDD", "XLV", "MCD", "HPQ",
          "QXO", "UNH", "MRNA", "C", "CVS", "CVX", "MMM", "BTDR", "NN", "V",
          "SOXL", "SNDK", "EWY", "GLW", "SOXX", "SNXX", "AMAT", "CAPR", "COST", "LRCX",
          "SOXS", "CLS", "BNO", "GS", "DELL", "UNP", "ARM", "ECHO", "LLY", "ASML",
          "CAT", "REPL", "DBX", "AAOI", "RTX", "TSLR", "XSP", "RUT",
        ],
      },
    ],
  },
  {
    id: "tt-ndx",
    label: "NASDAQ 100",
    owner: "tastytrade",
    source: "tastytrade · NASDAQ 100 · CSV export",
    blurb:
      "Index constituents.",
    groups: [
      {
        id: "all",
        label: "NASDAQ 100",
        note: "103 symbols as of 2026-07-28",
        symbols: [
          "NFLX", "TSLA", "CMCSA", "PLTR", "MSFT", "MSTR", "KHC", "PYPL", "WBD", "AAPL",
          "AMZN", "INTC", "CPRT", "NVDA", "FAST", "EA", "WMT", "SPCX", "CSX", "SBUX",
          "AEP", "PEP", "XEL", "MU", "AMD", "MCHP", "CSCO", "ADBE", "NBIS", "EXC",
          "SHOP", "ORLY", "MDLZ", "MRVL", "AVGO", "RKLB", "QCOM", "GOOG", "PDD", "CRWV",
          "META", "MNST", "CRWD", "PAYX", "KDP", "GOOGL", "BKR", "DXCM", "CDNS", "TMUS",
          "ABNB", "FER", "CTAS", "HON", "CCEP", "ADP", "ASML", "PANW", "MAR", "APP",
          "WDAY", "COST", "LITE", "ODFL", "INTU", "DDOG", "LIN", "GEHC", "AMGN", "GILD",
          "ALNY", "ADI", "PCAR", "ROST", "TXN", "SNDK", "HONA", "TRI", "FANG", "TTWO",
          "KLAC", "ISRG", "BKNG", "CEG", "SNPS", "AMAT", "WDC", "ALAB", "ADSK", "ARM",
          "NXPI", "FTNT", "DASH", "LRCX", "STX", "AXON", "MELI", "TER", "IDXX", "MPWR",
          "REGN", "ROP", "VRTX",
        ],
      },
    ],
  },
  {
    id: "tt-spx",
    label: "S&P 500",
    owner: "tastytrade",
    source: "tastytrade · S&P 500 · CSV export",
    blurb:
      "Index constituents.",
    groups: [
      {
        id: "all",
        label: "S&P 500",
        note: "499 symbols as of 2026-07-28",
        symbols: [
          "PCG", "GIS", "CCL", "NFLX", "TSLA", "NOW", "T", "VICI", "EXE", "O",
          "CMCSA", "TECH", "PLTR", "MSFT", "AES", "KO", "TFC", "VTRS", "KHC", "PYPL",
          "TTD", "OXY", "WFC", "WBD", "CMG", "AAPL", "AMZN", "INTC", "CPRT", "UBER",
          "NVDA", "HOOD", "VZ", "NCLH", "F", "PFE", "PSKY", "FCX", "BAC", "DVN",
          "NKE", "KMI", "FAST", "EA", "ORCL", "WMT", "SLB", "SMCI", "BSX", "KIM",
          "MKC", "KVUE", "CRM", "CSGP", "TAP", "CSX", "SBUX", "AEP", "ABT", "ADM",
          "BX", "GM", "PEP", "CPB", "CTSH", "INVH", "XEL", "WY", "CLX", "HPQ",
          "SWKS", "MU", "KEY", "AMD", "EW", "MCHP", "APH", "CSCO", "ADBE", "LVS",
          "XYZ", "LYB", "BMY", "BA", "SYF", "HAS", "JCI", "FITB", "EXC", "DOW",
          "KR", "PG", "CVNA", "ORLY", "UDR", "DAL", "TSN", "PLD", "MET", "BF/B",
          "MS", "MOS", "NI", "MMM", "MDLZ", "AVGO", "CVX", "ZTS", "C", "SYY",
          "QCOM", "LUV", "MDT", "APA", "MRNA", "TGT", "HPE", "LULU", "CFG", "BLDR",
          "GOOG", "MCD", "TJX", "CVS", "COIN", "HAL", "PEG", "RF", "ES", "DOC",
          "META", "FOXA", "EIX", "NEE", "HBAN", "MNST", "DIS", "JPM", "TSCO", "SCHW",
          "CRWD", "DUK", "NEM", "VST", "V", "BAX", "PPL", "UPS", "HST", "USB",
          "OKE", "TROW", "PAYX", "MO", "KDP", "MRK", "XOM", "GOOGL", "BRK/B", "BKR",
          "D", "SO", "IBM", "HRL", "EQT", "UNH", "JNJ", "GPN", "WMB", "VRT",
          "CPT", "AIG", "DXCM", "MSI", "CDNS", "IQV", "SW", "PWR", "DGX", "AVB",
          "EXPE", "UNP", "VLO", "EL", "RCL", "CDW", "YUM", "GE", "GLW", "AXP",
          "SRE", "TKO", "BBY", "TMUS", "CF", "LEN", "ABNB", "ACGL", "CMS", "CRH",
          "LMT", "EXR", "STLD", "ARES", "VRSN", "BXP", "NTRS", "UHS", "DHI", "ROL",
          "SPG", "ECL", "DD", "KMB", "HCA", "CHD", "PSA", "LLY", "SNA", "MTB",
          "CHRW", "WRB", "TRMB", "CTAS", "MPC", "LDOS", "ETN", "HON", "FE", "EQR",
          "CI", "ON", "ANET", "SBAC", "WSM", "ZBH", "NUE", "SYK", "ADP", "ALLE",
          "COO", "EFX", "JBHT", "CMI", "ESS", "PANW", "DG", "VMC", "BALL", "AWK",
          "MAR", "EOG", "APP", "FTV", "AMT", "EVRG", "COHR", "DPZ", "CL", "WDAY",
          "BDX", "COST", "CBOE", "CAT", "DLTR", "BEN", "SJM", "COR", "AFL", "CINF",
          "GS", "RMD", "LITE", "ODFL", "TPR", "INTU", "IRM", "DDOG", "NOC", "ALL",
          "FSLR", "LIN", "MGM", "PNR", "IT", "STT", "NRG", "MSCI", "HIG", "TRGP",
          "GDDY", "PHM", "VEEV", "HD", "BIIB", "SHW", "GEHC", "KEYS", "DE", "EBAY",
          "ELV", "CB", "AMGN", "DRI", "GILD", "WYNN", "SWK", "HWM", "GNRC", "WM",
          "ADI", "PGR", "MA", "PCAR", "DHR", "UAL", "PODD", "KKR", "RSG", "AME",
          "ROST", "TXN", "BG", "ALB", "TRV", "COP", "ABBV", "SOLV", "ACN", "SNDK",
          "AOS", "WEC", "FDX", "RJF", "INCY", "HONA", "EXPD", "IFF", "GD", "FANG",
          "PM", "NTAP", "MAS", "BRO", "DTE", "IR", "TTWO", "AMCR", "OTIS", "TT",
          "WELL", "KLAC", "PNC", "AON", "GL", "FDS", "GEN", "ISRG", "ETR", "APTV",
          "CME", "APD", "IVZ", "ICE", "ROK", "STZ", "BKNG", "PTC", "HSY", "GPC",
          "CEG", "SNPS", "CNP", "GEV", "CARR", "NSC", "AMAT", "WDC", "CAH", "ZBRA",
          "COF", "ARE", "OMC", "BR", "A", "MAA", "CNC", "AJG", "MCO", "EMR",
          "DVA", "CCI", "ADSK", "IBKR", "TEL", "DELL", "AEE", "FRT", "POOL", "CBRE",
          "TXT", "FDXF", "NXPI", "VTR", "ITW", "LOW", "DECK", "RTX", "Q", "PPG",
          "FIS", "IP", "DLR", "APO", "PSX", "LYV", "FTNT", "CHTR", "DASH", "PRU",
          "NDAQ", "XYL", "VRSK", "CTVA", "AKAM", "HLT", "DOV", "ED", "LRCX", "TDY",
          "STX", "L", "FICO", "AXON", "TDG", "TPL", "BLK", "EG", "TER", "CPAY",
          "IDXX", "HII", "J", "AIZ", "NWS", "CASY", "NWSA", "GWW", "ATO", "MCK",
          "HUBB", "AZO", "PNW", "LH", "LHX", "ULTA", "ALGN", "HSIC", "PFG", "MPWR",
          "REGN", "SPGI", "LII", "FFIV", "CRL", "MLM", "JBL", "ROP", "TYL", "IEX",
          "URI", "PKG", "ERIE", "STE", "TMO", "PH", "WAT", "VRTX", "JKHY", "AMP",
          "AVY", "REG", "GRMN", "RVTY", "FIX", "HUM", "EME", "CIEN", "FOX", "WTW",
          "WAB", "WST", "EQIX", "VLTO", "LNT", "MTD", "NDSN", "RL", "NVR",
        ],
      },
    ],
  },
  {
    id: "tt-sox",
    label: "PHLX Semiconductor",
    owner: "tastytrade",
    source: "tastytrade · PHLX Semiconductor · CSV export",
    blurb:
      "Semiconductor index constituents.",
    groups: [
      {
        id: "all",
        label: "PHLX SEMICONDUCTOR",
        note: "30 symbols as of 2026-07-28",
        symbols: [
          "INTC", "NVDA", "TSM", "SWKS", "MU", "AMD", "MCHP", "GFS", "MRVL", "AVGO",
          "QCOM", "MTSI", "CRDO", "ON", "ASML", "QRVO", "COHR", "ENTG", "ADI", "TXN",
          "KLAC", "RMBS", "AMAT", "ALAB", "ARM", "NXPI", "LRCX", "TER", "NVMI", "MPWR",
        ],
      },
    ],
  },
  {
    id: "tt-letf",
    label: "Liquid ETFs",
    owner: "tastytrade",
    source: "tastytrade · Liquid ETFs · CSV export",
    blurb:
      "Tastytrade's liquid-ETF shortlist — the cleanest ETF universe they publish.",
    groups: [
      {
        id: "all",
        label: "LIQUID ETFS",
        note: "21 symbols as of 2026-07-28",
        symbols: [
          "EEM", "EWZ", "FXI", "GDX", "IWM", "QQQ", "SLV", "SPY", "TLT", "TQQQ",
          "VXX", "XLE", "XLU", "DIA", "GLD", "SMH", "USO", "UVXY", "EWW", "GDXJ",
          "XOP",
        ],
      },
    ],
  },
  {
    id: "tt-mktind",
    label: "Market Indicators",
    owner: "tastytrade",
    source: "tastytrade · Market Indicators · CSV export",
    blurb:
      "Breadth and internals feeds ($TICK, $TRIN, advance/decline, put/call, new highs/lows). Not tradeable instruments — data symbols.",
    groups: [
      {
        id: "all",
        label: "MARKET INDICATORS",
        note: "361 symbols as of 2026-07-28",
        symbols: [
          "$TOP11PGSP", "$ADVND", "$ADARDC", "$TIKND", "$HII3M", "$AMHGH", "$UNCN", "$HIND9M", "$ADVNC/Q", "$CPCE",
          "$VOLID", "$NYHGH", "$ADNDD", "$ADD", "$NAHI2W", "$DVOLC", "$TOP10L/Q", "$ADRLD", "$VOLNDDC", "$UNCHND",
          "$NALO2W", "$HII9M", "$UNCA", "$PCN", "$ETFHI6M", "$ADUSDC", "$NAHI3M", "$TRINSP", "$TRINA", "$ETFLO6M",
          "$NALO3M", "$VOLARDC", "$HISP6M", "$ETFHGH", "$TOP10VI", "$UVOL/Q", "$USHI1M", "$UVOLI", "$VOLSPD", "$PCA",
          "$TIKNDC", "$LOWRL", "$USLO1M", "$TIKRLC", "$NAHI9M", "$TOP25VOTC", "$HIRL2W", "$TOP10PG/Q", "$HIND1W", "$NALO9M",
          "$DVOLIC", "$ARHI1M", "$TRINI", "$ADRLDC", "$HIRL3M", "$DVOLRL", "$VOLUSDC", "$LOSP1M", "$ADUSD", "$ARLO1M",
          "$PCI", "$HII1W", "$DECAR", "$DECLSPC", "$DECLND", "$DVOA", "$TVOLC", "$AMHI6M", "$TICKAC", "$HIRL9M",
          "$TOP10PLUS", "$TRIN/Q", "$AMLO6M", "$NALOW", "$TVOLUS", "$UVOLND", "$TIKUSC", "$DECN/Q", "$TRIN", "$NAHI1W",
          "$VOLRLDC", "$NALO1W", "$LOND2W", "$DVOLSPC", "$NYHI2W", "$LOND3M", "$NYLO2W", "$NYHI3M", "$UNCAR", "$UNCNC/Q",
          "$NYLO3M", "$PCALL", "$HIRL1W", "$UVOAR", "$TRINND", "$LOND9M", "$USHI6M", "$ADQD", "$NYHI9M", "$HIND1M",
          "$ADVSPC", "$USLO6M", "$USLOW", "$NYLO9M", "$VOLAD", "$ADIDC", "$ADVN", "$DVOLUS", "$HII1M", "$HGHRL",
          "$ARHI6M", "$DVOLI", "$LOSP6M", "$TIKI", "$ARLO6M", "$TOP10PLSP", "$DECNC", "$ADVA", "$TRINARC", "$TOP10PGN",
          "$PCAR", "$TVOLSP", "$PCRL", "$DVOL", "$UNCN/Q", "$LORL2W", "$VOLADC", "$TVOLC/Q", "$TOP10GN", "$LOND1W",
          "$TICK/Q", "$DECARC", "$TICK", "$NAHI1M", "$NYHI1W", "$LORL3M", "$NALO1M", "$NYLO1W", "$SPXA100R", "$UVOARC",
          "$ADVI", "$TRINC/Q", "$TOP10GUS", "$ADVIC", "$LOI2W", "$ADVAR", "$DECAC", "$ADVRL", "$TIKIC", "$TIKRL",
          "$UNCHNDC", "$UNCHRLC", "$LORL9M", "$LOI3M", "$TOP10PGI", "$TVOLNDC", "$HIRL1M", "$VOLDC", "$NAHGH", "$TVOLRLC",
          "$UNCNC", "$TOP10PL/Q", "$TOP10VUS", "$TVOLI", "$LOWSP", "$TOP10GI", "$TVOL/Q", "$UNCHIC", "$UNCHRL", "$UVOLC/Q",
          "$ADSPD", "$VOLQDC", "$LOI9M", "$TRINNDC", "$TRINRLC", "$DVOLSP", "$HIND6M", "$ARLOW", "$ETFHI2W", "$DVOAR",
          "$UNCAC", "$VOLARD", "$LORL1W", "$UNCHUSC", "$ETFLO2W", "$TIKSPC", "$HII6M", "$HISP2W", "$ETFHI3M", "$TVOLUSC",
          "$UVOAC", "$UNCARC", "$TICKC", "$ETFLO3M", "$UVOLNDC", "$ADVN/Q", "$TVOA", "$SPXA200R", "$ADSPDC", "$HISP3M",
          "$UVOLRLC", "$LOND1M", "$CPCI", "$TOP10PLN", "$TICKARC", "$ADID", "$NYHI1M", "$TVOLND", "$USHGH", "$DECLIC",
          "$LOI1W", "$DECLRL", "$TOP10LN", "$NYLO1M", "$ETFHI9M", "$TRINUSC", "$NAHI6M", "$TOP10GSP", "$ETFLO9M", "$NALO6M",
          "$UVOLIC", "$HISP9M", "$UVOLRL", "$DVOL/Q", "$TICKC/Q", "$ADVUS", "$ADVNC", "$AMHI2W", "$TIKUS", "$TOP10VSP",
          "$VOLSPDC", "$AMLO2W", "$AMHI3M", "$TVOAR", "$UVOLUSC", "$TOP10PLI", "$HIRL6M", "$VOLNDD", "$LOWI", "$AMLO3M",
          "$VOLRLD", "$UNCHUS", "$TOP10LI", "$ETFHI1W", "$LOWND", "$PCN/Q", "$ADVAC", "$ETFLO1W", "$AMHI9M", "$HISP1W",
          "$TRINIC", "$TOP10G/Q", "$TRINAR", "$HGHSP", "$UNCHI", "$TRINRL", "$UVOA", "$AMLO9M", "$DVOLC/Q", "$LORL1M",
          "$DVOLND", "$DECLNDC", "$DECLRLC", "$PCSP", "$TOP10V/Q", "$ADVARC", "$USHI2W", "$AMLOW", "$VOLUSD", "$TVOL",
          "$ADADC", "$LOI1M", "$USLO2W", "$LOND6M", "$TOP10LUS", "$VOLQD", "$ARHGH", "$USHI3M", "$NYHI6M", "$NYLOW",
          "$DECLUS", "$USLO3M", "$DVOLNDC", "$AMHI1W", "$NYLO6M", "$DVOLRLC", "$ARHI2W", "$TICKA", "$TVOARC", "$ADVSP",
          "$DVOAC", "$AMLO1W", "$LOSP2W", "$TIKSP", "$UVOLC", "$ARLO2W", "$UVOLUS", "$ARHI3M", "$DECLUSC", "$USHI9M",
          "$ETFLOW", "$LOSP3M", "$ARLO3M", "$USLO9M", "$TOP10PGUS", "$TRINC", "$ADAD", "$UNCHSP", "$ARHI9M", "$ETFHI1M",
          "$DECN", "$LOSP9M", "$ADVNDC", "$ADQDC", "$ARLO9M", "$UNCHSPC", "$ETFLO1M", "$ADVRLC", "$SPXA50R", "$HISP1M",
          "$DVOLUSC", "$TVOLSPC", "$CPC", "$HGHI", "$DECA", "$TICKAR", "$TRINUS", "$USHI1W", "$UVOL", "$HGHND",
          "$ADARD", "$LORL6M", "$TVOAC", "$USLO1W", "$TRINSPC", "$VOLIDC", "$DVOARC", "$TOP10LSP", "$DECNC/Q", "$PCND",
          "$ARHI1W", "$DECLSP", "$HIND2W", "$LOSP1W", "$ARLO1W", "$LOI6M", "$DECLI", "$AMHI1M", "$ADVUSC", "$TRINAC",
          "$UVOLSP", "$ADNDDC", "$AMLO1M", "$HIND3M", "$ADDC", "$TVOLIC", "$HII2W", "$UVOLSPC", "$VOLD", "$TVOLRL",
          "$TOP10VN",
        ],
      },
    ],
  },
  {
    id: "tt-ai",
    label: "A.I. Stocks",
    owner: "tastytrade",
    source: "tastytrade · A.I. Stocks · screenshot",
    blurb:
      "AI-themed names. PARTIAL — transcribed from a screenshot whose row list was cut off; export the CSV to complete.",
    groups: [
      {
        id: "all",
        label: "A.I. STOCKS",
        note: "PARTIAL — screenshot capture, may be truncated",
        symbols: [
          "AAPL", "AI", "AMZN", "MSFT", "NVDA", "PLTR", "TSLA", "ADBE", "AMD", "AVGO",
          "CRM", "GOOGL", "IBM", "META", "MRVL", "MU", "ACN", "ANET", "EPAM", "TEAM",
          "SNOW",
        ],
      },
    ],
  },
  {
    id: "tt-lev",
    label: "Leveraged ETFs",
    owner: "tastytrade",
    source: "tastytrade · Leveraged ETFs · screenshot",
    blurb:
      "Leveraged and inverse ETFs. PARTIAL — transcribed from a screenshot whose row list was cut off; export the CSV to complete.",
    groups: [
      {
        id: "all",
        label: "LEVERAGED ETFS",
        note: "PARTIAL — screenshot capture, may be truncated",
        symbols: [
          "TSLL", "TQQQ", "SQQQ", "NVDL", "BITX", "SOXL", "SOXS", "TZA", "TNA", "SPXL",
          "UPRO", "QLD", "SSO", "TECL", "AGQ", "ETHU", "GGLL", "YINN", "NUGT",
        ],
      },
    ],
  },
  {
    id: "tt-vol",
    label: "Volatility Indexes",
    owner: "tastytrade",
    source: "tastytrade · Volatility Indexes · screenshot",
    blurb:
      "Cboe volatility indices. Appears complete in the capture.",
    groups: [
      {
        id: "all",
        label: "VOLATILITY INDEXES",
        note: "8 symbols, capture appears complete",
        symbols: [
          "VIX", "VXD", "VXN", "RVX", "OVX", "GVZ", "VXGS", "VIX1D",
        ],
      },
    ],
  },
];

/**
 * Every public watchlist tastytrade exposes at GET /public-watchlists.
 * The ones captured above are marked. To pull another:
 *   GET /public-watchlists/{name}   (URL-encode the spaces, "Bearer " + access_token)
 */
export const TT_PUBLIC_WATCHLISTS: string[] = [
  "52 Week Near High", "All Earnings", "Basic Materials",
  "CBOE Global Indices", "Crypto", "Dividend Aristocrats",
  "Futures: All", "High Options Volume", "Market Indicators",
  "52 Week Near Low", "Bitcoin ETFs", "Communication Services",
  "CRE Hospitality Price Return Index", "Dividend Champions", "Futures: CME",
  "tasty Earnings", "A.I. Stocks", "Consumer Defensive",
  "CRE Office Price Return Index", "Ethereum ETFs", "Futures: Micros",
  "Liquid Symbols", "Consumer Discretionary", "CRE Residential Price Return Index",
  "Crypto Futures", "Futures: With Options", "BAT's Watchlist",
  "CRE Retail Price Return Index", "Energy", "Dow Jones Industrial Average",
  "Financial Services", "Full Session Options", "Leveraged ETFs",
  "Healthcare", "ISE Homebuilders Index", "Market",
  "24 Hour Eligible Equities", "Industrials", "NASDAQ 100",
  "24 Hour Liquid ETFs", "Liquid ETFs", "NASDAQ-100 Target 25 Index",
  "Real Estate", "tasty default", "NASDAQ Golden Dragon China Index",
  "tasty Fast Movers", "Technology", "PHLX Gold/Silver Sector",
  "tasty Hourly Top Equities", "Utilities", "PHLX Housing Sector",
  "tasty IVR", "Tom's Watchlist", "PHLX Oil Service Sector",
  "PHLX Semiconductor", "Volatility Indexes", "PHLX Utility Sector",
  "Russell Microcap", "Russell Midcap", "Russell 1000",
  "S&P 100", "S&P 500",
];

/** Names in TT_PUBLIC_WATCHLISTS whose contents are captured in WATCHLISTS. */
export const TT_CAPTURED: string[] = [
  "High Options Volume", "NASDAQ 100", "S&P 500", "PHLX Semiconductor",
  "Liquid ETFs", "Market Indicators", "A.I. Stocks", "Leveraged ETFs",
  "Volatility Indexes",
];
