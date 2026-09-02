// ─────────────────────────────────────────────────────────────────────────────
// THE IB PROBABILITY ENGINE.
//
// Transcribed 1:1 from v2's `components/insights/IbProbabilityEngine.tsx`
// (253 lines) plus its two call-site props in `components/scanner/IbStatsTab.tsx`
// (`:410–424`, `:433–441`), against the checklist in docs/parity/scanner.md
// Part G, rows G142–G161 and G249.
//
// The card takes the SAME `buildRules()` output the family board reads, buckets
// each in-play rule by the side it points to, applies four environmental
// multipliers, and normalises to three integers that fill three rings.
//
// SIX things here are not obvious from the screen:
//
//   1. THE WEIGHT IS FLAT. Every in-play rule contributes `(edge/100) * 1.5`,
//      full stop. Sample size is not an input — `engineRules` strips `n` before
//      the rules ever reach this file — so a rule matching 12 sessions moves the
//      gauges exactly as hard as one matching 900. (Q8.)
//   2. A DIRECTIONLESS IN-PLAY RULE IS BUCKETED AS *ROTATION*, not excluded.
//      Rules 4, 11, 14 and 0c carry `side: null`, so "IB Width → Day Type" at
//      62% adds 0.93 to rotation risk purely for having no side.
//   3. RULE `0c` NEVER REACHES THE ENGINE AT ALL. The gauge population is
//      `STAGE_DEFS.flatMap(...)`, and 0c is in no stage — even though it renders
//      as a family member on the card directly above.
//   4. THE ADDITIVE TERMS LAND BEFORE THE MULTIPLICATIVE ONES, so the wide-range
//      `+2.0` is itself multiplied by the 1.2 and the 1.5 that follow.
//   5. ROTATION IS A ROUNDING RESIDUAL: `100 − round(bull) − round(bear)`. It can
//      come out a point low, a point high, or NEGATIVE (bull 50.5→51,
//      bear 49.5→50 ⇒ rot = −1), which renders as an empty ring over a "-1%"
//      label. (Q9.)
//   6. THE STAGE ORDER IS NOT NUMERIC. `allRows` walks stages 1–4, i.e. ids
//      4, 11, 7, 2, 1, 10, 12, 5, 6, 13, 3, 8, 9, 14. Order does not affect the
//      sums, but it is the order the (unrendered) stage board would print, and
//      it is what defines WHICH rules feed the gauges.
//
// ── THE TWO-GREENS / TWO-REDS DECISION ───────────────────────────────────────
// v2 declares a page-local pair at `IbProbabilityEngine.tsx:37–39`:
//
//     // Positive/negative semantic colors — real green, true red (not pink).
//     const POS = "#1FD98A";
//     const NEG = "#FF3B3B";
//
// …and uses them where the card above uses `HOME_THEME.green` #8ECAE6 and
// `HOME_THEME.red` #EF4444 for the same two ideas, one card apart on one screen.
//
// THE CALL: COLLAPSE. Both pairs carry ONE semantic — positive/up and
// negative/down — so both become MOVE_UP / MOVE_DOWN here.
//
// THE EVIDENCE, from v2's own source:
//   • the comment names the semantic ("Positive/negative semantic colors") and
//     then argues about the HUE, not the meaning: "real green", "true red (not
//     pink)". That is a complaint that #8ECAE6 is a light blue and #EF4444 is
//     pinkish — i.e. that the shared token looked wrong, not that this card
//     means something different by it;
//   • `C.bull` carries the comment "any positive breakout chance → green" and
//     `C.bear` just "true red" — the same two roles the Live Read gauge paints
//     with HOME_THEME.green/red;
//   • nothing in the file distinguishes the two greens by MEANING anywhere: no
//     surface uses both, and no legend explains a difference to a reader.
// One semantic painted two ways is drift, and a re-key is the moment to drop it.
// `EDGE_COLORS` below is the one pair.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • `edgeGradient()` (`:58–60`) — `linear-gradient(90deg, ${color}59, ${color})`,
//   a hex-alpha concatenation onto a theme colour. It paints the `EdgeBar` in
//   the stage board, which does not render on this tab, and it is styling.
// • `dangerouslySetInnerHTML` on the gauge labels (`:120`). v2 injects
//   "Bullish<br/>Edge" as raw HTML PURELY to get a line break. The labels are
//   two words each below; step 3 breaks them with markup, not with a string.
//
// Spec: docs/parity/scanner.md Part G, rows G142–G161, G249.
// ─────────────────────────────────────────────────────────────────────────────

