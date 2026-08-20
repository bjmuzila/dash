// Owner "ΔGEX Board" — which strikes had dealer gamma built or taken off at
// yesterday's close, across the whole scanner watchlist.
//
// SHAPE: master–detail. A ranked rail on the left, one permanent full-size
// ladder on the right. Nothing is hidden behind a click — ↑/↓ walks the rail
// and repaints the ladder, so a daily pass over 169 names is a few seconds of
// arrowing rather than 169 navigations.
//
// DATA — three routes, all server-differenced. Nothing on this page subtracts
// one GEX number from another:
//   GET /api/eod-strike-gex-board?top=5[&date]   one call, the whole rail
//   GET /api/eod-strike-gex-change?symbol[&date] one call per name you open
//   GET /api/eod-strike-gex-dates                which sessions exist
// Written by server-v2/eod-strike-gex-recorder.js at 16:05 ET into
// eod_strike_gex. Each symbol is diffed against ITS OWN two most recent
// snapshot dates, so a name that missed a sweep compares against the last
// session it actually has instead of reading as flat.
//
// THREE MODES over the SAME payload. Every route returns the absolute level,
// the PRIOR level and the Δ on every strike, so switching modes is a re-render,
// never a fetch:
//   levels  — net GEX as that session closed
//   delta   — that level minus the session before it
//   compare — prior and now drawn on one rail, plus the four-way split below
// Retention is ~400 days, so the date picker reaches back a year. Picking an
// older session switches to `levels`, because "what did the board look like on
// the 8th" is a level question; the Δ tab is right there for the other read.
//
// ONE EXCEPTION to "three modes, one payload": `compare` carries a LIVE toggle
// that DOES fetch — GET /api/eod-strike-gex-live?symbol=… , one symbol at a
// time, swapping the "now" side for the chain as it stands this second against
// the last recorded close. Read LIVE_COPY before touching it: that number is
// NOT a Δ 1D, and the page is required to say so on screen rather than only in
// a tooltip. The rail never goes live — 169 names live is the nightly sweep.
//
// WHY `compare` EXISTS. A red Δ bar is AMBIGUOUS on its own. `chg` is
// `now − prior` on a signed net_gex, so "net GEX at this strike went down" is
// equally consistent with two opposite tapes:
//   positive (call-dominant) gamma being TAKEN OFF, and
//   negative (put-dominant) gamma being PILED ON.
// The Δ ladder cannot tell those apart and neither can the Most-pulled sort.
// Compare mode draws yesterday as an outline and today as a fill on the same
// rung — so a shrinking green bar and a growing red bar are visibly different
// events — and splitChange() totals the four cases exactly. Do not "simplify"
// this back into a single Δ bar.
//
// COLOUR: green/red alone fails deuteranope separation (ΔE 7.4), so the sign is
// ALSO carried by which side of the centre rail a bar sits on and by an
// explicit +/− on every value. Do not "simplify" this to colour-only bars.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { HOME_THEME, LIGHT_BLUE, classicCardStyle, homeButtonStyle, homeSecondaryButtonStyle } from "../lib/theme";
import { PageShell, Card } from "../components/PageCard";
import { ThemedSelect } from "../components/ThemedSelect";

const T = HOME_THEME;
// The app's GEX polarity pair, matching the Ticker Lookup ladder on the
// customer side. Deliberately not the owner status palette — a trader reads
// +GEX green / −GEX red everywhere else in this app.
const POS = "#22C55E";
const NEG = "#EF4444";
const MONO = "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// ── payload shapes ──────────────────────────────────────────────────────────
/** Which reading the board is showing. Not a filter — a different number. */
type Mode = "delta" | "levels" | "compare";

/**
 * WHICH NUMBER THE LADDER IS MADE OF. Orthogonal to Mode: `basis` picks the
 * quantity, `mode` picks whether you see its level, its Δ, or both.
 *
 * This exists because the original single number could not be differenced
 * honestly. GEX on the OI+Vol basis is |gamma| × (open_interest + volume), and
 * open interest does NOT settle at the close — OCC publishes overnight, so the
 * figure the chain carries at 16:05 on session T is settled through T−1. Volume
 * on that same response is T's. A row is therefore OI(T−1) + Vol(T), and the
 * day-over-day diff expands to
 *
 *     [OI(T−1) − OI(T−2)] + [Vol(T) − Vol(T−1)]
 *
 * where the left bracket is the NET of session T−1's trading and the right
 * bracket subtracts the GROSS of that same session. T−1 lands in the Δ twice,
 * once net and once gross, with opposite signs. A name that traded heavy on
 * Tuesday and quiet on Wednesday prints a big negative Δ on Wednesday about
 * nothing that happened on Wednesday.
 *
 * So the halves are recorded apart and this control chooses between them. See
 * BASIS_COPY for what each one is honest about.
 */
type Basis = "oivol" | "oi" | "vol" | "flow";

/**
 * WHICH LEG. Orthogonal to both Mode and Basis: basis picks the contract count,
 * leg picks which option type's gamma, mode picks level vs Δ.
 *
 * `net` is call + put, and that sum is LOSSY in a specific way — "net GEX at
 * this strike fell" is equally consistent with call gamma coming off and with
 * put gamma piling on. Compare mode already tells those apart in aggregate;
 * this tells them apart rung by rung.
 *
 * The sign behaves differently per basis and the difference is the whole value:
 *
 *   oivol / oi / vol — legs are signed by CONVENTION (calls +, puts −, on an
 *     unsigned count), so the call leg is ≥ 0 and the put leg ≤ 0 at every
 *     strike, always. A single-leg ladder is a one-sided map of WHERE that
 *     type's gamma sits. It cannot cross zero, so it has no flip — which is
 *     why the structural badges stay on net whatever this is set to.
 *   flow — legs are signed by MEASUREMENT, so either leg can take either sign.
 *     "Dealers are short call gamma at 6400 and long put gamma at 6300" is a
 *     sentence only this basis can produce, and this is how you read it.
 */
type Leg = "net" | "call" | "put";

type BoardStrike = { strike: number; chg: number };
type BoardLevelStrike = { strike: number; gex: number };
type BoardSymbol = {
  symbol: string;
  date: string | null;
  prevDate: string | null;
  spot: number | null;
  // Δ vs the prior session. Zeroed server-side when there is no prior session,
  // so a name's first day never reads as a landslide.
  net: number;
  absTot: number;
  strikes: BoardStrike[];
  // Absolute level at `date`. Needs no baseline, so these are real on day one.
  gexNet: number;
  gexAbs: number;
  gexStrikes: BoardLevelStrike[];
  badge?: Badge;
  // `oi` basis only — see ChangeResp.oiSettled.
  oiSettled?: boolean;
  prevOiSettled?: boolean;
};
type BoardResp = {
  ok?: boolean; top?: number; date?: string | null; basis?: Basis; leg?: Leg;
  symbols?: BoardSymbol[]; error?: string;
};

type ChangeRow = {
  strike: number; netGex: number; prevNetGex: number; chg: number; hadPrev: boolean;
  // The two halves of netGex. NULL, never 0, when the session predates the
  // 2026-08-18 leg migration — the chains are gone and no backfill is possible,
  // so "not recorded" has to stay distinguishable from "no call gamma here".
  callGex?: number | null; putGex?: number | null;
  prevCallGex?: number | null; prevPutGex?: number | null;
  // FLOW BASIS ONLY: how many classified prints backed this rung. 0/undefined
  // is "no tape here", which is a different statement from "flow netted to
  // zero" — the ladder has to be able to tell those apart, so the count ships.
  flowPrints?: number | null;
  // FLOW BASIS ONLY: the GROSS decomposition. callGex is a net of two opposite
  // events — gamma the dealer took on by buying calls, and gamma they took off
  // by selling them — so a strike where they did 5k of each nets to zero and is
  // indistinguishable from a strike nothing traded at. These take that back
  // out. *Buy is dealer LONG that leg (≥ 0), *Sell is dealer SHORT it (≤ 0),
  // and they are additive: callBuy + callSell = callGex, all four = netGex.
  callBuyGex?: number | null; callSellGex?: number | null;
  putBuyGex?: number | null; putSellGex?: number | null;
  prevCallBuyGex?: number | null; prevCallSellGex?: number | null;
  prevPutBuyGex?: number | null; prevPutSellGex?: number | null;
};

/** Today's expiry, summarised. Live route only — see the 0DTE note in ReadPanel. */
type ZeroDte = {
  net: number; abs: number; shareOfAbs: number;
  strikes: Array<{ strike: number; gex: number; callGex: number; putGex: number }>;
};

/** Per-symbol structural summary for the rail. Null when the board query failed. */
type Badge = {
  flipNow: number | null; flipPrev: number | null; flipMove: number | null;
  flipState: "moved" | "stable" | "vanished" | "appeared" | "none";
  flips: number;
  callWall: number | null; putWall: number | null; wallChg: number | null;
  structScore: number;
} | null;
type ChangeResp = {
  ok?: boolean; symbol?: string; date?: string | null; prevDate?: string | null;
  spot?: number | null; prevSpot?: number | null; rows?: ChangeRow[]; error?: string;
  // Present only on the LIVE route. Identical row SHAPE, different meaning on
  // the `netGex` side — see LIVE_NOTE below and the big comment above
  // getStrikeGexLive() in server-v2/eod-strike-gex-recorder.js.
  live?: boolean; asOf?: string; expiryCount?: number;
  cached?: boolean; ageMs?: number; prevIsToday?: boolean; marketDay?: boolean;
  hasLegs?: boolean; hasPrevLegs?: boolean;
  zeroDte?: ZeroDte | null;
  basis?: Basis;
  // FALSE = this basis has nothing recorded for this session/symbol. A zero
  // board and an unrecorded board are indistinguishable once the server
  // COALESCEs, and the difference matters enormously ("SPY had no flow" vs "we
  // never recorded flow for SPY"), so the page branches on this, never on the
  // row values.
  hasBasis?: boolean; hasPrevBasis?: boolean;
  leg?: Leg;
  // Whether the four gross flow components are present. Separate from
  // hasBasis: a flow session recorded before the gross columns shipped has a
  // real net ladder and NULL components, so the page must show the net without
  // implying it can decompose it.
  hasGross?: boolean;
  // `oi` basis only: did the 09:25 re-stamp reach each side? Both true → the Δ
  // is a real session-over-session ΔOI. Either false → that side's OI is the
  // provisional 16:05 read, lagged one session, and the page must say so.
  oiSettled?: boolean; prevOiSettled?: boolean;
};
type DatesResp = { ok?: boolean; dates?: string[]; basis?: Basis; leg?: Leg; error?: string };

/** Per-mode wording. Kept in one table so a label can't drift from its number. */
const MODE_COPY: Record<Mode, {
  tab: string; ladderCol: string; bigLabel: string; axis: string;
  sorts: readonly [string, string, string, string];
}> = {
  delta: {
    tab: "Δ 1 day",
    ladderCol: "Δ 1D",
    bigLabel: "net Δ 1D",
    axis: "← removed · added →",
    sorts: ["Biggest move", "Most built", "Most pulled", "Most structural"],
  },
  levels: {
    tab: "Net GEX",
    ladderCol: "Net GEX",
    bigLabel: "net GEX",
    axis: "← negative · positive →",
    sorts: ["Biggest gamma", "Most positive", "Most negative", "Most structural"],
  },
  // Compare is a Δ reading — same rail numbers, same sorts as `delta`. Only the
  // ladder and the header strip differ, so the two tabs rank identically and a
  // reader can flip between them without the list reshuffling under them.
  compare: {
    tab: "Prior → now",
    ladderCol: "Δ 1D",
    bigLabel: "net Δ 1D",
    axis: "← negative · positive →",
    sorts: ["Biggest move", "Most built", "Most pulled", "Most structural"],
  },
};

/**
 * Per-basis wording, in one table for the same reason MODE_COPY is: a label
 * that drifts from its number is worse than no label.
 *
 * `caveat` is rendered ON SCREEN, not hidden in a tooltip. Three of these four
 * numbers are wrong to read as a plain "day-over-day change" and the fourth
 * only covers three symbols — a reader who does not know which one they are
 * looking at will draw a confident wrong conclusion, and the whole reason this
 * control exists is that the single old number let them do exactly that.
 *
 * `deltaHonest` marks whether the Δ tabs are a real session-over-session
 * change on this basis. Where it is false the page keeps the tabs live (the
 * numbers are still computed correctly from what was recorded) but says what
 * the reading actually is.
 */
