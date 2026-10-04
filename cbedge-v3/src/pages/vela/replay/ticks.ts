// ─────────────────────────────────────────────────────────────────────────────
// TICK-BY-TICK REPLAY: where a replayed candle gets the prices it forms from.
//
// Vela can play a revealed bar as a run of intrabar updates instead of placing
// it whole (`chart.replay.setTicks`). Each update moves the close and stretches
// the high and low like a live tick, and the last one settles the bar on the
// stored candle. Those updates come from the finer bars inside the candle:
//
//   chart bar       ticks from      e.g.
//   ≤ 1 minute      the bar itself  4 steps: open, one extreme, the other, close
//   2m – 30m        1-minute bars   5m → 5 ticks, 30m → 30 ticks
//                   (5-minute bars once 1m runs out, ~5 sessions back)
//   1h – 4h         5-minute bars   1h → 12 ticks
//   1 day           30-minute bars  13 ticks a session
//   1 week / month  daily bars
//
// A candle with fewer than two finer bars inside it (the tape does not reach
// that far, or a gap), or whose finer bars do not match it (sameTape), gets the
// four steps through its own OHLC. Which extreme comes first follows the
// candle's colour: a green candle dips first and finishes high, a red one the
// other way round. Every tick stays inside the candle's own high and low.
//
// Each finer timeframe is read ONCE per replay from the provider and cut
// locally, so a long replay does not re-request the tape for every candle.
// ─────────────────────────────────────────────────────────────────────────────

import { timeframeToMs, type OHLCV, type ReplayTick, type ReplayTickSource, type Vela } from '@luxalgo/vela'
import { CbEdgeProvider } from '@/pages/vela/cbedgeProvider'
import { setTickEnds } from './clock'

const provider = new CbEdgeProvider()
const MIN = 60_000
const DAY = 86_400_000

/** Finer timeframes to try for a chart bar of `tfMs`, best first. */
function finer(tfMs: number): string[] {
  if (tfMs <= MIN) return []
  if (tfMs <= 30 * MIN) return ['1', '5']
  if (tfMs <= 240 * MIN) return ['5']
  if (tfMs <= DAY) return ['30']
  return ['D']
}

/** Roughly how many updates a bar of `tfMs` plays as (sets the pace before the first bar's ticks land). */
export function nominalTicks(tfMs: number): number {
  if (tfMs <= MIN) return 4
  if (tfMs <= 30 * MIN) return Math.max(2, Math.round(tfMs / MIN))
  if (tfMs <= 240 * MIN) return Math.max(2, Math.round(tfMs / (5 * MIN)))
  if (tfMs <= DAY) return 13
  return tfMs <= 8 * DAY ? 5 : 21
}

const tape = new Map<string, { at: number; p: Promise<OHLCV[]> }>()
const TAPE_MS = 5 * MIN

function finerBars(ticker: string, tf: string, session: string | undefined): Promise<OHLCV[]> {
  const key = `${ticker}|${tf}|${session ?? ''}`
  const hit = tape.get(key)
  if (hit && Date.now() - hit.at < TAPE_MS) return hit.p
  const p = provider.getBars(ticker, tf, session ? { session } : {}).catch(() => [] as OHLCV[])
  tape.set(key, { at: Date.now(), p })
  return p
}

/** First index with time >= t (bars sorted by time). */
function lowerBound(bars: readonly OHLCV[], t: number): number {
  let lo = 0
  let hi = bars.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (bars[mid]!.time < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * The finer bars came off the same tape as the candle. Each timeframe has its own
 * route, so a futures roll or a gap in one of them could hand back prices from
 * somewhere else, and a candle built from those would jump around and then snap
 * back. The test: the finer bars' range sits within the candle's, give or take a
 * quarter of its range or a couple of ticks.
 */
function sameTape(bar: OHLCV, rows: readonly OHLCV[]): boolean {
  let hi = -Infinity
  let lo = Infinity
  for (const r of rows) {
    if (r.high > hi) hi = r.high
    if (r.low < lo) lo = r.low
  }
  const tol = Math.max((bar.high - bar.low) * 0.25, Math.abs(bar.close) * 0.0005)
  return hi <= bar.high + tol && lo >= bar.low - tol
}

function ownSteps(bar: OHLCV, end: number): ReplayTick[] {
  const up = bar.close >= bar.open
  const path = up ? [bar.open, bar.low, bar.high, bar.close] : [bar.open, bar.high, bar.low, bar.close]
  const span = Math.max(1, end - bar.time)
  setTickEnds(
    bar.time,
    path.map((_, i) => bar.time + (span * (i + 1)) / path.length),
  )
  return path.map((price, i) => (i === 0 ? { price, open: bar.open } : { price }))
}

/** The tick source for one chart. */
export function tickSourceFor(chart: Vela): ReplayTickSource {
  return async (bar, { end, signal }) => {
    const m = chart.market
    const tfMs = timeframeToMs(m.timeframe ?? '5') || 5 * MIN
    // a session's last bar: `end` is the next session's first bar, so cap it at one bar
    const stop = Math.min(end, bar.time + tfMs)
    const ticker = (m.symbol ?? '').replace(/^[^:]*:/, '').trim().toUpperCase()
    for (const tf of finer(tfMs)) {
      const subMs = timeframeToMs(tf)
      if (!subMs || subMs >= tfMs) continue
      const all = await finerBars(ticker, tf, m.session)
      if (signal.aborted) return []
      const rows = all.slice(lowerBound(all, bar.time), lowerBound(all, stop))
      if (rows.length < 2 || !sameTape(bar, rows)) continue
      setTickEnds(
        bar.time,
        rows.map((b) => Math.min(stop, b.time + subMs)),
      )
      // inside the stored candle's range: the forming bar never pokes past the
      // high or low it settles on
      const clamp = (v: number) => Math.max(bar.low, Math.min(bar.high, v))
      return rows.map((b, i) => {
        const t: ReplayTick = { price: clamp(b.close), high: clamp(b.high), low: clamp(b.low) }
        if (i === 0) t.open = bar.open
        if (b.volume != null) t.volume = b.volume
        return t
      })
    }
    return ownSteps(bar, stop)
  }
}

/** Forget the finer tapes (a replay ended: the next one reads them fresh). */
export function dropTape(): void {
  tape.clear()
}
