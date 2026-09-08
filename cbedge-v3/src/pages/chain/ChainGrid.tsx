// ─────────────────────────────────────────────────────────────────────────────
// THE GRID — calls | strike | puts, one accordion row per expiration.
//
// The shape is the one every desk platform draws, and each part of it is load
// bearing:
//
//  · MIRRORED. The selected columns run outward from the strike on BOTH wings,
//    so bid sits against bid and the eye reads a strike across in one movement.
//    The call side renders the list reversed (see chainColumns.ts).
//  · ITM IS SHADED, not coloured. Calls below spot and puts above it carry a
//    5%-white wash — translucent, so the row's hover still reads through it. A
//    saturated fill here would fight the tone colours the columns already use.
//  · THE SPOT LINE IS A ROW. It is drawn BETWEEN the two strikes that bracket
//    the underlying rather than on the nearest one, because that is where the
//    price actually is; the nearest strike is separately marked ATM.
//  · ONE TABLE, MANY BODIES. Every expiration is a <tbody> in the SAME table,
//    which is what keeps the columns aligned across groups — the thing a stack
//    of per-expiry tables cannot do.
//
// Nothing here paints to a canvas, so non-negotiables 4-6 have nothing to bite
// on. Row count is bounded by the strike window in Chain.tsx; that is what
// stands in for virtualisation, and it is why "All" is an explicit choice.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useMemo, type ReactNode } from 'react'
import { CHAIN, T, alpha } from '@/design/theme'
import type { ChainBook, ChainRow, ExpiryMeta } from './chainBook'
import type { CellCtx, ChainColumn, ChainSide } from './chainColumns'

const STRIKE_W = 84

export interface ChainGridProps {
  expiries: ExpiryMeta[]
  books: Record<string, ChainBook>
  open: string[]
  pending: string[]
  columns: ChainColumn[]
  spot: number
  /** Rows drawn per expiry, centred on spot. 0 = every listed strike. */
  strikeWindow: number
  onToggle: (expiration: string) => void
}

