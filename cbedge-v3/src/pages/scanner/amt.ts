// ─────────────────────────────────────────────────────────────────────────────
// AMT — THE AUCTION READ AND ITS FIFTEEN SIGNALS.
//
// Transcribed 1:1 from v2's `lib/amt.ts:1–305` (the read and the catalogue) and
// `components/pages/Scanner.tsx:2727–2894` (`LEVEL_RANK`, `LEVEL_COLOR`,
// `dirGlyph`, `AmtSignalRow`, `AmtPanel`), against the checklist in
// docs/parity/scanner.md Part F, rows F95–F122 and F.13.
//
// WHAT THIS IS. Steidlmayer/Dalton auction logic layered on the TPO engine.
// `buildTpoStructures` already gives, per RTH session: IB high/low/range,
// POC/VAH/VAL, the day open, the single prints and the structures. AMT is the
// READ on top of that skeleton — the four questions Dalton front-loads into the
// first sixty to ninety minutes:
//
//   1. IB width vs its own recent median  → which day type is in play?
//   2. Where did we open vs prior value?  → opening type / conviction
//   3. Is value building inside, above or below prior value? → balance vs imbalance
//   4. At the extremes, is activity responsive (fade) or initiative (follow)?
//
// SIX PIECES OF BUSINESS LOGIC THAT ARE NOT OBVIOUS FROM THE SCREEN:
//
//   1. `amtRead` IS PURE AND CHEAP AND MUST STAY THAT WAY. It derives only from
//      the already-memoised `TpoResult`, so it recomputes once per new bar and
//      never re-runs the heavy multi-day structure scan. LIVENESS — spot vs a
//      signal's trigger — is deliberately NOT computed here; it is computed per
//      render in the row, which is how a signal can light up on a socket tick
//      without the profile being rebuilt.
//   2. LIVENESS IS COMPUTED TWICE, INDEPENDENTLY, PER RENDER. The sort's copy
//      (in `sortAmtSignals`) and the row's copy (`isSignalLive`) are separate
//      evaluations of the same predicate. That is not redundancy to remove: the
//      sort order is a memo keyed on `[signals, spot, livePad]` while the row's
//      badge reacts to every tick, and collapsing them would either freeze the
//      badge or re-sort the rail under the user's cursor.
//   3. THE DISTANCE IS SIGNED IN ONE PLACE AND UNSIGNED IN THE OTHER. The row
//      prints `trigger − spot` WITH its sign; the sort's third key uses
//      `Math.abs`. Both are correct for their job and neither is the other's.
//   4. `Infinity` IS THE SORT'S NULL. A signal with no trigger, or any signal
//      when spot is unknown, gets `dist = Infinity`, so triggerless signals sink
//      to the bottom of their level band instead of floating to the top.
//   5. THE MEDIAN IS THE UPPER MEDIAN. `s[Math.floor(len / 2)]` on an ascending
//      sort — on an even count that is the higher of the two middles, not their
//      average. The IB baseline is built from at most the last 20 non-null,
//      positive `ibRange` values of every session EXCEPT the newest.
//   6. `shift_up` / `shift_down` USE NO PAD while `imbalance_up` /
//      `imbalance_down` do. Asymmetric, copied as written — open question 6.
//
// ── APPROXIMATION, AND WHY THE LABELS SAY SO ─────────────────────────────────
// Everything is derived from 5m OHLC with no tick tape, so the opening type is
// inferred from where the open sits within the day's REALIZED range rather than
// from the literal first-fifteen-minutes tape. That is why all four opening
// labels carry "(approx)" and why nothing else does — the rest is exact given
// the profile.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • Nothing is removed. `playbook` and `avgIbRange` are both kept and both
//   tagged `@neverReadInV2` below rather than dropped: they are computed on
//   every read, they are correct, and they are the only structured pre-market
//   process text the tab has. See their tags.
//
// Spec: docs/parity/scanner.md Part F, rows F95–F122, F.13.
// ─────────────────────────────────────────────────────────────────────────────

import { LIGHT_BLUE, MOVE_DOWN, MOVE_UP, T } from '@/design/theme'
import type { StructureKind } from '@/pages/scanner/tpoTaxonomy'
import type { TpoResult, TpoSession } from '@/pages/scanner/tpoStructures'

// ── TYPES ────────────────────────────────────────────────────────────────────

export type AmtState = 'balance' | 'imbalance_up' | 'imbalance_down' | 'shift_up' | 'shift_down'

export type SignalLevel = 'action' | 'watch' | 'info'

export type SignalDir = 'up' | 'down' | 'flat'

