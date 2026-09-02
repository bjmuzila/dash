// ─────────────────────────────────────────────────────────────────────────────
// THE STRIKE QUERY TAB — types, derivation pipeline, column contract, strings.
//
// Transcribed 1:1 from v2's `components/pages/Scanner.tsx:599–879`
// (`SQ_FALLBACK`, `SqRow`, `SqCol`, `sqVal`, `StrikeQueryScanner`) against the
// checklist in docs/parity/scanner.md Part E, rows E1–E118. Nothing here was
// re-derived from the spec prose: the ladders, the filter ORDER, the comparator
// tie-breaks, the null coercion, the two index universes and every user-visible
// string are the v2 values, copied out of the file.
//
// Seven pieces of business logic that are NOT obvious from the screen:
//
//   1. ONLY THE TICKER REFETCHES. v2's `load` is `useCallback(…, [symbol,
//      watchlist.length])` (Scanner.tsx:679). Expiry, Limit, direction,
//      min-OTM, card scope and the sort column are PURE CLIENT RE-DERIVATIONS
//      of rows already in state. That is why every derivation in this file is
//      a pure function of `SqRow[]` and takes no URL, and why the only two
//      functions that touch the network live in `strikeQueryData.ts` and take
//      a symbol and nothing else. See `SQ_REFETCH_INPUTS` /
//      `SQ_CLIENT_ONLY_INPUTS` below — they are exported as data precisely so
//      a step-3 port cannot quietly put six controls in a query key and turn
//      one fetch into six.
//   2. `sqVal` COERCES NULL TO 0 (E28). A row with `chg15: null` sorts as a
//      genuine zero — middle of an `Math.abs()` ranking, not last. Every
//      comparator and both filters read through it, so the coercion is load
//      bearing on the row ORDER, not only on the text.
//   3. …and v2 then renders that same null TWO WAYS: the Top-10 card prints
//      `fmtB(0)` = "+0" in the POSITIVE colour (`0 >= 0`), while the table cell
//      prints an em dash in plain text (E84 vs E106–E108). Both decisions are
//      exported below (`sqCardMetricText`/`sqCardMetricColor` vs
//      `sqDeltaCellText`/`sqDeltaCellColor`) rather than reconciled, because
//      reconciling them is a product call for step 3, not a transcription.
//   4. `strike` sorts SIGNED; every other column sorts by `Math.abs()` (E34).
//      A Δ 15m of -800M therefore outranks one of +200M in "desc".
//   5. TWO INDEX UNIVERSES. `SQ_INDICES` is five symbols and drives the
//      "All − Indices" exclusion; `SQ_CAP_ONE` is three and drives the Top-10
//      one-slot cap — and the header string names the three. IWM and NDX are
//      excludable but not slot-capped. Both lists are ported exactly; see the
//      comment on `SQ_CAP_ONE`.
//   6. THE FILTER ORDER IS PART OF THE CONTRACT (E32): expiry → card scope →
//      min OTM → direction, then sort, then slice. The direction filter reads
//      the sort column, so moving it earlier would change which rows survive.
//   7. The OTM% orange threshold is a HARDCODED 5% (E103) and is independent of
//      the `min OTM` filter — with min OTM = 10% the whole column is orange.
//      Kept as the boundary v2 ships.
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// None in the maths. The departures are in `strikeQueryData.ts` (the transport)
// and in the colour collapse below; the filters, comparators, boundaries, caps
// and strings are byte-for-byte v2.
//
// ── COLOUR COLLAPSE ──────────────────────────────────────────────────────────
// v2's `HOME_THEME.green` is #8ECAE6 — a LIGHT BLUE — and it did two unrelated
// jobs: page chrome (toolbar labels, the header row, the card subtitle, the
// Top-10 header) AND "this number rose", paired against #EF4444. One value
// meaning both is the two-reds case from em.md. Split here:
//   chrome            → `T.muted`
//   positive / rising → `MOVE_UP`
//   negative /falling → `MOVE_DOWN`
// #EF4444 likewise split: directional → `MOVE_DOWN`, the error banner →
// `T.red`. The 5%-OTM orange → `T.orange`, boundary unchanged.
//
// ── A v3 RULE CARRIED OVER FROM DELETED CODE (E116–E118) ─────────────────────
// v2 had a `ModalPortal` helper directly after this tab. It is dead — a whole
// tree grep for the identifier returns exactly one hit, its own declaration —
// so it is NOT ported. Its INSIGHT is real and belongs in v3's rules:
//
//   `position: fixed` resolves against the VIEWPORT only while no ancestor has
//   a transform, filter, backdrop-filter, perspective, will-change or contain.
//   Every card surface sets `backdrop-filter: blur(16px)` and the hover lift
//   adds a `transform`, so an overlay rendered inside a card has `inset: 0`
//   cover THE CARD — it looks centred because it is, on a card two screens
//   down. Any floating layer must portal to <body>. v3's dropdown already
//   does (v2's `ThemedSelect` did too, independently, which is why the tab
//   never needed `ModalPortal`).
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
//  · `ModalPortal` (E116) — dead, see above. The lesson is kept, the component
//    is not.
//  · The `NEUTRAL` and `zColor` imports (E12, E13). v2's Scanner.tsx imports
//    both; the Strike Query block references neither. They live in
//    `@/pages/scanner/format` for the tabs that do use them.
//  · `th`, `td`, `seg()` and the ThemedSelect widths (130 / 150 / 90 px).
//    Styling, and therefore step 3.
//  · `PageShell`, its two radial glows and the v2 tab-bar chrome (E7). v3's
//    shell owns page chrome; this tab contributes none.
//
// Spec: docs/parity/scanner.md Part E, rows E1–E118.
// ─────────────────────────────────────────────────────────────────────────────

