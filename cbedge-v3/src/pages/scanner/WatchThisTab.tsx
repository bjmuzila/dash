// ─────────────────────────────────────────────────────────────────────────────
// WATCH THIS — FAR CB. The render layer for /scanner?tab=watch.
//
// Spec: docs/parity/scanner.md Part H, rows H1–H220. Every threshold,
// comparator, label string, colour ladder, empty-state sentence and both polls
// already live in `watchThis.ts`, `watchThisChart.ts` and `watchThisData.ts`.
// This file wires them to the screen and decides nothing.
//
// FOUR SURFACES, ONE CARD. In render order: the flag-card grid (H27–H45), the
// flat twelve-column outcomes table (H77–H95), the `ResultsByDay` day view
// (H104–H130) and the `OutcomeDetailPanel` (H131–H180) that expands under a row
// of EITHER table — one instance, built once, handed to both call sites, so
// only one detail is ever open across the whole tab.
//
// SEVEN THINGS ABOUT THIS FILE THAT ARE NOT OBVIOUS FROM READING IT IN ORDER
//
//   1. ALL FOUR READS ARE `useQuery`, NOT THE LOADERS. `watchThisData.ts`
//      exports promise-shaped loaders AND `useQuery`-shaped adapters (its § 11);
//      this file takes the second set. It has to: `pollMs` is the only way the
//      two polls can exist without the `setInterval` pairs "Do not port" H214
//      removed, and passing `null` as the detail URL is v2's `detailReq` race
//      counter (H202) expressed as data rather than as a ref.
//
//   2. THE LAST GOOD ROWS ARE HELD IN A REF, ON PURPOSE. v2 leaves the previous
//      rows on screen through every failure of the flag feed (H195) and of the
//      outcomes feed (H95/H198) — it throws or no-ops BEFORE `setRows`. Under
//      `useQuery` an `ok:false` body still arrives as `data`, so accepting it
//      blindly would empty a grid v2 leaves standing. `keptFlags` / `keptRows`
//      are that "do not apply this body" rule, and `watchRowsFromQuery` /
//      `outcomesRowsFromQuery` are what say which bodies count.
//
//   3. NULLS SINK IN BOTH SORT DIRECTIONS AND THERE IS NO TIE-BREAK. Both are
//      `sortOutcomes`' and both are deliberate (see its doc comment). Nothing
//      here adds a secondary key; the order under equal values is the server's
//      own `first_flagged DESC`, via sort stability.
//
//   4. THE SORT HEADER HAS THREE GLYPHS, NOT TWO. Inactive is U+25BE "▾" at a
//      quarter opacity; active-ascending is U+25B2 "▲"; active-descending is
//      U+25BC "▼" — a DIFFERENT character from the inactive one (H74).
//      `sortGlyph` picks; `sortHeaderInk` inks; an inactive header sets no
//      colour of its own and follows the header row.
//
//   5. `ProbeChart` IS AN INLINE `<svg>`, NOT A CANVAS. So non-negotiable 7 —
//      `data-cb-layer` on every canvas — has nothing to attach to: there is no
//      canvas anywhere in Part H (the only one v2 had lived inside the PNG
//      capture, which is not ported). Non-negotiable 6 DOES apply and v2 fails
//      it outright, so the SVG carries its own `data-visible` gate; see
//      `useProbeVisibility`.
//
//   6. NONE OF THE FOUR TABLES USES `design/primitives/Table`. That primitive
//      early-returns its `empty` node INSTEAD of the table, which drops the
//      header row — and H94 (an empty row spanning 12 columns UNDER the twelve
//      headers), H93/H113/H130 (an expanded detail row spanning them) and the
//      Results view's nested tables all need a header above a spanned cell.
//      Every class below is the primitive's own vocabulary so the four still
//      read as one table.
//
//   7. THE TAB READS NO URL PARAM AND WRITES NONE. `?tab=watch` belongs to the
//      page shell (H3); `?embed=1` and its `target="_top"` links (H41) are on
//      the "Do not port" list as GexDock chrome (H217), so `chainHref` is a
//      plain link here. Nothing is persisted — every remount is a cold start
//      (H206).
//
// ── THE v2 BUGS THIS FILE RENDERS RATHER THAN FIXES ──────────────────────────
// `volGexColor` paints a NULL vol-GEX as positive beside an em dash (H39).
// `touchedColor` paints a malformed touch date light blue beside an em dash
// (H88). `probeTone`'s colour boundary is `> 0` while its glyph boundary is
// `>= 0`, so an exact zero prints "▲ 0.0%" in body text (H138). The chart
// tooltip's border is up-toned whatever the sign of the hovered P/L (H176). The
// footer prints ">15%" from the client fallback while the subtitle drops its
// threshold clause entirely, both visible at once, when the endpoint omits
// `threshold` (H9/H44). All four sub-tables' headers were "positive green" in
// v2 and are chrome ink here — see `TABLE_HEADER_INK`.
//
// ── THE ONE PLACE THIS FILE CLOSES A v2 GAP ──────────────────────────────────
// `+ Add` is `disabled` mid-POST but v2's Enter handler is not, so Enter can
// double-post (H15, H220). `canAddTicker` — which already exists in
// `watchThis.ts` and says both call sites must go through it — guards BOTH here.
// That is the render layer honouring a guard the logic module wrote, not a new
// decision taken at the keyboard.
// ─────────────────────────────────────────────────────────────────────────────

