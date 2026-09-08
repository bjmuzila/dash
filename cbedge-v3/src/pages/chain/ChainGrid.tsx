// ─────────────────────────────────────────────────────────────────────────────
// THE GRID — calls | strike · net | puts, one accordion row per expiration.
//
// The shape is the one every desk platform draws, and each part of it is load
// bearing:
//
//  · MIRRORED. The selected wing columns run outward from the strike on BOTH
//    sides, so bid sits against bid and the eye reads a strike across in one
//    movement. The call side renders the list reversed (see chainColumns.ts).
//  · THE CENTRE BLOCK IS THE SPINE. Strike, plus whichever NET columns are on
//    (net GEX, net OI, net premium…). It carries its own plate and a rule down
//    each edge, so the eye can find the middle of a fifteen-column table
//    without counting. A net has no side, which is why it cannot live in a wing.
//  · ITM IS SHADED, not coloured, and the shade is TRANSLUCENT so the zebra and
//    the row hover still read through it. A saturated fill would fight the tone
//    colours the columns already use.
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

import { memo, useMemo, type CSSProperties, type ReactNode } from 'react'
import { T, alpha } from '@/design/theme'
import { bsGreeks, impliedVol, yearsToExpiry } from './blackScholes'
import type { ChainBook, ChainRow, ExpiryMeta, OptionQuote } from './chainBook'
import type { CellCtx, CenterColumn, ChainColumn, ChainSide } from './chainColumns'

const STRIKE_W = 84

/** Which greeks the grid draws — and, through the centre block, which greeks
 *  every net exposure is computed from. */
export type GreekSource = 'feed' | 'bs'

export interface ChainDisplay {
  /** Alternate row wash. On by default: it is what makes a fifteen-column row
   *  trackable across the full width. */
  zebra: boolean
  /** The in-the-money wash on each wing. */
  itm: boolean
  /** Vertical rules between every column, not just around the centre block. */
  lines: boolean
}

export interface ChainGridProps {
  expiries: ExpiryMeta[]
  books: Record<string, ChainBook>
  open: string[]
  pending: string[]
  columns: ChainColumn[]
  center: CenterColumn[]
  spot: number
  /** Rows drawn per expiry, centred on spot. 0 = every listed strike. */
  strikeWindow: number
  greekSource: GreekSource
  display: ChainDisplay
  onToggle: (expiration: string) => void
}

// ── Plates ───────────────────────────────────────────────────────────────────
// The centre block is a lighter grey than the rows and the net columns a
// lighter grey again, so the spine reads as one object with the strike at its
// head. All translucent, so zebra and hover survive underneath.
const STRIKE_BG = alpha(T.text, 0.075)
const CENTER_BG = alpha(T.text, 0.038)
const ZEBRA_BG = alpha(T.text, 0.028)
const ITM_BG = alpha(T.text, 0.05)
const ROW_LINE = alpha(T.border, 0.6)
const COL_LINE = alpha(T.border, 0.45)
const SPINE = `1px solid ${T.border}`

// ── INK ────────────────────────────────────────────────────────────────────
// Every glyph on this grid is FULL WHITE (Brandon, 2026-09-08). No opacity
// step-down, and no `--color-flat` grey on the empty-cell placeholder either:
// on the dark-slate plate a dimmed label reads as smudged rather than as
// secondary, and a value you have to lean in for is not a faster read.
//
// Hierarchy comes from SIZE and WEIGHT instead — 9/10/11px off the type scale,
// and semibold on a head — which is the separation that survives at 11px.
// design/theme.ts's CHAIN.* ramp is deliberately NOT imported here: it is the
// GEX matrix's ink ladder, tuned for text sitting on a saturated heat fill,
// and these cells have no heat fill under them.
const INK = T.text

