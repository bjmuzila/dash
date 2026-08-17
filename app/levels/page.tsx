// ─────────────────────────────────────────────────────────────────────────────
// app/levels/page.tsx — /levels
//
// ONE NORMALIZED AXIS, FOUR WAYS TO READ IT, PLUS THREE ALTERNATE LAYOUTS.
//
// This is a FULL REPLACEMENT of the previous page. Everything that page had —
// the four-slot pin dock, the 169-cell index grid, the collapsed "Ladder table"
// and "Aligned range rails" sections — is gone. None of it survives here.
//
// WHY. The old board drew one identical cell per ticker. 169 of them made the
// page a wall of chrome you had to READ rather than SEE: every cell cost a
// glance, and the answer to "what is the whole universe doing" was not on the
// page at any zoom. The fix is to stop giving each ticker its own box and put
// them all on ONE SHARED AXIS instead, so position carries the meaning and the
// shape of the roster is legible before you read a single symbol.
//
// THE AXIS. x = (spot − CB) / CB, as a percent, clamped to ±AXIS_CLAMP. It is
// normalized, so SPX at 6,400 and a $40 stock land on the same scale and can be
// compared directly — which is the whole trick. Zero is the Core Bullseye.
//
// FOUR VIEWS (the top switcher):
//
//   BOARD    — the axis itself. Four sub-modes, below.
//   DESK     — rail + one large price-scaled ladder + a compare stack. For when
//              you are working ONE ticker and want the ladder big.
//   MONITOR  — every level as a table column, grouped by regime, sortable.
//   LANES    — five buckets by wall position; the COUNT per lane is the read.
//
// FOUR BOARD MODES (the second switcher, only while BOARD is active):
//
//   CLOUD      — the default. Every ticker named and packed onto the axis,
//                with the five zones separated and counted.
//   RIDGE      — a binned histogram of the same axis; only the tails get named.
//   SWARM      — one row per sector, so the page reads ROTATION not tickers.
//   QUADRANTS  — x = distance from core, y = net GEX. The quadrant a name sits
//                in is the setup: long gamma above core is pinned, short gamma
//                below core is the unstable corner.
//
// DATA — unchanged from the previous page, deliberately. Nothing here needs a
// new endpoint.
//
//   GET /proxy/scanner?any=1   →  latest scanner_snapshots row per symbol:
//                                 spot, expiry, cb, call_wall, put_wall,
//                                 gex_flip, total_net_gex, plus `stale`.
//   GET /api/tt-quotes         →  live last/mark, 5s, chunked. Levels step on
//                                 the recorder's 5m sweep; the spot marker does
//                                 not have to, so every x position moves
//                                 continuously between sweeps while the rails
//                                 hold still.
//
// COLOUR — the rule the old page established and this one keeps. Colour means
// WHICH LEVEL a thing is and never where price happens to be sitting: CB gold,
// CW blue, PW red, up/down green-red on deltas only. Nothing repaints as spot
// moves except the marks that ARE spot. Every value below is interpolated from
// homeTheme / LEVEL_COLORS via alpha(); there is no colour literal in this file.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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

/**
 * Axis half-width, in percent from the Core Bullseye. ±3% covers the overwhelming
 * majority of a normal session; anything past it is CLAMPED to the edge rather
 * than dropped, so a runaway name still shows up (pinned to the rail) instead of
 * silently vanishing from the board.
 */
const AXIS_CLAMP = 3.0;

/**
 * Section edges on the axis, in percent from core. These are what the CLOUD's
 * separators are drawn at and what the section counts are computed from.
 *
 * They are AXIS positions, not per-ticker wall tests — a divider has to sit at a
 * fixed x or it is not a divider. The per-ticker wall state (is spot actually
 * past THIS name's call wall) still drives chip COLOUR, which is why a red chip
 * can appear inside the "below" section rather than only in "far below".
 */
const ZONE_EDGES = [-1.5, -0.25, 0.25, 1.5] as const;
const ZONE_NAMES = ["FAR BELOW", "BELOW", "AT CORE", "ABOVE", "FAR ABOVE"] as const;

/** Ladder height on the DESK stage, in px. */
const DESK_RAIL_MIN = 260;
/** Compare slots on the DESK. */
const MAX_PINS = 4;

const PREFS_KEY = "cb-levels-prefs-v6";
const PINS_KEY = "cb-levels-pins-v2";

type ViewId = "board" | "desk" | "monitor" | "lanes";
type BoardId = "cloud" | "ridge" | "swarm" | "quadrants";
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

/**
 * A row with everything the views need already derived, so no view recomputes
 * geometry and none of them can disagree about where a ticker sits.
 *
 *   dPct  — percent from core. THE x coordinate for every board mode.
 *   pos   — 0…100, where spot sits between put wall and call wall.
 *   cbPos — same scale, where the core sits. Both null when the walls are
 *           missing or degenerate, and every consumer must handle that.
 */
type Mark = {
  row: ScannerRow;
  symbol: string;
  spot: number | null;
  dPct: number | null;
  pos: number | null;
  cbPos: number | null;
  gex: number;
  sector: string;
  /** Wall state — drives colour. "" = inside the walls and not at the core. */
  zone: "out" | "outc" | "near" | "";
};

// ── Sectors ──────────────────────────────────────────────────────────────────
/**
 * Group map for the SWARM board and the MONITOR's optional grouping. Deliberately
 * a plain literal rather than a lookup on the scanner row: the recorder does not
 * store a sector, and inventing a request for one to draw a chart would be the
 * wrong trade. Anything unlisted falls into "Other", which is a real row, not a
 * hidden bucket — a name silently vanishing from a board is the failure mode
 * this page exists to fix.
 */
const SECTOR_MAP: Record<string, string> = {};
(
  [
    ["Index / ETF", "SPX SPY QQQ IWM NDX ES NQ RUT DIA EEM EFA FXI VOO IVV"],
    ["Mega tech", "AAPL MSFT NVDA AMZN META GOOGL GOOG TSLA AVGO NFLX ORCL"],
    ["Semis", "AMD MU QCOM TXN AMAT LRCX KLAC ARM SMCI INTC NXPI ON ADI MRVL TSM ASML"],
    ["Software", "CRM ADBE PLTR SNOW DDOG NET CRWD PANW ZS MDB TEAM SHOP OKTA NOW INTU WDAY"],
    ["Financials", "JPM BAC WFC GS MS C SCHW BLK AXP V MA PYPL SQ USB PNC TFC ALLY COF BK"],
    ["Crypto", "COIN HOOD SOFI MSTR RIOT MARA CLSK BITF IBIT ETHE GBTC"],
    ["Energy", "XOM CVX COP SLB OXY PSX VLO MPC EOG DVN HAL BKR KMI WMB LNG FANG PXD"],
    ["Health", "UNH LLY JNJ PFE MRK ABBV TMO ABT DHR BMY AMGN GILD VRTX REGN MRNA CVS CI HUM ISRG SYK BSX MDT"],
    ["Consumer", "WMT COST TGT HD LOW NKE SBUX MCD CMG YUM DIS CMCSA T VZ TMUS PG KO PEP PM MO KHC GIS"],
    ["Industrial", "CAT DE BA LMT RTX NOC GD HON GE MMM UPS FDX UNP CSX NSC LUV DAL UAL AAL EMR ETN"],
    ["Sector ETFs", "XLF XLE XLK XLV XLI XLY XLP XLU XLB XLRE XLC GLD SLV USO UNG TLT HYG LQD IEF SMH XBI KRE"],
    ["Leveraged / vol", "VIX UVXY VXX SQQQ TQQQ SOXL SOXS ARKK SPXU UPRO TNA TZA"],
  ] as const
).forEach(([g, syms]) => {
  syms.split(/\s+/).forEach((s) => { SECTOR_MAP[s] = g; });
});
const SECTOR_ORDER = [
  "Index / ETF", "Mega tech", "Semis", "Software", "Financials", "Crypto",
  "Energy", "Health", "Consumer", "Industrial", "Sector ETFs", "Leveraged / vol", "Other",
];

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

