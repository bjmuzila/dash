"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

async function getHtml2Canvas() {
  const mod = await import("html2canvas" as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).default ?? mod;
}

type DashboardView = "estimated" | "zones";

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
  ticker: "ESM6" | "NQM6";
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

const API_SYMBOL: Record<string, string> = {
  ESM: "/ES:XCME", NQM: "/NQ:XCME", SPX: "$SPX", NDX: "$NDX",
};
const CHAIN_SYMBOL: Record<string, string> = { SPX: "$SPX", NDX: "$NDX" };
const FUTURE_PROXY: Record<string, string> = { ESM: "SPX", NQM: "NDX" };
const QUOTE_SYMBOLS = Array.from(new Set([
  ...SYMBOLS,
  ...Object.values(API_SYMBOL),
  "/ESM6",
  "/NQM6",
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
  subscriptionReady: () => `/api/proxy/subscription-ready`,
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
    ESM: ["/ESM6", "/ES:XCME", "/ES"],
    NQM: ["/NQM6", "/NQ:XCME", "/NQ"],
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
  const q = quotes[dxSym] || quotes[ticker]
    || quotes[String(dxSym).replace(/^\//, "")]
    || quotes[String(ticker).replace(/^\//, "")];
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
  if (!Number.isFinite(close) || close <= 0) throw new Error(`Invalid price for ${ticker}: ${close}`);
  return { quote: q, close, prevClose };
}

const metricsIvCache: Record<string, Record<string, number>> = {};

async function fetchMetricsIv(ticker: string, targetExp: string): Promise<number> {
  if (metricsIvCache[ticker]?.[targetExp] != null) return metricsIvCache[ticker][targetExp];
  try {
    const r = await fetch(`/api/proxy/tt/quote/${encodeURIComponent(ticker)}`);
    if (!r.ok) return 0;
    const json = await r.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expiryIvs: any[] = json?.data?.items?.[0]?.["option-expiration-implied-volatilities"] ?? [];
    if (!metricsIvCache[ticker]) metricsIvCache[ticker] = {};
    expiryIvs.forEach((e: any) => {
      const iv = Number(e["implied-volatility"] ?? 0);
      if (e["expiration-date"] && iv > 0) metricsIvCache[ticker][e["expiration-date"]] = iv;
    });
    return metricsIvCache[ticker][targetExp] ?? 0;
  } catch {
    return 0;
  }
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
  const { close, prevClose } = await fetchQuoteDetail(ticker, engine);
  if (!Number.isFinite(close) || close <= 0) throw new Error("No quote");
  if (!targetExp) throw new Error("No expiration selected");

  const isFuture = FUTURE_PROXY[ticker];
  const lookupSym = isFuture ? FUTURE_PROXY[ticker] : (CHAIN_SYMBOL[ticker] || ticker);
  const chainSym = (lookupSym || "SPX").replace(/^\$/, "");

  const chainUrl = API.chain(chainSym, targetExp, "&noSubscribe=1&forceSub=1");
  const chain = await Promise.race([
    fetch(chainUrl).then((r) => r.ok ? r.json() : { options: [] }).catch(() => ({ options: [] })),
    new Promise<{ options: [] }>((res) => setTimeout(() => res({ options: [] }), 10000)),
  ]);

  const options = normalizeOptions(chain);
  let expOptions = options.filter((o) => o.expiration === targetExp);
  if (!expOptions.length) throw new Error("No options for expiration");

  if (expOptions.every((o) => Number(o.iv || 0) === 0)) {
    const direct = await fetchChainDirect(chainSym, targetExp, engine);
    if (direct) expOptions = direct;
  }

  const indexQuote = isFuture ? await fetchQuoteDetail(lookupSym, engine) : null;
  const indexClose = isFuture ? (indexQuote!.prevClose > 0 ? indexQuote!.prevClose : indexQuote!.close) : close;

  const allIvZero = expOptions.every((o) => Number(o.iv || 0) === 0);
  const metricsIv = allIvZero ? await fetchMetricsIv(chainSym, targetExp) : 0;

  const strikes = [...new Set(expOptions.map((o) => o.strike))]
    .sort((a, b) => Math.abs(a - indexClose) - Math.abs(b - indexClose));

  if (!strikes.length || (allIvZero && metricsIv > 0 && expOptions.length === 0)) {
    if (metricsIv > 0) {
      const dte = daysTo(targetExp);
      const em = 0.84 * metricsIv * indexClose * Math.sqrt(dte / 365);
      if (Number.isFinite(em) && em > 0) {
        return { ticker, close, em, up: indexClose + em, down: indexClose - em, expiration: targetExp, strike: Math.round(indexClose) };
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

    const candidateDte = c.dte || p.dte || daysTo(targetExp);
    let avgIV = (Number(c.iv || 0) + Number(p.iv || 0)) / 2;

    if (avgIV === 0 && metricsIv > 0) avgIV = metricsIv;

    let candidateEm = 0;

    if (avgIV > 0 && candidateDte > 0) {
      candidateEm = 0.84 * avgIV * indexClose * Math.sqrt(candidateDte / 365);
    } else {
      if (!(c.bid > 0 && c.ask > 0) || !(p.bid > 0 && p.ask > 0)) {
        if (c.symbol || p.symbol) {
          const marks = await fetchOptionMarks([c.symbol, p.symbol].filter(Boolean));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (marks[c.symbol]) c = Object.assign({}, c, marks[c.symbol] as any);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (marks[p.symbol]) p = Object.assign({}, p, marks[p.symbol] as any);
          avgIV = (Number(c?.iv || 0) + Number(p?.iv || 0)) / 2;
        }
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

  const basis = isFuture ? close - indexClose : 0;
  void prevClose;
  return { ticker, close, em, up: indexClose + em + basis, down: indexClose - em + basis, expiration: targetExp, strike };
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
  const configs: Array<{ ticker: ZoneLevels["ticker"]; historySymbol: string }> = [
    { ticker: "ESM6", historySymbol: "/ES{=w}" },
    { ticker: "NQM6", historySymbol: "/NQ{=w}" },
  ];

  return Promise.all(configs.map(async ({ ticker, historySymbol }) => {
    const weeklyBars = await fetchWeeklyHistory(historySymbol);
    const exactMatch = weeklyBars.find((item) => getWeekKey(new Date(item.time)) === targetWeek);
    const candidates = weeklyBars.filter((item) => getWeekKey(new Date(item.time)) <= targetWeek);
    const selected = exactMatch || candidates[candidates.length - 1] || weeklyBars[weeklyBars.length - 1];
    if (!selected) throw new Error(`No weekly candles for ${ticker}`);
    return buildZoneLevels(ticker, [selected]);
  }));
}

export default function EstimatedMoves() {
  const [activeView, setActiveView] = useState<DashboardView>("estimated");
  const [rows, setRows] = useState<EMRow[]>([]);
  const [zoneLevels, setZoneLevels] = useState<ZoneLevels[]>([]);
  const [status, setStatus] = useState<{ text: string; color: string }>({ text: "Ready", color: "#5a7a99" });
  const [lastSync, setLastSync] = useState("--");
  const [knownExpirations, setKnownExpirations] = useState<string[]>([]);
  const [fridayExpirations, setFridayExpirations] = useState<string[]>([]);
  const [expOverride, setExpOverride] = useState("");
  const [targetDateLabel, setTargetDateLabel] = useState("");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);

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
          return (raw as string[])
            .filter((e) => typeof e === "string")
            .filter((e) => new Date(e + "T16:00:00") >= new Date())
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
          const first = weeklyExps[0] || exps[0];
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

    if (!bulkSubscribedRef.current) {
      try {
        setStatus({ text: "Subscribing...", color: "#00e5ff" });
        await fetch(API.subscriptionReady(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pageId: "em-" + Date.now(),
            symbols: ["SPX","VIX","ESM","NQM","SPY","QQQ","SMH","AAPL","AMD","AMZN",
              "GOOGL","META","MSFT","NVDA","TSLA","COIN","HOOD","IWM","NFLX","PLTR","NDX"],
            timeout: 4000, threshold: 0.7,
          }),
        });
        bulkSubscribedRef.current = true;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (e) {
        console.warn("Subscribe failed:", e);
      }
    }

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

    // Persist UP / DOWN to SQLite (NO LONG / NO SHORT come from zones tab)
    const esmRow = settled.find((r) => r.ticker === "ESM" && r.up && r.down);
    if (esmRow && esmRow.expiration) {
      const fmtStat = (v: number) => Math.round(v).toLocaleString("en-US");
      fetch("/api/es-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expiration: esmRow.expiration,
          up:   fmtStat(esmRow.up!),
          down: fmtStat(esmRow.down!),
        }),
      }).catch((e) => console.warn("[ESStats] Failed to persist est moves:", e));
    }
  }, [knownExpirations, expOverride]);

  const refreshZones = useCallback(async () => {
    setZoneLevels([]);
    setStatus({ text: "Loading weekly zones", color: "#00e5ff" });
    const levels = await fetchNoShortNoLongZones();
    setZoneLevels(levels);

    // Persist NO LONG, NO SHORT, and MID from ESM zones to SQLite
    const esm = levels.find((l) => l.ticker === "ESM6");
    if (esm) {
      const fmtStat = (v: number) => Math.round(v).toLocaleString("en-US");
      const mid = (esm.high + esm.low) / 2;
      // Use nearest expiration as key — same week as estimated moves
      const targetExp = getTargetExpiration(knownExpirations, expOverride)
        || new Date().toISOString().slice(0, 10);
      fetch("/api/es-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expiration: targetExp,
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

  const currentSymbols = activeView === "estimated" ? SYMBOLS : ["ESM6", "NQM6"];
  const filteredSnapshots = snapshots.filter((snap) => (snap.view ?? "estimated") === activeView);
  const viewTitle = activeView === "estimated" ? "Estimated Moves" : "No Short No Long Zones";
  const subTitle = activeView === "estimated" ? "Weekly" : "Last Week OHLC";

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden", background: "#080c14", height: "100%" }}>
      <div style={{ padding: "7px 16px", background: "#0b111b", borderBottom: "1px solid #1a2a3a", flexShrink: 0, display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 10 }}>
            {[
              { id: "estimated" as const, label: "Estimated Moves" },
              { id: "zones" as const, label: "No Short No Long Zones" },
            ].map((tab) => {
              const active = activeView === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveView(tab.id)}
                  style={{
                    background: active ? "#0d2b46" : "#0a1628",
                    border: `1px solid ${active ? "#2d6da3" : "#1e3a5f"}`,
                    color: active ? "#eef7ff" : "#7ab8ff",
                    fontSize: 12,
                    padding: "6px 10px",
                    borderRadius: 2,
                    cursor: "pointer",
                    fontFamily: "Arial",
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
          <span style={{ fontSize: 12, color: "#3a5570", letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 700 }}>{subTitle}</span>
          <span style={{ fontSize: 12, color: "#7ab8ff", letterSpacing: ".12em", textTransform: "uppercase" }}>
            {activeView === "estimated" ? targetDateLabel : "Last Completed Week"}
          </span>

          {activeView === "estimated" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 12 }}>
              <span style={{ fontSize: 11, color: "#3a5570", letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 700 }}>Expiration</span>
              <select
                value={expOverride}
                onChange={(e) => { setExpOverride(e.target.value); bulkSubscribedRef.current = false; }}
                style={{ background: "#04070c", border: "1px solid #1e3a5f", color: "#7ab8ff", fontSize: 12, padding: "5px 8px", borderRadius: 2, cursor: "pointer", fontFamily: "Arial", fontWeight: 700, letterSpacing: ".06em", outline: "none", minWidth: 180 }}
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
          <button onClick={refresh} disabled={loading} style={{ background: "#0a1628", border: "1px solid #1e3a5f", color: "#00e5ff", fontSize: 13, padding: "7px 12px", borderRadius: 2, cursor: loading ? "not-allowed" : "pointer", fontFamily: "Arial", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", opacity: loading ? 0.6 : 1 }}>
            {started ? "Refresh" : "Start"}
          </button>
          <button onClick={saveSnapshot} disabled={!hasCurrentData} style={{ background: "#0a1628", border: "1px solid #1e3a5f", color: "#00e5ff", fontSize: 13, padding: "7px 12px", borderRadius: 2, cursor: hasCurrentData ? "pointer" : "not-allowed", fontFamily: "Arial", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", opacity: hasCurrentData ? 1 : 0.4 }}>
            Save
          </button>
          <button onClick={exportCsv} style={{ background: "#0a1628", border: "1px solid #1e3a5f", color: "#00e5ff", fontSize: 13, padding: "7px 12px", borderRadius: 2, cursor: "pointer", fontFamily: "Arial", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>
            Export
          </button>
          <button onClick={copyShot} disabled={!hasCurrentData} style={{ background: "#0a1628", border: "1px solid #1e3a5f", color: "#00e5ff", fontSize: 13, padding: "7px 12px", borderRadius: 2, cursor: hasCurrentData ? "pointer" : "not-allowed", fontFamily: "Arial", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", opacity: hasCurrentData ? 1 : 0.4 }}>
            Copy Shot
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <div style={{ width: 230, minWidth: 230, flexShrink: 0, background: "#04070c", borderRight: "1px solid #0d1825", boxSizing: "border-box", overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #0d1825", flexShrink: 0 }}>
            <div style={{ fontSize: 9, color: "#3a5570", letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 700, marginBottom: 4 }}>Last Sync</div>
            <div style={{ fontSize: 13, color: "#e8edf5", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{lastSync}</div>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            <button onClick={() => setDrawerOpen((open) => !open)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: "transparent", border: "none", borderBottom: "1px solid #0d1825", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, color: "#5a7a99", display: "inline-block", transform: drawerOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s" }}>{">"}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#e8edf5", letterSpacing: ".08em", textTransform: "uppercase" }}>
                  {activeView === "estimated" ? "Weekly" : "Zones"}
                </span>
              </div>
              <span style={{ fontSize: 10, color: "#7ab8ff", background: "#07111d", border: "1px solid #1a2a3a", padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>{filteredSnapshots.length}</span>
            </button>

            {drawerOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "#020407" }}>
                {filteredSnapshots.length === 0 ? (
                  <div style={{ padding: "10px 14px", fontSize: 11, color: "#3a5570" }}>No snapshots</div>
                ) : filteredSnapshots.map((snap) => (
                  <div key={snap.id} onClick={() => loadSnapshot(snap)} style={{ padding: "8px 14px", cursor: "pointer", borderBottom: "1px solid #0d1825", background: "#04070c", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#e8edf5", fontWeight: 700 }}>{snap.date}</div>
                      <div style={{ fontSize: 10, color: "#7ab8ff", fontVariantNumeric: "tabular-nums" }}>{snap.time}</div>
                    </div>
                    <button onClick={(e) => deleteSnapshot(e, snap.id!)} style={{ background: "none", border: "none", color: "#5a7a99", fontSize: 14, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ padding: "10px 14px", borderTop: "1px solid #0d1825", flexShrink: 0 }}>
            <div style={{ fontSize: 9, color: "#3a5570", letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Symbols</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {currentSymbols.map((symbol) => (
                <span key={symbol} style={{ fontSize: 11, color: "#7ab8ff", background: "#07111d", border: "1px solid #13253a", padding: "3px 6px", borderRadius: 2 }}>{symbol}</span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 18 }}>
          {activeView === "estimated" ? (
            <div style={{ width: "100%", maxWidth: 980, margin: "0 auto", background: "#0b111b", border: "1px solid #1a2a3a", boxShadow: "0 18px 50px rgba(0,0,0,.35)" }}>
              <div style={{ borderBottom: "1px solid #1a2a3a", background: "#0e1522", padding: "10px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#a8b8cc", letterSpacing: ".16em", textTransform: "uppercase" }}>
                  Weekly Estimated Move For <span style={{ color: "#00e5ff" }}>{targetDateLabel || "--"}</span>
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16 }}>
                  <thead style={{ background: "#0a0f18" }}>
                    <tr style={{ borderBottom: "1px solid #1a2a3a", color: "#00e5ff", textAlign: "center", fontSize: 13, letterSpacing: ".12em", textTransform: "uppercase" }}>
                      {["Ticker","Close","Exp","EM","Up","Down"].map((header, idx) => (
                        <th key={header} style={{ padding: 10, borderRight: idx < 5 ? "1px solid #1a2a3a" : undefined }}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody style={{ fontFamily: "Consolas, Monaco, monospace" }}>
                    {!started ? (
                      <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: "#3a5570" }}>Click Start to load estimated moves</td></tr>
                    ) : rows.length === 0 ? (
                      <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#3a5570" }}>Loading...</td></tr>
                    ) : rows.map((row) => (
                      <tr key={row.ticker} title={row.error || ""} style={{ textAlign: "center", borderBottom: "1px solid #121b2a", opacity: row.error ? 0.55 : 1 }}>
                        <td style={{ padding: 8, borderRight: "1px solid #1a2a3a", fontWeight: 700, color: "#e8edf5" }}>{row.ticker}</td>
                        <td style={{ padding: 8, borderRight: "1px solid #1a2a3a", color: "#cbd5e1" }}>{fmtPrice(row.ticker, row.close)}</td>
                        <td style={{ padding: 8, borderRight: "1px solid #1a2a3a", color: "#7ab8ff" }}>{row.expiration ? labelForDate(row.expiration) : ""}</td>
                        <td style={{ padding: 8, borderRight: "1px solid #1a2a3a", color: "#e8c060" }}>{fmtEm(row.em)}</td>
                        <td style={{ padding: 8, borderRight: "1px solid #1a2a3a", color: "#00e676" }}>{fmtPrice(row.ticker, row.up)}</td>
                        <td style={{ padding: 8, color: "#ff4757" }}>{fmtPrice(row.ticker, row.down)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ width: "100%", maxWidth: 760, margin: "0 auto", background: "#0b111b", border: "1px solid #1a2a3a", boxShadow: "0 18px 50px rgba(0,0,0,.35)" }}>
              <div style={{ borderBottom: "1px solid #1a2a3a", background: "#0e1522", padding: "10px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#eef7ff", letterSpacing: ".08em", textTransform: "uppercase" }}>
                  ES/NQ Last Week Candle
                </div>
              </div>
              <div style={{ padding: 14 }}>
                {!started ? (
                  <div style={{ padding: 30, textAlign: "center", color: "#3a5570" }}>Click Start to load last week OHLC and zones</div>
                ) : zoneLevels.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: "#3a5570" }}>Loading...</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Consolas, Monaco, monospace", fontSize: 18 }}>
                    <thead>
                      <tr style={{ color: "#00e5ff", textTransform: "uppercase", letterSpacing: ".1em", fontSize: 13 }}>
                        <th style={{ width: "26%", padding: "10px 8px", border: "1px solid #1a2a3a" }}>Info</th>
                        <th style={{ width: "37%", padding: "10px 8px", border: "1px solid #1a2a3a" }}>ESM6</th>
                        <th style={{ width: "37%", padding: "10px 8px", border: "1px solid #1a2a3a" }}>NQM6</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "Open", render: (row: ZoneLevels) => fmtFuture(row.open) },
                        { label: "High", render: (row: ZoneLevels) => fmtFuture(row.high) },
                        { label: "Low", render: (row: ZoneLevels) => fmtFuture(row.low) },
                        { label: "Close", render: (row: ZoneLevels) => fmtFuture(row.close) },
                        { label: "", spacer: true },
                        { label: "Pivot", render: (row: ZoneLevels) => fmtFuture(row.pivot) },
                        { label: "Range", render: (row: ZoneLevels) => fmtFuture(row.range) },
                        { label: "", spacer: true },
                        { label: "No Long", renderStack: (row: ZoneLevels) => [fmtFuture(row.noLongNear), fmtFuture(row.noLongFar)] },
                        { label: "", spacer: true },
                        { label: "No Short", renderStack: (row: ZoneLevels) => [fmtFuture(row.noShortNear), fmtFuture(row.noShortFar)] },
                      ].map((def, idx) => {
                        if (def.spacer) {
                          return (
                            <tr key={`spacer-${idx}`}>
                              <td style={{ height: 20 }} />
                              <td />
                              <td />
                            </tr>
                          );
                        }
                        const es = zoneMap.get("ESM6");
                        const nq = zoneMap.get("NQM6");
                        const renderCell = (row: ZoneLevels | undefined) => {
                          if (!row) return "--";
                          if (def.renderStack) {
                            const [first, second] = def.renderStack(row);
                            return (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <span>{first}</span>
                                <span>{second}</span>
                              </div>
                            );
                          }
                          return def.render?.(row) ?? "--";
                        };
                        return (
                          <tr key={def.label}>
                            <td style={{ padding: "8px 10px", border: "1px solid #1a2a3a", color: "#eef7ff", textTransform: "uppercase", letterSpacing: ".08em", fontSize: 14, fontWeight: 700 }}>{def.label}</td>
                            <td style={{ padding: "8px 10px", border: "1px solid #1a2a3a", color: "#ffffff", textAlign: "center", fontStyle: "italic" }}>{renderCell(es)}</td>
                            <td style={{ padding: "8px 10px", border: "1px solid #1a2a3a", color: "#ffffff", textAlign: "center", fontStyle: "italic" }}>{renderCell(nq)}</td>
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

      <div ref={shotRef} style={{ position: "fixed", top: 0, left: "-9999px", background: "#080c14", padding: "0 0 12px 0", width: activeView === "estimated" ? 420 : 760, fontFamily: "Arial, sans-serif" }}>
        {activeView === "estimated" ? (
          <>
            <div style={{ background: "#0b111b", padding: "14px 0", textAlign: "center", borderBottom: "2px solid #1a2a3a" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#a8b8cc", letterSpacing: ".16em", textTransform: "uppercase" }}>Weekly Estimated Move For</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#00e5ff", letterSpacing: ".1em", marginTop: 2 }}>{targetDateLabel || "--"}</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: "#0a0f18", borderBottom: "1px solid #1a2a3a" }}>
              {["Ticker","Up","Down"].map((header) => (
                <div key={header} style={{ padding: "8px 0", textAlign: "center", fontSize: 12, fontWeight: 700, color: "#00e5ff", letterSpacing: ".12em" }}>{header}</div>
              ))}
            </div>

            {rows.slice(0, 13).filter((row) => !row.error).map((row) => (
              <div key={row.ticker} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid #0d1825" }}>
                <div style={{ padding: "9px 0", textAlign: "center", fontWeight: 700, color: "#e8edf5", fontSize: 15 }}>{row.ticker}</div>
                <div style={{ padding: "9px 0", textAlign: "center", color: "#00e676", fontSize: 15 }}>{fmtPrice(row.ticker, row.up)}</div>
                <div style={{ padding: "9px 0", textAlign: "center", color: "#ff4757", fontSize: 15 }}>{fmtPrice(row.ticker, row.down)}</div>
              </div>
            ))}

            <div style={{ padding: "8px 0", textAlign: "center", fontSize: 11, color: "#3a5570", letterSpacing: ".18em", textTransform: "uppercase", borderBottom: "1px solid #1a2a3a", borderTop: "1px solid #1a2a3a", background: "#04070c" }}>
              x.com/bzilatrades
            </div>

            {rows.slice(13).filter((row) => !row.error).map((row) => (
              <div key={row.ticker} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid #0d1825" }}>
                <div style={{ padding: "9px 0", textAlign: "center", fontWeight: 700, color: "#e8edf5", fontSize: 15 }}>{row.ticker}</div>
                <div style={{ padding: "9px 0", textAlign: "center", color: "#00e676", fontSize: 15 }}>{fmtPrice(row.ticker, row.up)}</div>
                <div style={{ padding: "9px 0", textAlign: "center", color: "#ff4757", fontSize: 15 }}>{fmtPrice(row.ticker, row.down)}</div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div style={{ background: "#0b111b", padding: "14px 0", textAlign: "center", borderBottom: "2px solid #1a2a3a" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#eef7ff", letterSpacing: ".08em", textTransform: "uppercase" }}>ES/NQ Last Week Candle</div>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Consolas, Monaco, monospace", fontSize: 17 }}>
              <thead>
                <tr style={{ color: "#00e5ff", textTransform: "uppercase", letterSpacing: ".1em", fontSize: 12 }}>
                  <th style={{ padding: "10px 8px", border: "1px solid #1a2a3a" }}>Info</th>
                  <th style={{ padding: "10px 8px", border: "1px solid #1a2a3a" }}>ESM6</th>
                  <th style={{ padding: "10px 8px", border: "1px solid #1a2a3a" }}>NQM6</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Open", value: (row: ZoneLevels) => fmtFuture(row.open) },
                  { label: "High", value: (row: ZoneLevels) => fmtFuture(row.high) },
                  { label: "Low", value: (row: ZoneLevels) => fmtFuture(row.low) },
                  { label: "Close", value: (row: ZoneLevels) => fmtFuture(row.close) },
                  { label: "Pivot", value: (row: ZoneLevels) => fmtFuture(row.pivot) },
                  { label: "Range", value: (row: ZoneLevels) => fmtFuture(row.range) },
                  { label: "No Long", stack: (row: ZoneLevels) => [fmtFuture(row.noLongNear), fmtFuture(row.noLongFar)] },
                  { label: "No Short", stack: (row: ZoneLevels) => [fmtFuture(row.noShortNear), fmtFuture(row.noShortFar)] },
                ].map((rowDef) => {
                  const es = zoneMap.get("ESM6");
                  const nq = zoneMap.get("NQM6");
                  const render = (row: ZoneLevels | undefined) => {
                    if (!row) return "--";
                    if (rowDef.stack) {
                      const [first, second] = rowDef.stack(row);
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span>{first}</span>
                          <span>{second}</span>
                        </div>
                      );
                    }
                    return rowDef.value?.(row) ?? "--";
                  };
                  return (
                    <tr key={rowDef.label}>
                      <td style={{ padding: "8px 10px", border: "1px solid #1a2a3a", color: "#eef7ff", textTransform: "uppercase", letterSpacing: ".08em", fontSize: 13, fontWeight: 700 }}>{rowDef.label}</td>
                      <td style={{ padding: "8px 10px", border: "1px solid #1a2a3a", color: "#ffffff", textAlign: "center", fontStyle: "italic" }}>{render(es)}</td>
                      <td style={{ padding: "8px 10px", border: "1px solid #1a2a3a", color: "#ffffff", textAlign: "center", fontStyle: "italic" }}>{render(nq)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
