"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ColorType, CrosshairMode, LineSeries, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi, LineData, UTCTimestamp } from "lightweight-charts";
import { BoxDiscordBtn, BoxSnapBtn } from "@/components/shared/DataBox";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { HOME_THEME as HT, homeShellStyle, homeButtonStyle } from "@/components/shared/homeTheme";
import { atMinIntensity, columnWalls, wallAt, INTENSITY_MIN, WALL_RANK } from "@/lib/calculations/heatLevels";
import { Dock, SegGroup, DockCogMenu, DockField } from "@/components/shared/DockToolbar";
import { ChainReplay } from "@/components/shared/ChainReplay";
import { useScannerTickers } from "@/lib/useScannerTickers";
import { dedupeFetch } from "@/lib/dedupeFetch";
import { etDateKey, etToday, isSessionLive, isSpxFeedLive, isTradingDay } from "@/lib/marketSession";
// Chain math (GreekCell, parseExpiration, metricBg) moved to lib/ so the ES
// Candles page's 0DTE side panel can share it without importing this route.
import { parseExpiration, type GreekCell, type DataMode } from "@/lib/calculations/optionChain";
// Heat SKIN — how a cell is PAINTED (ramp, rank floors, level fill), shared
// with the Multi Greek ladder so "vivid" means the identical picture on both.
// See lib/calculations/heatSkins.
import { HEAT_SKINS, isHeatSkin, skinMetricBg, skinRankBg, levelFillBg, type HeatSkin } from "@/lib/calculations/heatSkins";

// rgba helper — matches the convention used across themed pages.
function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

// Soft-white cell value + green/red leading sign — the Multi-Greek cell format,
// shared here so the option chain / heatmap / mult-greek read identically.
const SOFT_WHITE = "#c3ccda";
function SignVal({ text }: { text: string }) {
  if (!text || text === "--" || text === "·") return <>{text}</>;
  const s = text[0] === "+" || text[0] === "-" ? text[0] : "";
  const rest = s ? text.slice(1) : text;
  const c = s === "+" ? "#22c55e" : s === "-" ? "#ef4444" : SOFT_WHITE;
  return <>{s && <span style={{ color: c }}>{s}</span>}{rest}</>;
}

// ── Heat skin, as this grid wears it ────────────────────────────────────────
// The RAMP, the rank floors and the level fill come straight from HEAT_SKINS —
// that is what makes "vivid on the chain" the same vivid as Multi Greek. What
// does NOT carry over is the skin's `cell` block: Multi Greek's cells are 9px
// figures in four side-by-side panels, this grid's are 10px mono in a much
// denser table with sticky rails, so the geometry is stated here per skin.
// CLASSIC's entry is byte-for-byte the chain as it shipped — switching skins
// must be reversible to exactly the old page.
/** Saved skin choice, per browser. */
const CHAIN_HEAT_SKIN_KEY = "chain_heat_skin";
/** What an untouched chain loads with. */
const CHAIN_DEFAULT_SKIN: HeatSkin = "vivid";

const CHAIN_CELL: Record<HeatSkin, {
  radius: number; inset: number; fontSize: number; shadow?: string;
  text: string; weight: readonly [number, number, number]; signColors: boolean;
}> = {
  classic: {
    radius: 0, inset: 0, fontSize: 10,
    text: SOFT_WHITE, weight: [400, 400, 400], signColors: true,
  },
  vivid: {
    // 0.5px margin, not a grid gap: it separates the tiles without moving the
    // column tracks, so the sticky header and the strike rails stay aligned.
    radius: 3, inset: 0.5, fontSize: 9.5,
    shadow: "0 1px 2px rgba(0,0,0,0.85)",
    // White on a near-opaque fill, and NO coloured +/−: at this ramp a cell can
    // be a full-strength red tile, and a green "+" on it is the unreadable
    // case. Direction is carried by the tint, exactly as the count tabs' ⅀
    // cells already do it.
    text: "#ffffff", weight: [600, 600, 300], signColors: false,
  },
};

/** A value's 1/2/3 standing in its column (0 = unranked) — the skin ramp's
 *  rank floors key off this. Same test the old metricBg() made internally. */
function rankOf(value: number, topValues: number[]): number {
  const i = topValues.indexOf(Math.abs(value));
  return i >= 0 && i < 3 ? i + 1 : 0;
}

// ── Cell markers ────────────────────────────────────────────────────────────
// The ★ (CB) and ✕ (volume-GEX peak) sit on top of the heat fill, which at full
// intensity is a saturated blue or red. Gold-on-blue and red-on-red both wash
// out at 10px, so both glyphs are drawn with a hard black edge (paint-order:
// stroke, so the stroke sits OUTSIDE the fill and doesn't eat the glyph) plus a
// white halo. That pairing reads on every background the scale can produce.
const MARKER_EDGE: React.CSSProperties = {
  WebkitTextStrokeWidth: "1px",
  WebkitTextStrokeColor: "#000",
  paintOrder: "stroke fill" as unknown as React.CSSProperties["paintOrder"],
  textShadow: "0 0 3px rgba(255,255,255,.9), 0 0 1px rgba(0,0,0,1)",
};

/** Δ chip text. `d` arrives in RAW DOLLARS — the same units as every other GEX
 *  value on this chain — so it is scaled exactly as fmtMoney does. Always
 *  millions, so the chip and the value beside it share one unit; a move under
 *  $1M reports as "<$1M" rather than rounding to a meaningless "$0M". */
function fmtDeltaChip(d: number): string {
  if (!isFinite(d)) return "--";
  const sign = d < 0 ? "−" : "+";
  const m = Math.round(Math.abs(d) / 1e6);
  if (m === 0) return `${sign}<$1M`;
  return `${sign}$${m.toLocaleString("en-US")}M`;
}

/** Δ15 sticker — the front-expiry 15-minute NET GEX change, same chip the
 *  multi-chain ladder stamps on its front column. Uniform dark plate so it reads
 *  identically on a full-strength wall and on a quiet far strike; direction is
 *  carried by the number's colour alone. */
function DeltaStamp({ d, pct, rank }: { d: number; pct: number; rank: number }) {
  const text = fmtDeltaChip(d);
  return (
    <span
      title={`Δ15m ${text} · #${rank} mover (${Math.abs(Math.round(pct))}%)`}
      style={{
        flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
        height: 14, boxSizing: "border-box",
        fontSize: 9, fontWeight: rank === 1 ? 900 : 800,
        fontFamily: "var(--font-mono)", lineHeight: 1,
        padding: "0 4px", borderRadius: 4, whiteSpace: "nowrap",
        background: "#0D1119",
        color: d > 0 ? "#4ade80" : "#f87171",
        border: "none",
      }}
    >{text}</span>
  );
}

