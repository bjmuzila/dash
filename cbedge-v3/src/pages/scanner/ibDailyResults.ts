// ─────────────────────────────────────────────────────────────────────────────
// THE EOD SCOREBOARD.
//
// Transcribed 1:1 from v2's `components/scanner/IbDailyResults.tsx` (270 lines),
// with the row shape and the rule-result type read out of `lib/ibDaily.ts` (the
// server-side grader that writes them), against the checklist in
// docs/parity/scanner.md Part G, rows G219–G235.
//
// One row per finished session, 23 columns wide, newest at the top. Rows are
// written at 16:30 ET by `server-v2/ib-results-recorder.js` and read back
// through `GET /api/ib-results?symbol=ES|NQ&limit=90`.
//
// SIX things here are not obvious from the screen:
//
//   1. THERE IS NO SORT. Rows render in `data.map` order, which is exactly the
//      order the API returned them (newest first). No column is clickable, there
//      is no arrow glyph, no default-sort indicator, and `useTableSort` — the
//      shared hook six other scanner tables use — is not imported by this file
//      or by any other file on this tab. If v3 adds sorting it is a NEW feature,
//      not parity, and the incoming order is itself meaningful.
//   2. THE RULE ENGINES USE DIFFERENT STATE VOCABULARIES. These rows carry
//      `state: "in" | "off"` (lib/ibDaily.ts:19). The LIVE engine uses
//      `"in-play" | "pending" | "not-in-play"` (buildRules). They are not
//      interchangeable and nothing translates between them.
//   3. THE CELL IS THREE-STATE, and the third state is not "no data": a rule can
//      be scored-and-wrong (✗), or not in play (—). The dash is also what an
//      absent rule id renders as, with an EMPTY tooltip, so "the recorder did
//      not grade this" and "the rule was not in play" look identical.
//   4. THE HIT-RATE FOOTER'S POPULATION IS PER COLUMN. It counts only rows where
//      that rule was `state === "in"` AND `hit != null`, so every column has a
//      different denominator — which is why the footnote says so out loud.
//   5. THE CARD TITLE IS HARDCODED TO `IB 60m (09:30–10:30 ET)`. The recorder
//      only ever writes the 60-minute window (`lib/ibDaily.ts:9`), so the title
//      is TRUE and the window selector above it is what lies: switching to
//      ORB 15m changes every other card and leaves this one reading 60m data
//      under a 60m title.
//   6. `err` IS ONE STATE, NOT KEYED BY SYMBOL, AND NEVER CLEARED. An ES failure
//      leaves the red banner up after switching to NQ, even when NQ loads fine.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • The THIRD copy of the rate-colour ladder. v2 types the same four branches at
//   `IbDailyResults.tsx:134` (the "bias correct" figure) and `:231` (the hit-rate
//   footer), identical to `IbStatsTab.tsx:102`. There is one `rateColor` now, in
//   `@/pages/scanner/ibStats`, and both surfaces import it.
// • The SECOND copy of `f1` / `clock`. Both live in ibStats.ts; `clockExact` is
//   this file's non-rounding variant, kept under its own name.
// • The lazy fetch-on-first-expand and its `rows[sym]` cache (`:88–96`). The
//   request is hoisted into `ibStatsData.ts` so the route can fire it in
//   parallel at entry; see the departure note there.
//
// Spec: docs/parity/scanner.md Part G, rows G219–G235.
// ─────────────────────────────────────────────────────────────────────────────

import { LIGHT_BLUE, MOVE_DOWN, MOVE_UP, T } from '@/design/theme'
import { EM_DASH } from '@/pages/scanner/format'
import { clockExact, f1, rateColor } from '@/pages/scanner/ibStats'

// ─────────────────────────────────────────────────────────────────────────────
// WIRE SHAPES.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One graded rule on a recorded session (`lib/ibDaily.ts:15–22`).
 *
 * `state` is `"in"` / `"off"` — NOT the live engine's three-way state. `hit` is
 * null whenever the rule was unscoreable, which the cell renders identically to
 * "off".
 */
export interface IbRuleResult {
  id: string
  name: string
  state: 'in' | 'off'
  side: 'H' | 'L' | null
  hit: boolean | null
  /** A short human read of the trigger, e.g. "close > mid → HIGH first". */
  note: string
}

