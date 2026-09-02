// ─────────────────────────────────────────────────────────────────────────────
// THE MATRIX — one strike ladder, one column per expiration, a ⅀ Total column
// and a mirrored strike rail on the right.
//
// Memoised so transient parent state (the load bar, an Intensity slider commit)
// never re-renders ~560 cells. It re-renders only when its own data props change
// — which, thanks to the hook's useMemo/useCallback, is exactly "when the chain
// data changed."
//
// This is DOM, not canvas, so v3's ChartFrame / data-cb-layer / visibility
// contract (non-negotiables 4–6) do not apply: there is nothing here that paints
// on an animation frame. What DOES apply is non-negotiable #1 — every colour
// below comes from a token through T / alpha() / a var() name declared in
// tokens.css.
//
// Two pieces of geometry are load-bearing and are transcribed rather than
// tidied:
//
//   • The ATM rule is an INSET BOX-SHADOW, never a border. A real 2px top and
//     bottom border adds 4px to the tallest cell in the row, so every time spot
//     crossed a strike the old ATM row shrank and the new one grew, shoving the
//     whole ladder — the white rule appeared to jump rather than move one row.
//   • Rows have a MIN-HEIGHT floor on the sticky strike cell. Grid rows size to
//     their content, so without it a row's height is a function of what happens
//     to be IN it, and under replay a strike gaining a value grows its row and
//     shifts everything below it.
//
// Spec: docs/parity/options-chain.md — Parts G, H, I, J, K, L.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, type CSSProperties } from 'react'
import { alpha, CHAIN, LEVEL_COLORS, LEVEL_ON_SOLID, SHADOW, T } from '@/design/theme'
import {
  columnWalls,
  oiSides,
  rankOf,
  wallAt,
  WALL_RANK,
  type ExpColumn,
  type Scale,
} from './chainMath'
import { CHAIN_CELL, HEAT_SKINS, levelFillBg, skinMetricBg, skinRankBg, type HeatSkin } from './heatSkins'
import { fmtChg, fmtCount, fmtExpHeader, fmtMoney, fmtStrike, skinFig } from './format'
import { etDateKey, etToday, isTradingDay } from './marketSession'
import type { GreekMode, OiSnapEntry } from './useChainData'

const MONO = 'var(--font-mono)'

/** Sticky header + rails must be FULLY OPAQUE — rows scroll under them. */
const HDR_BG = T.panel
/** Both strike rails. */
const STRIKE_COL = 56
/** Every strike row is at least this tall, floored on the sticky strike cell. */
const ROW_MIN_H = 17

/**
 * The ★ (CB) and ✕ (volume-GEX peak) sit on top of the heat fill, which at full
 * intensity is a saturated positive or negative tile. Gold-on-blue and red-on-red
 * both wash out at 10px, so both glyphs get a hard dark edge (paint-order:
 * stroke, so the stroke sits OUTSIDE the fill and does not eat the glyph) plus a
 * light halo. That pairing reads on every background the scale can produce.
 */
const MARKER_EDGE: CSSProperties = {
  WebkitTextStrokeWidth: '1px',
  WebkitTextStrokeColor: SHADOW,
  paintOrder: 'stroke fill' as unknown as CSSProperties['paintOrder'],
  textShadow: `0 0 3px ${alpha(T.text, 0.9)}, 0 0 1px ${SHADOW}`,
}

/**
 * Soft cell value with a coloured leading sign — the CLASSIC skin's format,
 * shared with the Multi Greek ladder so the two grids read identically.
 */
function SignVal({ text }: { text: string }) {
  if (!text || text === '--' || text === '·') return <>{text}</>
  const s = text[0] === '+' || text[0] === '-' ? text[0] : ''
  const rest = s ? text.slice(1) : text
  const c = s === '+' ? CHAIN.signUp : s === '-' ? CHAIN.signDown : CHAIN.ink
  return (
    <>
      {s && <span style={{ color: c }}>{s}</span>}
      {rest}
    </>
  )
}

