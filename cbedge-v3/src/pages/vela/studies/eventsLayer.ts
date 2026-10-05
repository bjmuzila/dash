// ─────────────────────────────────────────────────────────────────────────────
// CB EVENTS, DRAWN: the renderer layer the Events study (events.ts) pushes its
// marks to. It repaints on every pan / zoom frame and as the pointer moves.
//
//   · the lane   one mark per spot along the bottom of the price pane, 4px up
//                from its edge (where Vela's own lane sat). Marks closer than a
//                mark's width crowd into one spot: it shows the kind that
//                matters most (eventIcons.ts PRIORITY) with a count on its corner
//   · hover      a one-line note beside it ("Tue 10:00 · JOLTS Job Openings")
//   · click      a card: the release's actual / forecast / previous (the actual
//                ▲ above or ▼ below the forecast), or the alert's what and level;
//                a crowded spot lists every mark in it. "Hide …" turns that kind
//                off on this chart (the study's own input, eventsHost.ts)
//
// A press on a mark is the mark's: it never starts a pan or reaches a drawing
// tool. Anywhere else the chart gets the pointer as usual.
// ─────────────────────────────────────────────────────────────────────────────

import type { RendererLayerArgs, RendererLayerInstance } from '@luxalgo/vela/plugin'
import type { EventMark } from '@/pages/vela/marks'
import { setEventsInput } from './eventsHost'
import { PRIORITY, markSvgOf, paintCount, paintMark } from './eventIcons'
import type { EvKind } from './index'

export interface EventsPayload {
  /** The study instance, for "Hide …". */
  id: string
  /** The mark's side, px. */
  px: number
  /** Each mark with its logical bar index (past the newest bar for one still to come). */
  marks: Array<{ m: EventMark; li: number }>
}

const INSET = 4

const HIDE_LABEL: Record<EvKind, string> = {
  high: 'Hide high impact',
  med: 'Hide medium impact',
  low: 'Hide low impact',
  volt: 'Hide Volt alerts',
  flip: 'Hide Flip alerts',
  ib: 'Hide IB alerts',
  whale: 'Hide whale prints',
  gex: 'Hide top GEX change',
  script: 'Hide script alerts',
}
const IMPACT: Partial<Record<EvKind, string>> = { high: 'HIGH', med: 'MEDIUM', low: 'LOW' }

function isPayload(v: unknown): v is EventsPayload {
  return !!v && typeof v === 'object' && Array.isArray((v as EventsPayload).marks)
}

interface Spot {
  x: number
  y: number
  list: EventMark[]
  top: EventMark
}

// ── time, in ET (the calendar's own zone) ──

const ET_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
function etWhen(m: EventMark, withZone = true): string {
  const p: Record<string, string> = {}
  for (const x of ET_FMT.formatToParts(m.t)) p[x.type] = x.value
  if (m.allDay) return `${p.weekday} · all day`
  return `${p.weekday} ${p.hour}:${p.minute}${withZone ? ' ET' : ''}`
}

/** "7.31M" → 7.31e6, "-71.2B", "0.3%", "224K". Null when it is not a number. */
function num(s: string | undefined): number | null {
  if (!s) return null
  const m = /^\s*([+-−]?)\$?([\d,]*\.?\d+)\s*([KMBT%]?)/i.exec(s)
  if (!m) return null
  const v = Number(m[2]!.replace(/,/g, '')) * (m[1] === '-' || m[1] === '−' ? -1 : 1)
  const mul = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[3]!.toUpperCase() as 'K' | 'M' | 'B' | 'T'] ?? 1
  return Number.isFinite(v) ? v * mul : null
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}

/** One mark's heading row: its icon and title. */
function headOf(m: EventMark, px: number): HTMLElement {
  const h = el('div', 'cb-ev-t')
  h.insertAdjacentHTML('afterbegin', markSvgOf(m.kind, px))
  h.append(el('span', '', m.title))
  return h
}

/** The "Tue 10:00 ET · HIGH" line. */
function whenOf(m: EventMark): HTMLElement {
  const w = el('div', 'cb-ev-when')
  if (m.group === 'econ') {
    w.append(document.createTextNode(`${etWhen(m)} · `))
    const pill = el('span', 'cb-ev-imp', IMPACT[m.kind] ?? '')
    pill.dataset.k = m.kind
    w.append(pill)
  } else w.textContent = `${m.group === 'script' ? 'Your script alert' : 'Engine alert'} · ${etWhen(m)}`
  return w
}

