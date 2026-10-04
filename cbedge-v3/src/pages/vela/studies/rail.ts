// ─────────────────────────────────────────────────────────────────────────────
// CB GEX RAIL: the GEX Candles card's strike rail, beside a Vela chart.
//
// Same rail as the home board: a 96px column to the right of the price axis,
// one row per strike at exactly that strike's height on the chart. Each row
// has the level tag (CB / CW / PW, or Voltick's marks on the Voltick theme) and
// one bar growing right, sized by |GEX| against the biggest on the ladder,
// coloured by sign. Hover a row for the strike and its value. Built with the
// card's own buildRail, so the two rails always agree on which strike is CB.
//
// VOLTICK (the page pins it): the rail is the named levels and nothing else,
// read by the definition (data/voltickLevels.ts vtFromLadder) off the column's
// live book (OI + vol), whatever the GEX setting: ★ Volt = the top net GEX,
// ◆ Coil = the 2nd top on the Volt's side of spot, ↘ Reversal = the top across
// spot. ↯ Surge (the biggest volume GEX) keeps the Voltick bot's read.
//
// WHERE IT SITS. Vela draws the whole chart (plot, price axis, time axis) on
// canvases inside one absolutely placed box. The rail pulls that box in from
// the right by its width (Vela re-sizes to it, the same way it follows any
// resize) and fills the gap with a DOM column. Nothing covers the candles.
// Removing the study gives the width back.
//
// ROWS FOLLOW THE CHART. The row positions are set from the renderer layer's
// own `priceToY` on every frame Vela paints (pan, zoom, autoscale), straight on
// the DOM, never through React, the same rule the card's RailSink follows.
// Rows are placed in priority order (tagged levels first, then by size), and a
// row that would land within a row's height of one already placed is hidden.
// A squeeze therefore drops the small strikes, never the core.
//
// DATA. The newest per-minute column of the session (studies/ladder.ts),
// re-read every minute. During a bar replay it is the column at the replay
// clock, so the rail rewinds with the candles. The header names the column's
// time. On ES / NQ the strikes are SPX / NDX moved by that session's basis.
//
// Too narrow (the phone, a small grid cell): no rail. The card does the same
// on a phone.
// ─────────────────────────────────────────────────────────────────────────────

import type { RendererLayerArgs, RendererLayerInstance } from '@luxalgo/vela/plugin'
import { buildRail, type RailLevels } from '@/board/gexCandles/GexRail'
import { voltickMarks, vtFromLadder, vtLevelsAt, type VoltickMarks } from '@/data/voltickLevels'
import { uiThemeNow } from '@/design/uiTheme'
import { bool, int, provideLayer, str, studyImpl, type StudyCtx } from './common'
import { GEX_BASIS, RAIL_TYPE } from './index'
import { columnsUntil, ladderKey, loadLadder, sessionDates, type Ladder } from './ladder'

const ROW_H = 15
/** The header line's height: rows above it are dropped. */
const HEAD_H = 16
/** Below this cell width the rail stays off. */
const MIN_CELL = 520

interface RailS {
  metric: 'net' | 'vol' | 'oi'
  tags: boolean
  width: number
}

export interface RailRowOut {
  strike: number
  /** In this chart's prices (basis applied). */
  price: number
  value: number
  tags: { key: string; text: string; title: string; fill?: string; ink?: string }[]
}

export interface RailPayload {
  width: number
  head: string
  rows: RailRowOut[]
  maxAbs: number
  /** Placement priority: row strikes, most important first. */
  order: number[]
  /** Shown instead of rows. */
  empty: string
  /** Changes whenever the rows do (rebuild the DOM only then). */
  key: string
}

const TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false })

const TAG_TITLE: Record<string, string> = { cb: 'Core: biggest magnet', cw: 'Call wall: ceiling', pw: 'Put wall: floor' }

function fmt(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '0'
  const a = Math.abs(v)
  const s = v > 0 ? '+' : '−'
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(0)}M`
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(0)}K`
  return `${s}${a.toFixed(0)}`
}

/** The session the rail reads: the replay's day, or the newest on the chart. */
function railDay(c: StudyCtx): string[] {
  return sessionDates(c, 1)
}

