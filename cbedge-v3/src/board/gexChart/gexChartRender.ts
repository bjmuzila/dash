import type { GexRow } from '@/contract/frames'
import type { GexBasis, GexSplit } from './settings'
import {
  BASIS_LABEL,
  callGexOf,
  coreStrike,
  dexOf,
  dexSupported,
  flowSplitSupported,
  flowSupported,
  fmtGexShort,
  netGexOf,
  putGexOf,
} from './values'

// ─────────────────────────────────────────────────────────────────────────────
// GEX Chart — a port of v2's home-page chart (components/dashboard/GexChart.tsx),
// scaled down to the bars, the overlays that matter and the interaction.
//
// Transcribed, not reinvented: the padding, the bar gradients, the 1.25 y
// headroom, the 1.16/0.86 zoom factors, the 1.003^dy y-scale, the ~$200 default
// window, the densify step detection, the ATM centring, the DEX line's 60%
// scale and the CB badge are v2's numbers. They are the result of a lot of
// looking at the thing.
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
// ── What the model carries now ───────────────────────────────────────────────
// The card used to have NO toggles, so this drew exactly one thing: net GEX on
// the OI+VOL basis. It now carries v2's four home-page props —
//
//   basis    OI+VOL · VOL · FLOW   which contracts the bars are priced on
//   split    net · call/put        one net bar, or the two legs back to back
//   showDex  the net-delta overlay line
//   expiry   drawn top-left beside the series label
//
// — and the per-strike arithmetic for all of them lives in values.ts, shared
// with the stat cards so the chart and the tiles above it cannot disagree.
//
// ── Still NOT ported ─────────────────────────────────────────────────────────
// The OI area overlays, the BS flip curve, the 5/15/30 prior-state ghost layers
// and the MVC touch-tracking overlay. Each is a real feature with its own data
// dependency (a baselines history, a 401-point spot sweep, a session-scoped
// latch), not a toggle over rows this card already has.
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
  /** Drawn top-left. '' while the source has not said which expiry it is. */
  expiry: string
  basis: GexBasis
  split: GexSplit
  showDex: boolean
}

export const EMPTY_MODEL: GexChartModel = {
  rows: [],
  spot: 0,
  symbol: '',
  expiry: '',
  basis: 'oi-vol',
  split: 'net',
  showDex: false,
}

export { fmtGexShort }

/**
 * OI+VOL net, the card's original single basis.
 *
 * Kept as a named export because it is the shape older callers imported. New
 * code should call values.ts's `netGexOf(row, basis, flowActive)` so it follows
 * the basis switch.
 */
