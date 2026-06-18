'use strict';
// server-v2/computation/utils.js
// Pure helpers: numeric coercion, ET date handling, symbol parsing,
// and Black-Scholes greeks. No I/O, no state — fully unit-testable.

// ---------------------------------------------------------------------------
// Numeric helpers (ported from existing server/computation/utils.js)
// ---------------------------------------------------------------------------

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const num = finiteNumber(value);
    if (num !== null) return num;
  }
  return 0;
}

function maxWholeNumber(...values) {
  const nums = values
    .map(finiteNumber)
    .filter((num) => num !== null && num >= 0 && Number.isInteger(num));
  return nums.length ? Math.max(...nums) : 0;
}

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

function roundTo(x, inc) {
  return Math.round(x / inc) * inc;
}

// ---------------------------------------------------------------------------
// ET date helpers (ported)
// ---------------------------------------------------------------------------

function todayYmd() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  );
  const yy = map.year.slice(2);
  const mm = map.month;
  const dd = map.day;
  return { yy, mm, dd, ymd: `${map.year}-${mm}-${dd}`, compact: `${yy}${mm}${dd}` };
}

/** Calendar days from now until an ISO yyyy-mm-dd expiry (>= 0). */
function dteFromIso(expirationIso, now = Date.now()) {
  const exp = new Date(`${expirationIso}T20:00:00Z`).getTime();
  return Math.max(0, Math.round((exp - now) / 86400000));
}

/**
 * Year fraction to expiry, with an intraday floor so 0DTE never divides by zero.
 * Options expire ~16:00 ET; we approximate the expiry instant at 20:00 UTC.
 */
function yearsToExpiry(expirationIso, now = Date.now()) {
  const exp = new Date(`${expirationIso}T20:00:00Z`).getTime();
  const ms = Math.max(exp - now, 60 * 60 * 1000); // floor 1h
  return ms / (365 * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Symbol parsing (ported + extended)
// ---------------------------------------------------------------------------

function optionExpirationCompact(symbol) {
  const match = String(symbol || '').match(/(\d{6})[CP]/);
  return match ? match[1] : '';
}

function isSpxwSymbol(symbol) {
  return /^\.?SPXW\d{6}[CP]/.test(String(symbol || ''));
}

/**
 * Parse a dxFeed option streamer symbol into parts.
 *   .SPXW250620C5000  →  { root:'SPXW', expiration:'2025-06-20', type:'C', strike:5000 }
 * @returns {null|{root,expiration,type,strike}}
 */
function parseOptionSymbol(sym) {
  if (typeof sym !== 'string') return null;
  const m = sym.match(/^\.?([A-Z]+?)(\d{6})([CP])(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const [, root, yymmdd, cp, strikeRaw] = m;
  const expiration = `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
  return { root, expiration, type: cp === 'C' ? 'C' : 'P', strike: parseFloat(strikeRaw) };
}

// ---------------------------------------------------------------------------
// Black-Scholes greeks + IV (no dividend, continuous rate r)
// ---------------------------------------------------------------------------

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function normPdf(x) {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

function normCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Black-Scholes greeks.
 * @param {{S:number,K:number,T:number,sigma:number,r?:number,type:'C'|'P'}} p
 * @returns {{delta,gamma,vega,theta,vanna,charm}}
 */
function bsGreeks({ S, K, T, sigma, r = 0.045, type }) {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(sigma > 0)) {
    return { delta: 0, gamma: 0, vega: 0, theta: 0, vanna: 0, charm: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdf = normPdf(d1);
  const isCall = type === 'C';

  const delta = isCall ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (S * sigma * sqrtT);
  const vega = S * pdf * sqrtT; // per 1.00 (100%) vol
  const term1 = -(S * pdf * sigma) / (2 * sqrtT);
  const term2 = r * K * Math.exp(-r * T) * (isCall ? normCdf(d2) : normCdf(-d2));
  const theta = isCall ? term1 - term2 : term1 + term2; // per year
  const vanna = -pdf * (d2 / sigma); // d(delta)/d(sigma)
  const charm = -pdf * ((2 * r * T - d2 * sigma * sqrtT) / (2 * T * sigma * sqrtT)); // d(delta)/d(t), per year

  return { delta, gamma, vega, theta, vanna, charm };
}

function bsPrice({ S, K, T, sigma, r = 0.045, type }) {
  if (!(T > 0) || !(sigma > 0)) {
    return type === 'C' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return type === 'C'
    ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2)
    : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

/**
 * Implied vol from option mid price (Newton-Raphson + bisection fallback).
 * @returns {number} sigma, or NaN if not solvable.
 */
function impliedVol({ price, S, K, T, r = 0.045, type }) {
  if (!(price > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return NaN;
  const intrinsic = type === 'C' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  if (price < intrinsic) return NaN;

  let sigma = 0.2;
  for (let i = 0; i < 50; i++) {
    const px = bsPrice({ S, K, T, sigma, r, type });
    const { vega } = bsGreeks({ S, K, T, sigma, r, type });
    const diff = px - price;
    if (Math.abs(diff) < 1e-4) return sigma;
    if (!(vega > 1e-8)) break;
    sigma -= diff / vega;
    if (!(sigma > 0) || sigma > 5) break;
  }
  let lo = 1e-3;
  let hi = 5;
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    const px = bsPrice({ S, K, T, sigma: mid, r, type });
    if (Math.abs(px - price) < 1e-4) return mid;
    if (px > price) hi = mid;
    else lo = mid;
  }
  return NaN;
}

module.exports = {
  // numeric
  finiteNumber,
  firstFiniteNumber,
  maxWholeNumber,
  clamp,
  roundTo,
  // dates
  todayYmd,
  dteFromIso,
  yearsToExpiry,
  // symbols
  optionExpirationCompact,
  isSpxwSymbol,
  parseOptionSymbol,
  // math
  normPdf,
  normCdf,
  erf,
  bsGreeks,
  bsPrice,
  impliedVol,
};
