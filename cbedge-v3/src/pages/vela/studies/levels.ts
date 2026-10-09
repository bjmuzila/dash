// ─────────────────────────────────────────────────────────────────────────────
// CB EDGE STUDIES — session levels: Prior Day / Week / Month, Initial Balance,
// Overnight (pre-market) High / Low. Three Vela native studies (common.ts).
//
//   Prior Levels   PDH / PDL / PDC, PWH / PWL, PMH / PML — each session drawn
//                  at the session before's values, as steps. Computed from the
//                  chart's own bars (regular hours by default, or the full
//                  session); on ES the newest day / week come from the
//                  recorder's /api/ref-levels when the chart's bars do not reach
//                  back far enough to have them. The newest session's lines run
//                  on to the chart's right edge, and the labels sit against the
//                  price axis, painted by a layer of their own (PriorLabels) so
//                  they stay there through every pan and zoom. Each level's
//                  colour and dash, the width, and where / how the labels show
//                  are settings (Brandon, 2026-10-09).
//   Initial Balance  the first 60 (30, 15) minutes of the cash session: IBH /
//                  IBL / mid, and the ×0.5 ×1 ×1.5 ×2 extensions once it is
//                  set. On ES / NQ each extension is labelled with how often the
//                  recorded sessions reached it (/api/ib-results — the Scanner's
//                  IB stats).
//   Overnight H/L  the high and low before the cash open — 18:00 → 09:30 ET on
//                  futures, 04:00 → 09:30 on stocks and ETFs — read off the
//                  extended tape whatever session the chart shows. SPX / NDX
//                  have no pre-market of their own: theirs is ES / NQ's, moved
//                  by that session's basis (the GEX Candles card's anchor).
// ─────────────────────────────────────────────────────────────────────────────

import type { OHLCV, SeriesSpec, DrawingLabel, DrawingLine, LineStyle } from '@luxalgo/vela'
import type { RendererLayerArgs, RendererLayerInstance } from '@luxalgo/vela/plugin'
import { tokenHexAlpha } from '@/design/theme'
import { candlesUrl, esCandlesUrl, parseCandles, parseEsCandles, type Bar } from '@/board/gexCandles/candles'
import { symbolDef } from '@/board/gexCandles/symbols'
import type { BasisModel } from '@/board/gexCandles/basis'
import { query } from '@/data/api'
import { loadBasis } from '@/pages/vela/wallsIndicator'
import {
  DAY_MS,
  RTH_CLOSE,
  RTH_OPEN,
  FUT_OPEN,
  bool,
  studyImpl,
  etDateKey,
  etMinutesOfDay,
  getJson,
  int,
  isRthBar,
  labelAt,
  provideLayer,
  seriesOf,
  sessionKey,
  sessionsOf,
  str,
  weekKey,
  type StudyCtx,
} from './common'
import {
  IB_TYPE,
  IB_WINDOWS,
  LINE_STYLES,
  ON_TYPE,
  PRIOR_COLORS,
  PRIOR_EXTEND,
  PRIOR_LABEL_AT,
  PRIOR_LABEL_SIDE,
  PRIOR_LABEL_SIZE,
  PRIOR_LABEL_TEXT,
  PRIOR_TYPE,
  SESSION_BASIS as BASIS_OPTS,
} from './index'

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(2) : v.toFixed(2))

/** A right-edge tag for a level, at the newest bar. */
function tag(type: string, key: string, bars: readonly OHLCV[], v: number | null | undefined, text: string, color: string): DrawingLabel[] {
  const last = bars[bars.length - 1]
  if (!last || v == null || !Number.isFinite(v)) return []
  return [labelAt(type, `tag-${key}`, last.time, v, `${text} ${fmt(v)}`, color, { textColor: color, noFill: true, size: 'small' })]
}

// ═════════════════════════════════════════════════════════════════════════════
// Prior Day / Week / Month
// ═════════════════════════════════════════════════════════════════════════════


type Level = 'day' | 'close' | 'week' | 'month'
type Side = 'above' | 'on' | 'below'

