// ─────────────────────────────────────────────────────────────────────────────
// VWAP STARTS AT 6 PM EASTERN.
//
// 2026-10-07, Brandon (on NQ): "vwap. start time should be 6pm eastern". Vela's
// built-in VWAP (type `vwap`, @luxalgo/vela classics/overlays) resets its
// Session anchor at 00:00 UTC — 8 pm ET in summer, 7 pm in winter — so a
// futures chart's VWAP restarted two hours into the Globex session. The CME
// session (ES, NQ, …) opens at 18:00 ET; that is where the average must start.
//
// Vela gives no option for it, and it registers its classic indicators again
// every time a chart is built, so registering our own `vwap` would be undone by
// the next chart. Instead the built-in's compute is wrapped ONCE, on its spec
// object (the same object every registration hands out): the bars it is given
// carry a shifted clock — each bar's New York wall time plus six hours — so its
// UTC day / week / month boundaries fall exactly on 18:00 ET. Everything else
// (source, bands, colours, the 1D+ hide) is Vela's own; the values come back
// for the same bars in the same order.
//
//   Session   18:00 ET → 18:00 ET, DST-correct (a stock's 09:30–16:00 day is one
//             session, as before)
//   Week      from Sunday 18:00 ET (the Monday session)
//   Month …   by the session's date
//
// The spec is reached the way refreshChart.ts reaches healGap: through Vela's
// public registry (getNativeIndicator('vwap').create().spec), and only if it is
// there in the shape expected. A Vela upgrade that moves it leaves the built-in
// VWAP as it was, never an error. Applies to saved charts too: the type id does
// not change.
// ─────────────────────────────────────────────────────────────────────────────

import { getNativeIndicator } from '@luxalgo/vela'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
/** The session's start, hours after midnight ET. */
const SESSION_START_H = 18

/** New York's offset from UTC (hours, -4 or -5), cached by the hour. */
const offsetByDay = new Map<number, number>()
const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit' })
function nyOffsetH(t: number): number {
  // DST switches at 02:00 ET; reading the offset at the bar's own hour is exact
  // except inside that one hour, which no session boundary touches
  const key = Math.floor(t / HOUR_MS)
  let off = offsetByDay.get(key)
  if (off == null) {
    const nyHour = Number(NY.format(t)) % 24
    const utcHour = new Date(t).getUTCHours()
    off = ((nyHour - utcHour + 36) % 24) - 12
    offsetByDay.set(key, off)
    if (offsetByDay.size > 50_000) offsetByDay.clear()
  }
  return off
}

/** The clock Vela's VWAP is handed: NY wall time + (24 − 18) h, so 18:00 ET is a UTC midnight. */
const shifted = (t: number) => t + nyOffsetH(t) * HOUR_MS + (24 - SESSION_START_H) * HOUR_MS

type Bar = { time: number }
type Compute = (bars: readonly Bar[], inputs: unknown) => unknown
interface ClassicSpec {
  type?: string
  compute?: Compute
  inputs?: Array<{ key?: string; tooltip?: string; description?: string }>
  __cb18?: boolean
}

let done = false

/** Make the built-in VWAP's sessions start at 18:00 ET. Idempotent; call once a chart exists. */
export function patchVwapSession(): boolean {
  if (done) return true
  try {
    const desc = getNativeIndicator('vwap')
    const inst = desc?.create() as { spec?: ClassicSpec } | undefined
    const spec = inst?.spec
    if (!spec || spec.type !== 'vwap' || typeof spec.compute !== 'function') return false
    if (!spec.__cb18) {
      const orig = spec.compute
      spec.compute = (bars, inputs) => orig(bars.map((b) => ({ ...b, time: shifted(b.time) })), inputs)
      const anchor = spec.inputs?.find((i) => i.key === 'anchor')
      const note = 'Period anchoring the average. VWAP and its bands reset at the first bar of each session (6 pm ET, the futures open), week (from Sunday 6 pm ET), month, quarter or year.'
      if (anchor) {
        if ('tooltip' in anchor) anchor.tooltip = note
        else if ('description' in anchor) anchor.description = note
      }
      spec.__cb18 = true
    }
    done = true
    return true
  } catch {
    return false
  }
}

// a session key check for tests: 18:00 ET and later belongs to the next day's session
export const _sessionDayOf = (t: number) => Math.floor(shifted(t) / DAY_MS)
