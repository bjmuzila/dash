// ─────────────────────────────────────────────────────────────────────────────
// PAPER TRADING IN REPLAY: the book behind the dock's Buy / Sell / Flat keys.
//
// One position at a time, on the chart being replayed. Market orders fill at
// the replay price (the newest revealed close, inside a candle still building
// tick by tick). Buying while short covers first, and the remainder goes long
// (and the same the other way round). Every round trip lands in the trade log
// with its points and dollars. Dollars use the contract's point value: ES $50,
// MES $5, NQ $20, MNQ $2, anything else $1 a point per share or unit.
//
// The log, the realized P&L and any open position are kept in this browser
// (localStorage), so the next replay picks up where you left off. Reset clears
// it. A replay that ends with a position still open closes it at the last
// replay price, tagged "replay ended", so the log never holds a position
// nobody can see.
// ─────────────────────────────────────────────────────────────────────────────

export interface PaperFill {
  t: number
  price: number
  /** Signed: + bought, − sold. */
  qty: number
  sym: string
}

export interface PaperTrade {
  sym: string
  dir: 1 | -1
  qty: number
  entryT: number
  entry: number
  exitT: number
  exit: number
  /** Points × quantity. */
  pts: number
  usd: number
  note?: string
}

export interface PaperState {
  sym: string | null
  /** Signed position. */
  pos: number
  avg: number
  openT: number
  fills: PaperFill[]
  trades: PaperTrade[]
}

const KEY = 'cb-vela-paper'
const EMPTY: PaperState = { sym: null, pos: 0, avg: 0, openT: 0, fills: [], trades: [] }

const POINT: Record<string, number> = { ES: 50, MES: 5, NQ: 20, MNQ: 2 }
export const pointValue = (sym: string): number => POINT[sym.replace(/^\//, '').replace(/\d+!?$/, '')] ?? 1

function load(): PaperState {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PaperState> | null
    if (!j || typeof j !== 'object') return { ...EMPTY }
    return {
      sym: typeof j.sym === 'string' ? j.sym : null,
      pos: Number(j.pos) || 0,
      avg: Number(j.avg) || 0,
      openT: Number(j.openT) || 0,
      fills: Array.isArray(j.fills) ? j.fills.slice(-500) : [],
      trades: Array.isArray(j.trades) ? j.trades.slice(-500) : [],
    }
  } catch {
    return { ...EMPTY }
  }
}

let state: PaperState = load()
let version = 0
const subs = new Set<() => void>()

function commit(next: PaperState): void {
  state = next
  version++
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* private mode: the book lasts this visit */
  }
  for (const fn of subs) fn()
}

export const paperStore = {
  get: (): PaperState => state,
  version: (): number => version,
  subscribe(fn: () => void): () => void {
    subs.add(fn)
    return () => {
      subs.delete(fn)
    }
  },
}

/** Fill a market order of `qty` (signed) at `price`. */
export function paperOrder(sym: string, qty: number, price: number, t: number, note?: string): void {
  if (!qty || !Number.isFinite(price)) return
  let s = state
  // a position still open on another symbol: close it at its average (its own last
  // price is not known here), so it books nothing either way
  if (s.pos && s.sym && s.sym !== sym) s = closeAt(s, s.avg, t, 'symbol changed')
  const fills = [...s.fills, { t, price, qty, sym }].slice(-500)
  let { pos, avg, openT } = s
  const trades = [...s.trades]
  if (!pos || Math.sign(pos) === Math.sign(qty)) {
    // opening or adding: a new average
    avg = (avg * Math.abs(pos) + price * Math.abs(qty)) / (Math.abs(pos) + Math.abs(qty))
    if (!pos) openT = t
    pos += qty
  } else {
    // reducing, closing or reversing
    const closing = Math.min(Math.abs(qty), Math.abs(pos))
    const dir = Math.sign(pos) as 1 | -1
    const pts = (price - avg) * dir * closing
    trades.push({ sym, dir, qty: closing, entryT: openT, entry: avg, exitT: t, exit: price, pts, usd: pts * pointValue(sym), ...(note ? { note } : {}) })
    pos += qty
    if (pos === 0) {
      avg = 0
      openT = 0
    } else if (Math.sign(pos) !== dir) {
      // reversed: the remainder opens at this price
      avg = price
      openT = t
    }
  }
  commit({ sym, pos, avg, openT, fills, trades: trades.slice(-500) })
}

function closeAt(s: PaperState, price: number, t: number, note: string): PaperState {
  if (!s.pos || !s.sym) return s
  const dir = Math.sign(s.pos) as 1 | -1
  const qty = Math.abs(s.pos)
  const pts = (price - s.avg) * dir * qty
  return {
    ...s,
    pos: 0,
    avg: 0,
    openT: 0,
    fills: [...s.fills, { t, price, qty: -s.pos, sym: s.sym }].slice(-500),
    trades: [...s.trades, { sym: s.sym, dir, qty, entryT: s.openT, entry: s.avg, exitT: t, exit: price, pts, usd: pts * pointValue(s.sym), note }].slice(-500),
  }
}

/** Close whatever is open at `price`. */
export function paperFlatten(price: number, t: number, note?: string): void {
  if (!state.pos) return
  commit(closeAt(state, price, t, note ?? ''))
}

export function paperReset(): void {
  commit({ ...EMPTY })
}

/** Open P&L at `price`: points and dollars. */
export function paperOpen(price: number): { pts: number; usd: number } {
  if (!state.pos || !state.sym || !Number.isFinite(price)) return { pts: 0, usd: 0 }
  const pts = (price - state.avg) * state.pos
  return { pts, usd: pts * pointValue(state.sym) }
}

export interface PaperStats {
  n: number
  wins: number
  net: number
  avgWin: number
  avgLoss: number
  pf: number
  maxDd: number
}

export function paperStats(trades: readonly PaperTrade[]): PaperStats {
  let wins = 0
  let gw = 0
  let gl = 0
  let eq = 0
  let peak = 0
  let maxDd = 0
  for (const t of trades) {
    if (t.usd > 0) {
      wins++
      gw += t.usd
    } else gl += -t.usd
    eq += t.usd
    peak = Math.max(peak, eq)
    maxDd = Math.max(maxDd, peak - eq)
  }
  const losses = trades.length - wins
  return {
    n: trades.length,
    wins,
    net: gw - gl,
    avgWin: wins ? gw / wins : 0,
    avgLoss: losses ? gl / losses : 0,
    pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    maxDd,
  }
}

/** The log as CSV, for a spreadsheet. */
export function paperCsv(trades: readonly PaperTrade[]): string {
  const iso = (t: number) => new Date(t).toISOString()
  const rows = trades.map((t) => [t.sym, t.dir > 0 ? 'long' : 'short', t.qty, iso(t.entryT), t.entry, iso(t.exitT), t.exit, t.pts.toFixed(2), t.usd.toFixed(2), t.note ?? ''].join(','))
  return ['symbol,side,qty,entry_time,entry,exit_time,exit,points,usd,note', ...rows].join('\n')
}
