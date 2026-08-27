// ─────────────────────────────────────────────────────────────────────────────
// Multi Greek — the ladder's arithmetic, kept out of the component.
//
// The page answers one question: at each strike, how much net gamma sits at
// each of the next few expiries, for four tickers side by side. Everything here
// serves that — the chain parse, the per-strike GEX, the column pick, the walls
// and the totals.
//
// Transcribed from v2's app/mult-greek/MultGreekClient.tsx. The formula in
// particular is copied exactly, constants and all: it is not the textbook
// dollar-gamma expression, it is the one the rest of the stack's numbers are
// denominated in, and a "cleaner" version would silently disagree with every
// other GEX readout in the product.
// ─────────────────────────────────────────────────────────────────────────────

export type Basis = 'oivol' | 'vol' | 'oi'

export const BASIS_LABEL: Record<Basis, string> = {
  oivol: 'OI+VOL',
  vol: 'VOL',
  oi: 'OI',
}

/** Most columns the board will ever draw, including the synthetic total. */
export const MAX_EXP_COLS = 4

// ── Chain parse ──────────────────────────────────────────────────────────────
// The chain route hyphenates its keys and hands back `strike-price` as a STRING
// (it is a Map key upstream). Everything else is a real number.

interface RawLeg {
  gamma?: unknown
  'open-interest'?: unknown
  volume?: unknown
}
interface RawStrike {
  'strike-price'?: unknown
  call?: RawLeg
  put?: RawLeg
}
interface RawItem {
  'expiration-date'?: unknown
  strikes?: unknown
}
export interface ChainResponse {
  data?: { items?: unknown; underlyingPrice?: unknown }
}

