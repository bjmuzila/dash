// ─────────────────────────────────────────────────────────────────────────────
// CB EDGE STUDIES — options flow on the chart: Net Premium and Vol / GEX Flow
// panes, and whale prints as markers. Vela native studies (common.ts).
//
//   Net Premium    the Net Premium card's lines in a pane under the chart:
//                  cumulative call premium, put premium and net (calls − puts)
//                  through each session, off the same per-minute bins
//                  (/proxy/flow-netprem — SQL over the whole session, not the
//                  tape's row cap). Past sessions are fetched once.
//   Vol/GEX Flow   the Vol/GEX Flow card's series (/proxy/gex-vol-flow) in a
//                  pane: volume GEX as a histogram (green / red), OI GEX and the
//                  combined line — today's session, as the card.
//   Whale Prints   ≥ $1M option prints (/api/lse/whales — the Whales page's own
//                  feed, kept forever) as BUBBLES on the bar they printed in,
//                  sized by the bar's net premium (bullish − bearish): green
//                  under the bar when bullish (calls bought, puts sold), red
//                  over it when bearish, grey for prints whose side is unknown.
//                  Hover for a short card of the prints. Drawn by a renderer
//                  layer — whaleLayer.ts, which has the size table.
//
// ES charts read SPX's flow, NQ charts NDX's — the futures have no options here.
// ─────────────────────────────────────────────────────────────────────────────

import type { PriceLine, SeriesSpec } from '@luxalgo/vela'
import { tokenHexAlpha } from '@/design/theme'
import { DAY_MS, barAt, bool, studyImpl, etDateKey, getJson, int, money, provideLayer, seriesOf, sessionsOf, str, type StudyCtx } from './common'
import { NETPREM_TYPE, NP_MIN as MIN_PREM, VF_SCOPES as SCOPES, VF_SESSIONS as SESS, VOLFLOW_TYPE, WHALES_TYPE, WH_CAP, WH_MIN, WH_SIDE } from './index'
import { WhaleLayer, type Tone, type WhaleBubble, type WhalePayload } from './whaleLayer'

const flowTicker = (c: StudyCtx) => (c.sym.fut === 'NQ' ? 'NDX' : c.sym.fut === 'ES' ? 'SPX' : c.sym.key)

// ═════════════════════════════════════════════════════════════════════════════
// Net Premium
// ═════════════════════════════════════════════════════════════════════════════


interface Bin {
  sec: number
  callNet: number
  putNet: number
}
interface NpS {
  sessions: number
  legs: boolean
  otm: boolean
  minPremium: number
}
const MIN_PREM_V = [1_000, 25_000, 100_000, 500_000]

/** Finished sessions never change: one read each per page. */
const pastBins = new Map<string, Bin[]>()

