"use client";

/**
 * components/scanner/StatPrompterTab.tsx
 *
 * "Stat Prompter" — a library of canned, runnable questions over the IB datasets.
 * Click a prompt, it runs client-side over public/data/ib-ES.json + ib-NQ.json
 * (the same slim exports IbStatsTab uses) and renders the answer as a table.
 *
 * Why this exists: every time a session throws up a shape ("ES broke IB high,
 * NQ broke low — who leads?") the answer lived in a one-off script. These are
 * the same queries, wired to the UI, so the base rate is one click away while
 * the tape is still open.
 *
 * HONESTY RULES BAKED IN — do not remove:
 *   • Sample size is NOT printed as a number (deliberate — the n column was noise
 *     when reading live). It still governs: n < 30 renders a THIN badge and a
 *     rate over 85% renders a CHECK FOR BIAS flag. Keep those badges.
 *   • Nothing peeks forward: SlimDay fields were stamped at their own confirm
 *     bar by the exporter. This file only counts and divides.
 *   • A hit rate above ~85% on a directional question is a bug, not an edge —
 *     the prompt flags it rather than celebrating it.
 */

import { useEffect, useMemo, useState } from "react";
import { HOME_THEME, LIGHT_BLUE, classicCardAccentStyle, homeButtonStyle, homeSecondaryButtonStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";
import IbLevelCanvas from "@/components/scanner/IbLevelCanvas";
import { failOutcome, type FailOutcome, type IbDataset, type SlimDay } from "@/lib/ibStats";

/* ── stat helpers ─────────────────────────────────────────────────────────── */

const pctS = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "—");
const med = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const dow = (date: string) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(date + "T12:00:00Z").getUTCDay()];

/* ── result model ─────────────────────────────────────────────────────────── */

type Row = {
  label: string;
  n: number;
  /** hits out of n — omit for pure descriptive rows */
  k?: number;
  /** free-form extra columns */
  extra?: Record<string, string>;
  emphasis?: boolean;
};
/** A stacked composition bar. ONLY valid when the segments are mutually
 *  exclusive and sum to 100 — a stacked bar is a claim about a partition, and
 *  drawing overlapping percentages this way is a lie the eye can't detect. */
type Stack = { label: string; segs: { name: string; pct: number; color: string }[] };

type Result = {
  headline: string;
  cols?: string[];          // names of the `extra` columns, in order
  hideRate?: boolean;       // drop the built-in RATE % column (count-only views)
  rows: Row[];
  stack?: Stack[];          // rendered above the table
  verdict?: string;
  caveat?: string;
};

/* ── bar-level stat book (scripts/build-bar-stats.mjs → public/data/bars-<SYM>.json) ──
 * Aggregates only — no bars ship to the browser. If the file is absent the Bar
 * Stats prompts render a "run the script" note instead of failing. */
type TodCell = { min: number; n: number; ret: number; absRet: number; range: number; up: number; vol: number; drift: number };
type RangeStat = { mean: number; p50: number; p75: number; p90: number; p95: number; p99: number; bodyPct: number };
type PatStat = { freq: number; n: number; expand: number; nextUp: number; brokeUp: number; brokeDn: number; bothSides: number };
export type BarStats = {
  symbol: string;
  hours: string;
  sessions: number;
  bars: number;
  from: string;
  to: string;
  tod: {
    min1: TodCell[];
    min5: TodCell[];
    min30: TodCell[];
    hour: TodCell[];
    hourByDow: Record<string, TodCell[]>;
    min30ByDow: Record<string, TodCell[]>;
  };
  vol: {
    ranges: Record<string, RangeStat>;
    patterns: Record<string, { medRange: number; inside: PatStat; outside: PatStat; narrowRange: PatStat }>;
    atrByHour: { key: string; n: number; atr: number; p90: number }[];
    atrByDow: { key: string; n: number; atr: number; p90: number }[];
  };
  auto: Record<
    string,
    {
      acf: { lag: number; v: number | null }[];
      acfAbs: { lag: number; v: number | null }[];
      vr: { q: number; v: number | null }[];
      streaks: {
        byRun: { run: number; n: number; cont: number }[];
        byRunHour: { run: number; hour: number; n: number; cont: number }[];
      };
    }
  >;
  /** fixed clock-hour reference candles → break-both/one/neither book + timing.
   *  Optional: only present on bars-*.json rebuilt after 2026-07. */
  refCandles?: Record<
    string,
    {
      label: string;
      window: string;
      postEnd: number;
      needsAllHours: boolean;
      n: number;
      upOnly: number;
      dnOnly: number;
      both: number;
      neither: number;
      bothByHalf: { min: number; n: number }[];
      medBothComplete: number | null;
      p75BothComplete: number | null;
      medFirstBreak: number | null;
    }
  >;
};

type Ctx = {
  es: SlimDay[];
  nq: SlimDay[];
  paired: { d: string; e: SlimDay; n: SlimDay }[];
  bars: Record<"ES" | "NQ", BarStats | null>;
};

/** A dropdown attached to a prompt. Lets several near-identical questions
 *  collapse into one card instead of ten. */
type Control = { id: string; label: string; options: { value: string; label: string }[] };
/** Selected control values for a prompt, keyed by control id. */
type Sel = Record<string, string>;

type Prompt = {
  id: string;
  cat: "Cross-index" | "Break quality" | "Context" | "Timing" | "Session shape" | "Bar stats";
  title: string;
  ask: string;
  controls?: Control[];
  run: (c: Ctx, s: Sel) => Result;
};

/* control option sets reused across the bar-stat prompts */
const SYM_OPT = { id: "sym", label: "Symbol", options: [{ value: "ES", label: "ES" }, { value: "NQ", label: "NQ" }] };
const TF_OPT = {
  id: "tf",
  label: "Timeframe",
  options: [
    { value: "1", label: "1 min" },
    { value: "5", label: "5 min" },
    { value: "15", label: "15 min" },
    { value: "30", label: "30 min" },
  ],
};
const MISSING = (sym: string): Result => ({
  headline: `No bar stats for ${sym} yet.`,
  rows: [],
  caveat: `Run:  node scripts/build-bar-stats.mjs --sym ${sym} --in "<path-to-${sym}-1min.csv>"  — it writes public/data/bars-${sym}.json from your raw 1-minute CSV. The browser never loads the CSV itself, only the aggregates.`,
});

/* small predicates over the slim day */
const brk = (d: SlimDay) => d.fcb;
const side = (d: SlimDay) => (d.fcb ? d.fcb.side : null);
const closeSide = (d: SlimDay) => (d.closeZone === "top25" ? "H" : d.closeZone === "bot25" ? "L" : null);
const worked = (d: SlimDay) => side(d) != null && closeSide(d) === side(d);

/** The slim export (ib-*.json from ib-backtest-esu6.html) ships atr + avgIB but
 *  leaves widthBucket null — the bucket rule lives in lib/ibStats.ts and the HTML
 *  exporter never replicated it, so every width prompt came up empty. Derive it
 *  here on load from the fields that ARE present. Same thresholds as ibStats. */
function backfillWidthBuckets(ds: IbDataset | null): IbDataset | null {
  if (!ds?.days) return ds;
  for (const d of ds.days) {
    if (d.widthBucket || d.atr == null || d.avgIB == null || !d.width) continue;
    d.widthBucket =
      d.width < 0.5 * d.atr || d.width < 0.75 * d.avgIB
        ? "narrow"
        : d.width > 1.5 * d.atr || d.width > 1.25 * d.avgIB
          ? "wide"
          : "normal";
  }
  return ds;
}

/* ── THE PROMPT LIBRARY ───────────────────────────────────────────────────── */

