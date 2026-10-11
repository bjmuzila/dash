// ─────────────────────────────────────────────────────────────────────────────
// CB WHALE PRINTS — the bubbles. The renderer layer the Whale Prints study
// (flow.ts) pushes its bubbles to; it repaints them on every pan / zoom frame
// and on pointer moves, for the hover card.
//
//   ● one bubble per print, CENTRED on the moment it printed (placed across its
//     candle by time: open at the left edge, close at the right) and the
//     underlying's price then — green bullish, red bearish, grey side unknown.
//     Pieces of one order (same minute, same side) are one bubble
//   ● the premium written inside when it fits ("Premium in the bubble")
//   ● hover: the CONTEXT CARD (W3, picked 2026-10-06 from the whale pop-up
//     mockup, generated/2026-10-06-vela-whale-pop-r1.html) — what the print
//     means, not just what it was:
//       Put sold · bullish                       +$5.6M
//       TAPE THAT DAY · 62% BULL   ▬▬▬▬▬▬▬▬▬|▬▬▬   (whale premium bullish, to here)
//       STRIKE 736   EXPIRY Nov 20   DTE 46   OTM 4.6%
//       SIZE 1,240   PRICE 45.20     SPOT 774.90   TIME 4:10 PM
//       Mon, Oct 5                                 #3 today
//     A cluster (one order in pieces) lists its prints instead of the grid:
//     ▲ bought / ▼ sold, contract, DTE, premium; the footer has the time span and
//     the underlying's price. Cards without `ctx` (the journal markers) keep the
//     plain layout: side and net, when, one line per print.
//   ● click: nothing. A bubble does not leave the chart (Brandon, 2026-10-04:
//     it used to open the print on the Whales page); the card is the detail.
//
// SIZE (flow.ts bubbleRadius): AREA follows premium — r = R_MAX·√(net / cap) —
// clamped to [R_MIN, R_MAX], then the Bubble size % setting. With the defaults
// (cap $25M): $1M → 5px, $2.5M → 8px, $5M → 12px, $10M → 16px, $25M+ → 26px.
//
// The bigger bubbles draw first, so a small one sitting on a big one stays on
// top — and is what the pointer finds.
//
// OPACITY (2026-10-05, Brandon: "needs a transparency setting, to make them
// darker or less see-through"): the study's Bubble opacity % is the FILL of a
// bullish / bearish bubble (30% by default — the look they always had; 100% is
// solid). A grey side-unknown bubble keeps its old proportion of that (about
// half), a hovered one fills a step more, and the outline is unchanged, so even a
// very faint bubble keeps its edge.
// ─────────────────────────────────────────────────────────────────────────────

import type { RendererLayerArgs, RendererLayerInstance } from '@luxalgo/vela/plugin'
import { tokenRgb, type RGB } from '@/design/theme'

export type Tone = 'up' | 'down' | 'mid'

export interface WhaleCardRow {
  text: string
  amount: string
  tone: Tone
}

/** One print in a cluster's list (the context card). */
export interface WhaleCtxLine {
  /** `▲ 765 P · Oct 9` */
  text: string
  /** `3 DTE` ('' when unknown) */
  dte: string
  /** Where it filled: `Above ask` · `Ask` · `Mid` · `Bid` · `Below bid` ('' when unknown) */
  fill: string
  amount: string
  tone: Tone
}

/** The context card's body (W3). */
export interface WhaleContext {
  /** `Put sold · bullish`, `3 prints · bearish` */
  title: string
  /** Bullish share of that day's whale premium up to this bubble, 0..1 (null = none). */
  lean: number | null
  /** One print: the label / value grid (STRIKE, EXPIRY, DTE, OTM, SIZE, PRICE, SPOT, TIME). */
  cells: { k: string; v: string }[]
  /** A cluster: its prints, biggest first. */
  lines: WhaleCtxLine[]
  /** Left of the footer: the date, or (a cluster) the time span and price. */
  foot: string
  /** Right of the footer: `#3 today`. */
  rank: string
}

export interface WhaleBubble {
  id: string
  /** When it printed (ms) — the bubble's centre, placed inside its candle by time. */
  t: number
  /** The underlying's price then, in this chart's prices — the bubble's centre. */
  price: number
  /** Radius in CSS px, size setting applied. */
  r: number
  tone: Tone
  /** Written inside when it fits ('' = never). */
  label: string
  card: { head: string; net: string; when: string; rows: WhaleCardRow[]; more: number; ctx?: WhaleContext }
}

