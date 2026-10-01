// ─────────────────────────────────────────────────────────────────────────────
// INDEX CORE — SPX, SPY and QQQ's recorded CORE on one chart (2026-10-01).
//
// Lives INSIDE the Level Log card: when SPX is the page symbol the card grows a
// five-way switch (SPX · SPX-eq · % from spot · Lanes · Consensus), and the four
// merged views draw here. It reads the SAME recorder the wall-migration chart
// does — `useWallDays` once per ticker, same date, same 0DTE / non-0DTE scope,
// same OI+vol / vol-only basis, same range — so a merged view is three readings
// of one recorder, never a second source.
//
// CORE ONLY. The `cb` rows of each ticker's walls_log; the walls stay on the
// SPX tab. Forward-filled from the last written row exactly as the migration
// chart fills them, so every core is a STEP and never a slope.
//
// THE FOUR VIEWS — the three tickers trade on three price scales, and each view
// is one honest way of putting them on one chart:
//
//   eq     SPX-EQUIVALENT. SPY's and QQQ's cores multiplied into SPX points by
//          the price ratio AT EACH SESSION'S OPEN, so they stay steps inside a
//          session. QQQ is not SPX: its equivalent is "the same % from its open"
//          and drifts with relative strength, which the caption says.
//   dist   DISTANCE FROM SPOT. Each core as % above / below ITS OWN price. No
//          ratio at all; the zero line is price for all three. Tinted where all
//          three pull the same way.
//   lanes  THREE COLUMNS — SPX | SPY | QQQ side by side (2026-10-01; they
//          were stacked rows). Native strikes, each column its own y range and
//          the same clock, CORE + price, a dashed line at each of that
//          ticker's rolls. Three small charts read the way the rail does.
//   band   CONSENSUS. The SPX-equivalent cores as one band (narrow = agree) with
//          their average as the line, over a strip of which side of price each
//          core sits on, and an ALL row that lights only when they line up.
//
// The legend chips are switches, as on the migration chart: hiding a ticker
// takes it out of every view, including the band and the ALL row — so the band
// is always "the consensus of what is on screen".
//
// SVG, not canvas, drawn once per model change — same reasoning and the same
// paint rules as WallMigrationChart: <line>/<polyline>/<rect> only, every stroke
// non-scaling, every word HTML positioned by percentage so `fill` can stretch
// the plot without stretching type.
//
// Its own chunk: LevelLog.tsx lazy-loads it, and preloads it the moment SPX is
// the symbol, so nobody who never opens a merged view pays for it.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react'
import { LEVEL_COLORS, LIGHT_BLUE, T, VIOLET, alpha } from '@/design/theme'
import {
  DENSE_MIN_SAMPLES,
  type DaySlice,
  WALL_SLOTS,
  dowName,
  mdShort,
  slotAtMins,
  slotClock,
  wallNum,
  wallStrike,
} from '@/pages/levelLog/wallData'

export type MergedMode = 'eq' | 'dist' | 'lanes' | 'band'

export const MERGED_TICKERS = ['SPX', 'SPY', 'QQQ'] as const
export type MergedTicker = (typeof MERGED_TICKERS)[number]

/**
 * SPX keeps the CORE's own gold — on this page that colour already means "the
 * CORE", and SPX is the anchor. SPY and QQQ take the two hues no level line on
 * this page uses, so nothing here can be read as a wall.
 */
const TK_COLOR: Record<MergedTicker, string> = {
  SPX: LEVEL_COLORS.cb,
  SPY: LIGHT_BLUE,
  QQQ: VIOLET,
}

/** Same body height, breathing room and axis gutter as the migration chart. */
const PLOT_H = 250
const PAD = 8
const AXIS_W = 46

/** The consensus strip: one row per ticker plus ALL, in px (not scaled by fill). */
const STRIP_ROW = 9
const STRIP_GAP = 3

/** Each lane column's own price gutter, px — narrower than the full chart's. */
const LANE_AXIS_W = 40

const LEGEND_SWATCH = 11

type Pt = { s: number; v: number }

/** One ticker's session, reduced to what the four views need. */
type TkDay = {
  /** Forward-filled CORE strike per slot, null before the first write. */
  core: (number | null)[]
  /** The price line — the tape when there is one, the log's captures when not. */
  price: Pt[]
  lastSlot: number
}

/** One session across the three tickers. SPX is the anchor and always present. */
type Seg = {
  date: string
  lastSlot: number
  tk: Partial<Record<MergedTicker, TkDay>>
  /** Multiplier into SPX points, fixed at this session's open. SPX = 1. */
  ratio: Partial<Record<MergedTicker, number>>
}

const inSlot = (s: number) => Number.isFinite(s) && s >= 0 && s < WALL_SLOTS

