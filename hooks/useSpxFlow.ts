"use client";

/**
 * useSpxFlow — React hook wrapping the SPX 0DTE flow pipeline.
 * Mirrors logic from shared/spx-flow.js, adapted for Next.js/React.
 * Connects to the existing proxy WebSocket at ws://localhost:3001/ws/dxlink
 * (or NEXT_PUBLIC_WS_URL env var).
 */

import { useRef, useState, useCallback } from "react";


// ── Types ─────────────────────────────────────────────────────────────────────

export interface FlowOrder {
  ts: number;
  symbol: string;
  underlying?: string;
  expiration?: string;
  strike: number;
  type: "C" | "P";
  side: "buy" | "sell";
  action: "BUY CALL" | "SELL CALL" | "BUY PUT" | "SELL PUT" | "FLOW";
  bucket: "bull" | "bear" | "neutral";
  price: number;
  size: number;
  premium: number;
  isOtm: boolean;
}

interface FlowAggregateEntry {
  index: number;
  ts: number;
}

export interface SpxFlowState {
  connected: boolean;
  spxPrice: number;
  esPrice: number;
  nqPrice: number;
  callPremiumFlow: number;
  putPremiumFlow: number;
  netPremiumFlow: number;
  cumulativeBullVol: number;
  cumulativeBearVol: number;
  cumulativeCallVol: number;
  cumulativePutVol: number;
  cumulativeBuyVol: number;
  cumulativeSellVol: number;
  orders: FlowOrder[];
  tapeOrders: FlowOrder[];
  restOrders: FlowOrder[];
  restUnderlyingPrices: Record<string, number>;
  // Derived
  bullPct: number;
  bearPct: number;
  pcr: number;
  bbr: number;
}

interface SeedFlowState {
  callVol?: number;
  putVol?: number;
  buyVol?: number;
  sellVol?: number;
  bullVol?: number;
  bearVol?: number;
  netPremium?: number;
  callPremium?: number;
  putPremium?: number;
  orders?: FlowOrder[];
  tapeOrders?: FlowOrder[];
  restOrders?: FlowOrder[];
  restUnderlyingPrices?: Record<string, number>;
}

const INITIAL_STATE: SpxFlowState = {
  connected: false,
  spxPrice: 0,
  esPrice: 5900,
  nqPrice: 20800,
  callPremiumFlow: 0,
  putPremiumFlow: 0,
  netPremiumFlow: 0,
  cumulativeBullVol: 0,
  cumulativeBearVol: 0,
  cumulativeCallVol: 0,
  cumulativePutVol: 0,
  cumulativeBuyVol: 0,
  cumulativeSellVol: 0,
  orders: [],
  tapeOrders: [],
  restOrders: [],
  restUnderlyingPrices: {},
  bullPct: 0.5,
  bearPct: 0.5,
  pcr: 0,
  bbr: 0,
};

const FLOW_AGGREGATE_WINDOW_MS = 500;
const DEDUP_MAX_SIZE = 10000;
const REST_WATCHLIST = ["SPY", "QQQ"] as const;

// ── ET helpers ────────────────────────────────────────────────────────────────

function getEtParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, weekday: "short",
  }).formatToParts(date);
  const out: Record<string, string> = {};
  for (const p of parts) { if (p.type !== "literal") out[p.type] = p.value; }
  const wmap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: parseInt(out.year ?? "0", 10),
    month: parseInt(out.month ?? "0", 10),
    day: parseInt(out.day ?? "0", 10),
    hour: parseInt(out.hour ?? "0", 10),
    minute: parseInt(out.minute ?? "0", 10),
    second: parseInt(out.second ?? "0", 10),
    weekday: wmap[out.weekday ?? ""] ?? -1,
  };
}

function todayET(date = new Date()): string {
  const et = getEtParts(date);
  return `${et.year}-${String(et.month).padStart(2, "0")}-${String(et.day).padStart(2, "0")}`;
}

function getTargetExpiryYYMMDD(): string {
  const et = getEtParts();
  const mins = et.hour * 60 + et.minute;
  if (mins >= 960) {
    const d = new Date();
    const next = new Date(
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d) + "T12:00:00"
    );
    do { next.setDate(next.getDate() + 1); } while (next.getDay() === 0 || next.getDay() === 6);
    return `${String(next.getFullYear()).slice(2)}${String(next.getMonth() + 1).padStart(2, "0")}${String(next.getDate()).padStart(2, "0")}`;
  }
  return `${String(et.year).slice(2)}${String(et.month).padStart(2, "0")}${String(et.day).padStart(2, "0")}`;
}

function isSpx0DTE(symbol: string): boolean {
  if (!symbol.startsWith(".SPXW") && !symbol.startsWith("SPXW")) return false;
  const m = symbol.match(/(\d{6})[CP]/);
  return m ? m[1] === getTargetExpiryYYMMDD() : false;
}