/**
 * One line of an OI cell: the day-over-day change in open interest, and nothing
 * else. The settled OI LEVEL is deliberately not printed — the tab exists to
 * show what moved overnight, and the level sat right beside the delta drowning
 * it in digits.
 *
 * Near-white ink on purpose: the change rides on a coloured heat cell, and a red
 * number on a red background was the one thing you could not read. Direction is
 * carried twice over without text colour — the leading +/− and the tint beneath.
 *
 * `chg === null` means this strike has no stored baseline, and renders "—" so
 * "we don't know" never reads as "unchanged".
 */
function OiChgLine({ label, chg }: { label: string | null; chg: number | null }) {
  const has = chg != null && chg !== 0
  return (
    <div style={countLineStyle}>
      {label && <span style={countLabelStyle}>{label}</span>}
      <span style={countValueStyle(has)}>{chg == null ? '—' : fmtChg(chg)}</span>
    </div>
  )
}

/**
 * One line of a VOL cell: today's traded contract count for one side, UNSIGNED.
 * Volume is a LEVEL, not a change, so ΔOI's leading +/− would be noise here —
 * every figure would wear a "+". Side is already carried by position, by the C/P
 * letter on the pivot row, and by the tint underneath. A strike that has not
 * traded today prints "·" rather than "0".
 */
function VolLine({ label, vol }: { label: string | null; vol: number | null }) {
  const has = vol != null && vol !== 0
  return (
    <div style={countLineStyle}>
      {label && <span style={countLabelStyle}>{label}</span>}
      <span style={countValueStyle(has)}>{has ? fmtCount(Math.abs(vol)) : '·'}</span>
    </div>
  )
}

const countLineStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'flex-end',
  gap: 6,
  whiteSpace: 'nowrap',
}
const countLabelStyle: CSSProperties = {
  color: alpha(T.text, 0.35),
  fontSize: 9,
  fontWeight: 700,
  marginRight: 'auto',
}
const countValueStyle = (has: boolean): CSSProperties => ({
  color: has ? alpha(T.text, 0.96) : CHAIN.none,
  fontWeight: 700,
  textShadow: has ? `0 1px 2px ${alpha(SHADOW, 0.85)}` : undefined,
})

export interface ChainMatrixProps {
  columns: ExpColumn[]
  gridCols: number
  visibleStrikes: Array<number | null>
  nearestStrike: number
  spot: number
  greekMode: GreekMode
  dataMode: string
  /** The parent passes the DEFERRED intensity. */
  intensity: number
  heatSkin: HeatSkin
  levelsOnly: boolean
  colScales: Scale[]
  volMvcByCol: Array<number | null>
  mvcByCol: Array<number | null>
  valueAt: (col: ExpColumn, strike: number) => number | null
  /** "" when live, or the replayed session's date — decides which column counts
   *  as 0DTE and is therefore excluded from ⅀ Total. */
  sessionDate: string
  showTotalCol: boolean
  layoutExpCols: number
  emStrikes: { close: number | null; d1: number | null; u1: number | null; d2: number | null; u2: number | null } | null
  anyCurrentWeek: boolean
  emLevels: { close: number; em: number } | null
  atmRowRef: React.RefObject<HTMLDivElement | null>
  oiChangeMap: Map<string, OiSnapEntry>
  selExps: Set<string>
  selStrikes: Set<number>
  onToggleExp: (exp: string, solo: boolean) => void
  onToggleStrike: (strike: number, solo: boolean) => void
  onCellClick: (v: { strike: number; colIdx: number; x: number; y: number }) => void
}

