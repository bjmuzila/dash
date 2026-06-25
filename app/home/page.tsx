"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SnapshotPanel from "@/components/dashboard/SnapshotPanel";
import EconCalendarPanel from "@/components/dashboard/EconCalendarPanel";
import GexChart from "@/components/dashboard/GexChart";
import GexToolbar from "@/components/dashboard/GexToolbar";
import StrikeDetailPopup, { type PopupStyle } from "@/components/dashboard/StrikeDetailPopup";
import { useStrikeGexHistory } from "@/hooks/useStrikeGexHistory";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import SignalsPanel from "@/components/dashboard/SignalsPanel";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";
import { saveManualMvcSnapshot } from "@/components/shared/SnapButton";
import type { FlowOrder } from "@/hooks/useSpxFlow";
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
  gexVexVal: number;   gexVex: string;   // Net VEX (vanna)
  rollingVal: number | null; rolling: string;  // 30-min rolling net GEX (DB)
  type: "pos-top" | "pos-strong" | "neg-top" | "neg-red" | "neg" | "neutral" | "atm";
  rank?: number;
  rankColor?: string;
  atm?: boolean;
};
// Intensity-scaled cell background. Ported from options-chain metricBg logic:
// rank-based floors for the top 3 magnitudes, power curve for the rest.
function metricBg(value: number, maxValue: number, intensity: number, topValues: number[]): string {
  const n = value || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return "transparent";
  const pos = n >= 0;
  const rank = topValues.indexOf(Math.abs(n)) + 1;
  if (rank === 1) return pos ? "rgba(41,182,246,0.90)" : "rgba(255,71,87,0.90)";
  if (rank === 2) return pos ? "rgba(41,182,246,0.45)" : "rgba(255,71,87,0.45)";
  if (rank === 3) return pos ? "rgba(41,182,246,0.25)" : "rgba(255,71,87,0.25)";
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio * (intensity || 0.1), 1.4);
  const alpha = Math.min(0.18, 0.02 + eased * 0.16);
  return pos ? `rgba(41,182,246,${alpha.toFixed(2)})` : `rgba(255,71,87,${alpha.toFixed(2)})`;
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

