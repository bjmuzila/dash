// ─────────────────────────────────────────────────────────────────────────────
// CB EDGE STUDIES — the options-derived levels: Expected Move bands, Key
// Levels, and GEX by strike beside the price axis. Vela native studies
// (common.ts) over the routes the board cards already read.
//
//   Expected Move  each session's frozen daily band (/api/daily-em, the EM page
//                  and GEX Candles' rails — one request per session, the past
//                  ones cached for the day) as steps: EM ↑, EM ↓, the close it
//                  was struck from; and this week's band (/api/em-tracker, the
//                  Key Levels card's weekly EM) as two price lines.
//   Key Levels     what the Key Levels card lists, as price lines with axis
//                  chips, in Voltick's names (the page is Voltick's chart):
//                  ★ Volt (CORE, the top net GEX), ◆ Coil (the 2nd top on the
//                  Volt's side of spot), ↘ Reversal (the top across spot), ⚡︎ Flip,
//                  Max Pain off the front-expiry chain (/api/chains →
//                  board/chainGex.ts), and this week's published pivot and
//                  lower / upper zones (/api/levels — the levels CB Edge posts).
//   GEX Profile    net GEX per strike as horizontal bars hugging the right edge
//                  of the visible chart, beside the price axis — green above
//                  zero, red below, the biggest strikes tagged. Follows scroll
//                  and zoom (it is drawn in the viewport, not at a bar).
//
// Futures: ES / NQ have no chain of their own; theirs is SPX / NDX's, moved up
// by the session's basis (board/gexCandles/basis.ts), exactly as CB Walls does.
// ─────────────────────────────────────────────────────────────────────────────

import type { DrawingBox, DrawingLabel, PriceLine, SeriesSpec, Fill } from '@luxalgo/vela'
import { stableSeriesId } from '@luxalgo/vela/plugin'
import { tokenHexAlpha } from '@/design/theme'
import { vtFromLadder } from '@/data/voltickLevels'
import type { GexRow } from '@/contract/frames'
import { chainGexUrl, chainToGex, type ChainGex } from '@/board/chainGex'
import { computeMaxPain } from '@/board/keyLevels/levelsMath'
import { dailyEmUrl, parseDailyEm, type DailyEmBand } from '@/data/dailyEm'
import { query } from '@/data/api'
import { loadBasis } from '@/pages/vela/wallsIndicator'
import { DAY_MS, bool, studyImpl, etDateKey, int, labelAt, money, priceLineOf, seriesOf, sessionKey, sessionsOf, str, type StudyCtx } from './common'
import { EM_TYPE, GEX_BASIS as BASIS, KEY_TYPE, PROFILE_TYPE } from './index'
import { columnAt, loadLadder, sessionDates, type Ladder } from './ladder'

/** Voltick's flip mark: ⚡ + VS15, so it draws as TEXT in the flip's colour, never
 *  as the orange emoji (orange is the Volt's). */
const FLIP_MARK = '\u26A1\uFE0E'

/** The symbol whose options make this chart's levels, and what to add to move them onto it. */
async function underlying(c: StudyCtx): Promise<{ ticker: string; shift: number } | null> {
  const fut = c.sym.fut
  if (!fut) return { ticker: c.sym.key, shift: 0 }
  const basis = await loadBasis(fut)
  const b = basis.basis
  if (!(b > 0 && b < basis.max)) return null // an unshifted SPX level on ES is a level one basis off
  return { ticker: fut === 'NQ' ? 'NDX' : 'SPX', shift: b }
}

// ═════════════════════════════════════════════════════════════════════════════
// Expected Move
// ═════════════════════════════════════════════════════════════════════════════


interface EmS {
  daily: boolean
  weekly: boolean
  close: boolean
  fill: boolean
  sessions: number
}
interface EmData {
  bands: Map<string, DailyEmBand>
  weekly: { up: number; down: number; label: string } | null
  /** Per session date, the shift onto this chart's prices (futures: that day's basis). */
  shift: Map<string, number>
  fallbackShift: number
}

