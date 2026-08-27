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

export function gexHistoryUrl(gexSymbol: string, expiry: string, minutes: number, top: number): string {
  return (
    `/api/snapshots/option-strike-gex-history?mode=heatmap` +
    `&minutes=${minutes}` +
    `&expiry=${encodeURIComponent(expiry)}` +
    `&anyExpiry=1` +
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
