// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD'S DERIVED VALUES — one definition, every surface.
//
// THE RULE, and it is the whole point of this file: `agg`, `marks`, `roleOf`
// and `cellStyle` have exactly ONE definition, and it is here. The page calls
// `useBoardDerived` once and feeds the same returned object to the ribbon, the
// stat tiles, the grid and the node card. Nothing recomputes them locally.
//
// The failure this prevents is not hypothetical: two copies of `agg` means the
// tiles and the grid can quote different Volts for the same ticker, and it
// looks right on both surfaces while it does it.
//
// ONE THING THAT LOOKS LIKE A BUG AND IS NOT: `inScope` is a plain closure,
// deliberately not memoized. It closes over the current scope and must be
// rebuilt every render. Memoize it and the columns freeze on a stale
// expiration scope — the board still looks right while summing the wrong
// dates, which is the worst kind of wrong.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react'
import { T, alpha, VIOLET, LEVEL_COLORS } from '@/design/theme'
import { heatRef, heatT } from './heat'
import { fmtDate, isTodayExp } from './board'
import type { Agg, BoardMap, MarkKind, Scope } from './types'

/* ── scope ────────────────────────────────────────────────────────────────── */

/** Which column indexes a scope covers. A plain function — see the header. */
export function colsInScope(board: BoardMap, scope: Scope): number[] {
  const all = board.cols.map((_, i) => i)
  if (scope === -1) return all
  if (Array.isArray(scope)) return scope.filter((i) => i >= 0 && i < board.cols.length)
  if (scope === 'WEEK') {
    // Today through Friday. Friday itself is in; next Monday is not.
    const out: number[] = []
    for (let i = 0; i < board.cols.length; i++) {
      const c = board.cols[i]
      if (c.dte < 0) continue
      const dow = new Date(`${c.exp}T00:00:00Z`).getUTCDay()
      if (c.dte <= 6 && dow >= 1 && dow <= 5) out.push(i)
      if (c.dte > 6) break
    }
    return out.length ? out : all.slice(0, 1)
  }
  if (scope === 'MONTH') {
    const m = board.cols[0]?.exp.slice(0, 7)
    return all.filter((i) => board.cols[i].exp.slice(0, 7) === m)
  }
  return scope >= 0 && scope < board.cols.length ? [scope] : all
}

/** What the tiles and the ribbon call the scope. Never invented at a call site. */
export function scopeTagOf(board: BoardMap, scope: Scope): string {
  if (scope === -1) return 'all dates'
  if (scope === 'WEEK') return 'this week'
  if (scope === 'MONTH') return 'this month'
  if (Array.isArray(scope)) {
    if (scope.length === 1) return fmtDate(board.cols[scope[0]]?.exp ?? '')
    return `${scope.length} dates`
  }
  const c = board.cols[scope]
  if (!c) return 'all dates'
  return isTodayExp(c.exp) ? '0DTE' : fmtDate(c.exp)
}

/* ── the aggregate ────────────────────────────────────────────────────────── */

/**
 * Sum the scope's columns per strike, then read every level off that one walk.
 *
 * Ported from Voltick's `aggregateFromCells`, including the parts that look
 * arbitrary and are not — the reversal's shelf weighting, the 0.5× gate for a
 * coil, the 8% floor for air. Those thresholds are the product.
 */
