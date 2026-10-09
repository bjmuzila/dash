// ─────────────────────────────────────────────────────────────────────────────
// CB GEX RAIL: the GEX Candles card's strike rail, beside a Vela chart.
//
// Same rail as the home board: a 96px column beside the chart (Position: to
// the right of the price axis, or at the chart's left edge), one row per strike
// at exactly that strike's height on the chart. Each row has the level tag and
// one bar, sized by |GEX| against the biggest on the ladder, coloured by sign,
// growing away from the chart (right on the right, left on the left). Hover a
// row for the strike and its value. Built with the card's own buildRail.
//
// EVERY STRIKE (Brandon, 2026-10-04: "it should show all levels"): all the
// strikes the column carries, the named ones tagged. The tags are Voltick's
// (the page pins it), read by the definition (data/voltickLevels.ts
// vtFromLadder) off the rail's GEX setting — Vol only by default since
// 2026-10-06, the Voltick Path's book, so tags and bubbles line up:
// ★ Volt = the top net GEX, ◆ Coil = the 2nd top on the Volt's side of spot,
// ↘ Reversal = the top across spot. ↯ Surge (the biggest volume GEX) keeps the
// Voltick bot's read. On the CB theme: CB / CW / PW.
//
// WHERE IT SITS. Vela draws the whole chart (plot, price axis, time axis) on
// canvases inside one absolutely placed box. The rail pulls that box in from
// its side by its width (Vela re-sizes to it, the same way it follows any
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
// AFTER THE CLOSE (live): from 16:00 ET the rail is the NEXT session's gamma,
// the newest column recorded under the next expiry (ladder.ts loadRailLadder).
// Friday after 4pm is Monday's, not Friday's. The header then names that
// expiry's day (SPX MON 16:42) and its tooltip says so. Nothing recorded for
// the next expiry yet: the session that just closed.
//
// NET GEX under the header (2026-10-05, Brandon): the column's total — every
// strike's GEX summed on the rail's GEX setting (OI + Vol / Vol only / OI only),
// signed and in the GEX colours. The ladder carries the top 30 strikes, which
// hold all but a rounding of the total (TSLA: 2.5951B of 2.5951B).
//
// BARS IN THE PATH'S COLOURS (2026-10-05, Brandon: "color them the same as the
// path colors"): a tagged row's bar takes its level's Voltick Path colour —
// ★ Volt gold (the Path's bead), ↘ Reversal pink, ◆ Coil blue, ↯ Surge blue —
// the highest-ranked level on the row when it carries two (Volt, Reversal,
// Coil, Surge: the Path's own priority). Every other bar keeps its sign colour.
// Bars are 10px (were 7).
//
// STYLE: RAIL OR HEATMAP (2026-10-05, Brandon: "I want to switch from the rail
// to the heatmap on Multi Greek ... just the nearest"). Heatmap draws each
// strike as the Multi Greek ladder's cell (board/multiGreek): its GEX written
// ($1.23B, the sign in the up / down colour) in a cell shaded by size and sign
// on Multi Greek's own ramp (mgMath cellAlpha, the Voltick board's fixed
// intensity: the top three strikes on fixed steps, the biggest ringed). A
// tagged row's cell is filled in its level's Path colour, as its bar is.
// THE GAPS GLOW (2026-10-05, Brandon asked for a gradient through the gaps,
// found the blend "too odd", and picked G3 · glow bands of generated/2026-10-
// 05-vela-rail-heat-r1.html): one strip behind the cells where each shown
// cell's colour holds across its cell and fades out to nothing halfway to its
// neighbour, so neighbours never mix (no green between gold and blue) and a
// dark seam keeps the strikes countable. A level glows in its Path colour at
// 42 % (its cell keeps the solid fill); a heat cell glows in its own wash. The
// first and last shown cells fade out over the same half-gap (at most
// HEAT_FADE). Re-laid with the rows on every frame (pan, zoom). ONE
// column, the nearest expiry, the same column the rail reads; never Multi
// Greek's later expiries or its ex-0DTE total. Same rows, same placement.
//
// STYLE: PROFILE (2026-10-06, Brandon picked G4 of generated/2026-10-05-vela-
// rail-heat-r1.html as a third style). The heat becomes a shape: one smooth
// curve (Catmull-Rom through every strike on screen) whose width is the strike's
// |GEX| against the biggest, growing away from the chart from the cells' edge, in
// the GEX colours by sign (positive above the flip, negative below) and fading
// through the dark where the sign flips. A tagged level is a 2px line across the
// shape in its Path colour. The figures sit right-aligned over it, a level's in
// its colour, and only on a tagged level (2026-10-08). Redrawn with the rows on every frame (pan, zoom).
// FULL LENGTH (2026-10-08, Brandon: "the gex rail cuts off. needs to be full
// length"): the ladder carries the top 30 strikes, so the shape used to stop at
// the highest and lowest of them and leave the rest of the column empty. Past
// its last strike the shape now tapers in one strike step to the thin stem a
// zero-GEX strike draws, and the stem runs on to the plot's top (under the
// header) and bottom in that end's sign colour, so the column reads as one
// shape top to bottom. Nothing is invented: the stem is the width of zero.
//
// EXPIRIES (2026-10-06, Brandon: "is the gex rail 0dte only or all
// expirations. the settings should have a selector"): Nearest (0DTE), the
// default, is the per-minute ladder above (the nearest expiry, the book the
// Voltick Path's 0DTE walls are ranked on). All expirations sums every listed
// expiry per strike from the live chain (ladder.ts loadChainLadder), re-read
// every minute; the header reads MRNA ALL 10:29. In a replay the rail keeps
// the nearest expiry, the only one recorded minute by minute.
//
// Too narrow (the phone, a small grid cell): no rail. The card does the same
// on a phone.
// ─────────────────────────────────────────────────────────────────────────────

