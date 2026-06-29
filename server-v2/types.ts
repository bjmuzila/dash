// server-v2/types.ts
// Shared type definitions for the from-scratch SPX GEX proxy pipeline.
// Documentation/IDE types only — runtime modules are CommonJS .js and do not
// import this at runtime.

export type OptionType = 'C' | 'P';

/** A single option contract identity parsed from a dxFeed streamer symbol. */
export interface OptionContract {
  /** dxFeed streamer symbol, e.g. ".SPXW250620C5000". */
  streamerSymbol: string;
  /** Underlying root, e.g. "SPX" or "SPXW". */
  root: string;
  /** Expiration date, ISO yyyy-mm-dd. */
  expiration: string;
  /** Strike price in index points. */
  strike: number;
  type: OptionType;
  /** Days to expiry (calendar). */
  dte: number;
}

/** Live quote snapshot for one contract (dxLink Quote event). */
export interface QuoteSnapshot {
  streamerSymbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  bidSize: number | null;
  askSize: number | null;
  updatedAt: number; // epoch ms
}

/** Open interest / volume snapshot (dxLink Summary event). */
export interface SummarySnapshot {
  streamerSymbol: string;
  openInterest: number | null;
  dayVolume: number | null;
  prevDayClose: number | null;
  updatedAt: number;
}

/** A single executed trade (dxLink Trade / TimeAndSale event). */
export interface TradePrint {
  streamerSymbol: string;
  price: number;
  size: number;
  time: number; // epoch ms
  side: 'buy' | 'sell' | 'mid' | 'unknown';
}

/** Computed greeks for one contract. */
export interface Greeks {
  iv: number;
  delta: number;
  gamma: number;
  vanna: number;
  charm: number;
  theta: number;
  vega: number;
}

/** A flattened option row fed into the GEX calculator. */
export interface OptionRow {
  strike: number;
  side: 'call' | 'put';
  oi: number;
  volume: number;
  gamma: number;
  delta: number;
  theta: number;
  vega: number;
  iv: number;
  dte: number;
}

/** Per-strike aggregated exposure (calculator output row). */
export interface GexStrikeRow {
  strike: number;
  spotPrice: number;
  callOI: number;
  putOI: number;
  callVolume: number;
  putVolume: number;
  callGamma: number;
  putGamma: number;
  callDelta: number;
  putDelta: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
  netVolGEX: number;
  netDEX: number;
  volNetDEX: number;
  netVanna: number;
  netVolVanna: number;
  vex?: number;
  chex: number;
  volChex: number;
  callIV: number;
  putIV: number;
  callMark?: number;
  putMark?: number;
  dte: number;
}

/** Aggregate exposure totals across the chain. */
export interface ExposureTotals {
  // GEX: OI, OI+Vol, Vol-only
  totalGEX: number;
  totalGEXOiVol: number;
  totalGEXVol: number;
  // DEX (delta): OI split + OI+Vol + Vol-only. OI net = call + put.
  totalDeltaCall: number;
  totalDeltaPut: number;
  totalDeltaOiVol: number;
  totalDeltaVol: number;
  // Charm legacy theta split (back-compat)
  totalCharmCall: number;
  totalCharmPut: number;
  // Vega: OI split + OI+Vol + Vol-only
  totalVegaCall: number;
  totalVegaPut: number;
  totalVegaOiVol: number;
  totalVegaVol: number;
  // Vanna (VEX): OI net + OI+Vol + Vol-only
  totalVEX: number;
  totalVEXOiVol: number;
  totalVEXVol: number;
  // Charm (CHEX): OI net + OI+Vol + Vol-only
  totalCHEX: number;
  totalCHEXOiVol: number;
  totalCHEXVol: number;
}

/** Aggregated flow over a rolling window. */
export interface FlowBucket {
  symbol: string;
  windowMs: number;
  asOf: number;
  callBuyVol: number;
  callSellVol: number;
  putBuyVol: number;
  putSellVol: number;
  netPremium: number;
  buyPct: number;
  prints: number;
}

/** The full snapshot the dashboard consumes. */
export interface MarketSnapshot {
  symbol: string;
  spot: number | null;
  expiry: string;
  expirations: string[];
  updatedAt: number;
  gexRows: GexStrikeRow[];
  totals: ExposureTotals | null;
  callWall: number | null;
  putWall: number | null;
  gexFlip: number | null;
  totalNetGex: number;
  flow: FlowBucket | null;
  status: {
    ttAuthenticated: boolean;
    dxlinkConnected: boolean;
    contractsSubscribed: number;
    lastFeedAt: number | null;
    lastError: string | null;
  };
}

/** Outbound WebSocket message envelope. */
export interface WsMessage<T = unknown> {
  type: 'snapshot' | 'gex' | 'flow' | 'spot' | 'status' | 'ping';
  symbol?: string;
  data: T;
  ts: number;
}
