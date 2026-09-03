"use client";

/**
 * /level-log — the wall / CORE level log, as its own page under Scanner.
 *
 * A customer-facing port of the "level log" panel that lives on the owner
 * Results → Walls tab (owner-vite/src/pages/Results.tsx). Same data, same
 * reading: levels are captured at 09:29 ET and then every 15 minutes to 16:00,
 * but only WRITTEN when they change, so the day summary carries the last value
 * forward per level type and `open` holds the 09:29 baseline. A wall_events row
 * is opened whenever spot trades into a live level and is classified four slots
 * later (reject / break / broke and consolidated / new wall / pin).
 *
 * Data: GET /proxy/walls[?date=&symbol=] (server-v2/walls-recorder.js).
 * Fetch-on-load + an explicit refresh — no polling, so an open tab never
 * hammers the recorder.
 *
 * WHICH CONTRACTS, WHICH GEX — two switches, four recorded variants.
 *   0DTE / Non-0DTE  0DTE is `chain.expirations[0]`, the nearest listed
 *                    contract, which is what this page showed for its whole
 *                    life. Non-0DTE is every OTHER listed expiration summed per
 *                    strike (bounded server-side to the nearest few inside ~45
 *                    DTE) — the board with today's contract taken out of it.
 *   OI+Vol / Vol     OI+Vol is netGEX + netVolGEX, the historical basis and the
 *                    one the dashboard chart / heatmap / MVC read. Vol is
 *                    netVolGEX alone: today's flow, no book.
 * All four are RECORDED, by scanner-recorder.js into scanner_variants and by
 * walls-recorder.js into walls_log / wall_events under `expiry_scope` + `basis`.
 * Switching either pill re-fetches /proxy/walls with ?scope=&basis=; nothing is
 * derived client-side, because a different basis is a different argmax, not a
 * rescaling of the one already on screen. Defaults are 0DTE + OI+Vol, so a
 * first load is byte-for-byte the log this page always gave.
 * The `…&series=1` read carries the `expiry` back, and the log card tags it
 * (`exp 08/25 · 2DTE`) alongside the variant, so two readings of the same
 * ticker on the same day can be told apart on sight.
 *
 * Three views, switched by the WALLS / CORE / ALL pills:
 *   WALLS — call wall + put wall entries only.
 *   CORE  — CORE (cb) entries only.
 *   ALL   — walls + CORE interleaved on one timeline. THE DEFAULT: the page
 *           opens on the whole log and the other two pills narrow it, rather
 *           than opening scoped and hiding two thirds of the day until you
 *           notice the pills.
 * The switch filters the ticker rail, the capture rail, the timeline, the copy
 * text and the PNG together, so what you export is exactly what you're reading.
 * It is a pure client-side filter over one fetch — every view is already loaded
 * when the page settles, so switching pills never re-hits /proxy/walls.
 *
 * Snapshot: goes through lib/snapshot.ts like every other capture in the app
 * (scripts/audit-ui.mjs --strict fails the build on a second html2canvas call
 * site). `framed: true` expands the clone past the scroll window, so the PNG is
 * a real screenshot of the whole card — styling, badges and colors included —
 * not a re-render of the text.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { HOME_THEME, LIGHT_BLUE, LEVEL_COLORS, ES_CANDLE_UP, homeInputStyle, classicCardAccentStyle } from "@/components/shared/homeTheme";
import { PageShell } from "@/components/shared/PageCard";
import { GexChurnHistory, useGexChurnHistory } from "@/components/shared/GexHeatBar";
import { ThemedDatePicker } from "@/components/shared/ThemedDatePicker";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { captureAndCopy } from "@/lib/snapshot";

// ── theme aliases ────────────────────────────────────────────────────────────
// Sourced from the shared palette so this page tracks the app (AGENTS.md: never
// hardcode hex). The owner page's "gold" maps to HOME_THEME.orange here.
const C = {
  cyan: HOME_THEME.cyan,
  border: HOME_THEME.border,
  label: HOME_THEME.text,
};
const GREEN = HOME_THEME.green;
const RED = HOME_THEME.red;
const AMBER = HOME_THEME.orange;
const MUTED = HOME_THEME.muted;
const CARD = classicCardAccentStyle;

/**
 * THE THREE LEVEL COLOURS — gold CORE, green call wall, red put wall.
 *
 * Sourced, not invented (AGENTS.md: never hardcode hex):
 *   CORE      LEVEL_COLORS.cb — the same gold Multi Greek's CB toggle, header
 *             readout and front-column marks use, and the level snapshot
 *             renderer. CORE is sign-blind, which is why it gets a hue of its
 *             own rather than borrowing a directional one.
 *   put wall  LEVEL_COLORS.pw — the same red, from the same set.
 *   call wall ES_CANDLE_UP, NOT LEVEL_COLORS.cw. The shared set paints the call
 *             wall blue, and HOME_THEME.green is the status palette's light blue
 *             (#8ECAE6) — neither of them reads as GREEN next to a red put wall,
 *             which is the whole point of the pairing. ES_CANDLE_UP is the
 *             repo's saturated trading green, already the up-colour on ES
 *             Candles and the gain colour on the scanner's probe card.
 */
const CORE_GOLD = LEVEL_COLORS.cb;
const CALL_GREEN = ES_CANDLE_UP;
const PUT_RED = LEVEL_COLORS.pw;

function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Today's ET date as "YYYY-MM-DD". */
function todayETStr(): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/** Calendar days from the session date to the expiry. null if either won't parse. */
function dteBetween(date: string, expiry: string): number | null {
  const a = Date.parse(`${date}T00:00:00Z`);
  const b = Date.parse(`${expiry}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * "exp 08/25 · 2DTE" — the contract every level on this page was computed from.
 *
 * Not decoration. scanner-recorder.js snapshots ONE expiration per sweep —
 * `chain.expirations[0]`, the nearest listed contract — and the walls and CORE
 * are all picked off that single chain. For SPX/SPY/QQQ that is 0DTE intraday;
 * a single name whose nearest listed expiry is Friday's weekly logs a 3DTE
 * board on a Tuesday. The two look identical without this tag.
 *
 * Calendar days, not trading days: it labels the contract, it is not a decay
 * measure. Returns null when the recorder wrote no expiry (pre-migration rows
 * hold ""), so the tag is absent rather than guessed.
 */
function expiryTag(expiry: string | null, date: string): string | null {
  if (!expiry) return null;
  const [, mm, dd] = expiry.split("-");
  const md = mm && dd ? `${mm}/${dd}` : expiry;
  const d = dteBetween(date, expiry);
  return d == null || d < 0 ? `exp ${md}` : `exp ${md} · ${d}DTE`;
}

// ── types (mirror /proxy/walls) ──────────────────────────────────────────────
type WallLevel = "call_wall" | "put_wall" | "cb";
type WallReaction =
  | "reject" | "break_lt5" | "break_5" | "consolidated" | "new_wall" | "pin"
  | "rolled_over" | "reached" | "stalled";

type WallTicker = {
  symbol: string;
  spot: number | null;
  call_wall: number | null; put_wall: number | null; cb: number | null;
  open: Partial<Record<WallLevel, number>>;
  changes: number;
  hits: number;
  reclaim_min: number | null;
  reaction: WallReaction | null;
  last_event: string | null;
  rank?: number | null;
};

type WallLogRow = {
  slot: number; at: string; ts: string; level_type: WallLevel;
  strike: number; prev_strike: number | null; delta: number | null;
  spot: number; reason: "open" | "change";
  level_gex: number | null;
};

type WallEventRow = {
  hit_slot: number; at: string; hit_ts: string; level_type: WallLevel;
  strike: number; spot_at_hit: number; reaction: WallReaction | null;
  excursion_pts: number | null; reclaim_min: number | null;
  note: string | null; resolved_ts: string | null;
  kind: "touch" | "approach";
  was_core: boolean | null; core_held: boolean | null;
  gex_at_hit: number | null; gex_at_resolve: number | null;
  attempts: number;
};

// ── the view switch ──────────────────────────────────────────────────────────
/**
 * WALLS = call wall + put wall. CORE = the CORE (cb) level on its own. ALL =
 * the three of them in one log.
 *
 * ALL is not "no filter" by accident — it is the reading the other two cannot
 * give. CORE is frequently ALSO one of the walls (whichever is carrying more
 * gamma), so a tag scored on the call wall and the CORE tag at the same strike
 * are the same event told twice, and split across two views neither tells you
 * that. Interleaved on one timeline the relationship is the story: the CORE
 * rolling ONTO a wall, or off it, is the day's dominant level changing sides.
 */
type LogView = "walls" | "core" | "all";

const VIEW_LEVELS: Record<LogView, WallLevel[]> = {
  walls: ["call_wall", "put_wall"],
  core: ["cb"],
  all: ["call_wall", "put_wall", "cb"],
};
const VIEW_META: { id: LogView; label: string; color: string; blurb: string }[] = [
  { id: "walls", label: "Walls", color: AMBER, blurb: "Call wall + put wall only" },
  { id: "core", label: "Core", color: CORE_GOLD, blurb: "CORE level only" },
  { id: "all", label: "All", color: C.cyan, blurb: "Walls + CORE on one timeline" },
];
/** Short scope word for headers, filenames and the copied text. */
const VIEW_SCOPE: Record<LogView, string> = { walls: "wall", core: "core", all: "level" };
const inView = (v: LogView, lt: WallLevel) => VIEW_LEVELS[v].includes(lt);

// ── the two variant switches ─────────────────────────────────────────────────
/**
 * WHICH CONTRACTS, and WHICH GEX. Both are recorded server-side four ways over
 * (server-v2/scanner-variants.js) and pulled through /proxy/walls?scope=&basis=,
 * so switching either one is a re-fetch of an already-recorded log — not a
 * re-computation, and never an interpolation of the variant you are not looking
 * at.
 *
 * expiry scope
 *   0dte  the nearest listed contract, chain.expirations[0]. What this page has
 *         always shown. Same-day for SPX/SPY/QQQ, the front weekly for most
 *         single names.
 *   agg   every OTHER listed expiration, summed per strike — the board with
 *         today's contract taken out of it. Bounded server-side to the nearest
 *         few expirations inside ~45 DTE, because "all" on a name with twenty
 *         listed expiries is twenty chain fetches a sweep.
 *
 * basis
 *   oivol netGEX + netVolGEX — open interest AND today's volume. The historical
 *         default and what the dashboard chart / heatmap / MVC read.
 *   vol   netVolGEX alone — today's volume, no book. Same gamma weighting, so
 *         it answers "where is today's flow building" rather than "where is the
 *         gamma that is on the book". It moves much faster than OI does.
 */
type ExpScope = "0dte" | "agg";
type GexBasis = "oivol" | "vol";

const SCOPE_META: { id: ExpScope; label: string; blurb: string }[] = [
  { id: "0dte", label: "0DTE", blurb: "Nearest listed contract only — chain.expirations[0]" },
  { id: "agg", label: "Non-0DTE", blurb: "Every OTHER listed expiration, summed per strike" },
];
const BASIS_META: { id: GexBasis; label: string; blurb: string }[] = [
  { id: "oivol", label: "OI + Vol", blurb: "netGEX + netVolGEX — open interest and today's volume" },
  { id: "vol", label: "Vol only", blurb: "netVolGEX alone — today's volume, no open interest" },
];
/** Compact tag for headers, the copied text and the PNG filename. */
const variantTag = (scope: ExpScope, basis: GexBasis) =>
  `${scope === "agg" ? "non-0DTE" : "0DTE"} · ${basis === "vol" ? "vol-only GEX" : "OI+vol GEX"}`;
/** The query both variant switches contribute to every /proxy/walls read. */
const variantQuery = (scope: ExpScope, basis: GexBasis) => `&scope=${scope}&basis=${basis}`;

/**
 * Quick-select rail in the control bar. The ticker list runs ~150 roots deep and
 * is ordered by rank, not alphabetically, so reaching the three that get opened
 * first meant scrolling the rail or typing into the filter on every visit.
 *
 * A pill whose symbol has no row for the selected date is DISABLED rather than
 * hidden: a missing sweep should read as "nothing recorded", not as a button that
 * moved. All three are in scanner-tickers.js MAIN (the 2m hot lane).
 */
const QUICK_TICKERS = ["SPX", "SPY", "QQQ"] as const;

const WALL_SLOTS = 27;
const LEVEL_LOG_H = 620;
const TICKER_COL_H = 620;

/**
 * One type scale for the whole log card. Before this there were several sizes
 * and three letter-spacings fighting each other inside a single row, which is
 * what made the card read as ragged. Everything in the card uses these three.
 */
const FS_LABEL = 12;   // uppercase chips + eyebrow labels
const FS_BODY = 13;    // the sentence in each row
const FS_META = 12;    // mono: time, GEX line, counters
const LS_LABEL = "0.12em";
/** Height of a row's first line — the badge box. The timeline dot centers on it. */
const ROW_LEAD_H = 20;
/**
 * Height of a rail chip. Explicit for the same reason the badges are (see
 * `wallBadgeStyle`): the label is centered by a fixed height + matching
 * line-height, and the box opts into snapshot.ts's `data-cap-center` rewrite so
 * the capture centers it too. Padding-based chips read fine on the page and
 * rode high in the PNG.
 */
const RAIL_CHIP_H = 24;
/** Same idea for the wall-migration legend chips — see `legendChip`. */
const LEGEND_CHIP_H = 16;
/** Painted size of a legend colour swatch — border included (border-box). */
const LEGEND_SWATCH = 11;

const LEVEL_LABEL: Record<WallLevel, string> = { call_wall: "Call Wall", put_wall: "Put Wall", cb: "CORE" };
/** Column-head width version of the same three. */
const LEVEL_SHORT: Record<WallLevel, string> = { call_wall: "Call", put_wall: "Put", cb: "CORE" };
const LEVEL_COLOR: Record<WallLevel, string> = { call_wall: CALL_GREEN, put_wall: PUT_RED, cb: CORE_GOLD };
/** Ticker-rail column order — price order, so ALL adds a column, not a reshuffle. */
const LEVEL_COL_ORDER: WallLevel[] = ["put_wall", "call_wall", "cb"];

const REACTION_LABEL: Record<WallReaction, string> = {
  reject: "Reject", break_lt5: "Break <5", break_5: "Break +5",
  consolidated: "Broke & consolidated", new_wall: "New wall", pin: "Pinned",
  rolled_over: "Rolled over", reached: "Approached, then tagged", stalled: "Stalled near",
};
const REACTION_COLOR: Record<WallReaction, string> = {
  reject: GREEN, break_lt5: AMBER, break_5: AMBER,
  consolidated: HOME_THEME.orange, new_wall: C.cyan, pin: LIGHT_BLUE,
  rolled_over: GREEN, reached: MUTED, stalled: MUTED,
};
/** How each reaction is decided — mirrors classify() in walls-recorder.js. */
const REACTION_RULE: Record<WallReaction, string> = {
  reject: "Tagged, never got past the touch band, faded ≥ 0.15% back inside",
  break_lt5: "Pushed through to the far side of the level, but by less than the break threshold",
  break_5: "Pushed ≥ 5 pts (0.15% for sub-$1000 names) through to the far side of the level — measured away from the side price approached on, so falling back the way it came never counts",
  consolidated: "Broke through, then the last 3 samples all held on the far side inside a 0.10% range",
  new_wall: "Broke through, and the level itself then rolled in the break direction",
  pin: "Sat inside the touch band for 3+ samples without resolving either way",
  rolled_over: "Came inside 0.30% without ever tagging, then reversed away — the level held at distance",
  reached: "Approached, then tagged the level after all",
  stalled: "Drifted near the level and neither tagged nor left",
};

/**
 * classify() files "broke by 8 then failed" as break_5 with reclaim_min set,
 * NOT as reject — deliberately, so the size label stays about distance. But on
 * the page that made a break that came straight back look identical to one that
 * held, which are opposite reads. Given reclaim_min, say so.
 */
function isBreakThenReject(ev?: { reaction: WallReaction | null; reclaim_min: number | null } | null): boolean {
  return !!ev && (ev.reaction === "break_5" || ev.reaction === "break_lt5") && ev.reclaim_min != null;
}

/**
 * Badge geometry, deliberately explicit:
 *  - fixed `height` + matching `lineHeight` + border-box → the label sits on the
 *    optical centre instead of riding high off `padding: 2px` and the font's
 *    own leading.
 *  - `textIndent` equal to `letterSpacing` cancels the trailing letter-space
 *    that uppercase tracking adds after the last glyph. Without it every pill
 *    reads shifted left inside its own box.
 */
function wallBadgeStyle(color: string): CSSProperties {
  return {
    display: "inline-block", boxSizing: "border-box",
    height: ROW_LEAD_H, lineHeight: `${ROW_LEAD_H - 2}px`, padding: "0 9px",
    borderRadius: 6, fontSize: FS_LABEL, fontWeight: 800,
    letterSpacing: LS_LABEL, textIndent: LS_LABEL,
    textTransform: "uppercase", whiteSpace: "nowrap", textAlign: "center",
    color, background: rgba(color, 0.13), border: `1px solid ${rgba(color, 0.3)}`,
  };
}

/**
 * `data-cap-center` on every pill. The live page centers the label with a fixed
 * height + matching line-height; html2canvas ignores the line box and draws from
 * the text rect's top using the ascent of whatever font it resolved in its
 * about:blank clone, which put the text high in the PNG. snapshot.ts (gotcha 10)
 * rewrites the opted-in pills to padding-based centering for the capture only.
 */
function wallBadge(rx: WallReaction | null, short = false, reclaimMin: number | null = null): ReactNode {
  if (!rx) return <span data-cap-center style={wallBadgeStyle(MUTED)}>Untested</span>;
  if (isBreakThenReject({ reaction: rx, reclaim_min: reclaimMin })) {
    return (
      <span data-cap-center style={wallBadgeStyle(GREEN)} title={`Broke, then reclaimed after ${reclaimMin}m — failed break`}>
        {short ? "Brk→Rej" : `Break & reject (${reclaimMin}m)`}
      </span>
    );
  }
  const label = short && rx === "consolidated" ? "Consol." : REACTION_LABEL[rx];
  return <span data-cap-center style={wallBadgeStyle(REACTION_COLOR[rx])}>{label}</span>;
}

/** Compact signed GEX, e.g. "+1.2B" / "−340M". */
function gexShort(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v); const a = Math.abs(n); const sign = n < 0 ? "−" : "+";
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(0)}K`;
  return `${sign}${a.toFixed(0)}`;
}

/** gex_at_hit → gex_at_resolve as a percentage build (or bleed). */
function gexBuildPct(from: number | null, to: number | null): number | null {
  if (from == null || to == null) return null;
  const a = Math.abs(Number(from));
  if (!(a > 0)) return null;
  return ((Math.abs(Number(to)) - a) / a) * 100;
}

const wallNum = (n: number | null | undefined, dp = 2) =>
  n == null || !Number.isFinite(Number(n)) ? "—"
    : Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
/** Strikes print without forced decimals — 6890, not 6890.00. */
const wallStrike = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) ? "—"
    : Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * Distance an approach stopped short of the level, in points. Null when the
 * gap rounds to nothing (or either number is missing) so the caller can say
 * "right on the level" instead of printing a meaningless "0.00 short".
 */
