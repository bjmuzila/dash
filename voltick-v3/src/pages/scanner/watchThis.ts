// ─────────────────────────────────────────────────────────────────────────────
// WATCH THIS — FAR CB. The scanner's `?tab=watch` tab, logic only.
//
// Transcribed 1:1 from v2's `components/pages/Scanner.tsx:906–2222`
// (`WatchRow` … `ResultsByDay`) against the checklist in
// docs/parity/scanner.md Part H, rows H1–H220. Every threshold, comparator
// branch, null rule, bucket rule, label and empty-state sentence below is the
// v2 value, copied out of the file rather than re-derived from the spec table.
//
// Seven pieces of business logic that are NOT obvious from the screen:
//
//   1. NULLS SINK IN BOTH DIRECTIONS. `sortOutcomes`' null branches return a
//      fixed ±1 and never multiply by the direction, so an unpriced or
//      untouched row is at the bottom in ASC and in DESC alike. That reads like
//      a mistake and is not: the column the rule was written for is `Touched`,
//      where floating every untouched row to the top of a DESC sort buries the
//      rows the user asked to see. See `sortOutcomes`.
//
//   2. THERE IS NO TIE-BREAK. Equal keys return 0 and fall through to
//      `Array.prototype.sort`'s stability — i.e. the order the endpoint sent,
//      which is `first_flagged DESC`. Adding a tie-break would change the
//      screen. (H.8a.)
//
//   3. THE THREE DAY-BUCKETS ARE NOT SYMMETRIC. `opened` and `touched` bucket
//      off their DATE fields with no status test; `expired` alone is gated on
//      `status === "expired"`. A flag that was touched and later expired
//      therefore never appears in an expired bucket, because its status is
//      "touched". See `groupOutcomesByDay`. (H98–H100.)
//
//   4. `ymd()` IS A STRING SLICE, NOT A DATE PARSE. First ten characters, then
//      a shape test. No `Date`, no timezone, so it cannot roll a day backwards
//      the way `new Date("2026-09-18").toISOString()` does west of Greenwich.
//      Every date the tab groups, sorts or compares goes through it. (H96.)
//
//   5. `probeStats` GRADES THE PEAK, NOT THE LAST MARK. `entry` is the first
//      PRICED close, `mark` is the maximum close, and the headline % runs
//      between them: a flag that ran +150% and gave it all back still handed
//      you the +150%. The live mark trails as a muted "now". (H139.)
//
//   6. THE SELECTION RULE LIVES ON THE SERVER. Nothing in the v2 tree selects
//      far-CB rows; the client renders whatever `/proxy/far-cb-watch` returns
//      and prints the rule in its footer. See `FAR_CB_SELECTION_RULE`. The one
//      client-side number in the whole rule is the fallback `15`. (H43–H45.)
//
//   7. THE FLAT TABLE AND THE DETAIL PANEL DISAGREE ABOUT "ENTRY". The table's
//      Entry column is `/far-cb-outcomes → opt_entry`; the panel's `in` figure
//      and the chart's FLAGGED line are the first priced close from
//      `/far-cb-outcome-detail`. Two endpoints, two numbers, same row. v2 shows
//      both and does not reconcile them; neither does this port. (Part H, open
//      question 6.)
//
// ── COLOUR: THE SPLIT, AND WHY THIS TAB SHOWS IT MOST ────────────────────────
// REVERSED (Brandon, 2026-09-03). Step 2 collapsed this tab's colours onto
// MOVE_UP / MOVE_DOWN / LIGHT_BLUE / T.muted. That decision is gone: the v3
// scanner renders v2's PALETTE, per surface, not v3's semantics — so the pairs
// v2 painted on two different surfaces stay two pairs.
//
// v2 painted "positive" on this tab with THREE values at once — `HOME_THEME.green`
// #8ECAE6 (a light blue) on the flat table's OPEN, `#30d158` on the detail
// panel's OPEN chip one row below it, and #8ECAE6 again on every table HEADER,
// where it means nothing directional at all. "Negative" was #EF4444 in the
// tables and #ff5b5b in the chart.
//
// Only the #8ECAE6 collision is broken apart — it is the one v2 did not intend.
// Everything else keeps the surface v2 painted it on:
//   TABLE side, signed / state figures  → V2.up  #1FD98A / V2.red #EF4444
//   PROBE CHART side (and its chips)    → ES_CANDLE_UP #30d158 / ES_CANDLE_DOWN
//                                         #ff5b5b — v2's PROBE_GRN / PROBE_RED
//   the light-blue accent (13 elements) → V2.accent #7dd3fc, v2's own LIGHT_BLUE
//                                         (NOT the v3 `LIGHT_BLUE` export, which
//                                         is --color-series-5 #4fb8d4)
//   chrome (headers, labels that are not a state) → V2.green #8ECAE6, the value
//                                         v2 painted them
//   CATEGORY chips (the C badge = PROBE_ICE #8ECAE6) → V2.green, because a
//                                         call-vs-put badge is not a sign
// Each site is commented below.
//
// ── THE DELIBERATE DEPARTURES FROM v2 ────────────────────────────────────────
// Colour is the only one in THIS file; the data layer's are in watchThisData.ts
// and the chart's in watchThisChart.ts.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
//
// * `components/scanner/ProbeButton.tsx`, in its entirety (H207). Dead: a
//   repo-wide grep for `ProbeButton` finds only the file's own definition, no
//   import site anywhere in the tree. It also exports a SECOND `useIsOwner()`
//   that duplicates `components/shared/useIsOwner` with DIFFERENT logic
//   (`isOwnerClaim || userId === NEXT_PUBLIC_OWNER_USER_ID`, where the shared
//   one gates differently). Both halves stay out. If an owner "+ Probe" action
//   is wanted on a Watch card, write it fresh against the v3 owner gate — do
//   not resurrect a second owner test.
//
// * `captureFlagCard` and its "⧉ Copy image" button (H146–H147, H181–H194).
//   The whole design of that function depends on the SVG carrying RESOLVED
//   colour literals, because a `var()` reference is empty once the element is
//   serialised off-DOM — which is precisely why the `PROBE_*` palette existed
//   and precisely what v3 forbids. It also reaches the SVG by
//   `document.getElementById(chartId)` (H218). Not ported at all: no capture,
//   no button, no offscreen canvas, no clipboard path.
//
// * `OutcomeRow.opt_price` (H208). Declared and commented as "the live mid,
//   still carried for the popup", read by nothing — not the table, not the
//   panel, not the chart. The panel's "now" is `probeStats().last`, from the
//   detail endpoint's day series.
//
// * `OutcomeRow.touched` and `OutcomeDetail.touched`, the booleans (H211). The
//   UI keys every branch off `status` and off the DATE fields. Neither boolean
//   is read anywhere.
//
// * `PageShell` / `Card variant="budget"` from `components/shared/PageCard.tsx`
//   (H212), and the `th` / `td` / `seg()` style objects (Part A). v2 chrome.
//
// Spec: docs/parity/scanner.md Part H, rows H1–H220.
// ─────────────────────────────────────────────────────────────────────────────

