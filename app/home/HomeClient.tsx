"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import EconCalendarPanel from "@/components/dashboard/EconCalendarPanel";
import FlowNetPremPanel from "@/components/dashboard/FlowNetPremPanel";
import WhaleOrdersPanel from "@/components/dashboard/WhaleOrdersPanel";
import GreeksHomePanel from "@/components/dashboard/GreeksHomePanel";
import ScannerHomePanel from "@/components/dashboard/ScannerHomePanel";
import IbStatsTab from "@/components/scanner/IbStatsTab";
// The GEX card's "ES Candles" view reuses the exact standalone /es-candles page
// (same pattern as the Chain tab reusing /options-chain below) rather than the
// trimmed EsCandlesFullPanel embed — that panel has no dock, and no bubbles /
// TPO / profile / VSA, which is precisely what the toolbar is for.
import EsCandlesPage from "@/app/es-candles/page";
import HomeGaugeRail from "@/components/dashboard/HomeGaugeRail";
import { useIbDirection } from "@/hooks/useIbDirection";
import EconCalendarDiscordBtn, { EconCalendarTemplateCopyBtn } from "@/components/shared/EconCalendarDiscordBtn";
import GexChart from "@/components/dashboard/GexChart";
import GexToolbar from "@/components/dashboard/GexToolbar";
// Reuse the exact standalone /options-chain component for the heatmap panel's
// "Chain" tab. expirySelection="key" = compact 0DTE/1DTE/weekly/monthly columns
// (same embed the /new-home page uses); ticker hides its own ticker input.
import OptionsChainPage from "@/app/options-chain/page";
import FitScale from "@/components/shared/FitScale";
import StrikeDetailPopup, { type PopupStyle } from "@/components/dashboard/StrikeDetailPopup";
import StrikeHoverCard from "@/components/dashboard/StrikeHoverCard";
import { useStrikeGexHistory } from "@/hooks/useStrikeGexHistory";
import { useDualTickerGex, type GexBasis, type OffsetGexMap } from "@/hooks/useDualTickerGex";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";
import type { FlowOrder } from "@/hooks/useSpxFlow";
import { type ChainRow, type CalcMode, computeGEXProfile, findGEXFlip, netGEXOf } from "@/lib/calculations/calculations";

/**
 * Initial GEX snapshot read on the server from the hot feed and passed in as a
 * prop, so the chart paints from the very first HTML render instead of waiting
 * for the client to hydrate → open /ws/gex → await the first frame. The live
 * WebSocket effect below takes over after mount exactly as before. See the
 * server component in ./page.tsx (this file is the client island).
 */
export type HomeInitial = {
  gexRows: ChainRow[];
  spot: number;
  spotDisplay: number;
  prevClose: number;
  expiry: string;
  expirations: string[];
  callWall: number | null;
  putWall: number | null;
  chartReady: boolean;
} | null;

type FeedType = "Quote" | "Trade" | "Summary" | "Greeks";
type OptionSide = "call" | "put";
type LiveEntry = {
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  oi?: number;
  vol?: number;
  bid?: number;
  ask?: number;
  _ws?: boolean;
};
type StrikeRow = {
  strike: number;
  callSym: string | null;
  putSym: string | null;
};
type QuoteTile = { sym: string; chg: string; pos: boolean; active?: boolean };
type HeatmapRow = {
  strikeNum: number;
  strike: string;
  // Raw numeric values (used for intensity coloring) + formatted text.
  netGexVal: number;   netGex: string;
  volOnlyVal: number;  volOnly: string;
  dexVal: number;      dex: string;
  rollingVal: number | null; rolling: string;  // 30-min rolling net GEX (DB)
  // SPY / QQQ 0DTE net GEX at the SAME moneyness offset as this SPX row (ATM+N).
  // SPY and QQQ don't share SPX's strike ladder, so the join is by offset, not
  // strike — see hooks/useDualTickerGex. `*Strike` is the contract the value
  // actually came from, surfaced in the cell tooltip.
  spyGexVal: number | null; spyGex: string; spyStrike: number | null;
  qqqGexVal: number | null; qqqGex: string; qqqStrike: number | null;
  type: "pos-top" | "pos-strong" | "neg-top" | "neg-red" | "neg" | "neutral" | "atm";
  rank?: number;
  rankColor?: string;
  atm?: boolean;
};
// Intensity-scaled cell background. Ported from options-chain metricBg logic:
// rank-based floors for the top 3 magnitudes, power curve for the rest.
function metricBg(value: number, maxValue: number, intensity: number, topValues: number[]): string {
  const n = value || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return "transparent";
  const pos = n >= 0;
  const rank = topValues.indexOf(Math.abs(n)) + 1;
  if (rank === 1) return pos ? "rgba(41,182,246,0.90)" : "rgba(255,71,87,0.90)";
  if (rank === 2) return pos ? "rgba(41,182,246,0.45)" : "rgba(255,71,87,0.45)";
  if (rank === 3) return pos ? "rgba(41,182,246,0.25)" : "rgba(255,71,87,0.25)";
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio * Math.max(intensity || 0.1, 1), 1.4);
  const alpha = Math.min(0.18, 0.02 + eased * 0.16);
  return pos ? `rgba(41,182,246,${alpha.toFixed(2)})` : `rgba(255,71,87,${alpha.toFixed(2)})`;
}

// Soft-white cell value + green/red leading sign — matches the Multi-Greek cell
// format so the heatmap / option chain / mult-greek all read identically.
const SOFT_WHITE = "#c3ccda";
function SignVal({ text }: { text: string }) {
  if (!text || text === "--" || text === "·") return <>{text}</>;
  const s = text[0] === "+" || text[0] === "-" ? text[0] : "";
  const rest = s ? text.slice(1) : text;
  const c = s === "+" ? "#22c55e" : s === "-" ? "#ef4444" : SOFT_WHITE;
  return <>{s && <span style={{ color: c }}>{s}</span>}{rest}</>;
}

type ExpiryOption = { value: string; label: string };
type GexMode = "net" | "call-put";
type DataMode = "oi-vol" | "vol-only";

const FEED_TYPES: FeedType[] = ["Quote", "Trade", "Summary", "Greeks"];
const OPTION_FEED_TYPES: FeedType[] = ["Quote", "Trade", "Summary", "Greeks"];
const SIDEBAR_SYMBOLS = ["SPY", "QQQ", "SPX", "VIX", "IWM"];
const INDEX_SYMBOLS = ["$SPX", "SPX", "/ESU26", "/ES:XCME", "VIX", ...SIDEBAR_SYMBOLS];


function fmtMoney(v: number) {
  if (!isFinite(v)) return "--";
  const s = v >= 0 ? "+" : "-";
  const a = Math.abs(v);
  if (a >= 1e9) return s + "$" + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(1) + "K";
  return s + "$" + a.toFixed(0);
}

/** Compact magnitude for the Δ stamp: whole millions, no $ — 2-3 glyphs wide. */
function stampNum(d: number): string {
  const a = Math.abs(d);
  if (a >= 1000) return (a / 1000).toFixed(1) + "B";
  if (a >= 100) return String(Math.round(a));
  return a.toFixed(a < 10 ? 1 : 0);
}

/** Ghost Δ stamp — hairline border, coloured caret + magnitude, no fill, so it
 *  reads behind the GEX value rather than competing with the cell's heat. Only
 *  rendered on ranked strikes (top 5 each side). */
function DeltaStamp({ d }: { d: number | null }) {
  if (d == null || !Number.isFinite(d)) return null;
  const pos = d > 0;
  const rgb = pos ? "34,197,94" : "239,68,68";
  const col = pos ? "#22c55e" : "#ef4444";
  return (
    <span
      title={`\u0394 ${pos ? "+" : "\u2212"}$${stampNum(d)}M vs baseline`}
      style={{
        flexShrink: 0, fontSize: 9, fontWeight: 800, fontFamily: "var(--font-mono)",
        lineHeight: 1.4, padding: "0 3px", borderRadius: 3, whiteSpace: "nowrap",
        background: "transparent", border: `1px solid rgba(${rgb},0.5)`, color: col,
      }}
    >{pos ? "\u25B2" : "\u25BC"}{stampNum(d)}</span>
  );
}

// Heatmap cells only: always millions, whole numbers. Fixed unit + no decimals
// keeps cell width stable so the grid doesn't twitch as values tick.
function fmtCellM(v: number) {
  if (!isFinite(v)) return "--";
  const m = Math.round(v / 1e6);
  return (m < 0 ? "-" : "+") + "$" + Math.abs(m).toLocaleString("en-US") + "M";
}

// Heatmap rank badge ("#1", "#2"...), rasterized as an inline SVG data URI
// rather than live DOM text. html2canvas is unreliable rasterizing text this
// small (9px) inside a flex layout — captures were showing a blank/garbled
// swatch instead of the number. An <img> bitmap is composited directly, so it
// always captures correctly.
const rankBadgeCache = new Map<string, string>();
function rankBadgeDataUri(rank: number, bg: string): string {
  const fg = bg === "#FB8501" ? "#000000" : "#ffffff";
  const key = `${rank}|${bg}`;
  const cached = rankBadgeCache.get(key);
  if (cached) return cached;
  const w = 20, h = 13;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="3" fill="${bg}"/><text x="${w / 2}" y="${h / 2 + 3}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="9" font-weight="700" fill="${fg}">#${rank}</text></svg>`;
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  rankBadgeCache.set(key, uri);
  return uri;
}

// Net GEX header value is already denominated in BILLIONS of dollars.
function fmtMoneyB(vB: number) {
  if (!isFinite(vB)) return "--";
  return fmtMoney(vB * 1e9);
}

function fmtExpiryLabel(dateStr: string, label: string) {
  return label || dateStr;
}

function formatStrikeValue(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(2);
}


function buildExpiryOptions(dates: string[]): ExpiryOption[] {
  return dates.slice(0, 8).map((value, index) => ({
    value,
    label: `${index}DTE ${value.slice(5)}`,
  }));
}

function buildStrikes(expGroups: unknown[], liveData: Record<string, LiveEntry>): StrikeRow[] {
  const map: Record<string, StrikeRow> = {};
  (expGroups as Array<{ strikes?: unknown[] }>).forEach((expGroup) => {
    (expGroup.strikes || []).forEach((item: unknown) => {
      const row = item as Record<string, unknown>;
      const strike = Number(row["strike-price"] ?? row.strikePrice ?? row.strike ?? 0);
      if (!(strike > 0)) return;
      const key = strike.toFixed(2);
      if (!map[key]) map[key] = { strike, callSym: null, putSym: null };
      const next = map[key];
      for (const side of ["call", "put"] as const) {
        const option = row[side] as Record<string, unknown> | undefined;
        if (!option) continue;
        const sym = String(option["streamer-symbol"] ?? option.symbol ?? "");
        if (side === "call") next.callSym = sym;
        else next.putSym = sym;

        if (sym && !liveData[sym]?._ws) {
          liveData[sym] = {
            iv: Number(option["implied-volatility"] ?? option.impliedVolatility ?? 0) || undefined,
            delta: Number(option.delta ?? 0) || undefined,
            gamma: Number(option.gamma ?? 0) || undefined,
            theta: Number(option.theta ?? 0) || undefined,
            vega: Number(option.vega ?? 0) || undefined,
            oi: Number(option["open-interest"] ?? option.openInterest ?? 0) || 0,
            vol: Number(option.volume ?? option.dayVolume ?? 0) || 0,
            // Captured for the hover card's Net Prem (mark × vol × 100).
            bid: Number(option.bid ?? option["bid-price"] ?? 0) || undefined,
            ask: Number(option.ask ?? option["ask-price"] ?? 0) || undefined,
          };
        }
      }
    });
  });
  return Object.values(map).sort((a, b) => a.strike - b.strike);
}