/** Axis position 0…100 for a percent-from-core. Clamped, never dropped. */
const axisX = (d: number) =>
  50 + Math.max(-AXIS_CLAMP, Math.min(AXIS_CLAMP, d)) / AXIS_CLAMP * 47;

/** The colour a chip/dot takes from its WALL state. Never from where spot is. */
const zoneColor = (z: Mark["zone"]) =>
  z === "outc" ? LEVEL_COLORS.cw : z === "out" ? LEVEL_COLORS.pw : z === "near" ? LEVEL_COLORS.cb : alpha(HOME_THEME.text, 0.72);

// ── The stylesheet ───────────────────────────────────────────────────────────
// Same reason the previous page shipped one: `:hover` and `@container`, neither
// of which an inline style can express. Every colour is interpolated from a
// theme token through alpha().

const CSS = `
/* ── shared ── */
.cblv-axis{position:relative;height:30px;flex-shrink:0}
.cblv-axis .ln{position:absolute;left:0;right:0;top:50%;height:1px;background:${alpha(HOME_THEME.text, 0.12)}}
.cblv-axis .t{position:absolute;top:0;transform:translateX(-50%);text-align:center}
.cblv-axis .t i{display:block;width:1px;height:10px;margin:0 auto;background:${alpha(HOME_THEME.text, 0.2)}}
.cblv-axis .t span{font-size:9px;font-weight:800;letter-spacing:.08em;color:${alpha(HOME_THEME.text, 0.32)}}
.cblv-axis .t.core i{height:30px;width:2px;background:${LEVEL_COLORS.cb};box-shadow:0 0 10px ${alpha(LEVEL_COLORS.cb, 0.5)}}
.cblv-axis .t.core span{color:${LEVEL_COLORS.cb}}

/* ── SECTION SEPARATORS ──
   The five zones are drawn as full-height rules behind the content, and each
   band gets a header carrying its own count. Without them the cloud reads as
   one undifferentiated smear of names and "how many are at the core" is a
   question you have to answer by counting. */
.cblv-sep{position:absolute;top:0;bottom:0;width:1px;background:${alpha(HOME_THEME.text, 0.14)};pointer-events:none}
.cblv-sep.core{background:${alpha(LEVEL_COLORS.cb, 0.34)};box-shadow:0 0 8px ${alpha(LEVEL_COLORS.cb, 0.14)}}
.cblv-band{position:absolute;top:0;bottom:0;pointer-events:none}
.cblv-zhdr{position:relative;height:24px;margin-bottom:2px;flex-shrink:0}
.cblv-zhdr > div{position:absolute;top:0;text-align:center;font-size:9px;font-weight:800;
  letter-spacing:.09em;text-transform:uppercase;padding-top:5px}

/* ── CLOUD ── */
.cblv-lanes{position:relative;overflow:auto;padding-top:5px;min-height:120px}
.cblv-chip{position:absolute;transform:translateX(-50%);font-weight:800;letter-spacing:.02em;
  padding:2px 7px;border-radius:5px;white-space:nowrap;cursor:pointer;
  border:1px solid ${alpha(HOME_THEME.text, 0.14)};background:${alpha(HOME_THEME.text, 0.05)};
  color:${alpha(HOME_THEME.text, 0.8)};transition:transform .08s,border-color .08s,background .08s}
.cblv-chip:hover{border-color:${HOME_THEME.text};background:${alpha(HOME_THEME.text, 0.18)};z-index:6;
  transform:translateX(-50%) translateY(-1px)}
.cblv-chip.pin{color:${LEVEL_COLORS.onSolid};background:${HOME_THEME.text};border-color:${HOME_THEME.text};
  box-shadow:0 0 0 2px ${alpha(HOME_THEME.text, 0.16)}}

/* ── RIDGE ── */
.cblv-bar{position:absolute;bottom:0;padding:0 1px}
.cblv-bar > i{display:block;width:100%;height:100%;border-radius:3px 3px 0 0}
.cblv-tail{border-radius:14px;border:1px solid ${HOME_THEME.border};background:${alpha(HOME_THEME.text, 0.02)};padding:12px 14px}
.cblv-tc{font-size:10.5px;font-weight:800;padding:3px 7px;border-radius:5px;cursor:pointer;white-space:nowrap}
.cblv-tc:hover{filter:brightness(1.35)}

/* ── SWARM ── */
.cblv-grp{display:grid;grid-template-columns:126px minmax(0,1fr) 64px;gap:12px;align-items:center;
  padding:9px 0;border-bottom:1px solid ${alpha(HOME_THEME.text, 0.05)}}
.cblv-swarm{position:relative}
.cblv-dot{position:absolute;transform:translate(-50%,-50%);border-radius:50%;cursor:pointer;
  border:1px solid ${alpha(HOME_THEME.text, 0.35)};transition:transform .08s}
.cblv-dot:hover{transform:translate(-50%,-50%) scale(1.7);z-index:8;border-color:${HOME_THEME.text}}

/* ── QUADRANTS ── */
.cblv-plot{position:relative;height:clamp(420px,60vh,680px);border-radius:14px;overflow:hidden;
  border:1px solid ${alpha(HOME_THEME.text, 0.08)};background:${alpha(HOME_THEME.text, 0.012)}}
.cblv-pd{position:absolute;transform:translate(-50%,-50%);border-radius:50%;cursor:pointer;transition:transform .08s}
.cblv-pd:hover{transform:translate(-50%,-50%) scale(1.6);z-index:9}
.cblv-qlab{position:absolute;font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
  color:${alpha(HOME_THEME.text, 0.24)};pointer-events:none}

/* ── DESK ── */
.cblv-desk{display:grid;grid-template-columns:236px minmax(0,1fr) 252px;gap:14px;
  height:clamp(460px,64vh,720px);flex-shrink:0}
@media (max-width:1200px){.cblv-desk{grid-template-columns:200px minmax(0,1fr);}
  .cblv-desk > :last-child{display:none}}
@media (max-width:820px){.cblv-desk{grid-template-columns:minmax(0,1fr)}
  .cblv-desk > :first-child{display:none}}
.cblv-col{display:flex;flex-direction:column;min-height:0;overflow:hidden}
.cblv-colhd{padding:10px 12px;border-bottom:1px solid ${HOME_THEME.border};display:flex;
  align-items:center;gap:8px;flex:0 0 auto}
.cblv-scroll{overflow:auto;min-height:0;flex:1 1 auto}
.cblv-lrow{display:grid;grid-template-columns:54px 1fr 46px;gap:8px;align-items:center;padding:7px 12px;
  cursor:pointer;border-bottom:1px solid ${alpha(HOME_THEME.text, 0.045)}}
.cblv-lrow:hover{background:${alpha(LIGHT_BLUE, 0.07)}}
.cblv-lrow.sel{background:${alpha(LIGHT_BLUE, 0.13)};box-shadow:inset 3px 0 0 ${LIGHT_BLUE}}
.cblv-rail{position:relative;height:5px;border-radius:2px;background:${alpha(HOME_THEME.text, 0.08)}}
.cblv-rail i{position:absolute;top:-1px;height:7px;width:2px;border-radius:1px}

/* ── MONITOR ── */
.cblv-tbl{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.cblv-tbl thead th{position:sticky;top:0;z-index:2;white-space:nowrap;text-align:right;padding:9px 12px;
  font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
  color:${alpha(HOME_THEME.text, 0.42)};background:${alpha(HOME_THEME.bg, 0.97)};
  backdrop-filter:blur(8px);border-bottom:1px solid ${alpha(HOME_THEME.text, 0.14)}}
.cblv-tbl th.srt{cursor:pointer}
.cblv-tbl th.srt:hover,.cblv-tbl th.act{color:${LIGHT_BLUE}}
.cblv-tbl tbody td{padding:5px 12px;font-size:12px;text-align:right;white-space:nowrap;
  border-bottom:1px solid ${alpha(HOME_THEME.text, 0.05)}}
.cblv-tbl thead th:first-child,.cblv-tbl tbody td:first-child{text-align:left}
.cblv-tbl tbody tr{cursor:pointer}
.cblv-tbl tbody tr:nth-child(even){background:${alpha(HOME_THEME.text, 0.018)}}
.cblv-tbl tbody tr:hover{background:${alpha(LIGHT_BLUE, 0.07)}}
.cblv-tbl tbody tr.pin{background:${alpha(HOME_THEME.text, 0.1)};box-shadow:inset 3px 0 0 ${HOME_THEME.text}}
.cblv-tbl tbody tr.grp{cursor:default}
/* Group headers are STRUCTURE, not data. They were light-blue, which is the
   ticker colour — a regime name reading in the same ink as a symbol made the
   row look like an entry rather than a divider. Plain white ink; the tint on
   the row is what separates it. */
.cblv-tbl tbody tr.grp td{background:${alpha(HOME_THEME.text, 0.05)};font-size:9px;font-weight:800;
  letter-spacing:.12em;text-transform:uppercase;color:${HOME_THEME.text};padding:6px 12px;
  border-bottom:1px solid ${HOME_THEME.border};text-align:left}
.cblv-cellbar{position:relative;height:9px;width:150px;border-radius:2px;
  background:${alpha(HOME_THEME.text, 0.07)};display:inline-block;vertical-align:middle}
.cblv-cellbar i{position:absolute;top:-2px;height:13px;border-radius:1px}

/* ── LANES ── */
.cblv-lanesgrid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;align-items:start;flex-shrink:0}
@media (max-width:1200px){.cblv-lanesgrid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:760px){.cblv-lanesgrid{grid-template-columns:minmax(0,1fr)}}
.cblv-lane{display:flex;flex-direction:column;min-height:340px;border-radius:16px;overflow:hidden;
  border:1px solid ${HOME_THEME.border};background:${HOME_THEME.panelBg}}
.cblv-lchip{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;padding:6px 8px;
  border-radius:7px;background:${alpha(HOME_THEME.text, 0.035)};border:1px solid ${alpha(HOME_THEME.text, 0.08)};
  cursor:pointer;transition:transform .08s,border-color .08s}
.cblv-lchip:hover{border-color:${alpha(HOME_THEME.text, 0.4)};transform:translateY(-1px)}
.cblv-lchip.pin{background:${alpha(HOME_THEME.text, 0.14)};border-color:${HOME_THEME.text}}
`;

