"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useGexBubbleHistory } from "@/hooks/useGexBubbleHistory";
import EsGexRail, { type RailRow } from "@/components/dashboard/EsGexRail";
import { etDayKey } from "@/components/dashboard/es-candles/chartMath";
import { netGEXOf } from "@/lib/calculations/calculations";
import MobileShell from "../MobileShell";
import MobileChainRail from "../MobileChainRail";
import ExpiryBadge from "../ExpiryBadge";
import { MEmpty, MSegmented, MSheet, MSlider, MStatusDot } from "../MobileUI";
import { M_COLOR, MONO, RADIUS, TYPE, fmtPrice, noTapHighlight, rgba } from "../mobileTheme";

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
 * OVERLAYS
 * --------
 * The desktop card's Overlays menu is a portal-positioned dropdown with seven
 * chips and five slider sub-panels; that is not a phone control. This is a
 * bottom sheet with the three things worth having at 390px:
 *
 *   - a SIDE PANEL choice (none / GEX rail / 0DTE ladder). One at a time, not
 *     two toggles: each costs 46px of a 390px screen, and the desktop's own
 *     geometry table treats the gutter as a single-choice slot for the same
 *     reason.
 *   - BUBBLES — the per-minute GEX trail. ON by default, with a size-variance
 *     slider (see BUBBLE_SCALE_*).
 *   - the γ level lines.
 *
 * The GEX rail is the desktop `EsGexRail` component, imported unchanged: it is
 * already standalone, canvas-based, and every one of its props comes straight
 * out of useMobileGex.
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

type SidePanel = "none" | "rail" | "chain";

const SIDE_PANELS: { id: SidePanel; label: string }[] = [
  { id: "none", label: "Off" },
  { id: "rail", label: "GEX rail" },
  { id: "chain", label: "0DTE" },
];

/**
 * Gutter width. The desktop specs 58px for the rail and 76px for the chain and
 * suppresses both below 340px of remaining chart — at 390px total those would
 * leave 332px and 314px, i.e. the desktop would refuse to draw them. 46px keeps
 * 344px of chart, just over that line, and both panels are readable at it
 * because the phone versions drop their inline strike labels (the chart's own
 * price axis is inches away).
 */
const GUTTER_W = 46;

/**
 * Bubble size variance.
 *
 * The trail sizes each bubble by |net GEX| against the session's own maximum,
 * so on a day where one strike dwarfs everything the rest collapse to dots, and
 * on a flat day they all look the same. This scales the TOP of the radius range
 * while the floor stays put — so it is a contrast control, not a zoom: turn it
 * up and the dominant strikes pull away from the crowd, turn it down and the
 * trail flattens into an even ribbon that is easier to follow as a path.
 *
 * The 1.0 baseline is "half a bar's spacing", the width at which neighbouring
 * buckets touch but never merge. Above ~1.4 they do overlap; that is the point
 * of the control and it is the user's call, so the cap is generous.
 */
const BUBBLE_SCALE_MIN = 0.4;
const BUBBLE_SCALE_MAX = 3;
const BUBBLE_SCALE_STEP = 0.1;
const BUBBLE_SCALE_DEFAULT = 1;

/** One labelled switch row in the overlays sheet. */
function OverlayToggle({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      style={{
        ...noTapHighlight,
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        minHeight: 52,
        padding: "8px 12px",
        borderRadius: RADIUS.md,
        border: `1px solid ${on ? rgba(M_COLOR.cyan, 0.4) : M_COLOR.border}`,
        background: on ? rgba(M_COLOR.cyan, 0.1) : "rgba(255,255,255,0.03)",
        color: "inherit",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: TYPE.body, fontWeight: 700, color: on ? M_COLOR.cyan : M_COLOR.text }}>
          {label}
        </span>
        <span style={{ display: "block", fontSize: TYPE.micro, color: M_COLOR.faint, lineHeight: 1.35, marginTop: 1 }}>
          {hint}
        </span>
      </span>
      {/* iOS-style switch — a checkbox at this size would be under the tap floor. */}
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 42,
          height: 25,
          borderRadius: 999,
          background: on ? rgba(M_COLOR.cyan, 0.55) : "rgba(255,255,255,0.14)",
          position: "relative",
          transition: "background 0.16s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2.5,
            left: on ? 19.5 : 2.5,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.16s",
          }}
        />
      </span>
    </button>
  );
}