import { ES_CANDLE_DOWN, ES_CANDLE_UP, T, V2, alpha } from '@/design/theme'
import { EM_DASH, fmtB } from '@/pages/scanner/format'

// ═════════════════════════════════════════════════════════════════════════════
// WIRE SHAPES
// ═════════════════════════════════════════════════════════════════════════════

/** One flagged far-CB level. `/proxy/far-cb-watch → rows[]`. (H27–H41.) */
export interface WatchRow {
  symbol: string
  strike: number
  expiry: string
  /** OI+Vol canonical net GEX. SIGNED — negative rows exist, see H45. */
  gex_value: number
  gex_value_vol?: number | null
  spot: number
  otm_pct: number
  dte_days: number
  /**
   * @neverReadInV2 Declared on the type, rendered by nothing on this tab
   * (H209). Kept on the interface because the endpoint sends it and dropping a
   * field from a wire shape hides what the wire actually carries; step 3 must
   * not start showing it without a decision.
   */
  date: string
}

export type OutcomeSide = 'above' | 'below'
export type OutcomeStatus = 'open' | 'touched' | 'expired'

/**
 * One tracked flag. `/proxy/far-cb-outcomes → rows[]`.
 *
 * The `opt_*` block measures THE FLAGGED CONTRACT ITSELF, FROM THE FLAG: what
 * it cost the day it was flagged and the best it has printed since. Not the
 * live mid, and not its move off this morning's open — the flag is a thesis
 * with a date on it, so the only honest scoreboard runs from that date.
 */
export interface OutcomeRow {
  symbol: string
  strike: number
  expiry: string
  first_flagged: string
  spot_at_flag: number
  otm_pct_at_flag: number
  side: OutcomeSide
  last_checked: string | null
  last_spot: number | null
  closest_pct: number | null
  touched_date: string | null
  status: OutcomeStatus
  opt_type?: 'C' | 'P' | null
  opt_entry?: number | null
  opt_entry_date?: string | null
  opt_high?: number | null
  opt_pct_high?: number | null
}

/** One session of the flagged contract. `/proxy/far-cb-outcome-detail → days[]`. */
export interface OutcomeDetailDay {
  date: string
  spot: number
  spotPctChg: number | null
  /** `null` on a no-trade day — the line BREAKS there, it is not interpolated. */
  contractClose: number | null
  contractDollarChg: number | null
  contractPctChg: number | null
}

/** `/proxy/far-cb-outcome-detail`, whole body. */
export interface OutcomeDetail {
  ok: boolean
  error?: string
  symbol: string
  strike: number
  expiry: string
  type: 'C' | 'P'
  firstFlagged: string
  spotAtFlag: number
  otmPctAtFlag: number
  status: OutcomeStatus
  touchedDate: string | null
  days: OutcomeDetailDay[]
}

/**
 * Tracked-results view selector. The first four are SERVER-side status filters
 * on the flat table; `results` is a CLIENT-side roll-up of every tracked flag
 * grouped by calendar date. (H48.)
 */
export type OutcomeView = 'all' | 'open' | 'touched' | 'expired' | 'results'

/** In render order, and these are the labels' source. (H48.) */
export const OUTCOME_VIEWS: readonly OutcomeView[] = [
  'all',
  'open',
  'touched',
  'expired',
  'results',
] as const

/** v2 builds the pill label by upper-casing the first letter of the id. (H48.) */
export const outcomeViewLabel = (v: OutcomeView): string =>
  v.charAt(0).toUpperCase() + v.slice(1)

/** The view the tab lands on. Not persisted anywhere — no storage, no URL. (H48, H206.) */
export const DEFAULT_OUTCOME_VIEW: OutcomeView = 'all'

// ═════════════════════════════════════════════════════════════════════════════
// DATES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Dates arrive as `YYYY-MM-DD`, but `expiry` can carry a time — normalise to
 * the day.
 *
 * A PLAIN FIRST-TEN-CHARACTER SLICE plus a shape test. No `Date`, no parsing,
 * no timezone conversion: that is what makes it safe to use as a Map key and to
 * compare with `<` / `===`. Anything that does not match after slicing is
 * `null`, including `null`, `undefined` and `""`. (H96.)
 */
export function ymd(v: string | null | undefined): string | null {
  if (!v) return null
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/** Stable identity for one tracked contract. (H92.) */
export const outcomeKey = (o: OutcomeRow): string => `${o.symbol}|${o.expiry}|${o.strike}`

/**
 * Row keys are UI-scoped, not contract-scoped, and the prefix is why: the
 * Results view can list the SAME contract under both Opened and Touched on one
 * date, and keying by contract alone would expand both at once. (H92, H129.)
 */
export const flatRowKey = (o: OutcomeRow): string => `flat|${outcomeKey(o)}`
export const dayRowKey = (date: string, section: ResultSectionKey, o: OutcomeRow): string =>
  `day|${date}|${section}|${outcomeKey(o)}`

// ═════════════════════════════════════════════════════════════════════════════
// SORTING (H.8)
// ═════════════════════════════════════════════════════════════════════════════

/** One per column of the flat table. Twelve members. (H.8.) */
export type OutcomeSortKey =
  | 'symbol'
  | 'strike'
  | 'expiry'
  | 'first_flagged'
  | 'opt_entry'
  | 'opt_high'
  | 'opt_pct_high'
  | 'spot_at_flag'
  | 'otm_pct_at_flag'
  | 'closest_pct'
  | 'touched_date'
  | 'status'

export type SortDir = 'asc' | 'desc'
export interface OutcomeSort {
  key: OutcomeSortKey
  dir: SortDir
}

/** open → touched → expired, so a status sort reads as a lifecycle, not A–Z. (H64.) */
export const STATUS_RANK: Record<OutcomeStatus, number> = { open: 0, touched: 1, expired: 2 }

/** An unrecognised status ranks last in ASC. It is 99, not null, so it does NOT sink in DESC. (H64.) */
export const UNKNOWN_STATUS_RANK = 99

/**
 * The twelve comparators, key by key. Copied verbatim, including the two
 * asymmetries that look like oversights:
 *
 *   * `expiry` falls back to the RAW string when `ymd()` rejects it, so a
 *     malformed expiry still sorts lexically. `first_flagged` has NO such
 *     fallback and sinks instead. (H55 vs H56.)
 *   * `strike`, `spot_at_flag` and `otm_pct_at_flag` go through `Number(...)`,
 *     which yields NaN for a non-numeric value — and NaN is not caught by the
 *     null test below, so it produces an inconsistent comparator. See the BUG
 *     note on `sortOutcomes`. (H54, H60, H61, H219.)
 */
export const OUTCOME_SORT_VALUE: Record<
  OutcomeSortKey,
  (r: OutcomeRow) => string | number | null
> = {
  symbol: (r) => r.symbol,
  strike: (r) => Number(r.strike),
  expiry: (r) => ymd(r.expiry) ?? r.expiry ?? null,
  first_flagged: (r) => ymd(r.first_flagged) ?? null,
  opt_entry: (r) => r.opt_entry ?? null,
  opt_high: (r) => r.opt_high ?? null,
  opt_pct_high: (r) => r.opt_pct_high ?? null,
  spot_at_flag: (r) => Number(r.spot_at_flag),
  otm_pct_at_flag: (r) => Number(r.otm_pct_at_flag),
  closest_pct: (r) => r.closest_pct ?? null,
  touched_date: (r) => ymd(r.touched_date),
  status: (r) => STATUS_RANK[r.status] ?? UNKNOWN_STATUS_RANK,
}

/**
 * Sort the already-fetched page. Client-side only: the endpoint orders by
 * `first_flagged DESC` and applies its limit server-side, so sorting by
 * `opt_high` DESC shows the best of the fetched hundred, not the best overall
 * (H76).
 *
 * Two things here are deliberate and must not be "cleaned up":
 *
 *   NULLS SINK IN BOTH DIRECTIONS. A value is null for sorting purposes when
 *   `v == null || v === ""` — so `null`, `undefined` AND the empty string
 *   count, but `0` does not. The `aNull → 1` / `bNull → -1` branches return a
 *   FIXED sign and never multiply by `mul`, which is what pins nulls to the
 *   bottom in ASC and DESC alike. An untouched row has no touched date, and
 *   floating those to the top of a descending sort would bury the rows the
 *   sort was asked for.
 *
 *   NO TIE-BREAK. Equal keys return 0 and fall through to sort stability, i.e.
 *   the server's own `first_flagged DESC`.
 *
 * BUG (v2): `Number(x)` on a non-numeric `strike` / `spot_at_flag` /
 * `otm_pct_at_flag` yields NaN, which the null test does not catch, so
 * `NaN - x` is NaN and the comparator becomes inconsistent (H219). Left as
 * written — step 2 records v2 bugs, step 3 decides. The fix, when it is taken,
 * is to treat `!Number.isFinite(v)` as null so NaN sinks with the rest.
 *
 * Spec: docs/parity/scanner.md Part H, rows H53–H64, H76.
 */
export function sortOutcomes(rows: OutcomeRow[], sort: OutcomeSort): OutcomeRow[] {
  const pick = OUTCOME_SORT_VALUE[sort.key]
  const mul = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = pick(a)
    const bv = pick(b)
    const aNull = av == null || av === ''
    const bNull = bv == null || bv === ''
    if (aNull && bNull) return 0
    if (aNull) return 1
    if (bNull) return -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul
    return String(av).localeCompare(String(bv)) * mul
  })
}

