"use client";

/**
 * ONE ES Candles chart card: dock, candle chart, price-aligned canvas overlays
 * (GEX heatmap, bubbles, volume profile, TPO, level lines), the stat row, and a
 * slot for the page's side panel.
 *
 * This is the whole of what /es-candles used to be. It moved out of the route so
 * the page can mount up to three of them in a row, each fully independent —
 * its own symbol, timeframe, expiry, overlays and persisted settings. Anything
 * genuinely global (favorites, the pinned bubble preset, the side-panel choice)
 * is deliberately NOT in here; see slotStore.ts for the split.
 *
 * Two rules the multi-card layout imposes on this file:
 *   1. No module-level mutable state and no un-namespaced localStorage key. Every
 *      persisted setting goes through slotStore keyed by `slot`.
 *   2. Nothing may assume it owns the viewport. Every portal clamps, and the
 *      dock has a compact density for when the card is a third of the screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart } from "lightweight-charts";
import type { UTCTimestamp, IChartApi, ISeriesApi, IPriceLine, CandlestickData, LineData, HistogramData } from "lightweight-charts";
import { useEsCandles } from "@/hooks/useEsCandles";
import { useEtfCandles } from "@/hooks/useEtfCandles";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import { useGexSocket, type GexMessage } from "@/lib/gexSocket";

// Reads gexRows off snapshot/gex, plus spot/aux for the price legs. "status"
// is included because the expiry + expirations list rides on it — this card's
// handler ignores that frame today, but the card DOES read `expiry` /
// `expirations` off whatever frame it gets, so scoping it out would make that
// path strictly worse than it already is.
const ES_CHART_TOPICS = ["gex", "spot", "aux", "status"] as const;
import { dedupeFetch } from "@/lib/dedupeFetch";
// cachedJson, NOT dedupeFetch, for the page-GLOBAL reads below (levels, mvc,
// basis, eod-gex). dedupeFetch only collapses requests that overlap in time; it
// cannot help three cards whose 60s polls land 40ms apart, or a card that mounts
// a second after its siblings. Those are sequential, so every one of them used
// to open its own socket. See the header of lib/sharedCache.ts.
import { cachedJson, HttpError } from "@/lib/sharedCache";
// The flip is computed HERE with findGEXFlip, same as the home page, so the two
// pages agree by construction. Do NOT source it from mvc_snapshots.gexFlip: both
// recorders (scripts/auto-snapshot-mvc.js, server-v2/mvc-auto-snapshot.js) fall
// back to `mvcOIRow.strike` when /api/gex omits gexFlip, so that column silently
// holds the CB strike instead of a flip. Steadiness is handled at publish time
// (tick-quantized, 1-min cadence) — not by picking a different source.
import { findGEXFlip, type ChainRow } from "@/lib/calculations/calculations";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";
import { Dock, SegGroup, DockButton, DockGap, DockSlider, DockSpacer } from "@/components/shared/DockToolbar";
import FitScale from "@/components/shared/FitScale";
import { HOME_THEME, DOCK_THEME, LIGHT_BLUE, SOFT_RED, ES_CANDLE_UP, ES_CANDLE_DOWN, dissolveCardStyle } from "@/components/shared/homeTheme";
import { atMinIntensity, columnWalls, wallAt, INTENSITY_MIN, WALL_RANK } from "@/lib/calculations/heatLevels";
import type { RailRow } from "@/components/dashboard/EsGexRail";
import type { EsCandleRecord } from "@/lib/snapdb";

import {
  toChartTime, etDayKey, fmtEtHM, isPlausibleBasis, etMinutesOfDay, BUBBLE_SCALE_CUTOFF_MIN,
  isCashOpen, etSessionStarted, isEtWeekend, etMinutes, RTH_OPEN_MIN, RTH_CLOSE_MIN, buildVolumeProfile, TPO_PERIOD_MS, buildTpoProfile, SLOT_MS, slotFloorMs,
  SPOT_LINE_GRAY, EM_VIOLET, parseLevelNum, DEFAULT_VIEW_BARS, DEFAULT_VIEW_RIGHT_PAD, applyDefaultView,
  deriveColumnLevels, gexColor, gexRankColor,
  type GexCell, type GexColumn, type GexMetric, type VolumeProfile, type TpoProfile,
} from "./chartMath";
import {
  CHART_INTERVALS, INTERVAL_LABEL, intervalMs, isChartInterval, nativeIntervalFor, rollupCandles,
  type ChartInterval,
} from "./interval";
import { SymbolListDropdown, symbolDef, isChartSymbol, type ChartSymbol } from "./symbols";
import { PanelSection, PanelChip, SLIDER_LABEL_W, OVL_PANEL_W, OVL_VIEWPORT_PAD, OVL_MIN_H } from "./panelUi";
import {
  BUBBLE_CFG_DEFAULT, BUBBLE_CFG_RANGE, bubbleCfgFrom,
  readSlot, writeSlot, broadcastSlot, subscribeSlot,
  readBubbleDefault, writeBubbleDefault, isBubbleBucket,
  subscribeReplayCmd, INDICATORS_DEFAULT,
  type BubbleCfg, type BubbleBucket, type SlotId, type SlotBlob, type IndicatorCfg,
} from "./slotStore";
import { ema as emaOf, bollinger, rsi as rsiOf, fmtCountdown, EMA_COLORS, type BollingerBands } from "./indicators";
import SidePanel, { SIDE_PANEL_SPEC, type SidePanelKind } from "./SidePanel";
import type { ChainGreek } from "./ChainRail";

// Card/accent styling now sourced from the shared theme (see BUDGET_UI_STYLE.md).
const dissolveCard = dissolveCardStyle;

/**
 * Below this card width the dock switches to its compact density and the stat
 * row collapses to one line. Measured from the CARD, not from the card count:
 * one chart on a 1280 laptop is just as cramped as three on a 1920.
 */
const COMPACT_CARD_WIDTH = 760;

export interface EsChartCardProps {
  /**
   * Persistence namespace: 0 | 1 | 2 for the page's three cards, "embed" for the
   * home dashboard's card. Everything this card remembers is keyed by it.
   */
  slot?: SlotId;
  /**
   * Which panel rides the right edge. PAGE-level, identical for every card —
   * one chain fetch and one mental model instead of three cards disagreeing
   * about what's beside them.
   */
  sidePanel?: SidePanelKind;
  /**
   * `leading` renders as the first item in the dock, before the title. Routed as
   * /es-candles it receives nothing; the home dashboard passes its GEX|ES
   * Candles switcher in, which is why the embed costs no extra toolbar row.
   */
  leading?: ReactNode;
  /**
   * `embedded` = rendered inside the home GEX card rather than as its own route:
   *  - dock pins LEFT instead of centering. Centered, the dock indents by however
   *    wide it happens to be, so the switcher in `leading` lands in a different
   *    place than the GexToolbar's copy of it — the button jumps sideways out from
   *    under the cursor on every click.
   *  - overlays start at rail + bubbles, same as the full route, minus the
   *    heatmap. The heatmap is the layer worth dropping there: the card already
   *    sits next to the GEX chart and the heatmap panel, so a third copy of that
   *    read is noise — the rail and bubbles are what the card is FOR.
   * A first-render default only — every overlay stays toggleable.
   */
  embedded?: boolean;
  /**
   * Where everything EXCEPT the symbol is read from and written to. Defaults to
   * `slot`, which is the single-chart case: one card, one blob.
   *
   * With 2–3 charts the page points every card at SHARED_SLOT and renders ONE
   * toolbar, so a control there drives all of them. The symbol deliberately
   * stays on `slot` — it's the one thing that is still per chart.
   */
  settingsSlot?: SlotId;
  /**
   * `full`   — the card owns the whole dock (single chart / the home embed).
   * `shared` — this card's dock is portaled into `dockTarget` and becomes the
   *            page's shared toolbar; the card keeps only its ticker.
   * `symbol` — ticker only. The other cards in a shared-toolbar row.
   */
  dockMode?: "full" | "shared" | "symbol";
  /** Where a `shared` dock renders. Owned by the page's toolbar row. */
  dockTarget?: HTMLElement | null;
  /** Which greek the 0DTE chain panel paints. Page-level, like the panel. */
  chainGreek?: ChainGreek;
  /** Override the width-measured density. Mostly for the home embed and tests. */
  density?: "full" | "compact";
  /** Hide the per-card Snap/Discord buttons (the page owns one for the row). */
  hideCapture?: boolean;
  /**
   * Where the replay transport renders when the PAGE owns the Replay button.
   * null while the page's Replay popover is shut — the card keeps its replay
   * state either way, it just has nowhere to draw the controls.
   */
  transportTarget?: HTMLElement | null;
  /**
   * The page hosts the Replay button, so the card drops its own. Separate from
   * `transportTarget` being non-null on purpose: the target is null whenever the
   * popover is closed, and "the popover is shut" must not read as "put the old
   * button back".
   */
  hostedReplay?: boolean;
  /** Indicator overlays. Page-level — every chart in the row draws the same set. */
  indicators?: IndicatorCfg;
  /**
   * Page-owned controls injected into THIS card's dock (Charts / Replay /
   * Indicators). A node rather than a set of callbacks: the page owns all the
   * state behind these buttons, and handing the card five props to re-render
   * someone else's buttons would put half of each control in each file.
   */
  toolbarExtras?: ReactNode;
}

/**
 * Index of the last frame at or before `ts`, on THIS card's own bar grid.
 *
 * The shared replay cursor travels as a timestamp, so every card has to land it
 * on its own frames — the cards can be different symbols and a thin tape simply
 * prints fewer bars. Snapping BACKWARDS is the point: rounding to the nearest
 * frame would let a card reveal a bar that hasn't happened yet at the shared
 * cursor, and a replay that leaks the future is worse than one that lags a bar.
 * Frames are ascending, so the first frame past `ts` ends it.
 */
function frameIdxAtOrBefore(frames: number[], ts: number): number {
  let idx = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i] <= ts) idx = i; else break;
  }
  return idx;
}

