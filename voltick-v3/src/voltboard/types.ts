// ─────────────────────────────────────────────────────────────────────────────
// The Voltmap's shapes. One file, so the builder, the deriver and the grid
// cannot drift into three opinions about what a board is.
//
// A BOARD is a strike × expiration matrix plus the spot it was priced at.
// Nothing here is derived — every level, mark and colour comes out of
// derive.ts, which is the single definition the grid, the tiles, the ribbon
// and the node card all read. That rule is lifted from Voltick's own
// board-derive.jsx, and it is the reason a pane and the board can never quote
// different Volts.
// ─────────────────────────────────────────────────────────────────────────────

/** Which exposure the board is drawing. */
export type BoardMode = 'GEX' | 'VEX'

/** Which book the cells are weighted by. */
export type BoardSource = 'oi' | 'volume'

/** One cell: one strike, one expiration. */
export interface BoardCell {
  /** The value the map draws, in the active mode and source. */
  v: number
  /** Open-interest net, always — the stat tiles read this whatever the map shows. */
  oiNet: number
  /** Volume-weighted net, always. */
  volNet: number
  callOI: number
  putOI: number
  callVol: number
  putVol: number
}

/** One expiration column. */
export interface BoardCol {
  /** ISO date, YYYY-MM-DD. */
  exp: string
  /** Days to expiration, 0 for same-day. */
  dte: number
  /** Column label as the header prints it, MM/DD. */
  label: string
  /** strike → cell. Sparse: a strike with no contracts has no entry. */
  cells: Map<number, BoardCell>
  /** The biggest level in THIS column, by |v|. */
  king: number | null
  /** Where this column's own cumulative gamma crosses zero, or null. */
  flip: number | null
}

/** One symbol's whole board. */
export interface BoardMap {
  symbol: string
  spot: number
  prevClose: number
  /** Every strike any column carries, ascending. */
  strikes: number[]
  cols: BoardCol[]
  /** ATM implied vol from the front column, as a decimal. */
  atmIv: number | null
  /** The session's expected move, one standard deviation, in dollars. */
  em: number | null
  /** When the matrix was built. */
  builtAt: number
  /** Non-empty when the board is incomplete — shown, never swallowed. */
  warning?: string
}

/**
 * Which expirations a reading covers.
 *
 * -1  Σ all dates          number  that column index alone
 * 'WEEK'  today → Friday   'MONTH' the current month
 * number[]  a hand-picked set of column indexes
 */
export type Scope = -1 | number | 'WEEK' | 'MONTH' | number[]

/** What a strike IS on this board. A strike can hold several roles at once. */
export type MarkKind = 'volt' | 'callWall' | 'putWall' | 'flip' | 'reversal' | 'coil' | 'surge' | 'air'

/** The aggregate for the scope in view. */
export interface Agg {
  /** Every strike in scope summed, the number the Net tile prints. */
  netTotal: number
  /** strike → summed value across the scope. */
  byStrike: Map<number, number>
  /** The biggest level by |value| — the ★ Volt. */
  king: number | null
  callWall: number | null
  putWall: number | null
  /** Where the scope's cumulative gamma crosses zero, nearest price. */
  flip: number | null
  /** How many times it crosses. >1 means the one above is the nearest, not the only. */
  flipCrossings: number
  /**
   * Known but one-sided: the scope holds one mood across every strike, so
   * there is no flip. `null` flip + this set is an ANSWER, not a failure.
   */
  oneSided: 'sticky' | 'slippery' | null
  /** The far wall a move tends to turn at. */
  reversal: number | null
  /** Clusters between price and the Volt. */
  coils: number[]
  /** Today's hot spot, volume-weighted, and its opposite wall. */
  surge: number | null
  surgeWall: number | null
  /** Strikes with almost nothing on them — open road. */
  air: number[]
}
