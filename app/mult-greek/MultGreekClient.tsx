"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";
import { HOME_THEME as HT, homeShellStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { Dock, SegGroup, DockButton, DockGap, DockSpacer, DockSlider, DockExpiryPicker } from "@/components/shared/DockToolbar";
// expirations always fetched fresh — no cache import needed

// ── Constants ─────────────────────────────────────────────────────────────────

const TICKERS = ["SPX", "SPY", "QQQ"] as const;
type Ticker = typeof TICKERS[number];

// EM/2xEM row badge, rasterized as an inline SVG data URI rather than live DOM
// text. html2canvas is unreliable rasterizing text this small (7px) — it was
// rendering fine live but vanishing from every screenshot/Discord capture
// (same failure mode already fixed for the home page's heatmap rank badges).
// An <img> bitmap is composited directly, so it always captures correctly.
const emBadgeCache = new Map<string, string>();
function emBadgeDataUri(label: "EM" | "2× EM"): string {
  const cached = emBadgeCache.get(label);
  if (cached) return cached;
  const w = label === "EM" ? 16 : 30, h = 10;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="2" fill="rgba(255,255,255,0.92)"/><text x="${w / 2}" y="${h / 2 + 2.8}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="7" font-weight="800" fill="#0b0f1a">${label}</text></svg>`;
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  emBadgeCache.set(label, uri);
  return uri;
}

// Softer than pure #ffffff — the bright white value text was harsh on the dark
// metric-tinted cells. Used for neutral numeric values / signs.
const SOFT_WHITE = "#c3ccda";

const NET_COLS  = ["gex", "dex", "chex", "vex"] as const;
type NetCol = typeof NET_COLS[number];

const COL_LABELS: Record<NetCol, string> = {
  gex: "NET GEX", dex: "NET DEX", chex: "NET CHEX", vex: "NET VEX",
};

const GRID_COLS = "64px 1fr 1fr 1fr 1fr";

// Stable empty map for SPY/QQQ (no dealer-flow tracking) so passing it as a
// prop doesn't create a new reference every render.
const EMPTY_FLOW_MAP = new Map<number, number>();

// Change-mode: "live" = normal GEX values; 15/30/60 = ΔGEX over N minutes,
// sourced from the strike_growth table (same /proxy/strike-growth/by-expiry
// endpoint the options-chain page uses). That table only tracks GEX, so the
// switcher only ever swaps the NET GEX column — DEX/CHEX/VEX stay live.
const CHANGE_MODES = ["live", "15", "30", "60"] as const;
type ChangeMode = typeof CHANGE_MODES[number];
const CHANGE_MODE_LABEL: Record<ChangeMode, string> = {
  live: "Live",
  "15": "15m Δ",
  "30": "30m Δ",
  "60": "60m Δ",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface LiveEntry {
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
}

interface StrikeRow {
  strike: number;
  callSym: string | null;
  putSym: string | null;
}

interface ComputedRow {
  strike: number;
  isATM: boolean;
  gex: number;
  dex: number;
  chex: number;
  vex: number;
}

interface ComputedResult {
  rows: ComputedRow[];
  maxAbs: Record<NetCol, number>;
  top3: Record<NetCol, Record<number, number>>;
  atmStrike: number;
  mvcStrike: number | null;
}

interface Expiry {
  date: string;
  daysTo: number;
  label: string;
}

/** Frozen full-chain snapshot shape written by
 *  server-v2/mult-greek-snapshot-recorder.js — one shared expiry, raw TT chain
 *  `items` + underlyingPrice per ticker. Same inputs buildStrikes() already
 *  parses for the live path, so the delayed render reuses all the same code. */
export interface MultGreekSnapshot {
  expiry: string;
  tickers: Partial<Record<Ticker, { items: unknown[]; underlyingPrice: number }>>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayETStr(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const m: Record<string, string> = {};
  parts.forEach(p => { m[p.type] = p.value; });
  return `${m.year}-${m.month}-${m.day}`;
}

function daysTo(dateStr: string): number {
  return Math.round((new Date(dateStr).getTime() - new Date(todayETStr()).getTime()) / 86400000);
}

// True when `iso` (YYYY-MM-DD) is in the CURRENT trading week (Mon–Fri, ET).
// The DB-stored weekly EM only applies to current-week expirations.
function isCurrentWeekExp(iso: string): boolean {
  if (!iso) return false;
  const now = new Date(todayETStr() + "T12:00:00");
  const dow = now.getDay(); // 0=Sun..6=Sat
  const monday = new Date(now);
  const toMon = dow === 0 ? 1 : 1 - dow;
  monday.setDate(now.getDate() + toMon);
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);
  const d = new Date(iso + "T12:00:00");
  return d >= monday && d <= friday;
}

// Snap a target price to the nearest value present in `strikes`.
function nearestStrikeTo(target: number, strikes: number[]): number | null {
  if (!Number.isFinite(target) || !strikes.length) return null;
  let best = strikes[0];
  let bestD = Math.abs(strikes[0] - target);
  for (const s of strikes) {
    const dd = Math.abs(s - target);
    if (dd < bestD) { bestD = dd; best = s; }
  }
  return best;
}

function isMarketOpen(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(new Date());
  const m: Record<string, string> = {};
  parts.forEach(p => { m[p.type] = p.value; });
  if (m.weekday === "Sat" || m.weekday === "Sun") return false;
  const mins = parseInt(m.hour) * 60 + parseInt(m.minute);
  return mins >= 570 && mins < 960;
}

function fmtMoney(v: number): { sign: string; value: string } {
  const n = parseFloat(String(v));
  if (!isFinite(n) || n === 0) return { sign: "", value: "--" };
  const s = n >= 0 ? "+" : "-";
  const a = Math.abs(n);
  return { sign: s, value: "$" + (a / 1e6).toFixed(2) + "M" };
}

function metricBg(value: number, maxValue: number, topRank: number, intensity: number): string {
  const n = parseFloat(String(value)) || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return "transparent";
  const pos = n >= 0;
  if (topRank === 1) return pos ? "rgba(41,182,246,0.90)" : "rgba(255,71,87,0.90)";
  if (topRank === 2) return pos ? "rgba(41,182,246,0.45)" : "rgba(255,71,87,0.45)";
  if (topRank === 3) return pos ? "rgba(41,182,246,0.25)" : "rgba(255,71,87,0.25)";
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio * (intensity || 0.1), 1.4);
  const alpha = Math.min(0.18, 0.02 + eased * 0.16);
  return pos ? `rgba(41,182,246,${alpha.toFixed(2)})` : `rgba(255,71,87,${alpha.toFixed(2)})`;
}

// ── Build strikes from chain JSON ─────────────────────────────────────────────

function buildStrikes(expGroups: unknown[], liveData: Record<string, LiveEntry>): StrikeRow[] {
  const map: Record<string, StrikeRow> = {};
  (expGroups as { strikes?: unknown[] }[]).forEach(expGroup => {
    (expGroup.strikes || []).forEach((item: unknown) => {
      const it = item as Record<string, unknown>;
      const strike = parseFloat(String(it["strike-price"] || 0));
      if (!strike) return;
      const key = strike.toFixed(2);
      if (!map[key]) map[key] = { strike, callSym: null, putSym: null };
      const r = map[key];
      for (const side of ["call", "put"] as const) {
        const o = it[side] as Record<string, unknown> | undefined;
        if (!o) continue;
        const sym = String(o["streamer-symbol"] || o.symbol || "");
        if (side === "call") r.callSym = sym; else r.putSym = sym;
        if (sym && !(liveData[sym]?._ws)) {
          liveData[sym] = {
            iv:    parseFloat(String(o["implied-volatility"])) || undefined,
            delta: parseFloat(String(o.delta)) || undefined,
            gamma: parseFloat(String(o.gamma)) || undefined,
            theta: parseFloat(String(o.theta)) || undefined,
            vega:  parseFloat(String(o.vega))  || undefined,
            oi:    parseInt(String(o["open-interest"] || o.openInterest || 0), 10) || 0,
            vol:   parseInt(String(o.volume || 0), 10) || 0,
          };
        }
      }
    });
  });
  return Object.values(map).sort((a, b) => a.strike - b.strike);
}

function computeRows(
  strikes: StrikeRow[],
  liveData: Record<string, LiveEntry>,
  spot: number,
  contractMode: "oivol" | "vol" | "flow",
  flowGexMap: Map<number, number> | null = null,
): ComputedResult {
  let rows = strikes.slice().sort((a, b) => b.strike - a.strike);
  let atmStrike = 0;
  if (spot > 0 && rows.length) {
    let atmIdx = 0, minDist = Infinity;
    rows.forEach((r, i) => {
      const d = Math.abs(r.strike - spot);
      if (d < minDist) { minDist = d; atmIdx = i; }
    });
    atmStrike = rows[atmIdx].strike;
  }

  const out: ComputedRow[] = rows.map(r => {
    const cd = liveData[r.callSym ?? ""] || {};
    const pd = liveData[r.putSym  ?? ""] || {};
    // Flow mode only swaps the OI/vol basis for GEX itself — DEX/CHEX/VEX stay
    // on the OI+Vol basis (mirrors the home page heatmap's Flow GEX toggle).
    const volOnly = contractMode === "vol";
    const cc = (volOnly ? 0 : (cd.oi ?? 0)) + (cd.vol ?? 0);
    const pc = (volOnly ? 0 : (pd.oi ?? 0)) + (pd.vol ?? 0);
    return {
      strike: r.strike,
      isATM: r.strike === atmStrike,
      // Flow GEX = gamma × dealer inventory × spot², keyed off real dealer
      // inventory (SPX only — SPY/QQQ have no dealer-flow tracking, so the
      // map is empty for them and this falls back to 0).
      gex: contractMode === "flow"
        ? (flowGexMap?.get(r.strike) ?? 0)
        : (Math.abs(cd.gamma ?? 0) * cc - Math.abs(pd.gamma ?? 0) * pc) * spot * spot * 0.01 * 100,
      dex:  (Math.abs(cd.delta ?? 0) * cc - Math.abs(pd.delta ?? 0) * pc) * spot * 100,
      chex: (-(cd.theta ?? 0) * cc + (pd.theta ?? 0) * pc) * spot * 100,
      vex:  ((cd.vega ?? 0) * cc - (pd.vega ?? 0) * pc) * spot * 100,
    };
  });

  const maxAbs = { gex: 1, dex: 1, chex: 1, vex: 1 } as Record<NetCol, number>;
  out.forEach(r => {
    NET_COLS.forEach(c => { if (Math.abs(r[c]) > maxAbs[c]) maxAbs[c] = Math.abs(r[c]); });
  });

  const top3 = {} as Record<NetCol, Record<number, number>>;
  NET_COLS.forEach(c => {
    top3[c] = {};
    [...out].sort((a, b) => Math.abs(b[c]) - Math.abs(a[c]))
      .slice(0, 3)
      .forEach((row, idx) => { top3[c][row.strike] = idx + 1; });
  });

  // MVC = strike with the highest ABSOLUTE net GEX. Gets the gold star.
  let mvcStrike: number | null = null;
  let mvcAbs = 0;
  out.forEach(r => {
    const a = Math.abs(r.gex);
    if (a > mvcAbs) { mvcAbs = a; mvcStrike = r.strike; }
  });

  return { rows: out, maxAbs, top3, atmStrike, mvcStrike };
}

function computeTotals(
  strikes: StrikeRow[],
  liveData: Record<string, LiveEntry>,
  spot: number,
  contractMode: "oivol" | "vol" | "flow",
  flowGexMap: Map<number, number> | null = null,
): Record<NetCol, number> {
  const totals = { gex: 0, dex: 0, chex: 0, vex: 0 } as Record<NetCol, number>;
  const volOnly = contractMode === "vol";

  strikes.forEach(r => {
    const cd = liveData[r.callSym ?? ""] || {};
    const pd = liveData[r.putSym  ?? ""] || {};
    const cc = (volOnly ? 0 : (cd.oi ?? 0)) + (cd.vol ?? 0);
    const pc = (volOnly ? 0 : (pd.oi ?? 0)) + (pd.vol ?? 0);
    totals.gex  += contractMode === "flow"
      ? (flowGexMap?.get(r.strike) ?? 0)
      : (Math.abs(cd.gamma ?? 0) * cc - Math.abs(pd.gamma ?? 0) * pc) * spot * spot * 0.01 * 100;
    totals.dex  += (Math.abs(cd.delta ?? 0) * cc - Math.abs(pd.delta ?? 0) * pc) * spot * 100;
    totals.chex += (-(cd.theta ?? 0) * cc + (pd.theta ?? 0) * pc) * spot * 100;
    totals.vex  += ((cd.vega ?? 0) * cc - (pd.vega ?? 0) * pc) * spot * 100;
  });
  return totals;
}

// ── Ticker Panel ──────────────────────────────────────────────────────────────

function TickerPanel({
  ticker, strikes, liveData, spot, contractMode, intensity, emLevels, showEm, captureWindow,
  changeMode, changeMap, flowGexMap,
}: {
  ticker: Ticker;
  strikes: StrikeRow[];
  liveData: Record<string, LiveEntry>;
  spot: number;
  contractMode: "oivol" | "vol" | "flow";
  intensity: number;
  emLevels: { close: number; em: number } | null;
  showEm: boolean;
  /** When set (screenshot mode), render only this many strikes on each side of
   *  ATM so the shot is centered + compact instead of the full chain. */
  captureWindow: number | null;
  /** Live/15m/30m/60m Δ switcher — only ever affects the NET GEX column. */
  changeMode: ChangeMode;
  changeMap: Map<number, number> | null;
  /** Real dealer-inventory Flow GEX per strike (SPX only; null/empty for
   *  SPY/QQQ, which have no dealer-flow tracking). */
  flowGexMap: Map<number, number> | null;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  const computedFull = strikes.length
    ? computeRows(strikes, liveData, spot, contractMode, flowGexMap)
    : null;

  // Screenshot mode: trim rows to ±captureWindow around the ATM strike so the
  // capture shows a focused window (ATM in the middle) rather than every strike.
  const computed = (() => {
    if (!computedFull || captureWindow == null) return computedFull;
    const rows = computedFull.rows;
    const atmIdx = rows.findIndex(r => r.isATM);
    if (atmIdx < 0) return computedFull;
    const start = Math.max(0, atmIdx - captureWindow);
    const end = Math.min(rows.length, atmIdx + captureWindow + 1);
    return { ...computedFull, rows: rows.slice(start, end) };
  })();

  // EM band strikes (snapped to this panel's strikes). Only when current-week.
  const emStrikes = (showEm && emLevels && computed)
    ? (() => {
        const ss = computed.rows.map(r => r.strike);
        const { close, em } = emLevels;
        return {
          d1: nearestStrikeTo(close - em, ss),
          u1: nearestStrikeTo(close + em, ss),
          d2: nearestStrikeTo(close - 2 * em, ss),
          u2: nearestStrikeTo(close + 2 * em, ss),
        };
      })()
    : null;

  const totals = strikes.length && spot > 0
    ? computeTotals(strikes, liveData, spot, contractMode, flowGexMap)
    : null;

  // When a Δ mode is active, the NET GEX column swaps to strike_growth's
  // ΔGEX values. Scale/ranking (for heat coloring + the ★ top-3 badge) is
  // computed separately over the full strike set, mirroring how `computed`'s
  // own top3/maxAbs are computed pre-capture-trim.
  const isChangeActive = changeMode !== "live" && !!changeMap && changeMap.size > 0;
  const gexChange = (() => {
    if (!isChangeActive || !changeMap) return null;
    const entries: { strike: number; v: number }[] = [];
    strikes.forEach(r => {
      const v = changeMap.get(r.strike);
      if (v != null) entries.push({ strike: r.strike, v });
    });
    const sorted = [...entries].sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    const top3: Record<number, number> = {};
    sorted.slice(0, 3).forEach((e, idx) => { top3[e.strike] = idx + 1; });
    const total = entries.reduce((s, e) => s + e.v, 0);
    return { max: Math.abs(sorted[0]?.v ?? 0) || 1, top3, total };
  })();

  // Highest |GEX| strike on each side of spot → 📍 pin (possible pin/explosive level).
  let pinAbove: number | null = null, pinBelow: number | null = null;
  if (computed) {
    let aAbs = 0, bAbs = 0;
    computed.rows.forEach(r => {
      const a = Math.abs(r.gex);
      if (r.strike > computed.atmStrike && a > aAbs) { aAbs = a; pinAbove = r.strike; }
      else if (r.strike < computed.atmStrike && a > bAbs) { bAbs = a; pinBelow = r.strike; }
    });
  }

  // Auto-scroll to ATM
  useEffect(() => {
    if (!bodyRef.current || !computed?.atmStrike || userScrolledRef.current) return;
    const el = bodyRef.current.querySelector(`[data-strike="${computed.atmStrike}"]`) as HTMLElement | null;
    if (el) {
      const top = el.offsetTop - bodyRef.current.clientHeight / 2 + el.offsetHeight / 2;
      bodyRef.current.scrollTop = Math.max(0, top);
    }
  });

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const mark = () => { userScrolledRef.current = true; };
    body.addEventListener("wheel", mark, { passive: true });
    body.addEventListener("touchstart", mark, { passive: true });
    return () => { body.removeEventListener("wheel", mark); body.removeEventListener("touchstart", mark); };
  }, []);

  // During capture (rows trimmed to a compact window), collapse to hug the
  // trimmed content's actual height instead of staying pinned to fill the
  // full column height — otherwise the capture is a small table sitting atop
  // a tall blank void. See the isCapturing note in MultGreekClient above.
  const isCapturing = captureWindow != null;

  return (
    // "budget" variant = classicCardAccentStyle, the exact radial-glow-over-
    // panelBg background this panel already used inline — sourced from the
    // shared Card primitive instead of a hand-rolled duplicate now.
    <Card
      variant="budget"
      padding={0}
      style={{ flex: isCapturing ? "0 0 auto" : 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: isCapturing ? "visible" : "hidden", borderRadius: 16 }}
    >
      <style>{`@keyframes mvcGlow{0%,100%{box-shadow:0 0 3px rgba(255,255,255,.35)}50%{box-shadow:0 0 10px rgba(255,255,255,.85)}}.mvc-peak-cell{animation:mvcGlow 2.4s ease-in-out infinite}`}</style>

      {/* Panel header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "rgba(33,158,188,0.04)", borderBottom: `1px solid ${HT.border}`, flexShrink: 0 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: HT.cyan, letterSpacing: "0.1em" }}>{ticker}</span>
        <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 17, fontFamily: "var(--font-mono)", color: "#94a3b8" }}>
          {spot > 0 && (
            <>
              <span style={{ color: HT.cyan, fontWeight: 700 }}>{spot.toFixed(2)}</span>
            </>
          )}
          {spot === 0 && <span style={{ color: "#475569" }}>--</span>}
        </div>
      </div>

      {/* Column headers */}
      <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, background: HT.panelBgStrong, borderBottom: `1px solid ${HT.border}`, flexShrink: 0 }}>
        <div style={{ padding: "5px 4px", textAlign: "center", color: HT.muted, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>STRIKE</div>
        {NET_COLS.map(c => {
          const isChangeCol = c === "gex" && isChangeActive;
          const isFlowCol = c === "gex" && !isChangeActive && contractMode === "flow";
          return (
            <div key={c} style={{ padding: "5px 4px", textAlign: "center", color: isChangeCol ? HT.orange : isFlowCol ? HT.green : HT.cyan, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {COL_LABELS[c]}{isChangeCol ? ` ·Δ${changeMode}` : isFlowCol ? " ·FLOW" : ""}
            </div>
          );
        })}
      </div>

      {/* Totals row */}
      <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, background: "rgba(33,158,188,0.02)", borderBottom: `1px solid ${HT.border}`, flexShrink: 0 }}>
        <div style={{ padding: "4px 4px", fontSize: 9, fontWeight: 800, textAlign: "center", color: HT.muted, letterSpacing: "0.06em" }}>TOTAL</div>
        {NET_COLS.map(c => {
          const isChangeCol = c === "gex" && isChangeActive;
          const v = isChangeCol ? (gexChange?.total ?? 0) : (totals?.[c] ?? 0);
          const fmt = (isChangeCol ? gexChange != null : totals != null) ? fmtMoney(v) : { sign: "", value: "--" };
          return (
            <div key={c} style={{
              padding: "4px 4px", fontSize: 10, fontWeight: 800, fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              textAlign: "center",
              color: v > 0 ? "#29b6f6" : v < 0 ? "#ff4757" : "#94a3b8",
            }}>
              <span style={{ color: v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : SOFT_WHITE }}>{fmt.sign}</span>{fmt.value}
            </div>
          );
        })}
      </div>

      {/* Body */}
      <div ref={bodyRef} style={{ flex: isCapturing ? "0 0 auto" : 1, overflowY: isCapturing ? "visible" : "auto", minHeight: 0 }}>
        {!computed ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, fontSize: 11, color: "#475569", }}>
            Select an expiry and click GO
          </div>
        ) : computed.rows.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, fontSize: 11, color: "#475569", }}>
            No strikes in range
          </div>
        ) : computed.rows.map(r => {
          // ATM is marked by the white border alone — no gold tint on the row
          // or strike text.
          const strikeColor = "#94a3b8";
          const rowBg = "transparent";
          // Plain `border` (not `outline`) — html2canvas does not render CSS
          // outline at all, so the ATM box vanished from every screenshot/
          // Discord capture even though it showed fine live.
          const atmOutline = r.isATM
            ? { border: "2px solid rgba(255,255,255,.55)", position: "relative" as const, zIndex: 1 }
            : { borderBottom: "1px solid rgba(30,48,80,.35)" };
          const is1x = emStrikes != null && (r.strike === emStrikes.d1 || r.strike === emStrikes.u1);
          const is2x = emStrikes != null && (r.strike === emStrikes.d2 || r.strike === emStrikes.u2);
          const emBorder = is1x
            ? { borderTop: "2px solid rgba(255,255,255,.92)" }
            : is2x
            ? { borderTop: "2px dashed rgba(255,255,255,.85)" }
            : null;
          return (
            <div
              key={r.strike}
              data-strike={r.strike}
              style={{ display: "grid", gridTemplateColumns: GRID_COLS, background: rowBg, position: "relative", ...atmOutline, ...(emBorder ?? {}) }}
            >
              {(is1x || is2x) && (
                <img
                  src={emBadgeDataUri(is1x ? "EM" : "2× EM")}
                  alt={is1x ? "EM" : "2× EM"}
                  style={{ position: "absolute", top: 2, left: 3, zIndex: 3, display: "block", pointerEvents: "none" }}
                />
              )}
              <div style={{
                padding: "4px 4px", fontSize: 11, fontWeight: 800, fontFamily: "var(--font-mono)",
                textAlign: "center", color: strikeColor, borderRight: "1px solid rgba(255,255,255,.06)",
                background: "transparent",
              }}>
                {Number.isInteger(r.strike) ? r.strike : r.strike.toFixed(2)}
              </div>
              {NET_COLS.map(c => {
                const isChangeCol = c === "gex" && isChangeActive;
                const val: number | null = isChangeCol ? (changeMap!.get(r.strike) ?? null) : r[c];
                const topRank = isChangeCol ? ((gexChange?.top3[r.strike]) || 0) : ((computed.top3[c]?.[r.strike]) || 0);
                const scaleMax = isChangeCol ? (gexChange?.max ?? 1) : computed.maxAbs[c];
                const weight = topRank === 1 ? 900 : topRank ? 800 : 700;
                const border = topRank === 1
                  ? `outline:1px solid ${(val ?? 0) >= 0 ? "rgba(41,182,246,.9)" : "rgba(255,71,87,.9)"};outline-offset:-1px`
                  : "";
                const formatted = val == null ? { sign: "", value: "--" } : fmtMoney(val);
                const signColor = val == null ? SOFT_WHITE : val > 0 ? "#22c55e" : val < 0 ? "#ef4444" : SOFT_WHITE;
                const isGexPeak = c === "gex" && !isChangeCol && r.strike === computed.mvcStrike;
                return (
                  <div key={c} className={isGexPeak ? "mvc-peak-cell" : undefined} style={{
                    padding: "4px 4px", fontSize: 11, fontFamily: "var(--font-mono)",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    textAlign: "center", color: SOFT_WHITE,
                    background: val == null ? "transparent" : metricBg(val, scaleMax, topRank, intensity),
                    fontWeight: weight,
                    position: "relative",
                    ...(topRank === 1 && val != null ? { outline: `1px solid ${val >= 0 ? "rgba(41,182,246,.9)" : "rgba(255,71,87,.9)"}`, outlineOffset: "-1px", zIndex: 1 } : {}),
                    ...(isGexPeak ? { outline: "3px solid #ffffff", outlineOffset: "-3px", zIndex: 2 } : {}),
                  }}>
                    {topRank === 1 && (
                      <span style={{
                        position: "absolute", top: 1, left: 2, fontSize: 9, lineHeight: 1,
                        color: "#ffd600", textShadow: "0 0 2px rgba(0,0,0,.8)", pointerEvents: "none",
                      }}>★</span>
                    )}
                    {c === "gex" && r.strike === computed.mvcStrike && (
                      <span title="CB - Core Bullseye — highest |net GEX|" style={{
                        position: "absolute", top: 1, right: 2, fontSize: 12, lineHeight: 1,
                        color: "#ffd600", textShadow: "0 0 3px rgba(0,0,0,.9)", pointerEvents: "none",
                      }}>★</span>
                    )}
                    {c === "gex" && (r.strike === pinAbove || r.strike === pinBelow) && (
                      <span title="Possible pin or explosive level" style={{
                        position: "absolute", top: 1, left: 2, lineHeight: 1, pointerEvents: "none",
                        display: "inline-flex",
                      }}>
                        <svg width="14" height="17" viewBox="0 0 24 24" fill="#ffffff" stroke="rgba(0,0,0,.55)" strokeWidth={1.5}>
                          <path d="M12 21s7-6.5 7-12A7 7 0 0 0 5 9c0 5.5 7 12 7 12z" />
                          <circle cx="12" cy="9" r="2.3" fill="rgba(0,0,0,.55)" stroke="none" />
                        </svg>
                      </span>
                    )}
                    <span style={{ color: signColor }}>{formatted.sign}</span>{formatted.value}
                  </div>
                );
                void border;
              })}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function MultGreekClient({
  isStatic = false,
  initialSnapshot = null,
  snapshotTs = null,
}: {
  /** Unpaid signed-in viewer: render from a frozen SPX/SPY/QQQ snapshot, never
   *  hit the live /api/chains loop. A lightweight poll picks up the recorder's
   *  next ~30m tick (server-v2/mult-greek-snapshot-recorder.js). */
  isStatic?: boolean;
  initialSnapshot?: MultGreekSnapshot | null;
  /** epoch ms the current snapshot was captured, for the "delayed" banner. */
  snapshotTs?: number | null;
} = {}) {
  const [expirations, setExpirations] = useState<Expiry[]>([]);
  const [activeExpiry, setActiveExpiry] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [contractMode, setContractMode] = useState<"oivol" | "vol" | "flow">("oivol");
  const [intensity, setIntensity] = useState(1.75);
  // Live/15m/30m/60m Δ switcher — swaps NET GEX to strike_growth's ΔGEX.
  const [changeMode, setChangeMode] = useState<ChangeMode>("live");
  const [changeMaps, setChangeMaps] = useState<Record<Ticker, Map<number, number>>>({ SPX: new Map(), SPY: new Map(), QQQ: new Map() });
  const [changeTick, setChangeTick] = useState(0);
  // Real dealer-inventory Flow GEX per strike — SPX only (/proxy/gex carries
  // flowGEX on every gexRow from the live FlowGexAccumulator). SPY/QQQ have no
  // dealer-flow tracking so their maps stay empty and the column reads 0.
  const [flowGexMap, setFlowGexMap] = useState<Map<number, number>>(new Map());
  const [status, setStatus] = useState<{ state: "live" | "loading" | "err" | "idle"; msg: string }>(
    isStatic ? { state: "idle", msg: "DELAYED" } : { state: "idle", msg: "READY" }
  );
  // Embedded in the GEX drawer (?embed=1): keep the SPX/SPY/QQQ panels side by
  // side even though the iframe viewport is below the mobile stack breakpoint.
  const [embed, setEmbed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setEmbed(new URLSearchParams(window.location.search).get("embed") === "1");
  }, []);

  // Per-ticker state
  const [strikes, setStrikes]   = useState<Record<Ticker, StrikeRow[]>>({ SPX: [], SPY: [], QQQ: [] });
  const [spots, setSpots]       = useState<Record<Ticker, number>>({ SPX: 0, SPY: 0, QQQ: 0 });
  // Per-ticker weekly EM (DB-backed via /api/levels) for the EM bands.
  const [emByTicker, setEmByTicker] = useState<Record<Ticker, { close: number; em: number } | null>>({ SPX: null, SPY: null, QQQ: null });
  const liveDataRef = useRef<Record<string, LiveEntry>>({});

  const loadTokenRef = useRef(0);
  const activeExpiryRef = useRef<string | null>(null);

  // Fetch weekly EM for all three tickers. Refreshes when the active expiry
  // changes so the bands stay in sync with each (cache-busted) chain reload.
  // Not gated on isStatic — this is the weekly EM band (DB-backed, not the
  // live GEX feed), fine to keep fresh either way.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(TICKERS.map(async (tk) => {
        const row = await fetch(`/api/levels?ticker=${encodeURIComponent(tk)}`)
          .then(r => r.json()).catch(() => null);
        const em = parseFloat(String(row?.em ?? ""));
        const close = parseFloat(String(row?.close ?? ""));
        const val = Number.isFinite(em) && em > 0 && Number.isFinite(close) && close > 0
          ? { close, em } : null;
        return [tk, val] as const;
      }));
      if (cancelled) return;
      setEmByTicker(prev => {
        const next = { ...prev };
        entries.forEach(([tk, val]) => { next[tk] = val; });
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [activeExpiry]);

  // Fetch real per-strike Flow GEX (SPX only) whenever the FLOW GEX toggle is
  // active. /proxy/gex's gexRows always carry flowGEX (computed live from the
  // FlowGexAccumulator dealer inventory), so this is a plain read, not a mode
  // switch on the server. Re-polled every 15s alongside the other auto-refresh
  // loops so the column doesn't go stale while FLOW GEX stays selected.
  useEffect(() => {
    if (isStatic || contractMode !== "flow") { setFlowGexMap(new Map()); return; }
    let cancelled = false;
    const fetchFlow = async () => {
      try {
        const res = await fetch(`/proxy/gex?basis=flow`, { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (cancelled || !Array.isArray(json?.gexRows)) return;
        const m = new Map<number, number>();
        for (const r of json.gexRows) {
          const strike = Number(r.strike);
          if (Number.isFinite(strike)) m.set(strike, Number(r.flowGEX ?? 0));
        }
        setFlowGexMap(m);
      } catch { /* keep last-known map */ }
    };
    fetchFlow();
    const id = setInterval(fetchFlow, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isStatic, contractMode]);

  // Load the strike→ΔGEX map for each ticker when a change mode is on. Reuses
  // /proxy/strike-growth/by-expiry (same endpoint the options-chain page's
  // Live/15m/30m/60m switcher uses), filtered to the currently active expiry.
  // That table only tracks GEX, so this only ever feeds the NET GEX column.
  useEffect(() => {
    if (changeMode === "live" || !activeExpiry) {
      setChangeMaps({ SPX: new Map(), SPY: new Map(), QQQ: new Map() });
      return;
    }
    let cancelled = false;
    (async () => {
      const key = changeMode === "15" ? "chg15" : changeMode === "30" ? "chg30" : "chg60";
      const entries = await Promise.all(TICKERS.map(async (tk) => {
        try {
          const res = await fetch(`/proxy/strike-growth/by-expiry?symbol=${encodeURIComponent(tk)}`, { cache: "no-store" });
          const j = await res.json().catch(() => null);
          const m = new Map<number, number>();
          if (j?.ok && Array.isArray(j.rows)) {
            for (const row of j.rows) {
              if (String(row.expiry ?? "") !== activeExpiry) continue;
              const v = row[key];
              if (v != null) m.set(Number(row.strike), Number(v));
            }
          }
          return [tk, m] as const;
        } catch {
          return [tk, new Map<number, number>()] as const;
        }
      }));
      if (cancelled) return;
      const next = {} as Record<Ticker, Map<number, number>>;
      entries.forEach(([tk, m]) => { next[tk] = m; });
      setChangeMaps(next);
    })();
    return () => { cancelled = true; };
  }, [changeMode, activeExpiry, changeTick]);

  // Fetch expirations (from cache or API). Skipped entirely in static mode —
  // the snapshot already carries its one expiry, no live search needed.
  useEffect(() => {
    if (isStatic) return;
    const loadExpirations = async () => {
      // Primary: /api/expirations (TT format: { data: { items: [...] } }).
      // Fallback: derive expirations from the chain itself — the expirations
      // endpoint can return empty when the proxy's TT session is cold while the
      // market is closed; the chain endpoint stays populated (0DTE prewarmed).
      const collect = (items: Record<string, unknown>[]): Expiry[] => {
        const seen = new Set<string>();
        const list: Expiry[] = [];
        items.forEach((item) => {
          const d = String(item["expiration-date"] ?? "");
          if (!d || seen.has(d)) return;
          seen.add(d);
          const dt = daysTo(d);
          if (dt < 0) return;
          const expType = String(item["expiration-type"] ?? "").toLowerCase();
          const keep = dt <= 7 || expType === "weekly" || expType === "monthly" || new Date(d + "T12:00:00").getDay() === 5;
          if (!keep) return;
          list.push({ date: d, daysTo: dt, label: `${dt}DTE  ${d.slice(5)}` });
        });
        return list.sort((a, b) => a.daysTo - b.daysTo);
      };

      let list: Expiry[] = [];
      const json = await fetch("/api/expirations?ticker=SPX").then(r => r.json()).catch(() => null);
      if (json?.data?.items?.length) list = collect(json.data.items);

      if (!list.length) {
        const cj = await fetch("/api/chains?ticker=SPX&range=all").then(r => r.json()).catch(() => null);
        const items = (cj?.data?.items ?? []) as Record<string, unknown>[];
        if (items.length) list = collect(items);
      }

      if (!list.length) return;
      setExpirations(list);
      const dte0 = list.find(e => e.daysTo === 0) ?? list[0];
      if (dte0) { setSelectedExpiry(dte0.date); }
    };

    loadExpirations().catch(() => {});
  }, [isStatic]);

  // Fetch chain for all tickers
  const loadAll = useCallback(async (expDate: string, bustCache = false) => {
    if (isStatic) return; // static viewers never hit the live loop
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    setStatus({ state: "loading", msg: "LOADING..." });

    const bust = bustCache ? `&noCache=1` : "";
    const results = await Promise.allSettled(
      TICKERS.map(ticker =>
        fetch(`/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(expDate)}&range=all${bust}`)
          .then(async r => {
            const json = await r.json();
            return { ticker, json, ok: r.ok, status: r.status };
          })
      )
    );

    if (token !== loadTokenRef.current) return;

    const newStrikes: Partial<Record<Ticker, StrikeRow[]>> = {};
    const newSpots: Partial<Record<Ticker, number>> = {};
    const allSymbols = new Set<string>();
    let successCount = 0;
    const errStatuses: number[] = [];

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { ticker, json, ok, status } = result.value as { ticker: Ticker; json: Record<string, unknown>; ok: boolean; status: number };
      if (!ok || json.error) {
        errStatuses.push(status);
        console.error(`[MultGreek] ${ticker} chains failed: HTTP ${status}`, json);
        continue;
      }
      const items = (json.data as Record<string, unknown> | undefined)?.items as unknown[] ?? [];
      if (!items.length) continue;
      const target = (items as { "expiration-date"?: string }[]).filter(i =>
        String(i["expiration-date"] ?? "").slice(0, 10) === expDate.slice(0, 10)
      );
      const parsed = buildStrikes(target.length ? target : items as unknown[], liveDataRef.current);
      parsed.forEach(row => {
        if (row.callSym) allSymbols.add(row.callSym);
        if (row.putSym) allSymbols.add(row.putSym);
      });
      if (parsed.length) { newStrikes[ticker] = parsed; successCount++; }
      const rawSpot = parseFloat(String((json.data as Record<string, unknown> | undefined)?.underlyingPrice ?? 0));
      if (isFinite(rawSpot) && rawSpot > 0) newSpots[ticker] = rawSpot;
    }

    activeExpiryRef.current = expDate;
    setActiveExpiry(expDate);
    if (successCount > 0) {
      setStrikes(prev => ({ ...prev, ...newStrikes }));
      setSpots(prev => {
        const merged = { ...prev };
        (Object.keys(newSpots) as Ticker[]).forEach(tk => {
          const v = newSpots[tk as Ticker];
          if (v && v > 0) merged[tk as Ticker] = v;
        });
        return merged;
      });
    }

    if (successCount === 0) {
      const code = errStatuses[0] ?? "?";
      setStatus({ state: "err", msg: `PROXY ERR ${code}` });
    } else if (successCount < TICKERS.length) {
      setStatus({ state: "live", msg: `PARTIAL (${successCount}/${TICKERS.length})` });
    } else {
      setStatus({ state: isMarketOpen() ? "live" : "idle", msg: isMarketOpen() ? "LIVE" : "CLOSED" });
    }
  }, [isStatic]);


  const doGo = useCallback(() => {
    if (isStatic || !selectedExpiry) return;
    loadAll(selectedExpiry);
  }, [isStatic, selectedExpiry, loadAll]);

  // Auto-load when expirations are ready
  useEffect(() => {
    if (isStatic) return;
    if (selectedExpiry && strikes.SPX.length === 0 && strikes.SPY.length === 0 && strikes.QQQ.length === 0) {
      loadAll(selectedExpiry);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStatic, selectedExpiry]);

  // Safety net: if expirations never resolved (cold proxy / market closed),
  // still auto-load the prewarmed 0DTE SPX/SPY/QQQ chains by deriving the
  // nearest expiration from the chain response itself.
  useEffect(() => {
    if (isStatic) return;
    const t = setTimeout(async () => {
      if (selectedExpiry || activeExpiryRef.current) return;
      const cj = await fetch("/api/chains?ticker=SPX&range=all").then(r => r.json()).catch(() => null);
      const items = (cj?.data?.items ?? []) as { "expiration-date"?: string }[];
      const dates = items.map(i => String(i["expiration-date"] ?? "")).filter(Boolean).sort();
      const nearest = dates.find(d => daysTo(d) >= 0) ?? dates[0];
      if (nearest) { setSelectedExpiry(nearest); }
    }, 2500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStatic]);

  const doRefresh = useCallback(async () => {
    if (isStatic) return;
    const exp = activeExpiryRef.current;
    if (!exp) throw new Error("No expiry selected");
    await loadAll(exp, true);
    setChangeTick(t => t + 1); // also refetch the Δ map, if a change mode is active
  }, [isStatic, loadAll]);

  // Auto-refresh: TT REST per-strike volume accumulates through the session and
  // resets stale at the open, so the one-shot load lands volume=0 for SPY/QQQ
  // (SPX is the only live-streamed underlying). Re-pull (cache-busted) every 15s
  // while the market is open so volume fills in for all three tickers.
  useEffect(() => {
    if (isStatic) return;
    const id = setInterval(() => {
      const exp = activeExpiryRef.current;
      if (exp && isMarketOpen()) loadAll(exp, true);
    }, 15000);
    return () => clearInterval(id);
  }, [isStatic, loadAll]);

  // ── Static (delayed) mode: seed from the frozen snapshot, then poll for the
  // recorder's next ~30m tick instead of the live /api/chains loop. ──
  const [lastSnapshotTs, setLastSnapshotTs] = useState<number | null>(snapshotTs);
  useEffect(() => {
    if (!isStatic) return;

    const applySnapshot = (snap: MultGreekSnapshot | null | undefined) => {
      if (!snap || !snap.expiry) return;
      const newStrikes: Partial<Record<Ticker, StrikeRow[]>> = {};
      const newSpots: Partial<Record<Ticker, number>> = {};
      TICKERS.forEach((ticker) => {
        const t = snap.tickers?.[ticker];
        if (!t || !Array.isArray(t.items) || !t.items.length) return;
        const parsed = buildStrikes(t.items, liveDataRef.current);
        if (parsed.length) newStrikes[ticker] = parsed;
        if (t.underlyingPrice > 0) newSpots[ticker] = t.underlyingPrice;
      });
      setStrikes(prev => ({ ...prev, ...newStrikes }));
      setSpots(prev => ({ ...prev, ...newSpots }));
      activeExpiryRef.current = snap.expiry;
      setActiveExpiry(snap.expiry);
      setSelectedExpiry(snap.expiry);
      const dt = daysTo(snap.expiry);
      setExpirations([{ date: snap.expiry, daysTo: dt, label: `${dt}DTE  ${snap.expiry.slice(5)}` }]);
      setStatus({ state: "idle", msg: "DELAYED" });
    };

    applySnapshot(initialSnapshot);

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/mult-greek-snapshot", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json.snapshot) { applySnapshot(json.snapshot); setLastSnapshotTs(Number(json.ts) || null); }
      } catch { /* keep showing the last-known frozen snapshot */ }
    };
    const id = setInterval(poll, 60_000); // cheap — recorder only updates every ~30m anyway
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStatic]);

  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(doRefresh);

  const statusColors: Record<string, string> = {
    live: HT.green, loading: HT.orange, err: HT.red, idle: HT.red,
  };

  const pageRef = useRef<HTMLDivElement>(null);

  // Screenshot mode: trims each panel to ±CAPTURE_WINDOW strikes around ATM so
  // snaps/Discord shots are centered + compact. Set before capture, cleared after.
  const CAPTURE_WINDOW = 20; // 41 strikes (ATM ± 20)
  const [captureWindow, setCaptureWindow] = useState<number | null>(null);
  const beginCapture = useCallback(() => {
    setCaptureWindow(CAPTURE_WINDOW);
    // Wait two frames, then a short buffer — the trimmed rows + the flex-to-
    // block collapse below both need to fully reflow/repaint (backdrop-filter
    // blur compositing can lag a frame or two) before html2canvas measures
    // anything, or it captures a stale in-between layout.
    return new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 50))));
  }, []);
  const endCapture = useCallback(() => setCaptureWindow(null), []);

  // While a capture is in flight (captureWindow set), the panel rows are
  // trimmed to a compact window — but the surrounding containers (this shell,
  // the panels row, each Card, each scroll body) were still pinned to
  // flex:1/height:100% to fill the viewport. That left a big blank void below
  // the trimmed rows both live (a jarring shrink-then-blank flash) and in the
  // exported PNG (html2canvas measures the forced full-viewport height, not
  // the actual compact content). Collapse everything to hug its content
  // height only during capture.
  const isCapturing = captureWindow != null;

  return (
    // display:block (not flex) during capture: a flex column's auto height
    // should equal its children's content height too, but block stacking is
    // completely unambiguous — no flex-basis/min-height/backdrop-filter edge
    // case can make it measure taller than its actual visible content.
    // width:fit-content during capture: the shell otherwise stays pinned to the
    // full viewport width while the panels collapse to content width, so the
    // exported PNG kept a huge black void to the right (captureElement crops to
    // el.scrollWidth = shell width). Hugging the widest child (the panels row)
    // makes the toolbar + crop match the actual content width.
    <div ref={pageRef} style={{ ...homeShellStyle, display: isCapturing ? "block" : "flex", height: isCapturing ? "auto" : "100%", width: isCapturing ? "fit-content" : "100%", minWidth: isCapturing ? "min-content" : undefined, overflow: isCapturing ? "visible" : "hidden" }}>

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
            borderBottom: `1px solid ${HT.cyan}55`,
            fontSize: 16,
            textAlign: "center",
          }}
        >
          <span style={{ fontWeight: 800, color: HT.cyan, letterSpacing: "0.04em", fontSize: 17 }}>DELAYED PREVIEW</span>
          <span style={{ opacity: 0.75 }}>
            {lastSnapshotTs
              ? `Snapshot from ${Math.max(0, Math.round((Date.now() - lastSnapshotTs) / 60000))} min ago — refreshes ~every 30 min`
              : "Waiting on the next scheduled snapshot"}
          </span>
          <span style={{ opacity: 0.9 }}>
            Go live with <strong style={{ color: HT.green }}>20% off</strong> — code <strong style={{ color: HT.cyan }}>LAUNCH</strong>
          </span>
          <Link href="/pricing" style={{ textDecoration: "none" }}>
            <button
              style={{
                padding: "12px 26px",
                borderRadius: 10,
                border: "none",
                background: `linear-gradient(180deg, ${HT.cyan}, #00b8c4)`,
                color: "#04121a",
                fontSize: 16,
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

      {/* Toolbar */}
      <div style={{ display: "flex", padding: "6px 10px 2px", flexShrink: 0 }}>
      <Dock className="dock-noscroll" flat fullWidth style={{ width: "100%" }}>

        {/* Status dot */}
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: isStatic ? HT.cyan : (statusColors[status.state] ?? HT.muted), flexShrink: 0, display: "inline-block" }} />
        <span style={{ fontSize: 9, fontWeight: 800, color: isStatic ? HT.cyan : (statusColors[status.state] ?? HT.text), letterSpacing: "0.1em", whiteSpace: "nowrap", flexShrink: 0 }}>{status.msg}</span>

        {/* Expiry picker — static mode only ever has the one captured expiry */}
        <DockExpiryPicker
          expirations={expirations.map((e) => e.date)}
          value={selectedExpiry}
          onChange={isStatic ? () => {} : setSelectedExpiry}
          includeFront
          frontLabel="— Expiry —"
        />

        {/* GO button */}
        <DockButton onClick={doGo} title="Load expiry" style={{ opacity: (!isStatic && selectedExpiry) ? 1 : 0.45, color: HT.cyan }}>GO</DockButton>

        <DockGap />

        {/* Contract basis toggle */}
        <SegGroup
          options={[{ label: "OI+VOL", value: "oivol" }, { label: "VOL", value: "vol" }, { label: "FLOW GEX", value: "flow" }]}
          active={contractMode}
          onChange={(v) => setContractMode(v as typeof contractMode)}
        />

        <DockGap />

        {/* GEX Δ switcher — Live/15m/30m/60m, sourced from strike_growth */}
        <SegGroup
          options={CHANGE_MODES.map(m => ({ label: CHANGE_MODE_LABEL[m], value: m }))}
          active={changeMode}
          onChange={(v) => setChangeMode(v as ChangeMode)}
        />
        {changeMode !== "live" && (
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
            color: TICKERS.some(tk => (changeMaps[tk]?.size ?? 0) > 0) ? HT.orange : HT.muted }}>
            {TICKERS.some(tk => (changeMaps[tk]?.size ?? 0) > 0)
              ? `Δ ${TICKERS.filter(tk => (changeMaps[tk]?.size ?? 0) > 0).join("/")}`
              : "no history (not on watchlist)"}
          </span>
        )}

        <DockGap />

        {/* Intensity slider */}
        <DockSlider label="Intensity" value={intensity} min={0.5} max={3} step={0.01} onChange={setIntensity} width={80} format={(v) => `${v.toFixed(2)}x`} />

        {/* Refresh / Snap / Discord */}
        <DockSpacer />
        {!isStatic && (
          <DockButton onClick={trigger} title="Refresh" style={{ color: btnStyle.color as string }}>{btnLabel}</DockButton>
        )}
        <BoxSnapBtn targetRef={pageRef} label="📷" fitContent onBeforeCapture={beginCapture} onAfterCapture={endCapture} />
        <BoxDiscordBtn targetRef={pageRef} fitContent onBeforeCapture={beginCapture} onAfterCapture={endCapture} message={`📊 Multi-Greek Exposure — ${new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false})} ET`} />
      </Dock>
      </div>

      {/* Panels */}
      {embed && (
        <style>{`
          .mg-panels.mg-embed { flex-direction: row !important; overflow: hidden !important; height: auto !important; }
          .mg-panels.mg-embed > div { flex: 1 1 0 !important; width: auto !important; min-height: 0 !important; }
        `}</style>
      )}
      {/* alignItems defaults to "stretch" in a flex row, which forces every
          panel to match whichever one is tallest. During capture each Card is
          sized to hug its own (trimmed) content — without flex-start here,
          the row would stretch the shorter panels back out to match the
          tallest one, reintroducing the blank void this was meant to fix. */}
      <div className={`mg-panels${embed ? " mg-embed" : ""}`} style={{ flex: isCapturing ? "0 0 auto" : 1, display: "flex", alignItems: isCapturing ? "flex-start" : "stretch", gap: 8, padding: 8, overflow: isCapturing ? "visible" : "hidden", minHeight: 0 }}>
        {TICKERS.map(ticker => (
          <TickerPanel
            key={ticker}
            ticker={ticker}
            strikes={strikes[ticker]}
            liveData={liveDataRef.current}
            spot={spots[ticker]}
            contractMode={contractMode}
            intensity={intensity}
            emLevels={emByTicker[ticker]}
            showEm={!!activeExpiry && isCurrentWeekExp(activeExpiry)}
            captureWindow={captureWindow}
            changeMode={changeMode}
            changeMap={changeMaps[ticker]}
            flowGexMap={ticker === "SPX" ? flowGexMap : EMPTY_FLOW_MAP}
          />
        ))}
      </div>
    </div>
  );
}
