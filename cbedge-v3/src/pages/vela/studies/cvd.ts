// ─────────────────────────────────────────────────────────────────────────────
// CB EDGE STUDIES — Cumulative Volume Delta (2026-10-07, Brandon: "cumulative
// volume delta", TradingView's — tradingview.com/support/solutions/43000725058).
//
// Buying vs selling volume on the chart's own ticker, added up through an anchor
// period and drawn as candles in a pane under the chart:
//
//   · each chart bar is read from the INTRABARS inside it — the tape's 1m bars on
//     an intraday chart (the 5m bars for D / W / M, as TradingView), and each
//     intrabar's volume counts as buying or selling:
//       close > open        buying          close < open        selling
//       close = open        by its close against the intrabar before it
//       ... and the same    keeps the intrabar before's side
//   · the deltas add up from 0 at the start of each anchor period (Session by
//     default: 18:00 ET for ES / NQ, the ET day otherwise; or Week, or Month)
//   · each candle opens where the last one closed (0 at an anchor), closes at the
//     running total, and its high / low are the highest / lowest the running
//     total reached inside it.
//
// Where the 1m tape (~5 days) runs out, older bars are read from the 5m tape
// (~30 days), and past that each chart bar is classified whole. A 1m chart reads
// its own bars, live tick by tick. On a coarser chart the forming bar's minutes
// the tape has not delivered yet are counted as one more intrabar (the bar's
// volume so far less what the tape covers), so the last candle moves live too.
//
// An index (SPX, NDX…) has no volume: the study draws nothing there — use ES / NQ
// or SPY / QQQ.
// ─────────────────────────────────────────────────────────────────────────────

import type { CandleSeries, OHLCV, PriceLine, SeriesSpec } from '@luxalgo/vela'
import { stableSeriesId } from '@luxalgo/vela/plugin'
import { tokenHexAlpha } from '@/design/theme'
import { nativeTape } from '@/pages/vela/cbedgeProvider'
import { DAY_MS, MIN_MS, seriesOf, sessionKey, str, studyImpl, weekKey, type StudyCtx } from './common'
import { CVD_ANCHORS, CVD_STYLES, CVD_TYPE } from './index'

type Anchor = 'session' | 'week' | 'month'

interface CvdS {
  anchor: Anchor
  candles: boolean
}

/** The intrabar sources, finest first. Empty when the chart reads its own bars. */
interface Tape {
  m1: OHLCV[]
  m5: OHLCV[]
}

const TAPE_STALE_MS = 15_000

/** The anchor period a bar opening at `t` falls in. */
function anchorOf(t: number, fut: boolean, a: Anchor): string {
  const day = sessionKey(t, fut)
  return a === 'session' ? day : a === 'week' ? weekKey(day) : day.slice(0, 7)
}

/** Which tapes a chart of this bar size reads its intrabars from. */
function tapesFor(tfMs: number): { m1: boolean; m5: boolean } {
  if (tfMs >= DAY_MS) return { m1: false, m5: true }
  const min = tfMs / MIN_MS
  // a 1m chart is its own intrabars; a 2m / 3m chart has no 5m fallback (5 does not divide it)
  return { m1: min > 1, m5: min > 5 && min % 5 === 0 }
}

/**
 * The CVD candle for every chart bar (TradingView's rules, the header). Exported
 * for the test; `fut` sets the session anchor at 18:00 ET.
 */
