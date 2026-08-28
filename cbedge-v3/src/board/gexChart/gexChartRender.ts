// ─────────────────────────────────────────────────────────────────────────────
// GEX Chart — the live net-gamma ladder, drawn on a plain canvas.
//
// v2's GexChart.tsx is 60KB and this card's chunk shares a 78kb brotli budget
// with everything else lazy on the board, so this is the CORE of that chart and
// nothing else: diverging bars by strike, the spot line, the call wall, the put
// wall and the gamma flip. No options overlay, no expiry picker, no zoom, no
// replay. Those are each their own feature and can arrive one at a time.
//
// ── Why canvas and not DOM ───────────────────────────────────────────────────
// A hundred-odd strikes, each with a bar, a strike label and a value label, is
// three hundred nodes re-laid-out every time a frame lands. The whole picture is
// one fillRect per strike and two fillTexts, so it is drawn, not built.
//
// Colours come from CSS custom properties read off the canvas element at draw
// time — the "no colour literal in src/" rule, enforced at runtime because a
// <canvas> cannot take a className for its pixels. The fallbacks exist only for
// the frame before the stylesheet applies and must never diverge from
// tokens.css.
// ─────────────────────────────────────────────────────────────────────────────

import { sizeCanvas } from '../chart-render'

/**
 * Which way the BARS run.
 *
 *   horizontal  strikes down the left edge, bars growing left/right from a
 *               centre line. The classic GEX ladder, and the one that reads
 *               against a price axis.
 *   vertical    strikes along the bottom, bars growing up/down. Reads as a
 *               gamma profile across the strike range.
 */
export type GexOrientation = 'horizontal' | 'vertical'

export interface GexBar {
  strike: number
  value: number
}

export interface GexChartModel {
  /** Sorted ascending by strike. */
  bars: GexBar[]
  spot: number | null
  callWall: number | null
  putWall: number | null
  flip: number | null
}

export interface GexChartOpts extends GexChartModel {
  orientation: GexOrientation
}

/** Gutter for the strike labels, px. */
const STRIKE_GUTTER = 48
/** Gutter for the value labels, px (horizontal orientation only). */
const VALUE_GUTTER = 54
/** Gutter under the strike labels in the vertical orientation, px. */
const BOTTOM_GUTTER = 16
const PAD = 6
/** A bar never gets fatter than this, however few strikes there are. */
const MAX_BAR_PX = 16

function cssVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

/** `+1.2B` / `−340M`. Compact — these labels sit in a 54px gutter. */
export function fmtGexShort(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '—'
  const abs = Math.abs(v)
  const sign = v > 0 ? '+' : '−'
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(0)}M`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}K`
  return `${sign}${abs.toFixed(0)}`
}

function fmtStrike(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(2)
}

/**
 * Text on an opaque chip.
 *
 * Every label on this chart can land on a bar, a dashed rule or another label —
 * the spot price and the gamma flip sit on the same strike more often than not.
 * A chip is what keeps both readable without inventing a layout that reserves
 * space for a collision that usually is not there.
 */
function chipText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  colour: string,
  bg: string,
  align: CanvasTextAlign,
): void {
  const w = ctx.measureText(text).width
  const padX = 3
  const h = 11
  const left = align === 'right' ? x - w - padX : align === 'center' ? x - w / 2 - padX : x - padX
  ctx.fillStyle = bg
  ctx.fillRect(left, y - h / 2, w + padX * 2, h)
  ctx.fillStyle = colour
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
}

interface Palette {
  pos: string
  neg: string
  fg: string
  muted: string
  line: string
  surface: string
  cw: string
  pw: string
  flip: string
}

function palette(el: HTMLElement): Palette {
  return {
    pos: cssVar(el, '--color-gex-pos', '#29b6f6'),
    neg: cssVar(el, '--color-gex-neg', '#ff4757'),
    fg: cssVar(el, '--color-fg', '#ffffff'),
    muted: cssVar(el, '--color-muted', '#8a9ab8'),
    line: cssVar(el, '--color-line', '#23272e'),
    surface: cssVar(el, '--color-surface', '#0f1117'),
    cw: cssVar(el, '--color-level-cw', '#29b6f6'),
    pw: cssVar(el, '--color-level-pw', '#ff4757'),
    flip: cssVar(el, '--color-accent', '#5b8cff'),
  }
}