/**
 * A day's CORE and price, by the migration chart's rules: forward fill from the
 * last written `cb` row; the session runs to the end of the TAPE, not the last
 * row (walls_log is change-only); the tape is drawn when it is denser than the
 * log's own spot captures, and never spliced with them.
 */
function toTkDay(day: DaySlice): TkDay | null {
  const rows = day.log
    .filter((r) => r.level_type === 'cb' && inSlot(r.slot) && Number.isFinite(Number(r.strike)))
    .sort((a, b) => a.slot - b.slot)

  let lastWrite = 0
  for (const r of rows) if (r.slot > lastWrite) lastWrite = r.slot

  const tape: Pt[] = day.price
    .map((p) => ({ s: slotAtMins(p.mins), v: p.px }))
    .filter((p) => Number.isFinite(p.s) && p.s >= 0 && p.s <= WALL_SLOTS - 1 && p.v > 0)
    .sort((a, b) => a.s - b.s)
  let tapeEnd = 0
  for (const p of tape) if (p.s > tapeEnd) tapeEnd = p.s
  const lastSlot = Math.min(WALL_SLOTS - 1, Math.max(lastWrite, Math.ceil(tapeEnd)))

  const capBySlot = new Map<number, number>()
  for (const r of day.log) {
    const sp = Number(r.spot)
    if (inSlot(r.slot) && sp > 0) capBySlot.set(r.slot, sp)
  }
  const caps: Pt[] = [...capBySlot.entries()].map(([s, v]) => ({ s, v })).sort((a, b) => a.s - b.s)
  const dense = tape.length >= DENSE_MIN_SAMPLES || (tape.length >= 2 && tape.length > caps.length)
  const price = (dense ? tape : caps).filter((p) => p.s <= lastSlot)

  if (!rows.length && !price.length) return null

  const core: (number | null)[] = new Array(WALL_SLOTS).fill(null)
  let cur: number | null = null
  let i = 0
  for (let s = 0; s <= lastSlot; s++) {
    for (;;) {
      const row = rows[i]
      if (!row || row.slot > s) break
      cur = Number(row.strike)
      i++
    }
    core[s] = cur
  }
  return { core, price, lastSlot }
}

/**
 * Price at slot `s`, for queries that only move FORWARD — the last sample at or
 * before it, else the first sample. One pass per series instead of a scan per
 * query, which is what keeps ALL TIME (260 sessions × 3) cheap.
 */
function cursor(price: Pt[]): (s: number) => number | null {
  let i = 0
  let cur: number | null = price[0]?.v ?? null
  return (s: number) => {
    for (;;) {
      const p = price[i]
      if (!p || p.s > s) break
      cur = p.v
      i++
    }
    return cur
  }
}

/** The core at a fractional slot — the step it sits under. */
const coreAt = (d: TkDay, s: number) => d.core[Math.max(0, Math.min(d.lastSlot, Math.floor(s)))] ?? null

/** Round ticks, at most ~`max` of them, for any range — points or percent. */
function niceTicks(lo: number, hi: number, max: number): number[] {
  const span = hi - lo
  if (!(span > 0)) return []
  const raw = span / max
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) ?? 10 * mag
  const out: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) out.push(Number(t.toFixed(6)))
  return out
}

const pct = (v: number, dp = 2) => `${v > 0 ? '+' : ''}${v.toFixed(dp)}%`

/** Lo/hi with 8% padding, widened around a flat series so it never divides by 0. */
function padRange(vals: number[], frac = 0.08): [number, number] | null {
  if (!vals.length) return null
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  if (!(hi > lo)) {
    const c = lo || 1
    lo = c * 0.999
    hi = c * 1.001
  }
  const p = (hi - lo) * frac
  return [lo - p, hi + p]
}

type Path = { key: string; d: string; color: string; w: number; dash?: string }
type Rect = { key: string; x: number; y: number; w: number; h: number; fill: string }
type Label = { key: string; top: string; text: string; color: string; left?: boolean }

export interface MergedCoreChartProps {
  days: Record<MergedTicker, DaySlice[]>
  mode: MergedMode
  /** Plot height in px, and the viewBox's y extent. */
  height?: number
  /** Stretch the plot to its container's height — what the card does expanded. */
  fill?: boolean
}

const MODE_HEAD: Record<MergedMode, string> = {
  eq: 'SPX-equivalent',
  dist: '% from spot',
  lanes: 'Lanes',
  band: 'Consensus',
}

