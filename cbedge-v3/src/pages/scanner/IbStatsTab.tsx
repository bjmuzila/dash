// ─────────────────────────────────────────────────────────────────────────────
// IB STATS — the render layer for /scanner?tab=ibstats.
//
// Spec: docs/parity/scanner.md Part G, rows G1–G308. Every threshold, every
// label string, every colour ladder, every bucket boundary and both loaders
// already live in `ibStats.ts`, `ibProbability.ts`, `ibDailyResults.ts` and
// `ibStatsData.ts`. This file wires them to the screen and decides nothing.
//
// EIGHT THINGS ABOUT THIS FILE THAT ARE NOT OBVIOUS FROM READING IT TOP TO BOTTOM
//
//   1. FOUR WIDTH-CLASS COPIES AND FIVE BREAK-TIMING LADDERS STAY APART. Each
//      card calls the variant named for ITS path — `widthClassLive` for the live
//      read, `deriveWidthBuckets` for the dataset backfill, `breakTimeBucketScored`
//      vs `breakTimeWordInPlay` for rule 13's scored bucket vs its displayed word.
//      Unifying any pair silently changes four cards' numbers (G236, G242).
//   2. THREE v2 BUGS ARE REPRODUCED ON PURPOSE, each marked `// BUG (v2)` at its
//      render site: rule 13's displayed word disagreeing with its scored bucket
//      (G216), the Live Read gauge whose arc saturates at 50 % because a
//      semicircle's dash length is applied to a quarter arc (G94–G95), and card
//      10's `hits={WICK_ONLY_HITS}` literal 0 painting a red "0.0%" that looks
//      measured (G191). A fourth — the engine's rotation residual going negative
//      (G157) — needs no render-site handling: it renders as "-1%" by itself.
//   3. THE TAPE MAKES NO REQUEST OF ITS OWN. Step 2 collapsed v2's two calls to
//      `/api/ib-results` (limit=5 for the strip, limit=90 for the scoreboard)
//      into one at limit 90, sliced locally by `tapeFrom` (G122, G220). The
//      scoreboard's fetch is also no longer lazy — the disclosure still controls
//      what is DRAWN, not what is fetched.
//   4. THE TABLES ARE HAND-ROLLED. `design/primitives/Table` early-returns its
//      `empty` node INSTEAD of the table, which drops the header row — and G169
//      (an empty Rule Ranking keeps its header), G232 (a footer row spanning
//      eight columns) and G195 (section rows spanning five) all need markup that
//      primitive cannot express. Every class below is the primitive's own
//      vocabulary so the two still read as one table.
//   5. THE ENGINE'S TWO DEAD BRANCHES ARE RENDERED HERE, and that is a DEPARTURE.
//      v2 mounts the card with `ENGINE_FLAGS = { showLive: false, showStages: false }`
//      (G142–G145), which makes the four stage sections, every `TAG` word, the
//      `Hist. Edge` bars and the "Live · updating now" chip pair unreachable.
//      Step 3's brief requires every engine output string on screen, so
//      `SHOW_STAGES` / `SHOW_LIVE` below are true. Set them to `ENGINE_FLAGS` to
//      restore v2's card exactly — the guards are written the way v2 writes them.
//   6. NO SOCKET, SO NO 4 Hz. v2 holds `useEsCandles` / `useNqCandles`; v3 pages
//      may not (non-negotiable 3) and there is no candle frame type to read with
//      `useFrame`, so the live tape comes from `loadIbCandles` on a 15 s poll that
//      pauses on a hidden tab. `connected` (G53's subtitle switch) becomes "the
//      last candle read resolved" — see ibStatsData.ts.
//   7. NOTHING HERE PAINTS A CHART. The Live Read gauge and the engine's three
//      rings are declarative SVG of five nodes each, exactly as v2 draws them —
//      no canvas, no imperative handle, so non-negotiables 5, 6 and 7 have
//      nothing to bite on. `ibLevels.ts` is the one drawing surface in this part
//      and it is `@notWiredInV2`; it is NOT mounted (G279–G304).
//   8. THE ENGINE'S 10:30 FREEZE lives in a module-level map, written in an
//      effect. v2 mutates a ref DURING RENDER (G73), so switching tabs and back
//      loses the freeze and re-captures at whatever the state is then, still
//      labelled "frozen at the IB close". The map survives a remount; that is the
//      one correction ibProbability.ts asks for by name.
//
// @notWiredInV2 and deliberately NOT mounted: `ruleBoardRows` / `RULE_BOARD_TEXT`
// (v2's "In Play Right Now" card), `playbookSetups` / `PLAYBOOK_LEGACY` /
// `playbookBorderColor` (the deprecated playbook), and the whole of `ibLevels.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useIsOwner } from '@/data/auth'
import { Card } from '@/design/primitives/Card'
import { SegGroup } from '@/design/primitives/Controls'
import { Stat } from '@/design/primitives/Stat'
import { LIGHT_BLUE, MOVE_DOWN, MOVE_UP, T, alpha } from '@/design/theme'
import { EM_DASH } from '@/pages/scanner/format'
import {
  BIAS_SUMMARY_TEXT,
  COLUMNS,
  DAILY_RESULTS_TEXT,
  ERROR_COLOR,
  HIT_RATE_COLSPAN,
  HIT_RATE_LABEL,
  HIT_RATE_LABEL_COLOR,
  RULE_CELL_IDLE_OPACITY,
  RULE_CLAIM,
  RULE_IDS,
  RULE_NAMES,
  biasCell,
  biasSummary,
  breakCell,
  bucketCell,
  dailyResultsView,
  extCell,
  firstCell,
  hitRateCell,
  pct0,
  ruleCell,
  rulesById,
  shouldntBeCell,
  timeCell,
  widthCell,
} from '@/pages/scanner/ibDailyResults'
import type { IbResultRow } from '@/pages/scanner/ibDailyResults'
import {
  ENGINE_TEXT,
  GAUGES,
  RING,
  STAGE_DEFS,
  TAG,
  EDGE_COLORS,
  engineEnvFrom,
  engineProbabilities,
  engineRulesFrom,
  engineSnapKey,
  ringDashOffset,
  ringNumberColor,
  toRow,
} from '@/pages/scanner/ibProbability'
import type { EngineEnv, EngineRule, EngineSnapshot } from '@/pages/scanner/ibProbability'
import {
  DOT,
  DOW_COLORED_COLUMNS,
  DOW_NAMES,
  EXPANSION_COLORS,
  EXPANSION_LABELS,
  FAMILIES,
  FAMILY_BADGE,
  IB_READ_ACCENT,
  IB_READ_TEXT,
  LIVE_EMPTY_TEXT,
  LIVE_GAUGE,
  LIVE_READ_TEXT,
  OWNER_CARDS,
  SYMBOLS,
  TAB_TEXT,
  WINDOWS,
  activeRule,
  allBreaksMae,
  allBreaksMfe,
  baselineRows,
  bestSample,
  breakTimeRows,
  breakTimeTiles,
  buildHist,
  buildOwnerGroups,
  buildRules,
  clock,
  computeLiveSession,
  deriveWidthBuckets,
  dowRows,
  dowTotalsRates,
  dowTotalsRow,
  expansionMatrix,
  expansionPopulation,
  f2,
  failPeakPts,
  fallbackTape,
  familyStat,
  familyVerdict,
  fibEntries,
  fibFootnoteMfe,
  gaugeAngle,
  gaugeDashOffset,
  gaugeReadout,
  gaugeVerdict,
  headerTiles,
  liveConditionStack,
  overallScore,
  overallVerdictColor,
  overallVerdictText,
  pHighOf,
  rangeEnd,
  rankingRows,
  rateColor,
  rateNum,
  rule1Rows,
  rule2Rows,
  rule3Rows,
  rule5Rows,
  rule6Rows,
  rule7Rows,
  rule8Rows,
  rule9Rows,
  rule10Rows,
  rule11Rows,
  rule12Rows,
  rule13Rows,
  rule14Rows,
  scoreText,
  scoreWithHistory,
  tacticalVerdictColor,
  tapeChip,
  widthBucketRows,
  widthRangeRows,
  widthTiles,
  DEFAULT_SYMBOL,
  DEFAULT_WINDOW,
  TACTICAL_VERDICT_TEXT,
} from '@/pages/scanner/ibStats'
import type {
  IbCandle,
  IbDataset,
  IbSymbol,
  IbWindow,
  LiveSession,
  ScoredRule,
  SlimDay,
  StatRow,
  StatTile,
  TapeDay,
} from '@/pages/scanner/ibStats'
import {
  IB_CANDLE_POLL_MS,
  loadIbCandles,
  loadIbDataset,
  loadIbResults,
  tapeFrom,
} from '@/pages/scanner/ibStatsData'

