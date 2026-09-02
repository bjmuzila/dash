// ─────────────────────────────────────────────────────────────────────────────
// THE EIGHT TPO STRUCTURES — the tab's whole vocabulary.
//
// Transcribed 1:1 from v2's `lib/tpo.ts:59–64, 101–153, 254–284, 427–480` and
// `components/pages/Scanner.tsx:2235–2244` (`KIND_COLOR`), against the checklist
// in docs/parity/scanner.md Part F, rows F.11, F163–F174 and F175–F184.
//
// Every string table below is a TOTAL record — all eight kinds have all four
// strings — so no fallback path exists anywhere downstream and none should be
// written.
//
// FOUR THINGS HERE ARE NOT OBVIOUS FROM THE SCREEN, and lib/tpo.ts's header
// exists to keep them apart:
//
//   1. EXCESS AND TAIL ARE THE SAME SHAPE AND OPPOSITE TRADES. Both are ≥2
//      contiguous single prints at an extreme. What separates them is where the
//      period that PRINTED the extreme closed: back inside the body (rejection —
//      the auction ended properly, the level holds, fade it) or out at the
//      extreme (a trend leg leaving singles behind — continuation, do NOT fade).
//      This is why `buildTpoSession` tracks each 30-min period's close at all.
//   2. POOR IS ALSO AT THE EXTREME AND IS THE OPPOSITE OF EXCESS. A flat stack
//      with no tail means the auction ran out of TIME, not out of buyers or
//      sellers. Unfinished — expect it taken out, trade TOWARD it.
//   3. A HOLE IS NEVER A TARGET. Mid-profile singles are a thin zone; price
//      accelerates THROUGH them. Targets go on the far side.
//   4. A HOLE NEEDS NO MINIMUM RUN LENGTH while tails and excess need `>= 2`
//      contiguous singles (`lib/tpo.ts:254–255` vs `278–282`). On a 1-pt ESU bin
//      a single isolated single-print bin therefore becomes a "hole". Copied as
//      written; it is open question 5 for the owner.
//
// ── COLOUR: THE COLLAPSE, AND THE ONE COLLISION WORTH FIXING ─────────────────
//
// v2's `KIND_COLOR` gives `tail_high`, `tail_low`, `poor_high` and `poor_low`
// the IDENTICAL orange `#FB8501`. On the chart a "don't fade this, it is a trend
// leg" tail and a "trade toward this, it will get taken out" poor high are the
// same colour — precisely the confusion lib/tpo.ts's header exists to prevent,
// and the one place in this tab where a colour actively misleads.
//
// THEY ARE SPLIT HERE. `poor_*` keeps `T.orange`; `tail_*` moves to `VIOLET`.
// Poor keeps the orange for two reasons: the ONE legend row that names either
// of them is "poor hi/lo — unfinished, target", painted with
// `KIND_COLOR.poor_high` (F90) — a reader who has learned anything has learned
// that orange — and every poor high/low SIGNAL is `level: "action"`, whose chip
// is already `T.orange` (F115), so poor↔action↔orange is one consistent chain.
// Tail has no legend row at all (F94) and its signals are `level: "info"`, so it
// is the half that can move without unteaching anything. `VIOLET` is v3's
// established "a third hue on purpose, neither of the two things you are
// comparing" token. Spec open question 3 proposed the reverse assignment; the
// legend row and the action-chip chain are why this port went the other way.
//
// The other collision is collapsed rather than split. v2 paints the POINT OF
// CONTROL two different colours inside one tab: the canvas letter cell and the
// `P:` tag are amber `#F2A93B`, while `TpoOpenLocation`'s `pd POC` / `pw POC`
// refs are orange `#FB8501`. Same semantic, two values, no reason. Both become
// `T.orange` (`POC_COLOR` below), so "this is the POC" is one colour everywhere.
//
// The rest of the collapse: `HT.red #EF4444` → `T.red`, `NEUTRAL #6B7280` →
// `T.flat` (via `NEUTRAL` in ./format), `LIGHT_BLUE #7dd3fc` → `LIGHT_BLUE`.
// NOTE these are CATEGORICAL kind colours, not directional ones — a red excess
// is not "price went down". `MOVE_UP` / `MOVE_DOWN` are used only where v2's
// colour genuinely meant a direction (the distance sign, `dirGlyph`, the
// above/below open tone, the `open ±` delta, the AMT state), which is in
// tpoStructures.ts and amt.ts, not here.
//
// ── TWO PALETTES, ONE SOURCE ─────────────────────────────────────────────────
// `KIND_COLOR` hands out `var(--color-…)` strings, which is what a DOM style
// wants and what a canvas CANNOT use — `ctx.fillStyle = 'var(--color-warn)'`
// does not throw, it silently keeps the previous fill. `KIND_COLOR_VAR_NAME`
// carries the same assignment as custom-property NAMES, for `tokenHex()` in
// tpoProfile.ts. The two records must move together; that is the price of the
// canvas, and it is cheaper than a hex.
//
// Spec: docs/parity/scanner.md Part F, rows F.11, F163–F184.
// ─────────────────────────────────────────────────────────────────────────────