/**
 * The sort a view lands on before the user clicks anything, re-applied on every
 * view switch (so a manual sort is discarded when the view changes, H50).
 *
 * `results` takes the same else-branch as `all` and `open`, and that value is
 * INERT: the Results view renders day buckets, which never read `sort`
 * (H69, H210). Kept because the effect that writes it is keyed on the view and
 * a missing branch would be a silently different state, not a simpler one.
 */
export const defaultOutcomeSort = (view: OutcomeView): OutcomeSort =>
  view === 'touched'
    ? { key: 'touched_date', dir: 'desc' } // newest touch first
    : view === 'expired'
      ? { key: 'expiry', dir: 'desc' }
      : { key: 'first_flagged', dir: 'desc' } // matches the server's own order

/**
 * Header click. Same column toggles direction; a NEW column opens descending —
 * except `symbol`, which opens A–Z.
 *
 * The test is literally `key === "symbol"`, not a type test, so `expiry`,
 * `first_flagged`, `touched_date` and `status` all open descending too. (H70, H71.)
 */
export const nextOutcomeSort = (cur: OutcomeSort, key: OutcomeSortKey): OutcomeSort =>
  cur.key === key
    ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'symbol' ? 'asc' : 'desc' }

/**
 * The header's sort glyph. Note the inactive one is the SMALL down triangle
 * (U+25BE) and the active-descending one is the LARGE one (U+25BC) — two
 * different characters, deliberately. (H74.)
 */
export const SORT_GLYPH = {
  inactive: '▾',
  asc: '▲',
  desc: '▼',
} as const

export const sortGlyph = (active: boolean, dir: SortDir): string =>
  active ? (dir === 'asc' ? SORT_GLYPH.asc : SORT_GLYPH.desc) : SORT_GLYPH.inactive

/** `"Sort by Max %"`, `"Sort by OTM at flag"`. On all twelve headers. (H75.) */
export const sortTitle = (label: string): string => `Sort by ${label}`

// ═════════════════════════════════════════════════════════════════════════════
// DAY GROUPING (H.10a)
// ═════════════════════════════════════════════════════════════════════════════

export interface DayBucket {
  date: string
  opened: OutcomeRow[]
  touched: OutcomeRow[]
  expired: OutcomeRow[]
}

/**
 * One flag can land in up to THREE different days: the day it was flagged
 * (opened), the day spot reached the strike (touched), and the day it expired
 * untouched. Newest day first.
 *
 * ── THE ASYMMETRY, COPIED ON PURPOSE ─────────────────────────────────────────
 * `opened` and `touched` bucket UNCONDITIONALLY off their date fields — they
 * ask "is there a date?", never "what is the status?". `expired` alone is gated
 * on `status === "expired"`.
 *
 * The consequence is not cosmetic: a flag that was touched and later expired
 * carries `status === "touched"`, so it appears in a `touched` bucket on its
 * touch date and in NO `expired` bucket, ever — even though its expiry has
 * passed. The Expired column therefore counts "expired without ever being
 * touched", which is exactly what its note string says (H119), and the three
 * per-day counts do not sum to the number of distinct flags.
 *
 * Buckets are ordered by RAW STRING descending. Correct only because the keys
 * are ISO `YYYY-MM-DD` — which `ymd()` guarantees, and which is the reason the
 * key is a slice and not a Date.
 *
 * Spec: docs/parity/scanner.md Part H, rows H96–H103.
 */
export function groupOutcomesByDay(rows: OutcomeRow[]): DayBucket[] {
  const map = new Map<string, DayBucket>()
  const bucket = (d: string): DayBucket => {
    const existing = map.get(d)
    if (existing) return existing
    const fresh: DayBucket = { date: d, opened: [], touched: [], expired: [] }
    map.set(d, fresh)
    return fresh
  }
  for (const r of rows) {
    const flagged = ymd(r.first_flagged)
    if (flagged) bucket(flagged).opened.push(r)
    const touched = ymd(r.touched_date)
    if (touched) bucket(touched).touched.push(r)
    // ── The one status-gated bucket. See the note above.
    if (r.status === 'expired') {
      const exp = ymd(r.expiry)
      if (exp) bucket(exp).expired.push(r)
    }
  }
  // Newest day first. No secondary sort: equal dates are impossible, the Map is
  // keyed by date. Rows INSIDE a bucket are not sorted at all — they keep the
  // endpoint's `first_flagged DESC` order, and `sort` does not apply here (H103).
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

// ═════════════════════════════════════════════════════════════════════════════
// PROBE HELPERS (H.11)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Owner-card tone: up above water, down below, plain text flat/unknown.
 *
 * NOTE THE BOUNDARY MISMATCH, which is v2's and is kept: the COLOUR test is
 * `> 0` while the GLYPH test on the same number is `>= 0` (see
 * `fmtProbePct`), so an exact `0` renders "▲ 0.0%" in plain text — an up arrow
 * with no up colour. (H138.)
 *
 * COLOUR: v2's PROBE_GRN #30d158 / PROBE_RED #ff5b5b are a SECOND up/down pair,
 * live on screen at the same time as the tables' #8ECAE6/#EF4444 — open a row
 * and the table's OPEN is one green while the panel's OPEN chip is the other.
 * BOTH PAIRS SHIP. This is the probe chart's own pair (`ES_CANDLE_UP` /
 * `ES_CANDLE_DOWN`); the table side takes `V2.up` / `V2.red`. Do not unify them.
 */