export interface AmtSignal {
  /**
   * For the seven fixed signals this is a literal id; for a structure signal it
   * is the STRUCTURE'S own id (`date:kind:priceLo`), and for the naked-POC
   * magnet it is that id prefixed `np-`. The prefix exists because the same
   * structure could otherwise collide with itself.
   */
  id: string
  /** Inherent priority. The UI upgrades a signal to LIVE near spot; the level does not change. */
  level: SignalLevel
  title: string
  detail: string
  dir: SignalDir
  /** The price to watch — where this becomes actionable. */
  trigger: number | null
  /** Where the play aims. `null` renders as the literal word "trail". */
  target: number | null
}

export type IbClass = 'narrow' | 'average' | 'wide' | null

export type RangeExt = 'none' | 'up' | 'down' | 'both'

export interface AmtRead {
  ok: boolean
  /** Only set when `ok` is false. One of exactly two strings — see `AMT_REASON`. */
  reason?: string

  today: TpoSession | null
  prior: TpoSession | null

  /**
   * @neverReadInV2
   * The recent-median IB range the ratio is built from. Returned and never
   * displayed — the IB tile shows `ibRatio` and `ibClass`, not this. Kept
   * because it is the denominator and a reader checking the tile's arithmetic
   * has no other way to see it. Spec "Do not port" 6.
   */
  avgIbRange: number | null
  /** today IB / recent median IB. */
  ibRatio: number | null
  ibClass: IbClass

  dayType: { label: string; note: string }
  opening: { label: string; note: string } | null

  rangeExt: RangeExt
  state: AmtState
  /** Always `"<value> — <note>"`; the tile splits on `" — "`. */
  stateLabel: string

  location: string
  bias: string
  /**
   * @neverReadInV2
   * Five composed process lines — mark prior value, grade the IB, name the open,
   * state the bias, then the acceptance rule. Computed on every read and
   * RENDERED NOWHERE in this tab. Kept in the type and in `amtRead` because it
   * is the only place the read is written as a sequence a trader would follow
   * rather than as four tiles, and because dropping it silently is the failure
   * this port exists to prevent. Step 3 must decide whether it ships.
   * Spec "Do not port" 5.
   */
  playbook: string[]

  signals: AmtSignal[]
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

/** UPPER median — `s[Math.floor(len / 2)]`, not the mean of the two middles. */
const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? null
}

/**
 * The direction a structure signal leans. Partial on purpose: `hole` and
 * `naked_poc` are absent, so the hole branch's `STRUCT_DIR[kind] ?? "flat"`
 * ALWAYS resolves to `"flat"` and the `??` is not a fallback, it is the answer.
 *
 * NOTE `excess_high → "down"` and `tail_high → "up"`: an excess high is faded
 * (you sell it) and a tail high is followed (you buy pullbacks into it). Same
 * end of the profile, opposite lean — the taxonomy's central point, expressed as
 * a lookup table.
 */
const STRUCT_DIR: Partial<Record<StructureKind, 'up' | 'down'>> = {
  excess_high: 'down',
  tail_high: 'up',
  poor_high: 'up',
  excess_low: 'up',
  tail_low: 'down',
  poor_low: 'down',
}

/** The two — and only two — reasons the panel can be not-ready. */
export const AMT_REASON = {
  noSession: 'No RTH session yet.',
  noPrior: 'Needs a prior completed session for value context.',
} as const

// ── LADDER 1: IB WIDTH ───────────────────────────────────────────────────────

/** At most this many prior sessions feed the IB baseline. */
export const IB_BASELINE_WINDOW = 20
export const IB_NARROW_BELOW = 0.75
export const IB_WIDE_ABOVE = 1.25

/**
 * Evaluated in this order, and the order is the whole ladder:
 *   1. no ratio            → null      (no baseline yet; the tile says "building")
 *   2. ratio <  0.75       → "narrow"
 *   3. ratio >  1.25       → "wide"
 *   4. otherwise           → "average" — [0.75, 1.25] INCLUSIVE at both ends
 */
export function classifyIb(ibRatio: number | null): IbClass {
  if (ibRatio == null) return null
  if (ibRatio < IB_NARROW_BELOW) return 'narrow'
  if (ibRatio > IB_WIDE_ABOVE) return 'wide'
  return 'average'
}

// ── LADDER 2: RANGE EXTENSION ────────────────────────────────────────────────

/**
 * `pad` is the bin size — 1 pt on ESU, 5 on NQU. The extension must clear the IB
 * by a full bin, so a single tick through the IB high is not an extension.
 *
 * Both sides are tested independently and `both` wins over either, so a day that
 * extended up and then down reports `"both"` and lands on a two-sided day type.
 */