import { MOVE_DOWN, MOVE_UP, T } from '@/design/theme'
import type { LiveSession, ScoredRule } from '@/pages/scanner/ibStats'

// ─────────────────────────────────────────────────────────────────────────────
// INPUTS.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the engine is handed (`IbProbabilityEngine.tsx:22–29`).
 *
 * NOTE what is NOT here: `n`, `last5`, `question`, `cond` and `outcome`. The tab
 * drops them at `IbStatsTab.tsx:411`, which is why the engine cannot weight by
 * sample size even in principle.
 */
export interface EngineRule {
  /** "1" … "14", straight off buildRules. */
  id: string
  name: string
  state: 'in-play' | 'pending' | 'not-in-play'
  side: 'H' | 'L' | null
  /** The live description, shown as the row text on the (unrendered) stage board. */
  read: string
  /** The historical edge, in percent, or null. */
  p: number | null
}

export interface EngineEnv {
  ibWidth: 'wide' | 'narrow' | 'normal'
  volume: 'active' | 'normal'
  time: 'late' | 'regular'
}

/**
 * The rule payload (`IbStatsTab.tsx:410–411`): score every rule against history,
 * then keep six fields.
 */
export function engineRulesFrom(scored: readonly ScoredRule[]): EngineRule[] {
  return scored.map((r) => ({ id: r.id, name: r.name, state: r.state, side: r.side, read: r.read, p: r.p }))
}

/**
 * The environment payload (`IbStatsTab.tsx:412–416`).
 *
 * A "—" width bucket falls through to "normal"; `volSurge === null` falls
 * through to "normal" volume, which is the branch that BOOSTS rotation (there is
 * no "quiet" case — anything not "active" multiplies rotation by 1.2). `time`
 * flips at 14:00 ET.
 */