import type { RendererLayerArgs, RendererLayerInstance } from '@luxalgo/vela/plugin'
import { buildRail, type RailLevels } from '@/board/gexCandles/GexRail'
import { voltickMarks, vtFromLadder, vtLevelsAt, type VoltickMarks } from '@/data/voltickLevels'
import { uiThemeNow } from '@/design/uiTheme'
import { bool, int, provideLayer, str, studyImpl, type StudyCtx } from './common'
import { RAIL_EXPIRIES, RAIL_SIDES, RAIL_STYLES, RAIL_TYPE } from './index'
import { gexBasis } from '@/pages/vela/gexBasis'
import { cellAlpha, columnStats, fmtGex } from '@/board/multiGreek/mgMath'
import { columnsUntil, ladderKey, loadChainLadder, loadRailLadder, sessionDates, type Ladder } from './ladder'

const ROW_H = 15
/** The header's height (the name and time, then the net GEX): rows above it are dropped. */
const HEAD_H = 30
/** Below this cell width the rail stays off. */
const MIN_CELL = 520
/** Multi Greek's heat on the Voltick board (MultiGreekCard VT_FIXED_INTENSITY). */
const HEAT_INTENSITY = 1.75

type Side = 'right' | 'left'

interface RailS {
  side: Side
  metric: 'net' | 'vol' | 'oi'
  tags: boolean
  width: number
  /** Style: Heatmap (Multi Greek's cell) instead of bars. */
  heat: boolean
  /** Style: Profile (one smooth GEX shape) instead of bars. */
  profile: boolean
  /** Expiries: every listed expiry summed (live), not the nearest one. */
  all: boolean
}

export interface RailRowOut {
  strike: number
  /** In this chart's prices (basis applied). */
  price: number
  value: number
  tags: { key: string; text: string; title: string; fill?: string; ink?: string }[]
  /** The Voltick level whose Path colour the bar takes (the row's highest-ranked tag); none = the sign colour. */
  lead?: string
  /** Heatmap: the cell's wash, 0..1 (Multi Greek's cellAlpha). */
  alpha?: number
  /** Heatmap: the column's biggest |GEX| (Multi Greek rings it). */
  top?: boolean
}

/** The Path's level priority (vtPath/trailruns.ts PATH_PRIORITY): which colour a row with two tags takes. */
const LEAD_ORDER = ['volt', 'reversal', 'coil', 'surge']

