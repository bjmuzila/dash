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
  { id: "idm", name: "Inducement (IDM)", href: "https://innercircletrader.net/tutorials/what-is-inducement-in-forex/",
    body: "A trap level that lures FOMO retail traders in early. Price typically sweeps the inducement before delivering the real directional move." },
  { id: "bias", name: "Daily Bias", live: true, href: "https://innercircletrader.net/tutorials/ict-daily-bias-trick/",
    body: "The anticipated direction for the day. Derived here from price vs the prior-day midpoint and session displacement (draw on PDH/BSL vs PDL/SSL)." },
  { id: "pd", name: "Premium & Discount Zones", live: true, href: "https://innercircletrader.net/tutorials/ict-premium-and-discount-zone-identification/",
    body: "Fibonacci from swing high↔low. Above 0.50 = premium (sellers' zone); below 0.50 = discount (buyers' zone). Equilibrium is the 0.50 line." },
  { id: "ote", name: "Optimal Trade Entry (OTE)", live: true, href: "https://innercircletrader.net/tutorials/ict-optimal-trade-entry/",
    body: "The 62%–79% retracement band of the most recent impulse leg — where smart money typically delivers the real move after the sweep." },
  { id: "po3", name: "Power of 3 (PO3 / AMD)", href: "https://innercircletrader.net/tutorials/ict-power-of-3-po3/",
    body: "The daily delivery template: Accumulation (Asia), Manipulation (London), Distribution (New York)." },
  { id: "silver", name: "Silver Bullet", live: true, href: "https://innercircletrader.net/tutorials/ict-silver-bullet-strategy/",
    body: "A one-hour high-probability window (10:00–11:00 NY) where price delivers an FVG entry in the direction of the daily bias." },
  { id: "killzones", name: "Killzones", live: true, href: "https://innercircletrader.net/tutorials/master-ict-kill-zones/",
    body: "Time windows where institutional volume concentrates: Asian, London, NY AM and NY PM killzones. Highest-probability setups occur inside them." },
  { id: "macros", name: "ICT Macros", live: true, href: "https://innercircletrader.net/tutorials/ict-macro-time-based-strategy/",
    body: "20-minute high-conviction windows inside each killzone (e.g. 09:50 NY-AM, 13:10 NY-PM) where algorithmic delivery is most concentrated." },
  { id: "smt", name: "SMT Divergence", href: "https://innercircletrader.net/tutorials/ict-smart-money-tool-smt-divergence/",
    body: "Disagreement between two correlated instruments at a key level (one makes a higher high, the other doesn't) — confirms smart money rejecting the level." },
  { id: "turtle", name: "Turtle Soup", href: "https://innercircletrader.net/tutorials/ict-turtle-soup-trading-strategy/",
    body: "A failure at relative equal highs/lows: price sweeps the level, fails to follow through, and reverses — a clean counter-breakout entry." },
  { id: "judas", name: "Judas Swing", href: "https://innercircletrader.net/tutorials/ict-judas-swing/",
    body: "The false move at the London open that fakes retail into the wrong direction before the real move — the manipulation phase of PO3." },
  { id: "irlerl", name: "IRL & ERL", href: "https://innercircletrader.net/tutorials/ict-internal-and-external-range-liquidity/",
    body: "Internal Range Liquidity = FVGs/order blocks inside the dealing range. External Range Liquidity = swing highs/lows outside it. Price oscillates between the two." },
  { id: "breaker", name: "Breaker Block", href: "https://innercircletrader.net/tutorials/ict-order-block/",
    body: "An order block that forms after a Break of Structure: price breaks the OB, then retests it from the other side and uses it as continuation support/resistance. The failed OB flips into a breaker." },
  { id: "ifvg", name: "Inversion FVG (IFVG)", href: "https://innercircletrader.net/tutorials/fair-value-gap-trading-strategy/",
    body: "An FVG that gets traded fully through (mitigated) and then flips polarity — a bullish FVG that breaks becomes bearish resistance and vice versa. High-confluence reversal signal, often paired with MSS." },
  { id: "mmxm", name: "Market Maker Models (MMXM)", href: "https://innercircletrader.net/",
    body: "The market-maker buy/sell model: a staged narrative of Smart Money Reversal (SMR), re-accumulation/distribution and the original consolidation. Stage 2 (after the reversal, with liquidity + PD arrays aligned) is cited as the highest-probability leg." },
  { id: "model2022", name: "2022 Model / Cam's Model", href: "https://innercircletrader.net/",
    body: "A simplified high-probability template: liquidity sweep (Turtle Soup) → MSS → entry on the resulting FVG / IFVG in the direction of the break. One of the cleanest reversal/continuation recipes." },
  { id: "cisd", name: "CISD (Change in State of Delivery)", href: "https://innercircletrader.net/",
    body: "The shift that confirms a new delivery phase — price stops delivering in one direction (e.g. consecutive down closes) and the first opposing close through the prior range opens a new bullish/bearish state." },
  { id: "crt", name: "Candle Range Theory (CRT)", href: "https://innercircletrader.net/",
    body: "Range-based read of a single higher-timeframe candle: its high/low define the range, the body the equilibrium. Lower-timeframe price sweeps one extreme then delivers toward the other — a framing tool for highs/lows in the models." },
  { id: "eqhl", name: "Equal Highs / Equal Lows (EQH/EQL)", live: true, href: "https://innercircletrader.net/tutorials/liquidity-in-forex-trading/",
    body: "Relative-equal swing highs (EQH = buy-side liquidity) or lows (EQL = sell-side liquidity). These clusters are obvious stop pools that smart money engineers price toward and sweeps. Detected live as clustered liquidity (BSL/SSL ×N)." },
  { id: "htfbias", name: "HTF Bias + Draw on Liquidity", live: true, href: "https://innercircletrader.net/tutorials/ict-daily-bias-trick/",
    body: "The overarching framework: set higher-timeframe directional bias, then target the liquidity pool price is drawn toward (PDH/PDL, session H/L, EQH/EQL) using lower-timeframe FVG/OTE/MSS confluence. Often called ~80% of the edge." },
];

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

    // FVG boxes (extend from candle 3 to the right edge; faded if mitigated).
    if (t.showFvg) {
      for (const f of a.fvgs) {
        const x = xOf(f.ts), yT = yOf(f.top), yB = yOf(f.bottom);
        if (x == null || yT == null || yB == null) continue;
        const bull = f.dir === "bull";
        ctx.fillStyle = bull
          ? (f.mitigated ? "rgba(48,209,88,0.06)" : "rgba(48,209,88,0.16)")
          : (f.mitigated ? "rgba(255,71,87,0.06)" : "rgba(255,71,87,0.16)");
        ctx.fillRect(x, Math.min(yT, yB), Math.max(2, rightEdge - x), Math.abs(yB - yT));
      }
    }

    // Order blocks.
    if (t.showOb) {
      for (const o of a.orderBlocks) {
        const x = xOf(o.ts), yT = yOf(o.top), yB = yOf(o.bottom);
        if (x == null || yT == null || yB == null) continue;
        const bull = o.dir === "bull";
        ctx.strokeStyle = bull ? "rgba(48,209,88,0.85)" : "rgba(255,71,87,0.85)";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = o.mitigated ? 0.4 : 1;
        ctx.strokeRect(x, Math.min(yT, yB), Math.max(2, rightEdge - x), Math.abs(yB - yT));
        ctx.globalAlpha = 1;
        label(ctx, x + 3, Math.min(yT, yB) + 11, bull ? "OB+" : "OB−", bull ? "rgba(48,209,88,0.95)" : "rgba(255,71,87,0.95)");
      }
    }

    // Liquidity pools — horizontal lines to the right edge.
    if (t.showLiq) {
      for (const p of a.liquidity.slice(0, 10)) {
        const y = yOf(p.price); const x = xOf(p.ts);
        if (y == null) continue;
        const bsl = p.side === "BSL";
        ctx.strokeStyle = p.swept ? "rgba(255,255,255,0.18)" : (bsl ? "rgba(41,182,246,0.7)" : "rgba(255,159,67,0.7)");
        ctx.lineWidth = 1; ctx.setLineDash(p.swept ? [2, 4] : []);
        ctx.beginPath(); ctx.moveTo(x ?? 0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.setLineDash([]);
        label(ctx, (x ?? 0) + 4, y - 3, `${p.side}${p.count > 1 ? `×${p.count}` : ""}${p.swept ? " swept" : ""}`,
          p.swept ? "rgba(255,255,255,0.45)" : (bsl ? "rgba(41,182,246,0.95)" : "rgba(255,159,67,0.95)"));
      }
    }

    // Structure markers (BOS / CHOCH / MSS) at the break candle.
    if (t.showStruct) {
      for (const s of a.structure.slice(-30)) {
        const x = xOf(s.ts), y = yOf(s.price);
        if (x == null || y == null) continue;
        const col = s.kind === "BOS" ? "rgba(41,182,246,0.95)" : s.kind === "CHOCH" ? "rgba(255,193,7,0.95)" : "rgba(167,139,250,0.95)";
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(Math.max(0, x - 36), y); ctx.lineTo(x, y); ctx.stroke();
        ctx.setLineDash([]);
        label(ctx, x + 2, y + (s.dir === "bull" ? -3 : 11), s.kind, col);
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
  const unmitFvg = ict.fvgs.filter((f) => !f.mitigated);
  const unsweptLiq = ict.liquidity.filter((l) => !l.swept);
  const lastStruct = ict.structure.slice(-5).reverse();

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 py-4 text-white/90">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight">ICT</h1>
        <span className="text-[11px] uppercase tracking-[0.18em] text-white/40">Inner Circle Trader · live ES detection</span>
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${connected ? "text-emerald-300" : "text-white/40"}`}
          style={{ border: `1px solid ${connected ? "rgba(0,230,118,.4)" : "rgba(255,255,255,.18)"}`, background: connected ? "rgba(0,230,118,.08)" : "transparent" }}>
          ● {status}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <CopyshotBtn targetRef={captureRef} />
          <BoxDiscordBtn targetRef={captureRef} label="ICT — live ES" />
        </div>
      </div>

      {/* captureRef wraps the chart AND the live panels so a copyshot grabs both */}
      <div ref={captureRef} className="grid grid-cols-1 gap-4 rounded-xl bg-[#080b10] p-1 lg:grid-cols-[1fr_330px]">
        {/* Chart + overlays */}
        <div className="rounded-xl border border-white/10 bg-[#0b0f15] p-2">
          {/* Overlay toggles */}
          <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
            {([
              ["FVG", showFvg, setShowFvg], ["Order Blocks", showOb, setShowOb],
              ["Liquidity", showLiq, setShowLiq], ["Structure", showStruct, setShowStruct],
              ["Kill Zones", showKz, setShowKz], ["Premium/Discount", showPd, setShowPd],
            ] as [string, boolean, (v: boolean) => void][]).map(([lbl, on, set]) => (
              <button key={lbl} onClick={() => set(!on)}
                className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition"
                style={{ color: on ? "#e7eef6" : "rgba(255,255,255,.4)", background: on ? "rgba(41,182,246,.14)" : "transparent", border: `1px solid ${on ? "rgba(41,182,246,.4)" : "rgba(255,255,255,.14)"}` }}>
                {lbl}
              </button>
            ))}
          </div>
          <div className="relative" style={{ height: 560 }}>
            <div ref={chartRef} className="absolute inset-0" />
            <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" />
            {!candles.length && (
              <div className="absolute inset-0 grid place-items-center text-sm text-white/40">waiting for ES candles…</div>
            )}
          </div>
        </div>

        {/* Live signal panel */}
        <div className="flex flex-col gap-3">
          <Panel title="Daily Bias">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold" style={{ color: ict.bias.dir === "bull" ? "#30d158" : ict.bias.dir === "bear" ? "#ff5b5b" : "#9fb3c8" }}>
                {ict.bias.dir.toUpperCase()}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-white/55">{ict.bias.reason}</p>
            {ict.bias.prevHigh != null && (
              <p className="mt-1 font-mono text-[11px] text-white/45">PDH {ict.bias.prevHigh.toFixed(2)} · PDL {ict.bias.prevLow!.toFixed(2)}</p>
            )}
          </Panel>

          <Panel title={`Active Windows (${liveWindows.length})`}>
            {liveWindows.length ? (
              <div className="flex flex-wrap gap-1">
                {liveWindows.map((w) => (
                  <span key={w.id} className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ color: w.kind === "macro" ? "#c4b5fd" : w.kind === "silver" ? "#ffd54f" : "#7fd4ff", background: "rgba(255,255,255,.05)" }}>
                    {w.label}
                  </span>
                ))}
              </div>
            ) : <p className="text-[11px] text-white/40">No ICT killzone / macro active right now (ET).</p>}
          </Panel>

          <Panel title="Market Structure">
            {lastStruct.length ? (
              <ul className="space-y-1">
                {lastStruct.map((s, i) => (
                  <li key={i} className="flex items-center justify-between font-mono text-[11px]">
                    <span style={{ color: s.kind === "BOS" ? "#7fd4ff" : s.kind === "CHOCH" ? "#ffd54f" : "#c4b5fd" }}>{s.kind} {s.dir === "bull" ? "↑" : "↓"}</span>
                    <span className="text-white/45">{s.price.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px] text-white/40">No structure breaks yet.</p>}
          </Panel>

          <Panel title="Open FVGs">
            {unmitFvg.length ? (
              <ul className="space-y-1">
                {unmitFvg.slice(-6).reverse().map((f, i) => (
                  <li key={i} className="flex items-center justify-between font-mono text-[11px]">
                    <span style={{ color: f.dir === "bull" ? "#30d158" : "#ff5b5b" }}>{f.dir === "bull" ? "Bull" : "Bear"} FVG</span>
                    <span className="text-white/45">{f.bottom.toFixed(2)}–{f.top.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px] text-white/40">No unmitigated FVGs.</p>}
          </Panel>

          <Panel title="Liquidity (unswept)">
            {unsweptLiq.length ? (
              <ul className="space-y-1">
                {unsweptLiq.slice(0, 6).map((p, i) => (
                  <li key={i} className="flex items-center justify-between font-mono text-[11px]">
                    <span style={{ color: p.side === "BSL" ? "#29b6f6" : "#ff9f43" }}>{p.side}{p.count > 1 ? ` ×${p.count}` : ""}</span>
                    <span className="text-white/45">{p.price.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px] text-white/40">No liquidity pools detected.</p>}
          </Panel>

          {ict.range && (
            <Panel title="Dealing Range">
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-white/55">
                <span>High</span><span className="text-right text-white/80">{ict.range.high.toFixed(2)}</span>
                <span>EQ (0.5)</span><span className="text-right text-white/80">{ict.range.eq.toFixed(2)}</span>
                <span>Low</span><span className="text-right text-white/80">{ict.range.low.toFixed(2)}</span>
                <span className="text-[#c4b5fd]">OTE</span><span className="text-right text-[#c4b5fd]">{ict.range.ote.to.toFixed(2)}–{ict.range.ote.from.toFixed(2)}</span>
              </div>
            </Panel>
          )}
        </div>
      </div>

      {/* Glossary */}
      <div className="mt-6">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.16em] text-white/60">ICT Concepts</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CONCEPTS.map((c) => (
            <div key={c.id} className="rounded-xl border border-white/10 bg-[#0b0f15] p-3">
              <div className="mb-1 flex items-center gap-2">
                <a href={c.href} target="_blank" rel="noopener noreferrer" className="text-[13px] font-bold text-white/90 hover:text-cyan-300">{c.name}</a>
                {c.live && <span className="rounded bg-emerald-500/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-emerald-300">live</span>}
              </div>
              <p className="text-[12px] leading-snug text-white/55">{c.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-white/35">
          Concept definitions adapted from{" "}
          <a href="https://innercircletrader.net/tutorials/most-important-ict-concepts-to-conquer-market-complete-list/" target="_blank" rel="noopener noreferrer" className="underline hover:text-cyan-300">
            innercircletrader.net — Most Important ICT Concepts
          </a>. Live detection runs on the dashboard&apos;s 5-min ES futures feed.
        </p>
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0b0f15] p-3">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">{title}</div>
      {children}
    </div>
  );
}
