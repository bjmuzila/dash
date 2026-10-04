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
//   ● hover: a small card — the side and net, when, and one line per print
//     ("Bought 758 Call · Oct 5   $1.4M")
//   ● click: opens that print on the Whales page (its day, its ticker, the
//     contract's probe open). A drag still pans the chart.
//
// SIZE (flow.ts bubbleRadius): AREA follows premium — r = R_MAX·√(net / cap) —
// clamped to [R_MIN, R_MAX], then the Bubble size % setting. With the defaults
// (cap $25M): $1M → 5px, $2.5M → 8px, $5M → 12px, $10M → 16px, $25M+ → 26px.
//
// The bigger bubbles draw first, so a small one sitting on a big one stays on
// top — and is what the pointer finds.
// ─────────────────────────────────────────────────────────────────────────────

import type { RendererLayerArgs, RendererLayerInstance } from '@luxalgo/vela/plugin'
import { tokenRgb, type RGB } from '@/design/theme'
import { goTo } from '@/pages/vela/nav'

export type Tone = 'up' | 'down' | 'mid'

export interface WhaleCardRow {
  text: string
  amount: string
  tone: Tone
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
  card: { head: string; net: string; when: string; rows: WhaleCardRow[]; more: number }
  /** Where a click goes: the biggest print in the bubble, on the Whales page. */
  link?: { ticker: string; day: string; ts: number; osi: string | null }
}

export interface WhalePayload {
  bubbles: WhaleBubble[]
}

const TONE_TOKEN: Record<Tone, string> = { up: '--color-up', down: '--color-down', mid: '--color-muted' }

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
    if (this.shown !== b.id) {
      this.shown = b.id
      el.dataset.tone = b.tone
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
  /** The bubbles where they were last drawn, smallest last (what a click hits first). */
  private placed: Placed[] = []

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    // the pointer leaving the chart outright may not repaint the layers
    const host = canvas.parentElement
    if (host) {
      const leave = () => this.card.hide()
      let down: { x: number; y: number; t: number } | null = null
      const onDown = (e: PointerEvent) => {
        down = e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null
      }
      const onUp = (e: PointerEvent) => {
        const d = down
        down = null
        if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 700) return
        const hit = this.hitAt(e.clientX, e.clientY)
        if (!hit?.b.link) return
        const l = hit.b.link
        this.card.hide()
        goTo('/whales', { ticker: l.ticker, day: l.day, ts: l.ts, osi: l.osi })
      }
      host.addEventListener('pointerleave', leave)
      host.addEventListener('pointerdown', onDown, true)
      host.addEventListener('pointerup', onUp, true)
      this.offLeave = () => {
        host.removeEventListener('pointerleave', leave)
        host.removeEventListener('pointerdown', onDown, true)
        host.removeEventListener('pointerup', onUp, true)
      }
    }
  }

  private hitAt(clientX: number, clientY: number): Placed | null {
    const canvas = this.canvas
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    for (let i = this.placed.length - 1; i >= 0; i--) {
      const p = this.placed[i]!
      if (Math.hypot(x - p.x, y - p.y) <= p.b.r + 2) return p
    }
    return null
  }

  render(args: RendererLayerArgs): void {
    const canvas = this.canvas
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const d = args.data
    if (!isPayload(d) || !d.bubbles.length) {
      this.placed = []
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
    for (const b of d.bubbles) {
      const x = xAt(b.t, bars, tf, coords)
      if (x == null || x < -b.r - 2 || x > coords.width + b.r + 2) continue
      const y = coords.priceToY(b.price, scale, bounds)
      if (!Number.isFinite(y)) continue
      placed.push({ b, x, y })
    }
    // biggest first: small bubbles stay on top, and are what the pointer finds
    placed.sort((p, q) => q.b.r - p.b.r)
    this.placed = placed

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
    for (const p of placed) {
      const { b, x, y } = p
      const c = rgb[b.tone]
      const on = p === hover
      const mid = b.tone === 'mid'
      ctx.beginPath()
      ctx.arc(x, y, b.r, 0, Math.PI * 2)
      ctx.fillStyle = hexA(c, on ? 0.55 : mid ? 0.16 : 0.3)
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
    fontMemo = getComputedStyle(canvas).fontFamily || 'system-ui, sans-serif'
  } catch {
    fontMemo = 'system-ui, sans-serif'
  }
  return fontMemo
}
