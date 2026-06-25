"use client";

// EsCandlesCard — a self-contained live ES 5m candlestick chart for the HOME2
// dashboard grid. Renders ONLY the chart (no toolbar / nav / overlays), fed by
// the same useEsCandles hook as the full /es-candles page, and fills whatever
// box it's placed in. Used as a native dashboard card (no iframe).

import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, createChart } from "lightweight-charts";
import type { UTCTimestamp, IChartApi, ISeriesApi, CandlestickData } from "lightweight-charts";
import { useEsCandles } from "@/hooks/useEsCandles";

function toChartTime(ts: number): UTCTimestamp {
  return Math.floor(ts / 1000) as UTCTimestamp;
}

export default function EsCandlesCard() {
  const { sessionCandles, connected } = useEsCandles();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const didFitRef = useRef(false);

  // Create the chart once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(255,255,255,.70)",
        fontFamily: "Inter, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,.06)" },
        horzLines: { color: "rgba(255,255,255,.06)" },
      },
      rightPriceScale: { visible: true, borderColor: "rgba(255,255,255,.10)" },
      leftPriceScale: { visible: false },
      timeScale: { borderColor: "rgba(255,255,255,.10)", timeVisible: true, secondsVisible: false },
      localization: {
        priceFormatter: (p: number) => p.toFixed(2),
        timeFormatter: (time: unknown) =>
          typeof time === "number"
            ? new Date(time * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })
            : "",
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      wickUpColor: "#30d158",
      upColor: "#30d158",
      wickDownColor: "#ff5b5b",
      downColor: "#ff5b5b",
      borderVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    let lastW = 0, lastH = 0;
    const applySize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) {
        lastW = w; lastH = h;
        chart.applyOptions({ width: w, height: h });
        if (!didFitRef.current && seriesRef.current) {
          // First time we have a real size, fit whatever data is loaded.
          chart.timeScale().fitContent();
        }
      }
    };
    const ro = new ResizeObserver(applySize);
    ro.observe(container);

    // The container often has 0 height at creation (it's inside a grid cell that
    // lays out after mount). Poll on animation frames until it has a real size,
    // so the chart never gets stuck at the initial collapsed dimensions.
    let rafId = 0;
    let tries = 0;
    const pump = () => {
      applySize();
      tries++;
      if ((lastW === 0 || lastH === 0) && tries < 120) rafId = requestAnimationFrame(pump);
    };
    rafId = requestAnimationFrame(pump);

    const onDblClick = () => { chart.timeScale().fitContent(); chart.priceScale("right").applyOptions({ autoScale: true }); };
    container.addEventListener("dblclick", onDblClick);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      container.removeEventListener("dblclick", onDblClick);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      didFitRef.current = false;
    };
  }, []);

  // Feed live data.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const data: CandlestickData[] = sessionCandles.map((r) => ({
      time: toChartTime(r.timestamp),
      open: r.open, high: r.high, low: r.low, close: r.close,
    }));
    series.setData(data);
    if (data.length && !didFitRef.current) {
      chart.timeScale().fitContent();
      didFitRef.current = true;
    }
  }, [sessionCandles]);

  const last = sessionCandles.length ? sessionCandles[sessionCandles.length - 1] : null;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 0 }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      {sessionCandles.length === 0 && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#6f7d8c", fontSize: 11 }}>
          {connected ? "Loading ES candles…" : "Connecting…"}
        </div>
      )}
      {last && (
        <div style={{ position: "absolute", left: 8, top: 6, fontSize: 11, fontFamily: "monospace", color: "#dbe7f0", background: "rgba(5,8,13,.6)", padding: "2px 7px", borderRadius: 6, pointerEvents: "none" }}>
          ES {last.close.toFixed(2)}
        </div>
      )}
    </div>
  );
}
