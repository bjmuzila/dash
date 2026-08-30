// ─────────────────────────────────────────────────────────────────────────────
// OPTION-CHAIN MATH — transcribed 1:1 from v2.
//
// Sources, and why each one is here rather than re-derived:
//   lib/calculations/optionChain.ts   the five greek formulas and the per-side
//                                     book stats. These are the numbers the
//                                     whole grid is, and a formula rewritten
//                                     "the same way" is how the same strike ends
//                                     up reading two values on two pages.
//   lib/calculations/heatLevels.ts    CB / CW / PW, the rank floors they paint
//                                     at, and the slider-minimum test.
//   components/pages/OptionsChain.tsx the calls-above/puts-below side rule, the
//                                     sticky window centre, the key-expiry
//                                     picker and the small snapping helpers.
//
// Nothing in this file paints. Colour lives in heatSkins.ts, geometry in the
// components. Spec: docs/parity/options-chain.md.
// ─────────────────────────────────────────────────────────────────────────────

import { etDateKey, etToday, isTradingDay } from './marketSession'

// ── Wire + cell types ────────────────────────────────────────────────────────

const DATA_MODES = ['oi-vol', 'vol-only', 'flow'] as const
export type DataMode = (typeof DATA_MODES)[number]

/** Per-strike, per-expiration greek values. */
export interface GreekCell {
  gex: number
  dex: number
  chex: number
  vex: number
  /**
   * Net open interest = callOI − putOI. Signed on purpose: it is what the OI
   * tab's heat scale, per-column totals and ⅀ Total column read through
   * valueAt(), so a call-heavy strike colours positive and a put-heavy one
   * negative, exactly like the greeks. The two-line call/put breakdown the OI
   * cell displays comes from callOI/putOI below.
   */
  oi: number
  /** Pure volume-only GEX (volume-weighted gamma), independent of dataMode. */
  volGex: number
  /** Raw per-side book stats for the hover card. */
  callOI: number
  putOI: number
  callVol: number
  putVol: number
  /** Net premium traded per side = mark × volume × 100. */
  callPrem: number
  putPrem: number
}

/** One expiration's column: its date + a strike→greek map. */
export interface ExpColumn {
  expiration: string
  label: string
  cells: Map<number, GreekCell>
  underlying: number
}

export interface Expiration {
  value: string
  label: string
}

// ── parseExpiration ──────────────────────────────────────────────────────────

/**
 * Parse one expiration's chain payload into strike→greek cells.
 *
 * VERBATIM from v2. The contract-count basis, the S² scaling, the 0.01 and the
 * ×100 multiplier are all load-bearing:
 *
 *   contracts = OI + volume per side  (vol-only mode zeroes the OI term)
 *   GEX  = (γc·cc − γp·pc) · S² · 0.01 · 100
 *   DEX  = (|Δc|·cc − |Δp|·pc) · S · 100
 *   CHEX = (−θc·cc + θp·pc) · S · 100
 *   VEX  = (νc·cc − νp·pc) · S · 100
 *
 * `volGex` is computed from RAW call/put volume regardless of dataMode, so the
 * OI+Vol view can still flag the biggest pure-volume gamma peak. `oi` is always
 * the settled book — the Vol-only toggle changes the GEX basis, and must not
 * blank out the tab that is about positioning.
 */