export const probeTone = (v: number | null): string =>
  v == null ? T.text : v > 0 ? ES_CANDLE_UP : v < 0 ? ES_CANDLE_DOWN : T.text

/** Bare two-decimal number, or an em dash. No `$` — the `$` is in the PNG only. (H140.) */
export const probePx = (v: number | null): string => (v == null ? EM_DASH : v.toFixed(2))

export interface ProbeStats {
  /** The first PRICED close — what taking the flag would have cost. */
  entry: number
  /** The PEAK close, not the live mark. This is what the headline % grades. */
  mark: number
  /** The last priced close. Shown muted as "now". */
  last: number
  /** `null` when `entry <= 0` — division guard, not a formatting choice. */
  pct: number | null
  /** Per SINGLE contract (×100). */
  dollars: number
}

/**
 * Header numbers for one tracked flag.
 *
 * The contract's first traded mark is the basis and the BEST mark it has
 * printed since is the second leg — the flag is graded on the peak it offered,
 * not on whatever it happens to be worth right now, because a flag that ran
 * +150% and gave it all back still handed you the +150%.
 *
 * `mark` keeps that name (rather than `high`) so the panel and everything that
 * reads these stats see one shape; `last` carries the live mark for reference.
 *
 * Spec: docs/parity/scanner.md Part H, row H139.
 */
export function probeStats(days: OutcomeDetailDay[]): ProbeStats | null {
  const vals = days
    .map((d) => d.contractClose)
    .filter((v): v is number => v != null && Number.isFinite(v))
  const entry = vals[0]
  const last = vals[vals.length - 1]
  // `entry`/`last` bind rather than index twice: under noUncheckedIndexedAccess
  // an index read is `number | undefined` however sure a length check made us,
  // and the binding is what narrows it. v2's guard was `if (!vals.length)`.
  if (entry === undefined || last === undefined) return null
  const mark = Math.max(...vals)
  return {
    entry,
    mark,
    last,
    pct: entry > 0 ? ((mark - entry) / entry) * 100 : null,
    dollars: (mark - entry) * 100,
  }
}

/**
 * Expiry in the owner card's format: "Sep 18, 26".
 *
 * Parsed at UTC NOON so a local timezone west of Greenwich cannot roll the
 * label back a day. Locale is the browser's (`[]`). Unparseable input falls
 * back to the raw string. (H137.)
 */
export const probeExp = (v: string): string => {
  const t = Date.parse(`${String(v).slice(0, 10)}T12:00:00Z`)
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' })
    : v
}

/**
 * The strike/type badge: a fractional strike keeps its decimals ("5902.5C"), a
 * whole one is rounded to an integer ("5900C"). (H133.)
 */
export const probeBadge = (strike: number, type: 'C' | 'P'): string =>
  `${strike % 1 ? strike : Math.round(strike)}${type}`

/**
 * The chart's identity string.
 *
 * v2 used this value THREE ways: as the `<svg id>`, as the seed for the wash
 * gradient's id (`${chartId}-wash`), and as a `document.getElementById` handle
 * for the PNG capture. The first two survive here — an SVG that owns a
 * `<linearGradient>` needs a document-unique id for `url(#…)` to resolve, and
 * two panels are never open at once but the gradient id must still not collide
 * with the SVG's own.
 *
 * The third use is gone with the capture (see the REMOVED block). It is also
 * why every non-`[A-Za-z0-9-]` character is stripped — specifically the `.` a
 * fractional strike carries, which was illegal in the old `getElementById`
 * selector path. The stripping is kept anyway: an id is still an id, and
 * changing the shape would change nothing but break the one thing that made it
 * safe. (H148, H181, H218.)
 */
export const probeChartId = (detail: OutcomeDetail | null): string => {
  const seed = detail
    ? `${detail.symbol}-${probeBadge(detail.strike, detail.type)}-${ymd(detail.expiry) ?? detail.expiry}`
    : 'x'
  return `flag-chart-${seed.replace(/[^A-Za-z0-9-]/g, '')}`
}

/** The gradient id derived from it. (H162.) */
export const probeWashId = (chartId: string): string => `${chartId}-wash`

// ═════════════════════════════════════════════════════════════════════════════
// THE FAR-CB SELECTION RULE (H43–H45)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * THE ONLY CLIENT-SIDE THRESHOLD LITERAL ON THIS TAB.
 *
 * The live number is `/proxy/far-cb-watch → threshold`; the client neither
 * computes nor validates it, and applies this fallback only when the field is
 * absent. (H44.)
 */
export const FAR_CB_FALLBACK_THRESHOLD_PCT = 15

/**
 * The selection rule, as the CLIENT states it — which is all that can be
 * transcribed, because no server code for `/proxy/far-cb-watch` exists in the
 * v2 tree. The client renders whatever rows the endpoint returns; neither the
 * 30-DTE bound nor the OTM threshold is enforced here.
 *
 *   single highest |GEX| strike per ticker,
 *   over expiries ≤ 30 DTE,
 *   on the OI+Vol canonical net-GEX basis,
 *   flagged when that strike is MORE THAN `threshold`% away from spot
 *     (strictly `>`, never `>=` — the footer says "is >N% away"),
 *   universe = the scanner watchlist plus anything POSTed to /api/far-cb-tickers,
 *   at most 50 rows.
 *
 * ── CODE-VS-COMMENT CONFLICT, CODE WINS ──────────────────────────────────────
 * v2's block comment at Scanner.tsx:906–907 says "highest GEX strike"; the
 * rendered footer at :1909 says "highest |GEX| strike" — absolute value. The
 * rendered string is what the user reads, and it is corroborated by the code:
 * `up = r.gex_value >= 0` only earns its keep if rows can carry NEGATIVE
 * `gex_value`, which is a thing only an absolute-value ranking produces. So
 * |GEX| is the behaviour; the comment is stale. (H45.)
 *
 * ── AND THE TWO STRINGS DISAGREE ON SCREEN ───────────────────────────────────
 * When the endpoint omits `threshold`, the footer prints ">15%" from the
 * fallback while the subtitle DROPS its threshold clause entirely (`threshold
 * != null ? … : ""`). Same missing field, two different answers, both visible
 * at once. Transcribed as written — see `watchSubtitle` and `FOOTER_FLAGGED`.
 * (H9, H44.)
 */
