import type { OiByExpiryRow } from '@/pages/scanner/gexLevels'

// ─────────────────────────────────────────────────────────────────────────────
// OPEN INTEREST BY EXPIRATION — the canvas.
//
// The scanner's card 5 draws this as TWO mini charts side by side, one for
// calls and one for puts. That answers "what does the call curve look like" and
// not the question the card is actually opened for — at THIS date, how does
// call OI compare to put OI — because the two bars for one expiry are a chart's
// width apart and on independent y-scales. Here both legs share ONE column per
// date and ONE scale, so the comparison is what you read first.
//
// ── It is the GEX Chart's language, deliberately ─────────────────────────────
// Same padding shape, same right-pinned gridline labels in bold 11px mono, same
// dashed marker for the near edge, same blue/amber pair the bars use for
// positive and negative — here calls and puts, which is the same idea one axis
// over. A board with both cards on it should read as one instrument, and the
// only way to get that is to copy the numbers rather than approximate them.
//
// ── Colours come from tokens.css, always ─────────────────────────────────────
// Canvas cannot resolve a custom property, so the palette is READ off the
// container's computed style once per draw and split into channels — the same
// `readPalette` shape board/gexChart/gexChartRender.ts uses, and for the same
// reason (non-negotiable 1).
//
// Where that file then hand-writes an `rgba(…)` template, this one does NOT:
// check-theme counts that as a colour literal, and the older file only passes
// because it is already recorded in theme-baseline.json. `withAlpha` here
// composes an `#rrggbbaa` string out of the channels it already read, so no
// colour SYNTAX appears in this file at all and there is nothing for the
// baseline to hold. (8-digit hex rather than the theme's `alpha()` for one
// reason: `alpha()` emits `color-mix()`, and a canvas that cannot parse a
// colour keeps the PREVIOUS fill silently instead of throwing — not a failure
// mode worth buying for a chart whose two legs are told apart by hue.)
// ─────────────────────────────────────────────────────────────────────────────

const PAD_L = 16
const PAD_R = 16
const PAD_T = 22
/** Two rows of tick text live down here: the date, and the DTE under it. */
const PAD_B = 36

/** Grouped: the two legs side by side. Stacked / net: one bar per column. */
export type OiMode = 'grouped' | 'stacked' | 'net'

export interface OiByExpiryModel {
  rows: OiByExpiryRow[]
  mode: OiMode
  /** `YYYY-MM-DD` in ET. Only used to turn an expiry into a DTE label. */
  todayEt: string
  /** Named on the series line, so a CopyShot says which book this is. */
  symbol: string
}

export const EMPTY_OI_MODEL: OiByExpiryModel = { rows: [], mode: 'grouped', todayEt: '', symbol: '' }

export interface OiByExpiryHandle {
  setModel: (m: OiByExpiryModel) => void
  redraw: () => void
  destroy: () => void
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** `128K` / `1.4M`. Contracts, not dollars — never a `$` on this chart. */
export function fmtContracts(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e6) return `${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${Math.round(a / 1e3)}K`
  return String(Math.round(a))
}

export function fmtOiFull(v: number): string {
  return Math.round(v).toLocaleString('en-US')
}

/** `9/19`. The axis has room for the day and the month and nothing else. */
export function fmtExpiryTick(ymd: string): string {
  const parts = ymd.split('-')
  const m = Number(parts[1])
  const d = Number(parts[2])
  return m && d ? `${m}/${d}` : ymd
}

/**
 * Calendar days from today (ET) to the expiry.
 *
 * Both dates are parsed as UTC midnight so the subtraction is whole days and
 * cannot be shifted by the viewer's own offset — the ET date string is already
 * the answer to "what day is it where the market is".
 */