export function parseExpiration(
  items: unknown[],
  expDate: string,
  spot: number,
  dataMode: DataMode = 'oi-vol',
  flowGexMap: Map<number, number> = new Map(),
): Map<number, GreekCell> {
  const cells = new Map<number, GreekCell>()
  const target = (items as Array<{ 'expiration-date'?: string; strikes?: unknown[] }>).filter(
    (i) => String(i['expiration-date'] ?? '').slice(0, 10) === expDate.slice(0, 10),
  )
  // No group matched the target date → use every group. v2 does this, and it is
  // what makes a payload that omits the echo of the requested date still parse.
  const groups = target.length ? target : (items as Array<{ strikes?: unknown[] }>)
  const S = spot > 0 ? spot : 0

  groups.forEach((group) => {
    ;(group.strikes || []).forEach((item: unknown) => {
      const it = item as Record<string, unknown>
      const strike = parseFloat(String(it['strike-price'] || 0))
      if (!strike) return

      const c = it.call as Record<string, unknown> | undefined
      const p = it.put as Record<string, unknown> | undefined
      const num = (o: Record<string, unknown> | undefined, k: string) =>
        o ? parseFloat(String(o[k])) || 0 : 0
      const cnt = (o: Record<string, unknown> | undefined) =>
        o
          ? (dataMode === 'vol-only'
              ? 0
              : parseInt(String(o['open-interest'] ?? o.openInterest ?? 0), 10) || 0) +
            (parseInt(String(o.volume ?? 0), 10) || 0)
          : 0

      const cc = cnt(c)
      const pc = cnt(p)
      const live = cc > 0 || pc > 0

      const cVol = c ? parseInt(String(c.volume ?? 0), 10) || 0 : 0
      const pVol = p ? parseInt(String(p.volume ?? 0), 10) || 0 : 0
      const volGexValue =
        cVol > 0 || pVol > 0
          ? (num(c, 'gamma') * cVol - num(p, 'gamma') * pVol) * S * S * 0.01 * 100
          : 0

      const cOI = c ? parseInt(String(c['open-interest'] ?? c.openInterest ?? 0), 10) || 0 : 0
      const pOI = p ? parseInt(String(p['open-interest'] ?? p.openInterest ?? 0), 10) || 0 : 0
      // Mark falls back through bid/ask mid → last → close. Same ladder as v2.
      const markOf = (o: Record<string, unknown> | undefined) => {
        if (!o) return 0
        const m = num(o, 'mark') || num(o, 'mark-price')
        if (m > 0) return m
        const b = num(o, 'bid') || num(o, 'bid-price')
        const a = num(o, 'ask') || num(o, 'ask-price')
        if (b > 0 || a > 0) return (b + a) / 2
        return (
          num(o, 'last') || num(o, 'last-price') || num(o, 'close') || num(o, 'price') || num(o, 'mid')
        )
      }
      const callPremValue = markOf(c) * cVol * 100
      const putPremValue = markOf(p) * pVol * 100

      let gexValue = 0
      if (dataMode === 'flow') {
        gexValue = flowGexMap.get(strike) ?? 0
      } else {
        gexValue = live ? (num(c, 'gamma') * cc - num(p, 'gamma') * pc) * S * S * 0.01 * 100 : 0
      }

      cells.set(strike, {
        gex: gexValue,
        dex: live ? (Math.abs(num(c, 'delta')) * cc - Math.abs(num(p, 'delta')) * pc) * S * 100 : 0,
        chex: live ? (-num(c, 'theta') * cc + num(p, 'theta') * pc) * S * 100 : 0,
        vex: live ? (num(c, 'vega') * cc - num(p, 'vega') * pc) * S * 100 : 0,
        oi: cOI - pOI,
        volGex: volGexValue,
        callOI: cOI,
        putOI: pOI,
        callVol: cVol,
        putVol: pVol,
        callPrem: callPremValue,
        putPrem: putPremValue,
      })
    })
  })

  return cells
}

// ── Levels: CB / CW / PW ─────────────────────────────────────────────────────

export type WallKind = 'cb' | 'cw' | 'pw'

/**
 * Which heat rank floor each level paints at in levels-only mode. CB is the
 * column's biggest |net| by definition, so it is rank 1 whatever the heat scale
 * would have said; CW and PW take 2 and 3 to keep the three tiers visibly
 * ordered.
 */
export const WALL_RANK: Record<WallKind, 1 | 2 | 3> = { cb: 1, cw: 2, pw: 3 }

export interface ColumnWalls {
  cb: number | null
  cw: number | null
  pw: number | null
}

/**
 * Slider minimums, one place. A surface tests its OWN slider's min — the chain's
 * range starts at 0.5.
 */