/** One row of `/api/ib-results`. Numeric booleans are 0/1 columns from SQLite. */
export interface IbResultRow {
  date: string
  symbol: string
  ib_high: number | null
  ib_low: number | null
  ib_width: number | null
  width_bucket: string | null
  bias: string | null
  first_formed: string | null
  close_zone: string | null
  break_side: string | null
  break_min: number | null
  ext_10: number | null
  single_break: number | null
  both_broke: number | null
  neither_broke: number | null
  failed: number | null
  rules: IbRuleResult[] | null
  /**
   * NOT in v2's local `Row` type (`IbDailyResults.tsx:19–27`) — the scoreboard
   * never reads it — but the same endpoint returns it and the "LAST 5 SESSIONS"
   * tape maps it (`IbStatsTab.tsx:1012`). Declared here because v3 serves both
   * surfaces from ONE request; see the departure note in ibStatsData.ts.
   */
  first_touch_side?: 'H' | 'L' | null
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RULE COLUMNS.
// ─────────────────────────────────────────────────────────────────────────────

/** R1…R14, numeric order — the column order, left to right (`:29`). */
export const RULE_IDS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'] as const

/**
 * The `R#` header tooltips (`:30–36`). These are the EOD grader's rule names,
 * which are close to but not identical with `buildRules`' names — e.g. "IB Width
 * → Day Type" here vs "IB 60m Width → Day Type" there, "Extension ≥1× Width"
 * here vs "Extension Targets" there. Both sets are transcribed as written.
 */
export const RULE_NAMES: Record<string, string> = {
  '1': 'Midpoint Close Bias',
  '2': 'Formation Order + Midpoint',
  '3': 'Single Break Continuation',
  '4': 'IB Width → Day Type',
  '5': 'Breakout Entry + Volume',
  '6': 'Failed Breakout Fade',
  '7': '15m FVG inside IB',
  '8': 'Retest Continuation',
  '9': 'Extension ≥1× Width',
  '10': 'Close Location (strong)',
  '11': 'Open Type + IB Width',
  '12': 'Inner ORB + Alignment',
  '13': 'Time Filter',
  '14': 'Contained Day',
}

/**
 * The one-line claim under each rule in the "THE RULES" legend (`:39–54`).
 *
 * CODE-vs-PROSE CONFLICT, rule 12: this string says "inner 30m ORB". Every
 * implementation uses the 09:30–09:45 FIFTEEN-minute range —
 * `lib/ibDaily.ts:169` and `IbStatsTab.tsx:312` both filter `min < 585`. THE
 * CODE WINS; the legend string is wrong. It is transcribed verbatim rather than
 * silently corrected, because correcting published copy is a content decision
 * (docs/parity/scanner.md Part G, "Do not port" item 19, recommends fixing it).
 */
export const RULE_CLAIM: Record<string, string> = {
  '1': 'Close vs IB midpoint calls which IB extreme gets touched first.',
  '2': 'Which extreme formed first + midpoint bias agreeing = stronger first-touch call.',
  '3': 'A close-confirmed break of one side holds — the other side never trades.',
  '4': 'Wide IB (vs 14-day norm) → rotation/both sides; narrow/normal → single-side trend day.',
  '5': 'Break with a volume surge follows through ≥ 1× IB width.',
  '6': 'A break that fails back inside within 30m fades to the opposite extreme.',
  '7': 'An unfilled 15m FVG inside the IB points to the extreme touched first.',
  '8': 'Price retests the broken level and continues in the break direction.',
  '9': 'A close-confirmed break extends ≥ 1× IB width (0.5/1/1.5/2× shown on hover).',
  '10': 'Close in the top/bottom 25% of the IB, agreeing with formation order, calls first touch.',
  '11': 'Open type (vs prior RTH) + width bucket predicts a single-side day.',
  '12': 'The inner 30m ORB breaking in the same direction as midpoint bias confirms the bias.',
  '13': 'Breaks before 11:00 ET extend ≥ 1× more often than midday/late breaks.',
  '14': 'Still inside the IB at 14:00 ET → stays contained into the close.',
}

// ─────────────────────────────────────────────────────────────────────────────
// THE 23 COLUMNS, IN ORDER.
// Spec rows G226–G230. Columns 1–8 are the session; 9–22 are R1…R14; 23 is the
// bias post-mortem.
// ─────────────────────────────────────────────────────────────────────────────

export interface ColumnDef {
  key: string
  header: string
  /** Only column 1 is left-aligned; everything else is centred in v2. */
  align: 'left' | 'center'
  /** Header tooltip, where v2 sets one. */
  title?: string
}

export const COLUMNS: readonly ColumnDef[] = [
  { key: 'date', header: 'Date', align: 'left' },
  { key: 'width', header: 'Width', align: 'center' },
  { key: 'bucket', header: 'Bkt', align: 'center' },
  { key: 'bias', header: 'Bias', align: 'center' },
  { key: 'first', header: '1st', align: 'center' },
  { key: 'break', header: 'Break', align: 'center' },
  { key: 'time', header: 'Time', align: 'center' },
  { key: 'ext1', header: '1×', align: 'center' },
  ...RULE_IDS.map((id) => ({
    key: `R${id}`,
    header: `R${id}`,
    align: 'center' as const,
    title: RULE_NAMES[id],
  })),
  {
    key: 'shouldntBe',
    header: "Shouldn't Be",
    align: 'center',
    title:
      "The side the 10:30 bias called that did NOT hold — what price shouldn't have been.",
  },
]

/** Column 2 — 1 dp, em dash on null. */
export const widthCell = (r: IbResultRow): string => f1(r.ib_width)

/** Column 3 — the raw bucket word, uppercased by CSS in v2. */
export const bucketCell = (r: IbResultRow): string => r.width_bucket ?? EM_DASH

/** Column 4 — "H" / "L" / dash, coloured directionally. */
export function biasCell(r: IbResultRow): { text: string; color: string } {
  return {
    text: r.bias ?? EM_DASH,
    color: r.bias === 'H' ? MOVE_UP : r.bias === 'L' ? MOVE_DOWN : T.text,
  }
}

/** Column 5 — which extreme formed first. Plain, uncoloured. */
export const firstCell = (r: IbResultRow): string => r.first_formed ?? EM_DASH

/**
 * Column 6 — "Break" (`:187`, `:197–200`).
 *
 * Six possible words, checked in this order, each optionally suffixed "†":
 *   BOTH · NONE · H · L · 1-side · —
 *
 * The dagger means the break failed back inside within 30m, and it is the ONLY
 * case where this cell carries a tooltip — otherwise `title` is `undefined`.
 * BOTH takes the purple; H/L take the directional pair; everything else is body
 * text.
 */
export function breakCell(r: IbResultRow): { text: string; color: string; title?: string } {
  const dayType = r.both_broke
    ? 'BOTH'
    : r.neither_broke
      ? 'NONE'
      : (r.break_side ?? (r.single_break ? '1-side' : EM_DASH))
  return {
    text: `${dayType}${r.failed ? '†' : ''}`,
    color:
      dayType === 'H' ? MOVE_UP : dayType === 'L' ? MOVE_DOWN : dayType === 'BOTH' ? T.purple : T.text,
    title: r.failed ? BREAK_FAILED_TITLE : undefined,
  }
}

export const BREAK_FAILED_TITLE = 'break failed back inside ≤30m'

/** Column 7 — "HH:MM", zero padded, no rounding. */
export const timeCell = (r: IbResultRow): string => clockExact(r.break_min)

/**
 * Column 8 — "1×", the ≥1× extension flag.
 *
 * Note the colour rule: only a HIT is coloured. A ✗ is painted body-white, not
 * the down colour, which is the opposite of how the rule cells behave.
 */
export function extCell(r: IbResultRow): { text: string; color: string } {
  return {
    text: r.break_side ? (r.ext_10 ? '✓' : '✗') : EM_DASH,
    color: r.ext_10 ? MOVE_UP : T.text,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMNS 9–22 — THE THREE-STATE RULE CELL.
// Spec row G229 (`RuleCell`, `:69–81`).
// ─────────────────────────────────────────────────────────────────────────────

export type RuleCellState = 'hit' | 'miss' | 'idle'

export interface RuleCellRead {
  state: RuleCellState
  /** "✓" / "✗" / "—". */
  text: string
  color: string
  /** 0.4 on the idle cell, 1 otherwise — v2 dims rather than greys. */
  dim: boolean
  title: string
}

/**
 * The hit / miss / not-in-play rule, exactly as v2 branches it.
 *
 * IDLE branch — `!r || r.state === "off" || r.hit == null`:
 *     text "—", 40% opacity, and the tooltip
 *         `${RULE_NAMES[r.id]} — ${r.note}`
 *     …or the EMPTY STRING when there is no rule object at all. So an absent
 *     rule id and a rule that was not in play are visually identical and differ
 *     only in whether hovering says anything.
 *
 * SCORED branch — everything else:
 *     text "✓" or "✗", up/down colour, and the tooltip
 *         `${RULE_NAMES[r.id]} — ${r.note}${r.side ? ` · pointed ${HIGH|LOW}` : ""}`
 *     The side clause is appended only when the rule pointed somewhere; rules 4,
 *     11 and 14 carry `side: null` and never get it.
 */
export function ruleCell(r: IbRuleResult | undefined): RuleCellRead {
  if (!r || r.state === 'off' || r.hit == null) {
    return {
      state: 'idle',
      text: EM_DASH,
      color: T.text,
      dim: true,
      title: r ? `${RULE_NAMES[r.id] ?? r.name} — ${r.note}` : '',
    }
  }
  const side = r.side ? ` · pointed ${r.side === 'H' ? 'HIGH' : 'LOW'}` : ''
  return {
    state: r.hit ? 'hit' : 'miss',
    text: r.hit ? '✓' : '✗',
    color: r.hit ? MOVE_UP : MOVE_DOWN,
    dim: false,
    title: `${RULE_NAMES[r.id] ?? r.name} — ${r.note}${side}`,
  }
}

/** The idle cell's opacity (`:71`). Kept as data so step 3 does not invent one. */
export const RULE_CELL_IDLE_OPACITY = 0.4

/** Rules on a row, indexed. `Array.isArray` guards a null `rules` column. */
export function rulesById(r: IbResultRow): Map<string, IbRuleResult> {
  const rules: IbRuleResult[] = Array.isArray(r.rules) ? r.rules : []
  return new Map(rules.map((x) => [x.id, x]))
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN 23 — "Shouldn't Be".
// Spec row G230.
// ─────────────────────────────────────────────────────────────────────────────

export interface ShouldntBeRead {
  /** The bias side that did NOT hold, or null when the call held / is unresolved. */
  failed: 'H' | 'L' | null
  /** "¬H" / "¬L" (U+00AC), or an em dash. */
  text: string
  color: string
  dim: boolean
  title: string
}

/**
 * The bias post-mortem: the 10:30 bias called one side, price broke the other.
 *
 * NOTE the tooltip's asymmetry, transcribed as written: the CALLED side is
 * spelled out ("HIGH"/"LOW") and the ACTUAL side is printed raw ("H"/"L").
 */
export function shouldntBeCell(r: IbResultRow): ShouldntBeRead {
  const brokeSide = r.break_side === 'H' || r.break_side === 'L' ? r.break_side : null
  const failed = r.bias && brokeSide && r.bias !== brokeSide ? (r.bias as 'H' | 'L') : null
  return {
    failed,
    text: failed ? `¬${failed}` : EM_DASH,
    color: failed ? MOVE_DOWN : T.text,
    dim: !failed,
    title: failed
      ? `Bias called ${failed === 'H' ? 'HIGH' : 'LOW'} first — price didn't go there; broke ${brokeSide} instead.`
      : 'Bias call held — nothing to fade.',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO BIAS SUMMARY LINES.
// Spec rows G223, G224. Both are 0 dp, and the whole block is gated on
// `data.length > 0`.
// ─────────────────────────────────────────────────────────────────────────────

export interface BiasSummary {
  /** Rows whose recorded bias was H or L. */
  biasedCount: number
  bullPct: number | null
  bearPct: number | null
  /** Of the biased rows, those that also resolved to a break side. */
  resolvedCount: number
  actualBullPct: number | null
  actualBearPct: number | null
  /** How often the bias called the side that broke first. */
  hitPct: number | null
  /** The rate-colour ladder, applied to hitPct. */
  hitColor: string
}

export function biasSummary(data: readonly IbResultRow[]): BiasSummary {
  const biased = data.filter((r) => r.bias === 'H' || r.bias === 'L')
  const bull = biased.filter((r) => r.bias === 'H').length
  const bullPct = biased.length ? (100 * bull) / biased.length : null
  const resolved = biased.filter((r) => r.break_side === 'H' || r.break_side === 'L')
  const aBull = resolved.filter((r) => r.break_side === 'H').length
  const aBullPct = resolved.length ? (100 * aBull) / resolved.length : null
  const biasHit = resolved.filter((r) => r.break_side === r.bias).length
  const hitPct = resolved.length ? (100 * biasHit) / resolved.length : null
  return {
    biasedCount: biased.length,
    bullPct,
    bearPct: bullPct == null ? null : 100 - bullPct,
    resolvedCount: resolved.length,
    actualBullPct: aBullPct,
    actualBearPct: aBullPct == null ? null : 100 - aBullPct,
    hitPct,
    // v2 re-typed the rateColor ladder inline here; this is the shared one.
    hitColor: rateColor(hitPct),
  }
}

/** 0 dp, or an em dash — the format both summary lines use. */
export const pct0 = (p: number | null): string => (p == null ? EM_DASH : `${p.toFixed(0)}%`)

export const BIAS_SUMMARY_TEXT = {
  /** HARDCODED 10:30, like the card title. */
  line1Label: (n: number): string => `Bias @ 10:30 (last ${n}): `,
  bullish: (p: number | null): string => (p == null ? EM_DASH : `${p.toFixed(0)}% Bullish`),
  bearish: (p: number | null): string => (p == null ? EM_DASH : `${p.toFixed(0)}% Bearish`),
  separator: ' / ',
  line2Label: (n: number): string => `Actual — broke first (${n} resolved): `,
  biasCorrect: ' · bias correct ',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// THE HIT-RATE FOOTER ROW.
// Spec row G232. First cell spans the eight session columns; then one cell per
// rule; then one empty cell under "Shouldn't Be".
// ─────────────────────────────────────────────────────────────────────────────

export const HIT_RATE_COLSPAN = 8
export const HIT_RATE_LABEL = (n: number): string => `HIT RATE (in-play days only, last ${n})`
/** The label paints the tab accent, like every other section header here. */
export const HIT_RATE_LABEL_COLOR = LIGHT_BLUE

export interface HitRateCell {
  /** 0 dp, or an em dash when the column has no in-play days. */
  text: string
  color: string
  title: string
  /** The per-column denominator — different for every rule. */
  n: number
}

/**
 * One footer cell. The population is per rule and per column: only rows where
 * this rule was `state === "in"` and produced a non-null `hit`.
 */
export function hitRateCell(data: readonly IbResultRow[], id: string): HitRateCell {
  const g = data
    .map((r) => (Array.isArray(r.rules) ? r.rules.find((x) => x.id === id) : undefined))
    .filter((x): x is IbRuleResult => !!x && x.state === 'in' && x.hit != null)
  const p = g.length ? (100 * g.filter((x) => x.hit).length) / g.length : null
  return {
    text: pct0(p),
    color: rateColor(p),
    title: `${RULE_NAMES[id] ?? id} — ${g.length} in-play day(s)`,
    n: g.length,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHROME AND COPY.
// Spec rows G219, G222, G233–G235.
// ─────────────────────────────────────────────────────────────────────────────

export const DAILY_RESULTS_TEXT = {
  disclosureOpen: 'Hide daily results ▲',
  disclosureClosed: 'Daily Results — how the IB + every rule did, day by day ▼',
  /**
   * HARDCODED to the 60-minute window. Correct — the recorder only writes IB 60m
   * (`lib/ibDaily.ts:9`) — and therefore stale-looking the moment the selector
   * above it is on an ORB window.
   */
  title: (sym: string): string => `Daily Results — ${sym} · IB 60m (09:30–10:30 ET)`,
  subtitle:
    'Recorded automatically at 16:30 ET every trading day. ✓ rule hit · ✗ rule missed · — not in play. Hover a cell for the rule + trigger.',
  loading: 'Loading…',
  empty: 'No results recorded yet — the first row lands at 16:30 ET on the next trading day.',
  footnote:
    'Break column: H/L = close-confirmed break side, BOTH = rotation, NONE = contained, † = break failed back inside within 30m. 1× = the break ran ≥ 1× IB width. Hit rates are conditional on the rule being in play, so columns have different sample sizes.',
  legendHeading: 'THE RULES',
  legendHeadingColor: LIGHT_BLUE,
  /** The `R#` key in the legend takes the UI accent, not the tab accent. */
  legendKeyColor: T.cyan,
  legendSeparator: ' — ',
} as const

/**
 * The render ladder for the card body (`:156–162`), in this order:
 *
 *   err                        → the error banner, in the down colour
 *   !err && !data              → "Loading…"
 *   !err && data.length === 0  → the empty-state sentence
 *   otherwise                  → the summary block, the table, the footnote and
 *                                the legend, all four inside the same branch
 *
 * Collapsed (the disclosure closed) there is nothing but the button — and in v2
 * no request had fired either.
 */
export type DailyResultsView = 'error' | 'loading' | 'empty' | 'table'

export function dailyResultsView(
  err: string | null,
  data: readonly IbResultRow[] | undefined,
): DailyResultsView {
  if (err) return 'error'
  if (!data) return 'loading'
  return data.length === 0 ? 'empty' : 'table'
}

/** The error banner colour (`:156`). */
export const ERROR_COLOR = MOVE_DOWN

/**
 * THERE IS NO SORT ON THIS TABLE.
 *
 * Exported as a constant rather than left implicit because "no sort" is a
 * decision a rewrite silently reverses: rows are in API order, i.e. NEWEST
 * FIRST, and the footer row must stay pinned below them. If step 3 wants
 * sorting, it is new behaviour and needs its own decision.
 */
export const ROWS_ARE_UNSORTED_NEWEST_FIRST = true