import { MOVE_DOWN, MOVE_UP, T, alpha } from '@/design/theme'
import { EM_DASH, fmtB } from '@/pages/scanner/format'
import { OWNER_ONLY_TABS, scannerTab } from '@/pages/scanner/scannerNav'
import type { ScannerTabId } from '@/pages/scanner/scannerNav'

// ═════════════════════════════════════════════════════════════════════════════
//  E.0 — Tab identity
// ═════════════════════════════════════════════════════════════════════════════

/** `/scanner?tab=strike`. Spec: Part E, rows E1–E4. */
export const SQ_TAB_ID: ScannerTabId = 'strike'

/** Label / short label / accent / icon, from the one registry. Rows E1–E3. */
export const SQ_TAB = scannerTab(SQ_TAB_ID)

/**
 * The tab is PUBLIC (E6). `strike` carries no `ownerOnly` flag — only
 * `pickstudy` does — so the owner check never gates this view. Asserted from
 * the registry rather than restated, so the two cannot drift.
 */
export const SQ_IS_OWNER_ONLY = OWNER_ONLY_TABS.has(SQ_TAB_ID)

// Deep-link parsing (E4) and the in-page tab event (E5) are page-frame concerns
// and already live in `scannerNav` (`isScannerTabId`, `DEFAULT_TAB`,
// `SCANNER_TAB_EVENT`). Nothing about them is Strike-Query-specific, so they
// are deliberately not re-declared here.

// ═════════════════════════════════════════════════════════════════════════════
//  E.2 — Wire shapes and the accessor
// ═════════════════════════════════════════════════════════════════════════════

/**
 * One strike row as `/proxy/strike-growth/by-expiry` returns it, with `symbol`
 * re-stamped client-side (E18 — the client overwrites whatever `symbol` the API
 * sent with the symbol it asked for).
 *
 * `chg15/30/60` are nullable; `gex_now`, `delta_abs` and `strike` are not.
 * `spot` is both optional AND nullable, and its absence drops a row from both
 * the direction filter and any `minOtm > 0` filter (E30, E31).
 */
export interface SqRow {
  symbol: string
  expiry: string
  strike: number
  gex_now: number
  delta_abs: number
  chg15: number | null
  chg30: number | null
  chg60: number | null
  spot?: number | null
}

/** The six sortable metrics. OTM% is deliberately NOT one of them (E88, E110). */
export type SqCol = 'strike' | 'gex_now' | 'chg15' | 'chg30' | 'chg60' | 'delta_abs'

export type SqSortDir = 'desc' | 'asc'

export interface SqSort {
  col: SqCol
  dir: SqSortDir
}

/** Toolbar direction filter. `all` disables the filter entirely. */
export type SqDirFilter = 'all' | 'pos' | 'neg'

/** The two states the direction filter actually filters in. */
export type SqDirActive = 'pos' | 'neg'

/** Top-10 card scope — which, per E33, also filters the TABLE. */
export type SqCardScope = 'all' | 'exidx'

/**
 * The one metric accessor. Spec: Part E, row E28.
 *
 * NULL BECOMES ZERO — not `-Infinity`, not "sorts last". A row whose 15-minute
 * change was never recorded ranks exactly where a measured flat row ranks, in
 * the middle of an `Math.abs()` ordering. Every comparator and both filters
 * read through this, so the coercion decides row ORDER as well as text. Do not
 * "fix" it here: the fix belongs upstream, in a real "no data" sort bucket, and
 * it needs the API's answer to whether null means "insufficient history" or
 * "no change".
 */
export function sqVal(r: SqRow, c: SqCol): number {
  const v = c === 'strike' ? r.strike : r[c]
  return v == null ? 0 : Number(v)
}

// ═════════════════════════════════════════════════════════════════════════════
//  E.2 — Universes
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The universe queried before the watchlist lands, and the Ticker dropdown's
 * contents until it does. Spec: row E16.
 *
 * Ten tickers in THIS hardcoded order — not sorted, unlike the watchlist, which
 * arrives lexicographically sorted (E15). The order is visible: it is the
 * dropdown's order and it is the concatenation order of the fan-out, which is
 * in turn the stable-sort tie-break for every comparator below (E19).
 */