export const emImpl = studyImpl<EmS, EmData>({
  settings: (i) => ({
    daily: bool(i.daily, true),
    weekly: bool(i.weekly, true),
    close: bool(i.close, true),
    fill: bool(i.fill, true),
    sessions: int(i.sessions, 1, 1, 30),
  }),
  dataKey: (c, s) => `${c.sym.key}|${s.sessions}|${c.bars.length ? sessionKey(c.bars[0]!.time, !!c.sym.fut) : ''}`,
  load: async (c, s) => {
    const fut = c.sym.fut ?? null
    const ticker = fut === 'NQ' ? 'NDX' : fut === 'ES' ? 'SPX' : c.sym.key
    const basis = fut ? await loadBasis(fut) : null
    const dates = sessionsOf(c.bars, (t) => sessionKey(t, !!fut))
      .map((x) => x.key)
      .slice(-s.sessions)
    const today = etDateKey(Date.now())
    const bands = new Map<string, DailyEmBand>()
    await Promise.all(
      dates.map(async (d) => {
        try {
          const json = await query<unknown>(dailyEmUrl(ticker, d === today ? undefined : d), { staleMs: d === today ? 5 * 60_000 : 12 * 3_600_000 })
          const b = parseDailyEm(json)
          if (b) bands.set(d, b)
        } catch {
          /* no band that session — nothing drawn there */
        }
      }),
    )
    let weekly: EmData['weekly'] = null
    try {
      const j = await query<{ rows?: { em?: number | null; ref_close?: number | null; up?: number | null; down?: number | null; week_label?: string | null }[] }>(
        `/api/em-tracker?ticker=${encodeURIComponent(ticker)}`,
        { staleMs: 600_000 },
      )
      const row = j?.rows?.[0]
      if (row) {
        const ref = typeof row.ref_close === 'number' ? row.ref_close : null
        const em = typeof row.em === 'number' ? row.em : null
        const up = typeof row.up === 'number' ? row.up : ref != null && em != null ? ref + em : null
        const down = typeof row.down === 'number' ? row.down : ref != null && em != null ? ref - em : null
        if (up != null && down != null && up > 0 && down > 0) weekly = { up, down, label: row.week_label ?? '' }
      }
    } catch {
      /* no weekly row */
    }
    const shift = new Map<string, number>()
    for (const d of dates) {
      const b = basis ? (basis.days.get(d) ?? basis.basis) : 0
      if (!basis || (b > 0 && b < basis.max)) shift.set(d, b)
    }
    const fb = basis ? basis.basis : 0
    return { bands, weekly, shift, fallbackShift: basis && !(fb > 0 && fb < basis.max) ? NaN : fb }
  },
  refreshMs: 5 * 60_000,
  render: (c, s, data) => {
    const { bars, tfMs } = c
    if (!bars.length || !data) return {}
    const fut = !!c.sym.fut
    const n = bars.length
    const up = new Array<number | null>(n).fill(null)
    const dn = new Array<number | null>(n).fill(null)
    const rc = new Array<number | null>(n).fill(null)
    if (s.daily && tfMs < 7 * DAY_MS) {
      for (const ss of sessionsOf(bars, (t) => (tfMs >= DAY_MS ? etDateKey(t + 12 * 3_600_000) : sessionKey(t, fut))).slice(-s.sessions)) {
        const b = data.bands.get(ss.key)
        const sh = data.shift.get(ss.key)
        if (!b || sh == null) continue
        for (let i = ss.from; i <= ss.to; i++) {
          up[i] = b.up + sh
          dn[i] = b.down + sh
          rc[i] = b.refClose + sh
        }
      }
    }
    const T = EM_TYPE
    // Accent Text: the blue family, and no reserved hue (the CB EM violet is Voltick's flip)
    const cEm = tokenHexAlpha('--color-vt-accent-text', 0.95)
    const series: SeriesSpec[] = []
    const fills: Fill[] = []
    const labels: DrawingLabel[] = []
    const last = bars[n - 1]!
    if (up.some((v) => v != null)) {
      const a = seriesOf(T, 'up', 0, 'EM ↑', bars, up, cEm, { width: 1.5, axisChip: false })
      const b = seriesOf(T, 'dn', 1, 'EM ↓', bars, dn, cEm, { width: 1.5, axisChip: false })
      series.push(a, b)
      if (s.close) series.push(seriesOf(T, 'rc', 2, 'EM close', bars, rc, tokenHexAlpha('--color-vt-accent-text', 0.95), { width: 1, dashed: true, axisChip: false }))
      if (s.fill) fills.push({ id: stableSeriesId({ instanceId: T, kind: 'fill', title: 'band', ordinal: 0 }), paneId: '', fromSeriesId: a.id, toSeriesId: b.id, color: tokenHexAlpha('--color-vt-accent-text', 0.06) })
      const lu = up[n - 1]
      const ld = dn[n - 1]
      if (lu != null) labels.push(labelAt(T, 'tag-up', last.time, lu, `EM ↑ ${lu.toFixed(2)}`, cEm, { textColor: cEm, noFill: true }))
      if (ld != null) labels.push(labelAt(T, 'tag-dn', last.time, ld, `EM ↓ ${ld.toFixed(2)}`, cEm, { textColor: cEm, noFill: true }))
    }
    const priceLines: PriceLine[] = []
    if (s.weekly && data.weekly && Number.isFinite(data.fallbackShift)) {
      const cW = tokenHexAlpha('--color-vt-accent-text', 0.95)
      const lbl = data.weekly.label ? ` (${data.weekly.label})` : ''
      priceLines.push(priceLineOf(T, 'wup', data.weekly.up + data.fallbackShift, cW, `Weekly EM ↑${lbl}`, { dashed: true }))
      priceLines.push(priceLineOf(T, 'wdn', data.weekly.down + data.fallbackShift, cW, `Weekly EM ↓${lbl}`, { dashed: true }))
    }
    return { series, fills, labels, priceLines }
  },
})

