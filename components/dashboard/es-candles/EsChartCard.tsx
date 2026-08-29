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

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
//
// Two topic sets, chosen by whether the card is on ES.
//
// This used to be ONE module constant including "status" and "gex" for every
// card, whatever it was showing:
//
//   • "status" stays in BOTH sets. It looks droppable — onGexFrame branches on
//     snapshot | gex | GEX_UPDATE | spot | aux and never on "status" — but the
//     topic also governs what scopeSnapshot puts in the CONNECT snapshot, and
//     the expiry / expirations list rides on it. Dropping it emptied the DTE
//     picker on any layout with no ES card (union = spot,aux) and off-hours on
//     ES, where the snapshot can be the only frame that ever arrives.
//
//   • "gex" is the single heaviest frame on the feed (the whole per-strike
//     ladder). On a SPY/QQQ card `ingestLive` explicitly refuses it — /ws/gex is
//     an SPX feed — so it was being delivered across the wire, parsed, fanned
//     out to every subscriber, and thrown away. An ETF card asks for the scalar
//     legs only.
//
// (Both must be declared at module scope, and stay referentially stable: the
// value keys gexSocket's subscription effect.)
const ES_CHART_TOPICS = ["gex", "spot", "aux", "status"] as const;
const ETF_CHART_TOPICS = ["spot", "aux", "status"] as const;

/**
 * How long the live feed has to have been away before coming back is worth a
 * history refetch. Shared by the two paths that can lose it — hiding the tab and
 * the inactivity timeout — so they cannot drift apart. Under the threshold the
 * reconnect has cost at most one 1-minute column, and the next frame overwrites
 * that minute anyway; over it, re-pulling ~700KB beats a hole in the session.
 */
const WAKE_REFETCH_MS = 45_000;
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
import { Dock, SegGroup, DockButton, DockGap, DockSlider, DockCogMenu, DockField, type DockCogSection } from "@/components/shared/DockToolbar";
import FitScale from "@/components/shared/FitScale";
import { HOME_THEME, DOCK_THEME, LIGHT_BLUE, SOFT_RED, ES_CANDLE_UP, ES_CANDLE_DOWN, dissolveCardStyle } from "@/components/shared/homeTheme";
import type { RailRow } from "@/components/dashboard/EsGexRail";
import type { EsCandleRecord } from "@/lib/snapdb";

import {
  toChartTime, etDayKey, fmtEtHM, isPlausibleBasis, etMinutesOfDay, gexTodScale,
  isCashOpen, etSessionStarted, isEtWeekend, etMinutes, RTH_OPEN_MIN, RTH_CLOSE_MIN, buildVolumeProfile, TPO_PERIOD_MS, buildTpoProfile, SLOT_MS, slotFloorMs,
  SPOT_LINE_GRAY, EM_VIOLET, parseLevelNum, applyDefaultView,
  deriveColumnLevels, gexAlphaOf, gexPaint,
  type GexCell, type GexColumn, type GexMetric, type VolumeProfile, type TpoProfile,
} from "./chartMath";
import {
  CHART_INTERVALS, INTERVAL_LABEL, intervalMs, isChartInterval, nativeIntervalFor, rollupCandles,
  type ChartInterval,
} from "./interval";
import { SymbolListDropdown, symbolDef, candleSymbolOf, isChartSymbol, normalizeSymbol, type ChartSymbol } from "./symbols";
import { PanelSection, PanelChip, SLIDER_LABEL_W } from "./panelUi";
import {
  BUBBLE_STYLE, BUBBLE_REF_FLOOR_FRAC, BUBBLE_REF_START_MIN, BUBBLE_REF_CUTOFF_MIN,
  BUBBLE_LEVELS_RANGE, BUBBLE_INTENSITY_RANGE, BUBBLE_SIZE_RANGE, BUBBLE_CURVE_RANGE,
  BUBBLE_MIN_PER_SIDE, BUBBLE_BUCKET_DEFAULT,
  autoBubbleLevels, autoBubbleTopPx, autoBubbleCurve, autoBubbleIntensity,
  SHARED_SLOT,
  readSlot, writeSlot, writeSlotQuiet, broadcastSlot, subscribeSlot,
  isBubbleBucket, isAutoBucket,
  subscribeReplayCmd, broadcastReplayCmd, INDICATORS_DEFAULT,
  type BubbleBucket, type SlotId, type SlotBlob, type IndicatorCfg,
} from "./slotStore";
import { ema as emaOf, bollinger, rsi as rsiOf, fmtCountdown, EMA_COLORS, type BollingerBands } from "./indicators";
import SidePanel, { SIDE_PANEL_SPEC, type SidePanelKind } from "./SidePanel";
import type { ChainGreek } from "./ChainRail";

// Card/accent styling now sourced from the shared theme (see BUDGET_UI_STYLE.md).
const dissolveCard = dissolveCardStyle;

/**
 * Trim a slot-keyed column map down to `cap`, dropping the OLDEST slots.
 *
 * Replaces `map.delete(Math.min(...map.keys()))`, which spread up to 10,000
 * arguments onto the stack on every overflowing frame — O(n) work and close
 * enough to the engine's argument limit to be a real stack-overflow risk.
 *
 * Deliberately NOT `map.keys().next()`. Insertion order is not time order here:
 * the heatmap backfill merges its rows NEWEST-FIRST (it sorts descending so the
 * freshest snapshot in each bucket wins), so straight after a backfill the first
 * key is the most recent column — and evicting that would walk backwards through
 * the session deleting the newest history instead of trimming the left edge.
 *
 * One linear pass per overflow, no allocation, no spread. Overflow is rare (the
 * backfill's own cutoff keeps these maps well under their caps), so the cost is
 * irrelevant; correctness is not.
 */
function evictOldest(map: Map<number, GexColumn>, cap: number) {
  while (map.size > cap) {
    let oldest = Infinity;
    for (const k of map.keys()) if (k < oldest) oldest = k;
    if (!Number.isFinite(oldest)) break;
    map.delete(oldest);
  }
}

/**
 * useLayoutEffect on the client, useEffect on the server.
 *
 * React warns when useLayoutEffect runs during SSR (it can't — there is no
 * layout), so the standard isomorphic swap. Used for the settings restore,
 * where landing one commit earlier moves the page's heaviest fetch ahead of the
 * first paint.
 */
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Below this card width the dock switches to its compact density and the stat
 * row collapses to one line. Measured from the CARD, not from the card count:
 * one chart on a 1280 laptop is just as cramped as three on a 1920.
 */
const COMPACT_CARD_WIDTH = 760;

/**
 * How many strikes per column the gamma backfill asks for.
 *
 * Deliberately much larger than the "levels" control's ceiling (15). The layer
 * ranks strikes across the WHOLE session — that is what makes a wall render as
 * one continuous tube instead of a dotted line that appears and vanishes — and
 * a strike can only enter that ranking if it survived the server-side
 * truncation in at least one column. Asking for exactly the current levels
 * value would silently make the session ranking a per-column one.
 *
 * It is a CONSTANT, not derived from anything the user can change, because it
 * is part of the request URL: a value that moves re-fires a ~700KB backfill and
 * defeats dedupeFetch.
 */
const BUBBLE_LADDER_REQUEST = 30;

/**
 * How many SESSIONS of candles the chart holds.
 *
 * Sessions, not hours. This was a rolling `Date.now() - 48h` cutoff, which is a
 * different amount of history depending on when you looked: on a Monday
 * afternoon 48 hours lands on Saturday, so the chart held exactly ONE session
 * and there was nothing to scroll back to. The replay day picker is built from
 * the same array, so it could never offer a second day either.
 *
 * 5 is the practical ceiling on the ES side: `useEsCandles` clamps 1-minute
 * history to 5 days because dxFeed only serves about 7, and 5 sessions of 1m
 * ETH bars is ~7k rows — comfortably inside the route's 10k limit. The ETF
 * route clamps at 30 days, so it is the ES side that sets this number.
 */
const HISTORY_SESSIONS = 5;

/**
 * How many CALENDAR days to REQUEST to be sure of getting HISTORY_SESSIONS.
 *
 * These are two different numbers and conflating them is the whole reason
 * Friday kept going missing. Five sessions viewed from a Sunday reaches back to
 * the previous Monday — SEVEN calendar days — and a holiday makes it eight. So
 * the request window is generous and the SESSION trim below does the actual
 * bounding; asking for more days than needed costs a few rows the trim then
 * drops, while asking for too few silently returns a shorter chart on exactly
 * the days someone is most likely to be looking back.
 */
const HISTORY_FETCH_DAYS = 9;

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
  /**
   * Route-owned SECTIONS of the cog menu, merged with this card's own.
   *
   * `toolbarExtras` puts a row of the page's buttons in one place; this puts
   * whole panes of the page's controls in the rail — the Indicators sheet and
   * the Layout preset store, which the route owns because they are page state
   * (one indicator blob for the whole row, one preset store for the whole
   * page) and the card has no business re-deriving either. Order is decided by
   * the merge below, not by the caller.
   */
  pageSections?: DockCogSection[];
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