/**
 * Where a price sits along the ladder, as a continuous index into `bars`.
 *
 * Interpolated between the two strikes that bracket it rather than snapped to
 * the nearest rung: with a 5-point strike grid, snapping puts the spot line up
 * to 2.5 points away from the price it is labelled with, which is the difference
 * between "6,795, roughly" and "6,796.4, leaning on 6,795".
 */
function indexOfPrice(bars: GexBar[], price: number): number | null {
  const n = bars.length
  if (n === 0 || !(price > 0)) return null
  const first = bars[0]
  const last = bars[n - 1]
  if (!first || !last) return null
  if (price <= first.strike) return 0
  if (price >= last.strike) return n - 1
  for (let i = 1; i < n; i++) {
    const hi = bars[i]
    const lo = bars[i - 1]
    if (!hi || !lo) continue
    if (hi.strike >= price) {
      const span = hi.strike - lo.strike
      return span === 0 ? i - 1 : i - 1 + (price - lo.strike) / span
    }
  }
  return n - 1
}

/** How many labels can be drawn without them colliding, given the step. */
function labelStride(step: number, need: number): number {
  return Math.max(1, Math.ceil(need / Math.max(1, step)))
}

export function drawGexChart(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  opts: GexChartOpts,
): void {
  const ctx = sizeCanvas(canvas, width, height)
  if (!ctx) return
  ctx.clearRect(0, 0, width, height)

  const { bars, orientation } = opts
  if (!bars.length || width <= 0 || height <= 0) return

  const p = palette(canvas)
  let maxAbs = 0
  for (const b of bars) maxAbs = Math.max(maxAbs, Math.abs(b.value))
  if (maxAbs <= 0) return

  // ── Marks, drawn as a set so a strike that is two levels at once (a wall on
  // the flip, say) gets both ticks rather than whichever was checked last.
  const marks: Array<{ price: number; colour: string; label: string }> = []
  if (opts.putWall != null) marks.push({ price: opts.putWall, colour: p.pw, label: 'PW' })
  if (opts.callWall != null) marks.push({ price: opts.callWall, colour: p.cw, label: 'CW' })
  if (opts.flip != null) marks.push({ price: opts.flip, colour: p.flip, label: 'FLIP' })

  if (orientation === 'horizontal') {
    drawHorizontal(ctx, canvas, width, height, opts, p, maxAbs, marks)
  } else {
    drawVertical(ctx, canvas, width, height, opts, p, maxAbs, marks)
  }
}

// ── Strikes down the left, bars running left/right ───────────────────────────

