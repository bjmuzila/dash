// ─────────────────────────────────────────────────────────────────────────────
// app/levels/page.tsx — /levels
//
// THE WHOLE SCANNER UNIVERSE AT ONCE, WITH FOUR PINNED LADDERS ON TOP.
//
// Two halves:
//
//   INDEX  — one cell per roster ticker: symbol, its Core Bullseye, the move vs
//            that core, and a bar showing where spot sits between the walls.
//            Twelve across on a wide screen (fewer as it narrows), so 169
//            tickers land in ~14 rows and the whole universe is visible with
//            barely a scroll.
//   DOCK   — four fixed slots at the top. Click a cell to pin that ticker as a
//            full price-scaled ladder; click again (or the ✕) to unpin. Pinning
//            a fifth drops the oldest. Pins survive a reload.
//
// This replaced a grid of 169 expandable cards. The cards were the layout, so
// the page was a wall of chrome and you had to open one to learn anything; now
// the board is the layout and the card is a detail view of the handful you are
// actually working.
//
// DATA. Multi Greek shows these levels for four tickers by pulling a full option
// chain per ticker in the browser. That does not scale to 169, so this page
// reads what the SERVER already computed —
//
//   GET /proxy/scanner?any=1   →  latest scanner_snapshots row per symbol:
//                                 spot, expiry, cb, call_wall, put_wall,
//                                 gex_flip, total_net_gex, plus `stale`.
//
// scanner-recorder.js sweeps that table every 5 minutes for exactly this roster,
// so one request paints the entire board. `any=1` means a weekend or pre-market
// load shows Friday's close rather than an empty page; those rows come back
// flagged `stale` and say so.
//
// LIVE SPOT. Levels step on the 5-minute sweep; the marker does not have to. A
// second poll (/api/tt-quotes, 5s, chunked) overlays a live last price, so the
// spot pill, the range bars and every SPOT-VS-CB readout move continuously
// between sweeps while the rails hold still.
//
// COLOUR. Nothing on this page changes colour because of where price is. Not the
// card, not the index cell. Both used to, and both read as noise: a surface that
// repaints as spot moves is weather, not information, and 169 of them at once is
// a light show. The only highlight on the board marks the four cells that are
// PINNED above — which is a question the user asked, not one the market did.
// Everywhere else, colour means WHICH LEVEL a thing is and never anything else:
// CB gold, CW blue, PW red, plus up/down green-red on the two deltas. Position
// still reads, from the range bar's marks rather than from a wash.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS PAGE SHIPS A <style> BLOCK INSTEAD OF PURE INLINE STYLE
//
// `@container` and `:hover`, neither of which an inline style can express. The
// card's band drops its pieces (expiry → put wall → call wall → the CB/CW/PW
// letters) as the CARD narrows rather than the window, so the same ladder fires
// whether a dock slot got narrow because the browser did or because a dock is
// four-up on a laptop.
//
// Nothing in that band may SHRINK — every element is `flex:0 0 auto` with
// `white-space:nowrap` and a flexible spacer eats the slack — so a value is
// either fully drawn or removed by the ladder. Half-drawn numbers are impossible
// by construction.
//
// Every colour in the CSS is interpolated from homeTheme / LEVEL_COLORS. There
// are no colour literals in this file; `alpha()` derives its rgba from a theme
// token and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  HOME_THEME,
  LEVEL_COLORS,
  LIGHT_BLUE,
  ES_CANDLE_UP,
  ES_CANDLE_DOWN,
  homeInputStyle,
  homeButtonStyle,
  homeSecondaryButtonStyle,
  homeRefreshButtonStyle,
  type RefreshState,
} from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { useScannerTickers } from "@/lib/useScannerTickers";
import { usePageLoadStatus } from "@/lib/pageStatus";

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Levels only change on the recorder's 5m sweep; polling faster buys nothing. */
const LEVELS_POLL_MS = 60_000;
/** Spot is the only thing that moves between sweeps. */
const QUOTES_POLL_MS = 5_000;
/** Symbols per /api/tt-quotes call — keeps the query string sane. */
const QUOTE_CHUNK = 40;
/** Rail height in px on a docked card. */
const RAIL_H = 140;
/** Dock slots. Four fits a laptop at a readable card width. */
const MAX_PINS = 4;
const PREFS_KEY = "cb-levels-prefs-v5";
/**
 * Pins live in localStorage, which is per browser PROFILE per machine — the same
 * scope as the density/sort prefs this page has always saved. A second computer
 * (or a second Chrome profile) starts empty. Moving them to the account would
 * mean a server-side prefs row; deliberately not done yet.
 */
const PINS_KEY = "cb-levels-pins-v1";

type SortId = "core" | "gex" | "az";
type LevelKey = "cb" | "cw" | "pw" | "flip";

type ScannerRow = {
  symbol: string;
  date: string;
  ts: string;
  spot: number | null;
  expiry: string | null;
  total_net_gex: number | null;
  call_wall: number | null;
  put_wall: number | null;
  gex_flip: number | null;
  cb: number | null;
  strikes: number | null;
  stale?: boolean;
};

// ── Formatting ───────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/** Strikes: index-scale names get no decimals, $40 stocks get two. */
const fmtLevel = (n: number) =>
  Math.abs(n) >= 1000
    ? n.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const fmtSpot = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtSigned = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

const fmtGex = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toFixed(0);
  return n >= 0 ? `+${s}` : s;
};

const etToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