export const FAR_CB_SELECTION_RULE = {
  basis: 'OI+Vol canonical net GEX',
  rank: '|GEX|', // absolute value — see the conflict note above
  maxDte: 30,
  comparison: '>' as const,
  fallbackThresholdPct: FAR_CB_FALLBACK_THRESHOLD_PCT,
  maxRows: 50,
} as const

// ═════════════════════════════════════════════════════════════════════════════
// STRINGS — CARD, TOOLBAR, ADD ROW (H.1–H.3)
// ═════════════════════════════════════════════════════════════════════════════

/** Rendered uppercase by the card chrome; the em dash is in the source string. (H8.) */
export const CARD_TITLE = 'Watch This — Far CB'

/**
 * `threshold` prints RAW — no rounding, no toFixed. The `· >N% OTM` clause is
 * omitted entirely when the endpoint returns no threshold; `· refreshing…` is
 * appended on every load, and `loading` starts true, so the first paint always
 * carries it. (H9.)
 */
export const watchSubtitle = (threshold: number | null, loading: boolean): string =>
  `Highest GEX strike within 30d expirations, far OTM vs spot · scanner universe` +
  `${threshold != null ? ` · >${threshold}% OTM` : ''}` +
  `${loading ? ' · refreshing…' : ''}`

export const REFRESH_LABEL = '↻ Refresh'

/**
 * The "2m" matches the code (`WATCH_POLL_MS`). The "30m during RTH" is a claim
 * about the server-side recorder that nothing on the client can verify. (H12.)
 */
export const REFRESH_NOTE = 'Refreshes every 2m · recorder sweeps every 30m during RTH'

export const ADD_PLACEHOLDER = 'Add a ticker (e.g. RDDT)'
/** Characters, not pixels — the input's `maxLength`. (H14.) */
export const ADD_MAX_LENGTH = 6
export const ADD_LABEL = '+ Add'
export const ADD_BUSY_LABEL = 'Adding…'
export const ADD_FAILED_FALLBACK = 'Add failed'

/** Never auto-dismisses — it persists until the next add attempt. (H18.) */
export const addSuccessMessage = (symbol: string): string =>
  `${symbol} added — appears after the next sweep.`

/**
 * v2 normalises only at submit time: the input holds raw keystrokes, and the
 * POST sends `trim().toUpperCase()`. An empty trimmed value bails silently
 * WITHOUT clearing the previous status message. (H14, H17.)
 */
export const normaliseTickerInput = (raw: string): string => raw.trim().toUpperCase()

/**
 * BUG (v2): the `+ Add` button is `disabled` while a POST is in flight, but the
 * input's Enter handler is not, so Enter can double-post (H15, H220). Both call
 * sites in step 3 must go through this. Recorded rather than silently fixed —
 * it is a guard v2 never had, and adding it is a behaviour change step 3 owns.
 */
export const canAddTicker = (raw: string, adding: boolean): boolean =>
  !adding && normaliseTickerInput(raw).length > 0

// ═════════════════════════════════════════════════════════════════════════════
// STRINGS — ERROR AND EMPTY STATES (H.4)
// ═════════════════════════════════════════════════════════════════════════════

export const LOAD_FAILED_FALLBACK = 'load failed'

/** Thrown when the response body will not parse as JSON. (H23.) */
export const nonJsonError = (status: number): string => `Server returned ${status} (non-JSON).`

export const RECORDER_NOT_RUN = "Recorder hasn't run yet — data appears after the first RTH sweep."

/**
 * SUBSTRING MATCH ON THE MESSAGE, not on `res.status` — which is why a 503 HTML
 * error page reaches this branch via the "503" that `nonJsonError` put in its
 * own string. (H22.)
 */
export const isRecorderNotRunError = (err: string): boolean =>
  err.includes('no DB') || err.includes('503')

/** The banner renders whenever `err` is truthy — including while loading. (H21, H22.) */
export const flagErrorText = (err: string): string =>
  isRecorderNotRunError(err) ? RECORDER_NOT_RUN : err

/** Requires all three: no rows, not loading, no error. (H25.) */
export const EMPTY_FLAG_GRID =
  'Nothing flagged right now — no watchlist ticker has an unusually far-OTM dominant CB level.'

/**
 * There is NO loading state for the flag grid — no spinner, no skeleton. The
 * only loading affordance is the `· refreshing…` suffix on the subtitle, and
 * old rows stay on screen through a refresh. (H26.)
 */
export const FLAG_GRID_HAS_NO_LOADING_STATE = true

// ═════════════════════════════════════════════════════════════════════════════
// FLAG CARDS (H.5–H.6)
// ═════════════════════════════════════════════════════════════════════════════

export const WATCH_THIS_BADGE = 'WATCH THIS'
export const LABEL_OI_VOL = 'OI+VOL ' // trailing space is in the string
export const LABEL_VOL = 'VOL ' // trailing space is in the string
export const VIEW_CHAIN_LABEL = 'View chain →'

/** React key for a flag card. (H28.) */
export const watchRowKey = (r: WatchRow): string => `${r.symbol}-${r.expiry}-${r.strike}`

/**
 * `gex_value >= 0` — INCLUSIVE, so an exact zero reads as call-side. Drives
 * four colours on the card and the "Call-side"/"Put-side" word. (H29, H35.)
 */
export const isCallSide = (r: WatchRow): boolean => r.gex_value >= 0

/**
 * COLOUR: v2 painted this `HOME_THEME.green` #8ECAE6 / `HOME_THEME.red` #EF4444.
 * #8ECAE6 is a LIGHT BLUE doing duty as "positive"; the DIRECTIONAL job takes
 * the split's positive leg `V2.up` #1FD98A while the CHROME job (table headers)
 * keeps #8ECAE6 as `V2.green`, so the two stop sharing a value. Table side, not
 * chart side — the probe chart has its own pair (`probeTone`).
 */
export const directionColor = (up: boolean): string => (up ? V2.up : V2.red)

/** Raw number, no toFixed: 5900 prints "$5900", 5902.5 prints "$5902.5". (H33, H78.) */
export const fmtStrike = (strike: number): string => `$${strike}`

/** Two decimals. Not null-guarded — a null spot would throw, as in v2. (H31.) */
export const fmtSpot = (spot: number): string => `$${spot.toFixed(2)}`

/** Server string passed through unformatted, plus an integer DTE. (H34.) */
export const fmtExpiryDte = (expiry: string, dteDays: number): string => ` · ${expiry} · ${dteDays}d`

/**
 * The card's body sentence. `otm_pct` at ZERO decimals, `spot` at two.
 * (H35.)
 */
export const flagCardSentence = (r: WatchRow): string =>
  `Highest GEX level for ${r.symbol} is the $${r.strike} strike (${r.expiry}), ` +
  `${r.otm_pct.toFixed(0)}% away from spot ($${r.spot.toFixed(2)}) — ` +
  `farther out than the usual near-the-money CB. ${isCallSide(r) ? 'Call-side' : 'Put-side'} dominant.`

