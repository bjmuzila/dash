// ─────────────────────────────────────────────────────────────────────────────
// GEX Candles — THE VOLTICK PATH BUBBLES (2026-10-07, Brandon: "i want the same
// bubbles and logic as the vela bubbles" → the Voltick Path).
//
// Not a copy of the Vela study: the SAME code, called from here.
//
//   data     vtPath/vtPathData.ts — the walls migration renamed (Volt = CORE,
//            Coil = a wall on the Volt's side of spot that is not the Volt,
//            Reversal = the wall across spot, Surge = the volume-only CORE),
//            forward-filled to one frame per candle, then Voltick's pathRows /
//            pathFill (one bead per level per candle, one level per strike).
//            ES / NQ ride SPX / NDX's walls through the session basis, and their
//            overnight candles read the next expiry's ladder, as on /vela.
//   pixels   vtPath/pathDraw.ts — the painter the Vela layer uses: one radius
//            from the bar pitch, growth inside it, the lit gold Volt, the Coil's
//            diamond, every-Nth-bar zoomed out.
//
// So a change to either file changes both charts, and they cannot drift.
//
// Settings, as the Vela study's inputs:
//   GEX          the card's GEX basis switch: Vol+OI → OI + Vol walls, Vol →
//                volume-only walls (Vela's default is Vol only)
//   Contracts    0DTE — the card is the nearest expiration
//   Node levels  15% (Voltick's default) · Calm chart off
//   Sessions     every session the card is showing: live, its Days setting plus
//                one (the session a futures tape's overnight carries); in a
//                replay, back to the session being replayed
//   Bubble size  the card's Bubble size slider
//
// THE PAINT FOLLOWS THE THEME (2026-10-07, Brandon: "it should be in cbedge
// style on the cbedge filter — main thing is the logic and the path/bubbles
// shaping and sizing"). Voltick theme: Voltick's colours, as /vela. CB Edge
// theme: the card's classic bubble look — the Volt is CORE, the one gold lit
// mark with a ring in its side's colour; the other levels are flat blue above
// spot and red below (pathDraw.ts paintCbEdge). Logic, shapes and sizes are the
// Path's either way.
//
// LOADED LAZILY (GexCandlesCard imports this with `import()`), and nothing it
// pulls in may import '@luxalgo/vela' at runtime — the home board must never
// load the 1.2MB Vela chunk. That is why the walls reader (pages/vela/
// wallsData.ts) and the painter (pathDraw.ts) live outside the Vela modules.
// ─────────────────────────────────────────────────────────────────────────────

import type { OHLCV } from '@luxalgo/vela'
import { buildPathRows, framesFromWalls, loadWallModels, type PathRow, type WallModels } from '@/pages/vela/vtPath/vtPathData'
import { PathDraw, type PathPayload } from '@/pages/vela/vtPath/pathDraw'
import type { Bar } from './candles'

export type { PathPayload, WallModels }

/** Voltick's Node levels default (the Vela study's `boldness` input, 15%). */
const NODE_LEVELS = 0.15
const DAY_MS = 86_400_000

const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })

/**
 * How many recorded sessions reach back to `fromDay` (YYYY-MM-DD, ET): the
 * weekdays from it through today. walls-range answers the newest N RECORDED
 * sessions, so a holiday in the span costs one extra, older session — never a
 * missing one.
 */
export function sessionsSince(fromDay: string, now = Date.now()): number {
  const today = ET_DAY.format(now)
  const start = Date.parse(`${fromDay}T12:00:00Z`)
  if (!Number.isFinite(start) || fromDay > today) return 1
  let n = 0
  for (let t = start; ; t += DAY_MS) {
    const d = new Date(t)
    const key = d.toISOString().slice(0, 10)
    if (key > today) break
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) n++
  }
  return Math.max(1, Math.min(60, n))
}

export interface PathRead {
  /** The chart's symbol as /vela names it: `ES` / `NQ` on a futures tape, else the ticker. */
  symbol: string
  basis: 'oivol' | 'vol'
  /** At least this many recorded sessions, newest first. */
  sessions: number
  /** …and back to this session (YYYY-MM-DD, ET) — a replay's day. null = no such floor. */
  fromDay: string | null
}

/** The walls behind the Path — vtPathData's read, shared with every /vela chart in the tab. */
export function loadPathModels(r: PathRead, fresh: boolean): Promise<WallModels> {
  const sessions = Math.max(1, Math.min(60, Math.max(r.sessions, r.fromDay ? sessionsSince(r.fromDay) : 1)))
  return loadWallModels(r.symbol, { scope: '0dte', basis: r.basis, sessions }, fresh)
}

/** The Path's rows for the card's candles — exactly what the Vela indicator pushes to its layer. */
export function pathRowsFor(bars: readonly Bar[], intervalMs: number, models: WallModels): PathRow[] | null {
  if (!bars.length) return null
  // framesFromWalls reads a bar's open time and close; the rest is carried for the type
  const ohlcv: OHLCV[] = bars.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }))
  const frames = framesFromWalls(ohlcv, intervalMs, models)
  return buildPathRows(
    frames,
    bars.map((b) => ({ time: Math.floor(b.t / 1000), close: b.c })),
  )
}

/** The payload the painter takes: Vela's Path defaults, the card's size, the theme's paint. */
export function pathPayloadOf(rows: PathRow[], size: number, skin: 'voltick' | 'cbedge', bars: readonly Bar[]): PathPayload {
  if (skin === 'voltick') return { rows, ci: NODE_LEVELS, quiet: false, size, skin }
  // which side of spot a bead is on: its candle's close (bead times are candle opens)
  const closeAt = new Map(bars.map((b) => [Math.floor(b.t / 1000), b.c]))
  return { rows, ci: NODE_LEVELS, quiet: false, size, skin, spotAt: (tSec) => closeAt.get(tSec) ?? null }
}

/** One painter per chart — it memoises each row's growth readings. */
export function createPathPainter(): PathDraw {
  return new PathDraw()
}
