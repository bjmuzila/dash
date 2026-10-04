// ─────────────────────────────────────────────────────────────────────────────
// CB GEX HEATMAP: the per-minute GEX ladders, painted behind the candles.
//
// Every recorded minute of the session is a column. Every strike in it is a
// cell from that minute to the next, its height one strike step centred on the
// strike, coloured by sign (--color-gex-pos / --color-gex-neg) and shaded by
// size. You can see where gamma built, moved and faded while price traded
// through it. Same history the GEX Candles bubbles and the GEX Rail read
// (studies/ladder.ts).
//
// SHADING. The brightest step is the 97th percentile of |GEX| across what is
// drawn, not the single biggest cell, so one outlier minute cannot wash the
// rest out. Cells under the "Hide cells under %" cut are not drawn.
//
// FAST ENOUGH TO PAN. Shades are quantised into 10 steps and consecutive
// minutes of one strike with the same step merge into one rectangle, worked out
// once per ladder (not per frame). A frame then draws a few thousand
// rectangles, grouped by colour, and skips any that are off screen.
//
// PLACEMENT. Time sits inside each candle the way the whale bubbles do (open at
// its left edge, close at its right), so minutes line up with the candles at any
// timeframe. Minutes outside the chart's bars (pre-market on a regular-hours
// chart) fold into the gap between sessions. ES / NQ draw SPX / NDX gamma
// shifted by each session's basis.
//
// BEHIND THE CANDLES: the page sends this study to the back of the stack when
// it is added (studyOrder.ts). The object tree can still move it.
//
// REPLAY: columns stop at the replay clock. Hover shows the strike, its GEX and
// the minute under the pointer.
// ─────────────────────────────────────────────────────────────────────────────

import type { OHLCV } from '@luxalgo/vela'
import type { RendererLayerArgs, RendererLayerInstance } from '@luxalgo/vela/plugin'
import { tokenRgb, type RGB } from '@/design/theme'
import { int, provideLayer, str, studyImpl, type StudyCtx } from './common'
import { GEX_BASIS, HEAT_SESSIONS, HEAT_TYPE } from './index'
import { columnsUntil, ladderKey, loadLadder, sessionDates, type Ladder } from './ladder'

const STEPS = 10

interface HeatS {
  metric: 'net' | 'oi' | 'vol'
  sessions: number
  opacity: number
  cut: number
}

/** One merged rectangle: one strike, a run of minutes with the same shade. */
interface Run {
  t0: number
  t1: number
  price: number
  strike: number
  /** 1..STEPS */
  lvl: number
  pos: boolean
  /** The run's largest |value| (for the hover readout). */
  v: number
}

export interface HeatPayload {
  runs: Run[]
  /** Price height of one cell. */
  step: number
  opacity: number
  label: string
}

const valueOf = (net: number, netVol: number, m: HeatS['metric']) => (m === 'vol' ? netVol : m === 'oi' ? net - netVol : net)