import { LIGHT_BLUE, T, VIOLET } from '@/design/theme'
import { NEUTRAL } from '@/pages/scanner/format'

/** The eight structures, in `lib/tpo.ts:59–64` declaration order. */
export type StructureKind =
  | 'excess_high'
  | 'excess_low'
  | 'tail_high'
  | 'tail_low'
  | 'poor_high'
  | 'poor_low'
  | 'hole'
  | 'naked_poc'

/**
 * The stats table's row order (F172), fixed by the `kinds` array in
 * `buildTpoStructures` (`lib/tpo.ts:369–372`). There is no user sort and no
 * click-to-sort anywhere in this tab. NOTE it is NOT the same order as the
 * `StructureKind` union reads — excess pair, tail pair, poor pair, hole, naked.
 */
export const KIND_ORDER: readonly StructureKind[] = [
  'excess_high',
  'excess_low',
  'tail_high',
  'tail_low',
  'poor_high',
  'poor_low',
  'hole',
  'naked_poc',
]

// ── THE FOUR STRING TABLES, VERBATIM ─────────────────────────────────────────

/** Terse badge for the stats table's `kind` column and the on-chart dashed labels. */
export const KIND_LABEL: Record<StructureKind, string> = {
  excess_high: 'excess hi',
  excess_low: 'excess lo',
  tail_high: 'tail hi',
  tail_low: 'tail lo',
  poor_high: 'poor high',
  poor_low: 'poor low',
  hole: 'hole',
  naked_poc: 'naked poc',
}

/**
 * Plain-English headline for the hover card and the rail badge.
 *
 * v2's own reasoning: KIND_LABEL reads fine once you already know the taxonomy
 * and is useless the first fifty times you do not — which is why the structures
 * went unread. KIND_TITLE names the structure the way a profile trader would say
 * it out loud.
 *
 * The `" — "` separator (space, EM DASH, space) is load-bearing:
 * `TpoOpenLocation` splits on it to build the `↑ Poor high` open-level labels
 * (F158) and `TpoForwardMap` splits on it for its lean line. Do not restyle it
 * to a hyphen.
 */
export const KIND_TITLE: Record<StructureKind, string> = {
  excess_high: 'Excess high — selling tail',
  excess_low: 'Excess low — buying tail',
  tail_high: 'Tail high — trend leg',
  tail_low: 'Tail low — trend leg',
  poor_high: 'Poor high — unfinished',
  poor_low: 'Poor low — unfinished',
  hole: 'Hole — thin zone',
  naked_poc: 'Naked POC — magnet',
}

/** Second line of the hover card: what it means and what to do, in one breath. */
export const KIND_NOTE: Record<StructureKind, string> = {
  excess_high: 'Singles at the high, period closed back inside. Fade it.',
  excess_low: 'Singles at the low, period closed back inside. Fade it.',
  tail_high: "Singles left by a trend leg, closed at the high. Don't fade.",
  tail_low: "Singles left by a trend leg, closed at the low. Don't fade.",
  poor_high: 'Flat stack, no tail. Expect it to get taken out.',
  poor_low: 'Flat stack, no tail. Expect it to get taken out.',
  hole: 'Mid-profile singles. Price accelerates through.',
  naked_poc: 'Untested fair value. Strong magnet.',
}

