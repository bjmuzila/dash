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

/**
 * WHICH contracts the volume histogram counts.
 *
 *   total     calls + puts at the strike, one column.
 *   call-put  the two legs side by side, call left and put right — where the
 *             day's contracts actually went, which "total" cannot show.
 */
export type VolumeSplit = 'total' | 'call-put'

export interface GexChartSettings {
  basis: GexBasis
  split: GexSplit
  /** The net-DEX overlay line. Independent of the bars — see gexChartRender. */
  showDex: boolean
  /**
   * TODAY'S TRADED CONTRACTS, as a histogram along the bottom of the plot.
   *
   * Not a basis and not an overlay on the gamma axis — a second, independent
   * series on its own scale, in contracts rather than dollars. The VOL basis
   * answers "how much GAMMA did today's volume build"; this answers "where did
   * the volume go", which is a different question and one the gamma bars
   * genuinely cannot show: a strike can trade heavily and carry almost no
   * gamma, and on the chart that strike is a gap.
   *
   * Off by default. It costs plot height, and the card's first job is the
   * gamma ladder.
   */
  showVolume: boolean
  volumeSplit: VolumeSplit
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
  basis: 'oi-vol',
  split: 'net',
  showDex: false,
  showVolume: false,
  volumeSplit: 'total',
  cardsOn: true,
}

const KEY_PREFIX = 'cb-v3-gexchart:'
/** Bump when a stored field changes MEANING. Adding a field does not need it. */
const SETTINGS_V = 1

const isBasis = (v: unknown): v is GexBasis => v === 'oi-vol' || v === 'vol-only' || v === 'flow'
const isSplit = (v: unknown): v is GexSplit => v === 'net' || v === 'call-put'
const isVolSplit = (v: unknown): v is VolumeSplit => v === 'total' || v === 'call-put'

function coerce(raw: unknown): GexChartSettings {
  const p = (raw ?? {}) as Partial<GexChartSettings> & { v?: number }
  return {
    basis: isBasis(p.basis) ? p.basis : DEFAULT_SETTINGS.basis,
    split: isSplit(p.split) ? p.split : DEFAULT_SETTINGS.split,
    showDex: p.showDex === true,
    // `=== true`, unlike cardsOn below: a blob written before the histogram
    // existed should come back with it OFF, which is what that browser was
    // showing. Defaulting a NEW series on would change a board nobody touched.
    showVolume: p.showVolume === true,
    volumeSplit: isVolSplit(p.volumeSplit) ? p.volumeSplit : DEFAULT_SETTINGS.volumeSplit,
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
