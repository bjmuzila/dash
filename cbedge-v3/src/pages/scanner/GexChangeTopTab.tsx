// ─────────────────────────────────────────────────────────────────────────────
// GEX CHANGE TOP — THE RENDER LAYER (/v3/scanner, the DEFAULT tab).
//
// Spec: docs/parity/scanner.md Part C, rows C1–C158. The maths, every boundary,
// every label string and both feeds' failure branches are already written and
// are NOT re-decided here:
//
//   · pages/scanner/gexChangeTop.ts     — types, grade ladder, formatters, copy
//   · pages/scanner/gexChangeTopData.ts — endpoints, the two failure modes
//
// This file is wiring. Where it needed a string or a rule that was not in those
// two, the string or rule went THERE and is imported (the four hook-shaped view
// adapters and `pickHistoryUrl` in the data module are the only additions).
//
// ── WHAT THIS TAB IS ─────────────────────────────────────────────────────────
// Three stacked surfaces inside one Card:
//   1. the EOD scorecard — every auto-probed pick for the date, graded
//   2. the slot sections — the ★ Very strong captures, five tiles an hour
//   3. the footer legend — the ranking and grading contract, as prose
//
// ── FIVE THINGS THAT LOOK LIKE MISTAKES AND ARE NOT ──────────────────────────
//
//  1. THREE ZERO CONVENTIONS, ALL ON SCREEN AT ONCE. A break-even pick paints
//     GREEN in the scorecard's Peak % column, RED on the card's peak headline
//     and NEUTRAL on the card's "now" line. Three call sites, three imported
//     functions, one `// BUG (v2):` marker — see §SIGN COLOURS in
//     gexChangeTop.ts. Flagged at each call site below, not collapsed.
//
//  2. A "B" PILL BESIDE A "never green" COUNT THAT INCLUDES IT. `gradeFor`'s
//     server path does not apply the never-green override; the counter reads
//     `neverGreen` from both paths. The pill and the strip disagree about the
//     same pick, by construction. See the BUG note in `gradeFor`.
//
//  3. THE SCORECARD EMPTY STATE NAMES A BUTTON THAT DOES NOT EXIST. Shipped
//     verbatim. See the comment on the empty-state node.
//
//  4. THERE IS NO SORT. `filtered` and `slots` render in the server's array
//     order. No comparator, no default column, no header handlers. Adding one
//     would change which pick reads as "the top one".
//
//  5. THE ECHOED DATE IS NEVER FED BACK INTO A URL. See `pickedDate` below —
//     that loop is C12's waterfall, and the data module straightened it.
//
// ── WHAT IS DELIBERATELY NOT MOUNTED ─────────────────────────────────────────
// `loadPickStudy` and `probeWatchAdd` are `@notWiredInV2`. Neither is imported.
// The whole html2canvas capture surface (C51–C53, C109, C110, C124, C127) is
// gone with it — v3 has one owner-gated camera in the toolbar; see the REMOVED
// block at the top of gexChangeTop.ts.
//
// C16 (`prefers-reduced-motion`) guards the flip, and is live again. An earlier
// port rendered the back as a block that appeared UNDER the front, so there was
// no transition for the query to switch off and the guard was dropped with it.
// The tile is a true two-face 3D flip again (C107, C108, C125), so C16 is back
// where v2 had it: ONE `matchMedia` listener at the tab level, threaded down to
// the flipper, swapping `transform 0.32s ease-out` for `none`. Reduced motion is
// an instant face swap — the rotation still happens, it just takes no time.
//
// ── NON-NEGOTIABLES ──────────────────────────────────────────────────────────
// · No colour literals — every colour is a token via @/design/theme or comes
//   back from a ladder in gexChangeTop.ts.
// · Both feeds fire in parallel at mount (two `useQuery`s, same tick). No
//   waterfall.
// · Polling is `pollMs`, never a `setInterval`. C13's 60s cadence is `POLL_MS`;
//   C14's open-card cap is `OPEN_CARD_POLL_MAX`.
// · The chart mounts through ChartFrame and honours `onVisibility` — see
//   `PickChart`. It draws SVG, not canvas, so there is no `data-cb-layer` to
//   place; v2's chart is SVG and the tokens interpolate straight into it.
// ─────────────────────────────────────────────────────────────────────────────

import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useExpandStage } from '@/design/primitives/Expand'
import { ProbeChart, type Bar } from '@/board/topFlow/ContractProbe'
import { CopyShotButton } from '@/shell/CopyShot'
import type { ShotResult } from '@/shell/snapshot'
import { Card } from '@/design/primitives/Card'
import { Chip } from '@/design/primitives/Controls'
import { DatePicker } from '@/design/primitives/DatePicker'
import type { Column } from '@/design/primitives/Table'
import { Table } from '@/design/primitives/Table'
import { T, V2, V2W, alpha } from '@/design/theme'
import { EM_DASH } from '@/pages/scanner/format'
import type {
  GateOn,
  GradeInfo,
  Metric,
  ResultRow,
  Row,
  ScorecardIndex,
  SlotBucket,
} from '@/pages/scanner/gexChangeTop'
import {
  AUTO_PROBE_LEGEND,
  BACK_LABELS,
  CAPTURED_LABEL_PREFIX,
  CARD_BACK_TO_PICK,
  CARD_CLOSE_GLYPH,
  CARD_TITLE,
  CHART_EMPTY_LINE_1,
  CHART_EMPTY_LINE_2,
  CHART_LOADING,
  DEFAULT_METRIC,
  FLIP_ALL_TITLE_BACK,
  FLIP_ALL_TITLE_FLIP,
  GPA_LABEL,
  GRADES_LABEL,
  GRADE_COLOR,
  GRADE_LEGEND_F,
  GRADE_LEGEND_LEAD,
  GRADE_LEGEND_TAIL,
  GRADE_NOTE,
  GRADE_ORDER,
  GRADE_PILL_PROVISIONAL_MARK,
  LIVE_TRIGGER_BADGE,
  LIVE_TRIGGER_TITLE,
  NEVER_GREEN_LABEL,
  NEVER_GREEN_TITLE,
  OPEN_CARD_POLL_MAX,
  POLL_MS,
  PRICE_LINE_HINT,
  PROJ_LEGEND_BOLD,
  PROJ_LEGEND_LEAD,
  PROJ_LEGEND_TAIL,
  PROJ_PILL_PREFIX,
  REFRESH_LABEL,
  SCORE_LEGEND,
  SCORECARD_COLUMNS,
  SCORECARD_FOOTNOTE,
  SCORE_ABS_TITLE,
  SCORE_REL_TITLE,
  TAPE_CHIP_TITLE,
  TAPE_LINE_LABEL,
  TAPE_NONE,
  SCORECARD_TITLE,
  SPOT_LABEL,
  STAR_LEGEND_LEAD,
  STAR_LEGEND_TAIL,
  SUMMARY_LABELS,
  TOOLBAR_HINT,
  UNDER_FLOOR_BADGE,
  VERY_STRONG_LABEL,
  GATE_DEFAULT,
  GATE_TESTS,
  anyProjected,
  avgPeakColor,
  cardRenderKey,
  alignColor,
  cardScore,
  regimeChipLabel,
  regimeChipTitle,
  rowAlign,
  flowColor,
  fmtFlow,
  fmtVolOi,
  preFlagNet,
  cardSubtitle,
  cardTitle,
  cheapToggleLabel,
  cheapToggleTitle,
  closePctTableColor,
  countCheapCards,
  deltaColor,
  derivePickCard,
  feedErrorLabel,
  filterSlotsByGate,
  flaggedLabel,
  flipAllLabel,
  flippableCards,
  fmtBig,
  fmtClock,
  fmtDollarsPerContract,
  fmtGpa,
  fmtNeverGreen,
  fmtNowPct,
  fmtOtm,
  fmtPctOpen,
  fmtPctSigned,
  fmtPeakDollarsClause,
  fmtPeakHeadline,
  fmtPx,
  fmtScore,
  fmtSpot,
  fmtStrike,
  gradeFor,
  gateActive,
  gateCounts,
  gateHidAllCopy,
  gateOkIdsFrom,
  gateSwitchTitle,
  gradePillTitle,
  indexResults,
  neverGreenColor,
  noSlotsCopy,
  peakDollarsFromRow,
  peakPctCardColor,
  peakPctTableColor,
  picksLabel,
  pctOpenColor,
  pnlColor,
  projGradeKey,
  projPillTitle,
  resultRowKey,
  scorecardBasisLabel,
  scorecardEmptyCopy,
  scorecardErrorLabel,
  scorecardFreshnessLabel,
  scorecardSummary,
  showResultsLabel,
  sideColor,
  slotHeaderColor,
  slotLabel,
  slotsMultiplier,
  underFloorTitle,
} from '@/pages/scanner/gexChangeTop'
import type { FlowResponse, HistoryResponse, ResultsResponse, TopResponse } from '@/pages/scanner/gexChangeTopData'
import {
  HISTORY_STALE_MS,
  pickFlowUrl,
  NO_STORE_STALE_MS,
  gexChangeTopUrls,
  pickHistView,
  pickHistoryUrl,
  resultsView,
  topView,
} from '@/pages/scanner/gexChangeTopData'
import { useQuery } from '@/data/api'

