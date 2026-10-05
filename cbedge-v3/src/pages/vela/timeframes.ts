// The chart's timeframes, shortest first: Vela.tsx hands them to the workspace
// (its timeframe menu and sheet list exactly these), and the phone's bar scrubs
// through them (phoneChrome.ts). One list, so the two never disagree.

export const TIMEFRAMES: readonly string[] = ['1', '5', '15', '30', '60', '240', 'D', 'W', 'M']

/** `5` → 5m, `60` → 1h, `240` → 4h, `D` → 1D (Vela's own labels). */
export function tfLabel(tf: string): string {
  if (/^\d+$/.test(tf)) {
    const m = Number(tf)
    return m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m}m`
  }
  const k = /^(\d*)([DWM])$/i.exec(tf)
  return k ? `${k[1] || '1'}${k[2]!.toUpperCase()}` : tf
}

/** Where `tf` sits in TIMEFRAMES (`1D` and `D` are the same), or -1. */
export function tfIndex(tf: string): number {
  const label = tfLabel(tf)
  return TIMEFRAMES.findIndex((t) => tfLabel(t) === label)
}