const PROMPTS: Prompt[] = [
  /* ─────────────── Cross-index ─────────────── */
  {
    id: "confirm-vs-diverge",
    cat: "Cross-index",
    title: "ES breaks IB high — does NQ confirm or diverge?",
    ask: "Split every ES IB-high break by what NQ did, and compare ES's own break quality across the cohorts. This is the one that tells you whether NQ disagreeing is a real reason to fade ES, or just the baseline fade rate.",
    run: ({ paired }) => {
      const pop = paired.filter(({ e }) => side(e) === "H");
      const coh = {
        "NQ confirmed FIRST": pop.filter(({ e, n }) => side(n) === "H" && n.fcb!.breakMin < e.fcb!.breakMin),
        "NQ confirmed AFTER": pop.filter(({ e, n }) => side(n) === "H" && n.fcb!.breakMin >= e.fcb!.breakMin),
        "NQ DIVERGED (broke low)": pop.filter(({ n }) => side(n) === "L"),
        "NQ never broke": pop.filter(({ n }) => side(n) == null),
      };
      const rows: Row[] = Object.entries(coh).map(([label, xs]) => ({
        label,
        n: xs.length,
        k: xs.filter(({ e }) => e.fcb!.hit["1"]).length,
        extra: {
          "of all": pctS(xs.length, pop.length),
          failed: pctS(xs.filter(({ e }) => e.fcb!.failed).length, xs.length),
          "→ mid": pctS(xs.filter(({ e }) => e.fcb!.fadeMid).length, xs.length),
          "→ IB low": pctS(xs.filter(({ e }) => e.fcb!.fadeOpp).length, xs.length),
          "med ext": (med(xs.map(({ e }) => e.fcb!.rExt)) ?? 0).toFixed(2),
          "closed top25": pctS(xs.filter(({ e }) => e.closeZone === "top25").length, xs.length),
        },
        emphasis: label.startsWith("NQ DIVERGED"),
      }));
      const cf = [...coh["NQ confirmed FIRST"], ...coh["NQ confirmed AFTER"]];
      const dv = coh["NQ DIVERGED (broke low)"];
      const cfHit = cf.filter(({ e }) => e.fcb!.hit["1"]).length;
      const dvHit = dv.filter(({ e }) => e.fcb!.hit["1"]).length;
      const delta = (100 * cfHit) / (cf.length || 1) - (100 * dvHit) / (dv.length || 1);
      return {
        headline: `${pop.length} ES IB-high breaks. "hit" column = reached 1.0× the IB width.`,
        cols: ["of all", "failed", "→ mid", "→ IB low", "med ext", "closed top25"],
        rows,
        verdict:
          dv.length < 30
            ? `Divergence cohort n=${dv.length} — too thin to trade off.`
            : `Confirmed: ${pctS(cfHit, cf.length)} reach 1×. Diverged: ${pctS(dvHit, dv.length)}. Confirmation is worth ${delta.toFixed(1)} pts of 1×-hit rate.`,
      };
    },
  },
  {
    id: "nq-leads-does-es-follow",
    cat: "Cross-index",
    title: "NQ breaks IB high FIRST — does ES follow?",
    ask: "Mirror of the above with NQ as the leader. Population is every NQ IB-high break; cohorts are what ES did. Grades NQ's own break quality, so the 'ES never broke' cohort still has numbers. Tells you whether NQ leading is a reason to buy ES, or whether NQ just runs alone.",
    run: ({ paired }) => {
      const pop = paired.filter(({ n }) => side(n) === "H");
      const coh = {
        "ES followed (NQ led)": pop.filter(({ e, n }) => side(e) === "H" && e.fcb!.breakMin > n.fcb!.breakMin),
        "ES broke first": pop.filter(({ e, n }) => side(e) === "H" && e.fcb!.breakMin <= n.fcb!.breakMin),
        "ES DIVERGED (broke low)": pop.filter(({ e }) => side(e) === "L"),
        "ES never broke": pop.filter(({ e }) => side(e) == null),
      };
      const rows: Row[] = Object.entries(coh).map(([label, xs]) => ({
        label,
        n: xs.length,
        k: xs.filter(({ n }) => n.fcb!.hit["1"]).length,
        extra: {
          "of all": pctS(xs.length, pop.length),
          "med ES lag": (() => {
            const l = med(xs.filter(({ e }) => side(e) === "H").map(({ e, n }) => e.fcb!.breakMin - n.fcb!.breakMin));
            return l == null ? "—" : `${l.toFixed(0)}m`;
          })(),
          failed: pctS(xs.filter(({ n }) => n.fcb!.failed).length, xs.length),
          "→ mid": pctS(xs.filter(({ n }) => n.fcb!.fadeMid).length, xs.length),
          "→ IB low": pctS(xs.filter(({ n }) => n.fcb!.fadeOpp).length, xs.length),
          "med ext": (med(xs.map(({ n }) => n.fcb!.rExt)) ?? 0).toFixed(2),
          "ES closed top25": pctS(xs.filter(({ e }) => e.closeZone === "top25").length, xs.length),
        },
        emphasis: label.startsWith("ES followed"),
      }));
      const led = coh["ES followed (NQ led)"];
      const alone = [...coh["ES DIVERGED (broke low)"], ...coh["ES never broke"]];
      const ledHit = led.filter(({ n }) => n.fcb!.hit["1"]).length;
      const aloneHit = alone.filter(({ n }) => n.fcb!.hit["1"]).length;
      const delta = (100 * ledHit) / (led.length || 1) - (100 * aloneHit) / (alone.length || 1);
      const esTop = led.filter(({ e }) => e.closeZone === "top25").length;
      return {
        headline: `${pop.length} NQ IB-high breaks. "hit" column = NQ reached 1.0× the IB width.`,
        cols: ["of all", "med ES lag", "failed", "→ mid", "→ IB low", "med ext", "ES closed top25"],
        rows,
        verdict:
          led.length < 30
            ? `NQ-led cohort n=${led.length} — too thin to trade off.`
            : `NQ leads and ES follows ${pctS(led.length, pop.length)} of the time (median lag ${
                med(led.map(({ e, n }) => e.fcb!.breakMin - n.fcb!.breakMin))?.toFixed(0) ?? "—"
              }m). NQ hits 1× ${pctS(ledHit, led.length)} when ES follows vs ${pctS(
                aloneHit,
                alone.length,
              )} when it runs alone — ${delta.toFixed(1)} pts. ES closed top25 in ${pctS(esTop, led.length)} of NQ-led days.`,
      };
    },
  },
  {
    id: "diverge-mix",
    cat: "Cross-index",
    title: "How often do ES and NQ break OPPOSITE sides?",
    ask: "The base rate for the whole divergence idea. If it's rare, every stat below it is thin.",
    run: ({ paired }) => {
      const both = paired.filter(({ e, n }) => brk(e) && brk(n));
      const agree = both.filter(({ e, n }) => side(e) === side(n));
      const div = both.filter(({ e, n }) => side(e) !== side(n));
      const one = paired.filter(({ e, n }) => !!brk(e) !== !!brk(n));
      const none = paired.filter(({ e, n }) => !brk(e) && !brk(n));
      const T = paired.length;
      return {
        headline: `${T} paired sessions.`,
        cols: ["share"],
        rows: [
          { label: "Both broke, SAME side", n: T, k: agree.length, extra: { share: pctS(agree.length, T) } },
          { label: "Both broke, OPPOSITE sides", n: T, k: div.length, extra: { share: pctS(div.length, T) }, emphasis: true },
          { label: "Only one broke", n: T, k: one.length, extra: { share: pctS(one.length, T) } },
          { label: "Neither broke", n: T, k: none.length, extra: { share: pctS(none.length, T) } },
        ],
        verdict: `Divergence happens ${pctS(div.length, T)} of sessions — n=${div.length}. That's the ceiling on every cross-index sample.`,
      };
    },
  },
  {
    id: "diverge-resolve",
    cat: "Cross-index",
    title: "On divergent days, does EITHER break resolve?",
    ask: "ES says up, NQ says down. Does the day pick a side by the close, or is divergence simply a chop tell?",
    run: ({ paired }) => {
      const div = paired.filter(({ e, n }) => brk(e) && brk(n) && side(e) !== side(n));
      const esLed = div.filter(({ e, n }) => closeSide(e) === side(e) && closeSide(n) === side(e));
      const nqLed = div.filter(({ e, n }) => closeSide(n) === side(n) && closeSide(e) === side(n));
      const neither = div.filter((x) => !esLed.includes(x) && !nqLed.includes(x));
      return {
        headline: `${div.length} divergent sessions. "Led" = BOTH indices closed in the direction of that index's break.`,
        cols: ["share"],
        rows: [
          { label: "ES led (day closed with ES)", n: div.length, k: esLed.length, extra: { share: pctS(esLed.length, div.length) } },
          { label: "NQ led (day closed with NQ)", n: div.length, k: nqLed.length, extra: { share: pctS(nqLed.length, div.length) } },
          { label: "Neither — closed mid", n: div.length, k: neither.length, extra: { share: pctS(neither.length, div.length) }, emphasis: true },
          { label: "ES break failed", n: div.length, k: div.filter(({ e }) => e.fcb!.failed).length },
          { label: "NQ break failed", n: div.length, k: div.filter(({ n }) => n.fcb!.failed).length },
        ],
        verdict: `Divergence is a CHOP signal before it's a direction signal — the modal outcome is neither side resolving.`,
        caveat: `"Led" is strict (both indices must close on that side). The looser own-close read will show higher numbers for both.`,
      };
    },
  },
  {
    id: "es-high-nq-low",
    cat: "Cross-index",
    title: "ES breaks IB high, NQ doesn't — does NQ go hit its IB LOW?",
    ask: "Today's exact shape. Conditional on ES confirming its high and NQ never confirming its own, how often does NQ roll to the other extreme?",
    run: ({ paired }) => {
      const pop = paired.filter(({ e, n }) => side(e) === "H" && side(n) !== "H");
      const broke = pop.filter(({ n }) => side(n) === "L");
      const wick = pop.filter(({ n }) => side(n) !== "L" && n.touchedL);
      const never = pop.filter(({ n }) => side(n) !== "L" && !n.touchedL);
      const after = broke.filter(({ e, n }) => n.fcb!.breakMin > e.fcb!.breakMin);
      const before = broke.filter(({ e, n }) => n.fcb!.breakMin < e.fcb!.breakMin);
      return {
        headline: `${pop.length} sessions where ES confirmed its IB high and NQ never confirmed its own.`,
        cols: ["share"],
        rows: [
          { label: "NQ CLOSE-BROKE its IB low", n: pop.length, k: broke.length, extra: { share: pctS(broke.length, pop.length) }, emphasis: true },
          { label: "NQ only wicked the low", n: pop.length, k: wick.length, extra: { share: pctS(wick.length, pop.length) } },
          { label: "NQ never reached the low", n: pop.length, k: never.length, extra: { share: pctS(never.length, pop.length) } },
          { label: "— of low-breaks: came AFTER ES's high break", n: broke.length, k: after.length },
          { label: "— of low-breaks: NQ was already short first", n: broke.length, k: before.length },
          { label: "ES's own high break failed anyway", n: pop.length, k: pop.filter(({ e }) => e.fcb!.failed).length },
        ],
        caveat: "Only the FIRST close-break of each session is timestamped in the export, so 'after' is provable only when NQ's low was its first break.",
      };
    },
  },
  {
    id: "first-breaker",
    cat: "Cross-index",
    title: "Follow the first breaker — does the leader drag the laggard?",
    ask: "On days both indices break the SAME side, whoever prints first is the mechanical leader. Is that worth anything?",
    run: ({ paired }) => {
      const agree = paired.filter(({ e, n }) => brk(e) && brk(n) && side(e) === side(n));
      const esF = agree.filter(({ e, n }) => e.fcb!.breakMin < n.fcb!.breakMin);
      const nqF = agree.filter(({ e, n }) => n.fcb!.breakMin < e.fcb!.breakMin);
      const tie = agree.filter(({ e, n }) => e.fcb!.breakMin === n.fcb!.breakMin);
      const gaps = agree.map(({ e, n }) => Math.abs(e.fcb!.breakMin - n.fcb!.breakMin));
      const follow = agree.filter(({ e, n }) => {
        const f = e.fcb!.breakMin <= n.fcb!.breakMin ? side(e) : side(n);
        return closeSide(e) === f || closeSide(n) === f;
      });
      return {
        headline: `${agree.length} agreeing sessions. Median gap between the two breaks: ${med(gaps) ?? "—"} min.`,
        cols: ["share"],
        rows: [
          { label: "ES broke first", n: agree.length, k: esF.length, extra: { share: pctS(esF.length, agree.length) } },
          { label: "NQ broke first", n: agree.length, k: nqF.length, extra: { share: pctS(nqF.length, agree.length) } },
          { label: "Same bar", n: agree.length, k: tie.length, extra: { share: pctS(tie.length, agree.length) } },
          { label: "Day closed WITH the first breaker", n: agree.length, k: follow.length, extra: { share: pctS(follow.length, agree.length) }, emphasis: true },
        ],
        verdict: `Neither index is a structural leader (near 50/50). The leader is whoever moves first that day.`,
      };
    },
  },
  {
    id: "nq-alone",
    cat: "Cross-index",
    title: "One index breaks, the other stays inside — who's right?",
    ask: "A lone break with no confirmation. Does the breaker follow through, or get dragged back by the index that never left the box?",
    run: ({ paired }) => {
      const esOnly = paired.filter(({ e, n }) => brk(e) && !brk(n));
      const nqOnly = paired.filter(({ e, n }) => !brk(e) && brk(n));
      const stat = (xs: typeof esOnly, pick: (x: { e: SlimDay; n: SlimDay }) => SlimDay) => ({
        n: xs.length,
        k: xs.filter((x) => worked(pick(x))).length,
        extra: {
          failed: pctS(xs.filter((x) => pick(x).fcb!.failed).length, xs.length),
          "hit 1×": pctS(xs.filter((x) => pick(x).fcb!.hit["1"]).length, xs.length),
          "med ext": (med(xs.map((x) => pick(x).fcb!.rExt)) ?? 0).toFixed(2),
        },
      });
      const a = stat(esOnly, (x) => x.e);
      const b = stat(nqOnly, (x) => x.n);
      return {
        headline: `Lone breaks — the other index never confirmed. "hit" = that index's own close agreed with its break.`,
        cols: ["failed", "hit 1×", "med ext"],
        rows: [
          { label: "ES broke alone (NQ inside)", ...a },
          { label: "NQ broke alone (ES inside)", ...b },
        ],
      };
    },
  },

  /* ─────────────── Break quality ─────────────── */
  {
    id: "break-baseline",
    cat: "Break quality",
    title: "Baseline: what does an IB break actually do?",
    ask: "The number every other stat has to beat. Read this before you get excited about any cohort.",
    run: ({ es, nq }) => {
      const mk = (days: SlimDay[], label: string): Row[] => {
        const b = days.filter((d) => d.fcb);
        // Row 1 is a share of ALL sessions; the rest are shares of the BREAKS.
        // The denominator changes, so it's stated in the label rather than
        // smuggled into a mystery column.
        return [
          { label: `${label} — sessions that broke the IB at all`, n: days.length, k: b.length },
          { label: `${label} — of those breaks: FAILED (back inside ≤30m)`, n: b.length, k: b.filter((d) => d.fcb!.failed).length, emphasis: true },
          { label: `${label} — of those breaks: hit 0.5× the IB width`, n: b.length, k: b.filter((d) => d.fcb!.hit["0.5"]).length },
          { label: `${label} — of those breaks: hit 1.0×`, n: b.length, k: b.filter((d) => d.fcb!.hit["1"]).length },
          { label: `${label} — of those breaks: hit 2.0×`, n: b.length, k: b.filter((d) => d.fcb!.hit["2"]).length },
          { label: `${label} — of those breaks: full rotation to the other extreme`, n: b.length, k: b.filter((d) => d.fcb!.fadeOpp).length },
        ];
      };
      // The rows above OVERLAP — a break can be FAILED and still hit 1.0× later
      // (it recovered). failed + hit1x sums past 100%, so these can never be read
      // as a partition or charted as one. The exclusive four-way split lives in
      // the "break failed — what happens next?" prompt. Said plainly here so the
      // table can't be misread as a composition.
      return {
        headline: "The unconditional IB-break book. Everything else in this tab is a deviation from these numbers.",
        rows: [...mk(es, "ES"), ...mk(nq, "NQ")],
        verdict: "IB breaks fail most of the time. A cohort is only interesting if it moves the FAIL rate materially off this line.",
        caveat:
          "These rows OVERLAP — they are not a partition. A break can fail (close back inside within 30m) and still reach 1.0× afterwards, so FAILED + hit 1.0× sums past 100%. Don't add them up, and don't chart them as parts of a whole. For a real breakdown use \"The break failed — what ACTUALLY happens next?\", whose four outcomes are exclusive.",
      };
    },
  },
  {
    id: "by-width",
    cat: "Break quality",
    title: "Narrow vs wide IB — which break carries?",
    ask: "Compression should pay on the break; a wide IB has already spent the day's range. Does the data agree?",
    run: ({ es }) => {
      const b = es.filter((d) => d.fcb && d.widthBucket);
      const rows = (["narrow", "normal", "wide"] as const).map((w) => {
        const xs = b.filter((d) => d.widthBucket === w);
        return {
          label: `IB ${w}`,
          n: xs.length,
          k: xs.filter((d) => d.fcb!.hit["1"]).length,
          extra: {
            failed: pctS(xs.filter((d) => d.fcb!.failed).length, xs.length),
            "hit 2×": pctS(xs.filter((d) => d.fcb!.hit["2"]).length, xs.length),
            "med ext": (med(xs.map((d) => d.fcb!.rExt)) ?? 0).toFixed(2),
          },
          emphasis: w === "narrow",
        };
      });
      return {
        headline: `ES breaks bucketed by IB width. "hit" = reached 1.0× the IB width. Extension is in IB widths, so it's already size-normalized.`,
        cols: ["failed", "hit 2×", "med ext"],
        rows,
        caveat: b.length === 0 ? "No width buckets — needs atr + avgIB on the slim days (the tab derives the bucket from them on load). If this is empty, atr/avgIB are missing from the export." : undefined,
      };
    },
  },
  {
    id: "vol-surge",
    cat: "Break quality",
    title: "Did volume confirm the break?",
    ask: "The oldest tell in the book: a break on a volume surge vs a break on air.",
    run: ({ es, nq }) => {
      const rows: Row[] = [];
      for (const [label, days] of [["ES", es], ["NQ", nq]] as const) {
        const b = days.filter((d) => d.fcb);
        for (const [k, xs] of [["vol surge", b.filter((d) => d.fcb!.volSurge)], ["no surge", b.filter((d) => !d.fcb!.volSurge)]] as const) {
          rows.push({
            label: `${label} — ${k}`,
            n: xs.length,
            k: xs.filter((d) => d.fcb!.hit["1"]).length,
            extra: {
              failed: pctS(xs.filter((d) => d.fcb!.failed).length, xs.length),
              "med ext": (med(xs.map((d) => d.fcb!.rExt)) ?? 0).toFixed(2),
            },
            emphasis: k === "vol surge",
          });
        }
      }
      return { headline: `"hit" = reached 1.0× IB width. Surge = break bar volume above the IB's own average bar.`, cols: ["failed", "med ext"], rows };
    },
  },
  {
    id: "retest",
    cat: "Break quality",
    title: "Break, retest, hold — does the retest entry pay?",
    ask: "The textbook entry. Of breaks that come back to the level and hold, how many make a new extreme?",
    run: ({ es, nq }) => {
      const rows: Row[] = [];
      for (const [label, days] of [["ES", es], ["NQ", nq]] as const) {
        const b = days.filter((d) => d.fcb);
        const r = b.filter((d) => d.fcb!.retest);
        const held = r.filter((d) => d.fcb!.retestCont === true);
        rows.push({ label: `${label} — breaks that retested`, n: b.length, k: r.length, extra: { "": "" } });
        rows.push({ label: `${label} — retest then NEW extreme`, n: r.length, k: held.length, emphasis: true, extra: { "": "" } });
        const fa = b.filter((d) => d.fcb!.fibA.hit);
        rows.push({ label: `${label} — 0.25 IB pullback filled, then continued`, n: fa.length, k: fa.filter((d) => d.fcb!.fibA.cont).length, extra: { "": "" } });
      }
      return { headline: "Retest = back within 2 ticks of the broken level, close still outside.", rows };
    },
  },

  {
    id: "fail-outcome",
    cat: "Break quality",
    title: "The break failed — what ACTUALLY happens next?",
    ask: "ES breaks the IB high and closes back inside within 30 minutes. That's the 85% case, and on its own it's a non-answer. Does it recover and go anyway? Does it drift to the mid? Rotate all the way to the low? Or just die in the middle and chop? Four mutually exclusive outcomes, so they sum to the whole failed book.",
    run: ({ es, nq }) => {
      const LBL: Record<FailOutcome, string> = {
        recovered: "RECOVERED — new extreme past the pre-fail peak (the shakeout)",
        full_rotation: "FULL ROTATION — reached the opposite IB extreme",
        to_mid: "TO THE MID — reached the midpoint, no further",
        chop: "CHOP — never saw the mid, never re-took its high",
      };
      const ORDER: FailOutcome[] = ["recovered", "chop", "to_mid", "full_rotation"];
      const rows: Row[] = [];
      for (const [label, days] of [["ES", es], ["NQ", nq]] as const) {
        const failed = days
          .filter((d) => d.fcb && d.fcb.failed)
          .map((d) => ({ d, o: failOutcome(d.fcb!, d.width)! }));
        for (const o of ORDER) {
          const xs = failed.filter((x) => x.o === o);
          rows.push({
            label: `${label} — ${LBL[o]}`,
            n: failed.length,
            k: xs.length,
            emphasis: o === "chop" || o === "full_rotation",
            extra: {
              "med ext": (med(xs.map((x) => x.d.fcb!.rExt)) ?? 0).toFixed(2),
              "closed mid50": pctS(xs.filter((x) => x.d.closeZone === "mid50").length, xs.length),
              "closed with the break": pctS(xs.filter((x) => worked(x.d)).length, xs.length),
            },
          });
        }
      }
      const esFailed = es.filter((d) => d.fcb?.failed).map((d) => failOutcome(d.fcb!, d.width)!);
      const dead = esFailed.filter((o) => o === "chop" || o === "to_mid").length;
      const rot = esFailed.filter((o) => o === "full_rotation").length;
      const rec = esFailed.filter((o) => o === "recovered").length;

      // Composition bars are legitimate HERE and nowhere else in this tab: these
      // four states are exclusive and exhaustive, so they genuinely partition the
      // failed book. COL order = the story: shakeout → nothing → drift → rotation.
      const COLOR: Record<FailOutcome, string> = {
        recovered: LIGHT_BLUE,
        chop: "rgba(255,255,255,0.28)",
        to_mid: HOME_THEME.orange,
        full_rotation: HOME_THEME.red,
      };
      const SHORT: Record<FailOutcome, string> = {
        recovered: "Recovered",
        chop: "Chop",
        to_mid: "To the mid",
        full_rotation: "Full rotation",
      };
      const stack: Stack[] = ([["ES", es], ["NQ", nq]] as const).map(([label, days]) => {
        const f = days.filter((d) => d.fcb?.failed).map((d) => failOutcome(d.fcb!, d.width)!);
        return {
          label,
          segs: ORDER.map((o) => ({
            name: SHORT[o],
            pct: f.length ? (100 * f.filter((x) => x === o).length) / f.length : 0,
            color: COLOR[o],
          })),
        };
      });

      return {
        headline: "Only failed breaks. The four outcomes are exclusive and exhaustive — they add to 100% per index, which is why they can be stacked.",
        cols: ["med ext", "closed mid50", "closed with the break"],
        stack,
        rows,
        verdict:
          `ES failed breaks: ${pctS(rec, esFailed.length)} recover and go anyway, ${pctS(rot, esFailed.length)} rotate to the far extreme, ` +
          `${pctS(dead, esFailed.length)} go nowhere useful (chop or a drift to the mid). ` +
          `The fade is only a trade in the rotation slice — the rest of the time you're paying spread in the middle of the range.`,
        caveat:
          "RECOVERED uses the wick high, not a close, so it's the loosest bucket — treat it as the ceiling on 'the break was right after all'.",
      };
    },
  },
  {
    id: "fail-outcome-by-context",
    cat: "Break quality",
    title: "Which failed breaks actually rotate?",
    ask: "If the fade only pays on full rotation, the question is what a rotation looks like at the moment it fails. Slice the failed book by IB width, volume at the break, and how far it got before it rolled over.",
    run: ({ es }) => {
      const failed = es
        .filter((d) => d.fcb && d.fcb.failed)
        .map((d) => ({ d, o: failOutcome(d.fcb!, d.width)! }));
      const line = (label: string, xs: typeof failed, emphasis = false): Row => ({
        label,
        n: xs.length,
        k: xs.filter((x) => x.o === "full_rotation").length,
        emphasis,
        extra: {
          recovered: pctS(xs.filter((x) => x.o === "recovered").length, xs.length),
          "to mid": pctS(xs.filter((x) => x.o === "to_mid").length, xs.length),
          chop: pctS(xs.filter((x) => x.o === "chop").length, xs.length),
        },
      });
      const peak = (x: (typeof failed)[number]) => x.d.fcb!.peakBeforeFail / x.d.width;
      return {
        headline: `ES failed breaks only. The rate column = FULL ROTATION (reached the opposite IB extreme) — the only outcome the fade actually gets paid on.`,
        cols: ["recovered", "to mid", "chop"],
        rows: [
          line("ALL failed breaks", failed, true),
          line("IB narrow", failed.filter((x) => x.d.widthBucket === "narrow")),
          line("IB normal", failed.filter((x) => x.d.widthBucket === "normal")),
          line("IB wide", failed.filter((x) => x.d.widthBucket === "wide")),
          line("Volume surge on the break bar", failed.filter((x) => x.d.fcb!.volSurge)),
          line("No volume surge", failed.filter((x) => !x.d.fcb!.volSurge)),
          line("Poked <0.25 IB past the level before failing", failed.filter((x) => peak(x) < 0.25)),
          line("Poked 0.25–0.5 IB past", failed.filter((x) => peak(x) >= 0.25 && peak(x) < 0.5)),
          line("Poked >0.5 IB past before failing", failed.filter((x) => peak(x) >= 0.5)),
          line("Broke before 11:00", failed.filter((x) => x.d.fcb!.breakMin < 660)),
          line("Broke after 12:00", failed.filter((x) => x.d.fcb!.breakMin >= 720)),
        ],
        verdict: "Find the slice where FULL ROTATION runs meaningfully above the all-failed baseline. If none of them do, the failed break isn't a fade setup — it's just noise.",
      };
    },
  },

  /* ─────────────── Context ─────────────── */
  {
    id: "open-type",
    cat: "Context",
    title: "Open type — does a gap open change the break?",
    ask: "Open above yesterday's range (OAR) vs inside it (IR). Gaps are supposed to trend or fill; which is it?",
    run: ({ es }) => {
      const b = es.filter((d) => d.fcb && d.openType);
      const rows = (["OAR-H", "OAR-L", "HIR", "LIR"] as const).map((t) => {
        const xs = b.filter((d) => d.openType === t);
        return {
          label: t,
          n: xs.length,
          k: xs.filter((d) => worked(d)).length,
          extra: {
            "broke high": pctS(xs.filter((d) => side(d) === "H").length, xs.length),
            failed: pctS(xs.filter((d) => d.fcb!.failed).length, xs.length),
            "hit 1×": pctS(xs.filter((d) => d.fcb!.hit["1"]).length, xs.length),
          },
        };
      });
      return { headline: `ES. "hit" = the day's IB close zone agreed with the break side.`, cols: ["broke high", "failed", "hit 1×"], rows };
    },
  },
  {
    id: "orb",
    cat: "Context",
    title: "Does the 9:30–9:45 ORB predict the IB break side?",
    ask: "The first 15 minutes vs the first hour. If the opening drive already told you, the IB break is late information.",
    run: ({ es }) => {
      const b = es.filter((d) => d.fcb && d.orbDir);
      const agree = b.filter((d) => d.orbDir === side(d));
      const rows: Row[] = [
        { label: "IB break matched the ORB direction", n: b.length, k: agree.length, emphasis: true },
        { label: "…and that break then hit 1×", n: agree.length, k: agree.filter((d) => d.fcb!.hit["1"]).length },
        { label: "…and that break FAILED", n: agree.length, k: agree.filter((d) => d.fcb!.failed).length },
        { label: "IB break went AGAINST the ORB", n: b.length, k: b.length - agree.length },
        { label: "…and that break FAILED", n: b.length - agree.length, k: b.filter((d) => d.orbDir !== side(d) && d.fcb!.failed).length },
      ];
      return { headline: "ES. ORB = first close outside the 09:30–09:45 range, measured inside the IB.", rows };
    },
  },
  {
    id: "fvg",
    cat: "Context",
    title: "IB fair-value gap — does the imbalance point the break?",
    ask: "A 15m FVG printed inside the IB. Does the break honor it, and does the day fill back to the mid?",
    run: ({ es }) => {
      const b = es.filter((d) => d.fcb && d.fvg);
      const want = (d: SlimDay) => (d.fvg === "bull" ? "H" : "L");
      const agree = b.filter((d) => side(d) === want(d));
      return {
        headline: "ES. FVG = 3-bar 15m imbalance built from the IB's 5m bars.",
        rows: [
          { label: "Break agreed with the FVG direction", n: b.length, k: agree.length, emphasis: true },
          { label: "…and hit 1×", n: agree.length, k: agree.filter((d) => d.fcb!.hit["1"]).length },
          { label: "…and FAILED", n: agree.length, k: agree.filter((d) => d.fcb!.failed).length },
          { label: "Break went against the FVG, and failed", n: b.length - agree.length, k: b.filter((d) => side(d) !== want(d) && d.fcb!.failed).length },
        ],
      };
    },
  },
  {
    id: "dow",
    cat: "Context",
    title: "Day of week — is any day the chop day?",
    ask: "Cheap slice, easy to fool yourself with. Included so you can see how thin the cells get.",
    run: ({ es, paired }) => {
      const rows = ["Mon", "Tue", "Wed", "Thu", "Fri"].map((w) => {
        const xs = es.filter((d) => dow(d.date) === w);
        const b = xs.filter((d) => d.fcb);
        const pr = paired.filter(({ d }) => dow(d) === w);
        const div = pr.filter(({ e, n }) => brk(e) && brk(n) && side(e) !== side(n));
        return {
          label: w,
          n: b.length,
          k: b.filter((d) => d.fcb!.failed).length,
          extra: {
            "no break": pctS(xs.filter((d) => d.neitherBroke).length, xs.length),
            "ES/NQ diverged": pctS(div.length, pr.length),
            "hit 1×": pctS(b.filter((d) => d.fcb!.hit["1"]).length, b.length),
          },
        };
      });
      return {
        headline: `ES. "hit" column here = FAILED break rate (the thing you care about by weekday).`,
        cols: ["no break", "ES/NQ diverged", "hit 1×"],
        rows,
        caveat: "Five cells over one dataset. Differences under ~5 pts here are noise — don't build a rule on it.",
      };
    },
  },

  /* ─────────────── Timing ─────────────── */
  {
    id: "break-time",
    cat: "Timing",
    title: "When does the break come, and does the clock matter?",
    ask: "An 10:35 break and a 14:50 break are not the same trade. Bucket by time of first break.",
    run: ({ es }) => {
      const b = es.filter((d) => d.fcb);
      const buckets: [string, (m: number) => boolean][] = [
        ["10:30–11:00", (m) => m < 660],
        ["11:00–12:00", (m) => m >= 660 && m < 720],
        ["12:00–14:00", (m) => m >= 720 && m < 840],
        ["14:00–close", (m) => m >= 840],
      ];
      const rows = buckets.map(([label, f]) => {
        const xs = b.filter((d) => f(d.fcb!.breakMin));
        return {
          label,
          n: xs.length,
          k: xs.filter((d) => d.fcb!.hit["1"]).length,
          extra: {
            share: pctS(xs.length, b.length),
            failed: pctS(xs.filter((d) => d.fcb!.failed).length, xs.length),
            "med ext": (med(xs.map((d) => d.fcb!.rExt)) ?? 0).toFixed(2),
          },
          emphasis: label === "10:30–11:00",
        };
      });
      return { headline: `ES, ${b.length} breaks. "hit" = reached 1.0× IB width.`, cols: ["share", "failed", "med ext"], rows };
    },
  },
  {
    id: "contained",
    cat: "Timing",
    title: "Still inside the IB at 2pm — HIGH or LOW into the close?",
    ask: "The dead day. Price never left the box through 14:00. Does it stay dead, and when it finally goes, which way — and does that break actually pay?",
    run: ({ es, nq }) => {
      const rows: Row[] = [];
      for (const [label, days] of [["ES", es], ["NQ", nq]] as const) {
        const c = days.filter((d) => d.containedAt2);
        // On a contained day nothing broke before 14:00 by construction, so the
        // day's FIRST close-break IS the late break. No extra data needed.
        const hi = c.filter((d) => side(d) === "H");
        const lo = c.filter((d) => side(d) === "L");
        const wick = c.filter((d) => !d.fcb && (d.touchedH || d.touchedL));
        const dead = c.filter((d) => !d.fcb && !d.touchedH && !d.touchedL);
        const q = (xs: SlimDay[]) => ({
          failed: pctS(xs.filter((d) => d.fcb!.failed).length, xs.length),
          "hit 0.5×": pctS(xs.filter((d) => d.fcb!.hit["0.5"]).length, xs.length),
          "hit 1×": pctS(xs.filter((d) => d.fcb!.hit["1"]).length, xs.length),
          "med ext": (med(xs.map((d) => d.fcb!.rExt)) ?? 0).toFixed(2),
          "closed with it": pctS(xs.filter((d) => worked(d)).length, xs.length),
        });
        rows.push({
          label: `${label} — contained at 14:00 (share of all sessions)`,
          n: days.length,
          k: c.length,
          extra: { failed: "", "hit 0.5×": "", "hit 1×": "", "med ext": "", "closed with it": "" },
        });
        rows.push({ label: `${label} — late CLOSE-BREAK of the IB HIGH`, n: c.length, k: hi.length, emphasis: true, extra: q(hi) });
        rows.push({ label: `${label} — late CLOSE-BREAK of the IB LOW`, n: c.length, k: lo.length, emphasis: true, extra: q(lo) });
        rows.push({
          label: `${label} — late WICK only, no close outside`,
          n: c.length,
          k: wick.length,
          extra: { failed: "", "hit 0.5×": "", "hit 1×": "", "med ext": "", "closed with it": "" },
        });
        rows.push({
          label: `${label} — stayed fully inside into the close (dead)`,
          n: c.length,
          k: dead.length,
          extra: { failed: "", "hit 0.5×": "", "hit 1×": "", "med ext": "", "closed with it": "" },
        });
      }
      return {
        headline:
          "Contained = the whole post-IB session stayed inside the IB through 14:00 ET. The four outcomes below are exclusive and sum to the contained book. All quality columns are the LATE break's own.",
        cols: ["failed", "hit 0.5×", "hit 1×", "med ext", "closed with it"],
        rows,
        verdict:
          "The question isn't whether it breaks late — it's whether the late break carries. Compare 'hit 1×' and 'failed' here against the unconditional break baseline. A late break has less clock left to work with, so it should be materially worse; if it isn't, that's the finding.",
        caveat:
          "'closed with it' = the day's IB close zone agreed with the break side. On a 15:30 break there's barely any session left to be wrong in, so it flatters the late break — read it next to med ext, not alone.",
      };
    },
  },
  {
    id: "contained-timing",
    cat: "Timing",
    title: "Contained day — WHEN the late break comes, and does the clock kill it?",
    ask: "A 14:05 break has ninety minutes to work. A 15:40 break has twenty. Bucket the contained-day break by time of day and see where the follow-through dies.",
    run: ({ es }) => {
      const c = es.filter((d) => d.containedAt2 && d.fcb);
      const buckets: [string, (m: number) => boolean][] = [
        ["14:00–14:30", (m) => m >= 840 && m < 870],
        ["14:30–15:00", (m) => m >= 870 && m < 900],
        ["15:00–15:30", (m) => m >= 900 && m < 930],
        ["15:30–close", (m) => m >= 930],
      ];
      const rows: Row[] = buckets.map(([label, f]) => {
        const xs = c.filter((d) => f(d.fcb!.breakMin));
        return {
          label,
          n: c.length,
          k: xs.length,
          extra: {
            "broke HIGH": pctS(xs.filter((d) => side(d) === "H").length, xs.length),
            failed: pctS(xs.filter((d) => d.fcb!.failed).length, xs.length),
            "hit 0.5×": pctS(xs.filter((d) => d.fcb!.hit["0.5"]).length, xs.length),
            "hit 1×": pctS(xs.filter((d) => d.fcb!.hit["1"]).length, xs.length),
            "med ext": (med(xs.map((d) => d.fcb!.rExt)) ?? 0).toFixed(2),
          },
        };
      });
      rows.push({
        label: "— for reference: ALL ES breaks, any time of day",
        n: es.filter((d) => d.fcb).length,
        k: es.filter((d) => d.fcb).length,
        emphasis: true,
        extra: {
          "broke HIGH": pctS(es.filter((d) => side(d) === "H").length, es.filter((d) => d.fcb).length),
          failed: pctS(es.filter((d) => d.fcb?.failed).length, es.filter((d) => d.fcb).length),
          "hit 0.5×": pctS(es.filter((d) => d.fcb?.hit["0.5"]).length, es.filter((d) => d.fcb).length),
          "hit 1×": pctS(es.filter((d) => d.fcb?.hit["1"]).length, es.filter((d) => d.fcb).length),
          "med ext": (med(es.filter((d) => d.fcb).map((d) => d.fcb!.rExt)) ?? 0).toFixed(2),
        },
      });
      return {
        headline: "ES contained days only. Rate column = share of contained breaks landing in that window. Quality columns are that window's own.",
        cols: ["broke HIGH", "failed", "hit 0.5×", "hit 1×", "med ext"],
        rows,
        verdict:
          "The bottom row is the benchmark. If the 14:00–14:30 bucket holds up against it but 15:30 collapses, the trade is a cutoff rule, not a setup: after some hour the late break is untradeable regardless of how clean it looks.",
      };
    },
  },
  {
    id: "contained-direction",
    cat: "Timing",
    title: "Contained day — can you PREDICT which way it breaks late?",
    ask: "You're sitting in a dead range at 2pm. Anything in the session so far that tells you which side gives? Test the IB-close bias, the FVG, the open type, and which extreme got probed first.",
    run: ({ es }) => {
      const c = es.filter((d) => d.containedAt2 && d.fcb);
      const line = (label: string, xs: SlimDay[], emphasis = false): Row => ({
        label,
        n: xs.length,
        k: xs.filter((d) => side(d) === "H").length,
        emphasis,
        extra: {
          "then failed": pctS(xs.filter((d) => d.fcb!.failed).length, xs.length),
          "hit 1×": pctS(xs.filter((d) => d.fcb!.hit["1"]).length, xs.length),
          "closed with it": pctS(xs.filter((d) => worked(d)).length, xs.length),
        },
      });
      return {
        headline: "ES contained days that eventually close-broke. Rate column = how often the late break was the HIGH. 50% means the tell is worthless.",
        cols: ["then failed", "hit 1×", "closed with it"],
        rows: [
          line("ALL contained days (the coin-flip baseline)", c, true),
          line("IB closed ABOVE the IB mid (bullish bias)", c.filter((d) => d.bias === "H")),
          line("IB closed BELOW the IB mid (bearish bias)", c.filter((d) => d.bias === "L")),
          line("Bullish FVG inside the IB", c.filter((d) => d.fvg === "bull")),
          line("Bearish FVG inside the IB", c.filter((d) => d.fvg === "bear")),
          line("Opened above yesterday's range (OAR-H)", c.filter((d) => d.openType === "OAR-H")),
          line("Opened below yesterday's range (OAR-L)", c.filter((d) => d.openType === "OAR-L")),
          line("ORB direction was UP", c.filter((d) => d.orbDir === "H")),
          line("ORB direction was DOWN", c.filter((d) => d.orbDir === "L")),
          line("IB high printed first in the IB", c.filter((d) => d.first === "H")),
          line("IB low printed first in the IB", c.filter((d) => d.first === "L")),
          line("IB was NARROW", c.filter((d) => d.widthBucket === "narrow")),
          line("IB was WIDE", c.filter((d) => d.widthBucket === "wide")),
        ],
        verdict:
          "Read this against the baseline row, not against 50 in the abstract. A tell is only real if it moves the HIGH-break rate well off the all-contained line AND doesn't wreck the failure rate in the process.",
        caveat: "Slicing a subset of a subset. Cells will go thin fast — respect the THIN badges here more than anywhere else in this tab.",
      };
    },
  },

  /* ─────────────── Session shape ─────────────── */
  {
    id: "width-break-odds",
    cat: "Session shape",
    title: "IB width → does it break one side, both, or neither?",
    ask: "The first read of the day. A narrow IB is coiled and should resolve directionally; a wide IB has already spent range and should stay contained. This is the base rate for the three ways a session can treat its IB — split by how wide the IB opened. One-side / both-sides / neither is a true partition: every RTH session lands in exactly one.",
    run: ({ es, nq }) => {
      const rows: Row[] = [];
      const stack: Stack[] = [];
      for (const [sym, days] of [["ES", es], ["NQ", nq]] as const) {
        const withBucket = days.filter((d) => d.widthBucket);
        for (const w of ["narrow", "normal", "wide"] as const) {
          const xs = withBucket.filter((d) => d.widthBucket === w);
          const one = xs.filter((d) => d.singleBreak).length;
          const both = xs.filter((d) => d.bothBroke).length;
          const none = xs.filter((d) => d.neitherBroke).length;
          const wpts = xs.map((d) => d.width).sort((a, b) => a - b);
          const range = wpts.length ? `${wpts[0].toFixed(1)}–${wpts[wpts.length - 1].toFixed(1)}` : "—";
          rows.push({
            label: `${sym} ${w} IB`,
            n: xs.length,
            k: one, // headline = ONE side only, the clean directional break
            extra: {
              "both sides": pctS(both, xs.length),
              neither: pctS(none, xs.length),
              "width (pts)": range,
              "med width": med(wpts) != null ? med(wpts)!.toFixed(1) : "—",
            },
            emphasis: w === "narrow",
          });
          stack.push({
            label: `${sym} ${w}`,
            segs: [
              { name: "One side", pct: xs.length ? (100 * one) / xs.length : 0, color: HOME_THEME.green },
              { name: "Both sides", pct: xs.length ? (100 * both) / xs.length : 0, color: HOME_THEME.orange },
              { name: "Neither", pct: xs.length ? (100 * none) / xs.length : 0, color: "rgba(255,255,255,0.28)" },
            ],
          });
        }
      }
      return {
        headline: "One side / both sides / neither is a true partition — every session is exactly one. The 'k' column is the ONE-SIDE (single directional break) rate; both-sides and neither are the extra columns.",
        cols: ["both sides", "neither", "width (pts)", "med width"],
        rows,
        stack,
        verdict: "Narrow should skew toward a single directional break; wide should skew toward 'neither' (contained) or 'both' (rotation). Read the single-break rate against the width — that's the coil-vs-spent read.",
        caveat:
          "Width buckets are RELATIVE and re-derived each day — not fixed point cutoffs. NARROW = width < 0.5×ATR14(RTH range) OR < 0.75× the 20-day avg IB. WIDE = width > 1.5×ATR14 OR > 1.25× the 20-day avg IB. NORMAL is everything between. The 'width (pts)' column shows the observed point span that landed in each bucket over the sample. Buckets are derived on load from each day's atr + avgIB; if every bucket is empty, those two fields are missing from the export.",
      };
    },
  },
  {
    id: "both-broke",
    cat: "Session shape",
    title: "Both sides of the IB broke — the rotation day",
    ask: "When one index takes out both its own extremes, the day is rotational by definition. How often, and where does it close?",
    run: ({ es, nq }) => {
      const rows: Row[] = [];
      for (const [label, days] of [["ES", es], ["NQ", nq]] as const) {
        const bb = days.filter((d) => d.bothBroke);
        rows.push({
          label: `${label} — both extremes taken`,
          n: days.length,
          k: bb.length,
          extra: {
            "closed mid50": pctS(bb.filter((d) => d.closeZone === "mid50").length, bb.length),
            "first break failed": pctS(bb.filter((d) => d.fcb && d.fcb.failed).length, bb.length),
          },
          emphasis: true,
        });
        rows.push({
          label: `${label} — single break only`,
          n: days.length,
          k: days.filter((d) => d.singleBreak).length,
          extra: {
            "closed mid50": pctS(days.filter((d) => d.singleBreak && d.closeZone === "mid50").length, days.filter((d) => d.singleBreak).length),
            "first break failed": pctS(days.filter((d) => d.singleBreak && d.fcb?.failed).length, days.filter((d) => d.singleBreak).length),
          },
        });
      }
      return { headline: "Both-broke = the day wicked or closed through BOTH IB extremes.", cols: ["closed mid50", "first break failed"], rows };
    },
  },
  {
    id: "first-touch",
    cat: "Session shape",
    title: "First touch vs first close-break — is the wick a trap?",
    ask: "Price pokes one side, then the confirmed break comes out the other. How often is the first touch the wrong side?",
    run: ({ es }) => {
      const b = es.filter((d) => d.fcb && d.firstTouchSide);
      const trap = b.filter((d) => d.firstTouchSide !== side(d));
      return {
        headline: "ES. First touch = first wick outside the IB. Break = first CLOSE outside.",
        rows: [
          { label: "First touch was the OPPOSITE side of the eventual break", n: b.length, k: trap.length, emphasis: true },
          { label: "…and that break then hit 1×", n: trap.length, k: trap.filter((d) => d.fcb!.hit["1"]).length },
          { label: "…and that break FAILED too", n: trap.length, k: trap.filter((d) => d.fcb!.failed).length },
        ],
        verdict: "If this rate is high, the wick out of one side is a liquidity grab before the real break — but check the fail rate before you trade it.",
      };
    },
  },
  {
    id: "no-mid-return",
    cat: "Session shape",
    title: "Trend day filter — the break that never sees the IB mid again",
    ask: "The only IB break worth holding all day. How rare is it, and what does it look like at the break?",
    run: ({ es }) => {
      const b = es.filter((d) => d.fcb);
      const trend = b.filter((d) => d.noMidReturn);
      return {
        headline: `ES, ${b.length} breaks. noMidReturn = after the break, price never traded back to the IB midpoint.`,
        cols: ["vol surge at break", "med ext"],
        rows: [
          {
            label: "Never returned to the IB mid (trend day)",
            n: b.length,
            k: trend.length,
            emphasis: true,
            extra: {
              "vol surge at break": pctS(trend.filter((d) => d.fcb!.volSurge).length, trend.length),
              "med ext": (med(trend.map((d) => d.fcb!.rExt)) ?? 0).toFixed(2),
            },
          },
          {
            label: "Came back to the mid at some point",
            n: b.length,
            k: b.length - trend.length,
            extra: {
              "vol surge at break": pctS(b.filter((d) => !d.noMidReturn && d.fcb!.volSurge).length, b.length - trend.length),
              "med ext": (med(b.filter((d) => !d.noMidReturn).map((d) => d.fcb!.rExt)) ?? 0).toFixed(2),
            },
          },
        ],
        verdict: "This is the day you're trying to catch. Everything else is a fade candidate.",
      };
    },
  },

  /* ─────────────── Bar stats (needs public/data/bars-<SYM>.json) ─────────────── */
  {
    id: "tod",
    cat: "Bar stats",
    title: "Time-of-day seasonality — where the range and the drift actually live",
    ask: "Mean return, absolute return (that's the one that pays), range, volume, up-close probability, and cumulative drift from the open — per clock bucket. The strongest and most persistent futures edge is almost always a time filter, not a signal.",
    controls: [
      SYM_OPT,
      { id: "gran", label: "Bucket", options: [{ value: "hour", label: "Hourly" }, { value: "min30", label: "30 min" }, { value: "min5", label: "5 min" }] },
      {
        id: "dow",
        label: "Day",
        options: [
          { value: "all", label: "All days" },
          { value: "Mon", label: "Monday" },
          { value: "Tue", label: "Tuesday" },
          { value: "Wed", label: "Wednesday" },
          { value: "Thu", label: "Thursday" },
          { value: "Fri", label: "Friday" },
        ],
      },
    ],
    run: ({ bars }, s) => {
      const B = bars[(s.sym || "ES") as "ES" | "NQ"];
      if (!B) return MISSING(s.sym || "ES");
      const dow = s.dow || "all";
      const gran = s.gran || "hour";
      // Weekday slices are only precomputed at hourly and 30m — a 5m × weekday
      // cell would be ~40 sessions of noise anyway. Fall back to 30m and say so.
      const coarse = dow !== "all" && gran === "min5";
      const cells: TodCell[] =
        dow === "all"
          ? gran === "hour" ? B.tod.hour : gran === "min30" ? B.tod.min30 : B.tod.min5
          : gran === "hour" ? B.tod.hourByDow[dow] ?? [] : B.tod.min30ByDow[dow] ?? [];

      const maxAbs = Math.max(...cells.map((c) => c.absRet || 0), 1e-9);
      const rows: Row[] = cells.map((c) => ({
        label: hhmm(c.min),
        n: c.n,
        // rate column = share of the day's total "energy" (abs return) in this bucket
        k: Math.round(((c.absRet || 0) / maxAbs) * c.n),
        emphasis: (c.absRet || 0) >= 0.85 * maxAbs,
        extra: {
          "mean ret (bp)": fx(c.ret, 2),
          "abs ret (bp)": fx(c.absRet, 2),
          "avg range (pts)": fx(c.range, 2),
          "up close": c.up != null ? (100 * c.up).toFixed(1) + "%" : "—",
          "drift from open": fx(c.drift, 2),
          "avg vol": c.vol != null ? c.vol.toLocaleString() : "—",
        },
      }));
      return {
        headline: `${B.symbol} · ${B.hours} · ${B.sessions} sessions (${B.from} → ${B.to})${dow === "all" ? "" : ` · ${dow} only`}. Rate column = that bucket's share of peak volatility; the highlighted rows are where the movement is.`,
        cols: ["mean ret (bp)", "abs ret (bp)", "avg range (pts)", "up close", "drift from open", "avg vol"],
        rows,
        verdict:
          "Read ABS RET, not MEAN RET. Mean return per bucket is a fraction of a basis point and is noise — a coin flip dressed as a bias. Absolute return and range are stable across years and tell you when to be at the desk and when the market is closed for business.",
        caveat:
          (coarse ? "No 5-minute weekday slice — a 5m × single-weekday cell is a few dozen sessions of noise, so this fell back to 30 minutes. " : "") +
          "Drift-from-open is cumulative, so it inherits everything before it — it shows the shape of the average day, not an entry.",
      };
    },
  },
  {
    id: "volstruct",
    cat: "Bar stats",
    title: "Range & volatility structure — ATR by clock, and what follows an inside/narrow bar",
    ask: "Range percentiles per timeframe, ATR by hour and by weekday, and the three bar patterns that supposedly precede expansion: inside bars, outside bars, and narrow-range bars. Does compression really pay?",
    controls: [
      SYM_OPT,
      {
        id: "view",
        label: "View",
        options: [
          { value: "atr", label: "ATR by clock" },
          { value: "dist", label: "Range distribution" },
          { value: "pattern", label: "Bar patterns" },
        ],
      },
      { id: "ptf", label: "Pattern TF", options: [{ value: "5", label: "5 min" }, { value: "15", label: "15 min" }, { value: "30", label: "30 min" }] },
    ],
    run: ({ bars }, s) => {
      const B = bars[(s.sym || "ES") as "ES" | "NQ"];
      if (!B) return MISSING(s.sym || "ES");
      const view = s.view || "atr";
      const head = `${B.symbol} · ${B.hours} · ${B.sessions} sessions (${B.from} → ${B.to}).`;

      if (view === "atr") {
        const hi = Math.max(...B.vol.atrByHour.map((x) => x.atr || 0), 1e-9);
        const rows: Row[] = [
          ...B.vol.atrByHour.map((x) => ({
            label: `Hour ${String(x.key).padStart(2, "0")}:00`,
            n: x.n,
            k: Math.round(((x.atr || 0) / hi) * x.n),
            emphasis: (x.atr || 0) >= 0.85 * hi,
            extra: { "avg range (pts)": fx(x.atr, 2), "p90 range": fx(x.p90, 2) },
          })),
          ...B.vol.atrByDow.map((x) => ({
            label: `${x.key} (whole session)`,
            n: x.n,
            extra: { "avg range (pts)": fx(x.atr, 2), "p90 range": fx(x.p90, 2) },
          })),
        ];
        return {
          headline: `${head} 60-minute bars. Rate column = that hour's range as a share of the biggest hour.`,
          cols: ["avg range (pts)", "p90 range"],
          rows,
          verdict: "Size the stop to the hour you're trading in, not to a daily ATR. The last hour and the first hour are different markets.",
        };
      }

      if (view === "dist") {
        const rows: Row[] = Object.entries(B.vol.ranges).map(([tf, r]) => ({
          label: `${tf}-minute bar`,
          n: B.bars,
          extra: {
            mean: fx(r.mean, 2),
            median: fx(r.p50, 2),
            p75: fx(r.p75, 2),
            p90: fx(r.p90, 2),
            p95: fx(r.p95, 2),
            "body / range": r.bodyPct != null ? (100 * r.bodyPct).toFixed(0) + "%" : "—",
          },
        }));
        return {
          headline: `${head} Bar range in points, by timeframe.`,
          cols: ["mean", "median", "p75", "p90", "p95", "body / range"],
          rows,
          verdict:
            "The mean sits well above the median — range is right-skewed, so an 'average' stop gets hit by an ordinary bar. Size off the median and budget for the p90. Body/range under ~50% means most of the bar is wick: your fill is nowhere near the print you're looking at.",
        };
      }

      const P = B.vol.patterns[s.ptf || "5"];
      if (!P) return MISSING(B.symbol);
      const line = (label: string, p: PatStat, emphasis = false): Row => ({
        label,
        n: p.n,
        k: Math.round(p.expand * p.n),
        emphasis,
        extra: {
          "how often": p.freq != null ? (100 * p.freq).toFixed(1) + "%" : "—",
          "next bar up": p.nextUp != null ? (100 * p.nextUp).toFixed(1) + "%" : "—",
          "took the high": p.brokeUp != null ? (100 * p.brokeUp).toFixed(1) + "%" : "—",
          "took the low": p.brokeDn != null ? (100 * p.brokeDn).toFixed(1) + "%" : "—",
          "took BOTH": p.bothSides != null ? (100 * p.bothSides).toFixed(1) + "%" : "—",
        },
      });
      return {
        headline: `${head} ${s.ptf || 5}-minute bars. Rate column = EXPANSION (the next bar's range is >1.5× the median bar). Median bar: ${P.medRange} pts.`,
        cols: ["how often", "next bar up", "took the high", "took the low", "took BOTH"],
        rows: [
          line("Inside bar", P.inside, true),
          line("Outside bar", P.outside),
          line("Narrow-range bar (bottom quartile of the last 20)", P.narrowRange, true),
        ],
        verdict:
          "Compression is supposed to precede expansion. Check the rate column against how often expansion happens anyway — if 'took BOTH' is high, the pattern isn't a breakout setup, it's a whipsaw generator that stops you out in both directions before it goes.",
      };
    },
  },
  {
    id: "autocorr",
    cat: "Bar stats",
    title: "Autocorrelation, variance ratio & streaks — is this thing trending or reverting?",
    ask: "The regime question, answered three ways: return autocorrelation at lags 1–20, the variance ratio (>1 trends, <1 reverts), volatility clustering on absolute returns, and what actually happens after N consecutive bars in one direction.",
    controls: [
      SYM_OPT,
      TF_OPT,
      {
        id: "view",
        label: "View",
        options: [
          { value: "streaks", label: "Streaks" },
          { value: "acf", label: "Autocorrelation" },
          { value: "vr", label: "Variance ratio" },
        ],
      },
    ],
    run: ({ bars }, s) => {
      const B = bars[(s.sym || "ES") as "ES" | "NQ"];
      if (!B) return MISSING(s.sym || "ES");
      const tf = s.tf || "5";
      const A = B.auto[tf];
      if (!A) return MISSING(B.symbol);
      const head = `${B.symbol} · ${tf}-minute bars · ${B.sessions} sessions (${B.from} → ${B.to}).`;
      const view = s.view || "streaks";

      if (view === "streaks") {
        // cont at run r = P(reach r+1 | already at r). The RATE column is that
        // one-step extension prob (what the user asked for: "at N in a row, odds
        // it goes to N+1"). "reach from fresh" is the cumulative survival — the
        // product of every extension up to here — i.e. odds a brand-new 1-bar
        // move ever gets this long.
        // raw per-length counts straight from the data: nAt.get(k) = how many
        // times a run ACTUALLY reached length k (longer runs are counted too,
        // since a 6-run passed through 5). "actually went to N+1" = the count
        // stored at run+1, so it's a real tally, never derived from a %.
        const nAt = new Map(A.streaks.byRun.map((x) => [x.run, x.n]));
        let surv = 1;
        return {
          headline: `${head} "N in a row" = how many times in the data a run actually reached N (a longer run counts too). "actually went to N+1" = how many of those printed one more bar. "reach from fresh" = the same thing as a cumulative %.`,
          hideRate: true,
          cols: ["N in a row", "actually went to N+1", "reach from fresh"],
          rows: A.streaks.byRun.map((r) => {
            surv *= r.cont;
            const went = nAt.get(r.run + 1) ?? Math.round(r.cont * r.n);
            return {
              label: `${r.run} in a row → ${r.run + 1} in a row`,
              n: r.n,
              k: Math.round(r.cont * r.n),
              emphasis: r.run === 5,
              extra: {
                "N in a row": r.n.toLocaleString(),
                "actually went to N+1": went.toLocaleString(),
                "reach from fresh": `${(100 * surv).toFixed(1)}%`,
              },
            };
          }),
          verdict:
            "These are raw historical counts, not probabilities. On the '5 in a row → 6' row: 'N in a row' is the number of times ES actually printed 5 straight same-direction 5-min bars over the 2382 sessions, and 'actually went to N+1' is how many of those went on to a 6th. The 6-in-a-row total is that same 'actually went' number — and it's also the 'N in a row' figure on the row below it. 'Reach from fresh' just expresses each count as a share of all fresh 1-bar moves.",
        };
      }

      if (view === "vr") {
        return {
          headline: `${head} VR(q) = Var(q-bar return) / (q × Var(1-bar return)). Above 1 = trending. Below 1 = mean-reverting. Exactly 1 = random walk.`,
          cols: ["variance ratio", "read"],
          rows: A.vr.map((x) => ({
            label: `VR over ${x.q} bars (${x.q * Number(tf)} min)`,
            n: B.sessions,
            emphasis: x.v != null && Math.abs(x.v - 1) > 0.05,
            extra: {
              "variance ratio": x.v != null ? x.v.toFixed(3) : "—",
              read: x.v == null ? "—" : x.v > 1.05 ? "trending" : x.v < 0.95 ? "mean-reverting" : "random walk",
            },
          })),
          verdict:
            "This is the single most useful number here: it tells you whether to buy breakouts or fade them at this timeframe. A VR near 1 across the board means neither — and that price alone won't give you an edge, so the edge has to come from elsewhere (time of day, positioning, GEX).",
        };
      }

      return {
        headline: `${head} ACF of returns = does direction persist. ACF of |returns| = volatility clustering (does a big bar beget a big bar).`,
        cols: ["ACF returns", "ACF |returns|"],
        rows: A.acf.map((x, i) => ({
          label: `Lag ${x.lag} (${x.lag * Number(tf)} min back)`,
          n: B.bars,
          emphasis: x.v != null && Math.abs(x.v) > 0.03,
          extra: {
            "ACF returns": x.v != null ? x.v.toFixed(4) : "—",
            "ACF |returns|": A.acfAbs[i]?.v != null ? A.acfAbs[i].v!.toFixed(4) : "—",
          },
        })),
        verdict:
          "Return ACF near zero at every lag = price is unpredictable from its own recent direction. |Return| ACF strongly positive and slow to decay = volatility IS predictable. That asymmetry is the real finding: you can forecast HOW MUCH it moves, not WHICH WAY.",
        caveat:
          tf === "1"
            ? "At 1 minute the lag-1 ACF is usually negative because of bid-ask bounce — that's microstructure, not a mean-reversion edge. You cannot trade it through the spread. Look at 5m and 15m instead."
            : undefined,
      };
    },
  },
  {
    id: "cand-8am-both",
    cat: "Bar stats",
    title: "8am hour candle — does the day break BOTH sides, and by when?",
    ask: "Take the 08:00–09:00 ET hour as a reference bar. After it closes, how often does price take out BOTH its high and its low (a two-sided day) vs one side vs neither — and for the two-sided days, what time the second side is taken.",
    controls: [SYM_OPT],
    run: ({ bars }, s) => {
      const sym = (s.sym || "ES") as "ES" | "NQ";
      const B = bars[sym];
      if (!B) return MISSING(sym);
      const rc = B.refCandles?.am8;
      if (!rc || rc.n === 0)
        return {
          headline: `No 08:00 candle data for ${sym}.`,
          rows: [],
          caveat: `The 08:00–09:00 ET hour is PRE-market — it isn't in an RTH-only export, so this reads 0. Rebuild with globex included:  node scripts/build-bar-stats.mjs --sym ${sym} --in "<path-to-${sym}-1min.csv>" --all-hours`,
        };
      const stack: Stack[] = [
        {
          label: `${sym} — the ${rc.window} hour, resolved by ${hhmm(rc.postEnd)}`,
          segs: [
            { name: "Both sides", pct: rc.n ? (100 * rc.both) / rc.n : 0, color: HOME_THEME.orange },
            { name: "Up only", pct: rc.n ? (100 * rc.upOnly) / rc.n : 0, color: HOME_THEME.green },
            { name: "Down only", pct: rc.n ? (100 * rc.dnOnly) / rc.n : 0, color: HOME_THEME.red },
            { name: "Neither", pct: rc.n ? (100 * rc.neither) / rc.n : 0, color: "rgba(255,255,255,0.28)" },
          ],
        },
      ];
      let cum = 0;
      const rows: Row[] = rc.bothByHalf.map((b) => {
        cum += b.n;
        return {
          label: `both sides taken by ${hhmm(b.min + 30)}`,
          n: rc.both,
          k: cum, // CUMULATIVE share of the two-sided days completed by this clock time
          extra: { "in this 30m": pctS(b.n, rc.both) },
        };
      });
      return {
        headline: `${sym}, ${rc.n} sessions. Reference = the ${rc.window} hour. "Both sides" = price later traded ABOVE that hour's high AND BELOW its low before ${hhmm(rc.postEnd)}. The rate column is CUMULATIVE — share of the two-sided days that had completed both breaks by that time.`,
        cols: ["in this 30m"],
        rows,
        stack,
        verdict: `Both sides broke on ${pctS(rc.both, rc.n)} of days; median completion ${rc.medBothComplete != null ? hhmm(rc.medBothComplete) : "—"} (75th pct ${rc.p75BothComplete != null ? hhmm(rc.p75BothComplete) : "—"}). First side is typically taken by ${rc.medFirstBreak != null ? hhmm(rc.medFirstBreak) : "—"}. A high both-sides rate makes the 08:00 range a fade box, not a breakout fence.`,
        caveat: "Break is wick-based (a later bar's high/low pierces the reference hour's high/low), first occurrence, post window capped at the 16:00 RTH close. Outcomes are a true 4-way partition — they sum to 100%.",
      };
    },
  },
  {
    id: "cand-2pm-sides",
    cat: "Bar stats",
    title: "2–3pm hour candle — breaks either side, neither, or both?",
    ask: "The 14:00–15:00 ET hour as a reference bar, with the 15:00–16:00 hour to resolve it. Into the close, does price break above it only, below it only, both, or hold inside?",
    controls: [SYM_OPT],
    run: ({ bars }, s) => {
      const sym = (s.sym || "ES") as "ES" | "NQ";
      const B = bars[sym];
      if (!B) return MISSING(sym);
      const rc = B.refCandles?.pm2;
      if (!rc || rc.n === 0)
        return {
          headline: `No 14:00 candle data for ${sym}.`,
          rows: [],
          caveat: `Rebuild bars-${sym}.json — this window is inside RTH, so a normal export covers it:  node scripts/build-bar-stats.mjs --sym ${sym} --in "<path-to-${sym}-1min.csv>"`,
        };
      const oneSide = rc.upOnly + rc.dnOnly;
      const stack: Stack[] = [
        {
          label: `${sym} — the ${rc.window} hour, resolved by the ${hhmm(rc.postEnd)} close`,
          segs: [
            { name: "Up only", pct: rc.n ? (100 * rc.upOnly) / rc.n : 0, color: HOME_THEME.green },
            { name: "Down only", pct: rc.n ? (100 * rc.dnOnly) / rc.n : 0, color: HOME_THEME.red },
            { name: "Both sides", pct: rc.n ? (100 * rc.both) / rc.n : 0, color: HOME_THEME.orange },
            { name: "Neither", pct: rc.n ? (100 * rc.neither) / rc.n : 0, color: "rgba(255,255,255,0.28)" },
          ],
        },
      ];
      return {
        headline: `${sym}, ${rc.n} sessions. Reference = the ${rc.window} hour; resolved over 15:00–${hhmm(rc.postEnd)}. Four mutually exclusive outcomes — a true partition, so they sum to 100%.`,
        cols: ["share"],
        rows: [
          { label: "Broke ONE side only (directional into the close)", n: rc.n, k: oneSide, emphasis: true, extra: { share: pctS(oneSide, rc.n) } },
          { label: "— up side only", n: rc.n, k: rc.upOnly, extra: { share: pctS(rc.upOnly, rc.n) } },
          { label: "— down side only", n: rc.n, k: rc.dnOnly, extra: { share: pctS(rc.dnOnly, rc.n) } },
          { label: "Broke BOTH sides (rotation / chop into the close)", n: rc.n, k: rc.both, extra: { share: pctS(rc.both, rc.n) } },
          { label: "Broke NEITHER (held inside the 2pm range)", n: rc.n, k: rc.neither, extra: { share: pctS(rc.neither, rc.n) } },
        ],
        stack,
        verdict: "Only one hour is left to resolve, so 'neither' runs high — that's the base rate for a 2pm range that contains the close. A rising one-side share is the late-day trend tell; a high both-sides share is the afternoon-chop tell.",
        caveat: "Break is wick-based, first occurrence, over 15:00–16:00 only. The up-only + down-only rows are sub-rows of the ONE-side line, not extra outcomes.",
      };
    },
  },
];

