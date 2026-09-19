// ─────────────────────────────────────────────────────────────────────────────
// THE VOLTMAP — the real heat grid. One column per expiration, heat-coloured
// cells, every mark on the strike, the Net profile down the right.
//
// IT COMPUTES NOTHING. Every number arrives in `d`, the bundle from
// useBoardDerived, so this grid and anything else rendering the same board are
// reading one set of levels by construction rather than by discipline. That
// also preserves the colour language for free — `cellStyle` is the same
// function, not a copy of it.
//
// WHAT THE CALLER OWNS, and why each is a prop rather than baked in:
//
//  · `ids` — when false, emit no #spot-row / #volt-row. Two mounted Voltmaps
//    means two of each, and the jump buttons use getElementById, which takes
//    the FIRST match in the DOM. The symptom of forgetting this is that the
//    jumps "sometimes do nothing", and it cannot reproduce in a one-pane test.
//  · `onStrikeCount` — absent hides the 30/50/100/150 control. A pane pins to
//    30 rather than carrying a second layout control in a small box.
//  · `onRow` — the row payload is derived data, so it is built HERE, once.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react'
import { T, V2W, alpha, VIOLET } from '@/design/theme'
import { meterPct, METER_H } from './heat'
import { cellStyle, fmtStrike, fmtVal, MARK_COLOR, MARK_GLYPH } from './derive'
import type { Derived } from './derive'
import type { BoardMap, BoardMode, BoardSource, MarkKind } from './types'
import { isTodayExp } from './board'

const WINDOWS = [30, 50, 100, 150] as const

export interface VoltmapProps {
  board: BoardMap
  d: Derived
  mode: BoardMode
  source: BoardSource
  quiet: boolean
  strikeCount: number
  /** Omit to hide the strike-window control entirely. */
  onStrikeCount?: (n: number) => void
  /** Click a column header to scope the board to that date. */
  onPickCol?: (i: number) => void
  /** Click a row. */
  onRow?: (strike: number) => void
  /** Emit the anchor ids the jump buttons look for. One mounted map only. */
  ids?: boolean
  /** The Net profile column's width. A narrow pane asks for less. */
  netWidth?: number
}