export const SQ_FALLBACK: readonly string[] = [
  'SPX',
  'SPY',
  'QQQ',
  'NVDA',
  'AAPL',
  'TSLA',
  'AMZN',
  'META',
  'MSFT',
  'GOOGL',
]

/**
 * Excluded by the "All − Indices" toggle. FIVE symbols. Spec: row E29.
 *
 * v2 allocated this inside the component body, so it was rebuilt on every
 * render; hoisting it is a lifetime change, not a behaviour change.
 */
export const SQ_INDICES: ReadonlySet<string> = new Set(['SPX', 'SPY', 'QQQ', 'IWM', 'NDX'])

/**
 * Capped to one Top-10 slot each. THREE symbols. Spec: row E38.
 *
 * THE ASYMMETRY IS v2's AND IS PORTED AS-IS: `SQ_INDICES` (5) ≠ `SQ_CAP_ONE`
 * (3). IWM and NDX are excludable by the scope toggle but are NOT slot-capped —
 * either of them can take all ten cards. The Top-10 header string
 * (`SQ_TEXT.topCardsCapNote`) says "SPX/SPY/QQQ 1 slot each", which matches
 * `SQ_CAP_ONE` and NOT `SQ_INDICES`, so the visible copy is consistent with the
 * cap and silent about the exclusion. Reconciling the two lists is an open
 * question for the product owner (Part E, open question 2), not a transcription
 * decision.
 */
export const SQ_CAP_ONE: ReadonlySet<string> = new Set(['SPX', 'SPY', 'QQQ'])

/** How many Top-10 cards. The literal `10` in `out.length === 10` (E38). */
export const SQ_TOP_CARDS = 10

// ═════════════════════════════════════════════════════════════════════════════
//  E.3 — Derivation pipeline. Pure. No network. See header note 1.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The ONLY inputs that cause a refetch. Spec: row E24.
 *
 * `symbol` because it changes the fan-out's targets, and the watchlist LENGTH
 * because the fan-out's default target set is the watchlist. Exported as data
 * so a step-3 query key can be asserted against it in review.
 */
export const SQ_REFETCH_INPUTS = ['symbol', 'watchlistLength'] as const

/**
 * Everything else. Spec: rows E24, E32, E35–E38.
 *
 * Each of these re-runs `sqFilterRows` / `sqDisplayRows` / `sqTopCards` over
 * rows ALREADY IN STATE. Putting any of them in a fetch key turns one request
 * per ticker change into six, which is the single most important thing this
 * port must not do.
 */
export const SQ_CLIENT_ONLY_INPUTS = ['expiry', 'limit', 'dir', 'minOtm', 'cardScope', 'sort'] as const

/** The sentinel both the Ticker and the Expiry select use for "no filter". */
export const SQ_ALL = 'ALL'

/**
 * Every control's default, as v2 initialises it. Spec: row E42.
 *
 * NOTHING IS PERSISTED — no localStorage, no sessionStorage, no URL param
 * anywhere in this tab — so every one of these is restored on every remount.
 */
export const SQ_DEFAULTS = {
  symbol: SQ_ALL,
  expiry: SQ_ALL,
  limit: 25,
  sort: { col: 'gex_now', dir: 'desc' } as SqSort,
  cardScope: 'all' as SqCardScope,
  dir: 'all' as SqDirFilter,
  minOtm: 0,
} as const

/**
 * Distance from spot as a FRACTION, not a percent: `0.05` is 5%. Spec: row E30.
 *
 * Symmetric — a strike 5% below spot and one 5% above both return `0.05`, which
 * is why the direction filter needs its own side test.
 *
 * Returns 0 when spot is null, undefined, zero or negative. That is not
 * neutral: `0 >= 0.02` is false, so a row with no usable spot is silently
 * dropped by any `minOtm > 0` filter and kept when `minOtm === 0`.
 */
export function sqOtmDist(r: SqRow): number {
  return r.spot && r.spot > 0 ? Math.abs(r.strike - r.spot) / r.spot : 0
}

/**
 * The direction filter. Spec: row E31.
 *
 * BUG (v2): this tests the sign of the ACTIVE SORT COLUMN, not of GEX. The
 * control's own tooltip (`SQ_TEXT.dirTooltip`, Scanner.tsx:766) promises GEX
 * specifically — "Positive = OTM strikes above spot with rising GEX (Δ↑)" —
 * and the tooltip is only truthful while the sort happens to be on `gex_now`,
 * which is merely the default. Sorting by `strike` makes `v = r.strike`, always
 * positive, so `Negative` returns ZERO ROWS for every input; sorting by
 * `delta_abs` (already a magnitude) does the same. Two of the six sort states
 * therefore make "Negative" an empty set, and the empty-state row
 * (`SQ_TEXT.emptyRows`) gives no hint why.
 *
 * Ported as the CODE behaves, per the brief: step 2 records v2 bugs, step 3
 * decides them. The fix, when it is taken, is to name the metric —
 * `sqVal(r, 'gex_now')` — not to change the tooltip.
 *
 * Both boundaries are strict: a strike exactly at spot, or a metric of exactly
 * `0` (which includes every null, per `sqVal`), fails BOTH directions.
 */