export interface RailPayload {
  width: number
  side: Side
  /** Heatmap cells instead of bars. */
  heat: boolean
  /** Profile: one smooth GEX shape instead of bars. */
  profile: boolean
  head: string
  /** The header's tooltip. */
  headTitle: string
  /** The column's net GEX, signed ('' while there is none). */
  net: string
  /** Its sign, for the colour. */
  netSign: 'pos' | 'neg' | ''
  netTitle: string
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
// an expiry / session date (YYYY-MM-DD) is a calendar day: read at UTC noon, named in UTC
const DOW = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' })
const DAY_LONG = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' })
const dayDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`)

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
    // the page's one GEX switch (gexBasis.ts), not a per-study input (2026-10-07)
    const b = gexBasis()
    return {
      side: str(i.side, RAIL_SIDES[0]) === RAIL_SIDES[1] ? 'left' : 'right',
      metric: b === 'vol' ? 'vol' : b === 'oi' ? 'oi' : 'net',
      tags: bool(i.tags, true),
      width: int(i.width, 96, 72, 180),
      heat: str(i.style, RAIL_STYLES[0]) === RAIL_STYLES[1],
      profile: str(i.style, RAIL_STYLES[0]) === RAIL_STYLES[2],
      all: str(i.exp, RAIL_EXPIRIES[0]) === RAIL_EXPIRIES[1],
    }
  },
  dataKey: (c, s) => `${ladderKey(c)}|${railDay(c).join(',')}|${s.all && c.ctx.live ? 'all' : 'near'}`,
  // All expirations is live only: the per-minute recorder keeps the nearest expiry,
  // so a replay rewinds on that one
  load: (c, s, fresh) => (s.all && c.ctx.live ? loadChainLadder(c, fresh) : loadRailLadder(c, railDay(c)[0], fresh)),
  refreshMs: 60_000,
  // the replay clock moves the column the rail reads; live, a new minute's column arrives by refresh
  everyTick: true,
  render: () => ({}),
  layer: (c, s, lad): RailPayload => {
    const base = { width: s.width, side: s.side, heat: s.heat, profile: s.profile, headTitle: '', net: '', netSign: '' as const, netTitle: '', rows: [], maxAbs: 0, order: [], key: '' }
    if (!lad) return { ...base, head: '', empty: 'Loading the ladder…' }
    const cols = columnsUntil(lad.columns, c.until)
    const col = cols[cols.length - 1]
    if (!col) {
      const day = railDay(c)[0] ?? ''
      if (lad.allExpiries === 0) return { ...base, head: `${lad.label} ALL`, empty: 'No option chain' }
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
    // every strike on the ladder; the named ones carry their tags
    const shown = model.rows
    if (voltick) {
      // the tags read the rail's own GEX setting (2026-10-06: volume only by default,
      // the Voltick Path's book, so the two line up); `cells` is already OI only on OI only
      const def = vtFromLadder(cells.map((x) => ({ strike: x.strike, net: s.metric === 'vol' ? x.netVol : x.net })), model.spot)
      const surge = voltickMarks(col.cells.map((x) => ({ strike: x.strike, book: x.net, vol: x.netVol })), { always: true }).surge
      const vt: VoltickMarks = { volt: def.volt, coil: def.coil, reversal: def.reversal, surge, coils: def.coil != null ? [def.coil] : [] }
      lv.vt = vt
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
      const lead = LEAD_ORDER.find((k) => tags.some((t) => t.key === k))
      // ONE ICON PER ROW (2026-10-06, Brandon): a strike carrying two levels shows
      // only the most important, Volt > Reversal > Coil > Surge (LEAD_ORDER)
      const one = lead ? tags.filter((t) => t.key === lead).slice(0, 1) : tags.slice(0, 1)
      return { strike: r.strike, price: r.strike + shift, value: r.value, tags: one, lead }
    })
    if (s.heat) {
      // Multi Greek's ramp over this one column: the top three on fixed steps, the rest by share
      const st = columnStats(new Map(rows.map((r) => [r.strike, r.value])), model.spot)
      for (const r of rows) {
        r.alpha = cellAlpha(r.value, st.maxAbs, st.top3.indexOf(r.strike), HEAT_INTENSITY)
        r.top = st.top3[0] === r.strike && r.value !== 0
      }
    }
    const named = rows.filter((r) => r.tags.length).map((r) => r.strike)
    const rest = rows.filter((r) => !r.tags.length).sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    const at = TIME.format(new Date(col.slotTs))
    const next = lad.next
    // the column's total on the rail's GEX setting (`cells` is already OI only when that is the setting)
    const total = cells.reduce((a, x) => a + (s.metric === 'vol' ? x.netVol : x.net), 0)
    const basisName = s.metric === 'vol' ? 'volume' : s.metric === 'oi' ? 'open interest' : 'OI + volume'
    // short enough for the 96px rail: SPX GEX 15:59, or after a close SPX MON 16:42
    // MRNA ALL 10:29 when every expiry is summed
    const head = `${lad.label} ${lad.allExpiries ? 'ALL' : next ? DOW.format(dayDate(next.expiry)).toUpperCase() : 'GEX'} ${at}`
    const headTitle = lad.allExpiries
      ? `${lad.label} gamma, all ${lad.allExpiries} listed expiries summed per strike (live chain, ${at} ET)`
      : next
        ? `Next session: the ${DAY_LONG.format(dayDate(next.expiry))} expiry's gamma, recorded after the ${DAY_LONG.format(dayDate(next.after))} close (column ${at} ET)`
        : `${lad.label} gamma, nearest expiry, column ${at} ET`
    return {
      width: s.width,
      side: s.side,
      heat: s.heat,
      profile: s.profile,
      head,
      headTitle,
      net: `NET ${fmt(total)}`,
      netSign: total > 0 ? 'pos' : total < 0 ? 'neg' : '',
      netTitle: `Net GEX, ${basisName}: every strike's gamma summed (column ${at} ET)`,
      rows,
      maxAbs: model.maxAbs,
      order: [...named, ...rest.map((r) => r.strike)],
      empty: rows.length ? '' : 'Empty ladder',
      key: `${col.slotTs}|${next?.expiry ?? ''}|${lad.allExpiries ?? 0}|${s.metric}|${s.tags}|${shift}|${voltick}|${s.heat}|${s.profile}`,
    }
  },
})