export function aggregate(board: BoardMap, scope: Scope): Agg {
  const idxs = colsInScope(board, scope)
  const byStrike = new Map<number, number>()
  let netTotal = 0

  for (const i of idxs) {
    for (const [k, cell] of board.cols[i].cells) {
      const next = (byStrike.get(k) ?? 0) + cell.v
      byStrike.set(k, next)
    }
  }
  for (const v of byStrike.values()) netTotal += v

  const strikes = [...byStrike.keys()].sort((a, b) => a - b)
  const val = (k: number) => byStrike.get(k) ?? 0

  // walls: the most positive and the most negative strike on the board.
  let callWall: number | null = null
  let putWall: number | null = null
  let cwV = -Infinity
  let pwV = Infinity
  for (const k of strikes) {
    const v = val(k)
    if (v > cwV) {
      cwV = v
      callWall = k
    }
    if (v < pwV) {
      pwV = v
      putWall = k
    }
  }

  // king ★ — the biggest level either way.
  let king: number | null = null
  let kingAbs = 0
  for (const k of strikes) {
    const a = Math.abs(val(k))
    if (a > kingAbs) {
      kingAbs = a
      king = k
    }
  }
  const kingSign = king !== null ? Math.sign(val(king)) : 0

  // The neighbourhood a "shelf" is measured over: 2.5 strike steps.
  const step = (() => {
    let mn = Infinity
    for (let a = 1; a < strikes.length; a++) {
      const d = strikes[a] - strikes[a - 1]
      if (d > 0 && d < mn) mn = d
    }
    return (mn === Infinity ? 1 : mn) * 2.5
  })()

  // reversal ↘ — the opposite-sign pole, shelf-weighted so a node backed by
  // comparable neighbours beats a lone spike.
  let reversal: number | null = null
  let revBest = -Infinity
  for (const k of strikes) {
    const v = val(k)
    if (kingSign === 0 || Math.sign(v) !== -kingSign) continue
    const size = Math.abs(v)
    if (size < 0.05 * kingAbs) continue
    let cluster = 0
    for (const k2 of strikes) {
      if (k2 === k) continue
      if (Math.abs(k2 - k) > step) continue
      const v2 = val(k2)
      if (Math.sign(v2) === -kingSign && Math.abs(v2) >= 0.4 * size) cluster++
    }
    const score = size * (1 + 0.18 * Math.min(cluster, 3))
    if (score > revBest) {
      revBest = score
      reversal = k
    }
  }

  // coils ◆ — other levels at least half the king's size, top five.
  const coils = strikes
    .map((k) => ({ k, a: Math.abs(val(k)) }))
    .filter(({ k, a }) => k !== king && k !== reversal && kingAbs > 0 && a >= 0.5 * kingAbs)
    .sort((x, y) => y.a - x.a)
    .slice(0, 5)
    .map(({ k }) => k)

  // air ≋ — three or more consecutive near-empty strikes.
  const air: number[] = []
  let run: number[] = []
  for (const k of strikes) {
    if (kingAbs > 0 && Math.abs(val(k)) < 0.08 * kingAbs) run.push(k)
    else {
      if (run.length >= 3) air.push(...run)
      run = []
    }
  }
  if (run.length >= 3) air.push(...run)

  // surge ↯ — today's hot spot, read off the volume leg of the front column,
  // with its opposite wall. Absent when nothing has traded yet.
  let surge: number | null = null
  let surgeWall: number | null = null
  const front = board.cols[0]
  if (front) {
    let best = 0
    let worst = 0
    for (const [k, c] of front.cells) {
      if (Math.abs(c.volNet) > Math.abs(best)) {
        best = c.volNet
        surge = k
      }
    }
    if (surge != null) {
      const want = -Math.sign(best)
      for (const [k, c] of front.cells) {
        if (Math.sign(c.volNet) === want && Math.abs(c.volNet) > Math.abs(worst)) {
          worst = c.volNet
          surgeWall = k
        }
      }
    }
    if (!best) surge = null
  }

  // flip ⚡︎ — the cumulative walk over the scoped strikes, with the crossing
  // count kept, because more than one crossing changes what the tile says.
  const { flip, crossings, oneSided } = flipWalk(strikes, val, board.spot)

  return {
    netTotal,
    byStrike,
    king,
    callWall,
    putWall,
    flip,
    flipCrossings: crossings,
    oneSided,
    reversal,
    coils,
    surge,
    surgeWall,
    air,
  }
}

/**
 * The cumulative-gamma walk.
 *
 * NO FLIP IS AN ANSWER. A single date, or a short week, often holds one mood
 * clean across every strike it carries. That comes back as `flip: null` with
 * `oneSided` set, and the tile prints "none" rather than going blank — a blank
 * number reads as one that failed to load.
 */