import type { MouseEvent, ReactNode, RefObject } from 'react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@/data/api'
import { Card } from '@/design/primitives/Card'
import { SegGroup } from '@/design/primitives/Controls'
import { SHADOW, T, V2, V2W, alpha } from '@/design/theme'
import {
  ADD_BUSY_LABEL,
  ADD_LABEL,
  ADD_MAX_LENGTH,
  ADD_PLACEHOLDER,
  CARD_TITLE,
  CHART_NOT_ENOUGH_HISTORY,
  DAY_COLSPAN,
  DAY_COLUMNS,
  DAY_DISCLOSURE_CLOSED,
  DAY_DISCLOSURE_OPEN,
  DAY_ROW_TITLE,
  DEFAULT_OUTCOME_VIEW,
  DETAIL_ARROW,
  DETAIL_CLOSE_GLYPH,
  DETAIL_DAY_COLUMNS,
  DETAIL_LABEL_HIGH,
  DETAIL_LABEL_IN,
  DETAIL_LABEL_NOW,
  DETAIL_LOADING,
  DETAIL_NO_BARS,
  DETAIL_SUBLINE_LOADING,
  DETAIL_TICKER_PLACEHOLDER,
  EMPTY_FLAG_GRID,
  EMPTY_TRACKED,
  FOOTER_BASIS,
  LABEL_OI_VOL,
  LABEL_VOL,
  OUTCOME_COLSPAN,
  OUTCOME_COLUMNS,
  OUTCOME_VIEWS,
  REFRESH_LABEL,
  REFRESH_NOTE,
  RESULTS_LOADING,
  RESULT_SECTIONS,
  SECTION_COLSPAN,
  SECTION_COLUMNS,
  SECTION_NONE,
  TABLE_HEADER_INK,
  TRACKED_RESULTS_TITLE,
  VIEW_CHAIN_LABEL,
  WATCH_THIS_BADGE,
  addSuccessMessage,
  badgeColor,
  canAddTicker,
  chainHref,
  chartFooter,
  closestColor,
  countColor,
  dayDateColor,
  dayRowKey,
  defaultOutcomeSort,
  deltaColor,
  detailStatusLabel,
  detailSubline,
  directionColor,
  entryTitle,
  flagCardSentence,
  flagErrorText,
  flatRowKey,
  fmtClosest,
  fmtContractClose,
  fmtContractDollarChg,
  fmtContractPctChg,
  fmtDetailDate,
  fmtDetailSpot,
  fmtEntry,
  fmtExpiryDte,
  fmtFlaggedSpot,
  fmtHigh,
  fmtMaxPct,
  fmtOiVolGex,
  fmtOtmAtFlag,
  fmtProbeDollars,
  fmtProbePct,
  fmtSectionStatus,
  fmtSpot,
  fmtSpotPctChg,
  fmtStatusWord,
  fmtStrike,
  fmtTouchedCell,
  fmtVolGex,
  footerFlagged,
  groupOutcomesByDay,
  highColor,
  isCallSide,
  maxPctColor,
  nextOutcomeSort,
  normaliseTickerInput,
  outcomeViewLabel,
  probeBadge,
  probeChartId,
  probeHint,
  probePx,
  probeStats,
  probeTone,
  rowTitle,
  sectionHeading,
  sideColor,
  sortGlyph,
  sortHeaderInk,
  sortOutcomes,
  sortTitle,
  statusChipColor,
  statusColor,
  touchedColor,
  trackedHint,
  volGexColor,
  watchRowKey,
  watchSubtitle,
} from '@/pages/scanner/watchThis'
import type {
  ColAlign,
  DayBucket,
  OutcomeColumn,
  OutcomeDetail,
  OutcomeDetailDay,
  OutcomeRow,
  OutcomeSort,
  OutcomeSortKey,
  OutcomeView,
  PlainColumn,
  WatchRow,
} from '@/pages/scanner/watchThis'
import {
  PROBE_CHART_ARIA_LABEL,
  PROBE_CHART_DASH,
  PROBE_CHART_GLYPH,
  PROBE_CHART_INK,
  PROBE_CHART_RADIUS,
  PROBE_CHART_ROLE,
  PROBE_CHART_STROKE,
  PROBE_TOUCHED_OPACITY,
  PROBE_WASH_STOPS,
  buildProbeGeometry,
  probeHover,
  probeHoverIndex,
} from '@/pages/scanner/watchThisChart'
import {
  DETAIL_STALE_MS,
  NO_STORE_STALE_MS,
  OUTCOMES_POLL_MS,
  WATCH_POLL_MS,
  addFarCbTicker,
  detailErrorFromQuery,
  detailFromQuery,
  detailUrlFor,
  errText,
  farCbOutcomesUrl,
  farCbResultsUrl,
  farCbWatchUrl,
  outcomesRowsFromQuery,
  resultsErrorFromQuery,
  resultsRowsFromQuery,
  watchErrorFromQuery,
  watchRowsFromQuery,
} from '@/pages/scanner/watchThisData'
import type {
  DetailResponse,
  OutcomesResponse,
  WatchLoad,
  WatchResponse,
} from '@/pages/scanner/watchThisData'

// ─────────────────────────────────────────────────────────────────────────────
// SHARED CHROME
//
// The class strings are `design/primitives/Table`'s own, copied rather than
// imported because the primitive exports a component and not its vocabulary —
// see note 6 in the file header for why the tables are hand-rolled at all.
// ─────────────────────────────────────────────────────────────────────────────

const ALIGN_CLASS: Record<ColAlign, string> = { left: 'text-left', right: 'text-right' }

const TH_CLASS =
  'whitespace-nowrap border-b border-line px-2 py-1.5 text-xs font-bold uppercase tracking-wide'
/** H72 — every one of the twelve flat-table headers is a click target. */
const TH_SORT_CLASS = `${TH_CLASS} cursor-pointer select-none`
const TD_CLASS = 'border-b border-line/50 px-2 py-1'

/** H90, H112, H129 — odd rows washed, even rows bare. */
const ROW_WASH = alpha(T.text, 0.02)
/**
 * H90, H112, H129 — the open row overrides the stripe in all three tables.
 * v2's rgba(33,158,188,0.10); `V2W.pickRow` is that exact wash, already named.
 */
const ROW_OPEN = V2W.pickRow
/**
 * H93, H113, H130 — the expanded row's cell.
 *
 * v2 uses `rgba(0,0,0,0.20)` in the flat table and `rgba(0,0,0,0.25)` in the
 * Results sub-table for no stated reason; the spec's "Two blacks" note asks for
 * one value. This is it — a TREATMENT collapse, not a palette one, so it stands
 * unchanged through the palette reversal. `SHADOW` is #000000, exactly v2's.
 */
const ROW_EXPANDED = alpha(SHADOW, 0.2)

/** H108–H110, H120 — a zero count, and the sections' "None". */
const DIM_INK = alpha(T.text, 0.35)
/** H111 — the day table's disclosure column. */
const DISCLOSURE_INK = alpha(T.text, 0.45)
/** H132–H153 — `PROBE_MUTED`, the detail panel's secondary ink. */
const PANEL_MUTED = alpha(T.text, 0.62)

function rowBackground(i: number, isOpen: boolean): string {
  return isOpen ? ROW_OPEN : i % 2 ? ROW_WASH : 'transparent'
}

/** A plain, non-clickable header row. H.10b, H.10d and H.11a all use one. */
function PlainHeadRow({ columns }: { columns: readonly PlainColumn[] }) {
  return (
    <tr style={{ color: TABLE_HEADER_INK }}>
      {columns.map((c, i) => (
        // The day table's fifth column has no label (H111), so the label cannot
        // be the key.
        <th key={`${c.label}-${i}`} className={`${TH_CLASS} ${ALIGN_CLASS[c.align]}`}>
          {c.label}
        </th>
      ))}
    </tr>
  )
}

