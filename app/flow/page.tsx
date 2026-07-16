"use client";

// ─────────────────────────────────────────────────────────────────────────────
// /flow — per-ticker Net Premium (Net Drift) view + raw flow tape.
//
// Fed by the server `flow` WS message on /ws/gex (same feed as FlowTape /
// SignalsPanel): each message carries the full capped tape (oldest-first) as
// data.tape: FlowOrder[]. Connection is gated by useWsLifecycle (bandwidth /
// idle / background pause) exactly like the home page. Today's persisted tape is
// backfilled once from /proxy/flow-history and merged with the live tape.
//
// Layout: Filters (watchlist chips + add, side/type/premium slider/size/expiry/
// moneyness) → Net Premium chart (cumulative net call vs net put premium for the
// ACTIVE ticker, lightweight-charts) → raw Flow Tape (active ticker, threshold).
//
// Theme: PageShell + Card + HOME_THEME only. No raw color literals beyond the
// green buy accent (HOME_THEME.green is a light blue, so buys use a true green).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, HistogramSeries, LineSeries, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi, UTCTimestamp, LineData, WhitespaceData, HistogramData } from "lightweight-charts";
import { HOME_THEME, homeInputStyle, DOCK_THEME } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ThemedDatePicker } from "@/components/shared/ThemedDatePicker";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import { useContractStats, useLiveSpots } from "@/hooks/useContractStats";
import ContractDrawer from "@/components/dashboard/ContractDrawer";
import type { FlowOrder } from "@/hooks/useSpxFlow";

const C = HOME_THEME;

// Premium at or above which a print is a "whale": rendered bold, and the only
// rows that expand into a ContractDrawer. Matches the Big-OTM preset's floor.
const WHALE_FLOOR = 500_000;
const BUY_GREEN = "#22c55e";
const BULLISH = BUY_GREEN; // calls / buys
const BEARISH = C.red; //     puts / sells
const VOL_GREEN = "rgba(34,197,94,0.55)";
const VOL_RED = "rgba(239,68,68,0.55)";

function fmtPremium(val: number): string {
  const a = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

// Directional read of an order: bullish = buy calls / sell puts,
// bearish = sell calls / buy puts.
function isBullish(side: string, type: string): boolean {
  const buy = side === "buy", call = type === "C";
  return (buy && call) || (!buy && !call);
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtSpot(spot: number | undefined): string {
  if (!spot) return "—";
  return spot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Vol / OI cells. null means "the chain snapshot hasn't produced this contract
// yet" (pre-open, or a strike outside the snapshot) — render "—" rather than 0,
// which would read as a real "no interest here".
function fmtStat(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

// Cost to buy ONE contract (option price × 100 shares) — distinct from the
// order's total Premium (price × size × 100).
function fmtContractCost(price: number): string {
  const cost = price * 100;
  if (cost >= 1_000_000) return `$${(cost / 1_000_000).toFixed(2)}M`;
  if (cost >= 1_000) return `$${(cost / 1_000).toFixed(1)}K`;
  return `$${cost.toFixed(2)}`;
}

// Streamer roots carry suffixes chips don't (SPX streams as "SPXW", etc.).
const ROOT_TO_TICKER: Record<string, string> = { SPXW: "SPX", NDXP: "NDX", RUTW: "RUT", XSPW: "XSP" };

// Normalized roots treated as "indices" for the Combined view's "All − Indices"
// scope (post-normTicker, so SPXW is already SPX here).
const INDEX_TICKERS = new Set(["SPX", "NDX", "RUT", "XSP", "VIX", "DJX"]);
function normTicker(u: string | null | undefined): string {
  const up = (u ?? "").toUpperCase();
  return ROOT_TO_TICKER[up] ?? up;
}

function dteOf(o: FlowOrder): number | null {
  if (!o.expiration) return null;
  const exp = new Date(`${o.expiration}T00:00:00`);
  if (Number.isNaN(exp.getTime())) return null;
  const now = new Date();
  return Math.round((exp.getTime() - new Date(now.toDateString()).getTime()) / 86_400_000);
}

// ── RTH session bounds (9:30–16:00 America/New_York) for TODAY, as UTC seconds.
// Handles EDT/EST automatically by correcting a UTC guess against the ET offset.
function etDateParts(now: Date): { y: number; m: number; d: number } {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}
function etWallToUtcSec(y: number, m: number, d: number, hh: number, mm: number): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const asET = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "America/New_York" })).getTime();
  const asUTC = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return Math.floor((guess + (asUTC - asET)) / 1000);
}
function rthBoundsToday(): { openSec: number; closeSec: number } {
  const { y, m, d } = etDateParts(new Date());
  return { openSec: etWallToUtcSec(y, m, d, 9, 30), closeSec: etWallToUtcSec(y, m, d, 16, 0) };
}
// RTH bounds for an explicit "YYYY-MM-DD" (ET session date) — used for lookback.
function rthBoundsForYmd(ymd: string): { openSec: number; closeSec: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { openSec: etWallToUtcSec(y, m, d, 9, 30), closeSec: etWallToUtcSec(y, m, d, 16, 0) };
}
// Today's ET session date as "YYYY-MM-DD" (matches the server's todayYmdET()).
function todayYmdET(): string {
  const { y, m, d } = etDateParts(new Date());
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ── Filter state ────────────────────────────────────────────────────────────
type SideFilter = "all" | "buy" | "sell";
type TypeFilter = "all" | "C" | "P";

const PREMIUM_MAX = 1_000_000;

// Net-drift chart bucket size (seconds). Fixed bins across the whole RTH session
// give a proportional, hardcoded 9:30–4:00 x-axis and a smooth line.
const BIN_SEC = 60;

// Per-bin aggregate, computed client-side from the filtered tape so the chart
// reacts to every filter (side/type/premium/size/expiry/dte/otm), not just
// ticker + date.
type NetBin = { sec: number; callNet: number; putNet: number; callVol: number; putVol: number };

const DEFAULT_TICKERS = [
  "SPX", "SPY", "QQQ", "META", "TSLA", "AMZN", "AAPL", "NVDA", "MSFT", "GOOGL", "AMD", "NDX",
] as const;

// Recent tickers (most-recent-first, max 7) persisted in the browser — same
// pattern as /options-chain's RECENT dropdown.
const RECENT_TICKERS_KEY = "flow-recent-tickers-v1";
const RECENT_TICKERS_MAX = 7;

function loadRecentTickers(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_TICKERS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === "string").slice(0, RECENT_TICKERS_MAX) : [];
  } catch { return []; }
}

function pushRecentTicker(list: string[], ticker: string): string[] {
  const t = ticker.toUpperCase();
  const next = [t, ...list.filter((x) => x !== t)].slice(0, RECENT_TICKERS_MAX);
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(RECENT_TICKERS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }
  return next;
}

// ── Chart warm-start cache ──────────────────────────────────────────────────
// Last netBins payload (single entry) in sessionStorage: a revisit paints the
// chart instantly from the stale bins while the fetch refreshes behind it.
// Keyed by the exact filter querystring, so a different ticker/filter/date
// never shows the wrong session.
const NETBINS_CACHE_KEY = "flow-netbins-v1";
function readNetBinsCache(key: string): NetBin[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(NETBINS_CACHE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j && j.key === key && Array.isArray(j.bins) ? (j.bins as NetBin[]) : null;
  } catch { return null; }
}
function writeNetBinsCache(key: string, bins: NetBin[]) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(NETBINS_CACHE_KEY, JSON.stringify({ key, bins })); } catch { /* quota — skip */ }
}