const BASIS_COPY: Record<Basis, {
  tab: string; name: string; unit: string; caveat: string; deltaHonest: boolean;
}> = {
  oivol: {
    tab: "OI + Vol",
    name: "OI + Volume",
    unit: "|γ| × (open interest + volume)",
    caveat:
      "Δ double-counts a session: OI at 16:05 is settled through the PREVIOUS close, volume is today's, "
      + "so the diff adds yesterday's net OI change and subtracts yesterday's gross volume. "
      + "The LEVEL is sound and matches every other card in the app — the Δ is the part to distrust. Use OI-only for a real day-over-day.",
    deltaHonest: false,
  },
  oi: {
    tab: "OI only",
    name: "Open interest",
    unit: "|γ| × open interest",
    caveat:
      "Re-stamped at 09:25 ET off the settled OCC file, so both sides of a Δ describe their own session. "
      + "This is the honest structural read. It still cannot tell you DIRECTION — calls count positive and puts negative by convention, "
      + "and open interest carries no side, so who opened the position is an assumption here. Flow is the basis that measures it.",
    deltaHonest: true,
  },
  vol: {
    tab: "Volume only",
    name: "Day volume",
    unit: "|γ| × volume",
    caveat:
      "Same-session by construction, so the LEVEL — how much gamma actually traded — is the read. "
      + "Its Δ is a second difference (today's turnover vs yesterday's), which is rarely the question. "
      + "Volume counts both sides of every trade unsigned, so this is activity, not positioning.",
    deltaHonest: false,
  },
  flow: {
    tab: "Flow (signed)",
    name: "Dealer inventory",
    unit: "|γ| × signed dealer position",
    caveat:
      "The only basis that MEASURES direction instead of assuming it: prints are classified against the bid/ask and mirrored "
      + "(public buys → dealer short, public sells → dealer long). Four limits — SPX/SPY/QQQ only; premium-floored, so it is block flow "
      + "and not the whole tape; for SPY/QQQ only the near-spot front-expiry window the streamer subscribes to; and inventory resets each "
      + "morning, so this is a SESSION, not a book. Read the level, not the Δ.",
    deltaHonest: false,
  },
};

/** Basis order in the picker — legacy first, then honest-est, then signed. */
const BASES: readonly Basis[] = ["oivol", "oi", "vol", "flow"] as const;

/**
 * Per-leg wording. `signed` marks whether that leg can take either sign on this
 * basis — false means the ladder will be entirely one-sided and the reader
 * should not go looking for a flip in it.
 */
const LEG_COPY: Record<Leg, { tab: string; name: string; hint: (b: Basis) => string }> = {
  net: {
    tab: "Net",
    name: "net",
    hint: () => "Call leg + put leg. The sum is lossy — a fall is equally consistent with call gamma coming off and put gamma piling on. Split it to tell those apart.",
  },
  call: {
    tab: "Calls",
    name: "call leg",
    hint: (b) => (b === "flow"
      ? "Call gamma the dealer actually ended up holding: positive where the public sold calls to them, negative where it bought."
      : "Call gamma only. Positive at every strike by construction on this basis — a map of where call gamma sits, not a directional read."),
  },
  put: {
    tab: "Puts",
    name: "put leg",
    hint: (b) => (b === "flow"
      ? "Put gamma the dealer actually ended up holding: positive where the public sold puts to them, negative where it bought."
      : "Put gamma only. Negative at every strike by construction on this basis — a map of where put gamma sits, not a directional read."),
  },
};

const LEGS: readonly Leg[] = ["net", "call", "put"] as const;

/** True where the chosen leg can take either sign — i.e. flow, or the net. */
const legIsSigned = (b: Basis, l: Leg) => b === "flow" || l === "net";

/** Δ readings — everything that needs a baseline session to mean anything. */
const isDelta = (m: Mode) => m !== "levels";

/**
 * LIVE MODE — a toggle ON `compare`, not a fourth tab.
 *
 * Everything else on this page is end-of-day: the rail, the date picker and
 * both other tabs read the 16:05 ET table. Live swaps ONLY the "now" side of
 * the open symbol's ladder for the chain as it stands right this second, so
 * the rung reads "last recorded close → now" instead of "close → close".
 *
 * WHY IT IS NOT A Δ 1D, AND WHY THE PAGE SAYS SO. GEX here is on the OI+Vol
 * basis. Open interest is last night's settled file and does not move until
 * tomorrow's; volume starts at zero at 09:30 and accrues all session. So an
 * intraday "close → now" is, in the main, TODAY'S TAPE PILING UP on a fixed OI
 * base: near zero at the open, growing into the bell. That is the signal — but
 * it is a different quantity from the session-over-session Δ the other two tabs
 * show, and labelling both "Δ 1D" would be a lie. Hence LIVE_COPY.
 *
 * SCOPE IS ONE SYMBOL. Each live read re-runs every listed expiry for the name
 * against TastyTrade — one slice of the nightly sweep. The rail stays on the
 * recorded board, and there is no "everything live" button on purpose.
 *
 * NO AUTO-POLL. The server caches a symbol for a minute; ↻ is the refresh.
 * Arrowing down the rail with Live on is one sweep per name you stop on.
 */
const LIVE_COPY = {
  ladderCol: "Δ vs close",
  bigLabel: "net Δ vs close",
  axis: "← lighter · heavier →",
};

/** ET wall clock for the "as of" stamp — the table's own timezone. */
const fmtEtTime = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hourCycle: "h23",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(d);
};

/**
 * Split a session's Δ into the four things that can produce it.
 *
 * Positive and negative gamma are tracked SEPARATELY per strike, because the
 * headline Δ is ambiguous: net GEX falling is equally consistent with call
 * gamma being taken off and with put gamma being piled on, and those are
 * opposite reads of the tape.
 *
 * The split is exact and additive by construction:
 *   posPart = max(now,0) − max(prior,0)     change in the positive leg
 *   negPart = min(now,0) − min(prior,0)     change in the negative leg
 *   posPart + negPart === now − prior === chg
 * That identity holds even when a strike FLIPS sign across the session, which
 * is exactly the case a naive `prior > 0 ? …` bucket would misfile. So the four
 * buckets always sum back to the headline net Δ — if they ever don't, the bug
 * is here and not in the reader's arithmetic.
 */
function splitChange(rows: ChangeRow[]) {
  let posBuilt = 0, posPulled = 0, negBuilt = 0, negPulled = 0;
  for (const r of rows) {
    const posPart = Math.max(r.netGex, 0) - Math.max(r.prevNetGex, 0);
    const negPart = Math.min(r.netGex, 0) - Math.min(r.prevNetGex, 0);
    if (posPart >= 0) posBuilt += posPart; else posPulled += posPart;
    // negPart < 0 means the negative leg got DEEPER, i.e. −γ was built.
    if (negPart <= 0) negBuilt += negPart; else negPulled += negPart;
  }
  return { posBuilt, posPulled, negBuilt, negPulled };
}

// ── THE READ: interpretation computed off the SAME rows the ladder draws ─────
//
// Everything below is derived, in the browser, from `detail.rows` — the exact
// array the ladder renders. Nothing here fetches, and nothing here is a second
// source of truth: if the Read panel and the ladder ever disagree, the bug is in
// this file and not in the data.
//
// It works in live mode for free, because live returns the same row shape. The
// numbers then describe the live chain against the last recorded close, and the
// live caveat above the panel already says what that means.

/** How near the money a strike has to be to count as "in the band". */
type Band = 0 | 3 | 5;

type Wall = {
  strike: number;
  now: number;
  prior: number;
  chg: number;
  /** chg as a share of the prior level. null when there was no prior to shrink. */
  pct: number | null;
  /** Signed distance from spot, in percent. */
  dist: number;
} | null;

/**
 * How a strike changed, named. Ordered by priority — a sign flip outranks
 * everything, because a level that crossed zero overnight changed KIND, not
 * just size, and that is true however small its dollar Δ is.
 */
type MoverTag = "flip+" | "flip−" | "new+" | "new−" | "built" | "eroded";

type Mover = {
  strike: number; now: number; prior: number; chg: number;
  /** |Δ| as a share of the book — the only figure comparable across symbols. */
  pct: number;
  dist: number;
  tag: MoverTag;
};

const MOVER_COPY: Record<MoverTag, { label: string; tone: "pos" | "neg" | "warn" }> = {
  "flip+": { label: "flipped +", tone: "pos" },
  "flip−": { label: "flipped −", tone: "warn" },
  "new+": { label: "new +γ", tone: "pos" },
  "new−": { label: "new −γ", tone: "warn" },
  built: { label: "built", tone: "pos" },
  eroded: { label: "eroded", tone: "neg" },
};

/**
 * Where cumulative net GEX crosses zero, walking the ladder from the low strike
 * up, linearly interpolated between the two strikes that straddle the crossing.
 *
 * Returns EVERY crossing, not just one. A real book can cross more than once,
 * and silently reporting the first would be a confident wrong answer — the
 * caller picks the crossing nearest spot and the panel says when there was more
 * than one.
 *
 * The first row can never produce a crossing: the running total starts at zero,
 * so "0 → first value" would register as a sign change at the bottom of every
 * ladder. That is what the `prev == null` guard is for.
 */
function zeroCrossings(rows: ChangeRow[], pick: (r: ChangeRow) => number): number[] {
  const asc = [...rows].sort((a, b) => a.strike - b.strike);
  const out: number[] = [];
  let cum = 0;
  let prevStrike: number | null = null;
  for (const r of asc) {
    const before = cum;
    cum += pick(r);
    if (prevStrike != null && ((before < 0 && cum >= 0) || (before > 0 && cum <= 0))) {
      // Linear interpolation on the cumulative curve. before === cum cannot
      // reach here (it would mean a zero-width crossing of a flat line), but
      // the guard keeps a divide-by-zero out of the arithmetic regardless.
      const t = cum === before ? 0 : (0 - before) / (cum - before);
      out.push(prevStrike + t * (r.strike - prevStrike));
    }
    prevStrike = r.strike;
  }
  return out;
}

/** The crossing a reader cares about is the one price is standing next to. */
function nearestTo(xs: number[], target: number): number | null {
  if (!xs.length) return null;
  return xs.reduce((b, x) => (Math.abs(x - target) < Math.abs(b - target) ? x : b), xs[0]);
}

/**
 * The wall on one side of spot: the most positive strike above (the ceiling
 * dealers are long gamma into) or the most negative below (the floor they are
 * short gamma into).
 *
 * Returns null rather than a nearest-to-zero strike when NOTHING on that side
 * carries gamma of the expected sign — "there is no put wall today" is a real
 * answer and a fabricated one would be read as a level.
 */
function findWall(rows: ChangeRow[], spot: number, side: "call" | "put"): Wall {
  const on = rows.filter((r) => (side === "call" ? r.strike > spot : r.strike < spot));
  if (!on.length) return null;
  const best = on.reduce((b, r) => {
    const better = side === "call" ? r.netGex > b.netGex : r.netGex < b.netGex;
    return better ? r : b;
  }, on[0]);
  if (side === "call" ? !(best.netGex > 0) : !(best.netGex < 0)) return null;
  return {
    strike: best.strike,
    now: best.netGex,
    prior: best.prevNetGex,
    chg: best.chg,
    pct: best.prevNetGex === 0 ? null : best.chg / Math.abs(best.prevNetGex),
    dist: (best.strike / spot - 1) * 100,
  };
}

/** Name what happened at a strike. Order is the priority order — see MoverTag. */
function tagMove(prior: number, now: number): MoverTag {
  const crossed = prior !== 0 && now !== 0 && Math.sign(prior) !== Math.sign(now);
  if (crossed) return now > 0 ? "flip+" : "flip−";
  // Built out of nothing. The 0.15 is a ratio, not a dollar floor, so it means
  // the same thing on SPX and on a $30 name.
  if (Math.abs(prior) < 0.15 * Math.abs(now)) return now > 0 ? "new+" : "new−";
  return Math.abs(now) > Math.abs(prior) ? "built" : "eroded";
}

type Analysis = {
  /** Totals over the WHOLE ladder — never the band. A regime is the whole book. */
  netTotal: number; prevTotal: number; deltaNet: number; absTot: number;
  /** Δ as a share of |book|. The raw dollars are not comparable across symbols. */
  deltaPct: number | null;
  callWall: Wall; putWall: Wall;
  flipNow: number | null; flipPrev: number | null;
  crossingsNow: number;
  /** Every strike the same sign. NOT the same claim as "no zero crossing". */
  oneSided: boolean;
  /** Signed points from spot to the flip. Positive = spot is above it. */
  cushionNow: number | null; cushionPrev: number | null;
  /** Ranked by |Δ|, already band-filtered. */
  movers: Mover[];
  /**
   * The Δ, split by which LEG moved. This is the question a net number cannot
   * answer: net GEX falling is equally consistent with call gamma coming off
   * and put gamma piling on, and those are opposite reads of the tape.
   * null when either session lacks recorded legs — see ChangeRow.
   */
  legs: { callChg: number; putChg: number; callNow: number; putNow: number } | null;
};