const missPts = (strike: number | null | undefined, spot: number | null | undefined): number | null => {
  const s = Number(strike), p = Number(spot);
  if (!Number.isFinite(s) || !Number.isFinite(p)) return null;
  const d = Math.abs(p - s);
  return d < 0.005 ? null : d;
};

/**
 * The level log as plain text, laid out for pasting into Discord or notes.
 * Built from the raw rows rather than scraped out of the rendered timeline, so
 * the copy carries the meta the eye skips. Ordering matches the screen: oldest
 * first, and within one slot the change leads the hit it produced.
 */
function buildLogText(
  symbol: string, spot: number | null, date: string, view: LogView,
  log: WallLogRow[], events: WallEventRow[], expiry: string | null,
  variant: string,
): string {
  const L = (lt: WallLevel) => LEVEL_LABEL[lt];
  const out: string[] = [];
  const scope = `${VIEW_SCOPE[view].toUpperCase()} LOG`;
  // The expiry goes in the header line for the same reason it is on the card:
  // a pasted log with no contract on it reads as "the levels", and these are
  // one expiration's levels.
  const exp = expiryTag(expiry, date);
  out.push(
    `${symbol} — ${scope} · ${date}${exp ? ` · ${exp}` : ""}${spot != null ? ` · spot ${wallNum(spot)}` : ""}`,
  );
  // Which of the four recorded readings this is. Without it a pasted non-0DTE
  // or vol-only log is indistinguishable from the default one, and the strikes
  // are genuinely different numbers.
  out.push(`basis: ${variant}`);

  const opens = log.filter((r) => r.reason === "open");
  if (opens.length) {
    out.push("");
    out.push(`OPEN ${opens[0].at}`);
    for (const r of opens) out.push(`  ${L(r.level_type).padEnd(10)} ${wallStrike(r.strike)}`);
  }

  type Line = { slot: number; hit: boolean; text: string[] };
  const lines: Line[] = [];

  for (const r of log) {
    if (r.reason === "open") continue;
    const body = `${wallStrike(r.prev_strike)} → ${wallStrike(r.strike)}`;
    const t = [`${r.at}  ${L(r.level_type).padEnd(10)} ${"CHANGED".padEnd(22)} ${body}`];
    if (r.level_gex != null) t.push(`${" ".repeat(7)}GEX at level ${gexShort(r.level_gex)}`);
    lines.push({ slot: r.slot, hit: false, text: t });
  }

  for (const e of events) {
    const approach = e.kind === "approach";
    const verdict = e.reaction == null ? "WATCHING"
      : isBreakThenReject(e) ? `BREAK & REJECT (${e.reclaim_min}m)`
      : REACTION_LABEL[e.reaction].toUpperCase();
    const side = approachSide(e);
    const miss = missPts(e.strike, e.spot_at_hit);
    const body = approach
      ? (miss != null
          ? `came ${side === "below" ? "up" : "down"} to ${wallNum(e.spot_at_hit)}, ${wallNum(miss)} short of ${wallStrike(e.strike)}, no tag`
          : `came ${side === "below" ? "up" : "down"} right onto ${wallStrike(e.strike)}, no tag`)
      : `tagged ${wallStrike(e.strike)} from ${side} at ${wallNum(e.spot_at_hit)}`;
    const t = [`${e.at}  ${L(e.level_type).padEnd(10)} ${verdict.padEnd(22)} ${body}`];

    const build = gexBuildPct(e.gex_at_hit, e.gex_at_resolve);
    const meta = [
      e.note,
      !approach && e.attempts > 1 ? `attempt ${e.attempts} on this strike` : null,
      e.was_core ? (e.core_held === false ? "was the CORE — CORE moved after" : "was the CORE") : null,
      e.gex_at_hit != null ? `GEX ${gexShort(e.gex_at_hit)}` : null,
      build != null ? `${build >= 0 ? "built" : "bled"} ${Math.abs(build).toFixed(0)}%` : null,
    ].filter(Boolean).join(" · ");
    if (meta) t.push(`${" ".repeat(7)}${meta}`);
    lines.push({ slot: e.hit_slot, hit: true, text: t });
  }

  lines.sort((a, b) => a.slot - b.slot || (a.hit === b.hit ? 0 : a.hit ? 1 : -1));
  if (lines.length) { out.push(""); for (const l of lines) out.push(...l.text); }
  else out.push("", "No changes or touches recorded.");
  return out.join("\n");
}

// ── buttons ──────────────────────────────────────────────────────────────────

/**
 * Screenshot the LIVE card.
 *
 * The owner version deliberately rendered `buildLogText()` into a throwaway
 * off-screen node, because a naive html2canvas() of the card grabbed only the
 * slice of the scroll window that happened to be in view and flattened the
 * frosted styling. lib/snapshot.ts fixes both — `framed: true` measures each
 * direct child by scrollHeight and expands the clone past the scroll container,
 * and the shared clone pass swaps backdrop-filter panels for their solid color.
 * So this captures the real UI, whole, and looks like the page.
 */
function SnapLogButton({ targetRef, filename, title, disabled }: {
  targetRef: RefObject<HTMLDivElement | null>;
  filename: string;
  title: string;
  disabled: boolean;
}) {
  const [state, setState] = useState<"idle" | "working" | "copied" | "saved" | "err">("idle");
  const go = useCallback(async () => {
    if (state === "working") return;
    const el = targetRef.current;
    if (!el) return;
    setState("working");
    try {
      // hugTarget: the target IS a card. Without it framed mode reserves its
      // bottom slack INSIDE the card, which read as a dead band between the
      // last entry and the card's bottom border.
      setState(await captureAndCopy(el, filename, { framed: true, hugTarget: true, title }));
    } catch (e) {
      console.error("[level-log] snapshot", e);
      setState("err");
    }
    setTimeout(() => setState("idle"), 2200);
  }, [state, targetRef, filename, title]);

  const ok = state === "copied" || state === "saved";
  const color = ok ? GREEN : state === "err" ? RED : C.label;
  return (
    <button
      onClick={() => { void go(); }}
      disabled={disabled || state === "working"}
      title="Copy a PNG screenshot of this log to the clipboard"
      style={{
        padding: "5px 10px", borderRadius: 8, fontFamily: "inherit", fontSize: 13,
        fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
        cursor: disabled || state === "working" ? "default" : "pointer",
        opacity: disabled ? 0.3 : state === "working" ? 0.6 : 1,
        border: `1px solid ${ok ? color : C.border}`,
        background: ok ? rgba(color, 0.14) : "rgba(255,255,255,0.03)",
        color,
      }}
    >
      {state === "working" ? "Capturing…" : state === "copied" ? "✓ Copied"
        : state === "saved" ? "✓ Saved" : state === "err" ? "✕ Failed" : "📸 PNG"}
    </button>
  );
}

function CopyLogButton({ text, disabled }: { text: string; disabled: boolean }) {
  const [done, setDone] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch { /* clipboard blocked — leave the label alone rather than lying */ }
  }, [text]);
  return (
    <button
      onClick={() => { void copy(); }}
      disabled={disabled}
      title="Copy this log as formatted text"
      style={{
        padding: "5px 10px", borderRadius: 8, cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit", fontSize: 13, fontWeight: 800, letterSpacing: "0.08em",
        textTransform: "uppercase", opacity: disabled ? 0.3 : 1,
        border: `1px solid ${done ? GREEN : C.border}`,
        background: done ? rgba(GREEN, 0.14) : "rgba(255,255,255,0.03)",
        color: done ? GREEN : C.label,
      }}
    >
      {done ? "✓ Copied" : "⧉ Copy"}
    </button>
  );
}

function WallDelta({ now, open }: { now: number | null | undefined; open: number | undefined }) {
  if (now == null || open == null || now === open) return null;
  const up = now > open;
  const c = up ? GREEN : AMBER;
  return (
    <span style={{ fontSize: 13, fontWeight: 800, marginLeft: 6, padding: "1px 5px", borderRadius: 4, color: c, background: rgba(c, 0.12) }}>
      {up ? "▲" : "▼"}{wallStrike(Math.abs(now - open))}
    </span>
  );
}

// ── the page ─────────────────────────────────────────────────────────────────

