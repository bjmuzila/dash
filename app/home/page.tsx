"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import SnapshotPanel from "@/components/dashboard/SnapshotPanel";
import EconCalendarPanel from "@/components/dashboard/EconCalendarPanel";
import Subscriber, { type SubscriberState } from "@/lib/subscriber";
import { saveManualMvcSnapshot } from "@/components/shared/SnapButton";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";
import { useRefreshButton } from "@/hooks/useRefreshButton";

type GexProfile = { levels: number[]; values: number[]; flipPoint: number | null } | null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function etNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function isMarketOpen() {
  const d = etNow();
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= 570 && mins < 960;
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

function fmtExpiryDate(value: string) {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function pickDashboardExpiries(
  items: Array<{ date: string; strikeCount: number }>
): { "0dte": string; "1dte": string } {
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    if (!item.date || seen.has(item.date)) return false;
    seen.add(item.date);
    return true;
  });

  const liquid = unique.filter((item) => item.strikeCount >= 20);
  const zeroSource = liquid[0] ?? unique[0];
  const zero = zeroSource?.date ?? "";
  const later = unique.filter((item) => item.date > zero);
  const liquidLater = later.filter((item) => item.strikeCount >= 20);
  const rankedLater = (liquidLater.length ? liquidLater : later)
    .sort((a, b) => (b.strikeCount - a.strikeCount) || a.date.localeCompare(b.date));
  const one = rankedLater[0]?.date ?? later[0]?.date ?? zero;
  return { "0dte": zero, "1dte": one };
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const BarChart2 = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);
const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);
const ActivityIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
  </svg>
);
const LayersIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>
  </svg>
);
const HomeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);
const GridIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
  </svg>
);
const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);
const RotateCcwIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.91"/>
  </svg>
);

const ES_SYMBOL_ALIASES = ["/ESU26", "/ESU6", "/ES:XCME", "/ES"];

function findQuote(items: Array<Record<string, unknown>>, symbols: string[]) {
  return items.find((item) => symbols.includes(String(item.symbol ?? "")));
}

// ── Data ──────────────────────────────────────────────────────────────────────
const SIDEBAR_SYMBOLS = ["AMD", "META", "SMH", "NVDA", "AMZN", "NQU", "QQQ", "GOOGL", "MSFT", "AAPL"];
const DEFAULT_QUOTES = SIDEBAR_SYMBOLS.map(sym => ({ sym, chg: "—", pos: true, active: sym === "NQU" }));