/**
 * One pass over the ladder, everything the Read panel shows.
 *
 * `band` filters the MOVERS ONLY. Regime totals, the walls and the flip are
 * always computed on the full ladder: a band is a reading aid for the ranking,
 * and applying it to a sum would silently redefine the sum.
 */
function analyzeLadder(
  rows: ChangeRow[], spot: number | null, band: Band, hasPrior: boolean,
  hasLegs = false, hasPrevLegs = false,
): Analysis {
  let netTotal = 0, prevTotal = 0, absTot = 0;
  for (const r of rows) {
    netTotal += r.netGex;
    prevTotal += r.prevNetGex;
    absTot += Math.abs(r.netGex);
  }
  const deltaNet = netTotal - prevTotal;

  // A ladder can be mixed-sign at every rung and still never have its RUNNING
  // TOTAL reach zero — a deeply short book with fat call strikes does exactly
  // that. Tracked separately because the flip tile has to explain which of the
  // two situations it is in, and conflating them prints a claim the movers list
  // three inches below visibly contradicts.
  const signs = new Set(rows.filter((r) => r.netGex !== 0).map((r) => Math.sign(r.netGex)));
  const crossNow = zeroCrossings(rows, (r) => r.netGex);
  const crossPrev = hasPrior ? zeroCrossings(rows, (r) => r.prevNetGex) : [];
  const anchor = spot ?? (rows.length ? rows[Math.floor(rows.length / 2)].strike : 0);
  const flipNow = nearestTo(crossNow, anchor);
  const flipPrev = nearestTo(crossPrev, anchor);

  const inBand = (r: ChangeRow) =>
    band === 0 || spot == null || Math.abs(r.strike / spot - 1) * 100 <= band;

  const movers: Mover[] = hasPrior
    ? rows
      .filter((r) => r.chg !== 0 && inBand(r))
      .map((r) => ({
        strike: r.strike,
        now: r.netGex,
        prior: r.prevNetGex,
        chg: r.chg,
        pct: absTot === 0 ? 0 : r.chg / absTot,
        dist: spot ? (r.strike / spot - 1) * 100 : 0,
        tag: tagMove(r.prevNetGex, r.netGex),
      }))
      .sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg))
    : [];

  // Legs are summed ONLY when both sessions have them. A mixed sum — today's
  // real call leg against a prior side that is null-treated-as-zero — would
  // print the entire current call book as "built today".
  let legs: Analysis["legs"] = null;
  if (hasLegs && (!hasPrior || hasPrevLegs)) {
    let callNow = 0, putNow = 0, callPrev = 0, putPrev = 0;
    for (const r of rows) {
      callNow += r.callGex ?? 0;
      putNow += r.putGex ?? 0;
      callPrev += r.prevCallGex ?? 0;
      putPrev += r.prevPutGex ?? 0;
    }
    legs = { callNow, putNow, callChg: callNow - callPrev, putChg: putNow - putPrev };
  }

  return {
    netTotal, prevTotal, deltaNet, absTot,
    legs,
    deltaPct: absTot === 0 ? null : deltaNet / absTot,
    callWall: spot == null ? null : findWall(rows, spot, "call"),
    putWall: spot == null ? null : findWall(rows, spot, "put"),
    flipNow, flipPrev,
    crossingsNow: crossNow.length,
    oneSided: signs.size <= 1,
    cushionNow: flipNow == null || spot == null ? null : spot - flipNow,
    cushionPrev: flipPrev == null || spot == null ? null : spot - flipPrev,
    movers,
  };
}

/**
 * The regime sentence. Keyed on (sign of the book × sign of the Δ) so the
 * wording can never drift from the number beside it — the same discipline
 * MODE_COPY enforces for the tabs.
 *
 * Deliberately MECHANICAL, not advisory. It says what the dealer book does, not
 * what to trade: "dampening, and thinning" rather than "sell premium here". The
 * trade call is the reader's, and a dashboard that makes it for them is wrong
 * the first time the regime is right and the tape is not.
 */
function regimeCopy(netTotal: number, prevTotal: number, hasPrior: boolean): { word: string; line: string } {
  const pos = netTotal > 0;
  const word = netTotal === 0 ? "FLAT" : pos ? "POSITIVE" : "NEGATIVE";
  if (!hasPrior) {
    return {
      word,
      line: pos
        ? "Net long gamma — dealer hedging dampens moves."
        : "Net short gamma — dealer hedging amplifies moves.",
    };
  }
  const deltaNet = netTotal - prevTotal;

  // THE BOOK CROSSED ZERO. Checked FIRST, and it is not a bigger version of the
  // growing/shrinking cases below — it is a different event. Dealer hedging
  // reversed direction: it used to lean against moves and now leans into them
  // (or the reverse). Falling through to the size wording gets this actively
  // wrong — a book going +4.61B → −8.31B was reported as "NEGATIVE · deepening",
  // and nothing deepens from positive.
  if (prevTotal !== 0 && netTotal !== 0 && Math.sign(prevTotal) !== Math.sign(netTotal)) {
    return {
      word: `${word} · flipped from ${pos ? "short" : "long"}`,
      line: pos
        ? "The whole book crossed zero — short gamma at the prior close, long now. Hedging has gone from amplifying moves to damping them."
        : "The whole book crossed zero — long gamma at the prior close, short now. Hedging has gone from damping moves to amplifying them.",
    };
  }

  const grew = pos ? deltaNet > 0 : deltaNet < 0;
  if (pos) {
    return {
      word: `${word} · ${grew ? "strengthening" : "thinning"}`,
      line: grew
        ? "Long gamma, and more of it than at the prior close — dampening got stronger."
        : "Long gamma, but less of it than at the prior close — the dampening is thinning.",
    };
  }
  return {
    word: `${word} · ${grew ? "deepening" : "easing"}`,
    line: grew
      ? "Short gamma, and deeper than at the prior close — hedging amplifies more than it did."
      : "Short gamma, but shallower than at the prior close — the amplification is easing.",
  };
}

// ── formatting ──────────────────────────────────────────────────────────────
function fmtBig(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(a / 1e3).toFixed(0)}K`;
  return a.toFixed(0);
}
/** Signed, with a real minus sign — the sign is data, so it never gets dropped. */
const sgn = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtBig(v)}`;
const col = (v: number) => (v > 0 ? POS : v < 0 ? NEG : T.textMuted);
/** A ratio as a signed percent. `null` (no baseline to divide by) prints as —. */
const pctStr = (v: number | null, digits = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(digits)}%`;
/** Signed points. Precision follows magnitude so a 2-point gap is never "0". */
const pts = (v: number) => {
  const a = Math.abs(v);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${a.toFixed(a < 1 ? 2 : a < 10 ? 1 : 0)}`;
};
const strikeStr = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
/**
 * How much a level moved, relative to where it started.
 *
 * Past roughly a doubling a percentage stops being readable — a put wall going
 * −844.9M → −4.79B printed as "−467%", which is correct and useless. Beyond 2×
 * this switches to a multiple, which is how anyone would say it out loud.
 * Sign-crossing moves have no meaningful ratio at all, so they get neither.
 */
function growthStr(prior: number, now: number): string {
  if (prior === 0) return "";
  if (Math.sign(prior) !== Math.sign(now) && now !== 0) return "crossed zero";
  const mult = Math.abs(now) / Math.abs(prior);
  if (mult >= 2) return `${mult.toFixed(1)}× deeper`;
  if (mult > 0 && mult <= 0.5) return `${(1 / mult).toFixed(1)}× smaller`;
  return pctStr((now - prior) / Math.abs(prior), 0);
}

const label: CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: "0.1em",
  textTransform: "uppercase", color: T.text,
};
const oneLine: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 };

// ── deep links out to the customer app ──────────────────────────────────────
//
// The owner SPA is served from its own origin (owner.cbedge.net, nginx), so a
// bare "/flow" here resolves against the OWNER app and 404s. These are absolute
// on purpose. Overridable at build time for a staging host.
const SITE = (import.meta as { env?: Record<string, string> }).env?.VITE_SITE_ORIGIN || "https://cbedge.net";

/**
 * Flow, focused on a symbol. Params follow components/pages/Flow.tsx:
 * `ticker` (NOT `symbol` — Flow silently ignores `symbol`) and `dteMax`, where
 * 0 means 0DTE only. Flow has no strike filter, so a strike cannot be passed;
 * see chainHref for the strike-level target.
 */
const flowHref = (symbol: string, zeroDteOnly = false) =>
  `${SITE}/app/flow?ticker=${encodeURIComponent(symbol)}${zeroDteOnly ? "&dteMax=0" : ""}`;

/**
 * Options Chain, prefilled. Matches the established href in
 * components/pages/Scanner.tsx — bare route path (next.config.js redirects it
 * to /app/*), encodeURIComponent on every value, `strike` included for
 * consistency even though OptionsChain does not currently read it.
 *
 * NOTE it PREFILLS but does not auto-load: the reader still presses GO. The
 * link text says "open in chain" rather than "show" for that reason.
 */
const chainHref = (symbol: string, strike: number) =>
  `${SITE}/options-chain?symbol=${encodeURIComponent(symbol)}&strike=${strike}`;

const linkStyle: CSSProperties = {
  color: LIGHT_BLUE, textDecoration: "none", borderBottom: `1px dotted ${LIGHT_BLUE}77`,
  cursor: "pointer", whiteSpace: "nowrap",
};

/**
 * The ONE structural fact worth 60px of rail, or null.
 *
 * A rail row has room for a symbol, a magnitude bar, a value and roughly one
 * short chip. So this picks a single headline rather than stacking three: a
 * crossing that appeared or vanished outranks a migration, which outranks a
 * count of sign flips. Everything it does not show is one click away in the
 * panel, which is the right place for detail.
 */
function railBadge(b: Badge, spot: number | null): { text: string; tone: "pos" | "neg" | "warn"; title: string } | null {
  if (!b) return null;
  if (b.flipState === "vanished") {
    return { text: "FLIP GONE", tone: "warn", title: "The gamma flip was inside the recorded window at the prior close and is not now — the running total no longer crosses zero here." };
  }
  if (b.flipState === "appeared") {
    return { text: "FLIP NEW", tone: "warn", title: "A gamma flip has appeared inside the window that was not there at the prior close." };
  }
  if (b.flipMove != null && spot && Math.abs(b.flipMove / spot) * 100 >= 0.15) {
    // Points, not percent: a trader reads a flip level in points, and the
    // percent already did its job in the ranking.
    return {
      text: `FLIP ${pts(b.flipMove)}`,
      tone: b.flipMove > 0 ? "pos" : "neg",
      title: `Gamma flip moved from ${b.flipPrev?.toFixed(2)} to ${b.flipNow?.toFixed(2)}.`,
    };
  }
  if (b.flips >= 2) {
    return { text: `${b.flips}× FLIP`, tone: "warn", title: `${b.flips} strikes crossed zero overnight — a change of kind, not just size.` };
  }
  return null;
}

// ── the read panel ──────────────────────────────────────────────────────────
const tile: CSSProperties = {
  border: `1px solid ${T.border}`, borderRadius: 12, padding: "9px 12px",
  background: T.panelInset, minWidth: 0,
};
const chipBase: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px",
  borderRadius: 999, fontSize: 10, fontWeight: 800, letterSpacing: ".05em",
  textTransform: "uppercase", border: `1px solid ${T.border}`, whiteSpace: "nowrap",
};
const toneColor = (t: "pos" | "neg" | "warn") => (t === "pos" ? POS : t === "neg" ? NEG : T.gold);
function toneChip(t: "pos" | "neg" | "warn"): CSSProperties {
  const c = toneColor(t);
  return { ...chipBase, color: c, borderColor: `${c}61`, background: `${c}1c` };
}

/**
 * One wall, with what happened to it.
 *
 * The state word is DESCRIPTIVE — "eroding" is a fact about the gamma at that
 * strike. What it implies for a trade depends on regime, tape and the reader's
 * own rules, none of which this panel can see, so it does not guess.
 */
