// ─────────────────────────────────────────────────────────────────────────────
// The node card — one strike, opened from its row.
//
// It answers the question the grid cannot: what IS this level, across the
// dates in view, and what is sitting on it.
//
// IT QUOTES THE SCOPE IT WAS OPENED UNDER. The card is built from the same
// `agg` the tiles read, so a row opened while the board is scoped to one date
// describes that date, and one opened on Σ all describes the whole book. The
// bug this avoids is a red 0DTE row opening a card that calls the level
// "sticky" because it quietly quoted the all-dates total instead.
// ─────────────────────────────────────────────────────────────────────────────

import { T, alpha, V2W } from '@/design/theme'
import { fmtStrike, fmtVal, MARK_COLOR, MARK_GLYPH, MARK_WORD } from './derive'
import type { Derived } from './derive'
import type { BoardMap, BoardMode } from './types'

export interface NodeCardProps {
  board: BoardMap
  d: Derived
  strike: number
  mode: BoardMode
  onClose: () => void
}

export function NodeCard({ board, d, strike, mode, onClose }: NodeCardProps) {
  const net = d.agg.byStrike.get(strike) ?? 0
  const roles = d.marks.get(strike) ?? []
  const spot = board.spot
  const dist = spot > 0 ? strike - spot : null

  // The per-date breakdown, only for the columns actually in scope.
  // Narrow ONCE, in the map, rather than trusting `.filter` to narrow the
  // type — it does not, and `r.col` stays possibly-undefined all the way down.
  const rows = d.cols
    .map((i) => board.cols[i])
    .filter((col): col is NonNullable<typeof col> => !!col)
    .map((col) => ({ col, cell: col.cells.get(strike) }))
    .filter((r) => r.cell && r.cell.v !== 0)

  const book = rows.reduce(
    (acc, r) => ({
      callOI: acc.callOI + (r.cell?.callOI ?? 0),
      putOI: acc.putOI + (r.cell?.putOI ?? 0),
      callVol: acc.callVol + (r.cell?.callVol ?? 0),
      putVol: acc.putVol + (r.cell?.putVol ?? 0),
    }),
    { callOI: 0, putOI: 0, callVol: 0, putVol: 0 },
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: alpha(T.bg, 0.6) }}
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl p-4"
        style={{ background: V2W.panelSolid, border: `1px solid ${T.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xl font-medium text-fg">${fmtStrike(strike)}</div>
            <div className="text-2xs text-muted">
              {board.symbol} · {d.scopeTag}
              {dist != null && (
                <>
                  {' · '}
                  {Math.abs(dist).toFixed(2)} {dist >= 0 ? 'above' : 'below'} price
                </>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-muted" title="Close">
            ✕
          </button>
        </div>

        {/* What this strike IS. Absent when it is just a strike. */}
        {roles.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {roles.map((r) => (
              <div key={r} className="flex items-start gap-2">
                <span className="w-4 shrink-0 text-2xs" style={{ color: MARK_COLOR[r] }}>
                  {MARK_GLYPH[r]}
                </span>
                <span className="text-xs text-fg">{MARK_WORD[r]}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xs text-muted">Net {mode}</span>
          <span className="tabular text-base" style={{ color: net >= 0 ? T.green : T.red }}>
            {fmtVal(net)}
          </span>
          <span className="text-3xs text-faint">{net >= 0 ? 'positive gamma' : 'negative gamma'}</span>
        </div>

        {/* The book on this strike. */}
        <div className="mt-3 grid grid-cols-4 gap-2">
          <Fig label="Call OI" v={book.callOI} />
          <Fig label="Put OI" v={book.putOI} />
          <Fig label="Call Vol" v={book.callVol} />
          <Fig label="Put Vol" v={book.putVol} />
        </div>

        {/* Per-date, for the dates in scope. */}
        <div className="mt-3">
          <div className="mb-1 text-3xs text-muted">By expiration · {d.scopeTag}</div>
          <div className="flex flex-col gap-0.5">
            {rows.map((r) => (
              <div key={r.col.exp} className="flex items-center justify-between gap-2">
                <span className="text-2xs text-faint">
                  {r.col.label}
                  {r.col.dte === 0 ? ' · today' : ` · ${r.col.dte}d`}
                </span>
                <span
                  className="tabular text-2xs"
                  style={{ color: (r.cell?.v ?? 0) >= 0 ? T.green : T.red }}
                >
                  {fmtVal(r.cell?.v ?? 0)}
                </span>
              </div>
            ))}
            {!rows.length && <span className="text-2xs text-faint">Nothing on this strike for these dates.</span>}
          </div>
        </div>

        <div className="mt-3 text-3xs" style={{ color: alpha(T.text, 0.45) }}>
          Market analytics for educational purposes. Nothing here is investment advice.
        </div>
      </div>
    </div>
  )
}

function Fig({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <div className="text-3xs text-muted">{label}</div>
      <div className="tabular text-xs text-fg">{v ? v.toLocaleString() : '·'}</div>
    </div>
  )
}