interface PriorS {
  day: boolean
  week: boolean
  month: boolean
  close: boolean
  full: boolean
  sessions: number
  tags: boolean
  color: Record<Level, string>
  style: Record<Level, LineStyle>
  width: number
  /** The newest session's lines run on to the right edge of the chart. */
  extend: boolean
  /** Labels against the price axis (else beside the last bar). */
  edge: boolean
  side: Side
  name: boolean
  price: boolean
  /** The label's text size, px, off the type scale (tokens.css: 2xs 10, xs 11, sm 13, base 15). */
  px: number
}
interface RefLevels {
  pdh: number | null
  pdl: number | null
  pdDate: string | null
  pwh: number | null
  pwl: number | null
  pwWeek: string | null
}
interface Hlc {
  h: number
  l: number
  c: number
}

function hlcOf(bars: readonly OHLCV[], idx: number[]): Hlc | null {
  if (!idx.length) return null
  let h = -Infinity
  let l = Infinity
  for (const i of idx) {
    const b = bars[i]!
    if (b.high > h) h = b.high
    if (b.low < l) l = b.low
  }
  return { h, l, c: bars[idx[idx.length - 1]!]!.close }
}
function merge(a: Hlc | undefined, b: Hlc): Hlc {
  return a ? { h: Math.max(a.h, b.h), l: Math.min(a.l, b.l), c: b.c } : { ...b }
}

const STYLE_OF: Record<(typeof LINE_STYLES)[number], LineStyle> = { Solid: 'solid', Dashed: 'dashed', Dotted: 'dotted' }
const SIDE_OF: Record<(typeof PRIOR_LABEL_SIDE)[number], Side> = { 'Above the line': 'above', 'On the line': 'on', 'Below the line': 'below' }
const LABEL_PX: Record<(typeof PRIOR_LABEL_SIZE)[number], number> = { Tiny: 10, Small: 11, Normal: 13, Large: 15 }
const pick = <K extends string>(v: string, map: Record<K, unknown>, d: K): K => (v in map ? (v as K) : d)

/** One drawn level: its name, colour, dash and value per bar (null = no line there). */
interface PriorLine {
  key: string
  title: string
  level: Level
  values: (number | null)[]
}

