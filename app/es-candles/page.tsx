"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CandlestickSeries, ColorType, CrosshairMode, LineStyle, createChart } from "lightweight-charts";
import type { UTCTimestamp, IChartApi, ISeriesApi, IPriceLine, CandlestickData } from "lightweight-charts";
import { useEsCandles } from "@/hooks/useEsCandles";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import { findGEXFlip, type ChainRow } from "@/lib/calculations/calculations";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";
import { Dock, SegGroup, DockButton, DockGap, DockSlider } from "@/components/shared/DockToolbar";
import FitScale from "@/components/shared/FitScale";
import { HOME_THEME, DOCK_THEME, LIGHT_BLUE, SOFT_RED, dissolveCardStyle } from "@/components/shared/homeTheme";
import EsGexRail, { type RailRow } from "@/components/dashboard/EsGexRail";
import type { EsCandleRecord } from "@/lib/snapdb";
import { classifyBars, VSA_DEFAULTS, type VsaTuning, type VsaResult } from "@/lib/vsa";


// Card/accent styling now sourced from the shared theme (see BUDGET_UI_STYLE.md).
const dissolveCard = dissolveCardStyle;

// VSA candle palette. The default series colors live on the series options
// (addSeries below); these are the per-bar overrides for the two inefficient
// classes only. Churn = theme orange. Thin = the normal up/down at ~40% against
// the panel, i.e. a ghost of the move it failed to earn.
const VSA_UP = "#30d158";
const VSA_DOWN = "#ff5b5b";
const VSA_CHURN = HOME_THEME.orange;
const VSA_UP_GHOST = "rgba(48,209,88,0.32)";
const VSA_DOWN_GHOST = "rgba(255,91,91,0.32)";

function toChartTime(ts: number): UTCTimestamp {
  return Math.floor(ts / 1000) as UTCTimestamp;
}

// One painted heatmap cell: a strike bucket at a given 5-min slot.
// netOiVol = gamma×(OI+vol), netVol = gamma×vol only. The active metric is
// chosen at draw time by gexMetric so the toggle re-renders without new data.
type GexCell = { strike: number; netOiVol: number; netVol: number };
// `spot` = SPX at the moment this column's snapshot was taken. Strikes are in
// SPX space but the chart plots ES, so history is converted with a basis
// reconstructed PER SESSION from these spots (see basisForCols in the overlay
// draw). The live basis alone mis-places older columns: ES−SPX drifts with
// carry/dividends, decays into expiry, and steps at the quarterly roll.
type GexColumn = { slotTs: number; cells: GexCell[]; spot?: number };
type GexMetric = "voloi" | "vol";

// ET calendar date (YYYY-MM-DD) for a ms timestamp. Module-level so the overlay
// draw can group GEX columns into sessions for the per-session basis.
const ET_DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etDayKey = (ts: number) => ET_DAY_FMT.format(new Date(ts));

// ES trades at a POSITIVE carry to SPX (cost of carry − dividends). It is never
// negative and never a few hundred points. Anything outside this band is a data
// fault, whatever produced it — refuse it rather than bend every level by it.
function isPlausibleBasis(b: number): boolean {
  return Number.isFinite(b) && b > 0 && b < 250;
}

// Is SPX CASH open (Mon–Fri 09:30–16:00 ET)? The live basis (ES − spot) is only
// measurable while cash trades. Out of hours `spot` is a frozen last print while ES
// keeps moving, so their difference stops being a basis at all.
const ET_HM_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});
// Minutes past ET midnight for a timestamp. Used to fence off the closing auction.
function etMinutesOfDay(ts: number): number {
  const parts = ET_HM_FMT.formatToParts(new Date(ts));
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hh < 0 ? -1 : hh * 60 + mm;
}
// 15:30 ET. In the last half hour, dealer gamma collapses onto 2–3 strikes into the
// close and |GEX| there dwarfs everything printed earlier in the session. Letting
// those minutes set the bubble scale makes them render enormous and squashes the
// whole rest of the day to dust — so they're excluded from the normalization and
// simply CLAMP at the pre-15:30 max instead. See the bubble draw.
const BUBBLE_SCALE_CUTOFF_MIN = 15 * 60 + 30;

function isCashOpen(ts: number = Date.now()): boolean {
  const parts = ET_HM_FMT.formatToParts(new Date(ts));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (wd === "Sat" || wd === "Sun") return false;
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  if (hh < 0) return false;
  const mins = hh * 60 + mm;
  return mins >= 9 * 60 + 30 && mins < 16 * 60; // 09:30–16:00 ET
}

// Volume-by-price profile + value-area levels, derived from candle OHLCV.
type ProfileBin = { price: number; volume: number };
type VolumeProfile = {
  bins: ProfileBin[];      // ascending by price
  maxVol: number;
  poc: number | null;      // point of control (max-volume price)
  vah: number | null;      // value area high
  val: number | null;      // value area low
  lvn: number | null;      // most significant low-volume node inside the range
};

/** Minutes-since-ET-midnight for a slot timestamp. */
function etMinutes(ts: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ts));
  const m: Record<string, string> = {};
  parts.forEach((p) => { m[p.type] = p.value; });
  return Number(m.hour) * 60 + Number(m.minute);
}

/**
 * Build a session volume profile from candle OHLCV. Tick volume isn't available
 * per price, so each candle's volume is spread evenly across the price bins its
 * [low, high] range touches (standard candle-based profile approximation).
 * Value area = the contiguous 70% of volume around the POC.
 */
function buildVolumeProfile(
  candles: Array<{ high: number; low: number; close: number; open: number; volume: number }>,
  binSize: number
): VolumeProfile {
  const empty: VolumeProfile = { bins: [], maxVol: 0, poc: null, vah: null, val: null, lvn: null };
  if (!candles.length || !(binSize > 0)) return empty;
  let lo = Infinity, hi = -Infinity;
  for (const c of candles) { if (c.low < lo) lo = c.low; if (c.high > hi) hi = c.high; }
  if (!(hi > lo)) return empty;

  const floorBin = (p: number) => Math.floor(p / binSize) * binSize;
  const vol = new Map<number, number>();
  for (const c of candles) {
    const b0 = floorBin(c.low), b1 = floorBin(c.high);
    const n = Math.max(1, Math.round((b1 - b0) / binSize) + 1);
    const per = (c.volume || 0) / n;
    for (let b = b0; b <= b1 + 1e-9; b += binSize) vol.set(b, (vol.get(b) ?? 0) + per);
  }
  const bins: ProfileBin[] = [...vol.entries()]
    .map(([price, volume]) => ({ price, volume }))
    .sort((a, b) => a.price - b.price);
  if (!bins.length) return empty;

  let pocIdx = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i].volume > bins[pocIdx].volume) pocIdx = i;
  const total = bins.reduce((s, b) => s + b.volume, 0);
  const target = total * 0.7;

  // Expand around the POC until 70% of volume is captured (value area).
  let loI = pocIdx, hiI = pocIdx, acc = bins[pocIdx].volume;
  while (acc < target && (loI > 0 || hiI < bins.length - 1)) {
    const below = loI > 0 ? bins[loI - 1].volume : -1;
    const above = hiI < bins.length - 1 ? bins[hiI + 1].volume : -1;
    if (above >= below) { hiI++; acc += Math.max(0, above); }
    else { loI--; acc += Math.max(0, below); }
  }

  // LVN: lowest-volume bin inside the traded range (local minimum), excluding edges.
  let lvnIdx = -1;
  for (let i = 1; i < bins.length - 1; i++) {
    if (bins[i].volume < bins[i - 1].volume && bins[i].volume < bins[i + 1].volume) {
      if (lvnIdx < 0 || bins[i].volume < bins[lvnIdx].volume) lvnIdx = i;
    }
  }

  return {
    bins,
    maxVol: bins[pocIdx].volume,
    poc: bins[pocIdx].price,
    vah: bins[hiI].price,
    val: bins[loI].price,
    lvn: lvnIdx >= 0 ? bins[lvnIdx].price : null,
  };
}