export const INTENSITY_MIN = {
  chain: 0.5,
  esCandles: 0.1,
} as const

/**
 * Is this slider sitting on its bottom stop? Compared with an epsilon rather
 * than `===` because the value round-trips through a range input's string value.
 */
export function atMinIntensity(value: number, min: number): boolean {
  return !Number.isFinite(value) || value <= min + 1e-6
}

/**
 * CB / CW / PW for one column of (strike, net) pairs.
 *
 *   CB — Core Bullseye : the largest |net| strike in the column (sign-blind)
 *   CW — Call Wall     : the largest +net strike that is not CB
 *   PW — Put Wall      : the most −net strike that is not CB
 *
 * `null` rather than a fallback when a side is empty or holds only CB: repeating
 * CB under a wall label reads as two levels agreeing when it is one level
 * counted twice.
 */
export function columnWalls(rows: Array<{ strike: number; net: number }>): ColumnWalls {
  let cb: number | null = null
  let cbAbs = 0
  for (const r of rows) {
    const a = Math.abs(r.net || 0)
    if (a > cbAbs) {
      cbAbs = a
      cb = r.strike
    }
  }
  const cw =
    rows
      .filter((r) => (r.net || 0) > 0)
      .sort((a, b) => b.net - a.net)
      .find((r) => r.strike !== cb)?.strike ?? null
  const pw =
    rows
      .filter((r) => (r.net || 0) < 0)
      .sort((a, b) => a.net - b.net)
      .find((r) => r.strike !== cb)?.strike ?? null
  return { cb, cw, pw }
}

/** Which level (if any) this strike is in that column. CB wins ties by order. */
export function wallAt(walls: ColumnWalls | null | undefined, strike: number): WallKind | null {
  if (!walls) return null
  if (walls.cb === strike) return 'cb'
  if (walls.cw === strike) return 'cw'
  if (walls.pw === strike) return 'pw'
  return null
}

// ── The calls-above / puts-below rule ────────────────────────────────────────

/**
 * Which side of the book the contract-count tabs (OI, VOL) show at a strike.
 * Shared deliberately: both tabs ladder identically, so switching between them
 * compares the same cells instead of re-reading the grid.
 *
 * Above the ATM strike only calls are OTM; below it only puts are. Showing both
 * everywhere meant half of every cell was the deep-ITM mirror of a strike on the
 * other side of the ladder — high OI, no information, and it doubled the row
 * height for nothing. The ATM row itself is the pivot and shows both.
 */
export function oiSides(strike: number, atm: number): { call: boolean; put: boolean } {
  if (strike > atm) return { call: true, put: false }
  if (strike < atm) return { call: false, put: true }
  return { call: true, put: true }
}

/**
 * The signed day-over-day OI CHANGE for heat/totals under that rule: call ΔOI
 * above ATM, put ΔOI below (negated, so it colours as a put), and the true net Δ
 * at the pivot. The OI tab prints the change and nothing else, so the heat, the
 * per-column totals and the ⅀ Total column all read this same number — the
 * colour a cell wears and the figure it shows can never disagree.
 */
export function oiSideChange(
  snap: { callChg: number; putChg: number },
  strike: number,
  atm: number,
): number {
  const { call, put } = oiSides(strike, atm)
  if (call && put) return snap.callChg - snap.putChg
  return call ? snap.callChg : -snap.putChg
}

/**
 * The signed traded VOLUME under the same rule. Volume itself is never negative
 * — the sign here is purely the SIDE, so the heat scale can say "calls" and
 * "puts" in the same language every other tab speaks. The CELL prints the
 * unsigned count; this is only what colours it and what the totals add up.
 */
export function volSideValue(
  cell: { callVol: number; putVol: number },
  strike: number,
  atm: number,
): number {
  const { call, put } = oiSides(strike, atm)
  if (call && put) return cell.callVol - cell.putVol
  return call ? cell.callVol : -cell.putVol
}