export default function LevelLog() {
  const [date, setDate] = useState(todayETStr());
  // Opens on ALL (2026-08-23; was "walls"). One fetch already carries all three
  // level types, so ALL is the view that shows everything that loaded — WALLS
  // and CORE are the narrowing, not the starting point.
  const [view, setView] = useState<LogView>("all");
  /**
   * WHICH CONTRACTS and WHICH GEX. Both default to what this page has always
   * shown — the nearest listed expiry on the OI+Vol basis — so a first load is
   * the log it has always been. Changing either re-fetches; nothing is derived
   * client-side, because the walls under a different basis are a different
   * argmax, not a rescaling of the same one.
   */
  const [scope, setScope] = useState<ExpScope>("0dte");
  const [basis, setBasis] = useState<GexBasis>("oivol");
  const [tickers, setTickers] = useState<WallTicker[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  // Gross gamma churn for the selected ticker. The hook lives in the shared
  // module and the PAGE owns when it fires — keyed on `sel` alone, so switching
  // date or view does not re-request a series that is the same either way.
  const { rows: churnRows, note: churnNote, loading: churnLoading } = useGexChurnHistory(sel);
  const [detail, setDetail] = useState<{ symbol: string; log: WallLogRow[]; events: WallEventRow[] } | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Bumped by refresh. The day summary re-fetches through loadDay(); the
  // per-ticker detail lives in its own effect, so it needs a dep to poke.
  const [nonce, setNonce] = useState(0);

  const logCardRef = useRef<HTMLDivElement | null>(null);

  const loadDay = useCallback(async () => {
    setErr(null); setLoaded(false);
    try {
      const r = await fetch(
        `/proxy/walls?date=${encodeURIComponent(date)}${variantQuery(scope, basis)}`,
        { cache: "no-store" },
      );
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      const rows: WallTicker[] = Array.isArray(j.tickers) ? j.tickers : [];
      setTickers(rows);
      setSel((prev) => prev ?? rows[0]?.symbol ?? null);
    } catch (e) { setErr(String(e)); setTickers([]); }
    setLoaded(true);
  }, [date, scope, basis]);

  useEffect(() => { void loadDay(); }, [loadDay]);

  const refreshAll = useCallback(async () => {
    setNonce((n) => n + 1);
    await loadDay();
  }, [loadDay]);
  const { trigger: refresh, label: refreshLabel, style: refreshStyle } = useRefreshButton(refreshAll);

  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    let alive = true;
    (async () => {
      try {
        const r = await fetch(
          `/proxy/walls?date=${encodeURIComponent(date)}&symbol=${encodeURIComponent(sel)}${variantQuery(scope, basis)}`,
          { cache: "no-store" },
        );
        const j = await r.json();
        if (alive && j?.ok) setDetail({ symbol: j.symbol, log: j.log ?? [], events: j.events ?? [] });
      } catch { if (alive) setDetail(null); }
    })();
    return () => { alive = false; };
  }, [sel, date, nonce, scope, basis]);

  /** The real tape for the selected ticker/date — best-effort, see the hook. */
  const price = useIntradaySpot(sel, date, nonce);
  /** The 5m wall/gamma history the change-only log was distilled from — and,
   *  riding along on the same rows, the expiration those levels came from. */
  const series = useWallSeries(sel, date, nonce, scope, basis);
  const expiry = series.expiry;
  const expiries = series.expiries;

  // ── the view switch, applied once ──────────────────────────────────────────
  // Everything downstream (rail, timeline, copy text, PNG) reads these, so the
  // WALLS / CORE pills can never disagree with what gets exported.
  const log = useMemo(
    () => (detail?.log ?? []).filter((r) => inView(view, r.level_type)),
    [detail, view],
  );
  const events = useMemo(
    () => (detail?.events ?? []).filter((e) => inView(view, e.level_type)),
    [detail, view],
  );

  const shown = useMemo(() => {
    const query = q.trim().toUpperCase();
    const rows = tickers.filter((t) => (query ? t.symbol.includes(query) : true));
    return [...rows].sort((a, b) => {
      const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || a.symbol.localeCompare(b.symbol);
    });
  }, [tickers, q]);

  // Which quick pills actually have a row today. Built off the unfiltered list,
  // not `shown` — the filter box must not be able to grey out a pill.
  const haveSymbols = useMemo(() => new Set(tickers.map((t) => t.symbol)), [tickers]);

  /**
   * Select a symbol from the quick rail. Also clears the filter box when the
   * current query would hide the row being selected — otherwise the click looks
   * like a no-op: the log switches but the rail shows nothing highlighted.
   */
  const pickTicker = useCallback((sym: string) => {
    setSel(sym);
    setQ((prev) => {
      const query = prev.trim().toUpperCase();
      return query && !sym.includes(query) ? "" : prev;
    });
  }, []);

  const selRow = useMemo(() => tickers.find((t) => t.symbol === sel) ?? null, [tickers, sel]);
  const spot = selRow?.spot ?? null;

  const empty = !sel || !(log.length || events.length);
  /** Is the full-size chart open? */
  const [popout, setPopout] = useState(false);
  /**
   * The day already on screen, in the chart's array shape. The popout's "Today"
   * range reuses this rather than re-fetching what the page just loaded.
   */
  const todayDays = useMemo<DaySlice[]>(
    () => [{ date, log, events, price }],
    [date, log, events, price],
  );
  /** The contract tag, once, for the card header / copy text / PNG title. */
  const expTag = useMemo(() => expiryTag(expiry, date), [expiry, date]);
  const vTag = useMemo(() => variantTag(scope, basis), [scope, basis]);
  const logText = useMemo(
    () => buildLogText(sel ?? "—", spot, date, view, log, events, expiry, vTag),
    [sel, spot, date, view, log, events, expiry, vTag],
  );
  const snapTitle = `${sel ?? "—"} — ${view === "core" ? "CORE" : view === "all" ? "Level" : "Wall"} log · ${date} · ${vTag}`;
  const snapFile = `${(sel ?? "walls").toLowerCase()}-${view}-${scope}-${basis}-log-${date}.png`;

  const chipStyle = (on: boolean, color: string = C.cyan): CSSProperties => ({
    padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${on ? color : C.border}`,
    background: on ? rgba(color, 0.16) : "rgba(255,255,255,0.03)",
    color: on ? color : C.label, fontSize: 13, fontWeight: 800,
    letterSpacing: "0.08em", textTransform: "uppercase",
  });

  const th: CSSProperties = {
    fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase",
    textAlign: "right", padding: "10px 9px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
    position: "sticky", top: 0, background: HOME_THEME.panelBgStrong,
  };
  const td: CSSProperties = {
    padding: "8px 9px", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 13,
    textAlign: "right", whiteSpace: "nowrap", fontFamily: "var(--font-mono)",
  };

  const viewMeta = VIEW_META.find((v) => v.id === view)!;
  const railCols = LEVEL_COL_ORDER.filter((lt) => inView(view, lt));

  return (
    <PageShell className="wall-scroll">
      {/* Control bar */}
      <div style={{ ...CARD, padding: "14px 18px", marginBottom: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Level Log
        </span>
        <span style={{ fontSize: 13, color: C.label }}>
          {viewMeta.blurb} — 09:29 open + every 15m to 16:00 ET, change-only · {vTag}
        </span>

        {/* WALLS / CORE / ALL — the whole page is scoped by this. Defaults to
            ALL: everything the day's fetch returned, already on screen. */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 4 }}>
          {VIEW_META.map((v) => (
            <button key={v.id} onClick={() => setView(v.id)} style={chipStyle(view === v.id, v.color)} title={v.blurb}>
              {v.label}
            </button>
          ))}
        </div>

        {/* WHICH CONTRACTS / WHICH GEX. Two independent switches over the four
            variants the recorder writes — see SCOPE_META / BASIS_META. Both
            re-fetch; neither is a client-side filter, because the walls under a
            different scope or basis are a different argmax, not a re-slice of
            the rows already loaded. */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", paddingLeft: 12, borderLeft: `1px solid ${C.border}` }}>
          {SCOPE_META.map((v) => (
            <button
              key={v.id}
              onClick={() => setScope(v.id)}
              style={{ ...chipStyle(scope === v.id, GREEN), padding: "6px 10px", letterSpacing: "0.06em" }}
              title={v.blurb}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", paddingLeft: 12, borderLeft: `1px solid ${C.border}` }}>
          {BASIS_META.map((v) => (
            <button
              key={v.id}
              onClick={() => setBasis(v.id)}
              style={{ ...chipStyle(basis === v.id, AMBER), padding: "6px 10px", letterSpacing: "0.06em" }}
              title={v.blurb}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Quick ticker jump. Sits beside the view pills, not in the rail header,
            so it stays put when the rail scrolls. */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", paddingLeft: 12, borderLeft: `1px solid ${C.border}` }}>
          {QUICK_TICKERS.map((sym) => {
            const missing = loaded && !haveSymbols.has(sym);
            return (
              <button
                key={sym}
                onClick={() => pickTicker(sym)}
                disabled={missing}
                style={{
                  ...chipStyle(sel === sym),
                  padding: "6px 10px", fontSize: FS_LABEL, letterSpacing: "0.06em",
                  ...(missing ? { opacity: 0.4, cursor: "not-allowed" } : null),
                }}
                title={missing ? `No ${sym} row recorded for ${date}` : `Jump to ${sym}`}
              >
                {sym}
              </button>
            );
          })}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Dock-themed calendar dropdown rather than <input type="date">: the
              native control paints the browser's own calendar (white sheet,
              system font, an indicator that ignores colorScheme on Windows
              Chrome) in the middle of a dark control bar. Same "YYYY-MM-DD"
              contract, so nothing downstream changes. The panel portals to
              <body> at z-index 9999, so the card's overflow can't clip it. */}
          <ThemedDatePicker
            value={date}
            onChange={(v) => { setDate(v); setSel(null); }}
            width={160}
          />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter ticker…"
            style={{ ...homeInputStyle, fontSize: 13, padding: "7px 10px", minWidth: 140, fontFamily: "inherit" }}
          />
          <button onClick={() => { void refresh(); }} style={refreshStyle} title="Re-pull the day list and the selected ticker's level log">
            {refreshLabel}
          </button>
        </div>
      </div>

      {err ? (
        <div style={{ ...CARD, padding: 18, marginBottom: 14, color: RED, fontSize: 13 }}>
          Could not load /proxy/walls — {err}
        </div>
      ) : null}

      {/* `minmax(0, 1fr) minmax(...)` is deliberate: globals.css's GLOBAL GRID
          COLLAPSE block matches that exact signature and stacks the two columns
          on a phone. A `340px` first track would have looked identical on a
          desktop and squeezed the log to nothing on mobile. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2.6fr)", gap: 16, alignItems: "start" }}>
        {/* Ticker rail — columns follow the view. */}
        <div style={{ ...CARD, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Tickers — {date}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 13 }}>
              {loaded ? `${shown.length}` : "…"}
            </span>
          </div>
          <div className="wall-scroll" style={{ maxHeight: TICKER_COL_H, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Ticker</th>
                  <th style={th}>Spot</th>
                  {/* Columns follow the view, in price order (put under call,
                      CORE last) rather than in VIEW_LEVELS order — so switching
                      to ALL adds a column instead of reshuffling the two that
                      were already there. */}
                  {railCols.map((lt) => (
                    <th key={lt} style={{ ...th, color: LEVEL_COLOR[lt] }}>{LEVEL_SHORT[lt]}</th>
                  ))}
                  <th style={th}>Chg</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr
                    key={t.symbol}
                    onClick={() => setSel(t.symbol)}
                    style={{
                      cursor: "pointer",
                      background: t.symbol === sel ? rgba(C.cyan, 0.1) : undefined,
                      boxShadow: t.symbol === sel ? `inset 2px 0 0 ${C.cyan}` : undefined,
                    }}
                  >
                    <td style={{ ...td, textAlign: "left", fontWeight: 800, letterSpacing: "0.03em" }}>{t.symbol}</td>
                    <td style={td}>{wallNum(t.spot)}</td>
                    {railCols.map((lt) => (
                      <td key={lt} style={{ ...td, color: LEVEL_COLOR[lt] }}>
                        {wallStrike(t[lt])}<WallDelta now={t[lt]} open={t.open?.[lt]} />
                      </td>
                    ))}
                    <td style={td}>{t.changes}</td>
                  </tr>
                ))}
                {loaded && !shown.length ? (
                  <tr><td colSpan={railCols.length + 3} style={{ ...td, textAlign: "center", padding: "34px 0", fontFamily: "inherit" }}>
                    No rows for {date}. The recorder writes from 09:29 ET on trading days.
                  </td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* The level log itself — this whole card is what the PNG captures. */}
        <div ref={logCardRef} style={{ ...CARD, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: FS_LABEL, fontWeight: 800, letterSpacing: LS_LABEL, textTransform: "uppercase" }}>
              {sel ?? "—"} — {VIEW_SCOPE[view]} log
            </span>
            <span style={{ fontSize: FS_META, fontFamily: "var(--font-mono)" }}>{wallNum(spot)}</span>
            {/* WHICH CONTRACT(S). On the 0DTE scope every level comes from one
                expiration — the nearest listed one at capture — so the log is
                same-day for the daily names and a front weekly for most single
                names. On the non-0DTE scope it is the nearest of the summed
                expirations, and the count rides beside it. Deliberately NOT
                data-capture-hide: the PNG should carry it too, or a shared
                screenshot is a set of levels with no board attached. */}
            {expTag ? (
              <span
                title={scope === "agg"
                  ? `Levels summed across ${expiries} expiration${expiries === 1 ? "" : "s"} starting ${expiry} — today's contract excluded. Each expiry's ladder is computed on its own and the exposures are added per strike.`
                  : `Levels computed from the ${expiry} expiration — the nearest listed contract at capture. Walls and CORE all come from that one chain; nothing is aggregated across expirations.`}
                style={{
                  fontSize: FS_META, fontFamily: "var(--font-mono)", fontWeight: 800,
                  padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap",
                  color: LIGHT_BLUE, background: rgba(LIGHT_BLUE, 0.12),
                  border: `1px solid ${rgba(LIGHT_BLUE, 0.35)}`,
                }}
              >
                {expTag}{scope === "agg" && expiries > 1 ? ` +${expiries - 1}` : ""}
              </span>
            ) : null}
            {/* The reading, spelled out. Two switches deep, "CORE 500" with no
                label on it is four different numbers wearing one name. */}
            <span
              style={{
                fontSize: FS_META, fontFamily: "var(--font-mono)", fontWeight: 800,
                padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap",
                color: basis === "vol" ? AMBER : MUTED,
                background: basis === "vol" ? rgba(AMBER, 0.12) : "rgba(255,255,255,0.04)",
                border: `1px solid ${basis === "vol" ? rgba(AMBER, 0.35) : C.border}`,
              }}
              title={`${SCOPE_META.find((v) => v.id === scope)?.blurb} · ${BASIS_META.find((v) => v.id === basis)?.blurb}`}
            >
              {vTag}
            </span>
            {/* data-capture-hide: live-page chrome, dropped from the screenshot. */}
            <div data-capture-hide style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <CopyLogButton disabled={empty} text={logText} />
              <SnapLogButton disabled={empty} targetRef={logCardRef} filename={snapFile} title={snapTitle} />
            </div>
          </div>

          <WallCaptureRail log={log} events={events} />

          {/* The same session as a picture. Sits ABOVE the scroll body on
              purpose: framed capture expands that body without reflowing its
              siblings, so anything under it gets drawn over in the PNG. */}
          <WallMigrationChart days={todayDays} view={view} onExpand={() => setPopout(true)} />

          {/* GAMMA BOOK CHURN for the selected ticker — how much of its gross
              gamma book (|call| + |put|, absolute at the leg so a put build
              cannot cancel a call build) rewrote itself, session by session.
              The wall log says WHERE the levels moved; this says how much of
              the book moved with them, and whether that gamma was added,
              rotated or pulled off.

              data-capture-hide, deliberately. The migration chart above sits on
              top of the scroll body because framed capture expands that body
              WITHOUT reflowing its siblings — so anything rendered between the
              two gets drawn over in the PNG. Rather than reopen that, this strip
              is live-page only. Read the note on WallMigrationChart above before
              moving it. */}
          <div data-capture-hide>
            <GexChurnHistory symbol={sel} rows={churnRows} note={churnNote} loading={churnLoading} />
          </div>

          {/* A variant with nothing in it is almost always "not recorded yet"
              rather than "nothing happened": the non-0DTE and vol-only legs
              started being written on 2026-08-27, so any earlier date has only
              the default pair. Say so, instead of showing an empty log that
              reads as a quiet session. */}
          {empty && sel && !(scope === "0dte" && basis === "oivol") ? (
            <div style={{ padding: "12px 18px", fontSize: FS_BODY, color: MUTED, borderTop: `1px solid ${C.border}` }}>
              Nothing recorded for {sel} on <b style={{ color: C.label }}>{vTag}</b> for {date}. The non-0DTE
              and vol-only legs are recorded forward only — nothing reconstructs them for past sessions.{" "}
              <button
                onClick={() => { setScope("0dte"); setBasis("oivol"); }}
                style={{ ...chipStyle(false), padding: "3px 8px", fontSize: FS_LABEL }}
              >
                Back to 0DTE · OI+Vol
              </button>
            </div>
          ) : null}

          {/* Header + capture rail stay pinned; only the entries scroll. The
              snapshot expands past this (framed mode), so the PNG is the whole
              log rather than the visible slice. */}
          <div className="wall-scroll" style={{ maxHeight: LEVEL_LOG_H, overflowY: "auto" }}>
            <WallTimeline log={log} events={events} view={view} />
          </div>

          {/* Reaction legend — a hover-to-learn key for the badges above, not
              part of the log. `data-capture-hide` keeps it out of the PNG for
              two reasons: it is page chrome, and framed mode expands the scroll
              body WITHOUT reflowing the siblings below it, so the legend
              rendered on top of the timeline entries in the capture. */}
          <div data-capture-hide style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "14px 18px", borderTop: `1px solid ${C.border}` }}>
            {(Object.keys(REACTION_LABEL) as WallReaction[]).map((rx) => (
              <span key={rx} title={REACTION_RULE[rx]}>{wallBadge(rx)}</span>
            ))}
          </div>
        </div>
      </div>

      {/* SPX, three months of CORE. Its own card under the day's log: the same
          chart, fed by one range read instead of one session, opening on CORE
          alone. See CoreMigrationCard. */}
      <CoreMigrationCard endDate={date} nonce={nonce} scope={scope} basis={basis} />

      {/* Full-size chart. Mounted only while open, so the 5-session fetch never
          runs for a reader who did not ask for it. */}
      {popout ? (
        <WallMigrationPopout
          symbol={sel}
          date={date}
          view={view}
          scope={scope}
          basis={basis}
          today={todayDays}
          nonce={nonce}
          onClose={() => setPopout(false)}
        />
      ) : null}
    </PageShell>
  );
}

/**
 * The session rail. Replaced the old 27-square dot matrix, which spent equal
 * width on every slot whether or not anything happened: the empty squares
 * dominated, and reading WHEN something happened meant counting boxes.
 *
 * Two halves, same data:
 *   RAIL  — a continuous track with real hour ticks. Every mark sits at its
 *           TIME, not its slot index, and its shape carries the kind (small dot
 *           = the level moved, filled disc = open, ringed = tag, hollow ring =
 *           came inside the band without tagging). The fill runs to the last
 *           slot captured, so how much session is left is visible at a glance.
 *   CHIPS — the same events written out in order with their clock time, so the
 *           rail never has to be decoded. Quiet stretches collapse to one
 *           "— 45m quiet —" label instead of a run of grey boxes.
 */
type RailMark = {
  slot: number;
  at: string;
  kind: "open" | "change" | "touch" | "approach";
  lt: WallLevel;
  note: string;
};

/** Slot → hour tick. Slot 0 = 09:29, slot 1 = 09:45, then every 15m to 16:00. */
const RAIL_HOURS: { slot: number; label: string }[] = [
  { slot: 2, label: "10" }, { slot: 6, label: "11" }, { slot: 10, label: "12" },
  { slot: 14, label: "13" }, { slot: 18, label: "14" }, { slot: 22, label: "15" },
];
const railPct = (slot: number) => (slot / (WALL_SLOTS - 1)) * 100;

const RAIL_KIND_LABEL: Record<RailMark["kind"], string> = {
  open: "OPEN", change: "MOVE", touch: "TAG", approach: "NEAR",
};

function WallCaptureRail({ log, events }: { log: WallLogRow[]; events: WallEventRow[] }) {
  // One mark per (slot, level). An event outranks a log row at the same slot —
  // "price tagged it" is the story, "the level also moved" is the footnote.
  const byKey = new Map<string, RailMark>();
  const put = (m: RailMark, strong: boolean) => {
    const k = `${m.slot}|${m.lt}`;
    if (!strong && byKey.has(k)) return;
    byKey.set(k, m);
  };
  for (const r of log) {
    if (r.slot < 0 || r.slot >= WALL_SLOTS) continue;
    put({
      slot: r.slot, at: r.at, lt: r.level_type,
      kind: r.reason === "open" ? "open" : "change",
      note: r.reason === "open"
        ? `${LEVEL_LABEL[r.level_type]} baseline ${wallStrike(r.strike)}`
        : `${LEVEL_LABEL[r.level_type]} → ${wallStrike(r.strike)}${r.delta != null ? ` (${r.delta > 0 ? "+" : ""}${wallNum(r.delta)})` : ""}`,
    }, false);
  }
  for (const e of events) {
    if (e.hit_slot < 0 || e.hit_slot >= WALL_SLOTS) continue;
    put({
      slot: e.hit_slot, at: e.at, lt: e.level_type, kind: e.kind === "touch" ? "touch" : "approach",
      note: `${LEVEL_LABEL[e.level_type]} ${e.kind === "touch" ? "tagged" : "approached"} ${wallStrike(e.strike)} · spot ${wallNum(e.spot_at_hit)}`
        + (e.reaction ? ` · ${REACTION_LABEL[e.reaction]}` : ""),
    }, true);
  }

  const marks = [...byKey.values()].sort((a, b) => a.slot - b.slot);
  const lastSlot = marks.length ? marks[marks.length - 1].slot : 0;

  // Colour = the LEVEL (same key the table and timeline use), so a mark on the
  // rail and its row below are obviously the same thing. Kind is carried by the
  // mark's shape instead — colour was already spoken for.
  const dot = (m: RailMark): CSSProperties => {
    const c = LEVEL_COLOR[m.lt];
    const base: CSSProperties = {
      position: "absolute", left: `${railPct(m.slot)}%`, top: "50%",
      transform: "translate(-50%,-50%)", borderRadius: "50%", pointerEvents: "auto",
    };
    if (m.kind === "approach") {
      return { ...base, width: 9, height: 9, background: "transparent", border: `1.5px solid ${c}`, boxShadow: `0 0 8px ${rgba(c, 0.4)}` };
    }
    if (m.kind === "touch") {
      return { ...base, width: 11, height: 11, background: c, border: `2px solid ${HOME_THEME.bg}`, boxShadow: `0 0 0 2px ${rgba(c, 0.3)}, 0 0 12px ${rgba(c, 0.55)}` };
    }
    if (m.kind === "open") {
      return { ...base, width: 9, height: 9, background: c, boxShadow: `0 0 9px ${rgba(c, 0.5)}` };
    }
    return { ...base, width: 7, height: 7, background: c, boxShadow: `0 0 8px ${rgba(c, 0.5)}` };
  };

  return (
    <div style={{ padding: "14px 18px 12px", borderBottom: `1px solid ${C.border}` }}>
      {/* ── the rail ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: FS_META, flex: "0 0 auto" }}>09:29</span>
        <div style={{ position: "relative", flex: "1 1 auto", height: 6, borderRadius: 3, background: "rgba(255,255,255,0.055)" }}>
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: `${railPct(lastSlot)}%`, borderRadius: 3,
            background: `linear-gradient(90deg, ${rgba(C.cyan, 0.3)}, ${rgba(C.cyan, 0.09)})`,
          }} />
          {RAIL_HOURS.map((h) => (
            <span key={h.slot} aria-hidden style={{
              position: "absolute", left: `${railPct(h.slot)}%`, top: -4, width: 1, height: 14,
              background: "rgba(255,255,255,0.13)",
            }} />
          ))}
          {marks.map((m) => (
            <span key={`${m.slot}|${m.lt}`} title={`${m.at} · ${m.note}`} style={dot(m)} />
          ))}
        </div>
        {/* No "N rows · N slots skipped" counter — the rail and the chips below
            already say what happened and when; a slot tally is bookkeeping. */}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: FS_META, flex: "0 0 auto" }}>16:00</span>
      </div>
      {/* Hour labels ride under the track, inset by the 09:29 gutter so they
          line up with their ticks rather than with the flex row. */}
      <div style={{ position: "relative", height: 12, margin: "3px 62px 0 52px" }} aria-hidden>
        {RAIL_HOURS.map((h) => (
          <span key={h.slot} style={{
            position: "absolute", left: `${railPct(h.slot)}%`, transform: "translateX(-50%)",
            fontFamily: "var(--font-mono)", fontSize: 10,
          }}>{h.label}</span>
        ))}
      </div>

      {/* ── the same events, spelled out ── */}
      <WallRailChips marks={marks} />
    </div>
  );
}

/** Idea D: the rail's marks as time-stamped chips, quiet stretches collapsed. */
function WallRailChips({ marks }: { marks: RailMark[] }) {
  if (!marks.length) return null;
  const out: ReactNode[] = [];
  let prev = -1;
  for (const m of marks) {
    const gap = m.slot - prev - 1;
    // 3 empty slots = 45 minutes. Below that the label is longer than the run.
    if (prev >= 0 && gap >= 3) {
      out.push(
        <span key={`q${m.slot}`} style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "0 2px" }}>
          — {gap * 15}m quiet —
        </span>,
      );
    }
    const c = LEVEL_COLOR[m.lt];
    // Deliberately inline-BLOCK, not inline-flex. `align-items:center` is a
    // line-box trick html2canvas does not implement — it lays the children out
    // but still draws each label from its rect's top, so the chip text sat high
    // in the PNG while looking centred on the page. A fixed height + matching
    // line-height + `data-cap-center` is the same idiom the badges use, and it
    // is the one snapshot.ts knows how to rewrite for the clone. The flex `gap`
    // becomes explicit right-margins, since inline-block has no gap.
    out.push(
      <span key={`${m.slot}|${m.lt}`} title={m.note} data-cap-center style={{
        display: "inline-block", boxSizing: "border-box",
        height: RAIL_CHIP_H, lineHeight: `${RAIL_CHIP_H - 2}px`, padding: "0 9px 0 7px",
        borderRadius: 7, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.028)",
        fontFamily: "var(--font-mono)", fontSize: 11.5, whiteSpace: "nowrap",
      }}>
        <span style={{
          display: "inline-block", verticalAlign: "middle", marginRight: 7,
          width: 6, height: 6, borderRadius: "50%",
          background: m.kind === "approach" ? "transparent" : c,
          border: m.kind === "approach" ? `1.5px solid ${c}` : undefined,
          boxShadow: m.kind === "approach" ? undefined : `0 0 7px ${rgba(c, 0.55)}`,
        }} />
        <span style={{ marginRight: 7 }}>{m.at}</span>
        <b style={{ fontWeight: 700, marginRight: 7 }}>{RAIL_KIND_LABEL[m.kind]}</b>
        {/* `textIndent` has no effect on an inline box, so the trailing
            letter-space of the uppercase tracking is cancelled with a negative
            right margin instead — otherwise the chip reads padded-right. */}
        <span style={{ fontSize: 10, letterSpacing: LS_LABEL, textTransform: "uppercase", color: c, marginRight: "-0.12em" }}>
          {LEVEL_LABEL[m.lt]}
        </span>
      </span>,
    );
    prev = m.slot;
  }
  const toClose = WALL_SLOTS - 1 - prev;
  if (toClose >= 3) {
    out.push(
      <span key="qend" style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "0 2px" }}>
        — {toClose * 15}m to close —
      </span>,
    );
  }
  return <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>{out}</div>;
}

// ── Wall migration ───────────────────────────────────────────────────────────

/**
 * Chart body height in px, and the breathing room inside it. The pad is the
 * post-market recap's (PostMarketTab → WallChart); the body is taller than its
 * 190, because this chart draws a whole session of steps against a 1-minute
 * tape and at 190 the walls sat within a few pixels of price all day.
 */
const MIG_H = 250;
const MIG_PAD = 8;

/** ET minutes-since-midnight of the two anchors the slot grid is built on. */
const OPEN_SLOT_MINS = 9 * 60 + 29;   // slot 0 — the open baseline capture
const GRID_START_MINS = 9 * 60 + 45;  // slot 1, then every 15m to 16:00 (slot 26)

/** Slot → wall-clock ET. Slot 0 is the 09:29 baseline, then every 15m to 16:00. */
function slotClock(slot: number): string {
  if (slot <= 0) return "09:29";
  const m = GRID_START_MINS + (slot - 1) * 15;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * ET minutes → FRACTIONAL slot. The inverse of the recorder's slotMins(), so a
 * 1-minute price sample lands on the same x as the 15-minute level step it
 * happened under. Slot 0 sits 16 minutes before slot 1, not 15, because the
 * open capture is at 09:29 — that first gap is its own scale.
 */
function slotAtMins(m: number): number {
  if (m <= OPEN_SLOT_MINS) return 0;
  if (m <= GRID_START_MINS) return (m - OPEN_SLOT_MINS) / (GRID_START_MINS - OPEN_SLOT_MINS);
  return 1 + (m - GRID_START_MINS) / 15;
}

/** Minutes east of UTC for New York at that instant (handles EST/EDT). */
function etOffsetMinutes(d: Date): number {
  const s = d.toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" });
  const m = s.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!m) return -300;
  const h = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  return h * 60 + (h < 0 ? -mm : mm);
}

/** Epoch ms for HH:MM ET on a "YYYY-MM-DD" date. */
function etMsOn(date: string, hh: number, mm: number): number {
  const naive = Date.parse(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  if (!Number.isFinite(naive)) return NaN;
  return naive - etOffsetMinutes(new Date(naive)) * 60_000;
}

/** One sample of the real tape: ET minutes-since-midnight and the price. */
type SpotSample = { mins: number; px: number };

/**
 * THE PRICE LINE — the real tape, not the log's own spot column.
 *
 * walls_log is CHANGE-ONLY: a row exists when a level sets or rolls, and spot
 * rides along on it. So the log's spot is a dozen-odd points a day, which drawn
 * as a line reads as price moving in half-hour steps — the chart's whole job is
 * comparing a level that holds against price that travels, and a stepped price
 * line makes that comparison unreadable.
 *
 * /proxy/candles-intraday (server-with-proxy.js → candle-history.js) already
 * serves 1-minute OHLC for any dxLink symbol out of a short-lived isolated
 * connection, so this is a read of something that exists, not a recorder change.
 * One request per symbol/date; the proxy caches ~60s.
 *
 * It is best-effort by design: an index dxLink will not serve 1m bars for, a
 * date outside dxFeed's ~7-day 1m window, or a dead request all resolve to [],
 * and the chart falls back to the recorded captures and says so. Nothing is
 * interpolated to cover a gap.
 */
function useIntradaySpot(symbol: string | null, date: string, nonce: number): SpotSample[] {
  const [rows, setRows] = useState<SpotSample[]>([]);
  useEffect(() => {
    if (!symbol) { setRows([]); return; }
    let alive = true;
    (async () => {
      const from = etMsOn(date, 9, 30);
      const to = etMsOn(date, 16, 0);
      if (!Number.isFinite(from) || !Number.isFinite(to)) { if (alive) setRows([]); return; }
      try {
        const r = await fetch(
          `/proxy/candles-intraday?symbol=${encodeURIComponent(symbol)}&interval=1m&fromMs=${Math.round(from)}`,
          { cache: "no-store" },
        );
        const j = await r.json();
        const cs: unknown[] = Array.isArray(j?.candles) ? j.candles : [];
        const out: SpotSample[] = [];
        for (const c of cs) {
          const row = c as { time?: unknown; close?: unknown };
          const t = Number(row?.time);
          const px = Number(row?.close);
          if (!Number.isFinite(t) || !(px > 0)) continue;
          if (t < from || t > to) continue;
          // No DST change lands inside a session, so minutes off the open is exact.
          out.push({ mins: 570 + (t - from) / 60_000, px });
        }
        out.sort((a, b) => a.mins - b.mins);
        if (alive) setRows(out);
      } catch { if (alive) setRows([]); }
    })();
    return () => { alive = false; };
  }, [symbol, date, nonce]);
  return rows;
}

/** One 5-minute scanner_snapshots row, reduced to what the chart reads. */
type SnapSample = {
  /** Fractional slot, so a 5m sample lands under the 15m step it happened in. */
  s: number;
  callWall: number | null; putWall: number | null;
  callG: number | null; putG: number | null;
};

/**
 * What the series read gives the page: the samples, and the CONTRACT they were
 * computed from.
 *
 * The expiry matters more than it looks. Every level on this page — both walls
 * and the CORE — comes from ONE expiration: `chain.expirations[0]`, the nearest
 * listed contract at capture (scanner-recorder.js). Nothing is aggregated across
 * the board. For SPX/SPY/QQQ that is 0DTE intraday; for most single names the
 * front weekly, so the same page can be showing a 0DTE log and a 4DTE log
 * depending on which ticker is selected. Unlabelled, the two read identically.
 */
type SnapSeries = {
  samples: SnapSample[];
  expiry: string | null;
  /** How many expirations the aggregate scope summed. 1 on the 0DTE scope. */
  expiries: number;
};

/** Stable empty value — a fresh object literal would re-run every consumer's memo. */
const EMPTY_SERIES: SnapSeries = { samples: [], expiry: null, expiries: 1 };

/** Finite number or null — the series columns are nullable all the way down. */
function fin(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ET minutes-since-midnight for a timestamptz string. */
function etMinsOfTs(ts: string): number {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return NaN;
  const s = d.toLocaleString("en-US", {
    timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit",
  });
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * THE GAMMA BEHIND THE LOG — /proxy/walls?…&series=1.
 *
 * walls_log is change-only, and `level_gex` only exists on the rows it wrote.
 * Between two rolls the chart therefore had no gamma, and gamma is the whole
 * basis of the CORE role: the heavier wall. A session where both walls hold
 * their strikes while dominance flips call→put is a real and tradeable event
 * that the log physically cannot express — no strike moved, so no row exists.
 *
 * scanner-recorder.js has always written `call_wall_gex` / `put_wall_gex` into
 * scanner_snapshots every 5 minutes; nothing served it per symbol until the
 * `series=1` branch. So this is a read of data already recorded — not a new
 * recorder, not a new sweep.
 *
 * Best-effort, exactly like the tape: a failure, a date with no snapshots, or a
 * symbol outside the scanner universe all resolve to [], and the chart falls
 * back to the log's own change-row gamma — which is what it used before.
 */
function useWallSeries(
  symbol: string | null, date: string, nonce: number,
  scope: ExpScope, basis: GexBasis,
): SnapSeries {
  const [rows, setRows] = useState<SnapSeries>(EMPTY_SERIES);
  useEffect(() => {
    if (!symbol) { setRows(EMPTY_SERIES); return; }
    let alive = true;
    (async () => {
      try {
        const r = await fetch(
          `/proxy/walls?date=${encodeURIComponent(date)}&symbol=${encodeURIComponent(symbol)}&series=1${variantQuery(scope, basis)}`,
          { cache: "no-store" },
        );
        const j = await r.json();
        const src: unknown[] = Array.isArray(j?.series) ? j.series : [];
        const out: SnapSample[] = [];
        // Last non-empty `expiry` on the day wins. The column is NOT NULL
        // DEFAULT '' — rows written before it existed hold "" — and a roll can
        // land mid-session (the 0DTE contract expires and the next one becomes
        // expirations[0]), so the newest labelled row is the honest answer for
        // where the levels ended the day.
        let exp: string | null = null;
        let nExp = 1;
        for (const row of src) {
          const rec = row as Record<string, unknown>;
          const mins = etMinsOfTs(String(rec?.ts ?? ""));
          if (!Number.isFinite(mins)) continue;
          const e = typeof rec.expiry === "string" ? rec.expiry.trim() : "";
          if (/^\d{4}-\d{2}-\d{2}$/.test(e)) exp = e;
          const k = Number(rec.expiries);
          if (Number.isFinite(k) && k > 0) nExp = k;
          out.push({
            s: slotAtMins(mins),
            callWall: fin(rec.call_wall), putWall: fin(rec.put_wall),
            callG: fin(rec.call_wall_gex), putG: fin(rec.put_wall_gex),
          });
        }
        out.sort((a, b) => a.s - b.s);
        if (alive) setRows({ samples: out, expiry: exp, expiries: nExp });
      } catch { if (alive) setRows(EMPTY_SERIES); }
    })();
    return () => { alive = false; };
  }, [symbol, date, nonce, scope, basis]);
  return rows;
}

/**
 * WALL MIGRATION — the level log drawn: where the levels sat, slot by slot,
 * against the price captured with them.
 *
 * Ported from the post-market recap's chart (components/pages/premarket/
 * PostMarketTab.tsx → WallChart).
 *
 *   ONE LINE PER RECORDED LEVEL. Call wall (green), put wall (red) and CORE
 *   (gold), each in the colour the rest of the page reads as that level, on a
 *   plain panel — no shaded corridor. CORE is the recorded `cb` strike — the same
 *   number the ticker rail, the timeline and the copied text show — and it
 *   frequently sits ON one of the walls, because the biggest node on the chain
 *   is usually also the biggest node on one side of spot. That overlap IS the
 *   reading; it is drawn last so the blue is visible on top of the wall it
 *   coincides with.
 *
 *   (Removed 2026-08-27: a two-line "role" model where CORE meant the heavier
 *   WALL rather than the cb level. It made the ALL view report a different CORE
 *   than the CORE view for the same ticker on the same day — MSFT read 505 here
 *   and 500 everywhere else — and one word cannot mean two numbers on one page.)
 *
 * The difference from the post-market version is the source. That one has no
 * recorded level series to read: it reconstructs the walls out of the per-minute
 * strike ladder and labels itself a "net-basis proxy" — and that ladder is
 * SPX-only, which is why the chart could not travel as written. Here the levels
 * ARE recorded, per symbol, by server-v2/walls-recorder.js. So the lines are the
 * recorder's own numbers rather than a proxy, they work for every ticker on the
 * rail, and they need none of the post-market version's mode-smoother: a
 * recorded level only moves when the recorder writes a change, where the
 * ladder's extreme strike alternates from sample to sample and had to be
 * de-flickered.
 *
 * Two honest consequences of reading the log instead of a ladder:
 *
 *   1. walls_log is CHANGE-ONLY, so each series is forward-filled from its last
 *      written row. That is exactly what the level did — a wall holds its strike
 *      until it rolls — which is why every level is a STEP and never a slope. A
 *      diagonal between two captures would draw the level at prices it never
 *      occupied, which is precisely the reading this panel exists for.
 *   2. Spot is only stored on the slots that wrote a row, plus the touch and
 *      approach events. The price line is therefore those captures joined up,
 *      not a tick path, and the caption says how many there were rather than
 *      implying a continuous tape.
 *
 * Nothing is filled in. A level with no rows for the day is simply not drawn,
 * and the whole panel disappears rather than render an empty frame.
 *
 * It reads the same view-filtered `log` / `events` as the rail and the timeline,
 * so the WALLS / CORE switch scopes it along with everything else.
 *
 * The DRAWING is the post-market chart's, deliberately: same 190px body, same
 * 8px pad, x spanning the recorded samples edge to edge (not the fixed
 * 09:29→16:00 rail, which left a half-recorded day drawing half a chart beside
 * a wall of dead space), no gridlines, no per-capture ticks, spot as one
 * continuous stroke, and the legend as swatch chips under the head. Three
 * stamps under the plot say what span you are looking at.
 */
/**
 * ONE DAY of the chart's input: the change-only level log, the classified
 * events, and the 1-minute tape if there was one. The chart takes an ARRAY of
 * these — one entry is the inline single-session chart, five entries is the
 * week view in the popout — so both are the same drawing code and cannot drift.
 */
type DaySlice = {
  date: string;
  log: WallLogRow[];
  events: WallEventRow[];
  price: SpotSample[];
};

/** Which wall a role-model line IS at a given slot. */
type WallSide = "call" | "put";

/** One day reduced to what the drawing needs. */
type DaySeg = {
  date: string;
  series: Map<WallLevel, (number | null)[]>;
  /**
   * The two ROLES — CORE (the heavier wall) and OTHER (the lighter one), with
   * the side OTHER currently is so it can be drawn in that wall's colour.
   * Null on the views where there is nothing to resolve.
   */
  roles: { core: (number | null)[]; other: (number | null)[]; side: (WallSide | null)[] } | null;
  spotPts: { s: number; v: number }[];
  spotDrawn: { s: number; v: number }[];
  dense: boolean;
  lastSlot: number;
  lastWrite: number;
};

/** What the legend can switch off — the three levels plus the price line. */
type MigKey = WallLevel | "spot";

function WallMigrationChart({ days, view, height = MIG_H, onExpand, watermark, title = "Wall migration" }: {
  days: DaySlice[];
  view: LogView;
  /** Section head. The long-range SPX card names itself "CORE migration". */
  title?: string;
  /** Plot height in px. The popout draws the same model twice as tall. */
  height?: number;
  /** Given only by the inline chart — the popout has nothing to expand into. */
  onExpand?: () => void;
  /**
   * Brand mark, over the bottom-right of the PLOT. Inside the chart rather than
   * bolted on by the caller, because "bottom right of the chart" is a position
   * only this component knows: a wrapper outside it can only aim at the bottom
   * of the head + legend + plot + axis stack, which is how the mark ended up
   * sitting in the date rail. The popout asks for it; the inline card does not
   * — a watermark on a 250px card in the page is just clutter.
   */
  watermark?: boolean;
}) {
  /**
   * Legend switches. Click a chip to drop that series out of the plot; click it
   * again to bring it back. Kept as the set of what is OFF so a level that only
   * appears later (a week fetch landing, the view switching) arrives visible.
   */
  const [off, setOff] = useState<Set<MigKey>>(() => new Set());
  const toggle = (k: MigKey) => setOff((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const model = useMemo(() => {
    const inSlot = (s: number) => Number.isFinite(s) && s >= 0 && s < WALL_SLOTS;

    // Level types this view covers AND that have rows on at least one of the
    // days. Union, not intersection: a level that only exists on three of five
    // sessions should draw on those three, not be dropped from the week.
    const levels = VIEW_LEVELS[view].filter((lt) => days.some((d) => d.log.some((r) => r.level_type === lt)));
    if (!levels.length) return null;

    const segs: DaySeg[] = [];
    for (const day of days) {
      // Scoped to the view here rather than by the caller, so the inline chart
      // (which is handed already-filtered rows) and the popout's week fetch
      // (which is handed the raw day) count the same captures and draw the same
      // lines. Idempotent on rows that were already filtered.
      const log = day.log.filter((r) => inView(view, r.level_type));
      const events = day.events.filter((e) => inView(view, e.level_type));
      const price = day.price;

      // How much session the LOG wrote. Same definition the rail's fill uses, so
      // the two never disagree about where the last capture was.
      let lastWrite = 0;
      for (const r of log) if (inSlot(r.slot) && r.slot > lastWrite) lastWrite = r.slot;
      for (const e of events) if (inSlot(e.hit_slot) && e.hit_slot > lastWrite) lastWrite = e.hit_slot;

      /**
       * HOW FAR THE DAY DRAWS — the session, not the log.
       *
       * The x axis used to end at the last row `walls_log` wrote, and walls_log
       * is change-only. So a ticker whose walls stopped rolling at 10:00 drew a
       * half-hour chart and threw away the six hours of tape that were already
       * in hand — and that is precisely backwards, because "the level sat while
       * price travelled all day" is the single most tradeable thing this panel
       * can show. A day with no rolls after the open was the day it drew least.
       *
       * So the extent is the TAPE, which useIntradaySpot already pulls for the
       * whole 09:30→16:00 window off /proxy/candles-intraday. No new fetch, no
       * new recorder write, no clock read: mid-session the tape ends at the last
       * closed minute, so the chart ends at now; on a past date it ends at
       * 16:00. When there is no tape (index with no 1m bars, or a date outside
       * dxFeed's window) `tapeEnd` is 0 and the extent falls back to the log.
       *
       * Past `lastWrite` the levels are the forward fill — which is not an
       * invention, it is what a level with no rows MEANS: it held. The render
       * marks that boundary so the held stretch is never mistaken for captures.
       */
      const tapeAll = price
        .map((p) => ({ s: slotAtMins(p.mins), v: p.px }))
        .filter((p) => Number.isFinite(p.s) && p.s >= 0 && p.s <= WALL_SLOTS - 1 && p.v > 0);
      let tapeEnd = 0;
      for (const p of tapeAll) if (p.s > tapeEnd) tapeEnd = p.s;
      const lastSlot = Math.min(WALL_SLOTS - 1, Math.max(lastWrite, Math.ceil(tapeEnd)));

      // Forward-fill: at slot s a level is whatever it was last written as.
      const series = new Map<WallLevel, (number | null)[]>();
      for (const lt of levels) {
        const rows = log
          .filter((r) => r.level_type === lt && inSlot(r.slot) && Number.isFinite(Number(r.strike)))
          .sort((a, b) => a.slot - b.slot);
        if (!rows.length) continue;
        const out: (number | null)[] = new Array(WALL_SLOTS).fill(null);
        let cur: number | null = null;
        let i = 0;
        for (let s = 0; s <= lastSlot; s++) {
          while (i < rows.length && rows[i].slot <= s) {
            cur = Number(rows[i].strike);
            i++;
          }
          out[s] = cur;
        }
        series.set(lt, out);
      }

      /**
       * THE CORE-SIGN RULE, AS TWO ROLES — the post-market chart's model.
       *
       * CORE is the single largest |net GEX| node on the chain, so it IS one of
       * the walls: positive gamma at that node makes it the call wall, negative
       * makes it the put wall. Drawing the matching wall beside it is the same
       * strike twice in two colours.
       *
       * The first cut of this masked the matching wall out per slot, which was
       * right about the rule and wrong about the drawing: green and red kept
       * dropping out mid-session and coming back, so the eye read a level that
       * had vanished rather than a role that had swapped. PostMarketTab's
       * WallChart solved this years-worth-of-squinting ago — TWO ROLES, NOT
       * THREE LEVELS. CORE is the heavier wall, OTHER is the lighter one, both
       * lines run the whole session, and when dominance flips the lines swap.
       *
       * The one change here is colour. The post-market chart paints OTHER a
       * flat grey because it has no per-side identity to show; this page does,
       * so OTHER is drawn in the colour of the wall it currently IS — green for
       * the call wall, red for the put wall — in contiguous same-side runs. So
       * a positive CORE has no second green line, a negative CORE has no second
       * red one, and neither colour ever blinks out mid-run.
       */
      const coreG: (number | null)[] = new Array(WALL_SLOTS).fill(null);
      {
        const gRows = log
          .filter((r) => r.level_type === "cb" && inSlot(r.slot) && r.level_gex != null && Number.isFinite(Number(r.level_gex)))
          .sort((a, b) => a.slot - b.slot);
        let cur: number | null = null;
        let i = 0;
        for (let s = 0; s <= lastSlot; s++) {
          while (i < gRows.length && gRows[i].slot <= s) { cur = Number(gRows[i].level_gex); i++; }
          coreG[s] = cur;
        }
      }

      const cwArr = series.get("call_wall");
      const pwArr = series.get("put_wall");
      const cbArr = series.get("cb");

      /**
       * Roles only exist where the CORE and at least one wall are both in play.
       * The WALLS view (no cb) and the CORE view (no walls) have nothing to
       * resolve, so they fall through to the plain per-level drawing below and
       * look exactly as they always did.
       */
      let roles: DaySeg["roles"] = null;
      if (cbArr && (cwArr || pwArr)) {
        const core: (number | null)[] = new Array(WALL_SLOTS).fill(null);
        const other: (number | null)[] = new Array(WALL_SLOTS).fill(null);
        const side: (WallSide | null)[] = new Array(WALL_SLOTS).fill(null);
        for (let s = 0; s <= lastSlot; s++) {
          const c = cbArr[s];
          if (c == null) continue;
          const a = cwArr?.[s] ?? null;
          const b = pwArr?.[s] ?? null;
          /**
           * WHICH WALL THE CORE IS. The strike itself answers it whenever CORE
           * is sitting on one — which is most slots. Failing that the recorded
           * gamma sign answers it. Failing that (a day whose cb rows predate
           * `level_gex`) the nearer wall does, which is never wrong by much and
           * is at least stable from slot to slot — a role that flickers is the
           * thing this model exists to stop.
           */
          let coreSide: WallSide;
          if (a != null && c === a) coreSide = "call";
          else if (b != null && c === b) coreSide = "put";
          else {
            const g = coreG[s];
            if (g != null && g !== 0) coreSide = g > 0 ? "call" : "put";
            else if (a != null && b != null) coreSide = Math.abs(c - a) <= Math.abs(c - b) ? "call" : "put";
            else coreSide = a != null ? "call" : "put";
          }
          core[s] = c;
          const o = coreSide === "call" ? b : a;
          if (o != null) { other[s] = o; side[s] = coreSide === "call" ? "put" : "call"; }
        }
        if (core.some((v) => v != null)) roles = { core, other, side };
      }

      // Spot, from every capture that carried one. Events are written second so
      // a tag's spot_at_hit wins over the level row at the same slot — the tag
      // is the more precise reading of where price actually was.
      const spot: (number | null)[] = new Array(WALL_SLOTS).fill(null);
      for (const r of log) {
        if (inSlot(r.slot) && Number.isFinite(Number(r.spot)) && Number(r.spot) > 0) spot[r.slot] = Number(r.spot);
      }
      for (const e of events) {
        if (inSlot(e.hit_slot) && Number.isFinite(Number(e.spot_at_hit)) && Number(e.spot_at_hit) > 0) {
          spot[e.hit_slot] = Number(e.spot_at_hit);
        }
      }
      const spotPts = spot.map((v, s) => ({ s, v })).filter((p) => p.v != null) as { s: number; v: number }[];

      /**
       * WHICH PRICE GETS DRAWN. The 1-minute tape when it arrived, the log's own
       * captures when it did not — never the two spliced together, which would
       * put a smooth stretch next to a stepped one and read as the tape going
       * quiet rather than the data running out. Decided PER DAY, so one session
       * missing its tape does not downgrade the other four.
       */
      const tape = tapeAll.filter((p) => p.s <= lastSlot);
      const dense = tape.length >= 20;
      const spotDrawn = dense ? tape : spotPts.map((p) => ({ s: p.s, v: p.v }));

      /* (Removed 2026-08-28: the shaded corridor between the two bounding
         levels. At 0.06 alpha on the panel it did not read as a tint — it read
         as blocky dark rectangles behind the lines, and every wall step cut a
         new hard edge into it. The lines already say where the room was.) */

      if (!series.size && !spotDrawn.length) continue;
      segs.push({ date: day.date, series, roles, spotPts, spotDrawn, dense, lastSlot, lastWrite });
    }
    if (!segs.length) return null;

    // ONE y range across every day drawn. Per-day scaling would make a week of
    // levels look flat by rescaling each session to its own range — the whole
    // point of the week view is seeing a wall hold its strike ACROSS days.
    const vals: number[] = [];
    for (const seg of segs) {
      for (const arr of seg.series.values()) for (const v of arr) if (v != null) vals.push(v);
      for (const p of seg.spotDrawn) vals.push(p.v);
    }
    if (vals.length < 2) return null;

    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (!(hi > lo)) { const c = lo || 1; lo = c * 0.999; hi = c * 1.001; }
    const padY = (hi - lo) * 0.08;
    lo -= padY; hi += padY;

    // What the LEGEND may offer. Under the role model a wall earns its chip by
    // being the OTHER line somewhere — a wall that is the CORE all session is
    // already on screen in gold and must not also take a green or red chip that
    // toggles nothing.
    const roled = segs.some((seg) => seg.roles);
    const kept = levels.filter((lt) => {
      if (!roled) return segs.some((seg) => seg.series.has(lt));
      if (lt === "cb") return true;
      const want: WallSide = lt === "call_wall" ? "call" : "put";
      return segs.some((seg) => seg.roles?.side.some((v) => v === want));
    });
    if (!kept.length) return null;

    return { levels: kept, segs, lo, hi, roled };
  }, [days, view]);

  if (!model) return null;
  const { levels, segs, lo, hi, roled } = model;
  const N = segs.length;
  const segW = 100 / N;
  const last = segs[N - 1];

  /**
   * Index across what was recorded, edge to edge — the post-market geometry,
   * generalised. Each day owns an equal slice of the 100-wide viewBox and its
   * own slots run edge to edge inside that slice. With one day this is exactly
   * the single-session geometry it always was.
   *
   * Equal WIDTH per day, not equal minutes: a half-recorded session and a full
   * one get the same slice, because the comparison the week view exists for is
   * "where did the levels sit each day", not "how long was each day".
   */
  const x = (i: number, s: number) => i * segW + (s / Math.max(1, segs[i].lastSlot)) * segW;
  const y = (v: number) => MIG_PAD + (1 - (v - lo) / (hi - lo)) * (height - MIG_PAD * 2);

  /**
   * Step, not slope — a level holds its strike until it rolls. Walk forward or
   * back over one DAY's fill; never across a day boundary, which would draw a
   * diagonal through an overnight the level did not travel.
   */
  const stepRun = (i: number, arr: (number | null)[], a: number, b: number, reverse = false) => {
    const out: string[] = [];
    let prev: number | null = null;
    const push = (s: number) => {
      const v = arr[s];
      if (v == null) return;
      if (prev != null && v !== prev) out.push(`${x(i, s)},${y(prev)}`);
      out.push(`${x(i, s)},${y(v)}`);
      prev = v;
    };
    if (reverse) for (let s = b; s >= a; s--) push(s);
    else for (let s = a; s <= b; s++) push(s);
    return out;
  };

  /**
   * A level's day as one polyline PER CONTIGUOUS RUN. It used to be one
   * polyline for the whole day, which was fine while the only gaps were
   * before the first capture — but the CORE-sign rule punches holes mid-day,
   * and a single polyline would bridge one with a diagonal through strikes the
   * wall never held while it was suppressed.
   */
  const stepRuns = (i: number, arr: (number | null)[] | undefined): string[] => {
    if (!arr) return [];
    const out: string[] = [];
    const L = segs[i].lastSlot;
    let s = 0;
    while (s <= L) {
      if (arr[s] == null) { s++; continue; }
      const a = s;
      while (s <= L && arr[s] != null) s++;
      const pts = stepRun(i, arr, a, s - 1);
      if (pts.length) out.push(pts.join(" "));
    }
    return out;
  };

  /** Last written value of a level across the whole span — the legend's number. */
  const lastOf = (lt: WallLevel) => {
    for (let i = N - 1; i >= 0; i--) {
      const arr = segs[i].series.get(lt);
      if (!arr) continue;
      for (let s = segs[i].lastSlot; s >= 0; s--) if (arr[s] != null) return arr[s] as number;
    }
    return null;
  };

  /**
   * THE TWO LINES.
   *
   * Under the role model (CORE plus at least one wall) there are exactly two:
   * CORE in gold, thick, running the whole session; and OTHER, drawn as one
   * polyline per contiguous same-side stretch so it carries the colour of the
   * wall it currently is. Each stretch is joined to the next by the vertical
   * edge of the swap, so the line is continuous through a role change — the
   * swap reads as a colour change at a step, not as two levels disappearing.
   *
   * Without the role model (the WALLS view, the CORE view) it is the plain
   * per-level drawing it always was: gold CORE, green call wall, red put wall,
   * walls first so the gold reads on top of the wall it coincides with.
   *
   * SWITCHING CORE OFF DROPS THE ROLE MODEL WITH IT. The whole reason CORE
   * suppresses a wall is that it IS that wall — one strike drawn twice in two
   * colours is the thing the model exists to prevent. With CORE hidden there is
   * no double, so there is nothing left to suppress: both walls go back to
   * their own recorded series and each runs the full span, every session. The
   * old behaviour left only OTHER on the chart, so the wall CORE had been
   * standing in for appeared in fragments — visible in the stretches where it
   * happened to be the lighter one and simply absent everywhere else, which
   * reads as a level that kept dying rather than one that held all week.
   */
  const drawOrder: WallLevel[] = ["put_wall", "call_wall", "cb"];
  const drawn = drawOrder.filter((lt) => levels.includes(lt));
  const paths: { key: string; d: string; color: string; w: number }[] = [];
  if (roled && !off.has("cb")) {
    for (let i = 0; i < N; i++) {
      const r = segs[i].roles;
      if (!r) continue;
      const L = segs[i].lastSlot;
      let s = 0;
      let k = 0;
      while (s <= L) {
        if (r.other[s] == null || r.side[s] == null) { s++; continue; }
        const a = s;
        const sd = r.side[s];
        while (s <= L && r.other[s] != null && r.side[s] === sd) s++;
        const b = s - 1;
        const lt: WallLevel = sd === "call" ? "call_wall" : "put_wall";
        if (!off.has(lt)) {
          const pts = stepRun(i, r.other, a, b);
          // Carry the run to the next slot's value, so consecutive runs meet at
          // the vertical edge instead of leaving a slot-wide hole between them.
          const nx = r.other[b + 1];
          if (pts.length && nx != null && b + 1 <= L) {
            pts.push(`${x(i, b + 1)},${y(r.other[b] as number)}`, `${x(i, b + 1)},${y(nx)}`);
          }
          if (pts.length) paths.push({ key: `other-${i}-${k}`, d: pts.join(" "), color: LEVEL_COLOR[lt], w: 1.8 });
        }
        k++;
      }
      // No `off.has("cb")` guard: this branch only runs while CORE is on.
      stepRuns(i, r.core).forEach((d, j) => {
        paths.push({ key: `core-${i}-${j}`, d, color: LEVEL_COLOR.cb, w: 2.2 });
      });
    }
  } else {
    for (const lt of drawn) {
      if (off.has(lt)) continue;
      for (let i = 0; i < N; i++) {
        stepRuns(i, segs[i].series.get(lt)).forEach((d, k) => {
          paths.push({ key: `${lt}-${i}-${k}`, d, color: LEVEL_COLOR[lt], w: lt === "cb" ? 2.2 : 1.8 });
        });
      }
    }
  }

  const spotLines = off.has("spot")
    ? []
    : segs
      .map((seg, i) => ({ key: `spot-${i}`, d: seg.spotDrawn.map((p) => `${x(i, p.s)},${y(p.v)}`).join(" ") }))
      .filter((c) => c.d);

  /** x of the last written slot on the LIVE day, only when it runs past it. */
  const heldFrom = last.lastWrite < last.lastSlot ? x(N - 1, last.lastWrite) : null;

  const totalMins = segs.reduce((n, seg) => n + (seg.dense ? seg.spotDrawn.length : 0), 0);
  const totalCaps = segs.reduce((n, seg) => n + seg.spotPts.length, 0);
  const anyDense = segs.some((seg) => seg.dense);

  /**
   * The post-market legend: a small square swatch, the level in sentence case,
   * and the strike it currently sits on. Not the old uppercase pill row — that
   * was a second title bar fighting the head above it.
   *
   * Each chip is also the series' SWITCH. Three levels and a price line
   * inside 190px is a lot of ink for one question, and the question
   * is usually about one of them — so the chip that names a series turns it
   * off. Off reads as off: the swatch hollows out and the whole chip dims,
   * rather than the row looking identical to a chart that simply had no data.
   *
   * Inline-BLOCK, not inline-flex — the same reason WallCaptureRail's chips are:
   * `align-items:center` is a line-box trick html2canvas does not implement, so
   * a flex chip that reads centred on the page draws its swatch off the label's
   * middle in the PNG. Fixed height + matching line-height + `data-cap-center`
   * is the idiom lib/snapshot.ts knows how to rewrite for the clone, and the
   * flex `gap` becomes explicit right-margins.
   */
  const legendChip = (key: MigKey, color: string, label: string, value: string) => {
    const on = !off.has(key);
    return (
      <button
        key={key}
        onClick={() => toggle(key)}
        aria-pressed={on}
        title={on ? `Hide ${label}` : `Show ${label}`}
        data-cap-center
        style={{
          position: "relative",
          display: "inline-block", boxSizing: "border-box", whiteSpace: "nowrap",
          height: LEGEND_CHIP_H, lineHeight: `${LEGEND_CHIP_H}px`,
          // Left padding is the swatch's reserved lane — see below. 11px of
          // painted swatch + the 6px gap the old `marginRight` gave it.
          padding: `0 0 0 ${LEGEND_SWATCH + 6}px`,
          borderRadius: 6, border: "1px solid transparent", background: "transparent",
          fontFamily: "inherit", fontSize: 11, cursor: "pointer",
          color: MUTED, opacity: on ? 1 : 0.4,
        }}
      >
        {/* THE SWATCH IS TAKEN OUT OF THE LINE BOX ON PURPOSE.
            It used to be an inline-block on `vertical-align: middle`, which
            aligns a box's centre to `baseline + x-height/2`. That is the
            optical centre of LOWERCASE, and these labels are "Put Wall",
            "Call Wall", "CORE" — caps and ascenders, no descenders — so the
            ink sits higher than the x-height band and the square read ~1.5px
            low against it. Worse, an inline swatch rides the line box, and
            snapshot.ts's `data-cap-center` rewrite MOVES that line box (it
            re-splits the padding by the measured html2canvas baseline bias to
            get the glyphs centred), which dragged the square somewhere else
            again in the PNG — so the popped-out capture disagreed with the
            live page as well as with itself.
            Absolutely positioned against the chip and centred on its box, the
            square depends on no font metric at all: the text is centred in
            that same box by the fixed height + line-height, so centring on the
            box IS centring on the label, live and in the capture alike.
            Measured both ways against a real html2canvas render before and
            after: live drift 1.5px → 0.5px, and the capture now lands within
            a third of a pixel of the live page instead of moving with the
            bias.
            2026-08-29: centring on the box is right on the LIVE page and still
            wrong in the PNG, because html2canvas does not draw text where the
            box puts it — it draws every run at `textRect.top + baseline`, and
            that `baseline` comes from a probe measured in the MAIN document
            under the BODY's line-height (FontMetrics is constructed with the
            page `document`, not the clone). The cap-center rewrite collapses
            the chip to `line-height:1`, so the probe's half-leading is not the
            chip's, and the glyphs land several px below the box centre the
            square is pinned to — the whole 3px of padding slack cannot buy
            that back. `data-cap-swatch` opts the square into snapshot.ts's
            second pass, which re-pins it to where the text will ACTUALLY be
            drawn. Capture-only: nothing here moves on the live page. */}
        <span aria-hidden data-cap-swatch style={{
          position: "absolute", left: 0, top: "50%", marginTop: -LEGEND_SWATCH / 2,
          display: "block", boxSizing: "border-box",
          width: LEGEND_SWATCH, height: LEGEND_SWATCH, borderRadius: 2,
          background: on ? color : "transparent", border: `1px solid ${color}`,
        }} />
        <span style={{ verticalAlign: "middle", marginRight: 6 }}>{label}</span>
        <span style={{ verticalAlign: "middle", fontFamily: "var(--font-mono)", color: on ? HOME_THEME.text : MUTED }}>{value}</span>
      </button>
    );
  };

  const lastSpot = last.spotDrawn.length ? last.spotDrawn[last.spotDrawn.length - 1].v : null;

  /**
   * LONG RANGE — more sessions than the week rail can name. A weekday and a
   * date under every slice was fine for five; at sixty-three it is a wall of
   * 10px type nobody can read. So past ten sessions the rail stamps only the
   * FIRST session and every session that opens a new month, the per-day
   * dividers fade to a hairline and the month edges take their weight — the
   * eye reads weeks by the dividers and months by the labels.
   */
  const longRange = N > 10;
  const monthEdge: boolean[] = segs.map((seg, i) => i === 0 || seg.date.slice(0, 7) !== segs[i - 1].date.slice(0, 7));

  return (
    <div style={{ padding: "13px 18px 12px", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: FS_LABEL, fontWeight: 800, letterSpacing: LS_LABEL, textTransform: "uppercase" }}>
          {title}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: FS_META, color: MUTED }}>
          {N > 1 ? `${N} sessions · ` : ""}recorded levels · {anyDense
            ? `${totalMins} min of price`
            : `${totalCaps} spot capture${totalCaps === 1 ? "" : "s"}`}
        </span>
        {onExpand ? (
          <button
            data-capture-hide
            onClick={onExpand}
            title="Open this chart full size — and over the last 5 sessions"
            style={{
              marginLeft: "auto", padding: "3px 9px", borderRadius: 7, cursor: "pointer",
              fontFamily: "inherit", fontSize: FS_LABEL, fontWeight: 800, letterSpacing: "0.08em",
              textTransform: "uppercase", border: `1px solid ${C.border}`,
              background: "rgba(255,255,255,0.03)", color: C.label,
            }}
          >
            ⤢ Expand
          </button>
        ) : null}
      </div>

      {/* Its own legend, under the head and above the plot. The section head
          says nothing about these series — which is exactly how a CORE line
          reads as an unexplained squiggle. */}
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        {drawn.map((lt) => legendChip(lt, LEVEL_COLOR[lt], LEVEL_LABEL[lt], wallStrike(lastOf(lt))))}
        {lastSpot != null ? legendChip("spot", HOME_THEME.text, "spot", wallNum(lastSpot)) : null}
      </div>

      {/* preserveAspectRatio="none" — the x axis is slots, the y axis is price,
          and the two have no business sharing a scale. Every stroke carries
          vectorEffect so the squash never thickens a line, and there is no
          <text> or <circle> inside for the same reason. */}
      <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 100 ${height}`} height={height} preserveAspectRatio="none"
        style={{ width: "100%", display: "block" }}>
        {/* Session boundaries. Solid, unlike the dashed "log stopped writing"
            mark, because they are a different kind of edge: one is a gap in the
            clock, the other is a gap in the rows. */}
        {segs.slice(1).map((seg, k) => (
          <line key={`div-${seg.date}`} x1={(k + 1) * segW} x2={(k + 1) * segW} y1={0} y2={height}
            stroke={rgba(HOME_THEME.text, longRange ? (monthEdge[k + 1] ? 0.28 : 0.06) : 0.22)}
            strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {/* Where the log stopped writing. Everything right of it is the forward
            fill — the levels held, which is why there are no rows — and the
            reader is entitled to see which half is captures and which is hold. */}
        {heldFrom != null ? (
          <line x1={heldFrom} x2={heldFrom} y1={0} y2={height}
            stroke={rgba(HOME_THEME.text, 0.16)} strokeWidth={1} strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke" />
        ) : null}
        {paths.map((p) => (
          <polyline key={p.key} points={p.d} fill="none" stroke={p.color} strokeWidth={p.w}
            vectorEffect="non-scaling-stroke" strokeLinejoin="miter" />
        ))}
        {/* Spot last, so it reads on top of the levels it is being compared with. */}
        {spotLines.map((c) => (
          <polyline key={c.key} points={c.d} fill="none" stroke={HOME_THEME.text} strokeWidth={1.5}
            vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {/* Same-origin PNG, so it never taints the canvas the way a /proxy/ image
          would; `pointer-events:none` so it cannot eat a click; and NOT
          data-capture-hide — riding into the screenshot is the whole point. */}
      {watermark ? (
        <img
          src="/cb-edge-logo.png"
          alt="CB Edge"
          style={{
            position: "absolute", right: 16, bottom: 12, height: 58, width: "auto",
            opacity: 0.4, pointerEvents: "none", userSelect: "none",
          }}
        />
      ) : null}
      </div>

      {/* One clock rail for a single session; one date stamp per slice for a
          week, because 09:29/12:45/16:00 repeated five times says nothing. */}
      {N === 1 ? (
        <div style={{
          display: "flex", justifyContent: "space-between", marginTop: 5,
          fontFamily: "var(--font-mono)", fontSize: 10, color: MUTED,
        }} aria-hidden>
          <span>{slotClock(0)}</span>
          <span>{slotClock(Math.round(last.lastSlot / 2))}</span>
          <span>{slotClock(last.lastSlot)}</span>
        </div>
      ) : longRange ? (
        <div style={{ position: "relative", height: 28, marginTop: 5, color: MUTED }} aria-hidden>
          {segs.map((seg, i) => (monthEdge[i] ? (
            <span key={seg.date} style={{ position: "absolute", left: `${i * segW}%`, top: 0, paddingLeft: 4, whiteSpace: "nowrap" }}>
              <span style={{
                display: "block", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em",
                textTransform: "uppercase", color: C.label,
              }}>{monName(seg.date)}</span>
              <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 10 }}>{mdShort(seg.date)}</span>
            </span>
          ) : null))}
          <span style={{ position: "absolute", right: 0, top: 0, textAlign: "right" }}>
            <span style={{ display: "block", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.label }}>
              {N} sessions
            </span>
            <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 10 }}>{mdShort(segs[0].date)} → {mdShort(last.date)}</span>
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", marginTop: 5, color: MUTED }} aria-hidden>
          {segs.map((seg) => (
            <span key={seg.date} style={{ flex: `0 0 ${segW}%`, textAlign: "center", display: "block" }}>
              <span style={{
                display: "block", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em",
                textTransform: "uppercase", color: C.label,
              }}>{dowName(seg.date)}</span>
              <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 10 }}>{mdShort(seg.date)}</span>
            </span>
          ))}
        </div>
      )}

      {/* No caption. The chart is the panel's own explanation — the legend
          names every series and the page head carries the scope — and a
          paragraph under a 190px plot was taller than the plot. */}
    </div>
  );
}