export function dteOf(ymd: string, todayEt: string): number | null {
  const a = Date.parse(`${todayEt}T00:00:00Z`)
  const b = Date.parse(`${ymd}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

/** 1/2/5/10 × a power of ten, at least range/divisions. gexChartRender's. */
function niceStep(range: number, divisions = 4): number {
  const rough = Math.max(range / divisions, 1e-9)
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  for (const s of [1, 2, 5, 10]) if (s * mag >= rough) return s * mag
  return mag * 10
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// ── Palette ──────────────────────────────────────────────────────────────────

function cssVar(el: HTMLElement, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim()
}

function hexToRgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  const digits = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1]
  if (!digits) return fallback
  const n = parseInt(digits, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

interface Palette {
  call: [number, number, number]
  put: [number, number, number]
  fg: [number, number, number]
  line: [number, number, number]
  surface: [number, number, number]
}

function readPalette(el: HTMLElement): Palette {
  return {
    // The GEX bars' own pair. Calls take the positive hue and puts the negative
    // one because that is what the eye has already learned from the chart above
    // — not because a call is "good".
    call: hexToRgb(cssVar(el, '--color-gexbar-pos'), [41, 182, 246]),
    put: hexToRgb(cssVar(el, '--color-gexbar-neg'), [255, 179, 0]),
    fg: hexToRgb(cssVar(el, '--color-fg'), [255, 255, 255]),
    line: hexToRgb(cssVar(el, '--color-line'), [35, 39, 46]),
    surface: hexToRgb(cssVar(el, '--color-surface'), [15, 17, 23]),
  }
}

const hex2 = (n: number): string =>
  Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

/**
 * A token's channels at an alpha, as `#rrggbbaa`. Built character by character
 * rather than written as a colour, so this file carries no literal at all —
 * see the header. Every channel came from tokens.css.
 */
function withAlpha(c: [number, number, number], a: number): string {
  return `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}${hex2(a * 255)}`
}

// ── Mount ────────────────────────────────────────────────────────────────────

export function mountOiByExpiry(container: HTMLElement): OiByExpiryHandle {
  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  // Marks this as a canvas v3 CODE owns — non-negotiable 6.
  canvas.dataset.cbLayer = 'oi-by-expiry'
  container.appendChild(canvas)
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
  container.style.cursor = 'crosshair'

  let model: OiByExpiryModel = EMPTY_OI_MODEL
  let hover: { i: number; x: number; y: number } | null = null

  /** Column geometry for the current width — shared by draw() and the hit test. */
  function geometry(width: number): { slot: number; cx: (i: number) => number } {
    const n = Math.max(1, model.rows.length)
    const slot = (width - PAD_L - PAD_R) / n
    return { slot, cx: (i: number) => PAD_L + slot * (i + 0.5) }
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
    const rows = model.rows
    if (!rows.length) return

    const cW = W - PAD_L - PAD_R
    const cH = H - PAD_T - PAD_B
    const { slot, cx } = geometry(W)
    const isNet = model.mode === 'net'

    // ── Scale ────────────────────────────────────────────────────────────────
    // Stacked is measured on the SUM, grouped on the taller LEG, net on the
    // signed difference — three modes, three maxima, one place they are decided.
    let hi = 0
    let lo = 0
    for (const r of rows) {
      if (model.mode === 'stacked') hi = Math.max(hi, r.callOI + r.putOI)
      else if (isNet) {
        const v = r.callOI - r.putOI
        hi = Math.max(hi, v)
        lo = Math.min(lo, v)
      } else hi = Math.max(hi, r.callOI, r.putOI)
    }
    // 1.15 headroom, the same reason the GEX chart keeps 1.25: the tallest bar
    // must not touch the frame, and the series line lives up there.
    const maxV = (hi || 1) * 1.15
    const minV = lo * 1.15
    const span = maxV - minV || 1
    const y0 = PAD_T + cH * (maxV / span)
    const yv = (v: number) => y0 - (v / span) * cH

    // ── Gridlines, horizontal only, labelled on the right ───────────────────
    const step = niceStep(span)
    const first = Math.ceil(minV / step) * step
    for (let g = first; g <= maxV * 1.001; g += step) {
      const y = yv(g)
      if (y < PAD_T - 1 || y > PAD_T + cH + 1) continue
      const zero = Math.abs(g) < step / 2
      ctx.strokeStyle = withAlpha(p.line, zero ? 0.9 : 0.55)
      ctx.lineWidth = zero ? 0.8 : 0.5
      ctx.beginPath()
      ctx.moveTo(PAD_L, y)
      ctx.lineTo(PAD_L + cW, y)
      ctx.stroke()
      // Same rule as the GEX chart: the LINE may reach the frame, its LABEL may
      // not — the bottom strip is the tick rows' and a value landing on them is
      // the one collision this chart can produce.
      if (y < PAD_T + 8 || y > PAD_T + cH - 24) continue
      ctx.fillStyle = withAlpha(p.fg, 0.92)
      ctx.font = 'bold 11px ui-monospace, monospace'
      ctx.textAlign = 'right'
      ctx.fillText(zero ? '0' : fmtContracts(g), PAD_L + cW - 3, y - 2)
    }

    ctx.save()
    ctx.beginPath()
    ctx.rect(PAD_L, PAD_T, cW, cH)
    ctx.clip()

    // ── Bars ─────────────────────────────────────────────────────────────────
    // The GEX chart's gradient, same values: lit at the far end, fading toward
    // the axis, and the hovered column swaps to a near-white ramp rather than
    // an outline. Nothing here is scaled by magnitude — that lightening reads
    // as "this strike is hot", and on a date axis there is no hot date.
    const bar = (x: number, w: number, top: number, h: number, c: [number, number, number], hot: boolean) => {
      if (h < 0.5) return
      const grad = ctx.createLinearGradient(0, top, 0, top + h)
      if (hot) {
        grad.addColorStop(0, withAlpha(p.fg, 0.98))
        grad.addColorStop(1, withAlpha(c, 0.72))
      } else {
        grad.addColorStop(0, withAlpha(c, 0.9))
        grad.addColorStop(1, withAlpha(c, 0.2))
      }
      ctx.fillStyle = grad
      ctx.fillRect(x, top, w, h)
    }

    const groupW = Math.max(2, slot * 0.34)
    const soloW = Math.max(3, slot * 0.5)

    rows.forEach((r, i) => {
      const hot = hover?.i === i
      const x = cx(i)
      if (model.mode === 'grouped') {
        const ch = Math.max(1, (r.callOI / span) * cH)
        const ph = Math.max(1, (r.putOI / span) * cH)
        bar(x - groupW - 1, groupW, y0 - ch, ch, p.call, hot)
        bar(x + 1, groupW, y0 - ph, ph, p.put, hot)
      } else if (model.mode === 'stacked') {
        const ch = Math.max(1, (r.callOI / span) * cH)
        const ph = Math.max(1, (r.putOI / span) * cH)
        // Puts on the bottom so the stack reads the same way round as the
        // grouped mode's colours: blue above amber, calls above puts.
        bar(x - soloW / 2, soloW, y0 - ph, ph, p.put, hot)
        bar(x - soloW / 2, soloW, y0 - ph - ch, ch, p.call, hot)
      } else {
        const v = r.callOI - r.putOI
        const top = v >= 0 ? yv(v) : y0
        const h = Math.max(1, Math.abs(yv(v) - y0))
        bar(x - soloW / 2, soloW, top, h, v >= 0 ? p.call : p.put, hot)
      }
    })

    // ── The front expiry, marked ─────────────────────────────────────────────
    // Labelled 0DTE only when it really is today; otherwise FRONT. A weekend or
    // a holiday makes the nearest listed expiry days away, and a column headed
    // "0DTE" on a Sunday is a chart telling a small lie every weekend.
    const firstRow = rows[0]
    if (firstRow) {
      const dte = dteOf(firstRow.expiry, model.todayEt)
      ctx.setLineDash([5, 5])
      ctx.strokeStyle = withAlpha(p.fg, 0.45)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx(0), PAD_T)
      ctx.lineTo(cx(0), PAD_T + cH)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = withAlpha(p.fg, 0.85)
      ctx.font = 'bold 9px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText(dte === 0 ? '0DTE' : 'FRONT', clamp(cx(0), PAD_L + 18, PAD_L + cW - 18), PAD_T + 10)
    }
    ctx.restore()

    // ── Tick rows: the date, and the DTE under it ────────────────────────────
    ctx.font = 'bold 11px ui-monospace, monospace'
    ctx.textAlign = 'center'
    rows.forEach((r, i) => {
      ctx.fillStyle = withAlpha(p.fg, hover?.i === i ? 0.95 : 0.62)
      ctx.fillText(fmtExpiryTick(r.expiry), cx(i), PAD_T + cH + 16)
    })
    // Every other one past fourteen columns: the DTE line is a hint, and a row
    // of overlapping hints is worse than no row at all.
    const dteStride = rows.length <= 14 ? 1 : 2
    ctx.font = 'bold 9px ui-monospace, monospace'
    ctx.fillStyle = withAlpha(p.fg, 0.3)
    rows.forEach((r, i) => {
      if (i % dteStride !== 0) return
      const dte = dteOf(r.expiry, model.todayEt)
      if (dte == null) return
      ctx.fillText(`${dte}d`, cx(i), PAD_T + cH + 28)
    })

    // ── Series line, top-left ────────────────────────────────────────────────
    ctx.fillStyle = withAlpha(p.fg, 0.55)
    ctx.font = 'bold 9px ui-monospace, monospace'
    ctx.textAlign = 'left'
    ctx.fillText(
      [
        model.symbol,
        isNet ? 'CALL − PUT OPEN INTEREST BY EXPIRATION' : 'OPEN INTEREST BY EXPIRATION',
        'CONTRACTS',
      ]
        .filter(Boolean)
        .join(' · '),
      PAD_L + 2,
      PAD_T - 8,
    )

    // ── Hover readout ────────────────────────────────────────────────────────
    const hoverRow = hover ? rows[hover.i] : undefined
    if (hover && hoverRow) {
      const dte = dteOf(hoverRow.expiry, model.todayEt)
      const pc = hoverRow.callOI > 0 ? hoverRow.putOI / hoverRow.callOI : null
      const lines = [
        `${hoverRow.expiry}${dte == null ? '' : `  ${dte}d`}`,
        `C ${fmtOiFull(hoverRow.callOI)}   P ${fmtOiFull(hoverRow.putOI)}`,
        `Total ${fmtOiFull(hoverRow.callOI + hoverRow.putOI)}${pc == null ? '' : `   P/C ${pc.toFixed(2)}`}`,
      ]
      ctx.font = 'bold 10px ui-monospace, monospace'
      let tw = 0
      for (const l of lines) tw = Math.max(tw, ctx.measureText(l).width)
      const bw = tw + 14
      const bh = 14 * lines.length + 8
      const bx = clamp(hover.x + 12, PAD_L, Math.max(PAD_L, W - PAD_R - bw))
      const by = clamp(hover.y - bh - 8, PAD_T, Math.max(PAD_T, PAD_T + cH - bh))
      ctx.fillStyle = withAlpha(p.surface, 1)
      ctx.globalAlpha = 0.95
      ctx.fillRect(bx, by, bw, bh)
      ctx.globalAlpha = 1
      ctx.strokeStyle = withAlpha(p.line, 1)
      ctx.lineWidth = 1
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      lines.forEach((l, i) => {
        ctx.fillStyle = withAlpha(p.fg, i === 0 ? 0.95 : 0.8)
        ctx.fillText(l, bx + 7, by + 11 + i * 14)
      })
      ctx.textBaseline = 'alphabetic'
    }
  }

  const onMove = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const n = model.rows.length
    if (!n || mx < PAD_L || mx > rect.width - PAD_R || my < PAD_T || my > rect.height - PAD_B) {
      if (hover) {
        hover = null
        draw()
      }
      return
    }
    const { slot } = geometry(rect.width)
    const i = clamp(Math.floor((mx - PAD_L) / slot), 0, n - 1)
    hover = { i, x: mx, y: my }
    draw()
  }

  const onLeave = () => {
    if (!hover) return
    hover = null
    draw()
  }

  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerleave', onLeave)

  return {
    setModel(m: OiByExpiryModel) {
      model = m
      // A shorter list can leave the hovered index past the end.
      if (hover && hover.i >= m.rows.length) hover = null
      draw()
    },
    redraw: draw,
    destroy() {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.remove()
    },
  }
}
