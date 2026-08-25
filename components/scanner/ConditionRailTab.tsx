"use client";

/**
 * components/scanner/ConditionRailTab.tsx
 *
 * "Condition Rail" — the Stat Prompter turned inside out.
 *
 * Stat Prompter asks 31 fixed questions. This asks ONE question over an
 * arbitrary cohort: you tick what has actually happened in the session so far
 * and it re-reads the whole IB book for exactly that combination.
 *
 * Three rules the rail enforces, and the reason each exists:
 *
 *   1. MUTUAL EXCLUSION. An IB cannot be narrow AND wide; a session that never
 *      broke has no break time. Criteria that cannot coexist with what is
 *      already picked are struck through and unclickable — see `ex` (radio
 *      group: picking one swaps its siblings out) and `con` (hard conflict:
 *      those ids go dead while this is picked). A combination the book has
 *      zero sessions for is dead too, for the same reason: it describes a day
 *      that has never happened.
 *
 *   2. TODAY IS MARKED, NOT ASSUMED. Every criterion knows how to test itself
 *      against today's live IB (`today(t, nowMin)`), returning true / false /
 *      null-for-not-knowable-yet. True ones carry a ● TODAY mark, undecided
 *      ones a ○ PENDING mark. "Match today" selects the true set in one click.
 *      Nothing is auto-included that the tape has not confirmed.
 *
 *   3. THE HONESTY RULES FROM StatPrompterTab CARRY OVER. Sample size is never
 *      printed as a number; it still governs (THIN under 30, CHECK FOR BIAS
 *      over 85%). No lookahead — every SlimDay field was stamped at its own
 *      confirm bar and this file only counts and divides.
 *
 * SESSION PICKER (the "Session" dropdown, 2026-08-24). The rail can be pointed
 * at a PAST session instead of the live tape. Two things change when it is, and
 * both are the point of the feature rather than side effects:
 *
 *   • The rail is seeded from that day's OWN classification — every criterion
 *     answered by `c.f(day)` off the stored SlimDay, so nothing is PENDING: the
 *     session is over, the book already knows what it was.
 *   • The book is cut to sessions STRICTLY BEFORE that date. Reading back a
 *     Tuesday against a book that contains that Tuesday and everything after it
 *     is not "what the stats were" — it is hindsight wearing the same number.
 *     `since` still applies on top, so the window is [since, selected date).
 *
 * The selected day's ACTUAL outcome is printed next to the rate it was quoted,
 * which is the only honest way to show a past read: the number it gave, and
 * what the session then did.
 *
 * RELAXED SEEDING (2026-08-25). A closed session classifies on eight or nine
 * criteria at once and the book has never seen a day matching all nine, so the
 * seeded cohort came back empty — every rate "—", "No sessions match", and a
 * rail struck out end to end because `wouldBeEmpty` is true of every chip once
 * the selection already matches nothing. `relaxToBook()` now drops criteria in
 * a fixed order until the book holds a matching session, names what came off,
 * and leaves it one click to put back; the empty-combination strike is skipped
 * while the cohort is empty, so the rail can never lock itself again.
 *
 * NO OUTCOME PICKER (2026-08-25). There used to be an "Outcome" dropdown and it
 * was backwards: it made you name the outcome you cared about BEFORE the page
 * had shown you a single number, which is asking you to guess which one the
 * cohort actually moved. Every outcome is measured every time — they were all
 * on screen in the compare rows anyway — and the headline is now chosen: the
 * outcome whose rate sits furthest from its rate in the unconditional book.
 * That gap is the read; a rate sitting on its baseline is the cohort saying it
 * changed nothing. Any row can be clicked to pin it, and clicking the pinned
 * one hands the choice back.
 *
 * PER-CRITERION READ. The headline prices the whole stack. The "Each criterion
 * on its own" card prices each pick two ways — ALONE against the unconditional
 * book, and WITHOUT IT against the rest of the stack — so a thin cohort still
 * says which condition is carrying the number and which is only narrowing it.
 *
 * Data: public/data/ib-ES.json + ib-NQ.json (same slim exports the Stat
 * Prompter reads) plus the live 5m tape for today's classification.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME, LIGHT_BLUE, classicCardAccentStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";
import { failOutcome, type IbDataset, type SlimDay } from "@/lib/ibStats";
import { backfillWidthBuckets, computeToday, type TodayFull } from "@/components/scanner/StatPrompterTab";
import { useEsCandles } from "@/hooks/useEsCandles";
import { useNqCandles } from "@/hooks/useNqCandles";

/* ── helpers ──────────────────────────────────────────────────────────────── */

const pctS = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "—");
const pct0 = (v: number | null) => (v == null ? "—" : (100 * v).toFixed(0) + "%");
const med = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const clock = (m: number | null) =>
  m == null ? "—" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const share = (rows: SlimDay[], f: (d: SlimDay) => boolean) => (rows.length ? rows.filter(f).length / rows.length : null);
const hit = (d: SlimDay, k: string) => !!d.fcb?.hit?.[k];

/** Minutes-of-day ET, right now — decides which of today's criteria are even
 *  knowable yet (a "still inside at 14:00" test means nothing at 11:00). */
/** Today's ET date as YYYY-MM-DD — used only to say how far behind the book is. */
function etTodayKey(): string {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const m: Record<string, string> = {};
  p.forEach((x) => (m[x.type] = x.value));
  return `${m.year}-${m.month}-${m.day}`;
}

function etNowMin(): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const m: Record<string, string> = {};
  p.forEach((x) => (m[x.type] = x.value));
  return (+m.hour % 24) * 60 + +m.minute;
}

/* ── the criteria ─────────────────────────────────────────────────────────── */

type Cond = {
  id: string;
  label: string;
  mini?: string;
  /** radio group — picking one deselects its siblings rather than blocking them */
  ex?: string;
  /** hard conflicts — these ids go dead while this one is picked */
  con?: string[];
  f: (d: SlimDay) => boolean;
  /** true / false / null when today's tape can't answer it yet */
  today: (t: TodayFull, nowMin: number) => boolean | null;
};

type Group = { name: string; hint?: string; items: Cond[] };

/** ids that describe something about a break — all dead once "neither broke" is on */
const BREAK_IDS = ["bh", "bl", "both", "single", "vs", "novs", "poke", "nopoke", "retest", "early", "midb", "late", "inside"];