export interface WhalePayload {
  bubbles: WhaleBubble[]
  /** Fill opacity 0..1 — the study's Bubble opacity % (0.3 when absent, how they always drew). */
  fill?: number
  /**
   * The Price zone (2026-10-10): a band as tall as the bubble, from its centre to the
   * plot's right edge — for the hovered bubble, every bubble, or none (absent: none,
   * so the journal markers that share this layer draw no zones).
   */
  zone?: 'hover' | 'all' | 'off'
}

/** The fill when the payload carries none. */
const FILL_DEF = 0.3

// green bullish, red bearish (data), Paper Quiet when the side is unknown
const TONE_TOKEN: Record<Tone, string> = { up: '--color-up', down: '--color-down', mid: '--color-vt-quiet' }

const hb = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
const hexA = (c: RGB, a: number) => `#${hb(c[0])}${hb(c[1])}${hb(c[2])}${hb(Math.max(0, Math.min(1, a)) * 255)}`

function isPayload(v: unknown): v is WhalePayload {
  return !!v && typeof v === 'object' && Array.isArray((v as WhalePayload).bubbles)
}

interface Placed {
  b: WhaleBubble
  x: number
  y: number
}

/** What the hover card shows: the whale bubbles' card, also used by the journal markers. */
export interface CardItem {
  id: string
  tone: Tone
  card: WhaleBubble['card']
}

function span(cls: string, text: string, tone?: Tone): HTMLSpanElement {
  const e = document.createElement('span')
  if (cls) e.className = cls
  e.textContent = text
  if (tone) e.dataset.tone = tone
  return e
}

function div(cls: string, ...kids: Node[]): HTMLDivElement {
  const e = document.createElement('div')
  e.className = cls
  e.append(...kids)
  return e
}

/** W3's body: title and net, the lean bar, the grid (or the cluster's prints), the footer. */
function contextCard(c: WhaleContext, net: string, more: number): HTMLElement[] {
  const out: HTMLElement[] = [div('cb-wh-head', span('cb-wh-title', c.title), span('cb-wh-net', net))]
  if (c.lean != null) {
    const pct = Math.round(c.lean * 100)
    const bar = div('cb-wh-lean')
    // red (bearish share) from the left, green (bullish share) to the right; the
    // marker sits where they meet, never flush on an end where it reads as the frame
    bar.style.setProperty('--cb-wh-lean', `${Math.max(3, Math.min(97, 100 - pct))}%`)
    bar.append(document.createElement('i'))
    out.push(div('cb-wh-leanlbl', span('', 'TAPE THAT DAY'), span('', `${pct}% BULL`)), bar)
  }
  if (c.cells.length) {
    out.push(div('cb-wh-grid', ...c.cells.map((x) => div('cb-wh-cell', span('cb-wh-k', x.k), span('cb-wh-v', x.v)))))
  }
  if (c.lines.length) {
    const list = div('cb-wh-list')
    for (const l of c.lines) list.append(span('cb-wh-lt', l.text), span('cb-wh-ld', l.dte), span('cb-wh-lf', l.fill || '—'), span('cb-wh-amt', l.amount, l.tone))
    out.push(list)
    if (more > 0) out.push(div('cb-wh-more', document.createTextNode(`+ ${more} more`)))
  }
  out.push(div('cb-wh-note', span('', c.foot), span('cb-wh-rank', c.rank)))
  return out
}

/** The hover card — one per layer, fixed to the page, never takes the pointer. */
export class HoverCard {
  private el: HTMLDivElement | null = null
  private shown = ''

