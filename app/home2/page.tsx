"use client";

// HOME2 — fintech-card layout (from promo-mockup-fintech-card.html) wired to the
// SAME live feeds as /home. The WebSocket connect/handleMessage logic, derived
// chain rows, walls, flip, MVC, and heatmap rows are ported verbatim from
// app/home/page.tsx so every number on this page is real, not mocked.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import GexChart from "@/components/dashboard/GexChart";
import GexToolbar from "@/components/dashboard/GexToolbar";
import StrikeDetailPopup, { type PopupStyle } from "@/components/dashboard/StrikeDetailPopup";
import EconCalendarPanel from "@/components/dashboard/EconCalendarPanel";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import { useStrikeGexHistory } from "@/hooks/useStrikeGexHistory";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";
import { saveManualMvcSnapshot } from "@/components/shared/SnapButton";
import { type ChainRow, computeGEXProfile, findGEXFlip } from "@/lib/calculations/calculations";
import DashGrid, { type GridItem } from "@/components/shared/DashGrid";
import { loadLayout, saveLayout, clearLayout } from "@/lib/layoutStore";

type HeatmapRow = {
  strikeNum: number;
  strike: string;
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
type ExpiryOption = { value: string; label: string };
type GexMode = "net" | "call-put";
type DataMode = "oi-vol" | "vol-only";
type HeatmapView = "heatmap" | "table";

// Intensity-scaled cell background. Ported from /home metricBg logic:
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

function fmtMoney(v: number) {
  if (!isFinite(v)) return "--";
  const s = v >= 0 ? "+" : "-";
  const a = Math.abs(v);
  if (a >= 1e9) return s + "$" + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(1) + "K";
  return s + "$" + a.toFixed(0);
}
function fmtMoneyB(vB: number) {
  if (!isFinite(vB)) return "--";
  return fmtMoney(vB * 1e9);
}
function formatStrikeValue(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(2);
}
function fmtExpiryLabel(dateStr: string, label: string) {
  return label || dateStr;
}
function buildExpiryOptions(dates: string[]): ExpiryOption[] {
  return dates.slice(0, 8).map((value, index) => ({ value, label: `${index}DTE ${value.slice(5)}` }));
}

// Build an absolute same-origin iframe URL with embed=1 so the framed page hides
// the app's global toolbar/nav and shows only its own UI (see LayoutShell).
function buildEmbedSrc(src: string, origin: string): string {
  const base = src.startsWith("http") ? src : `${origin}${src}`;
  try {
    const u = new URL(base);
    u.searchParams.set("embed", "1");
    return u.toString();
  } catch {
    return base + (base.includes("?") ? "&" : "?") + "embed=1";
  }
}

function pickCenterRows(rows: ChainRow[], spot: number, sideCount = 20): ChainRow[] {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => b.strike - a.strike);
  let atmIndex = 0;
  let minDist = Infinity;
  sorted.forEach((row, index) => {
    const dist = Math.abs(row.strike - spot);
    if (dist < minDist) { minDist = dist; atmIndex = index; }
  });
  const start = Math.max(0, atmIndex - sideCount);
  const end = Math.min(sorted.length, atmIndex + sideCount + 1);
  return sorted.slice(start, end);
}

function toHeatmapRows(rows: ChainRow[], spot: number, rollingByStrike?: Map<number, number>, sideCount = 20): HeatmapRow[] {
  const windowRows = pickCenterRows(rows, spot, sideCount);
  const byAbsPos = [...windowRows].filter((r) => (r.netGEX ?? 0) > 0).sort((a, b) => Math.abs(b.netGEX ?? 0) - Math.abs(a.netGEX ?? 0)).slice(0, 5);
  const byAbsNeg = [...windowRows].filter((r) => (r.netGEX ?? 0) < 0).sort((a, b) => Math.abs(b.netGEX ?? 0) - Math.abs(a.netGEX ?? 0)).slice(0, 5);
  const rankMap = new Map<number, { rank: number; rankColor: string }>();
  byAbsPos.forEach((row, index) => rankMap.set(row.strike, { rank: index + 1, rankColor: index === 0 || index === 2 ? "#F97316" : "#8B94A7" }));
  byAbsNeg.forEach((row, index) => { if (!rankMap.has(row.strike)) rankMap.set(row.strike, { rank: index + 1, rankColor: index === 0 || index === 2 ? "#F97316" : "#8B94A7" }); });
  const atmStrike = windowRows.reduce((best, row) => (Math.abs(row.strike - spot) < Math.abs(best - spot) ? row.strike : best), windowRows[0]?.strike ?? 0);

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
      strikeNum: row.strike, strike: formatStrikeValue(row.strike),
      netGexVal: net, netGex: fmtMoney(net),
      volOnlyVal: volOnly, volOnly: fmtMoney(volOnly),
      dexVal: dex, dex: fmtMoney(dex),
      gexVexVal: vex, gexVex: fmtMoney(vex),
      rollingVal: rolling ?? null,
      rolling: rolling == null ? "—" : fmtMoney(rolling),
      type, rank: rankMap.get(row.strike)?.rank, rankColor: rankMap.get(row.strike)?.rankColor, atm: isAtm,
    };
  });
}

// ─── Quick links (replaces the mockup's "Owner actions" panel) ───────────────
const QUICK_LINKS: { label: string; href: string }[] = [
  { label: "ES Candles", href: "/es-candles" },
  { label: "Fails", href: "/fails" },
  { label: "Heatmap", href: "/home" },
  { label: "Multigreek", href: "/mult-greek" },
];

// ─── Dashboard grid: panel ids + default layout (12 cols, ~28px rows) ────────
const PANELS = {
  session: "session",
  tiles: "tiles",
  chart: "chart",
  econ: "econ",
  heatmap: "heatmap",
  quick: "quick",
} as const;

