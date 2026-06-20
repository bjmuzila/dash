"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmTrackerAdmin from "@/components/dashboard/EmTrackerAdmin";
import { HOME_THEME as HT, homeShellStyle, homeButtonStyle } from "@/components/shared/homeTheme";

async function getHtml2Canvas() {
  const mod = await import("html2canvas" as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).default ?? mod;
}

type DashboardView = "estimated" | "zones" | "tracker";

interface EMRow {
  ticker: string;
  close?: number;
  em?: number;
  up?: number;
  down?: number;
  expiration?: string;
  strike?: number;
  error?: string;
}

interface TickerEmStats {
  recentAvg: number | null;
  midAvg: number | null;
  sampleSize: number;
}

interface OptionData {
  symbol: string;
  expiration: string;
  strike: number;
  type: "CALL" | "PUT";
  bid: number;
  ask: number;
  last: number;
  mark: number;
  iv: number;
  dte: number;
}

interface ZoneLevels {
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
  pivot: number;
  range: number;
  noLongNear: number;
  noLongFar: number;
  noShortNear: number;
  noShortFar: number;
}

interface Snapshot {
  id: number;
  timestamp: number;
  date: string;
  time: string;
  period: string;
  view?: DashboardView;
  rows?: EMRow[];
  expirations?: string[];
  zoneLevels?: ZoneLevels[];
  targetDateLabel?: string;
}

interface HistoryItem {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const SYMBOLS = [
  "ESM","NQM","SPY","QQQ","SPX","AAPL","AMD","AMZN","GOOGL",
  "META","MSFT","NVDA","TSLA","COIN","HOOD","IWM","NDX","NFLX","SMH","PLTR",
];

const DISPLAY_LABEL: Record<string, string> = {
  ESM: "ESU", NQM: "NQU", ESU6: "ESU", NQM6: "NQU",
};

const API_SYMBOL: Record<string, string> = {
  ESM: "/ESU26", NQM: "/NQ:XCME", SPX: "$SPX", NDX: "$NDX",
};
const CHAIN_SYMBOL: Record<string, string> = { SPX: "$SPX", NDX: "$NDX" };
const FUTURE_PROXY: Record<string, string> = { ESM: "SPX", NQM: "NDX" };

// dxLink weekly-candle symbol for the No-Short/No-Long zone math. Futures use
// their working streamer forms; indices use the $-prefixed form; everything
// else is a plain equity ticker. `{=w}` requests weekly OHLC aggregation.
const ZONE_HISTORY_SYMBOL: Record<string, string> = {
  ESM: "/ESU6{=w}",
  NQM: "/NQ{=w}",
};
function zoneSymbol(ticker: string): string {
  if (ZONE_HISTORY_SYMBOL[ticker]) return ZONE_HISTORY_SYMBOL[ticker];
  if (ticker === "SPX") return "$SPX{=w}";
  if (ticker === "NDX") return "$NDX{=w}";
  return `${ticker}{=w}`;
}
const QUOTE_SYMBOLS = Array.from(new Set([
  ...SYMBOLS,
  ...Object.values(API_SYMBOL),
  "/ESU26",
  "/NQU26",
  "VIX",
]));

const API = {
  quotesBatch: () => `/api/quotes-batch`,
  expirations: (ticker: string) => `/api/expirations?ticker=${encodeURIComponent(ticker)}`,
  chain: (sym: string, exp: string, extra = "") =>
    `/api/chains?ticker=${encodeURIComponent(sym)}&expiration=${encodeURIComponent(exp)}${extra}`,
  optionMarks: (symbols: string) =>
    `/api/em/option-marks?symbols=${encodeURIComponent(symbols)}`,
  emCloses: () => `/api/em/em-closes`,
  history: (symbol: string, interval = "1Day") =>
    `/api/em/market-data/history/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}`,
  dxlinkCandles: (symbol: string, start: number, count: number) =>
    `/api/dxlink/candles?symbol=${encodeURIComponent(symbol)}&start=${start}&count=${count}`,
};

function getEtNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function labelForDate(exp: string | undefined): string {
  if (!exp) return nextFridayLabel();
  return new Date(exp + "T12:00:00").toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}

function nextFridayLabel(): string {
  const d = new Date();
  const add = ((5 - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + add);
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}

function daysTo(exp: string): number {
  return Math.ceil((new Date(exp + "T16:00:00").getTime() - Date.now()) / 86400000);
}

function roundQuarter(num: number): number {
  return Math.round(num * 4) / 4;
}

function fmtPrice(ticker: string, num: number | undefined): string {
  if (num === undefined || !Number.isFinite(num)) return "--";
  const n = (ticker === "ESM" || ticker === "NQM") ? roundQuarter(num) : num;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtFuture(num: number | undefined): string {
  if (num === undefined || !Number.isFinite(num)) return "--";
  return roundQuarter(num).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtEm(num: number | undefined): string {
  if (num === undefined || !Number.isFinite(num) || num < 0) return "--";
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function mid(o: OptionData): number {
  if (o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2;
  if (o.mark > 0) return o.mark;
  if (o.last > 0) return o.last;
  return 0;
}

function getWeekKey(date: Date): string {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const mondayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - mondayOffset);
  return d.toISOString().slice(0, 10);
}

function getCompletedWeekKey(): string {
  const now = getEtNow();
  const anchor = new Date(now);
  const minutes = anchor.getHours() * 60 + anchor.getMinutes();
  const day = anchor.getDay();

  if (day === 0) {
    anchor.setDate(anchor.getDate() - 2);
  } else if (day === 6) {
    anchor.setDate(anchor.getDate() - 1);
  } else if (day === 5 && minutes < 16 * 60) {
    anchor.setDate(anchor.getDate() - 7);
  } else if (day >= 1 && day <= 4) {
    anchor.setDate(anchor.getDate() - (day + 2));
  }

  return getWeekKey(anchor);
}

function parseHistoryItems(json: unknown): HistoryItem[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = (json as any)?.data?.items || (json as any)?.data?.candles || (json as any)?.candles || [];
  return items
    .map((item) => {
      const rawTime = item.time ?? item.datetime ?? item.timestamp ?? item.startsAt ?? item.date;
      const time = typeof rawTime === "number"
        ? rawTime
        : typeof rawTime === "string"
          ? Date.parse(rawTime)
          : NaN;
      return {
        time,
        open: Number(item.open),
        high: Number(item.high),
        low: Number(item.low),
        close: Number(item.close),
      } satisfies HistoryItem;
    })
    .filter((item) =>
      Number.isFinite(item.time)
      && Number.isFinite(item.open)
      && Number.isFinite(item.high)
      && Number.isFinite(item.low)
      && Number.isFinite(item.close)
      && item.close > 0
    )
    .sort((a, b) => a.time - b.time);
}

function buildZoneLevels(ticker: ZoneLevels["ticker"], candles: HistoryItem[]): ZoneLevels {
  const ordered = [...candles].sort((a, b) => a.time - b.time);
  const open = ordered[0].open;
  const close = ordered[ordered.length - 1].close;
  const high = Math.max(...ordered.map((item) => item.high));
  const low = Math.min(...ordered.map((item) => item.low));
  const pivot = (high + low + close) / 3;
  const range = high - low;
  return {
    ticker,
    open,
    high,
    low,
    close,
    pivot,
    range,
    noLongNear: pivot + range,
    noLongFar: pivot + (1.382 * range),
    noShortNear: pivot - range,
    noShortFar: pivot - (1.382 * range),
  };
}

function normalizeOptions(chain: unknown): OptionData[] {
  const flat: OptionData[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const direct = Array.isArray((chain as any)?.options) ? (chain as any).options : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  direct.forEach((o: any) => {
    flat.push({
      symbol: o.symbol || o.optionSymbol || "",
      expiration: o.expiration || o.expirationDate,
      strike: Number(o.strike || o.strikePrice),
      type: String(o.optionType || o.type || "").toUpperCase() as "CALL" | "PUT",
      bid: Number(o.bid || o.bidPrice || o["bid-price"] || 0),
      ask: Number(o.ask || o.askPrice || o["ask-price"] || 0),
      last: Number(o.last || o["last-price"] || o.lastPrice || 0),
      mark: Number(o.mark || o["mark-price"] || o["mid-price"] || o.midPrice || 0),
      iv: Number(o.iv || o.impliedVolatility || o["implied-volatility"] || o.volatility || 0),
      dte: Number(o.dte || o.daysToExpiration || 0),
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nestedItems = Array.isArray((chain as any)?.data?.items) ? (chain as any).data.items : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nestedItems.forEach((expGroup: any) => {
    const expiration = expGroup?.["expiration-date"] || expGroup?.expirationDate || expGroup?.expiration;
    const strikes = Array.isArray(expGroup?.strikes) ? expGroup.strikes : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    strikes.forEach((strikeRow: any) => {
      const strike = Number(strikeRow?.["strike-price"] || strikeRow?.strikePrice || strikeRow?.strike);
      (["call", "put"] as const).forEach((side) => {
        const leg = strikeRow?.[side];
        if (!leg) return;
        flat.push({
          symbol: leg.symbol || "",
          expiration,
          strike,
          type: side.toUpperCase() as "CALL" | "PUT",
          bid: Number(leg.bid || leg.bidPrice || leg["bid-price"] || 0),
          ask: Number(leg.ask || leg.askPrice || leg["ask-price"] || 0),
          last: Number(leg.last || leg["last-price"] || leg.lastPrice || 0),
          mark: Number(leg.mark || leg["mark-price"] || leg["mid-price"] || leg.midPrice || 0),
          iv: Number(leg.iv || leg["implied-volatility"] || leg.impliedVolatility || leg.volatility || 0),
          dte: Number(leg.dte || leg.daysToExpiration || daysTo(expiration)),
        });
      });
    });
  });

  return flat.filter((o) => o.expiration && Number.isFinite(o.strike));
}

/**
 * The broker's underlying spot from the chain payload. For indices (SPX/NDX) the
 * dashboard's SPX (~7500) differs from Yahoo's ^GSPC (~6000), and the option
 * strikes are denominated in the BROKER's level — so we must center the ATM strike
 * walk on this, not on the Yahoo quotes-batch close, or the straddle never matches.
 */
function chainUnderlyingPrice(chain: unknown): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = chain as any;
  const v = Number(
    c?.data?.underlyingPrice ?? c?.underlyingPrice ??
    c?.data?.underlying_price ?? c?.underlying_price ?? 0
  );
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("EM_Dashboard_Next", 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("snapshots")) {
        db.createObjectStore("snapshots", { keyPath: "id", autoIncrement: true });
      }
    };
  });
}

async function dbSaveSnapshot(db: IDBDatabase, snapshot: Omit<Snapshot, "id" | "timestamp" | "date" | "time">): Promise<Snapshot> {
  const now = new Date();
  const snap: Omit<Snapshot, "id"> = {
    ...snapshot,
    timestamp: now.getTime(),
    date: now.toLocaleDateString("en-US"),
    time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["snapshots"], "readwrite");
    const store = tx.objectStore("snapshots");
    const req = store.add(snap);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve({ ...snap, id: req.result as number });
  });
}

async function dbGetAll(db: IDBDatabase): Promise<Snapshot[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["snapshots"], "readonly");
    const store = tx.objectStore("snapshots");
    const req = store.getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(((req.result as Snapshot[]) || []).reverse());
  });
}

async function dbDeleteSnapshot(db: IDBDatabase, id: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["snapshots"], "readwrite");
    const store = tx.objectStore("snapshots");
    const req = store.delete(id);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

interface EMEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  quoteCache: Record<string, any>;
  quoteCacheTime: number;
  directChainCache: Record<string, OptionData[]>;
  emClosesCache: Record<string, number> | null;
}