export default function MobileEsCandles() {
  const [interval, setInterval] = useState<"1" | "5">("5");
  const [showLevels, setShowLevels] = useState(true);
  const [sidePanel, setSidePanel] = useState<SidePanel>("none");
  // Bubbles default ON. They are the reason to open this page on a phone — the
  // candles alone are available in any broker app — and the history hook is
  // already gated on `enabled`, so nothing is fetched when the basis check
  // later turns them off anyway.
  const [showBubbles, setShowBubbles] = useState(true);
  const [bubbleScale, setBubbleScale] = useState(BUBBLE_SCALE_DEFAULT);
  const [ovlOpen, setOvlOpen] = useState(false);
  const { sessionCandles, connected } = useEsCandles(true, 2, interval === "1" ? 1 : 5);
  const g = useMobileGex("oi-vol");

  // Which ET days the chart actually has bars for — the bubble history needs
  // this to pick a day the trail can be drawn on (see the hook's header).
  const barDayKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of sessionCandles) set.add(etDayKey(r.timestamp));
    return [...set];
  }, [sessionCandles]);

  const bubbleCols = useGexBubbleHistory({
    enabled: showBubbles,
    expiry: g.expiry,
    barDayKeys,
  });

  const railRows: RailRow[] = useMemo(
    () => g.chain.map((r) => ({ strike: r.strike, net: netGEXOf(r, "net", g.spot) })),
    [g.chain, g.spot],
  );

  // Both gutter panels and the bubble layer are SPX-derived, so they share the
  // level lines' policy: no trustworthy basis → don't draw rather than draw
  // wrong. `basisOk` gates all three.
  const basisOk = g.basis != null;
  const panelOn = sidePanel !== "none" && basisOk;

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

  // ── the gutter panels' link to the price axis ──────────────────────────────
  // Both EsGexRail and MobileChainRail place a strike by asking the CANDLE
  // SERIES where that price sits, so their rows stay glued to the chart through
  // any pan or zoom. Identical contract to the desktop's priceToY.
  const priceToY = useCallback((esPrice: number): number | null => {
    const s2 = seriesRef.current;
    if (!s2) return null;
    const y = s2.priceToCoordinate(esPrice);
    return y == null ? null : (y as number);
  }, []);

  const railDrawRef = useRef<() => void>(() => {});
  const chainDrawRef = useRef<() => void>(() => {});
  const bubbleDrawRef = useRef<() => void>(() => {});

  /**
   * Repaint driver for everything canvas-based.
   *
   * lightweight-charts has no "the view changed" event that covers pan, pinch
   * AND price-scale autoscale, and subscribing to the ones it does have still
   * misses autoscale when a new bar widens the range. Rather than guess, this
   * samples the mapping itself once per frame — where does a fixed reference
   * price land? — and repaints only when that answer moves. Idle cost is one
   * priceToCoordinate call per frame; it does not redraw a still chart.
   */
  useEffect(() => {
    if (!panelOn && !(showBubbles && basisOk)) return;
    let raf = 0;
    let lastKey = "";
    const tick = () => {
      const s2 = seriesRef.current;
      const chart = chartRef.current;
      if (s2 && chart) {
        const probe = s2.priceToCoordinate(6000);
        const range = chart.timeScale().getVisibleLogicalRange();
        const key = `${probe}|${range?.from ?? ""}|${range?.to ?? ""}`;
        if (key !== lastKey) {
          lastKey = key;
          railDrawRef.current?.();
          chainDrawRef.current?.();
          bubbleDrawRef.current?.();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [panelOn, showBubbles, basisOk]);

  // ── bubbles ────────────────────────────────────────────────────────────────
  const bubbleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bubbleDataRef = useRef({
    cols: bubbleCols,
    basis: g.basis ?? 0,
    rows: sessionCandles,
    scale: bubbleScale,
  });
  bubbleDataRef.current = {
    cols: bubbleCols,
    basis: g.basis ?? 0,
    rows: sessionCandles,
    scale: bubbleScale,
  };

  const drawBubbles = useCallback(() => {
    const cv = bubbleCanvasRef.current;
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!cv || !chart || !series) return;
    const host = cv.parentElement;
    if (!host) return;
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w < 4 || h < 4) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { cols, basis, rows, scale } = bubbleDataRef.current;
    if (!cols.length || !rows.length) return;

    /**
     * x for an arbitrary ms timestamp.
     *
     * NOT `timeToCoordinate(t)`: that returns null for any time that is not
     * exactly a bar, and bubble minutes almost never land on a 5-minute bar. So
     * find the bar the minute falls in and use ITS coordinate. The desktop does
     * the same and its comment is emphatic about not "simplifying" it back to
     * arithmetic — bar spacing is not uniform across a session boundary.
     */
    const ts = chart.timeScale();
    const barIndexAt = (t: number): number | null => {
      if (t < rows[0].timestamp) return null;
      let lo = 0;
      let hi = rows.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (rows[mid].timestamp <= t) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };

    /**
     * Bucket the trail to the chart's BARS, not its raw minutes.
     *
     * The history is 1-minute granular. On a 5-minute chart that is five
     * columns landing on one bar's x, and at these radii they overlap into a
     * solid horizontal band per strike — the trail stops reading as a trail.
     * The desktop card has the same problem and solves it with a bucket
     * selector whose default is "Bar"; this does that, without the selector.
     *
     * Last column in a bar wins, so a bucket shows where the strike ENDED that
     * bar — consistent with a candle close.
     */
    const byBar = new Map<string, { bar: number; strike: number; net: number }>();
    for (const col of cols) {
      const bar = barIndexAt(col.ts);
      if (bar == null) continue;
      for (const cell of col.cells) {
        byBar.set(`${bar}|${cell.strike}`, { bar, strike: cell.strike, net: cell.net });
      }
    }
    if (!byBar.size) return;

    // Size by magnitude, on one scale across the whole trail so a bubble's size
    // means the same thing at 09:31 as at 15:59.
    let max = 0;
    for (const b of byBar.values()) max = Math.max(max, Math.abs(b.net));
    if (!max) return;

    // Baseline cap is half the bar spacing, so neighbouring buckets can touch
    // but never merge — the band above is exactly what that prevents.
    let spacing = 12;
    if (rows.length > 1) {
      const x0 = ts.timeToCoordinate(toChartTime(rows[rows.length - 2].timestamp));
      const x1 = ts.timeToCoordinate(toChartTime(rows[rows.length - 1].timestamp));
      if (x0 != null && x1 != null) spacing = Math.abs((x1 as number) - (x0 as number)) || 12;
    }
    const fitR = Math.max(2.5, Math.min(7, spacing / 2 - 0.5));
    // The floor does NOT scale: holding it fixed while the ceiling moves is what
    // makes this a variance control rather than a zoom. Above ~1.4x the biggest
    // buckets will overlap their neighbours — deliberate, and the user asked.
    const MIN_R = 1.4;
    const MAX_R = Math.max(MIN_R + 0.6, fitR * scale);

    const xCache = new Map<number, number | null>();
    const xOfBar = (bar: number) => {
      if (!xCache.has(bar)) {
        const x = ts.timeToCoordinate(toChartTime(rows[bar].timestamp));
        xCache.set(bar, x == null ? null : (x as number));
      }
      return xCache.get(bar) ?? null;
    };

    for (const b of byBar.values()) {
      const x = xOfBar(b.bar);
      if (x == null || x < -MAX_R || x > w + MAX_R) continue;
      const y = priceToY(b.strike + basis);
      if (y == null || y < -MAX_R || y > h + MAX_R) continue;
      const mag = Math.abs(b.net);
      if (!mag) continue;
      const frac = mag / max;
      // sqrt so AREA tracks magnitude — a linear radius makes the biggest
      // strike look several times more dominant than it is.
      const r = MIN_R + (MAX_R - MIN_R) * Math.sqrt(frac);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      // Fade the weak ones too, so the eye finds the walls without reading sizes.
      ctx.fillStyle = (b.net >= 0 ? rgba(M_COLOR.pos, 1) : rgba(M_COLOR.neg, 1)).replace(
        /[\d.]+\)$/,
        `${(0.22 + 0.5 * frac).toFixed(2)})`,
      );
      ctx.fill();
    }
  }, [priceToY]);

  useEffect(() => {
    bubbleDrawRef.current = drawBubbles;
    drawBubbles();
  }, [drawBubbles, bubbleCols, g.basis, sessionCandles, bubbleScale]);

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
  // Badge on the Overlays button so the sheet's state is visible without
  // opening it — the count is what's actually drawing, not what's toggled on,
  // which is why the basis gate is part of it.
  const overlayCount =
    (showLevels && basisOk ? 1 : 0) + (panelOn ? 1 : 0) + (showBubbles && basisOk ? 1 : 0);

  return (
    <MobileShell
      title="ES Candles"
      fill
      right={<MStatusDot live={connected} label={connected ? "LIVE" : "…"} />}
      sticky={
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {/* Price gets its own line. Once "γ" became "Overlays" the single row
              could no longer hold price + change + interval + button at 390px,
              and the interval control started overlapping the change figure. */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
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
            <span style={{ flex: 1 }} />
            <ExpiryBadge expiry={g.expiry} isZeroDte={g.isZeroDte} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 130, flexShrink: 0 }}>
              <MSegmented options={INTERVALS} value={interval} onChange={setInterval} accent={M_COLOR.blue} />
            </div>
            <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setOvlOpen(true)}
            title="Overlays"
            style={{
              ...noTapHighlight,
              flexShrink: 0,
              minHeight: 30,
              padding: "0 10px",
              borderRadius: RADIUS.sm,
              border: `1px solid ${overlayCount ? rgba(M_COLOR.cyan, 0.5) : M_COLOR.border}`,
              background: overlayCount ? rgba(M_COLOR.cyan, 0.16) : "rgba(255,255,255,0.04)",
              color: overlayCount ? M_COLOR.cyan : M_COLOR.faint,
              fontSize: TYPE.label,
              fontWeight: 800,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            Overlays
            {overlayCount > 0 && (
              <span
                style={{
                  ...MONO,
                  fontSize: TYPE.micro - 2,
                  fontWeight: 900,
                  minWidth: 14,
                  height: 14,
                  borderRadius: 7,
                  background: M_COLOR.cyan,
                  color: "#04222b",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {overlayCount}
              </span>
            )}
          </button>
          </div>
        </div>
      }
    >
      <div style={{ flex: 1, minHeight: 0, display: "flex", padding: "0 4px 4px" }}>
        {/* Chart + the bubble layer, which shares the chart's exact box so a
            strike's y here is a strike's y there. */}
        <div style={{ position: "relative", flex: 1, minWidth: 0, height: "100%" }}>
          <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
          {showBubbles && basisOk && (
            <canvas
              ref={bubbleCanvasRef}
              style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}
            />
          )}
          {sessionCandles.length === 0 && (
            <div style={{ position: "absolute", inset: 0, display: "flex" }}>
              <MEmpty tall>{connected ? "Loading ES candles…" : "Connecting to the live feed…"}</MEmpty>
            </div>
          )}
          {(showLevels || showBubbles || sidePanel !== "none") && !basisOk && sessionCandles.length > 0 && (
            <div
              style={{
                position: "absolute",
                left: 8,
                bottom: 26,
                fontSize: TYPE.micro,
                color: M_COLOR.faint,
                background: "rgba(5,8,13,0.72)",
                padding: "2px 7px",
                borderRadius: RADIUS.sm,
                pointerEvents: "none",
              }}
            >
              SPX overlays need a live ES/SPX pair
            </div>
          )}
        </div>

        {/* Right gutter. Same height as the chart box, so both panels can map a
            price to the same y the candles use. */}
        {panelOn && sidePanel === "rail" && (
          <div style={{ width: GUTTER_W, flexShrink: 0, height: "100%", position: "relative" }}>
            <EsGexRail
              rows={railRows}
              callWall={g.callWall}
              putWall={g.putWall}
              gexFlip={g.flip}
              spot={g.spot || null}
              basis={g.basis ?? 0}
              priceToY={priceToY}
              drawRef={railDrawRef}
            />
          </div>
        )}
        {panelOn && sidePanel === "chain" && (
          <MobileChainRail
            chain={g.chain}
            spot={g.spot}
            basis={g.basis ?? 0}
            width={GUTTER_W}
            priceToY={priceToY}
            drawRef={chainDrawRef}
          />
        )}
      </div>

      <MSheet
        open={ovlOpen}
        title="Overlays"
        subtitle={basisOk ? undefined : "SPX overlays are off — no live ES/SPX pair right now"}
        onClose={() => setOvlOpen(false)}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: TYPE.micro, fontWeight: 800, letterSpacing: "0.1em", color: M_COLOR.faint }}>
            SIDE PANEL
          </span>
          <MSegmented options={SIDE_PANELS} value={sidePanel} onChange={setSidePanel} />
          <span style={{ fontSize: TYPE.micro, color: M_COLOR.faint, lineHeight: 1.4 }}>
            One at a time — each costs {GUTTER_W}px of chart.
          </span>
        </div>

        <OverlayToggle
          label="Bubbles"
          hint="Per-minute GEX trail for today, sized by magnitude."
          on={showBubbles}
          onToggle={() => setShowBubbles((v) => !v)}
        />
        {showBubbles && (
          <MSlider
            label="Bubble size variance"
            hint="Scales the largest bubbles only — the smallest stay put. Higher pulls the dominant strikes out of the crowd; lower flattens the trail into an even path."
            value={bubbleScale}
            min={BUBBLE_SCALE_MIN}
            max={BUBBLE_SCALE_MAX}
            step={BUBBLE_SCALE_STEP}
            format={(v) => `${v.toFixed(1)}×`}
            onChange={setBubbleScale}
            onReset={
              bubbleScale === BUBBLE_SCALE_DEFAULT
                ? undefined
                : () => setBubbleScale(BUBBLE_SCALE_DEFAULT)
            }
          />
        )}
        <OverlayToggle
          label="γ levels"
          hint="Gamma flip and both walls, converted from SPX to ES."
          on={showLevels}
          onToggle={() => setShowLevels((v) => !v)}
        />
      </MSheet>

    </MobileShell>
  );
}