// ─────────────────────────────────────────────────────────────────────────────
// SMALL SHARED PIECES
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// PER-CARD EXPAND + SNAPSHOT (2026-09-24)
//
// EXPAND portals the card's back face, full size, into the page's expand stage
// (design/primitives/Expand) — the same stage every board Card uses, so the rail
// and toolbar stay live and Escape closes it. Without a stage (phone build) it
// falls back to a fixed overlay.
//
// SNAPSHOT rides the shell's owner-gated CopyShotButton with a custom `capture`:
// the snapshot engine has no 3D pipeline (it clones computed styles into an SVG
// foreignObject), so a flipped tile would photograph as a mirrored or blank
// face. `shootTile` flattens the flip on the LIVE node for the length of the
// shot — flipper transform off, the hidden face `display: none`, the showing
// face un-rotated — and puts every inline style back afterwards, shot or no shot.
// ─────────────────────────────────────────────────────────────────────────────

function shotSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'snapshot'
}

async function shootTile(tile: HTMLElement | null, label: string): Promise<ShotResult> {
  if (!tile) throw new Error('card is not on screen')
  const undo: Array<() => void> = []
  const set = (el: HTMLElement, prop: string, val: string) => {
    const prev = el.style.getPropertyValue(prop)
    el.style.setProperty(prop, val)
    undo.push(() => (prev ? el.style.setProperty(prop, prev) : el.style.removeProperty(prop)))
  }
  try {
    set(tile, 'perspective', 'none')
    const flipper = tile.querySelector<HTMLElement>('[data-flip3d]')
    if (flipper) {
      const showBack = flipper.dataset.flip3d === 'back'
      set(flipper, 'transform', 'none')
      set(flipper, 'transition', 'none')
      set(flipper, 'transform-style', 'flat')
      Array.from(flipper.children).forEach((f, i) => {
        const face = f as HTMLElement
        if ((i === 1) !== showBack) set(face, 'display', 'none')
        else set(face, 'transform', 'none')
      })
    }
    const { captureCanvas, deliverCanvas } = await import('@/shell/snapshot')
    const canvas = await captureCanvas(tile, { title: label })
    return await deliverCanvas(canvas, `${shotSlug(label)}.png`)
  } finally {
    for (const u of undo.reverse()) u()
  }
}

/** A small glyph button for a card header. Hidden from its own PNG. */
function CardIconButton({
  glyph,
  title,
  onClick,
}: {
  glyph: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-capture-hide
      onClick={onClick}
      title={title}
      aria-label={title}
      className="shrink-0 px-0.5 text-sm leading-none opacity-70 hover:opacity-100"
      style={{ color: T.text }}
    >
      {glyph}
    </button>
  )
}

const EXPAND_GLYPH = '⤢'
const EXPAND_TITLE = 'Expand this card'

// ─────────────────────────────────────────────────────────────────────────────
// THE FLIP (C107, C108, C125) — GEOMETRY AND MOTION
//
// Everything here is transform geometry and a duration. None of it is a colour
// and none of it is a type size, so it is px and it lives with the DOM it
// describes rather than in gexChangeTop.ts (same rule as the chart's `GEO`).
// ─────────────────────────────────────────────────────────────────────────────

/** C107 — v2's `perspective: 1200` on the TILE, not on the flipper. The
 *  perspective has to come from an ancestor of the rotating box or the rotation
 *  is orthographic and the card reads as a squash rather than a turn. */
const FLIP_PERSPECTIVE = 1200

/** C107 — sized for the TALLER face. The back is header + sub + headline + the
 *  demoted "now" line + toolbar + a fixed 96px chart + hint, and both faces are
 *  `inset: 0`, so this one number is the tile's height whichever way up it is.
 *  That is what stops a flip resizing the card or reflowing the grid. */
const FLIP_MIN_HEIGHT = 348 // 260 → 348 (2026-09-24): the back now carries the whale-page ProbeChart with its volume strip


/** C108 — v2's transition, verbatim. Only `transform` animates, which is
 *  compositor-only: no layout, no paint, no main-thread work per frame. */
const FLIP_TRANSITION = 'transform 0.32s ease-out'

/** C108 — the reduced-motion value. Not `transform 0s`: `none` also removes the
 *  `transitionend` and the compositor layer promotion, so the face swap is a
 *  single style recalc. */
const FLIP_TRANSITION_NONE = 'none'

/**
 * C125 — the surface BOTH faces share, so the tile is the same box either way
 * up. v2 spread `classicCardAccentStyle` here: a flat frosted panel with a
 * hairline edge, no radial highlight and no tint wash. Do not reintroduce a glow.
 *
 * `backfaceVisibility: hidden` is the load-bearing declaration. It is what makes
 * a face turned away from the viewer drop out of BOTH the paint and the hit
 * test — without it the flipper shows the front and the mirrored back stacked on
 * top of each other, and the turned-away face still swallows clicks.
 */
const FACE_STYLE: CSSProperties = {
  borderColor: V2W.border,
  background: V2W.panelBg,
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
}

/** The back face is the same surface, turned around. v2: `{ ...faceStyle,
 *  transform: 'rotateY(180deg)' }` — and the padding tightens from the front's
 *  12/14 to 10/12 (that half is a class, below). */
const BACK_FACE_STYLE: CSSProperties = { ...FACE_STYLE, transform: 'rotateY(180deg)' }

/** Both faces are absolutely positioned against the flipper and clip their own
 *  overflow. The padding differs (C125) and is applied per face. */
const FACE_CLASS = 'absolute inset-0 overflow-hidden rounded-md border'

/**
 * C16 — the OS "reduce motion" setting, live.
 *
 * Called ONCE, at the tab, and threaded down. v2 did the same, and the reason is
 * the card count: a hook per tile would put ~65 `matchMedia` listeners on one
 * media query for a boolean that is identical in all of them.
 *
 * `matchMedia` itself is optional-chained: an old browser without it returns
 * undefined, the effect leaves early, and `reduceMotion` stays false — i.e. the
 * animation plays, which is v2's fallback.
 */
function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const sync = () => setReduce(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return reduce
}

/** A plain toolbar button. Structural only — every colour arrives as a token. */
function ToolButton({
  label,
  onClick,
  title,
  disabled = false,
  color,
  borderColor,
}: {
  label: string
  onClick: () => void
  title?: string
  disabled?: boolean
  color?: string
  borderColor?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="shrink-0 rounded-sm border px-2 py-0.5 text-xs font-semibold tracking-wide disabled:cursor-default disabled:opacity-50"
      style={{ color: color ?? T.text, borderColor: borderColor ?? V2W.border }}
    >
      {label}
    </button>
  )
}

/**
 * C39 — the grade pill, or nothing at all.
 *
 * `info == null` renders NOTHING: no placeholder, no dash. That is what an
 * ungraded scorecard row looks like, and a dash there would read as "graded, no
 * value" instead of "not scored yet".
 *
 * `size="lg"` is v2's `size={13}`, used only on the card front (C114).
 */
function GradePill({
  info,
  provisional,
  size = 'sm',
}: {
  info: GradeInfo | null
  provisional: boolean
  size?: 'sm' | 'lg'
}) {
  if (!info) return null
  const ink = GRADE_COLOR[info.grade]
  return (
    <span
      title={gradePillTitle(info, provisional)}
      className={[
        'inline-flex shrink-0 items-center gap-0.5 rounded-sm border font-mono font-bold leading-none',
        size === 'lg' ? 'px-2 py-1 text-sm' : 'px-1.5 py-0.5 text-xs',
      ].join(' ')}
      style={{ color: ink, borderColor: alpha(ink, 0.4), background: alpha(ink, 0.12) }}
    >
      {info.grade}
      {provisional && (
        <span className="font-semibold opacity-70">{GRADE_PILL_PROVISIONAL_MARK}</span>
      )}
    </span>
  )
}

/**
 * C40, C41 — the PROJECTED grade pill.
 *
 * Hollow, dashed and prefixed on purpose: a prediction must never read like a
 * result at a glance. An unrecognised grade string is COLOURED as C
 * (`projGradeKey`) while its raw text is still printed — the projection rule is
 * free to invent a label this client has never heard of, and swallowing it
 * would hide that it did.
 */
function ProjPill({ grade, pts }: { grade: string | null | undefined; pts: number | null | undefined }) {
  if (!grade) return null
  const ink = GRADE_COLOR[projGradeKey(grade)]
  return (
    <span
      title={projPillTitle(grade, pts)}
      className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-sm border border-dashed px-1.5 py-0.5 font-mono text-2xs font-bold leading-none"
      style={{ color: alpha(ink, 0.85), borderColor: alpha(ink, 0.5), background: 'transparent' }}
    >
      <span className="font-semibold opacity-70">{PROJ_PILL_PREFIX}</span>
      {grade}
    </span>
  )
}

