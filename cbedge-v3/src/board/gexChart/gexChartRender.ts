import type { GexRow } from '@/contract/frames'

// ─────────────────────────────────────────────────────────────────────────────
// GEX Chart — a port of v2's home-page chart (components/dashboard/GexChart.tsx),
// scaled down to the bars and the interaction.
//
// Transcribed, not reinvented: the padding, the bar gradients, the 1.25 y
// headroom, the 1.16/0.86 zoom factors, the 1.003^dy y-scale, the ~$200 default
// window, the densify step detection and the ATM centring are v2's numbers.
// They are the result of a lot of looking at the thing.
//
// ── The interaction is the point ─────────────────────────────────────────────
//   wheel        zoom, cursor-anchored — the strike under the pointer stays put
//   drag         pan
//   drag left    on the far-left gutter, scales Y instead of panning
//   double-click recentre on ATM and reset the y-scale
//   hover        a small readout for the bar under the pointer
//
// ── Imperative, and it has to be ─────────────────────────────────────────────
// A pan is sixty pointer events a second and each one changes the viewport.
// Routing that through React state would re-render the card on every frame of
// every drag. So this module owns the canvas, the viewport and the listeners,
// exactly as chart.ts does for the candles (AGENTS.md rule 4). The card hands
// it a model and gets a handle back.
//
// ── What was NOT ported ──────────────────────────────────────────────────────
// Everything the home page drives through props rather than the chart owning:
// the call/put split, the DEX metric, the flow basis, the OI area overlays, the
// flip curve, the 5/15/30 ghost layers and the MVC touch tracking. The card has
// no toggles, so it draws one thing: net GEX on the OI+VOL basis.
//
// ── Two deliberate deviations from v2 ────────────────────────────────────────
// 1. X labels use a nice step derived from the VISIBLE strike range. v2
//    hardcodes "multiples of 50", which is right for SPX and puts zero labels on
//    an AMZN chart whose whole range is 40 points wide. v3's chart follows the
//    page ticker, so it cannot hardcode a strike grid.
// 2. No opaque plot background. v2 fills #05080d because it sits in its own
//    panel; here the chart is inside a v3 Card and painting a different dark
//    over the card's surface reads as a hole cut in it.
// ─────────────────────────────────────────────────────────────────────────────

/** v2's padding, exactly. */
const PAD_T = 20
const PAD_B = 6
const PAD_L = 16
const PAD_R = 16
/** Never zoom in past this many strikes. v2's MIN_COUNT. */
const MIN_COUNT = 30
/** The window the chart opens on and returns to, in price. v2's targetRange. */
const TARGET_RANGE = 200
/** Drag started this far from the left edge scales Y instead of panning. */
const YSCALE_GUTTER = PAD_L + 18

export interface GexChartModel {
  /** Ascending by strike. */
  rows: GexRow[]
  spot: number
  /** Labels the spot line. */
  symbol: string
}

export const EMPTY_MODEL: GexChartModel = { rows: [], spot: 0, symbol: '' }

/** OI+VOL — the OI net PLUS the volume net, per the server's oiVolNet(). */
export function netOf(r: GexRow): number {
  return (Number(r.netGEX) || 0) + (Number(r.netVolGEX) || 0)
}