function isOptionSymbol(symbol: string): boolean {
  return /^\.?[A-Z]+\d{6}[CP]\d+$/i.test(symbol);
}

function getOptionExpiry(symbol: string): string | null {
  const m = symbol.match(/(\d{6})[CP]/);
  if (!m) return null;
  const y = `20${m[1].slice(0, 2)}`;
  const mo = m[1].slice(2, 4);
  const d = m[1].slice(4, 6);
  return `${y}-${mo}-${d}`;
}

function getOptionUnderlying(symbol: string): string | null {
  const m = symbol.match(/^\.?([A-Z]+)\d{6}[CP]/i);
  return m ? m[1].replace(/W$/, "") : null;
}

function getOptionType(symbol: string): "C" | "P" | null {
  const m = symbol.match(/\d{6}([CP])\d/);
  return m ? (m[1] as "C" | "P") : null;
}

function getOptionStrike(symbol: string): number | null {
  const m = symbol.match(/[CP](\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const strike = parseFloat(m[1]);
  return Number.isFinite(strike) ? (m[1].length === 8 ? strike / 1000 : strike) : null;
}

function isOtmOption(symbol: string, optType: "C" | "P", spotPrice: number): boolean {
  const strike = getOptionStrike(symbol);
  if (!strike || !spotPrice) return false;
  return optType === "C" ? strike > spotPrice : strike < spotPrice;
}

// ── Feed normalizer ───────────────────────────────────────────────────────────

interface FeedItem {
  eventType: string;
  eventSymbol: string;
  time: number;
  price?: number;
  size?: number;
  bidPrice?: number;
  askPrice?: number;
  aggressorSide?: string;
  sequence?: number;
  exchangeCode?: string;
}

interface ExpirationItem {
  "expiration-date"?: string;
}

interface ChainOptionItem {
  "streamer-symbol"?: string;
  symbol?: string;
}

interface ChainStrikeItem {
  call?: ChainOptionItem;
  put?: ChainOptionItem;
}

interface ChainGroupItem {
  "expiration-date"?: string;
  strikes?: ChainStrikeItem[];
  "underlying-price"?: number;
}

function normalizeFeedData(data: unknown[]): FeedItem[] {
  if (!data.length) return [];
  if (typeof data[0] === "object" && !Array.isArray(data[0])) return data as FeedItem[];
  const eventType = data[0] as string;
  const rows = data[1] as unknown[];
  if (typeof eventType !== "string" || !Array.isArray(rows)) return [];
  const fieldsByType: Record<string, string[]> = {
    Quote: ["bidPrice", "askPrice", "bidSize", "askSize"],
    Trade: ["price", "dayVolume", "size"],
    TradeETH: ["price", "dayVolume", "size"],
    TimeAndSale: ["time", "sequence", "exchangeCode", "price", "size", "bidPrice", "askPrice", "saleConditions", "flags", "aggressorSide"],
  };
  const fields = fieldsByType[eventType];
  if (!fields) return [];
  const hasType = rows[0] === eventType;
  const step = fields.length + (hasType ? 2 : 1);
  const out: FeedItem[] = [];
  for (let i = 0; i <= rows.length - step; i += step) {
    const base = i + (hasType ? 2 : 1);
    const item: Record<string, unknown> = {
      eventType: hasType ? rows[i] : eventType,
      eventSymbol: hasType ? rows[i + 1] : rows[i],
      time: Date.now(),
    };
    fields.forEach((f, j) => { item[f] = rows[base + j]; });
    out.push(item as unknown as FeedItem);
  }
  return out;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSpxFlow(enabled = true) {
  const [flow, setFlow] = useState<SpxFlowState>(INITIAL_STATE);
  const stateRef = useRef({
    spxPrice: 0,
    esPrice: 5900,
    nqPrice: 20800,
    callPremiumFlow: 0,
    putPremiumFlow: 0,
    netPremiumFlow: 0,
    cumulativeBullVol: 0,
    cumulativeBearVol: 0,
    cumulativeCallVol: 0,
    cumulativePutVol: 0,
    cumulativeBuyVol: 0,
    cumulativeSellVol: 0,
    orders: [] as FlowOrder[],
    tapeOrders: [] as FlowOrder[],
    restOrders: [] as FlowOrder[],
    optionQuotes: {} as Record<string, { bid: number; ask: number }>,
    restUnderlyingPrices: {} as Record<string, number>,
    seenKeys: new Set<string>(),
    orderAggregateMap: new Map<string, FlowAggregateEntry>(),
    tapeAggregateMap: new Map<string, FlowAggregateEntry>(),
    restAggregateMap: new Map<string, FlowAggregateEntry>(),
    subscribedRestOptionSymbols: new Set<string>(),
  });
  const publish = useCallback(() => {
    const s = stateRef.current;
    const total = s.cumulativeBullVol + s.cumulativeBearVol;
    const bullPct = total > 0 ? s.cumulativeBullVol / total : 0.5;
    const pcr = s.cumulativeCallVol > 0 ? s.cumulativePutVol / s.cumulativeCallVol : 0;
    const bbr = s.cumulativeSellVol > 0 ? s.cumulativeBuyVol / s.cumulativeSellVol : 0;
    setFlow((prev) => ({
      ...prev,
      spxPrice: s.spxPrice || s.esPrice,
      esPrice: s.esPrice,
      nqPrice: s.nqPrice,
      callPremiumFlow: s.callPremiumFlow,
      putPremiumFlow: s.putPremiumFlow,
      netPremiumFlow: s.netPremiumFlow,
      cumulativeBullVol: s.cumulativeBullVol,
      cumulativeBearVol: s.cumulativeBearVol,
      cumulativeCallVol: s.cumulativeCallVol,
      cumulativePutVol: s.cumulativePutVol,
      cumulativeBuyVol: s.cumulativeBuyVol,
      cumulativeSellVol: s.cumulativeSellVol,
      orders: [...s.orders],
      tapeOrders: [...s.tapeOrders],
      restOrders: [...s.restOrders],
      bullPct,
      bearPct: 1 - bullPct,
      pcr,
      bbr,
    }));
  }, []);

  const reset = useCallback(() => {
    const s = stateRef.current;
    s.callPremiumFlow = s.putPremiumFlow = s.netPremiumFlow = 0;
    s.cumulativeBullVol = s.cumulativeBearVol = 0;
    s.cumulativeCallVol = s.cumulativePutVol = 0;
    s.cumulativeBuyVol = s.cumulativeSellVol = 0;
    s.orders = [];
    s.tapeOrders = [];
    s.restOrders = [];
    s.seenKeys = new Set();
    s.optionQuotes = {};
    s.restUnderlyingPrices = {};
    s.orderAggregateMap = new Map();
    s.tapeAggregateMap = new Map();
    s.restAggregateMap = new Map();
    s.subscribedRestOptionSymbols = new Set();
    publish();
  }, [publish]);

  /** Seed cumulative counters from a previously-saved snapshot (e.g. IndexedDB on page load). */
  const seed = useCallback((stats: SeedFlowState) => {
    const s = stateRef.current;
    if (stats.bullVol   != null && stats.bullVol   > s.cumulativeBullVol)   s.cumulativeBullVol   = stats.bullVol;
    if (stats.bearVol   != null && stats.bearVol   > s.cumulativeBearVol)   s.cumulativeBearVol   = stats.bearVol;
    if (stats.callVol   != null && stats.callVol   > s.cumulativeCallVol)   s.cumulativeCallVol   = stats.callVol;
    if (stats.putVol    != null && stats.putVol    > s.cumulativePutVol)    s.cumulativePutVol    = stats.putVol;
    if (stats.buyVol    != null && stats.buyVol    > s.cumulativeBuyVol)    s.cumulativeBuyVol    = stats.buyVol;
    if (stats.sellVol   != null && stats.sellVol   > s.cumulativeSellVol)   s.cumulativeSellVol   = stats.sellVol;
    if (stats.netPremium  != null && Math.abs(stats.netPremium)  > Math.abs(s.netPremiumFlow))  s.netPremiumFlow  = stats.netPremium;
    if (stats.callPremium != null && Math.abs(stats.callPremium) > Math.abs(s.callPremiumFlow)) s.callPremiumFlow = stats.callPremium;
    if (stats.putPremium  != null && Math.abs(stats.putPremium)  > Math.abs(s.putPremiumFlow))  s.putPremiumFlow  = stats.putPremium;
    // Server resends the full capped tape each message: once it hits the cap the
    // length stops growing, so a length-only guard freezes the panel. Replace
    // whenever the newest order differs (covers capped + post-restart shrink).
    if (Array.isArray(stats.orders)) {
      const incomingLast = stats.orders[stats.orders.length - 1];
      const currentLast = s.orders[s.orders.length - 1];
      const lastChanged =
        stats.orders.length !== s.orders.length ||
        (incomingLast && currentLast
          ? incomingLast.ts !== currentLast.ts ||
            incomingLast.symbol !== currentLast.symbol ||
            incomingLast.price !== currentLast.price ||
            incomingLast.size !== currentLast.size
          : incomingLast !== currentLast);
      if (lastChanged) s.orders = [...stats.orders];
    }
    if (Array.isArray(stats.tapeOrders) && stats.tapeOrders.length > s.tapeOrders.length) {
      s.tapeOrders = [...stats.tapeOrders];
    }
    if (Array.isArray(stats.restOrders) && stats.restOrders.length > s.restOrders.length) {
      s.restOrders = [...stats.restOrders];
    }
    publish();
  }, [publish]);

  return { flow, reset, seed };
}