/**
 * The if/then, for the rail badge's native `title=` tooltip (F176).
 *
 * The excess pair and the tail pair each share one string — that is v2's, not a
 * copy error: what the structure MEANS does not depend on which end of the
 * profile it sits at.
 */
export const KIND_MEANING: Record<StructureKind, string> = {
  excess_high: 'Rejection — auction ended properly. Level holds; fade back toward POC.',
  excess_low: 'Rejection — auction ended properly. Level holds; fade back toward POC.',
  tail_high: "Trend leg left singles behind — continuation, NOT rejection. Don't fade it.",
  tail_low: "Trend leg left singles behind — continuation, NOT rejection. Don't fade it.",
  poor_high: 'Unfinished auction — ran out of time, not sellers. Expect it to get taken out.',
  poor_low: 'Unfinished auction — ran out of time, not buyers. Expect it to get taken out.',
  hole: 'Thin zone — no acceptance. Price accelerates THROUGH. Never target inside it.',
  naked_poc: 'Untested fair value from a prior session. Strong magnet.',
}

// ── COLOUR ───────────────────────────────────────────────────────────────────

/**
 * The tab's whole colour key. DOM form — `var(--color-…)` strings.
 * See the header for the tail/poor split and the POC collapse.
 */
export const KIND_COLOR: Record<StructureKind, string> = {
  // v2 HT.red #EF4444. Categorical "rejection", not "price down".
  excess_high: T.red,
  excess_low: T.red,
  // SPLIT from poor. v2 painted both #FB8501; see header.
  tail_high: VIOLET,
  tail_low: VIOLET,
  // v2 HT.orange #FB8501, kept.
  poor_high: T.orange,
  poor_low: T.orange,
  // v2 NEUTRAL #6B7280 → ./format's NEUTRAL, which is T.flat.
  hole: NEUTRAL,
  // v2 LIGHT_BLUE #7dd3fc — also the tab's own accent.
  naked_poc: LIGHT_BLUE,
}

/**
 * The same assignment as custom-property NAMES, for `tokenHex()` on the canvas.
 * MUST stay in step with `KIND_COLOR` above.
 */
export const KIND_COLOR_VAR_NAME: Record<StructureKind, string> = {
  excess_high: '--color-down',
  excess_low: '--color-down',
  tail_high: '--color-violet',
  tail_low: '--color-violet',
  poor_high: '--color-warn',
  poor_low: '--color-warn',
  hole: '--color-flat',
  naked_poc: '--color-series-5',
}

/**
 * THE POINT OF CONTROL, one colour. v2 used amber `#F2A93B` on the canvas (the
 * POC letter cell and the `P:` tag) and orange `#FB8501` in the DOM (the
 * `pd POC` / `pw POC` refs) for the same idea. Collapsed onto `T.orange`.
 *
 * It now shares a hue with `poor_*`, which is a real adjacency and a deliberate
 * one: they never appear on the same surface (POC is a filled letter cell and a
 * leader tag; poor is a 3 px spine, a dashed line and a legend row), and giving
 * "fair value" and "unfinished auction" a hue each was never worth a fifth blue.
 */
export const POC_COLOR = T.orange
export const POC_COLOR_VAR_NAME = '--color-warn'

// ── SIDE ─────────────────────────────────────────────────────────────────────

/**
 * Which end of the profile a structure sits at. Six kinds are fixed at
 * construction; the other two are not, and both are worth knowing:
 *
 *   • `hole` — computed per structure, `lo >= poc ? "up" : "down"`
 *     (`lib/tpo.ts:281`), so it is NOT in this table.
 *   • `naked_poc` — HARDCODED `"up"` (`lib/tpo.ts:284`) even though a naked POC
 *     is not at either extreme. `side` drives the repair test in
 *     `buildTpoStructures`, and naked POCs branch out of that test before `side`
 *     is read, so the value is inert. It is still what the field says.
 */
/**
 * ADDED IN STEP 3 — what `side` says for the one kind that is NOT in the table
 * below, written out so a surface listing the taxonomy does not have to
 * paraphrase the rule from the doc comment.
 */