const GROUPS: Group[] = [
  {
    name: "The open",
    hint: "pick one",
    items: [
      { id: "oarh", label: "OAR-H", mini: "gap over PDH", ex: "open", f: (d) => d.openType === "OAR-H", today: (t) => (t.openType == null ? null : t.openType === "OAR-H") },
      { id: "oarl", label: "OAR-L", mini: "gap under PDL", ex: "open", f: (d) => d.openType === "OAR-L", today: (t) => (t.openType == null ? null : t.openType === "OAR-L") },
      { id: "hir", label: "HIR", mini: "upper half", ex: "open", f: (d) => d.openType === "HIR", today: (t) => (t.openType == null ? null : t.openType === "HIR") },
      { id: "lir", label: "LIR", mini: "lower half", ex: "open", f: (d) => d.openType === "LIR", today: (t) => (t.openType == null ? null : t.openType === "LIR") },
      { id: "orbh", label: "ORB up", mini: "9:45", ex: "orb", f: (d) => d.orbDir === "H", today: (t) => (t.orbDir == null ? null : t.orbDir === "H") },
      { id: "orbl", label: "ORB down", mini: "9:45", ex: "orb", f: (d) => d.orbDir === "L", today: (t) => (t.orbDir == null ? null : t.orbDir === "L") },
    ],
  },
  {
    name: "IB shape",
    hint: "settled 10:30",
    items: [
      { id: "narrow", label: "IB narrow", ex: "width", f: (d) => d.widthBucket === "narrow", today: (t) => (t.bucket == null ? null : t.bucket === "narrow") },
      { id: "normal", label: "IB normal", ex: "width", f: (d) => d.widthBucket === "normal", today: (t) => (t.bucket == null ? null : t.bucket === "normal") },
      { id: "wide", label: "IB wide", ex: "width", f: (d) => d.widthBucket === "wide", today: (t) => (t.bucket == null ? null : t.bucket === "wide") },
      { id: "biasH", label: "IB closed above mid", ex: "bias", f: (d) => d.bias === "H", today: (t) => (t.bias == null ? null : t.bias === "H") },
      { id: "biasL", label: "IB closed below mid", ex: "bias", f: (d) => d.bias === "L", today: (t) => (t.bias == null ? null : t.bias === "L") },
      { id: "firstH", label: "High printed first", ex: "first", f: (d) => d.first === "H", today: (t) => (t.first == null ? null : t.first === "H") },
      { id: "firstL", label: "Low printed first", ex: "first", f: (d) => d.first === "L", today: (t) => (t.first == null ? null : t.first === "L") },
      { id: "fvgB", label: "Bullish FVG", mini: "15m", ex: "fvg", f: (d) => d.fvg === "bull", today: (t) => t.fvg === "bull" },
      { id: "fvgS", label: "Bearish FVG", mini: "15m", ex: "fvg", f: (d) => d.fvg === "bear", today: (t) => t.fvg === "bear" },
    ],
  },
  {
    name: "The break",
    items: [
      { id: "bh", label: "Broke IB high", ex: "side", con: ["nobreak"], f: (d) => d.fcb?.side === "H", today: (t) => (t.breakSide == null ? null : t.breakSide === "H") },
      { id: "bl", label: "Broke IB low", ex: "side", con: ["nobreak"], f: (d) => d.fcb?.side === "L", today: (t) => (t.breakSide == null ? null : t.breakSide === "L") },
      { id: "single", label: "One side only", ex: "shape", con: ["nobreak"], f: (d) => d.singleBreak, today: (t) => (t.neitherBroke ? false : t.bothBroke ? false : t.singleBreak ? true : null) },
      { id: "both", label: "Both sides broke", ex: "shape", con: ["nobreak"], f: (d) => d.bothBroke, today: (t) => (t.bothBroke ? true : null) },
      { id: "nobreak", label: "Neither side broke", ex: "shape", con: BREAK_IDS, f: (d) => d.neitherBroke, today: (t, now) => (t.bothBroke || t.singleBreak ? false : now >= 16 * 60 ? t.neitherBroke : null) },
      { id: "vs", label: "Volume surge", mini: "on break bar", ex: "vol", con: ["nobreak"], f: (d) => d.fcb?.volSurge === true, today: (t) => t.volSurge },
      { id: "novs", label: "No surge", ex: "vol", con: ["nobreak"], f: (d) => d.fcb != null && d.fcb.volSurge === false, today: (t) => (t.volSurge == null ? null : !t.volSurge) },
      { id: "poke", label: "Poked >0.5 IB past", ex: "poke", con: ["nobreak"], f: (d) => d.fcb != null && d.fcb.rExt > 0.5, today: (t) => (t.pokeFrac == null ? null : t.pokeFrac > 0.5) },
      { id: "nopoke", label: "Poked <0.25 IB past", ex: "poke", con: ["nobreak"], f: (d) => d.fcb != null && d.fcb.rExt < 0.25, today: (t) => (t.pokeFrac == null ? null : t.pokeFrac < 0.25) },
      // retest isn't carried on TodayFull — it stays PENDING all session rather
      // than guessing. Adding it would mean re-deriving it from the live tape.
      { id: "retest", label: "Retested the level", con: ["nobreak"], f: (d) => d.fcb?.retest === true, today: () => null },
    ],
  },
  {
    name: "The clock",
    hint: "pick one",
    items: [
      { id: "early", label: "Broke before 11:00", ex: "clock", con: ["nobreak", "inside"], f: (d) => d.fcb != null && d.fcb.breakMin < 660, today: (t) => (t.breakMin == null ? null : t.breakMin < 660) },
      { id: "midb", label: "Broke 11:00–14:00", ex: "clock", con: ["nobreak", "inside"], f: (d) => d.fcb != null && d.fcb.breakMin >= 660 && d.fcb.breakMin < 840, today: (t, now) => (t.breakMin != null ? t.breakMin >= 660 && t.breakMin < 840 : now >= 840 ? false : null) },
      { id: "late", label: "Broke after 14:00", ex: "clock", con: ["nobreak"], f: (d) => d.fcb != null && d.fcb.breakMin >= 840, today: (t, now) => (t.breakMin != null ? t.breakMin >= 840 : now >= 16 * 60 ? false : null) },
      { id: "inside", label: "Still inside at 14:00", con: ["nobreak", "early", "midb"], f: (d) => d.containedAt2, today: (t, now) => (t.breakMin != null && t.breakMin < 840 ? false : now >= 840 ? t.breakMin == null || t.breakMin >= 840 : null) },
    ],
  },
];

const ALL: Cond[] = GROUPS.flatMap((g) => g.items);
const BY: Record<string, Cond> = Object.fromEntries(ALL.map((c) => [c.id, c]));

/* ── seeding against a book that has never seen the day ───────────────────── */

/**
 * A full session classification is EIGHT OR NINE criteria at once. The book has
 * a few thousand sessions in it; the chance any one of them matched all nine is
 * close to zero, so seeding the raw classification produced an empty cohort —
 * every rate "—", "No sessions match", and (because `wouldBeEmpty` then strikes
 * out every remaining chip) no way to click back out of it. That is the
 * "historical shows nothing" bug: not missing data, an over-specified seed.
 *
 * So the seed relaxes. Criteria come off in the order below — texture first,
 * then timing, then shape — until the book actually holds a session matching
 * what is left. What came off is named on screen; nothing is silently ignored,
 * and one click puts any of it back.
 *
 * Ids NOT listed here are never dropped: the open type and the IB width bucket
 * are what the rail is keyed on, and a read that has quietly stopped
 * conditioning on them is not the read that was asked for.
 */
