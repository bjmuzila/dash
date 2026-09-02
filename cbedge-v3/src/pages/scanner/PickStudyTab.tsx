// ─────────────────────────────────────────────────────────────────────────────
// PICK STUDY — the render layer for /scanner?tab=pickstudy. OWNER ONLY.
//
// Spec: docs/parity/scanner.md Part D, rows D1–D127. Every threshold, sentence,
// colour ladder, sort key and route already lives in `pickStudy.ts` /
// `pickStudyData.ts`; this file wires them to the screen and decides nothing.
//
// THE OWNER GATE IS NOT HERE. `isOwnerGated` / `visibleTab` live in `pickStudy.ts`
// and are read by the PAGE SHELL, which will not mount this component for a
// non-owner — and, while auth is still resolving, mounts nothing at all rather
// than flash the wrong tab and fire its five requests. So there is deliberately
// no `useIsOwner` call below: a second gate here would be a second answer to the
// same question. v2's PickStudyTab.tsx contains no owner check either (D1–D11).
// The gate is CHROME in both versions — the two POST routes are the only things
// in this client that prove a server-side gate exists at all.
//
// SIX THINGS THAT ARE NOT OBVIOUS FROM READING THIS FILE TOP TO BOTTOM
//
//   1. TWO SOURCES OF TRUTH FOR "ARMED", RENDERED AS TWO. The rule bar reads
//      `ruleBarArmed(rule)` (from …-rule) and the body below it reads
//      `isNotArmed(cal)` (from …-calibration). They can disagree on screen — the
//      bar can say "Armed" with term chips above prose saying "Nothing is being
//      predicted yet" — and that is v2's behaviour, kept. See the BUG markers on
//      both functions.
//   2. …AND THE ↻ BUTTON IS ONE OF THE TWO WAYS TO DESYNCHRONISE THEM. It
//      refreshes the study and the calibration and DELIBERATELY NOT the rule
//      (`REFRESH_TARGETS`). Only an applied fit or a disarm refreshes the rule.
//   3. `notArmedDetailLine` ASSERTS AN ENV SETTING THE CLIENT CANNOT SEE. When
//      the RULE FETCH FAILED, `rule` is null, so the ternary takes the OFF branch
//      and the bar prints "auto-fit is OFF (GEX_CHANGE_TOP_AUTOFIT=0)" — an
//      unknown state stated as a fact, indistinguishable from cold start.
//      Shipped as written; v3 needs a third string, which is a copy decision.
//   4. THE VERDICT COMPARES AT FULL PRECISION AND PRINTS AT 0 dp, so a 4.6-point
//      gap reads "+5pt" inside the sentence that calls it "inside the noise".
//      Reproduced exactly — see the BUG note on `buildVerdict`.
//   5. "NEVER GREEN" IS RED UNDER TWO DIFFERENT RULES ON ONE SCREEN:
//      `bucketNeverGreenColor` reddens only a bucket worse than the window,
//      `calNeverGreenColor` reddens unconditionally. Both are used, neither is
//      unified; same header string, two meanings.
//   6. THE ONE PLACE THIS RENDER CORRECTS v2: the calibration empty row spans
//      `CAL_COLUMN_COUNT` (11) rather than v2's hardcoded 10 — see the comment at
//      that row. It is a correction only in the sense that the correct number is
//      already derived from the column list, so writing anything else would mean
//      typing a literal that the header row can drift away from.
//
// The tables are hand-rolled rather than built on `design/primitives/Table`:
// that primitive early-returns its `empty` node INSTEAD of the table, which drops
// the header row, and it has no colSpan'd empty row — and D74 / D119 both need a
// spanned cell under a header. Every class below is the primitive's own
// vocabulary so the two still read as one table.
//
// This tab opens no socket and mounts no canvas. It adds no poll: none of the
// five routes has one in v2 (D127's note), so an off-screen tab costs nothing.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '@/design/primitives/Card'
import { Chip, SegGroup } from '@/design/primitives/Controls'
import { MOVE_UP, T, alpha } from '@/design/theme'
import { EM_DASH } from '@/pages/scanner/format'
import {
  ALERT_COLOR,
  ARM_BTN_TITLE,
  BUCKET_COLUMNS,
  BUCKET_COLUMN_COUNT,
  BUCKET_EMPTY,
  BUCKET_FOOTNOTE_BOLD,
  CAL_COLUMNS,
  CAL_COLUMN_COUNT,
  CAL_EMPTY,
  CAL_FOOTNOTE,
  CAL_SECTION_TITLE,
  CARD_TITLE,
  COHORTS,
  COPIED_COLOR,
  COPIED_RESET_MS,
  COPY_TERM_DONE,
  COPY_TERM_IDLE,
  COPY_TERM_TITLE,
  COUNT_COLOR,
  DAY_OPTS,
  DEFAULT_BY,
  DEFAULT_COHORT,
  DEFAULT_DAYS,
  DISARM_BTN_TITLE,
  ERROR_PREFIX,
  FEATURE_FALLBACK,
  FIT_BTN_TITLE,
  FIT_DISMISS,
  FIT_FAILED,
  GRADES,
  HEADLINE_AB_LABEL,
  HEADLINE_AVG_LABEL,
  HEADLINE_BAD_COLOR,
  HEADLINE_GOOD_COLOR,
  HEADLINE_NEVER_GREEN_LABEL,
  NOT_ARMED_PROSE,
  NOT_ARMED_PROSE_BOLD,
  NOT_ARMED_PROSE_CODE,
  RATE_BAR_FILL,
  REFRESH_GLYPH,
  SORT_INACTIVE_OPACITY,
  TABLE_HEADER_COLOR,
  THIN_BADGE,
  THIN_ROW_OPACITY,
  VERDICT_PREFIX,
  WARN_COLOR,
  applySort,
  armButtonLabel,
  avgPtsText,
  bucketFootnote,
  bucketNeverGreenColor,
  bucketSortValue,
  buildVerdict,
  calNeverGreenColor,
  calSortValue,
  cardSubtitle,
  copyTermPayload,
  cycleSort,
  dayLabel,
  disarmButtonLabel,
  fitButtonLabel,
  fitHeadline,
  fitPreviewTone,
  gradeCount,
  gradeCountIsDim,
  gradedPicksLabel,
  headlineAvgText,
  holdsColor,
  holdsGlyph,
  holdsTitle,
  initialSortState,
  isNotArmed,
  liftColor,
  liftText,
  medSustainedText,
  pct,
  pinnedWarning,
  progressWidthPct,
  rateBarWidthPct,
  rejectedKey,
  rejectedLiftText,
  rejectedSummary,
  ruleBarState,
  ruleDetailLine,
  showDisarm,
  showRuleNote,
  showTermChips,
  signed,
  sortArrow,
  sortThTitle,
  statusWord,
  termChipColor,
  termKey,
  thinBadgeTitle,
  unprojectedLine,
} from '@/pages/scanner/pickStudy'
import type {
  Bucket,
  BucketSortKey,
  CalResp,
  CalSortKey,
  ColumnDef,
  FitResp,
  FitState,
  RuleState,
  SortState,
  StudyResp,
  Term,
} from '@/pages/scanner/pickStudy'
import {
  StudyBodyError,
  loadCalibration,
  loadRule,
  loadStudy,
  postDisarm,
  postRuleFit,
} from '@/pages/scanner/pickStudyData'