/* time + number formatting for the bar-stat tables */
function hhmm(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function fx(x: number | null | undefined, d = 2): string {
  return x == null || !Number.isFinite(x) ? "—" : x.toFixed(d);
}

/* ── UI ───────────────────────────────────────────────────────────────────── */

const CATS = ["All", "Cross-index", "Break quality", "Context", "Timing", "Session shape", "Bar stats"] as const;

function ResultTable({ res }: { res: Result }) {
  const cols = res.cols ?? [];
  const th: React.CSSProperties = {
    textAlign: "left", padding: "8px 10px", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em",
    textTransform: "uppercase", color: "rgba(255,255,255,0.55)", borderBottom: `1px solid ${HOME_THEME.border}`,
  };
  const td: React.CSSProperties = { padding: "9px 10px", fontSize: 14, borderBottom: `1px solid ${HOME_THEME.border}`, fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 14, color: HOME_THEME.green, marginBottom: 10 }}>{res.headline}</div>

      {res.stack && (
        <div style={{ marginBottom: 18 }}>
          {res.stack.map((s) => (
            <div key={s.label} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: HOME_THEME.text, marginBottom: 5, letterSpacing: "0.06em" }}>{s.label}</div>
              <div style={{ display: "flex", height: 30, borderRadius: 6, overflow: "hidden", gap: 2 }}>
                {s.segs.map((g) => (
                  <div
                    key={g.name}
                    title={`${g.name} — ${g.pct.toFixed(1)}%`}
                    style={{
                      width: `${g.pct}%`,
                      background: g.color,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 800,
                      color: "#05060A",
                      fontVariantNumeric: "tabular-nums",
                      minWidth: g.pct > 0 ? 2 : 0,
                    }}
                  >
                    {g.pct >= 9 ? `${g.pct.toFixed(0)}%` : ""}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8 }}>
            {res.stack[0]?.segs.map((g) => (
              <span key={g.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgba(255,255,255,0.62)" }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: g.color, display: "inline-block" }} />
                {g.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Condition</th>
              {!res.hideRate && <th style={{ ...th, textAlign: "right" }}>rate</th>}
              {cols.map((c) => (
                <th key={c} style={{ ...th, textAlign: "right" }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.rows.map((r, i) => {
              // Sample size is deliberately NOT rendered as a number — Brandon reads
              // these live and the n column was noise. It still GOVERNS: a thin cell
              // gets the THIN badge and an implausible rate gets the bias flag, so
              // the warning survives even though the count doesn't show.
              const thin = r.n > 0 && r.n < 30;
              const suspicious = r.k != null && r.n >= 30 && (100 * r.k) / r.n > 85;
              return (
                <tr key={i} style={{ background: r.emphasis ? `${LIGHT_BLUE}0F` : "transparent" }}>
                  <td style={{ ...td, color: HOME_THEME.text, fontWeight: r.emphasis ? 700 : 500 }}>
                    {r.label}
                    {thin && (
                      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: HOME_THEME.orange, border: `1px solid ${HOME_THEME.orange}55`, borderRadius: 4, padding: "1px 5px" }}>
                        THIN
                      </span>
                    )}
                    {suspicious && (
                      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: HOME_THEME.red, border: `1px solid ${HOME_THEME.red}55`, borderRadius: 4, padding: "1px 5px" }}>
                        CHECK FOR BIAS
                      </span>
                    )}
                  </td>
                  {!res.hideRate && (
                    <td style={{ ...td, textAlign: "right", fontWeight: 800, fontSize: 17, color: r.k != null ? LIGHT_BLUE : "rgba(255,255,255,0.4)" }}>
                      {r.k != null ? pctS(r.k, r.n) : "—"}
                    </td>
                  )}
                  {cols.map((c) => (
                    <td key={c} style={{ ...td, textAlign: "right", color: HOME_THEME.text }}>{r.extra?.[c] ?? "—"}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {res.verdict && (
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: `${LIGHT_BLUE}12`, border: `1px solid ${LIGHT_BLUE}33`, fontSize: 14, color: HOME_THEME.text }}>
          <strong style={{ letterSpacing: "0.06em", fontSize: 12, textTransform: "uppercase", color: LIGHT_BLUE }}>Verdict</strong>
          <div style={{ marginTop: 4 }}>{res.verdict}</div>
        </div>
      )}
      {res.caveat && (
        <div style={{ marginTop: 8, fontSize: 12, color: HOME_THEME.orange }}>⚠ {res.caveat}</div>
      )}
    </div>
  );
}

export default function StatPrompterTab() {
  const [es, setEs] = useState<IbDataset | null>(null);
  const [nq, setNq] = useState<IbDataset | null>(null);
  const [barEs, setBarEs] = useState<BarStats | null>(null);
  const [barNq, setBarNq] = useState<BarStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cat, setCat] = useState<(typeof CATS)[number]>("All");
  const [q, setQ] = useState("");
  const [since, setSince] = useState("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  /** per-prompt dropdown selections, keyed `${promptId}.${controlId}` */
  const [sel, setSel] = useState<Record<string, string>>({});

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
      .catch((e) => alive && setErr(String(e.message || e)));
    return () => {
      alive = false;
    };
  }, []);

  // Bar stats are OPTIONAL — the file only exists once build-bar-stats.mjs has
  // been run against the raw CSV. A 404 here is not an error; the Bar Stats
  // prompts just render the "run the script" note instead.
  useEffect(() => {
    let alive = true;
    const grab = (s: "ES" | "NQ", set: (b: BarStats | null) => void) =>
      fetch(`/data/bars-${s}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && set(j))
        .catch(() => alive && set(null));
    grab("ES", setBarEs);
    grab("NQ", setBarNq);
    return () => {
      alive = false;
    };
  }, []);

  const ctx: Ctx | null = useMemo(() => {
    if (!es || !nq) return null;
    const cut = since === "all" ? "" : `${since}-01-01`;
    const E = es.days.filter((d) => d.date >= cut);
    const N = nq.days.filter((d) => d.date >= cut);
    const nqMap = new Map(N.map((d) => [d.date, d]));
    const paired = E.filter((d) => nqMap.has(d.date)).map((e) => ({ d: e.date, e, n: nqMap.get(e.date)! }));
    // NOTE: the `since` filter does NOT apply to the bar stats — those are
    // precomputed over the whole CSV. Re-run the script with a trimmed file if
    // you need a narrower window. Said plainly in the footer so it can't mislead.
    return { es: E, nq: N, paired, bars: { ES: barEs, NQ: barNq } };
  }, [es, nq, since, barEs, barNq]);

  const list = useMemo(
    () =>
      PROMPTS.filter((p) => (cat === "All" || p.cat === cat) && (!q.trim() || (p.title + p.ask).toLowerCase().includes(q.trim().toLowerCase()))),
    [cat, q]
  );

  const chip = (on: boolean): React.CSSProperties => ({
    padding: "6px 14px", borderRadius: 999, fontSize: 14, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${on ? LIGHT_BLUE : HOME_THEME.border}`,
    background: on ? `${LIGHT_BLUE}1F` : "transparent",
    color: on ? HOME_THEME.text : "rgba(255,255,255,0.55)",
    transition: "all 0.15s",
  });

  if (err) {
    return (
      <Card title="Stat Prompter">
        <div style={{ color: HOME_THEME.red, fontSize: 14 }}>
          Couldn&apos;t load the IB datasets: {err}
          <div style={{ color: "rgba(255,255,255,0.6)", marginTop: 6, fontSize: 14 }}>
            Export them from <code>ib-backtest-esu6.html</code> → &quot;Export JSON for dashboard&quot; into <code>public/data/</code>.
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Today's IB, priced, with the historical reach rate on every level.
          Sits above the library because it's the thing you look at first. */}
      <IbLevelCanvas />

      <Card title="Stat Prompter" subtitle="Canned questions over the ES + NQ Initial Balance book. Click one, it runs on the real history.">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {CATS.map((c) => (
            <button key={c} onClick={() => setCat(c)} style={chip(cat === c)}>
              {c}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter prompts…"
            style={{
              fontSize: 14, padding: "8px 12px", borderRadius: 8, outline: "none", minWidth: 200,
              border: `1px solid ${HOME_THEME.border}`, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text,
            }}
          />
          <ThemedSelect
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
        <div style={{ marginTop: 12, fontSize: 14, color: "rgba(255,255,255,0.55)" }}>
          {ctx
            ? `${ctx.paired.length} paired ES/NQ sessions loaded${since === "all" ? "" : ` since ${since}`} · ${ctx.es[0]?.date ?? "—"} → ${ctx.es[ctx.es.length - 1]?.date ?? "—"}`
            : "loading ib-ES.json + ib-NQ.json…"}
        </div>
      </Card>

      {/* Two prompt cards per row; collapses to one column on narrow viewports. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 16,
          alignItems: "stretch",
        }}
      >
      {list.map((p) => {
        const isOpen = !!open[p.id];
        // resolve this prompt's dropdown state, defaulting to each control's first option
        const s: Sel = {};
        for (const c of p.controls ?? []) s[c.id] = sel[`${p.id}.${c.id}`] ?? c.options[0].value;
        const res = isOpen && ctx ? p.run(ctx, s) : null;
        return (
          // Collapsed cards sit 2-up; an open card spans the full row so its
          // result table has room instead of getting clipped in a half-width column.
          <div
            key={p.id}
            style={{ ...classicCardAccentStyle, padding: 20, gridColumn: isOpen ? "1 / -1" : "auto" }}
            className="card-hover"
          >
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: LIGHT_BLUE, border: `1px solid ${LIGHT_BLUE}44`, borderRadius: 4, padding: "2px 6px" }}>
                    {p.cat}
                  </span>
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.text }}>{p.title}</div>
                <div style={{ fontSize: 14, color: "rgba(255,255,255,0.62)", marginTop: 5, lineHeight: 1.5 }}>{p.ask}</div>
              </div>
              <button
                onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}
                disabled={!ctx}
                style={{
                  ...(isOpen ? homeSecondaryButtonStyle : homeButtonStyle),
                  padding: "8px 16px",
                  fontSize: 12,
                  flexShrink: 0,
                  opacity: ctx ? 1 : 0.4,
                  cursor: ctx ? "pointer" : "not-allowed",
                }}
              >
                {isOpen ? "Hide" : "Run"}
              </button>
            </div>

            {/* Dropdowns collapse a family of near-identical questions into ONE card.
                They re-run the prompt live; no second Run click needed. */}
            {isOpen && p.controls && (
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
                {p.controls.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>
                      {c.label}
                    </span>
                    <ThemedSelect
                      value={s[c.id]}
                      onChange={(v) => setSel((o) => ({ ...o, [`${p.id}.${c.id}`]: v }))}
                      options={c.options}
                    />
                  </div>
                ))}
              </div>
            )}

            {res && <ResultTable res={res} />}
          </div>
        );
      })}
      </div>

      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
        <strong style={{ color: "rgba(255,255,255,0.6)" }}>Session prompts</strong> read <code>public/data/ib-ES.json</code> + <code>ib-NQ.json</code> (slim exports from <code>ib-backtest-esu6.html</code>).
        Break = first 5m CLOSE outside the 09:30–10:30 IB. Failed = closed back inside within 30m. Extension is in IB widths.
        <br />
        <strong style={{ color: "rgba(255,255,255,0.6)" }}>Bar Stats prompts</strong> read <code>public/data/bars-ES.json</code> + <code>bars-NQ.json</code>, written by <code>scripts/build-bar-stats.mjs</code> from your raw 1-minute CSV.
        Returns are log returns in basis points and never cross a session boundary. The <em>Since</em> filter above does <em>not</em> apply to them — they&apos;re precomputed over the whole CSV; re-run the script on a trimmed file for a narrower window.
        <br />
        No lookahead anywhere: every field was stamped at its own confirm bar. Sample sizes aren&apos;t printed, but they still gate the read — a thin cell is badged THIN, and any rate over 85% is flagged to check for bias rather than treated as an edge.
      </div>
    </div>
  );
}
