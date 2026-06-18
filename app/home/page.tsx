"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SnapshotPanel from "@/components/dashboard/SnapshotPanel";
import EconCalendarPanel from "@/components/dashboard/EconCalendarPanel";
import GexChart from "@/components/dashboard/GexChart";
import GexToolbar from "@/components/dashboard/GexToolbar";
import { type ChainRow, computeGEXProfile, findGEXFlip } from "@/lib/calculations/calculations";

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
  strikeNum: number;
  strike: string;
  // Raw numeric values (used for intensity coloring) + formatted text.
  netGexVal: number;   netGex: string;
  volOnlyVal: number;  volOnly: string;
  dexVal: number;      dex: string;
  gexVexVal: number;   gexVex: string;   // GEX + VEX (net GEX + vanna)
  rollingVal: number | null; rolling: string;  // 30-min rolling net GEX (DB)
  type: "pos-top" | "pos-strong" | "neg-top" | "neg-red" | "neg" | "neutral" | "atm";
  rank?: number;
  rankColor?: string;
  atm?: boolean;
};
// Intensity-scaled cell background. Ported from options-chain metricBg logic:
// rank-based floors for the top 3 magnitudes, power curve for the rest.
function metricBg(value: number, maxValue: number, intensity: number, topValues: number[]): string {
  if (!value) return "transparent";
  const abs = Math.abs(value);
  const ratio = Math.min(abs / Math.max(maxValue, 1), 1);
  const rank = topValues.indexOf(abs) + 1;
  let opacity: number;
  if (rank === 1) opacity = Math.max(0.82, intensity * 0.92);
  else if (rank === 2) opacity = Math.max(0.6, intensity * 0.78);
  else if (rank === 3) opacity = Math.max(0.4, intensity * 0.62);
  else opacity = Math.pow(ratio, 0.65) * intensity * 0.55;
  const finalOpacity = Math.min(opacity, 0.95).toFixed(3);
  return value > 0
    ? `rgba(32,178,220,${finalOpacity})`
    : `rgba(220,50,60,${finalOpacity})`;
}

type ExpiryOption = { value: string; label: string };
type GexMode = "net" | "call-put";
type DataMode = "oi-vol" | "vol-only";

const FEED_TYPES: FeedType[] = ["Quote", "Trade", "Summary", "Greeks"];
const OPTION_FEED_TYPES: FeedType[] = ["Quote", "Trade", "Summary", "Greeks"];
const SIDEBAR_SYMBOLS = ["SPY", "QQQ", "SPX", "VIX", "IWM"];
const INDEX_SYMBOLS = ["$SPX", "SPX", "/ESU26", "/ES:XCME", "VIX", ...SIDEBAR_SYMBOLS];


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

// Window the chain to N strikes above and N below the ATM strike (inclusive of
// ATM). Rows are returned descending by strike (highest at top). Centers on the
// strike nearest spot; clamps gracefully at the chain edges.
function pickCenterRows(rows: ChainRow[], spot: number, sideCount = 20): ChainRow[] {
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
  const start = Math.max(0, atmIndex - sideCount);
  const end = Math.min(sorted.length, atmIndex + sideCount + 1);
  return sorted.slice(start, end);
}