function flipWalk(
  strikes: number[],
  val: (k: number) => number,
  spot: number,
): { flip: number | null; crossings: number; oneSided: 'sticky' | 'slippery' | null } {
  if (strikes.length < 2) return { flip: null, crossings: 0, oneSided: null }
  let run = 0
  let prevK = strikes[0]
  let prevRun = 0
  const hits: number[] = []
  for (const k of strikes) {
    const next = run + val(k)
    if (run !== 0 && next !== 0 && Math.sign(next) !== Math.sign(run)) {
      const t = Math.abs(prevRun) / (Math.abs(prevRun) + Math.abs(next) || 1)
      hits.push(prevK + (k - prevK) * t)
    }
    prevK = k
    prevRun = run
    run = next
  }
  if (hits.length) {
    const flip = spot > 0 ? hits.reduce((a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a)) : hits[0]
    return { flip, crossings: hits.length, oneSided: null }
  }
  // Never crossed. Which side it stayed on is the answer.
  const anyNeg = strikes.some((k) => val(k) < 0)
  const anyPos = strikes.some((k) => val(k) > 0)
  if (anyPos && !anyNeg) return { flip: null, crossings: 0, oneSided: 'sticky' }
  if (anyNeg && !anyPos) return { flip: null, crossings: 0, oneSided: 'slippery' }
  return { flip: null, crossings: 0, oneSided: run >= 0 ? 'sticky' : 'slippery' }
}

/* ── marks ────────────────────────────────────────────────────────────────── */

/** Every role a strike holds. A strike can be the Volt AND the call wall. */
export function marksOf(agg: Agg): Map<number, MarkKind[]> {
  const out = new Map<number, MarkKind[]>()
  const put = (k: number | null, kind: MarkKind) => {
    if (k == null) return
    const cur = out.get(k)
    if (cur) cur.push(kind)
    else out.set(k, [kind])
  }
  put(agg.king, 'volt')
  put(agg.callWall, 'callWall')
  put(agg.putWall, 'putWall')
  put(agg.reversal, 'reversal')
  put(agg.surge, 'surge')
  for (const k of agg.coils) put(k, 'coil')
  for (const k of agg.air) put(k, 'air')
  return out
}

/** The glyph for a role, and its colour. The locked colour language. */
export const MARK_GLYPH: Record<MarkKind, string> = {
  volt: '★',
  callWall: '▲',
  putWall: '▼',
  flip: '⚡︎',
  reversal: '↘',
  coil: '◆',
  surge: '↯',
  air: '≋',
}

export const MARK_COLOR: Record<MarkKind, string> = {
  volt: LEVEL_COLORS.cb,
  callWall: LEVEL_COLORS.cw,
  putWall: LEVEL_COLORS.pw,
  flip: VIOLET,
  reversal: T.purple,
  coil: T.cyan,
  surge: T.cyan,
  air: T.faint,
}

/** How a role reads in one word, for a tooltip or the ribbon. */
export const MARK_WORD: Record<MarkKind, string> = {
  volt: 'the biggest level — price is pulled toward it',
  callWall: 'the strongest ceiling',
  putWall: 'the strongest floor',
  flip: 'above it moves grind, below it they stretch',
  reversal: 'the far wall a move tends to turn at',
  coil: 'a big cluster — green slows price, red speeds it through',
  surge: "today's hot spot, where new money is going now",
  air: 'open road — price travels through',
}

/* ── the cell's look ──────────────────────────────────────────────────────── */

export interface CellStyle {
  background: string
  color: string
}

/**
 * ONE function, so the grid and any pane are correct by construction rather
 * than by discipline. Green = positive gamma, red = negative, brighter =
 * bigger — which is the legend, and the legend is a promise.
 *
 * `quiet` pushes back every cell with no mark, so the Volt, the Reversal and
 * the Surge come forward on a dense board.
 */
export function cellStyle(v: number, ref: number, marked: boolean, quiet: boolean): CellStyle {
  if (!v) return { background: 'transparent', color: T.faint }
  const t = heatT(v, ref)
  const dim = quiet && !marked ? 0.35 : 1
  const hue = v >= 0 ? T.green : T.red
  return {
    background: alpha(hue, Math.max(0.04, t * 0.42 * dim)),
    color: t > 0.55 ? T.text : alpha(T.text, 0.62 + 0.3 * t),
  }
}