export function fmtGexShort(v: number): string {
  const a = Math.abs(v)
  const s = v >= 0 ? '+' : '−'
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(2)}K`
  return `${s}$${a.toFixed(2)}`
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** v2's getNiceStep: 1/2/5/10 × a power of ten, at least range/5. */
function niceStep(range: number, divisions = 5): number {
  const rough = Math.max(range / divisions, 1e-9)
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  for (const s of [1, 2, 5, 10]) if (s * mag >= rough) return s * mag
  return mag * 10
}

interface Densified {
  rows: GexRow[]
  step: number
}

const blankRow = (strike: number): GexRow =>
  ({
    strike,
    netGEX: 0,
    netVolGEX: 0,
    callGEX: 0,
    putGEX: 0,
    callOI: 0,
    putOI: 0,
    callVolume: 0,
    putVolume: 0,
    callGamma: 0,
    putGamma: 0,
    dte: 0,
  }) as GexRow

/**
 * Fill the gaps so the bars sit on an even grid.
 *
 * A chain is not evenly spaced — SPX is 5 points near the money and wider out —
 * and drawing one bar per ROW would put the same pixel gap between strikes that
 * are 5 apart and strikes that are 25 apart, which makes the ladder lie about
 * where price is relative to it. v2 detects the step from the MIDDLE 60% of the
 * chain (the ends are where the odd spacings live), takes the most common gap
 * rather than the smallest, snaps it to a sensible increment, and fills.
 */
export function densify(rows: GexRow[]): Densified {
  if (!rows.length) return { rows: [], step: 5 }
  const sorted = [...rows].sort((a, b) => a.strike - b.strike)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (!first || !last) return { rows: [], step: 5 }
  const byStrike = new Map(sorted.map((r) => [r.strike, r]))

  let step = 5
  if (sorted.length >= 4) {
    const lo = Math.floor(sorted.length * 0.2)
    const hi = Math.ceil(sorted.length * 0.8)
    const freq = new Map<number, number>()
    for (let i = lo; i < hi - 1; i++) {
      const a = sorted[i]
      const b = sorted[i + 1]
      if (!a || !b) continue
      const g = Math.round((b.strike - a.strike) * 100) / 100
      if (g > 0 && g <= 25) freq.set(g, (freq.get(g) ?? 0) + 1)
    }
    let best = 0
    let bestCount = 0
    for (const [g, count] of freq) {
      if (count > bestCount) {
        bestCount = count
        best = g
      }
    }
    if (best > 0) step = best
  }
  const STEPS = [0.5, 1, 2.5, 5, 10, 25]
  step = STEPS.reduce((b, s) => (Math.abs(s - step) < Math.abs(b - step) ? s : b), 5)

  const out: GexRow[] = []
  const precision = step % 1 !== 0 ? 1 : 0
  // Bounded: a malformed step against a wide chain must not spin here.
  const maxRows = 4000
  for (let s = first.strike; s <= last.strike + step * 0.5 && out.length < maxRows; s += step) {
    const key = parseFloat(s.toFixed(precision))
    out.push(byStrike.get(key) ?? byStrike.get(Math.round(key)) ?? blankRow(key))
  }
  return { rows: out, step }
}

/** First index of a `count`-wide window centred on the strike nearest spot. */
export function atmStart(rows: GexRow[], spot: number, count: number): number {
  if (!rows.length || count >= rows.length) return 0
  let atm = 0
  let bestDist = Infinity
  rows.forEach((r, i) => {
    const d = Math.abs(r.strike - spot)
    if (d < bestDist) {
      bestDist = d
      atm = i
    }
  })
  return clamp(atm - Math.floor(count / 2), 0, rows.length - count)
}

// ── Palette ──────────────────────────────────────────────────────────────────

function cssVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

/** '#rrggbb' → [r,g,b]. Canvas needs per-stop alpha, which a token cannot carry. */
function hexToRgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  const digits = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1]
  if (!digits) return fallback
  const n = parseInt(digits, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

interface Palette {
  pos: [number, number, number]
  neg: [number, number, number]
  fg: [number, number, number]
  line: [number, number, number]
  surface: string
}

function readPalette(el: HTMLElement): Palette {
  return {
    pos: hexToRgb(cssVar(el, '--color-gexbar-pos', '#29b6f6'), [41, 182, 246]),
    neg: hexToRgb(cssVar(el, '--color-gexbar-neg', '#ffb300'), [255, 179, 0]),
    fg: hexToRgb(cssVar(el, '--color-fg', '#ffffff'), [255, 255, 255]),
    line: hexToRgb(cssVar(el, '--color-line', '#23272e'), [35, 39, 46]),
    surface: cssVar(el, '--color-surface', '#0f1117'),
  }
}

const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

export interface GexChartHandle {
  setModel: (m: GexChartModel) => void
  redraw: () => void
  destroy: () => void
}

export function mountGexChart(container: HTMLElement): GexChartHandle {
  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  container.appendChild(canvas)
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
  container.style.touchAction = 'none'
  container.style.cursor = 'crosshair'

  let model: GexChartModel = EMPTY_MODEL
  let dense: Densified = { rows: [], step: 5 }
  let denseKey = ''
  const vp = { start: null as number | null, count: 121 }
  let yScale = 1
  let drag: {
    mode: 'pan' | 'yscale'
    startX: number
    startY: number
    startStart: number
    startYScale: number
    pxPerStrike: number
  } | null = null
  let hover: { x: number; y: number; row: GexRow } | null = null

  function densified(): Densified {
    const first = model.rows[0]
    const last = model.rows[model.rows.length - 1]
    const key = `${model.rows.length}:${first?.strike ?? 0}:${last?.strike ?? 0}`
    if (key !== denseKey) {
      dense = densify(model.rows)
      denseKey = key
      // A new ladder invalidates a viewport measured against the old one.
      vp.start = null
    }
    return dense
  }

  function draw(): void {
    const W = container.clientWidth
    const H = container.clientHeight
    if (W < 10 || H < 10) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    const p = readPalette(container)
    const { rows: allRows, step: detectedStep } = densified()
    if (!allRows.length) return

    // ── Viewport ──
    const dynCount = Math.max(MIN_COUNT, Math.round(TARGET_RANGE / detectedStep) + 1)
    if (vp.start === null) vp.count = dynCount
    vp.count = clamp(vp.count, MIN_COUNT, allRows.length)
    if (vp.start === null) vp.start = atmStart(allRows, model.spot, vp.count)
    vp.start = clamp(vp.start, 0, Math.max(0, allRows.length - vp.count))

    const data = allRows.slice(vp.start, vp.start + vp.count)
    if (!data.length) return

    const cW = W - PAD_L - PAD_R
    const cH = H - PAD_T - PAD_B
    const yZero = PAD_T + cH / 2
    const gap = cW / data.length
    const barW = Math.max(2, gap * 0.82)
    const xAt = (i: number) => PAD_L + (i + 0.5) * gap

    // ── Y scale: robustMax × 1.25 / yScale ──
    // The 1.25 headroom keeps the tallest bar at ~80% of the half-height so it
    // never touches the frame.
    let netMax = 1
    for (const r of data) netMax = Math.max(netMax, Math.abs(netOf(r)))
    const maxG = (netMax * 1.25) / yScale
    const yFor = (v: number) => yZero - (v / maxG) * (cH / 2)

    // ── Zero line ──
    ctx.strokeStyle = rgba(p.line, 0.9)
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(PAD_L, yZero)
    ctx.lineTo(PAD_L + cW, yZero)
    ctx.stroke()

    // ── Gridlines, horizontal only, labelled on the right ──
    const gStep = niceStep(maxG)
    ctx.lineWidth = 0.5
    for (let g = gStep; g <= maxG * 1.01; g += gStep) {
      for (const y of [yFor(g), yFor(-g)]) {
        if (y < PAD_T - 1 || y > PAD_T + cH + 1) continue
        ctx.strokeStyle = rgba(p.line, 0.55)
        ctx.beginPath()
        ctx.moveTo(PAD_L, y)
        ctx.lineTo(PAD_L + cW, y)
        ctx.stroke()
      }
      ctx.fillStyle = rgba(p.fg, 0.92)
      ctx.font = 'bold 11px ui-monospace, monospace'
      ctx.textAlign = 'right'
      // The LINE may run to the frame edge; its LABEL may not. The bottom strip
      // already carries the strike labels and the hint, and a gridline value
      // landing on either is the one collision this chart can actually produce.
      const labelFits = (y: number) => y >= PAD_T + 8 && y <= PAD_T + cH - 24
      const yP = yFor(g)
      const yN = yFor(-g)
      if (labelFits(yP)) ctx.fillText(fmtGexShort(g), PAD_L + cW - 3, yP - 2)
      if (labelFits(yN)) ctx.fillText(fmtGexShort(-g), PAD_L + cW - 3, yN - 2)
    }

    ctx.save()
    ctx.beginPath()
    ctx.rect(PAD_L, PAD_T, cW, cH)
    ctx.clip()

    // ── Bars ──
    // v2's gradient, value for value: the lit end of the bar lightens toward
    // white by up to 28% of the bar's share of the column max, so the big
    // strikes read hotter without a second colour.
    const hoverStrike = hover?.row.strike
    data.forEach((r, i) => {
      const v = netOf(r)
      if (!v) return
      const x = xAt(i)
      const yTop = v >= 0 ? clamp(yFor(v), PAD_T, yZero) : yZero
      const yBot = v >= 0 ? yZero : clamp(yFor(v), yZero, PAD_T + cH)
      const h = Math.abs(yBot - yTop)
      if (h < 0.5) return
      const highlighted = r.strike === hoverStrike
      const grad = ctx.createLinearGradient(0, yTop, 0, yTop + h)
      const base = v >= 0 ? p.pos : p.neg
      if (highlighted) {
        grad.addColorStop(0, rgba(p.fg, 0.98))
        grad.addColorStop(1, rgba(base, 0.72))
        ctx.shadowColor = rgba(base, 0.7)
        ctx.shadowBlur = 12
      } else {
        const t = Math.min(Math.abs(v) / netMax, 1)
        const lift = 0.28 * t
        const mix = (c: number) => Math.round(c + (255 - c) * lift)
        const lit: [number, number, number] = [mix(base[0]), mix(base[1]), mix(base[2])]
        if (v >= 0) {
          grad.addColorStop(0, rgba(lit, 0.9))
          grad.addColorStop(1, rgba(base, 0.2))
        } else {
          grad.addColorStop(0, rgba(base, 0.2))
          grad.addColorStop(1, rgba(lit, 0.9))
        }
      }
      ctx.fillStyle = grad
      ctx.fillRect(x - barW / 2, yTop, barW, h)
      if (highlighted) ctx.shadowBlur = 0
    })

    // ── Spot, interpolated between the two strikes that bracket it ──
    if (model.spot > 0) {
      let sx: number | null = null
      const fi = data.findIndex((r) => r.strike >= model.spot)
      const lastRow = data[data.length - 1]
      if (fi === 0) sx = xAt(0)
      else if (fi > 0) {
        const prev = data[fi - 1]
        const curr = data[fi]
        if (prev && curr) {
          const span = curr.strike - prev.strike
          sx = xAt(fi - 1) + (span > 0 ? (model.spot - prev.strike) / span : 0) * gap
        }
      } else if (lastRow && model.spot >= lastRow.strike) sx = xAt(data.length - 1)

      if (sx !== null) {
        ctx.setLineDash([5, 5])
        ctx.strokeStyle = rgba(p.fg, 0.55)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(sx, PAD_T)
        ctx.lineTo(sx, PAD_T + cH)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = rgba(p.fg, 0.85)
        ctx.font = 'bold 9px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(
          `${model.symbol} ${model.spot.toFixed(2)}`,
          clamp(sx, PAD_L + 34, PAD_L + cW - 34),
          PAD_T + 10,
        )
      }
    }
    ctx.restore()

    // ── X labels, inside the plot near the bottom ──
    // A nice step over the VISIBLE range rather than v2's hardcoded multiples of
    // 50, so a 40-point-wide AMZN window is labelled as well as a 200-point SPX
    // one. See the note at the top of this file.
    const firstRow = data[0]
    const lastData = data[data.length - 1]
    if (firstRow && lastData) {
      const labelStep = niceStep(lastData.strike - firstRow.strike, 7)
      ctx.fillStyle = rgba(p.fg, 0.92)
      ctx.font = 'bold 11px ui-monospace, monospace'
      ctx.textAlign = 'center'
      data.forEach((r, i) => {
        if (Math.abs(r.strike % labelStep) > 1e-6) return
        ctx.fillText(r.strike.toLocaleString('en-US'), xAt(i), PAD_T + cH - 18)
      })
    }

    // ── The hint, very dim, bottom-right ──
    ctx.fillStyle = rgba(p.fg, 0.22)
    ctx.font = 'bold 8px ui-monospace, monospace'
    ctx.textAlign = 'right'
    ctx.fillText('scroll=zoom · drag=pan · dbl=recenter', W - 3, PAD_T + cH - 3)

    // ── Hover readout ──
    if (hover) {
      const v = netOf(hover.row)
      const label = `${hover.row.strike.toLocaleString('en-US')}   ${fmtGexShort(v)}`
      ctx.font = 'bold 10px ui-monospace, monospace'
      const tw = ctx.measureText(label).width
      const bw = tw + 14
      const bh = 20
      const bx = clamp(hover.x - bw / 2, PAD_L, Math.max(PAD_L, W - PAD_R - bw))
      const by = clamp(hover.y - bh - 10, PAD_T, PAD_T + cH - bh)
      ctx.fillStyle = p.surface
      ctx.globalAlpha = 0.95
      ctx.fillRect(bx, by, bw, bh)
      ctx.globalAlpha = 1
      ctx.strokeStyle = rgba(v >= 0 ? p.pos : p.neg, 0.6)
      ctx.lineWidth = 1
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1)
      ctx.fillStyle = rgba(p.fg, 0.95)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, bx + 7, by + bh / 2)
      ctx.textBaseline = 'alphabetic'
    }
  }

  /** Which visible row is under a client-x. Null outside the plot. */
  function rowAt(clientX: number, clientY: number): { row: GexRow; x: number; y: number } | null {
    const rect = canvas.getBoundingClientRect()
    const mx = clientX - rect.left
    const my = clientY - rect.top
    if (mx < PAD_L || mx > rect.width - PAD_R) return null
    if (my < PAD_T || my > rect.height - PAD_B) return null
    const { rows } = densified()
    if (!rows.length) return null
    const visible = rows.slice(vp.start ?? 0, (vp.start ?? 0) + vp.count)
    if (!visible.length) return null
    const g = (rect.width - PAD_L - PAD_R) / visible.length
    const idx = clamp(Math.floor((mx - PAD_L) / g), 0, visible.length - 1)
    const row = visible[idx]
    return row ? { row, x: mx, y: my } : null
  }

  // ── Wheel: zoom, cursor-anchored ──
  // Attached natively with { passive: false }: React's onWheel prop is passive,
  // so preventDefault() there is ignored and the whole page scrolls instead.
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const { rows } = densified()
    if (!rows.length) return
    const factor = e.deltaY > 0 ? 1.16 : 0.86
    const next = clamp(Math.round(vp.count * factor), MIN_COUNT, rows.length)
    if (next === vp.count) return
    const rect = container.getBoundingClientRect()
    // The strike under the pointer is the fixed point of the zoom — anchoring
    // on the centre instead makes it walk away from you as you scroll.
    const frac = clamp((e.clientX - rect.left) / Math.max(rect.width, 1), 0, 1)
    const anchor = (vp.start ?? 0) + frac * vp.count
    vp.count = next
    vp.start = clamp(Math.round(anchor - frac * next), 0, Math.max(0, rows.length - next))
    draw()
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    const rect = container.getBoundingClientRect()
    drag = {
      mode: e.clientX - rect.left < YSCALE_GUTTER ? 'yscale' : 'pan',
      startX: e.clientX,
      startY: e.clientY,
      startStart: vp.start ?? 0,
      startYScale: yScale,
      pxPerStrike: Math.max(1, container.clientWidth / Math.max(1, vp.count)),
    }
    hover = null
    container.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const onPointerMove = (e: PointerEvent) => {
    if (drag) {
      if (drag.mode === 'yscale') {
        const dy = drag.startY - e.clientY
        yScale = clamp(drag.startYScale * Math.pow(1.003, dy), 0.1, 12)
      } else {
        const dx = e.clientX - drag.startX
        const shift = Math.round(-dx / drag.pxPerStrike)
        const { rows } = densified()
        vp.start = clamp(drag.startStart + shift, 0, Math.max(0, rows.length - vp.count))
      }
      draw()
      return
    }
    const hit = rowAt(e.clientX, e.clientY)
    const changed = hit?.row.strike !== hover?.row.strike
    hover = hit
    if (changed || hit) draw()
  }

  const onPointerUp = (e: PointerEvent) => {
    drag = null
    try {
      container.releasePointerCapture(e.pointerId)
    } catch {
      /* the capture is already gone */
    }
  }

  const onLeave = () => {
    if (hover) {
      hover = null
      draw()
    }
  }

  const onDblClick = () => {
    const { rows, step } = densified()
    const initCount = Math.max(MIN_COUNT, Math.round(TARGET_RANGE / step) + 1)
    vp.count = clamp(initCount, MIN_COUNT, Math.max(MIN_COUNT, rows.length))
    vp.start = atmStart(rows, model.spot, vp.count)
    yScale = 1
    draw()
  }

  container.addEventListener('wheel', onWheel, { passive: false })
  container.addEventListener('pointerdown', onPointerDown)
  container.addEventListener('pointermove', onPointerMove)
  container.addEventListener('pointerup', onPointerUp)
  container.addEventListener('pointercancel', onPointerUp)
  container.addEventListener('pointerleave', onLeave)
  container.addEventListener('dblclick', onDblClick)

  return {
    setModel(m) {
      model = m
      draw()
    },
    redraw: draw,
    destroy() {
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointercancel', onPointerUp)
      container.removeEventListener('pointerleave', onLeave)
      container.removeEventListener('dblclick', onDblClick)
      canvas.remove()
    },
  }
}
