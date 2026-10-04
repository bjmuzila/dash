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
//                  feed, kept forever) as markers on the bar they printed in:
//                  under the bar for a bullish print (call bought, put sold),
//                  over it for a bearish one, grey when the side is unknown.
//                  Hover for the contracts.
//
// ES charts read SPX's flow, NQ charts NDX's — the futures have no options here.
// ─────────────────────────────────────────────────────────────────────────────

import type { DrawingLabel, PriceLine, SeriesSpec } from '@luxalgo/vela'
import { tokenHexAlpha } from '@/design/theme'
import { DAY_MS, barAt, bool, studyImpl, etDateKey, getJson, int, labelAt, money, seriesOf, sessionsOf, str, type StudyCtx } from './common'
import { NETPREM_TYPE, NP_MIN as MIN_PREM, VF_SCOPES as SCOPES, VF_SESSIONS as SESS, VOLFLOW_TYPE, WHALES_TYPE, WH_MIN, WH_SIDE } from './index'

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
  text: boolean
}
const WH_MIN_V = [1e6, 2e6, 5e6, 10e6]

/** Bullish = call bought / put sold; bearish = put bought / call sold; null when the side is unknown. */
function biasOf(r: WhRow): 1 | -1 | 0 {
  if (!r.action || !r.type) return 0
  return (r.action === 'BUY') === (r.type === 'C') ? 1 : -1
}

export const whalesImpl = studyImpl<WhS, WhRow[]>({
  settings: (i) => {
    const side = str(i.side, WH_SIDE[0])
    return {
      minPremium: WH_MIN_V[Math.max(0, (WH_MIN as readonly string[]).indexOf(str(i.min, WH_MIN[0])))] ?? 1e6,
      days: int(i.days, 5, 1, 30),
      side: side === WH_SIDE[1] ? 'C' : side === WH_SIDE[2] ? 'P' : 'all',
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
  render: (c, s, rows) => {
    const { bars, tfMs } = c
    if (!bars.length || !rows?.length) return {}
    // one marker per bar per side: the prints that landed in it, summed
    const groups = new Map<string, { i: number; bias: 1 | -1 | 0; total: number; rows: WhRow[] }>()
    for (const r of rows) {
      if (s.side !== 'all' && r.type !== s.side) continue
      const i = barAt(bars, r.ts, tfMs)
      if (i < 0) continue
      const bias = biasOf(r)
      const key = `${i}|${bias}`
      const g = groups.get(key) ?? { i, bias, total: 0, rows: [] }
      g.total += r.premium
      g.rows.push(r)
      groups.set(key, g)
    }
    const T = WHALES_TYPE
    const up = tokenHexAlpha('--color-up', 0.95)
    const dn = tokenHexAlpha('--color-down', 0.95)
    const mid = tokenHexAlpha('--color-muted', 0.8)
    const ink = tokenHexAlpha('--color-bg', 1)
    const labels: DrawingLabel[] = []
    const clock = (t: number) => new Date(t).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' })
    for (const g of [...groups.values()].sort((a, b) => b.total - a.total).slice(0, 300)) {
      const b = bars[g.i]!
      const color = g.bias > 0 ? up : g.bias < 0 ? dn : mid
      const lines = g.rows
        .sort((a, z) => z.premium - a.premium)
        .slice(0, 6)
        .map((r) => `${clock(r.ts)} ${r.action ?? '—'} ${r.size ?? ''}× ${r.strike ?? ''}${r.type ?? ''} ${r.expiry ?? ''} @ ${r.price ?? ''} = ${money(r.premium)}`)
      if (g.rows.length > 6) lines.push(`… and ${g.rows.length - 6} more`)
      const text = s.text ? `${money(g.total)}${g.rows.length > 1 ? ` ×${g.rows.length}` : ''}` : ''
      labels.push(
        labelAt(T, `${g.i}-${g.bias}`, b.time, g.bias < 0 ? b.high : b.low, text, color, {
          style: g.bias < 0 ? 'label_down' : 'label_up',
          yloc: g.bias < 0 ? 'abovebar' : 'belowbar',
          textColor: ink,
          tooltip: lines.join('\n'),
          size: 'tiny',
        }),
      )
    }
    return { labels }
  },
})
