"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Lazily load html2canvas only in browser
async function getHtml2Canvas() {
  const mod = await import("html2canvas" as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).default ?? mod;
}

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface Snapshot {
  id: number;
  timestamp: number;
  date: string;
  time: string;
  period: string;
  rows: EMRow[];
  expirations: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── API URL helpers ──────────────────────────────────────────────────────────
// Reuse the existing Next.js API routes (same ones the rest of the dashboard uses)

const API = {
  quotesBatch: () => `/api/quotes-batch`,
  expirations: (ticker: string) => `/api/expirations?ticker=${encodeURIComponent(ticker)}`,
  chain: (sym: string, exp: string, extra = "") =>
    `/api/chains?ticker=${encodeURIComponent(sym)}&expiration=${encodeURIComponent(exp)}${extra}`,
  optionMarks: (symbols: string) =>
    `/api/em/option-marks?symbols=${encodeURIComponent(symbols)}`,
  emCloses: () => `/api/em/em-closes`,
  subscriptionReady: () => `/api/proxy/subscription-ready`,
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

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

function fmtPrice(ticker: string, num: number | undefined): string {
  if (num === undefined || !Number.isFinite(num)) return "—";
  const n = (ticker === "ESM" || ticker === "NQM") ? Math.round(num * 4) / 4 : num;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtEm(num: number | undefined): string {
  if (num === undefined || !Number.isFinite(num) || num < 0) return "—";
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function mid(o: OptionData): number {
  if (o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2;
  if (o.mark > 0) return o.mark;
  if (o.last > 0) return o.last;
  return 0;
}

// ─── Option chain normalizer (mirrors vanilla normalizeOptions exactly) ────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeOptions(chain: any): OptionData[] {
  const flat: OptionData[] = [];

  const direct = Array.isArray(chain?.options) ? chain.options : [];
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

  const nestedItems = Array.isArray(chain?.data?.items) ? chain.data.items : [];
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

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

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

async function dbSaveSnapshot(db: IDBDatabase, rows: EMRow[], expirations: string[]): Promise<Snapshot> {
  const now = new Date();
  const snap = {
    timestamp: now.getTime(),
    date: now.toLocaleDateString("en-US"),
    time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    period: "weekly",
    rows,
    expirations: expirations.slice(0, 3),
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

// ─── EM calculation engine (mirrors vanilla estimateMove exactly) ─────────────

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
    for (const alias of list) { if (map[alias]) { map[key] = map[alias]; break; } }
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
      const yahoClose = ticker === "ESM" ? engine.emClosesCache!.es : engine.emClosesCache!.nq;
      if (yahoClose > 0) close = yahoClose;
    } catch { /* ignore */ }
  }
  if (!Number.isFinite(close) || close <= 0) throw new Error(`Invalid price for ${ticker}: ${close}`);
  return { quote: q, close, prevClose };
}

// Fetch per-expiration IV from market-metrics (no dxFeed subscription needed)
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
  } catch { return 0; }
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
      if (opts.length) { engine.directChainCache[key] = opts; return opts; }
    } catch { /* ignore */ }
  }
  return null;
}