// ── Ranking + scales ─────────────────────────────────────────────────────────

/** A value's 1/2/3 standing in its column (0 = unranked). */
export function rankOf(value: number, topValues: number[]): number {
  const i = topValues.indexOf(Math.abs(value))
  return i >= 0 && i < 3 ? i + 1 : 0
}

export interface Scale {
  max: number
  top3: number[]
}

/** max + top-3 over a set of values, zeros excluded. `max` floors at 1. */
export function scaleOf(values: number[]): Scale {
  const abs = values.filter((v) => v !== 0 && Number.isFinite(v)).map((v) => Math.abs(v))
  const sorted = [...abs].sort((a, b) => b - a)
  return { max: sorted[0] ?? 1, top3: sorted.slice(0, 3) }
}

// ── The sticky window centre ─────────────────────────────────────────────────

/**
 * How far spot must drift — in STRIKE STEPS, not dollars — before the strike
 * window re-centres. Without this the window re-centres the instant spot crosses
 * a strike midpoint, so the whole ladder slides a row while you are reading it,
 * and on a chippy tape it can slide back and forth across one boundary
 * indefinitely.
 *
 * The ATM ROW itself is NOT anchored: `nearestStrike` stays the true nearest
 * strike, so the ATM highlight, the OI/VOL side split and the EM tags all keep
 * following real spot. Only where the window is CENTRED is sticky, so the ATM
 * row drifts up to N−1 rows off the middle between re-centres. The smallest
 * window is 11 rows (wing 5), so it can never drift out of view.
 */
export const RECENTER_EVERY_STRIKES = 5

/**
 * Where the strike window should be centred, given the current anchor.
 *
 * ONE function, called by both the render that draws the window and the effect
 * that persists the anchor — written as two copies of the same comparison, the
 * anchor only caught up on the render AFTER the one that crossed the threshold.
 *
 * `anchorKey` identifies the chain the anchor was taken on. Two chains can list
 * the same strike price (SPY 500, QQQ 500), so an anchor from another ticker or
 * another replay session is discarded rather than silently reused.
 */
export function pickCenterStrike(
  allStrikes: number[],
  nearestStrike: number,
  anchor: { key: string; strike: number },
  anchorKey: string,
): number {
  if (!allStrikes.length || !nearestStrike) return nearestStrike
  const anchorIdx = anchor.key === anchorKey ? allStrikes.indexOf(anchor.strike) : -1
  const trueIdx = allStrikes.indexOf(nearestStrike)
  if (anchorIdx < 0 || trueIdx < 0) return nearestStrike
  return Math.abs(trueIdx - anchorIdx) >= RECENTER_EVERY_STRIKES ? nearestStrike : anchor.strike
}

/**
 * The strike window shown, high → low, centred on the STICKY centre. An equal
 * count of strikes above and below (odd total, so a true middle row exists); if
 * the chain runs out on one side that side is padded with nulls so the centre
 * stays put whatever the window size.
 */
export function buildVisibleStrikes(
  allStrikes: number[],
  centerStrike: number,
  displayPercent: number,
): Array<number | null> {
  if (!allStrikes.length) return []
  if (displayPercent >= 100) return [...allStrikes].sort((a, b) => b - a)

  const ascending = [...allStrikes].sort((a, b) => a - b)
  const atmIndex = ascending.findIndex((s) => s === centerStrike)
  if (atmIndex < 0) return [...ascending].sort((a, b) => b - a)

  let targetCount = Math.max(11, Math.round(ascending.length * (displayPercent / 100)))
  if (targetCount % 2 === 0) targetCount += 1 // force odd → real centre row
  const wing = (targetCount - 1) / 2

  const out: Array<number | null> = []
  for (let k = wing; k >= 1; k--) {
    const idx = atmIndex + k
    out.push(idx < ascending.length ? (ascending[idx] as number) : null)
  }
  out.push(centerStrike)
  for (let k = 1; k <= wing; k++) {
    const idx = atmIndex - k
    out.push(idx >= 0 ? (ascending[idx] as number) : null)
  }
  return out
}