export function sqDirPass(r: SqRow, dir: SqDirActive, sortCol: SqCol): boolean {
  if (!r.spot || r.spot <= 0) return false
  const v = sqVal(r, sortCol)
  // v2 writes this as `dir === "pos" ? … : …`, so anything not "pos" takes the
  // negative branch. The call sites only ever pass "pos" or "neg" — the filter
  // is skipped entirely when dir is "all" — so the ternary is faithful.
  return dir === 'pos' ? r.strike > r.spot && v > 0 : r.strike < r.spot && v < 0
}

/** The filter tuple shared by the table and the cards. */
export interface SqFilters {
  /** `SQ_ALL` or an exact expiry string. */
  expiry: string
  cardScope: SqCardScope
  /** A FRACTION (`SQ_MIN_OTM_OPTIONS` values). `0` skips the filter entirely. */
  minOtm: number
  dir: SqDirFilter
  /** Read by the direction filter as well as by the comparators — see `sqDirPass`. */
  sort: SqSort
}

/**
 * The four filters, IN ORDER. Spec: rows E32, E36.
 *
 * v2 writes this chain out twice — once for `displayRows` (695–699) and once
 * for `topCards` (713–716) — with identical steps in identical order. The two
 * lists genuinely cannot diverge on filtering, only on ordering and cap, so one
 * function is a faithful de-duplication rather than a simplification.
 *
 * Order matters and is not incidental: the direction filter reads the sort
 * column and the min-OTM filter reads spot, so any reordering changes which
 * rows survive, not just how fast.
 *
 *   1. expiry     — `SQ_ALL` passes everything, otherwise an exact match
 *   2. card scope — `exidx` drops `SQ_INDICES`. THIS FILTERS THE TABLE TOO;
 *                   see the note on `sqTopCards`.
 *   3. min OTM    — only when `> 0`, boundary `>=`, so 0.05 KEEPS a strike
 *                   sitting exactly 5.0% away
 *   4. direction  — only when not `all`
 */
export function sqFilterRows(rows: readonly SqRow[], f: SqFilters): SqRow[] {
  let out = f.expiry === SQ_ALL ? [...rows] : rows.filter((r) => r.expiry === f.expiry)
  if (f.cardScope === 'exidx') out = out.filter((r) => !SQ_INDICES.has(r.symbol))
  if (f.minOtm > 0) out = out.filter((r) => sqOtmDist(r) >= f.minOtm)
  if (f.dir !== 'all') {
    const active: SqDirActive = f.dir
    out = out.filter((r) => sqDirPass(r, active, f.sort.col))
  }
  return out
}

/**
 * The magnitude comparator, direction NOT applied. Spec: row E34.
 *
 * `strike` compares SIGNED values (`bv - av`); every other column compares
 * `Math.abs()`. So in "desc" a Δ 15m of -800M outranks one of +200M, and
 * `delta_abs` — already a magnitude — gets a double-abs that is a no-op.
 *
 * Nulls arrive here as `0` (see `sqVal`), so they land last in desc and first
 * in asc, mixed indistinguishably among genuine zeros.
 *
 * Ties keep the input order: `Array.prototype.sort` is stable, and the input
 * order is the fan-out concatenation order (E19).
 */
export function sqCompareMagnitude(a: SqRow, b: SqRow, col: SqCol): number {
  const av = sqVal(a, col)
  const bv = sqVal(b, col)
  return col === 'strike' ? bv - av : Math.abs(bv) - Math.abs(av)
}

/**
 * The table's rows: filter → sort (direction applied) → cap. Spec: rows E32–E35.
 *
 * The cap is applied AFTER the sort, so it is a true top-N and not a window.
 */
export function sqDisplayRows(rows: readonly SqRow[], f: SqFilters, limit: number): SqRow[] {
  const filtered = sqFilterRows(rows, f)
  const sorted = [...filtered].sort((a, b) => {
    const cmp = sqCompareMagnitude(a, b, f.sort.col)
    return f.sort.dir === 'desc' ? cmp : -cmp
  })
  return sorted.slice(0, limit)
}