function toHeatmapRows(rows: ChainRow[], spot: number, rollingByStrike?: Map<number, number>): HeatmapRow[] {
  const windowRows = pickCenterRows(rows, spot, 20);
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
    const gexVex = net + vex;                         // GEX + VEX
    const rolling = rollingByStrike?.get(row.strike); // 30-min rolling net GEX
    const isAtm = row.strike === atmStrike;
    let type: HeatmapRow["type"] = "neutral";
    if (isAtm) type = "atm";
    else if (net >= 0 && rankMap.get(row.strike)?.rank === 1) type = "pos-top";
    else if (net >= 0 && (rankMap.get(row.strike)?.rank ?? 99) <= 3) type = "pos-strong";
    else if (net < 0 && rankMap.get(row.strike)?.rank === 1) type = "neg-top";
    else if (net < 0 && (rankMap.get(row.strike)?.rank ?? 99) <= 3) type = "neg-red";
    else if (net < 0) type = "neg";

    return {
      strikeNum: row.strike,
      strike: formatStrikeValue(row.strike),
      netGexVal: net,        netGex: fmtMoney(net),
      volOnlyVal: volOnly,   volOnly: fmtMoney(volOnly),
      dexVal: dex,           dex: fmtMoney(dex),
      gexVexVal: gexVex,     gexVex: fmtMoney(gexVex),
      rollingVal: rolling ?? null,
      rolling: rolling == null ? "—" : fmtMoney(rolling),
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
  const wsRef = useRef<WebSocket | null>(null);
  const gexWsRef = useRef<WebSocket | null>(null);
  const gexWsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveDataRef = useRef<Record<string, LiveEntry>>({});
  const subscribedSymbolsRef = useRef<string[]>([]);
  const lastSpotRef = useRef(0);
  const quoteSnapshotsRef = useRef<Record<string, { last: number; prev: number }>>({});
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const [now, setNow] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<"calendar" | "snapshot" | "spxflow">("calendar");
  const [gexMode, setGexMode] = useState<GexMode>("net");
  const [dataMode, setDataMode] = useState<DataMode>("oi-vol");
  const [showOI, setShowOI] = useState(false);
  const [showDex, setShowDex] = useState(false);
  const [showFlipCurve, setShowFlipCurve] = useState(false);
  const gexContainerRef = useRef<HTMLDivElement>(null);
  const [expiryOptions, setExpiryOptions] = useState<ExpiryOption[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const selectedExpiryRef = useRef("");
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
  // GEX chart rows pushed from /ws/gex broadcaster (server-computed loop)
  const [gexChainRows, setGexChainRows] = useState<ChainRow[]>([]);
  const [gexSpot, setGexSpot] = useState(0);
  // Heatmap intensity slider (0.2–3, default 0.4) — controls cell color opacity.
  const [intensity, setIntensity] = useState(0.4);
  // 30-min rolling net GEX per strike, pulled from the history DB.
  const [rollingByStrike, setRollingByStrike] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    quoteSnapshotsRef.current = quoteSnapshots;
  }, [quoteSnapshots]);

  useEffect(() => {
    selectedExpiryRef.current = selectedExpiry;
  }, [selectedExpiry]);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const scheduleRender = useCallback(() => {
    setRenderTick((current) => current + 1);
  }, []);

  // ── GEX WebSocket: connect to /ws/gex, receive pushed GEX_UPDATE from server loop ──
  // When user picks a different expiry, tell the server to switch
  const handleExpiry = useCallback((expiry: string) => {
    setSelectedExpiry(expiry);
    if (gexWsRef.current?.readyState === WebSocket.OPEN) {
      gexWsRef.current.send(JSON.stringify({ type: 'SET_EXPIRY', expiry }));
    }
  }, []);

  // Connect to /ws/gex and consume server-computed GEX state.
  // Tolerates both the server-v2 envelope ({ type, data }) and the legacy
  // flat broadcaster format ({ type:'GEX_UPDATE', gexRows, ... }) so the same
  // consumer works against either stack during migration.
  useEffect(() => {
    unmountedRef.current = false;

    // Apply a GEX payload (server-v2 `data` block OR legacy flat message).
    const applyGex = (p: Record<string, unknown>) => {
      if (Array.isArray(p.gexRows)) setGexChainRows(p.gexRows as ChainRow[]);
      const s = Number(p.spot ?? 0);
      if (s > 0) setGexSpot(s);
      const exps = p.expirations as string[] | undefined;
      if (Array.isArray(exps) && exps.length) {
        setExpiryOptions(buildExpiryOptions(exps));
        setSelectedExpiry((cur) => cur || String(p.expiry ?? exps[0] ?? ""));
      } else if (p.expiry) {
        setSelectedExpiry((cur) => cur || String(p.expiry));
      }
    };

    const handleMessage = (raw: string) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw); } catch { return; }
      const type = String(msg.type ?? "");
      // server-v2 nests under `data`; legacy puts fields on the message itself.
      const data = (msg.data && typeof msg.data === "object"
        ? msg.data
        : msg) as Record<string, unknown>;

      switch (type) {
        case "snapshot":
        case "gex":
        case "GEX_UPDATE":
          applyGex(data);
          setStatus("LIVE");
          break;
        case "spot": {
          const s = Number(data.spot ?? 0);
          if (s > 0) setGexSpot(s);
          break;
        }
        case "EXPIRATIONS":
        case "status": {
          const exps = data.expirations as string[] | undefined;
          if (Array.isArray(exps) && exps.length) {
            setExpiryOptions(buildExpiryOptions(exps));
            setSelectedExpiry((cur) => cur || String(data.expiry ?? exps[0] ?? ""));
          }
          break;
        }
        default:
          break; // flow/other handled elsewhere
      }
    };

    const connect = () => {
      if (unmountedRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/ws/gex`;
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch { scheduleReconnect(); return; }
      gexWsRef.current = ws;

      ws.onopen = () => {
        setStatus("LIVE");
        // Re-assert the chosen expiry on (re)connect so the server matches the UI.
        const exp = selectedExpiryRef.current;
        if (exp) {
          try { ws.send(JSON.stringify({ type: "SET_EXPIRY", expiry: exp })); } catch {}
        }
      };
      ws.onmessage = (evt) => handleMessage(String(evt.data));
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onclose = () => {
        setStatus("RECONNECTING");
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (unmountedRef.current) return;
      if (gexWsReconnectRef.current) clearTimeout(gexWsReconnectRef.current);
      gexWsReconnectRef.current = setTimeout(connect, 2000);
    };

    connect();

    return () => {
      unmountedRef.current = true;
      if (gexWsReconnectRef.current) clearTimeout(gexWsReconnectRef.current);
      const ws = gexWsRef.current;
      gexWsRef.current = null;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        try { ws.close(); } catch {}
      }
    };
    // Run once: the socket lives for the page's lifetime. The current expiry is
    // read from selectedExpiryRef on each (re)connect, so we never tear down the
    // socket on expiry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load chain symbols for heatmap WS subscription (separate from GEX chart data)
  const loadChain = useCallback(async (expiry: string) => {
    if (!expiry) return;
    void expiry;
    setStrikeRows([]);
    subscribedSymbolsRef.current = [];
    scheduleRender();
  }, [gexSpot, scheduleRender]);

  useEffect(() => {
    if (!selectedExpiry) return;
    loadChain(selectedExpiry).catch(() => {});
  }, [loadChain, selectedExpiry]);

  const handleRefresh = useCallback(async () => {
    if (selectedExpiry) await loadChain(selectedExpiry);
  }, [loadChain, selectedExpiry]);

  // Live WS-rebuilt chain — only accurate once symbols are subscribed and WS events arrive
  const wsChainRows = useMemo(() => {
    void renderTick;
    const liveSpot = spot > 0 ? spot : Number(quoteSnapshots.SPX?.last ?? 0);
    if (!(liveSpot > 0) || !strikeRows.length) return [] as ChainRow[];
    return buildChainRows(strikeRows, liveDataRef.current, liveSpot);
  }, [quoteSnapshots.SPX?.last, renderTick, spot, strikeRows]);

  // Both chart and heatmap use the server-pushed GEX rows (from /ws/gex broadcaster).
  // WS chain kicks in once live data arrives and overrides at least a few strikes.
  const chartRows = gexChainRows.length > 0 ? gexChainRows : wsChainRows;
  const chartSpot = gexSpot > 0 ? gexSpot : spot;

  // For heatmap: merge gexChainRows with any live WS updates for accurate real-time deltas
  const chainRows = useMemo(() => {
    if (!gexChainRows.length) return wsChainRows;
    if (!wsChainRows.length) return gexChainRows;
    // Build a map of WS-updated strikes for fast lookup
    const wsMap = new Map(wsChainRows.map(r => [r.strike, r]));
    // Use WS data only if it has non-zero gamma (i.e., live Greeks came in)
    return gexChainRows.map(row => {
      const ws = wsMap.get(row.strike);
      if (ws && ((ws.callGamma ?? 0) > 0 || (ws.putGamma ?? 0) > 0)) return ws;
      return row;
    });
  }, [gexChainRows, wsChainRows]);

  const heatmapRows = useMemo(() => {
    const useSpot = chartSpot > 0 ? chartSpot : spot;
    if (!(useSpot > 0) || !chainRows.length) return [] as HeatmapRow[];
    return toHeatmapRows(chainRows, useSpot, rollingByStrike);
  }, [chainRows, chartSpot, spot, rollingByStrike]);

  // Column maxes + top-3 magnitudes for intensity coloring (per visible column).
  const heatmapColorMeta = useMemo(() => {
    const cols = ["netGexVal", "volOnlyVal", "dexVal", "gexVexVal", "rollingVal"] as const;
    const max: Record<string, number> = {};
    const top3: Record<string, number[]> = {};
    for (const c of cols) {
      const absVals = heatmapRows
        .map((r) => Math.abs(Number(r[c] ?? 0)))
        .filter((v) => v > 0);
      max[c] = absVals.length ? Math.max(...absVals) : 1;
      top3[c] = [...absVals].sort((a, b) => b - a).slice(0, 3);
    }
    return { max, top3 };
  }, [heatmapRows]);

  // Poll the 30-min rolling net GEX history for the active expiry.
  useEffect(() => {
    if (!selectedExpiry) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(
          `/api/snapshots/option-strike-gex-history?expiry=${encodeURIComponent(selectedExpiry)}&minutes=30`,
          { cache: "no-store" }
        );
        if (!r.ok) return;
        const json = await r.json();
        const rows: Array<{ strike: number; rolling_net_gex: number }> = json?.rows ?? [];
        if (cancelled) return;
        setRollingByStrike(new Map(rows.map((x) => [Number(x.strike), Number(x.rolling_net_gex)])));
      } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [selectedExpiry]);

  // OI + Vol mode = OI-based net GEX PLUS volume-based net GEX (matches the label).
  // Vol Only mode = volume-based component alone.
  const netGexLive = useMemo(
    () => chartRows.reduce((sum, row) => {
      const v = dataMode === "vol-only"
        ? (row.netVolGEX ?? 0)
        : (row.netGEX ?? 0) + (row.netVolGEX ?? 0);
      return sum + v;
    }, 0),
    [chartRows, dataMode]
  );
  // Throttle the displayed value so the header doesn't jitter on every WS tick.
  const [netGex, setNetGexDisplay] = useState(0);
  const netGexLiveRef = useRef(0);
  useEffect(() => { netGexLiveRef.current = netGexLive; }, [netGexLive]);
  useEffect(() => {
    const id = setInterval(() => setNetGexDisplay(netGexLiveRef.current), 1000);
    return () => clearInterval(id);
  }, []);
  const flipPoint = useMemo(() => findGEXFlip(chartRows, chartSpot) ?? null, [chartRows, chartSpot]);
  const gexProfile = useMemo(() => computeGEXProfile(chartRows, chartSpot), [chartRows, chartSpot]);

  const etTime = now?.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }) ?? "--:--:--";

  const C = {
    bg: "#05060A",
    cyan: "#00F0FF",
    purple: "#8B5CF6",
    orange: "#F97316",
    green: "#10B981",
    red: "#EF4444",
  };

  return (
    <div style={{ height: "100%", width: "100%", overflow: "hidden", background: C.bg, backgroundImage: "radial-gradient(circle at 15% 50%, rgba(0,240,255,0.02) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(139,92,246,0.03) 0%, transparent 50%)", fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", color: "#fff", display: "flex", flexDirection: "column" }}>
      <main style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", minWidth: 0 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "row", padding: "24px", gap: 32, minHeight: 0, overflow: "hidden" }}>
          <div style={{ width: "55%", display: "flex", flexDirection: "column", minWidth: 0, height: "100%", overflow: "hidden", minHeight: 0 }}>
            <div ref={gexContainerRef} style={{ background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)", borderRadius: 16, display: "flex", flexDirection: "column", flex: "1 1 0", minHeight: 0, overflow: "hidden" }}>
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
                onExpiry={handleExpiry}
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
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                    <span style={{ color: "#94a3b8", fontWeight: 800 }}>Intensity</span>
                    <input
                      type="range"
                      min={0.2}
                      max={3}
                      step={0.01}
                      value={intensity}
                      onChange={(e) => setIntensity(Number(e.target.value))}
                      style={{ width: 100, accentColor: "#00e5ff", cursor: "pointer" }}
                    />
                    <span style={{ color: "#00e5ff", fontWeight: 700, minWidth: 36, textAlign: "right", fontFamily: "monospace" }}>{intensity.toFixed(2)}x</span>
                  </div>
                </div>
              </div>

              <div style={{ flex: 1, minHeight: 0, overflow: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.05) transparent" }}>
                <table style={{ width: "100%", height: "100%", textAlign: "right", fontSize: 11, fontFamily: "monospace", whiteSpace: "nowrap", borderCollapse: "collapse", tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "18%" }} />
                  </colgroup>
                  <thead style={{ fontSize: 9, color: "#fff", textTransform: "uppercase", letterSpacing: "0.1em", position: "sticky", top: 0, zIndex: 10, background: "rgba(13,17,25,0.95)" }}>
                    <tr>
                      {["Strike", "Net GEX", "Vol Only GEX", "DEX", "GEX + VEX", "30 Min Rolling Net GEX"].map((header, index) => (
                        <th key={header} style={{ padding: "12px 16px", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.06)", textAlign: index === 0 ? "left" : "right", color: index === 5 ? C.cyan : "#fff" }}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapRows.map((row, index) => {
                      const isAtm = row.type === "atm";
                      const showDivider = index > 0 && heatmapRows[index - 1]?.type === "atm";
                      const rowKey = `${row.strike}-${index}`;
                      const rowStyle: React.CSSProperties = {
                        background: isAtm ? "linear-gradient(to right, rgba(0,240,255,0.08), rgba(0,240,255,0.04), rgba(0,240,255,0.08))" : "transparent",
                        transition: "background 0.15s",
                        position: "relative",
                        // Distribute rows evenly into the available height so the
                        // heatmap stretches to fill the panel at any screen size.
                        height: heatmapRows.length ? `${100 / heatmapRows.length}%` : undefined,
                      };

                      // Numeric cell: background opacity from metricBg (intensity-scaled).
                      const dataCell = (text: string, value: number | null, colKey: string, colIdx: number) => {
                        const base: React.CSSProperties = { padding: "4px 16px", textAlign: "right" };
                        const bg = value == null
                          ? "transparent"
                          : metricBg(value, heatmapColorMeta.max[colKey] ?? 1, intensity, heatmapColorMeta.top3[colKey] ?? []);
                        return (
                          <td key={colIdx} style={{ ...base, background: bg, fontWeight: isAtm ? 700 : 400, color: "#fff" }}>
                            {text}
                          </td>
                        );
                      };

                      return (
                        <React.Fragment key={rowKey}>
                          {showDivider && (
                            <tr>
                              <td colSpan={6} style={{ padding: 0, height: 1, background: "linear-gradient(to right, transparent, rgba(0,240,255,0.15), rgba(139,92,246,0.10), transparent)" }} />
                            </tr>
                          )}
                          <tr className={isAtm ? "heatmap-row-atm" : "heatmap-row"} style={rowStyle}>
                            <td style={{ padding: "4px 16px", textAlign: "left", fontWeight: 700, color: isAtm ? C.cyan : "#fff" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {row.strike}
                                {isAtm && <span style={{ color: C.cyan, fontWeight: 900, fontSize: 10, fontFamily: "sans-serif", letterSpacing: "0.1em" }}>ATM</span>}
                                {row.rank && <span style={{ background: row.rankColor, color: row.rankColor === "#F97316" ? "#000" : "#fff", padding: "1px 6px", borderRadius: 3, fontSize: 8, fontWeight: 700 }}>#{row.rank}</span>}
                              </div>
                            </td>
                            {dataCell(row.netGex, row.netGexVal, "netGexVal", 1)}
                            {dataCell(row.volOnly, row.volOnlyVal, "volOnlyVal", 2)}
                            {dataCell(row.dex, row.dexVal, "dexVal", 3)}
                            {dataCell(row.gexVex, row.gexVexVal, "gexVexVal", 4)}
                            {dataCell(row.rolling, row.rollingVal, "rollingVal", 5)}
                          </tr>
                        </React.Fragment>
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
        /* No position:relative on <tr> — it displaces cells in table layout.
           Row separators / ATM emphasis use border + box-shadow on the cells. */
        .heatmap-row td {
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .heatmap-row-atm td {
          border-top: 1px solid rgba(0,240,255,0.35);
          border-bottom: 1px solid rgba(0,240,255,0.35);
        }
      `}</style>
    </div>
  );
}
