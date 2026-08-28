// ─────────────────────────────────────────────────────────────────────────────
// The bubble layer's data: per-minute GEX ladders over the session.
//
//   /api/snapshots/option-strike-gex-history?mode=heatmap&…
//     → { columns: [ { slotTs, cells: [{ strike, net, netVol }], spot, flip } ] }
//
// Note the field names: a heatmap CELL is `net` / `netVol`, NOT the `netGEX` /
// `netVolGEX` spelling that /api/gex and the WebSocket `gex` frame use. Same
// quantities, different route, different names — this is exactly the kind of
// thing src/contract holds the line on, so the rename is done once, here.
//
//   net    = net_gex + net_vol_gex   (OI + today's volume)
//   netVol = net_vol_gex             (volume only)
//
// `expiry` is required by the handler even when `anyExpiry=1` is set, which is
// why the card fetches the current expiry first and only then the history. That
// is the one place a waterfall is unavoidable: the parameter is not knowable
// without the first call. It is a small, cached, front-loaded call and both
// requests are fired from the card's own effect, not from a child.
//
// EVERY failure of this route is an HTTP 200 with `{ error, rows: [] }` and no
// `columns` key — so the parse below checks for the array, never res.ok.
// ─────────────────────────────────────────────────────────────────────────────

import type { GexMetric } from './settings'

export interface GexCell {
  strike: number
  /** OI + volume net GEX, raw dollar-gamma. */
  net: number
  /** Volume-only net GEX, raw dollar-gamma. */
  netVol: number
}

export interface GexColumn {
  /** Minute-floored epoch ms of the snapshot. */
  slotTs: number
  cells: GexCell[]
  /** Underlying spot at that snapshot. 0 on legacy rows. */
  spot: number
}

interface RawColumn {
  slotTs?: unknown
  cells?: unknown
  spot?: unknown
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * ONE EXPIRY, not the whole board.
 *
 * `anyExpiry=1` is gone. It merged every recorded expiry's ladder into one
 * column per minute, which is not what this card is about — the bubbles are the
 * gamma of the expiry being traded — and it made the server walk every expiry's
 * rows for the whole window on every poll. The expiry dropdown in the card's
 * toolbar now names the one to draw, which is the same change AGENTS.md's
 * "current / closest expiration" note was pointing at.
 */
export function gexHistoryUrl(gexSymbol: string, expiry: string, minutes: number, top: number): string {
  return (
    `/api/snapshots/option-strike-gex-history?mode=heatmap` +
    `&minutes=${minutes}` +
    `&expiry=${encodeURIComponent(expiry)}` +
    `&symbol=${encodeURIComponent(gexSymbol)}` +
    (top > 0 ? `&top=${top}` : '')
  )
}

export function parseGexHistory(json: unknown): GexColumn[] {
  const cols = (json as { columns?: unknown })?.columns
  if (!Array.isArray(cols)) return []
  const out: GexColumn[] = []
  for (const raw of cols as RawColumn[]) {
    const slotTs = num(raw?.slotTs)
    if (!slotTs) continue
    const cells: GexCell[] = []
    if (Array.isArray(raw.cells)) {
      for (const c of raw.cells as Array<Record<string, unknown>>) {
        const strike = num(c?.strike)
        if (!strike) continue
        cells.push({ strike, net: num(c?.net), netVol: num(c?.netVol) })
      }
    }
    if (!cells.length) continue
    out.push({ slotTs, cells, spot: num(raw.spot) })
  }
  out.sort((a, b) => a.slotTs - b.slotTs)
  return out
}

/** Which quantity a bubble is sized by, per the `GEX basis` control. */
export function valueOf(cell: GexCell, metric: GexMetric): number {
  return metric === 'vol' ? cell.netVol : cell.net
}

// ── Which SESSION DAY a column belongs to ────────────────────────────────────
// TESTING PHASE companion to GEX_HISTORY_MINUTES_PREV_DAY. With the 48h reach
// on, the history spans two sessions and the bubble layer draws both at once
// with nothing on screen saying so — a Thursday wall and a Friday wall look
// identical. These split the columns by ET calendar date so the card can NAME
// the days it is holding and draw one of them.
//
// ET CALENDAR DATE, not a session window: the recorder's overnight columns
// already carry the date of the session they lead into, so the calendar date IS
// the session day and there is no 18:00 roll to get wrong.
//
// Retire with the rest of the testing phase — one session means one day, the
// picker never renders, and this block has no callers left.

const ET_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const ET_WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' })

/** `YYYY-MM-DD` in New York for a column's timestamp. */
export function etDay(ts: number): string {
  return ET_DAY.format(new Date(ts))
}

/** `Fri` — the weekday a `YYYY-MM-DD` day key falls on. */
export function etDayShort(day: string): string {
  // Noon UTC, so neither the ET offset nor a DST edge can move the date.
  const t = Date.parse(`${day}T12:00:00Z`)
  return Number.isFinite(t) ? ET_WEEKDAY.format(new Date(t)) : day
}

/** `Fri 8/28` — what the picker's tooltip spells out. */
export function etDayLong(day: string): string {
  const [, m, d] = day.split('-')
  return m && d ? `${etDayShort(day)} ${Number(m)}/${Number(d)}` : day
}

/** Distinct ET days present in the history, OLDEST first. */
export function sessionDays(columns: GexColumn[]): string[] {
  const seen = new Set<string>()
  for (const c of columns) seen.add(etDay(c.slotTs))
  return [...seen].sort()
}

/**
 * Which day the bubbles draw.
 *
 * Semantic, never a stored date: 'latest' has to keep meaning the newest
 * session in the data after a rollover, and — the case this was built for — the
 * newest session is FRIDAY when the card is opened on a Saturday, so anything
 * anchored to the wall clock draws an empty layer all weekend.
 */
export type GexDay = 'latest' | 'prev' | 'both'

/**
 * The columns for `day`. A no-op unless the history actually spans two
 * sessions, so with the 48h reach off this returns its input untouched.
 */
export function filterByDay(columns: GexColumn[], day: GexDay, days: string[]): GexColumn[] {
  if (day === 'both' || days.length < 2) return columns
  const pick = day === 'latest' ? days[days.length - 1] : days[days.length - 2]
  if (!pick) return columns
  return columns.filter((c) => etDay(c.slotTs) === pick)
}
