"use client";

/**
 * /premarket → POST-MARKET tab. LIVE, and derived from the same feed the
 * Premarket tab uses — no second socket, no duplicated math.
 *
 * The premarket tab answers "what is the map before the open". This one answers
 * the three questions that only exist after the close:
 *
 *   1. Did the morning map hold?      → snapshot + level scorecard
 *   2. How was the book actually built? → build-time bars + peak marks, the wall
 *                                       path, written-vs-traded, and the
 *                                       positioned-vs-written split
 *   3. What does tomorrow look like?  → next-expiry structure, after 0DTE rolls off
 *
 * Section 2 deliberately does NOT ask "what changed since 09:30". On 0DTE the
 * open book is ~2% of the close, so that question always answers "everything"
 * and its delta chart is a copy of the profile. Each strike is instead reduced
 * to WHEN it took its share of the board (three buckets, coloured along the bar)
 * and WHAT IT DID IN THE LAST HOUR (its own column, its own scale).
 *
 * ── THE HIGH-WATER MARK IS GONE; EVERYTHING IS SHARE NOW (2026-08-24) ───────
 * This panel used to carry a peak tick and a hatched "given back" region, and
 * the bar scale folded the peak in. All of it was measuring the clock.
 *
 * Per-strike GEX is γ × (OI+Vol) × S² and γ ∝ 1/√T. Into the bell that term
 * piles gamma onto whatever is ATM and drains it from everything else, so:
 *   · every strike's raw peak lands in the final minutes at 50-150× its own
 *     settle — an ATM 0DTE strike marks ~$200-300B at 15:55 against a ~$2B
 *     close — and ONE such strike set the bar scale for all 121 rows, which is
 *     why every real bar, the call wall included, drew as a 2px sliver with its
 *     AM/MID/PM colours invisible;
 *   · and by the last recorded column all but a handful of ATM strikes have
 *     decayed to ~zero, so EVERY row read ~100% off its own high. "Everything
 *     was given back" is true of every strike on every expiry session. It is a
 *     property of expiry, not a measurement, and it cannot tell an abandoned
 *     level apart from one that merely expired.
 *
 * So the peak, the hatch and the tick are removed, and the panel measures SHARE
 * OF THE BOARD instead:
 *
 *     share_k(t) = |net_k(t)| / Σ_j |net_j(t)|
 *
 * The 1/√T term is in the numerator and the denominator, so it divides straight
 * out. What is left is the board changing hands. Both the build buckets and the
 * 15:00→close column are measured this way, in percentage points.
 *
 * What each part of a row means now:
 *   · bar LENGTH   where the strike closed, in dollars, scaled over the biggest
 *                  closing bar on screen. Nothing else is in that scale.
 *   · bar COLOUR   when it took its board share — blue AM, violet MID, amber PM.
 *   · the column   15:00→close change in board share, in points, on its own
 *                  scale. Right/amber took share into the bell, left/red lost
 *                  it. Magnitude-based, so a put wall going more negative reads
 *                  as growth, which is what it is.
 *
 * ── NOTHING ON THIS TAB IS ES ───────────────────────────────────────────────
 * Every price this tab prints is an SPX price from an SPX source. There is no
 * basis conversion left in the file and no prop that could supply one: `esFut`,
 * `basis`, `candles` and `overnight` are gone, and so is the ES-bar fallback
 * for the day's path. A futures print run through a basis is not an SPX print,
 * and the one time it was allowed to stand in for one it produced a session low
 * SPX never traded and graded the put wall BROKEN off it. Where SPX has no
 * source, the number renders "—" — same rule as everywhere else here.
 *
 * DATA SOURCES
 *   props                       everything the Premarket tab already computed off
 *                               the live chain — spot, walls, flip, CORE, max pain,
 *                               per-strike GEX, totals, and SPX's prior close.
 *   /api/snapshots/option-strike-gex-history
 *                               the per-minute strike ladder the ES chart's bubble
 *                               trail already backfills from. It is what makes a
 *                               REAL recap possible: an intraday SPX spot path and
 *                               a 09:30 GEX profile, neither of which the live
 *                               socket keeps. Same endpoint, same guards as
 *                               hooks/useGexBubbleHistory (see its header: the
 *                               route answers 200 even when it threw, and "today"
 *                               is the newest NON-WEEKEND day present, not
 *                               etDayKey(now) — the recorder has no market-hours
 *                               gate and rewrites a frozen copy all weekend).
 *   /proxy/walls?date&symbol=SPX
 *                               the SAVED grade. server-v2/walls-recorder.js
 *                               captures SPX's call wall / put wall / CORE at
 *                               09:29 and every 15 min to 16:00, writes only on
 *                               a change, and classifies every touch four slots
 *                               later (reject / break / pin / new wall / …). The
 *                               scorecard reads that verdict instead of inventing
 *                               its own, exactly like /level-log; the derived
 *                               grade stays underneath as the fallback.
 *   /api/expirations + /api/chains
 *                               the ONE thing that needs a second chain: tomorrow's
 *                               structure cannot be derived from today's expiring
 *                               book. Fetched once, only while this tab is open,
 *                               and every panel degrades to "—" if it fails.
 *
 * NOTHING HERE IS SYNTHETIC. A number that cannot be derived renders as "—" or as
 * an explicit "not recorded today" note; it is never filled in with a plausible
 * value. That rule is what makes the scorecard worth reading.
 *
 * Styling: the same `.pmk` scope as the Premarket tab. This file exports its own
 * CSS block, which Premarket.tsx concatenates onto its own — one <style>, one
 * theme, no chance of the two drifting apart.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findGEXFlip, netGEXOf, type ChainRow } from "@/lib/calculations/calculations";
import {
  etHm,
  RTH_CLOSE_MIN,
  RTH_OPEN_MIN,
  etMinutes,
  useIntradayLadder,
  useNextExpiryStructure,
  useRecordedWalls,
  NOTES_KEY,
  LEVEL_LABEL,
  REACTION_LABEL,
  REACTION_TONE,
  type WallLevel,
  type Col,
} from "./postMarketData";

// ─────────────────────────────────────────────────────────────────────────────
//  CSS — appended to the Premarket tab's block, same .pmk scope
// ─────────────────────────────────────────────────────────────────────────────

export const POSTMARKET_CSS = `
.pmk .tabs{display:inline-flex;border:1px solid var(--line2);border-radius:var(--r2);overflow:hidden}
.pmk .tabs button{background:transparent;border:0;border-right:1px solid var(--line2);color:var(--dim);
  font:inherit;font-size:11.5px;letter-spacing:.04em;padding:5px 13px;cursor:pointer}
.pmk .tabs button:last-child{border-right:0}
.pmk .tabs button.on{background:var(--cyanWash);color:var(--cyan);font-weight:600}
.pmk .tabs button .tdot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;
  vertical-align:middle;background:var(--amber)}

/* Post-market shell — same card as .prep (border, radius, shadow all inherited);
   only the regime tint changes to the blue that means "settled session". The
   coloured 1px ring went with .prep's for the same reason: no other card in the
   app has a second border. */
.pmk .prep.is-post{
  border-top-color:var(--blueFill1);
  background:linear-gradient(180deg,var(--blueWash),transparent 190px), var(--panel);
}
.pmk .sec{padding:14px 18px;border-bottom:1px solid var(--line)}
.pmk .sec:last-child{border-bottom:0}
/* Section headers: title, then whatever the section's legend is, then a spacer.
   The legend belongs BESIDE the thing it explains — flung to the far right of a
   1560px header it reads as unrelated chrome, and on the build-time ramp that
   is five swatches nobody connects to the bars under them. A trailing item opts
   back out to the right edge with the .right class below.

   NOTE — NO BACKTICKS IN THIS COMMENT, or anywhere in this string. It is a
   template literal: one stray backtick ends it and turns everything after into
   a property access on a string, which is exactly how this block shipped broken
   ("Cannot read properties of undefined (reading 'right')" — the text after the
   stray backtick was a .sechead .right selector mentioned in prose).
   Premarket.tsx carries the same warning on its own CSS for the same reason. */
.pmk .sechead{display:flex;align-items:baseline;justify-content:flex-start;gap:14px;margin-bottom:11px;flex-wrap:wrap}
.pmk .sechead .right{margin-left:auto}
.pmk .sechead h3{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin:0;font-weight:600}
.pmk .secn{width:17px;height:17px;border-radius:5px;background:var(--cyanWash);color:var(--cyan);display:inline-grid;
  place-items:center;font-size:9.5px;font-weight:700;margin-right:8px;vertical-align:1px}
.pmk .warnbar{padding:8px 11px;border-radius:var(--r2);border:1px solid var(--amberEdge);
  background:var(--amberWash);font-size:11.5px;color:var(--dim)}

/* 1 — snapshot. Every column carries a min-width: the captions under the range
   bar are absolutely positioned, and without a floor the grid squeezes a column
   until a caption lands on top of the pill in the next one. */
/* SEVEN tracks and SEVEN children — the row shipped with six, so the verdict
   card landed in the 1px divider track and wrapped one word per line while the
   spare divider drew a stray line under the row. Count them together when
   either changes: close | vr | range | vr | net gex | vr | verdict. */
.pmk .snap{display:grid;
  grid-template-columns:minmax(180px,auto) 1px minmax(300px,1.3fr) 1px minmax(240px,1fr) 1px minmax(240px,300px);
  align-items:start;row-gap:14px}
.pmk .snap .vr{align-self:center}
.pmk .snap .bias{justify-self:stretch;max-width:none;text-align:left}
.pmk .rangebar{position:relative;height:42px;margin-top:8px}
.pmk .rangebar .wallband{position:absolute;left:0;right:0;top:16px;height:14px;border-radius:7px;
  background:linear-gradient(90deg,var(--negBand),rgba(255,255,255,.05),var(--posBand));border:1px solid var(--line)}
.pmk .rangebar .act{position:absolute;top:19px;height:8px;border-radius:5px;
  background:linear-gradient(90deg,var(--blueFill1),var(--blueFill3))}
.pmk .rangebar .mk3{position:absolute;top:11px;width:2px;height:24px;border-radius:2px;transform:translateX(-50%)}
.pmk .rangebar .cp3{position:absolute;top:0;font-size:9.5px;white-space:nowrap;transform:translateX(-50%)}
.pmk .rangelabs{display:flex;justify-content:space-between;gap:8px;font-size:9.5px;color:var(--dim)}

/* 2 — scorecard */
.pmk .scorecard{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
/* NO ACCENT STRIPES. Cards carry their meaning in the label colour and the
   pill, not in a coloured edge — a page of striped cards reads as a page of
   warnings. This went through three shapes (a ::before painted by tone classes,
   an absolutely-positioned child, an inline border) before the answer turned out
   to be "none of them". Do not add a fourth. */
.pmk .sc{position:relative;border:1px solid var(--card);
  border-radius:var(--r);background:var(--panel2);padding:10px 11px 11px}
.pmk .sc .src{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim2);margin-top:6px}
.pmk .sc .nm{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim2);
  display:flex;justify-content:space-between;align-items:center;gap:6px}
.pmk .sc .px{font-size:20px;font-weight:660;letter-spacing:-.03em;margin:3px 0 1px}
.pmk .sc .sub{font-size:10.5px;color:var(--dim)}
.pmk .taps{display:flex;gap:2px;margin-top:8px;height:16px;align-items:flex-end}
.pmk .taps i{flex:1;background:var(--sunken);border-radius:2px;height:5px}
.pmk .taps i.t{background:var(--pos);height:13px}
.pmk .taps i.b{background:var(--neg);height:16px}
.pmk .taps i.c{background:var(--amber);height:10px}

/* 3 — evolution. ONE bar per strike (where it closed), coloured by WHEN it took
   its share of the board, plus a separate 15:00→close column.
   There is no peak tick and no "given back" hatch any more — on an expiring book
   every strike ends ~100% off its own high, so the hatch was a constant. See the
   EvRow header.
   ALL BARS GROW RIGHT off a shared left edge. The mirrored layout this replaced
   put negative strikes on the left of a centre axis, which meant bar LENGTH read
   in two different directions and the two halves could not be compared at all.
   Sign now lives in its own two columns — a +/− chip and the signed dollar
   value — so length always means the same thing. */
.pmk .evrow{display:grid;grid-template-columns:54px 13px 60px 1fr 78px 112px 76px;
  align-items:center;height:21px;gap:7px}