export const netPremImpl = studyImpl<NpS, Map<string, Bin[]>>({
  settings: (i) => ({
    sessions: int(i.sessions, 1, 1, 5),
    legs: bool(i.legs, true),
    otm: bool(i.otm, true),
    minPremium: MIN_PREM_V[Math.max(0, (MIN_PREM as readonly string[]).indexOf(str(i.min, MIN_PREM[0])))] ?? 1_000,
  }),
  dataKey: (c, s) => `${flowTicker(c)}|${s.sessions}|${s.otm}|${s.minPremium}`,
  load: async (c, s) => {
    const t = flowTicker(c)
    const today = etDateKey(Date.now())
    const dates = sessionsOf(c.bars, (x) => etDateKey(x))
      .map((x) => x.key)
      .slice(-s.sessions)
    if (!dates.includes(today) && c.ctx.live) dates.push(today)
    const out = new Map<string, Bin[]>()
    await Promise.all(
      dates.map(async (d) => {
        const url = `/proxy/flow-netprem?underlying=${encodeURIComponent(t)}&bin=60&date=${d}&minPremium=${s.minPremium}${s.otm ? '&otmOnly=1' : ''}`
        const cached = d !== today ? pastBins.get(url) : undefined
        if (cached) {
          out.set(d, cached)
          return
        }
        const j = await getJson<{ bins?: { sec?: unknown; callNet?: unknown; putNet?: unknown }[] }>(url)
        const bins = (j?.bins ?? [])
          .map((b) => ({ sec: Number(b.sec), callNet: Number(b.callNet) || 0, putNet: Number(b.putNet) || 0 }))
          .filter((b) => Number.isFinite(b.sec))
          .sort((a, b) => a.sec - b.sec)
        out.set(d, bins)
        if (d !== today && j) pastBins.set(url, bins)
      }),
    )
    return out
  },
  refreshMs: 15_000,
  render: (c, s, data) => {
    const { bars, tfMs } = c
    if (!bars.length || !data || tfMs >= DAY_MS) return {}
    const n = bars.length
    const calls = new Array<number | null>(n).fill(null)
    const puts = new Array<number | null>(n).fill(null)
    const net = new Array<number | null>(n).fill(null)
    const netC = new Array<string | null>(n).fill(null)
    const up = tokenHexAlpha('--color-up', 1)
    const down = tokenHexAlpha('--color-down', 1)
    for (const ss of sessionsOf(bars, (x) => etDateKey(x))) {
      const bins = data.get(ss.key)
      if (!bins?.length) continue
      let k = 0
      let cc = 0
      let pp = 0
      let seen = false
      for (let i = ss.from; i <= ss.to; i++) {
        const end = bars[i]!.time + tfMs
        while (k < bins.length && bins[k]!.sec * 1000 < end) {
          cc += bins[k]!.callNet
          pp += bins[k]!.putNet
          k++
          seen = true
        }
        if (!seen) continue
        calls[i] = cc
        puts[i] = pp
        net[i] = cc - pp
        netC[i] = cc - pp >= 0 ? up : down
        if (k >= bins.length && bars[i]!.time > bins[bins.length - 1]!.sec * 1000 + 30 * 60_000) break
      }
    }
    const T = NETPREM_TYPE
    const series: SeriesSpec[] = []
    if (net.some((v) => v != null)) {
      series.push(seriesOf(T, 'net', 0, 'Net', bars, net, up, { kind: 'line', width: 2, colors: netC }))
      if (s.legs) {
        series.push(seriesOf(T, 'calls', 1, 'Calls', bars, calls, tokenHexAlpha('--color-up', 0.5), { kind: 'line', width: 1.2 }))
        series.push(seriesOf(T, 'puts', 2, 'Puts', bars, puts, tokenHexAlpha('--color-down', 0.5), { kind: 'line', width: 1.2 }))
      }
    }
    const priceLines: PriceLine[] = [{ id: `${T}:zero`, paneId: '', price: 0, color: tokenHexAlpha('--color-muted', 0.35), width: 1, lineStyle: 'dashed' }]
    return { series, priceLines }
  },
})

// ═════════════════════════════════════════════════════════════════════════════
// Vol / GEX Flow
// ═════════════════════════════════════════════════════════════════════════════


interface VfS {
  front: boolean
  eth: boolean
  bin: number
  oi: boolean
  combined: boolean
}
interface VfPoint {
  ts: number
  volGex: number
  oiGex: number
  combined: number
}

