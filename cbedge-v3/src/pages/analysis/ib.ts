// ─────────────────────────────────────────────────────────────────────────────
// THE INITIAL BALANCE READ — the slice of v2's lib/failLevels.ts the Analysis
// page actually renders.
//
// v2 calls `computeAmt(candles, todayDate)`, which returns six things. The IB
// card reads THREE of them: `ib`, `dayTypeLabel` and `bias`. The other three —
// `dayTypeDetail`, `levelReads` and everything `computeRefLevels` exists for
// (PDH/PDL/PWH/PWL, overnight H/L, acceptance reads) — are never touched by this
// page.
//
// So this file ports the three, not the forty kilobytes. That is a deliberate
// narrowing and it is recorded here rather than in a commit message: if a later
// v3 page needs the level reads, port `computeRefLevels` properly into
// src/data/ — do NOT widen this file, which is scoped to one card and says so.
//
// The classification, the thresholds and the six bias sentences are transcribed
// verbatim. They are the card's entire output and re-deriving them from a
// description is exactly how a ported page ends up saying something subtly
// different about the same tape.
// ─────────────────────────────────────────────────────────────────────────────

import type { EsCandleRecord } from '@/data/esCandles'

export const IB_OPEN_MIN = 9 * 60 + 30 // 09:30 ET
export const IB_END_MIN = 10 * 60 + 30 // 10:30 ET

const RTH_OPEN = 9 * 60 + 30
const RTH_CLOSE = 16 * 60

export type DayType =
  | 'trend-up'
  | 'trend-down'
  | 'balance'
  | 'reversal-up'
  | 'reversal-down'
  | 'forming'

export interface InitialBalance {
  high: number
  low: number
  mid: number
  /** True once the last bar is at or past 10:30 ET. */
  locked: boolean
  brokeHigh: boolean
  brokeLow: boolean
}

export interface IbRead {
  ib: InitialBalance | null
  dayType: DayType
  dayTypeLabel: string
  bias: { lean: 'long' | 'short' | 'neutral'; text: string }
}

/**
 * ET wall-clock parts of a bar.
 *
 * The `Number(ts)` coercion is not defensive noise. Production historical bars
 * arrive with a STRING timestamp (pg BIGINT → JSON), and `new Date('178…')` is
 * an Invalid Date — which silently NaN'd every RTH check and dropped the whole
 * IB. v2 carries the same coercion and the same comment.
 */
function etParts(ts: number): { date: string; minutes: number } {
  const d = new Date(Number(ts))
  if (Number.isNaN(d.getTime())) return { date: '', minutes: NaN }
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const m: Record<string, string> = {}
  p.forEach((x) => {
    m[x.type] = x.value
  })
  const hh = m.hour === '24' ? '00' : m.hour
  return { date: `${m.year}-${m.month}-${m.day}`, minutes: Number(hh) * 60 + Number(m.minute) }
}

function etMinutes(ts: number): number {
  return etParts(ts).minutes
}

function isRthBar(ts: number): boolean {
  const m = etMinutes(ts)
  return m >= RTH_OPEN && m < RTH_CLOSE
}

function hiLo(bars: EsCandleRecord[]): { high: number; low: number } | null {
  if (!bars.length) return null
  let high = -Infinity
  let low = Infinity
  for (const b of bars) {
    if (b.high > high) high = b.high
    if (b.low < low) low = b.low
  }
  return Number.isFinite(high) && Number.isFinite(low) ? { high, low } : null
}

/**
 * Today's IB from the 09:30–10:30 ET bars.
 *
 * `brokeHigh` / `brokeLow` are judged ONLY on bars at or after 10:30 — a wick
 * inside the window that made the high is not a break of it, it IS the high.
 */
function computeIb(todayBars: EsCandleRecord[]): InitialBalance | null {
  const ibBars = todayBars.filter((b) => {
    const m = etMinutes(b.timestamp)
    return m >= IB_OPEN_MIN && m < IB_END_MIN
  })
  const hl = hiLo(ibBars)
  if (!hl) return null
  const last = todayBars[todayBars.length - 1]
  const lastMin = last ? etMinutes(last.timestamp) : IB_OPEN_MIN
  const post = todayBars.filter((b) => etMinutes(b.timestamp) >= IB_END_MIN)
  return {
    high: hl.high,
    low: hl.low,
    mid: (hl.high + hl.low) / 2,
    locked: lastMin >= IB_END_MIN,
    brokeHigh: post.some((b) => b.high > hl.high),
    brokeLow: post.some((b) => b.low < hl.low),
  }
}

/**
 * The IB, the day type and the directional read. `computeAmt`, narrowed.
 *
 * Classification order is significant — the reversal cases have to be tested
 * before the two-sided case or a day that took the highs and rolled all the way
 * under the IB would classify as plain "Balance".
 */
export function computeIbRead(candles: EsCandleRecord[], todayDate: string): IbRead {
  const todayBars = candles
    .filter((c) => c.date === todayDate)
    .sort((a, b) => a.timestamp - b.timestamp)

  const ib = computeIb(todayBars)

  const rthToday = todayBars.filter((b) => isRthBar(b.timestamp))
  const last = rthToday[rthToday.length - 1] ?? todayBars[todayBars.length - 1]
  const close = last?.close ?? null

  let dayType: DayType = 'forming'
  let dayTypeLabel = 'Forming'

  if (ib && close != null) {
    if (ib.brokeHigh && !ib.brokeLow && close > ib.high) {
      dayType = 'trend-up'
      dayTypeLabel = 'Trend ↑'
    } else if (ib.brokeLow && !ib.brokeHigh && close < ib.low) {
      dayType = 'trend-down'
      dayTypeLabel = 'Trend ↓'
    } else if (ib.brokeHigh && close < ib.low) {
      dayType = 'reversal-down'
      dayTypeLabel = 'Reversal ↓'
    } else if (ib.brokeLow && close > ib.high) {
      dayType = 'reversal-up'
      dayTypeLabel = 'Reversal ↑'
    } else if (ib.brokeHigh && ib.brokeLow) {
      dayType = 'balance'
      dayTypeLabel = 'Balance / Two-sided'
    } else if (ib.locked) {
      dayType = 'balance'
      dayTypeLabel = 'Balance'
    }
  }

  let lean: 'long' | 'short' | 'neutral' = 'neutral'
  let text = 'Two-sided auction — trade the reference levels, no strong directional lean.'
  if (dayType === 'trend-up') {
    lean = 'long'
    text = 'Trend up — favor break-&-retest longs above IB/PDH; stops below IB low.'
  } else if (dayType === 'trend-down') {
    lean = 'short'
    text = 'Trend down — favor break-&-retest shorts below IB/PDL; stops above IB high.'
  } else if (dayType === 'reversal-up') {
    lean = 'long'
    text = 'Reversal up — early low taken then reclaimed; long back above IB.'
  } else if (dayType === 'reversal-down') {
    lean = 'short'
    text = 'Reversal down — poor high then back below IB; short the rollover.'
  } else if (dayType === 'balance') {
    lean = 'neutral'
    text = 'Balance day — fade ONH/PDH and ONL/PDL back toward the IB mid; avoid the middle.'
  }

  return { ib, dayType, dayTypeLabel, bias: { lean, text } }
}