function buildChainRows(strikes: StrikeRow[], liveData: Record<string, LiveEntry>, spot: number): ChainRow[] {
  return strikes.map((row) => {
    const call = liveData[row.callSym ?? ""] || {};
    const put = liveData[row.putSym ?? ""] || {};
    const callOI = call.oi ?? 0;
    const putOI = put.oi ?? 0;
    const callVolume = call.vol ?? 0;
    const putVolume = put.vol ?? 0;
    const callGamma = Math.abs(call.gamma ?? 0);
    const putGamma = Math.abs(put.gamma ?? 0);
    const callDelta = call.delta ?? 0;
    const putDelta = Math.abs(put.delta ?? 0);
    // netGEX = OI-only basis. netVolGEX = Vol-only basis. Their sum = OI+Vol.
    // This matches the heatmap column calculation and the calculations.ts basis rules.
    // callGamma/putGamma are already abs'd above.
    const callGEX = callGamma * callOI * spot * spot;
    const putGEX = -putGamma * putOI * spot * spot;
    const netGEX = callGEX + putGEX;
    const netVolGEX = callGamma * callVolume * spot * spot - putGamma * putVolume * spot * spot;
    const netDEX = callDelta * callOI * spot * 100 - putDelta * putOI * spot * 100;
    const volNetDEX = callDelta * callVolume * spot * 100 - putDelta * putVolume * spot * 100;
    const netVanna = ((call.vega ?? 0) * callOI - (put.vega ?? 0) * putOI) * 100;
    const netVolVanna = ((call.vega ?? 0) * callVolume - (put.vega ?? 0) * putVolume) * 100;

    return {
      strike: row.strike,
      spotPrice: spot,
      callOI,
      putOI,
      callVolume,
      putVolume,
      callGamma,
      putGamma,
      callDelta,
      putDelta,
      callGEX,
      putGEX,
      netGEX,
      netVolGEX,
      netDEX,
      volNetDEX,
      netVanna,
      netVolVanna,
      callIV: call.iv ?? 0,
      putIV: put.iv ?? 0,
      dte: 0,
      bid: call.bid,
      ask: call.ask,
    };
  });
}

// Window the chain to N strikes above and N below the ATM strike (inclusive of
// ATM). Rows are returned descending by strike (highest at top). Centers on the
// strike nearest spot; clamps gracefully at the chain edges.
function pickCenterRows(rows: ChainRow[], spot: number, sideCount = 20): ChainRow[] {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => b.strike - a.strike);
  let atmIndex = 0;
  let minDist = Infinity;
  sorted.forEach((row, index) => {
    const dist = Math.abs(row.strike - spot);
    if (dist < minDist) {
      minDist = dist;
      atmIndex = index;
    }
  });
  const start = Math.max(0, atmIndex - sideCount);
  const end = Math.min(sorted.length, atmIndex + sideCount + 1);
  return sorted.slice(start, end);
}

function toHeatmapRows(
  rows: ChainRow[],
  spot: number,
  rollingByStrike?: Map<number, number>,
  spyGex?: OffsetGexMap,
  qqqGex?: OffsetGexMap,
  // Which strikes are VISIBLE is centered on centerSpot (a coarse, 5-strike-quantized
  // spot) so the row set doesn't add/drop a strike on every tick. Which row is ATM
  // still uses the live spot, so the highlight tracks price continuously.
  centerSpot?: number
): HeatmapRow[] {
  const windowRows = pickCenterRows(rows, centerSpot ?? spot, 20);
  // Rank by OI+Vol net (netGEX OI-only + netVolGEX vol-only), matching the column.
  const oiVol = (r: ChainRow) => (r.netGEX ?? 0) + (r.netVolGEX ?? 0);
  const byAbsPos = [...windowRows].filter((row) => oiVol(row) > 0).sort((a, b) => Math.abs(oiVol(b)) - Math.abs(oiVol(a))).slice(0, 5);
  const byAbsNeg = [...windowRows].filter((row) => oiVol(row) < 0).sort((a, b) => Math.abs(oiVol(b)) - Math.abs(oiVol(a))).slice(0, 5);
  const rankMap = new Map<number, { rank: number; rankColor: string }>();
  byAbsPos.forEach((row, index) => rankMap.set(row.strike, { rank: index + 1, rankColor: index === 0 || index === 2 ? "#FB8501" : "#8B94A7" }));
  byAbsNeg.forEach((row, index) => {
    if (!rankMap.has(row.strike)) rankMap.set(row.strike, { rank: index + 1, rankColor: index === 0 || index === 2 ? "#FB8501" : "#8B94A7" });
  });

  const atmStrike = windowRows.reduce((best, row) => (
    Math.abs(row.strike - spot) < Math.abs(best - spot) ? row.strike : best
  ), windowRows[0]?.strike ?? 0);
  // windowRows is DESCENDING (highest strike first), so a row ABOVE the ATM sits
  // at a LOWER index — hence atmIdx − idx to make "above ATM" a POSITIVE offset,
  // matching the ascending ladder useDualTickerGex keys SPY/QQQ by.
  const atmIdx = windowRows.findIndex((row) => row.strike === atmStrike);

  return windowRows.map((row, idx) => {
    const offset = atmIdx < 0 ? null : atmIdx - idx;
    const spyCell = offset == null ? undefined : spyGex?.[offset];
    const qqqCell = offset == null ? undefined : qqqGex?.[offset];
    // NET GEX column = OI+Vol basis. Server rows carry netGEX (OI-only) and
    // netVolGEX (vol-only); their sum is the true OI+Vol net (gamma·(OI+vol)·S²,
    // calls +, puts −). The chart bars use the same basis, so they now agree.
    const net = (row.netGEX ?? 0) + (row.netVolGEX ?? 0);
    const volOnly = row.netVolGEX ?? 0;
    const dex = (row.netDEX ?? 0) + (row.volNetDEX ?? 0);
    const rolling = rollingByStrike?.get(row.strike); // 30-min rolling net GEX
    const isAtm = row.strike === atmStrike;
    let type: HeatmapRow["type"] = "neutral";
    if (isAtm) type = "atm";
    else if (net >= 0 && rankMap.get(row.strike)?.rank === 1) type = "pos-top";
    else if (net >= 0 && (rankMap.get(row.strike)?.rank ?? 99) <= 3) type = "pos-strong";
    else if (net < 0 && rankMap.get(row.strike)?.rank === 1) type = "neg-top";
    else if (net < 0 && (rankMap.get(row.strike)?.rank ?? 99) <= 3) type = "neg-red";
    else if (net < 0) type = "neg";

    return {
      strikeNum: row.strike,
      strike: formatStrikeValue(row.strike),
      netGexVal: net,        netGex: fmtCellM(net),
      volOnlyVal: volOnly,   volOnly: fmtCellM(volOnly),
      dexVal: dex,           dex: fmtCellM(dex),
      rollingVal: rolling ?? null,
      rolling: rolling == null ? "—" : fmtCellM(rolling),
      spyGexVal: spyCell ? spyCell.netGEX : null,
      spyGex: spyCell ? fmtCellM(spyCell.netGEX) : "—",
      spyStrike: spyCell ? spyCell.strike : null,
      qqqGexVal: qqqCell ? qqqCell.netGEX : null,
      qqqGex: qqqCell ? fmtCellM(qqqCell.netGEX) : "—",
      qqqStrike: qqqCell ? qqqCell.strike : null,
      type,
      rank: rankMap.get(row.strike)?.rank,
      rankColor: rankMap.get(row.strike)?.rankColor,
      atm: isAtm,
    };
  });
}

function makeSidebarQuotes(quotes: Record<string, { last: number; prev: number }>): QuoteTile[] {
  return SIDEBAR_SYMBOLS.map((sym) => {
    const entry = quotes[sym];
    if (!entry || !(entry.prev > 0) || !(entry.last > 0)) {
      return { sym, chg: "—", pos: true, active: sym === "SPX" };
    }
    const pct = ((entry.last - entry.prev) / entry.prev) * 100;
    return {
      sym,
      chg: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
      pos: pct >= 0,
      active: sym === "SPX",
    };
  });
}

