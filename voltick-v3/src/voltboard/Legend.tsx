// ─────────────────────────────────────────────────────────────────────────────
// The legend: one line that decodes every mark on the board.
//
// It is not decoration. "Brighter = bigger" is a rule the grid's colour curve
// exists to keep, and this row is where anyone learns it. The three words on
// the right are the whole colour language of the map in eleven characters.
// ─────────────────────────────────────────────────────────────────────────────

import { T, alpha, VIOLET, LEVEL_COLORS } from '@/design/theme'
import { MARK_GLYPH, MARK_WORD } from './derive'
import type { MarkKind } from './types'

const ITEMS: Array<{ role: MarkKind; label: string; color: string }> = [
  { role: 'volt', label: 'Volt', color: LEVEL_COLORS.cb },
  { role: 'surge', label: 'Surge', color: T.cyan },
  { role: 'reversal', label: 'Reversal', color: T.purple },
  { role: 'coil', label: 'Coil', color: T.cyan },
  { role: 'flip', label: 'Flip', color: VIOLET },
  { role: 'air', label: 'Air', color: T.faint },
  { role: 'callWall', label: 'Call Wall', color: LEVEL_COLORS.cw },
  { role: 'putWall', label: 'Put Wall', color: LEVEL_COLORS.pw },
]

export function Legend() {
  return (
    <div
      className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 pt-2"
      style={{ borderTop: `1px solid ${alpha(T.border, 0.7)}` }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {ITEMS.map((it) => (
          <span key={it.label} className="flex items-center gap-1" title={MARK_WORD[it.role]}>
            <span className="text-2xs" style={{ color: it.color }}>
              {MARK_GLYPH[it.role]}
            </span>
            <span className="text-3xs text-faint">{it.label}</span>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-3xs" style={{ color: T.green }}>
          Green = Positive gamma
        </span>
        <span className="text-3xs" style={{ color: T.red }}>
          Red = Negative gamma
        </span>
        <span className="text-3xs text-faint">Brighter = Bigger</span>
      </div>
    </div>
  )
}