/** "08/25" from "2026-08-25". The week view's per-slice stamp. */
function mmdd(date: string): string {
  const [, mm, dd] = date.split("-");
  return mm && dd ? `${mm}/${dd}` : date;
}

/**
 * "MONDAY" from "2026-08-24". Parsed at NOON UTC and read back in UTC, so the
 * name never slips a day on a browser west of Greenwich — the date string is a
 * calendar date, not an instant, and midnight-parsing it is how "Monday" turns
 * into "Sunday" for anyone in America.
 */
function dowName(date: string): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toUpperCase();
}

/** "8/21" from "2026-08-21" — the axis stamp under the weekday, no zero pad. */
function mdShort(date: string): string {
  const [, mm, dd] = date.split("-");
  return mm && dd ? `${Number(mm)}/${Number(dd)}` : date;
}

/** "SEP" from "2026-09-01" — the long-range rail's month stamp. */
function monName(date: string): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
}

/**
 * The last `n` weekday dates on or before `end`, newest last.
 *
 * Weekends only — market holidays are not enumerated here on purpose. A holiday
 * simply has no rows, and useWallDays drops empty days after the fetch, which
 * handles a half-day, an unscheduled close and a ticker that was not in the
 * scanner universe yet with the same rule and no calendar to keep in sync.
 */