// ── Shared class vocabulary (mirrors design/primitives/Table) ────────────────

const TH_CLASS = 'border-b border-line px-2 py-1.5 text-2xs font-bold uppercase tracking-wide'
const TD_CLASS = 'border-b border-line/50 px-2 py-1'
const BTN_CLASS = 'rounded-sm border border-line px-2 py-0.5 text-2xs'

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ── Emphasis inside a copy string ────────────────────────────────────────────
//
// The prose strings are single sentences in the logic module (so nothing can
// paraphrase one), and the bold runs travel beside them as data
// (`BUCKET_FOOTNOTE_BOLD`, `NOT_ARMED_PROSE_BOLD`, `NOT_ARMED_PROSE_CODE`). This
// splices the two back together rather than re-typing the sentence as JSX with
// <b> in the middle, which is how a copy change silently loses its emphasis.

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function richText(text: string, bold: readonly string[], code?: string): ReactNode {
  const phrases = [...bold, ...(code ? [code] : [])].sort((a, b) => b.length - a.length)
  if (phrases.length === 0) return text
  const re = new RegExp(`(${phrases.map(escapeRe).join('|')})`, 'g')
  return text.split(re).map((seg, i) => {
    if (code && seg === code) {
      return (
        <code key={i} style={{ color: T.cyan }}>
          {seg}
        </code>
      )
    }
    if (bold.includes(seg)) return <b key={i}>{seg}</b>
    return <span key={i}>{seg}</span>
  })
}

// ── A sortable header row (D48–D56, D101–D111) ───────────────────────────────
//
// Three-state, per `cycleSort`: desc → asc → back to server order. Server order
// is meaningful on both of these tables, so the third click has to be reachable.
// A column with a null key is a real column that simply cannot be sorted — the
// bucket table's blank copy-button header (D56).

function SortHeaderRow<K extends string>({
  columns,
  sort,
  onToggle,
}: {
  columns: readonly ColumnDef<K>[]
  sort: SortState<K>
  onToggle: (k: K) => void
}) {
  return (
    <tr>
      {columns.map((c, i) => {
        const align = c.align === 'left' ? 'text-left' : 'text-right'
        const k = c.key
        if (!k) {
          return <th key={`blank-${i}`} className={`${TH_CLASS} ${align}`} style={{ color: TABLE_HEADER_COLOR }} />
        }
        const active = sort.key === k
        return (
          <th
            key={k}
            onClick={() => onToggle(k)}
            title={sortThTitle(c.title)}
            aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
            className={`${TH_CLASS} ${align} cursor-pointer select-none whitespace-nowrap`}
            style={{ color: active ? T.cyan : TABLE_HEADER_COLOR }}
          >
            {c.label}
            <span
              aria-hidden
              className="ml-1 text-3xs"
              style={{ opacity: active ? 1 : SORT_INACTIVE_OPACITY, color: active ? T.cyan : 'inherit' }}
            >
              {sortArrow(sort, k)}
            </span>
          </th>
        )
      })}
    </tr>
  )
}

