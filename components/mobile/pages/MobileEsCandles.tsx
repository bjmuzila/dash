"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  PriceScaleMode,
  createChart,
} from "lightweight-charts";
import type {
  AutoscaleInfo,
  CandlestickData,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  UTCTimestamp,
} from "lightweight-charts";
import { useEtfCandles } from "@/hooks/useEtfCandles";
import { useMobileGex } from "@/hooks/useMobileGex";
import { useGexBubbleHistory } from "@/hooks/useGexBubbleHistory";
import {
  BUBBLES,
  bubbleAge,
  bubbleAlpha,
  bubbleRadius,
  bubbleSize,
  bubbleStride,
  fitBubbleRows,
  pickBubbleStrikes,
  toBubbleMarks,
  type BubbleRow,
} from "@/lib/gexBubbleModel";
import EsGexRail, { type RailRow } from "@/components/dashboard/EsGexRail";
import { etDayKey } from "@/components/dashboard/es-candles/chartMath";
import { netGEXOf } from "@/lib/calculations/calculations";
import MobileShell from "../MobileShell";
import MobileChainRail from "../MobileChainRail";
import ExpiryBadge from "../ExpiryBadge";
import { MEmpty, MSegmented, MSheet, MSlider, MStatusDot } from "../MobileUI";
import { M_COLOR, MONO, RADIUS, TYPE, fmtPrice, noTapHighlight, rgba } from "../mobileTheme";

/**
 * MobileEsCandles — the SPX chart, phone edition.
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
 * The bars come from `useEtfCandles` — the SPX cash recorder over HTTP. See the
 * SPX CASH note below for why this page is not on the futures socket any more,
 * and what that costs (a 60s write cadence, covered by a live tip off the
 * socket's `spot` frame).
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
 *   - BUBBLES — the GEX trail, over the last BUBBLE_DAYS sessions. ON by
 *     default, with a size-variance slider (see BUBBLE_SCALE_*).
 *
 *     Bucketed to the chart's own bar, then the DESKTOP's model: four strikes a
 *     bucket with one forced each side of spot, radius from one denominator
 *     across the window, the bucket's leader boosted and ringed. Shared through
 *     lib/gexBubbleModel so the two charts cannot drift.
 *   - the γ level lines.
 *
 * The GEX rail is the desktop `EsGexRail` component, imported unchanged: it is
 * already standalone, canvas-based, and every one of its props comes straight
 * out of useMobileGex.
 *
 * SPX LEVEL LINES
 * ---------------
 * Gamma flip and both walls are SPX prices and so is this chart, so they are
 * drawn at their own values, always — no conversion, and nothing to go stale.
 * See the SPX CASH note below for what that replaced.
 *
 * PRICE-AXIS ZOOM
 * ---------------
 * ONE gesture: press the price axis and slide. Up zooms in, down zooms out,
 * release ends it, double-tap the axis resets. No buttons — an earlier ± stepper
 * floated over the plot and was struck for covering candles.
 *
 * The gesture is ours, not the library's, via a transparent strip sized to
 * `priceScale('right').width()` and driven with pointer capture (see
 * AXIS_ZOOM_* and the strip's own comment). Two reasons not to use the built-in
 * `axisPressedMouseMove.price`:
 *
 *   - it freezes the price range. Autoscale goes off and stays off, so a chart
 *     you zoomed at 10:00 has drifted off price by 10:30 and the only way back
 *     is a double-tap that throws the zoom away too.
 *   - it scales about the axis midpoint at a fixed rate with no floor or
 *     ceiling, so a fast phone swipe lands on a flat line or a wall of noise.
 *
 * Instead the strip drives a MULTIPLIER on `autoscaleInfoProvider`: autoscale
 * still computes the range the bars need, and the multiplier squeezes or widens
 * it around its own midpoint, clamped to AXIS_ZOOM range. Autoscale stays ON, so
 * every new bar re-centres the zoomed view and it cannot drift.
 *
 * Drag-inside-the-plot vertical scaling stays off (`vertTouchDrag: false`): on a
 * touchscreen it cannot be separated from a horizontal pan, and users end up
 * with a squashed axis and no idea how they got there. That is exactly why the
 * gesture is confined to the axis strip.
 */

/**
 * SPX CASH, NOT ES.
 *
 * This page charted the ES future and drew everything else — the GEX bubbles,
 * the gamma levels, both gutter panels — by converting SPX strikes through the
 * live ES/SPX basis. That conversion is why the page had a `basisOk` gate and
 * why every overlay VANISHED whenever the pair went stale, which is most of the
 * time a phone is actually open: overnight, weekends, and the hour before the
 * bell.
 *
 * Charting SPX itself deletes the whole problem. Gamma is recorded against SPX
 * strikes, so a bubble goes at its strike, a wall goes at its price, and there
 * is nothing to fetch, nothing to convert, and no state where the overlays are
 * off because a second instrument is quiet.
 *
 * TWO CONSEQUENCES, both real:
 *
 *   1. The bars come from the recorder over HTTP (`useEtfCandles`, 60s poll),
 *      not from the /ws/gex socket — SPX cash has no candle stream on that
 *      feed. The rows are WRITTEN once a minute, so there is no finer SPX bar
 *      to have; the live tip below is what keeps the newest bar moving between
 *      polls.
 *   2. SPX cash has no overnight session — it prints 09:30 to ~16:55 ET. So
 *      there is no RTH/ETH switch on this page: there is no globex tape for it
 *      to include or exclude, and a control whose only remaining job is hiding
 *      the last few post-close prints is a control that has to be explained
 *      every time it is seen. It existed briefly while this page charted ES,
 *      where the distinction was real.
 */