export default function MergedCoreChart({ days, mode, height = PLOT_H, fill = false }: MergedCoreChartProps) {
  /** What the legend has switched OFF — so a ticker that lands late arrives on. */
  const [off, setOff] = useState<Set<MergedTicker | 'spot'>>(() => new Set())
  const toggle = (k: MergedTicker | 'spot') =>
    setOff((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  // ── the sessions, aligned by date on SPX ──────────────────────────────────
  const segs = useMemo<Seg[]>(() => {
    const byDate = (arr: DaySlice[]) => new Map(arr.map((d) => [d.date, d]))
    const maps: Record<MergedTicker, Map<string, DaySlice>> = {
      SPX: byDate(days.SPX),
      SPY: byDate(days.SPY),
      QQQ: byDate(days.QQQ),
    }
    const out: Seg[] = []
    for (const anchor of days.SPX) {
      const tk: Seg['tk'] = {}
      let lastSlot = 0
      for (const t of MERGED_TICKERS) {
        const d = maps[t].get(anchor.date)
        const td = d ? toTkDay(d) : null
        if (!td) continue
        tk[t] = td
        if (td.lastSlot > lastSlot) lastSlot = td.lastSlot
      }
      const spx = tk.SPX
      if (!spx) continue
      // Fixed at the OPEN, per session: the first price each ticker carries.
      const ratio: Seg['ratio'] = { SPX: 1 }
      const spxOpen = spx.price[0]?.v
      for (const t of ['SPY', 'QQQ'] as const) {
        const o = tk[t]?.price[0]?.v
        if (spxOpen && o) ratio[t] = spxOpen / o
      }
      out.push({ date: anchor.date, lastSlot, tk, ratio })
    }
    return out
  }, [days])

  const N = segs.length
  const last = segs[N - 1]
  if (!last) return null

  const on = (t: MergedTicker) => !off.has(t)
  const shown = MERGED_TICKERS.filter((t) => on(t) && segs.some((g) => g.tk[t]))
  const showSpot = !off.has('spot')

  const segW = 100 / N
  const x = (i: number, s: number) => {
    const seg = segs[i]
    const span = seg ? Math.max(1, seg.lastSlot) : 1
    return i * segW + (s / span) * segW
  }

  /** Step points for one run of a per-slot series, mapped through `y`. */
  const stepRuns = (i: number, arr: (number | null)[], y: (v: number) => number): string[] => {
    const seg = segs[i]
    if (!seg) return []
    const L = seg.lastSlot
    const out: string[] = []
    let s = 0
    while (s <= L) {
      if (arr[s] == null) {
        s++
        continue
      }
      const pts: string[] = []
      let prev: number | null = null
      while (s <= L) {
        const v = arr[s]
        if (v == null) break
        if (prev != null && v !== prev) pts.push(`${x(i, s)},${y(prev)}`)
        pts.push(`${x(i, s)},${y(v)}`)
        prev = v
        s++
      }
      // Hold the last value to the end of the session, as the level did.
      if (prev != null && s > L && L > 0) pts.push(`${x(i, L)},${y(prev)}`)
      if (pts.length) out.push(pts.join(' '))
    }
    return out
  }

  const linePts = (i: number, pts: Pt[], y: (v: number) => number) =>
    pts.map((p) => `${x(i, p.s)},${y(p.v)}`).join(' ')

  const yIn = (lo: number, hi: number, top: number, h: number) => (v: number) =>
    top + (1 - (v - lo) / (hi - lo)) * h

  /** Last CORE a ticker wrote across the span, and the session it was in. */
  const lastCore = (t: MergedTicker): { v: number; seg: Seg } | null => {
    for (let i = N - 1; i >= 0; i--) {
      const seg = segs[i]
      const d = seg?.tk[t]
      if (!seg || !d) continue
      for (let s = d.lastSlot; s >= 0; s--) {
        const v = d.core[s]
        if (v != null) return { v, seg }
      }
    }
    return null
  }
  const lastPx = (t: MergedTicker): number | null => {
    const d = last.tk[t]
    const p = d?.price[d.price.length - 1]
    return p ? p.v : null
  }

  const paths: Path[] = []
  const rects: Rect[] = []
  const axis: Label[] = []
  const inPlot: Label[] = []
  let strip: { rects: Rect[]; rows: Label[]; h: number } | null = null
  /** Lanes mode only: one self-contained column per ticker. */
  const lanes: Array<{ t: MergedTicker; paths: Path[]; axis: Label[]; core: number | null; spot: number | null }> = []
  let legend: Array<{ key: MergedTicker | 'spot' | 'x'; color: string; label: string; value: string; toggle: boolean }> = []
  let caption = ''

  const H = height
  const spxPrice = (i: number) => segs[i]?.tk.SPX?.price ?? []

  if (mode === 'eq' || mode === 'band') {
    // ── SPX POINTS ──────────────────────────────────────────────────────────
    const eqArr = (seg: Seg, t: MergedTicker): (number | null)[] | null => {
      const d = seg.tk[t]
      const r = seg.ratio[t]
      if (!d || r == null) return null
      return d.core.map((v) => (v == null ? null : v * r))
    }

    // The band's per-slot lo / hi / mean over the tickers on screen.
    const bandOf = (seg: Seg) => {
      const arrs = shown.map((t) => eqArr(seg, t)).filter((a): a is (number | null)[] => a != null)
      const lo: (number | null)[] = new Array(WALL_SLOTS).fill(null)
      const hi: (number | null)[] = new Array(WALL_SLOTS).fill(null)
      const mid: (number | null)[] = new Array(WALL_SLOTS).fill(null)
      for (let s = 0; s <= seg.lastSlot; s++) {
        const vs = arrs.map((a) => a[s]).filter((v): v is number => v != null)
        if (!vs.length) continue
        lo[s] = Math.min(...vs)
        hi[s] = Math.max(...vs)
        mid[s] = vs.reduce((a, b) => a + b, 0) / vs.length
      }
      return { lo, hi, mid }
    }
    const bands = mode === 'band' ? segs.map(bandOf) : []

    const vals: number[] = []
    segs.forEach((seg, i) => {
      if (mode === 'eq') {
        for (const t of shown) for (const v of eqArr(seg, t) ?? []) if (v != null) vals.push(v)
      } else {
        const b = bands[i]
        if (b) for (const arr of [b.lo, b.hi]) for (const v of arr) if (v != null) vals.push(v)
      }
      if (showSpot) for (const p of seg.tk.SPX?.price ?? []) vals.push(p.v)
    })
    const rng = padRange(vals)
    if (!rng) return null
    const [lo, hi] = rng
    const y = yIn(lo, hi, PAD, H - PAD * 2)

    if (mode === 'eq') {
      // QQQ first so SPX — the anchor — draws on top of a shared strike.
      for (const t of ['QQQ', 'SPY', 'SPX'] as const) {
        if (!shown.includes(t)) continue
        segs.forEach((seg, i) => {
          const arr = eqArr(seg, t)
          if (!arr) return
          stepRuns(i, arr, y).forEach((d, k) =>
            paths.push({ key: `${t}-${i}-${k}`, d, color: TK_COLOR[t], w: t === 'SPX' ? 2.2 : 1.8 }),
          )
        })
      }
      const ratioTag = (t: 'SPY' | 'QQQ') => {
        const r = last.ratio[t]
        return r ? `${t} ×${r.toFixed(2)}` : null
      }
      caption = [ratioTag('SPY'), ratioTag('QQQ')].filter(Boolean).join(' · ') + ' · fixed at each open'
      legend = MERGED_TICKERS.filter((t) => segs.some((g) => g.tk[t])).map((t) => {
        const lc = lastCore(t)
        const r = lc?.seg.ratio[t]
        const value = !lc ? '—' : t === 'SPX' || r == null ? wallStrike(lc.v) : `${wallStrike(lc.v)} → ${wallStrike(Math.round(lc.v * r))}`
        return { key: t, color: TK_COLOR[t], label: `${t} CORE`, value, toggle: true }
      })
    } else {
      segs.forEach((seg, i) => {
        const b = bands[i]
        if (!b) return
        for (let s = 0; s < seg.lastSlot; s++) {
          const a = b.hi[s]
          const z = b.lo[s]
          if (a == null || z == null) continue
          const top = y(a)
          rects.push({
            key: `band-${i}-${s}`,
            x: x(i, s),
            y: top,
            w: x(i, s + 1) - x(i, s),
            h: Math.max(1.5, y(z) - top),
            fill: alpha(LEVEL_COLORS.cb, 0.17),
          })
        }
        stepRuns(i, b.mid, y).forEach((d, k) =>
          paths.push({ key: `mid-${i}-${k}`, d, color: LEVEL_COLORS.cb, w: 2.2 }),
        )
      })

      // THE STRIP — which side of its own price each core sits on, per slot.
      const rows: Array<MergedTicker | 'ALL'> = [...shown, 'ALL']
      const stripRects: Rect[] = []
      const rowLabels: Label[] = []
      const stripH = rows.length * (STRIP_ROW + STRIP_GAP)
      rows.forEach((row, r) => {
        const top = r * (STRIP_ROW + STRIP_GAP)
        rowLabels.push({
          key: `row-${row}`,
          top: `${((top + STRIP_ROW / 2) / stripH) * 100}%`,
          text: row,
          color: row === 'ALL' ? T.text : TK_COLOR[row],
        })
        segs.forEach((seg, i) => {
          const curs = Object.fromEntries(
            shown.map((t) => [t, cursor(seg.tk[t]?.price ?? [])]),
          ) as Partial<Record<MergedTicker, (s: number) => number | null>>
          for (let s = 0; s < seg.lastSlot; s++) {
            const dOf = (t: MergedTicker): number | null => {
              const d = seg.tk[t]
              const c = d ? coreAt(d, s) : null
              const px = curs[t]?.(s + 0.5) ?? null
              return c != null && px != null && px > 0 ? ((c - px) / px) * 100 : null
            }
            let fillC: string
            if (row === 'ALL') {
              const signs = shown.map(dOf).filter((v): v is number => v != null).map(Math.sign)
              const agree = signs.length >= 2 && signs.every((v) => v === signs[0]) && signs[0] !== 0
              fillC = agree ? alpha(signs[0]! > 0 ? T.green : T.red, 0.85) : alpha(T.text, 0.08)
            } else {
              const dv = dOf(row)
              if (dv == null) continue
              fillC = alpha(dv > 0 ? T.green : T.red, Math.min(0.9, 0.18 + Math.abs(dv) * 1.6))
            }
            const x0 = x(i, s)
            const x1 = x(i, s + 1)
            stripRects.push({ key: `st-${row}-${i}-${s}`, x: x0, y: top, w: Math.max(0.05, (x1 - x0) * 0.86), h: STRIP_ROW, fill: fillC })
          }
        })
      })
      strip = { rects: stripRects, rows: rowLabels, h: stripH }

      const lb = bands[N - 1]
      let lastLo: number | null = null
      let lastHi: number | null = null
      let lastMid: number | null = null
      if (lb) {
        for (let s = last.lastSlot; s >= 0; s--) {
          if (lb.mid[s] != null) {
            lastLo = lb.lo[s] ?? null
            lastHi = lb.hi[s] ?? null
            lastMid = lb.mid[s] ?? null
            break
          }
        }
      }
      caption = `band = ${shown.join(' · ')} CORE in SPX points · strip = which side of price`
      legend = [
        {
          key: 'x',
          color: alpha(LEVEL_COLORS.cb, 0.45),
          label: 'core range',
          value: lastLo != null && lastHi != null ? `${wallStrike(Math.round(lastLo))}–${wallStrike(Math.round(lastHi))}` : '—',
          toggle: false,
        },
        { key: 'x', color: LEVEL_COLORS.cb, label: 'consensus', value: lastMid != null ? wallStrike(Math.round(lastMid * 4) / 4) : '—', toggle: false },
        ...MERGED_TICKERS.filter((t) => segs.some((g) => g.tk[t])).map((t) => ({
          key: t as MergedTicker,
          color: TK_COLOR[t],
          label: `${t} CORE`,
          value: wallStrike(lastCore(t)?.v),
          toggle: true,
        })),
      ]
    }

    if (showSpot) {
      segs.forEach((_, i) => {
        const d = linePts(i, spxPrice(i), y)
        if (d) paths.push({ key: `spot-${i}`, d, color: T.text, w: 1.5 })
      })
    }
    legend.push({ key: 'spot', color: T.text, label: 'SPX', value: wallNum(lastPx('SPX')), toggle: true })
    for (const t of niceTicks(lo, hi, 8)) axis.push({ key: `t-${t}`, top: `${(y(t) / H) * 100}%`, text: wallStrike(t), color: T.faint })
  } else if (mode === 'dist') {
    // ── % FROM EACH TICKER'S OWN PRICE ──────────────────────────────────────
    // One grid per session — SPX's own samples — so the three lines and the
    // agreement tint are computed at the same instants.
    const series: Array<Partial<Record<MergedTicker, Pt[]>> & { grid: number[] }> = segs.map((seg) => {
      const grid = (seg.tk.SPX?.price ?? []).map((p) => p.s)
      const out: Partial<Record<MergedTicker, Pt[]>> & { grid: number[] } = { grid }
      for (const t of shown) {
        const d = seg.tk[t]
        if (!d) continue
        const cur = cursor(d.price)
        const pts: Pt[] = []
        for (const s of grid) {
          if (s > d.lastSlot) break
          const c = coreAt(d, s)
          const px = cur(s)
          if (c != null && px != null && px > 0) pts.push({ s, v: ((c - px) / px) * 100 })
        }
        out[t] = pts
      }
      return out
    })
    const vals = series.flatMap((sr) => shown.flatMap((t) => (sr[t] ?? []).map((p) => p.v)))
    if (!vals.length) return null
    const m = Math.max(0.05, ...vals.map(Math.abs)) * 1.12
    const y = yIn(-m, m, PAD, H - PAD * 2)
    const y0 = y(0)

    // Tint where every ticker on screen sits the same side — merged into runs.
    series.forEach((sr, i) => {
      // Keyed by grid instant: a find() per point would be quadratic, and ALL
      // TIME is 260 sessions of it.
      const byS = Object.fromEntries(
        shown.map((t) => [t, new Map((sr[t] ?? []).map((p) => [p.s, p.v]))]),
      ) as Partial<Record<MergedTicker, Map<number, number>>>
      const at = (t: MergedTicker, s: number) => byS[t]?.get(s) ?? null
      let runStart: number | null = null
      let runSign = 0
      const flush = (end: number) => {
        if (runStart == null || runSign === 0) return
        const x0 = x(i, runStart)
        rects.push({
          key: `tint-${i}-${runStart}`,
          x: x0,
          y: runSign > 0 ? PAD : y0,
          w: Math.max(0.05, x(i, end) - x0),
          h: runSign > 0 ? y0 - PAD : H - PAD - y0,
          fill: alpha(runSign > 0 ? T.green : T.red, 0.08),
        })
      }
      for (let k = 0; k < sr.grid.length; k++) {
        const s = sr.grid[k]!
        const signs = shown.map((t) => at(t, s)).filter((v): v is number => v != null).map(Math.sign)
        const sg = signs.length >= 2 && signs.every((v) => v === signs[0]) ? (signs[0] ?? 0) : 0
        if (sg !== runSign) {
          flush(s)
          runStart = sg !== 0 ? s : null
          runSign = sg
        }
      }
      const tail = sr.grid[sr.grid.length - 1]
      if (tail != null) flush(tail)
    })

    paths.push({ key: 'zero', d: `0,${y0} 100,${y0}`, color: T.text, w: 1.4 })
    inPlot.push({ key: 'price', top: `${(y0 / H) * 100}%`, text: 'PRICE', color: T.text, left: true })
    for (const t of ['QQQ', 'SPY', 'SPX'] as const) {
      if (!shown.includes(t)) continue
      series.forEach((sr, i) => {
        const d = linePts(i, sr[t] ?? [], y)
        if (d) paths.push({ key: `${t}-${i}`, d, color: TK_COLOR[t], w: t === 'SPX' ? 2 : 1.6 })
      })
    }
    for (const t of niceTicks(-m, m, 8)) axis.push({ key: `t-${t}`, top: `${(y(t) / H) * 100}%`, text: pct(t, Math.abs(t) < 1 ? 2 : 1), color: T.faint })
    caption = 'core − price, each in its own price · tinted where all agree'
    const lastDist = (t: MergedTicker) => {
      const pts = series[N - 1]?.[t]
      const p = pts?.[pts.length - 1]
      return p ? pct(p.v) : '—'
    }
    legend = MERGED_TICKERS.filter((t) => segs.some((g) => g.tk[t])).map((t) => ({
      key: t,
      color: TK_COLOR[t],
      label: t,
      value: lastDist(t),
      toggle: true,
    }))
    legend.push({ key: 'x', color: alpha(T.green, 0.4), label: 'all same side', value: '', toggle: false })
  } else {
    // ── THREE COLUMNS, ONE CLOCK ────────────────────────────────────────────
    if (!shown.length) return null
    for (const t of shown) {
      const vals: number[] = []
      for (const seg of segs) {
        const d = seg.tk[t]
        if (!d) continue
        for (const v of d.core) if (v != null) vals.push(v)
        if (showSpot) for (const p of d.price) vals.push(p.v)
      }
      const rng = padRange(vals, 0.1)
      if (!rng) continue
      const [lo, hi] = rng
      const y = yIn(lo, hi, PAD, H - PAD * 2)
      const lp: Path[] = []
      const la: Label[] = []
      segs.forEach((seg, i) => {
        const d = seg.tk[t]
        if (!d) return
        // Rolls first, so the CORE and price draw over them.
        if (N <= 21) {
          for (let s = 1; s <= d.lastSlot; s++) {
            const a = d.core[s - 1]
            const b = d.core[s]
            if (a == null || b == null || a === b) continue
            const xx = x(i, s)
            lp.push({ key: `roll-${i}-${s}`, d: `${xx},0 ${xx},${H}`, color: alpha(TK_COLOR[t], 0.35), w: 1, dash: '2 3' })
          }
        }
        stepRuns(i, d.core, y).forEach((pp, k) => lp.push({ key: `core-${i}-${k}`, d: pp, color: TK_COLOR[t], w: 2.2 }))
        if (showSpot) {
          const pp = linePts(i, d.price, y)
          if (pp) lp.push({ key: `spot-${i}`, d: pp, color: T.text, w: 1.3 })
        }
      })
      for (const v of niceTicks(lo, hi, 6)) la.push({ key: `t-${v}`, top: `${(y(v) / H) * 100}%`, text: wallStrike(v), color: T.faint })
      const lc = lastCore(t)
      lanes.push({ t, paths: lp, axis: la, core: lc?.v ?? null, spot: lastPx(t) })
    }
    if (!lanes.length) return null
    caption = `native strikes, each its own scale${N <= 21 ? ' · dashed = a roll' : ''}`
    legend = MERGED_TICKERS.filter((t) => segs.some((g) => g.tk[t])).map((t) => ({
      key: t,
      color: TK_COLOR[t],
      label: t,
      value: '',
      toggle: true,
    }))
    legend.push({ key: 'spot', color: T.text, label: 'price', value: '', toggle: true })
  }

  // ── chrome ────────────────────────────────────────────────────────────────
  /**
   * Clock stamps for a single session: the open, then every `every` slots on the
   * hour. Hourly starts at 10:00 (slot 2); the narrow lane columns stamp every
   * two hours from 12:00 (slot 10), since 10:00 would sit on top of 09:29.
   */
  const clockStampsAt = (every: number) => {
    if (N !== 1) return []
    const out: number[] = [0]
    for (let sl = every >= 8 ? 10 : 2; sl <= last.lastSlot; sl += every) out.push(sl)
    const tail = out[out.length - 1]
    if (tail != null && last.lastSlot - tail >= every / 2) out.push(last.lastSlot)
    return out
  }
  const stampEveryFor = (maxStamps: number) => Math.max(1, Math.ceil(N / maxStamps))
  const stampEvery = stampEveryFor(10)
  const isStamped = (i: number, every = stampEvery) => (N - 1 - i) % every === 0
  const showDow = N <= 6
  const thinDividers = N > 40

  const chip = (
    k: MergedTicker | 'spot' | 'x',
    color: string,
    label: string,
    value: string,
    canToggle: boolean,
    idx: number,
  ) => {
    const isOn = k === 'x' || !off.has(k)
    const body = (
      <>
        <span
          aria-hidden
          className="block shrink-0 rounded-sm border"
          style={{
            width: LEGEND_SWATCH,
            height: LEGEND_SWATCH,
            boxSizing: 'border-box',
            background: isOn ? color : 'transparent',
            borderColor: color,
          }}
        />
        <span>{label}</span>
        {value ? <span className="tabular font-mono">{value}</span> : null}
      </>
    )
    if (!canToggle || k === 'x') {
      return (
        <span key={`${k}-${idx}`} className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-fg">
          {body}
        </span>
      )
    }
    return (
      <button
        key={`${k}-${idx}`}
        type="button"
        onClick={() => toggle(k)}
        aria-pressed={isOn}
        title={isOn ? `Hide ${label}` : `Show ${label}`}
        className={[
          'inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm text-xs transition-opacity',
          isOn ? 'text-fg' : 'text-muted opacity-40 hover:opacity-70',
        ].join(' ')}
      >
        {body}
      </button>
    )
  }

  const svgStyle = fill ? { width: '100%', height: '100%', display: 'block' } : { width: '100%', display: 'block' }

  /** One plot: session dividers, rects, polylines, then the words as HTML on top. */
  const plot = (pp: Path[], rr: Rect[], ax: Label[], words: Label[], axisW: number) => (
    <div className={fill ? 'relative min-h-0 flex-1' : 'relative'} style={{ paddingRight: axisW }}>
      <svg viewBox={`0 0 100 ${H}`} height={fill ? undefined : H} preserveAspectRatio="none" style={svgStyle}>
        {segs.slice(1).map((seg, k) =>
          thinDividers && !isStamped(k + 1) ? null : (
            <line
              key={`div-${seg.date}`}
              x1={(k + 1) * segW}
              x2={(k + 1) * segW}
              y1={0}
              y2={H}
              stroke={alpha(T.text, 0.22)}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ),
        )}
        {rr.map((r) => (
          <rect key={r.key} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
        ))}
        {pp.map((p) => (
          <polyline
            key={p.key}
            points={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth={p.w}
            strokeDasharray={p.dash}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="miter"
          />
        ))}
      </svg>

      {/* Words ride on top as HTML so `fill` never stretches them. */}
      <div className="pointer-events-none absolute inset-0" style={{ right: axisW }} aria-hidden>
        {words.map((l) => (
          <span
            key={l.key}
            className="tabular absolute whitespace-nowrap font-mono text-2xs font-extrabold"
            style={{ left: 4, top: l.top, transform: 'translateY(-100%)', color: l.color }}
          >
            {l.text}
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0" style={{ width: axisW }} aria-hidden>
        {ax.map((t) => (
          <span
            key={t.key}
            className="tabular absolute whitespace-nowrap font-mono text-2xs"
            style={{ left: 6, top: t.top, transform: 'translateY(-50%)', color: t.color }}
          >
            {t.text}
          </span>
        ))}
      </div>
    </div>
  )

  /** The time rail under a plot: clock stamps for one session, date stamps for many. */
  const rail = (axisW: number, clockEvery: number, maxDates: number) => {
    const stamps = clockStampsAt(clockEvery)
    const every = stampEveryFor(maxDates)
    return N === 1 ? (
      <div className="tabular relative mt-1 h-3 shrink-0 font-mono text-2xs text-muted" style={{ paddingRight: axisW }} aria-hidden>
        <div className="absolute inset-y-0 left-0" style={{ right: axisW }}>
          {stamps.map((sl, k) => {
            const first = k === 0
            const lastOne = k === stamps.length - 1
            return (
              <span
                key={`cs-${sl}`}
                className="absolute whitespace-nowrap"
                style={{ left: `${x(0, sl)}%`, transform: `translateX(${first ? '0' : lastOne ? '-100%' : '-50%'})` }}
              >
                {slotClock(sl)}
              </span>
            )
          })}
        </div>
      </div>
    ) : (
      <div className="mt-1 flex shrink-0 text-muted" style={{ paddingRight: axisW }} aria-hidden>
        {segs.map((seg, i) => (
          <span key={seg.date} className="block overflow-visible whitespace-nowrap text-center" style={{ flex: `0 0 ${segW}%` }}>
            {isStamped(i, every) ? (
              <>
                {showDow && maxDates >= 6 ? (
                  <span className="block text-2xs font-extrabold uppercase tracking-widest text-fg">{dowName(seg.date)}</span>
                ) : null}
                <span className="tabular block font-mono text-2xs">{mdShort(seg.date)}</span>
              </>
            ) : null}
          </span>
        ))}
      </div>
    )
  }

  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col' : 'flex flex-col'}>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-3">
        <span className="whitespace-nowrap text-xs font-extrabold uppercase tracking-widest text-fg">
          Index CORE · {MODE_HEAD[mode]}
        </span>
        <span className="tabular whitespace-nowrap font-mono text-xs text-muted">
          {N > 1 ? `${N} sessions · ` : ''}
          {caption}
        </span>
      </div>

      <div className="mb-1.5 flex flex-wrap items-center gap-3.5">
        {legend.map((l, idx) => chip(l.key, l.color, l.label, l.value, l.toggle, idx))}
      </div>

      {mode === 'lanes' ? (
        // THREE COLUMNS. Separated by a hairline, not plated — a column is part
        // of this chart, not a card of its own.
        <div
          className={fill ? 'grid min-h-0 flex-1' : 'grid'}
          style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(0, 1fr))` }}
        >
          {lanes.map((l, li) => (
            <div key={l.t} className={['flex min-h-0 min-w-0 flex-col', li > 0 ? 'border-l border-line pl-3' : '', li < lanes.length - 1 ? 'pr-3' : ''].join(' ')}>
              <div className="mb-1 flex shrink-0 items-baseline gap-2">
                <span className="text-sm font-extrabold tracking-wide" style={{ color: TK_COLOR[l.t] }}>
                  {l.t}
                </span>
                <span className="tabular font-mono text-xs text-fg">
                  CORE <span style={{ color: TK_COLOR[l.t] }}>{wallStrike(l.core)}</span>
                </span>
                {showSpot && l.spot != null ? (
                  <span className="tabular ml-auto font-mono text-xs text-muted">{wallNum(l.spot)}</span>
                ) : null}
              </div>
              {plot(l.paths, [], l.axis, [], LANE_AXIS_W)}
              {rail(LANE_AXIS_W, 8, 4)}
            </div>
          ))}
        </div>
      ) : (
        <>
          {plot(paths, rects, axis, inPlot, AXIS_W)}

          {strip ? (
            <div className="relative mt-1.5 shrink-0" style={{ paddingRight: AXIS_W, height: strip.h }}>
              <svg viewBox={`0 0 100 ${strip.h}`} height={strip.h} preserveAspectRatio="none" style={{ width: '100%', display: 'block' }}>
                {strip.rects.map((r) => (
                  <rect key={r.key} x={r.x} y={r.y} width={r.w} height={r.h} rx={0} fill={r.fill} />
                ))}
              </svg>
              <div className="pointer-events-none absolute inset-y-0 right-0" style={{ width: AXIS_W }} aria-hidden>
                {strip.rows.map((r) => (
                  <span
                    key={r.key}
                    className="absolute whitespace-nowrap text-3xs font-extrabold"
                    style={{ left: 8, top: r.top, transform: 'translateY(-50%)', color: r.color }}
                  >
                    {r.text}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {rail(AXIS_W, 4, 10)}
        </>
      )}
    </div>
  )
}