export function ChainGrid({
  expiries,
  books,
  open,
  pending,
  columns,
  spot,
  strikeWindow,
  onToggle,
}: ChainGridProps) {
  const wingCols = columns.length
  const totalCols = wingCols * 2 + 1
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0) * 2 + STRIKE_W
  // The call wing reads outward from the strike, so its columns are the same
  // list, backwards. Computed once rather than per group.
  const callColumns = useMemo(() => [...columns].reverse(), [columns])

  return (
    <table
      className="border-collapse tabular text-xs"
      style={{ tableLayout: 'fixed', width: '100%', minWidth: totalWidth }}
    >
      <colgroup>
        {callColumns.map((c) => (
          <col key={`c-${c.key}`} style={{ width: c.width }} />
        ))}
        <col style={{ width: STRIKE_W }} />
        {columns.map((c) => (
          <col key={`p-${c.key}`} style={{ width: c.width }} />
        ))}
      </colgroup>

      <thead>
        <tr>
          <th
            colSpan={wingCols}
            className="sticky top-0 z-20 border-b border-line bg-surface2 px-2 text-3xs font-bold uppercase tracking-[0.18em] text-muted"
            style={{ height: 22 }}
          >
            Calls
          </th>
          <th
            colSpan={1}
            className="sticky top-0 z-20 border-b border-line bg-surface2 text-3xs font-bold uppercase tracking-[0.18em]"
            style={{ height: 22, color: T.cyan }}
          >
            Strike
          </th>
          <th
            colSpan={wingCols}
            className="sticky top-0 z-20 border-b border-line bg-surface2 px-2 text-3xs font-bold uppercase tracking-[0.18em] text-muted"
            style={{ height: 22 }}
          >
            Puts
          </th>
        </tr>
        <tr>
          {callColumns.map((c) => (
            <HeadCell key={`ch-${c.key}`} col={c} />
          ))}
          <th
            className="sticky z-20 border-b border-line bg-surface px-1 text-center text-2xs font-semibold text-fg"
            style={{ top: 22, height: 24 }}
          >
            &nbsp;
          </th>
          {columns.map((c) => (
            <HeadCell key={`ph-${c.key}`} col={c} />
          ))}
        </tr>
      </thead>

      {expiries.map((exp) => {
        const isOpen = open.includes(exp.value)
        const book = books[exp.value]
        return (
          <tbody key={exp.value}>
            <ExpiryHeaderRow
              exp={exp}
              book={book}
              open={isOpen}
              loading={pending.includes(exp.value)}
              colSpan={totalCols}
              onToggle={onToggle}
            />
            {isOpen && book ? (
              <StrikeRows
                book={book}
                spot={spot > 0 ? spot : book.underlying}
                columns={columns}
                callColumns={callColumns}
                strikeWindow={strikeWindow}
                colSpan={totalCols}
              />
            ) : null}
            {isOpen && !book ? (
              <tr>
                <td colSpan={totalCols} className="px-3 py-3 text-center text-2xs" style={{ color: CHAIN.empty }}>
                  {pending.includes(exp.value) ? 'Loading chain…' : 'No chain returned for this expiry.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        )
      })}
    </table>
  )
}

function HeadCell({ col }: { col: ChainColumn }) {
  return (
    <th
      title={col.title}
      className="sticky z-20 border-b border-line bg-surface px-2 text-right text-2xs font-semibold text-muted"
      style={{ top: 22, height: 24 }}
    >
      {col.label}
    </th>
  )
}

// ── The expiry row ───────────────────────────────────────────────────────────
// A button, not a div with a click handler: it is the page's primary control
// and it has to be reachable from the keyboard.

interface ExpiryHeaderProps {
  exp: ExpiryMeta
  book: ChainBook | undefined
  open: boolean
  loading: boolean
  colSpan: number
  onToggle: (expiration: string) => void
}

const ExpiryHeaderRow = memo(function ExpiryHeaderRow({
  exp,
  book,
  open,
  loading,
  colSpan,
  onToggle,
}: ExpiryHeaderProps) {
  const pcr = book && book.callOi > 0 ? book.putOi / book.callOi : 0
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <button
          type="button"
          onClick={() => onToggle(exp.value)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 border-b border-line bg-surface2 px-2 text-left hover:bg-raised"
          style={{ height: 26 }}
        >
          <span className="text-2xs" style={{ color: T.cyan, width: 10 }}>
            {open ? '▾' : '▸'}
          </span>
          <span className="text-xs font-semibold text-fg">{exp.label}</span>
          <span className="text-2xs" style={{ color: T.muted, opacity: 0.7 }}>
            {exp.dte === 0 ? '0DTE' : `${exp.dte}d`}
          </span>
          {exp.monthly && (
            <span
              className="rounded-sm px-1 text-3xs font-bold uppercase tracking-wide"
              style={{ background: alpha(T.orange, 0.18), color: T.orange }}
              title="Standard monthly — third Friday"
            >
              M
            </span>
          )}
          {loading && (
            <span className="text-3xs" style={{ color: T.cyan, opacity: 0.8 }}>
              loading…
            </span>
          )}

          {book && (
            <span className="ml-auto flex items-center gap-3 text-2xs" style={{ color: T.muted, opacity: 0.75 }}>
              {book.atmIv > 0 && <span>IV {(book.atmIv * 100).toFixed(1)}%</span>}
              <span>
                OI {compact(book.callOi)}c / {compact(book.putOi)}p
              </span>
              {pcr > 0 && (
                <span title="Put/call open-interest ratio for this expiry">P/C {pcr.toFixed(2)}</span>
              )}
              <span>Vol {compact(book.callVol + book.putVol)}</span>
            </span>
          )}
        </button>
      </td>
    </tr>
  )
})

function compact(v: number): string {
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (a >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return String(Math.round(v))
}

// ── The strikes ──────────────────────────────────────────────────────────────

interface StrikeRowsProps {
  book: ChainBook
  spot: number
  columns: ChainColumn[]
  callColumns: ChainColumn[]
  strikeWindow: number
  colSpan: number
}

function StrikeRows({ book, spot, columns, callColumns, strikeWindow, colSpan }: StrikeRowsProps) {
  const rows = useMemo(() => windowRows(book.rows, spot, strikeWindow), [book.rows, spot, strikeWindow])
  // The strike the ATM marker lands on, and the index the spot line is drawn
  // above. Both are derived from the WINDOWED rows so a scrolled-away spot does
  // not leave a marker pointing at nothing.
  const { atmStrike, spotIndex } = useMemo(() => locateSpot(rows, spot), [rows, spot])

  if (!rows.length) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-3 py-3 text-center text-2xs" style={{ color: CHAIN.empty }}>
          No strikes in the current window.
        </td>
      </tr>
    )
  }

  const out: ReactNode[] = []
  rows.forEach((row, i) => {
    if (i === spotIndex) {
      out.push(<SpotRow key={`spot-${book.expiration}`} spot={spot} colSpan={colSpan} />)
    }
    out.push(
      <StrikeRow
        key={`${book.expiration}-${row.strike}`}
        row={row}
        spot={spot}
        atm={row.strike === atmStrike}
        columns={columns}
        callColumns={callColumns}
      />,
    )
  })
  if (spotIndex >= rows.length) {
    out.push(<SpotRow key={`spot-${book.expiration}`} spot={spot} colSpan={colSpan} />)
  }
  return <>{out}</>
}

/** The N strikes closest to spot, in strike order. 0 = all of them. */
function windowRows(rows: ChainRow[], spot: number, count: number): ChainRow[] {
  if (!count || rows.length <= count || !(spot > 0)) return rows
  let center = 0
  let gap = Infinity
  rows.forEach((r, i) => {
    const d = Math.abs(r.strike - spot)
    if (d < gap) {
      gap = d
      center = i
    }
  })
  const half = Math.floor(count / 2)
  let start = center - half
  if (start < 0) start = 0
  if (start + count > rows.length) start = rows.length - count
  return rows.slice(start, start + count)
}

function locateSpot(rows: ChainRow[], spot: number): { atmStrike: number; spotIndex: number } {
  if (!rows.length || !(spot > 0)) return { atmStrike: NaN, spotIndex: -1 }
  let atmStrike = rows[0]?.strike ?? NaN
  let gap = Infinity
  let spotIndex = rows.length
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i] as ChainRow
    const d = Math.abs(r.strike - spot)
    if (d < gap) {
      gap = d
      atmStrike = r.strike
    }
    if (spotIndex === rows.length && r.strike > spot) spotIndex = i
  }
  return { atmStrike, spotIndex }
}