/** PDH / PDL / PDC, PWH / PWL, PMH / PML per bar, for the levels switched on. */
function priorLines(c: StudyCtx, s: PriorS, ref: RefLevels | null): PriorLine[] {
  const { bars, tfMs } = c
  if (!bars.length) return []
  const fut = c.sym.kind === 'futures'
  const daily = tfMs >= DAY_MS
  const weekly = tfMs >= 6 * DAY_MS
  // ── per-session H / L / C ──
  const dayKeyOf = (t: number) => (daily ? etDateKey(t + 12 * 3_600_000) : sessionKey(t, fut))
  const sessions = sessionsOf(bars, dayKeyOf)
  const dayStats = new Map<string, Hlc>()
  for (const ss of sessions) {
    const idx: number[] = []
    for (let i = ss.from; i <= ss.to; i++) if (daily || s.full || isRthBar(bars[i]!.time)) idx.push(i)
    const st = hlcOf(bars, idx)
    if (st) dayStats.set(ss.key, st)
  }
  const days = [...dayStats.keys()].sort()
  const weekStats = new Map<string, Hlc>()
  const monthStats = new Map<string, Hlc>()
  for (const d of days) {
    const st = dayStats.get(d)!
    weekStats.set(weekKey(d), merge(weekStats.get(weekKey(d)), st))
    monthStats.set(d.slice(0, 7), merge(monthStats.get(d.slice(0, 7)), st))
  }
  const weeks = [...weekStats.keys()].sort()
  const months = [...monthStats.keys()].sort()
  const prevOf = (list: string[], k: string) => {
    const j = list.indexOf(k)
    return j > 0 ? list[j - 1]! : null
  }
  const firstDrawn = sessions[Math.max(0, sessions.length - s.sessions)]?.from ?? 0
  const lastDay = sessions[sessions.length - 1]?.key ?? ''
  const n = bars.length
  const col = () => new Array<number | null>(n).fill(null)
  const pdh = col()
  const pdl = col()
  const pdc = col()
  const pwh = col()
  const pwl = col()
  const pmh = col()
  const pml = col()
  for (const ss of sessions) {
    if (ss.to < firstDrawn) continue
    const pd = prevOf(days, ss.key)
    const wk = weekKey(ss.key)
    const pw = prevOf(weeks, wk)
    const pm = prevOf(months, ss.key.slice(0, 7))
    let D = pd ? dayStats.get(pd) : undefined
    let W = pw ? weekStats.get(pw) : undefined
    // ES: the recorder's prior day / week, only where the bars here never reached it —
    // and only when it IS that day / week (in the evening the chart's session is already
    // tomorrow's, while the route still answers "the day before today")
    if (ref && ss.key === lastDay) {
      if (!D && ref.pdh != null && ref.pdl != null && (pd == null || ref.pdDate === pd)) D = { h: ref.pdh, l: ref.pdl, c: NaN }
      const fullWeek = pw != null && days.filter((d) => weekKey(d) === pw).length >= 4
      if (ref.pwh != null && ref.pwl != null && (!W || !fullWeek) && (pw == null || ref.pwWeek === pw)) W = { h: ref.pwh, l: ref.pwl, c: NaN }
    }
    const M = pm ? monthStats.get(pm) : undefined
    for (let i = ss.from; i <= ss.to; i++) {
      if (D) {
        pdh[i] = D.h
        pdl[i] = D.l
        pdc[i] = Number.isFinite(D.c) ? D.c : null
      }
      if (W) {
        pwh[i] = W.h
        pwl[i] = W.l
      }
      if (M) {
        pmh[i] = M.h
        pml[i] = M.l
      }
    }
  }
  const out: PriorLine[] = []
  const add = (key: string, title: string, level: Level, values: (number | null)[]) => {
    if (values.some((v) => v != null)) out.push({ key, title, level, values })
  }
  if (s.day && !weekly) {
    add('pdh', 'PDH', 'day', pdh)
    add('pdl', 'PDL', 'day', pdl)
  }
  if (s.close && !weekly) add('pdc', 'PDC', 'close', pdc)
  if (s.week && !weekly) {
    add('pwh', 'PWH', 'week', pwh)
    add('pwl', 'PWL', 'week', pwl)
  }
  if (s.month) {
    add('pmh', 'PMH', 'month', pmh)
    add('pml', 'PML', 'month', pml)
  }
  return out
}

/** What the label layer paints: each level's values per bar, and how its label looks. */
interface PriorLabelsPayload {
  times: number[]
  lines: { text: string; price: boolean; color: string; values: (number | null)[] }[]
  edge: boolean
  extend: boolean
  side: Side
  px: number
}