function makeEngine(): EMEngine {
  return { quoteCache: {}, quoteCacheTime: 0, directChainCache: {}, emClosesCache: null };
}

async function fetchAllQuotes(engine: EMEngine) {
  if (Date.now() - engine.quoteCacheTime < 5000) return engine.quoteCache;
  const r = await fetch(`${API.quotesBatch()}?symbols=${encodeURIComponent(QUOTE_SYMBOLS.join(","))}`);
  if (!r.ok) throw new Error("quotes-batch failed");
  const json = await r.json();
  const items: unknown[] = json?.data?.items || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items.forEach((q: any) => { map[q.symbol] = q; });
  const aliases: Record<string, string[]> = {
    ESM: ["/ESU26", "/ESU6", "/ES:XCME", "/ES"],
    NQM: ["/NQU26", "/NQM6", "/NQ:XCME", "/NQ"],
    SPX: ["$SPX"], NDX: ["$NDX"], SPY: ["SPY"], QQQ: ["QQQ"],
  };
  Object.entries(aliases).forEach(([key, list]) => {
    for (const alias of list) {
      if (map[alias]) {
        map[key] = map[alias];
        break;
      }
    }
  });
  engine.quoteCache = map;
  engine.quoteCacheTime = Date.now();
  return map;
}