export const volFlowImpl = studyImpl<VfS, VfPoint[]>({
  settings: (i) => ({
    front: str(i.scope, SCOPES[0]) === SCOPES[1],
    eth: str(i.session, SESS[0]) === SESS[1],
    bin: int(i.bin, 60, 60, 900),
    oi: bool(i.oi, false),
    combined: bool(i.combined, true),
  }),
  dataKey: (c, s) => `${flowTicker(c)}|${s.front}|${s.eth}|${s.bin}`,
  load: async (c, s) => {
    const t = flowTicker(c)
    const symbol = t === 'SPX' || t === 'NDX' || t === 'RUT' ? `$${t}` : t
    const j = await getJson<{ ok?: boolean; points?: Record<string, unknown>[] }>(
      `/proxy/gex-vol-flow?bin=${s.bin}&session=${s.eth ? 'eth' : 'rth'}&scope=${s.front ? 'front' : 'all'}&symbol=${encodeURIComponent(symbol)}`,
    )
    if (!j || j.ok === false || !Array.isArray(j.points)) return []
    return j.points
      .map((p) => ({ ts: Number(p.ts), volGex: Number(p.volGex), oiGex: Number(p.oiGex), combined: Number(p.combined) }))
      .filter((p) => Number.isFinite(p.ts))
      .sort((a, b) => a.ts - b.ts)
  },
  refreshMs: 15_000,
  render: (c, s, pts) => {
    const { bars, tfMs } = c
    if (!bars.length || !pts?.length || tfMs >= DAY_MS) return {}
    const n = bars.length
    const vol = new Array<number | null>(n).fill(null)
    const volC = new Array<string | null>(n).fill(null)
    const oi = new Array<number | null>(n).fill(null)
    const comb = new Array<number | null>(n).fill(null)
    const up = tokenHexAlpha('--color-candle-up', 0.7)
    const dn = tokenHexAlpha('--color-candle-down', 0.7)
    const first = pts[0]!.ts
    const lastTs = pts[pts.length - 1]!.ts
    let k = -1
    for (let i = 0; i < n; i++) {
      const t = bars[i]!.time
      if (t + tfMs <= first) continue
      if (t > lastTs + tfMs) break
      while (k + 1 < pts.length && pts[k + 1]!.ts < t + tfMs) k++
      const p = pts[k]
      if (!p) continue
      if (Number.isFinite(p.volGex)) {
        vol[i] = p.volGex
        volC[i] = p.volGex >= 0 ? up : dn
      }
      if (Number.isFinite(p.oiGex)) oi[i] = p.oiGex
      if (Number.isFinite(p.combined)) comb[i] = p.combined
    }
    const T = VOLFLOW_TYPE
    const series: SeriesSpec[] = [seriesOf(T, 'vol', 0, 'Vol GEX', bars, vol, up, { kind: 'histogram', colors: volC })]
    if (s.oi) series.push(seriesOf(T, 'oi', 1, 'OI GEX', bars, oi, tokenHexAlpha('--color-series-1', 0.9), { kind: 'line', width: 1.4 }))
    if (s.combined) series.push(seriesOf(T, 'comb', 2, 'Combined', bars, comb, tokenHexAlpha('--color-level-cb', 0.9), { kind: 'line', width: 1.6 }))
    return { series }
  },
})

// ═════════════════════════════════════════════════════════════════════════════
// Whale prints
// ═════════════════════════════════════════════════════════════════════════════


interface WhRow {
  ts: number
  type: 'C' | 'P' | null
  strike: number | null
  expiry: string | null
  size: number | null
  price: number | null
  premium: number
  action: 'BUY' | 'SELL' | null
  underlying: string | null
}
interface WhS {
  minPremium: number
  days: number
  side: 'all' | 'C' | 'P'
  cap: number
  size: number
  text: boolean
}
const WH_MIN_V = [1e6, 2e6, 5e6, 10e6]
const WH_CAP_V = [25e6, 10e6, 50e6, 100e6]
/** Bubble radius bounds, px at 100% (whaleLayer.ts has the table). */
export const R_MIN = 5
export const R_MAX = 26

/** Bullish = call bought / put sold; bearish = put bought / call sold; null when the side is unknown. */
function biasOf(r: WhRow): 1 | -1 | 0 {
  if (!r.action || !r.type) return 0
  return (r.action === 'BUY') === (r.type === 'C') ? 1 : -1
}

/** Area follows premium up to `cap`, never under R_MIN or over R_MAX, then the size setting. */
export function bubbleRadius(premium: number, cap: number, size = 1): number {
  const k = cap > 0 && premium > 0 ? Math.sqrt(premium / cap) : 0
  return Math.max(R_MIN, Math.min(R_MAX, R_MAX * k)) * size
}