export default function EsChartCard({
  slot = 0,
  settingsSlot,
  sidePanel = "rail",
  dockMode = "full",
  dockTarget,
  chainGreek = "gex",
  leading,
  embedded = false,
  density: densityProp,
  hideCapture = false,
  transportTarget,
  hostedReplay = false,
  indicators = INDICATORS_DEFAULT,
  toolbarExtras,
}: EsChartCardProps = {}) {
  // Everything but the symbol lives here. Same as `slot` for a lone chart.
  const cfgSlot: SlotId = settingsSlot ?? slot;
  const shared = String(cfgSlot) !== String(slot);
  // Bandwidth gate. Reconnect/backoff moved into lib/gexSocket, so the ref
  // mirror this used to need (read from inside the socket callbacks) is gone.
  const esShouldConnect = useWsLifecycle();

  // ── Card width → density ───────────────────────────────────────────────────
  // Drives the compact dock and the collapsed stat line, and feeds the side
  // panel's own fit rule below. Measured, not derived from the card count.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardW, setCardW] = useState(0);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setCardW(el.clientWidth));
    ro.observe(el);
    setCardW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // cardW === 0 on the very first paint (and under SSR). Treat unknown as
  // "full": guessing compact would flash the collapsed dock on every load.
  const compact = densityProp ? densityProp === "compact" : cardW > 0 && cardW < COMPACT_CARD_WIDTH;
  // `compact` is about how much room the CARD has. A shared dock doesn't render
  // in the card — it's portaled into the page's full-width toolbar row — so it
  // must not inherit the card's cramped density. The in-card chrome (the stat
  // row) still uses `compact`.
  const dockCompact = dockMode === "shared" ? false : compact;

  // ── Persisted per-slot settings ────────────────────────────────────────────
  // Read ONCE in an effect, never in a useState initializer: this component is
  // also server-rendered by Next for the /es-candles route, and a localStorage
  // read during the first render would be a hydration mismatch.
  // `settingsLoaded` gates the first heatmap backfill — see that effect for why
  // firing it before the restore lands costs a wasted ~1.6MB request per card.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // Every write is a read-modify-write MERGE inside writeSlot. A blind setItem
  // would drop whatever keys this caller doesn't know about, which is exactly
  // how the old bubble-slider write used to clobber the saved bucket.
  const saveSetting = useCallback((patch: Record<string, unknown>) => {
    // Writing also BROADCASTS (see writeSlot). In a shared-toolbar row every
    // card is subscribed to this slot, so one control moves all three on the
    // same tick — no prop drilling, and no re-render of the page above them.
    writeSlot(cfgSlot, patch);
  }, [cfgSlot]);

  // ── Active chart symbol ────────────────────────────────────────────────────
  const [symbol, setSymbolState] = useState<ChartSymbol>("ES");
  const setSymbol = useCallback((s: ChartSymbol) => {
    setSymbolState(s);
    // `slot`, never cfgSlot — the symbol is the one setting that stays per card
    // when the toolbar is shared. That is the whole point of three charts.
    writeSlot(slot, { symbol: s });
  }, [slot]);
  const sym = symbolDef(symbol);
  // The one predicate the rest of the page branches on. ES is the futures chart
  // with an SPX option overlay (basis applies); SPY/QQQ are cash instruments
  // whose own option strikes are already in the chart's price space.
  const isEs = sym.candles === "es";
  // Mirrored for the /ws/gex handler and the imperative canvas draws, which run
  // outside the render cycle and would otherwise keep whatever value they closed
  // over when they were set up.
  const isEsRef = useRef(isEs);
  isEsRef.current = isEs;

  // ── Timeframe ──────────────────────────────────────────────────────────────
  // 1m rides its own server stream; 5m is the native feed; 15m/30m/1h are rolled
  // up here from the 5m bars (see interval.ts for why that's the cheap path).
  const [interval, setIntervalState] = useState<ChartInterval>(5);
  const setInterval_ = useCallback((i: ChartInterval) => {
    setIntervalState(i);
    saveSetting({ interval: i });
  }, [saveSetting]);
  const candleMs = intervalMs(interval);
  // The overlay draw is imperative and closes over whatever it was set up with,
  // same reason gexMetricRef / bubbleMinsRef exist.
  const candleMsRef = useRef(candleMs);
  candleMsRef.current = candleMs;

  // historyDays = 2, not the hook's default 20. Nothing on THIS page reads back
  // further than 2 days: the chart window below is 2 days, the heatmap/bubble
  // backfill is capped at 2880min (option_strike_gex_history is pruned to 48h
  // server-side), and sessionCandles is a 30h rolling window. The 20-day pull was
  // ~114KB / 250ms on every load to feed avg5/avg14 (which this page never
  // destructured) and the VSA baseline (since removed).
  // The hook DEFAULT stays 20 so RelVol / IB Logic keep their full baselines.
  //
  // nativeIntervalFor(), NOT `interval`: only 1 and 5 exist as server
  // aggregations, so 15m/30m/1h all request 5m and roll up below. That keeps the
  // hook's `intervalMinutes` dep stable across those three, which is what makes
  // switching between them free — no map wipe, no SQLite re-query, no refetch.
  const nativeInterval = nativeIntervalFor(interval);
  const { sessionCandles: liveRows, historical: esHistorical, connected: esConnected, refresh: esRefresh } = useEsCandles(true, 2, nativeInterval);
  // ETF bars come over HTTP from the etf_candles recorder, not /ws/gex. Passing
  // "" when ES is active keeps the hook completely idle — no fetch, no interval.
  const { rows: etfRows, connected: etfConnected, refresh: etfRefresh } = useEtfCandles(isEs ? "" : sym.gexSymbol, 5, nativeInterval);

  // History feed for the derived layers (prior-session levels, the ES basis
  // anchor). ES has 2 sessions from SQLite; the ETF side has the window the
  // recorder backfills, and that same array doubles as its "live" rows since
  // there is no separate streaming source.
  const historical = isEs ? esHistorical : etfRows;
  const connected = isEs ? esConnected : etfConnected;

  // ── EM ±1σ bands (rides the PDH/ON overlay) ────────────────────────────────
  // Source: GET /api/levels?ticker=ES|SPY|QQQ → one ticker_levels row, published
  // by server-v2/levels-auto-publish.js each Friday 16:00 ET.
  //
  // SAME source and SAME fields as the "+1σ (EM)" / "−1σ (EM)" readouts on the
  // home GEX chart (see app/home/HomeClient.tsx — it reads /api/levels?ticker=SPX
  // and labels up/down as ±1σ), so the two pages cannot disagree. Note that
  // despite the ±1σ label those levels are the WEEKLY band, not a daily one:
  // levels-engine.js's getTargetExpiration filters `d >= 1 && d <= 10` and picks
  // the Friday, which structurally excludes 0DTE. There is no daily EM anywhere
  // a subscriber client can read — /api/estimated-move is a 501 stub and the one
  // real 0DTE calc (/api/social-media/daily-input) is owner-gated and SPX-only.
  //
  // Two things about this endpoint that are easy to get wrong:
  //   • It answers 200 with a literal `null` body when the ticker has never been
  //     published — not a 404. `!r.ok` does NOT catch that.
  //   • up/down/close are FORMATTED STRINGS, not numbers — levels-engine.js runs
  //     them through toLocaleString, so ES arrives as "7,650.25". Every existing
  //     consumer (EmCustomer) renders them raw as text, so the thousands
  //     separator has never mattered until now. Number("7,650.25") is NaN, and
  //     because SPY/QQQ sit under 1000 and carry no comma, a naive parse would
  //     look perfectly fine on the ETFs and silently drop the bands on ES only.
  //
  // Already in the CHART's price space — no basis conversion, unlike the GEX
  // walls. levels-engine computes ES as `indexClose + em + (esClose - indexClose)`
  // i.e. esClose ± em, and SPY/QQQ natively.
  const [emWeekly, setEmWeekly] = useState<{ up: number; down: number; exp: string } | null>(null);
  useEffect(() => {
    // Wait for the slot restore. `symbol` initialises to "ES" and only becomes
    // this card's real ticker in the restore effect below, which sets
    // settingsLoaded in the SAME batch — so without this guard a three-card row
    // where cards 2 and 3 are SPY/QQQ fired /api/levels?ticker=ES three times on
    // load and then fetched SPY and QQQ anyway. Three requests, all discarded.
    if (!settingsLoaded) return;
    let cancelled = false;
    const load = async () => {
      try {
        // Cached: the two /api/levels effects in THIS card plus every sibling
        // card on the same symbol collapse to one request. 150s = half the poll
        // below, so a real tick always crosses the TTL and refetches.
        const j = await cachedJson<Record<string, unknown>>(
          `/api/levels?ticker=${encodeURIComponent(sym.key)}`,
          { ttlMs: 150_000, persist: true },
        );
        if (cancelled) return;
        const up = parseLevelNum(j?.up);
        const down = parseLevelNum(j?.down);
        // Bands are NULLed server-side by /api/levels/expire-stale once the week
        // they were struck for has passed, so "missing" is the correct signal to
        // draw nothing rather than to fall back to a stale band.
        setEmWeekly(up != null && down != null ? { up, down, exp: String(j?.exp_label ?? "") } : null);
      } catch (e) {
        // An HTTP error is the old `!r.ok` branch: the ticker has no row, so
        // clear the band. A network blip keeps the last good one.
        if (!cancelled && e instanceof HttpError) setEmWeekly(null);
      }
    };
    load();
    // 5 min, matching HomeClient. The band is frozen weekly, so this only exists
    // to pick up the Friday publish (and a mid-week republish) without a reload.
    const id = setInterval(load, 300_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [settingsLoaded, sym.key]);

  // Chart candles: 2-day rolling window, deliberately matched to the GEX
  // retention. The heatmap's historical columns resolve via timeToCoordinate,
  // which only works for timestamps ON the chart's time scale — so the window
  // has to be at least as wide as the overlay. It does NOT need to be wider:
  // option_strike_gex_history is pruned to 48h server-side and the backfill query
  // caps at 2880min, so days 3-5 of the old window carried candles that could
  // never have a GEX column behind them. Merge with the live session so the
  // most-recent bars always win on slotKey collision.
  //
  // This is the NATIVE series (1m or 5m). The chart's bars come from `rows`
  // below, which rolls this up when the user is on 15m/30m/1h. Keep both: the
  // basis reconstruction (esCloseAt inside buildBasisAt) wants the finest
  // resolution available, not hourly bars.
  const rows5 = useMemo(() => {
    const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - TWO_DAYS_MS;
    const map = new Map<string, EsCandleRecord>();
    for (const c of historical) if (c.slotKey && c.timestamp >= cutoff) map.set(c.slotKey, c);
    // ETF rows have no second live stream to merge — `historical` already IS the
    // recorded series, refreshed on the hook's interval.
    if (isEs) for (const c of liveRows) if (c.slotKey) map.set(c.slotKey, c); // live wins
    return [...map.values()].sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey));
  }, [historical, liveRows, isEs]);

  // Bars actually plotted. Identity-stable at 1m/5m (rollupCandles returns the
  // same reference), so the interval switcher costs nothing at the native sizes.
  // The 2-day cutoff is applied to rows5 ABOVE and passed down here — rolling up
  // first and cutting after would leave a truncated bucket wherever it landed.
  const rows = useMemo(() => {
    if (interval <= 5) return rows5;
    const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
    return rollupCandles(rows5, interval, { cutoffMs: cutoff });
  }, [rows5, interval]);
  const { trigger: refreshTrigger, label: refreshLabel, style: refreshStyle } = useRefreshButton(async () => {
    await (isEs ? esRefresh() : etfRefresh());
  });


  const chartRef = useRef<HTMLDivElement>(null);
  // Capture target for the Snap / Discord buttons (chart + lanes panel).
  const captureRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // Keyed by title so lines are updated IN PLACE. Recreating them every frame
  // re-renders the axis labels, which resizes the price scale → the plot width
  // shifts → the whole chart visibly nudges.
  const priceLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  const didFitRef = useRef(false);
  // How many candles are currently on the series. applyDefaultView needs it, and
  // the chart-init effect (double-click recenter, collapsed-container re-fit)
  // runs with an empty dep array so it can't close over candleData.
  const barCountRef = useRef(0);
  // The plotted bars, mirrored for the imperative overlay draw. xAt() binary-
  // searches this to place sub-bar GEX slots; it cannot derive the bar grid
  // arithmetically any more (see xAt).
  const rowsRef = useRef<EsCandleRecord[]>(rows);
  rowsRef.current = rows;
  // ET date of the latest bar the last fitContent() ran for. When the session
  // rolls to a new ET day, new bars append far to the right; without re-fitting
  // the viewport stays parked on the prior day (looks "stuck"), or a manual fit
  // spans both sessions across the overnight gap and the time axis reads wrong.
  const lastFitDayRef = useRef("");

  // Heatmap overlay state.
  const overlayRef = useRef<HTMLCanvasElement>(null);
  // Right-axis SPX readouts. liveSpx = badge pinned at the last ES price (y in
  // px within the chart). crossSpx = SPX at the crosshair (y in px), shown only
  // while hovering the chart. Both = ES − effective basis.
  const [liveSpx, setLiveSpx] = useState<{ y: number; spx: number } | null>(null);
  const [crossSpx, setCrossSpx] = useState<{ y: number; spx: number } | null>(null);
  // Frozen prior-day closes (ES 16:00 − SPX 16:00) → prior-day basis source.
  const [prevCloses, setPrevCloses] = useState<{ es: number; spx: number; date: string } | null>(null);
  // Today's MVC history: raw SPX strikeOIVol per snapshot. Converted to ES at
  // DRAW time using the live ESU basis (same as the other levels), so the line
  // tracks the current /ESU price — not the stale per-row esPrice.
  const [mvcHistory, setMvcHistory] = useState<Array<{ ts: number; spx: number; spxPx: number; basis: number | null }>>([]);
  // CB (central band / MVC) step line. Lives with the BUBBLES controls, not the
  // Levels group: the top bubble — or `highlight 1` — is already marking the MVC
  // strike, so CB is the same read in line form and belongs beside the controls
  // that govern it. Persisted in the bubble blob alongside `on` / `mins`.
  // Defaults true, which is what it was before (a hardcoded `showMvcLine = true`).
  const [showCb, setShowCb] = useState(true);
  const updateShowCb = useCallback((on: boolean) => { setShowCb(on); saveSetting({ cb: on }); }, [saveSetting]);
  // Default OFF everywhere (was: on unless embedded). The default read on this
  // chart is candles + GEX bubbles + the rail; the heatmap is the heaviest thing
  // here (a ~1.6MB backfill and a full-canvas per-column paint) and is now
  // strictly opt-in. This also makes the old embed-only override redundant — the
  // dock gets the same clean chart from the default.
  const [showHeatmap, setShowHeatmap] = useState(false);
  // Heatmap backfill window. 5-day backfill pulls/renders far more 1-min
  // history columns than 1-day and visibly slows the chart, so default to
  // the fast 1-day window and let the user opt into 5-day when they want it.
  const [heatmapDays, setHeatmapDays] = useState<1 | 2>(1);
  const [intensity, setIntensity] = useState(0.65); // page-local default; tuned with gexColor so light zones read clearly
  // Heatmap metric: "voloi" = gamma×(OI+vol), "vol" = gamma×vol only. Mirrored
  // in a ref so the WS-driven overlay draw reads it without re-subscribing.
  const [gexMetric, setGexMetric] = useState<GexMetric>("voloi");
  const gexMetricRef = useRef<GexMetric>("voloi");
  gexMetricRef.current = gexMetric;
  // Column history keyed by SLOT_MS (1-min) slot ms. One column per slot; the
  // latest slot is updated in place as fresh gex messages arrive within the
  // same minute. Spans the full heatmapDays range (1D/5D).
  const columnsRef = useRef<Map<number, GexColumn>>(new Map());
  // Same 1-min resolution as columnsRef, but ONE SESSION only — the bubble trail
  // is a session view and never spans two days. Usually today; off-hours it is
  // the last session that traded (see lastBubbleDayRef).
  const minuteColsRef = useRef<Map<number, GexColumn>>(new Map());
  // Mutation counter for the map above. The bubble pass derives an expensive
  // per-bucket ranking from it (sort of every strike seen so far, once per
  // bucket) and that used to run on EVERY overlay frame — i.e. on every pan,
  // wheel and pointermove, which is what made the page feel like it was
  // dragging through mud with a full session loaded. The derivation is now
  // memoised and this counter is the invalidation key, so the ranking is
  // rebuilt when the DATA changes (once a minute, or on a backfill) instead of
  // 60x a second while the mouse moves. Bump it at EVERY write to the map.
  const minuteColsVerRef = useRef(0);
  // Memoised output of that derivation, keyed by the signature built in draw().
  const bubblePrepRef = useRef<{
    sig: string;
    mins: GexColumn[];
    sessMax: number;
    runMax: Map<number, number>;
    shownAt: Map<number, Set<number>>;
    wallAt: Map<number, Map<number, number>>;
    floorAt: Map<number, number>;
    strikeStep: number;
  } | null>(null);
  // Pre-rendered glow sprites for the highlighted walls. `ctx.shadowBlur` is a
  // per-fill gaussian blur — the single most expensive thing this overlay did,
  // paid once per wall bubble per column per frame. Rendering the blur ONCE per
  // (size, colour, blur) into an offscreen canvas and blitting it turns that
  // into a drawImage, which is effectively free.
  const glowSpriteRef = useRef<Map<string, { cv: HTMLCanvasElement; w: number; h: number }>>(new Map());
  // Dedupe key for the heatmap backfill fetch: front mode ignores `expiry`
  // server-side, so the rolling feedExpiry must not re-fire the ~700KB/5s call.
  const lastHeatmapKeyRef = useRef<string>("");
  // The backfill key MINUS the poll counter (see the wipe rule in the backfill
  // effect): what is being requested, vs merely when. A change here means the
  // columns already in memory are the wrong data and must be wiped; a change to
  // the poll counter alone is a refresh and merges.
  const lastHeatmapShapeRef = useRef<string>("");
  // ET day the bubble map currently HOLDS — the day the data is from, which is
  // not always today (weekends, holidays, pre-open: see the targetKey note in
  // the backfill). Bubbles are single-day, so when the day that arrives changes,
  // minuteColsRef has to be wiped even though the request shape didn't move, or
  // two sessions' minutes end up sharing one radius scale.
  const lastBubbleDayRef = useRef<string>("");
  // Wall-clock ET day as of the last backfill. Deliberately SEPARATE from
  // lastBubbleDayRef: this one catches the midnight rollover on a tab that was
  // left open (the live feed starts writing a new day's minutes into a map that
  // still holds the previous session), while lastBubbleDayRef tracks what the
  // server actually returned. Folding them into one ref would make every
  // weekend backfill wipe and repaint — the wall clock says Saturday, the data
  // says Friday, and they'd disagree forever.
  const lastWallDayRef = useRef<string>("");
  const bubbleCfgRef = useRef<BubbleCfg>(BUBBLE_CFG_DEFAULT);
  const bubbleMinsRef = useRef<BubbleBucket>("bar");
  // Replay cursor, mirrored for the imperative overlay draw (null = live).
  const replayOnRef = useRef(false);
  const replayTsRef = useRef<number | null>(null);
  // NOTE: the effect that syncs this ref lives next to the bubbleCfg useState
  // below — NOT here. A `[bubbleCfg]` dep array is evaluated during render, and
  // the state is declared further down, so putting it here threw a TDZ
  // ReferenceError ("Cannot access before initialization") and 500'd the page.
  // Imperative redraw hook set up by the overlay effect; apply() calls it when a
  // new gex snapshot lands so in-place column updates repaint immediately.
  const drawOverlayRef = useRef<() => void>(() => {});
  // Cached right price-axis gutter width (px). Updated only on >=1px change so
  // the heatmap's right edge doesn't shimmer with sub-pixel label wobble.
  const hmScaleWRef = useRef(0);
  // Offscreen heatmap buffer, reused across draws. Was allocated fresh inside
  // draw() on every frame — a full-viewport canvas per rAF during a pan/zoom,
  // which is pure allocation + GC churn. Resized only when the canvas size
  // actually changes; otherwise just cleared.
  const hmBufRef = useRef<HTMLCanvasElement | null>(null);
  // Visible candle price band (ES) — min low / max high of the loaded bars.
  // Heatmap cells fade with distance from this band so far-away GEX walls read
  // as faint context instead of loud bars floating in the dead zone above price.
  const candleBandRef = useRef<{ lo: number; hi: number } | null>(null);
  // Basis (esFut - spx) kept in a ref so the overlay draw reads it without
  // re-subscribing. Updated by the WS listener.
  const basisRef = useRef(0);
  // Frozen prior-day basis = prior-day ES 16:00 close − prior-day SPX 16:00
  // close. Used to derive SPX from ES on the right axis OVERNIGHT / pre-open,
  // until the 9:30 ET open when the live basis takes over. 0 = not available.
  const prevBasisRef = useRef(0);
  // Live basis inputs, both sampled from sources VERIFIED good (2026-07-13):
  //   lastEsCloseRef — last 5m ES CANDLE close. Definitionally the contract the chart
  //                    plots, so it can't desync across a quarterly roll the way
  //                    marketState.esFut does (esFut is written only by a Quote/Trade
  //                    stream that goes silent, freezing on the EXPIRED contract).
  //   spotRef        — live SPX from the feed. CONFIRMED accurate: published 7515.34
  //                    against a 7515.89 cash close. Sampled together these give
  //                    7563.25 − 7515.34 = +47.9, the true basis.
  const lastEsCloseRef = useRef(0);
  const spotRef = useRef(0);
  // Off-hours fallback: /proxy/es-spx-basis (ES 16:00 close − Yahoo ^GSPC close).
  // Needed because `spot` FREEZES when cash shuts while ES keeps trading, so the live
  // difference stops being a basis. NOT sourced from eod_gex — see below.
  const trustedBasisRef = useRef(0);
  // ET date → that session's ES−SPX basis, built from DAILY closes (ES 16:00
  // candle − SPX 16:00 eod_gex). This is the authoritative historical basis and
  // is deliberately INDEPENDENT of the heatmap backfill window: deriving it from
  // the loaded GEX columns made every SPX→ES conversion (CB line included) shift
  // when the user toggled 1D vs 5D, because a different set of days had spots.
  const dayBasisRef = useRef<Map<string, number>>(new Map());
  // Throttle for the ?debugBasis=1 console dump (the overlay redraws on rAF).
  const basisDebugAtRef = useRef(0);
  // Front expiry from the live feed; drives the one-time history backfill.
  const [feedExpiry, setFeedExpiry] = useState<string>("");
  // Expirations offered by the feed + the one the heatmap history is showing.
  // Empty selectedExpiry = follow the live front expiry.
  const [expirations, setExpirations] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string>("");
  // Mirror in a ref so the WS handler can decide whether to ingest live columns
  // (only when showing the front expiry — a non-front pick is history-only).
  const selectedExpiryRef = useRef("");
  useEffect(() => { selectedExpiryRef.current = selectedExpiry; }, [selectedExpiry]);
  const [dteOpen, setDteOpen] = useState(false);
  const [dteRect, setDteRect] = useState<{ left: number; top: number } | null>(null);
  const dteBoxRef = useRef<HTMLDivElement>(null);
  const dteMenuRef = useRef<HTMLDivElement>(null);
  const openDte = useCallback(() => {
    const r = dteBoxRef.current?.getBoundingClientRect();
    if (r) setDteRect({ left: r.left, top: r.bottom + 4 });
    setDteOpen((v) => !v);
  }, []);
  useEffect(() => {
    if (!dteOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (dteBoxRef.current?.contains(t)) return;
      if (dteMenuRef.current?.contains(t)) return;
      setDteOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [dteOpen]);

  // ── IB switcher tab ────────────────────────────────────────────────────────
  // Toggles the Initial Balance lines; hovering the tab previews the IB page.
  const IB_ROUTE = "/scanner?tab=ibstats"; // full IB Stats board — the "Open ↗" target
  const IB_EMBED_ROUTE = "/scanner/ib-embed?embed=1"; // today section only, no chrome — the hover preview
  const [showIb, setShowIb] = useState(false);
  const [ibPop, setIbPop] = useState(false);
  const [ibPopRect, setIbPopRect] = useState<{ left: number; top: number } | null>(null);
  const ibBoxRef = useRef<HTMLDivElement>(null);
  const ibCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openIbPop = useCallback(() => {
    if (ibCloseTimer.current) { clearTimeout(ibCloseTimer.current); ibCloseTimer.current = null; }
    const r = ibBoxRef.current?.getBoundingClientRect();
    if (r) setIbPopRect({ left: r.left, top: r.bottom + 6 });
    setIbPop(true);
  }, []);
  const closeIbPop = useCallback(() => {
    if (ibCloseTimer.current) clearTimeout(ibCloseTimer.current);
    ibCloseTimer.current = setTimeout(() => setIbPop(false), 120);
  }, []);

  // Overlays dropdown. The six overlay toggles used to sit inline in the dock
  // and overflowed it (FitScale shrank everything to unreadable); they live in
  // a checklist menu now.
  const [ovlOpen, setOvlOpen] = useState(false);
  const [ovlRect, setOvlRect] = useState<{ left: number; top: number; maxH: number } | null>(null);
  const ovlBoxRef = useRef<HTMLDivElement>(null);
  const ovlMenuRef = useRef<HTMLDivElement>(null);
  /**
   * Position the menu, CLAMPED to the viewport.
   *
   * It renders through a portal at `position: fixed`, so it is measured against
   * the window and nothing upstream can contain it. Anchoring naively to the
   * button's left/bottom broke on a laptop two ways:
   *   • the toolbar sits right-of-center, so `left = button.left` put the panel's
   *     right edge past the window and the slider values + steppers painted
   *     outside the panel's own border;
   *   • with no max-height the panel ran off the bottom on a short viewport and
   *     Save default / Reset became unreachable.
   * Clamp x into the window, and cap the height at the space actually left below
   * the button so the body scrolls instead of overflowing.
   */
  const placeOvl = useCallback(() => {
    const r = ovlBoxRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(OVL_PANEL_W, vw - OVL_VIEWPORT_PAD * 2);
    const left = Math.max(OVL_VIEWPORT_PAD, Math.min(r.left, vw - w - OVL_VIEWPORT_PAD));
    const top = r.bottom + 4;
    setOvlRect({ left, top, maxH: Math.max(OVL_MIN_H, vh - top - OVL_VIEWPORT_PAD) });
  }, []);
  const openOvl = useCallback(() => {
    placeOvl();
    setOvlOpen((v) => !v);
  }, [placeOvl]);
  useEffect(() => {
    if (!ovlOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ovlBoxRef.current?.contains(t)) return;
      if (ovlMenuRef.current?.contains(t)) return;
      setOvlOpen(false);
    };
    // Re-clamp while open: resizing (or rotating a laptop into a docked monitor)
    // would otherwise leave the panel pinned to a position that no longer exists.
    const onResize = () => placeOvl();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", onResize);
    };
  }, [ovlOpen, placeOvl]);

  // DTE relative to today ET (today's expiry = 0DTE, not −1).
  const dteOf = (exp: string): number => {
    const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    return Math.round((Date.parse(exp + "T00:00:00Z") - Date.parse(todayEt + "T00:00:00Z")) / 86_400_000);
  };
  // "Fri 6/27" — day name + M/D for an expiry date string.
  const dayDateOf = (exp: string): string => {
    const d = new Date(exp + "T00:00:00");
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
    return `${day} ${d.getMonth() + 1}/${d.getDate()}`;
  };

  const [showProfile, setShowProfile] = useState(false);
  const [showTpo, setShowTpo] = useState(false); // prev-day + today TPO box profile
  // Flip Cross Pulse — rings the bars where price actually CROSSED the gamma
  // flip, plus the derived flip path itself.
  //
  // The flip series is computed from the SAME 1-min GEX columns that feed the
  // bubbles (minuteColsRef), not from lineLevels.gexFlip or mvc_snapshots:
  //   • lineLevels.gexFlip is a now-value only — there's no history to cross.
  //   • mvc_snapshots.gexFlip is poisoned (both recorders backfill it with the
  //     MVC strike when /api/gex omits a flip — see the note at the top).
  // Deriving it per-column means the marker can never disagree with the bubbles
  // the user is looking at, and it costs no new fetch. Single-day, like bubbles.
  const [showFlipCross, setShowFlipCross] = useState(false);
  // Call/Put/Flip dashed lines. The MVC/CB step line used to ride along here;
  // it now lives under the Bubbles sub-panel (see showCb).
  const [showLevels, setShowLevels] = useState(false);
  const [showSessions, setShowSessions] = useState(false); // prior-day + overnight H/L
  // The right-side panel used to be a per-card overlay toggle ("GEX Rail"). It
  // is now the PAGE's `sidePanel` prop — one choice for the whole row, so three
  // cards can't sit next to each other showing three different things and, more
  // practically, so turning on the 0DTE chain doesn't fire three chain fetches
  // when you only wanted to look at one.
  const showRail = sidePanel !== "none";
  // Per-strike 1-minute GEX bubbles. Radius ∝ |net GEX|
  // at that strike in that minute, normalized to the session max so the bubble
  // trail shows gamma building/bleeding at each level through the day.
  const [showGexBubbles, setShowGexBubbles] = useState(true);
  // Bubble controls: Show Top Strikes (N) + Highlight Top N Walls (X≤N) filter
  // WHICH strikes draw; Min/Max Bubble Size (scaleSqrt range) + Brightness
  // (opacity gradient) control HOW they draw. Persisted as one blob.
  const [bubbleCfg, setBubbleCfg] = useState<BubbleCfg>(BUBBLE_CFG_DEFAULT);
  // Bubble time bucket. Storage is always 1-min; this aggregates at DRAW time.
  // At 1m the bubbles sit a few px apart and overlap into solid rails, which is
  // the whole reason a bucket exists.
  //
  // "bar" (one column per candle) is the default now that the timeframe is
  // switchable. A fixed 5m bucket was right when every chart was 5m; on a 1h
  // chart it stacks twelve columns inside one candle and recreates exactly the
  // solid rail it was meant to prevent. 1m and 5m stay available for when you
  // want sub-bar detail on a 15m+ chart.
  const [bubbleMins, setBubbleMins] = useState<BubbleBucket>("bar");
  // ── Replay mode ──────────────────────────────────────────────────────────
  // Scrub / playback of the CURRENT ET session. Candles + the two time-series
  // gamma overlays (heatmap + bubbles) reveal only up to a moving cursor, so you
  // can watch price and gamma build from the open forward. The rail / TPO /
  // level lines stay live — a snapshot or a full-day profile, nothing to replay.
  const [replayOn, setReplayOn] = useState(false);
  const [replayIdx, setReplayIdx] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(2); // bars per second
  // Which ET day to replay. null = latest available day (live default). Lets the
  // user step back to the previous session (e.g. replay Friday over the weekend).
  const [replayDay, setReplayDay] = useState<string | null>(null);
  /**
   * Which part of the day the cursor may travel over.
   *
   *   rth — 09:30–16:00 ET. What a session replay usually means: it starts at
   *         the open and ends at the close, instead of spending most of the
   *         scrubber on an overnight tape where nothing happened.
   *   eth — the whole ET day, which is what this always did.
   *
   * Names and bounds match the `session` param the levels route already uses
   * (rth-eth-switch.patch), so the two can't mean different things.
   *
   * Defaults to eth — a toggle that silently changes what Replay does the first
   * time you open it after an update is worse than one you have to press once.
   *
   * This filters the FRAMES, not the reveal: at a 10:00 cursor you still see the
   * overnight bars behind you, because "everything up to here" is what a replay
   * is. It only decides where the cursor can start, stop and step.
   */
  const [replaySession, setReplaySession] = useState<"rth" | "eth">("eth");
  // Where the cursor was when the session changed, so the switch keeps its place
  // in TIME rather than reusing a bar index that now means a different bar.
  const sessionSnapTsRef = useRef<number | null>(null);
  // Distinct ET days present in the rolling window, oldest→newest.
  const replayDays = useMemo(
    () => [...new Set(rows.map((r) => r.date).filter(Boolean))].sort() as string[],
    [rows],
  );
  // Resolve the active day: explicit pick, else the newest day with bars.
  const activeReplayDay = (replayDay && replayDays.includes(replayDay))
    ? replayDay
    : (replayDays.length ? replayDays[replayDays.length - 1] : "");
  // Frames = the active ET day's bar timestamps, oldest→newest, narrowed to the
  // chosen session. Half-days are deliberately not special-cased: an early close
  // just yields fewer frames, which is exactly right, and there is no holiday
  // calendar in this file to consult anyway.
  const replayFrames = useMemo(() => {
    if (!activeReplayDay) return [] as number[];
    const day = rows.filter((r) => r.date === activeReplayDay);
    const src = replaySession === "rth"
      ? day.filter((r) => {
          const m = etMinutesOfDay(r.timestamp);
          return m >= RTH_OPEN_MIN && m < RTH_CLOSE_MIN;
        })
      : day;
    return src.map((r) => r.timestamp);
  }, [rows, activeReplayDay, replaySession]);
  const replayTs = replayOn && replayFrames.length
    ? replayFrames[Math.min(replayIdx, replayFrames.length - 1)]
    : null;
  // Read by the channel subscriber, which is a []-dep useCallback and so cannot
  // close over the frames. Assigned during render, like replayGexRef below.
  const replayFramesRef = useRef<number[]>(replayFrames);
  replayFramesRef.current = replayFrames;
  // Last instant the channel named, kept so a follower can re-snap to it when
  // its OWN frames change. Without this, a card that loads its candles a beat
  // after the owner's last broadcast sits at bar 0 — invisible during playback
  // (the next tick corrects it) and stuck until you scrub while paused.
  const sharedRpTsRef = useRef<number | null>(null);
  useEffect(() => { replayOnRef.current = replayOn; }, [replayOn]);
  useEffect(() => { replayTsRef.current = replayTs; }, [replayTs]);
  // Keep the cursor in range as live bars extend the session.
  useEffect(() => {
    if (replayIdx > replayFrames.length - 1) setReplayIdx(Math.max(0, replayFrames.length - 1));
  }, [replayFrames.length, replayIdx]);

  // Session switch: land on the same INSTANT in the new frame set. Clamping the
  // old index instead would jump you somewhere arbitrary — index 5 of the ETH
  // day is deep in the overnight, index 5 of RTH is ten past the open. Snapping
  // ETH→RTH before the open lands on the first RTH bar, which is the only
  // sensible answer when the instant you were at no longer exists.
  useEffect(() => {
    const ts = sessionSnapTsRef.current;
    if (ts == null) return;
    sessionSnapTsRef.current = null;
    if (replayFrames.length) setReplayIdx(frameIdxAtOrBefore(replayFrames, ts));
  }, [replayFrames]);
  // ── Replay: reconstruct the GEX-by-strike column at the cursor ─────────────
  // The heatmap already retains full per-slot per-strike history in columnsRef,
  // so during replay we read the stored column at/nearest-below the cursor and
  // derive the rail bars + Call/Put Wall + Flip from it (walls = max +/− net on
  // the active metric; flip = zero-cross, same basis as live). CB stays live.
  // Recomputed each render (cheap) so a scrub tick (replayTs change) repaints.
  const replayGex = (() => {
    if (!replayOn || replayTs == null) return null;
    let col: GexColumn | null = null;
    for (const c of columnsRef.current.values()) {
      if (c.slotTs <= replayTs && (!col || c.slotTs > col.slotTs)) col = c;
    }
    // cbAware only off ES — see the flag's note in chartMath. On SPX the walls
    // being replayed came from the live feed, which ranks them plainly.
    return deriveColumnLevels(col, gexMetricRef.current, { cbAware: !isEs });
  })();
  const replayGexRef = useRef(replayGex);
  replayGexRef.current = replayGex;

  /**
   * The 0DTE panel's replay ladder.
   *
   * The GEX rail already scrubbed, because it reads `replayGex.railRows`. The
   * 0DTE chain did not, because it is a different component with its own live
   * poll of /api/chains — so under a replay cursor it kept showing the CURRENT
   * chain, which is the "heatmap doesn't replay" symptom. It gets the same
   * reconstructed column the rail does.
   *
   * Units line up exactly, which is the only reason this is safe to label:
   * gex-calculator's netGEX is `gamma × OI × spot²`, and optionChain's gexValue
   * is `(γc·cc − γp·pc) × S² × 0.01 × 100` — and 0.01 × 100 is 1. Same number,
   * so ChainRail's fmtM prints replayed and live values on one scale.
   *
   * DEX / VEX / CHEX get `unavailable`. option_strike_gex_history records gamma
   * exposure and the backfill route returns only net/netVol, so there is no
   * past for the other three to replay to — and a live ladder frozen under a
   * moving cursor would look like data.
   */
  const chainReplay = useMemo(() => {
    if (!replayOn || !replayGex) return null;
    if (chainGreek !== "gex") return { rows: [], unavailable: true };
    return {
      rows: replayGex.railRows.map((r) => ({ strike: r.strike, v: r.net })),
      unavailable: false,
    };
  }, [replayOn, replayGex, chainGreek]);
  // ── Replay ownership under a shared toolbar ────────────────────────────────
  // Exactly ONE card may advance the cursor. Every card runs this component, so
  // without the guard all three would tick independently, each broadcasting its
  // own index, and the cursor would race. The card that renders the toolbar is
  // the owner; the others are followers and take the index off the channel.
  const replayOwner = dockMode !== "symbol";

  // Mirror the owner's replay state onto the broadcast channel. Deliberately
  // NOT persisted (broadcastSlot, not writeSlot): the cursor moves a couple of
  // times a second during playback and means nothing next session.
  //
  // The cursor travels as a TIMESTAMP (rpTs), not as a bar index. The cards can
  // be different symbols, and ES / SPY / QQQ do not produce identical bar counts
  // for a session — a thin tape prints fewer bars, and any gap or halt shifts
  // every index after it. Sharing `replayIdx` therefore parks the three charts
  // at three different moments while looking perfectly synchronized, which is
  // the one thing a side-by-side replay must never do. A timestamp means the
  // same instant on every chart by construction.
  useEffect(() => {
    if (!shared || !replayOwner) return;
    broadcastSlot(cfgSlot, {
      rpOn: replayOn, rpPlaying: replayPlaying, rpTs: replayTs,
      rpSpeed: replaySpeed, rpDay: replayDay, rpSession: replaySession,
    });
  }, [shared, replayOwner, cfgSlot, replayOn, replayPlaying, replayTs, replaySpeed, replayDay, replaySession]);

  // ── Page-hosted Replay button ──────────────────────────────────────────────
  // The toolbar above owns the BUTTON; this card owns the STATE, because only it
  // knows how many bars the session has. Every card listens (not just the
  // transport owner) so a single command turns the whole row on and off at once
  // — the followers' own state has to flip too, or their candles never clamp.
  useEffect(() => subscribeReplayCmd(({ on }) => {
    setReplayOn(on);
    setReplayPlaying(false);
    // Entering: rewind to the open and drop any day pick from a previous
    // session, matching what the card's own Replay button always did.
    if (on) { setReplayIdx(0); setReplayDay(null); }
  }), []);

  // Follower re-snap. Its frames can arrive (or change day / interval) long
  // after the owner last broadcast, and the channel only fires on the owner's
  // state changing — so re-derive the cursor here rather than waiting for a
  // scrub that may never come.
  useEffect(() => {
    if (!shared || replayOwner) return;
    const ts = sharedRpTsRef.current;
    if (ts == null || !replayFrames.length) return;
    setReplayIdx(frameIdxAtOrBefore(replayFrames, ts));
  }, [shared, replayOwner, replayFrames]);

  // Play loop: advance one bar per tick, stop at the last frame.
  useEffect(() => {
    if (shared && !replayOwner) return; // followers are driven by the channel
    if (!replayOn || !replayPlaying || replayFrames.length === 0) return;
    const ms = Math.max(60, Math.round(1000 / Math.max(1, replaySpeed)));
    const id = setInterval(() => {
      setReplayIdx((i) => {
        if (i >= replayFrames.length - 1) { setReplayPlaying(false); return i; }
        return i + 1;
      });
    }, ms);
    return () => clearInterval(id);
  }, [shared, replayOwner, replayOn, replayPlaying, replaySpeed, replayFrames.length]);

  // ══ Indicators ═════════════════════════════════════════════════════════════
  // All of these are PAGE-level (see IndicatorCfg in slotStore) and all default
  // off, so a card with nothing enabled behaves exactly as it always has.
  //
  // Values are computed over the FULL row set, never the replay-clamped one.
  // Every one of them is causal — bar i's value depends only on bars ≤ i — so
  // clamping at DRAW time gives an identical result to recomputing per scrub
  // tick, without recomputing a 20-period stdev over the session 4× a second.

  /** Closes, the input to every study here. */
  const closes = useMemo(() => rows.map((r) => r.close), [rows]);

  // Bollinger. Kept in a ref as well as state because the cloud is painted on
  // the imperative overlay canvas, which cannot read React state.
  const bb = useMemo<BollingerBands | null>(
    () => (indicators.bb && closes.length ? bollinger(closes, indicators.bbPeriod, indicators.bbInner, indicators.bbOuter) : null),
    [indicators.bb, indicators.bbPeriod, indicators.bbInner, indicators.bbOuter, closes],
  );
  const bbRef = useRef<BollingerBands | null>(bb);
  bbRef.current = bb;

  // RSI at the cursor (replay) or at the last bar (live). One number, drawn as
  // text in the corner — no pane, because a pane costs a third of the chart's
  // height to show a value you read as "high / low / middling".
  const rsiValue = useMemo(() => {
    if (!indicators.rsi || closes.length <= indicators.rsiPeriod) return null;
    const series = rsiOf(closes, indicators.rsiPeriod);
    // Manual scan, not findLastIndex: that is ES2023 and this file has to
    // compile against whatever lib the app's tsconfig actually sets.
    let upto = rows.length - 1;
    if (replayTs != null) {
      upto = -1;
      for (let i = 0; i < rows.length; i++) { if (rows[i].timestamp <= replayTs) upto = i; else break; }
    }
    return upto >= 0 ? series[upto] ?? null : null;
  }, [indicators.rsi, indicators.rsiPeriod, closes, rows, replayTs]);

  // Bar countdown. Its own 1s tick — the candle feed publishes on trades, so
  // hanging this off `rows` would make the clock stutter in a quiet tape.
  const [countdownNow, setCountdownNow] = useState(0);
  useEffect(() => {
    if (!indicators.countdown || replayOn) return; // nothing is forming in replay
    setCountdownNow(Date.now());
    const id = setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [indicators.countdown, replayOn]);
  const barCountdown = useMemo(() => {
    if (!indicators.countdown || replayOn || !rows.length || !countdownNow) return null;
    const last = rows[rows.length - 1].timestamp;
    // Time to the END of the bar the clock is currently inside. Derived from the
    // last bar's open rather than from `now % candleMs`: 15m/30m/1h bars are
    // anchored to 09:30 ET and the close forces a short bar, so an epoch-aligned
    // modulo drifts against the actual grid by up to half a bar.
    const elapsed = countdownNow - last;
    if (elapsed < 0) return null;
    const left = candleMs - (elapsed % candleMs);
    return fmtCountdown(left);
  }, [indicators.countdown, replayOn, rows, countdownNow, candleMs]);

  // ── EMA + volume series ────────────────────────────────────────────────────
  // Real chart series rather than canvas paint: they need the price scale's own
  // autoscale and crosshair behaviour, and volume needs a SECOND price scale
  // (its numbers are in millions of contracts, not points) which only the chart
  // can give it. The overlay canvas gets the Bollinger cloud instead, where a
  // filled band between two lines is the thing lightweight-charts can't do.
  const emaSeriesRef = useRef<Array<ISeriesApi<"Line"> | null>>([null, null, null]);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    const srcRows = replayTs != null ? rows.filter((r) => r.timestamp <= replayTs) : rows;
    const wanted = indicators.emas.slice(0, 3);

    for (let i = 0; i < 3; i++) {
      const cfg = wanted[i];
      const existing = emaSeriesRef.current[i];
      if (!cfg?.on) {
        // Remove rather than setData([]) — an empty series still participates in
        // autoscale and in the crosshair's legend.
        if (existing) { try { chart.removeSeries(existing); } catch { /* chart already torn down */ } }
        emaSeriesRef.current[i] = null;
        continue;
      }
      const series = existing ?? chart.addSeries(LineSeries, {
        color: EMA_COLORS[i],
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      emaSeriesRef.current[i] = series;
      const vals = emaOf(srcRows.map((r) => r.close), Math.max(1, Math.round(cfg.len)));
      const data: LineData[] = [];
      for (let k = 0; k < srcRows.length; k++) {
        const v = vals[k];
        if (v != null) data.push({ time: toChartTime(srcRows[k].timestamp), value: v });
      }
      series.setData(data);
    }

    if (!indicators.volume) {
      if (volSeriesRef.current) { try { chart.removeSeries(volSeriesRef.current); } catch { /* torn down */ } }
      volSeriesRef.current = null;
    } else {
      const series = volSeriesRef.current ?? chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        // Its OWN scale, pinned to the bottom 18% and invisible. Sharing the
        // price scale would blow the candles up to a two-pixel band at the top,
        // because volume is five orders of magnitude larger than an ES price.
        priceScaleId: "es-vol",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      volSeriesRef.current = series;
      try {
        chart.priceScale("es-vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
      } catch { /* scale appears with the series; a miss here self-corrects next run */ }
      const data: HistogramData[] = srcRows.map((r) => ({
        time: toChartTime(r.timestamp),
        value: r.volume || 0,
        color: r.close >= r.open ? "rgba(38,166,154,0.45)" : "rgba(239,83,80,0.45)",
      }));
      series.setData(data);
    }
  }, [rows, replayTs, indicators.emas, indicators.volume]);

  // Tear the indicator series down with the card. The chart-teardown effect
  // calls chart.remove(), which drops every series with it — this only clears
  // OUR refs so a remount doesn't hand a dead handle to removeSeries().
  useEffect(() => () => {
    emaSeriesRef.current = [null, null, null];
    volSeriesRef.current = null;
  }, []);

  // ── Weekly EM band ─────────────────────────────────────────────────────────
  // This week's expected-move boundaries, drawn as two flat lines.
  //
  // Source is /api/levels, the SAME published row the customer-facing /em page
  // reads (components/dashboard/EmCustomer.tsx). Not /api/em-tracker: that one
  // is the owner's hit/miss ledger and is gated `auth: 'owner'`, so a band built
  // on it would draw for exactly one account and 403 for every subscriber.
  // /api/levels is gated `subscriber`, which is who this chart is for.
  //
  // `up` / `down` come back as display TEXT ("7,529.40"), which is why they go
  // through parseLevelNum rather than Number().
  const [weeklyEm, setWeeklyEm] = useState<{ up: number; down: number } | null>(null);
  // Mirrored for the imperative overlay draw, which cannot read React state.
  const weeklyEmRef = useRef<{ up: number; down: number } | null>(null);
  weeklyEmRef.current = weeklyEm;
  useEffect(() => {
    if (!indicators.weeklyEm) { setWeeklyEm(null); return; }
    // Same restore guard as the emWeekly effect above: `isEs` and `sym.gexSymbol`
    // are both derived from `symbol`, which is "ES" until the slot restore lands.
    if (!settingsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        // ES uses SPX's band plus the basis, like every other level on this
        // chart. The futures contract HAS its own published row (ESU), but its
        // ticker carries the contract month, so hardcoding one would quietly go
        // stale at the next roll and there is nothing in a missing row to
        // distinguish "rolled" from "not published yet". SPX + basis cannot
        // rot, and it keeps the EM band in the same coordinate system as the
        // walls, the flip and CB.
        const ticker = isEs ? "SPX" : sym.gexSymbol.replace(/^\$/, "");
        // Shares the cache entry with the emWeekly effect above whenever the two
        // resolve to the same ticker (always, on SPY/QQQ).
        const json = await cachedJson<Record<string, unknown> | null>(
          `/api/levels?ticker=${encodeURIComponent(ticker)}`,
          { ttlMs: 150_000, persist: true },
        );
        if (cancelled || !json) return;
        const up = parseLevelNum(json.up);
        const down = parseLevelNum(json.down);
        // Both or neither. Half a band is worse than none — a single line with
        // no partner reads as a level someone deliberately drew.
        if (up != null && down != null) setWeeklyEm({ up, down });
        else console.warn(`[weekly-em] ${ticker} has no published up/down yet — band not drawn`);
      } catch (e) {
        console.warn("[weekly-em] failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [settingsLoaded, indicators.weeklyEm, isEs, sym.gexSymbol]);

  // ── Restore this slot's settings ───────────────────────────────────────────
  // ONE effect for the whole card. Read in an effect, not in a lazy useState
  // initializer, so SSR and the first client render agree — the /es-candles
  // route is still server-rendered by Next before the Vite SPA takes over.
  // Everything is merged over the defaults, so a partial or older blob still
  // yields a complete, valid card.
  //
  // Empty dep array on purpose: this reads state SETTERS declared further down
  // the component, which is safe because the body runs after mount. Putting any
  // of those values in the dep array would evaluate them during render and throw
  // a TDZ ReferenceError (see the note by bubbleCfgRef).
  //
  // Factored out because it runs from TWO places: the mount restore below, and
  // the shared-toolbar subscription. Both hand it the same shape — a full blob
  // on restore, a one-key patch on broadcast — and every field is guarded
  // individually, so a partial patch only moves what it names.
  const applySettings = useCallback((p: SlotBlob) => {
    if (isChartInterval(p.interval)) setIntervalState(p.interval);
    if (typeof p.expiry === "string") setSelectedExpiry(p.expiry);
    if (p.metric === "vol" || p.metric === "voloi") setGexMetric(p.metric);
    if (typeof p.intensity === "number" && Number.isFinite(p.intensity)) {
      setIntensity(Math.min(1, Math.max(0.1, p.intensity)));
    }
    if (p.heatmapDays === 1 || p.heatmapDays === 2) setHeatmapDays(p.heatmapDays);

    // Overlays. Each is checked individually rather than spread, so an unknown
    // key in an old blob can never turn into a boolean nobody owns.
    if (typeof p.ovHeatmap === "boolean") setShowHeatmap(p.ovHeatmap);
    if (typeof p.ovProfile === "boolean") setShowProfile(p.ovProfile);
    if (typeof p.ovTpo === "boolean") setShowTpo(p.ovTpo);
    if (typeof p.ovLevels === "boolean") setShowLevels(p.ovLevels);
    if (typeof p.ovSessions === "boolean") setShowSessions(p.ovSessions);
    if (typeof p.ovFlipCross === "boolean") setShowFlipCross(p.ovFlipCross);

    // Bubble sliders: copy ONLY the known numeric keys, clamped. Spreading the
    // whole blob would inject `mins` / `on` into bubbleCfg and give them two
    // owners; clamping matters because a blob saved under the older, much wider
    // size ranges can hold values (maxSize 20) that no longer exist on the
    // slider, which would render as a pinned handle you couldn't explain.
    const patch = bubbleCfgFrom(p);
    if (Object.keys(patch).length) setBubbleCfg((c) => ({ ...c, ...patch }));
    if (isBubbleBucket(p.mins)) setBubbleMins(p.mins);
    if (typeof p.on === "boolean") setShowGexBubbles(p.on);
    if (typeof p.cb === "boolean") setShowCb(p.cb);

    // Replay rides the same channel but is BROADCAST-only, never persisted —
    // see the shared-toolbar subscription below.
    if (typeof p.rpOn === "boolean") setReplayOn(p.rpOn);
    if (typeof p.rpPlaying === "boolean") setReplayPlaying(p.rpPlaying);
    // Land the shared cursor on this card's own bar grid. Remembered in a ref as
    // well, because a card whose candles finish loading AFTER the owner's last
    // broadcast has no frames to snap onto yet — see the re-snap effect below.
    if (typeof p.rpTs === "number") {
      sharedRpTsRef.current = p.rpTs;
      setReplayIdx(frameIdxAtOrBefore(replayFramesRef.current, p.rpTs));
    }
    if (typeof p.rpSpeed === "number") setReplaySpeed(p.rpSpeed);
    // Followers take the session too, or a chart quietly replays a different
    // slice of the day than the one whose transport you are holding.
    if (p.rpSession === "rth" || p.rpSession === "eth") setReplaySession(p.rpSession);
    if (typeof p.rpDay === "string" || p.rpDay === null) setReplayDay(p.rpDay as string | null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const own = readSlot(slot);
    if (isChartSymbol(own.symbol)) setSymbolState(own.symbol);
    applySettings(cfgSlot === slot ? own : readSlot(cfgSlot));
    setSettingsLoaded(true);
  }, [slot, cfgSlot, applySettings]);

  // ── Shared-toolbar sync ────────────────────────────────────────────────────
  // Only when the settings namespace ISN'T this card's own — i.e. the page put
  // 2–3 charts up and hoisted the dock. Every card subscribes to the shared
  // blob, so whichever card owns the rendered toolbar can move all of them by
  // doing nothing more exotic than saving a setting.
  //
  // Subscribing in the single-chart case would be harmless but pointless: the
  // only writer would be this card, and it has already set its own state.
  useEffect(() => {
    if (!shared) return;
    return subscribeSlot(cfgSlot, applySettings);
  }, [shared, cfgSlot, applySettings]);

  // Patch the config with slider constraints enforced, then persist:
  //   • Highlight can't exceed Show Top Strikes (lowering N pulls X down).
  //   • Min (a fraction of Max) stays inside 0..0.9.
  const updateBubbleCfg = useCallback((patch: Partial<BubbleCfg>) => {
    setBubbleCfg((prev) => {
      const next: BubbleCfg = { ...prev, ...patch };
      // No min-vs-max clamp any more: minSize is a FRACTION of maxSize, not a
      // competing pixel value, so the two can't cross. Its own range (0..0.9)
      // is the only bound it needs.
      next.minSize = Math.max(0, Math.min(0.9, next.minSize));
      next.highlight = Math.max(0, Math.min(next.highlight, next.topStrikes));
      saveSetting({ ...next }); // merge — must not drop `mins` / `on`
      return next;
    });
  }, [saveSetting]);
  // The bucket and the Bubbles on/off both persist into the same slot blob, so
  // the panel comes back exactly as you left it.
  const updateBubbleMins = useCallback((m: BubbleBucket) => { setBubbleMins(m); saveSetting({ mins: m }); }, [saveSetting]);
  const updateShowBubbles = useCallback((on: boolean) => { setShowGexBubbles(on); saveSetting({ on }); }, [saveSetting]);
  // Pin the current panel as the default. Snapshots the sliders + the bucket;
  // the on/off toggle is deliberately NOT part of a default (you turn the
  // overlay on and off constantly — that's working state, not a preset).
  //
  // The pinned preset is GLOBAL, not per slot: Reset in any card should restore
  // the one setup you deliberately saved.
  const [defSavedFlash, setDefSavedFlash] = useState(false);
  const defFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveBubbleDefault = useCallback(() => {
    writeBubbleDefault({ ...bubbleCfg, mins: bubbleMins });
    setDefSavedFlash(true);
    if (defFlashTimer.current) clearTimeout(defFlashTimer.current);
    defFlashTimer.current = setTimeout(() => setDefSavedFlash(false), 1600);
  }, [bubbleCfg, bubbleMins]);
  useEffect(() => () => { if (defFlashTimer.current) clearTimeout(defFlashTimer.current); }, []);
  // Reset → the pinned default if there is one, else the factory values.
  const resetBubbleCfg = useCallback(() => {
    const saved = readBubbleDefault();
    const next: BubbleCfg = { ...BUBBLE_CFG_DEFAULT, ...bubbleCfgFrom(saved) };
    const mins: BubbleBucket = saved && isBubbleBucket(saved.mins) ? saved.mins : "bar";
    setBubbleCfg(next);
    setBubbleMins(mins);
    saveSetting({ ...next, mins });
  }, [saveSetting]);
  // Mirrored into refs so the imperative overlay draw reads them without
  // re-subscribing. Must stay BELOW the useState above (see bubbleCfgRef).
  useEffect(() => { bubbleCfgRef.current = bubbleCfg; }, [bubbleCfg]);
  useEffect(() => { bubbleMinsRef.current = bubbleMins; }, [bubbleMins]);
  // Auto-collapse the side panel when it would starve the candles.
  //
  // This used to be one flat number (560px of total card width, whatever the
  // panel was). That doesn't survive three cards and two panel kinds: the test
  // that matters is how much CHART is left AFTER the panel, and the 0DTE chain
  // is twice the rail's width. SIDE_PANEL_SPEC carries a per-kind width and
  // minimum, and the rail additionally narrows with the card instead of
  // collapsing outright — a 78px rail still reads.
  const panelSpec = SIDE_PANEL_SPEC[sidePanel];
  // The spec widths are already narrow, so the old "shrink the rail with the
  // card" clamp had nothing left to give — it bottomed out above the spec and
  // never fired. Just take the spec.
  const panelW = panelSpec.w;
  // cardW === 0 is the pre-measure first paint — assume it fits rather than
  // flashing the panel out and back in.
  const railFits = sidePanel !== "none" && (cardW === 0 || cardW - panelW >= panelSpec.minChart);
  // The panel is on but there isn't room. Surfaced in the dock so a missing rail
  // reads as "too narrow", not as a bug.
  const panelSuppressed = sidePanel !== "none" && !railFits;
  // Live per-strike net GEX for the vertical rail (SPX-strike space). Metric
  // follows the heatmap's Vol+OI / Vol toggle. Updated from each /ws/gex frame.
  const [railRows, setRailRows] = useState<RailRow[]>([]);
  // Imperative repaint handle for the rail so scroll/zoom of the candle chart
  // keeps the strike bars pinned to the chart's price axis.
  const railDrawRef = useRef<() => void>(() => {});
  // Maps an ES price to the candle chart pane's Y pixel. The rail canvas shares
  // the chart's top+height, so the same Y aligns strike-to-strike.
  const priceToY = useCallback((esPrice: number): number | null => {
    const s = candleSeriesRef.current;
    if (!s) return null;
    const y = s.priceToCoordinate(esPrice);
    return y == null ? null : (y as number);
  }, []);


  // ── Embedded-card control channel ──────────────────────────────────────────
  // When this page is iframed as a HOME2 card (?embed=1), the parent can toggle
  // the chart overlays via postMessage, and we echo current state back so the
  // card's dropdown stays in sync. Same-origin only (parent is the same app).
  const OVERLAY_SETTERS: Record<string, (v: boolean) => void> = useMemo(() => ({
    heatmap: setShowHeatmap,
    profile: setShowProfile,
    tpo: setShowTpo,
    levels: setShowLevels,
    pdhon: setShowSessions,
  }), []);
  const overlayState = useMemo(() => ({
    heatmap: showHeatmap, profile: showProfile, tpo: showTpo,
    levels: showLevels, pdhon: showSessions,
  }), [showHeatmap, showProfile, showTpo, showLevels, showSessions]);

  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return; // only in an iframe
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; overlay?: string; value?: boolean };
      if (!d || d.type !== "es-overlay") return;
      if (d.overlay === "__sync__") { broadcast(); return; } // parent asked for current state
      const setter = d.overlay ? OVERLAY_SETTERS[d.overlay] : undefined;
      if (setter) setter(!!d.value);
    };
    const broadcast = () => {
      try { window.parent.postMessage({ type: "es-overlay-state", state: overlayState }, window.location.origin); } catch {}
    };
    window.addEventListener("message", onMsg);
    broadcast(); // announce initial state on mount
    return () => window.removeEventListener("message", onMsg);
  }, [OVERLAY_SETTERS, overlayState]);

  // Prior-day H/L and overnight H/L from the candle history (ES prices).
  //
  // Overnight = the MOST RECENT completed-or-forming session from one 16:00 ET
  // close to the next 9:30 ET open:
  //   • before 9:30 today        → overnight still building (prior 16:00 → now)
  //   • between 9:30 and 16:00    → overnight FROZEN (prior 16:00 → today 9:30)
  //   • after 16:00 today         → a NEW overnight starts (today 16:00 → now)
  // So ONH/ONL update through the overnight, lock at the 9:30 open, and reset at
  // the next 16:00 close. Depends on `rows` AND a 60s clock so it rolls forward.
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setClockTick((n) => n + 1), 60_000); return () => clearInterval(id); }, []);

  // (The card's width is measured once at the top of the component — see cardRef
  // / cardW. Both the dock density and the side-panel fit rule read it, so there
  // is one ResizeObserver per card rather than one per consumer.)
  const sessionLevels = useMemo(() => {
    if (!rows.length) return null;
    void clockTick; // re-evaluate on the clock so the window rolls forward
    const dayKey = (ts: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ts));

    // Build the ms boundaries for "today" in ET from the current time.
    const now = Date.now();
    const nowMin = etMinutes(now);
    // Midnight-ET ms for a given timestamp (floor to the ET day).
    const etMidnight = (ts: number) => ts - etMinutes(ts) * 60_000 - (new Date(ts).getSeconds() * 1000 + new Date(ts).getMilliseconds());
    const todayMid = etMidnight(now);
    const open0930 = todayMid + 570 * 60_000;
    const close1600 = todayMid + 960 * 60_000;

    // Overnight window [start, end).
    let onStart: number, onEnd: number;
    if (nowMin >= 960) { onStart = close1600; onEnd = now; }          // after close → new O/N
    else if (nowMin >= 570) { onStart = close1600 - 86_400_000; onEnd = open0930; } // RTH → frozen
    else { onStart = close1600 - 86_400_000; onEnd = now; }            // pre-open → building

    // Prior day = the most recent ET day strictly before today.
    const today = dayKey(now);
    const days = [...new Set(rows.map((r) => r.date || dayKey(r.timestamp)))].sort();
    const prevDay = days.filter((d) => d < today).pop();

    let pdh = -Infinity, pdl = Infinity, onh = -Infinity, onl = Infinity;
    for (const r of rows) {
      const d = r.date || dayKey(r.timestamp);
      if (prevDay && d === prevDay) {
        const m = etMinutes(r.timestamp);
        if (m >= 570 && m < 960) { if (r.high > pdh) pdh = r.high; if (r.low < pdl) pdl = r.low; } // RTH only
      }
      if (r.timestamp >= onStart && r.timestamp < onEnd) { if (r.high > onh) onh = r.high; if (r.low < onl) onl = r.low; }
    }
    return {
      pdh: Number.isFinite(pdh) ? pdh : null,
      pdl: Number.isFinite(pdl) ? pdl : null,
      onh: Number.isFinite(onh) ? onh : null,
      onl: Number.isFinite(onl) ? onl : null,
    };
  }, [rows, clockTick]);

  // Initial Balance = today's RTH first 60 min (09:30–10:30 ET). ES prices, like
  // sessionLevels above (no basis). Returns IBH / IBL + 50% midpoint.
  const ibLevels = useMemo(() => {
    if (!rows.length) return null;
    void clockTick;
    const dayKey = (ts: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ts));
    const today = dayKey(Date.now());
    let h = -Infinity, l = Infinity;
    for (const r of rows) {
      const d = r.date || dayKey(r.timestamp);
      if (d !== today) continue;
      const m = etMinutes(r.timestamp);
      if (m >= 570 && m < 630) { if (r.high > h) h = r.high; if (r.low < l) l = r.low; } // 09:30–10:30
    }
    if (!Number.isFinite(h) || !Number.isFinite(l)) return null;
    return { ibh: h, ibl: l, ibm: (h + l) / 2 };
  }, [rows, clockTick]);

  // Session volume profile from today's candles (ES price). 1-pt bins.
  const profile = useMemo(() => {
    const today = rows.length ? rows[rows.length - 1].date : "";
    const todays = today ? rows.filter((r) => r.date === today) : rows;
    return buildVolumeProfile(todays, 1);
  }, [rows]);

  // TPO box profiles: a running ETH → RTH → ETH → RTH strip covering the past
  // day + the current day (4 profiles), each anchored to its own fixed session
  // window (6:00pm-9:30am ET for ETH, 9:30am-4:00pm ET for RTH) so the box
  // column fills that session's full conceptual width on the chart even while
  // still forming — same idea as the volume profile above, just one per
  // session instead of one sidebar.
  const tpoProfiles = useMemo(() => {
    if (!rows.length) return [] as TpoProfile[];
    void clockTick; // roll the window forward with the clock, like sessionLevels above

    const now = Date.now();
    const nowMin = etMinutes(now);
    const etMidnight = (ts: number) => ts - etMinutes(ts) * 60_000 - (new Date(ts).getSeconds() * 1000 + new Date(ts).getMilliseconds());
    const todayMid = etMidnight(now);

    // The ET calendar day whose RTH (9:30-16:00) we're currently in or about
    // to enter. Before 16:00 close, that's today (RTH forming or upcoming);
    // after 16:00 close, the next RTH is tomorrow (ETH now building toward it).
    const sessionDayMid = nowMin >= 960 ? todayMid + 86_400_000 : todayMid;

    // Previous session-day = the last ACTUAL trading day present in the data,
    // not just "yesterday" — a plain calendar-day subtraction lands on a
    // weekend/holiday with zero candles (e.g. Sunday's "yesterday" is
    // Saturday), which silently dropped the whole ETH+RTH pair and made TPO
    // look like it only had the current session. Same `days.filter(d < today)
    // .pop()` pattern already used for PDH/PDL above.
    const dayOf = (r: EsCandleRecord) =>
      r.date || new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(r.timestamp));
    const sessionDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(sessionDayMid + 12 * 60 * 60_000));
    const days = [...new Set(rows.map(dayOf))].sort();
    const prevDay = days.filter((d) => d < sessionDay).pop() ?? null;
    const prevDayRow = prevDay ? rows.find((r) => dayOf(r) === prevDay) : undefined;
    const prevDayMid = prevDayRow ? etMidnight(prevDayRow.timestamp) : null;

    // Session-days to render, oldest to newest — each contributes an ETH then
    // an RTH profile. Skips the previous slot entirely if no trading day was
    // found (e.g. not enough history loaded yet).
    const dayMids = [prevDayMid, sessionDayMid].filter((d): d is number => d != null);

    const sessions: TpoProfile[] = [];
    for (const dMid of dayMids) {
      const rthStart = dMid + 570 * 60_000;                  // 9:30am
      const rthEnd = dMid + 960 * 60_000;                     // 4:00pm
      const ethStart = dMid - 86_400_000 + 18 * 60 * 60_000;  // prior-day 6:00pm
      const ethEnd = rthStart;                                // up to 9:30am

      // A TPO period can never be SMALLER than a bar: buildTpoProfile floors each
      // candle into a period, so on a 1h chart a 30-min period would collapse
      // every bar into its own period and the profile would just restate the
      // candles. At 30m and below this is the classic 30-minute period.
      const tpoPeriodMs = Math.max(TPO_PERIOD_MS, candleMs);

      const ethRows = rows.filter((r) => r.timestamp >= ethStart && r.timestamp < ethEnd);
      const ethProfile = ethRows.length ? buildTpoProfile(ethRows, 1, tpoPeriodMs) : null;
      if (ethProfile) { ethProfile.startTs = ethStart; ethProfile.endTs = ethEnd; sessions.push(ethProfile); }

      const rthRows = rows.filter((r) => r.timestamp >= rthStart && r.timestamp < rthEnd);
      const rthProfile = rthRows.length ? buildTpoProfile(rthRows, 1, tpoPeriodMs) : null;
      if (rthProfile) { rthProfile.startTs = rthStart; rthProfile.endTs = rthEnd; sessions.push(rthProfile); }
    }
    return sessions;
  }, [rows, clockTick, candleMs]);

  // GEX levels from /ws/gex. callWall/putWall/gexFlip are SPX-point values; the
  // chart plots ES, so we offset by the live basis (esFut - spx) before drawing.
  // mvc is plumbed but disabled for now (lives in mvc_snapshots, not the feed).
  const [levels, setLevels] = useState<{
    callWall: number | null;
    putWall: number | null;
    gexFlip: number | null;
    mvc: number | null;
    spx: number | null;
    esFut: number | null;
    // Server-computed esFut-spot, only updated when both feeds were fresh
    // within a small window of each other (see market-state.js). Preferred
    // over deriving basis client-side from esFut/spx, which arrive on two
    // independent WS messages and can momentarily be out of sync.
    basis: number | null;
  }>({ callWall: null, putWall: null, gexFlip: null, mvc: null, spx: null, esFut: null, basis: null });

  const status = connected ? "live" : "offline";

  // Listen to the SHARED /ws/gex socket for the GEX levels + ES basis inputs.
  // This used to open its OWN WebSocket; combined with the toolbar ticker and
  // useEsCandles that put THREE connections to the same broadcast on this one
  // page. lib/gexSocket owns a single connection, parses each frame once, and
  // replays the last snapshot to late subscribers (so this lazily-mounted route
  // still gets full state the moment it appears, exactly as before).
  const applyGexFrame = (d: Record<string, unknown>) => {
      const spx = Number(d.spot ?? 0);
      const esFut = Number(d.esFut ?? 0);
      // Authoritative basis from the server (esFut-spot, freshness-gated —
      // see market-state.js _recomputeBasis). NaN/0 means this message didn't
      // carry a real value (e.g. the heavy 'gex' frame doesn't include it).
      const rawBasis = Number(d.basis);
      const dBasis = Number.isFinite(rawBasis) && Math.abs(rawBasis) > 0.01 ? rawBasis : null;
      const exp = typeof d.expiry === "string" ? d.expiry : "";
      if (exp) setFeedExpiry((cur) => cur || exp);
      if (Array.isArray(d.expirations) && d.expirations.length) {
        setExpirations(d.expirations.map(String));
      }
      // gexFlip isn't sent by the feed — compute it from gexRows exactly like the
      // home page (zero-crossing of the net-GEX profile nearest spot) so both
      // pages report the same number from the same inputs.
      let computedFlip: number | null = null;
      if (Array.isArray(d.gexRows) && d.gexRows.length) {
        computedFlip = findGEXFlip(d.gexRows as ChainRow[], spx > 0 ? spx : undefined);
      }
      setLevels((prev) => {
        const nextSpx = spx > 0 ? spx : prev.spx;
        const nextEs = esFut > 0 ? esFut : prev.esFut;
        // Prefer the server's freshness-gated basis. Only fall back to a
        // client-side esFut-spx diff (which can be a stale/fresh mismatch —
        // this was the source of the jumpy basis / Put Wall line) when the
        // server hasn't published one yet at all.
        const nextBasis = dBasis != null ? dBasis : prev.basis;
        // Lock basis on first set only — never recalculate intraday so heatmap stays fixed.
        if (nextBasis != null && !basisRef.current) basisRef.current = nextBasis;
        else if (!basisRef.current && nextSpx != null && nextEs != null) basisRef.current = nextEs - nextSpx;
        return {
          callWall: d.callWall != null ? Number(d.callWall) || null : prev.callWall,
          putWall:  d.putWall  != null ? Number(d.putWall)  || null : prev.putWall,
          gexFlip:  computedFlip != null ? computedFlip : prev.gexFlip,
          // CB is owned by the snapshot poll, not the live feed.
          mvc:      prev.mvc,
          basis:    nextBasis,
          spx:      nextSpx,
          esFut:    nextEs,
        };
      });

      // Snapshot per-strike GEX into the current 5-min column.
      const gexRows = d.gexRows;
      // Live gexRows are the FRONT expiry. If the DTE picker is on a different
      // expiry, the heatmap is history-only — don't mix live front columns in.
      const liveExpiry = exp || "";
      // /ws/gex is an SPX feed — full stop. On SPY/QQQ these rows must not reach
      // the rail, the bubble map or the column map: columns are keyed by slot
      // TIMESTAMP, so a live SPX column would both out-rank the recorded ETF
      // column for that slot ("live wins" in the backfill merge) and become the
      // newest column that etfGex derives the walls from — putting ~6800 strikes
      // on a ~640 chart. The expirations/levels handling above still runs; only
      // the per-strike ingestion is symbol-specific.
      const ingestLive = isEsRef.current
        && (!selectedExpiryRef.current || selectedExpiryRef.current === liveExpiry);
      if (ingestLive && Array.isArray(gexRows) && gexRows.length) {
        const cells: GexCell[] = [];
        for (const r of gexRows as Array<Record<string, unknown>>) {
          const strike = Number(r.strike ?? 0);
          // server-v2 emits netGEX (gamma×OI) and netVolGEX (gamma×vol).
          const netOi = Number(r.netGEX ?? r.net_gex ?? r.netGexVal ?? 0);
          const netVol = Number(r.netVolGEX ?? 0);
          if (!(strike > 0)) continue;
          const netOiVol = (Number.isFinite(netOi) ? netOi : 0) + (Number.isFinite(netVol) ? netVol : 0);
          cells.push({ strike, netOiVol, netVol: Number.isFinite(netVol) ? netVol : 0 });
        }
        if (cells.length) {
          // Feed the vertical GEX rail with the current frame's per-strike net,
          // using the active heatmap metric (Vol+OI vs Vol-only).
          const metric = gexMetricRef.current;
          setRailRows(cells.map((c) => ({ strike: c.strike, net: metric === "vol" ? c.netVol : c.netOiVol })));
          const slotTs = slotFloorMs(Date.now());
          // 1-min bucket for the bubble trail (last write in the minute wins).
          const minTs = Math.floor(Date.now() / 60_000) * 60_000;
          const mmap = minuteColsRef.current;
          // ── Does this live frame belong in the bubble trail? ─────────────────
          // The bubble map holds ONE session, and the BACKFILL owns which one
          // (lastBubbleDayRef). A live frame may only EXTEND that day — it never
          // switches it and never clears the map.
          //
          // /ws/gex keeps publishing aux/spot frames when nothing is trading,
          // each stamped with the current wall clock and carrying the last
          // snapshot it ever saw. On a Saturday that is a frame dated Saturday
          // holding Friday's gamma, and barAt() clamps any out-of-range time to
          // the final bar — so it landed as a single stale column of bubbles
          // parked one bar past Friday's close, floating above candles it had
          // nothing to do with. Dropping it is the whole fix: the trail keeps
          // the backfilled session, and the rail + heatmap below still get the
          // frame exactly as before.
          //
          // The empty-map case is the live path's one chance to name the day, so
          // a fresh mount mid-session paints bubbles without waiting on the
          // ~700KB backfill. Gated on etSessionStarted so it can't name a day
          // that never traded — on a weekend the map stays empty until the
          // backfill fills it with Friday.
          //
          // Session ROLLOVER is deliberately not handled here. It looks like it
          // belongs (Monday 09:31 arriving on a map still holding Friday), but a
          // live path that can reassign the day fights the backfill for it: the
          // backfill says Friday because that is the newest data, the next frame
          // says Monday, and each wipes the other's map on every re-fire. The
          // backfill already covers the real rollover from both sides — the
          // wall-clock day wipe above, and the 2880→1440 window change at 09:30,
          // either of which re-keys and refills it.
          const liveDay = etDayKey(minTs);
          if (!mmap.size && !lastBubbleDayRef.current && etSessionStarted(minTs)) {
            lastBubbleDayRef.current = liveDay;
          }
          // Replay passes through untouched: there the map is deliberately the
          // scrubbed day, and live frames are already hidden by the cursor clamp
          // at draw time.
          if (replayOnRef.current || liveDay === lastBubbleDayRef.current) {
            mmap.set(minTs, { slotTs: minTs, cells, spot: spx > 0 ? spx : undefined });
            if (mmap.size > 2000) mmap.delete(Math.min(...mmap.keys()));
            minuteColsVerRef.current++;
          }
          const map = columnsRef.current;
          // Stamp the live column with the SPX spot from THIS frame so it ages
          // into history carrying its own basis, exactly like a DB-backfilled one.
          map.set(slotTs, { slotTs, cells, spot: spx > 0 ? spx : undefined });
          // Keep ~2 full days of 1-min slots (a 24h day = 1440 slots). The old
          // 200 cap chopped off the morning columns mid-session, making the
          // all-day heatmap vanish from the left.
          if (map.size > 10000) {
            const oldest = Math.min(...map.keys());
            map.delete(oldest);
          }
          drawOverlayRef.current(); // repaint with the fresh/updated column
        }
      }
    };

  // Frames arrive pre-parsed from the shared socket.
  const onGexFrame = (msg: GexMessage) => {
    const type = String(msg.type ?? "");
    const d = (msg.data && typeof msg.data === "object" ? msg.data : msg) as Record<string, unknown>;
    if (type === "snapshot" || type === "gex" || type === "GEX_UPDATE" || type === "spot" || type === "aux") {
      applyGexFrame(d);
    }
  };

  // Value-driven bandwidth gate, unchanged — it now decides whether this page
  // subscribes to the shared socket rather than whether it opens its own.
  useGexSocket(esShouldConnect, onGexFrame, undefined, ES_CHART_TOPICS);

  // ── ETF GEX refresh ────────────────────────────────────────────────────────
  // SPX columns arrive two ways: this HTTP backfill for history, then the
  // /ws/gex stream keeps the newest column current minute by minute. SPY/QQQ
  // have no such stream — their rows are written server-side by
  // etf-gex-recorder.js — so without a poll the ETF heatmap would freeze at
  // whatever was on screen when the page loaded. `gexPoll` re-keys the backfill
  // once a minute (the recorder's own cadence); `gexVersion` bumps AFTER rows
  // land, so the derived walls/flip republish against real data rather than one
  // cycle behind it.
  const [gexPoll, setGexPoll] = useState(0);
  const [gexVersion, setGexVersion] = useState(0);

  useEffect(() => {
    if (isEs) return;
    const id = setInterval(() => setGexPoll((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [isEs]);

  // ── Wake refetch ───────────────────────────────────────────────────────────
  // useWsLifecycle CLOSES /ws/gex the moment the tab goes hidden (bandwidth
  // policy — see hooks/useWsLifecycle.ts; the owner is exempt from the IDLE
  // timeout but nobody is exempt from the visibility drop). While that socket
  // is down no 1-min columns arrive, so the bubble trail and the newest heatmap
  // columns simply stop growing.
  //
  // On ES that gap used to be PERMANENT: the 60s `gexPoll` interval above is
  // ETF-only (`if (isEs) return`), and the backfill effect below early-returns
  // on an unchanged `fetchKey` — so once the socket came back, nothing ever
  // refilled the minutes missed while hidden. Come back after a while and the
  // trail is frozen mid-session; come back across an ET day rollover and
  // minuteColsRef still holds only YESTERDAY's minutes, which is the "bubbles
  // don't render at all, I have to reload the page" symptom. Bumping gexPoll
  // re-keys the backfill (gexPoll is part of `fetchKey`), which reloads the
  // window from option_strike_gex_history — pruned to 48h server-side, so
  // anything missed while the tab was hidden is genuinely recoverable.
  //
  // Gated on a MINIMUM hidden duration: alt-tabbing for two seconds must not
  // wipe the column maps and re-pull a ~700KB query. Under the threshold the
  // socket reconnect alone has lost at most one column, and the next WS frame
  // overwrites that minute anyway.
  //
  // Deliberately NOT gated on isEs. On the ETFs this only pulls the 60s poll
  // forward to the instant you look at the page instead of waiting out the
  // remainder of the interval, which is the same thing the user wants.
  const hiddenSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const WAKE_REFETCH_MS = 45_000;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSinceRef.current = Date.now();
        return;
      }
      const since = hiddenSinceRef.current;
      hiddenSinceRef.current = null;
      if (since == null || Date.now() - since < WAKE_REFETCH_MS) return;
      // gexPoll is part of `fetchKey`, so the bump alone invalidates the guard.
      // lastHeatmapKeyRef is left ALONE on purpose — clearing it would make any
      // in-flight backfill fail its own resolution-time staleness check, and
      // this bump already supersedes it.
      setGexPoll((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Rail bars + walls for the ETF symbols, derived from the newest recorded
  // column by the same rule the replay cursor uses. `railRows` and `levels` are
  // both fed by /ws/gex, which only carries SPX.
  const etfGex = useMemo(() => {
    if (isEs) return null;
    void gexVersion; // recompute when a backfill lands
    let newest: GexColumn | null = null;
    for (const c of columnsRef.current.values()) {
      if (!newest || c.slotTs > newest.slotTs) newest = c;
    }
    // This branch is ETF-only (the isEs early-return above), so cbAware is
    // unconditional: CB takes the top slot on its side and the wall behind it
    // becomes that side's runner-up.
    const derived = deriveColumnLevels(newest, gexMetric, { cbAware: true });
    return derived ? { ...derived, spot: newest?.spot ?? null } : null;
  }, [isEs, gexVersion, gexMetric]);

  // Heatmap history backfill. Effective expiry = the DTE picker selection, or
  // the live front expiry when nothing is picked. Re-runs whenever the picker
  // OR the 1D/5D range toggle changes: clears the column map and reloads.
  const heatmapExpiry = selectedExpiry || feedExpiry;
  useEffect(() => {
    // Wait for this slot's saved settings before the first backfill. This is a
    // ~1.6MB request keyed on the expiry and the 1D/2D window, both of which are
    // restored from localStorage in an effect — firing before that lands means
    // one fetch for the defaults, then a second, wiping one for the values the
    // user actually saved. One card made that a wasted request; three make it
    // three, on the critical path.
    if (!settingsLoaded) return;
    // Front mode keys on the time WINDOW alone (anyExpiry), so it can load with
    // no live expiry — critical off-hours/weekends when the WS never publishes
    // one (feedExpiry stays ""). Only an explicit DTE pick needs the string.
    const isFront = !selectedExpiry;
    if (!isFront && !heatmapExpiry) return;
    // Ignored server-side under anyExpiry=1; just needs to be non-empty so the
    // route's `expiry is required` guard passes.
    const queryExpiry = heatmapExpiry || "front";
    // When replaying a PAST day the 1D/5D window (counted back from now) may not
    // reach that day, so widen to the full 5-day cap so the replayed session's
    // GEX (heatmap columns + bubble trail) is included.
    // Retention is 2 days for heatmap/bubbles (option_strike_gex_history is
    // pruned to 48h server-side), so both live and replay windows cap at 2880min.
    //
    // The 1D default is a PERFORMANCE choice, and it quietly stops making sense
    // once the market is shut: "the last 24 hours" measured from Saturday
    // evening lands entirely inside Saturday, and Friday's session — the last
    // one that exists — is outside the request. The response comes back empty
    // and the chart draws Friday's candles with no gamma on them at all.
    // Off-session, ask for the full retention window instead; there is only one
    // session's worth of rows inside 48h at that point, so the "5-day is slow"
    // reasoning doesn't apply. Live hours are untouched.
    //
    // The 2880 cap was itself a bug once retention started counting SESSIONS.
    // Two sessions can span a weekend — Friday's 09:30 open is ~78 hours behind
    // Monday's close — so a 48-hour window cannot REACH Friday from Monday even
    // though the rows are sitting right there. Same effect on a Sunday: 2880
    // minutes measured from Sunday noon starts at Friday noon, which is why a
    // replay of Friday's RTH began at 12:00 instead of 09:30.
    //
    // Widening this costs nothing. Retention bounds how much data EXISTS (2
    // sessions, see pruneOptionStrikeGexHistory in server-v2/_lib-db.cjs); the
    // window only has to be wide enough to reach it, so the response is the
    // same size either way. Live intraday is untouched — it still asks for
    // heatmapDays * 1440.
    const GEX_WINDOW_MAX_MIN = 5760; // 4 days; must match the clamp in api-router.js
    const offSession = !replayOn && !etSessionStarted();
    const minutes = replayOn || offSession
      ? GEX_WINDOW_MAX_MIN
      : Math.min(GEX_WINDOW_MAX_MIN, heatmapDays * 1440);
    // Front mode passes anyExpiry=1, so the server IGNORES `expiry`; the rolling
    // feedExpiry churning each publish must NOT re-fire this ~700KB/5s query.
    // Key on the request window only (an explicit DTE pick keys on expiry too).
    // A same-key re-fire returns WITHOUT touching the in-flight request — we do
    // NOT cancel it (cancelling raced the ~5s fetch against WS churn and wiped
    // the whole trail). Staleness is instead guarded by re-checking the key at
    // resolution below, so only a genuine key change discards a stale response.
    // Symbol is part of the key: switching ES→SPY must invalidate the in-flight
    // /  cached backfill, otherwise the resolution-time key check below would
    // accept SPX columns into the SPY chart.
    // SHAPE = everything that changes WHAT is being requested. gexPoll is
    // deliberately excluded: it only changes WHEN (the 60s ETF poll, and the
    // wake refetch above), and a plain refresh of the same window must not be
    // treated like a symbol/expiry switch. See the wipe rule below.
    // ── Server-side strike truncation (?top=N) ────────────────────────────────
    // The bubble trail draws only the N strongest strikes per column
    // (cfg.topStrikes, default 10, max 30). Pulling the WHOLE ladder for every
    // minute of a 24h window and discarding ~90% of it in the browser is what
    // made this the page's heaviest request. Asking the server for the top N
    // collapses it by roughly an order of magnitude.
    //
    // GATED, because three consumers need the full ladder and would be silently
    // WRONG on a truncated one:
    //   • the heatmap band paints every strike, so it just looks sparse;
    //   • deriveColumnLevels() → findGEXFlip() finds the net-GEX ZERO-CROSSING,
    //     which lives exactly where |net| is smallest — the first thing a
    //     top-N-by-magnitude filter discards. That feeds replay walls/flip and
    //     the ETF walls/flip;
    //   • the Flip Cross Pulse overlay scans minuteColsRef for sign changes.
    // (The server also always keeps the two strikes bracketing every sign change
    // — see the ?top handler in api-router.js — so the flip stays exact even on
    // the truncated path. The gate is belt-and-braces: full ladder whenever
    // anything that reads the ladder's SHAPE rather than its peaks is on.)
    //
    // Part of shapeKey, so flipping any of these re-fetches at full resolution
    // and wipes the truncated columns rather than leaving a half-empty ladder.
    // showFlipCross is deliberately NOT here any more: the flip now arrives
    // per-column from the server (col.flip / col.flipVol), computed on the
    // full ladder, so the overlay no longer needs every strike shipped to it.
    // Heatmap still does (it paints each strike), and replay still rederives
    // walls from the cells via deriveColumnLevels.
    //
    // `!isEs` USED to be here too, on the same reasoning — SPY/QQQ have no
    // /ws/gex stream, so etfGex rederives their walls and flip from these
    // columns. It was costing more than it was buying: on a three-card ES/SPY/
    // QQQ row the two ETF cards pulled 236KB and 259KB against SPX's 107KB, so
    // ~82% of the page's bytes were the full ladder on symbols whose heatmap
    // was switched off.
    //
    // Safe to drop because the SERVER already protects the one thing the gate
    // existed for: the ?top handler in api-router.js always keeps the two
    // strikes bracketing every net-GEX sign change, so findGEXFlip still sees
    // the exact zero-crossing on a truncated ladder. The walls are top-N by
    // magnitude by definition, so a top-30 response cannot miss them either.
    //
    // If the ETF walls or flip ever look wrong, put `|| !isEs` back FIRST and
    // confirm before looking anywhere else — this is the only place the ETF
    // ladder is narrowed.
    const needsFullLadder = showHeatmap || replayOn;
    // Request the slider's MAXIMUM, not its current value. Asking for exactly
    // `cfg.topStrikes` made the URL move every time the slider did — and worse,
    // the saved bubble config is restored in an effect AFTER mount, so the
    // default 10 fired one request and the restored value immediately fired a
    // second. The client already filters to `cfg.topStrikes` at draw time, so a
    // constant max-30 request serves every slider position from one response:
    // stable URL, no refetch on drag, no restore-triggered duplicate.
    const topStrikes = needsFullLadder ? 0 : BUBBLE_CFG_RANGE.topStrikes.max;
    // `expiry` is IGNORED server-side under anyExpiry=1 (the Any query takes only
    // since+symbol), but it still has to be CONSTANT or the URL churns: the live
    // feed publishes an expiry a moment after mount, `heatmapExpiry` flips from
    // "" to "2026-07-31", and the request re-fired against a different URL that
    // dedupeFetch could not collapse — while shapeKey still said "front", so the
    // guard never saw a change. Send the literal placeholder in front mode.
    const urlExpiry = isFront ? "front" : queryExpiry;
    const shapeKey = `${sym.gexSymbol}|${isFront ? "front" : queryExpiry}|${minutes}|${activeReplayDay ?? ""}|top${topStrikes}`;
    const fetchKey = `${shapeKey}|${gexPoll}`;
    if (fetchKey === lastHeatmapKeyRef.current) return;
    lastHeatmapKeyRef.current = fetchKey;
    // WIPE ONLY ON A SHAPE CHANGE. When the picker or range changes, the
    // existing columns are the WRONG data — wipe them so we don't mix expiries
    // or leave stale far-back columns after switching to 1D.
    //
    // A same-shape refresh (60s ETF poll, or the wake refetch) is a MERGE, not
    // a reload: the response is a superset of what's already on screen, and the
    // merge below already resolves collisions correctly ("live wins" for the
    // 5-min map, first-write-wins for the 1-min bubble map). Clearing here
    // unconditionally meant the chart went blank for the ~1–5s the query takes
    // — every 60 seconds on the ETFs, and, worse, at the exact moment you tab
    // back to the page, which reads as "the bubbles vanished again".
    //
    // The one same-shape case that DOES need a wipe is an ET day rollover: the
    // bubble map is single-day, so minutes carried over from yesterday would
    // otherwise survive and poison the session-max/top-strike scaling that all
    // the bubble radii are normalized against.
    //
    // This check is on the WALL CLOCK (lastWallDayRef), not on the day the data
    // turned out to be from (lastBubbleDayRef, wiped at merge time below). Its
    // job is the tab left open across midnight, where the live socket starts
    // stamping a new day's minutes into a map still holding the old session.
    const wallDayNow = replayOn && activeReplayDay ? activeReplayDay : etDayKey(Date.now());
    const shapeChanged = shapeKey !== lastHeatmapShapeRef.current;
    const dayChanged = wallDayNow !== lastWallDayRef.current;
    lastHeatmapShapeRef.current = shapeKey;
    lastWallDayRef.current = wallDayNow;
    if (shapeChanged) {
      columnsRef.current.clear();
      minuteColsRef.current.clear();
      minuteColsVerRef.current++;
      drawOverlayRef.current();
    } else if (dayChanged) {
      minuteColsRef.current.clear();
      minuteColsVerRef.current++;
      drawOverlayRef.current();
    }
    (async () => {
      try {
        // Front (live) mode = rolling 0DTE, a different expiry string every
        // trading day, so ask the server to ignore the expiry filter and pull
        // by time window alone (anyExpiry=1) — otherwise backfill only ever
        // matches today. An explicit DTE pick keeps the exact expiry match.
        // dedupeFetch, not fetch: this URL was firing TWICE on page load with an
        // identical query string (~400ms and a few hundred KB duplicated on the
        // critical path). The fetchKey guard above only catches re-fires it can
        // see — a remount or a second consumer slips past it. Two identical
        // concurrent GETs can only want the same bytes, so they share one
        // request. Not a cache: the entry is dropped as soon as it settles.
        // holdMs: the bare concurrency collapse only worked while the two
        // firings happened to overlap. This effect fires once on settingsLoaded
        // and again when selectedExpiry resolves, and once the expiry started
        // resolving from sessionStorage instead of the network the second firing
        // landed AFTER the first request settled — so dedupeFetch saw no overlap
        // and all three cards fetched twice (6 requests, ~2.2MB). Holding the
        // settled entry 20s makes the collapse independent of that timing. Safe:
        // this is history, and /ws/gex keeps the newest column current.
        const res = await dedupeFetch(
          `/api/snapshots/option-strike-gex-history?mode=heatmap&minutes=${minutes}&expiry=${encodeURIComponent(urlExpiry)}${isFront ? "&anyExpiry=1" : ""}&symbol=${encodeURIComponent(sym.gexSymbol)}${topStrikes > 0 ? `&top=${topStrikes}` : ""}`,
          { cache: "no-store" },
          20_000,
        );
        if (!res.ok) {
          console.warn("[gex-backfill] HTTP", res.status, "— heatmap/bubble history will be empty");
          return;
        }
        const json = await res.json();
        // The route answers 200 EVEN ON A SERVER EXCEPTION, with an `error` key
        // and no `columns` (see its catch in server-v2/api-router.js). That is
        // how a `TypeError: libDb.normGexSymbol is not a function` went
        // unnoticed for days: `res.ok` was true, `columns` was absent, and the
        // empty result read as "no data recorded yet". Never silent again.
        if (json?.error) {
          console.warn("[gex-backfill] server returned an error — heatmap/bubble history will be empty:", json.error);
          return;
        }
        // History persists both net_gex (OI+vol) and net_vol_gex (vol-only), so
        // the Vol-only heatmap mode now has backfill too. netVol falls back to 0
        // for legacy rows written before the column existed.
        type RawCol = { slotTs: number; cells: Array<{ strike: number; net: number; netVol?: number }>; spot?: number };
        if (!Array.isArray(json?.columns)) {
          console.warn("[gex-backfill] response has no `columns` array — got keys:", Object.keys(json ?? {}));
        }
        const raw = Array.isArray(json.columns) ? (json.columns as RawCol[]) : [];
        // Only a genuine key change (DTE pick / range switch) invalidates this
        // response; a same-key WS re-render must NOT discard it.
        if (lastHeatmapKeyRef.current !== fetchKey || !raw.length) return;
        const map = columnsRef.current;
        // DB rows are 1-min granular; snap to the 5-min candle grid. Sort
        // descending so the newest snapshot within each bucket wins (first seen).
        const sortedRaw = [...raw].sort((a, b) => b.slotTs - a.slotTs);
        // Bubble trail backfill: TODAY only, at native 1-min granularity (no
        // 5-min flooring). Same rows, different bucket — the heatmap coarsens
        // them, the bubbles don't.
        const mmap = minuteColsRef.current;
        // ── Which day does the bubble trail show? ────────────────────────────
        // Replay → the day being scrubbed. Otherwise: the newest day in the
        // response that ACTUALLY TRADED and that the chart has candles for.
        //
        // Two wrong answers came before this one, and both are worth keeping
        // written down because they look right.
        //
        //   1. etDayKey(Date.now()) — "today". Wrong the moment the market is
        //      shut: on a Saturday nothing in the response carries today's key,
        //      every column failed the filter, and the trail was empty.
        //
        //   2. "the newest day present in the response". Also wrong, because
        //      the recorder does not stop on a weekend. proxy-tastytrade calls
        //      writeGexSnapshot off the streamer's last cached greeks, and
        //      gex-history-writer has no market-hours gate — so all Saturday it
        //      writes a frozen copy of Friday's book once a minute, stamped
        //      Saturday. "Newest day with data" is therefore SATURDAY, a day
        //      with no candles at all, and every one of those minutes collapsed
        //      onto the final bar (see the clamp note in barAt) into the single
        //      stack of bubbles floating past Friday's close.
        //
        // Hence both tests. isEtWeekend throws out the days that only exist
        // because the writer never sleeps; the bar-day check throws out
        // anything the chart cannot draw a trail on anyway — which also covers
        // holidays, where the same stale-write problem exists on a weekday.
        // Bars may not have loaded yet on the very first backfill, so an empty
        // bar set means "don't filter on it" rather than "reject everything".
        const barDays = new Set<string>();
        for (const b of rowsRef.current) barDays.add(etDayKey(b.timestamp));
        let pickedKey = "";   // traded AND on the chart
        let tradedKey = "";   // traded, but no candles for it — the fallback
        for (const col of sortedRaw) { // already newest-first
          if (!Array.isArray(col.cells) || !col.cells.length) continue;
          if (isEtWeekend(col.slotTs)) continue;
          const k = etDayKey(col.slotTs);
          if (!tradedKey) tradedKey = k;
          if (!barDays.size || barDays.has(k)) { pickedKey = k; break; }
        }
        const targetKey = replayOn && activeReplayDay
          ? activeReplayDay
          : (pickedKey || tradedKey || etDayKey(Date.now()));
        // The day the map holds just changed (rolled into a new session, or the
        // weekend fallback resolved to a different Friday) — drop the old day's
        // minutes rather than normalizing two sessions against one scale.
        if (targetKey !== lastBubbleDayRef.current) {
          lastBubbleDayRef.current = targetKey;
          mmap.clear();
        }
        for (const col of sortedRaw) {
          const slotTs = slotFloorMs(col.slotTs);
          const cells: GexCell[] = col.cells
            .filter((c) => c.strike > 0 && Number.isFinite(c.net))
            .map((c) => ({ strike: c.strike, netOiVol: c.net, netVol: Number(c.netVol ?? 0) }));
          // Historical SPX spot for this snapshot → per-column ES basis at draw
          // time. 0/undefined (legacy rows) falls back to the live basis.
          const colSpot = Number(col.spot ?? 0);
          const spot = colSpot > 0 ? colSpot : undefined;

          if (etDayKey(col.slotTs) === targetKey && cells.length) {
            const minTs = Math.floor(col.slotTs / 60_000) * 60_000;
            if (!mmap.has(minTs)) mmap.set(minTs, { slotTs: minTs, cells, spot });
          }

          if (map.has(slotTs)) continue; // live wins on collisions
          map.set(slotTs, { slotTs, cells, spot });
        }
        // Trim to the requested window. Necessary now that a same-shape refresh
        // MERGES instead of wiping: the window is counted back from now, so its
        // left edge walks forward all session. Without a trim the 1D heatmap
        // would quietly accumulate columns older than 1D — every one of them
        // already outside what the server would return. The cutoff is the same
        // one the query used, so this can only drop what the response omitted.
        const cutoff = Date.now() - minutes * 60_000;
        for (const k of [...map.keys()]) if (k < cutoff) map.delete(k);
        for (const k of [...mmap.keys()]) if (k < cutoff) mmap.delete(k);
        // One bump covers the whole backfill (clear + inserts + trim above).
        minuteColsVerRef.current++;
        // One line, every backfill. The whole failure mode of this path is
        // SILENCE — a 200 with rows that then get filtered to nothing leaves an
        // empty trail that is indistinguishable from "the market is quiet", and
        // that ambiguity has now cost two separate debugging rounds. Print what
        // the response was and what survived the day filter, so the next "the
        // bubbles are wrong" is one console line instead of a bisect.
        console.info("[gex-bubbles]", {
          minutesRequested: minutes, columnsReturned: raw.length,
          targetKey, newestTradedDay: tradedKey || null, onChart: !!pickedKey,
          bubbleMinutes: mmap.size, heatmapColumns: map.size,
        });
        // Rows are in — let the derived walls/flip republish off them.
        setGexVersion((v) => v + 1);
        drawOverlayRef.current();
      } catch (e) {
        // Live feed still populates the front expiry going forward, so this is
        // survivable — but it must not be invisible.
        console.warn("[gex-backfill] failed:", e);
      }
    })();
    // No cleanup cancel: a same-key re-render must not abort a valid in-flight
    // backfill; the resolution-time key check handles real invalidation.
    // showHeatmap / showFlipCross / isEs / bubbleCfg.topStrikes are deps because
    // they feed `topStrikes` above — turning the heatmap on has to re-request at
    // full ladder resolution, and raising the Top Strikes slider has to re-request
    // the wider set. Both land as a shapeKey change, so the truncated columns get
    // wiped rather than merged into.
  }, [settingsLoaded, heatmapExpiry, heatmapDays, replayOn, activeReplayDay, selectedExpiry, sym.gexSymbol, gexPoll,
      showHeatmap, isEs]);

  // Load today's full MVC history (raw SPX strikeOIVol) and refresh every 60s.
  // ES conversion happens at draw time with the live basis.
  //
  // SPX-ONLY. mvc_snapshots records the SPX central-band strike; there is no
  // SPY/QQQ equivalent, and plotting SPX strike levels on a SPY chart would put
  // a line ~10x off-scale. On a non-ES symbol this clears the series instead.
  useEffect(() => {
    if (!isEs) { setMvcHistory([]); return; }
    // `isEs` is true for a freshly-mounted card REGARDLESS of its saved symbol,
    // because `symbol` initialises to "ES". Without this guard a three-card row
    // fetched this 11.6 kB payload three times on load — byte-identical, since
    // mvc_snapshots is SPX-global — and two of the three cards then turned out
    // to be SPY/QQQ and threw their copy away.
    if (!settingsLoaded) return;
    let cancelled = false;
    const load = async () => {
      try {
        // lite=1 — four columns, tuple-encoded. mvc_snapshots has ~22 columns
        // and the default read is a `SELECT *`, so this was ~94KB on every load
        // to draw one step line and derive the basis. This page only ever reads
        // timestamp / strikeOIVol / spxPrice / esPrice.
        //
        // Cached at half the 60s poll: the payload carries no per-card
        // parameter, so two ES cards want literally the same bytes. Not
        // persisted — this one ticks.
        const json = await cachedJson<{ rows?: unknown; cols?: unknown; lite?: number }>(
          `/api/snapshots/mvc?limit=1000&lite=1`,
          { ttlMs: 30_000 },
        );
        const rawRows = Array.isArray(json.rows) ? json.rows : [];
        // Expand tuples → records. Falls back to the legacy object rows when the
        // backend hasn't been deployed yet, so the client can ship independently.
        const rows: Array<Record<string, unknown>> =
          json?.lite === 1 && Array.isArray(json.cols)
            ? (rawRows as unknown[][]).map((t) => {
                const rec: Record<string, unknown> = {};
                (json.cols as string[]).forEach((c, i) => { rec[c] = t[i]; });
                return rec;
              })
            : (rawRows as Array<Record<string, unknown>>);
        const pts = rows
          .map((r: Record<string, unknown>) => {
            // Every CB snapshot stores spxPrice AND esPrice sampled at the SAME
            // instant — an exact basis for that row, better than anything we can
            // infer from candles or daily closes.
            const spxPx = Number(r.spxPrice ?? 0);
            const esPx = Number(r.esPrice ?? 0);
            const b = spxPx > 0 && esPx > 0 ? esPx - spxPx : NaN;
            // A basis of ~0 is NOT a valid reading — it means esPrice was never
            // populated and fell back to the SPX value (they're equal). Accepting
            // it plots SPX strikes on the ES axis with no offset at all, which is
            // exactly the "wrong levels" bug. Demand a real, plausible spread.
            const usable = Number.isFinite(b) && Math.abs(b) >= 1 && Math.abs(b) <= 250;
            // Timestamps have arrived as seconds (and as strings) from this table
            // before — normalize to ms or every day-bucket lookup silently misses.
            let ts = Number(r.timestamp ?? 0);
            if (ts > 0 && ts < 1e12) ts *= 1000;
            // spxPrice is kept even when esPrice is unusable: SPX at a known
            // instant + the ES candle at that instant reconstructs the basis
            // without trusting esPrice at all. (Safe here, unlike the GEX table's
            // `spot`, because CB rows are RTH-only and spxPrice actually ticks.)
            return { ts, spx: Number(r.strikeOIVol ?? 0), spxPx, basis: usable ? b : null };
          })
          .filter((p: { ts: number; spx: number }) => p.ts > 0 && p.spx > 0)
          .sort((a: { ts: number }, b: { ts: number }) => a.ts - b.ts);
        if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debugBasis") === "1") {
          console.log("[basis] raw CB rows (first 3):", rows.slice(0, 3));
          console.log("[basis] parsed CB pts (first 3):", pts.slice(0, 3));
        }
        if (cancelled) return;
        setMvcHistory(pts);
        // Latest CB (SPX points) → the legend chip. strikeOIVol is a real strike,
        // so this is trustworthy — unlike the row's gexFlip column, which the
        // recorders backfill with the CB strike when /api/gex omits a flip. The
        // flip is computed live from gexRows instead (see the /ws/gex handler).
        const latest = pts.length ? pts[pts.length - 1].spx : 0;
        if (latest > 0) {
          setLevels((prev) => (prev.mvc === latest ? prev : { ...prev, mvc: latest }));
        }
      } catch { /* keep last */ }
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [settingsLoaded, isEs]);


  // THE basis used for every SPX→ES conversion on this page (levels, rail, heatmap,
  // CB line, right-axis SPX). Strictly ordered, most-trustworthy first — see the
  // numbered notes inline. The rule that fixes this page: never compute the basis
  // against the broker "SPX" spot, because that spot tracks ES, not cash.
  const effectiveBasis = useCallback(() => {
    // 0. NOT ES → no basis exists. SPY/QQQ candles and SPY/QQQ option strikes are
    //    quoted on the same instrument, so a strike of 640 belongs at 640 on the
    //    chart. Returning 0 here turns every conversion downstream (price lines,
    //    rail, heatmap cells, bubbles, right-axis readout) into an identity, which
    //    is why the ETF symbols need no separate render path. It is also a hard
    //    guard: the refs below are fed by the ES/SPX websocket and keep their last
    //    ES values after a symbol switch, so falling through would offset SPY
    //    strikes by ~50 points of ES-over-SPX carry.
    if (!isEs) return 0;

    // 1. LIVE, while cash is open: last ES CANDLE close − live SPX spot. Both sides
    //    verified good (spot published 7515.34 vs a 7515.89 cash close), both sampled
    //    now, and the ES side is the charted contract — so this is roll-proof AND
    //    current. This is the primary source.
    if (isCashOpen()) {
      const live = lastEsCloseRef.current > 0 && spotRef.current > 0
        ? lastEsCloseRef.current - spotRef.current
        : 0;
      if (isPlausibleBasis(live)) return live;
    }

    // 2. Cash shut (or no live pair): /proxy/es-spx-basis — ES 16:00 close − Yahoo
    //    ^GSPC close. The basis decays only ~1pt/day, so a daily anchor is fine here.
    if (isPlausibleBasis(trustedBasisRef.current)) return trustedBasisRef.current;

    // 3. eod_gex prior-day anchor. LAST resort, and deliberately below Yahoo: its
    //    rows are written by a recorder that has historically only ever backfilled
    //    (Jul 9/10 2026 were stamped 00:34/00:49 UTC — hours after the close), so its
    //    `spot` is not a 4pm print. That is what produced the bogus −14 basis.
    let anchor = prevBasisRef.current;
    if (!isPlausibleBasis(anchor) && dayBasisRef.current.size) {
      const days = [...dayBasisRef.current.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const newest = days[days.length - 1]?.[1] ?? 0;
      if (isPlausibleBasis(newest)) anchor = newest;
    }
    if (isPlausibleBasis(anchor)) return anchor;

    // 4. The server's own basis — only if physically possible. Otherwise 0: a visibly
    //    missing basis beats one that silently bends every level by ~50pt.
    if (isPlausibleBasis(basisRef.current)) return basisRef.current;
    return 0;
  }, [isEs]);

  useEffect(() => {
    let canceled = false;
    const init = async () => {
      const container = chartRef.current;
      if (!container) return;
      if (canceled) return;

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
        rightPriceScale: {
          visible: true,
          borderColor: "rgba(255,255,255,.10)",
        },
        leftPriceScale: {
          visible: false,
        },
        timeScale: {
          borderColor: "rgba(255,255,255,.10)",
          timeVisible: true,
          secondsVisible: false,
          // Axis tick labels in Eastern Time.
          //
          // lightweight-charts v5 TickMarkType:
          //   0 Year | 1 Month | 2 DayOfMonth | 3 Time | 4 TimeWithSeconds
          //
          // This used to test `=== 2 || === 3` for "day/month boundary", but 3 is
          // Time — the type emitted for nearly every tick on an intraday chart.
          // So the whole axis rendered as dates and the clock only ever appeared
          // on the crosshair. Only 0/1/2 are real calendar boundaries; 3/4 are
          // times and must render HH:MM.
          tickMarkFormatter: (t: unknown, tickMarkType: number) => {
            if (typeof t !== "number") return "";
            const d = new Date(t * 1000);
            if (tickMarkType === 0 || tickMarkType === 1 || tickMarkType === 2) {
              return d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
            }
            return d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
          },
        },
        crosshair: { mode: CrosshairMode.Normal },
        localization: {
          // Right axis carries ES only (clean). The SPX equivalent is shown as
          // a badge at the live price + on the crosshair label (see below).
          priceFormatter: (price: number) => price.toFixed(2),
          timeFormatter: (time: unknown) => {
            if (typeof time === "number") {
              return new Date(time * 1000).toLocaleTimeString("en-US", {
                timeZone: "America/New_York",
                hour: "2-digit",
                minute: "2-digit",
              });
            }
            return "";
          },
        },
      });

      const candleSeries = chart.addSeries(CandlestickSeries, {
        // Colors moved to homeTheme (ES_CANDLE_UP / ES_CANDLE_DOWN) so the Prem
        // Diff panel's candles read the same pair instead of copying the hex.
        wickUpColor: ES_CANDLE_UP,
        upColor: ES_CANDLE_UP,
        wickDownColor: ES_CANDLE_DOWN,
        downColor: ES_CANDLE_DOWN,
        // Borders ON, in the SAME color as the fills — visually identical to
        // borderVisible:false (a 1px border over a matching body is invisible).
        // Kept on so a future per-bar `color: transparent` + `borderColor` can
        // render a hollow candle; borderVisible:false would swallow the outline
        // and leave such bars as empty gaps.
        borderVisible: true,
        borderUpColor: ES_CANDLE_UP,
        borderDownColor: ES_CANDLE_DOWN,
        // Spot / last-price line + its axis tag in NEUTRAL GRAY. Left unset it
        // inherits the candle color, so it flipped green/red with the current
        // bar — which put a saturated line right where the eye needs a stable
        // reference, and made it compete with the Call/Put/Flip levels that
        // actually earn their color. Gray reads as "you are here", not "signal".
        priceLineColor: SPOT_LINE_GRAY,
      });
      chartApiRef.current = chart;
      candleSeriesRef.current = candleSeries;
      // The old series is gone with the old chart — any handles still in the map
      // are dead. Drop them so the draw effect recreates against the new series
      // instead of applyOptions-ing a destroyed line.
      priceLinesRef.current.clear();

      // lightweight-charts v5 renders candles into internal canvases that
      // html2canvas copies blank. Expose the library's own takeScreenshot()
      // so the snap/Discord capture can composite the real candle bitmap over
      // the chart layer. captureElement (DataBox) looks for __ltScreenshot.
      if (captureRef.current) {
        (captureRef.current as unknown as {
          __ltScreenshot?: () => { canvas: HTMLCanvasElement; target: HTMLElement } | null;
        }).__ltScreenshot = () => {
          try {
            const c = chartApiRef.current?.takeScreenshot();
            if (!c || !chartRef.current) return null;
            return { canvas: c, target: chartRef.current };
          } catch { return null; }
        };
      }

      // Only re-apply when the integer size actually changes. Sub-pixel layout
      // churn (scrollbar/flex reflow) was firing the observer with effectively
      // identical sizes, and each applyOptions nudged the time scale → the
      // chart jittered back and forth. Guarding on rounded dims stops the loop.
      let lastW = 0, lastH = 0;
      const ro = new ResizeObserver(() => {
        const w = Math.round(container.clientWidth);
        const h = Math.round(container.clientHeight);
        if (w <= 0 || h <= 0 || (w === lastW && h === lastH)) return;
        // Grew from a zero/collapsed size (e.g. mounted inside a just-opened
        // iframe/drawer where the container had 0px at chart-init). The initial
        // fitContent ran against that empty box and parked the candles off-screen,
        // so re-fit once real dimensions land.
        const wasCollapsed = lastW <= 0 || lastH <= 0;
        lastW = w; lastH = h;
        chart.applyOptions({ width: w, height: h });
        if (wasCollapsed) {
          applyDefaultView(chart, barCountRef.current);
          drawOverlayRef.current();
        }
      });
      ro.observe(container);
      lastW = Math.round(container.clientWidth);
      lastH = Math.round(container.clientHeight);
      chart.applyOptions({ width: lastW, height: lastH });

      // Double-click anywhere on the chart → recenter: back to the DEFAULT 4h
      // view (not fit-all — that was the old behavior and it re-crushed the
      // bubbles every time you tried to undo a stray scroll) and snap both price
      // scales back to autoscale (right axis right).
      const onDblClick = () => {
        applyDefaultView(chart, barCountRef.current);
        chart.priceScale("right").applyOptions({ autoScale: true });
        drawOverlayRef.current();
      };
      container.addEventListener("dblclick", onDblClick);

      // Crosshair SPX readout: convert the ES price under the cursor → SPX and
      // pin a label at that y. Cleared when the cursor leaves the chart.
      const onCrosshair = (param: { point?: { y: number }; seriesData?: Map<unknown, unknown> }) => {
        if (!param.point) { setCrossSpx(null); return; }
        const es = candleSeries.coordinateToPrice(param.point.y);
        if (es == null) { setCrossSpx(null); return; }
        setCrossSpx({ y: param.point.y, spx: (es as number) - effectiveBasis() });
      };
      chart.subscribeCrosshairMove(onCrosshair);

      return () => {
        ro.disconnect();
        chart.unsubscribeCrosshairMove(onCrosshair);
        container.removeEventListener("dblclick", onDblClick);
      };
    };

    let cleanup: void | (() => void);
    void init().then((fn) => { cleanup = fn; });

    return () => {
      canceled = true;
      cleanup?.();
      chartApiRef.current?.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const chart = chartApiRef.current;
    if (!candleSeries || !chart) return;

    // Replay: reveal only bars at/before the cursor (null = live, full history).
    const srcRows = replayTs != null ? rows.filter((r) => r.timestamp <= replayTs) : rows;
    const candleData: CandlestickData[] = srcRows.map((row) => ({
      time: toChartTime(row.timestamp),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
    }));

    candleSeries.setData(candleData);
    // Track the price band the candles actually occupy so the heatmap can fade
    // by distance from it.
    if (candleData.length) {
      let lo = Infinity, hi = -Infinity;
      for (const r of srcRows) { if (r.low < lo) lo = r.low; if (r.high > hi) hi = r.high; }
      candleBandRef.current = Number.isFinite(lo) ? { lo, hi } : null;
    } else {
      candleBandRef.current = null;
    }
    // Fit on first data load AND whenever the latest bar's ET day advances past
    // the day we last fit for — so the chart follows the session into the new
    // day instead of staying parked on the prior one. Within the same day we
    // never re-center, preserving the user's pan/zoom on live updates.
    const lastDay = candleData.length ? rows[rows.length - 1].date : "";
    barCountRef.current = candleData.length;
    if (candleData.length && (!didFitRef.current || lastDay !== lastFitDayRef.current)) {
      applyDefaultView(chart, candleData.length);
      didFitRef.current = true;
      lastFitDayRef.current = lastDay;
    }
    updateLiveSpxRef.current();
    // Live candle updates shift the time axis without always firing a logical-
    // range change, which could leave the heatmap overlay painting a stale or
    // cleared frame. Repaint whenever candle data changes.
    drawOverlayRef.current();
    railDrawRef.current();
  }, [rows, replayTs]);

  // Live SPX badge: last ES close → SPX, pinned at its y-coordinate on the
  // right gutter. Recomputed on data, basis, and pan/zoom (range subscribe).
  const updateLiveSpxRef = useRef<() => void>(() => {});
  useEffect(() => {
    updateLiveSpxRef.current = () => {
      const series = candleSeriesRef.current;
      // Follow the replay cursor when active so the badge isn't a lookahead.
      const src = replayTsRef.current != null ? rows.filter((r) => r.timestamp <= replayTsRef.current!) : rows;
      if (!series || !src.length) { setLiveSpx(null); return; }
      const lastEs = src[src.length - 1].close;
      const y = series.priceToCoordinate(lastEs);
      if (y == null) { setLiveSpx(null); return; }
      setLiveSpx({ y, spx: lastEs - effectiveBasis() });
    };
    updateLiveSpxRef.current();
    const chart = chartApiRef.current;
    const onRange = () => updateLiveSpxRef.current();
    chart?.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    return () => { chart?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange); };
  }, [rows, prevCloses, levels.basis, levels.esFut, levels.spx]);

  // Feed the LIVE basis inputs (see effectiveBasis §1). lastEsCloseRef is the charted
  // contract's own price, so a roll can never desync it from the candles.
  useEffect(() => {
    if (rows.length) {
      const c = Number(rows[rows.length - 1].close);
      if (c > 0) lastEsCloseRef.current = c;
    }
  }, [rows]);
  useEffect(() => {
    if (levels.spx != null && levels.spx > 0) spotRef.current = levels.spx;
  }, [levels.spx]);

  // Pull the off-hours fallback basis (see effectiveBasis §2). Refreshed every 30 min:
  // the real basis decays ~a point a day, so that's ample resolution.
  // ES-only: there is no ES−SPX basis to fetch when the chart is showing SPY/QQQ,
  // and leaving the poll running would keep refreshing refs effectiveBasis() is
  // deliberately short-circuiting anyway.
  useEffect(() => {
    if (!isEs) return;
    // Restore guard, same as the mvc poll: every card is momentarily "ES", and
    // this endpoint returns ONE number plus a day map — nothing per-card about
    // it. It was being pulled four times on a three-card load.
    if (!settingsLoaded) return;
    let cancelled = false;
    const pull = async () => {
      try {
        // 5 min TTL against a 30 min poll. The basis decays about a point a day,
        // so a 5-minute-old reading is indistinguishable from a fresh one — and
        // persisting it means a reload draws correct levels before the network
        // answers, instead of falling through to the unreliable live derivation.
        const j = await cachedJson<{ basis?: unknown; days?: unknown }>(
          "/proxy/es-spx-basis",
          { ttlMs: 300_000, persist: true },
        );
        const b = Number(j?.basis);
        if (cancelled) return;
        if (isPlausibleBasis(b)) {
          trustedBasisRef.current = b;
          // Per-session map for the HISTORICAL heatmap/CB conversions. Overwrites the
          // eod_gex-derived map, whose SPX closes are backfill artifacts, not 4pm
          // prints — the same bad data that produced the −14 basis.
          const days = j?.days;
          if (days && typeof days === "object") {
            const next = new Map<string, number>();
            for (const [d, v] of Object.entries(days)) {
              const n = Number(v);
              if (isPlausibleBasis(n)) next.set(d, n);
            }
            if (next.size) dayBasisRef.current = next;
          }
          drawOverlayRef.current();
          railDrawRef.current();
        } else {
          console.warn(`[basis] trusted basis unusable:`, j);
        }
      } catch (e) {
        console.warn("[basis] trusted basis fetch failed:", e);
      }
    };
    void pull();
    const id = setInterval(pull, 1_800_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [settingsLoaded, isEs]);

  // Keep basisRef live for the right-axis dual ES/SPX formatter even when no
  // WS frame has arrived recently. Mirrors the server's authoritative
  // levels.basis (see apply()); only re-derives esFut − spx client-side when
  // the server hasn't published a basis yet at all. Previously this recomputed
  // esFut − spx on every change to EITHER field, which fires independently
  // (they arrive on separate 'spot'/'aux' WS messages) and was the source of
  // the jumpy basis / Put Wall line.
  useEffect(() => {
    if (levels.basis != null) {
      basisRef.current = levels.basis;
    } else if (levels.esFut != null && levels.spx != null) {
      basisRef.current = levels.esFut - levels.spx;
    }
  }, [levels.basis, levels.esFut, levels.spx]);

  // Frozen prior-day basis for the overnight / pre-open right axis.
  // prior-day ES 16:00 close (es_candles) − prior-day SPX 16:00 close (eod_gex).
  // Recomputed when history loads; refreshed every 5 min to roll past midnight.
  // ES-only, same reason as the /proxy/es-spx-basis poll above — and this one
  // would additionally spam the "NO ANCHOR" warning on every SPY/QQQ refresh,
  // since ETF bars have no 16:00 ES close to anchor against.
  useEffect(() => {
    if (!isEs) return;
    let cancelled = false;
    const compute = async () => {
      // Prior-day ES RTH close = the 16:00 ET bar of the most recent past day.
      const esBars = historical
        .filter((c) => ((c.slotKey ?? "").slice(11, 16) === "16:00" || (c.time ?? "").slice(0, 5) === "16:00"))
        .filter((c) => Number(c.close) > 0)
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
      const esRow = esBars.length ? esBars[esBars.length - 1] : null;
      if (!esRow) {
        // No 16:00 bar in the loaded history → no anchor → effectiveBasis() has to
        // fall back to the live (unreliable) reading. This is never OK silently:
        // it is the single point of failure behind every "levels are off by ~50pt"
        // report, so say so out loud.
        console.warn(`[basis] NO ANCHOR: no 16:00 ES bar in ${historical.length} historical bars`);
        return;
      }
      const esClose = Number(esRow.close);
      const esDate = esRow.date ?? (esRow.slotKey ?? "").slice(0, 10);

      // Prior-day SPX close from eod_gex. Prefer the row matching the ES date;
      // else the most recent SPX EOD available.
      try {
        // Prior-day closes: they change once a day at 16:00 ET, and the same 30
        // rows serve every card. 10 min TTL + persist means this is fetched once
        // per session rather than once per card per history reload — and after a
        // reload the anchor is available synchronously, which matters because the
        // fallback here is the "levels are off by ~50pt" path.
        const json = await cachedJson<{ rows?: unknown }>(
          `/api/eod-gex?symbol=$SPX&limit=30`,
          { ttlMs: 600_000, persist: true },
        ).catch((e) => {
          if (e instanceof HttpError) console.warn(`[basis] NO ANCHOR: /api/eod-gex HTTP ${e.status}`);
          else console.warn("[basis] NO ANCHOR: /api/eod-gex failed:", e);
          return null;
        });
        if (!json) return;
        const spxRows: Array<{ date: string; spot: number }> = Array.isArray(json.rows) ? json.rows : [];
        const match = spxRows.find((r) => r.date === esDate) ?? spxRows[0];
        const spxClose = Number(match?.spot ?? 0);
        if (!cancelled && esClose > 0 && spxClose > 0) {
          const anchor = esClose - spxClose;
          if (isPlausibleBasis(anchor)) {
            prevBasisRef.current = anchor;
            setPrevCloses({ es: esClose, spx: spxClose, date: esDate });
          } else {
            // ES close and SPX close disagree impossibly → one of them is from the
            // wrong contract/day. Refuse it; a bad anchor poisons every level.
            console.warn(`[basis] REJECTED anchor ${anchor.toFixed(2)} (es=${esClose} spx=${spxClose} date=${esDate})`);
          }
        } else if (!cancelled) {
          console.warn(`[basis] NO ANCHOR: esClose=${esClose} spxClose=${spxClose} esDate=${esDate} eodRows=${spxRows.length} (dates: ${spxRows.slice(0, 3).map((r) => r.date).join(",")})`);
        }
        // Same two sources, but for EVERY day we have both closes for → the
        // per-session basis map used by all historical SPX→ES conversions
        // (heatmap cells + CB/MVC history). Window-independent by construction.
        if (!cancelled) {
          const spxByDate = new Map(spxRows.map((r) => [r.date, Number(r.spot ?? 0)]));
          const next = new Map<string, number>();
          for (const bar of esBars) {
            const d = bar.date ?? (bar.slotKey ?? "").slice(0, 10);
            const es = Number(bar.close);
            const spx = Number(spxByDate.get(d) ?? 0);
            if (d && es > 0 && spx > 0 && isPlausibleBasis(es - spx)) next.set(d, es - spx);
          }
          // Only if the trusted (Yahoo-based) map hasn't already populated it. eod_gex's
          // SPX closes are backfill artifacts — this is the weaker source and must not
          // clobber the good one on its 5-min refresh.
          if (next.size && !isPlausibleBasis(trustedBasisRef.current)) {
            dayBasisRef.current = next;
            drawOverlayRef.current(); // repaint with the corrected historical basis
          }
        }
      } catch { /* keep last frozen basis */ }
    };
    void compute();
    const id = setInterval(compute, 300_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [historical, isEs]);

  // ── Price-line values: ES-tick quantized, republished at most once a minute ──
  // Two separate sources of per-frame churn fed these lines:
  //   1. `levels` gets a NEW object identity on every /ws/gex frame because
  //      spx/esFut tick continuously — even when the walls haven't moved.
  //   2. effectiveBasis() derives the live basis from lastEsCloseRef −
  //      spotRef, BOTH of which tick. So even a frozen wall re-projected onto
  //      the ES axis every frame wobbled 1–2 points.
  // Neither of these levels moves fast enough to justify sub-minute updates,
  // so: snap to 0.25 (the ES tick — a level between ticks isn't tradeable
  // anyway), recompute on a 1-min cadence, and only publish when a quantized
  // value actually CHANGED.
  const ES_TICK = 0.25;
  const toTick = (v: number) => Math.round(v / ES_TICK) * ES_TICK;

  const [lineLevels, setLineLevels] = useState<{ callWall: number | null; putWall: number | null; gexFlip: number | null }>(
    { callWall: null, putWall: null, gexFlip: null }
  );
  const levelsRef = useRef(levels);
  useEffect(() => { levelsRef.current = levels; }, [levels]);

  // Flips false→true exactly once, when the first real level lands — that
  // re-runs the effect below so the lines paint immediately instead of waiting
  // out the first 60s interval.
  const hasLevels = levels.callWall != null || levels.putWall != null || levels.gexFlip != null;

  // Switching symbol drops every GEX artifact of the previous one. Columns are
  // keyed by slot TIMESTAMP, not by symbol, so leaving them would let SPX
  // strikes survive into a SPY render and paint a second cloud of cells ten
  // times off-scale. The DTE pick resets to Front for a related reason: the
  // expiration list comes from the SPX feed, and an explicit pick would filter
  // the new symbol's rows by a string that may not exist for it.
  // Declared HERE, below the state it touches — see the TDZ note by bubbleCfg.
  const prevSymbolRef = useRef(symbol);
  useEffect(() => {
    if (prevSymbolRef.current === symbol) return;
    prevSymbolRef.current = symbol;
    columnsRef.current.clear();
    minuteColsRef.current.clear();
    minuteColsVerRef.current++;
    // ── Re-fit the view for the new instrument ────────────────────────────────
    // ES trades ~7500 and SPY ~750 — a 10x price-space change. Two things kept
    // the axis parked on the old range:
    //   1. `didFitRef` stays true after the first fit (by design — the user's
    //      pan/zoom must never be stomped on live updates), so the candle-data
    //      effect's `!didFitRef.current || dayChanged` condition never fired for
    //      a symbol switch and the time window was never re-derived.
    //   2. lightweight-charts turns the right scale's `autoScale` OFF the moment
    //      you drag the price axis, and never turns it back on. Once off, new
    //      data at a completely different magnitude does NOT rescale — the
    //      candles just render off-screen above or below the visible band.
    // A symbol change is exactly the case where overriding the user's framing is
    // correct: their zoom was for a different instrument. Same two calls the
    // double-click "recenter" handler makes.
    //
    // Both a flag reset AND an immediate apply, because effects flush in
    // DECLARATION order and the candle-data effect is declared above this one.
    // On the render where `symbol` flips, `rows` has already recomputed (isEs is
    // in its deps), so that effect runs first — with the new bars but with
    // didFitRef still true, so it skips the fit. Clearing the flag alone would
    // then rely on `rows` changing AGAIN to trigger it, which isn't guaranteed
    // when the new symbol's candles were already cached. Applying here catches
    // that case (barCountRef was just updated by the effect above, so it's the
    // new count); leaving the flag false lets the definitive fit re-run when the
    // rest of the new symbol's history streams in.
    didFitRef.current = false;
    lastFitDayRef.current = "";
    try { chartApiRef.current?.priceScale("right").applyOptions({ autoScale: true }); } catch { /* chart not up yet */ }
    applyDefaultView(chartApiRef.current, barCountRef.current);
    // Deliberately NOT touching lastHeatmapKeyRef. Effects flush in declaration
    // order, and the backfill effect above already ran for the new symbol — it
    // set the key and started its fetch. Clearing it here would make that
    // response fail its own staleness check on arrival and be discarded, and
    // since nothing else re-triggers the effect (gexPoll is frozen on ES) the
    // trail would then stay empty until the user touched the DTE or range
    // control. `fetchKey` already carries sym.gexSymbol, so a real symbol change
    // invalidates it without help.
    setSelectedExpiry("");
    setLineLevels({ callWall: null, putWall: null, gexFlip: null });
    setRailRows([]);
    setLiveSpx(null);
    setCrossSpx(null);
    // The ES-only basis sources are NOT cleared by their own gated effects (they
    // simply stop refreshing), so a switch would leave the previous symbol's
    // ~50pt ES−SPX carry sitting in these refs — and buildBasisAt's
    // "abs(b) >= 1 wins" rule actively PREFERS that stale value over 0 for every
    // prior-day column. Wipe them with the columns they belong to.
    dayBasisRef.current = new Map();
    prevBasisRef.current = 0;
    trustedBasisRef.current = 0;
    basisRef.current = 0;
    setPrevCloses(null);
    setGexVersion((v) => v + 1);
    drawOverlayRef.current();
    railDrawRef.current();
  }, [symbol]);

  // ── Re-fit the view when the timeframe changes ─────────────────────────────
  // Same reason as the symbol switch above: `didFitRef` stays true after the
  // first fit so live updates never stomp the user's pan/zoom, which means a
  // 5m→1h switch would otherwise keep the old LOGICAL range — and the same
  // "last 300 bars" window that showed a day of 5m bars shows twelve days of 1h
  // bars, or four bars going the other way. The user's framing was for a
  // different bar size, so overriding it is correct here.
  const prevIntervalRef = useRef(interval);
  useEffect(() => {
    if (prevIntervalRef.current === interval) return;
    prevIntervalRef.current = interval;
    didFitRef.current = false;
    lastFitDayRef.current = "";
    try { chartApiRef.current?.priceScale("right").applyOptions({ autoScale: true }); } catch { /* chart not up yet */ }
    applyDefaultView(chartApiRef.current, barCountRef.current);
    drawOverlayRef.current();
  }, [interval]);

  useEffect(() => {
    const publish = () => {
      if (replayOnRef.current) return; // replay owns the lines while scrubbing
      // `levels` is the /ws/gex feed, and that feed is SPX. On SPY/QQQ those
      // walls would be SPX strikes (~6800) drawn on a ~640 chart — not merely
      // wrong, but so far off-scale they'd blow out the price axis. Derive the
      // ETF walls from the newest recorded GEX column instead, which is the same
      // rule replay uses.
      const l = isEs
        ? levelsRef.current
        : (() => {
            let newest: GexColumn | null = null;
            for (const c of columnsRef.current.values()) {
              if (!newest || c.slotTs > newest.slotTs) newest = c;
            }
            // Same branch condition as etfGex — ETF only, so cbAware always.
            return deriveColumnLevels(newest, gexMetricRef.current, { cbAware: true })
              ?? { cb: null, callWall: null, putWall: null, gexFlip: null };
          })();
      const b = effectiveBasis();
      const es = (spxLevel: number | null) => (spxLevel != null ? toTick(spxLevel + b) : null);
      const next = { callWall: es(l.callWall), putWall: es(l.putWall), gexFlip: es(l.gexFlip) };
      // Identity-stable when nothing moved → the draw effect doesn't re-fire.
      setLineLevels((prev) =>
        prev.callWall === next.callWall && prev.putWall === next.putWall && prev.gexFlip === next.gexFlip
          ? prev
          : next
      );
    };
    publish();
    const id = setInterval(publish, 60_000);
    return () => clearInterval(id);
  }, [effectiveBasis, hasLevels, replayOn, isEs, gexVersion]);

  // ── Steady basis for the CANVAS overlay ───────────────────────────────────
  // Same defect the price lines above already fixed, in the other half of the
  // chart. draw() called effectiveBasis() RAW on every frame, and that is
  // (lastEsClose − spot) where both sides tick continuously. So a GEX strike
  // that has not moved in an hour got re-projected onto a wobbling basis 60x a
  // second, and the bubbles / heatmap / CB line visibly jittered up and down
  // while the price lines beside them sat perfectly still.
  //
  // The pipeline should be: get GEX data → convert to ES ONCE → render. Not
  // re-convert per frame through a noisy live number. So: same treatment as
  // lineLevels — snap to the ES tick, republish on a 1-min cadence, and only
  // repaint when the quantized value actually CHANGED.
  //
  // Deps mirror lineLevels: hasLevels flips false→true when the first level
  // lands, which re-runs this so the overlay converts immediately instead of
  // waiting out the first 60s with a zero basis.
  const steadyBasisRef = useRef(0);
  useEffect(() => {
    const publish = () => {
      const b = toTick(effectiveBasis());
      if (b === steadyBasisRef.current) return; // nothing moved → no repaint
      steadyBasisRef.current = b;
      drawOverlayRef.current();
      railDrawRef.current();
    };
    publish();
    const id = setInterval(publish, 60_000);
    return () => clearInterval(id);
  }, [effectiveBasis, hasLevels]);

  // Replay: drive the Call/Put Wall + Flip price lines off the reconstructed
  // cursor column (ES-tick snapped). Fires on scrub (replayTs) and on toggle;
  // exiting replay re-runs the live publisher above (replayOn is in its deps).
  useEffect(() => {
    if (!replayOn) return;
    const g = replayGexRef.current;
    const b = steadyBasisRef.current || effectiveBasis();
    const es = (v: number | null | undefined) => (v != null ? toTick(v + b) : null);
    const next = { callWall: es(g?.callWall), putWall: es(g?.putWall), gexFlip: es(g?.gexFlip) };
    setLineLevels((prev) =>
      prev.callWall === next.callWall && prev.putWall === next.putWall && prev.gexFlip === next.gexFlip
        ? prev
        : next
    );
  }, [replayOn, replayTs, effectiveBasis]);

  // Draw GEX level lines (Call Wall / Put Wall / Flip) on the candle series.
  // Update in place; only create/remove when a level appears or disappears.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const defs: Array<{ price: number | null; color: string; title: string; style: LineStyle; width: 1 | 2 }> = [];

    // Call/Put/Flip — toggled by the Levels button.
    if (showLevels) {
      defs.push(
        { price: lineLevels.callWall, color: "#30d158", title: "Call Wall", style: LineStyle.Dashed, width: 1 },
        { price: lineLevels.putWall,  color: "#ff5b5b", title: "Put Wall",  style: LineStyle.Dashed, width: 1 },
        { price: lineLevels.gexFlip,  color: "#f5c518", title: "Flip",      style: LineStyle.Dashed, width: 1 },
      );
    }

    // MVC dashed price line + axis label intentionally removed from the chart.
    // The MVC button now controls only the white step-history line below; the
    // current-MVC horizontal marker/label is no longer drawn.

    // Session levels (prior-day + overnight H/L) — already ES prices, no basis.
    if (showSessions && sessionLevels) {
      defs.push(
        { price: sessionLevels.pdh, color: "#9ca3af", title: "PDH", style: LineStyle.Dotted, width: 1 },
        { price: sessionLevels.pdl, color: "#9ca3af", title: "PDL", style: LineStyle.Dotted, width: 1 },
        { price: sessionLevels.onh, color: "#60a5fa", title: "ONH", style: LineStyle.Dotted, width: 1 },
        { price: sessionLevels.onl, color: "#60a5fa", title: "ONL", style: LineStyle.Dotted, width: 1 },
      );
    }

    // EM bands, on the same PDH/ON toggle — all of these are "where did this
    // instrument already trade / where is it expected to stay" reference levels,
    // as opposed to the GEX walls, which are positioning. Dashed + violet so
    // they don't read as another session high/low.
    //
    // Labelled ±1σ to match the home GEX chart's readouts, which are the same
    // two numbers from the same endpoint. The expiry label rides in the title so
    // the axis tag says which week the band was struck for.
    if (showSessions && emWeekly) {
      const wk = emWeekly.exp ? ` ${emWeekly.exp}` : "";
      defs.push(
        { price: emWeekly.up,   color: EM_VIOLET, title: `+1σ${wk}`, style: LineStyle.Dashed, width: 1 },
        { price: emWeekly.down, color: EM_VIOLET, title: `−1σ${wk}`, style: LineStyle.Dashed, width: 1 },
      );
    }

    // Initial Balance (IBH / IBL / 50%) — toggled by the IB tab. ES prices.
    if (showIb && ibLevels) {
      defs.push(
        { price: ibLevels.ibh, color: "#f59e0b", title: "IBH",   style: LineStyle.Solid,  width: 1 },
        { price: ibLevels.ibl, color: "#f59e0b", title: "IBL",   style: LineStyle.Solid,  width: 1 },
        { price: ibLevels.ibm, color: "#f59e0b", title: "IB 50%", style: LineStyle.Dashed, width: 1 },
      );
    }

    const lines = priceLinesRef.current;
    const wanted = new Set(defs.filter((d) => d.price != null && d.price > 0).map((d) => d.title));

    // Drop lines whose toggle went off / value disappeared.
    for (const [title, pl] of [...lines.entries()]) {
      if (wanted.has(title)) continue;
      try { series.removePriceLine(pl); } catch {}
      lines.delete(title);
    }

    for (const d of defs) {
      if (d.price == null || !(d.price > 0)) continue;
      const existing = lines.get(d.title);
      if (existing) {
        try { existing.applyOptions({ price: d.price }); } catch {}
        continue;
      }
      lines.set(d.title, series.createPriceLine({
        price: d.price,
        color: d.color,
        lineWidth: d.width,
        lineStyle: d.style,
        axisLabelVisible: true,
        title: d.title,
      }));
    }
  }, [lineLevels, showLevels, showSessions, sessionLevels, showIb, ibLevels, emWeekly]);

  // ── Heatmap canvas overlay ────────────────────────────────────────────────
  // Paints one column per 5-min GEX snapshot. Each cell spans its strike bucket
  // vertically (strike → next strike up, converted SPX→ES) and the 5-min slot
  // horizontally, colored by the exact GEX heatmap gradient.
  useEffect(() => {
    const canvas = overlayRef.current;
    const chart = chartApiRef.current;
    const series = candleSeriesRef.current;
    if (!canvas || !chart || !series) return;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      const parent = canvas.parentElement;
      if (!ctx || !parent) return;

      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const ts = chart.timeScale();
      // NOT basisRef.current directly: out of hours that's esFut − frozen spot,
      // which is not a basis at all. effectiveBasis() falls back to the prior-day
      // CLOSE basis whenever SPX cash is shut. See its comment.
      //
      // steadyBasisRef, NOT effectiveBasis() directly: the raw value is
      // (lastEsClose − spot) and both tick, so calling it per frame re-projected
      // every static GEX strike onto a moving basis and the whole overlay
      // jittered 1-2pt continuously. See the steadyBasisRef comment. Falls back
      // to the raw value only for the first frame, before the 1-min publisher
      // has run (it publishes immediately on mount, so this is a hydration-order
      // guard, not a code path that survives).
      const basis = steadyBasisRef.current || effectiveBasis();

      // ── Per-SESSION ES basis ───────────────────────────────────────────────
      // Strikes live in SPX space; the chart plots ES. The basis (ES − SPX) is
      // not constant across days: it drifts with carry/dividends, decays toward
      // 0 into expiry, and steps at the quarterly roll. One live basis slides
      // every older column off its true level (10–30pt over a 5-day window).
      //
      // But it must be resolved PER DAY, not per column. A per-column basis
      // (esClose(t) − spot(t)) looked right in theory and rendered horribly in
      // practice: the persisted `spot` doesn't tick on every snapshot, so any
      // ES move between spot updates leaks straight into the basis and the whole
      // heatmap bends along with the candles. Taking the MEDIAN of that day's
      // (esClose − spot) samples throws away the stale-spot noise while keeping
      // the real day-over-day drift, so bands are flat within a session and step
      // between sessions — which is the truth.
      const esCloseAt = (tsMs: number): number | null => {
        if (!rows.length) return null;
        // Binary search: last candle at or before this slot.
        let lo = 0, hi = rows.length - 1, found = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (rows[mid].timestamp <= tsMs) { found = mid; lo = mid + 1; } else hi = mid - 1;
        }
        if (found < 0) return null;
        // Don't reach across a huge gap (e.g. a weekend) for a basis.
        if (tsMs - rows[found].timestamp > 6 * 60 * 60 * 1000) return null;
        return rows[found].close;
      };
      // One basis per ET session day = median(esClose − spot) over that day's
      // columns. Today's session always uses the LIVE server basis (freshest and
      // consistent with the Call/Put/Flip/CB lines, which are drawn with it) —
      // only closed days get a reconstructed one. Days with no usable stored
      // spot fall back to the live basis.
      const median = (xs: number[]) => {
        const s = [...xs].sort((a, b) => a - b);
        return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
      };
      // basisAt(t) — the ONE conversion used by every SPX→ES mapping of a PAST
      // value on this canvas: heatmap cells AND the CB/MVC history line.
      //
      // Best source is the CB snapshot table: every row stores spxPrice AND
      // esPrice sampled at the SAME instant, so each row is an exact basis
      // reading. CB snapshots are written every 5 min DURING RTH ONLY — there
      // are none in ETH, because SPX doesn't print overnight.
      //
      // That "no ETH rows" fact drives the whole design: overnight the basis is
      // UNMEASURABLE (cash is closed), so we HOLD THE LAST MEASURED BASIS FLAT
      // from the 16:00 close through the night until the next 09:30. We must
      // never compute ES − (stale SPX) in ETH: the stale spot makes ES movement
      // leak straight into the basis and the whole heatmap bends along with the
      // candles. (That was the first version of this and it looked awful.)
      //
      // Resolution order:
      //   1. Today                 → live server basis (matches the Call/Put/Flip
      //                              lines, which are now-values).
      //   2. Last CB snapshot ≤ t  → exact (esPrice − spxPrice), held flat
      //                              forward. Median of the last 3 so one bad row
      //                              can't jump a column. Handles ETH for free.
      //   3. First CB snapshot > t → for timestamps before any CB row exists.
      //   4. dayBasisRef           → daily closes (ES 16:00 − SPX 16:00).
      //   5. GEX column median     → last resort for days with no CB rows at all.
      //   6. live basis.
      //
      // 2–5 are window-independent by construction: NONE may be derived from the
      // loaded heatmap columns alone, or toggling 1D/5D silently moves levels.
      const buildBasisAt = (): ((tsMs: number) => number) => {
        const todayKey = rows.length ? etDayKey(rows[rows.length - 1].timestamp) : "";

        // Per-CB-row basis, ascending by ts. TWO ways to get it, in order:
        //   a) the row's own esPrice − spxPrice (exact, same instant), when
        //      esPrice is actually populated;
        //   b) ES candle close at that instant − spxPrice. spxPrice is live SPX
        //      during RTH, so this is a genuine simultaneous pair too. (This is
        //      NOT the stale-spot trap that bent the heatmap: that came from the
        //      GEX table's `spot`, which doesn't tick. CB rows are RTH-only and
        //      spxPrice moves.)
        const cbPts: Array<{ ts: number; b: number }> = [];
        for (const p of mvcHistory) {
          let b = p.basis;
          if (b == null && p.spxPx > 0) {
            const es = esCloseAt(p.ts);
            if (es != null) {
              const d = es - p.spxPx;
              if (Math.abs(d) >= 1 && Math.abs(d) <= 250) b = d;
            }
          }
          if (b != null) cbPts.push({ ts: p.ts, b });
        }

        // ONE basis per ET session = median of that day's readings.
        //
        // Do NOT apply these per-row. The basis is a slow carry/dividend function
        // — it does not wiggle minute to minute — but each individual reading is
        // noisy: reconstruction (b) pairs a CB row's spxPrice against the 5-MIN ES
        // BAR CLOSE, so any intrabar ES movement lands in the reading. Applied
        // per-row that noise turns the CB's flat strike steps into a cloud of
        // dashes drifting along with price (observed). The per-day median removes
        // it and keeps the real day-over-day drift.
        const dayMed = new Map<string, number>();
        {
          const byDay = new Map<string, number[]>();
          for (const p of cbPts) {
            const k = etDayKey(p.ts);
            const arr = byDay.get(k) ?? [];
            if (!byDay.has(k)) byDay.set(k, arr);
            arr.push(p.b);
          }
          for (const [k, xs] of byDay) if (xs.length) dayMed.set(k, median(xs));
        }
        const cbDays = [...dayMed.keys()].sort();
        // Latest session at or before day k — so ETH (and any day with no CB rows,
        // e.g. a holiday or the pre-open hours) inherits the last session that was
        // actually measurable, held flat. Never measure a basis against a frozen
        // SPX; there is no such thing as an overnight basis reading.
        const heldDay = (k: string): number | null => {
          if (!cbDays.length) return null;
          let lo = 0, hi = cbDays.length - 1, idx = -1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (cbDays[mid] <= k) { idx = mid; lo = mid + 1; } else hi = mid - 1;
          }
          return idx < 0 ? dayMed.get(cbDays[0]) ?? null : dayMed.get(cbDays[idx]) ?? null;
        };

        // NOTE: nothing below may be derived from columnsRef. A basis sourced
        // from the loaded heatmap columns changes with the 1D/5D backfill window,
        // which silently MOVED the CB level when the user toggled the range.
        return (tsMs: number) => {
          // Non-ES: there is no basis on any day, past or present. This has to be
          // stated here as well as in effectiveBasis() — the fallback chain below
          // reaches PAST `basis` into dayBasisRef/prevBasisRef, and its
          // "abs(b) >= 1 beats 0" rule would actively prefer a leftover ES value
          // over the correct zero for every prior-day column.
          if (!isEsRef.current) return 0;
          const k = etDayKey(tsMs);
          // Today, while cash is OPEN, the live basis is the freshest truth and
          // matches the level lines. Today while cash is SHUT, `basis` is already
          // effectiveBasis() → the prior-day close basis, not a stale-spot diff.
          if (k === todayKey) return basis;
          const b = heldDay(k)
            ?? dayBasisRef.current.get(k)
            ?? (basis || prevBasisRef.current);
          // A ~0 basis is never real for ES vs SPX. If every source came back
          // empty/zero, prefer the last known good basis over silently drawing
          // SPX strikes straight onto the ES axis.
          return Math.abs(b) >= 1 ? b : (basis || prevBasisRef.current || b);
        };
      };
      const basisAt = buildBasisAt();

      // ?debugBasis=1 → dump exactly what basis each source yields per ET day, so
      // a wrong level can be traced to a number instead of eyeballed off a chart.
      // Logs once per second at most; costs nothing when the flag is absent.
      if (typeof window !== "undefined"
          && new URLSearchParams(window.location.search).get("debugBasis") === "1"
          && Date.now() - basisDebugAtRef.current > 1000) {
        basisDebugAtRef.current = Date.now();
        const todayKey = rows.length ? etDayKey(rows[rows.length - 1].timestamp) : "";
        const days = [...new Set([...columnsRef.current.values()].map((c) => etDayKey(c.slotTs)))].sort();
        // Count what basisAt would ACTUALLY use: esPrice pair when usable, else
        // reconstructed from the ES candle vs spxPrice.
        const cbByDay = new Map<string, number[]>();
        for (const p of mvcHistory) {
          let b = p.basis;
          if (b == null && p.spxPx > 0) {
            const es = esCloseAt(p.ts);
            if (es != null && Math.abs(es - p.spxPx) >= 1 && Math.abs(es - p.spxPx) <= 250) b = es - p.spxPx;
          }
          if (b == null) continue;
          const k = etDayKey(p.ts);
          const arr = cbByDay.get(k) ?? [];
          if (!cbByDay.has(k)) cbByDay.set(k, arr);
          arr.push(b);
        }
        const table = days.map((d) => {
          const cb = cbByDay.get(d) ?? [];
          // Basis actually applied to that day's first column.
          const col = [...columnsRef.current.values()].find((c) => etDayKey(c.slotTs) === d);
          return {
            day: d,
            isToday: d === todayKey,
            applied: col ? Number(basisAt(col.slotTs).toFixed(2)) : null,
            cbRows: cb.length,
            cbMin: cb.length ? Number(Math.min(...cb).toFixed(2)) : null,
            cbMax: cb.length ? Number(Math.max(...cb).toFixed(2)) : null,
            cbMedian: cb.length ? Number(median(cb).toFixed(2)) : null,
            eodClose: dayBasisRef.current.get(d) != null ? Number((dayBasisRef.current.get(d) as number).toFixed(2)) : null,
            colSpot: col?.spot ?? null,
          };
        });
        console.log(`[basis] live=${basis.toFixed(2)} mvcRows=${mvcHistory.length} withBasis=${mvcHistory.filter((p) => p.basis != null).length}`);
        console.table(table);
      }

      // ms → screen px, INTERPOLATED INSIDE a candle. timeToCoordinate resolves
      // ONLY at timestamps that are actually on the series and returns null
      // everywhere else — that's why 1-min GEX data used to render only every
      // 5 minutes. Anchor on the containing bar, then offset by the sub-bar
      // fraction × barSpacing.
      //
      // ── Do not "simplify" this back to arithmetic. ──
      // The old form was `Math.floor(tMs / CANDLE_MS) * CANDLE_MS`, which works
      // only while every bar sits on an epoch-aligned 5-minute grid. The
      // timeframe switcher broke that assumption in three ways at once: 15m/30m/
      // 1h bars are anchored to 09:30 ET (not to the epoch), the RTH close forces
      // a short bar at 15:30, and any missing bucket leaves a hole. Feed a
      // computed grid timestamp into timeToCoordinate under any of those and it
      // returns null — at which point every heatmap column and every bubble
      // silently disappears, with no error anywhere. Binary-searching the real
      // bar array is immune to all three because it asks the series what it
      // actually holds.
      const barSpacing = (() => {
        try { return ts.options().barSpacing ?? 6; } catch { return 6; }
      })();
      const barAt = (tMs: number): number | null => {
        const bars = rowsRef.current;
        if (!bars.length || tMs < bars[0].timestamp) return null;
        // PAST THE END OF THE CHART IS NOT "THE LAST BAR".
        // The binary search below returns the newest bar at or before tMs, which
        // for anything after the final candle means it CLAMPS — silently. That
        // is what made a bad GEX day render as a lie rather than as nothing:
        // ~800 Saturday minutes all resolved to Friday's last bar, stacked into
        // one column, and drew a full bar-width past the close (xAt's `frac`
        // saturates at 1) as if they were a real print.
        //
        // Two bars of slack, not zero: a GEX minute can legitimately arrive
        // before the candle feed has printed the bar it belongs to, and culling
        // the newest column every time the candles lag is a worse bug than the
        // one this prevents. Anything further out has no bar and gets no pixel.
        const lastBar = bars[bars.length - 1].timestamp;
        if (tMs >= lastBar + 2 * candleMsRef.current) return null;
        let lo = 0, hi = bars.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (bars[mid].timestamp <= tMs) lo = mid; else hi = mid - 1;
        }
        return bars[lo].timestamp;
      };
      const xAt = (tMs: number): number | null => {
        const start = barAt(tMs);
        if (start == null) return null;
        const c0 = ts.timeToCoordinate((start / 1000) as UTCTimestamp);
        if (c0 == null) return null; // off-screen, or a bar the series dropped
        const frac = Math.min(1, (tMs - start) / candleMsRef.current);
        return c0 + frac * barSpacing;
      };

      // GEX columns are stored at 1-minute resolution regardless of the chart's
      // bar size. Painting them at SLOT_MS on a 1h chart gives each column 1/60th
      // of a bar — sub-pixel, so the band turns into noise. Widen the paint
      // bucket with the timeframe to keep roughly today's ~5-columns-per-bar
      // density at every interval. Storage is untouched; this is draw-time only.
      const paintSlotMs = Math.max(SLOT_MS, candleMsRef.current / 5);

      // Slot → [leftX, width] in screen px. Null if the slot isn't on screen.
      const slotX = (slotTs: number): { left: number; w: number } | null => {
        const x0 = xAt(slotTs);
        if (x0 == null) return null;
        const xEndRaw = xAt(slotTs + paintSlotMs);
        const x1 = xEndRaw != null ? xEndRaw : x0 + barSpacing * (paintSlotMs / candleMsRef.current);
        return { left: Math.min(x0, x1), w: Math.max(1, Math.abs(x1 - x0)) };
      };

      // ── 0) Bollinger cloud + weekly EM ──────────────────────────────────
      // Painted FIRST, so everything else — heatmap band, bubbles, profile,
      // level lines — sits on top of them. These are context, not the subject.
      {
        const bands = bbRef.current;
        const bars = rowsRef.current;
        if (bands && bars.length) {
          const clampTs = replayTsRef.current;
          // Screen points for one band edge, in bar order, skipping warm-up
          // nulls and anything past the replay cursor.
          const pts = (vals: Array<number | null>): Array<[number, number]> => {
            const out: Array<[number, number]> = [];
            for (let i = 0; i < bars.length && i < vals.length; i++) {
              const v = vals[i];
              if (v == null) continue;
              const ts = bars[i].timestamp;
              if (clampTs != null && ts > clampTs) break;
              const x = xAt(ts);
              const y = series.priceToCoordinate(v);
              if (x == null || y == null) continue;
              out.push([x, y]);
            }
            return out;
          };
          // One cloud = the area between the inner and outer edge on one side.
          // Down the inner edge, back up the outer — a single closed path, so
          // the fill can't seam where two half-transparent shapes would meet.
          const cloud = (inner: Array<number | null>, outer: Array<number | null>) => {
            const a = pts(inner), b = pts(outer);
            if (a.length < 2 || b.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(a[0][0], a[0][1]);
            for (let i = 1; i < a.length; i++) ctx.lineTo(a[i][0], a[i][1]);
            for (let i = b.length - 1; i >= 0; i--) ctx.lineTo(b[i][0], b[i][1]);
            ctx.closePath();
            ctx.fillStyle = "rgba(167,139,250,0.13)";
            ctx.fill();
            // Hairline on the outer edge only. Outlining both turns the cloud
            // into a tube and competes with the candles for attention.
            ctx.beginPath();
            ctx.moveTo(b[0][0], b[0][1]);
            for (let i = 1; i < b.length; i++) ctx.lineTo(b[i][0], b[i][1]);
            ctx.strokeStyle = "rgba(167,139,250,0.34)";
            ctx.lineWidth = 1;
            ctx.stroke();
          };
          ctx.save();
          cloud(bands.upperInner, bands.upperOuter);
          cloud(bands.lowerInner, bands.lowerOuter);
          // Basis (the SMA the bands are measured from).
          const mid = pts(bands.basis);
          if (mid.length > 1) {
            ctx.beginPath();
            ctx.moveTo(mid[0][0], mid[0][1]);
            for (let i = 1; i < mid.length; i++) ctx.lineTo(mid[i][0], mid[i][1]);
            ctx.strokeStyle = "rgba(167,139,250,0.55)";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.restore();
        }

        // Weekly EM: two flat boundaries across the whole plot. Stored against
        // the CASH underlying, so ES gets the same basis shift as every level.
        const em = weeklyEmRef.current;
        if (em) {
          const b = steadyBasisRef.current || 0;
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = "rgba(250,204,21,0.55)";
          ctx.lineWidth = 1;
          ctx.font = "700 10px var(--font-mono), monospace";
          ctx.fillStyle = "rgba(250,204,21,0.85)";
          for (const [label, price] of [["EM+", em.up], ["EM-", em.down]] as Array<[string, number]>) {
            const y = series.priceToCoordinate(price + b);
            if (y == null || y < 0 || y > h) continue;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
            ctx.fillText(label, 4, y - 3);
          }
          ctx.restore();
        }
      }

      // ── 1) GEX heatmap cells ──
      // Rendered to an offscreen buffer, then composited back through a blur so
      // adjacent strike/time cells melt into smooth bands instead of hard tiles.
      if (showHeatmap) {
        const colsRaw = [...columnsRef.current.values()]
          .filter((c) => replayTsRef.current == null || c.slotTs <= replayTsRef.current)
          .sort((a, b) => a.slotTs - b.slotTs);
        // Thin the 1-minute store down to the paint bucket. On a 5m chart this is
        // a no-op (paintSlotMs === SLOT_MS). On a 1h chart it collapses 60 columns
        // per bar into 12 — without it each column is a sub-pixel sliver and the
        // band renders as aliasing noise, while the per-cell loop runs 60× more
        // often than anything reaches the screen. Last snapshot in each bucket
        // wins, matching how the live map updates a slot in place.
        const cols = paintSlotMs <= SLOT_MS ? colsRaw : (() => {
          const byBucket = new Map<number, GexColumn>();
          for (const c of colsRaw) byBucket.set(Math.floor(c.slotTs / paintSlotMs) * paintSlotMs, c);
          return [...byBucket.values()].sort((a, b) => a.slotTs - b.slotTs);
        })();
        // Stretch the latest column all the way to the right axis so the band
        // fills the gap to the last print. The plot's right edge = canvas width
        // minus the price-axis gutter. We READ that gutter width but CACHE it in
        // a ref and only accept changes of >=1px: the live price label can wobble
        // the measured width sub-pixel each tick, and reacting to that per-frame
        // made the band edge shimmer. The cached, snapped value is stable.
        let measuredScaleW = 0;
        try { measuredScaleW = chart.priceScale("right").width(); } catch {}
        if (Math.abs(measuredScaleW - hmScaleWRef.current) >= 1) {
          hmScaleWRef.current = measuredScaleW;
        }
        const hmPlotRight = Math.max(0, w - hmScaleWRef.current - 1);
        const lastSlotTs = cols.length ? cols[cols.length - 1].slotTs : -1;
        // ── How far right the band may reach ────────────────────────────────
        // Live: the price axis, so the newest column fills the gap to the last
        // print. That stretch is a LIVE affordance and it was the whole reason
        // "the heatmap doesn't replay" while the rail scrubbed fine. The columns
        // were being clamped to the cursor correctly — and then the newest
        // surviving one was smeared from the cursor all the way to the axis,
        // repainting the entire rest of the session with the cursor's snapshot.
        // The reveal was happening underneath a full-width cover.
        //
        // In replay the band stops at the right edge of the CURSOR'S BAR, which
        // is exactly where the revealed candles stop.
        let bandRight = hmPlotRight;
        if (replayTsRef.current != null) {
          const curBar = barAt(replayTsRef.current);
          const curX = curBar != null ? xAt(curBar) : null;
          if (curX != null) bandRight = Math.min(hmPlotRight, curX + barSpacing);
        }

        // Offscreen buffer at the same CSS size (the main ctx is already DPR-
        // scaled, so we draw in CSS px here too). Allocated ONCE and reused;
        // setting width/height is what clears it, so only touch those when the
        // size really changed — otherwise clearRect.
        const bw = Math.max(1, Math.round(w));
        const bh = Math.max(1, Math.round(h));
        if (!hmBufRef.current) hmBufRef.current = document.createElement("canvas");
        const buf = hmBufRef.current;
        const bctx = buf.getContext("2d");
        if (buf.width !== bw || buf.height !== bh) {
          buf.width = bw;
          buf.height = bh;
        } else {
          bctx?.clearRect(0, 0, bw, bh);
        }
        if (bctx) {
          // Active metric, read from the ref so live WS draws pick it up.
          const metric = gexMetricRef.current;
          const valOf = (c: GexCell) => (metric === "vol" ? c.netVol : c.netOiVol);
          // Distance fade: cells inside the visible candle band paint at full
          // weight; beyond it they fade out over `fadeSpan` ES points so far
          // walls become faint context instead of loud floating bars. Returns a
          // 0..1 multiplier applied to each cell's alpha.
          const band = candleBandRef.current;
          const fadeSpan = 30; // ES points to fade to ~floor past the band edge
          const distFade = (esStrike: number): number => {
            if (!band) return 1;
            const d = esStrike < band.lo ? band.lo - esStrike
                    : esStrike > band.hi ? esStrike - band.hi : 0;
            if (d <= 0) return 1;
            return Math.max(0.12, 1 - d / fadeSpan);
          };
          // ── Levels-only heatmap ─────────────────────────────────────────────
          // Intensity at its bottom stop (0.1) switches the gamma wash off and
          // paints ONLY each column's CB / CW / PW. Ranked per column on the
          // ACTIVE metric through valOf(), same as the heat scale, so the marks
          // track the Vol+OI / Vol toggle instead of quietly staying on one
          // basis. The chain rail applies the identical rule off the same
          // slider value — see ChainRail.
          const heatLevelsOnly = atMinIntensity(intensity, INTENSITY_MIN.esCandles);
          for (let ci = 0; ci < cols.length; ci++) {
            const col = cols[ci];
            // Per-session historical basis (see buildBasisAt above).
            const colBasis = basisAt(col.slotTs);
            const sx = slotX(col.slotTs);
            if (!sx) continue;
            // Carry each column forward to the NEXT stored column's left edge so
            // slots with no GEX update (the WS skip-if-unchanged throttle stops
            // re-sending unchanged frames) don't leave empty vertical gaps. The
            // last column stretches all the way to the right axis instead.
            if (col.slotTs === lastSlotTs && bandRight > sx.left) {
              sx.w = bandRight - sx.left;
            } else if (ci + 1 < cols.length) {
              const nextX = slotX(cols[ci + 1].slotTs);
              if (nextX && nextX.left > sx.left) sx.w = nextX.left - sx.left;
            }
            // CULL to the visible plot. slotX only returns null for times the
            // chart doesn't know about — a column scrolled off the left edge still
            // resolves to an off-screen coordinate, so without this every stored
            // column ran the full per-cell loop (~200 strikes × 2 priceToCoordinate
            // + a fillRect each) to paint nothing. At 5D/1-min that's ~1950 columns
            // of work per frame to show the ~40 on screen. Must come AFTER the
            // carry-forward above (that's what sets the real width).
            if (sx.left + sx.w < -2 || sx.left > bandRight + 2) continue;
            // Per-column max + top-3 magnitudes for THIS metric (drives color/rank).
            const absVals = col.cells.map((c) => Math.abs(valOf(c))).filter((v) => v > 0);
            const colMax = absVals.length ? Math.max(...absVals) : 1;
            const colTop3 = [...absVals].sort((a, b) => b - a).slice(0, 3);
            const sorted = [...col.cells].sort((a, b) => a.strike - b.strike);
            const colWalls = heatLevelsOnly
              ? columnWalls(col.cells.map((c) => ({ strike: c.strike, net: valOf(c) })))
              : null;
            for (let i = 0; i < sorted.length; i++) {
              const cell = sorted[i];
              const wk = heatLevelsOnly ? wallAt(colWalls, cell.strike) : null;
              // Levels-only cells take the heatmap's own rank floors (CB 1, CW
              // 2, PW 3), so a wall still paints cyan for +GEX and red for −GEX
              // — same language as every other position of the slider.
              const color = heatLevelsOnly
                ? (wk && valOf(cell) ? gexRankColor(valOf(cell), WALL_RANK[wk]) : null)
                : gexColor(valOf(cell), colMax, intensity, colTop3);
              if (!color) continue;
              const fade = distFade(cell.strike + colBasis);
              if (fade <= 0) continue;
              // Scale the rgba alpha by the distance fade.
              const faded = fade >= 0.999
                ? color
                : color.replace(/,([0-9.]+)\)$/, (_m, a) => `,${(parseFloat(a) * fade).toFixed(3)})`);
              const nextStrike = i + 1 < sorted.length ? sorted[i + 1].strike : cell.strike + 5;
              const pTop = series.priceToCoordinate(nextStrike + colBasis);
              const pBot = series.priceToCoordinate(cell.strike + colBasis);
              if (pTop == null || pBot == null) continue;
              const top = Math.min(pTop, pBot);
              const cellH = Math.max(1, Math.abs(pBot - pTop));
              bctx.fillStyle = faded;
              // Slight bleed (+1px each side) so neighbors overlap before blur.
              bctx.fillRect(sx.left - 0.5, top - 0.5, sx.w + 1, cellH + 1);
            }
          }
          // Composite back at reduced opacity: a soft blurred pass for the
          // blend, then a lighter crisp pass. Kept dim so candles read clearly
          // through it (the heatmap is context, not the foreground).
          ctx.save();
          ctx.globalAlpha = 0.6;
          ctx.filter = "blur(2.5px)";
          ctx.drawImage(buf, 0, 0, w, h);
          ctx.filter = "none";
          ctx.globalAlpha = 0.45;
          ctx.drawImage(buf, 0, 0, w, h); // sharp, dimmed
          ctx.globalAlpha = 1;
          ctx.restore();
        }
      }

      // ── 1b) Per-strike GEX lines — one horizontal line at each strike of the
      // CURRENT (latest) GEX column, line weight + opacity ∝ |net GEX| for the
      // active metric. Same data the heatmap/rail use; cyan = +GEX (calls),
      // red = −GEX (puts). Thicker = larger gamma at that strike.
      {
        // ── 1b) 1-minute per-strike GEX bubbles. One bubble per strike per
        // minute; radius ∝ √|net GEX| at that strike, normalized to the max |GEX|
        // seen across ALL minutes in the buffer (a session-wide scale) so the
        // trail reads as gamma building/bleeding over time. The Strikes/Size/
        // Brightness sliders (bubbleCfg) control which strikes draw and how.
        if (showGexBubbles) {
          // Aggregate the 1-min store into the selected bucket. We keep the LAST
          // minute in each bucket (the freshest read of that strike's gamma), not
          // a mean — averaging smears the very spikes we're trying to show.
          //
          // "bar" tracks the chart's own bar size, which is the only setting that
          // holds across the timeframe switcher: a fixed 5m bucket puts twelve
          // bubble columns inside one 1h candle and merges them back into the
          // solid rail the bucket exists to prevent.
          // "bar" buckets by the CONTAINING BAR via barAt(), not by
          // floor(ts / candleMs): 15m/30m/1h bars are anchored to 09:30 ET and
          // the RTH close forces a short bar, so an epoch-aligned bucket would
          // straddle two candles and put one bubble column half over each.
          const bucketOf = bubbleMinsRef.current === "bar"
            ? (t: number) => barAt(t) ?? t
            : (t: number) => Math.floor(t / (bubbleMinsRef.current as number * 60_000)) * (bubbleMinsRef.current as number * 60_000);
          const metric = gexMetricRef.current;
          const valOf = (c: GexCell) => (metric === "vol" ? c.netVol : c.netOiVol);
          const cfg = bubbleCfgRef.current;

          // ── Everything below is MEMOISED on the data, not the viewport ────
          // Bucketing, the session scale, the expanding runMax and the per-
          // bucket ranking all depend only on (minute store, metric, bucket
          // size, Top-N/Highlight, replay cursor, bar grid) — never on where
          // the chart is scrolled. They used to be rebuilt inside every draw(),
          // and draw() is wired to wheel/pointermove/range-change, so panning a
          // loaded session re-sorted the whole strike list a few hundred times
          // per frame. That was the lag. Now a frame that only moved the
          // viewport reuses this wholesale and just paints.
          //
          // minuteColsVerRef is bumped at every write to the minute store, so a
          // live column landing (or a backfill) invalidates this immediately —
          // the cache can never serve stale gamma.
          const barsSig = rowsRef.current;
          const prepSig = [
            minuteColsVerRef.current,
            metric,
            String(bubbleMinsRef.current),
            cfg.topStrikes,
            cfg.highlight,
            replayTsRef.current ?? "-",
            // barAt() is the "bar" bucketer, so the bar grid is part of the key.
            barsSig.length,
            barsSig.length ? barsSig[barsSig.length - 1].timestamp : 0,
            candleMsRef.current,
          ].join("|");

          let prep = bubblePrepRef.current;
          if (!prep || prep.sig !== prepSig) {
            const byBucket = new Map<number, GexColumn>();
            for (const m of [...minuteColsRef.current.values()].sort((a, b) => a.slotTs - b.slotTs)) {
              if (replayTsRef.current != null && m.slotTs > replayTsRef.current) continue; // replay clamp
              byBucket.set(bucketOf(m.slotTs), m);
            }
            const pMins = [...byBucket.values()].sort((a, b) => a.slotTs - b.slotTs);
            // Session-wide max magnitude → shared radius scale, computed from the
            // minutes BEFORE 15:30 ET only. Into the close, gamma concentrates on 2–3
            // strikes and their |GEX| dwarfs the rest of the day; including them made
            // those few bubbles gigantic and normalized every earlier minute down to
            // nothing. Excluding them means the scale is set by the 15:25-and-earlier
            // session, and the closing strikes just clamp (ratio caps at 1) — so the
            // biggest late bubble is exactly as big as the biggest 3:25 one, never more.
            let pSessMax = 0;
            for (const m of pMins) {
              if (etMinutesOfDay(m.slotTs) >= BUBBLE_SCALE_CUTOFF_MIN) continue;
              for (const c of m.cells) {
                const a = Math.abs(valOf(c));
                if (a > pSessMax) pSessMax = a;
              }
            }
            // Fallback: if the buffer holds ONLY post-15:30 minutes (e.g. the page was
            // opened at 3:45), there's no earlier session to scale against — use those
            // minutes rather than draw nothing.
            if (pSessMax === 0) {
              for (const m of pMins) for (const c of m.cells) {
                const a = Math.abs(valOf(c));
                if (a > pSessMax) pSessMax = a;
              }
            }
            // scaleSqrt DOMAIN: [0, max |GEX| KNOWN AS OF THAT BUCKET]. RANGE:
            // [minSize, maxSize] px.
            //
            // EXPANDING WINDOW, not session-wide: a bucket is normalized against
            // the max seen up to and including itself, so a divisor can never grow
            // after the fact and an already-printed bubble can never shrink. A
            // strong 10:00 wall stays exactly as fat at 15:50 as it was at 10:00;
            // a bigger wall later just clamps (ratio caps at 1) from its own bucket
            // forward. Floored at 15% of sessMax so the first few buckets of the
            // day — where acc is tiny — don't all render at maxSize.
            const pRunMax = new Map<number, number>();
            {
              let acc = 0;
              for (const m of pMins) {
                if (etMinutesOfDay(m.slotTs) < BUBBLE_SCALE_CUTOFF_MIN) {
                  for (const c of m.cells) {
                    const a = Math.abs(valOf(c));
                    if (a > acc) acc = a;
                  }
                }
                pRunMax.set(m.slotTs, Math.max(acc, pSessMax * 0.15));
              }
            }
            // GLOBAL strike selection — the key to the continuous-tube look. Rank
            // strikes by their PEAK |GEX| across the whole session (not per column),
            // so the dominant walls (Call/Put Wall) are the SAME rows in every
            // column and render as unbroken bright tubes, while everything else
            // stays faint. Show Top Strikes = how many rows draw; Highlight = how
            // many of those are the "walls" (big, white-hot, glowing).
            // Ranked by peak |GEX| AS OF each bucket (expanding, same reasoning as
            // runMax above) rather than over the whole session: a strike that was
            // top-N at 10:00 keeps its 10:00 trail forever, even if it's long since
            // fallen out of the current top-N. The newest column still shows only
            // what's top-N right now, so the live read is unchanged.
            //
            // The ranking only CHANGES when a new peak appears, so the sort is
            // skipped for every bucket that didn't move one — on a settled
            // session that is almost all of them.
            const peakSoFar = new Map<number, number>();
            const pShownAt = new Map<number, Set<number>>();
            // strike → its 0-based rank inside the highlighted set (0 = the
            // session's dominant wall as of that bucket). A Map, not a Set,
            // because the rank now drives the radius boost and the glow.
            const pWallAt = new Map<number, Map<number, number>>();
            // Per-bucket bottom of the size scale (see the contrast note below).
            const pFloorAt = new Map<number, number>();
            let shownNow: Set<number> = new Set();
            let wallNow: Map<number, number> = new Map();
            let dirty = true;
            for (const m of pMins) {
              for (const c of m.cells) {
                const a = Math.abs(valOf(c));
                if (a > 0 && a > (peakSoFar.get(c.strike) ?? 0)) { peakSoFar.set(c.strike, a); dirty = true; }
              }
              if (dirty) {
                const ranked = [...peakSoFar.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
                shownNow = new Set(ranked.slice(0, Math.max(0, cfg.topStrikes)));
                wallNow = new Map();
                ranked.slice(0, Math.max(0, cfg.highlight)).forEach((s, i) => wallNow.set(s, i));
                dirty = false;
              }
              // Shared references: the sets are immutable once built, so an
              // unchanged bucket costs one pointer instead of a rebuilt Set.
              pShownAt.set(m.slotTs, shownNow);
              pWallAt.set(m.slotTs, wallNow);
              // ── CONTRAST STRETCH: the floor of the size scale ──────────────
              // Normalising |GEX| against the max alone assumes the ladder uses
              // the whole 0..max range. A real chain does not: strike gamma is
              // a smooth curve, so the dozen strikes around the peak all sit at
              // 60-95% of the max and — at ANY exponent — draw within a couple
              // of pixels of each other. That is the "ten bubbles looking the
              // same" problem, and it is a normalisation bug, not a curve one.
              //
              // So the domain is the SHOWN SET'S OWN RANGE, [floor, runMax],
              // not [0, runMax]. The weakest strike on screen lands on minSize,
              // the strongest on maxSize, and the rest spread across the whole
              // budget however bunched the underlying numbers are. Size is
              // still strictly monotone in |net GEX| — it is a contrast
              // stretch, not a re-ranking — so a bigger dot still means more
              // gamma, and only the CONTRAST changes.
              let floorV = Infinity;
              for (const c of m.cells) {
                if (!shownNow.has(c.strike)) continue;
                const a = Math.abs(valOf(c));
                if (a > 0 && a < floorV) floorV = a;
              }
              pFloorAt.set(m.slotTs, Number.isFinite(floorV) ? floorV : 0);
            }
            // The chain's own strike increment. Data, not viewport — but it used
            // to be recomputed per frame by flat-mapping every cell of every
            // bucket (tens of thousands of entries on a full session) just to
            // find a number that changes once a day.
            let pStrikeStep = 0;
            {
              const ks = [...new Set(pMins.flatMap((m) => m.cells.map((c) => c.strike)))].sort((a, b) => a - b);
              let dK = Infinity;
              for (let i = 1; i < ks.length; i++) {
                const d = ks[i] - ks[i - 1];
                if (d > 0 && d < dK) dK = d;
              }
              if (Number.isFinite(dK) && ks.length > 1) pStrikeStep = dK;
            }
            prep = { sig: prepSig, mins: pMins, sessMax: pSessMax, runMax: pRunMax, shownAt: pShownAt, wallAt: pWallAt, floorAt: pFloorAt, strikeStep: pStrikeStep };
            bubblePrepRef.current = prep;
          }
          const { mins, sessMax, runMax, shownAt, wallAt, floorAt, strikeStep } = prep;

          if (mins.length) {
            if (sessMax > 0) {
              // ── MAX IS THE OVERALL SIZE KNOB ───────────────────────────────
              // `minSize` is a FRACTION of maxSize now, not an absolute pixel
              // floor. With the old `min + ratio*(max-min)` form, dragging Max
              // only moved the top of the ladder: a strike at ratio 0 sat at
              // `min` px no matter where Max went, so the small bubbles never
              // changed and the slider felt half-broken.
              //
              //   r = maxSize * (minFrac + ratio^curve * (1 - minFrac))
              //
              // Now Max is a pure multiplier on the whole ladder — every bubble
              // scales with it — and Min controls the ladder's CONTRAST (how
              // small the weakest strike gets relative to the strongest), which
              // is the thing that was actually wanted from it all along.
              const minFrac = Math.max(0, Math.min(0.9, cfg.minSize));
              // Guarded like curveExp — an older saved blob predates this key.
              const topBoost = Number.isFinite(cfg.topBoost) && cfg.topBoost > 0
                ? cfg.topBoost
                : BUBBLE_CFG_DEFAULT.topBoost;
              // How tightly Max concentrates on the strongest strikes. Higher =
              // fewer bubbles affected. See the topMul note in the draw loop.
              const TOP_BOOST_FOCUS = 4;
              // Size-response exponent (Curve slider). Guarded against an older
              // blob that predates the key — an undefined here would make every
              // radius NaN and silently blank the whole bubble layer.
              const curveExp = Number.isFinite(cfg.curve) && cfg.curve > 0
                ? cfg.curve
                : BUBBLE_CFG_DEFAULT.curve;
              // Brightness gradient: intensity 0..1 → the SMALLEST strike's opacity
              // = max(0.1, 1 - intensity). 0% ⇒ min 1.0 (flat, no gradient); 90% ⇒
              // small strikes ~0.1 so the big walls dominate by contrast.
              const brightness01 = Math.max(0, Math.min(1, cfg.brightness / 100));
              const minOpacity = Math.max(0.1, 1 - brightness01);
              // ── SIZE MEANS ONE THING: |net GEX| AT THAT STRIKE ────────────
              // Highlight no longer touches the radius. It used to multiply it
              // (1.35x flat, then 2.6x graduated, then 1.45x), and every one of
              // those made a strike bigger for a reason that has nothing to do
              // with its gamma — so the size scale silently stopped meaning what
              // the legend says it means. A wall that is 1.4x a neighbour's
              // gamma but drew 2x its size is a lie, and it is exactly why the
              // ladder stopped being rankable by eye.
              //
              // The two channels are now cleanly split:
              //   SIZE  = |net GEX|, nothing else. Read it like the reference
              //           bubble column: bigger dot = more gamma, always.
              //   COLOR = the Highlight-top-N selection. The chosen ranks go
              //           white-hot with a glow; everything else stays base
              //           blue/red with opacity tracking magnitude.
              // Keeping them orthogonal means turning Highlight up or down can
              // never change what the sizes are telling you.
              const HIGHLIGHT_GLOW_TOP = 24; // #1 wall's glow radius, px
              const HIGHLIGHT_GLOW_MIN = 11; // last highlighted wall's glow

              // ── Mark geometry + the two no-overlap caps ────────────────────
              // ROUND. The mark was briefly stretched 2.2x horizontally, on the
              // theory that a row should read as a dashed level rather than a
              // string of beads. It was wrong: the stretch closed the gaps
              // between marks, every row fused into a continuous ribbon, and the
              // trail lost the dotted texture that made the chart legible in the
              // first place. The gaps ARE the design — they are what lets ten
              // rows sit over the candles without burying them.
              //
              // BUBBLE_ASPECT is left as a named constant rather than deleted:
              // it is the one number to change if a slightly oval mark is ever
              // wanted again. 1.0 = circle.
              //
              // Overlap is prevented geometrically rather than by picking sizes
              // that happen to fit — the chart is zoomable, so any "safe" px
              // number stops being safe the moment the user scrolls the price
              // scale. Both caps are derived from the CURRENT projection:
              //   • rx ≤ half the column pitch − gap  → neighbours in a row
              //     can never touch, at any bar spacing.
              //   • ry ≤ half the strike pitch − gap  → two rows can never
              //     touch, at any vertical zoom.
              const BUBBLE_ASPECT = 1.0;  // 1 = round; >1 stretches horizontally
              const COL_GAP_PX = 0.8;     // clear space between neighbours
              // 3px, not 1.5: "not overlapping" is not the same as "clearly
              // separate". Two rows that stop 1.5px short of touching still read
              // as one thick band at a glance, which is the complaint this cap
              // was added for in the first place.
              // ROW_GAP_PX is retired: the vertical bound is now a safety rail
              // rather than a no-touch guarantee (see ryCap below).
              // Column pitch: the smallest gap between two adjacent bucket x's.
              // Sampled from the newest ~40 buckets rather than the whole
              // session — the pitch is uniform (one column per bar) and this
              // runs on every frame, so walking 400 buckets to learn the same
              // number is pure overhead.
              let colPitch = Infinity;
              {
                let prevX: number | null = null;
                let seen = 0;
                for (let i = Math.max(0, mins.length - 40); i < mins.length; i++) {
                  const xx = xAt(bucketOf(mins[i].slotTs));
                  if (xx == null) continue;
                  if (prevX != null) {
                    const d = Math.abs(xx - prevX);
                    if (d > 0 && d < colPitch) colPitch = d;
                    if (++seen >= 12) break;
                  }
                  prevX = xx;
                }
                if (!Number.isFinite(colPitch) || colPitch <= 0) colPitch = 8;
              }
              // Strike pitch: the chain's own strike increment, projected to px
              // through the SAME priceToCoordinate the bubbles use, so it tracks
              // zoom. Measured off the strike grid rather than the shown rows —
              // the shown set changes per bucket, and a cap that changes with it
              // would make a row breathe as its neighbours come and go.
              let rowPitch = 24;
              if (strikeStep > 0) {
                const b0 = basisAt(mins[mins.length - 1].slotTs);
                const k0 = mins[mins.length - 1].cells[0]?.strike ?? 0;
                const yA = series.priceToCoordinate(k0 + b0);
                const yB = series.priceToCoordinate(k0 + strikeStep + b0);
                if (yA != null && yB != null && Math.abs(yA - yB) > 0) rowPitch = Math.abs(yA - yB);
              }
              // ── Column DECIMATION, SIZED BY THE BIGGEST MARK ───────────────
              // This is the bug that made every bubble on the chart look the
              // same size while the same data looked fine in a snapshot column.
              //
              // The old order of operations was backwards: pick a stride that
              // clears some fixed 5px pitch, THEN clamp every mark to
              // `pitch/2 − gap`. With a 5px pitch that clamp is ~1.7px, so the
              // 14px wall, the 8px secondary and the 3px mid strike ALL came
              // out at 1.7px. The size scale was computed perfectly and then
              // thrown away one line later by the anti-overlap clamp. Every
              // rework of the curve, the stretch and the log scale was invisible
              // for exactly this reason.
              //
              // Correct order: the biggest mark decides the pitch, not the other
              // way round. Work out the largest radius that can actually be
              // drawn (maxSize, itself bounded by the vertical row cap), then
              // stride far enough that two of those fit side by side with a gap.
              // Fewer columns, every one at its true size, and overlap is still
              // impossible — it is prevented by the SPACING now rather than by
              // shrinking the thing being spaced.
              const topBoostPre = Number.isFinite(cfg.topBoost) && cfg.topBoost > 0 ? cfg.topBoost : 1;
              const rMaxDrawn = Math.max(0.35, cfg.maxSize * topBoostPre * BUBBLE_ASPECT);
              const neededPitch = 2 * rMaxDrawn + 2 * COL_GAP_PX;
              const colStride = Math.max(1, Math.ceil(neededPitch / Math.max(0.5, colPitch)));
              const effColPitch = colPitch * colStride;
              // Still a cap, but it should now essentially never bind — it is a
              // backstop for the degenerate case where even one stride cannot
              // open up enough room (a chart squeezed to a few pixels tall).
              const rxCap = Math.max(0.35, effColPitch / 2 - COL_GAP_PX);
              // ── The vertical bound is a SAFETY RAIL, not a size policy ─────
              // It used to be `rowPitch / 2 - ROW_GAP_PX`, a hard clip at half
              // the strike spacing. That is what made Size and Max look dead:
              // the walls were already sitting on the clip, so dragging either
              // slider raised a number the draw code then threw away, and the
              // biggest rows never changed by a pixel. Same class of bug as the
              // horizontal clamp — a cap silently overruling the encoding.
              //
              // Rows sit at fixed prices and cannot be spread apart the way
              // columns can, so "bigger walls" and "rows never touch" are in
              // real tension. That is the USER'S call to make with the sliders,
              // not something to decide behind their back: crank Size and the
              // walls are allowed to grow into their neighbours.
              //
              // What stays is a rail at 1.5x the strike pitch, which no sane
              // setting reaches — it exists so a mis-drag cannot paint the
              // whole canvas.
              const ryCap = Math.max(0.35, rowPitch * 1.5);

              // Glow sprites (see glowSpriteRef). Sizes are quantised to a half
              // pixel so a wall that breathes by a hundredth of a px between
              // buckets reuses one sprite instead of minting hundreds.
              const glowCache = glowSpriteRef.current;
              const glowSprite = (rx: number, ry: number, base: number[], fill: number[], blur: number) => {
                const qx = Math.round(rx * 2) / 2;
                const qy = Math.round(ry * 2) / 2;
                const qb = Math.round(blur);
                const key = `${qx}|${qy}|${qb}|${base[0]},${base[1]},${base[2]}|${fill[0]},${fill[1]},${fill[2]}|${Math.round(dpr * 100)}`;
                const hit = glowCache.get(key);
                if (hit) return hit;
                const pad = qb + 2;
                const cw = Math.ceil((qx + pad) * 2);
                const ch = Math.ceil((qy + pad) * 2);
                const cv = document.createElement("canvas");
                cv.width = Math.max(1, Math.round(cw * dpr));
                cv.height = Math.max(1, Math.round(ch * dpr));
                const cx = cv.getContext("2d");
                if (cx) {
                  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
                  cx.shadowColor = `rgba(${base[0]},${base[1]},${base[2]},0.95)`;
                  cx.shadowBlur = qb;
                  cx.fillStyle = `rgb(${fill[0]},${fill[1]},${fill[2]})`;
                  cx.beginPath();
                  cx.ellipse(cw / 2, ch / 2, qx, qy, 0, 0, Math.PI * 2);
                  cx.fill();
                }
                // Bounded: the cache is only ever a handful of entries per
                // session, but a pathological zoom sweep shouldn't grow it
                // without limit.
                if (glowCache.size > 96) glowCache.clear();
                const rec = { cv, w: cw, h: ch };
                glowCache.set(key, rec);
                return rec;
              };

              ctx.save();
              for (let mi = mins.length - 1; mi >= 0; mi--) {
                // Decimation, anchored to the newest bucket (see colStride).
                if ((mins.length - 1 - mi) % colStride !== 0) continue;
                const m = mins[mi];
                // xAt, not timeToCoordinate: these are sub-bar buckets. Snap x to
                // the bucket's own start so the newest column lands on its candle,
                // not in the right-axis gap ("newest bubbles render strange").
                const x = xAt(bucketOf(m.slotTs));
                if (x == null || x < -20 || x > w + 20) continue;
                const mBasis = basisAt(m.slotTs);
                // Per-bucket scale + row filter — both frozen at print time.
                const domainMax = runMax.get(m.slotTs) || sessMax;
                // Bottom of the stretched domain — see the contrast note in the
                // memo. Held a hair below the weakest shown strike so that
                // strike draws at minSize rather than vanishing.
                // Strictly positive: this is the bottom of a LOG domain now, so
                // a zero floor would send the whole scale to −Infinity. A
                // millionth of the max is six decades of headroom, far more
                // than any real chain uses.
                const domainMin = Math.max(
                  Math.min(floorAt.get(m.slotTs) || domainMax * 1e-6, domainMax * 0.98),
                  domainMax * 1e-6,
                );
                const shownStrikes = shownAt.get(m.slotTs);
                const wallStrikes = wallAt.get(m.slotTs);
                if (!shownStrikes || !wallStrikes) continue;
                // Biggest first, so when the user does crank Size past the
                // strike pitch the smaller rows land ON TOP of the wall rather
                // than disappearing underneath it.
                const drawOrder = m.cells
                  .filter((c) => shownStrikes.has(c.strike))
                  .sort((a, b) => Math.abs(valOf(b)) - Math.abs(valOf(a)));
                for (const cell of drawOrder) {
                  const v = valOf(cell);
                  if (!v) continue;
                  // (Walls draw a FULL ROW, same as every other strike. A
                  // single-bubble-per-wall variant was tried and reverted:
                  // every comparable platform — Bullflow, SpotGamma, the SPY
                  // GEX overlay — draws each level as a continuous row of dots
                  // across the session. The row IS the level; one dot at the
                  // right edge reads as an annotation, not a level.)
                  const y = series.priceToCoordinate(cell.strike + mBasis);
                  if (y == null || y < -20 || y > h + 20) continue;
                  // ── LOG SCALE. Net GEX spans FOUR ORDERS OF MAGNITUDE ────
                  // A real SPX chain at 11:26 ran 301.95B at the peak down to
                  // 52.1M at the wings — a 5,800:1 range. On a linear scale the
                  // peak takes the whole budget and everything below the top
                  // three or four strikes lands on minSize: 151.52B and 8.68B,
                  // an 17x difference in actual gamma, drew 4.94px vs 0.61px
                  // while ten more rows sat indistinguishable underneath.
                  //
                  // Gamma is read multiplicatively — "twice the wall", "an
                  // order of magnitude smaller" — so the scale should be too.
                  // On log the same ladder spreads 9.50 / 7.99 / 7.93 / 7.14 /
                  // 5.93 / 5.28 / 5.01 / 4.19 / 3.28 / 3.05 / 2.82 / 2.28 …
                  // every row distinct, and still strictly monotone in |GEX|.
                  //
                  // `curve` still applies ON TOP of this: 1 = pure log, >1
                  // pushes the mid-ladder back down, <1 lifts it.
                  const logLo = Math.log(Math.max(domainMin, domainMax * 1e-6));
                  const logHi = Math.log(Math.max(domainMax, Number.MIN_VALUE));
                  const logSpan = Math.max(logHi - logLo, 1e-6);
                  const ratio = Math.max(0, Math.min((Math.log(Math.max(Math.abs(v), Number.MIN_VALUE)) - logLo) / logSpan, 1));
                  const wallRank = wallStrikes.get(cell.strike);
                  const isHi = wallRank != null;
                  // Size tracks THIS bubble's own |GEX|, shaped by the Curve
                  // exponent, so each tube tapers as gamma builds/bleeds.
                  //
                  // The default is now curve 1.0 — LINEAR. Radius is proportional
                  // to net GEX across the whole ladder: 50% of the session max
                  // draws at 50% of the span, 25% at 25%. That is the read the
                  // ladder is for, and the steep exponents this used to default
                  // to (0.5 = √, then 2.2 / 2.8) both destroyed it from opposite
                  // ends — √ lifted every mid strike up near the wall, and >2
                  // collapsed every non-wall onto Min.
                  //
                  // Wall prominence comes from HIGHLIGHT_BOOST_* below instead,
                  // which is rank-based and therefore cannot flatten the strikes
                  // it isn't applied to. The slider still spans 0.5–8 if you want
                  // either extreme back.
                  // Radius is a pure function of this strike's own |net GEX|.
                  // No rank term, no highlight term — see the note above.
                  // `size` scales the whole ladder; `max` (topBoost) stretches
                  // ONLY its top.
                  //
                  // The weight is ratio^4, not ratio. Linear weighting gave a
                  // mid strike at ratio 0.5 half the boost, so dragging Max
                  // visibly moved every bubble on the chart and it read as a
                  // second Size slider. The 4th power concentrates it hard on
                  // the peak: ratio 0.5 gets 6% of the factor, 0.8 gets 41%,
                  // 0.9 gets 66%, and only the top of the ladder gets the lot.
                  const topMul = 1 + (topBoost - 1) * Math.pow(ratio, TOP_BOOST_FOCUS);
                  const r = cfg.maxSize * (minFrac + Math.pow(ratio, curveExp) * (1 - minFrac)) * topMul;
                  // Rank only drives how hard this row GLOWS (#1 brightest).
                  let hiT = 0;
                  if (isHi) {
                    const nWalls = Math.max(1, wallStrikes.size);
                    hiT = nWalls > 1 ? (wallRank as number) / (nWalls - 1) : 0;
                  }
                  // Cull only degenerate radii. This used to be < 0.5, which
                  // silently dropped every bubble once the Min-size slider went
                  // sub-pixel — canvas antialiases arcs well below 1px, so let
                  // them draw and only skip effectively-invisible ones.
                  if (r < 0.12) continue;
                  // Opacity: smallest → minOpacity, largest → 1.0. Walls always full.
                  const opacity = isHi ? 1 : minOpacity + ratio * (1 - minOpacity);
                  // Sign sets hue (blue = +GEX, red = −GEX). Walls shift toward white
                  // and get a glow so they read as the dominant levels at a glance.
                  const base = v >= 0 ? [41, 182, 246] : [255, 71, 87];
                  const hot  = v >= 0 ? [200, 245, 255] : [255, 205, 210];
                  const col = isHi ? hot : base;
                  // Round mark, capped on both axes — see BUBBLE_ASPECT above.
                  const ry = Math.min(r, ryCap);
                  const rx = Math.min(r * BUBBLE_ASPECT, rxCap);
                  if (isHi) {
                    // Blitted, not blurred. The glow still tapers with rank, so
                    // the #1 wall is the brightest bloom on the chart — it's
                    // just baked into a sprite instead of re-blurred per bubble.
                    // Walls are always opacity 1, so the sprite is exact.
                    const sp = glowSprite(rx, ry, base, col, HIGHLIGHT_GLOW_TOP - (HIGHLIGHT_GLOW_TOP - HIGHLIGHT_GLOW_MIN) * hiT);
                    ctx.drawImage(sp.cv, x - sp.w / 2, y - sp.h / 2, sp.w, sp.h);
                  } else {
                    ctx.beginPath();
                    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${opacity})`;
                    ctx.fill();
                  }
                }
              }
              ctx.restore();
            }
          }
        }
      }

      // ── 2) Right-edge volume profile + value-area lines ──
      if (showProfile && profile.bins.length) {
        // Anchor bars at the plot-area's right edge — NOT the canvas edge — so
        // they never cover the price axis (the right price-scale gutter).
        let scaleW = 0;
        try { scaleW = chart.priceScale("right").width(); } catch {}
        const plotRight = Math.max(0, w - scaleW - 2);
        const maxProfW = Math.min(220, plotRight * 0.28);
        for (const b of profile.bins) {
          const yTop = series.priceToCoordinate(b.price + 1);
          const yBot = series.priceToCoordinate(b.price);
          if (yTop == null || yBot == null) continue;
          const top = Math.min(yTop, yBot);
          const bh = Math.max(1, Math.abs(yBot - yTop) - 0.5);
          const barW = (b.volume / (profile.maxVol || 1)) * maxProfW;
          const inVA = profile.val != null && profile.vah != null && b.price >= profile.val && b.price <= profile.vah;
          const isPoc = profile.poc != null && Math.abs(b.price - profile.poc) < 0.5;
          ctx.fillStyle = isPoc ? "rgba(245,197,24,.85)" : inVA ? "rgba(245,158,11,.55)" : "rgba(255,255,255,.30)";
          ctx.fillRect(plotRight - barW, top, barW, bh);
        }
        // Value-area level lines + labels.
        const lvl = (price: number | null, color: string, label: string) => {
          if (price == null) return;
          const y = series.priceToCoordinate(price);
          if (y == null) return;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.setLineDash(label === "LVN" ? [6, 4] : []);
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = color;
          ctx.font = "10px Inter, system-ui, sans-serif";
          ctx.fillText(label, 6, y - 3);
        };
        lvl(profile.vah, "rgba(255,255,255,.45)", "VAH");
        lvl(profile.poc, "rgba(245,197,24,.9)", "POC");
        lvl(profile.val, "rgba(255,255,255,.45)", "VAL");
        lvl(profile.lvn, "rgba(245,158,11,.9)", "LVN");
      }

      // ── 2b) TPO box profile — previous session + today, each anchored to its
      // own session's real x-range so the boxes sit under that day's candles.
      if (showTpo) {
        const drawTpoProfile = (tp: TpoProfile | null) => {
          if (!tp || !tp.bins.length || tp.startTs == null) return;
          const x0 = ts.timeToCoordinate((tp.startTs / 1000) as UTCTimestamp);
          if (x0 == null) return;
          const x1Raw = tp.endTs != null ? ts.timeToCoordinate((tp.endTs / 1000) as UTCTimestamp) : null;
          const x1 = x1Raw != null ? x1Raw : x0 + 120;
          const left = Math.min(x0, x1);
          const spanW = Math.max(20, Math.abs(x1 - x0));
          const maxCount = tp.maxCount || 1;
          const boxW = Math.min(1.75, Math.max(0.5, (spanW * 0.9) / maxCount));
          const boxGap = 0.5;

          for (const b of tp.bins) {
            const yTop = series.priceToCoordinate(b.price + 1);
            const yBot = series.priceToCoordinate(b.price);
            if (yTop == null || yBot == null) continue;
            const top = Math.min(yTop, yBot);
            const bh = Math.max(1, Math.abs(yBot - yTop) - 0.5);
            const inVA = tp.val != null && tp.vah != null && b.price >= tp.val && b.price <= tp.vah;
            if (inVA) {
              ctx.fillStyle = "rgba(255,255,255,0.05)";
              ctx.fillRect(left, top, spanW, bh);
            }
            const isPoc = tp.poc != null && Math.abs(b.price - tp.poc) < 0.5;
            ctx.fillStyle = isPoc ? "rgba(229,231,235,0.9)" : "rgba(156,163,175,0.65)";
            for (let i = 0; i < b.count; i++) {
              ctx.fillRect(left + i * (boxW + boxGap), top, boxW, bh);
            }
          }

          const lvlTpo = (price: number | null, color: string, label: string, dashed: boolean) => {
            if (price == null) return;
            const y = series.priceToCoordinate(price);
            if (y == null) return;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            if (dashed) ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + spanW, y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = color;
            ctx.font = "10px Inter, system-ui, sans-serif";
            ctx.fillText(label, left + spanW + 4, y + 3);
          };
          lvlTpo(tp.vah, "rgba(125,211,252,.7)", "VAH", true);
          lvlTpo(tp.poc, "rgba(251,191,36,.9)", "POC", false);
          lvlTpo(tp.val, "rgba(125,211,252,.7)", "VAL", true);
          lvlTpo(tp.mid, "rgba(248,113,113,.65)", "Mid", false);
        };
        for (const tp of tpoProfiles) drawTpoProfile(tp);
      }

      // ── 3) MVC history as horizontal step segments (no vertical connectors) ──
      // Each constant-value run draws as one flat line from its first timestamp
      // to the change point; when MVC jumps we lift the pen (small gap), then
      // start the next flat segment — so you never see the vertical move.
      if (showCb && mvcHistory.length) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.95)"; // MVC — thick white
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.setLineDash([]);
        const xOf = (t: number) => ts.timeToCoordinate((Math.floor(t / 1000)) as UTCTimestamp);
        let runStartX: number | null = null;
        let runY: number | null = null;
        let prevX: number | null = null;
        let prevKey: string | null = null;
        const flush = (endX: number | null) => {
          if (runStartX != null && runY != null && endX != null && endX > runStartX) {
            ctx.beginPath(); ctx.moveTo(runStartX, runY); ctx.lineTo(endX, runY); ctx.stroke();
          }
        };
        for (let i = 0; i < mvcHistory.length; i++) {
          const p = mvcHistory[i];
          // ── RTH ONLY ────────────────────────────────────────────────────
          // The CB is a cash-session read; there is no central band overnight.
          // Two separate things have to be fenced off, and doing only one of
          // them still leaves a white line stretched across the night:
          //
          //   1. Drop any snapshot stamped outside 09:30–16:00 ET. The writer
          //      is RTH-only today, but a stray row (a late auction print, a
          //      backfill) would otherwise anchor a run in the dark.
          //   2. A run may never BRIDGE two sessions. Runs are grouped by
          //      VALUE, so yesterday's 16:00 CB and today's 09:30 CB sitting
          //      on the same strike were one continuous run — drawn as a
          //      single flat line straight through the overnight, where no CB
          //      exists at all. An ET day change closes the run at yesterday's
          //      last point and starts a fresh one at today's open.
          const mins = etMinutes(p.ts);
          if (mins < RTH_OPEN_MIN || mins >= RTH_CLOSE_MIN) {
            flush(prevX);
            runStartX = null; runY = null; prevX = null; prevKey = null;
            continue;
          }
          const dayKey = etDayKey(p.ts);
          if (prevKey != null && dayKey !== prevKey) {
            flush(prevX);
            runStartX = null; runY = null; prevX = null;
          }
          prevKey = dayKey;
          const x = xOf(p.ts);
          // Convert the SPX CB level → ES with the basis THAT SNAPSHOT was taken
          // at: the row's own (esPrice − spxPrice), a simultaneous pair recorded
          // by the CB writer. Falls back to the per-session basisAt(ts) when a
          // row has no usable pair. The live basis is only right for "now" —
          // using it for prior days dragged every historical CB segment off its
          // true ES level, exactly as it did for the heatmap.
          // basisAt() — the SESSION basis, not this row's own reading. A per-row
          // basis (even the exact esPrice−spxPrice one) carries sampling noise,
          // and the CB is a STRIKE: it must render as flat steps, not a cloud of
          // dashes drifting with price.
          const y = series.priceToCoordinate(p.spx + basisAt(p.ts));
          if (x == null || y == null) { flush(prevX); runStartX = null; runY = null; prevX = null; continue; }
          if (runY == null) { runStartX = x; runY = y; }
          else if (Math.abs(y - runY) > 0.5) {
            // Value changed: close the previous flat run up to here, leave a gap,
            // start a fresh run at the new level.
            flush(x);
            runStartX = x; runY = y;
          }
          prevX = x;
        }
        // Extend the final run to the latest bar / right edge of data.
        flush(prevX);
        ctx.restore();
      }

      // ── 4) Flip Cross Pulse ─────────────────────────────────────────────
      // (a) Per-minute gamma flip, derived from the same columns the bubbles
      //     draw. This MUST use the app's canonical flip definition (see
      //     findGEXFlip in the shared calc): the per-strike net-GEX SIGN
      //     CROSSING, linearly interpolated between the two bracketing strikes,
      //     picking the crossing NEAREST SPOT when there are several.
      //
      //     The first version of this summed net GEX cumulatively from the
      //     lowest strike up and took where the running total crossed zero.
      //     That is a different quantity ("equal gamma above and below") and it
      //     printed 40–130 points ABOVE the real flip, because the cumulative
      //     sum has to claw back every negative strike below before it can turn
      //     positive. It is also window-dependent: this table stores a band of
      //     strikes around spot, so truncating the wings moves a cumulative
      //     crossing arbitrarily. A sign crossing is local and immune to both.
      //
      //     SPX strike space → ES via basisAt(), same as the bubbles / CB line.
      // (b) The flip path draws as a thin dotted amber line. Without it the
      //     rings look like they're floating; with it the cross is obvious.
      // (c) A cross = the bar-to-bar sign change of (close − flip). Blue ring +
      //     up arrow = into +GEX (dealers long gamma → pin / fade); red ring +
      //     down arrow = into −GEX (dealers short gamma → trend / chase).
      if (showFlipCross) {
        const metricFc = gexMetricRef.current;
        const valFc = (c: GexCell) => (metricFc === "vol" ? c.netVol : c.netOiVol);
        const flipPts: Array<{ ts: number; es: number }> = [];
        let prevPickSpx: number | null = null;
        for (const m of [...minuteColsRef.current.values()].sort((a, b) => a.slotTs - b.slotTs)) {
          if (replayTsRef.current != null && m.slotTs > replayTsRef.current) continue; // replay clamp
          // Server-computed flip wins when present — it was derived from every
          // strike, before ?top truncation dropped the small ones.
          const served = metricFc === "vol" ? m.flipVol : m.flip;
          if (served != null && Number.isFinite(served)) {
            prevPickSpx = served;
            flipPts.push({ ts: m.slotTs, es: served + basisAt(m.slotTs) });
            continue;
          }
          const cells = [...m.cells].sort((a, b) => a.strike - b.strike);
          if (cells.length < 3) continue;
          const crossings: number[] = [];
          for (let i = 0; i < cells.length - 1; i++) {
            const a = valFc(cells[i]);
            const b = valFc(cells[i + 1]);
            if (a === 0) { crossings.push(cells[i].strike); continue; }
            if (b === 0) { crossings.push(cells[i + 1].strike); continue; }
            if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
              const sA = cells[i].strike, sB = cells[i + 1].strike;
              const zero = sA + (sB - sA) * (Math.abs(a) / (Math.abs(a) + Math.abs(b)));
              if (Number.isFinite(zero)) crossings.push(Math.round(zero * 10) / 10);
            }
          }
          // No crossing = the whole loaded band is one sign (deep one-sided day,
          // or the wings got truncated). Skip rather than invent a level.
          if (!crossings.length) continue;
          // Reference for "nearest": this column's stored SPX spot — the same
          // argument the live flip is computed with. Legacy rows have no spot;
          // fall back to the last accepted flip so the series stays continuous
          // instead of snapping to the bottom crossing.
          const ref = m.spot && m.spot > 0 ? m.spot : prevPickSpx;
          const pick = ref == null
            ? crossings[0]
            : crossings.reduce((best, c) => (Math.abs(c - ref) < Math.abs(best - ref) ? c : best));
          prevPickSpx = pick;
          flipPts.push({ ts: m.slotTs, es: pick + basisAt(m.slotTs) });
        }

        if (flipPts.length >= 2) {
          // (The flipEsAt lookup that lived here — last reading at or before t,
          // held flat forward, never across a >30m gap — was only ever used by
          // the cross detection below, which is gone with the label. Restore it
          // from git if a cross marker comes back.)

          ctx.save();

          // (b) the flip path, drawn as a COMET: alpha ramps from faint at the
          //     open to full at the live bar, so the eye lands on where the flip
          //     IS instead of the line shouting across the whole session.
          //
          //     Stroke width is deliberately CONSTANT. A tapered comet reads as
          //     "this level matters more now than it did at 10am", which isn't
          //     what's being measured — only recency is. Age is carried by alpha
          //     alone. One stroke per segment is what buys the per-segment
          //     alpha; a single path can only hold one strokeStyle.
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.lineWidth = 1.3;
          let prevPt: { x: number; y: number } | null = null;
          let headPt: { x: number; y: number } | null = null;
          for (let i = 0; i < flipPts.length; i++) {
            const p = flipPts[i];
            const pxc = xAt(p.ts);
            const pyc = series.priceToCoordinate(p.es);
            if (pxc == null || pyc == null) { prevPt = null; continue; }
            const cur = { x: pxc, y: pyc as number };
            headPt = cur;
            if (prevPt) {
              const t = flipPts.length > 1 ? i / (flipPts.length - 1) : 1;
              ctx.strokeStyle = `rgba(251,133,1,${(0.1 + t * 0.78).toFixed(3)})`;
              ctx.beginPath();
              ctx.moveTo(prevPt.x, prevPt.y);
              ctx.lineTo(cur.x, cur.y);
              ctx.stroke();
            }
            prevPt = cur;
          }
          // Comet head — the newest reading that resolved on screen.
          if (headPt) {
            ctx.shadowColor = "rgba(251,133,1,1)";
            ctx.shadowBlur = 14;
            ctx.beginPath(); ctx.arc(headPt.x, headPt.y, 3.4, 0, Math.PI * 2);
            ctx.fillStyle = "rgb(251,133,1)"; ctx.fill();
            ctx.shadowBlur = 0;
            ctx.beginPath(); ctx.arc(headPt.x, headPt.y, 8, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(251,133,1,.35)";
            ctx.lineWidth = 1.2; ctx.stroke();
            ctx.lineWidth = 1.3;
          }

          // (c) crossings — DELIBERATELY UNMARKED.
          // Per-cross rings / dots / arrows went first: on a chop day the flip
          // gets crossed a dozen times and the chart filled with circles over
          // old bars, burying the candles and the bubbles for no read. The
          // "▼ INTO −GEX 7446" chip on the most recent cross went next — it sat
          // right on top of the candles at the one price area you're actually
          // reading, and it restated what the comet's position relative to price
          // already shows at a glance (plus the regime chip states it in text).
          // If a cross marker is ever wanted back, compute it from `flipPts` +
          // `rows` here; nothing else depends on it.

          ctx.restore();
        }
      }

      // (Greek-flow is now rendered as an HTML mini-chart, top-left of the chart

    };

    drawOverlayRef.current = draw;

    // Coalesce every repaint trigger through ONE rAF. The overlay reads the
    // live right-axis width (to stretch the last heatmap column to the edge);
    // during a tick the axis label width changes → plot width shifts → the time
    // scale fires a range-change → repaint → axis re-measures… The two range
    // subscriptions + the ResizeObserver were ping-ponging synchronously each
    // frame, which is the back-and-forth jitter. Draining them into a single
    // rAF lets the layout settle to a fixed point before we paint once.
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; draw(); railDrawRef.current(); });
    };

    const ts = chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange(schedule);
    const ro = new ResizeObserver(schedule);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    draw();

    // lightweight-charts doesn't expose a price-scale (Y-axis) range-change
    // event — dragging the right axis to expand/contract the chart vertically
    // only fires DOM pointer/wheel events, not subscribeVisibleLogicalRangeChange
    // (that's time-axis only). Without this, the GEX rail's bar thickness
    // (tied to on-screen strike spacing) would lag ~5s behind a live vertical
    // zoom/drag instead of tracking it in real time.
    //
    // DRAGS ONLY. This was a bare `schedule` on pointermove, so every mouse
    // movement over the chart — just moving the crosshair around while reading
    // it — repainted the ENTIRE overlay and the rail, at the pointer's event
    // rate. A hover changes nothing about the projection, so all of that work
    // was thrown away, and it is the main reason the page felt heavy to move
    // around in. `buttons !== 0` keeps the case this listener exists for
    // (dragging the price axis, which fires no range-change event) and drops
    // the rest; pointerup still catches the settled state.
    const container = chartRef.current;
    const onDragMove = (e: PointerEvent) => { if (e.buttons !== 0) schedule(); };
    container?.addEventListener("wheel", schedule, { passive: true });
    container?.addEventListener("pointermove", onDragMove);
    container?.addEventListener("pointerup", schedule);

    return () => {
      cancelAnimationFrame(raf);
      ts.unsubscribeVisibleLogicalRangeChange(schedule);
      ro.disconnect();
      container?.removeEventListener("wheel", schedule);
      container?.removeEventListener("pointermove", onDragMove);
      container?.removeEventListener("pointerup", schedule);
      drawOverlayRef.current = () => {};
    };
    // bb / weeklyEm are here because the Bollinger cloud and the EM boundaries
    // are painted on THIS canvas, so toggling either has to re-run the draw —
    // there is no series for React to update on their behalf.
  }, [showHeatmap, showGexBubbles, bubbleCfg, bubbleMins, intensity, gexMetric, rows, interval, showProfile, profile, showTpo, tpoProfiles, showLevels, showFlipCross, mvcHistory, showCb, bb, weeklyEm]);

  // Safety-net repaint: coalesced rAF tied to the time scale's visible-range
  // change AND a low-rate interval. Data events already call drawOverlayRef
  // directly, so this interval is just a backstop — bumped from 1s to 5s to
  // stop the 1Hz canvas churn that was burning CPU even when nothing changed.
  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    let raf = 0;
    const repaint = () => {
      // A hidden tab still fires the interval, and its rAF callbacks queue up to
      // run in one burst when the tab comes back. Three cards make that burst
      // three times the size, so skip the tick entirely while nothing is on
      // screen — the visibilitychange listener repaints once on return.
      if (typeof document !== "undefined" && document.hidden) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        drawOverlayRef.current();
        updateLiveSpxRef.current();
        railDrawRef.current();
      });
    };
    const tsApi = chart.timeScale();
    tsApi.subscribeVisibleTimeRangeChange(repaint);
    document.addEventListener("visibilitychange", repaint);
    const id = setInterval(repaint, 5_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
      document.removeEventListener("visibilitychange", repaint);
      tsApi.unsubscribeVisibleTimeRangeChange(repaint);
    };
  }, []);

  // ── Toolbar placement ──────────────────────────────────────────────────────
  // One dock, three possible homes:
  //   "full"   — in this card, as it has always been (single chart, home embed).
  //   "shared" — portaled into the PAGE's toolbar row, where it drives every
  //              chart in the row through the broadcast channel. The card keeps
  //              only its ticker.
  //   "symbol" — no dock at all; ticker only.
  //
  // A portal rather than lifting the controls into the page: they are wired to
  // this card's live feed state (the expirations list, the replay frame count,
  // the connection status), and re-deriving all of that a level up would mean
  // the page owning the websocket. The dock stays where its data is and simply
  // renders somewhere else. Its own dropdown menus already portal to
  // document.body off a getBoundingClientRect, so they follow it correctly.
  //
  // The dock STAYS in the Snap/Discord PNG (no data-capture-hide). It used to be
  // dropped, but dropping a direct child above the chart makes captureElement's
  // hiddenShift exceed the 44px title band, so the chart composited UP and the
  // candles rendered underneath the watermark. Kept in flow, the exported image
  // reads: watermark band → toolbar → chart. data-capture-hide is still applied
  // per-control below to the pieces that are meaningless in a static image
  // (the Snap/Discord buttons themselves).
  const dock = (
      // pt-2, and the page's mount point contributes NO padding of its own —
      // the two were stacking into ~24px of empty bar above the toolbar.
      <div className="px-4 pt-2 pb-1" style={{ position: "relative", zIndex: 30 }}>
        {/* min 0.7, not 0.2. The dock's natural width is ~1100–1300px; at a third
            of a 1440 screen a 0.2 floor renders ~3px glyphs, which is not a
            toolbar, it's a smudge. Compact density culls the dock's contents
            instead, and 0.7 is about where the remainder is still legible. */}
        <FitScale align={embedded || dockCompact ? "left" : "center"} min={dockCompact ? 0.7 : 0.2}>
        {/* fullWidth so the trailing group can be pushed to the right edge; a
            content-hugging dock has no right edge to push to. */}
        <Dock className="dock-noscroll" noScroll fullWidth style={{ minWidth: 0 }}>
          {leading}
          {leading && <DockGap />}
          {!dockCompact && (
          <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, lineHeight: 1.2 }}>
            {/* Just "Candles". The symbol and the timeframe are both live
                controls three inches to the right, so spelling them into the
                title was two more places to read the same two facts — and it
                made the one bar that IS the page's toolbar look like it belonged
                to one chart. */}
            <span className="font-bold uppercase tracking-[0.2em]" style={{ fontSize: 14, color: LIGHT_BLUE, whiteSpace: "nowrap" }}>
              Candles
            </span>
            {isEs ? (() => {
              // effectiveBasis() ONLY — never levels.basis. The server basis is
              // esFut-derived and freezes on the expired contract across a roll.
              const basis = effectiveBasis();
              return (
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)", color: HOME_THEME.muted, opacity: 0.75, whiteSpace: "nowrap" }}>
                  ES Basis {basis ? (basis > 0 ? "+" : "") + basis.toFixed(2) : "—"}
                </span>
              );
            })() : (
              // No basis line off ES: the strikes are already the chart's own
              // prices, so there is nothing to offset and nothing to report.
              <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)", color: HOME_THEME.muted, opacity: 0.75, whiteSpace: "nowrap" }}>
                {sym.gexSymbol} GEX
              </span>
            )}
          </div>
          )}

          {/* Charts / Replay / Indicators. Rendered by the PAGE (it owns chart
              count, the replay command and the indicator blob) but living in
              THIS bar, because two stacked toolbars for one chart is one toolbar
              too many. Only a dock-rendering card ever shows them, so the
              ticker-only cards in a shared row can't duplicate the set. */}
          {toolbarExtras}

          {/* Overlays checklist dropdown (was 6 inline tiles — overflowed the dock).
              Sits with the page's Charts / Replay / Indicators / Layout group, NOT
              down by the DTE picker where it used to live: it answers "what is
              drawn on this chart", same as Indicators, so it reads as part of that
              cluster rather than as another gamma setting. It stays a CARD control
              rather than moving into toolbarExtras because the page cannot own it —
              every toggle below is per-card state persisted into this slot's blob,
              so three cards in a row each carry their own overlay set. */}
          <div ref={ovlBoxRef} style={{ flexShrink: 0 }}>
            <DockButton onClick={openOvl} title="Chart overlays">
              <span>Overlays</span>
              {(() => {
                const n = [showHeatmap, showProfile, showTpo, showLevels, showSessions, showGexBubbles, showFlipCross].filter(Boolean).length;
                return n ? (
                  <span style={{ fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 999, background: DOCK_THEME.activeTile, border: `1px solid ${DOCK_THEME.activeBorder}`, color: HOME_THEME.cyan }}>{n}</span>
                ) : null;
              })()}
              <span style={{ opacity: 0.5, transform: ovlOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
            </DockButton>
          </div>
          {ovlOpen && ovlRect && createPortal(
            <div
              ref={ovlMenuRef}
              style={{
                position: "fixed", left: ovlRect.left, top: ovlRect.top,
                // Explicit width + border-box: `w-56` set a CONTENT width, so the
                // 6px padding pushed the real box to 236px while children sized
                // themselves to 224 — part of why content sat past the border.
                width: OVL_PANEL_W, maxWidth: `calc(100vw - ${OVL_VIEWPORT_PAD * 2}px)`,
                boxSizing: "border-box",
                // Scroll the body rather than overflow it on a short screen.
                maxHeight: ovlRect.maxH, overflowY: "auto", overflowX: "hidden",
                borderRadius: 14, border: `1px solid ${HOME_THEME.border}`, borderTop: `2px solid ${DOCK_THEME.cyanTop}`,
                background: DOCK_THEME.bg, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
                boxShadow: DOCK_THEME.shadow, zIndex: 100000, padding: 6,
              }}
            >
              {/* Two columns. Eight one-per-row toggles left the top half of this
                  menu mostly whitespace and pushed the sub-controls off-screen on
                  short viewports; the labels are all short enough to pair up. */}
              <div style={{
                // minmax(0,·) NOT 1fr: a plain `1fr` track carries an implicit
                // min-width:auto, so it refuses to shrink below the widest chip's
                // min-content and the grid overflows the panel instead. Renaming
                // PDH/ON -> PDH/ON+EM is what pushed it over on a laptop.
                display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 3, minWidth: 0,
              }}>
              {/* Each toggle persists into THIS card's slot blob, so three cards
                  can carry three different overlay sets across a reload. The
                  `!on` is computed here rather than inside a state updater so the
                  write happens once, not once per StrictMode double-invoke. */}
              {([
                { label: "Heatmap", on: showHeatmap, toggle: () => { setShowHeatmap(!showHeatmap); saveSetting({ ovHeatmap: !showHeatmap }); } },
                { label: "Profile", on: showProfile, toggle: () => { setShowProfile(!showProfile); saveSetting({ ovProfile: !showProfile }); } },
                { label: "TPO", on: showTpo, toggle: () => { setShowTpo(!showTpo); saveSetting({ ovTpo: !showTpo }); } },
                { label: "Levels", on: showLevels, toggle: () => { setShowLevels(!showLevels); saveSetting({ ovLevels: !showLevels }); } },
                { label: "PDH/ON+EM", on: showSessions, toggle: () => { setShowSessions(!showSessions); saveSetting({ ovSessions: !showSessions }); } },
                { label: "Bubbles", on: showGexBubbles, toggle: () => updateShowBubbles(!showGexBubbles) },
                { label: "Flip X", on: showFlipCross, toggle: () => { setShowFlipCross(!showFlipCross); saveSetting({ ovFlipCross: !showFlipCross }); } },
              ] as const).map((o) => (
                <PanelChip key={o.label} label={o.label} on={o.on} onClick={o.toggle} />
              ))}
              </div>

              {/* Sub-controls only make sense when their overlay is on.
                  SLIDER_LABEL_W is shared by every slider below so the labels,
                  tracks, values and steppers form real columns across sections
                  instead of each row sizing itself to its own label. */}
              {showHeatmap && (
                <div style={{ marginTop: 7, paddingTop: 8, borderTop: `1px solid ${HOME_THEME.border}` }}>
                  <PanelSection title="Heatmap range" first>
                    <SegGroup
                      options={[{ label: "1D", value: "1" }, { label: "2D", value: "2" }]}
                      active={String(heatmapDays)}
                      onChange={(v) => { const d = Number(v) === 2 ? 2 : 1; setHeatmapDays(d); saveSetting({ heatmapDays: d }); }}
                    />
                  </PanelSection>
                </div>
              )}
              {showGexBubbles && (
                <div style={{ marginTop: 7, paddingTop: 8, borderTop: `1px solid ${HOME_THEME.border}` }}>
                  <PanelSection title="Strikes shown" first>
                    <DockSlider
                      label="top" labelWidth={SLIDER_LABEL_W} width="auto"
                      value={bubbleCfg.topStrikes} min={1} max={30} step={1}
                      format={(v) => v.toFixed(0)} onChange={(v) => updateBubbleCfg({ topStrikes: Math.round(v) })}
                      title="Show Top Strikes — draw only the N strongest strikes (by |GEX|) per column"
                    />
                    <DockSlider
                      label="highlight" labelWidth={SLIDER_LABEL_W} width="auto"
                      value={bubbleCfg.highlight} min={0} max={bubbleCfg.topStrikes} step={1}
                      format={(v) => v.toFixed(0)} onChange={(v) => updateBubbleCfg({ highlight: Math.round(v) })}
                      title="Highlight Top N Walls — the strongest X of the shown strikes render larger, brighter, glowing (can't exceed Top)"
                    />
                  </PanelSection>

                  <PanelSection title="Bubble size">
                    <DockSlider
                      label="contrast" labelWidth={SLIDER_LABEL_W} width="auto"
                      value={bubbleCfg.minSize} min={BUBBLE_CFG_RANGE.minSize.min} max={BUBBLE_CFG_RANGE.minSize.max} step={0.01}
                      format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateBubbleCfg({ minSize: v })}
                      title="Contrast — the smallest strike's size as a PERCENTAGE of the largest. 5% = the weakest row is a twentieth of the wall; 50% = a flat-looking ladder. Max scales everything; this sets the spread between them"
                    />
                    <DockSlider
                      label="size" labelWidth={SLIDER_LABEL_W} width="auto"
                      value={bubbleCfg.maxSize} min={BUBBLE_CFG_RANGE.maxSize.min} max={BUBBLE_CFG_RANGE.maxSize.max} step={0.5}
                      format={(v) => v.toFixed(1)} onChange={(v) => updateBubbleCfg({ maxSize: v })}
                      title="Overall size (px) — the radius of the largest wall, and a straight multiplier on every other bubble. Drag it and the whole ladder scales together"
                    />
                    <DockSlider
                      label="max" labelWidth={SLIDER_LABEL_W} width="auto"
                      value={bubbleCfg.topBoost} min={BUBBLE_CFG_RANGE.topBoost.min} max={BUBBLE_CFG_RANGE.topBoost.max} step={0.05}
                      format={(v) => `${v.toFixed(2)}×`} onChange={(v) => updateBubbleCfg({ topBoost: v })}
                      title="Max — stretches only the top of the ladder, on top of Size. 1.00× is off. Weighted by the 4th power of the strike's rank ratio, so the peak gets the full factor, a mid strike gets ~6% of it, and the wings do not move at all"
                    />
                    <DockSlider
                      label="curve" labelWidth={SLIDER_LABEL_W} width="auto"
                      value={bubbleCfg.curve} min={BUBBLE_CFG_RANGE.curve.min} max={BUBBLE_CFG_RANGE.curve.max} step={0.1}
                      format={(v) => v.toFixed(1)} onChange={(v) => updateBubbleCfg({ curve: v })}
                      title="Size curve — exponent on |GEX|. 0.5 = √ (flat, every mid strike stays fat); 1 = linear; higher = exponential, so only the biggest GEX levels grow and everything else collapses to Min"
                    />
                    <DockSlider
                      label="bright" labelWidth={SLIDER_LABEL_W} width="auto"
                      value={bubbleCfg.brightness} min={0} max={100} step={1}
                      format={(v) => `${v.toFixed(0)}%`} onChange={(v) => updateBubbleCfg({ brightness: Math.round(v) })}
                      title="Brightness gradient — 0% = every strike full opacity; higher fades smaller strikes so walls dominate"
                    />
                  </PanelSection>

                  {/* "Bar" = one bubble column per candle, and it's the default:
                      a fixed 5m bucket stacks twelve columns inside a 1h candle
                      and merges them back into the solid rail the bucket exists
                      to prevent. 1m/5m stay for sub-bar detail on a 15m+ chart. */}
                  <PanelSection title="Bucket">
                    <SegGroup
                      options={[{ label: "Bar", value: "bar" }, { label: "1m", value: "1" }, { label: "5m", value: "5" }]}
                      active={String(bubbleMins)}
                      onChange={(v) => updateBubbleMins(v === "bar" ? "bar" : Number(v) === 1 ? 1 : 5)}
                    />
                  </PanelSection>

                  {/* CB (MVC) lives HERE, not under Levels. The top bubble — or
                      `highlight 1` — is already marking the MVC strike, so the CB
                      step line is the same read in line form; it belongs beside
                      the controls that decide what the bubbles emphasize. */}
                  <PanelSection title="Marker">
                    <PanelChip
                      label="CB line"
                      on={showCb}
                      onClick={() => updateShowCb(!showCb)}
                      title="Central Band (MVC) as a white step line. Same strike the top bubble marks — turn it off if the bubble is enough."
                    />
                  </PanelSection>

                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${HOME_THEME.border}` }}>
                    <button
                      onClick={saveBubbleDefault}
                      title="Pin the current sliders + bucket as your default. Survives a hard refresh; Reset comes back here."
                      style={{
                        flex: 1, fontSize: 9, letterSpacing: ".07em", textTransform: "uppercase",
                        padding: "4px 6px", borderRadius: 6, cursor: "pointer", fontWeight: 800,
                        border: `1px solid ${DOCK_THEME.activeBorder}`, background: DOCK_THEME.activeTile, color: HOME_THEME.cyan,
                      }}
                    >
                      Save default
                    </button>
                    <button
                      onClick={resetBubbleCfg}
                      title="Restore your saved default (or the factory values if you haven't saved one)"
                      style={{
                        flex: 1, fontSize: 9, letterSpacing: ".07em", textTransform: "uppercase",
                        padding: "4px 6px", borderRadius: 6, cursor: "pointer", fontWeight: 800,
                        border: `1px solid ${HOME_THEME.border}`, background: "transparent", color: HOME_THEME.muted,
                      }}
                    >
                      Reset
                    </button>
                    {/* Status moved onto its own line-end dot+word so the two
                        buttons can share the width evenly instead of being
                        squeezed by a variable-length label. */}
                    <span
                      title={defSavedFlash ? "Saved" : "Changes are saved automatically"}
                      style={{
                        flexShrink: 0, width: 7, height: 7, borderRadius: 99,
                        background: defSavedFlash ? "#1FD98A" : HOME_THEME.muted,
                        opacity: defSavedFlash ? 1 : 0.4, transition: "opacity .2s, background .2s",
                      }}
                    />
                  </div>
                </div>
              )}
            </div>,
            document.body
          )}

          {/* Symbol picker — ES / SPY / QQQ, favorites persisted per browser.
              Dropped from a SHARED dock: that toolbar drives every chart, and a
              ticker is the one setting that must not. Each card grows its own
              ticker bar instead (see tickerBar below). */}
          {dockMode === "full" && <SymbolListDropdown active={symbol} onSelect={setSymbol} />}

          {/* Timeframe. 1m is its own server stream; 5m is the native feed;
              15m/30m/1h roll up from the 5m bars client-side (see interval.ts).
              This is the ONE control that never moves into the overflow menu —
              it's the reason to have three charts in the first place. */}
          <SegGroup
            options={CHART_INTERVALS.map((i) => ({ label: INTERVAL_LABEL[i], value: String(i) }))}
            active={String(interval)}
            onChange={(v) => { const n = Number(v); if (isChartInterval(n)) setInterval_(n); }}
          />

          {/* status + count badges */}
          {!dockCompact && (
          <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,.08)", color: status === "live" ? "#30d158" : "#94a3b8", whiteSpace: "nowrap", flexShrink: 0 }}>
            {status.toUpperCase()}
          </span>
          )}
          {!dockCompact && (
          <span style={{ fontSize: 12, fontWeight: 600, padding: "5px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,.08)", color: "rgba(255,255,255,.7)", whiteSpace: "nowrap", flexShrink: 0 }}>
            {`${rows.length} candles`}
          </span>
          )}
          {/* The side panel is on but the card is too narrow for it. Says so,
              rather than letting a missing rail read as a broken one. */}
          {panelSuppressed && (
          <span title="Widen this card (or drop to fewer charts) to show the side panel"
                style={{ fontSize: 11, fontWeight: 700, padding: "4px 8px", borderRadius: 8, border: `1px solid ${HOME_THEME.border}`, color: HOME_THEME.muted, whiteSpace: "nowrap", flexShrink: 0 }}>
            panel hidden — narrow
          </span>
          )}

          {/* DTE dropdown */}
          <div ref={dteBoxRef} style={{ flexShrink: 0 }}>
            <DockButton onClick={openDte} title="Heatmap expiry / DTE">
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{selectedExpiry ? dayDateOf(selectedExpiry) : "Front"}</span>
              <span style={{ opacity: 0.5, transform: dteOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
            </DockButton>
          </div>
          {dteOpen && dteRect && createPortal(
            <div
              ref={dteMenuRef}
              className="max-h-72 w-48 overflow-y-auto py-1"
              style={{ position: "fixed", left: dteRect.left, top: dteRect.top, borderRadius: 14, border: `1px solid ${HOME_THEME.border}`, borderTop: `2px solid ${DOCK_THEME.cyanTop}`, background: DOCK_THEME.bg, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", boxShadow: DOCK_THEME.shadow, zIndex: 100000, padding: 6 }}
            >
              {[{ value: "", label: "Front (live)", sub: "" }, ...expirations.map((exp) => ({
                value: exp, label: dayDateOf(exp), sub: `${dteOf(exp)}DTE`,
              }))].map((opt) => {
                const active = selectedExpiry === opt.value;
                return (
                  <button
                    key={opt.value || "front"}
                    onClick={() => { setSelectedExpiry(opt.value); saveSetting({ expiry: opt.value }); setDteOpen(false); }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs"
                    style={{ borderRadius: 8, border: active ? `1px solid ${DOCK_THEME.activeBorder}` : "1px solid transparent", background: active ? DOCK_THEME.activeTile : "transparent", color: active ? HOME_THEME.cyan : HOME_THEME.text }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = DOCK_THEME.hoverTile; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span className="font-mono font-semibold">{opt.label}</span>
                    <span style={{ color: HOME_THEME.muted, opacity: 0.5 }}>{opt.sub}</span>
                  </button>
                );
              })}
            </div>,
            document.body
          )}


          <DockGap />

          {/* GEX metric */}
          <SegGroup
            options={[{ label: "Vol+OI", value: "voloi" }, { label: "Vol", value: "vol" }]}
            active={gexMetric}
            onChange={(v) => { setGexMetric(v as typeof gexMetric); saveSetting({ metric: v }); }}
          />

          {/* intensity slider */}
          <DockSlider
            label="intensity"
            value={intensity}
            min={0.1}
            max={1}
            step={0.05}
            onChange={(v) => { setIntensity(v); saveSetting({ intensity: v }); }}
            format={(v) => (v <= 0.1 ? "LEVELS" : v.toFixed(2))}
            valueWidth={46}
            title="Heatmap brightness. At the minimum stop the gamma wash switches off and only CB / CW / PW stay marked."
          />

          {/* The page's CANDLES toolbar hosts this button when there is one, so
              the card drops its own rather than offering two switches for one
              piece of state. The home embed has no page toolbar and keeps it. */}
          {!hostedReplay && (
            <DockButton
              onClick={() => { const nv = !replayOn; setReplayOn(nv); setReplayPlaying(false); if (nv) { setReplayIdx(0); setReplayDay(null); } }}
              title="Replay this session — reveal candles + gamma from the open forward"
              style={{ color: replayOn ? HOME_THEME.cyan : undefined }}
            >
              <span>Replay</span>
            </DockButton>
          )}

          {/* Refresh / Snap / Discord are ACTIONS, not settings — they belong at
              the far end, away from the controls you actually tune. */}
          <DockSpacer />
          <DockButton onClick={refreshTrigger} title="Refresh" style={{ color: refreshStyle.color as string }}>{refreshLabel}</DockButton>
          {/* The dock itself now stays in the capture, so the capture-triggering
              controls hide themselves — they'd be dead pixels in the PNG. Not
              direct children of captureRef, so they don't affect hiddenShift.
              Per-card by design: "snap THIS chart" is the useful gesture when
              three are on screen, and the label carries the symbol + timeframe
              so three PNGs are distinguishable. `hideCapture` exists for a host
              that supplies its own. */}
          {!hideCapture && (<>
            <span data-capture-hide><BoxSnapBtn targetRef={captureRef} label={`${sym.label} ${INTERVAL_LABEL[interval]} Candles`} /></span>
            <span data-capture-hide><BoxDiscordBtn targetRef={captureRef} label={`${sym.label} ${INTERVAL_LABEL[interval]} Candles`} /></span>
          </>)}
        </Dock>
        </FitScale>
      </div>
  );

  // Per-card ticker bar. Replaces the dock when the toolbar is shared — the
  // one control that stays per chart, so it has to stay ON the chart.
  // ── Replay transport ────────────────────────────────────────────────────────
  // Extracted from the body so it can follow the DOCK rather than the card. With
  // 2–3 charts up this used to render once per card: three day pickers, three
  // play buttons, three scrubbers, three speed switches, stacked down the row —
  // and worse, a follower's controls wrote only its own local state, so touching
  // the second chart's scrubber desynced it from the other two until the owner
  // happened to broadcast again. One transport, one owner, like the dock.
  const replayBar = replayOn ? (
    <div
      className={`es-candles-replay flex flex-wrap items-center gap-3 pt-2 pb-2${dockMode === "full" ? " px-4" : ""}`}
      style={{ borderBottom: `1px solid ${HOME_THEME.border}` }}
    >
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.cyan }}>Replay</span>
      {/* Day picker: step across the ET days in the rolling window so the
          previous session (e.g. Friday over the weekend) can be replayed. */}
      {(() => {
        const di = replayDays.indexOf(activeReplayDay);
        const fmtDay = (d: string) => {
          if (!d) return "—";
          const [y, m, day] = d.split("-").map(Number);
          return new Date(y, m - 1, day, 12).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
        };
        const go = (d: string) => { setReplayDay(d); setReplayPlaying(false); setReplayIdx(0); };
        // Remember the instant BEFORE the frames change; the effect above lands
        // it on the new grid once the memo has recomputed.
        const goSession = (v: "rth" | "eth") => {
          sessionSnapTsRef.current = replayTs;
          setReplayPlaying(false);
          setReplaySession(v);
        };
        return (
          <div className="flex items-center gap-1">
            <DockButton onClick={() => { if (di > 0) go(replayDays[di - 1]); }} title="Previous day"><span>◀</span></DockButton>
            <span style={{ fontSize: 12, fontWeight: 800, fontFamily: "var(--font-mono)", color: HOME_THEME.cyan, minWidth: 78, textAlign: "center", whiteSpace: "nowrap" }}>{fmtDay(activeReplayDay)}</span>
            <DockButton onClick={() => { if (di >= 0 && di < replayDays.length - 1) go(replayDays[di + 1]); }} title="Next day"><span>▶</span></DockButton>
            {/* Which slice of the day the cursor travels over. Sits with the day
                picker because it answers the same question — WHICH bars — while
                play/scrub/speed all answer HOW you move through them. */}
            <SegGroup
              options={[{ label: "RTH", value: "rth" }, { label: "ETH", value: "eth" }]}
              active={replaySession}
              onChange={(v) => goSession(v === "rth" ? "rth" : "eth")}
            />
          </div>
        );
      })()}
      {replayFrames.length === 0 ? (
        <span style={{ fontSize: 12, color: HOME_THEME.muted }}>
          {replaySession === "rth"
            ? "No RTH bars for this day — try ETH, or step ◀ / ▶ to another session."
            : "No bars for this day — step ◀ / ▶ to another session."}
        </span>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <DockButton onClick={() => { setReplayPlaying(false); setReplayIdx((i) => Math.max(0, i - 1)); }} title="Step back one bar"><span>⏮</span></DockButton>
            <DockButton
              onClick={() => { if (replayIdx >= replayFrames.length - 1) { setReplayIdx(0); setReplayPlaying(true); } else { setReplayPlaying((p) => !p); } }}
              title={replayPlaying ? "Pause" : "Play"}
            ><span style={{ minWidth: 12, display: "inline-block", textAlign: "center" }}>{replayPlaying ? "⏸" : "▶"}</span></DockButton>
            <DockButton onClick={() => { setReplayPlaying(false); setReplayIdx((i) => Math.min(replayFrames.length - 1, i + 1)); }} title="Step forward one bar"><span>⏭</span></DockButton>
          </div>
          <DockSlider
            label="bar"
            value={Math.min(replayIdx, replayFrames.length - 1)}
            min={0}
            max={Math.max(0, replayFrames.length - 1)}
            step={1}
            width={240}
            format={(v) => fmtEtHM(replayFrames[Math.min(Math.round(v), replayFrames.length - 1)])}
            onChange={(v) => { setReplayPlaying(false); setReplayIdx(Math.round(v)); }}
            title="Scrub through the session"
          />
          <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: HOME_THEME.muted, whiteSpace: "nowrap" }}>
            {fmtEtHM(replayFrames[Math.min(replayIdx, replayFrames.length - 1)])} · {Math.min(replayIdx, replayFrames.length - 1) + 1}/{replayFrames.length}
          </span>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: HOME_THEME.muted }}>Speed</span>
            <SegGroup
              options={[{ label: "1×", value: "1" }, { label: "2×", value: "2" }, { label: "4×", value: "4" }, { label: "8×", value: "8" }]}
              active={String(replaySpeed)}
              onChange={(v) => setReplaySpeed(Number(v))}
            />
          </div>
          <DockButton onClick={() => { setReplayPlaying(false); setReplayOn(false); setReplayDay(null); }} title="Exit replay — back to live" style={{ color: HOME_THEME.cyan }}><span>● Live</span></DockButton>
        </>
      )}
    </div>
  ) : null;

  /**
   * Call Wall / Put Wall / Flip / CB, on one line.
   *
   * These used to be a grid of four tiles on their own row under the chart, and
   * on a three-up layout that row was ~40px of chrome per card to show four
   * numbers — 120px of the viewport's height spent on twelve digits. They now
   * ride the ticker row, which was otherwise carrying a symbol dropdown and
   * nothing else.
   *
   * The timeframe and the basis that used to sit here are gone rather than
   * moved: the timeframe is a live control in the toolbar directly above, and
   * the basis is printed under the toolbar title. Both were being stated twice.
   */
  const statsLine = (() => {
    const basis = effectiveBasis();
    const es = (v: number | null) => (v != null ? (v + basis).toFixed(2) : "—");
    // Same source precedence as the rail and the price lines: on SPY/QQQ the
    // walls come from the recorded column, because `levels` is the SPX socket.
    // CB off ES is read straight off that column (see deriveColumnLevels).
    const stats = [
      { c: HOME_THEME.green, label: "Call Wall", short: "CW", v: etfGex ? etfGex.callWall : levels.callWall },
      { c: SOFT_RED, label: "Put Wall", short: "PW", v: etfGex ? etfGex.putWall : levels.putWall },
      { c: LIGHT_BLUE, label: "Flip", short: "Flip", v: etfGex ? etfGex.gexFlip : levels.gexFlip },
      { c: LIGHT_BLUE, label: "CB", short: "CB", v: isEs ? levels.mvc : (etfGex ? etfGex.cb : null) },
    ];
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        fontSize: 12, fontWeight: 800, fontFamily: "var(--font-mono)", minWidth: 0,
      }}>
        {stats.map((st) => (
          <span key={st.label} style={{ whiteSpace: "nowrap" }} title={st.label}>
            <span style={{ color: HOME_THEME.muted, opacity: 0.6, fontWeight: 700 }}>{st.short} </span>
            <span style={{ color: st.c }}>{es(st.v)}</span>
          </span>
        ))}
      </div>
    );
  })();

  // The ticker row doubles as the CARD HEADER on a multi-chart row (the page
  // wraps each column in a Card there). Tinted fill + a hairline under it, the
  // same header Multi Greek gives each ticker panel — without it the card is an
  // outline with a chart loose inside it, and the ticker reads as floating over
  // the candles rather than titling them. At one chart there is no card, so
  // there is nothing to be the header OF and it stays plain.
  const asCardHeader = dockMode !== "full" && !embedded;
  const tickerBar = (
    <div className="flex items-center gap-3 px-4 pt-1 pb-1" style={{
      position: "relative", zIndex: 30, minWidth: 0,
      ...(asCardHeader ? {
        background: "rgba(33,158,188,0.04)",
        borderBottom: `1px solid ${HOME_THEME.border}`,
        paddingTop: 5, paddingBottom: 5,
      } : null),
    }}>
      {leading}
      <SymbolListDropdown active={symbol} onSelect={setSymbol} />
      {statsLine}
      {panelSuppressed && (
        <span title="Widen this card (or drop to fewer charts) to show the side panel"
              style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 6, border: `1px solid ${HOME_THEME.border}`, color: HOME_THEME.muted, whiteSpace: "nowrap", flexShrink: 0 }}>
          panel hidden
        </span>
      )}
    </div>
  );

  return (
    <div ref={cardRef} className="es-candles-card flex h-full min-w-0 flex-col">
    {/* The shell background + glow are painted ONCE by the page. Three cards
        each painting their own would stack three radial glows across the row
        and show the seams between them. The home embed keeps its own, since
        there is no /es-candles page under it to provide one. */}
    <div ref={captureRef} className="es-candles-root flex h-full flex-col"
         style={embedded ? { background: HOME_THEME.bg, backgroundImage: HOME_THEME.shellGlow } : undefined}>
      {dockMode === "full" ? dock : tickerBar}
      {/* The dock hoists into the page's shared slot when there are 2–3 charts.
          dockMode "symbol" cards render neither dock nor transport; they follow
          the channel. */}
      {dockMode === "shared" && dockTarget ? createPortal(dock, dockTarget) : null}
      {/* ONE transport for the whole row, and it follows the page's Replay
          popover rather than the dock: that is where the button that opened it
          lives, and a transport that appears somewhere else on screen from the
          control that summoned it reads as two features. Only the replay OWNER
          renders it — the followers have identical state and would stack three
          identical scrubbers into the same node. */}
      {replayOwner && transportTarget ? createPortal(replayBar, transportTarget) : null}


      <div className="es-candles-body flex flex-col" style={{ flex: 1, minHeight: 0 }}>
      {/* Fallback home: the home embed, which has no page toolbar to portal
          into. On /es-candles `transportTarget` is always supplied (null only
          while the popover is shut), so this renders nothing there. */}
      {dockMode === "full" && !hostedReplay ? replayBar : null}
      {/* Levels now ride the instrument row (see statsLine). At one chart
          there is no ticker bar to put them in, so they get their own thin
          strip under the dock instead of the tile grid that used to live
          here — same four numbers, a fraction of the vertical cost. */}
      {dockMode === "full" && <div className="px-4 pb-1 pt-0">{statsLine}</div>}

      {/* Tight padding inside a card, generous without one. The page's Card
          already draws the edge and the inset; repeating a 16px gutter inside
          it is a frame around a frame, and at three columns it is ~96px of
          chart width spent on nothing. */}
      <div className={`es-candles-main flex flex-1 flex-row ${asCardHeader ? "px-2 pb-2 pt-2" : "px-4 pb-4"}`} style={{ minHeight: 0 }}>
       {/* ONE surface for the candles AND the panel beside them.
           They used to be two boxes with a gap between them: the chart carried
           the dissolve card, the rail sat outside it on the page background.
           But the rail is not a second widget — every one of its rows is drawn
           at the chart's own y for that price, so it is the chart's right
           margin, and a seam down the middle of one instrument reads as two
           panels that happen to line up. The surface moved out here and the gap
           went with it; the chart is now a transparent pane inside it.

           Inside a card the surface goes FLAT: the card is already the panel,
           and a feathered 28px-radius glass pane floating inside a 16px
           hairline box is two panels again, one of them fading out just short
           of the other's edge. */}
       <div className="es-candles-surface flex flex-1 flex-row overflow-hidden"
            style={asCardHeader ? { minWidth: 0, minHeight: 0 } : { ...dissolveCard, minWidth: 0, minHeight: 0 }}>
       <div className="es-candles-chartcol flex flex-1 flex-col" style={{ minWidth: 0 }}>
        {/* Price chart + price-aligned overlay (heatmap, volume profile, VA lines) */}
        <div className="es-candles-chart relative flex-1 overflow-hidden" style={{ minHeight: 320 }}>
          {/* Overlay (heatmap/profile/levels) sits BEHIND the chart so the
              candlesticks always render on the top visible layer. */}
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" style={{ zIndex: 1 }} />
          <div ref={chartRef} className="absolute inset-0" style={{ zIndex: 2 }} />
          {/* SPX equivalent of the live ES price, sitting on the spot line at the
              LEFT edge of the plot. It used to be pinned at right:64, which put
              it hard against the ES price label it is the counterpart to — two
              pills, two different numbers, touching. Same line, opposite end
              reads instantly and leaves the axis alone. (The crosshair badge
              below stays on the right, where the cursor's own axis readout is.)
              ES-only: off ES the basis is 0, so these would just restate the
              price already on the axis under a misleading "SPX" label. */}
          {isEs && liveSpx ? (
            <div
              className="pointer-events-none absolute z-10 rounded font-mono font-medium"
              style={{
                top: Math.max(2, liveSpx.y - 9),
                left: 6,
                background: "rgba(41,182,246,.92)",
                color: "#001018",
                whiteSpace: "nowrap",
                // Explicit font/line-height/padding instead of Tailwind's
                // text-[11px] + py-0.5. text-[11px] sets font-size ONLY, leaving
                // line-height inherited — html2canvas then resolves the text
                // baseline from that inherited value and the glyphs sit off-centre
                // in the pill in the Snap/Discord PNG (fine in the browser, which
                // centres the line box). Pinning both makes the box 18px tall
                // (12 + 3 + 3), matching the -9 half-height offset above.
                fontSize: 12,
                lineHeight: "12px",
                padding: "3px 6px",
              }}
            >
              SPX {liveSpx.spx.toFixed(2)}
            </div>
          ) : null}
          {/* RSI + bar countdown. Text in the corner rather than a pane: a pane
              costs a third of the chart's height to show a number you read as
              "high / low / middling", and this card already gives the bottom
              strip to volume. Right-aligned so the two stack cleanly and neither
              moves when the other's width changes. */}
          {(rsiValue != null || barCountdown) && (
            <div
              className="pointer-events-none absolute z-10 font-mono"
              style={{
                top: 6, right: 70, textAlign: "right",
                fontSize: 11, lineHeight: "14px", fontWeight: 800,
                textShadow: "0 1px 3px rgba(0,0,0,0.8)",
              }}
            >
              {rsiValue != null && (
                <div style={{
                  // Coloured by zone, not by value: 70/30 are the levels people
                  // actually read, and a continuous gradient makes 68 and 72
                  // look the same when they are the whole point.
                  color: rsiValue >= 70 ? SOFT_RED : rsiValue <= 30 ? HOME_THEME.green : HOME_THEME.muted,
                }}>
                  RSI {rsiValue.toFixed(1)}
                </div>
              )}
              {barCountdown && <div style={{ color: LIGHT_BLUE, opacity: 0.85 }}>{barCountdown}</div>}
            </div>
          )}
          {/* SPX at the crosshair, follows the cursor's y on the right gutter. */}
          {isEs && crossSpx ? (
            <div
              className="pointer-events-none absolute z-10 rounded font-mono"
              style={{
                top: Math.max(2, crossSpx.y - 9),
                right: 64,
                background: "rgba(255,255,255,.85)",
                color: "#001018",
                whiteSpace: "nowrap",
                // Same explicit metrics as the live badge above — see note there.
                fontSize: 12,
                lineHeight: "12px",
                padding: "3px 6px",
              }}
            >
              SPX {crossSpx.spx.toFixed(2)}
            </div>
          ) : null}
          {rows.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/50">
              {/* 1m is a SEPARATE server subscription gated by ES_1M_CANDLES, and
                  it genuinely cannot be derived from the 5m feed (dxLink
                  aggregates by the {=Nm} suffix). If it's off, the socket is
                  connected and healthy and no bars will ever arrive — saying
                  "Loading…" forever is a lie the user can't act on. */}
              {interval === 1 && isEs && connected
                ? "No 1-minute bars. The 1m stream is disabled on this server (ES_1M_CANDLES) — try 5m."
                : connected ? `Waiting for live ${INTERVAL_LABEL[interval]} ${sym.label} candles` : "Loading candles…"}
            </div>
          ) : null}
        </div>
       </div>

        {/* Page-level side panel: GEX rail or the 0DTE option chain. Suppressed
            when it would starve the candles — see panelSpec / railFits. */}
        {railFits ? (
          <SidePanel
            kind={sidePanel}
            width={panelW}
            chainSymbol={sym.chainSymbol}
            intensity={intensity}
            chainGreek={chainGreek}
            // Source precedence: replay cursor → ETF derived column → the live
            // SPX websocket. The first two are the same derivation applied to a
            // different column; the last is the only one /ws/gex can supply.
            chainReplay={chainReplay}
            railRows={replayGex ? replayGex.railRows : etfGex ? etfGex.railRows : railRows}
            callWall={replayGex ? replayGex.callWall : etfGex ? etfGex.callWall : levels.callWall}
            putWall={replayGex ? replayGex.putWall : etfGex ? etfGex.putWall : levels.putWall}
            gexFlip={replayGex ? replayGex.gexFlip : etfGex ? etfGex.gexFlip : levels.gexFlip}
            spot={etfGex ? etfGex.spot : levels.spx}
            // Steady basis, not effectiveBasis(): this prop is evaluated on
            // EVERY render, and `levels` gets a new identity on every /ws/gex
            // frame, so the raw (lastEsClose − spot) value re-projected the
            // rail's strikes onto a moving basis continuously. `spot` stays
            // live — that marker SHOULD tick; the strikes should not.
            basis={steadyBasisRef.current || effectiveBasis()}
            priceToY={priceToY}
            drawRef={railDrawRef}
          />
        ) : null}
       </div>

      </div>
      </div>
    </div>
    </div>
  );
}