function EsChartCard({
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
  pageSections,
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
    // ── MIRROR into the other namespace ──────────────────────────────────────
    //
    // There are two blobs — the card's own slot and SHARED_SLOT — and the chart
    // count decides which one is read. Only ever writing to the active one made
    // them diverge the moment you used both layouts, and then whichever you
    // switched to served stale settings. Two directions, both real:
    //
    //   multi -> single  Everything set with 2-3 charts up went to SHARED, and
    //                    single-chart restore reads its own blob ONLY. Set your
    //                    overlays on a 3-up row, drop to one chart, and they are
    //                    gone. This is the one that reads as "the overlays don't
    //                    save".
    //   single -> multi  ensureSharedSeeded() copies slot 0 into SHARED exactly
    //                    ONCE, when SHARED does not exist yet. After that,
    //                    changes made in single-chart mode never reach SHARED,
    //                    but SHARED still WINS the merge on the way back up — so
    //                    going multi could resurrect settings from whenever that
    //                    seed happened to be taken.
    //
    // Mirroring every write keeps both blobs current, so it stops mattering
    // which one is read and the last thing you touched is always what you get.
    //
    // `symbol` is excluded by construction: it is written through writeSlot(slot)
    // directly and never goes through saveSetting, because the per-card ticker is
    // the whole point of a multi-chart row (ensureSharedSeeded deletes it from
    // the seed for the same reason).
    const mirror: SlotId = shared ? slot : SHARED_SLOT;
    // No broadcast for the mirror — subscribers listen on cfgSlot, and the write
    // above already notified them. This is a persistence backfill, not an event.
    writeSlotQuiet(mirror, patch);
  }, [cfgSlot, shared, slot]);

  // ── Active chart symbol ────────────────────────────────────────────────────
  const [symbol, setSymbolState] = useState<ChartSymbol>("ES");
  const setSymbol = useCallback((s: ChartSymbol) => {
    // Normalised at the door. The picker can now hand over a ticker somebody
    // typed, and "spy " and "SPY" must not become two different cards.
    const next = normalizeSymbol(s);
    if (!next) return;
    setSymbolState(next);
    // `slot`, never cfgSlot — the symbol is the one setting that stays per card
    // when the toolbar is shared. That is the whole point of three charts.
    writeSlot(slot, { symbol: next });
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

  // ── Session: which hours the chart plots ───────────────────────────────────
  /**
   *   eth — everything the feed has. ES trades nearly around the clock and the
   *         overnight is where the gap sets up, so this stays the default.
   *   rth — 09:30–16:00 ET only. The New York cash session.
   *
   * A FILTER on the plotted bars, applied at the last possible moment (`rows`
   * below) rather than at the source. That placement is the whole design:
   *
   *   • `rows5` stays whole, so the ES−SPX basis reconstruction — which walks
   *     the finest series it can find for a close at a given instant — never
   *     loses the overnight prints it needs to price a wall before the open.
   *   • The roll-up to 15m/30m/1h happens first and its buckets are anchored to
   *     09:30, so filtering after it cuts on real bucket boundaries. Filtering
   *     first would build the 09:30 bucket out of whatever survived and quietly
   *     mis-stamp every bar of the day.
   *   • Everything downstream reads `rows` — the candle series, EMAs, volume,
   *     the replay frame grid, the session levels — so one filter moves all of
   *     them and none of them needed to learn about sessions.
   *
   * Deliberately NOT lightweight-charts' own session support: there isn't any.
   * Its time scale plots the points it is given, so "hide the overnight" IS
   * "don't hand it the overnight bars", and the gap between 16:00 and the next
   * 09:30 closes by itself because the scale is index-based, not clock-based.
   *
   * Shares the rth/eth spelling with the replay transport's own session switch
   * and with the `session` param on the levels route, so the three cannot come
   * to mean different things.
   */
  const [chartSession, setChartSessionState] = useState<"rth" | "eth">("eth");
  const setChartSession = useCallback((v: "rth" | "eth") => {
    setChartSessionState(v);
    saveSetting({ session: v });
  }, [saveSetting]);

  // historyDays = HISTORY_SESSIONS, not the hook's default 20. The 20-day pull
  // was ~114KB / 250ms on every load to feed avg5/avg14 (which this page never
  // destructured) and the VSA baseline (since removed), so it stays trimmed —
  // but at 2 the chart could only ever show the current session and the replay
  // day picker had nothing to pick.
  // The hook DEFAULT stays 20 so RelVol / IB Logic keep their full baselines.
  //
  // nativeIntervalFor(), NOT `interval`: only 1 and 5 exist as server
  // aggregations, so 15m/30m/1h all request 5m and roll up below. That keeps the
  // hook's `intervalMinutes` dep stable across those three, which is what makes
  // switching between them free — no map wipe, no SQLite re-query, no refetch.
  const nativeInterval = nativeIntervalFor(interval);
  // enabled = isEs.
  //
  // This was hardcoded `true`, so a SPY or QQQ card still pulled today's + nine
  // days of ES candle history from the DB and still put `esCandles`/`es1mCandles`
  // on the shared socket's topic union — and then discarded all of it, because
  // `historical` and `rows5` both ignore the ES series when !isEs. On a three-up
  // ES/SPY/QQQ row that was two wasted loads and two wasted streams.
  //
  // withAverages = false: this page never reads `candles` (see the hook).
  const { sessionCandles: liveRows, historical: esHistorical, connected: esConnected, refresh: esRefresh } = useEsCandles(isEs, HISTORY_FETCH_DAYS, nativeInterval, false);
  // ETF bars come over HTTP from the etf_candles recorder, not /ws/gex. Passing
  // "" when ES is active keeps the hook completely idle — no fetch, no interval.
  //
  // candleSymbolOf, not gexSymbol: SPX's gamma is stored under '$SPX' and its
  // candles under 'SPX'. Every other symbol answers the same string to both.
  const { rows: etfRows, connected: etfConnected, refresh: etfRefresh } = useEtfCandles(isEs ? "" : candleSymbolOf(sym), HISTORY_FETCH_DAYS, nativeInterval);

  // History feed for the derived layers (prior-session levels, the ES basis
  // anchor). Both sides pull HISTORY_FETCH_DAYS calendar days and are trimmed
  // to HISTORY_SESSIONS below; the ETF array doubles as its "live" rows since
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
          // 30 min TTL, was 2.5 — see the note on the other /api/levels call.
          { ttlMs: 1_800_000, persist: true },
        );
        if (cancelled) return;
        const up = parseLevelNum(j?.up);
        const down = parseLevelNum(j?.down);
        // Bands are NULLed server-side by /api/levels/expire-stale once the week
        // they were struck for has passed, so "missing" is the correct signal to
        // draw nothing rather than to fall back to a stale band.
        // Identity-guarded: the poll re-fires every 5 min for a value that is
        // published WEEKLY, and it used to hand back a fresh object every time.
        const exp = String(j?.exp_label ?? "");
        setEmWeekly((prev) => {
          if (up == null || down == null) return prev === null ? prev : null;
          if (prev && prev.up === up && prev.down === down && prev.exp === exp) return prev;
          return { up, down, exp };
        });
      } catch (e) {
        // An HTTP error is the old `!r.ok` branch: the ticker has no row, so
        // clear the band. A network blip keeps the last good one.
        if (!cancelled && e instanceof HttpError) setEmWeekly(null);
      }
    };
    load();
    // 30 min, was 5.
    //
    // The band is published WEEKLY (levels-auto-publish.js, Fridays 16:00 ET).
    // A 5-minute poll meant ~2,000 identical responses per trading week per
    // card; this still picks up the Friday publish (and any mid-week
    // republish) well inside the hour, without a reload.
    const id = setInterval(load, 1_800_000);
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
    const map = new Map<string, EsCandleRecord>();
    for (const c of historical) if (c.slotKey) map.set(c.slotKey, c);
    // ETF rows have no second live stream to merge — `historical` already IS the
    // recorded series, refreshed on the hook's interval.
    if (isEs) for (const c of liveRows) if (c.slotKey) map.set(c.slotKey, c); // live wins
    const all = [...map.values()].sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey));
    // ── Trim by SESSION, not by wall clock ──────────────────────────────────
    // A `Date.now() - 48h` cutoff is a different amount of history depending on
    // when you look: 48 hours back from a Monday afternoon is Saturday, so the
    // chart held one session and there was nothing to scroll into. Counting
    // distinct ET days gives the same amount of chart every day of the week.
    //
    // Walked from the newest bar backwards, so the CURRENT session is always in
    // the set even if it has one bar in it.
    const keep = new Set<string>();
    for (let i = all.length - 1; i >= 0 && keep.size <= HISTORY_SESSIONS; i--) {
      const d = all[i].date;
      if (!d || keep.has(d)) continue;
      if (keep.size === HISTORY_SESSIONS) break;
      keep.add(d);
    }
    if (!keep.size) return all;
    // A bar with no date is kept rather than dropped — it cannot be placed in a
    // session, and dropping it would silently punch a hole in the series.
    return all.filter((c) => !c.date || keep.has(c.date));
  }, [historical, liveRows, isEs]);

  // Bars actually plotted. Identity-stable at 1m/5m (rollupCandles returns the
  // same reference), so the interval switcher costs nothing at the native sizes.
  //
  // No `cutoffMs` any more. It existed to drop the leading bucket that the old
  // rolling 48h cut left half-formed — with a session-boundary trim the oldest
  // bar IS a session start, so there is no partial bucket to drop and passing a
  // cutoff would just eat a real bar off the left edge.
  const rows = useMemo(() => {
    const base = interval <= 5 ? rows5 : rollupCandles(rows5, interval);
    if (chartSession !== "rth") return base;
    const rth = base.filter((r) => {
      const m = etMinutesOfDay(r.timestamp);
      return m >= RTH_OPEN_MIN && m < RTH_CLOSE_MIN;
    });
    // Fall back to the full series rather than to an empty chart. The only way
    // to filter everything away is a window that holds no cash-session bars at
    // all — a symbol whose recorder has only ever run overnight — and "no
    // candles" is a much worse answer to that than "here they are, unfiltered".
    return rth.length ? rth : base;
  }, [rows5, interval, chartSession]);
  /**
   * Content fingerprint of the plotted bars.
   *
   * `(length, last timestamp)` is NOT a sufficient key for this array, which is
   * exactly why the candle series carries its own `prefixSig`: `rows5` is a
   * slotKey merge in which the live socket copy overwrites the SQLite copy, and
   * rollupCandles rebuilds every bucket at 15m/30m/1h — either can revise a bar
   * in the MIDDLE of the array while the length and both end timestamps stay
   * equal.
   *
   * The per-session basis model reads bar closes (esCloseAt inside
   * buildBasisAt), and that model is now memoised and feeds the heatmap layer
   * cache, so it needs the same guarantee. FNV-1a over integers via Math.imul:
   * no allocation, ~7k iterations of integer arithmetic per rows change.
   */
  const rowsHash = useMemo(() => {
    let hval = 2166136261;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      hval = Math.imul(hval ^ (r.timestamp | 0), 16777619);
      hval = Math.imul(hval ^ Math.round(r.close * 100), 16777619);
      hval = Math.imul(hval ^ Math.round(r.high * 100), 16777619);
      hval = Math.imul(hval ^ Math.round(r.low * 100), 16777619);
    }
    return hval >>> 0;
  }, [rows]);
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
  // The rows the SERIES is currently showing — the replay slice while scrubbing,
  // the full history otherwise. applyDefaultView frames the cash session off
  // these, and it reads logical INDICES, so handing it rowsRef during a replay
  // would point the frame at the wrong candles.
  const viewRowsRef = useRef<Array<{ timestamp: number }>>([]);
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
  //
  // These are NOT React state.
  //
  // They were, and both allocated a fresh { y, spx } object every time they were
  // written — so React could never bail out. crossSpx was written from
  // subscribeCrosshairMove (i.e. at pointer-event rate, ~60Hz, just from moving
  // the mouse across the chart) and liveSpx from the visible-range subscription
  // (i.e. every frame of a pan). Each write re-rendered this entire 5,000-line
  // component and its children — rebuilding the dock's ~56 elements, the stats
  // line and the replay bar — to move two labels by a few pixels. That is what
  // made the crosshair feel heavy.
  //
  // Both badges are a single absolutely-positioned <div> with a `top` and a
  // string in it. Written directly, from the same rAF that paints the canvas.
  const liveSpxElRef = useRef<HTMLDivElement | null>(null);
  const crossSpxElRef = useRef<HTMLDivElement | null>(null);
  const paintBadge = useCallback((el: HTMLDivElement | null, v: { y: number; spx: number } | null) => {
    if (!el) return;
    if (!v || !Number.isFinite(v.y) || !Number.isFinite(v.spx)) {
      if (el.style.display !== "none") el.style.display = "none";
      return;
    }
    if (el.style.display !== "block") el.style.display = "block";
    const top = `${Math.round(Math.max(2, v.y - 9))}px`;
    if (el.style.top !== top) el.style.top = top;
    const txt = `SPX ${v.spx.toFixed(2)}`;
    if (el.textContent !== txt) el.textContent = txt;
  }, []);
  // Frozen prior-day closes (ES 16:00 − SPX 16:00) → prior-day basis source.
  const [prevCloses, setPrevCloses] = useState<{ es: number; spx: number; date: string } | null>(null);
  // Today's MVC history: raw SPX strikeOIVol per snapshot. Converted to ES at
  // DRAW time using the live ESU basis (same as the other levels), so the line
  // tracks the current /ESU price — not the stale per-row esPrice.
  const [mvcHistory, setMvcHistory] = useState<Array<{ ts: number; spx: number; spxPx: number; basis: number | null }>>([]);
  /**
   * Content fingerprint of the CB series, for the per-frame basis memo.
   *
   * The basis model is a function of every point in here — including `basis`,
   * which starts null and gets filled in for rows that already exist — so
   * keying the memo on (length, last ts) would keep serving a basis built from
   * incomplete rows. Memoised on the array identity, which setMvcHistory now
   * only changes when the content actually differs.
   */
  const mvcHistoryHash = useMemo(() => {
    let hval = 2166136261;
    for (let i = 0; i < mvcHistory.length; i++) {
      const p = mvcHistory[i];
      hval = Math.imul(hval ^ (p.ts | 0), 16777619);
      hval = Math.imul(hval ^ Math.round(p.spx * 100), 16777619);
      hval = Math.imul(hval ^ Math.round(p.spxPx * 100), 16777619);
      hval = Math.imul(hval ^ (p.basis == null ? 0x9e3779b1 : Math.round(p.basis * 100)), 16777619);
    }
    return hval >>> 0;
  }, [mvcHistory]);
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
  // Version of the HEATMAP column store (columnsRef), bumped at every write.
  //
  // Separate from minuteColsVerRef, which tracks the bubble minute map. The two
  // are written on different conditions: the live ingest path guards the minute
  // map on `liveDay === lastBubbleDayRef.current` but writes the heatmap column
  // unconditionally, so a column can land with no bump to minuteColsVerRef at
  // all. That happens every minute once the wall clock rolls past ET midnight
  // with the card still open, and all weekend.
  const columnsVerRef = useRef(0);
  // Memoised output of that derivation, keyed by the signature built in draw().
  // Memoised per-session basis resolver (see the note at its use site in draw()).
  const basisFnRef = useRef<{ sig: string; fn: (tsMs: number) => number } | null>(null);
  // Memoised flip-cross series — viewport-independent, was rebuilt every frame.
  const flipPtsRef = useRef<{ sig: string; pts: Array<{ ts: number; es: number }> } | null>(null);
  const bubblePrepRef = useRef<{
    sig: string;
    mins: GexColumn[];
    /** Session reference, TIME-OF-DAY DETRENDED. See the bubble draw. */
    sessRef: number;
    /** Expanding detrended reference as of each bucket, keyed by slotTs. */
    runRef: Map<number, number>;
    shownAt: Map<number, Set<number>>;
    wallAt: Map<number, Map<number, number>>;
    /**
     * Per-bucket cells to draw, already filtered to the shown strikes and sorted
     * biggest-first. Lives here rather than in draw() because it is a pure
     * function of (cells, shownAt, metric) — every one of which is already in
     * this memo's signature. In draw() it was a filter + a sort per bucket, per
     * frame: ~100k predicate calls and several hundred array allocations and
     * sorts on a full session.
     */
    orderAt: Map<number, GexCell[]>;
    /** gexTodScale() for each bucket, cached — it formats a Date to get ET. */
    todAt: Map<number, number>;
    strikeStep: number;
    /**
     * What AUTO decided from the board, for the frame to use. Both are read off
     * the NEWEST bucket — the live board — and then held for the whole trail:
     * re-deciding per bucket would make rows blink in and out and the curve
     * breathe as you scroll back through the session.
     *
     * `levels` is also what the selection above actually used, auto or not, so
     * the draw never has to ask which mode it is in to know the row count.
     */
    levels: number;
    autoCurve: number;
  } | null>(null);
  // Pre-rendered glow sprites for the highlighted walls. `ctx.shadowBlur` is a
  // per-fill gaussian blur — the single most expensive thing this overlay did,
  // paid once per wall bubble per column per frame. Rendering the blur ONCE per
  // (size, colour, blur) into an offscreen canvas and blitting it turns that
  // into a drawImage, which is effectively free.
  const glowSpriteRef = useRef<Map<string, { cv: HTMLCanvasElement; w: number; h: number }>>(new Map());
  // True while a pan/zoom gesture is in flight. Used to trade a little precision
  // for cache hits in the glow-sprite path, where a continuously-changing size
  // otherwise misses on every frame of a zoom.
  const interactingRef = useRef(false);
  const interactEndRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const bubbleMinsRef = useRef<BubbleBucket>(BUBBLE_BUCKET_DEFAULT);
  const bubbleLevelsRef = useRef(BUBBLE_STYLE.topStrikes);
  const bubbleIntensityRef = useRef(BUBBLE_STYLE.intensity);
  const bubbleSizeRef = useRef(BUBBLE_STYLE.size);
  // Explicit <number>: BUBBLE_CURVE_RANGE is `as const`, so `min` infers as the
  // literal 1 and the ref would refuse every other value.
  const bubbleCurveRef = useRef<number>(BUBBLE_CURVE_RANGE.min);
  // Replay cursor, mirrored for the imperative overlay draw (null = live).
  // Only the ENGAGED flag is mirrored: nothing imperative cares whether the
  // transport is merely open. (replayOnRef used to exist here and became dead
  // when the two flags were split.)
  const replayEngagedRef = useRef(false);
  const replayOnRef = useRef(false);
  // `hostedReplay` mirrored, so the []-dep exitReplay callback can read it
  // without taking it as a dependency.
  const hostedReplayRef = useRef(false);
  const replayTsRef = useRef<number | null>(null);
  // Imperative redraw hook set up by the overlay effect; apply() calls it when a
  // new gex snapshot lands so in-place column updates repaint immediately.
  const drawOverlayRef = useRef<() => void>(() => {});
  // ── The ONE paint scheduler ────────────────────────────────────────────────
  //
  // Every repaint request in this file goes through here. It used to be that a
  // correct rAF coalescer existed inside the overlay effect — and fifteen other
  // call sites called drawOverlayRef.current() SYNCHRONOUSLY around it. A burst
  // of websocket frames therefore meant a burst of full-viewport repaints,
  // several per animation frame, none of which could reach the screen.
  //
  // Worse, a SECOND independent rAF loop lived in the 5s backstop effect and was
  // subscribed to visible-time-range change while the overlay's was subscribed
  // to visible-LOGICAL-range change. Both fire on the same pan, and because they
  // held separate rAF handles they could not coalesce with each other — one drag
  // frame scheduled two full repaints plus an extra rail draw.
  //
  // One handle, one callback, one paint per frame. The rail and the SPX badge
  // ride along because both are functions of the same projection: if the chart
  // moved, all three are stale together.
  const paintRafRef = useRef(0);
  const schedulePaint = useCallback(() => {
    if (paintRafRef.current) return;
    paintRafRef.current = requestAnimationFrame(() => {
      paintRafRef.current = 0;
      drawOverlayRef.current();
      railDrawRef.current();
      updateLiveSpxRef.current();
    });
  }, []);
  useEffect(() => () => {
    if (paintRafRef.current) cancelAnimationFrame(paintRafRef.current);
    paintRafRef.current = 0;
  }, []);
  // Cached right price-axis gutter width (px). Updated only on >=1px change so
  // the heatmap's right edge doesn't shimmer with sub-pixel label wobble.
  const hmScaleWRef = useRef(0);
  // Offscreen heatmap buffer, reused across draws. Was allocated fresh inside
  // draw() on every frame — a full-viewport canvas per rAF during a pan/zoom,
  // which is pure allocation + GC churn. Resized only when the canvas size
  // actually changes; otherwise just cleared.
  // Shape of what the candle series currently holds, so a live tick can go
  // through series.update() (O(1)) instead of a full setData() re-ingest.
  const seriesShapeRef = useRef<{ len: number; firstTs: number; lastTs: number; prefixSig: number } | null>(null);
  const hmBufRef = useRef<HTMLCanvasElement | null>(null);
  // Finished heatmap LAYER (cells + blur + crisp pass already composited),
  // keyed by a fingerprint of everything that can change those pixels. A frame
  // where neither the data nor the projection moved blits this instead of
  // re-running the per-cell loop and, more importantly, the full-viewport
  // ctx.filter blur — which alone is 4-12ms on a large plot.
  const hmLayerRef = useRef<{ sig: string; cv: HTMLCanvasElement } | null>(null);
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
  // Bumped on every write to dayBasisRef, so the per-frame basis memo below
  // can tell that the daily-close table changed without diffing a Map.
  const dayBasisVerRef = useRef(0);
  // Throttle for the ?debugBasis=1 console dump (the overlay redraws on rAF).
  const basisDebugAtRef = useRef(0);
  // ?debugBasis=1, read ONCE. This was `new URLSearchParams(location.search)`
  // inside draw() — a fresh parse of the query string on every single
  // animation frame, just to test a flag that cannot change without a
  // navigation.
  const debugBasisRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { debugBasisRef.current = new URLSearchParams(window.location.search).get("debugBasis") === "1"; } catch {}
  }, []);
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
  // (The DTE dropdown's open/rect/outside-click state used to live here. The
  // expiry list is a pane in the cog's Gamma section now — no portal, no
  // placement maths, nothing to position.)

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

  // (The overlays checklist dropdown's open/rect/placement state used to live
  // here. The checklist is a pane in the cog's Overlays section now.)

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
  // The three bubble controls that survived the slider purge (see slotStore for
  // the question-vs-correction test that decides what belongs here).
  //   levels    — how many strikes draw per column, ranked session-wide.
  //   intensity — overall opacity of the layer against the candles.
  //   size      — multiplier on the size BUDGET, not on any single mark.
  // None of them changes what size MEANS: radius stays straight proportional to
  // |net GEX| against the session reference at every setting.
  const [bubbleLevels, setBubbleLevels] = useState(BUBBLE_STYLE.topStrikes);
  const [bubbleIntensity, setBubbleIntensity] = useState(BUBBLE_STYLE.intensity);
  const [bubbleSize, setBubbleSize] = useState(BUBBLE_STYLE.size);
  const [bubbleCurve, setBubbleCurve] = useState<number>(BUBBLE_CURVE_RANGE.min);
  // Bubble time bucket. Storage is always 1-min; this aggregates at DRAW time.
  // At 1m the bubbles sit a few px apart and overlap into solid rails, which is
  // the whole reason a bucket exists.
  //
  // "Auto" (one column per candle) is the default now that the timeframe is
  // switchable: a bubble's time IS its candle's time, so the trail re-formats
  // with the timeframe switcher instead of needing to be re-picked after it. A
  // fixed 5m bucket was right when every chart was 5m; on a 1h chart it stacks
  // twelve columns inside one candle and recreates exactly the solid rail it was
  // meant to prevent, and on a 1m chart it throws away four minutes in five. 1m
  // and 5m stay as manual overrides for sub-bar detail on a 15m+ chart.
  const [bubbleMins, setBubbleMins] = useState<BubbleBucket>(BUBBLE_BUCKET_DEFAULT);
  // ── Replay mode ──────────────────────────────────────────────────────────
  // Scrub / playback of the CURRENT ET session. Candles + the two time-series
  // gamma overlays (heatmap + bubbles) reveal only up to a moving cursor, so you
  // can watch price and gamma build from the open forward. The rail / TPO /
  // level lines stay live — a snapshot or a full-day profile, nothing to replay.
  const [replayOn, setReplayOn] = useState(false);
  /**
   * Has the user actually STARTED replaying, as distinct from having the
   * transport open?
   *
   * Opening the panel used to be the same event as clamping the chart: the
   * command handler set replayOn AND replayIdx=0, so a single click on Replay
   * threw the chart back to the first bar of the session. Worse, `replayOn`
   * keys the gamma backfill (it widens the window to 4 days and drops the
   * server-side ladder truncation), so pressing it re-fired a ~1.6MB request —
   * and pressing it again to undo fired a second one. An accidental click cost
   * a full reload of the page's heaviest data, twice.
   *
   * So the two are split. Opening the transport is inert: the chart stays live,
   * the cursor parks at the live edge, and nothing refetches. The chart is only
   * clamped once the user MOVES the slider, steps a bar, presses play, or picks
   * a different day/session — every one of which is an unambiguous "I want to
   * replay". Closing the panel disengages.
   */
  const [replayEngaged, setReplayEngaged] = useState(false);
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
  // NOT `replayOn` — see replayEngaged. This is the one value that clamps the
  // candles, the heatmap, the bubbles and the rail, so gating it here is what
  // makes an open-but-untouched transport a no-op everywhere at once.
  const replayTs = replayOn && replayEngaged && replayFrames.length
    ? replayFrames[Math.min(replayIdx, replayFrames.length - 1)]
    : null;
  /**
   * Where the transport's slider and readout sit.
   *
   * Before the user engages, that is the LIVE EDGE — the last bar — not bar 0.
   * A transport that opens parked at 09:30 while the chart shows the whole
   * session is lying about what you are looking at, and it makes the first drag
   * jump backwards through the entire day.
   */
  const replayViewIdx = replayFrames.length
    ? (replayEngaged ? Math.min(replayIdx, replayFrames.length - 1) : replayFrames.length - 1)
    : 0;
  /** Engage at `idx`, stop playback. Every control that means "replay this" calls it. */
  const engageReplayAt = useCallback((idx: number) => {
    setReplayEngaged(true);
    setReplayPlaying(false);
    setReplayIdx(Math.max(0, idx));
  }, []);
  /**
   * Back to live, completely.
   *
   * `replayDay` is reset HERE rather than on entry, which matters more than it
   * looks: `activeReplayDay` feeds the gamma backfill's shapeKey unconditionally
   * — in live mode too. Clearing it on entry meant that after replaying a past
   * session, merely RE-OPENING the transport flipped activeReplayDay back to
   * today, changed the key, wiped the column store and re-fired the whole
   * ~1.6MB backfill. Clearing on exit leaves the key stable across an open.
   */
  const exitReplay = useCallback(() => {
    setReplayPlaying(false);
    setReplayEngaged(false);
    setReplayOn(false);
    setReplayDay(null);
    // Tell the ROW, not just this card. On /es-candles the transport is
    // portaled into the page's Replay popover, so "● Live" pressed inside it
    // has to reach the page — otherwise the popover stays open over an empty
    // transport and the page's replayActiveRef still believes a replay is
    // running, which makes the next press of Replay a no-op. Our own
    // subscription re-applies the same values, which React bails on.
    if (hostedReplayRef.current) broadcastReplayCmd({ on: false });
  }, []);
  // Read by the channel subscriber, which is a []-dep useCallback and so cannot
  // close over the frames. Assigned during render, like replayGexRef below.
  const replayFramesRef = useRef<number[]>(replayFrames);
  replayFramesRef.current = replayFrames;
  // Last instant the channel named, kept so a follower can re-snap to it when
  // its OWN frames change. Without this, a card that loads its candles a beat
  // after the owner's last broadcast sits at bar 0 — invisible during playback
  // (the next tick corrects it) and stuck until you scrub while paused.
  const sharedRpTsRef = useRef<number | null>(null);
  useEffect(() => { replayEngagedRef.current = replayEngaged; }, [replayEngaged]);
  useEffect(() => { replayOnRef.current = replayOn; }, [replayOn]);
  /**
   * Tell the row when a hosted transport goes away with the card.
   *
   * The page's CardSlot renders a bare <div> at one chart and a <Card> at two
   * or three, so a 1<->multi switch changes the element TYPE at that position
   * and React unmounts and remounts this whole component — silently resetting
   * `replayOn` to false. The page's own replayActiveRef is not in that subtree
   * and stayed true, so its Replay button went on claiming a replay was running
   * after the replay had ceased to exist: pressing it re-opened an empty
   * transport and did nothing, and it took two more presses to recover.
   *
   * Broadcasting on the way out keeps the page (and any sibling card) honest
   * for every cause of a remount, not just the ones the page can predict.
   */
  useEffect(() => () => {
    if (hostedReplayRef.current && replayOnRef.current) broadcastReplayCmd({ on: false });
  }, []);
  useEffect(() => { hostedReplayRef.current = hostedReplay; }, [hostedReplay]);
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
  // MEMOISED, not "recomputed each render (cheap)" — it is not cheap.
  //
  // This is a linear scan of the whole column store, which is capped at 10,000
  // columns each holding a full strike array, followed by deriveColumnLevels
  // (two filters, two sorts and a findGEXFlip over that column). It sat in the
  // render body, so it re-ran on EVERY render of this component while replay was
  // on — including the 2-8Hz setReplayIdx playback loop and, before the badges
  // were moved out of React, every mouse move. Its own consumer `chainReplay`
  // is memoised on `[replayOn, replayGex, chainGreek]`, so that memo could never
  // hit either.
  //
  // minuteColsVerRef is bumped on every write to the column store, which is the
  // change signal the scan actually depends on.
  const columnStoreVer = minuteColsVerRef.current + columnsVerRef.current;
  const replayGex = useMemo(() => {
    if (!replayOn || replayTs == null) return null;
    void columnStoreVer;
    let col: GexColumn | null = null;
    for (const c of columnsRef.current.values()) {
      if (c.slotTs <= replayTs && (!col || c.slotTs > col.slotTs)) col = c;
    }
    // cbAware only off ES — see the flag's note in chartMath. On SPX the walls
    // being replayed came from the live feed, which ranks them plainly.
    return deriveColumnLevels(col, gexMetricRef.current, { cbAware: !isEs });
    // `gexMetric` is a dep even though the value is read through a ref: the ref
    // is what the imperative draws need, but this memo has to REBUILD when the
    // Vol+OI / Vol toggle moves. Without it, flipping the metric with replay
    // paused leaves the rail, both walls, the flip and the 0DTE ladder on the
    // old metric until the cursor moves.
  }, [replayOn, replayTs, isEs, columnStoreVer, gexMetric]);
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
      rpOn: replayOn, rpEngaged: replayEngaged, rpPlaying: replayPlaying, rpTs: replayTs,
      rpSpeed: replaySpeed, rpDay: replayDay, rpSession: replaySession,
    });
  }, [shared, replayOwner, cfgSlot, replayOn, replayEngaged, replayPlaying, replayTs, replaySpeed, replayDay, replaySession]);

  // ── Page-hosted Replay button ──────────────────────────────────────────────
  // The toolbar above owns the BUTTON; this card owns the STATE, because only it
  // knows how many bars the session has. Every card listens (not just the
  // transport owner) so a single command turns the whole row on and off at once
  // — the followers' own state has to flip too, or their candles never clamp.
  useEffect(() => subscribeReplayCmd(({ on }) => {
    setReplayOn(on);
    setReplayPlaying(false);
    // Entering is INERT. This used to rewind to the open (setReplayIdx(0)),
    // which is what made a stray click on Replay collapse the chart to the
    // first bar of the session. The cursor is parked at the live edge by
    // replayViewIdx instead, and nothing clamps until the user engages.
    setReplayEngaged(false);
    // replayDay is NOT cleared here — see exitReplay. Clearing it on entry is
    // what made re-opening the transport re-fire the gamma backfill.
    if (on) setReplayIdx(0);
    else setReplayDay(null);
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
  //
  // The tick does NOT go through React. It used to be
  // `setInterval(() => setCountdownNow(Date.now()), 1000)` feeding a useMemo,
  // which re-rendered this entire component once a second, forever, to update
  // one text node — and because `rows` was in the memo's deps it also invalidated
  // on every candle batch. The clock now writes its own <div>.
  const countdownElRef = useRef<HTMLDivElement | null>(null);
  const barCountdownOn = indicators.countdown && !replayEngaged;
  useEffect(() => {
    const el = countdownElRef.current;
    if (!el) return;
    if (!barCountdownOn) { el.textContent = ""; return; }
    const tick = () => {
      const node = countdownElRef.current;
      if (!node) return;
      const bars = rowsRef.current;
      if (!bars.length) { node.textContent = ""; return; }
      const last = bars[bars.length - 1].timestamp;
      const ms = candleMsRef.current;
      // Time to the END of the bar the clock is currently inside. Derived from
      // the last bar's open rather than from `now % candleMs`: 15m/30m/1h bars
      // are anchored to 09:30 ET and the close forces a short bar, so an
      // epoch-aligned modulo drifts against the actual grid by up to half a bar.
      const elapsed = Date.now() - last;
      if (elapsed < 0) { node.textContent = ""; return; }
      const txt = fmtCountdown(ms - (elapsed % ms));
      if (node.textContent !== txt) node.textContent = txt;
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [barCountdownOn]);

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
          // 30 min TTL, was 2.5. /api/levels is a WEEKLY publish; a 150s TTL
          // meant the two callers on this card (this one and the emWeekly effect
          // above) each re-opened a socket every few minutes for a value that
          // had not moved since Friday.
          { ttlMs: 1_800_000, persist: true },
        );
        if (cancelled || !json) return;
        const up = parseLevelNum(json.up);
        const down = parseLevelNum(json.down);
        // Both or neither. Half a band is worse than none — a single line with
        // no partner reads as a level someone deliberately drew.
        // Identity-guarded, like every other cached-poll setter on this card.
        if (up != null && down != null) {
          setWeeklyEm((prev) => (prev && prev.up === up && prev.down === down ? prev : { up, down }));
        }
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
  // a TDZ ReferenceError.
  //
  // Factored out because it runs from TWO places: the mount restore below, and
  // the shared-toolbar subscription. Both hand it the same shape — a full blob
  // on restore, a one-key patch on broadcast — and every field is guarded
  // individually, so a partial patch only moves what it names.
  //
  // `opts.initial` marks the MOUNT restore. It exists for exactly one key, the
  // expiry — see below.
  const applySettings = useCallback((p: SlotBlob, opts: { initial?: boolean } = {}) => {
    if (isChartInterval(p.interval)) setIntervalState(p.interval);
    // RTH/ETH. Rides the shared blob like the timeframe does, so on a 2–3 up row
    // the switch on the hoisted dock moves every chart — which is the point:
    // comparing ES against SPY across two different sets of hours is not a
    // comparison.
    if (p.session === "rth" || p.session === "eth") setChartSessionState(p.session);
    // ── THE DTE PICK IS NOT RESTORED. Every load starts on Front (live). ─────
    // Every other setting here is a preference — how the chart looks, what is
    // drawn on it — and should come back exactly as you left it. An expiry is
    // not a preference, it is a place you went to look at something, and it
    // goes stale on its own: pick 3DTE on a Thursday, come back Monday, and the
    // saved string is an expiration that has already traded. The chart then
    // opens on an empty ladder with no visible reason, because the control
    // reads "2026-08-15" and nothing about that says "this is over".
    //
    // So the mount restore skips it and the card opens on Front — which is what
    // "the front contract" means and is right on every session. Broadcasts
    // still carry it (opts.initial is only set by the mount restore), so moving
    // the DTE picker in a shared-toolbar row still moves all three charts.
    if (!opts.initial && typeof p.expiry === "string") setSelectedExpiry(p.expiry);
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

    // The seven bubble-slider keys are deliberately NOT read. An old blob still
    // carries them; the style is frozen now, so they are inert rather than a
    // hidden per-card override that would make two cards size differently.
    if (isBubbleBucket(p.mins)) setBubbleMins(p.mins);
    if (typeof p.bLevels === "number" && Number.isFinite(p.bLevels)) {
      setBubbleLevels(Math.round(Math.min(BUBBLE_LEVELS_RANGE.max, Math.max(BUBBLE_LEVELS_RANGE.min, p.bLevels))));
    }
    if (typeof p.bInt === "number" && Number.isFinite(p.bInt)) {
      setBubbleIntensity(Math.min(BUBBLE_INTENSITY_RANGE.max, Math.max(BUBBLE_INTENSITY_RANGE.min, p.bInt)));
    }
    if (typeof p.bSize === "number" && Number.isFinite(p.bSize)) {
      setBubbleSize(Math.min(BUBBLE_SIZE_RANGE.max, Math.max(BUBBLE_SIZE_RANGE.min, p.bSize)));
    }
    if (typeof p.bCurve === "number" && Number.isFinite(p.bCurve)) {
      setBubbleCurve(Math.min(BUBBLE_CURVE_RANGE.max, Math.max(BUBBLE_CURVE_RANGE.min, p.bCurve)));
    }
    if (typeof p.on === "boolean") setShowGexBubbles(p.on);
    if (typeof p.cb === "boolean") setShowCb(p.cb);

    // Replay rides the same channel but is BROADCAST-only, never persisted —
    // see the shared-toolbar subscription below.
    if (typeof p.rpOn === "boolean") setReplayOn(p.rpOn);
    if (typeof p.rpEngaged === "boolean") setReplayEngaged(p.rpEngaged);
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

  useIsoLayoutEffect(() => {
    const own = readSlot(slot);
    if (isChartSymbol(own.symbol)) setSymbolState(own.symbol);
    // ── OWN as the base, SHARED layered over it ──────────────────────────────
    // Not `cfgSlot === slot ? own : readSlot(cfgSlot)`. With 2–3 charts up the
    // settings namespace is SHARED_SLOT, and that blob only ever holds the keys
    // someone has touched WHILE in multi-chart mode. So a reload with two charts
    // read a blob with no overlay keys in it and every card came up on the
    // factory defaults — heatmap off, levels off — however carefully they had
    // been set on the single-chart view five minutes earlier. It read as "the
    // overlays don't stick", and it was worst for exactly the settings people
    // set once and expect to stay set.
    //
    // Merging fixes it without giving any key two owners: the shared blob still
    // WINS wherever it has an opinion (that is what "shared" means), and the
    // card's own remembered value only fills the gaps it is silent about. At one
    // chart cfgSlot IS slot, so the spread is a no-op and this is the old path.
    applySettings(cfgSlot === slot ? own : { ...own, ...readSlot(cfgSlot) }, { initial: true });
    setSettingsLoaded(true);
    // useLayoutEffect, not useEffect.
    //
    // Every page-global request on this card is gated on `settingsLoaded`
    // (correctly — their URLs are built from the restored symbol/expiry, and
    // firing them twice would double a ~1.6MB backfill). As a plain effect the
    // sequence was: render -> effects (all gated ones bail) -> PAINT -> this
    // setState -> render -> effects fire the requests. A layout effect flushes
    // before the paint, so the same setState lands in the same frame and the
    // heavy backfill starts a full paint earlier.
    //
    // Deliberately NOT a lazy useState initializer, which would be earlier
    // still: this route is also server-rendered by Next before the SPA takes
    // over, and reading localStorage during the first render is a hydration
    // mismatch. The isomorphic wrapper below keeps SSR on the plain effect.
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

  // The bucket and the Bubbles on/off both persist into the same slot blob, so
  // the panel comes back exactly as you left it.
  const updateBubbleMins = useCallback((m: BubbleBucket) => { setBubbleMins(m); saveSetting({ mins: m }); }, [saveSetting]);
  const updateShowBubbles = useCallback((on: boolean) => { setShowGexBubbles(on); saveSetting({ on }); }, [saveSetting]);
  // ("Save default" / "Reset" lived here. They pinned a slider setup into a
  // global key and restored it. With no sliders there is nothing to pin — the
  // one remaining preference in the panel, the bucket, already persists per slot
  // on every change.)
  //
  const updateBubbleLevels = useCallback((n: number) => {
    const v = Math.round(Math.min(BUBBLE_LEVELS_RANGE.max, Math.max(BUBBLE_LEVELS_RANGE.min, n)));
    setBubbleLevels(v);
    saveSetting({ bLevels: v });
  }, [saveSetting]);
  const updateBubbleIntensity = useCallback((n: number) => {
    const v = Math.min(BUBBLE_INTENSITY_RANGE.max, Math.max(BUBBLE_INTENSITY_RANGE.min, n));
    setBubbleIntensity(v);
    saveSetting({ bInt: v });
  }, [saveSetting]);
  const updateBubbleSize = useCallback((n: number) => {
    const v = Math.min(BUBBLE_SIZE_RANGE.max, Math.max(BUBBLE_SIZE_RANGE.min, n));
    setBubbleSize(v);
    saveSetting({ bSize: v });
  }, [saveSetting]);
  const updateBubbleCurve = useCallback((n: number) => {
    const v = Math.min(BUBBLE_CURVE_RANGE.max, Math.max(BUBBLE_CURVE_RANGE.min, n));
    setBubbleCurve(v);
    saveSetting({ bCurve: v });
  }, [saveSetting]);

  // ── Snap back to the forming candle ────────────────────────────────────────
  // Pan a few sessions left and there was no way back except double-clicking the
  // canvas — which is undiscoverable, and which does something DIFFERENT: it
  // re-frames the whole cash session at the default zoom. Two distinct wants:
  //
  //   "take me back to now"      → keep my zoom, scroll to the right edge.
  //   "reset the view"           → the session frame at the default zoom.
  //
  // This button is the first. `scrollToRealTime()` is lightweight-charts' own
  // call for it: it animates the time scale to the newest bar and leaves the bar
  // spacing alone, so a chart zoomed into 20 bars stays zoomed into 20 bars.
  // Double-click still does the second, unchanged.
  //
  // Falls back to the session frame if the call throws — some chart states (a
  // series with no data yet) reject it, and doing nothing on a click reads as a
  // dead button.
  const scrollToNow = useCallback(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    try {
      chart.timeScale().scrollToRealTime();
    } catch {
      applyDefaultView(chart, viewRowsRef.current, candleMsRef.current);
    }
    // The gamma overlays are painted on a canvas that tracks the time scale, so
    // they have to repaint at the new offset. SYNCHRONOUS on purpose, unlike
    // every other repaint request in this file: the visible-range subscription
    // would get there on its own, but a frame late, and on a chart this dense
    // that lands as a visible tear. This runs once per button press, so there is
    // nothing to coalesce.
    drawOverlayRef.current();
    railDrawRef.current();
  }, []);

  // ── Where the button LIVES ─────────────────────────────────────────────────
  //
  // It used to be a "Latest" row inside the dock's Chart menu — two clicks deep,
  // and permanently present whether or not you were anywhere near needing it.
  // TradingView solves the same problem the opposite way: nothing on screen
  // while the newest bar is in view, and the moment you pan it off the right
  // edge a small round jump-back control fades in over the bottom-right corner
  // of the plot, right where the pan gesture left your cursor.
  //
  // So the control is CONDITIONAL, and the condition is purely geometric: is the
  // last logical index inside the visible logical range? `getVisibleLogicalRange`
  // returns FRACTIONAL indices (the edges of the viewport rarely land on a bar
  // boundary), so the test carries a bar and a half of slack — without it, the
  // newest candle being half-clipped by the right axis gutter would flicker the
  // button in and out on every tick.
  //
  // React state, not an imperative style write like the price badges: this
  // mounts and unmounts a node rather than moving one, it changes at most once
  // per pan gesture, and a `setState` that early-returns on an unchanged value
  // costs nothing on the hundreds of range events that don't flip it.
  const [latestOffscreen, setLatestOffscreen] = useState(false);
  const checkLatestOffscreen = useCallback(() => {
    const chart = chartApiRef.current;
    const n = barCountRef.current;
    let off = false;
    if (chart && n > 0) {
      try {
        const r = chart.timeScale().getVisibleLogicalRange();
        off = r != null && r.to < n - 1.5;
      } catch { off = false; }
    }
    setLatestOffscreen((prev) => (prev === off ? prev : off));
  }, []);

  // Mirrored into refs so the imperative overlay draw reads them without
  // re-subscribing.
  useEffect(() => { bubbleMinsRef.current = bubbleMins; }, [bubbleMins]);
  useEffect(() => { bubbleLevelsRef.current = bubbleLevels; }, [bubbleLevels]);
  useEffect(() => { bubbleIntensityRef.current = bubbleIntensity; }, [bubbleIntensity]);
  useEffect(() => { bubbleSizeRef.current = bubbleSize; }, [bubbleSize]);
  useEffect(() => { bubbleCurveRef.current = bubbleCurve; }, [bubbleCurve]);
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
    // PERF: etDayKey, not a fresh Intl.DateTimeFormat per row. This is called
    // inside a loop over every candle (~7k at 1m/5d) and used to construct a
    // formatter each time.
    const dayKey = etDayKey;

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
    const dayKey = etDayKey; // PERF: see sessionLevels above.
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
        const next = {
          callWall: d.callWall != null ? Number(d.callWall) || null : prev.callWall,
          putWall:  d.putWall  != null ? Number(d.putWall)  || null : prev.putWall,
          gexFlip:  computedFlip != null ? computedFlip : prev.gexFlip,
          // CB is owned by the snapshot poll, not the live feed.
          mvc:      prev.mvc,
          basis:    nextBasis,
          spx:      nextSpx,
          esFut:    nextEs,
        };
        // Bail out when nothing actually moved.
        //
        // This updater unconditionally returned a new object literal, so EVERY
        // spot/aux/gex frame — several per second — gave `levels` a new identity
        // and re-rendered the whole card, whether or not a single field had
        // changed. Worse, `levels.esFut` and `levels.basis` are in the dep array
        // of the live-SPX effect, so each of those frames also tore down and
        // re-registered a time-scale subscription. (Same pattern already used
        // correctly by setLineLevels further down.)
        if (
          next.callWall === prev.callWall && next.putWall === prev.putWall &&
          next.gexFlip === prev.gexFlip && next.mvc === prev.mvc &&
          next.basis === prev.basis && next.spx === prev.spx && next.esFut === prev.esFut
        ) return prev;
        return next;
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
          // Identity-guarded: this built a brand-new array of EVERY strike on
          // every gex frame, which re-rendered the card (and the rail) even when
          // the ladder was byte-identical to the last one.
          setRailRows((prev) => {
            const nextRows = cells.map((c) => ({ strike: c.strike, net: metric === "vol" ? c.netVol : c.netOiVol }));
            if (prev.length === nextRows.length) {
              let same = true;
              for (let i = 0; i < nextRows.length; i++) {
                if (prev[i].strike !== nextRows[i].strike || prev[i].net !== nextRows[i].net) { same = false; break; }
              }
              if (same) return prev;
            }
            return nextRows;
          });
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
          if (replayEngagedRef.current || liveDay === lastBubbleDayRef.current) {
            mmap.set(minTs, { slotTs: minTs, cells, spot: spx > 0 ? spx : undefined });
            if (mmap.size > 2000) evictOldest(mmap, 2000);
            minuteColsVerRef.current++;
          }
          const map = columnsRef.current;
          columnsVerRef.current++;
          // Stamp the live column with the SPX spot from THIS frame so it ages
          // into history carrying its own basis, exactly like a DB-backfilled one.
          map.set(slotTs, { slotTs, cells, spot: spx > 0 ? spx : undefined });
          // Keep ~2 full days of 1-min slots (a 24h day = 1440 slots). The old
          // 200 cap chopped off the morning columns mid-session, making the
          // all-day heatmap vanish from the left.
          if (map.size > 10000) evictOldest(map, 10000);
          schedulePaint(); // repaint with the fresh/updated column
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
  useGexSocket(esShouldConnect, onGexFrame, undefined, isEs ? ES_CHART_TOPICS : ETF_CHART_TOPICS);

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

  // ── Reconnect refetch ──────────────────────────────────────────────────────
  // The wake refetch below heals a gap caused by HIDING the tab, because that is
  // the only transition it watches. It does not see the OTHER way the socket
  // goes away: `useWsLifecycle`'s inactivity timeout, which drops the feed on a
  // fully VISIBLE tab after 15 minutes of no mouse or keyboard. Walk away from a
  // chart you are streaming, come back, jiggle the mouse — the socket reconnects
  // and starts writing new minutes onto a `minuteColsRef` with an hours-long
  // hole in the middle of it.
  //
  // That hole is not just missing bubbles. Every bubble's radius is normalised
  // against the biggest |net GEX| the session has carried (see `bubblePrepRef`),
  // so a partial session is a wrong size reference, and every bubble on the
  // chart is drawn at the wrong size — which is what "the bubbles no longer
  // look good" is.
  //
  // So: watch the gate itself rather than one of the two things that move it,
  // and re-key the backfill when it comes back from a gap long enough to have
  // lost columns. Same 45s threshold and the same reasoning as the wake refetch.
  // Both can fire on the same visible-again tick; React batches the two updater
  // calls into one render, so that is one refetch, not two.
  const feedOffSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!esShouldConnect) {
      feedOffSinceRef.current = Date.now();
      return;
    }
    const since = feedOffSinceRef.current;
    feedOffSinceRef.current = null;
    // null on the first run — a fresh mount has nothing to heal.
    if (since == null || Date.now() - since < WAKE_REFETCH_MS) return;
    setGexPoll((n) => n + 1);
  }, [esShouldConnect]);

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

  // ── What "Front" actually resolves to ──────────────────────────────────────
  // The FIRST expiration in the feed's own list that has not traded yet, in ET.
  // Not `feedExpiry`, which is the string the server happens to be publishing
  // and is latched at the first frame this card sees (see applyGexFrame — the
  // latch is deliberate, it keeps a rolling value from churning the ~700KB
  // backfill URL). Latched is right for request stability and wrong for the
  // ROLL: sit on the page through Friday's close, or open it on a Sunday
  // evening after the Monday book has come up, and the latched string is an
  // expiration that has already traded. "Front" then quietly means "the last
  // one", the ladder is empty, and nothing on screen says why.
  //
  // `expirations` arrives on every gex frame and is re-set unconditionally, so
  // it is the one input here that cannot go stale. Taking the earliest entry
  // that is >= today ET means Front rolls the moment the new book is listed.
  //
  // Falls back to feedExpiry when the list is empty — the ETF/single-name cards
  // have no /ws/gex feed at all, and front mode does not need a real string
  // anyway (it sends anyExpiry=1; see queryExpiry below).
  const frontExpiry = useMemo(() => {
    if (!expirations.length) return feedExpiry;
    const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    let best = "";
    for (const e of expirations) {
      if (!e || e < todayEt) continue;
      if (!best || e < best) best = e;
    }
    return best || feedExpiry;
  }, [expirations, feedExpiry]);

  // Heatmap history backfill. Effective expiry = the DTE picker selection, or
  // the resolved front expiry when nothing is picked. Re-runs whenever the
  // picker OR the 1D/5D range toggle changes: clears the column map and reloads.
  //
  // Front mode sends `expiry=front` + anyExpiry=1 (see queryExpiry), and
  // shapeKey keys on the literal "front", so frontExpiry moving across the roll
  // cannot re-fire the backfill.
  const heatmapExpiry = selectedExpiry || frontExpiry;
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
    // replayEngaged, NOT replayOn: merely OPENING the transport must not change
    // the request key, or a stray click re-fires this ~1.6MB query and clicking
    // it again to undo fires a second one.
    const offSession = !replayEngaged && !etSessionStarted();
    const minutes = replayEngaged || offSession
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
    // The bubble trail draws only the N strongest strikes per column (the
    // "levels" control, 1–15). Pulling the WHOLE ladder for every
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
    const needsFullLadder = showHeatmap || replayEngaged; // see the note on `minutes`
    // Ask for a fixed, generous ladder rather than exactly the current "levels".
    // Two reasons. The draw filters down anyway, and asking for exactly N would
    // mean the SESSION-WIDE strike ranking (which is what makes a wall render as
    // one continuous tube) could only ever see strikes that were top-N in some
    // individual column. And the value is part of the request URL — a number that
    // moves with a slider re-fires a ~700KB backfill on every drag and defeats
    // dedupeFetch. 30 is comfortably above the levels ceiling of 15.
    const topStrikes = needsFullLadder ? 0 : BUBBLE_LADDER_REQUEST;
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
    const wallDayNow = replayEngaged && activeReplayDay ? activeReplayDay : etDayKey(Date.now());
    const shapeChanged = shapeKey !== lastHeatmapShapeRef.current;
    const dayChanged = wallDayNow !== lastWallDayRef.current;
    lastHeatmapShapeRef.current = shapeKey;
    lastWallDayRef.current = wallDayNow;
    if (shapeChanged) {
      columnsRef.current.clear();
      columnsVerRef.current++;
      minuteColsRef.current.clear();
      minuteColsVerRef.current++;
      schedulePaint();
    } else if (dayChanged) {
      minuteColsRef.current.clear();
      minuteColsVerRef.current++;
      schedulePaint();
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
        columnsVerRef.current++;
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
        const targetKey = replayEngaged && activeReplayDay
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
        schedulePaint();
      } catch (e) {
        // Live feed still populates the front expiry going forward, so this is
        // survivable — but it must not be invisible.
        console.warn("[gex-backfill] failed:", e);
      }
    })();
    // No cleanup cancel: a same-key re-render must not abort a valid in-flight
    // backfill; the resolution-time key check handles real invalidation.
    // showHeatmap / showFlipCross / isEs are deps because they feed `topStrikes`
    // above — turning the heatmap on has to re-request at full ladder resolution.
    // That lands as a shapeKey change, so the truncated columns get wiped rather
    // than merged into.
  }, [settingsLoaded, heatmapExpiry, heatmapDays, replayEngaged, activeReplayDay, selectedExpiry, sym.gexSymbol, gexPoll,
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
        // Identity-guarded on (length, last ts). The poll runs every 60s and
        // returns ~1000 rows of which at most ONE is new — but the array was
        // replaced wholesale each time, and `mvcHistory` is a dependency of the
        // big overlay draw effect, so every poll used to rebuild that effect.
        setMvcHistory((prev) => {
          if (prev.length !== pts.length) return pts;
          // Full content compare, not just the newest row: `basis` starts null
          // and is filled in by a later poll for the SAME ts/spx, and the
          // recorders do revise middle rows. A weaker key drops those silently,
          // and basisSig below is built from this array.
          for (let i = 0; i < pts.length; i++) {
            const a = prev[i], b = pts[i];
            if (a.ts !== b.ts || a.spx !== b.spx || a.spxPx !== b.spxPx || a.basis !== b.basis) return pts;
          }
          return prev;
        });
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
    const init = (): (() => void) | undefined => {
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
      // A fresh series holds nothing, so the tail-update fast path must not
      // believe the shape recorded against the OLD one.
      seriesShapeRef.current = null;
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
          __ltScreenshot?: () => { canvas: HTMLCanvasElement; target: HTMLElement; overlay?: HTMLCanvasElement | null } | null;
        }).__ltScreenshot = () => {
          try {
            const c = chartApiRef.current?.takeScreenshot();
            if (!c || !chartRef.current) return null;
            // overlayRef paints the heatmap / volume profile / GEX bubbles
            // BEHIND the chart (transparent chart background lets it show
            // through) — the chart-only corner-label capture composites it
            // the same way, or the bubbles are simply missing from the PNG.
            return { canvas: c, target: chartRef.current, overlay: overlayRef.current };
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
          applyDefaultView(chart, viewRowsRef.current, candleMsRef.current);
        }
        // The overlay canvas is sized from this same box, so a resize always
        // invalidates it. (This used to be a SECOND ResizeObserver created and
        // destroyed by the overlay effect — which had `rows` in its deps, so it
        // was being torn down and rebuilt several times a second, and
        // ro.observe() fires a synchronous callback on every construction.)
        schedulePaint();
      });
      ro.observe(container);
      lastW = Math.round(container.clientWidth);
      lastH = Math.round(container.clientHeight);
      chart.applyOptions({ width: lastW, height: lastH });

      // Double-click anywhere on the chart → recenter: back to the cash session
      // (not fit-all — that was the old behavior and it re-crushed the bubbles
      // every time you tried to undo a stray scroll) and snap both price scales
      // back to autoscale (right axis right).
      const onDblClick = () => {
        applyDefaultView(chart, viewRowsRef.current, candleMsRef.current);
        chart.priceScale("right").applyOptions({ autoScale: true });
        schedulePaint();
      };
      container.addEventListener("dblclick", onDblClick);

      // Crosshair SPX readout: convert the ES price under the cursor → SPX and
      // pin a label at that y. Cleared when the cursor leaves the chart.
      const onCrosshair = (param: { point?: { y: number }; seriesData?: Map<unknown, unknown> }) => {
        if (!param.point) { paintBadge(crossSpxElRef.current, null); return; }
        const es = candleSeries.coordinateToPrice(param.point.y);
        if (es == null) { paintBadge(crossSpxElRef.current, null); return; }
        paintBadge(crossSpxElRef.current, { y: param.point.y, spx: (es as number) - effectiveBasis() });
      };
      chart.subscribeCrosshairMove(onCrosshair);

      // ── Overlay repaint wiring ──────────────────────────────────────────
      //
      // These five subscriptions live HERE, with the chart, because their
      // lifetime is the chart's. They used to live in the overlay draw effect,
      // whose dep array contains `rows` / `profile` / `tpoProfiles` / `bb` —
      // all of which get a fresh identity on every candle batch. So four times
      // a second (twelve on a three-card row) this whole set was unsubscribed,
      // a ResizeObserver was disconnected and rebuilt, and three DOM listeners
      // were removed and re-added. That churn was the single largest React-side
      // cost on the page, and none of it produced a pixel.
      //
      // Nothing here needs to change when the data changes: they all just ask
      // for a repaint, and the repaint reads the latest closure out of
      // drawOverlayRef.
      const tsApi = chart.timeScale();
      tsApi.subscribeVisibleLogicalRangeChange(schedulePaint);
      // Same event drives the floating "Latest" button's visibility. Kept as its
      // own subscriber rather than folded into schedulePaint: schedulePaint is
      // rAF-coalesced canvas work, and this is a React state flip that must not
      // be skipped when a paint is dropped mid-gesture.
      tsApi.subscribeVisibleLogicalRangeChange(checkLatestOffscreen);

      // lightweight-charts doesn't expose a price-scale (Y-axis) range-change
      // event — dragging the right axis to expand/contract the chart vertically
      // only fires DOM pointer/wheel events, not subscribeVisibleLogicalRangeChange
      // (that's time-axis only). Without this, the GEX rail's bar thickness
      // (tied to on-screen strike spacing) would lag behind a live vertical
      // zoom/drag instead of tracking it.
      //
      // DRAGS ONLY. This was a bare `schedule` on pointermove, so every mouse
      // movement over the chart — just moving the crosshair around while reading
      // it — repainted the ENTIRE overlay and the rail at the pointer's event
      // rate. A hover changes nothing about the projection, so all of that work
      // was thrown away. `buttons !== 0` keeps the case this listener exists for
      // and drops the rest; pointerup still catches the settled state.
      // markInteracting: sets the gesture flag and schedules a settle. A trailing
      // repaint after the settle re-renders the frame at full precision (see the
      // glow-sprite quantisation note).
      const markInteracting = () => {
        interactingRef.current = true;
        if (interactEndRef.current) clearTimeout(interactEndRef.current);
        interactEndRef.current = setTimeout(() => {
          interactEndRef.current = null;
          interactingRef.current = false;
          schedulePaint();
        }, 180);
      };
      const onDragMove = (e: PointerEvent) => { if (e.buttons !== 0) { markInteracting(); schedulePaint(); } };
      const onWheel = () => { markInteracting(); schedulePaint(); };
      const onPointerUp = () => { markInteracting(); schedulePaint(); };
      container.addEventListener("wheel", onWheel, { passive: true });
      container.addEventListener("pointermove", onDragMove);
      container.addEventListener("pointerup", onPointerUp);

      return () => {
        ro.disconnect();
        if (interactEndRef.current) { clearTimeout(interactEndRef.current); interactEndRef.current = null; }
        interactingRef.current = false;
        chart.unsubscribeCrosshairMove(onCrosshair);
        tsApi.unsubscribeVisibleLogicalRangeChange(schedulePaint);
        tsApi.unsubscribeVisibleLogicalRangeChange(checkLatestOffscreen);
        container.removeEventListener("dblclick", onDblClick);
        container.removeEventListener("wheel", onWheel);
        container.removeEventListener("pointermove", onDragMove);
        container.removeEventListener("pointerup", onPointerUp);
      };
    };

    // NOT async.
    //
    // `init` was declared `async` and contained no `await`, so `cleanup = fn`
    // landed in a microtask while the returned cleanup runs synchronously. Under
    // StrictMode's double-mount the first cleanup therefore ran BEFORE the
    // assignment and silently did nothing — leaking the ResizeObserver, the
    // dblclick listener and the crosshair subscription, and leaving an orphaned
    // observer calling applyOptions() on a removed chart for the life of the page.
    const cleanup = init();

    return () => {
      canceled = true;
      cleanup?.();
      chartApiRef.current?.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
    };
  }, [schedulePaint, checkLatestOffscreen]);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const chart = chartApiRef.current;
    if (!candleSeries || !chart) return;

    // Replay: reveal only bars at/before the cursor (null = live, full history).
    const srcRows = replayTs != null ? rows.filter((r) => r.timestamp <= replayTs) : rows;

    // ── setData() vs update() ─────────────────────────────────────────────
    //
    // The overwhelmingly common case on a live tape is "same bars, last one's
    // close moved". This effect used to answer that by mapping all ~7,000 rows
    // into ~7,000 fresh objects and handing them to setData(), which makes
    // lightweight-charts re-ingest and re-index the ENTIRE series — several
    // times a second.
    //
    // series.update() takes one bar and is O(1). It is only valid when the bar
    // count and the leading timestamps are unchanged, so we track the previous
    // shape and fall back to setData() for anything else (interval switch,
    // symbol switch, history load, replay scrub, a new bar appearing).
    const lastRow = srcRows.length ? srcRows[srcRows.length - 1] : null;
    const prevShape = seriesShapeRef.current;
    // Hash of every bar EXCEPT the last, so "only the tail changed" is proven
    // rather than assumed. (len, firstTs, lastTs) is not enough: `rows5` is a
    // slotKey merge in which the live socket copy overwrites the SQLite copy,
    // and rollupCandles rebuilds every bucket at 15m/30m/1h — either can revise
    // a bar in the middle of the array while all three anchors stay equal, and
    // update() would then discard that correction permanently.
    //
    // FNV-1a over integers via Math.imul: no allocation, no string building,
    // ~7k iterations of integer arithmetic. Cheap next to allocating 7k objects
    // and making lightweight-charts re-index the whole series.
    const prefixSig = (() => {
      let hval = 2166136261;
      for (let i = 0; i < srcRows.length - 1; i++) {
        const r = srcRows[i];
        hval = Math.imul(hval ^ (r.timestamp | 0), 16777619);
        hval = Math.imul(hval ^ Math.round(r.open * 100), 16777619);
        hval = Math.imul(hval ^ Math.round(r.high * 100), 16777619);
        hval = Math.imul(hval ^ Math.round(r.low * 100), 16777619);
        hval = Math.imul(hval ^ Math.round(r.close * 100), 16777619);
        hval = Math.imul(hval ^ (r.volume | 0), 16777619);
      }
      return hval >>> 0;
    })();
    const canUpdateTail =
      prevShape != null &&
      lastRow != null &&
      prevShape.len === srcRows.length &&
      prevShape.firstTs === srcRows[0].timestamp &&
      prevShape.lastTs === lastRow.timestamp &&
      prevShape.prefixSig === prefixSig;

    if (canUpdateTail) {
      candleSeries.update({
        time: toChartTime(lastRow!.timestamp),
        open: lastRow!.open,
        high: lastRow!.high,
        low: lastRow!.low,
        close: lastRow!.close,
      });
    } else {
      const candleData: CandlestickData[] = srcRows.map((row) => ({
        time: toChartTime(row.timestamp),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
      }));
      candleSeries.setData(candleData);
    }
    seriesShapeRef.current = lastRow
      ? { len: srcRows.length, firstTs: srcRows[0].timestamp, lastTs: lastRow.timestamp, prefixSig }
      : null;
    // Track the price band the candles actually occupy so the heatmap can fade
    // by distance from it.
    if (srcRows.length) {
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
    const lastDay = srcRows.length ? rows[rows.length - 1].date : "";
    barCountRef.current = srcRows.length;
    viewRowsRef.current = srcRows;
    if (srcRows.length && (!didFitRef.current || lastDay !== lastFitDayRef.current)) {
      applyDefaultView(chart, srcRows, candleMsRef.current);
      didFitRef.current = true;
      lastFitDayRef.current = lastDay;
    }
    schedulePaint();
    // …and for the same reason, re-test the live edge here. A new bar appended
    // while the user is parked in history extends the series without moving the
    // viewport, so the last index can cross out of range with no range event to
    // announce it — the button has to appear on the data change itself.
    checkLatestOffscreen();
    // Live candle updates shift the time axis without always firing a logical-
    // range change, which could leave the heatmap overlay painting a stale or
    // cleared frame. Repaint whenever candle data changes.
  }, [rows, replayTs, checkLatestOffscreen]);

  // Live SPX badge: last ES close → SPX, pinned at its y-coordinate on the
  // right gutter. Recomputed on data, basis, and pan/zoom (range subscribe).
  const updateLiveSpxRef = useRef<() => void>(() => {});
  useEffect(() => {
    updateLiveSpxRef.current = () => {
      const series = candleSeriesRef.current;
      // Follow the replay cursor when active so the badge isn't a lookahead.
      const src = replayTsRef.current != null ? rows.filter((r) => r.timestamp <= replayTsRef.current!) : rows;
      if (!series || !src.length) { paintBadge(liveSpxElRef.current, null); return; }
      const lastEs = src[src.length - 1].close;
      const y = series.priceToCoordinate(lastEs);
      if (y == null) { paintBadge(liveSpxElRef.current, null); return; }
      paintBadge(liveSpxElRef.current, { y, spx: lastEs - effectiveBasis() });
    };
    updateLiveSpxRef.current();
    // No range subscription here any more.
    //
    // schedulePaint() calls updateLiveSpxRef on every paint, and every pan/zoom
    // produces a paint — so this effect's own
    // subscribeVisibleLogicalRangeChange was a third subscriber to the same
    // event doing the same work. It was also re-registered whenever
    // `levels.esFut` moved a tick, which (before setLevels was identity-guarded)
    // was several times a second.
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
            if (next.size) { dayBasisRef.current = next; dayBasisVerRef.current++; }
          }
          schedulePaint();
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
  // PREFETCH: warm the eod-gex cache entry the moment the card mounts.
  //
  // `compute` below can't run until `historical` has loaded, because it derives
  // the ES date from the candles — so this request was strictly serialized
  // behind the candle round-trip even though it needs nothing from it (the date
  // match falls back to spxRows[0]). Firing it here overlaps the two; `compute`
  // then hits the cachedJson entry instead of opening a socket.
  useEffect(() => {
    if (!isEs) return;
    void cachedJson<{ rows?: unknown }>(
      `/api/eod-gex?symbol=$SPX&limit=30`,
      { ttlMs: 600_000, persist: true },
    ).catch(() => {});
  }, [isEs]);

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
            // Identity-guarded: polled every 5 min for a value that changes once
            // a day at the close.
            setPrevCloses((prev) =>
              prev && prev.es === esClose && prev.spx === spxClose && prev.date === esDate
                ? prev
                : { es: esClose, spx: spxClose, date: esDate });
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
            dayBasisRef.current = next; dayBasisVerRef.current++;
            schedulePaint(); // repaint with the corrected historical basis
          }
        }
      } catch { /* keep last frozen basis */ }
    };
    void compute();
    // 30 min, was 5. These are prior-day CLOSES: they change exactly once a day,
    // at 16:00 ET. A 5-minute poll was 78 requests a day per card to observe one
    // change, and every one of them re-ran the whole per-day basis rebuild.
    const id = setInterval(compute, 1_800_000);
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
  // Declared HERE, below the state it touches.
  const prevSymbolRef = useRef(symbol);
  useEffect(() => {
    if (prevSymbolRef.current === symbol) return;
    prevSymbolRef.current = symbol;
    columnsRef.current.clear();
    columnsVerRef.current++;
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
    applyDefaultView(chartApiRef.current, viewRowsRef.current, candleMsRef.current);
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
    paintBadge(liveSpxElRef.current, null);
    paintBadge(crossSpxElRef.current, null);
    seriesShapeRef.current = null; // force a full setData on the new symbol
    // The ES-only basis sources are NOT cleared by their own gated effects (they
    // simply stop refreshing), so a switch would leave the previous symbol's
    // ~50pt ES−SPX carry sitting in these refs — and buildBasisAt's
    // "abs(b) >= 1 wins" rule actively PREFERS that stale value over 0 for every
    // prior-day column. Wipe them with the columns they belong to.
    dayBasisRef.current = new Map(); dayBasisVerRef.current++;
    prevBasisRef.current = 0;
    trustedBasisRef.current = 0;
    basisRef.current = 0;
    setPrevCloses(null);
    setGexVersion((v) => v + 1);
    schedulePaint();
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
    // candleMs is derived from `interval`, and this effect runs on the render
    // where it changed — so read the NEW value rather than the ref, which the
    // assignment above this component's body has already updated but which is
    // easy to mistake for stale when reading this in isolation.
    applyDefaultView(chartApiRef.current, viewRowsRef.current, intervalMs(interval));
    schedulePaint();
  }, [interval]);

  useEffect(() => {
    const publish = () => {
      if (replayEngagedRef.current) return; // an ENGAGED replay owns the lines while scrubbing
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
  }, [effectiveBasis, hasLevels, replayEngaged, isEs, gexVersion]);

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
      schedulePaint();
    };
    publish();
    const id = setInterval(publish, 60_000);
    return () => clearInterval(id);
  }, [effectiveBasis, hasLevels]);

  // Replay: drive the Call/Put Wall + Flip price lines off the reconstructed
  // cursor column (ES-tick snapped). Fires on scrub (replayTs) and on toggle;
  // exiting replay re-runs the live publisher above (replayEngaged is in its deps).
  useEffect(() => {
    if (!replayEngaged) return;
    const g = replayGexRef.current;
    const b = steadyBasisRef.current || effectiveBasis();
    const es = (v: number | null | undefined) => (v != null ? toTick(v + b) : null);
    const next = { callWall: es(g?.callWall), putWall: es(g?.putWall), gexFlip: es(g?.gexFlip) };
    setLineLevels((prev) =>
      prev.callWall === next.callWall && prev.putWall === next.putWall && prev.gexFlip === next.gexFlip
        ? prev
        : next
    );
  }, [replayEngaged, replayTs, effectiveBasis]);

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
      // PERF: the basis model is built ONCE per data change, not per frame.
      //
      // buildBasisAt() walks all of mvcHistory, binary-searches the candle array
      // once per CB point, calls etDayKey per point, builds two Maps, sorts the
      // day list and takes a median (array copy + sort) per day. None of that
      // depends on the viewport — only on the CB history, the candles and the
      // basis inputs — yet it ran on every single repaint, including repaints
      // caused by nothing but a crosshair move.
      //
      // Same memo-behind-a-signature shape the bubble prep already uses below.
      const basisSig = [
        mvcHistory.length, mvcHistoryHash,
        rows.length, rowsHash,
        Math.round(basis * 1000),
        dayBasisVerRef.current,
        Math.round((prevBasisRef.current || 0) * 1000),
        isEs ? 1 : 0,
      ].join("|");
      let basisAt: (tsMs: number) => number;
      if (basisFnRef.current && basisFnRef.current.sig === basisSig) {
        basisAt = basisFnRef.current.fn;
      } else {
        basisAt = buildBasisAt();
        basisFnRef.current = { sig: basisSig, fn: basisAt };
      }

      // ?debugBasis=1 → dump exactly what basis each source yields per ET day, so
      // a wrong level can be traced to a number instead of eyeballed off a chart.
      // Logs once per second at most; costs nothing when the flag is absent.
      if (debugBasisRef.current && Date.now() - basisDebugAtRef.current > 1000) {
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
        // ── PERF: whole-layer cache ────────────────────────────────────────
        //
        // Everything below — the spread/filter/sort of the column store, the
        // per-column loop, and the two full-viewport composites — produces the
        // SAME pixels whenever neither the data nor the projection has moved.
        // And it was running on every repaint, including repaints triggered by
        // nothing but a crosshair move or the 5s backstop.
        //
        // The blur is the expensive half: `ctx.filter = "blur(2.5px)"` over a
        // 1600x700 plot is 4-12ms on its own, and `ctx.filter` / `shadowBlur`
        // are the two most expensive things you can ask a 2D context for.
        //
        // So: composite the finished layer into its own canvas, fingerprint the
        // inputs, and on a match just blit it. Pre-compositing is exact rather
        // than approximate — source-over is associative, so (sharp over blur)
        // over scene is identical to sharp over (blur over scene).
        // Gutter width is measured BEFORE the fingerprint, not inside the build
        // below: it is an input to the layer's pixels, so if a cache hit skipped
        // the measurement the ref could never notice the gutter had moved and
        // the layer would stay stale forever.
        {
          let measured = 0;
          try { measured = chart.priceScale("right").width(); } catch {}
          if (Math.abs(measured - hmScaleWRef.current) >= 1) hmScaleWRef.current = measured;
        }
        const vr = ts.getVisibleLogicalRange();
        const probeA = series.priceToCoordinate(5000);
        const probeB = series.priceToCoordinate(6000);
        const cband = candleBandRef.current;
        const barsNow = rowsRef.current;
        const hmSig = [
          Math.round(w), Math.round(h),
          vr ? Math.round(vr.from * 100) : "n", vr ? Math.round(vr.to * 100) : "n",
          Math.round(barSpacing * 100),
          probeA == null ? "n" : Math.round(probeA * 10),
          probeB == null ? "n" : Math.round(probeB * 10),
          minuteColsVerRef.current,
          // Column store version. NOT the same counter as minuteColsVerRef —
          // that one tracks the BUBBLE minute map, and a live frame can write a
          // heatmap column without touching it (see the live ingest path).
          columnsVerRef.current,
          // The basis model itself. basisAt() decides the Y of every cell, and it
          // is rebuilt whenever the CB history / daily-close map / prior-day
          // anchor moves — none of which show up in any other term here. Without
          // this the bands stay frozen on the basis they were first drawn with
          // while the CB line and the flip comet (not cached) move to the
          // corrected one, and the two disagree by 10-30pt over a 5-day window.
          basisSig,
          gexMetricRef.current,
          Math.round(intensity * 1000),
          replayTsRef.current ?? "n",
          cband ? Math.round(cband.lo * 10) : "n",
          cband ? Math.round(cband.hi * 10) : "n",
          barsNow.length, barsNow.length ? barsNow[barsNow.length - 1].timestamp : 0,
          Math.round(hmScaleWRef.current),
          Math.round(paintSlotMs),
          Math.round((steadyBasisRef.current || 0) * 100),
        ].join("|");
        const cached = hmLayerRef.current;
        if (cached && cached.sig === hmSig && cached.cv.width === Math.max(1, Math.round(w))) {
          ctx.drawImage(cached.cv, 0, 0, w, h);
        } else {
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
        // (The measurement itself now happens above the layer-cache gate.)
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
          // PERF: strike → Y, memoised per basis value for the whole frame.
          //
          // This loop used to call series.priceToCoordinate() TWICE per cell.
          // With showHeatmap on, needsFullLadder disables the server-side `top`
          // truncation, so a column carries the full ~200-400 strike ladder —
          // hundreds of visible columns worked out to 50k-250k of these calls
          // per frame, and half were redundant by construction (a cell's top
          // edge IS the next cell's bottom edge).
          //
          // Two facts collapse it: the strike grid is identical across columns,
          // and `colBasis` is a per-ET-SESSION constant, so there are only ever
          // a handful of distinct (basis, strike) pairs in a frame. Cache them.
          const yCache = new Map<number, Map<number, number | null>>();
          const yFor = (basis: number, strike: number): number | null => {
            let m = yCache.get(basis);
            if (!m) { m = new Map(); yCache.set(basis, m); }
            const hit = m.get(strike);
            if (hit !== undefined) return hit;
            const v = series.priceToCoordinate(strike + basis);
            m.set(strike, v ?? null);
            return v ?? null;
          };
          // PERF: one slotX() per column, not two.
          //
          // The loop below needs the NEXT column's left edge to carry a column
          // forward, and it used to get that by calling slotX(cols[ci+1]) — then
          // threw the result away and recomputed the identical value as `sx` on
          // the following iteration. slotX is 2 xAt() calls, each a binary search
          // over the bar array plus a timeScale.timeToCoordinate(), so that was
          // ~4 of those per column instead of 2.
          const xs: Array<{ left: number; w: number } | null> = new Array(cols.length);
          for (let ci = 0; ci < cols.length; ci++) xs[ci] = slotX(cols[ci].slotTs);
          for (let ci = 0; ci < cols.length; ci++) {
            const col = cols[ci];
            const sx = xs[ci];
            if (!sx) continue;
            // Carry each column forward to the NEXT stored column's left edge so
            // slots with no GEX update (the WS skip-if-unchanged throttle stops
            // re-sending unchanged frames) don't leave empty vertical gaps. The
            // last column stretches all the way to the right axis instead.
            if (col.slotTs === lastSlotTs && bandRight > sx.left) {
              sx.w = bandRight - sx.left;
            } else if (ci + 1 < cols.length) {
              const nextX = xs[ci + 1];
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
            // Per-session historical basis (see buildBasisAt above). Resolved
            // AFTER the cull — basisAt() does an etDayKey + a binary search, and
            // running it for every stored column just to discard the answer for
            // the off-screen ones was most of its cost.
            const colBasis = basisAt(col.slotTs);
            // Per-column max + top-3 magnitudes for THIS metric (drives color/rank),
            // and the strike-sorted cell list.
            //
            // PERF: cached ON THE COLUMN. This is 4 array allocations and 2 sorts
            // (plus a Math.max(...spread) of 200-400 args) that used to run per
            // visible column PER FRAME — for data that, on every column except the
            // newest, never changes again for the life of the session. The stamp
            // is the metric, which is the only input a user can move.
            type Derived = { metric: GexMetric; max: number; top3: number[]; sorted: GexCell[] };
            const holder = col as GexColumn & { __d?: Derived };
            let d = holder.__d;
            if (!d || d.metric !== metric) {
              let max = 0;
              let t1 = 0, t2 = 0, t3 = 0;
              for (let k = 0; k < col.cells.length; k++) {
                const a = Math.abs(valOf(col.cells[k]));
                if (a <= 0) continue;
                if (a > max) max = a;
                if (a > t1) { t3 = t2; t2 = t1; t1 = a; }
                else if (a > t2) { t3 = t2; t2 = a; }
                else if (a > t3) { t3 = a; }
              }
              const top3: number[] = [];
              if (t1 > 0) top3.push(t1);
              if (t2 > 0) top3.push(t2);
              if (t3 > 0) top3.push(t3);
              d = {
                metric,
                max: max || 1,
                top3,
                sorted: [...col.cells].sort((a, b) => a.strike - b.strike),
              };
              holder.__d = d;
            }
            const { max: colMax, top3: colTop3, sorted } = d;
            for (let i = 0; i < sorted.length; i++) {
              const cell = sorted[i];
              const v = valOf(cell);
              const a0 = gexAlphaOf(v, colMax, intensity, colTop3);
              if (a0 <= 0) continue;
              const fade = distFade(cell.strike + colBasis);
              if (fade <= 0) continue;
              const faded = gexPaint(v >= 0, a0 * fade);
              if (!faded) continue;
              const nextStrike = i + 1 < sorted.length ? sorted[i + 1].strike : cell.strike + 5;
              const pTop = yFor(colBasis, nextStrike);
              const pBot = yFor(colBasis, cell.strike);
              if (pTop == null || pBot == null) continue;
              const top = Math.min(pTop, pBot);
              const cellH = Math.max(1, Math.abs(pBot - pTop));
              bctx.fillStyle = faded;
              // Slight bleed (+1px each side) so neighbors overlap before blur.
              bctx.fillRect(sx.left - 0.5, top - 0.5, sx.w + 1, cellH + 1);
            }
          }
          // Composite at reduced opacity: a soft blurred pass for the blend,
          // then a lighter crisp pass. Kept dim so candles read clearly through
          // it (the heatmap is context, not the foreground).
          //
          // Composited into the LAYER CACHE rather than straight onto the main
          // context, so the next frame that changes nothing can skip all of this
          // (see the fingerprint above). Identical output — source-over is
          // associative, so pre-compositing onto transparent then drawing the
          // result over the scene equals drawing the two passes over the scene.
          let layer = hmLayerRef.current?.cv ?? null;
          if (!layer) layer = document.createElement("canvas");
          if (layer.width !== bw || layer.height !== bh) {
            layer.width = bw;
            layer.height = bh;
          }
          const lctx = layer.getContext("2d");
          if (lctx) {
            lctx.clearRect(0, 0, bw, bh);
            lctx.globalAlpha = 0.6;
            lctx.filter = "blur(2.5px)";
            lctx.drawImage(buf, 0, 0, bw, bh);
            lctx.filter = "none";
            lctx.globalAlpha = 0.45;
            lctx.drawImage(buf, 0, 0, bw, bh); // sharp, dimmed
            lctx.globalAlpha = 1;
            hmLayerRef.current = { sig: hmSig, cv: layer };
            ctx.drawImage(layer, 0, 0, w, h);
          } else {
            // No 2D context on the layer canvas (shouldn't happen). Fall back to
            // the original direct composite so the heatmap still paints.
            hmLayerRef.current = null;
            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.filter = "blur(2.5px)";
            ctx.drawImage(buf, 0, 0, w, h);
            ctx.filter = "none";
            ctx.globalAlpha = 0.45;
            ctx.drawImage(buf, 0, 0, w, h);
            ctx.globalAlpha = 1;
            ctx.restore();
          }
        }
        }
      }

      // ── 1b) Per-strike GEX lines — one horizontal line at each strike of the
      // CURRENT (latest) GEX column, line weight + opacity ∝ |net GEX| for the
      // active metric. Same data the heatmap/rail use; cyan = +GEX (calls),
      // red = −GEX (puts). Thicker = larger gamma at that strike.
      {
        // ── 1b) 1-minute per-strike GEX bubbles ─────────────────────────────
        // One bubble per shown strike per bucket. Radius is a function of that
        // strike's |net GEX| measured against ONE reference for the whole
        // expiration, so the biggest gamma on the board draws the biggest mark
        // and every other bubble on the chart — earlier in the day, at another
        // strike — is directly comparable to it.
        //
        // The reference is TIME-OF-DAY DETRENDED (gexTodScale, chartMath). See
        // the long note at the scale itself for why, and for the calibration.
        // There is no user control over any of this any more: style is the
        // frozen BUBBLE_STYLE, and the scale is measured rather than tuned.
        if (showGexBubbles) {
          // Aggregate the 1-min store into the selected bucket. We keep the LAST
          // minute in each bucket (the freshest read of that strike's gamma), not
          // a mean — averaging smears the very spikes we're trying to show.
          //
          // "Auto" tracks the chart's own bar size, which is the only setting
          // that holds across the timeframe switcher: a fixed 5m bucket puts
          // twelve bubble columns inside one 1h candle and merges them back into
          // the solid rail the bucket exists to prevent.
          //
          // It buckets by the CONTAINING BAR via barAt(), not by
          // floor(ts / candleMs): 15m/30m/1h bars are anchored to 09:30 ET and
          // the RTH close forces a short bar, so an epoch-aligned bucket would
          // straddle two candles and put one bubble column half over each.
          //
          // isAutoBucket, not `=== "auto"`: a blob saved before the rename still
          // says "bar", and that has always meant this exact bucketer.
          const bucketOf = isAutoBucket(bubbleMinsRef.current)
            ? (t: number) => barAt(t) ?? t
            : (t: number) => Math.floor(t / (bubbleMinsRef.current as number * 60_000)) * (bubbleMinsRef.current as number * 60_000);
          const metric = gexMetricRef.current;
          const valOf = (c: GexCell) => (metric === "vol" ? c.netVol : c.netOiVol);

          // ── Everything below is MEMOISED on the data, not the viewport ────
          // Bucketing, the session reference, its expanding form and the per-
          // bucket ranking all depend only on (minute store, metric, bucket
          // size, replay cursor, bar grid) — never on where
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
            // Auto decides the level count from the board, so the mode is part
            // of the key — flipping it has to re-rank, not repaint.
            "auto",
            replayTsRef.current ?? "-",
            // barAt() is the "bar" bucketer, so the bar grid is part of the key.
            barsSig.length,
            barsSig.length ? barsSig[barsSig.length - 1].timestamp : 0,
            candleMsRef.current,
            // Spot, QUANTISED TO 5 POINTS — the strike pitch. The min-per-side
            // swap below is a function of where price sits in the ladder, so the
            // cache has to see price move; keying on the raw close would rebuild
            // the whole ranking on every tick, and keying on nothing would leave
            // the swap frozen at whatever the last GEX minute saw. A crossing can
            // only change the answer when it clears a strike.
            barsSig.length ? Math.round(barsSig[barsSig.length - 1].close / 5) : 0,
          ].join("|");

          let prep = bubblePrepRef.current;
          if (!prep || prep.sig !== prepSig) {
            const byBucket = new Map<number, GexColumn>();
            for (const m of [...minuteColsRef.current.values()].sort((a, b) => a.slotTs - b.slotTs)) {
              if (replayTsRef.current != null && m.slotTs > replayTsRef.current) continue; // replay clamp
              byBucket.set(bucketOf(m.slotTs), m);
            }
            const pMins = [...byBucket.values()].sort((a, b) => a.slotTs - b.slotTs);
            // ── THE SIZE REFERENCE ────────────────────────────────────────
            // One number for the whole expiration: the biggest |net GEX| the
            // board has carried this session. The strike holding it draws at
            // full size, and every other bubble — any strike, any minute — is
            // measured against the SAME number, which is what makes two marks
            // on this chart comparable at all.
            //
            // It is measured in DETRENDED units. Gamma at the top strike grows
            // ~4.7x from the open to the bell every single session (see
            // gexTodScale in chartMath, calibrated off six sessions of real
            // per-strike history), so a raw session max is really just "what
            // 15:55 looked like" and normalising against it squashes the entire
            // morning to dust. Dividing each bucket by its expected time-of-day
            // level removes that, and the reference becomes "the biggest gamma
            // this board has carried, relative to the clock".
            //
            // This replaces the old 15:30 cliff, which fixed the squashing by
            // throwing the last half hour out of the scale entirely — so every
            // closing wall clamped to the same maximum and the most interesting
            // half hour of the day carried no size information at all.
            //
            // ── OUT OF CASH HOURS the clock is a LIE ──────────────────────
            // gexTodScale is a CASH-SESSION profile. Outside 09:30–16:00 the
            // history writer has no market-hours gate: it republishes the last
            // cash book once a minute, frozen (same reason isEtWeekend exists).
            // An 03:00 row is therefore a 16:00 BOOK wearing an 03:00 stamp —
            // and putting a closing-auction number on the 0.72 open scale
            // inflated it ~4.7x, which made the pre-open trail the biggest
            // thing on the chart and dragged the reference up with it.
            // Judge those on the CLOSE scale, which is the book they actually
            // are.
            const todOf = (ts: number) => {
              const mod = etMinutesOfDay(ts);
              if (mod < 0) return 1;
              return (mod < RTH_OPEN_MIN || mod >= RTH_CLOSE_MIN)
                ? gexTodScale(RTH_CLOSE_MIN)
                : gexTodScale(mod);
            };
            const pTodAt = new Map<number, number>();
            for (const m of pMins) pTodAt.set(m.slotTs, todOf(m.slotTs));
            const detrendedMaxOf = (m: GexColumn) => {
              let mx = 0;
              for (const c of m.cells) {
                const a = Math.abs(valOf(c));
                if (a > mx) mx = a;
              }
              return mx / (pTodAt.get(m.slotTs) || 1);
            };
            // ── WHO IS ALLOWED TO SET THE REFERENCE ───────────────────────
            // Only cash-session buckets before the closing-auction cutoff (see
            // BUBBLE_REF_START_MIN / BUBBLE_REF_CUTOFF_MIN). Everything still
            // DRAWS; this decides whose gamma defines "full size".
            //
            // Necessary because the reference is a RUNNING MAXIMUM: a bucket
            // that sets a new max draws at ratio 1 — the cap — by construction.
            // Into the bell gamma climbs faster than the median profile the
            // detrend divides out, so minute after minute set a new detrended
            // max and every one printed at full size: an hour of identical
            // maximum marks, with the inflated max then feeding the session
            // floor below and fading the whole morning out from under them.
            //
            // The detrend still measures the excluded buckets — a 15:50 column
            // is judged against `reference x 3.10` and only clamps if it really
            // is running ~3x above the day's detrended peak. The window governs
            // the DIVISOR, not the encoding.
            const setsRef = (m: GexColumn) => {
              const mod = etMinutesOfDay(m.slotTs);
              return mod >= BUBBLE_REF_START_MIN && mod < BUBBLE_REF_CUTOFF_MIN;
            };
            let pSessRef = 0;
            for (const m of pMins) {
              if (!setsRef(m)) continue;
              const d = detrendedMaxOf(m);
              if (d > pSessRef) pSessRef = d;
            }
            // Fallback: nothing inside the window yet — an overnight chart, a
            // replay cursor parked before 09:30, a pre-open reload. Better a
            // reference from the wrong hour than no bubbles at all (the draw is
            // gated on `sessRef > 0`).
            if (pSessRef <= 0) {
              for (const m of pMins) {
                const d = detrendedMaxOf(m);
                if (d > pSessRef) pSessRef = d;
              }
            }
            // EXPANDING, not session-wide: a bucket is scaled against the
            // reference known up to and including itself, so the divisor can
            // never grow after the fact and an already-printed bubble can never
            // shrink. A strong 10:00 wall is exactly as fat at 15:50 as it was
            // at 10:00; a bigger wall later just clamps from its own bucket on.
            //
            // Floored at a fraction of the session reference so the first few
            // buckets of the day — where the running max is one or two prints —
            // don't render everything at full size.
            const pRunRef = new Map<number, number>();
            {
              let acc = 0;
              for (const m of pMins) {
                if (setsRef(m)) {
                  const d = detrendedMaxOf(m);
                  if (d > acc) acc = d;
                }
                pRunRef.set(m.slotTs, Math.max(acc, pSessRef * BUBBLE_REF_FLOOR_FRAC));
              }
            }
            // Spot in STRIKE space, for the min-per-side rule below: the
            // bubbles live in SPX strikes and the candles are ES, so the bar's
            // close comes back across the same basisAt() the marks are drawn
            // through. Bars are ascending, hence the binary search rather than a
            // keyed map — the bar grid changes with the timeframe and rebuilding
            // a map per prep is the thing this cache exists to avoid.
            const pBars = rowsRef.current;
            const spotKAt = (tMs: number): number | null => {
              if (!pBars.length) return null;
              let lo = 0, hi = pBars.length - 1;
              if (tMs > pBars[0].timestamp) {
                while (lo < hi) {
                  const mid = (lo + hi + 1) >> 1;
                  if (pBars[mid].timestamp <= tMs) lo = mid; else hi = mid - 1;
                }
              }
              const close = pBars[lo]?.close;
              if (!Number.isFinite(close)) return null;
              return (close as number) - basisAt(tMs);
            };
            // ── AUTO: how many rows, and how steep ─────────────────────────
            // Both read off the NEWEST bucket — the live board — and then held
            // for the whole trail.
            //
            // levels: how many strikes this board actually HAS, by share of its
            // own gamma. A quiet two-wall board draws the four-row minimum; a
            // flat one where six strikes each hold 5%+ widens to six.
            //
            // curve: how bunched the drawn strikes are. The median row's ratio
            // to the top IS the spread — near 1 means near-identical bands under
            // a straight-proportional law, which is unrankable, so the exponent
            // steepens. A real wall pulls the median down and the law goes back
            // to linear, because the numbers already separate.
            let autoCurve = BUBBLE_CURVE_RANGE.min;
            let nLevels = Math.max(0, bubbleLevelsRef.current);
            {
              const live = pMins[pMins.length - 1];
              const absDesc = live
                ? live.cells.map((c) => Math.abs(valOf(c))).filter((v) => v > 0).sort((a, b) => b - a)
                : [];
              const total = absDesc.reduce((sum, v) => sum + v, 0);
              nLevels = total > 0
                ? autoBubbleLevels(absDesc.map((v) => v / total))
                : BUBBLE_STYLE.topStrikes;
              const drawn = absDesc.slice(0, nLevels);
              const topAbs = drawn[0] ?? 0;
              const median = drawn.length && topAbs > 0
                ? drawn[Math.floor(drawn.length / 2)]! / topAbs
                : 0;
              autoCurve = autoBubbleCurve(median);
            }
            // ── TOP N AT EVERY MOMENT, AND THE HISTORY IS KEPT ───────────
            //
            // The selection is made PER BUCKET, and a strike is drawn only over
            // the stretch where it was actually in the top N. So a vertical
            // slice anywhere on the chart holds exactly N rows — never the
            // union of everything that was ever a level — while a wall that
            // dominated the 11:00 high keeps its trail up at the high, where it
            // happened, instead of being deleted because the afternoon's book
            // is bigger.
            //
            // This is what a session-wide ranking cannot do, and why the one
            // tried before this failed: ranked over the whole day, gamma's own
            // growth into the bell (~4.7x, see gexTodScale) meant the afternoon
            // won every comparison it was in, an entire morning of levels ranked
            // below a mediocre 15:00 strike, and the chart quietly became "the
            // last hour, drawn wide". Ranking WITHIN a bucket never makes that
            // comparison at all: 11:00's strikes are ranked against 11:00's.
            //
            // ── INCUMBENTS GET HYSTERESIS ─────────────────────────────────
            // A hard top-N boundary is a coin flip for the strikes sitting on
            // it: rank N and N+1 swap for a minute, both rows break, and the
            // trail comes out as dashes — which is exactly what the wings looked
            // like. A strike already being drawn keeps its place while it stays
            // inside N + HYST, so it takes a real fall out of the ladder, not a
            // tick of noise, to end a row.
            const HYST = 2;
            const pShownAt = new Map<number, Set<number>>();
            const pWallAt = new Map<number, Map<number, number>>();
            const pOrderAt = new Map<number, GexCell[]>();
            let prevShown: Set<number> = new Set();
            for (const m of pMins) {
              // Raw |GEX|: every strike here shares one bucket, so the
              // time-of-day scale would divide the whole list by one constant
              // and change no order. It belongs on the SIZE reference, which
              // does compare across time, and it is applied there.
              const scored: Array<{ strike: number; a: number }> = [];
              for (const c of m.cells) {
                const a = Math.abs(valOf(c));
                if (a > 0) scored.push({ strike: c.strike, a });
              }
              scored.sort((x, y) => y.a - x.a);
              const rankOf = new Map<number, number>();
              scored.forEach((x, i) => rankOf.set(x.strike, i));

              // Incumbents first, in their current order, then fill from the
              // ranking. A newcomer only takes a slot an incumbent has vacated.
              const keep = [...prevShown]
                .filter((k) => (rankOf.get(k) ?? Infinity) < nLevels + HYST)
                .sort((a, b) => (rankOf.get(a) ?? 0) - (rankOf.get(b) ?? 0));
              const set = new Set<number>(keep.slice(0, nLevels));
              for (const x of scored) {
                if (set.size >= nLevels) break;
                set.add(x.strike);
              }

              // ── The min-per-side swap, against THIS bucket's spot ────────
              // Where price was at 11:00 is what decides which side an 11:00
              // row is on. Using the live spot would rewrite the morning's
              // sides every time the afternoon moved.
              const spotK = nLevels >= 2 * BUBBLE_MIN_PER_SIDE ? spotKAt(m.slotTs) : null;
              if (spotK != null && set.size >= 2 * BUBBLE_MIN_PER_SIDE) {
                const inSet = [...set].sort((a, b) => (rankOf.get(a) ?? 0) - (rankOf.get(b) ?? 0));
                let nAbove = 0;
                for (const k of inSet) if (k >= spotK) nAbove++;
                const nBelow = inSet.length - nAbove;
                if (nAbove < BUBBLE_MIN_PER_SIDE || nBelow < BUBBLE_MIN_PER_SIDE) {
                  const wantAbove = nAbove < BUBBLE_MIN_PER_SIDE;
                  const swapIn = scored.find((x) => (wantAbove ? x.strike >= spotK : x.strike < spotK) && !set.has(x.strike));
                  if (swapIn) {
                    set.delete(inSet[inSet.length - 1]!);
                    set.add(swapIn.strike);
                  }
                }
              }

              prevShown = set;
              pShownAt.set(m.slotTs, set);
              // The wall is this bucket's own leader among the drawn rows —
              // which is the point of a glow on a trail: it shows WHEN a level
              // was the one running the board.
              const wall = new Map<number, number>();
              [...set]
                .sort((a, b) => (rankOf.get(a) ?? 0) - (rankOf.get(b) ?? 0))
                .slice(0, Math.max(0, BUBBLE_STYLE.highlight))
                .forEach((k, i) => wall.set(k, i));
              pWallAt.set(m.slotTs, wall);
              // Biggest first, so a mark that grows toward the strike pitch lets
              // the smaller rows land ON TOP of it rather than disappearing
              // underneath.
              pOrderAt.set(
                m.slotTs,
                m.cells
                  .filter((c) => set.has(c.strike))
                  .sort((a, b) => Math.abs(valOf(b)) - Math.abs(valOf(a))),
              );
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
            prep = { sig: prepSig, mins: pMins, sessRef: pSessRef, runRef: pRunRef, shownAt: pShownAt, wallAt: pWallAt, orderAt: pOrderAt, todAt: pTodAt, strikeStep: pStrikeStep, levels: nLevels, autoCurve };
            bubblePrepRef.current = prep;
          }
          const { mins, sessRef, runRef, shownAt, wallAt, orderAt, todAt, strikeStep } = prep;
          // Always on. The manual path is gone from the panel; the branches
          // below stay because they are how the pitch caps and the manual
          // budget differ, and collapsing them would inline a decision that is
          // worth being able to read.
          const autoOn = true;

          if (mins.length) {
            if (sessRef > 0) {
              // ── THE SIZE LAW ──────────────────────────────────────────────
              //   r = maxPx * (|net GEX| / reference),  floored at minPx
              //
              // STRAIGHT PROPORTIONAL. Twice the gamma is twice the radius and
              // four times the area. There is no exponent and no log — the mark
              // IS the number, and a strike carrying almost double its
              // neighbour's gamma draws almost double its neighbour's mark.
              //
              // This was a log scale with an exponent on top, on the reasoning
              // that a chain's gamma spans four orders of magnitude so a linear
              // scale would hand the whole budget to the peak. True of the whole
              // chain, false of what is DRAWN: only the top five strikes render
              // and they sit within ~2.3x of each other. Log squeezed that into
              // a 1.5x spread of pixels and every row looked identical — the
              // exact complaint this layer keeps coming back for. Straight
              // proportional gives the top strike a median 1.9x the third and
              // 2.4x the fifth, which is what their gamma actually is.
              const minPx = Math.max(0, BUBBLE_STYLE.minPx);
              // Opacity gradient: the weakest visible row fades to 1 − fade, the
              // strongest is fully opaque, so magnitude reads twice (size and
              // brightness) without either channel carrying it alone.
              const minOpacity = Math.max(0.1, 1 - Math.max(0, Math.min(1, BUBBLE_STYLE.fade)));
              // Overall opacity of the layer, from the "intensity" control. It
              // multiplies the whole thing — the magnitude gradient above still
              // runs underneath, so turning the layer down dims the wings and
              // the wall together instead of flattening one into the other.
              const layerAlpha = Math.max(0.05, Math.min(1,
                autoOn ? autoBubbleIntensity(prep.levels) : bubbleIntensityRef.current));
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
              // The wall's glow is PROPORTIONAL to its own mark now, not a
              // fixed 24px. At the small marks a tight column pitch forces, a
              // fixed bloom was several times the size of the thing it was
              // highlighting and welded the whole row into one lit bar.
              const glowBlurFor = (r: number, hiT: number) => Math.min(
                BUBBLE_STYLE.glowMaxPx,
                Math.max(1.5, r * (BUBBLE_STYLE.glowTopFactor
                  - (BUBBLE_STYLE.glowTopFactor - BUBBLE_STYLE.glowMinFactor) * hiT)),
              );

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
              // Separation in BOTH directions is protected UP FRONT, by capping
              // the size budget against the two pitches — never by clamping a
              // mark after its size has been decided. That ordering is what
              // silently threw the encoding away for so long.
              const BUBBLE_ASPECT = 1.0;  // 1 = round; >1 stretches horizontally
              const COL_GAP_PX = 0.8;     // clear space left between neighbours
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
              // ── ONE MARK PER BUCKET. NO DECIMATION. ───────────────────────
              // The bucket picker is the only thing that decides how many
              // columns there are: pick 1m and you get a bubble every minute,
              // pick Bar and you get one per candle. That is what the control
              // says it does, so that is what it does.
              //
              // This used to skip columns — a stride wide enough for two
              // full-size marks to sit side by side with a gap. It was there to
              // stop a row fusing into a solid ribbon, and it had a real cost:
              // at 1m on a zoomed-out chart the stride ran to 3 or 4, so "1
              // minute" quietly drew a bubble every third or fourth minute.
              //
              // Horizontal overlap is now simply ALLOWED. A row of overlapping
              // marks is a thick tube and a row of small ones is a thin dotted
              // line, and since thickness is exactly what the size law encodes,
              // the fused row is still telling you the truth — a fat tube IS the
              // dominant level. What must never fuse is two ROWS into one band,
              // and that is handled up front by maxPxRowFrac.
              //
              // Marks are drawn newest-first within a column and biggest-first
              // within a bucket, so where they do overlap the smaller neighbour
              // lands on top rather than vanishing underneath.
              const colStride = 1;
              // ── The size BUDGET, bounded by the room that actually exists ──
              // MARKS MUST NEVER TOUCH — not in a row, not between rows. The
              // budget is therefore capped by BOTH pitches, and every rank
              // scales with it, so the ladder shrinks as ONE THING and the
              // ratios survive. Zoom in and the marks grow back.
              //
              // Bounding the budget is what lets the decimation go. The old code
              // held the mark size fixed and skipped columns until a full-size
              // mark had room — which made the bucket picker lie ("1m" drawing a
              // bubble every third minute). Capping the size instead keeps one
              // mark per bucket exactly as the picker promises.
              //
              // Clamping AFTER the radius is computed — which is what the old
              // rx/ry caps did — is the thing to never go back to: the top of the
              // ladder lands on the clip while everything under it is untouched,
              // so the encoding is silently thrown away and every rework of the
              // size curve comes out invisible.
              //
              // The "size" control multiplies the budget AFTER the pitch caps,
              // not before. Capping after the multiply would mean dragging the
              // slider up did nothing whenever a pitch cap was binding — which
              // is most of the time on a zoomed-out chart — and a slider that
              // silently does nothing is the exact failure this layer keeps
              // being rebuilt to escape. The honest consequence: at or below
              // 1.00x marks are guaranteed never to touch; above it they may,
              // which is the user asking for bigger and accepting fused rows.
              const manualSizeMul = Math.max(BUBBLE_SIZE_RANGE.min, Math.min(BUBBLE_SIZE_RANGE.max, bubbleSizeRef.current));
              // ── The column term has a FLOOR ────────────────────────────────
              // The note above says horizontal overlap is allowed and that the
              // only thing which must never fuse is two ROWS — yet the budget
              // still let the column pitch bound it without limit, which
              // contradicted that and was the whole reason a 1-minute bucket
              // drew invisible dots. Adjacent 1m columns can sit 2-3px apart, so
              // `colPitch * 0.45` drove the budget under a pixel and no amount
              // of `size` could rescue it: the multiplier is applied after the
              // Math.min, so it was scaling a number that had already collapsed.
              //
              // The floor is inert wherever there is real room (it only binds
              // below ~15px of column pitch) and the ROW bound is untouched, so
              // the one guarantee that matters still holds exactly.
              //
              // ── …AND THE FLOOR IS OFF WHEN THE BUCKET IS AUTO ──────────────
              // On Auto the column pitch IS the bar spacing, and a 1m session
              // fitted to the pane puts the bars ~4px apart. The floor then
              // handed every mark a 7px radius inside a 4px slot — nearly 4x
              // overlap — and the whole layer fused into the solid horizontal
              // rails this bucket exists to prevent. That is the state the
              // screenshot showed.
              //
              // The floor was written for the MANUAL 1m/5m buckets, where the
              // columns are deliberately denser than the candles and the user
              // has asked for sub-bar detail and accepted fused rows to get it.
              // On Auto nobody asked for that: one column per candle is exactly
              // as much detail as the chart itself carries, so the pitch is a
              // real constraint and marks shrink to fit it. Zoom in and they
              // grow back, which is the honest behaviour — a 1m chart squeezed
              // into a session's width has ~4px per bar and a bubble cannot
              // truthfully be wider than its own bar.
              const colBound = isAutoBucket(bubbleMinsRef.current)
                ? Math.max(0.6, colPitch * BUBBLE_STYLE.maxPxColFrac)
                : Math.max(colPitch * BUBBLE_STYLE.maxPxColFrac, BUBBLE_STYLE.colBoundFloorPx);
              // The budget the pitches allow, before anyone's multiplier.
              const budgetPx = Math.min(
                BUBBLE_STYLE.maxPx,
                rowPitch * BUBBLE_STYLE.maxPxRowFrac,
                colBound,
              );
              // ── AUTO SIZE ONLY EVER SHRINKS ────────────────────────────────
              // The pitch caps say what CAN be drawn without two rows fusing;
              // they say nothing about what SHOULD be. Zoomed in, `budgetPx`
              // runs to the full 20px and six 20px blobs bury the candles they
              // are drawn over. So auto picks a target from the pane's own
              // height and the row count, and takes `min(1, target / budget)` —
              // it can ask for less than the caps allow, never for more. Asking
              // for more is what the manual slider is for, and it is the one
              // setting that can make rows touch.
              const sizeMul = autoOn
                ? Math.min(1, autoBubbleTopPx(h, prep.levels) / Math.max(0.5, budgetPx))
                : manualSizeMul;
              const maxPx = Math.max(1.2, sizeMul * budgetPx);
              // Rails, not policy. The budget above already guarantees the gap
              // at 1.00x; these exist only so a degenerate projection (a chart
              // squeezed to a few pixels) cannot paint over everything. They
              // scale with `size` for the same reason the budget does — a rail
              // that does not move turns the top of the slider's travel dead.
              // Floored the same way, and for the same reason: a rail that
              // collapses with the column pitch is not a rail, it is the clip
              // that made the marks disappear. At a 2px column pitch the old
              // expression evaluated to ~0.2px.
              //
              // On Auto the rail is a REAL cap, not a rescue: half the column
              // pitch less the gap, with no floor under it, so two neighbouring
              // columns are guaranteed to clear each other however tight the
              // bars are. Same reasoning as `colBound` above — see the note
              // there for why the floor is a manual-bucket concession.
              const rxCap = isAutoBucket(bubbleMinsRef.current)
                ? Math.max(0.35, sizeMul * Math.max(0.6, colPitch / 2 - COL_GAP_PX))
                : Math.max(0.35, sizeMul * Math.max(colPitch / 2 - COL_GAP_PX, BUBBLE_STYLE.colBoundFloorPx / 2));
              // ── The vertical bound is a SAFETY RAIL, not a size policy ─────
              // It used to be `rowPitch / 2`, a hard clip at half the strike
              // spacing, and the walls sat ON it — so the size scale was
              // computed correctly and then thrown away one line later, and the
              // biggest rows never changed by a pixel however the encoding was
              // reworked. The pitch is respected UP FRONT now, in `maxPx` above.
              const ryCap = Math.max(0.35, sizeMul * (rowPitch / 2 - COL_GAP_PX));

              // Glow sprites (see glowSpriteRef). Sizes are quantised to a half
              // pixel so a wall that breathes by a hundredth of a px between
              // buckets reuses one sprite instead of minting hundreds.
              const glowCache = glowSpriteRef.current;
              // While the user is actively panning/zooming, snap sizes to whole
              // pixels instead of half pixels. During a zoom rowPitch changes
              // continuously, so rx/ry change continuously, so the half-pixel
              // quantisation missed the cache on EVERY frame and every
              // highlighted bubble re-rendered a shadowBlur ellipse. A 1px step
              // is invisible mid-gesture and lands on ~half as many keys; the
              // settled frame after the gesture repaints at full precision.
              const qStep = interactingRef.current ? 1 : 2;
              const glowSprite = (rx: number, ry: number, base: number[], fill: number[], blur: number) => {
                const qx = Math.round(rx * qStep) / qStep;
                const qy = Math.round(ry * qStep) / qStep;
                const qb = Math.round(blur);
                const key = `${qx}|${qy}|${qb}|${base[0]},${base[1]},${base[2]}|${fill[0]},${fill[1]},${fill[2]}|${Math.round(dpr * 100)}`;
                const hit = glowCache.get(key);
                if (hit) {
                  // Re-insert to move it to the back of the iteration order —
                  // Map.set on an EXISTING key does not reorder, so without this
                  // the eviction below is FIFO and throws out the sprite being
                  // asked for every frame.
                  glowCache.delete(key);
                  glowCache.set(key, hit);
                  return hit;
                }
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
                // Bounded, by LRU eviction rather than by wiping the map.
                //
                // `glowCache.clear()` threw away all 96 entries at once, and a
                // zoom sweep is exactly the case that hits the bound — so it
                // repeatedly discarded sprites it was about to ask for again,
                // and each miss allocates a canvas and renders a shadowBlur
                // ellipse, the most expensive primitive in this file. A Map
                // iterates in insertion order, so the first key is the coldest.
                const rec = { cv, w: cw, h: ch };
                glowCache.set(key, rec);
                while (glowCache.size > 192) {
                  const k = glowCache.keys().next();
                  if (k.done) break;
                  glowCache.delete(k.value);
                }
                return rec;
              };

              ctx.save();
              for (let mi = mins.length - 1; mi >= 0; mi--) {
                // colStride is 1 — every bucket draws. Kept as a named constant
                // rather than deleted so the intent is greppable if the ribbon
                // question ever comes back.
                if ((mins.length - 1 - mi) % colStride !== 0) continue;
                const m = mins[mi];
                // xAt, not timeToCoordinate: these are sub-bar buckets. Snap x to
                // the bucket's own start so the newest column lands on its candle,
                // not in the right-axis gap ("newest bubbles render strange").
                const x = xAt(bucketOf(m.slotTs));
                if (x == null || x < -20 || x > w + 20) continue;
                const mBasis = basisAt(m.slotTs);
                // ── This bucket's slice of the absolute scale ─────────────
                // The reference is carried in DETRENDED units, so it has to be
                // put back on the clock before |GEX| can be measured against
                // it: at 15:50 the same reference means a number ~3x the one it
                // means at noon, which is exactly the correction that stops the
                // last half hour from swallowing the chart.
                //
                // Both ends are frozen at print time (runRef is expanding), so
                // a bubble already on screen can never resize.
                const domainMax = Math.max(
                  (runRef.get(m.slotTs) || sessRef) * (todAt.get(m.slotTs) || 1),
                  Number.MIN_VALUE,
                );
                const shownStrikes = shownAt.get(m.slotTs);
                const wallStrikes = wallAt.get(m.slotTs);
                if (!shownStrikes || !wallStrikes) continue;
                // Prepared in the memo above — see `orderAt`.
                const drawOrder = orderAt.get(m.slotTs);
                if (!drawOrder) continue;
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
                  // ── Where this strike sits on the absolute scale ────────
                  // 1 = it IS the biggest gamma the expiration has carried
                  // (adjusted for the clock). The reference came from the memo
                  // and does not depend on which other strikes happen to be in
                  // this column — that is the whole point. A strike's mark
                  // changes when ITS gamma changes, never because a
                  // neighbour's did.
                  const ratio = Math.min(Math.abs(v) / domainMax, 1);
                  const wallRank = wallStrikes.get(cell.strike);
                  const isHi = wallRank != null;
                  // ── SIZE MEANS ONE THING ───────────────────────────────
                  // Radius is a pure function of this strike's own |net GEX|
                  // against the session reference. No rank term, no highlight
                  // term, no top boost. Highlight used to multiply the radius
                  // (1.35x, then 2.6x graduated, then 1.45x) and every version
                  // made a strike bigger for a reason that has nothing to do
                  // with its gamma, which is what stopped the ladder being
                  // rankable by eye. The two channels stay orthogonal:
                  //   SIZE  = |net GEX|, always. Bigger dot = more gamma.
                  //   COLOR = the top-N wall selection. White-hot with a glow.
                  // `curve` is an EXPONENT, not a rank bonus (see the note
                  // above, and BUBBLE_CURVE_RANGE). At 1.00 this is the straight
                  // proportional law unchanged. Above it the top of the ladder
                  // keeps the full budget while the wings shrink, so the
                  // dominant strikes pull away without everything bloating with
                  // them — and because x^k is monotonic on [0,1], more gamma is
                  // still strictly more radius at every setting.
                  // On Auto the exponent is measured off the live board's own
                  // spread once per prep (see prep.autoCurve), so a bunched
                  // ladder separates and a ladder with a real wall stays linear.
                  const curve = autoOn ? prep.autoCurve : bubbleCurveRef.current;
                  const shaped = curve === 1 ? ratio : Math.pow(ratio, curve);
                  const r = Math.max(minPx, maxPx * shaped);
                  // Rank only drives how hard this row GLOWS (#1 brightest).
                  let hiT = 0;
                  if (isHi) {
                    const nWalls = Math.max(1, wallStrikes.size);
                    hiT = nWalls > 1 ? (wallRank as number) / (nWalls - 1) : 0;
                  }
                  // Cull only degenerate radii — canvas antialiases arcs well
                  // below 1px, so let them draw and skip only the invisible.
                  if (r < 0.12) continue;
                  // Opacity: smallest → minOpacity, largest → 1.0. Walls always full.
                  const opacity = (isHi ? 1 : minOpacity + ratio * (1 - minOpacity)) * layerAlpha;
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
                    const sp = glowSprite(rx, ry, base, col, glowBlurFor(Math.max(rx, ry), hiT));
                    // The sprite is baked opaque (it has to be — it is cached by
                    // size and colour, not by alpha), so the intensity control is
                    // applied to the BLIT instead. Restored immediately: this is
                    // inside the per-cell loop and a leaked globalAlpha would tint
                    // every overlay drawn after it.
                    const prevAlpha = ctx.globalAlpha;
                    if (layerAlpha < 1) ctx.globalAlpha = prevAlpha * layerAlpha;
                    ctx.drawImage(sp.cv, x - sp.w / 2, y - sp.h / 2, sp.w, sp.h);
                    ctx.globalAlpha = prevAlpha;
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
            // One fillRect per TPO box is thousands of calls a frame across four
            // profiles. When box + gap rounds below ~1.5 device px the boxes and
            // their gaps are indistinguishable anyway, so draw the row as a
            // single rect — visually identical, O(1) instead of O(count).
            const pitch = boxW + boxGap;
            if (pitch * dpr < 1.5) {
              ctx.fillRect(left, top, Math.max(boxW, b.count * pitch - boxGap), bh);
            } else {
              for (let i = 0; i < b.count; i++) {
                ctx.fillRect(left + i * pitch, top, boxW, bh);
              }
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
        // PERF: memoised. This whole series is viewport-independent — it maps a
        // timestamp to an ES price — and it used to be rebuilt on every frame.
        // The build spreads and sorts the entire minute store (up to 2,000
        // columns) and then COPIES-AND-SORTS every one of those columns' cell
        // arrays: ~2,000 sorts of 200-400 elements, per repaint. Only the
        // projection to pixels (further down) actually belongs in draw().
        //
        // minuteColsVerRef is bumped on every write to the minute store, so it
        // is a complete change signal for it.
        const flipSig = [
          minuteColsVerRef.current,
          metricFc,
          replayTsRef.current ?? "n",
          basisSig,
        ].join("|");
        let flipPts: Array<{ ts: number; es: number }>;
        if (flipPtsRef.current && flipPtsRef.current.sig === flipSig) {
          flipPts = flipPtsRef.current.pts;
        } else {
        flipPts = [];
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
        flipPtsRef.current = { sig: flipSig, pts: flipPts };
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

    // Publish the freshly-closed-over draw and ask for ONE paint.
    //
    // That is the entire job of this effect now. Every subscription that used to
    // live down here — the time-scale listener, a ResizeObserver, and the wheel/
    // pointermove/pointerup handlers — moved into the chart-init effect, where
    // they are created once and live as long as the chart. See the note there.
    drawOverlayRef.current = draw;
    schedulePaint();

    return () => { drawOverlayRef.current = () => {}; };
    // bb / weeklyEm are here because the Bollinger cloud and the EM boundaries
    // are painted on THIS canvas, so toggling either has to re-run the draw —
    // there is no series for React to update on their behalf.
    //
    // `showLevels` was in this list and is a DEAD dependency — it is consumed
    // only by the price-line effect, never inside draw(). Removed.
    // rowsHash / mvcHistoryHash are derived from `rows` / `mvcHistory` and are
    // read by draw() (they key the basis memo), so they belong here even though
    // their sources already are — exhaustive-deps is right about that, and
    // listing them costs nothing: each is stable whenever its source is.
  }, [schedulePaint, showHeatmap, showGexBubbles, bubbleMins, bubbleLevels, bubbleIntensity, bubbleSize, bubbleCurve, intensity, gexMetric, rows, rowsHash, interval, showProfile, profile, showTpo, tpoProfiles, showFlipCross, mvcHistory, mvcHistoryHash, showCb, bb, weeklyEm]);

  // Safety-net repaint: coalesced rAF tied to the time scale's visible-range
  // change AND a low-rate interval. Data events already call drawOverlayRef
  // directly, so this interval is just a backstop — bumped from 1s to 5s to
  // stop the 1Hz canvas churn that was burning CPU even when nothing changed.
  useEffect(() => {
    const repaint = () => {
      // A hidden tab still fires the interval, and its rAF callbacks queue up to
      // run in one burst when the tab comes back. Three cards make that burst
      // three times the size, so skip the tick entirely while nothing is on
      // screen — the visibilitychange listener repaints once on return.
      if (typeof document !== "undefined" && document.hidden) return;
      schedulePaint();
    };
    // NOTE: no subscribeVisibleTimeRangeChange here any more.
    //
    // It fired on exactly the same gestures as the overlay's
    // subscribeVisibleLogicalRangeChange, and because this effect owned its OWN
    // rAF handle the two could not coalesce — one pan frame produced two full
    // repaints plus an extra rail draw. The logical-range subscription (now in
    // the chart-init effect) is the more precise event and covers this.
    //
    // The interval is a pure backstop, and it is cheap now: the heatmap layer
    // is fingerprint-cached, so a tick with nothing changed re-blits a bitmap
    // instead of re-running the cell loop and the blur.
    document.addEventListener("visibilitychange", repaint);
    const id = setInterval(repaint, 5_000);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", repaint);
    };
  }, [schedulePaint]);

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
  // Built ONLY when it will actually be rendered.
  //
  // `dockMode === "symbol"` cards (every card but the first, on a 2-3 up row)
  // render `tickerBar`, not this — but this ~56-element tree was constructed
  // unconditionally on every render of every card and then thrown away, taking
  // FitScale, Dock, five DockButtons, two SegGroups, SymbolListDropdown and the
  // two capture buttons with it.

  // Only a card that actually RENDERS a dock builds one. `dockMode === "symbol"`
  // cards (every card but the first on a 2–3 up row) draw the ticker bar
  // instead, and used to construct this whole tree on every render and throw it
  // away.
  const dockWanted = dockMode === "full" || dockMode === "shared";

  // One string for both capture buttons: the PNG's baked-in title AND the
  // Discord message's name. They were drifting apart — the message said
  // "AMD 1m Candles" while the image said "SPX GEX".
  const snapTitle = `${sym.label} ${INTERVAL_LABEL[interval]} Candles`;

  // Snap/Discord capture: chart-only PNG (candles + axes, no toolbar/stat
  // chrome, no border, no title band — see SnapOptions.cornerLabels). The
  // top-left label carries the ticker, the expiration the overlays are
  // actually drawn against, and today's date; the bottom-left is the fixed
  // cbedge.net credit.
  const todayEtLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "numeric", day: "numeric", year: "numeric",
  }).format(new Date());
  const snapCornerLabels = {
    topLeft: `${sym.label} · ${heatmapExpiry ? dayDateOf(heatmapExpiry) : "Front"} exp · ${todayEtLabel}`,
    bottomLeft: "Data by cbedge.net",
  };

  /**
   * The cog's contents, as SECTIONS rather than a scrolling column.
   *
   * This is the fix for dropdowns-inside-dropdowns. Overlays, the expiry list,
   * the Layout presets and the page's Charts / Indicators panels were each a
   * floating layer opened from inside another floating layer, and a child panel
   * has no idea where its parent is: it landed on top of it, behind it, or half
   * off-screen, the parent's click-away had to be taught to ignore each child by
   * hand, and every layer's z-index had to be tuned against every other. A
   * section cannot be mispositioned, occluded or orphaned, because there is
   * nothing to position — it unfolds IN PLACE inside the one panel.
   *
   * Every section carries a `summary` or a `count`, so a shut row still answers
   * its own question and you are not opening all six to find the timeframe.
   *
   * Order matters — this is a top-to-bottom list, so it is reading order.
   * `page` first because that is what most visits are for, the two "what is
   * drawn" sections next, then the chart's own axes, then gamma, then the
   * rarely-touched preset store. `pageSections` come from the route
   * (it owns chart count, the replay command, the indicator blob and the preset
   * store); everything else is per-card state living in this slot's blob.
   */
  const cogSections: DockCogSection[] = !dockWanted ? [] : (() => {
    const own: DockCogSection[] = [];
    // The route's indicator sheet, folded into this card's Draw tab.
    const indicatorSection = (pageSections ?? []).find((x) => x.id === "indicators");

    own.push({
      // ONE tab for everything drawn on the chart. The overlays are the card's
      // (per-slot state) and the indicators are the route's (one blob for the
      // whole row), but that is a plumbing detail — to the person reading the
      // chart they are the same question, and two adjacent tabs called
      // "Overlays" and "Indicators" is a distinction the toolbar should not be
      // asking anyone to make. The route's `indicators` section is spliced in
      // below rather than listed as a tab of its own.
      id: "draw",
      label: "Draw",
      hint: "Everything drawn on top of the candles",
      count: [showHeatmap, showProfile, showTpo, showLevels, showSessions, showGexBubbles, showFlipCross].filter(Boolean).length
        + (indicatorSection?.count ?? 0),
      body: (
        <>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase", color: "rgba(255,255,255,0.62)" }}>
          Overlays
        </span>
        {/* A WRAPPING row, not a two-column grid. The chips hug their own
            labels now (see PanelChip), so a fixed two-track grid would leave a
            ragged half-empty column beside every short one — "TPO" in a cell
            sized for "PDH/ON+EM". Letting them flow packs seven overlays into
            three lines instead of four and stops the labels truncating. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, minWidth: 0 }}>
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
            tracks, values and steppers line up as real columns across the
            sections instead of each row sizing itself to its own label. */}
        {showHeatmap && (
          <div style={{ marginTop: 7, paddingTop: 8, borderTop: `1px solid ${HOME_THEME.border}` }}>
            <PanelSection title="Heatmap range" first>
              <SegGroup
                options={[{ label: "1D", value: "1" }, { label: "2D", value: "2" }]}
                active={String(heatmapDays)}
                onChange={(v) => { const d = Number(v) === 2 ? 2 : 1; setHeatmapDays(d); saveSetting({ heatmapDays: d }); }}
              />
            </PanelSection>
            {/* Moved out of the dock. It is a heatmap setting, it only does
                anything while the heatmap is on, and it was the last lonely
                slider sitting in a toolbar otherwise made of buttons and
                segmented pickers — so it now lives with the overlay it
                belongs to, and disappears with it. */}
            <PanelSection title="Heatmap brightness">
              <DockSlider
                label="intensity" labelWidth={SLIDER_LABEL_W} width="auto"
                value={intensity} min={0.1} max={1} step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => { setIntensity(v); saveSetting({ intensity: v }); }}
                title="How hot the gamma cells burn against the candles"
              />
            </PanelSection>
          </div>
        )}
        {showGexBubbles && (
          <div style={{ marginTop: 7, paddingTop: 8, borderTop: `1px solid ${HOME_THEME.border}` }}>
            {/* Four sliders, not seven. Contrast / Max / Brightness are
                gone: they were CORRECTIONS, moved because the chart was
                coming out wrong, and the scale they were correcting is
                absolute now (see slotStore's size law). These four are
                QUESTIONS — how much of the board do you want on screen,
                how loud should it sit against the candles, how much room
                may the marks take, and how hard should the top pull away
                — and questions have no correct answer to hardcode.

                `size` scales the whole ladder at once, so the ratio
                between the wall and the fifth strike is identical at 0.4x
                and at 4x. `top` is the one control that changes that
                ratio, and it does it by steepening the curve rather than
                by handing ranked strikes a bonus — so the mark still means
                |net GEX| and nothing else, and the ladder stays rankable
                by eye. At its default ("flat") the law is exactly the
                straight-proportional one it has always been. */}
            {/* The four sliders and the Auto chip that used to sit here are
                gone — see BUBBLE_AUTO in slotStore. Every one of them was a
                question you had to keep re-answering, and the chart only has
                one right answer at a time. The layer sizes itself from the
                board and the pane now, always. What is left is what the layer
                cannot know: which bucket, and whether the CB line is wanted. */}
            {/* "Auto" = one bubble column per candle, and it's the default:
                the bubble's time is the candle's time, so the trail
                re-formats with the timeframe switcher instead of having to
                be re-picked after it. A fixed 5m bucket stacks twelve
                columns inside a 1h candle and merges them back into the
                solid rail the bucket exists to prevent. 1m/5m stay as
                manual overrides for sub-bar detail on a 15m+ chart.

                A blob saved before the rename holds "bar", which is the old
                spelling of Auto — mapped here so the picker highlights
                Auto rather than nothing at all. */}
            <PanelSection title="Bucket">
              <SegGroup
                options={[{ label: "Auto", value: "auto" }, { label: "1m", value: "1" }, { label: "5m", value: "5" }]}
                active={isAutoBucket(bubbleMins) ? "auto" : String(bubbleMins)}
                onChange={(v) => updateBubbleMins(v === "auto" ? "auto" : Number(v) === 1 ? 1 : 5)}
              />
            </PanelSection>

            {/* CB (MVC) lives HERE, not under Levels. The top bubble is
                already marking the MVC strike, so the CB step line is the
                same read in line form; it belongs beside the bubbles. */}
            <PanelSection title="Marker">
              {/* Flex wrapper so the chip hugs its label. PanelSection's grid
                  cell stretches its child (the sliders want that), and a chip
                  stretched to the full panel width stops reading as a chip. */}
              <div style={{ display: "flex" }}>
                <PanelChip
                  label="CB line"
                  on={showCb}
                  onClick={() => updateShowCb(!showCb)}
                  title="Central Band (MVC) as a white step line. Same strike the top bubble marks — turn it off if the bubble is enough."
                />
              </div>
            </PanelSection>
          </div>
        )}

        {/* The route's indicator sheet. Rendered LAST in this tab, under a rule,
            because overlays are the gamma layer (what the board is doing) and
            indicators are the price layer (what the tape is doing) — same
            question, different half of the answer. */}
        {indicatorSection && (
          <>
            <span style={{ height: 1, background: HOME_THEME.border, margin: "2px 0" }} />
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase", color: "rgba(255,255,255,0.62)" }}>
              Indicators
            </span>
            {indicatorSection.body}
          </>
        )}
        </>
      ),
    });

    own.push({
      id: "chart",
      label: "Chart",
      hint: "Timeframe, session, and where the view sits",
      summary: `${INTERVAL_LABEL[interval]} · ${chartSession.toUpperCase()}`,
      body: (
        <>
          {/* 1m is its own server stream; 5m is the native feed; 15m/30m/1h
              roll up from the 5m bars client-side (see interval.ts). */}
          <DockField label="Timeframe">
            <SegGroup
              options={CHART_INTERVALS.map((i) => ({ label: INTERVAL_LABEL[i], value: String(i) }))}
              active={String(interval)}
              onChange={(v) => { const n = Number(v); if (isChartInterval(n)) setInterval_(n); }}
            />
          </DockField>
          {/* Also ON the bar (see the dock below). It is here as well because a
              narrow card culls the bar's controls down to the cog, and losing
              the session switch on a three-up row is exactly where you want it
              — that is the layout with no room for the overnight anyway. */}
          <DockField label="Session">
            <SegGroup
              options={[
                { label: "RTH", value: "rth" },
                { label: "ETH", value: "eth" },
              ]}
              active={chartSession}
              onChange={(v) => setChartSession(v === "rth" ? "rth" : "eth")}
            />
          </DockField>
          {/* The "Latest" jump-back control used to sit here as a View field. It
              is now a floating button on the chart's bottom-right corner, shown
              only while the newest candle is scrolled off screen — see
              `latestOffscreen`. Nothing replaced it in the menu: a control that
              is only ever wanted mid-pan belongs where the pan happens, not two
              clicks deep in a panel you have to open with the other hand. */}
        </>
      ),
    });

    own.push({
      id: "gamma",
      label: "Gamma",
      hint: "Which expiry the heatmap reads, and what it counts",
      summary: `${selectedExpiry ? dayDateOf(selectedExpiry) : "Front"} · ${gexMetric === "vol" ? "Vol" : "Vol+OI"}`,
      body: (
        <>
          {/* The expiry list, INLINE. It was a portalled dropdown hanging off a
              button in this menu — the exact nesting this rail exists to end. */}
          <DockField label="Heatmap expiry">
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 216, overflowY: "auto", minWidth: 0 }}>
        {/* Already-traded expirations are filtered out. The feed's list can
            still carry them for a while after the roll, and an entry
            reading "-1DTE" is not a thing anyone wants to pick — it just
            loads an empty ladder. Sorted ascending so the first row under
            "Front (live)" is genuinely the next book. */}
        {[{ value: "", label: `Front${frontExpiry ? ` · ${dayDateOf(frontExpiry)}` : " (live)"}`, sub: frontExpiry ? `${dteOf(frontExpiry)}DTE` : "" },
          ...expirations
            .filter((exp) => exp && dteOf(exp) >= 0)
            .slice()
            .sort()
            .map((exp) => ({
              value: exp, label: dayDateOf(exp), sub: `${dteOf(exp)}DTE`,
            }))].map((opt) => {
          const active = selectedExpiry === opt.value;
          return (
            <button
              key={opt.value || "front"}
              onClick={() => { setSelectedExpiry(opt.value); saveSetting({ expiry: opt.value }); }}
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
            </div>
          </DockField>

          <DockField label="GEX basis">
            <SegGroup
              options={[{ label: "Vol+OI", value: "voloi" }, { label: "Vol", value: "vol" }]}
              active={gexMetric}
              onChange={(v) => { setGexMetric(v as typeof gexMetric); saveSetting({ metric: v }); }}
            />
          </DockField>
        </>
      ),
    });

    // The page's CANDLES toolbar owns Replay when there is one, so the card
    // drops its own rather than offering two switches for one piece of state.
    // The home embed has no page toolbar and keeps it.
    if (!hostedReplay) {
      own.push({
        id: "replay",
        label: "Replay",
        hint: "Step through the session from the open",
        summary: replayOn ? "running" : undefined,
        body: (
          <div style={{ display: "flex" }}>
            <DockButton
              onClick={() => {
                if (replayOn) { exitReplay(); return; }
                // Inert entry — see replayEngaged. Opening the transport leaves
                // the chart live and refetches nothing.
                setReplayOn(true);
                setReplayPlaying(false);
                setReplayEngaged(false);
                setReplayIdx(0);
              }}
              title="Replay this session — reveal candles + gamma from the open forward"
              style={{ color: replayOn ? HOME_THEME.cyan : undefined }}
            >
              <span>Replay</span>
            </DockButton>
          </div>
        ),
      });
    }

    // Merge the route's sections with this card's and put them in reading
    // order. Sorting by a declared order rather than by concatenation means
    // neither side has to know what the other contributed. `indicators` is
    // absent from the list: it was consumed into `draw` above.
    const ORDER = ["page", "draw", "chart", "gamma", "layout", "replay"];
    return [...(pageSections ?? []).filter((x) => x.id !== "indicators"), ...own]
      .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  })();

  const dock = !dockWanted ? null : (
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
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)", color: "#ffffff", opacity: 0.85, whiteSpace: "nowrap" }}>
                  ES Basis {basis ? (basis > 0 ? "+" : "") + basis.toFixed(2) : "—"}
                </span>
              );
            })() : (
              // No basis line off ES: the strikes are already the chart's own
              // prices, so there is nothing to offset and nothing to report.
              <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)", color: "#ffffff", opacity: 0.85, whiteSpace: "nowrap" }}>
                {sym.gexSymbol} GEX
              </span>
            )}
          </div>
          )}

          {/* Identity + live badges stretch across the bar; the actions and the
              cog sit on the right edge. Everything else on this toolbar folded
              into that cog — same shape as /home. The badges read at a glance
              and are not settings, so they stayed out here. */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
            {!dockCompact && (
            <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,.08)", color: status === "live" ? "#30d158" : "#ffffff", whiteSpace: "nowrap", flexShrink: 0 }}>
              {status.toUpperCase()}
            </span>
            )}
            {!dockCompact && (
            <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,.08)", color: "#ffffff", whiteSpace: "nowrap", flexShrink: 0 }}>
              {`${sym.label} · ${INTERVAL_LABEL[interval]} · ${rows.length} candles`}
            </span>
            )}
            {/* The side panel is on but the card is too narrow for it. Says so,
                rather than letting a missing rail read as a broken one. */}
            {panelSuppressed && (
            <span title="Widen this card (or drop to fewer charts) to show the side panel"
                  style={{ fontSize: 11, fontWeight: 700, padding: "4px 8px", borderRadius: 8, border: `1px solid ${HOME_THEME.border}`, color: "#ffffff", whiteSpace: "nowrap", flexShrink: 0 }}>
              panel hidden — narrow
            </span>
            )}
          </div>

          {/* Page-owned buttons ride ON the bar, not in the cog.
              Everything the route hands down here is a MODE or an ACTION — the
              Replay toggle on /es-candles, the GEX-rail toggle in the /home and
              /board embeds — and those are the two things that should never be
              two clicks deep. The route's SETTINGS come down as `pageSections`
              and live in the cog's rail with everything else. */}
          {toolbarExtras}

          {/* Session switch — RTH is 09:30–16:00 ET, ETH is everything the feed
              carries. ON THE BAR for the same reason the ticker is: it changes
              what every other control on the toolbar is describing, and it is a
              thing you flip mid-read ("what did this look like without the
              overnight?") rather than set once. Kept out of `dockCompact`,
              where the bar has no room for it and the cog's Chart tab carries
              it instead.

              Rendered whenever a dock is (not just at `dockMode === "full"`),
              because unlike the ticker the session is a SHARED setting — on a
              2–3 up row the hoisted dock's switch moves all three charts through
              the slot blob, which is what makes them comparable. */}
          {!dockCompact && (
            <span style={{ flexShrink: 0 }} title="Session — RTH is the New York cash session (9:30am–4:00pm ET); ETH adds the overnight">
              <SegGroup
                options={[
                  { label: "RTH", value: "rth" },
                  { label: "ETH", value: "eth" },
                ]}
                active={chartSession}
                onChange={(v) => setChartSession(v === "rth" ? "rth" : "eth")}
              />
            </span>
          )}

          {/* Symbol picker — the curated rows, the far-CB roster, and any ticker
              typed into its search box (see symbols.tsx). Favorites persisted
              per browser. ON THE BAR, not in the cog. It is the single
              most-changed control on this page and the one that renames
              everything else on it, so burying it two clicks deep behind a gear
              made the toolbar read as a chart that could only ever be one
              ticker. Everything else in the cog is set-and-forget; this isn't.

              `dockMode === "full"` only. A SHARED dock drives every chart in a
              2–3 up row, and the ticker is the one setting that must stay
              per-card — those cards grow their own ticker bar instead (see
              `tickerBar` below). */}
          {dockMode === "full" && (
            <span style={{ flexShrink: 0 }}>
              <SymbolListDropdown active={symbol} onSelect={setSymbol} />
            </span>
          )}

          {/* Refresh is an ACTION, not a setting — it rides with the capture
              buttons rather than hiding a click deep in the cog. */}
          <DockButton onClick={refreshTrigger} title="Refresh" style={{ color: refreshStyle.color as string }}>{refreshLabel}</DockButton>

          {/* The dock itself stays in the capture, so the capture-triggering
              controls hide themselves — they'd be dead pixels in the PNG. Not
              direct children of captureRef, so they don't affect hiddenShift.
              Per-card by design: "snap THIS chart" is the useful gesture when
              three are on screen, and the label carries the symbol + timeframe
              so three PNGs are distinguishable. `hideCapture` exists for a host
              that supplies its own.

              `title` as well as `label`: `label` only names the Discord message,
              while `title` is what the capture bakes into the PNG's top-left.
              Without it every chart's snapshot was titled "SPX GEX" — the
              engine's default — so an AMD 1m capture claimed to be SPX. */}
          {!hideCapture && (<>
            <span data-capture-hide><BoxSnapBtn targetRef={captureRef} framed={false} cornerLabels={snapCornerLabels} label={snapTitle} /></span>
            <span data-capture-hide><BoxDiscordBtn targetRef={captureRef} framed={false} cornerLabels={snapCornerLabels} label={snapTitle} /></span>
          </>)}

          <DockCogMenu
            title="Candles"
            buttonTitle="Chart settings"
            sections={cogSections}
            width={400}
          />
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
      className={`es-candles-replay flex flex-wrap items-center gap-3 pt-2 pb-2${dockMode === "full" || hostedReplay ? " px-4" : ""}`}
      // Hosted, this bar IS the page's bottom dock and that dock draws its own
      // top hairline; a second rule under the controls would read as an empty
      // strip below the page. Un-hosted it still sits above the chart and needs
      // the line to separate the two.
      style={hostedReplay ? undefined : { borderBottom: `1px solid ${HOME_THEME.border}` }}
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
        // Picking a different day IS "I want to replay that day", so it engages.
        const go = (d: string) => { setReplayDay(d); setReplayEngaged(true); setReplayPlaying(false); setReplayIdx(0); };
        // Remember the instant BEFORE the frames change; the effect above lands
        // it on the new grid once the memo has recomputed.
        const goSession = (v: "rth" | "eth") => {
          // Deliberately does NOT engage: this only says WHICH bars the cursor
          // may travel over. Flipping RTH/ETH to see the range should not clamp
          // a chart that is still live.
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
            <DockButton onClick={() => engageReplayAt(replayViewIdx - 1)} title="Step back one bar"><span>⏮</span></DockButton>
            <DockButton
              onClick={() => {
                // Play from an un-engaged transport rewinds to the open, because
                // "replay the session" from the live edge has nothing to play.
                // Once engaged it is a plain play/pause, and hitting play at the
                // last bar rewinds as it always did.
                if (!replayEngaged || replayIdx >= replayFrames.length - 1) {
                  setReplayEngaged(true);
                  setReplayIdx(0);
                  setReplayPlaying(true);
                } else {
                  setReplayPlaying((p) => !p);
                }
              }}
              title={replayPlaying ? "Pause" : "Play"}
            ><span style={{ minWidth: 12, display: "inline-block", textAlign: "center" }}>{replayPlaying ? "⏸" : "▶"}</span></DockButton>
            {/* Step FORWARD from an un-engaged transport is a no-op by
                definition — the cursor is already parked at the live edge, so
                there is no next bar. Engaging anyway would freeze the chart and
                re-fire the full-ladder backfill without the cursor appearing to
                move, which is exactly the surprise the open/engage split exists
                to remove. Step BACK is unguarded: it always has somewhere to go
                and clearly means "start replaying from here". */}
            <DockButton
              onClick={() => {
                if (replayViewIdx >= replayFrames.length - 1) return;
                engageReplayAt(replayViewIdx + 1);
              }}
              title="Step forward one bar"
            ><span>⏭</span></DockButton>
          </div>
          <DockSlider
            label="bar"
            value={replayViewIdx}
            min={0}
            max={Math.max(0, replayFrames.length - 1)}
            step={1}
            width={240}
            format={(v) => fmtEtHM(replayFrames[Math.min(Math.round(v), replayFrames.length - 1)])}
            onChange={(v) => engageReplayAt(Math.round(v))}
            title="Scrub through the session"
          />
          <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: HOME_THEME.muted, whiteSpace: "nowrap" }}>
            {fmtEtHM(replayFrames[replayViewIdx])} · {replayViewIdx + 1}/{replayFrames.length}
          </span>
          {/* Armed but inert. Says so, so an open transport over an unchanged
              chart doesn't read as "replay is broken". */}
          {!replayEngaged && (
            <span style={{ fontSize: 11, fontWeight: 700, color: HOME_THEME.muted, whiteSpace: "nowrap", opacity: 0.8 }}>
              live — scrub or press play to start
            </span>
          )}
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: HOME_THEME.muted }}>Speed</span>
            <SegGroup
              options={[{ label: "1×", value: "1" }, { label: "2×", value: "2" }, { label: "4×", value: "4" }, { label: "8×", value: "8" }]}
              active={String(replaySpeed)}
              onChange={(v) => setReplaySpeed(Number(v))}
            />
          </div>
          {/* Must clear replayEngaged as well as replayOn. Leaving `engaged`
              true with `on` false makes the live price-line publisher bail
              forever — the walls and the flip get removed and never come back.
              (Same contract as the ✕ below; both go through `exitReplay`.) */}
          <DockButton onClick={exitReplay} title="Exit replay — back to live" style={{ color: HOME_THEME.cyan }}><span>● Live</span></DockButton>
        </>
      )}

      {/* Close, pinned to the right edge of the bar.
          OUTSIDE the frames ternary on purpose: the "no bars for this day"
          branch above renders a sentence and nothing else, so on a day with no
          RTH prints the transport had no exit at all short of stepping to
          another session first. A dock you can open and not close is a trap.
          It is the same `exitReplay` as "● Live" — that one says where you end
          up, this one says the bar goes away, and people reach for different
          ones. */}
      <button
        onClick={exitReplay}
        title="Close replay — back to live"
        aria-label="Close replay"
        style={{
          marginLeft: "auto", flexShrink: 0,
          width: 28, height: 28, borderRadius: 8,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${HOME_THEME.border}`,
          color: HOME_THEME.muted, cursor: "pointer", fontFamily: "inherit",
          fontSize: 15, lineHeight: 1, fontWeight: 700,
        }}
      >
        ✕
      </button>
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
          {isEs ? (
            <div
              ref={liveSpxElRef}
              className="pointer-events-none absolute z-10 rounded font-mono font-medium"
              style={{
                // Position and text are written imperatively (see paintBadge).
                // Mounted unconditionally and hidden until there is something to
                // show, so the writer always has a node to write to and a live
                // tick never has to go through React to move this 2px.
                display: "none",
                top: 2,
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
            />
          ) : null}
          {/* RSI + bar countdown. Text in the corner rather than a pane: a pane
              costs a third of the chart's height to show a number you read as
              "high / low / middling", and this card already gives the bottom
              strip to volume. Right-aligned so the two stack cleanly and neither
              moves when the other's width changes. */}
          {(rsiValue != null || barCountdownOn) && (
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
              {/* Text written by the 1s interval above, not by React. */}
              <div ref={countdownElRef} style={{ color: LIGHT_BLUE, opacity: 0.85 }} />
            </div>
          )}
          {/* SPX at the crosshair, follows the cursor's y on the right gutter. */}
          {isEs ? (
            <div
              ref={crossSpxElRef}
              className="pointer-events-none absolute z-10 rounded font-mono"
              style={{
                display: "none",
                top: 2,
                right: 64,
                background: "rgba(255,255,255,.85)",
                color: "#001018",
                whiteSpace: "nowrap",
                // Same explicit metrics as the live badge above — see note there.
                fontSize: 12,
                lineHeight: "12px",
                padding: "3px 6px",
              }}
            />
          ) : null}
          {/* ── "Latest" ────────────────────────────────────────────────────
              Only mounted while the newest bar is off the right edge (see
              `latestOffscreen`), which is what makes it affordable to put it on
              the chart at all: on a chart following the tape — the normal case —
              this renders nothing and covers no candles.

              Placed INSIDE the plot, not over the axes: `right: 70` clears the
              price scale's gutter and `bottom: 34` clears the time scale, so it
              sits in the corner of the drawing area exactly where a leftward pan
              gesture leaves the cursor. z-20 puts it over the chart canvas
              (z-2) and the overlay (z-1); it is the one element in this corner
              that WANTS pointer events, so unlike the badges above it does not
              carry `pointer-events-none`. */}
          {latestOffscreen && rows.length > 0 ? (
            <button
              type="button"
              onClick={scrollToNow}
              title="Jump to the current candle — keeps your zoom (double-click the chart to re-frame the whole session instead)"
              aria-label="Scroll to the latest candle"
              className="absolute z-20 flex items-center justify-center"
              style={{
                right: 70,
                bottom: 34,
                width: 28,
                height: 28,
                borderRadius: 999,
                border: `1px solid ${HOME_THEME.border}`,
                background: "rgba(10,13,20,0.86)",
                backdropFilter: "blur(8px)",
                color: LIGHT_BLUE,
                cursor: "pointer",
                padding: 0,
                boxShadow: "0 6px 16px rgba(0,0,0,0.45)",
                transition: "background 120ms ease, color 120ms ease, border-color 120ms ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = DOCK_THEME.hoverTile;
                e.currentTarget.style.borderColor = DOCK_THEME.activeBorder;
                e.currentTarget.style.color = HOME_THEME.text;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(10,13,20,0.86)";
                e.currentTarget.style.borderColor = HOME_THEME.border;
                e.currentTarget.style.color = LIGHT_BLUE;
              }}
            >
              {/* Chevron into a bar — the right edge of the tape, not a generic
                  "next". Drawn as SVG rather than a glyph so it centres in the
                  circle at any font stack (the ⇥ character sits low in Inter). */}
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden focusable="false">
                <path d="M4 3.5 8.5 8 4 12.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 3.5v9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
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

/**
 * memo().
 *
 * The card was a plain export, so it re-rendered whenever the page did — and the
 * page re-renders on every popover toggle and, while a popover is open, on every
 * scroll event. With up to three of these mounted, one scroll meant three full
 * reconciliations of the largest component in the app.
 *
 * Its props are now stable by construction: the page memoises the toolbar node
 * and the indicator blob is state.
 */
export default memo(EsChartCard);