.pmk .evrow .sgn{font-size:11px;font-weight:800;text-align:center;line-height:1}
.pmk .evrow .sgn.p{color:var(--pos)}
.pmk .evrow .sgn.n{color:var(--neg)}
.pmk .evrow .netcol{font-size:9.5px;text-align:right;white-space:nowrap;font-weight:600}
/* Left-anchored rail. Overrides the centre-axis .track the premarket profile
   uses (higher specificity, so it wins regardless of sheet order) — that
   gradient draws a zero line down the middle, which is meaningless here. */
.pmk .evrow .track{position:relative;height:13px;border-radius:3px;background:var(--sunken);
  box-shadow:inset 1px 0 0 var(--line2)}
.pmk .evrow .track.neg{background:var(--negWash)}
/* Build-time segments: bar LENGTH is where the strike closed in dollars, its
   COLOUR composition is when it took its share of the board — blue morning,
   violet midday, amber power hour. Laid left→right in time order, so a bar reads
   the way the day ran. Shares are normalised over the ABSOLUTE share moves, so a
   strike that built and then gave some back reads as its two moves, not >100%. */
.pmk .evrow .seg{position:absolute;top:3px;bottom:3px}
.pmk .evrow .seg:first-of-type{border-radius:2px 0 0 2px}
.pmk .evrow .bar{position:absolute;left:0;top:3px;bottom:3px;border-radius:2px}
.pmk .evrow .bar.p{background:var(--pos)}
.pmk .evrow .bar.n{background:var(--neg)}
.pmk .builtcol{font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dim)}
.pmk .builtcol .sep{color:var(--dim2)}
.pmk .evrow .k{font-size:10.5px;text-align:right;color:var(--dim)}
.pmk .evrow.key .k{color:var(--txt);font-weight:700}
.pmk .evrow .tagcol{font-size:9px;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
/* ── POWER HOUR, ON ITS OWN SCALE ───────────────────────────────────────────
   15:00→close change in the strike's SHARE OF THE BOARD, in percentage points,
   normalised over its own column and not over the main bar.
   Share rather than dollars, because dollars cannot answer the question: γ ∝
   1/√T drains every non-ATM strike toward zero into the bell whatever anyone
   traded, so a dollar reading says "−100%" on almost every row and means only
   "the options expired". A share has that term in numerator and denominator, so
   it cancels and what is left is the board changing hands.
   Right/amber = the strike TOOK board share into the close. Left/red = it lost
   share. Magnitude-based, so a put wall going more negative reads as growth —
   which is what it is. */
.pmk .evrow .pmtrack{position:relative;height:13px;border-radius:3px;background:var(--sunken);
  box-shadow:inset 1px 0 0 var(--line2)}
.pmk .evrow .pmtrack .zero{position:absolute;left:50%;top:1px;bottom:1px;width:1px;background:var(--line3)}
.pmk .evrow .pmtrack i{position:absolute;top:3px;bottom:3px;border-radius:2px}
.pmk .evrow .pmtrack i.up{background:var(--amber);left:50%}
.pmk .evrow .pmtrack i.dn{background:var(--neg);right:50%}
.pmk .evrow .pmtrack.off{background:none;box-shadow:none}
.pmk .evlegend{display:flex;gap:14px;flex-wrap:wrap;font-size:9.5px;letter-spacing:.05em;
  text-transform:uppercase;color:var(--dim2)}
.pmk .evlegend i{display:inline-block;width:9px;height:8px;border-radius:2px;margin-right:5px;vertical-align:middle}
/* Written vs traded — two bars growing away from a centred strike label. */
.pmk .mrow{display:grid;grid-template-columns:1fr 52px 1fr;align-items:center;height:18px;gap:6px}
.pmk .mrow .mleft{display:flex;justify-content:flex-end}
.pmk .mrow .mbar{height:11px;border-radius:2px}
.pmk .mrow .mk3{font-size:10px;text-align:center;color:var(--dim)}

/* Positioned vs written — one stacked bar per strike, OI then volume. */
.pmk .srow{display:grid;grid-template-columns:54px 1fr 128px;align-items:center;height:22px;gap:9px}
.pmk .srow .k{font-size:10.5px;text-align:right;color:var(--dim)}
.pmk .srow .v{font-size:10.5px;text-align:right;white-space:nowrap}
.pmk .stack{display:flex;height:13px;border-radius:3px;overflow:hidden;background:var(--sunken)}
.pmk .stack i{display:block;height:100%}

.pmk .heat{display:grid;gap:2px;margin-top:6px}
.pmk .heat i{height:22px;border-radius:3px;background:var(--sunken)}
.pmk .heatx{display:flex;justify-content:space-between;font-size:9px;color:var(--dim2);margin-top:4px}

/* 4/5/6 */
.pmk .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.pmk .tile{position:relative;border:1px solid var(--card);border-radius:9px;background:var(--panel2);
  padding:9px 10px;overflow:hidden}
.pmk .tile .n2{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2)}
.pmk .tile .v2{font-size:16px;font-weight:640;margin-top:2px;letter-spacing:-.02em}
.pmk .tile .m2{font-size:10px;color:var(--dim)}
.pmk .split{display:flex;height:9px;border-radius:5px;overflow:hidden;margin-top:10px;border:1px solid var(--line)}
.pmk .split i{display:block;height:100%}
.pmk .biasbox{margin-top:10px;padding:10px 12px;border-radius:var(--r);
  background:var(--blueWash);border:1px solid var(--blueEdge);font-size:12.5px}
.pmk .biasbox b{color:var(--blue)}
.pmk .jot{width:100%;min-height:86px;resize:vertical;background:var(--plate);color:var(--txt);
  border:1px solid var(--line2);border-radius:8px;padding:9px 10px;font:inherit;font-size:12px}
.pmk .jot:focus{outline:none;border-color:var(--cyanEdge)}
.pmk .acc{display:flex;align-items:flex-end;gap:5px;height:60px;margin-top:6px}
.pmk .acc .c{flex:1;background:var(--sunken);border-radius:3px 3px 0 0;position:relative;min-height:4px}
.pmk .acc .c i{position:absolute;left:0;right:0;bottom:0;border-radius:3px 3px 0 0;
  background:linear-gradient(180deg,var(--pos),var(--posDim))}
.pmk .movelog{display:grid;gap:0;margin-top:10px}
/* The log is the WHOLE day, not the last eight rows — a silently truncated list
   reads as "that is all that happened". It scrolls instead, capped at ~9 rows so
   it never pushes section 3 off the screen. */
.pmk .movelog .mvscroll{max-height:212px;overflow-y:auto;overscroll-behavior:contain;
  padding-right:6px;scrollbar-width:thin;scrollbar-color:var(--line2) transparent}
.pmk .movelog .mvscroll::-webkit-scrollbar{width:7px}
.pmk .movelog .mvscroll::-webkit-scrollbar-track{background:transparent}
.pmk .movelog .mvscroll::-webkit-scrollbar-thumb{background:var(--line2);border-radius:4px}
.pmk .movelog .mvscroll::-webkit-scrollbar-thumb:hover{background:var(--dim2)}
.pmk .movelog .mv{display:grid;grid-template-columns:52px 74px 1fr auto;gap:10px;align-items:center;
  padding:5px 0;border-bottom:1px dashed var(--line);font-size:11.5px}
.pmk .movelog .mv:last-child{border-bottom:0}
.pmk .rx{font-size:9.5px;padding:2px 6px;border-radius:5px;white-space:nowrap;border:1px solid var(--line2)}
.pmk .premlist{display:grid;gap:7px;margin-top:8px}
.pmk .premrow{display:grid;grid-template-columns:52px 1fr 54px;gap:9px;align-items:center}
.pmk .premrow .pl{font-size:11px;color:var(--txt);font-weight:600}
.pmk .premrow .ptrack{height:9px;border-radius:5px;background:var(--sunken);overflow:hidden}
.pmk .premrow .ptrack i{display:block;height:100%;border-radius:5px}
.pmk .premrow .pu{font-size:10.5px;text-align:right;font-weight:640;white-space:nowrap}

@media (max-width:1180px){
  .pmk .snap{grid-template-columns:1fr}
  .pmk .scorecard{grid-template-columns:repeat(2,1fr)}
  .pmk .tiles{grid-template-columns:repeat(2,1fr)}
}
`;

// ─────────────────────────────────────────────────────────────────────────────
//  types + small helpers
// ─────────────────────────────────────────────────────────────────────────────

/* The ES bar type this tab used to take is GONE, along with `candles`,
   `overnight`, `esFut` and `basis`. This is the SPX recap: every price it
   prints is an SPX price from an SPX source, and there is no longer a code path
   that can turn a futures print into one. See the `path` comment. */

export type PostMarketProps = {
  spot: number;
  /**
   * SPX's own prior close, from /api/quotes-batch (Yahoo ^GSPC). NOT the ES
   * prior close shifted by a basis — see the `path` comment for what that cost.
   * Null until the quote lands, and the day-change row renders "—" until then.
   */
  spxPrevClose: number | null;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  totalNetGex: number | null;
  perStrike: { strike: number; net: number }[];
  /** The raw chain — the positioned-vs-written split needs the per-side legs. */
  chain: ChainRow[];
  coreBullseye: { strike: number; net: number } | null;
  maxPain: number | null;
  em: number | null;
  totals: { dex: number; vanna: number; callGex: number; putGex: number };
  expiry: string;
  etDate: string;
  etMin: number;
  hasData: boolean;
  /**
   * Set when this tab is rendering a FROZEN past session (Premarket.tsx swaps
   * the whole prop bundle for that day's captured chain — see its DATA SOURCE
   * block). Everything derived from the props is correct as-is; what this flag
   * changes is the three things that reach OUTSIDE the props and would
   * otherwise describe today:
   *
   *   the intraday ladder  — asked for by date instead of "the last 8 hours"
   *   next-expiry structure — suppressed; "tomorrow" for a past session means a
   *                           day that has already happened, and the panel would
   *                           fetch the CURRENT next expiry to answer it
   *   the accuracy log      — not written; it is a rolling append-only list of
   *                           finished sessions and back-dating into it puts it
   *                           out of order
   */
  frozenDate?: string;
};

// NOTES_KEY now lives in ./postMarketData so the historical recap writes the
// same per-date journal this tab does.
const LOG_KEY = "cb-postmarket-log-v1";

/**
 * Where the power hour starts — the boundary section 3 splits on. Module scope
 * because it keys a memo AND the bucket table, and a value redeclared per render
 * in a dependency array is a trap waiting for someone to make it non-primitive.
 */
const PM_FROM_MIN = 15 * 60;

const nf = (v: number, dp = 0) =>
  v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

const fmtPx = (v: number | null | undefined, dp = 0) =>
  v == null || !Number.isFinite(v) || v <= 0 ? "—" : nf(v, dp);

const fmtPts = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${nf(Math.abs(v), 0)} pts`;

/** Minute-of-day (ET) → "13:16". The bucket boundaries are minutes, not stamps. */
const etMinOfDay = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(Math.round(mins % 60)).padStart(2, "0")}`;

const fmtPct = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dp)}%`;