/** H72–H75 — one of the twelve sortable headers. */
function SortHeader({
  col,
  sort,
  onSort,
}: {
  col: OutcomeColumn
  sort: OutcomeSort
  onSort: (key: OutcomeSortKey) => void
}) {
  const active = sort.key === col.key
  return (
    <th
      onClick={() => onSort(col.key)}
      title={sortTitle(col.label)}
      className={`${TH_SORT_CLASS} ${ALIGN_CLASS[col.align]}`}
      style={{ color: sortHeaderInk(active) }}
    >
      {col.label}
      {/* H74 — three distinct glyphs; the inactive one is dimmed, not hidden. */}
      <span className="ml-1" style={{ opacity: active ? 1 : 0.25 }}>
        {sortGlyph(active, sort.dir)}
      </span>
    </th>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FLAG CARD (H27–H41)
// ─────────────────────────────────────────────────────────────────────────────

function FlagCard({ row }: { row: WatchRow }) {
  // H29 — `gex_value >= 0`, inclusive, so an exact zero reads as call-side. One
  // boolean drives four inks and the "Call-side"/"Put-side" word in H35.
  const ink = directionColor(isCallSide(row))
  return (
    <div className="rounded-md bg-surface2 px-4 py-3.5">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-bold" style={{ color: ink }}>
            {row.symbol}
          </span>
          {/* H31 — not null-guarded; a null spot throws, as in v2. */}
          <span className="text-sm font-bold" style={{ color: ink, opacity: 0.85 }}>
            {fmtSpot(row.spot)}
          </span>
        </span>
        {/* H32 — a label, not a state: always this colour, on every card. v2's
            LIGHT_BLUE #7dd3fc → `V2.accent`. */}
        <span className="text-sm font-bold tracking-wide" style={{ color: V2.accent }}>
          {WATCH_THIS_BADGE}
        </span>
      </div>

      {/* H33 — raw number, no toFixed. H34 — the server's expiry string verbatim. */}
      <div className="mb-1 text-sm font-bold" style={{ color: V2.accent }}>
        {fmtStrike(row.strike)}
        <span className="font-normal text-fg">{fmtExpiryDte(row.expiry, row.dte_days)}</span>
      </div>

      <div className="mb-2 text-sm leading-normal text-fg">{flagCardSentence(row)}</div>

      <div className="flex items-center justify-between">
        <span className="flex items-baseline gap-3">
          {/* H36/H37 — the sign is always explicit and this field is never an em dash. */}
          <span className="text-sm font-bold" style={{ color: ink }}>
            <span className="font-semibold text-fg opacity-60">{LABEL_OI_VOL}</span>
            {fmtOiVolGex(row)}
          </span>
          {/* H38/H39 — BUG (v2), reproduced: the colour tests `?? 0` while the
              text tests `!= null`, so a NULL vol-GEX is painted UP next to a "—". */}
          <span className="text-sm font-bold" style={{ color: volGexColor(row) }}>
            <span className="font-semibold text-fg opacity-60">{LABEL_VOL}</span>
            {fmtVolGex(row)}
          </span>
        </span>
        {/* H40 — `strike` is deliberately not encodeURIComponent'd; see chainHref.
            H41's `?embed=1` / target="_top" is not ported (H217). */}
        <a
          href={chainHref(row)}
          className="text-sm font-bold no-underline"
          style={{ color: V2.accent }}
        >
          {VIEW_CHAIN_LABEL}
        </a>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE CHART (H160–H180)
//
// Inline SVG, hand-rolled, because it renders inside a table cell that is
// already inside two other tables and a `viewBox` scales without measuring
// anything. Every coordinate, path, label and ink below comes out of
// `buildProbeGeometry` / `probeHover`; this component adds no arithmetic.
//
// `data-cb-layer` DOES NOT APPLY — that rule governs canvases and there is no
// canvas here. Non-negotiable 6 does apply, and v2 has no guard of any kind
// (H175, H214): `useProbeVisibility` is it.
// ─────────────────────────────────────────────────────────────────────────────

/** Matches ChartFrame's own generosity — paint just before it scrolls into view. */
const PROBE_ROOT_MARGIN = '200px'

/**
 * The visibility gate `ProbeChart` needs and `ChartFrame` cannot give it.
 *
 * `ChartFrame` hands a bare div to an IMPERATIVE renderer; this chart is
 * declarative React markup, so there is nothing to mount into it. What the
 * frame actually provides — an IntersectionObserver plus the tab's own
 * visibility, published as `data-visible` — is reproduced here on the `<svg>`
 * itself, which is the third of the three sanctioned signals and the one a
 * declarative chart can carry.
 *
 * It gates the ONE thing this chart does that is not markup: recomputing the
 * hover crosshair, dot and tooltip on every pointer move. A hidden tab cannot
 * deliver a mousemove, so in practice the observer half is what earns its keep —
 * a chart scrolled out of a long Results day still stops recomputing.
 */
function useProbeVisibility(ref: RefObject<SVGSVGElement | null>, mounted: boolean) {
  const visible = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let onScreen = true
    let tabAwake = !document.hidden
    const publish = () => {
      const now = onScreen && tabAwake
      visible.current = now
      el.dataset.visible = now ? '1' : '0'
    }
    publish()
    const io = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1]
        if (!last) return
        onScreen = last.isIntersecting
        publish()
      },
      { rootMargin: PROBE_ROOT_MARGIN },
    )
    io.observe(el)
    const onTabChange = () => {
      tabAwake = !document.hidden
      publish()
    }
    document.addEventListener('visibilitychange', onTabChange)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onTabChange)
    }
  }, [ref, mounted])
  return visible
}

