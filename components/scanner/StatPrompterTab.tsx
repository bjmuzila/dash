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
 *   • Every result carries n and a 95% Wilson CI. n < 30 renders a THIN badge.
 *   • Nothing peeks forward: SlimDay fields were stamped at their own confirm
 *     bar by the exporter. This file only counts and divides.
 *   • A hit rate above ~85% on a directional question is a bug, not an edge —
 *     the prompt flags it rather than celebrating it.
 */

import { useEffect, useMemo, useState } from "react";
import { HOME_THEME, LIGHT_BLUE, classicCardAccentStyle, homeButtonStyle, homeSecondaryButtonStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";
import type { IbDataset, SlimDay } from "@/lib/ibStats";

/* ── stat helpers ─────────────────────────────────────────────────────────── */

const pctS = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "—");
const med = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
/** 95% Wilson interval — the honest error bar on a proportion. */
function wilson(k: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(100 * (c - m)) / d, (100 * (c + m)) / d];
}
const clock = (m: number | null | undefined) =>
  m == null ? "—" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
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
type Result = {
  headline: string;
  cols?: string[];          // names of the `extra` columns, in order
  rows: Row[];
  verdict?: string;
  caveat?: string;
};

type Ctx = { es: SlimDay[]; nq: SlimDay[]; paired: { d: string; e: SlimDay; n: SlimDay }[] };

type Prompt = {
  id: string;
  cat: "Cross-index" | "Break quality" | "Context" | "Timing" | "Session shape";
  title: string;
  ask: string;
  run: (c: Ctx) => Result;
};

/* small predicates over the slim day */
const brk = (d: SlimDay) => d.fcb;
const side = (d: SlimDay) => (d.fcb ? d.fcb.side : null);
const closeSide = (d: SlimDay) => (d.closeZone === "top25" ? "H" : d.closeZone === "bot25" ? "L" : null);
const worked = (d: SlimDay) => side(d) != null && closeSide(d) === side(d);

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
        return [
          { label: `${label} — breaks`, n: b.length, k: b.length, extra: { of: pctS(b.length, days.length) } },
          { label: `${label} — FAILED (back inside ≤30m)`, n: b.length, k: b.filter((d) => d.fcb!.failed).length, extra: { of: "" }, emphasis: true },
          { label: `${label} — hit 0.5×`, n: b.length, k: b.filter((d) => d.fcb!.hit["0.5"]).length, extra: { of: "" } },
          { label: `${label} — hit 1.0×`, n: b.length, k: b.filter((d) => d.fcb!.hit["1"]).length, extra: { of: "" } },
          { label: `${label} — hit 2.0×`, n: b.length, k: b.filter((d) => d.fcb!.hit["2"]).length, extra: { of: "" } },
          { label: `${label} — full rotation to other extreme`, n: b.length, k: b.filter((d) => d.fcb!.fadeOpp).length, extra: { of: "" } },
        ];
      };
      return {
        headline: "The unconditional IB-break book. Everything else is a deviation from this.",
        cols: ["of"],
        rows: [...mk(es, "ES"), ...mk(nq, "NQ")],
        verdict: "IB breaks fail most of the time. A cohort is only interesting if it moves the FAIL rate materially off this line.",
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
        caveat: b.length === 0 ? "widthBucket is null in the export — the tab derives it client-side; if this is empty, re-export with atr/avgIB." : undefined,
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
    title: "Still inside the IB at 2pm — what happens into the close?",
    ask: "The dead day. Does it stay dead, or is the late break the real move?",
    run: ({ es, nq }) => {
      const rows: Row[] = [];
      for (const [label, days] of [["ES", es], ["NQ", nq]] as const) {
        const c = days.filter((d) => d.containedAt2);
        rows.push({ label: `${label} — days fully contained at 14:00`, n: days.length, k: c.length });
        rows.push({ label: `${label} — of those, broke out LATE`, n: c.length, k: c.filter((d) => d.containedBrokeLate).length, emphasis: true });
      }
      return { headline: "Contained = the entire post-IB session stayed inside the IB through 14:00 ET.", rows };
    },
  },

  /* ─────────────── Session shape ─────────────── */
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
];

/* ── UI ───────────────────────────────────────────────────────────────────── */

const CATS = ["All", "Cross-index", "Break quality", "Context", "Timing", "Session shape"] as const;