const SPX_SYMBOL = "SPX";
/**
 * Calendar days of bars to pull, by interval. Enough that BUBBLE_DAYS has two
 * sessions of bars to land on across a weekend; 1m is a third the reach because
 * it is five times the rows and the phone only ever frames a session of it.
 */
const SPX_DAYS_5M = 5;
const SPX_DAYS_1M = 3;

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
 * Sizing itself is now the DESKTOP's model, shared through lib/gexBubbleModel:
 * radius is `floor + ratio**sizeCurve x (cap - floor)` against one denominator
 * for the whole window, the cap bounded by the real bar spacing, the bucket's
 * leader boosted and ringed. This slider is a multiplier on those caps and
 * nothing else.
 *
 * **1.0 is exactly the desktop.** It is kept because a 390px chart is not a
 * 1500px one and sometimes you want the walls to shout; the floor does not move
 * with it, so it stays a contrast control rather than a zoom. Above ~1.4 the
 * biggest marks will overlap their neighbours — the fit pass shrinks them back
 * toward the floor first, so this is a request, not a guarantee.
 */
/**
 * How many trading days of GEX bubbles the phone asks for.
 *
 * Was one - today's trail only, so the chart showed two sessions of candles
 * with bubbles on the newer one. Two is the minimum that lets you see where the
 * ladder sat yesterday against where it sits now, which is most of the reason
 * to draw the trail at all.
 *
 * Two things make it work, and both matter before changing either:
 *
 *   - REACH. The route is windowed in MINUTES from now, so the request has to
 *     span both sessions AND the night between them. Computed from the days the
 *     chart actually has bars for (`bubbleMinutes`), so a weekend or a holiday
 *     stretches it instead of quietly returning one day.
 *   - `anyExpiry=1`, which the request already carried. Yesterday's columns were
 *     recorded against YESTERDAY's expiry; pinned to today's the second day
 *     comes back empty. This is the one place that flag earns its cost.
 */
const BUBBLE_DAYS = 2;
/**
 * Strikes the server returns per column, before the pick.
 *
 * It is a RANKING POOL, not what gets drawn — four survive (BUBBLES.levels).
 * It was 8, which is fine for "the strongest few" and not fine for "one each
 * side of spot": gamma is routinely lopsided enough that all 8 sit above price,
 * and then the forced side has nothing to choose. The desktop asks for 30; 16 is
 * the phone's compromise, because this payload is one column per minute over
 * BUBBLE_DAYS and every extra strike multiplies through all of it.
 */
const BUBBLE_LADDER_TOP = 16;
/** Hard ceiling on the reach, ~4 days. Guards against an absurd bar-day list. */
const BUBBLE_MINUTES_MAX = 5760;
/** Reach before the chart has bars to measure from - the hook's own default. */
const BUBBLE_MINUTES_MIN = 420;

/**
 * How long `schedulePaint` keeps retrying a bubble paint that has not landed.
 *
 * Long enough to cover a cold lazy-chunk load plus the chart's own layout on a
 * slow phone, short enough that a genuinely empty trail (no columns for any day
 * the chart is showing) stops costing frames. It re-arms on every data change,
 * so this is a per-attempt budget, not a total.
 */
const PAINT_RETRY_MS = 4_000;

const BUBBLE_SCALE_MIN = 0.4;
const BUBBLE_SCALE_MAX = 3;
const BUBBLE_SCALE_STEP = 0.1;
const BUBBLE_SCALE_DEFAULT = 1;

/**
 * Price-axis zoom.
 *
 * A multiplier on the autoscaled price range: 1 = exactly what autoscale wants,
 * >1 narrows it (zoom in, fewer points per screen), <1 widens it (zoom out, more
 * context). 0.4 shows ~2.5× the day's range — enough to put an overnight session
 * and both walls on screen at once; 12 gets down to a couple of points across
 * 390px, which is about as far as tick-level scalping needs.
 */
const Y_ZOOM_MIN = 0.4;
const Y_ZOOM_MAX = 12;
const Y_ZOOM_DEFAULT = 1;

/**
 * The press-and-slide gesture on the axis.
 *
 * `PX_PER_DOUBLE` — vertical pixels that double (or halve) the zoom. It is
 * exponential, not linear, so the gesture feels identical whether you are at
 * 0.5× or 8×; 150px means a comfortable thumb slide of about a third of the
 * chart's height per doubling, and the full 0.4–12 range is reachable in one
 * stroke without being twitchy.
 *
 * `DEADZONE` — movement below this is still a tap, not a drag, so a double-tap
 * reset never nudges the zoom on its way through.
 *
 * `DOUBLE_TAP_MS` — two taps inside this window reset to 1×. This replaces the
 * library's own axis double-click reset, which the strip intercepts.
 */
const AXIS_ZOOM_PX_PER_DOUBLE = 150;
const AXIS_ZOOM_DEADZONE = 4;
const AXIS_ZOOM_DOUBLE_TAP_MS = 320;

/** Widest the axis strip is allowed to get if the price scale reports nonsense. */
const AXIS_STRIP_MAX_W = 76;

