// ─── Value Area (Market Profile) ────────────────────────────────────────────
// Fixed-bin-size volume profile + value-area (POC/VAH/VAL/LVN) builder.
//
// This mirrors the `buildVolumeProfile` already used by app/es-candles/page.tsx
// for its live session-profile overlay — same fixed-bin-size + POC-expansion
// algorithm — so the two pages agree numerically instead of drifting apart.
// es-candles profiles TODAY's forming session (for the heatmap); this module
// is used by lib/balanceImbalance.ts to profile the PRIOR completed RTH day
// as a fixed reference range, so the two call sites intentionally feed it
// different bars, not a shared cache — but the math itself is one source of
// truth. If you need to change the algorithm, change it here and consider
// pointing es-candles's local copy at this export too.
//
// No tick data available, so each bar's volume is spread evenly across the
// fixed-size price bins its [low, high] range touches (standard approximation
// for turning OHLC bars into a volume profile).

export interface Bar {
  high: number;
  low: number;
  volume: number;
  date?: string;
}

export interface ProfileBin { price: number; volume: number; }

export interface ValueArea {
  date: string | null;
  bins: ProfileBin[];
  poc: number;          // point of control (highest-volume bin price)
  vah: number;           // value area high
  val: number;           // value area low
  lvn: number | null;    // most significant low-volume node inside the range
  totalVolume: number;
  binSize: number;
}

/**
 * @param bars     Bars to profile (pass one RTH session's worth for a daily VA).
 * @param binSize  Fixed price-bin width — 1 (ES points) by default; pass a
 *                 wider bin for instruments with a bigger point range (e.g. 5 for NQ).
 * @param vaPct    Fraction of total volume the value area should capture (Dalton default 0.70).
 */
export function computeValueArea(bars: Bar[], binSize = 1, vaPct = 0.70): ValueArea | null {
  if (!bars.length || !(binSize > 0)) return null;

  let lo = Infinity, hi = -Infinity;
  for (const b of bars) {
    if (b.high == null || b.low == null) continue;
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
  }
  if (!(hi > lo)) return null;

  const floorBin = (p: number) => Math.floor(p / binSize) * binSize;
  const vol = new Map<number, number>();
  for (const b of bars) {
    if (!(b.volume > 0)) continue;
    const b0 = floorBin(b.low), b1 = floorBin(b.high);
    const n = Math.max(1, Math.round((b1 - b0) / binSize) + 1);
    const per = b.volume / n;
    for (let p = b0; p <= b1 + 1e-9; p += binSize) vol.set(p, (vol.get(p) ?? 0) + per);
  }

  const bins: ProfileBin[] = [...vol.entries()]
    .map(([price, volume]) => ({ price, volume }))
    .sort((a, b) => a.price - b.price);
  if (!bins.length) return null;

  let pocIdx = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i].volume > bins[pocIdx].volume) pocIdx = i;
  const totalVolume = bins.reduce((s, b) => s + b.volume, 0);
  if (!(totalVolume > 0)) return null;
  const target = totalVolume * vaPct;

  // Expand outward from POC, always adding whichever neighboring bin carries
  // more volume, until `vaPct` of total volume is captured.
  let loI = pocIdx, hiI = pocIdx, acc = bins[pocIdx].volume;
  while (acc < target && (loI > 0 || hiI < bins.length - 1)) {
    const below = loI > 0 ? bins[loI - 1].volume : -1;
    const above = hiI < bins.length - 1 ? bins[hiI + 1].volume : -1;
    if (above >= below) { hiI++; acc += Math.max(0, above); }
    else { loI--; acc += Math.max(0, below); }
  }

  // LVN: lowest-volume local-minimum bin inside the traded range (edges excluded).
  let lvnIdx = -1;
  for (let i = 1; i < bins.length - 1; i++) {
    if (bins[i].volume < bins[i - 1].volume && bins[i].volume < bins[i + 1].volume) {
      if (lvnIdx < 0 || bins[i].volume < bins[lvnIdx].volume) lvnIdx = i;
    }
  }

  return {
    date: bars[0]?.date ?? null,
    bins,
    poc: bins[pocIdx].price,
    vah: bins[hiI].price,
    val: bins[loI].price,
    lvn: lvnIdx >= 0 ? bins[lvnIdx].price : null,
    totalVolume,
    binSize,
  };
}