export const priorImpl = studyImpl<PriorS, RefLevels | null>({
  settings: (i) => {
    const color = (l: Level) => str(i[`${l}Color`], PRIOR_COLORS[l]())
    const style = (l: Level, d: (typeof LINE_STYLES)[number]) => STYLE_OF[pick(str(i[`${l}Style`], d), STYLE_OF, d)]
    const text = str(i.labelText, PRIOR_LABEL_TEXT[0])
    return {
      day: bool(i.day, true),
      week: bool(i.week, true),
      month: bool(i.month, false),
      close: bool(i.close, true),
      full: str(i.basis, BASIS_OPTS[0]) === BASIS_OPTS[1],
      sessions: int(i.sessions, 1, 1, 120),
      tags: bool(i.tags, true),
      color: { day: color('day'), close: color('close'), week: color('week'), month: color('month') },
      style: { day: style('day', 'Solid'), close: style('close', 'Dashed'), week: style('week', 'Solid'), month: style('month', 'Solid') },
      width: int(i.width, 1, 1, 4),
      extend: str(i.extend, PRIOR_EXTEND[0]) === PRIOR_EXTEND[0],
      edge: str(i.labelAt, PRIOR_LABEL_AT[0]) === PRIOR_LABEL_AT[0],
      side: SIDE_OF[pick(str(i.labelSide, PRIOR_LABEL_SIDE[0]), SIDE_OF, PRIOR_LABEL_SIDE[0])],
      name: text !== PRIOR_LABEL_TEXT[2],
      price: text !== PRIOR_LABEL_TEXT[1],
      px: LABEL_PX[pick(str(i.labelSize, PRIOR_LABEL_SIZE[0]), LABEL_PX, PRIOR_LABEL_SIZE[0])],
    }
  },
  dataKey: (c) => c.sym.key,
  // The recorder's ES reference levels — the one symbol it writes
  load: async (c) => (c.sym.fut === 'ES' ? getJson<RefLevels>('/api/ref-levels?symbol=ES') : null),
  refreshMs: 10 * 60_000,
  render: (c, s, ref) => {
    const { bars } = c
    const lines = priorLines(c, s, ref)
    if (!lines.length) return {}
    const T = PRIOR_TYPE
    const n = bars.length
    const last = bars[n - 1]!
    const step = Math.max(c.tfMs, 60_000)
    const series: SeriesSpec[] = []
    const drawn: DrawingLine[] = []
    for (const l of lines) {
      const color = s.color[l.level]
      series.push(seriesOf(T, l.key, series.length, l.title, bars, l.values, color, { width: s.width, lineStyle: s.style[l.level], axisChip: false }))
      // the newest value runs on from the last bar to the right edge of the chart
      const v = l.values[n - 1]
      if (s.extend && v != null && Number.isFinite(v)) {
        drawn.push({
          id: `${T}:ext-${l.key}`,
          paneId: '',
          xloc: 'bar_time',
          x1: last.time,
          y1: v,
          x2: last.time + step,
          y2: v,
          extend: 'right',
          color,
          invisible: false,
          width: s.width,
          style: s.style[l.level],
          arrowLeft: false,
          arrowRight: false,
          overlay: true,
        })
      }
    }
    return { series, lines: drawn }
  },
  layer: (c, s, ref): PriorLabelsPayload | null => {
    if (!s.tags || (!s.name && !s.price)) return null
    const lines = priorLines(c, s, ref)
    if (!lines.length) return null
    return {
      times: c.bars.map((b) => b.time),
      // Voltick: the words at full strength, whatever the line's alpha
      lines: lines.map((l) => ({ text: s.name ? l.title : '', price: s.price, color: opaque(s.color[l.level]), values: l.values })),
      edge: s.edge,
      extend: s.extend,
      side: s.side,
      px: s.px,
    }
  },
})

