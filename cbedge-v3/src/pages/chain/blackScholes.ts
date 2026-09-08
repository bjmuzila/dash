// ─────────────────────────────────────────────────────────────────────────────
// BLACK-SCHOLES, for the chain's second greek source.
//
// The feed already sends delta/gamma/theta/vega per contract, and those are the
// default. This exists for the cases where the feed's numbers are not usable:
//
//   · a strike the market-data batch came back empty for, so every greek is 0
//     but the contract is real and quoted;
//   · after hours, where the greeks freeze at the close while the underlying
//     has moved — a model re-priced against the CURRENT spot is the more honest
//     number;
//   · anything where you want one consistent model across every strike rather
//     than a vendor's, which is the point of a "Black-Scholes" toggle at all.
//
// It is a CHOICE on the page, never a silent substitution: with the source set
// to Feed nothing here runs, and switching to Black-Scholes recomputes every
// greek on screen from one model so the column means one thing all the way
// down.
//
// ── The two assumptions ──────────────────────────────────────────────────────
// A model needs a discount rate and a carry, and neither is on the wire. They
// are named constants right here, and CHANGING THEM IS A ONE-LINE EDIT IN THIS
// FILE — deliberately not scattered through call sites, and deliberately not
// buried in a settings panel where a stale value would go unnoticed for months.
//
// European exercise, cash settlement, continuous dividend yield: SPX/NDX/RUT to
// the letter, and close enough on an American equity option that the greeks
// read correctly (early exercise moves deep-ITM puts, mostly).
// ─────────────────────────────────────────────────────────────────────────────

/** Risk-free rate, continuously compounded. Change it here. */
export const BS_RATE = 0.04
/** Continuous dividend yield. 1.2% is the S&P's; change it here. */
export const BS_DIV_YIELD = 0.012

export type BsSide = 'call' | 'put'

export interface BsGreeks {
  delta: number
  gamma: number
  /** Per DAY, matching the feed's convention. */
  theta: number
  /** Per 1 VOL POINT, matching the feed's convention. */
  vega: number
  /** The model's own price, for the IV solve and for a fair-value read. */
  price: number
}

const ZERO: BsGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0, price: 0 }
const SQRT_2PI = Math.sqrt(2 * Math.PI)

/** Abramowitz & Stegun 7.1.26 — max error 1.5e-7, which is four more digits
 *  than any of these columns prints. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a)
  return sign * y
}

/** Standard normal CDF. */
function N(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2))
}

/** Standard normal PDF. */
function phi(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI
}

/**
 * Greeks and price for one contract.
 *
 * @param side  call or put
 * @param S     underlying spot
 * @param K     strike
 * @param T     time to expiry IN YEARS
 * @param iv    implied volatility as a decimal (0.124 = 12.4%)
 */
export function bsGreeks(
  side: BsSide,
  S: number,
  K: number,
  T: number,
  iv: number,
  r: number = BS_RATE,
  q: number = BS_DIV_YIELD,
): BsGreeks {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(iv > 0)) return ZERO
  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r - q + (iv * iv) / 2) * T) / (iv * sqrtT)
  const d2 = d1 - iv * sqrtT
  const dfQ = Math.exp(-q * T)
  const dfR = Math.exp(-r * T)
  const pdf = phi(d1)

  const gamma = (dfQ * pdf) / (S * iv * sqrtT)
  // Per 1.0 of sigma, then scaled to ONE VOL POINT so the column sits beside the
  // feed's vega without a unit change.
  const vega = (S * dfQ * pdf * sqrtT) / 100
  // The decay term is shared; the carry and discount terms flip with the side.
  const decay = -(S * dfQ * pdf * iv) / (2 * sqrtT)

  if (side === 'call') {
    const thetaYr = decay - r * K * dfR * N(d2) + q * S * dfQ * N(d1)
    return {
      delta: dfQ * N(d1),
      gamma,
      theta: thetaYr / 365,
      vega,
      price: S * dfQ * N(d1) - K * dfR * N(d2),
    }
  }
  const thetaYr = decay + r * K * dfR * N(-d2) - q * S * dfQ * N(-d1)
  return {
    delta: -dfQ * N(-d1),
    gamma,
    theta: thetaYr / 365,
    vega,
    price: K * dfR * N(-d2) - S * dfQ * N(-d1),
  }
}

/**
 * Solve for the vol that reproduces `price`.
 *
 * BISECTION, not Newton. Newton is faster and diverges exactly where this is
 * needed most — a deep wing where vega is nearly zero, which is precisely the
 * strike whose feed IV came back empty. Bisection over [0.1%, 500%] cannot
 * diverge, and 60 halvings of that range land inside 1e-16, so the "slow"
 * method costs about sixty exp() calls on the handful of strikes that need it.
 *
 * Returns 0 when the price is outside what the model can produce at any vol —
 * an arbitrage-violating quote, or a stale mark — rather than a made-up number.
 */
export function impliedVol(
  side: BsSide,
  S: number,
  K: number,
  T: number,
  price: number,
  r: number = BS_RATE,
  q: number = BS_DIV_YIELD,
): number {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(price > 0)) return 0
  let lo = 0.001
  let hi = 5
  if (bsGreeks(side, S, K, T, hi, r, q).price < price) return 0
  if (bsGreeks(side, S, K, T, lo, r, q).price > price) return 0
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2
    if (bsGreeks(side, S, K, T, mid, r, q).price < price) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// ── Time to expiry ───────────────────────────────────────────────────────────

const YEAR_MS = 365 * 86_400_000
/** One minute, in years. A 0DTE contract at 15:59 still needs a positive T. */
const MIN_T = 1 / (365 * 24 * 60)

const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Eastern's UTC offset in minutes at a given instant (-240 EDT / -300 EST). */
function etOffsetMinutes(at: Date): number {
  const parts: Record<string, number> = {}
  for (const p of ET_PARTS.formatToParts(at)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  // Intl emits hour 24 for midnight under hour12:false in some engines.
  const hour = (parts['hour'] ?? 0) % 24
  const asUtc = Date.UTC(
    parts['year'] ?? 1970,
    (parts['month'] ?? 1) - 1,
    parts['day'] ?? 1,
    hour,
    parts['minute'] ?? 0,
    parts['second'] ?? 0,
  )
  return Math.round((asUtc - at.getTime()) / 60_000)
}

/**
 * Years from now to 16:00 ET on the expiry date.
 *
 * Resolved through Intl rather than by assuming an offset: "2026-09-11T20:00Z"
 * is 16:00 in September and 15:00 in December, and a T that is an hour wrong on
 * a 0DTE contract is a theta that is wrong by a fifth.
 */
export function yearsToExpiry(expiration: string, now: number = Date.now()): number {
  const iso = String(expiration || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 0
  // Seed the offset lookup at roughly the right instant, then apply it.
  const seed = Date.parse(`${iso}T20:00:00Z`)
  if (Number.isNaN(seed)) return 0
  const offset = etOffsetMinutes(new Date(seed))
  const closeMs = Date.parse(`${iso}T16:00:00Z`) - offset * 60_000
  return Math.max(MIN_T, (closeMs - now) / YEAR_MS)
}