// ── The column itself ────────────────────────────────────────────────────────

/** The Path colours a tagged cell is filled in (vela.css .cb-gxr-cell[data-k], the bars' too). */
const LEAD_FILL: Record<string, string> = {
  volt: 'var(--color-vt-path-gold)',
  reversal: 'var(--color-vt-reversal)',
  coil: 'var(--color-vt-coil)',
  surge: 'var(--color-vt-surge)',
}
/** Half a heat cell's height (vela.css .cb-gxr-cell: 13px): a colour holds this far either side of its row. */
const CELL_HALF = 6.5
/** The longest fade above the first shown cell and below the last. */
const HEAT_FADE = 24
/** A level's glow: its Path colour at this share (G3). */
const LEVEL_GLOW = 42

/** Style: Heatmap. A cell's colour on the strip behind the cells. */
function heatColor(r: RailRowOut): string {
  const lead = r.lead ? LEAD_FILL[r.lead] : undefined
  if (lead) return `color-mix(in srgb, ${lead} ${LEVEL_GLOW}%, transparent)`
  const a = r.alpha ?? 0
  if (!(a > 0)) return 'transparent'
  return `color-mix(in srgb, ${r.value >= 0 ? 'var(--color-gex-pos)' : 'var(--color-gex-neg)'} ${(a * 100).toFixed(1)}%, transparent)`
}

/** Style: Heatmap. One strike as Multi Greek's cell: the figure on its heat (the
 *  strip behind paints that), or filled in its level's Path colour (vela.css
 *  .cb-gxr-cell[data-k]). */
function heatCell(r: RailRowOut): HTMLSpanElement {
  const cell = document.createElement('span')
  cell.className = 'cb-gxr-cell'
  const f = fmtGex(r.value)
  const sign = document.createElement('span')
  sign.className = 'cb-gxr-sg'
  sign.dataset.s = f.sign === '+' ? 'pos' : f.sign === '−' ? 'neg' : ''
  sign.textContent = f.sign
  cell.append(sign, document.createTextNode(f.text))
  const lead = r.lead ? r.tags.find((t) => t.key === r.lead) : undefined
  if (lead) {
    cell.dataset.k = lead.key
    if (lead.ink) cell.style.color = lead.ink
    return cell
  }
  // the wash is the strip's (RailLayer.paintHeat), so the gap blends into it
  if (r.top) cell.style.outline = `1px solid ${r.value >= 0 ? 'var(--color-gex-pos)' : 'var(--color-gex-neg)'}`
  return cell
}