export function classifyRangeExtension(today: TpoSession, pad: number): RangeExt {
  const reUp = today.ibHigh != null && today.high > today.ibHigh + pad
  const reDn = today.ibLow != null && today.low < today.ibLow - pad
  return reUp && reDn ? 'both' : reUp ? 'up' : reDn ? 'down' : 'none'
}

// ── LADDER 3: DAY TYPE (8 outcomes) ──────────────────────────────────────────

/**
 * IB width crossed with realized range extension. Eight branches; the spec
 * counts seven distinct LABELS because `"Neutral — two-sided"` is reached from
 * both the wide/both and the average/both branches with DIFFERENT notes.
 *
 * BUG (v2): the narrow branch's second case catches `rangeExt === "both"` as
 * well as `"none"` and tells the user "Narrow IB, no extension yet. Odds favor a
 * range-extension break" — on a day that has already extended BOTH ways. A
 * narrow IB with two-sided extension is the opposite of coiled. Copied as
 * written; step 3 decides. Spec F.13, day-type table row 2.
 */
export function classifyDayType(ibClass: IbClass, rangeExt: RangeExt): { label: string; note: string } {
  if (ibClass === 'narrow') {
    if (rangeExt === 'up' || rangeExt === 'down') {
      return {
        label: 'Trend / range-extension',
        note: `Narrow IB, one-sided extension ${rangeExt}. Do NOT fade — position with the move on pullbacks.`,
      }
    }
    return {
      label: 'Coiled — expect extension',
      note: 'Narrow IB, no extension yet. Odds favor a range-extension break; trade the break, not the middle.',
    }
  }
  if (ibClass === 'wide') {
    if (rangeExt === 'both') {
      return {
        label: 'Neutral — two-sided',
        note: 'Wide IB, extension both ways. Rotational and noisy — fade extremes or stand aside.',
      }
    }
    if (rangeExt === 'none') {
      return {
        label: 'Normal — rotational',
        note: 'Wide IB, minimal extension. Bell-shaped rotation likely — fade value-area extremes toward POC.',
      }
    }
    return {
      label: 'Normal — modest extension',
      note: `Wide IB with ${rangeExt} extension. Lean with the extension but respect rotation risk.`,
    }
  }
  // "average" AND null — a day with no IB baseline yet is graded as average.
  if (rangeExt === 'up' || rangeExt === 'down') {
    return {
      label: 'Normal variation',
      note: `Average IB, ${rangeExt}-side extension — the most common day. Trade with the extension.`,
    }
  }
  if (rangeExt === 'both') {
    return {
      label: 'Neutral — two-sided',
      note: 'Average IB, both-sided extension. Fade extremes or stand aside.',
    }
  }
  return {
    label: 'Balancing',
    note: 'Average IB, no extension. Two-sided so far — let the auction tip its hand.',
  }
}

// ── LADDER 4: STATE (5 steps) ────────────────────────────────────────────────

/**
 * Today's value vs the prior session's, first match wins:
 *
 *   1. today.val > prior.vah + pad  → imbalance_up    (value ENTIRELY above)
 *   2. today.vah < prior.val - pad  → imbalance_down
 *   3. today.poc > prior.vah        → shift_up        (NO PAD — see note 6)
 *   4. today.poc < prior.val        → shift_down      (NO PAD)
 *   5. otherwise                    → balance
 */
export function classifyState(today: TpoSession, prior: TpoSession, pad: number): AmtState {
  if (today.val > prior.vah + pad) return 'imbalance_up'
  if (today.vah < prior.val - pad) return 'imbalance_down'
  if (today.poc > prior.vah) return 'shift_up'
  if (today.poc < prior.val) return 'shift_down'
  return 'balance'
}

/** `" — "` (space EM DASH space) is the tile's split token. Do not restyle it. */
export const STATE_LABEL: Record<AmtState, string> = {
  balance: 'Balance — value overlaps prior; two-sided',
  imbalance_up: 'Imbalance ↑ — value entirely above prior; repricing higher',
  imbalance_down: 'Imbalance ↓ — value entirely below prior; repricing lower',
  shift_up: 'Shift ↑ — POC pushed above prior value',
  shift_down: 'Shift ↓ — POC pushed below prior value',
}

/** The three bias headlines. Up and down each cover two states. */
export const BIAS_TEXT = {
  up: 'Bias HIGHER — initiative buyers in control. Buy pullbacks into developing value; do not fade the highs.',
  down: 'Bias LOWER — initiative sellers in control. Sell rallies into developing value; do not fade the lows.',
  twoSided:
    'TWO-SIDED — value overlaps prior. Fade value-area extremes toward POC; trade the range until acceptance breaks it.',
} as const