// ── TPO (Time Price Opportunity) profile ────────────────────────────────────
// Classic "letter chart" market profile, but rendered as light-gray boxes
// instead of letters. Counts are TPO touches (one per 30-min period that
// traded at a price), NOT volume — same 70%-expansion value-area algorithm as
// buildVolumeProfile above, just fed period-touch counts instead of volume.
const TPO_PERIOD_MS = 30 * 60_000;
type TpoBin = { price: number; count: number };
type TpoProfile = {
  bins: TpoBin[];
  maxCount: number;
  poc: number | null;   // point of control
  vah: number | null;   // value area high
  val: number | null;   // value area low
  mid: number | null;   // session range midpoint
  startTs: number | null; // chart x-anchor: first candle of this session
  endTs: number | null;   // chart x-anchor: where the profile's box-width ends
};

function buildTpoProfile(
  candles: Array<{ high: number; low: number; timestamp: number }>,
  binSize: number,
  periodMs: number
): TpoProfile | null {
  if (!candles.length || !(binSize > 0)) return null;
  const floorBin = (p: number) => Math.floor(p / binSize) * binSize;

  // Collapse candles into 30-min TPO periods, tracking each period's touched range.
  const byPeriod = new Map<number, { low: number; high: number }>();
  let dayHigh = -Infinity, dayLow = Infinity;
  for (const c of candles) {
    if (c.high > dayHigh) dayHigh = c.high;
    if (c.low < dayLow) dayLow = c.low;
    const p = Math.floor(c.timestamp / periodMs) * periodMs;
    const cur = byPeriod.get(p);
    if (!cur) byPeriod.set(p, { low: c.low, high: c.high });
    else { if (c.low < cur.low) cur.low = c.low; if (c.high > cur.high) cur.high = c.high; }
  }

  // Each period contributes at most one touch per price bin (TPO count, not volume).
  const counts = new Map<number, number>();
  for (const { low, high } of byPeriod.values()) {
    const b0 = floorBin(low), b1 = floorBin(high);
    for (let b = b0; b <= b1 + 1e-9; b += binSize) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const bins: TpoBin[] = [...counts.entries()]
    .map(([price, count]) => ({ price, count }))
    .sort((a, b) => a.price - b.price);
  if (!bins.length) return null;

  let pocIdx = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i].count > bins[pocIdx].count) pocIdx = i;
  const total = bins.reduce((s, b) => s + b.count, 0);
  const target = total * 0.7;
  let loI = pocIdx, hiI = pocIdx, acc = bins[pocIdx].count;
  while (acc < target && (loI > 0 || hiI < bins.length - 1)) {
    const below = loI > 0 ? bins[loI - 1].count : -1;
    const above = hiI < bins.length - 1 ? bins[hiI + 1].count : -1;
    if (above >= below) { hiI++; acc += Math.max(0, above); }
    else { loI--; acc += Math.max(0, below); }
  }

  return {
    bins,
    maxCount: bins[pocIdx].count,
    poc: bins[pocIdx].price,
    vah: bins[hiI].price,
    val: bins[loI].price,
    mid: Number.isFinite(dayHigh) && Number.isFinite(dayLow) ? (dayHigh + dayLow) / 2 : null,
    startTs: null,
    endTs: null,
  };
}

// Floor a ms timestamp to its 5-minute candle slot, returned as a UTC ms boundary
// aligned to the candle grid (candles use raw ms flooring of /ES bars).
// Snap snapshot timestamps to the chart's 5-minute candle grid. Snapshots
// arrive every ~30s, but the candles are 5m — bucketing to 1m left each column
// only a sliver wide (and gaps between candles) because timeToCoordinate only
// resolves at candle times. 5m buckets align one column per candle, full width.
const SLOT_MS = 300_000;
function slotFloorMs(ts: number): number {
  return Math.floor(ts / SLOT_MS) * SLOT_MS;
}

/**
 * GEX heatmap color (ES Candles page variant). Positive GEX = cyan
 * (41,182,246), negative = red (255,71,87). The 3 largest magnitudes get fixed
 * rank floors so the dominant walls always stand out; everything else follows a
 * curve scaled by `intensity`.
 *
 * Tuned vs. the home page's metricBg() so the LIGHTER (low-magnitude) zones are
 * actually readable instead of washing out:
 *   • exponent 0.6 (was 1.4 > 1, which crushed lows toward 0) — sub-1 lifts the
 *     low/mid end so faint cells gain alpha quickly.
 *   • intensity multiplies the eased curve OUTSIDE the pow (was inside, where it
 *     compounded the crush), so the slider scales the whole field linearly.
 *   • non-top-3 ceiling raised 0.18 → 0.30, floor 0.02 → 0.04, but still kept
 *     strictly below the rank-3 wall (0.35) so the wall hierarchy is preserved.
 */
function gexColor(value: number, maxValue: number, intensity: number, top3: number[]): string | null {
  const n = value || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return null;
  const pos = n >= 0;
  const rank = top3.indexOf(Math.abs(n)) + 1;
  if (rank === 1) return pos ? "rgba(41,182,246,0.90)" : "rgba(255,71,87,0.90)";
  if (rank === 2) return pos ? "rgba(41,182,246,0.55)" : "rgba(255,71,87,0.55)";
  if (rank === 3) return pos ? "rgba(41,182,246,0.35)" : "rgba(255,71,87,0.35)";
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio, 0.6);
  const alpha = Math.min(0.30, 0.04 + eased * (intensity || 0.1) * 0.26);
  return pos ? `rgba(41,182,246,${alpha.toFixed(3)})` : `rgba(255,71,87,${alpha.toFixed(3)})`;
}


// ─────────────────────────────────────────────────────────────────────────────
// (Options Positioning strip moved back to /test as a tab — Brandon wants it
// there, not on the chart page. See app/test/page.tsx OptionsPositioningTab.)
// ─────────────────────────────────────────────────────────────────────────────

