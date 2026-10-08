// ─────────────────────────────────────────────────────────────────────────────
// CB JOURNAL TRADES: your journal's round trips, drawn where they happened.
//
//   /api/tradejournal/trades   journal.cbedge.net, the self-hosted Trade Journal
//                              (owner only; server-v2/api-router.js reads its
//                              /api/trades over the compose network)
//   /api/journal/trades        v2's journal, derived from broker fills, used when
//                              the Trade Journal has nothing for you (2026-10-08:
//                              the indicator read only this one, so the trades kept
//                              in journal.cbedge.net never showed)
//
// Each trade is an entry marker and an exit marker joined by a dashed line,
// green when it made money and red when it lost, with the P&L beside the exit.
// Buys are ▲ and sells are ▼, so a long reads ▲ then ▼ and a short ▼ then ▲.
// Hover a marker or the line for the card: side, size, prices, time held, fees
// and account.
//
// WHICH TRADES. Ones on this chart's instrument: ES and MES on an ES chart, NQ
// and MNQ on an NQ chart, the ticker itself otherwise. Futures and stock trades
// sit at their own fill prices. An OPTION trade has no price on this chart; with
// "Options at the underlying's price" on (the default), it sits on the candle's
// close at its entry and exit times, and the card gives the premiums. Off, option
// trades are skipped.
//
// Settings: winners or losers only, P&L text on or off, one account.
// Signed out, or no journal: nothing is drawn and the legend says idle.
//
// REPLAY: a trade appears once the replay clock passes its entry; its exit and
// P&L once the clock passes the exit.
// ─────────────────────────────────────────────────────────────────────────────

import type { RendererLayerArgs, RendererLayerInstance } from '@luxalgo/vela/plugin'
import { tokenRgb, type RGB } from '@/design/theme'
import { barAt, bool, provideLayer, str, studyImpl, type StudyCtx } from './common'
import { JOURNAL_TYPE, JR_SHOW } from './index'
import { HoverCard, type CardItem, type Tone } from './whaleLayer'

interface Trade {
  symbol: string
  underlying: string
  asset_type: 'future' | 'option' | 'equity' | string
  direction: 'long' | 'short'
  open_ts: number
  close_ts: number
  qty: number
  entry: number
  exit: number
  fees: number
  pnl: number
  account: string
  open_ext_id: string
  close_ext_id: string
}

interface JrS {
  show: 'all' | 'win' | 'loss'
  pnl: boolean
  options: boolean
  account: string
}

const FAMILY: Record<string, string[]> = { ES: ['ES', 'MES'], NQ: ['NQ', 'MNQ'] }
/** A fill this far (as a share of the candle's close) from its candle is not on this chart's prices. */
const OFF_CHART = 0.1

function onThisChart(c: StudyCtx, t: Trade): 'price' | 'under' | null {
  const u = (t.underlying || '').toUpperCase()
  if (c.sym.fut) return t.asset_type === 'future' && (FAMILY[c.sym.fut] ?? []).includes(u) ? 'price' : null
  if (u !== c.sym.key) return null
  return t.asset_type === 'option' ? 'under' : 'price'
}

/** journal.cbedge.net first; v2's journal when that has nothing (not the owner, not deployed, empty). */
async function loadTrades(): Promise<Trade[]> {
  const fromJournal = await loadFrom('/api/tradejournal/trades')
  return fromJournal.length ? fromJournal : loadFrom('/api/journal/trades')
}

async function loadFrom(url: string): Promise<Trade[]> {
  try {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' })
    if (!r.ok) return []
    const j = (await r.json()) as { trades?: unknown }
    const list = Array.isArray(j.trades) ? (j.trades as Partial<Trade>[]) : []
    return list
      .map((t) => ({
        symbol: String(t.symbol ?? ''),
        underlying: String(t.underlying ?? ''),
        asset_type: String(t.asset_type ?? ''),
        direction: t.direction === 'short' ? ('short' as const) : ('long' as const),
        open_ts: Number(t.open_ts),
        // an open position has no close: it draws as its entry alone
        close_ts: t.close_ts == null ? Infinity : Number(t.close_ts),
        qty: Number(t.qty) || 0,
        entry: Number(t.entry),
        exit: t.exit == null ? NaN : Number(t.exit),
        fees: Number(t.fees) || 0,
        pnl: Number(t.pnl) || 0,
        account: String(t.account ?? ''),
        open_ext_id: String(t.open_ext_id ?? ''),
        close_ext_id: String(t.close_ext_id ?? ''),
      }))
      .filter((t) => Number.isFinite(t.open_ts) && !Number.isNaN(t.close_ts))
  } catch {
    return []
  }
}