export function Voltmap({
  board,
  d,
  mode,
  source,
  quiet,
  strikeCount,
  onStrikeCount,
  onPickCol,
  onRow,
  ids = true,
  netWidth = 280,
}: VoltmapProps) {
  // The strike nearest spot: the row the ◄ Spot marker rides.
  const spotRow = useMemo(() => {
    if (!(board.spot > 0) || !d.rows.length) return null
    return d.rows.reduce((a, b) => (Math.abs(b - board.spot) < Math.abs(a - board.spot) ? b : a))
  }, [d.rows, board.spot])

  const sourceWord = source === 'volume' ? 'volume' : 'open interest'

  return (
    <div className="flex min-h-0 flex-1 overflow-auto" id={ids ? 'board-grid' : undefined}>
      <table className="w-full border-separate border-spacing-0 text-2xs tabular">
        <thead className="sticky top-0 z-20">
          <tr>
            {/* Strike column header, carrying the window control. */}
            <th
              className="sticky left-0 z-30 px-2 py-1 text-left align-bottom"
              style={{ background: V2W.panelSolid, borderBottom: `1px solid ${T.border}` }}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">Strike</span>
                {onStrikeCount && (
                  <span className="flex items-center gap-0.5">
                    {WINDOWS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => onStrikeCount(n)}
                        title={`Show ${n} strikes, centred on price`}
                        className="rounded px-1 py-0.5 text-3xs"
                        style={
                          n === strikeCount
                            ? { background: alpha(T.cyan, 0.18), color: T.cyan }
                            : { color: T.faint }
                        }
                      >
                        {n}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            </th>

            {/* One header per expiration: the date, that date's own ★ and ⚡︎. */}
            {board.cols.map((c, i) => {
              const lit = d.cols.includes(i)
              return (
                <th
                  key={c.exp}
                  onClick={() => onPickCol?.(i)}
                  title={`${c.exp} · ${c.dte === 0 ? 'expires today' : `${c.dte}d`}. Click to scope the board to this date.`}
                  className="cursor-pointer px-1.5 py-1 text-center align-bottom"
                  style={{
                    background: V2W.panelSolid,
                    borderBottom: `1px solid ${T.border}`,
                    opacity: lit ? 1 : 0.4,
                  }}
                >
                  <div className="text-2xs text-fg">{c.label}</div>
                  <div className="text-3xs" style={{ color: MARK_COLOR.volt }}>
                    {c.king != null ? `★ ${fmtStrike(c.king)}` : '★ —'}
                  </div>
                  <div className="text-3xs" style={{ color: VIOLET }}>
                    {c.flip != null ? `⚡︎ ${fmtStrike(c.flip)}` : '⚡︎ none'}
                  </div>
                  {isTodayExp(c.exp) && (
                    <div className="text-3xs" style={{ color: T.cyan }}>
                      0DTE
                    </div>
                  )}
                </th>
              )
            })}

            {/* The Net profile's own header — it names the basis, every time. */}
            <th
              className="px-2 py-1 text-right align-bottom"
              style={{
                background: V2W.panelSolid,
                borderBottom: `1px solid ${T.border}`,
                width: netWidth,
                minWidth: netWidth,
              }}
            >
              <span className="text-2xs text-muted">
                Net {mode} · {sourceWord} · {d.scopeTag}
              </span>
            </th>
          </tr>
        </thead>

        <tbody>
          {d.rows.map((k) => {
            const roles = d.marks.get(k) ?? []
            const marked = roles.length > 0
            const net = d.agg.byStrike.get(k) ?? 0
            const isSpot = k === spotRow
            const isFlip = d.agg.flip != null && nearestTo(d.agg.flip, d.rows) === k
            return (
              <tr
                key={k}
                id={ids ? (isSpot ? 'spot-row' : roles.includes('volt') ? 'volt-row' : undefined) : undefined}
                onClick={() => onRow?.(k)}
                className="cursor-pointer"
                style={isSpot ? { background: V2W.spotRow } : undefined}
              >
                {/* Strike + its marks. */}
                <td
                  className="sticky left-0 z-10 whitespace-nowrap px-2 py-0.5"
                  style={{
                    background: isSpot ? V2W.panelSolid : V2W.panelBgStrong,
                    borderRight: `1px solid ${T.border}`,
                    color: isSpot ? T.cyan : T.text,
                  }}
                >
                  <span className="text-xs">{fmtStrike(k)}</span>
                  {isFlip && (
                    <span className="ml-1 text-3xs" style={{ color: VIOLET }} title="Gamma flip">
                      {MARK_GLYPH.flip}
                    </span>
                  )}
                  {roles.map((r) => (
                    <Mark key={r} role={r} />
                  ))}
                  {isSpot && (
                    <span className="ml-1 text-3xs" style={{ color: T.cyan }}>
                      ◄ Spot
                    </span>
                  )}
                </td>

                {/* One cell per expiration. */}
                {board.cols.map((c, i) => {
                  const cell = c.cells.get(k)
                  const v = cell?.v ?? 0
                  const lit = d.cols.includes(i)
                  const st = cellStyle(v, d.ref, marked, quiet)
                  return (
                    <td
                      key={c.exp}
                      className="px-1.5 py-0.5 text-right"
                      title={`${fmtStrike(k)} · ${c.label} · ${fmtVal(v)} ${mode} on ${sourceWord}`}
                      style={{
                        background: st.background,
                        color: st.color,
                        opacity: lit ? 1 : 0.35,
                        borderBottom: `1px solid ${alpha(T.border, 0.5)}`,
                      }}
                    >
                      {v ? fmtVal(v) : '·'}
                    </td>
                  )
                })}

                {/* The Net profile: one bar, signed, measured against the window's max. */}
                <td
                  className="px-2 py-0.5"
                  style={{ borderBottom: `1px solid ${alpha(T.border, 0.5)}`, width: netWidth }}
                >
                  <NetBar v={net} maxAbs={d.maxAbs} roles={roles} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** One mark on a strike. */
function Mark({ role }: { role: MarkKind }) {
  return (
    <span className="ml-1 text-3xs" style={{ color: MARK_COLOR[role] }} title={role}>
      {MARK_GLYPH[role]}
    </span>
  )
}

/**
 * The right-hand profile. Length is measured against `maxAbs`, NOT the heat
 * reference — the reference is floored so a quiet board still shows colour,
 * and measuring bars against a floor pegs every heavy cell to full width and
 * says nothing. Length is the second, independent reading of the same number.
 */
function NetBar({ v, maxAbs, roles }: { v: number; maxAbs: number; roles: MarkKind[] }) {
  const pct = meterPct(v, maxAbs)
  const hue = v >= 0 ? T.green : T.red
  const tag = roles.find((r) => r === 'volt' || r === 'reversal' || r === 'surge')
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="relative h-3 flex-1" style={{ direction: v >= 0 ? 'ltr' : 'rtl' }}>
        <div
          style={{
            width: `${pct}%`,
            height: METER_H * 2,
            marginTop: 2,
            background: alpha(hue, 0.85),
            borderRadius: 2,
          }}
        />
      </div>
      {tag && (
        <span className="text-3xs" style={{ color: MARK_COLOR[tag] }}>
          {MARK_GLYPH[tag]}
        </span>
      )}
      <span className="text-3xs tabular" style={{ color: v >= 0 ? T.green : T.red, minWidth: 56, textAlign: 'right' }}>
        {fmtVal(v)}
      </span>
    </div>
  )
}

/** The drawn row a continuous level lands on. */
function nearestTo(target: number, rows: number[]): number | null {
  if (!rows.length) return null
  return rows.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a))
}
