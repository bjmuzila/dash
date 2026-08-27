// ─────────────────────────────────────────────────────────────────────────────
// Minimal imperative canvas renderers — candles, bars, a line.
//
// No chart library: v3 has none installed, and picking one blind (this repo's
// build/typecheck could not be run while this was written — see AGENTS.md's
// verification note) is a worse risk than forty lines of canvas 2D. Every
// function here is pure — (ctx, size, data) in, pixels out — so swapping in a
// real chart library later means replacing the call site inside a card's
// ChartFrame onMount/watchFrame, not touching the cards themselves.
//
// All colours are read from CSS custom properties at draw time (getComputedStyle
// on the canvas's own element), never hardcoded — same "no colour literal"
// rule as everywhere else, just enforced at runtime instead of by the Tailwind
// build since <canvas> can't take a className for its pixels.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useRef } from 'react'
import type { ChartHandle } from '@/design/primitives/ChartFrame'

/**
 * Wires a ChartFrame to a plain <canvas> this hook creates and owns. Returns
 * `onMount`/`onResize` to spread onto <ChartFrame>, and `setDraw` to install
 * the render function — call `setDraw` again whenever the data to paint
 * changes (a REST refetch) or, for a live topic, from inside a `watchFrame`
 * callback so the tick never goes through React state on its way to the
 * canvas (AGENTS.md rule 4).
 */
export function useCanvasRenderer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const drawRef = useRef<((canvas: HTMLCanvasElement, w: number, h: number) => void) | null>(null)

  const onMount = useCallback((handle: ChartHandle): (() => void) => {
    const canvas = document.createElement('canvas')
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    handle.el.appendChild(canvas)
    canvasRef.current = canvas
    sizeRef.current = { w: handle.width, h: handle.height }
    drawRef.current?.(canvas, handle.width, handle.height)
    return () => {
      canvas.remove()
      canvasRef.current = null
    }
  }, [])

  const onResize = useCallback((w: number, h: number) => {
    sizeRef.current = { w, h }
    if (canvasRef.current) drawRef.current?.(canvasRef.current, w, h)
  }, [])

  const setDraw = useCallback((fn: (canvas: HTMLCanvasElement, w: number, h: number) => void) => {
    drawRef.current = fn
    if (canvasRef.current) fn(canvasRef.current, sizeRef.current.w, sizeRef.current.h)
  }, [])

  return { onMount, onResize, setDraw }
}

export interface Candle {
  t: number // ms epoch
  o: number
  h: number
  l: number
  c: number
}

function cssVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

function clear(ctx: CanvasRenderingContext2D, w: number, h: number, bg: string) {
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
}

/** Fit the canvas backing store to its CSS size at the current device pixel ratio. */
export function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(width * dpr))
  canvas.height = Math.max(1, Math.round(height * dpr))
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

export function drawCandles(canvas: HTMLCanvasElement, width: number, height: number, candles: Candle[]): void {
  const ctx = sizeCanvas(canvas, width, height)
  if (!ctx) return
  const line = cssVar(canvas, '--color-line', '#23272e')
  const up = cssVar(canvas, '--color-up', cssVar(canvas, '--color-accent', '#5b8cff'))
  const down = cssVar(canvas, '--color-down', '#e0645f')
  clear(ctx, width, height, 'transparent')

  if (candles.length === 0) return
  const padL = 4
  const padR = 4
  const padTop = 6
  const padBottom = 6
  const plotW = Math.max(1, width - padL - padR)
  const plotH = Math.max(1, height - padTop - padBottom)

  let min = Infinity
  let max = -Infinity
  for (const c of candles) {
    if (c.l < min) min = c.l
    if (c.h > max) max = c.h
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    min -= 1
    max += 1
  }
  const y = (v: number) => padTop + (1 - (v - min) / (max - min)) * plotH

  const n = candles.length
  const step = plotW / n
  const bodyW = Math.max(1, step * 0.6)

  // Faint horizontal grid.
  ctx.strokeStyle = line
  ctx.globalAlpha = 0.5
  ctx.lineWidth = 1
  for (let g = 0; g <= 3; g++) {
    const gy = padTop + (g / 3) * plotH
    ctx.beginPath()
    ctx.moveTo(0, gy)
    ctx.lineTo(width, gy)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  candles.forEach((c, i) => {
    const cx = padL + i * step + step / 2
    const rising = c.c >= c.o
    ctx.strokeStyle = rising ? up : down
    ctx.fillStyle = rising ? up : down
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx, y(c.h))
    ctx.lineTo(cx, y(c.l))
    ctx.stroke()
    const yTop = y(Math.max(c.o, c.c))
    const yBot = y(Math.min(c.o, c.c))
    ctx.fillRect(cx - bodyW / 2, yTop, bodyW, Math.max(1, yBot - yTop))
  })
}

