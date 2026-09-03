// ─────────────────────────────────────────────────────────────────────────────
// STRIKE QUERY — the render layer for /scanner?tab=strike.
//
// Spec: docs/parity/scanner.md Part E, rows E1–E118. All logic, every threshold,
// every label string and both loaders already live in `strikeQuery.ts` and
// `strikeQueryData.ts`; this file wires them to the screen and decides nothing.
//
// FIVE THINGS ABOUT THIS FILE THAT ARE NOT OBVIOUS FROM READING IT TOP TO BOTTOM
//
//   1. ONLY THE TICKER REFETCHES. The load callback's deps are `symbol` and
//      `symbolList` (whose identity moves only when the watchlist first lands) —
//      that is `SQ_REFETCH_INPUTS`. Expiry, Limit, direction, min-OTM, card scope
//      and the sort column are `SQ_CLIENT_ONLY_INPUTS` and appear ONLY in the
//      `useMemo` deps of `sqDisplayRows` / `sqTopCards`, never in a fetch. Moving
//      any of the six into `load` turns one fetch per ticker change into six,
//      which is the single thing this port must not do.
//   2. THE DIRECTION FILTER IS SIGNED ON THE ACTIVE SORT COLUMN, NOT ON GEX —
//      see the BUG note on `sqDirPass`. The tooltip below is v2's verbatim and it
//      promises GEX, so with the sort on Strike or Delta Abs "Negative" yields an
//      empty table under a tooltip that says otherwise. Rendered as v2 ships it.
//   3. THE SAME NULL IS RENDERED TWO WAYS, deliberately: `sqCardMetricText`
//      prints "+0" in the up colour on a Top-10 card, `sqDeltaCellText` prints an
//      em dash in `T.text` in the table, for the same field of the same row.
//      Both ship in v2 (`SQ_NULL_CHG_RENDER` states the conflict); reconciling
//      them is a product call, not a transcription.
//   4. SIGN COLOURING IS PER COLUMN. `SqColumnDef.signColoured` is read per cell
//      rather than normalised: the three Δ columns are directional, GEX Now and
//      Delta Abs are plain text at any sign. Do not tidy this into one rule.
//   5. THE TABLE IS HAND-ROLLED rather than built on `design/primitives/Table`.
//      That primitive early-returns its `empty` node INSTEAD of the table, which
//      would drop the header row — and E115 ("the header row still renders, so
//      the tab is not blank" before the first fetch settles) and E113 (an empty
//      row spanning `sqEmptyColSpan`) both require the header above a spanned
//      empty cell. Every class below is the primitive's own vocabulary so the two
//      still read as one table.
//
// This tab opens no socket and mounts no canvas — non-negotiables 5, 6 and 7
// have nothing to bite on here. It also adds no poll: v2 has none (E26) and
// `strikeQueryData.ts` deliberately does not pass `pollMs`.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '@/design/primitives/Card'
import { SegGroup } from '@/design/primitives/Controls'
import { T, V2, V2W, alpha } from '@/design/theme'
import { fmtB } from '@/pages/scanner/format'
import {
  SQ_CARD_SCOPE_OPTIONS,
  SQ_COLUMNS,
  SQ_DEFAULTS,
  SQ_DIR_OPTIONS,
  SQ_ERROR_COLOR,
  SQ_FIXED_HEADERS,
  SQ_LIMIT_OPTIONS,
  SQ_MIN_OTM_OPTIONS,
  SQ_TEXT,
  sqCardMetricColor,
  sqCardMetricText,
  sqCardRankText,
  sqCardStrikeText,
  sqColLabel,
  sqDeltaCellColor,
  sqDeltaCellText,
  sqDisplayRows,
  sqEmptyColSpan,
  sqExpiryOptions,
  sqHeaderColor,
  sqOtmColor,
  sqOtmText,
  sqShowExpiry,
  sqShowSymbol,
  sqSortArrow,
  sqSubtitle,
  sqSymbolList,
  sqTickerOptions,
  sqToggleSort,
  sqTopCards,
  sqTopCardsHeader,
} from '@/pages/scanner/strikeQuery'
import type {
  SqCardScope,
  SqCol,
  SqColumnDef,
  SqDirFilter,
  SqFilters,
  SqRow,
  SqSort,
} from '@/pages/scanner/strikeQuery'
import {
  loadStrikeRows,
  loadStrikeWatchlist,
  sqDeriveExpiries,
  sqReconcileExpiry,
  sqTargets,
} from '@/pages/scanner/strikeQueryData'

