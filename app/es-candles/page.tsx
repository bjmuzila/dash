"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CandlestickSeries, ColorType, CrosshairMode, LineStyle, createChart } from "lightweight-charts";
import type { UTCTimestamp, IChartApi, ISeriesApi, IPriceLine, CandlestickData } from "lightweight-charts";
import { useEsCandles } from "@/hooks/useEsCandles";
import { useEtfCandles } from "@/hooks/useEtfCandles";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import { useGexSocket, type GexMessage } from "@/lib/gexSocket";
import { dedupeFetch } from "@/lib/dedupeFetch";
// The flip is computed HERE with findGEXFlip, same as the home page, so the two
// pages agree by construction. Do NOT source it from mvc_snapshots.gexFlip: both
// recorders (scripts/auto-snapshot-mvc.js, server-v2/mvc-auto-snapshot.js) fall
// back to `mvcOIRow.strike` when /api/gex omits gexFlip, so that column silently
// holds the CB strike instead of a flip. Steadiness is handled at publish time
// (tick-quantized, 1-min cadence) — not by picking a different source.
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
// classes only. Both classes render HOLLOW — transparent body, colored outline —
// so a signal bar is legible as a signal at a glance and the heatmap / GEX
// bubbles behind the chart stay readable through it. Churn = theme orange,
// thin = its own direction outlined.
const VSA_UP = "#30d158";
const VSA_DOWN = "#ff5b5b";
const VSA_CHURN = HOME_THEME.orange;
const VSA_HOLLOW = "rgba(0,0,0,0)";

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
const ET_HHMM_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const fmtEtHM = (ts: number) => ET_HHMM_FMT.format(new Date(ts));

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
// The chart's candle grid. timeToCoordinate ONLY resolves at these timestamps,
// which is why sub-candle buckets used to vanish. Anything finer than this must
// go through xAt() (see the draw), which interpolates within a bar.
const CANDLE_MS = 300_000;
// Heatmap column bucket. 1-min: snapshots arrive every ~30s, so each column is
// the latest snapshot in that minute. Columns are ~barSpacing/5 px wide and are
// carried forward to the next column's left edge, so the band stays continuous.
const SLOT_MS = 60_000;
function slotFloorMs(ts: number): number {
  return Math.floor(ts / SLOT_MS) * SLOT_MS;
}