const RELAX_ORDER = [
  "retest",                          // never knowable live anyway
  "fvgB", "fvgS",                    // 15m texture
  "nopoke", "poke",                  // how far past the level it ran
  "novs", "vs",                      // volume on the break bar
  "inside", "midb", "early", "late", // the clock
  "firstH", "firstL",                // which extreme printed first
  "single", "both", "nobreak",       // break shape
  "biasH", "biasL",                  // where the IB closed relative to its mid
  "orbh", "orbl",                    // 9:45 ORB direction
  "bh", "bl",                        // which side broke
];

/**
 * Drop criteria until `days` holds at least one session matching all of them.
 * Returns the kept set (in rail order) and what came off, first-dropped first.
 * If even the undroppable core is empty, keep going in reverse rail order
 * rather than hand back a cohort of nothing.
 */
function relaxToBook(ids: string[], days: SlimDay[]): { kept: string[]; dropped: string[] } {
  const has = (list: string[]) => {
    const cs = list.map((i) => BY[i]).filter(Boolean);
    return days.some((d) => cs.every((c) => c.f(d)));
  };
  if (!days.length || has(ids)) return { kept: ids, dropped: [] };

  const kept = ids.filter((i) => BY[i]);
  const dropped: string[] = [];
  const order = [...RELAX_ORDER, ...[...ids].reverse().filter((i) => !RELAX_ORDER.includes(i))];
  for (const id of order) {
    const at = kept.indexOf(id);
    if (at < 0) continue;
    kept.splice(at, 1);
    dropped.push(id);
    if (has(kept)) break;
  }
  return { kept: ALL.filter((c) => kept.includes(c.id)).map((c) => c.id), dropped };
}

/* ── the outcome being measured ───────────────────────────────────────────── */

/**
 * The outcomes. ALL of them are always measured — there is no "which one are
 * you asking about" step, because the answer to that is always "all five, and
 * then tell me which one moved".
 *
 * One of them is the HEADLINE, and the rail picks it: the outcome whose rate in
 * this cohort sits furthest from its rate in the unconditional book. That is
 * the only automatic choice that means anything — an outcome sitting on its
 * baseline is the cohort telling you it changed nothing, and a big number that
 * is ALSO the book's big number is not a read, it is the base rate wearing a
 * cohort's name. Clicking any row overrides the pick; nothing hides it.
 */
type Metric = { id: string; label: string; sentence: string; color: string; f: (d: SlimDay) => boolean };
const METRICS: Metric[] = [
  { id: "failed", label: "Failed ≤30m",       sentence: "the break closed back inside within 30m",        color: HOME_THEME.red,      f: (d) => d.fcb?.failed === true },
  { id: "hit05",  label: "Hit 0.5×",          sentence: "the break reached 0.5× the IB width",            color: HOME_THEME.green,    f: (d) => hit(d, "0.5") },
  { id: "hit1",   label: "Hit 1.0×",          sentence: "the break reached 1.0× the IB width",            color: LIGHT_BLUE,          f: (d) => hit(d, "1") },
  { id: "hit2",   label: "Hit 2.0×",          sentence: "the break reached 2.0× the IB width",            color: HOME_THEME.cyan,     f: (d) => hit(d, "2") },
  { id: "rot",    label: "Full rotation",     sentence: "the day rotated to the opposite IB extreme",     color: HOME_THEME.orange,   f: (d) => d.fcb != null && failOutcome(d.fcb, d.width) === "full_rotation" },
  { id: "nomid",  label: "Never saw the mid", sentence: "price never returned to the IB midpoint",        color: "rgba(255,255,255,0.55)", f: (d) => d.noMidReturn },
];

/** The failed-break partition — the one place a stacked bar is an honest claim. */
const PARTS = [
  { k: "recovered" as const, label: "RECOVERED — new extreme past the pre-fail peak", color: LIGHT_BLUE },
  // This one is a BAR FILL, not text — it stays a muted neutral so the four
  // segments read apart. Only font colors went white.
  { k: "chop" as const, label: "CHOP — never saw the mid, never re-took its high", color: "rgba(255,255,255,0.28)" },
  { k: "to_mid" as const, label: "TO THE MID — reached the midpoint, no further", color: HOME_THEME.orange },
  { k: "full_rotation" as const, label: "FULL ROTATION — reached the opposite extreme", color: HOME_THEME.red },
];

/* ── component ────────────────────────────────────────────────────────────── */