/** Style: Profile. One strike's figure over the shape: right-aligned, a level's in its Path colour. */
function profileCell(r: RailRowOut): HTMLSpanElement {
  const cell = document.createElement('span')
  cell.className = 'cb-gxr-pcell'
  const f = fmtGex(r.value)
  const sign = document.createElement('span')
  sign.className = 'cb-gxr-sg'
  sign.dataset.s = f.sign === '+' ? 'pos' : f.sign === '−' ? 'neg' : ''
  sign.textContent = f.sign
  cell.append(sign, document.createTextNode(f.text))
  if (r.lead) cell.dataset.k = r.lead
  return cell
}

/** Profile: the cells' column, where the shape starts (the chart side) and how far it may grow. */
const PROFILE_FROM = 32
const PROFILE_END = 4
/** The shape's ends taper back to its edge this far past the first and last strike. */
const PROFILE_TAPER = 14

let profileSeq = 0

function isPayload(v: unknown): v is RailPayload {
  return !!v && typeof v === 'object' && Array.isArray((v as RailPayload).rows)
}

class RailLayer implements RendererLayerInstance {
  private canvas: HTMLCanvasElement | null = null
  private el: HTMLDivElement | null = null
  private headEl: HTMLDivElement | null = null
  private netEl: HTMLDivElement | null = null
  private emptyEl: HTMLDivElement | null = null
  /** Heatmap: the strip behind the cells, and each row's colour on it. */
  private heatEl: HTMLDivElement | null = null
  private colors = new Map<number, string>()
  private heatBg = ''
  /** Profile: the shape (an SVG behind the rows), its gradient's id, and its last markup. */
  private profileEl: SVGSVGElement | null = null
  private profileId = `cb-gxr-pf-${++profileSeq}`
  private profileSvg = ''
  private nodes = new Map<number, HTMLDivElement>()
  private key = ''
  private width = 0
  private side: Side = 'right'

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
  }

  /** The box Vela draws in (plot + axes), and the element around it. */
  private boxes(): { root: HTMLElement; wrap: HTMLElement } | null {
    const root = this.canvas?.parentElement
    const wrap = root?.parentElement
    return root && wrap ? { root, wrap } : null
  }

  private attach(width: number, side: Side): HTMLDivElement | null {
    const b = this.boxes()
    if (!b) return null
    if (b.wrap.clientWidth < MIN_CELL) {
      this.detach()
      return null
    }
    if (this.width !== width || this.side !== side) {
      // the chart's box gives up `width` on the rail's side, and gets the other back.
      // 0px, never '': Vela places the box with an inline `inset: 0`, and clearing
      // one side of it leaves that side auto, which collapses the chart to nothing
      b.root.style.right = side === 'right' ? `${width}px` : '0px'
      b.root.style.left = side === 'left' ? `${width}px` : '0px'
      this.width = width
      this.side = side
      // on the left, the cell's own overlays that sit at the chart's left edge (the
      // symbol chip, the watermark, the mark) step right of the rail (vela.css)
      this.markCell(side === 'left' ? width : 0)
    }
    let el = this.el
    if (!el || !el.isConnected) {
      el = this.el = document.createElement('div')
      // cb-gxr, not cb-rail: the shell's nav rail owns .cb-rail (shell/rail.css)
      el.className = 'cb-gxr'
      el.style.cssText = `position:absolute;top:0;bottom:0;overflow:hidden`
      this.headEl = document.createElement('div')
      this.headEl.className = 'cb-gxr-head'
      this.netEl = document.createElement('div')
      this.netEl.className = 'cb-gxr-net'
      this.emptyEl = document.createElement('div')
      this.emptyEl.className = 'cb-gxr-empty'
      this.heatEl = document.createElement('div')
      this.heatEl.className = 'cb-gxr-heat'
      this.heatEl.hidden = true
      this.heatBg = ''
      this.profileEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      this.profileEl.classList.add('cb-gxr-profile')
      this.profileEl.setAttribute('aria-hidden', 'true')
      this.profileEl.style.display = 'none'
      this.profileSvg = ''
      // first: the rows, appended after them, sit on top
      el.append(this.heatEl, this.profileEl, this.headEl, this.netEl, this.emptyEl)
      b.wrap.appendChild(el)
      this.key = ''
      this.nodes.clear()
    }
    el.style.width = `${width}px`
    el.style.left = side === 'left' ? '0' : ''
    el.style.right = side === 'right' ? '0' : ''
    el.dataset.side = side
    return el
  }

  /** Tell the chart's cell the rail takes `px` at its left edge (0: it does not). */
  private markCell(px: number): void {
    const cell = this.boxes()?.wrap.closest<HTMLElement>('.vela-cell')
    if (!cell) return
    if (px > 0) {
      cell.dataset.cbGxrLeft = '1'
      cell.style.setProperty('--cb-gxr-w', `${px}px`)
    } else {
      delete cell.dataset.cbGxrLeft
      cell.style.removeProperty('--cb-gxr-w')
    }
  }

  private detach(): void {
    this.el?.remove()
    this.el = null
    this.heatEl = null
    this.heatBg = ''
    this.profileEl = null
    this.profileSvg = ''
    this.nodes.clear()
    this.colors.clear()
    this.key = ''
    if (this.width) {
      const b = this.boxes()
      if (b) {
        b.root.style.right = '0px'
        b.root.style.left = '0px'
      }
      this.markCell(0)
      this.width = 0
    }
  }

  private build(d: RailPayload): void {
    const el = this.el!
    for (const n of this.nodes.values()) n.remove()
    this.nodes.clear()
    this.colors.clear()
    for (const r of d.rows) {
      const row = document.createElement('div')
      row.className = 'cb-gxr-row'
      row.title = `${r.strike.toLocaleString('en-US', { maximumFractionDigits: 2 })}${r.price !== r.strike ? ` (${r.price.toFixed(2)})` : ''}  ${fmt(r.value)}`
      const tags = document.createElement('span')
      tags.className = 'cb-gxr-tags'
      for (const t of r.tags) {
        const tag = document.createElement('span')
        tag.className = 'cb-gxr-tag'
        tag.dataset.k = t.key
        tag.title = t.title
        tag.textContent = t.text
        if (t.fill) tag.style.background = t.fill
        if (t.ink) tag.style.color = t.ink
        tags.append(tag)
      }
      const track = document.createElement('span')
      track.className = 'cb-gxr-track'
      if (d.heat) {
        track.append(heatCell(r))
        this.colors.set(r.strike, heatColor(r))
      } else if (d.profile) {
        // FIGURES ON THE LEVELS ONLY (2026-10-08, Brandon: "only put the gex amount
        // for the labeled lines"): the shape already shows every strike's size, so
        // a figure is written only on a tagged row (Volt / Coil / Reversal / Surge,
        // or CB / CW / PW). Every row still carries its strike and value on hover.
        if (r.tags.length) track.append(profileCell(r))
      } else {
        const bar = document.createElement('span')
        bar.className = 'cb-gxr-bar'
        bar.dataset.s = r.value >= 0 ? 'pos' : 'neg'
        if (r.lead) bar.dataset.k = r.lead
        bar.style.width = `${d.maxAbs > 0 ? Math.max(2, (Math.abs(r.value) / d.maxAbs) * 100) : 0}%`
        track.append(bar)
      }
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
    const el = this.attach(d.width, d.side)
    if (!el) return
    this.headEl!.textContent = d.head
    this.headEl!.title = d.headTitle
    const net = this.netEl!
    if (net.textContent !== d.net) net.textContent = d.net
    net.title = d.netTitle
    net.dataset.s = d.netSign
    net.hidden = !d.net
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
    /** Heatmap: each shown row's top (its translateY) and colour, for the strip. */
    const shown: { top: number; color: string }[] = []
    /** Profile: every strike on screen and past its edges, hidden rows included (the shape has no overlap to avoid). */
    const shape: { y: number; r: RailRowOut }[] = []
    for (const strike of d.order) {
      const node = this.nodes.get(strike)
      if (!node) continue
      const y = coords.priceToY(priceOf.get(strike)!, scale, bounds)
      // EVERY STRIKE, NOT JUST THE ONES ON SCREEN (2026-10-08, Brandon: "gex rail
      // still not showing all strikes. I have to scroll up or down or adjust the
      // axis to get it to show"): the shape used to be built from the strikes in
      // view only, so a strike just past the top or bottom of the chart was not in
      // it and the shape stopped short (tapering to nothing at the last strike on
      // screen) until a pan brought that strike in. It now runs through the ladder's
      // strikes beyond the edges too (within a few screen heights, enough for the
      // curve), and the SVG's own box clips it to the rail.
      if (d.profile && Number.isFinite(y) && y >= top - 4 * bounds.height && y <= bottom + 4 * bounds.height) {
        const r = d.rows.find((x) => x.strike === strike)
        if (r) shape.push({ y, r })
      }
      let show = Number.isFinite(y) && y >= top && y <= bottom
      if (show) for (const p of placed) if (Math.abs(p - y) < ROW_H) { show = false; break }
      if (!show) {
        if (node.style.visibility !== 'hidden') node.style.visibility = 'hidden'
        continue
      }
      placed.push(y)
      const rowTop = Math.round(y - ROW_H / 2)
      if (d.heat) shown.push({ top: rowTop, color: this.colors.get(strike) ?? 'transparent' })
      const next = `translateY(${rowTop}px)`
      if (node.style.transform !== next) node.style.transform = next
      if (node.style.visibility !== 'visible') node.style.visibility = 'visible'
    }
    this.paintHeat(d.heat ? shown : null)
    this.paintProfile(d.profile ? shape : null, d, top, bounds.top + bounds.height)
  }

  /** Profile: the shape behind the figures (header). `null`: another style, no shape. */
  private paintProfile(pts: { y: number; r: RailRowOut }[] | null, d: RailPayload, topY: number, height: number): void {
    const svg = this.profileEl
    if (!svg) return
    if (!pts || pts.length < 2 || !(d.maxAbs > 0)) {
      if (svg.style.display !== 'none') svg.style.display = 'none'
      return
    }
    pts.sort((a, b) => a.y - b.y)
    const W = d.width
    const left = d.side === 'left'
    // the edge the shape grows from (the chart side of the cells) and its direction
    const x0 = left ? W - PROFILE_FROM : PROFILE_FROM
    const span = W - PROFILE_FROM - PROFILE_END - 3
    const xOf = (v: number) => x0 + (left ? -1 : 1) * (3 + (Math.abs(v) / d.maxAbs) * span)
    // one strike step on screen: the smallest gap between two neighbouring strikes
    let step = Infinity
    for (let i = 1; i < pts.length; i++) {
      const dy = pts[i]!.y - pts[i - 1]!.y
      if (dy > 0.5 && dy < step) step = dy
    }
    if (!Number.isFinite(step)) step = PROFILE_TAPER
    // the ends: one step to taper to the zero stem, then the stem to the plot's edge
    // (two zero points so the curve meets the stem straight, not with a bulge)
    const stem = xOf(0)
    const firstY = pts[0]!.y
    const lastY = pts[pts.length - 1]!.y
    const botY = height - 2
    const head =
      firstY - step > topY
        ? [{ x: stem, y: topY }, ...(firstY - 2 * step > topY ? [{ x: stem, y: firstY - 2 * step }] : []), { x: stem, y: firstY - step }]
        : [{ x: x0, y: firstY - PROFILE_TAPER }]
    const tail =
      lastY + step < botY
        ? [{ x: stem, y: lastY + step }, ...(lastY + 2 * step < botY ? [{ x: stem, y: lastY + 2 * step }] : []), { x: stem, y: botY }]
        : [{ x: x0, y: lastY + PROFILE_TAPER }]
    const P = [...head, ...pts.map((p) => ({ x: xOf(p.r.value), y: p.y })), ...tail]
    const n = (v: number) => v.toFixed(1)
    let path = `M${n(x0)},${n(P[0]!.y)} L${n(P[0]!.x)},${n(P[0]!.y)}`
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] ?? P[i]!
      const p1 = P[i]!
      const p2 = P[i + 1]!
      const p3 = P[i + 2] ?? p2
      path += ` C${n(p1.x + (p2.x - p0.x) / 6)},${n(p1.y + (p2.y - p0.y) / 6)} ${n(p2.x - (p3.x - p1.x) / 6)},${n(p2.y - (p3.y - p1.y) / 6)} ${n(p2.x)},${n(p2.y)}`
    }
    path += ` L${n(x0)},${n(P[P.length - 1]!.y)} Z`
    // the sign down the shape: each strike's colour at its height, fading through the dark where it flips
    const H = Math.max(1, height)
    const col = (v: number) => (v >= 0 ? 'var(--color-gex-pos)' : 'var(--color-gex-neg)')
    const stop = (y: number, c: string, a: number) => `<stop offset="${Math.min(1, Math.max(0, y / H)).toFixed(4)}" style="stop-color:${c};stop-opacity:${a}"/>`
    const stops: string[] = []
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!
      const prev = pts[i - 1]
      if (prev && prev.r.value >= 0 !== p.r.value >= 0) {
        const mid = (prev.y + p.y) / 2
        stops.push(stop(mid, col(prev.r.value), 0.06), stop(mid, col(p.r.value), 0.06))
      }
      stops.push(stop(p.y, col(p.r.value), 0.5))
    }
    // the stems: each end's colour, quieter, out to the edge
    if (head.length > 1 || head[0]!.x === stem) stops.unshift(stop(topY, col(pts[0]!.r.value), 0.3))
    if (tail.length > 1 || tail[0]!.x === stem) stops.push(stop(botY, col(pts[pts.length - 1]!.r.value), 0.3))
    const id = this.profileId
    const lines = pts
      .filter((p) => p.r.lead && LEAD_FILL[p.r.lead])
      .map((p) => `<line x1="${n(x0)}" x2="${n(left ? PROFILE_END : W - PROFILE_END)}" y1="${n(p.y)}" y2="${n(p.y)}" style="stroke:${LEAD_FILL[p.r.lead!]}" stroke-width="2"/>`)
      .join('')
    // clipped below the header, so a strike past the top never runs under the name and net
    const markup =
      `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="${n(H)}" gradientUnits="userSpaceOnUse">${stops.join('')}</linearGradient>` +
      `<clipPath id="${id}-c"><rect x="0" y="${n(topY)}" width="${W}" height="${n(Math.max(0, H - topY))}"/></clipPath></defs>` +
      `<g clip-path="url(#${id}-c)">` +
      `<path d="${path}" fill="url(#${id})"/>` +
      `<path d="${path}" fill="none" stroke="url(#${id})" stroke-width="1"/>` +
      lines +
      `</g>`
    if (markup !== this.profileSvg) {
      this.profileSvg = markup
      svg.setAttribute('width', String(W))
      svg.setAttribute('height', n(H))
      svg.innerHTML = markup
    }
    if (svg.style.display !== '') svg.style.display = ''
  }

  /** Heatmap: the strip behind the cells. Each shown cell's colour holds across its
   *  cell and fades to nothing halfway to the next shown cell, so neighbours never
   *  mix (G3 · glow bands). `null`: Style is Rail, no strip. */
  private paintHeat(shown: { top: number; color: string }[] | null): void {
    const heat = this.heatEl
    if (!heat) return
    if (!shown || !shown.length) {
      heat.hidden = true
      return
    }
    shown.sort((a, b) => a.top - b.top)
    // the cell sits centred in its row: ROW_H tall, the cell 2 * CELL_HALF
    const pad = ROW_H / 2 - CELL_HALF
    const stops: string[] = []
    // the seam between two shown rows: halfway from one cell's bottom to the next one's top
    const seam = (i: number) => (shown[i]!.top + ROW_H - pad + shown[i + 1]!.top + pad) / 2
    for (let i = 0; i < shown.length; i++) {
      const r = shown[i]!
      const top = r.top + pad
      const bottom = r.top + ROW_H - pad
      // the outer edges fade over the inner half-gap, at most HEAT_FADE
      const above = i > 0 ? seam(i - 1) : top - Math.min(HEAT_FADE, shown.length > 1 ? seam(0) - bottom : HEAT_FADE)
      const below = i < shown.length - 1 ? seam(i) : bottom + Math.min(HEAT_FADE, shown.length > 1 ? top - seam(i - 1) : HEAT_FADE)
      stops.push(`transparent ${Math.max(0, above)}px`, `${r.color} ${top}px`, `${r.color} ${bottom}px`, `transparent ${below}px`)
    }
    const bg = `linear-gradient(to bottom, ${stops.join(', ')})`
    if (bg !== this.heatBg) {
      this.heatBg = bg
      heat.style.background = bg
    }
    heat.hidden = false
  }

  destroy(): void {
    this.detach()
    this.canvas = null
  }
}

provideLayer(RAIL_TYPE, () => new RailLayer())
