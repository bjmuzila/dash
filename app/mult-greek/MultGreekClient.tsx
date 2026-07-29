"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";
import { HOME_THEME as HT, homeShellStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { Dock, SegGroup, DockButton, DockGap, DockSpacer, DockSlider, DockExpiryPicker } from "@/components/shared/DockToolbar";
// expirations always fetched fresh — no cache import needed

// ── Constants ─────────────────────────────────────────────────────────────────

// Fixed base tickers + one user-configurable 4th slot (persisted per browser).
const BASE_TICKERS = ["SPX", "SPY", "QQQ"] as const;
type Ticker = string;
const CUSTOM_TICKER_KEY = "mg_custom_ticker";

// Columns are now the N closest expirations (all NET GEX) instead of the four
// greeks. Front expiry (from the picker) + the next 3 = 4 closest.
const MAX_EXP_COLS = 4;

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
  // NET GEX per expiry column, keyed by expiry date.
  gex: Record<string, number>;
}

interface ComputedResult {
  rows: ComputedRow[];
  cols: string[];                                 // expiry dates, front → back
  maxAbs: Record<string, number>;                 // per-column |max| for shading
  top3: Record<string, Record<number, number>>;   // per-column top-3 strike ranks
  atmStrike: number;
  mvcStrike: Record<string, number | null>;       // per-column peak |GEX| strike
}

interface Expiry {
  date: string;
  daysTo: number;
  label: string;
}

/** Frozen full-chain snapshot shape written by
 *  server-v2/mult-greek-snapshot-recorder.js — one shared expiry, raw TT chain
 *  `items` + underlyingPrice per ticker. The delayed view can only render the
 *  single captured expiry as one column. */
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

function fmtInt(n: number): string { return Math.round(n || 0).toLocaleString(); }
function fmtUsd(n: number): string {
  const a = Math.abs(n || 0);
  const s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}
function fmtExpShort(exp?: string | null): string {
  if (!exp) return "";
  const d = new Date(exp + "T12:00:00");
  if (Number.isNaN(d.getTime())) return exp;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  const eased = Math.pow(ratio * Math.max(intensity || 0.1, 1), 1.4);
  const alpha = Math.min(0.18, 0.02 + eased * 0.16);
  return pos ? `rgba(41,182,246,${alpha.toFixed(2)})` : `rgba(255,71,87,${alpha.toFixed(2)})`;
}

// Compact column-header label for an expiry: "0DTE" over "MM-DD".
function colLabel(date: string): { dte: string; md: string } {
  const dt = daysTo(date);
  return { dte: `${dt}DTE`, md: date.slice(5) };
}

// Pick a ticker's up-to-MAX_EXP_COLS column expiries: its own closest expiries
// at or after the anchor date. Each ticker uses ITS OWN calendar — e.g. TSLA
// (weeklies only) starts at its nearest Friday, not SPX's daily Thursday.
function pickCols(list: Expiry[], anchorDate: string): Expiry[] {
  if (!list.length) return [];
  const anchorDt = anchorDate ? daysTo(anchorDate) : -Infinity;
  const fromAnchor = list.filter(e => e.daysTo >= anchorDt);
  return (fromAnchor.length ? fromAnchor : list).slice(0, MAX_EXP_COLS);
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
            // Captured for the hover card's Net Prem (mark × vol × 100).
            bid:   parseFloat(String(o.bid ?? o["bid-price"] ?? 0)) || undefined,
            ask:   parseFloat(String(o.ask ?? o["ask-price"] ?? 0)) || undefined,
          };
        }
      }
    });
  });
  return Object.values(map).sort((a, b) => a.strike - b.strike);
}

// Net GEX for one strike row given its call/put live greeks.
function strikeGex(sr: StrikeRow | undefined, liveData: Record<string, LiveEntry>, spot: number, volOnly: boolean): number {
  if (!sr) return 0;
  const cd = liveData[sr.callSym ?? ""] || {};
  const pd = liveData[sr.putSym  ?? ""] || {};
  const cc = (volOnly ? 0 : (cd.oi ?? 0)) + (cd.vol ?? 0);
  const pc = (volOnly ? 0 : (pd.oi ?? 0)) + (pd.vol ?? 0);
  return (Math.abs(cd.gamma ?? 0) * cc - Math.abs(pd.gamma ?? 0) * pc) * spot * spot * 0.01 * 100;
}

// Compute one panel's rows: union of strikes across the column expiries, with a
// NET GEX value per column, plus per-column shading maxima / top-3 / peak.
function computeRows(
  strikesByExp: Record<string, StrikeRow[]>,
  cols: string[],
  liveData: Record<string, LiveEntry>,
  spot: number,
  contractMode: "oivol" | "vol",
): ComputedResult {
  const volOnly = contractMode === "vol";

  // Per-expiry strike lookup + union of every strike across the columns.
  const rowByExp: Record<string, Map<number, StrikeRow>> = {};
  const strikeSet = new Set<number>();
  cols.forEach(e => {
    const m = new Map<number, StrikeRow>();
    (strikesByExp[e] || []).forEach(r => { m.set(r.strike, r); strikeSet.add(r.strike); });
    rowByExp[e] = m;
  });
  const allStrikes = [...strikeSet].sort((a, b) => b - a); // desc

  let atmStrike = 0;
  if (spot > 0 && allStrikes.length) {
    let minDist = Infinity;
    allStrikes.forEach(s => {
      const d = Math.abs(s - spot);
      if (d < minDist) { minDist = d; atmStrike = s; }
    });
  }

  const out: ComputedRow[] = allStrikes.map(strike => {
    const gex: Record<string, number> = {};
    cols.forEach(e => { gex[e] = strikeGex(rowByExp[e].get(strike), liveData, spot, volOnly); });
    return { strike, isATM: strike === atmStrike, gex };
  });

  const maxAbs: Record<string, number> = {};
  const top3: Record<string, Record<number, number>> = {};
  const mvcStrike: Record<string, number | null> = {};
  cols.forEach(e => {
    let mx = 1;
    out.forEach(r => { const a = Math.abs(r.gex[e]); if (a > mx) mx = a; });
    maxAbs[e] = mx;

    const ranks: Record<number, number> = {};
    [...out].sort((a, b) => Math.abs(b.gex[e]) - Math.abs(a.gex[e]))
      .slice(0, 3)
      .forEach((row, idx) => { ranks[row.strike] = idx + 1; });
    top3[e] = ranks;

    // Core Bullseye per column = strike with the highest ABSOLUTE net GEX.
    let peak: number | null = null, peakAbs = 0;
    out.forEach(r => { const a = Math.abs(r.gex[e]); if (a > peakAbs) { peakAbs = a; peak = r.strike; } });
    mvcStrike[e] = peak;
  });

  return { rows: out, cols, maxAbs, top3, atmStrike, mvcStrike };
}

interface Walls {
  cb: number | null; cbVal: number;   // highest |GEX| strike
  cw: number | null; cwVal: number;   // highest +GEX strike (2nd if CB is that one)
  pw: number | null; pwVal: number;   // most −GEX strike (2nd if CB is that one)
}

