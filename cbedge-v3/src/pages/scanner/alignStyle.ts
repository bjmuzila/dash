// ─────────────────────────────────────────────────────────────────────────────
// ALIGN — the colour vocabulary shared by the board, the stacks and the replay.
//
// Every value is a token: `var(--…)` strings for the DOM, token NAMES for the
// canvas (read through tokenHex at paint time). The two lists are kept side by
// side so the replay's lines and the board's legend can never disagree.
//
//   LOCKED   V2.up          — the scanner's positive (#1FD98A)
//   PENDING  LEVEL_COLORS.cb — the chain's wall yellow; 0DTE is the trigger
//   FORMING  V2.cyan
//   SCATTERED V2.neutral
//   BREAK    V2.red         — events only
// ─────────────────────────────────────────────────────────────────────────────

import type { CSSProperties } from 'react'
import { LEVEL_COLORS, T, V2, VIOLET, alpha } from '@/design/theme'
import type { AlignEventKind, AlignState } from '@/pages/scanner/align'

export const STATE_COLOR: Record<AlignState, string> = {
  LOCKED: V2.up,
  PENDING: LEVEL_COLORS.cb,
  FORMING: V2.cyan,
  SCATTERED: V2.neutral,
}

export const STATE_TOKEN: Record<AlignState, string> = {
  LOCKED: '--color-v2-refresh',
  PENDING: '--color-level-cb',
  FORMING: '--color-v2-cyan',
  SCATTERED: '--color-v2-neutral',
}

export const EVENT_COLOR: Record<AlignEventKind, string> = {
  LOCK: V2.up,
  PENDING: LEVEL_COLORS.cb,
  FORMING: V2.cyan,
  BREAK: V2.red,
}

/** Per expiry, front first. The front is the chain's wall yellow, as on the board. */
export const EXP_COLOR: readonly string[] = [LEVEL_COLORS.cb, V2.cyan, V2.green, VIOLET, V2.orange, V2.accent]
export const EXP_TOKEN: readonly string[] = [
  '--color-level-cb',
  '--color-v2-cyan',
  '--color-v2-green',
  '--color-violet',
  '--color-v2-orange',
  '--color-v2-accent',
]

export const expColor = (i: number): string => EXP_COLOR[i % EXP_COLOR.length] ?? T.text
export const expToken = (i: number): string => EXP_TOKEN[i % EXP_TOKEN.length] ?? '--color-fg'

export function pillStyle(color: string): CSSProperties {
  return {
    color,
    border: `1px solid ${alpha(color, 0.5)}`,
    background: alpha(color, 0.12),
  }
}

/** Chrome labels — v2's light-blue `lbl`, as every other scanner tab paints it. */
export const LABEL = V2.green
export const DIM = alpha(T.text, 0.45)
