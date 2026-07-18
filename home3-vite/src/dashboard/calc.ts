// Ported verbatim (trimmed) from lib/calculations/calculations.ts so the Vite
// dashboard computes GEX / walls / flip exactly like the live app.

export interface ChainRow {
  strike: number
  spotPrice?: number
  spot?: number
  callOI?: number
  callVolume?: number
  putOI?: number
  putVolume?: number
  callGamma?: number
  putGamma?: number
  callDelta?: number
  putDelta?: number
  callGEX?: number
  putGEX?: number
  netGEX?: number
  netVolGEX?: number
  netDEX?: number
  volNetDEX?: number
  callIV?: number
  putIV?: number
  dte?: number
  type?: 'call' | 'put'
}

export type CalcMode = 'net' | 'vol'

function posOf(oi: number, vol: number, mode: CalcMode): number {
  return mode === 'vol' ? vol : oi + vol
}
export function callPosOf(row: ChainRow, mode: CalcMode = 'net'): number {
  return posOf(row.callOI ?? 0, row.callVolume ?? 0, mode)
}
export function putPosOf(row: ChainRow, mode: CalcMode = 'net'): number {
  return posOf(row.putOI ?? 0, row.putVolume ?? 0, mode)
}
function spotForRow(row: ChainRow, spot?: number): number {
  return spot && spot > 0 ? spot : Number(row.spotPrice ?? row.spot ?? 0)
}

export function callGEXOf(row: ChainRow, mode: CalcMode = 'net', spot?: number): number {
  const s = spotForRow(row, spot)
  return Math.abs(row.callGamma ?? 0) * callPosOf(row, mode) * s * s
}
export function putGEXOf(row: ChainRow, mode: CalcMode = 'net', spot?: number): number {
  const s = spotForRow(row, spot)
  return -(Math.abs(row.putGamma ?? 0) * putPosOf(row, mode) * s * s)
}
export function netGEXOf(row: ChainRow, mode: CalcMode = 'net', spot?: number): number {
  return callGEXOf(row, mode, spot) + putGEXOf(row, mode, spot)
}

export function findGEXFlip(chain: ChainRow[], spotPrice?: number): number | null {
  const oiVol = (r: ChainRow) => (r.netGEX ?? 0) + (r.netVolGEX ?? 0)
  const sorted = [...chain]
    .filter((r) => Number.isFinite(r.netGEX) || Number.isFinite(r.netVolGEX))
    .sort((a, b) => a.strike - b.strike)
  if (!sorted.length) return null
  const crossings: number[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = oiVol(sorted[i])
    const b = oiVol(sorted[i + 1])
    if (a === 0) { crossings.push(sorted[i].strike); continue }
    if (b === 0) { crossings.push(sorted[i + 1].strike); continue }
    if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
      const sA = sorted[i].strike, sB = sorted[i + 1].strike
      const zero = sA + (sB - sA) * (Math.abs(a) / (Math.abs(a) + Math.abs(b)))
      if (Number.isFinite(zero)) crossings.push(Math.round(zero * 10) / 10)
    }
  }
  if (!crossings.length) return null
  const best =
    spotPrice == null || !Number.isFinite(spotPrice)
      ? crossings[0]
      : crossings.reduce((b, c) => (Math.abs(c - spotPrice) < Math.abs(b - spotPrice) ? c : b))
  return Number.isFinite(best) && best > 0 ? best : null
}

export function formatGEX(value: number): string {
  const abs = Math.abs(value)
  const sign = value >= 0 ? '+' : '-'
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`
  return `${sign}$${(abs / 1e3).toFixed(2)}K`
}

export function fmtMoneyB(v: number): string {
  if (!isFinite(v)) return '--'
  const s = v >= 0 ? '+' : '-'
  const a = Math.abs(v)
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`
  return `${s}$${(a / 1e3).toFixed(0)}K`
}

export function formatStrikeValue(v: number): string {
  return Math.round(v).toLocaleString('en-US')
}

// Net GEX total across the chain under the active basis.
export function netGEXTotal(chain: ChainRow[], mode: CalcMode, spot: number): number {
  let t = 0
  for (const r of chain) t += netGEXOf(r, mode, spot)
  return t
}

// Call wall = strike above spot with the largest positive net GEX.
export function callWallOf(chain: ChainRow[], spot: number, mode: CalcMode): number | null {
  let best: number | null = null, bestV = 0
  for (const r of chain) {
    if (!(r.strike > spot)) continue
    const v = netGEXOf(r, mode, spot)
    if (v > 0 && v > bestV) { bestV = v; best = r.strike }
  }
  return best
}
// Put wall = strike below spot with the largest negative net GEX.
export function putWallOf(chain: ChainRow[], spot: number, mode: CalcMode): number | null {
  let best: number | null = null, bestV = 0
  for (const r of chain) {
    if (!(r.strike < spot)) continue
    const v = netGEXOf(r, mode, spot)
    if (v < 0 && -v > bestV) { bestV = -v; best = r.strike }
  }
  return best
}