export interface Leg {
  gamma: number
  oi: number
  vol: number
}
export interface StrikeRow {
  strike: number
  call: Leg | null
  put: Leg | null
}
export interface ExpiryChain {
  expiration: string
  byStrike: Map<number, StrikeRow>
}
export interface ParsedChain {
  expiries: ExpiryChain[]
  underlying: number
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function leg(raw: RawLeg | undefined): Leg | null {
  if (!raw) return null
  return { gamma: num(raw.gamma), oi: num(raw['open-interest']), vol: num(raw.volume) }
}

export function parseChain(json: unknown): ParsedChain {
  const data = (json as ChainResponse)?.data
  const items = Array.isArray(data?.items) ? (data!.items as RawItem[]) : []
  const expiries: ExpiryChain[] = []
  for (const item of items) {
    const expiration = String(item?.['expiration-date'] ?? '')
    if (!expiration) continue
    const byStrike = new Map<number, StrikeRow>()
    const strikes = Array.isArray(item.strikes) ? (item.strikes as RawStrike[]) : []
    for (const s of strikes) {
      const strike = num(s?.['strike-price'])
      if (!strike) continue
      byStrike.set(strike, { strike, call: leg(s.call), put: leg(s.put) })
    }
    if (byStrike.size) expiries.push({ expiration, byStrike })
  }
  expiries.sort((a, b) => a.expiration.localeCompare(b.expiration))
  return { expiries, underlying: num(data?.underlyingPrice) }
}

// ── The number in a cell ─────────────────────────────────────────────────────

/**
 * Net GEX at one strike, for one expiry.
 *
 *   (|γcall|·contractsCall − |γput|·contractsPut) · spot² · 0.01 · 100
 *
 * `contracts` is open interest, today's volume, or both, per the basis switch.
 * The 0.01 · 100 pair is a 1%-move-times-multiplier convention and is exactly
 * what v2 uses; keep it, or this board stops agreeing with every other GEX
 * number in the product.
 *
 * Absolute gammas with an explicit sign on each side, rather than signed
 * gammas: the sign convention on a put's gamma differs between feeds, and
 * hard-coding "calls add, puts subtract" is the only version that survives one
 * of them changing its mind.
 */
export function strikeGex(row: StrikeRow | undefined, spot: number, basis: Basis): number {
  if (!row || !(spot > 0)) return 0
  const useOi = basis !== 'vol'
  const useVol = basis !== 'oi'
  const cc = (useOi ? (row.call?.oi ?? 0) : 0) + (useVol ? (row.call?.vol ?? 0) : 0)
  const pc = (useOi ? (row.put?.oi ?? 0) : 0) + (useVol ? (row.put?.vol ?? 0) : 0)
  const cg = Math.abs(row.call?.gamma ?? 0)
  const pg = Math.abs(row.put?.gamma ?? 0)
  return (cg * cc - pg * pc) * spot * spot * 0.01 * 100
}

// ── Columns ──────────────────────────────────────────────────────────────────

export const EX0_KEY = 'ALL_EX_0DTE'

export interface Column {
  key: string
  /** '' for the synthetic total. */
  expiration: string
  /** Days to expiry from today ET. -1 for the total. */
  daysTo: number
  label: string
  subLabel: string
}

const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function todayEt(): string {
  return ET_DATE.format(new Date())
}

/** Whole days between two YYYY-MM-DD dates. Both are ET calendar dates already. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`)
  const b = Date.parse(`${to}T12:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/**
 * Each ticker picks its OWN nearest expiries at or after the anchor — the
 * anchor being SPX's front date. Tickers do not share a calendar (SPX is
 * daily, most equities are weekly), so forcing one date list on all four
 * produces empty columns; anchoring instead keeps the columns comparable
 * without pretending the calendars match.
 */
export function pickColumns(expiries: string[], anchor: string, count: number): Column[] {
  const today = todayEt()
  const usable = expiries.filter((e) => e >= anchor).slice(0, MAX_EXP_COLS)
  return usable.slice(0, count).map((expiration) => {
    const daysTo = daysBetween(today, expiration)
    return {
      key: expiration,
      expiration,
      daysTo,
      label: `${Math.max(0, daysTo)}DTE`,
      subLabel: `GEX · ${expiration.slice(5)}`,
    }
  })
}

/**
 * At the full column count the LAST real expiry column is replaced by an
 * ex-0DTE total, not appended to. Four expiries plus a total would be five
 * columns in a space designed for four; the fourth expiry still feeds the sum,
 * it just stops having a column of its own.
 *
 * Below the full count there is no total at all — 3 means three expiries.
 */
export function withEx0Column(cols: Column[], count: number): { display: Column[]; ex0Source: Column[] } {
  if (count < MAX_EXP_COLS || cols.length < MAX_EXP_COLS) return { display: cols, ex0Source: [] }
  const ex0Source = cols.filter((c) => c.daysTo !== 0)
  const total: Column = { key: EX0_KEY, expiration: '', daysTo: -1, label: 'ALL', subLabel: 'EX-0DTE' }
  return { display: [...cols.slice(0, MAX_EXP_COLS - 1), total], ex0Source }
}

// ── Per-column statistics ────────────────────────────────────────────────────

export interface ColumnStats {
  maxAbs: number
  /** Strike of the biggest |GEX| — the Core Bullseye / magnet. */
  cb: number | null
  /** Biggest +GEX above spot, skipping the CB. */
  cw: number | null
  /** Most −GEX below spot, skipping the CB. */
  pw: number | null
  /** The three strongest strikes by |GEX|, in order. */
  top3: number[]
  netTotal: number
  posPct: number
}

export function columnStats(values: Map<number, number>, spot: number): ColumnStats {
  let maxAbs = 0
  let cb: number | null = null
  let pos = 0
  let neg = 0
  const entries = [...values.entries()]
  for (const [strike, v] of entries) {
    const a = Math.abs(v)
    if (a > maxAbs) {
      maxAbs = a
      cb = strike
    }
    if (v >= 0) pos += v
    else neg += -v
  }
  // CB is excluded before the walls are picked. The biggest node on the board
  // is frequently also the biggest node on one side of spot, so without this
  // the CB and the wall land on the same strike and a levels view draws one
  // line where there should be two — losing the level price actually has to
  // get through after the core.
  let cw: number | null = null
  let pw: number | null = null
  let cwVal = 0
  let pwVal = 0
  for (const [strike, v] of entries) {
    if (strike === cb) continue
    if (spot > 0 && strike > spot && v > cwVal) {
      cwVal = v
      cw = strike
    }
    if (spot > 0 && strike < spot && v < pwVal) {
      pwVal = v
      pw = strike
    }
  }
  const top3 = entries
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3)
    .map((e) => e[0])
  const denom = pos + neg
  return { maxAbs, cb, cw, pw, top3, netTotal: pos - neg, posPct: denom > 0 ? (pos / denom) * 100 : 0 }
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** `$1.23M`, sign carried separately so it can be coloured on its own. */
export function fmtGex(v: number | null | undefined): { sign: '+' | '−' | ''; text: string } {
  if (v == null || !Number.isFinite(v) || v === 0) return { sign: '', text: '--' }
  const abs = Math.abs(v)
  const sign = v > 0 ? '+' : '−'
  if (abs >= 1e9) return { sign, text: `$${(abs / 1e9).toFixed(2)}B` }
  if (abs >= 1e6) return { sign, text: `$${(abs / 1e6).toFixed(2)}M` }
  if (abs >= 1e3) return { sign, text: `$${(abs / 1e3).toFixed(0)}K` }
  return { sign, text: `$${abs.toFixed(0)}` }
}

/**
 * Cell wash alpha. Ranks 1-3 in a column take fixed steps so the top of the
 * ladder is legible at any intensity; everything else ramps off its share of
 * the column maximum.
 */
const RANK_ALPHA = [0.9, 0.45, 0.25]
const RAMP = { base: 0.04, span: 0.55, max: 0.62, ease: 1.6 }

export function cellAlpha(value: number, maxAbs: number, rank: number, intensity: number): number {
  if (!value) return 0
  const fixed = rank >= 0 ? RANK_ALPHA[rank] : undefined
  if (fixed !== undefined) return fixed
  if (maxAbs <= 0) return 0
  const ratio = Math.abs(value) / maxAbs
  return Math.min(RAMP.max, RAMP.base + Math.pow(ratio * Math.max(intensity, 1), RAMP.ease) * RAMP.span)
}