// ─────────────────────────────────────────────────────────────────────────────
// SHARED MARKUP. `design/primitives/Table`'s class vocabulary, hand-rolled —
// see note 4 in the header for why the primitive itself cannot be used here.
// ─────────────────────────────────────────────────────────────────────────────

const TH = 'whitespace-nowrap border-b border-line px-2 py-1.5 text-xs font-normal text-muted'
const TD = 'whitespace-nowrap border-b border-line/50 px-2 py-1 tabular'
const SUBTITLE = 'mb-3 text-xs text-muted'
const FOOTNOTE = 'mt-2 text-xs italic text-muted'
const SECTION_LABEL = 'text-xs font-semibold tracking-wide'
const DISCLOSURE = 'self-start rounded-sm border border-line px-3 py-1.5 text-xs font-semibold text-fg'

/** v2 bolds spans inside three footnotes and one body paragraph. */
function BoldParts({ text, bold }: { text: string; bold: readonly string[] }) {
  let parts: ReactNode[] = [text]
  for (const b of bold) {
    const next: ReactNode[] = []
    for (const part of parts) {
      if (typeof part !== 'string') {
        next.push(part)
        continue
      }
      const seg = part.split(b)
      seg.forEach((s, i) => {
        if (i > 0) {
          next.push(
            <b key={`b-${b}-${next.length}`} className="font-semibold">
              {b}
            </b>,
          )
        }
        if (s) next.push(s)
      })
    }
    parts = next
  }
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>{p}</span>
      ))}
    </>
  )
}

/**
 * `Tbl` (G41). Column 0 is left-aligned, the rest right — v2's `thL` / `th`.
 * An EMPTY body still renders the header, which is the whole reason this is not
 * the Table primitive (G169).
 */
function Tbl({
  head,
  children,
  footNote,
}: {
  head: readonly string[]
  children: ReactNode
  footNote?: ReactNode
}) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={`${h}-${i}`} className={`${TH} ${i === 0 ? 'text-left' : 'text-right'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {footNote != null && <p className={FOOTNOTE}>{footNote}</p>}
    </>
  )
}

/**
 * `Row` (G40). Five cells: label, n, hits, rate, detail. The rate takes the
 * shared colour ladder; a null rate is an em dash in body white, and a missing
 * detail is an EMPTY cell, not a dash.
 */
function RowTr({ r }: { r: StatRow }) {
  const p = rateNum(r.hits, r.n)
  return (
    <tr>
      <td className={`${TD} text-left ${r.indent ? 'pl-6' : ''}`}>{r.label}</td>
      <td className={`${TD} text-right`}>{r.n}</td>
      <td className={`${TD} text-right`}>{r.hits}</td>
      <td className={`${TD} text-right font-semibold`} style={{ color: rateColor(p) }}>
        {p == null ? EM_DASH : `${p.toFixed(1)}%`}
      </td>
      <td className={`${TD} text-right`}>{r.detail ?? ''}</td>
    </tr>
  )
}

/** `sectionRow` (G43) — a colSpan-5 header inside a stats table. Card 14 only. */
function SectionTr({ text }: { text: string }) {
  return (
    <tr>
      <td
        colSpan={5}
        className={`${TD} pt-3 text-left font-semibold`}
        style={{ color: LIGHT_BLUE }}
      >
        {text}
      </td>
    </tr>
  )
}

/** `Stat` tiles in a `statGrid` (G39, G42). All three lines are body white. */
function Tiles({ tiles }: { tiles: readonly StatTile[] }) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <Stat key={t.k} label={t.k} value={t.v} sub={t.sub} size="sm" />
      ))}
    </div>
  )
}

/** One stats card: title, subtitle, an optional tile row, a table. */
function StatCard({
  title,
  subtitle,
  head,
  rows,
  footNote,
  tiles,
  children,
}: {
  title: string
  subtitle: string
  head?: readonly string[]
  rows?: readonly StatRow[]
  footNote?: ReactNode
  tiles?: readonly StatTile[]
  children?: ReactNode
}) {
  return (
    <Card title={title}>
      <p className={SUBTITLE}>{subtitle}</p>
      {tiles && <Tiles tiles={tiles} />}
      {head && rows && (
        <Tbl head={head} footNote={footNote}>
          {rows.map((r, i) => (
            <RowTr key={`${r.label}-${i}`} r={r} />
          ))}
        </Tbl>
      )}
      {children}
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD 1 of the live trio — "Live Read" (G77–G116).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The half-moon gauge (G93–G99).
 *
 * BUG (v2): `LIVE_GAUGE.arc` is 125 — π·40, the length of the FULL semicircle —
 * and it is used as the `strokeDasharray` of QUARTER-arc paths whose real length
 * is ≈62.8. The visible arc therefore SATURATES at pHigh = 50: the winning
 * side's arc is fully drawn for every reading past the middle and only the
 * losing side's varies. Ported as written (spec G94–G95); the fix changes what
 * the gauge looks like, so it is a design call, not a transcription one.
 */
function Gauge({ pHigh }: { pHigh: number }) {
  const verdict = gaugeVerdict(pHigh)
  return (
    <div>
      <svg viewBox={LIVE_GAUGE.viewBox} className="w-full" role="img" aria-label={verdict.text}>
        <path
          d={LIVE_GAUGE.trackPath}
          fill="none"
          stroke={alpha(T.text, 0.1)}
          strokeWidth={LIVE_GAUGE.strokeWidth}
          strokeLinecap="round"
        />
        <path
          d={LIVE_GAUGE.upPath}
          fill="none"
          stroke={MOVE_UP}
          strokeWidth={LIVE_GAUGE.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={LIVE_GAUGE.arc}
          strokeDashoffset={gaugeDashOffset(pHigh / 100)}
        />
        <path
          d={LIVE_GAUGE.downPath}
          fill="none"
          stroke={MOVE_DOWN}
          strokeWidth={LIVE_GAUGE.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={LIVE_GAUGE.arc}
          strokeDashoffset={gaugeDashOffset((100 - pHigh) / 100)}
        />
        {/* v2's only two raw `#fff` literals; both are the body token here. */}
        <line
          x1={LIVE_GAUGE.needle.x1}
          y1={LIVE_GAUGE.needle.y1}
          x2={LIVE_GAUGE.needle.x2}
          y2={LIVE_GAUGE.needle.y2}
          stroke={LIVE_GAUGE.needleColor}
          strokeWidth={LIVE_GAUGE.needle.strokeWidth}
          strokeLinecap="round"
          transform={`rotate(${gaugeAngle(pHigh)} ${LIVE_GAUGE.hub.cx} ${LIVE_GAUGE.hub.cy})`}
        />
        <circle
          cx={LIVE_GAUGE.hub.cx}
          cy={LIVE_GAUGE.hub.cy}
          r={LIVE_GAUGE.hub.r}
          fill={LIVE_GAUGE.needleColor}
        />
      </svg>
      {/* The number is ALWAYS the winning side's, so it can never read below 50.0%. */}
      <div className="text-center">
        <div className="tabular text-xl font-semibold text-fg">{`${gaugeReadout(pHigh).toFixed(1)}%`}</div>
        <div className={`${SECTION_LABEL} uppercase`} style={{ color: verdict.color }}>
          {verdict.text}
        </div>
      </div>
    </div>
  )
}