// ── Cell helpers ─────────────────────────────────────────────────────────────

/**
 * A column's RAW field, before any null coercion. Deliberately not `sqVal`:
 * `sqVal` is the SORT accessor and turns null into 0, which is exactly what the
 * table body must not do (E106–E108 print an em dash where the card prints "+0").
 */
function sqRawValue(r: SqRow, c: SqCol): number | null {
  return r[c]
}

/** E104 / E105 / E106–E108 / E109 — the three cell kinds, per `SqColumnDef.kind`. */
function sqCellText(r: SqRow, def: SqColumnDef): string {
  const v = sqRawValue(r, def.key)
  switch (def.kind) {
    // Raw number: no `$`, no toFixed, no thousands separator (E104).
    case 'rawNumber':
      return String(r.strike)
    // Non-nullable field through fmtB — always signed (E105, E109).
    case 'magnitude':
      return fmtB(v ?? 0)
    // Nullable field: em dash when null (E106–E108).
    case 'nullableMagnitude':
      return sqDeltaCellText(v)
  }
}

/** Per-column, never normalised — see `SqColumnDef.signColoured`. */
function sqCellColor(r: SqRow, def: SqColumnDef): string {
  if (!def.signColoured) return T.text
  return sqDeltaCellColor(sqRawValue(r, def.key))
}

/** Zebra: even rows transparent, odd rows washed (E98). Opposite to the cards. */
function sqRowBackground(i: number): string {
  return i % 2 ? alpha(T.text, 0.02) : 'transparent'
}

/** Cards alternate the OTHER way: even indices tinted, odd washed (E78). */
function sqCardBackground(i: number): string {
  return i % 2 ? alpha(T.text, 0.02) : alpha(V2.cyan, 0.06)
}

/** E79 / E99 — index-suffixed, so nothing is reused across a re-sort. */
function sqRowKey(r: SqRow, i: number): string {
  return `${r.symbol}-${r.expiry}-${r.strike}-${i}`
}

const LABEL_CLASS = 'text-xs uppercase tracking-wide'
const TH_CLASS = 'cursor-pointer select-none whitespace-nowrap border-b border-line px-2 py-1.5 text-xs font-bold uppercase tracking-wide'
const TH_STATIC_CLASS = 'whitespace-nowrap border-b border-line px-2 py-1.5 text-xs font-bold uppercase tracking-wide'
const TD_CLASS = 'border-b border-line/50 px-2 py-1 tabular'
const SELECT_CLASS = 'rounded-sm border border-line bg-bg px-2 py-1 text-xs text-fg'

// ── The tab ──────────────────────────────────────────────────────────────────