function ProbeChart({
  days,
  touchedDate,
  chartId,
}: {
  days: OutcomeDetailDay[]
  touchedDate: string | null
  chartId: string
}) {
  const geometry = useMemo(
    () => buildProbeGeometry(days, touchedDate, chartId),
    [days, touchedDate, chartId],
  )
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const visible = useProbeVisibility(svgRef, geometry != null)

  const onMove = useCallback(
    (e: MouseEvent<SVGSVGElement>) => {
      if (!geometry || !visible.current) return
      const box = e.currentTarget.getBoundingClientRect()
      setHoverIndex(probeHoverIndex(geometry, e.clientX, { left: box.left, width: box.width }))
    },
    [geometry, visible],
  )

  // H161 — fewer than two PRICED days is a message instead of a chart. A single
  // priced day still lands here.
  if (!geometry) {
    return (
      <div className="mb-3.5 py-8 text-center font-mono text-sm opacity-50" style={{ color: T.text }}>
        {CHART_NOT_ENOUGH_HISTORY}
      </div>
    )
  }

  const hover = probeHover(geometry, hoverIndex)

  return (
    <div>
      <svg
        ref={svgRef}
        id={geometry.id}
        viewBox={geometry.viewBox}
        role={PROBE_CHART_ROLE}
        aria-label={PROBE_CHART_ARIA_LABEL}
        className="block h-auto w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {/* H162 — the wash, seeded off the chart id so `url(#…)` cannot collide
            with the SVG's own id. */}
        <defs>
          <linearGradient id={geometry.washId} x1="0" y1="0" x2="0" y2="1">
            {PROBE_WASH_STOPS.map((s) => (
              <stop
                key={s.offset}
                offset={s.offset}
                stopColor={PROBE_CHART_INK.line}
                stopOpacity={s.opacity}
              />
            ))}
          </linearGradient>
        </defs>

        {/* H165 — three gridlines at the DATA high, midpoint and low, with the
            price rail on the right. They span exactly the plot width, which the
            geometry already publishes as the break-even line's span. When every
            close is equal all three stack on one y — v2's behaviour, unguarded. */}
        {geometry.gridlines.map((gl, i) => (
          <g key={i}>
            <line
              x1={geometry.entry.x1}
              y1={gl.y}
              x2={geometry.entry.x2}
              y2={gl.y}
              stroke={PROBE_CHART_INK.gridline}
              strokeWidth={PROBE_CHART_STROKE.grid}
            />
            <text
              x={gl.labelX}
              y={gl.labelY}
              fontSize={PROBE_CHART_GLYPH.railLabel}
              fill={PROBE_CHART_INK.text}
              className="font-mono"
            >
              {gl.label}
            </text>
          </g>
        ))}

        {/* H166 — the wash, under everything. A lone traded day has no area. */}
        {geometry.segments.map((s, i) => (
          <path key={`a${i}`} d={s.area} fill={`url(#${geometry.washId})`} />
        ))}

        {/* H168 — drawn only on an EXACT date match against the day series. */}
        {geometry.touched && (
          <>
            <line
              x1={geometry.touched.x}
              x2={geometry.touched.x}
              y1={geometry.touched.y1}
              y2={geometry.touched.y2}
              stroke={PROBE_CHART_INK.touched}
              strokeWidth={PROBE_CHART_STROKE.touched}
              strokeDasharray={PROBE_CHART_DASH.touched}
              opacity={PROBE_TOUCHED_OPACITY}
            />
            <text
              x={geometry.touched.labelX}
              y={geometry.touched.labelY}
              fontSize={PROBE_CHART_GLYPH.marker}
              fill={PROBE_CHART_INK.touched}
              letterSpacing="1"
              className="font-mono"
            >
              {geometry.touched.label}
            </text>
          </>
        )}

        {/* H169 — the break-even. The FIRST PRICED close, not `opt_entry`; see
            the "two entries" note at the top of watchThis.ts. */}
        <line
          x1={geometry.entry.x1}
          y1={geometry.entry.y}
          x2={geometry.entry.x2}
          y2={geometry.entry.y}
          stroke={PROBE_CHART_INK.entryLine}
          strokeWidth={PROBE_CHART_STROKE.entry}
          strokeDasharray={PROBE_CHART_DASH.entry}
        />
        <text
          x={geometry.entry.labelX}
          y={geometry.entry.labelY}
          fontSize={PROBE_CHART_GLYPH.marker}
          fill={PROBE_CHART_INK.text}
          letterSpacing="1"
          className="font-mono"
        >
          {geometry.entry.label}
        </text>

        {/* H167 — one path per unbroken run: the line BREAKS at a no-trade day
            rather than drawing across a gap that never happened. */}
        {geometry.segments.map((s, i) => (
          <path
            key={`l${i}`}
            d={s.line}
            fill="none"
            stroke={PROBE_CHART_INK.line}
            strokeWidth={PROBE_CHART_STROKE.line}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* H170/H171 — first occurrence when an extreme repeats. */}
        <circle
          cx={geometry.high.x}
          cy={geometry.high.y}
          r={PROBE_CHART_RADIUS.extremeMarker}
          fill="none"
          stroke={PROBE_CHART_INK.high}
          strokeWidth={PROBE_CHART_STROKE.extremeMarker}
        />
        <text
          x={geometry.high.labelX}
          y={geometry.high.labelY}
          fontSize={PROBE_CHART_GLYPH.extreme}
          fill={PROBE_CHART_INK.high}
          textAnchor="middle"
          className="font-mono"
        >
          {geometry.high.label}
        </text>
        <circle
          cx={geometry.low.x}
          cy={geometry.low.y}
          r={PROBE_CHART_RADIUS.extremeMarker}
          fill="none"
          stroke={PROBE_CHART_INK.low}
          strokeWidth={PROBE_CHART_STROKE.extremeMarker}
        />
        <text
          x={geometry.low.labelX}
          y={geometry.low.labelY}
          fontSize={PROBE_CHART_GLYPH.extreme}
          fill={PROBE_CHART_INK.low}
          textAnchor="middle"
          className="font-mono"
        >
          {geometry.low.label}
        </text>

        {/* H172 — two end labels only, no intermediate ticks. */}
        <text
          x={geometry.axis.leftX}
          y={geometry.axis.y}
          fontSize={PROBE_CHART_GLYPH.axis}
          fill={PROBE_CHART_INK.text}
          className="font-mono"
        >
          {geometry.axis.leftLabel}
        </text>
        <text
          x={geometry.axis.rightX}
          y={geometry.axis.y}
          fontSize={PROBE_CHART_GLYPH.axis}
          fill={PROBE_CHART_INK.text}
          textAnchor="end"
          className="font-mono"
        >
          {geometry.axis.rightLabel}
        </text>

        {/* H173 — dot, pill and ink. `last >= entry` is INCLUSIVE, so exactly
            flat reads as up. The pill ink stays dark on a filled chip. */}
        <circle
          cx={geometry.last.x}
          cy={geometry.last.y}
          r={PROBE_CHART_RADIUS.lastDot}
          fill={geometry.last.fill}
        />
        <rect
          x={geometry.last.pill.x}
          y={geometry.last.pill.y}
          width={geometry.last.pill.w}
          height={geometry.last.pill.h}
          rx={geometry.last.pill.rx}
          fill={geometry.last.fill}
        />
        <text
          x={geometry.last.textX}
          y={geometry.last.textY}
          fontSize={PROBE_CHART_GLYPH.pill}
          fontWeight={700}
          fill={PROBE_CHART_INK.pillInk}
          textAnchor="middle"
          className="font-mono"
        >
          {geometry.last.text}
        </text>

        {/* H174–H179 — the hover snaps to the nearest day that actually TRADED,
            never to an empty slot, and the tooltip flips left near the rail. */}
        {hover && (
          <g>
            <line
              x1={hover.x}
              y1={hover.crosshair.y1}
              x2={hover.x}
              y2={hover.crosshair.y2}
              stroke={PROBE_CHART_INK.crosshair}
              strokeWidth={PROBE_CHART_STROKE.crosshair}
              strokeDasharray={PROBE_CHART_DASH.crosshair}
            />
            <circle
              cx={hover.dot.x}
              cy={hover.dot.y}
              r={PROBE_CHART_RADIUS.hoverDot}
              fill={PROBE_CHART_INK.hoverDotFill}
              stroke={PROBE_CHART_INK.line}
              strokeWidth={PROBE_CHART_STROKE.hoverDot}
            />
            <g transform={`translate(${hover.tip.x},${hover.tip.y})`}>
              {/* H176 — BUG (v2), reproduced: this border is UP-TONED whatever
                  the sign of the P/L below it, so a losing day reads inside a
                  green box. Part H open question 7. */}
              <rect
                width={hover.tip.w}
                height={hover.tip.h}
                rx={hover.tip.rx}
                fill={PROBE_CHART_INK.tooltipFill}
                stroke={PROBE_CHART_INK.tooltipBorder}
                strokeWidth={PROBE_CHART_STROKE.tooltip}
              />
              {/* H177 — the RAW date, not run through the axis formatter. */}
              <text
                x={hover.dateX}
                y={hover.dateY}
                fontSize={PROBE_CHART_GLYPH.tipDate}
                fill={PROBE_CHART_INK.text}
                letterSpacing="1"
                className="font-mono"
              >
                {hover.dateText}
              </text>
              <text
                x={hover.priceX}
                y={hover.priceY}
                fontSize={PROBE_CHART_GLYPH.tipPrice}
                fontWeight={700}
                fill={PROBE_CHART_INK.text}
                className="font-mono"
              >
                {hover.priceText}
              </text>
              {/* H179 — per SINGLE contract, U+2212 minus, zero decimals. */}
              <text
                x={hover.plX}
                y={hover.plY}
                fontSize={PROBE_CHART_GLYPH.tipPl}
                fontWeight={700}
                fill={hover.plInk}
                className="font-mono"
              >
                {hover.plText}
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DETAIL PANEL (H131–H159)
// ─────────────────────────────────────────────────────────────────────────────

/** H133/H134 — the two chips. One shape, two colour sources. */
function DetailChip({ ink, children }: { ink: string; children: ReactNode }) {
  return (
    <span
      className="ml-1.5 rounded-sm border px-1.5 py-px font-mono text-xs font-bold"
      style={{ color: ink, borderColor: alpha(ink, 0.45), background: alpha(ink, 0.12) }}
    >
      {children}
    </span>
  )
}

/** H140/H142/H144 — the `IN` / `HIGH` / `NOW` label, upper-cased by style. */
function DetailLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="mr-0.5 text-2xs uppercase tracking-wide"
      style={{ color: PANEL_MUTED }}
    >
      {children}
    </span>
  )
}

function OutcomeDetailPanel({
  detail,
  loading,
  err,
  onClose,
}: {
  detail: OutcomeDetail | null
  loading: boolean
  err: string | null
  onClose: () => void
}) {
  // H139 — `entry` is the first PRICED close, `mark` is the PEAK, and the
  // headline runs between them. `last` trails as a muted "now".
  const stats = detail ? probeStats(detail.days) : null
  const badge = detail ? probeBadge(detail.strike, detail.type) : ''
  // H148 — the SVG id and, through it, the wash gradient id. The third v2 use
  // (a getElementById handle for the PNG capture) is gone with the capture.
  const chartId = probeChartId(detail)
  const hint = detail ? probeHint(detail, stats) : ''
  const hasDays = !!detail && detail.days.length > 0

  return (
    // The plate is v2's PROBE_BG #05060a — this detail panel's own colour, not
    // the page canvas, which stays v3's. The edge is v2's cyan at 50%.
    <div
      className="my-1.5 max-w-[940px] rounded-md border p-3.5"
      style={{ background: V2.bg, borderColor: alpha(V2.cyan, 0.5) }}
    >
      {/* H132–H135 — ticker, badge, status chip, close. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center">
          <span className="font-mono text-lg font-bold" style={{ color: T.text }}>
            {detail ? detail.symbol : DETAIL_TICKER_PLACEHOLDER}
          </span>
          {detail && <DetailChip ink={badgeColor(detail.type)}>{badge}</DetailChip>}
          {detail && (
            // H134 — "Touched <date>" keeps MIXED case here, unlike the flat
            // table's cell which upper-cases everything.
            //
            // TWO GREENS, KEPT: in v2 this chip's OPEN is #30d158 while the
            // flat table's OPEN one row above is #8ECAE6 — same word, same
            // state, two greens on screen at once. Step 2 collapsed them; the
            // palette reversal (Brandon, 2026-09-03) puts them back, so
            // `statusChipColor` is no longer `statusColor`: this chip keeps the
            // probe chart's ES_CANDLE_UP #30d158 and the table word takes V2.up.
            <DetailChip ink={statusChipColor(detail.status)}>
              {detailStatusLabel(detail)}
            </DetailChip>
          )}
        </div>
        {/* H135 — stopPropagation is required; the parent <tr> would re-toggle. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="cursor-pointer border-none bg-transparent px-0.5 text-lg leading-none"
          style={{ color: T.text }}
        >
          {DETAIL_CLOSE_GLYPH}
        </button>
      </div>

      {/* H136 — spot at two decimals, OTM at zero. */}
      <div className="mt-1 font-mono text-xs" style={{ color: PANEL_MUTED }}>
        {detail ? detailSubline(detail) : DETAIL_SUBLINE_LOADING}
      </div>

      {/* H138–H144 — the headline block, omitted whole when no day carries a price. */}
      {stats && (
        <div className="my-2">
          {/* H138 — BUG (v2), reproduced: the GLYPH boundary is `>= 0` and the
              COLOUR boundary in `probeTone` is `> 0`, so an exact zero prints
              "▲ 0.0%" in body text — an up arrow with no up colour. */}
          <div
            className="font-mono text-xl font-bold leading-none"
            style={{ color: probeTone(stats.pct) }}
          >
            {fmtProbePct(stats.pct)}
          </div>
          <div className="mt-1.5 font-mono text-sm" style={{ color: T.text }}>
            <DetailLabel>{DETAIL_LABEL_IN}</DetailLabel>
            {probePx(stats.entry)}
            <span className="mx-1.5" style={{ color: PANEL_MUTED }}>
              {DETAIL_ARROW}
            </span>
            <DetailLabel>{DETAIL_LABEL_HIGH}</DetailLabel>
            {probePx(stats.mark)}
            {/* H143 — per SINGLE contract, U+2212 minus, zero decimals. */}
            <span className="font-bold" style={{ color: probeTone(stats.dollars) }}>
              {fmtProbeDollars(stats.dollars)}
            </span>
            <span className="ml-2.5" style={{ color: PANEL_MUTED }}>
              <DetailLabel>{DETAIL_LABEL_NOW}</DetailLabel>
              {probePx(stats.last)}
            </span>
          </div>
        </div>
      )}

      {/* H145 — the chart well. H146/H147's "⧉ Copy image" button is not ported
          (see the REMOVED block in watchThis.ts), so the well has no toolbar. */}
      <div className="mt-3.5 border-t border-line pt-3.5">
        {/* H150/H151/H152 — three INDEPENDENT blocks in v2's own order, not a
            ladder: a stale error and a fresh load can both be on screen. */}
        {loading && (
          <div className="py-10 text-center font-mono text-xs" style={{ color: PANEL_MUTED }}>
            {DETAIL_LOADING}
          </div>
        )}
        {err && (
          <div className="py-10 text-center font-mono text-xs" style={{ color: V2.orange }}>
            {err}
          </div>
        )}
        {detail && !hasDays && (
          <div className="py-10 text-center font-mono text-xs" style={{ color: PANEL_MUTED }}>
            {DETAIL_NO_BARS}
          </div>
        )}

        {detail && hasDays && (
          <>
            <ProbeChart days={detail.days} touchedDate={detail.touchedDate} chartId={chartId} />
            {/* H153 — the trailing em dash is a literal in the string; it names
                the no-trade gaps the line breaks at. */}
            <div
              className="mt-2 font-mono text-xs tracking-wide"
              style={{ color: PANEL_MUTED }}
            >
              {chartFooter(hint)}
            </div>
          </>
        )}
      </div>

      {/* H154–H159 — the six-column day table. Rows keep the ENDPOINT's order;
          there is no client sort here. */}
      {detail && hasDays && (
        <div className="mt-3.5 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <PlainHeadRow columns={DETAIL_DAY_COLUMNS} />
            </thead>
            <tbody>
              {detail.days.map((d, i) => (
                <tr key={d.date} style={{ background: rowBackground(i, false) }}>
                  <td className={`${TD_CLASS} text-left`}>{fmtDetailDate(d)}</td>
                  <td className={`${TD_CLASS} text-right tabular`}>{fmtDetailSpot(d)}</td>
                  <td
                    className={`${TD_CLASS} text-right tabular`}
                    style={{ color: deltaColor(d.spotPctChg) }}
                  >
                    {fmtSpotPctChg(d.spotPctChg)}
                  </td>
                  <td className={`${TD_CLASS} text-right tabular`}>
                    {fmtContractClose(d.contractClose)}
                  </td>
                  <td
                    className={`${TD_CLASS} text-right tabular`}
                    style={{ color: deltaColor(d.contractDollarChg) }}
                  >
                    {fmtContractDollarChg(d.contractDollarChg)}
                  </td>
                  <td
                    className={`${TD_CLASS} text-right tabular`}
                    style={{ color: deltaColor(d.contractPctChg) }}
                  >
                    {fmtContractPctChg(d.contractPctChg)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS VIEW (H104–H130)
// ─────────────────────────────────────────────────────────────────────────────

function ResultsByDay({
  days,
  loading,
  err,
  openDay,
  onToggleDay,
  onPickRow,
  openRow,
  detailPanel,
}: {
  days: DayBucket[]
  loading: boolean
  err: string | null
  openDay: string | null
  onToggleDay: (date: string) => void
  /** (uiKey, row) — the key identifies the clicked ROW, not the contract. */
  onPickRow: (uiKey: string, row: OutcomeRow) => void
  openRow: string | null
  detailPanel: ReactNode
}) {
  // H104/H105/H106 — checked in this order. The error wins over everything, and
  // a refresh that already has days shows the stale table silently.
  if (err) {
    return (
      <div className="p-5 text-center text-sm" style={{ color: V2.orange }}>
        {err}
      </div>
    )
  }
  if (loading && !days.length) {
    return (
      <div className="p-5 text-center text-sm" style={{ color: T.text }}>
        {RESULTS_LOADING}
      </div>
    )
  }
  if (!days.length) {
    return (
      <div className="p-5 text-center text-sm" style={{ color: T.text }}>
        {EMPTY_TRACKED}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <PlainHeadRow columns={DAY_COLUMNS} />
        </thead>
        <tbody>
          {days.map((d, i) => {
            const isOpen = openDay === d.date
            return (
              <Fragment key={d.date}>
                <tr
                  onClick={() => onToggleDay(d.date)}
                  // H112 — the title does NOT change when the row is open.
                  title={DAY_ROW_TITLE}
                  className="cursor-pointer"
                  style={{ background: rowBackground(i, isOpen) }}
                >
                  {/* H107 */}
                  <td
                    className={`${TD_CLASS} text-left font-bold`}
                    style={{ color: dayDateColor(isOpen) }}
                  >
                    {d.date}
                  </td>
                  {/* H108–H110 — a zero count is DIMMED, never hidden and never
                      an em dash. The three counts do not sum to the number of
                      distinct flags; see `groupOutcomesByDay`'s asymmetry. */}
                  {RESULT_SECTIONS.map((sec) => {
                    const n = d[sec.key].length
                    return (
                      <td key={sec.key} className={`${TD_CLASS} text-right tabular`}>
                        <span className="font-bold" style={{ color: countColor(n, sec.color) }}>
                          {n}
                        </span>
                      </td>
                    )
                  })}
                  {/* H111 — the unlabelled disclosure column. */}
                  <td className={`${TD_CLASS} text-right`} style={{ color: DISCLOSURE_INK }}>
                    {isOpen ? DAY_DISCLOSURE_OPEN : DAY_DISCLOSURE_CLOSED}
                  </td>
                </tr>

                {isOpen && (
                  <tr style={{ background: ROW_EXPANDED }}>
                    <td colSpan={DAY_COLSPAN} className="px-2.5 pb-4 pt-3">
                      <div className="grid gap-4">
                        {/* H114–H120 — three sections, in array order, each with
                            its own independent "None". */}
                        {RESULT_SECTIONS.map((sec) => {
                          const rows = d[sec.key]
                          return (
                            <div key={sec.key}>
                              <div className="mb-1.5 flex items-baseline gap-2.5">
                                <span
                                  className="text-sm font-bold tracking-wide"
                                  style={{ color: sec.color }}
                                >
                                  {sectionHeading(sec, rows.length)}
                                </span>
                                <span className="text-sm text-fg opacity-65">{sec.note}</span>
                              </div>

                              {!rows.length ? (
                                <div className="px-2.5 py-2 text-sm" style={{ color: DIM_INK }}>
                                  {SECTION_NONE}
                                </div>
                              ) : (
                                <table className="w-full border-collapse text-sm">
                                  <thead>
                                    {/* H.10d — NONE of these eight headers is
                                        clickable; they are plain headers. */}
                                    <PlainHeadRow columns={SECTION_COLUMNS} />
                                  </thead>
                                  <tbody>
                                    {rows.map((o, j) => {
                                      // H129 — section-scoped, so the same
                                      // contract listed under both Opened and
                                      // Touched on one date expands only where
                                      // it was clicked.
                                      const rk = dayRowKey(d.date, sec.key, o)
                                      const rowOpen = openRow === rk
                                      return (
                                        <Fragment key={rk}>
                                          <tr
                                            onClick={() => onPickRow(rk, o)}
                                            title={rowTitle(rowOpen)}
                                            className="cursor-pointer"
                                            // Striping is `j % 2` — the index
                                            // WITHIN the section, not the day.
                                            style={{ background: rowBackground(j, rowOpen) }}
                                          >
                                            {/* H121 */}
                                            <td className={`${TD_CLASS} text-left font-bold`}>
                                              {o.symbol}
                                            </td>
                                            {/* H122 — raw number; `above` is up. */}
                                            <td
                                              className={`${TD_CLASS} text-right font-bold tabular`}
                                              style={{ color: sideColor(o.side) }}
                                            >
                                              {fmtStrike(o.strike)}
                                            </td>
                                            {/* H123/H124 — verbatim, no ymd(). */}
                                            <td className={`${TD_CLASS} text-left`}>{o.expiry}</td>
                                            <td className={`${TD_CLASS} text-left`}>
                                              {o.first_flagged}
                                            </td>
                                            {/* H125/H126 */}
                                            <td className={`${TD_CLASS} text-right tabular`}>
                                              {fmtFlaggedSpot(o)}
                                            </td>
                                            <td className={`${TD_CLASS} text-right tabular`}>
                                              {fmtOtmAtFlag(o)}
                                            </td>
                                            {/* H127 — boundary strictly `< 1`. */}
                                            <td
                                              className={`${TD_CLASS} text-right tabular`}
                                              style={{ color: closestColor(o) }}
                                            >
                                              {fmtClosest(o)}
                                            </td>
                                            {/* H128 — the touch DATE is glued onto
                                                the status label here, unlike the
                                                flat table's own column. A null
                                                date leaves a trailing space. */}
                                            <td className={`${TD_CLASS} text-left`}>
                                              <span
                                                className="text-sm font-bold tracking-wide"
                                                style={{ color: statusColor(o.status) }}
                                              >
                                                {fmtSectionStatus(o)}
                                              </span>
                                            </td>
                                          </tr>
                                          {rowOpen && (
                                            <tr>
                                              <td
                                                colSpan={SECTION_COLSPAN}
                                                className="pl-2.5"
                                                style={{ background: ROW_EXPANDED }}
                                              >
                                                {detailPanel}
                                              </td>
                                            </tr>
                                          )}
                                        </Fragment>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FLAT TRACKED-RESULTS TABLE (H77–H95)
// ─────────────────────────────────────────────────────────────────────────────

function OutcomeTable({
  rows,
  sort,
  onSort,
  onPickRow,
  openRow,
  detailPanel,
}: {
  rows: OutcomeRow[]
  sort: OutcomeSort
  onSort: (key: OutcomeSortKey) => void
  onPickRow: (uiKey: string, row: OutcomeRow) => void
  openRow: string | null
  detailPanel: ReactNode
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={{ color: TABLE_HEADER_INK }}>
            {/* The twelve columns come out of OUTCOME_COLUMNS in render order —
                labels, alignments and sort keys all from there. */}
            {OUTCOME_COLUMNS.map((c) => (
              <SortHeader key={c.key} col={c} sort={sort} onSort={onSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((o, i) => {
            const rk = flatRowKey(o)
            const isOpen = openRow === rk
            return (
              <Fragment key={rk}>
                <tr
                  onClick={() => onPickRow(rk, o)}
                  title={rowTitle(isOpen)}
                  className="cursor-pointer"
                  style={{ background: rowBackground(i, isOpen) }}
                >
                  {/* H77 */}
                  <td className={`${TD_CLASS} text-left font-bold`}>{o.symbol}</td>
                  {/* H78 — raw number, no toFixed; `above` is up. */}
                  <td
                    className={`${TD_CLASS} text-right font-bold tabular`}
                    style={{ color: sideColor(o.side) }}
                  >
                    {fmtStrike(o.strike)}
                  </td>
                  {/* H79/H80 — the server's strings VERBATIM. `ymd()` is applied
                      to the sort value only, so an expiry carrying a time shows
                      the time here. */}
                  <td className={`${TD_CLASS} text-left`} style={{ color: T.text }}>
                    {o.expiry}
                  </td>
                  <td className={`${TD_CLASS} text-left`} style={{ color: T.text }}>
                    {o.first_flagged}
                  </td>
                  {/* H81/H82 — the ONLY cell that names the contract's C/P side;
                      High deliberately does not repeat it. No tooltip at all when
                      the entry date is missing. */}
                  <td
                    className={`${TD_CLASS} text-right font-bold tabular`}
                    title={entryTitle(o)}
                  >
                    {fmtEntry(o)}
                  </td>
                  {/* H83 */}
                  <td
                    className={`${TD_CLASS} text-right font-bold tabular`}
                    style={{ color: highColor(o) }}
                  >
                    {fmtHigh(o)}
                  </td>
                  {/* H84 — glyph boundary `>= 0`, so an exact zero is "▲ 0.0%"
                      painted up. */}
                  <td
                    className={`${TD_CLASS} text-right font-bold tabular`}
                    style={{ color: maxPctColor(o.opt_pct_high) }}
                  >
                    {fmtMaxPct(o.opt_pct_high)}
                  </td>
                  {/* H85/H86 */}
                  <td className={`${TD_CLASS} text-right tabular`}>{fmtFlaggedSpot(o)}</td>
                  <td className={`${TD_CLASS} text-right tabular`}>{fmtOtmAtFlag(o)}</td>
                  {/* H87 — boundary strictly `< 1`, so exactly 1.0% is not lit. */}
                  <td
                    className={`${TD_CLASS} text-right tabular`}
                    style={{ color: closestColor(o) }}
                  >
                    {fmtClosest(o)}
                  </td>
                  {/* H88 — BUG (v2), reproduced: the COLOUR tests the raw field
                      while the TEXT tests the normalised one, so a truthy-but-
                      malformed date paints light blue beside an em dash. This is
                      also the one cell on the flat table that applies `ymd()`. */}
                  <td
                    className={`${TD_CLASS} whitespace-nowrap text-left`}
                    style={{ color: touchedColor(o) }}
                  >
                    {fmtTouchedCell(o)}
                  </td>
                  {/* H89 — touched → accent, expired → body text, open → up. */}
                  <td className={`${TD_CLASS} text-left`}>
                    <span
                      className="text-sm font-bold tracking-wide"
                      style={{ color: statusColor(o.status) }}
                    >
                      {fmtStatusWord(o.status)}
                    </span>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    {/* H93 — spans all twelve. */}
                    <td
                      colSpan={OUTCOME_COLSPAN}
                      className="pl-2.5"
                      style={{ background: ROW_EXPANDED }}
                    >
                      {detailPanel}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
          {/* H94 — guarded on the row count and NOT on a loading flag, so a slow
              fetch shows this sentence. It is also the first-paint state, which
              is why the header above it must survive: see note 6 in the header. */}
          {!rows.length && (
            <tr>
              <td
                colSpan={OUTCOME_COLSPAN}
                className="p-5 text-center text-sm"
                style={{ color: T.text }}
              >
                {EMPTY_TRACKED}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// THE TAB
// ─────────────────────────────────────────────────────────────────────────────

const NO_ROWS: OutcomeRow[] = []
const NO_FLAGS: WatchLoad = { rows: [], threshold: null }

export default function WatchThisTab() {
  // H48 — not persisted anywhere: no localStorage, no URL param, so every
  // remount lands back on "all" (H206).
  const [view, setView] = useState<OutcomeView>(DEFAULT_OUTCOME_VIEW)
  const [sort, setSort] = useState<OutcomeSort>(() => defaultOutcomeSort(DEFAULT_OUTCOME_VIEW))
  const [openDay, setOpenDay] = useState<string | null>(null)
  // H203 — ONE row open at a time across BOTH tables. The key is UI-scoped, the
  // row is what the detail URL is built from.
  const [openRow, setOpenRow] = useState<{ key: string; row: OutcomeRow } | null>(null)
  const [ticker, setTicker] = useState('')
  const [adding, setAdding] = useState(false)
  const [addStatus, setAddStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  // H50 — a manual sort is discarded on EVERY view switch, including switching
  // to "results" (where the value is inert, H69/H210) and back.
  useEffect(() => {
    setSort(defaultOutcomeSort(view))
  }, [view])

  // ── The four reads. All fire at mount / on view change; none waits on
  // another (H205). `staleMs: 0` is v2's `{cache: "no-store"}`; `pollMs` is
  // v2's two setIntervals, and BOTH now skip a hidden tab — which is a faithful
  // port for the 60s outcomes poll and the one deliberate departure for the
  // 120s flag poll (H196, "Do not port" H214).
  const flagsQ = useQuery<WatchResponse>(farCbWatchUrl(), {
    staleMs: NO_STORE_STALE_MS,
    pollMs: WATCH_POLL_MS,
  })
  const outcomesQ = useQuery<OutcomesResponse>(
    view === 'results' ? null : farCbOutcomesUrl(view),
    { staleMs: NO_STORE_STALE_MS, pollMs: OUTCOMES_POLL_MS },
  )
  // H200 — a DIFFERENT page of the same route, and the only read with no poll.
  const resultsQ = useQuery<OutcomesResponse>(
    view === 'results' ? farCbResultsUrl() : null,
    { staleMs: NO_STORE_STALE_MS },
  )
  // H201/H202 — keyed on the URL, so closing a row (null) or opening another
  // discards whatever is in flight without a request counter.
  const detailQ = useQuery<DetailResponse>(openRow ? detailUrlFor(openRow.row) : null, {
    staleMs: DETAIL_STALE_MS,
  })

  // ── Last-good rows. See note 2 in the file header: v2 leaves the previous
  // rows standing through every failure of both feeds, and an `ok:false` body
  // arriving as `data` must not be allowed to empty a grid v2 keeps.
  const keptFlags = useRef<WatchLoad>(NO_FLAGS)
  const flags = useMemo(() => {
    const next = watchRowsFromQuery(flagsQ.data)
    if (next) keptFlags.current = next
    return keptFlags.current
  }, [flagsQ.data])

  const keptRows = useRef<OutcomeRow[]>(NO_ROWS)
  const outcomes = useMemo(() => {
    // H49 — no clear-on-change either: the previous view's rows stay up until
    // the new response lands.
    const next = outcomesRowsFromQuery(outcomesQ.data)
    if (next) keptRows.current = next
    return keptRows.current
  }, [outcomesQ.data])

  // H21–H24 — the banner renders whenever this is truthy, INCLUDING while
  // loading; there is no `!loading` guard, and `flagErrorText` is what turns a
  // "no DB" or a "503" into the recorder sentence.
  const flagErr = watchErrorFromQuery(flagsQ.data, flagsQ.error)

  const resultRows = useMemo(
    () => resultsRowsFromQuery(resultsQ.data) ?? NO_ROWS,
    [resultsQ.data],
  )
  const resultsErr = resultsErrorFromQuery(resultsQ.data, resultsQ.error)
  const dayBuckets = useMemo(() => groupOutcomesByDay(resultRows), [resultRows])

  // H76 — client-side only, over the already-fetched page: sorting by `opt_high`
  // DESC shows the best of the fetched hundred, not the best overall.
  const sortedOutcomes = useMemo(() => sortOutcomes(outcomes, sort), [outcomes, sort])

  const detail = openRow ? detailFromQuery(detailQ.data) : null
  const detailErr = openRow ? detailErrorFromQuery(detailQ.data, detailQ.error) : null

  // H70/H71 — the same column toggles direction; a NEW column opens descending,
  // except `symbol`, which opens A–Z.
  const onSort = useCallback((key: OutcomeSortKey) => {
    setSort((cur) => nextOutcomeSort(cur, key))
  }, [])

  const closeDetail = useCallback(() => setOpenRow(null), [])

  // H203 — a second click on the SAME ui key closes the row and fetches nothing.
  const onPickRow = useCallback((uiKey: string, row: OutcomeRow) => {
    setOpenRow((cur) => (cur && cur.key === uiKey ? null : { key: uiKey, row }))
  }, [])

  // H.11 — built ONCE and handed to both tables, so the two call sites cannot
  // drift and only one detail is ever open.
  const detailPanel = (
    <OutcomeDetailPanel
      detail={detail}
      loading={openRow ? detailQ.loading : false}
      err={detailErr}
      onClose={closeDetail}
    />
  )

  // H17 — normalised at SUBMIT time only; the input holds raw keystrokes. An
  // empty trimmed value bails WITHOUT clearing the previous status message.
  // H20 — nothing refetches on success: the row appears after the next sweep,
  // which is exactly what the success sentence tells the user.
  const submitAdd = useCallback(async () => {
    // H15/H220 — the guard BOTH call sites share. See the file header.
    if (!canAddTicker(ticker, adding)) return
    const symbol = normaliseTickerInput(ticker)
    setAdding(true)
    setAddStatus(null)
    try {
      await addFarCbTicker({ symbol })
      // H18 — never auto-dismisses; it persists until the next add attempt.
      setAddStatus({ kind: 'ok', msg: addSuccessMessage(symbol) })
      setTicker('')
    } catch (e) {
      // H19 — the server's own sentence wins; the input is NOT cleared.
      setAddStatus({ kind: 'err', msg: errText(e) })
    } finally {
      setAdding(false)
    }
  }, [ticker, adding])

  return (
    <Card title={CARD_TITLE}>
      {/* H9 — `threshold` prints RAW. The `· >N% OTM` clause disappears entirely
          when the endpoint omits the field, while the footer below keeps printing
          ">15%" from the client fallback: same missing field, two answers, both
          on screen. Shipped as-is. */}
      <div className="mb-3 text-xs text-muted">
        {watchSubtitle(flags.threshold, flagsQ.loading)}
      </div>

      {/* ── Toolbar (H10–H12) ──────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {/* H11 — never active, never disabled while loading, so it can be
            re-fired mid-flight. `refetch` bypasses the stale window. */}
        <button
          type="button"
          onClick={() => flagsQ.refetch()}
          className="rounded-sm border border-line px-2 py-1 text-xs text-muted"
        >
          {REFRESH_LABEL}
        </button>
        {/* H12 — the "2m" matches WATCH_POLL_MS; the "30m during RTH" is a claim
            about the server that nothing on the client can verify. */}
        <span className="text-sm text-fg">{REFRESH_NOTE}</span>
      </div>

      {/* ── Add a ticker (H13–H20) ─────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          // H15 — v2 fires the POST from here with NO `adding` guard, so Enter
          // can double-post. `canAddTicker` inside `submitAdd` closes that.
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitAdd()
          }}
          placeholder={ADD_PLACEHOLDER}
          maxLength={ADD_MAX_LENGTH}
          aria-label={ADD_PLACEHOLDER}
          className="w-40 rounded-sm border border-line bg-bg px-2.5 py-1.5 text-sm text-fg"
        />
        {/* H16 — the same guard as the Enter path, so the two can no longer
            disagree about when a POST is allowed. */}
        <button
          type="button"
          onClick={() => void submitAdd()}
          disabled={!canAddTicker(ticker, adding)}
          className="rounded-sm border border-line px-2 py-1 text-xs text-muted"
        >
          {adding ? ADD_BUSY_LABEL : ADD_LABEL}
        </button>
        {addStatus && (
          <span
            className="text-sm"
            style={{ color: addStatus.kind === 'ok' ? V2.accent : V2.red }}
          >
            {addStatus.msg}
          </span>
        )}
      </div>

      {/* H21/H22 — bare text, no plate, and no `!loading` guard. */}
      {flagErr && (
        <div className="mb-3 text-sm" style={{ color: V2.orange }}>
          {flagErrorText(flagErr)}
        </div>
      )}

      {/* H25 — all three conditions. Suppressed on the very first paint because
          `loading` starts true. H26 — there is NO loading state for this grid:
          no spinner, no skeleton, and old rows stay up through a refresh. */}
      {!flags.rows.length && !flagsQ.loading && !flagErr && (
        <div className="p-6 text-center text-sm" style={{ color: T.text }}>
          {EMPTY_FLAG_GRID}
        </div>
      )}

      {/* H27/H28 — an auto-filling grid; zero rows render it at zero height. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {flags.rows.map((r) => (
          <FlagCard key={watchRowKey(r)} row={r} />
        ))}
      </div>

      {/* ── Basis footer (H42–H45) — renders even with zero rows. ───────────── */}
      <div className="mt-3.5 flex flex-wrap gap-5 text-sm text-fg">
        <span>{FOOTER_BASIS}</span>
        {/* H44 — the client fallback of 15 is the ONLY threshold literal on the
            tab, and it is applied HERE and not in the subtitle. */}
        <span>{footerFlagged(flags.threshold)}</span>
      </div>

      {/* ── Tracked results (H46–H52) ──────────────────────────────────────── */}
      <div className="mt-6 border-t border-line pt-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {/* H47 — sentence case, no uppercase transform. */}
          <span className="text-lg font-bold text-fg">{TRACKED_RESULTS_TITLE}</span>
          {/* H48 — five views in this order; the labels are the ids with the
              first letter upper-cased. */}
          <SegGroup<OutcomeView>
            options={OUTCOME_VIEWS.map((v) => ({ value: v, label: outcomeViewLabel(v) }))}
            value={view}
            onChange={setView}
          />
          {/* H51/H52 */}
          <span className="text-sm text-fg">{trackedHint(view)}</span>
        </div>

        {view === 'results' ? (
          <ResultsByDay
            days={dayBuckets}
            loading={resultsQ.loading}
            err={resultsErr}
            openDay={openDay}
            onToggleDay={(d) => setOpenDay((cur) => (cur === d ? null : d))}
            onPickRow={onPickRow}
            openRow={openRow?.key ?? null}
            detailPanel={detailPanel}
          />
        ) : (
          // H95 — a failed outcomes fetch is SILENT in v2: no message, no retry
          // indicator, the table just keeps its previous rows or shows H94.
          // H216 asks v3 for a real error branch; that is a visible change and a
          // decision, so it is not taken here.
          <OutcomeTable
            rows={sortedOutcomes}
            sort={sort}
            onSort={onSort}
            onPickRow={onPickRow}
            openRow={openRow?.key ?? null}
            detailPanel={detailPanel}
          />
        )}
      </div>
    </Card>
  )
}