/** Sign is always explicit; the field is required, so this is never an em dash. (H37.) */
export const fmtOiVolGex = (r: WatchRow): string => fmtB(r.gex_value)

/** Em dash when null/undefined. (H39.) */
export const fmtVolGex = (r: WatchRow): string =>
  r.gex_value_vol != null ? fmtB(r.gex_value_vol) : EM_DASH

/**
 * BUG (v2): the colour tests `(gex_value_vol ?? 0) >= 0` while the TEXT tests
 * `!= null`, so a NULL vol-GEX is painted as positive while displaying an em
 * dash (H39). Copied as written.
 */
export const volGexColor = (r: WatchRow): string => directionColor((r.gex_value_vol ?? 0) >= 0)

/**
 * `strike` is NOT encodeURIComponent'd in v2 — it is a plain number, so it is
 * safe in practice. Kept as-is rather than "fixed", because changing it changes
 * the URL for a fractional strike. (H40.)
 */
export const chainHref = (r: WatchRow): string =>
  `/options-chain?symbol=${encodeURIComponent(r.symbol)}&expiry=${encodeURIComponent(r.expiry)}&strike=${r.strike}`

/** The literal `≤` and `|GEX|` glyphs are in the string. (H43.) */
export const FOOTER_BASIS =
  'Basis: OI+Vol net GEX (canonical) · single highest |GEX| strike per ticker across expiries ≤30 DTE'

/** See FAR_CB_SELECTION_RULE for why this can disagree with the subtitle. (H44.) */
export const footerFlagged = (threshold: number | null): string =>
  `Flagged when that strike is >${threshold ?? FAR_CB_FALLBACK_THRESHOLD_PCT}% away from spot`

// ═════════════════════════════════════════════════════════════════════════════
// TRACKED RESULTS — HEADER AND HINTS (H.7)
// ═════════════════════════════════════════════════════════════════════════════

/** Sentence case, no uppercase transform. (H47.) */
export const TRACKED_RESULTS_TITLE = 'Tracked results'

export const HINT_RESULTS =
  'One row per date · how many flags opened, were touched, and expired that day · click a date to expand'

export const HINT_FLAT =
  "Graded daily ~16:10 ET · no win/loss — just whether spot reached the strike · Entry = the flagged contract's price the day it was flagged, High = the best it has printed since, Max % = the move between them · click any column to sort"

export const trackedHint = (view: OutcomeView): string =>
  view === 'results' ? HINT_RESULTS : HINT_FLAT

// ═════════════════════════════════════════════════════════════════════════════
// FLAT TRACKED-RESULTS TABLE — TWELVE COLUMNS IN RENDER ORDER (H.9)
// ═════════════════════════════════════════════════════════════════════════════

export type ColAlign = 'left' | 'right'

export interface OutcomeColumn {
  key: OutcomeSortKey
  /** Rendered UPPERCASE by the header row's text-transform. (H.9.) */
  label: string
  align: ColAlign
}

/**
 * Every header is clickable (`OutcomeTh`), and `align` defaults to right in v2 —
 * spelled out here so step 3 cannot guess. (H77–H89.)
 */
export const OUTCOME_COLUMNS: readonly OutcomeColumn[] = [
  { key: 'symbol', label: 'Symbol', align: 'left' },
  { key: 'strike', label: 'Strike', align: 'right' },
  { key: 'expiry', label: 'Expiry', align: 'left' },
  { key: 'first_flagged', label: 'Flagged', align: 'left' },
  { key: 'opt_entry', label: 'Entry', align: 'right' },
  { key: 'opt_high', label: 'High', align: 'right' },
  { key: 'opt_pct_high', label: 'Max %', align: 'right' },
  { key: 'spot_at_flag', label: 'Flagged Spot', align: 'right' },
  { key: 'otm_pct_at_flag', label: 'OTM at flag', align: 'right' },
  { key: 'closest_pct', label: 'Closest', align: 'right' },
  { key: 'touched_date', label: 'Touched', align: 'left' },
  { key: 'status', label: 'Status', align: 'left' },
] as const

/** The expanded detail row spans all of them. (H93.) */
export const OUTCOME_COLSPAN = OUTCOME_COLUMNS.length // 12

/**
 * `side === "above"` → up, anything else → down.
 *
 * COLOUR: v2's HOME_THEME.green #8ECAE6 / .red #EF4444 → V2.up / V2.red. (H78, H122.)
 */
export const sideColor = (side: OutcomeSide): string => directionColor(side === 'above')

/**
 * Entry is the ONLY cell that names the contract's C/P side — High deliberately
 * does not repeat it, because saying it twice on one row says nothing twice.
 * A null `opt_type` just drops the letter. (H81.)
 */
export const fmtEntry = (o: OutcomeRow): string =>
  o.opt_entry != null ? `$${o.opt_entry.toFixed(2)}${o.opt_type ? ` ${o.opt_type}` : ''}` : EM_DASH

/** `undefined` (no tooltip at all) when the date is missing. (H82.) */
export const entryTitle = (o: OutcomeRow): string | undefined =>
  o.opt_entry_date ? `First price recorded ${o.opt_entry_date}` : undefined

export const fmtHigh = (o: OutcomeRow): string =>
  o.opt_high != null ? `$${o.opt_high.toFixed(2)}` : EM_DASH

/** COLOUR: v2's LIGHT_BLUE #7dd3fc → `V2.accent`, v2's own value. (H83.) */
export const highColor = (o: OutcomeRow): string => (o.opt_high != null ? V2.accent : T.text)

/**
 * Glyph, space, ABSOLUTE value at one decimal, `%`. The glyph boundary is
 * `>= 0`, so an exact 0 shows "▲ 0.0%". (H84.)
 */
export const fmtMaxPct = (v: number | null | undefined): string =>
  v == null ? EM_DASH : `${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%`

/**
 * COLOUR: #8ECAE6/#EF4444 → V2.up/V2.red; the null case stays body text.
 * Boundary is `>= 0`, so an exact 0 is painted up. (H84.)
 */
export const maxPctColor = (v: number | null | undefined): string =>
  v == null ? T.text : v >= 0 ? V2.up : V2.red

/** Two decimals. (H85, H125.) */
export const fmtFlaggedSpot = (o: OutcomeRow): string => `$${o.spot_at_flag.toFixed(2)}`

/** ZERO decimals. (H86, H126.) */
export const fmtOtmAtFlag = (o: OutcomeRow): string => `${o.otm_pct_at_flag.toFixed(0)}%`

/** One decimal. (H87, H127.) */
export const fmtClosest = (o: OutcomeRow): string =>
  o.closest_pct != null ? `${o.closest_pct.toFixed(1)}%` : EM_DASH

/**
 * Boundary is STRICTLY `< 1`, so exactly 1.0% is not highlighted.
 *
 * COLOUR: v2's LIGHT_BLUE #7dd3fc → `V2.accent`. This is not a direction —
 * "closest" is small-is-notable in both signs — so it stays on the accent, not
 * on `V2.up`. (H87, H127.)
 */