// Net GEX header value is already denominated in BILLIONS of dollars.
function fmtMoneyB(vB: number) {
  if (!isFinite(vB)) return "--";
  return fmtMoney(vB * 1e9);
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
    const vex = (row.netVanna ?? 0) + (row.netVolVanna ?? 0);  // Net VEX (vanna)
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
      gexVexVal: vex,        gexVex: fmtMoney(vex),
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
  // Bandwidth gate: socket stays open only while the tab is visible AND the user
  // is active (15-min idle timeout; owner exempt). Drives connect/disconnect.
  const shouldConnect = useWsLifecycle();
  const shouldConnectRef = useRef(shouldConnect);
  shouldConnectRef.current = shouldConnect;

  const wsRef = useRef<WebSocket | null>(null);
  const gexWsRef = useRef<WebSocket | null>(null);
  const gexWsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveDataRef = useRef<Record<string, LiveEntry>>({});
  const subscribedSymbolsRef = useRef<string[]>([]);
  const lastSpotRef = useRef(0);
  const quoteSnapshotsRef = useRef<Record<string, { last: number; prev: number }>>({});
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  // Heavy-frame throttle: gex/GEX_UPDATE/snapshot frames trigger a full recompute
  // cascade (chain reduce, heatmap, colorMeta, MVC scans). Under a fast feed they
  // arrive faster than React can render, blocking the main thread for seconds and
  // freezing clicks/navigation. We coalesce them to the latest frame, applied at
  // most once per HEAVY_FRAME_MS, so the UI stays responsive without losing data.
  const pendingGexRef = useRef<Record<string, unknown> | null>(null);
  const gexFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGexAppliedRef = useRef(0);

  const [now, setNow] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<"calendar" | "snapshot" | "signals">("calendar");
  const [gexMode, setGexMode] = useState<GexMode>("net");

  // ── Ticker auto-fit: scale the whole ticker box down so it always fits its
  // column, measuring real widths so NQU never clips at any window size. ──
  const tickerCqRef = useRef<HTMLDivElement | null>(null);   // the column-width container
  const tickerBoxRef = useRef<HTMLDivElement | null>(null);  // the natural-width ticker
  const tickerScaleRef = useRef(1);
  const [tickerScale, setTickerScale] = useState(1);
  const [tickerBoxH, setTickerBoxH] = useState(0); // natural (unscaled) box height, px
  useEffect(() => {
    const cq = tickerCqRef.current, box = tickerBoxRef.current;
    if (!cq || !box) return;
    const fit = () => {
      const s = tickerScaleRef.current || 1;
      // The box is width:100% and its rows use space-between, so it normally
      // fills the column exactly (stretches with the window). It only needs to
      // SHRINK when the items' minimum widths can't fit: in that case the box
      // overflows and scrollWidth > clientWidth. Use that ratio as a clip guard.
      // (scrollWidth/clientWidth are layout-box values, unaffected by transform.)
      const overflow = box.scrollWidth / Math.max(1, box.clientWidth);
      const next = overflow > 1.001 ? Math.min(1, s / overflow) : 1;
      if (Math.abs(next - s) > 0.005) { tickerScaleRef.current = next; setTickerScale(next); }
      setTickerBoxH(box.offsetHeight);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(cq);
    ro.observe(box);
    fit();
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [dataMode, setDataMode] = useState<DataMode>("oi-vol");
  const [showOI, setShowOI] = useState(false);
  const [showDex, setShowDex] = useState(false);
  const [showFlipCurve, setShowFlipCurve] = useState(false);
  // Prior-state ghost overlays (5/15/30 min ago) drawn behind live GEX bars.
  const [showGhost5, setShowGhost5]   = useState(false);
  const [showGhost15, setShowGhost15] = useState(false);
  const [showGhost30, setShowGhost30] = useState(false);
  // Strike-detail popup: selected strike, click anchor, and which popup style to
  // preview (card | drawer | modal — toggled in the toolbar so all 3 can be tested).
  const [selectedStrike, setSelectedStrike] = useState<{ row: ChainRow; pos: { x: number; y: number } } | null>(null);
  const popupStyle: PopupStyle = "card";
  const gexContainerRef = useRef<HTMLDivElement>(null);
  const heatmapContainerRef = useRef<HTMLDivElement>(null);
  // Snapshot-to-DB button state for the heatmap header.
  const [snapDbState, setSnapDbState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const recordSnapshot = useCallback(async () => {
    if (snapDbState === "busy") return;
    setSnapDbState("busy");
    try { await saveManualMvcSnapshot(); setSnapDbState("ok"); }
    catch { setSnapDbState("err"); }
    finally { setTimeout(() => setSnapDbState("idle"), 1800); }
  }, [snapDbState]);
  const [expiryOptions, setExpiryOptions] = useState<ExpiryOption[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const selectedExpiryRef = useRef("");
  const [strikeRows, setStrikeRows] = useState<StrikeRow[]>([]);
  const [spot, setSpot] = useState(0);
  // Display SPX: live broker quote during RTH, ES-derived off-hours (server's
  // spotDisplay). Used ONLY for the SPX readout + change %, never for GEX math
  // (which stays on `spot`/`gexSpot`, the broker quote the strikes are priced on).
  const [spotDisplay, setSpotDisplay] = useState(0);
  const [esFut, setEsFut] = useState(0);
  const [vix, setVix] = useState(0);
  const [spxChange, setSpxChange] = useState(0);
  const [spxChangePct, setSpxChangePct] = useState(0);
  const [sidebarQuotes, setSidebarQuotes] = useState<QuoteTile[]>(SIDEBAR_SYMBOLS.map((sym) => ({ sym, chg: "—", pos: true, active: sym === "SPX" })));
  const [quoteSnapshots, setQuoteSnapshots] = useState<Record<string, { last: number; prev: number }>>({});
  const [renderTick, setRenderTick] = useState(0);
  const [status, setStatus] = useState("READY");
  // True once the server reports OI + greeks are warm. Until then the GEX chart
  // shows a loader so a half-warmed / inflated frame never renders.
  const [chartReady, setChartReady] = useState(false);
  // GEX chart rows pushed from /ws/gex broadcaster (server-computed loop)
  const [gexChainRows, setGexChainRows] = useState<ChainRow[]>([]);
  const [gexSpot, setGexSpot] = useState(0);
  // Summary levels from server gex message.
  const [callWall, setCallWall] = useState<number | null>(null);
  const [putWall, setPutWall] = useState<number | null>(null);
  // Prior closes for VIX / ESU from the proxy (Tastytrade) for day-change %.
  const [vixPrevClose, setVixPrevClose] = useState(0);
  const [esuPrevClose, setEsuPrevClose] = useState(0);
  // Fallback prior-closes from /api/quotes-batch (Yahoo) when the server feed
  // doesn't supply them — keeps VIX/ESU day-change % populated and sane.
  const [vixPrevFallback, setVixPrevFallback] = useState(0);
  const [esuPrevFallback, setEsuPrevFallback] = useState(0);
  // (VIX/ESU day-change % derivations moved to the toolbar ticker, which sources
  // its own quotes; the prev-close state above still feeds other readouts.)
  // SPX flow tape (per-order) pushed from the server `flow` WS message.
  const [flowOrders, setFlowOrders] = useState<FlowOrder[]>([]);
  // Full server flow bucket (vols/premium) for the Snapshot panel.
  const [flowBucket, setFlowBucket] = useState<Record<string, unknown> | null>(null);
  // Heatmap intensity slider (0.5–3, default 1.75) — controls cell color opacity.
  const [intensity, setIntensity] = useState(1.75);
  // Heatmap panel view: "heatmap" = colored cell backgrounds; "table" = divergent bars.
  const [heatmapView, setHeatmapView] = useState<"heatmap" | "table">("heatmap");
  // 30-min rolling net GEX per strike, pulled from the history DB.
  const [rollingByStrike, setRollingByStrike] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    quoteSnapshotsRef.current = quoteSnapshots;
  }, [quoteSnapshots]);

  // Poll Yahoo-backed quotes-batch for VIX/ESU prior closes as a fallback when
  // the /ws/gex feed doesn't deliver them (keeps top-bar day-change % correct).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/quotes-batch?symbols=VIX,/ESU26", { cache: "no-store" });
        if (!r.ok) return;
        const json = await r.json();
        const items: Array<Record<string, unknown>> = json?.data?.items ?? [];
        if (cancelled) return;
        for (const it of items) {
          const sym = String(it.symbol ?? "");
          const prev = Number(it["prev-close"] ?? 0);
          if (!(prev > 0)) continue;
          if (sym === "VIX") setVixPrevFallback(prev);
          else if (sym.startsWith("/ES")) setEsuPrevFallback(prev);
        }
      } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

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
    // New expiry re-gates on the server; show the loader until it warms again.
    setChartReady(false);
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
    // Update SPX spot + change vs prior close, plus aux VIX/ESU quotes.
    // `s` is the broker quote (drives math); `disp` is the display SPX (readout +
    // change). When disp is absent we fall back to s so nothing regresses.
    const applySpot = (s: number, prevClose: number, disp?: number) => {
      if (s > 0) setSpot(s);
      const shown = disp && disp > 0 ? disp : s;
      if (shown > 0) {
        setSpotDisplay(shown);
        if (prevClose > 0) {
          setSpxChange(shown - prevClose);
          setSpxChangePct(((shown - prevClose) / prevClose) * 100);
        }
      }
    };

    const applyGex = (p: Record<string, unknown>) => {
      if (Array.isArray(p.gexRows)) setGexChainRows(p.gexRows as ChainRow[]);
      const s = Number(p.spot ?? 0);
      if (s > 0) setGexSpot(s);
      applySpot(s, Number(p.prevClose ?? 0), Number(p.spotDisplay ?? 0));
      if (Number(p.vix ?? 0) > 0) setVix(Number(p.vix));
      if (Number(p.esFut ?? 0) > 0) setEsFut(Number(p.esFut));
      if (Number(p.vixPrevClose ?? 0) > 0) setVixPrevClose(Number(p.vixPrevClose));
      if (Number(p.esFutPrevClose ?? 0) > 0) setEsuPrevClose(Number(p.esFutPrevClose));
      if (p.callWall != null) setCallWall(Number(p.callWall) || null);
      if (p.putWall != null) setPutWall(Number(p.putWall) || null);
      const exps = p.expirations as string[] | undefined;
      if (Array.isArray(exps) && exps.length) {
        setExpiryOptions(buildExpiryOptions(exps));
        setSelectedExpiry((cur) => cur || String(p.expiry ?? exps[0] ?? ""));
      } else if (p.expiry) {
        setSelectedExpiry((cur) => cur || String(p.expiry));
      }
    };

    // Coalesce heavy frames: remember the latest payload + its readiness, then
    // apply on a trailing timer no more than once per HEAVY_FRAME_MS. Leading edge
    // fires immediately so the first frame paints with no delay.
    const HEAVY_FRAME_MS = 200; // ≤5 recomputes/sec — well under perceptual jitter
    const flushGex = () => {
      gexFlushTimerRef.current = null;
      const data = pendingGexRef.current;
      pendingGexRef.current = null;
      if (!data) return;
      lastGexAppliedRef.current = Date.now();
      applyGex(data);
      setStatus("LIVE");
      const st = (data.__status ?? undefined) as Record<string, unknown> | undefined;
      if (data.__isSnapshot) {
        if (st && typeof st.chartReady === "boolean") setChartReady(st.chartReady);
      } else {
        setChartReady(true);
      }
    };
    const queueGex = (data: Record<string, unknown>, isSnapshot: boolean, st: unknown) => {
      // Stash readiness flags on the payload so flushGex applies the latest frame's.
      data.__isSnapshot = isSnapshot;
      data.__status = st;
      pendingGexRef.current = data;
      const since = Date.now() - lastGexAppliedRef.current;
      if (since >= HEAVY_FRAME_MS) {
        flushGex(); // leading edge — no pending timer, apply now
      } else if (!gexFlushTimerRef.current) {
        gexFlushTimerRef.current = setTimeout(flushGex, HEAVY_FRAME_MS - since);
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
        case "GEX_UPDATE": {
          // Throttled: queue the latest frame instead of recomputing every tick.
          const st = (data.status ?? msg.status) as Record<string, unknown> | undefined;
          queueGex(data, type === "snapshot", st);
          break;
        }
        case "spot": {
          const s = Number(data.spot ?? 0);
          if (s > 0) setGexSpot(s);
          applySpot(s, Number(data.prevClose ?? 0), Number(data.spotDisplay ?? 0));
          break;
        }
        case "aux": {
          if (Number(data.vix ?? 0) > 0) setVix(Number(data.vix));
          if (Number(data.esFut ?? 0) > 0) setEsFut(Number(data.esFut));
          if (Number(data.vixPrevClose ?? 0) > 0) setVixPrevClose(Number(data.vixPrevClose));
          if (Number(data.esFutPrevClose ?? 0) > 0) setEsuPrevClose(Number(data.esFutPrevClose));
          // Display SPX rides on ES off-hours; aux carries its live updates. Use
          // the last known prevClose (from prior spot/gex frames) for the change.
          if (Number(data.spotDisplay ?? 0) > 0) setSpotDisplay(Number(data.spotDisplay));
          break;
        }
        case "flow": {
          // Server sends the full capped tape (oldest-first) each message.
          const tape = data.tape as FlowOrder[] | undefined;
          if (Array.isArray(tape)) setFlowOrders(tape);
          setFlowBucket(data);
          break;
        }
        case "EXPIRATIONS":
        case "status": {
          const exps = data.expirations as string[] | undefined;
          if (Array.isArray(exps) && exps.length) {
            setExpiryOptions(buildExpiryOptions(exps));
            setSelectedExpiry((cur) => cur || String(data.expiry ?? exps[0] ?? ""));
          }
          if (typeof data.chartReady === "boolean") setChartReady(data.chartReady);
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
      // Don't reconnect while the lifecycle gate says we shouldn't be live
      // (backgrounded tab, or 15-min user inactivity). The gate flip re-opens us.
      if (!shouldConnectRef.current) return;
      if (gexWsReconnectRef.current) clearTimeout(gexWsReconnectRef.current);
      gexWsReconnectRef.current = setTimeout(connect, 2000);
    };

    // Value-driven gate: this effect re-runs whenever `shouldConnect` flips
    // (tab background/foreground, idle timeout). When allowed, connect; when not,
    // the cleanup below tears the socket down. No polling, no churn.
    if (shouldConnect) connect();

    return () => {
      unmountedRef.current = true;
      if (gexWsReconnectRef.current) clearTimeout(gexWsReconnectRef.current);
      if (gexFlushTimerRef.current) { clearTimeout(gexFlushTimerRef.current); gexFlushTimerRef.current = null; }
      pendingGexRef.current = null;
      const ws = gexWsRef.current;
      gexWsRef.current = null;
      if (ws) {
        ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => { try { ws.close(); } catch {} };
        } else {
          ws.onopen = null;
          try { ws.close(); } catch {}
        }
      }
    };
    // Re-runs only when the bandwidth gate flips. The current expiry is read from
    // selectedExpiryRef on each (re)connect, so expiry changes don't churn this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldConnect]);

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
    const cols = ["netGexVal", "volOnlyVal", "dexVal", "gexVexVal"] as const;
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

  // MVC for the heatmap table — single strike with the highest ABSOLUTE net GEX
  // across the heatmap rows. Gets the gold star in the heatmap. Distinct from the
  // chart/top-bar MVC (`mvcStrike`, computed from chartRows below).
  const mvcStrikeHeatmap = useMemo(() => {
    let best: number | null = null;
    let bestAbs = 0;
    for (const r of heatmapRows) {
      const a = Math.abs(Number(r.netGexVal ?? 0));
      if (a > bestAbs) { bestAbs = a; best = r.strikeNum; }
    }
    return best;
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
  // Total net GEX — identical definition to the Insights → Exposure Stack page
  // (computeExposureSnapshot): full chain, contracts = open interest + volume,
  // net = (callGamma·callContracts − putGamma·putContracts) · spot² · 0.01 · 100, in $B.
  const netGexLive = useMemo(() => {
    const s = chartSpot;
    if (!(s > 0)) return 0;
    const total = chartRows.reduce((sum, row) => {
      const callContracts = (row.callOI ?? 0) + (row.callVolume ?? 0);
      const putContracts  = (row.putOI ?? 0) + (row.putVolume ?? 0);
      const g = ((row.callGamma ?? 0) * callContracts) - ((row.putGamma ?? 0) * putContracts);
      return sum + g * s * s * 0.01 * 100;
    }, 0);
    return total / 1e9;
  }, [chartRows, chartSpot]);
  // Throttle the displayed value so the header doesn't jitter on every WS tick.
  const [netGex, setNetGexDisplay] = useState(0);
  const netGexLiveRef = useRef(0);
  useEffect(() => { netGexLiveRef.current = netGexLive; }, [netGexLive]);
  useEffect(() => {
    const id = setInterval(() => setNetGexDisplay(netGexLiveRef.current), 1000);
    return () => clearInterval(id);
  }, []);
  // Point-in-time net GEX baselines (open / 5 / 15 / 30 min) for the popup's
  // rolling-difference boxes. Only polls while a strike is selected.
  const strikeBaselines = useStrikeGexHistory(selectedStrike ? selectedExpiry : "", [5, 15, 30]);

  // Chart ghost-bar baselines — poll the full chain whenever any prior-state
  // overlay (5/15/30 min) is enabled.
  const anyGhost = showGhost5 || showGhost15 || showGhost30;
  const chartBaselines = useStrikeGexHistory(anyGhost ? selectedExpiry : "", [5, 15, 30], 30_000, true);

  // Strike → full ChainRow lookup so the heatmap rows can open the same popup.
  const chartRowByStrike = useMemo(
    () => new Map(chartRows.map((r) => [r.strike, r])),
    [chartRows]
  );

  const flipPoint = useMemo(() => findGEXFlip(chartRows, chartSpot) ?? null, [chartRows, chartSpot]);
  // MVC = strike carrying the peak |netGEX| (most valuable concentration).
  // Single source of truth: largest |netGEX| only — matches the GexChart MVC label
  // and SnapButton.getHighestRow so chart, top-bar, and snapshot always agree.
  const mvcStrike = useMemo(() => {
    let best: number | null = null;
    let bestAbs = 0;
    for (const r of chartRows) {
      const v = Math.abs(r.netGEX ?? 0);
      if (v > bestAbs) { bestAbs = v; best = r.strike; }
    }
    return best;
  }, [chartRows]);
  const gexProfile = useMemo(() => computeGEXProfile(chartRows, chartSpot, dataMode), [chartRows, chartSpot, dataMode]);

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
    <div style={{ flex: 1, minHeight: 0, width: "100%", overflow: "hidden", backgroundColor: C.bg, backgroundImage: "radial-gradient(circle at 15% 50%, rgba(0,240,255,0.02) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(139,92,246,0.03) 0%, transparent 50%)", fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", color: "#fff", display: "flex", flexDirection: "column" }}>
      <main className="home-no-hover" style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", minWidth: 0 }}>
        <div className="home-split" style={{ flex: 1, display: "flex", flexDirection: "row", padding: "24px", gap: 32, minHeight: 0, overflow: "hidden" }}>
          <div className="home-col home-col-left" style={{ width: "55%", display: "flex", flexDirection: "column", minWidth: 0, height: "100%", overflow: "hidden", minHeight: 0 }}>
            <div ref={gexContainerRef} style={{ background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)", borderRadius: 16, display: "flex", flexDirection: "column", flex: "1.6 1 0", minHeight: 0, overflow: "hidden" }}>
              {/* GEX title row */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px 6px", flexShrink: 0 }}>
                <span style={{ color: C.cyan }}><BarChart2 /></span>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.1em" }}>NET GEX</span>
                <span suppressHydrationWarning style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "#e8edf5", fontVariantNumeric: "tabular-nums", letterSpacing: ".05em" }}>{etTime}</span>
                <button onClick={recordSnapshot} disabled={snapDbState === "busy"} title="Record snapshot to database"
                  style={{ background: "rgba(0,240,255,0.08)", border: "1px solid rgba(0,240,255,0.20)", color: snapDbState === "ok" ? "#00e676" : snapDbState === "err" ? "#ef4444" : C.cyan, fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.1em", cursor: "pointer", whiteSpace: "nowrap" }}>
                  {snapDbState === "busy" ? "Saving…" : snapDbState === "ok" ? "Saved ✓" : snapDbState === "err" ? "Error ✕" : "📸 Snapshot"}
                </button>
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
                showGhost5={showGhost5}
                showGhost15={showGhost15}
                showGhost30={showGhost30}
                onToggleOI={() => setShowOI(v => !v)}
                onToggleDex={() => setShowDex(v => !v)}
                onToggleFlip={() => setShowFlipCurve(v => !v)}
                onToggleGhost5={() => { setShowGhost5(v => !v); setShowGhost15(false); setShowGhost30(false); }}
                onToggleGhost15={() => { setShowGhost15(v => !v); setShowGhost5(false); setShowGhost30(false); }}
                onToggleGhost30={() => { setShowGhost30(v => !v); setShowGhost5(false); setShowGhost15(false); }}
                onRefresh={handleRefresh}
                containerRef={gexContainerRef}
                discordMessage={`NET GEX • ${selectedExpiry}`}
              />
              {/* Chart canvas — uses fast gex-chain data. Held behind a loader
                  until the server reports OI + greeks are warm, so a half-built
                  / inflated frame never renders. */}
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
                {chartReady && chartRows.length > 0 ? (
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
                    baselines={chartBaselines}
                    showGhost5={showGhost5}
                    showGhost15={showGhost15}
                    showGhost30={showGhost30}
                    expiry={selectedExpiry}
                    onStrikeClick={(row, pos) => setSelectedStrike({ row, pos })}
                  />
                ) : (
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "#05080d" }}>
                    <style>{`@keyframes gexspin{to{transform:rotate(360deg)}}`}</style>
                    <div style={{ width: 44, height: 44, borderRadius: "50%", border: `3px solid rgba(0,240,255,0.15)`, borderTopColor: C.cyan, animation: "gexspin 0.8s linear infinite" }} />
                    <div style={{ color: C.cyan, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em" }}>Loading SPX chain…</div>
                    <div style={{ color: "#5a6b85", fontSize: 11, letterSpacing: "0.06em" }}>Warming OI &amp; greeks for accurate GEX</div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)", borderRadius: 16, display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden", marginTop: 24 }}>
              <div className="grad-divider-b" style={{ display: "flex", flexShrink: 0 }}>
                {([
                  { id: "calendar", label: "Economic Calendar", icon: <CalendarIcon /> },
                  { id: "snapshot", label: "Snapshot Flow", icon: <ActivityIcon /> },
                  { id: "signals", label: "Signals", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg> },
                ] as const).map((tab) => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", background: "none", border: "none", cursor: "pointer", color: activeTab === tab.id ? C.cyan : "#fff", borderBottom: activeTab === tab.id ? `2px solid ${C.cyan}` : "2px solid transparent", marginBottom: -1 }}>
                    {tab.icon}{tab.label}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
                {activeTab === "calendar" && (
                  <div className="tab-panel-embed" style={{ margin: "-24px", height: "calc(100% + 48px)" }}>
                    <EconCalendarPanel />
                  </div>
                )}
                {activeTab === "snapshot" && (
                  <div className="tab-panel-embed" style={{ margin: -24, height: "calc(100% + 48px)" }}>
                    <SnapshotPanel orders={flowOrders} bucket={flowBucket} />
                  </div>
                )}
                {activeTab === "signals" && (
                  <div className="tab-panel-embed" style={{ margin: -24, height: "calc(100% + 48px)" }}>
                    <SignalsPanel orders={flowOrders} bucket={flowBucket} esPrice={esFut} />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="home-col home-col-right" style={{ width: "45%", display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>
            <div ref={tickerCqRef} className="grad-divider-b" style={{ flexShrink: 0, paddingBottom: 16, marginBottom: 16, position: "relative", overflow: "hidden" }}>
             <div ref={tickerBoxRef} style={{ display: "block", width: "100%", whiteSpace: "nowrap", transformOrigin: "top left", transform: `scale(${tickerScale})`, marginBottom: tickerBoxH ? -(tickerBoxH * (1 - tickerScale)) : 0 }}>
              {/* VIX / ESU / SPX / NQU quotes moved to the global top toolbar (ToolbarTicker). */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "nowrap", justifyContent: "space-between", width: "100%", minWidth: 0, paddingLeft: 13 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>NET GEX</span>
                    <span style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 800, color: netGex >= 0 ? C.green : C.red }}>{fmtMoneyB(netGex)}</span>
                  </div>
                  <span style={{ color: "rgba(255,255,255,0.18)", fontSize: 16, fontWeight: 300, lineHeight: 1, flexShrink: 0 }}>│</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>CALL WALL</span>
                    <span style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 800, color: C.green }}>{callWall ? formatStrikeValue(callWall) : "—"}</span>
                  </div>
                  <span style={{ color: "rgba(255,255,255,0.18)", fontSize: 16, fontWeight: 300, lineHeight: 1, flexShrink: 0 }}>│</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>PUT WALL</span>
                    <span style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 800, color: C.red }}>{putWall ? formatStrikeValue(putWall) : "—"}</span>
                  </div>
                  <span style={{ color: "rgba(255,255,255,0.18)", fontSize: 16, fontWeight: 300, lineHeight: 1, flexShrink: 0 }}>│</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>FLIP</span>
                    <span style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 800, color: "#F97316" }}>{flipPoint ? formatStrikeValue(flipPoint) : "—"}</span>
                  </div>
                  <span style={{ color: "rgba(255,255,255,0.18)", fontSize: 16, fontWeight: 300, lineHeight: 1, flexShrink: 0 }}>│</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: C.purple, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>MVC</span>
                    <span style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 800, color: C.purple }}>{mvcStrike ? formatStrikeValue(mvcStrike) : "—"}</span>
                  </div>
              </div>
             </div>
            </div>

            <div ref={heatmapContainerRef} style={{ background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)", borderRadius: 16, display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
              <div className="grad-divider-b" style={{ paddingBottom: 16, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    <span style={{ color: C.cyan }}><LayersIcon /></span>
                    Live GEX Heatmap
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
                      <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Intensity</span>
                      <input
                        type="range" min={0.5} max={3} step={0.01}
                        value={intensity}
                        onChange={(e) => setIntensity(Number(e.target.value))}
                        style={{ width: 80, height: 3, accentColor: "#00e5ff" }}
                      />
                      <span style={{ fontSize: 10, color: "#00e5ff", fontWeight: 700, minWidth: 36, fontFamily: "monospace" }}>{intensity.toFixed(2)}x</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ display: "flex", gap: 2, marginRight: 4, border: "1px solid rgba(0,229,255,0.18)", borderRadius: 4, overflow: "hidden" }}>
                      {(["heatmap", "table"] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => setHeatmapView(v)}
                          style={{
                            padding: "2px 10px",
                            fontSize: 9,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            cursor: "pointer",
                            border: "none",
                            fontFamily: "inherit",
                            background: heatmapView === v ? "rgba(0,229,255,0.14)" : "transparent",
                            color: heatmapView === v ? "#00e5ff" : "#5a7a98",
                          }}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: "#8da8c2", fontWeight: 700, marginRight: 4 }}>{fmtExpiryLabel(selectedExpiry, expiryOptions.find((option) => option.value === selectedExpiry)?.label ?? "")}</div>
                    <button onClick={handleRefresh} title="Refresh heatmap"
                      style={{ background: "rgba(0,229,255,0.06)", border: "1px solid rgba(0,229,255,0.25)", color: C.cyan, borderRadius: 2, padding: "2px 6px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>↻</button>
                    <BoxSnapBtn targetRef={heatmapContainerRef} label="GEX Heatmap" />
                    <BoxDiscordBtn targetRef={heatmapContainerRef} label="GEX Heatmap" message={`GEX Heatmap • ${selectedExpiry}`} />
                  </div>
                </div>
              </div>

              <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", height: "100%", textAlign: "right", fontSize: 12, fontFamily: "monospace", whiteSpace: "nowrap", borderCollapse: "collapse", tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "22.5%" }} />
                    <col style={{ width: "22.5%" }} />
                    <col style={{ width: "22.5%" }} />
                    <col style={{ width: "22.5%" }} />
                  </colgroup>
                  <thead style={{ fontSize: 11, color: "#fff", textTransform: "uppercase", letterSpacing: "0.1em", position: "sticky", top: 0, zIndex: 10, background: "rgba(13,17,25,0.95)" }}>
                    <tr>
                      {["Strike", "Net GEX", "Vol Only GEX", "DEX", "Net VEX"].map((header, index) => (
                        <th key={header} style={{ padding: "6px 16px", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.06)", textAlign: index === 0 || heatmapView === "table" ? "left" : "right", color: "#fff" }}>{header}</th>
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

                      // Light white frame drawn around the full ATM row (top/bottom on
                      // every cell, plus a right edge on the final column).
                      const atmBorder = "1px solid rgba(255,255,255,0.55)";

                      // Left-anchored gradient bar (table view): width 0–100% scaled to the
                      // column max, grows rightward from the left edge. Green = positive,
                      // red = negative. Higher magnitude → darker/deeper gradient.
                      const barEl = (value: number | null, colKey: string) => {
                        if (value == null || !Number.isFinite(value)) return null;
                        const max = heatmapColorMeta.max[colKey] ?? 1;
                        const ratio = Math.min(Math.abs(value) / (max || 1), 1);
                        const pct = ratio * 90; // biggest bar fills 90% of the cell
                        if (!pct) return null;
                        const pos = value >= 0;
                        // Vibrant gradient: bright leading edge → saturated deep base.
                        // Opacity deepens with magnitude so big bars read as more intense.
                        const a = 0.5 + ratio * 0.5;
                        const light = pos
                          ? `rgba(74,255,150,${a.toFixed(2)})`
                          : `rgba(255,86,110,${a.toFixed(2)})`;
                        const dark = pos
                          ? `rgba(0,140,70,${a.toFixed(2)})`
                          : `rgba(190,20,40,${a.toFixed(2)})`;
                        return (
                          <div style={{
                            position: "absolute",
                            top: 3,
                            bottom: 3,
                            left: 0,
                            width: `${pct}%`,
                            background: `linear-gradient(90deg, ${dark} 0%, ${light} 100%)`,
                            borderRadius: 2,
                            pointerEvents: "none",
                          }} />
                        );
                      };

                      // Numeric cell: heatmap view paints a background; table view draws a bar.
                      const dataCell = (text: string, value: number | null, colKey: string, colIdx: number) => {
                        const isTable = heatmapView === "table";
                        const base: React.CSSProperties = { position: "relative", padding: "0 16px", textAlign: isTable ? "left" : "right", lineHeight: 1.1, overflow: "hidden" };
                        const bg = isTable || value == null
                          ? "transparent"
                          : metricBg(value, heatmapColorMeta.max[colKey] ?? 1, intensity, heatmapColorMeta.top3[colKey] ?? []);
                        const atmEdges: React.CSSProperties = isAtm
                          ? { borderTop: atmBorder, borderBottom: atmBorder, ...(colIdx === 5 ? { borderRight: atmBorder } : {}) }
                          : {};
                        return (
                          <td key={colIdx} style={{ ...base, ...atmEdges, background: bg, fontWeight: isAtm ? 700 : 400, color: isAtm ? "rgba(255,255,255,0.82)" : "rgba(255,255,255,0.62)" }}>
                            {isTable
                              ? barEl(value, colKey)
                              : <span style={{ position: "relative", zIndex: 1 }}>{text}</span>}
                          </td>
                        );
                      };

                      return (
                        <React.Fragment key={rowKey}>
                          {showDivider && (
                            <tr>
                              <td colSpan={5} style={{ padding: 0, height: 1, background: "linear-gradient(to right, transparent, rgba(0,240,255,0.15), rgba(139,92,246,0.10), transparent)" }} />
                            </tr>
                          )}
                          <tr
                            className={isAtm ? "heatmap-row-atm" : "heatmap-row"}
                            style={{ ...rowStyle, cursor: "pointer" }}
                            onClick={(e) => {
                              const full = chartRowByStrike.get(Number(row.strike));
                              if (full) setSelectedStrike({ row: full, pos: { x: e.clientX, y: e.clientY } });
                            }}
                          >
                            <td style={{ padding: "0 16px", textAlign: "left", fontWeight: 700, color: isAtm ? C.cyan : "#fff", lineHeight: 1.1, overflow: "hidden", ...(isAtm ? { borderTop: atmBorder, borderBottom: atmBorder, borderLeft: atmBorder } : {}) }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {row.strike}
                                {isAtm && <span style={{ color: C.cyan, fontWeight: 900, fontSize: 12, fontFamily: "sans-serif", letterSpacing: "0.1em" }}>ATM</span>}
                              </div>
                            </td>
                            <td key={1} className={heatmapView !== "table" && row.strikeNum === mvcStrikeHeatmap ? "mvc-peak-cell" : undefined} style={{ position: "relative", padding: "0 8px 0 6px", textAlign: "right", lineHeight: 1.1, overflow: "hidden", ...(isAtm ? { borderTop: atmBorder, borderBottom: atmBorder } : {}), background: heatmapView === "table" || row.netGexVal == null ? "transparent" : metricBg(row.netGexVal, heatmapColorMeta.max["netGexVal"] ?? 1, intensity, heatmapColorMeta.top3["netGexVal"] ?? []), fontWeight: isAtm ? 700 : 400, color: isAtm ? "rgba(255,255,255,0.82)" : "rgba(255,255,255,0.62)", ...(heatmapView !== "table" && row.strikeNum === mvcStrikeHeatmap ? { outline: "3px solid #ffffff", outlineOffset: "-3px", zIndex: 2 } : {}) }}>
                              {heatmapView === "table" ? (
                                barEl(row.netGexVal, "netGexVal")
                              ) : (
                                <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                                  <span style={{ flexShrink: 0, minWidth: 28 }}>
                                    {row.rank && <span style={{ background: row.rankColor, color: row.rankColor === "#F97316" ? "#000" : "#fff", padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 700 }}>#{row.rank}</span>}
                                  </span>
                                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                    {row.strikeNum === mvcStrikeHeatmap && (
                                      <span title="MVC — highest |net GEX|" style={{ color: "#ffd600", fontSize: 12, lineHeight: 1, textShadow: "0 0 3px rgba(0,0,0,.8)" }}>★</span>
                                    )}
                                    {row.netGex}
                                  </span>
                                </div>
                              )}
                            </td>
                            {dataCell(row.volOnly, row.volOnlyVal, "volOnlyVal", 2)}
                            {dataCell(row.dex, row.dexVal, "dexVal", 3)}
                            {dataCell(row.gexVex, row.gexVexVal, "gexVexVal", 4)}
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

      {/* Strike detail popup — style switchable via the toolbar toggle. */}
      {selectedStrike && (
        <StrikeDetailPopup
          row={selectedStrike.row}
          spotPrice={chartSpot}
          baselines={strikeBaselines}
          popupStyle={popupStyle}
          anchor={selectedStrike.pos}
          onClose={() => setSelectedStrike(null)}
        />
      )}

      <style>{`
        /* Strip the opaque shell bg from tab panels when embedded in the home card */
        .tab-panel-embed > div:first-child {
          background: transparent !important;
        }
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
        @keyframes mvcGlow {
          0%, 100% { box-shadow: 0 0 3px rgba(255,255,255,0.35); }
          50%      { box-shadow: 0 0 10px rgba(255,255,255,0.85); }
        }
        .mvc-peak-cell {
          animation: mvcGlow 2.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