async function fetchQuoteDetail(ticker: string, engine: EMEngine) {
  const dxSym = API_SYMBOL[ticker] || ticker;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quotes: Record<string, any> = await fetchAllQuotes(engine);
  // A quote is only usable if it carries a real price. Yahoo intermittently
  // returns an all-null row for index symbols ($NDX), which would otherwise win
  // the lookup over a sibling key (NDX) that has the price. Prefer a priced row.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priced = (x: any) =>
    x && Number.isFinite(Number(x.last ?? x.mark ?? x["prev-close"] ?? x.prevClose ?? x["day-close"]))
      && Number(x.last ?? x.mark ?? x["prev-close"] ?? x.prevClose ?? x["day-close"]) > 0;
  const candidates = [
    quotes[dxSym], quotes[ticker],
    quotes[String(dxSym).replace(/^\//, "")],
    quotes[String(ticker).replace(/^\//, "")],
    quotes[String(dxSym).replace(/^\$/, "")],
  ];
  const q = candidates.find(priced) || candidates.find(Boolean);
  if (!q) throw new Error(`${ticker} not in quotes-batch`);
  const prevClose = Number(q["prev-close"] || q.prevClose || 0);
  const dayClose = Number(q["day-close"] || 0);
  const isFutures = ticker === "ESM" || ticker === "NQM";
  const isIndex = ticker === "SPX" || ticker === "NDX";
  let close = isFutures && dayClose > 0
    ? dayClose
    : isIndex && prevClose > 0 ? prevClose
    : Number(q.last || q.mark || ((q.bid + q.ask) / 2));
  if (isFutures && !(dayClose > 0)) {
    try {
      if (!engine.emClosesCache) {
        const r = await fetch(API.emCloses());
        engine.emClosesCache = r.ok ? (await r.json())?.data || {} : {};
      }
      const yahooClose = ticker === "ESM" ? engine.emClosesCache!.es : engine.emClosesCache!.nq;
      if (yahooClose > 0) close = yahooClose;
    } catch {}
  }
  // Futures fallback: /api/em/em-closes is 404 on server-v2, so when it gives us
  // nothing, use the future's own last/prev-close from quotes-batch (/NQU26,
  // /ESU26) rather than letting `close` stay NaN and dropping the row.
  if (isFutures && (!Number.isFinite(close) || close <= 0)) {
    const fallback = Number(q.last ?? q.mark ?? q["prev-close"] ?? q.prevClose ?? 0);
    if (fallback > 0) close = fallback;
  }
  if (!Number.isFinite(close) || close <= 0) throw new Error(`Invalid price for ${ticker}: ${close}`);
  return { quote: q, close, prevClose };
}

async function fetchMetricsIv(ticker: string, targetExp: string): Promise<number> {
  void ticker; void targetExp;
  return 0;
}

async function fetchOptionMarks(symbols: string[]) {
  const cleaned = symbols.map((s) => String(s || "").trim()).filter(Boolean);
  if (!cleaned.length) return {};
  const r = await fetch(API.optionMarks(cleaned.join(",")));
  if (!r.ok) return {};
  const json = await r.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (json?.data?.items || []).forEach((item: any) => { if (item?.symbol) map[item.symbol] = item; });
  return map;
}

async function fetchChainDirect(chainSym: string, targetExp: string, engine: EMEngine): Promise<OptionData[] | null> {
  const key = `${chainSym}:${targetExp}`;
  if (engine.directChainCache[key]) return engine.directChainCache[key];
  const urls = [
    API.chain(chainSym, targetExp, "&noSubscribe=1"),
    `/api/chains?ticker=${encodeURIComponent(chainSym)}&expiration=${encodeURIComponent(targetExp)}`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const opts = normalizeOptions(await r.json()).filter((o) => o.expiration === targetExp);
      if (opts.length) {
        engine.directChainCache[key] = opts;
        return opts;
      }
    } catch {}
  }
  return null;
}

function getTargetExpiration(knownExpirations: string[], expOverride: string): string {
  if (expOverride) return expOverride;
  if (knownExpirations.length) {
    const inRange = knownExpirations.filter((exp) => {
      const d = daysTo(exp);
      return d >= 1 && d <= 10;
    });
    const friday = inRange.find((exp) => new Date(exp + "T12:00:00").getDay() === 5);
    if (friday) return friday;
    const thursday = inRange.find((exp) => new Date(exp + "T12:00:00").getDay() === 4);
    if (thursday) return thursday;
    if (inRange[0]) return inRange[0];
    return knownExpirations[0];
  }
  return "";
}

async function estimateMove(ticker: string, targetExp: string, engine: EMEngine): Promise<EMRow> {
  const isIndex = ticker === "SPX" || ticker === "NDX";
  const isFutureProxy = !!FUTURE_PROXY[ticker];
  // The Yahoo quote-batch row can be null/all-zero — for $NDX, and for the NQ
  // continuous future (NQU). Don't let a missing quote kill the row: indices and
  // futures both recover their level from the broker chain underlyingPrice below
  // (a future just falls back to a zero basis, centering on the proxy-index spot).
  const tolerateMissingQuote = isIndex || isFutureProxy;
  let close = 0;
  let prevClose = 0;
  try {
    const detail = await fetchQuoteDetail(ticker, engine);
    close = detail.close;
    prevClose = detail.prevClose;
  } catch (e) {
    if (!tolerateMissingQuote) throw e; // equities still need a real quote
  }
  if (!tolerateMissingQuote && (!Number.isFinite(close) || close <= 0)) throw new Error("No quote");
  if (!targetExp) throw new Error("No expiration selected");

  const isFuture = FUTURE_PROXY[ticker];
  const lookupSym = isFuture ? FUTURE_PROXY[ticker] : (CHAIN_SYMBOL[ticker] || ticker);
  const chainSym = (lookupSym || "SPX").replace(/^\$/, "");

  // NOTE: do NOT pass forceSub here. On server-v2 the forceSub path returns an
  // all-zero (unpriced) chain for index weeklies like NDXP; the plain pinned
  // fetch returns full bid/ask/mark/iv. forceSub was the cause of NDX/NQU blanks.
  const chainUrl = API.chain(chainSym, targetExp, "&noSubscribe=1");
  const chain = await Promise.race([
    fetch(chainUrl).then((r) => r.ok ? r.json() : { options: [] }).catch(() => ({ options: [] })),
    new Promise<{ options: [] }>((res) => setTimeout(() => res({ options: [] }), 10000)),
  ]);

  let options = normalizeOptions(chain);
  // Broker spot for the chain's underlying — the strikes are denominated in THIS
  // level (SPX ~7500), not the Yahoo close (~6000). Used to center the ATM walk.
  let chainSpot = chainUnderlyingPrice(chain);
  // A priced option carries a usable bid/ask, mark, or IV. NDX/NDXP weeklies
  // that are still far out (e.g. next Friday) are LISTED but the broker isn't
  // quoting them yet, so the chain comes back all-zero — which would zero out
  // every straddle and drop the row. Treat an all-unpriced expiration the same
  // as a missing one: refetch unpinned and snap to the nearest PRICED date.
  const isPriced = (o: OptionData) =>
    (o.bid > 0 && o.ask > 0) || o.mark > 0 || Number(o.iv || 0) > 0;
  let effectiveExp = targetExp;
  let expOptions = options.filter((o) => o.expiration === effectiveExp);
  if (!expOptions.length || !expOptions.some(isPriced)) {
    // Refetch unpinned so the server returns the nearest expirations this ticker
    // actually lists, then snap to the nearest date that has live pricing.
    const unpinned = await fetch(`/api/chains?ticker=${encodeURIComponent(chainSym)}`)
      .then((r) => (r.ok ? r.json() : { options: [] }))
      .catch(() => ({ options: [] }));
    const merged = normalizeOptions(unpinned);
    if (merged.length) options = merged;
    const unpinnedSpot = chainUnderlyingPrice(unpinned);
    if (unpinnedSpot > 0) chainSpot = unpinnedSpot;
    const pricedExps = [...new Set(options.filter(isPriced).map((o) => o.expiration))]
      .filter(Boolean).sort();
    const allExps = [...new Set(options.map((o) => o.expiration))].filter(Boolean).sort();
    const pool = pricedExps.length ? pricedExps : allExps;
    const snapped = pool.find((e) => e >= targetExp) || pool[pool.length - 1];
    if (snapped) {
      effectiveExp = snapped;
      expOptions = options.filter((o) => o.expiration === effectiveExp);
    }
  }
  if (!expOptions.length) throw new Error("No options for expiration");

  if (expOptions.every((o) => Number(o.iv || 0) === 0)) {
    const direct = await fetchChainDirect(chainSym, effectiveExp, engine);
    if (direct) expOptions = direct;
  }

  // For a future we may need the proxy index's quote, but only as a FALLBACK when
  // the chain didn't carry a broker spot. The proxy index ($NDX) Yahoo quote is
  // often null and throws — so guard it; chainSpot (the NDX chain we just fetched)
  // is the authoritative center for NQU anyway.
  let indexQuote: { close: number; prevClose: number } | null = null;
  if (isFuture && !(chainSpot > 0)) {
    try { indexQuote = await fetchQuoteDetail(lookupSym, engine); } catch { indexQuote = null; }
  }
  // Center the ATM strike walk on the BROKER's underlying level (chainSpot) when
  // available — the strikes are in that scale (SPX ~7500), and the Yahoo close
  // (~6000 for ^GSPC) would point the walk at strikes that don't exist, so the
  // straddle never matches and the row dies. Falls back to the quote close.
  const quoteClose = isFuture
    ? (indexQuote && indexQuote.prevClose > 0 ? indexQuote.prevClose : (indexQuote ? indexQuote.close : 0))
    : close;
  const indexClose = chainSpot > 0 ? chainSpot : quoteClose;
  // For an index whose Yahoo quote was null, recover the display close from the
  // broker spot so the row shows a price instead of throwing "Invalid price".
  if (isIndex && (!Number.isFinite(close) || close <= 0) && chainSpot > 0) close = chainSpot;
  if (!Number.isFinite(indexClose) || indexClose <= 0) throw new Error("No usable underlying price");

  const allIvZero = expOptions.every((o) => Number(o.iv || 0) === 0);
  const metricsIv = allIvZero ? await fetchMetricsIv(chainSym, effectiveExp) : 0;

  // Walk strikes ATM-first, but BOUND the walk. After-hours the chain can come
  // back with no IV and no bid/ask on most strikes; without a cap the loop probed
  // /api/em/option-marks for all ~200 strikes serially (the log storm + multi-second
  // refresh). The ATM straddle is all we need, so only consider the nearest few.
  const MAX_STRIKE_TRIES = 8;
  const strikes = [...new Set(expOptions.map((o) => o.strike))]
    .sort((a, b) => Math.abs(a - indexClose) - Math.abs(b - indexClose))
    .slice(0, MAX_STRIKE_TRIES);

  if (!strikes.length || (allIvZero && metricsIv > 0 && expOptions.length === 0)) {
    if (metricsIv > 0) {
      const dte = daysTo(effectiveExp);
      const em = 0.84 * metricsIv * indexClose * Math.sqrt(dte / 365);
      if (Number.isFinite(em) && em > 0) {
        return { ticker, close, em, up: indexClose + em, down: indexClose - em, expiration: effectiveExp, strike: Math.round(indexClose) };
      }
    }
    throw new Error("No strikes found");
  }

  let strike: number | null = null;
  let em = 0;

  for (const candidateStrike of strikes) {
    let c = expOptions.find((o) => o.strike === candidateStrike && o.type === "CALL");
    let p = expOptions.find((o) => o.strike === candidateStrike && o.type === "PUT");
    if (!c || !p) continue;

    const candidateDte = c.dte || p.dte || daysTo(effectiveExp);
    let avgIV = (Number(c.iv || 0) + Number(p.iv || 0)) / 2;

    if (avgIV === 0 && metricsIv > 0) avgIV = metricsIv;

    let candidateEm = 0;

    if (avgIV > 0 && candidateDte > 0) {
      candidateEm = 0.84 * avgIV * indexClose * Math.sqrt(candidateDte / 365);
    } else {
      // Only refetch per-strike marks when the chain row carries NO usable price
      // at all (no bid/ask AND no mark). The /api/chains payload already includes
      // a REST mark for every leg, so after-hours (bid/ask=0 but mark>0) we must
      // NOT refetch — doing so fired /api/em/option-marks for hundreds of strikes
      // per ticker (the 404/200 log storm). mid() already falls back to mark.
      const haveUsable = (o: OptionData) => (o.bid > 0 && o.ask > 0) || o.mark > 0 || o.last > 0;
      if ((!haveUsable(c) || !haveUsable(p)) && (c.symbol || p.symbol)) {
        const marks = await fetchOptionMarks([c.symbol, p.symbol].filter(Boolean));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (marks[c.symbol]) c = Object.assign({}, c, marks[c.symbol] as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (marks[p.symbol]) p = Object.assign({}, p, marks[p.symbol] as any);
        avgIV = (Number(c?.iv || 0) + Number(p?.iv || 0)) / 2;
      }

      const cMid = c ? mid(c) : 0;
      const pMid = p ? mid(p) : 0;
      if (cMid > 0 && pMid > 0) {
        candidateEm = (cMid + pMid) * 0.85;
      } else if (avgIV > 0 && candidateDte > 0) {
        candidateEm = 0.84 * avgIV * indexClose * Math.sqrt(candidateDte / 365);
      }
    }

    if (Number.isFinite(candidateEm) && candidateEm > 0) {
      const emPct = candidateEm / indexClose;
      if (emPct < 0.002 || emPct > 0.25) continue;
      strike = candidateStrike;
      em = candidateEm;
      break;
    }
  }

  if (!strike) throw new Error("No usable strike (IV=0 and no straddle bid/ask)");
  if (!Number.isFinite(em) || em <= 0) throw new Error("EM calculation returned zero");

  // Basis = future price − proxy-index spot, applied ONLY when the future's own
  // quote is valid. If NQU's quote was missing, basis stays 0 so Up/Down center
  // on the proxy-index spot rather than blowing up by −indexClose.
  const haveFutureClose = isFuture && Number.isFinite(close) && close > 0;
  const basis = haveFutureClose ? close - indexClose : 0;
  void prevClose;
  // Index displays the broker spot as Close. A future shows its own price when we
  // have it, else the proxy-index spot (so the row still renders a sensible level).
  const displayClose = isFuture
    ? (haveFutureClose ? close : indexClose)
    : (chainSpot > 0 ? chainSpot : close);
  return { ticker, close: displayClose, em, up: indexClose + em + basis, down: indexClose - em + basis, expiration: effectiveExp, strike };
}

async function fetchWeeklyHistory(symbol: string): Promise<HistoryItem[]> {
  const start = Date.now() - (140 * 24 * 60 * 60 * 1000);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const r = await fetch(API.dxlinkCandles(symbol, start, 12), { cache: "no-store" });
    const text = await r.text();
    if (!r.ok) throw new Error(`History failed for ${symbol}`);

    try {
      return parseHistoryItems(JSON.parse(text));
    } catch (error) {
      if (attempt === 1) {
        throw new Error(
          error instanceof Error
            ? `${error.message} while parsing weekly candles for ${symbol}`
            : `Invalid candle payload for ${symbol}`
        );
      }
    }
  }

  throw new Error(`History failed for ${symbol}`);
}

async function fetchNoShortNoLongZones(): Promise<ZoneLevels[]> {
  const targetWeek = getCompletedWeekKey();
  // Compute zones for every symbol on the Estimated Moves page (not just the two
  // futures). Each uses its own dxLink weekly-candle symbol via zoneSymbol().
  const configs: Array<{ ticker: string; historySymbol: string }> =
    SYMBOLS.map((ticker) => ({ ticker, historySymbol: zoneSymbol(ticker) }));

  // Resilient: one symbol's upstream 404 (server-v2 has no weekly history for it)
  // must not abort the whole zones refresh. Settle each, skip failures.
  const settled = await Promise.allSettled(configs.map(async ({ ticker, historySymbol }) => {
    const weeklyBars = await fetchWeeklyHistory(historySymbol);
    const exactMatch = weeklyBars.find((item) => getWeekKey(new Date(item.time)) === targetWeek);
    const candidates = weeklyBars.filter((item) => getWeekKey(new Date(item.time)) <= targetWeek);
    const selected = exactMatch || candidates[candidates.length - 1] || weeklyBars[weeklyBars.length - 1];
    if (!selected) throw new Error(`No weekly candles for ${ticker}`);
    return buildZoneLevels(ticker, [selected]);
  }));

  const ok = settled
    .filter((r): r is PromiseFulfilledResult<ZoneLevels> => r.status === "fulfilled")
    .map((r) => r.value);
  settled
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .forEach((r) => console.warn("[EM zones] skipped:", r.reason?.message ?? r.reason));
  return ok;
}

export default function EstimatedMoves() {
  const [activeView, setActiveView] = useState<DashboardView>("estimated");
  const [rows, setRows] = useState<EMRow[]>([]);
  const [zoneLevels, setZoneLevels] = useState<ZoneLevels[]>([]);
  const [status, setStatus] = useState<{ text: string; color: string }>({ text: "Ready", color: "#eef7ff" });
  const [lastSync, setLastSync] = useState("--");
  const [knownExpirations, setKnownExpirations] = useState<string[]>([]);
  const [fridayExpirations, setFridayExpirations] = useState<string[]>([]);
  const [expOverride, setExpOverride] = useState("");
  const [targetDateLabel, setTargetDateLabel] = useState("");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [confidenceScore, setConfidenceScore] = useState<number | null>(null);
  const [tickerStats, setTickerStats] = useState<Record<string, TickerEmStats>>({});

  const dbRef = useRef<IDBDatabase | null>(null);
  const busyRef = useRef(false);
  const bulkSubscribedRef = useRef(false);
  const shotRef = useRef<HTMLDivElement | null>(null);

  const hasCurrentData = activeView === "estimated" ? rows.length > 0 : zoneLevels.length > 0;

  useEffect(() => {
    openDB().then((db) => { dbRef.current = db; });
    setTargetDateLabel(nextFridayLabel());

    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parseExps = (json: any): string[] => {
          let raw: unknown[] = json?.expirations || json?.data?.expirations || json?.data?.items || json?.items || [];
          if (raw.length && typeof raw[0] === "object") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            raw = (raw as any[]).map((e) => e["expiration-date"] || e.expirationDate || e.expiration || e.date || e);
          }
          // Keep any expiration dated today or later. Compare date-only (ET)
          // so a same-day expiration isn't dropped just because the cash
          // session has closed (market-closed / after-hours / weekend).
          const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
          return (raw as string[])
            .filter((e) => typeof e === "string")
            .filter((e) => e.slice(0, 10) >= todayET)
            .sort();
        };

        let exps: string[] = [];
        const r = await fetch(API.expirations("SPX"));
        if (r.ok) exps = parseExps(await r.json());

        if (!exps.length) {
          const cr = await fetch(`/api/chains?ticker=SPX&daysToExpiration=90`);
          if (cr.ok) {
            const opts = normalizeOptions(await cr.json());
            exps = [...new Set(opts.map((o) => o.expiration))]
              .filter((e) => typeof e === "string" && !!e)
              .filter((e) => new Date(e + "T16:00:00") >= new Date())
              .sort();
          }
        }

        if (exps.length) {
          setKnownExpirations(exps);
          const weeklyExps = exps.filter((e) => {
            const day = new Date(e + "T12:00:00").getDay();
            return day === 5 || day === 4;
          });
          setFridayExpirations(weeklyExps.length ? weeklyExps : exps);
          // Title must match the expiration the EM calc actually targets, which
          // prefers Friday (getTargetExpiration) — not merely the first Thu/Fri.
          const first = getTargetExpiration(exps, "") || weeklyExps[0] || exps[0];
          if (first) setTargetDateLabel(labelForDate(first));
        }
      } catch (e) {
        console.warn("prefetchExpirations:", e);
      }
    })();
  }, []);

  useEffect(() => {
    if (drawerOpen && dbRef.current) {
      dbGetAll(dbRef.current).then((all) => {
        setSnapshots(all.filter((snap) => (snap.view ?? "estimated") === activeView));
      });
    }
  }, [drawerOpen, activeView]);

  const refreshEstimatedMoves = useCallback(async () => {
    setRows([]);
    const engine = makeEngine();

    const effectiveExp = getTargetExpiration(knownExpirations, expOverride);
    const settled: EMRow[] = [];

    for (let i = 0; i < SYMBOLS.length; i += 4) {
      const batch = SYMBOLS.slice(i, i + 4);
      setStatus({ text: `Loading ${i + 1}-${Math.min(i + 4, SYMBOLS.length)} / ${SYMBOLS.length}`, color: "#00e5ff" });
      const results = await Promise.allSettled(batch.map((sym) => estimateMove(sym, effectiveExp, engine)));
      results.forEach((result, idx) => {
        settled.push(result.status === "fulfilled"
          ? result.value
          : { ticker: batch[idx], error: (result.reason as Error)?.message || "Unavailable" });
      });
      setRows([...settled]);
      if (i + 4 < SYMBOLS.length) await new Promise((resolve) => setTimeout(resolve, 300));
    }

    const exp = settled.find((row) => row.expiration)?.expiration;
    if (exp) setTargetDateLabel(labelForDate(exp));
    const expLabel = exp ? labelForDate(exp) : nextFridayLabel();

    // Push per-ticker EM levels to /api/levels for the customer-facing /em page.
    // Buy/Sell zone fields are NOT sent here (left untouched by the NULL-aware
    // upsert) — they are pushed from refreshZones for ES/NQ.
    settled
      .filter((row) => !row.error && row.up !== undefined && row.down !== undefined)
      .forEach((row) => {
        const apiTicker = DISPLAY_LABEL[row.ticker] ?? row.ticker;
        fetch("/api/levels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticker: apiTicker,
            label: apiTicker,
            close: row.close !== undefined ? fmtPrice(row.ticker, row.close) : null,
            em: row.em !== undefined ? fmtEm(row.em) : null,
            up: row.up !== undefined ? fmtPrice(row.ticker, row.up) : null,
            down: row.down !== undefined ? fmtPrice(row.ticker, row.down) : null,
            exp_label: expLabel,
          }),
        }).catch((e) => console.warn("[Levels] push failed:", row.ticker, e));
      });

    // Persist UP / DOWN to SQLite (NO LONG / NO SHORT come from zones tab)
    const esmRow = settled.find((r) => r.ticker === "ESM" && r.up && r.down);
    if (esmRow) {
      const fmtStat = (v: number) => Math.round(v).toLocaleString("en-US");
      fetch("/api/es-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expiration: "WEEKLY",
          up:   fmtStat(esmRow.up!),
          down: fmtStat(esmRow.down!),
        }),
      }).catch((e) => console.warn("[ESStats] Failed to persist est moves:", e));
    }

    // Fetch market confidence score (SPX-driven, one value for the session)
    fetch("/api/confidence")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        const s = data?.score?.score ?? data?.score ?? null;
        if (s != null && Number.isFinite(Number(s))) setConfidenceScore(Math.round(Number(s)));
      })
      .catch(() => {});

    // Fetch per-ticker EM history averages using the settled rows (not state,
    // which may not have updated yet). Fire-and-forget after rows are displayed.
    const goodTickers = settled.filter((r) => !r.error && r.em != null).map((r) => r.ticker);
    const statsMap: Record<string, TickerEmStats> = {};
    await Promise.allSettled(
      goodTickers.map((t) =>
        fetch(`/api/em/ticker-em-stats?ticker=${encodeURIComponent(t)}`)
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (data) statsMap[t] = { recentAvg: data.recentAvg ?? null, midAvg: data.midAvg ?? null, sampleSize: data.sampleSize ?? 0 };
          })
          .catch(() => {})
      )
    );
    setTickerStats(statsMap);
  }, [knownExpirations, expOverride]);

  const refreshZones = useCallback(async () => {
    setZoneLevels([]);
    setStatus({ text: "Loading weekly zones", color: "#00e5ff" });
    const levels = await fetchNoShortNoLongZones();
    setZoneLevels(levels);

    // Push buy/sell zones to /api/levels for EVERY symbol's customer lookup.
    // noShort = below pivot = Buy Zone; noLong = above pivot = Sell Zone. The
    // ticker is the raw symbol now; map ESM/NQM to ESU/NQU via DISPLAY_LABEL so
    // it matches the EM push and the customer page.
    levels.forEach((lvl) => {
      const apiTicker = DISPLAY_LABEL[lvl.ticker] ?? lvl.ticker;
      fetch("/api/levels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: apiTicker,
          label: apiTicker,
          pivot: fmtFuture(lvl.pivot),
          buy_near: fmtFuture(lvl.noShortNear),
          buy_far: fmtFuture(lvl.noShortFar),
          sell_near: fmtFuture(lvl.noLongNear),
          sell_far: fmtFuture(lvl.noLongFar),
        }),
      }).catch((e) => console.warn("[Levels] zone push failed:", apiTicker, e));
    });

    // Persist NO LONG, NO SHORT, and MID from ESU zones to SQLite
    const esm = levels.find((l) => l.ticker === "ESM");
    if (esm) {
      const fmtStat = (v: number) => Math.round(v).toLocaleString("en-US");
      const mid = (esm.high + esm.low) / 2;
      // Use nearest expiration as key — same week as estimated moves
      fetch("/api/es-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expiration: "WEEKLY",
          no_long:  fmtStat(esm.noLongNear),
          no_short: fmtStat(esm.noShortNear),
          mid:      fmtStat(mid),
        }),
      }).catch((e) => console.warn("[ESStats] Failed to persist zones:", e));
    }
  }, [knownExpirations, expOverride]);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setStarted(true);
    setStatus({ text: "Syncing", color: "#00e5ff" });

    try {
      if (activeView === "estimated") {
        await refreshEstimatedMoves();
      } else {
        await refreshZones();
      }
      setLastSync(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setStatus({ text: "Live", color: "#00e676" });
    } catch (e) {
      console.error("Refresh failed:", e);
      setStatus({ text: "Error", color: "#ff4757" });
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, [activeView, refreshEstimatedMoves, refreshZones]);

  const saveSnapshot = useCallback(async () => {
    if (!dbRef.current || !hasCurrentData) {
      setStatus({ text: "No data to save", color: "#ff4757" });
      return;
    }

    setStatus({ text: "Saving...", color: "#00e5ff" });
    try {
      await dbSaveSnapshot(dbRef.current, activeView === "estimated"
        ? {
            period: "weekly",
            view: "estimated",
            rows,
            expirations: knownExpirations.slice(0, 3),
            targetDateLabel,
          }
        : {
            period: "weekly-zones",
            view: "zones",
            zoneLevels,
            targetDateLabel: "Last Week",
          });
      setStatus({ text: "Snapshot saved", color: "#00e676" });
      if (drawerOpen && dbRef.current) {
        const all = await dbGetAll(dbRef.current);
        setSnapshots(all.filter((snap) => (snap.view ?? "estimated") === activeView));
      }
    } catch (e) {
      console.error(e);
      setStatus({ text: "Snapshot failed", color: "#ff4757" });
    }
  }, [activeView, drawerOpen, hasCurrentData, knownExpirations, rows, targetDateLabel, zoneLevels]);

  const exportCsv = useCallback(async () => {
    if (!dbRef.current) return;
    setStatus({ text: "Exporting...", color: "#00e5ff" });
    const all = await dbGetAll(dbRef.current).catch(() => [] as Snapshot[]);
    const filtered = all.filter((snap) => (snap.view ?? "estimated") === activeView);
    if (!filtered.length) {
      setStatus({ text: "No snapshots", color: "#ff4757" });
      return;
    }

    const csvRows: string[][] = activeView === "estimated"
      ? [["Date","Time","Period","Ticker","Close","Exp","EM","Up","Down"]]
      : [["Date","Time","Period","Ticker","Open","High","Low","Close","Pivot","Range","NoLong1","NoLong2","NoShort1","NoShort2"]];

    filtered.forEach((snap) => {
      if ((snap.view ?? "estimated") === "estimated") {
        (snap.rows || []).forEach((row) => {
          csvRows.push([
            snap.date,
            snap.time,
            snap.period,
            row.ticker,
            row.close !== undefined ? fmtPrice(row.ticker, row.close) : "",
            row.expiration ? labelForDate(row.expiration) : "",
            row.em !== undefined ? fmtEm(row.em) : "",
            row.up !== undefined ? fmtPrice(row.ticker, row.up) : "",
            row.down !== undefined ? fmtPrice(row.ticker, row.down) : "",
          ]);
        });
      } else {
        (snap.zoneLevels || []).forEach((row) => {
          csvRows.push([
            snap.date,
            snap.time,
            snap.period,
            row.ticker,
            fmtFuture(row.open),
            fmtFuture(row.high),
            fmtFuture(row.low),
            fmtFuture(row.close),
            fmtFuture(row.pivot),
            fmtFuture(row.range),
            fmtFuture(row.noLongNear),
            fmtFuture(row.noLongFar),
            fmtFuture(row.noShortNear),
            fmtFuture(row.noShortFar),
          ]);
        });
      }
    });

    const csv = csvRows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, "\"\"")}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeView === "estimated" ? "estimated-moves" : "no-short-no-long-zones"}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus({ text: "Exported", color: "#00e676" });
  }, [activeView]);

  const deleteSnapshot = useCallback(async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!dbRef.current) return;
    await dbDeleteSnapshot(dbRef.current, id);
    setSnapshots((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const loadSnapshot = useCallback((snap: Snapshot) => {
    const view = snap.view ?? "estimated";
    setActiveView(view);
    setStarted(true);
    if (view === "zones") {
      setZoneLevels(snap.zoneLevels || []);
    } else {
      setRows(snap.rows || []);
      if (snap.targetDateLabel) setTargetDateLabel(snap.targetDateLabel);
    }
    setStatus({ text: `Loaded ${snap.date} ${snap.time}`, color: "#00e676" });
  }, []);

  const copyShot = useCallback(async () => {
    if (!shotRef.current || !hasCurrentData) return;
    setStatus({ text: "Capturing...", color: "#00e5ff" });
    try {
      const html2canvas = await getHtml2Canvas();
      const canvas = await html2canvas(shotRef.current, {
        backgroundColor: "#080c14",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      canvas.toBlob(async (blob: Blob | null) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          setStatus({ text: "Copied!", color: "#00e676" });
        } catch {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${activeView === "estimated" ? "em-shot" : "zones-shot"}-${new Date().toISOString().slice(0, 10)}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          setStatus({ text: "Saved image", color: "#00e676" });
        }
      }, "image/png");
    } catch (e) {
      console.error(e);
      setStatus({ text: "Copy failed", color: "#ff4757" });
    }
  }, [activeView, hasCurrentData]);

  const zoneMap = useMemo(() => {
    const map = new Map<string, ZoneLevels>();
    zoneLevels.forEach((level) => map.set(level.ticker, level));
    return map;
  }, [zoneLevels]);

  const currentSymbols = SYMBOLS;
  const filteredSnapshots = snapshots.filter((snap) => (snap.view ?? "estimated") === activeView);
  const viewTitle = activeView === "estimated" ? "Estimated Moves" : activeView === "tracker" ? "EM Tracker" : "No Short No Long Zones";
  const subTitle = activeView === "estimated" ? "Weekly" : activeView === "tracker" ? "Win / Loss Record" : "Last Week OHLC";

  return (
    <div style={{ ...homeShellStyle, flex: 1, minHeight: 0, overflow: "hidden", height: "100%" }}>
      <div style={{ padding: "7px 16px", background: HT.panelBgStrong, backdropFilter: "blur(16px)", borderBottom: `1px solid ${HT.border}`, flexShrink: 0, display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 10 }}>
            {[
              { id: "estimated" as const, label: "Estimated Moves" },
              { id: "zones" as const, label: "No Short No Long Zones" },
              { id: "tracker" as const, label: "EM Tracker" },
            ].map((tab) => {
              const active = activeView === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveView(tab.id)}
                  style={{
                    background: active ? "rgba(0,229,255,0.15)" : "transparent",
                    border: `1px solid ${active ? "rgba(0,229,255,.4)" : HT.border}`,
                    color: active ? "#eef7ff" : "#7ab8ff",
                    fontSize: 12,
                    padding: "6px 10px",
                    borderRadius: 2,
                    cursor: "pointer",
                    fontWeight: 700,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <span style={{ fontSize: 15, fontWeight: 700, color: "#00e5ff", letterSpacing: ".15em", textTransform: "uppercase" }}>{viewTitle}</span>
          <span style={{ fontSize: 12, color: "#eef7ff", letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 700 }}>{subTitle}</span>
          <span style={{ fontSize: 12, color: "#eef7ff", letterSpacing: ".12em", textTransform: "uppercase" }}>
            {activeView === "estimated" ? targetDateLabel : activeView === "tracker" ? "" : "Last Completed Week"}
          </span>

          {activeView === "estimated" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 12 }}>
              <span style={{ fontSize: 11, color: "#eef7ff", letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 700 }}>Expiration</span>
              <select
                value={expOverride}
                onChange={(e) => { setExpOverride(e.target.value); bulkSubscribedRef.current = false; }}
                style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${HT.border}`, color: HT.text, fontSize: 12, padding: "5px 8px", borderRadius: 4, cursor: "pointer", fontWeight: 700, letterSpacing: ".06em", outline: "none", minWidth: 180 }}
              >
                <option value="">-- Auto --</option>
                {fridayExpirations.map((exp) => (
                  <option key={exp} value={exp}>{labelForDate(exp)} ({daysTo(exp)}d)</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: status.color }}>{status.text}</span>
          <button onClick={refresh} disabled={loading} style={{ ...homeButtonStyle, opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
            {started ? "Refresh" : "Start"}
          </button>
          <button onClick={saveSnapshot} disabled={!hasCurrentData} style={{ ...homeButtonStyle, opacity: hasCurrentData ? 1 : 0.4, cursor: hasCurrentData ? "pointer" : "not-allowed" }}>
            Save
          </button>
          <button onClick={exportCsv} style={{ ...homeButtonStyle }}>
            Export
          </button>
          <button onClick={copyShot} disabled={!hasCurrentData} style={{ ...homeButtonStyle, opacity: hasCurrentData ? 1 : 0.4, cursor: hasCurrentData ? "pointer" : "not-allowed" }}>
            Copy Shot
          </button>
        </div>
      </div>

      {activeView === "tracker" ? (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 18 }}>
          <EmTrackerAdmin />
        </div>
      ) : (
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <div style={{ width: 230, minWidth: 230, flexShrink: 0, background: HT.panelBg, backdropFilter: "blur(8px)", borderRight: `1px solid ${HT.border}`, boxSizing: "border-box", overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${HT.border}`, flexShrink: 0 }}>
            <div style={{ fontSize: 9, color: "#eef7ff", letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 700, marginBottom: 4 }}>Last Sync</div>
            <div style={{ fontSize: 13, color: "#e8edf5", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{lastSync}</div>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            <button onClick={() => setDrawerOpen((open) => !open)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: "transparent", border: "none", borderBottom: `1px solid ${HT.border}`, cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, color: "#eef7ff", display: "inline-block", transform: drawerOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s" }}>{">"}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#e8edf5", letterSpacing: ".08em", textTransform: "uppercase" }}>
                  {activeView === "estimated" ? "Weekly" : "Zones"}
                </span>
              </div>
              <span style={{ fontSize: 10, color: HT.text, background: HT.panelBg, border: `1px solid ${HT.border}`, padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>{filteredSnapshots.length}</span>
            </button>

            {drawerOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 1, background: HT.bg }}>
                {filteredSnapshots.length === 0 ? (
                  <div style={{ padding: "10px 14px", fontSize: 11, color: "#eef7ff" }}>No snapshots</div>
                ) : filteredSnapshots.map((snap) => (
                  <div key={snap.id} onClick={() => loadSnapshot(snap)} style={{ padding: "8px 14px", cursor: "pointer", borderBottom: `1px solid ${HT.border}`, background: HT.panelBg, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#e8edf5", fontWeight: 700 }}>{snap.date}</div>
                      <div style={{ fontSize: 10, color: "#eef7ff", fontVariantNumeric: "tabular-nums" }}>{snap.time}</div>
                    </div>
                    <button onClick={(e) => deleteSnapshot(e, snap.id!)} style={{ background: "none", border: "none", color: "#eef7ff", fontSize: 14, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ padding: "10px 14px", borderTop: `1px solid ${HT.border}`, flexShrink: 0 }}>
            <div style={{ fontSize: 9, color: "#eef7ff", letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Symbols</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {currentSymbols.map((symbol) => (
                <span key={symbol} style={{ fontSize: 11, color: HT.text, background: HT.panelBg, border: `1px solid ${HT.border}`, padding: "3px 6px", borderRadius: 4 }}>{DISPLAY_LABEL[symbol] ?? symbol}</span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 18 }}>
          {activeView === "estimated" ? (
            <div style={{ width: "100%", maxWidth: 1100, margin: "0 auto", background: HT.panelBg, backdropFilter: "blur(16px)", border: `1px solid ${HT.border}`, borderRadius: 8, boxShadow: "0 18px 50px rgba(0,0,0,.35)" }}>
              <div style={{ borderBottom: `1px solid ${HT.border}`, background: "rgba(0,240,255,0.04)", padding: "10px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#eef7ff", letterSpacing: ".16em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
                  <span>Weekly Estimated Move For <span style={{ color: "#00e5ff" }}>{targetDateLabel || "--"}</span></span>
                  {confidenceScore != null && (
                    <span style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: ".1em",
                      padding: "3px 10px",
                      borderRadius: 4,
                      border: `1px solid ${confidenceScore >= 70 ? "rgba(0,230,118,.4)" : confidenceScore >= 45 ? "rgba(255,193,7,.4)" : "rgba(255,71,87,.4)"}`,
                      background: confidenceScore >= 70 ? "rgba(0,230,118,.1)" : confidenceScore >= 45 ? "rgba(255,193,7,.1)" : "rgba(255,71,87,.1)",
                      color: confidenceScore >= 70 ? "#00e676" : confidenceScore >= 45 ? "#ffc107" : "#ff4757",
                    }}>
                      MVC CONF {confidenceScore}%
                    </span>
                  )}
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16 }}>
                  <thead style={{ background: HT.panelBgStrong }}>
                    <tr style={{ borderBottom: `1px solid ${HT.border}`, color: "#00e5ff", textAlign: "center", fontSize: 13, letterSpacing: ".12em", textTransform: "uppercase" }}>
                      {["Ticker","Close","Exp","EM","Up","Down","vs 4-Wk","vs 12-Wk"].map((header, idx) => (
                        <th key={header} style={{ padding: 10, borderRight: idx < 7 ? `1px solid ${HT.border}` : undefined }}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody style={{ fontFamily: "Consolas, Monaco, monospace" }}>
                    {!started ? (
                      <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: "#eef7ff" }}>Click Start to load estimated moves</td></tr>
                    ) : rows.length === 0 ? (
                      <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "#eef7ff" }}>Loading...</td></tr>
                    ) : rows.map((row) => {
                      const stats = tickerStats[row.ticker];
                      const em = row.em;
                      const renderAvgCell = (avg: number | null, label: string) => {
                        if (!em || !avg || !Number.isFinite(avg)) {
                          return <td style={{ padding: 8, borderRight: label === "4wk" ? `1px solid ${HT.border}` : undefined, color: "#eef7ff", fontSize: 12 }}>--</td>;
                        }
                        const diff = em - avg;
                        const pct = (diff / avg) * 100;
                        const isHigher = diff > 0;
                        const color = isHigher ? "#00e676" : "#ff4757";
                        const arrow = isHigher ? "▲" : "▼";
                        return (
                          <td style={{ padding: 8, borderRight: label === "4wk" ? `1px solid ${HT.border}` : undefined, fontSize: 12 }}>
                            <span style={{ color, fontWeight: 700 }}>{arrow} {Math.abs(pct).toFixed(1)}%</span>
                          </td>
                        );
                      };
                      return (
                        <tr key={row.ticker} title={row.error || ""} style={{ textAlign: "center", borderBottom: `1px solid ${HT.border}`, opacity: row.error ? 0.55 : 1 }}>
                          <td style={{ padding: 8, borderRight: `1px solid ${HT.border}`, fontWeight: 700, color: "#e8edf5" }}>{DISPLAY_LABEL[row.ticker] ?? row.ticker}</td>
                          <td style={{ padding: 8, borderRight: `1px solid ${HT.border}`, color: "#eef7ff" }}>{fmtPrice(row.ticker, row.close)}</td>
                          <td style={{ padding: 8, borderRight: `1px solid ${HT.border}`, color: "#eef7ff" }}>{row.expiration ? labelForDate(row.expiration) : ""}</td>
                          <td style={{ padding: 8, borderRight: `1px solid ${HT.border}`, color: "#e8c060" }}>{fmtEm(row.em)}</td>
                          <td style={{ padding: 8, borderRight: `1px solid ${HT.border}`, color: "#00e676" }}>{fmtPrice(row.ticker, row.up)}</td>
                          <td style={{ padding: 8, borderRight: `1px solid ${HT.border}`, color: "#ff4757" }}>{fmtPrice(row.ticker, row.down)}</td>
                          {renderAvgCell(stats?.recentAvg ?? null, "4wk")}
                          {renderAvgCell(stats?.midAvg ?? null, "12wk")}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ width: "100%", maxWidth: 980, margin: "0 auto", background: HT.panelBg, backdropFilter: "blur(16px)", border: `1px solid ${HT.border}`, borderRadius: 8, boxShadow: "0 18px 50px rgba(0,0,0,.35)" }}>
              <div style={{ borderBottom: `1px solid ${HT.border}`, background: "rgba(0,240,255,0.04)", padding: "10px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#eef7ff", letterSpacing: ".08em", textTransform: "uppercase" }}>
                  No Short / No Long Zones <span style={{ color: "#eef7ff" }}>· Last Week Candle</span>
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                {!started ? (
                  <div style={{ padding: 30, textAlign: "center", color: "#eef7ff" }}>Click Start to load last week OHLC and zones</div>
                ) : zoneLevels.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: "#eef7ff" }}>Loading...</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
                    <thead style={{ background: HT.panelBgStrong }}>
                      <tr style={{ borderBottom: `1px solid ${HT.border}`, color: "#00e5ff", textAlign: "center", fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase" }}>
                        {["Ticker", "Close", "Pivot", "Range", "No Long", "No Short"].map((header, idx) => (
                          <th key={header} style={{ padding: 10, borderRight: idx < 5 ? `1px solid ${HT.border}` : undefined }}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody style={{ fontFamily: "Consolas, Monaco, monospace" }}>
                      {SYMBOLS.map((sym) => {
                        const row = zoneMap.get(sym);
                        const label = DISPLAY_LABEL[sym] ?? sym;
                        if (!row) {
                          return (
                            <tr key={sym} style={{ textAlign: "center", borderBottom: `1px solid ${HT.border}`, opacity: 0.4 }}>
                              <td style={{ padding: 8, borderRight: `1px solid ${HT.border}`, fontWeight: 700, color: "#e8edf5" }}>{label}</td>
                              <td colSpan={5} style={{ padding: 8, color: "#eef7ff", fontStyle: "italic" }}>no weekly candle</td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={sym} style={{ textAlign: "center", borderBottom: `1px solid ${HT.border}` }}>
                            <td style={{ padding: 8, borderRight: `1px solid ${HT.border}`, fontWeight: 700, color: "#e8edf5" }}>{label}</td>
                            <td style={{ padding: 8, borderRight: `1px solid ${HT.border}`, color: "#eef7ff" }}>{fmtFuture(row.close)}</td>
                            <td style={{ padding: 8, borderRight: `1px solid ${HT.border}`, color: "#eef7ff" }}>{fmtFuture(row.pivot)}</td>
                            <td style={{ padding: 8, borderRight: `1px solid ${HT.border}`, color: "#eef7ff" }}>{fmtFuture(row.range)}</td>
                            <td style={{ padding: 8, borderRight: `1px solid ${HT.border}`, color: "#ff4757" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                <span>{fmtFuture(row.noLongNear)}</span>
                                <span style={{ opacity: 0.65 }}>{fmtFuture(row.noLongFar)}</span>
                              </div>
                            </td>
                            <td style={{ padding: 8, color: "#00e676" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                <span>{fmtFuture(row.noShortNear)}</span>
                                <span style={{ opacity: 0.65 }}>{fmtFuture(row.noShortFar)}</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      <div ref={shotRef} style={{ position: "fixed", top: 0, left: "-9999px", background: "#080c14", padding: "0 0 12px 0", width: 420, fontFamily: "Arial, sans-serif" }}>
        {activeView === "estimated" ? (
          <>
            <div style={{ background: "#0b111b", padding: "14px 0", textAlign: "center", borderBottom: "2px solid #1a2a3a" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#eef7ff", letterSpacing: ".16em", textTransform: "uppercase" }}>Weekly Estimated Move For</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#00e5ff", letterSpacing: ".1em", marginTop: 2 }}>{targetDateLabel || "--"}</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: "#0a0f18", borderBottom: `1px solid ${HT.border}` }}>
              {["Ticker","Up","Down"].map((header) => (
                <div key={header} style={{ padding: "8px 0", textAlign: "center", fontSize: 12, fontWeight: 700, color: "#00e5ff", letterSpacing: ".12em" }}>{header}</div>
              ))}
            </div>

            {rows.slice(0, 13).filter((row) => !row.error).map((row) => (
              <div key={row.ticker} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: `1px solid ${HT.border}` }}>
                <div style={{ padding: "9px 0", textAlign: "center", fontWeight: 700, color: "#e8edf5", fontSize: 15 }}>{DISPLAY_LABEL[row.ticker] ?? row.ticker}</div>
                <div style={{ padding: "9px 0", textAlign: "center", color: "#00e676", fontSize: 15 }}>{fmtPrice(row.ticker, row.up)}</div>
                <div style={{ padding: "9px 0", textAlign: "center", color: "#ff4757", fontSize: 15 }}>{fmtPrice(row.ticker, row.down)}</div>
              </div>
            ))}

            <div style={{ padding: "8px 0", textAlign: "center", fontSize: 11, color: "#eef7ff", letterSpacing: ".18em", textTransform: "uppercase", borderBottom: `1px solid ${HT.border}`, borderTop: `1px solid ${HT.border}`, background: "#04070c" }}>
              x.com/bzilatrades
            </div>

            {rows.slice(13).filter((row) => !row.error).map((row) => (
              <div key={row.ticker} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: `1px solid ${HT.border}` }}>
                <div style={{ padding: "9px 0", textAlign: "center", fontWeight: 700, color: "#e8edf5", fontSize: 15 }}>{DISPLAY_LABEL[row.ticker] ?? row.ticker}</div>
                <div style={{ padding: "9px 0", textAlign: "center", color: "#00e676", fontSize: 15 }}>{fmtPrice(row.ticker, row.up)}</div>
                <div style={{ padding: "9px 0", textAlign: "center", color: "#ff4757", fontSize: 15 }}>{fmtPrice(row.ticker, row.down)}</div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div style={{ background: "#0b111b", padding: "14px 0", textAlign: "center", borderBottom: "2px solid #1a2a3a" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#eef7ff", letterSpacing: ".08em", textTransform: "uppercase" }}>No Short / No Long Zones</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: "#0a0f18", borderBottom: `1px solid ${HT.border}` }}>
              {["Ticker", "No Short", "No Long"].map((header) => (
                <div key={header} style={{ padding: "8px 0", textAlign: "center", fontSize: 12, fontWeight: 700, color: "#00e5ff", letterSpacing: ".1em" }}>{header}</div>
              ))}
            </div>

            {SYMBOLS.map((sym) => {
              const row = zoneMap.get(sym);
              if (!row) return null;
              return (
                <div key={sym} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: `1px solid ${HT.border}` }}>
                  <div style={{ padding: "8px 0", textAlign: "center", fontWeight: 700, color: "#e8edf5", fontSize: 14 }}>{DISPLAY_LABEL[sym] ?? sym}</div>
                  <div style={{ padding: "8px 0", textAlign: "center", color: "#00e676", fontSize: 14 }}>{fmtFuture(row.noShortNear)}</div>
                  <div style={{ padding: "8px 0", textAlign: "center", color: "#ff4757", fontSize: 14 }}>{fmtFuture(row.noLongNear)}</div>
                </div>
              );
            })}

            <div style={{ padding: "8px 0", textAlign: "center", fontSize: 11, color: "#eef7ff", letterSpacing: ".18em", textTransform: "uppercase", borderTop: `1px solid ${HT.border}`, background: "#04070c" }}>
              x.com/bzilatrades
            </div>
          </>
        )}
      </div>
    </div>
  );
}