/**
 * The Top-10 cards. Spec: rows E36–E38, E72.
 *
 * BUG (v2): `f.sort.dir` is NOT applied here (Scanner.tsx:717–720). Flipping a
 * column header to ascending reverses the TABLE while the cards stay
 * descending — so the two lists silently disagree about what "top" means in
 * exactly one of the two arrow states. Ported as written; whether ascending
 * should give a "bottom 10" or the cards should stay a pure magnitude ranking
 * is Part E open question 4.
 *
 * STRUCTURAL PROBLEM FOR STEP 3 (rows E33, E72, E114), recorded here because
 * this derivation is where it becomes visible:
 *
 *   The `All` / `All − Indices` toggle is drawn inside this block's HEADER, yet
 *   line 697 applies `cardScope` to `displayRows` as well — it filters the
 *   TABLE, and nothing in the UI says so. Worse, v2 gates the entire block on
 *   `topCards.length > 0`, so when the toggle empties the view the header that
 *   holds the toggle unmounts with it: the control disappears at precisely the
 *   moment a user needs it to undo what it just did, and the empty-state
 *   sentence does not distinguish "no data" from "you excluded everything".
 *   Both derivations keep the filter (it is v2's behaviour); step 3 must NOT
 *   reproduce the unmount trap — the scope control belongs in the toolbar with
 *   the other filters, which are always mounted.
 *
 * The cap walk: rank, then take rows in order, skipping a `SQ_CAP_ONE` symbol
 * that already has a card, stopping at ten. Fewer than ten eligible rows yields
 * fewer than ten cards.
 */
export function sqTopCards(rows: readonly SqRow[], f: SqFilters): SqRow[] {
  const base = sqFilterRows(rows, f)
  const ranked = [...base].sort((a, b) => sqCompareMagnitude(a, b, f.sort.col))
  const used = new Set<string>()
  const out: SqRow[] = []
  for (const r of ranked) {
    if (SQ_CAP_ONE.has(r.symbol)) {
      if (used.has(r.symbol)) continue
      used.add(r.symbol)
    }
    out.push(r)
    if (out.length === SQ_TOP_CARDS) break
  }
  return out
}

/**
 * Header click behaviour. Spec: row E41.
 *
 * Clicking the ACTIVE column flips its direction; clicking any other column
 * always restarts at `desc`. There is no third "unsorted" state.
 */
export function sqToggleSort(prev: SqSort, col: SqCol): SqSort {
  if (prev.col === col) return { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
  return { col, dir: 'desc' }
}

/** Whether the Symbol / Expiry columns exist at all. Spec: row E39. */
export function sqShowSymbol(symbol: string): boolean {
  return symbol === SQ_ALL
}
export function sqShowExpiry(expiry: string): boolean {
  return expiry === SQ_ALL
}

/**
 * The empty row's `colSpan`. Spec: row E113.
 *
 * `cols.length + 1` — the six sortable columns plus the un-sortable OTM% — then
 * one each for the two optional columns. 9 with both, 8 with one, 7 with
 * neither.
 */
export function sqEmptyColSpan(showSymbol: boolean, showExpiry: boolean): number {
  return SQ_COLUMNS.length + 1 + (showSymbol ? 1 : 0) + (showExpiry ? 1 : 0)
}

// ═════════════════════════════════════════════════════════════════════════════
//  E.7 / E.8 — The column contract
// ═════════════════════════════════════════════════════════════════════════════

/**
 * How a column's body cell is rendered. Encoded per column because v2's six
 * `<td>`s are hand-written and DO NOT agree with one another (E105 vs E106,
 * E109 vs E106) — see `signColoured`.
 */
export type SqCellKind =
  /** Raw number, no `$`, no `toFixed`, no separator (E104). */
  | 'rawNumber'
  /** `fmtB` on a non-nullable field (E105, E109). */
  | 'magnitude'
  /** `fmtB` on a nullable field, em dash when null (E106–E108). */
  | 'nullableMagnitude'

export interface SqColumnDef {
  /** Both the sort key and the `SqRow` field. */
  key: SqCol
  /** The header string, exactly as v2 writes it. Uppercased by CSS at render. */
  label: string
  kind: SqCellKind
  /**
   * Whether the cell is painted by sign. Spec: rows E105, E106–E108, E109, and
   * the "collapse these" note 6.
   *
   * SIGN COLOURING IS INCONSISTENT BY COLUMN IN v2 AND IS ENCODED PER COLUMN
   * RATHER THAN NORMALISED: the three Δ columns are green/red, while `GEX Now`
   * and `Delta Abs` are plain text whatever the sign — a negative GEX Now and a
   * negative Δ 15m in the same row are painted differently, and the only thing
   * carrying the sign on the former is the `-` inside `fmtB`'s own string. Do
   * not "tidy" this into one rule here; whether v3 ships "only deltas are
   * signed-coloured" or "every signed number is" is Part E open question 5.
   */
  signColoured: boolean
}

/**
 * The six sortable columns, IN ORDER. Spec: rows E40, E89–E94.
 *
 * OTM% is NOT in this list and must not be added: it is not a `SqCol`, it has
 * no sort handler, no arrow glyph and no cursor change (E88, E110). It is
 * rendered as a fixed column before `strike`.
 */
export const SQ_COLUMNS: readonly SqColumnDef[] = [
  { key: 'strike', label: 'Strike', kind: 'rawNumber', signColoured: false },
  { key: 'gex_now', label: 'GEX Now', kind: 'magnitude', signColoured: false },
  { key: 'chg15', label: 'Δ 15m', kind: 'nullableMagnitude', signColoured: true },
  { key: 'chg30', label: 'Δ 30m', kind: 'nullableMagnitude', signColoured: true },
  { key: 'chg60', label: 'Δ 60m', kind: 'nullableMagnitude', signColoured: true },
  { key: 'delta_abs', label: 'Delta Abs', kind: 'magnitude', signColoured: false },
]

/** The label for a sort key, used by the Top-10 header and the card metric label. */
export function sqColLabel(col: SqCol): string {
  return SQ_COLUMNS.find((c) => c.key === col)?.label ?? ''
}

/** The two optional leading columns and the fixed un-sortable one (E86–E88). */
export const SQ_FIXED_HEADERS = {
  symbol: 'Symbol',
  expiry: 'Expiry',
  /** Not sortable. No arrow, no click target. */
  otm: 'OTM%',
} as const

/**
 * The sort arrow glyph. Spec: row E96.
 *
 * Three states, each with a LEADING SPACE, and the inactive one is dimmed
 * rather than hidden so every sortable header always carries a glyph.
 */
export const SQ_SORT_ARROW = {
  desc: ' ↓',
  asc: ' ↑',
  /** U+21C5, shown on every column that is not the active one. */
  inactive: ' ⇅',
} as const

export function sqSortArrow(col: SqCol, sort: SqSort): string {
  if (sort.col !== col) return SQ_SORT_ARROW.inactive
  return sort.dir === 'desc' ? SQ_SORT_ARROW.desc : SQ_SORT_ARROW.asc
}

// ═════════════════════════════════════════════════════════════════════════════
//  E.5 — Toolbar controls: options and defaults
// ═════════════════════════════════════════════════════════════════════════════

export interface SqOption<V> {
  value: V
  label: string
}

/**
 * Ticker options. Spec: row E51. THE ONLY CONTROL THAT REFETCHES.
 *
 * `ALL` first, then the universe in ITS OWN order — the ten fallbacks before
 * the watchlist lands (unsorted), the lexicographically sorted active watchlist
 * after (E15, E16). Never empty.
 */
export function sqTickerOptions(symbolList: readonly string[]): SqOption<string>[] {
  return [{ value: SQ_ALL, label: SQ_ALL }, ...symbolList.map((s) => ({ value: s, label: s }))]
}

/** The universe actually queried and offered. Spec: row E16. */
export function sqSymbolList(watchlist: readonly string[]): readonly string[] {
  return watchlist.length > 0 ? watchlist : SQ_FALLBACK
}

/**
 * Expiry options. Spec: row E53.
 *
 * The first option is the one place on this tab where a value and its label
 * differ: value `"ALL"`, label `"All Expiries"`. Expiry strings render RAW from
 * the API — no reformatting, no locale pass.
 */
export const SQ_EXPIRY_ALL_LABEL = 'All Expiries'

export function sqExpiryOptions(expiries: readonly string[]): SqOption<string>[] {
  return [
    { value: SQ_ALL, label: SQ_EXPIRY_ALL_LABEL },
    ...expiries.map((e) => ({ value: e, label: e })),
  ]
}

/** Row cap. Exactly four options in this order; default 25. Spec: rows E35, E55. */
export const SQ_LIMIT_OPTIONS: readonly SqOption<number>[] = [
  { value: 10, label: '10' },
  { value: 25, label: '25' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
]

/** Direction segmented control. Spec: rows E58–E60. */
export const SQ_DIR_OPTIONS: readonly SqOption<SqDirFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'pos', label: 'Positive' },
  { value: 'neg', label: 'Negative' },
]

