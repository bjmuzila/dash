// ─────────────────────────────────────────────────────────────────────────────
// THE ES−SPX BASIS — what lets SPX gamma be drawn on ES candles.
//
// An ES chart plots FUTURES prices while its strikes are SPX CASH, and the two
// sit 40–60 points apart. So before a bubble or a rail row can be placed at a
// strike, that strike has to be pushed up by the basis, otherwise every level
// lands one basis below the price it belongs to — which is precisely the bug
// v2 spent a fortnight on in July 2026.
//
// ONE SOURCE, deliberately: /proxy/es-spx-basis (server-v2/es-spx-basis.js).
//
//   ES  ← our own es_candles 16:00 ET close — the very contract the chart
//         plots, so it is roll-correct by construction.
//   SPX ← Yahoo ^GSPC daily close — independent of the broker feed.
//
// NOT the socket's `spot.basis` / `aux.basis`. src/contract/frames.ts says why:
// the broker's "SPX" quote really tracks ES, so that value collapses toward
// zero and then freezes on the expired contract across a quarterly roll. v2
// built a four-tier fallback ladder (live pair → proxy → eod anchor → server)
// around that fact; this card keeps only the tier that was ever right. The
// basis decays about a point a day, so a daily anchor is not a compromise —
// a live one was the mistake.
//
//   { basis, esClose, spxClose, date, days: { 'YYYY-MM-DD': basis, … } }
//
// `basis` is the newest session's and is what the live rail uses; `days` is
// one value per ET session and is what each HISTORY column is shifted by, so a
// Friday bubble is converted with Friday's basis rather than today's.
// ─────────────────────────────────────────────────────────────────────────────

import type { GexColumn } from './gexHistory'
import { etDay } from './gexHistory'

export const BASIS_URL = '/proxy/es-spx-basis'

export interface BasisModel {
  /** Newest session's ES−SPX, or 0 when the route had nothing usable. */
  basis: number
  /** ET date → that session's basis. */
  days: Map<string, number>
}

export const NO_BASIS: BasisModel = { basis: 0, days: new Map() }

/**
 * ES carries a POSITIVE basis to SPX (rates − dividends). Anything else is a
 * data fault, and a wrong basis silently bends every level — so it is
 * rejected, never clamped. Same rule as the server's `isPlausible`.
 */
export function isPlausibleBasis(b: number): boolean {
  return Number.isFinite(b) && b > 0 && b < 250
}

export function parseBasis(json: unknown): BasisModel {
  if (!json || typeof json !== 'object') return NO_BASIS
  const j = json as { basis?: unknown; days?: unknown }
  const basis = Number(j.basis)
  const days = new Map<string, number>()
  if (j.days && typeof j.days === 'object') {
    for (const [d, v] of Object.entries(j.days as Record<string, unknown>)) {
      const n = Number(v)
      if (isPlausibleBasis(n)) days.set(d, n)
    }
  }
  return { basis: isPlausibleBasis(basis) ? basis : 0, days }
}

/** The basis to shift a column recorded at `slotTs` by. */
export function basisFor(model: BasisModel, slotTs: number): number {
  return model.days.get(etDay(slotTs)) ?? model.basis
}

/**
 * The same columns in ES price space. Strikes and spot move by the session's
 * basis; the GEX values are untouched — the gamma is the gamma, only where it
 * sits on the axis changes. Returns the input untouched with no usable basis,
 * so the caller's "no basis" state is an unshifted layer rather than a missing
 * one — and the status line says so.
 */
export function shiftColumns(columns: GexColumn[], model: BasisModel): GexColumn[] {
  if (!isPlausibleBasis(model.basis) && model.days.size === 0) return columns
  return columns.map((col) => {
    const b = basisFor(model, col.slotTs)
    if (!isPlausibleBasis(b)) return col
    return {
      slotTs: col.slotTs,
      spot: col.spot > 0 ? col.spot + b : col.spot,
      cells: col.cells.map((c) => ({ strike: c.strike + b, net: c.net, netVol: c.netVol })),
    }
  })
}
