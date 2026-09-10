// ─────────────────────────────────────────────────────────────────────────────
// GEX Chart — what the card remembers between sessions.
//
// Same shape and the same reasons as gexCandles/settings.ts: a plain blob in
// localStorage, keyed by CARD ID so two copies of the chart on one board keep
// their own basis and their own cards, coerced on read so a hand-edited or
// stale blob can never put an unknown value into the chart.
//
// The card used to have NO settings at all — it drew net GEX on the OI+VOL
// basis and that was the whole feature. Everything here is one of the four
// things v2's home page drove through props from its own toolbar (basis, the
// call/put split, the DEX line, the stat cards) and which v3 had not ported.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which CONTRACTS the bars are priced on.
 *
 *   oi-vol    open interest + today's volume. The default, and what every
 *             other v3 surface (Key Levels, the candles rail, Multi Greek)
 *             means by "GEX" unless it says otherwise.
 *   vol-only  today's volume alone — the day's positioning without the
 *             standing book behind it.
 *   flow      gamma against the DEALER'S OWN signed inventory, built from the
 *             classified tape. Socket symbol only; see `flowSupported`.
 */
export type GexBasis = 'oi-vol' | 'vol-only' | 'flow'

/** One net bar per strike, or the call leg up and the put leg down. */
export type GexSplit = 'net' | 'call-put'

/**
 * WHICH LADDER the bars are, on two axes at once — the exposure and the scope.
 *
 *   gamma-0dte    dealer GAMMA, the expiry the socket is streaming. The card's
 *                 original and only series, and still the default.
 *   gamma-ex0dte  dealer GAMMA summed across every listed expiration EXCEPT the
 *                 0DTE one — the standing book behind today's pin.
 *   delta-0dte    dealer DELTA, today's chain.
 *   delta-ex0dte  dealer DELTA, the standing book.
 *
 * The three added ones are the scanner's GEX Levels cards 8, 10 and 11, drawn
 * through this chart instead of their own small SVGs — same rows, same
 * accessors, one renderer.
 *
 * ── SPX ONLY, and not by omission ────────────────────────────────────────────
 * The ex-0DTE pair reads /proxy/gex-by-strike-multi, which sweeps the board for
 * ONE symbol server-side, and the delta pair needs the `netDEX` legs that only
 * the socket feed and that endpoint carry. On a board ticker all three would be
 * a control that quietly draws something else, so the card disables them and
 * says why — the same treatment FLOW already gets off the socket symbol.
 */
export type GexSeries = 'gamma-0dte' | 'gamma-ex0dte' | 'delta-0dte' | 'delta-ex0dte'

/** Which exposure a series values a strike on. */
export function metricOfSeries(s: GexSeries): 'gex' | 'dex' {
  return s === 'delta-0dte' || s === 'delta-ex0dte' ? 'dex' : 'gex'
}

/** Which expirations a series is summed over. */
export function scopeOfSeries(s: GexSeries): '0dte' | 'ex0dte' {
  return s === 'gamma-ex0dte' || s === 'delta-ex0dte' ? 'ex0dte' : '0dte'
}

/** True for everything but the card's original live-feed gamma ladder. */
export function isAddedSeries(s: GexSeries): boolean {
  return s !== 'gamma-0dte'
}

/**
 * The ten stat cards. Identity only — StatCards.tsx builds them in order and
 * draws all ten or none, so nothing needs the key LIST any more.
 */
export type StatKey =
  | 'netGex'
  | 'callWall'
  | 'putWall'
  | 'flip'
  | 'cb'
  | 'maxPain'
  | 'emUp'
  | 'emDown'
  | 'posGexPct'
  | 'bullBear'

export interface GexChartSettings {
  /** Which ladder the bars are. See GexSeries. */
  series: GexSeries
  basis: GexBasis
  split: GexSplit
  /** The net-DEX overlay line. Independent of the bars — see gexChartRender. */
  showDex: boolean
  /**
   * The stat card row: all ten, or none.
   *
   * There used to be a per-card `cards: Record<StatKey, boolean>` behind a cog
   * as well. Ten individual switches to hide tiles that already share the row
   * evenly is a setting nobody was reaching for, and a stored subset made the
   * row a different shape on every board. One chip in the toolbar now.
   */
  cardsOn: boolean
}

export const DEFAULT_SETTINGS: GexChartSettings = {
  series: 'gamma-0dte',
  basis: 'oi-vol',
  split: 'net',
  showDex: false,
  cardsOn: true,
}

const KEY_PREFIX = 'cb-v3-gexchart:'
/** Bump when a stored field changes MEANING. Adding a field does not need it. */
const SETTINGS_V = 1

const isBasis = (v: unknown): v is GexBasis => v === 'oi-vol' || v === 'vol-only' || v === 'flow'
const isSplit = (v: unknown): v is GexSplit => v === 'net' || v === 'call-put'
const isSeries = (v: unknown): v is GexSeries =>
  v === 'gamma-0dte' || v === 'gamma-ex0dte' || v === 'delta-0dte' || v === 'delta-ex0dte'

function coerce(raw: unknown): GexChartSettings {
  const p = (raw ?? {}) as Partial<GexChartSettings> & { v?: number }
  return {
    // A blob written before the series switch existed has no `series` and was
    // showing the live gamma ladder, which is what the default is.
    series: isSeries(p.series) ? p.series : DEFAULT_SETTINGS.series,
    basis: isBasis(p.basis) ? p.basis : DEFAULT_SETTINGS.basis,
    split: isSplit(p.split) ? p.split : DEFAULT_SETTINGS.split,
    showDex: p.showDex === true,
    // `!== false`, not `=== true`: a blob written before the row had a switch
    // at all should come back with the row ON, which is what it was showing.
    // A stale `cards` map alongside it is simply dropped — an unknown key in
    // the blob is ignored, and re-saving writes it out.
    cardsOn: p.cardsOn !== false,
  }
}

export function loadSettings(cardId: string): GexChartSettings {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + cardId)
    return coerce(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(cardId: string, s: GexChartSettings): void {
  try {
    // `v` rides along in the blob rather than in GexChartSettings: it is a
    // storage concern and nothing that reads settings should know about it.
    localStorage.setItem(KEY_PREFIX + cardId, JSON.stringify({ ...s, v: SETTINGS_V }))
  } catch {
    /* best-effort — the in-memory settings still drive this session */
  }
}