/**
 * min-OTM options. Spec: row E63.
 *
 * Values are FRACTIONS; labels use a trailing `+` while the card subtitle uses
 * a leading `≥` for the same idea (`sqSubtitle`) — two spellings, both v2's.
 * `any` is `0`, which skips the filter entirely rather than filtering at `>= 0`
 * (which would matter: `sqOtmDist` returns 0 for a missing spot).
 */
export const SQ_MIN_OTM_OPTIONS: readonly SqOption<number>[] = [
  { value: 0, label: 'any' },
  { value: 0.02, label: '2%+' },
  { value: 0.05, label: '5%+' },
  { value: 0.1, label: '10%+' },
  { value: 0.15, label: '15%+' },
  { value: 0.2, label: '20%+' },
]

/**
 * Top-10 card scope. Spec: rows E75, E76.
 *
 * `All − Indices` uses U+2212 MINUS SIGN, not a hyphen. Per `sqTopCards`, this
 * control also filters the table and unmounts with the block it lives in.
 */
export const SQ_CARD_SCOPE_OPTIONS: readonly SqOption<SqCardScope>[] = [
  { value: 'all', label: 'All' },
  { value: 'exidx', label: 'All − Indices' },
]

// ═════════════════════════════════════════════════════════════════════════════
//  E.4 / E.5 / E.6 / E.9 — Every user-visible string
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Every literal on the tab, so step 3 cannot paraphrase one. Spec: rows E44–E49,
 * E50–E65, E74, E113.
 */