export default function StrikeQueryTab() {
  // E6: `strike` carries no `ownerOnly` flag, so there is no owner check here —
  // `SQ_IS_OWNER_ONLY` asserts that from the registry and is intentionally not
  // consumed by this render.
  const [watchlist, setWatchlist] = useState<string[]>([])
  const [symbol, setSymbol] = useState<string>(SQ_DEFAULTS.symbol)
  const [expiry, setExpiry] = useState<string>(SQ_DEFAULTS.expiry)
  const [expiries, setExpiries] = useState<string[]>([])
  const [rows, setRows] = useState<SqRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // E42: nothing below is persisted — no localStorage, no URL param — so every
  // control is back at its default on every remount.
  const [limit, setLimit] = useState<number>(SQ_DEFAULTS.limit)
  const [sort, setSort] = useState<SqSort>(SQ_DEFAULTS.sort)
  const [cardScope, setCardScope] = useState<SqCardScope>(SQ_DEFAULTS.cardScope)
  const [dir, setDir] = useState<SqDirFilter>(SQ_DEFAULTS.dir)
  const [minOtm, setMinOtm] = useState<number>(SQ_DEFAULTS.minOtm)

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // E14–E16: the watchlist, once, at mount. Every failure mode of
  // `loadStrikeWatchlist` collapses to `[]`, which leaves `SQ_FALLBACK` standing.
  useEffect(() => {
    void loadStrikeWatchlist().then((active) => {
      if (alive.current && active.length > 0) setWatchlist(active)
    })
  }, [])

  const symbolList = useMemo(() => sqSymbolList(watchlist), [watchlist])

  // The keyed read `strikeQueryData.ts`'s departure note 1 asks for: v2 has no
  // AbortController and no request key (E27), so a fast ticker switch lets
  // whichever fan-out resolves LAST win. `query()` dedupes by URL; this counter
  // is the other half — a stale fan-out's rows can no longer be applied to a
  // newer symbol.
  const seq = useRef(0)

  const load = useCallback(
    async (force = false) => {
      const mine = ++seq.current
      setLoading(true)
      setErr(null)
      try {
        // E17/E19: one request per target, fanned out in parallel, merged in
        // target order — which is the stable-sort tie-break for every comparator.
        const result = await loadStrikeRows(sqTargets(symbol, symbolList), { force })
        if (!alive.current || seq.current !== mine) return
        setRows(result.rows)
        // E20/E21: the expiry options are re-derived on every successful load and
        // the selection snaps back to ALL when it no longer exists.
        const exps = sqDeriveExpiries(result.rows)
        setExpiries(exps)
        setExpiry((prev) => sqReconcileExpiry(prev, exps))
      } catch (e) {
        // E23: structurally unreachable — every per-symbol mapper swallows its
        // own rejection, so `Promise.all` cannot reject. Kept for the merge lines
        // it nominally guards, exactly as v2 keeps it.
        if (!alive.current || seq.current !== mine) return
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive.current && seq.current === mine) setLoading(false)
      }
    },
    // SQ_REFETCH_INPUTS, and nothing else. `symbolList` stands in for v2's
    // `watchlist.length`: it is `SQ_FALLBACK` until the roster lands and the
    // roster is set once.
    [symbol, symbolList],
  )

  useEffect(() => {
    void load()
  }, [load])

  // ── Client-only derivations. SQ_CLIENT_ONLY_INPUTS live here and nowhere else.
  const filters = useMemo<SqFilters>(
    () => ({ expiry, cardScope, minOtm, dir, sort }),
    [expiry, cardScope, minOtm, dir, sort],
  )
  const displayRows = useMemo(() => sqDisplayRows(rows, filters, limit), [rows, filters, limit])
  // BUG (v2), reproduced: `sqTopCards` ignores `sort.dir`. Flipping a header to
  // ascending reverses the TABLE while the cards stay descending.
  const topCards = useMemo(() => sqTopCards(rows, filters), [rows, filters])

  const showSymbol = sqShowSymbol(symbol)
  const showExpiry = sqShowExpiry(expiry)

  return (
    <Card title={SQ_TEXT.title}>
      {/* E45–E49. The only loading affordance on the whole tab is this string's
          " · loading…" suffix — there is no spinner and no skeleton (E111). */}
      <div className="mb-3 text-xs text-muted">
        {sqSubtitle({ symbol, dir, minOtm, loading })}
      </div>

      {/* ── Toolbar (E50–E65) ──────────────────────────────────────────────────
          The three labels below are v2's `lbl` chrome, painted HOME_THEME.green
          #8ECAE6 — the CHROME leg of that value's three-way split, so they keep
          it as `V2.green` (Brandon, 2026-09-03). ─────────────────────────────*/}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS} style={{ color: V2.green }}>
            {SQ_TEXT.labelTicker}
          </span>
          {/* E51 — THE ONLY CONTROL THAT REFETCHES. */}
          <select
            aria-label={SQ_TEXT.labelTicker}
            className={SELECT_CLASS}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          >
            {sqTickerOptions(symbolList).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS} style={{ color: V2.green }}>
            {SQ_TEXT.labelExpiry}
          </span>
          {/* E53 — expiry strings render RAW; only the ALL option's label differs
              from its value. Pure client filter, no refetch. */}
          <select
            aria-label={SQ_TEXT.labelExpiry}
            className={SELECT_CLASS}
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          >
            {sqExpiryOptions(expiries).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS} style={{ color: V2.green }}>
            {SQ_TEXT.labelLimit}
          </span>
          {/* E55 — a client-side slice applied AFTER the sort, so it is a true
              top-N. No refetch. */}
          <select
            aria-label={SQ_TEXT.labelLimit}
            className={SELECT_CLASS}
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {SQ_LIMIT_OPTIONS.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {/* E56 — a literal pipe glyph, not a rule element. v2's divider is
            `HOME_THEME.border` rgba(255,255,255,.10), NOT `--color-line`, which
            is an opaque slate #23272e. */}
        <span className="self-center text-xs" style={{ color: V2W.border }}>
          {SQ_TEXT.divider}
        </span>

        {/* E57–E60. The tooltip is v2's verbatim and it NAMES GEX; `sqDirPass`
            tests the active sort column instead, so on Strike or Delta Abs
            "Negative" is structurally empty and the empty-state row (E113/E114)
            gives no hint why. See the BUG note on `sqDirPass`. */}
        {/* The active Positive / Negative buttons carry a PER-OPTION colour in
            v2 — #8ECAE6 and #EF4444 — which the primitive's shared cyan active
            state cannot express. `activeColor` is the optional prop added for
            exactly this (COLOR-REMAP decision 6, 2026-09-03); every other caller
            omits it and renders unchanged. `All` omits it too and keeps the
            primitive's default. Positive takes `V2.up` #1FD98A rather than the
            chrome #8ECAE6: it is one half of an up/down pair, so it belongs to
            the positive leg of the split, exactly like the Δ cells it filters. */}
        <SegGroup<SqDirFilter>
          options={SQ_DIR_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
            activeColor: o.value === 'pos' ? V2.up : o.value === 'neg' ? V2.red : undefined,
          }))}
          value={dir}
          onChange={setDir}
          title={SQ_TEXT.dirTooltip}
        />

        {/* E61–E63. Lowercase `min`, uppercase `OTM`, and NOT uppercased by CSS
            unlike the three dropdown labels above. */}
        <label className="flex items-center gap-1.5 text-xs" style={{ color: V2.orange }} title={SQ_TEXT.minOtmTooltip}>
          {SQ_TEXT.labelMinOtm}
          <select
            aria-label={SQ_TEXT.labelMinOtm}
            className={SELECT_CLASS}
            value={String(minOtm)}
            onChange={(e) => setMinOtm(Number(e.target.value))}
          >
            {SQ_MIN_OTM_OPTIONS.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {/* E64 — never disabled while loading, exactly as v2 leaves it. `force`
            bypasses `query()`'s stale window, because a button labelled Refresh
            that returns a cached body is a lie. */}
        <button
          type="button"
          onClick={() => void load(true)}
          className="rounded-sm border border-line px-2 py-1 text-xs text-muted"
        >
          {SQ_TEXT.refresh}
        </button>

        {/* E65 — static, all lowercase, never hides. */}
        <span className="self-center text-xs" style={{ color: alpha(T.text, 0.35) }}>
          {SQ_TEXT.sortHint}
        </span>
      </div>

      {/* E112 — no `!loading` guard in v2, so it stays up through the next fetch
          until that fetch clears it. Raw message, no wrapper text and no plate. */}
      {err && (
        <div className="mb-3 text-xs" style={{ color: SQ_ERROR_COLOR }}>
          {err}
        </div>
      )}

      {/* ── Top 10 cards (E72–E85) ─────────────────────────────────────────────
          STRUCTURAL TRAP, flagged in step 1 and reproduced here on purpose:
          the `All` / `All − Indices` toggle lives inside THIS block's header, yet
          `cardScope` is part of `SqFilters` and therefore filters the TABLE as
          well (E33) — and the whole block is gated on `topCards.length > 0`, so
          the moment the toggle empties the view the header holding the toggle
          unmounts with it and the control cannot be used to undo what it just
          did (E72, E114). v2's behaviour, ported as written. The fix, when it is
          taken, is to move the scope control into the toolbar above, which is
          always mounted — see the note on `sqTopCards`. */}
      {topCards.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            {/* E74 — the middle segment is the ACTIVE sort column's label. */}
            <span className="text-sm uppercase tracking-wide" style={{ color: V2.green }}>
              {sqTopCardsHeader(sort.col)}
            </span>
            {/* E75/E76 — `All − Indices` uses U+2212, and excludes SQ_INDICES's
                five symbols while the header above names SQ_CAP_ONE's three. */}
            <SegGroup<SqCardScope>
              options={SQ_CARD_SCOPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              value={cardScope}
              onChange={setCardScope}
            />
          </div>

          {/* E77 — fixed five columns, no auto-fit and no media query. */}
          <div className="grid grid-cols-5 gap-2.5">
            {topCards.map((r, i) => (
              <div
                key={sqRowKey(r, i)}
                className="rounded-md border border-line px-3 py-2.5"
                style={{ background: sqCardBackground(i) }}
              >
                <div className="flex items-baseline justify-between">
                  {/* E80 — never null; the client re-stamps `symbol` (E18). */}
                  <span className="text-sm font-bold text-fg">{r.symbol}</span>
                  {/* E81 */}
                  <span className="text-xs" style={{ color: alpha(T.text, 0.4) }}>
                    {sqCardRankText(i)}
                  </span>
                </div>
                {/* E82/E83 — a raw `$` on the raw number, then the raw expiry. */}
                <div className="my-0.5 text-xs font-bold" style={{ color: V2.cyan }}>
                  {sqCardStrikeText(r)}{' '}
                  <span className="font-normal" style={{ color: alpha(T.text, 0.4) }}>
                    {r.expiry}
                  </span>
                </div>
                {/* E84 — a null chg reaches this through `sqVal`'s null→0, so it
                    prints "+0" in the UP colour here and an em dash in the table
                    cell for the same field of the same row. See SQ_NULL_CHG_RENDER. */}
                <div className="text-xs font-bold tabular" style={{ color: sqCardMetricColor(r, sort.col) }}>
                  {sqCardMetricText(r, sort.col)}
                </div>
                {/* E85 */}
                <div className="text-xs uppercase" style={{ color: alpha(T.text, 0.4) }}>
                  {sqColLabel(sort.col)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── The table (E86–E115) ───────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {/* E86/E87 — omitted entirely when a single ticker / expiry is
                  selected, which is what makes the empty row's colSpan vary. */}
              {showSymbol && (
                <th className={`${TH_STATIC_CLASS} text-left`} style={{ color: V2.green }}>
                  {SQ_FIXED_HEADERS.symbol}
                </th>
              )}
              {showExpiry && (
                <th className={`${TH_STATIC_CLASS} text-left`} style={{ color: V2.green }}>
                  {SQ_FIXED_HEADERS.expiry}
                </th>
              )}
              {/* E88 — NOT sortable: no click target, no arrow, no cursor change,
                  and the sort hint above does not say so. */}
              <th className={`${TH_STATIC_CLASS} text-right`} style={{ color: V2.green }}>
                {SQ_FIXED_HEADERS.otm}
              </th>
              {/* E89–E97 — the six sortable columns, in SQ_COLUMNS order. */}
              {SQ_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => setSort((p) => sqToggleSort(p, c.key))}
                  className={`${TH_CLASS} text-right`}
                  style={{ color: sqHeaderColor(c.key, sort) }}
                >
                  {c.label}
                  {/* E96 — three states, each with a leading space; the inactive
                      glyph is dimmed rather than hidden. */}
                  <span style={{ opacity: sort.col === c.key ? 1 : 0.4 }}>{sqSortArrow(c.key, sort)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r, i) => (
              <tr key={sqRowKey(r, i)} style={{ background: sqRowBackground(i) }}>
                {/* E100 — never coloured by anything. */}
                {showSymbol && <td className={`${TD_CLASS} text-left font-bold`}>{r.symbol}</td>}
                {/* E101 — dimmer than every other cell, raw API string. */}
                {showExpiry && (
                  <td className={`${TD_CLASS} text-left`} style={{ color: alpha(T.text, 0.7) }}>
                    {r.expiry}
                  </td>
                )}
                {/* E102/E103 — one decimal, and orange past a HARDCODED 5% that is
                    independent of the min-OTM filter: at min OTM 10% the whole
                    column is orange. A row with no usable spot has distance 0, so
                    its em dash is painted dim and never orange. */}
                <td className={`${TD_CLASS} text-right`} style={{ color: sqOtmColor(r) }}>
                  {sqOtmText(r)}
                </td>
                {SQ_COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className={`${TD_CLASS} text-right${c.key === 'strike' ? ' font-bold' : ''}`}
                    style={{ color: sqCellColor(r, c) }}
                  >
                    {sqCellText(r, c)}
                  </td>
                ))}
              </tr>
            ))}
            {/* E113/E114/E115 — the header above stays up through the first fetch
                and through every empty result, and this one sentence covers all
                four causes (no data, expiry filter, min OTM, or a structurally
                empty direction filter) with no reset affordance. */}
            {!displayRows.length && !loading && !err && (
              <tr>
                <td
                  colSpan={sqEmptyColSpan(showSymbol, showExpiry)}
                  className="px-2 py-6 text-center text-sm"
                  style={{ color: alpha(T.text, 0.4) }}
                >
                  {SQ_TEXT.emptyRows}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