function rowsOf(m: EventMark): HTMLElement | null {
  const rows = el('div', 'cb-ev-rows')
  const add = (k: string, v: string, cls = '') => rows.append(el('span', 'cb-ev-k', k), el('span', `cb-ev-v ${cls}`.trim(), v))
  if (m.group === 'econ') {
    if (m.actual) {
      const a = num(m.actual)
      const f = num(m.forecast)
      if (a != null && f != null && a !== f) add('Actual', `${m.actual} ${a > f ? '▲ above forecast' : '▼ below forecast'}`, a > f ? 'up' : 'down')
      else add('Actual', m.actual)
    } else if (m.t > Date.now()) add('Actual', `due ${etWhen(m, false)}`, 'quiet')
    if (m.forecast) add('Forecast', m.forecast)
    if (m.previous) add('Previous', m.previous)
  } else {
    if (m.text) add('What', m.text, 'text')
    if (m.level) add('Level', m.level)
  }
  return rows.childElementCount ? rows : null
}

/** The card a click opens. */
function cardOf(spot: Spot, id: string, onHide: () => void): HTMLElement {
  const card = el('div', 'cb-ev-card')
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-label', spot.list.length > 1 ? `${spot.list.length} events` : spot.top.title)
  if (spot.list.length === 1) {
    const m = spot.top
    card.append(headOf(m, 16), whenOf(m))
    const rows = rowsOf(m)
    if (rows) card.append(rows)
  } else {
    card.append(el('div', 'cb-ev-t', `${spot.list.length} at ${etWhen(spot.list[0]!)}`))
    const list = el('div', 'cb-ev-list')
    for (const m of spot.list) {
      const item = el('div', 'cb-ev-item')
      item.append(headOf(m, 14))
      const bits =
        m.group === 'econ'
          ? [IMPACT[m.kind] ? `${IMPACT[m.kind]!.toLowerCase()} impact` : '', m.actual ? `Actual ${m.actual}` : '', m.forecast ? `Forecast ${m.forecast}` : '', m.previous ? `Previous ${m.previous}` : '']
          : [etWhen(m), m.level ?? '']
      const line = bits.filter(Boolean).join(' · ')
      if (line) item.append(el('div', 'cb-ev-when', line))
      list.append(item)
    }
    card.append(list)
  }
  const btns = el('div', 'cb-ev-btns')
  const hide = el('button', 'cb-ev-btn', HIDE_LABEL[spot.top.kind])
  hide.type = 'button'
  hide.addEventListener('click', () => {
    setEventsInput(id, spot.top.kind, false)
    onHide()
  })
  btns.append(hide)
  card.append(btns)
  return card
}

let monoMemo = ''
function monoFont(canvas: HTMLCanvasElement): string {
  if (monoMemo) return monoMemo
  try {
    monoMemo = getComputedStyle(canvas).getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace'
  } catch {
    monoMemo = 'ui-monospace, monospace'
  }
  return monoMemo
}