function build(lad: Ladder, s: HeatS, until: number): HeatPayload {
  const cols = columnsUntil(lad.columns, until)
  // the strike step: the smallest gap in the newest column
  let step = Infinity
  const last = cols[cols.length - 1]
  if (last) {
    const ks = last.cells.map((c) => c.strike).sort((a, b) => a - b)
    for (let i = 1; i < ks.length; i++) if (ks[i]! - ks[i - 1]! > 0) step = Math.min(step, ks[i]! - ks[i - 1]!)
  }
  if (!Number.isFinite(step)) step = 1
  // robust max
  const mags: number[] = []
  for (const c of cols) for (const x of c.cells) mags.push(Math.abs(valueOf(x.net, x.netVol, s.metric)))
  if (!mags.length) return { runs: [], step, opacity: s.opacity, label: lad.label }
  mags.sort((a, b) => a - b)
  const top = mags[Math.min(mags.length - 1, Math.floor(mags.length * 0.97))] || mags[mags.length - 1] || 1
  const cut = top * s.cut
  // runs per strike
  const open = new Map<number, Run>()
  const runs: Run[] = []
  for (let k = 0; k < cols.length; k++) {
    const c = cols[k]!
    const next = cols[k + 1]
    // a column lasts until the next one, or a minute (the last, or across a gap)
    const end = next && next.slotTs - c.slotTs <= 5 * 60_000 ? next.slotTs : c.slotTs + 60_000
    const shift = lad.shift(c.slotTs)
    const seen = new Set<number>()
    if (shift != null) {
      for (const x of c.cells) {
        const v = valueOf(x.net, x.netVol, s.metric)
        const a = Math.abs(v)
        if (a < cut || a === 0) continue
        const lvl = Math.max(1, Math.min(STEPS, Math.ceil((Math.min(a, top) / top) * STEPS)))
        const pos = v >= 0
        const price = x.strike + shift
        seen.add(x.strike)
        const r = open.get(x.strike)
        if (r && r.lvl === lvl && r.pos === pos && r.t1 === c.slotTs && r.price === price) {
          r.t1 = end
          if (a > r.v) r.v = a
        } else {
          const nr: Run = { t0: c.slotTs, t1: end, price, strike: x.strike, lvl, pos, v: a }
          runs.push(nr)
          open.set(x.strike, nr)
        }
      }
    }
    for (const kk of [...open.keys()]) if (!seen.has(kk)) open.delete(kk)
  }
  return { runs, step, opacity: s.opacity, label: lad.label }
}

const memo = new WeakMap<Ladder, { key: string; out: HeatPayload }>()

export const heatImpl = studyImpl<HeatS, Ladder>({
  settings: (i) => {
    const b = str(i.basis, GEX_BASIS[0])
    return {
      metric: b === GEX_BASIS[2] ? 'vol' : b === GEX_BASIS[1] ? 'oi' : 'net',
      sessions: Math.max(1, (HEAT_SESSIONS as readonly string[]).indexOf(str(i.sessions, HEAT_SESSIONS[0])) + 1),
      opacity: int(i.opacity, 55, 10, 95) / 100,
      cut: int(i.cut, 8, 0, 50) / 100,
    }
  },
  dataKey: (c, s) => `${ladderKey(c)}|${sessionDates(c, s.sessions).join(',')}`,
  load: (c, s, fresh) => loadLadder(c, sessionDates(c, s.sessions), fresh),
  refreshMs: 60_000,
  everyTick: true,
  render: () => ({}),
  layer: (c: StudyCtx, s, lad): HeatPayload | null => {
    if (!lad || !lad.columns.length) return null
    // rebuilt when the ladder, the settings or (in a replay) the clock's minute change
    const key = `${s.metric}|${s.cut}|${s.opacity}|${Number.isFinite(c.until) ? Math.floor(c.until / 60_000) : 'live'}`
    const hit = memo.get(lad)
    if (hit && hit.key === key) return hit.out
    const out = build(lad, s, c.until)
    memo.set(lad, { key, out })
    return out
  },
})

// ── Painting ─────────────────────────────────────────────────────────────────

const hb = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
const hexA = (c: RGB, a: number) => `#${hb(c[0])}${hb(c[1])}${hb(c[2])}${hb(Math.max(0, Math.min(1, a)) * 255)}`

const MIN_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false })

function fmt(v: number, pos: boolean): string {
  const a = Math.abs(v)
  const sgn = pos ? '+' : '−'
  if (a >= 1e9) return `${sgn}${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sgn}${(a / 1e6).toFixed(0)}M`
  return `${sgn}${(a / 1e3).toFixed(0)}K`
}

/** x of a moment: inside its candle by time (see whaleLayer.ts xAt). */
function xAt(t: number, bars: readonly OHLCV[], tf: number, coords: RendererLayerArgs['coords']): number {
  const n = bars.length
  if (!n) return NaN
  if (t <= bars[0]!.time) return coords.logicalToX(-0.5)
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bars[mid]!.time <= t) lo = mid
    else hi = mid - 1
  }
  const frac = Math.max(0, Math.min(1, (t - bars[lo]!.time) / (tf || 1)))
  return coords.logicalToX(lo - 0.5 + frac)
}

