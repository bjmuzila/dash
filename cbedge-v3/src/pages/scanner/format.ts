// ─────────────────────────────────────────────────────────────────────────────
// THE SCANNER'S SHARED FORMATTERS AND COLOUR LADDERS.
//
// Transcribed 1:1 from v2's `components/scanner/scannerStyles.ts` against the
// checklist in docs/parity/scanner.md Part A, rows A30–A37. Six of the seven
// tabs import this, so every quirk below is load-bearing on six screens.
//
// Four of these are deliberately NOT what a general formatter would do:
//
//   1. `fmtB` ALWAYS carries a sign, so zero prints "+0". The columns it feeds
//      are signed gamma deltas, where a bare "0" reads as "no data" and "+0"
//      reads as "measured, and flat". Do not add a zero case.
//   2. `fmtB` buckets on the ABSOLUTE value, so -1.4e9 prints "-1.40B" — the
//      sign comes from the prefix, never from the number, which is why the
//      number is always formatted from `Math.abs`.
//   3. `fmtChg` uses `>= 0` for its plus sign, so it too prints "+0" for zero,
//      but it takes the minus from the number rather than a prefix. Two
//      functions, two ways to the same place; both are copied because six tabs'
//      columns already read one way or the other.
//   4. `zColor` compares the ABSOLUTE z-score, so -3.1σ is painted exactly like
//      +3.1σ. The colour says "unusual", not "up".
//
// ── PRECISION LOSS, DELIBERATELY PRESERVED ───────────────────────────────────
// None of these guard null or NaN. v2's `fmtB(null as any)` yields "+NaN" and
// that is what reaches the screen. Callers that can pass a null MUST check
// first and render their own em dash — that is what the tab files do, and it is
// why the guard is not added here: adding it would silently turn six tabs'
// "no data" states from an explicit "—" into a "+0", which is the one thing
// rule 1 above exists to prevent.
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// v2's `NEUTRAL` was the literal "#6B7280". It is `T.flat` here — v3's
// `--color-flat` #7a828d, the token that already means "neither up nor down".
// The two are within a hair of each other and having a seventh grey on the
// page to preserve the difference would be the wrong trade.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// `th`, `td` and `seg()` — the three CSSProperties objects. They are styling,
// and styling is step 3; they are also the source of five colour literals and
// a hardcoded 14px. The v3 equivalents are `Table` and `Controls` in
// src/design/primitives.
//
// Spec: docs/parity/scanner.md Part A, rows A30–A37.
// ─────────────────────────────────────────────────────────────────────────────

import { MOVE_DOWN, T, alpha } from '@/design/theme'

/** "Neither up nor down." v2's NEUTRAL #6B7280 → v3's --color-flat. */
export const NEUTRAL = T.flat

/**
 * Signed compact magnitude: "+1.40B", "-45.6M", "+789". ASCII hyphen, not
 * U+2212 — the tables it feeds are tabular-figure aligned and the minus glyph
 * is a different width in that font.
 *
 * The sign is unconditional: `fmtB(0)` is "+0". See rule 1 in the file header.
 */
export function fmtB(n: number): string {
  const a = Math.abs(n)
  const s = n < 0 ? '-' : '+'
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`
  return `${s}${a.toFixed(0)}`
}

/** Unsigned, locale-grouped whole number: "12,438". Contract counts, not money. */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString()
}

/**
 * Signed, locale-grouped whole number: "+1,204", "-330", "+0".
 *
 * Unlike `fmtB` the minus comes from the NUMBER (`toLocaleString` renders it),
 * not from a prefix — only the plus is added. Copied as written; two of the
 * tabs' columns already read this way.
 */
export function fmtChg(n: number): string {
  return `${n >= 0 ? '+' : ''}${Math.round(n).toLocaleString()}`
}

/** Percent from a 0–1 fraction, or an em dash. "12.4%" at one decimal. */
export function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v == null || Number.isNaN(v)) return EM_DASH
  return `${(v * 100).toFixed(decimals)}%`
}

/** Percent from a 0–100 number already in percent units, or an em dash. */
export function pctOrDash(n: number | null | undefined): string {
  return n == null ? EM_DASH : `${Math.round(n * 100)}%`
}

/** The page's one "no value" glyph. U+2014. */
export const EM_DASH = '—'

/**
 * The z-score colour ladder, evaluated in this order:
 *
 *   null      → 40% white   ("not measured")
 *   |z| >= 3  → MOVE_DOWN   ("extreme")
 *   |z| >= 2  → T.orange    ("unusual")
 *   otherwise → T.text
 *
 * Both boundaries are `>=`, and both are on the ABSOLUTE value — a -3.1σ is
 * painted exactly like a +3.1σ. See rule 4 in the file header.
 *
 * v2 painted the extreme band `HOME_THEME.red` #EF4444; that collapses onto
 * MOVE_DOWN with every other "negative/alarming" red on the page, per the
 * decision recorded in docs/parity/scanner.md.
 */
export function zColor(z: number | null | undefined): string {
  if (z == null) return alpha(T.text, 0.4)
  const a = Math.abs(z)
  if (a >= 3) return MOVE_DOWN
  if (a >= 2) return T.orange
  return T.text
}

/** The z-score legend wording, so no tab paraphrases it. */
export const Z_LEGEND = {
  unusual: 'z ≥ 2σ = unusual',
  extreme: 'z ≥ 3σ = extreme',
} as const

/** Signed z-score to one decimal with a sigma suffix: "+2.4σ", or an em dash. */
export function fmtZ(z: number | null | undefined): string {
  if (z == null) return EM_DASH
  return `${z >= 0 ? '+' : ''}${z.toFixed(1)}σ`
}