const DEFAULT_LAYOUT: GridItem[] = [
  { id: PANELS.session, x: 0, y: 0,  w: 4,  h: 6 },
  { id: PANELS.tiles,   x: 4, y: 0,  w: 8,  h: 6 },
  { id: PANELS.chart,   x: 0, y: 6,  w: 8,  h: 17 },
  { id: PANELS.econ,    x: 8, y: 6,  w: 4,  h: 17 },
  { id: PANELS.heatmap, x: 0, y: 23, w: 8,  h: 16 },
  { id: PANELS.quick,   x: 8, y: 23, w: 4,  h: 16 },
];

// Catalog of cards that can be added from other pages (iframe-embedded).
// Add more entries here to make additional pages available as cards.
const ADDABLE_CARDS: { key: string; title: string; src: string }[] = [
  { key: "es-candles", title: "ES Candles", src: "/es-candles" },
];

// Overlays toggleable on the embedded ES Candles chart (drives postMessage).
const ES_OVERLAYS: { key: string; label: string }[] = [
  { key: "heatmap", label: "Heatmap" },
  { key: "profile", label: "Profile" },
  { key: "mvc", label: "MVC" },
  { key: "levels", label: "Levels" },
  { key: "pdhon", label: "PDH / ON" },
  { key: "flow", label: "Flow" },
];

// Merge a saved layout with defaults: built-in panels always appear (saved
// geometry wins), and any user-added dynamic cards (type set) are preserved.
function mergeLayout(saved: GridItem[] | null): GridItem[] {
  if (!saved || !saved.length) return DEFAULT_LAYOUT.map((d) => ({ ...d }));
  const savedById = new Map(saved.map((s) => [s.id, s]));
  const builtinIds = new Set(DEFAULT_LAYOUT.map((d) => d.id));
  const builtins = DEFAULT_LAYOUT.map((d) => {
    const s = savedById.get(d.id);
    return s ? { ...d, x: s.x, y: s.y, w: s.w, h: s.h } : { ...d };
  });
  // Keep saved dynamic cards (ids not in the default set) as-is.
  const dynamic = saved.filter((s) => !builtinIds.has(s.id) && s.type);
  return [...builtins, ...dynamic];
}

