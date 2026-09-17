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
// The card draws ONE session — the newest one the history came back holding —
// so all that is needed here is the day key a column belongs to.
//
// ET CALENDAR DATE, not a session window: the recorder's overnight columns
// already carry the date of the session they lead into, so the calendar date IS
// the session day and there is no 18:00 roll to get wrong.
//
// This block used to also carry `sessionDays`, `GexDay`, `filterByDay`,
// `etDayShort` and `etDayLong` — the naming and picking machinery behind the
// toolbar's Sun/Mon/Both day picker, which existed only so the 48h testing
// reach could show two sessions at once. The card follows the selected
// expiration now; the picker, the reach and those helpers are gone with it.

const ET_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** `YYYY-MM-DD` in New York for a column's timestamp. */
export function etDay(ts: number): string {
  return ET_DAY.format(new Date(ts))
}

/**
 * The columns belonging to the NEWEST ET session day in `columns`.
 *
 * The one rule the card needs, and it has to stay semantic rather than "today":
 * the newest session is FRIDAY when the card is opened on a Saturday, so
 * anything anchored to the wall clock draws an empty layer all weekend.
 *
 * It is also what keeps the weekend's republished book off a Monday chart. The
 * recorder re-publishes the last cash book once a minute all weekend, so a
 * request made on Monday morning still comes back holding Sunday rows — real
 * rows, and a picture of nothing happening, drawn wider than the session that
 * did happen.
 */
export function latestSession(columns: GexColumn[]): GexColumn[] {
  let newest = ''
  for (const c of columns) {
    const d = etDay(c.slotTs)
    if (d > newest) newest = d
  }
  if (!newest) return columns
  return columns.filter((c) => etDay(c.slotTs) === newest)
}