const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const FlowIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12h4l3 8 4-16 3 8h4" />
  </svg>
);
const WhaleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 14c4 4 8 4 9 1 1 3 5 3 9-1" /><path d="M12 15V4" />
  </svg>
);
const GreeksIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19h16" /><path d="M6 15c2-6 4-10 6-10s2 6 4 10" />
  </svg>
);
const ScannerIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const IbIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="21" x2="21" y2="21" /><rect x="5" y="10" width="4" height="8" /><rect x="15" y="6" width="4" height="12" /><line x1="12" y1="3" x2="12" y2="21" />
  </svg>
);
const LayersIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
  </svg>
);
const HomeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);
const GridIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
);
const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export function HomeClient({
  initial,
  isStatic = false,
  snapshotTs = null,
}: {
  initial: HomeInitial;
  /** Unpaid signed-in viewer: render from a frozen snapshot, never open the
   *  live /ws/gex socket (which is paid-gated server-side anyway — see
   *  ws-auth.js). A lightweight poll picks up the recorder's next ~30m tick. */
  isStatic?: boolean;
  /** epoch ms the current snapshot was captured, for the "delayed" banner. */
  snapshotTs?: number | null;
}) {
  // Bandwidth gate: socket stays open only while the tab is visible AND the user
  // is active (15-min idle timeout; owner exempt). Drives connect/disconnect.
  // Static (unpaid/delayed) viewers never connect at all — isStatic hard-gates it.
  const shouldConnect = useWsLifecycle() && !isStatic;
  const shouldConnectRef = useRef(shouldConnect);
  shouldConnectRef.current = shouldConnect;

  const wsRef = useRef<WebSocket | null>(null);
  const gexWsRef = useRef<WebSocket | null>(null);
  const gexWsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveDataRef = useRef<Record<string, LiveEntry>>({});
  const subscribedSymbolsRef = useRef<string[]>([]);
  const lastSpotRef = useRef(0);
  const quoteSnapshotsRef = useRef<Record<string, { last: number; prev: number }>>({});
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  // Heavy-frame throttle: gex/GEX_UPDATE/snapshot frames trigger a full recompute
  // cascade (chain reduce, heatmap, colorMeta, MVC scans). Under a fast feed they
  // arrive faster than React can render, blocking the main thread for seconds and
  // freezing clicks/navigation. We coalesce them to the latest frame, applied at
  // most once per HEAVY_FRAME_MS, so the UI stays responsive without losing data.
  const pendingGexRef = useRef<Record<string, unknown> | null>(null);
  const gexFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGexAppliedRef = useRef(0);
  // Flow frames arrive per-order (many/sec); coalesce to the latest and commit at
  // most once per FLOW_FRAME_MS so the tape/line updates ~every 15s instead of
  // re-rendering the whole page on every order.
  const pendingFlowRef = useRef<Record<string, unknown> | null>(null);
  const flowFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlowAppliedRef = useRef(0);

  // "escandles" left the strip — it now lives on the GEX panel's view switcher.
  const [activeTab, setActiveTab] = useState<"calendar" | "signals" | "flow" | "whale" | "greeks" | "scanner" | "ib">("calendar");
  // Left-column econ/tabs section height: "min" = tab bar only, "half" = shares
  // the column with the GEX chart above it, "full" = fills the whole left column
  // (chart hidden). Replaces the old econCollapsed boolean.
  const [econSize, setEconSize] = useState<"min" | "half" | "full">("half");
  const [gexMode, setGexMode] = useState<GexMode>("net");

  // (Ticker auto-fit removed: the right-column stat box it scaled was replaced by
  //  the horizontal <SignalsFeed/>, which scrolls instead of scaling to fit.)
  const [dataMode, setDataMode] = useState<DataMode>("oi-vol");
  const [showOI, setShowOI] = useState(false);
  const [showDex, setShowDex] = useState(false);
  const [showFlipCurve, setShowFlipCurve] = useState(false);
  // Prior-state ghost overlays (5/15/30 min ago) drawn behind live GEX bars.
  const [showGhost5, setShowGhost5]   = useState(false);
  const [showGhost15, setShowGhost15] = useState(false);
  const [showGhost30, setShowGhost30] = useState(false);
  // Strike-detail popup: selected strike, click anchor, and which popup style to
  // preview (card | drawer | modal — toggled in the toolbar so all 3 can be tested).
  const [selectedStrike, setSelectedStrike] = useState<{ row: ChainRow; pos: { x: number; y: number } } | null>(null);
  const popupStyle: PopupStyle = "card";

  // Cursor-anchored hover card (same as the options-chain matrix + multi-greek):
  // per-side Volume / OI / Net Prem for the hovered strike, popped after a short
  // hover-intent delay so sweeping the pointer over rows doesn't flash cards.
  const [hoverStrike, setHoverStrike] = useState<{ strike: number; x: number; y: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armStrikeHover = useCallback((v: { strike: number; x: number; y: number }) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoverStrike(v), 700);
  }, []);
  const cancelStrikeHover = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setHoverStrike(null);
  }, []);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  const gexContainerRef = useRef<HTMLDivElement>(null);
  const gexChartRef = useRef<HTMLDivElement>(null);
  // Host node for the econ-calendar filter dropdown + refresh button, portaled
  // out of EconCalendarPanel into this tab row. State (not a plain ref) so the
  // portal re-renders once the node actually mounts.
  const [econControlsSlotEl, setEconControlsSlotEl] = useState<HTMLDivElement | null>(null);
  const econControlsSlotRef = useCallback((node: HTMLDivElement | null) => setEconControlsSlotEl(node), []);
  const heatmapContainerRef = useRef<HTMLDivElement>(null);
  const heatmapBodyRef = useRef<HTMLDivElement>(null);
  const [expiryOptions, setExpiryOptions] = useState<ExpiryOption[]>(
    initial?.expirations?.length ? buildExpiryOptions(initial.expirations) : []
  );
  const [selectedExpiry, setSelectedExpiry] = useState(initial?.expiry ?? "");
  const selectedExpiryRef = useRef(initial?.expiry ?? "");
  const [strikeRows, setStrikeRows] = useState<StrikeRow[]>([]);
  const [spot, setSpot] = useState(initial?.spot ?? 0);
  // Display SPX: live broker quote during RTH, ES-derived off-hours (server's
  // spotDisplay). Used ONLY for the SPX readout + change %, never for GEX math
  // (which stays on `spot`/`gexSpot`, the broker quote the strikes are priced on).
  const [spotDisplay, setSpotDisplay] = useState(initial?.spotDisplay ?? 0);
  const [esFut, setEsFut] = useState(0);
  const [vix, setVix] = useState(0);
  const [spxChange, setSpxChange] = useState(0);
  const [spxChangePct, setSpxChangePct] = useState(0);
  const [sidebarQuotes, setSidebarQuotes] = useState<QuoteTile[]>(SIDEBAR_SYMBOLS.map((sym) => ({ sym, chg: "—", pos: true, active: sym === "SPX" })));
  const [quoteSnapshots, setQuoteSnapshots] = useState<Record<string, { last: number; prev: number }>>({});
  const [status, setStatus] = useState("READY");
  // True once the server reports OI + greeks are warm. Until then the GEX chart
  // shows a loader so a half-warmed / inflated frame never renders.
  const [chartReady, setChartReady] = useState(initial?.chartReady ?? false);
  // GEX chart rows pushed from /ws/gex broadcaster (server-computed loop).
  // Seeded from the server-rendered hot-feed snapshot so the chart paints on the
  // first HTML frame; the WS effect replaces these on the first live message.
  const [gexChainRows, setGexChainRows] = useState<ChainRow[]>(initial?.gexRows ?? []);
  const [gexSpot, setGexSpot] = useState(initial?.spot ?? 0);
  // Summary levels from server gex message.
  const [callWall, setCallWall] = useState<number | null>(initial?.callWall ?? null);
  const [putWall, setPutWall] = useState<number | null>(initial?.putWall ?? null);
  // Prior closes for VIX / ESU from the proxy (Tastytrade) for day-change %.
  const [vixPrevClose, setVixPrevClose] = useState(0);
  const [esuPrevClose, setEsuPrevClose] = useState(0);
  // (VIX/ESU day-change % derivations moved to the toolbar ticker, which sources
  // its own quotes; the prev-close state above still feeds other readouts.)
  // SPX flow tape (per-order) pushed from the server `flow` WS message.
  const [flowOrders, setFlowOrders] = useState<FlowOrder[]>([]);
  // Full server flow bucket (vols/premium) for the Snapshot panel.
  const [flowBucket, setFlowBucket] = useState<Record<string, unknown> | null>(null);
  // Heatmap intensity slider (0.5–3, default 1.75) — controls cell color opacity.
  const [intensity, setIntensity] = useState(1.75);
  // Basis for the SPY 0DTE / QQQ 0DTE net GEX columns. Independent of the SPX
  // columns beside them, which always render OI+Vol and Vol-only side by side.
  const [sideBasis, setSideBasis] = useState<GexBasis>("oi-vol");
  // Heatmap panel view: "heatmap" = colored cell backgrounds; "chain" = embedded
  // option chain. ("table" divergent-bars view retired from the switcher; kept in
  // the union so its now-unreachable render branch stays valid without a refactor.)
  const [heatmapView, setHeatmapView] = useState<"heatmap" | "table" | "chain">("heatmap");
  // Δ stamps on the heatmap's NET GEX column. 0 = off (today's view).
  const [deltaWindow, setDeltaWindow] = useState<0 | 5 | 15 | 30>(0);
  // GEX chart card view: the Net GEX bar chart, or the live ES 5m candles in its
  // place. Moved here from the bottom tab strip.
  const [gexView, setGexView] = useState<"gex" | "escandles">("gex");
  // Home option-chain ticker override. `chainTicker` drives the embed; `chainTickerInput`
  // is the raw text field. Both revert to SPX on any tab change (see effect below).
  const [chainTicker, setChainTicker] = useState("SPX");
  const [chainTickerInput, setChainTickerInput] = useState("SPX");
  // 30-min rolling net GEX per strike, pulled from the history DB.
  const [rollingByStrike, setRollingByStrike] = useState<Map<number, number>>(new Map());

  // Always defer the home option chain back to SPX whenever a tab changes
  // (heatmap/chain switch or the left-column tab).
  useEffect(() => {
    setChainTicker("SPX");
    setChainTickerInput("SPX");
  }, [heatmapView, activeTab]);

  useEffect(() => {
    quoteSnapshotsRef.current = quoteSnapshots;
  }, [quoteSnapshots]);


  useEffect(() => {
    selectedExpiryRef.current = selectedExpiry;
  }, [selectedExpiry]);



  const scheduleRender = useCallback(() => {}, []);

  // ── GEX WebSocket: connect to /ws/gex, receive pushed GEX_UPDATE from server loop ──
  // When user picks a different expiry, tell the server to switch
  const handleExpiry = useCallback((expiry: string) => {
    setSelectedExpiry(expiry);
    // New expiry re-gates on the server; show the loader until it warms again.
    setChartReady(false);
    if (gexWsRef.current?.readyState === WebSocket.OPEN) {
      gexWsRef.current.send(JSON.stringify({ type: 'SET_EXPIRY', expiry }));
    }
  }, []);

  // Connect to /ws/gex and consume server-computed GEX state.
  // Tolerates both the server-v2 envelope ({ type, data }) and the legacy
  // flat broadcaster format ({ type:'GEX_UPDATE', gexRows, ... }) so the same
  // consumer works against either stack during migration.
  useEffect(() => {
    unmountedRef.current = false;

    // Apply a GEX payload (server-v2 `data` block OR legacy flat message).
    // Update SPX spot + change vs prior close, plus aux VIX/ESU quotes.
    // `s` is the broker quote (drives math); `disp` is the display SPX (readout +
    // change). When disp is absent we fall back to s so nothing regresses.
    const applySpot = (s: number, prevClose: number, disp?: number) => {
      if (s > 0) setSpot(s);
      const shown = disp && disp > 0 ? disp : s;
      if (shown > 0) {
        setSpotDisplay(shown);
        if (prevClose > 0) {
          setSpxChange(shown - prevClose);
          setSpxChangePct(((shown - prevClose) / prevClose) * 100);
        }
      }
    };

    const applyGex = (p: Record<string, unknown>) => {
      if (Array.isArray(p.gexRows)) setGexChainRows(p.gexRows as ChainRow[]);
      const s = Number(p.spot ?? 0);
      if (s > 0) setGexSpot(s);
      applySpot(s, Number(p.prevClose ?? 0), Number(p.spotDisplay ?? 0));
      if (Number(p.vix ?? 0) > 0) setVix(Number(p.vix));
      if (Number(p.esFut ?? 0) > 0) setEsFut(Number(p.esFut));
      if (Number(p.vixPrevClose ?? 0) > 0) setVixPrevClose(Number(p.vixPrevClose));
      if (Number(p.esFutPrevClose ?? 0) > 0) setEsuPrevClose(Number(p.esFutPrevClose));
      if (p.callWall != null) setCallWall(Number(p.callWall) || null);
      if (p.putWall != null) setPutWall(Number(p.putWall) || null);
      const exps = p.expirations as string[] | undefined;
      if (Array.isArray(exps) && exps.length) {
        setExpiryOptions(buildExpiryOptions(exps));
        setSelectedExpiry((cur) => cur || String(p.expiry ?? exps[0] ?? ""));
      } else if (p.expiry) {
        setSelectedExpiry((cur) => cur || String(p.expiry));
      }
    };

    // Coalesce heavy frames: remember the latest payload + its readiness, then
    // apply on a trailing timer no more than once per HEAVY_FRAME_MS. Leading edge
    // fires immediately so the first frame paints with no delay.
    // Was 1500ms to ration the free dxLink/TT feed + avoid pinning the render
    // thread. On paid Theta Pro the feed is no longer the constraint; tightened
    // so live GEX updates feel near-real-time. Env-overridable for quick tuning.
    const HEAVY_FRAME_MS = Number(process.env.NEXT_PUBLIC_HEAVY_FRAME_MS) || 750;
    const flushGex = () => {
      gexFlushTimerRef.current = null;
      const data = pendingGexRef.current;
      pendingGexRef.current = null;
      if (!data) return;
      lastGexAppliedRef.current = Date.now();
      applyGex(data);
      setStatus("LIVE");
      const st = (data.__status ?? undefined) as Record<string, unknown> | undefined;
      if (data.__isSnapshot) {
        if (st && typeof st.chartReady === "boolean") setChartReady(st.chartReady);
      } else {
        setChartReady(true);
      }
    };
    const queueGex = (data: Record<string, unknown>, isSnapshot: boolean, st: unknown) => {
      // Stash readiness flags on the payload so flushGex applies the latest frame's.
      data.__isSnapshot = isSnapshot;
      data.__status = st;
      pendingGexRef.current = data;
      const since = Date.now() - lastGexAppliedRef.current;
      if (since >= HEAVY_FRAME_MS) {
        flushGex(); // leading edge — no pending timer, apply now
      } else if (!gexFlushTimerRef.current) {
        gexFlushTimerRef.current = setTimeout(flushGex, HEAVY_FRAME_MS - since);
      }
    };

    // Flow throttle — same leading+trailing coalesce as GEX, at 15s.
    const FLOW_FRAME_MS = 15000;
    const flushFlow = () => {
      flowFlushTimerRef.current = null;
      const data = pendingFlowRef.current;
      pendingFlowRef.current = null;
      if (!data) return;
      lastFlowAppliedRef.current = Date.now();
      const tape = data.tape as FlowOrder[] | undefined;
      if (Array.isArray(tape)) setFlowOrders(tape);
      setFlowBucket(data);
    };
    const queueFlow = (data: Record<string, unknown>) => {
      pendingFlowRef.current = data;
      const since = Date.now() - lastFlowAppliedRef.current;
      if (since >= FLOW_FRAME_MS) {
        flushFlow(); // leading edge
      } else if (!flowFlushTimerRef.current) {
        flowFlushTimerRef.current = setTimeout(flushFlow, FLOW_FRAME_MS - since);
      }
    };

    const handleMessage = (raw: string) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw); } catch { return; }
      const type = String(msg.type ?? "");
      // server-v2 nests under `data`; legacy puts fields on the message itself.
      const data = (msg.data && typeof msg.data === "object"
        ? msg.data
        : msg) as Record<string, unknown>;

      switch (type) {
        case "snapshot":
        case "gex":
        case "GEX_UPDATE": {
          // Throttled: queue the latest frame instead of recomputing every tick.
          const st = (data.status ?? msg.status) as Record<string, unknown> | undefined;
          queueGex(data, type === "snapshot", st);
          break;
        }
        case "spot": {
          const s = Number(data.spot ?? 0);
          if (s > 0) setGexSpot(s);
          applySpot(s, Number(data.prevClose ?? 0), Number(data.spotDisplay ?? 0));
          break;
        }
        case "aux": {
          if (Number(data.vix ?? 0) > 0) setVix(Number(data.vix));
          if (Number(data.esFut ?? 0) > 0) setEsFut(Number(data.esFut));
          if (Number(data.vixPrevClose ?? 0) > 0) setVixPrevClose(Number(data.vixPrevClose));
          if (Number(data.esFutPrevClose ?? 0) > 0) setEsuPrevClose(Number(data.esFutPrevClose));
          // Display SPX rides on ES off-hours; aux carries its live updates. Use
          // the last known prevClose (from prior spot/gex frames) for the change.
          if (Number(data.spotDisplay ?? 0) > 0) setSpotDisplay(Number(data.spotDisplay));
          break;
        }
        case "flow": {
          // Server sends the full capped tape (oldest-first) each message.
          // Throttled: coalesce per-order frames, commit ~every 15s (see queueFlow).
          queueFlow(data);
          break;
        }
        case "EXPIRATIONS":
        case "status": {
          const exps = data.expirations as string[] | undefined;
          if (Array.isArray(exps) && exps.length) {
            setExpiryOptions(buildExpiryOptions(exps));
            setSelectedExpiry((cur) => cur || String(data.expiry ?? exps[0] ?? ""));
          }
          if (typeof data.chartReady === "boolean") setChartReady(data.chartReady);
          break;
        }
        default:
          break; // flow/other handled elsewhere
      }
    };

    const connect = () => {
      if (unmountedRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/ws/gex`;
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch { scheduleReconnect(); return; }
      gexWsRef.current = ws;

      ws.onopen = () => {
        setStatus("LIVE");
        // Re-assert the chosen expiry on (re)connect so the server matches the UI.
        const exp = selectedExpiryRef.current;
        if (exp) {
          try { ws.send(JSON.stringify({ type: "SET_EXPIRY", expiry: exp })); } catch {}
        }
      };
      ws.onmessage = (evt) => handleMessage(String(evt.data));
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onclose = () => {
        setStatus("RECONNECTING");
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (unmountedRef.current) return;
      // Don't reconnect while the lifecycle gate says we shouldn't be live
      // (backgrounded tab, or 15-min user inactivity). The gate flip re-opens us.
      if (!shouldConnectRef.current) return;
      if (gexWsReconnectRef.current) clearTimeout(gexWsReconnectRef.current);
      gexWsReconnectRef.current = setTimeout(connect, 2000);
    };

    // Value-driven gate: this effect re-runs whenever `shouldConnect` flips
    // (tab background/foreground, idle timeout). When allowed, connect; when not,
    // the cleanup below tears the socket down. No polling, no churn.
    if (shouldConnect) connect();

    return () => {
      unmountedRef.current = true;
      if (gexWsReconnectRef.current) clearTimeout(gexWsReconnectRef.current);
      if (gexFlushTimerRef.current) { clearTimeout(gexFlushTimerRef.current); gexFlushTimerRef.current = null; }
      if (flowFlushTimerRef.current) { clearTimeout(flowFlushTimerRef.current); flowFlushTimerRef.current = null; }
      pendingGexRef.current = null;
      const ws = gexWsRef.current;
      gexWsRef.current = null;
      if (ws) {
        ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => { try { ws.close(); } catch {} };
        } else {
          ws.onopen = null;
          try { ws.close(); } catch {}
        }
      }
    };
    // Re-runs only when the bandwidth gate flips. The current expiry is read from
    // selectedExpiryRef on each (re)connect, so expiry changes don't churn this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldConnect]);

  // ── Static (delayed) mode: no WS, just apply the frozen snapshot and poll for
  // the recorder's next ~30m tick. Mirrors applyGex above but reads the flat
  // /api/home-snapshot shape instead of a WS message envelope. ──
  const [lastSnapshotTs, setLastSnapshotTs] = useState<number | null>(snapshotTs);
  useEffect(() => {
    if (!isStatic) return;

    const applyStatic = (p: Record<string, unknown> | null | undefined) => {
      if (!p) return;
      if (Array.isArray(p.gexRows)) setGexChainRows(p.gexRows as ChainRow[]);
      const s = Number(p.spot ?? 0);
      if (s > 0) { setGexSpot(s); setSpot(s); }
      const disp = Number(p.spotDisplay ?? 0) > 0 ? Number(p.spotDisplay) : s;
      if (disp > 0) {
        setSpotDisplay(disp);
        const pc = Number(p.prevClose ?? 0);
        if (pc > 0) { setSpxChange(disp - pc); setSpxChangePct(((disp - pc) / pc) * 100); }
      }
      if (p.callWall != null) setCallWall(Number(p.callWall) || null);
      if (p.putWall != null) setPutWall(Number(p.putWall) || null);
      // Only the single expiry the snapshot was captured for is meaningful here
      // (there's no live socket to request a different one from).
      const exp = String(p.expiry ?? "");
      if (exp) { setExpiryOptions(buildExpiryOptions([exp])); setSelectedExpiry(exp); }
      setChartReady(true);
      setStatus("DELAYED");
    };

    // Seed immediately from the server-rendered initial snapshot (fills in
    // spxChange/spxChangePct, which the useState initializers above don't).
    applyStatic(initial);

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/home-snapshot", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json.snapshot) { applyStatic(json.snapshot); setLastSnapshotTs(Number(json.ts) || null); }
      } catch { /* keep showing the last-known frozen snapshot */ }
    };
    const id = setInterval(poll, 60_000); // cheap — recorder only updates every ~30m anyway
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStatic]);

  // Load chain symbols for heatmap WS subscription (separate from GEX chart data)
  const loadChain = useCallback(async (expiry: string) => {
    if (!expiry) return;
    void expiry;
    setStrikeRows([]);
    subscribedSymbolsRef.current = [];
    scheduleRender();
  }, [gexSpot, scheduleRender]);

  useEffect(() => {
    if (!selectedExpiry) return;
    loadChain(selectedExpiry).catch(() => {});
  }, [loadChain, selectedExpiry]);

  // Held in a ref because useDualTickerGex is declared below (it needs chainRows'
  // siblings), but the refresh button is wired up here. Keeps the ↻ button
  // refreshing the SPY/QQQ columns alongside the SPX chain.
  const refreshSideGexRef = useRef<() => void>(() => {});

  const handleRefresh = useCallback(async () => {
    if (selectedExpiry) await loadChain(selectedExpiry);
    refreshSideGexRef.current();
  }, [loadChain, selectedExpiry]);

  // Heatmap icon-button refresh with press feedback (idle ↻ / refreshing / ✓ / ✗).
  const { trigger: heatmapRefresh, label: heatmapRefreshLabel, style: heatmapRefreshStyle } =
    useRefreshButton(handleRefresh);

  // Live WS-rebuilt chain — only accurate once symbols are subscribed and WS events arrive
  const wsChainRows = useMemo(() => {
    const liveSpot = spot > 0 ? spot : Number(quoteSnapshots.SPX?.last ?? 0);
    if (!(liveSpot > 0) || !strikeRows.length) return [] as ChainRow[];
    return buildChainRows(strikeRows, liveDataRef.current, liveSpot);
  }, [quoteSnapshots.SPX?.last, spot, strikeRows]);

  // Both chart and heatmap use the server-pushed GEX rows (from /ws/gex broadcaster).
  // WS chain kicks in once live data arrives and overrides at least a few strikes.
  const chartRows = gexChainRows.length > 0 ? gexChainRows : wsChainRows;
  const chartSpot = gexSpot > 0 ? gexSpot : spot;
  // The clicked row is a one-time snapshot; while the popup stays open, re-look
  // it up in the live chartRows every render so price/gamma/OI/OTM-side track
  // the market instead of freezing at click time (was showing stale marks and
  // a stale OTM call/put label once spot crossed the strike after opening).
  const liveSelectedRow = useMemo(() => {
    if (!selectedStrike) return null;
    return chartRows.find((r) => r.strike === selectedStrike.row.strike) ?? selectedStrike.row;
  }, [selectedStrike, chartRows]);

  // For heatmap: merge gexChainRows with any live WS updates for accurate real-time deltas
  const chainRows = useMemo(() => {
    if (!gexChainRows.length) return wsChainRows;
    if (!wsChainRows.length) return gexChainRows;
    // Build a map of WS-updated strikes for fast lookup
    const wsMap = new Map(wsChainRows.map(r => [r.strike, r]));
    // Use WS data only if it has non-zero gamma (i.e., live Greeks came in)
    return gexChainRows.map(row => {
      const ws = wsMap.get(row.strike);
      if (ws && ((ws.callGamma ?? 0) > 0 || (ws.putGamma ?? 0) > 0)) return ws;
      return row;
    });
  }, [gexChainRows, wsChainRows]);

  // Home gauge rail metrics (fed to <HomeGaugeRail/> that replaced SignalsFeed).
  //  · cpg          = total call $-gamma / total put $-gamma (OI+Vol basis); 1.0 balanced.
  //  · gammaPctVol  = call share of VOL-ONLY gamma, 0–100; >50 = call-side gamma dominant.
  // GEX / DEX / 0DTE GEX Δ15m are wired live inside the component off /ws/gex.
  const gaugeMetrics = useMemo(() => {
    let callDollarGamma = 0, putDollarGamma = 0; // OI+Vol basis
    let callVolGamma = 0, putVolGamma = 0;        // vol-only basis
    for (const r of chainRows) {
      callDollarGamma += (r.callGamma ?? 0) * ((r.callOI ?? 0) + (r.callVolume ?? 0));
      putDollarGamma  += (r.putGamma ?? 0) * ((r.putOI ?? 0) + (r.putVolume ?? 0));
      callVolGamma += (r.callGamma ?? 0) * (r.callVolume ?? 0);
      putVolGamma  += (r.putGamma ?? 0) * (r.putVolume ?? 0);
    }
    const cpg = putDollarGamma > 0 ? callDollarGamma / putDollarGamma : null;
    const totVol = callVolGamma + putVolGamma;
    const gammaPctVol = totVol > 0 ? (callVolGamma / totVol) * 100 : null;
    return { cpg, gammaPctVol };
  }, [chainRows]);

  // Live IB direction % (pHigh — HIGH-breaks-first probability, ES≈SPX). Enabled
  // only in live mode so delayed-mode users don't open the ES candle feed.
  const ibDirection = useIbDirection(!isStatic);

  // SPY / QQQ 0DTE per-strike net GEX for the two right-hand columns. Only
  // fetched in heatmap view — the chain embed doesn't render these columns, so
  // there's no reason to poll two extra chains behind it.
  const SIDE_TICKERS = useMemo(() => ["SPY", "QQQ"] as const, []);
  // Pinned to selectedExpiry — these columns flip contract exactly when the SPX
  // heatmap does, instead of resolving their own 0DTE and drifting onto a
  // different date than the rows beside them.
  const { data: sideGex, loading: sideLoading, refresh: refreshSideGex } = useDualTickerGex(
    SIDE_TICKERS,
    sideBasis,
    selectedExpiry,
    60_000,
    heatmapView !== "chain"
  );
  // Effect, not a render-phase assignment — the ref is only ever read from the
  // refresh click handler, never during render.
  useEffect(() => {
    refreshSideGexRef.current = refreshSideGex;
  }, [refreshSideGex]);

  // DTE tag for the SPY/QQQ column headers, taken from the SPX expiry the
  // heatmap is on ("0DTE", "1DTE", …). Flips with the contract so the header can
  // never claim 0DTE while the data is on a later expiry.
  const sideDteTag = useMemo(
    () => expiryOptions.find((o) => o.value === selectedExpiry)?.label.split(" ")[0] ?? "0DTE",
    [expiryOptions, selectedExpiry]
  );

  // Coarse spot that only moves in whole 5-strike steps. The visible strike window
  // is centered on THIS, so a 1-point tick can no longer add a strike at one end and
  // drop one at the other — the row set only shifts once price has covered 5 strikes.
  const centerSpotRef = useRef<number | null>(null);
  const heatmapRows = useMemo(() => {
    const useSpot = chartSpot > 0 ? chartSpot : spot;
    if (!(useSpot > 0) || !chainRows.length) return [] as HeatmapRow[];

    const uniq = [...new Set(chainRows.map((r) => r.strike))].sort((a, b) => a - b);
    const step = uniq.length > 1 ? Math.min(...uniq.slice(1).map((s, i) => s - uniq[i])) : 5;
    const bucket = step * 5;
    if (
      centerSpotRef.current == null ||
      Math.abs(useSpot - centerSpotRef.current) >= bucket
    ) {
      centerSpotRef.current = Math.round(useSpot / bucket) * bucket;
    }

    return toHeatmapRows(
      chainRows,
      useSpot,
      rollingByStrike,
      sideGex.SPY?.map,
      sideGex.QQQ?.map,
      centerSpotRef.current
    );
  }, [chainRows, chartSpot, spot, rollingByStrike, sideGex]);

  // Column maxes + top-3 magnitudes for intensity coloring (per visible column).
  // spyGexVal / qqqGexVal each get their OWN scale — SPY and QQQ notional gamma
  // is orders of magnitude below SPX's, so sharing netGexVal's max would leave
  // both columns colorless.
  const heatmapColorMeta = useMemo(() => {
    const cols = ["netGexVal", "volOnlyVal", "dexVal", "spyGexVal", "qqqGexVal"] as const;
    const max: Record<string, number> = {};
    const top3: Record<string, number[]> = {};
    for (const c of cols) {
      const absVals = heatmapRows
        .map((r) => Math.abs(Number(r[c] ?? 0)))
        .filter((v) => v > 0);
      max[c] = absVals.length ? Math.max(...absVals) : 1;
      top3[c] = [...absVals].sort((a, b) => b - a).slice(0, 3);
    }
    return { max, top3 };
  }, [heatmapRows]);

  // MVC for the heatmap table — single strike with the highest ABSOLUTE net GEX
  // across the heatmap rows. Gets the gold star in the heatmap. Distinct from the
  // chart/top-bar MVC (`mvcStrike`, computed from chartRows below).
  const mvcStrikeHeatmap = useMemo(() => {
    let best: number | null = null;
    let bestAbs = 0;
    for (const r of heatmapRows) {
      const a = Math.abs(Number(r.netGexVal ?? 0));
      if (a > bestAbs) { bestAbs = a; best = r.strikeNum; }
    }
    return best;
  }, [heatmapRows]);

  // Peak |net GEX| strike for the SPY / QQQ columns — each gets the same white
  // box + glow the SPX NET GEX peak (mvcStrikeHeatmap) gets. Own column, own peak.
  const peakStrikeByCol = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const c of ["spyGexVal", "qqqGexVal"] as const) {
      let best: number | null = null;
      let bestAbs = 0;
      for (const r of heatmapRows) {
        const a = Math.abs(Number(r[c] ?? 0));
        if (a > bestAbs) { bestAbs = a; best = r.strikeNum; }
      }
      out[c] = best;
    }
    return out;
  }, [heatmapRows]);

  // Screenshot title date, e.g. "Mon 6/29" — mirrors the GEX chart title format.
  const heatmapTitleDate = useMemo(() => {
    if (!selectedExpiry) return "";
    const d = new Date(selectedExpiry + "T00:00:00");
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
  }, [selectedExpiry]);

  // Poll the 30-min rolling net GEX history for the active expiry.
  useEffect(() => {
    if (!selectedExpiry) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(
          `/api/snapshots/option-strike-gex-history?expiry=${encodeURIComponent(selectedExpiry)}&minutes=30`,
          { cache: "no-store" }
        );
        if (!r.ok) return;
        const json = await r.json();
        const rows: Array<{ strike: number; rolling_net_gex: number }> = json?.rows ?? [];
        if (cancelled) return;
        setRollingByStrike(new Map(rows.map((x) => [Number(x.strike), Number(x.rolling_net_gex)])));
      } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [selectedExpiry]);

  // OI + Vol mode = OI-based net GEX PLUS volume-based net GEX (matches the label).
  // Vol Only mode = volume-based component alone.
  // Total net GEX — identical definition to the Insights → Exposure Stack page
  // (computeExposureSnapshot): full chain, contracts = open interest + volume,
  // net = (callGamma·callContracts − putGamma·putContracts) · spot² · 0.01 · 100, in $B.
  const netGexLive = useMemo(() => {
    const s = chartSpot;
    if (!(s > 0)) return 0;
    // Shared per-strike GEX (OI+Vol basis), then header units: $B per 1% move.
    const total = chartRows.reduce(
      (sum, row) => sum + netGEXOf(row, "net", s) * 0.01 * 100,
      0,
    );
    return total / 1e9;
  }, [chartRows, chartSpot]);
  // Throttle the displayed value so the header doesn't jitter on every WS tick.
  const [netGex, setNetGexDisplay] = useState(0);
  const netGexLiveRef = useRef(0);
  useEffect(() => { netGexLiveRef.current = netGexLive; }, [netGexLive]);
  useEffect(() => {
    const id = setInterval(() => {
      const next = netGexLiveRef.current;
      setNetGexDisplay((prev) => (prev === next ? prev : next));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  // Point-in-time net GEX baselines (open / 5 / 15 / 30 min) for the popup's
  // rolling-difference boxes — and, while Δ stamps are on, for the heatmap's
  // NET GEX column. Polls when a strike is selected OR the mode is active.
  const strikeBaselines = useStrikeGexHistory(
    (selectedStrike || deltaWindow !== 0) ? selectedExpiry : "",
    [5, 15, 30]
  );

  // Δ per strike = live NET GEX − recorded baseline, for RANKED strikes only.
  // row.rank is already "top 5 each side" (see toHeatmapRows), so gating on it
  // gives exactly the top 5 positive + top 5 negative strikes.
  const heatmapDeltas = useMemo(() => {
    const by: Record<number, number> = {};
    if (deltaWindow === 0) return by;
    const key = String(deltaWindow);
    for (const r of heatmapRows) {
      if (r.rank == null) continue;
      const live = Number(r.netGexVal ?? NaN);
      const past = Number(strikeBaselines?.[r.strikeNum]?.[key] ?? NaN);
      if (!Number.isFinite(live) || !Number.isFinite(past)) continue;
      by[r.strikeNum] = live - past;
    }
    return by;
  }, [deltaWindow, heatmapRows, strikeBaselines]);

  // Chart ghost-bar baselines — poll the full chain whenever any prior-state
  // overlay (5/15/30 min) is enabled.
  const anyGhost = showGhost5 || showGhost15 || showGhost30;
  const chartBaselines = useStrikeGexHistory(anyGhost ? selectedExpiry : "", [5, 15, 30], 30_000, true);

  // Strike → full ChainRow lookup so the heatmap rows can open the same popup.
  const chartRowByStrike = useMemo(
    () => new Map(chartRows.map((r) => [r.strike, r])),
    [chartRows]
  );

  // Strike → StrikeRow (call/put symbols) so the hover card can read per-side
  // book stats (Volume / OI / mark) from live data.
  const strikeRowByStrike = useMemo(
    () => new Map(strikeRows.map((r) => [r.strike, r])),
    [strikeRows]
  );

  // Per-side Volume / OI / Net Prem for the hovered strike (Net Prem = mark ×
  // volume × 100, mark = mid of bid/ask) — feeds the shared StrikeHoverCard.
  const hoverSides = useMemo(() => {
    if (!hoverStrike) return null;
    const sr = strikeRowByStrike.get(hoverStrike.strike);
    if (!sr) return null;
    const side = (sym: string | null) => {
      const d = (sym && liveDataRef.current[sym]) || {};
      const vol = d.vol ?? 0;
      const oi = d.oi ?? 0;
      const mark = (d.bid != null && d.ask != null && (d.bid > 0 || d.ask > 0)) ? (d.bid + d.ask) / 2 : 0;
      return { vol, oi, prem: mark * vol * 100 };
    };
    return { calls: side(sr.callSym), puts: side(sr.putSym) };
  }, [hoverStrike, strikeRowByStrike]);

  // % of total |net GEX| that is positive, across every strike on the selected
  // (0DTE) expiry. 100% = pure long-gamma chain, 0% = pure short-gamma.
  const posGexPct = useMemo(() => {
    const s = chartSpot;
    if (!(s > 0) || chartRows.length === 0) return null;
    let pos = 0, abs = 0;
    for (const r of chartRows) {
      const g = netGEXOf(r, "net", s);
      if (g > 0) pos += g;
      abs += Math.abs(g);
    }
    return abs > 0 ? (pos / abs) * 100 : null;
  }, [chartRows, chartSpot]);

  // Bull/Bear premium split — same calc as the /test Flow Inventory panel
  // (buy calls + sell puts = bullish premium), SPX tape only.
  const [flowBull, setFlowBull] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/proxy/flow-history?underlying=SPX&limit=20000`);
        if (!res.ok) return;
        const json = await res.json();
        const tape: { premium?: number; type?: string; side?: string }[] = Array.isArray(json?.tape) ? json.tape : [];
        let bull = 0, bear = 0;
        for (const o of tape) {
          const prem = o.premium || 0;
          const isPut = o.type === "P";
          const isBuy = o.side === "buy";
          if ((isBuy && !isPut) || (!isBuy && isPut)) bull += prem; else bear += prem;
        }
        const tot = bull + bear;
        if (!cancelled) setFlowBull(tot > 0 ? Math.round((bull / tot) * 100) : null);
      } catch { /* keep last good value */ }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Weekly EM ±1σ for SPX — published levels (up = +1σ, down = −1σ) from
  // ticker_levels. Frozen weekly, so a 5-min poll is plenty.
  const [emLevels, setEmLevels] = useState<{ up: number | null; down: number | null }>({ up: null, down: null });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/levels?ticker=SPX`);
        if (!res.ok) return;
        const j = await res.json();
        const n = (v: unknown) => {
          const x = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
          return Number.isFinite(x) && x > 0 ? x : null;
        };
        if (!cancelled) setEmLevels({ up: n(j?.up), down: n(j?.down) });
      } catch { /* keep last good value */ }
    };
    load();
    const id = setInterval(load, 300_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const flipPoint = useMemo(() => findGEXFlip(chartRows, chartSpot) ?? null, [chartRows, chartSpot]);
  // MVC = strike carrying the peak |OI+Vol net GEX| (most valuable concentration).
  // OI+Vol = netGEX (OI-only) + netVolGEX (vol-only) — matches the GexChart MVC
  // label, the heatmap NET GEX column, and the OI+Vol toggle default so chart,
  // top-bar, and heatmap always agree.
  const mvcStrike = useMemo(() => {
    let best: number | null = null;
    let bestAbs = 0;
    for (const r of chartRows) {
      const v = Math.abs((r.netGEX ?? 0) + (r.netVolGEX ?? 0));
      if (v > bestAbs) { bestAbs = v; best = r.strike; }
    }
    return best;
  }, [chartRows]);

  // Max pain — expiry price that minimises total intrinsic payout to option
  // holders (ported from the gex2 page calc; OI-weighted).
  const maxPainStrike = useMemo(() => {
    const rows = chartRows.filter((r) => Number.isFinite(r.strike));
    if (!rows.length) return null;
    let maxPain: number | null = null, best = Infinity;
    for (const k of rows) {
      let pain = 0;
      for (const r of rows) {
        if (r.strike < k.strike) pain += (r.callOI ?? 0) * (k.strike - r.strike);
        else if (r.strike > k.strike) pain += (r.putOI ?? 0) * (r.strike - k.strike);
      }
      if (pain < best) { best = pain; maxPain = k.strike; }
    }
    return maxPain;
  }, [chartRows]);

  // Call/Put walls on the SAME basis as the heatmap (OI+Vol, or Vol-only when the
  // toggle is set). The server-provided p.callWall/p.putWall are OI-only and so
  // disagreed with the OI+Vol NET GEX column (e.g. server said 7410 while the
  // heatmap peak above spot is 7400). Compute client-side via the single source.
  const wallCalcMode: CalcMode = dataMode === "vol-only" ? "vol" : "net";
  const callWallOiVol = useMemo(() => {
    let best: number | null = null, bestV = 0;
    for (const r of chartRows) {
      if (!(r.strike > chartSpot)) continue;
      const v = netGEXOf(r, wallCalcMode, chartSpot);
      if (v > 0 && v > bestV) { bestV = v; best = r.strike; }
    }
    return best;
  }, [chartRows, chartSpot, wallCalcMode]);
  const putWallOiVol = useMemo(() => {
    let best: number | null = null, bestV = 0;
    for (const r of chartRows) {
      if (!(r.strike < chartSpot)) continue;
      const v = netGEXOf(r, wallCalcMode, chartSpot);
      if (v < 0 && -v > bestV) { bestV = -v; best = r.strike; }
    }
    return best;
  }, [chartRows, chartSpot, wallCalcMode]);
  const gexProfile = useMemo(() => computeGEXProfile(chartRows, chartSpot, dataMode), [chartRows, chartSpot, dataMode]);

  const C = {
    bg: "#05060A",
    cyan: "#219EBC",
    purple: "#126783",
    orange: "#FB8501",
    green: "#8ECAE6",
    red: "#EF4444",
  };

  // GEX|ES Candles switch. An element, not a component — it gets handed to
  // whichever dock is mounted (GexToolbar's or the embedded ES Candles page's)
  // via their `leading` slot, so switching views never costs a toolbar row.
  // Declared here, below the state it closes over and above the JSX that uses it.
  const gexViewSwitch = (
    <div style={{ display: "flex", gap: 2, border: "1px solid rgba(33,158,188,0.18)", borderRadius: 8, overflow: "hidden", flexShrink: 0 }}>
      {([
        { id: "gex", label: "GEX" },
        { id: "escandles", label: "ES Candles" },
      ] as const).map((v) => (
        <button
          key={v.id}
          onClick={() => setGexView(v.id)}
          style={{
            padding: "7px 12px",
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            whiteSpace: "nowrap",
            cursor: "pointer",
            border: "none",
            fontFamily: "inherit",
            background: gexView === v.id ? "rgba(33,158,188,0.16)" : "transparent",
            color: gexView === v.id ? C.cyan : "#5a7a98",
          }}
        >
          {v.label}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, width: "100%", overflow: "hidden", backgroundColor: C.bg, backgroundImage: "radial-gradient(circle at 15% 50%, rgba(33,158,188,0.02) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(18,103,131,0.03) 0%, transparent 50%)", fontFamily: "var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif", color: "#fff", display: "flex", flexDirection: "column" }}>
      {isStatic && (
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            flexWrap: "wrap",
            padding: "18px 24px",
            background: "rgba(33,158,188,0.10)",
            borderBottom: `1px solid ${C.cyan}55`,
            fontSize: 17,
            textAlign: "center",
          }}
        >
          <span style={{ fontWeight: 800, color: C.cyan, letterSpacing: "0.04em", fontSize: 17 }}>DELAYED PREVIEW</span>
          <span style={{ opacity: 0.75 }}>
            {lastSnapshotTs
              ? `Snapshot from ${Math.max(0, Math.round((Date.now() - lastSnapshotTs) / 60000))} min ago — refreshes ~every 30 min`
              : "Waiting on the next scheduled snapshot"}
          </span>
          <span style={{ opacity: 0.9 }}>
            Go live with <strong style={{ color: C.green }}>20% off</strong> — code <strong style={{ color: C.cyan }}>LAUNCH</strong>
          </span>
          <Link href="/pricing" style={{ textDecoration: "none" }}>
            <button
              style={{
                padding: "12px 26px",
                borderRadius: 10,
                border: "none",
                background: `linear-gradient(180deg, ${C.cyan}, #00b8c4)`,
                color: "#04121a",
                fontSize: 17,
                fontWeight: 800,
                cursor: "pointer",
                boxShadow: "0 0 28px 6px rgba(255,255,255,0.55)",
              }}
            >
              See plans →
            </button>
          </Link>
        </div>
      )}
      <main className="home-no-hover" style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", minWidth: 0 }}>
        <div className="home-split" style={{ flex: 1, display: "flex", flexDirection: "row", padding: "24px", gap: 32, minHeight: 0, overflow: "hidden" }}>
          <div className="home-col home-col-left" style={{ width: "55%", display: "flex", flexDirection: "column", minWidth: 0, height: "100%", overflow: "hidden", minHeight: 0 }}>
            <div ref={gexContainerRef} style={{ background: "rgba(13,17,25,0.85)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.10)", display: econSize === "full" ? "none" : "flex", flexDirection: "column", flex: "1.6 1 0", minHeight: 0, overflow: "hidden" }}>
              {/* Full-featured toolbar — scales to fit instead of scrolling.
                  min is deliberately low: at 0.6 the bar still overflowed on
                  ~1280px-wide windows and fell back to a hidden scrollbar,
                  which read as "cut off".
                  Unmounted in ES Candles view: every control on it (gex mode,
                  data mode, OI/DEX/flip, ghosts, expiry, snap target) drives the
                  bar chart only. The embedded ES Candles page brings its own
                  dock, and the view switcher rides inside whichever of the two is
                  showing — so neither view pays for an extra toolbar row. */}
              {gexView === "gex" && (
              <FitScale min={0.42}>
              <GexToolbar
                leading={gexViewSwitch}
                gexMode={gexMode}
                dataMode={dataMode}
                showOI={showOI}
                showDex={showDex}
                showFlipCurve={showFlipCurve}
                expirations={expiryOptions.map(o => o.value)}
                selectedExpiry={selectedExpiry}
                onExpiry={handleExpiry}
                onGexMode={setGexMode}
                onDataMode={setDataMode}
                showGhost5={showGhost5}
                showGhost15={showGhost15}
                showGhost30={showGhost30}
                onToggleOI={() => setShowOI(v => !v)}
                onToggleDex={() => setShowDex(v => !v)}
                onToggleFlip={() => setShowFlipCurve(v => !v)}
                onToggleGhost5={() => { setShowGhost5(v => !v); setShowGhost15(false); setShowGhost30(false); }}
                onToggleGhost15={() => { setShowGhost15(v => !v); setShowGhost5(false); setShowGhost30(false); }}
                onToggleGhost30={() => { setShowGhost30(v => !v); setShowGhost5(false); setShowGhost15(false); }}
                onRefresh={handleRefresh}
                containerRef={gexChartRef}
                discordMessage={`NET GEX • ${selectedExpiry}`}
              />
              </FitScale>
              )}
              {/* Levels strip — NET GEX / walls / flip / CB / max pain, in the
                  empty band above the chart, right-aligned. Same in-scope live
                  values as the heatmap stat bar so it always agrees with the
                  chart. (Pop-up alerts will hook off these tiles later.) */}
              {gexView === "gex" && (
              <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 6, padding: "0 10px 6px", flexShrink: 0 }}>
                {[
                  { label: "Net GEX",   value: fmtMoneyB(netGex), color: netGex >= 0 ? C.green : C.red },
                  { label: "Call Wall", value: (callWallOiVol ?? callWall) != null ? formatStrikeValue((callWallOiVol ?? callWall)!) : "—", color: C.green },
                  { label: "Put Wall",  value: (putWallOiVol ?? putWall) != null ? formatStrikeValue((putWallOiVol ?? putWall)!) : "—", color: C.red },
                  { label: "Flip",      value: flipPoint != null ? formatStrikeValue(flipPoint) : "—", color: C.orange },
                  { label: "CB",        value: mvcStrike != null ? formatStrikeValue(mvcStrike) : "—", color: C.purple },
                  { label: "Max Pain",  value: maxPainStrike != null ? formatStrikeValue(maxPainStrike) : "—", color: C.cyan },
                  { label: "+1σ (EM)",  value: emLevels.up != null ? formatStrikeValue(emLevels.up) : "—", color: C.green },
                  { label: "−1σ (EM)",  value: emLevels.down != null ? formatStrikeValue(emLevels.down) : "—", color: C.red },
                  { label: "+GEX %",    value: posGexPct != null ? `${posGexPct.toFixed(0)}%` : "—", color: posGexPct == null ? C.cyan : posGexPct >= 50 ? C.green : C.red },
                  { label: "Bull/Bear", value: flowBull != null ? `${flowBull} / ${100 - flowBull}` : "—", color: flowBull == null ? C.cyan : flowBull >= 50 ? C.green : C.red },
                ].map((t) => (
                  <div key={t.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, background: "rgba(13,17,25,0.35)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "3px 10px", minWidth: 64 }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.75)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{t.label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 800, color: t.color }}>{t.value}</span>
                  </div>
                ))}
              </div>
              )}
              {/* Chart canvas — uses fast gex-chain data. Held behind a loader
                  until the server reports OI + greeks are warm, so a half-built
                  / inflated frame never renders. */}
              <div ref={gexChartRef} style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
                {gexView === "escandles" ? (
                  <EsCandlesPage embedded leading={gexViewSwitch} />
                ) : chartReady && chartRows.length > 0 ? (
                  <GexChart
                    chain={chartRows}
                    spotPrice={chartSpot}
                    flipPoint={flipPoint}
                    gexProfile={gexProfile}
                    mode={gexMode}
                    dataMode={dataMode}
                    showOI={showOI}
                    showDex={showDex}
                    showFlipCurve={showFlipCurve}
                    baselines={chartBaselines}
                    showGhost5={showGhost5}
                    showGhost15={showGhost15}
                    showGhost30={showGhost30}
                    expiry={selectedExpiry}
                    onStrikeClick={(row, pos) => setSelectedStrike({ row, pos })}
                  />
                ) : (
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "#05080d" }}>
                    <style>{`@keyframes gexspin{to{transform:rotate(360deg)}}`}</style>
                    <div style={{ width: 44, height: 44, borderRadius: "50%", border: `3px solid rgba(33,158,188,0.15)`, borderTopColor: C.cyan, animation: "gexspin 0.8s linear infinite" }} />
                    <div style={{ color: C.cyan, fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em" }}>Loading SPX chain…</div>
                    <div style={{ color: "#5a6b85", fontSize: 12, letterSpacing: "0.06em" }}>Warming OI &amp; greeks for accurate GEX</div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ background: "rgba(13,17,25,0.85)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.10)", display: "flex", flexDirection: "column", flex: econSize === "min" ? "0 0 auto" : 1, minHeight: 0, overflow: "hidden", marginTop: econSize === "full" ? 0 : 24 }}>
              {/* Tabs + right-side controls scale down together so the size
                  buttons / discord / refresh never get pushed out of the card
                  on a narrow window. */}
              <FitScale min={0.42}>
              <div className="grad-divider-b tab-strip" style={{ display: "flex", flexShrink: 0, whiteSpace: "nowrap" }}>
                {([
                  { id: "calendar", label: "Economic Calendar", icon: <CalendarIcon /> },
                  { id: "flow", label: "Flow", icon: <FlowIcon /> },
                  { id: "whale", label: "Whale", icon: <WhaleIcon /> },
                  { id: "greeks", label: "Greeks", icon: <GreeksIcon /> },
                  { id: "scanner", label: "Scanner", icon: <ScannerIcon /> },
                ] as const).map((tab) => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap", flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: activeTab === tab.id ? C.cyan : "#fff", borderBottom: activeTab === tab.id ? `2px solid ${C.cyan}` : "2px solid transparent", marginBottom: -1 }}>
                    {tab.icon}{tab.label}
                  </button>
                ))}
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, paddingRight: 4, flexShrink: 0 }}>
                  <div ref={econControlsSlotRef} style={{ display: "flex", alignItems: "center", gap: 6 }} />
                  <EconCalendarTemplateCopyBtn />
                  <EconCalendarDiscordBtn />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 2, paddingLeft: 4, paddingRight: 8, flexShrink: 0 }}>
                  {([
                    { id: "min", title: "Minimize (tabs only)" },
                    { id: "half", title: "Half height" },
                    { id: "full", title: "Full height" },
                  ] as const).map((o) => {
                    const on = econSize === o.id;
                    // Filled bar grows min→half→full so the glyph reads as a size.
                    const fillY = o.id === "min" ? 11 : o.id === "half" ? 7 : 3;
                    return (
                      <button
                        key={o.id}
                        onClick={() => setEconSize(o.id)}
                        aria-label={o.title}
                        title={o.title}
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 7px", background: on ? "rgba(33,158,188,0.16)" : "none", border: "none", borderRadius: 6, cursor: "pointer", color: on ? C.cyan : "#fff" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16">
                          <rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" opacity={on ? 0.55 : 0.4} />
                          <rect x="2" y={fillY} width="12" height={14 - fillY} rx="1.5" fill="currentColor" />
                        </svg>
                      </button>
                    );
                  })}
                </div>
              </div>
              </FitScale>
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: 24, display: econSize === "min" ? "none" : "block" }}>
                {activeTab === "calendar" && (
                  <div className="tab-panel-embed" style={{ margin: "-24px", height: "calc(100% + 48px)" }}>
                    <EconCalendarPanel controlsPortalEl={econControlsSlotEl} />
                  </div>
                )}
                {activeTab === "flow" && (
                  <div className="tab-panel-embed" style={{ margin: "-24px", height: "calc(100% + 48px)" }}>
                    <FlowNetPremPanel />
                  </div>
                )}
                {activeTab === "whale" && (
                  <div className="tab-panel-embed" style={{ margin: "-24px", height: "calc(100% + 48px)" }}>
                    <WhaleOrdersPanel />
                  </div>
                )}
                {activeTab === "greeks" && (
                  <div className="tab-panel-embed" style={{ margin: "-24px", height: "calc(100% + 48px)" }}>
                    <GreeksHomePanel />
                  </div>
                )}
                {activeTab === "scanner" && (
                  <div className="tab-panel-embed" style={{ margin: "-24px", height: "calc(100% + 48px)" }}>
                    <ScannerHomePanel />
                  </div>
                )}
                {activeTab === "ib" && (
                  <div className="tab-panel-embed" style={{ margin: "-24px", height: "calc(100% + 48px)", overflow: "auto" }}>
                    <IbStatsTab />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="home-col home-col-right" style={{ width: "45%", display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>
            {/* Signals feed — one horizontal row, newest signal leftmost, each with
                a timestamp. Sourced from user-authored public/signals.txt (polled).
                Replaced the NET GEX / CALL WALL / PUT WALL / FLIP / CB / MAX PAIN
                readout, which still lives on the left Levels strip above the chart. */}
            <div className="grad-divider-b" style={{ flexShrink: 0, paddingBottom: 16, marginBottom: 16 }}>
              <HomeGaugeRail gammaPctVol={gaugeMetrics.gammaPctVol} cpg={gaugeMetrics.cpg} ibDirection={ibDirection} />
            </div>

            <div ref={heatmapContainerRef} style={{ background: "rgba(13,17,25,0.85)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.10)", display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
              <div className="grad-divider-b" style={{ paddingBottom: 16, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
                {/* Header row scales to fit — title + intensity/speed controls on
                    the left and refresh/snap/discord/view-switch on the right
                    otherwise overflow the card and get clipped on a narrow window. */}
                <FitScale min={0.42}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, color: "#fff", fontWeight: 700, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    <span style={{ color: C.cyan }}><LayersIcon /></span>
                    {heatmapView === "chain" ? "Option Chain" : "Live GEX Heatmap"}
                    {heatmapView === "chain" && (
                    <>
                      <input
                        value={chainTickerInput}
                        onChange={(e) => setChainTickerInput(e.target.value.toUpperCase())}
                        onBlur={() => setChainTicker((chainTickerInput || "SPX").toUpperCase())}
                        onKeyDown={(e) => { if (e.key === "Enter") setChainTicker((chainTickerInput || "SPX").toUpperCase()); }}
                        list="home-chain-tickers"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="SPX"
                        title="Type a ticker + Enter. Reverts to SPX when you switch tabs."
                        style={{ marginLeft: 10, width: 70, fontSize: 12, fontWeight: 700, padding: "3px 8px", border: "1px solid rgba(33,158,188,0.35)", borderRadius: 6, background: "linear-gradient(180deg,rgba(33,158,188,.12),rgba(33,158,188,.04))", color: C.cyan, outline: "none", textTransform: "uppercase", letterSpacing: "0.08em" }}
                      />
                      <datalist id="home-chain-tickers">
                        {["SPX", "SPY", "QQQ", "NVDA", "TSLA", "AAPL", "META", "AMZN", "MSFT", "GOOGL", "AMD", "NDX"].map((t) => <option key={t} value={t} />)}
                      </datalist>
                    </>
                    )}
                    {heatmapView !== "chain" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
                      <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Intensity</span>
                      <input
                        type="range" min={0.5} max={5} step={0.01}
                        value={intensity}
                        onChange={(e) => setIntensity(Number(e.target.value))}
                        style={{ width: 80, height: 3, accentColor: "#219EBC" }}
                      />
                      <span style={{ fontSize: 10, color: "#219EBC", fontWeight: 700, minWidth: 36, fontFamily: "var(--font-mono)" }}>{intensity.toFixed(2)}x</span>
                      {/* Basis for the SPY 0DTE / QQQ 0DTE columns only. The SPX
                          NET GEX / VOL ONLY GEX columns are unaffected — they
                          already show both bases side by side. */}
                      <span
                        title="Basis for the SPY 0DTE / QQQ 0DTE columns. OI+Vol = open interest + volume (full positioning). Vol Only = today's volume (intraday flow)."
                        style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginLeft: 6, cursor: "help" }}
                      >
                        SPY/QQQ{sideLoading ? " …" : ""}
                      </span>
                      <div style={{ display: "flex", gap: 2, border: "1px solid rgba(33,158,188,0.18)", borderRadius: 4, overflow: "hidden" }}>
                        {([
                          { key: "oi-vol" as GexBasis, label: "OI+Vol", tip: "Open interest + volume — full dealer positioning." },
                          { key: "vol-only" as GexBasis, label: "Vol Only", tip: "Today's volume only — intraday flow, resets daily." },
                        ]).map((b) => (
                          <button
                            key={b.key}
                            onClick={() => setSideBasis(b.key)}
                            title={b.tip}
                            style={{
                              padding: "2px 7px",
                              fontSize: 10,
                              fontWeight: 700,
                              cursor: "pointer",
                              border: "none",
                              fontFamily: "inherit",
                              background: sideBasis === b.key ? "rgba(33,158,188,0.14)" : "transparent",
                              color: sideBasis === b.key ? "#219EBC" : "#5a7a98",
                            }}
                          >
                            {b.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 12 }}>
                    {heatmapView !== "chain" && (
                    <>
                    <div style={{ fontSize: 12, color: "#8da8c2", fontWeight: 700, marginRight: 4, whiteSpace: "nowrap" }}>{fmtExpiryLabel(selectedExpiry, expiryOptions.find((option) => option.value === selectedExpiry)?.label ?? "")}</div>
                    <button onClick={heatmapRefresh} title="Refresh heatmap"
                      style={{ background: "rgba(33,158,188,0.06)", border: "1px solid rgba(33,158,188,0.25)", color: (heatmapRefreshStyle.color as string) ?? C.cyan, borderRadius: 2, padding: "2px 6px", fontSize: 14, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, transition: "color .2s" }}>{heatmapRefreshLabel.startsWith("✓") ? "✓" : heatmapRefreshLabel.startsWith("✗") ? "✗" : heatmapRefreshLabel.startsWith("↻ Refresh") ? "⟳" : "↻"}</button>
                    <BoxSnapBtn targetRef={heatmapBodyRef} label="GEX Heatmap" title={`SPX GEX Heatmap  •  ${heatmapTitleDate}`} />
                    <BoxDiscordBtn targetRef={heatmapBodyRef} label="GEX Heatmap" message={`GEX Heatmap • ${selectedExpiry}`} title={`SPX GEX Heatmap  •  ${heatmapTitleDate}`} />
                    </>
                    )}
                    {/* Δ stamps — adds the change to the left of the NET GEX value on
                        the top 5 strikes each side. Heatmap view only. */}
                    {heatmapView === "heatmap" && (
                      <div style={{ display: "flex", gap: 2, marginLeft: 4, border: "1px solid rgba(33,158,188,0.18)", borderRadius: 4, overflow: "hidden" }}>
                        {([0, 5, 15, 30] as const).map((v) => (
                          <button
                            key={v}
                            onClick={() => setDeltaWindow(v)}
                            title={v === 0 ? "Hide change stamps" : `Show each ranked strike's net GEX change over the last ${v} minutes`}
                            style={{
                              padding: "2px 8px", fontSize: 10, fontWeight: 700,
                              textTransform: "uppercase", letterSpacing: "0.08em",
                              cursor: "pointer", border: "none", fontFamily: "inherit",
                              background: deltaWindow === v ? "rgba(33,158,188,0.14)" : "transparent",
                              color: deltaWindow === v ? "#219EBC" : "#5a7a98",
                            }}
                          >{v === 0 ? "\u0394 off" : `${v}m`}</button>
                        ))}
                      </div>
                    )}
                    {/* Heatmap|Chain switch — pinned as the LAST child so it sits at the
                        panel's right edge and never shifts when the heatmap-only controls
                        above it hide in Chain view. */}
                    <div style={{ display: "flex", gap: 2, marginLeft: 4, border: "1px solid rgba(33,158,188,0.18)", borderRadius: 4, overflow: "hidden" }}>
                      {(["heatmap", "chain"] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => setHeatmapView(v)}
                          style={{
                            padding: "2px 10px",
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            cursor: "pointer",
                            border: "none",
                            fontFamily: "inherit",
                            background: heatmapView === v ? "rgba(33,158,188,0.14)" : "transparent",
                            color: heatmapView === v ? "#219EBC" : "#5a7a98",
                          }}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                </FitScale>
              </div>

              <div ref={heatmapBodyRef} style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative", background: "#05080d" }}>
                {heatmapView === "chain" ? (
                  <OptionsChainPage expirySelection="sequential" expiryCount={5} ticker={chainTicker} showGrandTotal={false} />
                ) : (
                <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
                <table style={{ flex: 1, minWidth: 0, height: "100%", textAlign: "right", fontSize: 10, fontFamily: "var(--font-mono)", whiteSpace: "nowrap", borderCollapse: "collapse", tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "9%" }} />
                    <col style={{ width: "19%" }} />
                    <col style={{ width: "19%" }} />
                    <col style={{ width: "17%" }} />
                    <col style={{ width: "17%" }} />
                    <col style={{ width: "19%" }} />
                  </colgroup>
                  <thead style={{ fontSize: 10, color: "#fff", textTransform: "uppercase", letterSpacing: "0.1em", position: "sticky", top: 0, zIndex: 10, background: "rgba(13,17,25,0.95)" }}>
                    <tr>
                      {[
                        { label: "Strike", tip: undefined as string | undefined },
                        {
                          label: deltaWindow !== 0 && heatmapView === "heatmap" ? `Net GEX +\u0394${deltaWindow}M` : "Net GEX",
                          tip: deltaWindow !== 0 && heatmapView === "heatmap"
                            ? `Each ranked strike (top 5 each side) carries a stamp with its net GEX change over the last ${deltaWindow} minutes. \u25B2 green = building, \u25BC red = unwinding. Hover a stamp for the exact figure.`
                            : undefined,
                        },
                        { label: "Vol Only GEX", tip: undefined },
                        { label: "DEX", tip: undefined },
                        {
                          label: `SPY ${sideDteTag} Net GEX`,
                          tip: `SPY's net GEX on ${sideGex.SPY?.expiration ?? selectedExpiry} — the same contract the SPX heatmap is on — at the SAME distance from ATM as this SPX row (SPY doesn't share SPX's strike ladder, so rows align by moneyness offset, not strike). Basis: ${sideBasis === "vol-only" ? "volume only" : "OI + volume"}. Hover a cell for the SPY strike.`,
                        },
                        {
                          label: `QQQ ${sideDteTag} Net GEX`,
                          tip: `QQQ's net GEX on ${sideGex.QQQ?.expiration ?? selectedExpiry} — the same contract the SPX heatmap is on — at the SAME distance from ATM as this SPX row (QQQ tracks NDX, so rows align by moneyness offset, not strike). Basis: ${sideBasis === "vol-only" ? "volume only" : "OI + volume"}. Hover a cell for the QQQ strike.`,
                        },
                      ].map((header, index) => (
                        <th
                          key={header.label}
                          title={header.tip}
                          style={{ padding: "6px 16px", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.06)", textAlign: index === 0 || heatmapView === "table" ? "left" : "right", color: "#fff", cursor: header.tip ? "help" : undefined }}
                        >
                          {header.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapRows.map((row, index) => {
                      const isAtm = row.type === "atm";
                      const showDivider = index > 0 && heatmapRows[index - 1]?.type === "atm";
                      const rowKey = `${row.strike}-${index}`;
                      const rowStyle: React.CSSProperties = {
                        background: isAtm ? "linear-gradient(to right, rgba(33,158,188,0.08), rgba(33,158,188,0.04), rgba(33,158,188,0.08))" : "transparent",
                        transition: "background 0.15s",
                        position: "relative",
                        // Distribute rows evenly into the available height so the
                        // heatmap stretches to fill the panel at any screen size.
                        height: heatmapRows.length ? `${100 / heatmapRows.length}%` : undefined,
                      };

                      // Light white frame drawn around the full ATM row (top/bottom on
                      // every cell, plus a right edge on the final column).
                      const atmBorder = "1px solid rgba(255,255,255,0.55)";

                      // Left-anchored gradient bar (table view): width 0–100% scaled to the
                      // column max, grows rightward from the left edge. Green = positive,
                      // red = negative. Higher magnitude → darker/deeper gradient.
                      const barEl = (value: number | null, colKey: string) => {
                        if (value == null || !Number.isFinite(value)) return null;
                        const max = heatmapColorMeta.max[colKey] ?? 1;
                        const ratio = Math.min(Math.abs(value) / (max || 1), 1);
                        const pct = ratio * 90; // biggest bar fills 90% of the cell
                        if (!pct) return null;
                        const pos = value >= 0;
                        // Vibrant gradient: bright leading edge → saturated deep base.
                        // Opacity deepens with magnitude so big bars read as more intense.
                        const a = 0.5 + ratio * 0.5;
                        const light = pos
                          ? `rgba(74,255,150,${a.toFixed(2)})`
                          : `rgba(255,86,110,${a.toFixed(2)})`;
                        const dark = pos
                          ? `rgba(0,140,70,${a.toFixed(2)})`
                          : `rgba(190,20,40,${a.toFixed(2)})`;
                        return (
                          <div style={{
                            position: "absolute",
                            top: 3,
                            bottom: 3,
                            left: 0,
                            width: `${pct}%`,
                            background: `linear-gradient(90deg, ${dark} 0%, ${light} 100%)`,
                            borderRadius: 2,
                            pointerEvents: "none",
                          }} />
                        );
                      };

                      // Numeric cell: heatmap view paints a background; table view draws a bar.
                      const dataCell = (text: string, value: number | null, colKey: string, colIdx: number, title?: string) => {
                        const isTable = heatmapView === "table";
                        const base: React.CSSProperties = { position: "relative", padding: "0 16px", textAlign: isTable ? "left" : "right", lineHeight: 1.1, overflow: "hidden" };
                        const bg = isTable || value == null
                          ? "transparent"
                          : metricBg(value, heatmapColorMeta.max[colKey] ?? 1, intensity, heatmapColorMeta.top3[colKey] ?? []);
                        const atmEdges: React.CSSProperties = isAtm
                          ? { borderTop: atmBorder, borderBottom: atmBorder, ...(colIdx === 5 ? { borderRight: atmBorder } : {}) }
                          : {};
                        // Column peak (SPY/QQQ) — same white box + glow as the SPX NET GEX peak.
                        const isPeak = !isTable && peakStrikeByCol[colKey] != null && row.strikeNum === peakStrikeByCol[colKey];
                        return (
                          <td key={colIdx} title={title} className={isPeak ? "mvc-peak-cell" : undefined} style={{ ...base, ...atmEdges, background: bg, fontWeight: isAtm ? 700 : 400, color: isAtm ? "rgba(255,255,255,0.82)" : SOFT_WHITE, ...(isPeak ? { border: "3px solid #ffffff", zIndex: 2 } : {}) }}>
                            {isTable
                              ? barEl(value, colKey)
                              : <span style={{ position: "relative", zIndex: 1 }}><SignVal text={text} /></span>}
                          </td>
                        );
                      };

                      return (
                        <React.Fragment key={rowKey}>
                          {showDivider && (
                            <tr>
                              <td colSpan={6} style={{ padding: 0, height: 1, background: "linear-gradient(to right, transparent, rgba(33,158,188,0.15), rgba(18,103,131,0.10), transparent)" }} />
                            </tr>
                          )}
                          <tr
                            className={isAtm ? "heatmap-row-atm" : "heatmap-row"}
                            style={{ ...rowStyle, cursor: "pointer" }}
                            onClick={(e) => {
                              const full = chartRowByStrike.get(Number(row.strike));
                              if (full) setSelectedStrike({ row: full, pos: { x: e.clientX, y: e.clientY } });
                            }}
                            onMouseEnter={(e) => armStrikeHover({ strike: Number(row.strike), x: e.clientX, y: e.clientY })}
                            onMouseLeave={cancelStrikeHover}
                          >
                            <td style={{ padding: "0 16px", textAlign: "left", fontWeight: 700, color: isAtm ? C.cyan : "#fff", lineHeight: 1.1, overflow: "hidden", ...(isAtm ? { borderTop: atmBorder, borderBottom: atmBorder, borderLeft: atmBorder } : {}) }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {row.strike}
                                {isAtm && <span style={{ color: C.cyan, fontWeight: 900, fontSize: 12, fontFamily: "sans-serif", letterSpacing: "0.1em" }}>ATM</span>}
                              </div>
                            </td>
                            <td key={1} className={heatmapView !== "table" && row.strikeNum === mvcStrikeHeatmap ? "mvc-peak-cell" : undefined} style={{ position: "relative", padding: "0 8px 0 6px", textAlign: "right", lineHeight: 1.1, overflow: "hidden", ...(isAtm ? { borderTop: atmBorder, borderBottom: atmBorder } : {}), background: heatmapView === "table" || row.netGexVal == null ? "transparent" : metricBg(row.netGexVal, heatmapColorMeta.max["netGexVal"] ?? 1, intensity, heatmapColorMeta.top3["netGexVal"] ?? []), fontWeight: isAtm ? 700 : 400, color: isAtm ? "rgba(255,255,255,0.82)" : SOFT_WHITE, ...(heatmapView !== "table" && row.strikeNum === mvcStrikeHeatmap ? { border: "3px solid #ffffff", zIndex: 2 } : {}) }}>
                              {heatmapView === "table" ? (
                                barEl(row.netGexVal, "netGexVal")
                              ) : (
                                <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                                  <span style={{ flexShrink: 0, minWidth: 28, display: "flex", alignItems: "center", gap: 4 }}>
                                    {row.rank && <img src={rankBadgeDataUri(row.rank, row.rankColor ?? "#8B94A7")} width={20} height={13} style={{ display: "block" }} alt={`#${row.rank}`} />}
                                    {deltaWindow !== 0 && <DeltaStamp d={heatmapDeltas[row.strikeNum] ?? null} />}
                                  </span>
                                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                    {row.strikeNum === mvcStrikeHeatmap && (
                                      <span title="CB - Core Bullseye — highest |net GEX|" style={{ color: "#ffd600", fontSize: 12, lineHeight: 1, textShadow: "0 0 3px rgba(0,0,0,.8)" }}>★</span>
                                    )}
                                    <SignVal text={row.netGex} />
                                  </span>
                                </div>
                              )}
                            </td>
                            {dataCell(row.volOnly, row.volOnlyVal, "volOnlyVal", 2)}
                            {dataCell(row.dex, row.dexVal, "dexVal", 3)}
                            {/* SPY / QQQ 0DTE net GEX — same moneyness offset as this SPX row,
                                NOT the same strike. Rendered through the shared dataCell so they
                                use the identical heatmap palette as every other column; each has
                                its own color scale (see heatmapColorMeta). The tooltip names the
                                actual contract so the offset join is never ambiguous. */}
                            {dataCell(
                              row.spyGex,
                              row.spyGexVal,
                              "spyGexVal",
                              4,
                              row.spyStrike == null ? "No SPY strike at this offset" : `SPY ${row.spyStrike} • ${sideBasis === "vol-only" ? "vol only" : "OI+Vol"}`
                            )}
                            {dataCell(
                              row.qqqGex,
                              row.qqqGexVal,
                              "qqqGexVal",
                              5,
                              row.qqqStrike == null ? "No QQQ strike at this offset" : `QQQ ${row.qqqStrike} • ${sideBasis === "vol-only" ? "vol only" : "OI+Vol"}`
                            )}
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Strike detail popup — style switchable via the toolbar toggle. */}
      {selectedStrike && liveSelectedRow && (
        <StrikeDetailPopup
          row={liveSelectedRow}
          spotPrice={chartSpot}
          baselines={strikeBaselines}
          popupStyle={popupStyle}
          anchor={selectedStrike.pos}
          onClose={() => setSelectedStrike(null)}
        />
      )}

      {/* Cursor-anchored hover card — per-side book stats for the hovered strike. */}
      {hoverStrike && hoverSides && (
        <StrikeHoverCard
          ticker="SPX"
          strike={hoverStrike.strike}
          expiration={selectedExpiry}
          calls={hoverSides.calls}
          puts={hoverSides.puts}
          x={hoverStrike.x}
          y={hoverStrike.y}
        />
      )}

      <style>{`
        /* Strip the opaque shell bg from tab panels when embedded in the home card */
        .tab-panel-embed > div:first-child {
          background: transparent !important;
        }
        .grad-divider-b {
          position: relative;
        }
        .grad-divider-b::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(to right, transparent 0%, rgba(255,255,255,0.10) 30%, rgba(255,255,255,0.13) 50%, rgba(255,255,255,0.10) 70%, transparent 100%);
          pointer-events: none;
        }
        .grad-divider-sidebar-t {
          position: relative;
        }
        .grad-divider-sidebar-t::before {
          content: '';
          position: absolute;
          top: 0; left: 12px; right: 12px;
          height: 1px;
          background: linear-gradient(to right, transparent, rgba(255,255,255,0.10) 50%, transparent);
          pointer-events: none;
        }
        /* No position:relative on <tr> — it displaces cells in table layout.
           Row separators / ATM emphasis use border + box-shadow on the cells. */
        .heatmap-row td {
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .heatmap-row-atm td {
          border-top: 1px solid rgba(33,158,188,0.35);
          border-bottom: 1px solid rgba(33,158,188,0.35);
        }
        @keyframes mvcGlow {
          0%, 100% { box-shadow: 0 0 3px rgba(255,255,255,0.35); }
          50%      { box-shadow: 0 0 10px rgba(255,255,255,0.85); }
        }
        .mvc-peak-cell {
          animation: mvcGlow 2.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