const HEATMAP_ROWS = [
  { strike: "7,600", rank: 2, rankColor: "#8B94A7", netGex: "$63.72M", volOnly: "$63.72M", dex: "$25.82M", vex: "$73.62M", dwGex: "$9.90M", type: "pos-strong" },
  { strike: "7,595", netGex: "$8.01M",   volOnly: "$8.01M",   dex: "$3.46M",   vex: "$9.47M",   dwGex: "$1.47M",   type: "neutral" },
  { strike: "7,590", rank: 3, rankColor: "#F97316", netGex: "-$21.77M", volOnly: "$10.16M", dex: "-$50.32M", vex: "$12.32M", dwGex: "$2.15M", type: "neg-red" },
  { strike: "7,585", netGex: "$9.86M",   volOnly: "$9.86M",   dex: "$4.70M",   vex: "$12.13M",  dwGex: "$2.27M",   type: "neutral" },
  { strike: "7,580", netGex: "$9.38M",   volOnly: "$9.38M",   dex: "$4.80M",   vex: "$11.97M",  dwGex: "$2.59M",   type: "neutral" },
  { strike: "7,575", rank: 5, rankColor: "#8B94A7", netGex: "$13.32M",  volOnly: "$13.32M",  dex: "$6.05M",   vex: "$16.63M",  dwGex: "$3.31M",   type: "neutral" },
  { strike: "7,570", rank: 1, rankColor: "#F97316", netGex: "$200.41M", volOnly: "$11.71M",  dex: "$118.50M", vex: "$15.84M",  dwGex: "$4.13M",   type: "pos-top" },
  { strike: "7,565", netGex: "$12.04M",  volOnly: "$12.04M",  dex: "$7.73M",   vex: "$16.77M",  dwGex: "$4.74M",   type: "neutral" },
  { strike: "7,560", rank: 4, rankColor: "#8B94A7", netGex: "$13.65M",  volOnly: "$13.65M",  dex: "$8.65M",   vex: "$19.04M",  dwGex: "$5.39M",   type: "neutral" },
  { strike: "7,555", atm: true, rank: 2, rankColor: "#8B94A7", netGex: "$20.27M", volOnly: "$20.27M", dex: "$14.26M", vex: "$29.17M", dwGex: "$8.90M", type: "atm" },
  { strike: "7,550", rank: 4, rankColor: "#8B94A7", netGex: "-$11.19M", volOnly: "-$11.19M", dex: "-$8.14M",  vex: "-$16.22M", dwGex: "-$5.03M",  type: "neg" },
  { strike: "7,545", netGex: "-$1.82M",  volOnly: "-$1.82M",  dex: "-$1.33M",  vex: "-$2.63M",  dwGex: "-$803.30K", type: "neg" },
  { strike: "7,540", netGex: "-$2.19M",  volOnly: "-$2.19M",  dex: "-$1.25M",  vex: "-$2.91M",  dwGex: "-$724.10K", type: "neg" },
  { strike: "7,535", netGex: "$420.98K", volOnly: "$420.98K", dex: "$878.09K", vex: "$798.86K", dwGex: "$377.88K",  type: "neutral" },
  { strike: "7,530", rank: 3, rankColor: "#F97316", netGex: "-$19.35M", volOnly: "-$19.35M", dex: "-$11.95M", vex: "-$25.73M", dwGex: "-$6.38M",  type: "neg-red" },
  { strike: "7,525", rank: 5, rankColor: "#8B94A7", netGex: "-$9.03M",  volOnly: "-$9.03M",  dex: "-$5.17M",  vex: "-$11.61M", dwGex: "-$2.57M",  type: "neg" },
  { strike: "7,520", rank: 1, rankColor: "#F97316", netGex: "-$47.34M", volOnly: "-$3.92M",  dex: "-$27.74M", vex: "-$5.00M",  dwGex: "-$1.08M",  type: "neg-top" },
  { strike: "7,515", netGex: "-$3.28M",  volOnly: "-$3.28M",  dex: "-$1.87M",  vex: "-$4.09M",  dwGex: "-$811.00K", type: "neg" },
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  const [now, setNow] = useState(new Date());
  const [sidebarQuotes, setSidebarQuotes] = useState(DEFAULT_QUOTES);
  const [spx, setSpx] = useState(7554.29);
  const [spxChg, setSpxChg] = useState(122.83);
  const [spxChgPct, setSpxChgPct] = useState(1.65);
  const [esFut, setEsFut] = useState(7562.0);
  const [esChg, setEsChg] = useState(0);
  const [esChgPct, setEsChgPct] = useState(0);
  const [netGex, setNetGex] = useState(15790000000);
  const [vix, setVix] = useState(16.20);
  const [callWall, setCallWall] = useState<number | null>(null);
  const [putWall, setPutWall] = useState<number | null>(null);
  const [gexFlip, setGexFlip] = useState<number | null>(null);
  const [gexProfile, setGexProfile] = useState<GexProfile>(null);
  const [activeTab, setActiveTab] = useState<"calendar" | "snapshot" | "spxflow">("calendar");
  const [showPageMenu, setShowPageMenu] = useState(false);
  const [rawChain, setRawChain] = useState<SubscriberState["chain"]>([]);
  const [heatmapData, setHeatmapData] = useState<{ strike: string; netGex: string; volOnly: string; dex: string; gexVex: string; rollingNetGex: string; type: string; rank?: number; rankColor?: string; atm?: boolean }[]>(HEATMAP_ROWS.map((row) => ({
    strike: row.strike,
    netGex: row.netGex,
    volOnly: row.volOnly,
    dex: row.dex,
    gexVex: row.vex,
    rollingNetGex: "—",
    type: row.type,
    rank: row.rank,
    rankColor: row.rankColor,
    atm: row.atm,
  })));
  const [gexMode, setGexMode] = useState<"net-gex" | "call-put">("net-gex");
  const [dataMode, setDataMode] = useState<"oi-vol" | "vol-only">("oi-vol");
  const [showOiOverlay, setShowOiOverlay] = useState(false);
  const [showNetDex, setShowNetDex] = useState(false);
  const [showGexFlip, setShowGexFlip] = useState(false);
  const [selectedExpiry, setSelectedExpiry] = useState<"0dte" | "1dte">("0dte");
  const [expiryMap, setExpiryMap] = useState<{ "0dte": string; "1dte": string }>({ "0dte": "", "1dte": "" });
  const expiryCandidatesRef = useRef<Array<{ date: string; strikeCount: number }>>([]);
  const [rollingNetGexByStrike, setRollingNetGexByStrike] = useState<Record<number, number>>({});
  const [intensity, setIntensity] = useState(0.4);
  const [zoomHalf, setZoomHalf] = useState(40); // strikes each side
  const [panOffset, setPanOffset] = useState(0); // strike offset for drag-pan
  const [hoverBar, setHoverBar] = useState<{ x: number; y: number; strike: number; val: number; isPos: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ startX: number; startPan: number } | null>(null);
  const prevSpxRef = useRef(0);
  const gexChartRef = useRef<HTMLDivElement>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);
  const spxFlowRef = useRef<HTMLDivElement>(null);
  const [mvcSaving, setMvcSaving] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [spxFlowRenderTick, setSpxFlowRenderTick] = useState(0);
  const lastRollingPersistRef = useRef<{ expiry: string; stamp: number }>({ expiry: "", stamp: 0 });

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const fetchTopBarQuotes = async () => {
      try {
        const res = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(["SPX", "VIX", ...ES_SYMBOL_ALIASES].join(","))}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const items: Array<Record<string, unknown>> = Array.isArray(json?.data?.items) ? json.data.items : [];
        const spxQuote = findQuote(items, ["SPX"]);
        const esQuote = findQuote(items, ES_SYMBOL_ALIASES);

        if (spxQuote) {
          const last = Number(spxQuote.last ?? spxQuote.mark ?? 0);
          const prev = Number(spxQuote["prev-close"] ?? spxQuote["day-close"] ?? 0);
          if (last > 100 && prev > 0) {
            const change = last - prev;
            setSpxChg(change);
            setSpxChgPct((change / prev) * 100);
          }
        }

        if (esQuote) {
          const last = Number(esQuote.last ?? esQuote.mark ?? 0);
          const prev = Number(esQuote["prev-close"] ?? esQuote["day-close"] ?? 0);
          if (last > 100 && prev > 0) {
            const change = last - prev;
            setEsChg(change);
            setEsChgPct((change / prev) * 100);
          }
        }
      } catch {
        // no-op
      }
    };

    fetchTopBarQuotes().catch(() => {});
    const t = setInterval(() => { fetchTopBarQuotes().catch(() => {}); }, 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const subscriber = Subscriber.getInstance();
    subscriber.init();

    // Subscribe to state updates
    const unsubscribe = subscriber.subscribe((state: SubscriberState) => {
      if (state.spotPrice > 100) {
        const prev = prevSpxRef.current;
        if (prev > 0) {
          const chg = state.spotPrice - prev;
          setSpxChg(chg);
          setSpxChgPct((chg / prev) * 100);
        }
        if (prev === 0) prevSpxRef.current = state.spotPrice;
        setSpx(state.spotPrice);
      }
      setEsFut(state.esFutures);
      setVix(state.vix);
      setNetGex(state.netGex);
      setCallWall(state.callWall);
      setPutWall(state.putWall);
      setGexFlip(state.gexFlip);

    });

    return () => {
      unsubscribe();
      subscriber.disconnect();
    };
  }, []);

  // ── Task #13: Sidebar quotes poll ─────────────────────────────────────────────
  const handleMvcSnapshot = useCallback(async () => {
    if (mvcSaving === "saving") return;
    setMvcSaving("saving");
    try {
      await saveManualMvcSnapshot();
      setMvcSaving("ok");
      setTimeout(() => setMvcSaving("idle"), 1800);
    } catch {
      setMvcSaving("err");
      setTimeout(() => setMvcSaving("idle"), 2000);
    }
  }, [mvcSaving]);

  const refreshGexPanels = useCallback(async () => {
    const actualExpiry = expiryMap[selectedExpiry];
    const requests: Promise<Response>[] = [
      fetch(`/api/quotes-batch?symbols=${encodeURIComponent(["SPX", "VIX", ...ES_SYMBOL_ALIASES].join(","))}`, { cache: "no-store" }),
    ];

    if (actualExpiry) {
      requests.unshift(fetch(`/api/gex?expiry=${encodeURIComponent(actualExpiry)}`, { cache: "no-store" }));
    }

    const responses = await Promise.all(requests);
    let updated = false;

    const gexRes = actualExpiry ? responses[0] : null;
    const quotesRes = responses[actualExpiry ? 1 : 0];

    if (gexRes?.ok) {
      const json = await gexRes.json();
      const nextChain = Array.isArray(json?.chain) ? json.chain : [];
      if (nextChain.length) {
        setRawChain(nextChain);
      }
      if (Number(json?.spotPrice ?? 0) > 100) setSpx(Number(json.spotPrice));
      if (Number(json?.summary?.totalNetGEX ?? 0) !== 0) setNetGex(Number(json.summary.totalNetGEX));
      setCallWall(json?.callWall ?? null);
      setPutWall(json?.putWall ?? null);
      setGexFlip(json?.gexFlip ?? null);
      setGexProfile(json?.profile ?? null);
      updated = true;
    }

    if (quotesRes?.ok) {
      const json = await quotesRes.json();
      const items: Array<Record<string, unknown>> = Array.isArray(json?.data?.items) ? json.data.items : [];
      const spxQuote = findQuote(items, ["SPX"]);
      const esQuote = findQuote(items, ES_SYMBOL_ALIASES);
      const vixQuote = findQuote(items, ["VIX"]);

      if (spxQuote) {
        const last = Number(spxQuote.last ?? spxQuote.mark ?? 0);
        const prev = Number(spxQuote["prev-close"] ?? spxQuote["day-close"] ?? 0);
        if (last > 100) {
          setSpx(last);
        }
        if (last > 100 && prev > 0) {
          const change = last - prev;
          setSpxChg(change);
          setSpxChgPct((change / prev) * 100);
        }
      }

      if (esQuote) {
        const last = Number(esQuote.last ?? esQuote.mark ?? 0);
        const prev = Number(esQuote["prev-close"] ?? esQuote["day-close"] ?? 0);
        if (last > 100) {
          setEsFut(last);
        }
        if (last > 100 && prev > 0) {
          const change = last - prev;
          setEsChg(change);
          setEsChgPct((change / prev) * 100);
        }
      }

      if (vixQuote) {
        const last = Number(vixQuote.last ?? vixQuote.mark ?? 0);
        if (last > 0) {
          setVix(last);
        }
      }

      updated = true;
    }

    if (!updated) {
      throw new Error("Refresh failed");
    }
  }, [expiryMap, selectedExpiry]);

  useEffect(() => {
    const actualExpiry = expiryMap[selectedExpiry];
    if (!actualExpiry) {
      setRollingNetGexByStrike({});
      return;
    }

    let cancelled = false;

    const fetchRollingNetGex = async () => {
      try {
        const res = await fetch(
          `/api/snapshots/option-strike-gex-history?expiry=${encodeURIComponent(actualExpiry)}&minutes=30`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;

        const nextMap = Object.fromEntries(
          (Array.isArray(json?.rows) ? json.rows : [])
            .map((row: Record<string, unknown>) => [Number(row.strike ?? 0), Number(row.rolling_net_gex ?? 0)] as const)
            .filter((entry: readonly [number, number]): entry is readonly [number, number] => entry[0] > 0 && Number.isFinite(entry[1]))
        );

        setRollingNetGexByStrike(nextMap);
      } catch {
        // no-op
      }
    };

    fetchRollingNetGex().catch(() => {});
    const t = setInterval(() => { fetchRollingNetGex().catch(() => {}); }, 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [expiryMap, selectedExpiry]);

  useEffect(() => {
    const actualExpiry = expiryMap[selectedExpiry];
    if (!actualExpiry || rawChain.length === 0) return;

    const now = Date.now();
    const last = lastRollingPersistRef.current;
    if (last.expiry === actualExpiry && now - last.stamp < 25000) return;

    const rows = rawChain
      .map((row) => ({
        timestamp: now,
        expiry: actualExpiry,
        spot: Number(row.spotPrice ?? spx ?? 0),
        strike: Number(row.strike ?? 0),
        net_gex: Number(row.netGEX ?? 0),
      }))
      .filter((row) => row.strike > 0 && Number.isFinite(row.net_gex));

    if (!rows.length) return;
    setRollingNetGexByStrike((current) =>
      Object.keys(current).length
        ? current
        : Object.fromEntries(rows.map((row) => [row.strike, row.net_gex]))
    );
    lastRollingPersistRef.current = { expiry: actualExpiry, stamp: now };

    void fetch("/api/snapshots/option-strike-gex-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rows),
    }).catch(() => {
      lastRollingPersistRef.current = { expiry: "", stamp: 0 };
    });
  }, [expiryMap, rawChain, selectedExpiry, spx]);

  const refreshSpxFlowPanel = useCallback(async () => {
    setSpxFlowRenderTick((tick) => tick + 1);
    await Promise.resolve();
  }, []);

  const chartRefresh = useRefreshButton(refreshGexPanels);
  const heatmapRefresh = useRefreshButton(refreshGexPanels);
  const spxFlowRefresh = useRefreshButton(refreshSpxFlowPanel);

  useEffect(() => {
    const fetchQuotes = async () => {
      try {
        const syms = SIDEBAR_SYMBOLS.join(",");
        const res = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(syms)}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const items: Array<{ symbol: string; mark?: number; "prev-day-close"?: number; last?: number }> = Array.isArray(json?.data?.items) ? json.data.items : [];
        if (!items.length) return;
        setSidebarQuotes(SIDEBAR_SYMBOLS.map(sym => {
          const q = items.find(i => i.symbol === sym || i.symbol === `${sym}:XCIS`);
          if (!q) return { sym, chg: "—", pos: true, active: sym === "NQU" };
          const price = q.mark ?? q.last ?? 0;
          const prev = q["prev-day-close"] ?? 0;
          const pct = prev > 0 ? ((price - prev) / prev) * 100 : 0;
          const pos = pct >= 0;
          return { sym, chg: `${pos ? "+" : ""}${pct.toFixed(2)}%`, pos, active: sym === "NQU" };
        }));
      } catch { /* non-fatal */ }
    };
    fetchQuotes();
    const t = setInterval(fetchQuotes, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchExpirations = async () => {
      try {
        const res = await fetch("/api/gex/expirations", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const rawItems = Array.isArray(json?.items) ? json.items as Array<Record<string, unknown>> : [];
        const rawExpirations = Array.isArray(json?.expirations) ? json.expirations as string[] : [];

        const today = etNow();
        today.setHours(0, 0, 0, 0);
        const items = rawItems.length
          ? rawItems
              .map((item) => ({
                date: String(item.date ?? ""),
                strikeCount: Number(item.strikeCount ?? 0),
              }))
              .filter((item) => item.date)
          : rawExpirations.map((date) => ({ date, strikeCount: 0 }));

        const upcoming = items
          .filter((item) => {
            const d = new Date(`${item.date}T00:00:00`);
            d.setHours(0, 0, 0, 0);
            return d.getTime() >= today.getTime();
          })
          .sort((a, b) => a.date.localeCompare(b.date));

        if (!upcoming.length) return;
        expiryCandidatesRef.current = upcoming;
        const picked = pickDashboardExpiries(upcoming);
        if (!cancelled) setExpiryMap(picked);
      } catch {
        // no-op
      }
    };

    fetchExpirations().catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const actualExpiry = expiryMap[selectedExpiry];
    if (!actualExpiry) return;
    let cancelled = false;

    const fetchExpiryChain = async () => {
      try {
        const fetchChainForExpiry = async (expiry: string) => {
          const res = await fetch(`/api/gex?expiry=${encodeURIComponent(expiry)}`, { cache: "no-store" });
          if (!res.ok) return null;
          return res.json();
        };

        let resolvedExpiry = actualExpiry;
        let json = await fetchChainForExpiry(resolvedExpiry);
        if (!json) return;

        if (selectedExpiry === "1dte") {
          const initialCount = Array.isArray(json?.chain) ? json.chain.length : 0;
          if (initialCount < 20) {
            const alternates = expiryCandidatesRef.current
              .filter((item) => item.date !== expiryMap["0dte"] && item.date !== actualExpiry)
              .sort((a, b) => (b.strikeCount - a.strikeCount) || a.date.localeCompare(b.date));

            for (const alternate of alternates) {
              const altJson = await fetchChainForExpiry(alternate.date);
              const altCount = Array.isArray(altJson?.chain) ? altJson.chain.length : 0;
              if (altJson && altCount >= 20) {
                json = altJson;
                resolvedExpiry = alternate.date;
                if (!cancelled) {
                  setExpiryMap((current) => ({ ...current, "1dte": alternate.date }));
                }
                break;
              }
            }
          }
        }

        if (cancelled) return;
        const nextChain = Array.isArray(json?.chain) ? json.chain : [];
        if (nextChain.length) setRawChain(nextChain);
        if (Number(json?.spotPrice ?? 0) > 100) setSpx(Number(json.spotPrice));
        if (Number(json?.summary?.totalNetGEX ?? 0) !== 0) setNetGex(Number(json.summary.totalNetGEX));
        setCallWall(json?.callWall ?? null);
        setPutWall(json?.putWall ?? null);
        setGexFlip(json?.gexFlip ?? null);
        setGexProfile(json?.profile ?? null);
      } catch {
        // no-op
      }
    };

    fetchExpiryChain().catch(() => {});
    const t = setInterval(() => { fetchExpiryChain().catch(() => {}); }, 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [expiryMap, selectedExpiry]);

  // ── Task #7 Step 3 + Task #9: Filter heatmap by expiry, apply live colors ────
  useEffect(() => {
    if (rawChain.length === 0) return;

    const spot = spx || 7554;

    // Always use the full merged chain for the heatmap — the API merges all
    // expirations into per-strike totals. DTE filtering is only meaningful for
    // the chart bars (which have their own filter). Filtering here drops strikes
    // that only have data in the next expiry, leaving mostly $0 rows.
    const source = rawChain;

    // Find ATM: closest strike at or below spot (floor), ties go to lower strike
    const atmStrike = source.reduce((best, r) => {
      const dBest = spot - best.strike; // positive = best is below spot
      const dR    = spot - r.strike;
      // Prefer strike just below or at spot; among equal distance pick the lower one
      const absBest = Math.abs(dBest);
      const absR    = Math.abs(dR);
      if (absR < absBest) return r;
      if (absR === absBest) return r.strike < best.strike ? r : best; // pick lower
      return best;
    }).strike;

    // Sort descending (highest strike first) for display
    const sortedAll = [...source].sort((a, b) => b.strike - a.strike);

    // Window: 20 above + ATM + 20 below spot
    const atmIdx = sortedAll.findIndex(r => r.strike === atmStrike);
    const winStart = Math.max(0, atmIdx - 20);
    const winEnd = Math.min(sortedAll.length - 1, atmIdx + 20);
    const sorted = sortedAll.slice(winStart, winEnd + 1);

    const combinedGex = (r: typeof sorted[0]) => (r.netGEX ?? 0) + (r.netVolGEX ?? 0);
    const displayNetGex = (r: typeof sorted[0]) => (
      dataMode === "vol-only"
        ? (r.netVolGEX ?? 0)
        : combinedGex(r)
    );
    const displayDexValue = (r: typeof sorted[0]) => (
      dataMode === "vol-only"
        ? (r.volNetDEX ?? 0)
        : (r.netDEX ?? 0) + (r.volNetDEX ?? 0)
    );

    // Find top pos/neg for rank badges using the active data mode.
    const effGex = (r: typeof sorted[0]) => displayNetGex(r);
    const sorted_by_abs_gex = [...sorted].sort((a, b) => Math.abs(effGex(b)) - Math.abs(effGex(a)));
    const topPos = sorted_by_abs_gex.filter(r => effGex(r) > 0).slice(0, 5).map(r => r.strike);
    const topNeg = sorted_by_abs_gex.filter(r => effGex(r) < 0).slice(0, 5).map(r => r.strike);
    const posRanks = Object.fromEntries(topPos.map((s, i) => [s, i + 1]));
    const negRanks = Object.fromEntries(topNeg.map((s, i) => [s, i + 1]));

    const fmt = (v: number) => {
      const a = Math.abs(v);
      const sign = v < 0 ? "-" : "";
      if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
      if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
      if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
      return `${sign}$${a.toFixed(0)}`;
    };

    const rows = sorted.map(r => {
      const isAtm = r.strike === atmStrike;

      const displayGex = displayNetGex(r);
      const displayDex = displayDexValue(r);

      const isPosTop = posRanks[r.strike] === 1;
      const isNegTop = negRanks[r.strike] === 1;
      const rank = posRanks[r.strike] ?? negRanks[r.strike];
      const rankColor = rank && rank <= 2 ? "#F97316" : rank ? "#8B94A7" : undefined;

      let type = "neutral";
      if (isAtm) type = "atm";
      else if (isPosTop) type = "pos-top";
      else if (isNegTop) type = "neg-top";
      else if (displayGex > 0 && posRanks[r.strike]) type = "pos-strong";
      else if (displayGex < 0 && negRanks[r.strike]) type = "neg-red";
      else if (displayGex < 0) type = "neg";

      const vannaValue = dataMode === "vol-only"
        ? (r.netVolVanna ?? r.netVanna ?? 0)
        : (r.netVanna ?? 0) + (r.netVolVanna ?? 0);
      return {
        strike: r.strike.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
        netGex: fmt(displayGex),
        volOnly: fmt(r.netVolGEX),
        dex: fmt(displayDex),
        gexVex: fmt(displayGex + vannaValue),
        rollingNetGex: Number.isFinite(rollingNetGexByStrike[r.strike]) ? fmt(rollingNetGexByStrike[r.strike]) : "—",
        type,
        rank: rank ?? undefined,
        rankColor,
        atm: isAtm,
      };
    });

    // Drop strikes where ALL data is zero — truly empty strikes (not just OI=0)
    const nonEmpty = rows.filter(r =>
      r.type === "atm" ||
      r.netGex !== "$0" || r.volOnly !== "$0" || r.dex !== "$0" || r.gexVex !== "$0"
    );

    setHeatmapData(nonEmpty);
  }, [dataMode, rawChain, rollingNetGexByStrike, selectedExpiry, spx]);


  const etTime = now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  // ── Task #8: Compute GEX chart bars from live chain ───────────────────────────
  const chartBars = (() => {
    if (rawChain.length === 0) return null;

    // Use full merged chain — DTE per-strike is unreliable after cross-expiry merge
    const source = rawChain;
    const sorted = [...source].sort((a, b) => a.strike - b.strike);
    // Base chart uses one GEX mode plus one data mode, with optional overlays.
    const getSpot = (r: typeof sorted[0]) => r.spotPrice || spx || r.strike;
    const getCallVolGex = (r: typeof sorted[0]) => (r.callGamma ?? 0) * (r.callVolume ?? 0) * getSpot(r) * getSpot(r);
    const getPutVolGex = (r: typeof sorted[0]) => -Math.abs((r.putGamma ?? 0) * (r.putVolume ?? 0) * getSpot(r) * getSpot(r));
    const getCallVal = (r: typeof sorted[0]) => (
      dataMode === "vol-only"
        ? getCallVolGex(r)
        : (r.callGEX ?? 0) + getCallVolGex(r)
    );
    const getPutVal = (r: typeof sorted[0]) => (
      dataMode === "vol-only"
        ? getPutVolGex(r)
        : (r.putGEX ?? 0) + getPutVolGex(r)
    );
    const getNetVal = (r: typeof sorted[0]) => (
      dataMode === "vol-only"
        ? (r.netVolGEX ?? 0)
        : (r.netGEX ?? 0) + (r.netVolGEX ?? 0)
    );
    const getDexVal = (r: typeof sorted[0]) => (
      dataMode === "vol-only"
        ? (r.volNetDEX ?? 0)
        : (r.netDEX ?? 0) + (r.volNetDEX ?? 0)
    );
    const getVal = (r: typeof sorted[0]) => (
      gexMode === "call-put" ? getCallVal(r) + getPutVal(r) : getNetVal(r)
    );

    const vals = sorted.map(r => getVal(r));
    const maxAbs = Math.max(...vals.map(Math.abs), 1);

    // Trim to zoomHalf strikes each side of ATM, with drag pan offset
    const spot = spx || sorted[Math.floor(sorted.length / 2)]?.strike || 7500;
    const atmIdx = sorted.reduce((bi, r, i) => Math.abs(r.strike - spot) < Math.abs(sorted[bi].strike - spot) ? i : bi, 0);
    const half = zoomHalf;
    const centerIdx = Math.max(half, Math.min(sorted.length - 1 - half, atmIdx + panOffset));
    const start = Math.max(0, centerIdx - half);
    const end = Math.min(sorted.length - 1, centerIdx + half);
    const slice = sorted.slice(start, end + 1);
    const sliceVals = vals.slice(start, end + 1);

    const CHART_W = 800;
    const CHART_H = 400; // match SVG viewBox height
    const ZERO_Y = CHART_H / 2;
    const spacing = CHART_W / (slice.length + 1);
    // Bar width: fill ~80% of spacing, never overlap (cap at spacing-1), min 2px
    const BAR_W = Math.max(2, Math.min(spacing * 0.8, spacing - 1));

    // Find peak bar (highest absolute GEX, pos or neg) for label
    let peakPosBar: { x: number; y: number; barH: number; strike: number; isPos: boolean } | null = null as { x: number; y: number; barH: number; strike: number; isPos: boolean } | null;
    let peakPosVal = 0;

    // For call-put mode, build two bar arrays (call=cyan above zero, put=gold below zero)
    const isCallPut = gexMode === "call-put";
    const callPutBars: { x: number; callH: number; putH: number; barW: number; strike: number; callVal: number; putVal: number }[] = [];

    const bars = slice.map((r, i) => {
      const v = sliceVals[i];
      const x = spacing * (i + 1);

      if (isCallPut) {
        const callVal = getCallVal(r);
        const putVal = getPutVal(r);
        const callH = Math.max(2, (Math.abs(callVal) / maxAbs) * (CHART_H / 2 - 24));
        const putH  = Math.max(2, (Math.abs(putVal)  / maxAbs) * (CHART_H / 2 - 24));
        callPutBars.push({ x, callH, putH, barW: BAR_W, strike: r.strike, callVal, putVal });
      }

      const heightPct = Math.abs(v) / maxAbs;
      const barH = Math.max(2, heightPct * (CHART_H / 2 - 24));
      const isPos = v >= 0;
      const y = isPos ? ZERO_Y - barH : ZERO_Y;
      const fill = isPos ? "url(#cyanBarGrad)" : "url(#goldBarGrad)";
      const glow = isPos
        ? "drop-shadow(0 0 6px rgba(0,240,255,0.5))"
        : "drop-shadow(0 0 6px rgba(234,179,8,0.5))";
      const highlight = Math.abs(v) > maxAbs * 0.5;

      if (Math.abs(v) > peakPosVal) {
        peakPosVal = Math.abs(v);
        peakPosBar = { x, y, barH, strike: r.strike, isPos };
      }

      return { x, y, barH, barW: BAR_W, fill: highlight ? (isPos ? "#00F0FF" : "url(#goldBarBright)") : fill, glow: highlight ? glow : undefined, strike: r.strike, isPos, val: v };
    });

    // OI overlay — call OI (green) and put OI (red/gold) as bars rising from bottom
    // Scaled independently so peaks reach ~40% of half-chart height
    const oiCallMax = Math.max(...slice.map(r => r.callOI), 1);
    const oiPutMax  = Math.max(...slice.map(r => r.putOI),  1);
    const OI_MAX_H  = CHART_H * 0.42; // max bar height from bottom
    const oiBars = showOiOverlay ? slice.map((r, i) => {
      const x = spacing * (i + 1);
      const callH = Math.max(1, (r.callOI / oiCallMax) * OI_MAX_H);
      const putH  = Math.max(1, (r.putOI  / oiPutMax)  * OI_MAX_H);
      return { x, callH, putH, barW: BAR_W, strike: r.strike };
    }) : null;

    // Net DEX — smooth cubic-bezier curve overlay, scaled to chart half-height
    const dexMaxAbs = Math.max(...slice.map(r => Math.abs(getDexVal(r))), 1);
    const dexPoints = showNetDex ? slice.map((r, i) => ({
      x: spacing * (i + 1),
      y: ZERO_Y - (getDexVal(r) / dexMaxAbs) * (CHART_H / 2 - 24),
    })) : null;

    // GEX Flip / Gamma-zero profile from server-side spot sweep, clipped to +/-5% around spot.
    const gexFlipPoints = showGexFlip ? (() => {
      if (!gexProfile?.levels?.length || !gexProfile?.values?.length || !(spot > 0)) return null;
      const lo = spot * 0.95;
      const hi = spot * 1.05;
      const points = gexProfile.levels
        .map((level, i) => ({ level, value: Number(gexProfile.values[i] ?? 0) }))
        .filter((point) => point.level >= lo && point.level <= hi && Number.isFinite(point.value));
      if (points.length < 2) return null;
      const flipMaxAbs = Math.max(...points.map((point) => Math.abs(point.value)), 1);
      return points.map((point, i) => ({
        x: 24 + ((CHART_W - 48) * i) / Math.max(points.length - 1, 1),
        y: ZERO_Y - (point.value / flipMaxAbs) * (CHART_H / 2 - 24),
        isPos: point.value >= 0,
      }));
    })() : null;

    // Peak label — always use the actual peak bar's strike so label matches position
    const peakLabel = peakPosBar ? peakPosBar.strike.toLocaleString() : null;

    return {
      bars,
      callPutBars: isCallPut ? callPutBars : null,
      oiBars,
      dexPoints,
      gexFlipPoints,
      peakPosBar,
      peakLabel,
      spot,
      ZERO_Y,
    };
  })();

  // ── Styles ──────────────────────────────────────────────────────────────────
  const C = {
    bg: "#05060A",
    panel: "#0D1119",
    cyan: "#00F0FF",
    purple: "#8B5CF6",
    orange: "#F97316",
    green: "#10B981",
    red: "#EF4444",
    muted: "#8B94A7",
  };

  const floatSection: React.CSSProperties = {
    position: "relative",
    padding: "0",
  };

  const gradDivider: React.CSSProperties = {
    height: 1,
    background: "linear-gradient(to right, transparent, rgba(0,240,255,0.08), rgba(139,92,246,0.08), transparent)",
    margin: "0",
  };

  return (
    <div style={{
      height: "100%", width: "100%", overflow: "hidden",
      background: C.bg,
      backgroundImage: "radial-gradient(circle at 15% 50%, rgba(0,240,255,0.02) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(139,92,246,0.03) 0%, transparent 50%)",
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      color: "#fff",
      display: "flex",
      flexDirection: "row",
    }}>

      {/* ── MAIN ──────────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", minWidth: 0 }}>

        {/* ── BODY ──────────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "row", padding: "24px", gap: 32, minHeight: 0, overflow: "hidden" }}>

          {/* LEFT COLUMN */}
          <div style={{ width: "55%", display: "flex", flexDirection: "column", gap: 0, minWidth: 0, height: "100%", overflow: "hidden" }}>

            {/* GEX CHART */}
            {(() => {
              // Dynamic DTE date labels
              const d0 = expiryMap["0dte"] ? fmtExpiryDate(expiryMap["0dte"]) : "--/--";
              const d1 = expiryMap["1dte"] ? fmtExpiryDate(expiryMap["1dte"]) : "--/--";

              const CHART_W = 800, CHART_H = 400;
              const ZERO_Y = CHART_H / 2;

              const handleWheel = (e: React.WheelEvent) => {
                e.preventDefault();
                setZoomHalf(prev => Math.max(5, Math.min(80, prev + (e.deltaY > 0 ? 5 : -5))));
              };

              const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
                dragRef.current = { startX: e.clientX, startPan: panOffset };
              };

              const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
                // Drag pan
                if (dragRef.current && e.buttons === 1) {
                  const dx = e.clientX - dragRef.current.startX;
                  const svgW = svgRef.current?.getBoundingClientRect().width ?? CHART_W;
                  const strikesPerPx = (zoomHalf * 2) / svgW;
                  const newPan = dragRef.current.startPan - Math.round(dx * strikesPerPx);
                  setPanOffset(Math.max(-60, Math.min(60, newPan)));
                  setHoverBar(null);
                  return;
                }
                // Hover tooltip
                if (!chartBars || !svgRef.current) return;
                const rect = svgRef.current.getBoundingClientRect();
                // SVG has paddingRight:48 paddingBottom:24 — drawable area is narrower.
                // Use getBoundingClientRect on the SVG then map via the SVG's own
                // coordinate transform (handles CSS padding correctly).
                const pt = svgRef.current.createSVGPoint();
                pt.x = e.clientX;
                pt.y = e.clientY;
                const svgPt = pt.matrixTransform(svgRef.current.getScreenCTM()!.inverse());
                const svgX = svgPt.x;
                let closest: typeof chartBars.bars[0] | null = null;
                let minDist = Infinity;
                for (const b of chartBars.bars) {
                  const d = Math.abs(b.x - svgX);
                  if (d < minDist) { minDist = d; closest = b; }
                }
                if (closest && minDist < chartBars.bars[0]?.barW * 2 + 4) {
                  setHoverBar({ x: closest.x, y: closest.y, strike: closest.strike, val: closest.val, isPos: closest.isPos });
                } else {
                  setHoverBar(null);
                }
              };

              const handleMouseUp = () => { dragRef.current = null; };

              return (
              <div
                ref={gexChartRef}
                style={{
                  background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)",
                  borderRadius: 16, padding: 24, display: "flex", flexDirection: "column",
                  height: 580, flexShrink: 0,
                }}
              >
                {/* Chart Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexShrink: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", flexShrink: 0 }}>
                    <span style={{ color: C.cyan }}><BarChart2 /></span>
                    Net GEX
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button onClick={() => { setSelectedExpiry("0dte"); setPanOffset(0); }} style={{ color: "#fff", padding: "4px 10px", fontSize: 10, background: selectedExpiry === "0dte" ? "rgba(0,240,255,0.25)" : "rgba(255,255,255,0.02)", border: "none", borderRadius: 4, cursor: "pointer", textTransform: "uppercase", fontWeight: 600 }}>0DTE {d0}</button>
                    <button onClick={() => { setSelectedExpiry("1dte"); setPanOffset(0); }} style={{ background: selectedExpiry === "1dte" ? "rgba(0,240,255,0.25)" : "rgba(255,255,255,0.02)", color: C.cyan, border: "none", padding: "4px 10px", fontSize: 10, borderRadius: 4, cursor: "pointer", textTransform: "uppercase", fontWeight: 600 }}>1DTE {d1}</button>
                    <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.10)", margin: "0 2px" }} />
                    {(["net-gex","call-put"] as const).map(m => (
                      <button key={m} onClick={() => { setGexMode(m); setPanOffset(0); }} style={{ color: gexMode === m ? C.cyan : "#fff", padding: "4px 8px", fontSize: 10, background: gexMode === m ? "rgba(0,240,255,0.10)" : "rgba(255,255,255,0.02)", border: "none", borderRadius: 4, cursor: "pointer", textTransform: "uppercase", fontWeight: 600 }}>{m.replace("-"," ")}</button>
                    ))}
                    <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.10)", margin: "0 2px" }} />
                    {(["oi-vol","vol-only"] as const).map(m => (
                      <button key={m} onClick={() => { setDataMode(m); setPanOffset(0); }} style={{ color: dataMode === m ? C.cyan : "#fff", padding: "4px 8px", fontSize: 10, background: dataMode === m ? "rgba(0,240,255,0.10)" : "rgba(255,255,255,0.02)", border: "none", borderRadius: 4, cursor: "pointer", textTransform: "uppercase", fontWeight: 600 }}>{m.replace("-"," ")}</button>
                    ))}
                    <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.10)", margin: "0 2px" }} />
                    {([{ key: "oi-overlay", label: "+oi overlay", active: showOiOverlay, onClick: () => setShowOiOverlay(v => !v) }, { key: "net-dex", label: "+net dex", active: showNetDex, onClick: () => setShowNetDex(v => !v) }, { key: "gex-flip", label: "+gex flip", active: showGexFlip, onClick: () => setShowGexFlip(v => !v) }] as const).map(({ key, label, active, onClick }) => (
                      <button key={key} onClick={() => { onClick(); setPanOffset(0); }} style={{ color: active ? C.cyan : "#fff", padding: "4px 8px", fontSize: 10, background: active ? "rgba(0,240,255,0.10)" : "rgba(255,255,255,0.02)", border: "none", borderRadius: 4, cursor: "pointer", textTransform: "uppercase", fontWeight: 600 }}>{label}</button>
                    ))}
                    <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.10)", margin: "0 2px" }} />
                    <button onClick={chartRefresh.trigger} style={{ ...chartRefresh.style, fontSize: 10, padding: "4px 8px", borderRadius: 4 }}>
                      {chartRefresh.label}
                    </button>
                    <BoxSnapBtn targetRef={gexChartRef} />
                    <BoxDiscordBtn
                      targetRef={gexChartRef}
                      message={`📸 GEX Chart — ${selectedExpiry.toUpperCase()}${expiryMap[selectedExpiry] ? ` ${fmtExpiryDate(expiryMap[selectedExpiry])}` : ""} — ${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })} ET`}
                    />
                  </div>
                </div>

                {/* Legend */}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "monospace", marginBottom: 6, padding: "0 8px", flexShrink: 0 }}>
                  <div style={{ display: "flex", gap: 16 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, color: C.cyan }}>
                      <span style={{ width: 8, height: 8, background: C.cyan, borderRadius: 2, display: "inline-block" }} />{gexMode === "call-put" ? "Call GEX" : "+ GEX"}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#EAB308" }}>
                      <span style={{ width: 8, height: 8, background: "#EAB308", borderRadius: 2, display: "inline-block" }} />{gexMode === "call-put" ? "Put GEX" : "- GEX"}
                    </span>
                    <span style={{ color: "#3a5570" }}>Drag to pan · Scroll to zoom ({zoomHalf*2} strikes)</span>
                  </div>
                  <span style={{ color: "#fff" }}>Units in $B</span>
                </div>

                {/* Chart */}
                <div style={{ flex: 1, position: "relative", width: "100%", minHeight: 0 }} onWheel={handleWheel}>
                  {/* Hover tooltip */}
                  {hoverBar && (
                    <div style={{
                      position: "absolute", zIndex: 30, pointerEvents: "none",
                      top: 8, left: "50%", transform: "translateX(-50%)",
                      background: "rgba(13,17,25,0.92)", border: "1px solid rgba(0,240,255,0.25)",
                      borderRadius: 6, padding: "6px 12px", fontSize: 11, fontFamily: "monospace",
                      color: "#fff", display: "flex", gap: 12, backdropFilter: "blur(8px)",
                    }}>
                      <span style={{ color: C.muted }}>Strike</span>
                      <span style={{ fontWeight: 700 }}>{hoverBar.strike.toLocaleString()}</span>
                      <span style={{ color: C.muted }}>GEX</span>
                      <span style={{ fontWeight: 700, color: hoverBar.isPos ? C.cyan : "#EAB308" }}>{fmtMoney(hoverBar.val)}</span>
                    </div>
                  )}
                  {/* Y-axis */}
                  <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: 9, fontFamily: "monospace", color: "#fff", alignItems: "flex-end", zIndex: 20, pointerEvents: "none", paddingBottom: 20 }}>
                    {["+$6B","+$4B","+$2B","0","-$2B","-$4B","-$6B"].map((l, i) => (
                      <span key={i} style={{ color: "#fff" }}>{l}</span>
                    ))}
                  </div>
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                    preserveAspectRatio="none"
                    style={{ width: "100%", height: "100%", paddingRight: 32, paddingBottom: 24, boxSizing: "border-box", cursor: dragRef.current ? "grabbing" : "grab", userSelect: "none" }}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={() => { dragRef.current = null; setHoverBar(null); }}
                  >
                    <defs>
                      <linearGradient id="cyanBarGrad" x1="0" y1="1" x2="0" y2="0">
                        <stop offset="0%" stopColor="#0284C7"/><stop offset="100%" stopColor="#00F0FF"/>
                      </linearGradient>
                      <linearGradient id="goldBarGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#CA8A04"/><stop offset="100%" stopColor="#EAB308"/>
                      </linearGradient>
                      <linearGradient id="goldBarBright" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#D97706"/><stop offset="100%" stopColor="#FCD34D"/>
                      </linearGradient>
                      <linearGradient id="strikeGradCyan" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(0,217,255,0.4)"/><stop offset="100%" stopColor="rgba(0,217,255,0.1)"/>
                      </linearGradient>
                    </defs>
                    {/* Grid lines */}
                    {[CHART_H*0.125, CHART_H*0.25, CHART_H*0.375, CHART_H*0.625, CHART_H*0.75, CHART_H*0.875].map(y => (
                      <line key={y} x1="0" y1={y} x2={CHART_W} y2={y} stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
                    ))}
                    {/* Zero line */}
                    <line x1="0" y1={ZERO_Y} x2={CHART_W} y2={ZERO_Y} stroke="rgba(255,255,255,0.3)" strokeWidth="2"/>
                    {/* Spot price vertical line */}
                    {chartBars?.spot != null && (() => {
                      const spotBar = chartBars.bars.find(b => b.strike === chartBars.spot) ?? chartBars.bars.reduce((best, b) => Math.abs(b.strike - chartBars.spot) < Math.abs(best.strike - chartBars.spot) ? b : best, chartBars.bars[0]);
                      if (!spotBar) return null;
                      return (
                        <g>
                          <line x1={spotBar.x} y1={0} x2={spotBar.x} y2={CHART_H} stroke="rgba(255,255,255,0.22)" strokeWidth="1" strokeDasharray="6 4"/>
                          <text x={spotBar.x + 4} y={ZERO_Y - 6} fill="#ffffff" fontSize="9" fontFamily="monospace">SPX {chartBars.spot.toLocaleString()}</text>
                        </g>
                      );
                    })()}
                    {/* Hover highlight */}
                    {hoverBar && (
                      <line x1={hoverBar.x} y1={0} x2={hoverBar.x} y2={CHART_H} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4 4"/>
                    )}

                    {/* Live bars */}
                    {chartBars ? (
                      <>
                        {/* Call-Put mode: full-width bars mirrored around zero */}
                        {chartBars.callPutBars ? chartBars.callPutBars.map((b, i) => (
                          <g key={`cp-${i}`}>
                            <rect x={b.x - b.barW / 2} y={ZERO_Y - b.callH} width={b.barW} height={b.callH} fill="url(#cyanBarGrad)" opacity={0.92}/>
                            <rect x={b.x - b.barW / 2} y={ZERO_Y} width={b.barW} height={b.putH} fill="url(#goldBarGrad)" opacity={0.92}/>
                          </g>
                        )) : chartBars.bars.map((b, i) => (
                          <rect
                            key={`bar-${i}`}
                            x={b.x - b.barW / 2}
                            y={b.y}
                            width={b.barW}
                            height={b.barH}
                            fill={hoverBar?.strike === b.strike ? (b.isPos ? "#fff" : "#FCD34D") : b.fill}
                            style={b.glow ? { filter: b.glow } : undefined}
                          />
                        ))}

                        {/* OI overlay: call=green mountain from bottom, put=gold/dark-green mountain from bottom */}
                        {chartBars.oiBars && (() => {
                          const callPts = chartBars.oiBars.map(b => `${b.x},${CHART_H - b.callH}`).join(" ");
                          const putPts  = chartBars.oiBars.map(b => `${b.x},${CHART_H - b.putH}`).join(" ");
                          const firstX  = chartBars.oiBars[0]?.x ?? 0;
                          const lastX   = chartBars.oiBars[chartBars.oiBars.length - 1]?.x ?? CHART_W;
                          return (
                            <g opacity={0.75}>
                              <defs>
                                <linearGradient id="oiCallGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#10B981" stopOpacity="0.7"/>
                                  <stop offset="100%" stopColor="#10B981" stopOpacity="0.1"/>
                                </linearGradient>
                                <linearGradient id="oiPutGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#EF4444" stopOpacity="0.6"/>
                                  <stop offset="100%" stopColor="#EF4444" stopOpacity="0.1"/>
                                </linearGradient>
                              </defs>
                              {/* Call OI — green fills from bottom */}
                              <polygon
                                points={`${firstX},${CHART_H} ${callPts} ${lastX},${CHART_H}`}
                                fill="url(#oiCallGrad)"
                              />
                              {/* Put OI — red fills from bottom */}
                              <polygon
                                points={`${firstX},${CHART_H} ${putPts} ${lastX},${CHART_H}`}
                                fill="url(#oiPutGrad)"
                              />
                            </g>
                          );
                        })()}

                        {/* Net DEX — smooth cubic bezier curve */}
                        {chartBars.dexPoints && chartBars.dexPoints.length > 1 && (() => {
                          const pts = chartBars.dexPoints;
                          let d = `M ${pts[0].x} ${pts[0].y}`;
                          for (let i = 1; i < pts.length; i++) {
                            const prev = pts[i - 1];
                            const curr = pts[i];
                            const cpX = (prev.x + curr.x) / 2;
                            d += ` C ${cpX},${prev.y} ${cpX},${curr.y} ${curr.x},${curr.y}`;
                          }
                          return (
                            <path d={d} fill="none" stroke="#8B5CF6" strokeWidth="2.5" opacity={0.9}
                              style={{ filter: "drop-shadow(0 0 4px rgba(139,92,246,0.6))" }}/>
                          );
                        })()}

                        {/* GEX Flip — continuous gamma zero profile line with area fill */}
                        {chartBars.gexFlipPoints && chartBars.gexFlipPoints.length > 1 && (() => {
                          const pts = chartBars.gexFlipPoints;
                          // Build smooth path
                          let d = `M ${pts[0].x} ${pts[0].y}`;
                          for (let i = 1; i < pts.length; i++) {
                            const prev = pts[i - 1];
                            const curr = pts[i];
                            const cpX = (prev.x + curr.x) / 2;
                            d += ` C ${cpX},${prev.y} ${cpX},${curr.y} ${curr.x},${curr.y}`;
                          }
                          const firstX = pts[0].x, lastX = pts[pts.length - 1].x;
                          return (
                            <g>
                              <defs>
                                <linearGradient id="flipGradPos" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#00F0FF" stopOpacity="0.3"/>
                                  <stop offset="100%" stopColor="#00F0FF" stopOpacity="0.0"/>
                                </linearGradient>
                                <linearGradient id="flipGradNeg" x1="0" y1="1" x2="0" y2="0">
                                  <stop offset="0%" stopColor="#EAB308" stopOpacity="0.3"/>
                                  <stop offset="100%" stopColor="#EAB308" stopOpacity="0.0"/>
                                </linearGradient>
                              </defs>
                              {/* Area fill above zero */}
                              <path
                                d={`${d} L ${lastX},${ZERO_Y} L ${firstX},${ZERO_Y} Z`}
                                fill="url(#flipGradPos)" opacity={0.6}
                                style={{ clipPath: `inset(0 0 ${CHART_H - ZERO_Y}px 0)` }}
                              />
                              {/* Area fill below zero */}
                              <path
                                d={`${d} L ${lastX},${ZERO_Y} L ${firstX},${ZERO_Y} Z`}
                                fill="url(#flipGradNeg)" opacity={0.6}
                                style={{ clipPath: `inset(${ZERO_Y}px 0 0 0)` }}
                              />
                              {/* The profile line itself */}
                              <path d={d} fill="none" stroke="#F97316" strokeWidth="2"
                                opacity={0.9} style={{ filter: "drop-shadow(0 0 4px rgba(249,115,22,0.5))" }}/>
                              {/* Zero line reference */}
                              <line x1={firstX} y1={ZERO_Y} x2={lastX} y2={ZERO_Y}
                                stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4 4"/>
                            </g>
                          );
                        })()}

                        {/* Peak label — at tip of tallest absolute bar */}
                        {(() => {
                          const pb = chartBars.peakPosBar;
                          if (!pb || !chartBars.peakLabel) return null;
                          // tip: top of pos bar = pb.y; bottom of neg bar = pb.y + pb.barH
                          const tipY = pb.isPos
                            ? pb.y               // top edge of positive bar
                            : pb.y + pb.barH;    // bottom edge of negative bar
                          const labelY = pb.isPos
                            ? Math.max(16, tipY - 4)       // above bar tip
                            : Math.min(CHART_H - 4, tipY + 18); // below bar tip
                          const rectY = pb.isPos
                            ? Math.max(2, tipY - 18)
                            : Math.min(CHART_H - 16, tipY + 4);
                          return (
                            <>
                              <rect x={pb.x - 18} y={rectY} width={36} height={12} fill="url(#strikeGradCyan)" rx="2"/>
                              <text x={pb.x} y={labelY} textAnchor="middle" fontSize="9" fontFamily="monospace" fill="#ffffff" fontWeight="700">{chartBars.peakLabel}</text>
                            </>
                          );
                        })()}
                      </>
                    ) : (
                      <>
                        <rect x="370" y="20" width="25" height={ZERO_Y - 20} fill="#00F0FF" style={{ filter: "drop-shadow(0 0 8px rgba(0,240,255,0.6))" }}/>
                        <rect x="333" y="5" width="44" height="14" fill="url(#strikeGradCyan)" rx="2"/>
                        <text x="355" y="14" textAnchor="middle" fontSize="11" fontFamily="monospace" fill={C.cyan} fontWeight="700">Loading…</text>
                      </>
                    )}
                  </svg>
                  {/* X-axis labels */}
                  {chartBars && (
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "space-between", padding: "4px 0 0", fontSize: 9, fontFamily: "monospace", color: "#fff" }}>
                      {[0, Math.floor(chartBars.bars.length/4), Math.floor(chartBars.bars.length/2), Math.floor(chartBars.bars.length*3/4), chartBars.bars.length-1].map(i => {
                        const b = chartBars.bars[i];
                        if (!b) return null;
                        const isAtm = Math.abs(b.strike - (spx || 7554)) < 10;
                        return <span key={i} style={{ color: "#fff", fontWeight: isAtm ? 700 : 500 }}>{b.strike.toLocaleString()}</span>;
                      })}
                    </div>
                  )}
                </div>
              </div>
              );
            })()}

            {/* TABS */}
            <div style={{
              background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)",
              borderRadius: 16, display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden", marginTop: 24,
            }}>
              {/* Tab headers */}
              <div className="grad-divider-b" style={{ display: "flex", padding: "0 0", flexShrink: 0 }}>
                {([
                  { id: "calendar", label: "Economic Calendar", icon: <CalendarIcon /> },
                  { id: "snapshot", label: "Snapshot Flow", icon: <ActivityIcon /> },
                  { id: "spxflow", label: "SPX Flow", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg> },
                ] as const).map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "12px 16px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
                    background: "none", border: "none", cursor: "pointer",
                    color: activeTab === tab.id ? C.cyan : "#fff",
                    borderBottom: activeTab === tab.id ? `2px solid ${C.cyan}` : "2px solid transparent",
                    marginBottom: -1,
                    transition: "color 0.15s",
                  }}>
                    {tab.icon}{tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, overflowY: "auto", padding: 24, scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.05) transparent" }}>
                {activeTab === "calendar" && (
                  <div style={{ margin: -24, height: "calc(100% + 48px)" }}>
                    <EconCalendarPanel />
                  </div>
                )}
                {activeTab === "snapshot" && (
                  <div style={{ margin: -24, height: "calc(100% + 48px)" }}>
                    <SnapshotPanel />
                  </div>
                )}
                {activeTab === "spxflow" && (
                  <div ref={spxFlowRef} key={spxFlowRenderTick} style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBottom: 14, marginBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                        <span style={{ color: C.cyan }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
                        </span>
                        SPX Flow
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button onClick={spxFlowRefresh.trigger} style={{ ...spxFlowRefresh.style, fontSize: 10, padding: "4px 8px", borderRadius: 4 }}>
                          {spxFlowRefresh.label}
                        </button>
                        <BoxSnapBtn targetRef={spxFlowRef} />
                        <BoxDiscordBtn
                          targetRef={spxFlowRef}
                          message={`📊 SPX Flow — ${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })} ET`}
                        />
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, opacity: 0.4 }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="1.5" strokeLinecap="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: "0.15em" }}>Coming Soon</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ width: "45%", display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>

            <div className="grad-divider-b" style={{ flexShrink: 0, paddingBottom: 12, marginBottom: 12, position: "relative" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "nowrap", overflow: "hidden" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>
                    SPX <span style={{ color: "#fff", fontWeight: 400 }}>/ GEX</span>
                  </span>
                  <div style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.10)", padding: "2px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                    {etTime}
                  </div>
                  <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, color: "#8da8c2", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>VIX</span>
                    <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: "#fff" }}>{vix > 0 ? vix.toFixed(2) : "—"}</span>
                    {vix > 0 && <span style={{ fontFamily: "monospace", fontSize: 11, color: C.red }}>{spxChg < 0 ? "+" : "-"}{Math.abs(vix * 0.05).toFixed(2)} ({spxChg < 0 ? "+" : "-"}{(Math.abs(vix * 0.05) / vix * 100).toFixed(2)}%)</span>}
                  </div>
                  <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, color: "#8da8c2", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>ESU</span>
                    <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 800, color: "#fff" }}>{esFut > 0 ? esFut.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</span>
                    {esFut > 0 && <span style={{ fontFamily: "monospace", fontSize: 11, color: esChg >= 0 ? C.green : C.red }}>{esChg >= 0 ? "+" : ""}{esChg.toFixed(2)} ({esChgPct >= 0 ? "+" : ""}{esChgPct.toFixed(2)}%)</span>}
                  </div>
                  <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, color: "#8da8c2", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>SPX</span>
                    <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 800, color: "#fff" }}>{spx > 0 ? spx.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</span>
                    {spx > 0 && <span style={{ fontFamily: "monospace", fontSize: 11, color: spxChg >= 0 ? C.green : C.red }}>{spxChg >= 0 ? "+" : ""}{spxChg.toFixed(2)} ({spxChgPct >= 0 ? "+" : ""}{spxChgPct.toFixed(2)}%)</span>}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 8, color: "#8da8c2", textTransform: "uppercase", fontWeight: 700 }}>MVC</span>
                    <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: netGex >= 0 ? C.green : C.red }}>{fmtMoney(netGex)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 9, color: "#8da8c2", textTransform: "uppercase", fontWeight: 700 }}>CW</span>
                    <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: C.cyan }}>{callWall ? callWall.toLocaleString() : "—"}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 9, color: "#8da8c2", textTransform: "uppercase", fontWeight: 700 }}>PW</span>
                    <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: C.orange }}>{putWall ? putWall.toLocaleString() : "—"}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 9, color: "#8da8c2", textTransform: "uppercase", fontWeight: 700 }}>Flip</span>
                    <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#F97316" }}>{gexFlip != null ? gexFlip.toLocaleString() : "—"}</span>
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => { handleMvcSnapshot().catch(() => {}); }}
                      style={{
                        padding: "5px 10px",
                        borderRadius: 6,
                        border: `1px solid ${mvcSaving === "ok" ? "rgba(0,230,118,.35)" : mvcSaving === "err" ? "rgba(255,71,87,.35)" : "rgba(0,229,255,.25)"}`,
                        background: "linear-gradient(180deg,rgba(0,229,255,.12),rgba(0,229,255,.04))",
                        color: mvcSaving === "ok" ? "#00e676" : mvcSaving === "err" ? "#ff4757" : C.cyan,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        cursor: mvcSaving === "saving" ? "default" : "pointer",
                      }}
                    >
                      {mvcSaving === "saving" ? "Saving" : mvcSaving === "ok" ? "Saved" : mvcSaving === "err" ? "Error" : "MVC Snapshot"}
                    </button>
                    <Link
                      href="/database"
                      style={{
                        padding: "5px 10px",
                        borderRadius: 6,
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(255,255,255,0.04)",
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        textDecoration: "none",
                      }}
                    >
                      MVC Database
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {/* Heatmap */}
            <div
              ref={heatmapRef}
              style={{
                background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)",
                borderRadius: 16, display: "flex", flexDirection: "column", flex: 1, overflow: "hidden",
              }}
            >
              {/* Heatmap header */}
              <div className="grad-divider-b" style={{ paddingBottom: 16, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    <span style={{ color: C.cyan }}><LayersIcon /></span>
                    LIVE GEX HEATMAP
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#fff" }}>
                    <button onClick={heatmapRefresh.trigger} style={{ ...heatmapRefresh.style, fontSize: 10, padding: "4px 8px", borderRadius: 4 }}>
                      {heatmapRefresh.label}
                    </button>
                    <BoxSnapBtn targetRef={heatmapRef} />
                    <BoxDiscordBtn
                      targetRef={heatmapRef}
                      message={`📸 GEX Heatmap — ${selectedExpiry.toUpperCase()}${expiryMap[selectedExpiry] ? ` ${fmtExpiryDate(expiryMap[selectedExpiry])}` : ""} — ${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })} ET`}
                    />
                  </div>
                </div>
                {/* Intensity slider */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  <span style={{ color: "#fff", flexShrink: 0 }}>Intensity</span>
                  <input
                    type="range" min={0.05} max={1} step={0.05}
                    value={intensity}
                    onChange={e => setIntensity(Number(e.target.value))}
                    style={{ flex: 1, accentColor: C.cyan, cursor: "pointer", height: 4 }}
                  />
                  <span style={{ color: C.cyan, width: 36, textAlign: "right", flexShrink: 0 }}>{intensity.toFixed(2)}x</span>
                  <span style={{ color: C.cyan, cursor: "pointer" }} onClick={() => setIntensity(0.4)}><RotateCcwIcon /></span>
                </div>
              </div>

              {/* Grid heatmap */}
              {(() => {
                function parseVal(s: string): number {
                  if (!s || s === "—") return 0;
                  const neg = s.startsWith("-");
                  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
                  const mult = s.includes("B") ? 1e9 : s.includes("M") ? 1e6 : s.includes("K") ? 1e3 : 1;
                  return (neg ? -1 : 1) * n * mult;
                }

                // Cell bg: rank-boosted intensity
                function cellBg(val: number, colMax: number, ci: number): string {
                  if (val === 0) return "transparent";
                  const abs = Math.abs(val);
                  const ratio = Math.min(abs / colMax, 1);
                  // Check rank within this column
                  const top3 = colTop3[ci];
                  const rank = top3.indexOf(abs) + 1; // 1,2,3 or 0 if not in top3
                  // Top-3 get a guaranteed high floor, scaled by rank
                  let op: number;
                  if (rank === 1)      op = Math.max(0.82, intensity * 0.92);
                  else if (rank === 2) op = Math.max(0.60, intensity * 0.78);
                  else if (rank === 3) op = Math.max(0.40, intensity * 0.62);
                  else                 op = Math.pow(ratio, 0.65) * intensity * 0.55;
                  return val > 0
                    ? `rgba(32,178,220,${Math.min(op, 0.95).toFixed(3)})`
                    : `rgba(220,50,60,${Math.min(op, 0.95).toFixed(3)})`;
                }

                const COLS = [
                  { key: "netGex", label: "NET GEX" },
                  { key: "volOnly", label: "VOL ONLY GEX" },
                  { key: "dex", label: "DEX" },
                  { key: "gexVex", label: "GEX + VEX" },
                  { key: "rollingNetGex", label: "30 MIN ROLLING NET GEX" },
                ];

                const colMaxes = COLS.map(c =>
                  Math.max(...heatmapData.map(r => Math.abs(parseVal(r[c.key as keyof typeof r] as string))), 1)
                );

                // Per-column top-3 absolute values for rank-floor boosting
                const colTop3 = COLS.map(c =>
                  heatmapData
                    .map(r => Math.abs(parseVal(r[c.key as keyof typeof r] as string)))
                    .filter(v => v > 0)
                    .sort((a, b) => b - a)
                    .slice(0, 3)
                );

                const totals = COLS.map(c =>
                  heatmapData.reduce((s, r) => s + parseVal(r[c.key as keyof typeof r] as string), 0)
                );

                const fmtTotal = (v: number) => {
                  const a = Math.abs(v);
                  const sign = v < 0 ? "-" : "+";
                  if (a >= 1e9) return `${sign}$${(a/1e9).toFixed(2)}B`;
                  if (a >= 1e6) return `${sign}$${(a/1e6).toFixed(2)}M`;
                  if (a >= 1e3) return `${sign}$${(a/1e3).toFixed(1)}K`;
                  return `${sign}$${a.toFixed(0)}`;
                };

                const gridCols = `44px repeat(${COLS.length}, 1fr)`;
                const hdrStyle: React.CSSProperties = { padding: "5px 4px", fontSize: 9, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", textAlign: "right" };
                const cellStyle: React.CSSProperties = { padding: "3px 4px", fontSize: 10, fontFamily: "monospace", textAlign: "right" };

                return (
                  <div style={{ flex: 1, overflow: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.04) transparent", background: "#0a0e17" }}>
                    {/* Header */}
                    <div style={{ display: "grid", gridTemplateColumns: gridCols, position: "sticky", top: 0, zIndex: 10, background: "#0a0e17", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <div style={{ ...hdrStyle, textAlign: "left" }}>STRIKE</div>
                      {COLS.map(c => <div key={c.key} style={hdrStyle}>{c.label}</div>)}
                    </div>

                    {/* TOTAL row */}
                    <div style={{ display: "grid", gridTemplateColumns: gridCols, borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
                      <div style={{ ...cellStyle, textAlign: "left", color: "#fff", fontWeight: 700, fontSize: 9 }}>TOTAL</div>
                      {totals.map((v, ci) => (
                        <div key={ci} style={{ ...cellStyle, fontWeight: 700, color: "#fff" }}>
                          {fmtTotal(v)}
                        </div>
                      ))}
                    </div>

                    {/* Data rows */}
                    {heatmapData.map((row) => {
                      const isAtm = row.type === "atm";
                      return (
                        <div key={row.strike} style={{
                          display: "grid", gridTemplateColumns: gridCols,
                          borderBottom: isAtm ? "none" : "1px solid rgba(255,255,255,0.03)",
                          background: "transparent",
                          outline: isAtm ? "1px solid rgba(41,182,246,0.7)" : "none",
                          outlineOffset: isAtm ? "-1px" : undefined,
                          position: "relative",
                          zIndex: isAtm ? 2 : undefined,
                        }}>
                          {/* Strike */}
                          <div style={{
                            ...cellStyle, textAlign: "left", fontWeight: 700,
                            color: isAtm ? "#29b6f6" : "#fff",
                          }}>
                            {row.strike}
                          </div>
                          {/* Value cells */}
                          {COLS.map((c, ci) => {
                            const raw = row[c.key as keyof typeof row] as string;
                            const val = parseVal(raw);
                            const bg = isAtm ? "transparent" : cellBg(val, colMaxes[ci], ci);
                            return (
                              <div key={c.key} style={{ ...cellStyle, background: bg, color: "#fff" }}>
                                {raw}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
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
        .grad-divider-t {
          position: relative;
        }
        .grad-divider-t::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(to right, transparent 0%, rgba(255,255,255,0.10) 30%, rgba(255,255,255,0.13) 50%, rgba(255,255,255,0.10) 70%, transparent 100%);
          pointer-events: none;
        }
        .grad-divider-sidebar-b::after {
          content: '';
          position: absolute;
          bottom: 0; left: 12px; right: 12px;
          height: 1px;
          background: linear-gradient(to right, transparent, rgba(255,255,255,0.10) 50%, transparent);
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
        .tab-active-border {
          border-bottom: 2px solid #00F0FF !important;
        }
        .tab-inactive-border {
          border-bottom: 2px solid transparent !important;
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