export const closestColor = (o: OutcomeRow): string =>
  o.closest_pct != null && o.closest_pct < 1 ? V2.accent : T.text

/** THIS cell applies `ymd()`; the flat table's Expiry and Flagged cells do not. (H79, H80, H88.) */
export const fmtTouchedCell = (o: OutcomeRow): string => ymd(o.touched_date) ?? EM_DASH

/**
 * BUG (v2): the COLOUR tests the raw `touched_date` while the TEXT tests the
 * NORMALISED one, so a truthy-but-malformed date paints light blue while
 * displaying an em dash (H88). Copied as written.
 *
 * COLOUR: LIGHT_BLUE #7dd3fc → `V2.accent`, v2's own value.
 */
export const touchedColor = (o: OutcomeRow): string => (o.touched_date ? V2.accent : T.text)

/** "OPEN" / "TOUCHED" / "EXPIRED". (H89.) */
export const fmtStatusWord = (status: OutcomeStatus): string => status.toUpperCase()

/**
 * The status ladder, tested in this order: touched → accent, expired → body
 * text, anything else (i.e. open) → up.
 *
 * COLOUR — TWO GREENS, KEPT: v2 paints the flat table's OPEN
 * `HOME_THEME.green` #8ECAE6 while the detail panel's OPEN chip — one row
 * below it, on screen at the same time — is `PROBE_GRN` #30d158. Same word,
 * same state, two greens. Step 2 collapsed both onto MOVE_UP; that is reversed
 * (Brandon, 2026-09-03): the WORD here takes the split's positive leg `V2.up`
 * #1FD98A, and the CHIP keeps #30d158 — see `statusChipColor`, which is
 * therefore no longer the same function. Spec H records the pair as v2's own
 * inconsistency and it ships as v2 paints it. (H89, H128, H134.)
 */
export const statusColor = (status: OutcomeStatus): string =>
  status === 'touched' ? V2.accent : status === 'expired' ? T.text : V2.up

/** Guarded on `outcomes.length`, NOT on a loading flag — so a slow fetch shows this. (H94, H106.) */
export const EMPTY_TRACKED = 'No tracked flags yet.'

export const rowTitle = (isOpen: boolean): string =>
  isOpen ? 'Click to collapse' : 'Click for day-by-day detail'

// ═════════════════════════════════════════════════════════════════════════════
// RESULTS VIEW (H.10)
// ═════════════════════════════════════════════════════════════════════════════

export const RESULTS_LOADING = 'Loading results…'
/** Each of the three sections has its own independent "None". (H120.) */
export const SECTION_NONE = 'None'
export const DAY_ROW_TITLE = 'Click to expand this date' // does not change when already open (H112)
export const DAY_DISCLOSURE_OPEN = '▾' // U+25BE
export const DAY_DISCLOSURE_CLOSED = '▸' // U+25B8

export interface PlainColumn {
  label: string
  align: ColAlign
}

/**
 * The day table's five columns. The fifth is the disclosure column and has NO
 * label. (H107–H111.)
 */
export const DAY_COLUMNS: readonly PlainColumn[] = [
  { label: 'Date', align: 'left' },
  { label: 'Opened', align: 'right' },
  { label: 'Touched', align: 'right' },
  { label: 'Expired', align: 'right' },
  { label: '', align: 'right' },
] as const

export const DAY_COLSPAN = DAY_COLUMNS.length // 5

/** COLOUR: LIGHT_BLUE #7dd3fc → `V2.accent`, v2's own value. (H107.) */
export const dayDateColor = (isOpen: boolean): string => (isOpen ? V2.accent : T.text)

export type ResultSectionKey = 'opened' | 'touched' | 'expired'

export interface ResultSection {
  key: ResultSectionKey
  label: string
  /** The section header's ink AND its count digit's ink. */
  color: string
  note: string
}

/**
 * Rendered in array order.
 *
 * COLOUR: Opened was HOME_THEME.green #8ECAE6 → `V2.up` (it counts flags that
 * OPENED, which is this tab's positive); Touched was LIGHT_BLUE #7dd3fc →
 * `V2.accent`, v2's own value; Expired stays on the warning ink `V2.orange`.
 *
 * Note the Expired NOTE says "without ever being touched" — which is exactly
 * what `groupOutcomesByDay`'s status gate produces. The wording and the
 * asymmetry agree; see that function. (H114–H119.)
 */
export const RESULT_SECTIONS: readonly ResultSection[] = [
  {
    key: 'opened',
    label: 'Opened',
    color: V2.up,
    note: 'flagged for the first time on this date',
  },
  {
    key: 'touched',
    label: 'Touched',
    color: V2.accent,
    note: 'spot reached the flagged strike on this date',
  },
  {
    key: 'expired',
    label: 'Expired',
    color: V2.orange,
    note: 'expired on this date without ever being touched',
  },
] as const

/** `"OPENED · 4"`. The header renders even when the count is 0. (H114.) */
export const sectionHeading = (sec: ResultSection, n: number): string =>
  `${sec.label.toUpperCase()} · ${n}`

/**
 * A zero count is dimmed rather than hidden — it renders the literal 0, never an
 * em dash. v2 DIMS it with rgba(255,255,255,0.35); `T.muted` is opaque white in
 * v3 and would not dim it at all, so the opacity is carried explicitly.
 * (H108–H110.)
 */
export const countColor = (n: number, color: string): string => (n ? color : alpha(T.text, 0.35))

/**
 * The per-section sub-table's eight columns. NONE of these headers is
 * clickable — they are plain headers, not sort headers. (H121–H128.)
 */
export const SECTION_COLUMNS: readonly PlainColumn[] = [
  { label: 'Symbol', align: 'left' },
  { label: 'Strike', align: 'right' },
  { label: 'Expiry', align: 'left' },
  { label: 'Flagged', align: 'left' },
  { label: 'Flagged Spot', align: 'right' },
  { label: 'OTM at flag', align: 'right' },
  { label: 'Closest', align: 'right' },
  { label: 'Status', align: 'left' },
] as const

export const SECTION_COLSPAN = SECTION_COLUMNS.length // 8

/**
 * In the sub-table the touch DATE is glued onto the status label, unlike the
 * flat table which gives it its own sortable column. A touched row with a null
 * `touched_date` therefore renders "TOUCHED " with a trailing space. (H128.)
 */
export const fmtSectionStatus = (o: OutcomeRow): string =>
  o.status === 'touched' ? `TOUCHED ${o.touched_date ?? ''}` : o.status.toUpperCase()

// ═════════════════════════════════════════════════════════════════════════════
// DETAIL PANEL (H.11)
// ═════════════════════════════════════════════════════════════════════════════

/** Single U+2026, shown where the ticker goes while the detail is still loading. (H132.) */
export const DETAIL_TICKER_PLACEHOLDER = '…'
export const DETAIL_SUBLINE_LOADING = 'Loading…'
export const DETAIL_CLOSE_GLYPH = '×'
export const DETAIL_LOADING = 'Loading day-by-day detail…'
export const DETAIL_NO_BARS = 'No daily bars yet.'