function lastWeekdays(end: string, n: number): string[] {
  const out: string[] = [];
  const t = Date.parse(`${end}T12:00:00Z`);
  if (!Number.isFinite(t)) return out;
  for (let k = 0; out.length < n && k < n * 3 + 10; k++) {
    const d = new Date(t - k * 86_400_000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse();
}

/**
 * MULTI-SESSION FETCH for the popout's week view.
 *
 * Two waves, deliberately. The level logs are small and cheap, so it asks for
 * more candidate weekdays than it needs (holidays, days before the ticker
 * entered the scanner universe) and keeps the newest `count` that came back with
 * rows. Only THOSE days then get a tape request, so a bank holiday never costs a
 * 1-minute candle fetch.
 *
 * Everything is best-effort: a failed day resolves to empty and is dropped, and
 * the chart draws whatever sessions did arrive rather than nothing.
 */
function useWallDays(
  symbol: string | null, endDate: string, count: number, nonce: number,
  scope: ExpScope, basis: GexBasis,
): { days: DaySlice[]; loading: boolean } {
  const [state, setState] = useState<{ days: DaySlice[]; loading: boolean }>({ days: [], loading: false });
  useEffect(() => {
    if (!symbol || count < 1) { setState({ days: [], loading: false }); return; }
    let alive = true;
    setState((prev) => ({ days: prev.days, loading: true }));
    (async () => {
      const candidates = lastWeekdays(endDate, count + 3);
      const logs = await Promise.all(candidates.map(async (d) => {
        try {
          const r = await fetch(
            `/proxy/walls?date=${encodeURIComponent(d)}&symbol=${encodeURIComponent(symbol)}${variantQuery(scope, basis)}`,
            { cache: "no-store" },
          );
          const j = await r.json();
          if (!j?.ok) return null;
          const log: WallLogRow[] = Array.isArray(j.log) ? j.log : [];
          const events: WallEventRow[] = Array.isArray(j.events) ? j.events : [];
          return log.length || events.length ? { date: d, log, events } : null;
        } catch { return null; }
      }));
      const kept = logs.filter(Boolean).slice(-count) as { date: string; log: WallLogRow[]; events: WallEventRow[] }[];
      if (!alive) return;
      if (!kept.length) { setState({ days: [], loading: false }); return; }

      // Show the levels immediately; the tape is the slow half and only sharpens
      // the price line, so it lands as a second render rather than a spinner.
      setState({ days: kept.map((k) => ({ ...k, price: [] })), loading: true });

      const tapes = await Promise.all(kept.map(async (k) => {
        const from = etMsOn(k.date, 9, 30);
        const to = etMsOn(k.date, 16, 0);
        if (!Number.isFinite(from) || !Number.isFinite(to)) return [] as SpotSample[];
        try {
          const r = await fetch(
            `/proxy/candles-intraday?symbol=${encodeURIComponent(symbol)}&interval=1m&fromMs=${Math.round(from)}`,
            { cache: "no-store" },
          );
          const j = await r.json();
          const cs: unknown[] = Array.isArray(j?.candles) ? j.candles : [];
          const out: SpotSample[] = [];
          for (const c of cs) {
            const row = c as { time?: unknown; close?: unknown };
            const t = Number(row?.time);
            const px = Number(row?.close);
            if (!Number.isFinite(t) || !(px > 0)) continue;
            if (t < from || t > to) continue;
            out.push({ mins: 570 + (t - from) / 60_000, px });
          }
          out.sort((a, b) => a.mins - b.mins);
          return out;
        } catch { return [] as SpotSample[]; }
      }));
      if (!alive) return;
      setState({ days: kept.map((k, i) => ({ ...k, price: tapes[i] })), loading: false });
    })();
    return () => { alive = false; };
  }, [symbol, endDate, count, nonce, scope, basis]);
  return state;
}

/**
 * LONG-RANGE FETCH for the SPX CORE migration card. One request:
 * /api/walls-range returns the change-only walls_log rows for the last `count`
 * recorded sessions of one symbol, grouped by date and already in slot order —
 * the same rows /proxy/walls?symbol= gives a day at a time. No events and no
 * tape: over three months the read is where the CORE sat and where it went,
 * and the spot stamped on every level row is enough of a price line for that.
 */
function useWallRange(
  symbol: string | null, endDate: string, count: number, nonce: number,
  scope: ExpScope, basis: GexBasis,
): { days: DaySlice[]; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ days: DaySlice[]; loading: boolean; error: string | null }>(
    { days: [], loading: false, error: null },
  );
  useEffect(() => {
    if (!symbol || count < 1) { setState({ days: [], loading: false, error: null }); return; }
    let alive = true;
    setState((prev) => ({ days: prev.days, loading: true, error: null }));
    (async () => {
      try {
        const r = await fetch(
          `/api/walls-range?symbol=${encodeURIComponent(symbol)}&days=${count}&end=${encodeURIComponent(endDate)}${variantQuery(scope, basis)}`,
          { cache: "no-store" },
        );
        const j = await r.json();
        if (!j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        const raw: { date: string; log: WallLogRow[] }[] = Array.isArray(j.days) ? j.days : [];
        const days: DaySlice[] = raw
          .filter((d) => d && typeof d.date === "string" && Array.isArray(d.log) && d.log.length)
          .map((d) => ({ date: d.date, log: d.log, events: [], price: [] }));
        if (alive) setState({ days, loading: false, error: null });
      } catch (e) {
        if (alive) setState({ days: [], loading: false, error: String((e as Error)?.message || e) });
      }
    })();
    return () => { alive = false; };
  }, [symbol, endDate, count, nonce, scope, basis]);
  return state;
}

/** The long-range card's symbol. SPX is the one with three months of CORE in the DB. */
const CORE_RANGE_SYMBOL = "SPX";
/** Sessions per range pill — a trading month is ~21, a quarter ~63. */
const CORE_RANGES: { id: 21 | 63; label: string; blurb: string }[] = [
  { id: 21, label: "1M", blurb: "The last 21 recorded sessions" },
  { id: 63, label: "3M", blurb: "The last 63 recorded sessions — about a quarter" },
];

/**
 * SPX — CORE MIGRATION over months. Deliberately the SAME WallMigrationChart
 * the day card and the popout draw with (one chart, one set of rules), handed
 * sixty-three sessions instead of one and opened on the CORE view: one gold
 * line, the CORE's strike, stepping across the quarter, with the spot captures
 * threaded through it. The WALLS pill switches the chart to the ALL view, which
 * brings the role model with it — CORE stays gold and the OTHER wall arrives in
 * the colour of the side it currently is — and the legend chips underneath
 * still drop any single series. Core-only is the default because that is the
 * question this card exists for: where has the heaviest gamma node on the
 * board been sitting, and how does that relate to where price went.
 *
 * Follows the page's date (as the range's END), variant switches and refresh,
 * but NOT its ticker or WALLS/CORE/ALL pills — it is an SPX card, and its own
 * pill owns whether walls draw.
 */
function CoreMigrationCard({ endDate, nonce, scope, basis }: {
  endDate: string; nonce: number; scope: ExpScope; basis: GexBasis;
}) {
  const [range, setRange] = useState<21 | 63>(63);
  const [wallsOn, setWallsOn] = useState(false);
  const { days, loading, error } = useWallRange(CORE_RANGE_SYMBOL, endDate, range, nonce, scope, basis);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const vTag = variantTag(scope, basis);
  const view: LogView = wallsOn ? "all" : "core";
  const snapFile = `${CORE_RANGE_SYMBOL.toLowerCase()}-core-migration-${wallsOn ? "walls" : "core"}-${scope}-${basis}-${endDate}-${range}s.png`;
  const snapTitle = `${CORE_RANGE_SYMBOL} — CORE migration · ${range} sessions to ${endDate} · ${vTag}`;

  const chip = (on: boolean, color: string = C.cyan): CSSProperties => ({
    padding: "5px 11px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${on ? color : C.border}`,
    background: on ? rgba(color, 0.16) : "rgba(255,255,255,0.03)",
    color: on ? color : C.label, fontSize: FS_LABEL, fontWeight: 800,
    letterSpacing: "0.08em", textTransform: "uppercase",
  });

  return (
    <div ref={cardRef} style={{ ...CARD, overflow: "hidden", marginTop: 16 }}>
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: FS_LABEL, fontWeight: 800, letterSpacing: LS_LABEL, textTransform: "uppercase" }}>
          {CORE_RANGE_SYMBOL} — CORE migration
        </span>
        <span style={{ fontSize: FS_META, fontFamily: "var(--font-mono)", color: MUTED }}>
          {days.length ? `${days.length} sessions to ${endDate}` : `to ${endDate}`} · {vTag}
        </span>
        <div data-capture-hide style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 8 }}>
          {CORE_RANGES.map((r) => (
            <button key={r.id} onClick={() => setRange(r.id)} style={chip(range === r.id)} title={r.blurb}>{r.label}</button>
          ))}
          <span style={{ width: 1, height: 18, background: C.border, margin: "0 2px" }} />
          <button
            onClick={() => setWallsOn(false)}
            style={chip(!wallsOn, CORE_GOLD)}
            title="CORE only — the single heaviest gamma node, session by session"
          >
            Core only
          </button>
          <button
            onClick={() => setWallsOn(true)}
            style={chip(wallsOn, AMBER)}
            title="Draw the call wall and put wall alongside the CORE (legend chips can still drop any one)"
          >
            + Walls
          </button>
        </div>
        {loading ? <span style={{ fontSize: FS_META, color: MUTED }}>loading…</span> : null}
        <div data-capture-hide style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <SnapLogButton disabled={!days.length} targetRef={cardRef} filename={snapFile} title={snapTitle} />
        </div>
      </div>

      {days.length ? (
        <WallMigrationChart days={days} view={view} height={MIG_H * 1.6} title="CORE migration" />
      ) : (
        <div style={{ padding: "18px 18px 20px", fontSize: FS_BODY, color: MUTED }}>
          {loading
            ? "Loading sessions…"
            : error
              ? `Could not load /api/walls-range — ${error}`
              : `No recorded sessions for ${CORE_RANGE_SYMBOL} in the ${range} sessions ending ${endDate} on ${vTag}.`}
        </div>
      )}

      {/* What the line is, once. The day card can lean on the page head for
          this; a quarter of one gold line under a different title cannot. */}
      <div style={{ padding: "10px 18px 14px", fontSize: FS_META, color: MUTED, lineHeight: 1.5 }}>
        Recorded levels only — 09:29 open + every 15m to 16:00 ET, written when the level moved, carried
        forward when it did not. Spot is the price stamped on each capture, not the tape.
        {wallsOn ? " Walls on: CORE stays gold; the other wall draws in the colour of the side it currently is." : ""}
      </div>
    </div>
  );
}