/** Calendar days to expiry, which is how the desk says it. */
function dteOf(expiry: string | null): number | null {
  if (!expiry) return null;
  const a = Date.parse(`${expiry}T00:00:00Z`);
  const b = Date.parse(`${etToday()}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

function fmtClock(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

/**
 * rgba from a THEME token. The palette still lives in homeTheme — this only
 * varies the alpha, so there is no colour literal anywhere in this file.
 */
function alpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── The stylesheet (see the header note for why this exists) ─────────────────

const CSS = `
/* ── INDEX ── one cell per ticker; the whole roster on screen at once.
   TWELVE ACROSS, not auto-fill. auto-fill at 92px gave ~19 columns on a wide
   monitor, which made every cell the width of its own text and the board read
   as a wall of tiny type. A fixed count means the cells GROW with the window
   instead of multiplying, so the numbers stay legible on a 4K screen; the
   roster still lands in ~14 rows. Steps down on narrower windows so a cell
   never falls under about 110px. */
.cblv-idx{display:grid;grid-template-columns:repeat(var(--cblv-cols,12),minmax(0,1fr));gap:6px}
@media (max-width:1500px){.cblv-idx{--cblv-cols:9}}
@media (max-width:1200px){.cblv-idx{--cblv-cols:7}}
@media (max-width:900px){.cblv-idx{--cblv-cols:5}}
@media (max-width:640px){.cblv-idx{--cblv-cols:3}}
.cblv-cell{display:flex;flex-direction:column;gap:1px;padding:7px 9px 8px;border-radius:7px;cursor:pointer;
  border:1px solid ${alpha(HOME_THEME.text, 0.12)};background:${alpha(HOME_THEME.text, 0.03)};
  transition:transform .08s,border-color .08s,background .08s}
.cblv-cell:hover{transform:translateY(-1px);border-color:${alpha(HOME_THEME.text, 0.5)}}
/* THE ONLY CELL STATE IS "IS IT IN THE DOCK". Cells used to tint themselves gold
   / blue / red by where spot sat, which meant 169 of them repainted as price
   moved and the board read as weather rather than as a list. A cell is now
   neutral unless it is one of the four pinned above — the highlight answers
   "which of these am I looking at", and nothing else on the board competes with
   it. Position still shows, in the range bar, which is a mark rather than a
   wash. */
.cblv-cell.cblv-pinned{border-color:${HOME_THEME.text};background:${alpha(HOME_THEME.text, 0.14)};
  box-shadow:0 0 0 2px ${alpha(HOME_THEME.text, 0.12)}}
.cblv-cell > *{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ── DOCK ── four fixed slots. Empty ones are drawn so the layout never jumps. */
.cblv-dock{display:grid;grid-template-columns:repeat(${MAX_PINS},minmax(0,1fr));gap:18px;align-items:start}
@media (max-width:1200px){.cblv-dock{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){.cblv-dock{grid-template-columns:1fr}}
.cblv-slot{min-height:96px;border-radius:14px;display:flex;align-items:center;justify-content:center;
  border:1px dashed ${alpha(HOME_THEME.text, 0.14)};color:${alpha(HOME_THEME.text, 0.22)};
  font-size:10px;font-weight:800;letter-spacing:.1em}

/* ── CARD ── one neutral surface. Nothing here reacts to where spot sits. */
.cblv-card{container-type:inline-size;min-width:0;border-radius:14px;overflow:hidden;
  background:linear-gradient(180deg,${alpha(HOME_THEME.panel, 0.98)},${alpha(HOME_THEME.bg, 0.92)});
  border:1px solid ${alpha(HOME_THEME.text, 0.36)};
  box-shadow:0 0 0 3px ${alpha(HOME_THEME.text, 0.06)},
             0 14px 28px -12px ${alpha(HOME_THEME.bg, 0.9)},
             inset 0 1px 0 ${alpha(HOME_THEME.text, 0.07)}}
.cblv-band{display:flex;align-items:center;gap:7px;padding:9px 11px;
  border-bottom:1px solid ${HOME_THEME.border};
  background:linear-gradient(180deg,${alpha(HOME_THEME.text, 0.09)},${alpha(HOME_THEME.text, 0.015)})}
.cblv-tk,.cblv-v,.cblv-dte,.cblv-x{flex:0 0 auto;white-space:nowrap}
.cblv-sp{flex:1 1 auto;min-width:4px}
.cblv-x{cursor:pointer;color:${alpha(HOME_THEME.text, 0.4)};font-size:11px;padding:0 2px}
.cblv-x:hover{color:${HOME_THEME.text}}

/* DROP LADDER — measured against the CARD. Ticker + CB never leave. */
@container (max-width:268px){.cblv-dte{display:none}}
@container (max-width:232px){.cblv-v-pw{display:none}}
@container (max-width:196px){.cblv-v-cw{display:none}}
@container (max-width:168px){.cblv-lb{display:none}}

/* ── TABLE ── the same rows as columns of numbers, for comparing ACROSS
   tickers rather than within one. Collapsed until asked for. */
.cblv-scroll{max-height:540px;overflow:auto}
.cblv-tbl{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.cblv-tbl thead th{position:sticky;top:0;z-index:2;white-space:nowrap;text-align:right;
  padding:9px 12px;font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
  color:${alpha(HOME_THEME.text, 0.42)};background:${alpha(HOME_THEME.bg, 0.97)};
  backdrop-filter:blur(8px);border-bottom:1px solid ${alpha(HOME_THEME.text, 0.14)}}
.cblv-tbl th.cblv-sortable{cursor:pointer}
.cblv-tbl th.cblv-sortable:hover{color:${LIGHT_BLUE}}
.cblv-tbl th.cblv-active{color:${LIGHT_BLUE}}
.cblv-tbl tbody td{padding:5px 12px;font-size:12px;text-align:right;white-space:nowrap;
  border-bottom:1px solid ${alpha(HOME_THEME.text, 0.05)}}
.cblv-tbl thead th:first-child,.cblv-tbl tbody td:first-child{text-align:left}
.cblv-tbl tbody tr{cursor:pointer}
.cblv-tbl tbody tr:nth-child(even){background:${alpha(HOME_THEME.text, 0.018)}}
.cblv-tbl tbody tr:hover{background:${alpha(LIGHT_BLUE, 0.07)}}
.cblv-tbl tbody tr.cblv-rowpin{background:${alpha(HOME_THEME.text, 0.1)};
  box-shadow:inset 3px 0 0 ${HOME_THEME.text}}

/* ── RAILS ── every ticker normalised onto ONE axis, put wall left, call wall
   right. Shared axis is the whole point: the spot marks line up into a
   distribution you can read down the column. */
.cblv-rails{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 26px}
@media (max-width:1200px){.cblv-rails{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:800px){.cblv-rails{grid-template-columns:1fr}}
.cblv-rrow{display:flex;align-items:center;gap:8px;height:26px;cursor:pointer;
  border-bottom:1px solid ${alpha(HOME_THEME.text, 0.04)}}
.cblv-rrow:hover{background:${alpha(LIGHT_BLUE, 0.06)}}
.cblv-rrow.cblv-rowpin{background:${alpha(HOME_THEME.text, 0.1)}}
.cblv-rail{position:relative;flex:1 1 auto;min-width:40px;height:16px}
.cblv-rail:before{content:"";position:absolute;top:7.5px;left:0;right:0;height:1px;
  background:linear-gradient(90deg,${LEVEL_COLORS.pw},${alpha(HOME_THEME.text, 0.14)} 50%,${LEVEL_COLORS.cw})}
`;

// ── Index cell ───────────────────────────────────────────────────────────────

function IndexCell({
  row, spot, pinned, onToggle,
}: {
  row: ScannerRow;
  spot: number | null;
  pinned: boolean;
  onToggle: (symbol: string) => void;
}) {
  const cb = row.cb, cw = row.call_wall, pw = row.put_wall;
  const dCbPct = spot != null && cb ? ((spot - cb) / cb) * 100 : null;
  // Position of spot (and of the core) between the two walls, 0…1.
  const span = cw != null && pw != null ? cw - pw : null;
  const at = (v: number | null) =>
    v != null && span && pw != null ? Math.max(0, Math.min(100, ((v - pw) / span) * 100)) : null;
  const spotPct = at(spot);
  const cbPct = at(cb);

  return (
    <div
      className={`cblv-cell${pinned ? " cblv-pinned" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onToggle(row.symbol)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(row.symbol); } }}
      title={[
        `${row.symbol} — sweep ${fmtClock(row.ts)} ET${row.stale ? ` (stale, ${row.date})` : ""}`,
        spot != null ? `spot ${fmtSpot(spot)}` : null,
        cb != null ? `CB ${fmtLevel(cb)}` : null,
        cw != null ? `CW ${fmtLevel(cw)}` : null,
        pw != null ? `PW ${fmtLevel(pw)}` : null,
        row.total_net_gex != null ? `net GEX ${fmtGex(row.total_net_gex)}` : null,
        pinned ? "pinned — click to unpin" : "click to pin",
      ].filter(Boolean).join("\n")}
    >
      {/* Ticker in the app's light-blue accent, not white. It is the only word
          in a cell of numbers, and giving it the one non-level colour on the
          page makes a wall of 169 cells scannable by NAME without touching any
          of the level colours (CB gold, CW blue, PW red) or reintroducing a
          tint that moves with price. */}
      <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.02em", color: LIGHT_BLUE }}>
        {row.symbol}
        {pinned && <span style={{ fontSize: 8, opacity: 0.65 }}> ●</span>}
      </span>

      {/* The core, directly under the ticker — the one number worth reading
          without opening anything.
          NOT gold. On the card, CB gold earns its keep by telling three levels
          apart; here there is only ever one number, so the colour identifies
          nothing and 169 gold figures at once is just a yellow page. Plain ink,
          and the gold stays where it does work: the tick in the range bar below
          and the labelled levels on the docked card. */}
      <span style={{ fontSize: 13, fontWeight: 800, color: HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>
        {cb != null ? fmtLevel(cb) : "—"}
      </span>

      <span
        style={{
          fontSize: 10, fontWeight: 700, fontVariantNumeric: "tabular-nums",
          color: dCbPct == null ? alpha(HOME_THEME.text, 0.4) : dCbPct >= 0 ? ES_CANDLE_UP : ES_CANDLE_DOWN,
          opacity: 0.9,
        }}
      >
        {dCbPct == null ? "—" : `${fmtSigned(dCbPct)}%`}
      </span>

      {/* PW ── CW with the core as a gold tick and spot as a white one. */}
      <span
        style={{
          position: "relative", height: 5, borderRadius: 2, marginTop: 4,
          background: alpha(HOME_THEME.text, 0.08), display: "block",
        }}
      >
        {cbPct != null && (
          <i style={{ position: "absolute", top: -1, height: 7, width: 2, borderRadius: 1, left: `${cbPct}%`, background: LEVEL_COLORS.cb }} />
        )}
        {spotPct != null && (
          <i style={{ position: "absolute", top: -1, height: 7, width: 2, borderRadius: 1, left: `${spotPct}%`, background: HOME_THEME.text }} />
        )}
      </span>
    </div>
  );
}

// ── Docked card ──────────────────────────────────────────────────────────────

function DockCard({
  row, spot, show, onClose,
}: {
  row: ScannerRow;
  spot: number | null;
  show: Record<LevelKey, boolean>;
  onClose: (symbol: string) => void;
}) {
  const cb = row.cb, cw = row.call_wall, pw = row.put_wall, flip = row.gex_flip;
  const dte = dteOf(row.expiry);
  const dCb = spot != null && cb != null ? spot - cb : null;
  const dCbPct = dCb != null && cb ? (dCb / cb) * 100 : null;

  // Rows written before the CB/wall exclusion landed can still carry a wall on
  // the same strike as the core: draw ONE line badged "CB·CW".
  const cwIsCb = cw != null && cb != null && cw === cb;
  const pwIsCb = pw != null && cb != null && pw === cb;

  const marks = (() => {
    const wanted = [
      show.cb && cb != null ? { k: "CB", v: cb, c: LEVEL_COLORS.cb } : null,
      show.cw && cw != null ? { k: "CW", v: cw, c: LEVEL_COLORS.cw } : null,
      show.pw && pw != null ? { k: "PW", v: pw, c: LEVEL_COLORS.pw } : null,
      show.flip && flip != null ? { k: "FLIP", v: flip, c: HOME_THEME.purple } : null,
    ].filter((x): x is { k: string; v: number; c: string } => x != null);
    const byValue = new Map<number, { labels: string[]; color: string; v: number }>();
    for (const m of wanted) {
      const hit = byValue.get(m.v);
      if (hit) hit.labels.push(m.k);
      else byValue.set(m.v, { labels: [m.k], color: m.c, v: m.v });
    }
    return [...byValue.values()];
  })();

  const pts = [...marks.map((m) => m.v), ...(spot != null ? [spot] : [])];
  const rawHi = pts.length ? Math.max(...pts) : 1;
  const rawLo = pts.length ? Math.min(...pts) : 0;
  const span = rawHi - rawLo || Math.max(Math.abs(rawHi) * 0.004, 0.02);
  const hi = rawHi + span * 0.14;
  const lo = rawLo - span * 0.14;
  const y = (v: number) => ((hi - v) / (hi - lo)) * RAIL_H;

  const bandValue = (key: LevelKey, label: string, value: number, color: string) => (
    <span className={`cblv-v cblv-v-${key}`} style={{ fontSize: 11, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
      <span className="cblv-lb" style={{ fontSize: 7, fontWeight: 800, letterSpacing: "0.05em", opacity: 0.7, marginRight: 2 }}>
        {label}
      </span>
      {fmtLevel(value)}
    </span>
  );

  return (
    <div className="cblv-card">
      <div
        className="cblv-band"
        title={[
          `${row.symbol} — sweep ${fmtClock(row.ts)} ET${row.stale ? ` (stale, ${row.date})` : ""}`,
          row.expiry ? `expiry ${row.expiry}${dte != null ? ` (${dte}DTE)` : ""}` : null,
          row.total_net_gex != null ? `net GEX ${fmtGex(row.total_net_gex)}` : null,
          dCbPct != null ? `spot vs CB ${fmtSigned(dCbPct)}%` : null,
        ].filter(Boolean).join("\n")}
      >
        <span className="cblv-tk" style={{ fontSize: 13, fontWeight: 800, color: LIGHT_BLUE, letterSpacing: "0.03em" }}>
          {row.symbol}
        </span>
        <span className="cblv-sp" />
        {show.cb && cb != null && bandValue("cb", "CB", cb, LEVEL_COLORS.cb)}
        {show.cw && cw != null && !cwIsCb && bandValue("cw", "CW", cw, LEVEL_COLORS.cw)}
        {show.pw && pw != null && !pwIsCb && bandValue("pw", "PW", pw, LEVEL_COLORS.pw)}
        <span
          className="cblv-dte"
          style={{
            fontSize: 8, fontWeight: 800, letterSpacing: "0.04em", padding: "1px 4px", borderRadius: 4,
            color: row.stale ? HOME_THEME.orange : alpha(HOME_THEME.text, 0.42),
            background: row.stale ? alpha(HOME_THEME.orange, 0.14) : alpha(HOME_THEME.text, 0.06),
          }}
        >
          {row.stale ? `STALE ${row.date.slice(5)}` : dte != null ? `${dte}D` : "—"}
        </span>
        <span
          className="cblv-x"
          role="button"
          tabIndex={0}
          title="Unpin"
          onClick={() => onClose(row.symbol)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClose(row.symbol); } }}
        >
          ✕
        </span>
      </div>

      <div style={{ padding: "10px 12px 9px" }}>
        <div style={{ position: "relative", height: RAIL_H, margin: "4px 0 8px" }}>
          {marks.map((m) => (
            <div
              key={m.labels.join("-")}
              style={{
                position: "absolute", left: 0, right: 0, top: y(m.v),
                transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 5,
              }}
            >
              <span
                style={{
                  flex: "0 0 auto", fontSize: 8, fontWeight: 800, letterSpacing: "0.06em",
                  padding: "1px 4px", borderRadius: 3, color: m.color,
                  border: `1px solid ${m.color}`, opacity: 0.75,
                }}
              >
                {m.labels.join("·")}
              </span>
              <span style={{ flex: "1 1 auto", minWidth: 6, height: 1, background: m.color, opacity: 0.4 }} />
              <span
                style={{
                  flex: "0 0 auto", fontSize: 10, fontWeight: 700, color: m.color,
                  fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                }}
              >
                {fmtLevel(m.v)}
              </span>
            </div>
          ))}
          {spot != null && (
            <div
              style={{
                position: "absolute", left: 0, right: 0, top: y(spot),
                transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <span style={{ flex: "1 1 auto", minWidth: 4, borderTop: `1px dashed ${alpha(HOME_THEME.text, 0.5)}` }} />
              <span
                style={{
                  flex: "0 0 auto", fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 6,
                  background: HOME_THEME.panelBgStrong, border: `1px solid ${alpha(HOME_THEME.text, 0.22)}`,
                  color: HOME_THEME.text, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                }}
              >
                {fmtSpot(spot)}
              </span>
              <span style={{ flex: "1 1 auto", minWidth: 4, borderTop: `1px dashed ${alpha(HOME_THEME.text, 0.5)}` }} />
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6,
            borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 5,
            fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
          }}
        >
          <span style={{ color: alpha(HOME_THEME.text, 0.4), whiteSpace: "nowrap" }}>SPOT VS CB</span>
          <span
            style={{
              fontSize: 11, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
              color: dCb == null ? alpha(HOME_THEME.text, 0.4) : dCb >= 0 ? ES_CANDLE_UP : ES_CANDLE_DOWN,
            }}
          >
            {dCb == null ? "—" : fmtSigned(dCb)}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Collapsible section wrapper — header always drawn, body only when open. */
function Section({
  title, hint, open, onToggle, children,
}: {
  title: string;
  hint: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Card
      variant="budget"
      padding={0}
      style={{
        border: `1px solid ${alpha(HOME_THEME.text, 0.36)}`,
        boxShadow: `0 0 0 3px ${alpha(HOME_THEME.text, 0.06)}, 0 14px 28px -12px ${alpha(HOME_THEME.bg, 0.9)}`,
        overflow: "hidden",
        // PageShell's <main> is a scrolling FLEX COLUMN, and a flex item's
        // default flex-shrink:1 applies even when the container scrolls. With a
        // 14-row index above them these two sections were squeezed to ~6px
        // slivers — visible, unreadable, and impossible to click. Opt out of
        // shrinking and they keep their content height.
        flexShrink: 0,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        style={{
          display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none",
          padding: "12px 14px",
          borderBottom: open ? `1px solid ${HOME_THEME.border}` : "none",
          background: open ? alpha(HOME_THEME.text, 0.04) : "transparent",
        }}
      >
        <span style={{ fontSize: 9, color: alpha(HOME_THEME.text, 0.35) }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE }}>
          {title}
        </span>
        <span style={{ fontSize: 11, color: alpha(HOME_THEME.text, 0.4) }}>{hint}</span>
      </div>
      {open && children}
    </Card>
  );
}

/** Shared PW ── CW bar with the core as a tick and spot as a mark. */
function RangeBar({ row, spot, height = 9 }: { row: ScannerRow; spot: number | null; height?: number }) {
  const { cb, call_wall: cw, put_wall: pw } = row;
  const span = cw != null && pw != null ? cw - pw : null;
  const at = (v: number | null) =>
    v != null && span && pw != null ? Math.max(0, Math.min(100, ((v - pw) / span) * 100)) : null;
  const cbPct = at(cb), spotPct = at(spot);
  return (
    <span
      style={{
        position: "relative", display: "block", height, minWidth: 110,
        borderRadius: 2, background: alpha(HOME_THEME.text, 0.06),
      }}
    >
      <i style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 2, background: LEVEL_COLORS.pw }} />
      <i style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 2, background: LEVEL_COLORS.cw }} />
      {cbPct != null && (
        <i style={{ position: "absolute", top: -1, height: height + 2, width: 2, left: `${cbPct}%`, background: LEVEL_COLORS.cb }} />
      )}
      {spotPct != null && (
        <i style={{ position: "absolute", top: -1, height: height + 2, width: 2, left: `${spotPct}%`, background: HOME_THEME.text }} />
      )}
    </span>
  );
}

/**
 * LADDER TABLE — every number in a column. The index answers "where is this
 * one"; the table answers "which of them is furthest from its core", which is a
 * question you can only ask by running an eye down a column. Header cells that
 * map onto one of the page's three sorts drive it, so the table and the board
 * above never disagree about order.
 */
function LadderTable({
  rows, spotOf, pins, onToggle, sort, setSort,
}: {
  rows: ScannerRow[];
  spotOf: (r: ScannerRow) => number | null;
  pins: string[];
  onToggle: (symbol: string) => void;
  sort: SortId;
  setSort: (s: SortId) => void;
}) {
  const head = (txt: string, key?: SortId) => (
    <th
      className={key ? `cblv-sortable${sort === key ? " cblv-active" : ""}` : undefined}
      onClick={key ? () => setSort(key) : undefined}
    >
      {txt}
    </th>
  );
  return (
    <div className="cblv-scroll">
      <table className="cblv-tbl">
        <thead>
          <tr>
            {head("Ticker", "az")}
            {head("Spot")}
            {head("CB")}
            {head("Δ CB", "core")}
            {head("Δ %")}
            {head("CW")}
            {head("PW")}
            {head("Range")}
            {head("Net GEX", "gex")}
            {head("DTE")}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const spot = spotOf(r);
            const d = spot != null && r.cb != null ? spot - r.cb : null;
            const dp = d != null && r.cb ? (d / r.cb) * 100 : null;
            const dte = dteOf(r.expiry);
            return (
              <tr
                key={r.symbol}
                className={pins.includes(r.symbol) ? "cblv-rowpin" : undefined}
                onClick={() => onToggle(r.symbol)}
                title={pins.includes(r.symbol) ? "pinned — click to unpin" : "click to pin"}
              >
                <td style={{ fontWeight: 800, color: LIGHT_BLUE, letterSpacing: "0.03em" }}>{r.symbol}</td>
                <td>{spot != null ? fmtSpot(spot) : "—"}</td>
                <td style={{ color: LEVEL_COLORS.cb }}>{r.cb != null ? fmtLevel(r.cb) : "—"}</td>
                <td style={{ color: d == null ? undefined : d >= 0 ? ES_CANDLE_UP : ES_CANDLE_DOWN }}>
                  {d == null ? "—" : fmtSigned(d)}
                </td>
                <td style={{ color: dp == null ? undefined : dp >= 0 ? ES_CANDLE_UP : ES_CANDLE_DOWN }}>
                  {dp == null ? "—" : `${fmtSigned(dp)}%`}
                </td>
                <td style={{ color: LEVEL_COLORS.cw }}>{r.call_wall != null ? fmtLevel(r.call_wall) : "—"}</td>
                <td style={{ color: LEVEL_COLORS.pw }}>{r.put_wall != null ? fmtLevel(r.put_wall) : "—"}</td>
                <td><RangeBar row={r} spot={spot} /></td>
                <td style={{ color: (r.total_net_gex ?? 0) >= 0 ? ES_CANDLE_UP : ES_CANDLE_DOWN }}>
                  {r.total_net_gex != null ? fmtGex(r.total_net_gex) : "—"}
                </td>
                <td style={{ color: alpha(HOME_THEME.text, 0.45) }}>
                  {r.stale ? "STALE" : dte != null ? `${dte}D` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * ALIGNED RANGE RAILS — every ticker squashed onto the SAME 0–100% axis: put
 * wall at the left edge, call wall at the right, gold tick for the core, white
 * mark for spot. Because the axis is shared the marks line up into a
 * distribution, so a column bunched right means the whole tape is leaning into
 * call walls — which no per-ticker view can show.
 *
 * Deliberately sorted by position rather than by the page's sort: the ordering
 * IS the readout here, and A–Z would scatter it.
 */
function RangeRails({
  rows, spotOf, pins, onToggle,
}: {
  rows: ScannerRow[];
  spotOf: (r: ScannerRow) => number | null;
  pins: string[];
  onToggle: (symbol: string) => void;
}) {
  const posOf = (r: ScannerRow) => {
    const spot = spotOf(r);
    const { call_wall: cw, put_wall: pw } = r;
    if (spot == null || cw == null || pw == null || cw === pw) return null;
    return Math.max(0, Math.min(1, (spot - pw) / (cw - pw)));
  };
  const ordered = [...rows].sort((a, b) => (posOf(b) ?? -1) - (posOf(a) ?? -1));
  return (
    <div style={{ padding: "10px 14px 14px" }}>
      <div
        style={{
          display: "flex", justifyContent: "space-between", fontSize: 8, fontWeight: 800,
          letterSpacing: "0.1em", color: alpha(HOME_THEME.text, 0.3), padding: "0 0 8px",
        }}
      >
        <span>◄ PUT WALL</span><span>CORE = GOLD TICK</span><span>CALL WALL ►</span>
      </div>
      <div className="cblv-rails">
        {ordered.map((r) => {
          const pos = posOf(r);
          const cb = r.cb, cw = r.call_wall, pw = r.put_wall;
          const span = cw != null && pw != null ? cw - pw : null;
          const cbPct = cb != null && span && pw != null ? Math.max(0, Math.min(100, ((cb - pw) / span) * 100)) : null;
          const tone = pos == null ? alpha(HOME_THEME.text, 0.4)
            : pos > 0.75 ? LEVEL_COLORS.cw : pos < 0.25 ? LEVEL_COLORS.pw : alpha(HOME_THEME.text, 0.55);
          return (
            <div
              key={r.symbol}
              className={`cblv-rrow${pins.includes(r.symbol) ? " cblv-rowpin" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onToggle(r.symbol)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(r.symbol); } }}
              title={[
                r.symbol,
                spotOf(r) != null ? `spot ${fmtSpot(spotOf(r) as number)}` : null,
                cb != null ? `CB ${fmtLevel(cb)}` : null,
                cw != null ? `CW ${fmtLevel(cw)}` : null,
                pw != null ? `PW ${fmtLevel(pw)}` : null,
              ].filter(Boolean).join(" · ")}
            >
              <span style={{ flex: "0 0 52px", fontSize: 11, fontWeight: 800, color: LIGHT_BLUE }}>{r.symbol}</span>
              <span className="cblv-rail">
                {cbPct != null && (
                  <i style={{ position: "absolute", top: 3, height: 10, width: 2, borderRadius: 1, left: `${cbPct}%`, background: LEVEL_COLORS.cb }} />
                )}
                {pos != null && (
                  <i
                    style={{
                      position: "absolute", top: 1, left: `${pos * 100}%`, marginLeft: -4, width: 0, height: 0,
                      borderLeft: "4px solid transparent", borderRight: "4px solid transparent",
                      borderTop: `7px solid ${HOME_THEME.text}`,
                    }}
                  />
                )}
              </span>
              <span style={{ flex: "0 0 44px", textAlign: "right", fontSize: 10, fontWeight: 800, color: tone, fontVariantNumeric: "tabular-nums" }}>
                {pos == null ? "—" : `${Math.round(pos * 100)}%`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LevelsPage() {
  usePageLoadStatus({ pageKey: "levels", pageLabel: "Levels" });

  const { tickers } = useScannerTickers();
  const [rows, setRows] = useState<ScannerRow[]>([]);
  const [live, setLive] = useState<Record<string, number>>({});
  const [refresh, setRefresh] = useState<RefreshState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sweptAt, setSweptAt] = useState<string | null>(null);

  const [sort, setSort] = useState<SortId>("az");
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Record<LevelKey, boolean>>({ cb: true, cw: true, pw: true, flip: false });
  const [pins, setPins] = useState<string[]>([]);
  // Both extra views are collapsed on arrival — the board is the page, these are
  // second opinions you ask for.
  const [openTable, setOpenTable] = useState(false);
  const [openRails, setOpenRails] = useState(false);

  // Saved view + pins. Read AFTER mount so the server-rendered first paint and
  // the client's agree (a localStorage read in useState would not).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<{
          sort: SortId; show: Record<LevelKey, boolean>; openTable: boolean; openRails: boolean;
        }>;
        if (p.sort) setSort(p.sort);
        const savedShow = p.show;
        if (savedShow) setShow((s) => ({ ...s, ...savedShow }));
        if (typeof p.openTable === "boolean") setOpenTable(p.openTable);
        if (typeof p.openRails === "boolean") setOpenRails(p.openRails);
      }
    } catch { /* corrupt or blocked storage — defaults are fine */ }
    try {
      const raw = window.localStorage.getItem(PINS_KEY);
      const list = raw ? (JSON.parse(raw) as unknown) : null;
      if (Array.isArray(list)) {
        setPins(list.map((x) => String(x).toUpperCase()).filter(Boolean).slice(0, MAX_PINS));
      }
    } catch { /* non-fatal */ }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ sort, show, openTable, openRails }));
    } catch { /* non-fatal */ }
  }, [sort, show, openTable, openRails]);
  useEffect(() => {
    try { window.localStorage.setItem(PINS_KEY, JSON.stringify(pins)); } catch { /* non-fatal */ }
  }, [pins]);

  // ── Levels: one request for the whole universe ─────────────────────────────
  const loadLevels = useCallback(async (manual = false) => {
    if (manual) setRefresh("refreshing");
    try {
      const r = await fetch("/proxy/scanner?any=1&limit=200", { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok || !Array.isArray(j.rows)) throw new Error(j?.error || `HTTP ${r.status}`);
      const mapped: ScannerRow[] = j.rows.map((x: Record<string, unknown>) => ({
        symbol: String(x.symbol || "").toUpperCase(),
        date: String(x.date || ""),
        ts: String(x.ts || ""),
        spot: num(x.spot),
        expiry: x.expiry ? String(x.expiry) : null,
        total_net_gex: num(x.total_net_gex),
        call_wall: num(x.call_wall),
        put_wall: num(x.put_wall),
        gex_flip: num(x.gex_flip),
        cb: num(x.cb),
        strikes: num(x.strikes),
        stale: !!x.stale,
      })).filter((x: ScannerRow) => x.symbol);
      setRows(mapped);
      setSweptAt(mapped.reduce<string | null>((a, b) => (!a || b.ts > a ? b.ts : a), null));
      setError(null);
      if (manual) { setRefresh("success"); window.setTimeout(() => setRefresh("idle"), 1200); }
    } catch (e) {
      setError(String((e as Error)?.message || e));
      if (manual) { setRefresh("error"); window.setTimeout(() => setRefresh("idle"), 1800); }
    }
  }, []);

  useEffect(() => {
    void loadLevels();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadLevels();
    }, LEVELS_POLL_MS);
    return () => window.clearInterval(id);
  }, [loadLevels]);

  // ── Live spot overlay ─────────────────────────────────────────────────────
  // Chunked so the query string stays short, and driven off a ref so the
  // interval is created once instead of being torn down on every sweep.
  const symbolsRef = useRef<string[]>([]);
  symbolsRef.current = useMemo(() => rows.map((r) => r.symbol), [rows]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const syms = symbolsRef.current;
      if (!syms.length || document.visibilityState !== "visible") return;
      const chunks: string[][] = [];
      for (let i = 0; i < syms.length; i += QUOTE_CHUNK) chunks.push(syms.slice(i, i + QUOTE_CHUNK));
      const merged: Record<string, number> = {};
      await Promise.all(chunks.map(async (c) => {
        try {
          const r = await fetch(`/api/tt-quotes?symbols=${encodeURIComponent(c.join(","))}`, { cache: "no-store" });
          if (!r.ok) return;
          const j = await r.json();
          for (const it of (j?.data?.items ?? []) as Array<Record<string, unknown>>) {
            const sym = String(it.symbol || "").toUpperCase();
            // `last` is 0 outside RTH for some roots; mark is the fallback, and
            // a 0/0 pair must NOT overwrite the sweep's spot with zero.
            const px = num(it.last) || num(it.mark) || null;
            if (sym && px) merged[sym] = px;
          }
        } catch { /* one bad chunk must not blank the others */ }
      }));
      if (!cancelled && Object.keys(merged).length) setLive((prev) => ({ ...prev, ...merged }));
    };
    void tick();
    const id = window.setInterval(tick, QUOTES_POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const spotOf = useCallback((r: ScannerRow) => live[r.symbol] ?? r.spot, [live]);

  // ── The visible index ─────────────────────────────────────────────────────
  const view = useMemo(() => {
    const uni = new Set(tickers);
    const q = query.trim().toUpperCase();
    let list = rows.filter((r) => (uni.size ? uni.has(r.symbol) : true));
    if (q) list = list.filter((r) => r.symbol.includes(q));
    const dist = (r: ScannerRow) => {
      const s = live[r.symbol] ?? r.spot;
      return s != null && r.cb ? Math.abs((s - r.cb) / r.cb) : Number.POSITIVE_INFINITY;
    };
    const cmp: Record<SortId, (a: ScannerRow, b: ScannerRow) => number> = {
      // Distance to the core, closest first — "what is pinned right now".
      core: (a, b) => dist(a) - dist(b),
      gex: (a, b) => Math.abs(b.total_net_gex ?? 0) - Math.abs(a.total_net_gex ?? 0),
      // The default. A flat alphabetical board means a ticker is always where
      // its name says it is; the other two orders move things under you.
      az: (a, b) => a.symbol.localeCompare(b.symbol),
    };
    return [...list].sort(cmp[sort]);
  }, [rows, tickers, query, sort, live]);

  const bySymbol = useMemo(() => {
    const m = new Map<string, ScannerRow>();
    for (const r of rows) m.set(r.symbol, r);
    return m;
  }, [rows]);

  /** Pinning a fifth drops the OLDEST, so the dock never refuses a click. */
  const togglePin = useCallback((sym: string) => {
    setPins((p) => (p.includes(sym) ? p.filter((x) => x !== sym) : [...p, sym].slice(-MAX_PINS)));
  }, []);
  const unpin = useCallback((sym: string) => setPins((p) => p.filter((x) => x !== sym)), []);

  const liveCount = Object.keys(live).length;
  const label: CSSProperties = { fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", color: alpha(HOME_THEME.text, 0.4) };
  const seg = (active: boolean) => (active ? homeButtonStyle : homeSecondaryButtonStyle);
  const cardEdge: CSSProperties = {
    border: `1px solid ${alpha(HOME_THEME.text, 0.36)}`,
    boxShadow: `0 0 0 3px ${alpha(HOME_THEME.text, 0.06)}, 0 14px 28px -12px ${alpha(HOME_THEME.bg, 0.9)}`,
  };

  return (
    <PageShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ── controls ── */}
      <Card variant="budget" padding={14} style={cardEdge}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginRight: "auto" }}>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Levels
            </div>
            <div style={{ fontSize: 11, color: alpha(HOME_THEME.text, 0.45) }}>
              {view.length} tickers · sweep {fmtClock(sweptAt)} ET · spot live{liveCount ? ` (${liveCount})` : ""}
              {` · ${pins.length}/${MAX_PINS} pinned`}
              {error ? ` · ${error}` : ""}
            </div>
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            style={{ ...homeInputStyle, width: 110 }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={label}>SORT</span>
            {([["az", "A–Z"], ["core", "Near CB"], ["gex", "Net GEX"]] as [SortId, string][]).map(([id, txt]) => (
              <button key={id} style={seg(sort === id)} onClick={() => setSort(id)}>{txt}</button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={label}>SHOW</span>
            {([
              ["cb", "CB", LEVEL_COLORS.cb],
              ["cw", "CW", LEVEL_COLORS.cw],
              ["pw", "PW", LEVEL_COLORS.pw],
              ["flip", "Flip", HOME_THEME.purple],
            ] as [LevelKey, string, string][]).map(([id, txt, color]) => (
              <button
                key={id}
                onClick={() => setShow((s) => ({ ...s, [id]: !s[id] }))}
                style={{
                  ...homeSecondaryButtonStyle,
                  color: show[id] ? LEVEL_COLORS.onSolid : color,
                  background: show[id] ? color : alpha(HOME_THEME.text, 0.04),
                  border: `1px solid ${color}`,
                }}
              >
                {txt}
              </button>
            ))}
          </div>

          <button
            style={homeSecondaryButtonStyle}
            onClick={() => setPins([])}
            disabled={pins.length === 0}
          >
            Unpin all
          </button>

          <button
            style={homeRefreshButtonStyle(refresh)}
            onClick={() => void loadLevels(true)}
            disabled={refresh === "refreshing"}
          >
            {refresh === "refreshing" ? "…" : "Refresh"}
          </button>
        </div>
      </Card>

      {/* ── dock ── */}
      <div className="cblv-dock" style={{ flexShrink: 0 }}>
        {Array.from({ length: MAX_PINS }).map((_, i) => {
          const sym = pins[i];
          const row = sym ? bySymbol.get(sym) : undefined;
          if (!row) return <div key={`slot-${i}`} className="cblv-slot">EMPTY SLOT</div>;
          return (
            <DockCard key={row.symbol} row={row} spot={spotOf(row)} show={show} onClose={unpin} />
          );
        })}
      </div>

      {/* ── index ── */}
      {view.length === 0 ? (
        <Card variant="budget" padding={20} style={cardEdge}>
          <div style={{ fontSize: 13, color: alpha(HOME_THEME.text, 0.6) }}>
            {error
              ? `Could not load levels: ${error}`
              : "No scanner snapshots yet — the recorder writes one row per ticker every 5 minutes."}
          </div>
        </Card>
      ) : (
        <div className="cblv-idx" style={{ flexShrink: 0 }}>
          {view.map((r) => (
            <IndexCell
              key={r.symbol}
              row={r}
              spot={spotOf(r)}
              pinned={pins.includes(r.symbol)}
              onToggle={togglePin}
            />
          ))}
        </div>
      )}

      {/* ── second opinions, collapsed ── */}
      {view.length > 0 && (
        <>
          <Section
            title="Ladder table"
            hint={`${view.length} rows · every number in a column · click a row to pin`}
            open={openTable}
            onToggle={() => setOpenTable((v) => !v)}
          >
            <LadderTable
              rows={view}
              spotOf={spotOf}
              pins={pins}
              onToggle={togglePin}
              sort={sort}
              setSort={setSort}
            />
          </Section>

          <Section
            title="Aligned range rails"
            hint="every ticker on one axis, put wall → call wall · sorted by position"
            open={openRails}
            onToggle={() => setOpenRails((v) => !v)}
          >
            <RangeRails rows={view} spotOf={spotOf} pins={pins} onToggle={togglePin} />
          </Section>
        </>
      )}
    </PageShell>
  );
}
