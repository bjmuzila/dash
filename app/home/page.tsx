"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SnapshotPanel from "@/components/dashboard/SnapshotPanel";
import EconCalendarPanel from "@/components/dashboard/EconCalendarPanel";
import GexChart from "@/components/dashboard/GexChart";
import GexToolbar from "@/components/dashboard/GexToolbar";
import { type ChainRow, computeGEXProfile, findGEXFlip } from "@/lib/calculations/calculations";
import { ensureProxyLiveSubscription, normalizeProxyFeedData } from "@/lib/proxy/liveSubscription";
import { getClientWsUrl } from "@/lib/clientRuntime";

type FeedType = "Quote" | "Trade" | "Summary" | "Greeks";
type OptionSide = "call" | "put";
type LiveEntry = {
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  oi?: number;
  vol?: number;
  bid?: number;
  ask?: number;
  _ws?: boolean;
};
type StrikeRow = {
  strike: number;
  callSym: string | null;
  putSym: string | null;
};
type QuoteTile = { sym: string; chg: string; pos: boolean; active?: boolean };
type HeatmapRow = {
  strike: string;
  netGex: string;
  volOnly: string;
  dex: string;
  vex: string;
  dwGex: string;
  type: "pos-top" | "pos-strong" | "neg-top" | "neg-red" | "neg" | "neutral" | "atm";
  rank?: number;
  rankColor?: string;
  atm?: boolean;
};
type ExpiryOption = { value: string; label: string };
type GexMode = "net" | "call-put";
type DataMode = "oi-vol" | "vol-only";

const FEED_TYPES: FeedType[] = ["Quote", "Trade", "Summary", "Greeks"];
const OPTION_FEED_TYPES: FeedType[] = ["Quote", "Trade", "Summary", "Greeks"];
const SIDEBAR_SYMBOLS = ["SPY", "QQQ", "SPX", "VIX", "IWM"];
const INDEX_SYMBOLS = ["$SPX", "SPX", "/ESU26", "/ES:XCME", "VIX", ...SIDEBAR_SYMBOLS];
const PAGE_ID_PREFIX = "home-gex";

function etNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function fmtMoney(v: number) {
  if (!isFinite(v)) return "--";
  const s = v >= 0 ? "+" : "-";
  const a = Math.abs(v);
  if (a >= 1e9) return s + "$" + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(1) + "K";
  return s + "$" + a.toFixed(0);
}

function fmtExpiryLabel(dateStr: string, label: string) {
  return label || dateStr;
}

function formatStrikeValue(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(2);
}

function extractExpirations(payload: unknown): string[] {
  const json = payload as {
    expirations?: unknown;
    items?: Array<Record<string, unknown>>;
    data?: { items?: Array<Record<string, unknown>> };
  };
  const out = new Set<string>();
  const add = (value: unknown) => {
    const date = String(value ?? "");
    if (date.length === 10) out.add(date);
  };
  if (Array.isArray(json?.expirations)) json.expirations.forEach(add);
  if (Array.isArray(json?.items)) json.items.forEach((item) => add(item.date ?? item["expiration-date"]));
  if (Array.isArray(json?.data?.items)) json.data.items.forEach((item) => add(item.date ?? item["expiration-date"]));
  const today = todayEt();
  return [...out].filter((date) => date >= today).sort();
}

function buildExpiryOptions(dates: string[]): ExpiryOption[] {
  return dates.slice(0, 8).map((value, index) => ({
    value,
    label: `${index}DTE ${value.slice(5)}`,
  }));
}

function buildStrikes(expGroups: unknown[], liveData: Record<string, LiveEntry>): StrikeRow[] {
  const map: Record<string, StrikeRow> = {};
  (expGroups as Array<{ strikes?: unknown[] }>).forEach((expGroup) => {
    (expGroup.strikes || []).forEach((item: unknown) => {
      const row = item as Record<string, unknown>;
      const strike = Number(row["strike-price"] ?? row.strikePrice ?? row.strike ?? 0);
      if (!(strike > 0)) return;
      const key = strike.toFixed(2);
      if (!map[key]) map[key] = { strike, callSym: null, putSym: null };
      const next = map[key];
      for (const side of ["call", "put"] as const) {
        const option = row[side] as Record<string, unknown> | undefined;
        if (!option) continue;
        const sym = String(option["streamer-symbol"] ?? option.symbol ?? "");
        if (side === "call") next.callSym = sym;
        else next.putSym = sym;

        if (sym && !liveData[sym]?._ws) {
          liveData[sym] = {
            iv: Number(option["implied-volatility"] ?? option.impliedVolatility ?? 0) || undefined,
            delta: Number(option.delta ?? 0) || undefined,
            gamma: Number(option.gamma ?? 0) || undefined,
            theta: Number(option.theta ?? 0) || undefined,
            vega: Number(option.vega ?? 0) || undefined,
            oi: Number(option["open-interest"] ?? option.openInterest ?? 0) || 0,
            vol: Number(option.volume ?? option.dayVolume ?? 0) || 0,
          };
        }
      }
    });
  });
  return Object.values(map).sort((a, b) => a.strike - b.strike);
}

