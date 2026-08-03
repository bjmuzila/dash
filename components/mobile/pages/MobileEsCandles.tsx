"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, LineStyle, createChart } from "lightweight-charts";
import type {
  CandlestickData,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  UTCTimestamp,
} from "lightweight-charts";
import { useEsCandles } from "@/hooks/useEsCandles";
import { useMobileGex } from "@/hooks/useMobileGex";
import MobileShell from "../MobileShell";
import { MEmpty, MSegmented, MStatusDot } from "../MobileUI";
import { M_COLOR, MONO, RADIUS, TYPE, fmtPrice, rgba } from "../mobileTheme";

/**
 * MobileEsCandles — the ES chart, phone edition.
 *
 * WHY NOT REUSE EsChartCard
 * -------------------------
 * The desktop card is 4,500 lines: a 1–3 chart row, a dock that measures ~1,200
 * natural pixels and gets CSS-transform-scaled to fit, a replay transport, a
 * side rail, and five canvas overlay systems each with its own backfill fetch.
 * At 390px `FitScale` would render that toolbar at roughly 0.3 scale, and its
 * own source comment is honest about the result ("not a toolbar, it's a
 * smudge"). Its side rail also auto-suppresses below 340px of chart, so most of
 * what makes it expensive wouldn't even render.
 *
 * What is reused is the part that matters: `useEsCandles`, the same hook the
 * desktop page feeds from — shared refcounted socket, 250ms render coalescing,
 * cross-instance load sharing, and the `useWsLifecycle` bandwidth gate that
 * drops the connection when the tab is backgrounded. That gate matters far more
 * on a phone than a desktop, where "backgrounded" happens every time a
 * notification arrives.
 *
 * `historyDays = 2` rather than the hook's default 20: the 20-day pull exists
 * to compute per-slot volume baselines that this chart never draws, and it is
 * ~114KB over what may be a cellular link.
 *
 * SPX LEVEL LINES
 * ---------------
 * Gamma flip and the two walls are SPX prices; this chart is ES. They are drawn
 * only when the live ES/SPX pair gives a trustworthy basis (see useMobileGex).
 * Off-hours the lines disappear rather than sit at a wrong price.
 */

const INTERVALS: { id: "1" | "5"; label: string }[] = [
  { id: "1", label: "1 min" },
  { id: "5", label: "5 min" },
];

function toChartTime(ts: number): UTCTimestamp {
  return Math.floor(ts / 1000) as UTCTimestamp;
}