// ═════════════════════════════════════════════════════════════════════════════
// Key Levels + GEX Profile share one chain read per symbol
// ═════════════════════════════════════════════════════════════════════════════

interface ChainRead {
  chain: ChainGex
  shift: number
  ticker: string
}
async function chainFor(c: StudyCtx, fresh: boolean): Promise<ChainRead | null> {
  const u = await underlying(c)
  if (!u) return null
  // one read per symbol per ~25s, shared by Key Levels and GEX Profile on every chart
  const json = await query<unknown>(chainGexUrl(u.ticker), { staleMs: fresh ? 25_000 : 60_000 })
  const chain = chainToGex(json)
  return chain.rows.length ? { chain, shift: u.shift, ticker: u.ticker } : null
}


interface KeyS {
  walls: boolean
  core: boolean
  flip: boolean
  maxPain: boolean
  weekly: boolean
  zones: boolean
}
interface WeeklyLevels {
  pivot: number | null
  buyNear: number | null
  buyFar: number | null
  sellNear: number | null
  sellFar: number | null
}
interface KeyData {
  read: ChainRead | null
  weekly: WeeklyLevels | null
}
const numOrNull = (v: unknown): number | null => {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) && x > 0 ? x : null
}

export const keyImpl = studyImpl<KeyS, KeyData>({
  settings: (i) => ({
    walls: bool(i.walls, true),
    core: bool(i.core, true),
    flip: bool(i.flip, true),
    maxPain: bool(i.maxPain, true),
    weekly: bool(i.weekly, true),
    zones: bool(i.zones, true),
  }),
  dataKey: (c) => c.sym.key,
  load: async (c, _s, fresh) => {
    const [read, lv] = await Promise.all([
      chainFor(c, fresh).catch(() => null),
      query<Record<string, unknown> | null>(`/api/levels?ticker=${encodeURIComponent(c.sym.fut === 'NQ' ? 'NQ' : c.sym.fut === 'ES' ? 'ES' : c.sym.key)}`, { staleMs: 10 * 60_000 }).catch(() => null),
    ])
    const weekly: WeeklyLevels | null =
      lv && typeof lv === 'object' && !Array.isArray(lv)
        ? { pivot: numOrNull(lv.pivot), buyNear: numOrNull(lv.buy_near), buyFar: numOrNull(lv.buy_far), sellNear: numOrNull(lv.sell_near), sellFar: numOrNull(lv.sell_far) }
        : null
    return { read, weekly }
  },
  refreshMs: 30_000,
  render: (c, s, data) => {
    if (!data) return {}
    const T = KEY_TYPE
    const priceLines: PriceLine[] = []
    const boxes: DrawingBox[] = []
    const labels: DrawingLabel[] = []
    const lastBar = c.bars[c.bars.length - 1]
    const r = data.read
    if (r) {
      const sh = r.shift
      const g = r.chain
      const add = (key: string, v: number | null | undefined, token: string, title: string, o: { width?: number; dashed?: boolean } = {}) => {
        if (v == null || !Number.isFinite(v) || v <= 0) return
        const col = tokenHexAlpha(token, 0.95)
        priceLines.push(priceLineOf(T, key, v + sh, col, title, o))
        // the name beside the line, at the newest bar
        if (lastBar) labels.push(labelAt(T, `tag-${key}`, lastBar.time, v + sh, `${title} ${(v + sh).toFixed(2)}`, col, { textColor: col, noFill: true }))
      }
      // Voltick's levels by the definition (data/voltickLevels.ts vtFromLadder),
      // off this chain's live ladder (OI + vol): ★ Volt = CORE, the top net GEX;
      // ◆ Coil = the 2nd top net GEX on the Volt's side of spot; ↘ Reversal = the
      // top net GEX on the other side. The gamma flip is ⚡︎ Flip in its violet.
      const vt = vtFromLadder(
        g.rows.map((x) => ({ strike: x.strike, net: x.netGEX + x.netVolGEX })),
        g.spot,
        g.core?.strike ?? null,
      )
      if (s.walls) {
        add('coil', vt.coil, '--color-vt-coil', '◆ Coil', { width: 1.6 })
        add('rev', vt.reversal, '--color-vt-reversal', '↘ Reversal', { width: 1.6 })
      }
      if (s.core) add('core', vt.volt, '--color-vt-volt', '★ Volt', { width: 2 })
      if (s.flip) add('flip', g.flip, '--color-vt-flip', `${FLIP_MARK} Flip`, { dashed: true })
      if (s.maxPain) add('mp', computeMaxPain(g.rows as GexRow[]), '--color-vt-quiet', 'Max Pain', { dashed: true })
    }
    const w = data.weekly
    const bars = c.bars
    if (w && bars.length) {
      // weekly levels are the futures' own on ES / NQ (ESU / NQU rows) — no shift
      if (s.weekly && w.pivot) priceLines.push(priceLineOf(T, 'pivot', w.pivot, tokenHexAlpha('--color-vt-quiet', 0.95), 'Weekly Pivot', { dashed: true }))
      if (s.zones) {
        const start = bars[Math.max(0, bars.length - 60)]!.time
        const end = bars[bars.length - 1]!.time
        const zone = (key: string, a: number | null, b: number | null, token: string, text: string) => {
          if (a == null || b == null) return
          boxes.push({
            id: `${T}:${key}`,
            paneId: '',
            xloc: 'bar_time',
            left: start,
            right: end,
            top: Math.max(a, b),
            bottom: Math.min(a, b),
            extend: 'right',
            bgColor: tokenHexAlpha(token, 0.1),
            borderColor: tokenHexAlpha(token, 0.35),
            borderWidth: 1,
            borderStyle: 'dotted',
            text,
            textColor: tokenHexAlpha(token, 0.9),
            textSize: 'small',
            hAlign: 'left',
            vAlign: 'center',
            wrap: false,
            fontFamily: 'default',
            bold: false,
            italic: false,
            overlay: true,
          })
        }
        // Slate, and named by where they sit: a zone is a location, never an
        // instruction (Voltick never says buy or sell), and green / red would read
        // as approval and warning.
        zone('buy', w.buyNear, w.buyFar, '--color-vt-slate', 'Lower zone')
        zone('sell', w.sellNear, w.sellFar, '--color-vt-slate', 'Upper zone')
      }
    }
    return { priceLines, boxes, labels }
  },
})