/** `$2.4M`, `$12M`, `$850K` — `money` without a trailing `.0`. */
const short = (v: number) => money(v).replace(/\.0(?=[KMB])/, '')

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** `0DTE` on its own expiry day, else `Oct 5` (`Jan 15 ’27` in another year). */
function expiryText(expiry: string | null, printedOn: string): string {
  if (!expiry) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry)
  if (!m) return expiry
  if (expiry.slice(0, 10) === printedOn) return '0DTE'
  const txt = `${MON[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}`
  return m[1] === printedOn.slice(0, 4) ? txt : `${txt} ’${m[1]!.slice(2)}`
}

const strikeText = (k: number | null) => (k == null ? '' : Number.isInteger(k) ? String(k) : String(+k.toFixed(2)))

/** One print as the card says it: `Bought 758 Call · Oct 5`. */
export function printLine(r: WhRow): string {
  const verb = r.action === 'BUY' ? 'Bought' : r.action === 'SELL' ? 'Sold' : ''
  const kind = r.type === 'C' ? 'Call' : r.type === 'P' ? 'Put' : 'option'
  const contract = [verb, strikeText(r.strike), kind].filter(Boolean).join(' ')
  const exp = expiryText(r.expiry, etDateKey(r.ts))
  return exp ? `${contract} · ${exp}` : contract
}

const DAY_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })
const TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
/** `Fri, Oct 2 · 9:55 AM`, or `… · 9:55 – 10:20 AM` when the prints span time. */
function whenText(rows: readonly WhRow[]): string {
  let lo = Infinity
  let hi = -Infinity
  for (const r of rows) {
    lo = Math.min(lo, r.ts)
    hi = Math.max(hi, r.ts)
  }
  const a = TIME_FMT.format(lo)
  const b = TIME_FMT.format(hi)
  // `9:55 – 10:20 AM` within a half of the day, `11:50 AM – 12:10 PM` across noon
  const span = a === b ? a : `${a.slice(-2) === b.slice(-2) ? a.slice(0, -3) : a} – ${b}`
  return `${DAY_FMT.format(lo)} · ${span}`
}

const CARD_ROWS = 5

function bubbleOf(
  id: string,
  t: number,
  anchor: number,
  above: boolean,
  rows: WhRow[],
  amount: number,
  tone: Tone,
  head: string,
  s: WhS,
): WhaleBubble {
  const sorted = rows.slice().sort((a, z) => z.premium - a.premium)
  const sign = tone === 'up' ? '+' : tone === 'down' ? '−' : ''
  const n = rows.length
  return {
    id,
    t,
    anchor,
    above,
    r: bubbleRadius(amount, s.cap, s.size),
    tone,
    label: s.text ? short(amount) : '',
    card: {
      head,
      net: tone === 'mid' ? short(amount) : `${sign}${short(amount)} net`,
      when: `${whenText(rows)}${n > 1 ? ` · ${n} prints` : ''}`,
      rows: sorted.slice(0, CARD_ROWS).map((r) => {
        const b = biasOf(r)
        return { text: printLine(r), amount: short(r.premium), tone: b > 0 ? 'up' : b < 0 ? 'down' : 'mid' }
      }),
      more: Math.max(0, n - CARD_ROWS),
    },
  }
}

