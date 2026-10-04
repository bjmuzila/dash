// ─────────────────────────────────────────────────────────────────────────────
// CB EDGE STUDIES — session levels: Prior Day / Week / Month, Initial Balance,
// Overnight (pre-market) High / Low. Three Vela native studies (common.ts).
//
//   Prior Levels   PDH / PDL / PDC, PWH / PWL, PMH / PML — each session drawn
//                  at the session before's values, as steps. Computed from the
//                  chart's own bars (regular hours by default, or the full
//                  session); on ES the newest day / week come from the
//                  recorder's /api/ref-levels when the chart's bars do not reach
//                  back far enough to have them.
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

import type { OHLCV, SeriesSpec, DrawingLabel } from '@luxalgo/vela'
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
  seriesOf,
  sessionKey,
  sessionsOf,
  str,
  weekKey,
  type StudyCtx,
} from './common'
import { IB_TYPE, IB_WINDOWS, ON_TYPE, PRIOR_TYPE, SESSION_BASIS as BASIS_OPTS } from './index'

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


interface PriorS {
  day: boolean
  week: boolean
  month: boolean
  close: boolean
  full: boolean
  sessions: number
  tags: boolean
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

export const priorImpl = studyImpl<PriorS, RefLevels | null>({
  settings: (i) => ({
    day: bool(i.day, true),
    week: bool(i.week, true),
    month: bool(i.month, false),
    close: bool(i.close, true),
    full: str(i.basis, BASIS_OPTS[0]) === BASIS_OPTS[1],
    sessions: int(i.sessions, 10, 1, 120),
    tags: bool(i.tags, true),
  }),
  dataKey: (c) => c.sym.key,
  // The recorder's ES reference levels — the one symbol it writes
  load: async (c) => (c.sym.fut === 'ES' ? getJson<RefLevels>('/api/ref-levels?symbol=ES') : null),
  refreshMs: 10 * 60_000,
  render: (c, s, ref) => {
    const { bars, tfMs } = c
    if (!bars.length) return {}
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
    const cD = tokenHexAlpha('--color-series-5', 0.9)
    const cC = tokenHexAlpha('--color-muted', 0.55)
    const cW = tokenHexAlpha('--color-series-4', 0.9)
    const cM = tokenHexAlpha('--color-series-3', 0.9)
    const T = PRIOR_TYPE
    const series: SeriesSpec[] = []
    const labels: DrawingLabel[] = []
    const add = (key: string, title: string, vals: (number | null)[], color: string, dashed = false) => {
      if (!vals.some((v) => v != null)) return
      series.push(seriesOf(T, key, series.length, title, bars, vals, color, { width: 1.2, dashed, axisChip: false }))
      if (s.tags) labels.push(...tag(T, key, bars, vals[n - 1], title, color))
    }
    if (s.day && !weekly) {
      add('pdh', 'PDH', pdh, cD)
      add('pdl', 'PDL', pdl, cD)
      if (s.close) add('pdc', 'PDC', pdc, cC, true)
    }
    if (s.week && !weekly) {
      add('pwh', 'PWH', pwh, cW)
      add('pwl', 'PWL', pwl, cW)
    }
    if (s.month) {
      add('pmh', 'PMH', pmh, cM)
      add('pml', 'PML', pml, cM)
    }
    return { series, labels }
  },
})

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
    sessions: int(i.sessions, 5, 1, 60),
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
    const cIb = tokenHexAlpha('--color-series-1', 0.95)
    const cMid = tokenHexAlpha('--color-series-1', 0.5)
    const cExt = tokenHexAlpha('--color-series-1', 0.45)
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
  settings: (i) => ({ mid: bool(i.mid, false), sessions: int(i.sessions, 5, 1, 8), tags: bool(i.tags, true) }),
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
    const cOn = tokenHexAlpha('--color-series-6', 0.9)
    const series: SeriesSpec[] = []
    const labels: DrawingLabel[] = []
    if (hi.some((v) => v != null)) {
      series.push(seriesOf(T, 'onh', 0, 'ONH', bars, hi, cOn, { width: 1.4, axisChip: false }))
      series.push(seriesOf(T, 'onl', 1, 'ONL', bars, lo, cOn, { width: 1.4, axisChip: false }))
      if (s.mid) series.push(seriesOf(T, 'onm', 2, 'ON mid', bars, md, tokenHexAlpha('--color-series-6', 0.5), { width: 1, dashed: true, axisChip: false }))
      if (s.tags) labels.push(...tag(T, 'onh', bars, hi[n - 1], 'ONH', cOn), ...tag(T, 'onl', bars, lo[n - 1], 'ONL', cOn))
    }
    return { series, labels }
  },
})