export const railImpl = studyImpl<RailS, Ladder>({
  settings: (i) => {
    const b = str(i.basis, GEX_BASIS[0])
    return {
      metric: b === GEX_BASIS[2] ? 'vol' : b === GEX_BASIS[1] ? 'oi' : 'net',
      tags: bool(i.tags, true),
      width: int(i.width, 96, 72, 180),
    }
  },
  dataKey: (c) => `${ladderKey(c)}|${railDay(c).join(',')}`,
  load: (c, _s, fresh) => loadLadder(c, railDay(c), fresh),
  refreshMs: 60_000,
  // the replay clock moves the column the rail reads; live, a new minute's column arrives by refresh
  everyTick: true,
  render: () => ({}),
  layer: (c, s, lad): RailPayload => {
    const base = { width: s.width, rows: [], maxAbs: 0, order: [], key: '' }
    if (!lad) return { ...base, head: '', empty: 'Loading the ladder…' }
    const cols = columnsUntil(lad.columns, c.until)
    const col = cols[cols.length - 1]
    if (!col) {
      const day = railDay(c)[0] ?? ''
      return { ...base, head: `${lad.label} GEX`, empty: lad.missing.length ? `No ladder recorded for ${day}` : 'No ladder yet' }
    }
    const shift = lad.shift(col.slotTs)
    if (shift == null) return { ...base, head: `${lad.label} GEX`, empty: 'No futures basis for this session' }
    // buildRail reads `net` (OI + vol) or `netVol` (vol); OI only is the difference
    const cells = s.metric === 'oi' ? col.cells.map((x) => ({ ...x, net: x.net - x.netVol })) : col.cells
    const voltick = uiThemeNow() === 'voltick'
    const model = buildRail([{ ...col, cells }], s.metric === 'vol' ? 'vol' : 'voloi', false)
    // a copy: buildRail hands back a shared empty model when the column is empty
    const lv: RailLevels = { ...model.levels }
    let shown = model.rows
    if (voltick) {
      const def = vtFromLadder(col.cells.map((x) => ({ strike: x.strike, net: x.net })), model.spot)
      const surge = voltickMarks(col.cells.map((x) => ({ strike: x.strike, book: x.net, vol: x.netVol })), { always: true }).surge
      const vt: VoltickMarks = { volt: def.volt, coil: def.coil, reversal: def.reversal, surge, coils: def.coil != null ? [def.coil] : [] }
      lv.vt = vt
      const keep = new Set([vt.volt, vt.surge, vt.reversal, vt.coil].filter((k): k is number => k != null))
      shown = model.rows.filter((r) => keep.has(r.strike))
    }
    const rows: RailRowOut[] = shown.map((r) => {
      const tags: RailRowOut['tags'] = []
      if (s.tags) {
        if (lv.vt) {
          for (const m of vtLevelsAt(lv.vt, r.strike)) tags.push({ key: m.key, text: m.mark, title: m.title, fill: m.fill, ink: m.ink })
        } else {
          for (const k of ['cb', 'cw', 'pw'] as const) if (lv[k] === r.strike) tags.push({ key: k, text: k.toUpperCase(), title: TAG_TITLE[k]! })
        }
      }
      return { strike: r.strike, price: r.strike + shift, value: r.value, tags }
    })
    const named = rows.filter((r) => r.tags.length).map((r) => r.strike)
    const rest = rows.filter((r) => !r.tags.length).sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    const head = `${lad.label} GEX · ${TIME.format(new Date(col.slotTs))}`
    return {
      width: s.width,
      head,
      rows,
      maxAbs: model.maxAbs,
      order: [...named, ...rest.map((r) => r.strike)],
      empty: rows.length ? '' : 'Empty ladder',
      key: `${col.slotTs}|${s.metric}|${s.tags}|${shift}|${voltick}`,
    }
  },
})

// ── The column itself ────────────────────────────────────────────────────────

function isPayload(v: unknown): v is RailPayload {
  return !!v && typeof v === 'object' && Array.isArray((v as RailPayload).rows)
}