function drawHorizontal(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  opts: GexChartOpts,
  p: Palette,
  maxAbs: number,
  marks: Array<{ price: number; colour: string; label: string }>,
): void {
  const { bars } = opts
  const n = bars.length
  const plotL = STRIKE_GUTTER
  const plotR = width - VALUE_GUTTER
  const plotW = Math.max(1, plotR - plotL)
  const plotT = PAD
  const plotH = Math.max(1, height - PAD * 2)
  const mid = plotL + plotW / 2
  const half = plotW / 2 - 2

  const step = plotH / n
  const barH = Math.min(MAX_BAR_PX, Math.max(1, step * 0.72))

  // Strikes run ascending in the data and are drawn HIGH AT THE TOP, which is
  // how a price ladder is read everywhere else in the product.
  const yOf = (idx: number) => plotT + (n - 1 - idx) * step + step / 2

  ctx.strokeStyle = p.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(mid, plotT)
  ctx.lineTo(mid, plotT + plotH)
  ctx.stroke()

  const font = cssVar(canvas, '--font-mono', 'ui-monospace, monospace')
  const stride = labelStride(step, 11)

  ctx.textBaseline = 'middle'
  bars.forEach((b, i) => {
    const y = yOf(i)
    const len = (Math.abs(b.value) / maxAbs) * half
    ctx.fillStyle = b.value >= 0 ? p.pos : p.neg
    if (b.value >= 0) ctx.fillRect(mid, y - barH / 2, len, barH)
    else ctx.fillRect(mid - len, y - barH / 2, len, barH)

    if (i % stride !== 0) return
    ctx.font = `600 10px ${font}`
    ctx.textAlign = 'right'
    ctx.fillStyle = p.muted
    ctx.fillText(fmtStrike(b.strike), STRIKE_GUTTER - 6, y)
    ctx.textAlign = 'left'
    ctx.fillStyle = b.value >= 0 ? p.pos : p.neg
    ctx.fillText(fmtGexShort(b.value), plotR + 5, y)
  })

  // Levels, then spot last so the price is never painted over by a wall.
  for (const m of marks) {
    const idx = indexOfPrice(bars, m.price)
    if (idx == null) continue
    const y = yOf(idx)
    ctx.strokeStyle = m.colour
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(plotL, y)
    ctx.lineTo(plotR, y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.font = `800 8px ${font}`
    chipText(ctx, m.label, plotL + 3, y - 7, m.colour, p.surface, 'left')
  }

  // Spot LAST and in the strike gutter, not out at the right edge: the right
  // gutter is a column of value labels and the price landed on top of one of
  // them. The gutter is where a price belongs anyway — it is the axis.
  if (opts.spot != null) {
    const idx = indexOfPrice(bars, opts.spot)
    if (idx != null) {
      const y = yOf(idx)
      ctx.strokeStyle = p.fg
      ctx.lineWidth = 1
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.font = `800 9px ${font}`
      chipText(ctx, opts.spot.toFixed(2), STRIKE_GUTTER - 4, y, p.fg, p.surface, 'right')
    }
  }
}

// ── Strikes along the bottom, bars running up/down ───────────────────────────

function drawVertical(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  opts: GexChartOpts,
  p: Palette,
  maxAbs: number,
  marks: Array<{ price: number; colour: string; label: string }>,
): void {
  const { bars } = opts
  const n = bars.length
  const plotL = PAD
  const plotW = Math.max(1, width - PAD * 2)
  const plotT = PAD
  const plotH = Math.max(1, height - PAD - BOTTOM_GUTTER)
  const mid = plotT + plotH / 2
  const half = plotH / 2 - 2

  const step = plotW / n
  const barW = Math.min(MAX_BAR_PX, Math.max(1, step * 0.72))
  const xOf = (idx: number) => plotL + idx * step + step / 2

  ctx.strokeStyle = p.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(plotL, mid)
  ctx.lineTo(plotL + plotW, mid)
  ctx.stroke()

  const font = cssVar(canvas, '--font-mono', 'ui-monospace, monospace')
  // Strike labels are ~40px wide here rather than ~11px tall, so the stride
  // that keeps them apart is a different number from the horizontal case.
  const stride = labelStride(step, 46)

  bars.forEach((b, i) => {
    const x = xOf(i)
    const len = (Math.abs(b.value) / maxAbs) * half
    ctx.fillStyle = b.value >= 0 ? p.pos : p.neg
    if (b.value >= 0) ctx.fillRect(x - barW / 2, mid - len, barW, len)
    else ctx.fillRect(x - barW / 2, mid, barW, len)

    if (i % stride !== 0) return
    ctx.font = `600 9px ${font}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = p.muted
    ctx.fillText(fmtStrike(b.strike), x, plotT + plotH + 3)
  })

  for (const m of marks) {
    const idx = indexOfPrice(bars, m.price)
    if (idx == null) continue
    const x = xOf(idx)
    ctx.strokeStyle = m.colour
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(x, plotT)
    ctx.lineTo(x, plotT + plotH)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.font = `800 8px ${font}`
    chipText(ctx, m.label, x, plotT + 6, m.colour, p.surface, 'center')
  }

  // Spot's price goes in the BOTTOM gutter, at the far end from the level tags.
  // Stacked at the top they overlapped every time the flip and the price were
  // near each other, which is most of the time.
  if (opts.spot != null) {
    const idx = indexOfPrice(bars, opts.spot)
    if (idx != null) {
      const x = xOf(idx)
      ctx.strokeStyle = p.fg
      ctx.lineWidth = 1
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.moveTo(x, plotT)
      ctx.lineTo(x, plotT + plotH)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.font = `800 9px ${font}`
      chipText(ctx, opts.spot.toFixed(2), x, plotT + plotH + 8, p.fg, p.surface, 'center')
    }
  }
}