/** `"up"` / `"down"` for the four directional states, `"flat"` for balance. */
export function trendOf(state: AmtState): SignalDir {
  if (state === 'imbalance_up' || state === 'shift_up') return 'up'
  if (state === 'imbalance_down' || state === 'shift_down') return 'down'
  return 'flat'
}

// ── LADDER 5: OPENING TYPE (4 outcomes) ──────────────────────────────────────

export const OPEN_DRIVE_LOW_MAX = 0.15
export const OPEN_DRIVE_HIGH_MIN = 0.85

/**
 * Where the open sits inside the day's REALIZED range —
 * `fromLow = (open - low) / (high - low)`, so 0 means it drove up off the open
 * and 1 means it drove down.
 *
 *   1. rng <= 0        → "Open-Auction (approx)"              (a one-price day)
 *   2. fromLow <= 0.15 → "Open-Drive ↑ (approx)"
 *   3. fromLow >= 0.85 → "Open-Drive ↓ (approx)"
 *   4. otherwise       → "Open-Auction / rotational (approx)"
 *
 * Every note embeds `openVsPriorVA`, which is a strict-comparison three-way
 * against the PRIOR value area, so an open exactly on prior VAH reads "inside".
 */
export function classifyOpening(today: TpoSession, prior: TpoSession): { label: string; note: string } {
  const rng = today.high - today.low
  const openVsPriorVA =
    today.open > prior.vah
      ? 'above prior value'
      : today.open < prior.val
        ? 'below prior value'
        : 'inside prior value'
  if (rng <= 0) return { label: 'Open-Auction (approx)', note: `Opened ${openVsPriorVA}.` }
  const fromLow = (today.open - today.low) / rng
  if (fromLow <= OPEN_DRIVE_LOW_MAX) {
    return {
      label: 'Open-Drive ↑ (approx)',
      note: `Opened near the low ${openVsPriorVA} and drove up — highest trend odds. Trade with the drive.`,
    }
  }
  if (fromLow >= OPEN_DRIVE_HIGH_MIN) {
    return {
      label: 'Open-Drive ↓ (approx)',
      note: `Opened near the high ${openVsPriorVA} and drove down — highest trend odds. Trade with the drive.`,
    }
  }
  return {
    label: 'Open-Auction / rotational (approx)',
    note: `Opened mid-range ${openVsPriorVA} — two-sided, low conviction. Wait for clearer information.`,
  }
}

// ── THE READ ─────────────────────────────────────────────────────────────────

/**
 * Build the AMT read for the most recent session in `res`.
 *
 * `res.binSize` is used ONLY as the tick pad — for range extension and for the
 * two imbalance state tests. Nothing else in here is bin-size aware.
 *
 * The signal catalogue is built in a FIXED ORDER, and that order is the sort's
 * final tie-break (`Array.prototype.sort` is stable), so it is load-bearing:
 *   value-area edges → range extension → wide-IB fades → today's structures in
 *   `session.structures` order → the naked-POC magnet, last.
 */