export default function ConditionRailTab() {
  const [es, setEs] = useState<IbDataset | null>(null);
  const [nq, setNq] = useState<IbDataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sym, setSym] = useState<"ES" | "NQ">("ES");
  const [since, setSince] = useState("all");
  /** "live" = today's tape. Otherwise a past session date (YYYY-MM-DD). */
  const [asOf, setAsOf] = useState("live");
  /** null = the rail picks the headline outcome. A click on a row pins one. */
  const [focus, setFocus] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  /** Criteria relaxToBook() had to take off the seed to find a cohort at all. */
  const [relaxed, setRelaxed] = useState<string[]>([]);
  const [why, setWhy] = useState("");
  const touched = useRef(false);
  // Signature of the classification the rail was last auto-seeded from. UNSEEDED
  // is a sentinel no real signature can equal — an empty selection IS a valid
  // signature (a session where nothing classified), so `""` cannot mean "never
  // seeded" as well.
  const UNSEEDED = "\u0000unseeded";
  const seeded = useRef(UNSEEDED);

  const { candles: esLive } = useEsCandles(true, 2);
  const { candles: nqLive } = useNqCandles(true, 2);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/data/ib-ES.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`ib-ES.json ${r.status}`)))),
      fetch("/data/ib-NQ.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`ib-NQ.json ${r.status}`)))),
    ])
      .then(([a, b]: [IbDataset, IbDataset]) => {
        if (!alive) return;
        setEs(backfillWidthBuckets(a));
        setNq(backfillWidthBuckets(b));
      })
      .catch((e) => alive && setErr(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, []);

  // Re-tick every minute so a criterion flips from PENDING to answered on its
  // own clock (14:00 containment, the close) without needing a new frame.
  const [nowMin, setNowMin] = useState(() => etNowMin());
  useEffect(() => {
    const id = setInterval(() => setNowMin(etNowMin()), 60_000);
    return () => clearInterval(id);
  }, []);

  const ds = sym === "ES" ? es : nq;
  const live = sym === "ES" ? esLive : nqLive;
  const today = useMemo(() => (ds ? computeToday(live, ds.days) : null), [live, ds]);

  const isLive = asOf === "live";

  /** The stored row for the session being read back, when one is selected. */
  const pastDay = useMemo(
    () => (isLive ? null : (ds?.days.find((d) => d.date === asOf) ?? null)),
    [ds, asOf, isLive]
  );

  // The book. On a past session it is cut to what existed BEFORE that date —
  // see the SESSION PICKER note at the top. `since` narrows it further.
  const days = useMemo(() => {
    if (!ds) return [];
    const cut = since === "all" ? "" : `${since}-01-01`;
    return ds.days.filter((d) => d.date >= cut && (isLive || d.date < asOf));
  }, [ds, since, asOf, isLive]);

  /** Every session in the file, newest first — what the Session picker offers. */
  const sessionOptions = useMemo(() => {
    const rows = [...(ds?.days ?? [])].reverse().slice(0, 250);
    return [
      { value: "live", label: "Today · live tape" },
      ...rows.map((d) => ({ value: d.date, label: d.date })),
    ];
  }, [ds]);

  /**
   * How far behind the book is.
   *
   * The picker can only offer sessions the export contains, so a gap between the
   * newest stored session and today is not a bug in the picker — it is the
   * `public/data/ib-<sym>.json` export standing still. That gap used to be
   * invisible (the live tape classifies today either way), which made the
   * dropdown look broken when it jumped from "today" to a date weeks back. Say
   * it out loud instead. Threshold is 5 CALENDAR days so a long weekend or a
   * holiday never trips it.
   */
  const bookEnd = ds?.days.length ? ds.days[ds.days.length - 1].date : null;
  const bookLagDays = useMemo(() => {
    if (!bookEnd) return 0;
    const ms = Date.parse(`${etTodayKey()}T00:00:00Z`) - Date.parse(`${bookEnd}T00:00:00Z`);
    return Math.max(0, Math.round(ms / 86_400_000));
  }, [bookEnd]);
  const bookStale = bookLagDays > 5;

  /**
   * The selected session's answer for one criterion.
   *
   * Live: true / false / null (the tape can't answer it yet).
   * Past: never null — the session is closed, so `c.f(day)` decides every one.
   */
  const todayOf = useMemo(() => {
    const m: Record<string, boolean | null> = {};
    if (!isLive) {
      for (const c of ALL) m[c.id] = pastDay ? c.f(pastDay) : null;
      return m;
    }
    for (const c of ALL) m[c.id] = today ? c.today(today, nowMin) : null;
    return m;
  }, [today, nowMin, isLive, pastDay]);

  const todayTrue = useMemo(() => ALL.filter((c) => todayOf[c.id] === true).map((c) => c.id), [todayOf]);

  // First time today's IB classifies, seed the rail with it — the whole point of
  // the page is "what do the stats say about THIS session". Only until the user
  // touches a chip; after that the selection is theirs.
  // The signature guard matters: `todayTrue` is rebuilt on every websocket tick,
  // so seeding on identity alone would re-set state a few times a minute and
  // stomp a selection the user made in between.
  //
  // Changing the session (or the index) hands the rail back: the selection on
  // screen described the OLD session, so it is no longer the user's answer to
  // this one. Declared before the seeding effect so that on the render where
  // `asOf` changes this clears first and the seed below lands in the same pass.
  useEffect(() => {
    touched.current = false;
    seeded.current = UNSEEDED;
    setRelaxed([]);
    setFocus(null);
    setWhy("");
  }, [asOf, sym, UNSEEDED]);

  useEffect(() => {
    if (touched.current) return;
    // Live: an empty classification means the IB hasn't settled yet, so wait
    // rather than clearing the rail. Past: empty is an ANSWER — that session
    // classified as nothing — and it seeds like any other.
    if (isLive && !todayTrue.length) return;
    // The window is part of the signature: narrowing `since` can empty a cohort
    // the wider book had, so an untouched rail re-relaxes against the new book
    // instead of sitting on a selection that now matches nothing.
    const sig = `${todayTrue.join("|")}#${days.length}`;
    if (sig === seeded.current) return;
    seeded.current = sig;
    const { kept, dropped } = relaxToBook(todayTrue, days);
    setSel(kept);
    setRelaxed(dropped);
  }, [todayTrue, isLive, days]);

  /* ── selection mechanics: exclusion + conflicts ─────────────────────────── */

  const selSet = useMemo(() => new Set(sel), [sel]);

  /** which picked criterion rules `id` out, if any */
  const blockedBy = (id: string): string | null => {
    for (const s of sel) {
      if (s === id) continue;
      if (BY[s]?.con?.includes(id)) return BY[s].label;
      if (BY[id]?.con?.includes(s)) return BY[s].label;
    }
    return null;
  };

  /** a combination the book has never seen is dead too — it describes a day that
   *  has not happened. Siblings in the same radio group are swapped, not added. */
  const wouldBeEmpty = (id: string): boolean => {
    const kept = sel.filter((s) => s !== id && !(BY[id].ex && BY[s]?.ex === BY[id].ex));
    const conds = [...kept.map((s) => BY[s]), BY[id]];
    return !days.some((d) => conds.every((c) => c.f(d)));
  };

  const toggle = (id: string) => {
    touched.current = true;
    setWhy("");
    // Putting a relaxed-away criterion back makes it the user's pick again, so
    // it stops being something the page took off on their behalf.
    setRelaxed((prev) => prev.filter((x) => x !== id));
    setSel((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      const item = BY[id];
      let next = prev.filter((x) => {
        if (item.ex && BY[x]?.ex === item.ex) return false;   // radio swap
        if (item.con?.includes(x)) return false;              // this kills that
        if (BY[x]?.con?.includes(id)) return false;           // that kills this
        return true;
      });
      next = [...next, id];
      return ALL.filter((c) => next.includes(c.id)).map((c) => c.id); // keep rail order
    });
  };

  /* ── the cohort ─────────────────────────────────────────────────────────── */

  const conds = useMemo(() => ALL.filter((c) => selSet.has(c.id)), [selSet]);
  const cohort = useMemo(() => days.filter((d) => conds.every((c) => c.f(d))), [days, conds]);
  const broke = useMemo(() => cohort.filter((d) => d.fcb != null), [cohort]);
  const allBroke = useMemo(() => days.filter((d) => d.fcb != null), [days]);

  // Every outcome, every time: this cohort's rate, the book's rate, the gap.
  const rows = useMemo(
    () =>
      METRICS.map((m) => {
        const k = broke.filter(m.f).length;
        const v = broke.length ? k / broke.length : null;
        const b = allBroke.length ? allBroke.filter(m.f).length / allBroke.length : null;
        return { m, k, v, b, delta: v != null && b != null ? (v - b) * 100 : null };
      }),
    [broke, allBroke],
  );

  /** The headline the rail picks: furthest from the book. See METRICS above. */
  const autoId = useMemo(() => {
    const scored = rows.filter((r) => r.delta != null);
    if (!scored.length) return "hit1";
    return scored.reduce((a, b) => (Math.abs(b.delta!) > Math.abs(a.delta!) ? b : a)).m.id;
  }, [rows]);

  const metric = METRICS.find((m) => m.id === (focus ?? autoId)) ?? METRICS[0];
  const row = rows.find((r) => r.m.id === metric.id)!;
  const rateK = row.k;
  const rateN = broke.length;
  const baseline = row.b;
  const rate = row.v;
  const deltaPts = row.delta;

  const thin = rateN > 0 && rateN < 30;
  const suspicious = rate != null && rateN >= 30 && rate > 0.85;

  const fails = broke.filter((d) => d.fcb!.failed);
  const partition = PARTS.map((p) => ({
    ...p,
    pct: fails.length ? (100 * fails.filter((d) => failOutcome(d.fcb!, d.width) === p.k).length) / fails.length : 0,
  }));

  const medExt = med(broke.map((d) => d.fcb!.rExt));
  const medMin = med(broke.map((d) => d.fcb!.breakMin));

  /**
   * Every ticked criterion priced on its own, and priced out.
   *
   * The headline is one number for the whole stack, which says nothing about
   * WHICH condition is carrying it — and when the stack is thin it is the only
   * number on the page. Two columns fix that: ALONE is the criterion against
   * the unconditional book, WITHOUT IT is the ticked cohort with just that one
   * removed. Together they say what each pick is worth and what it is costing.
   */
  const perCond = useMemo(
    () =>
      conds.map((c) => {
        const alone = days.filter((d) => d.fcb != null && c.f(d));
        const rest = conds.filter((x) => x.id !== c.id);
        const without = days.filter((d) => d.fcb != null && rest.every((x) => x.f(d)));
        return {
          id: c.id,
          label: c.label,
          alone: alone.length ? alone.filter(metric.f).length / alone.length : null,
          aloneThin: alone.length > 0 && alone.length < 30,
          without: without.length ? without.filter(metric.f).length / without.length : null,
        };
      }),
    [conds, days, metric],
  );

  const selNotToday = sel.filter((id) => todayOf[id] === false);
  const selPending = sel.filter((id) => todayOf[id] == null);
  const isTodayCohort = sel.length > 0 && selNotToday.length === 0;

  /* ── styles ─────────────────────────────────────────────────────────────── */

  const sect: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.text, marginBottom: 10, display: "flex", alignItems: "center", gap: 7 };
  const badge = (color: string): React.CSSProperties => ({ marginLeft: 8, fontSize: 10, fontWeight: 800, color, border: `1px solid ${color}66`, background: `${color}1A`, borderRadius: 4, padding: "1px 5px", letterSpacing: ".04em", whiteSpace: "nowrap" });
  const tile: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: `1px solid ${HOME_THEME.border}`, borderRadius: 10, padding: 12 };

  const chipStyle = (on: boolean, isToday: boolean, dead: boolean): React.CSSProperties => ({
    fontSize: 12, fontWeight: 600, cursor: dead ? "not-allowed" : "pointer",
    display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 9px", borderRadius: 7,
    border: `1px solid ${on ? LIGHT_BLUE : isToday ? `${LIGHT_BLUE}55` : HOME_THEME.border}`,
    background: on ? `${LIGHT_BLUE}22` : "rgba(255,255,255,0.03)",
    color: on ? LIGHT_BLUE : HOME_THEME.text,
    opacity: dead ? 0.28 : 1,
    textDecoration: dead ? "line-through" : "none",
    boxShadow: isToday && !dead ? `inset 2px 0 0 ${LIGHT_BLUE}` : "none",
    transition: "all 0.12s",
  });

  if (err) {
    return (
      <Card title="Condition Rail">
        <div style={{ color: HOME_THEME.red, fontSize: 14 }}>
          Couldn&apos;t load the IB datasets: {err}
          <div style={{ color: HOME_THEME.text, marginTop: 6 }}>
            Export them from <code>ib-backtest-esu6.html</code> → &quot;Export JSON for dashboard&quot; into <code>public/data/</code>.
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card
        title="Condition Rail"
        subtitle="Tick what has happened in the session; the book re-reads itself for exactly that cohort."
      >
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ ...sect, marginBottom: 0 }}>Index</span>
            <ThemedSelect width={90} value={sym} onChange={(v) => setSym(v as "ES" | "NQ")} options={[{ value: "ES", label: "ES" }, { value: "NQ", label: "NQ" }]} />
          </div>
          {/* Read the rail back on a past session. Picking one re-seeds the
              criteria from that day and cuts the book to what came BEFORE it. */}
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ ...sect, marginBottom: 0 }}>Session</span>
            <ThemedSelect width={170} value={asOf} onChange={setAsOf} options={sessionOptions} />
            {bookStale && (
              <span
                title={`The picker lists what public/data/ib-${sym}.json contains. Its newest session is ${bookEnd}; today is classified from the live tape, so everything between the two is missing. Re-export from ib-backtest-esu6.html → "Export JSON for dashboard" into public/data/.`}
                style={badge(HOME_THEME.orange)}
              >
                BOOK ENDS {bookEnd}
              </span>
            )}
          </div>
          {/* No "Outcome" picker. Every outcome is measured every time and all of
              them are on screen; the headline is whichever one sits furthest
              from the book, and clicking a row pins a different one. Asking the
              user to choose an outcome BEFORE seeing any of them was asking them
              to guess which one the cohort moved. */}
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ ...sect, marginBottom: 0 }}>Since</span>
            <ThemedSelect
              width={150}
              value={since}
              onChange={setSince}
              options={[
                { value: "all", label: "All history" },
                { value: "2023", label: "Since 2023" },
                { value: "2024", label: "Since 2024" },
                { value: "2025", label: "Since 2025" },
                { value: "2026", label: "Since 2026" },
              ]}
            />
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 13, color: HOME_THEME.text }}>
            {ds
              ? `${days.length} ${sym} sessions${since === "all" ? "" : ` since ${since}`}${isLive ? "" : ` before ${asOf}`} · ${days[0]?.date ?? "—"} → ${days[days.length - 1]?.date ?? "—"}`
              : "loading ib-ES.json + ib-NQ.json…"}
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 320px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        {/* ── the rail ─────────────────────────────────────────────────── */}
        <div style={{ ...classicCardAccentStyle, padding: 16, position: "sticky", top: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: HOME_THEME.text }}>What has happened</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => {
                  touched.current = true;
                  setWhy("");
                  const { kept, dropped } = relaxToBook(todayTrue, days);
                  setSel(kept);
                  setRelaxed(dropped);
                }}
                disabled={!todayTrue.length}
                style={{
                  fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em", padding: "4px 8px", borderRadius: 6,
                  cursor: todayTrue.length ? "pointer" : "not-allowed", opacity: todayTrue.length ? 1 : 0.4,
                  border: `1px solid ${LIGHT_BLUE}66`, background: `${LIGHT_BLUE}1A`, color: LIGHT_BLUE,
                }}
              >
                {isLive ? "MATCH TODAY" : "MATCH SESSION"}
              </button>
              <button
                onClick={() => { touched.current = true; setWhy(""); setRelaxed([]); setSel([]); }}
                style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em", padding: "4px 8px", borderRadius: 6, cursor: "pointer", border: `1px solid ${HOME_THEME.border}`, background: "rgba(255,255,255,0.03)", color: HOME_THEME.text }}
              >
                CLEAR
              </button>
            </div>
          </div>

          {/* the selected session's classification — live tape, or the stored row */}
          <div style={{
            background: isLive ? `${LIGHT_BLUE}0F` : `${HOME_THEME.orange}0F`,
            border: `1px solid ${isLive ? `${LIGHT_BLUE}33` : `${HOME_THEME.orange}44`}`,
            borderRadius: 10, padding: "10px 11px", marginBottom: 14,
          }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: isLive ? LIGHT_BLUE : HOME_THEME.orange, marginBottom: 5 }}>
              {isLive ? `Today so far · ${clock(nowMin)} ET` : `Session ${asOf} · closed`}
            </div>
            <div style={{ fontSize: 11.5, color: HOME_THEME.text, lineHeight: 1.55 }}>
              {!isLive ? (
                !pastDay ? (
                  `no ${sym} row in the book for ${asOf}.`
                ) : (
                  <>
                    <span style={{ color: HOME_THEME.text, fontWeight: 700 }}>
                      {todayTrue.map((id) => BY[id].label).join(" · ") || "classified as nothing on this rail"}
                    </span>
                    <br />
                    <span style={{ color: HOME_THEME.text }}>
                      Book cut to sessions before this date — the read is what it would have been on the day.
                    </span>
                  </>
                )
              ) : !today ? (
                "waiting on the live tape — today's IB isn't complete yet."
              ) : (
                <>
                  <span style={{ color: HOME_THEME.text, fontWeight: 700 }}>
                    {todayTrue.map((id) => BY[id].label).join(" · ") || "nothing confirmed yet"}
                  </span>
                  <br />
                  <span style={{ color: HOME_THEME.text }}>
                    Still open: {ALL.filter((c) => todayOf[c.id] == null).map((c) => c.label.toLowerCase()).join(", ") || "—"}
                  </span>
                </>
              )}
            </div>
            {/* Said out loud, never silent: the full classification described a
                day this book has never seen, so these came off to get a cohort
                at all. Clicking one back on re-narrows and the banner drops it. */}
            {relaxed.length > 0 && (
              <div style={{ marginTop: 7, fontSize: 11, color: HOME_THEME.orange, lineHeight: 1.5 }}>
                ⚠ Relaxed — no session in this book matched the full read. Dropped{" "}
                <b>{relaxed.map((id) => BY[id]?.label.toLowerCase()).filter(Boolean).join(", ")}</b>. Click any of them back on to see it go empty again.
              </div>
            )}
          </div>

          {GROUPS.map((g) => (
            <div key={g.name} style={{ marginBottom: 14 }}>
              <div style={sect}>
                {g.name}
                {g.hint && (
                  <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: ".03em", textTransform: "none", color: HOME_THEME.text, border: `1px solid ${HOME_THEME.border}`, borderRadius: 4, padding: "1px 4px" }}>
                    {g.hint}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {g.items.map((c) => {
                  const on = selSet.has(c.id);
                  const blk = on ? null : blockedBy(c.id);
                  // The empty-combination strike only means anything while the
                  // current selection HAS a cohort. Once it doesn't, every chip
                  // "would be empty" and the whole rail goes dead — which is
                  // how the page used to lock itself with nothing on screen.
                  const empty = !on && !blk && cohort.length > 0 && wouldBeEmpty(c.id);
                  const dead = !!blk || empty;
                  const tv = todayOf[c.id];
                  const reason = blk ? `Ruled out by “${blk}”` : empty ? "No session in the book matches that combination" : "";
                  return (
                    <button
                      key={c.id}
                      title={reason}
                      onClick={() => (dead ? setWhy(reason) : toggle(c.id))}
                      style={chipStyle(on, tv === true, dead)}
                    >
                      {!dead && tv === true && <span style={{ fontSize: 8, color: LIGHT_BLUE }}>●</span>}
                      {!dead && tv == null && <span style={{ fontSize: 8, color: HOME_THEME.orange }}>○</span>}
                      {c.label}
                      {c.mini && <span style={{ fontSize: 9.5, fontWeight: 800, color: HOME_THEME.text }}>{c.mini}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {why && <div style={{ fontSize: 11, color: HOME_THEME.orange, lineHeight: 1.5, marginTop: 4 }}>⚠ {why}</div>}

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${HOME_THEME.border}`, fontSize: 11, color: HOME_THEME.text, lineHeight: 1.8 }}>
            <span style={{ color: LIGHT_BLUE }}>●</span> true of {isLive ? "today's session" : `the ${asOf} session`}<br />
            {isLive && (
              <>
                <span style={{ color: HOME_THEME.orange }}>○</span> the tape can&apos;t answer it yet<br />
              </>
            )}
            <span style={{ textDecoration: "line-through" }}>struck</span> ruled out by a pick above<br />
            <span style={{ display: "block", marginTop: 8 }}>
              Sample strength{" "}
              <b style={{ color: rateN === 0 ? HOME_THEME.red : thin ? HOME_THEME.orange : LIGHT_BLUE }}>
                {rateN === 0 ? "none" : thin ? "THIN" : rateN < 80 ? "workable" : "solid"}
              </b>
              {cohort.length > 0 && ` · ${cohort[0].date} → ${cohort[cohort.length - 1].date}`}
            </span>
          </div>
        </div>

        {/* ── the readout ──────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ ...classicCardAccentStyle, padding: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 250px) minmax(0, 1fr)", gap: 22, alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.035em", color: LIGHT_BLUE, fontVariantNumeric: "tabular-nums" }}>
                  {rate != null ? pctS(rateK, rateN) : "—"}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: metric.color }}>
                    {metric.label}
                  </span>
                  <span style={{ ...badge(focus ? HOME_THEME.orange : LIGHT_BLUE), marginLeft: 0 }}>
                    {focus ? "PINNED" : "BIGGEST GAP"}
                  </span>
                  {focus && (
                    <button
                      onClick={() => setFocus(null)}
                      style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".04em", padding: "1px 5px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${HOME_THEME.border}`, background: "rgba(255,255,255,0.03)", color: HOME_THEME.text }}
                    >
                      AUTO
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 12, color: HOME_THEME.text, marginTop: 8, lineHeight: 1.5 }}>
                  {conds.length ? (
                    <>
                      of {sym} sessions where{" "}
                      <b style={{ color: HOME_THEME.text }}>{conds.map((c) => c.label.toLowerCase()).join(" + ")}</b>, {metric.sentence}.
                    </>
                  ) : (
                    <>of every {sym} IB break in the book, {metric.sentence}. Tick criteria at left to narrow it.</>
                  )}
                </div>

                {deltaPts != null && (
                  <div
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, marginTop: 11, fontSize: 12, fontWeight: 800,
                      padding: "4px 9px", borderRadius: 7,
                      color: Math.abs(deltaPts) < 1.5 ? HOME_THEME.text : deltaPts > 0 ? HOME_THEME.green : HOME_THEME.red,
                      border: `1px solid ${Math.abs(deltaPts) < 1.5 ? HOME_THEME.border : deltaPts > 0 ? `${HOME_THEME.green}66` : `${HOME_THEME.red}66`}`,
                      background: Math.abs(deltaPts) < 1.5 ? "rgba(255,255,255,0.03)" : deltaPts > 0 ? `${HOME_THEME.green}1A` : `${HOME_THEME.red}1A`,
                    }}
                  >
                    {deltaPts > 0 ? "▲" : deltaPts < 0 ? "▼" : "●"} {Math.abs(deltaPts).toFixed(1)} pts vs the {pct0(baseline)} baseline
                  </div>
                )}

                {/* What the session being read back actually did. A past rate is
                    only worth anything next to the outcome it was quoting. */}
                {pastDay && (
                  <div style={{ marginTop: 11, fontSize: 11.5, color: HOME_THEME.text, lineHeight: 1.6 }}>
                    <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.orange, marginBottom: 5 }}>
                      What {asOf} actually did
                    </div>
                    {pastDay.fcb == null ? (
                      <>
                        <span style={{ ...badge(HOME_THEME.orange), marginLeft: 0 }}>NO BREAK</span> it never broke the IB, so none of these came up.
                      </>
                    ) : (
                      // All of them, not just the headline: a past read is only
                      // worth anything beside every outcome it was quoting.
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {METRICS.map((m) => {
                          const did = m.f(pastDay);
                          return (
                            <span key={m.id} style={{ ...badge(did ? HOME_THEME.green : HOME_THEME.red), marginLeft: 0 }}>
                              {did ? "✓" : "✕"} {m.label}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ marginTop: 12, fontSize: 11.5, color: HOME_THEME.text, lineHeight: 1.6 }}>
                  {sel.length === 0 ? null : isTodayCohort ? (
                    <>
                      <span style={badge(LIGHT_BLUE)}>{isLive ? "TODAY" : "THAT SESSION"}</span>{" "}
                      every selected criterion is true of {isLive ? "this session right now" : `the ${asOf} session`}.
                    </>
                  ) : (
                    <>
                      <span style={badge(HOME_THEME.orange)}>HYPOTHETICAL</span>{" "}
                      {selNotToday.map((id) => BY[id].label.toLowerCase()).join(", ")}{" "}
                      {selNotToday.length > 1 ? "are" : "is"} not true of {isLive ? "today" : asOf}.
                    </>
                  )}
                  {selPending.length > 0 && (
                    <div style={{ marginTop: 4, color: HOME_THEME.text }}>
                      Unresolved on the tape: {selPending.map((id) => BY[id].label.toLowerCase()).join(", ")}.
                    </div>
                  )}
                  {thin && <span style={badge(HOME_THEME.orange)}>THIN</span>}
                  {suspicious && <span style={badge(HOME_THEME.red)}>CHECK FOR BIAS</span>}
                </div>
              </div>

              {/* Every outcome, this cohort against the unconditional book. Each
                  row is a button: clicking it pins that outcome as the headline,
                  clicking the pinned one hands the pick back to the rail. */}
              <div style={{ display: "grid", gap: 9 }}>
                {rows.map((r) => {
                  const on = r.m.id === metric.id;
                  const auto = r.m.id === autoId;
                  return (
                    <button
                      key={r.m.id}
                      onClick={() => setFocus(focus === r.m.id ? null : r.m.id)}
                      title={auto ? "The rail's pick — furthest from the book" : `Pin ${r.m.label} as the headline`}
                      style={{
                        display: "grid", gridTemplateColumns: "128px minmax(0,1fr) 54px 62px", gap: 11, alignItems: "center",
                        fontSize: 12, fontFamily: "inherit", textAlign: "left", cursor: "pointer",
                        padding: "3px 6px", margin: "-3px -6px", borderRadius: 7,
                        border: `1px solid ${on ? `${r.m.color}66` : "transparent"}`,
                        background: on ? `${r.m.color}14` : "transparent",
                      }}
                    >
                      <div style={{ color: HOME_THEME.text, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 }}>
                        {auto && <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: ".06em", color: r.m.color, border: `1px solid ${r.m.color}55`, borderRadius: 3, padding: "0 3px" }}>AUTO</span>}
                        {r.m.label}
                      </div>
                      <div style={{ height: 16, background: "rgba(255,255,255,0.05)", borderRadius: 5, position: "relative", overflow: "hidden" }}>
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(r.v ?? 0) * 100}%`, background: r.m.color, opacity: on ? 1 : 0.7, borderRadius: 5 }} />
                        <div style={{ position: "absolute", top: -3, bottom: -3, left: `${(r.b ?? 0) * 100}%`, width: 1.5, background: "rgba(255,255,255,0.45)" }} />
                      </div>
                      <div style={{ fontWeight: 800, textAlign: "right", color: r.m.color, fontVariantNumeric: "tabular-nums" }}>{pct0(r.v)}</div>
                      {/* The gap to the book IS the read. A rate on its baseline
                          is the cohort saying it changed nothing. */}
                      <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 11, fontWeight: 700,
                        color: r.delta == null || Math.abs(r.delta) < 1.5 ? HOME_THEME.text : r.delta > 0 ? HOME_THEME.green : HOME_THEME.red }}>
                        {r.delta == null ? "—" : `${r.delta > 0 ? "+" : r.delta < 0 ? "−" : "±"}${Math.abs(r.delta).toFixed(0)}`}
                      </div>
                    </button>
                  );
                })}
                <div style={{ fontSize: 10.5, color: HOME_THEME.text, textAlign: "right" }}>
                  bar = this cohort · hairline = the unconditional {sym} book · last column = points off that baseline · click a row to pin it
                </div>
              </div>
            </div>
          </div>

          {/* every ticked criterion priced on its own, and priced out */}
          <div style={{ ...classicCardAccentStyle, padding: 20 }}>
            <div style={sect}>
              Each criterion on its own
              <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600, color: HOME_THEME.text }}>
                — {metric.label.toLowerCase()}, {sym} book
              </span>
            </div>
            {perCond.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1fr) minmax(0, 1.5fr) 54px 78px", gap: 11, alignItems: "center", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: HOME_THEME.text }}>
                  <div>Criterion</div>
                  <div>Alone, vs the book</div>
                  <div style={{ textAlign: "right" }}>Rate</div>
                  <div style={{ textAlign: "right" }}>Without it</div>
                </div>
                {perCond.map((r) => (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1fr) minmax(0, 1.5fr) 54px 78px", gap: 11, alignItems: "center", fontSize: 12 }}>
                    <div style={{ color: HOME_THEME.text }}>{r.label}</div>
                    <div style={{ height: 16, background: "rgba(255,255,255,0.05)", borderRadius: 5, position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(r.alone ?? 0) * 100}%`, background: r.aloneThin ? HOME_THEME.orange : LIGHT_BLUE, opacity: 0.85, borderRadius: 5 }} />
                      <div style={{ position: "absolute", top: -3, bottom: -3, left: `${(baseline ?? 0) * 100}%`, width: 1.5, background: "rgba(255,255,255,0.45)" }} />
                    </div>
                    <div style={{ fontWeight: 800, textAlign: "right", color: r.aloneThin ? HOME_THEME.orange : LIGHT_BLUE, fontVariantNumeric: "tabular-nums" }}>{pct0(r.alone)}</div>
                    <div style={{ textAlign: "right", color: HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>{pct0(r.without)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: HOME_THEME.text }}>Nothing ticked — the headline already is the whole book.</div>
            )}
            <div style={{ fontSize: 10.5, color: HOME_THEME.text, marginTop: 9 }}>
              bar = that criterion on its own · hairline = the unconditional {sym} book · orange = thin on its own ·
              &ldquo;without it&rdquo; = the ticked cohort with just that one removed, so the gap to the headline is what the pick costs.
            </div>
          </div>

          {/* failed-break partition — mutually exclusive, sums to 100 */}
          <div style={{ ...classicCardAccentStyle, padding: 20 }}>
            <div style={sect}>If the break fails — where the day ends up</div>
            {fails.length ? (
              <>
                <div style={{ display: "flex", height: 30, borderRadius: 7, overflow: "hidden", gap: 2 }}>
                  {partition.map((p) => (
                    <div key={p.k} style={{ width: `${p.pct}%`, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: HOME_THEME.bg, fontVariantNumeric: "tabular-nums" }}>
                      {p.pct >= 9 ? `${p.pct.toFixed(0)}%` : ""}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 9 }}>
                  {partition.map((p) => (
                    <span key={p.k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: HOME_THEME.text }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color, display: "inline-block" }} />
                      {p.label}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: HOME_THEME.text }}>No failed breaks in this cohort.</div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10 }}>
            {[
              { t: "Median extension", v: medExt == null ? "—" : `${medExt.toFixed(2)}×`, s: "in IB widths" },
              { t: "Break failed", v: pct0(share(broke, (d) => d.fcb!.failed)), s: "closed back inside ≤30m" },
              { t: "Median break time", v: clock(medMin), s: "ET" },
              { t: "Never saw the mid", v: pct0(share(broke, (d) => d.noMidReturn)), s: "trend-day filter" },
            ].map((x) => (
              <div key={x.t} style={tile}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: HOME_THEME.text }}>{x.t}</div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 5, letterSpacing: "-0.02em", color: HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>{x.v}</div>
                <div style={{ fontSize: 11, color: HOME_THEME.text, marginTop: 2 }}>{x.s}</div>
              </div>
            ))}
          </div>

          {/* every matching session, oldest → newest */}
          <div style={{ ...classicCardAccentStyle, padding: 20 }}>
            <div style={sect}>
              Matching sessions, oldest → newest
              <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600, color: HOME_THEME.text }}>
                — filled = {metric.label.toLowerCase()}
              </span>
            </div>
            {broke.length ? (
              <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                {broke.slice(-160).map((d, i, arr) => {
                  // Only meaningful on the live tape: on a past session the book
                  // stops BEFORE that date, so the last cell is the session
                  // before it, not the one being read back.
                  // ...and only while the book is current: with a stale export
                  // the last cell is weeks old, so marking it as "today" is a
                  // straight lie about which session that square is.
                  const isLast = isLive && !bookStale && isTodayCohort && i === arr.length - 1;
                  return (
                    <span
                      key={d.date}
                      title={`${d.date} · ${metric.label}: ${metric.f(d) ? "yes" : "no"}`}
                      style={{
                        width: 9, height: 14, borderRadius: 2,
                        background: isLast ? HOME_THEME.orange : metric.f(d) ? LIGHT_BLUE : "rgba(255,255,255,0.13)",
                        boxShadow: isLast ? `0 0 0 1.5px ${HOME_THEME.orange}55` : "none",
                      }}
                    />
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: HOME_THEME.text }}>No sessions match — loosen a criterion.</div>
            )}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 12, color: HOME_THEME.text, lineHeight: 1.6 }}>
        Reads <code>public/data/ib-{sym}.json</code> (slim export from <code>ib-backtest-esu6.html</code>) plus the live 5m tape for today&apos;s
        classification. Break = first 5m CLOSE outside the 09:30–10:30 IB. Failed = closed back inside within 30m. Extension is in IB widths.
        <br />
        The rail only lets you describe a session that could exist: criteria in the same group swap rather than stack, criteria that contradict a pick are
        struck out, and a combination with no session behind it is struck out too.
        <br />
        There is nothing to pick on the outcome side: all five are measured on every cohort and all five are on screen. The headline is the one sitting
        furthest from its rate in the unconditional book — the gap is the read, and an outcome on its baseline is the cohort telling you it changed
        nothing. Click any row to pin it instead, or <b>AUTO</b> to hand the choice back.
        <br />
        No lookahead: every field was stamped at its own confirm bar. Sample sizes aren&apos;t printed, but they still gate the read — a thin cohort is
        badged THIN, and any rate over 85% is flagged to check for bias rather than treated as an edge.
        <br />
        The <b>Session</b> picker reads the rail back on a past day: the criteria are re-seeded from that session&apos;s own classification and the book is
        cut to sessions <i>before</i> it, so the rate shown is the one the rail would have quoted that morning — not the same day scored with hindsight.
        What the session then did is printed beside it.
        <br />
        The picker can only offer sessions the export contains. Today is classified from the live tape, so if <code>ib-{sym}.json</code> is behind, the list
        jumps straight from today to the last exported session and a <b>BOOK ENDS</b> badge says where it stops — re-export from{" "}
        <code>ib-backtest-esu6.html</code> → &quot;Export JSON for dashboard&quot; into <code>public/data/</code> to close the gap.
      </div>
    </div>
  );
}