// CB / CW / PW levels for ONE expiry column. Three DISTINCT strikes:
//   CB = max |GEX|. CW = top positive GEX (skips CB if CB is the top positive).
//   PW = most negative GEX (skips CB if CB is the most negative).
function computeWalls(rows: ComputedRow[], expiry: string): Walls {
  let cb: number | null = null, cbAbs = -1, cbVal = 0;
  rows.forEach(r => { const v = r.gex[expiry] ?? 0; const a = Math.abs(v); if (a > cbAbs) { cbAbs = a; cb = r.strike; cbVal = v; } });
  const pos = rows.filter(r => (r.gex[expiry] ?? 0) > 0).sort((a, b) => (b.gex[expiry] ?? 0) - (a.gex[expiry] ?? 0));
  const neg = rows.filter(r => (r.gex[expiry] ?? 0) < 0).sort((a, b) => (a.gex[expiry] ?? 0) - (b.gex[expiry] ?? 0));
  const cwRow = pos.find(r => r.strike !== cb) ?? null;
  const pwRow = neg.find(r => r.strike !== cb) ?? null;
  return {
    cb, cbVal,
    cw: cwRow?.strike ?? null, cwVal: cwRow ? (cwRow.gex[expiry] ?? 0) : 0,
    pw: pwRow?.strike ?? null, pwVal: pwRow ? (pwRow.gex[expiry] ?? 0) : 0,
  };
}

// ── Ticker Panel ──────────────────────────────────────────────────────────────

interface GexChange { now: number; d15: number | null; d30: number | null; dOpen: number | null; spanMs: number; }

/** Δ bar mode lookback. 0 = off (cells show NET GEX values). */
type DeltaWindow = 0 | 5 | 15 | 30;

/** One (ticker, expiry) slice of recorded baselines, keyed by strike. */
type GexGridCell = { vNow: number | null; v5: number | null; v15: number | null; v30: number | null };
type GexGrid = Record<string, Record<number, GexGridCell>>;

/** Diverging Δ bar — replaces the cell value in Δ bar mode.
 *  Grows right from a center axis when GEX is building, left when unwinding.
 *  Height is 1.2em (the text line box) so toggling the mode never reflows a row. */
function DeltaBar({ d, max }: { d: number | null; max: number }) {
  const pct = d == null || !Number.isFinite(d) || max <= 0
    ? 0
    : Math.min(Math.abs(d) / max, 1) * 48;
  const pos = (d ?? 0) > 0;
  const fill = pos
    ? "linear-gradient(90deg, rgba(34,197,94,.40), rgba(34,197,94,.96))"
    : "linear-gradient(90deg, rgba(239,68,68,.96), rgba(239,68,68,.40))";
  return (
    <span style={{ display: "flex", alignItems: "center", height: "1.2em", padding: "0 2px" }}>
      <span style={{ position: "relative", width: "100%", height: 9, borderRadius: 2, background: "rgba(255,255,255,.045)" }}>
        {/* center axis = no change */}
        <span style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "rgba(255,255,255,.28)" }} />
        {pct > 0 && (
          <span style={{
            position: "absolute", top: 1, bottom: 1, borderRadius: 2, background: fill,
            ...(pos ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }),
          }} />
        )}
        {pct === 0 && (
          <span style={{
            position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)",
            width: 3, height: 3, borderRadius: "50%", background: "rgba(255,255,255,.25)",
          }} />
        )}
      </span>
    </span>
  );
}