function isPayload(v: unknown): v is HeatPayload {
  return !!v && typeof v === 'object' && Array.isArray((v as HeatPayload).runs)
}

class HeatLayer implements RendererLayerInstance {
  private canvas: HTMLCanvasElement | null = null

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
  }

  render(args: RendererLayerArgs): void {
    const canvas = this.canvas
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, canvas.width, canvas.height)
    const d = args.data
    if (!isPayload(d) || !d.runs.length) return
    const { coords, scale, bounds, bars, cursor } = args
    if (!bars.length) return
    const dpr = coords.dpr || 1
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.save()
    g.beginPath()
    g.rect(0, bounds.top, coords.width, bounds.height)
    g.clip()
    const tf = coords.barInterval || (bars.length > 1 ? bars[1]!.time - bars[0]!.time : 60_000)
    // visible time window, with a bar of slack each side
    const tLeft = bars[Math.max(0, Math.floor(coords.xToLogical(0)) - 1)]?.time ?? bars[0]!.time
    const half = d.step / 2
    const pos = tokenRgb('--color-gex-pos')
    const neg = tokenRgb('--color-gex-neg')
    // grouped by colour: one fillStyle per group
    const groups = new Map<string, number[]>()
    let hover: Run | null = null
    for (let i = 0; i < d.runs.length; i++) {
      const r = d.runs[i]!
      if (r.t1 < tLeft) continue
      const x0 = xAt(r.t0, bars, tf, coords)
      const x1 = xAt(r.t1, bars, tf, coords)
      if (!(x1 > 0) || x0 > coords.width || x1 - x0 < 0.25) continue
      const y0 = coords.priceToY(r.price + half, scale, bounds)
      const y1 = coords.priceToY(r.price - half, scale, bounds)
      if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue
      const key = `${r.pos ? 1 : 0}${r.lvl}`
      let list = groups.get(key)
      if (!list) groups.set(key, (list = []))
      list.push(x0, Math.min(y0, y1), x1 - x0, Math.max(1, Math.abs(y1 - y0)))
      if (cursor && cursor.x >= x0 && cursor.x < x1 && cursor.y >= Math.min(y0, y1) && cursor.y < Math.max(y0, y1)) hover = r
    }
    for (const [key, list] of groups) {
      const lvl = Number(key.slice(1))
      const rgb = key[0] === '1' ? pos : neg
      // sqrt keeps the low steps visible; the top step is the opacity setting
      g.fillStyle = hexA(rgb, d.opacity * Math.sqrt(lvl / STEPS))
      for (let k = 0; k < list.length; k += 4) g.fillRect(list[k]!, list[k + 1]!, list[k + 2]!, list[k + 3]!)
    }
    g.restore()
    if (hover && cursor) {
      const text = `${d.label} ${hover.strike} · ${fmt(hover.v, hover.pos)} · ${MIN_FMT.format(new Date(hover.t0))}`
      g.font = `600 10px ${getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace'}`
      const w = g.measureText(text).width + 10
      let x = cursor.x + 12
      if (x + w > coords.width - 4) x = cursor.x - 12 - w
      const y = Math.max(bounds.top + 4, cursor.y - 22)
      g.fillStyle = hexA(tokenRgb('--color-vt-panel'), 0.98)
      g.strokeStyle = hexA(tokenRgb('--color-line'), 1)
      g.lineWidth = 1
      g.beginPath()
      g.roundRect(x, y, w, 17, 6)
      g.fill()
      g.stroke()
      g.fillStyle = hexA(tokenRgb('--color-fg'), 1)
      g.textBaseline = 'middle'
      g.textAlign = 'left'
      g.fillText(text, x + 5, y + 9)
    }
  }

  destroy(): void {
    this.canvas = null
  }
}

provideLayer(HEAT_TYPE, () => new HeatLayer())
