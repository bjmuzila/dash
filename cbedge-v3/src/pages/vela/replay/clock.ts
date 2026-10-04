// ─────────────────────────────────────────────────────────────────────────────
// THE REPLAY CLOCK: how far a rewound chart has got. While a replay runs it is
// the moment the newest revealed bar or tick reaches, and Infinity otherwise
// (live, nothing hidden).
//
// The CB studies read it so they never draw what had not happened yet. A whale
// print at 13:51 stays hidden while the 13:50 candle is still building tick by
// tick, even though that candle is already on screen.
//
// No imports on purpose. The script engine and the studies sit beside the node
// bench, and this file has to stay something any of them can read.
// ─────────────────────────────────────────────────────────────────────────────

let active = false
let now = Infinity
/** Per bar (its open time): when each of its ticks ends, filled in by the tick source. */
const tickEnds = new Map<number, number[]>()

/** A replay is running on this page. */
export const replayActive = (): boolean => active

/** The moment the replay has reached (ms). Infinity while live. */
export const replayClock = (): number => (active ? now : Infinity)

export function setReplayClock(on: boolean, t: number): void {
  active = on
  now = on && Number.isFinite(t) ? t : Infinity
}

/** The tick source's record of where each tick of a bar ends. */
export function setTickEnds(barTime: number, ends: number[]): void {
  tickEnds.set(barTime, ends)
  // only the bars around the cursor matter, so keep a bounded few
  if (tickEnds.size > 64) {
    const oldest = tickEnds.keys().next().value
    if (oldest != null) tickEnds.delete(oldest)
  }
}

export function tickEnd(barTime: number, index: number): number | undefined {
  return tickEnds.get(barTime)?.[index]
}

export function clearTickEnds(): void {
  tickEnds.clear()
}