// URL params (used by the Day Posts capture embed):
//   ?chartonly=1  → render ONLY the Net Drift chart card (no filters/tape/dark pool)
//   ?ticker=SPX   → preset the active ticker
//   ?dteMax=0     → preset Max DTE (0 = 0DTE). OTM-only is already the default.
function urlParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export default function FlowPage() {
  const shouldConnect = useWsLifecycle();
  const [chartOnly] = useState(() => urlParam("chartonly") === "1");
  const [orders, setOrders] = useState<FlowOrder[]>([]);
  const [status, setStatus] = useState<"LIVE" | "RECONNECTING" | "WAITING">("WAITING");

  // ── Session date (lookback). Defaults to today's ET session; past dates pull
  // the persisted tape only (live WS is ignored so it can't bleed into history). ──
  const [date, setDate] = useState<string>(() => todayYmdET());
  const isToday = date === todayYmdET();

  // ── View: per-ticker vs combined (all tickers) ──
  const [view, setView] = useState<"ticker" | "combined">("ticker");
  const [scope, setScope] = useState<"all" | "exIdx">("all"); // combined only

  // ── Watchlist + active (chart-focused) ticker ──
  const [tickerList, setTickerList] = useState<string[]>([...DEFAULT_TICKERS]);
  const [active, setActive] = useState<string>(() => {
    const t = urlParam("ticker");
    return t ? t.toUpperCase() : DEFAULT_TICKERS[0];
  });
  const [tickerInput, setTickerInput] = useState("");
  // Recents (browser-cached). Hydrated after mount to avoid SSR mismatch.
  const [recentTickers, setRecentTickers] = useState<string[]>([]);
  const [recentOpen, setRecentOpen] = useState(false);
  useEffect(() => { setRecentTickers(loadRecentTickers()); }, []);

  // ── Other filters ──
  const [side, setSide] = useState<SideFilter>("all");
  const [optType, setOptType] = useState<TypeFilter>("all");
  const [minPremium, setMinPremium] = useState<number>(50_000);
  const [minSize, setMinSize] = useState<number>(0);
  const [expiry, setExpiry] = useState<string>("all");
  const [dteMin, setDteMin] = useState<number>(0);
  const [dteMax, setDteMax] = useState<number | null>(() => {
    const v = urlParam("dteMax");
    return v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  });
  const [otmOnly, setOtmOnly] = useState(true);

  const [history, setHistory] = useState<FlowOrder[]>([]);

  // ── Backfill the ACTIVE ticker's full session whenever it changes. ──
  // Per-ticker so the whole day is returned (an unfiltered newest-N cap drops a
  // ticker's early prints once the full roster is recording). Doesn't clear
  // `history` up front — the previous ticker's rows just get filtered out of
  // `filtered` by the active-ticker check until the new tape lands, same net
  // effect as a reset without the blank-flash in between.
  const [historySwitching, setHistorySwitching] = useState(false);
  // First run fires immediately — the 400ms debounce exists for slider drags,
  // and paying it on initial mount just delays first paint for nothing.
  const historyFirstRunRef = useRef(true);
  useEffect(() => {
    // Combined view doesn't read `history` — skip the pull entirely. With the
    // full roster recording (millions of prints/day) this per-ticker query is
    // expensive, and racing it against the combined pull is what made Combined
    // take ~a minute to fill.
    if (view === "combined") { setHistorySwitching(false); return; }
    let cancelled = false;
    setHistorySwitching(true);
    // Push the premium floor to the server so the 20k cap keeps the biggest
    // prints across the WHOLE session — same fix as the combined view below.
    // Without this, a busy single ticker (SPX 0DTE) fills the cap with tiny
    // fills by mid-morning and the newest-20k window silently drops the whole
    // early session (looks like "history starts at 11am" with no error).
    const premParam = minPremium > 0 ? `&minPremium=${minPremium}` : "";
    const pull = (limit: number) =>
      fetch(`/proxy/flow-history?underlying=${encodeURIComponent(active)}&limit=${limit}&date=${date}${premParam}`)
        .then((r) => (r.ok ? r.json() : null));
    // Two-stage load: a small newest-first slice paints the tape immediately,
    // then the full session lands behind it and replaces the slice. `full`
    // guards ordering — if the big pull wins the race, the small one is stale
    // and must not clobber it.
    let full = false;
    const run = () => {
      pull(1000)
        .then((j) => {
          if (cancelled || full) return;
          if (j && Array.isArray(j.tape)) setHistory(j.tape as FlowOrder[]);
          setHistorySwitching(false);
        })
        .catch(() => { if (!cancelled && !full) setHistorySwitching(false); });
      pull(20000)
        .then((j) => {
          if (cancelled) return;
          full = true;
          if (j && Array.isArray(j.tape)) setHistory(j.tape as FlowOrder[]);
          setHistorySwitching(false);
        })
        .catch(() => { if (!cancelled) setHistorySwitching(false); });
    };
    // Debounce only AFTER the first run: dragging the premium slider otherwise
    // fires one full-session query per slider step.
    const wasFirst = historyFirstRunRef.current;
    historyFirstRunRef.current = false;
    const kick = setTimeout(run, wasFirst ? 0 : 400);
    return () => { cancelled = true; clearTimeout(kick); };
  }, [active, date, minPremium, view]);

  // ── Net-drift bins for the ACTIVE ticker, aggregated in SQL over the WHOLE
  // session (not the tape's 20k raw-row cap) so the chart always spans the
  // full 9:30–4:00 RTH regardless of how much a busy ticker prints. Server
  // applies the same filters as the tape, so the chart moves with the filter
  // panel too. Polled every 5s to advance the "now" edge on today's session. ──
  const [netBins, setNetBins] = useState<NetBin[]>([]);
  const [netSwitching, setNetSwitching] = useState(false);
  // Which filter key the bins in state belong to, + the bins themselves —
  // drives the incremental ?since poll and the sessionStorage warm start.
  const netKeyRef = useRef<string>("");
  const netBinsRef = useRef<NetBin[]>([]);
  useEffect(() => {
    // Chart is hidden in Combined view — don't poll its bins every 5s there.
    if (view === "combined") { setNetSwitching(false); return; }
    let cancelled = false;
    const qp = new URLSearchParams({ underlying: active, bin: String(BIN_SEC), date });
    if (side !== "all") qp.set("side", side);
    if (optType !== "all") qp.set("type", optType);
    if (minPremium > 0) qp.set("minPremium", String(minPremium));
    if (minSize > 0) qp.set("minSize", String(minSize));
    if (expiry !== "all") qp.set("expiry", expiry);
    if (dteMin > 0) qp.set("dteMin", String(dteMin));
    if (dteMax != null) qp.set("dteMax", String(dteMax));
    if (otmOnly) qp.set("otmOnly", "1");
    const key = qp.toString();

    // Warm start: paint instantly from the session-cached bins for this exact
    // key, then let the fetch below refresh them. Stale-by-hours is fine — the
    // first poll pulls everything from the cached edge forward.
    if (netKeyRef.current !== key) {
      const cached = readNetBinsCache(key);
      if (cached) {
        netKeyRef.current = key;
        netBinsRef.current = cached;
        setNetBins(cached);
        setNetSwitching(false);
      } else {
        setNetSwitching(true);
      }
    }

    const load = () => {
      // Incremental poll: once this key has bins, only pull from a 3-bin
      // overlap before the last known bin (late-flushed prints can land in a
      // bin after it was first served). First load pulls the whole session.
      const prev = netKeyRef.current === key ? netBinsRef.current : [];
      const since = isToday && prev.length > 0 ? prev[prev.length - 1].sec - 2 * BIN_SEC : null;
      fetch(`/proxy/flow-netprem?${key}${since != null ? `&since=${since}` : ""}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (cancelled) return;
          if (j && Array.isArray(j.bins)) {
            const incoming = j.bins as NetBin[];
            const bins = since != null
              ? [...prev.filter((b) => b.sec < since), ...incoming]
              : incoming;
            netKeyRef.current = key;
            netBinsRef.current = bins;
            setNetBins(bins);
            writeNetBinsCache(key, bins);
          }
          setNetSwitching(false);
        })
        .catch(() => { if (!cancelled) setNetSwitching(false); });
    };
    load();
    // Past sessions are static — only poll the live edge for today.
    const id = isToday ? setInterval(load, 5000) : null;
    return () => { cancelled = true; if (id) clearInterval(id); };
  }, [active, date, isToday, side, optType, minPremium, minSize, expiry, dteMin, dteMax, otmOnly, view]);

  // ── Combined view backfill: the whole day's tape (ALL tickers), fetched once
  // when the Combined tab is opened. Live prints still arrive via the WS `orders`
  // (already multi-ticker). Polled every 15s to advance the "now" edge. ──
  const [combinedHistory, setCombinedHistory] = useState<FlowOrder[]>([]);
  useEffect(() => {
    if (view !== "combined") return;
    let cancelled = false;
    // Push the premium floor to the server so the 20k cap keeps the biggest
    // prints across the WHOLE session, not just the most recent slice.
    const premParam = minPremium > 0 ? `&minPremium=${minPremium}` : "";
    const load = () =>
      fetch(`/proxy/flow-history?limit=20000&date=${date}${premParam}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (!cancelled && j && Array.isArray(j.tape)) setCombinedHistory(j.tape as FlowOrder[]); })
        .catch(() => {});
    // Debounce the initial pull so dragging the premium slider doesn't spray
    // requests; the 15s interval then keeps the "now" edge fresh (today only).
    const kick = setTimeout(load, 400);
    const id = isToday ? setInterval(load, 15000) : null;
    return () => { cancelled = true; clearTimeout(kick); if (id) clearInterval(id); };
  }, [view, minPremium, date, isToday]);

  // ── WS: /ws/gex, keep only the flow tape. ──
  const unmountedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldConnectRef = useRef(shouldConnect);
  shouldConnectRef.current = shouldConnect;

  useEffect(() => {
    unmountedRef.current = false;

    const handleMessage = (raw: string) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw); } catch { return; }
      if (String(msg.type ?? "") !== "flow") return;
      const data = (msg.data && typeof msg.data === "object" ? msg.data : msg) as Record<string, unknown>;
      const tape = data.tape as FlowOrder[] | undefined;
      if (Array.isArray(tape)) setOrders(tape);
    };

    const scheduleReconnect = () => {
      if (unmountedRef.current || !shouldConnectRef.current) return;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(connect, 2000);
    };

    const connect = () => {
      if (unmountedRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/ws/gex`;
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch { scheduleReconnect(); return; }
      wsRef.current = ws;
      ws.onopen = () => setStatus("LIVE");
      ws.onmessage = (evt) => handleMessage(String(evt.data));
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onclose = () => { setStatus("RECONNECTING"); scheduleReconnect(); };
    };

    if (shouldConnect) connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => { try { ws.close(); } catch {} };
        else { ws.onopen = null; try { ws.close(); } catch {} }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldConnect]);

  // ── Merge persisted ∪ live tape, deduped by coalescing key (live wins). ──
  const merged = useMemo(() => {
    const byKey = new Map<string, FlowOrder>();
    for (const o of history) byKey.set(`${o.ts}|${o.symbol}|${o.side}`, o);
    if (isToday) for (const o of orders) byKey.set(`${o.ts}|${o.symbol}|${o.side}`, o);
    return [...byKey.values()].sort((a, b) => a.ts - b.ts);
  }, [history, orders, isToday]);

  const expiryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of merged) if (o.underlying && normTicker(o.underlying) === active && o.expiration) set.add(o.expiration);
    return [...set].sort();
  }, [merged, active]);

  // ── Rows for the ACTIVE ticker only, with all filters (oldest-first). Feeds
  // both the tape (reversed below) AND the net-drift chart, so the chart moves
  // in lockstep with whatever filters are applied. ──
  const filteredAsc = useMemo(() => {
    return merged.filter((o) => {
      if (normTicker(o.underlying) !== active) return false;
      if (side !== "all" && o.side !== side) return false;
      if (optType !== "all" && o.type !== optType) return false;
      if (otmOnly && !o.isOtm) return false;
      if (Number(o.premium || 0) < minPremium) return false;
      if (Number(o.size || 0) < minSize) return false;
      if (expiry !== "all" && o.expiration !== expiry) return false;
      if (dteMin > 0 || dteMax != null) {
        const d = dteOf(o);
        if (d == null) return false;
        if (d < dteMin) return false;
        if (dteMax != null && d > dteMax) return false;
      }
      return true;
    });
  }, [merged, active, side, optType, otmOnly, minPremium, minSize, expiry, dteMin, dteMax]);

  // Tape display order (newest-first).
  const filtered = useMemo(() => [...filteredAsc].reverse(), [filteredAsc]);

  // ── Combined tape: ALL tickers (or all − indices), same filters, no ticker
  // gate. Merges the all-tickers day backfill with the live multi-ticker WS tape
  // (deduped by coalescing key). ──
  const mergedCombined = useMemo(() => {
    const byKey = new Map<string, FlowOrder>();
    for (const o of combinedHistory) byKey.set(`${o.ts}|${o.symbol}|${o.side}`, o);
    if (isToday) for (const o of orders) byKey.set(`${o.ts}|${o.symbol}|${o.side}`, o);
    return [...byKey.values()].sort((a, b) => a.ts - b.ts);
  }, [combinedHistory, orders, isToday]);

  const filteredCombined = useMemo(() => {
    const rows = mergedCombined.filter((o) => {
      if (scope === "exIdx" && INDEX_TICKERS.has(normTicker(o.underlying))) return false;
      if (side !== "all" && o.side !== side) return false;
      if (optType !== "all" && o.type !== optType) return false;
      if (otmOnly && !o.isOtm) return false;
      if (Number(o.premium || 0) < minPremium) return false;
      if (Number(o.size || 0) < minSize) return false;
      if (expiry !== "all" && o.expiration !== expiry) return false;
      if (dteMin > 0 || dteMax != null) {
        const d = dteOf(o);
        if (d == null) return false;
        if (d < dteMin) return false;
        if (dteMax != null && d > dteMax) return false;
      }
      return true;
    });
    return rows.reverse();
  }, [mergedCombined, scope, side, optType, otmOnly, minPremium, minSize, expiry, dteMin, dteMax]);

  const combinedExpiryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of mergedCombined) {
      if (scope === "exIdx" && INDEX_TICKERS.has(normTicker(o.underlying))) continue;
      if (o.expiration) set.add(o.expiration);
    }
    return [...set].sort();
  }, [mergedCombined, scope]);

  // 0DTE = today's expiration if it exists, else the soonest future one (closest contract).
  const nearestExpiry = useMemo(() => {
    const opts = view === "combined" ? combinedExpiryOptions : expiryOptions;
    if (!opts.length) return null;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD ET
    return opts.find((x) => x >= today) ?? opts[opts.length - 1];
  }, [view, combinedExpiryOptions, expiryOptions]);

  // Whichever list drives the tape + totals + premium split for the active view.
  const tapeRows = view === "combined" ? filteredCombined : filtered;
  // Cap rendered rows (combined can be thousands); totals still span the full set.
  const MAX_TAPE_ROWS = 800;
  const visibleRows = tapeRows.slice(0, MAX_TAPE_ROWS);

  // ── Live per-contract Vol / OI / IV for the tape columns. Driven by the
  // VISIBLE rows only: the fetch is grouped by (ticker, expiry), so this is a
  // few calls regardless of how many prints are on screen. ──
  const lookupStat = useContractStats(visibleRows, shouldConnect);

  // Live underlying spot per ticker for % OTM. FlowOrder.spot is frozen at print
  // time, so a strike that has since gone ITM would still read as OTM without
  // this. Only fetches the tickers actually on screen.
  const visibleTickers = useMemo(
    () => [...new Set(visibleRows.map((o) => normTicker(o.underlying)).filter(Boolean))],
    [visibleRows],
  );
  const spotByTicker = useLiveSpots(visibleTickers, shouldConnect);

  // ── Expanded whale row (variant D: expands in place, no modal). Keyed by the
  // same identity the row key uses so it survives a tape refresh. ──
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // ── Net Premium (Net Drift) series for the active ticker. ──
  // Cumulative signed premium: buy = +, sell = −. One point per minute (last
  // cumulative value in that bin) to satisfy lightweight-charts' unique/
  // ascending time requirement. Bins come from the server's SQL GROUP BY
  // (`netBins`, /proxy/flow-netprem), which aggregates the WHOLE session —
  // unlike the tape's `history` backfill, it isn't capped at 20k raw rows, so
  // a busy ticker (SPX 0DTE) still shows the full 9:30–4:00 RTH on the chart.
  // The server applies the same filters as the tape, so the chart still moves
  // with the filter panel.
  const netSeries = useMemo(() => {
    const { openSec, closeSec } = isToday ? rthBoundsToday() : rthBoundsForYmd(date);
    const byBin = new Map<number, NetBin>();
    for (const b of netBins) byBin.set(b.sec, b);
    const hasData = netBins.length > 0;

    // Fixed 1-min bins across the whole RTH session → proportional, hardcoded
    // 9:30–4:00 axis. Walk the aggregate into cumulative net-drift lines; bins up
    // to "now" carry the running total, future bins are whitespace (axis still
    // spans to the close before data arrives).
    const nowSec = Math.floor(Date.now() / 1000);
    const callPts: (LineData | WhitespaceData)[] = [];
    const putPts: (LineData | WhitespaceData)[] = [];
    const volPts: (HistogramData | WhitespaceData)[] = [];
    let call = 0, put = 0;
    for (let t = openSec; t <= closeSec; t += BIN_SEC) {
      const b = byBin.get(t);
      if (b) { call += b.callNet; put += b.putNet; }
      if (t <= nowSec + BIN_SEC) {
        callPts.push({ time: t as UTCTimestamp, value: call });
        putPts.push({ time: t as UTCTimestamp, value: put });
        const cv = b ? b.callVol : 0, pv = b ? b.putVol : 0;
        volPts.push({ time: t as UTCTimestamp, value: cv + pv, color: cv >= pv ? VOL_GREEN : VOL_RED });
      } else {
        callPts.push({ time: t as UTCTimestamp });
        putPts.push({ time: t as UTCTimestamp });
        volPts.push({ time: t as UTCTimestamp });
      }
    }
    return { callPts, putPts, volPts, lastCall: call, lastPut: put, openSec, closeSec, hasData, byBin };
  }, [netBins, isToday, date]);

  // ── lightweight-charts setup ──
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const callSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const putSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const binMapRef = useRef<Map<number, NetBin>>(new Map());
  const ordersByMinRef = useRef<Map<number, FlowOrder[]>>(new Map());

  useEffect(() => {
    const host = chartHostRef.current;
    if (!host) return;
    host.innerHTML = "";
    host.style.position = "relative";

    // Floating hover tooltip — shows what was hit in the crosshair minute.
    const tooltip = document.createElement("div");
    Object.assign(tooltip.style, {
      position: "absolute", display: "none", pointerEvents: "none", zIndex: "20",
      minWidth: "230px", padding: "0", borderRadius: "12px", overflow: "hidden",
      fontSize: "15px", lineHeight: "1.4",
      background: "radial-gradient(circle at 50% 0%, rgba(33,158,188,0.10) 0%, transparent 60%), rgba(10,13,20,0.96)",
      border: `1px solid ${C.border}`, borderTop: "2px solid rgba(33,158,188,0.5)",
      color: C.text, whiteSpace: "nowrap",
      fontFamily: "var(--font-mono)",
      boxShadow: "0 10px 30px rgba(0,0,0,.55)", backdropFilter: "blur(6px)",
    } as CSSStyleDeclaration);
    host.appendChild(tooltip);
    tooltipRef.current = tooltip;
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: C.text,
        fontFamily: "Inter, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,.05)" },
        horzLines: { color: "rgba(255,255,255,.05)" },
      },
      rightPriceScale: { visible: true, borderColor: "rgba(255,255,255,.10)" },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: "rgba(255,255,255,.10)",
        timeVisible: true,
        secondsVisible: false,
        // Axis tick labels in ET (tickMarkFormatter drives the axis; the
        // localization.timeFormatter only affects the crosshair label).
        tickMarkFormatter: (time: unknown) =>
          typeof time === "number"
            ? new Date(time * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })
            : "",
      },
      localization: {
        priceFormatter: (p: number) => fmtPremium(p),
        timeFormatter: (time: unknown) =>
          typeof time === "number"
            ? new Date(time * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })
            : "",
      },
    });
    const callSeries = chart.addSeries(LineSeries, { color: BULLISH, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    const putSeries = chart.addSeries(LineSeries, { color: BEARISH, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    // Volume histogram docked to the bottom ~22% (its own overlay price scale).
    const volSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol", priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "volume" },
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.26 } });

    chart.subscribeCrosshairMove((param) => {
      const tip = tooltipRef.current;
      if (!tip) return;
      const t = typeof param.time === "number" ? param.time : null;
      const bin = t != null ? binMapRef.current.get(t) : undefined;
      if (!param.point || t == null || !bin || (bin.callVol === 0 && bin.putVol === 0)) {
        tip.style.display = "none";
        return;
      }
      const orders = ordersByMinRef.current.get(t) ?? [];
      // Nothing OTM printed this minute → don't show an empty tooltip.
      if (orders.length === 0) { tip.style.display = "none"; return; }
      const et = new Date(t * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" });
      const MAX_ROWS = 8;
      const rows = orders.slice(0, MAX_ROWS).map((o) => {
        const buy = o.side === "buy";
        const bull = isBullish(o.side, o.type);
        const col = bull ? BULLISH : BEARISH;
        const tint = bull ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)";
        return (
          `<div style="display:flex;align-items:center;gap:8px;border-left:3px solid ${col};background:${tint};border-radius:0 6px 6px 0;padding:5px 8px">` +
          `<span style="color:${col};font-weight:700;width:12px;text-align:center">${bull ? "▲" : "▼"}</span>` +
          `<span style="color:${col};font-weight:700;width:32px">${buy ? "BUY" : "SELL"}</span>` +
          `<span style="color:#fff;flex:1">${o.strike.toLocaleString()}${o.type} ×${o.size.toLocaleString()}</span>` +
          `<span style="color:${col}">${fmtPremium(o.premium)}</span>` +
          `</div>`
        );
      }).join("");
      const more = orders.length > MAX_ROWS ? `<div style="color:#fff;font-family:var(--font-mono);font-size:15px;padding:4px 8px 0">+${orders.length - MAX_ROWS} more…</div>` : "";
      tip.innerHTML =
        `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.08)">` +
          `<span style="color:#fff;font-weight:500;font-size:16px">${et}</span>` +
          `<span style="color:#fff;font-size:15px;font-family:var(--font-mono);letter-spacing:.06em">OTM · ${orders.length} print${orders.length === 1 ? "" : "s"}</span>` +
        `</div>` +
        `<div style="padding:8px 10px;font-family:var(--font-mono);font-size:15px;display:flex;flex-direction:column;gap:5px">${rows}${more}</div>`;
      tip.style.display = "block";
      const hostW = host.clientWidth, tipW = tip.offsetWidth;
      let left = param.point.x + 16;
      if (left + tipW > hostW) left = param.point.x - tipW - 16;
      tip.style.left = `${Math.max(4, left)}px`;
      tip.style.top = `${Math.max(4, param.point.y - 10)}px`;
    });

    chartRef.current = chart;
    callSeriesRef.current = callSeries;
    putSeriesRef.current = putSeries;
    volSeriesRef.current = volSeries;
    return () => { chart.remove(); chartRef.current = null; callSeriesRef.current = null; putSeriesRef.current = null; volSeriesRef.current = null; tooltipRef.current = null; };
  }, []);

  // Push data whenever the active-ticker series changes.
  useEffect(() => {
    binMapRef.current = netSeries.byBin;
    // Index the visible tape by minute-bin so the chart hover can list the
    // actual orders that printed in the crosshair minute (biggest first).
    const idx = new Map<number, FlowOrder[]>();
    for (const o of filtered) {
      if (!o.isOtm) continue; // tooltip lists OTM prints only
      const minSec = Math.floor(o.ts / 1000 / BIN_SEC) * BIN_SEC;
      const arr = idx.get(minSec);
      if (arr) arr.push(o); else idx.set(minSec, [o]);
    }
    for (const arr of idx.values()) arr.sort((a, b) => (b.premium || 0) - (a.premium || 0));
    ordersByMinRef.current = idx;
    callSeriesRef.current?.setData(netSeries.callPts);
    putSeriesRef.current?.setData(netSeries.putPts);
    volSeriesRef.current?.setData(netSeries.volPts);
    // Pin the axis to the exact 9:30–4:00 window (fitContent trims trailing
    // whitespace and re-scrolls, floating the data to the right).
    try {
      chartRef.current?.timeScale().setVisibleRange({
        from: netSeries.openSec as UTCTimestamp,
        to: netSeries.closeSec as UTCTimestamp,
      });
    } catch {}
  }, [netSeries, filtered]);

  // ── Summary of the filtered tape. ──
  const totals = useMemo(() => {
    let prem = 0, callPrem = 0, putPrem = 0;
    let buyCall = 0, buyPut = 0, sellCall = 0, sellPut = 0;
    for (const o of tapeRows) {
      const p = o.premium || 0;
      prem += p;
      if (o.type === "C") { callPrem += p; if (o.side === "buy") buyCall += p; else sellCall += p; }
      else { putPrem += p; if (o.side === "buy") buyPut += p; else sellPut += p; }
    }
    return { count: tapeRows.length, prem, callPrem, putPrem, buyCall, buyPut, sellCall, sellPut };
  }, [tapeRows]);

  function resetFilters() {
    setSide("all"); setOptType("all"); setMinPremium(50_000); setMinSize(0);
    setExpiry("all"); setDteMin(0); setDteMax(null); setOtmOnly(true);
  }

  // Preset: Combined view, 0–7 DTE, ≥$500K premium, OTM only.
  function applyBigOtmPreset() {
    setView("combined"); setScope("all");
    setSide("all"); setOptType("all"); setMinSize(0); setExpiry("all");
    setMinPremium(500_000); setDteMin(0); setDteMax(7); setOtmOnly(true);
  }
  const bigOtmActive =
    view === "combined" && minPremium === 500_000 && dteMin === 0 && dteMax === 7 && otmOnly;

  // Select a ticker (from input, GO, or the RECENT dropdown): add it to the
  // watchlist, make it active, and remember it in the browser recents.
  function selectTicker(raw: string) {
    const t = raw.trim().toUpperCase();
    if (!t) return;
    setTickerList((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setActive(t);
    setTickerInput("");
    setRecentTickers((prev) => pushRecentTicker(prev, t));
  }
  function addTicker() { selectTicker(tickerInput); }

  // ── Styles ──
  const labelStyle: React.CSSProperties = {
    fontSize: 15, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
    color: C.green, marginBottom: 4, display: "block",
  };
  const fieldStyle: React.CSSProperties = { ...homeInputStyle, width: "100%" };
  const segWrapStyle: React.CSSProperties = {
    display: "flex", border: `1px solid ${C.border}`, borderRadius: 6, background: "rgba(0,0,0,0.4)", overflow: "hidden",
  };
  // Dashboard control language (DOCK_THEME): active = cyan gloss tile + cyan text
  // + glow; inactive = transparent with dimmed text. Matches the toolbar/nav.
  function segBtn(activeState: boolean): React.CSSProperties {
    return {
      flex: 1, padding: "8px 6px", fontSize: 15, fontWeight: 700, cursor: "pointer",
      textTransform: "uppercase", letterSpacing: "0.06em", border: "none",
      background: activeState ? DOCK_THEME.activeTile : "transparent",
      color: activeState ? C.cyan : C.text,
      boxShadow: activeState ? DOCK_THEME.activeGlow : "none",
      transition: "all 0.15s",
    };
  }

  // Columns: Time Side Strike Spot Type Size Cost/Ctr Premium | Vol OI IV %OTM DTE | Expiry Bias
  const GRID = "78px 56px 84px 72px 46px 74px 88px 96px 74px 68px 58px 66px 44px 88px 74px";
  // Combined tape adds a leading Ticker column.
  const GRID_COMBINED = `64px ${GRID}`;

  // Premium split — four cards: buy/sell × call/put, colored & heat-barred by
  // directional bias (buy calls / sell puts = bullish). Shared by both views.
  function renderPremiumSplit() {
    const cards = [
      { label: "BUY CALLS", value: totals.buyCall, bull: true },
      { label: "BUY PUTS", value: totals.buyPut, bull: false },
      { label: "SELL CALL", value: totals.sellCall, bull: false },
      { label: "SELL PUT", value: totals.sellPut, bull: true },
    ];
    const max = Math.max(1, ...cards.map((c) => c.value));
    return (
      <div style={{ padding: "6px 20px 20px" }}>
        <label style={labelStyle}>Premium Split (Filtered Tape)</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {cards.map((c) => {
            const color = c.bull ? BULLISH : BEARISH;
            const pct = Math.max(2, (c.value / max) * 100);
            return (
              <div key={c.label} style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: "rgba(0,0,0,0.4)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted }}>{c.label}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.06em", color }}>{c.bull ? "▲ BULL" : "▼ BEAR"}</span>
                </div>
                <span style={{ fontSize: 20, fontWeight: 800, color, fontFamily: "var(--font-mono)" }}>{fmtPremium(c.value)}</span>
                <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const combinedLabel = scope === "exIdx" ? "All − Indices" : "All Tickers";

  // Combined flow spans the whole market, so allow a far larger premium floor.
  const premiumMax = view === "combined" ? 5_000_000 : PREMIUM_MAX;
  const premiumStep = view === "combined" ? 50_000 : 10_000;
  // Switching back to a single ticker: clamp the floor to that view's range.
  useEffect(() => {
    if (view === "ticker" && minPremium > PREMIUM_MAX) setMinPremium(PREMIUM_MAX);
  }, [view, minPremium]);

  return (
    <PageShell className="no-card-lift flow-root">
      {/* ── View tabs + session date (lookback) ─────────────────────── */}
      {!chartOnly && (
      <div className="flow-topbar" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", flexShrink: 0 }}>
        <div style={{ ...segWrapStyle, maxWidth: 320 }}>
          <button className="flow-chip" style={segBtn(view === "ticker")} onClick={() => setView("ticker")}>By Ticker</button>
          <button className="flow-chip" style={segBtn(view === "combined")} onClick={() => setView("combined")}>Combined</button>
        </div>
        <button
          className="flow-chip"
          onClick={applyBigOtmPreset}
          title="Combined · 0–7 DTE · ≥$500K premium · OTM only"
          style={{
            padding: "8px 14px", fontSize: 14, fontWeight: 800,
            textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer",
            whiteSpace: "nowrap", borderRadius: 6,
            border: `1px solid ${bigOtmActive ? C.cyan : C.border}`,
            background: bigOtmActive ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
            color: bigOtmActive ? C.cyan : C.text,
          }}
        >
          0–7DTE ≥$500K OTM
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.green }}>Session</label>
          <ThemedDatePicker
            value={date}
            onChange={(v) => setDate(v || todayYmdET())}
            width={170}
          />
          {!isToday && (
            <button
              className="flow-chip"
              onClick={() => setDate(todayYmdET())}
              style={{ padding: "6px 12px", fontSize: 15, fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em", borderRadius: 6, border: `1px solid ${C.border}`, background: "rgba(0,0,0,0.4)", color: C.cyan }}
            >
              Today
            </button>
          )}
          {!isToday && (
            <span style={{ fontSize: 15, fontFamily: "var(--font-mono)", padding: "2px 10px", borderRadius: 4, background: "rgba(142,202,230,0.12)", color: C.cyan }}>
              HISTORICAL
            </span>
          )}
        </div>
      </div>
      )}

      {/* ── Filters, full window width, above the chart. ── */}
      {!chartOnly && (
      <div className="flow-filters" style={{ display: "flex", gap: 16, alignItems: "stretch", flexWrap: "wrap", flexShrink: 0 }}>
      <div style={{ flex: "1 1 480px", minWidth: 0, position: "relative", zIndex: recentOpen ? 200 : undefined }}>
      <Card variant="budget" title="Options Flow — Filters" subtitle={view === "combined" ? "Every ticker on one tape. Choose the scope, then filter." : "Live order flow off the /ws/gex feed. Pick a watched ticker to drive the chart + tape."} style={{ flexShrink: 0, height: "100%" }}>
        {view === "combined" ? (
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>Scope</label>
            <div style={{ ...segWrapStyle, maxWidth: 360 }}>
              <button className="flow-chip" style={segBtn(scope === "all")} onClick={() => setScope("all")}>All</button>
              <button className="flow-chip" style={segBtn(scope === "exIdx")} onClick={() => setScope("exIdx")}>All − Indices</button>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>Watchlist ({tickerList.length})</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {tickerList.map((t) => {
                const on = t === active;
                return (
                  <button
                    key={t}
                    className="flow-chip"
                    onClick={() => selectTicker(t)}
                    style={{
                      padding: "6px 12px", fontSize: 15, fontWeight: 700, cursor: "pointer",
                      letterSpacing: "0.04em", borderRadius: 6,
                      border: `1px solid ${on ? DOCK_THEME.activeBorder : C.border}`,
                      background: on ? DOCK_THEME.activeTile : "rgba(0,0,0,0.4)",
                      color: on ? C.cyan : C.text,
                      boxShadow: on ? DOCK_THEME.activeGlow : "none",
                      transition: "all 0.15s",
                    }}
                  >
                    {t}
                  </button>
                );
              })}
              {/* Type a ticker (datalist suggestions) → GO, plus a RECENT
                  dropdown backed by localStorage. Mirrors /options-chain. */}
              <input
                list="flow-ticker-suggestions"
                style={{ ...homeInputStyle, width: 120, textTransform: "uppercase" }}
                placeholder="+ add ticker"
                value={tickerInput}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") addTicker(); }}
              />
              <datalist id="flow-ticker-suggestions">
                {DEFAULT_TICKERS.map((t) => <option key={t} value={t} />)}
              </datalist>
              <button
                className="flow-chip"
                onClick={addTicker}
                disabled={!tickerInput.trim()}
                style={{
                  padding: "6px 12px", fontSize: 15, fontWeight: 800, letterSpacing: "0.06em",
                  borderRadius: 6, border: `1px solid ${C.border}`, background: "rgba(0,0,0,0.4)",
                  color: C.cyan, cursor: tickerInput.trim() ? "pointer" : "not-allowed",
                  opacity: tickerInput.trim() ? 1 : 0.45,
                }}
              >
                GO
              </button>

              {recentTickers.length > 0 && (
                <div style={{ position: "relative" }}>
                  <button
                    className="flow-chip"
                    onClick={() => setRecentOpen((o) => !o)}
                    onBlur={() => setTimeout(() => setRecentOpen(false), 120)}
                    style={{
                      padding: "6px 12px", fontSize: 15, fontWeight: 700, letterSpacing: "0.04em",
                      borderRadius: 6, border: `1px solid ${C.border}`, background: "rgba(0,0,0,0.4)",
                      color: C.text, cursor: "pointer",
                    }}
                  >
                    Recent ▾
                  </button>
                  {recentOpen && (
                    <div
                      style={{
                        position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
                        minWidth: 120, borderRadius: 6, overflow: "hidden",
                        border: `1px solid ${C.border}`, background: "rgba(6,12,18,0.98)",
                        boxShadow: "0 10px 24px rgba(0,0,0,0.6)",
                      }}
                    >
                      {recentTickers.map((t) => (
                        <button
                          key={t}
                          onMouseDown={() => { selectTicker(t); setRecentOpen(false); }}
                          style={{
                            display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                            padding: "7px 12px", fontSize: 15, fontWeight: 700, border: "none",
                            background: t === active ? DOCK_THEME.activeTile : "transparent",
                            color: t === active ? C.cyan : C.text,
                          }}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flow-filter-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
          <div>
            <label style={labelStyle}>Side</label>
            <div style={segWrapStyle}>
              {(["all", "buy", "sell"] as SideFilter[]).map((s) => (
                <button key={s} className="flow-chip" style={segBtn(side === s)} onClick={() => setSide(s)}>{s}</button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Type</label>
            <div style={segWrapStyle}>
              {([["all", "All"], ["C", "Call"], ["P", "Put"]] as [TypeFilter, string][]).map(([v, lbl]) => (
                <button key={v} className="flow-chip" style={segBtn(optType === v)} onClick={() => setOptType(v)}>{lbl}</button>
              ))}
            </div>
          </div>

          <div style={{ gridColumn: "span 2" }}>
            <label style={labelStyle}>Min Premium <span style={{ color: C.cyan }}>{minPremium === 0 ? "Any" : fmtPremium(minPremium)}</span></label>
            <input
              style={{ width: "100%", accentColor: C.cyan }}
              type="range" min={0} max={premiumMax} step={premiumStep}
              value={minPremium}
              onChange={(e) => setMinPremium(Number(e.target.value))}
            />
          </div>

          <div>
            <label style={labelStyle}>Min Size</label>
            <input style={fieldStyle} type="number" min={0} placeholder="contracts" value={minSize || ""} onChange={(e) => setMinSize(Number(e.target.value) || 0)} />
          </div>

          <div>
            <label style={labelStyle}>
              Expiry
              <button
                className="flow-chip"
                style={{ ...segBtn(!!nearestExpiry && expiry === nearestExpiry), marginLeft: 8, padding: "1px 8px", fontSize: 10 }}
                disabled={!nearestExpiry}
                title={nearestExpiry ? `0DTE / nearest expiry: ${nearestExpiry}` : "no expirations loaded"}
                onClick={() => {
                  if (!nearestExpiry) return;
                  if (expiry === nearestExpiry) { setExpiry("all"); return; }
                  setExpiry(nearestExpiry);
                  setDteMin(0);
                  setDteMax(null);
                }}
              >0DTE</button>
            </label>
            <select style={fieldStyle} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              <option value="all">All</option>
              {(view === "combined" ? combinedExpiryOptions : expiryOptions).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Min DTE</label>
            <input style={fieldStyle} type="number" min={0} placeholder="days" value={dteMin || ""} onChange={(e) => setDteMin(Number(e.target.value) || 0)} />
          </div>

          <div>
            <label style={labelStyle}>Max DTE</label>
            <input style={fieldStyle} type="number" min={0} placeholder="days" value={dteMax ?? ""} onChange={(e) => setDteMax(e.target.value === "" ? null : Number(e.target.value))} />
          </div>

          <div>
            <label style={labelStyle}>Moneyness</label>
            <div style={segWrapStyle}>
              <button className="flow-chip" style={segBtn(!otmOnly)} onClick={() => setOtmOnly(false)}>All</button>
              <button className="flow-chip" style={segBtn(otmOnly)} onClick={() => setOtmOnly(true)}>OTM</button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              className="flow-chip"
              onClick={resetFilters}
              style={{
                width: "100%", padding: "8px 6px", fontSize: 15, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                border: `1px solid ${C.border}`, borderRadius: 6, background: "rgba(255,255,255,0.04)", color: C.text,
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </Card>
      </div>
      </div>
      )}

      {/* ── Net Premium chart (per-ticker). Kept mounted but hidden in the
           Combined view so the once-created lightweight-chart keeps its ref.
           chartonly mode uses display:block (html2canvas can't walk
           display:contents) and tags the node for the Day Posts capture. ── */}
      <div id="flow-chart-capture" style={{ display: view !== "ticker" ? "none" : chartOnly ? "block" : "contents" }}>
        <Card variant="budget" padding={0} style={{ flexShrink: 0, opacity: netSwitching ? 0.55 : 1, transition: "opacity 0.15s" }}>
          <div style={{ padding: "16px 20px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.02em" }}>
              Net Drift (Premium) — <span style={{ color: C.cyan }}>{active}</span>
              {netSwitching && <span style={{ marginLeft: 8, fontSize: 15, fontWeight: 700, color: C.muted }}>· loading…</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 26, justifyContent: "center", padding: "0 12px 10px", fontSize: 15, fontWeight: 700, flexWrap: "wrap" }}>
            <span style={{ color: BULLISH }}>● Calls {fmtPremium(netSeries.lastCall)}</span>
            <span style={{ color: BEARISH }}>● Puts {fmtPremium(netSeries.lastPut)}</span>
            <span style={{ color: C.muted }}>Net {fmtPremium(netSeries.lastCall + netSeries.lastPut)}</span>
          </div>
          <div ref={chartHostRef} style={{ height: 340, width: "100%" }} />
          {!netSeries.hasData && (
            <p style={{ fontSize: 15, padding: "0 20px 12px", color: C.muted, textAlign: "center" }}>
              {!isToday ? `No ${active} flow recorded for ${date}.` : status === "LIVE" ? `No ${active} flow yet for the current filters.` : "Connecting to feed…"}
            </p>
          )}
          {view === "ticker" && !chartOnly && renderPremiumSplit()}
        </Card>
      </div>

      {view === "combined" && (
        <Card variant="budget" padding={0} style={{ flexShrink: 0 }}>
          <div style={{ padding: "16px 20px 4px", textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.02em" }}>
              Premium Split — <span style={{ color: C.cyan }}>{combinedLabel}</span>
            </div>
          </div>
          {renderPremiumSplit()}
        </Card>
      )}

      {/* ── Tape ────────────────────────────────────────────────────── */}
      {!chartOnly && (
      <Card variant="budget" padding={0} style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 20px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 22, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text }}>Flow Tape — {view === "combined" ? combinedLabel : active}</span>
            {view === "ticker" && historySwitching && <span style={{ fontSize: 15, fontWeight: 700, color: C.muted }}>loading…</span>}
            <span style={{ fontSize: 15, color: C.muted }}><strong style={{ color: C.text }}>{totals.count.toLocaleString()}</strong> orders</span>
            <span style={{ fontSize: 15, color: C.muted }}>Total <strong style={{ color: C.text }}>{fmtPremium(totals.prem)}</strong></span>
            <span style={{ fontSize: 15, color: C.muted }}>Calls <strong style={{ color: BULLISH }}>{fmtPremium(totals.callPrem)}</strong></span>
            <span style={{ fontSize: 15, color: C.muted }}>Puts <strong style={{ color: BEARISH }}>{fmtPremium(totals.putPrem)}</strong></span>
          </div>
          <span style={{ fontSize: 15, fontFamily: "var(--font-mono)", padding: "2px 10px", borderRadius: 4, background: (!isToday || status === "LIVE") ? "rgba(142,202,230,0.12)" : "rgba(239,68,68,0.12)", color: (!isToday || status === "LIVE") ? C.cyan : C.red }}>
            {isToday ? status : `${date} · HISTORICAL`}
          </span>
        </div>

        <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: view === "combined" ? 1180 : 1116 }}>
        <div style={{ display: "grid", gridTemplateColumns: view === "combined" ? GRID_COMBINED : GRID, gap: 8, padding: "8px 20px", borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, flexShrink: 0 }}>
          {view === "combined" && <span>Ticker</span>}
          <span>Time</span>
          <span>Side</span>
          <span style={{ textAlign: "right" }}>Strike</span>
          <span style={{ textAlign: "right" }}>Spot</span>
          <span style={{ textAlign: "center" }}>Type</span>
          <span style={{ textAlign: "right" }}>Size</span>
          <span style={{ textAlign: "right" }} title="Cost of one contract (price × 100)">Cost/Ctr</span>
          <span style={{ textAlign: "right" }}>Premium</span>
          <span style={{ textAlign: "right" }} title="Contract's traded volume TODAY (live, not at print time)">Vol</span>
          <span style={{ textAlign: "right" }} title="Contract's current open interest">OI</span>
          <span style={{ textAlign: "right" }} title="Current implied volatility">IV</span>
          <span style={{ textAlign: "right" }} title="Strike vs LIVE underlying spot. + = OTM, − = now ITM">% OTM</span>
          <span style={{ textAlign: "right" }} title="Calendar days to expiration">DTE</span>
          <span style={{ textAlign: "right" }}>Expiry</span>
          <span style={{ textAlign: "center" }}>Bias</span>
        </div>

        <div>
          {tapeRows.length === 0 ? (
            <p style={{ fontSize: 15, padding: 24, color: C.muted }}>
              {!isToday ? `No ${view === "combined" ? combinedLabel : active} flow recorded for ${date}.` : status === "LIVE" ? `No ${view === "combined" ? combinedLabel : active} flow matches the current filters.` : "Connecting to feed…"}
            </p>
          ) : (
            visibleRows.map((o, i) => {
              const sideColor = o.side === "buy" ? BULLISH : BEARISH;
              const bull = isBullish(o.side, o.type);
              const biasColor = bull ? BULLISH : BEARISH;
              const ticker = normTicker(o.underlying);
              // React key may use the index, but the EXPANDED key must not: the
              // tape re-sorts on every refresh, and an index-keyed drawer would
              // silently re-point at whatever print landed in that slot.
              // `ts|symbol|side` is the same identity the merge dedupes on.
              const rowKey = `${o.ts}-${o.symbol}-${i}`;
              const identity = `${o.ts}|${o.symbol}|${o.side}`;

              // Whale = a print big enough to be worth inspecting. Only these get
              // bold premium and the click-to-expand drawer; making every row
              // expandable would invite a chain fetch for $50K noise.
              const whale = Number(o.premium || 0) >= WHALE_FLOOR;
              const open = expandedKey === identity;

              const stat = lookupStat(o);
              const d = dteOf(o);
              // Live moneyness: + = still OTM, − = has gone ITM since the print.
              const liveSpot = spotByTicker[ticker] ?? o.spot ?? 0;
              const otmPct = liveSpot > 0 && o.strike
                ? ((o.type === "C" ? o.strike - liveSpot : liveSpot - o.strike) / liveSpot) * 100
                : null;

              return (
                <div key={rowKey}>
                  <div
                    onClick={whale ? () => setExpandedKey(open ? null : identity) : undefined}
                    role={whale ? "button" : undefined}
                    tabIndex={whale ? 0 : undefined}
                    onKeyDown={whale ? (e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedKey(open ? null : identity); }
                    } : undefined}
                    title={whale ? "Click to expand contract detail" : undefined}
                    style={{
                      display: "grid", gridTemplateColumns: view === "combined" ? GRID_COMBINED : GRID,
                      gap: 8, padding: "8px 20px", borderBottom: `1px solid ${C.border}`,
                      fontSize: 15, fontFamily: "var(--font-mono)", alignItems: "center",
                      cursor: whale ? "pointer" : "default",
                      background: open ? "rgba(33,158,188,0.10)" : "transparent",
                      outline: open ? `1px solid rgba(33,158,188,0.4)` : "none",
                    }}
                  >
                    {view === "combined" && <span style={{ color: C.cyan, fontWeight: 700 }}>{ticker}</span>}
                    <span style={{ color: C.muted }}>{fmtTime(o.ts)}</span>
                    <span style={{ color: sideColor, fontWeight: 700 }}>{o.side.toUpperCase()}</span>
                    <span style={{ textAlign: "right", color: C.text }}>{o.strike.toLocaleString()}</span>
                    <span style={{ textAlign: "right", color: C.muted }}>{fmtSpot(o.spot)}</span>
                    <span style={{ textAlign: "center", color: sideColor, fontWeight: 700 }}>{o.type}</span>
                    <span style={{ textAlign: "right", color: C.text }} title={o.fills && o.fills > 1 ? `${o.fills} fills aggregated` : undefined}>
                      {o.size.toLocaleString()}
                      {o.fills && o.fills > 1 ? <span style={{ color: C.muted, fontSize: 11 }}> ×{o.fills}</span> : null}
                    </span>
                    <span style={{ textAlign: "right", color: C.text }}>{fmtContractCost(o.price)}</span>
                    {/* Whale premium reads bold — the one column you scan for. */}
                    <span style={{ textAlign: "right", color: sideColor, fontWeight: whale ? 900 : 700, fontSize: whale ? 16 : 15 }}>
                      {whale ? "▸ " : ""}{fmtPremium(o.premium)}
                    </span>
                    <span style={{ textAlign: "right", color: C.text }}>{fmtStat(stat?.vol)}</span>
                    <span style={{ textAlign: "right", color: C.muted }}>{fmtStat(stat?.oi)}</span>
                    <span style={{ textAlign: "right", color: C.text }}>
                      {stat?.iv != null ? `${(stat.iv * 100).toFixed(1)}%` : "—"}
                    </span>
                    <span
                      style={{ textAlign: "right", fontWeight: 700, color: otmPct == null ? C.muted : otmPct >= 0 ? C.cyan : BEARISH }}
                      title={liveSpot > 0 ? `Strike ${o.strike} vs live spot ${liveSpot.toFixed(2)} — ${otmPct != null && otmPct < 0 ? "now ITM" : "OTM"}` : "No live spot yet"}
                    >
                      {otmPct == null ? "—" : `${otmPct.toFixed(1)}%`}
                    </span>
                    <span style={{ textAlign: "right", color: C.muted }}>{d == null ? "—" : `${d}d`}</span>
                    <span style={{ textAlign: "right", color: C.muted }}>{o.expiration ?? "—"}</span>
                    <span style={{ textAlign: "center", fontWeight: 800, fontSize: 15, color: biasColor }}>
                      {bull ? "▲ BULL" : "▼ BEAR"}
                    </span>
                  </div>
                  {open && (
                    <ContractDrawer
                      order={o}
                      ticker={ticker}
                      stat={stat}
                      liveSpot={liveSpot}
                      onClose={() => setExpandedKey(null)}
                    />
                  )}
                </div>
              );
            })
          )}
          {tapeRows.length > MAX_TAPE_ROWS && (
            <p style={{ fontSize: 15, padding: "10px 20px", color: C.muted, textAlign: "center" }}>
              Showing newest {MAX_TAPE_ROWS.toLocaleString()} of {tapeRows.length.toLocaleString()} — tighten filters to narrow.
            </p>
          )}
        </div>
        </div>
        </div>
      </Card>
      )}
    </PageShell>
  );
}
