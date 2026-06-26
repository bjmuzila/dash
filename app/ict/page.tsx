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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, createChart,
} from "lightweight-charts";
import type { UTCTimestamp, IChartApi, ISeriesApi, CandlestickData } from "lightweight-charts";
import { useEsCandles } from "@/hooks/useEsCandles";
import { BoxDiscordBtn } from "@/components/shared/DataBox";
import {
  analyzeICT, activeWindows, ICT_WINDOWS, etMinutes,
  type IctCandle, type IctAnalysis, type TimeWindow,
} from "@/lib/calculations/ictConcepts";

function toChartTime(ts: number): UTCTimestamp {
  return Math.floor(ts / 1000) as UTCTimestamp;
}

// ── Glossary content (innercircletrader.net "Most Important ICT Concepts") ────
type Concept = { id: string; name: string; live?: boolean; body: string; href: string };
const CONCEPTS: Concept[] = [
  { id: "liquidity", name: "Liquidity", live: true, href: "https://innercircletrader.net/tutorials/liquidity-in-forex-trading/",
    body: "Resting stop-loss and pending orders. Buy-side liquidity (BSL) sits above swing highs / equal highs; sell-side liquidity (SSL) below swing lows / equal lows. Smart money sweeps these pools before reversing." },
  { id: "fvg", name: "Imbalance / Fair Value Gap (FVG)", live: true, href: "https://innercircletrader.net/tutorials/fair-value-gap-trading-strategy/",
    body: "A three-candle imbalance: a gap between candle 1 and candle 3 left by aggressive delivery. Price often returns to the FVG for fair value, where it acts as support/resistance until mitigated." },
  { id: "displacement", name: "Displacement", live: true, href: "https://innercircletrader.net/tutorials/ict-displacement-move/",
    body: "A strong, high-momentum move of large-bodied candles leaving FVGs behind. Displacement validates structure breaks and the order blocks inside the leg." },
  { id: "mss", name: "Market Structure Shift (MSS)", live: true, href: "https://innercircletrader.net/tutorials/ict-market-structure-shift/",
    body: "The initial change of direction that can lead to a reversal — a counter-trend swing break confirmed by displacement. Used as a lower-timeframe entry trigger." },
  { id: "bos", name: "Break of Structure (BOS)", live: true, href: "https://innercircletrader.net/tutorials/break-of-structure-bos/",
    body: "A clean break of the prior swing in the SAME direction as the trend — confirmation the leg is continuing." },
  { id: "choch", name: "Change of Character (CHOCH)", live: true, href: "https://innercircletrader.net/tutorials/change-of-character-choch-in-trading/",
    body: "The first break of the most recent counter-trend swing — the earliest sign the trend is reversing." },
  { id: "ob", name: "Order Block", live: true, href: "https://innercircletrader.net/tutorials/ict-order-block/",
    body: "The last opposing candle before an impulse: bullish OB = last down candle before an up move; bearish OB = last up candle before a down move. A re-entry / defense zone." },
  { id: "idm", name: "Inducement (IDM)", live: true, href: "https://innercircletrader.net/tutorials/what-is-inducement-in-forex/",
    body: "A trap level that lures FOMO retail traders in early. Price typically sweeps the inducement before delivering the real directional move." },
  { id: "bias", name: "Daily Bias", live: true, href: "https://innercircletrader.net/tutorials/ict-daily-bias-trick/",
    body: "The anticipated direction for the day. Derived here from price vs the prior-day midpoint and session displacement (draw on PDH/BSL vs PDL/SSL)." },
  { id: "pd", name: "Premium & Discount Zones", live: true, href: "https://innercircletrader.net/tutorials/ict-premium-and-discount-zone-identification/",
    body: "Fibonacci from swing high↔low. Above 0.50 = premium (sellers' zone); below 0.50 = discount (buyers' zone). Equilibrium is the 0.50 line." },
  { id: "ote", name: "Optimal Trade Entry (OTE)", live: true, href: "https://innercircletrader.net/tutorials/ict-optimal-trade-entry/",
    body: "The 62%–79% retracement band of the most recent impulse leg — where smart money typically delivers the real move after the sweep." },
  { id: "po3", name: "Power of 3 (PO3 / AMD)", live: true, href: "https://innercircletrader.net/tutorials/ict-power-of-3-po3/",
    body: "The daily delivery template: Accumulation (Asia), Manipulation (London), Distribution (New York)." },
  { id: "silver", name: "Silver Bullet", live: true, href: "https://innercircletrader.net/tutorials/ict-silver-bullet-strategy/",
    body: "A one-hour high-probability window (10:00–11:00 NY) where price delivers an FVG entry in the direction of the daily bias." },
  { id: "killzones", name: "Killzones", live: true, href: "https://innercircletrader.net/tutorials/master-ict-kill-zones/",
    body: "Time windows where institutional volume concentrates: Asian, London, NY AM and NY PM killzones. Highest-probability setups occur inside them." },
  { id: "macros", name: "ICT Macros", live: true, href: "https://innercircletrader.net/tutorials/ict-macro-time-based-strategy/",
    body: "20-minute high-conviction windows inside each killzone (e.g. 09:50 NY-AM, 13:10 NY-PM) where algorithmic delivery is most concentrated." },
  { id: "smt", name: "SMT Divergence", href: "https://innercircletrader.net/tutorials/ict-smart-money-tool-smt-divergence/",
    body: "Disagreement between two correlated instruments at a key level (one makes a higher high, the other doesn't) — confirms smart money rejecting the level. Not auto-detected: needs a 2nd correlated feed (NQ) which this page doesn't carry yet." },
  { id: "turtle", name: "Turtle Soup", live: true, href: "https://innercircletrader.net/tutorials/ict-turtle-soup-trading-strategy/",
    body: "A failure at relative equal highs/lows: price sweeps the level, fails to follow through, and reverses — a clean counter-breakout entry." },
  { id: "judas", name: "Judas Swing", live: true, href: "https://innercircletrader.net/tutorials/ict-judas-swing/",
    body: "The false move at the London open that fakes retail into the wrong direction before the real move — the manipulation phase of PO3." },
  { id: "irlerl", name: "IRL & ERL", live: true, href: "https://innercircletrader.net/tutorials/ict-internal-and-external-range-liquidity/",
    body: "Internal Range Liquidity = FVGs/order blocks inside the dealing range. External Range Liquidity = swing highs/lows outside it. Price oscillates between the two." },
  { id: "breaker", name: "Breaker Block", live: true, href: "https://innercircletrader.net/tutorials/ict-order-block/",
    body: "An order block that forms after a Break of Structure: price breaks the OB, then retests it from the other side and uses it as continuation support/resistance. The failed OB flips into a breaker." },
  { id: "ifvg", name: "Inverse / Inversion FVG (IFVG)", live: true, href: "https://innercircletrader.net/tutorials/fair-value-gap-trading-strategy/",
    body: "An FVG that price VIOLATES — closes a candle BODY through (a wick poke isn't enough). The broken gap doesn't die; it inverts into a PD array in the opposite direction. Bullish IFVG: a bearish FVG closed above → flips to support/demand. Bearish IFVG: a bullish FVG closed below → flips to resistance/supply. Strongest with a liquidity sweep into the violation, in the right premium/discount zone, and aligned with HTF bias. Entry on the RETEST (often ~50% consequent encroachment), stop beyond the zone extreme, target the next liquidity / opposing PD array. On this page a spent FVG is only kept (as an IFVG, dashed box) when its break also swept liquidity; otherwise it's removed." },
  { id: "mmxm", name: "Market Maker Models (MMXM)", live: true, href: "https://innercircletrader.net/",
    body: "The market-maker buy/sell model: a staged narrative of Smart Money Reversal (SMR), re-accumulation/distribution and the original consolidation. Stage 2 (after the reversal, with liquidity + PD arrays aligned) is cited as the highest-probability leg. Detected here via its components — the SMR shows up as a CISD / MSS after a liquidity sweep in the Models feed rather than as one labeled box." },
  { id: "model2022", name: "2022 Model / Cam's Model", live: true, href: "https://innercircletrader.net/",
    body: "A simplified high-probability template: liquidity sweep (Turtle Soup) → MSS → entry on the resulting FVG / IFVG in the direction of the break. One of the cleanest reversal/continuation recipes." },
  { id: "cisd", name: "CISD (Change in State of Delivery)", live: true, href: "https://innercircletrader.net/",
    body: "The shift that confirms a new delivery phase — price stops delivering in one direction (e.g. consecutive down closes) and the first opposing close through the prior range opens a new bullish/bearish state." },
  { id: "crt", name: "Candle Range Theory (CRT)", live: true, href: "https://innercircletrader.net/",
    body: "Range-based read of a single higher-timeframe candle: its high/low define the range, the body the equilibrium. Lower-timeframe price sweeps one extreme then delivers toward the other — a framing tool for highs/lows in the models." },
  { id: "eqhl", name: "Equal Highs / Equal Lows (EQH/EQL)", live: true, href: "https://innercircletrader.net/tutorials/liquidity-in-forex-trading/",
    body: "Relative-equal swing highs (EQH = buy-side liquidity) or lows (EQL = sell-side liquidity). These clusters are obvious stop pools that smart money engineers price toward and sweeps. Detected live as clustered liquidity (BSL/SSL ×N)." },
  { id: "htfbias", name: "HTF Bias + Draw on Liquidity", live: true, href: "https://innercircletrader.net/tutorials/ict-daily-bias-trick/",
    body: "The overarching framework: set higher-timeframe directional bias, then target the liquidity pool price is drawn toward (PDH/PDL, session H/L, EQH/EQL) using lower-timeframe FVG/OTE/MSS confluence. Often called ~80% of the edge." },
];