// ═════════════════════════════════════════════════════════════════════════════
// GEX by strike, beside the price axis
// ═════════════════════════════════════════════════════════════════════════════


interface ProfileS {
  basis: (typeof BASIS)[number]
  width: number
  strikes: number
  tags: number
}

/** Live: the chain. In a bar replay: the recorded per-minute ladders, read at the replay clock. */
type ProfileData = ChainRead | { ladder: Ladder }

/** The rows, spot and shift the profile draws now. */
function profileRows(c: StudyCtx, data: ProfileData): { rows: GexRow[]; spot: number; shift: number } | null {
  if ('chain' in data) return { rows: data.chain.rows, spot: data.chain.spot, shift: data.shift }
  const col = columnAt(data.ladder.columns, c.until)
  if (!col) return null
  const shift = data.ladder.shift(col.slotTs)
  if (shift == null) return null
  // the ladder's `net` is OI + vol and `netVol` is vol, so OI alone is the difference
  const rows = col.cells.map((x) => ({ strike: x.strike, netGEX: x.net - x.netVol, netVolGEX: x.netVol }) as GexRow)
  return { rows, spot: col.spot, shift }
}

export const profileImpl = studyImpl<ProfileS, ProfileData | null>({
  settings: (i) => ({
    basis: (BASIS as readonly string[]).includes(str(i.basis, BASIS[0])) ? (str(i.basis, BASIS[0]) as ProfileS['basis']) : BASIS[0],
    width: int(i.width, 22, 5, 60),
    strikes: int(i.strikes, 30, 5, 120),
    tags: int(i.tags, 3, 0, 10),
  }),
  dataKey: (c) => c.sym.key,
  load: async (c, _s, fresh) => (c.ctx.live ? chainFor(c, fresh) : { ladder: await loadLadder(c, sessionDates(c, 1), fresh) }),
  refreshMs: 30_000,
  // in a replay the profile follows the replay clock minute by minute
  everyTick: true,
  render: (c, s, data) => {
    const bars = c.bars
    if (!data || !bars.length) return {}
    const g = profileRows(c, data)
    if (!g) return {}
    const read = { shift: g.shift }
    const valueOf = (r: GexRow) => (s.basis === 'OI only' ? Number(r.netGEX) || 0 : s.basis === 'Vol only' ? Number(r.netVolGEX) || 0 : (Number(r.netGEX) || 0) + (Number(r.netVolGEX) || 0))
    const rows = [...g.rows].sort((a, b) => a.strike - b.strike)
    const spot = g.spot || bars[bars.length - 1]!.close - read.shift
    let at = rows.findIndex((r) => r.strike >= spot)
    if (at < 0) at = rows.length - 1
    const win = rows.slice(Math.max(0, at - s.strikes), at + s.strikes + 1)
    if (!win.length) return {}
    const max = Math.max(...win.map((r) => Math.abs(valueOf(r))), 1)
    // the strike step, for each bar's thickness
    const steps = win.slice(1).map((r, k) => r.strike - win[k]!.strike).filter((d) => d > 0)
    const step = steps.length ? Math.min(...steps) : 1
    // anchored to the right edge of what is on screen (or of the bars, before the first viewport poke)
    const lastT = bars[bars.length - 1]!.time
    const firstT = bars[Math.max(0, bars.length - 120)]!.time
    const right = c.view ? c.view.to : lastT
    const left = c.view ? c.view.from : firstT
    const span = Math.max(right - left, c.tfMs * 10)
    const full = (span * s.width) / 100
    const T = PROFILE_TYPE
    const up = tokenHexAlpha('--color-vt-chart-up', 0.4)
    const dn = tokenHexAlpha('--color-vt-chart-down', 0.4)
    const boxes: DrawingBox[] = []
    const labels: DrawingLabel[] = []
    for (const r of win) {
      const v = valueOf(r)
      if (!v) continue
      const len = (Math.abs(v) / max) * full
      const y = r.strike + read.shift
      boxes.push({
        id: `${T}:${r.strike}`,
        paneId: '',
        xloc: 'bar_time',
        left: right - len,
        right,
        top: y + step * 0.42,
        bottom: y - step * 0.42,
        extend: 'none',
        bgColor: v > 0 ? up : dn,
        borderWidth: 0,
        borderStyle: 'solid',
        textSize: 'auto',
        hAlign: 'right',
        vAlign: 'center',
        wrap: false,
        fontFamily: 'default',
        bold: false,
        italic: false,
        overlay: true,
      })
    }
    const top = [...win].sort((a, b) => Math.abs(valueOf(b)) - Math.abs(valueOf(a))).slice(0, s.tags)
    for (const r of top) {
      const v = valueOf(r)
      if (!v) continue
      const len = (Math.abs(v) / max) * full
      const col = tokenHexAlpha(v > 0 ? '--color-vt-chart-up' : '--color-vt-chart-down', 1)
      labels.push(labelAt(T, `tag-${r.strike}`, right - len, r.strike + read.shift, `${r.strike} ${money(v)}`, col, { style: 'label_right', textColor: col, noFill: true }))
    }
    return { boxes, labels }
  },
})