export const HOLE_SIDE_RULE = 'per structure — "up" when its low is at or above the POC, else "down"'

export const KIND_SIDE: Record<Exclude<StructureKind, 'hole'>, 'up' | 'down'> = {
  excess_high: 'up',
  excess_low: 'down',
  tail_high: 'up',
  tail_low: 'down',
  poor_high: 'up',
  poor_low: 'down',
  naked_poc: 'up',
}

// ── DETECTION AND REPAIR, PER KIND ───────────────────────────────────────────

export interface KindRule {
  /** How `buildTpoSession` decides this structure exists. */
  detect: string
  /** What closes the business — what `buildTpoStructures` looks for in later bars. */
  repair: string
  /** Whether the band has width, or collapses to one price. */
  width: 'band' | 'zero'
}

/**
 * The engine's rules, written out. These are documentation of code that lives in
 * `buildTpoSession` / `buildTpoStructures` (tpoStructures.ts) — not a second
 * implementation. They are here because the taxonomy is meaningless without them
 * and because a reader comparing the two versions needs one place that states
 * what each kind IS.
 *
 * TESTED is a separate event from REPAIRED for every kind except `naked_poc`:
 * tested = a later bar's [low,high] intersects the ±TOUCH_PAD band; repaired =
 * business closed. For a naked POC the two are the same event, because being
 * touched IS the business.
 */
export const KIND_RULE: Record<StructureKind, KindRule> = {
  excess_high: {
    detect:
      'A run of >= 2 contiguous single-print bins ENDING at the top bin, AND the ' +
      'period that printed the session high closed BELOW the run\'s low ' +
      '(hiPeriod.close < lo) — it closed back inside the body.',
    repair: 'Some later bar trades high > priceHi.',
    width: 'band',
  },
  excess_low: {
    detect:
      'A run of >= 2 contiguous single-print bins STARTING at the bottom bin, AND ' +
      'the period that printed the session low closed ABOVE the run\'s high ' +
      '(loPeriod.close > hi).',
    repair: 'Some later bar trades low < priceLo.',
    width: 'band',
  },
  tail_high: {
    detect:
      'The same top singles run as excess_high, but hiPeriod.close >= lo — the ' +
      'period closed out AT the extreme. Same shape, opposite trade.',
    repair: 'Some later bar trades high > priceHi.',
    width: 'band',
  },
  tail_low: {
    detect: 'The same bottom singles run as excess_low, but loPeriod.close <= hi.',
    repair: 'Some later bar trades low < priceLo.',
    width: 'band',
  },
  poor_high: {
    detect:
      'NO qualifying top singles run, AND the top bin has count >= 2 — a flat ' +
      'stack at the extreme with no tail. Zero width: priceLo === priceHi === ' +
      'the top bin\'s price.',
    repair: 'Some later bar trades high > priceHi.',
    width: 'zero',
  },
  poor_low: {
    detect: 'NO qualifying bottom singles run, AND the bottom bin has count >= 2.',
    repair: 'Some later bar trades low < priceLo.',
    width: 'zero',
  },
  hole: {
    detect:
      'Any singles run touching NEITHER extreme. NOTE: no length >= 2 requirement, ' +
      'unlike the tails and excess — one isolated single-print bin becomes a hole.',
    repair:
      'A later session trades BOTH high > priceHi AND low < priceLo. The above/below ' +
      'flags reset per session, so it must be a full traverse WITHIN ONE SESSION.',
    width: 'band',
  },
  naked_poc: {
    detect: 'Emitted UNCONDITIONALLY for every session. Zero width, at the POC price.',
    repair:
      'The first later bar that touches the band at all (touchedThisSession) — so ' +
      'tested and repaired collapse to the same event.',
    width: 'zero',
  },
}

/** Kinds whose band collapses to a single price, so the UI must print one number. */
export const ZERO_WIDTH_KINDS: ReadonlySet<StructureKind> = new Set(
  KIND_ORDER.filter((k) => KIND_RULE[k].width === 'zero'),
)

// ── AGE BUCKETS ──────────────────────────────────────────────────────────────

/** A 2-day-old excess is a very different bet than a 3-week-old one. */
export type AgeBucket = '0-5d' | '6-20d' | '20d+'

