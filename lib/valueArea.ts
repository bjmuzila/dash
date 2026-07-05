// ─── Value Area (Market Profile) ────────────────────────────────────────────
// Builds a POC/VAH/VAL volume profile from a set of 5m OHLCV bars (typically
// one prior RTH session). No tick data available, so each bar's volume is
// spread evenly across the price bins it spans (low→high) — the standard
// approximation for converting OHLC bars into a volume profile.
//
// Consumed by lib/balanceImbalance.ts as the Balance/Imbalance quadrant
// reference range (Dalton-style Auction Market Theory).

export interface Bar {
  high: number;
  low: number;
  volume: number;
  date?: string;
}

export interface ValueArea {
  date: string | null;
  poc: number;         // point of control (bin center of highest-volume price)
  vah: number;          // value area high
  val: number;          // value area low
  totalVolume: number;
  tick: number;         // bin size used for the profile
}

/**
 * @param bars    Bars to build the profile from (pass one RTH session's worth).
 * @param vaPct   Fraction of total volume the value area should capture (Dalton default 0.70).
 * @param bins    Number of price buckets across the session's range.
 */
export function computeValueArea(bars: Bar[], vaPct = 0.70, bins = 50): ValueArea | null {
  if (!bars.length) return null;

  let lo = Infinity, hi = -Infinity;
  for (const b of bars) {
    if (b.high == null || b.low == null) continue;
    lo = Math.min(lo, b.low);
    hi = Math.max(hi, b.high);
  }
  if (!(hi > lo)) return null;

  const tick = (hi - lo) / bins;
  const vol = new Array(bins + 1).fill(0);

  for (const b of bars) {
    if (!(b.volume > 0)) continue;
    const bLo = Math.max(0, Math.floor((b.low - lo) / tick));
    const bHi = Math.min(bins, Math.floor((b.high - lo) / tick));
    const span = Math.max(1, bHi - bLo + 1);
    const per = b.volume / span;
    for (let i = bLo; i <= bHi; i++) vol[i] += per;
  }

  const totalVolume = vol.reduce((a, c) => a + c, 0);
  if (!(totalVolume > 0)) return null;

  // POC = highest-volume bin.
  let pocIdx = 0;
  for (let i = 1; i < vol.length; i++) if (vol[i] > vol[pocIdx]) pocIdx = i;

  // Expand outward from POC, always adding whichever neighboring bin carries
  // more volume, until `vaPct` of total volume is captured.
  let loIdx = pocIdx, hiIdx = pocIdx;
  let captured = vol[pocIdx];
  const target = totalVolume * vaPct;
  while (captured < target && (loIdx > 0 || hiIdx < vol.length - 1)) {
    const nextLo = loIdx > 0 ? vol[loIdx - 1] : -1;
    const nextHi = hiIdx < vol.length - 1 ? vol[hiIdx + 1] : -1;
    if (nextHi >= nextLo) { hiIdx++; captured += vol[hiIdx]; }
    else { loIdx--; captured += vol[loIdx]; }
  }

  const priceOf = (i: number) => lo + i * tick;

  return {
    date: bars[0]?.date ?? null,
    poc: priceOf(pocIdx) + tick / 2,
    vah: priceOf(hiIdx) + tick,
    val: priceOf(loIdx),
    totalVolume,
    tick,
  };
}
