// ─────────────────────────────────────────────────────────────────────────────
// PICK STUDY — TYPES, BUCKET LOGIC, VERDICT WORDING AND EVERY COPY STRING.
//
// Transcribed 1:1 from v2's `components/scanner/PickStudyTab.tsx` (lines 1–703,
// the whole file) against the checklist in docs/parity/scanner.md Part D,
// rows D1–D127. Nothing below was re-derived from the spec table: every
// threshold, every fallback literal and every sentence was copied out of the
// component.
//
// What the tab is: a read-only viewer over /proxy/gex-change-top-study. Every
// GEX Change Top pick that has been graded is bucketed on ONE capture-time
// feature at a time, and the table reports the A/B hit rate per bucket. The
// calibration block at the bottom grades the grader.
//
// EIGHT PIECES OF BUSINESS LOGIC THAT ARE NOT OBVIOUS FROM THE SCREEN:
//
//   1. THIN IS A SERVER VERDICT, NOT A CLIENT COMPARISON. `bucket.thin` arrives
//      on the wire; the client never compares `n` to `minN` to decide it. `minN`
//      is used only to WRITE the two sentences that mention it (the thin badge
//      tooltip and the footnote). At ~15–30 picks a day, a month is ~500 rows,
//      and eight features against 500 rows will hand you beautiful splits that
//      are pure noise — which is the entire reason the flag exists.
//   2. "HOLDS" IS THE OUT-OF-SAMPLE FILTER. Every bucket is also computed on the
//      first and second half of the window separately (split by DATE, so no
//      session lands on both sides). `holds` is true only when both halves point
//      the same way as the full window. `firstHalf`/`secondHalf` are read in
//      exactly ONE place — the Holds cell's tooltip (D66).
//   3. THE VERDICT IS A CONTROL-GROUP TEST, AND IT IGNORES THE COHORT BUTTONS.
//      `data.cohorts` is returned as {selected, shadow} independently of which
//      cohort is selected, so the sentence does not change when you flip
//      Taken / Passed on / Both.
//   4. THE VERDICT'S ROUNDING TRAP. The noise band is tested at FULL precision
//      and printed at 0 dp. See `buildVerdict`.
//   5. TWO SOURCES OF TRUTH FOR "ARMED". The rule bar reads `rule.armed`; the
//      body reads `cal.armed`. Separate fetches, separate failure modes. See
//      `ruleBarArmed` and `isNotArmed`.
//   6. THE FIT FLOORS ITS WINDOW AT 90 DAYS. See `fitDays` and D124.
//   7. "NEVER GREEN" IS RED UNDER TWO DIFFERENT RULES on the same screen. See
//      `bucketNeverGreenColor` vs `calNeverGreenColor`.
//   8. `GRADES` IS ORDER-BEARING. It is both the calibration table's six
//      trailing columns AND the rank used to sort the Predicted column, so
//      "A+" cannot land between "A" and "B".
//
// ── THE OWNER GATE (D0, rows D1–D11) ─────────────────────────────────────────
// `PickStudyTab.tsx` contains NO owner check of its own — it renders whatever it
// is mounted with. The gate lives in the nav registry and the page shell, and it
// is CHROME ONLY: it decides what gets DRAWN, not what is ALLOWED. A non-owner
// who pastes /scanner?tab=pickstudy is silently shown GEX Change Top at that
// URL; nothing corrects the address bar and nothing 403s.
//
// WHAT THE CLIENT ACTUALLY PROVES ABOUT THE SERVER: the two POST routes are
// gated — both branch on `401/403` and throw `OWNER_ONLY_ERROR` (D124, D125).
// That is the only evidence in the file. The THREE GET routes
// (…-study, …-calibration, …-rule) have no such branch, which does NOT mean
// they are ungated — it means this client cannot tell you. Given the tab is
// owner-only because it is "research in progress, not a customer view", the
// three reads should be gated server-side too. OPEN QUESTION, carried forward
// from docs/parity/scanner.md Part D open question 3 — do not assume either way.
//
// ── THE COLOUR SPLIT (Brandon, 2026-09-03) ───────────────────────────────────
// REVERSED: this tab no longer renders v3's collapsed semantics. It renders
// v2's palette. The step-2 collapse onto MOVE_UP / MOVE_DOWN / T.* recorded
// here previously is gone — see docs/parity/scanner.md and COLOR-REMAP.md.
//
// v2's `HOME_THEME.green` #8ECAE6 — a LIGHT BLUE, not a green — does FOUR
// unrelated jobs on this one tab, and that collision is the ONE thing this port
// breaks apart. Each leg takes a different value v2 already ships:
//
//   (a) chrome ............ both table header rows            → V2.green  #8ECAE6
//   (b) semantic positive . ✓ holds, lift >= 8, +ve term chip → V2.up     #1FD98A
//   (c) a state ........... the "Armed" word and the Arm btn  → V2.up     #1FD98A
//   (d) a confirmation .... the transient "✓ copied"          → V2.up     #1FD98A
//
// The result in v2 is that a `>= 8` lift — the strongest signal in the table —
// is painted the exact same colour as the column headings above it. (a) keeps
// the value v2 painted it, because chrome is where the value lives by site
// count. (b) takes v2's own REFRESH_GREEN #1FD98A, which homeTheme.ts:288–293
// declares as "the up / success green … a role color". (c) and (d) join it:
// "Armed" is a GOOD state — the rule cleared the evidence bar — and a copy
// confirmation is a success acknowledgement, and V2.up is the role colour for
// exactly that (COLOR-REMAP decision 2).
//
// Reds split by MEANING, not by value: a signed NEGATIVE number (lift <= -8,
// ✗ holds, a -ve term chip, the red verdict, an above-average never-green rate)
// and an ALERT (the two error lines, the Disarm button's ink) are two different
// ideas, but v2 paints both `HOME_THEME.red` #EF4444 — so both take V2.red and
// stay separate CONSTANTS so they can move apart later without a hunt.
//
// One thing deliberately NOT collapsed: `RateBar`'s fill stays V2.cyan while the
// Lift value beside it takes the V2.up / V2.red pair. The bar encodes MAGNITUDE
// and is deliberately not a threshold mark; unifying them would make an 8% hit
// rate and a -8pt lift the same colour. The next reader will try to merge them —
// this paragraph is why they should not.
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// There is none in the LOGIC, and that is deliberate. Six v2 defects are ported
// exactly as written and tagged `// BUG (v2):` for step 3 to decide:
//
//   • the two sources of truth for "armed" (`ruleBarArmed` vs `isNotArmed`);
//   • `isNotArmed` collapsing four distinguishable states into one screen;
//   • the `rule?.auto` ternary asserting a specific env setting when the rule
//     FETCH merely failed (`notArmedDetailLine`);
//   • the verdict's compare-at-full-precision / print-at-0-dp gap
//     (`buildVerdict`);
//   • the fit's `Math.max(days, 90)` floor silently ignoring the day toggle
//     (`fitDays`);
//   • `colSpan={10}` against 11 columns (recorded on `CAL_COLUMN_COUNT`).
//
// The request layer needed no straightening either: v2 already fires its three
// GETs from three independent mount effects in the same commit (D127), so there
// is no waterfall to remove. The only chaining is post-mutation, which is
// correct sequencing.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • `import type { CSSProperties } from 'react'` (v2 :41). Dead — `CSSProperties`
//   is never referenced anywhere in the 703-line file.
// • The local `tint(hex, a)` (v2 :109–112). A byte-for-byte duplicate of
//   `themeRgba` in homeTheme.ts:63–69, which was simply not exported. v3 has
//   `alpha()` in src/design/theme.ts; step 3 uses that.
// • `HOME_THEME`, `homeButtonStyle`, `seg()`, `th`, `td`, `Card variant="budget"`
//   and `PageShell`. All v2 chrome, all reaching the DOM as inline style strings
//   from JS constants. Nothing there ports by copy. (`Card`'s `accent` prop is
//   already documented dead in v2's own PageCard.tsx:23–33 — do not carry it.)
// • v2's `SortTh` NAME COLLISION: Scanner.tsx:291 defines a local `SortTh` with a
//   different API (label/col/sortKey/sortDir/onSort, two-state) while this tab
//   imports the three-state one from shared/useTableSort. v3 gets ONE sortable
//   header primitive; the sort KEYS and comparators are here, the header is not.
// • The hand-rolled `fetch` chains with no AbortController (D126) and the
//   uncleaned 1600 ms `setTimeout` in `copyTerm` (D71). See pickStudyData.ts.
//
// ── TYPE FIELDS KEPT BUT NEVER READ IN v2 ────────────────────────────────────
// The wire shapes below are complete — nothing is dropped from them, because
// dropping a field from a wire type is how a v3 consumer later "discovers" a
// value that was there all along. But roughly twenty declared fields are never
// read by any render path in v2, and each is tagged `@neverReadInV2` so step 3
// knows the difference between "the server sends this" and "the screen uses
// this". Reading one is a new feature, not parity.
//
// Spec: docs/parity/scanner.md Part D, rows D1–D127.
// ─────────────────────────────────────────────────────────────────────────────