export function netOf(r: GexRow): number {
  return (Number(r.netGEX) || 0) + (Number(r.netVolGEX) || 0)
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

function cssVar(el: HTMLElement, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim()
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
  dex: [number, number, number]
  core: [number, number, number]
  surface: [number, number, number]
}

function readPalette(el: HTMLElement): Palette {
  return {
    pos: hexToRgb(cssVar(el, '--color-gexbar-pos'), [41, 182, 246]),
    neg: hexToRgb(cssVar(el, '--color-gexbar-neg'), [255, 179, 0]),
    fg: hexToRgb(cssVar(el, '--color-fg'), [255, 255, 255]),
    line: hexToRgb(cssVar(el, '--color-line'), [35, 39, 46]),
    dex: hexToRgb(cssVar(el, '--color-dex'), [31, 141, 173]),
    core: hexToRgb(cssVar(el, '--color-level-cb'), [255, 214, 0]),
    surface: hexToRgb(cssVar(el, '--color-surface'), [15, 17, 23]),
  }
}

/**
 * A palette triple at an alpha, as a canvas colour string.
 *
 * The one colour literal in this file, and it is a SYNTAX rather than a colour:
 * every channel comes from readPalette, which reads tokens.css. Canvas cannot
 * resolve a custom property, so design/theme.ts's alpha() — color-mix() over a
 * var() — is not available here; this is the canvas equivalent.
 *
 * Named withAlpha, not rgba, so a call site reads as "this token at 55%" and
 * not as a hand-typed colour.
 */
const withAlpha = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

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
  // Marks this as a canvas v3 CODE owns — same contract as the line in
  // board/chart-render.ts. scripts/perf-check.mjs measures only these.
  canvas.dataset.cbLayer = 'gex-chart'
  container.appendChild(canvas)
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
  container.style.touchAction = 'none'
  container.style.cursor = 'crosshair'

  let model: GexChartModel = EMPTY_MODEL
  let dense: Densified = { rows: [], step: 5 }
  let denseKey = ''
  const vp = { start: null as number | null, count: 121 }
  /**
   * The viewport TRACKS SPOT until the user frames the chart themselves.
   *
   * `vp.start` used to be set once — the first draw that had rows — and then
   * never again. Two things went wrong with that. The first draw usually lands
   * before the spot frame does, so the window was centred on a spot of 0, which
   * clamps to the far left of the ladder and stays there; and even when spot did
   * arrive first, price walks all day while the window it was centred on at
   * 09:30 does not, so by the afternoon the spot line sat wherever it had
   * wandered to.
   *
   * So the window re-centres on spot on every draw — and a draw is every gex
   * frame — for as long as this is true. A PAN turns it off, because dragging
   * the ladder somewhere is a statement about where you want to be looking, and
   * having it snap back a second later is the chart fighting you. A double
   * click turns it back on, which is what the on-screen hint has always called
   * "recenter". A new ladder (a symbol change) turns it back on too: the old
   * framing was measured against strikes that no longer exist.
   *
   * ZOOM DELIBERATELY DOES NOT TURN IT OFF. While following, the fixed point of
   * a zoom is the centre, which is spot; the cursor-anchored zoom below is what
   * you get once you have panned and the chart is yours to aim.
   */
  let followSpot = true
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
      // A new ladder invalidates a viewport measured against the old one — and
      // any framing the user had made of it, which was aimed at strikes that
      // are not on this chart.
      vp.start = null
      followSpot = true
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

    // ── What this ladder can actually support ──────────────────────────────
    // Resolved ONCE, from the raw rows, and passed down. A basis that half
    // applies — flow in the bars, OI+VOL in the core badge — is the exact bug
    // this single resolution exists to make impossible.
    const flowActive = model.basis === 'flow' && flowSupported(model.rows)
    const flowMissing = model.basis === 'flow' && !flowActive
    const dexActive = model.showDex && dexSupported(model.rows, model.basis)

    // ── The CALL/PUT split, on flow ────────────────────────────────────────
    // The legs are their OWN wire fields (flowCallGEX / flowPutGEX), not
    // something derivable from the rest of the row: the dealer's signed
    // inventory per side only exists on the server. So the split has a second
    // support test, and when it fails the split is REFUSED rather than quietly
    // drawing the OI+VOL legs — which is what this chart did until 2026-09,
    // labelled "CALL/PUT · FLOW" the whole time.
    const splitAsked = model.split === 'call-put'
    const flowSplitOff = flowActive && splitAsked && !flowSplitSupported(model.rows)
    const splitting = splitAsked && !flowSplitOff

    // On flow BOTH legs are signed — dealer long positive, dealer short
    // negative — so neither one has a fixed side of the zero line to sit on.
    // Two full-width bars drawn from zero would then hide one behind the other
    // whenever the signs agree, so the flow split draws them half-width, side
    // by side. Off flow the signs are opposite by construction (call +, put −)
    // and the original stacked geometry is kept exactly as it was.
    const signedSplit = splitting && flowActive

    const getNet = (r: GexRow) => netGexOf(r, model.basis, flowActive)
    const getCall = (r: GexRow) => callGexOf(r, model.spot, model.basis, flowActive)
    const getPut = (r: GexRow) => putGexOf(r, model.spot, model.basis, flowActive)

    // ── Viewport ──
    const dynCount = Math.max(MIN_COUNT, Math.round(TARGET_RANGE / detectedStep) + 1)
    if (vp.start === null) vp.count = dynCount
    vp.count = clamp(vp.count, MIN_COUNT, allRows.length)
    // Spot in the middle, re-decided every frame while following. Guarded on a
    // real spot: the first draws arrive before the spot frame does, and
    // centring on 0 pins the window to the bottom of the ladder — which is the
    // left edge, and is where this chart used to open and stay.
    if (followSpot && model.spot > 0) vp.start = atmStart(allRows, model.spot, vp.count)
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
    // never touches the frame. In the split the scale is set by the taller of
    // the two LEGS, not by their net — otherwise a strike whose call and put
    // nearly cancel would draw two bars off the top of a pane scaled to a net
    // of almost nothing.
    let netMax = 1
    for (const r of data) {
      if (splitting) {
        netMax = Math.max(netMax, Math.abs(getCall(r)), Math.abs(getPut(r)))
      } else {
        netMax = Math.max(netMax, Math.abs(getNet(r)))
      }
    }
    const maxG = (netMax * 1.25) / yScale
    const yFor = (v: number) => yZero - (v / maxG) * (cH / 2)

    // ── Zero line ──
    ctx.strokeStyle = withAlpha(p.line, 0.9)
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
        ctx.strokeStyle = withAlpha(p.line, 0.55)
        ctx.beginPath()
        ctx.moveTo(PAD_L, y)
        ctx.lineTo(PAD_L + cW, y)
        ctx.stroke()
      }
      ctx.fillStyle = withAlpha(p.fg, 0.92)
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
    //
    // In the split the SIGN still picks the colour, and the two legs already
    // carry opposite signs by construction — so a call bar is blue above the
    // line and a put bar amber below it, with no second rule to remember.
    const drawBar = (x: number, v: number, highlighted: boolean, w = barW) => {
      if (!v) return
      const yTop = v >= 0 ? clamp(yFor(v), PAD_T, yZero) : yZero
      const yBot = v >= 0 ? yZero : clamp(yFor(v), yZero, PAD_T + cH)
      const h = Math.abs(yBot - yTop)
      if (h < 0.5) return
      const grad = ctx.createLinearGradient(0, yTop, 0, yTop + h)
      const base = v >= 0 ? p.pos : p.neg
      if (highlighted) {
        grad.addColorStop(0, withAlpha(p.fg, 0.98))
        grad.addColorStop(1, withAlpha(base, 0.72))
        ctx.shadowColor = withAlpha(base, 0.7)
        ctx.shadowBlur = 12
      } else {
        const t = Math.min(Math.abs(v) / netMax, 1)
        const lift = 0.28 * t
        const mix = (c: number) => Math.round(c + (255 - c) * lift)
        const lit: [number, number, number] = [mix(base[0]), mix(base[1]), mix(base[2])]
        if (v >= 0) {
          grad.addColorStop(0, withAlpha(lit, 0.9))
          grad.addColorStop(1, withAlpha(base, 0.2))
        } else {
          grad.addColorStop(0, withAlpha(base, 0.2))
          grad.addColorStop(1, withAlpha(lit, 0.9))
        }
      }
      ctx.fillStyle = grad
      ctx.fillRect(x - w / 2, yTop, w, h)
      if (highlighted) ctx.shadowBlur = 0
    }

    const hoverStrike = hover?.row.strike
    data.forEach((r, i) => {
      const x = xAt(i)
      const highlighted = r.strike === hoverStrike
      if (signedSplit) {
        // Flow: two signed half-width bars, call on the left of the column and
        // put on the right, each free to point either way.
        const hw = Math.max(1, barW / 2)
        drawBar(x - hw / 2, getCall(r), highlighted, hw)
        drawBar(x + hw / 2, getPut(r), highlighted, hw)
      } else if (splitting) {
        drawBar(x, Math.abs(getCall(r)), highlighted)
        drawBar(x, -Math.abs(getPut(r)), highlighted)
      } else {
        drawBar(x, getNet(r), highlighted)
      }
    })

    // ── DEX line — its OWN scale, 60% of the half-height, centred on zero ─────
    // Normalised to its own max on purpose: delta exposure is orders of
    // magnitude away from gamma exposure in dollars, and plotting it on the
    // bars' axis would pin it flat to the zero line. That is also why it gets
    // no gridlines — it answers "which way is delta leaning, and where does it
    // turn", not "how many dollars".
    if (dexActive) {
      const dexVals = data.map((r) => dexOf(r, model.basis))
      let maxDex = 1
      for (const v of dexVals) maxDex = Math.max(maxDex, Math.abs(v))
      const yDex = (v: number) => yZero - (v / maxDex) * (cH / 2) * 0.6
      ctx.strokeStyle = withAlpha(p.dex, 0.95)
      ctx.lineWidth = 2
      ctx.shadowColor = withAlpha(p.dex, 0.35)
      ctx.shadowBlur = 10
      const pts = dexVals.map((v, i) => ({ x: xAt(i), y: yDex(v) }))
      if (pts.length > 1) {
        ctx.beginPath()
        const head = pts[0]!
        ctx.moveTo(head.x, head.y)
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i]!
          const b = pts[i + 1]!
          ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2)
        }
        const tail = pts[pts.length - 1]!
        ctx.lineTo(tail.x, tail.y)
        ctx.stroke()
      }
      ctx.shadowBlur = 0
      ctx.fillStyle = withAlpha(p.dex, 0.85)
      ctx.font = 'bold 8px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText('+NET DEX', PAD_L + 3, yDex(0) - 3)
    }

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
        ctx.strokeStyle = withAlpha(p.fg, 0.55)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(sx, PAD_T)
        ctx.lineTo(sx, PAD_T + cH)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = withAlpha(p.fg, 0.85)
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

    // ── The CORE, marked the way v2 marks it ─────────────────────────────────
    // A labelled box pinned just above the bar carrying the biggest |net| on
    // the WHOLE ladder — not just the visible window, so panning away from it
    // hides the badge instead of quietly relabelling whatever is on screen.
    //
    // Always the day's VOLUME alone — the core no longer follows the basis, so
    // the badge stays on the strike today's traded gamma built while the bars
    // underneath it change. The "·Vol" tag says which claim it is making; the
    // CB tile above the chart reads the same definition.
    const core = coreStrike(model.rows)
    const coreIdx = core == null ? -1 : data.findIndex((r) => r.strike === core)
    const coreRow = coreIdx >= 0 ? data[coreIdx] : undefined
    if (coreRow) {
      const cv = getNet(coreRow)
      const cy = clamp(yFor(cv), PAD_T + 2, PAD_T + cH - 2)
      const col = cv >= 0 ? p.pos : p.neg
      ctx.save()
      ctx.font = 'bold 10px ui-monospace, monospace'
      const tag = 'CB·Vol'
      const lbl = `${tag} ${coreRow.strike.toLocaleString('en-US')}`
      const bw = ctx.measureText(lbl).width + 10
      const bh = 15
      const bx = clamp(xAt(coreIdx) - bw / 2, 2, Math.max(2, W - bw - 2))
      const by = Math.max(2, cy - 20)
      ctx.fillStyle = withAlpha(p.core, 0.12)
      ctx.fillRect(bx, by, bw, bh)
      ctx.strokeStyle = withAlpha(col, 0.95)
      ctx.lineWidth = 1
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1)
      ctx.fillStyle = withAlpha(col, 0.98)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(lbl, bx + bw / 2, by + bh / 2 + 0.5)
      ctx.textBaseline = 'alphabetic'
      ctx.restore()
    }

    // ── X labels, inside the plot near the bottom ──
    // A nice step over the VISIBLE range rather than v2's hardcoded multiples of
    // 50, so a 40-point-wide AMZN window is labelled as well as a 200-point SPX
    // one. See the note at the top of this file.
    const firstRow = data[0]
    const lastData = data[data.length - 1]
    if (firstRow && lastData) {
      const labelStep = niceStep(lastData.strike - firstRow.strike, 7)
      ctx.fillStyle = withAlpha(p.fg, 0.92)
      ctx.font = 'bold 11px ui-monospace, monospace'
      ctx.textAlign = 'center'
      data.forEach((r, i) => {
        if (Math.abs(r.strike % labelStep) > 1e-6) return
        ctx.fillText(r.strike.toLocaleString('en-US'), xAt(i), PAD_T + cH - 18)
      })
    }

    // ── Series label, top-left: what is drawn, and for which expiry ──────────
    // The chart cannot work the expiry out for itself — the rows look the same
    // whichever one they came from — so the card passes it in, the same reason
    // v2's chart takes a `seriesLabel` prop rather than deriving one.
    const seriesBits = [splitting ? 'CALL/PUT' : 'NET GEX', BASIS_LABEL[flowActive ? 'flow' : model.basis]]
    if (model.expiry) seriesBits.push(model.expiry)
    ctx.fillStyle = withAlpha(p.fg, 0.55)
    ctx.font = 'bold 9px ui-monospace, monospace'
    ctx.textAlign = 'left'
    ctx.fillText(seriesBits.join(' · '), PAD_L + 2, PAD_T - 8)

    // Asked for flow, and these rows have none. Said out loud rather than drawn
    // as a silent fallback: the bars in front of you are OI+VOL, and a user who
    // is not told that will read them as a flow book.
    if (flowMissing) {
      ctx.fillStyle = withAlpha(p.fg, 0.45)
      ctx.font = 'bold 9px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText('No classified flow for this symbol — showing OI+VOL', W / 2, PAD_T + 24)
    }

    // Asked for the split ON flow, and this feed carries only the summed
    // flowGEX — no per-side legs. Same rule as above: say it, and draw the net
    // bar. Falling back to the OI+VOL legs under a FLOW label is exactly the
    // bug this note replaced.
    if (flowSplitOff) {
      ctx.fillStyle = withAlpha(p.fg, 0.45)
      ctx.font = 'bold 9px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText('Flow carries no call/put split on this feed — showing net flow', W / 2, PAD_T + 24)
    }

    // ── The hint, very dim, bottom-right ──
    ctx.fillStyle = withAlpha(p.fg, 0.22)
    ctx.font = 'bold 8px ui-monospace, monospace'
    ctx.textAlign = 'right'
    // Says which of the two modes you are in, because "why did it stop
    // following price" and "why did it snap back" are the same question asked
    // from either side of one silent flag.
    ctx.fillText(
      followSpot
        ? 'spot centred · scroll=zoom · drag=pan'
        : 'scroll=zoom · drag=pan · dbl=recenter',
      W - 3,
      PAD_T + cH - 3,
    )

    // ── Hover readout ──
    if (hover) {
      const v = getNet(hover.row)
      // On flow the legs are signed, so the readout prints them as they are —
      // abs()-ing them here would put a "+" in front of a dealer SHORT leg.
      const k = hover.row.strike.toLocaleString('en-US')
      const label = signedSplit
        ? `${k}   C ${fmtGexShort(getCall(hover.row))}   P ${fmtGexShort(getPut(hover.row))}`
        : splitting
          ? `${k}   C ${fmtGexShort(Math.abs(getCall(hover.row)))}   P ${fmtGexShort(-Math.abs(getPut(hover.row)))}`
          : `${k}   ${fmtGexShort(v)}`
      ctx.font = 'bold 10px ui-monospace, monospace'
      const tw = ctx.measureText(label).width
      const bw = tw + 14
      const bh = 20
      const bx = clamp(hover.x - bw / 2, PAD_L, Math.max(PAD_L, W - PAD_R - bw))
      const by = clamp(hover.y - bh - 10, PAD_T, PAD_T + cH - bh)
      ctx.fillStyle = withAlpha(p.surface, 1)
      ctx.globalAlpha = 0.95
      ctx.fillRect(bx, by, bw, bh)
      ctx.globalAlpha = 1
      ctx.strokeStyle = withAlpha(v >= 0 ? p.pos : p.neg, 0.6)
      ctx.lineWidth = 1
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1)
      ctx.fillStyle = withAlpha(p.fg, 0.95)
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
    // Still following spot: the fixed point is the centre, and the centre is
    // spot. Widen or narrow around it and let draw() re-centre. Anchoring on
    // the cursor here would walk the window off spot a notch per wheel tick
    // and quietly undo the follow without the user ever panning.
    if (followSpot) {
      vp.count = next
      draw()
      return
    }
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
        // Aiming the ladder by hand ends the follow. Only on an actual shift,
        // so a click that happens to wobble a pixel does not silently unlock it.
        if (shift !== 0) followSpot = false
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
    // "Recenter" means back to the default frame AND back to tracking spot,
    // which is the state the chart opens in.
    followSpot = true
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