/**
 * Squeeze/widen the autoscaled range around its midpoint.
 *
 * Anchoring on the midpoint of what autoscale ASKED FOR (not on the last price,
 * and not on a frozen range) is what keeps this usable without a vertical pan
 * gesture: the anchor is the centre of the bars currently in view, so zooming in
 * pulls toward the visible price action and panning the time axis re-anchors.
 */
function zoomedAutoscale(
  base: () => AutoscaleInfo | null,
  zoom: number,
): AutoscaleInfo | null {
  const info = base();
  if (!info?.priceRange) return info;
  if (!(zoom > 0) || Math.abs(zoom - 1) < 1e-6) return info;
  const { minValue, maxValue } = info.priceRange;
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return info;
  const mid = (minValue + maxValue) / 2;
  // A degenerate range (one flat bar) has no half-width to scale — invent a
  // small one so zooming still does something instead of silently no-op'ing.
  const half = Math.abs(maxValue - minValue) / 2 || Math.max(0.25, Math.abs(mid) * 1e-4);
  const next = half / zoom;
  return { ...info, priceRange: { minValue: mid - next, maxValue: mid + next } };
}

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
  // gated on `enabled`, so turning them off stops the fetch too.
  const [showBubbles, setShowBubbles] = useState(true);
  const [bubbleScale, setBubbleScale] = useState(BUBBLE_SCALE_DEFAULT);
  const [yZoom, setYZoom] = useState(Y_ZOOM_DEFAULT);
  // Live width of the right price scale, so the zoom strip covers exactly the
  // axis and not a pixel of the plot (covering the plot would eat pans on the
  // newest bars, which sit right against the axis).
  const [axisW, setAxisW] = useState(46);
  const [zooming, setZooming] = useState(false);
  const [ovlOpen, setOvlOpen] = useState(false);
  // `loaded` only tells the two empty states apart below: a response in hand
  // means the recorder answered and the chart is empty for a session/window
  // reason rather than because nothing has arrived yet.
  //
  // `connected` here means "the recorder answered WITH rows", not "a socket is
  // open" — this page no longer holds one. LIVE is still the honest label on
  // the status dot: bars arriving on the poll plus a spot-driven tip on the
  // newest one is what live looks like for SPX cash.
  const { rows: spxCandles, loaded, connected } = useEtfCandles(
    SPX_SYMBOL,
    interval === "1" ? SPX_DAYS_1M : SPX_DAYS_5M,
    interval === "1" ? 1 : 5,
  );

  const g = useMobileGex("oi-vol");

  /**
   * The bars the chart actually draws: the recorder's rows, plus a LIVE TIP.
   *
   * The tip is why this page does not feel frozen on a 60s poll. The recorder
   * writes SPX bars once a minute, so between polls the newest bar is up to a
   * minute stale — but the socket's `spot` frame is the same index, live. So
   * the last bar's close is redrawn from spot, with its high/low widened to
   * contain it, exactly the way the bar itself will be written when the
   * recorder catches up.
   *
   * Guarded on the bar being TODAY's: off-hours and at weekends the newest bar
   * is a previous session's close, and dragging that to the current spot would
   * invent a print that never happened.
   *
   * Everything downstream reads this rather than the raw rows — the bubble
   * trail maps each column to the bar it falls in, so a trail drawn against
   * bars the chart is not showing would sit at the wrong x.
   */
  const chartCandles = useMemo(() => {
    const base = spxCandles;
    const spot = g.spot;
    if (!base.length || !spot || !Number.isFinite(spot)) return base;
    const tail = base[base.length - 1];
    if (etDayKey(tail.timestamp) !== etDayKey(Date.now())) return base;
    if (spot === tail.close) return base;
    return [
      ...base.slice(0, -1),
      { ...tail, close: spot, high: Math.max(tail.high, spot), low: Math.min(tail.low, spot) },
    ];
  }, [spxCandles, g.spot]);

  // Which ET days the chart actually has bars for — the bubble history needs
  // this to pick the days the trail can be drawn on (see the hook's header).
  // Taken from the DRAWN bars: a bubble with no bar under it is dropped by the
  // renderer anyway.
  //
  // IDENTITY-STABLE, and that is the point of the two-step. `chartCandles` gets
  // a new array on every spot tick (the live tip, ~1/s), so the obvious
  // one-memo version handed out a new `barDayKeys` array at that rate even
  // though the day list changes once a session. `bubbleMinutes` memoises on it,
  // so it recomputed at the same rate — and its VALUE moves every minute, which
  // re-ran useGexBubbleHistory's effect and cancelled whatever load was in
  // flight. Joining to a string and splitting back gives a value that only
  // changes when the days do.
  const barDayKeysCsv = useMemo(() => {
    const set = new Set<string>();
    for (const r of chartCandles) set.add(etDayKey(r.timestamp));
    return [...set].join(",");
  }, [chartCandles]);
  const barDayKeys = useMemo(
    () => (barDayKeysCsv ? barDayKeysCsv.split(",") : []),
    [barDayKeysCsv],
  );

  /**
   * Minutes of history to ask for — the reach that makes BUBBLE_DAYS real.
   *
   * Counted from 04:00 ET on the OLDEST day we want, forward to now, rather
   * than `days x 1440`: a Monday has to reach back to Friday, and a holiday
   * Monday to the Friday before that. The bar-day list already encodes which
   * days traded, so it answers both without a market calendar.
   *
   * 08:00Z is 04:00 EDT — before any session column of that day, and early
   * enough that the EST/EDT hour makes no difference at this resolution.
   */
  const bubbleMinutes = useMemo(() => {
    const oldest = [...barDayKeys].sort().slice(-BUBBLE_DAYS)[0];
    if (!oldest) return BUBBLE_MINUTES_MIN;
    const start = Date.parse(`${oldest}T08:00:00Z`);
    if (!Number.isFinite(start)) return BUBBLE_MINUTES_MIN;
    const mins = Math.ceil((Date.now() - start) / 60_000) + 60;
    return Math.min(BUBBLE_MINUTES_MAX, Math.max(BUBBLE_MINUTES_MIN, mins));
  }, [barDayKeys]);

  const bubbleCols = useGexBubbleHistory({
    enabled: showBubbles,
    expiry: g.expiry,
    minutes: bubbleMinutes,
    days: BUBBLE_DAYS,
    top: BUBBLE_LADDER_TOP,
    barDayKeys,
  });

  const railRows: RailRow[] = useMemo(
    () => g.chain.map((r) => ({ strike: r.strike, net: netGEXOf(r, "net", g.spot) })),
    [g.chain, g.spot],
  );

  // No basis gate any more. Every overlay on this page is SPX-denominated and
  // so is the chart, so there is nothing to convert and nothing that can go
  // stale between two instruments — the old `basisOk` was the single reason the
  // bubbles, levels and gutter panels all went dark off-hours. What is left is
  // the honest question: is there a ladder to draw?
  const panelOn = sidePanel !== "none" && g.chain.length > 0;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const didFitRef = useRef(false);
  // Read inside autoscaleInfoProvider, which is installed once at series
  // creation and must not be re-created mid-gesture.
  const yZoomRef = useRef(yZoom);
  const measureAxisRef = useRef<() => void>(() => {});
  // Live gesture state. A ref, not state: this updates on every pointermove and
  // nothing about it belongs in a render.
  const zoomDragRef = useRef<{ y0: number; z0: number; moved: boolean } | null>(null);
  // Mirror state → ref, EXCEPT mid-gesture: the ref leads during a slide, and a
  // render triggered by the 4Hz feed carries a `yZoom` one move behind, which
  // would stutter the axis back a frame.
  if (!zoomDragRef.current) yZoomRef.current = yZoom;
  const lastAxisTapRef = useRef(0);

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
      // Touch: one finger pans, two fingers pinch-zoom the time axis. Vertical
      // drag INSIDE the plot stays off — on a phone it is impossible to separate
      // from a pan. Price zoom lives on the axis itself (drag the gutter,
      // double-tap it to reset) and on the ± stepper; see the header note.
      handleScroll: { vertTouchDrag: false, horzTouchDrag: true, mouseWheel: true, pressedMouseMove: true },
      handleScale: {
        pinch: true,
        // price: false on BOTH — the axis strip owns the price gesture, and the
        // built-in versions would fight it by freezing the range (header note).
        axisPressedMouseMove: { time: true, price: false },
        axisDoubleClickReset: { time: true, price: false },
        mouseWheel: true,
      },
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
      autoscaleInfoProvider: (base) => zoomedAutoscale(base, yZoomRef.current),
    });

    chartRef.current = chart;
    seriesRef.current = series;

    let lastW = 0;
    let lastH = 0;
    let lastAxisW = 0;
    // The axis is as wide as its widest label, so it changes with the price
    // format and with a locale's separators — measure rather than assume.
    const measureAxis = () => {
      let aw = 0;
      try {
        aw = chart.priceScale("right").width();
      } catch {
        aw = 0;
      }
      const clamped = Math.min(AXIS_STRIP_MAX_W, Math.max(28, Math.round(aw) || 46));
      if (clamped !== lastAxisW) {
        lastAxisW = clamped;
        setAxisW(clamped);
      }
    };
    const applySize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) {
        lastW = w;
        lastH = h;
        chart.applyOptions({ width: w, height: h });
      }
      measureAxis();
    };
    measureAxisRef.current = measureAxis;

    const ro = new ResizeObserver(applySize);
    ro.observe(host);

    // The host is 0-height for the first frame or two while the flex column
    // resolves. Pump on rAF until it has a real box, or the chart stays stuck
    // at its initial collapsed size.
    //
    // It keeps pumping past that point for ~3s purely to settle the AXIS width:
    // the price scale reports 0 until the first paint and its final width until
    // the first bars widen its labels, and the zoom strip is sized from it.
    let raf = 0;
    let tries = 0;
    const pump = () => {
      applySize();
      tries += 1;
      const stillCollapsed = lastW === 0 || lastH === 0;
      if (stillCollapsed ? tries < 120 : tries < 180) raf = requestAnimationFrame(pump);
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

  // ── price-axis zoom ────────────────────────────────────────────────────────
  /**
   * Push the current multiplier into the chart.
   *
   * The price range is CACHED — `autoscaleInfoProvider` is only consulted when
   * the cache has been invalidated, which normally happens on new data, a pan or
   * a resize. So a multiplier change needs an explicit invalidation, and the only
   * public call that performs one is passing `mode` to the price scale:
   * `setAutoScale(true)` / `applyOptions({ autoScale: true })` merge the option
   * and repaint from the STALE range, which is why the zoom appeared to do
   * nothing at rest and only caught up on the next tick.
   *
   * Re-passing the mode it already has (Normal) is the invalidation; `autoScale`
   * rides along so the zoom also re-arms autoscale if anything ever turned it
   * off, and can therefore never get stuck.
   */
  const applyYZoom = useCallback(() => {
    try {
      seriesRef.current?.priceScale().applyOptions({
        autoScale: true,
        mode: PriceScaleMode.Normal,
      });
    } catch {
      /* series torn down mid-gesture */
    }
  }, []);

  useEffect(() => {
    applyYZoom();
  }, [applyYZoom, yZoom]);

  const resetYZoom = useCallback(() => {
    yZoomRef.current = Y_ZOOM_DEFAULT;
    setYZoom(Y_ZOOM_DEFAULT);
    applyYZoom();
  }, [applyYZoom]);

  /**
   * Press-and-slide on the axis strip.
   *
   * The multiplier is written to `yZoomRef` and pushed to the chart IMMEDIATELY,
   * before React re-renders — the provider reads the ref, so the axis tracks the
   * thumb at pointer-event rate instead of waiting on a render. `setYZoom` still
   * runs so the readout and the reset chip stay honest, but nothing about the
   * zoom itself depends on that render landing.
   *
   * Pointer capture means a slide that wanders off the 46px strip — which a
   * thumb does constantly — keeps zooming instead of dying halfway.
   */
  const onAxisPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button != null && e.button > 0) return;
      zoomDragRef.current = { y0: e.clientY, z0: yZoomRef.current, moved: false };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety, the gesture still works without it */
      }
    },
    [],
  );

  const onAxisPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = zoomDragRef.current;
      if (!d) return;
      const dy = e.clientY - d.y0;
      if (!d.moved) {
        if (Math.abs(dy) < AXIS_ZOOM_DEADZONE) return;
        d.moved = true;
        setZooming(true);
      }
      // Up (negative dy) zooms IN — the same direction as pulling the price
      // labels apart, which is what the gesture looks like it's doing.
      const next = d.z0 * Math.pow(2, -dy / AXIS_ZOOM_PX_PER_DOUBLE);
      const clamped = Math.min(Y_ZOOM_MAX, Math.max(Y_ZOOM_MIN, next));
      if (clamped === yZoomRef.current) return;
      yZoomRef.current = clamped;
      applyYZoom();
      setYZoom(clamped);
    },
    [applyYZoom],
  );

  const onAxisPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = zoomDragRef.current;
      zoomDragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      if (!d) return;
      if (d.moved) {
        setZooming(false);
        return;
      }
      // A tap, not a slide: second tap inside the window resets. Using the event
      // clock (not Date.now via a timer) keeps this to one source of truth.
      const now = e.timeStamp || performance.now();
      if (now - lastAxisTapRef.current < AXIS_ZOOM_DOUBLE_TAP_MS) {
        lastAxisTapRef.current = 0;
        resetYZoom();
      } else {
        lastAxisTapRef.current = now;
      }
    },
    [resetYZoom],
  );

  const onAxisPointerCancel = useCallback(() => {
    zoomDragRef.current = null;
    setZooming(false);
  }, []);

  // ── candles ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const data: CandlestickData[] = chartCandles.map((r) => ({
      time: toChartTime(r.timestamp),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
    }));
    series.setData(data);
    // First real data widens the axis from empty to "6000.00" — re-measure, on
    // the next frame because the width isn't known until that paint, or the zoom
    // strip stays sized for the empty chart.
    const axisRaf = requestAnimationFrame(() => measureAxisRef.current?.());
    if (data.length && !didFitRef.current) {
      didFitRef.current = true;
      // Open on the most recent stretch rather than the whole pull: several
      // sessions of 1-minute bars fitted into 390px is an unreadable grey band.
      const bars = interval === "1" ? 90 : 70;
      const to = data.length - 1;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, to - bars), to: to + 2 });
    }
    return () => cancelAnimationFrame(axisRaf);
  }, [chartCandles, interval]);

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
  // Returns whether marks actually landed — see drawBubbles / schedulePaint.
  const bubbleDrawRef = useRef<() => boolean>(() => false);
  // Declared here rather than beside the bubble block below because the repaint
  // driver (next) reads its box.
  const bubbleCanvasRef = useRef<HTMLCanvasElement | null>(null);

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
    if (!panelOn && !showBubbles) return;
    let raf = 0;
    let lastKey = "";
    const tick = () => {
      const s2 = seriesRef.current;
      const chart = chartRef.current;
      if (s2 && chart) {
        const probe = s2.priceToCoordinate(6000);
        const range = chart.timeScale().getVisibleLogicalRange();
        // The canvas BOX is part of the key, not just the mapping. The phone
        // page mounts lazily into a flex column that is 0-high for the first
        // frames (there is an rAF pump in the chart-init effect for exactly
        // that), and a layer that first painted at a collapsed size has to
        // repaint when the box resolves — a resize does not move `probe` if
        // autoscale lands on the same range.
        const host = bubbleCanvasRef.current?.parentElement;
        const box = host ? `${host.clientWidth}x${host.clientHeight}` : "";
        const key = `${probe}|${range?.from ?? ""}|${range?.to ?? ""}|${box}`;
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
  }, [panelOn, showBubbles]);

  // ── bubbles ────────────────────────────────────────────────────────────────
  const bubbleDataRef = useRef({
    cols: bubbleCols,
    rows: chartCandles,
    scale: bubbleScale,
    // The bucket's own width in minutes — the chart's bar. It picks the size
    // profile, so it has to ride along rather than be closed over: drawBubbles
    // is created once and driven from this ref.
    intervalMinutes: interval === "1" ? 1 : 5,
  });
  bubbleDataRef.current = {
    cols: bubbleCols,
    rows: chartCandles,
    scale: bubbleScale,
    intervalMinutes: interval === "1" ? 1 : 5,
  };

  /**
   * Paint the trail. Returns TRUE only if marks actually landed on the canvas.
   *
   * The return value is the whole fix for "the bubbles only show up after I pan
   * the chart". Every `return` below is a NOT-READY-YET, not an error: the host
   * is still 0-high, the price scale has not resolved a coordinate, the columns
   * that came back fall outside the bars the chart is holding. The layer used to
   * be painted exactly once per data change, so a first paint that hit any of
   * those left a blank canvas with nothing scheduled to try again — and the only
   * things that did try again were a pan (which moves the repaint driver's key)
   * or a settings toggle (which re-runs the effect). Hence "randomly", and hence
   * the fix: the caller retries while this keeps saying false. See
   * `schedulePaint`.
   */
  const drawBubbles = useCallback((): boolean => {
    const cv = bubbleCanvasRef.current;
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!cv || !chart || !series) return false;
    const host = cv.parentElement;
    if (!host) return false;
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w < 4 || h < 4) return false;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { cols, rows, scale, intervalMinutes } = bubbleDataRef.current;
    if (!cols.length || !rows.length) return false;

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
     * Bucket the trail to the chart's BARS.
     *
     * The history is 1-minute granular. On a 5-minute chart that is five
     * columns landing on one bar's x, and at these radii they overlap into a
     * solid horizontal band per strike — the trail stops reading as a trail.
     * The desktop solves it with a bucket selector whose default is the bar;
     * this does the same thing without the selector.
     *
     * LAST column in a bar wins, so a bucket shows where the ladder ENDED that
     * bar — consistent with a candle close, and it is the whole column that
     * wins, because the strike PICK below has to rank a real ladder rather than
     * a merge of several minutes' leaders.
     */
    const byBar = new Map<number, { ts: number; cells: { strike: number; net: number }[]; spot: number }>();
    for (const col of cols) {
      const bar = barIndexAt(col.ts);
      if (bar == null) continue;
      const prev = byBar.get(bar);
      if (!prev || col.ts >= prev.ts) byBar.set(bar, { ts: col.ts, cells: col.cells, spot: col.spot });
    }
    if (!byBar.size) return false;

    // Four strikes a bucket, one forced each side of that bucket's own spot —
    // the desktop's rule, from the same BUBBLES constants (see lib/gexBubbleModel).
    const picked = new Map<number, ReturnType<typeof pickBubbleStrikes>>();
    for (const [bar, col] of byBar) {
      const chosen = pickBubbleStrikes(col.cells, col.spot || null);
      if (chosen.length) picked.set(bar, chosen);
    }
    if (!picked.size) return false;

    // ONE denominator for every mark on screen, taken over the strikes actually
    // DRAWN. Per bucket it would renormalise every quiet minute back up to full
    // size, which is what makes a trail bulge and pinch instead of taper.
    let windowMax = 0;
    for (const chosen of picked.values()) {
      for (const c of chosen) windowMax = Math.max(windowMax, Math.abs(c.net));
    }
    if (!windowMax) return false;

    // Bar spacing at this zoom, measured off the last two bars.
    let spacing = 12;
    if (rows.length > 1) {
      const x0 = ts.timeToCoordinate(toChartTime(rows[rows.length - 2].timestamp));
      const x1 = ts.timeToCoordinate(toChartTime(rows[rows.length - 1].timestamp));
      if (x0 != null && x1 != null) spacing = Math.abs((x1 as number) - (x0 as number)) || 12;
    }

    // Fewer dots, not smaller ones — and the size profile for the cadence as
    // DRAWN (bucket x stride), shrunk to the room that exists. `scale` is the
    // sheet's variance slider; at its default of 1 this is exactly the desktop.
    const stride = bubbleStride(spacing);
    const size = bubbleSize(intervalMinutes, spacing, stride, scale);

    const bars = [...picked.keys()].sort((a, b) => a - b);
    const firstTs = rows[bars[0]!]!.timestamp;
    const lastTs = rows[bars[bars.length - 1]!]!.timestamp;
    const span = Math.max(1, lastTs - firstTs);

    const xCache = new Map<number, number | null>();
    const xOfBar = (bar: number) => {
      if (!xCache.has(bar)) {
        const x = ts.timeToCoordinate(toChartTime(rows[bar].timestamp));
        xCache.set(bar, x == null ? null : (x as number));
      }
      return xCache.get(bar) ?? null;
    };

    const posRgb = M_COLOR.pos;
    const negRgb = M_COLOR.neg;

    // Counted, not inferred. Everything above can succeed and still put nothing
    // on screen — every bucket off-screen at this pan, or every strike outside
    // the price range — and the caller's retry has to be able to tell that from
    // a real paint.
    let drew = 0;

    for (let i = 0; i < bars.length; i += stride) {
      const bar = bars[i]!;
      const cx0 = xOfBar(bar);
      if (cx0 == null || cx0 < -40 || cx0 > w + 40) continue;
      const marks = toBubbleMarks(picked.get(bar)!, windowMax);
      if (!marks.length) continue;
      const age = bubbleAge(rows[bar]!.timestamp, firstTs, span);

      const placed: BubbleRow<(typeof marks)[number]>[] = [];
      for (const m of marks) {
        // The strike IS the price — chart and ladder are both SPX.
        const y = priceToY(m.strike);
        if (y == null || y < -20 || y > h + 20) continue;
        placed.push({ m, y, r: bubbleRadius(m, size), dx: 0 });
      }
      if (!placed.length) continue;
      fitBubbleRows(placed);
      drew += placed.length;

      for (const { m, y, r, dx } of placed) {
        const positive = m.value >= 0;
        const base = positive ? posRgb : negRgb;
        const alpha = bubbleAlpha(m, age);
        const cx = cx0 + dx;
        ctx.beginPath();
        if (m.isTop) {
          // The bucket's leader: bright core, its own glow, a white ring. The
          // desktop's three-part treatment — it is what makes the wall of the
          // moment findable without reading every radius.
          ctx.fillStyle = rgba(base, Math.min(1, alpha));
          ctx.shadowColor = rgba(base, 0.95);
          ctx.shadowBlur = Math.min(size.glowPx, r * BUBBLES.glowFactor);
          ctx.arc(cx, y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.shadowColor = "transparent";
          ctx.beginPath();
          ctx.lineWidth = size.ringPx;
          ctx.strokeStyle = `rgba(255,255,255,${(0.85 * age).toFixed(3)})`;
          ctx.arc(cx, y, r, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = rgba(base, alpha);
          ctx.arc(cx, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    return drew > 0;
  }, [priceToY]);

  /**
   * Ask for a paint, and keep asking until one lands.
   *
   * THE BUG THIS EXISTS FOR. The trail was painted from one effect keyed on the
   * data, and nothing else. That effect fires at the right MOMENT — the instant
   * `bubbleCols` arrives — and on this page that moment is routinely too early:
   * the route is lazy-loaded into a flex column that is 0-high for the first
   * frames, the chart is created at that collapsed size and resized by an rAF
   * pump, and lightweight-charts cannot answer `priceToCoordinate` /
   * `timeToCoordinate` until it has laid out with data. So the one paint the
   * layer was going to get was spent on a canvas that could not draw, and
   * `drawBubbles` returned quietly.
   *
   * After that, the ONLY things that repainted it were the rAF driver's change
   * key (a pan, a pinch, an autoscale — i.e. moving the chart) and a re-run of
   * the data effect (a settings toggle, or the next 60s poll). Which is exactly
   * the reported symptom: bubbles that show up "randomly", after you pan or
   * change a setting.
   *
   * A retry, not a longer delay: readiness here is a race against layout,
   * network and the chart's own internals, and no single timeout is right for
   * all three. Retrying on animation frames costs one function call per frame
   * for at most PAINT_RETRY_MS and stops dead the moment a paint lands.
   */
  const paintRafRef = useRef(0);
  const paintUntilRef = useRef(0);

  const schedulePaint = useCallback(() => {
    paintUntilRef.current = Date.now() + PAINT_RETRY_MS;
    if (paintRafRef.current) return;
    const attempt = () => {
      paintRafRef.current = 0;
      const painted = bubbleDrawRef.current?.() ?? false;
      if (painted || Date.now() > paintUntilRef.current) return;
      paintRafRef.current = requestAnimationFrame(attempt);
    };
    paintRafRef.current = requestAnimationFrame(attempt);
  }, []);

  useEffect(
    () => () => {
      if (paintRafRef.current) cancelAnimationFrame(paintRafRef.current);
    },
    [],
  );

  useEffect(() => {
    bubbleDrawRef.current = drawBubbles;
    // Synchronously first — when the chart IS ready (every case after the first
    // paint) this is the only call that happens and the retry never arms.
    if (!drawBubbles()) schedulePaint();
  }, [drawBubbles, schedulePaint, bubbleCols, chartCandles, bubbleScale, interval]);

  /**
   * Two backstops, both lifted from the desktop chart, which has had them since
   * long before this page existed:
   *
   *   - a ResizeObserver on the canvas's own box. The rAF driver's key now
   *     includes that box, but the observer fires on the frame the box changes
   *     instead of whenever the driver next samples, which is what makes a
   *     rotate or a keyboard dismissal repaint immediately.
   *   - a low-rate interval, skipped while the tab is hidden and re-armed on
   *     visibilitychange. 5s, like the desktop's: it is a safety net for a
   *     readiness case nobody predicted, not a render loop, and it costs one
   *     canvas clear when nothing has changed.
   */
  useEffect(() => {
    if (!showBubbles) return;
    const host = bubbleCanvasRef.current?.parentElement;
    const ro = host ? new ResizeObserver(() => schedulePaint()) : null;
    if (host && ro) ro.observe(host);

    const onVisible = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") schedulePaint();
    };
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      schedulePaint();
    }, 5_000);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);

    return () => {
      ro?.disconnect();
      clearInterval(id);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }, [showBubbles, schedulePaint]);

  // ── SPX level lines, drawn where they are ──────────────────────────────────
  const levels = useMemo(() => {
    if (!showLevels) return [];
    const out: { price: number; color: string; title: string }[] = [];
    if (g.flip != null) out.push({ price: g.flip, color: M_COLOR.orange, title: "FLIP" });
    if (g.callWall != null) out.push({ price: g.callWall, color: M_COLOR.pos, title: "CW" });
    if (g.putWall != null) out.push({ price: g.putWall, color: M_COLOR.neg, title: "PW" });
    return out;
  }, [showLevels, g.flip, g.callWall, g.putWall]);

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

  const last = chartCandles.length ? chartCandles[chartCandles.length - 1] : null;
  const first = chartCandles.length ? chartCandles[0] : null;
  const chg = last && first ? last.close - first.open : null;
  const chgPct = chg != null && first && first.open > 0 ? (chg / first.open) * 100 : null;
  const up = (chg ?? 0) >= 0;
  // Badge on the Overlays button so the sheet's state is visible without
  // opening it — the count is what is actually DRAWING, not what is toggled on.
  const overlayCount =
    (showLevels && levels.length > 0 ? 1 : 0) + (panelOn ? 1 : 0) + (showBubbles ? 1 : 0);

  return (
    <MobileShell
      title="SPX Candles"
      fill
      right={<MStatusDot live={connected} label={connected ? "LIVE" : "…"} />}
      sticky={
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {/* Price gets its own line. Once "γ" became "Overlays" the single row
              could no longer hold price + change + interval + button at 390px,
              and the interval control started overlapping the change figure. */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
            <span style={{ fontSize: TYPE.micro, fontWeight: 800, letterSpacing: "0.1em", color: M_COLOR.faint }}>
              SPX
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
            <ExpiryBadge expiry={g.expiry} isZeroDte={g.isZeroDte} dte={g.dte} />
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
          {showBubbles && (
            <canvas
              ref={bubbleCanvasRef}
              style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}
            />
          )}
          {/* Price-axis zoom strip.
              Exactly as wide as the price scale (measured, see `axisW`) and the
              full height of the plot, so it owns every touch on the axis and
              none on the candles. Transparent — the axis labels underneath ARE
              the affordance; it only tints while a slide is live so you can see
              which axis you grabbed. `touchAction: "none"` stops the browser
              claiming the vertical drag as a page scroll, which is what would
              otherwise kill the gesture on the first pixel. */}
          <div
            role="slider"
            aria-label="Price axis zoom — slide up to zoom in, down to zoom out, double-tap to reset"
            aria-valuemin={Y_ZOOM_MIN}
            aria-valuemax={Y_ZOOM_MAX}
            aria-valuenow={Number(yZoom.toFixed(2))}
            tabIndex={-1}
            onPointerDown={onAxisPointerDown}
            onPointerMove={onAxisPointerMove}
            onPointerUp={onAxisPointerUp}
            onPointerCancel={onAxisPointerCancel}
            style={{
              ...noTapHighlight,
              position: "absolute",
              top: 0,
              right: 0,
              width: axisW,
              // Clear of the time axis, or the strip would swallow taps meant
              // for it. 22px is that axis's own label band.
              bottom: 22,
              zIndex: 4,
              cursor: "ns-resize",
              touchAction: "none",
              background: zooming ? rgba(M_COLOR.cyan, 0.09) : "transparent",
              borderLeft: zooming ? `1px solid ${rgba(M_COLOR.cyan, 0.35)}` : "1px solid transparent",
            }}
          />

          {/* Readout. Live factor while sliding; afterwards it stays as a
              tap-to-reset chip until the zoom is back at 1×, which is the only
              standing hint that the chart is not on autoscale. */}
          {(zooming || Math.abs(yZoom - Y_ZOOM_DEFAULT) > 1e-6) && (
            <button
              type="button"
              onClick={resetYZoom}
              title="Reset price zoom"
              style={{
                ...noTapHighlight,
                ...MONO,
                position: "absolute",
                right: axisW + 6,
                top: 6,
                zIndex: 5,
                minHeight: 24,
                padding: "0 8px",
                borderRadius: RADIUS.sm,
                border: `1px solid ${rgba(M_COLOR.cyan, 0.4)}`,
                background: "rgba(5,8,13,0.72)",
                color: M_COLOR.cyan,
                fontSize: TYPE.micro,
                fontWeight: 800,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              {yZoom.toFixed(2)}×
              {!zooming && <span style={{ fontWeight: 900, opacity: 0.8 }}>✕</span>}
            </button>
          )}
          {chartCandles.length === 0 && (
            <div style={{ position: "absolute", inset: 0, display: "flex" }}>
              {/* Say which of the two it actually is. This used to read
                  "Connecting to the live feed…" for ANY empty chart, so a
                  quiet weekend was indistinguishable from a dead feed — and it
                  is what made this page look like it could not reconnect when
                  nothing was wrong with it. */}
              <MEmpty tall>
                {loaded
                  ? "No SPX bars in range — waiting for the next session"
                  : "Loading the SPX tape…"}
              </MEmpty>
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
              // Chart and ladder are the same instrument now — the rail's basis
              // offset is structurally zero, not "zero because we lack one".
              basis={0}
              priceToY={priceToY}
              drawRef={railDrawRef}
            />
          </div>
        )}
        {panelOn && sidePanel === "chain" && (
          <MobileChainRail
            chain={g.chain}
            spot={g.spot}
            basis={0}
            width={GUTTER_W}
            priceToY={priceToY}
            drawRef={chainDrawRef}
          />
        )}
      </div>

      <MSheet
        open={ovlOpen}
        title="Overlays"
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
          hint={`Per-minute GEX trail over the last ${BUBBLE_DAYS} sessions, sized by magnitude.`}
          on={showBubbles}
          onToggle={() => setShowBubbles((v) => !v)}
        />
        {showBubbles && (
          <MSlider
            label="Bubble size variance"
            hint="Scales the largest bubbles only — the smallest stay put. 1.0× is the desktop chart's own sizing."
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
          hint="Gamma flip and both walls, at their own SPX prices."
          on={showLevels}
          onToggle={() => setShowLevels((v) => !v)}
        />
      </MSheet>

    </MobileShell>
  );
}