function fmtUsd(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : signed ? "+" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  component
// ─────────────────────────────────────────────────────────────────────────────

type LevelKey = "CW" | "PW" | "FLIP" | "CORE" | "MP";

type Grade = {
  key: LevelKey;
  name: string;
  hint: string;
  px: number | null;
  color: string;
  tone: "ok" | "bad" | "warn" | "vio" | "";
  status: string;
  detail: string;
  taps: ("" | "t" | "b" | "c")[];
  foot: string;
  /** RECORDED = the walls recorder's own verdict. DERIVED = graded here. */
  src: "recorded" | "derived";
};

export default function PostMarketTab(p: PostMarketProps) {
  const {
    spot, spxPrevClose, flip, callWall, putWall, totalNetGex, perStrike, chain,
    coreBullseye, maxPain, em, totals, expiry, etDate, etMin, hasData,
    frozenDate,
  } = p;
  const frozen = !!frozenDate;

  // `etDate`, not `frozenDate`: this is the session the tab is DESCRIBING, and
  // it is the right answer on both paths (live it is today, frozen it equals
  // frozenDate). Passing frozenDate left the live path with no date at all, and
  // the hook then fell back to a rolling 480-minute window anchored to the wall
  // clock — so opening the recap at 20:00 silently threw away the morning and
  // the panel blamed the recorder for it.
  const { cols, state: histState } = useIntradayLadder(true, expiry, etDate);
  const { next, state: nextState } = useNextExpiryStructure(!frozen, expiry, spot);
  const { log: wallLog, byLevel: recorded, state: wallState } = useRecordedWalls(etDate, "SPX");

  // ── the day's price path, in SPX ───────────────────────────────────────────
  //
  // ONE SOURCE, AND IT IS SPX. The recorder writes SPX spot per minute, and it
  // is the same series the ladder was captured against.
  //
  // There used to be an ES fallback here — 5-minute ES closes run through the
  // LIVE basis — and `rthHi`/`rthLo` took the max/min ACROSS both sources. That
  // is how a "BROKE THE PUT WALL" card printed a low of 7,624 on a day SPX
  // never traded below ~7,650: ES basis moves through the session and steps on
  // a contract roll, so converting a 10:15 ES print with the 16:30 basis
  // produced a price that never existed, and `Math.min` locked it in where the
  // correct recorder value could never override it. The header badge still said
  // "per-minute recorder", because that badge only ever described the path
  // series, not the number.
  //
  // A converted futures price is not an SPX price. Nothing on this page derives
  // an SPX number from ES any more: if the recorder has no coverage, the row
  // renders "—" like every other underivable number here.
  const path = useMemo<{ pts: { ts: number; px: number }[] }>(() => ({
    pts: cols.filter((c) => c.spot > 0).map((c) => ({ ts: c.ts, px: c.spot })),
  }), [cols]);

  const closePx = spot > 0 ? spot : (path.pts.length ? path.pts[path.pts.length - 1].px : 0);
  const rthHi = useMemo(
    () => (path.pts.length ? Math.max(...path.pts.map((q) => q.px)) : null),
    [path],
  );
  const rthLo = useMemo(
    () => (path.pts.length ? Math.min(...path.pts.map((q) => q.px)) : null),
    [path],
  );
  // Prior close is a real SPX quote (Yahoo ^GSPC via /api/quotes-batch), not
  // the ES prior close shifted by a basis.
  const pdcSpx = spxPrevClose ?? null;
  const dayChg = pdcSpx != null && closePx > 0 ? closePx - pdcSpx : null;

  // ── open vs now, off the recorded ladder ───────────────────────────────────
  const openCol = cols.length ? cols[0] : null;
  const sumNet = (c: Col | null) => (c ? c.cells.reduce((s, x) => s + x.net, 0) : null);
  const openNetGex = sumNet(openCol);
  const netGexChg = openNetGex != null && totalNetGex != null ? totalNetGex - openNetGex : null;
  const openFlip = useMemo(() => {
    if (!openCol) return null;
    return findGEXFlip(openCol.cells.map((c) => ({ strike: c.strike, netGEX: c.net } as ChainRow)), openCol.spot || spot);
  }, [openCol, spot]);

  /**
   * PER-STRIKE INTRADAY SERIES — the spine of section 3.
   *
   * The panel used to draw "09:30 vs now". On 0DTE that is a dead question: the
   * open book is ~2% of the close, so every strike reads "+100% added" and the
   * delta chart is a copy of the profile. What has signal per strike is WHEN the
   * gamma arrived and WHETHER IT IS STILL THERE — so each strike is reduced to
   * three build buckets and a high-water mark instead.
   */
  const series = useMemo(() => {
    const m = new Map<number, { vals: number[]; ts: number[] }>();
    if (!cols.length) return m;
    cols.forEach((c, i) => {
      for (const cell of c.cells) {
        let e = m.get(cell.strike);
        if (!e) { e = { vals: new Array(cols.length).fill(0), ts: [] }; m.set(cell.strike, e); }
        e.vals[i] = cell.net;
      }
    });
    for (const e of m.values()) e.ts = cols.map((c) => c.ts);
    return m;
  }, [cols]);

  /** Column index nearest a given ET minute-of-day, for the bucket boundaries. */
  const idxAtMin = useCallback((mins: number) => {
    if (!cols.length) return -1;
    let best = -1, bestD = Infinity;
    cols.forEach((c, i) => {
      const d = Math.abs(etMinutes(c.ts) - mins);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }, [cols]);

  /**
   * Same two-window rule as the premarket profile: ±12 sets the bar SCALE (so a
   * monster strike far from the money cannot flatten everything near it), ±60
   * renders and the panel scrolls.
   */
  const evWindow = useCallback((half: number) => {
    if (!perStrike.length || !(spot > 0)) return [];
    const idx = perStrike.reduce(
      (b, r, i) => (Math.abs(r.strike - spot) < Math.abs(perStrike[b].strike - spot) ? i : b), 0);
    return perStrike.slice(Math.max(0, idx - half), Math.min(perStrike.length, idx + half + 1)).slice().reverse();
  }, [perStrike, spot]);
  const evNear = useMemo(() => evWindow(12), [evWindow]);
  const evBars = useMemo(() => evWindow(60), [evWindow]);

  /**
   * One row of the evolution profile: where the strike ended, and how it got
   * there — measured in SHARE OF THE BOARD, not in dollars.
   *
   * ── WHY SHARE, AND WHY THE HIGH-WATER MARK IS GONE ──────────────────────────
   * The bar used to carry a peak tick and a "given back" hatch. On an expiring
   * book they are a constant, not a measurement: per-strike GEX is
   * γ × (OI+Vol) × S² with γ ∝ 1/√T, so as the bell approaches gamma piles onto
   * whatever is ATM and drains from everything else, and by the last recorded
   * column all but a handful of strikes are near zero. Every row therefore drew
   * a full-width hatch and read "−100%", which is a fact about expiry that is
   * equally true of every strike on every 0DTE session. It cannot distinguish a
   * level that was abandoned from one that simply expired, so it is not shown.
   *
   * What DOES survive the decay is each strike's share of the board:
   *
   *     share_k(t) = |net_k(t)| / Σ_j |net_j(t)|
   *
   * The 1/√T term is in every strike's numerator and in the denominator, so it
   * divides straight out. A strike holding 12% of the board's gamma at noon and
   * 3% at the close genuinely lost the board — that is positioning, not the
   * clock. Both the build buckets and the 15:00→close column are now measured
   * this way, in PERCENTAGE POINTS of the board.
   *
   * Bucket shares are normalised over the ABSOLUTE share moves, not the signed
   * ones — a strike that took +4pp in the morning and gave 1pp back at lunch
   * should read as two thirds morning, not as 133%. The segments therefore
   * always fill the bar exactly.
   */
  type EvRow = {
    strike: number;
    net: number;
    segs: { share: number; color: string; label: string }[];
    dominant: { share: number; color: string; label: string } | null;
    /**
     * POWER HOUR — 15:00→close change in the strike's share of the board, in
     * percentage points. Positive = it took board share into the bell, negative
     * = it lost it. Null when the recording does not actually reach 15:00.
     */
    pmShare: number | null;
    /** The strike's board share at 15:00, in points — the base pmShare moved from. */
    pmBase: number | null;
    /** …and at the last recorded column. */
    closeShare: number | null;
  };

  const BUCKET_DEFS = useMemo(() => [
    { from: RTH_OPEN_MIN, until: 12 * 60, color: "var(--blue)", label: "AM" },
    { from: 12 * 60, until: PM_FROM_MIN, color: "var(--violet)", label: "MID" },
    { from: PM_FROM_MIN, until: RTH_CLOSE_MIN, color: "var(--amber)", label: "PM" },
  ], []);

  /**
   * WHICH BUCKETS THE RECORDING CAN ACTUALLY SUPPORT.
   *
   * This was a real bug, not a cosmetic one: the buckets used to be hard-wired
   * to [0, noon, 15:00, end] with `idxAtMin` snapping to the NEAREST column. On
   * a day the recorder started after noon — which happens whenever the ladder
   * job restarts intraday — `idxAtMin(12:00)` returned index 0, so the AM move
   * was |vals[0] − vals[0]| = 0 for EVERY strike and the blue segment silently
   * did not exist. "I don't see any blue" was the chart being honest about a
   * gap while looking like a chart with no morning activity.
   *
   * Now the bucket list is derived from the recording's real coverage, and a
   * bucket that was never recorded is dropped AND named in the legend.
   */
  const evCover = useMemo(() => {
    if (!cols.length) return null;
    return { from: etMinutes(cols[0].ts), to: etMinutes(cols[cols.length - 1].ts) };
  }, [cols]);

  const activeBuckets = useMemo(() => {
    if (!evCover) return [];
    // A bucket survives only if the recording covers a real slice of it — 5+
    // minutes, so a ladder that starts at 11:58 does not claim a morning.
    return BUCKET_DEFS.filter((b) => Math.min(b.until, evCover.to) - Math.max(b.from, evCover.from) >= 5);
  }, [BUCKET_DEFS, evCover]);

  const missingBuckets = useMemo(
    () => BUCKET_DEFS.filter((b) => !activeBuckets.includes(b)),
    [BUCKET_DEFS, activeBuckets],
  );

  /**
   * THE POWER-HOUR ANCHOR — the column at 15:00, or null.
   *
   * `idxAtMin` snaps to the NEAREST column, so on a recording that only starts
   * at 15:40 it would hand back 15:40 and every "15:00→close" number below
   * would silently be a 20-minute number wearing an hour's label. The ±10min
   * guard is what makes the anchor mean what it says; without it the column is
   * dropped rather than fudged.
   */
  const pmAnchor = useMemo(() => {
    if (!cols.length) return null;
    if (!activeBuckets.some((b) => b.from === PM_FROM_MIN)) return null;
    const i = idxAtMin(PM_FROM_MIN);
    if (i < 0 || !cols[i]) return null;
    return Math.abs(etMinutes(cols[i].ts) - PM_FROM_MIN) <= 10 ? i : null;
  }, [cols, activeBuckets, idxAtMin]);

  /**
   * BOARD TOTAL per column — Σ|net| over the WHOLE ladder, not the ±60 window.
   *
   * This is the denominator that divides the 1/√T decay out (see the EvRow
   * header). It has to be the whole board: normalising over the rendered window
   * would make every strike's share jump around as the window slid with spot,
   * and the shares would no longer be comparable between rows.
   */
  const colAbsTotal = useMemo(
    () => cols.map((c) => c.cells.reduce((s, x) => s + Math.abs(x.net), 0)),
    [cols],
  );

  const evRows = useMemo<EvRow[]>(() => {
    // Boundary column for each active bucket's END, clamped into range. Built
    // from the ACTIVE list, so the segments always describe recorded time.
    const bounds = activeBuckets.map((b) => idxAtMin(Math.min(b.until, evCover?.to ?? b.until)));
    return evBars.map((b) => {
      const e = series.get(b.strike);
      const base: EvRow = {
        strike: b.strike, net: b.net,
        segs: [], dominant: null, pmShare: null, pmBase: null, closeShare: null,
      };
      if (!e || e.vals.length < 3 || !activeBuckets.length || bounds.some((i) => i < 0)) return base;

      const last = e.vals.length - 1;
      /**
       * This strike's share of the board at column `i`, in PERCENTAGE POINTS.
       * Every quantity below is built from this and nothing else, so the whole
       * row is decay-free — see the EvRow header for the algebra.
       */
      const shareAt = (i: number) => {
        const tot = colAbsTotal[i] ?? 0;
        return tot > 0 ? (Math.abs(e.vals[i]) / tot) * 100 : 0;
      };

      const cuts = [0, ...bounds.map((i) => Math.min(i, last))];
      cuts[cuts.length - 1] = last;                       // the final bucket always ends at the close
      const moves = activeBuckets.map((_, i) => Math.abs(shareAt(cuts[i + 1]) - shareAt(cuts[i])));
      const total = moves.reduce((a, c) => a + c, 0);
      const segs = total > 0
        ? moves.map((mv, i) => ({ share: mv / total, color: activeBuckets[i].color, label: activeBuckets[i].label }))
        : [];
      const dominant = segs.length ? segs.reduce((bb, x) => (x.share > bb.share ? x : bb), segs[0]) : null;

      const closeShare = shareAt(last);
      const pmBase = pmAnchor != null ? shareAt(pmAnchor) : null;
      const pmShare = pmBase != null ? closeShare - pmBase : null;

      return { ...base, segs, dominant, pmShare, pmBase, closeShare };
    });
  }, [evBars, series, idxAtMin, activeBuckets, evCover, pmAnchor, colAbsTotal]);

  /**
   * WALL MIGRATION — where the levels sat, minute by minute, against spot.
   *
   * The recorder stores NET per strike only, so these are net-basis proxies: the
   * most positive strike is the call wall, the most negative the put wall, the
   * largest magnitude CORE. That is the same definition the live board uses for
   * CORE and a close stand-in for the two walls (which are per-side live). It is
   * labelled as a proxy on the panel rather than passed off as the wall log's
   * own numbers — /proxy/walls is the 15-minute classified truth and it is right
   * above this in section 2.
   */
  const wallPath = useMemo(() => {
    if (cols.length < 3) return null;
    const raw = cols.map((c) => {
      // The two walls, net-basis: the most positive strike and the most
      // negative one. CORE is not looked for separately — it IS whichever of
      // those two is carrying more gamma at that minute (see below).
      let cw = c.cells[0], pw = c.cells[0];
      for (const x of c.cells) {
        if (x.net > cw.net) cw = x;
        if (x.net < pw.net) pw = x;
      }
      return {
        ts: c.ts, spot: c.spot,
        cw: cw?.strike ?? null, cwNet: cw?.net ?? 0,
        pw: pw?.strike ?? null, pwNet: pw?.net ?? 0,
      };
    }).filter((p) => p.cw != null && p.pw != null);
    if (raw.length < 3) return null;

    /**
     * ROLLING MODE, not the raw pick.
     *
     * A wall is the extreme strike of the column, so on a minute where two
     * strikes are within a few percent of each other the pick alternates
     * between them — two strikes sixty points apart, flipping every sample.
     * Drawn as a line that is a picket fence of vertical jumps.
     *
     * A level is a discrete strike, so the honest smoother is the MOST COMMON
     * value in a short window, never an average — averaging would invent
     * strikes that were never the wall. Five samples kills the alternation and
     * still turns a genuine roll within one window.
     */
    const mode = (vals: (number | null)[], i: number, half = 2): number | null => {
      const counts = new Map<number, number>();
      for (let j = Math.max(0, i - half); j <= Math.min(vals.length - 1, i + half); j++) {
        const v = vals[j];
        if (v == null) continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      let best: number | null = null, bestN = 0;
      for (const [v, n] of counts) {
        // Ties break toward the value closest to the raw pick at i, so a real
        // roll is not held back a sample longer than it has to be.
        if (n > bestN || (n === bestN && best != null && vals[i] != null &&
            Math.abs(v - (vals[i] as number)) < Math.abs(best - (vals[i] as number)))) {
          best = v; bestN = n;
        }
      }
      return best;
    };

    /**
     * TWO ROLES, NOT THREE LEVELS.
     *
     * Three lines (call wall, put wall, CORE) always drew CORE on top of one of
     * the other two, because CORE IS one of them — whichever is carrying more
     * gamma. The chart spent a colour and a legend entry saying the same thing
     * twice, and the reader had to work out which wall was hiding underneath.
     *
     * So the two series are ROLES: CORE is the heavier wall at that minute, and
     * OTHER is the lighter one. When they swap, the lines swap — which is the
     * event worth seeing (the day's dominant level changing sides), and it is
     * legible precisely because there are only two lines.
     *
     * The roles are what get smoothed, not the walls: mode-filtering call and
     * put separately and THEN comparing would let a smoothed value fight an
     * unsmoothed magnitude and flicker the roles back.
     */
    const coreRaw = raw.map((p) => (Math.abs(p.cwNet) >= Math.abs(p.pwNet) ? p.cw : p.pw));
    const otherRaw = raw.map((p) => (Math.abs(p.cwNet) >= Math.abs(p.pwNet) ? p.pw : p.cw));
    const sideRaw = raw.map((p) => (Math.abs(p.cwNet) >= Math.abs(p.pwNet) ? "call" : "put") as "call" | "put");

    const pts = raw.map((p, i) => ({
      ts: p.ts,
      spot: p.spot,
      core: mode(coreRaw, i),
      other: mode(otherRaw, i),
      coreSide: sideRaw[i],
    }));

    const vals: number[] = [];
    for (const p of pts) {
      if (p.spot > 0) vals.push(p.spot);
      if (p.core != null) vals.push(p.core);
      if (p.other != null) vals.push(p.other);
    }
    const lo = Math.min(...vals), hi = Math.max(...vals);
    if (!(hi > lo)) return null;

    // How much of the session each side spent as CORE — the one-line read under
    // the chart, and the reason the swap is worth drawing at all.
    const callMin = pts.filter((p) => p.coreSide === "call").length;
    return { pts, lo, hi, callCoreShare: callMin / pts.length };
  }, [cols]);

  /**
   * WRITTEN vs TRADED — did the book form around price, or ahead of it?
   *
   * Left: how much gamma each strike gained across the session. Right: how many
   * recorded minutes spot spent at that strike. Peaks that line up are a pin;
   * peaks that separate mean the level was pulling price toward it.
   */
  const writtenVsTraded = useMemo(() => {
    if (!cols.length || !evNear.length) return [];
    const strikes = evNear.map((b) => b.strike);
    const step = strikes.length > 1 ? Math.abs(strikes[0] - strikes[1]) : 5;
    const minutesAt = new Map<number, number>();
    for (const c of cols) {
      if (!(c.spot > 0)) continue;
      const near = strikes.reduce((b, k) => (Math.abs(k - c.spot) < Math.abs(b - c.spot) ? k : b), strikes[0]);
      if (Math.abs(near - c.spot) <= step) minutesAt.set(near, (minutesAt.get(near) ?? 0) + 1);
    }
    return strikes.map((k) => {
      const e = series.get(k);
      const added = e ? Math.abs(e.vals[e.vals.length - 1] - e.vals[0]) : 0;
      return { strike: k, added, minutes: minutesAt.get(k) ?? 0 };
    });
  }, [cols, evNear, series]);

  /**
   * POSITIONED vs WRITTEN — the share of a strike's gamma that came from settled
   * OI rather than today's volume.
   *
   * The only panel here that needs no history at all: it reads the live chain's
   * per-side OI and volume. On 0DTE the aggregate answer is always "mostly
   * volume" and is useless; per strike it separates levels that were set up
   * before the bell (and behaved like real levels all day) from ones written
   * from nothing after lunch.
   */
  const oiSplit = useMemo(() => {
    if (!chain.length || !(spot > 0)) return [];
    return chain
      .map((r) => {
        const cg = Math.abs(r.callGamma ?? 0), pg = Math.abs(r.putGamma ?? 0);
        const oiPart = cg * (r.callOI ?? 0) + pg * (r.putOI ?? 0);
        const volPart = cg * (r.callVolume ?? 0) + pg * (r.putVolume ?? 0);
        const tot = oiPart + volPart;
        return {
          strike: r.strike,
          net: netGEXOf(r, "net", spot),
          oiShare: tot > 0 ? oiPart / tot : null,
        };
      })
      .filter((r) => r.oiShare != null && Number.isFinite(r.net) && r.net !== 0)
      .sort((a, z) => Math.abs(z.net) - Math.abs(a.net))
      .slice(0, 9)
      .sort((a, z) => z.strike - a.strike);
  }, [chain, spot]);


  // ── level scorecard ────────────────────────────────────────────────────────
  const grades = useMemo<Grade[]>(() => {
    const tol = Math.max(3, spot * 0.0005);          // ~4 pts on SPX
    const pts = path.pts;
    const BUCKETS = 12;

    const build = (
      key: LevelKey, name: string, hint: string, px: number | null, color: string,
      mode: "above" | "below" | "cross" | "near",
    ): Grade => {
      const base: Grade = {
        key, name, hint, px, color, tone: "", status: "—", detail: "no level",
        taps: Array(BUCKETS).fill(""), foot: "", src: "derived",
      };
      if (px == null || !(px > 0)) return base;
      if (!pts.length) return { ...base, status: "NO PATH", detail: "no intraday prices recorded", foot: "" };

      const taps: ("" | "t" | "b" | "c")[] = Array(BUCKETS).fill("");
      let touches = 0, beyond = 0, crosses = 0, firstTs = 0, lastTs = 0;
      let prevSide = 0;

      pts.forEach((q, i) => {
        const b = Math.min(BUCKETS - 1, Math.floor((i / pts.length) * BUCKETS));
        const d = q.px - px;
        const side = d >= 0 ? 1 : -1;
        const touched = Math.abs(d) <= tol;
        const isBeyond = mode === "above" ? d > tol : mode === "below" ? d < -tol : false;

        if (touched) {
          touches++;
          if (!firstTs) firstTs = q.ts;
          lastTs = q.ts;
          if (taps[b] !== "b") taps[b] = "t";
        }
        if (isBeyond) { beyond++; taps[b] = "b"; }
        if (mode === "cross" && prevSide !== 0 && side !== prevSide) {
          crosses++;
          taps[b] = taps[b] === "b" ? "b" : "c";
        }
        prevSide = side;
      });

      // One sample = one minute. The 5-minute case existed only for the ES-bar
      // path, and that path is gone — the recorder is the only source now.
      const perPt = 1;
      const mins = (n: number) => `${n * perPt} min`;
      const stamp = (ts: number) => (ts ? etHm(ts) : "—");

      if (mode === "cross") {
        return {
          ...base,
          tone: crosses ? "warn" : "ok",
          status: crosses ? `CROSSED ${crosses}×` : "NEVER CROSSED",
          detail: crosses
            ? `${mins(beyond)} on the far side · first ${stamp(firstTs)}`
            : `held one side of the flip all session`,
          taps,
          foot: crosses ? "regime changed hands intraday" : "one regime, all day",
        };
      }
      if (mode === "near") {
        const dist = closePx > 0 ? closePx - px : null;
        const pinned = dist != null && Math.abs(dist) <= Math.max(5, spot * 0.0008);
        return {
          ...base,
          tone: pinned ? "vio" : "",
          status: pinned ? "PINNED" : dist == null ? "—" : `${Math.abs(dist) < 25 ? "NEAR" : "MISSED"}`,
          detail: `${touches ? `${mins(touches)} within ${nf(tol, 0)} pts` : "never reached"} · close ${fmtPts(dist)}`,
          taps,
          foot: pinned ? "price closed on it" : "gravity did not win",
        };
      }
      const broke = beyond > 0;
      return {
        ...base,
        tone: broke ? "bad" : touches ? "ok" : "",
        status: broke ? "BROKEN" : touches ? "HELD" : "UNTESTED",
        detail: broke
          ? `${mins(beyond)} beyond · first break ${stamp(firstTs)}`
          : touches
            ? `tagged ${touches}× · first ${stamp(firstTs)} · last ${stamp(lastTs)}`
            : `never within ${nf(tol, 0)} pts`,
        taps,
        foot: broke
          ? (mode === "above" ? "resistance failed" : "support failed")
          : touches ? "defended" : (mode === "above" ? "never reached" : "never needed"),
      };
    };

    /**
     * The recorder's verdict WINS for the three levels it tracks. It watched the
     * level all day at 15-minute resolution and classified the touch four slots
     * later; this file only ever sees the last frame plus whatever price path it
     * could reconstruct. Where a recorded grade exists the derived one is kept
     * underneath as the sparkline and the "also" line, so nothing is lost.
     */
    const withRecorded = (g: Grade, lvl: WallLevel): Grade => {
      const rec = recorded.get(lvl);
      if (!rec) return g;
      const last = rec.events.length ? rec.events[rec.events.length - 1] : null;
      const rx = last?.reaction ?? null;
      const moved = rec.open != null && rec.last != null && rec.open !== rec.last;
      const hits = rec.events.filter((e) => e.kind === "touch").length;

      const detail = [
        moved ? `${nf(rec.open as number, 0)} → ${nf(rec.last as number, 0)}` : `held ${fmtPx(rec.last ?? g.px)} all day`,
        rec.moves ? `moved ${rec.moves}×` : "never moved",
        hits ? `${hits} tag${hits > 1 ? "s" : ""}` : "no tags",
      ].join(" · ");

      const foot = last
        ? [
            last.excursion_pts != null ? `${fmtPts(last.excursion_pts)} through` : null,
            last.reclaim_min != null ? `reclaimed in ${last.reclaim_min} min` : null,
            last.attempts > 1 ? `${last.attempts} attempts` : null,
          ].filter(Boolean).join(" · ") || "recorded by the wall log"
        : "watched all day, never traded into";

      return {
        ...g,
        px: rec.last ?? g.px,
        src: "recorded",
        tone: rx ? REACTION_TONE[rx] : (hits ? "warn" : "ok"),
        status: rx ? REACTION_LABEL[rx] : (hits ? "TAGGED" : "UNTESTED"),
        detail,
        foot,
      };
    };

    return [
      withRecorded(build("CW", "Call Wall", "resistance", callWall, "var(--cw)", "above"), "call_wall"),
      withRecorded(build("PW", "Put Wall", "support", putWall, "var(--pw)", "below"), "put_wall"),
      build("FLIP", "Gamma Flip", "regime", flip, "var(--amber)", "cross"),
      withRecorded(build("CORE", "CORE", "max γ", coreBullseye?.strike ?? null, "var(--violet)", "near"), "cb"),
      build("MP", "Max Pain", "OI", maxPain, "var(--blue)", "near"),
    ];
  }, [callWall, putWall, flip, coreBullseye, maxPain, path, spot, closePx, recorded]);

  const gradeOf = (k: LevelKey) => grades.find((g) => g.key === k) ?? null;

  // ── verdict ────────────────────────────────────────────────────────────────
  const verdict = useMemo(() => {
    if (!hasData || !(closePx > 0) || rthHi == null || rthLo == null) {
      return { t: "WAITING FOR DATA", d: "no chain or no session bars yet.", neg: false };
    }
    const brokeCall = callWall != null && rthHi > callWall;
    const brokePut = putWall != null && rthLo < putWall;
    const cb = coreBullseye?.strike ?? null;
    const pinned = cb != null && Math.abs(closePx - cb) <= Math.max(5, spot * 0.0008);
    const inside = !brokeCall && !brokePut && callWall != null && putWall != null;

    if (brokeCall && brokePut) {
      return { t: "BOTH WALLS GAVE", d: `Range ${fmtPx(rthLo)}–${fmtPx(rthHi)} ran through both sides. The map was too narrow for the tape.`, neg: true };
    }
    if (brokeCall) {
      return { t: "BROKE THE CALL WALL", d: `High ${fmtPx(rthHi)} cleared ${fmtPx(callWall)}. Fading resistance was the wrong trade.`, neg: true };
    }
    if (brokePut) {
      return { t: "BROKE THE PUT WALL", d: `Low ${fmtPx(rthLo)} lost ${fmtPx(putWall)}. Support was not support.`, neg: true };
    }
    if (pinned) {
      return { t: "PINNED", d: `Closed ${fmtPts(cb != null ? closePx - cb : null)} from CORE at ${fmtPx(cb)}, inside the wall band all day.`, neg: false };
    }
    if (inside) {
      return { t: "HELD THE RANGE", d: `Whole session between ${fmtPx(putWall)} and ${fmtPx(callWall)}. The morning map was the day.`, neg: false };
    }
    return { t: "NO WALLS TO GRADE", d: "The chain never produced both walls today.", neg: false };
  }, [hasData, closePx, rthHi, rthLo, callWall, putWall, coreBullseye, spot]);

  // ── range bar geometry ─────────────────────────────────────────────────────
  const rangeDomain = useMemo(() => {
    const vals = [callWall, putWall, rthHi, rthLo, closePx].filter((v): v is number => v != null && v > 0);
    if (vals.length < 2) return null;
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = hi - lo;
    if (!(span > 0)) return null;
    const pad = span * 0.1;
    return { lo: lo - pad, hi: hi + pad };
  }, [callWall, putWall, rthHi, rthLo, closePx]);
  const rPos = (px: number | null | undefined) =>
    px == null || rangeDomain == null ? null
      : Math.max(0, Math.min(100, ((px - rangeDomain.lo) / (rangeDomain.hi - rangeDomain.lo)) * 100));

  // ── tomorrow's rail ────────────────────────────────────────────────────────
  const railMarks = useMemo(() => {
    if (!next) return null;
    const marks: { code: string; name: string; px: number; color: string }[] = [];
    const add = (code: string, name: string, px: number | null | undefined, color: string) => {
      if (px != null && Number.isFinite(px) && px > 0) marks.push({ code, name, px, color });
    };
    add("PW", "Put Wall", next.putWall, "var(--pw)");
    add("FLIP", "Gamma Flip", next.flip, "var(--amber)");
    add("CORE", "max γ strike", next.cb, "var(--violet)");
    add("CLOSE", "SPX Close", closePx > 0 ? closePx : null, "#ffffff");
    add("CW", "Call Wall", next.callWall, "var(--cw)");
    if (marks.length < 2) return null;
    const lo = Math.min(...marks.map((m) => m.px)), hi = Math.max(...marks.map((m) => m.px));
    const span = hi - lo;
    if (!(span > 0)) return null;
    const pad = span * 0.14;
    const pos = (px: number) => ((px - (lo - pad)) / ((hi + pad) - (lo - pad))) * 100;
    const placed = marks.slice().sort((a, b) => a.px - b.px).map((m, i) => ({
      ...m, pos: pos(m.px), side: i % 2 === 0 ? "dn" : "up",
      dist: closePx > 0 && m.code !== "CLOSE" ? m.px - closePx : null,
    }));
    const band = next.putWall != null && next.callWall != null
      ? { left: Math.min(pos(next.putWall), pos(next.callWall)), width: Math.abs(pos(next.callWall) - pos(next.putWall)) }
      : null;
    return { placed, band };
  }, [next, closePx]);

  const todayWidth = callWall != null && putWall != null ? Math.abs(callWall - putWall) : null;
  const nextWidth = next?.callWall != null && next?.putWall != null ? Math.abs(next.callWall - next.putWall) : null;

  /**
   * WHERE PREMIUM ACTUALLY WENT — the five contracts that took the most DOLLARS
   * today, per side, not per strike.
   *
   * Everything else on this page is gamma: a number that says how big the
   * dealer's hedge is, not how much money changed hands. This is the money.
   * premium = today's volume × the contract's mark × 100. Volume, not OI, on
   * purpose — OI is yesterday's positioning; the question here is what got
   * PAID for today.
   *
   * Calls and puts are ranked separately and against each other, so a strike
   * can appear twice (7,700C and 7,700P are two different trades). Needs marks:
   * on a frame without contract prices the panel says so rather than printing a
   * confident zero.
   */
  const premiumRows = useMemo(() => {
    if (!chain.length) return [];
    const legs: { key: string; strike: number; side: "C" | "P"; usd: number }[] = [];
    for (const r of chain) {
      const cm = r.callMark ?? 0;
      const pm = r.putMark ?? 0;
      const cv = r.callVolume ?? 0;
      const pv = r.putVolume ?? 0;
      if (cm > 0 && cv > 0) legs.push({ key: `${r.strike}C`, strike: r.strike, side: "C", usd: cm * cv * 100 });
      if (pm > 0 && pv > 0) legs.push({ key: `${r.strike}P`, strike: r.strike, side: "P", usd: pm * pv * 100 });
    }
    return legs.sort((a, b) => b.usd - a.usd).slice(0, 5);
  }, [chain]);

  const premiumTotal = useMemo(() => {
    if (!chain.length) return 0;
    return chain.reduce((s, r) =>
      s + (r.callMark ?? 0) * (r.callVolume ?? 0) * 100 + (r.putMark ?? 0) * (r.putVolume ?? 0) * 100, 0);
  }, [chain]);

  // ── session journal (per date, local) ──────────────────────────────────────
  const [note, setNote] = useState("");
  const noteLoaded = useRef(false);
  useEffect(() => {
    try {
      const all = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}") as Record<string, string>;
      setNote(all[etDate] ?? "");
    } catch { /* first run */ }
    noteLoaded.current = true;
  }, [etDate]);
  const saveNote = useCallback((v: string) => {
    setNote(v);
    if (!noteLoaded.current) return;
    try {
      const all = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}") as Record<string, string>;
      all[etDate] = v;
      localStorage.setItem(NOTES_KEY, JSON.stringify(all));
    } catch { /* quota — the textarea still holds it for this session */ }
  }, [etDate]);

  // ── rolling accuracy log — written once per session, after the close ───────
  type LogRow = { date: string; cw: boolean; pw: boolean; inside: boolean; pinned: boolean };
  const [log, setLog] = useState<LogRow[]>([]);
  useEffect(() => {
    try { setLog(JSON.parse(localStorage.getItem(LOG_KEY) || "[]") as LogRow[]); } catch { /* none yet */ }
  }, []);
  const wroteLogRef = useRef(false);
  useEffect(() => {
    if (wroteLogRef.current) return;
    if (frozen) return;                                  // never back-date the log
    if (etMin < RTH_CLOSE_MIN + 5) return;               // only after the settle
    if (!hasData || rthHi == null || rthLo == null || callWall == null || putWall == null) return;
    let rows: LogRow[] = [];
    try { rows = JSON.parse(localStorage.getItem(LOG_KEY) || "[]") as LogRow[]; } catch { /* none */ }
    if (rows.some((r) => r.date === etDate)) { wroteLogRef.current = true; return; }
    const cb = coreBullseye?.strike ?? null;
    const row: LogRow = {
      date: etDate,
      cw: rthHi <= callWall,
      pw: rthLo >= putWall,
      inside: rthHi <= callWall && rthLo >= putWall,
      pinned: cb != null && Math.abs(closePx - cb) <= Math.max(5, spot * 0.0008),
    };
    const nextRows = [...rows, row].slice(-20);
    try { localStorage.setItem(LOG_KEY, JSON.stringify(nextRows)); } catch { /* quota */ }
    setLog(nextRows);
    wroteLogRef.current = true;
  }, [frozen, etMin, etDate, hasData, rthHi, rthLo, callWall, putWall, coreBullseye, closePx, spot]);

  const accRows = log.slice(-10);
  const hitRate = (pick: (r: LogRow) => boolean) =>
    accRows.length ? `${accRows.filter(pick).length} / ${accRows.length}` : "—";

  // ── render helpers ─────────────────────────────────────────────────────────
  /**
   * BAR SCALE for section 3 — over every RENDERED row, not the ±12 near window,
   * and over each row's CLOSE only, not its peak.
   *
   * FIRST FIX (kept). The scale used to be `max |net|` across evNear (±12
   * strikes) while the panel renders evBars (±60). Every strike outside the near
   * window whose gamma beat the near-window max drew past 100% of the track, and
   * its peak ghost was explicitly `Math.min(46, …)` — so the hatch clamped to
   * exactly the same length on every one of them. That is the "all the bars are
   * maxed out, they can't all have peaked at the same number" artefact: they had
   * not, the chart was clipping them to a common ceiling and saying nothing.
   *
   * SECOND FIX (2026-08-24): the peak is gone entirely, and with it the "given
   * back" hatch it anchored.
   *
   * Folding `|peak|` into the scale was right when the peak was a comparable
   * number. It is not on an expiring book: γ ∝ 1/√T puts every strike's raw
   * high-water mark in the final minutes at 50-150× its own settle, so ONE ATM
   * strike's terminal mark set the scale for all 121 rows. Every real bar — the
   * call wall included — rendered as a 2px sliver with its AM/MID/PM colours
   * invisible. "Where is the 15:00-close data?" was the panel drawing it two
   * pixels wide.
   *
   * Narrowing the peak window to 15:00 was not enough either, because the mark
   * itself carries no information on 0DTE: by the last recorded column all but
   * a handful of ATM strikes have decayed to ~zero, so EVERY row is ~100% off
   * its own high. That is true of every strike on every expiry session, which
   * makes it a constant rather than a reading — so the hatch, the tick and the
   * overflow chevron are all removed. What replaced them is share-of-board,
   * which divides the decay out; the EvRow header has the algebra.
   *
   * Cost, unchanged from the first fix: a little resolution near the money when
   * one far strike is enormous. Buys the thing a bar chart is for — two bars of
   * the same length mean the same number.
   */
  const maxAbsBar = Math.max(1, ...evRows.map((r) => Math.abs(r.net)));

  /**
   * The power hour's OWN scale, in percentage points of the board. Normalised
   * over the 15:00→close share moves only, so the column is legible on its own
   * terms and cannot be flattened by — or flatten — the main bar.
   */
  const maxPmAbs = Math.max(0.05, ...evRows.map((r) => Math.abs(r.pmShare ?? 0)));
  const hasPm = evRows.some((r) => r.pmShare != null);
  const openTag = (strike: number): { text: string; color: string } | null => {
    if (callWall != null && strike === callWall) return { text: "CALL WALL", color: "var(--cw)" };
    if (putWall != null && strike === putWall) return { text: "PUT WALL", color: "var(--pw)" };
    if (coreBullseye && strike === coreBullseye.strike) return { text: "CORE", color: "var(--violet)" };
    if (maxPain != null && strike === maxPain) return { text: "MAX PAIN", color: "var(--blue)" };
    return null;
  };

  /**
   * The ladder renders ±60 strikes, so without this it opens at 7,955 — sixty
   * strikes above the money, where every bar is a sliver. It centres on the spot
   * row while pinned and un-pins the moment the reader scrolls, so a far wall
   * stays put once you go looking at it. Our own scrollTop writes are flagged so
   * the scroll event they fire is not read as the user's hand.
   */
  const evChartRef = useRef<HTMLDivElement | null>(null);
  const evPinnedRef = useRef(true);
  const evProgRef = useRef(false);
  const [evPinned, setEvPinned] = useState(true);

  const evSpotStrike = useMemo(() => {
    if (!evRows.length || !(spot > 0)) return null;
    return evRows.reduce((b, r) => (Math.abs(r.strike - spot) < Math.abs(b.strike - spot) ? r : b), evRows[0]).strike;
  }, [evRows, spot]);

  const centerEv = useCallback(() => {
    const el = evChartRef.current;
    if (!el || evSpotStrike == null) return;
    const i = evRows.findIndex((r) => r.strike === evSpotStrike);
    if (i < 0) return;
    evProgRef.current = true;
    el.scrollTop = Math.max(0, i * 21 + 10.5 - el.clientHeight / 2);
    requestAnimationFrame(() => { evProgRef.current = false; });
  }, [evRows, evSpotStrike]);

  useEffect(() => { if (evPinnedRef.current) centerEv(); }, [centerEv]);

  const onEvScroll = useCallback(() => {
    if (evProgRef.current) return;
    if (evPinnedRef.current) { evPinnedRef.current = false; setEvPinned(false); }
  }, []);

  const repinEv = useCallback(() => {
    evPinnedRef.current = true;
    setEvPinned(true);
    centerEv();
  }, [centerEv]);

  const histNote =
    histState === "ok" ? null
      : histState === "loading" ? "Loading today's recorded ladder…"
        : histState === "empty" ? "No per-minute ladder recorded for today — the build-time bars, the wall path and the written-vs-traded read all need it. Everything else below is live."
          : "The intraday recorder did not answer, so section 3 and the wall path have nothing to read. Everything above and below them is live.";

  return (
    <section className="prep is-post">

      {/* ── 1. DAY SNAPSHOT ──────────────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">1</span>Day Snapshot</h3>
          <span className="tiny right">
            {path.pts.length ? "per-minute SPX recorder" : "no recorded path"} · {expiry || "—"}
          </span>
        </div>

        <div className="snap">
          <div className="kpi">
            <div className="k">SPX Close</div>
            <div className="v mono">
              {fmtPx(closePx)}{" "}
              <small className={dayChg == null ? undefined : dayChg >= 0 ? "chg-pos" : "chg-neg"}>
                {dayChg == null ? "vs prior close —" : `${fmtPts(dayChg)} / ${fmtPct(pdcSpx ? (dayChg / pdcSpx) * 100 : null)}`}
              </small>
            </div>
            <div className="tiny" style={{ marginTop: 4 }}>
              H {fmtPx(rthHi)} · L {fmtPx(rthLo)} ·{" "}
              {rthHi != null && rthLo != null ? `${nf(rthHi - rthLo, 0)} pt range` : "—"}
            </div>
          </div>

          <div className="vr" />

          <div>
            <div className="tiny">Day range vs the morning wall band</div>
            <div className="rangebar">
              <div className="wallband" />
              {rPos(rthLo) != null && rPos(rthHi) != null && (
                <div className="act" style={{ left: `${rPos(rthLo)}%`, width: `${(rPos(rthHi) as number) - (rPos(rthLo) as number)}%` }} />
              )}
              {rPos(putWall) != null && <div className="mk3" style={{ left: `${rPos(putWall)}%`, background: "var(--pw)" }} />}
              {rPos(callWall) != null && <div className="mk3" style={{ left: `${rPos(callWall)}%`, background: "var(--cw)" }} />}
              {rPos(closePx) != null && <div className="mk3" style={{ left: `${rPos(closePx)}%`, background: "#fff" }} />}
              {rPos(putWall) != null && (
                <div className="cp3" style={{ left: `${Math.max(9, rPos(putWall) as number)}%`, color: "var(--pw)" }}>PW {fmtPx(putWall)}</div>
              )}
              {rPos(closePx) != null && (
                <div className="cp3" style={{ left: `${Math.min(82, Math.max(28, rPos(closePx) as number))}%` }}>close {fmtPx(closePx)}</div>
              )}
              {rPos(callWall) != null && (
                <div className="cp3" style={{ left: `${Math.min(91, rPos(callWall) as number)}%`, color: "var(--cw)" }}>CW {fmtPx(callWall)}</div>
              )}
            </div>
            <div className="rangelabs">
              <span>L {fmtPx(rthLo)}</span>
              <span>{todayWidth != null ? `${nf(todayWidth, 0)} pt wall band` : ""}</span>
              <span>H {fmtPx(rthHi)}</span>
            </div>
          </div>

          <div className="vr" />

          <div className="kpi">
            <div className="k">Net GEX · open → now</div>
            <div className="v mono">
              {openNetGex == null ? fmtUsd(totalNetGex) : <>{fmtUsd(openNetGex)} <small>→</small> {fmtUsd(totalNetGex)}</>}
            </div>
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span className={`pill ${(totalNetGex ?? 0) >= 0 ? "cool" : "hot"}`}>
                {openNetGex == null
                  ? ((totalNetGex ?? 0) >= 0 ? "positive gamma" : "negative gamma")
                  : (openNetGex >= 0) === ((totalNetGex ?? 0) >= 0)
                    ? `regime held ${(totalNetGex ?? 0) >= 0 ? "positive" : "negative"}`
                    : "REGIME FLIPPED"}
              </span>
              <span className="tiny">
                {netGexChg == null ? "no open snapshot" : `${fmtUsd(netGexChg)} on the day`}
                {openFlip != null && flip != null ? ` · flip ${fmtPx(openFlip)} → ${fmtPx(flip)}` : ""}
              </span>
            </div>
          </div>

          <div className="vr" />

          <div className={`bias${verdict.neg ? " neg" : ""}`}>
            <div className="t">{verdict.t}</div>
            <div className="d">{verdict.d}</div>
          </div>
        </div>
      </div>

      {/* ── 2. LEVEL SCORECARD ───────────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">2</span>Level Performance Scorecard</h3>
          <span className="tiny right">
            {wallState === "ok" ? "SPX wall log · 09:29 → 16:00" : wallState === "loading" ? "loading the wall log…" : "wall log unavailable"}
            {path.pts.length ? ` · ${path.pts.length} price samples` : ""}
          </span>
        </div>
        <div className="scorecard">
          {grades.map((g) => (
            <div className="sc" key={g.key}>
              <div className="nm">
                <span style={{ color: g.color }}>{g.name}</span>
                <span className={`pill${g.tone === "ok" ? " cool" : g.tone === "bad" ? " hot" : g.tone === "warn" ? " warn" : ""}`}
                  style={g.tone === "vio" ? { borderColor: "rgba(167,139,250,.45)", color: "var(--violet)", background: "rgba(167,139,250,.09)" } : undefined}>
                  {g.status}
                </span>
              </div>
              <div className="px mono">{fmtPx(g.px)}</div>
              <div className="sub">{g.detail}</div>
              <div className="taps">
                {g.taps.map((t, i) => <i key={i} className={t} />)}
              </div>
              <div className="sub" style={{ marginTop: 5 }}>{g.foot}</div>
              <div className="src">
                {g.src === "recorded" ? "graded by the wall log" : `derived · ${g.hint}`}
              </div>
            </div>
          ))}
        </div>

        {wallState === "ok" && wallLog.some((r) => r.reason === "change") && (() => {
          // EVERY move, in the order they happened, inside a scroller. The old
          // .slice(-8) hid the morning — which is exactly the half that explains
          // where the day's walls came from.
          const moves = wallLog
            .filter((r) => r.reason === "change")
            .sort((a, b) => a.slot - b.slot);
          return (
            <div className="movelog">
              <div className="tiny" style={{ marginBottom: 4 }}>
                Every time a level moved today · {moves.length} {moves.length === 1 ? "move" : "moves"}
              </div>
              <div className="mvscroll">
                {moves.map((r, i) => (
                  <div className="mv" key={`${r.level_type}-${r.slot}-${i}`}>
                    <span className="mono">{String(r.at ?? "").slice(0, 5) || `slot ${r.slot}`}</span>
                    <span style={{ color: r.level_type === "call_wall" ? "var(--cw)" : r.level_type === "put_wall" ? "var(--pw)" : "var(--violet)" }}>
                      {LEVEL_LABEL[r.level_type]}
                    </span>
                    <span className="mono">
                      {r.prev_strike != null ? `${nf(r.prev_strike, 0)} → ` : ""}{nf(r.strike, 0)}
                      {r.delta != null ? <span className={r.delta >= 0 ? "chg-pos" : "chg-neg"}>{"  "}{fmtPts(r.delta)}</span> : null}
                    </span>
                    <span className="tiny">spot {fmtPx(r.spot)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        {wallState === "empty" && (
          <div className="warnbar" style={{ marginTop: 10 }}>
            Nothing recorded in the SPX wall log for {etDate} — the three wall cards above are graded
            from the price path instead of the recorder&apos;s own verdict.
          </div>
        )}
      </div>

      {/* ── 3. HOW THE BOOK WAS BUILT ────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">3</span>How the book was built</h3>
          {/* Only the buckets the recording can actually support are listed. A
              legend entry for a window that was never recorded is a promise the
              bars cannot keep — that is how "there is no blue" reads as a
              missing colour instead of a missing morning. */}
          <div className="evlegend">
            {activeBuckets.map((b) => (
              <span key={b.label}>
                <i style={{ background: b.color }} />
                {`${etMinOfDay(b.from)}–${b.until >= RTH_CLOSE_MIN ? "close" : etMinOfDay(b.until)}`}
              </span>
            ))}
            {hasPm && (
              <span
                style={{ color: "var(--txt)", cursor: "help" }}
                title={[
                  "15:00→close change in the strike's SHARE of the board's total gamma, in percentage points.",
                  "Right/amber = it took share into the bell. Left/red = it lost share.",
                  "",
                  "Share, not dollars: per-strike GEX is γ × (OI+Vol) × S² and γ ∝ 1/√T, so on an expiring",
                  "book every strike's dollar figure collapses into the close no matter what anyone did.",
                  "The 1/√T term is in the numerator and the denominator of a share, so it divides out and",
                  "what is left is positioning. This column is on its own scale — its length is not",
                  "comparable to the bar beside it.",
                ].join("\n")}
              >
                <i style={{ background: "linear-gradient(90deg,var(--neg) 0 50%,var(--amber) 50% 100%)" }} />
                15:00→close · board share · own scale
              </span>
            )}
          </div>
        </div>

        {histNote && <div className="warnbar" style={{ marginBottom: 11 }}>{histNote}</div>}
        {/* This used to say "the ladder recorder only covers HH:MM-HH:MM" on
            sessions the recorder had covered from the bell — the hook was
            fetching a rolling 480-minute window anchored to the wall clock, so
            the gap was the CALLER's and the notice pinned it on the recorder.
            Now that the request is for the named session start to finish, a
            short window is a real gap, and the wording no longer names a
            culprit it cannot actually identify: a late start and a retention
            prune look identical from here. */}
        {!histNote && missingBuckets.length > 0 && evCover && (
          <div className="warnbar" style={{ marginBottom: 11 }}>
            The per-minute ladder for <b>{etDate}</b> only holds{" "}
            <b>{etMinOfDay(evCover.from)}–{etMinOfDay(evCover.to)}</b>, so
            the {missingBuckets.map((b) => b.label).join(" and ")} bucket
            {missingBuckets.length > 1 ? "s are" : " is"} not drawn — those bars would be
            an unrecorded window painted as &quot;no activity&quot;. Everything shown is inside the
            recorded window.
          </div>
        )}

        {/* The 1/√T explanation used to live here as a paragraph. It is on the
            legend chip's tooltip now — a caveat that permanent is furniture, and
            it was taking four lines off the ladder every session. */}

        <div className="body" style={{ gridTemplateColumns: "1.35fr 1fr" }}>
          <div className="col" style={{ position: "relative" }}>
            <div className="chart evchart" ref={evChartRef} onScroll={onEvScroll}>
              {evRows.length === 0 && (
                <div style={{ padding: "30px 0", textAlign: "center", color: "var(--dim)", fontSize: 12 }}>
                  Waiting for the chain…
                </div>
              )}
              {evRows.map((r) => {
                const pos = r.net >= 0;
                const tag = openTag(r.strike);
                // ALL BARS GROW RIGHT from a common left edge. The old layout
                // mirrored negative strikes leftwards, which made LENGTH mean
                // two different things depending on which half of the track you
                // were reading, and made the two halves impossible to compare.
                // Sign is now carried where it belongs: the signed dollar value
                // in its own column, plus the +/− chip and the bar's tint.
                const w = Math.min(100, (Math.abs(r.net) / maxAbsBar) * 100);

                // Segments run left→right in time order, so a bar reads the way
                // the day ran.
                let acc = 0;
                const segs = r.segs.map((sg, i) => {
                  const startPct = acc;
                  acc += sg.share * w;
                  return (
                    <div className="seg" key={i}
                      style={{ left: `${startPct}%`, width: `${sg.share * w}%`, background: sg.color, opacity: pos ? .95 : .82 }} />
                  );
                });

                // A strike carrying under 2% of the window's biggest bar is
                // noise — a composition label on a line that never held anything
                // is false precision, so the row keeps its bar and drops it.
                const meaningful = Math.abs(r.net) >= maxAbsBar * 0.02;

                // POWER HOUR — its own scale, centred, half-track each way.
                // Under a fiftieth of a point the strike did nothing in the last
                // hour, and a 1px stub on a flat row is a mark that reads as a
                // measurement. Those draw the zero line only.
                const pmFlat = r.pmShare != null && Math.abs(r.pmShare) < 0.02;
                const pmW = r.pmShare == null || pmFlat
                  ? null
                  : Math.min(50, (Math.abs(r.pmShare) / maxPmAbs) * 50);
                const pmGrew = (r.pmShare ?? 0) >= 0;
                // Points of board share, printed to one decimal: the moves that
                // matter here are whole points and the ones that do not should
                // read as ~0.0 rather than being rounded away to nothing.
                const pmTxt = r.pmShare == null || !meaningful
                  ? null
                  : pmFlat ? "flat pm"
                    : `${pmGrew ? "+" : "−"}${Math.abs(r.pmShare).toFixed(1)}pp`;
                return (
                  <div
                    className={`evrow${tag ? " key" : ""}`}
                    key={r.strike}
                    title={[
                      `${nf(r.strike, 0)} · ${fmtUsd(r.net, false)} at the close`,
                      r.closeShare != null
                        ? `${r.closeShare.toFixed(1)}% of the board's gamma at the close`
                        : null,
                      r.pmShare != null && r.pmBase != null
                        ? `15:00→close ${pmGrew ? "+" : "−"}${Math.abs(r.pmShare).toFixed(2)} points of board share (${r.pmBase.toFixed(1)}% → ${(r.pmBase + r.pmShare).toFixed(1)}%) — own scale, not comparable to the bar`
                        : "15:00→close not recorded",
                    ].filter(Boolean).join("\n")}
                  >
                    <div className="k mono">{nf(r.strike, 0)}</div>
                    <div className={`sgn ${pos ? "p" : "n"}`}>{pos ? "+" : "−"}</div>
                    <div className="netcol mono" style={{ color: pos ? "var(--pos)" : "var(--neg)" }}>
                      {fmtUsd(r.net, false)}
                    </div>
                    <div className={`track${pos ? "" : " neg"}`}>
                      {segs.length ? segs : <div className={`bar ${pos ? "p" : "n"}`} style={{ width: `${w}%` }} />}
                    </div>
                    {/* 15:00 → close, on its own scale. Unpainted entirely when
                        the recording never reached 15:00 — a MISSING power hour
                        must not look like a flat one, which is why the zero line
                        is drawn only when there is a reading behind it. */}
                    <div className={`pmtrack${r.pmShare == null ? " off" : ""}`}>
                      {r.pmShare != null && <div className="zero" />}
                      {pmW != null && (
                        <i className={pmGrew ? "up" : "dn"} style={{ width: `${Math.max(1, pmW)}%` }} />
                      )}
                    </div>
                    <div className="builtcol mono">
                      {meaningful && r.dominant && (
                        <span style={{ color: r.dominant.color }}>{Math.round(r.dominant.share * 100)}% {r.dominant.label}</span>
                      )}
                      {/* Points of BOARD SHARE, not a percentage of the strike's
                          own 15:00 value. The latter is what produced "+610%"
                          on a strike that went from a rounding error to a small
                          number, and "−100%" on the eighty strikes that simply
                          expired. */}
                      {pmTxt && (
                        <>
                          <span className="sep"> · </span>
                          <span style={{ color: pmFlat ? "var(--dim2)" : pmGrew ? "var(--amber)" : "var(--neg)" }}>{pmTxt}</span>
                        </>
                      )}
                    </div>
                    <div className="tagcol" style={{ color: tag ? tag.color : "transparent" }}>{tag ? tag.text : ""}</div>
                  </div>
                );
              })}
            </div>
            {!evPinned && evRows.length > 0 && (
              <button type="button" className="recenter" onClick={repinEv}>⤒ back to spot</button>
            )}
          </div>

          <div className="col">
            {/* WALL MIGRATION */}
            <div className="colhead">
              <h3>Wall migration</h3>
              <span className="tiny">net-basis proxy · {cols.length} min</span>
            </div>
            {/* Its own legend. The section legend above is the BUILD-TIME ramp and
                says nothing about these four series — which is exactly how a
                violet CORE line reads as an unexplained squiggle. */}
            <div className="evlegend" style={{ marginBottom: 6 }}>
              <span><i style={{ background: "var(--violet)" }} />CORE — the heavier wall</span>
              <span><i style={{ background: "rgba(255,255,255,.42)" }} />the other wall</span>
              <span><i style={{ background: "#fff" }} />spot</span>
            </div>
            {wallPath ? (
              <>
                <WallChart path={wallPath} />
                <div className="heatx">
                  <span>{etHm(wallPath.pts[0].ts)}</span>
                  <span>{etHm(wallPath.pts[Math.floor(wallPath.pts.length / 2)].ts)}</span>
                  <span>{etHm(wallPath.pts[wallPath.pts.length - 1].ts)}</span>
                </div>
                <div className="tiny" style={{ marginTop: 6, letterSpacing: 0, textTransform: "none" }}>
                  CORE is whichever wall carries more gamma at that minute, so the two lines SWAP when the
                  dominant side changes — today the call wall held it{" "}
                  <b style={{ color: "var(--txt)" }}>{Math.round(wallPath.callCoreShare * 100)}%</b> of the
                  session. A level that sits while price travels is the one to fade; one that moves with
                  price is dealers chasing. Section 2 carries the wall log&apos;s own classified verdict.
                </div>
              </>
            ) : (
              <div className="tiny">Needs the recorded ladder.</div>
            )}

            {/* WRITTEN vs TRADED */}
            <div className="colhead" style={{ marginTop: 16 }}>
              <h3>Written vs traded</h3>
              <span className="tiny">gamma added ↔ time at price</span>
            </div>
            {writtenVsTraded.length ? (
              <>
                {(() => {
                  const maxA = Math.max(1, ...writtenVsTraded.map((r) => r.added));
                  const maxM = Math.max(1, ...writtenVsTraded.map((r) => r.minutes));
                  return writtenVsTraded.map((r) => (
                    <div className="mrow" key={r.strike}>
                      <div className="mleft">
                        <div className="mbar" style={{
                          width: `${(r.added / maxA) * 100}%`,
                          background: "linear-gradient(270deg,var(--violet),rgba(167,139,250,.3))",
                        }} />
                      </div>
                      <div className="mk3 mono">{nf(r.strike, 0)}</div>
                      <div>
                        <div className="mbar" style={{
                          width: `${(r.minutes / maxM) * 100}%`,
                          background: "linear-gradient(90deg,var(--blue),var(--blueSoft))",
                        }} />
                      </div>
                    </div>
                  ));
                })()}
                <div className="heatx">
                  <span>← gamma written</span>
                  <span>minutes at price →</span>
                </div>
              </>
            ) : (
              <div className="tiny">Needs the recorded ladder.</div>
            )}
          </div>
        </div>
      </div>

      {/* ── 4. FLOW & POSITIONING ────────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">4</span>Positioning at the Close</h3>
          <span className="tiny right">same chain, same formulas as the GEX chart</span>
        </div>
        <div className="tiles">
          <div className="tile">
            <div className="n2">Net DEX</div>
            <div className="v2 mono">{fmtUsd(totals.dex)}</div>
            <div className="m2">{totals.dex >= 0 ? "dealers long delta" : "dealers short delta"}</div>
          </div>
          <div className="tile">
            <div className="n2">Net Vanna</div>
            <div className="v2 mono">{fmtUsd(totals.vanna)}</div>
            <div className="m2">{totals.vanna >= 0 ? "vol down helps the tape" : "vol down pressures the tape"}</div>
          </div>
          <div className="tile">
            <div className="n2">Net GEX on the day</div>
            <div className="v2 mono">{netGexChg == null ? "—" : fmtUsd(netGexChg)}</div>
            <div className="m2">{netGexChg == null ? "no 09:30 ladder" : netGexChg >= 0 ? "gamma built through the session" : "gamma bled out of the book"}</div>
          </div>
          <div className="tile">
            <div className="n2">Call vs Put gamma</div>
            <div className="v2 mono">
              {(() => {
                const c = Math.abs(totals.callGex), pu = Math.abs(totals.putGex);
                return c + pu > 0 ? `${Math.round((c / (c + pu)) * 100)}% / ${Math.round((pu / (c + pu)) * 100)}%` : "—";
              })()}
            </div>
            <div className="m2">{fmtUsd(totals.callGex, false)} calls · {fmtUsd(totals.putGex, false)} puts</div>
            <div className="split">
              {(() => {
                const c = Math.abs(totals.callGex), pu = Math.abs(totals.putGex);
                const t = c + pu;
                return t > 0 ? (
                  <>
                    <i style={{ width: `${(c / t) * 100}%`, background: "linear-gradient(90deg,var(--posDim),var(--pos))" }} />
                    <i style={{ width: `${(pu / t) * 100}%`, background: "linear-gradient(90deg,var(--negDim),var(--neg))" }} />
                  </>
                ) : null;
              })()}
            </div>
          </div>
        </div>
      </div>

        {oiSplit.length > 0 && (
          <div className="body" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 12 }}>
            <div className="col">
              <div className="colhead">
                <h3>Positioned vs written</h3>
                <span className="tiny">top strikes by gamma</span>
              </div>
              <div className="evlegend" style={{ marginBottom: 7 }}>
                <span><i style={{ background: "var(--blue)" }} />settled OI</span>
                <span><i style={{ background: "var(--amber)" }} />today&apos;s volume</span>
              </div>
              {(() => {
                const maxN2 = Math.max(1, ...oiSplit.map((r) => Math.abs(r.net)));
                return oiSplit.map((r) => (
                  <div className="srow" key={r.strike}>
                    <div className="k mono">{nf(r.strike, 0)}</div>
                    <div>
                      <div className="stack" style={{ width: `${(Math.abs(r.net) / maxN2) * 100}%` }}>
                        <i style={{ width: `${(r.oiShare ?? 0) * 100}%`, background: "linear-gradient(90deg,var(--blueFill2),var(--blue))" }} />
                        <i style={{ width: `${(1 - (r.oiShare ?? 0)) * 100}%`, background: "linear-gradient(90deg,var(--amberSoft),var(--amber))" }} />
                      </div>
                    </div>
                    <div className="v mono">
                      {fmtUsd(r.net, false)}{" "}
                      <span style={{ color: "var(--blue)" }}>{Math.round((r.oiShare ?? 0) * 100)}%</span>
                      <span style={{ color: "var(--dim2)" }}> OI</span>
                    </div>
                  </div>
                ));
              })()}
            </div>
            <div className="col">
              <div className="colhead"><h3>What that means</h3><span className="tiny">no history needed</span></div>
              <div className="tiny" style={{ letterSpacing: 0, textTransform: "none", lineHeight: 1.5 }}>
                A strike with a high OI share was <b style={{ color: "var(--txt)" }}>positioned before the bell</b> —
                it was a level all day and it is still one tomorrow if the contracts survive. A strike that is
                almost all volume was <b style={{ color: "var(--txt)" }}>written today</b>, out of nothing, and
                expires with the session.
                <br /><br />
                On 0DTE the aggregate answer is always &quot;mostly volume&quot; and says nothing. Per strike it
                separates the two kinds of level, and it is the only panel on this tab that works on a day the
                recorder missed — it reads the live chain alone.
              </div>
            </div>
          </div>
        )}

      {/* ── 5. TOMORROW'S MAP ────────────────────────────────────────────── */}
      {/* Suppressed on a frozen session. "Tomorrow" for a day that has already
          happened is a day that has also already happened, and the only chain
          this panel can fetch is the CURRENT next expiry — so leaving it in
          would staple next week's structure onto last Tuesday's recap. There is
          no stored next-expiry chain per past session to substitute. */}
      {frozen ? (
        <div className="sec">
          <div className="sechead">
            <h3><span className="secn">5</span>Tomorrow&apos;s Map</h3>
            <span className="tiny right">not available for a past session</span>
          </div>
          <div className="warnbar">
            This panel builds the NEXT expiry&apos;s structure from a live chain fetch. On a frozen
            session that would be the next expiry as it stands today, not as it stood the evening of{" "}
            {etDate} — so it is left out rather than filled in with the wrong week.
          </div>
        </div>
      ) : (
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">5</span>Tomorrow&apos;s Map — after 0DTE rolls off</h3>
          <span className="tiny right">
            {nextState === "ok" && next ? `${next.expiry} chain` : nextState === "loading" ? "loading the next expiry…" : "next expiry unavailable"}
          </span>
        </div>

        {nextState !== "ok" || !railMarks ? (
          <div className="warnbar">
            {nextState === "loading"
              ? "Pulling the next expiry's chain…"
              : "Could not build tomorrow's structure — the next expiry's chain did not answer. Today's numbers above are unaffected."}
          </div>
        ) : (
          <>
            <div className="rail">
              <div className="track2">
                {railMarks.band && (
                  <div className="band" style={{ left: `${railMarks.band.left}%`, width: `${railMarks.band.width}%` }} />
                )}
              </div>
              {railMarks.placed.map((m) => (
                <div key={m.code}>
                  <div className={`mk2${m.code === "CLOSE" ? " spot" : ""}`} style={{ left: `${m.pos}%`, background: m.color }} />
                  <div className={`cap2 ${m.side}`} style={{ left: `${Math.max(4, Math.min(96, m.pos))}%` }}>
                    <div className="n2" style={{ color: m.color }}>{m.code}<span className="ln"> · {m.name}</span></div>
                    <div className="v2 mono">{fmtPx(m.px)}</div>
                    <div className="d2 mono">
                      {m.code === "CLOSE" ? "settled" : fmtPts(m.dist)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="tiles" style={{ marginTop: 6 }}>
              <div className="tile">
                <div className="n2">Wall band</div>
                <div className="v2 mono">
                  {todayWidth != null && nextWidth != null ? `${nf(todayWidth, 0)} → ${nf(nextWidth, 0)} pts` : nextWidth != null ? `${nf(nextWidth, 0)} pts` : "—"}
                </div>
                <div className="m2">
                  {todayWidth != null && nextWidth != null
                    ? nextWidth > todayWidth ? `${Math.round(((nextWidth - todayWidth) / todayWidth) * 100)}% wider` : `${Math.round(((todayWidth - nextWidth) / todayWidth) * 100)}% tighter`
                    : "structure after the roll"}
                </div>
              </div>
              <div className="tile">
                <div className="n2">Flip moves to</div>
                <div className="v2 mono">{fmtPx(next?.flip)}</div>
                <div className="m2">{next?.flip != null && closePx > 0 ? `${fmtPts(next.flip - closePx)} from the close` : "—"}</div>
              </div>
              <div className="tile">
                <div className="n2">Net GEX rolls to</div>
                <div className="v2 mono">{fmtUsd(next?.netGex ?? null)}</div>
                <div className="m2">
                  {next?.netGex != null && totalNetGex != null && totalNetGex !== 0
                    ? `${Math.round((next.netGex / Math.abs(totalNetGex)) * 100)}% of today's book`
                    : "next expiry only"}
                </div>
              </div>
              <div className="tile">
                <div className="n2">Overnight watch</div>
                <div className="v2 mono">{fmtPx(rthHi)} / {fmtPx(rthLo)}</div>
                <div className="m2">today&apos;s SPX RTH high / low · per-minute recorder</div>
              </div>
            </div>

            <div className="biasbox">
              <b>Bias:</b>{" "}
              {(next?.netGex ?? 0) >= 0 ? "Positive gamma into tomorrow" : "Negative gamma into tomorrow"}
              {nextWidth != null && todayWidth != null
                ? nextWidth > todayWidth
                  ? ` — but ${nf(nextWidth, 0)} pts of room versus ${nf(todayWidth, 0)} today, so the fade needs the edges, not the middle.`
                  : ` — and tighter than today (${nf(nextWidth, 0)} vs ${nf(todayWidth, 0)} pts), so the walls should bind sooner.`
                : "."}
              {next?.flip != null && closePx > 0 && (
                <> Watch <b>{fmtPx(next.flip)}</b>: {closePx > next.flip ? "below it the suppression is gone" : "above it the suppression comes back"}
                  {next.putWall != null && closePx > next.flip ? ` and ${fmtPx(next.putWall)} becomes the target.` : "."}
                </>
              )}
            </div>
          </>
        )}
      </div>
      )}

      {/* ── 6. JOURNAL · ACCURACY · PREMIUM ──────────────────────────────── */}
      <div className="sec">
        <div className="body" style={{ gridTemplateColumns: "1.05fr 1fr 1fr" }}>
          <div className="col">
            <div className="colhead"><h3><span className="secn">6</span>Session journal</h3><span className="tiny">{etDate} · saved on this device</span></div>
            <div className="stat">
              <span className="l">Auto-read</span>
              <span className="r" style={{ fontWeight: 500, fontSize: 11.5, textAlign: "right" }}>
                {gradeOf("CW")?.status ?? "—"} call wall · {gradeOf("PW")?.status ?? "—"} put wall · flip {gradeOf("FLIP")?.status?.toLowerCase() ?? "—"}
              </span>
            </div>
            <textarea
              className="jot"
              style={{ marginTop: 9 }}
              placeholder="What you faded, what you chased, what you'd do differently tomorrow…"
              value={note}
              onChange={(e) => saveNote(e.target.value)}
            />
          </div>

          <div className="col">
            <div className="colhead"><h3>Level accuracy</h3><span className="tiny">last {accRows.length || 0} sessions</span></div>
            {accRows.length === 0 ? (
              <div className="warnbar">
                Nothing logged yet. This tab writes one row per session after 16:05 ET — the streak fills in
                as you use it.
              </div>
            ) : (
              <>
                <div className="acc">
                  {accRows.map((r) => {
                    const score = (r.cw ? 34 : 0) + (r.pw ? 33 : 0) + (r.inside ? 33 : 0);
                    return <div className="c" key={r.date} title={r.date}><i style={{ height: `${Math.max(6, score)}%` }} /></div>;
                  })}
                </div>
                <div className="heatx"><span>{accRows[0]?.date.slice(5)}</span><span>{accRows[accRows.length - 1]?.date.slice(5)}</span></div>
                <div className="greeks" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
                  <div className="g"><div className="n">Call wall held</div><div className="v mono">{hitRate((r) => r.cw)}</div></div>
                  <div className="g"><div className="n">Put wall held</div><div className="v mono">{hitRate((r) => r.pw)}</div></div>
                  <div className="g"><div className="n">Closed inside</div><div className="v mono">{hitRate((r) => r.inside)}</div></div>
                  <div className="g"><div className="n">Pinned CORE</div><div className="v mono">{hitRate((r) => r.pinned)}</div></div>
                </div>
              </>
            )}
          </div>

          <div className="col">
            <div className="colhead">
              <h3>Where premium actually went</h3>
              <span className="tiny">{premiumTotal > 0 ? `${fmtUsd(premiumTotal, false)} traded` : "volume × mark"}</span>
            </div>
            {premiumRows.length === 0 ? (
              <div className="warnbar">
                No contract prices on this chain frame, so premium cannot be priced. Everything else on
                this page is gamma and is unaffected.
              </div>
            ) : (
              <>
                <div className="premlist">
                  {premiumRows.map((r) => {
                    // Bars are shared-scale on purpose: the whole point is which
                    // contract took the most money, so the top row is the 100%
                    // reference and every other bar is read against it.
                    const w = (r.usd / premiumRows[0].usd) * 100;
                    const color = r.side === "C" ? "var(--cw)" : "var(--pw)";
                    return (
                      <div className="premrow" key={r.key}>
                        <div className="pl mono">{nf(r.strike, 0)}{r.side}</div>
                        <div className="ptrack">
                          <i style={{ width: `${Math.max(2, w)}%`, background: color }} />
                        </div>
                        <div className="pu mono" style={{ color }}>{fmtUsd(r.usd, false)}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="tiny" style={{ marginTop: 8 }}>
                  Today&apos;s VOLUME × the contract&apos;s mark — dollars paid, not gamma. OI is deliberately
                  excluded: this is what got bought and sold today, not what was already on the books.
                  Green = calls, red = puts, same as the walls above.
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="footbar">
        <span className="l">
          {frozen ? "Frozen recap for " : "Recap for "}{etDate} · {expiry || "—"} · SPX {fmtPx(closePx, 2)}
          {em != null ? ` · EM ±${nf(em, 0)}` : ""}
        </span>
        <span className="l">
          {histState === "ok" ? "intraday ladder: recorded" : "intraday ladder: unavailable"} ·{" "}
          {frozen
            ? "frozen session"
            : nextState === "ok" ? "next expiry: loaded" : "next expiry: unavailable"}
        </span>
      </div>
    </section>
  );
}


/**
 * WallChart — call wall / CORE / put wall / spot over the session, one price
 * axis. Deliberately an inline SVG with no library: four polylines and a band,
 * on a fixed 100x viewBox that scales to whatever width the column has.
 */
function WallChart({
  path,
  height = 190,
}: {
  path: {
    pts: { ts: number; spot: number; core: number | null; other: number | null; coreSide: "call" | "put" }[];
    lo: number; hi: number;
  };
  height?: number;
}) {
  const pad = 8;
  const { pts, lo, hi } = path;
  const x = (i: number) => (i / Math.max(1, pts.length - 1)) * 100;
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2);

  /**
   * STEP, not slope. A wall is a strike: it holds one value, then jumps to
   * another. A straight interpolation between two samples draws a diagonal
   * through prices the level never occupied, which is exactly the reading this
   * panel is for — so each sample gets a horizontal run and the change is a
   * vertical edge.
   */
  const step = (pick: (p: typeof pts[number]) => number | null) => {
    const out: string[] = [];
    let prev: number | null = null;
    pts.forEach((p, i) => {
      const v = pick(p);
      if (v == null || !(v > 0)) return;
      if (prev != null && v !== prev) out.push(`${x(i)},${y(prev)}`);
      out.push(`${x(i)},${y(v)}`);
      prev = v;
    });
    return out.join(" ");
  };
  /** Spot is continuous — it is the one series that should be a real line. */
  const smooth = (pick: (p: typeof pts[number]) => number | null) =>
    pts.map((p, i) => { const v = pick(p); return v == null || !(v > 0) ? null : `${x(i)},${y(v)}`; })
       .filter(Boolean).join(" ");

  const core = step((p) => p.core);
  const other = step((p) => p.other);
  const sp = smooth((p) => (p.spot > 0 ? p.spot : null));

  return (
    <svg viewBox={`0 0 100 ${height}`} height={height} preserveAspectRatio="none"
      style={{ width: "100%", display: "block" }}>
      {/* The corridor between the two, so the room price actually had is readable. */}
      {core && other && (
        <polygon
          points={`${core} ${pts.slice().reverse().map((p, k) => {
            const i = pts.length - 1 - k;
            return p.other == null ? null : `${x(i)},${y(p.other)}`;
          }).filter(Boolean).join(" ")}`}
          fill="var(--blueWash)"
        />
      )}
      {other && <polyline points={other} fill="none" stroke="rgba(255,255,255,.42)" strokeWidth={1.4}
        vectorEffect="non-scaling-stroke" />}
      {core && <polyline points={core} fill="none" stroke="var(--violet)" strokeWidth={2}
        vectorEffect="non-scaling-stroke" />}
      {sp && <polyline points={sp} fill="none" stroke="#ffffff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