/** Spot at two decimals, OTM at zero. (H136.) */
export const detailSubline = (d: OutcomeDetail): string =>
  `${probeExp(d.expiry)} · flagged ${d.firstFlagged} at spot $${d.spotAtFlag.toFixed(2)} (${d.otmPctAtFlag.toFixed(0)}% OTM)`

/**
 * The status chip's word: "touched" carries its date in MIXED case ("Touched
 * 2026-09-18"), everything else is upper-cased. Note this differs from the flat
 * table's cell, which upper-cases everything. (H134.)
 */
export const detailStatusLabel = (d: OutcomeDetail): string =>
  d.status === 'touched' ? `Touched ${d.touchedDate ?? ''}` : d.status.toUpperCase()

/**
 * The chip inks. NO LONGER the same function as `statusColor`: v2 paints this
 * chip's OPEN `PROBE_GRN` #30d158 while the flat table's OPEN one row above is
 * #8ECAE6, and the palette reversal (Brandon, 2026-09-03) keeps that pair
 * apart — the probe panel has its own up/down colours and this chip belongs to
 * it. Only the OPEN branch differs; touched and expired follow `statusColor`.
 * (H134.)
 */
export const statusChipColor = (status: OutcomeStatus): string =>
  status === 'open' ? ES_CANDLE_UP : statusColor(status)

/**
 * The C/P badge ink.
 *
 * COLOUR: v2's C chip is PROBE_ICE #8ECAE6 (a light blue) and its P chip is
 * HOME_THEME.orange #FB8501. The C chip is a CATEGORY — call vs put, never
 * chosen by the sign of a number — so it takes the CHROME value `V2.green`
 * #8ECAE6 that v2 painted it, exactly like `sideColor` on GEX Change Top. It is
 * NOT `V2.accent` and NOT `V2.up`. The P chip keeps the warning ink. (H133.)
 */
export const badgeColor = (type: 'C' | 'P'): string => (type === 'C' ? V2.green : V2.orange)

/** Renders "IN"/"HIGH"/"NOW" — the labels are lower-case in source, upper-cased by style. (H140–H144.) */
export const DETAIL_LABEL_IN = 'in'
export const DETAIL_LABEL_HIGH = 'high'
export const DETAIL_LABEL_NOW = 'now'
export const DETAIL_ARROW = '→'

/**
 * The big headline. Glyph boundary is `>= 0`; the COLOUR boundary in
 * `probeTone` is `> 0`. See probeTone. (H138.)
 */
export const fmtProbePct = (pct: number | null): string =>
  pct == null ? EM_DASH : `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`

/**
 * ` · +$420/ct`, per SINGLE contract, zero decimals. The minus is U+2212, not a
 * hyphen — it is a sign in running text here, not a table column. (H143.)
 */
export const fmtProbeDollars = (dollars: number): string =>
  ` · ${dollars >= 0 ? '+' : '−'}$${Math.abs(dollars).toFixed(0)}/ct`

/**
 * The chart's hint line. The `· touched <date>` clause appears only when
 * `touchedDate` is truthy. In v2 this string was used twice — under the chart
 * and baked into the PNG; the PNG is gone, so it has one consumer now. (H149.)
 */
export const probeHint = (detail: OutcomeDetail, stats: ProbeStats | null): string =>
  `Contract mark · daily bars · flagged @ ${probePx(stats?.entry ?? null)}` +
  `${detail.touchedDate ? ` · touched ${detail.touchedDate}` : ''}` +
  ` · today sampled every 15m`

/** The trailing em dash is a literal in the string — it names the no-trade gaps. (H153.) */
export const chartFooter = (hint: string): string => `${hint} · no-trade days show ${EM_DASH}`

/** Shown INSTEAD of the chart when fewer than two days carry a price. (H161.) */
export const CHART_NOT_ENOUGH_HISTORY =
  'Not enough history yet — the contract needs a second session on the tape.'

// ── Day-by-day table inside the panel, six columns (H.11a) ───────────────────

export const DETAIL_DAY_COLUMNS: readonly PlainColumn[] = [
  { label: 'Date', align: 'left' },
  { label: 'Spot', align: 'right' },
  { label: 'Spot Δ%', align: 'right' },
  { label: 'Contract', align: 'right' },
  { label: 'Contract Δ$', align: 'right' },
  { label: 'Contract Δ%', align: 'right' },
] as const

/** Raw `YYYY-MM-DD`, no reformatting. Rows keep the endpoint's order — no client sort. (H154.) */
export const fmtDetailDate = (d: OutcomeDetailDay): string => d.date

export const fmtDetailSpot = (d: OutcomeDetailDay): string => `$${d.spot.toFixed(2)}`

/** Two decimals, explicit `+` for non-negative, the number's own `-` for negative. (H156.) */
export const fmtSpotPctChg = (v: number | null): string =>
  v == null ? EM_DASH : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

export const fmtContractClose = (v: number | null): string =>
  v == null ? EM_DASH : `$${v.toFixed(2)}`

/** Sign BEFORE the `$`: "+$1.20", "-$0.35". (H158.) */
export const fmtContractDollarChg = (v: number | null): string =>
  v == null ? EM_DASH : `${v >= 0 ? '+' : ''}$${v.toFixed(2)}`

export const fmtContractPctChg = (v: number | null): string =>
  v == null ? EM_DASH : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

/**
 * The Δ columns' ink. Boundary `>= 0`, null → body text.
 *
 * COLOUR: #8ECAE6/#EF4444 → `V2.up`/`V2.red` — the TABLE side's pair. The probe
 * chart and its chips keep their own #30d158/#ff5b5b. (H156, H158, H159.)
 */
export const deltaColor = (v: number | null): string =>
  v == null ? T.text : v >= 0 ? V2.up : V2.red

// ═════════════════════════════════════════════════════════════════════════════
// CHROME INKS — the third job #8ECAE6 was doing (H.9 header rows)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Every table header row on this tab (flat, day, section, detail-day) is painted
 * `HOME_THEME.green` #8ECAE6 in v2 — the SAME value as "positive". A header is
 * not a direction, so the two jobs stop sharing a TOKEN: chrome KEEPS the value
 * as `V2.green` (it is where the value lives by site count) and the positive
 * moves to `V2.up` #1FD98A. This is the chrome leg of the three-way split.
 * (H.9, H.10d, H.11a; Part H "Green that is blue".)
 */
export const TABLE_HEADER_INK = V2.green

/**
 * The active sort header, and its arrow.
 *
 * COLOUR: LIGHT_BLUE #7dd3fc → `V2.accent`, v2's own value. An INACTIVE header
 * sets no colour at all in v2 and inherits the header row's ink, so it follows
 * TABLE_HEADER_INK here. (H72, H73.)
 */
export const sortHeaderInk = (active: boolean): string => (active ? V2.accent : TABLE_HEADER_INK)