import { T, V2 } from '@/design/theme'
import { EM_DASH } from '@/pages/scanner/format'
import { DEFAULT_TAB, OWNER_ONLY_TABS } from '@/pages/scanner/scannerNav'
import type { ScannerTabId } from '@/pages/scanner/scannerNav'

// ─────────────────────────────────────────────────────────────────────────────
// THE OWNER GATE — D1–D11.
// ─────────────────────────────────────────────────────────────────────────────

/** This tab's id, so the gate helpers below cannot be pointed at another tab. */
export const PICK_STUDY_TAB_ID: ScannerTabId = 'pickstudy'

/**
 * True when the CURRENT tab is owner-only and the viewer is not the owner.
 * v2: `OWNER_ONLY_TABS.has(tab) && !isOwner` (Scanner.tsx:3062). Note it tests
 * the REQUESTED tab, not the visible one — the gate runs before the fallback.
 */
export function isOwnerGated(tab: ScannerTabId, isOwner: boolean): boolean {
  return OWNER_ONLY_TABS.has(tab) && !isOwner
}

/**
 * Which tab to actually render, given the requested one. Three-way, and the
 * middle state is the point:
 *
 *   not gated ............................ the requested tab
 *   gated, auth resolved ................. DEFAULT_TAB (v2 hardcoded
 *                                          "gexchangetop"; same value)
 *   gated, auth STILL RESOLVING .......... null — render NOTHING
 *
 * v2's own comment on the null (Scanner.tsx:3066): "While auth is still
 * resolving, an owner-gated tab renders NOTHING rather than falling back — a
 * flash of the wrong tab that then swaps is worse than an empty beat, and it
 * would also fire that tab's fetches." That last clause is the load-bearing
 * half: `null` is what stops all five of this tab's requests from firing for a
 * non-owner mid-hydration.
 */
export function visibleTab(
  tab: ScannerTabId,
  isOwner: boolean,
  authLoaded: boolean,
): ScannerTabId | null {
  if (!isOwnerGated(tab, isOwner)) return tab
  return authLoaded ? DEFAULT_TAB : null
}

// ─────────────────────────────────────────────────────────────────────────────
// WIRE SHAPES.
// ─────────────────────────────────────────────────────────────────────────────

/** The five-number summary every level of this API reports. All five are read. */
export interface Summary {
  n: number
  pctGood: number | null
  pctNeverGreen: number | null
  avgPts: number | null
  medSustained: number | null
}

/** One row of the bucket table. */
export interface Bucket extends Summary {
  bucket: string
  /** Server-decided (see header note 1). The client never derives it. */
  thin: boolean
  /** This bucket's A/B rate minus the WINDOW's. The number that matters. */
  lift: number | null
  /** Does the split point the same way in both halves? null = undecidable. */
  holds: boolean | null
  /** Read in exactly one place: the Holds cell tooltip. */
  firstHalf: Summary
  /** Read in exactly one place: the Holds cell tooltip. */
  secondHalf: Summary
}

/** GET /proxy/gex-change-top-study. */
export interface StudyResp {
  ok: boolean
  error?: string
  /** @neverReadInV2 — the client echoes its own `days` state in the subtitle. */
  days: number
  /** Read, and PREFERRED over the client's own `by` when copying a term. */
  by: string
  /** @neverReadInV2 — the client echoes its own `cohort` state. */
  cohort: string
  /** The bucket table's section title. Server string; never composed client-side. */
  label: string
  /** The bucket table's section note. Server string. */
  note: string
  /** Used only to WRITE the thin tooltip, the footnote and the verdict's floor. */
  minN: number
  /** Rendered in exactly one place: the bucket-table footnote. */
  splitDate: string | null
  overall: Summary
  /**
   * The control group. Returned independently of the selected cohort, so the
   * verdict sentence does not move when the cohort buttons do.
   */
  cohorts: { selected: Summary; shadow: Summary } | null
  /** SERVER-DRIVEN option list for the feature row. See FEATURE_FALLBACK. */
  features: { key: string; label: string }[]
  buckets: Bucket[]
}

/** One term of the projection rule: "this bucket of this feature is worth ±N". */
export interface Term {
  by: string
  bucket: string
  pts: number
}

/** One row of the calibration table. `actual` is grade → count. */
export interface CalRow extends Summary {
  projected: string
  actual: Record<string, number>
  /** Greys the row. Note: NO "thin" badge here, unlike the bucket table. */
  thin: boolean
}

/** GET /proxy/gex-change-top-calibration. */
export interface CalResp {
  ok: boolean
  /** @neverReadInV2 — loadCal is entirely silent; see D34. */
  error?: string
  /** The BODY's source of truth for armed. Not the rule bar's. See D98. */
  armed: boolean
  /** @neverReadInV2 */
  days: number
  /** @neverReadInV2 */
  note?: string
  /** @neverReadInV2 — the bar renders `rule.terms`, never these. */
  terms?: Term[]
  /** @neverReadInV2 — the bar's base falls back to the literal BASE_FALLBACK. */
  base?: number
  /** @neverReadInV2 */
  minN?: number
  /** Read: chooses between the two pre-table sentences, on TRUTHINESS. */
  unprojected?: number
  /** @neverReadInV2 */
  overall?: Summary
  rows?: CalRow[]
  /** Read, as the SECOND choice for `have`. */
  n?: number
  /**
   * Auto-fit status, so "not armed" can say WHEN it will arm, not just that it
   * isn't. @neverReadInV2 — the bar reads `rule.auto` instead, which is the
   * whole of BUG (v2) #3 below.
   */
  auto?: boolean
  /** @neverReadInV2 */
  source?: string
  /** @neverReadInV2 — the pinned warning reads `rule.pinnedBy`. */
  pinnedBy?: string | null
  /** Read, as the SECOND choice for `need`. */
  need?: number
  /** Read, as the FIRST choice for `have`. */
  have?: number
  /** @neverReadInV2 */
  fittedAt?: string | null
}