export function ChainGrid({
  expiries,
  books,
  open,
  pending,
  columns,
  center,
  spot,
  strikeWindow,
  greekSource,
  display,
  onToggle,
}: ChainGridProps) {
  const wingCols = columns.length
  const totalCols = wingCols * 2 + 1 + center.length
  const totalWidth =
    columns.reduce((sum, c) => sum + c.width, 0) * 2 +
    STRIKE_W +
    center.reduce((sum, c) => sum + c.width, 0)
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
        {center.map((c) => (
          <col key={`n-${c.key}`} style={{ width: c.width }} />
        ))}
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
            colSpan={1 + center.length}
            className="sticky top-0 z-20 border-b border-line bg-surface2 text-3xs font-bold uppercase tracking-[0.18em]"
            style={{ height: 22, color: T.cyan, borderLeft: SPINE, borderRight: SPINE }}
          >
            {center.length ? 'Strike · Net' : 'Strike'}
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
          {callColumns.map((c, i) => (
            <HeadCell key={`ch-${c.key}`} col={c} rule={display.lines && i > 0} />
          ))}
          <th
            className="sticky z-20 border-b border-line px-1 text-center text-2xs font-semibold text-fg"
            style={{
              top: 22,
              height: 24,
              background: T.panel,
              borderLeft: SPINE,
              borderRight: center.length ? undefined : SPINE,
            }}
          >
            &nbsp;
          </th>
          {center.map((c, i) => (
            <th
              key={`nh-${c.key}`}
              title={c.title}
              className="sticky z-20 border-b border-line px-2 text-right text-2xs font-semibold text-muted"
              style={{
                top: 22,
                height: 24,
                background: T.panel,
                borderLeft: display.lines && i > 0 ? `1px solid ${COL_LINE}` : undefined,
                borderRight: i === center.length - 1 ? SPINE : undefined,
              }}
            >
              {c.label}
            </th>
          ))}
          {columns.map((c, i) => (
            <HeadCell key={`ph-${c.key}`} col={c} rule={display.lines && i > 0} />
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
                center={center}
                strikeWindow={strikeWindow}
                greekSource={greekSource}
                display={display}
                colSpan={totalCols}
              />
            ) : null}
            {isOpen && !book ? (
              <tr>
                <td colSpan={totalCols} className="px-3 py-3 text-center text-2xs" style={{ color: INK }}>
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

function HeadCell({ col, rule }: { col: ChainColumn; rule: boolean }) {
  return (
    <th
      title={col.title}
      className="sticky z-20 border-b border-line bg-surface px-2 text-right text-2xs font-semibold text-muted"
      style={{ top: 22, height: 24, borderLeft: rule ? `1px solid ${COL_LINE}` : undefined }}
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
          <span className="text-2xs" style={{ color: INK }}>
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
            <span className="text-3xs" style={{ color: T.cyan }}>
              loading…
            </span>
          )}

          {book && (
            <span className="ml-auto flex items-center gap-3 text-2xs" style={{ color: INK }}>
              {book.atmIv > 0 && <span>IV {(book.atmIv * 100).toFixed(1)}%</span>}
              <span>
                OI {compact(book.callOi)}c / {compact(book.putOi)}p
              </span>
              {pcr > 0 && (
                <span title="Put/call open-interest ratio for this expiry">P/C {pcr.toFixed(2)}</span>
              )}
              <span>Vol {compact(book.callVol + book.putVol)}</span>
              {/* THIS expiry's own collection time. Per-expiry rather than one
                  page clock: only the expanded rows poll, so a single stamp
                  would claim a freshness the others do not have. */}
              <span
                className="tabular"
                title={`This expiry's data was collected at ${etClock(book.fetchedAt)} ET`}
              >
                ⟳ {etClock(book.fetchedAt)}
              </span>
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

/** Wall clock in ET — the session's own timezone, not the reader's. */
export function etClock(ms: number): string {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return '—'
  }
}

// ── Black-Scholes substitution ───────────────────────────────────────────────
// Applied at the ROW, once, so the wing cells and the centre block's net
// exposures are computed from the same greeks. A column that quietly used the
// feed's gamma while the net GEX beside it used the model's would be the worst
// of both.

function modelQuote(q: OptionQuote, side: ChainSide, S: number, K: number, T: number): OptionQuote {
  if (!q.live) return q
  // No feed IV — solve it off the mark. This is the case the toggle exists for:
  // a strike the market-data batch missed has zeroes for every greek AND for
  // IV, and without this it would stay blank under Black-Scholes too.
  const iv = q.iv > 0 ? q.iv : impliedVol(side, S, K, T, q.mark)
  if (!(iv > 0)) return q
  const g = bsGreeks(side, S, K, T, iv)
  if (!g.gamma && !g.delta) return q
  return { ...q, iv, delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega }
}

// ── The strikes ──────────────────────────────────────────────────────────────

interface StrikeRowsProps {
  book: ChainBook
  spot: number
  columns: ChainColumn[]
  callColumns: ChainColumn[]
  center: CenterColumn[]
  strikeWindow: number
  greekSource: GreekSource
  display: ChainDisplay
  colSpan: number
}

function StrikeRows({
  book,
  spot,
  columns,
  callColumns,
  center,
  strikeWindow,
  greekSource,
  display,
  colSpan,
}: StrikeRowsProps) {
  const rows = useMemo(() => windowRows(book.rows, spot, strikeWindow), [book.rows, spot, strikeWindow])
  // The strike the ATM marker lands on, and the index the spot line is drawn
  // above. Both derived from the WINDOWED rows so a scrolled-away spot does not
  // leave a marker pointing at nothing.
  const { atmStrike, spotIndex } = useMemo(() => locateSpot(rows, spot), [rows, spot])
  // Re-measured whenever the book reloads, so theta on a 0DTE contract keeps
  // shortening through the session instead of freezing at the value it opened on.
  const tYears = useMemo(
    () => (greekSource === 'bs' ? yearsToExpiry(book.expiration) : 0),
    [book.expiration, book.fetchedAt, greekSource],
  )

  if (!rows.length) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-3 py-3 text-center text-2xs" style={{ color: INK }}>
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
        tYears={tYears}
        atm={row.strike === atmStrike}
        zebra={display.zebra && i % 2 === 1}
        display={display}
        greekSource={greekSource}
        columns={columns}
        callColumns={callColumns}
        center={center}
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
  tYears: number
  atm: boolean
  zebra: boolean
  display: ChainDisplay
  greekSource: GreekSource
  columns: ChainColumn[]
  callColumns: ChainColumn[]
  center: CenterColumn[]
}

const StrikeRow = memo(function StrikeRow({
  row,
  spot,
  tYears,
  atm,
  zebra,
  display,
  greekSource,
  columns,
  callColumns,
  center,
}: StrikeRowProps) {
  // ONE substitution per row, shared by both wings and the centre block.
  const eff = useMemo<ChainRow>(() => {
    if (greekSource !== 'bs' || !(spot > 0) || !(tYears > 0)) return row
    return {
      strike: row.strike,
      call: modelQuote(row.call, 'call', spot, row.strike, tYears),
      put: modelQuote(row.put, 'put', spot, row.strike, tYears),
    }
  }, [row, greekSource, spot, tYears])

  const callItm = display.itm && spot > 0 && row.strike < spot
  const putItm = display.itm && spot > 0 && row.strike > spot
  const lines = display.lines

  return (
    <tr className="hover:bg-raised" style={zebra ? { background: ZEBRA_BG } : undefined}>
      {callColumns.map((c, i) => (
        <Cell
          key={`c-${c.key}`}
          col={c}
          q={eff.call}
          strike={row.strike}
          side="call"
          spot={spot}
          itm={callItm}
          rule={lines && i > 0}
        />
      ))}
      <td
        className="px-1 text-center text-xs font-bold"
        style={{
          borderBottom: `1px solid ${ROW_LINE}`,
          borderLeft: SPINE,
          borderRight: center.length ? (lines ? `1px solid ${COL_LINE}` : undefined) : SPINE,
          color: atm ? T.cyan : INK,
          background: atm ? alpha(T.cyan, 0.14) : STRIKE_BG,
        }}
      >
        {Number.isInteger(row.strike) ? row.strike.toFixed(0) : row.strike.toFixed(2)}
      </td>
      {center.map((c, i) => {
        const v = c.read(eff, spot)
        const empty = v === null || !Number.isFinite(v)
        return (
          <td
            key={`n-${c.key}`}
            className="px-2 text-right"
            style={{
              borderBottom: `1px solid ${ROW_LINE}`,
              borderRight: i === center.length - 1 ? SPINE : lines ? `1px solid ${COL_LINE}` : undefined,
              background: CENTER_BG,
              color: empty ? INK : (c.tone?.(v as number) ?? INK),
            }}
          >
            {empty ? '·' : c.fmt(v as number)}
          </td>
        )
      })}
      {columns.map((c, i) => (
        <Cell
          key={`p-${c.key}`}
          col={c}
          q={eff.put}
          strike={row.strike}
          side="put"
          spot={spot}
          itm={putItm}
          rule={lines && i > 0}
        />
      ))}
    </tr>
  )
})

function Cell({
  col,
  q,
  strike,
  side,
  spot,
  itm,
  rule,
}: {
  col: ChainColumn
  q: OptionQuote
  strike: number
  side: ChainSide
  spot: number
  itm: boolean
  rule: boolean
}) {
  const ctx: CellCtx = { strike, spot, side }
  const v = col.read(q, ctx)
  const empty = v === null || !Number.isFinite(v)
  const style: CSSProperties = {
    borderBottom: `1px solid ${ROW_LINE}`,
    color: empty ? INK : (col.tone?.(v as number, ctx) ?? INK),
  }
  if (itm) style.background = ITM_BG
  if (rule) style.borderLeft = `1px solid ${COL_LINE}`
  return (
    <td className="px-2 text-right" style={style}>
      {empty ? '·' : col.fmt(v as number, ctx)}
    </td>
  )
}
