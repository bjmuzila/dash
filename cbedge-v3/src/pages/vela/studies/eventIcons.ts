// ─────────────────────────────────────────────────────────────────────────────
// THE EVENTS STUDY'S MARKS, DRAWN (mockup generated/2026-10-04-vela-events-r2.html).
// One look per kind, used three places: the chart's lane (canvas, eventsLayer.ts),
// a mark's card and the legend card's Events row and menu (SVG markup).
//
//   releases       a calendar in a CIRCLE: high impact Bad red, medium Accent
//                  Text blue, low Paper Quiet grey
//   engine alerts  a DIAMOND with the mark Voltick uses for it: ★ Volt (Volt
//                  amber), ⚡ Flip (flip violet), a bracket for the IB (slate),
//                  $ for a whale print (Accent Text), bars for the top GEX
//                  change (Paper)
//   your scripts   </> in a SQUARE (Accent)
//
// The ink inside is dark on a light fill and white on a dark one (the luminance
// test Vela's own lane used). Colours come from tokens.css through tokenHex.
// ─────────────────────────────────────────────────────────────────────────────

import { tokenHex } from '@/design/theme'
import type { EvKind } from './index'

type Shape = 'circle' | 'diamond' | 'square'
interface Icon {
  /** SVG path data. */
  d?: string
  /** Text instead (the whale's $). */
  text?: string
  mode: 'fill' | 'stroke'
  /** The box the path is drawn in: 12 (the level marks, levelMarks.ts) or 16. */
  box: 12 | 16
  width?: number
}

const ICONS: Record<string, Icon> = {
  cal: { d: 'M5.4 5.2h5.2a1 1 0 0 1 1 1v4.4a1 1 0 0 1-1 1H5.4a1 1 0 0 1-1-1V6.2a1 1 0 0 1 1-1ZM4.4 7.6h7.2M6.3 4v2M9.7 4v2', mode: 'stroke', box: 16, width: 1.5 },
  // levelMarks.ts's ★ and ⚡, the same paths
  star: { d: 'M6 .85 7.32 4.53l3.91.12-3.09 2.4 1.09 3.75L6 8.6l-3.23 2.2 1.09-3.75-3.09-2.4 3.91-.12Z', mode: 'fill', box: 12 },
  bolt: { d: 'M7.4.5 1.9 7h3.5l-1 4.5L10.1 5H6.5Z', mode: 'fill', box: 12 },
  bracket: { d: 'M6.2 4.6H4.8v6.8h1.4M9.8 4.6h1.4v6.8H9.8', mode: 'stroke', box: 16, width: 1.6 },
  dollar: { text: '$', mode: 'fill', box: 16 },
  bars: { d: 'M4.6 10.8h1.6V8.2H4.6zM7.2 10.8h1.6V5.2H7.2zM9.8 10.8h1.6V7H9.8z', mode: 'fill', box: 16 },
  code: { d: 'M6.2 5.6 3.9 8l2.3 2.4M9.8 5.6 12.1 8l-2.3 2.4', mode: 'stroke', box: 16, width: 1.5 },
}

export interface Look {
  shape: Shape
  token: string
  icon: keyof typeof ICONS
}

export const LOOK: Record<EvKind, Look> = {
  high: { shape: 'circle', token: '--color-vt-bad', icon: 'cal' },
  med: { shape: 'circle', token: '--color-vt-accent-text', icon: 'cal' },
  low: { shape: 'circle', token: '--color-vt-quiet', icon: 'cal' },
  volt: { shape: 'diamond', token: '--color-vt-volt', icon: 'star' },
  flip: { shape: 'diamond', token: '--color-vt-flip', icon: 'bolt' },
  ib: { shape: 'diamond', token: '--color-vt-slate', icon: 'bracket' },
  whale: { shape: 'diamond', token: '--color-vt-accent-text', icon: 'dollar' },
  gex: { shape: 'diamond', token: '--color-vt-paper', icon: 'bars' },
  script: { shape: 'square', token: '--color-vt-accent', icon: 'code' },
}

/** Which mark a crowded spot shows: the one that matters most. */
export const PRIORITY: readonly EvKind[] = ['high', 'volt', 'flip', 'med', 'ib', 'whale', 'gex', 'script', 'low']