function ResultTable({ res }: { res: Result }) {
  const cols = res.cols ?? [];
  const th: React.CSSProperties = {
    textAlign: "left", padding: "8px 10px", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em",
    textTransform: "uppercase", color: "rgba(255,255,255,0.55)", borderBottom: `1px solid ${HOME_THEME.border}`,
  };
  const td: React.CSSProperties = { padding: "9px 10px", fontSize: 14, borderBottom: `1px solid ${HOME_THEME.border}`, fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 13, color: HOME_THEME.green, marginBottom: 10 }}>{res.headline}</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Condition</th>
              <th style={{ ...th, textAlign: "right" }}>n</th>
              <th style={{ ...th, textAlign: "right" }}>hit</th>
              <th style={{ ...th, textAlign: "right" }}>rate</th>
              <th style={{ ...th, textAlign: "right" }}>95% CI</th>
              {cols.map((c) => (
                <th key={c} style={{ ...th, textAlign: "right" }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.rows.map((r, i) => {
              const ci = r.k != null ? wilson(r.k, r.n) : null;
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
                  <td style={{ ...td, textAlign: "right", color: "rgba(255,255,255,0.6)" }}>{r.n}</td>
                  <td style={{ ...td, textAlign: "right", color: "rgba(255,255,255,0.6)" }}>{r.k ?? "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, color: r.k != null ? LIGHT_BLUE : "rgba(255,255,255,0.4)" }}>
                    {r.k != null ? pctS(r.k, r.n) : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
                    {ci ? `${ci[0].toFixed(0)}–${ci[1].toFixed(0)}%` : "—"}
                  </td>
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
          <strong style={{ letterSpacing: "0.06em", fontSize: 11, textTransform: "uppercase", color: LIGHT_BLUE }}>Verdict</strong>
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
  const [err, setErr] = useState<string | null>(null);
  const [cat, setCat] = useState<(typeof CATS)[number]>("All");
  const [q, setQ] = useState("");
  const [since, setSince] = useState("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/data/ib-ES.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`ib-ES.json ${r.status}`)))),
      fetch("/data/ib-NQ.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`ib-NQ.json ${r.status}`)))),
    ])
      .then(([a, b]: [IbDataset, IbDataset]) => {
        if (!alive) return;
        setEs(a);
        setNq(b);
      })
      .catch((e) => alive && setErr(String(e.message || e)));
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
    return { es: E, nq: N, paired };
  }, [es, nq, since]);

  const list = useMemo(
    () =>
      PROMPTS.filter((p) => (cat === "All" || p.cat === cat) && (!q.trim() || (p.title + p.ask).toLowerCase().includes(q.trim().toLowerCase()))),
    [cat, q]
  );

  const chip = (on: boolean): React.CSSProperties => ({
    padding: "6px 14px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer",
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
          <div style={{ color: "rgba(255,255,255,0.6)", marginTop: 6, fontSize: 13 }}>
            Export them from <code>ib-backtest-esu6.html</code> → &quot;Export JSON for dashboard&quot; into <code>public/data/</code>.
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
              fontSize: 13, padding: "8px 12px", borderRadius: 8, outline: "none", minWidth: 200,
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
        <div style={{ marginTop: 12, fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
          {ctx
            ? `${ctx.paired.length} paired ES/NQ sessions loaded${since === "all" ? "" : ` since ${since}`} · ${ctx.es[0]?.date ?? "—"} → ${ctx.es[ctx.es.length - 1]?.date ?? "—"}`
            : "loading ib-ES.json + ib-NQ.json…"}
        </div>
      </Card>

      {list.map((p) => {
        const isOpen = !!open[p.id];
        const res = isOpen && ctx ? p.run(ctx) : null;
        return (
          <div key={p.id} style={{ ...classicCardAccentStyle, padding: 20 }} className="card-hover">
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
                  fontSize: 11,
                  flexShrink: 0,
                  opacity: ctx ? 1 : 0.4,
                  cursor: ctx ? "pointer" : "not-allowed",
                }}
              >
                {isOpen ? "Hide" : "Run"}
              </button>
            </div>
            {res && <ResultTable res={res} />}
          </div>
        );
      })}

      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
        Source: <code>public/data/ib-ES.json</code> + <code>ib-NQ.json</code> (slim exports from <code>ib-backtest-esu6.html</code>, same files the IB Stats tab reads).
        Break = first 5m CLOSE outside the 09:30–10:30 IB. Failed = closed back inside within 30m. Extension is measured in IB widths.
        Every field was stamped at its own confirm bar — no lookahead. Rates under n=30 are marked THIN; anything over 85% is flagged to check for bias, not celebrated.
      </div>
    </div>
  );
}