// ── Small helpers ────────────────────────────────────────────────────────────

/** Snap a target price to the nearest value present in `strikes`. */
export function nearestStrikeTo(target: number, strikes: number[]): number | null {
  if (!Number.isFinite(target) || !strikes.length) return null
  let best = strikes[0] as number
  let bestD = Math.abs((strikes[0] as number) - target)
  for (const s of strikes) {
    const dd = Math.abs(s - target)
    if (dd < bestD) {
      bestD = dd
      best = s
    }
  }
  return best
}

/**
 * "key" expiry mode: exactly 0DTE / 1DTE / closest weekly (nearest Friday
 * listing) / closest monthly (nearest 3rd-Friday standard listing). Each slot is
 * claimed independently so a Friday 0DTE does not also swallow the weekly
 * column.
 */
export function pickKeyExpirations(all: Expiration[]): Expiration[] {
  const todayKey = etDateKey(etToday())
  const future = [...all].filter((e) => e.value >= todayKey).sort((a, b) => a.value.localeCompare(b.value))
  if (!future.length) return []

  const claimed = new Set<string>()
  const out: Expiration[] = []

  const zeroDte = future[0] as Expiration
  claimed.add(zeroDte.value)
  out.push(zeroDte)

  const oneDte = future.find((e) => !claimed.has(e.value))
  if (oneDte) {
    claimed.add(oneDte.value)
    out.push(oneDte)
  }

  const isFriday = (iso: string) => new Date(`${iso}T12:00:00`).getDay() === 5
  const weekly =
    future.find((e) => !claimed.has(e.value) && isFriday(e.value)) ??
    future.find((e) => !claimed.has(e.value))
  if (weekly) {
    claimed.add(weekly.value)
    out.push(weekly)
  }

  const isThirdFriday = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`)
    if (d.getDay() !== 5) return false
    const day = d.getDate()
    return day >= 15 && day <= 21
  }
  const monthly =
    future.find((e) => !claimed.has(e.value) && isThirdFriday(e.value)) ??
    future.find((e) => !claimed.has(e.value) && isFriday(e.value)) ??
    future.find((e) => !claimed.has(e.value))
  if (monthly) {
    claimed.add(monthly.value)
    out.push(monthly)
  }

  return out
}

/**
 * True when `iso` falls in the CURRENT trading week (Mon–Fri, ET). The stored
 * weekly EM only applies to current-week expirations, so EM tags render only for
 * those.
 */
export function isCurrentWeekExp(iso: string): boolean {
  if (!iso) return false
  const now = etToday()
  const dow = now.getDay() // 0=Sun..6=Sat
  const monday = new Date(now)
  // Sun belongs to the week just ended → next Mon.
  const toMon = dow === 0 ? 1 : 1 - dow
  monday.setDate(now.getDate() + toMon)
  monday.setHours(0, 0, 0, 0)
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  friday.setHours(23, 59, 59, 999)
  const d = new Date(`${iso}T12:00:00`)
  return d >= monday && d <= friday
}

/**
 * The fallback calendar — next 14 trading days from today, used only until the
 * per-ticker /api/expirations fetch resolves. Never offer one of these as a real
 * listing: NVDA has no Monday weeklies, and picking one returns an empty chain.
 */
export function buildExpiries(): Expiration[] {
  const today = etToday()
  const list: Expiration[] = []
  let daysAdded = 0
  let offset = 0
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  while (daysAdded < 14 && offset < 40) {
    const date = new Date(today)
    date.setDate(today.getDate() + offset)
    if (isTradingDay(date)) {
      const value = etDateKey(date)
      const dayName = dayNames[date.getDay()]
      const mm = String(date.getMonth() + 1).padStart(2, '0')
      const dd = String(date.getDate()).padStart(2, '0')
      list.push({ value, label: `${dayName}, ${mm}-${dd}-${date.getFullYear()}` })
      daysAdded++
    }
    offset++
  }
  return list
}