class RailLayer implements RendererLayerInstance {
  private canvas: HTMLCanvasElement | null = null
  private el: HTMLDivElement | null = null
  private headEl: HTMLDivElement | null = null
  private emptyEl: HTMLDivElement | null = null
  private nodes = new Map<number, HTMLDivElement>()
  private key = ''
  private width = 0

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
  }

  /** The box Vela draws in (plot + axes), and the element around it. */
  private boxes(): { root: HTMLElement; wrap: HTMLElement } | null {
    const root = this.canvas?.parentElement
    const wrap = root?.parentElement
    return root && wrap ? { root, wrap } : null
  }

  private attach(width: number): HTMLDivElement | null {
    const b = this.boxes()
    if (!b) return null
    if (b.wrap.clientWidth < MIN_CELL) {
      this.detach()
      return null
    }
    if (this.width !== width) {
      b.root.style.right = `${width}px`
      this.width = width
    }
    let el = this.el
    if (!el || !el.isConnected) {
      el = this.el = document.createElement('div')
      el.className = 'cb-rail'
      el.style.cssText = `position:absolute;top:0;right:0;bottom:0;overflow:hidden`
      this.headEl = document.createElement('div')
      this.headEl.className = 'cb-rail-head'
      this.emptyEl = document.createElement('div')
      this.emptyEl.className = 'cb-rail-empty'
      el.append(this.headEl, this.emptyEl)
      b.wrap.appendChild(el)
      this.key = ''
      this.nodes.clear()
    }
    el.style.width = `${width}px`
    return el
  }

  private detach(): void {
    this.el?.remove()
    this.el = null
    this.nodes.clear()
    this.key = ''
    if (this.width) {
      const b = this.boxes()
      if (b) b.root.style.right = ''
      this.width = 0
    }
  }

  private build(d: RailPayload): void {
    const el = this.el!
    for (const n of this.nodes.values()) n.remove()
    this.nodes.clear()
    for (const r of d.rows) {
      const row = document.createElement('div')
      row.className = 'cb-rail-row'
      row.title = `${r.strike.toLocaleString('en-US', { maximumFractionDigits: 2 })}${r.price !== r.strike ? ` (${r.price.toFixed(2)})` : ''}  ${fmt(r.value)}`
      const tags = document.createElement('span')
      tags.className = 'cb-rail-tags'
      for (const t of r.tags) {
        const tag = document.createElement('span')
        tag.className = 'cb-rail-tag'
        tag.dataset.k = t.key
        tag.title = t.title
        tag.textContent = t.text
        if (t.fill) tag.style.background = t.fill
        if (t.ink) tag.style.color = t.ink
        tags.append(tag)
      }
      const track = document.createElement('span')
      track.className = 'cb-rail-track'
      const bar = document.createElement('span')
      bar.className = 'cb-rail-bar'
      bar.dataset.s = r.value >= 0 ? 'pos' : 'neg'
      bar.style.width = `${d.maxAbs > 0 ? Math.max(2, (Math.abs(r.value) / d.maxAbs) * 100) : 0}%`
      track.append(bar)
      row.append(tags, track)
      el.append(row)
      this.nodes.set(r.strike, row)
    }
  }

  render(args: RendererLayerArgs): void {
    const d = args.data
    if (!isPayload(d)) {
      this.detach()
      return
    }
    const el = this.attach(d.width)
    if (!el) return
    this.headEl!.textContent = d.head
    this.emptyEl!.textContent = d.empty
    this.emptyEl!.hidden = !d.empty
    if (d.key !== this.key) {
      this.key = d.key
      this.build(d)
    }
    // place: same mapping, same frame as the candles
    const { coords, scale, bounds } = args
    const top = bounds.top + HEAD_H
    const bottom = bounds.top + bounds.height - 2
    const priceOf = new Map(d.rows.map((r) => [r.strike, r.price]))
    const placed: number[] = []
    for (const strike of d.order) {
      const node = this.nodes.get(strike)
      if (!node) continue
      const y = coords.priceToY(priceOf.get(strike)!, scale, bounds)
      let show = Number.isFinite(y) && y >= top && y <= bottom
      if (show) for (const p of placed) if (Math.abs(p - y) < ROW_H) { show = false; break }
      if (!show) {
        if (node.style.visibility !== 'hidden') node.style.visibility = 'hidden'
        continue
      }
      placed.push(y)
      const next = `translateY(${Math.round(y - ROW_H / 2)}px)`
      if (node.style.transform !== next) node.style.transform = next
      if (node.style.visibility !== 'visible') node.style.visibility = 'visible'
    }
  }

  destroy(): void {
    this.detach()
    this.canvas = null
  }
}

provideLayer(RAIL_TYPE, () => new RailLayer())