// ── Default zoom ─────────────────────────────────────────────────────────────
// The chart opens on the most recent ~4 HOURS, not the whole loaded history.
// fitContent() crushed a full session (plus overnight) into the container, which
// left the candles hairline-thin and — worse — packed the 1-min GEX bubbles so
// tightly they merged into one solid rail. 4h at 5-min bars = 48 candles, which
// is roughly the width where individual bubbles still separate. Anything older
// is one scroll-out away; the user's pan/zoom is never overridden after the
// initial fit (see didFitRef).
const DEFAULT_VIEW_MS = 4 * 60 * 60_000;
const DEFAULT_VIEW_BARS = Math.round(DEFAULT_VIEW_MS / CANDLE_MS);
// Right gutter, in bars, so the newest candle isn't jammed against the price
// axis (fitContent leaves a similar gap).
const DEFAULT_VIEW_RIGHT_PAD = 2;
// Show the last DEFAULT_VIEW_BARS of `barCount` bars. Falls back to fitContent
// when there isn't enough history to fill the window (early premarket, a thin
// replay slice), so a short session still fills the width instead of rendering
// a handful of bars stranded on the right.
function applyDefaultView(chart: IChartApi | null, barCount: number) {
  if (!chart) return;
  const ts = chart.timeScale();
  try {
    if (barCount > DEFAULT_VIEW_BARS) {
      ts.setVisibleLogicalRange({
        from: barCount - DEFAULT_VIEW_BARS,
        to: barCount - 1 + DEFAULT_VIEW_RIGHT_PAD,
      });
    } else {
      ts.fitContent();
    }
  } catch {
    try { ts.fitContent(); } catch { /* ignore */ }
  }
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
/**
 * Reduce one stored GEX column to the rail bars + Call/Put Wall + Flip.
 *
 * Walls = the strikes carrying the largest positive / negative net on the active
 * metric; flip = the zero-cross, computed with findGEXFlip so it agrees with the
 * home page by construction.
 *
 * Two callers, same rule: replay scrubbing (column at the cursor) and the ETF
 * symbols, whose walls have no live websocket to publish them and are therefore
 * derived from the newest recorded column instead. Extracted so those two can't
 * drift into two different definitions of "the wall".
 */
function deriveColumnLevels(
  col: GexColumn | null | undefined,
  metric: GexMetric,
): { railRows: RailRow[]; callWall: number | null; putWall: number | null; gexFlip: number | null } | null {
  if (!col || !col.cells.length) return null;
  const railRows: RailRow[] = col.cells.map((c) => ({
    strike: c.strike, net: metric === "vol" ? c.netVol : c.netOiVol,
  }));
  let callWall: number | null = null, putWall: number | null = null, maxPos = 0, maxNeg = 0;
  for (const r of railRows) {
    if (r.net > maxPos) { maxPos = r.net; callWall = r.strike; }
    if (r.net < maxNeg) { maxNeg = r.net; putWall = r.strike; }
  }
  const gexFlip = findGEXFlip(
    col.cells.map((c) => ({ strike: c.strike, netGEX: c.netOiVol })) as ChainRow[],
    col.spot,
  );
  return { railRows, callWall, putWall, gexFlip };
}

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

// Bubble control config, persisted per browser as one JSON blob (see
// updateBubbleCfg). Sizing/filtering is pure taste, so it shouldn't reset every
// visit. Versioned suffix so a future shape change can invalidate old values.
//   topStrikes  — Show Top Strikes: draw only the N strongest strikes per column
//   highlight   — Highlight Top N Walls: top X of the shown set render dominant (X ≤ N)
//   minSize/maxSize — d3.scaleSqrt radius range in px (area ∝ |GEX|)
//   brightness  — 0..100 opacity gradient steepness for smaller strikes
const BUBBLE_CFG_KEY = "es-candles-bubble-cfg-v1";
type BubbleCfg = { topStrikes: number; highlight: number; minSize: number; maxSize: number; brightness: number };
const BUBBLE_CFG_DEFAULT: BubbleCfg = { topStrikes: 10, highlight: 3, minSize: 0.5, maxSize: 4, brightness: 84 };
const BUBBLE_CFG_KEYS: Array<keyof BubbleCfg> = ["topStrikes", "highlight", "minSize", "maxSize", "brightness"];
// Slider bounds, single-sourced so the UI and the restore clamp can't drift.
// The size ranges are deliberately CENTERED on the defaults (min 0.5 sits mid
// of 0..1, max 4.0 sits mid of 1..7): the useful sizes are all small, so a
// 0..20 / 1..40 range wasted 90% of the travel and made fine tuning at the low
// end impossible. Half a slider of headroom above the default is plenty.
const BUBBLE_CFG_RANGE: Record<keyof BubbleCfg, { min: number; max: number }> = {
  topStrikes: { min: 1, max: 30 },
  highlight: { min: 0, max: 30 },
  minSize: { min: 0, max: 1 },
  maxSize: { min: 1, max: 7 },
  brightness: { min: 0, max: 100 },
};
const clampBubbleVal = (k: keyof BubbleCfg, v: number) =>
  Math.min(BUBBLE_CFG_RANGE[k].max, Math.max(BUBBLE_CFG_RANGE[k].min, v));

// The blob also carries two settings that are NOT slider values and therefore
// live in their own React state: `mins` (the 1m/5m bucket) and `on` (the
// Bubbles overlay toggle). They used to reset on every visit, which is what
// made the whole panel feel like it wasn't saving — the sizes came back but the
// bucket and the on/off didn't, so the chart never looked like you left it.
//
// Both helpers READ-MODIFY-WRITE the single blob. A plain setItem(next) would
// drop whichever keys the caller didn't know about — that's exactly how the
// slider write used to clobber `mins`.
function readBubbleBlob(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(BUBBLE_CFG_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  } catch { return {}; } // private mode / bad blob
}
function writeBubbleBlob(patch: Record<string, unknown>) {
  try { window.localStorage.setItem(BUBBLE_CFG_KEY, JSON.stringify({ ...readBubbleBlob(), ...patch })); } catch { /* ignore */ }
}

// ── "Save default" ──────────────────────────────────────────────────────────
// TWO separate stores, on purpose:
//   BUBBLE_CFG_KEY — the WORKING state. Every slider nudge overwrites it, so
//                    the page always reopens exactly as you left it.
//   BUBBLE_DEF_KEY — the DEFAULT you deliberately pinned. Only "Save default"
//                    writes it; nothing else can trample it.
// Reset restores the pinned default when one exists, and the factory values
// when it doesn't — so you can fiddle freely and always get back to your setup.
//
// Both live in localStorage, which survives a hard refresh (Ctrl+Shift+R only
// re-fetches assets), a browser restart, and a deploy. It is per-browser
// profile, and clearing site data clears it — there is no server-side copy.
const BUBBLE_DEF_KEY = "es-candles-bubble-default-v1";
function readBubbleDefault(): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(BUBBLE_DEF_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p === "object" ? (p as Record<string, unknown>) : null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart symbol
//
// This page was built around ONE instrument: ES futures candles with an SPX
// option overlay, glued together by the ES−SPX basis. SPY and QQQ are a
// different arrangement — the candles and the option strikes are already in the
// same price space, so there is no basis to apply. Rather than fork the page,
// every SPX→ES conversion runs through effectiveBasis(), which returns 0 for a
// non-ES symbol; the conversions become identities and the same render path
// draws both. See effectiveBasis() and `isEs` inside the component.
//
//   gexSymbol — what the GEX history table is keyed by (server-v2 writes '$SPX'
//               for the index feed, the plain ticker for the ETF recorders).
//   candles   — "es" reads the /ws/gex futures stream (useEsCandles); "etf"
//               reads the recorded etf_candles rows (useEtfCandles).
// ─────────────────────────────────────────────────────────────────────────────
type ChartSymbol = "ES" | "SPY" | "QQQ";
type SymbolDef = { key: ChartSymbol; label: string; gexSymbol: string; candles: "es" | "etf" };
const SYMBOLS: SymbolDef[] = [
  { key: "ES",  label: "ES",  gexSymbol: "$SPX", candles: "es"  },
  { key: "SPY", label: "SPY", gexSymbol: "SPY",  candles: "etf" },
  { key: "QQQ", label: "QQQ", gexSymbol: "QQQ",  candles: "etf" },
];
const SYMBOL_KEYS = SYMBOLS.map((s) => s.key);
const symbolDef = (k: ChartSymbol): SymbolDef => SYMBOLS.find((s) => s.key === k) ?? SYMBOLS[0];

const SYMBOL_KEY = "es-candles-symbol-v1";
const FAV_SYMBOLS_KEY = "es-candles-fav-symbols-v1";

function isChartSymbol(v: unknown): v is ChartSymbol {
  return typeof v === "string" && (SYMBOL_KEYS as string[]).includes(v);
}
function loadSymbol(): ChartSymbol {
  if (typeof window === "undefined") return "ES";
  try {
    const raw = window.localStorage.getItem(SYMBOL_KEY);
    return isChartSymbol(raw) ? raw : "ES";
  } catch { return "ES"; }
}
function loadFavSymbols(): ChartSymbol[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAV_SYMBOLS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(isChartSymbol) : [];
  } catch { return []; }
}
function saveFavSymbols(list: ChartSymbol[]): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(FAV_SYMBOLS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

/**
 * Symbol picker — the same searchable, star-to-favorite dropdown the Options
 * Chain page uses for its ticker list (favorites float to the top, persisted in
 * localStorage), restyled to the dock theme so it sits inline with the other
 * dock controls instead of looking like a transplant.
 *
 * Rendered through a portal for the same reason the DTE menu is: the dock lives
 * inside a FitScale transform, and a transformed ancestor makes `position:
 * fixed` resolve against the dock rather than the viewport — an in-flow menu
 * gets scaled and clipped along with the toolbar.
 */
function SymbolListDropdown({ active, onSelect }: { active: ChartSymbol; onSelect: (s: ChartSymbol) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [favs, setFavs] = useState<ChartSymbol[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => { setFavs(loadFavSymbols()); }, []);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = boxRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 4 });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggleFav = (s: ChartSymbol) =>
    setFavs((prev) => {
      const next = prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s];
      saveFavSymbols(next);
      return next;
    });

  const favSet = new Set(favs);
  const q = query.trim().toUpperCase();
  const matches = SYMBOLS.filter((s) => !q || s.key.includes(q) || s.label.toUpperCase().includes(q));
  const favList = matches.filter((s) => favSet.has(s.key));
  const rest = matches.filter((s) => !favSet.has(s.key));
  const rows: Array<{ def?: SymbolDef; fav: boolean; divider?: boolean }> = [
    ...favList.map((def) => ({ def, fav: true })),
    ...(favList.length && rest.length ? [{ fav: false, divider: true }] : []),
    ...rest.map((def) => ({ def, fav: false })),
  ];

  return (
    <div ref={boxRef} style={{ flexShrink: 0 }}>
      <DockButton onClick={() => setOpen((o) => !o)} title="Chart symbol">
        <span style={{ fontWeight: 800, letterSpacing: "0.06em" }}>{symbolDef(active).label}</span>
        <span style={{ opacity: 0.5, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
      </DockButton>
      {open && rect && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed", left: rect.left, top: rect.top, zIndex: 100000, width: 180,
            borderRadius: 14, border: `1px solid ${HOME_THEME.border}`, borderTop: `2px solid ${DOCK_THEME.cyanTop}`,
            background: DOCK_THEME.bg, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
            boxShadow: DOCK_THEME.shadow, padding: 6, overflow: "hidden",
          }}
        >
          <div style={{ paddingBottom: 6 }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              placeholder="Search…"
              spellCheck={false}
              autoComplete="off"
              style={{
                width: "100%", boxSizing: "border-box", fontSize: 11, fontWeight: 700,
                padding: "5px 8px", borderRadius: 8, border: `1px solid ${HOME_THEME.border}`,
                background: DOCK_THEME.hoverTile, color: HOME_THEME.text, outline: "none",
                letterSpacing: "0.06em",
              }}
            />
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {rows.length === 0 && (
              <div style={{ padding: "8px 10px", fontSize: 11, color: HOME_THEME.muted }}>No match</div>
            )}
            {rows.map((row, i) => {
              if (row.divider || !row.def) {
                return <div key={`div-${i}`} style={{ height: 1, background: HOME_THEME.border, margin: "4px 6px" }} />;
              }
              const def = row.def;
              const isActive = def.key === active;
              return (
                <div
                  key={def.key}
                  onClick={() => { onSelect(def.key); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 10px", fontSize: 12, fontWeight: isActive ? 800 : 600,
                    cursor: "pointer", whiteSpace: "nowrap", borderRadius: 8,
                    border: isActive ? `1px solid ${DOCK_THEME.activeBorder}` : "1px solid transparent",
                    background: isActive ? DOCK_THEME.activeTile : "transparent",
                    color: isActive ? HOME_THEME.cyan : HOME_THEME.text,
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = DOCK_THEME.hoverTile; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                >
                  <span
                    onClick={(e) => { e.stopPropagation(); toggleFav(def.key); }}
                    title={row.fav ? "Unfavorite" : "Favorite"}
                    style={{
                      cursor: "pointer", fontSize: 13, lineHeight: 1,
                      color: row.fav ? HOME_THEME.orange : HOME_THEME.muted,
                      opacity: row.fav ? 1 : 0.45,
                    }}
                  >
                    {row.fav ? "★" : "☆"}
                  </span>
                  <span>{def.label}</span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * `leading` renders as the first item in the dock, before the "ES 5m Candles"
 * title. Routed as /es-candles it receives nothing (Next passes params /
 * searchParams, which we ignore) so the page is unchanged; the home dashboard
 * embeds this same component and passes its GEX|ES Candles switcher in, which
 * is why the embed costs no extra toolbar row.
 *
 * `embedded` = rendered inside the home GEX card rather than as its own route:
 *  - dock pins LEFT instead of centering. Centered, the dock indents by however
 *    wide it happens to be, so the switcher in `leading` lands in a different
 *    place than the GexToolbar's copy of it — the button jumps sideways out from
 *    under the cursor on every click.
 *  - overlays start at rail + bubbles, same as the full route, minus the
 *    heatmap. The heatmap is the layer worth dropping here: the card already
 *    sits next to the GEX chart and the heatmap panel, so a third copy of that
 *    read is noise — the rail and bubbles are what the card is FOR.
 * Both are first-render defaults only — every overlay stays toggleable.
 */
export default function EsCandlesPage({ leading, embedded = false }: { leading?: ReactNode; embedded?: boolean } = {}) {
  // Bandwidth gate. Reconnect/backoff moved into lib/gexSocket, so the ref
  // mirror this used to need (read from inside the socket callbacks) is gone.
  const esShouldConnect = useWsLifecycle();

  // ── Active chart symbol ────────────────────────────────────────────────────
  // Persisted, so the picker survives a reload the way the DTE/overlay choices
  // do. Read lazily on mount rather than in useState's initializer: this
  // component is also server-rendered by Next for the /es-candles route, and a
  // localStorage read during the first render would be a hydration mismatch.
  const [symbol, setSymbolState] = useState<ChartSymbol>("ES");
  useEffect(() => { setSymbolState(loadSymbol()); }, []);
  const setSymbol = useCallback((s: ChartSymbol) => {
    setSymbolState(s);
    try { window.localStorage.setItem(SYMBOL_KEY, s); } catch { /* ignore */ }
  }, []);
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

  // historyDays = 2, not the hook's default 20. Nothing on THIS page reads back
  // further than 2 days: the chart window below is 2 days, the heatmap/bubble
  // backfill is capped at 2880min (option_strike_gex_history is pruned to 48h
  // server-side), and sessionCandles is a 30h rolling window. The 20-day pull was
  // ~114KB / 250ms on every load to feed avg5/avg14 — which this page does not
  // even destructure — plus the VSA baseline (see the vsaMap note below).
  // The hook DEFAULT stays 20 so RelVol / IB Logic keep their full baselines.
  const { sessionCandles: liveRows, historical: esHistorical, connected: esConnected, refresh: esRefresh } = useEsCandles(true, 2);
  // ETF bars come over HTTP from the etf_candles recorder, not /ws/gex. Passing
  // "" when ES is active keeps the hook completely idle — no fetch, no interval.
  const { rows: etfRows, connected: etfConnected, refresh: etfRefresh } = useEtfCandles(isEs ? "" : sym.gexSymbol, 5, 5);

  // History feed for the derived layers (VSA baselines, prior-session levels,
  // the ES basis anchor). ES has 20 sessions from SQLite; the ETF side has the
  // 5-day window the recorder backfills, and that same array doubles as its
  // "live" rows since there is no separate streaming source.
  const historical = isEs ? esHistorical : etfRows;
  const connected = isEs ? esConnected : etfConnected;

  // Chart candles: 2-day rolling window, deliberately matched to the GEX
  // retention. The heatmap's historical columns resolve via timeToCoordinate,
  // which only works for timestamps ON the chart's time scale — so the window
  // has to be at least as wide as the overlay. It does NOT need to be wider:
  // option_strike_gex_history is pruned to 48h server-side and the backfill query
  // caps at 2880min, so days 3-5 of the old window carried candles that could
  // never have a GEX column behind them. Merge with the live session so the
  // most-recent bars always win on slotKey collision.
  const rows = useMemo(() => {
    const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - TWO_DAYS_MS;
    const map = new Map<string, EsCandleRecord>();
    for (const c of historical) if (c.slotKey && c.timestamp >= cutoff) map.set(c.slotKey, c);
    // ETF rows have no second live stream to merge — `historical` already IS the
    // recorded series, refreshed on the hook's interval.
    if (isEs) for (const c of liveRows) if (c.slotKey) map.set(c.slotKey, c); // live wins
    return [...map.values()].sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey));
  }, [historical, liveRows, isEs]);
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
  // Same 1-min resolution as columnsRef, but TODAY only — the bubble trail is a
  // session view and never backfills past days.
  const minuteColsRef = useRef<Map<number, GexColumn>>(new Map());
  // Dedupe key for the heatmap backfill fetch: front mode ignores `expiry`
  // server-side, so the rolling feedExpiry must not re-fire the ~700KB/5s call.
  const lastHeatmapKeyRef = useRef<string>("");
  // The backfill key MINUS the poll counter (see the wipe rule in the backfill
  // effect): what is being requested, vs merely when. A change here means the
  // columns already in memory are the wrong data and must be wiped; a change to
  // the poll counter alone is a refresh and merges.
  const lastHeatmapShapeRef = useRef<string>("");
  // ET day the bubble map currently holds. Bubbles are single-day, so a
  // rollover (or a replay-day switch) has to wipe minuteColsRef even when the
  // request shape is unchanged — see the same rule.
  const lastBubbleDayRef = useRef<string>("");
  const bubbleCfgRef = useRef<BubbleCfg>(BUBBLE_CFG_DEFAULT);
  const bubbleMinsRef = useRef(5);
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
  const [vsaTuning, setVsaTuning] = useState<VsaTuning>(VSA_DEFAULTS);
  // VSA classification for the visible bars. MUST stay below the showVsa /
  // vsaTuning declarations above: it closes over both, and hoisting it up beside
  // the other `rows` memos put it in their temporal dead zone — which typechecks
  // and dev-renders fine, then dies only in the prerender as
  // "Cannot access 'aA' before initialization".
  // Baseline comes from `historical` rather than `rows` so the per-slot median
  // sees every session that was loaded, not just what's on screen.
  //
  // CAVEAT: `historical` is now a 2-day pull (see the useEsCandles call above),
  // so this median is built from ~2 prior sessions instead of ~20. VSA still
  // classifies, but its thin/wide-spread calls are noisier than they were. If
  // that starts mattering, make the pull follow the toggle:
  //     useEsCandles(true, showVsa ? 20 : 2)
  // — VSA defaults OFF, so the deep pull would only be paid when it's actually on.
  const vsaMap = useMemo(() => {
    if (!showVsa) return new Map<string, VsaResult>();
    // The bar covering "now" has partial volume and would always read as thin.
    const formingBefore = Date.now() - 5 * 60 * 1000;
    return classifyBars(rows, historical, vsaTuning, formingBefore);
  }, [showVsa, rows, historical, vsaTuning]);
  const [showLevels, setShowLevels] = useState(false);  // Call/Put/Flip/MVC dashed lines + MVC step line
  const [showSessions, setShowSessions] = useState(false); // prior-day + overnight H/L
  // Right-side vertical GEX-by-strike rail. On by default EVERYWHERE, including
  // the home card (`embedded`) — the rail + bubbles are the default read. If the
  // chart area is too narrow for it, `railFits` still auto-collapses it below.
  const [showRail, setShowRail] = useState(true);
  // Per-strike 1-minute GEX bubbles. Radius ∝ |net GEX|
  // at that strike in that minute, normalized to the session max so the bubble
  // trail shows gamma building/bleeding at each level through the day.
  const [showGexBubbles, setShowGexBubbles] = useState(true);
  // Bubble controls: Show Top Strikes (N) + Highlight Top N Walls (X≤N) filter
  // WHICH strikes draw; Min/Max Bubble Size (scaleSqrt range) + Brightness
  // (opacity gradient) control HOW they draw. Persisted as one blob.
  const [bubbleCfg, setBubbleCfg] = useState<BubbleCfg>(BUBBLE_CFG_DEFAULT);
  // Bubble time bucket. Storage is always 1-min; this aggregates at DRAW time.
  // At 1m the bubbles sit ~barSpacing/5 px apart and overlap into solid rails —
  // 5m spaces them one per candle, which is why it's the default.
  const [bubbleMins, setBubbleMins] = useState<1 | 5>(5);
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
  // Distinct ET days present in the rolling window, oldest→newest.
  const replayDays = useMemo(
    () => [...new Set(rows.map((r) => r.date).filter(Boolean))].sort() as string[],
    [rows],
  );
  // Resolve the active day: explicit pick, else the newest day with bars.
  const activeReplayDay = (replayDay && replayDays.includes(replayDay))
    ? replayDay
    : (replayDays.length ? replayDays[replayDays.length - 1] : "");
  // Frames = the active ET day's bar timestamps, oldest→newest.
  const replayFrames = useMemo(() => {
    if (!activeReplayDay) return [] as number[];
    return rows.filter((r) => r.date === activeReplayDay).map((r) => r.timestamp);
  }, [rows, activeReplayDay]);
  const replayTs = replayOn && replayFrames.length
    ? replayFrames[Math.min(replayIdx, replayFrames.length - 1)]
    : null;
  useEffect(() => { replayOnRef.current = replayOn; }, [replayOn]);
  useEffect(() => { replayTsRef.current = replayTs; }, [replayTs]);
  // Keep the cursor in range as live bars extend the session.
  useEffect(() => {
    if (replayIdx > replayFrames.length - 1) setReplayIdx(Math.max(0, replayFrames.length - 1));
  }, [replayFrames.length, replayIdx]);
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
    return deriveColumnLevels(col, gexMetricRef.current);
  })();
  const replayGexRef = useRef(replayGex);
  replayGexRef.current = replayGex;
  // Play loop: advance one bar per tick, stop at the last frame.
  useEffect(() => {
    if (!replayOn || !replayPlaying || replayFrames.length === 0) return;
    const ms = Math.max(60, Math.round(1000 / Math.max(1, replaySpeed)));
    const id = setInterval(() => {
      setReplayIdx((i) => {
        if (i >= replayFrames.length - 1) { setReplayPlaying(false); return i; }
        return i + 1;
      });
    }, ms);
    return () => clearInterval(id);
  }, [replayOn, replayPlaying, replaySpeed, replayFrames.length]);
  // Restore the saved bubble config. Read in an effect (not a lazy useState
  // initializer) so SSR and the first client render agree. Merged over defaults
  // so a partial/older blob still yields a complete, valid config.
  useEffect(() => {
    const p = readBubbleBlob();
    // Slider values: copy ONLY the known numeric keys. Spreading the whole blob
    // would inject `mins` / `on` into bubbleCfg and give them two owners.
    const patch: Partial<BubbleCfg> = {};
    for (const k of BUBBLE_CFG_KEYS) {
      const v = p[k];
      // Clamp on read: a blob saved under the older, much wider size ranges can
      // hold values (e.g. maxSize 20) that no longer exist on the slider, which
      // would render as a pinned handle you couldn't explain.
      if (typeof v === "number" && Number.isFinite(v)) patch[k] = clampBubbleVal(k, v);
    }
    if (Object.keys(patch).length) setBubbleCfg((c) => ({ ...c, ...patch }));
    // The two non-slider settings.
    if (p.mins === 1 || p.mins === 5) setBubbleMins(p.mins);
    if (typeof p.on === "boolean") setShowGexBubbles(p.on);
  }, []);
  // Patch the config with slider constraints enforced, then persist:
  //   • Highlight can't exceed Show Top Strikes (lowering N pulls X down).
  //   • Min size can't exceed Max size (and vice versa).
  const updateBubbleCfg = useCallback((patch: Partial<BubbleCfg>) => {
    setBubbleCfg((prev) => {
      const next: BubbleCfg = { ...prev, ...patch };
      if (next.maxSize < next.minSize) {
        if ("minSize" in patch) next.maxSize = next.minSize; else next.minSize = next.maxSize;
      }
      next.highlight = Math.max(0, Math.min(next.highlight, next.topStrikes));
      writeBubbleBlob({ ...next }); // merge — must not drop `mins` / `on`
      return next;
    });
  }, []);
  // The 1m/5m bucket and the Bubbles on/off both persist into the same blob, so
  // the panel comes back exactly as you left it.
  const updateBubbleMins = useCallback((m: 1 | 5) => { setBubbleMins(m); writeBubbleBlob({ mins: m }); }, []);
  const updateShowBubbles = useCallback((on: boolean) => { setShowGexBubbles(on); writeBubbleBlob({ on }); }, []);
  // Pin the current panel as the default. Snapshots the sliders + the 1m/5m
  // bucket; the on/off toggle is deliberately NOT part of a default (you turn
  // the overlay on and off constantly — that's working state, not a preset).
  const [defSavedFlash, setDefSavedFlash] = useState(false);
  const defFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveBubbleDefault = useCallback(() => {
    try { window.localStorage.setItem(BUBBLE_DEF_KEY, JSON.stringify({ ...bubbleCfg, mins: bubbleMins })); } catch { /* ignore */ }
    setDefSavedFlash(true);
    if (defFlashTimer.current) clearTimeout(defFlashTimer.current);
    defFlashTimer.current = setTimeout(() => setDefSavedFlash(false), 1600);
  }, [bubbleCfg, bubbleMins]);
  useEffect(() => () => { if (defFlashTimer.current) clearTimeout(defFlashTimer.current); }, []);
  // Reset → the pinned default if there is one, else the factory values.
  const resetBubbleCfg = useCallback(() => {
    const saved = readBubbleDefault();
    const next: BubbleCfg = { ...BUBBLE_CFG_DEFAULT };
    let mins: 1 | 5 = 5;
    if (saved) {
      for (const k of BUBBLE_CFG_KEYS) {
        const v = saved[k];
        if (typeof v === "number" && Number.isFinite(v)) next[k] = clampBubbleVal(k, v);
      }
      if (saved.mins === 1 || saved.mins === 5) mins = saved.mins;
    }
    setBubbleCfg(next);
    setBubbleMins(mins);
    writeBubbleBlob({ ...next, mins });
  }, []);
  // Mirrored into refs so the imperative overlay draw reads them without
  // re-subscribing. Must stay BELOW the useState above (see bubbleCfgRef).
  useEffect(() => { bubbleCfgRef.current = bubbleCfg; }, [bubbleCfg]);
  useEffect(() => { bubbleMinsRef.current = bubbleMins; }, [bubbleMins]);
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
  useGexSocket(esShouldConnect, onGexFrame);

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
    const derived = deriveColumnLevels(newest, gexMetric);
    return derived ? { ...derived, spot: newest?.spot ?? null } : null;
  }, [isEs, gexVersion, gexMetric]);

  // Heatmap history backfill. Effective expiry = the DTE picker selection, or
  // the live front expiry when nothing is picked. Re-runs whenever the picker
  // OR the 1D/5D range toggle changes: clears the column map and reloads.
  const heatmapExpiry = selectedExpiry || feedExpiry;
  useEffect(() => {
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
    const minutes = Math.min(2880, replayOn ? 2880 : heatmapDays * 1440);
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
    const shapeKey = `${sym.gexSymbol}|${isFront ? "front" : queryExpiry}|${minutes}|${activeReplayDay ?? ""}`;
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
    const dayKeyNow = replayOn && activeReplayDay ? activeReplayDay : etDayKey(Date.now());
    const shapeChanged = shapeKey !== lastHeatmapShapeRef.current;
    const dayChanged = dayKeyNow !== lastBubbleDayRef.current;
    lastHeatmapShapeRef.current = shapeKey;
    lastBubbleDayRef.current = dayKeyNow;
    if (shapeChanged) {
      columnsRef.current.clear();
      minuteColsRef.current.clear();
      drawOverlayRef.current();
    } else if (dayChanged) {
      minuteColsRef.current.clear();
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
        const res = await dedupeFetch(
          `/api/snapshots/option-strike-gex-history?mode=heatmap&minutes=${minutes}&expiry=${encodeURIComponent(queryExpiry)}${isFront ? "&anyExpiry=1" : ""}&symbol=${encodeURIComponent(sym.gexSymbol)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const json = await res.json();
        // History persists both net_gex (OI+vol) and net_vol_gex (vol-only), so
        // the Vol-only heatmap mode now has backfill too. netVol falls back to 0
        // for legacy rows written before the column existed.
        type RawCol = { slotTs: number; cells: Array<{ strike: number; net: number; netVol?: number }>; spot?: number };
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
        // Bubbles are single-day: live → today, replay → the day being scrubbed.
        const targetKey = replayOn && activeReplayDay ? activeReplayDay : etDayKey(Date.now());
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
        // Rows are in — let the derived walls/flip republish off them.
        setGexVersion((v) => v + 1);
        drawOverlayRef.current();
      } catch { /* live feed still populates the front expiry going forward */ }
    })();
    // No cleanup cancel: a same-key re-render must not abort a valid in-flight
    // backfill; the resolution-time key check handles real invalidation.
  }, [heatmapExpiry, heatmapDays, replayOn, activeReplayDay, selectedExpiry, sym.gexSymbol, gexPoll]);

  // Load today's full MVC history (raw SPX strikeOIVol) and refresh every 60s.
  // ES conversion happens at draw time with the live basis.
  //
  // SPX-ONLY. mvc_snapshots records the SPX central-band strike; there is no
  // SPY/QQQ equivalent, and plotting SPX strike levels on a SPY chart would put
  // a line ~10x off-scale. On a non-ES symbol this clears the series instead.
  useEffect(() => {
    if (!isEs) { setMvcHistory([]); return; }
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
  }, [isEs]);


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
        // Borders ON, in the SAME color as the fills. Normal candles look
        // identical to the old borderVisible:false rendering (a 1px border over
        // a matching body is invisible), but a per-bar `color: transparent` +
        // `borderColor` can now render a hollow candle — which is how the VSA
        // signal bars are drawn. borderVisible:false would swallow the outline
        // and leave those bars as empty gaps.
        borderVisible: true,
        borderUpColor: "#30d158",
        borderDownColor: "#ff5b5b",
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
    const candleData: CandlestickData[] = srcRows.map((row) => {
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
        // Effort with no ground: hollow orange. NOTE the wick is orange too, not
        // tinted by closePos as it was when the body was solid — a churn bar is
        // small-body BY DEFINITION (bodyPct <= smallBody), so once hollow it is
        // almost all wick. A green/red wick would have made the bar read as a
        // normal candle and buried the one thing it is there to say.
        return { ...base, color: VSA_HOLLOW, borderColor: VSA_CHURN, wickColor: VSA_CHURN };
      }
      // Ground with no effort: hollow, in its own direction. This is the classic
      // hollow-candle idiom — same move, no one behind it.
      const dir = row.close >= row.open ? VSA_UP : VSA_DOWN;
      return { ...base, color: VSA_HOLLOW, borderColor: dir, wickColor: dir };
    });

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
    drawLanesRef.current();
    railDrawRef.current();
  }, [rows, showVsa, vsaMap, replayTs]);

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
  }, [isEs]);

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
            return deriveColumnLevels(newest, gexMetricRef.current)
              ?? { callWall: null, putWall: null, gexFlip: null };
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
  }, [lineLevels, showLevels, showSessions, sessionLevels, showIb, ibLevels]);

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
      // only at candle timestamps (CANDLE_MS grid) and returns null everywhere
      // else — that's why 1-min data only rendered every 5 minutes. Anchor on the
      // containing candle, then offset by the sub-bar fraction × barSpacing.
      const barSpacing = (() => {
        try { return ts.options().barSpacing ?? 6; } catch { return 6; }
      })();
      const xAt = (tMs: number): number | null => {
        const grid = Math.floor(tMs / CANDLE_MS) * CANDLE_MS;
        const c0 = ts.timeToCoordinate((grid / 1000) as UTCTimestamp);
        if (c0 == null) return null; // no candle there (gap / off-screen)
        const frac = (tMs - grid) / CANDLE_MS;
        return c0 + frac * barSpacing;
      };

      // Slot → [leftX, width] in screen px. Null if the slot isn't on screen.
      const slotX = (slotTs: number): { left: number; w: number } | null => {
        const x0 = xAt(slotTs);
        if (x0 == null) return null;
        const xEndRaw = xAt(slotTs + SLOT_MS);
        const x1 = xEndRaw != null ? xEndRaw : x0 + barSpacing / (CANDLE_MS / SLOT_MS);
        return { left: Math.min(x0, x1), w: Math.max(1, Math.abs(x1 - x0)) };
      };

      // ── 1) GEX heatmap cells ──
      // Rendered to an offscreen buffer, then composited back through a blur so
      // adjacent strike/time cells melt into smooth bands instead of hard tiles.
      if (showHeatmap) {
        const cols = [...columnsRef.current.values()]
          .filter((c) => replayTsRef.current == null || c.slotTs <= replayTsRef.current)
          .sort((a, b) => a.slotTs - b.slotTs);
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
            // CULL to the visible plot. slotX only returns null for times the
            // chart doesn't know about — a column scrolled off the left edge still
            // resolves to an off-screen coordinate, so without this every stored
            // column ran the full per-cell loop (~200 strikes × 2 priceToCoordinate
            // + a fillRect each) to paint nothing. At 5D/1-min that's ~1950 columns
            // of work per frame to show the ~40 on screen. Must come AFTER the
            // carry-forward above (that's what sets the real width).
            if (sx.left + sx.w < -2 || sx.left > hmPlotRight + 2) continue;
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
        // minute; radius ∝ √|net GEX| at that strike, normalized to the max |GEX|
        // seen across ALL minutes in the buffer (a session-wide scale) so the
        // trail reads as gamma building/bleeding over time. The Strikes/Size/
        // Brightness sliders (bubbleCfg) control which strikes draw and how.
        if (showGexBubbles) {
          // Aggregate the 1-min store into the selected bucket. At 5m we keep the
          // LAST minute in each bucket (the freshest read of that strike's gamma),
          // not a mean — averaging smears the very spikes we're trying to show.
          const bucketMs = bubbleMinsRef.current * 60_000;
          const byBucket = new Map<number, GexColumn>();
          for (const m of [...minuteColsRef.current.values()].sort((a, b) => a.slotTs - b.slotTs)) {
            if (replayTsRef.current != null && m.slotTs > replayTsRef.current) continue; // replay clamp
            byBucket.set(Math.floor(m.slotTs / bucketMs) * bucketMs, m);
          }
          const mins = [...byBucket.values()].sort((a, b) => a.slotTs - b.slotTs);
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
              const cfg = bubbleCfgRef.current;
              // scaleSqrt DOMAIN: [0, max |GEX| KNOWN AS OF THAT BUCKET]. RANGE:
              // [minSize, maxSize] px. sqrt so bubble AREA (not radius) tracks |GEX|.
              //
              // EXPANDING WINDOW, not session-wide: a bucket is normalized against
              // the max seen up to and including itself, so a divisor can never grow
              // after the fact and an already-printed bubble can never shrink. A
              // strong 10:00 wall stays exactly as fat at 15:50 as it was at 10:00;
              // a bigger wall later just clamps (ratio caps at 1) from its own bucket
              // forward. Floored at 15% of sessMax so the first few buckets of the
              // day — where acc is tiny — don't all render at maxSize.
              const runMax = new Map<number, number>();
              {
                let acc = 0;
                for (const m of mins) {
                  if (etMinutesOfDay(m.slotTs) < BUBBLE_SCALE_CUTOFF_MIN) {
                    for (const c of m.cells) {
                      const a = Math.abs(valOf(c));
                      if (a > acc) acc = a;
                    }
                  }
                  runMax.set(m.slotTs, Math.max(acc, sessMax * 0.15));
                }
              }
              const sizeSpan = cfg.maxSize - cfg.minSize;
              // Brightness gradient: intensity 0..1 → the SMALLEST strike's opacity
              // = max(0.1, 1 - intensity). 0% ⇒ min 1.0 (flat, no gradient); 90% ⇒
              // small strikes ~0.1 so the big walls dominate by contrast.
              const brightness01 = Math.max(0, Math.min(1, cfg.brightness / 100));
              const minOpacity = Math.max(0.1, 1 - brightness01);
              const HIGHLIGHT_BOOST = 1.35; // highlighted walls' radius multiplier

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
              const peakSoFar = new Map<number, number>();
              const shownAt = new Map<number, Set<number>>();
              const wallAt = new Map<number, Set<number>>();
              for (const m of mins) {
                for (const c of m.cells) {
                  const a = Math.abs(valOf(c));
                  if (a > 0 && a > (peakSoFar.get(c.strike) ?? 0)) peakSoFar.set(c.strike, a);
                }
                const ranked = [...peakSoFar.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
                shownAt.set(m.slotTs, new Set(ranked.slice(0, Math.max(0, cfg.topStrikes))));
                wallAt.set(m.slotTs, new Set(ranked.slice(0, Math.max(0, cfg.highlight))));
              }

              ctx.save();
              for (const m of mins) {
                // xAt, not timeToCoordinate: 1-min buckets on a 5-min grid. Snap x
                // to the bucket grid so the newest column lands on its candle, not
                // in the right-axis gap ("newest bubbles render strange").
                const x = xAt(Math.floor(m.slotTs / bucketMs) * bucketMs);
                if (x == null || x < -20 || x > w + 20) continue;
                const mBasis = basisAt(m.slotTs);
                // Per-bucket scale + row filter — both frozen at print time.
                const domainMax = runMax.get(m.slotTs) || sessMax;
                const shownStrikes = shownAt.get(m.slotTs);
                const wallStrikes = wallAt.get(m.slotTs);
                if (!shownStrikes || !wallStrikes) continue;
                for (const cell of m.cells) {
                  if (!shownStrikes.has(cell.strike)) continue; // as-of-bucket row filter
                  const v = valOf(cell);
                  if (!v) continue;
                  const y = series.priceToCoordinate(cell.strike + mBasis);
                  if (y == null || y < -20 || y > h + 20) continue;
                  const ratio = Math.min(Math.abs(v) / domainMax, 1);
                  const isHi = wallStrikes.has(cell.strike);
                  // Size tracks THIS bubble's own |GEX| (√-scaled), so each tube
                  // tapers as gamma builds/bleeds; walls sit near maxSize + a boost.
                  let r = cfg.minSize + Math.sqrt(ratio) * sizeSpan;
                  if (isHi) r *= HIGHLIGHT_BOOST;
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
                  ctx.beginPath();
                  ctx.arc(x, y, r, 0, Math.PI * 2);
                  if (isHi) {
                    ctx.shadowColor = `rgba(${base[0]},${base[1]},${base[2]},0.95)`;
                    ctx.shadowBlur = 16;
                  } else {
                    ctx.shadowBlur = 0;
                  }
                  ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${opacity})`;
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
  }, [showHeatmap, showGexBubbles, bubbleCfg, bubbleMins, intensity, gexMetric, rows, showProfile, profile, showTpo, tpoProfiles, showLevels, showFlipCross, mvcHistory]);

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
      {/* The dock STAYS in the Snap/Discord PNG (no data-capture-hide). It used
          to be dropped, but dropping a direct child above the chart makes
          captureElement's hiddenShift exceed the 44px title band, so the chart
          composited UP and the candles rendered underneath the watermark. Kept
          in flow, the exported image reads: watermark band → toolbar → chart.
          data-capture-hide is still applied per-control below to the pieces
          that are meaningless in a static image (Snap/Discord buttons). */}
      <div className="px-4 pt-3 pb-1" style={{ position: "relative", zIndex: 30 }}>
        <FitScale align={embedded ? "left" : "center"} min={0.2}>
        <Dock className="dock-noscroll" noScroll style={{ minWidth: 0 }}>
          {leading}
          {leading && <DockGap />}
          <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, lineHeight: 1.2 }}>
            <span className="font-bold uppercase tracking-[0.2em]" style={{ fontSize: 14, color: LIGHT_BLUE, whiteSpace: "nowrap" }}>{sym.label} 5m Candles</span>
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

          {/* Symbol picker — ES / SPY / QQQ, favorites persisted per browser */}
          <SymbolListDropdown active={symbol} onSelect={setSymbol} />

          {/* status + count badges */}
          <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,.08)", color: status === "live" ? "#30d158" : "#94a3b8", whiteSpace: "nowrap", flexShrink: 0 }}>
            {status.toUpperCase()}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, padding: "5px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,.08)", color: "rgba(255,255,255,.7)", whiteSpace: "nowrap", flexShrink: 0 }}>
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
                const n = [showHeatmap, showProfile, showTpo, showLevels, showSessions, showRail, showGexBubbles, showVsa, showFlipCross].filter(Boolean).length;
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
                { label: "Bubbles", on: showGexBubbles, toggle: () => updateShowBubbles(!showGexBubbles) },
                { label: "Flip X", on: showFlipCross, toggle: () => setShowFlipCross((v) => !v) },
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
                    options={[{ label: "1D", value: "1" }, { label: "2D", value: "2" }]}
                    active={String(heatmapDays)}
                    onChange={(v) => setHeatmapDays(Number(v) === 2 ? 2 : 1)}
                  />
                </div>
              )}
              {showGexBubbles && (
                <div className="mt-1 px-3 pb-1 pt-2" style={{ borderTop: `1px solid ${HOME_THEME.border}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.muted, marginBottom: 4 }}>Strikes shown</div>
                  <DockSlider
                    label="top" value={bubbleCfg.topStrikes} min={1} max={30} step={1}
                    format={(v) => v.toFixed(0)} onChange={(v) => updateBubbleCfg({ topStrikes: Math.round(v) })}
                    title="Show Top Strikes — draw only the N strongest strikes (by |GEX|) per column"
                  />
                  <DockSlider
                    label="highlight" value={bubbleCfg.highlight} min={0} max={bubbleCfg.topStrikes} step={1}
                    format={(v) => v.toFixed(0)} onChange={(v) => updateBubbleCfg({ highlight: Math.round(v) })}
                    title="Highlight Top N Walls — the strongest X of the shown strikes render larger, brighter, glowing (can't exceed Top)"
                  />
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.muted, margin: "8px 0 4px" }}>Bubble size</div>
                  <DockSlider
                    label="min" value={bubbleCfg.minSize} min={BUBBLE_CFG_RANGE.minSize.min} max={BUBBLE_CFG_RANGE.minSize.max} step={0.05}
                    format={(v) => v.toFixed(2)} onChange={(v) => updateBubbleCfg({ minSize: v })}
                    title="Min bubble radius (px) — the size of the smallest strike (can't exceed Max). Default 0.50 = center of the slider"
                  />
                  <DockSlider
                    label="max" value={bubbleCfg.maxSize} min={BUBBLE_CFG_RANGE.maxSize.min} max={BUBBLE_CFG_RANGE.maxSize.max} step={0.1}
                    format={(v) => v.toFixed(1)} onChange={(v) => updateBubbleCfg({ maxSize: v })}
                    title="Max bubble radius (px) — the size of the largest wall (√-scaled so area ∝ |GEX|)"
                  />
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.muted, margin: "8px 0 4px" }}>Brightness</div>
                  <DockSlider
                    label="bright" value={bubbleCfg.brightness} min={0} max={100} step={1}
                    format={(v) => `${v.toFixed(0)}%`} onChange={(v) => updateBubbleCfg({ brightness: Math.round(v) })}
                    title="Brightness gradient — 0% = every strike full opacity; higher fades smaller strikes so walls dominate"
                  />
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.muted, margin: "8px 0 4px" }}>Bubble time</div>
                  <SegGroup
                    options={[{ label: "1m", value: "1" }, { label: "5m", value: "5" }]}
                    active={String(bubbleMins)}
                    onChange={(v) => updateBubbleMins(Number(v) === 1 ? 1 : 5)}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${HOME_THEME.border}` }}>
                    <button
                      onClick={saveBubbleDefault}
                      title="Pin the current sliders + bucket as your default. Survives a hard refresh; Reset comes back here."
                      style={{
                        fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase",
                        padding: "3px 9px", borderRadius: 6, cursor: "pointer", fontWeight: 700,
                        border: `1px solid ${DOCK_THEME.activeBorder}`, background: DOCK_THEME.activeTile, color: HOME_THEME.cyan,
                      }}
                    >
                      Save default
                    </button>
                    <button
                      onClick={resetBubbleCfg}
                      title="Restore your saved default (or the factory values if you haven't saved one)"
                      style={{
                        fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase",
                        padding: "3px 9px", borderRadius: 6, cursor: "pointer",
                        border: `1px solid ${HOME_THEME.border}`, background: "transparent", color: HOME_THEME.muted,
                      }}
                    >
                      Reset
                    </button>
                    <span style={{ marginLeft: "auto", fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", color: defSavedFlash ? "#1FD98A" : HOME_THEME.muted, opacity: defSavedFlash ? 1 : 0.55, transition: "opacity .2s, color .2s" }}>
                      {defSavedFlash ? "saved ✓" : "auto-saved"}
                    </span>
                  </div>
                </div>
              )}
              {showVsa && (
                <div className="mt-1 px-3 pb-1 pt-2" style={{ borderTop: `1px solid ${HOME_THEME.border}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.muted, marginBottom: 4 }}>
                    VSA — effort vs result
                  </div>
                  <div style={{ fontSize: 10, color: HOME_THEME.muted, opacity: 0.65, lineHeight: 1.4, marginBottom: 6 }}>
                    <span style={{ color: VSA_CHURN, fontWeight: 800 }}>▢</span> churn: heavy vol, no ground (absorption)<br />
                    <span style={{ color: VSA_UP, fontWeight: 800 }}>▢</span> hollow: ground, no vol (unopposed)<br />
                    <span style={{ opacity: 0.7 }}>Signal bars are hollow. Volume-based, not delta — no aggressor side.</span>
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

          <DockButton
            onClick={() => { const nv = !replayOn; setReplayOn(nv); setReplayPlaying(false); if (nv) { setReplayIdx(0); setReplayDay(null); } }}
            title="Replay this session — reveal candles + gamma from the open forward"
            style={{ color: replayOn ? HOME_THEME.cyan : undefined }}
          >
            <span>Replay</span>
          </DockButton>

          <DockButton onClick={refreshTrigger} title="Refresh" style={{ color: refreshStyle.color as string }}>{refreshLabel}</DockButton>
          {/* The dock itself now stays in the capture, so the capture-triggering
              controls hide themselves — they'd be dead pixels in the PNG. Not
              direct children of captureRef, so they don't affect hiddenShift. */}
          <span data-capture-hide><BoxSnapBtn targetRef={captureRef} label="ES Candles" /></span>
          <span data-capture-hide><BoxDiscordBtn targetRef={captureRef} label="ES Candles" /></span>
        </Dock>
        </FitScale>
      </div>


      <div className="es-candles-body flex flex-col" style={{ flex: 1, minHeight: 0 }}>
      {replayOn && (
        <div
          className="es-candles-replay flex flex-wrap items-center gap-3 px-4 pt-2 pb-2"
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
            return (
              <div className="flex items-center gap-1">
                <DockButton onClick={() => { if (di > 0) go(replayDays[di - 1]); }} title="Previous day"><span>◀</span></DockButton>
                <span style={{ fontSize: 12, fontWeight: 800, fontFamily: "var(--font-mono)", color: HOME_THEME.cyan, minWidth: 78, textAlign: "center", whiteSpace: "nowrap" }}>{fmtDay(activeReplayDay)}</span>
                <DockButton onClick={() => { if (di >= 0 && di < replayDays.length - 1) go(replayDays[di + 1]); }} title="Next day"><span>▶</span></DockButton>
              </div>
            );
          })()}
          {replayFrames.length === 0 ? (
            <span style={{ fontSize: 12, color: HOME_THEME.muted }}>No bars for this day — step ◀ / ▶ to another session.</span>
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
      )}
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
                background: `rgba(13,17,25,0.20)`,
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.6, whiteSpace: "nowrap" }}>{label}</span>
              <span style={{ fontSize: 14, fontWeight: 900, fontFamily: "var(--font-mono)", color: c, whiteSpace: "nowrap" }}>{es(v)}</span>
            </div>
          );
          return (
            <>
              {/* Same source precedence as the rail and the price lines: on
                  SPY/QQQ the walls come from the recorded column, because
                  `levels` is the SPX websocket. CB has no ETF equivalent —
                  mvc_snapshots is SPX-only — so it reads blank rather than
                  showing the last SPX value frozen under a SPY chart. */}
              <StatBox c={HOME_THEME.green} label="Call Wall" v={etfGex ? etfGex.callWall : levels.callWall} />
              <StatBox c={SOFT_RED} label="Put Wall" v={etfGex ? etfGex.putWall : levels.putWall} />
              <StatBox c={LIGHT_BLUE} label="Flip" v={etfGex ? etfGex.gexFlip : levels.gexFlip} />
              <StatBox c={LIGHT_BLUE} label="CB" v={isEs ? levels.mvc : null} />

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
          {/* SPX equivalent of the live ES price, pinned at the right gutter.
              ES-only: off ES the basis is 0, so these would just restate the
              price already on the axis under a misleading "SPX" label. */}
          {isEs && liveSpx ? (
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
                fontSize: 12,
                lineHeight: "12px",
                padding: "3px 6px",
              }}
            >
              SPX {liveSpx.spx.toFixed(2)}
            </div>
          ) : null}
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
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50">
              {connected ? `Waiting for live 5m ${sym.label} candles` : "Loading candles…"}
            </div>
          ) : null}
        </div>
       </div>

        {/* Vertical GEX-by-strike rail, styled like the home GEX chart.
            Auto-hidden when the chart area is too narrow (railFits) so the
            candle chart doesn't get starved down to nothing. */}
        {showRail && railFits ? (
          <div style={{ width: 115, flexShrink: 0, minHeight: 320 }}>
            {/* Source precedence: replay cursor → ETF derived column → the live
                SPX websocket. The first two are the same derivation applied to a
                different column; the last is the only one /ws/gex can supply. */}
            <EsGexRail
              rows={replayGex ? replayGex.railRows : etfGex ? etfGex.railRows : railRows}
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
          </div>
        ) : null}

      </div>
      </div>
    </div>
  );
}