export interface JrItem extends CardItem {
  t0: number
  p0: number
  /** null while a replay has not reached the exit yet. */
  t1: number | null
  p1: number | null
  long: boolean
  label: string
}

export interface JrPayload {
  items: JrItem[]
}

const money = (v: number) => `${v < 0 ? '−' : '+'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 })}`
const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })
const TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
function held(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.round(h / 24)}d`
}
const px = (v: number) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '·')

export const journalImpl = studyImpl<JrS, Trade[]>({
  settings: (i) => {
    const show = str(i.show, JR_SHOW[0])
    return {
      show: show === JR_SHOW[1] ? 'win' : show === JR_SHOW[2] ? 'loss' : 'all',
      pnl: bool(i.pnl, true),
      options: bool(i.options, true),
      account: typeof i.account === 'string' ? i.account.trim() : '',
    }
  },
  dataKey: () => 'journal',
  load: () => loadTrades(),
  refreshMs: 120_000,
  everyTick: true,
  render: () => ({}),
  layer: (c, s, trades): JrPayload | null => {
    if (!trades?.length || !c.bars.length) return null
    const first = c.bars[0]!.time
    const lastEnd = c.bars[c.bars.length - 1]!.time + c.tfMs
    const until = Math.min(c.until, lastEnd)
    const priceAt = (t: number): number | null => {
      const i = barAt(c.bars, t, c.tfMs)
      return i >= 0 ? c.bars[i]!.close : null
    }
    const items: JrItem[] = []
    for (const t of trades) {
      if (t.open_ts < first || t.open_ts >= until) continue
      if (s.account && t.account !== s.account) continue
      if (s.show === 'win' && !(t.pnl > 0)) continue
      if (s.show === 'loss' && !(t.pnl < 0)) continue
      const how = onThisChart(c, t)
      if (!how || (how === 'under' && !s.options)) continue
      const closed = t.close_ts < until
      // A fill far from this chart's own prices (more than OFF_CHART from the candle
      // it printed in: demo data at last year's prices, a split, a different
      // contract) sits on the candle's close like an option does, and its card says
      // so, rather than drawing far off the chart where nobody sees it.
      const c0 = priceAt(t.open_ts)
      const off = how === 'price' && c0 != null && c0 > 0 && Math.abs(t.entry - c0) / c0 > OFF_CHART
      const atCandle = how === 'under' || off
      const p0 = atCandle ? c0 : t.entry
      const p1 = closed ? (atCandle ? priceAt(t.close_ts) : t.exit) : null
      if (p0 == null || !Number.isFinite(p0)) continue
      const long = t.direction === 'long'
      const tone: Tone = !closed ? 'mid' : t.pnl > 0 ? 'up' : t.pnl < 0 ? 'down' : 'mid'
      const rows: CardItem['card']['rows'] = []
      if (how === 'under') {
        rows.push({ text: `${t.symbol}`, amount: '', tone: 'mid' })
        rows.push({ text: 'Premium in → out', amount: `${px(t.entry)} → ${closed ? px(t.exit) : '…'}`, tone: 'mid' })
      } else {
        rows.push({ text: 'Entry', amount: px(t.entry), tone: 'mid' })
        rows.push({ text: 'Exit', amount: closed ? px(t.exit) : Number.isFinite(t.close_ts) ? 'open (replay)' : 'still open', tone: 'mid' })
        if (off) rows.push({ text: 'Fills are off this chart\'s prices: shown at the candle', amount: '', tone: 'mid' })
      }
      if (t.fees) rows.push({ text: 'Fees', amount: `$${t.fees.toFixed(2)}`, tone: 'mid' })
      if (t.account) rows.push({ text: 'Account', amount: t.account, tone: 'mid' })
      items.push({
        id: `${t.open_ext_id}|${t.close_ext_id}`,
        tone,
        t0: t.open_ts,
        p0,
        t1: closed ? t.close_ts : null,
        p1: p1 != null && Number.isFinite(p1) ? p1 : null,
        long,
        label: closed ? money(t.pnl) : '',
        card: {
          head: `${long ? 'Long' : 'Short'} ${t.qty} ${how === 'under' ? t.underlying + ' option' : t.underlying}`,
          net: closed ? money(t.pnl) : 'open',
          when: `${DAY.format(t.open_ts)} · ${TIME.format(t.open_ts)}${closed ? ` → ${TIME.format(t.close_ts)} · ${held(t.close_ts - t.open_ts)}` : ''}`,
          rows,
          more: 0,
        },
      })
    }
    if (!s.pnl) for (const it of items) it.label = ''
    return items.length ? { items } : null
  },
})

// ── Painting ─────────────────────────────────────────────────────────────────

const hb = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
const hexA = (c: RGB, a: number) => `#${hb(c[0])}${hb(c[1])}${hb(c[2])}${hb(Math.max(0, Math.min(1, a)) * 255)}`