export default function EsCandlesPage() {
  const esShouldConnect = useWsLifecycle();
  const esShouldConnectRef = useRef(esShouldConnect);
  esShouldConnectRef.current = esShouldConnect;

  const { sessionCandles: liveRows, historical, connected, refresh } = useEsCandles();

  // Chart candles: full 5-day rolling window so the heatmap's historical columns
  // resolve via timeToCoordinate (which only works for timestamps on the chart's
  // time scale). historical already holds 20 days from SQLite; merge with the
  // live session so the most-recent bars always win on slotKey collision.
  const rows = useMemo(() => {
    const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - FIVE_DAYS_MS;
    const map = new Map<string, typeof liveRows[0]>();
    for (const c of historical) if (c.slotKey && c.timestamp >= cutoff) map.set(c.slotKey, c);
    for (const c of liveRows) if (c.slotKey) map.set(c.slotKey, c); // live wins
    return [...map.values()].sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey));
  }, [historical, liveRows]);
  const { trigger: refreshTrigger, label: refreshLabel, style: refreshStyle } = useRefreshButton(async () => { await refresh(); });

  // VSA classification for the visible bars. Baseline comes from `historical`
  // (20 sessions from SQLite) rather than `rows` (5 days) so the per-slot median
  // has enough prior sessions to mean anything. Recomputed only when the tuning
  // or the bars change — it is a pure pass over data already in memory.
  const vsaMap = useMemo(() => {
    if (!showVsa) return new Map<string, VsaResult>();
    // The bar covering "now" has partial volume and would always read as thin.
    const formingBefore = Date.now() - 5 * 60 * 1000;
    return classifyBars(rows, historical, vsaTuning, formingBefore);
  }, [showVsa, rows, historical, vsaTuning]);

  const chartRef = useRef<HTMLDivElement>(null);
  // Capture target for the Snap / Discord buttons (chart + lanes panel).
  const captureRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const didFitRef = useRef(false);
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
  const drawLanesRef = useRef<() => void>(() => {});
  // Today's MVC history: raw SPX strikeOIVol per snapshot. Converted to ES at
  // DRAW time using the live ESU basis (same as the other levels), so the line
  // tracks the current /ESU price — not the stale per-row esPrice.
  const [mvcHistory, setMvcHistory] = useState<Array<{ ts: number; spx: number; spxPx: number; basis: number | null }>>([]);
  const showMvcLine = true; // CB level always on
  const [showHeatmap, setShowHeatmap] = useState(true);
  // In the dock (embed) auto-load a clean candle chart: default the GEX heatmap
  // profile OFF (user can still toggle it on). Done as an effect, not a lazy
  // initializer, so it applies client-side after SSR hydration.
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1") {
      setShowHeatmap(false);
    }
  }, []);
  // Heatmap backfill window. 5-day backfill pulls/renders far more 1-min
  // history columns than 1-day and visibly slows the chart, so default to
  // the fast 1-day window and let the user opt into 5-day when they want it.
  const [heatmapDays, setHeatmapDays] = useState<1 | 5>(1);
  const [intensity, setIntensity] = useState(0.65); // page-local default; tuned with gexColor so light zones read clearly
  // Heatmap metric: "voloi" = gamma×(OI+vol), "vol" = gamma×vol only. Mirrored
  // in a ref so the WS-driven overlay draw reads it without re-subscribing.
  const [gexMetric, setGexMetric] = useState<GexMetric>("voloi");
  const gexMetricRef = useRef<GexMetric>("voloi");
  gexMetricRef.current = gexMetric;
  // Column history keyed by 5-min slot ms. One column per slot; latest slot is
  // updated in place as fresh gex messages arrive within the same 5-min window.
  const columnsRef = useRef<Map<number, GexColumn>>(new Map());
  // 1-minute resolution snapshots of the SAME per-strike cells (columnsRef is
  // floored to 5-min heatmap slots — too coarse for the bubble trail).
  const minuteColsRef = useRef<Map<number, GexColumn>>(new Map());
  const bubbleScaleRef = useRef(1);
  // NOTE: the effect that syncs this ref lives next to the bubbleScale useState
  // below — NOT here. A `[bubbleScale]` dep array is evaluated during render, and
  // the state is declared further down, so putting it here threw a TDZ
  // ReferenceError ("Cannot access before initialization") and 500'd the page.
  // Imperative redraw hook set up by the overlay effect; apply() calls it when a
  // new gex snapshot lands so in-place column updates repaint immediately.
  const drawOverlayRef = useRef<() => void>(() => {});
  // Cached right price-axis gutter width (px). Updated only on >=1px change so
  // the heatmap's right edge doesn't shimmer with sub-pixel label wobble.
  const hmScaleWRef = useRef(0);
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

  // Overlays dropdown. The six overlay toggles used to sit inline in the dock
  // and overflowed it (FitScale shrank everything to unreadable); they live in
  // a checklist menu now.
  const [ovlOpen, setOvlOpen] = useState(false);
  const [ovlRect, setOvlRect] = useState<{ left: number; top: number } | null>(null);
  const ovlBoxRef = useRef<HTMLDivElement>(null);
  const ovlMenuRef = useRef<HTMLDivElement>(null);
  const openOvl = useCallback(() => {
    const r = ovlBoxRef.current?.getBoundingClientRect();
    if (r) setOvlRect({ left: r.left, top: r.bottom + 4 });
    setOvlOpen((v) => !v);
  }, []);
  useEffect(() => {
    if (!ovlOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ovlBoxRef.current?.contains(t)) return;
      if (ovlMenuRef.current?.contains(t)) return;
      setOvlOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [ovlOpen]);

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
  // VSA candle coloring — effort (RVOL) vs result (body/range). Volume-based,
  // NOT delta: dxFeed candles carry no aggressor side, and per-print TimeAndSale
  // classification saturated the streamer last time. See lib/vsa.ts.
  const [showVsa, setShowVsa] = useState(false);
  const [vsaTuning, setVsaTuning] = useState<VsaTuning>(VSA_DEFAULTS);
  const [showLevels, setShowLevels] = useState(false);  // Call/Put/Flip/MVC dashed lines + MVC step line
  const [showSessions, setShowSessions] = useState(false); // prior-day + overnight H/L
  const [showRail, setShowRail] = useState(true); // right-side vertical GEX-by-strike rail
  // Per-strike 1-minute GEX bubbles. Radius ∝ |net GEX|
  // at that strike in that minute, normalized to the session max so the bubble
  // trail shows gamma building/bleeding at each level through the day.
  const [showGexBubbles, setShowGexBubbles] = useState(false);
  // 0.3 is the sweet spot, so the slider is centered on it (0.1–0.5).
  const [bubbleScale, setBubbleScale] = useState(0.3); // manual radius multiplier (sizing is taste)
  // Mirrored into a ref so the imperative overlay draw reads it without
  // re-subscribing. Must stay BELOW the useState above (see bubbleScaleRef).
  useEffect(() => { bubbleScaleRef.current = bubbleScale; }, [bubbleScale]);
  // Auto-collapse the fixed-width rail when the chart area gets too narrow (e.g.
  // in the 2/5 drawer / iframe), otherwise the 230px rail starves the candle
  // chart down to nothing and only the GEX bars remain visible.
  const [railFits, setRailFits] = useState(true);
  const RAIL_MIN_WIDTH = 560; // total chart-area px below which the rail is hidden
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

  // Track the chart-area width so the fixed-width GEX rail can auto-collapse when
  // there isn't room for both it and a usable candle chart.
  useEffect(() => {
    const el = captureRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setRailFits(el.clientWidth >= RAIL_MIN_WIDTH);
    });
    ro.observe(el);
    setRailFits(el.clientWidth >= RAIL_MIN_WIDTH);
    return () => ro.disconnect();
  }, []);
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

      const ethRows = rows.filter((r) => r.timestamp >= ethStart && r.timestamp < ethEnd);
      const ethProfile = ethRows.length ? buildTpoProfile(ethRows, 1, TPO_PERIOD_MS) : null;
      if (ethProfile) { ethProfile.startTs = ethStart; ethProfile.endTs = ethEnd; sessions.push(ethProfile); }

      const rthRows = rows.filter((r) => r.timestamp >= rthStart && r.timestamp < rthEnd);
      const rthProfile = rthRows.length ? buildTpoProfile(rthRows, 1, TPO_PERIOD_MS) : null;
      if (rthProfile) { rthProfile.startTs = rthStart; rthProfile.endTs = rthEnd; sessions.push(rthProfile); }
    }
    return sessions;
  }, [rows, clockTick]);

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

  // Listen to /ws/gex for the GEX levels + ES basis inputs.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let dead = false;

    const apply = (d: Record<string, unknown>) => {
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
      // gexFlip isn't sent by the feed — compute it from gexRows like the home
      // page does (zero-crossing of the net-GEX profile nearest spot).
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
          gexFlip:  computedFlip != null ? computedFlip : (d.gexFlip != null ? Number(d.gexFlip) || null : prev.gexFlip),
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
      const ingestLive = !selectedExpiryRef.current || selectedExpiryRef.current === liveExpiry;
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
          mmap.set(minTs, { slotTs: minTs, cells, spot: spx > 0 ? spx : undefined });
          if (mmap.size > 2000) mmap.delete(Math.min(...mmap.keys()));
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

    const handle = (raw: string) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw); } catch { return; }
      const type = String(msg.type ?? "");
      const d = (msg.data && typeof msg.data === "object" ? msg.data : msg) as Record<string, unknown>;
      if (type === "snapshot" || type === "gex" || type === "GEX_UPDATE" || type === "spot" || type === "aux") apply(d);
    };

    const connect = () => {
      if (dead || !esShouldConnectRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      try { ws = new WebSocket(`${proto}//${window.location.host}/ws/gex`); }
      catch { schedule(); return; }
      ws.onmessage = (e) => handle(String(e.data));
      ws.onerror = () => { try { ws?.close(); } catch {} };
      ws.onclose = () => { if (!dead) schedule(); };
    };
    const schedule = () => {
      if (dead || !esShouldConnectRef.current) return;
      if (retry) clearTimeout(retry);
      retry = setTimeout(connect, 2500);
    };

    // Value-driven bandwidth gate: re-runs when esShouldConnect flips.
    if (esShouldConnect) connect();
    return () => {
      dead = true;
      if (retry) clearTimeout(retry);
      if (ws) {
        ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => { try { ws?.close(); } catch {} };
        else { ws.onopen = null; try { ws.close(); } catch {} }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esShouldConnect]);

  // Heatmap history backfill. Effective expiry = the DTE picker selection, or
  // the live front expiry when nothing is picked. Re-runs whenever the picker
  // OR the 1D/5D range toggle changes: clears the column map and reloads.
  const heatmapExpiry = selectedExpiry || feedExpiry;
  useEffect(() => {
    if (!heatmapExpiry) return;
    let cancelled = false;
    // When the picker or range changes, wipe the existing columns so we don't
    // mix expiries or leave stale far-back columns after switching to 1D.
    columnsRef.current.clear();
    minuteColsRef.current.clear();
    drawOverlayRef.current();
    (async () => {
      try {
        // Front (live) mode = rolling 0DTE, a different expiry string every
        // trading day, so ask the server to ignore the expiry filter and pull
        // by time window alone (anyExpiry=1) — otherwise backfill only ever
        // matches today. An explicit DTE pick keeps the exact expiry match.
        const isFront = !selectedExpiry;
        const minutes = heatmapDays * 1440;
        const res = await fetch(
          `/api/snapshots/option-strike-gex-history?mode=heatmap&minutes=${minutes}&expiry=${encodeURIComponent(heatmapExpiry)}${isFront ? "&anyExpiry=1" : ""}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const json = await res.json();
        // History persists both net_gex (OI+vol) and net_vol_gex (vol-only), so
        // the Vol-only heatmap mode now has backfill too. netVol falls back to 0
        // for legacy rows written before the column existed.
        type RawCol = { slotTs: number; cells: Array<{ strike: number; net: number; netVol?: number }>; spot?: number };
        const raw = Array.isArray(json.columns) ? (json.columns as RawCol[]) : [];
        if (cancelled || !raw.length) return;
        const map = columnsRef.current;
        // DB rows are 1-min granular; snap to the 5-min candle grid. Sort
        // descending so the newest snapshot within each bucket wins (first seen).
        const sortedRaw = [...raw].sort((a, b) => b.slotTs - a.slotTs);
        // Bubble trail backfill: TODAY only, at native 1-min granularity (no
        // 5-min flooring). Same rows, different bucket — the heatmap coarsens
        // them, the bubbles don't.
        const mmap = minuteColsRef.current;
        const todayKey = etDayKey(Date.now());
        for (const col of sortedRaw) {
          const slotTs = slotFloorMs(col.slotTs);
          const cells: GexCell[] = col.cells
            .filter((c) => c.strike > 0 && Number.isFinite(c.net))
            .map((c) => ({ strike: c.strike, netOiVol: c.net, netVol: Number(c.netVol ?? 0) }));
          // Historical SPX spot for this snapshot → per-column ES basis at draw
          // time. 0/undefined (legacy rows) falls back to the live basis.
          const colSpot = Number(col.spot ?? 0);
          const spot = colSpot > 0 ? colSpot : undefined;

          if (etDayKey(col.slotTs) === todayKey && cells.length) {
            const minTs = Math.floor(col.slotTs / 60_000) * 60_000;
            if (!mmap.has(minTs)) mmap.set(minTs, { slotTs: minTs, cells, spot });
          }

          if (map.has(slotTs)) continue; // live wins on collisions
          map.set(slotTs, { slotTs, cells, spot });
        }
        drawOverlayRef.current();
      } catch { /* live feed still populates the front expiry going forward */ }
    })();
    return () => { cancelled = true; };
  }, [heatmapExpiry, heatmapDays]);

  // Load today's full MVC history (raw SPX strikeOIVol) and refresh every 60s.
  // ES conversion happens at draw time with the live basis.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/snapshots/mvc?limit=1000`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const rows = Array.isArray(json.rows) ? json.rows : [];
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
        // Latest MVC (SPX points) → the legend chip value.
        const latest = pts.length ? pts[pts.length - 1].spx : 0;
        if (latest > 0) setLevels((prev) => ({ ...prev, mvc: latest }));
      } catch { /* keep last */ }
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);


  // THE basis used for every SPX→ES conversion on this page (levels, rail, heatmap,
  // CB line, right-axis SPX). Strictly ordered, most-trustworthy first — see the
  // numbered notes inline. The rule that fixes this page: never compute the basis
  // against the broker "SPX" spot, because that spot tracks ES, not cash.
  const effectiveBasis = useCallback(() => {
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
  }, []);

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
          // Axis tick labels in Eastern Time. tickMarkType 2/3 = day/month
          // boundary → show the ET date; otherwise show ET HH:MM.
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
        wickUpColor: "#30d158",
        upColor: "#30d158",
        wickDownColor: "#ff5b5b",
        downColor: "#ff5b5b",
        borderVisible: false,
      });
      chartApiRef.current = chart;
      candleSeriesRef.current = candleSeries;

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
          chart.timeScale().fitContent();
          drawOverlayRef.current();
        }
      });
      ro.observe(container);
      lastW = Math.round(container.clientWidth);
      lastH = Math.round(container.clientHeight);
      chart.applyOptions({ width: lastW, height: lastH });

      // Double-click anywhere on the chart → recenter: fit all candles in the
      // time axis and snap both price scales back to autoscale (right axis right).
      const onDblClick = () => {
        chart.timeScale().fitContent();
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

    const candleData: CandlestickData[] = rows.map((row) => {
      const base: CandlestickData = {
        time: toChartTime(row.timestamp),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
      };
      if (!showVsa) return base;
      const v = vsaMap.get(row.slotKey);
      // "normal" and unscored bars keep the default series colors — only the two
      // inefficient classes are repainted, so an unusual bar stays unusual to the
      // eye instead of every bar shouting.
      if (!v || v.cls === "normal") return base;
      if (v.cls === "churn") {
        // Effort with no ground: orange body. The wick carries WHO WON the bar —
        // close near the low on heavy volume = supply absorbed the buyers. That
        // is inference from close position, NOT a measured aggressor side.
        const wick = v.closePos >= 0.6 ? VSA_UP : v.closePos <= 0.4 ? VSA_DOWN : VSA_CHURN;
        return { ...base, color: VSA_CHURN, wickColor: wick };
      }
      // Ground with no effort: keep direction, ghost it. A thin move is a weak
      // version of the move, so it reads as a dimmer candle, not a new color.
      const up = row.close >= row.open;
      const ghost = up ? VSA_UP_GHOST : VSA_DOWN_GHOST;
      return { ...base, color: ghost, wickColor: ghost };
    });

    candleSeries.setData(candleData);
    // Track the price band the candles actually occupy so the heatmap can fade
    // by distance from it.
    if (candleData.length) {
      let lo = Infinity, hi = -Infinity;
      for (const r of rows) { if (r.low < lo) lo = r.low; if (r.high > hi) hi = r.high; }
      candleBandRef.current = Number.isFinite(lo) ? { lo, hi } : null;
    } else {
      candleBandRef.current = null;
    }
    // Fit on first data load AND whenever the latest bar's ET day advances past
    // the day we last fit for — so the chart follows the session into the new
    // day instead of staying parked on the prior one. Within the same day we
    // never re-center, preserving the user's pan/zoom on live updates.
    const lastDay = candleData.length ? rows[rows.length - 1].date : "";
    if (candleData.length && (!didFitRef.current || lastDay !== lastFitDayRef.current)) {
      chart.timeScale().fitContent();
      didFitRef.current = true;
      lastFitDayRef.current = lastDay;
    }
    updateLiveSpxRef.current();
    // Live candle updates shift the time axis without always firing a logical-
    // range change, which could leave the heatmap overlay painting a stale or
    // cleared frame. Repaint whenever candle data changes.
    drawOverlayRef.current();
    drawLanesRef.current();
    railDrawRef.current();
  }, [rows, showVsa, vsaMap]);

  // Live SPX badge: last ES close → SPX, pinned at its y-coordinate on the
  // right gutter. Recomputed on data, basis, and pan/zoom (range subscribe).
  const updateLiveSpxRef = useRef<() => void>(() => {});
  useEffect(() => {
    updateLiveSpxRef.current = () => {
      const series = candleSeriesRef.current;
      if (!series || !rows.length) { setLiveSpx(null); return; }
      const lastEs = rows[rows.length - 1].close;
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
  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetch("/proxy/es-spx-basis", { cache: "no-store" });
        if (!res.ok) { console.warn(`[basis] trusted basis HTTP ${res.status}`); return; }
        const j = await res.json();
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
  }, []);

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
  useEffect(() => {
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
        const res = await fetch(`/api/eod-gex?symbol=$SPX&limit=30`, { cache: "no-store" });
        if (!res.ok) { console.warn(`[basis] NO ANCHOR: /api/eod-gex HTTP ${res.status}`); return; }
        const json = await res.json();
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
  }, [historical]);

  // Draw GEX level lines (Call Wall / Put Wall / Flip / MVC) on the candle series,
  // converting SPX-point levels to ES via the live basis (esFut - spx).
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    // Clear previous lines.
    for (const pl of priceLinesRef.current) { try { series.removePriceLine(pl); } catch {} }
    priceLinesRef.current = [];

    // Was: raw levels.esFut - levels.spx, recomputed on every `levels` change
    // (even ones unrelated to basis) from two independently-timed fields —
    // this is what made the Put Wall line jump around. effectiveBasis()
    // reads the server's freshness-gated basisRef (falling back to the
    // frozen prior-day basis) instead.
    const basis = effectiveBasis();
    const toEs = (spxLevel: number | null) => (spxLevel != null ? spxLevel + basis : null);

    const defs: Array<{ price: number | null; color: string; title: string; style: LineStyle; width: 1 | 2 }> = [];

    // Call/Put/Flip — toggled by the Levels button.
    if (showLevels) {
      defs.push(
        { price: toEs(levels.callWall), color: "#30d158", title: "Call Wall", style: LineStyle.Dashed, width: 1 },
        { price: toEs(levels.putWall),  color: "#ff5b5b", title: "Put Wall",  style: LineStyle.Dashed, width: 1 },
        { price: toEs(levels.gexFlip),  color: "#f5c518", title: "Flip",      style: LineStyle.Dashed, width: 1 },
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

    for (const d of defs) {
      if (d.price == null || !(d.price > 0)) continue;
      const pl = series.createPriceLine({
        price: d.price,
        color: d.color,
        lineWidth: d.width,
        lineStyle: d.style,
        axisLabelVisible: true,
        title: d.title,
      });
      priceLinesRef.current.push(pl);
    }
  }, [levels, showLevels, showSessions, sessionLevels, effectiveBasis]);

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
      const basis = effectiveBasis();

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

      // Slot → [leftX, width] in screen px. Null if the slot isn't on screen.
      const slotX = (slotTs: number): { left: number; w: number } | null => {
        const x0 = ts.timeToCoordinate((slotTs / 1000) as UTCTimestamp);
        const xEndRaw = ts.timeToCoordinate(((slotTs + SLOT_MS) / 1000) as UTCTimestamp);
        if (x0 == null) return null;
        const x1 = xEndRaw != null ? xEndRaw : x0 + 8;
        return { left: Math.min(x0, x1), w: Math.max(2, Math.abs(x1 - x0)) };
      };

      // ── 1) GEX heatmap cells ──
      // Rendered to an offscreen buffer, then composited back through a blur so
      // adjacent strike/time cells melt into smooth bands instead of hard tiles.
      if (showHeatmap) {
        const cols = [...columnsRef.current.values()].sort((a, b) => a.slotTs - b.slotTs);
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

        // Offscreen buffer at the same CSS size (the main ctx is already DPR-
        // scaled, so we draw in CSS px here too).
        const buf = document.createElement("canvas");
        buf.width = Math.max(1, Math.round(w));
        buf.height = Math.max(1, Math.round(h));
        const bctx = buf.getContext("2d");
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
            if (col.slotTs === lastSlotTs && hmPlotRight > sx.left) {
              sx.w = hmPlotRight - sx.left;
            } else if (ci + 1 < cols.length) {
              const nextX = slotX(cols[ci + 1].slotTs);
              if (nextX && nextX.left > sx.left) sx.w = nextX.left - sx.left;
            }
            // Per-column max + top-3 magnitudes for THIS metric (drives color/rank).
            const absVals = col.cells.map((c) => Math.abs(valOf(c))).filter((v) => v > 0);
            const colMax = absVals.length ? Math.max(...absVals) : 1;
            const colTop3 = [...absVals].sort((a, b) => b - a).slice(0, 3);
            const sorted = [...col.cells].sort((a, b) => a.strike - b.strike);
            for (let i = 0; i < sorted.length; i++) {
              const cell = sorted[i];
              const color = gexColor(valOf(cell), colMax, intensity, colTop3);
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
        // minute; radius ∝ |net GEX| at that strike, normalized to the max |GEX|
        // seen across ALL minutes in the buffer (a session-wide scale) so the
        // trail reads as gamma building/bleeding over time rather than being
        // re-normalized every column. bubbleScale is the manual size knob.
        if (showGexBubbles) {
          const mins = [...minuteColsRef.current.values()].sort((a, b) => a.slotTs - b.slotTs);
          if (mins.length) {
            const metric = gexMetricRef.current;
            const valOf = (c: GexCell) => (metric === "vol" ? c.netVol : c.netOiVol);
            // Session-wide max magnitude → shared radius scale, computed from the
            // minutes BEFORE 15:30 ET only. Into the close, gamma concentrates on 2–3
            // strikes and their |GEX| dwarfs the rest of the day; including them made
            // those few bubbles gigantic and normalized every earlier minute down to
            // nothing. Excluding them means the scale is set by the 15:25-and-earlier
            // session, and the closing strikes just clamp (ratio caps at 1) — so the
            // biggest late bubble is exactly as big as the biggest 3:25 one, never more.
            let sessMax = 0;
            for (const m of mins) {
              if (etMinutesOfDay(m.slotTs) >= BUBBLE_SCALE_CUTOFF_MIN) continue;
              for (const c of m.cells) {
                const a = Math.abs(valOf(c));
                if (a > sessMax) sessMax = a;
              }
            }
            // Fallback: if the buffer holds ONLY post-15:30 minutes (e.g. the page was
            // opened at 3:45), there's no earlier session to scale against — use those
            // minutes rather than draw nothing.
            if (sessMax === 0) {
              for (const m of mins) for (const c of m.cells) {
                const a = Math.abs(valOf(c));
                if (a > sessMax) sessMax = a;
              }
            }
            if (sessMax > 0) {
              const k = bubbleScaleRef.current;
              const rMax = 11 * k;  // px radius at the session max
              const rMin = 0.8 * k; // floor so tiny strikes stay dots
              ctx.save();
              for (const m of mins) {
                const x = ts.timeToCoordinate((m.slotTs / 1000) as UTCTimestamp);
                if (x == null || x < -20 || x > w + 20) continue;
                const mBasis = basisAt(m.slotTs);
                // Rank THIS minute's strikes by |net GEX|. The top 3 are what the
                // eye needs to find instantly — where the gamma actually is — and
                // a pure magnitude ramp buries them: on a quiet minute nothing is
                // near the session max, so every bubble renders small and dim and
                // the levels are indistinguishable. Ranking is per-column and
                // relative, so the leaders always read, in any regime.
                const rank = new Map<number, number>(); // strike → 0|1|2
                [...m.cells]
                  .filter((c) => valOf(c))
                  .sort((a, b) => Math.abs(valOf(b)) - Math.abs(valOf(a)))
                  .slice(0, 3)
                  .forEach((c, i) => rank.set(c.strike, i));
                for (const cell of m.cells) {
                  const v = valOf(cell);
                  if (!v) continue;
                  const y = series.priceToCoordinate(cell.strike + mBasis);
                  if (y == null || y < -20 || y > h + 20) continue;
                  const ratio = Math.min(Math.abs(v) / sessMax, 1);
                  const rk = rank.get(cell.strike);
                  // sqrt → bubble AREA (not radius) tracks |GEX|, which is how
                  // the eye actually reads size. Top-3 get a size boost on top so
                  // they separate from the field even when the whole column is
                  // small relative to the session max.
                  const rankBoost = rk === 0 ? 1.55 : rk === 1 ? 1.32 : rk === 2 ? 1.16 : 1;
                  const r = (rMin + Math.sqrt(ratio) * (rMax - rMin)) * rankBoost;
                  if (r < 0.35) continue;
                  // SOLID fill, no stroke. Magnitude is carried by the COLOR (a
                  // dim→hot ramp) and the radius — not by opacity. Filling at low
                  // alpha and stroking brighter on top made every bubble read as a
                  // ring with a different-colored middle.
                  //
                  // Ramp: deep/desaturated at small |GEX| → full cyan/red at mid →
                  // washed toward white at the top. `t` is gamma-curved (^0.45) to
                  // stretch the LOW end, where most strikes live — a linear ramp
                  // squashed them all into the same dim blue and made adjacent
                  // levels impossible to tell apart.
                  //
                  // The top 3 then get a COLOR FLOOR (they never render below the
                  // full-saturation mid) plus a glow, so "where is the gamma" is
                  // answerable at a glance instead of by comparing dot sizes.
                  const t = Math.pow(ratio, 0.45);
                  const tEff = rk != null ? Math.max(t, rk === 0 ? 0.92 : rk === 1 ? 0.75 : 0.6) : t;
                  const lo = v >= 0 ? [14, 70, 120] : [92, 22, 34];       // dim
                  const mid = v >= 0 ? [41, 182, 246] : [255, 71, 87];    // full
                  const hi = v >= 0 ? [200, 245, 255] : [255, 205, 210];  // hot
                  const mix = (a: number[], b: number[], f: number) =>
                    a.map((x, i) => Math.round(x + (b[i] - x) * f));
                  const c = tEff <= 0.5
                    ? mix(lo, mid, tEff / 0.5)
                    : mix(mid, hi, (tEff - 0.5) / 0.5);
                  ctx.beginPath();
                  ctx.arc(x, y, r, 0, Math.PI * 2);
                  if (rk != null) {
                    // Glow scaled by rank — #1 unmistakable, #3 clearly in the set.
                    ctx.shadowColor = `rgba(${mid[0]},${mid[1]},${mid[2]},0.9)`;
                    ctx.shadowBlur = (rk === 0 ? 12 : rk === 1 ? 8 : 5) * k;
                  } else {
                    ctx.shadowBlur = 0;
                  }
                  // Non-leaders sit back a little so the leaders come forward.
                  ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${rk != null ? 1 : 0.8})`;
                  ctx.fill();
                  ctx.shadowBlur = 0;
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
      if (showMvcLine && mvcHistory.length) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.95)"; // MVC — thick white
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.setLineDash([]);
        const xOf = (t: number) => ts.timeToCoordinate((Math.floor(t / 1000)) as UTCTimestamp);
        let runStartX: number | null = null;
        let runY: number | null = null;
        let prevX: number | null = null;
        const flush = (endX: number | null) => {
          if (runStartX != null && runY != null && endX != null && endX > runStartX) {
            ctx.beginPath(); ctx.moveTo(runStartX, runY); ctx.lineTo(endX, runY); ctx.stroke();
          }
        };
        for (let i = 0; i < mvcHistory.length; i++) {
          const p = mvcHistory[i];
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
    const container = chartRef.current;
    container?.addEventListener("wheel", schedule, { passive: true });
    container?.addEventListener("pointermove", schedule);
    container?.addEventListener("pointerup", schedule);

    return () => {
      cancelAnimationFrame(raf);
      ts.unsubscribeVisibleLogicalRangeChange(schedule);
      ro.disconnect();
      container?.removeEventListener("wheel", schedule);
      container?.removeEventListener("pointermove", schedule);
      container?.removeEventListener("pointerup", schedule);
      drawOverlayRef.current = () => {};
    };
  }, [showHeatmap, showGexBubbles, bubbleScale, intensity, gexMetric, rows, showProfile, profile, showTpo, tpoProfiles, showLevels, mvcHistory]);

  // Safety-net repaint: coalesced rAF tied to the time scale's visible-range
  // change AND a low-rate interval. Data events already call drawOverlayRef
  // directly, so this interval is just a backstop — bumped from 1s to 5s to
  // stop the 1Hz canvas churn that was burning CPU even when nothing changed.
  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    let raf = 0;
    const repaint = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        drawOverlayRef.current();
        drawLanesRef.current();
        updateLiveSpxRef.current();
        railDrawRef.current();
      });
    };
    const tsApi = chart.timeScale();
    tsApi.subscribeVisibleTimeRangeChange(repaint);
    const id = setInterval(repaint, 5_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
      tsApi.unsubscribeVisibleTimeRangeChange(repaint);
    };
  }, []);

  return (
    <div ref={captureRef} className="es-candles-root flex h-full flex-col" style={{ background: HOME_THEME.bg, backgroundImage: HOME_THEME.shellGlow }}>
      {/* data-capture-hide: live-only control chrome. DataBox's captureElement
          drops it from the Snap/Discord PNG and shifts the chart up to close
          the gap — the exported image is chart + title band only. */}
      <div className="px-4 pt-3 pb-1" data-capture-hide style={{ position: "relative", zIndex: 30 }}>
        <FitScale align="center" min={0.2}>
        <Dock className="dock-noscroll" noScroll style={{ minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, lineHeight: 1.2 }}>
            <span className="font-bold uppercase tracking-[0.2em]" style={{ fontSize: 15, color: LIGHT_BLUE, whiteSpace: "nowrap" }}>ES 5m Candles</span>
            {(() => {
              // effectiveBasis() ONLY — never levels.basis. The server basis is
              // esFut-derived and freezes on the expired contract across a roll.
              const basis = effectiveBasis();
              return (
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)", color: HOME_THEME.muted, opacity: 0.75, whiteSpace: "nowrap" }}>
                  ES Basis {basis ? (basis > 0 ? "+" : "") + basis.toFixed(2) : "—"}
                </span>
              );
            })()}
          </div>
          {/* status + count badges */}
          <span style={{ fontSize: 11, fontWeight: 700, padding: "5px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,.08)", color: status === "live" ? "#30d158" : "#94a3b8", whiteSpace: "nowrap", flexShrink: 0 }}>
            {status.toUpperCase()}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, padding: "5px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,.08)", color: "rgba(255,255,255,.7)", whiteSpace: "nowrap", flexShrink: 0 }}>
            {`${rows.length} candles`}
          </span>

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
                    onClick={() => { setSelectedExpiry(opt.value); setDteOpen(false); }}
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

          {/* Overlays checklist dropdown (was 6 inline tiles — overflowed the dock) */}
          <div ref={ovlBoxRef} style={{ flexShrink: 0 }}>
            <DockButton onClick={openOvl} title="Chart overlays">
              <span>Overlays</span>
              {(() => {
                const n = [showHeatmap, showProfile, showTpo, showLevels, showSessions, showRail, showGexBubbles, showVsa].filter(Boolean).length;
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
              className="w-56 py-1"
              style={{ position: "fixed", left: ovlRect.left, top: ovlRect.top, borderRadius: 14, border: `1px solid ${HOME_THEME.border}`, borderTop: `2px solid ${DOCK_THEME.cyanTop}`, background: DOCK_THEME.bg, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", boxShadow: DOCK_THEME.shadow, zIndex: 100000, padding: 6 }}
            >
              {([
                { label: "Heatmap", on: showHeatmap, toggle: () => setShowHeatmap((v) => !v) },
                { label: "Profile", on: showProfile, toggle: () => setShowProfile((v) => !v) },
                { label: "TPO", on: showTpo, toggle: () => setShowTpo((v) => !v) },
                { label: "Levels", on: showLevels, toggle: () => setShowLevels((v) => !v) },
                { label: "PDH/ON", on: showSessions, toggle: () => setShowSessions((v) => !v) },
                { label: "GEX Rail", on: showRail, toggle: () => setShowRail((v) => !v) },
                { label: "Bubbles", on: showGexBubbles, toggle: () => setShowGexBubbles((v) => !v) },
                { label: "VSA", on: showVsa, toggle: () => setShowVsa((v) => !v) },
              ] as const).map((o) => (
                <button
                  key={o.label}
                  onClick={o.toggle}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
                  style={{ borderRadius: 8, border: o.on ? `1px solid ${DOCK_THEME.activeBorder}` : "1px solid transparent", background: o.on ? DOCK_THEME.activeTile : "transparent", color: o.on ? HOME_THEME.cyan : HOME_THEME.text, fontWeight: 600 }}
                  onMouseEnter={(e) => { if (!o.on) e.currentTarget.style.background = DOCK_THEME.hoverTile; }}
                  onMouseLeave={(e) => { if (!o.on) e.currentTarget.style.background = "transparent"; }}
                >
                  <span
                    style={{
                      width: 14, height: 14, flexShrink: 0, borderRadius: 4,
                      border: `1px solid ${o.on ? HOME_THEME.cyan : HOME_THEME.border}`,
                      background: o.on ? HOME_THEME.cyan : "transparent",
                      color: DOCK_THEME.bg, fontSize: 10, lineHeight: "12px", textAlign: "center", fontWeight: 900,
                    }}
                  >
                    {o.on ? "✓" : ""}
                  </span>
                  <span>{o.label}</span>
                </button>
              ))}

              {/* Sub-controls only make sense when their overlay is on */}
              {showHeatmap && (
                <div className="mt-1 px-3 pb-1 pt-2" style={{ borderTop: `1px solid ${HOME_THEME.border}` }} title="Heatmap backfill range">
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.muted, marginBottom: 4 }}>Heatmap range</div>
                  <SegGroup
                    options={[{ label: "1D", value: "1" }, { label: "5D", value: "5" }]}
                    active={String(heatmapDays)}
                    onChange={(v) => setHeatmapDays(Number(v) === 5 ? 5 : 1)}
                  />
                </div>
              )}
              {showGexBubbles && (
                <div className="mt-1 px-3 pb-1 pt-2" style={{ borderTop: `1px solid ${HOME_THEME.border}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.muted, marginBottom: 4 }}>Bubble size</div>
                  <DockSlider label="bubble" value={bubbleScale} min={0.1} max={0.5} step={0.02} onChange={setBubbleScale} title="Bubble size" />
                </div>
              )}
              {showVsa && (
                <div className="mt-1 px-3 pb-1 pt-2" style={{ borderTop: `1px solid ${HOME_THEME.border}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.muted, marginBottom: 4 }}>
                    VSA — effort vs result
                  </div>
                  <div style={{ fontSize: 10, color: HOME_THEME.muted, opacity: 0.65, lineHeight: 1.4, marginBottom: 6 }}>
                    <span style={{ color: VSA_CHURN, fontWeight: 800 }}>■</span> churn: heavy vol, no ground (absorption)<br />
                    <span style={{ color: "rgba(48,209,88,0.6)", fontWeight: 800 }}>■</span> ghost: ground, no vol (unopposed)<br />
                    <span style={{ opacity: 0.7 }}>Volume-based, not delta — no aggressor side.</span>
                  </div>
                  <DockSlider label="hi rvol" value={vsaTuning.hiRvol} min={1.2} max={3} step={0.1} width={70} format={(v) => `${v.toFixed(1)}x`}
                    onChange={(v) => setVsaTuning((t) => ({ ...t, hiRvol: v }))} title="Churn: RVOL at/above this = heavy effort" />
                  <DockSlider label="lo rvol" value={vsaTuning.loRvol} min={0.2} max={1} step={0.05} width={70} format={(v) => `${v.toFixed(2)}x`}
                    onChange={(v) => setVsaTuning((t) => ({ ...t, loRvol: v }))} title="Thin: RVOL at/below this = no effort" />
                  <DockSlider label="sm body" value={vsaTuning.smallBody} min={0.1} max={0.5} step={0.02} width={70}
                    onChange={(v) => setVsaTuning((t) => ({ ...t, smallBody: v }))} title="Churn: body/range at/below this = no ground" />
                  <DockSlider label="big body" value={vsaTuning.bigBody} min={0.5} max={0.95} step={0.02} width={70}
                    onChange={(v) => setVsaTuning((t) => ({ ...t, bigBody: v }))} title="Thin: body/range at/above this = ground gained" />
                  <DockSlider label="lookback" value={vsaTuning.lookbackDays} min={3} max={20} step={1} width={70} format={(v) => `${Math.round(v)}d`}
                    onChange={(v) => setVsaTuning((t) => ({ ...t, lookbackDays: Math.round(v) }))} title="Prior sessions feeding the per-slot volume baseline" />
                </div>
              )}
            </div>,
            document.body
          )}

          <DockGap />

          {/* GEX metric */}
          <SegGroup
            options={[{ label: "Vol+OI", value: "voloi" }, { label: "Vol", value: "vol" }]}
            active={gexMetric}
            onChange={(v) => setGexMetric(v as typeof gexMetric)}
          />

          {/* intensity slider */}
          <DockSlider label="intensity" value={intensity} min={0.1} max={1} step={0.05} onChange={setIntensity} title="Heatmap brightness" />

          <DockButton onClick={refreshTrigger} title="Refresh" style={{ color: refreshStyle.color as string }}>{refreshLabel}</DockButton>
          <BoxSnapBtn targetRef={captureRef} label="ES Candles" />
          <BoxDiscordBtn targetRef={captureRef} label="ES Candles" />
        </Dock>
        </FitScale>
      </div>


      <div className="es-candles-body flex flex-col" style={{ flex: 1, minHeight: 0 }}>
      <div className="es-candles-toggles flex flex-wrap items-stretch gap-2 px-4 pb-2 pt-1">
        {(() => {
          const basis = effectiveBasis();
          const es = (v: number | null) => (v != null ? (v + basis).toFixed(2) : "—");
          // Dissolve stat tile: borderless, faint light-blue radial, blur(20px).
          // Value keeps its semantic color; the tile body carries only highlight.
          const StatBox = ({ c, label, v }: { c: string; label: string; v: number | null }) => (
            <div
              style={{
                flex: "1 1 130px", minWidth: 120,
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                padding: "9px 14px", borderRadius: 16,
                border: "none",
                background: `radial-gradient(circle at 50% 0%, rgba(126,211,252,0.10) 0%, transparent 60%), rgba(13,17,25,0.20)`,
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.6, whiteSpace: "nowrap" }}>{label}</span>
              <span style={{ fontSize: 15, fontWeight: 900, fontFamily: "var(--font-mono)", color: c, whiteSpace: "nowrap" }}>{es(v)}</span>
            </div>
          );
          return (
            <>
              <StatBox c={HOME_THEME.green} label="Call Wall" v={levels.callWall} />
              <StatBox c={SOFT_RED} label="Put Wall" v={levels.putWall} />
              <StatBox c={LIGHT_BLUE} label="Flip" v={levels.gexFlip} />
              <StatBox c={LIGHT_BLUE} label="CB" v={levels.mvc} />

            </>
          );
        })()}
      </div>

      <div className="es-candles-main flex flex-1 flex-row gap-2 px-4 pb-4" style={{ minHeight: 0 }}>
       <div className="es-candles-chartcol flex flex-1 flex-col gap-2" style={{ minWidth: 0 }}>
        {/* Price chart + price-aligned overlay (heatmap, volume profile, VA lines) */}
        <div className="es-candles-chart relative flex-1 overflow-hidden" style={{ ...dissolveCard, minHeight: 320 }}>
          {/* Overlay (heatmap/profile/levels) sits BEHIND the chart so the
              candlesticks always render on the top visible layer. */}
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" style={{ zIndex: 1 }} />
          <div ref={chartRef} className="absolute inset-0" style={{ zIndex: 2 }} />
          {/* SPX equivalent of the live ES price, pinned at the right gutter. */}
          {liveSpx ? (
            <div
              className="pointer-events-none absolute z-10 rounded font-mono font-medium"
              style={{
                top: Math.max(2, liveSpx.y - 9),
                right: 64,
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
                fontSize: 11,
                lineHeight: "12px",
                padding: "3px 6px",
              }}
            >
              SPX {liveSpx.spx.toFixed(2)}
            </div>
          ) : null}
          {/* SPX at the crosshair, follows the cursor's y on the right gutter. */}
          {crossSpx ? (
            <div
              className="pointer-events-none absolute z-10 rounded font-mono"
              style={{
                top: Math.max(2, crossSpx.y - 9),
                right: 64,
                background: "rgba(255,255,255,.85)",
                color: "#001018",
                whiteSpace: "nowrap",
                // Same explicit metrics as the live badge above — see note there.
                fontSize: 11,
                lineHeight: "12px",
                padding: "3px 6px",
              }}
            >
              SPX {crossSpx.spx.toFixed(2)}
            </div>
          ) : null}
          {rows.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50">
              {connected ? "Waiting for live 5m ES candles" : "Loading candles…"}
            </div>
          ) : null}
        </div>
       </div>

        {/* Vertical GEX-by-strike rail, styled like the home GEX chart.
            Auto-hidden when the chart area is too narrow (railFits) so the
            candle chart doesn't get starved down to nothing. */}
        {showRail && railFits ? (
          <div style={{ width: 230, flexShrink: 0, minHeight: 320 }}>
            <EsGexRail
              rows={railRows}
              callWall={levels.callWall}
              putWall={levels.putWall}
              gexFlip={levels.gexFlip}
              spot={levels.spx}
              basis={effectiveBasis()}
              priceToY={priceToY}
              drawRef={railDrawRef}
            />
          </div>
        ) : null}

      </div>
      </div>
    </div>
  );
}