function getTargetExpiration(knownExpirations: string[], expOverride: string): string {
  if (expOverride) return expOverride;
  if (knownExpirations.length) {
    // Prefer Friday; if no Friday exists in range, take Thursday (holiday week), then any 3–10 DTE
    const inRange = knownExpirations.filter((exp) => { const d = daysTo(exp); return d >= 1 && d <= 10; });
    const friday  = inRange.find((exp) => new Date(exp + "T12:00:00").getDay() === 5);
    if (friday) return friday;
    const thursday = inRange.find((exp) => new Date(exp + "T12:00:00").getDay() === 4);
    if (thursday) return thursday;
    const ranged = inRange[0];
    if (ranged) return ranged;
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

  // All IV=0 → try direct REST fetch (cached per refresh)
  if (expOptions.every((o) => Number(o.iv || 0) === 0)) {
    const direct = await fetchChainDirect(chainSym, targetExp, engine);
    if (direct) expOptions = direct;
  }

  // Futures: use index prev-close for ATM strike selection + EM formula
  const indexQuote = isFuture ? await fetchQuoteDetail(lookupSym, engine) : null;
  const indexClose = isFuture ? (indexQuote!.prevClose > 0 ? indexQuote!.prevClose : indexQuote!.close) : close;

  // If still all IV=0, fetch per-expiration IV from market-metrics (no dxFeed needed)
  const allIvZero = expOptions.every((o) => Number(o.iv || 0) === 0);
  const metricsIv = allIvZero ? await fetchMetricsIv(chainSym, targetExp) : 0;

  const strikes = [...new Set(expOptions.map((o) => o.strike))]
    .sort((a, b) => Math.abs(a - indexClose) - Math.abs(b - indexClose));

  // If no strikes but we have metricsIv, compute EM directly from IV
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

    // Use market-metrics IV if chain IV is zero
    if (avgIV === 0 && metricsIv > 0) avgIV = metricsIv;

    let candidateEm = 0;

    if (avgIV > 0 && candidateDte > 0) {
      // Primary: IV formula — EM = 0.84 × avgIV × indexClose × √(DTE/365)
      candidateEm = 0.84 * avgIV * indexClose * Math.sqrt(candidateDte / 365);
    } else {
      // If bid/ask missing, augment from option-marks endpoint
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
      // Fallback 1: straddle mid × 0.85
      const cMid = mid(c!), pMid = mid(p!);
      if (cMid > 0 && pMid > 0) {
        candidateEm = (cMid + pMid) * 0.85;
      } else if (avgIV > 0 && candidateDte > 0) {
        // Fallback 2: IV formula after marks refresh
        candidateEm = 0.84 * avgIV * indexClose * Math.sqrt(candidateDte / 365);
      }
    }

    if (Number.isFinite(candidateEm) && candidateEm > 0) {
      // Sanity check: EM must be 0.2%–25% of underlying for weekly options
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
  return { ticker, close, em, up: indexClose + em + basis, down: indexClose - em + basis, expiration: targetExp, strike };
  void prevClose; // used inside fetchQuoteDetail for futures
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EstimatedMoves() {
  const [rows, setRows] = useState<EMRow[]>([]);
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

  // Init: open IndexedDB + prefetch expirations
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

        // Fallback: derive expirations from option chain
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
          // Show Fridays + Thursdays (holiday-week fallback) in dropdown
          const weeklyExps = exps.filter((e) => {
            const day = new Date(e + "T12:00:00").getDay();
            return day === 5 || day === 4;
          });
          setFridayExpirations(weeklyExps.length ? weeklyExps : exps);
          const first = weeklyExps[0] || exps[0];
          if (first) setTargetDateLabel(labelForDate(first));
        }
      } catch (e) { console.warn("prefetchExpirations:", e); }
    })();
  }, []);

  // Reload snapshot list whenever drawer opens
  useEffect(() => {
    if (drawerOpen && dbRef.current) {
      dbGetAll(dbRef.current).then((all) => setSnapshots(all.filter((s) => s.period === "weekly")));
    }
  }, [drawerOpen]);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setStarted(true);
    setStatus({ text: "Syncing", color: "#00e5ff" });
    setRows([]);

    const engine = makeEngine();

    try {
      // Subscribe to batch of symbols so the proxy has Greek data ready
      if (!bulkSubscribedRef.current) {
        try {
          setStatus({ text: "Subscribing…", color: "#00e5ff" });
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
          await new Promise((r) => setTimeout(r, 1000));
        } catch (e) { console.warn("Subscribe failed:", e); }
      }

      const effectiveExp = getTargetExpiration(knownExpirations, expOverride);
      const settled: EMRow[] = [];

      // Process symbols in batches of 4 (mirrors vanilla batch logic)
      for (let i = 0; i < SYMBOLS.length; i += 4) {
        const batch = SYMBOLS.slice(i, i + 4);
        setStatus({ text: `Loading ${i + 1}–${Math.min(i + 4, SYMBOLS.length)} / ${SYMBOLS.length}`, color: "#00e5ff" });
        const results = await Promise.allSettled(batch.map((sym) => estimateMove(sym, effectiveExp, engine)));
        results.forEach((r, idx) => {
          settled.push(r.status === "fulfilled"
            ? r.value
            : { ticker: batch[idx], error: (r.reason as Error)?.message || "Unavailable" });
        });
        setRows([...settled]); // stream rows progressively as each batch finishes
        if (i + 4 < SYMBOLS.length) await new Promise((r) => setTimeout(r, 300));
      }

      const exp = settled.find((r) => r.expiration)?.expiration;
      if (exp) setTargetDateLabel(labelForDate(exp));
      setLastSync(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setStatus({ text: "Live", color: "#00e676" });
    } catch (e) {
      console.error("Refresh failed:", e);
      setStatus({ text: "Error", color: "#ff4757" });
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, [knownExpirations, expOverride]);

  const saveSnapshot = useCallback(async () => {
    if (!dbRef.current || !rows.length) {
      setStatus({ text: "No data to save", color: "#ff4757" });
      return;
    }
    setStatus({ text: "Saving…", color: "#00e5ff" });
    try {
      await dbSaveSnapshot(dbRef.current, rows, knownExpirations);
      setStatus({ text: "Snapshot saved", color: "#00e676" });
      if (drawerOpen && dbRef.current) {
        const all = await dbGetAll(dbRef.current);
        setSnapshots(all.filter((s) => s.period === "weekly"));
      }
    } catch (e) {
      setStatus({ text: "Snapshot failed", color: "#ff4757" });
      console.error(e);
    }
  }, [rows, knownExpirations, drawerOpen]);

  const exportCsv = useCallback(async () => {
    if (!dbRef.current) return;
    setStatus({ text: "Exporting…", color: "#00e5ff" });
    const all = await dbGetAll(dbRef.current).catch(() => [] as Snapshot[]);
    const weekly = all.filter((s) => s.period === "weekly");
    if (!weekly.length) { setStatus({ text: "No snapshots", color: "#ff4757" }); return; }
    const csvRows = [["Date","Time","Period","Ticker","Close","Exp","EM","Up","Down"]];
    weekly.forEach((snap) => {
      snap.rows.forEach((row) => {
        csvRows.push([
          snap.date, snap.time, snap.period, row.ticker,
          row.close !== undefined ? fmtPrice(row.ticker, row.close) : "",
          row.expiration ? labelForDate(row.expiration) : "",
          row.em !== undefined ? fmtEm(row.em) : "",
          row.up !== undefined ? fmtPrice(row.ticker, row.up) : "",
          row.down !== undefined ? fmtPrice(row.ticker, row.down) : "",
        ]);
      });
    });
    const csv = csvRows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `estimated-moves-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setStatus({ text: "Exported", color: "#00e676" });
  }, []);

  const loadSnapshot = useCallback((snap: Snapshot) => {
    setRows(snap.rows);
    setStatus({ text: `Loaded ${snap.date} ${snap.time}`, color: "#00e676" });
  }, []);

  const copyShot = useCallback(async () => {
    if (!shotRef.current || !rows.length) return;
    setStatus({ text: "Capturing…", color: "#00e5ff" });
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
          // Fallback: download the image
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `em-shot-${new Date().toISOString().slice(0,10)}.png`;
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
          setStatus({ text: "Saved image", color: "#00e676" });
        }
      }, "image/png");
    } catch (e) {
      console.error(e);
      setStatus({ text: "Copy failed", color: "#ff4757" });
    }
  }, [rows]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden", background: "#080c14", height: "100%" }}>

      {/* ── Header bar ── */}
      <div style={{ padding: "7px 16px", background: "#0b111b", borderBottom: "1px solid #1a2a3a", flexShrink: 0, display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#00e5ff", letterSpacing: ".15em", textTransform: "uppercase" }}>Estimated Moves</span>
          <span style={{ fontSize: 12, color: "#3a5570", letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 700 }}>Weekly</span>
          <span style={{ fontSize: 12, color: "#7ab8ff", letterSpacing: ".12em", textTransform: "uppercase" }}>{targetDateLabel}</span>

          {/* Expiration selector — only Fridays shown (same as vanilla) */}
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
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: status.color }}>{status.text}</span>
          <button onClick={refresh} disabled={loading}
            style={{ background: "#0a1628", border: "1px solid #1e3a5f", color: "#00e5ff", fontSize: 13, padding: "7px 12px", borderRadius: 2, cursor: loading ? "not-allowed" : "pointer", fontFamily: "Arial", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", opacity: loading ? 0.6 : 1 }}>
            {started ? "Refresh" : "Start"}
          </button>
          <button onClick={saveSnapshot} disabled={!rows.length}
            style={{ background: "#0a1628", border: "1px solid #1e3a5f", color: "#00e5ff", fontSize: 13, padding: "7px 12px", borderRadius: 2, cursor: rows.length ? "pointer" : "not-allowed", fontFamily: "Arial", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", opacity: rows.length ? 1 : 0.4 }}>
            Save
          </button>
          <button onClick={exportCsv}
            style={{ background: "#0a1628", border: "1px solid #1e3a5f", color: "#00e5ff", fontSize: 13, padding: "7px 12px", borderRadius: 2, cursor: "pointer", fontFamily: "Arial", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>
            Export
          </button>
          <button onClick={copyShot} disabled={!rows.length}
            style={{ background: "#0a1628", border: "1px solid #1e3a5f", color: "#00e5ff", fontSize: 13, padding: "7px 12px", borderRadius: 2, cursor: rows.length ? "pointer" : "not-allowed", fontFamily: "Arial", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", opacity: rows.length ? 1 : 0.4 }}>
            Copy Shot
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>

        {/* ── Left sidebar ── */}
        <div style={{ width: 230, minWidth: 230, flexShrink: 0, background: "#04070c", borderRight: "1px solid #0d1825", boxSizing: "border-box", overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #0d1825", flexShrink: 0 }}>
            <div style={{ fontSize: 9, color: "#3a5570", letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 700, marginBottom: 4 }}>Last Sync</div>
            <div style={{ fontSize: 13, color: "#e8edf5", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{lastSync}</div>
          </div>

          {/* Snapshot drawer */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            <button onClick={() => setDrawerOpen((o) => !o)}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: "transparent", border: "none", borderBottom: "1px solid #0d1825", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, color: "#5a7a99", display: "inline-block", transform: drawerOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s" }}>▶</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#e8edf5", letterSpacing: ".08em", textTransform: "uppercase" }}>Weekly</span>
              </div>
              <span style={{ fontSize: 10, color: "#7ab8ff", background: "#07111d", border: "1px solid #1a2a3a", padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>{snapshots.length}</span>
            </button>

            {drawerOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "#020407" }}>
                {snapshots.length === 0
                  ? <div style={{ padding: "10px 14px", fontSize: 11, color: "#3a5570" }}>No snapshots</div>
                  : snapshots.map((snap) => (
                    <div key={snap.id} onClick={() => loadSnapshot(snap)}
                      style={{ padding: "8px 14px", cursor: "pointer", borderBottom: "1px solid #0d1825", background: "#04070c" }}>
                      <div style={{ fontSize: 11, color: "#e8edf5", fontWeight: 700 }}>{snap.date}</div>
                      <div style={{ fontSize: 10, color: "#7ab8ff", fontVariantNumeric: "tabular-nums" }}>{snap.time}</div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Symbol tags */}
          <div style={{ padding: "10px 14px", borderTop: "1px solid #0d1825", flexShrink: 0 }}>
            <div style={{ fontSize: 9, color: "#3a5570", letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Symbols</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {SYMBOLS.map((s) => (
                <span key={s} style={{ fontSize: 11, color: "#7ab8ff", background: "#07111d", border: "1px solid #13253a", padding: "3px 6px", borderRadius: 2 }}>{s}</span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Main table ── */}
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 18 }}>
          <div style={{ width: "100%", maxWidth: 980, margin: "0 auto", background: "#0b111b", border: "1px solid #1a2a3a", boxShadow: "0 18px 50px rgba(0,0,0,.35)" }}>
            <div style={{ borderBottom: "1px solid #1a2a3a", background: "#0e1522", padding: "10px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#a8b8cc", letterSpacing: ".16em", textTransform: "uppercase" }}>
                Weekly Estimated Move For&nbsp;<span style={{ color: "#00e5ff" }}>{targetDateLabel || "--"}</span>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16 }}>
                <thead style={{ background: "#0a0f18" }}>
                  <tr style={{ borderBottom: "1px solid #1a2a3a", color: "#00e5ff", textAlign: "center", fontSize: 13, letterSpacing: ".12em", textTransform: "uppercase" }}>
                    {["Ticker","Close","Exp","EM","Up","Down"].map((h, i) => (
                      <th key={h} style={{ padding: 10, borderRight: i < 5 ? "1px solid #1a2a3a" : undefined }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody style={{ fontFamily: "Consolas, Monaco, monospace" }}>
                  {!started ? (
                    <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: "#3a5570" }}>Click Start to load estimated moves</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#3a5570" }}>Loading…</td></tr>
                  ) : rows.map((row) => (
                    <tr key={row.ticker} title={row.error || ""}
                      style={{ textAlign: "center", borderBottom: "1px solid #121b2a", opacity: row.error ? 0.55 : 1 }}>
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
        </div>
      </div>

      {/* ── Hidden screenshot capture div (Ticker / Up / Down only) ── */}
      <div ref={shotRef} style={{
        position: "fixed", top: 0, left: "-9999px",
        background: "#080c14", padding: "0 0 12px 0", width: 420,
        fontFamily: "Arial, sans-serif",
      }}>
        {/* Header */}
        <div style={{ background: "#0b111b", padding: "14px 0", textAlign: "center", borderBottom: "2px solid #1a2a3a" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#a8b8cc", letterSpacing: ".16em", textTransform: "uppercase" }}>
            WEEKLY ESTIMATED MOVE FOR
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#00e5ff", letterSpacing: ".1em", marginTop: 2 }}>
            {targetDateLabel || "--"}
          </div>
        </div>

        {/* Column headers */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: "#0a0f18", borderBottom: "1px solid #1a2a3a" }}>
          {["TICKER","UP","DOWN"].map((h) => (
            <div key={h} style={{ padding: "8px 0", textAlign: "center", fontSize: 12, fontWeight: 700, color: "#00e5ff", letterSpacing: ".12em" }}>{h}</div>
          ))}
        </div>

        {/* First group — up to TSLA (index 12) */}
        {rows.slice(0, 13).filter(r => !r.error).map((row) => (
          <div key={row.ticker} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid #0d1825" }}>
            <div style={{ padding: "9px 0", textAlign: "center", fontWeight: 700, color: "#e8edf5", fontSize: 15 }}>{row.ticker}</div>
            <div style={{ padding: "9px 0", textAlign: "center", color: "#00e676", fontSize: 15 }}>{fmtPrice(row.ticker, row.up)}</div>
            <div style={{ padding: "9px 0", textAlign: "center", color: "#ff4757", fontSize: 15 }}>{fmtPrice(row.ticker, row.down)}</div>
          </div>
        ))}

        {/* Handle divider */}
        <div style={{ padding: "8px 0", textAlign: "center", fontSize: 11, color: "#3a5570", letterSpacing: ".18em", textTransform: "uppercase", borderBottom: "1px solid #1a2a3a", borderTop: "1px solid #1a2a3a", background: "#04070c" }}>
          x.com/bzilatrades
        </div>

        {/* Second group — COIN onwards (index 13+) */}
        {rows.slice(13).filter(r => !r.error).map((row) => (
          <div key={row.ticker} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid #0d1825" }}>
            <div style={{ padding: "9px 0", textAlign: "center", fontWeight: 700, color: "#e8edf5", fontSize: 15 }}>{row.ticker}</div>
            <div style={{ padding: "9px 0", textAlign: "center", color: "#00e676", fontSize: 15 }}>{fmtPrice(row.ticker, row.up)}</div>
            <div style={{ padding: "9px 0", textAlign: "center", color: "#ff4757", fontSize: 15 }}>{fmtPrice(row.ticker, row.down)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