export default function Home2Page() {
  const shouldConnect = useWsLifecycle();
  const shouldConnectRef = useRef(shouldConnect);
  shouldConnectRef.current = shouldConnect;

  const { user } = useUser();
  const userKey = user?.id || "default";

  const gexWsRef = useRef<WebSocket | null>(null);
  const gexWsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedExpiryRef = useRef("");
  const unmountedRef = useRef(false);
  const pendingGexRef = useRef<Record<string, unknown> | null>(null);
  const gexFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGexAppliedRef = useRef(0);

  // ── Dashboard grid layout (drag + resize), persisted to IndexedDB per user ──
  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState<GridItem[]>(DEFAULT_LAYOUT);
  const [layoutLoaded, setLayoutLoaded] = useState(false);

  // Load saved layout once the user key is known.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadLayout(userKey);
      if (cancelled) return;
      setLayout(mergeLayout(saved));
      setLayoutLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [userKey]);

  // Persist whenever the layout changes (after the initial load).
  const onLayoutChange = useCallback((next: GridItem[]) => {
    setLayout(next);
    void saveLayout(userKey, next);
  }, [userKey]);

  const resetLayout = useCallback(() => {
    const def = DEFAULT_LAYOUT.map((d) => ({ ...d }));
    setLayout(def);
    void clearLayout(userKey);
  }, [userKey]);

  // Add-card picker open/closed.
  const [pickerOpen, setPickerOpen] = useState(false);
  // Current origin for building absolute same-origin iframe URLs (SSR-safe).
  const [origin, setOrigin] = useState("");
  useEffect(() => { if (typeof window !== "undefined") setOrigin(window.location.origin); }, []);

  // ── ES Candles card: overlay control over the iframe via postMessage ──
  const esIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [esOverlayOpen, setEsOverlayOpen] = useState(false);
  const [esOverlayState, setEsOverlayState] = useState<Record<string, boolean>>({});

  // Listen for state echoes from the embedded es-candles page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; state?: Record<string, boolean> };
      if (d?.type === "es-overlay-state" && d.state) setEsOverlayState(d.state);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Toggle an overlay inside the ES iframe.
  const toggleEsOverlay = useCallback((overlayKey: string) => {
    const next = !esOverlayState[overlayKey];
    setEsOverlayState((s) => ({ ...s, [overlayKey]: next }));
    const win = esIframeRef.current?.contentWindow;
    if (win) win.postMessage({ type: "es-overlay", overlay: overlayKey, value: next }, window.location.origin);
  }, [esOverlayState]);

  // Append a dynamic card below everything, then persist. No-op if a card with
  // the same src already exists (prevents accidental duplicates).
  const addCard = useCallback((card: { key: string; title: string; src: string }) => {
    setPickerOpen(false);
    setLayout((prev) => {
      if (prev.some((i) => i.type === "iframe" && i.src === card.src)) return prev;
      const maxY = prev.reduce((m, i) => Math.max(m, i.y + i.h), 0);
      const item: GridItem = {
        id: `card-${card.key}-${Date.now().toString(36)}`,
        x: 0, y: maxY, w: 8, h: 14,
        type: "iframe", src: card.src, title: card.title,
      };
      const next = [...prev, item];
      void saveLayout(userKey, next);
      return next;
    });
  }, [userKey]);

  const removeCard = useCallback((id: string) => {
    setLayout((prev) => {
      const next = prev.filter((i) => i.id !== id);
      void saveLayout(userKey, next);
      return next;
    });
  }, [userKey]);

  const [now, setNow] = useState<Date | null>(null);
  const [gexMode, setGexMode] = useState<GexMode>("net");
  const [dataMode, setDataMode] = useState<DataMode>("oi-vol");
  const [showOI, setShowOI] = useState(false);
  const [showDex, setShowDex] = useState(false);
  const [showFlipCurve, setShowFlipCurve] = useState(false);
  // Prior-state ghost overlays (5/15/30 min ago) drawn behind live GEX bars.
  const [showGhost5, setShowGhost5]   = useState(false);
  const [showGhost15, setShowGhost15] = useState(false);
  const [showGhost30, setShowGhost30] = useState(false);
  // Strike-detail popup: selected strike + click anchor (card style).
  const [selectedStrike, setSelectedStrike] = useState<{ row: ChainRow; pos: { x: number; y: number } } | null>(null);
  const popupStyle: PopupStyle = "card";
  // Refs for snap/discord screenshot capture of the chart + heatmap cards.
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const heatmapContainerRef = useRef<HTMLDivElement>(null);
  // Snapshot-to-DB button state for the chart header.
  const [snapDbState, setSnapDbState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const recordSnapshot = useCallback(async () => {
    if (snapDbState === "busy") return;
    setSnapDbState("busy");
    try { await saveManualMvcSnapshot(); setSnapDbState("ok"); }
    catch { setSnapDbState("err"); }
    finally { setTimeout(() => setSnapDbState("idle"), 1800); }
  }, [snapDbState]);
  // Heatmap intensity slider (0.5–3, default 1.75) — controls cell color opacity.
  const [intensity, setIntensity] = useState(1.75);
  // Heatmap panel view: "heatmap" = colored cell backgrounds; "table" = divergent bars.
  const [heatmapView, setHeatmapView] = useState<HeatmapView>("heatmap");
  // 30-min rolling net GEX per strike, pulled from the history DB.
  const [rollingByStrike, setRollingByStrike] = useState<Map<number, number>>(new Map());

  const [expiryOptions, setExpiryOptions] = useState<ExpiryOption[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [spot, setSpot] = useState(0);
  const [spotDisplay, setSpotDisplay] = useState(0);
  const [esFut, setEsFut] = useState(0);
  const [vix, setVix] = useState(0);
  const [spxChange, setSpxChange] = useState(0);
  const [spxChangePct, setSpxChangePct] = useState(0);
  const [status, setStatus] = useState("READY");
  const [chartReady, setChartReady] = useState(false);
  const [gexChainRows, setGexChainRows] = useState<ChainRow[]>([]);
  const [gexSpot, setGexSpot] = useState(0);
  const [callWall, setCallWall] = useState<number | null>(null);
  const [putWall, setPutWall] = useState<number | null>(null);

  useEffect(() => { selectedExpiryRef.current = selectedExpiry; }, [selectedExpiry]);

  // When user picks a different expiry, tell the server to switch + show loader.
  const handleExpiry = useCallback((expiry: string) => {
    setSelectedExpiry(expiry);
    setChartReady(false);
    if (gexWsRef.current?.readyState === WebSocket.OPEN) {
      gexWsRef.current.send(JSON.stringify({ type: "SET_EXPIRY", expiry }));
    }
  }, []);

  // Heatmap refresh: re-assert the active expiry to the server (re-warms chart).
  const handleRefresh = useCallback(async () => {
    const exp = selectedExpiryRef.current;
    if (exp && gexWsRef.current?.readyState === WebSocket.OPEN) {
      setChartReady(false);
      gexWsRef.current.send(JSON.stringify({ type: "SET_EXPIRY", expiry: exp }));
    }
  }, []);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── GEX WebSocket — ported verbatim from /home so data is identical/live ──
  useEffect(() => {
    unmountedRef.current = false;

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

    const HEAVY_FRAME_MS = 200;
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
      data.__isSnapshot = isSnapshot;
      data.__status = st;
      pendingGexRef.current = data;
      const since = Date.now() - lastGexAppliedRef.current;
      if (since >= HEAVY_FRAME_MS) flushGex();
      else if (!gexFlushTimerRef.current) gexFlushTimerRef.current = setTimeout(flushGex, HEAVY_FRAME_MS - since);
    };

    const handleMessage = (raw: string) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw); } catch { return; }
      const type = String(msg.type ?? "");
      const data = (msg.data && typeof msg.data === "object" ? msg.data : msg) as Record<string, unknown>;
      switch (type) {
        case "snapshot":
        case "gex":
        case "GEX_UPDATE": {
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
          if (Number(data.spotDisplay ?? 0) > 0) setSpotDisplay(Number(data.spotDisplay));
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
        default: break;
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
        const exp = selectedExpiryRef.current;
        if (exp) { try { ws.send(JSON.stringify({ type: "SET_EXPIRY", expiry: exp })); } catch {} }
      };
      ws.onmessage = (evt) => handleMessage(String(evt.data));
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onclose = () => { setStatus("RECONNECTING"); scheduleReconnect(); };
    };

    const scheduleReconnect = () => {
      if (unmountedRef.current) return;
      if (!shouldConnectRef.current) return;
      if (gexWsReconnectRef.current) clearTimeout(gexWsReconnectRef.current);
      gexWsReconnectRef.current = setTimeout(connect, 2000);
    };

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
        if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => { try { ws.close(); } catch {} };
        else { ws.onopen = null; try { ws.close(); } catch {} }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldConnect]);

  const chartRows = gexChainRows;
  const chartSpot = gexSpot > 0 ? gexSpot : spot;
  const heatmapRows = useMemo(() => {
    const useSpot = chartSpot > 0 ? chartSpot : spot;
    if (!(useSpot > 0) || !chartRows.length) return [] as HeatmapRow[];
    return toHeatmapRows(chartRows, useSpot, rollingByStrike, 20);
  }, [chartRows, chartSpot, spot, rollingByStrike]);

  // Column maxes + top-3 magnitudes for intensity coloring (per visible column).
  const heatmapColorMeta = useMemo(() => {
    const cols = ["netGexVal", "volOnlyVal", "dexVal", "gexVexVal"] as const;
    const max: Record<string, number> = {};
    const top3: Record<string, number[]> = {};
    for (const c of cols) {
      const absVals = heatmapRows.map((r) => Math.abs(Number(r[c] ?? 0))).filter((v) => v > 0);
      max[c] = absVals.length ? Math.max(...absVals) : 1;
      top3[c] = [...absVals].sort((a, b) => b - a).slice(0, 3);
    }
    return { max, top3 };
  }, [heatmapRows]);

  // MVC for the heatmap table — strike with the highest ABSOLUTE net GEX across
  // the heatmap rows. Gets the gold star in the heatmap.
  const mvcStrikeHeatmap = useMemo(() => {
    let best: number | null = null; let bestAbs = 0;
    for (const r of heatmapRows) { const a = Math.abs(Number(r.netGexVal ?? 0)); if (a > bestAbs) { bestAbs = a; best = r.strikeNum; } }
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

  // Point-in-time net GEX baselines for the popup's rolling-difference boxes.
  // Only polls while a strike is selected.
  const strikeBaselines = useStrikeGexHistory(selectedStrike ? selectedExpiry : "", [5, 15, 30]);
  // Chart ghost-bar baselines — poll the full chain whenever any prior-state
  // overlay (5/15/30 min) is enabled.
  const anyGhost = showGhost5 || showGhost15 || showGhost30;
  const chartBaselines = useStrikeGexHistory(anyGhost ? selectedExpiry : "", [5, 15, 30], 30_000, true);

  // Strike → full ChainRow lookup so heatmap rows can open the same popup.
  const chartRowByStrike = useMemo(
    () => new Map(chartRows.map((r) => [r.strike, r])),
    [chartRows]
  );

  const flipPoint = useMemo(() => findGEXFlip(chartRows, chartSpot) ?? null, [chartRows, chartSpot]);
  const gexProfile = useMemo(() => computeGEXProfile(chartRows, chartSpot, dataMode), [chartRows, chartSpot, dataMode]);

  const mvcStrike = useMemo(() => {
    let best: number | null = null; let bestAbs = 0;
    for (const r of chartRows) { const v = Math.abs(r.netGEX ?? 0); if (v > bestAbs) { bestAbs = v; best = r.strike; } }
    return best;
  }, [chartRows]);

  // ATM strike (nearest live strike to spot) for the ATM tile.
  const atmStrike = useMemo(() => {
    if (!chartRows.length || !(chartSpot > 0)) return null;
    return chartRows.reduce((best, r) => (Math.abs(r.strike - chartSpot) < Math.abs(best - chartSpot) ? r.strike : best), chartRows[0].strike);
  }, [chartRows, chartSpot]);

  // Net GEX header total (in $B) — same definition as /home.
  const netGex = useMemo(() => {
    const s = chartSpot;
    if (!(s > 0)) return 0;
    const total = chartRows.reduce((sum, row) => {
      const callContracts = (row.callOI ?? 0) + (row.callVolume ?? 0);
      const putContracts = (row.putOI ?? 0) + (row.putVolume ?? 0);
      const g = ((row.callGamma ?? 0) * callContracts) - ((row.putGamma ?? 0) * putContracts);
      return sum + g * s * s * 0.01 * 100;
    }, 0);
    return total / 1e9;
  }, [chartRows, chartSpot]);

  const spxShown = spotDisplay > 0 ? spotDisplay : spot;
  const etTime = now?.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) ?? "--:--:--";
  const dteLabel = expiryOptions.find((o) => o.value === selectedExpiry)?.label ?? selectedExpiry;
  const live = status === "LIVE" && chartReady;

  // ── Mockup palette ──
  const T = {
    ink: "#EAEFF5", muted: "#9fb0c0", faint: "#6f7d8c",
    green: "#3FE0A5", red: "#FF6B7A", amber: "#ffce6a", teal: "#2ee6c8",
  };
  // Floating glass panel: translucent + blurred so the page gradient shows
  // through, faint border, soft drop shadow to lift it off the background.
  const panel: React.CSSProperties = {
    background: "rgba(18,21,27,0.26)",
    backdropFilter: "blur(26px) saturate(120%)",
    WebkitBackdropFilter: "blur(26px) saturate(120%)",
    border: "1px solid rgba(255,255,255,.04)",
    borderRadius: 18,
    boxShadow: "0 24px 70px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.04)",
  };
  // Session-card / chart-toolbar tint — translucent so it blends with the page.
  const cardBg = "linear-gradient(135deg,rgba(15,38,32,.34),rgba(21,23,29,.22) 55%,rgba(26,19,32,.34))";

  const tile = (label: React.ReactNode, value: string, color: string, barColor: string, pct: number) => (
    <div style={{ ...panel, flex: 1, padding: "clamp(8px, 6cqw, 14px) clamp(6px, 3cqw, 14px)", minWidth: 0, containerType: "inline-size", display: "flex", flexDirection: "column", justifyContent: "center", overflow: "hidden" }}>
      <div style={{ fontSize: "clamp(7px, 8cqw, 10px)", color: "#8295a8", display: "flex", justifyContent: "space-between", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ fontSize: "clamp(12px, 17cqw, 22px)", fontWeight: 700, marginTop: "0.4em", color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      <div style={{ height: 4, borderRadius: 2, background: "#2a2e36", marginTop: "0.6em", position: "relative", overflow: "hidden", flexShrink: 0 }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: 4, borderRadius: 2, width: `${pct}%`, background: barColor }} />
      </div>
    </div>
  );

  // Standard panel shell for grid items. Defined as a PLAIN FUNCTION returning
  // JSX (not a component) so React keeps the same element identity across
  // renders — otherwise GexChart's canvas and EconCalendarPanel would remount
  // every tick. Optional drag-grip header shows only in edit mode.
  const panelShell = (title: string, content: React.ReactNode, opts?: { bg?: string; pad?: number }) => (
    <div style={{ ...panel, background: opts?.bg ?? panel.background, width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", outline: editMode ? "1px dashed rgba(46,230,200,.45)" : "none" }}>
      {editMode && (
        <div data-dashgrid-handle style={{ flexShrink: 0, height: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, cursor: "grab", background: "rgba(46,230,200,.10)", borderBottom: "1px solid rgba(46,230,200,.18)" }}>
          <span style={{ fontSize: 9, letterSpacing: "0.12em", color: T.teal, fontWeight: 700, textTransform: "uppercase" }}>⠿ {title}</span>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: opts?.pad ?? 16, containerType: "inline-size", containerName: "panel" }}>
        {content}
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, width: "100%", overflowY: "auto", background: "linear-gradient(135deg,#0e1014,#070809)", fontFamily: "'Inter','Helvetica Neue',Arial,sans-serif", color: T.ink, fontSize: 13 }}>
      <div style={{ width: "100%", padding: 20 }}>

        {/* edit toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "#cfd8e2" }}>
            <i style={{ width: 12, height: 12, borderRadius: "50%", background: live ? "#1d3a2e" : "#3a2f08", display: "inline-block" }} />
            <span style={{ color: T.faint }}>Feed:</span> {status}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {editMode && (
              <div style={{ position: "relative" }}>
                <button onClick={() => setPickerOpen((v) => !v)} style={{ background: pickerOpen ? "rgba(46,230,200,.16)" : "transparent", border: "1px solid rgba(46,230,200,.4)", color: T.teal, fontSize: 10.5, fontWeight: 700, padding: "5px 12px", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap" }}>
                  + Add card
                </button>
                {pickerOpen && (
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60, minWidth: 160, ...panel, padding: 6 }}>
                    <div style={{ fontSize: 9, color: T.faint, textTransform: "uppercase", letterSpacing: "0.1em", padding: "4px 8px 6px" }}>Add from page</div>
                    {ADDABLE_CARDS.map((c) => (
                      <button key={c.key} onClick={() => addCard(c)} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", color: "#cfd8e2", fontSize: 11, fontWeight: 600, padding: "7px 8px", borderRadius: 6, cursor: "pointer" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,.06)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                        {c.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {editMode && (
              <button onClick={resetLayout} style={{ background: "transparent", border: "1px solid rgba(255,255,255,.14)", color: T.muted, fontSize: 10.5, fontWeight: 600, padding: "5px 12px", borderRadius: 7, cursor: "pointer" }}>
                Reset layout
              </button>
            )}
            <button onClick={() => setEditMode((v) => !v)} style={{ background: editMode ? "rgba(46,230,200,.16)" : "transparent", border: `1px solid ${editMode ? "rgba(46,230,200,.6)" : "rgba(255,255,255,.14)"}`, color: editMode ? T.teal : "#cfd8e2", fontSize: 10.5, fontWeight: 700, padding: "5px 14px", borderRadius: 7, cursor: "pointer" }}>
              {editMode ? "✓ Done" : "✎ Edit layout"}
            </button>
          </div>
        </div>

        {layoutLoaded && (
        <DashGrid layout={layout} onLayoutChange={onLayoutChange} locked={!editMode} cols={12} rowH={26} gutter={10}>

          {/* session card */}
          <div key={PANELS.session} data-grid-id={PANELS.session} style={{ height: "100%" }}>
            {panelShell("Session", (
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: "clamp(2px, 1.5cqw, 10px)", overflow: "hidden" }}>
                {/* top row: label + live status */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <div style={{ fontSize: "clamp(8px, 2.6cqw, 11px)", color: T.muted, letterSpacing: 1, whiteSpace: "nowrap" }}>SPX · SESSION</div>
                  <div style={{ marginLeft: "auto", background: "rgba(14,16,20,.7)", borderRadius: 10, padding: "3px 8px", fontSize: "clamp(7px, 2.2cqw, 9px)", color: "#cfe0f0", display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", overflow: "hidden" }}>
                    <i style={{ width: 7, height: 7, borderRadius: "50%", background: live ? "#2ee6a0" : "#ffce6a", display: "inline-block", flexShrink: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{live ? "Live chain ready" : status === "RECONNECTING" ? "Reconnecting…" : "Warming…"}</span>
                  </div>
                </div>
                {/* price + change — the hero, scales hardest */}
                <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div suppressHydrationWarning style={{ fontSize: "clamp(20px, 11cqw, 40px)", fontWeight: 700, letterSpacing: -1, lineHeight: 1, whiteSpace: "nowrap" }}>{spxShown > 0 ? spxShown.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</div>
                  <div style={{ fontSize: "clamp(9px, 3.2cqw, 13px)", marginTop: "0.4em", color: spxChange >= 0 ? T.green : T.red, whiteSpace: "nowrap" }}>{spxChange >= 0 ? "▲" : "▼"} {spxChange >= 0 ? "+" : ""}{spxChange.toFixed(2)} ({spxChangePct >= 0 ? "+" : ""}{spxChangePct.toFixed(2)}%)</div>
                </div>
                {/* bottom: stats + open-chain */}
                <div style={{ display: "flex", alignItems: "flex-end", gap: "clamp(8px, 3cqw, 16px)", flexShrink: 0, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "clamp(8px, 2.4cqw, 10px)", color: T.muted }}>VIX<b style={{ display: "block", fontSize: "clamp(10px, 3cqw, 13px)", marginTop: 2, color: T.red }}>{vix > 0 ? vix.toFixed(2) : "—"}</b></span>
                  <span style={{ fontSize: "clamp(8px, 2.4cqw, 10px)", color: T.muted }}>ESU<b style={{ display: "block", fontSize: "clamp(10px, 3cqw, 13px)", marginTop: 2, color: T.green }}>{esFut > 0 ? esFut.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</b></span>
                  <span style={{ fontSize: "clamp(8px, 2.4cqw, 10px)", color: T.muted }}>NET GEX<b style={{ display: "block", fontSize: "clamp(10px, 3cqw, 13px)", marginTop: 2, color: netGex >= 0 ? T.green : T.red }}>{fmtMoneyB(netGex)}</b></span>
                  <Link href="/home" style={{ marginLeft: "auto", background: "#f4f6f8", color: "#15171c", fontSize: "clamp(8px, 2.4cqw, 10px)", fontWeight: 600, padding: "6px 10px", borderRadius: 8, textDecoration: "none", whiteSpace: "nowrap" }}>Open chain</Link>
                </div>
              </div>
            ), { bg: cardBg })}
          </div>

          {/* tiles */}
          <div key={PANELS.tiles} data-grid-id={PANELS.tiles} style={{ height: "100%" }}>
            {panelShell("Levels", (
              <div style={{ display: "flex", gap: 9, flex: 1, minHeight: 0, padding: 14 }}>
                {tile("CALL WALL", callWall ? formatStrikeValue(callWall) : "—", T.green, "linear-gradient(90deg,#2ee6c8,#1fb8d6)", 82)}
                {tile("PUT WALL", putWall ? formatStrikeValue(putWall) : "—", T.red, "linear-gradient(90deg,#7c5cff,#ff5ea8)", 74)}
                {tile("FLIP", flipPoint ? formatStrikeValue(flipPoint) : "—", T.amber, "linear-gradient(90deg,#2ee6c8,#7c5cff 55%,#ff5ea8)", 55)}
                {tile(<span>MVC <span style={{ color: "#ff5ea8" }}>⚑</span></span>, mvcStrike ? formatStrikeValue(mvcStrike) : "—", "#fff", "linear-gradient(90deg,#7c5cff,#ff5ea8)", 48)}
                {tile("ATM", atmStrike ? formatStrikeValue(atmStrike) : "—", "#fff", "linear-gradient(90deg,#2ee6c8,#1fb8d6)", 60)}
              </div>
            ), { pad: 0 })}
          </div>

          {/* Net GEX chart */}
          <div key={PANELS.chart} data-grid-id={PANELS.chart} style={{ height: "100%" }}>
            {panelShell("Net GEX", (
              <div ref={chartContainerRef} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div style={{ display: "flex", alignItems: "center", flexShrink: 0, gap: 8, background: cardBg, margin: "-16px -16px 0", padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                <span style={{ fontSize: "clamp(11px, 2.2cqw, 14px)", fontWeight: 600, whiteSpace: "nowrap" }}>Net GEX <span suppressHydrationWarning style={{ color: T.faint, fontWeight: 400 }}>· {etTime}</span></span>
                <span style={{ marginLeft: "auto", fontSize: "clamp(8px, 1.6cqw, 10px)", color: T.faint, whiteSpace: "nowrap" }}>SPX {spxShown > 0 ? spxShown.toFixed(2) : "—"}</span>
                <button onClick={recordSnapshot} disabled={snapDbState === "busy"} title="Record snapshot to database"
                  style={{ background: "rgba(46,230,200,0.10)", border: "1px solid rgba(46,230,200,0.30)", color: snapDbState === "ok" ? "#3FE0A5" : snapDbState === "err" ? T.red : T.teal, fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 6, textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {snapDbState === "busy" ? "Saving…" : snapDbState === "ok" ? "Saved ✓" : snapDbState === "err" ? "Error ✕" : "📸 Snapshot"}
                </button>
              </div>
              {/* Full-featured toolbar — same controls as /home */}
              <GexToolbar
                gexMode={gexMode}
                dataMode={dataMode}
                showOI={showOI}
                showDex={showDex}
                showFlipCurve={showFlipCurve}
                expirations={expiryOptions.map((o) => o.value)}
                selectedExpiry={selectedExpiry}
                onExpiry={handleExpiry}
                onGexMode={setGexMode}
                onDataMode={setDataMode}
                showGhost5={showGhost5}
                showGhost15={showGhost15}
                showGhost30={showGhost30}
                onToggleOI={() => setShowOI((v) => !v)}
                onToggleDex={() => setShowDex((v) => !v)}
                onToggleFlip={() => setShowFlipCurve((v) => !v)}
                onToggleGhost5={() => { setShowGhost5((v) => !v); setShowGhost15(false); setShowGhost30(false); }}
                onToggleGhost15={() => { setShowGhost15((v) => !v); setShowGhost5(false); setShowGhost30(false); }}
                onToggleGhost30={() => { setShowGhost30((v) => !v); setShowGhost5(false); setShowGhost15(false); }}
                onRefresh={handleRefresh}
                containerRef={chartContainerRef}
                discordMessage={`NET GEX • ${selectedExpiry}`}
              />
              <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
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
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
                    <style>{`@keyframes h2spin{to{transform:rotate(360deg)}}`}</style>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", border: "3px solid rgba(46,230,200,0.15)", borderTopColor: T.teal, animation: "h2spin 0.8s linear infinite" }} />
                    <div style={{ color: T.teal, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Loading SPX chain…</div>
                  </div>
                )}
              </div>
              </div>
            ))}
          </div>

          {/* economic calendar */}
          <div key={PANELS.econ} data-grid-id={PANELS.econ} style={{ height: "100%" }}>
            {panelShell("Economic calendar", (
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                <div style={{ fontSize: "clamp(11px, 2.4cqw, 14px)", fontWeight: 600, marginBottom: "0.8em", flexShrink: 0 }}>Economic calendar</div>
                <div className="h2-econ" style={{ flex: 1, minHeight: 0, overflow: "auto", margin: "0 -16px -16px" }}>
                  <EconCalendarPanel />
                </div>
              </div>
            ))}
          </div>

          {/* live heatmap */}
          <div key={PANELS.heatmap} data-grid-id={PANELS.heatmap} style={{ height: "100%" }}>
            {panelShell("Live GEX heatmap", (
              <div ref={heatmapContainerRef} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 10, flexShrink: 0, gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: "clamp(11px, 2.4cqw, 14px)", fontWeight: 600, whiteSpace: "nowrap" }}>Live GEX heatmap</span>
                {/* Intensity slider — controls heatmap cell opacity */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Intensity</span>
                  <input type="range" min={0.5} max={3} step={0.01} value={intensity}
                    onChange={(e) => setIntensity(Number(e.target.value))}
                    style={{ width: 70, height: 3, accentColor: T.teal }} />
                  <span style={{ fontSize: 10, color: T.teal, fontWeight: 700, minWidth: 34, fontFamily: "monospace" }}>{intensity.toFixed(2)}x</span>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                  {/* heatmap / table view toggle */}
                  <div style={{ display: "flex", gap: 2, border: "1px solid rgba(46,230,200,0.18)", borderRadius: 4, overflow: "hidden" }}>
                    {(["heatmap", "table"] as const).map((v) => (
                      <button key={v} onClick={() => setHeatmapView(v)}
                        style={{ padding: "2px 9px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer", border: "none", fontFamily: "inherit", background: heatmapView === v ? "rgba(46,230,200,0.14)" : "transparent", color: heatmapView === v ? T.teal : "#5a7a98" }}>
                        {v}
                      </button>
                    ))}
                  </div>
                  <span style={{ height: 20, borderRadius: 7, background: "#0f1116", border: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", padding: "0 8px", fontSize: "clamp(8px, 1.6cqw, 9px)", color: T.muted, whiteSpace: "nowrap" }}>{fmtExpiryLabel(selectedExpiry, dteLabel) || "—"}</span>
                  <button onClick={handleRefresh} title="Refresh heatmap"
                    style={{ background: "rgba(46,230,200,0.06)", border: "1px solid rgba(46,230,200,0.25)", color: T.teal, borderRadius: 4, padding: "1px 7px", fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>↻</button>
                  <BoxSnapBtn targetRef={heatmapContainerRef} label="GEX Heatmap" />
                  <BoxDiscordBtn targetRef={heatmapContainerRef} label="GEX Heatmap" message={`GEX Heatmap • ${selectedExpiry}`} />
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "clamp(8px, 1.5cqw, 11px)", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                  <colgroup><col style={{ width: "16%" }} /><col style={{ width: "18%" }} /><col style={{ width: "18%" }} /><col style={{ width: "16%" }} /><col style={{ width: "16%" }} /><col style={{ width: "16%" }} /></colgroup>
                  <thead>
                    <tr style={{ fontSize: "0.85em", color: "#7d8a99" }}>
                      {["Strike", "Net GEX", "Vol Only GEX", "DEX", "Net VEX", "30m Roll"].map((h, i) => (
                        <th key={h} style={{ textAlign: i === 0 || heatmapView === "table" ? "left" : "right", padding: "0.6em 0.5em", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,.06)", position: "sticky", top: 0, background: "#15171c", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapRows.length === 0 && (
                      <tr><td colSpan={6} style={{ padding: "18px 6px", textAlign: "center", color: T.faint }}>{live ? "No strikes in range" : "Loading live chain…"}</td></tr>
                    )}
                    {heatmapRows.map((row, i) => {
                      const isAtm = row.type === "atm";
                      const isTable = heatmapView === "table";

                      // Left-anchored gradient bar (table view), scaled to the column max.
                      const barEl = (value: number | null, colKey: string) => {
                        if (value == null || !Number.isFinite(value)) return null;
                        const max = heatmapColorMeta.max[colKey] ?? 1;
                        const ratio = Math.min(Math.abs(value) / (max || 1), 1);
                        const pct = ratio * 90;
                        if (!pct) return null;
                        const pos = value >= 0;
                        const a = 0.5 + ratio * 0.5;
                        const light = pos ? `rgba(74,255,150,${a.toFixed(2)})` : `rgba(255,86,110,${a.toFixed(2)})`;
                        const dark = pos ? `rgba(0,140,70,${a.toFixed(2)})` : `rgba(190,20,40,${a.toFixed(2)})`;
                        return (
                          <div style={{ position: "absolute", top: 3, bottom: 3, left: 0, width: `${pct}%`, background: `linear-gradient(90deg, ${dark} 0%, ${light} 100%)`, borderRadius: 2, pointerEvents: "none" }} />
                        );
                      };

                      // Numeric cell: heatmap view paints a metricBg background; table draws a bar.
                      const dataCell = (text: string, value: number | null, colKey: string, colIdx: number) => {
                        const base: React.CSSProperties = { position: "relative", padding: "0.45em 0.5em", textAlign: isTable ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,.04)", overflow: "hidden", whiteSpace: "nowrap" };
                        const bg = isTable || value == null
                          ? "transparent"
                          : metricBg(value, heatmapColorMeta.max[colKey] ?? 1, intensity, heatmapColorMeta.top3[colKey] ?? []);
                        return (
                          <td key={colIdx} style={{ ...base, background: bg, fontWeight: isAtm ? 700 : 400, color: value != null && value >= 0 ? "#dceee9" : "#ffd6db" }}>
                            {isTable ? barEl(value, colKey) : <span style={{ position: "relative", zIndex: 1 }}>{text}</span>}
                          </td>
                        );
                      };

                      return (
                        <tr key={`${row.strike}-${i}`} style={{ background: isAtm ? "rgba(255,206,106,.12)" : "transparent", cursor: "pointer" }}
                          onClick={(e) => {
                            const full = chartRowByStrike.get(Number(row.strikeNum));
                            if (full) setSelectedStrike({ row: full, pos: { x: e.clientX, y: e.clientY } });
                          }}>
                          <td style={{ textAlign: "left", padding: "0.45em 0.5em", fontWeight: isAtm ? 700 : 400, color: isAtm ? T.amber : "#cfd8e2", borderBottom: "1px solid rgba(255,255,255,.04)", whiteSpace: "nowrap" }}>
                            {row.rank ? <span style={{ display: "inline-block", minWidth: 16, textAlign: "center", fontSize: "0.62em", color: "#fff", borderRadius: 3, padding: "1px 3px", marginRight: 4, background: row.netGexVal >= 0 ? "#c2410c" : "#1f6f43" }}>#{row.rank}</span> : null}
                            {row.strikeNum === mvcStrikeHeatmap && (
                              <span title="MVC — highest |net GEX|" style={{ color: "#ffd600", fontSize: "1.05em", marginRight: 3, textShadow: "0 0 3px rgba(0,0,0,.8)" }}>★</span>
                            )}
                            {row.strike}{isAtm ? " ATM" : ""}
                          </td>
                          {dataCell(row.netGex, row.netGexVal, "netGexVal", 1)}
                          {dataCell(row.volOnly, row.volOnlyVal, "volOnlyVal", 2)}
                          {dataCell(row.dex, row.dexVal, "dexVal", 3)}
                          {dataCell(row.gexVex, row.gexVexVal, "gexVexVal", 4)}
                          {/* 30-min rolling net GEX — text only (no intensity wash) */}
                          <td style={{ textAlign: "right", padding: "0.45em 0.5em", borderBottom: "1px solid rgba(255,255,255,.04)", color: row.rollingVal == null ? T.faint : row.rollingVal >= 0 ? "#dceee9" : "#ffd6db", whiteSpace: "nowrap" }}>{row.rolling}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </div>
            ))}
          </div>

          {/* quick links + confidence */}
          <div key={PANELS.quick} data-grid-id={PANELS.quick} style={{ height: "100%" }}>
            {panelShell("Quick links", (
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div style={{ fontSize: "clamp(11px, 2.4cqw, 14px)", fontWeight: 600, marginBottom: "0.8em", flexShrink: 0 }}>Quick links</div>
              <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {QUICK_LINKS.map((q) => (
                  <Link key={q.href + q.label} href={q.href} style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 30, padding: "6px 8px", borderRadius: 8, fontSize: "clamp(9px, 2cqw, 11px)", textDecoration: "none", background: "#16191f", border: "1px solid rgba(255,255,255,.07)", color: "#cfd8e2", flex: "1 1 0", whiteSpace: "nowrap" }}>
                    {q.label}
                  </Link>
                ))}
                <Link href="/confidence-score" style={{ ...panel, padding: 14, position: "relative", overflow: "hidden", background: "#13151a", textDecoration: "none", color: T.ink, display: "block", marginTop: 6, flexShrink: 0 }}>
                  <div style={{ position: "absolute", right: -20, top: -20, width: 90, height: 90, borderRadius: "50%", background: "radial-gradient(circle,#2ee6c880,transparent 70%)" }} />
                  <h2 style={{ fontSize: "clamp(11px, 2.6cqw, 14px)", fontWeight: 700 }}>Confidence score</h2>
                  <p style={{ fontSize: "clamp(8px, 1.9cqw, 9.5px)", color: T.muted, marginTop: 6, lineHeight: 1.5 }}>Live MVC scored 0–100 · Hit / Pivot / Chop</p>
                </Link>
              </div>
              </div>
            ))}
          </div>

          {/* dynamic user-added cards — rendered through the same panelShell as the
              built-ins so height/flex behavior is identical (the chart fills). */}
          {layout.filter((it) => it.type === "iframe").map((it) => (
            <div key={it.id} data-grid-id={it.id} style={{ height: "100%" }}>
              {panelShell(it.title || "Card", (
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                  {/* mini header row with overlays dropdown + open-link + remove */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: "clamp(11px, 2.2cqw, 13px)", fontWeight: 600, whiteSpace: "nowrap" }}>{it.title}</span>
                    <a href={it.src} target="_blank" rel="noopener noreferrer" title="Open full page" style={{ fontSize: 11, color: T.faint, textDecoration: "none" }}>↗</a>
                    {it.src === "/es-candles" && (
                      <div style={{ position: "relative", marginLeft: 4 }}>
                        <button onClick={() => setEsOverlayOpen((v) => !v)} title="Add overlays to the chart"
                          style={{ background: esOverlayOpen ? "rgba(46,230,200,.16)" : "rgba(255,255,255,.05)", border: "1px solid rgba(46,230,200,.4)", color: T.teal, fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap" }}>
                          + Overlays ▾
                        </button>
                        {esOverlayOpen && (
                          <div style={{ position: "absolute", top: "calc(100% + 5px)", left: 0, zIndex: 60, minWidth: 150, ...panel, padding: 5 }}>
                            <div style={{ fontSize: 9, color: T.faint, textTransform: "uppercase", letterSpacing: "0.1em", padding: "3px 7px 5px" }}>Chart overlays</div>
                            {ES_OVERLAYS.map((o) => {
                              const on = !!esOverlayState[o.key];
                              return (
                                <button key={o.key} onClick={() => toggleEsOverlay(o.key)}
                                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: "transparent", border: "none", color: on ? T.ink : "#9fb0c0", fontSize: 11, fontWeight: 600, padding: "6px 7px", borderRadius: 5, cursor: "pointer" }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,.06)")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                                  <span style={{ width: 13, height: 13, borderRadius: 3, flexShrink: 0, border: `1px solid ${on ? T.teal : "rgba(255,255,255,.25)"}`, background: on ? T.teal : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#05080d", fontSize: 10, fontWeight: 900, lineHeight: 1 }}>{on ? "✓" : ""}</span>
                                  {o.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                    {editMode && (
                      <button onClick={() => removeCard(it.id)} title="Remove card" style={{ marginLeft: "auto", background: "rgba(255,107,122,.14)", border: "1px solid rgba(255,107,122,.4)", color: "#ff8a96", fontSize: 11, fontWeight: 700, lineHeight: 1, width: 18, height: 18, borderRadius: 5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                    )}
                  </div>
                  <div style={{ flex: 1, minHeight: 0, position: "relative", background: "#05080d", borderRadius: 8, overflow: "hidden" }}>
                    {editMode && <div style={{ position: "absolute", inset: 0, zIndex: 5 }} />}
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: T.faint, fontSize: 11, zIndex: 0 }}>Loading {it.title || "page"}…</div>
                    {origin && (
                      <iframe
                        ref={it.src === "/es-candles" ? esIframeRef : undefined}
                        src={buildEmbedSrc(it.src || "", origin)}
                        title={it.title || it.id}
                        referrerPolicy="same-origin"
                        style={{ position: "relative", zIndex: 1, width: "100%", height: "100%", border: "none", display: "block" }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}

        </DashGrid>
        )}

      </div>

      {/* Strike detail popup — opened by clicking a chart bar or heatmap row. */}
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
        .h2-econ > div:first-child { background: transparent !important; }
      `}</style>
    </div>
  );
}
