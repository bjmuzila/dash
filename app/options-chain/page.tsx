"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ColorType, CrosshairMode, LineSeries, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi, LineData, UTCTimestamp } from "lightweight-charts";
import { BoxDiscordBtn, BoxSnapBtn } from "@/components/shared/DataBox";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { HOME_THEME as HT, homeShellStyle, homeButtonStyle } from "@/components/shared/homeTheme";
import { Dock, SegGroup } from "@/components/shared/DockToolbar";
import { ChainReplay } from "@/components/shared/ChainReplay";
import { useScannerTickers } from "@/lib/useScannerTickers";

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
          position: "fixed", left: rect.left, top: rect.top, zIndex: 9999,
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
const GREEK_MODES = ["gex", "dex", "chex", "vex", "oi"] as const;
type GreekMode = typeof GREEK_MODES[number];

const DATA_MODES = ["oi-vol", "vol-only", "flow"] as const;
type DataMode = typeof DATA_MODES[number];
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

// Per-strike, per-expiration greek values.
type GreekCell = {
  gex: number;
  dex: number;
  chex: number;
  vex: number;
  /**
   * Net open interest = callOI − putOI. Signed on purpose: it is what the OI
   * tab's heat scale, per-column totals and ⅀ Total column read through
   * valueAt(), so a call-heavy strike colors blue and a put-heavy one red,
   * exactly like the greeks. The two-line call/put breakdown the OI cell
   * actually displays comes from callOI/putOI below.
   */
  oi: number;
  /** Pure volume-only GEX (volume-weighted gamma), independent of dataMode. */
  volGex: number;
  /** Raw per-side book stats for the hover card. */
  callOI: number;
  putOI: number;
  callVol: number;
  putVol: number;
  /** Net premium traded per side = mark × volume × 100. */
  callPrem: number;
  putPrem: number;
};

// One expiration's column: its date + a strike→greek map.
type ExpColumn = {
  expiration: string;
  label: string;
  cells: Map<number, GreekCell>;
  underlying: number;
};