export class EventsLayer implements RendererLayerInstance {
  private canvas: HTMLCanvasElement | null = null
  private spots: Spot[] = []
  private payload: EventsPayload | null = null
  private tip: HTMLDivElement | null = null
  private card: { el: HTMLElement; spot: Spot; close: () => void } | null = null
  private pressed: Spot | null = null
  private offs: Array<() => void> = []

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    const host = canvas.parentElement
    if (!host) return
    const on = <K extends keyof HTMLElementEventMap>(t: K, fn: (e: HTMLElementEventMap[K]) => void, capture = true) => {
      host.addEventListener(t, fn as EventListener, capture)
      this.offs.push(() => host.removeEventListener(t, fn as EventListener, capture))
    }
    on('pointerdown', (e) => {
      if (e.button !== 0) return
      const spot = this.spotAt(e.clientX, e.clientY)
      if (!spot) return
      // the press is the mark's: no pan, no drawing tool
      e.stopPropagation()
      e.preventDefault()
      this.pressed = spot
    })
    on('pointerup', (e) => {
      const spot = this.pressed
      if (!spot) return
      this.pressed = null
      e.stopPropagation()
      if (this.spotAt(e.clientX, e.clientY) === spot) this.openCard(spot)
    })
    on('click', (e) => {
      if (this.spotAt(e.clientX, e.clientY)) e.stopPropagation()
    })
    on('pointerleave', () => this.hideTip(), false)
    on('wheel', () => this.closeCard(), false)
  }

  /** The spot under a page point, if any. */
  private spotAt(cx: number, cy: number): Spot | null {
    const c = this.canvas
    if (!c || !this.payload) return null
    const r = c.getBoundingClientRect()
    const x = cx - r.left
    const y = cy - r.top
    const half = this.payload.px / 2 + 2
    for (let i = this.spots.length - 1; i >= 0; i--) {
      const s = this.spots[i]!
      if (Math.abs(x - s.x) <= half && Math.abs(y - s.y) <= half) return s
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
    if (!isPayload(d) || !d.marks.length) {
      this.payload = isPayload(d) ? d : null
      this.spots = []
      this.hideTip()
      if (!this.payload) this.closeCard()
      return
    }
    this.payload = d
    const { coords, bounds, cursor } = args
    const dpr = coords.dpr || 1
    const px = d.px
    const y = bounds.top + bounds.height - INSET - px / 2
    // spots: marks closer than a mark's width crowd into one
    const spots: Spot[] = []
    for (const { m, li } of d.marks) {
      const x = coords.logicalToX(li)
      if (!Number.isFinite(x) || x < -px || x > coords.width + px) continue
      const last = spots[spots.length - 1]
      if (last && x - last.x < px + 2) last.list.push(m)
      else spots.push({ x, y, list: [m], top: m })
    }
    for (const s of spots) {
      let best = s.list[0]!
      for (const m of s.list) if (PRIORITY.indexOf(m.kind) < PRIORITY.indexOf(best.kind)) best = m
      s.top = best
    }
    this.spots = spots

    let hover: Spot | null = null
    if (cursor) {
      const half = px / 2 + 2
      for (let i = spots.length - 1; i >= 0; i--) {
        const s = spots[i]!
        if (Math.abs(cursor.x - s.x) <= half && Math.abs(cursor.y - s.y) <= half) {
          hover = s
          break
        }
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.save()
    // the price pane only: never over the price axis or a study pane
    ctx.beginPath()
    ctx.rect(0, bounds.top, coords.width, bounds.height)
    ctx.clip()
    const font = monoFont(canvas)
    const open = this.card?.spot.top.id
    for (const s of spots) {
      paintMark(ctx, s.top.kind, s.x, s.y, px, s === hover || s.top.id === open, font)
      if (s.list.length > 1) paintCount(ctx, s.list.length, s.x, s.y, px, font)
    }
    ctx.restore()

    if (hover) this.showTip(hover, px)
    else this.hideTip()
  }

  // ── the hover line ──

  private showTip(s: Spot, px: number): void {
    const c = this.canvas
    if (!c || this.card?.spot.top.id === s.top.id) return this.hideTip()
    let tip = this.tip
    if (!tip || !tip.isConnected) {
      tip = this.tip = el('div', 'cb-ev-tip')
      tip.setAttribute('role', 'tooltip')
      document.body.appendChild(tip)
    }
    const text = s.list.length > 1 ? `${s.list.length} events · ${s.list.map((m) => m.title).join(' · ')}` : `${etWhen(s.top, false)} · ${s.top.title}`
    if (tip.textContent !== text) tip.textContent = text
    tip.hidden = false
    const r = c.getBoundingClientRect()
    const w = tip.offsetWidth
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + s.x - w / 2))
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(r.top + s.y - px / 2 - tip.offsetHeight - 6)}px)`
  }

  private hideTip(): void {
    if (this.tip) this.tip.hidden = true
  }

  // ── the card ──

  private openCard(s: Spot): void {
    const c = this.canvas
    const id = this.payload?.id
    if (!c || !id) return
    const same = this.card && this.card.spot.top.id === s.top.id && this.card.spot.list.length === s.list.length
    this.closeCard()
    if (same) return
    this.hideTip()
    const card = cardOf(s, id, () => this.closeCard())
    document.body.appendChild(card)
    const r = c.getBoundingClientRect()
    const w = card.offsetWidth
    const h = card.offsetHeight
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + s.x - w / 2))
    const top = Math.max(8, r.top + s.y - (this.payload?.px ?? 16) / 2 - h - 10)
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
    const onDown = (e: PointerEvent) => {
      if (!card.contains(e.target as Node) && this.spotAt(e.clientX, e.clientY)?.top.id !== s.top.id) this.closeCard()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.closeCard()
    }
    const onResize = () => this.closeCard()
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    this.card = {
      el: card,
      spot: s,
      close: () => {
        document.removeEventListener('pointerdown', onDown, true)
        document.removeEventListener('keydown', onKey, true)
        window.removeEventListener('resize', onResize)
        card.remove()
      },
    }
  }

  private closeCard(): void {
    const c = this.card
    this.card = null
    c?.close()
  }

  destroy(): void {
    for (const off of this.offs) off()
    this.offs = []
    this.closeCard()
    this.tip?.remove()
    this.tip = null
    this.canvas = null
  }
}