function isPayload(v: unknown): v is JrPayload {
  return !!v && typeof v === 'object' && Array.isArray((v as JrPayload).items)
}

/** x of a moment inside its candle (see whaleLayer.ts). */
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

function triangle(g: CanvasRenderingContext2D, x: number, y: number, up: boolean, size: number): void {
  g.beginPath()
  if (up) {
    g.moveTo(x, y - size)
    g.lineTo(x + size, y + size * 0.8)
    g.lineTo(x - size, y + size * 0.8)
  } else {
    g.moveTo(x, y + size)
    g.lineTo(x + size, y - size * 0.8)
    g.lineTo(x - size, y - size * 0.8)
  }
  g.closePath()
}

/** Distance from a point to a segment. */
function segDist(px0: number, py0: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const L = dx * dx + dy * dy
  const k = L ? Math.max(0, Math.min(1, ((px0 - ax) * dx + (py0 - ay) * dy) / L)) : 0
  return Math.hypot(px0 - (ax + k * dx), py0 - (ay + k * dy))
}

class JournalLayer implements RendererLayerInstance {
  private canvas: HTMLCanvasElement | null = null
  private readonly card = new HoverCard()

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
  }

  render(args: RendererLayerArgs): void {
    const canvas = this.canvas
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, canvas.width, canvas.height)
    const d = args.data
    if (!isPayload(d)) {
      this.card.hide()
      return
    }
    const { coords, scale, bounds, bars, cursor } = args
    const dpr = coords.dpr || 1
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.save()
    g.beginPath()
    g.rect(0, bounds.top, coords.width, bounds.height)
    g.clip()
    const tf = coords.barInterval || (bars.length > 1 ? bars[1]!.time - bars[0]!.time : 60_000)
    const up = tokenRgb('--color-up')
    const down = tokenRgb('--color-down')
    const mid = tokenRgb('--color-muted')
    const bg = tokenRgb('--color-bg')
    const toneRgb = (t: Tone) => (t === 'up' ? up : t === 'down' ? down : mid)
    let hover: { it: JrItem; x: number; y: number } | null = null
    let best = 9
    g.font = '700 10px system-ui, sans-serif'
    g.textBaseline = 'middle'
    for (const it of d.items) {
      const x0 = xAt(it.t0, bars, tf, coords)
      if (x0 == null) continue
      const y0 = coords.priceToY(it.p0, scale, bounds)
      const x1 = it.t1 != null ? xAt(it.t1, bars, tf, coords) : null
      const y1 = it.p1 != null ? coords.priceToY(it.p1, scale, bounds) : null
      if (x0 > coords.width + 20 && (x1 == null || x1 > coords.width + 20)) continue
      if (x1 != null && x1 < -20) continue
      const c = toneRgb(it.tone)
      if (x1 != null && y1 != null) {
        g.setLineDash([4, 3])
        g.strokeStyle = hexA(c, 0.8)
        g.lineWidth = 1.25
        g.beginPath()
        g.moveTo(x0, y0)
        g.lineTo(x1, y1)
        g.stroke()
        g.setLineDash([])
      }
      // entry: a buy ▲ for a long, a sell ▼ for a short; the exit the other way
      const draw = (x: number, y: number, buy: boolean) => {
        triangle(g, x, y, buy, 5.5)
        g.fillStyle = hexA(buy ? up : down, 1)
        g.fill()
        g.lineWidth = 1
        g.strokeStyle = hexA(bg, 0.9)
        g.stroke()
      }
      draw(x0, y0, it.long)
      if (x1 != null && y1 != null) {
        draw(x1, y1, !it.long)
        if (it.label) {
          g.fillStyle = hexA(c, 1)
          g.textAlign = 'left'
          g.fillText(it.label, x1 + 8, y1)
        }
      }
      if (cursor) {
        const dm = Math.min(Math.hypot(cursor.x - x0, cursor.y - y0), x1 != null && y1 != null ? Math.hypot(cursor.x - x1, cursor.y - y1) : Infinity)
        const dl = x1 != null && y1 != null ? segDist(cursor.x, cursor.y, x0, y0, x1, y1) + 2 : Infinity
        const dd = Math.min(dm, dl)
        if (dd < best) {
          best = dd
          hover = { it, x: x1 ?? x0, y: y1 ?? y0 }
        }
      }
    }
    g.restore()
    if (hover) {
      const rect = canvas.getBoundingClientRect()
      this.card.show(hover.it, rect.left + hover.x, rect.top + hover.y, 8)
    } else this.card.hide()
  }

  destroy(): void {
    this.card.destroy()
    this.canvas = null
  }
}

provideLayer(JOURNAL_TYPE, () => new JournalLayer())