// ── RateBar (D62, D63) ───────────────────────────────────────────────────────
//
// The fill stays T.cyan while the Lift value beside it takes the MOVE pair: the
// bar encodes MAGNITUDE and is deliberately not a threshold mark. Unifying the
// two would make an 8% hit rate and a -8pt lift the same colour.

function RateBar({ v }: { v: number | null }) {
  if (v == null) return <span style={{ color: T.text }}>{EM_DASH}</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative block h-1.5 w-12 rounded-full" style={{ background: alpha(T.text, 0.1) }}>
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${rateBarWidthPct(v)}%`, background: RATE_BAR_FILL }}
        />
      </span>
      <span className="tabular font-bold">{pct(v)}</span>
    </span>
  )
}

// ── TermChip (D85) ───────────────────────────────────────────────────────────
//
// `termChipColor` is INCLUSIVE at zero, so a 0-point term is an "up" chip reading
// "+0" — a term that does nothing, painted as if it did something. v2's, kept.

function TermChip({ t }: { t: Term }) {
  const c = termChipColor(t.pts)
  return (
    <span
      className="inline-flex items-baseline gap-1.5 rounded-sm border px-2 py-0.5 text-2xs tabular"
      style={{ background: alpha(c, 0.1), borderColor: alpha(c, 0.28) }}
    >
      <span style={{ color: T.text }}>{t.by}</span>
      <b style={{ color: T.text }}>{t.bucket}</b>
      <b style={{ color: c }}>{signed(t.pts)}</b>
    </span>
  )
}

// ── The rule bar (D77–D87) ───────────────────────────────────────────────────

function RuleBar({
  rule,
  cal,
  fitting,
  onFit,
  onArm,
  onDisarm,
}: {
  rule: RuleState | null
  cal: CalResp | null
  fitting: FitState
  onFit: () => void
  onArm: () => void
  onDisarm: () => void
}) {
  // ARMED READ #1 of 2, from /proxy/gex-change-top-rule. The body below this bar
  // reads the CALIBRATION's flag instead (`isNotArmed`), and the two can
  // disagree — see the BUG note on `ruleBarArmed`.
  const s = ruleBarState(rule, cal, fitting)
  return (
    <div
      className="mb-1 rounded-md border px-3 py-2.5"
      style={{ background: alpha(s.tone, 0.07), borderColor: alpha(s.tone, 0.28) }}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        {/* D77 — Armed / Ready to arm / Collecting evidence, in that precedence. */}
        <span className="text-xs font-bold" style={{ color: s.tone }}>
          {statusWord(s)}
        </span>
        {/* D78/D79. The not-armed branch names GEX_CHANGE_TOP_AUTOFIT=0 whenever
            `rule` is null — which INCLUDES a failed rule fetch, an unknown state
            asserted as a fact. See the BUG note on `notArmedDetailLine`. `need`
            comes from the rule and `have` from the calibration, so "88 of 150" is
            assembled from two independent responses. */}
        <span className="text-2xs" style={{ color: T.text }}>
          {ruleDetailLine(s, rule)}
        </span>
        <span className="flex-1" />
        {/* D80 — a dry run. */}
        <button
          type="button"
          onClick={onFit}
          disabled={s.busy}
          title={FIT_BTN_TITLE}
          className={BTN_CLASS}
          style={{ opacity: s.busy ? 0.5 : 1 }}
        >
          {fitButtonLabel(fitting, s.armed)}
        </button>
        {/* D81 — runs the fit AND stores it. Armed is a GOOD state, so the ink is
            the directional up token rather than v2's shared chrome light blue. */}
        <button
          type="button"
          onClick={onArm}
          disabled={s.busy}
          title={ARM_BTN_TITLE}
          className={BTN_CLASS}
          style={{ opacity: s.busy ? 0.5 : 1, color: MOVE_UP, borderColor: alpha(MOVE_UP, 0.45) }}
        >
          {armButtonLabel(fitting, s.armed)}
        </button>
        {/* D82 — only for a rule that was FITTED. A pinned rule shows no Disarm:
            you cannot clear from the UI something the UI did not write. The ink is
            T.red because a destructive control is an ALERT, not a direction. */}
        {showDisarm(rule) && (
          <button
            type="button"
            onClick={onDisarm}
            disabled={s.busy}
            title={DISARM_BTN_TITLE}
            className={BTN_CLASS}
            style={{ opacity: s.busy ? 0.5 : 1, color: ALERT_COLOR, borderColor: alpha(ALERT_COLOR, 0.4) }}
          >
            {disarmButtonLabel(fitting)}
          </button>
        )}
      </div>

      {/* D83 — only while NOT armed. Floors at 2% so zero progress still shows a
          stub: "needs 150, has 0" is a wait with an end, and an invisible bar is
          not. */}
      {!s.armed && (
        <div className="mt-2 h-1 rounded-full" style={{ background: alpha(T.text, 0.1) }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${progressWidthPct(s.have, s.need)}%`, background: s.tone }}
          />
        </div>
      )}

      {/* D84 — chips only for an armed rule that actually has terms. */}
      {showTermChips(rule) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(rule?.terms ?? []).map((t) => (
            <TermChip key={termKey(t)} t={t} />
          ))}
        </div>
      )}

      {/* D86 — rendered whenever `pinnedBy` is truthy, INCLUDING when the rule is
          not armed: the one place this bar mentions a rule that is not in force. */}
      {rule?.pinnedBy && (
        <div className="mt-2 text-2xs leading-relaxed" style={{ color: WARN_COLOR }}>
          {pinnedWarning(rule.pinnedBy)}
        </div>
      )}

      {/* D87 — an un-armed rule's note is swallowed entirely. */}
      {showRuleNote(rule) && (
        <div className="mt-1.5 text-2xs" style={{ color: T.text }}>
          {rule?.note}
        </div>
      )}
    </div>
  )
}

