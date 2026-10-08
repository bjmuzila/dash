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

/**
 * A daily-or-longer bar: `D` / `1D` / `2D`, `W`, `M`, or 1440+ minutes.
 * (2026-10-07, Brandon: "path, ribbons, or any of the gex shouldn't be seen at
 * 1d or above".) The GEX overlays draw NOTHING there — Voltick Path, Path
 * Ribbon, Voltick Walls and every GEX study (studies/common.ts
 * `intradayOnly`) — and read nothing either; back on an intraday bar they load
 * and draw again.
 */
export function isDailyOrAbove(tf: string): boolean {
  const t = String(tf ?? '').trim()
  if (/^\d*[DWM]$/i.test(t)) return true
  return /^\d+$/.test(t) && Number(t) >= 1440
}