function TickerPanel({
  ticker, strikesByExp, cols, liveData, spot, contractMode, intensity, emLevels, showEm, captureWindow,
  showCB, showCW, showPW, getGexChange, deltaWindow,
}: {
  ticker: Ticker;
  /** Per-expiry strike rows for this ticker. */
  strikesByExp: Record<string, StrikeRow[]>;
  /** Column expiries (front → back), each rendered as a NET GEX column. */
  cols: Expiry[];
  liveData: Record<string, LiveEntry>;
  spot: number;
  contractMode: "oivol" | "vol";
  intensity: number;
  emLevels: { close: number; em: number } | null;
  showEm: boolean;
  /** Toolbar toggles: show the CB (1st) / CW (2nd) / PW (3rd) top-|GEX| level
   *  badges on the FRONT expiry column. */
  showCB: boolean;
  showCW: boolean;
  showPW: boolean;
  /** When set (screenshot mode), render only this many strikes on each side of
   *  ATM so the shot is centered + compact instead of the full chain. */
  captureWindow: number | null;
  /** Read a cell's 15m / 30m / open NET GEX change for the click card. */
  getGexChange: (ticker: string, expiry: string, strike: number) => GexChange;
  /** Δ bar mode: 0 = off (show NET GEX values), else the lookback in minutes.
   *  When on, every cell's value is replaced by a diverging change bar. */
  deltaWindow: DeltaWindow;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  // Click card: a specific (strike, expiry) cell's GEX change over 15m/30m/open.
  const [clickCell, setClickCell] = useState<{ strike: number; expiry: string; x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Any click off the popout closes it — except clicks inside the card itself or
  // on a GEX cell (cells manage their own open/move/toggle). The card portals to
  // <body>, so a document-level listener is the reliable catch-all.
  useEffect(() => {
    if (!clickCell) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (cardRef.current && t && cardRef.current.contains(t)) return;
      if (t && t.closest("[data-gexcell]")) return;
      setClickCell(null);
    };
    const id = window.setTimeout(() => document.addEventListener("click", onDocClick), 0);
    return () => { window.clearTimeout(id); document.removeEventListener("click", onDocClick); };
  }, [clickCell]);

  // Server-recorded baselines for the clicked cell (mult-greek-gex-recorder).
  // Preferred over the client ring — instant 15m/30m/open with no warm-up. Falls
  // back to the client ring for tickers the recorder doesn't cover.
  const [srvChange, setSrvChange] = useState<{ key: string; vNow: number | null; v5: number | null; v15: number | null; v30: number | null; vOpen: number | null } | null>(null);
  useEffect(() => {
    if (!clickCell) { setSrvChange(null); return; }
    const key = `${ticker}|${clickCell.expiry}|${clickCell.strike}`;
    let cancelled = false;
    const load = () => fetch(`/api/mult-greek-gex-change?ticker=${encodeURIComponent(ticker)}&expiry=${encodeURIComponent(clickCell.expiry)}&strike=${clickCell.strike}`)
      .then(r => r.json())
      .then(j => { if (!cancelled) setSrvChange({ key, vNow: j?.data?.vNow ?? null, v5: j?.data?.v5 ?? null, v15: j?.data?.v15 ?? null, v30: j?.data?.v30 ?? null, vOpen: j?.data?.vOpen ?? null }); })
      .catch(() => { if (!cancelled) setSrvChange({ key, vNow: null, v5: null, v15: null, v30: null, vOpen: null }); });
    load();
    const id = setInterval(load, 20_000);
    return () => { cancelled = true; clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clickCell?.strike, clickCell?.expiry, ticker]);

  const colDates = useMemo(() => cols.map(c => c.date), [cols]);
  const gridCols = `64px ${cols.map(() => "1fr").join(" ")}`.trim() || "64px";

  const hasData = cols.length > 0 && cols.some(c => (strikesByExp[c.date]?.length ?? 0) > 0);
  const computedFull = hasData
    ? computeRows(strikesByExp, colDates, liveData, spot, contractMode)
    : null;

  // CB / CW / PW levels for the FRONT expiry — shown in the header and marked in
  // the front column. Computed from the full (untrimmed) rows so the capture
  // window doesn't change which strikes are the walls.
  const walls = (computedFull && computedFull.cols.length)
    ? computeWalls(computedFull.rows, computedFull.cols[0])
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

  // ---- Δ bar mode ---------------------------------------------------------
  // One bulk pull per expiry column (not per cell) — see /api/mult-greek-gex-grid.
  // Only fetched while the mode is on; cleared when it's switched off so we don't
  // hold stale baselines across an expiry change.
  const [gexGrid, setGexGrid] = useState<GexGrid>({});
  const colDatesKey = colDates.join(",");
  useEffect(() => {
    if (deltaWindow === 0 || !colDates.length) { setGexGrid({}); return; }
    let cancelled = false;
    const load = async () => {
      const entries = await Promise.all(colDates.map(async (date) => {
        try {
          const r = await fetch(
            `/api/mult-greek-gex-grid?ticker=${encodeURIComponent(ticker)}&expiry=${encodeURIComponent(date)}`,
            { cache: "no-store" },
          );
          if (!r.ok) return [date, {}] as const;
          const j = await r.json();
          const cells = (j?.data?.cells ?? {}) as Record<string, GexGridCell>;
          const byStrike: Record<number, GexGridCell> = {};
          for (const [k, v] of Object.entries(cells)) byStrike[Number(k)] = v;
          return [date, byStrike] as const;
        } catch {
          return [date, {}] as const;
        }
      }));
      if (cancelled) return;
      setGexGrid(Object.fromEntries(entries));
    };
    void load();
    const id = setInterval(() => { void load(); }, 20_000);
    return () => { cancelled = true; clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deltaWindow, ticker, colDatesKey]);

  // Δ per cell = live NET GEX (what the cell would print) − recorded baseline.
  // Scale is per expiry column, matching how the heat scale already works, so a
  // quiet back-month column still shows readable bars.
  const deltas = useMemo(() => {
    const out: { by: Record<string, Record<number, number>>; max: Record<string, number> } = { by: {}, max: {} };
    if (deltaWindow === 0 || !computed) return out;
    const key = `v${deltaWindow}` as "v5" | "v15" | "v30";
    for (const e of computed.cols) {
      const grid = gexGrid[e];
      const col: Record<number, number> = {};
      let max = 0;
      if (grid) {
        for (const r of computed.rows) {
          const live = r.gex[e];
          const cell = grid[r.strike];
          const past = cell ? cell[key] : null;
          if (live == null || past == null) continue;
          const d = live - past;
          col[r.strike] = d;
          const a = Math.abs(d);
          if (a > max) max = a;
        }
      }
      out.by[e] = col;
      out.max[e] = max;
    }
    return out;
  }, [deltaWindow, gexGrid, computed]);

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

  // Per-column NET GEX totals.
  const totals = computed
    ? Object.fromEntries(computed.cols.map(e => [e, computed.rows.reduce((s, r) => s + (r.gex[e] || 0), 0)]))
    : null;

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
  // full column height. See the isCapturing note in MultGreekClient above.
  const isCapturing = captureWindow != null;

  // Per-side book stats (Volume / OI / Net Prem) for the CLICKED cell, keyed off
  // that cell's OWN expiry symbols. Net Prem = mark × volume × 100.
  const clickData = (() => {
    if (!clickCell) return null;
    const sr = (strikesByExp[clickCell.expiry] || []).find(s => s.strike === clickCell.strike);
    const side = (sym: string | null | undefined) => {
      const d = (sym && liveData[sym]) || {};
      const vol = d.vol ?? 0;
      const oi = d.oi ?? 0;
      const mark = (d.bid != null && d.ask != null && (d.bid > 0 || d.ask > 0)) ? (d.bid + d.ask) / 2 : 0;
      return { vol, oi, prem: mark * vol * 100 };
    };
    return { calls: side(sr?.callSym), puts: side(sr?.putSym) };
  })();

  return (
    <Card
      variant="budget"
      padding={0}
      style={{ flex: isCapturing ? "0 0 auto" : 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: isCapturing ? "visible" : "hidden", borderRadius: 16 }}
    >
      <style>{`@keyframes mvcGlow{0%,100%{box-shadow:0 0 3px rgba(255,255,255,.35)}50%{box-shadow:0 0 10px rgba(255,255,255,.85)}}.mvc-peak-cell{animation:mvcGlow 2.4s ease-in-out infinite}`}</style>

      {/* Panel header — ticker · CB/CW/PW front-expiry levels · spot */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 10px", background: "rgba(33,158,188,0.04)", borderBottom: `1px solid ${HT.border}`, flexShrink: 0 }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: HT.cyan, letterSpacing: "0.1em", flexShrink: 0 }}>{ticker}</span>
        <div style={{ display: "flex", gap: 5, alignItems: "center", overflow: "hidden", flex: 1, justifyContent: "flex-end" }}>
          {/* Header readout always shows the CB/CW/PW levels — the toolbar
              toggles only control the cell markers, per user. */}
          {([
            { t: "CB", c: "#ffd600", s: walls?.cb ?? null, title: "Core Bullseye — highest |GEX| level" },
            { t: "CW", c: "#29b6f6", s: walls?.cw ?? null, title: "Call Wall — highest +GEX level" },
            { t: "PW", c: "#ff4757", s: walls?.pw ?? null, title: "Put Wall — most −GEX level" },
          ] as const).filter(x => x.s != null).map(x => (
            <span key={x.t} title={x.title} style={{
              display: "inline-flex", alignItems: "baseline", gap: 3, whiteSpace: "nowrap",
              padding: "2px 6px", borderRadius: 5, background: `${x.c}1f`, border: `1px solid ${x.c}66`,
            }}>
              <span style={{ fontSize: 9, fontWeight: 900, color: x.c, letterSpacing: "0.04em" }}>{x.t}</span>
              <span style={{ fontSize: 12, fontWeight: 800, fontFamily: "var(--font-mono)", color: "#e2e8f0" }}>
                {Number.isInteger(x.s as number) ? x.s : (x.s as number).toFixed(2)}
              </span>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 17, fontFamily: "var(--font-mono)", color: "#94a3b8", flexShrink: 0 }}>
          {spot > 0 && (
            <span style={{ color: HT.cyan, fontWeight: 700 }}>{spot.toFixed(2)}</span>
          )}
          {spot === 0 && <span style={{ color: "#475569" }}>--</span>}
        </div>
      </div>

      {/* Column headers — STRIKE + one NET GEX column per expiry */}
      <div style={{ display: "grid", gridTemplateColumns: gridCols, background: HT.panelBgStrong, borderBottom: `1px solid ${HT.border}`, flexShrink: 0 }}>
        <div style={{ padding: "5px 4px", textAlign: "center", color: HT.muted, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", alignSelf: "center" }}>STRIKE</div>
        {cols.map(c => {
          const lbl = colLabel(c.date);
          return (
            <div key={c.date} style={{ padding: "3px 4px", textAlign: "center", lineHeight: 1.15 }}>
              <div style={{ color: HT.cyan, fontSize: 10, fontWeight: 800, letterSpacing: "0.04em" }}>{lbl.dte}</div>
              <div style={{ color: HT.muted, fontSize: 8, fontWeight: 700 }}>
                {deltaWindow !== 0 ? `Δ ${deltaWindow}M` : "GEX"} · {lbl.md}
              </div>
            </div>
          );
        })}
      </div>

      {/* Totals row */}
      <div style={{ display: "grid", gridTemplateColumns: gridCols, background: "rgba(33,158,188,0.02)", borderBottom: `1px solid ${HT.border}`, flexShrink: 0 }}>
        <div style={{ padding: "4px 4px", fontSize: 10, fontWeight: 800, textAlign: "center", color: HT.muted, letterSpacing: "0.06em" }}>TOTAL</div>
        {cols.map(c => {
          // In Δ bar mode the TOTAL row keeps NUMBERS — it becomes the net Δ for
          // the column, so there's still one hard figure per expiry to read.
          const dSum = deltaWindow !== 0
            ? Object.values(deltas.by[c.date] ?? {}).reduce((s, x) => s + x, 0)
            : null;
          const hasD = deltaWindow !== 0 && Object.keys(deltas.by[c.date] ?? {}).length > 0;
          const v = deltaWindow !== 0 ? (dSum ?? 0) : (totals?.[c.date] ?? 0);
          const fmt = deltaWindow !== 0
            ? (hasD ? fmtMoney(v) : { sign: "", value: "--" })
            : (totals != null ? fmtMoney(v) : { sign: "", value: "--" });
          return (
            <div key={c.date} style={{
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, fontSize: 12, color: "#475569", }}>
            Select an expiry and click GO
          </div>
        ) : computed.rows.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, fontSize: 12, color: "#475569", }}>
            No strikes in range
          </div>
        ) : computed.rows.map(r => {
          const strikeColor = "#94a3b8";
          const rowBg = "transparent";
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
              style={{ display: "grid", gridTemplateColumns: gridCols, background: rowBg, position: "relative", ...atmOutline, ...(emBorder ?? {}) }}
            >
              {(is1x || is2x) && (
                <img
                  src={emBadgeDataUri(is1x ? "EM" : "2× EM")}
                  alt={is1x ? "EM" : "2× EM"}
                  style={{ position: "absolute", top: 2, left: 3, zIndex: 3, display: "block", pointerEvents: "none" }}
                />
              )}
              <div style={{
                padding: "4px 4px", fontSize: 12, fontWeight: 800, fontFamily: "var(--font-mono)",
                textAlign: "center", color: strikeColor, borderRight: "1px solid rgba(255,255,255,.06)",
                background: "transparent",
              }}>
                {Number.isInteger(r.strike) ? r.strike : r.strike.toFixed(2)}
              </div>
              {computed.cols.map((e, ci) => {
                const val = r.gex[e];
                const topRank = (computed.top3[e]?.[r.strike]) || 0;
                const scaleMax = computed.maxAbs[e];
                const weight = topRank === 1 ? 900 : topRank ? 800 : 700;
                const formatted = val == null ? { sign: "", value: "--" } : fmtMoney(val);
                const signColor = val == null ? SOFT_WHITE : val > 0 ? "#22c55e" : val < 0 ? "#ef4444" : SOFT_WHITE;
                // CB / CW / PW level badges — only on the FRONT expiry column,
                // each gated by its toolbar toggle. Strikes come from computeWalls
                // (CB = max |GEX|, CW = top +GEX, PW = most −GEX; all distinct).
                const isFront = ci === 0;
                const lvl = isFront && walls
                  ? (walls.cb === r.strike && showCB ? { t: "CB", c: "#ffd600", title: "CB — highest |GEX| level" }
                    : walls.cw === r.strike && showCW ? { t: "CW", c: "#29b6f6", title: "CW — highest +GEX level" }
                    : walls.pw === r.strike && showPW ? { t: "PW", c: "#ff4757", title: "PW — most −GEX level" }
                    : null)
                  : null;
                const isCB = lvl?.t === "CB";
                const isSel = clickCell != null && clickCell.strike === r.strike && clickCell.expiry === e;
                // Δ bar mode: the bar REPLACES the value. Heat background comes off
                // (green/red Δ over blue/red GEX heat reads muddy), but the top-rank
                // and CB/CW/PW outlines stay so the walls are still locatable. The
                // corner badges/star are hidden — at 1.2em they'd occlude the bar.
                const dMode = deltaWindow !== 0;
                const dVal = dMode ? (deltas.by[e]?.[r.strike] ?? null) : null;
                const dTitle = dMode
                  ? `${ticker} ${r.strike} · ${colLabel(e).dte} — Δ${deltaWindow}m ${
                      dVal == null ? "no baseline yet" : `${fmtMoney(dVal).sign}${fmtMoney(dVal).value}`
                    } · now ${val == null ? "--" : `${formatted.sign}${formatted.value}`}`
                  : undefined;
                return (
                  <div key={e} data-gexcell="1" title={dTitle} className={isCB && !dMode ? "mvc-peak-cell" : undefined}
                    onClick={isCapturing ? undefined : (ev) => {
                      ev.stopPropagation();
                      setClickCell(prev => (prev && prev.strike === r.strike && prev.expiry === e)
                        ? null
                        : { strike: r.strike, expiry: e, x: ev.clientX, y: ev.clientY });
                    }}
                    style={{
                    padding: "4px 4px", fontSize: 10, fontFamily: "var(--font-mono)",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    textAlign: "center", color: SOFT_WHITE, cursor: isCapturing ? "default" : "pointer",
                    background: (dMode || val == null) ? "transparent" : metricBg(val, scaleMax, topRank, intensity),
                    fontWeight: weight,
                    position: "relative",
                    ...(topRank === 1 && val != null ? { outline: `1px solid ${val >= 0 ? "rgba(41,182,246,.9)" : "rgba(255,71,87,.9)"}`, outlineOffset: "-1px", zIndex: 1 } : {}),
                    ...(lvl ? { outline: `2px solid ${lvl.c}`, outlineOffset: "-2px", zIndex: 2 } : {}),
                    ...(isSel ? { outline: "2px solid #ffffff", outlineOffset: "-2px", zIndex: 3 } : {}),
                  }}>
                    {/* Non-front columns keep the plain gold peak star. */}
                    {!dMode && !isFront && topRank === 1 && (
                      <span style={{
                        position: "absolute", top: 1, left: 2, fontSize: 10, lineHeight: 1,
                        color: "#ffd600", textShadow: "0 0 2px rgba(0,0,0,.8)", pointerEvents: "none",
                      }}>★</span>
                    )}
                    {!dMode && lvl && (
                      <span title={lvl.title} style={{
                        position: "absolute", top: 0, right: 1, fontSize: 8, fontWeight: 900,
                        lineHeight: 1.2, letterSpacing: "0.02em",
                        color: "#04121a", background: lvl.c, borderRadius: 2, padding: "0 2px",
                        pointerEvents: "none",
                      }}>{lvl.t}</span>
                    )}
                    {dMode
                      ? <DeltaBar d={dVal} max={deltas.max[e] ?? 0} />
                      : <><span style={{ color: signColor }}>{formatted.sign}</span>{formatted.value}</>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Combined CLICK popout: book stats (calls/puts) + NET GEX 15m/30m/open
          change for the clicked cell. Replaces the old hover card. */}
      {clickCell && clickData && !isCapturing && (() => {
        const ch = getGexChange(ticker, clickCell.expiry, clickCell.strike);
        const dt = daysTo(clickCell.expiry);
        const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
        const vh = typeof window !== "undefined" ? window.innerHeight : 800;
        const W = 250;
        const left = Math.min(Math.max(8, clickCell.x + 14), vw - W - 8);
        const top = Math.min(Math.max(8, clickCell.y + 14), vh - 320);
        const netPrem = (clickData.calls.prem || 0) - (clickData.puts.prem || 0);

        // Live NET GEX = the displayed cell value (freshest); deltas diff it
        // against the server-recorded baselines (instant), falling back to the
        // client ring if the recorder doesn't cover this ticker.
        const liveRow = computedFull?.rows.find(r => r.strike === clickCell.strike);
        const liveNow = liveRow ? (liveRow.gex[clickCell.expiry] ?? 0) : ch.now;
        const srv = (srvChange && srvChange.key === `${ticker}|${clickCell.expiry}|${clickCell.strike}`) ? srvChange : null;
        const deltaFor = (srvPast: number | null | undefined, clientDelta: number | null, buildMs: number): { v: number | null; building: boolean } => {
          if (srv && srvPast != null) return { v: liveNow - srvPast, building: false };
          if (clientDelta != null) return { v: clientDelta, building: false };
          return { v: null, building: buildMs > 0 && ch.spanMs < buildMs };
        };
        const r5 = deltaFor(srv?.v5, null, 5 * 60_000);
        const r15 = deltaFor(srv?.v15, ch.d15, 15 * 60_000);
        const r30 = deltaFor(srv?.v30, ch.d30, 30 * 60_000);
        const rOpen = deltaFor(srv?.vOpen, ch.dOpen, 0);
        const nowFmt = fmtMoney(liveNow);
        const nowColor = liveNow > 0 ? "#22c55e" : liveNow < 0 ? "#ef4444" : SOFT_WHITE;
        const stat = (k: string, v: string, strong?: boolean) => (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, lineHeight: 1.55 }}>
            <span style={{ color: "#8B94A7" }}>{k}</span>
            <span style={{ color: strong ? "#fff" : "#cfe", fontWeight: strong ? 800 : 600 }}>{v}</span>
          </div>
        );
        const side = (label: string, c: string, s: { vol: number; oi: number; prem: number }) => (
          <div style={{ background: `${c}12`, border: `1px solid ${c}47`, borderRadius: 8, padding: "6px 8px" }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", color: c, marginBottom: 4 }}>{label}</div>
            {stat("Volume", fmtInt(s.vol))}
            {stat("OI", fmtInt(s.oi))}
            {stat("Net Prem", fmtUsd(s.prem), true)}
          </div>
        );
        const drow = (label: string, v: number | null, building: boolean) => {
          const f = v == null ? null : fmtMoney(v);
          const col = v == null ? "#64748b" : v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : SOFT_WHITE;
          return (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "2px 0" }}>
              <span style={{ color: HT.muted, fontSize: 10, fontWeight: 700 }}>{label}</span>
              <span style={{ color: col, fontSize: 12, fontWeight: 800, fontFamily: "var(--font-mono)" }}>
                {f ? `${f.sign}${f.value}` : building ? "building…" : "—"}
              </span>
            </div>
          );
        };
        if (typeof document === "undefined") return null;
        return createPortal(
          <div
            ref={cardRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed", left, top, width: W, zIndex: 4000, padding: 12,
              background: "rgba(13,17,25,0.97)", border: `1px solid ${HT.cyan}4d`, borderRadius: 12,
              boxShadow: "0 12px 40px rgba(0,0,0,0.6)", backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)", fontFamily: "var(--font-mono)", color: "#fff",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 800 }}>{ticker} {clickCell.strike.toLocaleString()}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "#8B94A7" }}>{dt}DTE · {fmtExpShort(clickCell.expiry)}</span>
              <span onClick={() => setClickCell(null)} style={{ fontSize: 14, color: "#8B94A7", cursor: "pointer", lineHeight: 1, marginLeft: 2 }}>×</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {side("CALLS", "#29b6f6", clickData.calls)}
              {side("PUTS", "#ff4757", clickData.puts)}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 12 }}>
              <span style={{ color: "#8B94A7" }}>Net Prem (C−P)</span>
              <span style={{ fontWeight: 800, color: netPrem >= 0 ? "#29b6f6" : "#ff4757" }}>{fmtUsd(netPrem)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 6, borderTop: `1px solid ${HT.border}`, fontSize: 12 }}>
              <span style={{ color: "#8B94A7" }}>NET GEX</span>
              <span style={{ color: nowColor, fontWeight: 900 }}>{nowFmt.sign}{nowFmt.value}</span>
            </div>
            <div style={{ marginTop: 3 }}>
              {drow("Δ 5 min", r5.v, r5.building)}
              {drow("Δ 15 min", r15.v, r15.building)}
              {drow("Δ 30 min", r30.v, r30.building)}
              {drow("Δ Open", rOpen.v, rOpen.building)}
            </div>
          </div>,
          document.body,
        );
      })()}
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
   *  hit the live /api/chains loop. The delayed snapshot only carries ONE
   *  expiry, so static mode shows a single NET GEX column. */
  isStatic?: boolean;
  initialSnapshot?: MultGreekSnapshot | null;
  /** epoch ms the current snapshot was captured, for the "delayed" banner. */
  snapshotTs?: number | null;
} = {}) {
  const [expirations, setExpirations] = useState<Expiry[]>([]);
  const [activeExpiry, setActiveExpiry] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [contractMode, setContractMode] = useState<"oivol" | "vol">("oivol");
  const [intensity, setIntensity] = useState(1.75);
  const [status, setStatus] = useState<{ state: "live" | "loading" | "err" | "idle"; msg: string }>(
    isStatic ? { state: "idle", msg: "DELAYED" } : { state: "idle", msg: "READY" }
  );

  // Front-column level badges: CB (highest |GEX|), CW (2nd), PW (3rd). Toggled
  // from the toolbar; all on by default.
  // Δ bar mode — 0 = off (cells show NET GEX). Drives every panel at once.
  const [deltaWindow, setDeltaWindow] = useState<DeltaWindow>(0);
  const [showCB, setShowCB] = useState(true);
  const [showCW, setShowCW] = useState(true);
  const [showPW, setShowPW] = useState(true);

  // User-configurable 4th ticker, persisted per browser (localStorage). Live
  // mode only — the delayed snapshot recorder only carries SPX/SPY/QQQ.
  const [customTicker, setCustomTicker] = useState<string>("IWM");
  const [tickerInput, setTickerInput] = useState<string>("IWM");
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(CUSTOM_TICKER_KEY);
      if (saved != null) { setCustomTicker(saved); setTickerInput(saved); }
    } catch { /* ignore */ }
  }, []);
  const TICKERS = useMemo(() => {
    const base = [...BASE_TICKERS] as string[];
    const t = customTicker.trim().toUpperCase();
    if (!isStatic && t && !base.includes(t)) base.push(t);
    return base;
  }, [customTicker, isStatic]);
  const commitTicker = useCallback(() => {
    const t = tickerInput.trim().toUpperCase();
    setTickerInput(t);
    if (t === customTicker) return;
    setCustomTicker(t);
    try { window.localStorage.setItem(CUSTOM_TICKER_KEY, t); } catch { /* ignore */ }
  }, [tickerInput, customTicker]);
  // Embedded in the GEX drawer (?embed=1): keep the SPX/SPY/QQQ panels side by
  // side even though the iframe viewport is below the mobile stack breakpoint.
  const [embed, setEmbed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setEmbed(new URLSearchParams(window.location.search).get("embed") === "1");
  }, []);

  // Per-ticker, per-expiry strikes: ticker → expiry → StrikeRow[].
  const [strikes, setStrikes]   = useState<Record<string, Record<string, StrikeRow[]>>>({});
  const [spots, setSpots]       = useState<Record<string, number>>({});
  // Per-ticker weekly EM (DB-backed via /api/levels) for the EM bands.
  const [emByTicker, setEmByTicker] = useState<Record<string, { close: number; em: number } | null>>({});
  // Each ticker's OWN expiration calendar (for its column dates). SPX is also
  // mirrored into `expirations` above, which anchors the toolbar picker.
  const [expByTicker, setExpByTicker] = useState<Record<string, Expiry[]>>({});
  const liveDataRef = useRef<Record<string, LiveEntry>>({});

  // Client-side per-cell NET GEX history for the click card. Keyed
  // `ticker|expiry|strike`. `gexHist` is a rolling ~35-min ring (for the 15m/30m
  // deltas); `gexOpen` keeps the first RTH reading of the ET day (for Δ open).
  const gexHistRef = useRef<Map<string, { t: number; v: number }[]>>(new Map());
  const gexOpenRef = useRef<Map<string, { date: string; v: number }>>(new Map());

  const loadTokenRef = useRef(0);
  const activeExpiryRef = useRef<string | null>(null);
  const expirationsRef = useRef<Expiry[]>([]);
  useEffect(() => { expirationsRef.current = expirations; }, [expirations]);
  const expByTickerRef = useRef<Record<string, Expiry[]>>({});
  useEffect(() => { expByTickerRef.current = expByTicker; }, [expByTicker]);

  // Per-ticker column expiries — each panel shows ITS OWN closest expiries at or
  // after the picked front (SPX-anchored) date. Falls back to the SPX list until
  // a ticker's own calendar has loaded (and for the single-expiry static mode).
  const colsByTicker = useMemo<Record<string, Expiry[]>>(() => {
    const anchor = activeExpiry ?? selectedExpiry;
    const out: Record<string, Expiry[]> = {};
    TICKERS.forEach(t => {
      const list = (expByTicker[t]?.length ? expByTicker[t] : expirations);
      out[t] = pickCols(list, anchor);
    });
    return out;
  }, [expByTicker, expirations, activeExpiry, selectedExpiry, TICKERS]);

  // Fetch weekly EM for each ticker.
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
  }, [activeExpiry, TICKERS]);

  // Fetch each ticker's own expiration calendar (cache or API). SPX also anchors
  // the toolbar picker. Skipped in static mode (snapshot carries one expiry).
  useEffect(() => {
    if (isStatic) return;
    let cancelled = false;

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

    const loadFor = async (ticker: string): Promise<Expiry[]> => {
      let list: Expiry[] = [];
      const json = await fetch(`/api/expirations?ticker=${encodeURIComponent(ticker)}`).then(r => r.json()).catch(() => null);
      if (json?.data?.items?.length) list = collect(json.data.items);
      if (!list.length) {
        const cj = await fetch(`/api/chains?ticker=${encodeURIComponent(ticker)}&range=all`).then(r => r.json()).catch(() => null);
        const items = (cj?.data?.items ?? []) as Record<string, unknown>[];
        if (items.length) list = collect(items);
      }
      return list;
    };

    (async () => {
      const entries = await Promise.all(TICKERS.map(async (t) => [t, await loadFor(t)] as const));
      if (cancelled) return;
      const map: Record<string, Expiry[]> = {};
      entries.forEach(([t, l]) => { if (l.length) map[t] = l; });
      setExpByTicker(prev => ({ ...prev, ...map }));

      const spx = map["SPX"] ?? [];
      if (spx.length) {
        setExpirations(spx);
        setSelectedExpiry(prev => prev || (spx.find(e => e.daysTo === 0) ?? spx[0]).date);
      }
    })().catch(() => {});

    return () => { cancelled = true; };
  }, [isStatic, TICKERS]);

  // Fetch chain for all tickers, then split each ticker's chain into the up-to-4
  // closest expiries (front + next 3) that form the NET GEX columns.
  const loadAll = useCallback(async (expDate: string, bustCache = false) => {
    if (isStatic) return; // static viewers never hit the live loop
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    setStatus({ state: "loading", msg: "LOADING..." });

    // Per-ticker column expiries: each ticker's OWN closest expiries at/after the
    // picked front date. Falls back to the SPX list until a ticker's calendar
    // has loaded.
    const colDatesByTicker: Record<string, string[]> = {};
    TICKERS.forEach(t => {
      const list = (expByTickerRef.current[t]?.length ? expByTickerRef.current[t] : expirationsRef.current);
      const cds = pickCols(list, expDate).map(e => e.date);
      colDatesByTicker[t] = cds.length ? cds : [expDate];
    });

    const bust = bustCache ? `&noCache=1` : "";
    const results = await Promise.allSettled(
      TICKERS.map(ticker =>
        fetch(`/api/chains?ticker=${encodeURIComponent(ticker)}&range=all${bust}`)
          .then(async r => {
            const json = await r.json();
            return { ticker, json, ok: r.ok, status: r.status };
          })
      )
    );

    if (token !== loadTokenRef.current) return;

    const newStrikes: Record<string, Record<string, StrikeRow[]>> = {};
    const newSpots: Record<string, number> = {};
    const errStatuses: number[] = [];

    // Phase 1 — the one-shot range=all per ticker. This covers the REST tickers'
    // first ≤3 expiries and, for the live-streamed underlying (SPX), only its
    // single active gated expiry.
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { ticker, json, ok, status } = result.value as { ticker: Ticker; json: Record<string, unknown>; ok: boolean; status: number };
      if (!ok || json.error) {
        errStatuses.push(status);
        console.error(`[MultGreek] ${ticker} chains failed: HTTP ${status}`, json);
        continue;
      }
      const items = (json.data as Record<string, unknown> | undefined)?.items as unknown[] ?? [];
      const byExp: Record<string, StrikeRow[]> = {};
      (colDatesByTicker[ticker] ?? []).forEach(cd => {
        const target = (items as { "expiration-date"?: string }[]).filter(i =>
          String(i["expiration-date"] ?? "").slice(0, 10) === cd.slice(0, 10)
        );
        if (!target.length) return;
        const parsed = buildStrikes(target, liveDataRef.current);
        if (parsed.length) byExp[cd] = parsed;
      });
      newStrikes[ticker] = byExp;
      const rawSpot = parseFloat(String((json.data as Record<string, unknown> | undefined)?.underlyingPrice ?? 0));
      if (isFinite(rawSpot) && rawSpot > 0) newSpots[ticker] = rawSpot;
    }

    // Phase 2 — gap-fill. range=all is capped (REST → 3 expiries; SPX live → its
    // 1 active expiry), so any column expiry it didn't return is fetched
    // EXPLICITLY. An explicit ?expiration= bypasses both caps (SPX's non-active
    // expiries then come from REST). An expiry a ticker doesn't list returns
    // empty → that column just shows "--" for it, which is correct.
    const gaps: { ticker: Ticker; date: string }[] = [];
    Object.keys(newStrikes).forEach(ticker => {
      (colDatesByTicker[ticker] ?? []).forEach(cd => {
        if (!(newStrikes[ticker][cd]?.length)) gaps.push({ ticker, date: cd });
      });
    });
    if (gaps.length) {
      const filled = await Promise.allSettled(
        gaps.map(g =>
          fetch(`/api/chains?ticker=${encodeURIComponent(g.ticker)}&expiration=${encodeURIComponent(g.date)}${bust}`)
            .then(async r => ({ ...g, json: await r.json(), ok: r.ok }))
        )
      );
      if (token !== loadTokenRef.current) return;
      for (const f of filled) {
        if (f.status !== "fulfilled" || !f.value.ok) continue;
        const { ticker, date, json } = f.value as { ticker: Ticker; date: string; json: Record<string, unknown> };
        const items = (json.data as Record<string, unknown> | undefined)?.items as unknown[] ?? [];
        if (!items.length) continue;
        const parsed = buildStrikes(items, liveDataRef.current);
        if (parsed.length) newStrikes[ticker][date] = parsed;
        if (!(newSpots[ticker] > 0)) {
          const rawSpot = parseFloat(String((json.data as Record<string, unknown> | undefined)?.underlyingPrice ?? 0));
          if (isFinite(rawSpot) && rawSpot > 0) newSpots[ticker] = rawSpot;
        }
      }
    }

    const successCount = Object.keys(newStrikes).filter(t => Object.keys(newStrikes[t]).length).length;

    activeExpiryRef.current = expDate;
    setActiveExpiry(expDate);
    if (successCount > 0) {
      setStrikes(prev => ({ ...prev, ...newStrikes }));
      setSpots(prev => {
        const merged = { ...prev };
        Object.keys(newSpots).forEach(tk => {
          const v = newSpots[tk];
          if (v && v > 0) merged[tk] = v;
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
  }, [isStatic, TICKERS]);

  const doGo = useCallback(() => {
    if (isStatic || !selectedExpiry) return;
    loadAll(selectedExpiry);
  }, [isStatic, selectedExpiry, loadAll]);

  // Auto-load when expirations are ready
  useEffect(() => {
    if (isStatic) return;
    if (selectedExpiry && BASE_TICKERS.every(t => Object.keys(strikes[t] ?? {}).length === 0)) {
      loadAll(selectedExpiry);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStatic, selectedExpiry]);

  // Reload whenever any ticker's own expiration calendar (re)loads — covers the
  // initial fill and switching the custom 4th ticker — so each panel's chain is
  // pulled for ITS own column dates, not a stale/SPX-aligned set.
  useEffect(() => {
    if (isStatic) return;
    if (!Object.keys(expByTicker).length) return;
    const exp = activeExpiryRef.current || selectedExpiry;
    if (exp) loadAll(exp, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expByTicker]);

  // Safety net: if expirations never resolved (cold proxy / market closed),
  // still auto-load the prewarmed 0DTE chains by deriving the nearest
  // expiration from the chain response itself.
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
  }, [isStatic, loadAll]);

  // Auto-refresh every 15s while the market is open so per-strike volume fills in.
  useEffect(() => {
    if (isStatic) return;
    const id = setInterval(() => {
      const exp = activeExpiryRef.current;
      if (exp && isMarketOpen()) loadAll(exp, true);
    }, 15000);
    return () => clearInterval(id);
  }, [isStatic, loadAll]);

  // Sample every displayed cell's NET GEX on each data update so the click card
  // can show 15m / 30m / open change. Ring pruned to ~35 min; the day's first
  // RTH reading is kept separately for Δ-open.
  useEffect(() => {
    const now = Date.now();
    const today = todayETStr();
    const open = isMarketOpen();
    const volOnly = contractMode === "vol";
    const RING_MS = 35 * 60_000;
    TICKERS.forEach(t => {
      const spot = spots[t] ?? 0;
      const byExp = strikes[t];
      if (!(spot > 0) || !byExp) return;
      Object.entries(byExp).forEach(([exp, rows]) => {
        rows.forEach(r => {
          const v = strikeGex(r, liveDataRef.current, spot, volOnly);
          const key = `${t}|${exp}|${r.strike}`;
          const arr = gexHistRef.current.get(key) ?? [];
          arr.push({ t: now, v });
          while (arr.length && arr[0].t < now - RING_MS) arr.shift();
          gexHistRef.current.set(key, arr);
          if (open) {
            const o = gexOpenRef.current.get(key);
            if (!o || o.date !== today) gexOpenRef.current.set(key, { date: today, v });
          }
        });
      });
    });
  }, [strikes, spots, contractMode, TICKERS]);

  // Read the 15m / 30m / open change for one cell (ticker+expiry+strike).
  const getGexChange = useCallback((ticker: string, expiry: string, strike: number) => {
    const arr = gexHistRef.current.get(`${ticker}|${expiry}|${strike}`) ?? [];
    const now = arr.length ? arr[arr.length - 1].v : 0;
    const at = (agoMs: number): number | null => {
      const cutoff = Date.now() - agoMs;
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i].t <= cutoff) return arr[i].v;
      return null; // not enough history yet
    };
    const v15 = at(15 * 60_000);
    const v30 = at(30 * 60_000);
    const o = gexOpenRef.current.get(`${ticker}|${expiry}|${strike}`);
    return {
      now,
      d15: v15 == null ? null : now - v15,
      d30: v30 == null ? null : now - v30,
      dOpen: o == null ? null : now - o.v,
      spanMs: arr.length ? Date.now() - arr[0].t : 0,
    };
  }, []);

  // ── Static (delayed) mode: seed from the frozen snapshot (single expiry),
  // then poll for the recorder's next ~30m tick. ──
  const [lastSnapshotTs, setLastSnapshotTs] = useState<number | null>(snapshotTs);
  useEffect(() => {
    if (!isStatic) return;

    const applySnapshot = (snap: MultGreekSnapshot | null | undefined) => {
      if (!snap || !snap.expiry) return;
      const newStrikes: Record<string, Record<string, StrikeRow[]>> = {};
      const newSpots: Record<string, number> = {};
      TICKERS.forEach((ticker) => {
        const t = snap.tickers?.[ticker];
        if (!t || !Array.isArray(t.items) || !t.items.length) return;
        const parsed = buildStrikes(t.items, liveDataRef.current);
        if (parsed.length) newStrikes[ticker] = { [snap.expiry]: parsed };
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
    const id = setInterval(poll, 60_000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStatic]);

  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(doRefresh);

  const statusColors: Record<string, string> = {
    live: HT.green, loading: HT.orange, err: HT.red, idle: HT.red,
  };

  const pageRef = useRef<HTMLDivElement>(null);

  const CAPTURE_WINDOW = 20; // 41 strikes (ATM ± 20)
  const [captureWindow, setCaptureWindow] = useState<number | null>(null);
  const beginCapture = useCallback(() => {
    setCaptureWindow(CAPTURE_WINDOW);
    return new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 50))));
  }, []);
  const endCapture = useCallback(() => setCaptureWindow(null), []);

  const isCapturing = captureWindow != null;

  return (
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
            fontSize: 17,
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

      {/* Toolbar */}
      <div style={{ display: "flex", padding: "6px 10px 2px", flexShrink: 0 }}>
      <Dock className="dock-noscroll" flat fullWidth style={{ width: "100%" }}>

        {/* Status dot */}
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: isStatic ? HT.cyan : (statusColors[status.state] ?? HT.muted), flexShrink: 0, display: "inline-block" }} />
        <span style={{ fontSize: 10, fontWeight: 800, color: isStatic ? HT.cyan : (statusColors[status.state] ?? HT.text), letterSpacing: "0.1em", whiteSpace: "nowrap", flexShrink: 0 }}>{status.msg}</span>

        {/* Front-expiry picker — the shown columns are this + the next 3 closest */}
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
          options={[{ label: "OI+VOL", value: "oivol" }, { label: "VOL", value: "vol" }]}
          active={contractMode}
          onChange={(v) => setContractMode(v as typeof contractMode)}
        />

        <DockGap />

        {/* Δ bar mode — OFF shows NET GEX values; 5M/15M/30M replaces every cell
            value with a diverging change bar. Applies to all panels at once. */}
        <SegGroup
          options={[
            { label: "Δ OFF", value: "0" },
            { label: "5M", value: "5" },
            { label: "15M", value: "15" },
            { label: "30M", value: "30" },
          ]}
          active={String(deltaWindow)}
          onChange={(v) => setDeltaWindow(Number(v) as DeltaWindow)}
        />

        <DockGap />

        {/* CB / CW / PW top-|GEX| level badges (front expiry). Click to toggle. */}
        {[
          { key: "CB", on: showCB, set: setShowCB, color: "#ffd600", title: "Core Bullseye — highest |GEX| level" },
          { key: "CW", on: showCW, set: setShowCW, color: "#29b6f6", title: "Call Wall — highest +GEX level" },
          { key: "PW", on: showPW, set: setShowPW, color: "#ff4757", title: "Put Wall — most −GEX level" },
        ].map(b => (
          <button
            key={b.key}
            onClick={() => b.set(v => !v)}
            title={`${b.key}: ${b.title} — click to ${b.on ? "hide" : "show"}`}
            style={{
              padding: "3px 7px", fontSize: 10, fontWeight: 900, letterSpacing: "0.04em",
              borderRadius: 5, cursor: "pointer", whiteSpace: "nowrap",
              color: b.on ? "#04121a" : HT.muted,
              background: b.on ? b.color : "transparent",
              border: `1px solid ${b.on ? b.color : HT.border}`,
              opacity: b.on ? 1 : 0.65,
            }}
          >{b.key}</button>
        ))}

        {/* 4th ticker input — persisted per browser (localStorage). Live only. */}
        {!isStatic && (
          <>
            <DockGap />
            <span style={{ fontSize: 10, fontWeight: 800, color: HT.muted, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>4TH</span>
            <input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitTicker(); (e.target as HTMLInputElement).blur(); } }}
              onBlur={commitTicker}
              placeholder="TICKER"
              maxLength={6}
              spellCheck={false}
              autoCapitalize="characters"
              style={{
                width: 66, padding: "4px 6px", fontSize: 11, fontWeight: 800,
                letterSpacing: "0.08em", textTransform: "uppercase", textAlign: "center",
                background: HT.panelBgStrong, color: HT.cyan,
                border: `1px solid ${HT.border}`, borderRadius: 6, outline: "none",
              }}
            />
          </>
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
        <BoxDiscordBtn targetRef={pageRef} fitContent onBeforeCapture={beginCapture} onAfterCapture={endCapture} message={`📊 Multi-Greek GEX by Expiry — ${new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false})} ET`} />
      </Dock>
      </div>

      {/* Panels */}
      {embed && (
        <style>{`
          .mg-panels.mg-embed { flex-direction: row !important; overflow: hidden !important; height: auto !important; }
          .mg-panels.mg-embed > div { flex: 1 1 0 !important; width: auto !important; min-height: 0 !important; }
        `}</style>
      )}
      <div className={`mg-panels${embed ? " mg-embed" : ""}`} style={{ flex: isCapturing ? "0 0 auto" : 1, display: "flex", alignItems: isCapturing ? "flex-start" : "stretch", gap: 8, padding: 8, overflow: isCapturing ? "visible" : "hidden", minHeight: 0 }}>
        {TICKERS.map(ticker => (
          <TickerPanel
            key={ticker}
            ticker={ticker}
            strikesByExp={strikes[ticker] ?? {}}
            cols={colsByTicker[ticker] ?? []}
            liveData={liveDataRef.current}
            spot={spots[ticker] ?? 0}
            contractMode={contractMode}
            intensity={intensity}
            emLevels={emByTicker[ticker] ?? null}
            showEm={!!activeExpiry && isCurrentWeekExp(activeExpiry)}
            captureWindow={captureWindow}
            showCB={showCB}
            showCW={showCW}
            showPW={showPW}
            getGexChange={getGexChange}
            deltaWindow={deltaWindow}
          />
        ))}
      </div>
    </div>
  );
}