export interface Bar {
  label: string
  value: number
}

/** Diverging bar chart (GEX-by-strike: positive above the axis, negative below). */
export function drawDivergingBars(canvas: HTMLCanvasElement, width: number, height: number, bars: Bar[]): void {
  const ctx = sizeCanvas(canvas, width, height)
  if (!ctx) return
  const line = cssVar(canvas, '--color-line', '#23272e')
  const up = cssVar(canvas, '--color-up', cssVar(canvas, '--color-accent', '#5b8cff'))
  const down = cssVar(canvas, '--color-down', '#e0645f')
  clear(ctx, width, height, 'transparent')
  if (bars.length === 0) return

  const padL = 2
  const padR = 2
  const padTop = 6
  const padBottom = 6
  const plotW = Math.max(1, width - padL - padR)
  const plotH = Math.max(1, height - padTop - padBottom)
  const mid = padTop + plotH / 2

  const maxAbs = Math.max(1, ...bars.map((b) => Math.abs(b.value)))
  const n = bars.length
  const step = plotW / n
  const barW = Math.max(1, step * 0.7)

  ctx.strokeStyle = line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, mid)
  ctx.lineTo(width, mid)
  ctx.stroke()

  bars.forEach((b, i) => {
    const cx = padL + i * step + step / 2
    const h = (Math.abs(b.value) / maxAbs) * (plotH / 2 - 2)
    ctx.fillStyle = b.value >= 0 ? up : down
    if (b.value >= 0) ctx.fillRect(cx - barW / 2, mid - h, barW, h)
    else ctx.fillRect(cx - barW / 2, mid, barW, h)
  })
}

export interface LineSeries {
  color?: string // CSS var name, e.g. '--color-series-1'; defaults to accent
  points: number[] // y-values only, evenly spaced on x
}

/** One or more overlaid lines, each independently normalized 0..1 over its own range. */
export function drawLines(canvas: HTMLCanvasElement, width: number, height: number, series: LineSeries[]): void {
  const ctx = sizeCanvas(canvas, width, height)
  if (!ctx) return
  const line = cssVar(canvas, '--color-line', '#23272e')
  clear(ctx, width, height, 'transparent')

  const padTop = 6
  const padBottom = 6
  const plotH = Math.max(1, height - padTop - padBottom)

  ctx.strokeStyle = line
  ctx.globalAlpha = 0.5
  ctx.lineWidth = 1
  for (let g = 0; g <= 3; g++) {
    const gy = padTop + (g / 3) * plotH
    ctx.beginPath()
    ctx.moveTo(0, gy)
    ctx.lineTo(width, gy)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  for (const s of series) {
    if (s.points.length < 2) continue
    let min = Infinity
    let max = -Infinity
    for (const v of s.points) {
      if (v < min) min = v
      if (v > max) max = v
    }
    if (min === max) {
      min -= 1
      max += 1
    }
    const stepX = width / (s.points.length - 1)
    const y = (v: number) => padTop + (1 - (v - min) / (max - min)) * plotH
    ctx.strokeStyle = cssVar(canvas, s.color ?? '--color-accent', '#5b8cff')
    ctx.lineWidth = 1.5
    ctx.beginPath()
    s.points.forEach((v, i) => {
      const x = i * stepX
      if (i === 0) ctx.moveTo(x, y(v))
      else ctx.lineTo(x, y(v))
    })
    ctx.stroke()
  }
}