export default function MobileEsCandles() {
  const [interval, setInterval] = useState<"1" | "5">("5");
  const [showLevels, setShowLevels] = useState(true);
  const { sessionCandles, connected } = useEsCandles(true, 2, interval === "1" ? 1 : 5);
  const g = useMobileGex("oi-vol");

  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const didFitRef = useRef(false);

  // ── chart lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";

    const chart = createChart(host, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(255,255,255,.62)",
        fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
        // 11px axis labels: the desktop default (12) is fine on a monitor but
        // the price gutter is a bigger share of a 390px screen, so this buys
        // back ~8px of plot width without dropping under the legibility floor.
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,.045)" },
        horzLines: { color: "rgba(255,255,255,.045)" },
      },
      rightPriceScale: {
        visible: true,
        borderColor: "rgba(255,255,255,.10)",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: "rgba(255,255,255,.10)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
      },
      // Touch: one finger pans, two fingers pinch-zoom the time axis. The
      // vertical drag-to-scale gesture is deliberately off — on a phone it is
      // impossible to separate from a pan and users end up with a squashed
      // price axis they can't recover from without a reload.
      handleScroll: { vertTouchDrag: false, horzTouchDrag: true, mouseWheel: true, pressedMouseMove: true },
      handleScale: { pinch: true, axisPressedMouseMove: { time: true, price: false }, mouseWheel: true },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        priceFormatter: (p: number) => p.toFixed(2),
        timeFormatter: (t: unknown) =>
          typeof t === "number"
            ? new Date(t * 1000).toLocaleTimeString("en-US", {
                timeZone: "America/New_York",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "",
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#30d158",
      wickUpColor: "#30d158",
      downColor: "#ff5b5b",
      wickDownColor: "#ff5b5b",
      borderVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    let lastW = 0;
    let lastH = 0;
    const applySize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) {
        lastW = w;
        lastH = h;
        chart.applyOptions({ width: w, height: h });
      }
    };
    const ro = new ResizeObserver(applySize);
    ro.observe(host);

    // The host is 0-height for the first frame or two while the flex column
    // resolves. Pump on rAF until it has a real box, or the chart stays stuck
    // at its initial collapsed size.
    let raf = 0;
    let tries = 0;
    const pump = () => {
      applySize();
      tries += 1;
      if ((lastW === 0 || lastH === 0) && tries < 120) raf = requestAnimationFrame(pump);
    };
    raf = requestAnimationFrame(pump);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      linesRef.current = [];
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      didFitRef.current = false;
    };
  }, []);

  // Switching aggregation replaces the whole series — refit to the new bars.
  useEffect(() => {
    didFitRef.current = false;
  }, [interval]);

  // ── candles ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const data: CandlestickData[] = sessionCandles.map((r) => ({
      time: toChartTime(r.timestamp),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
    }));
    series.setData(data);
    if (data.length && !didFitRef.current) {
      didFitRef.current = true;
      // Open on the most recent stretch rather than the whole session: 30h of
      // 1-minute bars fitted into 390px is an unreadable grey band.
      const bars = interval === "1" ? 90 : 70;
      const to = data.length - 1;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, to - bars), to: to + 2 });
    }
  }, [sessionCandles, interval]);

  // ── SPX level lines, converted to ES ───────────────────────────────────────
  const levels = useMemo(() => {
    if (!showLevels || g.basis == null) return [];
    const out: { price: number; color: string; title: string }[] = [];
    if (g.flip != null) out.push({ price: g.flip + g.basis, color: M_COLOR.orange, title: "FLIP" });
    if (g.callWall != null) out.push({ price: g.callWall + g.basis, color: M_COLOR.pos, title: "CW" });
    if (g.putWall != null) out.push({ price: g.putWall + g.basis, color: M_COLOR.neg, title: "PW" });
    return out;
  }, [showLevels, g.basis, g.flip, g.callWall, g.putWall]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const l of linesRef.current) {
      try {
        series.removePriceLine(l);
      } catch {
        /* the series may already be gone during teardown */
      }
    }
    linesRef.current = levels.map((l) =>
      series.createPriceLine({
        price: l.price,
        color: rgba(l.color, 0.75),
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: l.title,
      }),
    );
  }, [levels]);

  const last = sessionCandles.length ? sessionCandles[sessionCandles.length - 1] : null;
  const first = sessionCandles.length ? sessionCandles[0] : null;
  const chg = last && first ? last.close - first.open : null;
  const chgPct = chg != null && first && first.open > 0 ? (chg / first.open) * 100 : null;
  const up = (chg ?? 0) >= 0;

  return (
    <MobileShell
      title="ES Candles"
      fill
      right={<MStatusDot live={connected} label={connected ? "LIVE" : "…"} />}
      sticky={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: TYPE.micro, fontWeight: 800, letterSpacing: "0.1em", color: M_COLOR.faint }}>
              ES
            </span>
            <span style={{ ...MONO, fontSize: TYPE.hero - 4, fontWeight: 800, lineHeight: 1 }}>
              {last ? fmtPrice(last.close) : "—"}
            </span>
            {chgPct != null && (
              <span
                style={{
                  ...MONO,
                  fontSize: TYPE.label,
                  fontWeight: 700,
                  color: up ? M_COLOR.up : M_COLOR.down,
                  whiteSpace: "nowrap",
                }}
              >
                {up ? "+" : "−"}
                {Math.abs(chg ?? 0).toFixed(2)} ({Math.abs(chgPct).toFixed(2)}%)
              </span>
            )}
          </div>
          <div style={{ width: 118, flexShrink: 0 }}>
            <MSegmented options={INTERVALS} value={interval} onChange={setInterval} accent={M_COLOR.blue} />
          </div>
          <button
            type="button"
            onClick={() => setShowLevels((v) => !v)}
            aria-pressed={showLevels}
            title="SPX gamma levels, converted to ES"
            style={{
              flexShrink: 0,
              minHeight: 30,
              padding: "0 10px",
              borderRadius: RADIUS.sm,
              border: `1px solid ${showLevels ? rgba(M_COLOR.orange, 0.5) : M_COLOR.border}`,
              background: showLevels ? rgba(M_COLOR.orange, 0.16) : "rgba(255,255,255,0.04)",
              color: showLevels ? M_COLOR.orange : M_COLOR.faint,
              fontSize: TYPE.label,
              fontWeight: 800,
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
              touchAction: "manipulation",
            }}
          >
            γ
          </button>
        </div>
      }
    >
      <div style={{ flex: 1, minHeight: 0, position: "relative", padding: "0 4px 4px" }}>
        <div ref={hostRef} style={{ position: "absolute", inset: "0 4px 4px" }} />
        {sessionCandles.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex" }}>
            <MEmpty tall>{connected ? "Loading ES candles…" : "Connecting to the live feed…"}</MEmpty>
          </div>
        )}
        {showLevels && g.basis == null && sessionCandles.length > 0 && (
          <div
            style={{
              position: "absolute",
              left: 10,
              bottom: 26,
              fontSize: TYPE.micro,
              color: M_COLOR.faint,
              background: "rgba(5,8,13,0.72)",
              padding: "2px 7px",
              borderRadius: RADIUS.sm,
              pointerEvents: "none",
            }}
          >
            γ levels need a live ES/SPX pair
          </div>
        )}
      </div>
    </MobileShell>
  );
}