export function amtRead(res: TpoResult): AmtRead {
  const sessions = res.sessions
  const today = sessions[sessions.length - 1] ?? null
  const prior = sessions[sessions.length - 2] ?? null

  const empty = (reason: string): AmtRead => ({
    ok: false,
    reason,
    today,
    prior,
    avgIbRange: null,
    ibRatio: null,
    ibClass: null,
    dayType: { label: '—', note: '' },
    opening: null,
    rangeExt: 'none',
    state: 'balance',
    stateLabel: '—',
    location: '',
    bias: '',
    playbook: [],
    signals: [],
  })

  if (!today) return empty(AMT_REASON.noSession)
  if (!prior) return empty(AMT_REASON.noPrior)

  const pad = res.binSize

  // ── 1. IB width vs recent median (Dalton's day-type tell) ──────────────────
  // `slice(0, -1)` drops TODAY, then `slice(-20)` keeps the last twenty of what
  // survived the null/positive filter — so the window is twenty VALID sessions,
  // not twenty calendar sessions.
  const priorIbs = sessions
    .slice(0, -1)
    .map((s) => s.ibRange)
    .filter((r): r is number => r != null && r > 0)
    .slice(-IB_BASELINE_WINDOW)
  const avgIbRange = median(priorIbs)
  const ibRange = today.ibRange
  // `avgIbRange &&` — a zero median is falsy and yields a null ratio rather than
  // a division by zero.
  const ibRatio = avgIbRange && ibRange != null ? ibRange / avgIbRange : null
  const ibClass = classifyIb(ibRatio)

  // ── 2. Range extension beyond IB ───────────────────────────────────────────
  const rangeExt = classifyRangeExtension(today, pad)

  // ── 3. Day-type projection ─────────────────────────────────────────────────
  const dayType = classifyDayType(ibClass, rangeExt)

  // ── 4. State vs the prior day's value area ─────────────────────────────────
  const state = classifyState(today, prior, pad)
  const stateLabel = STATE_LABEL[state]

  // ── 2b. Opening type (approx) ──────────────────────────────────────────────
  const opening = classifyOpening(today, prior)

  const location =
    `Today value ${today.val.toFixed(2)}–${today.vah.toFixed(2)} (POC ${today.poc.toFixed(2)}) · ` +
    `prior value ${prior.val.toFixed(2)}–${prior.vah.toFixed(2)}.`

  const trend = trendOf(state)
  const bias = trend === 'up' ? BIAS_TEXT.up : trend === 'down' ? BIAS_TEXT.down : BIAS_TEXT.twoSided

  // @neverReadInV2 — see the field's doc on AmtRead.
  const playbook: string[] = [
    `Mark prior value: VAH ${prior.vah.toFixed(2)} · POC ${prior.poc.toFixed(2)} · VAL ${prior.val.toFixed(2)}.`,
    ibRatio != null
      ? `IB ${ibClass} (${ibRatio.toFixed(2)}× recent median) → ${dayType.label}.`
      : `IB baseline still building — need more sessions to grade IB width.`,
    `Open: ${opening.label}. ${opening.note}`,
    `State: ${stateLabel}. ${bias}`,
    `Confirm with acceptance: value building outside prior VA = follow; a probe that snaps back = fade.`,
  ]

  // ── signals ────────────────────────────────────────────────────────────────
  const signals: AmtSignal[] = []

  // Value-area edges — the bread-and-butter balance trade. Only on a balance day:
  // in imbalance the trend-side edge is a pullback ENTRY, not a fade, which is
  // the branch below.
  if (state === 'balance') {
    signals.push({
      id: 'vah-fade',
      level: 'watch',
      dir: 'down',
      title: "Fade today's VAH",
      trigger: today.vah,
      target: today.poc,
      detail: `Responsive sell at value-area high ${today.vah.toFixed(2)} → target POC ${today.poc.toFixed(2)}. Balance-day mean reversion; tight risk above VAH.`,
    })
    signals.push({
      id: 'val-fade',
      level: 'watch',
      dir: 'up',
      title: "Fade today's VAL",
      trigger: today.val,
      target: today.poc,
      detail: `Responsive buy at value-area low ${today.val.toFixed(2)} → target POC ${today.poc.toFixed(2)}. Balance-day mean reversion; tight risk below VAL.`,
    })
  } else {
    const edge = trend === 'up' ? today.val : today.vah
    const edgeName = trend === 'up' ? 'VAL' : 'VAH'
    // `trend !== "flat"` is unreachable-false here — every non-balance state is
    // directional — but it is what makes `dir: trend` type-check as up|down.
    if (trend !== 'flat') {
      signals.push({
        id: 'trend-pullback',
        level: 'action',
        dir: trend,
        title: `Buy/sell the pullback to ${edgeName}`,
        trigger: edge,
        target: trend === 'up' ? today.vah : today.val,
        detail: `Initiative ${trend === 'up' ? 'buyers' : 'sellers'} — enter pullbacks into developing value near ${edge.toFixed(2)}, trail behind structure. Do not fade the ${trend === 'up' ? 'highs' : 'lows'}.`,
      })
    }
  }

  // Range-extension follow. `ibClass !== "wide"` because a wide IB that extends
  // is not initiative, it is a big rotation — that day takes the fade below.
  if (rangeExt === 'up' && today.ibHigh != null && ibClass !== 'wide') {
    signals.push({
      id: 're-up',
      level: 'action',
      dir: 'up',
      title: 'Range extension ↑ — follow',
      trigger: today.ibHigh,
      target: null,
      detail: `Broke IB high ${today.ibHigh.toFixed(2)} on a ${ibClass ?? '?'} IB — initiative up. Buy the pullback to IB high, don't fade.`,
    })
  }
  if (rangeExt === 'down' && today.ibLow != null && ibClass !== 'wide') {
    signals.push({
      id: 're-dn',
      level: 'action',
      dir: 'down',
      title: 'Range extension ↓ — follow',
      trigger: today.ibLow,
      target: null,
      detail: `Broke IB low ${today.ibLow.toFixed(2)} on a ${ibClass ?? '?'} IB — initiative down. Sell the pullback to IB low, don't fade.`,
    })
  }

  // Wide IB with nothing extending: responsive fade at the untested IB extreme.
  if (ibClass === 'wide' && rangeExt === 'none') {
    if (today.ibHigh != null) {
      signals.push({
        id: 'ib-fade-hi',
        level: 'watch',
        dir: 'down',
        title: 'Responsive fade at IB high',
        trigger: today.ibHigh,
        target: today.poc,
        detail: `Wide IB, no extension — rotational. Fade IB high ${today.ibHigh.toFixed(2)} back toward POC ${today.poc.toFixed(2)}.`,
      })
    }
    if (today.ibLow != null) {
      signals.push({
        id: 'ib-fade-lo',
        level: 'watch',
        dir: 'up',
        title: 'Responsive fade at IB low',
        trigger: today.ibLow,
        target: today.poc,
        detail: `Wide IB, no extension — rotational. Fade IB low ${today.ibLow.toFixed(2)} back toward POC ${today.poc.toFixed(2)}.`,
      })
    }
  }

  // Today's structures → responsive vs initiative, with concrete levels.
  //
  // NOTE the trigger side: an excess/tail HIGH triggers at its priceLo (the
  // INNER edge — where price re-enters the band) and a LOW at its priceHi. The
  // poor pair triggers and targets the SAME price, because a poor high is not a
  // level to fade at, it is a level to trade toward.
  //
  // THERE IS NO `naked_poc` BRANCH HERE. Today's naked POC never becomes a
  // signal; the magnet row comes only from the forward-filled open rail below.
  for (const s of today.structures) {
    const dir = STRUCT_DIR[s.kind]
    if (s.kind === 'excess_high') {
      signals.push({
        id: s.id,
        level: 'watch',
        dir: 'down',
        title: 'Fade the excess high',
        trigger: s.priceLo,
        target: today.poc,
        detail: `Rejection tail at ${s.priceLo.toFixed(2)} — auction ended properly, level holds. Fade back toward POC ${today.poc.toFixed(2)}.`,
      })
    } else if (s.kind === 'excess_low') {
      signals.push({
        id: s.id,
        level: 'watch',
        dir: 'up',
        title: 'Fade the excess low',
        trigger: s.priceHi,
        target: today.poc,
        detail: `Rejection tail at ${s.priceHi.toFixed(2)} — level holds. Fade back toward POC ${today.poc.toFixed(2)}.`,
      })
    } else if (s.kind === 'tail_high') {
      signals.push({
        id: s.id,
        level: 'info',
        dir: 'up',
        title: "Tail high — trend leg, don't fade",
        trigger: s.priceLo,
        target: null,
        detail: `Singles left by a trend leg that closed at the high — continuation, not rejection. Buy pullbacks; do NOT short it.`,
      })
    } else if (s.kind === 'tail_low') {
      signals.push({
        id: s.id,
        level: 'info',
        dir: 'down',
        title: "Tail low — trend leg, don't fade",
        trigger: s.priceHi,
        target: null,
        detail: `Singles left by a trend leg that closed at the low — continuation, not rejection. Sell rallies; do NOT buy it.`,
      })
    } else if (s.kind === 'poor_high') {
      signals.push({
        id: s.id,
        level: 'action',
        dir: 'up',
        title: 'Poor high — unfinished, expect a take-out',
        trigger: s.priceLo,
        target: s.priceLo,
        detail: `Flat stack at ${s.priceLo.toFixed(2)}, no tail — ran out of time, not sellers. Expect price to return and take it out. Trade toward it.`,
      })
    } else if (s.kind === 'poor_low') {
      signals.push({
        id: s.id,
        level: 'action',
        dir: 'down',
        title: 'Poor low — unfinished, expect a take-out',
        trigger: s.priceHi,
        target: s.priceHi,
        detail: `Flat stack at ${s.priceHi.toFixed(2)}, no tail — ran out of time, not buyers. Expect price to return and take it out. Trade toward it.`,
      })
    } else if (s.kind === 'hole') {
      signals.push({
        id: s.id,
        level: 'info',
        // `STRUCT_DIR.hole` is undefined, so this is ALWAYS "flat".
        dir: dir ?? 'flat',
        title: 'Hole — thin zone, price accelerates through',
        trigger: (s.priceLo + s.priceHi) / 2,
        target: null,
        detail: `Mid-profile singles ${s.priceLo.toFixed(2)}–${s.priceHi.toFixed(2)}. No acceptance — price rips through. Never target inside; put targets on the far side.`,
      })
    }
  }

  // The naked-POC magnet, from the forward-filled OPEN rail.
  //
  // `res.open` is sorted `createdTs` DESC, so `[0]` is the NEWEST untested POC,
  // NOT the nearest one to spot — even though the signal is titled "magnet" and
  // its detail says "price is drawn to it". On a quiet stretch the newest naked
  // POC can be a long way from price while a much older one sits right under it.
  // Copied as written; open question 4.
  const nakedPocs = res.open.filter((s) => s.kind === 'naked_poc')
  const np = nakedPocs[0]
  if (np) {
    signals.push({
      id: `np-${np.id}`,
      level: 'watch',
      dir: 'flat',
      title: 'Naked POC — magnet',
      trigger: np.priceLo,
      target: np.priceLo,
      detail: `Untested fair value at ${np.priceLo.toFixed(2)} from ${np.date} — a strong magnet. Price is drawn to it; use it as a target, not a fade.`,
    })
  }

  return {
    ok: true,
    today,
    prior,
    avgIbRange,
    ibRatio,
    ibClass,
    dayType,
    opening,
    rangeExt,
    state,
    stateLabel,
    location,
    bias,
    playbook,
    signals,
  }
}