/** Dark ink on a light fill, white on a dark one. */
export function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex)
  if (!m) return tokenHex('--color-vt-ink')
  const lin = (c: string) => {
    const v = parseInt(c, 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lin(m[1]!) + 0.7152 * lin(m[2]!) + 0.0722 * lin(m[3]!)
  return L >= 0.4 ? tokenHex('--color-vt-ink') : tokenHex('--color-vt-paper')
}

// ── SVG (cards, the legend card) ─────────────────────────────────────────────

function shapeSvg(shape: Shape, fill: string): string {
  if (shape === 'circle') return `<circle cx="8" cy="8" r="7.3" fill="${fill}"/>`
  if (shape === 'diamond') return `<path d="M8 .4 15.6 8 8 15.6.4 8Z" fill="${fill}"/>`
  return `<rect x="1" y="1" width="14" height="14" rx="3" fill="${fill}"/>`
}

function iconSvg(icon: Icon, ink: string): string {
  if (icon.text) {
    return `<text x="8" y="11.4" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-weight="800" font-size="9" fill="${ink}">${icon.text}</text>`
  }
  const t = icon.box === 12 ? ' transform="translate(3.2 3.2) scale(.8)"' : ''
  return icon.mode === 'fill'
    ? `<path${t} d="${icon.d}" fill="${ink}"/>`
    : `<path${t} d="${icon.d}" fill="none" stroke="${ink}" stroke-width="${icon.width ?? 1.5}" stroke-linecap="round" stroke-linejoin="round"/>`
}

/** A kind's mark as SVG markup, `px` square (constant markup from our own table: safe for innerHTML). */
export function markSvgOf(kind: EvKind, px: number): string {
  const look = LOOK[kind]
  const fill = tokenHex(look.token)
  return `<svg class="cb-evm" viewBox="0 0 16 16" width="${px}" height="${px}" aria-hidden="true" focusable="false">${shapeSvg(look.shape, fill)}${iconSvg(ICONS[look.icon]!, inkFor(fill))}</svg>`
}

// ── Canvas (the lane) ────────────────────────────────────────────────────────

const paths = new Map<string, Path2D>()
const pathOf = (d: string) => {
  let p = paths.get(d)
  if (!p) {
    p = new Path2D(d)
    paths.set(d, p)
  }
  return p
}

/** Draw `kind`'s mark centred on (x, y), `px` square. `hot` lights it (the pointer is on it). */
export function paintMark(ctx: CanvasRenderingContext2D, kind: EvKind, x: number, y: number, px: number, hot: boolean, monoFont: string): void {
  const look = LOOK[kind]
  const fill = tokenHex(look.token)
  const ink = inkFor(fill)
  const k = px / 16
  ctx.save()
  ctx.translate(x - px / 2, y - px / 2)
  ctx.scale(k, k)
  ctx.beginPath()
  if (look.shape === 'circle') ctx.arc(8, 8, 7.3, 0, Math.PI * 2)
  else if (look.shape === 'diamond') {
    ctx.moveTo(8, 0.4)
    ctx.lineTo(15.6, 8)
    ctx.lineTo(8, 15.6)
    ctx.lineTo(0.4, 8)
    ctx.closePath()
  } else ctx.roundRect(1, 1, 14, 14, 3)
  ctx.fillStyle = fill
  ctx.fill()
  if (hot) {
    ctx.lineWidth = 1.6 / k
    ctx.strokeStyle = tokenHex('--color-vt-paper')
    ctx.stroke()
  }
  const icon = ICONS[look.icon]!
  ctx.fillStyle = ink
  ctx.strokeStyle = ink
  if (icon.text) {
    ctx.font = `800 9px ${monoFont}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(icon.text, 8, 11.4)
  } else if (icon.d) {
    if (icon.box === 12) {
      ctx.translate(3.2, 3.2)
      ctx.scale(0.8, 0.8)
    }
    if (icon.mode === 'fill') ctx.fill(pathOf(icon.d))
    else {
      ctx.lineWidth = (icon.width ?? 1.5) / (icon.box === 12 ? 0.8 : 1)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke(pathOf(icon.d))
    }
  }
  ctx.restore()
}

/** A crowded spot's count, on the mark's top-right corner. */
export function paintCount(ctx: CanvasRenderingContext2D, n: number, x: number, y: number, px: number, monoFont: string): void {
  const text = n > 9 ? '9+' : String(n)
  ctx.save()
  ctx.font = `800 8.5px ${monoFont}`
  const w = Math.max(12, ctx.measureText(text).width + 5)
  const cx = x + px / 2 + 1
  const cy = y - px / 2 + 1
  ctx.beginPath()
  ctx.roundRect(cx - w / 2, cy - 6, w, 12, 6)
  ctx.fillStyle = tokenHex('--color-vt-paper')
  ctx.fill()
  ctx.fillStyle = tokenHex('--color-vt-ink')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, cx, cy + 0.5)
  ctx.restore()
}