/** C55, C135 — a neutral, non-interactive pill. v2's `tglStyle(true)` + `cursor: default`. */
function StaticPill({ label, className = '' }: { label: string; className?: string }) {
  return (
    <span
      className={['inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 font-mono font-bold leading-none', className].join(' ')}
      style={{ color: T.text, borderColor: V2W.border, background: alpha(T.text, 0.08) }}
    >
      {label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// THE TAB
// ─────────────────────────────────────────────────────────────────────────────

export default function GexChangeTopTab() {
  // ── C47 — the date picker's value ──────────────────────────────────────────
  //
  // `""` means "let the server pick today"; the `date` param is then omitted
  // entirely (see `withDate` in the data module), which is what stops a viewer
  // in London asking for tomorrow's slots.
  //
  // THE ECHOED DATE IS A SECOND, SEPARATE VALUE. v2 held one `date` state, wrote
  // the feed's echo into it, and keyed the fetch effect on it — so every entry
  // to the tab cost two `/results` requests, the second waiting on the first
  // feed's response for a value it did not need (C12). Here the echo only ever
  // reaches DISPLAY: the picker's shown value and the cards' capture stamps.
  // Feeding it back into the URL would rebuild that waterfall.
  const [pickedDate, setPickedDate] = useState('')
  const [scoreCheap, setScoreCheap] = useState(false)
  // THE GATE (v3-only, no v2 counterpart — see gexChangeTop.ts). Three
  // independent view filters over what the recorder already captured.
  const [gateOn, setGateOn] = useState<GateOn>(GATE_DEFAULT)
  const [showResults, setShowResults] = useState(true)
  // C136 — ONE metric for the whole tab, not one per card. Switching it on any
  // open card switches every open card at once. Persists to nothing.
  const [metric, setMetric] = useState<Metric>(DEFAULT_METRIC)
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set())
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  // C16 — one listener for the whole board; every tile's flipper reads it.
  const reduceMotion = useReducedMotion()

  const dateArg = pickedDate || undefined
  const urls = gexChangeTopUrls(dateArg)

  // C11, C12, C13 — BOTH feeds fired in the same tick, both polling at 60s.
  // `staleMs: 0` is v2's `{ cache: "no-store" }`; `pollMs` is v2's setInterval
  // pair. Polling pauses on a hidden tab, which v2 did not do — recorded as a
  // deliberate behaviour change in gexChangeTopData.ts.
  const top = useQuery<TopResponse>(urls.top, { staleMs: NO_STORE_STALE_MS, pollMs: POLL_MS })
  const res = useQuery<ResultsResponse>(urls.results, {
    staleMs: NO_STORE_STALE_MS,
    pollMs: POLL_MS,
  })

  const topV = topView(top.data, top.error)
  const resV = resultsView(res.data, res.error)

  // C8, C55 — "a failed /results load does not reset `frozen`". `useQuery`
  // replaces `data` wholesale, so the last-good flag is held here instead. The
  // write is idempotent for a given response, so doing it in render is safe.
  const frozenRef = useRef(false)
  if (resV.status === 'ok') frozenRef.current = resV.frozen
  const frozen = frozenRef.current

  const slots = topV.slots
  const results = resV.rows
  const feedDate = topV.date
  // C47 — the picker shows the resolved day once the feed echoes one back.
  const displayDate = pickedDate || feedDate

  // THE GATE, applied once here and read everywhere below.
  //
  // `viewSlots` is what the board renders; `okIds` is the same decision carried
  // across to the scorecard by `watch_id`, because a gate judged on the cards
  // but not on the averages tells you nothing. `counts` is the per-condition
  // diagnostic that rides on each switch.
  const gateIsOn = gateActive(gateOn)
  const viewSlots = useMemo(() => filterSlotsByGate(slots, gateOn), [slots, gateOn])
  const okIds = useMemo(
    () => (gateIsOn ? gateOkIdsFrom(slots, gateOn) : null),
    [slots, gateOn, gateIsOn],
  )
  const counts = useMemo(() => gateCounts(slots, gateOn), [slots, gateOn])
  const toggleGate = useCallback((key: keyof GateOn) => {
    setGateOn((g) => ({ ...g, [key]: !g[key] }))
  }, [])

  const summary = useMemo(
    () => scorecardSummary(results, scoreCheap, okIds),
    [results, scoreCheap, okIds],
  )
  const index: ScorecardIndex = useMemo(() => indexResults(results), [results])
  // viewSlots, not slots: the cheap-entry toggle counts CARDS ON SCREEN, and
  // "Flip all" must not fetch history for cards the gate is hiding.
  const cheapCards = useMemo(
    () => countCheapCards(viewSlots, index.cheapIds),
    [viewSlots, index],
  )
  const flippable = useMemo(() => flippableCards(viewSlots), [viewSlots])
  const allFlipped = flippable.length > 0 && flippable.every((f) => flipped.has(f.cid))

  const toggleFlip = useCallback((cid: string) => {
    setFlipped((prev) => {
      const next = new Set(prev)
      if (next.has(cid)) next.delete(cid)
      else next.add(cid)
      return next
    })
    // C15 — `opened` is additive and is never cleared by a flip-back, so a back
    // face that has already loaded its history stays mounted and a second flip
    // costs no request.
    setOpened((prev) => (prev.has(cid) ? prev : new Set(prev).add(cid)))
  }, [])

  const flipAll = useCallback(() => {
    if (allFlipped) {
      // C15 — `flipped` is cleared, `opened` is NOT.
      setFlipped(new Set())
      return
    }
    const cids = flippable.map((f) => f.cid)
    setFlipped(new Set(cids))
    setOpened((prev) => {
      const next = new Set(prev)
      for (const c of cids) next.add(c)
      return next
    })
  }, [allFlipped, flippable])

  const refresh = useCallback(() => {
    top.refetch()
    res.refetch()
  }, [top, res])

  const onDateChange = useCallback((v: string) => {
    // C47 — ALL flip state is discarded on a date change. The history cache is
    // not: it is keyed by `watch_id` inside `query()`, so a strike that appears
    // on two dates does not refetch.
    setPickedDate(v)
    setFlipped(new Set())
    setOpened(new Set())
  }, [])

  // C14 — above this many open cards the per-card history refresh stops
  // entirely. After a "Flip all" there can be ~65 open backs and re-polling all
  // of them would be 65 requests a minute for charts nobody is reading.
  const openCount = opened.size
  const historyPollMs =
    openCount > 0 && openCount <= OPEN_CARD_POLL_MAX ? POLL_MS : undefined

  return (
    <Card
      title={CARD_TITLE}
      actions={
        <ToolbarRow
          date={displayDate}
          onDateChange={onDateChange}
          onRefresh={refresh}
          onFlipAll={flipAll}
          flippableCount={flippable.length}
          allFlipped={allFlipped}
          gateOn={gateOn}
          gateIsOn={gateIsOn}
          counts={counts}
          onGate={toggleGate}
        />
      }
    >
      {/* C45 — the subtitle, and the ONLY loading affordance once data is on
          screen. Note it writes the ★ rule with `&` where the footer legend
          (C155) writes the same rule with `AND`; both are on screen at once.

          INK: `V2.green` #8ECAE6, v2's own subtitle colour. Step 2 moved it to
          `T.muted` as part of collapsing #8ECAE6's three jobs; 2026-09-03
          reverses that — the scanner renders v2's palette and #8ECAE6 splits by
          JOB, so the CHROME leg keeps v2's value while the positive leg goes to
          `V2.up`. See §SIGN COLOURS in gexChangeTop.ts. */}
      <p className="mb-3 text-xs" style={{ color: V2.green }}>
        {cardSubtitle(top.loading)}
      </p>

      <Scorecard
        results={results}
        summary={summary}
        frozen={frozen}
        resErr={resV.error}
        scoreCheap={scoreCheap}
        onScoreCheap={() => setScoreCheap((s) => !s)}
        cheapCards={cheapCards}
        gateOn={gateOn}
        showResults={showResults}
        onShowResults={() => setShowResults((s) => !s)}
      />

      {/* C88 — the feed error line. Rendered even while `loading` is true, and
          it suppresses C89 below. */}
      {topV.error && (
        <div className="py-2 text-sm" style={{ color: V2.red }}>
          {feedErrorLabel(topV.error)}
        </div>
      )}

      {/* C89 — first paint and the no-slots state, in one node. The gate adds a
          third case: rows WERE recorded and the switches hid every one of them.
          Without saying so the switches read as a broken fetch. */}
      {!topV.error && viewSlots.length === 0 && (
        <div className="px-1 py-4 text-sm" style={{ color: T.text }}>
          {top.loading
            ? noSlotsCopy(true)
            : slots.length > 0
              ? gateHidAllCopy(counts.total, gateOn)
              : noSlotsCopy(false)}
        </div>
      )}

      {/* C90 — server array order. There is no comparator on this tab. */}
      {viewSlots.map((hb) => (
        <SlotSection
          key={hb.slot}
          bucket={hb}
          date={displayDate}
          index={index}
          frozen={frozen}
          metric={metric}
          onMetric={setMetric}
          flipped={flipped}
          opened={opened}
          onToggle={toggleFlip}
          reduceMotion={reduceMotion}
          historyPollMs={historyPollMs}
          dateArg={dateArg}
        />
      ))}

      <FooterLegend slots={slots} />
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// C46–C50 — TOOLBAR
//
// v2's row also carried `⧉ Copy image` and `📷 Screenshot` (C51–C53). Both are
// gone: v3 has ONE owner-gated camera, in the page toolbar. See the REMOVED
// block at the top of gexChangeTop.ts.
// ─────────────────────────────────────────────────────────────────────────────

function ToolbarRow({
  date,
  onDateChange,
  onRefresh,
  onFlipAll,
  flippableCount,
  allFlipped,
  gateOn,
  gateIsOn,
  counts,
  onGate,
}: {
  date: string
  onDateChange: (v: string) => void
  onRefresh: () => void
  onFlipAll: () => void
  flippableCount: number
  allFlipped: boolean
  gateOn: GateOn
  gateIsOn: boolean
  counts: ReturnType<typeof gateCounts>
  onGate: (key: keyof GateOn) => void
}) {
  return (
    <>
      {/* C47 — reads "Date" for a beat on first paint, until the feed echoes a
          date back. v2's blank `mm/dd/yyyy` was the OS field's placeholder, and
          that field is gone: the platform calendar it opened was the one
          control in this toolbar that was not ours to paint. Same value
          contract, so `onDateChange` is untouched. */}
      <DatePicker
        size="sm"
        value={date}
        onChange={onDateChange}
        title="Capture date"
        label={(v) => v}
        className="shrink-0"
      />
      {/* C48 — never disabled, even mid-load. */}
      <ToolButton label={REFRESH_LABEL} onClick={onRefresh} />
      {/* C49 — disabled when nothing on the page was auto-probed. */}
      <ToolButton
        label={flipAllLabel(flippableCount, allFlipped)}
        onClick={onFlipAll}
        disabled={flippableCount === 0}
        title={allFlipped ? FLIP_ALL_TITLE_BACK : FLIP_ALL_TITLE_FLIP}
        color={allFlipped ? V2.cyan : undefined}
        borderColor={allFlipped ? alpha(V2.cyan, 0.5) : undefined}
      />
      {/* THE GATE — three independent switches, no v2 counterpart. Each carries
          the count IT ALONE rejects, measured with the other two ignored, so the
          binding condition is on screen rather than inferred. That is the whole
          reason this is three controls and not one: the single all-three button
          it replaced removed 53 of 54 picks and could not say which test did it. */}
      <span
        className="flex shrink-0 items-center gap-1.5 rounded-sm border px-1.5 py-0.5"
        style={{ borderColor: gateIsOn ? alpha(V2.cyan, 0.35) : V2W.border }}
      >
        <span
          className="text-3xs font-semibold uppercase tracking-wide"
          style={{ color: T.text }}
          title={
            'View filters over the picks already recorded — they change nothing about what the recorder captures. ' +
            'Each switch filters the cards AND the scorecard, so the averages are that combination’s actual record. ' +
            'The count on a switch is how many of this date’s picks IT ALONE rejects, with the others ignored; ' +
            'they will not sum to the total, because a pick can fail more than one.'
          }
        >
          Gate
        </span>
        {GATE_TESTS.map((t) => (
          <ToolButton
            key={t.key}
            label={`${t.label} −${counts.alone[t.key]}`}
            onClick={() => onGate(t.key)}
            title={gateSwitchTitle(t.key, t.label, counts.alone[t.key], counts.total)}
            color={gateOn[t.key] ? V2.cyan : undefined}
            borderColor={gateOn[t.key] ? alpha(V2.cyan, 0.5) : undefined}
          />
        ))}
        {gateIsOn && (
          <span
            className="tabular shrink-0 text-3xs"
            style={{ color: T.text }}
            title="Picks hidden by the switches that are currently on, together."
          >
            −{counts.hidden} of {counts.total}
          </span>
        )}
      </span>
      {/* C50 — the hint. In v2 it named the whole tile as the control; here the
          control is the "▸ price line" button on each card (C123), which is the
          same affordance and the same words. */}
      <span className="text-xs" style={{ color: T.text }}>
        {TOOLBAR_HINT}
      </span>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// C54–C87 — THE SCORECARD
// ─────────────────────────────────────────────────────────────────────────────

function Scorecard({
  results,
  summary,
  frozen,
  resErr,
  scoreCheap,
  onScoreCheap,
  cheapCards,
  gateOn,
  showResults,
  onShowResults,
}: {
  results: ResultRow[]
  summary: ReturnType<typeof scorecardSummary>
  frozen: boolean
  resErr: string | null
  scoreCheap: boolean
  onScoreCheap: () => void
  cheapCards: number
  /** Named in the basis line so the averages always say what they were computed over. */
  gateOn: GateOn
  showResults: boolean
  onShowResults: () => void
}) {
  const columns = useMemo(() => scorecardColumns(frozen), [frozen])

  return (
    <section className="mb-5">
      <div className="mb-2 flex flex-wrap items-baseline gap-2.5">
        {/* C54 — renders even when there is nothing to show and the table is hidden. */}
        <span className="text-base font-extrabold" style={{ color: V2.orange }}>
          {SCORECARD_TITLE}
        </span>
        {/* C55 — NOT a button. `frozen` defaults to false, so a failed load
            shows the LIVE wording rather than admitting it has nothing. */}
        <StaticPill label={scorecardFreshnessLabel(frozen)} className="text-3xs" />

        {/* C57–C62 — the summary line. Omitted entirely at zero picks.
            WATCH THE DENOMINATORS: avg peak and the three ≥ counts are over
            `withPeak`; "closed green" is over `filtered`. */}
        {summary.count > 0 && (
          <span className="text-xs" style={{ color: T.text }}>
            {picksLabel(summary.count)} ({scorecardBasisLabel(scoreCheap, gateOn)}) ·{' '}
            {SUMMARY_LABELS.avgPeak}{' '}
            {/* C58 — NULL IS PAINTED DOWN here, and prints an em dash. */}
            <b style={{ color: avgPeakColor(summary.avgPeak) }}>{fmtPctSigned(summary.avgPeak)}</b>
            {' · '}
            {SUMMARY_LABELS.hit25} <b style={{ color: T.text }}>{summary.hit25}</b>
            {' · '}
            {SUMMARY_LABELS.hit50} <b style={{ color: T.text }}>{summary.hit50}</b>
            {' · '}
            {SUMMARY_LABELS.hit100} <b style={{ color: T.text }}>{summary.hit100}</b>
            {' · '}
            {/* C62 — STRICT `> 0`, so a flat close does not count here while
                C85 paints that same flat close in the UP colour. */}
            {SUMMARY_LABELS.greenClose} <b style={{ color: T.text }}>{summary.greenClose}</b>
          </span>
        )}

        <span className="flex-1" />

        {/* C63 — legacy slots only; absent once nothing on the date is cheap. */}
        {(cheapCards > 0 || scoreCheap) && (
          <Chip
            label={cheapToggleLabel(scoreCheap, cheapCards)}
            on={scoreCheap}
            onClick={onScoreCheap}
            title={cheapToggleTitle(cheapCards)}
          />
        )}
        {/* C65 — hides the strip, the empty state and the table. NOT the title,
            the pill, the summary line, the toggles or the error line. */}
        <Chip label={showResultsLabel(showResults)} on={showResults} onClick={onShowResults} />
      </div>

      {/* C66–C70 — the grade distribution strip. */}
      {showResults && !resErr && summary.graded.length > 0 && (
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs" style={{ color: T.text }}>
            {GRADES_LABEL}
          </span>
          {/* C68 — all six, in GRADE_ORDER, always. A zero count still renders,
              dimmed. */}
          {GRADE_ORDER.map((g) => (
            <span
              key={g}
              title={GRADE_NOTE[g]}
              className="inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-xs font-bold leading-none"
              style={{
                color: GRADE_COLOR[g],
                borderColor: alpha(GRADE_COLOR[g], 0.4),
                background: alpha(GRADE_COLOR[g], 0.12),
                opacity: summary.gradeCounts[g] ? 1 : 0.3,
              }}
            >
              {g}
              <b className="ml-0.5">{summary.gradeCounts[g]}</b>
            </span>
          ))}
          <span className="ml-1.5 text-xs" style={{ color: T.text }}>
            {GPA_LABEL}{' '}
            <b className="font-mono" style={{ color: V2.cyan }}>
              {fmtGpa(summary.gpa)}
            </b>
            {' · '}
            <span title={NEVER_GREEN_TITLE}>
              {NEVER_GREEN_LABEL}{' '}
              {/*
                C70, and the visible half of the `gradeFor` BUG. `neverGreen` is
                computed on BOTH grade paths and ACTED ON by only one, so a
                server row shipping `grade: "B"` with `max_pct <= 0` shows a B
                pill in the table below AND is counted in this figure. The two
                halves of the same strip disagree about the same pick.
              */}
              <b className="font-mono" style={{ color: neverGreenColor(summary.neverGreen) }}>
                {fmtNeverGreen(summary.neverGreen, summary.neverGreenPct)}
              </b>
            </span>
          </span>
        </div>
      )}

      {/* C71 — outside the show/hide gate on purpose. When set, the strip, the
          empty state and the table are all suppressed. */}
      {resErr && (
        <div className="py-1 text-sm" style={{ color: V2.red }}>
          {scorecardErrorLabel(resErr)}
        </div>
      )}

      {showResults && !resErr && (
        <>
          {/*
            C73 — SERVER ORDER. No sort key, no default column, no direction, no
            comparator, no header click handlers. `Table` is given `columns` and
            `rows` and nothing else.

            C72 — the empty copy. `scorecardEmptyCopy` returns the VERBATIM v2
            below-floor string, which names a button — “show ≤ $0.50” — that does
            not exist: the real toggle above reads "score ≤ $0.50 too (N)" and
            only renders when there is something cheap to include. The corrected
            wording is exported beside it as SCORECARD_EMPTY_BELOW_FLOOR_FIXED
            and is deliberately NOT used here — the wrong string is what ships,
            because step 3 reproduces v2 rather than fixing it.
          */}
          <Table<ResultRow>
            columns={columns}
            rows={summary.filtered}
            rowKey={resultRowKey}
            empty={
              <span style={{ color: T.text }}>{scorecardEmptyCopy(results.length)}</span>
            }
          />
          {/* C87 — disappears with the table, so it never sits under the empty state. */}
          {summary.filtered.length > 0 && (
            <div className="mt-1.5 text-xs" style={{ color: T.text }}>
              {SCORECARD_FOOTNOTE}
            </div>
          )}
        </>
      )}
    </section>
  )
}

/**
 * C74–C86 — the twelve columns, built from the ordered list in gexChangeTop.ts
 * so the labels and the order are never retyped here.
 *
 * The headers take the primitive's own `text-muted` chrome. v2 painted all
 * twelve `HOME_THEME.green` — the same value as a positive Peak % underneath
 * them. Since 2026-09-03 that value is the CHROME leg of the #8ECAE6 split
 * (`V2.green`) and the positive takes `V2.up`, so the two no longer collide;
 * these headers stay on the primitive because the scanner does not own `Table`.
 * Recorded in §SIGN COLOURS in gexChangeTop.ts.
 */
function scorecardColumns(frozen: boolean): Column<ResultRow>[] {
  const cell: Record<string, (r: ResultRow) => ReactNode> = {
    // C75 — an ungraded row leaves the cell EMPTY. No dash.
    grade: (r) => <GradePill info={gradeFor(r)} provisional={!frozen} />,
    // C76
    symbol: (r) => <span className="font-extrabold">{r.symbol}</span>,
    // C77 — `sideColor` paints anything that is not "P" as a call, `null`
    // included, so a row with no side at all is still call-coloured.
    contract: (r) => (
      <span style={{ color: sideColor(r.side) }}>
        {fmtStrike(r.strike)}
        {r.side ?? ''} <span style={{ color: T.text }}>{r.expiry}</span>
      </span>
    ),
    // C78 — " ET" stripped, so the zone is unlabelled here. The ×N multiplier
    // is NOT visually distinguished; v2 painted it the same colour.
    flagged: (r) => (
      <span style={{ color: T.text }}>
        {flaggedLabel(r.first_slot)}
        {slotsMultiplier(r.slots)}
      </span>
    ),
    entry: (r) => fmtPx(r.entry), // C79
    peak: (r) => fmtPx(r.max_mark), // C80
    peakAt: (r) => <span style={{ color: T.text }}>{fmtClock(r.max_ts)}</span>, // C81
    // C82 — `peakPctTableColor` is `>= 0`, so a break-even pick paints UP here
    // while `peakPctCardColor` (`> 0`) paints the SAME value DOWN on the card
    // and `pnlColor` paints it NEUTRAL on the card back. Three inks, one number,
    // all three on screen at once — see the `// BUG (v2):` marker at §SIGN
    // COLOURS in gexChangeTop.ts.
    peakPct: (r) => (
      <span className="font-extrabold" style={{ color: peakPctTableColor(r.max_pct) }}>
        {fmtPctSigned(r.max_pct)}
      </span>
    ),
    // C83 — strictly from `r.max_mark`, unlike the card's version which may use
    // the client fallback peak. NEVER coloured by sign, unlike Peak % beside it.
    perContract: (r) => {
      const d = peakDollarsFromRow(r)
      return <span style={{ color: T.text }}>{d == null ? EM_DASH : fmtDollarsPerContract(d)}</span>
    },
    close: (r) => fmtPx(r.close_mark), // C84
    // C85 — same `>= 0` rule as Peak %, and it disagrees with C62's strict `> 0`
    // "closed green" counter about a flat close.
    closePct: (r) => (
      <span style={{ color: closePctTableColor(r.close_pct) }}>{fmtPctSigned(r.close_pct)}</span>
    ),
    // C86 — NEVER coloured. A −60% MAE is the same ink as a −2% one, even though
    // it is the pain ladder's whole input.
    lowPct: (r) => <span style={{ color: T.text }}>{fmtPctSigned(r.min_pct)}</span>,
    // 2026-09-23 — the sustained peak the grade is scored on.
    heldPct: (r) => (
      <span style={{ color: r.sustained_pct == null ? T.text : peakPctTableColor(r.sustained_pct) }}>
        {fmtPctSigned(r.sustained_pct ?? null)}
      </span>
    ),
    volOi: (r) => <span style={{ color: T.text }}>{fmtVolOi(r.entry_vol_oi)}</span>,
    tape: (r) => {
      const net = r.flow_n != null && r.flow_n > 0 && r.flow_buy != null && r.flow_sell != null
        ? r.flow_buy - r.flow_sell
        : null
      return <span style={{ color: flowColor(net) }}>{fmtFlow(net)}</span>
    },
  }

  return SCORECARD_COLUMNS.map((c) => ({
    key: c.key,
    header: c.label,
    align: c.align,
    numeric: c.align === 'right',
    cell: (r: ResultRow) => cell[c.key]?.(r) ?? null,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// C90–C95 — SLOT SECTIONS
// ─────────────────────────────────────────────────────────────────────────────

function SlotSection({
  bucket,
  date,
  index,
  frozen,
  metric,
  onMetric,
  flipped,
  opened,
  onToggle,
  reduceMotion,
  historyPollMs,
  dateArg,
}: {
  bucket: SlotBucket
  date: string
  index: ScorecardIndex
  frozen: boolean
  metric: Metric
  onMetric: (m: Metric) => void
  flipped: ReadonlySet<string>
  opened: ReadonlySet<string>
  onToggle: (cid: string) => void
  reduceMotion: boolean
  historyPollMs: number | undefined
  dateArg: string | undefined
}) {
  return (
    <section className="mb-6">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5">
        {/* C92 — cyan for a live trigger section, orange for a scheduled capture. */}
        <span className="text-base font-extrabold" style={{ color: slotHeaderColor(bucket.live) }}>
          {slotLabel(bucket.slot)}
        </span>
        {/* C93 — a live section is a CROSSING, not a leaderboard: it usually
            holds one or two cards, and this badge is the only thing that stops
            that reading as four missing picks. */}
        {bucket.live && (
          <span
            title={LIVE_TRIGGER_TITLE}
            className="rounded-sm border px-1.5 py-px text-2xs font-extrabold tracking-wide"
            style={{
              color: V2.cyan,
              background: alpha(V2.cyan, 0.12),
              borderColor: alpha(V2.cyan, 0.45),
            }}
          >
            {LIVE_TRIGGER_BADGE}
          </span>
        )}
        {/* C94 */}
        <span className="text-xs" style={{ color: T.text }}>
          {picksLabel(bucket.rows.length)}
        </span>
      </div>

      {/* C95 — v2's five-then-3/2/1 grid, on the standard breakpoints rather
          than its four hand-written px media queries. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {bucket.rows.map((row) => (
          <PickCard
            // C107 — the React key. It is NOT `cardId` (C96), which omits the
            // expiry; two expiries on one symbol+strike in one slot therefore
            // render as two tiles that SHARE flip state. Transcribed as written.
            key={cardRenderKey(row)}
            row={row}
            slot={bucket.slot}
            date={date}
            index={index}
            frozen={frozen}
            metric={metric}
            onMetric={onMetric}
            flipped={flipped}
            opened={opened}
            onToggle={onToggle}
            reduceMotion={reduceMotion}
            historyPollMs={historyPollMs}
            dateArg={dateArg}
          />
        ))}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// C96–C124 — THE PICK TILE: THE FLIPPER, AND THE FRONT FACE
//
// THREE BOXES, AND EACH ONE HAS TO BE THE BOX IT IS:
//
//   tile     position: relative · minHeight 260 · perspective 1200
//     └ flipper   position: absolute · inset 0 · preserve-3d · rotateY(0|180)
//         ├ front   position: absolute · inset 0 · backface-visibility hidden
//         └ back    the same, plus its own rotateY(180deg)
//
// The flipper MUST be `absolute + inset: 0`. Both faces are absolutely
// positioned against it, so left in normal flow it has no in-flow children,
// computes to zero height, and the whole tile collapses. (v2's own comment, and
// it is the first thing that breaks if someone "simplifies" this.)
//
// `perspective` MUST be on the tile, not the flipper: it has to come from an
// ancestor of the rotating box. On the flipper itself the rotation is
// orthographic and the card reads as a horizontal squash, not a turn.
//
// The two faces occupy the SAME footprint — one `minHeight` on the tile, `inset:
// 0` on both faces — so the back REPLACES the front rather than appearing under
// it, and flipping cannot resize the card or reflow the grid around it.
// ─────────────────────────────────────────────────────────────────────────────

function PickCard({
  row,
  slot,
  date,
  index,
  frozen,
  metric,
  onMetric,
  flipped,
  opened,
  onToggle,
  reduceMotion,
  historyPollMs,
  dateArg,
}: {
  row: Row
  slot: string
  date: string
  index: ScorecardIndex
  frozen: boolean
  metric: Metric
  onMetric: (m: Metric) => void
  flipped: ReadonlySet<string>
  opened: ReadonlySet<string>
  onToggle: (cid: string) => void
  reduceMotion: boolean
  historyPollMs: number | undefined
  dateArg: string | undefined
}) {
  // The FRONT reads nothing out of the history — its entry basis, peak and
  // grade all come off the scorecard row (C98, C99, C114). So it derives with
  // `hist: undefined`, and the back derives again with the real history inside
  // PickBack, where the fetch lives. Same inputs, same values; only the three
  // history-fed fields (peak fallback, lastMark, pnl) differ, and the front
  // does not render any of them.
  const v = derivePickCard({ row, slot, date, index, hist: undefined })
  const isFlipped = flipped.has(v.cid)
  const hasBack = isFlipped || opened.has(v.cid)

  // Expand + snapshot (2026-09-24). See PER-CARD EXPAND + SNAPSHOT above.
  const tileRef = useRef<HTMLDivElement | null>(null)
  const stage = useExpandStage()
  const exKey = `gct:${v.cid}`
  const [localOpen, setLocalOpen] = useState(false)
  const isExpanded = stage ? stage.expandedId === exKey : localOpen
  const expandCard = useCallback(() => {
    if (stage) stage.expand(exKey)
    else setLocalOpen(true)
  }, [stage, exKey])
  const collapseCard = useCallback(() => {
    if (stage) stage.collapse(exKey)
    else setLocalOpen(false)
  }, [stage, exKey])
  useEffect(() => {
    if (stage || !localOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLocalOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, localOpen])
  // Collapse on unmount so a card that leaves the board cannot pin the stage.
  const collapseRef = useRef(collapseCard)
  collapseRef.current = collapseCard
  const expandedRef = useRef(isExpanded)
  expandedRef.current = isExpanded
  useEffect(
    () => () => {
      if (expandedRef.current) collapseRef.current()
    },
    [],
  )
  const shotLabel = `${row.symbol} ${fmtStrike(row.strike)}${v.side} · GEX Change Top`
  const shotTarget = useMemo(
    () => ({
      id: `gct-card:${v.cid}`,
      icon: '📈',
      label: shotLabel,
      capture: () => shootTile(tileRef.current, shotLabel),
    }),
    [v.cid, shotLabel],
  )
  const expandedView =
    isExpanded && v.wid != null ? (
      <ExpandedPick
        row={row}
        slot={slot}
        date={date}
        index={index}
        frozen={frozen}
        metric={metric}
        onMetric={onMetric}
        onClose={collapseCard}
        pollMs={historyPollMs}
        dateArg={dateArg}
        shotLabel={shotLabel}
      />
    ) : null

  return (
    <div
      ref={tileRef}
      // C107 — a row with no `watch_id` has no tooltip, because it is also not
      // flippable: it was never auto-probed, so there is no price line to show.
      title={cardTitle(row, v.side, v.wid, isFlipped)}
      className="relative"
      style={{
        minHeight: FLIP_MIN_HEIGHT,
        perspective: FLIP_PERSPECTIVE,
        // C106, C107 — present but discounted. The card stays because removing
        // it would leave the hour a pick short (rank 6 was never recorded).
        opacity: v.underFloor ? 0.62 : 1,
      }}
    >
      <div
        /*
          C108 — THE FLIPPER.

          `data-flip3d` is kept as v2 wrote it, and it is the ONLY survivor of
          v2's capture attribute protocol: `data-noshot`, `data-card` and
          `data-face` are gone with html2canvas (see the REMOVED block at the top
          of gexChangeTop.ts). CAPTURE ITSELF IS NOT PORTED — v3 has one
          owner-gated camera in the page toolbar and nothing here reads this
          attribute. It stays because it documents, in the DOM, which face is
          actually facing the viewer: that is not otherwise legible from a
          transform, it is what a devtools inspection and any future flattening
          capture would key on, and it costs one string.
        */
        data-flip3d={isFlipped ? 'back' : 'front'}
        // MUST be absolute + inset 0 — see the box diagram above.
        className="absolute inset-0"
        style={{
          transformStyle: 'preserve-3d',
          // C16 — reduced motion is an instant face swap: the same rotation,
          // with no transition to interpolate it.
          transition: reduceMotion ? FLIP_TRANSITION_NONE : FLIP_TRANSITION,
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          // C108 — promoted ONLY on tiles that have actually been opened.
          // Unconditionally it would hand the compositor ~65 layers, on a board
          // where most tiles are never turned over.
          willChange: hasBack ? 'transform' : undefined,
        }}
      >
        <div
          /* C125 — the front face. Same box as the back (`inset: 0`), v2's
             12px/14px padding, and `backfaceVisibility: hidden` so it stops
             painting the moment the flipper passes 90°. */
          className={`${FACE_CLASS} p-3`}
          style={FACE_STYLE}
          // The turned-away face is already out of the hit test (backface
          // visibility) but NOT out of the tab order; `inert` is what keeps a
          // keyboard off the face nobody can see. v2 had no equivalent, and the
          // block-under-front port got it for free from `hidden`.
          inert={isFlipped}
        >
          {/* C111, C112 — the rank sits inside the symbol span, same ink, one gap
              apart, so it reads as part of the ticker. */}
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-lg font-extrabold" style={{ color: T.text }}>
              <span className="mr-1.5" style={{ color: T.text }}>
                {row.rank}
              </span>
              {row.symbol}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-sm" style={{ color: T.text }}>
                {fmtStrike(row.strike)}
              </span>
              {v.wid != null && (
                <CardIconButton glyph={EXPAND_GLYPH} title={EXPAND_TITLE} onClick={expandCard} />
              )}
              <CopyShotButton target={shotTarget} className="shrink-0 text-sm leading-none" />
            </span>
          </div>

          {/* C113 — the Δ headline, and the FOURTH zero convention on this tab: a
              null `latest_chg` coalesces to 0 before the `>= 0` test, so the em dash
              — the "no data" glyph — is painted in the UP colour. `deltaColor` keeps
              that as written. C114 — the grade pill at the larger size, off the SAME
              scorecard row the entry basis came from. */}
          <div className="flex items-center justify-between gap-2">
            <div className="text-lg font-extrabold leading-tight" style={{ color: deltaColor(row.latest_chg) }}>
              {fmtBig(row.latest_chg)}
            </div>
            <GradePill info={v.grade} provisional={!frozen} size="lg" />
          </div>

          {/* C115 */}
          <div className="mt-1 text-sm" style={{ color: T.text }}>
            {row.expiry} · {SPOT_LABEL} {fmtSpot(row.spot)}
          </div>
          {/* C116 — every card carries its own capture stamp. In v2 that was because
              the slot header above was stripped from screenshots; here it survives
              because a single tile still has to say WHEN it was taken. */}
          <div className="mt-0.5 text-xs" style={{ color: T.text }}>
            {CAPTURED_LABEL_PREFIX} {v.captured}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-sm">
            {/* C117 — the span is omitted ENTIRELY when spot is null or ≤ 0, and the
                row closes up. Unsigned: a strike either side of spot reads "OTM". */}
            {v.otmPct != null && <span style={{ color: V2.orange }}>{fmtOtm(v.otmPct)}</span>}
            {/* C118 — the span renders even when null, unlike C117. */}
            <span style={{ color: pctOpenColor(row.pct_open) }}>{fmtPctOpen(row.pct_open)}</span>
            {/* C119 — server-computed. The formula is the footer legend (C154). */}
            {(() => {
              const sc = cardScore(row)
              return (
                <span style={{ color: V2.cyan }} title={sc.abs ? SCORE_ABS_TITLE : SCORE_REL_TITLE}>
                  {fmtScore(sc.v)}
                </span>
              )
            })()}
            {/* 2026-09-23 — signed tape BEFORE the flag. Omitted when there were
                no prints (null), rather than a dash: most early picks will not
                have been on the tape yet. */}
            {preFlagNet(row) != null && (
              <span title={TAPE_CHIP_TITLE} style={{ color: flowColor(preFlagNet(row)) }}>
                {TAPE_LINE_LABEL} {fmtFlow(preFlagNet(row))}
              </span>
            )}
            {/* 2026-09-24 — the TICKER's board at the flag vs this pick's side.
                Omitted on rows captured before the stamp. */}
            {regimeChipLabel(row) != null && (
              <span title={regimeChipTitle(row)} style={{ color: alignColor(rowAlign(row)) }}>
                {regimeChipLabel(row)}
              </span>
            )}
            {/* C120 — renders nothing when `proj_grade` is null, the shipping default. */}
            <ProjPill grade={row.proj_grade} pts={row.proj_pts} />
          </div>

          {/* C121 — every card on this tab carries it; there is no second tier. */}
          <div className="mt-1.5 text-sm font-extrabold" style={{ color: V2.orange }}>
            {VERY_STRONG_LABEL}
            {/* C122 — legacy slots only. The `?? 0` inside `underFloorTitle` is v2's
                and is unreachable: `underFloor` implies the id is in `cheapIds`,
                which implies an entry exists. */}
            {v.underFloor && (
              <span
                title={underFloorTitle(v.wid != null ? index.entryById.get(v.wid) : undefined)}
                className="ml-1.5 rounded-sm border px-1 py-px text-xs font-bold"
                style={{
                  color: T.text,
                  background: alpha(T.text, 0.1),
                  borderColor: alpha(T.text, 0.25),
                }}
              >
                {UNDER_FLOOR_BADGE}
              </span>
            )}
          </div>

          {/* C123 — the flip affordance, and in v3 the flip CONTROL. v2 made the
              whole tile clickable and this a hint; a real button is the same
              affordance without a div that swallows pointer events. Absent for a
              pre-auto-probe row, which has no price line to show.

              Pinned to the bottom-left as v2 pinned it (left 14, bottom 8): the
              front face is now a fixed-height box, so in flow it would float in the
              middle of whatever space the content left. */}
          {v.wid != null && (
            <button
              type="button"
              onClick={() => onToggle(v.cid)}
              aria-expanded={isFlipped}
              title={isFlipped ? CARD_BACK_TO_PICK : undefined}
              className="absolute bottom-2 left-3.5 text-xs"
              style={{ color: alpha(V2.cyan, 0.75) }}
            >
              {PRICE_LINE_HINT}
            </button>
          )}
        </div>

        {/*
          C125 — THE BACK FACE. It REPLACES the front in the same footprint: same
          `inset: 0`, its own `rotateY(180deg)` so it starts turned away, and
          `backfaceVisibility: hidden` so exactly one of the two is ever painted.

          MOUNTED LAZILY, AND THIS IS NOT AN OPTIMISATION TO TIDY AWAY. The back
          is where the `/proxy/gex-change-top-history` fetch lives (see PickBack),
          so mounting all ~65 backs at page load would fire ~65 history requests
          for charts nobody has asked for — C14 and C15 exist to prevent exactly
          that. A click mounts the back and THEN the flipper rotates, which is
          also what v2 did: it fetched on open too.

          `hasBack` is `isFlipped || opened.has(cid)`, and `opened` is never
          cleared by a flip-back — so once a card has been turned over its back
          stays mounted, the flip-back animates with real content behind it
          instead of an empty face, and a second flip costs no request.
        */}
        {hasBack && (
          <PickBack
            row={row}
            slot={slot}
            date={date}
            index={index}
            frozen={frozen}
            metric={metric}
            onMetric={onMetric}
            onClose={() => onToggle(v.cid)}
            facingAway={!isFlipped}
            pollMs={historyPollMs}
            dateArg={dateArg}
            onExpand={expandCard}
            shotTarget={shotTarget}
          />
        )}
      </div>
      {expandedView &&
        (stage
          ? stage.stage && createPortal(expandedView, stage.stage)
          : createPortal(
              <div className="fixed inset-0 z-50 flex flex-col bg-bg p-3">{expandedView}</div>,
              document.body,
            ))}
    </div>
  )
}

/**
 * The expanded card: the back face at page size, plus the front's numbers. Its
 * own queries share the tile's cache entries (same URLs), so opening it costs
 * no request the tile has not already made.
 */
function ExpandedPick(props: {
  row: Row
  slot: string
  date: string
  index: ScorecardIndex
  frozen: boolean
  metric: Metric
  onMetric: (m: Metric) => void
  onClose: () => void
  pollMs: number | undefined
  dateArg: string | undefined
  shotLabel: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const { shotLabel } = props
  const target = useMemo(
    () => ({
      id: `gct-card-expanded:${props.row.watch_id ?? props.row.symbol}`,
      icon: '📈',
      label: shotLabel,
      capture: () => shootTile(ref.current, shotLabel),
    }),
    [props.row.watch_id, props.row.symbol, shotLabel],
  )
  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      <PickBack {...props} facingAway={false} variant="expanded" shotTarget={target} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// C125–C138 — THE PICK CARD, BACK FACE
//
// The history fetch lives HERE, not in the tab, for one reason: it must not
// happen until a card is opened. ~65 tiles fetching a session's snapshots at
// mount is the request storm C14 and C15 exist to prevent. That is also why this
// component IS the face rather than something rendered inside one: mounting it
// and mounting the fetch are the same event.
//
// v2's order, top to bottom, and the order below:
//   ticker + strike badge → capture line → PEAK headline + grade pill →
//   IN → HIGH line → NOW line → the 1D | Price | Net GEX toolbar → chart → hint
// ─────────────────────────────────────────────────────────────────────────────

function PickBack({
  row,
  slot,
  date,
  index,
  frozen,
  onClose,
  facingAway,
  pollMs,
  dateArg,
  variant = 'face',
  onExpand,
  shotTarget,
}: {
  row: Row
  slot: string
  date: string
  index: ScorecardIndex
  frozen: boolean
  metric: Metric
  onMetric: (m: Metric) => void
  onClose: () => void
  facingAway: boolean
  pollMs: number | undefined
  dateArg: string | undefined
  /** 'expanded' = the page-size view: no rotation, a tall chart, front stats. */
  variant?: 'face' | 'expanded'
  onExpand?: () => void
  shotTarget?: Parameters<typeof CopyShotButton>[0]['target']
}) {
  const expanded = variant === 'expanded'
  const wid = row.watch_id
  // C10 — keyed by `watch_id`, so the same contract in several slots shares one
  // request and one cache entry inside `query()`. That is the whole reason a
  // "Flip all" over ~65 tiles is not 65 requests.
  const q = useQuery<HistoryResponse>(wid != null ? pickHistoryUrl(wid, dateArg) : null, {
    staleMs: HISTORY_STALE_MS,
    pollMs,
  })
  // Memoised so the RTH filter runs once per response, not once per render:
  // `points` is a prop of the chart, and a fresh array every render would make
  // the chart redraw on every parent render for data that has not moved.
  const hist = useMemo(() => pickHistView(q.data, q.error), [q.data, q.error])
  // The SIGNED tape on this contract (2026-09-23). Same lifecycle as the
  // history: mounted with the back, keyed by watch_id, polled with it.
  const fq = useQuery<FlowResponse>(wid != null ? pickFlowUrl(wid, dateArg) : null, {
    staleMs: HISTORY_STALE_MS,
    pollMs,
  })
  const tape = fq.data?.ok ? fq.data : undefined
  const v = derivePickCard({ row, slot, date, index, hist })
  // The probe snapshots as ProbeChart bars: one flat bar per 60s mark, volume =
  // the change in the contract's day volume since the previous snapshot.
  const bars = useMemo<Bar[]>(() => {
    const out: Bar[] = []
    let prevVol: number | null = null
    for (const p of hist?.points ?? []) {
      const m = p.mark
      if (m == null || !Number.isFinite(m) || m <= 0) continue
      let vol = 0
      const cum = p.volume
      if (cum != null && Number.isFinite(cum)) {
        vol = prevVol != null ? Math.max(0, cum - prevVol) : 0
        prevVol = cum
      }
      out.push({ time: Number(p.ts), open: m, high: m, low: m, close: m, volume: vol })
    }
    return out
  }, [hist])
  // Where the ring goes: the scorecard's entry snapshot, else the first mark.
  const entryTs =
    (wid != null ? index.resultById.get(wid)?.entry_ts : null) ?? bars[0]?.time ?? null

  return (
    <div
      /* C125 — the same surface as the front, turned around, at v2's tighter
         10px/12px padding (the front is 12/14). `inset: 0` makes this the SAME
         footprint as the front rather than a block beneath it. */
      className={
        expanded
          ? 'flex min-h-0 flex-1 flex-col overflow-auto rounded-md border px-5 py-4'
          : `${FACE_CLASS} px-3 py-2.5`
      }
      style={expanded ? { borderColor: V2W.border, background: V2W.panelBg } : BACK_FACE_STYLE}
      // Out of the tab order while it is turned away — the mirror of the front
      // face's guard. Purely an interaction gate: it does not affect the paint,
      // so the first half of a flip-back still shows this face rotating away.
      inert={facingAway}
    >
      {/* C126 — the badge takes the CARD's derived side (strike vs spot), which
          can disagree with the scorecard's server `side` for the same contract
          (C77). Both are transcribed; neither is authoritative in v2.
          C128 — the "×" is the flip control, not a capture control, so it stays. */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 overflow-hidden whitespace-nowrap">
          <span className="text-base font-extrabold" style={{ color: T.text }}>
            {row.symbol}
          </span>
          <span
            className="ml-1.5 rounded-sm border px-1 py-px font-mono text-xs font-bold"
            style={{
              color: sideColor(v.side),
              background: alpha(sideColor(v.side), 0.12),
              borderColor: alpha(sideColor(v.side), 0.4),
            }}
          >
            {fmtStrike(row.strike)}
            {v.side}
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          {!expanded && onExpand && (
            <CardIconButton glyph={EXPAND_GLYPH} title={EXPAND_TITLE} onClick={onExpand} />
          )}
          {shotTarget && <CopyShotButton target={shotTarget} className="shrink-0 text-sm leading-none" />}
          <button
            type="button"
            data-capture-hide
            onClick={onClose}
            title={expanded ? 'Close (Esc)' : CARD_BACK_TO_PICK}
            className="shrink-0 px-0.5 text-base leading-none"
            style={{ color: T.text }}
          >
            {CARD_CLOSE_GLYPH}
          </button>
        </span>
      </div>

      {/* C129 */}
      <div className="mt-0.5 font-mono text-2xs" style={{ color: T.text }}>
        {row.expiry} · {v.captured}
      </div>

      {/* Expanded only — the front face's numbers, so the big view is the whole
          card rather than just its back. */}
      {expanded && (
        <div className="mt-1.5 flex flex-wrap items-center gap-3 font-mono text-sm" style={{ color: T.text }}>
          <span className="font-extrabold" style={{ color: deltaColor(row.latest_chg) }}>
            Δ {fmtBig(row.latest_chg)}
          </span>
          {v.otmPct != null && <span style={{ color: V2.orange }}>{fmtOtm(v.otmPct)}</span>}
          <span style={{ color: pctOpenColor(row.pct_open) }}>{fmtPctOpen(row.pct_open)}</span>
          {(() => {
            const sc = cardScore(row)
            return (
              <span style={{ color: V2.cyan }} title={sc.abs ? SCORE_ABS_TITLE : SCORE_REL_TITLE}>
                {fmtScore(sc.v)}
              </span>
            )
          })()}
          {regimeChipLabel(row) != null && (
            <span title={regimeChipTitle(row)} style={{ color: alignColor(rowAlign(row)) }}>
              {regimeChipLabel(row)}
            </span>
          )}
          <span className="text-xs opacity-80">{regimeChipTitle(row)}</span>
        </div>
      )}

      <div className="mb-1 mt-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-1 whitespace-nowrap">
            {/*
              C130 — the headline is the PEAK, not "now": the card answers "was
              there a trade in it", not "what would I be holding at 3:55 PM".

              And this is the SECOND of the three zero conventions.
              `peakPctCardColor` is strict `> 0`, so a break-even pick paints
              DOWN here while the scorecard's Peak % column (`>= 0`) paints the
              same number UP, and the "now" line below (`pnlColor`) paints it
              NEUTRAL. See the `// BUG (v2):` marker at §SIGN COLOURS.
            */}
            <div
              className="whitespace-nowrap font-mono text-lg font-extrabold leading-tight"
              style={{ color: peakPctCardColor(v.peakPct) }}
            >
              {fmtPeakHeadline(v.peakPct)}
            </div>
            {/* C131 */}
            <span className="text-3xs uppercase tracking-wide" style={{ color: T.text }}>
              {BACK_LABELS.peak}
            </span>
          </div>
          {/* C132 — the same GradeInfo the front shows, at the default size. */}
          <GradePill info={v.grade} provisional={!frozen} />
        </div>

        {/* C133 — each optional clause is DROPPED rather than showing a dash. */}
        <div
          className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs"
          style={{ color: T.text }}
        >
          <span className="mr-1 text-3xs uppercase tracking-wide">{BACK_LABELS.in}</span>
          {fmtPx(v.entry)}
          <span className="opacity-65">{` ${v.trigLabel}`}</span>
          <span className="mx-1" style={{ color: T.text }}>
            {BACK_LABELS.arrow}
          </span>
          <span className="mr-1 text-3xs uppercase tracking-wide">{BACK_LABELS.high}</span>
          <span className="font-bold" style={{ color: peakPctCardColor(v.peakPct) }}>
            {fmtPx(v.peakMark)}
          </span>
          {v.peakTs != null && <span className="opacity-65">{` ${fmtClock(v.peakTs)}`}</span>}
          {v.peakDollars != null && (
            <span className="font-bold" style={{ color: peakPctCardColor(v.peakPct) }}>
              {fmtPeakDollarsClause(v.peakDollars)}
            </span>
          )}
        </div>

        {/*
          C134 — "now", demoted to 0.7 opacity: context against the peak, never
          the number the card leads with. Because `points` is RTH-filtered at
          fetch time, "now" means "the last RTH snapshot", not wall-clock now.

          THE THIRD zero convention: `pnlColor` is `> 0` up / `< 0` down / else
          NEUTRAL, so the break-even pick that is green in the table and red on
          the headline above is white right here.
        */}
        <div
          className="mt-0.5 whitespace-nowrap font-mono text-2xs opacity-70"
          style={{ color: T.text }}
        >
          <span className="mr-1 text-3xs uppercase tracking-wide">{BACK_LABELS.now}</span>
          {fmtPx(v.lastMark)}
          {v.pnlPct != null && (
            <span style={{ color: pnlColor(v.pnlPct) }}>{fmtNowPct(v.pnlPct)}</span>
          )}
        </div>

        {/* 2026-09-23 — the signed tape on this contract: net before the flag
            (the change window), net since, and the buy / sell split. */}
        <div
          className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-2xs"
          style={{ color: T.text }}
          title={TAPE_CHIP_TITLE}
        >
          <span className="mr-1 text-3xs uppercase tracking-wide">{TAPE_LINE_LABEL}</span>
          {!tape || !(tape.day?.n) ? (
            <span className="opacity-65">{TAPE_NONE}</span>
          ) : (
            <>
              {tape.pre && tape.pre.n > 0 && (
                <>
                  <span className="opacity-65">pre </span>
                  <span style={{ color: flowColor(tape.pre.net) }}>{fmtFlow(tape.pre.net)}</span>
                  <span className="opacity-65"> · </span>
                </>
              )}
              <span className="opacity-65">since </span>
              <span className="font-bold" style={{ color: flowColor(tape.post?.net) }}>
                {fmtFlow(tape.post?.net)}
              </span>
              <span className="opacity-65">
                {` (B ${fmtFlow(tape.post?.buy).replace('+', '')} / S ${fmtFlow(tape.post?.sell).replace('+', '')} · ${tape.post?.n ?? 0})`}
              </span>
            </>
          )}
        </div>
      </div>

      {/* 2026-09-24 — PRICE ONLY, drawn by the whale page's own ProbeChart
          (board/topFlow/ContractProbe): the entry rung + ring on the line at
          the flag, the high ringed green, the low red, the last mark in the
          rail, and the contract's per-snapshot volume underneath. The GEX /
          Tape / V/OI tabs are gone — the tape lives in the line above. */}
      {wid != null && q.loading && !bars.length ? (
        <div className="py-6 text-center font-mono text-2xs" style={{ color: T.text }}>
          {CHART_LOADING}
        </div>
      ) : hist?.error ? (
        <div className="py-6 text-center font-mono text-2xs" style={{ color: V2.red }}>
          {hist.error}
        </div>
      ) : bars.length < 2 ? (
        <div className="py-6 text-center font-mono text-2xs" style={{ color: T.text }}>
          {CHART_EMPTY_LINE_1} {CHART_EMPTY_LINE_2}
        </div>
      ) : (
        <ProbeChart bars={bars} entry={v.entry} entryTs={entryTs} size={null} wide={expanded} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// C154–C158 — THE FOOTER LEGEND
//
// Four display strings describing SERVER behaviour, plus one cross-reference to
// Part D. None of them describes client code: the weights and the ★ thresholds
// live in the recorder, and gexChangeTop.ts deliberately does not export them
// as numbers so nothing here can re-implement the rule and disagree with it.
// ─────────────────────────────────────────────────────────────────────────────

function FooterLegend({ slots }: { slots: readonly SlotBucket[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-4 text-xs" style={{ color: T.text }}>
      <span>{SCORE_LEGEND}</span>
      <span>
        <span style={{ color: V2.orange }}>{STAR_LEGEND_LEAD}</span>
        {STAR_LEGEND_TAIL}
      </span>
      <span>{AUTO_PROBE_LEGEND}</span>
      <span>
        {GRADE_LEGEND_LEAD}
        {/* The never-green clause matches `gradeFor`'s LOCAL path only — the
            server path does not apply it. This sentence is therefore true of
            some rows on screen and false of others; see the BUG note. */}
        <span style={{ color: V2.red }}>{GRADE_LEGEND_F}</span>
        {GRADE_LEGEND_TAIL}
      </span>
      {/* C158 — gated on at least one row carrying a projection, which is false
          whenever no rule is armed (the shipping default). */}
      {anyProjected(slots) && (
        <span>
          {PROJ_LEGEND_LEAD}
          <b>{PROJ_LEGEND_BOLD}</b>
          {PROJ_LEGEND_TAIL}
        </span>
      )}
    </div>
  )
}
