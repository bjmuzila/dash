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

/** The ten stat cards, in the order v2's home toolbar shows them. */
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

export const STAT_KEYS: StatKey[] = [
  'netGex',
  'callWall',
  'putWall',
  'flip',
  'cb',
  'maxPain',
  'emUp',
  'emDown',
  'posGexPct',
  'bullBear',
]

export interface GexChartSettings {
  basis: GexBasis
  split: GexSplit
  /** The net-DEX overlay line. Independent of the bars — see gexChartRender. */
  showDex: boolean
  /** Master switch for the stat card row. */
  cardsOn: boolean
  /** Per-card visibility. A key missing from a stored blob defaults to ON. */
  cards: Record<StatKey, boolean>
}

const allCards = (on: boolean): Record<StatKey, boolean> =>
  STAT_KEYS.reduce((acc, k) => ((acc[k] = on), acc), {} as Record<StatKey, boolean>)

export const DEFAULT_SETTINGS: GexChartSettings = {
  basis: 'oi-vol',
  split: 'net',
  showDex: false,
  cardsOn: true,
  cards: allCards(true),
}

const KEY_PREFIX = 'cb-v3-gexchart:'
/** Bump when a stored field changes MEANING. Adding a field does not need it. */
const SETTINGS_V = 1

const isBasis = (v: unknown): v is GexBasis => v === 'oi-vol' || v === 'vol-only' || v === 'flow'
const isSplit = (v: unknown): v is GexSplit => v === 'net' || v === 'call-put'

function coerce(raw: unknown): GexChartSettings {
  const p = (raw ?? {}) as Partial<GexChartSettings> & { v?: number }
  const storedCards = (p.cards ?? {}) as Partial<Record<StatKey, boolean>>
  return {
    basis: isBasis(p.basis) ? p.basis : DEFAULT_SETTINGS.basis,
    split: isSplit(p.split) ? p.split : DEFAULT_SETTINGS.split,
    showDex: p.showDex === true,
    cardsOn: p.cardsOn !== false,
    // `!== false`, not `=== true`: a card added to STAT_KEYS after a user's
    // blob was written is not in it, and a new card should appear rather than
    // arrive switched off for everyone who ever opened the chart.
    cards: STAT_KEYS.reduce((acc, k) => ((acc[k] = storedCards[k] !== false), acc), {} as Record<StatKey, boolean>),
  }
}

export function loadSettings(cardId: string): GexChartSettings {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + cardId)
    return coerce(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_SETTINGS, cards: allCards(true) }
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