export const SQ_TEXT = {
  /** Card title. Rendered uppercase by the card's own header style. */
  title: 'Strike GEX Query',
  /** Subtitle stem; the suffixes are appended by `sqSubtitle`. */
  subtitleStem: 'Top movers by strike',
  /** What the stem is followed by when the Ticker is `ALL`. */
  subtitleAllTickers: 'all watched tickers',
  subtitleDirPos: 'above spot · Δ↑',
  subtitleDirNeg: 'below spot · Δ↓',
  /** THE ONLY loading affordance on the tab (E48, E111). No spinner exists. */
  subtitleLoading: 'loading…',

  /** The three uppercase-by-CSS dropdown labels (E50, E52, E54). */
  labelTicker: 'Ticker',
  labelExpiry: 'Expiry',
  labelLimit: 'Limit',

  /**
   * The direction group's native tooltip (E57).
   *
   * IT NAMES GEX, AND `sqDirPass` DOES NOT USE GEX — see the BUG note there.
   * The string is transcribed as v2 ships it; correcting the copy would hide
   * the conflict rather than resolve it.
   */
  dirTooltip:
    'Positive = OTM strikes above spot with rising GEX (Δ↑) · Negative = OTM strikes below spot with falling GEX (Δ↓)',

  /** Lowercase `min`, uppercase `OTM`, and NOT uppercased by CSS (E61). */
  labelMinOtm: 'min OTM',
  minOtmTooltip: 'How far OTM the strike must sit vs spot',

  /** `↻` is U+21BB, then one space. Never disabled while loading (E64). */
  refresh: '↻ Refresh',
  /** All lowercase, never changes, never hides (E65). */
  sortHint: 'click a column header to sort',
  /** A literal pipe glyph, not a rule element (E56). */
  divider: '|',

  /** Top-10 header, assembled by `sqTopCardsHeader` (E74). */
  topCardsStem: 'Top 10',
  /** Names `SQ_CAP_ONE`'s three symbols, not `SQ_INDICES`'s five. */
  topCardsCapNote: 'SPX/SPY/QQQ 1 slot each',

  /**
   * The one empty-state sentence (E113). Literal `(s)`.
   *
   * It does not distinguish its four causes — API returned nothing, the expiry
   * filter matched nothing, min OTM excluded everything, or the direction
   * filter is structurally empty (see `sqDirPass`) — and offers no reset (E114).
   */
  emptyRows: 'No rows yet. Needs recorder history for the selected ticker(s).',
} as const

/**
 * The card subtitle. Spec: rows E45–E49.
 *
 * `Top movers by strike · {ticker}[ · {direction}][ · OTM ≥N%][ · loading…]`,
 * separator a spaced middle dot. The OTM suffix is ZERO decimals and `≥` takes
 * no space after it.
 *
 * What it deliberately never mentions: the selected Expiry, the Limit, or the
 * card scope — three of the seven controls are invisible in the header summary.
 */
export function sqSubtitle(args: {
  symbol: string
  dir: SqDirFilter
  minOtm: number
  loading: boolean
}): string {
  const who = args.symbol === SQ_ALL ? SQ_TEXT.subtitleAllTickers : args.symbol
  const dirPart =
    args.dir === 'all'
      ? ''
      : ` · ${args.dir === 'pos' ? SQ_TEXT.subtitleDirPos : SQ_TEXT.subtitleDirNeg}`
  const otmPart = args.minOtm > 0 ? ` · OTM ≥${(args.minOtm * 100).toFixed(0)}%` : ''
  const loadPart = args.loading ? ` · ${SQ_TEXT.subtitleLoading}` : ''
  return `${SQ_TEXT.subtitleStem} · ${who}${dirPart}${otmPart}${loadPart}`
}

/**
 * `Top 10 · GEX Now · SPX/SPY/QQQ 1 slot each`. Spec: row E74.
 *
 * The middle segment is the ACTIVE sort column's label and changes on every
 * header click.
 */
export function sqTopCardsHeader(col: SqCol): string {
  return `${SQ_TEXT.topCardsStem} · ${sqColLabel(col)} · ${SQ_TEXT.topCardsCapNote}`
}

// ═════════════════════════════════════════════════════════════════════════════
//  E.6 / E.8 — Cell text and colour, per column
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The OTM% orange boundary, in PERCENT (not a fraction, unlike
 * `SQ_MIN_OTM_OPTIONS`). Spec: row E103.
 *
 * Fixed at 5 and INDEPENDENT of the `min OTM` filter: set min OTM to 10% and
 * every visible row is orange, because every visible row is by definition past
 * this mark. Boundary kept exactly; whether it should track the filter is Part
 * E open question 7.
 */
export const SQ_OTM_ORANGE_PCT = 5

/** `"3.4%"` at one decimal, or an em dash when spot is null, undefined OR 0. */
export function sqOtmText(r: SqRow): string {
  return r.spot ? `${(sqOtmDist(r) * 100).toFixed(1)}%` : EM_DASH
}