function buildChainRows(strikes: StrikeRow[], liveData: Record<string, LiveEntry>, spot: number): ChainRow[] {
  return strikes.map((row) => {
    const call = liveData[row.callSym ?? ""] || {};
    const put = liveData[row.putSym ?? ""] || {};
    const callOI = call.oi ?? 0;
    const putOI = put.oi ?? 0;
    const callVolume = call.vol ?? 0;
    const putVolume = put.vol ?? 0;
    const callGamma = Math.abs(call.gamma ?? 0);
    const putGamma = Math.abs(put.gamma ?? 0);
    const callDelta = call.delta ?? 0;
    const putDelta = Math.abs(put.delta ?? 0);
    const callGEX = callGamma * callOI * spot * spot;
    const putGEX = -putGamma * putOI * spot * spot;
    const netGEX = callGEX + putGEX;
    const netVolGEX = callGamma * callVolume * spot * spot - putGamma * putVolume * spot * spot;
    const netDEX = callDelta * callOI * spot * 100 - putDelta * putOI * spot * 100;
    const volNetDEX = callDelta * callVolume * spot * 100 - putDelta * putVolume * spot * 100;
    const netVanna = ((call.vega ?? 0) * callOI - (put.vega ?? 0) * putOI) * 100;
    const netVolVanna = ((call.vega ?? 0) * callVolume - (put.vega ?? 0) * putVolume) * 100;

    return {
      strike: row.strike,
      spotPrice: spot,
      callOI,
      putOI,
      callVolume,
      putVolume,
      callGamma,
      putGamma,
      callDelta,
      putDelta,
      callGEX,
      putGEX,
      netGEX,
      netVolGEX,
      netDEX,
      volNetDEX,
      netVanna,
      netVolVanna,
      callIV: call.iv ?? 0,
      putIV: put.iv ?? 0,
      dte: 0,
      bid: call.bid,
      ask: call.ask,
    };
  });
}

function pickCenterRows(rows: ChainRow[], spot: number, count = 19): ChainRow[] {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => b.strike - a.strike);
  let atmIndex = 0;
  let minDist = Infinity;
  sorted.forEach((row, index) => {
    const dist = Math.abs(row.strike - spot);
    if (dist < minDist) {
      minDist = dist;
      atmIndex = index;
    }
  });
  const start = Math.max(0, atmIndex - Math.floor(count / 2));
  const end = Math.min(sorted.length, start + count);
  return sorted.slice(start, end);
}

function toHeatmapRows(rows: ChainRow[], spot: number): HeatmapRow[] {
  const windowRows = pickCenterRows(rows, spot, 19);
  const byAbsPos = [...windowRows].filter((row) => (row.netGEX ?? 0) > 0).sort((a, b) => Math.abs(b.netGEX ?? 0) - Math.abs(a.netGEX ?? 0)).slice(0, 5);
  const byAbsNeg = [...windowRows].filter((row) => (row.netGEX ?? 0) < 0).sort((a, b) => Math.abs(b.netGEX ?? 0) - Math.abs(a.netGEX ?? 0)).slice(0, 5);
  const rankMap = new Map<number, { rank: number; rankColor: string }>();
  byAbsPos.forEach((row, index) => rankMap.set(row.strike, { rank: index + 1, rankColor: index === 0 || index === 2 ? "#F97316" : "#8B94A7" }));
  byAbsNeg.forEach((row, index) => {
    if (!rankMap.has(row.strike)) rankMap.set(row.strike, { rank: index + 1, rankColor: index === 0 || index === 2 ? "#F97316" : "#8B94A7" });
  });

  const atmStrike = windowRows.reduce((best, row) => (
    Math.abs(row.strike - spot) < Math.abs(best - spot) ? row.strike : best
  ), windowRows[0]?.strike ?? 0);

  return windowRows.map((row) => {
    const net = row.netGEX ?? 0;
    const volOnly = row.netVolGEX ?? 0;
    const dex = (row.netDEX ?? 0) + (row.volNetDEX ?? 0);
    const vex = (row.netVanna ?? 0) + (row.netVolVanna ?? 0);
    const dwGex = net - volOnly;
    const isAtm = row.strike === atmStrike;
    let type: HeatmapRow["type"] = "neutral";
    if (isAtm) type = "atm";
    else if (net >= 0 && rankMap.get(row.strike)?.rank === 1) type = "pos-top";
    else if (net >= 0 && (rankMap.get(row.strike)?.rank ?? 99) <= 3) type = "pos-strong";
    else if (net < 0 && rankMap.get(row.strike)?.rank === 1) type = "neg-top";
    else if (net < 0 && (rankMap.get(row.strike)?.rank ?? 99) <= 3) type = "neg-red";
    else if (net < 0) type = "neg";

    return {
      strike: formatStrikeValue(row.strike),
      netGex: fmtMoney(net),
      volOnly: fmtMoney(volOnly),
      dex: fmtMoney(dex),
      vex: fmtMoney(vex),
      dwGex: fmtMoney(dwGex),
      type,
      rank: rankMap.get(row.strike)?.rank,
      rankColor: rankMap.get(row.strike)?.rankColor,
      atm: isAtm,
    };
  });
}