// One color per ICT concept (RGB triplets; alpha applied at draw time).
const C = {
  fvg:    "41,182,246",   // FVG       → blue
  ifvg:   "236,72,153",   // IFVG      → pink
  ob:     "48,209,88",    // Order Block → green
  liq:    "255,159,67",   // Liquidity → orange
  struct: "167,139,250",  // Structure (BOS/CHOCH/MSS) → purple
};

// Kill-zone band colors by kind.
const WIN_COLOR: Record<TimeWindow["kind"], string> = {
  killzone: "rgba(41,182,246,0.07)",
  silver:   "rgba(255,193,7,0.10)",
  macro:    "rgba(167,139,250,0.12)",
};

export default function IctPage() {
  const { sessionCandles, connected } = useEsCandles();
  const captureRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const didFitRef = useRef(false);
  const lastFitDayRef = useRef("");
  const drawOverlayRef = useRef<() => void>(() => {});
  const [clockTick, setClockTick] = useState(0);

  // Overlay toggles.
  const [showFvg, setShowFvg] = useState(true);
  const [showOb, setShowOb] = useState(true);
  const [showLiq, setShowLiq] = useState(true);
  const [showStruct, setShowStruct] = useState(true);
  const [showKz, setShowKz] = useState(true);
  const [showPd, setShowPd] = useState(true);

  // Tick every 30s so kill-zone "active" state + bias re-evaluate.
  useEffect(() => { const id = setInterval(() => setClockTick((n) => n + 1), 30_000); return () => clearInterval(id); }, []);

  const candles: IctCandle[] = useMemo(
    () => sessionCandles.map((c) => ({
      timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close,
      volume: c.volume, date: c.date,
    })),
    [sessionCandles]
  );

  const ict: IctAnalysis = useMemo(() => analyzeICT(candles), [candles]);
  const ictRef = useRef(ict); ictRef.current = ict;
  const togglesRef = useRef({ showFvg, showOb, showLiq, showStruct, showKz, showPd });
  togglesRef.current = { showFvg, showOb, showLiq, showStruct, showKz, showPd };

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
      timeScale: { borderColor: "rgba(255,255,255,.10)", timeVisible: true, secondsVisible: false },
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
        // discount shading (eq → low)
        ctx.fillStyle = "rgba(48,209,88,0.05)";
        ctx.fillRect(0, Math.min(yEq, yLo), W, Math.abs(yLo - yEq));
        // equilibrium line
        ctx.strokeStyle = "rgba(255,255,255,0.30)"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(0, yEq); ctx.lineTo(W, yEq); ctx.stroke();
        ctx.setLineDash([]);
        label(ctx, 6, yEq - 4, "EQ 0.5", "rgba(255,255,255,0.55)");
        // OTE band
        const yo1 = yOf(a.range.ote.from), yo2 = yOf(a.range.ote.to);
        if (yo1 != null && yo2 != null) {
          ctx.fillStyle = "rgba(167,139,250,0.16)";
          ctx.fillRect(0, Math.min(yo1, yo2), W, Math.abs(yo2 - yo1));
          label(ctx, 6, Math.min(yo1, yo2) + 11, "OTE 62–79%", "rgba(167,139,250,0.9)");
        }
      }
    }

    // FVG boxes. A box EXTENDS right only while it's live; once price passes
    // through it a 2nd time (or breaks it) the box ENDS at that candle (endTs)
    // instead of stretching to the live edge. An inverted IFVG keeps drawing
    // (flipped polarity) from its inversion point to the right edge.
    if (t.showFvg) {
      for (const f of a.fvgs) {
        const xStart = xOf(f.inverted && f.invertedTs ? f.invertedTs : f.ts);
        const yT = yOf(f.top), yB = yOf(f.bottom);
        if (xStart == null || yT == null || yB == null) continue;
        // Right edge of the box: endTs if the gap is done, else the live edge.
        // IFVGs ignore endTs (they live on past the break).
        const xEndRaw = !f.inverted && f.endTs != null ? xOf(f.endTs) : rightEdge;
        const xEnd = xEndRaw == null ? rightEdge : xEndRaw;
        const bull = f.activeDir === "bull";
        const x = Math.min(xStart, xEnd), y = Math.min(yT, yB);
        const w = Math.max(2, Math.abs(xEnd - xStart)), h = Math.abs(yB - yT);
        // FVG = BLUE, IFVG = PINK (one color per concept; direction via the ↑/↓
        // in the label, not the box color).
        const arrow = bull ? " ↑" : " ↓";
        if (f.inverted) {
          ctx.fillStyle = `rgba(${C.ifvg},0.18)`;
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = `rgba(${C.ifvg},0.95)`;
          ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
          ctx.strokeRect(x, y, w, h);
          ctx.setLineDash([]);
          label(ctx, x + 3, y + 11, "IFVG" + arrow, `rgba(${C.ifvg},1)`);
        } else {
          const done = f.endTs != null; // ended box reads fainter than a live one
          ctx.fillStyle = `rgba(${C.fvg},${done ? 0.08 : 0.16})`;
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = `rgba(${C.fvg},0.6)`;
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, w, h);
          label(ctx, x + 3, y + 11, "FVG" + arrow, `rgba(${C.fvg},0.95)`);
        }
      }
    }

    // Order blocks = GREEN.
    if (t.showOb) {
      for (const o of a.orderBlocks) {
        const x = xOf(o.ts), yT = yOf(o.top), yB = yOf(o.bottom);
        if (x == null || yT == null || yB == null) continue;
        ctx.strokeStyle = `rgba(${C.ob},0.9)`;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = o.mitigated ? 0.4 : 1;
        ctx.fillStyle = `rgba(${C.ob},0.10)`;
        ctx.fillRect(x, Math.min(yT, yB), Math.max(2, rightEdge - x), Math.abs(yB - yT));
        ctx.strokeRect(x, Math.min(yT, yB), Math.max(2, rightEdge - x), Math.abs(yB - yT));
        ctx.globalAlpha = 1;
        label(ctx, x + 3, Math.min(yT, yB) + 11, o.dir === "bull" ? "OB ↑" : "OB ↓", `rgba(${C.ob},0.95)`);
      }
    }

    // Liquidity pools = ORANGE.
    if (t.showLiq) {
      for (const p of a.liquidity.slice(0, 10)) {
        const y = yOf(p.price); const x = xOf(p.ts);
        if (y == null) continue;
        ctx.strokeStyle = p.swept ? "rgba(255,255,255,0.18)" : `rgba(${C.liq},0.8)`;
        ctx.lineWidth = 1; ctx.setLineDash(p.swept ? [2, 4] : []);
        ctx.beginPath(); ctx.moveTo(x ?? 0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.setLineDash([]);
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
        label(ctx, x + 2, y + (s.dir === "bull" ? -3 : 11), `${s.kind} ${s.dir === "bull" ? "↑" : "↓"}`, `rgba(${C.struct},0.95)`);
      }
    }
  };

  function label(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
    ctx.font = "600 10px Inter, system-ui, sans-serif";
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  // Re-draw overlay whenever analysis or toggles change.
  useEffect(() => { drawOverlayRef.current(); }, [ict, showFvg, showOb, showLiq, showStruct, showKz, showPd]);

  const status = connected ? "live" : "offline";
  // Panel lists gaps still in play: live boxes (no endTs) plus inverted IFVGs.
  // A box that ended (2nd pass-through or break) drops off the panel.
  const liveFvg = ict.fvgs.filter((f) => f.inverted || f.endTs == null);
  const unsweptLiq = ict.liquidity.filter((l) => !l.swept);
  const lastStruct = ict.structure.slice(-5).reverse();

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
    const inZone = (top: number, bottom: number) =>
      px != null && px >= bottom - NEAR && px <= top + NEAR;

    const kz = activeWindows(now);
    const hasKZ = kz.length > 0;
    const hasSilver = kz.some((w) => w.kind === "silver");
    const hasMacro = kz.some((w) => w.kind === "macro");

    const a: Record<string, boolean> = {
      // zone concepts
      fvg:    ict.fvgs.some((f) => !f.inverted && f.endTs == null && inZone(f.top, f.bottom)),
      ifvg:   ict.fvgs.some((f) => f.inverted && inZone(f.top, f.bottom)),
      ob:     ict.orderBlocks.some((o) => !o.mitigated && inZone(o.top, o.bottom)),
      breaker: ict.breakers.some((s) => fresh(s.ts)),
      irlerl: ict.rangeLiquidity.internal.some((z) => inZone(z.top, z.bottom)),
      liquidity: ict.liquidity.some((l) => !l.swept && px != null && Math.abs(l.price - px) <= NEAR),
      eqhl:   ict.liquidity.some((l) => !l.swept && l.count >= 2 && px != null && Math.abs(l.price - px) <= NEAR),
      pd:     !!ict.range && px != null && px >= ict.range.low && px <= ict.range.high,
      ote:    !!ict.range && px != null && px >= Math.min(ict.range.ote.from, ict.range.ote.to) - NEAR
                                        && px <= Math.max(ict.range.ote.from, ict.range.ote.to) + NEAR,
      // event concepts (fired recently)
      displacement: ict.displacement.some((d) => fresh(d.endTs)),
      mss:    ict.structure.some((s) => s.kind === "MSS" && fresh(s.ts)),
      bos:    ict.structure.some((s) => s.kind === "BOS" && fresh(s.ts)),
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
      po3:       !!po3Today && po3Today.manipExtreme != null,
      crt:       !!ict.crt && ict.crt.sweep != null,
      // bias is a standing read, live whenever it has a direction
      bias:   ict.bias.dir !== "neutral",
      htfbias: ict.bias.dir !== "neutral",
    };
    return a;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ict, candles, clockTick, po3Today]);

  return (
    <div className="flex-1 overflow-y-auto text-white" style={{ minHeight: 0 }}>
    <div className="mx-auto w-full max-w-[1600px] px-3 py-4">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight">ICT</h1>
        <span className="text-[11px] uppercase tracking-[0.18em] text-white">Inner Circle Trader · live ES detection</span>
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${connected ? "text-emerald-300" : "text-white"}`}
          style={{ border: `1px solid ${connected ? "rgba(0,230,118,.4)" : "rgba(255,255,255,.18)"}`, background: connected ? "rgba(0,230,118,.08)" : "transparent" }}>
          ● {status}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <CopyshotBtn targetRef={captureRef} />
          <BoxDiscordBtn targetRef={captureRef} label="ICT — live ES" />
        </div>
      </div>

      {/* captureRef wraps the chart AND the live panels so a copyshot grabs both */}
      <div ref={captureRef} className="grid grid-cols-1 gap-4 rounded-xl bg-[#080b10] p-1 lg:grid-cols-[1fr_520px]">
        {/* Chart + overlays */}
        <div className="rounded-xl border border-white/10 bg-[#0b0f15] p-2">
          {/* Overlay toggles */}
          <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
            {([
              ["FVG (5m)", showFvg, setShowFvg, C.fvg], ["Order Blocks", showOb, setShowOb, C.ob],
              ["Liquidity", showLiq, setShowLiq, C.liq], ["Structure", showStruct, setShowStruct, C.struct],
              ["Kill Zones", showKz, setShowKz, "41,182,246"], ["Premium/Discount", showPd, setShowPd, "255,255,255"],
            ] as [string, boolean, (v: boolean) => void, string][]).map(([lbl, on, set, rgb]) => (
              <button key={lbl} onClick={() => set(!on)}
                className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition"
                style={{ color: on ? `rgb(${rgb})` : "#ffffff", background: on ? `rgba(${rgb},.16)` : "transparent", border: `1px solid ${on ? `rgba(${rgb},.7)` : "rgba(255,255,255,.3)"}` }}>
                {lbl}
              </button>
            ))}
          </div>
          <div className="relative" style={{ height: 560 }}>
            <div ref={chartRef} className="absolute inset-0" />
            <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" />
            {!candles.length && (
              <div className="absolute inset-0 grid place-items-center text-sm text-white">waiting for ES candles…</div>
            )}
          </div>
        </div>

        {/* Live signal panel */}
        <div className="grid grid-cols-1 gap-3 self-start sm:grid-cols-2">
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

          <Panel title="Market Structure">
            {lastStruct.length ? (
              <ul className="space-y-1">
                {lastStruct.map((s, i) => (
                  <li key={i} className="flex items-center justify-between font-mono text-[11px]">
                    <span style={{ color: "#a78bfa" }}>{s.kind} {s.dir === "bull" ? "↑" : "↓"}</span>
                    <span className="text-white">{s.price.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px] text-white">No structure breaks yet.</p>}
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
      </div>

      {/* Glossary */}
      <div className="mt-6">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.16em] text-white">ICT Concepts</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {CONCEPTS.map((c) => (
            <div key={c.id} className="rounded-xl border border-white/10 bg-[#0b0f15] p-3">
              <div className="mb-1 flex items-center gap-2">
                <a href={c.href} target="_blank" rel="noopener noreferrer" className="text-[15px] font-bold text-cyan-300 hover:text-cyan-200">{c.name}</a>
                {c.live && (active[c.id]
                  ? <span className="rounded bg-emerald-500/20 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-emerald-300">live</span>
                  : <span className="rounded bg-white/5 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-white/35">idle</span>)}
              </div>
              <p className="text-[14px] leading-relaxed text-white">{highlightTerms(c.body)}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-white">
          Concept definitions adapted from{" "}
          <a href="https://innercircletrader.net/tutorials/most-important-ict-concepts-to-conquer-market-complete-list/" target="_blank" rel="noopener noreferrer" className="underline hover:text-cyan-300">
            innercircletrader.net — Most Important ICT Concepts
          </a>. Live detection runs on the dashboard&apos;s 5-min ES futures feed.
        </p>
      </div>
    </div>
    </div>
  );
}

/**
 * Labeled "Copyshot" button — screenshots the target element (chart + live
 * panels) and writes a PNG to the clipboard. Self-contained (lazy-loads
 * html2canvas) so it doesn't depend on DataBox internals.
 */
function CopyshotBtn({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  const [s, set] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const run = useCallback(async () => {
    if (s === "busy" || !targetRef.current) return;
    set("busy");
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(targetRef.current, { backgroundColor: "#080b10", scale: 2, logging: false });
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("no blob");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      set("ok");
    } catch { set("err"); }
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0b0f15] p-3">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">{title}</div>
      {children}
    </div>
  );
}