function etToday(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function etDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isHoliday(date: Date): boolean {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();

  // US market holidays (non-exhaustive, add more as needed)
  const holidays: Array<[number, number]> = [
    [1, 1],    // New Year's Day
    [7, 4],    // Independence Day
    [12, 25],  // Christmas
  ];

  // Check fixed holidays
  if (holidays.some(([m, d]) => month === m && day === d)) return true;

  // Observed holidays: a fixed holiday on Sat is observed the Fri before;
  // on Sun it's observed the Mon after. (e.g. Jul 4 2026 = Sat → Fri Jul 3.)
  const dow = date.getDay();
  if (dow === 5) { // Friday — is tomorrow (Sat) a fixed holiday?
    const sat = new Date(year, date.getMonth(), day + 1);
    if (holidays.some(([m, d]) => sat.getMonth() + 1 === m && sat.getDate() === d)) return true;
  }
  if (dow === 1) { // Monday — was yesterday (Sun) a fixed holiday?
    const sun = new Date(year, date.getMonth(), day - 1);
    if (holidays.some(([m, d]) => sun.getMonth() + 1 === m && sun.getDate() === d)) return true;
  }

  // MLK Day (3rd Monday in January)
  if (month === 1) {
    const firstDay = new Date(year, 0, 1).getDay();
    const mlkDay = 15 + ((8 - firstDay) % 7);
    if (day === mlkDay) return true;
  }

  // Presidents Day (3rd Monday in February)
  if (month === 2) {
    const firstDay = new Date(year, 1, 1).getDay();
    const presDay = 15 + ((8 - firstDay) % 7);
    if (day === presDay) return true;
  }

  // Memorial Day (last Monday in May)
  if (month === 5) {
    const lastDay = new Date(year, 5, 0).getDate();
    const lastMonday = lastDay - ((new Date(year, 4, lastDay).getDay() + 1) % 7);
    if (day === lastMonday) return true;
  }

  // Labor Day (1st Monday in September)
  if (month === 9) {
    const firstDay = new Date(year, 8, 1).getDay();
    const laborDay = 1 + ((8 - firstDay) % 7);
    if (day === laborDay) return true;
  }

  // Thanksgiving (4th Thursday in November)
  if (month === 11) {
    const firstDay = new Date(year, 10, 1).getDay();
    const thanksgiving = 22 + ((5 - firstDay) % 7);
    if (day === thanksgiving) return true;
  }

  return false;
}

function isTradingDay(date: Date): boolean {
  const dayOfWeek = date.getDay();
  // Skip weekends (0 = Sunday, 6 = Saturday)
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  // Skip holidays
  if (isHoliday(date)) return false;
  return true;
}

// True during the live RTH session (9:30–16:00 ET on a trading day). Per-strike
// volume only accumulates from real session prints, so it reads 0 from 9:00–9:30
// even though OI (settled overnight) is already populated. We poll the chain
// through the session so volume climbs as trades print instead of staying frozen
// at the stale 0 from the page's one-shot load.
function isSessionLive(): boolean {
  const et = etToday();
  if (!isTradingDay(et)) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// SPX-only extended feed: SPX keeps updating ~24/7 across the trading WEEK
// (Sunday 8pm ET → Friday 4pm ET), EXCEPT a daily 4–6pm ET maintenance window
// where nothing refreshes. Other tickers freeze outside RTH (isSessionLive).
// Used to gate the chain poll so SPX stays live after hours but equities don't.
function isSpxFeedLive(): boolean {
  const et = etToday();
  const dow = et.getDay();              // 0=Sun .. 6=Sat
  const mins = et.getHours() * 60 + et.getMinutes();
  // Daily maintenance break 16:00–18:00 ET — no updates any day.
  if (mins >= 16 * 60 && mins < 18 * 60) return false;
  // Saturday: closed all day.
  if (dow === 6) return false;
  // Sunday: only open from 20:00 ET onward (futures/Globex reopen).
  if (dow === 0) return mins >= 20 * 60;
  // Friday: closes at 16:00 ET (the 16:00 break above already blocks 16–18;
  // after 18:00 Fri it stays closed for the weekend).
  if (dow === 5) return mins < 16 * 60;
  // Mon–Thu: open all day except the 16–18 break handled above.
  return true;
}

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

function metricBg(value: number, maxValue: number, intensity: number, topValues: number[]) {
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

// Parse one expiration's chain payload into strike→greek cells.
// GEX/DEX/CHEX/VEX use the same formulas the single-expiry view used:
//   contracts = OI + volume (per side); GEX = (γc·cc − γp·pc)·S²·0.01·100, etc.
// When dataMode is "flow", the gex cell uses flowGEX from flowGexMap instead.
function parseExpiration(items: unknown[], expDate: string, spot: number, dataMode: DataMode = "oi-vol", flowGexMap: Map<number, number> = new Map()): Map<number, GreekCell> {
  const cells = new Map<number, GreekCell>();
  const target = (items as { "expiration-date"?: string; strikes?: unknown[] }[]).filter(
    i => String(i["expiration-date"] ?? "").slice(0, 10) === expDate.slice(0, 10),
  );
  const groups = target.length ? target : (items as { strikes?: unknown[] }[]);
  const S = spot > 0 ? spot : 0;

  groups.forEach(group => {
    (group.strikes || []).forEach((item: unknown) => {
      const it = item as Record<string, unknown>;
      const strike = parseFloat(String(it["strike-price"] || 0));
      if (!strike) return;

      const c = it.call as Record<string, unknown> | undefined;
      const p = it.put as Record<string, unknown> | undefined;
      const num = (o: Record<string, unknown> | undefined, k: string) =>
        o ? parseFloat(String(o[k])) || 0 : 0;
      const cnt = (o: Record<string, unknown> | undefined) =>
        o ? (dataMode === "vol-only" ? 0 : (parseInt(String(o["open-interest"] ?? o.openInterest ?? 0), 10) || 0)) +
            (parseInt(String(o.volume ?? 0), 10) || 0)
          : 0;

      const cc = cnt(c);
      const pc = cnt(p);
      const live = cc > 0 || pc > 0;

      // Volume-only GEX — always computed from raw call/put volume regardless of
      // dataMode, so the OI+Vol view can flag the biggest pure-volume gamma peak.
      const cVol = c ? (parseInt(String(c.volume ?? 0), 10) || 0) : 0;
      const pVol = p ? (parseInt(String(p.volume ?? 0), 10) || 0) : 0;
      const volGexValue = (cVol > 0 || pVol > 0)
        ? (num(c, "gamma") * cVol - num(p, "gamma") * pVol) * S * S * 0.01 * 100
        : 0;

      // Raw per-side book stats for the hover card. OI is always the settled
      // open interest (independent of the Vol-only toggle, which only affects
      // the GEX basis). Mark falls back through bid/ask mid → last → close.
      const cOI = c ? (parseInt(String(c["open-interest"] ?? c.openInterest ?? 0), 10) || 0) : 0;
      const pOI = p ? (parseInt(String(p["open-interest"] ?? p.openInterest ?? 0), 10) || 0) : 0;
      const markOf = (o: Record<string, unknown> | undefined) => {
        if (!o) return 0;
        const m = num(o, "mark") || num(o, "mark-price");
        if (m > 0) return m;
        const b = num(o, "bid") || num(o, "bid-price");
        const a = num(o, "ask") || num(o, "ask-price");
        if (b > 0 || a > 0) return (b + a) / 2;
        return num(o, "last") || num(o, "last-price") || num(o, "close") || num(o, "price") || num(o, "mid");
      };
      const callPremValue = markOf(c) * cVol * 100;
      const putPremValue = markOf(p) * pVol * 100;

      let gexValue = 0;
      if (dataMode === "flow") {
        gexValue = flowGexMap.get(strike) ?? 0;
      } else {
        gexValue = live ? (num(c, "gamma") * cc - num(p, "gamma") * pc) * S * S * 0.01 * 100 : 0;
      }

      cells.set(strike, {
        gex:  gexValue,
        dex:  live ? (Math.abs(num(c, "delta")) * cc - Math.abs(num(p, "delta")) * pc) * S * 100 : 0,
        chex: live ? (-num(c, "theta") * cc + num(p, "theta") * pc) * S * 100 : 0,
        vex:  live ? (num(c, "vega") * cc - num(p, "vega") * pc) * S * 100 : 0,
        // Net OI is always the settled book (cOI/pOI), never the Vol-only
        // basis — the OI tab is about positioning, so the "Vol Only" toggle
        // must not blank it out the way it zeroes the greeks' contract counts.
        oi: cOI - pOI,
        volGex: volGexValue,
        callOI: cOI, putOI: pOI,
        callVol: cVol, putVol: pVol,
        callPrem: callPremValue, putPrem: putPremValue,
      });
    });
  });

  return cells;
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
 * Which side of the book the OI tab shows at a given strike.
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
  colScales: { max: number; top3: number[] }[];
  volMvcByCol: (number | null)[];
  mvcByCol: (number | null)[];
  pinByCol: { above: number | null; below: number | null }[];
  valueAt: (col: ExpColumn, strike: number) => number | null;
  isStandalone: boolean;
  changeMode: ChangeMode;
  /**
   * The session the grid is showing: "" when live (0DTE = today), or the
   * replayed session's date. Only used to decide which column counts as 0DTE
   * and is therefore excluded from the ⅀ Total column.
   */
  sessionDate: string;
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
  onCellClick: (v: { strike: number; expiration: string }) => void;
  onCellHover: (v: { strike: number; colIdx: number; x: number; y: number } | null) => void;
}

// Split out + memoized so transient parent state (the load-progress bar, the
// last-update clock, Intensity-slider commits) never re-renders the ~560-cell
// matrix. It re-renders only when its own data props change — which, thanks to
// the parent's useMemo/useCallback, is exactly "when the chain data changed."
const ChainMatrix = memo(function ChainMatrix({
  columns, gridCols, visibleStrikes, nearestStrike, spot, greekMode, dataMode,
  intensity, colScales, volMvcByCol, mvcByCol, pinByCol, valueAt, isStandalone,
  changeMode, sessionDate, changeMeta, changeMap, changeScaleByExp, emStrikes, anyCurrentWeek,
  emLevels, activeTicker, atmRowRef, oiChangeMap, onCellClick, onCellHover,
}: ChainMatrixProps) {
  // OI is a contract count, not dollars — and on this tab every readout is a
  // CHANGE in that count, so it takes the signed compact formatter (+1.2K /
  // -430 / "·" for flat) rather than the dollar one.
  const isOiMode = greekMode === "oi";
  const fmtVal = isOiMode ? fmtChg : fmtMoney;
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
  // ⅀ Total column — per-strike sum across every rendered expiration EXCEPT
  // 0DTE (front expiry excluded on purpose; label stays plain "Total"), with
  // its own heat scale (over the visible strikes) so the biggest net totals pop.
  // "0DTE" means the expiry that equals the SESSION being shown, not literally
  // today — replaying Tuesday must exclude Tuesday's 0DTE, not Friday's.
  const todayKey = sessionDate || etDateKey(etToday());
  const rowTotals = new Map<number, number>();
  visibleStrikes.forEach((strike) => {
    if (strike == null) return;
    let sum = 0;
    renderIdx.forEach((colIdx) => {
      const col = columns[colIdx];
      if (!col || col.expiration === todayKey) return;
      // !isOiMode mirrors the per-cell guard below — the Δ columns carry
      // volume-GEX dollars, which must never be summed into an OI total.
      const isCh = !isOiMode && !isStandalone && changeMode !== "live" && changeMeta.hasData && changeMeta.expiries.has(col.expiration);
      const v = isCh ? (changeMap.get(`${col.expiration}|${strike}`) ?? null) : valueAt(col, strike);
      if (v != null) sum += v;
    });
    rowTotals.set(strike, sum);
  });
  const totalAbs = [...rowTotals.values()].map((v) => Math.abs(v)).filter((v) => v > 0).sort((a, b) => b - a);
  const totalScale = { max: totalAbs[0] ?? 1, top3: totalAbs.slice(0, 3) };
  const grandVisibleTotal = [...rowTotals.values()].reduce((a, b) => a + b, 0);
  return (
    <div style={{
      display: "grid",
      // OI cells can carry two lines (call / put) on the ATM pivot row, but each
      // line is now a single delta figure — so they need barely more width than
      // a greek cell, not the double-width the old value+delta pair demanded.
      gridTemplateColumns: `${STRIKE_COL}px repeat(${renderIdx.length}, minmax(${isOiMode ? 84 : 78}px, 1fr)) minmax(${isOiMode ? 92 : 88}px, 1.15fr)`,
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
        const isChangeCol = !isOiMode && !isStandalone && changeMode !== "live" && changeMeta.hasData && col != null &&
          changeMeta.expiries.has(col.expiration);
        const colTotal = col
          ? (isChangeCol
              ? visibleStrikes.reduce((s, k) => s + (k == null ? 0 : (changeMap.get(`${col.expiration}|${k}`) ?? 0)), 0)
              : visibleStrikes.reduce((s, k) => { const v = k == null ? null : valueAt(col, k); return s + (v ?? 0); }, 0))
          : null;
        return (
          <div key={`hdr-${col?.expiration ?? i}`} style={{ position: "sticky", top: 0, zIndex: 3, textAlign: "center", padding: "5px 6px", background: isChangeCol ? `linear-gradient(180deg, ${rgba(HT.orange, 0.18)} 0%, ${rgba(HT.orange, 0.05)} 100%), ${HDR_BG}` : `linear-gradient(180deg, ${rgba(HT.cyan, 0.14)} 0%, ${rgba(HT.cyan, 0.04)} 100%), ${HDR_BG}`, borderBottom: `1px solid ${HT.border}` }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: isChangeCol ? HT.orange : HT.text }}>{col ? fmtExpHeader(col.expiration) : "—"}{isChangeCol ? ` ·Δ${changeMode}` : ""}</div>
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
      <div style={{ position: "sticky", top: 0, zIndex: 3, textAlign: "center", padding: "5px 6px", background: `linear-gradient(180deg, ${rgba(HT.cyan, 0.24)} 0%, ${rgba(HT.cyan, 0.07)} 100%), ${HDR_BG}`, borderBottom: `1px solid ${HT.border}`, borderLeft: `2px solid ${rgba(HT.cyan, 0.45)}` }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: HT.cyan, letterSpacing: "0.04em" }}>Total</div>
        <div style={{ fontSize: 10, fontWeight: 800, fontFamily: "var(--font-mono)", color: grandVisibleTotal >= 0 ? HT.green : HT.red }}>
          {fmtVal(grandVisibleTotal)}
        </div>
      </div>

      {/* ── One row per shared strike ── */}
      {visibleStrikes.map((strike, rowIdx) => {
        // Padding row (chain ran out on this side of ATM): keep the row so
        // ATM stays centered, but render it empty.
        if (strike == null) {
          return (
            <div key={`pad-${rowIdx}`} style={{ display: "contents" }}>
              <div style={{ position: "sticky", left: 0, zIndex: 2, padding: "2px 8px", fontSize: 12, background: HDR_BG, borderRight: `1px solid ${HT.border}` }} />
              {renderIdx.map((i) => (
                <div key={`pad-${rowIdx}-${i}`} style={{ padding: "2px 8px", fontSize: 12 }} />
              ))}
              <div style={{ padding: "2px 8px", fontSize: 12, borderLeft: `2px solid ${rgba(HT.cyan, 0.25)}` }} />
            </div>
          );
        }
        const isATM = strike === nearestStrike;
        const isClose = anyCurrentWeek && emStrikes != null && strike === emStrikes.close;
        const is1x = anyCurrentWeek && emStrikes != null && (strike === emStrikes.d1 || strike === emStrikes.u1);
        const is2x = anyCurrentWeek && emStrikes != null && (strike === emStrikes.d2 || strike === emStrikes.u2);
        // All marker lines are DOTTED now. Close = brighter, EM bands dimmer.
        const rowEmBorder = isClose ? "2px dotted rgba(255,255,255,.95)"
          : is1x ? "2px dotted rgba(255,255,255,.85)"
          : is2x ? "2px dotted rgba(255,255,255,.7)"
          : undefined;
        // Small label + hover tooltip for the marked rows.
        let emTag: string | null = null, emTip = "";
        if (isATM) { emTag = "ATM"; emTip = `At-the-money — nearest strike to spot (${spot ? spot.toFixed(2) : "—"})`; }
        else if (isClose) { emTag = "CLOSE"; emTip = `Last week's close${emLevels ? ` (${emLevels.close})` : ""} — the EM band center`; }
        else if (is1x) {
          const up = emStrikes != null && strike === emStrikes.u1;
          emTag = up ? "+1σ" : "−1σ";
          emTip = `1× weekly expected move ${up ? "up" : "down"}${emLevels ? ` (close ${emLevels.close} ± ${emLevels.em})` : ""}`;
        } else if (is2x) {
          const up = emStrikes != null && strike === emStrikes.u2;
          emTag = up ? "+2σ" : "−2σ";
          emTip = `2× weekly expected move ${up ? "up" : "down"}${emLevels ? ` (close ${emLevels.close} ± ${2 * emLevels.em})` : ""}`;
        }
        return (
          <div key={strike} style={{ display: "contents" }}>
            {/* Shared strike label (sticky left) */}
            <div ref={isATM ? atmRowRef : undefined} title={emTip || undefined} style={{
              position: "sticky", left: 0, zIndex: 2,
              padding: "2px 5px", fontSize: 10, fontFamily: "var(--font-mono)", textAlign: "right",
              // ATM reads like the /home GEX heatmap: no amber fill, blue strike
              // text with a blue "ATM" tag beside it, inside the white rule.
              color: isATM ? HT.cyan : "#e4e4e7",
              fontWeight: isATM ? 700 : 400,
              background: HDR_BG,
              borderRight: `1px solid ${HT.border}`,
              borderTop: isATM ? "2px solid #ffffff" : rowEmBorder,
              borderBottom: isATM ? "2px solid #ffffff" : undefined,
              display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3,
              cursor: emTag ? "help" : undefined,
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
              // The 15/30/60m Δ columns carry volume-GEX deltas. In OI mode
              // they would be a second, unrelated "change" fighting the cell's
              // own day-over-day ΔOI — so OI mode always reads live columns.
              const isChangeCol =
                !isOiMode && !isStandalone && changeMode !== "live" && changeMeta.hasData && col != null &&
                changeMeta.expiries.has(col.expiration);
              const chKey = isChangeCol ? `${col!.expiration}|${strike}` : "";
              const value = isChangeCol
                ? (changeMap.has(chKey) ? changeMap.get(chKey)! : null)
                : (col ? valueAt(col, strike) : null);
              const cellScale = isChangeCol
                ? (changeScaleByExp.get(col!.expiration) ?? { max: 1, top3: [] as number[] })
                : scale;
              const isMvc = !isChangeCol && greekMode === "gex" && col != null && mvcByCol[colIdx] === strike;
              // ❌ marks the pure-volume GEX peak — OI+Vol view + GEX mode only.
              const isVolMvc = !isChangeCol && greekMode === "gex" && dataMode === "oi-vol" && col != null && volMvcByCol[colIdx] === strike;
              const pin = pinByCol[colIdx];
              // Suppressed in OI mode — the pin glyph is a gamma-structure
              // marker, and its width breaks the two-line call/put layout.
              const isPin = !isOiMode && !isChangeCol && col != null && pin != null && (strike === pin.above || strike === pin.below);
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
              // Calls above ATM, puts below, both at the pivot.
              const sides = isOiMode ? oiSides(strike, nearestStrike) : { call: false, put: false };
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
              return (
                <div
                  key={`${strike}-${colIdx}`}
                  className={isMvc ? "mvc-peak-cell" : undefined}
                  onClick={isClickable ? (e) => onCellHover({ strike, colIdx, x: e.clientX, y: e.clientY }) : undefined}
                  title={isClickable ? "Click for volume / OI / net premium" : undefined}
                  style={{
                    padding: isOiMode ? "3px 6px" : "2px 8px", fontSize: 10, fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 400,
                    color: value == null ? "#3a4a5e" : SOFT_WHITE,
                    background: value != null ? metricBg(value, cellScale.max, intensity, cellScale.top3) : "transparent",
                    borderTop: rowEmBorder,
                    boxShadow: atmShadow,
                    whiteSpace: "nowrap", overflow: "hidden",
                    display: "flex", alignItems: isOiMode ? "center" : "baseline", justifyContent: "flex-end", gap: 5,
                    cursor: isClickable ? "pointer" : undefined,
                    ...(isMvc ? { outline: "2px solid #ffb300", outlineOffset: "-2px" } : {}),
                  }}
                >
                  {/* OI tab renders the day-over-day CHANGE only — one line
                      per side actually shown at this strike (two only on the
                      ATM pivot). Everything else about the cell — heat
                      background, ATM box, EM row border — is unchanged, and the
                      background now tracks that same change through valueAt(),
                      so the tint and the number always agree. */}
                  {isMvc && <span title="CB - Core Bullseye — highest |net GEX|" style={{ color: "#ffd600", textShadow: "0 0 3px rgba(0,0,0,.9)" }}>★</span>}
                  {isVolMvc && <span title="Highest volume GEX" style={{ fontSize: 10, lineHeight: 1 }}>❌</span>}
                  {isPin && (
                    <span title="Possible pin or explosive level" style={{ cursor: "help", display: "inline-flex", verticalAlign: "middle" }}>
                      <svg width="14" height="17" viewBox="0 0 24 24" fill="#ffffff" stroke="rgba(0,0,0,.55)" strokeWidth={1.5}>
                        <path d="M12 21s7-6.5 7-12A7 7 0 0 0 5 9c0 5.5 7 12 7 12z" />
                        <circle cx="12" cy="9" r="2.3" fill="rgba(0,0,0,.55)" stroke="none" />
                      </svg>
                    </span>
                  )}
                  {isOiMode ? (
                    !oiHasAny ? (
                      <span style={{ color: "#3a4a5e" }}>·</span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", width: "100%", lineHeight: 1.3, fontSize: 10 }}>
                        {sides.call && <OiChgLine label={oiBothSides ? "C" : null} chg={oiSnap?.callChg ?? null} />}
                        {sides.put && <OiChgLine label={oiBothSides ? "P" : null} chg={oiSnap?.putChg ?? null} />}
                      </div>
                    )
                  ) : (
                    <span><SignVal text={value == null ? "·" : fmtMoney(value)} /></span>
                  )}
                </div>
              );
            })}
            {/* ── ⅀ Total cell: this strike's sum across every expiration ── */}
            {(() => {
              const tot = rowTotals.get(strike) ?? 0;
              const atmTotShadow = isATM
                ? "inset 0 2px 0 #ffffff, inset 0 -2px 0 #ffffff, inset -2px 0 0 #ffffff"
                : undefined;
              return (
                <div style={{
                  padding: "2px 8px", fontSize: 10, fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 700,
                  color: tot === 0 ? "#3a4a5e" : "rgba(255,255,255,0.92)",
                  background: tot !== 0 ? metricBg(tot, totalScale.max, intensity, totalScale.top3) : "transparent",
                  borderLeft: `2px solid ${rgba(HT.cyan, 0.35)}`,
                  borderTop: rowEmBorder,
                  boxShadow: atmTotShadow,
                  whiteSpace: "nowrap", overflow: "hidden",
                  display: "flex", alignItems: "baseline", justifyContent: "flex-end",
                }}>
                  {/* OI mode drops SignVal's colored +/−: this cell can be a
                      full-strength red heat tile, and a red sign on it is the
                      unreadable case. White figure, direction from the tint. */}
                  {isOiMode
                    ? <span style={{ color: tot === 0 ? "#3a4a5e" : "rgba(255,255,255,0.96)", textShadow: tot === 0 ? undefined : "0 1px 2px rgba(0,0,0,0.85)" }}>
                        {tot === 0 ? "·" : fmtVal(tot)}
                      </span>
                    : <SignVal text={tot === 0 ? "·" : fmtVal(tot)} />}
                </div>
              );
            })()}
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
    const u = new URL(window.location.href);
    const sym = u.searchParams.get("symbol")?.trim().toUpperCase();
    const exp = u.searchParams.get("expiry")?.trim();
    if (sym) setTickerInput(sym);
    if (exp) setSelectedExpiry(exp);
  }, []);
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
  const [intensity, setIntensity] = useState(1.75);
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
  // ── In-grid replay mode ───────────────────────────────────────────────────
  // See the REPLAY_* block at the top of this file for what is and isn't
  // recorded. `replayOn` is the user's intent; `replayFrame` (derived below) is
  // whether there is actually a frame to render — the grid keys off the frame,
  // never off the intent, so turning replay on for a symbol with no recorded
  // history shows an explicit empty state instead of a silently blank chain.
  const [replayOn, setReplayOn] = useState(false);
  const [replayDates, setReplayDates] = useState<string[]>([]);
  const [replayDate, setReplayDate] = useState("");
  const [replayFrames, setReplayFrames] = useState<ReplayFrame[]>([]);
  const [replayIdx, setReplayIdx] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState<number>(1);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayErr, setReplayErr] = useState("");
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
          const res = await fetch(
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

  // Auto-load SPX on mount
  useEffect(() => {
    const defaultExpiry = selectedExpiry || expiries[0]?.value;
    if (defaultExpiry) {
      loadChain("SPX", defaultExpiry);
    }
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

  // ── The replay session's fixed axes ───────────────────────────────────────
  // Every strike and every expiry recorded in ANY frame of the loaded session,
  // computed once per session and used for every frame in it.
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
    const strikes = new Set<number>();
    const expiries = new Set<string>();
    for (const f of replayFrames) {
      for (const e of f.expiries) expiries.add(e);
      f.cells.forEach((_v, key) => {
        const strike = Number(key.slice(key.indexOf("|") + 1));
        if (Number.isFinite(strike)) strikes.add(strike);
      });
    }
    return {
      strikes: [...strikes].sort((a, b) => a - b),
      expiries: [...expiries].sort(),
    };
  }, [replayFrames]);

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
  const centerKey = `${activeTicker}|${replayFrame ? `replay:${replayDate}` : "live"}`;
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
  // Flagged with ❌ on the OI+Vol view so the pure-volume gamma peak shows up
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

  // Per-expiration 📍 pins: the highest |active-greek| strike on each side of spot,
  // for every column. Keyed colIdx → { above, below }.
  const pinByCol = useMemo(() => {
    return columns.map(col => {
      if (!col || !nearestStrike) return { above: null as number | null, below: null as number | null };
      let above: number | null = null, aAbs = 0, below: number | null = null, bAbs = 0;
      visibleStrikes.forEach(s => {
        if (s == null) return;
        const v = valueAt(col, s);
        if (v == null) return;
        const a = Math.abs(v);
        if (s > nearestStrike && a > aAbs) { aAbs = a; above = s; }
        else if (s < nearestStrike && a > bAbs) { bAbs = a; below = s; }
      });
      return { above, below };
    });
  }, [columns, visibleStrikes, nearestStrike, valueAt]);

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
  const replayTitle = replayFrame
    ? `Options Chain REPLAY — ${activeTicker}  •  ${replayDate} ${fmtReplayClock(replayFrame.ts)} ET  •  GEX  •  ${dataMode === "vol-only" ? "Vol only" : "OI+Vol"}`
    : snapTitle;

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

  // Grand total of the active greek across the VISIBLE strike window × every
  // non-0DTE expiration (matches the sum of the Total column — front expiry
  // excluded, label stays plain "Total Net {greek}"). Shown in the toolbar.
  const visibleTotal = useMemo(() => {
    // Same rule as the ⅀ Total column: 0DTE is relative to the session shown.
    const todayKey = replayFrame ? replayDate : etDateKey(etToday());
    let sum = 0;
    for (const col of columns) {
      if (col.expiration === todayKey) continue;
      for (const s of visibleStrikes) {
        if (s == null) continue;
        // OI tab totals the day-over-day CHANGE, matching the ⅀ Total column.
        if (greekMode === "oi") {
          const snap = oiSnapshot.map.get(`${col.expiration}|${s}`);
          if (snap) sum += oiSideChange(snap, s, nearestStrike);
          continue;
        }
        const cell = col.cells.get(s);
        if (!cell) continue;
        sum += cell[greekMode];
      }
    }
    return sum;
  }, [columns, visibleStrikes, greekMode, nearestStrike, oiSnapshot, replayFrame, replayDate]);

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
        <span style={{ fontSize: 12, fontWeight: 800, color: HT.cyan, letterSpacing: "0.14em", textTransform: "uppercase" }}>
          Options Chain
        </span>

        {externalTicker == null && (
          <>
            <span style={{ fontSize: 13, fontWeight: 800, color: HT.cyan, letterSpacing: "0.06em", fontFamily: "var(--font-mono)" }}>{activeTicker}</span>
            <TickerListDropdown activeTicker={activeTicker} onSelect={selectTicker} />
          </>
        )}

        <CustomDropdown
          value={displayPercent}
          options={DISPLAY_PERCENTS}
          onChange={setDisplayPercent}
          formatLabel={v => `${v}% strikes`}
        />

        {externalTicker == null && (
          <>
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
          </>
        )}

        {/* Standalone only. An embedded chain (the /new-home tile) is a live
            glance at a fixed ticker — handing it a session scrubber would let a
            tile on a live dashboard quietly show yesterday. */}
        {isStandalone && (
          <button
            onClick={() => setReplayOn((v) => !v)}
            style={segBtnStyle(replayOn)}
            title="Rewind the grid itself through the session's recorded net-GEX snapshots"
          >
            {replayOn ? "■ Exit Replay" : "▶ Replay"}
          </button>
        )}

        <div style={{ flex: 1 }} />

        <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Intensity</span>
        <input
          type="range" min={0.5} max={5} step={0.01}
          value={intensity}
          onChange={(event) => setIntensity(Number(event.target.value))}
          style={{ width: 80, height: 3, accentColor: "#219EBC" }}
        />
        <span style={{ fontSize: 10, color: "#219EBC", fontWeight: 700, minWidth: 36, fontFamily: "var(--font-mono)" }}>
          {intensity.toFixed(2)}x
        </span>

        <span style={{ color: HT.border }}>|</span>

        {/* OI+Vol / Vol Only stays live in replay — strike_growth records BOTH
            bases (gex_now+gex_open vs gex_now), so the toggle means the same
            thing rewound as it does live. */}
        <SegGroup
          options={DATA_MODES.filter(m => m !== "flow").map(m => ({ label: DATA_MODE_LABEL[m], value: m }))}
          active={dataMode}
          onChange={(v) => setDataMode(v as DataMode)}
        />

        <span style={{ color: HT.border }}>|</span>

        {/* Pinned to GEX while replaying — see the replay-pin effect. Rendered
            inert rather than hidden so the tabs don't vanish and reappear. */}
        <div
          style={{ opacity: replayOn ? 0.4 : 1, pointerEvents: replayOn ? "none" : undefined }}
          title={replayOn ? "GEX only in replay — DEX/CHEX/VEX/OI are not recorded" : undefined}
        >
          <SegGroup
            options={GREEK_MODES.map(m => ({ label: m.toUpperCase(), value: m }))}
            active={greekMode}
            onChange={(v) => setGreekMode(v as GreekMode)}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: replayFrame ? HT.orange : HT.green }} />
          <span style={{ fontSize: 10, color: replayFrame ? HT.orange : HT.green, fontWeight: 800, letterSpacing: "0.08em" }}>
            {replayFrame ? "REPLAY" : "LIVE"}
          </span>
        </div>

        <button onClick={trigger} style={{ ...homeButtonStyle }}>{refreshLabel}</button>
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
      </Dock>
      {/* Row 2 — total net GEX (active greek) across the visible window. */}
      {showGrandTotal && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 2px", fontSize: 11, whiteSpace: "nowrap" }}>
          <span style={{ fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: HT.muted }}>
            {greekMode === "oi" ? "Total ΔOI" : `Total Net ${greekMode.toUpperCase()}`}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 12, color: visibleTotal >= 0 ? HT.green : HT.red }}>
            {greekMode === "oi" ? fmtChg(visibleTotal) : fmtMoney(visibleTotal)}
          </span>
          <span style={{ color: HT.border }}>·</span>
          <span style={{ color: HT.muted, opacity: 0.75 }}>
            {activeTicker} · {replayFrame ? "all recorded strikes" : `${displayPercent}% strikes${autoPercentNote ? ` · ${autoPercentNote}` : ""}`}
          </span>
          {/* OI tab provenance. The Δ column is only meaningful once TWO daily
              snapshots exist, so say plainly which two days are being compared
              — and say so just as plainly when there is no baseline yet, rather
              than letting a column of "—" look like a bug. */}
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
      )}

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
              · recorded walls only · {replayAxis.expiries.length} expir{replayAxis.expiries.length === 1 ? "y" : "ies"} ·{" "}
              {replayFrame.cells.size}/{replayAxis.strikes.length * replayAxis.expiries.length} cells this frame · GEX only
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
            colScales={colScales}
            volMvcByCol={volMvcByCol}
            mvcByCol={mvcByCol}
            pinByCol={pinByCol}
            valueAt={valueAt}
            isStandalone={isStandalone}
            changeMode={changeMode}
            sessionDate={replayFrame ? replayDate : ""}
            changeMeta={changeMeta}
            changeMap={changeMap}
            changeScaleByExp={changeScaleByExp}
            emStrikes={emStrikes}
            anyCurrentWeek={anyCurrentWeek}
            emLevels={emLevels}
            activeTicker={activeTicker}
            atmRowRef={atmRowRef}
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
