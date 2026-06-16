"use client";

/**
 * useSpxFlow — React hook wrapping the SPX 0DTE flow pipeline.
 * Mirrors logic from shared/spx-flow.js, adapted for Next.js/React.
 * Connects to the existing proxy WebSocket at ws://localhost:3001/ws/dxlink
 * (or NEXT_PUBLIC_WS_URL env var).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { getClientWsUrl, isLiveFeedReady } from "@/lib/clientRuntime";

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
const REST_WATCHLIST = ["SPY", "QQQ", "AMD", "AMZN", "GOOGL", "META", "MSFT", "NVDA", "TSLA"] as const;

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

const WS_URL = typeof window !== "undefined" ? getClientWsUrl() : "";

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
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const appendOrAggregateOrder = useCallback((
    orderList: FlowOrder[],
    aggregateMap: Map<string, FlowAggregateEntry>,
    order: FlowOrder,
  ) => {
    const aggregateKey = `${order.symbol}|${order.side}|${order.price}`;
    const existing = aggregateMap.get(aggregateKey);

    if (existing && order.ts - existing.ts <= FLOW_AGGREGATE_WINDOW_MS) {
      const current = orderList[existing.index];
      if (current) {
        current.ts = order.ts;
        current.size += order.size;
        current.premium += order.premium;
        aggregateMap.set(aggregateKey, { index: existing.index, ts: order.ts });
        return;
      }
    }

    orderList.push(order);
    aggregateMap.set(aggregateKey, { index: orderList.length - 1, ts: order.ts });

    for (const [key, entry] of aggregateMap.entries()) {
      if (order.ts - entry.ts > FLOW_AGGREGATE_WINDOW_MS) {
        aggregateMap.delete(key);
      }
    }
  }, []);

  const appendOrAggregateRestOrder = useCallback((
    orderList: FlowOrder[],
    aggregateMap: Map<string, FlowAggregateEntry>,
    order: FlowOrder,
  ) => {
    const aggregateKey = `${order.symbol}|${order.side}`;
    const existing = aggregateMap.get(aggregateKey);
    if (existing && order.ts - existing.ts <= FLOW_AGGREGATE_WINDOW_MS) {
      const current = orderList[existing.index];
      if (current) {
        current.ts = order.ts;
        current.size += order.size;
        current.premium += order.premium;
        aggregateMap.set(aggregateKey, { index: existing.index, ts: order.ts });
        return;
      }
    }
    orderList.push(order);
    aggregateMap.set(aggregateKey, { index: orderList.length - 1, ts: order.ts });
    for (const [key, entry] of aggregateMap.entries()) {
      if (order.ts - entry.ts > FLOW_AGGREGATE_WINDOW_MS) {
        aggregateMap.delete(key);
      }
    }
  }, []);

  const subscribeRestWatchlistOptions = useCallback(async (ws: WebSocket) => {
    const s = stateRef.current;
    const feedTypesBySymbol: Record<string, string[]> = {};

    await Promise.all(REST_WATCHLIST.map(async (ticker) => {
      try {
        if (!s.subscribedRestOptionSymbols.has(ticker)) {
          s.subscribedRestOptionSymbols.add(ticker);
          feedTypesBySymbol[ticker] = ["Quote", "Trade", "TimeAndSale"];
        }
        const expRes = await fetch(`/api/expirations?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
        if (!expRes.ok) return;
        const expJson = await expRes.json();
        const expirations = Array.isArray(expJson?.data?.items) ? expJson.data.items as ExpirationItem[] : [];
        const today = todayET();
        const selectedExpiry =
          expirations.find((item) => String(item["expiration-date"] ?? "").slice(0, 10) === today)?.["expiration-date"]
          ?? expirations[0]?.["expiration-date"];
        if (!selectedExpiry) return;

        const chainRes = await fetch(`/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(selectedExpiry)}&range=all&noSubscribe=1`, { cache: "no-store" });
        if (!chainRes.ok) return;
        const chainJson = await chainRes.json();
        const groups = Array.isArray(chainJson?.data?.items) ? chainJson.data.items as ChainGroupItem[] : [];
        const underlyingPrice = Number(
          chainJson?.data?.["underlying-price"]
          ?? chainJson?.data?.underlyingPrice
          ?? chainJson?.data?.underlying_price
          ?? groups[0]?.["underlying-price"]
          ?? 0,
        );
        if (underlyingPrice > 0) s.restUnderlyingPrices[ticker] = underlyingPrice;

        for (const group of groups) {
          for (const strike of group.strikes ?? []) {
            for (const leg of [strike.call, strike.put]) {
              const streamer = String(leg?.["streamer-symbol"] ?? leg?.symbol ?? "");
              if (!streamer || s.subscribedRestOptionSymbols.has(streamer)) continue;
              const optType = getOptionType(streamer);
              const strikePrice = getOptionStrike(streamer);
              const isOtm =
                !!optType &&
                !!strikePrice &&
                (optType === "C" ? strikePrice > underlyingPrice : strikePrice < underlyingPrice);
              if (!isOtm) continue;
              s.subscribedRestOptionSymbols.add(streamer);
              feedTypesBySymbol[streamer] = ["Quote", "Trade", "TimeAndSale"];
            }
          }
        }
      } catch {
        // Ignore per-ticker subscription failures and keep the rest of the tape alive.
      }
    }));

    const symbols = Object.keys(feedTypesBySymbol);
    if (!symbols.length || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "subscribe", symbols, feedTypesBySymbol }));
  }, []);

  const connect = useCallback(async () => {
    if (!enabled || !WS_URL) return;
    if (wsRef.current && wsRef.current.readyState < 2) return;
    const liveFeedReady = await isLiveFeedReady();
    if (!liveFeedReady) {
      reconnectRef.current = setTimeout(() => { void connect(); }, 10000);
      return;
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setFlow((p) => ({ ...p, connected: true }));
      ws.send(JSON.stringify({
        type: "subscribe",
        symbols: ["/ES:XCME", "/NQ:XCME"],
        feedTypesBySymbol: {
          "/ES:XCME": ["Quote", "TimeAndSale"],
          "/NQ:XCME": ["Quote", "TimeAndSale"],
        },
        spxSubscribe: true,
      }));
      void subscribeRestWatchlistOptions(ws);
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string);
        if (msg.type !== "FEED_DATA" || !Array.isArray(msg.data)) return;

        normalizeFeedData(msg.data).forEach((item) => {
          const sym = item.eventSymbol ?? "";
          const et = item.eventType ?? "";
          const s = stateRef.current;

          // Future quotes → update price
          if (et === "Quote" && (sym.startsWith("/ES") || sym.startsWith("/NQ"))) {
            const bid = Number(item.bidPrice ?? 0);
            const ask = Number(item.askPrice ?? 0);
            const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
            if (mid > 0) {
              if (sym.startsWith("/ES")) { s.esPrice = mid; if (!s.spxPrice) s.spxPrice = mid; }
              if (sym.startsWith("/NQ")) s.nqPrice = mid;
            }
            return;
          }

          // SPX option quotes → cache NBBO
          if (et === "Quote" && isOptionSymbol(sym)) {
            const bid = Number(item.bidPrice ?? 0);
            const ask = Number(item.askPrice ?? 0);
            if (bid > 0 && ask > 0) s.optionQuotes[sym] = { bid, ask };
            return;
          }

          if (et === "Quote" && REST_WATCHLIST.includes(sym as (typeof REST_WATCHLIST)[number])) {
            const bid = Number(item.bidPrice ?? 0);
            const ask = Number(item.askPrice ?? 0);
            const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
            if (mid > 0) s.restUnderlyingPrices[sym] = mid;
            return;
          }

          if (et !== "Trade" && et !== "TradeETH" && et !== "TimeAndSale") return;

          // SPX 0DTE trades
          if ((sym.startsWith(".SPXW") || sym.startsWith("SPXW")) && isSpx0DTE(sym)) {
            const optType = getOptionType(sym);
            if (!optType) return;
            const spotRef = s.spxPrice || s.esPrice;
            const price = Number(item.price ?? 0);
            const size = Number(item.size ?? 0);
            if (!price || !size) return;

            // Dedup with size cap to prevent unbounded memory growth
            const key = `${sym}|${item.sequence ?? ""}|${price}|${size}|${item.time}`;
            if (s.seenKeys.has(key)) return;
            s.seenKeys.add(key);
            if (s.seenKeys.size > DEDUP_MAX_SIZE) s.seenKeys.clear();

            // Aggressor direction
            const quote = s.optionQuotes[sym];
            let dir = 0;
            if (quote) {
              if (price >= quote.ask) dir = 1;
              else if (price <= quote.bid) dir = -1;
            }
            if (dir === 0) {
              const ag = item.aggressorSide ?? "";
              if (ag === "BUY") dir = 1;
              else if (ag === "SELL") dir = -1;
            }
            if (dir === 0) return;

            const side = dir > 0 ? "buy" : "sell";
            const premium = price * size * 100;
            const isOtm = isOtmOption(sym, optType, spotRef);
            const isBull = (optType === "C" && side === "buy") || (optType === "P" && side === "sell");

            const orderTs = Number(item.time ?? Date.now());
            const order: FlowOrder = {
              ts: orderTs,
              symbol: sym,
              strike: getOptionStrike(sym) ?? 0,
              type: optType,
              side,
              action: optType === "C" ? (side === "buy" ? "BUY CALL" : "SELL CALL") : (side === "buy" ? "BUY PUT" : "SELL PUT"),
              bucket: isBull ? "bull" : "bear",
              price,
              size,
              premium,
              isOtm,
            };

            appendOrAggregateOrder(s.tapeOrders, s.tapeAggregateMap, order);

            if (!isOtm) {
              publish();
              return;
            }

            appendOrAggregateOrder(s.orders, s.orderAggregateMap, order);

            if (optType === "C") {
              s.callPremiumFlow += dir > 0 ? premium : -premium;
              s.netPremiumFlow  += dir > 0 ? premium : -premium;
            } else {
              s.putPremiumFlow  += dir > 0 ? premium : -premium;
              s.netPremiumFlow  -= dir > 0 ? premium : -premium;
            }
            if (side === "buy") s.cumulativeBuyVol += size;
            else s.cumulativeSellVol += size;
            if (optType === "C") s.cumulativeCallVol += size;
            else s.cumulativePutVol += size;
            if (isBull) s.cumulativeBullVol += size;
            else s.cumulativeBearVol += size;

            publish();
          }

          // ES price from trades
          if (sym.startsWith("/ES")) {
            const price = Number(item.price ?? 0);
            if (price > 0) { s.esPrice = price; if (!s.spxPrice) s.spxPrice = price; }
            return;
          }

          if (isOptionSymbol(sym) && !(sym.startsWith(".SPXW") || sym.startsWith("SPXW"))) {
            const price = Number(item.price ?? 0);
            const size = Number(item.size ?? 0);
            if (!price || !size) return;
            const underlying = getOptionUnderlying(sym) ?? "";
            if (!REST_WATCHLIST.includes(underlying as (typeof REST_WATCHLIST)[number])) return;
            const spotRef = s.restUnderlyingPrices[underlying];
            if (!spotRef) return;
            const quote = s.optionQuotes[sym];
            let dir = 0;
            if (quote) {
              if (price >= quote.ask) dir = 1;
              else if (price <= quote.bid) dir = -1;
            }
            if (dir === 0) {
              if (item.aggressorSide === "BUY") dir = 1;
              else if (item.aggressorSide === "SELL") dir = -1;
            }
            if (dir === 0) return;
            const side = dir > 0 ? "buy" : "sell";
            const optType = getOptionType(sym) ?? "C";
            const isOtm = isOtmOption(sym, optType, spotRef);
            if (!isOtm) return;
            const order: FlowOrder = {
              ts: Number(item.time ?? Date.now()),
              symbol: sym,
              underlying: underlying || undefined,
              expiration: getOptionExpiry(sym) ?? undefined,
              strike: getOptionStrike(sym) ?? 0,
              type: optType,
              side,
              action: optType === "C" ? (side === "buy" ? "BUY CALL" : "SELL CALL") : (side === "buy" ? "BUY PUT" : "SELL PUT"),
              bucket: side === "buy" ? "bull" : "bear",
              price,
              size,
              premium: price * size * 100,
              isOtm,
            };
            appendOrAggregateRestOrder(s.restOrders, s.restAggregateMap, order);
            publish();
          }
        });
      } catch (e) {
        console.error("[useSpxFlow]", e);
      }
    };

    ws.onerror = () => setFlow((p) => ({ ...p, connected: false }));
    ws.onclose = () => {
      setFlow((p) => ({ ...p, connected: false }));
      reconnectRef.current = setTimeout(() => { void connect(); }, 5000);
    };
  }, [appendOrAggregateOrder, enabled, publish, subscribeRestWatchlistOptions]);

  useEffect(() => {
    void connect();
    return () => {
      wsRef.current?.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

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
    if (Array.isArray(stats.orders) && stats.orders.length > s.orders.length) {
      s.orders = [...stats.orders];
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