function WallTile({ side, wall, hasPrior, symbol }: {
  side: "call" | "put"; wall: Wall; hasPrior: boolean; symbol: string;
}) {
  const isCall = side === "call";
  const name = isCall ? "Call wall" : "Put wall";
  if (!wall) {
    return (
      <div style={tile}>
        <span style={label}>{name}</span>
        <div style={{ fontFamily: MONO, fontSize: 13, marginTop: 3 }}>—</div>
        <div style={{ fontSize: 11, marginTop: 2 }}>
          No {isCall ? "positive" : "negative"} gamma {isCall ? "above" : "below"} spot in this window.
        </div>
      </div>
    );
  }
  // A wall "grows" when its OWN magnitude grows — a call wall by getting more
  // positive, a put wall by getting more negative. Comparing raw signs here
  // would call a deepening put wall "shrinking".
  const grew = isCall ? wall.chg > 0 : wall.chg < 0;
  // Side-specific words. "Eroding" on the put side was actively misleading: a
  // put wall losing magnitude means LESS short gamma under price, which the
  // tone colours green — and a green chip reading "eroding" makes a reader
  // stop and re-derive what it meant. Call walls build/erode, put walls
  // deepen/lift, and the word matches the colour in both.
  const word = !hasPrior ? "no baseline" : isCall ? (grew ? "building" : "eroding") : grew ? "deepening" : "lifting";
  const growth = hasPrior ? growthStr(wall.prior, wall.now) : "";
  const tone: "pos" | "neg" | "warn" = !hasPrior ? "warn" : grew ? (isCall ? "pos" : "warn") : isCall ? "neg" : "pos";
  return (
    <div style={tile}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={label}>{name} · {pts(wall.dist)}%</span>
        {hasPrior ? <span style={toneChip(tone)}>{grew ? "▲" : "▼"} {word}</span> : null}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 800, marginTop: 2 }}>
        <a href={chainHref(symbol, wall.strike)} target="_blank" rel="noreferrer"
          style={{ ...linkStyle, borderBottomColor: "transparent" }}
          title={`Open ${symbol} in the options chain, prefilled to this strike (you still press GO)`}>
          {strikeStr(wall.strike)}
        </a>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 11, marginTop: 3, display: "flex", flexWrap: "wrap", gap: 8 }}>
        <span style={{ color: col(wall.now) }}>{sgn(wall.now)}</span>
        {hasPrior ? (
          <>
            <span>was <span style={{ color: col(wall.prior) }}>{sgn(wall.prior)}</span></span>
            <span style={{ color: col(isCall ? wall.chg : -wall.chg) }}>
              {sgn(wall.chg)}{growth ? ` · ${growth}` : ""}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Regime · walls · flip — the interpretation layer, computed in analyzeLadder()
 * off the rows the ladder is drawing.
 *
 * The flip block reports the MIGRATION and the CUSHION as measurements and
 * stops there. DO NOT add an interpretation sentence, and do not colour the
 * cushion by whether it grew or shrank.
 *
 * This is a decision, not an omission. Two conventions are in common use and
 * they read a rising flip in opposite directions — one has the short-gamma zone
 * climbing toward spot (more fragile), the other has more of the book below
 * spot turning supportive. A dashboard that asserts one of them in prose is
 * worse than one that reports the number, because the reader cannot tell which
 * convention produced the sentence.
 *
 * A one-sided colour is the same assertion in a quieter form: gold-on-shrinking
 * says "shrinking is the bad direction" without saying it. That is why the
 * cushion is plain text. The migration value IS highlighted, but symmetrically
 * — it flags that the level moved, never which way was good.
 */
function ReadPanel({ a, mode, hasPrior, live, symbol, zeroDte, legsMissing }: {
  a: Analysis; mode: Mode; hasPrior: boolean; live: boolean;
  symbol: string; zeroDte: ZeroDte | null; legsMissing: boolean;
}) {
  const reg = regimeCopy(a.netTotal, a.prevTotal, hasPrior);
  const regTone = a.netTotal > 0 ? POS : a.netTotal < 0 ? NEG : T.textMuted;

  return (
    <div style={{ display: "grid", gap: 10, margin: "0 0 12px" }}>

      {/* Regime — the whole book, never the band. */}
      <div style={{ ...tile, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
        <div style={{ minWidth: 150 }}>
          <span style={label}>Regime</span>
          <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800, color: regTone }}>{sgn(a.netTotal)}</div>
          <div style={{ fontSize: 11, fontWeight: 700 }}>{reg.word}</div>
        </div>
        <div style={{ flex: 1, minWidth: 220, fontSize: 12 }}>{reg.line}</div>
        {hasPrior ? (
          <div style={{ display: "flex", gap: 14, fontFamily: MONO, fontSize: 12, flexWrap: "wrap" }}>
            <span>
              <span style={label}>{live ? "at close" : "prior"}</span><br />
              <span style={{ color: col(a.prevTotal) }}>{sgn(a.prevTotal)}</span>
            </span>
            <span>
              <span style={label}>Δ book</span><br />
              <span style={{ color: col(a.deltaNet) }}>{sgn(a.deltaNet)}</span>
            </span>
            <span title="The Δ as a share of this symbol's total |GEX| — the only version of this number that is comparable to another symbol's.">
              <span style={label}>Δ / |GEX|</span><br />
              <span style={{ color: col(a.deltaNet) }}>{pctStr(a.deltaPct)}</span>
            </span>
          </div>
        ) : null}
      </div>

      {/* Walls + flip. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
        <WallTile side="call" wall={a.callWall} hasPrior={hasPrior} symbol={symbol} />
        <WallTile side="put" wall={a.putWall} hasPrior={hasPrior} symbol={symbol} />
        <div style={tile}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span style={label}>Gamma flip</span>
            {a.crossingsNow > 1 ? (
              <span
                style={{ ...chipBase, color: T.gold, borderColor: `${T.gold}61`, background: `${T.gold}1c` }}
                title={`Cumulative net GEX crosses zero ${a.crossingsNow} times in this window. The one shown is the crossing nearest spot.`}
              >{a.crossingsNow}× crossing</span>
            ) : null}
          </div>
          {a.flipNow == null ? (
            <>
              <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 800, marginTop: 2 }}>—</div>
              <div style={{ fontSize: 11, marginTop: 2 }}>
                {a.oneSided
                  ? "Every strike in this window carries gamma of one sign, so there is nothing to cross."
                  : "Running total never reaches zero inside the recorded ±40-strike window — individual strikes do change sign, but the cumulative does not. The flip, if there is one, sits outside the window."}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 800, marginTop: 2 }}>{strikeStr(Math.round(a.flipNow * 100) / 100)}</div>
              <div style={{ fontFamily: MONO, fontSize: 11, marginTop: 3, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {a.flipPrev != null ? (
                  <span>was {strikeStr(Math.round(a.flipPrev * 100) / 100)} · <span style={{ color: T.gold }}>{pts(a.flipNow - a.flipPrev)}</span></span>
                ) : null}
                {a.cushionNow != null ? (
                  <span title="Signed distance from spot to the crossing. Positive = spot is above the flip.">
                    spot {pts(a.cushionNow)}
                    {a.cushionPrev != null ? <span> (was {pts(a.cushionPrev)})</span> : null}
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── which LEG moved ────────────────────────────────────────────────
          The reason a single Δ bar is ambiguous, answered directly. `callChg`
          and `putChg` sum exactly to the net Δ, since netGex is defined as
          callGex + putGex at every strike. */}
      {isDelta(mode) && hasPrior && a.legs ? (
        <div style={tile}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={label}>Which leg moved · call vs put gamma</span>
            <a href={flowHref(symbol)} target="_blank" rel="noreferrer" style={{ ...linkStyle, fontSize: 11 }}
              title="ΔGEX cannot see intent — whether this came from aggressive customer buying or passive flow. That lives in the tape.">
              check the tape ↗
            </a>
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 6, fontFamily: MONO, fontSize: 12 }}>
            <span>
              <span style={label}>call leg</span><br />
              <span style={{ color: col(a.legs.callNow) }}>{sgn(a.legs.callNow)}</span>{" "}
              <span style={{ color: col(a.legs.callChg) }}>({sgn(a.legs.callChg)})</span>
            </span>
            <span>
              <span style={label}>put leg</span><br />
              <span style={{ color: col(a.legs.putNow) }}>{sgn(a.legs.putNow)}</span>{" "}
              <span style={{ color: col(a.legs.putChg) }}>({sgn(a.legs.putChg)})</span>
            </span>
            <span style={{ flex: 1, minWidth: 210, fontFamily: "inherit", fontSize: 11.5 }}>
              {/* The four readings a net Δ collapses into one. */}
              {a.legs.callChg < 0 && a.legs.putChg < 0
                ? "Calls came off AND puts piled on — both push the same way."
                : a.legs.callChg > 0 && a.legs.putChg > 0
                  ? "Calls added AND puts covered — both push the same way."
                  : Math.abs(a.legs.callChg) > Math.abs(a.legs.putChg)
                    ? `Mostly the call leg — ${a.legs.callChg > 0 ? "added" : "taken off"}, with the put leg the smaller half.`
                    : `Mostly the put leg — ${a.legs.putChg < 0 ? "piled on" : "covered"}, with the call leg the smaller half.`}
            </span>
          </div>
        </div>
      ) : isDelta(mode) && hasPrior && legsMissing ? (
        <div style={{ ...tile, fontSize: 11.5 }}>
          <span style={label}>Which leg moved</span>
          <div style={{ marginTop: 3 }}>
            Not available for these sessions. Call and put legs have been recorded
            separately since 2026-08-18; earlier snapshots stored only the net, and
            the chains they came from are gone, so there is nothing to backfill from.
          </div>
        </div>
      ) : null}

      {/* ── 0DTE, live only ────────────────────────────────────────────────
          The recorded series is ex-0DTE by design: the sweep runs at 16:05, by
          which point today's expiry is dead. Intraday it is the opposite — the
          fastest gamma on the board and the half the table structurally cannot
          see — so it appears only on the live read. */}
      {live && zeroDte ? (
        <div style={tile}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={label}>0DTE · expires tonight · NOT in the ladder below</span>
            <a href={flowHref(symbol, true)} target="_blank" rel="noreferrer" style={{ ...linkStyle, fontSize: 11 }}>
              0DTE tape ↗
            </a>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 6, fontFamily: MONO, fontSize: 12, alignItems: "baseline" }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: col(zeroDte.net) }}>{sgn(zeroDte.net)}</span>
            <span title="Share of all gamma on this name, measured on |GEX|, that expires today. A board that is mostly 0DTE is a different object from one that is mostly structural.">
              {(zeroDte.shareOfAbs * 100).toFixed(0)}% of the book
            </span>
            {zeroDte.strikes.slice(0, 4).map((k) => (
              <span key={k.strike} style={{ ...chipBase, textTransform: "none", fontWeight: 700 }}>
                {strikeStr(k.strike)} <span style={{ color: col(k.gex) }}>{sgn(k.gex)}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Movers — band-filtered, ranked by |Δ|, each one named. Δ readings only:
          in `levels` mode there is no change to rank. */}
      {isDelta(mode) && hasPrior && a.movers.length ? (
        <div style={tile}>
          <span style={label}>Biggest moves · ranked by |Δ|, share of book</span>
          <div style={{ display: "grid", gap: 3, marginTop: 6 }}>
            {a.movers.slice(0, 6).map((m) => {
              const t = MOVER_COPY[m.tag];
              return (
                <div
                  key={m.strike}
                  title={`${strikeStr(m.strike)} · ${sgn(m.prior)} → ${sgn(m.now)} · Δ ${sgn(m.chg)} (${pctStr(m.pct)} of |GEX|)`}
                  style={{
                    display: "grid", gridTemplateColumns: "78px 54px 1fr 76px 62px 92px",
                    gap: 8, alignItems: "center", fontFamily: MONO, fontSize: 11.5,
                  }}
                >
                  <a href={chainHref(symbol, m.strike)} target="_blank" rel="noreferrer"
                    style={{ ...linkStyle, fontWeight: 700, borderBottomColor: "transparent" }}
                    title={`Open ${symbol} in the options chain at ${strikeStr(m.strike)}`}>
                    {strikeStr(m.strike)}
                  </a>
                  <span style={{ color: T.text }}>{pts(m.dist)}%</span>
                  <span style={{ color: col(m.prior) }}>
                    {sgn(m.prior)} <span style={{ color: T.text }}>→</span> <span style={{ color: col(m.now) }}>{sgn(m.now)}</span>
                  </span>
                  <span style={{ textAlign: "right", color: col(m.chg) }}>{sgn(m.chg)}</span>
                  <span style={{ textAlign: "right", color: col(m.chg) }}>{pctStr(m.pct)}</span>
                  <span style={{ ...toneChip(t.tone), justifySelf: "start" }}>{t.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── the ladder ──────────────────────────────────────────────────────────────
// Bars run out from a centre rail: removed left, added right. Highest strike at
// the top, like a DOM, so the shape matches every other ladder in the app.
const LADDER_COLS = "82px 1fr 78px";

/**
 * One rung's bars, drawn out from a shared centre rail. `compare` passes TWO
 * items (prior as an outline, now as a fill); the other modes pass one.
 *
 * The rail is absolutely positioned behind the stack rather than rendered
 * inline per bar: two inline rails would stack into a dashed line and a
 * two-bar rung would read as two adjacent strikes instead of one strike
 * measured twice.
 */
function RailBars({ items, max }: { items: Array<{ v: number; ghost?: boolean }>; max: number }) {
  const h = items.length > 1 ? 8 : 12;
  return (
    <span style={{ position: "relative", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span aria-hidden style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: T.border }} />
      {items.map((it, i) => {
        const pos = it.v >= 0;
        // A 2% floor keeps a real-but-tiny value visible; a true zero draws
        // nothing, so "no change" and "a rounding crumb" stay distinguishable.
        const pct = it.v === 0 ? 0 : Math.max(2, (Math.abs(it.v) / max) * 100);
        const c = pos ? POS : NEG;
        // Outline + wash for the prior session. Two solid bars would compete;
        // the eye should land on TODAY and use yesterday as the reference edge.
        const skin: CSSProperties = it.ghost
          ? { border: `1px solid ${c}`, background: `${c}26`, boxSizing: "border-box" }
          : { background: c, boxSizing: "border-box" };
        return (
          <span key={i} style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
            <span style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
              {!pos && pct > 0 && <span style={{ width: `${pct}%`, height: h, borderRadius: "4px 0 0 4px", ...skin }} />}
            </span>
            <span style={{ width: 1, flexShrink: 0, margin: "0 2px" }} />
            <span style={{ flex: 1, display: "flex" }}>
              {pos && pct > 0 && <span style={{ width: `${pct}%`, height: h, borderRadius: "0 4px 4px 0", ...skin }} />}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function Ladder({
  rows, spot, mode, live = false, leg = "net",
}: {
  rows: ChangeRow[];
  spot: number | null;
  mode: Mode;
  /** Compare mode reading the LIVE chain — relabels only, the maths is identical. */
  live?: boolean;
  /** Which leg the server projected these rows through — a LABEL here, not a
      calculation. `netGex` already holds the chosen leg by the time it lands,
      so the ladder must not re-derive it; it only has to stop calling a call
      ladder "Net GEX". */
  leg?: Leg;
}) {
  // The ONE place the mode picks a number. Everything below — the bar, the
  // scale, the sign, the colour — reads `val`, so the two views cannot drift
  // into drawing one number and labelling it as the other.
  const cmp = mode === "compare";
  const val = (r: ChangeRow) => (mode === "levels" ? r.netGex : r.chg);
  // Compare draws two LEVELS per rung, so its scale has to cover both of them
  // rather than the (much smaller) Δ between them — otherwise every bar pegs.
  const max = rows.reduce(
    (m, r) => Math.max(m, cmp ? Math.max(Math.abs(r.prevNetGex), Math.abs(r.netGex)) : Math.abs(val(r))),
    0,
  ) || 1;
  // The rung price is actually sitting on — marked, not sorted to the middle.
  const spotStrike = spot == null || !rows.length
    ? null
    : rows.reduce((b, r) => (Math.abs(r.strike - spot) < Math.abs(b.strike - spot) ? r : b), rows[0]).strike;
  const desc = [...rows].sort((a, b) => b.strike - a.strike);

  // NO auto-scroll-to-spot. There used to be a useLayoutEffect here that parked
  // the spot rung in the middle of the ladder's own scrolling viewport, because
  // the ladder is ±40 strikes deep and sorted high→low — so scrollTop 0 opened
  // on the far upside wing. That viewport is gone: the ladder now renders full
  // length and the WINDOW scrolls. Recreating the behaviour would mean scrolling
  // the page, which would drag the card header, the split chips and the symbol
  // rail off-screen every time you arrowed to the next name. The cyan spot rung
  // is still marked, and the whole ladder is visible by scrolling normally.

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "grid", gridTemplateColumns: LADDER_COLS, gap: 8, alignItems: "center", paddingBottom: 5 }}>
        <span style={label}>Strike</span>
        <span style={{ ...label, textAlign: "center" }}>{live ? LIVE_COPY.axis : MODE_COPY[mode].axis}</span>
        <span style={{ ...label, textAlign: "right" }}>
          {live ? LIVE_COPY.ladderCol : MODE_COPY[mode].ladderCol}
          {leg !== "net" ? ` · ${LEG_COPY[leg].tab.toLowerCase()}` : ""}
        </span>
      </div>
      {desc.map((r) => {
        const v = val(r);
        const isSpot = spotStrike != null && r.strike === spotStrike;
        // Prior first so it sits ABOVE today — the rung reads top-to-bottom as
        // "was → is", which is the direction the tab name promises.
        const bars = cmp
          ? [{ v: r.prevNetGex, ghost: true }, { v: r.netGex }]
          : [{ v }];
        return (
          <div
            key={r.strike}
            title={`${r.strike} · ${live ? "live" : "now"} ${sgn(r.netGex)} · ${live ? "last close" : "prior"} ${sgn(r.prevNetGex)} · Δ ${sgn(r.chg)}${r.hadPrev ? "" : " (new strike — no prior row)"}`}
            style={{
              display: "grid", gridTemplateColumns: LADDER_COLS, gap: 8, alignItems: "center",
              padding: "2px 6px", borderRadius: 8,
              border: `1px solid ${isSpot ? T.cyan : "transparent"}`,
              background: isSpot ? "rgba(33,158,188,0.08)" : "transparent",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
              <span style={{ ...oneLine, fontFamily: MONO, fontSize: 12.5, fontWeight: isSpot ? 800 : 600, color: isSpot ? T.cyan : T.text }}>
                {r.strike.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </span>
              {isSpot && <span style={{ fontSize: 9, fontWeight: 800, color: T.cyan }}>◀</span>}
            </span>
            <RailBars items={bars} max={max} />
            <span style={{ ...oneLine, textAlign: "right", fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: col(v) }}>
              {sgn(v)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
const TOP_N = 5;
// THE CARD IS FULL LENGTH AND THE PAGE SCROLLS. Both panes used to be pinned to
// `max(340px, calc(100vh - 318px))` with the ladder scrolling INSIDE the card —
// so the ±40-rung ladder was read through a ~400px slot while the page itself
// never moved. Now the detail pane has no height at all: it renders all ~81
// rungs, the card grows to fit, and the browser scrolls the whole page.
//
// The rail is the one thing that CANNOT follow that rule — it is 169 names, far
// taller than any ladder, and letting it size the grid row would leave the card
// several screens of empty space below the last strike. So it keeps its own
// scroll and is sized BY the detail pane rather than by its own content: the
// wrapper is `position: relative` and contributes only RAIL_MIN_H of intrinsic
// height, and the rail inside it is `position: absolute; inset: 0`. Absolute
// means the rail's 169 rows are out of flow and cannot inflate the grid row, so
// the row height comes from the ladder and the rail fills exactly that. That is
// what keeps the two panes level without a magic pixel number.
const RAIL_MIN_H = 340;
// The series only changes once a day at 16:05 ET, so this is a courtesy refresh
// for a tab left open overnight — not a live poll. The ↻ button is the real
// refresh path.
const REFRESH_MS = 15 * 60_000;

export default function GexGrowth() {
  const [board, setBoard] = useState<BoardSymbol[] | null>(null);
  const [boardErr, setBoardErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [dir, setDir] = useState<"abs" | "built" | "pulled" | "struct">("abs");
  const [mode, setMode] = useState<Mode>("delta");
  // Which quantity the whole page is made of. Defaults to the legacy basis so
  // the page opens on the series it has always shown and a year of history.
  const [basis, setBasis] = useState<Basis>("oivol");
  // Which leg of it. Net is the reading every other surface prints.
  const [leg, setLeg] = useState<Leg>("net");
  // Live is a preference, not a mode — it survives tab-hopping and comes back
  // on when you return to `compare`, which is how a toggle should behave.
  const [live, setLive] = useState(false);
  // The Read panel. On by default: it is the reason to open a symbol, and a
  // reader who wants only bars can collapse it once.
  const [showRead, setShowRead] = useState(true);
  // Near-the-money band. Filters the LADDER and the mover ranking; never the
  // regime totals, the walls or the flip — see analyzeLadder.
  const [band, setBand] = useState<Band>(0);

  // Recorded sessions, newest first. "" = latest, which is what both routes do
  // with no date param — kept as the empty string rather than null so it drops
  // straight into a <select> value without a nullable branch.
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState("");

  const [detail, setDetail] = useState<ChangeResp | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  // Monotonic token — clicking down the rail faster than the network answers
  // must not let an earlier name's ladder land under a later name's header.
  const detailReq = useRef(0);

  // Session list. Loaded once — a new date only appears at 16:05 ET, and the ↻
  // button re-reads it along with everything else.
  // Basis-scoped: oi_/vol_/flow_ start at their migration date, so an
  // unfiltered list would offer a year of sessions that draw an empty ladder.
  const loadDates = useCallback(async () => {
    try {
      const res = await fetch(`/api/eod-strike-gex-dates?limit=180&basis=${basis}&leg=${leg}`, { cache: "no-store" });
      const json: DatesResp = await res.json();
      if (res.ok && json.ok !== false) setDates(json.dates ?? []);
    } catch { /* the picker just stays on "latest" — not worth an error banner */ }
  }, [basis, leg]);

  const dateQs = date ? `&date=${date}` : "";
  // One string for both dimensions, so no call site can pick up the basis and
  // forget the leg — that would draw a call ladder under a net header.
  const readQs = `&basis=${basis}&leg=${leg}`;

  // The one gate. Live only means anything on `compare` (it IS the prior→now
  // reading) and only against the LATEST session — "live vs the 8th" would be
  // a spread over however many sessions, not a day's build, so picking an older
  // date suspends it rather than silently redefining the number. The toggle
  // stays lit so returning to the latest session restores it.
  //
  // FLOW is the second gate. Live reads the chain, and the chain has no notion
  // of who lifted whom — the signed inventory only exists in the recorded
  // session's classified tape. So Live is not merely disabled on flow, it is
  // meaningless there, and the toggle is not rendered.
  const liveOn = live && mode === "compare" && !date && basis !== "flow";

  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch(`/api/eod-strike-gex-board?top=${TOP_N}${dateQs}${readQs}`, { cache: "no-store" });
      const json: BoardResp = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      setBoard(json.symbols ?? []);
      setBoardErr(null);
    } catch (e) {
      setBoardErr(String((e as Error)?.message || e));
    }
  }, [dateQs, readQs]);

  useEffect(() => { loadDates(); }, [loadDates]);

  /**
   * Switching basis OR leg clears the session pick.
   *
   * The picker is basis-scoped — `oi`, `vol` and `flow` only start at their
   * migration date, and `flow` only has sessions where SPX/SPY/QQQ actually
   * streamed. So a date that is perfectly valid on OI+Vol can be a session the
   * new basis has never heard of, and the AS-OF resolution would quietly answer
   * with whatever it does have. Falling back to "latest" makes the reset
   * visible in the control instead of silently redefining which day is on
   * screen.
   *
   * Both dimensions have their own migration date — the legs landed
   * 2026-08-18 and the bases 2026-08-19 — so `oivol/call` and `oivol/net` do
   * not offer the same sessions either.
   *
   * Deliberately NOT keyed on `dates`: that array reloads on every change here
   * and re-running this on it would stomp a pick the user just made.
   */
  const readRef = useRef<string>(readQs);
  useEffect(() => {
    if (readRef.current === readQs) return;
    readRef.current = readQs;
    setDate("");
  }, [readQs]);

  useEffect(() => {
    loadBoard();
    const id = setInterval(loadBoard, REFRESH_MS);
    return () => clearInterval(id);
  }, [loadBoard]);

  // `force` is the ↻ path and ONLY the ↻ path: it skips the server's per-symbol
  // minute cache. Rail clicks never force, so walking the board with Live on
  // costs one chain sweep per name per minute rather than one per click.
  const loadDetail = useCallback(async (symbol: string, force = false) => {
    const mine = ++detailReq.current;
    setDetailLoading(true);
    setDetailErr(null);
    try {
      const url = liveOn
        ? `/api/eod-strike-gex-live?symbol=${encodeURIComponent(symbol)}${force ? "&force=1" : ""}${readQs}`
        : `/api/eod-strike-gex-change?symbol=${encodeURIComponent(symbol)}${dateQs}${readQs}`;
      const res = await fetch(url, { cache: "no-store" });
      const json: ChangeResp = await res.json();
      if (detailReq.current !== mine) return;
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      setDetail(json);
    } catch (e) {
      if (detailReq.current === mine) { setDetail(null); setDetailErr(String((e as Error)?.message || e)); }
    } finally {
      if (detailReq.current === mine) setDetailLoading(false);
    }
    // liveOn belongs in here, not in a ref: flipping the toggle has to re-read
    // the open name, and keying the effect below on this identity is what makes
    // that happen without a second effect racing it. Same argument for readQs
    // — switching basis or leg MUST re-read the open ladder, or the pane would
    // keep drawing OI+Vol net rungs under an "OI only / calls" header.
  }, [dateQs, liveOn, readQs]);

  const pickDate = useCallback((d: string) => {
    setDate(d);
    // An older session is a LEVEL question — "what did the board look like on
    // the 8th" — so land there rather than on a Δ against the 7th. Coming back
    // to the newest session restores the Δ, which is what this page is for.
    // Either way the tabs stay live; this is a default, not a lock.
    setMode(d && d !== dates[0] ? "levels" : "delta");
  }, [dates]);

  // Changing the session — or flipping Live — re-reads the OPEN name's ladder,
  // so the rail and the detail pane can never be showing two different dates,
  // and the toggle can never leave a stale EOD ladder under a "live" header.
  //
  // Keyed on loadDetail — whose identity is keyed on the date — rather than on
  // `date` plus `sel`: adding `sel` would re-fetch on every rail click, which
  // pick() already does, and reading it through a ref keeps that out of the
  // dep list without lying to the linter about what the effect depends on.
  const selRef = useRef<string | null>(null);
  selRef.current = sel;
  useEffect(() => {
    const s = selRef.current;
    if (s) loadDetail(s);
  }, [loadDetail]);

  // The rail's two numbers, per mode. Signed drives the value column and the
  // built/pulled sorts; magnitude drives the "biggest" sort and the bar width.
  const railSigned = useCallback((s: BoardSymbol) => (mode === "levels" ? s.gexNet : s.net), [mode]);
  const railMag = useCallback((s: BoardSymbol) => (mode === "levels" ? s.gexAbs : s.absTot), [mode]);

  // Rail order + filter. Both rankings are computed server-side off the same
  // CTE; re-sorting here is a VIEW of those numbers, never a re-diff.
  const rail = useMemo(() => {
    const q = filter.trim().toUpperCase();
    let list = (board ?? []).filter((s) => !q || s.symbol.includes(q));
    if (dir === "built") list = [...list].sort((a, b) => railSigned(b) - railSigned(a));
    else if (dir === "pulled") list = [...list].sort((a, b) => railSigned(a) - railSigned(b));
    // The sort the |Δ| ranking is blind to. A name whose flip jumped seven
    // strikes on a modest dollar change is invisible in every other order here,
    // and it is exactly the name worth opening.
    else if (dir === "struct") list = [...list].sort((a, b) => (b.badge?.structScore ?? -1) - (a.badge?.structScore ?? -1));
    // The server's default order is |Δ|. Level mode wants |net GEX|, so "biggest"
    // has to re-sort rather than lean on the payload order.
    else if (mode === "levels") list = [...list].sort((a, b) => Math.abs(b.gexAbs) - Math.abs(a.gexAbs));
    return list;
  }, [board, filter, dir, mode, railSigned]);

  // Auto-select the top name once the board lands, so the detail pane is never
  // an empty box on first paint.
  useEffect(() => {
    if (sel == null && rail.length) { setSel(rail[0].symbol); loadDetail(rail[0].symbol); }
  }, [rail, sel, loadDetail]);

  const pick = useCallback((symbol: string) => { setSel(symbol); loadDetail(symbol); }, [loadDetail]);

  // ↑/↓ walks the rail. The whole point of master–detail is that you can review
  // the board without reaching for the mouse.
  const onRailKey = useCallback((e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = rail.findIndex((s) => s.symbol === sel);
    const next = e.key === "ArrowDown" ? Math.min(rail.length - 1, i + 1) : Math.max(0, i - 1);
    if (rail[next] && rail[next].symbol !== sel) pick(rail[next].symbol);
  }, [rail, sel, pick]);

  const maxAbs = rail.reduce((m, s) => Math.max(m, Math.abs(railMag(s))), 0) || 1;
  const selRow = rail.find((s) => s.symbol === sel) ?? null;
  const withBaseline = (board ?? []).filter((s) => s.prevDate).length;
  // Level mode needs no baseline, so a name on its first session is a real row
  // there and a "—" in Δ mode. One flag, read in both places that care.
  const railHasValue = (s: BoardSymbol) => mode === "levels" || !!s.prevDate;
  // Which strikes the top-N strip shows — the same ranking the rail sorted on.
  const topStrikes: Array<{ strike: number; v: number }> = selRow
    ? (mode === "levels"
      ? (selRow.gexStrikes ?? []).map((k) => ({ strike: k.strike, v: k.gex }))
      : (selRow.strikes ?? []).map((k) => ({ strike: k.strike, v: k.chg })))
    : [];
  const sessionLabel = date || dates[0] || "latest";

  // Is the ladder currently ON SCREEN a live one? Keyed off the PAYLOAD ALONE,
  // never off `liveOn`. Toggling refetches, so for the few hundred ms in
  // between, intent and data disagree — and every label on this pane describes
  // the DATA. `liveOn && detail.live` would caption a live ladder as end-of-day
  // the instant you toggled off, which is the worse of the two mislabels.
  const showLive = !!detail?.live;
  // The headline, in live mode, MUST come off the rows being drawn. The rail
  // row is the recorded close-to-close Δ; the ladder is close-to-now. They are
  // different numbers, and the old code took the big number from the rail — so
  // in live mode the header would have contradicted the bars underneath it.
  const liveNet = useMemo(
    () => (detail?.live && detail.prevDate && detail.rows?.length
      ? detail.rows.reduce((s, r) => s + r.chg, 0)
      : null),
    [detail],
  );
  const headlineVal = showLive ? liveNet : (selRow && railHasValue(selRow) ? railSigned(selRow) : null);
  // Same trap as the headline: `topStrikes` is the RECORDED top-N off the board
  // payload, so in live mode the "biggest …" chip has to be recomputed off the
  // live rows or it would name yesterday's strike beside today's number.
  const liveBiggest = useMemo(() => {
    if (!(detail?.live && detail.prevDate && detail.rows?.length)) return null;
    const b = detail.rows.reduce((m, r) => (Math.abs(r.chg) > Math.abs(m.chg) ? r : m), detail.rows[0]);
    return Math.abs(b.chg) > 0 ? { strike: b.strike, v: b.chg } : null;
  }, [detail]);

  // ── the read ──────────────────────────────────────────────────────────────
  // Derived from detail.rows, so it is the same data the ladder draws and can
  // never disagree with it. Works unchanged in live mode: the rows are live and
  // the caveat strip above already explains what that Δ means.
  const detailSpot = detail?.spot ?? null;
  const hasPrior = !!detail?.prevDate;
  const analysis = useMemo(
    () => (detail?.rows?.length
      ? analyzeLadder(detail.rows, detailSpot, band, hasPrior, !!detail.hasLegs, !!detail.hasPrevLegs)
      : null),
    [detail, detailSpot, band, hasPrior],
  );
  // Legs exist on today's side but not on the baseline's — the pre-migration
  // case. Distinct from "no legs at all", which is just an older payload shape.
  const legsMissing = !!detail?.rows?.length && (!detail.hasLegs || (hasPrior && !detail.hasPrevLegs));
  // The band applies to what the ladder DRAWS. Kept separate from the analysis
  // so narrowing the band can never move the regime number above it.
  const ladderRows = useMemo(() => {
    const rows = detail?.rows ?? [];
    if (!band || detailSpot == null) return rows;
    return rows.filter((r) => Math.abs(r.strike / detailSpot - 1) * 100 <= band);
  }, [detail, band, detailSpot]);

  // Compare mode's headline. Read off the DETAIL rows, not the rail row — the
  // board payload carries only `chg` per strike and this needs both levels.
  const split = useMemo(
    () => (mode === "compare" && detail?.rows?.length && detail.prevDate ? splitChange(detail.rows) : null),
    [mode, detail],
  );
  // Labelled so the sign on the value is never a surprise: "built" always adds
  // magnitude on its own side, "pulled" always removes it.
  /**
   * FLOW GROSS SPLIT — what the net dealer position at these strikes was made
   * of, summed over the ladder in view.
   *
   * The problem it solves is one level below the basis split. `flow_call_gex`
   * is a net of two opposite events: gamma the dealer took ON (the public sold
   * calls to them) and gamma they took OFF (the public bought). A strike where
   * they did 5,000 of each nets to zero and reads identically to a strike
   * nothing traded at — the same "a red bar has two stories" ambiguity that
   * compare mode exists to fix, reappearing inside a single session.
   *
   * The four values sum EXACTLY to the net level, because the server rolls the
   * legs up FROM these components rather than computing them separately.
   *
   * Summed over `ladderRows`, so the ±% band filter applies here as it does to
   * the ladder under it — these describe what is on screen.
   */
  const grossChips: Array<{ k: string; v: number; t: string }> = useMemo(() => {
    if (basis !== "flow" || !detail?.hasGross || !ladderRows.length) return [];
    const sum = (f: (r: ChangeRow) => number | null | undefined) =>
      ladderRows.reduce((t, r) => t + (f(r) ?? 0), 0);
    return [
      { k: "calls sold to dealer", v: sum((r) => r.callBuyGex), t: "The public SOLD calls; the dealer is long that gamma. Positive." },
      { k: "calls bought from dealer", v: sum((r) => r.callSellGex), t: "The public BOUGHT calls; the dealer is short that gamma. Negative." },
      { k: "puts sold to dealer", v: sum((r) => r.putBuyGex), t: "The public SOLD puts; the dealer is long that gamma. Positive." },
      { k: "puts bought from dealer", v: sum((r) => r.putSellGex), t: "The public BOUGHT puts; the dealer is short that gamma. Negative." },
    ];
  }, [basis, detail, ladderRows]);

  /**
   * TURNOVER vs NET, the number the gross split exists to expose. 1 means every
   * contract went one way; near 0 means the dealer took size on both sides and
   * ended up flat. A net of ~0 with a low ratio is a BUSY strike, not a quiet
   * one, and nothing else on this page can tell you that.
   */
  const grossRatio = useMemo(() => {
    if (!grossChips.length) return null;
    const gross = grossChips.reduce((t, c) => t + Math.abs(c.v), 0);
    if (!gross) return null;
    return Math.abs(grossChips.reduce((t, c) => t + c.v, 0)) / gross;
  }, [grossChips]);

  const splitChips: Array<{ k: string; v: number; t: string }> = split
    ? [
      { k: "+γ built", v: split.posBuilt, t: "Positive (call-dominant) gamma ADDED — net GEX up" },
      { k: "+γ pulled", v: split.posPulled, t: "Positive gamma TAKEN OFF — net GEX down without any new put gamma" },
      { k: "−γ built", v: split.negBuilt, t: "Negative (put-dominant) gamma PILED ON — net GEX down" },
      { k: "−γ pulled", v: split.negPulled, t: "Negative gamma COVERED — net GEX up" },
    ]
    : [];

  return (
    <PageShell>
      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title="ΔGEX Board"
        subtitle="Per-strike dealer gamma at the close, or what was built and taken off — whole board ex-0DTE, scanner watchlist. Recorded 16:05 ET with the open-interest half re-stamped from the settled file at 09:25, ~400 sessions on file. Pick a basis: what the number is made of decides what its Δ can honestly mean."
      >
        {/* Controls: one row above the data, per the house pattern. */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value.toUpperCase())}
            placeholder="Filter symbol…"
            aria-label="Filter symbol"
            style={{
              background: T.panelInset, border: `1px solid ${T.border}`, borderRadius: 10,
              padding: "7px 11px", color: T.text, fontFamily: MONO, fontSize: 13, width: 150,
            }}
          />
          {(["abs", "built", "pulled", "struct"] as const).map((k, i) => (
            <button key={k} onClick={() => setDir(k)} style={dir === k ? homeButtonStyle : homeSecondaryButtonStyle}>
              {MODE_COPY[mode].sorts[i]}
            </button>
          ))}

          {/* BASIS picker — which NUMBER, as opposed to which reading of it.
              Unlike the mode tabs below, switching this DOES re-fetch: the
              four bases are four different columns in the table, not four
              views of one payload. */}
          <span style={{ display: "flex", gap: 4, border: `1px solid ${T.border}`, borderRadius: 999, padding: 3 }}>
            {BASES.map((b) => (
              <button
                key={b}
                onClick={() => setBasis(b)}
                aria-pressed={basis === b}
                title={`${BASIS_COPY[b].name} — ${BASIS_COPY[b].unit}. ${BASIS_COPY[b].caveat}`}
                style={{
                  ...(basis === b ? homeButtonStyle : homeSecondaryButtonStyle),
                  borderRadius: 999, padding: "5px 12px",
                  border: basis === b ? undefined : "1px solid transparent",
                  background: basis === b ? undefined : "transparent",
                }}
              >
                {BASIS_COPY[b].tab}
              </button>
            ))}
          </span>

          {/* LEG picker — which half of the basis. Also re-fetches: the rail
              has to rank on the same column the ladder draws, or clicking the
              top name on a call board would open a ladder ordered by
              something else. */}
          <span style={{ display: "flex", gap: 4, border: `1px solid ${T.border}`, borderRadius: 999, padding: 3 }}>
            {LEGS.map((l) => (
              <button
                key={l}
                onClick={() => setLeg(l)}
                aria-pressed={leg === l}
                title={LEG_COPY[l].hint(basis)}
                style={{
                  ...(leg === l ? homeButtonStyle : homeSecondaryButtonStyle),
                  borderRadius: 999, padding: "5px 12px",
                  border: leg === l ? undefined : "1px solid transparent",
                  background: leg === l ? undefined : "transparent",
                }}
              >
                {LEG_COPY[l].tab}
              </button>
            ))}
          </span>

          {/* Mode tabs. Both readings are already in the payload, so this is a
              re-render — switching never re-fetches and never re-diffs. */}
          <span style={{ display: "flex", gap: 4, border: `1px solid ${T.border}`, borderRadius: 999, padding: 3 }}>
            {(["levels", "delta", "compare"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                title={m === "levels"
                  ? "Net GEX as that session closed"
                  : m === "delta"
                    ? "That session minus the one before it"
                    : "Prior and current level on the same rung — tells apart +γ taken off from −γ piled on, which a single Δ bar cannot"}
                style={{
                  ...(mode === m ? homeButtonStyle : homeSecondaryButtonStyle),
                  borderRadius: 999, padding: "5px 12px", border: mode === m ? undefined : "1px solid transparent",
                  background: mode === m ? undefined : "transparent",
                }}
              >
                {MODE_COPY[m].tab}
              </button>
            ))}
          </span>

          {/* Session picker. Populated from the rows that actually exist, so a
              holiday or a failed sweep is simply not in the list. */}
          <ThemedSelect
            value={date}
            onChange={pickDate}
            width={168}
            ariaLabel="Session date"
            options={[
              { value: "", label: dates.length ? `Latest · ${dates[0]}` : "Latest" },
              ...dates.slice(1).map((d) => ({ value: d, label: d })),
            ]}
          />

          {/* Live toggle — compare only, because live IS the prior→now reading.
              Rendered only on that tab rather than disabled everywhere, so the
              control row does not carry a permanently dead button.

              Also hidden on the FLOW basis, and hidden rather than disabled:
              signed dealer inventory is reconstructed from the recorded
              session's classified tape, so there is no "live" version of it to
              offer. A greyed-out button would imply one exists. */}
          {mode === "compare" && basis !== "flow" && (
            <button
              onClick={() => setLive((v) => !v)}
              aria-pressed={liveOn}
              title={date
                ? "Live compares against the LATEST close only — clear the date picker to use it"
                : liveOn
                  ? "Reading the chain now. Δ is today's tape building on last night's settled OI, not a session-over-session change. ↻ forces a fresh sweep."
                  : "Replace the 'now' side with the chain as it stands right now, against this symbol's last recorded close. One symbol, a few seconds per name."}
              style={{
                ...(liveOn ? homeButtonStyle : homeSecondaryButtonStyle),
                borderRadius: 999, padding: "5px 12px",
                display: "flex", alignItems: "center", gap: 6,
                opacity: date ? 0.45 : 1,
              }}
            >
              <span aria-hidden style={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                background: liveOn ? POS : T.textMuted,
              }} />
              Live
            </button>
          )}

          {/* Near-the-money band. A reading aid over rows already in hand — no
              fetch, and explicitly NOT applied to the regime/wall/flip figures,
              which are properties of the whole book. */}
          <span style={{ display: "flex", gap: 4, border: `1px solid ${T.border}`, borderRadius: 999, padding: 3 }}>
            {([0, 5, 3] as const).map((b) => (
              <button
                key={b}
                onClick={() => setBand(b)}
                aria-pressed={band === b}
                title={b === 0
                  ? "Draw the whole recorded window (±40 strikes)"
                  : `Draw and rank only strikes within ±${b}% of spot — the regime, walls and flip still use the whole ladder`}
                style={{
                  ...(band === b ? homeButtonStyle : homeSecondaryButtonStyle),
                  borderRadius: 999, padding: "5px 11px",
                  border: band === b ? undefined : "1px solid transparent",
                  background: band === b ? undefined : "transparent",
                }}
              >
                {b === 0 ? "All" : `±${b}%`}
              </button>
            ))}
          </span>

          <button
            onClick={() => setShowRead((v) => !v)}
            aria-pressed={showRead}
            title="Regime, walls, gamma flip and the ranked movers — all computed from the ladder below"
            style={{ ...(showRead ? homeButtonStyle : homeSecondaryButtonStyle), borderRadius: 999, padding: "5px 12px" }}
          >
            Read
          </button>

          {/* ↻ re-reads the recorded board, and when Live is on also forces a
              fresh chain sweep for the OPEN name — the cache is a minute deep,
              so without force=1 this button would look broken. */}
          <button
            onClick={() => { loadDates(); loadBoard(); if (liveOn && sel) loadDetail(sel, true); }}
            style={homeSecondaryButtonStyle}
            title={liveOn ? "Re-read the recorded board and force a fresh live sweep for this symbol" : "Re-read the recorded board"}
          >↻</button>
          <span style={{ ...label, marginLeft: "auto" }}>
            {board == null
              ? "loading…"
              : mode === "levels"
                ? `${rail.length} symbol${rail.length === 1 ? "" : "s"} · close ${sessionLabel}`
                : `${rail.length} symbol${rail.length === 1 ? "" : "s"} · ${withBaseline} with a baseline`}
          </span>
        </div>

        {/* WHAT THIS NUMBER IS, ON SCREEN. Not a tooltip: three of the four
            bases are wrong to read as a plain day-over-day change and the
            fourth covers three symbols, so the caveat has to be as visible as
            the bars. The strip turns amber on a Δ tab whose basis cannot
            honestly be differenced — that is the specific mistake this whole
            change exists to stop someone making. */}
        <div
          style={{
            display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap",
            marginBottom: 10, padding: "7px 11px", borderRadius: 10,
            background: T.panelInset,
            // T.gold is this file's established "warn" colour (see toneColor);
            // the 73 suffix is the same hex-alpha idiom toneChip uses rather
            // than a second, differently-expressed amber.
            border: `1px solid ${isDelta(mode) && !BASIS_COPY[basis].deltaHonest ? `${T.gold}73` : T.border}`,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 800, color: LIGHT_BLUE, flexShrink: 0 }}>
            {BASIS_COPY[basis].name}
            {leg !== "net" ? ` · ${LEG_COPY[leg].name}` : ""}
          </span>
          <span style={{ fontSize: 11, fontFamily: MONO, color: T.textMuted, flexShrink: 0 }}>
            {BASIS_COPY[basis].unit}
          </span>
          <span style={{ fontSize: 11.5, color: T.text, minWidth: 180, flex: 1 }}>
            {BASIS_COPY[basis].caveat}
            {/* The one-sidedness warning. On the three unsigned bases a single
                leg cannot change sign, so a reader who arrives expecting a
                flip or a wall will not find one — and the absence is a
                property of the arithmetic, not of the book. */}
            {!legIsSigned(basis, leg) ? (
              <>
                {" "}
                <strong>{LEG_COPY[leg].tab} on this basis are one-sided</strong>{" "}
                ({leg === "call" ? "always ≥ 0" : "always ≤ 0"}) — there is no flip or crossing to read in this ladder. The badges beside each symbol still describe the whole book.
              </>
            ) : null}
          </span>
          {/* Settled-OI provenance. Only meaningful on `oi`, and it is the flag
              that says whether the Δ on screen is a real ΔOI or two
              provisional reads subtracted. */}
          {basis === "oi" && detail && (
            <span
              title={detail.oiSettled && detail.prevOiSettled
                ? "Both sessions were re-stamped from the settled OCC file, so this Δ is a true session-over-session change in open interest."
                : "At least one side is still the provisional 16:05 read — its open interest is the file settled through the session BEFORE it, so this Δ is lagged. The 09:25 pass fills it in."}
              style={{
                ...toneChip(detail.oiSettled && detail.prevOiSettled ? "pos" : "warn"),
                fontSize: 10, fontWeight: 800, padding: "2px 7px", flexShrink: 0,
              }}
            >
              {detail.oiSettled && detail.prevOiSettled ? "SETTLED" : "PROVISIONAL"}
            </span>
          )}
        </div>

        {boardErr ? (
          <div style={{ color: NEG, fontSize: 13, fontFamily: MONO }}>Board failed: {boardErr}</div>
        ) : board != null && board.length === 0 ? (
          <div style={{ color: T.text, fontSize: 13 }}>
            {/* The three new bases start at their migration date and `flow`
                only ever covers a handful of names, so "nothing here" is a
                routine and EXPECTED state for them — worth explaining rather
                than reading as a broken page. */}
            {basis === "flow"
              ? "No flow recorded yet. This basis needs classified prints in flow_prints, which only SPX, SPY and QQQ stream — and only for sessions since the flow basis shipped."
              : basis !== "oivol"
                ? `No sessions recorded on this basis yet${date ? ` on or before ${date}` : ""}. The ${BASIS_COPY[basis].tab} columns start at the migration date; earlier sessions only have OI + Vol and cannot be split after the fact.`
                : date
                  ? `Nothing recorded on or before ${date}. Pick a later session.`
                  : "No end-of-day snapshots recorded yet. The first sweep runs at 16:05 ET; the Δ column needs a second session before it can say anything."}
          </div>
        ) : (
          <div className="gexgrowth-split" style={{ display: "grid", gridTemplateColumns: "268px 1fr", gap: 14, alignItems: "stretch" }}>

            {/* ── rail ───────────────────────────────────────────────── */}
            {/* Wrapper carries only the floor height; the rail itself is out of
                flow (see RAIL_MIN_H) so 169 names cannot stretch the grid row
                past the ladder. `min-height` not `height`, so a short ladder
                still gets a usable rail instead of a 40px sliver. */}
            <div className="gexgrowth-rail-wrap" style={{ position: "relative", minHeight: RAIL_MIN_H }}>
              <div
                tabIndex={0}
                onKeyDown={onRailKey}
                aria-label={mode === "levels" ? "Symbols ranked by absolute net GEX" : "Symbols ranked by absolute ΔGEX"}
                style={{
                  position: "absolute", inset: 0,
                  border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden",
                  overflowY: "auto", outline: "none",
                }}
              >
              {rail.map((s) => {
                const on = s.symbol === sel;
                return (
                  <div
                    key={s.symbol}
                    onClick={() => pick(s.symbol)}
                    title={mode === "levels"
                      ? `${s.symbol} · net GEX at close ${s.date}`
                      : s.prevDate
                        ? `${s.symbol} · ${s.date} vs ${s.prevDate}`
                        : `${s.symbol} · one snapshot only (${s.date}) — no baseline yet`}
                    style={{
                      display: "grid", gridTemplateColumns: "1fr auto 62px", gap: 7, alignItems: "center",
                      padding: "8px 10px", cursor: "pointer",
                      borderBottom: `1px solid rgba(255,255,255,0.05)`,
                      background: on ? "rgba(125,211,252,0.12)" : "transparent",
                      boxShadow: on ? `inset 2px 0 0 ${LIGHT_BLUE}` : "none",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                      {/* flexShrink 0: adding the badge column started clipping
                          tickers to "S..". The symbol is the row's identity —
                          the BAR gives up width, never the name. */}
                      <span style={{ fontSize: 13, fontWeight: 800, flexShrink: 0 }}>{s.symbol}</span>
                      {/* Magnitude bar — the summed ABSOLUTE of whichever
                          reading is showing, so a name that churned hard both
                          ways still reads as busy even when its net is ~0. */}
                      <span style={{
                        height: 5, borderRadius: 3, background: LIGHT_BLUE, minWidth: 0,
                        width: Math.max(6, (Math.abs(railMag(s)) / maxAbs) * 84),
                        opacity: railHasValue(s) ? 1 : 0.25,
                      }} />
                    </span>
                    {/* Structural badge. Empty span (not omitted) so the three
                        columns stay aligned down the rail whether or not a
                        given name has one. */}
                    {(() => {
                      const bd = railBadge(s.badge ?? null, s.spot);
                      return bd ? (
                        <span title={bd.title} style={{ ...toneChip(bd.tone), fontSize: 8.5, padding: "1px 6px" }}>{bd.text}</span>
                      ) : <span />;
                    })()}
                    <span style={{ ...oneLine, textAlign: "right", fontFamily: MONO, fontSize: 11.5, fontWeight: 700, color: railHasValue(s) ? col(railSigned(s)) : T.textMuted }}>
                      {railHasValue(s) ? sgn(railSigned(s)) : "—"}
                    </span>
                  </div>
                );
              })}
              {rail.length === 0 && (
                <div style={{ padding: 12, fontSize: 12, color: T.text }}>No symbol matches that filter.</div>
              )}
              </div>
            </div>

            {/* ── detail ─────────────────────────────────────────────── */}
            {/* No height and no inner scroller — this pane is what SIZES the
                grid row. It renders the header, the big number, the strip and
                the full ladder at natural height, the card grows to fit, and
                the page scrolls. */}
            <div style={{
              border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, background: T.panelBg,
              minWidth: 0, display: "flex", flexDirection: "column",
            }}>
              {sel == null ? (
                <div style={{ fontSize: 13, color: T.text }}>Pick a symbol.</div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 20, fontWeight: 800 }}>{sel}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11.5, color: T.text }}>
                      {detail?.spot != null ? `spot ${detail.spot.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : ""}
                      {showLive
                        // Live says WHEN, not which session — the "as of" stamp
                        // is the only thing that dates this reading, and the
                        // server's own asOf is used rather than a client clock
                        // so a cached payload stamps when it was SWEPT.
                        ? (detail?.prevDate
                          ? ` · live ${fmtEtTime(detail.asOf)} ET vs close ${detail.prevDate}`
                          : " · live · no recorded close yet")
                        : mode === "levels"
                          ? (detail?.date ? ` · close ${detail.date}` : "")
                          : detail?.prevDate ? ` · ${detail.date} vs close ${detail.prevDate}` : detail?.date ? ` · ${detail.date} · no baseline yet` : ""}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "3px 0 6px", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 800, color: headlineVal != null ? col(headlineVal) : T.text }}>
                      {headlineVal != null ? sgn(headlineVal) : "—"}
                    </span>
                    <span style={label}>{showLive ? LIVE_COPY.bigLabel : MODE_COPY[mode].bigLabel}</span>
                    {showLive ? (liveBiggest ? (
                      <span style={{ ...label, marginLeft: 10 }}>
                        biggest {liveBiggest.strike} · {sgn(liveBiggest.v)}
                      </span>
                    ) : null) : topStrikes.length ? (
                      <span style={{ ...label, marginLeft: 10 }}>
                        biggest {topStrikes[0].strike} · {sgn(topStrikes[0].v)}
                      </span>
                    ) : null}
                    {showLive && detail?.cached ? (
                      <span
                        style={{ ...label, marginLeft: 6 }}
                        title="Served from the server's one-minute cache. ↻ forces a fresh sweep."
                      >cached {Math.round((detail.ageMs ?? 0) / 1000)}s</span>
                    ) : null}
                  </div>

                  {/* The live caveat, on the page and not only in a tooltip.
                      This Δ is NOT the other tabs' Δ: OI is last night's
                      settled file and volume accrues from 09:30, so it opens
                      near zero and grows into the bell. A reader who takes it
                      for a session-over-session change reads every morning as
                      "nothing happening". */}
                  {showLive ? (
                    // Dashboard card language — classicCardStyle, the same
                    // surface every other card on the site uses. NO accent
                    // edge: an accent stripe here read as a warning banner,
                    // and this is explanatory chrome, not an alert.
                    <div style={{
                      ...classicCardStyle,
                      display: "flex", alignItems: "flex-start", gap: 8,
                      padding: "8px 12px", margin: "0 0 10px",
                      fontSize: 11.5, lineHeight: 1.45, color: T.text,
                    }}>
                      <span>
                        {detail?.prevIsToday
                          ? <>Today&apos;s 16:05 sweep has already landed, so the outline IS today&apos;s close — this Δ is post-close chain drift, not a session&apos;s build.</>
                          : detail?.marketDay === false
                            ? <>Market closed today. The live chain is the last state it settled in, so this reads as the gap since the last recorded close rather than a session in progress.</>
                            : <>Fill is the chain <strong>right now</strong>, outline is the {detail?.prevDate} close. OI is last night&apos;s settled file and volume accrues from 09:30, so this Δ is <strong>today&apos;s tape building</strong> — near zero at the open, growing into the bell. It is not the session-over-session Δ the other tabs show.</>}
                      </span>
                    </div>
                  ) : null}

                  {/* THE READ. Sits between the headline and the ladder because
                      it is the answer and the ladder is the evidence. Every
                      figure in it comes from analyzeLadder() over detail.rows —
                      the same array the ladder draws — so the two can never
                      disagree. Hidden when there are no rows to read. */}
                  {showRead && analysis ? (
                    <ReadPanel
                      a={analysis} mode={mode} hasPrior={hasPrior} live={showLive}
                      symbol={sel} zeroDte={detail?.zeroDte ?? null} legsMissing={legsMissing}
                    />
                  ) : null}

                  {/* Compare replaces the top-N strip with the four-way split —
                      same vertical cost, and it is the whole reason the tab
                      exists. The four values sum EXACTLY back to the net Δ
                      above them (see splitChange), so this strip and the big
                      number can never disagree — including in live mode, where
                      both are computed off the same live rows. */}
                  {splitChips.length ? (
                    <div
                      title={showLive
                        ? "The four ways this Δ can be produced. They sum exactly to the net Δ above."
                        : "The four ways a session's net Δ can be produced. They sum exactly to the net Δ above."}
                      style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "0 0 12px" }}
                    >
                      {splitChips.map((c) => (
                        <span key={c.k} title={c.t} style={{
                          display: "flex", alignItems: "baseline", gap: 6,
                          border: `1px solid ${T.border}`, borderRadius: 999, padding: "3px 10px",
                          fontFamily: MONO, fontSize: 11.5,
                        }}>
                          <span style={{ color: T.text }}>{c.k}</span>
                          <span style={{ fontWeight: 700, color: col(c.v) }}>{sgn(c.v)}</span>
                        </span>
                      ))}
                    </div>
                  ) : topStrikes.length ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "0 0 12px" }}>
                      {topStrikes.map((k) => (
                        <span key={k.strike} style={{
                          display: "flex", alignItems: "baseline", gap: 6,
                          border: `1px solid ${T.border}`, borderRadius: 999, padding: "3px 10px",
                          fontFamily: MONO, fontSize: 11.5,
                        }}>
                          <span style={{ color: T.text }}>{k.strike}</span>
                          <span style={{ fontWeight: 700, color: col(k.v) }}>{sgn(k.v)}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {/* FLOW GROSS — rendered in addition to the strip above, not
                      instead of it, because it answers a different question:
                      that one is "how did the net change", this one is "what
                      was the net made of". Only on the flow basis, and only
                      when the session actually has the components. */}
                  {grossChips.length ? (
                    <div style={{ margin: "0 0 12px" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ ...label, flexShrink: 0 }}>dealer took on</span>
                        {grossChips.map((c) => (
                          <span key={c.k} title={c.t} style={{
                            display: "flex", alignItems: "baseline", gap: 6,
                            border: `1px solid ${T.border}`, borderRadius: 999, padding: "3px 10px",
                            fontFamily: MONO, fontSize: 11.5,
                          }}>
                            <span style={{ color: T.text }}>{c.k}</span>
                            <span style={{ fontWeight: 700, color: col(c.v) }}>{sgn(c.v)}</span>
                          </span>
                        ))}
                      </div>
                      {grossRatio != null ? (
                        <div
                          title="Net ÷ gross. Near 1, the flow went one way and the net tells the whole story. Near 0, the dealer took size on BOTH sides and ended up flat — a busy strike that a net-only ladder draws as a quiet one."
                          style={{ ...label, marginTop: 5 }}
                        >
                          {(grossRatio * 100).toFixed(0)}% directional
                          {grossRatio < 0.25
                            ? " — two-way flow, the net is hiding real size on both sides"
                            : grossRatio > 0.75
                              ? " — one-way flow, the net is the whole story"
                              : ""}
                        </div>
                      ) : null}
                    </div>
                  ) : basis === "flow" && detail?.hasBasis && detail.hasGross === false ? (
                    // Recorded before the gross columns shipped. The net ladder
                    // below is real; only the decomposition is missing, and
                    // saying so beats silently omitting the row.
                    <div style={{ ...label, margin: "0 0 12px" }}>
                      This session predates the gross split — the net flow ladder below is real, but what it was made of was not recorded.
                    </div>
                  ) : null}

                  {detailErr ? (
                    <div style={{ color: NEG, fontSize: 13, fontFamily: MONO }}>Ladder failed: {detailErr}</div>
                  ) : detailLoading && !detail ? (
                    <div style={{ fontSize: 13, color: T.text }}>Reading ladder…</div>
                  ) : detail && detail.hasBasis === false ? (
                    // CHECKED BEFORE every other empty case. The server
                    // COALESCEs a missing basis to 0, so an unrecorded ladder
                    // and a genuinely flat one are pixel-identical — and the
                    // difference is the whole point. Without this branch, "we
                    // never recorded flow for this name" would render as "this
                    // name had no dealer flow", which is a claim we cannot make.
                    <div style={{ fontSize: 13, color: T.text }}>
                      No <strong>{BASIS_COPY[basis].tab}</strong> data recorded for {sel}
                      {detail.date ? ` on ${detail.date}` : ""}.
                      {basis === "flow"
                        ? " Flow is only recorded for the names that stream into the tape — SPX, SPY and QQQ."
                        : " Sessions before the migration only have the combined OI + Vol number, and it cannot be split after the fact."}
                      {" "}This is an absence of data, not a reading of zero.
                    </div>
                  ) : showLive && detail && !detail.prevDate ? (
                    // Live has a DIFFERENT no-baseline story from the EOD tabs:
                    // the live side is fine, it is the recorded close that has
                    // never been written. Saying "one snapshot on file" here
                    // would point at the wrong missing thing.
                    <div style={{ fontSize: 13, color: T.text }}>
                      No recorded close on file for {sel} yet, so there is nothing to compare the live chain against.
                      {" "}The first snapshot lands at the next 16:05 ET sweep.
                    </div>
                  ) : isDelta(mode) && detail && detail.date && !detail.prevDate ? (
                    // Checked BEFORE the empty-rows case: a symbol on its first
                    // session has rows but no baseline, and "no recorded
                    // strikes" would be the wrong answer to why it looks blank.
                    // Δ mode only — the LEVEL ladder is perfectly readable with
                    // one snapshot on file, so gating it here would hide real
                    // data behind a message about a diff nobody asked for.
                    <div style={{ fontSize: 13, color: T.text }}>
                      One snapshot on file ({detail.date}). The Δ needs a second session — it lands after the next 16:05 ET sweep.
                      {" "}Switch to <strong>Net GEX</strong> to read this one on its own.
                    </div>
                  ) : !detail?.rows?.length ? (
                    <div style={{ fontSize: 13, color: T.text }}>No recorded strikes for {sel}.</div>
                  ) : (
                    // No flex:1, no overflow — the ladder renders every rung at
                    // natural height and this pane grows with it. The old
                    // flex:1 + minHeight:0 + overflowY:auto was what trapped the
                    // ladder in a ~400px slot inside a fixed-height card.
                    <div style={{ opacity: detailLoading ? 0.55 : 1, transition: "opacity .12s" }}>
                      <Ladder rows={ladderRows} spot={detail.spot ?? null} mode={mode} live={showLive} leg={leg} />
                      {band && ladderRows.length < (detail.rows?.length ?? 0) ? (
                        // Never truncate silently: a reader who forgot the band
                        // is on would read a missing wall as a wall that left.
                        <div style={{ ...label, marginTop: 8 }}>
                          showing {ladderRows.length} of {detail.rows?.length} strikes · ±{band}% band
                        </div>
                      ) : null}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div style={{ ...label, marginTop: 12 }}>
          OI+Vol basis · whole board excl. 0DTE · ±40 strikes around the close ·
          {mode === "levels"
            ? " net GEX as each symbol's session closed"
            : mode === "compare"
              ? (showLive
                ? " outline = last recorded close, fill = the chain now · rail stays end-of-day · one symbol per live read, cached 60s"
                : " outline = prior close, fill = current close · the four chips sum to the net Δ")
              : " each symbol diffed against its own two most recent snapshots"}
          {date ? ` · as of ${date}` : ""}
        </div>
      </Card>

      <style>{`
        @media (max-width: 860px) {
          .gexgrowth-split { grid-template-columns: 1fr !important; }
          /* Stacked, the rail's absolute-fill trick has nothing to size against
             — the ladder is no longer beside it, it is below it — so a 169-name
             list would push the ladder a full screen down. Give the rail back a
             capped height of its own and let it scroll there. The detail pane is
             untouched and still renders full length. */
          .gexgrowth-rail-wrap { min-height: 0 !important; height: 46vh; }
        }
      `}</style>
    </PageShell>
  );
}