function SpotRow({ spot, colSpan }: { spot: number; colSpan: number }) {
  return (
    <tr aria-hidden="true">
      {/* Tagged so the page can centre the scroll container on it after the
          first book lands — see Chain.tsx. */}
      <td colSpan={colSpan} className="p-0" data-cb-spot="">
        <div className="relative flex items-center" style={{ height: 12 }}>
          <div className="h-px flex-1" style={{ background: alpha(T.cyan, 0.55) }} />
          <span
            className="rounded-sm px-1 text-3xs font-bold tabular"
            style={{ background: alpha(T.cyan, 0.16), color: T.cyan }}
          >
            {spot.toFixed(2)}
          </span>
          <div className="h-px flex-1" style={{ background: alpha(T.cyan, 0.55) }} />
        </div>
      </td>
    </tr>
  )
}

interface StrikeRowProps {
  row: ChainRow
  spot: number
  atm: boolean
  columns: ChainColumn[]
  callColumns: ChainColumn[]
}

const StrikeRow = memo(function StrikeRow({ row, spot, atm, columns, callColumns }: StrikeRowProps) {
  const callItm = spot > 0 && row.strike < spot
  const putItm = spot > 0 && row.strike > spot
  return (
    <tr className="hover:bg-raised">
      {callColumns.map((c) => (
        <Cell key={`c-${c.key}`} col={c} row={row} side="call" spot={spot} itm={callItm} />
      ))}
      <td
        className="border-b px-1 text-center text-xs font-bold"
        style={{
          borderBottomColor: alpha(T.border, 0.6),
          color: atm ? T.cyan : CHAIN.strike,
          background: atm ? alpha(T.cyan, 0.1) : undefined,
        }}
      >
        {Number.isInteger(row.strike) ? row.strike.toFixed(0) : row.strike.toFixed(2)}
      </td>
      {columns.map((c) => (
        <Cell key={`p-${c.key}`} col={c} row={row} side="put" spot={spot} itm={putItm} />
      ))}
    </tr>
  )
})

/** ITM wash. Translucent so the row's hover still reads through it. */
const ITM_BG = alpha(T.text, 0.05)

function Cell({
  col,
  row,
  side,
  spot,
  itm,
}: {
  col: ChainColumn
  row: ChainRow
  side: ChainSide
  spot: number
  itm: boolean
}) {
  const ctx: CellCtx = { strike: row.strike, spot, side }
  const q = side === 'call' ? row.call : row.put
  const v = col.read(q, ctx)
  const empty = v === null || !Number.isFinite(v)
  return (
    <td
      className="border-b px-2 text-right"
      style={{
        borderBottomColor: alpha(T.border, 0.6),
        background: itm ? ITM_BG : undefined,
        color: empty ? CHAIN.none : (col.tone?.(v as number, ctx) ?? CHAIN.ink),
      }}
    >
      {empty ? '·' : col.fmt(v as number, ctx)}
    </td>
  )
}
