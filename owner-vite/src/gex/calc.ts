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
  flowGEX?: number
  bid?: number
  ask?: number
  callMark?: number
  putMark?: number
  callIV?: number
  putIV?: number
  dte?: number
  type?: 'call' | 'put'
}

export type CalcMode = 'net' | 'vol'

function posOf(oi: number, vol: number, mode: CalcMode): number {
  return mode === 'vol' ? vol : oi + vol
}

// ─── GEX Profile (spot-sweep BS model) — ported from lib/calculations ─────────
export interface GEXProfile { levels: number[]; values: number[]; flipPoint: number | null }

function rthFractionLeft(): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date())
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  const nowSec = g('hour') * 3600 + g('minute') * 60 + g('second')
  const open = 9.5 * 3600, close = 16 * 3600, len = close - open
  return Math.min(Math.max((close - nowSec) / len, 0), 1)
}

function bsGamma(S: number, K: number, vol: number, T: number): number {
  if (T <= 0 || vol <= 0 || S <= 0 || K <= 0) return 0
  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + 0.5 * vol * vol * T) / (vol * sqrtT)
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI)
  return pdf / (S * vol * sqrtT)
}

export function computeGEXProfile(chain: ChainRow[], spot: number, dataMode: 'oi-vol' | 'vol-only' = 'oi-vol'): GEXProfile | null {
  const cm: CalcMode = dataMode === 'vol-only' ? 'vol' : 'net'
  const callContracts = (r: ChainRow) => posOf(r.callOI ?? 0, r.callVolume ?? 0, cm)
  const putContracts = (r: ChainRow) => posOf(r.putOI ?? 0, r.putVolume ?? 0, cm)
  const rows = chain.filter((r) => (r.callIV ?? 0) > 0 && (r.putIV ?? 0) > 0 && callContracts(r) + putContracts(r) > 0 && (r.dte ?? 0) >= 0)
  if (rows.length < 5) return null
  const lo = spot * 0.8, hi = spot * 1.2, N = 60
  const levels: number[] = Array.from({ length: N }, (_, i) => lo + (hi - lo) * (i / (N - 1)))
  const values: number[] = []
  for (const S of levels) {
    let net = 0
    for (const r of rows) {
      const dte = r.dte ?? 0
      const T = dte <= 0 ? Math.max(rthFractionLeft(), 1 / 78) / 262 : dte / 262
      const callG = bsGamma(S, r.strike, r.callIV!, T)
      const putG = bsGamma(S, r.strike, r.putIV!, T)
      net += callContracts(r) * 100 * S * S * callG
      net -= putContracts(r) * 100 * S * S * putG
    }
    values.push(net / 1e9)
  }
  const crossings: number[] = []
  for (let i = 0; i < values.length - 1; i++) {
    const a = values[i], b = values[i + 1]
    if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) {
      const z = levels[i + 1] - ((levels[i + 1] - levels[i]) * b) / (b - a)
      if (Number.isFinite(z)) crossings.push(z)
    }
  }
  let flipPoint: number | null = crossings.length ? crossings.reduce((best, c) => (Math.abs(c - spot) < Math.abs(best - spot) ? c : best)) : null
  if (flipPoint !== null) flipPoint = Math.round(flipPoint * 10) / 10
  return { levels, values, flipPoint }
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