/** GET /proxy/gex-change-top-rule. */
export interface RuleState {
  ok: boolean
  /** The RULE BAR's source of truth for armed. Not the body's. See D98. */
  armed: boolean
  /** Keys the SOURCE map. An unknown value falls through to the raw string. */
  source: string
  base: number
  /** Rendered only when the rule is ARMED — an un-armed rule's note is swallowed. */
  note: string
  terms: Term[]
  /** Printed RAW, with no date formatting. */
  fittedAt: string | null
  pinnedBy: string | null
  /** Drives the not-armed detail line's ternary. See BUG (v2) #3. */
  auto: boolean
  /** @neverReadInV2 — the client floors the fit window itself; see `fitDays`. */
  fitDays: number
  thresholds: {
    /** The ONLY threshold read: the first choice for `need`. */
    minPicks: number
    /** @neverReadInV2 */
    minLift: number
    /** @neverReadInV2 */
    maxTerms: number
    /** @neverReadInV2 */
    maxPts: number
  }
  /** @neverReadInV2 — the last auto-fit's outcome, rendered nowhere. */
  lastFit?: {
    at: string
    armed: boolean
    reason: string
    applied: boolean
    note?: string | null
  } | null
}

/** One bucket the fit threw away, and why. The audit half of the preview. */
export interface Rejected {
  by: string
  bucket: string
  n: number
  lift: number | null
  why: string
}

/** POST /proxy/gex-change-top-rule-fit. */
export interface FitResp {
  ok: boolean
  error?: string
  /** Picks the preview's tone, and its headline when `applied` is falsy. */
  armed?: boolean
  /** Printed raw. `undefined` renders as nothing — React drops it. */
  reason?: string
  terms?: Term[]
  rejected?: Rejected[]
  /** Wins over `armed` for the headline: a stored fit reads "Fit stored". */
  applied?: boolean
  /** @neverReadInV2 */
  changed?: boolean
  note?: string | null
  /** @neverReadInV2 */
  pinnedBy?: string | null
  /** @neverReadInV2 */
  have?: number
  /** @neverReadInV2 */
  need?: number
  /** @neverReadInV2 */
  days?: number
}

/** Which of the three mutating buttons is in flight. `''` is idle. */
export type FitState = '' | 'preview' | 'arm' | 'disarm'

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS. Every literal below is v2's, at v2's value.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE GRADE LADDER, in this exact order, hardcoded in v2 at :115.
 *
 * Order-bearing twice over: it is the calibration table's six trailing columns
 * left→right, AND the rank `calSortValue` sorts the Predicted column by. Sorting
 * that column alphabetically would put "A+" between "A" and "B".
 */
export const GRADES: readonly string[] = ['A+', 'A', 'B', 'C', 'D', 'F']

/** Rank for an unknown grade string. Sinks it below F rather than above A+. */
export const UNKNOWN_GRADE_RANK = 99

/** Window options, in this order. v2 :126. */
export const DAY_OPTS: readonly number[] = [14, 30, 60, 90, 180]

export interface CohortOpt {
  key: string
  label: string
  /** Doubles as the button `title` AND as the body copy under the headline. */
  hint: string
}

/** The three cohorts, in this order. v2 :127–131. */
export const COHORTS: readonly CohortOpt[] = [
  {
    key: 'selected',
    label: 'Taken',
    hint: 'The picks that made the board — what the cards actually showed.',
  },
  {
    key: 'shadow',
    label: 'Passed on',
    hint: 'Candidates that qualified and cleared the entry floor but ranked below the top 5. The control group.',
  },
  {
    key: 'all',
    label: 'Both',
    hint: 'Taken and passed-on together — the widest sample, and the least conditioned on selection.',
  },
]

/**
 * Control defaults. v2 :350–352.
 *
 * NOTHING on this tab persists: not to localStorage, not to the URL. All three
 * reset on every remount, and a finding cannot be shared by copying the address
 * bar. Recorded as Part D open question 9 — step 3's call, not a silent fix.
 */
export const DEFAULT_BY = 'score'
export const DEFAULT_DAYS = 60
export const DEFAULT_COHORT = 'selected'

/**
 * The feature row's option list is SERVER-DRIVEN (`StudyResp.features`). This is
 * the one-entry fallback v2 renders before the first response lands and after
 * any study error (which nulls `data`). v2 :447.
 */
export const FEATURE_FALLBACK: readonly { key: string; label: string }[] = [
  { key: 'score', label: 'Score' },
]

/**
 * Client-side stand-ins for server values, all three hardcoded on v2's render
 * path. Whether 30 / 150 / 50 are the real server defaults is Part D open
 * question 8 — they are named here so there is exactly one place to change them.
 */
/** The verdict's control-group floor when `StudyResp.minN` is missing. */
export const MIN_N_FALLBACK = 30
/** The rule bar's evidence target, third and final fallback. */
export const NEED_FALLBACK = 150
/** The armed rule's base score when `RuleState.base` is missing. */
export const BASE_FALLBACK = 50

/** `liftColor`'s boundaries. INCLUSIVE both sides: +8.0 is up, +7.9 is not. */
export const LIFT_UP_PT = 8
export const LIFT_DOWN_PT = -8

/**
 * The verdict's noise band, in percentage points. STRICTLY less than 5 takes the
 * "inside the noise" branch. See `buildVerdict` for the rounding trap this sets.
 */
export const VERDICT_NOISE_PT = 5

/** The fit's window floor, in days. See `fitDays`. */
export const FIT_MIN_DAYS = 90

/** How long "✓ copied" stays on the button, in ms. v2 :455. */
export const COPIED_RESET_MS = 1600

/**
 * The one dimming value both tables share for a thin row. Not a colour and not a
 * size; it is the visual half of the thin verdict, so it lives with the rest of
 * the thin handling rather than being re-picked in step 3.
 */
export const THIN_ROW_OPACITY = 0.45

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTERS.
//
// These are NOT `format.ts`'s `fmtPct` / `pctOrDash`: both of those take a 0–1
// fraction and multiply, and every number on this tab is already in percent
// units. `EM_DASH` is imported rather than retyped so the "no value" glyph is
// the same U+2014 the other six tabs use.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "62%". Zero decimal places at EVERY call site in v2 — no caller passes `dp`.
 * NaN and Infinity both land on the dash, same as null.
 */
export function pct(v: number | null | undefined, dp = 0): string {
  return v == null || !Number.isFinite(v) ? EM_DASH : `${v.toFixed(dp)}%`
}

/**
 * "+12", "-4". Zero dp everywhere in v2.
 *
 * Negative zero prints "+0": `-0 >= 0` is true in JS, so the plus is prefixed,
 * and `(-0).toFixed(0)` is "0". Copied as written — it is unreachable from the
 * current data, and "fixing" it would be a behaviour change with no caller.
 */