  show(b: CardItem, left: number, top: number, r: number): void {
    if (typeof document === 'undefined') return
    let el = this.el
    if (!el || !el.isConnected) {
      el = this.el = document.createElement('div')
      el.className = 'cb-wh-card'
      // the box's own placement, inline: without its stylesheet the card would land in
      // the page flow, under everything, and nudge the layout on every hover
      el.style.cssText = 'position:fixed;left:0;top:0;z-index:70;pointer-events:none'
      el.setAttribute('role', 'tooltip')
      document.body.appendChild(el)
      this.shown = ''
    }
    if (this.shown !== b.id && b.card.ctx) {
      this.shown = b.id
      el.dataset.tone = b.tone
      el.classList.add('cb-wh-cx')
      el.replaceChildren(...contextCard(b.card.ctx, b.card.net, b.card.more))
    } else if (this.shown !== b.id) {
      this.shown = b.id
      el.dataset.tone = b.tone
      el.classList.remove('cb-wh-cx')
      const head = document.createElement('div')
      head.className = 'cb-wh-head'
      const side = document.createElement('span')
      side.className = 'cb-wh-side'
      side.textContent = b.card.head
      const net = document.createElement('span')
      net.className = 'cb-wh-net'
      net.textContent = b.card.net
      head.append(side, net)
      const when = document.createElement('div')
      when.className = 'cb-wh-when'
      when.textContent = b.card.when
      const rows = document.createElement('div')
      rows.className = 'cb-wh-rows'
      for (const r0 of b.card.rows) {
        const row = document.createElement('div')
        row.className = 'cb-wh-row'
        row.dataset.tone = r0.tone
        const t = document.createElement('span')
        t.textContent = r0.text
        const a = document.createElement('span')
        a.className = 'cb-wh-amt'
        a.textContent = r0.amount
        row.append(t, a)
        rows.append(row)
      }
      el.replaceChildren(head, when, rows)
      if (b.card.more > 0) {
        const more = document.createElement('div')
        more.className = 'cb-wh-more'
        more.textContent = `+ ${b.card.more} more`
        el.append(more)
      }
    }
    el.hidden = false
    // beside the bubble, flipped to stay on screen
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = left + r + 10
    if (x + w > vw - 8) x = left - r - 10 - w
    let y = top - h / 2
    y = Math.max(8, Math.min(vh - h - 8, y))
    el.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(y)}px)`
  }

  hide(): void {
    if (this.el) this.el.hidden = true
  }

  destroy(): void {
    this.el?.remove()
    this.el = null
  }
}

export class WhaleLayer implements RendererLayerInstance {
  private canvas: HTMLCanvasElement | null = null
  private readonly card = new HoverCard()
  private offLeave: (() => void) | null = null

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    // the pointer leaving the chart outright may not repaint the layers
    const host = canvas.parentElement
    if (host) {
      const leave = () => this.card.hide()
      host.addEventListener('pointerleave', leave)
      this.offLeave = () => host.removeEventListener('pointerleave', leave)
    }
  }

  render(args: RendererLayerArgs): void {
    const canvas = this.canvas
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const d = args.data
    if (!isPayload(d) || !d.bubbles.length) {
      this.card.hide()
      return
    }
    const { coords, scale, bounds, cursor } = args
    const dpr = coords.dpr || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.save()
    // the plot only — never over the price axis or a neighbouring pane
    ctx.beginPath()
    ctx.rect(0, bounds.top, coords.width, bounds.height)
    ctx.clip()

    const placed: Placed[] = []
    const bars = args.bars
    const tf = coords.barInterval || (bars.length > 1 ? bars[1]!.time - bars[0]!.time : 60_000)
    // a bubble scrolled off the left still has its zone running across the view (Every bubble)
    const offLeft: Placed[] = []
    for (const b of d.bubbles) {
      const x = xAt(b.t, bars, tf, coords)
      if (x == null || x > coords.width + b.r + 2) continue
      const y = coords.priceToY(b.price, scale, bounds)
      if (!Number.isFinite(y)) continue
      if (x < -b.r - 2) offLeft.push({ b, x, y })
      else placed.push({ b, x, y })
    }
    // biggest first: small bubbles stay on top, and are what the pointer finds
    placed.sort((p, q) => q.b.r - p.b.r)

    let hover: Placed | null = null
    if (cursor) {
      for (let i = placed.length - 1; i >= 0; i--) {
        const p = placed[i]!
        if (Math.hypot(cursor.x - p.x, cursor.y - p.y) <= p.b.r + 2) {
          hover = p
          break
        }
      }
    }

    const rgb: Record<Tone, RGB> = { up: tokenRgb(TONE_TOKEN.up), down: tokenRgb(TONE_TOKEN.down), mid: tokenRgb(TONE_TOKEN.mid) }
    const ink = tokenRgb('--color-fg')
    const font = getFont(canvas)
    const fill = Number.isFinite(d.fill) ? Math.max(0.05, Math.min(1, d.fill as number)) : FILL_DEF
    // the side-unknown share and the hover lift, as they were at the 30% default
    const fillMid = fill * (0.16 / FILL_DEF)
    const fillOn = Math.min(1, fill + (0.55 - FILL_DEF))
    // PRICE ZONES, under the bubbles: the bubble's height, from its centre to the
    // right edge, a faint fill between two edge lines (the hovered one stronger)
    const zone = d.zone ?? 'off'
    if (zone !== 'off') {
      const right = coords.width
      const band = (p: Placed, strong: boolean) => {
        if (p.x >= right) return
        const c = rgb[p.b.tone]
        const top = p.y - p.b.r
        const h = p.b.r * 2
        ctx.fillStyle = hexA(c, strong ? 0.14 : 0.07)
        ctx.fillRect(p.x, top, right - p.x, h)
        ctx.lineWidth = 1
        ctx.strokeStyle = hexA(c, strong ? 0.75 : 0.4)
        ctx.beginPath()
        ctx.moveTo(p.x, Math.round(top) + 0.5)
        ctx.lineTo(right, Math.round(top) + 0.5)
        ctx.moveTo(p.x, Math.round(top + h) - 0.5)
        ctx.lineTo(right, Math.round(top + h) - 0.5)
        ctx.stroke()
      }
      if (zone === 'all') {
        for (const p of offLeft) band(p, false)
        for (const p of placed) if (p !== hover) band(p, false)
      }
      if (hover) band(hover, true)
    }
    for (const p of placed) {
      const { b, x, y } = p
      const c = rgb[b.tone]
      const on = p === hover
      const mid = b.tone === 'mid'
      ctx.beginPath()
      ctx.arc(x, y, b.r, 0, Math.PI * 2)
      ctx.fillStyle = hexA(c, on ? fillOn : mid ? fillMid : fill)
      ctx.fill()
      ctx.lineWidth = on ? 2 : 1.25
      ctx.strokeStyle = hexA(c, mid ? 0.6 : 0.95)
      ctx.stroke()
      if (b.label && b.r >= 9) {
        const px = Math.max(9, Math.min(13, Math.round(b.r * 0.55)))
        ctx.font = `600 ${px}px ${font}`
        const w = ctx.measureText(b.label).width
        if (w <= b.r * 2 - 4) {
          ctx.fillStyle = hexA(ink, 0.95)
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(b.label, x, y + 0.5)
        }
      }
    }
    ctx.restore()

    if (hover) {
      const rect = canvas.getBoundingClientRect()
      this.card.show(hover.b, rect.left + hover.x, rect.top + hover.y, hover.b.r)
    } else this.card.hide()
  }

  destroy(): void {
    this.offLeave?.()
    this.offLeave = null
    this.card.destroy()
    this.canvas = null
  }
}

/**
 * The pixel x of a moment: inside the candle that holds it, from the candle's left
 * edge (its open) to its right edge (its close) — a 10:05 print on a 30-minute 10:00
 * candle sits a sixth of the way across it. A moment past the candle's end (a print
 * after the last regular-hours bar) stays on that candle's right edge.
 */
function xAt(t: number, bars: readonly { time: number }[], tf: number, coords: RendererLayerArgs['coords']): number | null {
  const n = bars.length
  if (!n || t < bars[0]!.time) return null
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bars[mid]!.time <= t) lo = mid
    else hi = mid - 1
  }
  const frac = Math.max(0, Math.min(1, (t - bars[lo]!.time) / (tf || 1)))
  const x = coords.logicalToX(lo - 0.5 + frac)
  return Number.isFinite(x) ? x : null
}

let fontMemo = ''
/** The page's UI font, once (the canvas inherits none). */
function getFont(canvas: HTMLCanvasElement): string {
  if (fontMemo) return fontMemo
  try {
    // Voltick: every number is mono, and the bubble's text is a premium
    fontMemo = getComputedStyle(canvas).getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace'
  } catch {
    fontMemo = 'system-ui, sans-serif'
  }
  return fontMemo
}