/** One expansion-matrix bar (G106). Colour is per row, not a rate ladder. */
function Bar({ label, p, color }: { label: string; p: number; color: string }) {
  return (
    <div className="mb-2">
      <div className="flex items-baseline justify-between text-xs text-fg">
        <span>{label}</span>
        <span className="tabular font-semibold" style={{ color }}>{`${p.toFixed(1)}%`}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: alpha(T.text, 0.07) }}>
        <div className="h-full" style={{ width: `${p}%`, background: color }} />
      </div>
    </div>
  )
}

function LiveRead({
  live,
  days,
  win,
  dowIdx,
}: {
  live: LiveSession
  days: readonly SlimDay[]
  win: IbWindow
  dowIdx: number
}) {
  // G80 — the ordered condition stack, then the tightest group with >= MIN_N.
  const stack = liveConditionStack(live, win)
  const group = bestSample(days, stack.conds, stack.labels)
  // G81 — a group with no recorded first touch returns a hard-coded 50.
  const pHigh = pHighOf(group.g)
  // G102 — today's weekday when it has >= MIN_N sessions, else the whole group.
  const mx = expansionPopulation(group.g, dowIdx)
  const matrix = expansionMatrix(mx)
  const rule = activeRule(live, days, group, mx, matrix.pBoth, pHigh, win)
  const score = overallScore(live, pHigh)
  const sColor = overallVerdictColor(score)
  const vColor = tacticalVerdictColor(rule?.verdict)

  return (
    <Card title={LIVE_READ_TEXT.title(win)}>
      {/* G78 — the surviving condition stack, e.g. "close > mid + LOW first",
          or ALL_SESSIONS_LABEL when nothing reached 40. */}
      <p className={SUBTITLE}>{LIVE_READ_TEXT.subtitle(group.label, live.ibComplete, win)}</p>

      {/* G82–G89 — the overall verdict plate. The plate's border takes the verdict colour. */}
      <div
        className="mb-3 flex flex-wrap items-center justify-between gap-4 rounded-md border px-4 py-3"
        style={{ borderColor: sColor, background: alpha(T.text, 0.03) }}
      >
        <div>
          <div className="text-xs text-fg">{LIVE_READ_TEXT.overallLabel}</div>
          <div className="text-lg font-semibold" style={{ color: sColor }}>
            {overallVerdictText(score)}
          </div>
        </div>
        <div className="text-right">
          <div className="tabular text-2xl font-semibold" style={{ color: sColor }}>
            {scoreText(score)}
          </div>
          <div className="text-xs text-fg">{LIVE_READ_TEXT.scoreCaption}</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {/* G91–G100 — the gauge panel. */}
        <div className="rounded-md border border-line p-3" style={{ background: alpha(T.text, 0.03) }}>
          <div className="mb-2 text-xs font-semibold text-fg">{LIVE_READ_TEXT.gaugeTitle}</div>
          <Gauge pHigh={pHigh} />
          {/* G100 — fixed colours, not conditional; the two always sum to 100.0. */}
          <div className="mt-2 flex justify-between text-xs text-fg">
            <span>
              {LIVE_READ_TEXT.highFirst}
              <b className="font-semibold" style={{ color: MOVE_UP }}>{`${pHigh.toFixed(1)}%`}</b>
            </span>
            <span>
              {LIVE_READ_TEXT.lowFirst}
              <b className="font-semibold" style={{ color: MOVE_DOWN }}>
                {`${(100 - pHigh).toFixed(1)}%`}
              </b>
            </span>
          </div>
        </div>

        {/* G101–G107 — the expansion matrix. */}
        <div className="rounded-md border border-line p-3" style={{ background: alpha(T.text, 0.03) }}>
          <div className="mb-2 text-xs font-semibold text-fg">{EXPANSION_LABELS.title}</div>
          <Bar label={EXPANSION_LABELS.single} p={matrix.pSingle} color={EXPANSION_COLORS.single} />
          <Bar label={EXPANSION_LABELS.both} p={matrix.pBoth} color={EXPANSION_COLORS.both} />
          <Bar label={EXPANSION_LABELS.none} p={matrix.pNone} color={EXPANSION_COLORS.none} />
          <p className="mt-1 text-xs text-fg">{matrix.caption}</p>
        </div>

        {/* G108–G116 — the active tactical rule. A null rule paints the warn colour. */}
        <div
          className="rounded-md border p-3"
          style={{ borderColor: vColor, background: alpha(T.text, 0.03) }}
        >
          <div className="mb-2 text-xs font-semibold text-fg">{LIVE_READ_TEXT.activeRuleTitle}</div>
          {rule == null ? (
            // BUG (v2): hardcoded to 10:30 — it does not follow the window
            // selector, so on ORB 5m it still says 10:30 (G110).
            <p className="text-xs text-fg">{LIVE_READ_TEXT.waiting}</p>
          ) : (
            <>
              <div className="text-sm font-semibold" style={{ color: vColor }}>
                {TACTICAL_VERDICT_TEXT[rule.verdict]}
              </div>
              <p className="mt-1.5 text-xs text-fg">{rule.name}</p>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-xs text-fg">{LIVE_READ_TEXT.edgeRate}</span>
                {/* G114 — on the failP > 50 path this is 100 − failP, i.e. the
                    success rate of the FADE, not the failure rate in the note
                    below it. G116: `rule.n` is set by every branch and rendered
                    by nothing — sample counts are owner-only. */}
                <span className="tabular text-xl font-semibold" style={{ color: vColor }}>
                  {`${rule.p.toFixed(1)}%`}
                </span>
              </div>
              <p className="mt-1 text-xs text-fg">{rule.note}</p>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD 2 of the live trio — "IB Read — 4 families, one glance" (G117–G141).
// ─────────────────────────────────────────────────────────────────────────────

/** G140 — the last five in-play outcomes, oldest → newest. Miss dots also dim. */
function Last5Dots({ last5 }: { last5: readonly boolean[] }) {
  if (!last5.length) {
    return <span className="text-2xs text-faint">{DOT.empty}</span>
  }
  return (
    <span className="inline-flex items-center gap-1">
      {last5.map((hit, i) => (
        <span
          key={i}
          title={hit ? DOT.hitTitle : DOT.missTitle}
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: hit ? DOT.hit : DOT.miss, opacity: hit ? 1 : 0.55 }}
        />
      ))}
    </span>
  )
}

/** G124–G127 — one tape chip: date, direction, day type. */
function TapeChip({ d }: { d: TapeDay }) {
  const c = tapeChip(d)
  return (
    <div
      className="inline-flex flex-col items-center gap-0.5 rounded-sm border px-2 py-1"
      style={{ borderColor: c.color }}
    >
      <span className="text-2xs text-muted">{c.date}</span>
      <span className="text-xs font-semibold" style={{ color: c.color }}>
        {c.dir}
      </span>
      <span className="text-2xs text-faint">{c.dayType}</span>
    </div>
  )
}

function IbRead({
  live,
  scored,
  tape,
  win,
}: {
  live: LiveSession
  scored: readonly ScoredRule[]
  tape: readonly TapeDay[]
  win: IbWindow
}) {
  return (
    // G117 — a template literal with no interpolation in v2: the title says "IB"
    // even on the ORB 5m tab.
    <Card title={IB_READ_TEXT.title}>
      {/* G118 / G119 — the formed subtitle says "14 rules"; the board carries 15
          on a weekday, because rule 0c is pushed Mon–Fri. */}
      <p className={SUBTITLE}>
        {live.ibComplete ? IB_READ_TEXT.subtitleFormed : IB_READ_TEXT.subtitleForming(win)}
      </p>

      {/* G121–G123 — the tape. Always drawn, even with zero chips; a failed API
          call falls back to the static export and looks identical. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={SECTION_LABEL} style={{ color: IB_READ_ACCENT }}>
          {IB_READ_TEXT.tapeLabel}
        </span>
        {tape.map((d) => (
          <TapeChip key={d.date} d={d} />
        ))}
      </div>

      {/* G128–G139 — the four families. */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {FAMILIES.map((fam) => {
          const stat = familyStat(scored, fam.ids)
          const verd = familyVerdict(stat.netSide)
          const badge = fam.hero ? FAMILY_BADGE.hero : fam.correlated ? FAMILY_BADGE.correlated : null
          return (
            <div
              key={fam.key}
              className="relative rounded-md border p-3"
              style={{
                borderColor: fam.hero ? T.orange : T.border,
                background: fam.hero ? alpha(T.orange, 0.08) : T.panelBg,
              }}
            >
              {badge && (
                <span
                  className="absolute right-2 top-2 rounded-sm border px-1 py-0.5 text-3xs uppercase tracking-wide"
                  style={{ color: T.orange, borderColor: T.orange }}
                >
                  {badge}
                </span>
              )}
              <div className="text-xs font-semibold text-fg">{fam.title}</div>
              <div className="mb-2 text-2xs text-faint">{fam.sub}</div>
              {/* G136 — "CONTEXT" when no member carries both a side and a rate. */}
              <div className="text-lg font-semibold" style={{ color: verd.color }}>
                {verd.text}
              </div>
              {/* G138 — omitted entirely when null, not shown as a dash. */}
              {stat.avg != null && (
                <div className="text-2xs text-muted">
                  {IB_READ_TEXT.avgConviction}
                  <b className="font-semibold" style={{ color: verd.color }}>
                    {`${stat.avg.toFixed(1)}%`}
                  </b>
                </div>
              )}
              <div className="mt-2 flex flex-col gap-1.5">
                {stat.members.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 rounded-sm border border-line px-2 py-1.5"
                    style={{ background: T.panelBg }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-2xs text-fg">{`${r.id} · ${r.name}`}</span>
                      <span className="mt-1 block">
                        <Last5Dots last5={r.last5} />
                      </span>
                    </span>
                    {/* G139 — the rate ladder. `scoreWithHistory` applies no
                        sample floor, so a 2-day rate is coloured like a 900-day one. */}
                    <span
                      className="tabular shrink-0 text-xs font-semibold"
                      style={{ color: rateColor(r.p) }}
                    >
                      {r.p == null ? EM_DASH : `${r.p.toFixed(1)}%`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* G141 — rendered as JSX in v2, not dangerouslySetInnerHTML. */}
      <p className={FOOTNOTE}>
        <BoldParts text={IB_READ_TEXT.footnote} bold={IB_READ_TEXT.footnoteBold} />
      </p>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD 3 of the live trio — the Probability Engine (G142–G161).
//
// See note 5 in the file header: v2 passes ENGINE_FLAGS, which makes the stage
// board and the "Live" chip unreachable. These two constants are the switch.
// ─────────────────────────────────────────────────────────────────────────────

const SHOW_STAGES = true
const SHOW_LIVE = true

/** G152–G154 — one ring. `pct` is already an integer; 0 greys the number out. */
function Ring({ pct, color, label }: { pct: number; color: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-full">
        <svg
          viewBox={RING.viewBox}
          className="w-full"
          style={{ transform: `rotate(${RING.rotateDeg}deg)` }}
          role="img"
          aria-label={`${label} ${pct}%`}
        >
          <circle
            cx={RING.cx}
            cy={RING.cy}
            r={RING.r}
            fill="none"
            stroke={alpha(T.text, 0.07)}
            strokeWidth={RING.strokeWidth}
          />
          {/* BUG (v2, G157): rotation is a residual of two independently rounded
              numbers, so `pct` can be −1 — the offset then exceeds the
              circumference and the ring draws empty beside a "-1%" label. */}
          <circle
            cx={RING.cx}
            cy={RING.cy}
            r={RING.r}
            fill="none"
            stroke={color}
            strokeWidth={RING.strokeWidth}
            strokeLinecap="round"
            strokeDasharray={RING.circumference.toFixed(1)}
            strokeDashoffset={ringDashOffset(pct).toFixed(1)}
          />
        </svg>
        <div
          className="tabular absolute inset-0 flex items-center justify-center text-lg font-semibold"
          style={{ color: ringNumberColor(pct, color) }}
        >
          {`${pct}%`}
        </div>
      </div>
      <span className="text-center text-2xs font-semibold uppercase tracking-wider text-muted">
        {label}
      </span>
    </div>
  )
}

function RingTrio({ p }: { p: { bull: number; bear: number; rot: number } }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {GAUGES.map((g) => (
        <Ring key={g.key} pct={p[g.key]} color={g.color} label={g.label} />
      ))}
    </div>
  )
}

/** A chip in the engine's own vocabulary — the sym chip, the freeze chip, "Live". */
function EngineChip({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="rounded-sm border px-2 py-0.5 text-3xs font-semibold uppercase tracking-wider"
      style={{ color, borderColor: alpha(color, 0.4), background: alpha(color, 0.08) }}
    >
      {text}
    </span>
  )
}

function ProbabilityEngine({
  sym,
  rules,
  env,
  closeSnap,
}: {
  sym: IbSymbol
  rules: readonly EngineRule[]
  env: EngineEnv
  closeSnap: EngineSnapshot | undefined
}) {
  const pLive = engineProbabilities(rules, env)
  const pClose = closeSnap ? engineProbabilities(closeSnap.rules, closeSnap.env) : null

  return (
    <Card title={`${ENGINE_TEXT.icon} ${ENGINE_TEXT.title}`} actions={<EngineChip text={sym} color={T.cyan} />}>
      <p className={SUBTITLE}>{ENGINE_TEXT.strapline(sym)}</p>

      {/* G149 — rendered only once the freeze exists. HARDCODED "10:30": on
          ORB 15m it labels an 09:45 freeze as 10:30. */}
      {pClose && (
        <>
          <div className="mb-2 flex items-center gap-2">
            <EngineChip text={ENGINE_TEXT.closeChip} color={T.orange} />
            <span className="text-xs text-muted">{ENGINE_TEXT.closeChipNote}</span>
          </div>
          <RingTrio p={pClose} />
        </>
      )}

      {/* G144/G145 — v2's guards, verbatim. With ENGINE_FLAGS the chip pair is
          `!pClose && pClose`, i.e. never; the live trio is `!pClose`, so it shows
          BEFORE the freeze and vanishes the moment it exists, with no label
          change before the swap. SHOW_LIVE makes both reachable — a departure. */}
      {(SHOW_LIVE || !pClose) && pClose && (
        <div className="mt-4 flex items-center gap-2">
          <EngineChip text={ENGINE_TEXT.liveChip} color={MOVE_UP} />
          <span className="text-xs text-muted">{ENGINE_TEXT.liveChipNote}</span>
        </div>
      )}
      {(SHOW_LIVE || !pClose) && (
        <div className="mt-4">
          <RingTrio p={pLive} />
        </div>
      )}

      {/* G143 / G158–G161 — the stage board. Dead in v2 (`showStages={false}`),
          rendered here so every TAG word, every stage title and the Hist. Edge
          bars are on screen. The ids ARE load-bearing either way: they are what
          selects which rules move the rings, and "0c" is in no stage, so the
          day-of-week rule never reaches the maths above. */}
      {SHOW_STAGES &&
        STAGE_DEFS.map((stage) => {
          const byId = new Map(rules.map((r) => [r.id, r]))
          const stageRows = stage.ids
            .map((id) => byId.get(id))
            .filter((r): r is EngineRule => !!r)
            .map(toRow)
          return (
            <div key={stage.title} className="mt-4">
              <div className={`${SECTION_LABEL} uppercase`} style={{ color: T.cyan }}>
                {`${stage.icon} ${stage.title}`}
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                {stageRows.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-line px-2 py-1.5"
                  >
                    <span className="min-w-0">
                      <span className="text-2xs text-fg">{`${row.id} · ${row.name}`}</span>
                      {/* BUG (v2, G216): R13's `read` is the ONE place the
                          timing bug is visible. Its displayed word comes from
                          `breakTimeWordInPlay` (anchored to the selected window)
                          and its scored bucket from `breakTimeBucketScored`
                          (hardcoded 660/780) — two independent ladders, so on an
                          ORB window a break can read "midday" while scoring
                          "early". Both are transcribed as written. */}
                      <span className="block text-2xs text-muted">{row.desc}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className="rounded-sm px-1.5 py-0.5 text-3xs font-semibold"
                        style={{
                          color: EDGE_COLORS[row.status],
                          background: alpha(EDGE_COLORS[row.status], 0.12),
                        }}
                      >
                        {TAG[row.status]}
                      </span>
                      <span className="text-2xs text-muted">{ENGINE_TEXT.histEdge}</span>
                      <span
                        className="tabular text-xs font-semibold"
                        style={{ color: EDGE_COLORS[row.status] }}
                      >
                        {row.edge == null ? EM_DASH : `${row.edge}%`}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// THE EOD SCOREBOARD — `IbDailyResults` (G219–G235).
//
// 23 columns, NO SORT: rows render in API order, i.e. newest first
// (`ROWS_ARE_UNSORTED_NEWEST_FIRST`). No column is clickable and there is no
// arrow glyph anywhere.
// ─────────────────────────────────────────────────────────────────────────────

function DailyResultsTable({ data }: { data: readonly IbResultRow[] }) {
  const summary = biasSummary(data)
  return (
    <>
      {/* G223 — bias split of the recorded 10:30 calls. HARDCODED 10:30. */}
      <p className="mt-1.5 text-xs">
        <span className="text-muted">{BIAS_SUMMARY_TEXT.line1Label(summary.biasedCount)}</span>
        <span className="font-semibold" style={{ color: MOVE_UP }}>
          {BIAS_SUMMARY_TEXT.bullish(summary.bullPct)}
        </span>
        <span className="text-faint">{BIAS_SUMMARY_TEXT.separator}</span>
        <span className="font-semibold" style={{ color: MOVE_DOWN }}>
          {BIAS_SUMMARY_TEXT.bearish(summary.bearPct)}
        </span>
      </p>
      {/* G224 — what actually broke first, and how often the bias called it. */}
      <p className="mb-3 text-xs">
        <span className="text-muted">{BIAS_SUMMARY_TEXT.line2Label(summary.resolvedCount)}</span>
        <span className="font-semibold" style={{ color: MOVE_UP }}>
          {BIAS_SUMMARY_TEXT.bullish(summary.actualBullPct)}
        </span>
        <span className="text-faint">{BIAS_SUMMARY_TEXT.separator}</span>
        <span className="font-semibold" style={{ color: MOVE_DOWN }}>
          {BIAS_SUMMARY_TEXT.bearish(summary.actualBearPct)}
        </span>
        <span className="text-muted">{BIAS_SUMMARY_TEXT.biasCorrect}</span>
        <span className="font-semibold" style={{ color: summary.hitColor }}>
          {pct0(summary.hitPct)}
        </span>
      </p>

      {/* G225 — 23 columns need the horizontal scroller. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  title={c.title}
                  className={`${TH} ${c.align === 'left' ? 'text-left' : 'text-center'}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((r) => {
              const bias = biasCell(r)
              const brk = breakCell(r)
              const ext = extCell(r)
              const rules = rulesById(r)
              const shouldnt = shouldntBeCell(r)
              return (
                <tr key={`${r.symbol}-${r.date}`}>
                  {/* G226 — columns 1–8. */}
                  <td className={`${TD} text-left font-semibold`}>{r.date}</td>
                  <td className={`${TD} text-center`}>{widthCell(r)}</td>
                  <td className={`${TD} text-center uppercase`}>{bucketCell(r)}</td>
                  <td className={`${TD} text-center font-semibold`} style={{ color: bias.color }}>
                    {bias.text}
                  </td>
                  <td className={`${TD} text-center`}>{firstCell(r)}</td>
                  {/* G227 — six possible words, "†" when the break failed back
                      inside; the dagger is the ONLY case with a tooltip. */}
                  <td
                    className={`${TD} text-center font-semibold`}
                    style={{ color: brk.color }}
                    title={brk.title}
                  >
                    {brk.text}
                  </td>
                  <td className={`${TD} text-center`}>{timeCell(r)}</td>
                  {/* G226 col 8 — only a HIT is coloured; a ✗ stays body white. */}
                  <td className={`${TD} text-center font-semibold`} style={{ color: ext.color }}>
                    {ext.text}
                  </td>
                  {/* G228/G229 — R1…R14. Three cell states, two tooltip templates:
                      the idle branch's `name — note` (empty when the rule id is
                      absent altogether) and the scored branch's
                      `name — note · pointed HIGH|LOW`. */}
                  {RULE_IDS.map((id) => {
                    const cell = ruleCell(rules.get(id))
                    return (
                      <td
                        key={id}
                        className={`${TD} text-center ${cell.dim ? '' : 'font-semibold'}`}
                        style={{
                          color: cell.color,
                          opacity: cell.dim ? RULE_CELL_IDLE_OPACITY : 1,
                        }}
                        title={cell.title}
                      >
                        {cell.text}
                      </td>
                    )
                  })}
                  {/* G230 — the bias post-mortem. The tooltip spells out the
                      CALLED side and prints the ACTUAL side raw. */}
                  <td
                    className={`${TD} text-center ${shouldnt.failed ? 'font-semibold' : ''}`}
                    style={{
                      color: shouldnt.color,
                      opacity: shouldnt.failed ? 1 : RULE_CELL_IDLE_OPACITY,
                    }}
                    title={shouldnt.title}
                  >
                    {shouldnt.text}
                  </td>
                </tr>
              )
            })}
            {/* G232 — the hit-rate footer. First cell spans the eight session
                columns; then one cell per rule; then an empty cell under
                "Shouldn't Be". Every column has a different denominator. */}
            <tr>
              <td
                colSpan={HIT_RATE_COLSPAN}
                className={`${TD} text-left font-semibold`}
                style={{ color: HIT_RATE_LABEL_COLOR }}
              >
                {HIT_RATE_LABEL(data.length)}
              </td>
              {RULE_IDS.map((id) => {
                const cell = hitRateCell(data, id)
                return (
                  <td
                    key={id}
                    className={`${TD} text-center font-semibold`}
                    style={{ color: cell.color }}
                    title={cell.title}
                  >
                    {cell.text}
                  </td>
                )
              })}
              <td className={TD} />
            </tr>
          </tbody>
        </table>
      </div>

      <p className={FOOTNOTE}>{DAILY_RESULTS_TEXT.footnote}</p>

      {/* G234 — "THE RULES". Claim 12 says "inner 30m ORB"; every implementation
          uses the 09:30–09:45 fifteen-minute range. The code wins; the string is
          rendered as v2 ships it. */}
      <div className="mt-4 border-t border-line pt-3">
        <div className={`${SECTION_LABEL} mb-2`} style={{ color: DAILY_RESULTS_TEXT.legendHeadingColor }}>
          {DAILY_RESULTS_TEXT.legendHeading}
        </div>
        <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
          {RULE_IDS.map((id) => (
            <div key={id} className="flex gap-2 text-xs leading-relaxed">
              <span className="font-semibold" style={{ color: DAILY_RESULTS_TEXT.legendKeyColor }}>
                {`R${id}`}
              </span>
              <span className="text-fg">
                <span className="font-semibold">{RULE_NAMES[id]}</span>
                <span className="text-muted">{DAILY_RESULTS_TEXT.legendSeparator}</span>
                <span className="text-muted">{RULE_CLAIM[id]}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function IbDailyResults({
  sym,
  rows,
  err,
}: {
  sym: IbSymbol
  rows: IbResultRow[] | undefined
  err: string | null
}) {
  // G219 — closed by default. In v2 nothing had been fetched at this point
  // either; here the rows are already in hand and only the drawing is gated.
  const [open, setOpen] = useState(false)
  const view = dailyResultsView(err, rows)

  return (
    <div className="flex flex-col gap-4">
      <button type="button" className={DISCLOSURE} onClick={() => setOpen((o) => !o)}>
        {open ? DAILY_RESULTS_TEXT.disclosureOpen : DAILY_RESULTS_TEXT.disclosureClosed}
      </button>
      {open && (
        // G222 — HARDCODED to IB 60m: the recorder only ever writes the
        // 60-minute window, so this title ignores the selector above it.
        <Card title={DAILY_RESULTS_TEXT.title(sym)}>
          <p className={SUBTITLE}>{DAILY_RESULTS_TEXT.subtitle}</p>
          {/* G221 — one `err`, not keyed by symbol and never cleared: an ES
              failure leaves this banner up after switching to NQ. Reproduced. */}
          {view === 'error' && (
            <p className="text-xs" style={{ color: ERROR_COLOR }}>
              {err}
            </p>
          )}
          {view === 'loading' && <p className="text-xs text-fg">{DAILY_RESULTS_TEXT.loading}</p>}
          {view === 'empty' && <p className="text-xs text-fg">{DAILY_RESULTS_TEXT.empty}</p>}
          {view === 'table' && rows && <DailyResultsTable data={rows} />}
        </Card>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// THE OWNER BLOCK — sixteen cards in fixed order (G162–G201).
// ─────────────────────────────────────────────────────────────────────────────

function OwnerCards({
  ds,
  days,
  win,
}: {
  ds: IbDataset
  days: readonly SlimDay[]
  win: IbWindow
}) {
  const g = useMemo(() => buildOwnerGroups(ds, days), [ds, days])
  const rEnd = rangeEnd(win)
  const dow = dowRows(g)
  const totals = dowTotalsRow(days, g)
  const totalRates = dowTotalsRates(days, g)
  const fib = fibEntries(g)
  /** Card 5's only coloured columns, zero-based (G179). */
  const dowColored = new Set<number>(DOW_COLORED_COLUMNS)

  return (
    <>
      {/* CARD 1 — G166–G168. `ds.symbol` / `ds.barMinutes` come from the JSON,
          not the selector, so a mislabelled export shows the wrong symbol here. */}
      <Card title={OWNER_CARDS.header.title(win, ds)}>
        <p className={SUBTITLE}>{OWNER_CARDS.header.subtitle(win)}</p>
        <Tiles tiles={headerTiles(ds, days, g, win)} />
        <p className="text-xs leading-relaxed text-fg">
          <BoldParts text={OWNER_CARDS.header.body(win)} bold={OWNER_CARDS.header.bodyBold} />
        </p>
      </Card>

      {/* CARD 2 — G169–G171. A rule under 8 sample days VANISHES; an empty table
          still renders its header row, which is why `Tbl` is hand-rolled. */}
      <StatCard
        title={OWNER_CARDS.ranking.title}
        subtitle={OWNER_CARDS.ranking.subtitle}
        head={OWNER_CARDS.ranking.head}
        rows={rankingRows(g)}
        footNote={OWNER_CARDS.ranking.footNote}
      />

      {/* CARD 3 — G172. */}
      <StatCard
        title={OWNER_CARDS.baseline.title}
        subtitle={OWNER_CARDS.baseline.subtitle}
        head={OWNER_CARDS.baseline.head}
        rows={baselineRows(days, g)}
      />

      {/* CARD 4 — G173–G176. The "min after IB open" subs subtract 570
          unconditionally, so on an ORB tab they measure from 09:30. */}
      <StatCard
        title={OWNER_CARDS.breakTime.title}
        subtitle={OWNER_CARDS.breakTime.subtitle}
        tiles={breakTimeTiles(g)}
        head={OWNER_CARDS.breakTime.head}
        rows={breakTimeRows(g, rEnd)}
        footNote={OWNER_CARDS.breakTime.footNote}
      />

      {/* CARD 5 — G177–G182. Ten columns, NO SORT: always Monday→Friday, then
          ALL DAYS. The totals row drops the colour ladder on purpose, and its
          population is `days` (weekends included) while the weekday rows above
          exclude them — the two halves are not over the same set. */}
      <Card title={OWNER_CARDS.dow.title}>
        <p className={SUBTITLE}>{OWNER_CARDS.dow.subtitle}</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {OWNER_CARDS.dow.head.map((h, i) => (
                  <th key={h} className={`${TH} ${i === 0 ? 'text-left' : 'text-right'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dow.map((r) => {
                const cells: { text: string; color?: string }[] = [
                  { text: String(r.sessions) },
                  { text: r.avgWidth },
                  {
                    text: r.single == null ? EM_DASH : `${r.single.toFixed(1)}%`,
                    color: rateColor(r.single),
                  },
                  {
                    text: r.both == null ? EM_DASH : `${r.both.toFixed(1)}%`,
                    color: rateColor(r.both),
                  },
                  { text: r.never },
                  {
                    text: r.ext == null ? EM_DASH : `${r.ext.toFixed(1)}%`,
                    color: rateColor(r.ext),
                  },
                  { text: r.failRate },
                  { text: r.avgBreakTime },
                  { text: r.highFirst },
                ]
                return (
                  <tr key={r.name}>
                    <td className={`${TD} text-left`}>{r.name}</td>
                    {cells.map((c, i) => (
                      <td
                        key={i}
                        // `cells[i]` is table column i + 1 (the weekday name is
                        // column 0). Columns 3, 4 and 6 are the only coloured
                        // ones — the rest are plain white (G179).
                        className={`${TD} text-right ${dowColored.has(i + 1) ? 'font-semibold' : ''}`}
                        style={c.color ? { color: c.color } : undefined}
                      >
                        {c.text}
                      </td>
                    ))}
                  </tr>
                )
              })}
              <tr>
                {[
                  totals.name,
                  String(totals.sessions),
                  totals.avgWidth,
                  totalRates.single,
                  totalRates.both,
                  totals.never,
                  totalRates.ext,
                  totals.failRate,
                  totals.avgBreakTime,
                  totals.highFirst,
                ].map((text, i) => (
                  <td
                    key={i}
                    className={`${TD} font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}
                  >
                    {text}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className={FOOTNOTE}>{OWNER_CARDS.dow.footNote}</p>
      </Card>

      {/* CARD 6 — G183. */}
      <StatCard
        title={OWNER_CARDS.rule1.title}
        subtitle={OWNER_CARDS.rule1.subtitle}
        head={OWNER_CARDS.rule1.head}
        rows={rule1Rows(g)}
      />

      {/* CARD 7 — G184, G185. */}
      <StatCard
        title={OWNER_CARDS.rule2.title}
        subtitle={OWNER_CARDS.rule2.subtitle}
        head={OWNER_CARDS.rule2.head}
        rows={rule2Rows(g)}
        footNote={OWNER_CARDS.rule2.footNote}
      />

      {/* CARD 8 — G186. The last row reads `noMidReturn`, an export-only field
          nothing in the repo computes: a dataset without it renders a red 0.0%. */}
      <StatCard
        title={OWNER_CARDS.rule3.title}
        subtitle={OWNER_CARDS.rule3.subtitle}
        head={OWNER_CARDS.rule3.head}
        rows={rule3Rows(g)}
      />

      {/* CARD 9 — G187–G190. The WIDE row's "hit" column is the BOTH-SIDES rate,
          a different metric under the same header; its detail string is the only
          thing that says so. The NARROW tile's caption uses Math.min where the OR
          makes the true boundary the larger of the two (G188). */}
      <Card title={OWNER_CARDS.rule4.title}>
        <p className={SUBTITLE}>{OWNER_CARDS.rule4.subtitle}</p>
        <Tiles tiles={widthTiles(g)} />
        <Tbl head={OWNER_CARDS.rule4.head}>
          {widthBucketRows(g).map((r) => (
            <RowTr key={r.label} r={r} />
          ))}
        </Tbl>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {OWNER_CARDS.rule4.rangeHead.map((h, i) => (
                  <th key={h} className={`${TH} ${i === 0 ? 'text-left' : 'text-right'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {widthRangeRows(g).map((r) => (
                <tr key={r.label}>
                  <td className={`${TD} text-left font-semibold`} style={{ color: r.color }}>
                    {r.label}
                  </td>
                  <td className={`${TD} text-right`}>{r.range}</td>
                  <td className={`${TD} text-right`}>{r.mean}</td>
                  <td className={`${TD} text-right`}>{r.days}</td>
                  <td className={`${TD} text-right`}>{r.share}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={FOOTNOTE}>{OWNER_CARDS.rule4.footNote}</p>
      </Card>

      {/* CARD 10 — G191. BUG (v2): the WICK-only row's hits is the literal 0
          (`WICK_ONLY_HITS`), so its Rate cell always reads "0.0%" in the down
          colour beside two measured rates — a placeholder that looks measured. */}
      <StatCard
        title={OWNER_CARDS.rule5.title}
        subtitle={OWNER_CARDS.rule5.subtitle}
        head={OWNER_CARDS.rule5.head}
        rows={rule5Rows(g)}
        footNote={OWNER_CARDS.rule5.footNote}
      />

      {/* CARD 11 — G192. */}
      <StatCard
        title={OWNER_CARDS.rule6.title}
        subtitle={OWNER_CARDS.rule6.subtitle}
        head={OWNER_CARDS.rule6.head}
        rows={rule6Rows(g)}
        footNote={
          <BoldParts
            text={OWNER_CARDS.rule6.footNote(failPeakPts(g))}
            bold={[`${f2(failPeakPts(g))} pts`]}
          />
        }
      />

      {/* CARD 12 — G193. The `mid:` details read `fvgHitMid`, the second
          export-only field. */}
      <StatCard
        title={OWNER_CARDS.rule7.title}
        subtitle={OWNER_CARDS.rule7.subtitle}
        head={OWNER_CARDS.rule7.head}
        rows={rule7Rows(days, g)}
      />

      {/* CARD 13 — G194. The two populations are NOT complementary: a
          failed-and-not-retested day is in neither row. */}
      <StatCard
        title={OWNER_CARDS.rule8.title}
        subtitle={OWNER_CARDS.rule8.subtitle}
        head={OWNER_CARDS.rule8.head}
        rows={rule8Rows(g)}
        footNote={OWNER_CARDS.rule8.footNote}
      />

      {/* CARD 14 — G195. The only card with section rows. Variant A's rows 2 and
          3 are not mutually exclusive and can sum past 100%. */}
      <Card title={OWNER_CARDS.fib.title}>
        <p className={SUBTITLE}>{OWNER_CARDS.fib.subtitle}</p>
        <Tbl
          head={OWNER_CARDS.fib.head}
          footNote={
            <BoldParts
              text={OWNER_CARDS.fib.footNote(fibFootnoteMfe(g))}
              bold={[`${f2(fibFootnoteMfe(g))}× IB width`]}
            />
          }
        >
          {fib.map((e, i) =>
            e.kind === 'section' ? (
              <SectionTr key={`s-${i}`} text={e.text} />
            ) : (
              <RowTr key={`r-${i}`} r={e} />
            ),
          )}
        </Tbl>
      </Card>

      {/* CARD 15 — G196. */}
      <StatCard
        title={OWNER_CARDS.rule9.title}
        subtitle={OWNER_CARDS.rule9.subtitle}
        head={OWNER_CARDS.rule9.head}
        rows={rule9Rows(g)}
        footNote={
          <BoldParts
            text={OWNER_CARDS.rule9.footNote(allBreaksMfe(g), allBreaksMae(g))}
            bold={[`${f2(allBreaksMfe(g))}× IB width`, `${f2(allBreaksMae(g))}× IB width`]}
          />
        }
      />

      {/* CARD 16 — G197. The MIDDLE row counts `null === null` as a hit. */}
      <StatCard
        title={OWNER_CARDS.rule10.title}
        subtitle={OWNER_CARDS.rule10.subtitle}
        head={OWNER_CARDS.rule10.head}
        rows={rule10Rows(g)}
      />

      {/* CARD 17 — G198. Population is `wd` (bucketed days), not `days`; an open
          type with no matching session emits NO rows at all. */}
      <StatCard
        title={OWNER_CARDS.rule11.title}
        subtitle={OWNER_CARDS.rule11.subtitle}
        head={OWNER_CARDS.rule11.head}
        rows={rule11Rows(g)}
        footNote={OWNER_CARDS.rule11.footNote}
      />

      {/* CARD 18 — G199. On the 15m/5m windows the exporter has no inner ORB, so
          both rows go to n = 0 and read an em dash. */}
      <StatCard
        title={OWNER_CARDS.rule12.title}
        subtitle={OWNER_CARDS.rule12.subtitle}
        head={OWNER_CARDS.rule12.head}
        rows={rule12Rows(g)}
        footNote={OWNER_CARDS.rule12.footNote}
      />

      {/* CARD 19 — G200. The last window ends at 961 so a 16:00 break counts. */}
      <StatCard
        title={OWNER_CARDS.rule13.title}
        subtitle={OWNER_CARDS.rule13.subtitle}
        head={OWNER_CARDS.rule13.head}
        rows={rule13Rows(g, rEnd)}
        footNote={OWNER_CARDS.rule13.footNote}
      />

      {/* CARD 20 — G201. The two indented rows are exact complements. */}
      <StatCard
        title={OWNER_CARDS.rule14.title}
        subtitle={OWNER_CARDS.rule14.subtitle}
        head={OWNER_CARDS.rule14.head}
        rows={rule14Rows(g)}
      />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// THE 10:30 FREEZE.
//
// Module level, not a ref: v2's ref is mutated during render and dies with the
// component, so a tab switch re-captures the "frozen at the IB close" snapshot
// at whatever the state is then (G73). This map outlives a remount.
// ─────────────────────────────────────────────────────────────────────────────

const engineSnapshots = new Map<string, EngineSnapshot>()

// ─────────────────────────────────────────────────────────────────────────────
// THE TAB.
// ─────────────────────────────────────────────────────────────────────────────

export default function IbStatsTab() {
  // G8 — neither control is written back to the URL, so the tab's own state is
  // unshareable. Ported as written.
  const [sym, setSym] = useState<IbSymbol>(DEFAULT_SYMBOL)
  const [win, setWin] = useState<IbWindow>(DEFAULT_WINDOW)
  // G162 — the disclosure defaults closed.
  const [showStats, setShowStats] = useState(false)

  // G3/G4 — the TAB is public; exactly two blocks inside it are gated. v3
  // resolves ownership in one place instead of v2's two-field test (G5).
  const { isOwner } = useIsOwner()

  const [ds, setDs] = useState<IbDataset | undefined>(undefined)
  const [dsErr, setDsErr] = useState<string | null>(null)
  const [results, setResults] = useState<IbResultRow[] | undefined>(undefined)
  const [resultsErr, setResultsErr] = useState<string | null>(null)
  const [candles, setCandles] = useState<IbCandle[]>([])
  const [historical, setHistorical] = useState<IbCandle[]>([])
  const [connected, setConnected] = useState(false)
  const [snapTick, setSnapTick] = useState(0)

  // ── The three reads. Independent effects in one commit, so all three are in
  // flight together at mount — no waterfall (non-negotiable 4). G9/G10 note v2
  // cached the dataset per (sym, win) and never refetched; `query()`'s day-long
  // stale window is that, shared across mounts.
  useEffect(() => {
    let alive = true
    setDs(undefined)
    setDsErr(null)
    loadIbDataset(sym, win)
      .then((d) => {
        if (alive) setDs(d)
      })
      .catch((e: unknown) => {
        // G13 — the thrown message IS the card body, verbatim: it is the only
        // place on the tab that tells you how to produce the missing file.
        if (alive) setDsErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [sym, win])

  // ONE request at limit 90 feeds BOTH the tape and the scoreboard (G122/G220).
  useEffect(() => {
    let alive = true
    setResults(undefined)
    loadIbResults(sym)
      .then((rows) => {
        if (alive) setResults(rows)
      })
      // BUG (v2, G221): `err` is set here and NEVER cleared — not on a symbol
      // switch, not on a later success. An ES failure leaves the scoreboard's
      // red banner up while NQ loads fine. Reproduced deliberately.
      .catch((e: unknown) => {
        if (alive) setResultsErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [sym])

  // The live tape. No socket (see header note 6) — a poll that pauses on a
  // hidden tab stands in for v2's 4 Hz subscription.
  useEffect(() => {
    let alive = true
    const run = () => {
      loadIbCandles(sym)
        .then((c) => {
          if (!alive) return
          setCandles(c.today)
          setHistorical(c.historical)
          setConnected(c.connected)
        })
        .catch(() => {
          if (alive) setConnected(false)
        })
    }
    run()
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      run()
    }, IB_CANDLE_POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [sym])

  // G163 — the width backfill runs on `ds.days` before anything else reads them.
  const days = useMemo(() => (ds ? deriveWidthBuckets(ds.days) : []), [ds])
  // G63/G64 — the two trailing averages are the last 20 rows OF THE EXPORT, and
  // v2 rebuilt this object literal every render, re-running the whole live memo
  // with it. Memoised here; that is the one perf note ibStats.ts asks for.
  const hist = useMemo(() => buildHist(days), [days])
  const live = useMemo(
    () => computeLiveSession(candles, historical, hist, win),
    [candles, historical, hist, win],
  )

  // G55 — the BROWSER-LOCAL weekday, not the ET one. Every other date
  // computation on this tab is ET-anchored; this one is v2's `new Date().getDay()`
  // and it silently changes rule 0c's condition west of ET after 21:00 local.
  const dowIdx = new Date().getDay()
  const dowName = DOW_NAMES[dowIdx] ?? ''

  const session = live && !live.pending ? live : null
  const preRange = live && live.pending ? live : null
  const scored = useMemo(
    () => (session ? scoreWithHistory(buildRules(session, dowName, win), days) : []),
    [session, dowName, win, days],
  )
  // G75 — `n`, `last5`, `question` and the conditions are dropped here, which is
  // why the engine cannot weight by sample size even in principle.
  const engineRules = useMemo(() => engineRulesFrom(scored), [scored])
  const engineEnv = useMemo<EngineEnv>(
    () =>
      session
        ? engineEnvFrom(session)
        : // Inert: the engine card only renders with a session in hand.
          { ibWidth: 'normal', volume: 'normal', time: 'regular' },
    [session],
  )

  // G73 — written in an EFFECT, once, the first time the range is complete for
  // this (symbol, session).
  const snapKey = session ? engineSnapKey(sym, session.today) : null
  useEffect(() => {
    if (!snapKey || !session?.ibComplete) return
    if (engineSnapshots.has(snapKey)) return
    engineSnapshots.set(snapKey, { rules: [...engineRules], env: engineEnv })
    setSnapTick((n) => n + 1)
  }, [snapKey, session?.ibComplete, engineRules, engineEnv])
  // The map is not React state, so `snapTick` is what re-reads it after the
  // effect above writes the freeze.
  const closeSnap = useMemo(
    () => (snapKey ? engineSnapshots.get(snapKey) : undefined),
    [snapKey, snapTick],
  )

  // G122/G123 — the tape prefers the API's newest five and falls back to the
  // static export, whose newest session is LAST_UPDATED, with no visual
  // difference from live data.
  const apiTape = useMemo(() => (results ? tapeFrom(results) : []), [results])
  const tape = apiTape.length ? apiTape : fallbackTape(days)

  return (
    <div className="flex flex-col gap-4">
      {/* ── G15–G25 — the control strip. Rendered ABOVE every card in all three
          states (loading, error, populated) and always clickable. */}
      <div className="flex flex-wrap items-center gap-3">
        <SegGroup<IbSymbol>
          options={SYMBOLS.map((s) => ({ label: s, value: s }))}
          value={sym}
          onChange={setSym}
        />
        {/* G19 — the divider between the symbol pair and the window quartet. */}
        <span className="h-5 self-center border-l border-line" />
        {/* G20–G23 — each button's tooltip is its range plus " ET". */}
        <SegGroup<string>
          options={WINDOWS.map((w) => ({
            label: w.label,
            value: String(w.min),
            title: TAB_TEXT.windowTitle(w),
          }))}
          value={String(win)}
          onChange={(v) => setWin(Number(v) as IbWindow)}
        />
        {/* G24 — updates with the window; the dashes are EN DASHES. */}
        <span className="text-sm text-muted">{TAB_TEXT.rangeCaption(win)}</span>
      </div>

      {/* ── G13 — the dataset error card. Its body is the thrown message. */}
      {dsErr && (
        <Card title={TAB_TEXT.errorTitle(win)}>
          <p className="text-sm" style={{ color: ERROR_COLOR }}>
            {dsErr}
          </p>
        </Card>
      )}

      {/* ── G12 — the loading card. */}
      {!dsErr && !ds && (
        <Card title={TAB_TEXT.loadingTitle(win)}>
          <p className="text-sm text-fg">{TAB_TEXT.loadingBody(sym, win)}</p>
        </Card>
      )}

      {/* ── The live trio (G76: LiveGauges → RuleClusterBoard → IbProbabilityEngine),
          or one of the two early-return cards. */}
      {ds && !dsErr && (
        <>
          {live == null && (
            // G53 — the state outside market hours and at weekends. The IB Read
            // and Probability Engine cards do not render at all here.
            <Card title={LIVE_EMPTY_TEXT.noBarsTitle(sym)}>
              <p className={SUBTITLE}>
                {connected
                  ? LIVE_EMPTY_TEXT.noBarsSubtitleConnected
                  : LIVE_EMPTY_TEXT.noBarsSubtitleOffline}
              </p>
              <p className="text-sm text-fg">{LIVE_EMPTY_TEXT.noBarsBody}</p>
            </Card>
          )}

          {preRange && (
            // G54 — before the first range bar prints.
            <Card title={LIVE_EMPTY_TEXT.pendingTitle(sym, dowName)}>
              <p className={SUBTITLE}>{LIVE_EMPTY_TEXT.pendingSubtitle(win)}</p>
              <Tiles
                tiles={[
                  { k: LIVE_EMPTY_TEXT.pendingPriceKey, v: f2(preRange.price) },
                  { k: LIVE_EMPTY_TEXT.pendingClockKey, v: clock(preRange.nowMin) },
                ]}
              />
            </Card>
          )}

          {session && (
            <>
              <LiveRead live={session} days={days} win={win} dowIdx={dowIdx} />
              <IbRead live={session} scored={scored} tape={tape} win={win} />
              <ProbabilityEngine
                sym={sym}
                rules={engineRules}
                env={engineEnv}
                closeSnap={closeSnap}
              />
            </>
          )}

          {/* ── G162 — the owner disclosure and its sixteen cards. */}
          {isOwner && (
            <>
              <button
                type="button"
                className={DISCLOSURE}
                onClick={() => setShowStats((s) => !s)}
              >
                {showStats
                  ? OWNER_CARDS.disclosure.hide
                  : OWNER_CARDS.disclosure.show(days.length)}
              </button>
              {showStats && <OwnerCards ds={ds} days={days} win={win} />}
            </>
          )}

          {/* ── G219–G235 — the EOD scoreboard, owner only. */}
          {isOwner && <IbDailyResults sym={sym} rows={results} err={resultsErr} />}
        </>
      )}
    </div>
  )
}
