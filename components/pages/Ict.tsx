"use client";

/**
 * /ict — ICT (Inner Circle Trader) page.
 *
 * Two halves:
 *   1. LIVE DETECTION over the same 5-min ES session feed the /es-candles page
 *      uses (useEsCandles + /ws/gex). A lightweight-charts candle chart is
 *      overlaid with the ICT primitives computed in lib/calculations/ictConcepts:
 *      Fair Value Gaps, Order Blocks, liquidity pools (BSL/SSL), market-structure
 *      events (BOS/CHOCH/MSS), kill zones / Silver Bullet / macros, and the
 *      premium/discount + OTE dealing range. A side panel lists the live reads.
 *   2. GLOSSARY of the ICT concepts (sourced from innercircletrader.net's
 *      "Most Important ICT Concepts" list) so the definitions sit next to the
 *      live signals.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, createChart,
} from "lightweight-charts";
import type { UTCTimestamp, IChartApi, ISeriesApi, CandlestickData } from "lightweight-charts";
import { useEsCandles } from "@/hooks/useEsCandles";
import { useNqCandles } from "@/hooks/useNqCandles";
import { BoxDiscordBtn } from "@/components/shared/DataBox";
import { captureAndCopy } from "@/lib/snapshot";
import {
  analyzeICT, activeWindows, ICT_WINDOWS, etMinutes,
  type IctCandle, type IctAnalysis, type TimeWindow,
} from "@/lib/calculations/ictConcepts";
import {
  buildIctPlays, playSide, playRR, type IctPlay,
} from "@/lib/calculations/ictPlays";
// Glossary content is shared with the public /explore/ict marketing page.
import { ICT_CONCEPTS as CONCEPTS, type IctConcept as Concept } from "@/components/explore/ictGlossary";

function toChartTime(ts: number): UTCTimestamp {
  return Math.floor(ts / 1000) as UTCTimestamp;
}

// ── Glossary content ─────────────────────────────────────────────────────────
// ICT_CONCEPTS now lives in components/explore/ictGlossary.ts (shared with /explore/ict).
const CONCEPT_BY_ID: Record<string, Concept> = Object.fromEntries(CONCEPTS.map((c) => [c.id, c]));

// One color per ICT concept (RGB triplets; alpha applied at draw time).
const C = {
  fvg:    "41,182,246",   // FVG       → blue
  ifvg:   "236,72,153",   // IFVG      → pink
  ob:     "48,209,88",    // Order Block → green
  liq:    "255,159,67",   // Liquidity → orange
  struct: "167,139,250",  // Structure (BOS/CHOCH/MSS) → purple
  play:   "255,193,7",    // Play markup (position tool) → gold
};

// Long/short position-tool palette — profit zone above/below entry, stop zone the
// other side, mirroring the TradingView drawing tool.
const PLAY_C = {
  profit: "48,209,88",
  loss:   "255,91,91",
  entry:  "255,255,255",
};

// Kill-zone band colors by kind.
const WIN_COLOR: Record<TimeWindow["kind"], string> = {
  killzone: "rgba(41,182,246,0.07)",
  silver:   "rgba(255,193,7,0.10)",
  macro:    "rgba(167,139,250,0.12)",
};

// ── Concept Leaderboard (popout) ────────────────────────────────────────────
// Same per-kind summary rows /dev/results reads from /api/ict-setups, ranked
// by win rate. Toolbar button next to the ES/NQU switcher opens it in a modal.
type LbSummaryRow = {
  kind: string;
  wins: number; losses: number; chop: number; pending: number;
  graded: number; total: number;
  win_rate: number | null; avg_r: number | null; avg_mfe: number | null;
};
const LB_KIND_LABEL: Record<string, string> = {
  fvg: "Fair Value Gap", ifvg: "Inverse FVG", ob: "Order Block", ote: "OTE Entry",
  mss: "Market Structure Shift", bos: "Break of Structure", choch: "Change of Character",
  liquidity: "Liquidity Sweep", eqhl: "Equal H/L Sweep", inducement: "Inducement",
  turtleSoup: "Turtle Soup", judas: "Judas Swing", breaker: "Breaker Block",
  cisd: "CISD", model2022: "2022 Model", displacement: "Displacement",
};
const lbKindLabel = (k: string) => LB_KIND_LABEL[k] ?? k;

function ConceptLeaderboardModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<LbSummaryRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/ict-setups?all=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { if (alive) setRows(Array.isArray(j.summary) ? j.summary : []); })
      .catch((e) => { if (alive) setErr(String(e)); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sorted = useMemo(
    () => [...rows]
      .filter((r) => r.graded >= 3)
      .sort((a, b) => (b.win_rate ?? -1) - (a.win_rate ?? -1)),
    [rows]
  );

  const wrColor = (wr: number | null) => wr == null ? "#9fb3c8" : wr >= 0.6 ? "#22e08a" : wr >= 0.45 ? "#ffb300" : "#ff6b6b";

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(3,7,12,0.72)", backdropFilter: "blur(3px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#0b121c", border: "1px solid rgba(255,255,255,0.10)", borderTop: "3px solid #219EBC", borderRadius: 14, width: "min(880px, 96vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.55)" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.10)" }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: "#219EBC", textTransform: "uppercase", letterSpacing: "0.1em" }}>Concept Leaderboard</span>
          <span style={{ fontSize: 12, color: "#c9d8e8" }}>ES futures · all-time · ranked by win rate (avg R = avg reward/risk on winners)</span>
          <button
            onClick={onClose}
            style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: "1px solid rgba(255,255,255,0.10)", background: "transparent", color: "#c9d8e8", fontFamily: "inherit", textTransform: "uppercase", letterSpacing: "0.06em" }}
          >Close ✕</button>
        </div>

        <div style={{ overflow: "auto", padding: "4px 0" }}>
          {err ? (
            <div style={{ padding: "22px 24px", color: "#ff6b6b", fontSize: 14 }}>Couldn&apos;t load leaderboard: {err}</div>
          ) : !loaded ? (
            <div style={{ padding: "22px 24px", color: "#c9d8e8", fontSize: 14 }}>Loading…</div>
          ) : sorted.length === 0 ? (
            <div style={{ padding: "22px 24px", color: "#c9d8e8", fontSize: 14 }}>No graded setups yet (need ≥3 per concept).</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.10)", position: "sticky", top: 0, background: "#0b121c" }}>
                  <th style={{ padding: "8px 16px", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#c9d8e8", textAlign: "left" }}>#</th>
                  <th style={{ padding: "8px 16px", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#c9d8e8", textAlign: "left" }}>Concept</th>
                  <th style={{ padding: "8px 16px", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#c9d8e8", textAlign: "left" }}>Record</th>
                  <th style={{ padding: "8px 16px", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#c9d8e8", textAlign: "left" }}>Win Rate</th>
                  <th style={{ padding: "8px 16px", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#c9d8e8", textAlign: "right" }}>Avg R</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const pct = r.win_rate != null ? Math.round(r.win_rate * 100) : null;
                  const ac = wrColor(r.win_rate);
                  return (
                    <tr key={r.kind} style={{ borderTop: i ? "1px solid rgba(255,255,255,0.06)" : undefined }}>
                      <td style={{ padding: "10px 16px", fontSize: 14, fontFamily: "var(--font-mono)", color: "#c9d8e8" }}>{i + 1}</td>
                      <td style={{ padding: "10px 16px", fontSize: 14, fontWeight: 700, color: "#fff" }}>{lbKindLabel(r.kind)}</td>
                      <td style={{ padding: "10px 16px", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                        <span style={{ color: "#22e08a" }}>{r.wins}W</span>
                        <span style={{ color: "#c9d8e8" }}> · </span>
                        <span style={{ color: "#ff6b6b" }}>{r.losses}L</span>
                      </td>
                      <td style={{ padding: "10px 16px", minWidth: 160 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 6, borderRadius: 3, background: "#0b1320", overflow: "hidden" }}>
                            <div style={{ width: `${pct ?? 0}%`, height: "100%", background: ac }} />
                          </div>
                          <span style={{ fontSize: 14, fontWeight: 800, color: ac, fontFamily: "var(--font-mono)", minWidth: 34, textAlign: "right" }}>
                            {pct != null ? `${pct}%` : "—"}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: 14, fontWeight: 800, fontFamily: "var(--font-mono)", textAlign: "right", color: r.avg_r == null ? "#9fb3c8" : r.avg_r >= 1 ? "#22e08a" : "#ffb300" }}>
                        {r.avg_r != null ? `${r.avg_r > 0 ? "+" : ""}${r.avg_r.toFixed(1)}R` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function IctPage() {
  // Instrument tab: ES (default) or NQU. Only the active feed connects — the
  // idle hook opens no socket + loads nothing, so switching tabs swaps feeds
  // without doubling /ws/gex bandwidth.
  const [instrument, setInstrument] = useState<"ES" | "NQU">("ES");
  const esFeed = useEsCandles(instrument === "ES");
  const nqFeed = useNqCandles(instrument === "NQU");
  const { sessionCandles, historical, connected } = instrument === "NQU" ? nqFeed : esFeed;
  const instLabel = instrument === "NQU" ? "NQ" : "ES";

  // Timeframe switcher — base feed is 5m; higher TFs are aggregated from it.
  const [tf, setTf] = useState<5 | 15 | 30 | 60>(5);

  // 7 calendar days of 5m bars: DB history merged with the live rolling session
  // (live wins on slotKey). Replaces the hook's 30h sessionCandles window.
  const weekCandles = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const map = new Map<string, (typeof sessionCandles)[number]>();
    for (const c of historical) if (c.slotKey && c.timestamp >= cutoff) map.set(c.slotKey, c);
    for (const c of sessionCandles) if (c.timestamp >= cutoff) map.set(c.slotKey, c);
    return [...map.values()].sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey));
  }, [historical, sessionCandles]);

  // Aggregate the 5m base bars up to the selected timeframe. Buckets are aligned
  // to the ET wall clock via timestamp flooring (each bucket = tf minutes).
  const tfCandles = useMemo(() => {
    if (tf === 5) return weekCandles;
    const bucketMs = tf * 60 * 1000;
    const buckets = new Map<number, (typeof weekCandles)[number]>();
    const order: number[] = [];
    for (const c of weekCandles) {
      const key = Math.floor(c.timestamp / bucketMs) * bucketMs;
      const b = buckets.get(key);
      if (!b) {
        buckets.set(key, { ...c, timestamp: key });
        order.push(key);
      } else {
        b.high = Math.max(b.high, c.high);
        b.low = Math.min(b.low, c.low);
        b.close = c.close;
        b.volume = (b.volume || 0) + (c.volume || 0);
      }
    }
    return order.map((k) => buckets.get(k)!);
  }, [weekCandles, tf]);
  const captureRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const didFitRef = useRef(false);
  const lastFitDayRef = useRef("");
  const drawOverlayRef = useRef<() => void>(() => {});
  const [clockTick, setClockTick] = useState(0);

  // Hover hit-testing: every overlay primitive registers a rectangular region +
  // the glossary concept id it maps to. mousemove finds the topmost hit and
  // pops an info box (sourced from CONCEPTS) anchored to the cursor.
  type HitRegion = { x: number; y: number; w: number; h: number; conceptId: string; title: string; detail?: string };
  const hitsRef = useRef<HitRegion[]>([]);
  const [hover, setHover] = useState<{ x: number; y: number; concept: Concept; detail?: string } | null>(null);
  const [hoverEnabled, setHoverEnabled] = useState(true);

  // Overlay toggles.
  const [showFvg, setShowFvg] = useState(false);
  const [showOb, setShowOb] = useState(false);
  const [showLiq, setShowLiq] = useState(false);
  const [showStruct, setShowStruct] = useState(false);
  const [showKz, setShowKz] = useState(false);
  const [showPd, setShowPd] = useState(false);
  // Play markup (the long/short position tool) is the headline layer — ON by default.
  // The chart only shows a green/red ENTRY DOT per play; clicking a dot opens that
  // play's position box + a detail card. Keeps six simultaneous setups readable.
  const [showPlays, setShowPlays] = useState(true);
  const [openPlay, setOpenPlay] = useState<{ id: string; x: number; y: number } | null>(null);
  const openPlayRef = useRef(openPlay); openPlayRef.current = openPlay;
  // Screen position of each play's entry dot, refreshed every draw, so a click on
  // a row in the Plays card can anchor the same popup the dot does.
  const dotPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [overDot, setOverDot] = useState(false);
  // Drag guard: panning the chart ends in a click, which would otherwise close
  // the popup on every pan.
  const pressRef = useRef<{ x: number; y: number } | null>(null);

  // Which glossary cards are expanded (collapsed by default → icon + title only).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleCard = (id: string) => setExpanded((m) => ({ ...m, [id]: !m[id] }));

  // Per-user glossary card visibility (Postgres, /api/ict-prefs). hiddenCards =
  // concept ids toggled OFF. Loaded once; saved (debounced) on every change.
  const [hiddenCards, setHiddenCards] = useState<Set<string>>(new Set());
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/ict-prefs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { hiddenCards: [] }))
      .then((j) => { if (alive) setHiddenCards(new Set(Array.isArray(j.hiddenCards) ? j.hiddenCards : [])); })
      .catch(() => {})
      .finally(() => { if (alive) setPrefsLoaded(true); });
    return () => { alive = false; };
  }, []);

  // Persist (debounced) whenever the hidden set changes — but not on first load.
  const persistHidden = useCallback((next: Set<string>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch("/api/ict-prefs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hiddenCards: [...next] }),
      }).catch(() => {});
    }, 500);
  }, []);

  const toggleCardVisible = (id: string) => {
    setHiddenCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      persistHidden(next);
      return next;
    });
  };
  const showAllCards = () => { setHiddenCards(() => { const n = new Set<string>(); persistHidden(n); return n; }); };
  const hideAllCards = () => { setHiddenCards(() => { const n = new Set(CONCEPTS.map((c) => c.id)); persistHidden(n); return n; }); };

  // Tick every 30s so kill-zone "active" state + bias re-evaluate.
  useEffect(() => { const id = setInterval(() => setClockTick((n) => n + 1), 30_000); return () => clearInterval(id); }, []);

  const candles: IctCandle[] = useMemo(
    () => tfCandles.map((c) => ({
      timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close,
      volume: c.volume, date: c.date,
    })),
    [tfCandles]
  );

  const ict: IctAnalysis = useMemo(() => analyzeICT(candles), [candles]);
  const ictRef = useRef(ict); ictRef.current = ict;

  // Tradeable plays (entry / stop / 1R-2R-3R) derived from the SAME analysis —
  // no second detection pass. Re-evaluated on the 30s tick so a live play
  // resolves / ages out without waiting for the next bar.
  const plays: IctPlay[] = useMemo(() => {
    void clockTick;
    return buildIctPlays(candles, ict, { tfMin: tf });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, ict, tf, clockTick]);
  const playsRef = useRef(plays); playsRef.current = plays;

  const togglesRef = useRef({ showFvg, showOb, showLiq, showStruct, showKz, showPd, showPlays });
  togglesRef.current = { showFvg, showOb, showLiq, showStruct, showKz, showPd, showPlays };

  const liveWindows = useMemo(() => {
    void clockTick;
    return activeWindows(Date.now());
  }, [clockTick]);

  // ── Chart init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = chartRef.current;
    if (!container) return;
    container.innerHTML = "";
    const chart = createChart(container, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "rgba(255,255,255,.70)", fontFamily: "Inter, system-ui, sans-serif" },
      grid: { vertLines: { color: "rgba(255,255,255,.05)" }, horzLines: { color: "rgba(255,255,255,.05)" } },
      rightPriceScale: { visible: true, borderColor: "rgba(255,255,255,.10)" },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: "rgba(255,255,255,.10)", timeVisible: true, secondsVisible: false,
        // Axis tick labels in Eastern Time. tickMarkType 2/3 = day/month boundary
        // → show the ET date; otherwise show ET HH:MM.
        tickMarkFormatter: (t: unknown, tickMarkType: number) => {
          if (typeof t !== "number") return "";
          const d = new Date(t * 1000);
          if (tickMarkType === 2 || tickMarkType === 3) {
            return d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
          }
          return d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
        },
      },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        priceFormatter: (p: number) => p.toFixed(2),
        timeFormatter: (t: unknown) =>
          typeof t === "number"
            ? new Date(t * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })
            : "",
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      wickUpColor: "#30d158", upColor: "#30d158", wickDownColor: "#ff5b5b", downColor: "#ff5b5b", borderVisible: false,
      priceLineColor: "#8a8f98",
    });
    chartApiRef.current = chart;
    seriesRef.current = series;

    let lastW = 0, lastH = 0;
    const ro = new ResizeObserver(() => {
      const w = Math.round(container.clientWidth), h = Math.round(container.clientHeight);
      if (w <= 0 || h <= 0 || (w === lastW && h === lastH)) return;
      lastW = w; lastH = h;
      chart.applyOptions({ width: w, height: h });
      syncOverlaySize();
      drawOverlayRef.current();
    });
    ro.observe(container);
    lastW = Math.round(container.clientWidth); lastH = Math.round(container.clientHeight);
    chart.applyOptions({ width: lastW, height: lastH });

    const syncOverlaySize = () => {
      const cv = overlayRef.current;
      if (!cv) return;
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(container.clientWidth * dpr);
      cv.height = Math.round(container.clientHeight * dpr);
      cv.style.width = `${container.clientWidth}px`;
      cv.style.height = `${container.clientHeight}px`;
      const ctx = cv.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    syncOverlaySize();

    const onRange = () => drawOverlayRef.current();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const onDbl = () => { chart.timeScale().fitContent(); chart.priceScale("right").applyOptions({ autoScale: true }); drawOverlayRef.current(); };
    container.addEventListener("dblclick", onDbl);

    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      container.removeEventListener("dblclick", onDbl);
      chart.remove();
      chartApiRef.current = null; seriesRef.current = null;
    };
  }, []);

  // ── Feed candle data ───────────────────────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current, chart = chartApiRef.current;
    if (!series || !chart) return;
    const data: CandlestickData[] = candles.map((c) => ({
      time: toChartTime(c.timestamp), open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    series.setData(data);
    const lastDay = candles.length ? (candles[candles.length - 1].date || "") : "";
    if (data.length && (!didFitRef.current || lastDay !== lastFitDayRef.current)) {
      chart.timeScale().fitContent();
      didFitRef.current = true; lastFitDayRef.current = lastDay;
    }
    drawOverlayRef.current();
  }, [candles]);

  // ── Overlay draw ───────────────────────────────────────────────────────────
  drawOverlayRef.current = () => {
    const cv = overlayRef.current, chart = chartApiRef.current, series = seriesRef.current;
    if (!cv || !chart || !series) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = cv.width / (window.devicePixelRatio || 1);
    const H = cv.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, W, H);
    const ts = chart.timeScale();
    const a = ictRef.current;
    const t = togglesRef.current;
    const xOf = (ms: number) => ts.timeToCoordinate(toChartTime(ms));
    const yOf = (p: number) => series.priceToCoordinate(p);
    const rightEdge = W - 2;

    // Reset hover hit-regions for this frame. Lines get a small vertical pad so
    // they're hoverable.
    const hits: HitRegion[] = [];
    hitsRef.current = hits;
    const addRect = (x: number, y: number, w: number, h: number, conceptId: string, title: string, detail?: string) =>
      hits.push({ x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h), conceptId, title, detail });
    const addLine = (x: number, y: number, w: number, conceptId: string, title: string, detail?: string) =>
      addRect(x, y - 4, w, 8, conceptId, title, detail);

    // Kill-zone / Silver Bullet / macro vertical bands.
    if (t.showKz && candles.length) {
      // Draw a band for every ICT window that intersects each visible ET day.
      const days = [...new Set(candles.map((c) => c.date || ""))].filter(Boolean);
      const dayMid = (day: string): number => {
        // ms at ET-midnight of `day` via a probe candle on that day.
        const probe = candles.find((c) => (c.date || "") === day);
        if (!probe) return NaN;
        return probe.timestamp - etMinutes(probe.timestamp) * 60_000;
      };
      for (const day of days) {
        const mid = dayMid(day);
        if (!Number.isFinite(mid)) continue;
        for (const w of ICT_WINDOWS) {
          const x1 = xOf(mid + w.startMin * 60_000);
          const x2 = xOf(mid + w.endMin * 60_000);
          if (x1 == null || x2 == null) continue;
          ctx.fillStyle = WIN_COLOR[w.kind];
          ctx.fillRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), H);
          const wcId = w.kind === "silver" ? "silver" : w.kind === "macro" ? "macros" : "killzones";
          addRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), H, wcId, w.label, `${fmtMin(w.startMin)}–${fmtMin(w.endMin)} ET`);
        }
      }
    }

    // Premium / Discount + OTE + equilibrium.
    if (t.showPd && a.range) {
      const yHi = yOf(a.range.high), yLo = yOf(a.range.low), yEq = yOf(a.range.eq);
      if (yHi != null && yLo != null && yEq != null) {
        // premium shading (eq → high)
        ctx.fillStyle = "rgba(255,71,87,0.05)";
        ctx.fillRect(0, Math.min(yHi, yEq), W, Math.abs(yEq - yHi));
        addRect(0, Math.min(yHi, yEq), W, Math.abs(yEq - yHi), "pd", "Premium zone", `${a.range.eq.toFixed(2)}–${a.range.high.toFixed(2)} (sellers')`);
        // discount shading (eq → low)
        ctx.fillStyle = "rgba(48,209,88,0.05)";
        ctx.fillRect(0, Math.min(yEq, yLo), W, Math.abs(yLo - yEq));
        addRect(0, Math.min(yEq, yLo), W, Math.abs(yLo - yEq), "pd", "Discount zone", `${a.range.low.toFixed(2)}–${a.range.eq.toFixed(2)} (buyers')`);
        // equilibrium line
        ctx.strokeStyle = "rgba(255,255,255,0.30)"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(0, yEq); ctx.lineTo(W, yEq); ctx.stroke();
        ctx.setLineDash([]);
        label(ctx, 6, yEq - 4, "EQ 0.5", "rgba(255,255,255,0.55)");
        addLine(0, yEq, W, "pd", "Equilibrium (0.5)", a.range.eq.toFixed(2));
        // OTE band
        const yo1 = yOf(a.range.ote.from), yo2 = yOf(a.range.ote.to);
        if (yo1 != null && yo2 != null) {
          ctx.fillStyle = "rgba(167,139,250,0.16)";
          ctx.fillRect(0, Math.min(yo1, yo2), W, Math.abs(yo2 - yo1));
          label(ctx, 6, Math.min(yo1, yo2) + 11, "OTE 62–79%", "rgba(167,139,250,0.9)");
          addRect(0, Math.min(yo1, yo2), W, Math.abs(yo2 - yo1), "ote", "Optimal Trade Entry", `${a.range.ote.to.toFixed(2)}–${a.range.ote.from.toFixed(2)}`);
        }
      }
    }

    // FVG boxes. A box EXTENDS right only while it's live; once price passes
    // through it (2nd touch, or a break) the box ENDS at that candle (endTs)
    // instead of stretching to the live edge. An inverted IFVG keeps drawing
    // (flipped polarity) from its inversion point — and once price closes back
    // through IT (it's no longer acting as an inverted zone), it too ends/stops
    // extending at that candle, staying on screen up to the break.
    if (t.showFvg) {
      for (const f of a.fvgs) {
        const xStart = xOf(f.inverted && f.invertedTs ? f.invertedTs : f.ts);
        const yT = yOf(f.top), yB = yOf(f.bottom);
        if (xStart == null || yT == null || yB == null) continue;
        // Right edge of the box: endTs if the gap/IFVG has ended, else the live edge.
        const xEndRaw = f.endTs != null ? xOf(f.endTs) : rightEdge;
        const xEnd = xEndRaw == null ? rightEdge : xEndRaw;
        const bull = f.activeDir === "bull";
        const x = Math.min(xStart, xEnd), y = Math.min(yT, yB);
        const w = Math.max(2, Math.abs(xEnd - xStart)), h = Math.abs(yB - yT);
        // FVG = BLUE, IFVG = PINK (one color per concept; direction via the ↑/↓
        // in the label, not the box color).
        const arrow = bull ? " ↑" : " ↓";
        const done = f.endTs != null; // ended box reads fainter than a live one
        if (f.inverted) {
          ctx.fillStyle = `rgba(${C.ifvg},${done ? 0.08 : 0.18})`;
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = `rgba(${C.ifvg},${done ? 0.5 : 0.95})`;
          ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
          ctx.strokeRect(x, y, w, h);
          ctx.setLineDash([]);
          label(ctx, x + 3, y + 11, "IFVG" + arrow, `rgba(${C.ifvg},${done ? 0.6 : 1})`);
          addRect(x, y, w, h, "ifvg", `Inverse FVG ${bull ? "↑ bullish" : "↓ bearish"}${done ? " (invalidated)" : ""}`, `${f.bottom.toFixed(2)}–${f.top.toFixed(2)}`);
        } else {
          ctx.fillStyle = `rgba(${C.fvg},${done ? 0.08 : 0.16})`;
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = `rgba(${C.fvg},0.6)`;
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, w, h);
          label(ctx, x + 3, y + 11, "FVG" + arrow, `rgba(${C.fvg},0.95)`);
          addRect(x, y, w, h, "fvg", `Fair Value Gap ${bull ? "↑ bullish" : "↓ bearish"}${done ? " (mitigated)" : ""}`, `${f.bottom.toFixed(2)}–${f.top.toFixed(2)}`);
        }
      }
    }

    // Order blocks = GREEN. VALID blocks (swept liquidity + left an imbalance)
    // draw solid; weak/unconfirmed blocks draw faint + dashed.
    if (t.showOb) {
      for (const o of a.orderBlocks) {
        if (o.violated) continue; // price closed through it → block is spent, drop it
        const x = xOf(o.ts), yT = yOf(o.top), yB = yOf(o.bottom);
        if (x == null || yT == null || yB == null) continue;
        const yy = Math.min(yT, yB), hh = Math.abs(yB - yT), ww = Math.max(2, rightEdge - x);
        ctx.globalAlpha = o.mitigated ? 0.35 : 1;
        ctx.fillStyle = `rgba(${C.ob},${o.valid ? 0.12 : 0.05})`;
        ctx.fillRect(x, yy, ww, hh);
        ctx.strokeStyle = `rgba(${C.ob},${o.valid ? 0.9 : 0.45})`;
        ctx.lineWidth = o.valid ? 1.5 : 1;
        ctx.setLineDash(o.valid ? [] : [3, 3]);
        ctx.strokeRect(x, yy, ww, hh);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        label(ctx, x + 3, yy + 11, `${o.dir === "bull" ? "OB ↑" : "OB ↓"}${o.valid ? "" : "?"}`, `rgba(${C.ob},0.95)`);
        addRect(x, yy, ww, hh, "ob", `Order Block ${o.dir === "bull" ? "↑ bullish" : "↓ bearish"}${o.valid ? "" : " (unconfirmed)"}${o.mitigated ? " · mitigated" : ""}`, `${o.bottom.toFixed(2)}–${o.top.toFixed(2)}`);
      }
    }

    // Liquidity pools = ORANGE.
    if (t.showLiq) {
      // Prior-day high/low — the headline liquidity draws (PDH = buy-side,
      // PDL = sell-side). Drawn full-width, brighter + thicker than swing pools.
      const pdLevels: { label: string; price: number; side: "BSL" | "SSL" }[] = [];
      if (a.bias.prevHigh != null) pdLevels.push({ label: "PDH", price: a.bias.prevHigh, side: "BSL" });
      if (a.bias.prevLow != null) pdLevels.push({ label: "PDL", price: a.bias.prevLow, side: "SSL" });
      for (const lv of pdLevels) {
        const y = yOf(lv.price);
        if (y == null) continue;
        ctx.strokeStyle = `rgba(${C.liq},0.95)`; ctx.lineWidth = 1.5; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        label(ctx, 6, y - 3, `${lv.label} ${lv.price.toFixed(2)}`, `rgba(${C.liq},1)`);
        addLine(0, y, W, "liquidity",
          `${lv.label} · ${lv.side === "BSL" ? "Buy-side liquidity" : "Sell-side liquidity"}`,
          lv.price.toFixed(2));
      }
      for (const p of a.liquidity.slice(0, 10)) {
        const y = yOf(p.price); const x = xOf(p.ts);
        if (y == null) continue;
        ctx.strokeStyle = p.swept ? "rgba(255,255,255,0.18)" : `rgba(${C.liq},0.8)`;
        ctx.lineWidth = 1; ctx.setLineDash(p.swept ? [2, 4] : []);
        ctx.beginPath(); ctx.moveTo(x ?? 0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.setLineDash([]);
        addLine(x ?? 0, y, W - (x ?? 0), p.count >= 2 ? "eqhl" : "liquidity",
          `${p.side === "BSL" ? "Buy-side liquidity" : "Sell-side liquidity"}${p.count > 1 ? ` ×${p.count} (equal levels)` : ""}${p.swept ? " · swept" : ""}`,
          p.price.toFixed(2));
        label(ctx, (x ?? 0) + 4, y - 3, `${p.side}${p.count > 1 ? `×${p.count}` : ""}${p.swept ? " swept" : ""}`,
          p.swept ? "rgba(255,255,255,0.45)" : `rgba(${C.liq},0.95)`);
      }
    }

    // Structure markers (BOS / CHOCH / MSS) = PURPLE.
    if (t.showStruct) {
      for (const s of a.structure.slice(-30)) {
        const x = xOf(s.ts), y = yOf(s.price);
        if (x == null || y == null) continue;
        ctx.strokeStyle = `rgba(${C.struct},0.95)`; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(Math.max(0, x - 36), y); ctx.lineTo(x, y); ctx.stroke();
        ctx.setLineDash([]);
        const stId = s.kind === "MSS" ? "mss" : s.kind === "CHOCH" ? "choch" : "bos";
        addLine(Math.max(0, x - 36), y, Math.min(x, 36) + 20, stId, `${s.kind} ${s.dir === "bull" ? "↑ bullish" : "↓ bearish"}`, s.price.toFixed(2));
        label(ctx, x + 2, y + (s.dir === "bull" ? -3 : 11), `${s.kind} ${s.dir === "bull" ? "↑" : "↓"}`, `rgba(${C.struct},0.95)`);
      }
    }

    // ── PLAY MARKUP — entry dots + the long/short position tool ──────────────
    // Drawn LAST so plays sit on top of the zone layers. Each play marks its
    // ENTRY with a green (long) / red (short) dot; clicking a dot opens that
    // play's position box — a green profit zone (entry → 3R), a red stop zone
    // (entry → structural stop), the entry line between them, and dashed 1R/2R
    // rungs inside the profit zone, laid out like TradingView's Long/Short
    // Position drawing tool. A play appears only once its detector actually
    // FIRES — there is no "possible / armed" state — and a resolved play stops
    // extending at the bar that finished it.
    // Only the OPEN play draws its box — six boxes at once was unreadable.
    if (t.showPlays && candles.length) {
      // Bar pitch, so a box can be sized in BARS (like the TradingView tool)
      // instead of always stretching to the right edge — overlapping plays were
      // unreadable when every box ended at the same x.
      const lastTs = candles[candles.length - 1].timestamp;
      const prevTs = candles[Math.max(0, candles.length - 2)].timestamp;
      const xLast = xOf(lastTs), xPrev = xOf(prevTs);
      const pitch = xLast != null && xPrev != null && xLast !== xPrev ? Math.abs(xLast - xPrev) : 6;
      const RUNWAY = 8;   // bars of room drawn to the right of the live bar
      const MIN_BARS = 10;
      // Pill rows already taken this frame, so headers on stacked plays don't
      // print on top of each other.
      const pillRows: Array<{ x: number; y: number; w: number }> = [];
      const dots = new Map<string, { x: number; y: number }>();
      // Draw oldest → newest so the freshest play ends up on top.
      for (const p of [...playsRef.current].reverse()) {
        const isOpen = openPlayRef.current?.id === p.id;
        const xStart = xOf(p.triggerTs) ?? 0;
        const xEndRaw = p.resolvedTs != null
          ? (xOf(p.resolvedTs) ?? rightEdge) + pitch
          : (xLast ?? rightEdge) + RUNWAY * pitch;
        const xEnd = Math.min(rightEdge, Math.max(xEndRaw, xStart + MIN_BARS * pitch));
        // A play that triggers on the LIVE bar has no room to its right, so the
        // box would collapse into a sliver against the price scale — exactly the
        // play you most want to read. Give it a minimum on-screen width by
        // letting the box hang back to the LEFT of the entry instead (the dot
        // still marks the true entry bar; the box only has to carry the levels).
        const MIN_W = 132;
        const xLeft = xEnd - xStart < MIN_W ? Math.max(0, xEnd - MIN_W) : xStart;
        const yE = yOf(p.entry), yS = yOf(p.stop), yT3 = yOf(p.targets[p.targets.length - 1]);
        if (yE == null || yS == null || yT3 == null) continue;
        const x = Math.min(xLeft, xEnd);
        const w = Math.max(6, Math.abs(xEnd - xLeft));
        const alpha = p.state === "live" ? 1 : 0.34;
        const side = playSide(p.dir);
        const yProfTop = Math.min(yE, yT3), profH = Math.abs(yT3 - yE);
        const yStopTop = Math.min(yE, yS), stopH = Math.abs(yS - yE);
        const rr = playRR(p);
        const t3 = p.targets[p.targets.length - 1];
        const stateTxt = p.state === "live" ? "LIVE" : p.state === "won" ? `WON ${p.mfeR.toFixed(1)}R` : "STOPPED";
        const stateCol = p.state === "lost" ? "#ff6b6b" : "#22e08a";

        // The entry dot is the always-on marker; remember where it landed so the
        // click hit-test and the Plays-card rows can both find it.
        dots.set(p.id, { x: xStart, y: yE });

        // Everything below is the position box — only for the play you opened.
        // (The dot's own hover region is registered in the dot pass, after
        // collision nudging, so the hit-test matches where it actually drew.)
        if (!isOpen) continue;
        ctx.globalAlpha = alpha;

        // Profit zone (entry → 3R) and stop zone (entry → stop).
        ctx.fillStyle = `rgba(${PLAY_C.profit},0.13)`;
        ctx.fillRect(x, yProfTop, w, profH);
        ctx.fillStyle = `rgba(${PLAY_C.loss},0.16)`;
        ctx.fillRect(x, yStopTop, w, stopH);

        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeStyle = `rgba(${PLAY_C.profit},0.55)`;
        ctx.strokeRect(x, yProfTop, w, profH);
        ctx.strokeStyle = `rgba(${PLAY_C.loss},0.55)`;
        ctx.strokeRect(x, yStopTop, w, stopH);

        // 1R / 2R rungs inside the profit zone. Rung labels hug the RIGHT edge —
        // the left edge belongs to the entry/stop/target price tags.
        const rungX = Math.min(x + w - 62, W - 72);
        for (let i = 0; i < p.targets.length - 1; i++) {
          const yT = yOf(p.targets[i]);
          if (yT == null) continue;
          ctx.strokeStyle = `rgba(${PLAY_C.profit},${p.hitR > i ? 0.85 : 0.35})`;
          ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.moveTo(x, yT); ctx.lineTo(x + w, yT); ctx.stroke();
          if (w > 110 && Math.abs(yT3 - yE) > 34) {
            label(ctx, rungX, yT - 3, `${i + 1}R ${p.targets[i].toFixed(2)}${p.hitR > i ? " ✓" : ""}`,
              `rgba(${PLAY_C.profit},${p.hitR > i ? 1 : 0.7})`);
          }
        }
        ctx.setLineDash([]);

        // Entry line + the left-hand handle that ties the two zones together.
        ctx.strokeStyle = `rgba(${PLAY_C.entry},0.9)`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, yE); ctx.lineTo(x + w, yE); ctx.stroke();
        ctx.strokeStyle = `rgba(${C.play},0.8)`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, Math.min(yProfTop, yStopTop)); ctx.lineTo(x, Math.max(yProfTop + profH, yStopTop + stopH)); ctx.stroke();
        ctx.lineWidth = 1;

        // Price tags, anchored to the LEFT edge of the box.
        // A play that just triggered sits hard against the right edge with no room
        // inside the box — flip its tags to the outside-left rather than clipping
        // them (the freshest play is the one you most need the numbers for).
        const TAG_W = 124;
        const tagX = x + 6 + TAG_W > W ? Math.max(4, x - TAG_W) : x + 6;
        // Skip a tag when its zone is too thin to hold the text — a squashed box
        // is better read from the Plays card than from overlapping labels.
        if (profH >= 14) {
          label(ctx, tagX, yT3 < yE ? yProfTop + 11 : yProfTop + profH - 4,
            `TP ${t3.toFixed(2)} · ${Math.abs(t3 - p.entry).toFixed(2)} pts`, `rgba(${PLAY_C.profit},0.95)`);
        }
        label(ctx, tagX, yE - 4, `ENTRY ${p.entry.toFixed(2)}`, "rgba(255,255,255,0.95)");
        if (stopH >= 14) {
          label(ctx, tagX, yS > yE ? yStopTop + stopH - 4 : yStopTop + 11,
            `SL ${p.stop.toFixed(2)} · ${p.risk.toFixed(2)} pts`, `rgba(${PLAY_C.loss},0.95)`);
        }

        // Header pill: concept · side · R:R · state. Pushed down a row at a time
        // while it would land on a pill already drawn this frame.
        const head = `${p.label.toUpperCase()} · ${side} · ${rr.toFixed(1)}R:R`;
        ctx.font = "700 10px Inter, system-ui, sans-serif";
        const headW = ctx.measureText(head).width + ctx.measureText(stateTxt).width + 26;
        let headY = Math.max(16, Math.min(yProfTop, yStopTop) - 6);
        for (let guard = 0; guard < 8; guard++) {
          const clash = pillRows.some((r) => Math.abs(r.y - headY) < 17 && x < r.x + r.w && x + headW > r.x);
          if (!clash) break;
          headY += 18;
        }
        pillRows.push({ x, y: headY, w: headW });
        pill(ctx, x, headY, head, stateTxt, stateCol, alpha);

        ctx.globalAlpha = 1;

        // Hover: both zones map back to the concept card, with the play's numbers.
        const detail = `${side} ${p.entry.toFixed(2)} · SL ${p.stop.toFixed(2)} · TP ${t3.toFixed(2)} (${rr.toFixed(1)}R) · ${stateTxt}`;
        addRect(x, yProfTop, w, profH, p.conceptId, `${p.label} — profit zone`, detail);
        addRect(x, yStopTop, w, stopH, p.conceptId, `${p.label} — stop zone`, detail);
      }

      // ── Entry dots ────────────────────────────────────────────────────────
      // Second pass so every dot sits above the open play's box. Green = long,
      // red = short (direction, not outcome). A live play gets a halo ring; a
      // resolved one fades back and swaps its arrow for ✓ / ✕.
      //
      // Two detectors firing the same bar at the same price (Turtle Soup → 2022
      // Model is the canonical pair) put their dots on top of each other, so the
      // second one is invisible AND unclickable. Nudge collisions sideways —
      // sideways, not vertically, because the y is the entry PRICE.
      const placed: Array<{ x: number; y: number }> = [];
      for (const p of playsRef.current) {
        const d0 = dots.get(p.id);
        if (!d0) continue;
        let dx = d0.x;
        for (let guard = 0; guard < 6; guard++) {
          if (!placed.some((q) => Math.hypot(dx - q.x, d0.y - q.y) < 12)) break;
          dx += 13;
        }
        placed.push({ x: dx, y: d0.y });
        dots.set(p.id, { x: dx, y: d0.y });
      }
      dotPosRef.current = dots;
      for (const p of playsRef.current) {
        const d = dots.get(p.id);
        if (!d) continue;
        const isOpen = openPlayRef.current?.id === p.id;
        const long = p.dir === "bull";
        const rgb = long ? PLAY_C.profit : PLAY_C.loss;
        const done = p.state !== "live";
        const a2 = done ? 0.5 : 1;

        ctx.save();
        ctx.globalAlpha = a2;
        if (p.state === "live" || isOpen) {          // halo on anything actionable
          ctx.beginPath(); ctx.arc(d.x, d.y, 9, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${rgb},0.16)`; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(d.x, d.y, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${rgb})`; ctx.fill();
        ctx.setLineDash([]);
        ctx.lineWidth = isOpen ? 2 : 1.5;
        ctx.strokeStyle = isOpen ? "rgba(255,255,255,0.95)" : `rgba(${rgb},0.95)`;
        ctx.stroke();
        ctx.setLineDash([]);
        // Direction arrow inside a filled dot; resolved plays swap it for ✓ / ✗.
        ctx.font = "700 8px Inter, system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "#08111a";
        ctx.fillText(done ? (p.state === "won" ? "✓" : "✕") : long ? "▲" : "▼", d.x, d.y + 0.5);
        ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
        ctx.restore();

        // Hover region for the dot → the concept card + this play's numbers.
        const st = p.state === "live" ? "LIVE"
          : p.state === "won" ? `WON ${p.mfeR.toFixed(1)}R` : "STOPPED";
        addRect(d.x - 9, d.y - 9, 18, 18, p.conceptId, `${p.label} — entry`,
          `${playSide(p.dir)} ${p.entry.toFixed(2)} · SL ${p.stop.toFixed(2)} · TP ${p.targets[p.targets.length - 1].toFixed(2)} (${playRR(p).toFixed(1)}R) · ${st}${isOpen ? "" : " · click to open"}`);
      }
    } else {
      dotPosRef.current = new Map();
    }
  };

  /** Header chip for a play box: "<concept · side · R:R>" + a state badge. */
  function pill(
    ctx: CanvasRenderingContext2D, x: number, y: number,
    text: string, badge: string, badgeColor: string, alpha: number,
  ) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = "700 10px Inter, system-ui, sans-serif";
    const tw = ctx.measureText(text).width;
    const bw = ctx.measureText(badge).width;
    const padX = 6, gap = 8, h = 16;
    const w = padX + tw + gap + bw + padX;
    // Keep the chip on-canvas: a play triggering on the live bar would otherwise
    // print its header past the right edge.
    const cw = (ctx.canvas.width / (window.devicePixelRatio || 1));
    const bx = Math.min(Math.max(0, x), Math.max(0, cw - w - 2));
    const by = Math.max(0, y - h);
    ctx.fillStyle = "rgba(8,12,18,0.88)";
    ctx.strokeStyle = `rgba(${C.play},0.45)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const r = 4;
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + w, by, bx + w, by + h, r);
    ctx.arcTo(bx + w, by + h, bx, by + h, r);
    ctx.arcTo(bx, by + h, bx, by, r);
    ctx.arcTo(bx, by, bx + w, by, r);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(text, bx + padX, by + 11);
    ctx.fillStyle = badgeColor;
    ctx.fillText(badge, bx + padX + tw + gap, by + 11);
    ctx.restore();
  }

  function label(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
    ctx.font = "600 10px Inter, system-ui, sans-serif";
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  // Re-draw overlay whenever analysis or toggles change.
  useEffect(() => { drawOverlayRef.current(); }, [ict, plays, openPlay, showFvg, showOb, showLiq, showStruct, showKz, showPd, showPlays]);

  // Nearest entry dot within grab range of the cursor (chart-local px).
  const hitDot = useCallback((mx: number, my: number) => {
    let best: { id: string; x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const [id, d] of dotPosRef.current) {
      const dist = Math.hypot(mx - d.x, my - d.y);
      if (dist <= 11 && dist < bestD) { bestD = dist; best = { id, x: d.x, y: d.y }; }
    }
    return best;
  }, []);

  // A play that ages off the chart takes its popup with it.
  useEffect(() => {
    if (openPlay && !plays.some((p) => p.id === openPlay.id)) setOpenPlay(null);
  }, [plays, openPlay]);

  const openPlayData = openPlay ? plays.find((p) => p.id === openPlay.id) ?? null : null;

  // Switching instrument swaps the whole candle set (different price range), so
  // force the chart to re-fit to the new feed on the next data push.
  useEffect(() => { didFitRef.current = false; lastFitDayRef.current = ""; }, [instrument]);

  const status = connected ? "live" : "offline";
  // Panel lists gaps still in play: any box with no endTs (live FVGs, and IFVGs
  // that haven't been invalidated yet). A box that ended (2nd pass-through, a
  // break, or an IFVG invalidation) drops off the panel.
  const liveFvg = ict.fvgs.filter((f) => f.endTs == null);
  const unsweptLiq = ict.liquidity.filter((l) => !l.swept);

  // Merge the new model detectors into one recent-events feed (newest first).
  const SIG_LABEL: Record<string, string> = {
    inducement: "Inducement", turtleSoup: "Turtle Soup", judas: "Judas Swing",
    breaker: "Breaker", cisd: "CISD", model2022: "2022 Model",
  };
  const modelSignals = [
    ...ict.inducement, ...ict.turtleSoup, ...ict.judas,
    ...ict.breakers, ...ict.cisd, ...ict.model2022,
  ].sort((a, b) => b.ts - a.ts).slice(0, 8);
  const po3Today = ict.po3.length ? ict.po3[ict.po3.length - 1] : null;

  // ── Per-concept "actionable NOW" status ─────────────────────────────────────
  // A card is LIVE only when there's a tradeable setup at the current time/price:
  //   • zone concepts (FVG, OB, IFVG, breaker, IRL/ERL, PD/OTE) → price is sitting
  //     in or within `NEAR` pts of an UNMITIGATED zone right now;
  //   • event concepts (inducement, turtle soup, judas, CISD, MSS/BOS, 2022) →
  //     fired within the last `RECENT_MS`;
  //   • time concepts (killzones, silver bullet, macros, PO3, CRT) → the window
  //     is open now / today's profile has a live leg.
  // Everything else shows a dim "idle" badge. `void clockTick` re-evaluates the
  // time-based checks on the 30s tick.
  void clockTick;
  const active = useMemo(() => {
    const NEAR = 3;                 // pts: "price at the level"
    const RECENT_MS = 30 * 60_000;  // a signal counts as live for 30 min
    const now = Date.now();
    const px = candles.length ? candles[candles.length - 1].close : null;
    const fresh = (ts: number) => now - ts <= RECENT_MS;
    // "Breaking candle + the next one": the timestamp of the 2nd-to-last 5m bar.
    // An event whose ts is >= this fired on one of the last two bars.
    const last2Cut = candles.length >= 2 ? candles[candles.length - 2].timestamp : (candles[0]?.timestamp ?? 0);
    const onLast2 = (ts: number) => ts >= last2Cut;
    const TOL = 1; // pts, level-pierce tolerance for the sweep check
    // True if the pool was first pierced (swept) on one of the last two bars.
    const sweptOnLast2 = (l: { side: "BSL" | "SSL"; price: number; ts: number }) => {
      const breakBar = candles.find((c) => c.timestamp > l.ts &&
        (l.side === "BSL" ? c.high > l.price + TOL : c.low < l.price - TOL));
      return !!breakBar && onLast2(breakBar.timestamp);
    };
    const inZone = (top: number, bottom: number) =>
      px != null && px >= bottom - NEAR && px <= top + NEAR;

    const kz = activeWindows(now);
    const hasKZ = kz.length > 0;
    const hasSilver = kz.some((w) => w.kind === "silver");
    const hasMacro = kz.some((w) => w.kind === "macro");

    const a: Record<string, boolean> = {
      // zone concepts
      fvg:    ict.fvgs.some((f) => !f.inverted && f.endTs == null && inZone(f.top, f.bottom)),
      ifvg:   ict.fvgs.some((f) => f.inverted && f.endTs == null && inZone(f.top, f.bottom)),
      // Live whenever the latest price is sitting inside ANY order-block zone.
      // (Don't gate on `mitigated`: an OB flips to mitigated the instant price
      //  re-enters it, which would suppress the very "price in zone" state we
      //  want to flag.)
      ob:     ict.orderBlocks.some((o) => !o.violated && inZone(o.top, o.bottom)),
      breaker: ict.breakers.some((s) => fresh(s.ts)),
      irlerl: ict.rangeLiquidity.internal.some((z) => inZone(z.top, z.bottom)),
      // Flash only on the candle that BREAKS (sweeps) the level and the next one.
      liquidity: ict.liquidity.some((l) => sweptOnLast2(l)),
      eqhl:   ict.liquidity.some((l) => l.count >= 2 && sweptOnLast2(l)),
      pd:     !!ict.range && px != null && px >= ict.range.low && px <= ict.range.high,
      ote:    !!ict.range && px != null && px >= Math.min(ict.range.ote.from, ict.range.ote.to) - NEAR
                                        && px <= Math.max(ict.range.ote.from, ict.range.ote.to) + NEAR,
      // event concepts (fired recently)
      displacement: ict.displacement.some((d) => fresh(d.endTs)),
      mss:    ict.structure.some((s) => s.kind === "MSS" && fresh(s.ts)),
      bos:    ict.structure.some((s) => s.kind === "BOS" && onLast2(s.ts)),
      choch:  ict.structure.some((s) => s.kind === "CHOCH" && fresh(s.ts)),
      idm:    ict.inducement.some((s) => fresh(s.ts)),
      turtle: ict.turtleSoup.some((s) => fresh(s.ts)),
      judas:  ict.judas.some((s) => fresh(s.ts)),
      cisd:   ict.cisd.some((s) => fresh(s.ts)),
      model2022: ict.model2022.some((s) => fresh(s.ts)),
      mmxm:   ict.cisd.some((s) => fresh(s.ts)) || ict.structure.some((s) => s.kind === "MSS" && fresh(s.ts)),
      // time concepts
      killzones: hasKZ,
      macros:    hasMacro,
      silver:    hasSilver,
      crt:       !!ict.crt && ict.crt.sweep != null,
      // Standing reads (always-on context) — never flash "live".
      po3:    false,
      bias:   false,
      htfbias: false,
    };
    return a;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ict, candles, clockTick, po3Today]);

  return (
    <div className="flex-1 overflow-y-auto text-white" style={{ minHeight: 0 }}>
    <style>{`
      @keyframes ictLivePulse {
        0%, 100% {
          opacity: 1;
          box-shadow: 0 0 10px 3px rgba(255,236,120,0.9), 0 0 22px 8px rgba(255,255,255,0.55);
        }
        50% {
          opacity: 0.3;
          box-shadow: 0 0 0 0 rgba(255,236,120,0);
        }
      }
      .ict-live-badge { animation: ictLivePulse 1.1s ease-in-out infinite; }
    `}</style>
    <div className="mx-auto w-full max-w-[1600px] px-3 py-4">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight">ICT</h1>
        {/* Instrument tab switcher: ES ⇄ NQU (same layout, own feed) */}
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
          {(["ES", "NQU"] as const).map((sym) => (
            <button key={sym} onClick={() => setInstrument(sym)}
              className="rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] transition"
              style={{
                color: instrument === sym ? "#219EBC" : "rgba(255,255,255,0.55)",
                background: instrument === sym ? "linear-gradient(180deg, rgba(33,158,188,.18), rgba(33,158,188,.05))" : "transparent",
                border: `1px solid ${instrument === sym ? "rgba(33,158,188,.4)" : "transparent"}`,
                boxShadow: instrument === sym ? "0 0 14px rgba(33,158,188,.22)" : "none",
              }}>
              {sym}
            </button>
          ))}
        </div>
        <button onClick={() => setLeaderboardOpen(true)}
          className="rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] transition"
          style={{
            color: "#22e08a",
            background: "linear-gradient(180deg, rgba(34,224,138,.16), rgba(34,224,138,.05))",
            border: "1px solid rgba(34,224,138,.35)",
          }}>
          🏆 Leaderboard
        </button>
        {leaderboardOpen && <ConceptLeaderboardModal onClose={() => setLeaderboardOpen(false)} />}
        <span className="text-[11px] uppercase tracking-[0.18em] text-white">Inner Circle Trader · live {instLabel} detection</span>
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${connected ? "text-emerald-300" : "text-white"}`}
          style={{ border: `1px solid ${connected ? "rgba(0,230,118,.4)" : "rgba(255,255,255,.18)"}`, background: connected ? "rgba(0,230,118,.08)" : "transparent" }}>
          ● {status}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <CopyshotBtn targetRef={captureRef} overlayRef={overlayRef} chartRef={chartRef} />
          <BoxDiscordBtn targetRef={captureRef} label={`ICT — live ${instLabel}`} />
        </div>
      </div>

      {/* captureRef wraps the chart AND the live panels so a copyshot grabs both */}
      <div ref={captureRef} className="grid grid-cols-1 gap-4 rounded-xl bg-[#080b10] p-1">
        {/* Chart + overlays */}
        <div className="self-start rounded-xl border border-white/10 [background:radial-gradient(circle_at_50%_0%,rgba(33,158,188,0.08)_0%,transparent_55%),#0b0f15] border-t-2 border-t-[#219EBC]/40 p-2">
          {/* Overlay toggles — toolbar-themed pill (blue→teal gradient border) */}
          <div
            className="mb-2"
            style={{
              borderRadius: 999,
              padding: 1.5,
              background: "linear-gradient(110deg, rgba(33,158,188,0.55), rgba(59,130,246,0.4) 35%, rgba(33,158,188,0.15) 60%, rgba(33,158,188,0.55))",
              boxShadow: "0 14px 34px -14px rgba(0,0,0,0.8), 0 0 18px -6px rgba(33,158,188,0.4)",
            }}
          >
          <div
            className="ict-toolbar flex flex-wrap items-center gap-1.5"
            style={{
              borderRadius: 998,
              padding: "8px 14px",
              background: "rgba(10,13,20,0.96)",
              backdropFilter: "blur(16px)",
            }}
          >
            {([
              ["▶ Plays", showPlays, setShowPlays, C.play],
              ["FVG", showFvg, setShowFvg, C.fvg], ["Order Blocks", showOb, setShowOb, C.ob],
              ["Liquidity", showLiq, setShowLiq, C.liq], ["Structure", showStruct, setShowStruct, C.struct],
              ["Kill Zones", showKz, setShowKz, "41,182,246"], ["Premium/Discount", showPd, setShowPd, "255,255,255"],
            ] as [string, boolean, (v: boolean) => void, string][]).map(([lbl, on, set, rgb]) => (
              <button key={lbl} onClick={() => set(!on)}
                className="rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] transition"
                style={{
                  color: on ? `rgb(${rgb})` : "rgba(255,255,255,0.55)",
                  background: on ? `linear-gradient(180deg, rgba(${rgb},.16), rgba(${rgb},.04))` : "rgba(255,255,255,0.04)",
                  border: `1px solid ${on ? `rgba(${rgb},.3)` : "rgba(255,255,255,0.10)"}`,
                  boxShadow: on ? `0 0 14px rgba(${rgb},.22)` : "none",
                }}>
                {lbl}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1">
              {([5, 15, 30, 60] as const).map((m) => (
                <button key={m} onClick={() => setTf(m)}
                  className="rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] transition"
                  style={{
                    color: tf === m ? "#219EBC" : "rgba(255,255,255,0.55)",
                    background: tf === m ? "linear-gradient(180deg, rgba(33,158,188,.16), rgba(33,158,188,.04))" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${tf === m ? "rgba(33,158,188,.3)" : "rgba(255,255,255,0.10)"}`,
                    boxShadow: tf === m ? "0 0 14px rgba(33,158,188,.22)" : "none",
                  }}>
                  {m === 60 ? "1h" : `${m}m`}
                </button>
              ))}
            </div>
            <button onClick={() => setHoverEnabled((v) => !v)}
              className="rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] transition"
              style={{
                color: hoverEnabled ? "#FB8501" : "rgba(255,255,255,0.55)",
                background: hoverEnabled ? "linear-gradient(180deg, rgba(251,133,1,.16), rgba(251,133,1,.04))" : "rgba(255,255,255,0.04)",
                border: `1px solid ${hoverEnabled ? "rgba(251,133,1,.3)" : "rgba(255,255,255,0.10)"}`,
                boxShadow: hoverEnabled ? "0 0 14px rgba(251,133,1,.22)" : "none",
              }}>
              Hover Info {hoverEnabled ? "On" : "Off"}
            </button>
          </div>
          </div>
          <div
            className="relative"
            style={{ height: "68vh", minHeight: 480, cursor: overDot ? "pointer" : undefined }}
            onMouseDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              pressRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const mx = e.clientX - rect.left, my = e.clientY - rect.top;
              // Panning the chart also fires a click — only treat it as one if the
              // pointer barely moved between press and release.
              const press = pressRef.current;
              pressRef.current = null;
              if (press && Math.hypot(mx - press.x, my - press.y) > 5) return;
              const hit = hitDot(mx, my);
              setOpenPlay((prev) => (hit ? (prev?.id === hit.id ? null : hit) : null));
            }}
            onMouseMove={(e) => {
              const rect0 = e.currentTarget.getBoundingClientRect();
              const overNow = !!hitDot(e.clientX - rect0.left, e.clientY - rect0.top);
              if (overNow !== overDot) setOverDot(overNow);
              if (!hoverEnabled) { if (hover) setHover(null); return; }
              const rect = rect0;
              const mx = e.clientX - rect.left, my = e.clientY - rect.top;
              let best: HitRegion | null = null, bestArea = Infinity;
              for (const h of hitsRef.current) {
                if (mx >= h.x && mx <= h.x + h.w && my >= h.y && my <= h.y + h.h) {
                  const area = h.w * h.h;
                  if (area < bestArea) { bestArea = area; best = h; }
                }
              }
              if (best) {
                const concept = CONCEPT_BY_ID[best.conceptId];
                if (concept) {
                  setHover({ x: mx, y: my, concept, detail: best.detail ? `${best.title} · ${best.detail}` : best.title });
                  return;
                }
              }
              setHover(null);
            }}
            onMouseLeave={() => { setHover(null); setOverDot(false); }}
          >
            <div ref={chartRef} className="absolute inset-0" />
            <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" />
            {hoverEnabled && hover && (
              <div
                className="pointer-events-none absolute z-20 w-[260px] rounded-lg border border-cyan-400/40 bg-[#0b0f15]/95 p-2.5 shadow-xl backdrop-blur"
                style={{
                  left: Math.min(hover.x + 14, 600 - 270),
                  top: Math.min(hover.y + 14, 560 - 140),
                }}
              >
                <div className="mb-1 flex items-center gap-2">
                  <ConceptIcon id={hover.concept.id} />
                  <span className="text-[13px] font-bold text-cyan-300">{hover.concept.name}</span>
                </div>
                {hover.detail && (
                  <div className="mb-1 font-mono text-[10px] text-white/70">{hover.detail}</div>
                )}
                <p className="text-[11px] leading-snug text-white/90">{hover.concept.body}</p>
              </div>
            )}
            {/* Clicked-dot popup: the long/short position stats for that play.
                The box itself is drawn on the canvas; this is the readable copy. */}
            {openPlay && openPlayData && (() => {
              const p = openPlayData;
              const cw = chartRef.current?.clientWidth ?? 900;
              const ch = chartRef.current?.clientHeight ?? 520;
              const long = p.dir === "bull";
              const CARD_W = 234, CARD_H = 212;
              // Keep the card OFF the box it describes. The box always runs from
              // the entry dot to the right edge, so the free horizontal space is
              // to the LEFT of the dot; and it occupies the 3R side of entry, so
              // the free vertical space is below a long / above a short. Anchoring
              // the card next to the dot (the first cut) buried the markup.
              const left = openPlay.x - CARD_W - 14 >= 8
                ? openPlay.x - CARD_W - 14
                : Math.max(8, Math.min(cw - CARD_W - 62, openPlay.x + 16));
              const top = long ? Math.max(8, ch - CARD_H - 8) : 8;
              const stateTxt = p.state === "live" ? "LIVE"
                : p.state === "won" ? `WON ${p.mfeR.toFixed(1)}R` : "STOPPED";
              const stateCol = p.state === "lost" ? "#ff6b6b" : "#22e08a";
              return (
                <div
                  className="absolute z-30 rounded-lg border bg-[#0b0f15]/97 p-2.5 shadow-xl backdrop-blur"
                  style={{ left, top, width: CARD_W, borderColor: `rgba(${long ? PLAY_C.profit : PLAY_C.loss},0.45)` }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-[13px] font-bold text-white">{p.label}</span>
                    <span className="font-mono text-[11px] font-bold" style={{ color: long ? "#30d158" : "#ff5b5b" }}>
                      {long ? "▲ LONG" : "▼ SHORT"}
                    </span>
                    <button
                      onClick={() => setOpenPlay(null)}
                      className="ml-auto text-[13px] leading-none text-white/45 hover:text-white"
                      aria-label="Close play"
                    >✕</button>
                  </div>
                  <div className={`mb-1.5 inline-block rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wider ${p.state === "live" ? "ict-live-badge" : ""}`}
                    style={{ color: stateCol, background: "rgba(255,255,255,.06)" }}>
                    {stateTxt}
                  </div>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
                    <span className="text-white/50">Entry</span>
                    <span className="text-right text-white">{p.entry.toFixed(2)}</span>
                    <span style={{ color: "#ff6b6b" }}>Stop</span>
                    <span className="text-right" style={{ color: "#ff6b6b" }}>
                      {p.stop.toFixed(2)} <span className="text-white/40">({p.risk.toFixed(2)} pts)</span>
                    </span>
                    {p.targets.map((tp, i) => (
                      <Fragment key={i}>
                        <span style={{ color: p.hitR > i ? "#22e08a" : "rgba(255,255,255,.5)" }}>{i + 1}R{p.hitR > i ? " ✓" : ""}</span>
                        <span className="text-right" style={{ color: p.hitR > i ? "#22e08a" : "rgba(255,255,255,.75)" }}>{tp.toFixed(2)}</span>
                      </Fragment>
                    ))}
                    <span className="text-white/50">R:R</span>
                    <span className="text-right text-white">{playRR(p).toFixed(1)} : 1</span>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-snug text-white/45">{p.note}</p>
                </div>
              );
            })()}
            {!candles.length && (
              <div className="absolute inset-0 grid place-items-center text-sm text-white">waiting for {instLabel} candles…</div>
            )}
          </div>
        </div>

        {/* Plays — the position-tool boxes drawn on the chart, in numbers.
            Mirrors the markup exactly: same entry / stop / 1R-2R-3R ladder. */}
        <div className="rounded-xl border border-white/10 [background:radial-gradient(circle_at_50%_0%,rgba(255,193,7,0.07)_0%,transparent_55%),#0b0f15] border-t-2 p-3"
          style={{ borderTopColor: `rgba(${C.play},0.45)` }}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: `rgb(${C.play})` }}>
              ▶ Plays
            </span>
            <span className="text-[11px] text-white/45">
live setups only · click the ▲/▼ entry dot on the chart (or a card below) to open the position box
            </span>
            <span className="ml-auto font-mono text-[11px] text-white/50">
              {plays.filter((p) => p.state === "live").length} live
            </span>
          </div>
          {plays.length ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {plays.map((p) => {
                const long = p.dir === "bull";
                const rr = playRR(p);
                const stateCol = p.state === "lost" ? "#ff6b6b" : "#22e08a";
                const stateTxt = p.state === "live" ? "LIVE"
                  : p.state === "won" ? `WON ${p.mfeR.toFixed(1)}R` : "STOPPED";
                const isOpen = openPlay?.id === p.id;
                return (
                  <div key={p.id}
                    onClick={() => {
                      // Same popup the chart dot opens, anchored to that dot.
                      const d = dotPosRef.current.get(p.id);
                      setOpenPlay((prev) => (prev?.id === p.id ? null : { id: p.id, x: d?.x ?? 40, y: d?.y ?? 40 }));
                    }}
                    className="cursor-pointer rounded-lg border p-2.5 transition hover:border-white/30"
                    style={{
                      borderColor: isOpen ? "rgba(255,255,255,.55)"
                        : p.state === "live" ? "rgba(34,224,138,.35)" : `rgba(${C.play},.25)`,
                      background: isOpen ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
                      opacity: p.state === "won" || p.state === "lost" ? 0.68 : 1,
                    }}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-[13px] font-bold text-white">{p.label}</span>
                      <span className="font-mono text-[11px] font-bold" style={{ color: long ? "#30d158" : "#ff5b5b" }}>
                        {long ? "↑ LONG" : "↓ SHORT"}
                      </span>
                      <span className={`ml-auto rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wider ${p.state === "live" ? "ict-live-badge" : ""}`}
                        style={{ color: stateCol, background: "rgba(255,255,255,.06)" }}>
                        {stateTxt}
                      </span>
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
                      <span className="text-white/50">Entry</span>
                      <span className="text-right text-white">{p.entry.toFixed(2)}</span>
                      <span style={{ color: "#ff6b6b" }}>Stop</span>
                      <span className="text-right" style={{ color: "#ff6b6b" }}>{p.stop.toFixed(2)} <span className="text-white/40">({p.risk.toFixed(2)} pts)</span></span>
                      {p.targets.map((tp, i) => (
                        <Fragment key={i}>
                          <span style={{ color: p.hitR > i ? "#22e08a" : "rgba(255,255,255,.5)" }}>
                            {i + 1}R{p.hitR > i ? " ✓" : ""}
                          </span>
                          <span className="text-right" style={{ color: p.hitR > i ? "#22e08a" : "rgba(255,255,255,.75)" }}>
                            {tp.toFixed(2)}
                          </span>
                        </Fragment>
                      ))}
                      <span className="text-white/50">R:R</span>
                      <span className="text-right text-white">{rr.toFixed(1)} : 1</span>
                    </div>
                    <p className="mt-1.5 truncate text-[10px] text-white/45" title={p.note}>{p.note}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-white/50">
              No play live right now. A dot appears on the chart the moment a model setup
              (Turtle Soup, Judas, CISD, 2022 Model, Breaker, Inducement, OB retest, OTE) actually fires.
            </p>
          )}
        </div>

        {/* Live signal panel — all tiles in one full-width row below the chart */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Panel title="Daily Bias">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold" style={{ color: ict.bias.dir === "bull" ? "#30d158" : ict.bias.dir === "bear" ? "#ff5b5b" : "#9fb3c8" }}>
                {ict.bias.dir.toUpperCase()}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-white">{ict.bias.reason}</p>
            {ict.bias.prevHigh != null && (
              <p className="mt-1 font-mono text-[11px] text-white">PDH {ict.bias.prevHigh.toFixed(2)} · PDL {ict.bias.prevLow!.toFixed(2)}</p>
            )}
          </Panel>

          <Panel title={`Active Windows (${liveWindows.length})`}>
            {liveWindows.length ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap gap-1">
                  {liveWindows.map((w) => (
                    <span key={w.id} className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ color: w.kind === "macro" ? "#c4b5fd" : w.kind === "silver" ? "#ffd54f" : "#7fd4ff", background: "rgba(255,255,255,.05)" }}>
                      {w.label}
                    </span>
                  ))}
                </div>
                {/* Time range(s) pinned at the bottom of the panel (ET). */}
                <div className="mt-0.5 border-t border-white/10 pt-1.5 font-mono text-[11px] text-white">
                  {liveWindows.map((w) => (
                    <div key={w.id} className="flex items-center justify-between">
                      <span className="text-white/70">{w.label}</span>
                      <span>{fmtMin(w.startMin)}–{fmtMin(w.endMin)} ET</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className="text-[11px] text-white">No ICT killzone / macro active right now (ET).</p>}
          </Panel>

          <Panel title="Open FVGs (5m)">
            {liveFvg.length ? (
              <ul className="space-y-1">
                {liveFvg.slice(-6).reverse().map((f, i) => (
                  <li key={i} className="flex items-center justify-between font-mono text-[11px]">
                    <span style={{ color: f.inverted ? "#ec4899" : "#29b6f6" }}>
                      {f.inverted ? "IFVG " : "FVG "}{f.activeDir === "bull" ? "↑" : "↓"}
                    </span>
                    <span className="text-white">{f.bottom.toFixed(2)}–{f.top.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px] text-white">No unmitigated FVGs.</p>}
          </Panel>

          <Panel title="Liquidity (unswept)">
            {unsweptLiq.length ? (
              <ul className="space-y-1">
                {unsweptLiq.slice(0, 6).map((p, i) => (
                  <li key={i} className="flex items-center justify-between font-mono text-[11px]">
                    <span style={{ color: "#ff9f43" }}>{p.side}{p.count > 1 ? ` ×${p.count}` : ""}</span>
                    <span className="text-white">{p.price.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px] text-white">No liquidity pools detected.</p>}
          </Panel>

          {ict.range && (
            <Panel title="Dealing Range">
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-white">
                <span>High</span><span className="text-right text-white/80">{ict.range.high.toFixed(2)}</span>
                <span>EQ (0.5)</span><span className="text-right text-white/80">{ict.range.eq.toFixed(2)}</span>
                <span>Low</span><span className="text-right text-white/80">{ict.range.low.toFixed(2)}</span>
                <span className="text-[#c4b5fd]">OTE</span><span className="text-right text-[#c4b5fd]">{ict.range.ote.to.toFixed(2)}–{ict.range.ote.from.toFixed(2)}</span>
              </div>
            </Panel>
          )}

          <Panel title="Models & Signals">
            {modelSignals.length ? (
              <ul className="space-y-1">
                {modelSignals.map((s, i) => (
                  <li key={i} className="flex items-center justify-between font-mono text-[11px]">
                    <span style={{ color: s.dir === "bull" ? "#30d158" : "#ff5b5b" }}>
                      {SIG_LABEL[s.kind] ?? s.kind} {s.dir === "bull" ? "↑" : "↓"}
                    </span>
                    <span className="text-white">{s.price.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px] text-white">No model signals yet.</p>}
          </Panel>

          {po3Today && (
            <Panel title="Power of 3 (today)">
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-white">
                <span>Asia range</span><span className="text-right text-white/80">{po3Today.accLow.toFixed(2)}–{po3Today.accHigh.toFixed(2)}</span>
                <span>Manipulation</span>
                <span className="text-right" style={{ color: po3Today.manipDir === "bull" ? "#30d158" : po3Today.manipDir === "bear" ? "#ff5b5b" : "#9fb3c8" }}>
                  {po3Today.manipExtreme != null ? `${po3Today.manipDir === "bull" ? "↑" : "↓"} ${po3Today.manipExtreme.toFixed(2)}` : "—"}
                </span>
                <span>Distribution</span>
                <span className="text-right" style={{ color: po3Today.distDir === "bull" ? "#30d158" : po3Today.distDir === "bear" ? "#ff5b5b" : "#9fb3c8" }}>
                  {po3Today.distDir ? (po3Today.distDir === "bull" ? "↑ up" : "↓ down") : "—"}
                </span>
              </div>
            </Panel>
          )}

          {ict.crt && (
            <Panel title="CRT (prior hour)">
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-white">
                <span>Range</span><span className="text-right text-white/80">{ict.crt.lo.toFixed(2)}–{ict.crt.hi.toFixed(2)}</span>
                <span>EQ</span><span className="text-right text-white/80">{ict.crt.eq.toFixed(2)}</span>
                <span>Swept</span>
                <span className="text-right" style={{ color: ict.crt.sweep === "bull" ? "#30d158" : ict.crt.sweep === "bear" ? "#ff5b5b" : "#9fb3c8" }}>
                  {ict.crt.sweep ? (ict.crt.sweep === "bull" ? "↑ high" : "↓ low") : "none yet"}
                </span>
              </div>
            </Panel>
          )}
        </div>

        {/* HTF Fair Value Gaps — daily / weekly / monthly, own data feed */}
        <HtfFvgCard instrument={instrument} lastPrice={candles.length ? candles[candles.length - 1].close : null} />
      </div>

      {/* Glossary */}
      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-white">ICT Concepts</h2>
          <span className="text-[11px] text-white/40">
            {CONCEPTS.length - hiddenCards.size} of {CONCEPTS.length} shown
          </span>
          <button
            onClick={() => setManageOpen((v) => !v)}
            className="ml-auto rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition"
            style={{ color: manageOpen ? "#7fd4ff" : "#fff",
              background: manageOpen ? "rgba(41,182,246,.16)" : "transparent",
              border: `1px solid ${manageOpen ? "rgba(41,182,246,.7)" : "rgba(255,255,255,.3)"}` }}>
            {manageOpen ? "Done" : "⚙ Manage cards"}
          </button>
        </div>

        {/* Card manager — show/hide each concept; persists per-user */}
        {manageOpen && (
          <div className="mb-4 rounded-xl border border-cyan-400/30 [background:radial-gradient(circle_at_50%_0%,rgba(33,158,188,0.08)_0%,transparent_55%),#0b0f15] border-t-2 border-t-[#219EBC]/40 p-3">
            <div className="mb-2 flex items-center gap-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">Manage cards</span>
              <span className="text-[10px] text-white/40">
                {prefsLoaded ? "synced to your account" : "loading…"}
              </span>
              <div className="ml-auto flex gap-2">
                <button onClick={showAllCards} className="rounded border border-white/20 px-2 py-0.5 text-[10px] font-semibold text-white/80 hover:border-white/40">Show all</button>
                <button onClick={hideAllCards} className="rounded border border-white/20 px-2 py-0.5 text-[10px] font-semibold text-white/80 hover:border-white/40">Hide all</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
              {CONCEPTS.map((c) => {
                const shown = !hiddenCards.has(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleCardVisible(c.id)}
                    className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-[11px] transition"
                    style={{
                      borderColor: shown ? "rgba(41,182,246,.5)" : "rgba(255,255,255,.12)",
                      background: shown ? "rgba(41,182,246,.08)" : "transparent",
                      opacity: shown ? 1 : 0.55,
                    }}>
                    <span className="grid h-4 w-4 shrink-0 place-items-center rounded-sm text-[10px] font-bold"
                      style={{ background: shown ? "#29b6f6" : "transparent", border: `1px solid ${shown ? "#29b6f6" : "rgba(255,255,255,.3)"}`, color: "#041016" }}>
                      {shown ? "✓" : ""}
                    </span>
                    <span className="truncate font-semibold text-white/90">{c.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {CONCEPTS.filter((c) => !hiddenCards.has(c.id))
            .map((c, i) => ({ c, i }))
            .sort((a, b) => (Number(!!active[b.c.id]) - Number(!!active[a.c.id])) || (a.i - b.i))
            .map(({ c }) => {
            const isOpen = !!expanded[c.id];
            const liveBadge = c.live && (active[c.id]
              ? <span className="ict-live-badge rounded bg-emerald-500/20 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-emerald-300">live</span>
              : <span className="rounded bg-white/5 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-white/35">idle</span>);
            return (
              <div
                key={c.id}
                onClick={() => toggleCard(c.id)}
                className="cursor-pointer rounded-xl border border-white/10 [background:radial-gradient(circle_at_50%_0%,rgba(33,158,188,0.08)_0%,transparent_55%),#0b0f15] border-t-2 border-t-[#219EBC]/40 p-3 transition hover:border-white/25"
              >
                {isOpen ? (
                  <>
                    <div className="mb-1.5 flex items-start gap-2.5">
                      <ConceptIcon id={c.id} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[16px] font-bold text-cyan-300">{c.name}</span>
                          {liveBadge}
                          <span className="ml-auto text-[12px] text-white/40">▾</span>
                        </div>
                      </div>
                    </div>
                    <p className="text-[15px] leading-relaxed text-white">{highlightTerms(c.body)}</p>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-1 text-center">
                    <ConceptIcon id={c.id} size={2.1} />
                    <div className="flex items-center gap-2">
                      <span className="text-[16px] font-bold text-cyan-300">{c.name}</span>
                      {liveBadge}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {CONCEPTS.length - hiddenCards.size === 0 && (
          <div className="rounded-xl border border-white/10 [background:radial-gradient(circle_at_50%_0%,rgba(33,158,188,0.08)_0%,transparent_55%),#0b0f15] border-t-2 border-t-[#219EBC]/40 p-5 text-center text-[12px] text-white/50">
            All concept cards are hidden. Use <span className="text-cyan-300">⚙ Manage cards</span> to bring them back.
          </div>
        )}
        <p className="mt-3 text-[11px] text-white">
          Concept definitions adapted from{" "}
          <a href="https://innercircletrader.net/tutorials/most-important-ict-concepts-to-conquer-market-complete-list/" target="_blank" rel="noopener noreferrer" className="underline hover:text-cyan-300">
            innercircletrader.net — Most Important ICT Concepts
          </a>. Live detection runs on the dashboard&apos;s 5-min {instLabel} futures feed.
        </p>
      </div>
    </div>
    </div>
  );
}

/**
 * Labeled "Copyshot" button — screenshots the target element (chart + live
 * panels) and writes a PNG to the clipboard.
 *
 * This used to lazy-load html2canvas and hand-composite the live chart and
 * overlay canvases itself. lib/snapshot.ts now does that for every canvas in the
 * captured subtree, so overlayRef/chartRef are no longer needed to locate them —
 * they stay in the prop type only so the call site doesn't have to change.
 */
function CopyshotBtn({ targetRef }: {
  targetRef: RefObject<HTMLElement | null>;
  overlayRef?: RefObject<HTMLCanvasElement | null>;
  chartRef?: RefObject<HTMLDivElement | null>;
}) {
  const [s, set] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const run = useCallback(async () => {
    if (s === "busy" || !targetRef.current) return;
    set("busy");
    try {
      await captureAndCopy(targetRef.current, "ict-copyshot.png");
      set("ok");
    } catch (e) {
      console.error("[CopyshotBtn]", e);
      set("err");
    }
    finally { setTimeout(() => set("idle"), 1800); }
  }, [s, targetRef]);

  const color = s === "ok" ? "#00e676" : s === "err" ? "#ef4444" : "#a78bfa";
  const text = s === "busy" ? "Copying…" : s === "ok" ? "✓ Copied" : s === "err" ? "✕ Failed" : "📸 Copyshot";
  return (
    <button onClick={run} disabled={s === "busy"} title="Copy chart + live panels to clipboard"
      className="rounded px-2 py-1 text-[11px] font-semibold transition"
      style={{ color, border: `1px solid ${color}40`, background: "rgba(255,255,255,.04)" }}>
      {text}
    </button>
  );
}

/** Minutes-since-ET-midnight → "HH:MM" (24h). */
function fmtMin(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Glossary keyword → concept color, matching the chart overlays (C). Each group
// shares one color. Longer phrases are listed first so they match before their
// sub-words (e.g. "liquidity sweep" before "liquidity").
const TERM_GROUPS: { rgb: string; terms: string[] }[] = [
  { rgb: C.ifvg,   terms: ["Inversion Fair Value Gap", "Inverse Fair Value Gap", "Inversion", "Inverse", "IFVG"] },
  { rgb: C.fvg,    terms: ["Fair Value Gap", "imbalance", "FVG", "OTE", "premium", "discount", "equilibrium"] },
  { rgb: C.ob,     terms: ["Order Block", "Breaker Block", "demand", "supply", "support", "resistance"] },
  { rgb: C.liq,    terms: ["buy-side liquidity", "sell-side liquidity", "liquidity sweep", "liquidity pool", "BSL", "SSL", "liquidity", "inducement"] },
  { rgb: C.struct, terms: ["Break of Structure", "Change of Character", "Market Structure Shift", "market structure", "displacement", "BOS", "CHOCH", "MSS"] },
];
// Flat lookup term→rgb + a single alternation regex (longest terms first overall).
const TERM_COLOR = new Map<string, string>();
for (const g of TERM_GROUPS) for (const t of g.terms) TERM_COLOR.set(t.toLowerCase(), g.rgb);
const ALL_TERMS = [...TERM_COLOR.keys()].sort((a, b) => b.length - a.length);
const TERM_RE = new RegExp(`(${ALL_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");

/** Wrap recognized ICT terms in a span colored by their concept group. */
function highlightTerms(body: string): React.ReactNode[] {
  const parts = body.split(TERM_RE);
  return parts.map((p, i) => {
    if (i % 2 === 0) return <span key={i}>{p}</span>;
    const rgb = TERM_COLOR.get(p.toLowerCase()) ?? "255,255,255";
    return <span key={i} className="font-semibold" style={{ color: `rgb(${rgb})` }}>{p}</span>;
  });
}

// ── Concept thumbnail diagrams ───────────────────────────────────────────────
// Tiny schematic SVGs (48×40) illustrating each pattern, colored to match the
// chart overlays. Reusable candle + zone primitives keep them compact.
const GREEN = "#30d158", RED = "#ff5b5b", BLUE = "#219EBC", ORANGE = "#FB8501",
      PURPLE = "#126783", PINK = "#ec4899";
function Candle({ x, o, c, hi, lo, up }: { x: number; o: number; c: number; hi: number; lo: number; up: boolean }) {
  const col = up ? GREEN : RED;
  const top = Math.min(o, c), h = Math.max(2, Math.abs(o - c));
  return (
    <g>
      <line x1={x + 3} y1={hi} x2={x + 3} y2={lo} stroke={col} strokeWidth={1} />
      <rect x={x} y={top} width={6} height={h} fill={col} />
    </g>
  );
}
function IconFrame({ children, size = 1 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={48 * size} height={40 * size} viewBox="0 0 48 40" className="shrink-0 rounded-md" style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" }}>
      {children}
    </svg>
  );
}
function ConceptIcon({ id, size = 1 }: { id: string; size?: number }) {
  // Map each concept to the closest schematic; several share a diagram.
  switch (id) {
    case "fvg": case "irlerl": // 3-candle gap, middle void highlighted
      return <IconFrame size={size}><rect x={6} y={16} width={36} height={9} fill={`${BLUE}33`} /><Candle x={6} o={28} c={20} hi={32} lo={18} up />
        <Candle x={20} o={18} c={10} hi={20} lo={8} up /><Candle x={34} o={14} c={22} hi={26} lo={12} up={false} /></IconFrame>;
    case "ifvg": // gap broken & flipped
      return <IconFrame size={size}><rect x={6} y={14} width={36} height={9} fill={`${PINK}33`} /><Candle x={6} o={14} c={22} hi={26} lo={12} up={false} />
        <Candle x={20} o={24} c={32} hi={34} lo={22} up={false} /><Candle x={34} o={30} c={20} hi={32} lo={18} up /></IconFrame>;
    case "ob": case "breaker": // down candle then strong up impulse, OB zone boxed
      return <IconFrame size={size}><rect x={6} y={22} width={8} height={10} fill={`${GREEN}40`} stroke={GREEN} /><Candle x={6} o={24} c={30} hi={32} lo={22} up={false} />
        <Candle x={20} o={28} c={14} hi={30} lo={12} up /><Candle x={34} o={14} c={6} hi={8} lo={12} up /></IconFrame>;
    case "liquidity": case "eqhl": // equal highs with a sweep line above
      return <IconFrame size={size}><line x1={4} y1={12} x2={44} y2={12} stroke={ORANGE} strokeDasharray="3 2" /><Candle x={8} o={20} c={16} hi={12} lo={24} up />
        <Candle x={22} o={18} c={14} hi={12} lo={22} up /><Candle x={34} o={14} c={20} hi={8} lo={24} up={false} /></IconFrame>;
    case "mss": case "bos": case "choch": case "cisd": case "displacement": case "mmxm": case "model2022": // structure break line
      return <IconFrame size={size}><line x1={4} y1={16} x2={44} y2={16} stroke={PURPLE} strokeDasharray="3 2" /><Candle x={6} o={26} c={20} hi={30} lo={18} up />
        <Candle x={20} o={22} c={26} hi={30} lo={20} up={false} /><Candle x={34} o={22} c={8} hi={24} lo={6} up /></IconFrame>;
    case "pd": case "ote": case "bias": case "htfbias": // premium/discount split at EQ
      return <IconFrame size={size}><rect x={4} y={6} width={40} height={14} fill={`${RED}22`} /><rect x={4} y={20} width={40} height={14} fill={`${GREEN}22`} />
        <line x1={4} y1={20} x2={44} y2={20} stroke="#fff" strokeOpacity={0.4} strokeDasharray="3 2" /><circle cx={24} cy={28} r={2.5} fill={GREEN} /></IconFrame>;
    case "killzones": case "macros": case "silver": case "judas": case "po3": // time window band
      return <IconFrame size={size}><rect x={16} y={4} width={16} height={32} fill={`${BLUE}1f`} /><Candle x={6} o={22} c={18} hi={26} lo={16} up />
        <Candle x={20} o={20} c={10} hi={22} lo={8} up /><Candle x={34} o={12} c={18} hi={24} lo={10} up={false} /></IconFrame>;
    case "idm": case "turtle": case "crt": // sweep then reversal
      return <IconFrame size={size}><line x1={4} y1={10} x2={44} y2={10} stroke={ORANGE} strokeDasharray="3 2" /><Candle x={10} o={24} c={18} hi={28} lo={16} up />
        <Candle x={24} o={16} c={22} hi={6} lo={26} up={false} /><Candle x={36} o={22} c={28} hi={30} lo={20} up={false} /></IconFrame>;
    default:
      return <IconFrame size={size}><Candle x={8} o={24} c={16} hi={28} lo={14} up /><Candle x={22} o={18} c={24} hi={28} lo={16} up={false} />
        <Candle x={36} o={20} c={12} hi={24} lo={10} up /></IconFrame>;
  }
}

// ── HTF Fair Value Gaps (daily / weekly / monthly) ───────────────────────────
// Separate data feed from the live 5m chart: HTF gaps need months of history, so
// this pulls aggregated OHLC straight from the dxLink history proxy
// (/api/dxlink/candles) using the {=d}/{=w}/{=mo} streamer suffixes. A 3-candle
// gap is unmitigated until a later bar trades fully back through it.
type HtfBar = { time: number; open: number; high: number; low: number; close: number };
type HtfGap = { dir: "bull" | "bear"; top: number; bottom: number; time: number; touched: boolean };

function parseHtfBars(json: unknown): HtfBar[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = json as any;
  const items: unknown[] = j?.data?.items || j?.data?.candles || j?.candles || [];
  return items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((it: any) => {
      const rawT = it.time ?? it.datetime ?? it.timestamp ?? it.startsAt ?? it.date;
      const time = typeof rawT === "number" ? rawT : typeof rawT === "string" ? Date.parse(rawT) : NaN;
      return { time, open: Number(it.open), high: Number(it.high), low: Number(it.low), close: Number(it.close) };
    })
    .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.high) && Number.isFinite(b.low) && b.close > 0)
    .sort((a, b) => a.time - b.time);
}

// Unmitigated 3-candle FVGs, newest first. A gap ends the moment a later bar
// closes fully through it (bull → a low ≤ bottom; bear → a high ≥ top).
function detectHtfGaps(bars: HtfBar[]): HtfGap[] {
  const out: HtfGap[] = [];
  for (let i = 1; i < bars.length - 1; i++) {
    const a = bars[i - 1], c = bars[i + 1];
    let g: HtfGap | null = null;
    if (c.low > a.high) g = { dir: "bull", top: c.low, bottom: a.high, time: bars[i].time, touched: false };
    else if (a.low > c.high) g = { dir: "bear", top: a.low, bottom: c.high, time: bars[i].time, touched: false };
    if (!g) continue;
    let filled = false;
    for (let k = i + 2; k < bars.length; k++) {
      if (g.dir === "bull") { if (bars[k].low <= g.bottom) { filled = true; break; } if (bars[k].low <= g.top) g.touched = true; }
      else { if (bars[k].high >= g.top) { filled = true; break; } if (bars[k].high >= g.bottom) g.touched = true; }
    }
    if (!filled) out.push(g);
  }
  return out.sort((a, b) => b.time - a.time);
}

function HtfFvgCard({ instrument, lastPrice }: { instrument: "ES" | "NQU"; lastPrice: number | null }) {
  const base = instrument === "NQU" ? "/NQ" : "/ESU6";
  const TFS = useMemo(() => ([
    { key: "Daily", sfx: "{=d}", iv: "1Day" },
    { key: "Weekly", sfx: "{=w}", iv: "1Week" },
    { key: "Monthly", sfx: "{=mo}", iv: "1Month" },
  ] as const), []);
  const [gaps, setGaps] = useState<Record<string, HtfGap[]>>({});
  const [state, setState] = useState<"loading" | "ok" | "err">("loading");

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    setState("loading");
    (async () => {
      try {
        const entries = await Promise.all(TFS.map(async (tf) => {
          const url = `/api/dxlink/candles?symbol=${encodeURIComponent(base + tf.sfx)}&interval=${tf.iv}`;
          const r = await fetch(url, { cache: "no-store", signal: ac.signal });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return [tf.key, detectHtfGaps(parseHtfBars(await r.json()))] as const;
        }));
        if (alive) { setGaps(Object.fromEntries(entries)); setState("ok"); }
      } catch { if (alive) setState("err"); }
    })();
    return () => { alive = false; ac.abort(); };
  }, [base, TFS]);

  return (
    <div className="rounded-xl border border-white/10 [background:radial-gradient(circle_at_50%_0%,rgba(33,158,188,0.08)_0%,transparent_55%),#0b0f15] border-t-2 border-t-[#219EBC]/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-300">HTF Fair Value Gaps</span>
        <span className="text-[10px] text-white/40">{instrument === "NQU" ? "NQ" : "ES"} · unmitigated · newest first</span>
        {state === "loading" && <span className="ml-auto text-[10px] text-white/40">loading…</span>}
        {state === "err" && <span className="ml-auto text-[10px] text-[#ff6b6b]">feed unavailable</span>}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {TFS.map((tf) => {
          const list = (gaps[tf.key] ?? []).slice(0, 6);
          return (
            <div key={tf.key} className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">{tf.key}</div>
              {state === "ok" && list.length === 0 ? (
                <p className="text-[11px] text-white/50">No open gaps.</p>
              ) : (
                <ul className="space-y-1">
                  {list.map((g, i) => {
                    const inZone = lastPrice != null && lastPrice >= g.bottom && lastPrice <= g.top;
                    return (
                      <li key={i} className="flex items-center justify-between font-mono text-[11px]">
                        <span style={{ color: g.dir === "bull" ? "#30d158" : "#ff5b5b" }}>
                          {g.dir === "bull" ? "↑ FVG" : "↓ FVG"}{g.touched ? "*" : ""}
                        </span>
                        <span className="text-white" style={inZone ? { color: "#7fd4ff", fontWeight: 700 } : undefined}>
                          {g.bottom.toFixed(2)}–{g.top.toFixed(2)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-white/35">* = price has tapped the gap (partial mitigation). Blue = price inside the gap now.</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 [background:radial-gradient(circle_at_50%_0%,rgba(33,158,188,0.08)_0%,transparent_55%),#0b0f15] border-t-2 border-t-[#219EBC]/40 px-2.5 py-2">
      <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-cyan-300">{title}</div>
      {children}
    </div>
  );
}