/** Per bar: one bubble for the prints with a known side (their net), one for the rest. */
function whaleBubbles(c: StudyCtx, s: WhS, rows: WhRow[] | null): WhaleBubble[] {
  const { bars, tfMs } = c
  if (!bars.length || !rows?.length) return []
  const byBar = new Map<number, { known: WhRow[]; net: number; unknown: WhRow[]; gross: number }>()
  for (const r of rows) {
    if (s.side !== 'all' && r.type !== s.side) continue
    const i = barAt(bars, r.ts, tfMs)
    if (i < 0) continue
    let g = byBar.get(i)
    if (!g) byBar.set(i, (g = { known: [], net: 0, unknown: [], gross: 0 }))
    const b = biasOf(r)
    if (b) {
      g.known.push(r)
      g.net += b * r.premium
    } else {
      g.unknown.push(r)
      g.gross += r.premium
    }
  }
  const out: WhaleBubble[] = []
  for (const [i, g] of byBar) {
    const bar = bars[i]!
    let knownAbove: boolean | null = null
    if (g.known.length) {
      const tone: Tone = g.net > 0 ? 'up' : g.net < 0 ? 'down' : 'mid'
      knownAbove = g.net < 0
      const head = g.net > 0 ? 'Bullish' : g.net < 0 ? 'Bearish' : 'Even'
      out.push(bubbleOf(`${i}k`, bar.time, knownAbove ? bar.high : bar.low, knownAbove, g.known, Math.abs(g.net), tone, head, s))
    }
    if (g.unknown.length) {
      const above = knownAbove === null ? false : !knownAbove
      out.push(bubbleOf(`${i}u`, bar.time, above ? bar.high : bar.low, above, g.unknown, g.gross, 'mid', 'Side unknown', s))
    }
  }
  // the biggest few hundred, when a long window holds more
  return out.sort((a, b) => b.r - a.r).slice(0, 400)
}

export const whalesImpl = studyImpl<WhS, WhRow[]>({
  settings: (i) => {
    const side = str(i.side, WH_SIDE[0])
    return {
      minPremium: WH_MIN_V[Math.max(0, (WH_MIN as readonly string[]).indexOf(str(i.min, WH_MIN[0])))] ?? 1e6,
      days: int(i.days, 5, 1, 30),
      side: side === WH_SIDE[1] ? 'C' : side === WH_SIDE[2] ? 'P' : 'all',
      cap: WH_CAP_V[Math.max(0, (WH_CAP as readonly string[]).indexOf(str(i.cap, WH_CAP[0])))] ?? 25e6,
      size: int(i.size, 100, 50, 200) / 100,
      text: bool(i.text, true),
    }
  },
  dataKey: (c, s) => `${flowTicker(c)}|${s.minPremium}|${s.days}`,
  load: async (c, s) => {
    const to = etDateKey(Date.now())
    const from = etDateKey(Date.now() - s.days * DAY_MS)
    const j = await getJson<{ rows?: Record<string, unknown>[] }>(
      `/api/lse/whales?from=${from}&to=${to}&ticker=${encodeURIComponent(flowTicker(c))}&min_premium=${s.minPremium}&sort=time&limit=500`,
    )
    return (j?.rows ?? [])
      .map((r): WhRow => ({
        ts: typeof r.ts === 'number' ? r.ts : Date.parse(String(r.ts ?? '')),
        type: r.type === 'C' || r.type === 'P' ? r.type : null,
        strike: Number.isFinite(Number(r.strike)) ? Number(r.strike) : null,
        expiry: typeof r.expiry === 'string' ? r.expiry : null,
        size: Number.isFinite(Number(r.size)) ? Number(r.size) : null,
        price: Number.isFinite(Number(r.price)) ? Number(r.price) : null,
        premium: Number(r.premium) || 0,
        action: r.action === 'BUY' || r.action === 'SELL' ? r.action : null,
        underlying: typeof r.underlying === 'string' ? r.underlying : null,
      }))
      .filter((r) => Number.isFinite(r.ts) && r.premium > 0)
  },
  refreshMs: 60_000,
  // the bubbles are the layer's (whaleLayer.ts) — nothing for the drawing primitives
  render: () => ({}),
  layer: (c, s, rows): WhalePayload | null => {
    const bubbles = whaleBubbles(c, s, rows)
    return bubbles.length ? { bubbles } : null
  },
})

provideLayer(WHALES_TYPE, () => new WhaleLayer())