// ── THE SIGNAL RAIL ──────────────────────────────────────────────────────────

/** `action` outranks `watch` outranks `info`. Lower sorts first. */
export const LEVEL_RANK: Record<SignalLevel, number> = { action: 0, watch: 1, info: 2 }

/** The level chip's colour. `info` takes the default ink — it is not a warning. */
export const LEVEL_COLOR: Record<SignalLevel, string> = {
  action: T.orange,
  watch: LIGHT_BLUE,
  info: T.text,
}

export interface DirGlyph {
  g: string
  c: string
}

/**
 * The glyph before a signal's title. `"flat"` — and anything that is not `"up"`
 * or `"down"` — gets the diamond.
 *
 * These ARE directional colours, so they take the move pair rather than the
 * categorical `T.green` / `T.red`: v2 painted up with `HOME_THEME.green`, which
 * is a LIGHT BLUE, and the same value also painted every card subtitle. Reusing
 * one value for "price is above" and "this is a subtitle" was an accident of
 * v2's palette, not a semantic, and the collapse separates them.
 */
export function dirGlyph(d: SignalDir): DirGlyph {
  if (d === 'up') return { g: '▲', c: MOVE_UP }
  if (d === 'down') return { g: '▼', c: MOVE_DOWN }
  return { g: '◆', c: T.text }
}