export function signed(v: number | null | undefined, dp = 0): string {
  return v == null || !Number.isFinite(v) ? EM_DASH : `${v >= 0 ? '+' : ''}${v.toFixed(dp)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOUR LADDERS. Boundaries are business logic; the values are tokens.
// See the colour-split note in the file header for why each token was picked.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "Up above the line, down below — the only thing a lift column has to say."
 *
 * Three branches, in this order, both boundaries inclusive:
 *   null       → T.text   (v2: HT.text #FFFFFF — already exact, unchanged)
 *   >= +8      → V2.up    (v2: HOME_THEME.green #8ECAE6, job (b) → #1FD98A)
 *   <= -8      → V2.red   (v2: HOME_THEME.red   #EF4444)
 *   otherwise  → T.text
 *
 * A 0 lift and a MISSING lift are painted identically. That is v2's, and it is
 * the one place on this tab where "measured, and flat" and "not measured" are
 * indistinguishable. The spec flags it as a defect; it is not a palette
 * question, so it stays. If step 3 wants them apart, the dead band is T.flat
 * and null is T.faint — but that is a change, not parity.
 */
export function liftColor(v: number | null): string {
  if (v == null) return T.text
  if (v >= LIFT_UP_PT) return V2.up
  if (v <= LIFT_DOWN_PT) return V2.red
  return T.text
}

/** "✓" / "✗" / "—" and their ink. null is NOT a failure — it is undecidable. */
export const HOLDS_YES = '✓'
export const HOLDS_NO = '✗'

export function holdsGlyph(holds: boolean | null): string {
  return holds == null ? EM_DASH : holds ? HOLDS_YES : HOLDS_NO
}

export function holdsColor(holds: boolean | null): string {
  // A hit/miss test — the positive leg of the #8ECAE6 split. V2.up / V2.red.
  return holds == null ? T.text : holds ? V2.up : V2.red
}

/**
 * BUCKET TABLE never-green ink — the CONDITIONAL rule.
 *
 * Red only when this bucket is WORSE than the window as a whole. Strictly
 * greater, and both sides coalesce null to 0, so a bucket with no never-green
 * figure compares as 0 and can never redden.
 *
 * BUG-ADJACENT (v2): the calibration table paints the SAME column header
 * ("NEVER GREEN") unconditionally red — see `calNeverGreenColor`. Two tables,
 * one header string, two meanings for the colour. Both are ported as written;
 * the conditional one is the informative rule and is the one to keep if step 3
 * unifies them.
 */
export function bucketNeverGreenColor(
  bucketPctNeverGreen: number | null,
  overallPctNeverGreen: number | null | undefined,
): string {
  return (bucketPctNeverGreen ?? 0) > (overallPctNeverGreen ?? 0) ? V2.red : T.text
}

/**
 * CALIBRATION TABLE never-green ink — the UNCONDITIONAL rule.
 *
 * Always red, including on a null (which renders as an em dash, in red). See the
 * note on `bucketNeverGreenColor`: same header, different rule, same screen.
 */
export function calNeverGreenColor(): string {
  return V2.red
}

/**
 * Term-chip ink. INCLUSIVE at zero, so a 0-point term is an "up" chip reading
 * "+0" — a term that does nothing, painted as if it did something. v2's, kept.
 */
export function termChipColor(pts: number): string {
  return pts >= 0 ? V2.up : V2.red
}

/**
 * Both table header rows. The CHROME leg of the #8ECAE6 split — v2 painted
 * these `HOME_THEME.green` and they keep that exact value (job (a)).
 */
export const TABLE_HEADER_COLOR = V2.green

/** The headline's A/B rate. UNCONDITIONAL: a 12% rate is the same ink as 80%. */
export const HEADLINE_GOOD_COLOR = V2.up
/** The headline's never-green rate. Unconditional too. */
export const HEADLINE_BAD_COLOR = V2.red
/**
 * The headline's graded-pick count, and the RateBar fill. A MAGNITUDE, not a
 * sign — V2.cyan on purpose, and deliberately NOT V2.up. Unifying them would
 * make an 8% hit rate and a -8pt lift the same colour; see the file header.
 */
export const COUNT_COLOR = V2.cyan
export const RATE_BAR_FILL = V2.cyan

/**
 * The two error lines and the Disarm button: an ALERT, not a direction. v2
 * paints alerts and negatives with the same `HOME_THEME.red` #EF4444, so this
 * resolves to the same value as the directional red — kept a separate constant
 * because they are separate ideas and may move apart.
 */
export const ALERT_COLOR = V2.red

/**
 * "✓ copied" — a SUCCESS acknowledgement that a control fired, so it takes the
 * positive/success role colour (COLOR-REMAP decision 2). Job (d).
 */
export const COPIED_COLOR = V2.up

/** Section titles, the thin badge, the pinned warning, `fit.note`. */
export const WARN_COLOR = V2.orange

/** Bar width for a hit rate. Clamped 0–100, so an out-of-range value pins. */
export function rateBarWidthPct(v: number): number {
  return Math.max(0, Math.min(100, v))
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMNS AND SORTING.
//
// Sorting is a THREE-state cycle (desc → asc → back to server order), because
// server order is itself meaningful here: buckets arrive in the feature's own
// order and calibration rows arrive grade-ranked. Nulls sink on both passes.
// Neither table sets an initial sort key — first paint is server order.
// ─────────────────────────────────────────────────────────────────────────────

export type BucketSortKey =
  | 'bucket'
  | 'n'
  | 'pctGood'
  | 'lift'
  | 'holds'
  | 'neverGreen'
  | 'avgPts'
  | 'medSustained'

/** Grade columns are keyed `g:<letter>`, so "g:A+" is a valid key. */
export type CalSortKey = 'projected' | 'n' | 'pctGood' | 'neverGreen' | 'avgPts' | `g:${string}`

/** What the sort reads. Mirrors the shared hook's SortValue. */
export type SortValue = number | string | boolean | null | undefined

export function bucketSortValue(b: Bucket, k: BucketSortKey): SortValue {
  switch (k) {
    case 'bucket':
      return b.bucket
    case 'n':
      return b.n
    case 'pctGood':
      return b.pctGood
    case 'lift':
      return b.lift
    // Projected to 1/0/null so ✓ sorts above ✗ above —, which is the order you
    // actually scan for. That ordering only holds on a DESCENDING pass, and only
    // because the shared sort sinks nulls in both directions.
    case 'holds':
      return b.holds == null ? null : b.holds ? 1 : 0
    // Note the sort key and the field name differ: "neverGreen" reads
    // `pctNeverGreen`. Not a typo — the key names the COLUMN.
    case 'neverGreen':
      return b.pctNeverGreen
    case 'avgPts':
      return b.avgPts
    case 'medSustained':
      return b.medSustained
    default:
      return null
  }
}

export function calSortValue(r: CalRow, k: CalSortKey): SortValue {
  // A missing grade count sorts as 0, never as null — so it competes rather than
  // sinking. The bucket table does the opposite with its missing values; the two
  // tables genuinely differ here.
  if (k.startsWith('g:')) return r.actual?.[k.slice(2)] ?? 0
  switch (k) {
    // By grade RANK, not alphabetically — "A+" must not land between "A" and "B".
    case 'projected': {
      const i = GRADES.indexOf(r.projected)
      return i < 0 ? UNKNOWN_GRADE_RANK : i
    }
    case 'n':
      return r.n
    case 'pctGood':
      return r.pctGood
    case 'neverGreen':
      return r.pctNeverGreen
    case 'avgPts':
      return r.avgPts
    default:
      return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE THREE-STATE SORT ITSELF.
//
// ADDED IN STEP 3 (see the report): transcribed from v2's shared
// `components/shared/useTableSort.tsx`, which is what both of this tab's tables
// sort through (`SortTh sort={bucketSort} …`). Step 2 ported the two
// `*SortValue` accessors and stopped there, so the cycle, the null sink and the
// stability rule — all of which decide what a reader sees — had nowhere to live
// but the component. They are behaviour, so they live here.
//
// Three rules, all v2's:
//   1. desc → asc → UNSORTED. The third click is not a nicety: server order is
//      meaningful on both tables (buckets arrive in the feature's own order,
//      calibration rows arrive grade-ranked) and must be reachable without a
//      reload.
//   2. NULLS SINK IN BOTH DIRECTIONS. A missing number is not a small one, and
//      letting "—" win the top of a descending sort is the fastest way to
//      misread a table. Empty strings and non-finite numbers count as null.
//   3. STABLE. Equal values keep the incoming (server) order.
// ─────────────────────────────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc'

export interface SortState<K extends string> {
  /** null = unsorted, i.e. the order the server sent. */
  key: K | null
  dir: SortDir
}

/** Neither table sets an initial sort key — first paint is server order. */
export function initialSortState<K extends string>(): SortState<K> {
  return { key: null, dir: 'desc' }
}

/** desc → asc → unsorted. A different column always restarts at desc. */
export function cycleSort<K extends string>(cur: SortState<K>, k: K): SortState<K> {
  if (cur.key !== k) return { key: k, dir: 'desc' }
  if (cur.dir === 'desc') return { key: k, dir: 'asc' }
  return { key: null, dir: 'desc' }
}

/** Booleans rank true above false; everything else compares numerically or by locale. */
export function compareSortValues(a: SortValue, b: SortValue): number {
  const aNull = a == null || a === '' || (typeof a === 'number' && !Number.isFinite(a))
  const bNull = b == null || b === '' || (typeof b === 'number' && !Number.isFinite(b))
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1

  const av = typeof a === 'boolean' ? (a ? 1 : 0) : a
  const bv = typeof b === 'boolean' ? (b ? 1 : 0) : b

  if (typeof av === 'number' && typeof bv === 'number') return av - bv
  return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
}

/** A sorted COPY, or `rows` untouched when no column is active. Never mutates. */
export function applySort<T, K extends string>(
  rows: readonly T[],
  state: SortState<K>,
  get: (row: T, key: K) => SortValue,
): T[] {
  const key = state.key
  if (!key) return rows as T[]
  const sign = state.dir === 'asc' ? 1 : -1
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const d = compareSortValues(get(x.row, key), get(y.row, key))
      return d !== 0 ? d * sign : x.i - y.i
    })
    .map((w) => w.row)
}

/** The header caret. The inactive glyph is dimmed rather than hidden. */
export const SORT_ARROW = { asc: '▲', desc: '▼', inactive: '↕' } as const
export const SORT_INACTIVE_OPACITY = 0.32

export function sortArrow<K extends string>(state: SortState<K>, k: K): string {
  if (state.key !== k) return SORT_ARROW.inactive
  return state.dir === 'asc' ? SORT_ARROW.asc : SORT_ARROW.desc
}

/** v2 appends its own affordance line to a column's own tooltip. */
export function sortThTitle(title?: string): string {
  return title ? `${title}\n\nClick to sort.` : 'Click to sort'
}

export interface ColumnDef<K extends string> {
  /** null for a non-sortable column. */
  key: K | null
  /** Rendered upper-cased by the header row. Stored at its typed casing. */
  label: string
  align: 'left' | 'right'
  title?: string
}

/**
 * BUCKET TABLE — 9 columns, in render order.
 *
 * The count matters: v2's empty-state row spans `colSpan={9}`, which is CORRECT
 * here. Compare CAL_COLUMNS below, where it is not.
 */
export const BUCKET_COLUMNS: readonly ColumnDef<BucketSortKey>[] = [
  { key: 'bucket', label: 'Bucket', align: 'left' },
  { key: 'n', label: 'n', align: 'right' },
  { key: 'pctGood', label: 'A/B rate', align: 'left' },
  {
    key: 'lift',
    label: 'Lift',
    align: 'right',
    title: "Hit rate minus the window's overall hit rate. This is the number that matters.",
  },
  {
    key: 'holds',
    label: 'Holds',
    align: 'right',
    title:
      'Does the split point the same way in BOTH halves of the window? A ✗ means it did not survive out of sample.',
  },
  { key: 'neverGreen', label: 'Never green', align: 'right' },
  { key: 'avgPts', label: 'Avg pts', align: 'right' },
  {
    key: 'medSustained',
    // The period after "Med" is in the source label.
    label: 'Med. sustained',
    align: 'right',
    title:
      'Median best gain that held for two consecutive snapshots — a fillable move, not a one-print spike.',
  },
  // The copy-term column. Blank header, and NOT sortable — a plain <th> in v2.
  { key: null, label: '', align: 'right' },
]

export const BUCKET_COLUMN_COUNT = BUCKET_COLUMNS.length

/**
 * CALIBRATION TABLE — 5 fixed columns plus one per grade = ELEVEN.
 *
 * BUG (v2): the empty-state row is `<td colSpan={10}>` (PickStudyTab.tsx:686)
 * against these eleven columns, so the cell under-spans by one and the last
 * grade column sits outside it. The bucket table's equivalent (colSpan={9})
 * spans correctly, which is what makes this a slip rather than a convention.
 *
 * `CAL_COLUMN_COUNT` is derived, not typed, so the empty row cannot drift out of
 * step with the header again: step 3 renders `colSpan={CAL_COLUMN_COUNT}` — 11,
 * not v2's 10. That is a RENDER concern and the only reason it is recorded here
 * is so step 3 gets the count from one place.
 */
export const CAL_FIXED_COLUMNS: readonly ColumnDef<CalSortKey>[] = [
  { key: 'projected', label: 'Predicted', align: 'left' },
  { key: 'n', label: 'n', align: 'right' },
  { key: 'pctGood', label: 'Actual A/B', align: 'left' },
  { key: 'neverGreen', label: 'Never green', align: 'right' },
  { key: 'avgPts', label: 'Avg pts', align: 'right' },
]

/** "How many of these picks actually graded A+." — one per grade column. */
export function gradeColumnTitle(grade: string): string {
  return `How many of these picks actually graded ${grade}.`
}

export const CAL_COLUMNS: readonly ColumnDef<CalSortKey>[] = [
  ...CAL_FIXED_COLUMNS,
  ...GRADES.map((g): ColumnDef<CalSortKey> => ({
    key: `g:${g}`,
    label: g,
    align: 'right',
    title: gradeColumnTitle(g),
  })),
]

export const CAL_COLUMN_COUNT = CAL_COLUMNS.length

/** A grade cell's count. A missing key and a real 0 are indistinguishable. */
export function gradeCount(r: CalRow, grade: string): number {
  return r.actual?.[grade] ?? 0
}

/**
 * Is this grade cell dimmed? v2 tests TRUTHINESS, so a zero renders as "0" at
 * 30% ink rather than as a dash — and a missing key looks exactly like a
 * measured zero.
 */
export function gradeCountIsDim(r: CalRow, grade: string): boolean {
  return !r.actual?.[grade]
}

// ─────────────────────────────────────────────────────────────────────────────
// THIN-BUCKET HANDLING.
// ─────────────────────────────────────────────────────────────────────────────

/** The badge. Literal lowercase, appended after the bucket name. */
export const THIN_BADGE = 'thin'

/**
 * The badge's tooltip. Both "(s)" are literal and never resolved, even at n=1 —
 * v2 wrote them that way and every sentence on this tab does the same.
 */
export function thinBadgeTitle(n: number, minN: number): string {
  return `Only ${n} pick(s) — under the ${minN} minimum. Not a finding yet.`
}

/**
 * The Holds tooltip — the ONLY place `firstHalf` / `secondHalf` are read. Sits
 * on the <td>, so it is present on every row including the "—" ones.
 */
export function holdsTitle(b: Bucket): string {
  return `First half ${pct(b.firstHalf.pctGood)} (n=${b.firstHalf.n}) · second half ${pct(b.secondHalf.pctGood)} (n=${b.secondHalf.n})`
}

// ─────────────────────────────────────────────────────────────────────────────
// THE CONTROL-GROUP VERDICT — D41–D45.
// ─────────────────────────────────────────────────────────────────────────────

export interface Verdict {
  tone: string
  text: string
}

/** The bold run in front of every verdict sentence. */
export const VERDICT_PREFIX = 'Taken vs passed on · '

/**
 * "The control-group comparison, stated as a single sentence rather than left
 * for the reader to compute from two cells."
 *
 * Returns null — the whole box is absent — when there are no cohorts at all, or
 * either side's hit rate is null. Branches are evaluated in this order.
 *
 * BUG (v2): THE ROUNDING TRAP. `d` is compared at FULL precision (`< 5`) but
 * printed through `signed()` at 0 dp. A gap of 4.6 therefore takes the "inside
 * the noise" branch while printing "+5pt", and -4.6 prints "-5pts" in an orange
 * box. The code is right and the sentence looks wrong. Ported exactly as
 * written: rounding the comparison instead would silently move the boundary, and
 * printing a decimal would change four sentences' typography. Step 3 decides
 * which — do not fix it by accident.
 */
export function buildVerdict(data: StudyResp | null | undefined): Verdict | null {
  const c = data?.cohorts
  if (!c || c.selected.pctGood == null || c.shadow.pctGood == null) return null

  const minN = data?.minN ?? MIN_N_FALLBACK
  if (c.shadow.n < minN) {
    return {
      // Neutral, not a warning: nothing is wrong, there is simply not enough yet.
      tone: T.text,
      text: `Only ${c.shadow.n} passed-on pick(s) recorded so far — the control group needs ${minN}+ before this comparison means anything. It starts filling from the deploy that turned shadow recording on.`,
    }
  }

  const d = c.selected.pctGood - c.shadow.pctGood

  if (Math.abs(d) < VERDICT_NOISE_PT) {
    return {
      tone: V2.orange,
      text: `Taken picks hit ${pct(c.selected.pctGood)} vs ${pct(c.shadow.pctGood)} for the ones passed on — a ${signed(d)}pt gap. That is inside the noise: on this sample the top-5 cut is not doing measurable work.`,
    }
  }

  if (d > 0) {
    // Note this branch drops "for the ones" — the only one of the four that does.
    return {
      tone: V2.up,
      text: `Taken picks hit ${pct(c.selected.pctGood)} vs ${pct(c.shadow.pctGood)} passed on — ${signed(d)}pts. The ranking is selecting something real.`,
    }
  }

  return {
    tone: V2.red,
    text: `Taken picks hit ${pct(c.selected.pctGood)} vs ${pct(c.shadow.pctGood)} for the ones passed on — ${signed(d)}pts. The picks you skipped did BETTER. Check the ranking before tuning anything else.`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE COPY-TERM BUTTON — D70–D73.
//
// NOTE, not a cut: this button emits a JSON fragment for
// server-v2/config/pick-proj-rule.json — the hand-written file that v2's own
// header comment calls "a procedure nobody runs on a schedule", and which the
// in-app fit (with a preview and a rejection audit) replaced. It is also the one
// control that can silently do nothing: a blocked clipboard produces no ✓ and no
// error. Whether it survives is Part D open question 5. It is transcribed here
// so the decision is a decision.
// ─────────────────────────────────────────────────────────────────────────────

export const COPY_TERM_IDLE = '⧉ term'
export const COPY_TERM_DONE = '✓ copied'

/** Two lines, joined by a literal newline in the title attribute. */
export const COPY_TERM_TITLE =
  'Copy this bucket as a projection-rule term for server-v2/config/pick-proj-rule.json.\nThe SIGN is what the data supports; the magnitude (lift used directly as points) is a convention you should sanity-check.'

/**
 * The clipboard payload: `{"by":"score","bucket":"70-79","pts":12}`.
 *
 * `by` prefers the SERVER's echoed `data.by` over the client's own state, so a
 * term copied mid-refetch names the feature the numbers actually came from.
 * `pts` is `Math.round` of the lift — and a NULL lift becomes 0, which is a term
 * that does nothing. v2's, kept.
 */
export function copyTermPayload(b: Bucket, data: StudyResp | null, by: string): string {
  return JSON.stringify({ by: data?.by ?? by, bucket: b.bucket, pts: Math.round(b.lift ?? 0) })
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RULE BAR — D77–D87.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BUG (v2): TWO SOURCES OF TRUTH FOR "ARMED", #1 of 2.
 *
 * The rule bar's armed flag comes from /proxy/gex-change-top-rule. The BODY
 * immediately below it uses `isNotArmed`, which reads
 * /proxy/gex-change-top-calibration instead. They are separate fetches with
 * separate failure modes, so the bar can read "Armed" with term chips above
 * prose saying "Nothing is being predicted yet".
 *
 * Reachable two ways: the calibration route errors or lags the rule route; or
 * the ↻ button is pressed — it refreshes the study and the calibration and
 * DELIBERATELY NOT the rule (see REFRESH_TARGETS). `runFit(apply)` and `disarm`
 * both refresh the pair, so the normal flows stay consistent.
 *
 * Ported as written. Part D open question 7 asks whether v3 should derive the
 * body's gate from the rule state so the two cannot disagree — step 3's call.
 */
export function ruleBarArmed(rule: RuleState | null): boolean {
  return !!rule?.armed
}

/**
 * BUG (v2): TWO SOURCES OF TRUTH FOR "ARMED", #2 of 2 — and a four-state
 * collapse.
 *
 * This is v2's `!cal || !cal.armed` (PickStudyTab.tsx:632), exactly as written.
 * It is true — and the identical block of not-armed prose renders — in FOUR
 * distinguishable situations:
 *
 *   1. FIRST PAINT. `cal` is null until the calibration fetch resolves, so the
 *      prose is what the tab shows while that request is still in flight.
 *   2. THE FETCH THREW. `.catch(() => setCal(null))` — network error, parse
 *      error, a 500.
 *   3. THE BODY CAME BACK `ok: false`. `setCal(j?.ok ? j : null)` throws the
 *      error field away without ever reading it.
 *   4. GENUINELY NOT ARMED. The only one the prose actually describes.
 *
 * On screen they are identical. A calibration route that 500s reads as "nothing
 * is being predicted yet", which is a sentence about the RULE being told by a
 * failure of the REQUEST. v3's `query()`/`useQuery()` carry an error channel;
 * step 3 should split at least (2)+(3) out from (4), and (1) needs its own
 * loading beat — this tab has none, the only loading affordance anywhere on it
 * being the card subtitle's " · loading…" for the STUDY fetch.
 */
export function isNotArmed(cal: CalResp | null): boolean {
  return !cal || !cal.armed
}

export interface RuleBarState {
  armed: boolean
  /** Evidence target. Three-deep fallback, final literal NEED_FALLBACK. */
  need: number
  /** Evidence collected. Comes from the CALIBRATION response, unlike `need`. */
  have: number
  ready: boolean
  tone: string
  busy: boolean
}

/**
 * The four derived values that drive the whole bar (v2 :180–184).
 *
 * Note where each side comes from: `need` is the RULE's threshold, `have` is the
 * CALIBRATION's count. The "88 of 150" progress line is therefore assembled from
 * two independent responses, and if either is missing the literal fallback fills
 * in silently.
 */
export function ruleBarState(
  rule: RuleState | null,
  cal: CalResp | null,
  fitting: FitState,
): RuleBarState {
  const armed = ruleBarArmed(rule)
  const need = rule?.thresholds.minPicks ?? cal?.need ?? NEED_FALLBACK
  const have = cal?.have ?? cal?.n ?? 0
  const ready = have >= need
  return {
    armed,
    need,
    have,
    ready,
    // Armed is a SUCCESS state — the evidence cleared the bar — so it takes
    // V2.up #1FD98A rather than the header chrome colour V2.green #8ECAE6 that
    // v2 shared with it (COLOR-REMAP decision 2, 2026-09-03). "Ready to arm" is
    // cyan; "collecting evidence" is orange.
    tone: armed ? V2.up : ready ? V2.cyan : V2.orange,
    busy: fitting !== '',
  }
}

/** The three status words. Exactly these, in this precedence. */
export const STATUS_ARMED = 'Armed'
export const STATUS_READY = 'Ready to arm'
export const STATUS_COLLECTING = 'Collecting evidence'

export function statusWord(s: RuleBarState): string {
  return s.armed ? STATUS_ARMED : s.ready ? STATUS_READY : STATUS_COLLECTING
}

/** Where an armed rule came from. An unknown key falls through to the raw value. */
export const RULE_SOURCE_TEXT: Record<string, string> = {
  env: 'pinned by the GEX_CHANGE_TOP_PROJ_RULE env var',
  file: 'pinned by config/pick-proj-rule.json',
  stored: 'fitted from the study',
  none: 'none',
}

/**
 * The armed detail line: "2 term(s) · base 50 · fitted from the study · <when>".
 *
 * `fittedAt` is printed RAW, with no date formatting — whatever string the
 * server sends lands on screen. The "(s)" is literal and never resolves.
 */
export function armedDetailLine(rule: RuleState | null): string {
  const key = rule?.source ?? 'none'
  // v2 wrote `SOURCE[k] ?? rule?.source`, which is `string | undefined` here
  // under noUncheckedIndexedAccess. The extra `?? key` cannot change the result:
  // when `rule` is null the key is 'none', which the map always has.
  const source = RULE_SOURCE_TEXT[key] ?? rule?.source ?? key
  const terms = rule?.terms.length ?? 0
  const base = rule?.base ?? BASE_FALLBACK
  const when = rule?.fittedAt ? ` · ${rule.fittedAt}` : ''
  return `${terms} term(s) · base ${base} · ${source}${when}`
}

export const AUTOFIT_ON_SUFFIX = ' · re-checked automatically after every EOD freeze'
export const AUTOFIT_OFF_SUFFIX = ' · auto-fit is OFF (GEX_CHANGE_TOP_AUTOFIT=0)'

/**
 * The not-armed detail line: "88/150 graded picks · <one of the two suffixes>".
 *
 * BUG (v2): the ternary tests `rule?.auto`, and `rule` is null whenever the RULE
 * FETCH FAILED (loadRule is silent — `setRule(null)` on both a throw and an
 * `ok:false` body). So a failed request renders
 *
 *     "0/150 graded picks · auto-fit is OFF (GEX_CHANGE_TOP_AUTOFIT=0)"
 *
 * — an UNKNOWN state asserted as a specific env var setting the client has no
 * evidence for whatsoever. It is also the cold-start string, so the two are
 * indistinguishable. Ported exactly as written. v3 needs a THIRD string for
 * "rule state unknown", or it must stop naming a setting it cannot see; that is
 * a copy decision for step 3, not a silent fix here.
 */
export function notArmedDetailLine(s: RuleBarState, rule: RuleState | null): string {
  return `${s.have}/${s.need} graded picks${rule?.auto ? AUTOFIT_ON_SUFFIX : AUTOFIT_OFF_SUFFIX}`
}

export function ruleDetailLine(s: RuleBarState, rule: RuleState | null): string {
  return s.armed ? armedDetailLine(rule) : notArmedDetailLine(s, rule)
}

/** Fit button — a dry run. Label depends on both `fitting` and `armed`. */
export const FIT_BTN_BUSY = 'fitting…'
export const FIT_BTN_ARMED = 'Re-fit (preview)'
export const FIT_BTN_IDLE = 'Fit now'
export const FIT_BTN_TITLE =
  'Dry run. Shows the terms the fit would arm and every bucket it rejected, without changing anything.'

export function fitButtonLabel(fitting: FitState, armed: boolean): string {
  if (fitting === 'preview') return FIT_BTN_BUSY
  return armed ? FIT_BTN_ARMED : FIT_BTN_IDLE
}

/** Arm button — runs the fit AND stores it. */
export const ARM_BTN_BUSY = 'arming…'
export const ARM_BTN_ARMED = 'Re-fit & store'
export const ARM_BTN_IDLE = 'Fit & arm'
export const ARM_BTN_TITLE =
  'Run the fit and store the result. From the next capture on, every pick is stamped with a projected grade.'

export function armButtonLabel(fitting: FitState, armed: boolean): string {
  if (fitting === 'arm') return ARM_BTN_BUSY
  return armed ? ARM_BTN_ARMED : ARM_BTN_IDLE
}

/** Disarm button. The busy label is a BARE ellipsis — no word. */
export const DISARM_BTN_BUSY = '…'
export const DISARM_BTN_IDLE = 'Disarm'
export const DISARM_BTN_TITLE =
  'Clear the stored rule and stop projecting. Projections already stamped on past picks are left alone — they are the calibration.'

export function disarmButtonLabel(fitting: FitState): string {
  return fitting === 'disarm' ? DISARM_BTN_BUSY : DISARM_BTN_IDLE
}

/**
 * The Disarm button exists only for a rule that was FITTED. A rule pinned by the
 * env var or by config/pick-proj-rule.json shows no Disarm at all — you cannot
 * clear from the UI something the UI did not write.
 */
export function showDisarm(rule: RuleState | null): boolean {
  return ruleBarArmed(rule) && rule?.source === 'stored'
}

/**
 * Progress-bar width, as a percentage. Rendered only when NOT armed.
 *
 * Two guards, both deliberate: a 2% floor so zero progress still shows a stub
 * ("needs 150, has 0" is a wait with an end, and an invisible bar is not), and
 * `need` clamped to at least 1 against a divide-by-zero.
 */
export function progressWidthPct(have: number, need: number): number {
  return Math.max(2, Math.min(100, (have / Math.max(1, need)) * 100))
}

/** Chips render only for an armed rule that actually has terms. */
export function showTermChips(rule: RuleState | null): boolean {
  return ruleBarArmed(rule) && (rule?.terms.length ?? 0) > 0
}

/** Stable key for a term chip, in both the bar and the fit preview. */
export function termKey(t: Term): string {
  return `${t.by}:${t.bucket}`
}

/**
 * The pinned-rule warning. Rendered whenever `pinnedBy` is truthy — INCLUDING
 * when the rule is not armed, which is the one place this bar tells you about a
 * rule that is not in force.
 */
export function pinnedWarning(pinnedBy: string): string {
  const where = pinnedBy === 'env' ? 'env var' : 'config/pick-proj-rule.json'
  return `A hand-written rule is pinning this (${where}). The auto-fit will still run and report, but it will not overwrite what you pinned.`
}

/** The server's rule note is shown only when the rule is ARMED. Otherwise swallowed. */
export function showRuleNote(rule: RuleState | null): boolean {
  return !!rule?.note && ruleBarArmed(rule)
}

// ─────────────────────────────────────────────────────────────────────────────
// THE FIT PREVIEW — D89–D96.
//
// "The rejected list is the important half. A rule you cannot audit is a fitted
// model with extra steps, and the buckets that ALMOST made it are exactly where
// a bad rule would come from."
// ─────────────────────────────────────────────────────────────────────────────

export const FIT_HEADLINE_STORED = 'Fit stored'
export const FIT_HEADLINE_PREVIEW = 'Fit result (not stored)'
export const FIT_HEADLINE_NOTHING = 'Nothing to arm'

/** `applied` WINS over `armed`: a stored fit reads "Fit stored" either way. */
export function fitHeadline(fit: FitResp): string {
  if (fit.applied) return FIT_HEADLINE_STORED
  return fit.armed ? FIT_HEADLINE_PREVIEW : FIT_HEADLINE_NOTHING
}

export function fitPreviewTone(fit: FitResp): string {
  // Armed is a success state — V2.up, not the chrome green. See `ruleBarState`.
  return fit.armed ? V2.up : V2.orange
}

/** The <details> summary. Collapsed by default; the "(s)" is literal. */
export function rejectedSummary(n: number): string {
  return `${n} bucket(s) rejected — why`
}

/** The lift cell in a rejected row: "+12pt", "-9pt", or a bare em dash. */
export function rejectedLiftText(lift: number | null): string {
  return lift == null ? EM_DASH : `${signed(lift)}pt`
}

/** Stable key for a rejected row — bucket names repeat across features. */
export function rejectedKey(r: Rejected, i: number): string {
  return `${r.by}:${r.bucket}:${i}`
}

/** The dismiss control. No title attribute in v2. */
export const FIT_DISMISS = '✕'

// ─────────────────────────────────────────────────────────────────────────────
// EVERY REMAINING COPY STRING. Named so step 3 cannot paraphrase one.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The card title, as typed. v2's PageCard upper-cases it, so "PICK STUDY" is
 * what renders — the casing is chrome, the string is this.
 */
export const CARD_TITLE = 'Pick Study'

/**
 * The card subtitle, and the tab's ONLY loading affordance anywhere.
 *
 * `days` is client state, so the subtitle names the REQUESTED window
 * immediately, before the response for it lands. The suffix tracks the STUDY
 * fetch only — the calibration and rule fetches have no loading flag at all.
 */
export function cardSubtitle(days: number, loading: boolean): string {
  return `What the graded picks had in common at capture · ${days}d window${loading ? ' · loading…' : ''}`
}

/** The day buttons' labels: "14d", "30d", … */
export function dayLabel(d: number): string {
  return `${d}d`
}

/** The refresh glyph. Never disabled, never busy — a second click double-fires. */
export const REFRESH_GLYPH = '↻'

/**
 * What ↻ refreshes. THE RULE IS DELIBERATELY ABSENT (v2 :500) — this is one of
 * the two ways to desynchronise `rule.armed` from `cal.armed`. Named so the
 * omission is visible rather than looking like something step 3 forgot.
 */
export const REFRESH_TARGETS = ['study', 'calibration'] as const

/** Headline row. The count's plural: 1 → "graded pick", everything else → "picks". */
export function gradedPicksLabel(n: number | undefined): string {
  return `graded pick${n === 1 ? '' : 's'}`
}
export const HEADLINE_AB_LABEL = 'A/B rate'
export const HEADLINE_NEVER_GREEN_LABEL = 'never green'
export const HEADLINE_AVG_LABEL = 'avg'

/**
 * The headline's average, with its "/100" suffix — the ONLY place that suffix
 * appears. The same field renders as a bare `toFixed(0)` in both tables.
 */
export function headlineAvgText(avgPts: number | null | undefined): string {
  return avgPts == null ? EM_DASH : `${avgPts.toFixed(0)}/100`
}

/** A table's Avg pts cell. No suffix here. */
export function avgPtsText(avgPts: number | null): string {
  return avgPts == null ? EM_DASH : avgPts.toFixed(0)
}

/** A bucket's Lift cell: "+12pt" — SINGULAR "pt", no "s". Dash carries no suffix. */
export function liftText(lift: number | null): string {
  return lift == null ? EM_DASH : `${signed(lift)}pt`
}

/** A bucket's Med. sustained cell: "+3%". Dash carries no "%". */
export function medSustainedText(v: number | null): string {
  return v == null ? EM_DASH : `${signed(v)}%`
}

/** The bucket table's empty row. Spans BUCKET_COLUMN_COUNT (9) — correct in v2. */
export const BUCKET_EMPTY = 'No graded picks in this window yet.'

/**
 * The bucket-table footnote. The only place `splitDate` is rendered, and it
 * renders whenever `data` exists — including when `buckets` is empty.
 *
 * Bold runs, for step 3: "first" and "Holds".
 */
export function bucketFootnote(splitDate: string | null, minN: number): string {
  return `Features come from the slot each pick was first flagged — the only source that cannot see the outcome. Lift is this bucket's A/B rate minus the window's. Holds recomputes the split on each half of the window separately (split at ${splitDate ?? EM_DASH}, by date so no session lands on both sides); a ${HOLDS_NO} means it did not survive out of sample and is not a finding. Buckets under n=${minN} are greyed.`
}

export const BUCKET_FOOTNOTE_BOLD: readonly string[] = ['first', 'Holds']

/** The calibration section's own title. NOT upper-cased, unlike the card title. */
export const CAL_SECTION_TITLE = 'Calibration · grading the grader'

/**
 * The pre-table line, chosen on the TRUTHINESS of `cal.unprojected` — so 0,
 * undefined and null all take the second string.
 */
export function unprojectedLine(unprojected: number | undefined): string {
  return unprojected
    ? `${unprojected} pick(s) were captured before the rule was armed and carry no projection — they are excluded from this table, not counted as misses.`
    : 'Every pick in the window carries a projection.'
}

/** The calibration table's empty row. See CAL_COLUMN_COUNT for the colSpan bug. */
export const CAL_EMPTY =
  'Rule is armed but no picks carry a projection yet — they start appearing at the next capture.'

export const CAL_FOOTNOTE =
  'Read down the Predicted column: the A/B rate should rise monotonically from F to A+. If it does not, the rule is not ranking. Projections are stamped at capture and never recomputed, so retuning the rule leaves the old predictions intact — which is what makes this table a real out-of-sample test rather than a restatement.'

/**
 * THE NOT-ARMED PROSE — three paragraphs, separated by a double break in v2.
 * This is the DEFAULT state of the tab, and per `isNotArmed` it is also what a
 * first paint, a thrown calibration fetch and an `ok:false` body all render.
 */
export const NOT_ARMED_PROSE: readonly string[] = [
  'Nothing is being predicted yet, so there is nothing to calibrate. That is deliberate and it is not permanent: a projection seeded with plausible-looking guesses is indistinguishable on screen from one backed by evidence, so the rule stays inert until the study can support one — and then arms itself.',
  'The fit uses the same two filters this page tells you to read by eye: a bucket must be not thin and must hold in both halves of the window. Each surviving bucket becomes one term whose points are its measured lift, clamped. It refuses to fit on ticker, and drops the |Δ GEX| and |% vs open| terms when the blended Score already covers them, so one edge is never counted three times. Hit Fit now to see exactly what it would arm and everything it rejected.',
  'Hand-pinning still works and still wins: drop server-v2/config/pick-proj-rule.json and the auto-fit stands down rather than overwrite it.',
]

/** Bold runs inside NOT_ARMED_PROSE, so step 3 emphasises the same three phrases. */
export const NOT_ARMED_PROSE_BOLD: readonly string[] = ['not thin', 'hold', 'Fit now']

/** The one <code> run in NOT_ARMED_PROSE — paragraph 3, in V2.cyan. */
export const NOT_ARMED_PROSE_CODE = 'server-v2/config/pick-proj-rule.json'

// ─────────────────────────────────────────────────────────────────────────────
// ERROR STRINGS.
// ─────────────────────────────────────────────────────────────────────────────

/** The study fetch's fallback when the body parses but `ok` is falsy. */
export const STUDY_LOAD_FAILED = 'load failed'
/** The fit's fallback for the same case. */
export const FIT_FAILED = 'fit failed'

/**
 * The ONE place the client acknowledges a server-side gate. Thrown by both POST
 * loaders on a 401 or 403. See the owner-gate note in the file header: the two
 * POSTs are the only routes this file proves anything about.
 */
export const OWNER_ONLY_ERROR = 'owner-only — sign in as the owner to change the rule'

/** The study error line's prefix. */
export const ERROR_PREFIX = 'Error: '