/* ── formatting ───────────────────────────────────────────────────────────── */

/** $1.98B / $238.1M / $91.0K — the grid's own number format. */
export function fmtVal(v: number | null | undefined): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return '$0'
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`
  return `${sign}$${a.toFixed(0)}`
}

/** A strike, without trailing noise: 7650, 7650.5, 212.25. */
export function fmtStrike(k: number | null | undefined): string {
  const n = Number(k)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

/* ── the bundle ───────────────────────────────────────────────────────────── */

export interface Derived {
  agg: Agg
  /** The aggregate the TILES read. Always open interest — see the note below. */
  aggOi: Agg
  marks: Map<number, MarkKind[]>
  scopeTag: string
  /** The strike window actually drawn, centred on spot. */
  rows: number[]
  /** The heat reference for the drawn window. */
  ref: number
  /** The largest |value| in the window, for the bars. */
  maxAbs: number
  cols: number[]
}

/**
 * One hook, one bundle.
 *
 * `aggOi` is not a duplicate. The stat cards have ALWAYS been the open-interest
 * board, and in VOLUME they keep being it: the map above is weighted by today's
 * volume while the tiles keep quoting the positions on the book. The VOLUME
 * switch stays lit, every tile is titled, and the legend says so. Collapsing
 * the two is how a ★ Volt gets quoted off the wrong basis, which is the one
 * mistake here that travels — a shared screenshot cannot scroll to the switch.
 */
export function useBoardDerived(
  board: BoardMap | null,
  scope: Scope,
  strikeCount: number,
  quiet: boolean,
  source: 'oi' | 'volume',
): Derived | null {
  return useMemo(() => {
    if (!board || !board.strikes.length) return null

    const agg = aggregate(board, scope)
    const aggOi =
      source === 'volume'
        ? aggregate({ ...board, cols: board.cols.map((c) => ({ ...c, cells: oiCells(c.cells) })) }, scope)
        : agg

    // The window: `strikeCount` strikes centred on spot, clamped to the board.
    const all = board.strikes
    let centre = 0
    if (board.spot > 0) {
      let best = Infinity
      all.forEach((k, i) => {
        const d = Math.abs(k - board.spot)
        if (d < best) {
          best = d
          centre = i
        }
      })
    } else {
      centre = Math.floor(all.length / 2)
    }
    const half = Math.floor(strikeCount / 2)
    const lo = Math.max(0, Math.min(centre - half, all.length - strikeCount))
    const rows = all.slice(Math.max(0, lo), Math.max(0, lo) + strikeCount)

    const shown: number[] = []
    for (const k of rows) shown.push(agg.byStrike.get(k) ?? 0)
    const ref = heatRef(shown)
    const maxAbs = shown.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

    return {
      agg,
      aggOi,
      marks: marksOf(agg),
      scopeTag: scopeTagOf(board, scope),
      rows: [...rows].reverse(), // high strikes at the top, like the board
      ref,
      maxAbs,
      cols: colsInScope(board, scope),
    }
    // `quiet` is read by the grid through cellStyle, not here — it is in the
    // dep list so a flip of the switch repaints rather than waiting for data.
  }, [board, scope, strikeCount, quiet, source])
}

/** The open-interest leg of a column, for `aggOi`. */
function oiCells(cells: Map<number, import('./types').BoardCell>) {
  const out = new Map<number, import('./types').BoardCell>()
  for (const [k, c] of cells) out.set(k, { ...c, v: c.oiNet })
  return out
}

/** Which side of the flip price is on, in the ribbon's own words. */
export function flipSideOf(flip: number | null, spot: number): 'above' | 'below' | null {
  if (flip == null || !(spot > 0)) return null
  return spot >= flip ? 'above' : 'below'
}

/** The distance line a tile prints under its strike. */
export function distText(k: number | null, spot: number): string | null {
  if (k == null || !(spot > 0)) return null
  const d = k - spot
  const pct = (d / spot) * 100
  const dir = d >= 0 ? 'above' : 'below'
  return `$${Math.abs(d).toFixed(2)} ${dir} · ${Math.abs(pct).toFixed(2)}%`
}