function makeSidebarQuotes(quotes: Record<string, { last: number; prev: number }>): QuoteTile[] {
  return SIDEBAR_SYMBOLS.map((sym) => {
    const entry = quotes[sym];
    if (!entry || !(entry.prev > 0) || !(entry.last > 0)) {
      return { sym, chg: "—", pos: true, active: sym === "SPX" };
    }
    const pct = ((entry.last - entry.prev) / entry.prev) * 100;
    return {
      sym,
      chg: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
      pos: pct >= 0,
      active: sym === "SPX",
    };
  });
}

const BarChart2 = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);
const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const ActivityIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);
const LayersIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
  </svg>
);
const HomeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);
const GridIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
);
const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export default function HomePage() {
  const pageIdRef = useRef(`${PAGE_ID_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const wsRef = useRef<WebSocket | null>(null);
  const liveDataRef = useRef<Record<string, LiveEntry>>({});
  const subscribedSymbolsRef = useRef<string[]>([]);
  const lastSpotRef = useRef(0);
  const quoteSnapshotsRef = useRef<Record<string, { last: number; prev: number }>>({});
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const [now, setNow] = useState(new Date());
  const [activeTab, setActiveTab] = useState<"calendar" | "snapshot" | "spxflow">("calendar");
  const [gexMode, setGexMode] = useState<GexMode>("net");
  const [dataMode, setDataMode] = useState<DataMode>("oi-vol");
  const [showOI, setShowOI] = useState(false);
  const [showDex, setShowDex] = useState(false);
  const [showFlipCurve, setShowFlipCurve] = useState(false);
  const gexContainerRef = useRef<HTMLDivElement>(null);
  const [expiryOptions, setExpiryOptions] = useState<ExpiryOption[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [strikeRows, setStrikeRows] = useState<StrikeRow[]>([]);
  const [spot, setSpot] = useState(0);
  const [esFut, setEsFut] = useState(0);
  const [vix, setVix] = useState(0);
  const [spxChange, setSpxChange] = useState(0);
  const [spxChangePct, setSpxChangePct] = useState(0);
  const [sidebarQuotes, setSidebarQuotes] = useState<QuoteTile[]>(SIDEBAR_SYMBOLS.map((sym) => ({ sym, chg: "—", pos: true, active: sym === "SPX" })));
  const [quoteSnapshots, setQuoteSnapshots] = useState<Record<string, { last: number; prev: number }>>({});
  const [renderTick, setRenderTick] = useState(0);
  const [status, setStatus] = useState("READY");
  // GEX chart rows come directly from /api/gex (fast gex-chain endpoint, pre-computed)
  const [gexChainRows, setGexChainRows] = useState<ChainRow[]>([]);
  const [gexSpot, setGexSpot] = useState(0);

  useEffect(() => {
    quoteSnapshotsRef.current = quoteSnapshots;
  }, [quoteSnapshots]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const scheduleRender = useCallback(() => {
    setRenderTick((current) => current + 1);
  }, []);

  const connectSocket = useCallback(() => {
    if (unmountedRef.current) return;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const wsUrl = getClientWsUrl();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("LIVE");
      ws.send(JSON.stringify({
        type: "subscribe",
        symbols: INDEX_SYMBOLS,
        feedTypesBySymbol: Object.fromEntries(INDEX_SYMBOLS.map((symbol) => [symbol, FEED_TYPES])),
      }));

      if (subscribedSymbolsRef.current.length) {
        ws.send(JSON.stringify({
          type: "subscribe",
          symbols: subscribedSymbolsRef.current,
          feedTypesBySymbol: Object.fromEntries(subscribedSymbolsRef.current.map((symbol) => [symbol, OPTION_FEED_TYPES])),
        }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message?.type !== "FEED_DATA" || !Array.isArray(message.data)) return;
        const items = normalizeProxyFeedData(message.data);
        let changed = false;
        const nextQuotes = { ...quoteSnapshotsRef.current };

        items.forEach((item) => {
          const sym = String(item.eventSymbol ?? "");
          const eventType = String(item.eventType ?? "");
          if (!sym) return;

          if (INDEX_SYMBOLS.includes(sym)) {
            const bid = Number(item.bidPrice ?? 0);
            const ask = Number(item.askPrice ?? 0);
            const price = Number(item.price ?? 0);
            const prev = Number(item.prevDayClosePrice ?? item.dayClosePrice ?? 0);
            const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : price;

            if (sym === "$SPX" || sym === "SPX") {
              if (eventType === "Quote" && mid > 0) setSpot(mid);
              if (eventType === "Trade" && price > 0) setSpot(price);
              const last = eventType === "Trade" ? price : mid;
              if (last > 0) {
                const prior = prev > 0 ? prev : nextQuotes.SPX?.prev ?? lastSpotRef.current;
                nextQuotes.SPX = { last, prev: prior };
                if (prior > 0) {
                  setSpxChange(last - prior);
                  setSpxChangePct(((last - prior) / prior) * 100);
                }
                if (lastSpotRef.current === 0) lastSpotRef.current = prior || last;
              }
            }
            if ((sym === "/ESU26" || sym === "/ES:XCME") && (eventType === "Quote" || eventType === "Trade")) {
              const last = eventType === "Trade" ? price : mid;
              if (last > 0) {
                setEsFut(last);
                nextQuotes.ES = { last, prev: prev > 0 ? prev : nextQuotes.ES?.prev ?? last };
              }
            }
            if (sym === "VIX" && (eventType === "Quote" || eventType === "Trade")) {
              const last = eventType === "Trade" ? price : mid;
              if (last > 0) {
                setVix(last);
                nextQuotes.VIX = { last, prev: prev > 0 ? prev : nextQuotes.VIX?.prev ?? last };
              }
            }
            if (SIDEBAR_SYMBOLS.includes(sym) && (eventType === "Quote" || eventType === "Trade")) {
              const last = eventType === "Trade" ? price : mid;
              if (last > 0) {
                nextQuotes[sym] = { last, prev: prev > 0 ? prev : nextQuotes[sym]?.prev ?? last };
              }
            }
          }

          if (!subscribedSymbolsRef.current.includes(sym)) return;
          if (!liveDataRef.current[sym]) liveDataRef.current[sym] = {};
          const live = liveDataRef.current[sym];
          live._ws = true;
          if (eventType === "Greeks") {
            if (item.volatility != null) live.iv = Number(item.volatility);
            if (item.delta != null) live.delta = Number(item.delta);
            if (item.gamma != null) live.gamma = Number(item.gamma);
            if (item.theta != null) live.theta = Number(item.theta);
            if (item.vega != null) live.vega = Number(item.vega);
            changed = true;
          } else if (eventType === "Summary") {
            if (item.openInterest != null) live.oi = Number(item.openInterest);
            changed = true;
          } else if (eventType === "Trade") {
            if (item.dayVolume != null) live.vol = Number(item.dayVolume);
            if (item.price != null && Number(item.price) > 0) {
              live.bid = Number(item.price);
              live.ask = Number(item.price);
            }
            changed = true;
          } else if (eventType === "Quote") {
            if (item.bidPrice != null) live.bid = Number(item.bidPrice);
            if (item.askPrice != null) live.ask = Number(item.askPrice);
            changed = true;
          }
        });

        setQuoteSnapshots(nextQuotes);
        setSidebarQuotes(makeSidebarQuotes(nextQuotes));
        quoteSnapshotsRef.current = nextQuotes;
        if (changed) scheduleRender();
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = () => setStatus("WS ERR");
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      if (unmountedRef.current) return;
      setStatus("RECONNECT");
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connectSocket();
      }, 2500);
    };
  }, [scheduleRender]);

  useEffect(() => {
    connectSocket();
    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connectSocket]);

  useEffect(() => {
    let cancelled = false;
    const loadExpirations = async () => {
      const primary = await fetch("/api/gex/expirations", { cache: "no-store" }).then((res) => res.json()).catch(() => null);
      const fallback = primary ? null : await fetch("/api/expirations?ticker=SPX", { cache: "no-store" }).then((res) => res.json()).catch(() => null);
      const dates = extractExpirations(primary ?? fallback);
      if (cancelled) return;
      const options = buildExpiryOptions(dates);
      setExpiryOptions(options);
      if (options[0]) setSelectedExpiry((current) => current || options[0].value);
    };
    loadExpirations().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const loadChain = useCallback(async (expiry: string) => {
    if (!expiry) return;
    setStatus("LOADING");
    const pageId = pageIdRef.current;

    // ── 1. Fast path: fetch pre-computed GEX chain for the chart ─────────────
    // /api/gex uses the proxy's gex-chain endpoint which reads from dxGreeksCache
    // and the full REST SPXW chain — returns all strikes with computed GEX fields.
    const gexJson = await fetch(`/api/gex?expiry=${encodeURIComponent(expiry)}`, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null);
    if (gexJson?.chain?.length) {
      setGexChainRows(gexJson.chain as ChainRow[]);
      if (Number(gexJson.spotPrice) > 0) {
        setGexSpot(Number(gexJson.spotPrice));
        setSpot(Number(gexJson.spotPrice));
      }
    }

    // ── 2. Fetch full chain for WS symbol subscription (heatmap live data) ───
    // No pageId → hits the cache (fast). NoSubscribe=0 so proxy logs but doesn't auto-subscribe.
    const json = await fetch(
      `/api/chains?ticker=SPX&expiration=${encodeURIComponent(expiry)}&range=all`,
      { cache: "no-store" }
    ).then((r) => r.json()).catch(() => null);
    const items = Array.isArray(json?.data?.items) ? json.data.items : [];
    const target = items.filter((item: Record<string, unknown>) =>
      String(item["expiration-date"] ?? "").slice(0, 10) === expiry.slice(0, 10)
    );
    const nextStrikes = buildStrikes(target.length ? target : items, liveDataRef.current);
    const nextSpot = Number(json?.data?.underlyingPrice ?? 0);
    setStrikeRows(nextStrikes);
    if (nextSpot > 0 && !(gexJson?.spotPrice > 0)) setSpot(nextSpot);

    const symbols = nextStrikes.flatMap((row) => [row.callSym, row.putSym]).filter(Boolean) as string[];
    subscribedSymbolsRef.current = symbols;

    await ensureProxyLiveSubscription(
      pageId,
      symbols,
      Object.fromEntries(symbols.map((symbol) => [symbol, OPTION_FEED_TYPES])),
      1,
      8000,
    ).catch(() => null);

    if (wsRef.current?.readyState === WebSocket.OPEN && symbols.length) {
      wsRef.current.send(JSON.stringify({
        type: "subscribe",
        symbols,
        feedTypesBySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, OPTION_FEED_TYPES])),
      }));
    }

    setStatus("LIVE");
    scheduleRender();
  }, [scheduleRender]);

  useEffect(() => {
    if (!selectedExpiry) return;
    loadChain(selectedExpiry).catch(() => setStatus("CHAIN ERR"));
  }, [loadChain, selectedExpiry]);

  const handleRefresh = useCallback(async () => {
    if (selectedExpiry) await loadChain(selectedExpiry);
  }, [loadChain, selectedExpiry]);

  const chainRows = useMemo(() => {
    void renderTick;
    const liveSpot = spot > 0 ? spot : Number(quoteSnapshots.SPX?.last ?? 0);
    if (!(liveSpot > 0) || !strikeRows.length) return [] as ChainRow[];
    return buildChainRows(strikeRows, liveDataRef.current, liveSpot);
  }, [quoteSnapshots.SPX?.last, renderTick, spot, strikeRows]);

  const heatmapRows = useMemo(() => {
    if (!(spot > 0) || !chainRows.length) return [] as HeatmapRow[];
    return toHeatmapRows(chainRows, spot);
  }, [chainRows, spot]);

  // Chart uses the fast gex-chain data; heatmap uses live WS chain
  const chartRows = gexChainRows.length > 0 ? gexChainRows : chainRows;
  const chartSpot = gexSpot > 0 ? gexSpot : spot;

  const netGex = useMemo(
    () => chartRows.reduce((sum, row) => sum + ((dataMode === "vol-only" ? row.netVolGEX : row.netGEX) ?? 0), 0),
    [chartRows, dataMode]
  );
  const flipPoint = useMemo(() => findGEXFlip(chartRows, chartSpot) ?? null, [chartRows, chartSpot]);
  const gexProfile = useMemo(() => computeGEXProfile(chartRows, chartSpot), [chartRows, chartSpot]);

  const etTime = now.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const C = {
    bg: "#05060A",
    cyan: "#00F0FF",
    purple: "#8B5CF6",
    orange: "#F97316",
    green: "#10B981",
    red: "#EF4444",
  };

  return (
    <div style={{ height: "100%", width: "100%", overflow: "hidden", background: C.bg, backgroundImage: "radial-gradient(circle at 15% 50%, rgba(0,240,255,0.02) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(139,92,246,0.03) 0%, transparent 50%)", fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", color: "#fff", display: "flex", flexDirection: "row" }}>
      <aside style={{ width: 85, flexShrink: 0, display: "flex", flexDirection: "column", padding: "24px 0", alignItems: "center", zIndex: 20, position: "relative", background: "rgba(0,0,0,0.10)", backdropFilter: "blur(12px)", borderRight: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ width: 48, height: 48, background: "rgba(0,240,255,0.10)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 20px -5px rgba(0,240,255,0.3)", border: "1px solid rgba(0,240,255,0.2)", marginBottom: 24, color: C.cyan }}><HomeIcon /></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, width: "100%", alignItems: "center", color: "#fff", marginBottom: 20 }}>
          <span><GridIcon /></span>
          <span><CalendarIcon /></span>
        </div>
        <div style={{ width: 32, height: 1, background: "rgba(255,255,255,0.10)", marginBottom: 16 }} />
        <div style={{ flex: 1, width: "100%", overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", scrollbarWidth: "none" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.15em", position: "sticky", top: 0, background: "rgba(5,6,10,0.8)", backdropFilter: "blur(8px)", width: "100%", textAlign: "center", padding: "8px 0", zIndex: 10 }}>Quotes</div>
          {sidebarQuotes.map((q) => (
            <div key={q.sym} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "6px 0", width: "100%", background: q.active ? "rgba(255,255,255,0.05)" : "transparent", borderLeft: q.active ? `2px solid ${C.cyan}` : "2px solid transparent" }}>
              <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "#fff" }}>{q.sym}</span>
              <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: q.pos ? C.green : C.red }}>{q.chg}</span>
            </div>
          ))}
        </div>
        <div className="grad-divider-sidebar-t" style={{ marginTop: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 20, paddingTop: 16, width: "100%" }}>
          <span><SettingsIcon /></span>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: `linear-gradient(135deg, ${C.purple}, ${C.cyan})` }} />
        </div>
      </aside>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", minWidth: 0 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "row", padding: "24px", gap: 32, minHeight: 0, overflow: "hidden" }}>
          <div style={{ width: "55%", display: "flex", flexDirection: "column", minWidth: 0, height: "100%", overflow: "hidden" }}>
            <div ref={gexContainerRef} style={{ background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)", borderRadius: 16, display: "flex", flexDirection: "column", height: 420, flexShrink: 0, overflow: "hidden" }}>
              {/* GEX title row */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px 6px", flexShrink: 0 }}>
                <span style={{ color: C.cyan }}><BarChart2 /></span>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em" }}>NET GEX</span>
                <span style={{ marginLeft: "auto", fontSize: 9, color: "#4a6a88" }}>Drag to pan · Scroll to zoom</span>
              </div>
              {/* Full-featured toolbar */}
              <GexToolbar
                gexMode={gexMode}
                dataMode={dataMode}
                showOI={showOI}
                showDex={showDex}
                showFlipCurve={showFlipCurve}
                expirations={expiryOptions.map(o => o.value)}
                selectedExpiry={selectedExpiry}
                onExpiry={setSelectedExpiry}
                onGexMode={setGexMode}
                onDataMode={setDataMode}
                onToggleOI={() => setShowOI(v => !v)}
                onToggleDex={() => setShowDex(v => !v)}
                onToggleFlip={() => setShowFlipCurve(v => !v)}
                onRefresh={handleRefresh}
                containerRef={gexContainerRef}
                discordMessage={`NET GEX • ${selectedExpiry}`}
              />
              {/* Chart canvas — uses fast gex-chain data */}
              <div style={{ flex: 1, minHeight: 0 }}>
                <GexChart
                  chain={chartRows}
                  spotPrice={chartSpot}
                  flipPoint={flipPoint}
                  gexProfile={gexProfile}
                  mode={gexMode}
                  dataMode={dataMode}
                  showOI={showOI}
                  showDex={showDex}
                  showFlipCurve={showFlipCurve}
                  expiry={selectedExpiry}
                />
              </div>
            </div>

            <div style={{ background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)", borderRadius: 16, display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden", marginTop: 24 }}>
              <div className="grad-divider-b" style={{ display: "flex", flexShrink: 0 }}>
                {([
                  { id: "calendar", label: "Economic Calendar", icon: <CalendarIcon /> },
                  { id: "snapshot", label: "Snapshot Flow", icon: <ActivityIcon /> },
                  { id: "spxflow", label: "SPX Flow", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg> },
                ] as const).map((tab) => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", background: "none", border: "none", cursor: "pointer", color: activeTab === tab.id ? C.cyan : "#fff", borderBottom: activeTab === tab.id ? `2px solid ${C.cyan}` : "2px solid transparent", marginBottom: -1 }}>
                    {tab.icon}{tab.label}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
                {activeTab === "calendar" && (
                  <div style={{ margin: "-24px", height: "calc(100% + 48px)" }}>
                    <EconCalendarPanel />
                  </div>
                )}
                {activeTab === "snapshot" && (
                  <div style={{ margin: -24, height: "calc(100% + 48px)" }}>
                    <SnapshotPanel />
                  </div>
                )}
                {activeTab === "spxflow" && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, opacity: 0.4 }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="1.5" strokeLinecap="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: "0.15em" }}>Coming Soon</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ width: "45%", display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>
            <div className="grad-divider-b" style={{ flexShrink: 0, paddingBottom: 16, marginBottom: 16, position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 6, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.08em" }}>SPX <span style={{ color: "#fff", fontWeight: 400 }}>/ GEX</span></span>
                  <div style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.10)", padding: "3px 10px", borderRadius: 4, fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: "#fff" }}>{etTime}</div>
                </div>
                <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.02)" }} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>VIX</span>
                  <span style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: "#fff" }}>{vix > 0 ? vix.toFixed(2) : "—"}</span>
                </div>
                <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.02)" }} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>ESU</span>
                  <span style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 800, color: "#fff" }}>{esFut > 0 ? esFut.toFixed(2) : "—"}</span>
                </div>
                <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.02)" }} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>SPX</span>
                  <span style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 800, color: "#fff" }}>{spot > 0 ? spot.toFixed(2) : "—"}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 500, color: spxChange >= 0 ? C.green : C.red }}>{spxChange >= 0 ? "+" : ""}{spxChange.toFixed(2)} ({spxChangePct >= 0 ? "+" : ""}{spxChangePct.toFixed(2)}%)</span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                  <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.02)", flexShrink: 0 }} />
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                    <span style={{ fontSize: 9, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>NET GEX</span>
                    <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: netGex >= 0 ? C.green : C.red }}>{fmtMoney(netGex)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                    <span style={{ fontSize: 9, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>FLIP</span>
                    <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#F97316" }}>{flipPoint ? formatStrikeValue(flipPoint) : "—"}</span>
                  </div>
                </div>
                <button style={{ background: "rgba(0,240,255,0.08)", border: "1px solid rgba(0,240,255,0.20)", color: C.cyan, fontSize: 9, fontWeight: 700, padding: "3px 10px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  Proxy Live
                </button>
              </div>
            </div>

            <div style={{ background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)", borderRadius: 16, display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
              <div className="grad-divider-b" style={{ paddingBottom: 16, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    <span style={{ color: C.cyan }}><LayersIcon /></span>
                    Live GEX Heatmap
                  </div>
                  <div style={{ fontSize: 10, color: "#8da8c2", fontWeight: 700 }}>{fmtExpiryLabel(selectedExpiry, expiryOptions.find((option) => option.value === selectedExpiry)?.label ?? "")}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  <span style={{ color: "#fff" }}>Stream</span>
                  <span style={{ color: C.cyan }}>{subscribedSymbolsRef.current.length} option symbols</span>
                </div>
              </div>

              <div style={{ flex: 1, overflow: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.05) transparent" }}>
                <table style={{ width: "100%", textAlign: "right", fontSize: 11, fontFamily: "monospace", whiteSpace: "nowrap", borderCollapse: "collapse" }}>
                  <thead style={{ fontSize: 9, color: "#fff", textTransform: "uppercase", letterSpacing: "0.1em", position: "sticky", top: 0, zIndex: 10, background: "rgba(13,17,25,0.95)" }}>
                    <tr>
                      {["Strike", "Net GEX", "Vol Only", "DEX", "VEX", "Delta W. GEX"].map((header, index) => (
                        <th key={header} style={{ padding: "12px 16px", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.06)", textAlign: index === 0 ? "left" : "right", color: index === 5 ? C.cyan : "#fff" }}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapRows.map((row, index) => {
                      const isAtm = row.type === "atm";
                      const showDivider = index > 0 && heatmapRows[index - 1]?.type === "atm";
                      const rowStyle: React.CSSProperties = {
                        background: isAtm ? "linear-gradient(to right, rgba(0,240,255,0.08), rgba(0,240,255,0.04), rgba(0,240,255,0.08))" : "transparent",
                        transition: "background 0.15s",
                        position: "relative",
                      };

                      const cellVal = (val: string, colIdx: number) => {
                        const isNegVal = val.startsWith("-");
                        const base: React.CSSProperties = { padding: "10px 16px", textAlign: colIdx === 0 ? "left" : "right" };
                        if (colIdx === 0) {
                          return (
                            <td key={colIdx} style={{ ...base, fontWeight: 700, color: isAtm ? C.cyan : "#fff" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {val}
                                {isAtm && <span style={{ color: C.cyan, fontWeight: 900, fontSize: 10, fontFamily: "sans-serif", letterSpacing: "0.1em" }}>ATM</span>}
                                {row.rank && <span style={{ background: row.rankColor, color: row.rankColor === "#F97316" ? "#000" : "#fff", padding: "1px 6px", borderRadius: 3, fontSize: 8, fontWeight: 700 }}>#{row.rank}</span>}
                              </div>
                            </td>
                          );
                        }

                        let cellBg = "transparent";
                        let cellColor = isAtm ? "#fff" : isNegVal ? "rgba(0,180,255,0.55)" : "rgba(255,255,255,0.80)";
                        let cellBorder = "none";
                        let cellFw: React.CSSProperties["fontWeight"] = 400;
                        if ((row.type === "pos-top" || row.type === "pos-strong") && !isNegVal && (colIdx === 1 || colIdx === 3)) {
                          cellBg = "rgba(14,116,144,0.30)";
                          cellBorder = "1px solid rgba(0,240,255,0.20)";
                          cellColor = row.type === "pos-top" ? "#fff" : "#00D9FF";
                          cellFw = 700;
                        }
                        if ((row.type === "neg-red" || row.type === "neg-top") && isNegVal && (colIdx === 1 || colIdx === 3)) {
                          cellBg = "rgba(0,60,100,0.45)";
                          cellBorder = "1px solid rgba(0,180,255,0.15)";
                          cellColor = C.cyan;
                          cellFw = 700;
                        }
                        if (isAtm) cellFw = 700;
                        if (colIdx === 5) {
                          cellBg = "rgba(0,0,0,0.20)";
                        }
                        return (
                          <td key={colIdx} style={{ ...base, background: cellBg, border: cellBorder, fontWeight: cellFw, color: cellColor, borderRadius: cellBorder !== "none" ? 4 : 0 }}>
                            {val}
                          </td>
                        );
                      };

                      return (
                        <>
                          {showDivider && (
                            <tr key={`div-${row.strike}`}>
                              <td colSpan={6} style={{ padding: 0, height: 1, background: "linear-gradient(to right, transparent, rgba(0,240,255,0.15), rgba(139,92,246,0.10), transparent)" }} />
                            </tr>
                          )}
                          <tr key={row.strike} className={isAtm ? "heatmap-row-atm" : "heatmap-row"} style={rowStyle}>
                            {cellVal(row.strike, 0)}
                            {cellVal(row.netGex, 1)}
                            {cellVal(row.volOnly, 2)}
                            {cellVal(row.dex, 3)}
                            {cellVal(row.vex, 4)}
                            {cellVal(row.dwGex, 5)}
                          </tr>
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </main>

      <style>{`
        .grad-divider-b {
          position: relative;
        }
        .grad-divider-b::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(to right, transparent 0%, rgba(255,255,255,0.10) 30%, rgba(255,255,255,0.13) 50%, rgba(255,255,255,0.10) 70%, transparent 100%);
          pointer-events: none;
        }
        .grad-divider-sidebar-t {
          position: relative;
        }
        .grad-divider-sidebar-t::before {
          content: '';
          position: absolute;
          top: 0; left: 12px; right: 12px;
          height: 1px;
          background: linear-gradient(to right, transparent, rgba(255,255,255,0.10) 50%, transparent);
          pointer-events: none;
        }
        .heatmap-row {
          position: relative;
        }
        .heatmap-row::after {
          content: '';
          position: absolute;
          bottom: 0; left: 8px; right: 8px;
          height: 1px;
          background: linear-gradient(to right, transparent 0%, rgba(255,255,255,0.07) 25%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.07) 75%, transparent 100%);
          pointer-events: none;
        }
        .heatmap-row-atm {
          position: relative;
        }
        .heatmap-row-atm::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(to right, transparent 0%, rgba(0,240,255,0.25) 30%, rgba(0,240,255,0.40) 50%, rgba(0,240,255,0.25) 70%, transparent 100%);
          pointer-events: none;
          z-index: 1;
        }
        .heatmap-row-atm::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(to right, transparent 0%, rgba(0,240,255,0.25) 30%, rgba(0,240,255,0.40) 50%, rgba(0,240,255,0.25) 70%, transparent 100%);
          pointer-events: none;
          z-index: 1;
        }
      `}</style>
    </div>
  );
}