export function cvdCandles(
  bars: readonly OHLCV[],
  tfMs: number,
  tape: Tape,
  o: { fut: boolean; anchor: Anchor; until: number },
): { candles: OHLCV[]; any: boolean } {
  const sources = [tape.m1, tape.m5].filter((s) => s.length)
  const idx = sources.map(() => 0)
  const out: OHLCV[] = []
  let any = false
  let side = 1
  let prevClose = NaN
  let cum = 0
  let period = ''

  const take = (x: OHLCV): number => {
    if (x.close > x.open) side = 1
    else if (x.close < x.open) side = -1
    else if (x.close > prevClose) side = 1
    else if (x.close < prevClose) side = -1
    // equal to the intrabar before: keep its side
    prevClose = x.close
    const v = x.volume ?? 0
    if (v > 0) any = true
    return side * v
  }

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!
    const end = bar.time + tfMs
    const p = anchorOf(bar.time, o.fut, o.anchor)
    if (p !== period) {
      period = p
      cum = 0
    }
    const open = cum
    let hi = cum
    let lo = cum
    const step = (d: number) => {
      cum += d
      if (cum > hi) hi = cum
      if (cum < lo) lo = cum
    }

    // the finest source that reaches back to this bar
    let inner: OHLCV[] | null = null
    for (let s = 0; s < sources.length; s++) {
      const src = sources[s]!
      let k = idx[s]!
      while (k < src.length && src[k]!.time < bar.time) k++
      idx[s] = k
      if (src[0]!.time > bar.time) continue
      const got: OHLCV[] = []
      while (k < src.length && src[k]!.time < end && src[k]!.time < o.until) got.push(src[k++]!)
      if (got.length) {
        inner = got
        break
      }
    }

    if (!inner) {
      step(take(bar))
    } else {
      let vol = 0
      for (const x of inner) {
        step(take(x))
        vol += x.volume ?? 0
      }
      // the forming bar: minutes the tape has not delivered yet, as one more intrabar
      const rest = (bar.volume ?? 0) - vol
      if (i === bars.length - 1 && rest > 0) {
        const last = inner[inner.length - 1]!
        step(take({ time: last.time + 1, open: last.close, high: bar.high, low: bar.low, close: bar.close, volume: rest }))
      }
    }
    out.push({ time: bar.time, open, high: hi, low: lo, close: cum })
  }
  return { candles: out, any }
}

export const cvdImpl = studyImpl<CvdS, Tape>({
  settings: (i) => {
    const a = str(i.anchor, CVD_ANCHORS[0])
    return {
      anchor: a === CVD_ANCHORS[1] ? 'week' : a === CVD_ANCHORS[2] ? 'month' : 'session',
      candles: str(i.style, CVD_STYLES[0]) === CVD_STYLES[0],
    }
  },
  dataKey: (c) => `${c.ticker}|${c.ctx.session ?? ''}|${c.tfMs}`,
  load: async (c: StudyCtx) => {
    const want = tapesFor(c.tfMs)
    const session = c.ctx.session
    const read = (n: 1 | 5, on: boolean) => (on ? nativeTape(c.ticker, n, session, TAPE_STALE_MS).catch(() => []) : Promise.resolve([]))
    const [m1, m5] = await Promise.all([read(1, want.m1), read(5, want.m5)])
    return { m1, m5 }
  },
  refreshMs: 15_000,
  // the last candle follows the forming bar
  everyTick: true,
  render: (c, s, tape) => {
    const { bars, tfMs } = c
    if (!bars.length) return {}
    const { candles, any } = cvdCandles(bars, tfMs, tape ?? { m1: [], m5: [] }, { fut: !!c.sym.fut, anchor: s.anchor, until: c.until })
    if (!any) return {}
    const up = tokenHexAlpha('--color-up', 1)
    const down = tokenHexAlpha('--color-down', 1)
    const T = CVD_TYPE
    let series: SeriesSpec[]
    if (s.candles) {
      const spec: CandleSeries = {
        id: stableSeriesId({ instanceId: T, kind: 'candle', title: 'cvd', ordinal: 0 }),
        title: 'CVD',
        paneId: '',
        kind: 'candle',
        bars: candles,
        style: { up, down, wickUp: up, wickDown: down },
      }
      series = [spec]
    } else {
      const closes = candles.map((k) => k.close)
      const colors = closes.map((v) => (v >= 0 ? up : down))
      series = [seriesOf(T, 'cvd', 0, 'CVD', bars, closes, up, { kind: 'line', width: 1.8, colors })]
    }
    const priceLines: PriceLine[] = [{ id: `${T}:zero`, paneId: '', price: 0, color: tokenHexAlpha('--color-muted', 0.35), width: 1, lineStyle: 'dashed' }]
    return { series, priceLines }
  },
})