/** ~0.12% of price, floored at two bins. */
export const LIVE_PAD_PCT = 0.0012
export const LIVE_PAD_BINS = 2

/**
 * How close spot must be for a signal to read LIVE.
 *
 * `max(binSize * 2, spot * 0.0012)` — about 7.9 points on ESU at 6600, and at
 * least 10 on NQU. Enough to catch a level as spot approaches without lighting
 * up the whole rail. A null spot degrades to `max(binSize * 2, 0)`, i.e. two
 * bins, which is harmless because liveness also requires a non-null spot.
 */
export function livePadFor(binSize: number, spot: number | null): number {
  return Math.max(binSize * LIVE_PAD_BINS, (spot ?? 0) * LIVE_PAD_PCT)
}

/** Inclusive `<=`. Never live without both a trigger and a spot. */
export function isSignalLive(s: AmtSignal, spot: number | null, livePad: number): boolean {
  return s.trigger != null && spot != null && Math.abs(spot - s.trigger) <= livePad
}

/**
 * The rail's three-key comparator:
 *   1. LIVE FIRST — `Number(b.live) - Number(a.live)`, descending on a boolean.
 *   2. LEVEL RANK — action, then watch, then info.
 *   3. ABSOLUTE DISTANCE TO SPOT, ascending, with `Infinity` for a missing
 *      trigger or a missing spot so triggerless signals sink.
 *
 * There is no fourth key, and `sort` is stable, so ties keep `amt.signals`
 * BUILD order — see the note at the top of `amtRead`.
 */
export function sortAmtSignals(
  signals: readonly AmtSignal[],
  spot: number | null,
  livePad: number,
): AmtSignal[] {
  return signals
    .map((s) => ({
      s,
      live: isSignalLive(s, spot, livePad),
      dist: s.trigger != null && spot != null ? Math.abs(s.trigger - spot) : Infinity,
    }))
    .sort(
      (a, b) =>
        Number(b.live) - Number(a.live) ||
        LEVEL_RANK[a.s.level] - LEVEL_RANK[b.s.level] ||
        a.dist - b.dist,
    )
    .map((x) => x.s)
}

export function countLiveSignals(
  signals: readonly AmtSignal[],
  spot: number | null,
  livePad: number,
): number {
  return signals.filter((s) => isSignalLive(s, spot, livePad)).length
}

