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
// ── NO DEPARTURE FROM v2 (2026-09-03) ────────────────────────────────────────
// This file used to swap v2's `NEUTRAL` #6B7280 onto `T.flat` #7a828d and call
// it "the one deliberate departure from v2". That departure is reversed: the
// scanner renders v2's palette, not v3's semantics, so `NEUTRAL` is `V2.neutral`
// — v2's own #6B7280 from `components/scanner/scannerStyles.ts` — and the same
// reversal puts the z-score ladder back on v2's own red and orange.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// `th`, `td` and `seg()` — the three CSSProperties objects. They are styling,
// and styling is step 3; they are also the source of five colour literals and
// a hardcoded 14px. The v3 equivalents are `Table` and `Controls` in
// src/design/primitives.
//
// Spec: docs/parity/scanner.md Part A, rows A30–A37.
// ─────────────────────────────────────────────────────────────────────────────

import { T, V2, alpha } from '@/design/theme'

/** "Neither up nor down." v2's NEUTRAL #6B7280, which six tabs import. */
export const NEUTRAL = V2.neutral

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
 *   |z| >= 3  → V2.red      ("extreme")
 *   |z| >= 2  → V2.orange   ("unusual")
 *   otherwise → T.text
 *
 * Both boundaries are `>=`, and both are on the ABSOLUTE value — a -3.1σ is
 * painted exactly like a +3.1σ. See rule 4 in the file header.
 *
 * 2026-09-03: the extreme band was collapsed onto MOVE_UP/MOVE_DOWN with every
 * other "negative/alarming" red on the page. That collapse is REVERSED — the
 * scanner runs on v2's palette and the semantics stay split — so the band is
 * back on v2's own `HOME_THEME.red` #EF4444 and the 2σ band on v2's
 * `HOME_THEME.orange` #FB8501 (v3's `T.orange` is a different #e0a44a).
 * The null branch stays `alpha(T.text, 0.4)`: `--color-fg` is #ffffff, which is
 * exactly v2's `HT.text`, and the alpha is v2's own.
 */
export function zColor(z: number | null | undefined): string {
  if (z == null) return alpha(T.text, 0.4)
  const a = Math.abs(z)
  if (a >= 3) return V2.red
  if (a >= 2) return V2.orange
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