/**
 * POPOUT — the same chart, full width and twice as tall, with a session-range
 * switch the inline card has no room for.
 *
 * Deliberately the SAME component underneath (`WallMigrationChart`), not a
 * second implementation: a popout that draws its own version of a chart is two
 * charts that agree until one of them is edited.
 *
 * "Today" reuses the day already loaded by the page — no refetch for the range
 * that is already on screen. "5 sessions" pulls its own days through
 * useWallDays. Both honour the page's WALLS/CORE/ALL view and both variant
 * switches, because a popout that quietly showed a different reading than the
 * card it came from would be the CORE-505 bug all over again.
 */
function WallMigrationPopout({ symbol, date, view, scope, basis, today, nonce, onClose }: {
  symbol: string | null;
  date: string;
  view: LogView;
  scope: ExpScope;
  basis: GexBasis;
  /** The already-loaded single session, so "Today" costs nothing. */
  today: DaySlice[];
  nonce: number;
  onClose: () => void;
}) {
  const [range, setRange] = useState<1 | 5>(5);
  const week = useWallDays(range === 5 ? symbol : null, date, 5, nonce, scope, basis);
  const days = range === 1 ? today : week.days;

  /**
   * The snapshot target is the PANEL, not the chart — the head carries the
   * ticker, the variant and the range, and a PNG of the plot alone is a picture
   * of some lines with no idea what they are of. Same `SnapLogButton` and same
   * lib/snapshot.ts pipeline as the log card, so there is still exactly one
   * html2canvas call site in the app (scripts/audit-ui.mjs --strict).
   */
  const panelRef = useRef<HTMLDivElement | null>(null);
  const snapFile = `${(symbol ?? "walls").toLowerCase()}-wall-migration-${view}-${scope}-${basis}-${date}${range === 5 ? "-5d" : ""}.png`;
  const snapTitle = `${symbol ?? "—"} — Wall migration · ${range === 5 ? "5 sessions to " : ""}${date} · ${variantTag(scope, basis)}`;

  // Esc closes, like every other overlay in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chip = (on: boolean): CSSProperties => ({
    padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${on ? C.cyan : C.border}`,
    background: on ? rgba(C.cyan, 0.16) : "rgba(255,255,255,0.03)",
    color: on ? C.cyan : C.label, fontSize: 13, fontWeight: 800,
    letterSpacing: "0.08em", textTransform: "uppercase",
  });

  return (
    <ModalPortal>
      {/* The scrim closes on click; the panel stops the bubble so a click inside
          never dismisses it mid-read. */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.72)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        }}
      >
        <div
          ref={panelRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            ...CARD, width: "min(1400px, 96vw)", maxHeight: "92vh", overflow: "auto",
            display: "flex", flexDirection: "column", position: "relative",
          }}
        >
          {/* The WHOLE head is live-page chrome in the PNG: snapshot.ts already
              bakes a title band carrying the ticker, the range and the variant,
              so this row came out as the same sentence twice — once in the band
              and once in cyan under it. */}
          <div data-capture-hide style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.cyan }}>
              {symbol ?? "—"} — Wall migration
            </span>
            <span style={{ fontSize: FS_META, fontFamily: "var(--font-mono)", color: MUTED }}>
              {variantTag(scope, basis)} · {VIEW_SCOPE[view]} view
            </span>
            <div data-capture-hide style={{ display: "flex", gap: 8, marginLeft: 12 }}>
              <button onClick={() => setRange(1)} style={chip(range === 1)} title={`Just ${date}`}>Today</button>
              <button onClick={() => setRange(5)} style={chip(range === 5)} title="The last 5 recorded sessions ending on the selected date">5 sessions</button>
            </div>
            {range === 5 && week.loading ? (
              <span style={{ fontSize: FS_META, color: MUTED }}>loading…</span>
            ) : null}
            {/* Live-page chrome — dropped from the PNG, which should be the
                chart and its head and nothing a reader cannot click. */}
            <div data-capture-hide style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <SnapLogButton
                disabled={!days.length}
                targetRef={panelRef}
                filename={snapFile}
                title={snapTitle}
              />
              <button
                onClick={onClose}
                style={{
                  padding: "6px 12px", borderRadius: 8, cursor: "pointer",
                  fontFamily: "inherit", fontSize: 13, fontWeight: 800, letterSpacing: "0.08em",
                  textTransform: "uppercase", border: `1px solid ${C.border}`,
                  background: "rgba(255,255,255,0.03)", color: C.label,
                }}
              >
                ✕ Close
              </button>
            </div>
          </div>

          {days.length ? (
            <WallMigrationChart days={days} view={view} height={MIG_H * 2.2} watermark />
          ) : (
            <div style={{ padding: 28, fontSize: FS_BODY, color: MUTED }}>
              {week.loading
                ? "Loading sessions…"
                : `No recorded sessions for ${symbol ?? "—"} in the 5 weekdays ending ${date} on ${variantTag(scope, basis)}.`}
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

/**
 * Renders into <body>, so an overlay is never clipped by a card's `overflow`
 * or trapped under a sibling's stacking context. Mounted lazily because
 * document does not exist during SSR/prerender.
 */
function ModalPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.body); }, []);
  return host ? createPortal(children, host) : null;
}


/**
 * Which side price came from. A CORE tag at 7772.97 on the 7775 level was
 * approached from BELOW, so a break is upward — price falling away afterwards
 * is a rejection, not a break. Reading a row without this is the "don't know
 * which direction the stock comes from" problem: the numbers alone are
 * ambiguous, and "broke by 18.77" against a level price never touched from
 * above is simply the wrong story.
 *
 * Walls have a fixed side (a call wall is tested from below, a put wall from
 * above). CORE has none, so it comes off spot vs. strike at the tag.
 */
function approachSide(e: { level_type: WallLevel; strike: number; spot_at_hit: number }): "below" | "above" {
  if (e.level_type === "call_wall") return "below";
  if (e.level_type === "put_wall") return "above";
  return Number(e.spot_at_hit) <= Number(e.strike) ? "below" : "above";
}

/** Chronological merge of level changes and classified hits. */
function WallTimeline({ log, events, view }: { log: WallLogRow[]; events: WallEventRow[]; view: LogView }) {
  type Entry = {
    slot: number; at: string; kind: "open" | "change" | "hit"; lt: WallLevel;
    /** Carried so the ALL view can spot the same strike wearing two hats. */
    strike: number;
    body: ReactNode; meta?: string; side?: "below" | "above";
  };
  const entries: Entry[] = [];

  for (const r of log) {
    entries.push({
      slot: r.slot, at: r.at, kind: r.reason, lt: r.level_type, strike: Number(r.strike),
      body: r.reason === "open"
        ? <>Open baseline — <b style={{ fontFamily: "var(--font-mono)" }}>{wallStrike(r.strike)}</b>. Spot <b style={{ fontFamily: "var(--font-mono)" }}>{wallNum(r.spot)}</b>.</>
        : <>Rolled {Number(r.delta) > 0 ? "up" : "down"} <b style={{ fontFamily: "var(--font-mono)" }}>{wallStrike(r.prev_strike)} → {wallStrike(r.strike)}</b>.</>,
      meta: r.level_gex != null ? `GEX at level ${gexShort(r.level_gex)}` : undefined,
    });
  }
  for (const e of events) {
    const approach = e.kind === "approach";
    const build = gexBuildPct(e.gex_at_hit, e.gex_at_resolve);
    const side = approachSide(e);
    // How far the approach stopped short. The old line read "Came up down to
    // 7,700 from above at 7,710.20" — a hardcoded "Came up" with the direction
    // bolted on after it, and the two numbers left for the reader to subtract.
    // One direction word, then the distance stated outright.
    const miss = missPts(e.strike, e.spot_at_hit);
    entries.push({
      slot: e.hit_slot, at: e.at, kind: "hit", lt: e.level_type, strike: Number(e.strike), side,
      body: approach
        ? <>Came {side === "below" ? "up" : "down"} to <b style={{ fontFamily: "var(--font-mono)" }}>{wallNum(e.spot_at_hit)}</b>
            {miss != null
              ? <> — <b style={{ fontFamily: "var(--font-mono)" }}>{wallNum(miss)}</b> short of <b style={{ fontFamily: "var(--font-mono)" }}>{wallStrike(e.strike)}</b>, never tagged</>
              : <>, right on <b style={{ fontFamily: "var(--font-mono)" }}>{wallStrike(e.strike)}</b> but never tagged</>}
            {e.note ? ` — ${e.note}.` : "."}</>
        : <>Tagged <b style={{ fontFamily: "var(--font-mono)" }}>{wallStrike(e.strike)}</b> from {side} at <b style={{ fontFamily: "var(--font-mono)" }}>{wallNum(e.spot_at_hit)}</b>{e.note ? ` — ${e.note}.` : "."}</>,
      meta: [
        // Excursion is measured in the BREAK direction, which is the opposite
        // side from the one price approached on. Spelling that out is the whole
        // point — an unsigned "+18.77" beside a level price tells you nothing
        // about whether price went through the level or fell away from it.
        !approach && e.excursion_pts != null
          ? (Number(e.excursion_pts) >= 0
              ? `pushed ${wallNum(Math.abs(Number(e.excursion_pts)))} ${side === "below" ? "up through" : "down through"}`
              : `stayed ${wallNum(Math.abs(Number(e.excursion_pts)))} short of it`)
          : null,
        e.reclaim_min != null ? `reclaimed in ${e.reclaim_min}m` : null,
        !approach && e.attempts > 1 ? `attempt ${e.attempts} on this strike` : null,
        e.was_core ? (e.core_held === false ? "was the CORE — CORE moved after" : "was the CORE") : null,
        e.gex_at_hit != null ? `GEX at level ${gexShort(e.gex_at_hit)}` : null,
        build != null ? `${build >= 0 ? "built" : "bled"} ${Math.abs(build).toFixed(0)}% by resolve` : null,
        e.reaction == null ? "watching — resolves 4 slots after the tag" : null,
      ].filter(Boolean).join(" · "),
    });
  }

  // Oldest first — the session reads top to bottom in the order it happened,
  // so the open baseline leads and the latest slot lands at the bottom. Within
  // one slot the change comes first and the hit it produced follows it.
  const kindRank = (k: Entry["kind"]) => (k === "hit" ? 1 : 0);
  entries.sort((a, b) => a.slot - b.slot || kindRank(a.kind) - kindRank(b.kind));

  const evByKey = new Map(events.map((e) => [`${e.hit_slot}|${e.level_type}`, e]));

  /**
   * ALL view only: CORE is frequently ALSO one of the walls — whichever is
   * carrying more gamma — so the same strike can produce two entries in the same
   * slot and read as two separate events. Say so on the row instead. Outside the
   * ALL view there is nothing to collide with, so the pass does not run.
   */
  const twinsOf = (e: Entry): WallLevel[] =>
    view !== "all" ? [] : entries
      .filter((o) => o !== e && o.slot === e.slot && o.lt !== e.lt
        && Number.isFinite(o.strike) && o.strike === e.strike)
      .map((o) => o.lt)
      .filter((lt, i, a) => a.indexOf(lt) === i);

  if (!entries.length) {
    return (
      <div style={{ padding: "34px 18px", textAlign: "center", fontSize: FS_BODY }}>
        {view === "core"
          ? "Nothing recorded on the CORE for this ticker — no baseline, no level changes, no touches."
          : view === "all"
          ? "Nothing recorded for this ticker — no baseline, no level changes, no touches on either wall or the CORE."
          : "Nothing recorded on the walls for this ticker — no baseline, no level changes, no touches."}
      </div>
    );
  }

  return (
    <div style={{ padding: "6px 18px 18px" }}>
      {entries.map((e, i) => {
        const dot = e.kind === "hit" ? AMBER : e.kind === "open" ? HOME_THEME.orange : C.cyan;
        const ev = e.kind === "hit" ? evByKey.get(`${e.slot}|${e.lt}`) : null;
        const last = i === entries.length - 1;
        return (
          <div key={`${e.slot}-${e.kind}-${e.lt}-${i}`}
            style={{ display: "grid", gridTemplateColumns: "58px 14px 1fr", gap: 10, padding: "11px 0",
              borderBottom: last ? "none" : "1px solid rgba(255,255,255,0.05)" }}>
            {/* Time, dot and badge row all lock to ROW_LEAD_H so the three
                columns sit on one optical line instead of each finding its own
                baseline off whatever line-height its font happened to use. */}
            <div style={{ fontFamily: "var(--font-mono)", fontSize: FS_META, lineHeight: `${ROW_LEAD_H}px` }}>{e.at}</div>
            {/* No fixed height here — the cell stretches to the row so the
                connector can run all the way down to the next dot. */}
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 3.5, top: (ROW_LEAD_H - 7) / 2, width: 7, height: 7, borderRadius: 999, background: dot, boxShadow: `0 0 10px ${rgba(HOME_THEME.cyan, 0.45)}` }} />
              {!last ? <span style={{ position: "absolute", left: 6.5, top: (ROW_LEAD_H + 7) / 2 + 3, bottom: -11, width: 1, background: "rgba(255,255,255,0.08)" }} /> : null}
            </div>
            <div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minHeight: ROW_LEAD_H }}>
                <span style={{ fontSize: FS_LABEL, lineHeight: `${ROW_LEAD_H}px`, fontWeight: 800, letterSpacing: LS_LABEL, textTransform: "uppercase", color: LEVEL_COLOR[e.lt] }}>
                  {LEVEL_LABEL[e.lt]}
                </span>
                {e.kind === "open" ? <span data-cap-center style={wallBadgeStyle(MUTED)}>Open baseline</span> : null}
                {e.kind === "change" ? <span data-cap-center style={wallBadgeStyle(C.cyan)}>Changed</span> : null}
                {e.kind === "hit" ? wallBadge(ev?.reaction ?? null, false, ev?.reclaim_min ?? null) : null}
                {/* Direction of approach, stated up front rather than left to be
                    inferred from spot vs. strike further down the row. */}
                {e.side ? (
                  <span title={e.side === "below" ? "Price came into the level from below — a break goes up" : "Price came into the level from above — a break goes down"}
                    style={{ fontFamily: "var(--font-mono)", fontSize: FS_META, lineHeight: `${ROW_LEAD_H}px`, color: e.side === "below" ? GREEN : RED }}>
                    {e.side === "below" ? "↑ from below" : "↓ from above"}
                  </span>
                ) : null}
                {/* Same strike, second hat — the ALL view's whole point. */}
                {twinsOf(e).map((lt) => (
                  <span key={lt} title={`This strike is also the ${LEVEL_LABEL[lt].toLowerCase()} at this slot — one level, two roles`}
                    style={{
                      fontSize: 10, lineHeight: `${ROW_LEAD_H}px`, letterSpacing: LS_LABEL,
                      textTransform: "uppercase", color: LEVEL_COLOR[lt],
                    }}>
                    = {LEVEL_LABEL[lt]}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: FS_BODY, marginTop: 4, lineHeight: 1.5 }}>{e.body}</div>
              {e.meta ? <div style={{ fontFamily: "var(--font-mono)", fontSize: FS_META, marginTop: 6, lineHeight: 1.5 }}>{e.meta}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
