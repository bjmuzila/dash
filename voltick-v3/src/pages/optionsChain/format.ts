// ─────────────────────────────────────────────────────────────────────────────
// THE CHAIN'S NUMBER FORMATTERS — transcribed 1:1 from v2.
//
// Every one of these is a decision somebody made about how a figure reads at
// 10px in a dense grid, and several of them are deliberately NOT what a general
// formatter would do:
//
//   • fmtMoney always carries a sign, so zero prints "+$0". That is not a bug —
//     the column is signed gamma and a bare "$0" reads as "no data".
//   • fmtCount carries no sign and no "$": open interest and volume are CONTRACT
//     COUNTS.
//   • fmtChg renders flat as "·" rather than "+0", because on any given morning
//     most strikes genuinely did not change and a wall of "+0" buries the ones
//     that did.
//   • fmtDeltaChip uses U+2212 MINUS, not a hyphen, and reports anything under
//     $1M as "<$1M" rather than rounding to a meaningless "$0M".
//
// The premarket page has its own `format.ts` and the two do NOT share: its
// fmtUsd prints millions at zero decimals and this one at two. Merging them
// would change one page's numbers to tidy up the other's.
//
// Spec: docs/parity/options-chain.md — "Shared formatters".
// ─────────────────────────────────────────────────────────────────────────────

/** Signed compact dollars: +$1.23M / -$45.6K / +$789. Zero prints "+$0". */
export function fmtMoney(value: number): string {
  const sign = value >= 0 ? '+' : '-'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

/**
 * Open interest and volume are CONTRACT COUNTS, not dollars — fmtMoney's "$"
 * and its always-on sign would both be wrong. Unsigned compact: 12.4K, 1.2M.
 */
export function fmtCount(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`
  return `${sign}${abs.toFixed(0)}`
}

/** Signed compact count for the ΔOI column: "+1.2K", "-430", "·" for flat. */
export function fmtChg(value: number): string {
  if (!value) return '·'
  return `${value > 0 ? '+' : '-'}${fmtCount(Math.abs(value))}`
}

/**
 * Δ chip text. `d` arrives in RAW DOLLARS — the same units as every other GEX
 * value on this chain — so it is scaled exactly as fmtMoney does. Always
 * millions, so the chip and the value beside it share one unit.
 */
export function fmtDeltaChip(d: number): string {
  if (!isFinite(d)) return '--'
  const sign = d < 0 ? '−' : '+'
  const m = Math.round(Math.abs(d) / 1e6)
  if (m === 0) return `${sign}<$1M`
  return `${sign}$${m.toLocaleString('en-US')}M`
}

/**
 * Compact column header for an expiration: "Mon 06-23".
 *
 * Parsed as UTC deliberately — "2026-07-01" read in a negative offset becomes
 * Jun 30 locally, and an expiry column headed with the wrong day is the single
 * most confusing thing this grid can print.
 */
export function fmtExpHeader(iso: string): string {
  const dt = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(dt.getTime())) return iso
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${days[dt.getUTCDay()]} ${mm}-${dd}`
}

/** A recorded frame's wall clock, to the second, in ET. */
export function fmtReplayClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return iso
  }
}

/** The ladder modal's clock — minutes only, matching v2's ChainReplay. */
export function fmtClockHm(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return iso
  }
}

/** "2026-07-31" → "Fri Jul 31". Parsed at noon UTC so no off-by-one day. */
export function fmtStampDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '')
  if (!m) return ymd || ''
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return ymd
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/** "2026-07-31" → "Jul 31" for the compact expiry chip. */
export function fmtExpiryShort(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '')
  if (!m) return ymd || ''
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return ymd
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
}

/** The ladder's bar value. Signed off the raw value, and carries no "$". */
export function fmtGex(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return v.toFixed(0)
}

/** Hover-card dollars. No "+" on positives — the caller adds one where it wants. */
export function fmtHoverUsd(n: number): string {
  const a = Math.abs(n)
  const s = n < 0 ? '-' : ''
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`
  return `${s}$${a.toFixed(0)}`
}

export function fmtHoverInt(n: number): string {
  return Math.round(n || 0).toLocaleString()
}

/** Hover card's signed form: "+$1.23M" / "-$45.6K". */
export function fmtHoverSigned(v: number): string {
  return (v >= 0 ? '+' : '') + fmtHoverUsd(v)
}

/** The figure, written the way the skin writes it — VIVID drops the "+". */
export function skinFig(text: string, plusSign: boolean): string {
  return plusSign ? text : text.replace(/^\+/, '')
}

/** A strike, as the rails print it: integers bare, fractions to 2dp. */
export function fmtStrike(strike: number): string {
  return Number.isInteger(strike) ? strike.toFixed(0) : strike.toFixed(2)
}