/** `#rrggbbaa` → `#rrggbb` (anything else unchanged). */
const opaque = (color: string) => (/^#[0-9a-f]{8}$/i.test(color) ? color.slice(0, 7) : color)

const isLabelsPayload = (d: unknown): d is PriorLabelsPayload =>
  !!d && typeof d === 'object' && Array.isArray((d as PriorLabelsPayload).lines) && Array.isArray((d as PriorLabelsPayload).times)

/** Index of the last time at or before `t` in ascending `times`, or -1. */
function indexAtOrBefore(times: readonly number[], t: number): number {
  let lo = 0
  let hi = times.length - 1
  if (hi < 0 || t < times[0]!) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (times[mid]! <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Prior Levels' labels. Right edge: against the price axis, reading each level
 * where it meets that edge, so a chart scrolled back in time names the levels of
 * the session it shows. Last bar: beside the newest candle. Labels that would
 * overlap sit side by side, each still on its own line.
 */
class PriorLabels implements RendererLayerInstance {
  private canvas: HTMLCanvasElement | null = null

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
  }

  render(args: RendererLayerArgs): void {
    const canvas = this.canvas
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const d = args.data
    if (!isLabelsPayload(d) || !d.lines.length || !args.bars.length) return
    const { coords, scale, bounds } = args
    const dpr = coords.dpr || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, bounds.top, coords.width, bounds.height)
    ctx.clip()

    const n = args.bars.length
    const lastX = coords.logicalToX(n - 1)
    const edgeX = coords.width - 6
    // the bar the labels read: the one at the right edge, or the newest
    const edgeIdx = Math.min(n - 1, Math.floor(coords.rightEdgeLogical))
    const atIdx = d.edge ? edgeIdx : n - 1
    const bar = args.bars[atIdx]
    const at = bar ? indexAtOrBefore(d.times, bar.time) : -1
    // the right edge, unless the lines stop at the last bar and the edge is past it
    const anchor = d.edge ? (d.extend || edgeIdx < n - 1 ? edgeX : Math.min(edgeX, lastX - 6)) : Math.min(edgeX, lastX - 6)
    if (at < 0 || !Number.isFinite(anchor)) {
      ctx.restore()
      return
    }

    ctx.font = `500 ${d.px}px ${args.theme.fontFamily || 'sans-serif'}`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    const h = Math.round(d.px * 1.3)
    const lift = d.side === 'above' ? -(h / 2 + 2) : d.side === 'below' ? h / 2 + 2 : 0
    const placed: { l: number; r: number; t: number; b: number }[] = []
    const items = d.lines
      .map((l) => {
        const v = l.values[at]
        if (v == null || !Number.isFinite(v)) return null
        const y = coords.priceToY(v, scale, bounds)
        if (!Number.isFinite(y)) return null
        const text = [l.text, l.price ? fmt(v) : ''].filter(Boolean).join(' ')
        return { text, color: l.color, y: y + lift }
      })
      .filter((x): x is { text: string; color: string; y: number } => x != null)
      .sort((a, b) => a.y - b.y)
    for (const it of items) {
      const w = ctx.measureText(it.text).width
      let r = anchor
      const t = it.y - h / 2
      const b = it.y + h / 2
      // overlapping an earlier label: move left of it, on the same line
      for (let guard = 0; guard < 8; guard++) {
        const hit = placed.find((p) => t < p.b && b > p.t && r > p.l - 6 && r - w < p.r + 6)
        if (!hit) break
        r = hit.l - 10
      }
      placed.push({ l: r - w, r, t, b })
      ctx.fillStyle = it.color
      ctx.fillText(it.text, r, it.y)
    }
    ctx.restore()
  }

  destroy(): void {
    this.canvas = null
  }
}

provideLayer(PRIOR_TYPE, () => new PriorLabels())

// ═════════════════════════════════════════════════════════════════════════════
// Initial Balance
// ═════════════════════════════════════════════════════════════════════════════

const EXTS = [0.5, 1, 1.5, 2] as const
const EXT_COL = ['ext_05', 'ext_10', 'ext_15', 'ext_20'] as const

interface IbS {
  minutes: number
  ext: boolean
  mid: boolean
  sessions: number
  stats: boolean
}
/** Share of recorded sessions that reached each extension (0–1), and how many sessions. */
interface IbStats {
  hit: (number | null)[]
  n: number
}

export const ibImpl = studyImpl<IbS, IbStats | null>({
  everyTick: true,
  settings: (i) => ({
    minutes: Number(str(i.window, IB_WINDOWS[0]).split(' ')[0]) || 60,
    ext: bool(i.ext, true),
    mid: bool(i.mid, true),
    sessions: int(i.sessions, 1, 1, 60),
    stats: bool(i.stats, true),
  }),
  dataKey: (c, s) => `${c.sym.fut ?? ''}|${s.stats}`,
  load: async (c, s) => {
    if (!s.stats || !c.sym.fut) return null
    const j = await getJson<{ rows?: Record<string, unknown>[] }>(`/api/ib-results?symbol=${c.sym.fut}&limit=90`)
    const rows = j?.rows ?? []
    if (!rows.length) return null
    const hit = EXT_COL.map((k) => {
      const known = rows.filter((r) => r[k] === 0 || r[k] === 1 || r[k] === true || r[k] === false)
      return known.length ? known.filter((r) => r[k] === 1 || r[k] === true).length / known.length : null
    })
    return { hit, n: rows.length }
  },
  refreshMs: 30 * 60_000,
  render: (c, s, stats) => {
    const { bars, tfMs } = c
    if (!bars.length || tfMs >= DAY_MS) return {}
    const n = bars.length
    const col = () => new Array<number | null>(n).fill(null)
    const ibh = col()
    const ibl = col()
    const mid = col()
    const ext = EXTS.map(() => ({ up: col(), dn: col() }))
    // one session per ET date; the cash session's bars (and, on futures, until the 18:00 roll)
    const days = sessionsOf(bars, (t) => etDateKey(t))
    const drawn = days.slice(-s.sessions)
    for (const d of drawn) {
      let h = -Infinity
      let l = Infinity
      let set = false
      for (let i = d.from; i <= d.to; i++) {
        const b = bars[i]!
        const m = etMinutesOfDay(b.time)
        if (m < RTH_OPEN || m >= FUT_OPEN) continue
        const inIb = m < RTH_OPEN + s.minutes
        if (inIb) {
          // a bar that straddles the IB end still counts (60m bars on a 60m IB)
          if (b.high > h) h = b.high
          if (b.low < l) l = b.low
        } else set = h > -Infinity
        if (h === -Infinity) continue
        ibh[i] = h
        ibl[i] = l
        if (s.mid) mid[i] = (h + l) / 2
        if (s.ext && set) {
          const w = h - l
          EXTS.forEach((k, j) => {
            ext[j]!.up[i] = h + k * w
            ext[j]!.dn[i] = l - k * w
          })
        }
      }
    }
    const T = IB_TYPE
    // Voltick draws its opening range in slate, the colour that means nothing:
    // a measurement, not a level the engine found. The IB is that range.
    const cIb = tokenHexAlpha('--color-vt-slate', 0.95)
    const cMid = tokenHexAlpha('--color-vt-slate', 0.95)
    const cExt = tokenHexAlpha('--color-vt-slate', 0.95)
    const series: SeriesSpec[] = []
    const labels: DrawingLabel[] = []
    const add = (key: string, title: string, vals: (number | null)[], color: string, o: { dashed?: boolean; width?: number } = {}) => {
      if (!vals.some((v) => v != null)) return
      series.push(seriesOf(T, key, series.length, title, bars, vals, color, { width: o.width ?? 1.4, dashed: o.dashed, axisChip: false }))
    }
    add('ibh', 'IBH', ibh, cIb, { width: 1.8 })
    add('ibl', 'IBL', ibl, cIb, { width: 1.8 })
    if (s.mid) add('mid', 'IB mid', mid, cMid, { dashed: true, width: 1 })
    labels.push(...tag(T, 'ibh', bars, ibh[n - 1], 'IBH', cIb), ...tag(T, 'ibl', bars, ibl[n - 1], 'IBL', cIb))
    if (s.ext) {
      EXTS.forEach((k, j) => {
        const pct = stats?.hit[j]
        const note = pct != null ? ` · ${Math.round(pct * 100)}%` : ''
        add(`up${k}`, `IB +${k}×`, ext[j]!.up, cExt, { dashed: true, width: 1 })
        add(`dn${k}`, `IB −${k}×`, ext[j]!.dn, cExt, { dashed: true, width: 1 })
        labels.push(...tag(T, `up${k}`, bars, ext[j]!.up[n - 1], `+${k}×${note}`, cExt), ...tag(T, `dn${k}`, bars, ext[j]!.dn[n - 1], `−${k}×${note}`, cExt))
      })
    }
    return { series, labels }
  },
})

// ═════════════════════════════════════════════════════════════════════════════
// Overnight / pre-market High / Low
// ═════════════════════════════════════════════════════════════════════════════


interface OnS {
  mid: boolean
  sessions: number
  tags: boolean
}
interface OnData {
  /** Session date → the window's high / low, already in this chart's prices. */
  levels: Map<string, { h: number; l: number; from: number }>
}

/** The extended tape the window is read from: the futures' own, or the cash symbol's. */
async function extendedTape(c: StudyCtx): Promise<{ bars: Bar[]; fut: boolean; basis: BasisModel | null }> {
  const k = c.sym
  if (k.fut) return { bars: parseEsCandles(await query<unknown>(esCandlesUrl(5, 8, k.fut), { staleMs: 30_000 })), fut: true, basis: null }
  if (k.key === 'SPX' || k.key === 'NDX') {
    const fut = k.key === 'NDX' ? 'NQ' : 'ES'
    const [json, basis] = await Promise.all([query<unknown>(esCandlesUrl(5, 8, fut), { staleMs: 30_000 }), loadBasis(fut)])
    return { bars: parseEsCandles(json), fut: true, basis }
  }
  return { bars: parseCandles(await query<unknown>(`${candlesUrl(symbolDef(k.key), 5, 8)}&limit=8000`, { staleMs: 30_000 })), fut: false, basis: null }
}

export const overnightImpl = studyImpl<OnS, OnData>({
  settings: (i) => ({ mid: bool(i.mid, false), sessions: int(i.sessions, 1, 1, 8), tags: bool(i.tags, true) }),
  dataKey: (c) => c.sym.key,
  load: async (c) => {
    const { bars, fut, basis } = await extendedTape(c)
    const levels = new Map<string, { h: number; l: number; from: number }>()
    for (const b of bars) {
      const m = etMinutesOfDay(b.t)
      // the window: futures 18:00 (the evening before) → 09:30; cash 04:00 → 09:30
      const inWindow = fut ? m >= FUT_OPEN || m < RTH_OPEN : m >= 4 * 60 && m < RTH_OPEN
      if (!inWindow) continue
      const date = fut ? sessionKey(b.t, true) : etDateKey(b.t)
      const cur = levels.get(date)
      if (cur) {
        cur.h = Math.max(cur.h, b.h)
        cur.l = Math.min(cur.l, b.l)
      } else levels.set(date, { h: b.h, l: b.l, from: b.t })
    }
    if (basis) {
      // ES → SPX: that session's basis; no plausible basis, no level
      for (const [d, v] of [...levels]) {
        const shift = basis.days.get(d) ?? basis.basis
        if (!(shift > 0 && shift < basis.max)) levels.delete(d)
        else levels.set(d, { h: v.h - shift, l: v.l - shift, from: v.from })
      }
    }
    return { levels }
  },
  refreshMs: 60_000,
  render: (c, s, data) => {
    const { bars, tfMs } = c
    if (!bars.length || !data || tfMs >= DAY_MS) return {}
    const fut = c.sym.kind === 'futures'
    const n = bars.length
    const hi = new Array<number | null>(n).fill(null)
    const lo = new Array<number | null>(n).fill(null)
    const md = new Array<number | null>(n).fill(null)
    const sessions = sessionsOf(bars, (t) => sessionKey(t, fut))
    for (const ss of sessions.slice(-s.sessions)) {
      const lv = data.levels.get(ss.key)
      if (!lv) continue
      for (let i = ss.from; i <= ss.to; i++) {
        const t = bars[i]!.time
        if (t < lv.from) continue
        // through the cash session; on futures the rest of the day too
        if (!fut && etMinutesOfDay(t) >= RTH_CLOSE + 4 * 60) continue
        hi[i] = lv.h
        lo[i] = lv.l
        if (s.mid) md[i] = (lv.h + lv.l) / 2
      }
    }
    const T = ON_TYPE
    // Voltick's pre-market high / low colour (PRE_MARKET): the overnight range is that range.
    const cOn = tokenHexAlpha('--color-vt-premarket', 0.9)
    const series: SeriesSpec[] = []
    const labels: DrawingLabel[] = []
    if (hi.some((v) => v != null)) {
      series.push(seriesOf(T, 'onh', 0, 'ONH', bars, hi, cOn, { width: 1.4, axisChip: false }))
      series.push(seriesOf(T, 'onl', 1, 'ONL', bars, lo, cOn, { width: 1.4, axisChip: false }))
      if (s.mid) series.push(seriesOf(T, 'onm', 2, 'ON mid', bars, md, tokenHexAlpha('--color-vt-premarket', 0.95), { width: 1, dashed: true, axisChip: false }))
      if (s.tags) labels.push(...tag(T, 'onh', bars, hi[n - 1], 'ONH', cOn), ...tag(T, 'onl', bars, lo[n - 1], 'ONL', cOn))
    }
    return { series, labels }
  },
})