export interface AmtSignalRowView {
  live: boolean
  level: SignalLevel
  levelColor: string
  glyph: DirGlyph
  title: string
  detail: string
  /** 2 dp, or an em dash. */
  trigger: string
  /** `→ 6412.50`, or the literal word `trail` — used by every range-extension,
   *  tail and hole signal, all of which have no target by design. */
  target: string
  /**
   * SIGNED `trigger − spot`, 2 dp. Null when either is missing, and the whole
   * cell is then omitted rather than showing a dash. Never coloured — unlike
   * `StructureRow`'s distance, which is. That asymmetry is v2's.
   */
  dist: string | null
}

/**
 * One rail row. Liveness is recomputed HERE, per render, independently of the
 * sort's copy — see header note 2.
 */
export function deriveSignalRow(
  s: AmtSignal,
  spot: number | null,
  livePad: number,
): AmtSignalRowView {
  const live = isSignalLive(s, spot, livePad)
  const dist = s.trigger != null && spot != null ? s.trigger - spot : null
  return {
    live,
    level: s.level,
    levelColor: LEVEL_COLOR[s.level],
    glyph: dirGlyph(s.dir),
    title: s.title,
    detail: s.detail,
    trigger: s.trigger != null ? s.trigger.toFixed(2) : '—',
    target: s.target != null ? `→ ${s.target.toFixed(2)}` : 'trail',
    dist: dist == null ? null : `${dist >= 0 ? '+' : ''}${dist.toFixed(2)}`,
  }
}

// ── THE PANEL ────────────────────────────────────────────────────────────────

/** Rendered with a literal ampersand; v2 writes `&amp;` in JSX. */
export const AMT_TITLE = 'AMT — auction read & live signals'

export const AMT_TILE_LABELS = {
  dayType: 'Day type',
  ibWidth: 'IB width',
  state: 'State',
  opening: 'Opening',
} as const

/** The IB tile's fixed note. The value above it is `narrow · 0.62×` (U+00D7). */
export const IB_TILE_NOTE = 'vs recent-median IB'
/** What the IB tile's value reads before any baseline exists. */
export const IB_TILE_BUILDING = 'building'

export const SIGNALS_HEADING = 'Signals & Alerts'
export const SIGNALS_EXPAND_HINT = 'tap to expand'
export const SIGNALS_EMPTY =
  'No actionable auction signals yet — waiting on IB and structure to form.'

/**
 * `Day-timeframe read vs prior value · 3 live · spot 6414.00`.
 * Both suffixes appear only when non-zero / non-null.
 */
export function amtSubtitle(liveCount: number, spot: number | null): string {
  return (
    'Day-timeframe read vs prior value' +
    (liveCount ? ` · ${liveCount} live` : '') +
    (spot != null ? ` · spot ${spot.toFixed(2)}` : '')
  )
}

/** `● 3 live` when anything is live, else `12 armed`. */
export function signalCountPill(liveCount: number, armedCount: number): string {
  return liveCount ? `● ${liveCount} live` : `${armedCount} armed`
}

/** `narrow · 0.62×`, or "building" when there is no baseline. */
export function ibTileValue(ibClass: IbClass, ibRatio: number | null): string {
  return ibRatio != null ? `${ibClass} · ${ibRatio.toFixed(2)}×` : IB_TILE_BUILDING
}

/**
 * The IB tile's value colour. Narrow is the interesting one — a coiled IB is
 * where the range-extension trade comes from — so it takes the warn token; wide
 * takes the accent; average and null take the default ink.
 */
export function ibColor(ibClass: IbClass): string {
  return ibClass === 'narrow' ? T.orange : ibClass === 'wide' ? T.cyan : T.text
}

/**
 * The state tile's colour, and the bias banner's border/wash tint.
 * Genuinely directional, so it takes the move pair; balance takes the tab accent.
 */
export function stateColor(state: AmtState): string {
  const t = trendOf(state)
  return t === 'up' ? MOVE_UP : t === 'down' ? MOVE_DOWN : LIGHT_BLUE
}

/** The state tile splits `stateLabel` on `" — "`: value, then note. */
export function splitStateLabel(stateLabel: string): { value: string; note: string } {
  const parts = stateLabel.split(' — ')
  return { value: parts[0] ?? stateLabel, note: parts[1] ?? '' }
}

/**
 * The signal rail's `<summary>` accent: green while anything is live, warn
 * otherwise. NOTE the polarity — orange here means "armed, nothing live", not
 * "warning".
 */
export function railAccent(liveCount: number): string {
  return liveCount ? MOVE_UP : T.orange
}