// ── Small shared bits ────────────────────────────────────────────────────────

const labelStyle: CSSProperties = {
  fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
  color: alpha(HOME_THEME.text, 0.4), whiteSpace: "nowrap",
};
const tickerStyle: CSSProperties = { color: LIGHT_BLUE, fontWeight: 800, letterSpacing: "0.03em" };
const deltaColor = (n: number | null) =>
  n == null ? alpha(HOME_THEME.text, 0.4) : n >= 0 ? ES_CANDLE_UP : ES_CANDLE_DOWN;

/** The ±3% rule, drawn once and reused by every board mode. */
function Axis() {
  return (
    <div className="cblv-axis">
      <div className="ln" />
      {[-3, -2, -1, 0, 1, 2, 3].map((v) => (
        <div key={v} className={`t${v === 0 ? " core" : ""}`} style={{ left: `${axisX(v)}%` }}>
          <i />
          <span>{v === 0 ? "CORE" : `${v > 0 ? "+" : ""}${v}%`}</span>
        </div>
      ))}
    </div>
  );
}

/** The five section separators + their counted headers. Shared by CLOUD/SWARM. */
function ZoneHeader({ marks }: { marks: Mark[] }) {
  const edges = [-AXIS_CLAMP, ...ZONE_EDGES, AXIS_CLAMP];
  const colors = [LEVEL_COLORS.pw, alpha(LEVEL_COLORS.pw, 0.55), LEVEL_COLORS.cb, alpha(LEVEL_COLORS.cw, 0.55), LEVEL_COLORS.cw];
  return (
    <div className="cblv-zhdr">
      {ZONE_NAMES.map((nm, i) => {
        const lo = edges[i], hi = edges[i + 1];
        const n = marks.filter((m) => m.dPct != null && m.dPct >= lo && m.dPct < hi).length;
        const a = axisX(lo), b = axisX(hi);
        return (
          <div key={nm} style={{ left: `${a}%`, width: `${b - a}%`, color: colors[i], borderBottom: `1px solid ${HOME_THEME.border}`, opacity: 0.9 }}>
            {nm} · {n}
          </div>
        );
      })}
    </div>
  );
}

/** The separator rules themselves, absolutely positioned inside a plot area. */
function Separators() {
  return (
    <>
      {ZONE_EDGES.map((v) => (
        <span key={v} className={`cblv-sep${Math.abs(v) < 0.3 ? " core" : ""}`} style={{ left: `${axisX(v)}%` }} />
      ))}
    </>
  );
}

// ── BOARD · CLOUD ────────────────────────────────────────────────────────────
/**
 * Every ticker named, packed into lanes so no two chips overlap, with the five
 * sections separated and counted. Type WEIGHT scales with |net GEX| so the names
 * that actually move the tape read heavier — a size channel, not another colour,
 * because colour is already spoken for.
 */
