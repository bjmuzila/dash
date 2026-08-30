// ─────────────────────────────────────────────────────────────────────────────
// THE PREMARKET PAGE'S NUMBER FORMATTERS — one copy, for all three surfaces.
//
// These lived three times over: `Premarket.tsx`, `premarket/PostMarketTab.tsx`
// and `premarket/HistoricalRecap.tsx` each declared their own `nf` / `fmtPx` /
// `fmtPts` / `fmtPct` / `fmtUsd`. The first two were byte-identical. The third
// had drifted, in four separate ways, all of them invisible until you put the
// two tabs side by side:
//
//   fmtUsd   Recap printed millions at ONE decimal ($1.4M) against the other
//            two at zero ($1M), and never showed a `+` on a positive — so the
//            same net-gamma figure changed both its precision and its sign
//            convention depending on which tab you were looking at.
//   fmtPts   Recap dropped the " pts" suffix, so a move read "+37" where the
//            live tab read "+37 pts".
//   fmtPx    Recap had no `v <= 0` guard, so a zero or negative settled level
//            printed as "0" where the live tab printed "—".
//   pillClass  Recap mapped the `vio` tone to a plain pill, silently losing the
//            violet the PINNED reaction is supposed to carry.
//
// None of that was a decision anyone made. It is what three copies of the same
// twenty lines turn into. The canonical set below is the one the live page and
// the Post-Market tab already agreed on; Historical Recap now reads it too.
//
// If a surface ever genuinely needs a different precision, it takes a parameter
// here — it does not get its own copy.
// ─────────────────────────────────────────────────────────────────────────────

/** Locale-grouped fixed-decimal number. No sign handling. */
export const nf = (v: number, dp = 0): string =>
  v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

/**
 * A PRICE. Guards `v <= 0` as well as null/NaN, because a zero price is not a
 * price — it is a missing one, and printing "0" for it claims a level nobody
 * can trade against.
 */
export const fmtPx = (v: number | null | undefined, dp = 0): string =>
  v == null || !Number.isFinite(v) || v <= 0 ? '—' : nf(v, dp)

/** A signed distance in index points. Always carries its unit. */
export const fmtPts = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${nf(Math.abs(v), 0)} pts`

/** A signed percentage. */
export const fmtPct = (v: number | null | undefined, dp = 2): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(dp)}%`

/**
 * A signed dollar magnitude: $1.92B / $840M / $12.4K / $840.
 *
 * `signed` controls only the PLUS. A negative always prints its minus — a
 * dollar figure that hides its sign is worse than no figure.
 */
export function fmtUsd(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const sign = v < 0 ? '−' : signed ? '+' : ''
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

/** Minute-of-day (ET) → "13:16". Bucket boundaries are minutes, not stamps. */
export const etMinOfDay = (mins: number): string =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.round(mins % 60)).padStart(2, '0')}`

/**
 * Reaction tone → pill class. `vio` is the PINNED reaction and it is violet,
 * the same hue the flip and the CORE marker use elsewhere on the page — it is
 * not "some other tone", it is the one that says the level held price against
 * it. `.pill.vio` is defined in the `.pmk` stylesheet alongside hot/cool/warn.
 */
export const pillClass = (tone: 'ok' | 'bad' | 'warn' | 'vio' | ''): string =>
  tone === 'ok'
    ? 'pill cool'
    : tone === 'bad'
      ? 'pill hot'
      : tone === 'warn'
        ? 'pill warn'
        : tone === 'vio'
          ? 'pill vio'
          : 'pill'