/** Chip order in the stats table (F173). */
export const AGE_BUCKETS: readonly AgeBucket[] = ['0-5d', '6-20d', '20d+']

/**
 * Boundaries are `<=` on both edges (`lib/tpo.ts:114–116`), so:
 *
 *   ageSessions <= 5   → "0-5d"    (0,1,2,3,4,5)
 *   ageSessions <= 20  → "6-20d"   (6…20)
 *   otherwise          → "20d+"    (21+)
 *
 * NOTE the label "20d+" starts at 21, not 20 — 20 is in the middle bucket. The
 * word and the boundary disagree by one day; copied as written.
 */
export function ageBucket(ageSessions: number): AgeBucket {
  return ageSessions <= 5 ? '0-5d' : ageSessions <= 20 ? '6-20d' : '20d+'
}

/**
 * ADDED IN STEP 3 — one representative `ageSessions` per bucket.
 *
 * `baseRateFor` takes an AGE, not a bucket, so a surface that wants to show the
 * ladder's answer (the rate, the sample size, and WHICH rung answered) for every
 * bucket needs an age to ask with. These are the buckets' own boundaries read
 * back off `ageBucket`: the top of the first two, and one past the second —
 * which is where `"20d+"` actually starts, per the note above about the label
 * and the boundary disagreeing by a day.
 */
export const AGE_BUCKET_PROBE: Record<AgeBucket, number> = {
  '0-5d': 5,
  '6-20d': 20,
  '20d+': 21,
}

// ── BASE RATES ───────────────────────────────────────────────────────────────

export interface KindStat {
  kind: StructureKind
  n: number
  tested: number
  repaired: number
  /** null when n === 0 — never render 0% for "no sample". */
  testRate: number | null
  repairRate: number | null
  medSessionsToTest: number | null
}

export interface BucketStat {
  kind: StructureKind
  bucket: AgeBucket
  n: number
  tested: number
  testRate: number | null
}

/**
 * The sample floor. 0% off a sample of one is noise, not a finding; below this
 * the lookup falls back to the kind-level rate, and if THAT is also short it
 * returns null so the UI renders a dash rather than a fake 0%.
 */
export const MIN_N = 5

export type BaseRateScope = 'bucket' | 'kind' | 'none'

export interface BaseRate {
  rate: number | null
  n: number
  scope: BaseRateScope
}

/**
 * "Of all structures of this KIND at this AGE, what share were ever tested?"
 *
 * THIS IS A PRIOR ON THE TYPE, NOT A PROBABILITY FOR A LEVEL. Three excess lows
 * at three different prices all show the same number. The UI must say so — see
 * `structureBaseRateTooltip` in tpoStructures.ts, which is the only surface in
 * the whole tab that spells it out, and which renders nowhere in v2.
 *
 * Ladder, in order (`lib/tpo.ts:145–152`):
 *   1. the kind × bucket rate, if that cell has `n >= MIN_N` AND a non-null rate
 *   2. else the kind rate, same two conditions
 *   3. else `{rate: null}` — and `n` is `(bucket n) || (kind n)`, so a zero
 *      bucket count falls through to the kind count via `||`, which also means a
 *      genuinely-zero kind count reports 0 either way.
 *
 * Takes the two stat arrays structurally rather than a whole `TpoResult`, so
 * this module does not have to import the engine that imports it. A `TpoResult`
 * is assignable.
 */
export function baseRateFor(
  res: { stats: readonly KindStat[]; buckets: readonly BucketStat[] },
  kind: StructureKind,
  ageSessions: number,
): BaseRate {
  const b = ageBucket(ageSessions)
  const bs = res.buckets.find((x) => x.kind === kind && x.bucket === b)
  if (bs && bs.n >= MIN_N && bs.testRate != null) return { rate: bs.testRate, n: bs.n, scope: 'bucket' }

  const ks = res.stats.find((x) => x.kind === kind)
  if (ks && ks.n >= MIN_N && ks.testRate != null) return { rate: ks.testRate, n: ks.n, scope: 'kind' }

  return { rate: null, n: (bs?.n ?? 0) || (ks?.n ?? 0), scope: 'none' }
}