function BoardCloud({ marks, pins, onToggle }: { marks: Mark[]; pins: string[]; onToggle: (s: string) => void }) {
  const plotted = useMemo(() => marks.filter((m) => m.dPct != null), [marks]);
  const gmax = Math.max(1, ...plotted.map((m) => Math.abs(m.gex)));

  // Greedy lane packing left-to-right. A chip's width is estimated from its
  // symbol length; the estimate only has to be conservative, since a lane that
  // ends up short just uses one extra row.
  const lanes = useMemo(() => {
    const out: { last: number; items: { m: Mark; x: number }[] }[] = [];
    [...plotted].sort((a, b) => (a.dPct as number) - (b.dPct as number)).forEach((m) => {
      const x = axisX(m.dPct as number);
      const w = m.symbol.length * 0.42 + 2.4;
      let lane = out.find((l) => l.last < x - w);
      if (!lane) { lane = { last: -99, items: [] }; out.push(lane); }
      lane.last = x;
      lane.items.push({ m, x });
    });
    return out;
  }, [plotted]);

  return (
    <>
      <ZoneHeader marks={plotted} />
      <Axis />
      <div className="cblv-lanes" style={{ maxHeight: "min(52vh, 470px)" }}>
        <Separators />
        {lanes.map((lane, i) => (
          <div key={i} style={{ position: "relative", height: 22 }}>
            {lane.items.map(({ m, x }) => {
              const pinned = pins.includes(m.symbol);
              const c = zoneColor(m.zone);
              const size = 9.4 + Math.pow(Math.abs(m.gex) / gmax, 0.55) * 3.6;
              return (
                <div
                  key={m.symbol}
                  className={`cblv-chip${pinned ? " pin" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onToggle(m.symbol)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(m.symbol); } }}
                  style={{
                    left: `${x}%`,
                    fontSize: size,
                    ...(pinned ? {} : m.zone ? { color: c, borderColor: alpha(c, 0.42), background: alpha(c, 0.08) } : {}),
                  }}
                  title={[
                    `${m.symbol} — ${fmtSigned(m.dPct as number)}% from core`,
                    m.spot != null ? `spot ${fmtSpot(m.spot)}` : null,
                    m.row.cb != null ? `CB ${fmtLevel(m.row.cb)}` : null,
                    m.row.call_wall != null ? `CW ${fmtLevel(m.row.call_wall)}` : null,
                    m.row.put_wall != null ? `PW ${fmtLevel(m.row.put_wall)}` : null,
                    m.row.total_net_gex != null ? `net GEX ${fmtGex(m.row.total_net_gex)}` : null,
                    pinned ? "pinned — click to unpin" : "click to pin",
                  ].filter(Boolean).join("\n")}
                >
                  {m.symbol}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

// ── BOARD · RIDGE ────────────────────────────────────────────────────────────
/**
 * The same axis as a binned histogram. Only the TAILS get named, because a name
 * is what you need for the handful that have left their walls and noise for the
 * 140 that have not. Bars are percentage-geometry divs rather than an SVG path
 * so the chart is exact at any width without a viewBox.
 */
function BoardRidge({ marks, pins, onToggle }: { marks: Mark[]; pins: string[]; onToggle: (s: string) => void }) {
  const BW = 0.25;
  /**
   * Bars are sized as a PERCENTAGE of the plot, not in px, so the chart can take
   * a viewport-relative height and stay correct at any window size. 86% leaves
   * headroom for the peak callout, which sits above the tallest bar.
   */
  const BAR_MAX_PCT = 86;
  const plotted = useMemo(() => marks.filter((m) => m.dPct != null), [marks]);

  const bins = useMemo(() => {
    const b: { lo: number; hi: number; n: number; out: number; outc: number }[] = [];
    for (let v = -AXIS_CLAMP; v < AXIS_CLAMP - 1e-9; v += BW) b.push({ lo: v, hi: v + BW, n: 0, out: 0, outc: 0 });
    plotted.forEach((m) => {
      const d = Math.max(-AXIS_CLAMP + 1e-6, Math.min(AXIS_CLAMP - 1e-6, m.dPct as number));
      const hit = b[Math.floor((d + AXIS_CLAMP) / BW)];
      if (!hit) return;
      hit.n++;
      if (m.zone === "out") hit.out++;
      if (m.zone === "outc") hit.outc++;
    });
    return b;
  }, [plotted]);

  const max = Math.max(1, ...bins.map((b) => b.n));
  const colW = axisX(BW) - axisX(0);
  const peak = bins.reduce((a, b) => (b.n > a.n ? b : a), bins[0]);

  const below = plotted.filter((m) => m.zone === "out").sort((a, b) => (a.dPct as number) - (b.dPct as number));
  const above = plotted.filter((m) => m.zone === "outc").sort((a, b) => (b.dPct as number) - (a.dPct as number));

  const tail = (nm: string, arr: Mark[], c: string) => (
    <div className="cblv-tail">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: c }}>{arr.length}</span>
        <span style={labelStyle}>{nm}</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: alpha(HOME_THEME.text, 0.3) }}>click to pin</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {arr.slice(0, 30).map((m) => (
          <span
            key={m.symbol}
            className="cblv-tc"
            role="button"
            tabIndex={0}
            onClick={() => onToggle(m.symbol)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(m.symbol); } }}
            style={{
              color: pins.includes(m.symbol) ? LEVEL_COLORS.onSolid : c,
              background: pins.includes(m.symbol) ? c : alpha(c, 0.08),
              border: `1px solid ${alpha(c, 0.45)}`,
            }}
          >
            {m.symbol} {fmtSigned(m.dPct as number)}
          </span>
        ))}
        {arr.length > 30 && (
          <span className="cblv-tc" style={{ color: alpha(HOME_THEME.text, 0.3) }}>+{arr.length - 30}</span>
        )}
        {arr.length === 0 && (
          <span style={{ fontSize: 11, color: alpha(HOME_THEME.text, 0.32) }}>nothing out here right now</span>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div style={{ position: "relative", height: "clamp(360px, 50vh, 620px)", marginBottom: 2 }}>
        <Separators />
        {bins.map((b) => {
          if (!b.n) return null;
          const mid = (b.lo + b.hi) / 2;
          const c = mid < 0 && b.out ? LEVEL_COLORS.pw
            : mid > 0 && b.outc ? LEVEL_COLORS.cw
            : Math.abs(mid) < 0.3 ? LEVEL_COLORS.cb
            : LIGHT_BLUE;
          return (
            <div
              key={b.lo}
              className="cblv-bar"
              style={{ left: `${axisX(b.lo)}%`, width: `${colW}%`, height: `${(b.n / max) * BAR_MAX_PCT}%` }}
              title={`${b.n} tickers · ${b.lo.toFixed(2)}…${b.hi.toFixed(2)}% from core`}
            >
              <i style={{ background: `linear-gradient(180deg, ${alpha(c, 0.8)}, ${alpha(c, 0.13)})`, boxShadow: `inset 0 1px 0 ${c}` }} />
            </div>
          );
        })}
        {peak && peak.n > 0 && (
          <div
            style={{
              position: "absolute", left: `${axisX((peak.lo + peak.hi) / 2)}%`,
              bottom: `calc(${(peak.n / max) * BAR_MAX_PCT}% + 8px)`, transform: "translateX(-50%)",
              fontSize: 10, fontWeight: 800, color: LEVEL_COLORS.cb, whiteSpace: "nowrap",
            }}
          >
            {peak.n} within {peak.lo.toFixed(2)}…{peak.hi.toFixed(2)}%
          </div>
        )}
        {pins
          .map((s) => plotted.find((m) => m.symbol === s))
          .filter((m): m is Mark => !!m)
          .sort((a, b) => (a.dPct as number) - (b.dPct as number))
          .map((m, i) => (
            <div
              key={m.symbol}
              style={{
                position: "absolute", left: `${axisX(m.dPct as number)}%`, bottom: 6 + i * 20,
                transform: "translateX(-50%)", fontSize: 9.5, fontWeight: 800,
                color: LEVEL_COLORS.onSolid, background: HOME_THEME.text, padding: "2px 7px",
                borderRadius: 5, whiteSpace: "nowrap", boxShadow: `0 2px 8px ${alpha(HOME_THEME.bg, 0.6)}`,
              }}
            >
              {m.symbol} {fmtSigned(m.dPct as number)}%
            </div>
          ))}
      </div>
      <Axis />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 18 }}>
        {tail("below put wall", below, LEVEL_COLORS.pw)}
        {tail("above call wall", above, LEVEL_COLORS.cw)}
      </div>
    </>
  );
}

// ── BOARD · SWARM ────────────────────────────────────────────────────────────
/**
 * One swarm row per sector. This is the only mode that answers a question about
 * CORRELATION rather than about a ticker: semis stacked right of core while
 * energy sits left is a rotation read, and the mean on the right makes the rows
 * sortable so the strongest group is always on top.
 */
function BoardSwarm({ marks, pins, onToggle }: { marks: Mark[]; pins: string[]; onToggle: (s: string) => void }) {
  const plotted = marks.filter((m) => m.dPct != null);
  const gmax = Math.max(1, ...plotted.map((m) => Math.abs(m.gex)));

  const rows = useMemo(() => {
    const by = new Map<string, Mark[]>();
    plotted.forEach((m) => {
      const list = by.get(m.sector);
      if (list) list.push(m); else by.set(m.sector, [m]);
    });
    return [...by.entries()]
      .map(([sector, ms]) => ({
        sector, ms,
        mean: ms.reduce((s, m) => s + (m.dPct as number), 0) / ms.length,
      }))
      .sort((a, b) => b.mean - a.mean);
  }, [plotted]);

  return (
    <>
      <ZoneHeader marks={plotted} />
      <Axis />
      <div style={{ position: "relative" }}>
        <Separators />
        {rows.map(({ sector, ms, mean }) => {
          // EVERY dot is labelled, so the packer has to reserve room for the
          // LABEL and not just the dot — a swarm whose names overlap is worse
          // than a taller row. Lane count is whatever the row needed; the row
          // grows to fit rather than folding names back on top of each other.
          const used: { lane: number; x: number; w: number }[] = [];
          const placed = [...ms]
            .sort((a, b) => (a.dPct as number) - (b.dPct as number))
            .map((m) => {
              const x = axisX(m.dPct as number);
              const w = m.symbol.length * 0.46 + 1.6;
              let lane = 0;
              while (used.some((u) => u.lane === lane && Math.abs(u.x - x) < (u.w + w) / 2)) lane++;
              used.push({ lane, x, w });
              return { m, x, lane };
            });
          const laneCount = Math.max(1, ...placed.map((p) => p.lane + 1));
          return (
            <div key={sector} className="cblv-grp">
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: alpha(HOME_THEME.text, 0.55) }}>
                  {sector}
                </div>
                <div style={{ fontSize: 9, fontWeight: 700, color: alpha(HOME_THEME.text, 0.26), marginTop: 2 }}>
                  {ms.length} name{ms.length === 1 ? "" : "s"}
                </div>
              </div>
              <div className="cblv-swarm" style={{ height: laneCount * 19 + 8 }}>
                <span style={{ position: "absolute", left: `${axisX(0)}%`, top: 2, bottom: 2, width: 1, background: alpha(LEVEL_COLORS.cb, 0.35) }} />
                {placed.map(({ m, x, lane }) => {
                  const top = 4 + lane * 19;
                  const sz = 5 + Math.pow(Math.abs(m.gex) / gmax, 0.55) * 7;
                  const pinned = pins.includes(m.symbol);
                  const c = pinned ? HOME_THEME.text : deltaColor(m.dPct);
                  return (
                    <span key={m.symbol}>
                      <span
                        className="cblv-dot"
                        role="button"
                        tabIndex={0}
                        onClick={() => onToggle(m.symbol)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(m.symbol); } }}
                        style={{
                          left: `${x}%`, top: top + 13, width: sz, height: sz,
                          background: pinned ? HOME_THEME.text : alpha(c, 0.75),
                          borderColor: pinned ? HOME_THEME.text : alpha(HOME_THEME.text, 0.35),
                        }}
                        title={`${m.symbol} · ${fmtSigned(m.dPct as number)}% from core · net GEX ${fmtGex(m.gex)}`}
                      />
                      <span
                        style={{
                          position: "absolute", left: `${x}%`, top, transform: "translateX(-50%)",
                          fontSize: 8.5, fontWeight: 800, whiteSpace: "nowrap", pointerEvents: "none",
                          color: pinned ? HOME_THEME.text : alpha(HOME_THEME.text, 0.62),
                        }}
                      >
                        {m.symbol}
                      </span>
                    </span>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, textAlign: "right", color: deltaColor(mean) }}>
                {fmtSigned(mean)}%
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── BOARD · QUADRANTS ────────────────────────────────────────────────────────
/**
 * x = distance from core, y = net GEX. The quadrant a name lands in IS the
 * setup, which is why this is the only mode that gives a thesis rather than a
 * position.
 *
 * y uses a SIGNED SQRT scale on purpose. A handful of index names carry net GEX
 * an order of magnitude above everything else; on a linear axis they own the
 * extremes and the other 160 collapse into one band across the middle.
 */
function BoardQuadrants({ marks, pins, onToggle }: { marks: Mark[]; pins: string[]; onToggle: (s: string) => void }) {
  const plotted = marks.filter((m) => m.dPct != null);
  const gmax = Math.max(1, ...plotted.map((m) => Math.abs(m.gex)));
  const yOf = (g: number) => 50 - Math.sign(g) * Math.sqrt(Math.abs(g) / gmax) * 45;

  return (
    <div style={{ display: "flex", gap: 10 }}>
      <div style={{ width: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ ...labelStyle, writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
          Net GEX → positive
        </span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="cblv-plot">
          <div style={{ position: "absolute", left: "50%", top: 0, width: "50%", height: "50%", background: `linear-gradient(225deg, ${alpha(ES_CANDLE_UP, 0.055)}, transparent 70%)` }} />
          <div style={{ position: "absolute", left: 0, top: "50%", width: "50%", height: "50%", background: `linear-gradient(45deg, ${alpha(ES_CANDLE_DOWN, 0.06)}, transparent 70%)` }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: alpha(HOME_THEME.text, 0.16) }} />
          <div style={{ position: "absolute", left: `${axisX(0)}%`, top: 0, bottom: 0, width: 1, background: alpha(LEVEL_COLORS.cb, 0.4) }} />
          <span className="cblv-qlab" style={{ left: 14, top: 12 }}>below core · long gamma — magnet back up</span>
          <span className="cblv-qlab" style={{ right: 14, top: 12, color: alpha(ES_CANDLE_UP, 0.5) }}>above core · long gamma — pinned / suppressed</span>
          <span className="cblv-qlab" style={{ left: 14, bottom: 12, color: alpha(ES_CANDLE_DOWN, 0.5) }}>below core · short gamma — unstable</span>
          <span className="cblv-qlab" style={{ right: 14, bottom: 12 }}>above core · short gamma — chase risk</span>

          {plotted.map((m) => {
            const x = axisX(m.dPct as number), y = yOf(m.gex);
            const pinned = pins.includes(m.symbol);
            const sz = 5 + Math.pow(Math.abs(m.gex) / gmax, 0.5) * 11;
            const c = pinned ? HOME_THEME.text : alpha(m.gex >= 0 ? ES_CANDLE_UP : ES_CANDLE_DOWN, 0.55);
            // EVERY dot carries its symbol. The plot is dense, so the label is
            // small and gets a dark halo rather than being withheld — a name you
            // have to hover for is not a label.
            return (
              <span key={m.symbol}>
                <span
                  className="cblv-pd"
                  role="button"
                  tabIndex={0}
                  onClick={() => onToggle(m.symbol)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(m.symbol); } }}
                  style={{
                    left: `${x}%`, top: `${y}%`, width: sz, height: sz, background: c,
                    border: `1px solid ${pinned ? HOME_THEME.text : alpha(HOME_THEME.text, 0.28)}`,
                  }}
                  title={`${m.symbol} · ${fmtSigned(m.dPct as number)}% from core · net GEX ${fmtGex(m.gex)}`}
                />
                <span
                  style={{
                    position: "absolute", left: `${x}%`, top: `calc(${y}% - ${sz / 2 + 9}px)`,
                    transform: "translateX(-50%)", fontSize: 8.5, fontWeight: 800, whiteSpace: "nowrap",
                    pointerEvents: "none", color: pinned ? HOME_THEME.text : alpha(HOME_THEME.text, 0.62),
                    textShadow: `0 1px 3px ${HOME_THEME.bg}, 0 0 6px ${HOME_THEME.bg}`,
                  }}
                >
                  {m.symbol}
                </span>
              </span>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <span style={labelStyle}>← below core</span>
          <span style={{ ...labelStyle, color: LEVEL_COLORS.cb }}>core</span>
          <span style={labelStyle}>above core →</span>
        </div>
      </div>
    </div>
  );
}

// ── DESK ─────────────────────────────────────────────────────────────────────
/**
 * Rail + one large price-scaled ladder + a compare stack. The previous page's
 * dock put four ladders side by side at ~300px each, which is exactly why the
 * ladder was unreadable. One at a time, full width.
 */
function DeskView({
  marks, selected, onSelect, pins, onToggle, show,
}: {
  marks: Mark[];
  selected: string | null;
  onSelect: (s: string) => void;
  pins: string[];
  onToggle: (s: string) => void;
  show: Record<LevelKey, boolean>;
}) {
  const list = useMemo(
    () => [...marks].sort((a, b) =>
      (Number(pins.includes(b.symbol)) - Number(pins.includes(a.symbol))) ||
      (Math.abs(a.dPct ?? 1e9) - Math.abs(b.dPct ?? 1e9))),
    [marks, pins],
  );
  const sel = marks.find((m) => m.symbol === selected) ?? list[0] ?? null;

  const ladder = (() => {
    if (!sel) return null;
    const r = sel.row;
    const wanted = [
      show.cb && r.cb != null ? { k: "CB", v: r.cb, c: LEVEL_COLORS.cb } : null,
      show.cw && r.call_wall != null ? { k: "CW", v: r.call_wall, c: LEVEL_COLORS.cw } : null,
      show.pw && r.put_wall != null ? { k: "PW", v: r.put_wall, c: LEVEL_COLORS.pw } : null,
      show.flip && r.gex_flip != null ? { k: "FLIP", v: r.gex_flip, c: HOME_THEME.cyan } : null,
    ].filter((x): x is { k: string; v: number; c: string } => x != null);
    const pts = [...wanted.map((w) => w.v), ...(sel.spot != null ? [sel.spot] : [])];
    if (!pts.length) return null;
    const rawHi = Math.max(...pts), rawLo = Math.min(...pts);
    const span = rawHi - rawLo || Math.max(Math.abs(rawHi) * 0.004, 0.02);
    const hi = rawHi + span * 0.16, lo = rawLo - span * 0.16;
    return { wanted, y: (v: number) => ((hi - v) / (hi - lo)) * 100 };
  })();

  return (
    <div className="cblv-desk">
      {/* rail */}
      <Card variant="budget" padding={0} className="cblv-col">
        <div className="cblv-colhd">
          <span style={labelStyle}>Roster</span>
          <span style={{ marginLeft: "auto", fontSize: 9, color: alpha(HOME_THEME.text, 0.3) }}>{list.length}</span>
        </div>
        <div className="cblv-scroll">
          {list.map((m) => (
            <div
              key={m.symbol}
              className={`cblv-lrow${sel && m.symbol === sel.symbol ? " sel" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(m.symbol)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(m.symbol); } }}
            >
              <span style={{ ...tickerStyle, fontSize: 11.5 }}>{m.symbol}</span>
              <span className="cblv-rail">
                {m.cbPos != null && <i style={{ left: `${m.cbPos}%`, background: LEVEL_COLORS.cb }} />}
                {m.pos != null && <i style={{ left: `${m.pos}%`, background: HOME_THEME.text }} />}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, textAlign: "right", color: deltaColor(m.dPct) }}>
                {m.dPct == null ? "—" : fmtSigned(m.dPct)}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* stage */}
      <Card variant="budget" padding={0} className="cblv-col">
        {!sel ? (
          <div style={{ padding: 24, fontSize: 13, color: alpha(HOME_THEME.text, 0.5) }}>
            Nothing to show yet — the recorder writes one row per ticker every 5 minutes.
          </div>
        ) : (
          <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
              <span style={{ ...tickerStyle, fontSize: 30, lineHeight: 1 }}>{sel.symbol}</span>
              <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>
                {sel.spot != null ? fmtSpot(sel.spot) : "—"}
              </span>
              <span style={{ fontSize: 13, fontWeight: 800, color: deltaColor(sel.dPct) }}>
                {sel.dPct == null ? "—" : `${fmtSigned(sel.dPct)}% vs core`}
              </span>
              <span style={{ ...labelStyle, marginLeft: "auto" }}>
                {sel.row.stale ? `STALE ${sel.row.date.slice(5)}` : `${dteOf(sel.row.expiry) ?? "—"}DTE`} · sweep {fmtClock(sel.row.ts)} ET
              </span>
            </div>

            <div style={{ position: "relative", flex: "1 1 auto", minHeight: DESK_RAIL_MIN, margin: "16px 0 8px" }}>
              {ladder?.wanted.map((w) => (
                <div key={w.k} style={{ position: "absolute", left: 0, right: 0, top: `${ladder.y(w.v)}%`, transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ flex: "0 0 auto", fontSize: 8, fontWeight: 800, letterSpacing: "0.06em", padding: "1px 5px", borderRadius: 3, color: w.c, border: `1px solid ${w.c}` }}>
                    {w.k}
                  </span>
                  <span style={{ flex: "1 1 auto", height: 1, background: w.c, opacity: 0.42 }} />
                  <span style={{ flex: "0 0 auto", fontSize: 12, fontWeight: 800, color: w.c }}>{fmtLevel(w.v)}</span>
                </div>
              ))}
              {ladder && sel.spot != null && (
                <div style={{ position: "absolute", left: 0, right: 0, top: `${ladder.y(sel.spot)}%`, transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ flex: "1 1 auto", borderTop: `1px dashed ${alpha(HOME_THEME.text, 0.5)}` }} />
                  <span style={{ flex: "0 0 auto", fontSize: 12, fontWeight: 800, padding: "2px 9px", borderRadius: 7, background: HOME_THEME.panelBgStrong, border: `1px solid ${alpha(HOME_THEME.text, 0.24)}` }}>
                    {fmtSpot(sel.spot)}
                  </span>
                  <span style={{ flex: "1 1 auto", borderTop: `1px dashed ${alpha(HOME_THEME.text, 0.5)}` }} />
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, paddingTop: 12, borderTop: `1px solid ${HOME_THEME.border}` }}>
              {([
                ["Net GEX", sel.row.total_net_gex == null ? "—" : fmtGex(sel.row.total_net_gex), sel.row.total_net_gex == null ? undefined : deltaColor(sel.row.total_net_gex)],
                ["Wall span", sel.row.call_wall != null && sel.row.put_wall != null ? fmtLevel(sel.row.call_wall - sel.row.put_wall) : "—", undefined],
                ["Pos in range", sel.pos == null ? "—" : `${Math.round(sel.pos)}%`, undefined],
                ["Expiry", sel.row.expiry ? `${dteOf(sel.row.expiry) ?? "—"}D` : "—", undefined],
              ] as [string, string, string | undefined][]).map(([k, v, c]) => (
                <div key={k}>
                  <div style={labelStyle}>{k}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, marginTop: 3, color: c ?? HOME_THEME.text }}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              <button style={pins.includes(sel.symbol) ? homeButtonStyle : homeSecondaryButtonStyle} onClick={() => onToggle(sel.symbol)}>
                {pins.includes(sel.symbol) ? "Remove from compare" : "Add to compare"}
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* compare */}
      <Card variant="budget" padding={0} className="cblv-col">
        <div className="cblv-colhd">
          <span style={labelStyle}>Compare</span>
          <span style={{ marginLeft: "auto", fontSize: 9, color: alpha(HOME_THEME.text, 0.3) }}>{pins.length} / {MAX_PINS}</span>
        </div>
        <div className="cblv-scroll">
          {pins.map((s) => {
            const m = marks.find((x) => x.symbol === s);
            if (!m) return null;
            return (
              <div
                key={s}
                style={{ padding: "11px 12px", borderBottom: `1px solid ${alpha(HOME_THEME.text, 0.05)}`, cursor: "pointer" }}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(s)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(s); } }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 11, marginBottom: 6 }}>
                  <span style={tickerStyle}>{m.symbol}</span>
                  <span style={{ fontWeight: 800 }}>{m.spot != null ? fmtSpot(m.spot) : "—"}</span>
                  <span style={{ fontWeight: 800, color: deltaColor(m.dPct) }}>{m.dPct == null ? "—" : `${fmtSigned(m.dPct)}%`}</span>
                </div>
                <div className="cblv-rail" style={{ height: 6 }}>
                  {m.cbPos != null && <i style={{ left: `${m.cbPos}%`, background: LEVEL_COLORS.cb }} />}
                  {m.pos != null && <i style={{ left: `${m.pos}%`, background: HOME_THEME.text }} />}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 9.5, fontWeight: 700 }}>
                  <span style={{ color: LEVEL_COLORS.pw }}>{m.row.put_wall != null ? fmtLevel(m.row.put_wall) : "—"}</span>
                  <span style={{ color: LEVEL_COLORS.cb }}>{m.row.cb != null ? fmtLevel(m.row.cb) : "—"}</span>
                  <span style={{ color: LEVEL_COLORS.cw }}>{m.row.call_wall != null ? fmtLevel(m.row.call_wall) : "—"}</span>
                </div>
              </div>
            );
          })}
          {pins.length === 0 && (
            <div style={{ padding: 16, margin: 10, textAlign: "center", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: alpha(HOME_THEME.text, 0.22), border: `1px dashed ${alpha(HOME_THEME.text, 0.12)}`, borderRadius: 10 }}>
              NOTHING PINNED
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ── MONITOR ──────────────────────────────────────────────────────────────────
/** Every level as a column, grouped by regime, sortable. The one you leave open. */
function MonitorView({
  marks, pins, onToggle, sort, setSort, grouped,
}: {
  marks: Mark[];
  pins: string[];
  onToggle: (s: string) => void;
  sort: SortId;
  setSort: (s: SortId) => void;
  grouped: boolean;
}) {
  const HEAD: [string, SortId | null][] = [
    ["Symbol", "az"], ["Spot", null], ["Range · PW → CW", null], ["CB", null], ["Δ CB", "core"],
    ["CW", null], ["PW", null], ["Flip", null], ["Net GEX", "gex"], ["DTE", null], ["Sweep", null],
  ];

  const groups: [string, Mark[]][] = grouped
    ? [
        ["Above call wall", marks.filter((m) => m.zone === "outc")],
        ["Upper half", marks.filter((m) => m.zone !== "outc" && m.zone !== "out" && (m.pos ?? 0) >= 50 && Math.abs(m.dPct ?? 0) >= 0.25)],
        ["At core (±0.25%)", marks.filter((m) => m.zone === "near")],
        ["Lower half", marks.filter((m) => m.zone !== "outc" && m.zone !== "out" && (m.pos ?? 100) < 50 && Math.abs(m.dPct ?? 0) >= 0.25)],
        ["Below put wall", marks.filter((m) => m.zone === "out")],
      ]
    : [["All", marks]];

  const row = (m: Mark) => (
    <tr
      key={m.symbol}
      className={pins.includes(m.symbol) ? "pin" : undefined}
      onClick={() => onToggle(m.symbol)}
    >
      <td><span style={tickerStyle}>{m.symbol}</span>{pins.includes(m.symbol) && <span style={{ fontSize: 8, opacity: 0.6 }}> ●</span>}</td>
      <td style={{ fontWeight: 800 }}>{m.spot != null ? fmtSpot(m.spot) : "—"}</td>
      <td>
        <span className="cblv-cellbar">
          {m.cbPos != null && <i style={{ left: `${m.cbPos}%`, width: 2, background: LEVEL_COLORS.cb }} />}
          {m.pos != null && <i style={{ left: `${m.pos}%`, width: 3, background: HOME_THEME.text }} />}
        </span>
      </td>
      <td style={{ color: LEVEL_COLORS.cb, fontWeight: 700 }}>{m.row.cb != null ? fmtLevel(m.row.cb) : "—"}</td>
      <td style={{ color: deltaColor(m.dPct), fontWeight: 800 }}>{m.dPct == null ? "—" : `${fmtSigned(m.dPct)}%`}</td>
      <td style={{ color: LEVEL_COLORS.cw }}>{m.row.call_wall != null ? fmtLevel(m.row.call_wall) : "—"}</td>
      <td style={{ color: LEVEL_COLORS.pw }}>{m.row.put_wall != null ? fmtLevel(m.row.put_wall) : "—"}</td>
      <td style={{ color: HOME_THEME.cyan }}>{m.row.gex_flip != null ? fmtLevel(m.row.gex_flip) : "—"}</td>
      <td style={{ color: m.row.total_net_gex == null ? alpha(HOME_THEME.text, 0.4) : deltaColor(m.row.total_net_gex), fontWeight: 700 }}>
        {m.row.total_net_gex == null ? "—" : fmtGex(m.row.total_net_gex)}
      </td>
      <td style={{ color: alpha(HOME_THEME.text, 0.5) }}>{dteOf(m.row.expiry) != null ? `${dteOf(m.row.expiry)}D` : "—"}</td>
      <td style={{ fontSize: 10, color: m.row.stale ? HOME_THEME.orange : alpha(HOME_THEME.text, 0.35) }}>
        {m.row.stale ? "STALE" : fmtClock(m.row.ts)}
      </td>
    </tr>
  );

  return (
    <div style={{ maxHeight: "min(70vh, 700px)", overflow: "auto" }}>
      <table className="cblv-tbl">
        <thead>
          <tr>
            {HEAD.map(([h, id]) => (
              <th
                key={h}
                className={`${id ? "srt" : ""}${id && sort === id ? " act" : ""}`.trim() || undefined}
                onClick={id ? () => setSort(id) : undefined}
              >
                {h}{id && sort === id ? " ▲" : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(([nm, rows]) => (
            rows.length === 0 && grouped ? null : (
              <Fragment key={nm}>
                {grouped && (
                  <tr className="grp"><td colSpan={HEAD.length}>{nm} · {rows.length}</td></tr>
                )}
                {rows.map(row)}
              </Fragment>
            )
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── LANES ────────────────────────────────────────────────────────────────────
/** Five buckets by wall position. The COUNT at the top of each lane is the read. */
function LanesView({ marks, pins, onToggle }: { marks: Mark[]; pins: string[]; onToggle: (s: string) => void }) {
  const lanes = [
    { nm: "Below put wall", c: LEVEL_COLORS.pw, sh: "spot has broken the lower wall — dealers short gamma below", ms: marks.filter((m) => m.zone === "out") },
    { nm: "Lower half", c: alpha(LEVEL_COLORS.pw, 0.55), sh: "between put wall and core", ms: marks.filter((m) => m.zone === "" && (m.pos ?? 100) < 50) },
    { nm: "At core", c: LEVEL_COLORS.cb, sh: "within 0.25% of the Core Bullseye — pinned", ms: marks.filter((m) => m.zone === "near") },
    { nm: "Upper half", c: alpha(LEVEL_COLORS.cw, 0.55), sh: "between core and call wall", ms: marks.filter((m) => m.zone === "" && (m.pos ?? 0) >= 50) },
    { nm: "Above call wall", c: LEVEL_COLORS.cw, sh: "spot has cleared the upper wall", ms: marks.filter((m) => m.zone === "outc") },
  ];
  const total = Math.max(1, marks.length);

  return (
    <>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", margin: "0 0 6px" }}>
        {lanes.map((l) => (
          <span key={l.nm} style={{ width: `${(l.ms.length / total) * 100}%`, background: l.c, opacity: 0.75 }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        {lanes.map((l) => <span key={l.nm} style={{ ...labelStyle, fontSize: 8.5 }}>{l.nm}</span>)}
      </div>
      <div className="cblv-lanesgrid">
        {lanes.map((l) => (
          <div key={l.nm} className="cblv-lane">
            <div style={{ padding: "11px 13px 10px", borderBottom: `1px solid ${HOME_THEME.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: l.c }}>{l.nm}</div>
              <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1, marginTop: 3 }}>{l.ms.length}</div>
              <div style={{ fontSize: 9.5, color: alpha(HOME_THEME.text, 0.34), marginTop: 2, lineHeight: 1.4 }}>{l.sh}</div>
            </div>
            <div style={{ padding: 9, display: "flex", flexDirection: "column", gap: 5, overflow: "auto" }}>
              {[...l.ms]
                .sort((a, b) => Math.abs(b.dPct ?? 0) - Math.abs(a.dPct ?? 0))
                .slice(0, 18)
                .map((m) => (
                  <div
                    key={m.symbol}
                    className={`cblv-lchip${pins.includes(m.symbol) ? " pin" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onToggle(m.symbol)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(m.symbol); } }}
                  >
                    <span>
                      <span style={{ ...tickerStyle, fontSize: 11 }}>{m.symbol}</span>{" "}
                      <span style={{ fontSize: 10, fontWeight: 700, color: alpha(HOME_THEME.text, 0.55) }}>
                        {m.row.cb != null ? fmtLevel(m.row.cb) : "—"}
                      </span>
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: deltaColor(m.dPct) }}>
                      {m.dPct == null ? "—" : `${fmtSigned(m.dPct)}%`}
                    </span>
                  </div>
                ))}
            </div>
            <div style={{ marginTop: "auto", padding: "8px 12px", borderTop: `1px solid ${HOME_THEME.border}`, ...labelStyle }}>
              {l.ms.length > 18 ? `+ ${l.ms.length - 18} MORE` : "ALL SHOWN"}
            </div>
          </div>
        ))}
      </div>
    </>
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

  const [view, setView] = useState<ViewId>("board");
  const [board, setBoard] = useState<BoardId>("cloud");
  const [sort, setSort] = useState<SortId>("core");
  const [grouped, setGrouped] = useState(true);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Record<LevelKey, boolean>>({ cb: true, cw: true, pw: true, flip: false });
  const [pins, setPins] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  // Saved prefs + pins. Read AFTER mount so the server-rendered first paint and
  // the client's agree (a localStorage read in useState would not).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<{
          view: ViewId; board: BoardId; sort: SortId; grouped: boolean; show: Record<LevelKey, boolean>;
        }>;
        if (p.view) setView(p.view);
        if (p.board) setBoard(p.board);
        if (p.sort) setSort(p.sort);
        if (typeof p.grouped === "boolean") setGrouped(p.grouped);
        const savedShow = p.show;
        if (savedShow) setShow((s) => ({ ...s, ...savedShow }));
      }
    } catch { /* corrupt or blocked storage — defaults are fine */ }
    try {
      const raw = window.localStorage.getItem(PINS_KEY);
      const list = raw ? (JSON.parse(raw) as unknown) : null;
      if (Array.isArray(list)) setPins(list.map((x) => String(x).toUpperCase()).filter(Boolean).slice(0, MAX_PINS));
    } catch { /* non-fatal */ }
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(PREFS_KEY, JSON.stringify({ view, board, sort, grouped, show })); }
    catch { /* non-fatal */ }
  }, [view, board, sort, grouped, show]);
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

  // ── Derived marks — computed ONCE, consumed by every view ──────────────────
  // Every view reads the same geometry, so two of them cannot disagree about
  // where a ticker sits.
  const marks = useMemo<Mark[]>(() => {
    const uni = new Set(tickers);
    const q = query.trim().toUpperCase();
    const list = rows
      .filter((r) => (uni.size ? uni.has(r.symbol) : true))
      .filter((r) => (q ? r.symbol.includes(q) : true));

    const out = list.map<Mark>((row) => {
      const spot = live[row.symbol] ?? row.spot;
      const cb = row.cb, cw = row.call_wall, pw = row.put_wall;
      const dPct = spot != null && cb ? ((spot - cb) / cb) * 100 : null;
      const span = cw != null && pw != null ? cw - pw : null;
      const at = (v: number | null) =>
        v != null && span && pw != null ? Math.max(0, Math.min(100, ((v - pw) / span) * 100)) : null;
      const zone: Mark["zone"] =
        spot != null && cw != null && spot > cw ? "outc"
        : spot != null && pw != null && spot < pw ? "out"
        : dPct != null && Math.abs(dPct) < 0.25 ? "near"
        : "";
      return {
        row, symbol: row.symbol, spot, dPct,
        pos: at(spot), cbPos: at(cb),
        gex: row.total_net_gex ?? 0,
        sector: SECTOR_MAP[row.symbol] ?? "Other",
        zone,
      };
    });

    const cmp: Record<SortId, (a: Mark, b: Mark) => number> = {
      core: (a, b) => Math.abs(a.dPct ?? 1e9) - Math.abs(b.dPct ?? 1e9),
      gex: (a, b) => Math.abs(b.gex) - Math.abs(a.gex),
      az: (a, b) => a.symbol.localeCompare(b.symbol),
    };
    return out.sort(cmp[sort]);
  }, [rows, tickers, query, live, sort]);

  /** Pinning a fifth drops the OLDEST, so a click is never refused. */
  const togglePin = useCallback((sym: string) => {
    setPins((p) => (p.includes(sym) ? p.filter((x) => x !== sym) : [...p, sym].slice(-MAX_PINS)));
  }, []);

  const liveCount = Object.keys(live).length;
  const seg = (active: boolean) => (active ? homeButtonStyle : homeSecondaryButtonStyle);
  /**
   * NO CARD EDGE OVERRIDE. The previous page drew a bright 1px white border plus
   * a 3px white ring around every card, which is not the dashboard surface — it
   * is a second, louder card style that only this page had. `Card` already owns
   * the look (frosted fill, hairline theme edge, soft shadow) and it is the
   * single source of truth for it; the only thing a card here adds is opting out
   * of flex-shrink, because PageShell's <main> is a scrolling flex column and a
   * flex item shrinks by default even when the container scrolls.
   */
  const cardFlex: CSSProperties = { flexShrink: 0 };

  const VIEWS: [ViewId, string][] = [["board", "Board"], ["desk", "Desk"], ["monitor", "Monitor"], ["lanes", "Lanes"]];
  const BOARDS: [BoardId, string][] = [["cloud", "Cloud"], ["ridge", "Ridge"], ["swarm", "Swarm"], ["quadrants", "Quadrants"]];

  const nearCore = marks.filter((m) => m.zone === "near").length;
  const aboveCw = marks.filter((m) => m.zone === "outc").length;
  const belowPw = marks.filter((m) => m.zone === "out").length;

  const body: ReactNode = marks.length === 0 ? (
    <Card variant="budget" padding={20} style={cardFlex}>
      <div style={{ fontSize: 13, color: alpha(HOME_THEME.text, 0.6) }}>
        {error
          ? `Could not load levels: ${error}`
          : "No scanner snapshots yet — the recorder writes one row per ticker every 5 minutes."}
      </div>
    </Card>
  ) : view === "desk" ? (
    <DeskView marks={marks} selected={selected} onSelect={setSelected} pins={pins} onToggle={togglePin} show={show} />
  ) : view === "monitor" ? (
    <Card variant="budget" padding={0} style={{ ...cardFlex, overflow: "hidden" }}>
      <MonitorView marks={marks} pins={pins} onToggle={togglePin} sort={sort} setSort={setSort} grouped={grouped} />
    </Card>
  ) : view === "lanes" ? (
    <Card variant="budget" padding={18} style={cardFlex}>
      <LanesView marks={marks} pins={pins} onToggle={togglePin} />
    </Card>
  ) : (
    <Card variant="budget" padding="22px 26px 18px" style={cardFlex}>
      {board === "cloud" && <BoardCloud marks={marks} pins={pins} onToggle={togglePin} />}
      {board === "ridge" && <BoardRidge marks={marks} pins={pins} onToggle={togglePin} />}
      {board === "swarm" && <BoardSwarm marks={marks} pins={pins} onToggle={togglePin} />}
      {board === "quadrants" && <BoardQuadrants marks={marks} pins={pins} onToggle={togglePin} />}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 16, paddingTop: 13, borderTop: `1px solid ${HOME_THEME.border}` }}>
        {([
          [LEVEL_COLORS.cb, "at core (±0.25%)"],
          [LEVEL_COLORS.cw, "above call wall"],
          [LEVEL_COLORS.pw, "below put wall"],
          [HOME_THEME.text, "pinned"],
        ] as [string, string][]).map(([c, t]) => (
          <span key={t} style={{ fontSize: 10, color: alpha(HOME_THEME.text, 0.44), display: "flex", alignItems: "center", gap: 6 }}>
            <i style={{ width: 9, height: 9, borderRadius: 3, background: c, display: "block" }} />
            {t}
          </span>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 10, color: alpha(HOME_THEME.text, 0.3) }}>
          {board === "cloud" ? "bigger type = larger |net GEX| · click a chip to pin it"
            : board === "swarm" ? "dot size = |net GEX| · gold line marks core"
            : board === "quadrants" ? "dot size = |net GEX| · quadrant = the setup"
            : "only the tails are named — the middle is the shape"}
        </span>
      </div>
    </Card>
  );

  return (
    <PageShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ── controls ── */}
      <Card variant="budget" padding={14} style={cardFlex}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginRight: "auto" }}>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Levels
            </div>
            <div style={{ fontSize: 11, color: alpha(HOME_THEME.text, 0.45) }}>
              {marks.length} tickers · sweep {fmtClock(sweptAt)} ET · spot live{liveCount ? ` (${liveCount})` : ""}
              {" · "}
              <span style={{ color: LEVEL_COLORS.cb }}>{nearCore} at core</span>
              {" · "}
              <span style={{ color: LEVEL_COLORS.cw }}>{aboveCw} above CW</span>
              {" · "}
              <span style={{ color: LEVEL_COLORS.pw }}>{belowPw} below PW</span>
              {error ? ` · ${error}` : ""}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={labelStyle}>View</span>
            {VIEWS.map(([id, txt]) => (
              <button key={id} style={seg(view === id)} onClick={() => setView(id)}>{txt}</button>
            ))}
          </div>

          {view === "board" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={labelStyle}>Board</span>
              {BOARDS.map(([id, txt]) => (
                <button key={id} style={seg(board === id)} onClick={() => setBoard(id)}>{txt}</button>
              ))}
            </div>
          )}

          {view === "monitor" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={labelStyle}>Group</span>
              <button style={seg(grouped)} onClick={() => setGrouped(true)}>Regime</button>
              <button style={seg(!grouped)} onClick={() => setGrouped(false)}>None</button>
            </div>
          )}

          {view === "desk" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={labelStyle}>Show</span>
              {([
                ["cb", "CB", LEVEL_COLORS.cb],
                ["cw", "CW", LEVEL_COLORS.cw],
                ["pw", "PW", LEVEL_COLORS.pw],
                ["flip", "Flip", HOME_THEME.cyan],
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
          )}

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            style={{ ...homeInputStyle, width: 110 }}
          />

          <button style={homeSecondaryButtonStyle} onClick={() => setPins([])} disabled={pins.length === 0}>
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

      {body}
    </PageShell>
  );
}