// ── The fit preview (D89–D96) ────────────────────────────────────────────────
//
// The rejected list is the important half: a rule you cannot audit is a fitted
// model with extra steps, and the buckets that ALMOST made it are exactly where a
// bad rule would come from.

function FitPreview({ fit, onDismiss }: { fit: FitResp; onDismiss: () => void }) {
  const tone = fitPreviewTone(fit)
  const terms = fit.terms ?? []
  const rejected = fit.rejected ?? []
  return (
    <div
      className="mt-2.5 rounded-md border px-3 py-2.5"
      style={{ background: alpha(T.text, 0.04), borderColor: alpha(tone, 0.25) }}
    >
      <div className="flex items-baseline gap-2.5">
        {/* D89 — `applied` WINS over `armed`: a stored fit reads "Fit stored". */}
        <b className="text-xs" style={{ color: tone }}>
          {fitHeadline(fit)}
        </b>
        {/* D90 — printed raw; `undefined` renders as nothing, which React drops. */}
        <span className="flex-1 text-2xs leading-relaxed" style={{ color: T.text }}>
          {fit.reason}
        </span>
        {/* D91 — no title attribute in v2 either. */}
        <button type="button" onClick={onDismiss} className={BTN_CLASS}>
          {FIT_DISMISS}
        </button>
      </div>

      {/* D92 */}
      {fit.note && (
        <div className="mt-1.5 text-2xs" style={{ color: WARN_COLOR }}>
          {fit.note}
        </div>
      )}

      {/* D93 */}
      {terms.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {terms.map((t) => (
            <TermChip key={termKey(t)} t={t} />
          ))}
        </div>
      )}

      {/* D94/D95/D96 — collapsed by default; the "(s)" is literal. */}
      {rejected.length > 0 && (
        <details className="mt-2.5">
          <summary className="cursor-pointer text-2xs" style={{ color: T.text }}>
            {rejectedSummary(rejected.length)}
          </summary>
          <div className="mt-1.5 max-h-56 overflow-y-auto">
            {rejected.map((r, i) => (
              <div
                key={rejectedKey(r, i)}
                className={`flex gap-2 py-0.5 text-2xs tabular${i ? ' border-t border-line/50' : ''}`}
                style={{ color: T.text }}
              >
                <span className="w-16 shrink-0">{r.by}</span>
                <b className="w-20 shrink-0">{r.bucket}</b>
                <span className="w-12 shrink-0">n={r.n}</span>
                {/* Same three-branch ladder as the bucket table's Lift cell. */}
                <span className="w-14 shrink-0" style={{ color: liftColor(r.lift) }}>
                  {rejectedLiftText(r.lift)}
                </span>
                <span className="opacity-80">{r.why}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// ── The tab ──────────────────────────────────────────────────────────────────

export default function PickStudyTab() {
  const [by, setBy] = useState<string>(DEFAULT_BY)
  const [days, setDays] = useState<number>(DEFAULT_DAYS)
  const [cohort, setCohort] = useState<string>(DEFAULT_COHORT)

  const [data, setData] = useState<StudyResp | null>(null)
  const [cal, setCal] = useState<CalResp | null>(null)
  const [rule, setRule] = useState<RuleState | null>(null)
  const [fit, setFit] = useState<FitResp | null>(null)
  const [fitting, setFitting] = useState<FitState>('')
  const [fitErr, setFitErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  // Refresh nonces, one per route family, because the three reads do NOT refresh
  // together. `↻` bumps study + calibration (REFRESH_TARGETS) and pointedly not
  // the rule; an applied fit or a disarm bumps rule + calibration. The rule
  // otherwise fires exactly once, at mount, as in v2.
  const [studyNonce, setStudyNonce] = useState(0)
  const [calNonce, setCalNonce] = useState(0)
  const [ruleNonce, setRuleNonce] = useState(0)

  const bucketSortInitial = useMemo(() => initialSortState<BucketSortKey>(), [])
  const calSortInitial = useMemo(() => initialSortState<CalSortKey>(), [])
  const [bucketSort, setBucketSort] = useState<SortState<BucketSortKey>>(bucketSortInitial)
  const [calSort, setCalSort] = useState<SortState<CalSortKey>>(calSortInitial)

  // ── The three GETs. Independent effects in one commit, so all three are in
  // flight together at mount — no waterfall to straighten (D127).

  // D121/D31/D32/D33/D36 — the study.
  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setErr(null)
    // Note what is NOT cleared here: `data`. Switching feature / window / cohort
    // leaves the PREVIOUS result fully rendered, with only the subtitle's
    // " · loading…" to say otherwise (D36). There is no skeleton on this tab.
    loadStudy(days, by, cohort, ac.signal)
      .then((j) => {
        if (ac.signal.aborted) return
        setData(j)
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return
        setErr(errText(e))
        // D31/D32: an `ok:false` BODY also erases everything inside the `data &&`
        // block — headline, cohort hint, verdict, both section labels, the bucket
        // table and its footnote — while the calibration section below survives,
        // because it reads `cal`/`rule`. A THROWN fetch (D33) does not erase:
        // v2 keeps the previous window's numbers on screen. `StudyBodyError` is
        // what keeps those two paths apart here.
        if (e instanceof StudyBodyError) setData(null)
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [days, by, cohort, studyNonce])

  // D122/D34 — the calibration. SILENT by design: a 500, an `ok:false` body and a
  // genuinely un-armed rule all land on `cal === null`, which the body renders as
  // the same three paragraphs. There is no calibration error string anywhere.
  // Note it takes no `by` — changing the feature does not move this.
  useEffect(() => {
    const ac = new AbortController()
    loadCalibration(days, cohort, ac.signal)
      .then((j) => {
        if (!ac.signal.aborted) setCal(j)
      })
      .catch(() => {
        if (!ac.signal.aborted) setCal(null)
      })
    return () => ac.abort()
  }, [days, cohort, calNonce])

  // D123/D35 — the rule. Silent too; with `rule === null` the bar still renders
  // from its fallbacks and mislabels the case (see note 3 in the file header).
  useEffect(() => {
    const ac = new AbortController()
    loadRule(ac.signal)
      .then((j) => {
        if (!ac.signal.aborted) setRule(j)
      })
      .catch(() => {
        if (!ac.signal.aborted) setRule(null)
      })
    return () => ac.abort()
  }, [ruleNonce])

  // ── The two POSTs. The only chaining on this tab, and it is correct
  // sequencing rather than a waterfall: refreshing one of the pair is exactly how
  // the two "armed" flags drift apart.

  const runFit = useCallback(
    (apply: boolean) => {
      setFitting(apply ? 'arm' : 'preview')
      setFitErr(null)
      // D124: `fitDays()` floors the window at 90 days inside the data layer, so
      // a 14d view fits on 90 with nothing on screen saying the window moved.
      postRuleFit(days, cohort, apply)
        .then((j) => {
          // The body is kept even when `ok` is false: v2 renders the preview AND
          // an error line in that case.
          setFit(j)
          if (!j?.ok) setFitErr(j?.error || FIT_FAILED)
          if (apply) {
            setRuleNonce((n) => n + 1)
            setCalNonce((n) => n + 1)
          }
        })
        .catch((e: unknown) => setFitErr(errText(e)))
        .finally(() => setFitting(''))
    },
    [days, cohort],
  )

  const disarm = useCallback(() => {
    setFitting('disarm')
    setFitErr(null)
    postDisarm()
      // v2 throws the response body away, so an `{ok:false}` disarm reports
      // success and the bar simply re-renders from the refetched rule. Kept.
      .then(() => {
        setFit(null)
        setRuleNonce((n) => n + 1)
        setCalNonce((n) => n + 1)
      })
      .catch((e: unknown) => setFitErr(errText(e)))
      .finally(() => setFitting(''))
  }, [])

  // ── The copy-term button (D70–D73). v2's 1600 ms timeout is never cleared,
  // which is a setState after unmount; this one is.
  const copyTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current)
    },
    [],
  )

  const copyTerm = useCallback(
    (b: Bucket) => {
      const p = navigator.clipboard?.writeText(copyTermPayload(b, data, by))
      // A blocked clipboard produces no ✓ and no error — the table still shows
      // the numbers. v2's silence, kept.
      if (!p) return
      void p.then(
        () => {
          setCopied(b.bucket)
          if (copyTimer.current != null) window.clearTimeout(copyTimer.current)
          copyTimer.current = window.setTimeout(() => setCopied(null), COPIED_RESET_MS)
        },
        () => undefined,
      )
    },
    [data, by],
  )

  // ── Derived ────────────────────────────────────────────────────────────────
  // D22: the feature list is SERVER-DRIVEN; FEATURE_FALLBACK is the single entry
  // shown before the first response and after any study error (which nulls data).
  const features = data?.features ?? FEATURE_FALLBACK
  const overall = data?.overall
  const cohortNote = COHORTS.find((c) => c.key === cohort)?.hint ?? ''
  // D41–D45. Reads `data.cohorts`, which the server returns independently of the
  // selected cohort — so this sentence does NOT change when the cohort buttons do.
  const verdict = useMemo(() => buildVerdict(data), [data])
  const buckets = useMemo(
    () => applySort(data?.buckets ?? [], bucketSort, bucketSortValue),
    [data, bucketSort],
  )
  const calRows = useMemo(() => applySort(cal?.rows ?? [], calSort, calSortValue), [cal, calSort])

  return (
    <Card title={CARD_TITLE}>
      {/* D20 — `days` is client state, so this names the REQUESTED window before
          its response lands, and its " · loading…" tracks the STUDY fetch only:
          the calibration and rule fetches have no loading flag at all. It is the
          tab's ONLY loading affordance. */}
      <div className="mb-2.5 text-xs text-muted">{cardSubtitle(days, loading)}</div>

      {/* ── Controls (D22–D28) ─────────────────────────────────────────────── */}
      <div className="mb-2.5 flex flex-wrap gap-2">
        {features.map((f) => (
          <Chip key={f.key} label={f.label} on={by === f.key} onClick={() => setBy(f.key)} />
        ))}
      </div>
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <SegGroup<string>
          options={DAY_OPTS.map((d) => ({ value: String(d), label: dayLabel(d) }))}
          value={String(days)}
          onChange={(v) => setDays(Number(v))}
        />
        {/* D24 — a spacer, not a divider. */}
        <span className="w-2.5" />
        {/* D25–D27 — each cohort's hint doubles as its tooltip and as the body
            copy under the headline. */}
        <SegGroup<string>
          options={COHORTS.map((c) => ({ value: c.key, label: c.label, title: c.hint }))}
          value={cohort}
          onChange={setCohort}
        />
        {/* D28 — never disabled and never debounced, so a second click
            double-fires. REFRESH_TARGETS: study + calibration, NOT the rule — one
            of the two ways `rule.armed` and `cal.armed` come apart. */}
        <button
          type="button"
          onClick={() => {
            setStudyNonce((n) => n + 1)
            setCalNonce((n) => n + 1)
          }}
          className={BTN_CLASS}
        >
          {REFRESH_GLYPH}
        </button>
      </div>

      {/* D30 — no `!loading` guard: it stays through the next fetch until that
          fetch clears it. */}
      {err && (
        <div className="py-2 text-xs" style={{ color: ALERT_COLOR }}>
          {ERROR_PREFIX}
          {err}
        </div>
      )}

      {data && (
        <>
          {/* ── Headline (D37–D40) — all four unconditional. ───────────────── */}
          <div className="mb-1.5 flex flex-wrap items-baseline gap-5 text-xs" style={{ color: T.text }}>
            <span>
              <b className="tabular" style={{ color: COUNT_COLOR }}>
                {overall?.n ?? 0}
              </b>{' '}
              {gradedPicksLabel(overall?.n)}
            </span>
            <span>
              {HEADLINE_AB_LABEL}{' '}
              <b className="tabular" style={{ color: HEADLINE_GOOD_COLOR }}>
                {pct(overall?.pctGood)}
              </b>
            </span>
            <span>
              {HEADLINE_NEVER_GREEN_LABEL}{' '}
              <b className="tabular" style={{ color: HEADLINE_BAD_COLOR }}>
                {pct(overall?.pctNeverGreen)}
              </b>
            </span>
            <span>
              {HEADLINE_AVG_LABEL}{' '}
              {/* The "/100" suffix appears ONLY here; the same field is a bare
                  toFixed(0) in both tables. */}
              <b className="tabular">{headlineAvgText(overall?.avgPts)}</b>
            </span>
          </div>
          {/* D29 */}
          <div className="mb-3.5 text-xs" style={{ color: T.text }}>
            {cohortNote}
          </div>

          {/* ── The control-group verdict (D41–D45) ────────────────────────── */}
          {verdict && (
            <div
              className="mb-4 rounded-md border px-3 py-2 text-xs leading-relaxed"
              style={{
                color: verdict.tone,
                background: alpha(verdict.tone, 0.08),
                borderColor: alpha(verdict.tone, 0.3),
              }}
            >
              <b>{VERDICT_PREFIX}</b>
              {/* THE ROUNDING TRAP, reproduced: the gap is tested at full
                  precision (< 5) and printed at 0 dp, so 4.6 reads "+5pt" inside
                  the branch that calls it "inside the noise". The code is right
                  and the sentence looks wrong — see the BUG note on
                  `buildVerdict`. */}
              {verdict.text}
            </div>
          )}

          {/* ── Bucket table (D46–D75) ─────────────────────────────────────── */}
          {/* D46/D47 — both strings are the SERVER's; the client never composes
              either. */}
          <div className="mb-0.5 text-sm font-bold" style={{ color: WARN_COLOR }}>
            {data.label}
          </div>
          <div className="mb-2.5 max-w-3xl text-xs leading-relaxed" style={{ color: T.text }}>
            {data.note}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <SortHeaderRow
                  columns={BUCKET_COLUMNS}
                  sort={bucketSort}
                  onToggle={(k) => setBucketSort((p) => cycleSort(p, k))}
                />
              </thead>
              <tbody>
                {/* D74 — spans BUCKET_COLUMN_COUNT (9), which is what v2's
                    hardcoded colSpan={9} already agreed with. */}
                {buckets.length === 0 && (
                  <tr>
                    <td colSpan={BUCKET_COLUMN_COUNT} className={`${TD_CLASS} text-left`} style={{ color: T.text }}>
                      {BUCKET_EMPTY}
                    </td>
                  </tr>
                )}
                {buckets.map((b) => (
                  // D58 — thin rows are dimmed, not hidden. `thin` is a SERVER
                  // verdict; the client never compares n to minN to decide it.
                  <tr key={b.bucket} style={{ opacity: b.thin ? THIN_ROW_OPACITY : 1 }}>
                    <td className={`${TD_CLASS} text-left font-bold tabular`}>
                      {b.bucket}
                      {/* D60 — the "(s)" is literal and never resolves, even at n=1. */}
                      {b.thin && (
                        <span
                          className="ml-1.5 text-3xs font-bold"
                          style={{ color: WARN_COLOR }}
                          title={thinBadgeTitle(b.n, data.minN)}
                        >
                          {THIN_BADGE}
                        </span>
                      )}
                    </td>
                    <td className={`${TD_CLASS} text-right tabular`}>{b.n}</td>
                    <td className={`${TD_CLASS} text-left`}>
                      <RateBar v={b.pctGood} />
                    </td>
                    {/* D64 — a 0 lift and a MISSING lift are painted identically;
                        that is v2's, and the one place on this tab where
                        "measured, and flat" and "not measured" are the same ink. */}
                    <td
                      className={`${TD_CLASS} text-right font-bold tabular`}
                      style={{ color: liftColor(b.lift) }}
                    >
                      {liftText(b.lift)}
                    </td>
                    {/* D65/D66 — the tooltip sits on the <td>, so it is present on
                        every row including the "—" ones, and it is the ONLY place
                        firstHalf / secondHalf are read. */}
                    <td className={`${TD_CLASS} text-right tabular`} title={holdsTitle(b)}>
                      <span style={{ color: holdsColor(b.holds) }}>{holdsGlyph(b.holds)}</span>
                    </td>
                    {/* D67 — CONDITIONAL red: only a bucket worse than the window.
                        The calibration table's identically-named column reddens
                        unconditionally; the two are NOT unified. */}
                    <td
                      className={`${TD_CLASS} text-right tabular`}
                      style={{ color: bucketNeverGreenColor(b.pctNeverGreen, overall?.pctNeverGreen) }}
                    >
                      {pct(b.pctNeverGreen)}
                    </td>
                    <td className={`${TD_CLASS} text-right tabular`}>{avgPtsText(b.avgPts)}</td>
                    <td className={`${TD_CLASS} text-right tabular`}>{medSustainedText(b.medSustained)}</td>
                    {/* D70–D73 — emits a JSON fragment for the hand-written rule
                        file the in-app fit replaced. `by` prefers the SERVER's
                        echoed value, and a NULL lift rounds to 0 — a term that
                        does nothing. */}
                    <td className={`${TD_CLASS} text-right`}>
                      <button
                        type="button"
                        onClick={() => copyTerm(b)}
                        title={COPY_TERM_TITLE}
                        className={BTN_CLASS}
                        style={
                          copied === b.bucket
                            ? { color: COPIED_COLOR, borderColor: alpha(COPIED_COLOR, 0.5) }
                            : { color: T.text }
                        }
                      >
                        {copied === b.bucket ? COPY_TERM_DONE : COPY_TERM_IDLE}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* D75 — the only place `splitDate` renders, and it renders whenever
              `data` exists, including when `buckets` is empty. */}
          <div className="mt-2 max-w-4xl text-2xs leading-relaxed" style={{ color: T.text }}>
            {richText(bucketFootnote(data.splitDate, data.minN), BUCKET_FOOTNOTE_BOLD)}
          </div>
        </>
      )}

      {/* ── Calibration (D76–D120) ─────────────────────────────────────────────
          Deliberately OUTSIDE the `data &&` block above: a study error erases the
          upper half of the tab and this section survives it, because it reads
          `cal` and `rule` rather than `data` (D32). */}
      <div className="mt-6 border-t border-line pt-4">
        {/* D76 — NOT upper-cased, unlike the card title. */}
        <div className="mb-1.5 text-sm font-bold" style={{ color: WARN_COLOR }}>
          {CAL_SECTION_TITLE}
        </div>

        <RuleBar
          rule={rule}
          cal={cal}
          fitting={fitting}
          onFit={() => runFit(false)}
          onArm={() => runFit(true)}
          onDisarm={disarm}
        />

        {/* D88 */}
        {fitErr && (
          <div className="my-2 text-xs" style={{ color: ALERT_COLOR }}>
            {fitErr}
          </div>
        )}
        {fit && <FitPreview fit={fit} onDismiss={() => setFit(null)} />}

        {/* ARMED READ #2 of 2, and it is a DIFFERENT ROUTE from the bar's. This
            prose is what the tab shows for FOUR distinguishable situations —
            first paint, a thrown calibration fetch, an `ok:false` body, and a
            genuinely un-armed rule — because `isNotArmed` is `!cal || !cal.armed`.
            A calibration route that 500s therefore reads as "nothing is being
            predicted yet": a sentence about the RULE, told by a failure of the
            REQUEST. Ported as v2 wrote it; splitting the four is step 3's open
            decision, not this render's. */}
        {isNotArmed(cal) ? (
          <div className="mt-3 max-w-4xl text-xs leading-relaxed" style={{ color: T.text }}>
            {NOT_ARMED_PROSE.map((p, i) => (
              <p key={i} className={i === 0 ? '' : 'mt-3'}>
                {richText(p, NOT_ARMED_PROSE_BOLD, NOT_ARMED_PROSE_CODE)}
              </p>
            ))}
          </div>
        ) : (
          <>
            {/* D100 — chosen on TRUTHINESS, so 0, undefined and null all take the
                second sentence. */}
            <div className="mb-2.5 mt-3 text-xs" style={{ color: T.text }}>
              {unprojectedLine(cal?.unprojected)}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <SortHeaderRow
                    columns={CAL_COLUMNS}
                    sort={calSort}
                    onToggle={(k) => setCalSort((p) => cycleSort(p, k))}
                  />
                </thead>
                <tbody>
                  {calRows.map((r) => (
                    // D112 — greyed, and note there is NO thin badge here, unlike
                    // the bucket table.
                    <tr key={r.projected} style={{ opacity: r.thin ? THIN_ROW_OPACITY : 1 }}>
                      <td className={`${TD_CLASS} text-left font-bold tabular`}>{r.projected}</td>
                      <td className={`${TD_CLASS} text-right tabular`}>{r.n}</td>
                      <td className={`${TD_CLASS} text-left`}>
                        <RateBar v={r.pctGood} />
                      </td>
                      {/* D116 — UNCONDITIONAL red, including on a null (which
                          renders as an em dash, in red). Same column header as the
                          bucket table's conditional one, two rules, one screen. */}
                      <td className={`${TD_CLASS} text-right tabular`} style={{ color: calNeverGreenColor() }}>
                        {pct(r.pctNeverGreen)}
                      </td>
                      <td className={`${TD_CLASS} text-right tabular`}>{avgPtsText(r.avgPts)}</td>
                      {/* D118 — dimmed on TRUTHINESS, so a measured zero renders
                          "0" at low ink and is indistinguishable from a missing key. */}
                      {GRADES.map((g) => (
                        <td
                          key={g}
                          className={`${TD_CLASS} text-right tabular`}
                          style={{ color: gradeCountIsDim(r, g) ? alpha(T.text, 0.3) : T.text }}
                        >
                          {gradeCount(r, g)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {/* D119 — THE ONE PLACE THIS RENDER LAYER CORRECTS A v2 MISCOUNT.
                      v2 writes colSpan={10} against eleven columns (5 fixed + one
                      per grade), so its empty cell under-spans and the last grade
                      column sits outside it. The count is already DERIVED from
                      CAL_COLUMNS, so writing anything but CAL_COLUMN_COUNT here
                      would mean typing a literal that the header can drift away
                      from — which is exactly how v2 got 10. The bucket table's
                      equivalent above needs no correction, which is what makes
                      this a slip rather than a convention. */}
                  {calRows.length === 0 && (
                    <tr>
                      <td colSpan={CAL_COLUMN_COUNT} className={`${TD_CLASS} text-left`} style={{ color: T.text }}>
                        {CAL_EMPTY}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* D120 */}
            <div className="mt-2 max-w-4xl text-2xs leading-relaxed" style={{ color: T.text }}>
              {CAL_FOOTNOTE}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