export const ChainMatrix = memo(function ChainMatrix({
  columns,
  gridCols,
  visibleStrikes,
  nearestStrike,
  spot,
  greekMode,
  dataMode,
  intensity,
  heatSkin,
  levelsOnly,
  colScales,
  volMvcByCol,
  mvcByCol,
  valueAt,
  sessionDate,
  showTotalCol,
  layoutExpCols,
  emStrikes,
  anyCurrentWeek,
  emLevels,
  atmRowRef,
  oiChangeMap,
  selExps,
  selStrikes,
  onToggleExp,
  onToggleStrike,
  onCellClick,
}: ChainMatrixProps) {
  // OI is a contract count and on that tab every readout is a CHANGE in it, so
  // it takes the signed compact formatter. VOL is the other count tab: same
  // ladder, but a live level, so it takes the UNSIGNED one.
  const isOiMode = greekMode === 'oi'
  const isVolMode = greekMode === 'vol'
  const isCountMode = isOiMode || isVolMode
  const fmtVal = isOiMode ? fmtChg : isVolMode ? fmtCount : fmtMoney

  const SK = HEAT_SKINS[heatSkin] ?? HEAT_SKINS.classic
  const CELL = CHAIN_CELL[heatSkin] ?? CHAIN_CELL.classic

  // Drop holiday / non-trading expirations entirely; keep empty placeholders.
  const renderIdx = Array.from({ length: gridCols })
    .map((_, i) => i)
    .filter((i) => {
      const c = columns[i]
      if (!c) return true
      return isTradingDay(new Date(`${c.expiration}T00:00:00`))
    })

  // ── ⅀ Total ────────────────────────────────────────────────────────────────
  // Per strike, across every rendered expiration EXCEPT 0DTE — where "0DTE"
  // means the expiry equal to the SESSION being shown, not literally today, so
  // replaying Tuesday excludes Tuesday's 0DTE and not Friday's. With expiries
  // picked, the column sums exactly those (0DTE included — an explicit pick
  // outranks the default exclusion) and says so in its header.
  const todayKey = sessionDate || etDateKey(etToday())
  const selMode = selExps.size > 0
  const rowTotals = new Map<number, number>()
  visibleStrikes.forEach((strike) => {
    if (strike == null) return
    let sum = 0
    renderIdx.forEach((colIdx) => {
      const col = columns[colIdx]
      if (!col) return
      if (selMode ? !selExps.has(col.expiration) : col.expiration === todayKey) return
      const v = valueAt(col, strike)
      if (v != null) sum += v
    })
    rowTotals.set(strike, sum)
  })
  const totalAbs = [...rowTotals.values()]
    .map((v) => Math.abs(v))
    .filter((v) => v > 0)
    .sort((a, b) => b - a)
  const totalScale: Scale = { max: totalAbs[0] ?? 1, top3: totalAbs.slice(0, 3) }
  const grandVisibleTotal = [...rowTotals.values()].reduce((a, b) => a + b, 0)

  // ── Levels-only mode ───────────────────────────────────────────────────────
  // Intensity at its bottom stop drops the heat field entirely and paints ONLY
  // each column's CB / CW / PW. Walls are read through valueAt(), so they follow
  // the active greek tab exactly like the heat scale does — on the GEX tab CB is
  // the same strike the ★ marker already names. The ⅀ column is ranked as its
  // own column; Δ columns are left bare, because "the wall" is a statement about
  // gamma, not about a 15-minute delta.
  const liveStrikes = visibleStrikes.filter((s): s is number => s != null)
  const wallsByCol = levelsOnly
    ? columns.map((col) => columnWalls(liveStrikes.map((s) => ({ strike: s, net: valueAt(col, s) ?? 0 }))))
    : []
  const totalWalls = levelsOnly
    ? columnWalls(liveStrikes.map((s) => ({ strike: s, net: rowTotals.get(s) ?? 0 })))
    : null

  // ── Reserved (ghost) tracks ────────────────────────────────────────────────
  // Expiry tracks are 1fr, so they divide the container: drop from 4 columns to
  // 1 and that one inflates to the full grid width, which is not a filtered view
  // of the same chain — it is a different-looking page. Reserving the tracks the
  // hidden columns WOULD have occupied keeps every remaining cell the width it
  // had. Live passes layoutExpCols = 0, which disables the whole mechanism.
  //
  // The tracks need real (empty) elements, one per row: the grid auto-places and
  // rows are `display: contents` wrappers, so a row short of a cell would pull
  // the next row's first cell up and shear the grid.
  const ghostExpCols = Math.max(0, (layoutExpCols || 0) - renderIdx.length)
  const ghostTotalCols = layoutExpCols > 0 && !showTotalCol ? 1 : 0
  const ghostCols = ghostExpCols + ghostTotalCols
  const ghostTemplate =
    (ghostExpCols > 0 ? ` repeat(${ghostExpCols}, minmax(${isCountMode ? 84 : 78}px, 1fr))` : '') +
    (ghostTotalCols > 0 ? ` minmax(${isCountMode ? 92 : 88}px, 1.15fr)` : '')
  const ghostCells = (keyPrefix: string, header = false) =>
    ghostCols === 0
      ? null
      : Array.from({ length: ghostCols }).map((_, g) => (
          <div
            key={`${keyPrefix}-ghost-${g}`}
            aria-hidden
            style={
              header
                ? { position: 'sticky', top: 0, zIndex: 3, background: HDR_BG, borderBottom: `1px solid ${T.border}` }
                : undefined
            }
          />
        ))

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `${STRIKE_COL}px ${renderIdx
          .map(() => `minmax(${isCountMode ? 84 : 78}px, 1fr)`)
          .join(' ')}${
          showTotalCol ? ` minmax(${isCountMode ? 92 : 88}px, 1.15fr)` : ''
        }${ghostTemplate} ${STRIKE_COL}px`,
        borderRadius: 12,
        overflow: 'clip',
        border: `1px solid ${T.border}`,
        borderTop: `2px solid ${alpha(T.cyan, 0.85)}`,
        background: T.panelBg,
        // Replaces the scroll container's old padding-top: this scrolls away
        // under the sticky header rather than holding open a gap rows can show
        // through.
        marginTop: 8,
      }}
    >
      {/* ── Header: strike corner + one expiry header per column ── */}
      <div style={cornerStyle('left')}>Strike</div>

      {renderIdx.map((i) => {
        const col = columns[i]
        const colTotal = col
          ? visibleStrikes.reduce<number>((s, k) => {
              const v = k == null ? null : valueAt(col, k)
              return s + (v ?? 0)
            }, 0)
          : null
        const expSel = col != null && selExps.has(col.expiration)
        const expDim = selMode && !expSel
        return (
          <div
            key={`hdr-${col?.expiration ?? i}`}
            onClick={col ? (e) => onToggleExp(col.expiration, e.shiftKey) : undefined}
            title={col ? 'Click to focus this expiration (shift-click = only this one)' : undefined}
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 3,
              textAlign: 'center',
              padding: '5px 6px',
              background: expSel
                ? `linear-gradient(180deg, ${alpha(T.cyan, 0.3)} 0%, ${alpha(T.cyan, 0.07)} 100%), ${HDR_BG}`
                : `linear-gradient(180deg, ${alpha(T.cyan, 0.14)} 0%, ${alpha(T.cyan, 0.04)} 100%), ${HDR_BG}`,
              borderBottom: `1px solid ${T.border}`,
              boxShadow: expSel ? `inset 0 -2px 0 ${T.cyan}` : undefined,
              cursor: col ? 'pointer' : undefined,
              opacity: expDim ? 0.3 : 1,
              transition: 'opacity .12s',
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 500, color: T.text }}>
              {col ? fmtExpHeader(col.expiration) : '—'}
            </div>
            {/* Per-expiry total of the ACTIVE greek across the visible window —
                the column-wise counterpart to the ⅀ Total column's figure. */}
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                fontFamily: MONO,
                color: colTotal == null ? T.muted : colTotal >= 0 ? T.green : T.red,
              }}
            >
              {colTotal == null ? '—' : fmtVal(colTotal)}
            </div>
          </div>
        )
      })}

      {showTotalCol && (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 3,
            textAlign: 'center',
            padding: '5px 6px',
            background: `linear-gradient(180deg, ${alpha(T.cyan, 0.24)} 0%, ${alpha(T.cyan, 0.07)} 100%), ${HDR_BG}`,
            borderBottom: `1px solid ${T.border}`,
            borderLeft: `2px solid ${alpha(T.cyan, 0.45)}`,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: T.cyan, letterSpacing: '0.04em' }}>
            {selMode ? `Sel ${selExps.size}` : 'Total'}
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              fontFamily: MONO,
              color: grandVisibleTotal >= 0 ? T.green : T.red,
            }}
          >
            {fmtVal(grandVisibleTotal)}
          </div>
        </div>
      )}
      {ghostCells('hdr', true)}
      <div style={cornerStyle('right')}>Strike</div>

      {/* ── One row per shared strike ── */}
      {visibleStrikes.map((strike, rowIdx) => {
        // Padding row (the chain ran out on this side of the centre): keep the
        // row so the centre stays put, but render it empty.
        if (strike == null) {
          return (
            <div key={`pad-${rowIdx}`} style={{ display: 'contents' }}>
              <div style={{ ...railBase('left'), padding: '2px 8px', fontSize: 12 }} />
              {renderIdx.map((i) => (
                <div key={`pad-${rowIdx}-${i}`} style={{ padding: '2px 8px', fontSize: 12 }} />
              ))}
              {showTotalCol && (
                <div style={{ padding: '2px 8px', fontSize: 12, borderLeft: `2px solid ${alpha(T.cyan, 0.25)}` }} />
              )}
              {ghostCells(`pad-${rowIdx}`)}
              <div style={{ ...railBase('right'), padding: '2px 8px', fontSize: 12 }} />
            </div>
          )
        }

        const isATM = strike === nearestStrike
        const is1x = anyCurrentWeek && emStrikes != null && (strike === emStrikes.d1 || strike === emStrikes.u1)
        const is2x = anyCurrentWeek && emStrikes != null && (strike === emStrikes.d2 || strike === emStrikes.u2)
        // EM rows draw no marker line — the tag beside the strike is the whole
        // signal, and the CLOSE (band-centre) marker is gone entirely.
        let emTag: string | null = null
        let emTip = ''
        if (isATM) {
          emTag = 'ATM'
          emTip = `At-the-money — nearest strike to spot (${spot ? spot.toFixed(2) : '—'})`
        } else if (is1x) {
          const up = emStrikes != null && strike === emStrikes.u1
          emTag = up ? 'EM +1σ' : 'EM −1σ'
          emTip = `1× weekly expected move ${up ? 'up' : 'down'}${
            emLevels ? ` (${emLevels.close} ± ${emLevels.em})` : ''
          }`
        } else if (is2x) {
          const up = emStrikes != null && strike === emStrikes.u2
          emTag = up ? 'EM +2σ' : 'EM −2σ'
          emTip = `2× weekly expected move ${up ? 'up' : 'down'}${
            emLevels ? ` (${emLevels.close} ± ${2 * emLevels.em})` : ''
          }`
        }
        const strikeSel = selStrikes.has(strike)
        const strikeDim = selStrikes.size > 0 && !strikeSel

        const rail = (side: 'left' | 'right') => (
          <div
            ref={side === 'left' && isATM ? atmRowRef : undefined}
            onClick={(e) => onToggleStrike(strike, e.shiftKey)}
            title={emTip || 'Click to focus this strike (shift-click = only this one)'}
            style={{
              ...railBase(side),
              // Extra left padding on the right rail keeps the number off the
              // Total column's value; 5px on the outer edge matches the left.
              padding: side === 'left' ? '2px 5px' : '2px 5px 2px 10px',
              fontSize: 10,
              fontFamily: MONO,
              textAlign: 'right',
              color: isATM ? T.cyan : CHAIN.strike,
              fontWeight: isATM ? 700 : 400,
              background: strikeSel
                ? `linear-gradient(${side === 'left' ? '90deg' : '270deg'}, ${alpha(T.cyan, 0.06)}, ${alpha(
                    T.cyan,
                    0.3,
                  )}), ${HDR_BG}`
                : HDR_BG,
              // Inset, never a real border — see the header note.
              boxShadow:
                [
                  ...(strikeSel ? [`inset ${side === 'left' ? '-2px' : '2px'} 0 0 ${T.cyan}`] : []),
                  ...(isATM ? [`inset 0 2px 0 ${T.text}`, `inset 0 -2px 0 ${T.text}`] : []),
                ].join(', ') || undefined,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 3,
              cursor: 'pointer',
              opacity: strikeDim ? 0.28 : 1,
              transition: 'opacity .12s',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {emTag && (
              <span
                style={{
                  fontSize: 8,
                  fontWeight: isATM ? 900 : 800,
                  letterSpacing: isATM ? '0.06em' : '0.02em',
                  padding: isATM ? 0 : '1px 3px',
                  borderRadius: 3,
                  marginRight: 'auto',
                  fontFamily: isATM ? 'var(--font-sans)' : undefined,
                  background: isATM ? 'transparent' : alpha(T.text, 0.12),
                  color: isATM ? T.cyan : T.text,
                }}
              >
                {emTag}
              </span>
            )}
            {fmtStrike(strike)}
          </div>
        )

        return (
          <div key={strike} style={{ display: 'contents' }}>
            {rail('left')}

            {renderIdx.map((colIdx, posInRow) => {
              const col = columns[colIdx]
              const cellScale = colScales[colIdx] ?? { max: 1, top3: [] as number[] }
              const value = col ? valueAt(col, strike) : null

              const isMvc = greekMode === 'gex' && col != null && mvcByCol[colIdx] === strike
              // ✕ marks the pure-volume GEX peak — OI+Vol view + GEX mode only.
              const isVolMvc =
                greekMode === 'gex' && dataMode === 'oi-vol' && col != null && volMvcByCol[colIdx] === strike
              // …coloured by the SIGN of that volume-only GEX. A fixed-red ✕ said
              // "negative" on every strike it landed on.
              const volMvcVal = isVolMvc && col ? (col.cells.get(strike)?.volGex ?? null) : null
              const volMvcPos = (volMvcVal ?? value ?? 0) >= 0
              const isFirst = posInRow === 0
              // ATM box: box-shadow so it overlays without shifting layout. Top
              // and bottom on every cell, left edge on the first column; the
              // right edge is drawn on the ⅀ Total cell.
              const atmShadow = isATM
                ? [
                    `inset 0 2px 0 ${T.text}`,
                    `inset 0 -2px 0 ${T.text}`,
                    ...(isFirst ? [`inset 2px 0 0 ${T.text}`] : []),
                  ].join(', ')
                : undefined

              const isClickable = col != null
              // OI tab: the recorded snapshot is the only source. Strikes the
              // 9:32 sweep did not capture have no day-over-day change to report
              // and render empty — a live OI level with no delta beside it is not
              // what this tab shows.
              const oiKey = col ? `${col.expiration}|${strike}` : ''
              const oiSnap = isOiMode && oiKey ? oiChangeMap.get(oiKey) : undefined
              const sides = isCountMode ? oiSides(strike, nearestStrike) : { call: false, put: false }
              const volCell = isVolMode && col ? col.cells.get(strike) : undefined
              // Only the side(s) actually RENDERED count toward "is there
              // anything here" — an ITM put below a call-only strike must not
              // keep an otherwise-flat call cell from reading as "·".
              const volHasAny =
                isVolMode && !!volCell && ((sides.call && !!volCell.callVol) || (sides.put && !!volCell.putVol))
              const oiHasAny =
                isOiMode && !!oiSnap && ((sides.call && !!oiSnap.callChg) || (sides.put && !!oiSnap.putChg))
              // Side letters only where position cannot tell you the side — the
              // ATM pivot, the one row that renders both call and put.
              const oiBothSides = sides.call && sides.put

              const cellWall = levelsOnly && col != null ? wallAt(wallsByCol[colIdx], strike) : null
              const cellRank = value == null ? 0 : rankOf(value, cellScale.top3)
              // Which level this cell is FILLED as, on a skin that fills levels.
              // Levels-only marks CB/CW/PW; every other slider position marks the
              // CORE level only — the ★ strike.
              const cellLevel = !SK.levelFill ? null : (cellWall ?? (isMvc ? ('cb' as const) : null))

              const heat = levelsOnly
                ? cellWall && value != null
                  ? skinRankBg(value, WALL_RANK[cellWall], SK)
                  : 'transparent'
                : value != null
                  ? skinMetricBg(value, cellScale.max, cellRank, intensity, SK)
                  : 'transparent'
              const background = cellLevel ? (levelFillBg(cellLevel, SK, heat) ?? heat) : heat

              return (
                <div
                  key={`${strike}-${colIdx}`}
                  className={isMvc ? 'chain-mvc-cell' : undefined}
                  onClick={isClickable ? (e) => onCellClick({ strike, colIdx, x: e.clientX, y: e.clientY }) : undefined}
                  title={isClickable ? 'Click for volume / OI / net premium' : undefined}
                  style={{
                    padding: isCountMode ? '3px 6px' : '2px 8px',
                    fontSize: CELL.fontSize,
                    fontFamily: MONO,
                    textAlign: 'right',
                    letterSpacing: '0',
                    fontWeight: value == null ? 400 : CELL.weight[cellRank === 1 ? 0 : cellRank ? 1 : 2],
                    color: value == null ? CHAIN.none : CELL.text,
                    ...(CELL.shadow && value != null ? { textShadow: CELL.shadow } : {}),
                    borderRadius: CELL.radius || undefined,
                    // The tile margin is NOT applied on the ATM row: that rule is
                    // an inset shadow on every cell in the row, and a margin
                    // would break it into dashes.
                    ...(CELL.inset && !isATM ? { margin: CELL.inset } : {}),
                    background,
                    boxShadow: atmShadow,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    // relative so the ★ can be pinned to the cell's corner rather
                    // than sitting in the flex row and pushing the figure off its
                    // right edge.
                    ...(SK.levelFill ? { position: 'relative' as const } : {}),
                    display: 'flex',
                    alignItems: isCountMode ? 'center' : CELL.align,
                    justifyContent: 'flex-end',
                    gap: 5,
                    cursor: isClickable ? 'pointer' : undefined,
                    // A cell stays lit only if BOTH its column and its row
                    // survive the selection.
                    opacity: strikeDim || (selMode && !(col != null && selExps.has(col.expiration))) ? 0.13 : 1,
                    transition: 'opacity .12s',
                    // No ring once the cell itself is filled gold: a 2px ring on
                    // a gold tile reads as a smudge, not a marker. CLASSIC keeps
                    // it — nothing else marks CB there.
                    ...(isMvc && !SK.levelFill
                      ? { outline: `2px solid ${CHAIN.mvc}`, outlineOffset: '-2px' }
                      : {}),
                  }}
                >
                  {isMvc &&
                    (SK.levelFill ? (
                      // Pinned to the cell's top-left corner — which is exactly
                      // where levelFillBg holds the CB wash at FULL gold — and
                      // drawn in the ink that colour was chosen to carry. A gold
                      // star on a gold tile is an invisible star.
                      //
                      // No halo: the corner is solid gold under the glyph (the
                      // wash only fades further along the diagonal), so the ★
                      // already has its own ground and a glow just softens it.
                      <span
                        title="CB - Core Bullseye — highest |net GEX|"
                        style={{
                          position: 'absolute',
                          top: 1,
                          left: 2,
                          fontSize: 10,
                          lineHeight: 1,
                          color: LEVEL_ON_SOLID,
                          pointerEvents: 'none',
                        }}
                      >
                        ★
                      </span>
                    ) : (
                      <span
                        title="CB - Core Bullseye — highest |net GEX|"
                        style={{ color: LEVEL_COLORS.cb, lineHeight: 1, ...MARKER_EDGE }}
                      >
                        ★
                      </span>
                    ))}

                  {isVolMvc && (
                    <span
                      title={`Highest volume GEX${volMvcVal == null ? '' : ` (${fmtMoney(volMvcVal)})`} — ${
                        volMvcPos ? 'positive' : 'negative'
                      } gamma`}
                      style={{
                        fontSize: 11,
                        lineHeight: 1,
                        fontWeight: 900,
                        color: volMvcPos ? CHAIN.signUp : CHAIN.signDown,
                        ...MARKER_EDGE,
                      }}
                    >
                      ✕
                    </span>
                  )}

                  {isOiMode ? (
                    !oiHasAny ? (
                      <span style={{ color: CHAIN.none }}>·</span>
                    ) : (
                      <div style={countStackStyle}>
                        {sides.call && <OiChgLine label={oiBothSides ? 'C' : null} chg={oiSnap?.callChg ?? null} />}
                        {sides.put && <OiChgLine label={oiBothSides ? 'P' : null} chg={oiSnap?.putChg ?? null} />}
                      </div>
                    )
                  ) : isVolMode ? (
                    !volHasAny ? (
                      <span style={{ color: CHAIN.none }}>·</span>
                    ) : (
                      <div style={countStackStyle}>
                        {sides.call && <VolLine label={oiBothSides ? 'C' : null} vol={volCell?.callVol ?? null} />}
                        {sides.put && <VolLine label={oiBothSides ? 'P' : null} vol={volCell?.putVol ?? null} />}
                      </div>
                    )
                  ) : (
                    <span>
                      {CELL.signColors ? (
                        <SignVal text={value == null ? '·' : fmtMoney(value)} />
                      ) : value == null ? (
                        '·'
                      ) : (
                        skinFig(fmtMoney(value), CELL.plusSign)
                      )}
                    </span>
                  )}
                </div>
              )
            })}

            {showTotalCol &&
              (() => {
                const tot = rowTotals.get(strike) ?? 0
                const totWall = levelsOnly ? wallAt(totalWalls, strike) : null
                const heat = levelsOnly
                  ? totWall && tot !== 0
                    ? skinRankBg(tot, WALL_RANK[totWall], SK)
                    : 'transparent'
                  : tot !== 0
                    ? skinMetricBg(tot, totalScale.max, rankOf(tot, totalScale.top3), intensity, SK)
                    : 'transparent'
                return (
                  <div
                    style={{
                      padding: '2px 8px',
                      fontSize: CELL.fontSize,
                      fontFamily: MONO,
                      textAlign: 'right',
                      fontWeight: 700,
                      color: tot === 0 ? CHAIN.none : alpha(T.text, 0.92),
                      ...(CELL.shadow && tot !== 0 ? { textShadow: CELL.shadow } : {}),
                      borderRadius: CELL.radius || undefined,
                      background: totWall ? (levelFillBg(totWall, SK, heat) ?? heat) : heat,
                      borderLeft: `2px solid ${alpha(T.cyan, selMode ? 0.8 : 0.35)}`,
                      boxShadow: isATM
                        ? `inset 0 2px 0 ${T.text}, inset 0 -2px 0 ${T.text}, inset -2px 0 0 ${T.text}`
                        : undefined,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      // The ⅀ column answers an expiry selection by RE-SUMMING,
                      // so it dims for a strike pick only.
                      opacity: strikeDim ? 0.13 : 1,
                      transition: 'opacity .12s',
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'flex-end',
                    }}
                  >
                    {isCountMode || !CELL.signColors ? (
                      <span
                        style={{
                          color: tot === 0 ? CHAIN.none : alpha(T.text, 0.96),
                          textShadow: tot === 0 ? undefined : `0 1px 2px ${alpha(SHADOW, 0.85)}`,
                        }}
                      >
                        {tot === 0 ? '·' : isCountMode ? fmtVal(tot) : skinFig(fmtVal(tot), CELL.plusSign)}
                      </span>
                    ) : (
                      <SignVal text={tot === 0 ? '·' : fmtVal(tot)} />
                    )}
                  </div>
                )
              })()}

            {ghostCells(`row-${strike}`)}
            {rail('right')}
          </div>
        )
      })}
    </div>
  )
})

// ── Shared style fragments ───────────────────────────────────────────────────

function cornerStyle(side: 'left' | 'right'): CSSProperties {
  return {
    position: 'sticky',
    [side]: 0,
    top: 0,
    zIndex: 6,
    padding: '7px 5px',
    background: HDR_BG,
    borderBottom: `1px solid ${T.border}`,
    ...(side === 'left' ? { borderRight: `1px solid ${T.border}` } : { borderLeft: `1px solid ${T.border}` }),
    fontSize: 9,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    color: T.muted,
    display: 'flex',
    alignItems: 'flex-end',
    ...(side === 'right' ? { justifyContent: 'flex-end' } : {}),
  }
}

function railBase(side: 'left' | 'right'): CSSProperties {
  return {
    position: 'sticky',
    [side]: 0,
    zIndex: 2,
    minHeight: ROW_MIN_H,
    background: HDR_BG,
    ...(side === 'left' ? { borderRight: `1px solid ${T.border}` } : { borderLeft: `1px solid ${T.border}` }),
  }
}

const countStackStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  width: '100%',
  lineHeight: 1.3,
  fontSize: 10,
}