export function engineEnvFrom(live: LiveSession): EngineEnv {
  return {
    ibWidth: live.bucket === 'WIDE' ? 'wide' : live.bucket === 'NARROW' ? 'narrow' : 'normal',
    volume: live.volSurge === true ? 'active' : 'normal',
    time: live.nowMin >= 840 ? 'late' : 'regular',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE MODEL.
// ─────────────────────────────────────────────────────────────────────────────

export type EngineStatus = 'bull' | 'bear' | 'rot' | 'off'

export interface EngineRow {
  /** "R" + the rule id — "R1", "R14". */
  id: string
  name: string
  status: EngineStatus
  /** The rule's `p`, ROUNDED to an integer here and nowhere else. */
  edge: number | null
  desc: string
}

/**
 * `toRow` (`IbProbabilityEngine.tsx:75–82`).
 *
 * Anything not IN-PLAY becomes "off" and contributes nothing — PENDING rules
 * included, however confident their "if it fires" rate is. An in-play rule with
 * NO SIDE becomes "rot": that is finding 2 in the header.
 */
export function toRow(r: EngineRule): EngineRow {
  const status: EngineStatus =
    r.state !== 'in-play' ? 'off' : r.side === 'H' ? 'bull' : r.side === 'L' ? 'bear' : 'rot'
  return {
    id: `R${r.id}`,
    name: r.name,
    status,
    edge: r.p == null ? null : Math.round(r.p),
    desc: r.read,
  }
}

/** The flat per-rule weight. Not a tunable in v2 — a literal at `:90`. */
export const RULE_WEIGHT = 1.5

/** The four environment adjustments, in APPLICATION ORDER (`:96–99`). */
export const ENV_MULTIPLIERS = {
  /** 1. Additive, and therefore itself scaled by steps 3 and 4 below. */
  wideRotationBonus: 2.0,
  /** 2. Additive, to BOTH directional buckets. "normal" contributes nothing. */
  narrowDirectionalBonus: 0.8,
  /** 3. Multiplicative, on the two directional buckets… */
  activeVolumeDirectional: 1.3,
  /** …or, when volume is anything but "active", on rotation. There is no third branch. */
  quietVolumeRotation: 1.2,
  /** 4. Multiplicative, on rotation, after everything else. */
  lateRotation: 1.5,
} as const

export interface EngineProbabilities {
  bull: number
  bear: number
  rot: number
}

/**
 * `calculateComplexProbabilities` (`IbProbabilityEngine.tsx:85–104`), in three
 * steps and in this exact order.
 *
 * STEP 1 — every row with `status !== "off"` and a non-null edge adds
 *          `(edge / 100) * 1.5` to the bucket its status names. `active` counts
 *          those rows; if none qualify the function returns three ZEROS and all
 *          three rings read 0%.
 *
 * STEP 2 — the four multipliers, additive first (see ENV_MULTIPLIERS).
 *
 * STEP 3 — `total = bull + bear + rot || 1`; bull and bear are each rounded
 *          INDEPENDENTLY; rotation is whatever is left of 100.
 *
 * BUG (v2): step 3's residual can be negative — bull 50.5 → 51 and bear
 * 49.5 → 50 leaves rot = −1, which gives `strokeDashoffset > CIRC` (an empty
 * ring) beside a "-1%" label. Ported as written; clamping or rounding all three
 * and re-normalising both change published numbers, so step 3 decides (Q9).
 */
export function calculateComplexProbabilities(
  rows: readonly EngineRow[],
  env: EngineEnv,
): EngineProbabilities {
  let bull = 0
  let bear = 0
  let rot = 0
  let active = 0

  for (const r of rows) {
    if (r.status === 'off' || r.edge == null) continue
    active++
    const pts = (r.edge / 100) * RULE_WEIGHT
    if (r.status === 'bull') bull += pts
    else if (r.status === 'bear') bear += pts
    else rot += pts
  }
  if (!active) return { bull: 0, bear: 0, rot: 0 }

  if (env.ibWidth === 'wide') rot += ENV_MULTIPLIERS.wideRotationBonus
  if (env.ibWidth === 'narrow') {
    bull += ENV_MULTIPLIERS.narrowDirectionalBonus
    bear += ENV_MULTIPLIERS.narrowDirectionalBonus
  }
  if (env.volume === 'active') {
    bull *= ENV_MULTIPLIERS.activeVolumeDirectional
    bear *= ENV_MULTIPLIERS.activeVolumeDirectional
  } else {
    rot *= ENV_MULTIPLIERS.quietVolumeRotation
  }
  if (env.time === 'late') rot *= ENV_MULTIPLIERS.lateRotation

  const total = bull + bear + rot || 1
  const bullPct = Math.round((bull / total) * 100)
  const bearPct = Math.round((bear / total) * 100)
  return { bull: bullPct, bear: bearPct, rot: 100 - bullPct - bearPct }
}

/**
 * The stage buckets (`:66–71`). Their titles and icons never render on this tab
 * (`showStages={false}`), but the id lists are what select the gauge population,
 * so they are load-bearing whatever the card shows.
 *
 * All 14 numbered rules appear, in this NON-NUMERIC order. `"0c"` appears in no
 * stage and is therefore excluded from the gauge maths entirely.
 */
export const STAGE_DEFS: readonly { icon: string; title: string; ids: readonly string[] }[] = [
  { icon: '🔒', title: 'Stage 1: Opening Baseline Setup', ids: ['4', '11', '7', '2'] },
  { icon: '🔓', title: 'Stage 2: Interior Range Dynamics', ids: ['1', '10', '12'] },
  { icon: '🔓', title: 'Stage 3: Breakout Validation & Traps', ids: ['5', '6', '13'] },
  { icon: '🏁', title: 'Stage 4: Continuation Targets & End-of-Day', ids: ['3', '8', '9', '14'] },
]

/**
 * The gauge population (`:167–168`): stage order, missing ids dropped.
 * Exported because it is the only definition of "which rules move the needles".
 */
export function engineRows(rules: readonly EngineRule[]): EngineRow[] {
  const byId = new Map(rules.map((r) => [r.id, toRow(r)]))
  return STAGE_DEFS.flatMap((s) =>
    s.ids.map((id) => byId.get(id)).filter((r): r is EngineRow => !!r),
  )
}

/** One call: rules in, three integers out. */
export function engineProbabilities(
  rules: readonly EngineRule[],
  env: EngineEnv,
): EngineProbabilities {
  return calculateComplexProbabilities(engineRows(rules), env)
}

// ─────────────────────────────────────────────────────────────────────────────
// THE 10:30 FREEZE.
// Spec row G73. v2 keeps this in a ref MUTATED DURING THE RENDER PHASE
// (`IbStatsTab.tsx:420–424`), keyed `${sym}-${live.today}`, written the first
// time `live.ibComplete` is true for that session.
//
// It survives re-renders and NOT a remount: switching tabs and coming back loses
// the freeze and re-captures at whatever the state is then, still labelled
// "frozen at the IB close". v3 must hold this somewhere a remount does not clear
// and write it in an effect — the ref-in-render is not portable and not correct.
// ─────────────────────────────────────────────────────────────────────────────

export interface EngineSnapshot {
  rules: EngineRule[]
  env: EngineEnv
}

export const engineSnapKey = (sym: string, today: string): string => `${sym}-${today}`

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT — every string and every number the card paints.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The status tag words (`:63`). `TAG.off` and the whole tag chip only render on
 * the stage board, which is off on this tab — kept because the words are
 * otherwise unrecoverable.
 */
export const TAG: Record<EngineStatus, string> = {
  bull: 'Bullish Edge',
  bear: 'Bearish Edge',
  rot: 'Rotational Risk',
  off: 'Inactive',
}

/**
 * `EDGECOL` (`:62`) — the ring colours, and the tag/dot colours on the stage
 * board. v2's `POS` #1FD98A and `NEG` #FF3B3B are collapsed onto MOVE_UP /
 * MOVE_DOWN here; see the decision note in the file header. `off` was #6B7686,
 * which is what `T.flat` already means.
 */
export const EDGE_COLORS: Record<EngineStatus, string> = {
  bull: MOVE_UP,
  bear: MOVE_DOWN,
  rot: T.orange,
  off: T.flat,
}

/**
 * The three gauges, in fixed left-to-right order (`:209–212`, `:225–228`).
 * `label` is two words; v2 forced the break with an injected `<br/>`.
 */
export const GAUGES = [
  { key: 'bull', label: 'Bullish Edge', color: EDGE_COLORS.bull },
  { key: 'bear', label: 'Bearish Edge', color: EDGE_COLORS.bear },
  { key: 'rot', label: 'Rotation Risk', color: EDGE_COLORS.rot },
] as const

/**
 * Ring geometry (`:106–123`). These are SVG USER UNITS inside a fixed
 * `viewBox="0 0 118 118"`, not CSS pixels — the ring is a dash-array on a circle
 * and the numbers are the maths, not layout.
 *
 * The whole `<svg>` is rotated −90° so the ring starts at twelve o'clock.
 */
export const RING = {
  viewBox: '0 0 118 118',
  cx: 59,
  cy: 59,
  r: 50,
  strokeWidth: 9,
  rotateDeg: -90,
  /** 2π·50, printed as "314.2" — v2 formats the dasharray to one decimal. */
  circumference: 2 * Math.PI * 50,
} as const

/** `CIRC * (1 - pct/100)`, one decimal. A pct of 0 leaves the ring undrawn. */
export function ringDashOffset(pct: number): number {
  return RING.circumference * (1 - pct / 100)
}

/** The centre number greys out at zero (`:117`). */
export function ringNumberColor(pct: number, color: string): string {
  return pct > 0 ? color : T.muted
}

/** Every fixed string on the card. */
export const ENGINE_TEXT = {
  icon: '📊',
  title: 'Probability Engine',
  strapline: (sym?: string): string =>
    `Live mathematical projection of final intraday session behavior based on active indicators${sym ? ` — ${sym} futures` : ''}.`,
  /**
   * HARDCODED "10:30" (`:204`) — it does not follow the window selector, so on
   * ORB 15m it labels an 09:45 freeze as 10:30.
   */
  closeChip: '10:30 Close',
  closeChipNote: 'frozen at the IB close',
  /** Both dead on this tab: `showLive={false}` makes the guard `!pClose && pClose`. */
  liveChip: 'Live',
  liveChipNote: 'updating now',
  histEdge: 'Hist. Edge',
} as const

/**
 * The two flags the tab passes (`IbStatsTab.tsx:439–440`), and what they do:
 *
 *   showStages={false} — the four stage sections NEVER render here. Every
 *                        `RuleRow`, the `Hist. Edge` bars and the TAG chips are
 *                        unreachable on this tab.
 *   showLive={false}   — the "Live" chip's guard collapses to `!pClose && pClose`,
 *                        i.e. ALWAYS FALSE, so the chip can never appear; the
 *                        live GAUGES' guard collapses to `!pClose`, so they show
 *                        BEFORE the freeze exists and vanish the moment it does.
 *
 * That second one is the behaviour worth naming: at the range close the card
 * silently swaps which trio of gauges it is showing, with no label change before
 * the swap.
 */
export const ENGINE_FLAGS = { showLive: false, showStages: false } as const