// ── Custom dropdown (bypasses native OS rendering) ─────────────────────────
function CustomDropdown<T extends string | number>({
  value,
  options,
  onChange,
  formatLabel,
  triggerLabel,
  accentCyan,
}: {
  value: T;
  options: T[] | readonly T[];
  onChange: (v: T) => void;
  formatLabel?: (v: T) => string;
  triggerLabel?: string;
  accentCyan?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const label = triggerLabel ?? (formatLabel ? formatLabel(value) : String(value));

  // Anchor the portal'd menu under the trigger.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 3, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  // Close on outside click (trigger or portal'd menu both count as "inside").
  useEffect(() => {
    function h(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const color = accentCyan !== false ? HT.cyan : HT.text;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        style={{
          fontSize: 10, fontWeight: 700, padding: "5px 10px",
          border: `1px solid ${accentCyan !== false ? "rgba(33,158,188,.25)" : HT.border}`,
          borderRadius: 6,
          background: accentCyan !== false
            ? "linear-gradient(180deg,rgba(33,158,188,.12),rgba(33,158,188,.04))"
            : "rgba(255,255,255,0.04)",
          color,
          cursor: "pointer", outline: "none",
          display: "flex", alignItems: "center", gap: 5,
          whiteSpace: "nowrap",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {label}
        <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {open && rect && createPortal(
        <div ref={menuRef} style={{
          // ABOVE the dock/cog panels. DockToolbar's popoverPanel sits at
          // z-index 100000, so a 9999 menu opened from INSIDE the cog (the
          // Grid tab's "% strikes" picker) rendered underneath it. Any value
          // here must stay above DockToolbar's — they are siblings under
          // <body> via portals, so nothing else orders them.
          position: "fixed", left: rect.left, top: rect.top, zIndex: 100010,
          minWidth: rect.width,
          background: "rgba(13,17,25,0.97)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          border: `1px solid ${HT.border}`, borderTop: `2px solid ${rgba(HT.cyan, 0.5)}`, borderRadius: 6,
          padding: "3px 0",
          boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
          maxHeight: 320, overflowY: "auto",
        }}>
          {options.map(opt => {
            const optLabel = formatLabel ? formatLabel(opt) : String(opt);
            const active = opt === value;
            return (
              <div
                key={String(opt)}
                onClick={() => { onChange(opt); setOpen(false); }}
                style={{
                  padding: "6px 12px", fontSize: 10, fontWeight: active ? 800 : 600,
                  cursor: "pointer", whiteSpace: "nowrap",
                  color: active ? HT.cyan : HT.text,
                  background: active ? "rgba(33,158,188,0.10)" : "transparent",
                  letterSpacing: "0.04em",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = active ? "rgba(33,158,188,0.15)" : "rgba(255,255,255,0.05)")}
                onMouseLeave={e => (e.currentTarget.style.background = active ? "rgba(33,158,188,0.10)" : "transparent")}
              >
                {optLabel}
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Scanner ticker universe ──────────────────────────────────────────────────
// Was a second hardcoded copy of server-v2/scanner-tickers.js, kept in sync by
// hand (and drifting). Now imported from lib/scannerTickers — live via
// /proxy/scanner-tickers with a static fallback.

// Favorite tickers (starred in the ticker dropdown) persisted in the browser.
const FAV_TICKERS_KEY = "options-chain-fav-tickers-v1";
function loadFavTickers(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAV_TICKERS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === "string") : [];
  } catch { return []; }
}
function saveFavTickers(list: string[]): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(FAV_TICKERS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

// ── Ticker picker: searchable dropdown over the full scanner universe, with
// star-to-favorite (favorites float to the top, persisted in localStorage). ──
function TickerListDropdown({ activeTicker, onSelect }: { activeTicker: string; onSelect: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [favs, setFavs] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => { setFavs(loadFavTickers()); }, []);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 3 });
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
    function h(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // The search box starts EMPTY every time the menu opens.
  //
  // It used to keep whatever you last typed, which is only ever right if your
  // next search is a prefix of your last one. Every other time — and the common
  // case is picking a ticker, coming back, and wanting a DIFFERENT one — the
  // list reopens pre-filtered to a stale query and the first thing you have to
  // do is clear a box you did not fill in. The old text has already done its
  // job the moment a ticker is selected.
  //
  // Cleared on CLOSE rather than on open so the menu never renders one frame of
  // stale filtering on the way in. Every close route (select, outside click,
  // re-clicking the trigger) flips `open`, so this covers all of them.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const toggleFav = (t: string) =>
    setFavs((prev) => {
      const next = prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t];
      saveFavTickers(next);
      return next;
    });

  const { tickers: scannerTickers } = useScannerTickers();
  const favSet = new Set(favs);
  const q = query.trim().toUpperCase();
  const matches = scannerTickers.filter((t) => !q || t.includes(q));
  const favList = matches.filter((t) => favSet.has(t)).sort();
  const rest = matches.filter((t) => !favSet.has(t)).sort();
  const rows: Array<{ t: string; fav: boolean; divider?: boolean }> = [
    ...favList.map((t) => ({ t, fav: true })),
    ...(favList.length && rest.length ? [{ t: "__divider__", fav: false, divider: true }] : []),
    ...rest.map((t) => ({ t, fav: false })),
  ];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        style={{
          fontSize: 10, fontWeight: 700, padding: "5px 10px",
          border: `1px solid ${HT.border}`, borderRadius: 6,
          background: "rgba(255,255,255,0.04)", color: HT.text,
          cursor: "pointer", outline: "none",
          display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
          letterSpacing: "0.08em", textTransform: "uppercase",
        }}
      >
        Tickers
        <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {open && rect && createPortal(
        <div ref={menuRef} style={{
          position: "fixed", left: rect.left, top: rect.top, zIndex: 9999, width: 200,
          background: "rgba(13,17,25,0.97)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          border: `1px solid ${HT.border}`, borderTop: `2px solid ${rgba(HT.cyan, 0.5)}`, borderRadius: 6,
          boxShadow: "0 8px 32px rgba(0,0,0,0.7)", overflow: "hidden",
        }}>
          <div style={{ padding: 6, borderBottom: `1px solid ${HT.border}` }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              placeholder="Search…"
              spellCheck={false}
              autoComplete="off"
              style={{
                width: "100%", boxSizing: "border-box", fontSize: 11, fontWeight: 700,
                padding: "5px 8px", border: `1px solid ${HT.border}`, borderRadius: 5,
                background: "rgba(255,255,255,0.04)", color: HT.text, outline: "none",
                letterSpacing: "0.06em",
              }}
            />
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto", padding: "3px 0" }}>
            {rows.length === 0 && (
              <div style={{ padding: "8px 12px", fontSize: 10, color: HT.muted }}>No match</div>
            )}
            {rows.map((row) => {
              if (row.divider) {
                return <div key="div" style={{ height: 1, background: HT.border, margin: "3px 8px" }} />;
              }
              const active = row.t === activeTicker.toUpperCase();
              return (
                <div
                  key={row.t}
                  onClick={() => { onSelect(row.t); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 10px", fontSize: 11, fontWeight: active ? 800 : 600,
                    cursor: "pointer", whiteSpace: "nowrap",
                    color: active ? HT.cyan : HT.text,
                    background: active ? "rgba(33,158,188,0.10)" : "transparent",
                    letterSpacing: "0.04em",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = active ? "rgba(33,158,188,0.15)" : "rgba(255,255,255,0.05)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = active ? "rgba(33,158,188,0.10)" : "transparent")}
                >
                  <span
                    onClick={(e) => { e.stopPropagation(); toggleFav(row.t); }}
                    title={row.fav ? "Unfavorite" : "Favorite"}
                    style={{
                      cursor: "pointer", fontSize: 12, lineHeight: 1,
                      color: row.fav ? "#ffd600" : "rgba(255,255,255,0.28)",
                    }}
                  >
                    {row.fav ? "★" : "☆"}
                  </span>
                  <span>{row.t}</span>
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

// Recent tickers (most-recent-first, max 7) persisted in the browser.
const RECENT_TICKERS_KEY = "options-chain-recent-tickers-v1";
const RECENT_TICKERS_MAX = 7;

function loadRecentTickers(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_TICKERS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === "string").slice(0, RECENT_TICKERS_MAX) : [];
  } catch { return []; }
}

function pushRecentTicker(list: string[], ticker: string): string[] {
  const t = ticker.toUpperCase();
  const next = [t, ...list.filter((x) => x !== t)].slice(0, RECENT_TICKERS_MAX);
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(RECENT_TICKERS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }
  return next;
}

const DISPLAY_PERCENTS = [5, 10, 15, 20, 25, 30, 50, 100] as const;
// "oi" is not a greek — it rides in this list because it is the same kind of
// per-strike, per-expiry lens as the four greeks and reuses the whole matrix
// (heat scale, column totals, ⅀ Total). Its cells render differently though:
// call OI and put OI on two lines, each with its day-over-day change, sourced
// from /proxy/oi-change (see server-v2/oi-daily-recorder.js).
//
// "vol" sits next to it and reads the same way — same ladder, same one count
// per side — but is a different quantity from a different source: today's LIVE
// traded contract count, straight off the chain, with no recorder and no
// day-over-day diff. OI is the settled book's overnight move; VOL is what has
// actually traded so far today.
const GREEK_MODES = ["gex", "dex", "chex", "vex", "oi", "vol"] as const;
type GreekMode = typeof GREEK_MODES[number];

const DATA_MODES = ["oi-vol", "vol-only", "flow"] as const;

const DATA_MODE_LABEL: Record<DataMode, string> = {
  "oi-vol": "OI + Vol",
  "vol-only": "Vol Only",
  "flow": "Flow GEX",
};

// Change-mode: "live" = normal greek values; 15/30/60 = Δ in front-expiry
// volume-GEX vs N minutes ago, sourced from the strike_growth table (same logic
// as the /strike-growth tracker). Only the FRONT-expiry column carries history;
// other expiry columns fall back to live values with a muted look.
const CHANGE_MODES = ["live", "15", "30", "60"] as const;
type ChangeMode = typeof CHANGE_MODES[number];
const CHANGE_MODE_LABEL: Record<ChangeMode, string> = {
  live: "Live",
  "15": "15m Δ",
  "30": "30m Δ",
  "60": "60m Δ",
};

// ── Replay mode ─────────────────────────────────────────────────────────────
// Rewinds the GRID ITSELF: every cell renders from a recorded strike_growth
// snapshot instead of the live chain, and the strike window, heat scales,
// column totals and MVC markers all follow — because replay swaps `columns` at
// the source rather than painting an overlay on top of live data.
//
// What that costs, stated here because it shapes the whole UI below:
//   • strike_growth records only the top STRIKE_GROWTH_TOP_N strikes per side
//     per expiry per sweep (15 on prod). It is a record of the WALLS, not of
//     the whole chain — a strike that was never a wall has no history to play.
//   • Only GEX is recorded. DEX/CHEX/VEX/OI are live-only, so replay pins the
//     greek tab to GEX rather than showing zeros in a tab that looks normal.
//   • Cadence is the recorder's sweep (2 min hot lane / 5 min full roster), not
//     per-tick, and retention is ~5 trading days.
// Each of those is stated in the replay bar rather than left to be discovered.
const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8] as const;
const REPLAY_BASE_MS = 700; // frame interval at 1× — matches ChainReplay's ladder

// ── Replay expiry scope ─────────────────────────────────────────────────────
// A recorded session usually carries several expiries. Two ways to read it:
//   "0dte" → ONE column: the expiry that expires on the session being replayed
//            (or, for a root with no same-day listing, the front expiry that
//            session recorded). The day's gamma, with nothing else summed in.
//   "all"  → every recorded expiry side-by-side, plus the ⅀ Total column.
// The ⅀ Total column keeps its live-chain meaning in BOTH cases — a sum over
// the non-0DTE expiries — which is exactly why it is hidden in "0dte" scope:
// with only the 0DTE column rendered there is nothing left for it to total, and
// a column of zeros beside real numbers reads as "no gamma", not "not summed".
const REPLAY_SCOPES = ["0dte", "all"] as const;
type ReplayScope = typeof REPLAY_SCOPES[number];
const REPLAY_SCOPE_LABEL: Record<ReplayScope, string> = {
  "0dte": "0DTE",
  all: "All exp",
};

/** One recorded sweep: the clock, the spot at that clock, and `exp|strike` → GEX. */
type ReplayFrame = {
  ts: string;
  spot: number;
  /** `${expiry}|${strike}` → { net: OI+Vol GEX, vol: volume-only GEX } */
  cells: Map<string, { net: number; vol: number }>;
  /** The expiries THIS frame carried — the front one can roll intraday. */
  expiries: string[];
};

function fmtReplayClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  } catch { return iso; }
}

// Number of expirations shown side-by-side across the matrix (sequential mode).
const EXP_COLUMNS = 14;

// How far spot must drift — in STRIKE STEPS, not dollars — before the strike
// window re-centers. Without this the window re-centers the instant spot
// crosses a strike midpoint, so the whole ladder slides a row while you're
// reading it, and on a chippy tape it can slide back and forth across one
// boundary indefinitely. Anchoring the centre and only moving it every N
// strikes trades an exactly-centred ATM for a grid that holds still.
//
// The ATM row itself is NOT anchored: `nearestStrike` stays the true nearest
// strike, so the ATM highlight, the OI call/put side split and the pin walls
// all keep following real spot. Only where the window is CENTRED is sticky, so
// the ATM row drifts up to N−1 rows off the middle between re-centres. The
// smallest window is 11 rows (wing 5), so it can never drift out of view.
const RECENTER_EVERY_STRIKES = 5;

/**
 * Where the strike window should be centred, given the current anchor.
 *
 * ONE function, called by both the render that draws the window and the effect
 * that persists the anchor. Written as two copies of the same comparison, the
 * anchor only caught up on the render AFTER the one that crossed the threshold
 * — so the grid painted a stale centre for a frame every time it re-centred.
 * Shared, they cannot disagree and there is no lag.
 *
 * `anchorKey` identifies the chain the anchor was taken on. Two chains can list
 * the same strike price (SPY 500, QQQ 500), so an anchor from another ticker or
 * another replay session is discarded rather than silently reused.
 */
function pickCenterStrike(
  allStrikes: number[],
  nearestStrike: number,
  anchor: { key: string; strike: number },
  anchorKey: string,
): number {
  if (!allStrikes.length || !nearestStrike) return nearestStrike;
  const anchorIdx = anchor.key === anchorKey ? allStrikes.indexOf(anchor.strike) : -1;
  const trueIdx = allStrikes.indexOf(nearestStrike);
  // No usable anchor (first paint, new chain, or the anchored strike was
  // delisted) → centre on true ATM and let the effect anchor there.
  if (anchorIdx < 0 || trueIdx < 0) return nearestStrike;
  return Math.abs(trueIdx - anchorIdx) >= RECENTER_EVERY_STRIKES ? nearestStrike : anchor.strike;
}

// "key" mode (used by the /new-home embed): instead of the next N sequential
// expirations from the user's selected date, show exactly 0DTE / 1DTE /
// closest weekly (nearest Friday listing) / closest monthly (nearest 3rd-
// Friday standard monthly listing). Each slot is claimed independently so a
// Friday 0DTE doesn't also swallow the weekly column.
function pickKeyExpirations(all: Array<{ value: string; label: string }>): Array<{ value: string; label: string }> {
  const todayKey = etDateKey(etToday());
  const future = [...all].filter((e) => e.value >= todayKey).sort((a, b) => a.value.localeCompare(b.value));
  if (!future.length) return [];

  const claimed = new Set<string>();
  const out: Array<{ value: string; label: string }> = [];

  const zeroDte = future[0];
  claimed.add(zeroDte.value);
  out.push(zeroDte);

  const oneDte = future.find((e) => !claimed.has(e.value));
  if (oneDte) { claimed.add(oneDte.value); out.push(oneDte); }

  const isFriday = (iso: string) => new Date(iso + "T12:00:00").getDay() === 5;
  const weekly = future.find((e) => !claimed.has(e.value) && isFriday(e.value)) ?? future.find((e) => !claimed.has(e.value));
  if (weekly) { claimed.add(weekly.value); out.push(weekly); }

  const isThirdFriday = (iso: string) => {
    const d = new Date(iso + "T12:00:00");
    if (d.getDay() !== 5) return false;
    const day = d.getDate();
    return day >= 15 && day <= 21;
  };
  const monthly =
    future.find((e) => !claimed.has(e.value) && isThirdFriday(e.value)) ??
    future.find((e) => !claimed.has(e.value) && isFriday(e.value)) ??
    future.find((e) => !claimed.has(e.value));
  if (monthly) { claimed.add(monthly.value); out.push(monthly); }

  return out;
}


// One expiration's column: its date + a strike→greek map.
type ExpColumn = {
  expiration: string;
  label: string;
  cells: Map<number, GreekCell>;
  underlying: number;
};

// ET calendar + feed-live gates now live in lib/marketSession (imported at the
// top of this file). They were defined here; the phone pages need the same
// answers, and two independent copies is how the two views drift apart.

function buildExpiries() {
  const today = etToday();
  const list: Array<{ value: string; label: string }> = [];
  let daysAdded = 0;
  let offset = 0;

  // Day abbreviations
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Find next 14 trading days
  while (daysAdded < 14 && offset < 40) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);

    if (isTradingDay(date)) {
      const value = etDateKey(date);
      const dayName = dayNames[date.getDay()];
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      list.push({ value, label: `${dayName}, ${mm}-${dd}-${date.getFullYear()}` });
      daysAdded++;
    }

    offset++;
  }

  return list;
}

function fmtMoney(value: number) {
  const sign = value >= 0 ? "+" : "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// Open interest is a CONTRACT COUNT, not dollars — fmtMoney's "$" and its
// always-on sign would both be wrong for it. Unsigned compact count: 12.4K, 1.2M.
function fmtCount(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

// Signed compact count for the ΔOI column: "+1.2K", "-430", "·" for flat.
// Flat is rendered as a dot rather than "+0" because on any given morning most
// strikes genuinely didn't change, and a wall of "+0" buries the ones that did.
function fmtChg(value: number) {
  if (!value) return "·";
  return `${value > 0 ? "+" : "-"}${fmtCount(Math.abs(value))}`;
}

// Compact column header for an expiration: "Mon 06-23".
function fmtExpHeader(iso: string): string {
  // Parse as UTC to avoid local-TZ date shift (e.g. "2026-07-01" → Jun 30 in UTC-N).
  const dt = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(dt.getTime())) return iso;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${days[dt.getUTCDay()]} ${mm}-${dd}`;
}

// True when `iso` (YYYY-MM-DD) falls in the CURRENT trading week (Mon–Fri of the
// week that contains the upcoming/!this Friday), in ET. The stored weekly EM only
// applies to current-week expirations, so EM bands render only for those.
function isCurrentWeekExp(iso: string): boolean {
  if (!iso) return false;
  const now = etToday();
  const dow = now.getDay(); // 0=Sun..6=Sat
  // Monday of this week (treat Sun as belonging to the week just ended → next Mon).
  const monday = new Date(now);
  const toMon = dow === 0 ? 1 : 1 - dow; // Sun→+1 (next Mon), else back to Mon
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



// ── contract flow sparkline popup ──────────────────────────────────────────
// Clicking a 0DTE SPX cell opens this: the same per-strike Flow GEX time
// series as the Flow GEX History tab/page (components/dashboard/
// FlowGexHistoryPanel.tsx), filtered to just the clicked strike. The
// /proxy/flow-gex-history endpoint returns a combined call+put flowGex per
// strike (gamma isn't tracked per print, only from ~60s snapshots — same
// approximation noted on that panel), so this shows "this 0DTE strike's flow
// GEX today," not a single call-only or put-only leg.
interface FlowGexPoint { ts: number; timeEt: string; callNet: number; putNet: number; flowGex: number | null }
interface FlowGexHistoryResponse { date: string; expiration: string; spot: number; strikes: number[]; seriesByStrike: Record<string, FlowGexPoint[]> }

function fmtFlowMoney(v: number): string {
  const sign = v >= 0 ? "+" : "-";
  const abs = Math.abs(v);
  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
}

function ContractFlowPopup({ strike, expiration, onClose }: { strike: number; expiration: string; onClose: () => void }) {
  const [data, setData] = useState<FlowGexHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  // 15s client-side timeout — this query reconstructs per-minute history from
  // raw tape (Postgres window-function CTE over flow_prints), which can be
  // slow under load; better to surface "still loading, try again" than hang
  // on "Loading…" forever with no feedback.
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    // strike= narrows the server query to just this one strike (fast path —
    // see flow-gex-history.js) instead of reconstructing all ~41 strikes in
    // the default spot-centered window, which was timing out.
    fetch(`/proxy/flow-gex-history?expiration=${encodeURIComponent(expiration)}&strike=${encodeURIComponent(strike)}`, { cache: "no-store", signal: controller.signal })
      .then((r) => r.json())
      .then((json: FlowGexHistoryResponse) => {
        if (cancelled) return;
        if (!json || !Array.isArray(json.strikes)) { setError("No response from /proxy/flow-gex-history"); return; }
        if (!json.strikes.includes(strike)) {
          setError(`No tape recorded for strike ${strike} today.`);
          return;
        }
        setData(json);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.name === "AbortError" ? "Request timed out after 15s — the flow-history query may be slow right now." : (e instanceof Error ? e.message : "Fetch failed"));
      })
      .finally(() => clearTimeout(timeout));
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [expiration, strike, retryTick]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "rgba(255,255,255,.70)", fontFamily: "Inter, system-ui, sans-serif" },
      grid: { vertLines: { color: "rgba(255,255,255,.06)" }, horzLines: { color: "rgba(255,255,255,.06)" } },
      rightPriceScale: { visible: true, borderColor: "rgba(255,255,255,.10)" },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: "rgba(255,255,255,.10)", timeVisible: true, secondsVisible: false,
        tickMarkFormatter: (t: unknown) => (typeof t !== "number" ? "" : new Date(t * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false })),
      },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        priceFormatter: (price: number) => fmtFlowMoney(price),
        timeFormatter: (time: unknown) => (typeof time !== "number" ? "" : new Date(time * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false })),
      },
    });
    chartRef.current = chart;
    seriesRef.current = chart.addSeries(LineSeries, { color: HT.cyan, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });

    const ro = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth, height: container.clientHeight }));
    ro.observe(container);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !data) return;
    const points = (data.seriesByStrike[String(strike)] ?? [])
      .filter((p) => p.flowGex != null)
      .map((p): LineData => ({ time: p.ts as UTCTimestamp, value: p.flowGex as number }));
    series.setData(points);
    chartRef.current?.timeScale().fitContent();
  }, [data, strike]);

  const latest = data ? [...(data.seriesByStrike[String(strike)] ?? [])].reverse().find((p) => p.flowGex != null) ?? null : null;

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 520, maxWidth: "92vw", background: HT.panelBgStrong, border: `1px solid ${HT.border}`, borderRadius: 14, padding: 16 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: HT.text }}>
            SPX {strike} · {expiration} · Flow GEX
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: HT.text, opacity: 0.7, fontSize: 14 }}>✕</button>
        </div>
        <div style={{ fontSize: 14, color: HT.muted, marginBottom: 10 }}>
          {data ? `spot ${data.spot ? data.spot.toFixed(2) : "--"}` : error ? "" : "Loading…"}
          {latest != null && (
            <span style={{ marginLeft: 10, fontFamily: "var(--font-mono)", fontWeight: 800, color: (latest.flowGex ?? 0) >= 0 ? HT.green : HT.red }}>
              {fmtFlowMoney(latest.flowGex ?? 0)}
            </span>
          )}
        </div>
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 14, color: HT.red }}>{error}</div>
            <button
              onClick={() => setRetryTick((t) => t + 1)}
              style={{ fontSize: 14, color: HT.cyan, background: "none", border: `1px solid ${rgba(HT.cyan, 0.4)}`, borderRadius: 6, padding: "3px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              Retry
            </button>
          </div>
        )}
        <div ref={chartContainerRef} style={{ width: "100%", height: 260, position: "relative", display: data ? "block" : "none" }} />
        <div style={{ fontSize: 12, color: HT.muted, opacity: 0.6, marginTop: 8 }}>
          Combined call+put flow GEX for this strike (approximation: latest known gamma, not gamma-at-that-instant).
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Hover card ──────────────────────────────────────────────────────────────
// Floating card (same look as the GEX-chart StrikeDetailPopup) shown while the
// pointer is over a chain cell: per-side volume, OI, and net premium for that
// strike + expiration.
function fmtHoverUsd(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}
function fmtHoverInt(n: number): string {
  return Math.round(n || 0).toLocaleString();
}
function StrikeHoverCard({ ticker, strike, expiration, cell, dod, x, y, onClose }: {
  ticker: string; strike: number; expiration: string; cell: GreekCell;
  dod: { netYest: number; netNow: number | null; delta: number } | null;
  x: number; y: number; onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Close on outside-click or Esc (click-to-open card).
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!cardRef.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Defer so the opening click doesn't immediately close it.
    const id = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.min(Math.max(8, x + 16), vw - 262);
  const top = Math.min(Math.max(8, y + 16), vh - 240);
  const netPrem = cell.callPrem - cell.putPrem;
  const sgn = (v: number) => (v >= 0 ? "+" : "") + fmtHoverUsd(v);

  const SideBlock = ({ label, color, vol, oi, prem }: { label: string; color: string; vol: number; oi: number; prem: number }) => (
    <div style={{ background: rgba(color, 0.06), border: `1px solid ${rgba(color, 0.28)}`, borderRadius: 8, padding: "7px 9px" }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", color, marginBottom: 5 }}>{label}</div>
      <Row k="Volume" v={fmtHoverInt(vol)} />
      <Row k="OI" v={fmtHoverInt(oi)} />
      <Row k="Net Prem" v={fmtHoverUsd(prem)} strong />
    </div>
  );

  return createPortal(
    <div ref={cardRef} style={{
      position: "fixed", left, top, zIndex: 1000, width: 246,
      background: "rgba(13,17,25,0.98)", border: "1px solid rgba(33,158,188,0.30)", borderRadius: 12,
      padding: 13, boxShadow: "0 12px 40px rgba(0,0,0,0.6)", backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)", fontFamily: "var(--font-mono)", color: "#fff",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 15, fontWeight: 800 }}>{ticker} {strike.toLocaleString()}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: HT.muted }}>{fmtExpHeader(expiration)}</span>
        <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: HT.muted, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 2 }}>✕</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <SideBlock label="CALLS" color="#29b6f6" vol={cell.callVol} oi={cell.callOI} prem={cell.callPrem} />
        <SideBlock label="PUTS" color="#ff4757" vol={cell.putVol} oi={cell.putOI} prem={cell.putPrem} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 9, paddingTop: 7, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 12 }}>
        <span style={{ color: HT.muted }}>Net Prem (C−P)</span>
        <span style={{ fontWeight: 800, color: netPrem >= 0 ? "#29b6f6" : "#ff4757" }}>{fmtHoverUsd(netPrem)}</span>
      </div>
      {/* Day-over-Day net-GEX change (from the scanner's DoD Movers source). */}
      <div style={{ marginTop: 8, paddingTop: 7, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        {dod ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: HT.muted }}>Δ GEX vs Yest</span>
              <span style={{ fontWeight: 800, color: dod.delta >= 0 ? "#29b6f6" : "#ff4757" }}>{sgn(dod.delta)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 3 }}>
              <span style={{ color: HT.muted }}>Yest → Now</span>
              <span style={{ color: "#cfe", fontWeight: 600 }}>
                {sgn(dod.netYest)} → {dod.netNow == null ? "—" : sgn(dod.netNow)}
              </span>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
            <span style={{ color: HT.muted }}>Δ GEX vs Yest</span>
            <span style={{ color: HT.muted, opacity: 0.7 }}>— (top-mover strike only)</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, lineHeight: 1.6 }}>
      <span style={{ color: "#8B94A7" }}>{k}</span>
      <span style={{ color: strong ? "#fff" : "#cfe", fontWeight: strong ? 800 : 600 }}>{v}</span>
    </div>
  );
}

/**
 * Which side of the book the contract-count tabs (OI, VOL) show at a given
 * strike. Shared deliberately: both tabs ladder identically, so switching
 * between them compares the same cells instead of re-reading the grid.
 *
 * Above the ATM strike only calls are OTM; below it only puts are. Showing both
 * everywhere meant half of every cell was the deep-ITM mirror of a strike on the
 * other side of the ladder — high OI, no information, and it doubled the row
 * height for nothing. The ATM row itself is the pivot and shows both.
 *
 * This rule drives the CELL RENDERING and the VALUE the heat scale / column
 * totals / ⅀ Total read (see oiSideChange). Those have to agree — coloring a
 * cell by a number the cell doesn't display is how a heatmap starts lying.
 */
function oiSides(strike: number, atm: number): { call: boolean; put: boolean } {
  if (strike > atm) return { call: true, put: false };
  if (strike < atm) return { call: false, put: true };
  return { call: true, put: true };
}

/**
 * The signed day-over-day OI CHANGE for heat/totals under the
 * calls-above/puts-below rule: call ΔOI above ATM (adds positive → blue), put
 * ΔOI below ATM (adds negative → red), and the true net Δ at the ATM pivot.
 *
 * The OI tab prints the change and nothing else, so the heat scale, the
 * per-column totals and the ⅀ Total column are all computed from this same
 * number — the color a cell wears and the figure it shows can never disagree.
 */
function oiSideChange(
  snap: { callChg: number; putChg: number },
  strike: number,
  atm: number,
): number {
  const { call, put } = oiSides(strike, atm);
  if (call && put) return snap.callChg - snap.putChg;
  return call ? snap.callChg : -snap.putChg;
}

/**
 * The signed traded VOLUME for heat/totals under the same calls-above/
 * puts-below rule the OI tab uses: call volume above ATM (positive → blue), put
 * volume below ATM (negative → red), and call − put at the ATM pivot.
 *
 * Volume itself is never negative — the sign here is purely the side, so the
 * heat scale can say "calls" and "puts" in the same blue/red language every
 * other tab speaks. The CELL prints the unsigned count (see VolLine); this is
 * only what colors it and what the totals add up.
 */
function volSideValue(
  cell: { callVol: number; putVol: number },
  strike: number,
  atm: number,
): number {
  const { call, put } = oiSides(strike, atm);
  if (call && put) return cell.callVol - cell.putVol;
  return call ? cell.callVol : -cell.putVol;
}

// One line of a VOL cell: today's traded contract count for one side, unsigned.
// Volume is a LEVEL, not a change, so the leading +/− that ΔOI carries would be
// noise here — every figure would wear a "+". Side is already carried by
// position (calls above ATM, puts below), by the C/P letter on the pivot row,
// and by the blue/red tint underneath.
//
// Same near-white-on-heat treatment as OiChgLine, for the same reason: the
// number rides on a saturated tile and has to stay readable on both colors.
// A strike that hasn't traded today prints "·" rather than "0" — flat and
// untraded look identical at 10px, and the dot is the quieter of the two.
function VolLine({ label, vol }: { label: string | null; vol: number | null }) {
  const has = vol != null && vol !== 0;
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 6, whiteSpace: "nowrap" }}>
      {label && (
        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 9, fontWeight: 700, marginRight: "auto" }}>
          {label}
        </span>
      )}
      <span style={{
        color: has ? "rgba(255,255,255,0.96)" : "#3a4a5e",
        fontWeight: 700,
        textShadow: has ? "0 1px 2px rgba(0,0,0,0.85)" : undefined,
      }}>
        {has ? fmtCount(Math.abs(vol!)) : "·"}
      </span>
    </div>
  );
}

// One line of an OI cell: the day-over-day change in open interest, and nothing
// else. The settled OI level is deliberately NOT printed — the tab exists to
// show what moved overnight, and the level sat right next to the delta drowning
// it in digits.
//
// Near-white text on purpose. The change rides on top of a blue/red heat cell,
// and a red number on a red background was the one thing you could not read.
// Direction is carried twice over without needing text color: the leading +/−
// on the figure itself, and the cell tint underneath it.
//
// `chg === null` means this strike has no stored baseline — rendered as a dash
// so "we don't know" never reads as "unchanged".
function OiChgLine({ label, chg }: { label: string | null; chg: number | null }) {
  const has = chg != null && chg !== 0;
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 6, whiteSpace: "nowrap" }}>
      {label && (
        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 9, fontWeight: 700, marginRight: "auto" }}>
          {label}
        </span>
      )}
      <span style={{
        color: has ? "rgba(255,255,255,0.96)" : "#3a4a5e",
        fontWeight: 700,
        textShadow: has ? "0 1px 2px rgba(0,0,0,0.85)" : undefined,
      }}>
        {chg == null ? "—" : fmtChg(chg)}
      </span>
    </div>
  );
}

// ── Memoized chain matrix ───────────────────────────────────────────────────
interface ChainMatrixProps {
  columns: ExpColumn[];
  gridCols: number;
  visibleStrikes: (number | null)[];
  nearestStrike: number;
  spot: number;
  greekMode: GreekMode;
  dataMode: DataMode;
  intensity: number; // parent passes the DEFERRED intensity
  /** Which HEAT_SKINS entry paints the cells. Cosmetic only — same values,
   *  same ranks, same walls either way. See lib/calculations/heatSkins. */
  heatSkin: HeatSkin;
  colScales: { max: number; top3: number[] }[];
  volMvcByCol: (number | null)[];
  mvcByCol: (number | null)[];
  /**
   * Front-expiry (0DTE / nearest) 15-minute NET GEX change, strike → chip.
   * Same source and gating as the multi-chain ladder's Δ stamps: recorder
   * baselines, top-5 |GEX| strikes per side of ATM only.
   */
  delta15: Map<number, { d: number; pct: number; rank: number }>;
  /** Expiration the Δ15 stickers belong to ("" when there are none). */
  delta15Exp: string;
  valueAt: (col: ExpColumn, strike: number) => number | null;
  isStandalone: boolean;
  changeMode: ChangeMode;
  /**
   * The session the grid is showing: "" when live (0DTE = today), or the
   * replayed session's date. Only used to decide which column counts as 0DTE
   * and is therefore excluded from the ⅀ Total column.
   */
  sessionDate: string;
  /**
   * Render the trailing ⅀ Total column. False only when the grid is showing a
   * single 0DTE column (replay, "0dte" scope) — Total sums the NON-0DTE
   * expiries, so with nothing but 0DTE on screen it has nothing to add up and
   * would print a column of "·" that reads as missing data. See REPLAY_SCOPES.
   */
  showTotalCol: boolean;
  /**
   * How many expiry tracks the grid should SIZE for, independent of how many it
   * renders. Replay passes the session's full expiry count so collapsing to a
   * single 0DTE column leaves the cells at their normal width instead of
   * stretching one column across the page. 0 = off (live chain).
   */
  layoutExpCols: number;
  changeMeta: { expiries: Set<string>; hasData: boolean };
  changeMap: Map<string, number>;
  changeScaleByExp: Map<string, { max: number; top3: number[] }>;
  emStrikes: { close: number | null; d1: number | null; u1: number | null; d2: number | null; u2: number | null } | null;
  anyCurrentWeek: boolean;
  emLevels: { close: number; em: number } | null;
  activeTicker: string;
  atmRowRef: React.RefObject<HTMLDivElement | null>;
  /**
   * OI tab only: `exp|strike` → the stored settled call/put OI plus the
   * day-over-day change. Empty (and ignored) in every other greek mode.
   * This map is now the OI tab's ONLY source: the cell prints the change from
   * it, and valueAt() colors the cell from the same entry. A strike the
   * recorder never captured has no change to report, so it renders empty
   * rather than falling back to a live OI level with no delta beside it.
   */
  oiChangeMap: Map<string, { callOI: number; putOI: number; callChg: number; putChg: number }>;
  /**
   * Focus selection. Click an expiry header or a strike to toggle it in; every
   * unselected column/row fades to a ghost and the ⅀ Total column re-sums over
   * ONLY the selected expiries (0DTE included — an explicit pick outranks the
   * column's usual ex-0DTE rule). Both empty = the normal, unfiltered chain.
   */
  selExps: Set<string>;
  selStrikes: Set<number>;
  onToggleExp: (exp: string, solo: boolean) => void;
  onToggleStrike: (strike: number, solo: boolean) => void;
  onCellClick: (v: { strike: number; expiration: string }) => void;
  onCellHover: (v: { strike: number; colIdx: number; x: number; y: number } | null) => void;
}

// Split out + memoized so transient parent state (the load-progress bar, the
// last-update clock, Intensity-slider commits) never re-renders the ~560-cell
// matrix. It re-renders only when its own data props change — which, thanks to
// the parent's useMemo/useCallback, is exactly "when the chain data changed."
const ChainMatrix = memo(function ChainMatrix({
  columns, gridCols, visibleStrikes, nearestStrike, spot, greekMode, dataMode,
  intensity, heatSkin, colScales, volMvcByCol, mvcByCol, delta15, delta15Exp, valueAt, isStandalone,
  changeMode, sessionDate, showTotalCol, layoutExpCols, changeMeta, changeMap, changeScaleByExp, emStrikes, anyCurrentWeek,
  emLevels, activeTicker, atmRowRef, oiChangeMap,
  selExps, selStrikes, onToggleExp, onToggleStrike, onCellClick, onCellHover,
}: ChainMatrixProps) {
  // OI is a contract count, not dollars — and on this tab every readout is a
  // CHANGE in that count, so it takes the signed compact formatter (+1.2K /
  // -430 / "·" for flat) rather than the dollar one.
  const isOiMode = greekMode === "oi";
  // VOL is the other contract-count tab: same two-line ladder, same widths, but
  // a live level rather than a recorded change — so it takes the UNSIGNED
  // compact formatter (12.4K), not ΔOI's signed one.
  const isVolMode = greekMode === "vol";
  // Everything that is about "this tab counts contracts, not dollars" — cell
  // padding, column widths, the white-on-heat totals, and the Δ-column lockout
  // — is true of both tabs, so it keys off this rather than isOiMode alone.
  const isCountMode = isOiMode || isVolMode;
  const fmtVal = isOiMode ? fmtChg : isVolMode ? fmtCount : fmtMoney;
  // The skin: ramp / rank floors / level fill from the shared table, cell
  // geometry from this grid's own CHAIN_CELL entry.
  const SK = HEAT_SKINS[heatSkin] ?? HEAT_SKINS.classic;
  const CELL = CHAIN_CELL[heatSkin] ?? CHAIN_CELL.classic;
  // Δ15 stickers ride the GEX view only — OI mode's cells are already a change,
  // and a second, differently-sourced change beside them reads as a conflict.
  const hasDelta15 = !isCountMode && greekMode === "gex" && !!delta15Exp && delta15.size > 0;
  // Drop holiday/non-trading expirations (e.g. observed Jul 3) entirely.
  const renderIdx = Array.from({ length: gridCols })
    .map((_, i) => i)
    .filter((i) => {
      const c = columns[i];
      if (!c) return true; // keep empty placeholder slots
      return isTradingDay(new Date(c.expiration + "T00:00:00"));
    });
  // Shared strike axis: ONE strike column on the left, then one
  // value-only column per expiration. Row N = same strike everywhere.
  const STRIKE_COL = 56;
  // Sticky header/strike column must be fully opaque — rows scroll under it.
  const HDR_BG = "#0D1119";
  // Every strike row is at least this tall, floored on the sticky strike cell
  // (the one cell EVERY row has, data row or padding row).
  //
  // Grid rows size to their content, so without a floor a row's height is a
  // function of what happens to be IN it — and in replay that changes under
  // playback. A strike the current sweep didn't record renders blank, then the
  // next sweep records it and the same row prints "+$0"; the row grows by a
  // line, everything below it shifts down, and the white ATM rule a few rows
  // away visibly jumps. Same story for the padding rows, which rendered as 4px
  // slivers and so never actually held the centre they exist to hold. Pinning
  // the floor makes a row's height independent of its contents: values can
  // appear and disappear all session and nothing moves. Count-mode cells that
  // legitimately need two lines still grow past it — this is a floor, not a
  // fixed height.
  const ROW_MIN_H = 17;
  // ⅀ Total column — per-strike sum across every rendered expiration EXCEPT
  // 0DTE (front expiry excluded on purpose; label stays plain "Total"), with
  // its own heat scale (over the visible strikes) so the biggest net totals pop.
  // "0DTE" means the expiry that equals the SESSION being shown, not literally
  // today — replaying Tuesday must exclude Tuesday's 0DTE, not Friday's.
  const todayKey = sessionDate || etDateKey(etToday());
  // With expiries picked, the ⅀ column sums exactly those (0DTE included — an
  // explicit pick outranks the default exclusion) and says so in its header.
  const selMode = selExps.size > 0;
  const rowTotals = new Map<number, number>();
  visibleStrikes.forEach((strike) => {
    if (strike == null) return;
    let sum = 0;
    renderIdx.forEach((colIdx) => {
      const col = columns[colIdx];
      if (!col) return;
      if (selMode ? !selExps.has(col.expiration) : col.expiration === todayKey) return;
      // !isCountMode mirrors the per-cell guard below — the Δ columns carry
      // volume-GEX dollars, which must never be summed into a contract-count
      // total (OI or VOL).
      const isCh = !isCountMode && !isStandalone && changeMode !== "live" && changeMeta.hasData && changeMeta.expiries.has(col.expiration);
      const v = isCh ? (changeMap.get(`${col.expiration}|${strike}`) ?? null) : valueAt(col, strike);
      if (v != null) sum += v;
    });
    rowTotals.set(strike, sum);
  });
  const totalAbs = [...rowTotals.values()].map((v) => Math.abs(v)).filter((v) => v > 0).sort((a, b) => b - a);
  const totalScale = { max: totalAbs[0] ?? 1, top3: totalAbs.slice(0, 3) };
  const grandVisibleTotal = [...rowTotals.values()].reduce((a, b) => a + b, 0);

  // ── Levels-only mode ───────────────────────────────────────────────────────
  // Intensity at its bottom stop (0.5) drops the heat field entirely and paints
  // ONLY each column's CB / CW / PW. Walls are read through valueAt(), so they
  // follow the active greek tab exactly like the heat scale does — on the GEX
  // tab CB is the same strike the ★ MVC marker already names.
  //
  // The ⅀ Total column is ranked as its own column (it is a real per-strike
  // series, not a repeat of any expiry). Δ / change columns are left bare:
  // "the wall" is a statement about gamma, not about a 15-minute delta.
  const levelsOnly = atMinIntensity(intensity, INTENSITY_MIN.chain);
  const liveStrikes = visibleStrikes.filter((s): s is number => s != null);
  const wallsByCol = levelsOnly
    ? columns.map((col) => columnWalls(liveStrikes.map((s) => ({ strike: s, net: valueAt(col, s) ?? 0 }))))
    : [];
  const totalWalls = levelsOnly
    ? columnWalls(liveStrikes.map((s) => ({ strike: s, net: rowTotals.get(s) ?? 0 })))
    : null;

  // ── Reserved (ghost) tracks ───────────────────────────────────────────────
  // Expiry tracks are `1fr`, so they divide the container: drop from 4 columns
  // to 1 and that one column inflates to the full grid width, which is not a
  // filtered view of the same chain — it's a different-looking page. Reserving
  // the tracks the hidden columns WOULD have occupied keeps every remaining
  // cell exactly the width it had, and the freed space simply sits empty on the
  // right. `layoutExpCols` is the count to size for (replay passes the session's
  // full expiry count); 0 disables the whole mechanism, which is what the live
  // chain passes so its layout is untouched.
  //
  // The tracks need real (empty) elements, one per row: the grid auto-places,
  // and rows are `display: contents` wrappers, so a row short of a cell would
  // pull the next row's first cell up into the gap and shear the whole grid.
  const ghostExpCols = Math.max(0, (layoutExpCols || 0) - renderIdx.length);
  // The ⅀ Total track is reserved the same way when it's hidden — otherwise the
  // expiry columns still grow by its share on the way into 0DTE scope.
  const ghostTotalCols = layoutExpCols > 0 && !showTotalCol ? 1 : 0;
  const ghostCols = ghostExpCols + ghostTotalCols;
  const ghostTemplate =
    (ghostExpCols > 0 ? ` repeat(${ghostExpCols}, minmax(${isCountMode ? 84 : 78}px, 1fr))` : "") +
    (ghostTotalCols > 0 ? ` minmax(${isCountMode ? 92 : 88}px, 1.15fr)` : "");
  /** Empty filler cells for the reserved tracks. `header` keeps them opaque so
   *  rows scroll UNDER the header band rather than through the gap beside it. */
  const ghostCells = (keyPrefix: string, header = false) =>
    ghostCols === 0 ? null : Array.from({ length: ghostCols }).map((_, g) => (
      <div
        key={`${keyPrefix}-ghost-${g}`}
        aria-hidden
        style={header
          ? { position: "sticky", top: 0, zIndex: 3, background: HDR_BG, borderBottom: `1px solid ${HT.border}` }
          : undefined}
      />
    ));

  return (
    <div style={{
      display: "grid",
      // OI cells can carry two lines (call / put) on the ATM pivot row, but each
      // line is now a single delta figure — so they need barely more width than
      // a greek cell, not the double-width the old value+delta pair demanded.
      // The Δ15 column carries a chip AND its value on one line — at 78px that
      // is "−$1,694M" overlapping the number. Only that one column widens (and
      // only while stickers are actually on screen); every other track, and the
      // whole layout with the mode dark, is unchanged.
      gridTemplateColumns: `${STRIKE_COL}px ${renderIdx
        .map((i) => (hasDelta15 && columns[i]?.expiration === delta15Exp
          ? "minmax(152px, 1.9fr)"
          : `minmax(${isCountMode ? 84 : 78}px, 1fr)`))
        // …and one more STRIKE_COL track on the far right: the same strike
        // ladder mirrored, sticky to the right edge, so a cell in the last
        // expiry column is one glance from its strike instead of a scroll back
        // to the left rail. See the "mirrored strike rail" comments below.
        .join(" ")}${showTotalCol ? ` minmax(${isCountMode ? 92 : 88}px, 1.15fr)` : ""}${ghostTemplate} ${STRIKE_COL}px`,
      borderRadius: 12,
      overflow: "clip",
      border: `1px solid ${HT.border}`,
      borderTop: `2px solid ${rgba(HT.cyan, 0.85)}`,
      background: HT.panelBg,
      // Replaces the scroll container's old padding-top — see the comment at
      // chainScrollRef. Scrolls away under the sticky header rather than
      // holding open a gap rows can show through.
      marginTop: 8,
    }}>
      {/* ── Header row: empty strike corner + one expiry header per column ── */}
      <div style={{ position: "sticky", left: 0, top: 0, zIndex: 6, padding: "7px 5px", background: HDR_BG, borderBottom: `1px solid ${HT.border}`, borderRight: `1px solid ${HT.border}`, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", color: HT.muted, display: "flex", alignItems: "flex-end" }}>
        Strike
      </div>
      {renderIdx.map((i) => {
        const col = columns[i];
        const isChangeCol = !isCountMode && !isStandalone && changeMode !== "live" && changeMeta.hasData && col != null &&
          changeMeta.expiries.has(col.expiration);
        const colTotal = col
          ? (isChangeCol
              ? visibleStrikes.reduce((s, k) => s + (k == null ? 0 : (changeMap.get(`${col.expiration}|${k}`) ?? 0)), 0)
              : visibleStrikes.reduce((s, k) => { const v = k == null ? null : valueAt(col, k); return s + (v ?? 0); }, 0))
          : null;
        const expSel = col != null && selExps.has(col.expiration);
        const expDim = selMode && !expSel;
        return (
          <div
            key={`hdr-${col?.expiration ?? i}`}
            onClick={col ? (e) => onToggleExp(col.expiration, e.shiftKey) : undefined}
            title={col ? "Click to focus this expiration (shift-click = only this one)" : undefined}
            style={{
              position: "sticky", top: 0, zIndex: 3, textAlign: "center", padding: "5px 6px",
              background: expSel
                ? `linear-gradient(180deg, ${rgba(HT.cyan, 0.30)} 0%, ${rgba(HT.cyan, 0.07)} 100%), ${HDR_BG}`
                : isChangeCol
                  ? `linear-gradient(180deg, ${rgba(HT.orange, 0.18)} 0%, ${rgba(HT.orange, 0.05)} 100%), ${HDR_BG}`
                  : `linear-gradient(180deg, ${rgba(HT.cyan, 0.14)} 0%, ${rgba(HT.cyan, 0.04)} 100%), ${HDR_BG}`,
              borderBottom: `1px solid ${HT.border}`,
              boxShadow: expSel ? `inset 0 -2px 0 ${HT.cyan}` : undefined,
              cursor: col ? "pointer" : undefined,
              opacity: expDim ? 0.3 : 1,
              transition: "opacity .12s",
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 500, color: isChangeCol ? HT.orange : HT.text }}>
              {col ? fmtExpHeader(col.expiration) : "—"}{isChangeCol ? ` ·Δ${changeMode}` : ""}
              {!isChangeCol && hasDelta15 && col?.expiration === delta15Exp && (
                <span style={{ color: HT.muted, fontWeight: 700 }}> ·Δ15m</span>
              )}
            </div>
            {/* Per-expiry total of the ACTIVE greek across the visible strike
                window — the column-wise counterpart to the ⅀ Total column's
                figure, so every expiry header reads like the totals cell. */}
            <div style={{ fontSize: 10, fontWeight: 800, fontFamily: "var(--font-mono)", color: colTotal == null ? HT.muted : colTotal >= 0 ? HT.green : HT.red }}>
              {colTotal == null ? "—" : fmtVal(colTotal)}
            </div>
          </div>
        );
      })}
      {/* ── ⅀ Total column header (sum of all expirations for each strike) ── */}
      {showTotalCol && (
        <div style={{ position: "sticky", top: 0, zIndex: 3, textAlign: "center", padding: "5px 6px", background: `linear-gradient(180deg, ${rgba(HT.cyan, 0.24)} 0%, ${rgba(HT.cyan, 0.07)} 100%), ${HDR_BG}`, borderBottom: `1px solid ${HT.border}`, borderLeft: `2px solid ${rgba(HT.cyan, 0.45)}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: HT.cyan, letterSpacing: "0.04em" }}>
            {selMode ? `Sel ${selExps.size}` : "Total"}
          </div>
          <div style={{ fontSize: 10, fontWeight: 800, fontFamily: "var(--font-mono)", color: grandVisibleTotal >= 0 ? HT.green : HT.red }}>
            {fmtVal(grandVisibleTotal)}
          </div>
        </div>
      )}
      {ghostCells("hdr", true)}
      {/* ── Mirrored strike rail: header corner (sticky right) ── */}
      <div style={{ position: "sticky", right: 0, top: 0, zIndex: 6, padding: "7px 5px", background: HDR_BG, borderBottom: `1px solid ${HT.border}`, borderLeft: `1px solid ${HT.border}`, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", color: HT.muted, display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
        Strike
      </div>

      {/* ── One row per shared strike ── */}
      {visibleStrikes.map((strike, rowIdx) => {
        // Padding row (chain ran out on this side of ATM): keep the row so
        // ATM stays centered, but render it empty.
        if (strike == null) {
          return (
            <div key={`pad-${rowIdx}`} style={{ display: "contents" }}>
              <div style={{ position: "sticky", left: 0, zIndex: 2, padding: "2px 8px", fontSize: 12, minHeight: ROW_MIN_H, background: HDR_BG, borderRight: `1px solid ${HT.border}` }} />
              {renderIdx.map((i) => (
                <div key={`pad-${rowIdx}-${i}`} style={{ padding: "2px 8px", fontSize: 12 }} />
              ))}
              {showTotalCol && <div style={{ padding: "2px 8px", fontSize: 12, borderLeft: `2px solid ${rgba(HT.cyan, 0.25)}` }} />}
              {ghostCells(`pad-${rowIdx}`)}
              <div style={{ position: "sticky", right: 0, zIndex: 2, padding: "2px 8px", fontSize: 12, minHeight: ROW_MIN_H, background: HDR_BG, borderLeft: `1px solid ${HT.border}` }} />
            </div>
          );
        }
        const isATM = strike === nearestStrike;
        const is1x = anyCurrentWeek && emStrikes != null && (strike === emStrikes.d1 || strike === emStrikes.u1);
        const is2x = anyCurrentWeek && emStrikes != null && (strike === emStrikes.d2 || strike === emStrikes.u2);
        // EM rows no longer draw a marker line — the tag beside the strike is
        // the whole signal. The CLOSE (band-center) marker is gone entirely.
        // Small label + hover tooltip for the marked rows.
        let emTag: string | null = null, emTip = "";
        if (isATM) { emTag = "ATM"; emTip = `At-the-money — nearest strike to spot (${spot ? spot.toFixed(2) : "—"})`; }
        else if (is1x) {
          const up = emStrikes != null && strike === emStrikes.u1;
          emTag = up ? "EM +1σ" : "EM −1σ";
          emTip = `1× weekly expected move ${up ? "up" : "down"}${emLevels ? ` (${emLevels.close} ± ${emLevels.em})` : ""}`;
        } else if (is2x) {
          const up = emStrikes != null && strike === emStrikes.u2;
          emTag = up ? "EM +2σ" : "EM −2σ";
          emTip = `2× weekly expected move ${up ? "up" : "down"}${emLevels ? ` (${emLevels.close} ± ${2 * emLevels.em})` : ""}`;
        }
        const strikeSel = selStrikes.has(strike);
        const strikeDim = selStrikes.size > 0 && !strikeSel;
        return (
          <div key={strike} style={{ display: "contents" }}>
            {/* Shared strike label (sticky left) — also the row's focus toggle */}
            <div
              ref={isATM ? atmRowRef : undefined}
              onClick={(e) => onToggleStrike(strike, e.shiftKey)}
              title={emTip || "Click to focus this strike (shift-click = only this one)"}
              style={{
              position: "sticky", left: 0, zIndex: 2,
              padding: "2px 5px", fontSize: 10, fontFamily: "var(--font-mono)", textAlign: "right",
              minHeight: ROW_MIN_H,
              // ATM reads like the /home GEX heatmap: no amber fill, blue strike
              // text with a blue "ATM" tag beside it, inside the white rule.
              color: isATM ? HT.cyan : "#e4e4e7",
              fontWeight: isATM ? 700 : 400,
              background: strikeSel
                ? `linear-gradient(90deg, ${rgba(HT.cyan, 0.06)}, ${rgba(HT.cyan, 0.30)}), ${HDR_BG}`
                : HDR_BG,
              // The ATM rule is drawn INSET, never as a border — same reason the
              // value cells use box-shadow (see atmShadow). A real 2px top and
              // bottom border adds 4px to this cell, and since it is the tallest
              // cell in its row that made the ATM row 4px taller than every
              // other one. So every time spot crossed a strike the old ATM row
              // shrank and the new one grew, shoving the whole ladder — the
              // white rule appeared to jump rather than move one row. Inset, the
              // rule paints over the cell and the geometry never changes.
              boxShadow: [
                ...(strikeSel ? [`inset -2px 0 0 ${HT.cyan}`] : []),
                // Top and bottom only — the box's left edge stays where it was,
                // on the first value cell (see atmShadow's isFirst branch).
                ...(isATM ? ["inset 0 2px 0 #ffffff", "inset 0 -2px 0 #ffffff"] : []),
              ].join(", ") || undefined,
              borderRight: `1px solid ${HT.border}`,
              display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3,
              cursor: "pointer",
              opacity: strikeDim ? 0.28 : 1,
              transition: "opacity .12s",
              whiteSpace: "nowrap", overflow: "hidden",
            }}>
              {emTag && (
                <span style={{
                  fontSize: 8, fontWeight: isATM ? 900 : 800, letterSpacing: isATM ? "0.06em" : "0.02em",
                  padding: isATM ? 0 : "1px 3px", borderRadius: 3, marginRight: "auto",
                  fontFamily: isATM ? "sans-serif" : undefined,
                  background: isATM ? "transparent" : "rgba(255,255,255,0.12)",
                  color: isATM ? HT.cyan : "#ffffff",
                }}>{emTag}</span>
              )}
              {Number.isInteger(strike) ? strike.toFixed(0) : strike.toFixed(2)}
            </div>
            {/* One value cell per expiration */}
            {renderIdx.map((colIdx, posInRow) => {
              const col = columns[colIdx];
              const scale = colScales[colIdx] ?? { max: 1, top3: [] as number[] };
              // The 15/30/60m Δ columns carry volume-GEX deltas — dollars. On
              // the two contract-count tabs that is a different quantity in a
              // different unit sitting inside the same grid: on OI it fights the
              // cell's own day-over-day ΔOI, and on VOL it simply isn't what the
              // tab shows. Both count tabs always read live columns.
              const isChangeCol =
                !isCountMode && !isStandalone && changeMode !== "live" && changeMeta.hasData && col != null &&
                changeMeta.expiries.has(col.expiration);
              const chKey = isChangeCol ? `${col!.expiration}|${strike}` : "";
              const value = isChangeCol
                ? (changeMap.has(chKey) ? changeMap.get(chKey)! : null)
                : (col ? valueAt(col, strike) : null);
              const cellScale = isChangeCol
                ? (changeScaleByExp.get(col!.expiration) ?? { max: 1, top3: [] as number[] })
                : scale;
              const isMvc = !isChangeCol && greekMode === "gex" && col != null && mvcByCol[colIdx] === strike;
              // ✕ marks the pure-volume GEX peak — OI+Vol view + GEX mode only.
              const isVolMvc = !isChangeCol && greekMode === "gex" && dataMode === "oi-vol" && col != null && volMvcByCol[colIdx] === strike;
              // …and it is coloured by the SIGN of that volume-only GEX: green
              // when the volume peak is positive gamma, red when it's negative.
              // A fixed-red ❌ said "negative" on every strike it landed on.
              const volMvcVal = isVolMvc ? (col!.cells.get(strike)?.volGex ?? null) : null;
              const volMvcPos = (volMvcVal ?? value ?? 0) >= 0;
              // Δ15 sticker: front (0DTE / nearest) expiry only.
              const isDelta15Col = hasDelta15 && !isChangeCol && col != null && col.expiration === delta15Exp;
              const dEntry = isDelta15Col ? (delta15.get(strike) ?? null) : null;
              const isFirst = posInRow === 0;
              // ATM box: use box-shadow so it overlays without shifting layout.
              // Top+bottom on every cell; left edge on first col. The right edge
              // is drawn on the ⅀ Total cell (now the rightmost column).
              const atmShadow = isATM
                ? [
                    "inset 0 2px 0 #ffffff",
                    "inset 0 -2px 0 #ffffff",
                    ...(isFirst ? ["inset 2px 0 0 #ffffff"] : []),
                  ].join(", ")
                : undefined;
              // Click any populated cell to open its stats card.
              const isClickable = col != null;
              // OI tab: the recorded snapshot is the only source. Strikes the
              // 9:32 sweep didn't capture (a root outside the watchlist, an
              // expiry past the recorded depth, or a strike listed intraday)
              // have no day-over-day change to report and render empty — a live
              // OI level with no delta beside it is not what this tab shows.
              const oiKey = col ? `${col.expiration}|${strike}` : "";
              const oiSnap = isOiMode && oiKey ? oiChangeMap.get(oiKey) : undefined;
              // Calls above ATM, puts below, both at the pivot. Shared by both
              // count tabs so OI and VOL ladder identically — flipping between
              // them compares the same cells rather than re-reading the grid.
              const sides = isCountMode ? oiSides(strike, nearestStrike) : { call: false, put: false };
              // VOL tab: no recorder, no snapshot — today's traded counts come
              // straight off the live chain cell, so every strike the chain
              // carries has a number (or an honest "·" for untraded).
              const volCell = isVolMode && col ? col.cells.get(strike) : undefined;
              const volHasAny = isVolMode && !!volCell && (
                (sides.call && !!volCell.callVol) || (sides.put && !!volCell.putVol)
              );
              // Only the side(s) actually rendered count toward "is there
              // anything here" — an ITM put below a call-only strike must not
              // keep an otherwise-flat call cell from reading as "·". A strike
              // that went to zero on both sides overnight still lands here with
              // a large negative change (the recorder's prev-only FULL JOIN
              // row), which is exactly the cell you least want hidden.
              const oiHasAny = isOiMode && !!oiSnap && (
                (sides.call && !!oiSnap.callChg) || (sides.put && !!oiSnap.putChg)
              );
              // Side letters only where position can't tell you the side — the
              // ATM pivot, the one row that renders both call and put.
              const oiBothSides = sides.call && sides.put;
              // Which level (if any) this cell is, in levels-only mode.
              const cellWall = levelsOnly && !isChangeCol && col != null
                ? wallAt(wallsByCol[colIdx], strike)
                : null;
              // 1/2/3 standing in this column, for the skin's rank floors and
              // its per-rank font weight (0 = unranked).
              const cellRank = value == null ? 0 : rankOf(value, cellScale.top3);
              return (
                <div
                  key={`${strike}-${colIdx}`}
                  className={isMvc ? "mvc-peak-cell" : undefined}
                  onClick={isClickable ? (e) => onCellHover({ strike, colIdx, x: e.clientX, y: e.clientY }) : undefined}
                  title={isClickable ? "Click for volume / OI / net premium" : undefined}
                  style={{
                    padding: isCountMode ? "3px 6px" : "2px 8px", fontSize: CELL.fontSize, fontFamily: "var(--font-mono)", textAlign: "right",
                    fontWeight: value == null ? 400 : CELL.weight[cellRank === 1 ? 0 : cellRank ? 1 : 2],
                    color: value == null ? "#3a4a5e" : CELL.text,
                    ...(CELL.shadow && value != null ? { textShadow: CELL.shadow } : {}),
                    borderRadius: CELL.radius || undefined,
                    // A 0.5px margin makes each cell its own tile. NOT on the
                    // ATM row: that rule is an inset box-shadow on every cell in
                    // the row, and a margin would break it into dashes.
                    ...(CELL.inset && !isATM ? { margin: CELL.inset } : {}),
                    // Levels-only: no gamma wash. CB/CW/PW paint at the heat
                    // scale's rank floors (CB 1, CW 2, PW 3) so the fill still
                    // carries the sign; every other cell — and every change
                    // column — is bare. Then, only on a skin that asks for it,
                    // the level's own colour is laid OVER that heat.
                    background: (() => {
                      const heat = levelsOnly
                        ? (cellWall && value != null ? skinRankBg(value, WALL_RANK[cellWall], SK) : "transparent")
                        : (value != null ? skinMetricBg(value, cellScale.max, cellRank, intensity, SK) : "transparent");
                      if (!cellWall) return heat;
                      return levelFillBg(cellWall, SK, heat) ?? heat;
                    })(),
                    boxShadow: atmShadow,
                    whiteSpace: "nowrap", overflow: "hidden",
                    display: "flex", alignItems: isCountMode ? "center" : "baseline", justifyContent: "flex-end", gap: 5,
                    cursor: isClickable ? "pointer" : undefined,
                    // Focus dimming: a cell stays lit only if BOTH its column
                    // and its row survive the selection.
                    opacity: (strikeDim || (selMode && !(col != null && selExps.has(col.expiration)))) ? 0.13 : 1,
                    transition: "opacity .12s",
                    ...(isMvc ? { outline: "2px solid #ffb300", outlineOffset: "-2px" } : {}),
                  }}
                >
                  {/* OI tab renders the day-over-day CHANGE only — one line
                      per side actually shown at this strike (two only on the
                      ATM pivot). Everything else about the cell — heat
                      background, ATM box, EM row border — is unchanged, and the
                      background now tracks that same change through valueAt(),
                      so the tint and the number always agree. */}
                  {isMvc && (
                    <span
                      title="CB - Core Bullseye — highest |net GEX|"
                      style={{ color: "#ffd600", lineHeight: 1, ...MARKER_EDGE }}
                    >★</span>
                  )}
                  {isVolMvc && (
                    <span
                      title={`Highest volume GEX${volMvcVal == null ? "" : ` (${fmtMoney(volMvcVal)})`} — ${volMvcPos ? "positive" : "negative"} gamma`}
                      style={{
                        fontSize: 11, lineHeight: 1, fontWeight: 900,
                        color: volMvcPos ? "#22c55e" : "#ef4444",
                        ...MARKER_EDGE,
                      }}
                    >✕</span>
                  )}
                  {dEntry && <DeltaStamp d={dEntry.d} pct={dEntry.pct} rank={dEntry.rank} />}
                  {isOiMode ? (
                    !oiHasAny ? (
                      <span style={{ color: "#3a4a5e" }}>·</span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", width: "100%", lineHeight: 1.3, fontSize: 10 }}>
                        {sides.call && <OiChgLine label={oiBothSides ? "C" : null} chg={oiSnap?.callChg ?? null} />}
                        {sides.put && <OiChgLine label={oiBothSides ? "P" : null} chg={oiSnap?.putChg ?? null} />}
                      </div>
                    )
                  ) : isVolMode ? (
                    /* VOL tab: today's traded contract count, one line per side
                       actually shown at this strike (two only on the ATM pivot).
                       Structurally identical to the OI cell above so the two
                       tabs are directly comparable — only the number differs. */
                    !volHasAny ? (
                      <span style={{ color: "#3a4a5e" }}>·</span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", width: "100%", lineHeight: 1.3, fontSize: 10 }}>
                        {sides.call && <VolLine label={oiBothSides ? "C" : null} vol={volCell?.callVol ?? null} />}
                        {sides.put && <VolLine label={oiBothSides ? "P" : null} vol={volCell?.putVol ?? null} />}
                      </div>
                    )
                  ) : (
                    // With a sticker in the cell the value is pushed right by
                    // margin, not by a reserved slot — so unstamped rows in the
                    // same column give all their width to the number and every
                    // value still ends on the same right edge.
                    <span style={dEntry ? { marginLeft: "auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : undefined}>
                      {CELL.signColors
                        ? <SignVal text={value == null ? "·" : fmtMoney(value)} />
                        : (value == null ? "·" : fmtMoney(value))}
                    </span>
                  )}
                </div>
              );
            })}
            {/* ── ⅀ Total cell: this strike's sum across every expiration ── */}
            {showTotalCol && (() => {
              const tot = rowTotals.get(strike) ?? 0;
              const totWall = levelsOnly ? wallAt(totalWalls, strike) : null;
              const atmTotShadow = isATM
                ? "inset 0 2px 0 #ffffff, inset 0 -2px 0 #ffffff, inset -2px 0 0 #ffffff"
                : undefined;
              return (
                <div style={{
                  padding: "2px 8px", fontSize: CELL.fontSize, fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 700,
                  color: tot === 0 ? "#3a4a5e" : "rgba(255,255,255,0.92)",
                  ...(CELL.shadow && tot !== 0 ? { textShadow: CELL.shadow } : {}),
                  borderRadius: CELL.radius || undefined,
                  background: (() => {
                    const heat = levelsOnly
                      ? (totWall && tot !== 0 ? skinRankBg(tot, WALL_RANK[totWall], SK) : "transparent")
                      : (tot !== 0 ? skinMetricBg(tot, totalScale.max, rankOf(tot, totalScale.top3), intensity, SK) : "transparent");
                    if (!totWall) return heat;
                    return levelFillBg(totWall, SK, heat) ?? heat;
                  })(),
                  borderLeft: `2px solid ${rgba(HT.cyan, selMode ? 0.8 : 0.35)}`,
                  boxShadow: atmTotShadow,
                  whiteSpace: "nowrap", overflow: "hidden",
                  // The ⅀ column answers the expiry selection by re-summing, so
                  // it dims for a strike pick only — never for an expiry one.
                  opacity: strikeDim ? 0.13 : 1,
                  transition: "opacity .12s",
                  display: "flex", alignItems: "baseline", justifyContent: "flex-end",
                }}>
                  {/* The count tabs drop SignVal's colored +/−: this cell can be
                      a full-strength red heat tile, and a red sign on it is the
                      unreadable case. White figure, direction from the tint. */}
                  {isCountMode || !CELL.signColors
                    ? <span style={{ color: tot === 0 ? "#3a4a5e" : "rgba(255,255,255,0.96)", textShadow: tot === 0 ? undefined : "0 1px 2px rgba(0,0,0,0.85)" }}>
                        {tot === 0 ? "·" : fmtVal(tot)}
                      </span>
                    : <SignVal text={tot === 0 ? "·" : fmtVal(tot)} />}
                </div>
              );
            })()}
            {ghostCells(`row-${strike}`)}
            {/* ── Mirrored strike rail (sticky right) ───────────────────────
                Same strike, same click target, same ATM / EM / selection
                treatment as the left rail — only the border and selection rule
                move to the LEFT edge. The number is RIGHT-aligned against the
                grid's outer edge (left-aligning it parked the strike hard
                against the Total column's figure and the two read as one
                string), with the EM / ATM tag pushed to the inner edge — the
                same tag-then-number order the left rail uses. Reading a cell in
                the furthest expiry column no longer means tracking back across
                the whole grid to name the row. */}
            <div
              onClick={(e) => onToggleStrike(strike, e.shiftKey)}
              title={emTip || "Click to focus this strike (shift-click = only this one)"}
              style={{
                position: "sticky", right: 0, zIndex: 2,
                // Extra left padding keeps the number off the Total column's
                // value; 5px on the right matches the left rail's inset.
                padding: "2px 5px 2px 10px", fontSize: 10, fontFamily: "var(--font-mono)", textAlign: "right",
                minHeight: ROW_MIN_H,
                color: isATM ? HT.cyan : "#e4e4e7",
                fontWeight: isATM ? 700 : 400,
                background: strikeSel
                  ? `linear-gradient(270deg, ${rgba(HT.cyan, 0.06)}, ${rgba(HT.cyan, 0.30)}), ${HDR_BG}`
                  : HDR_BG,
                // Inset, never a real border — identical reasoning to the left
                // rail: a 2px top/bottom border would make the ATM row taller
                // than every other row and the ladder would jump each time spot
                // crossed a strike.
                boxShadow: [
                  ...(strikeSel ? [`inset 2px 0 0 ${HT.cyan}`] : []),
                  ...(isATM ? ["inset 0 2px 0 #ffffff", "inset 0 -2px 0 #ffffff"] : []),
                ].join(", ") || undefined,
                borderLeft: `1px solid ${HT.border}`,
                display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3,
                cursor: "pointer",
                opacity: strikeDim ? 0.28 : 1,
                transition: "opacity .12s",
                whiteSpace: "nowrap", overflow: "hidden",
              }}
            >
              {emTag && (
                <span style={{
                  fontSize: 8, fontWeight: isATM ? 900 : 800, letterSpacing: isATM ? "0.06em" : "0.02em",
                  padding: isATM ? 0 : "1px 3px", borderRadius: 3, marginRight: "auto",
                  fontFamily: isATM ? "sans-serif" : undefined,
                  background: isATM ? "transparent" : "rgba(255,255,255,0.12)",
                  color: isATM ? HT.cyan : "#ffffff",
                }}>{emTag}</span>
              )}
              {Number.isInteger(strike) ? strike.toFixed(0) : strike.toFixed(2)}
            </div>
          </div>
        );
      })}
    </div>
  );
});

export default function OptionsChainPage({
  expirySelection = "sequential",
  expiryCount,
  ticker: externalTicker,
  showGrandTotal = true,
  initialReplay = false,
  initialReplayScope = "all",
}: {
  // "sequential" (default, standalone /options-chain route): next EXP_COLUMNS
  // expirations starting at the user's selected date. "key" (/new-home embed):
  // fixed 0DTE/1DTE/weekly/monthly set via pickKeyExpirations, ignoring
  // selectedExpiry/displayPercent's usual windowing role for column selection.
  expirySelection?: "sequential" | "key";
  // Sequential-mode column count override (defaults to EXP_COLUMNS = 14). The
  // /home heatmap-panel embed passes 5 to show the 5 closest expirations.
  expiryCount?: number;
  // When set, the page's own ticker input/GO/Recent controls are hidden and
  // the chain follows this ticker instead — used by the /new-home embed so
  // the page-level TickerSwitcher drives it. Uncontrolled (own ticker input)
  // when omitted, same as the standalone route.
  ticker?: string;
  // Hide the toolbar's "Total <greek>" readout. The /home embed passes false so
  // the compact chain panel doesn't show a per-ticker grand-total GEX.
  showGrandTotal?: boolean;
  // Mount already rewound. /replay mounts this page as its Options Chain tab,
  // where making the user press ▶ Replay first is asking them to confirm the
  // thing they navigated to. Initial state only — the toolbar toggle still
  // works, and in-grid replay still needs isStandalone (no external ticker).
  initialReplay?: boolean;
  // Which expiries the rewound grid opens on. The page's own default is "all"
  // (entering replay should look like the live chain, with the 0DTE collapse an
  // explicit choice); /replay passes "0dte" because that tab exists to watch
  // the front contract move.
  initialReplayScope?: ReplayScope;
} = {}) {
  // Number of sequential columns to render (default 14; embeds may narrow it).
  const seqColumns = Math.max(1, Math.floor(expiryCount ?? EXP_COLUMNS));
  // Standalone /options-chain route (no external ticker) = stripped-down view:
  // no Δ change columns, no toolbar grand total. (Per-expiry header totals DO
  // render here — they're the column-wise twin of the ⅀ Total column.)
  const isStandalone = externalTicker == null;
  // Fallback calendar list (used only until/if the per-ticker expirations
  // fetch resolves). Real listings come from /api/expirations so we never
  // offer a date the ticker doesn't actually trade (e.g. NVDA has no Monday
  // weeklies — picking one returned an empty chain).
  const fallbackExpiries = useMemo(() => buildExpiries(), []);
  const [expiries, setExpiries] = useState<Array<{ value: string; label: string }>>(fallbackExpiries);
  const [tickerInput, setTickerInput] = useState("SPX");
  const [activeTicker, setActiveTicker] = useState("SPX");
  // Clicking a 0DTE SPX cell opens the ContractFlowPopup (that strike's Flow
  // GEX history sparkline) — see the component above for details.
  const [contractPopup, setContractPopup] = useState<{ strike: number; expiration: string } | null>(null);
  // Cell hovered in the matrix → floating stats card (per-side vol/OI/net prem).
  // Stable callback so hovering never busts ChainMatrix's memo.
  const [hoverCell, setHoverCell] = useState<{ strike: number; colIdx: number; x: number; y: number } | null>(null);
  const onCellHover = useCallback((v: { strike: number; colIdx: number; x: number; y: number } | null) => setHoverCell(v), []);
  // Day-over-Day GEX movers for the active ticker (same source as the scanner's
  // DoD Movers tab: /proxy/strike-dod). One row per ticker at the strike that
  // moved most vs yesterday — so the hover card shows the vs-yesterday change on
  // that ticker's top-mover strike (other strikes have no stored DoD baseline).
  const [dodRows, setDodRows] = useState<Array<{ symbol: string; strike: number; expiry: string | null; net_yest: number; net_today: number; net_now: number | null; delta: number; now_delta: number | null }>>([]);
  const [recentTickers, setRecentTickers] = useState<string[]>([]);
  // Hydrate recents from browser cache after mount (avoids SSR mismatch).
  useEffect(() => { setRecentTickers(loadRecentTickers()); }, []);
  const [selectedExpiry, setSelectedExpiry] = useState(fallbackExpiries[0]?.value ?? "");
  // Prefill (don't auto-load) from a deep link like /options-chain?symbol=AAPL&expiry=2026-07-31 —
  // e.g. the Scanner "Watch This" cards. User still has to click GO themselves.
  useEffect(() => {
    // Uncontrolled (standalone route) ONLY. Embedded, the URL belongs to the
    // HOST page, and a query string meant for something else would reach in and
    // move this chain's ticker out from under the component that owns it.
    if (externalTicker != null) return;
    const u = new URL(window.location.href);
    const sym = u.searchParams.get("symbol")?.trim().toUpperCase();
    const exp = u.searchParams.get("expiry")?.trim();
    if (sym) setTickerInput(sym);
    if (exp) setSelectedExpiry(exp);
  }, [externalTicker]);
  const [displayPercent, setDisplayPercent] = useState<number>(10);
  // Auto strike window per ticker: SPX renders 10% (huge chain), everything
  // else 30%. Re-applies whenever the active ticker changes; the user can still
  // override via the % dropdown for the current ticker.
  useEffect(() => {
    setDisplayPercent(activeTicker.toUpperCase() === "SPX" ? 10 : 30);
  }, [activeTicker]);
  const [refreshSeed, setRefreshSeed] = useState(0);
  // Day-over-Day GEX movers for the active ticker (same source as the scanner's
  // DoD Movers tab: /proxy/strike-dod). Declared AFTER refreshSeed since the
  // effect depends on it — referencing refreshSeed above its declaration is a
  // temporal-dead-zone crash at render.
  useEffect(() => {
    let cancelled = false;
    const t = (activeTicker || "SPX").toUpperCase();
    (async () => {
      try {
        const r = await fetch(`/proxy/strike-dod?limit=2000`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (cancelled) return;
        const rows = Array.isArray(j?.rows) ? j.rows : [];
        setDodRows(rows.filter((d: { symbol?: string }) => String(d.symbol ?? "").toUpperCase() === t));
      } catch { if (!cancelled) setDodRows([]); }
    })();
    return () => { cancelled = true; };
  }, [activeTicker, refreshSeed]);
  // Heat skin — cosmetic only (see lib/calculations/heatSkins). VIVID is what
  // this grid ships on now; CLASSIC is one click away in the cog and is
  // byte-for-byte the old chain. Persisted per browser: it is a preference
  // about the board, not part of a session. The first render always uses the
  // page default and any saved value is applied in the effect below, so the
  // markup can't mismatch on hydration.
  const [heatSkin, setHeatSkin] = useState<HeatSkin>(CHAIN_DEFAULT_SKIN);
  const [intensity, setIntensity] = useState(HEAT_SKINS[CHAIN_DEFAULT_SKIN].intensity.def);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(CHAIN_HEAT_SKIN_KEY);
      if (isHeatSkin(saved)) { setHeatSkin(saved); setIntensity(HEAT_SKINS[saved].intensity.def); }
    } catch { /* ignore */ }
  }, []);
  // Each skin brings its own slider range AND its own tuned position: VIVID's
  // ramp is a different CURVE, not a louder CLASSIC, so 1.75 on one is not 1.75
  // on the other and the slider has to move with the skin rather than carry a
  // number across.
  const intensityMax = HEAT_SKINS[heatSkin].intensity.max;
  const changeHeatSkin = useCallback((v: HeatSkin) => {
    setHeatSkin(v);
    setIntensity(HEAT_SKINS[v].intensity.def);
    try { window.localStorage.setItem(CHAIN_HEAT_SKIN_KEY, v); } catch { /* ignore */ }
  }, []);
  // Grid colors read this deferred copy so dragging the Intensity slider stays
  // responsive — React commits the slider urgently and repaints the ~560-cell
  // matrix on a lower-priority pass it can interrupt.
  const deferredIntensity = useDeferredValue(intensity);
  const [lastUpdate, setLastUpdate] = useState("--:--:--");
  const [loadProgress, setLoadProgress] = useState(0); // 0-100
  const [greekMode, setGreekMode] = useState<GreekMode>("gex");
  const [dataMode, setDataMode] = useState<DataMode>("oi-vol");
  // Change-mode (Live / 15 / 30 / 60). When not "live", the front-expiry column
  // shows Δ-vs-N-min-ago from strike_growth instead of the live greek.
  const [changeMode, setChangeMode] = useState<ChangeMode>("live");
  // Replay LADDER overlay — the standalone <ChainReplay> modal. Still reachable
  // from inside the replay bar; the toolbar button now drives in-grid replay.
  const [replayOpen, setReplayOpen] = useState(false);
  // Front-expiry Δ15 stickers (toolbar toggle). Off by default: the mode widens
  // the 0DTE column to fit a chip beside the value, and that layout shift should
  // be something the user asks for, not something the page does on load.
  const [showDelta15, setShowDelta15] = useState(false);
  // ── In-grid replay mode ───────────────────────────────────────────────────
  // See the REPLAY_* block at the top of this file for what is and isn't
  // recorded. `replayOn` is the user's intent; `replayFrame` (derived below) is
  // whether there is actually a frame to render — the grid keys off the frame,
  // never off the intent, so turning replay on for a symbol with no recorded
  // history shows an explicit empty state instead of a silently blank chain.
  const [replayOn, setReplayOn] = useState(initialReplay);
  const [replayDates, setReplayDates] = useState<string[]>([]);
  const [replayDate, setReplayDate] = useState("");
  const [replayFrames, setReplayFrames] = useState<ReplayFrame[]>([]);
  const [replayIdx, setReplayIdx] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState<number>(1);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayErr, setReplayErr] = useState("");
  // Which expiries the rewound grid renders — see REPLAY_SCOPES. The page's own
  // default is "all" so entering replay looks like the live chain (every expiry
  // + Total) and the 0DTE collapse is an explicit choice rather than a surprise.
  // A host can open on a different scope: /replay passes "0dte".
  const [replayScope, setReplayScope] = useState<ReplayScope>(initialReplayScope);
  // What the greek/change tabs were before replay took them over, so leaving
  // replay puts the page back where the user left it instead of stranding them
  // on GEX/Live.
  const preReplayModes = useRef<{ greek: GreekMode; change: ChangeMode } | null>(null);
  // "expiry|strike" → chg$ map across ALL recorded expiries (from
  // /proxy/strike-growth/by-expiry). Lets every chain column show 15/30/60 Δ.
  const [changeMap, setChangeMap] = useState<Map<string, number>>(new Map());
  const [changeMeta, setChangeMeta] = useState<{ expiries: Set<string>; hasData: boolean }>({ expiries: new Set(), hasData: false });
  // Live mirror so loadChain (recreated each render) reads the current toggle.
  const dataModeRef = useRef<DataMode>("oi-vol");
  useEffect(() => { dataModeRef.current = dataMode; }, [dataMode]);
  const pageRef = useRef<HTMLDivElement>(null);

  // Title band text for snapshots. Without it the shared engine falls back to
  // "SPX GEX", which is wrong for any non-SPX ticker and says nothing about
  // which expiry range or greek the image is showing.
  const snapTitle = `Options Chain — ${activeTicker}  •  ${greekMode.toUpperCase()}  •  ${dataMode === "oi-vol" ? "OI+Vol" : "Vol only"}`;
  // Scroll container + ATM row refs — used to vertically center the ATM strike
  // in the visible table area on first load / ticker or expiry change (rather
  // than leaving the view scrolled to the top of the strike list).
  const chainScrollRef = useRef<HTMLDivElement>(null);
  const atmRowRef = useRef<HTMLDivElement>(null);
  const centeredForRef = useRef<string>("");
  const [chainError, setChainError] = useState<string | null>(null);
  // Weekly EM (from /api/levels, DB-backed). close ± em = 1× band, ± 2·em = 2×.
  const [emLevels, setEmLevels] = useState<{ close: number; em: number } | null>(null);
  // Prior-session close for the ACTIVE ticker, for the stat bar's spot %.
  // Same source TopBar seeds from (`prev-close` on the batch quote).
  const [prevClose, setPrevClose] = useState<number>(0);

  // ── Focus selection ────────────────────────────────────────────────────────
  // Click an expiry header or a strike to toggle it into the selection; every
  // unselected column/row fades and the ⅀ Total column re-sums over ONLY the
  // selected expiries. Empty sets = the normal, unfiltered chain.
  const [selExps, setSelExps] = useState<Set<string>>(() => new Set());
  const [selStrikes, setSelStrikes] = useState<Set<number>>(() => new Set());
  const hasSel = selExps.size > 0 || selStrikes.size > 0;
  const clearSel = useCallback(() => { setSelExps(new Set()); setSelStrikes(new Set()); }, []);
  /** solo = shift-click: replace the selection with just this one. */
  const toggleExpSel = useCallback((exp: string, solo: boolean) => {
    setSelExps(prev => {
      if (solo) return prev.size === 1 && prev.has(exp) ? new Set() : new Set([exp]);
      const next = new Set(prev);
      if (next.has(exp)) next.delete(exp); else next.add(exp);
      return next;
    });
  }, []);
  const toggleStrikeSel = useCallback((strike: number, solo: boolean) => {
    setSelStrikes(prev => {
      if (solo) return prev.size === 1 && prev.has(strike) ? new Set() : new Set([strike]);
      const next = new Set(prev);
      if (next.has(strike)) next.delete(strike); else next.add(strike);
      return next;
    });
  }, []);

  // The 7-expiration matrix. Each entry holds one expiration's strike→greek map.
  const expColumnsRef = useRef<ExpColumn[]>([]);
  const loadTokenRef = useRef(0);
  // Re-entrancy + rate guards for loadChain. A render loop or overlapping
  // triggers were firing the full 7-expiration fetch (×noCache) back-to-back,
  // hammering TT upstream. Block while a load is in flight, and enforce a min
  // gap between loads unless the caller is an explicit user refresh (force).
  const loadInFlightRef = useRef(false);
  const lastLoadAtRef = useRef(0);
  const LOAD_MIN_INTERVAL_MS = 5000;
  // Set by GO when the ticker changes; consumed by the expirations effect to
  // load the chain only after a valid expiry for the new ticker is resolved.
  const pendingGoRef = useRef(false);
  // Live mirror of selectedExpiry so the expirations effect (which only re-runs
  // on ticker change) always validates against the user's current choice.
  const selectedExpiryRef = useRef("");
  // Live mirror of the full expiries list so loadChain (recreated each render)
  // always slices the 7 starting at the user's selected expiry.
  const expiriesRef = useRef<Array<{ value: string; label: string }>>([]);

  // Load the 7 closest expirations starting at `startExp`, building a strike→
  // greek map per expiration. Each expiration is one /api/chains call.
  // When dataMode is "flow", also fetch flowGEX from /proxy/gex and merge.
  const loadChain = async (ticker: string, startExp: string, bustCache = false, force = false) => {
    // Drop overlapping calls, and rate-limit non-forced (auto/poll) loads. User
    // refresh/GO pass force=true to bypass the min-interval but still serialize.
    if (loadInFlightRef.current) return;
    const now = Date.now();
    if (!force && now - lastLoadAtRef.current < LOAD_MIN_INTERVAL_MS) return;
    loadInFlightRef.current = true;
    lastLoadAtRef.current = now;
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    const bust = bustCache ? `&noCache=1` : "";

    const all = expiriesRef.current.length ? expiriesRef.current : expiries;
    // "key" mode: fixed 0DTE/1DTE/weekly/monthly, independent of startExp.
    // "sequential" mode (default): the selected expiry + the next N from the
    // listed expiries.
    let targets: Array<{ value: string; label: string }>;
    if (expirySelection === "key") {
      targets = pickKeyExpirations(all);
    } else {
      const startIdx = Math.max(0, all.findIndex(e => e.value === startExp));
      targets = all.slice(startIdx, startIdx + seqColumns);
    }
    if (!targets.length) targets.push({ value: startExp, label: startExp });

    try {
      setChainError(null);
      setLoadProgress(8);

      // Flow GEX is only tracked for SPX (the live FlowGexAccumulator has no
      // dealer inventory for other tickers) — fetch it only when the active
      // ticker is SPX, so other tickers' columns read 0 instead of SPX's
      // strikes/values under a different chain. Response shape is
      // { gexRows: [...] } (each row carries flowGEX), not { ok, rows } —
      // the previous check against those never matched, so this toggle never
      // actually populated any values before this fix.
      let flowGexMap: Map<number, number> = new Map();
      if (dataModeRef.current === "flow" && ticker.toUpperCase() === "SPX") {
        try {
          const gexRes = await fetch(`/proxy/gex?basis=flow${bust ? "&noCache=1" : ""}`);
          const gexJson = await gexRes.json().catch(() => null);
          if (Array.isArray(gexJson?.gexRows)) {
            flowGexMap = new Map(
              gexJson.gexRows.map((r: any) => [Number(r.strike), Number(r.flowGEX ?? 0)])
            );
          }
        } catch {
          // Continue without flow data
        }
      }

      // Fetch every expiry column in parallel, then paint the whole grid in a
      // SINGLE commit once all /api/chains calls resolve — every cell appears at
      // once, with no column-by-column "domino" fill. (Previously each column
      // seeded a placeholder and repainted as its own fetch resolved.) The old
      // grid stays visible until the new data is ready, so there's no flash of
      // empty cells either.
      const results = await Promise.all(
        targets.map(async (t) => {
          // dedupeFetch, not fetch: this component is embedded elsewhere (the
          // home dashboard's chain panel), and each instance's own
          // loadInFlightRef / LOAD_MIN_INTERVAL_MS throttle knows nothing about
          // the others. Identical concurrent GETs collapse to one request.
          const res = await dedupeFetch(
            `/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(t.value)}&range=all${bust}`,
          );
          const json = await res.json().catch(() => null);
          const data = (json?.data as Record<string, unknown> | undefined) ?? undefined;
          const items = (data?.items as unknown[]) ?? [];
          const underlying = parseFloat(String(data?.underlyingPrice ?? 0)) || 0;
          return {
            expiration: t.value,
            label: t.label,
            underlying,
            cells: parseExpiration(items, t.value, underlying, dataModeRef.current, flowGexMap),
          } as ExpColumn;
        }),
      );

      if (token !== loadTokenRef.current) return;

      const cols = results.filter(c => c.cells.size > 0);
      if (!cols.length) {
        expColumnsRef.current = [];
        setUnderlyingPrice(0);
        setChainError(`No live chain payload returned for ${ticker}.`);
        setLoadProgress(0);
        setRefreshSeed(s => s + 0.01);
        return;
      }

      expColumnsRef.current = results; // keep all 7 slots (empty ones render blank)
      const spot = cols.find(c => c.underlying > 0)?.underlying ?? 0;
      setUnderlyingPrice(spot);
      setLoadProgress(100);
      setTimeout(() => setLoadProgress(0), 800);
      setRefreshSeed(s => s + 0.01);
    } catch (err) {
      console.error(`[OptionsChain] Load failed for ${ticker}:`, err);
      expColumnsRef.current = [];
      setUnderlyingPrice(0);
      setChainError(`Live chain load failed for ${ticker}.`);
      setLoadProgress(0);
    } finally {
      loadInFlightRef.current = false;
    }
  };

  useEffect(() => {
    setLastUpdate(
      new Date().toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    );
  }, [activeTicker, selectedExpiry, displayPercent, refreshSeed]);

  const doRefresh = async () => {
    await loadChain(activeTicker, selectedExpiry, true, true); // force: user refresh
    setRefreshSeed((value) => value + 1);
  };

  const { trigger, label: refreshLabel, style: refreshStyle } = useRefreshButton(doRefresh);

  // Manual load via GO button (no auto-load)
  const doGo = useCallback(() => {
    if (!tickerInput) return; // expiry auto-snaps to the front listing; no picker needed
    const ticker = (tickerInput || "SPX").toUpperCase();
    setRecentTickers((list) => pushRecentTicker(list, ticker));
    const tickerChanged = ticker !== activeTicker;
    setActiveTicker(ticker);
    // If the ticker changed, the expirations effect will refetch this ticker's
    // real listings and snap selectedExpiry to a valid date; the pendingGo flag
    // makes that effect fire the chain load once the expiry is confirmed valid.
    // This avoids loading against a date the new ticker may not list (e.g. a
    // Monday weekly that exists for SPX but not NVDA).
    if (tickerChanged) {
      pendingGoRef.current = true;
    } else {
      loadChain(ticker, selectedExpiry, true, true); // force: user GO
    }
  }, [tickerInput, selectedExpiry, activeTicker, loadChain]);

  // Quick-button select: set the input + active ticker and load (same path as
  // a ticker-change GO, which snaps to a valid expiry before loading).
  const selectTicker = useCallback((raw: string) => {
    const ticker = raw.toUpperCase();
    setTickerInput(ticker);
    setRecentTickers((list) => pushRecentTicker(list, ticker));
    if (ticker !== activeTicker) {
      pendingGoRef.current = true;
      setActiveTicker(ticker);
    } else if (selectedExpiryRef.current) {
      loadChain(ticker, selectedExpiryRef.current, true, true);
    }
  }, [activeTicker, loadChain]);

  // Follow an externally-driven ticker (the /new-home embed's page-level
  // TickerSwitcher) — same ticker-changed path as selectTicker/doGo, just
  // triggered by a prop change instead of a click. No-op when uncontrolled.
  useEffect(() => {
    if (externalTicker == null) return;
    const t = externalTicker.toUpperCase();
    setTickerInput(t);
    if (t !== activeTicker) {
      pendingGoRef.current = true;
      setActiveTicker(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTicker]);

  // Re-fetch + re-parse when the OI+Vol / Vol-only toggle changes (skip mount).
  const dataModeMountRef = useRef(true);
  useEffect(() => {
    if (dataModeMountRef.current) { dataModeMountRef.current = false; return; }
    if (activeTicker && selectedExpiryRef.current) {
      loadChain(activeTicker, selectedExpiryRef.current, false, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataMode]);

  useEffect(() => { selectedExpiryRef.current = selectedExpiry; }, [selectedExpiry]);
  useEffect(() => { expiriesRef.current = expiries; }, [expiries]);

  // Auto-load on mount.
  //
  // This hardcoded "SPX" even under `ticker` control, so every embed paid for
  // one wasted SPX chain fetch before the externalTicker effect above corrected
  // it — on the critical path, for data nobody asked for.
  useEffect(() => {
    const defaultExpiry = selectedExpiry || expiries[0]?.value;
    if (defaultExpiry) {
      loadChain((externalTicker || "SPX").toUpperCase(), defaultExpiry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll the active matrix every 60s so the 14-expiration GEX values track
  // intraday OI/volume + greek drift. Gating differs by ticker:
  //   • SPX  → isSpxFeedLive(): keeps updating ~24/7 across the trading week
  //            (Sun 8pm–Fri 4pm ET, minus the 4–6pm daily maintenance break).
  //   • all other tickers → isSessionLive(): RTH only. After the close their
  //            greeks just stay STALE (we stop polling — no overwrite) until the
  //            next session brings fresh OI. No point re-fetching frozen books.
  useEffect(() => {
    const id = setInterval(() => {
      const exp = selectedExpiryRef.current;
      if (!exp || !activeTicker) return;
      const isSpx = activeTicker.toUpperCase() === "SPX";
      const live = isSpx ? isSpxFeedLive() : isSessionLive();
      // Poll WITHOUT noCache so the server chain cache absorbs repeats across
      // clients; the cache TTL still refreshes intraday OI/greek drift.
      if (live) loadChain(activeTicker, exp, false);
    }, 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker]);

  // Fetch the ticker's REAL listed expirations whenever the active ticker
  // changes. Replaces the fabricated calendar list so the dropdown only ever
  // offers dates the symbol actually trades.
  useEffect(() => {
    let cancelled = false;
    const ticker = (activeTicker || "SPX").toUpperCase();

    (async () => {
      try {
        const json = await fetch(`/api/expirations?ticker=${encodeURIComponent(ticker)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const items: Array<Record<string, unknown>> = json?.data?.items ?? [];
        if (cancelled || !items.length) return;

        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const seen = new Set<string>();
        const list = items
          .map((it) => String(it["expiration-date"] ?? ""))
          .filter((d) => d && !seen.has(d) && (seen.add(d), true))
          .sort()
          .map((value) => {
            const dt = new Date(value + "T12:00:00");
            const mm = String(dt.getMonth() + 1).padStart(2, "0");
            const dd = String(dt.getDate()).padStart(2, "0");
            return { value, label: `${dayNames[dt.getDay()]}, ${mm}-${dd}-${dt.getFullYear()}` };
          });
        if (!list.length) return;

        setExpiries(list);
        // If the current selection isn't a real listing for this ticker, snap
        // to the nearest valid one (prefer today's 0DTE when present).
        const today = etDateKey(etToday());
        const cur = selectedExpiryRef.current;
        const validExpiry = list.some((e) => e.value === cur)
          ? cur
          : (list.find((e) => e.value === today)?.value ?? list[0].value);
        setSelectedExpiry(validExpiry);

        // A ticker-change GO is waiting on a valid expiry — load the chain now.
        if (pendingGoRef.current) {
          pendingGoRef.current = false;
          loadChain(ticker, validExpiry, true, true); // force: user GO after expiry snap
        }
      } catch {
        /* keep fallback calendar list */
      }
    })();

    return () => { cancelled = true; };
    // Only re-run on ticker change. loadChain is recreated every render, so
    // listing it here caused an infinite fetch loop (effect → setState →
    // render → new loadChain → effect …). selectedExpiry is read via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker]);

  const [underlyingPrice, setUnderlyingPrice] = useState(0);

  // The 7 expiration columns (some may be empty placeholders) + the spot used
  // to center the strike window. Rebuilt whenever a load completes.
  const { columns: liveColumns, spot: liveSpot } = useMemo(() => {
    const cols = expColumnsRef.current;
    if (!cols.length) return { columns: [] as ExpColumn[], spot: 0 };
    const atmStrike =
      underlyingPrice > 0
        ? underlyingPrice
        : cols.find(c => c.underlying > 0)?.underlying ?? 0;
    return { columns: cols, spot: atmStrike };
  }, [activeTicker, expiries, refreshSeed, selectedExpiry, underlyingPrice]);

  // ── Replay: the frame on screen, and the columns built from it ─────────────
  // The whole of replay mode is this swap. Everything downstream of `columns` —
  // the strike window, per-column heat scales, MVC/pin markers, column totals,
  // the ⅀ Total column, the hover card, the toolbar grand total — is written
  // against ExpColumn[] and has no idea where the numbers came from. Rebuilding
  // `columns` from a recorded frame therefore rewinds the entire grid, and
  // costs no changes at any of those call sites. The alternative (a parallel
  // replay map threaded through ChainMatrix, the way changeMap is) would have
  // meant a replay branch in every one of them, each a place for live and
  // recorded values to leak into the same view.
  const replayFrame = (replayOn && isStandalone)
    ? (replayFrames[Math.min(replayIdx, replayFrames.length - 1)] ?? null)
    : null;

  // Every expiry the session recorded, ascending. The scope control picks from
  // this; the axis below is built from whatever it picked.
  const replayAllExpiries = useMemo(() => {
    const expiries = new Set<string>();
    for (const f of replayFrames) for (const e of f.expiries) expiries.add(e);
    return [...expiries].sort();
  }, [replayFrames]);

  // The session's 0DTE expiry: the one expiring ON the replayed date. Roots
  // without a same-day listing (most single names) never have one, so fall back
  // to the earliest expiry the session recorded — the front contract, which is
  // what "0DTE" means for that root on that day. Surfaced in the replay bar so
  // a fallback is never mistaken for a true same-day expiry.
  const replayZeroDteExp = replayAllExpiries.includes(replayDate)
    ? replayDate
    : (replayAllExpiries[0] ?? "");
  const replayZeroDteIsExact = !!replayZeroDteExp && replayZeroDteExp === replayDate;

  // ── The replay session's fixed axes ───────────────────────────────────────
  // Every strike and every IN-SCOPE expiry recorded in ANY frame of the loaded
  // session, computed once per session+scope and used for every frame in it.
  //
  // This is the difference between a replay you can read and one that shakes.
  // The recorder stores the top N strikes A SIDE PER SWEEP, so the membership
  // of that set changes as the walls move — build the axis from the current
  // frame and rows enter and leave at both ends on every step, everything
  // between them slides, and the auto-scroll effect (keyed on row count) yanks
  // the viewport on top of it. Fixing the axis for the whole session turns that
  // back into what it should be: one ladder, values changing on it over time. A
  // strike the current frame didn't record simply renders blank in its row.
  const replayAxis = useMemo(() => {
    // Scope first: in "0dte" the axis must cover ONLY that expiry, or every
    // strike that was ever a wall in a LATER expiry survives as a permanently
    // blank row and the one column on screen is lost in whitespace.
    const keep = replayScope === "0dte" && replayZeroDteExp
      ? new Set([replayZeroDteExp])
      : null;
    const strikes = new Set<number>();
    const expiries = new Set<string>();
    for (const f of replayFrames) {
      for (const e of f.expiries) if (!keep || keep.has(e)) expiries.add(e);
      f.cells.forEach((_v, key) => {
        const bar = key.indexOf("|");
        if (keep && !keep.has(key.slice(0, bar))) return;
        const strike = Number(key.slice(bar + 1));
        if (Number.isFinite(strike)) strikes.add(strike);
      });
    }
    return {
      strikes: [...strikes].sort((a, b) => a - b),
      expiries: [...expiries].sort(),
    };
  }, [replayFrames, replayScope, replayZeroDteExp]);

  const replayColumns = useMemo<ExpColumn[]>(() => {
    if (!replayFrame) return [];
    // Columns come from the SESSION axis, not from this frame. Per-frame
    // columns made the grid reflow horizontally every time an expiry dropped
    // out of a sweep. Expiries never recorded in this session are still hidden
    // entirely — the collapse is per session, not per frame.
    return replayAxis.expiries.map((exp) => {
      const cells = new Map<number, GreekCell>();
      replayFrame.cells.forEach((v, key) => {
        const bar = key.indexOf("|");
        if (key.slice(0, bar) !== exp) return;
        const strike = Number(key.slice(bar + 1));
        if (!Number.isFinite(strike)) return;
        cells.set(strike, {
          // "flow" GEX isn't recorded, so it reads as OI+Vol rather than
          // silently rendering an empty grid on a tab that looks available.
          gex: dataMode === "vol-only" ? v.vol : v.net,
          volGex: v.vol,
          // Not recorded. Zero — not a live value — because a live DEX beside a
          // 30-minutes-ago GEX is the exact confusion replay exists to avoid.
          // The greek tabs are pinned to GEX while replay is on regardless.
          dex: 0, chex: 0, vex: 0, oi: 0,
          callOI: 0, putOI: 0, callVol: 0, putVol: 0, callPrem: 0, putPrem: 0,
        });
      });
      return {
        expiration: exp,
        label: exp,
        cells,
        underlying: replayFrame.spot,
      };
    });
  }, [replayFrame, replayAxis, dataMode]);

  const columns = replayFrame ? replayColumns : liveColumns;
  // Centre the strike window on the spot AS RECORDED, not on live spot — that
  // is the point of a rewind. Falls back to live spot only if the frame carried
  // no usable price (a fresh root before its first quote landed).
  const spot = replayFrame ? (replayFrame.spot > 0 ? replayFrame.spot : liveSpot) : liveSpot;

  // Union of every strike listed across all 7 expirations, sorted ascending.
  // In replay this is the SESSION axis, not the current frame's strikes —
  // deriving it from `columns` would make the row set change under playback.
  // See replayAxis.
  const allStrikes = useMemo(() => {
    if (replayFrame) return replayAxis.strikes;
    const set = new Set<number>();
    columns.forEach(c => c.cells.forEach((_v, k) => set.add(k)));
    return [...set].sort((a, b) => a - b);
  }, [columns, replayFrame, replayAxis]);

  const nearestStrike = useMemo(() => {
    if (!allStrikes.length) return 0;
    const ref = spot > 0 ? spot : allStrikes[Math.floor(allStrikes.length / 2)];
    return allStrikes.reduce(
      (best, s) => (Math.abs(s - ref) < Math.abs(best - ref) ? s : best),
      allStrikes[0],
    );
  }, [allStrikes, spot]);

  // ── Sticky window centre ──────────────────────────────────────────────────
  // See RECENTER_EVERY_STRIKES. Held as STATE with the chain it belongs to
  // baked into the key, not as a ref mutated during render: a ref written in a
  // useMemo is what the GexHeatmap centre-anchor does, and it was already
  // flagged there as not StrictMode/concurrent-safe. Render stays pure — it
  // only READS the anchor and falls back to true ATM when the anchor doesn't
  // belong to the chain on screen — and the effect below does the committing.
  // Scope is part of the key: switching 0DTE↔All rebuilds the strike axis, so an
  // anchor taken on the other axis points at a row that may no longer exist.
  const centerKey = `${activeTicker}|${replayFrame ? `replay:${replayDate}:${replayScope}` : "live"}`;
  const [centerAnchor, setCenterAnchor] = useState<{ key: string; strike: number }>({ key: "", strike: 0 });

  const centerStrike = useMemo(
    () => pickCenterStrike(allStrikes, nearestStrike, centerAnchor, centerKey),
    [allStrikes, nearestStrike, centerAnchor, centerKey],
  );

  // Persist whatever the render just drew. Because both sides call
  // pickCenterStrike, this only ever writes a value the grid is ALREADY
  // showing — it records the anchor, it never moves the window.
  useEffect(() => {
    if (!centerStrike) return;
    if (centerAnchor.key !== centerKey || centerAnchor.strike !== centerStrike) {
      setCenterAnchor({ key: centerKey, strike: centerStrike });
    }
  }, [centerStrike, centerAnchor, centerKey]);

  const totalRows = allStrikes.length;
  const autoDisplayPercent = useMemo(() => {
    // Replay's strike universe is ALREADY a filtered set — the recorder stores
    // only the top strikes a side, so `allStrikes` here is the walls and
    // nothing else. Taking 10% of that would hide walls the whole feature
    // exists to show, so the % control doesn't apply to a rewound grid.
    if (replayFrame) return 100;
    const requestedCount = Math.max(1, Math.round(totalRows * (displayPercent / 100)));
    if (displayPercent === 10 && requestedCount < 10) return 20;
    return displayPercent;
  }, [displayPercent, totalRows, replayFrame]);

  // The strike window shown, high → low, centred on the STICKY centre (see
  // RECENTER_EVERY_STRIKES) rather than on live ATM — that is what stops the
  // ladder sliding a row every time spot crosses a strike. We take an equal
  // count of strikes above and below the centre (odd total so a true middle row
  // exists). If the chain runs out on one side, we pad that side with nulls so
  // the centre stays put no matter the window size.
  const visibleStrikes = useMemo(() => {
    if (!allStrikes.length) return [] as (number | null)[];
    if (autoDisplayPercent >= 100) return [...allStrikes].sort((a, b) => b - a) as (number | null)[];

    const ascending = [...allStrikes].sort((a, b) => a - b);
    const atmIndex = ascending.findIndex(s => s === centerStrike);
    if (atmIndex < 0) return [...ascending].sort((a, b) => b - a) as (number | null)[];

    let targetCount = Math.max(11, Math.round(ascending.length * (autoDisplayPercent / 100)));
    if (targetCount % 2 === 0) targetCount += 1; // force odd → real center row
    const wing = (targetCount - 1) / 2; // strikes on each side of ATM

    const out: (number | null)[] = [];
    // High → low: above the centre (descending), the centre, then below it.
    for (let k = wing; k >= 1; k--) {
      const idx = atmIndex + k;
      out.push(idx < ascending.length ? ascending[idx] : null);
    }
    out.push(centerStrike);
    for (let k = 1; k <= wing; k++) {
      const idx = atmIndex - k;
      out.push(idx >= 0 ? ascending[idx] : null);
    }
    return out;
  }, [allStrikes, autoDisplayPercent, centerStrike]);

  // ── Replay: keep the ATM row in view while PLAYING ────────────────────────
  // The session axis is fixed (see replayAxis), which is what makes the grid
  // hold still — but it also means the ATM row walks down a stationary ladder
  // as the session runs, and over a full day it can walk clean off screen.
  //
  // Two rules keep this from becoming the jitter it just replaced. It SCROLLS,
  // it never reflows — rows do not move relative to each other. And it only
  // fires when the ATM row has actually left the middle 60% of the viewport,
  // so it's a rescue every few minutes of playback, not a nudge every frame.
  // Gated on `replayPlaying` on purpose: while paused or scrubbing the user is
  // driving, and yanking their scroll position then would be obnoxious.
  useEffect(() => {
    if (!replayFrame || !replayPlaying) return;
    const el = atmRowRef.current;
    const container = chainScrollRef.current;
    if (!el || !container) return;
    const viewH = container.clientHeight;
    if (!viewH) return;
    const rowTop = el.offsetTop - container.scrollTop;
    const band = viewH * 0.2; // dead zone: the middle 60%
    if (rowTop >= band && rowTop <= viewH - band) return; // still comfortably in view
    container.scrollTop = Math.max(0, el.offsetTop - viewH / 2 + el.clientHeight / 2);
  }, [replayFrame, replayPlaying]);

  // Center the ATM row vertically in the scroll viewport on load / whenever the
  // ticker or expiry set changes (visibleStrikes always places ATM at the exact
  // middle index, but the scroll container itself defaults to scrolled-to-top —
  // this nudges it so the ATM strike is what's actually on screen at load).
  useEffect(() => {
    if (!visibleStrikes.length) return;
    const key = `${activeTicker}|${selectedExpiryRef.current}|${visibleStrikes.length}`;
    if (centeredForRef.current === key) return;
    const id = requestAnimationFrame(() => {
      const el = atmRowRef.current;
      const container = chainScrollRef.current;
      if (!el || !container) return;
      const elTop = el.offsetTop;
      const target = elTop - container.clientHeight / 2 + el.clientHeight / 2;
      container.scrollTop = Math.max(0, target);
      centeredForRef.current = key;
    });
    return () => cancelAnimationFrame(id);
  }, [visibleStrikes, activeTicker]);

  // ── Day-over-day ΔOI state (OI tab only) ──────────────────────────────────
  // Declared here, ahead of valueAt, because valueAt now reads the snapshot:
  // the OI tab colors and totals every cell off the CHANGE, not a live level.
  // The fetch that fills it stays down with the other data effects.
  //
  // `symbol` is carried IN the state, and every read is gated on it matching
  // activeTicker (see oiSnapshot). The map keys are `expiry|strike` with no
  // symbol in them, so without that gate the previous ticker's snapshot would
  // keep rendering under the new ticker's chain for the whole round trip —
  // SPY's ΔOI shown against QQQ strikes, indistinguishable from real data.
  const [oiChange, setOiChange] = useState<{
    symbol: string | null;
    map: Map<string, { callOI: number; putOI: number; callChg: number; putChg: number }>;
    date: string | null;
    prevDate: string | null;
  }>({ symbol: null, map: new Map(), date: null, prevDate: null });

  // The snapshot as the UI is allowed to see it: empty unless it belongs to the
  // ticker currently on screen. One place to gate, so the matrix and the
  // provenance label can never disagree about which ticker they're describing.
  const oiSnapshot = useMemo(
    () => (oiChange.symbol === activeTicker
      ? oiChange
      : { symbol: activeTicker, map: new Map<string, { callOI: number; putOI: number; callChg: number; putChg: number }>(), date: null, prevDate: null }),
    [oiChange, activeTicker],
  );

  // Active-greek value lookup: column index → strike → number.
  const valueAt = useCallback(
    (col: ExpColumn, strike: number): number | null => {
      // OI tab shows the day-over-day CHANGE and nothing else, so the heat
      // scale and every total read that change — from the recorded snapshot,
      // not the live chain. No snapshot entry → nothing to color or sum.
      if (greekMode === "oi") {
        const snap = oiSnapshot.map.get(`${col.expiration}|${strike}`);
        if (!snap) return null;
        // Only the side(s) this strike actually renders count (calls above ATM,
        // puts below, both at the pivot) — same rule the cell draws by.
        return oiSideChange(snap, strike, nearestStrike);
      }
      const cell = col.cells.get(strike);
      if (!cell) return null;
      // VOL tab: signed by SIDE, not by direction — call volume above ATM,
      // put volume below — so the heat scale, the column totals and the ⅀ Total
      // column all read the same number the cell draws from. Unlike OI this
      // needs no recorder: it is live off the chain cell.
      if (greekMode === "vol") return volSideValue(cell, strike, nearestStrike);
      return cell[greekMode];
    },
    [greekMode, nearestStrike, oiSnapshot],
  );

  // Per-column max + top-3 (by |active greek|) over the VISIBLE strikes, so each
  // expiration colors against its own scale (per-column intensity).
  const colScales = useMemo(() => {
    return columns.map(col => {
      const vals: number[] = [];
      visibleStrikes.forEach(s => {
        if (s == null) return;
        const v = valueAt(col, s);
        if (v != null && v !== 0) vals.push(Math.abs(v));
      });
      const sorted = [...vals].sort((a, b) => b - a);
      return { max: sorted[0] ?? 1, top3: sorted.slice(0, 3) };
    });
  }, [columns, visibleStrikes, valueAt]);

  // Per-column volume-GEX peak: the visible strike with the highest |volGex|.
  // Flagged with ✕ on the OI+Vol view so the pure-volume gamma peak shows up
  // next to the ★ OI+Vol MVC.
  const volMvcByCol = useMemo(() => {
    return columns.map(col => {
      let best: number | null = null;
      let bestAbs = 0;
      visibleStrikes.forEach(s => {
        if (s == null) return;
        const g = col.cells.get(s)?.volGex;
        if (g == null) return;
        const a = Math.abs(g);
        if (a > bestAbs) { bestAbs = a; best = s; }
      });
      return best;
    });
  }, [columns, visibleStrikes]);

  // MVC per column = the visible strike with the highest ABSOLUTE net GEX.
  // Always keyed on GEX (the MVC definition), independent of the active greek.
  const mvcByCol = useMemo(() => {
    return columns.map(col => {
      let best: number | null = null;
      let bestAbs = 0;
      visibleStrikes.forEach(s => {
        if (s == null) return;
        const g = col.cells.get(s)?.gex;
        if (g == null) return;
        const a = Math.abs(g);
        if (a > bestAbs) { bestAbs = a; best = s; }
      });
      return best;
    });
  }, [columns, visibleStrikes]);

  // ── Front-expiry Δ15 stickers ─────────────────────────────────────────────
  // Same source and gating as the multi-chain ladder: one bulk pull of the
  // recorder's NET GEX baselines for the FRONT (0DTE / nearest) expiry only —
  // one request per ticker, not one per cell — refreshed on the same 20s beat.
  const frontExp = columns[0]?.expiration ?? "";
  const [gexBaseline, setGexBaseline] = useState<Record<number, { vNow: number | null; v5: number | null; v15: number | null; v30: number | null }>>({});
  useEffect(() => {
    // Nothing is polled while the toggle is off, and the stored baselines are
    // dropped — a stale grid coming back on screen would stamp 15-minute moves
    // measured from whenever the mode was last switched off.
    if (!showDelta15 || !frontExp || !activeTicker) { setGexBaseline({}); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(
          `/api/mult-greek-gex-grid?ticker=${encodeURIComponent(activeTicker)}&expiry=${encodeURIComponent(frontExp)}`,
          { cache: "no-store" },
        );
        if (!r.ok) { if (!cancelled) setGexBaseline({}); return; }
        const j = await r.json();
        const cells = (j?.data?.cells ?? {}) as Record<string, { vNow: number | null; v5: number | null; v15: number | null; v30: number | null }>;
        const byStrike: Record<number, { vNow: number | null; v5: number | null; v15: number | null; v30: number | null }> = {};
        for (const [k, v] of Object.entries(cells)) byStrike[Number(k)] = v;
        if (!cancelled) setGexBaseline(byStrike);
      } catch { if (!cancelled) setGexBaseline({}); }
    };
    void load();
    const id = setInterval(() => { void load(); }, 20_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [showDelta15, activeTicker, frontExp, refreshSeed]);

  // Δ per cell on the front column, for the top-5 |GEX| strikes per side of ATM
  // only — stamping every strike buries the movers that matter in noise. Rank
  // runs 1..5 WITHIN each sign, so a quiet side still gets its own full scale.
  const delta15 = useMemo(() => {
    const out = new Map<number, { d: number; pct: number; rank: number }>();
    const col = columns[0];
    if (!showDelta15 || !col || !frontExp || replayFrame) return out;
    const above: { s: number; a: number }[] = [];
    const below: { s: number; a: number }[] = [];
    visibleStrikes.forEach(s => {
      if (s == null) return;
      const g = col.cells.get(s)?.gex;
      if (g == null) return;
      (s >= nearestStrike ? above : below).push({ s, a: Math.abs(g) });
    });
    const ranked = new Set<number>();
    [above, below].forEach(arr => arr.sort((x, y) => y.a - x.a).slice(0, 5).forEach(v => ranked.add(v.s)));
    ranked.forEach(s => {
      const live = col.cells.get(s)?.gex;
      const past = gexBaseline[s]?.v15 ?? null;
      if (live == null || past == null) return;
      const d = live - past;
      if (d === 0) return;
      // A baseline at ~0 makes the percent meaningless (a strike coming from
      // nothing reads as an enormous move) — skip it rather than let it set the
      // scale and wash out every other stamp in the column.
      if (!Number.isFinite(past) || Math.abs(past) < 1e-6) return;
      const pct = (d / Math.abs(past)) * 100;
      if (!Number.isFinite(pct) || Math.abs(pct) < 1) return;   // sub-1% is noise
      out.set(s, { d, pct, rank: 5 });
    });
    for (const sign of [1, -1]) {
      [...out.entries()]
        .filter(([, v]) => (sign > 0 ? v.pct > 0 : v.pct < 0))
        .sort((x, y) => Math.abs(y[1].pct) - Math.abs(x[1].pct))
        .forEach(([k], idx) => { const e = out.get(k); if (e) e.rank = idx + 1; });
    }
    return out;
  }, [showDelta15, columns, visibleStrikes, nearestStrike, gexBaseline, frontExp, replayFrame]);

  // Weekly EM for the active ticker (DB-backed via /api/levels). Refetched on
  // ticker change and on each manual refresh so the bands track intraday EM.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const row = await fetch(`/api/levels?ticker=${encodeURIComponent(activeTicker)}`)
        .then(r => r.json()).catch(() => null);
      if (cancelled) return;
      const em = parseFloat(String(row?.em ?? ""));
      const close = parseFloat(String(row?.close ?? ""));
      setEmLevels(Number.isFinite(em) && em > 0 && Number.isFinite(close) && close > 0
        ? { close, em } : null);
    })();
    return () => { cancelled = true; };
  }, [activeTicker, refreshSeed]);

  // Prior-session close for the active ticker — the baseline for the stat bar's
  // spot %. One batch quote, same `prev-close` field TopBar seeds from. A miss
  // just leaves prevClose at 0 and the % readout is omitted rather than faked.
  useEffect(() => {
    let cancelled = false;
    setPrevClose(0);
    (async () => {
      try {
        const r = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(activeTicker)}`);
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const items: Array<Record<string, unknown>> = d?.data?.items || [];
        for (const q of items) {
          const sym = String(q.symbol || "").split(":")[0].replace(/^\$/, "");
          if (sym.toUpperCase() !== activeTicker.toUpperCase()) continue;
          const prev = parseFloat(String(q["prev-close"] ?? q.prevClose ?? 0));
          if (Number.isFinite(prev) && prev > 0 && !cancelled) setPrevClose(prev);
          break;
        }
      } catch { /* no baseline → no % shown */ }
    })();
    return () => { cancelled = true; };
  }, [activeTicker, refreshSeed]);

  // A focus selection is about the columns/strikes currently on screen — a new
  // ticker, a new expiry window or a jump in/out of replay invalidates it.
  useEffect(() => { clearSel(); }, [activeTicker, selectedExpiry, replayDate, replayScope, clearSel]);

  // Load the strike→change map for the active ticker when a change mode is on.
  // Reuses /proxy/strike-growth which returns chg15/chg30/chg60 per (front-expiry)
  // strike. Refetched on ticker change, mode change, and each refresh.
  useEffect(() => {
    if (changeMode === "live") { setChangeMap(new Map()); setChangeMeta({ expiries: new Set(), hasData: false }); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/proxy/strike-growth/by-expiry?symbol=${encodeURIComponent(activeTicker)}`, { cache: "no-store" });
        const text = await res.text();
        let j: any;
        try { j = JSON.parse(text); } catch { j = null; }
        if (cancelled) return;
        if (!j?.ok || !Array.isArray(j.rows) || !j.rows.length) {
          setChangeMap(new Map()); setChangeMeta({ expiries: new Set(), hasData: false });
          return;
        }
        const key = changeMode === "15" ? "chg15" : changeMode === "30" ? "chg30" : "chg60";
        const m = new Map<string, number>();
        const exps = new Set<string>();
        for (const r of j.rows) {
          const exp = String(r.expiry ?? "");
          if (exp) exps.add(exp);
          const v = r[key];
          if (v != null) m.set(`${exp}|${Number(r.strike)}`, Number(v));
        }
        setChangeMap(m);
        setChangeMeta({ expiries: exps, hasData: m.size > 0 });
      } catch {
        if (!cancelled) { setChangeMap(new Map()); setChangeMeta({ expiries: new Set(), hasData: false }); }
      }
    })();
    return () => { cancelled = true; };
  }, [changeMode, activeTicker, refreshSeed]);

  // ── Replay: pin the tabs replay can actually honour ───────────────────────
  // GEX is the only greek strike_growth records, and a Δ-vs-15-min-ago column
  // computed against a rewound grid would be comparing two different pasts. So
  // replay takes both tabs and gives them back on exit. Deliberately NOT a
  // silent disable: the buttons stay visible but inert with a title saying why.
  useEffect(() => {
    if (replayOn) {
      if (!preReplayModes.current) preReplayModes.current = { greek: greekMode, change: changeMode };
      if (greekMode !== "gex") setGreekMode("gex");
      if (changeMode !== "live") setChangeMode("live");
    } else if (preReplayModes.current) {
      const { greek, change } = preReplayModes.current;
      preReplayModes.current = null;
      setGreekMode(greek);
      setChangeMode(change);
    }
    // greekMode/changeMode are read, not tracked — listing them would fight the
    // pin (set → effect → set) on every tab click while replay is on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayOn]);

  // Leaving replay (or switching ticker) drops the loaded session so the next
  // entry doesn't flash the previous symbol's frames under the new ticker.
  useEffect(() => {
    setReplayFrames([]); setReplayIdx(0); setReplayPlaying(false); setReplayErr("");
  }, [activeTicker, replayOn]);

  // Which sessions are replay-able for this ticker (retention is ~5 trading
  // days, so this list is short by design — it is not a history picker).
  useEffect(() => {
    if (!replayOn) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/proxy/strike-growth/replay-meta?symbol=${encodeURIComponent(activeTicker)}`, { cache: "no-store" });
        const j = await res.json().catch(() => null);
        if (cancelled) return;
        const ds: string[] = Array.isArray(j?.dates) ? j.dates.map((d: unknown) => String(d).slice(0, 10)) : [];
        setReplayDates(ds);
        setReplayDate((cur) => (cur && ds.includes(cur) ? cur : ds[0] ?? ""));
        if (!ds.length) setReplayErr(`No recorded sessions for ${activeTicker}.`);
      } catch {
        if (!cancelled) { setReplayDates([]); setReplayDate(""); setReplayErr("Could not load recorded sessions."); }
      }
    })();
    return () => { cancelled = true; };
  }, [replayOn, activeTicker]);

  // The frames themselves. One request per (symbol, session) — the whole day is
  // pulled up front so scrubbing is instant and never re-hits the network mid-drag.
  useEffect(() => {
    if (!replayOn || !replayDate) return;
    let cancelled = false;
    // Drop the previous session's frames immediately. Holding them while the
    // new day loads would render one date's grid under another date's label,
    // which is worse than a moment of the loading state.
    setReplayFrames([]); setReplayIdx(0);
    setReplayLoading(true); setReplayErr(""); setReplayPlaying(false);
    (async () => {
      try {
        const res = await fetch(
          `/proxy/strike-growth/frames-by-expiry?symbol=${encodeURIComponent(activeTicker)}&date=${encodeURIComponent(replayDate)}`,
          { cache: "no-store" },
        );
        const j = await res.json().catch(() => null);
        if (cancelled) return;
        if (!j?.ok || !Array.isArray(j.frames) || !j.frames.length) {
          setReplayFrames([]);
          setReplayErr(j?.error ? String(j.error) : `No recorded frames for ${activeTicker} on ${replayDate}.`);
          return;
        }
        const expiries: string[] = Array.isArray(j.expiries) ? j.expiries.map(String) : [];
        const frames: ReplayFrame[] = j.frames.map((f: any) => {
          const cells = new Map<string, { net: number; vol: number }>();
          const seen = new Set<string>();
          for (const c of (f.cells ?? [])) {
            const exp = expiries[Number(c[0])];
            if (!exp) continue;
            seen.add(exp);
            cells.set(`${exp}|${Number(c[1])}`, { net: Number(c[2]) || 0, vol: Number(c[3]) || 0 });
          }
          return {
            ts: String(f.ts), spot: Number(f.spot) || 0, cells,
            expiries: expiries.filter((e) => seen.has(e)),
          };
        });
        setReplayFrames(frames);
        // Land on the LAST frame, not the first: entering replay from a live
        // chain, the nearest thing to what was just on screen is the most
        // recent snapshot. Scrub back from there.
        setReplayIdx(frames.length - 1);
      } catch {
        if (!cancelled) { setReplayFrames([]); setReplayErr("Could not load frames."); }
      } finally {
        if (!cancelled) setReplayLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [replayOn, replayDate, activeTicker]);

  // Playback. Stops at the last frame rather than looping — a session that
  // silently restarts reads as live data jumping backwards.
  useEffect(() => {
    if (!replayPlaying || replayFrames.length === 0) return;
    const id = setInterval(() => {
      setReplayIdx((i) => {
        if (i >= replayFrames.length - 1) { setReplayPlaying(false); return i; }
        return i + 1;
      });
    }, REPLAY_BASE_MS / replaySpeed);
    return () => clearInterval(id);
  }, [replayPlaying, replaySpeed, replayFrames.length]);

  // ── Day-over-day ΔOI (OI tab only) ────────────────────────────────────────
  // Open interest is settled overnight by the OCC and republished pre-open; it
  // does NOT tick during the session. So there is no live "change since 9:30"
  // to compute client-side — the meaningful delta is today's settled book vs
  // the previous trading day's, and that has to come from a stored snapshot.
  // server-v2/oi-daily-recorder.js takes exactly one snapshot per day at 9:32
  // ET across the scanner watchlist; /proxy/oi-change diffs its two most recent
  // dates for this symbol. Fetched only while the OI tab is active, and keyed
  // on ticker (not expiry) since one call returns every expiry we record.
  //
  // The `oiChange` state and its ticker-gated `oiSnapshot` view are declared
  // further up, above valueAt — the OI grid's heat and totals read them, so
  // they have to exist before valueAt closes over them. Only the fetch lives
  // here, with the rest of the data effects. Worth restating why the gate
  // exists: switching ticker while on a non-OI tab skips this fetch entirely,
  // so without it the previous symbol's snapshot would survive under the new
  // chain until the OI tab is opened again.
  useEffect(() => {
    if (greekMode !== "oi") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/proxy/oi-change?symbol=${encodeURIComponent(activeTicker)}`, { cache: "no-store" });
        const j = await res.json().catch(() => null);
        if (cancelled) return;
        if (!j?.ok || !Array.isArray(j.rows)) {
          setOiChange({ symbol: activeTicker, map: new Map(), date: null, prevDate: null });
          return;
        }
        const m = new Map<string, { callOI: number; putOI: number; callChg: number; putChg: number }>();
        for (const r of j.rows) {
          m.set(`${String(r.expiry ?? "")}|${Number(r.strike)}`, {
            callOI: Number(r.callOI) || 0,
            putOI: Number(r.putOI) || 0,
            callChg: Number(r.callChg) || 0,
            putChg: Number(r.putChg) || 0,
          });
        }
        setOiChange({ symbol: activeTicker, map: m, date: j.date ?? null, prevDate: j.prevDate ?? null });
      } catch {
        if (!cancelled) setOiChange({ symbol: activeTicker, map: new Map(), date: null, prevDate: null });
      }
    })();
    return () => { cancelled = true; };
  }, [greekMode, activeTicker, refreshSeed]);

  // Per-expiry heatmap scale for change columns: each change column colors
  // against its own |Δ| max over the visible strikes. Keyed by expiration.
  const changeScaleByExp = useMemo(() => {
    const map = new Map<string, { max: number; top3: number[] }>();
    if (changeMode === "live" || !changeMeta.hasData) return map;
    changeMeta.expiries.forEach(exp => {
      const vals: number[] = [];
      visibleStrikes.forEach(s => {
        if (s == null) return;
        const v = changeMap.get(`${exp}|${s}`);
        if (v != null && v !== 0) vals.push(Math.abs(v));
      });
      const sorted = [...vals].sort((a, b) => b - a);
      map.set(exp, { max: sorted[0] ?? 1, top3: sorted.slice(0, 3) });
    });
    return map;
  }, [changeMode, changeMeta.hasData, changeMeta.expiries, changeMap, visibleStrikes]);

  // The 4 EM band strikes (snapped to visible strikes): 1× down/up, 2× down/up.
  // Null when no EM is available.
  const emStrikes = useMemo(() => {
    if (!emLevels) return null;
    const { close, em } = emLevels;
    const vs = visibleStrikes.filter((s): s is number => s != null);
    return {
      close: nearestStrikeTo(close, vs), // last week's published close (band center)
      d1: nearestStrikeTo(close - em, vs),
      u1: nearestStrikeTo(close + em, vs),
      d2: nearestStrikeTo(close - 2 * em, vs),
      u2: nearestStrikeTo(close + 2 * em, vs),
    };
  }, [emLevels, visibleStrikes]);

  // Always render the target slot count so the grid keeps a stable width even
  // before all expirations resolve — EXP_COLUMNS (14) in sequential mode, 4 in
  // key mode (0DTE/1DTE/weekly/monthly).
  // In replay the grid renders EXACTLY the recorded expiries and no padding
  // slots: a placeholder column is a promise that data is still loading, and in
  // a rewound grid nothing more is coming. Live keeps the fixed slot count so
  // the grid doesn't reflow while expirations resolve.
  const gridCols = replayFrame
    ? columns.length
    : Math.max(columns.length, expirySelection === "key" ? 4 : seqColumns);

  // Snapshot/Discord caption. Declared here (not up with snapTitle) because it
  // needs replayFrame, which only exists once the recorded columns are built.
  // Scope rides in the caption: a one-column 0DTE grab and an all-expiry grab
  // are different claims about the same session, and the image has to say which.
  const replayTitle = replayFrame
    ? `Options Chain REPLAY — ${activeTicker}  •  ${replayDate} ${fmtReplayClock(replayFrame.ts)} ET  •  ${replayScope === "0dte" ? `0DTE ${replayZeroDteExp}` : `all exp (${replayAxis.expiries.length})`}  •  GEX  •  ${dataMode === "vol-only" ? "Vol only" : "OI+Vol"}`
    : snapTitle;

  // ⅀ Total sums the NON-0DTE expiries. In "0dte" scope that set is empty, so
  // the column is dropped rather than printed as zeros. See REPLAY_SCOPES.
  const showTotalCol = !(replayFrame && replayScope === "0dte");

  // Size the rewound grid for the session's FULL expiry count in either scope,
  // so switching 0DTE↔All changes which columns are on screen and nothing else.
  // Live passes 0 — its column count is already fixed by `seqColumns`.
  const layoutExpCols = replayFrame ? replayAllExpiries.length : 0;

  // EM bands only apply to current-week expirations. Mark which visible columns
  // qualify so the band draws across only those columns.
  const colIsCurrentWeek = useMemo(
    () => Array.from({ length: gridCols }).map((_, i) => {
      const c = columns[i];
      return c ? isCurrentWeekExp(c.expiration) : false;
    }),
    [columns, gridCols],
  );
  const anyCurrentWeek = colIsCurrentWeek.some(Boolean);

  const autoPercentNote = autoDisplayPercent !== displayPercent ? `Auto ${autoDisplayPercent}%` : null;

  // ── Stat bar figures ───────────────────────────────────────────────────────
  // Everything the TOTAL row prints, computed once over the VISIBLE strike
  // window and honouring the focus selection (empty selection = whole chain):
  //   total     — every rendered expiration, 0DTE included
  //   totalEx0  — the ⅀ Total column's rule: 0DTE excluded
  //   cb        — per-expiry Core Bullseye (largest |value|) for the first 3
  //               columns, or the first 3 SELECTED columns
  // "0DTE" is relative to the SESSION being shown, not literally today, so a
  // replayed Tuesday excludes Tuesday's front expiry.
  const chainStats = useMemo(() => {
    const zeroDteOnly = !!replayFrame && replayScope === "0dte";
    const todayKey = replayFrame ? replayDate : etDateKey(etToday());
    const valueOf = (col: ExpColumn, s: number): number | null => {
      if (greekMode === "oi") {
        const snap = oiSnapshot.map.get(`${col.expiration}|${s}`);
        return snap ? oiSideChange(snap, s, nearestStrike) : null;
      }
      const cell = col.cells.get(s);
      if (!cell) return null;
      if (greekMode === "vol") return volSideValue(cell, s, nearestStrike);
      return cell[greekMode];
    };
    const strikes = visibleStrikes.filter((s): s is number => s != null);
    const rows = selStrikes.size > 0 ? strikes.filter(s => selStrikes.has(s)) : strikes;
    const cols = selExps.size > 0 ? columns.filter(c => selExps.has(c.expiration)) : columns;

    let total = 0, totalEx0 = 0;
    for (const col of cols) {
      // In replay's 0DTE scope the only column on screen IS 0DTE, so excluding
      // it would leave a permanent 0 beside a grid full of numbers.
      const isZero = !zeroDteOnly && col.expiration === todayKey;
      for (const s of rows) {
        const v = valueOf(col, s);
        if (v == null) continue;
        total += v;
        if (!isZero) totalEx0 += v;
      }
    }

    const cb = cols.slice(0, 3).map(col => {
      let k: number | null = null, v = 0;
      for (const s of rows) {
        const x = valueOf(col, s);
        if (x == null) continue;
        if (k == null || Math.abs(x) > Math.abs(v)) { k = s; v = x; }
      }
      return { expiration: col.expiration, strike: k, value: v };
    }).filter(c => c.strike != null);

    return { total, totalEx0, cb, zeroDteOnly };
  }, [columns, visibleStrikes, greekMode, nearestStrike, oiSnapshot, replayFrame, replayDate, replayScope, selExps, selStrikes]);

  // Day change against the prior session close. Null when there is no baseline.
  const spotPct = prevClose > 0 && spot > 0 ? ((spot - prevClose) / prevClose) * 100 : null;

  // Toolbar button styled to match the right-side SegGroup tiles (height 34,
  // radius 8, fontSize 11–12, weight 700) so GO + Recent line up with them.
  const segBtnStyle = (on: boolean): React.CSSProperties => ({
    height: 34,
    padding: "0 14px",
    fontSize: 12,
    fontWeight: 700,
    border: on ? `1px solid ${rgba(HT.cyan, 0.35)}` : "1px solid rgba(255,255,255,0.06)",
    borderRadius: 8,
    background: on ? `linear-gradient(180deg,${rgba(HT.cyan, 0.18)},${rgba(HT.cyan, 0.05)})` : "rgba(255,255,255,0.04)",
    color: on ? HT.cyan : HT.text,
    cursor: "pointer",
    outline: "none",
    whiteSpace: "nowrap",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    boxSizing: "border-box",
  });

  return (
    <div
      ref={pageRef}
      style={{
        ...homeShellStyle,
        height: "100%",
        overflow: "hidden",
      }}
    >
      <style>{`@keyframes mvcGlow{0%,100%{box-shadow:0 0 3px rgba(255,179,0,.35)}50%{box-shadow:0 0 10px rgba(255,179,0,.9)}}.mvc-peak-cell{animation:mvcGlow 2.4s ease-in-out infinite}.mvc-peak-left{clip-path:inset(-12px 0 -12px -12px)}.mvc-peak-right{clip-path:inset(-12px -12px -12px 0)}`}</style>
      {loadProgress > 0 && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: HT.bg, zIndex: 10 }}>
          <div style={{ height: "100%", width: `${loadProgress}%`, background: HT.cyan, transition: "width 0.3s ease" }} />
        </div>
      )}
      {/* Toolbar pinned at the top — ALWAYS visible (never scrolls away). The
          grid scrolls below it in its own container, keeping its expiry-date
          header row stuck to the top of that scroll area. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "3px 10px 4px", flexShrink: 0, position: "sticky", top: 0, zIndex: 60, minWidth: 0, background: "#05060A", borderBottom: `1px solid ${HT.border}` }}>
      {/* data-capture-hide drops the control dock from snapshots (ticker picker,
          strike %, GO, REPLAY, intensity, the greek tabs, the snap button
          itself). Only the Dock is tagged, not its wrapper — the wrapper also
          holds the TOTAL NET GEX row, which belongs in the image. */}
      <Dock captureHide className="dock-noscroll" flat fullWidth style={{ width: "100%", flexWrap: "nowrap", overflowX: "auto", scrollbarWidth: "none" }}>
        {/* Identity on the left, actions on the right, one cog holding every
            setting — same shape as /home's toolbars. The TOTAL stat row below
            this dock is deliberately NOT folded in: the dock is captureHide and
            those figures belong in the screenshot. */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: HT.cyan, letterSpacing: "0.14em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            Options Chain
          </span>
          <span style={{ fontSize: 13, fontWeight: 800, color: HT.cyan, letterSpacing: "0.06em", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{activeTicker}</span>
          {/* The three facts the folded-away controls used to spell out. */}
          <span style={{ fontSize: 10, fontWeight: 800, color: HT.text, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
            {greekMode.toUpperCase()} · {DATA_MODE_LABEL[dataMode]} · {displayPercent}%
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: replayFrame ? HT.orange : HT.green }} />
            <span style={{ fontSize: 10, color: replayFrame ? HT.orange : HT.green, fontWeight: 800, letterSpacing: "0.08em" }}>
              {replayFrame ? "REPLAY" : "LIVE"}
            </span>
          </div>
        </div>

        {/* Ticker selection is its OWN toolbar control, not a cog setting.
            Which ticker the chain is showing is the single most-changed thing
            on this page — burying it a click deep in the settings menu made
            every switch a two-click trip. GO + Recent ride with it so the whole
            ticker act stays in one place on the bar. Hidden when the chain is
            embedded with a fixed ticker (externalTicker). */}
        {externalTicker == null && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <TickerListDropdown activeTicker={activeTicker} onSelect={selectTicker} />
            <button
              onClick={doGo}
              disabled={!tickerInput}
              style={{ ...segBtnStyle(false), opacity: tickerInput ? 1 : 0.45, cursor: tickerInput ? "pointer" : "not-allowed" }}
            >
              GO
            </button>
            {recentTickers.length > 0 && (
              <CustomDropdown
                value={activeTicker}
                options={recentTickers as string[]}
                onChange={(t) => selectTicker(t as string)}
                triggerLabel="Recent"
                accentCyan={false}
              />
            )}
          </div>
        )}

        {/* Refresh is an ACTION, not a setting — it stands on its own next to
            the ticker control rather than hiding a click deep in the cog. */}
        <button onClick={trigger} style={{ ...homeButtonStyle, flexShrink: 0 }}>{refreshLabel}</button>

        {/* A rewound grid shared without a timestamp is just a wrong chain, so
            the replay clock goes in the title and the Discord message too. */}
        <BoxSnapBtn targetRef={pageRef} title={replayTitle} />
        <BoxDiscordBtn
          targetRef={pageRef}
          title={replayTitle}
          message={replayFrame
            ? `⏪ Options Chain REPLAY — ${activeTicker} · ${replayDate} ${fmtReplayClock(replayFrame.ts)} ET`
            : `📊 Options Chain — ${activeTicker} ${selectedExpiry}`}
        />

        {/* ACCORDION — labelled sections that unfold in place, each header
            answering its own question so a shut row still says what the grid is
            set to. Ticker is NOT in here; it moved onto the toolbar itself.
            See DockCogMenu's `sections`. */}
        <DockCogMenu
          title="Options chain"
          buttonTitle="Options chain settings"
          width={340}
          /* Tall enough for the Grid tab with the Greek strip on two rows —
             see the `wrap` on that SegGroup. */
          paneHeight={236}
          sections={[
            {
              id: "grid",
              label: "Grid",
              summary: `${displayPercent}% · ${greekMode.toUpperCase()}`,
              body: (
                <>
                  <DockField label="Strikes">
                    <CustomDropdown
                      value={displayPercent}
                      options={DISPLAY_PERCENTS}
                      onChange={setDisplayPercent}
                      formatLabel={v => `${v}% strikes`}
                    />
                  </DockField>
                  {/* Pinned to GEX while replaying — see the replay-pin effect.
                      Rendered inert rather than hidden so the tabs don't vanish
                      and reappear. */}
                  <DockField label="Greek">
                    <div
                      style={{ opacity: replayOn ? 0.4 : 1, pointerEvents: replayOn ? "none" : undefined }}
                      title={replayOn ? "GEX only in replay — DEX/CHEX/VEX/OI/VOL are not recorded" : undefined}
                    >
                      {/* SIX tiles in a ~316px pane: without `wrap` the last
                          one (VOL) ran under the panel's right edge, which is
                          `overflowX: hidden`, so the mode was unclickable. */}
                      <SegGroup
                        wrap
                        options={GREEK_MODES.map(m => ({ label: m.toUpperCase(), value: m }))}
                        active={greekMode}
                        onChange={(v) => setGreekMode(v as GreekMode)}
                      />
                    </div>
                  </DockField>
                  {/* OI+Vol / Vol Only stays live in replay — strike_growth
                      records BOTH bases (gex_now+gex_open vs gex_now), so the
                      toggle means the same thing rewound as it does live. */}
                  <DockField label="Basis">
                    <SegGroup
                      wrap
                      options={DATA_MODES.filter(m => m !== "flow").map(m => ({ label: DATA_MODE_LABEL[m], value: m }))}
                      active={dataMode}
                      onChange={(v) => setDataMode(v as DataMode)}
                    />
                  </DockField>
                </>
              ),
            },
            {
              id: "heat",
              label: "Heat",
              summary: `${HEAT_SKINS[heatSkin].label.toLowerCase()} · ${intensity <= INTENSITY_MIN.chain ? "levels" : `${intensity.toFixed(2)}x`}`,
              body: (
                <>
                  <DockField label="Intensity" hint="Heat intensity. At the minimum stop the gamma wash switches off and only CB / CW / PW stay marked.">
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="range" min={0.5} max={intensityMax} step={0.01}
                        value={intensity}
                        onChange={(event) => setIntensity(Number(event.target.value))}
                        style={{ width: 110, height: 3, accentColor: "#219EBC" }}
                      />
                      <span style={{ fontSize: 10, color: "#219EBC", fontWeight: 700, minWidth: 44, fontFamily: "var(--font-mono)" }}>
                        {intensity <= INTENSITY_MIN.chain ? "LEVELS" : `${intensity.toFixed(2)}x`}
                      </span>
                    </div>
                  </DockField>
                  {/* Skin — how the cell is PAINTED, not what it says. Same
                      values, same ranks, same walls either way, and the same two
                      skins the Multi Greek ladder wears. */}
                  <DockField label="Skin">
                    <SegGroup
                      options={[
                        { label: "CLASSIC", value: "classic" },
                        { label: "VIVID", value: "vivid" },
                      ]}
                      active={heatSkin}
                      onChange={(v) => changeHeatSkin(v as HeatSkin)}
                    />
                  </DockField>
                </>
              ),
            },
            {
              id: "stamps",
              label: "Stamps",
              summary: showDelta15 && !replayOn && greekMode === "gex" ? "Δ15m" : "off",
              body: (
                /* Front-expiry (0DTE / nearest) 15-minute NET GEX stickers.
                   Inert while replaying and off the GEX tab — the recorder's
                   baselines are live net-GEX only, so there is nothing for it
                   to diff there. */
                <button
                  onClick={() => setShowDelta15(v => !v)}
                  disabled={replayOn || greekMode !== "gex"}
                  style={{
                    ...segBtnStyle(showDelta15 && !replayOn && greekMode === "gex"),
                    opacity: replayOn || greekMode !== "gex" ? 0.4 : 1,
                    cursor: replayOn || greekMode !== "gex" ? "default" : "pointer",
                  }}
                  title={
                    replayOn ? "Δ15m stickers are live-only — not available in replay"
                    : greekMode !== "gex" ? "Δ15m stickers are GEX-only"
                    : "Stamp each front-expiry cell with its 15-minute net-GEX change (top 5 strikes per side of ATM)"
                  }
                >
                  Δ15m
                </button>
              ),
            },
            /* Standalone only. An embedded chain (the /new-home tile) is a live
               glance at a fixed ticker — handing it a session scrubber would let
               a tile on a live dashboard quietly show yesterday. */
            ...(isStandalone ? [{
              id: "replay",
              label: "Replay",
              summary: replayOn ? "running" : undefined,
              body: (
                <button
                  onClick={() => setReplayOn((v) => !v)}
                  style={segBtnStyle(replayOn)}
                  title="Rewind the grid itself through the session's recorded net-GEX snapshots"
                >
                  {replayOn ? "■ Exit Replay" : "▶ Replay"}
                </button>
              ),
            }] : []),
          ]}
        />
      </Dock>
      {/* ── Row 2 — the TOTAL row, now a stat bar ─────────────────────────────
          Spot · Total Net {greek} · the same total ex-0DTE · the weekly EM
          band · the Core Bullseye of each of the first three expirations.
          Every figure honours the focus selection, so clicking expiries or
          strikes in the grid re-reads this whole row. */}
      {showGrandTotal && (() => {
        const fmtTot = (v: number) =>
          greekMode === "oi" ? fmtChg(v) : greekMode === "vol" ? fmtCount(v) : fmtMoney(v);
        const label = greekMode === "oi" ? "ΔOI" : `Net ${greekMode.toUpperCase()}`;
        const kStyle: React.CSSProperties = {
          fontSize: 8.5, fontWeight: 800, letterSpacing: "0.12em",
          textTransform: "uppercase", color: HT.text,
        };
        const vStyle: React.CSSProperties = {
          fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 13, lineHeight: 1.15,
        };
        const subStyle: React.CSSProperties = {
          fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 9, color: HT.text,
        };
        // Top-aligned, not centered: tiles carry different numbers of lines
        // (some have a sub-line, some don't) and centering each one puts their
        // titles on different rows. Aligning to the top lands every title on
        // one line across the bar.
        const cellStyle: React.CSSProperties = {
          display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 1,
          padding: "5px 12px", whiteSpace: "nowrap", flex: "0 0 auto",
          borderRight: "1px solid rgba(255,255,255,0.06)",
        };
        // EM band edges print like price levels, not money.
        const fmtLvl = (v: number) =>
          v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        return (
          <div style={{
            display: "flex", alignItems: "stretch", padding: "0 2px",
            overflowX: "auto", scrollbarWidth: "none", minWidth: 0,
          }}>
            {/* Spot + day % */}
            <div style={cellStyle}>
              <span style={kStyle}>Spot</span>
              <span style={{ ...vStyle, color: HT.cyan }}>
                {spot > 0 ? spot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                {spotPct != null && (
                  <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 4, color: spotPct >= 0 ? HT.green : HT.red }}>
                    {spotPct >= 0 ? "+" : ""}{spotPct.toFixed(2)}%
                  </span>
                )}
              </span>
            </div>

            {/* Total (every expiration, 0DTE included) */}
            <div style={{ ...cellStyle, background: `linear-gradient(180deg,${rgba(HT.cyan, 0.10)},${rgba(HT.cyan, 0.02)})` }}>
              <span style={kStyle}>{`Total ${label}`}</span>
              <span style={{ ...vStyle, color: chainStats.total >= 0 ? HT.green : HT.red }}>
                {fmtTot(chainStats.total)}
              </span>
            </div>

            {/* Same total with the session's 0DTE column dropped — the figure
                the ⅀ Total column adds up. In replay's 0DTE scope there is no
                "ex-0DTE" set to speak of, so the tile is dropped rather than
                printing the same number twice under a contradictory label. */}
            {!chainStats.zeroDteOnly && (
              <div style={cellStyle}>
                <span style={kStyle}>{`${label} ex-0DTE`}</span>
                <span style={{ ...vStyle, color: chainStats.totalEx0 >= 0 ? HT.green : HT.red }}>
                  {fmtTot(chainStats.totalEx0)}
                </span>
                <span style={subStyle}>⅀ Total column</span>
              </div>
            )}

            {/* Weekly EM — the move, then the down / up levels it lands on. */}
            <div style={cellStyle}>
              <span style={kStyle}>Weekly EM</span>
              <span style={{ ...vStyle, color: emLevels ? HT.orange : HT.muted }}>
                {emLevels ? `±${emLevels.em.toFixed(2)}` : "—"}
              </span>
              {emLevels && (
                <span style={subStyle}>
                  {fmtLvl(emLevels.close - emLevels.em)} · {fmtLvl(emLevels.close + emLevels.em)}
                </span>
              )}
            </div>

            {/* Core Bullseye of each of the first three expirations, expiry
                directly under its own strike. */}
            {chainStats.cb.length > 0 && (
              <div style={cellStyle}>
                <span style={kStyle}>CB · 1st 3 exp</span>
                <span style={{ display: "flex", alignItems: "flex-start" }}>
                  {chainStats.cb.map((c, i) => (
                    <span key={c.expiration} style={{ display: "flex", alignItems: "flex-start" }}>
                      {i > 0 && <span style={{ ...vStyle, color: HT.text, margin: "0 6px" }}>·</span>}
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.15 }}>
                        <span style={{ ...vStyle, color: c.value >= 0 ? HT.green : HT.red }}>
                          {c.strike!.toLocaleString("en-US")}
                        </span>
                        <span style={subStyle}>{fmtExpHeader(c.expiration)}</span>
                      </span>
                    </span>
                  ))}
                </span>
              </div>
            )}

            <span style={{ flex: "1 1 auto" }} />

            {/* Focus readout — also the way out of a selection. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", fontSize: 10, color: HT.text, whiteSpace: "nowrap", flex: "0 0 auto" }}>
              {hasSel && (
                <button
                  onClick={clearSel}
                  title="Clear the focus selection"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6, height: 20, padding: "0 8px",
                    borderRadius: 999, cursor: "pointer",
                    border: `1px solid ${rgba(HT.cyan, 0.5)}`, background: rgba(HT.cyan, 0.14),
                    color: HT.cyan, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em",
                  }}
                >
                  FOCUS: {[
                    selExps.size ? `${selExps.size} exp` : null,
                    selStrikes.size ? `${selStrikes.size} strike${selStrikes.size > 1 ? "s" : ""}` : null,
                  ].filter(Boolean).join(" + ")} ✕
                </button>
              )}
              <span style={{ opacity: 0.75 }}>
                {activeTicker} · {replayFrame ? "all recorded strikes" : `${displayPercent}% strikes${autoPercentNote ? ` · ${autoPercentNote}` : ""}`}
              </span>
              {/* OI tab provenance. The Δ column is only meaningful once TWO
                  daily snapshots exist, so say plainly which two days are being
                  compared — and say so just as plainly when there is no
                  baseline yet, rather than letting a column of "—" look like a
                  bug. */}
              {greekMode === "oi" && (
                <>
                  <span style={{ color: HT.border }}>·</span>
                  <span style={{ color: oiSnapshot.prevDate ? HT.cyan : HT.muted, opacity: 0.9 }}>
                    {oiSnapshot.prevDate
                      ? `ΔOI ${oiSnapshot.date} vs ${oiSnapshot.prevDate}`
                      : oiSnapshot.date
                        ? `OI ${oiSnapshot.date} · no prior snapshot yet`
                        : "OI snapshot not recorded for this ticker"}
                  </span>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Row 3 — replay transport ────────────────────────────────────────
          Deliberately NOT inside the captureHide Dock: a screen-grab of a
          rewound grid that doesn't say WHEN it is reads as a live chain, which
          is the single worst way this feature can be misunderstood. The clock,
          the session date and the recorded spot travel with the image. */}
      {replayOn && isStandalone && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "5px 8px", borderRadius: 8,
          border: `1px solid ${rgba(HT.orange, 0.35)}`,
          background: `linear-gradient(180deg,${rgba(HT.orange, 0.12)},${rgba(HT.orange, 0.03)})`,
          fontSize: 11, whiteSpace: "nowrap",
        }}>
          <span style={{ fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: HT.orange }}>
            Replay
          </span>

          {replayDates.length > 0 && (
            <CustomDropdown
              value={replayDate}
              options={replayDates}
              onChange={(d) => setReplayDate(String(d))}
              accentCyan={false}
            />
          )}

          {/* ── Expiry scope ────────────────────────────────────────────────
              0DTE collapses the grid to the session's front/same-day expiry;
              All expands it back to every recorded expiry + the ⅀ Total column.
              Frame index is untouched by the switch — the clock you are parked
              on is the thing being examined, and losing it to change what is
              summed would be the wrong trade. */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 10, color: HT.muted, fontWeight: 700 }}>Exp</span>
            {REPLAY_SCOPES.map((sc) => (
              <button
                key={sc}
                onClick={() => setReplayScope(sc)}
                disabled={sc === "0dte" && !replayZeroDteExp}
                style={{
                  ...segBtnStyle(replayScope === sc),
                  height: 24, padding: "0 9px", fontSize: 10, textTransform: "none",
                  opacity: sc === "0dte" && !replayZeroDteExp ? 0.4 : 1,
                }}
                title={sc === "0dte"
                  ? (replayZeroDteExp
                      ? `Show only ${replayZeroDteExp}${replayZeroDteIsExact ? " (expires this session)" : " — front recorded expiry; this root had no same-day listing"}`
                      : "No expiry recorded for this session")
                  : `Show all ${replayAllExpiries.length} recorded expiries, with the ⅀ Total column (0DTE excluded from Total, as on the live chain)`}
              >
                {REPLAY_SCOPE_LABEL[sc]}
              </button>
            ))}
          </div>

          <button
            onClick={() => { setReplayPlaying(false); setReplayIdx((i) => Math.max(0, i - 1)); }}
            disabled={!replayFrames.length || replayIdx <= 0}
            style={{ ...segBtnStyle(false), height: 26, padding: "0 8px", opacity: replayIdx > 0 ? 1 : 0.4 }}
            title="Previous snapshot"
          >
            ◀
          </button>
          <button
            onClick={() => {
              // Replaying from the end would show one frame and stop, which
              // reads as broken — rewind to the start first.
              if (replayIdx >= replayFrames.length - 1) setReplayIdx(0);
              setReplayPlaying((p) => !p);
            }}
            disabled={replayFrames.length < 2}
            style={{ ...segBtnStyle(replayPlaying), height: 26, padding: "0 12px", opacity: replayFrames.length > 1 ? 1 : 0.4 }}
          >
            {replayPlaying ? "❚❚" : "▶"}
          </button>
          <button
            onClick={() => { setReplayPlaying(false); setReplayIdx((i) => Math.min(replayFrames.length - 1, i + 1)); }}
            disabled={!replayFrames.length || replayIdx >= replayFrames.length - 1}
            style={{ ...segBtnStyle(false), height: 26, padding: "0 8px", opacity: replayIdx < replayFrames.length - 1 ? 1 : 0.4 }}
            title="Next snapshot"
          >
            ▶
          </button>

          <input
            type="range"
            min={0}
            max={Math.max(0, replayFrames.length - 1)}
            value={Math.min(replayIdx, Math.max(0, replayFrames.length - 1))}
            disabled={!replayFrames.length}
            onChange={(e) => { setReplayPlaying(false); setReplayIdx(Number(e.target.value)); }}
            style={{ flex: 1, minWidth: 160, height: 3, accentColor: HT.orange }}
          />

          <span style={{ fontSize: 10, color: HT.muted, fontWeight: 700 }}>Speed</span>
          {REPLAY_SPEEDS.map((sp) => (
            <button
              key={sp}
              onClick={() => setReplaySpeed(sp)}
              style={{
                ...segBtnStyle(replaySpeed === sp),
                height: 24, padding: "0 7px", fontSize: 10, textTransform: "none",
              }}
            >
              {sp}×
            </button>
          ))}

          <span style={{ color: HT.border }}>|</span>

          {/* The frame's own clock + the spot recorded at that clock. */}
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, color: HT.text }}>
            {replayFrame ? `${fmtReplayClock(replayFrame.ts)} ET` : "--:--:--"}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", color: HT.muted }}>
            spot {replayFrame && replayFrame.spot > 0 ? replayFrame.spot.toFixed(2) : "—"}
          </span>
          <span style={{ color: HT.muted, opacity: 0.75 }}>
            {replayFrames.length ? `frame ${Math.min(replayIdx, replayFrames.length - 1) + 1} / ${replayFrames.length}` : ""}
          </span>

          {/* Coverage, said out loud. The grid looks like the live chain, so
              without this a missing strike reads as "no gamma there" instead of
              "the recorder never stored that strike." */}
          {/* Coverage, said out loud — twice over. The axis is the SESSION's,
              so a row can be blank simply because this sweep didn't record that
              strike; without the second figure a half-empty ladder reads as "no
              gamma there" rather than "not recorded at this moment". */}
          {replayFrame && (
            <span style={{ color: HT.muted, opacity: 0.7 }}>
              · recorded walls only ·{" "}
              {replayScope === "0dte"
                ? `${replayZeroDteExp}${replayZeroDteIsExact ? "" : " (front — no same-day listing)"} of ${replayAllExpiries.length} recorded`
                : `${replayAxis.expiries.length} expir${replayAxis.expiries.length === 1 ? "y" : "ies"}`}
              {" · "}
              {/* Cells present / cells the SCOPED axis could hold — so the
                  denominator shrinks with the scope instead of implying the
                  0DTE view is missing the other expiries' cells. */}
              {(() => {
                const shown = replayScope === "0dte" && replayZeroDteExp
                  ? [...replayFrame.cells.keys()].filter((k) => k.slice(0, k.indexOf("|")) === replayZeroDteExp).length
                  : replayFrame.cells.size;
                return `${shown}/${replayAxis.strikes.length * Math.max(1, replayAxis.expiries.length)}`;
              })()} cells this frame · GEX only
            </span>
          )}
          {replayLoading && <span style={{ color: HT.cyan }}>· loading…</span>}
          {!replayLoading && replayErr && <span style={{ color: HT.red }}>· {replayErr}</span>}

          <div style={{ flex: 1 }} />

          <button
            onClick={() => setReplayOpen(true)}
            style={{ ...segBtnStyle(false), height: 26, padding: "0 10px", fontSize: 10 }}
            title="Open the single-ladder replay view"
          >
            ⛶ Ladder
          </button>
        </div>
      )}
      </div>

      {replayOn && isStandalone && !replayFrame ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#4a6a88" }}>
          <div style={{ textAlign: "center", maxWidth: 460 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: HT.orange }}>
              {replayLoading ? "Loading recorded session…" : `Nothing recorded to replay for ${activeTicker}`}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              {replayLoading
                ? `${activeTicker} · ${replayDate}`
                : (replayErr || "No snapshots for this ticker yet.") +
                  " The recorder keeps roughly five trading days and only covers tickers on the scanner watchlist."}
            </div>
          </div>
        </div>
      ) : !visibleStrikes.length ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#4a6a88" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
              {chainError ? "No Live Chain Data" : "Select ticker, expiry & % strikes"}
            </div>
            <div style={{ fontSize: 12 }}>
              {chainError ?? "Then click GO to load chain"}
            </div>
          </div>
        </div>
      ) : (
        /* ── Carded columns: each expiry is its own cyan dock card (Strike + value
           inside), all sharing ONE outer scroll so rows stay strike-aligned. ── */
        <div ref={chainScrollRef} style={{
          flex: 1, overflow: "auto", minHeight: 0,
          // NO top padding. A sticky `top: 0` header inside a scroll container
          // with padding-top sticks to the CONTENT edge, not the padding edge —
          // leaving a band the height of that padding where rows scroll through
          // ABOVE the header and show behind it. The breathing room at rest is
          // now marginTop on the grid itself, which correctly scrolls away under
          // the header instead of holding open a permanent gap.
          padding: "0 10px 10px",
        }}>
          <ChainMatrix
            columns={columns}
            gridCols={gridCols}
            visibleStrikes={visibleStrikes}
            nearestStrike={nearestStrike}
            spot={spot}
            greekMode={greekMode}
            oiChangeMap={oiSnapshot.map}
            dataMode={dataMode}
            intensity={deferredIntensity}
            heatSkin={heatSkin}
            colScales={colScales}
            volMvcByCol={volMvcByCol}
            mvcByCol={mvcByCol}
            delta15={delta15}
            delta15Exp={frontExp}
            valueAt={valueAt}
            isStandalone={isStandalone}
            changeMode={changeMode}
            sessionDate={replayFrame ? replayDate : ""}
            showTotalCol={showTotalCol}
            layoutExpCols={layoutExpCols}
            changeMeta={changeMeta}
            changeMap={changeMap}
            changeScaleByExp={changeScaleByExp}
            emStrikes={emStrikes}
            anyCurrentWeek={anyCurrentWeek}
            emLevels={emLevels}
            activeTicker={activeTicker}
            atmRowRef={atmRowRef}
            selExps={selExps}
            selStrikes={selStrikes}
            onToggleExp={toggleExpSel}
            onToggleStrike={toggleStrikeSel}
            onCellClick={setContractPopup}
            onCellHover={onCellHover}
          />
        </div>
      )}

      {contractPopup && (
        <ContractFlowPopup
          strike={contractPopup.strike}
          expiration={contractPopup.expiration}
          onClose={() => setContractPopup(null)}
        />
      )}

      {(() => {
        if (!hoverCell) return null;
        const col = columns[hoverCell.colIdx];
        const cell = col?.cells.get(hoverCell.strike);
        if (!col || !cell) return null;
        const dodMatch = dodRows.find(
          (d) => d.strike === hoverCell.strike && (!d.expiry || d.expiry === col.expiration),
        );
        const dod = dodMatch
          ? { netYest: dodMatch.net_yest, netNow: dodMatch.net_now, delta: dodMatch.now_delta ?? dodMatch.delta }
          : null;
        return (
          <StrikeHoverCard
            ticker={activeTicker}
            strike={hoverCell.strike}
            expiration={col.expiration}
            cell={cell}
            dod={dod}
            x={hoverCell.x}
            y={hoverCell.y}
            onClose={() => setHoverCell(null)}
          />
        );
      })()}

      {replayOpen && (
        <ChainReplay symbol={activeTicker} onClose={() => setReplayOpen(false)} />
      )}
    </div>
  );
}