/**
 * Orange past 5%, dim text below. Spec: row E103.
 *
 * A row with no usable spot has `sqOtmDist` 0, so its em dash is painted the
 * dim colour, never orange.
 *
 * COLLAPSE: v2's `HOME_THEME.orange` #FB8501 → `T.orange`; the sub-threshold
 * `rgba(255,255,255,0.7)` → `alpha(T.text, 0.7)`.
 */
export function sqOtmColor(r: SqRow): string {
  return sqOtmDist(r) * 100 >= SQ_OTM_ORANGE_PCT ? T.orange : alpha(T.text, 0.7)
}

/**
 * A Δ cell's text. Spec: rows E106–E108.
 *
 * NULL RENDERS AS AN EM DASH HERE — and as `"+0"` on the Top-10 card for the
 * same row and the same field (see `sqCardMetricText`). Both are exported
 * because both ship; see header note 3.
 */
export function sqDeltaCellText(v: number | null): string {
  return v == null ? EM_DASH : fmtB(v)
}

/**
 * A Δ cell's colour. Spec: rows E106–E108.
 *
 * Three-way ladder, evaluated in this order:
 *   null   → `T.text`   ("not measured" — the em dash above)
 *   v >= 0 → `MOVE_UP`
 *   v <  0 → `MOVE_DOWN`
 *
 * The boundary is `>=`, so a measured exact zero is painted UP and prints
 * `"+0"`. That is `fmtB`'s whole reason for always carrying a sign: `"+0"`
 * means "measured, and flat", the em dash means "no reading".
 *
 * COLLAPSE: v2 painted the up branch `HOME_THEME.green` #8ECAE6 — a light blue
 * that is also the colour of every label and header on this tab — and the down
 * branch #EF4444, the same red as the error banner. Split into the directional
 * pair; chrome takes `T.muted` and the error banner takes `T.red`.
 */
export function sqDeltaCellColor(v: number | null): string {
  if (v == null) return T.text
  return v >= 0 ? MOVE_UP : MOVE_DOWN
}

/**
 * A Top-10 card's metric text. Spec: row E84.
 *
 * Sorting by Strike shows the BARE number with no `$` — unlike the card's own
 * strike line, which prefixes one (`sqCardStrikeText`). Every other column goes
 * through `fmtB` and is therefore always signed.
 *
 * NULL RENDERS AS `"+0"` HERE, because the value has already passed through
 * `sqVal`'s null→0 coercion before `fmtB` sees it — the same row whose table
 * cell shows an em dash. The two disagree in v2 and are ported disagreeing.
 */
export function sqCardMetricText(r: SqRow, col: SqCol): string {
  return col === 'strike' ? String(r.strike) : fmtB(sqVal(r, col))
}

/**
 * A Top-10 card's metric colour. Spec: row E84.
 *
 * `strike`, `gex_now` and `delta_abs` are plain text WHATEVER the sign; the
 * three Δ columns are directional on `v >= 0`. Same per-column inconsistency as
 * the table body (see `SqColumnDef.signColoured`), and the same consequence for
 * nulls: a null chg is `0`, `0 >= 0`, so it is painted UP and reads `"+0"`.
 */
export function sqCardMetricColor(r: SqRow, col: SqCol): string {
  const def = SQ_COLUMNS.find((c) => c.key === col)
  if (!def?.signColoured) return T.text
  return sqVal(r, col) >= 0 ? MOVE_UP : MOVE_DOWN
}

/** `"$6050"` — a raw `$` on the raw number, no separator, no fixed decimals (E82). */
export function sqCardStrikeText(r: SqRow): string {
  return `$${r.strike}`
}

/** `"#1"` … `"#10"`, 1-based (E81). */
export function sqCardRankText(index: number): string {
  return `#${index + 1}`
}

/**
 * The two null renderings, side by side, as data.
 *
 * Step 3 will render both surfaces and must not silently pick one. This is the
 * conflict, stated once: the SAME null `chg15` on the SAME row reads
 * "measured, and flat" on the card and "no reading" in the table. Neither is
 * wrong on its own; shipping both is.
 */
export const SQ_NULL_CHG_RENDER = {
  card: { text: fmtB(0), color: MOVE_UP, meaning: 'measured, and flat' },
  table: { text: EM_DASH, color: T.text, meaning: 'no reading' },
} as const

/**
 * The active sort header is the only cyan thing in the header row; every other
 * header — and the header row itself — is chrome. Spec: rows E95, E86–E88.
 *
 * COLLAPSE: inactive was `HOME_THEME.green` #8ECAE6 in its CHROME role, so it
 * takes `T.muted` here and NOT `MOVE_UP`.
 */
export function sqHeaderColor(col: SqCol, sort: SqSort): string {
  return sort.col === col ? T.cyan : T.muted
}

/**
 * The error banner's colour. Spec: row E112.
 *
 * COLLAPSE: v2 used #EF4444 for this AND for a falling delta. A failed fetch is
 * not a direction, so the banner takes `T.red` and only the deltas take
 * `MOVE_DOWN`.
 */
export const SQ_ERROR_COLOR = T.red
