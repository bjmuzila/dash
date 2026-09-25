// ─────────────────────────────────────────────────────────────────────────────
// VOLTICK LEVELS — Volt ★ · Surge ↯ · Reversal ↘ · Coil ◆
//
// The level set the board draws when the owner flips the toolbar to the
// Voltick UI theme (design/uiTheme.ts). GEX Candles and Multi Greek replace
// their CORE / CW / PW marks with these four.
//
// ── The definitions are the Discord bot's, transcribed ──────────────────────
// server-v2/mg-ladder-discord.js · voltickFromBooks(), itself a port of
// Voltick's marksOf() (Voltick server/engine.js). One definition, three
// surfaces — the owner-dash post, the candles pane and the ladder must name
// the same strikes off the same book.
//
//   book = OI + today's volume net GEX (the LIVE book — OI alone is yesterday's
//          close and misses the 0DTE positions opened this morning)
//   vol  = volume-only net GEX
//
//   Volt ★     the single biggest |book| strike — the highest GEX
//   Reversal ↘ the opposite-sign pole: each candidate's size weighted by its
//              thick-shelf support (opposite-sign neighbours ≥ 40% its size
//              within 2.5 strike steps); nodes under 5% of the Volt ignored.
//              revWeight 0.18 = Voltick's default before its nightly grading.
//   Coil ◆     other strikes ≥ half the Volt, Volt + Reversal excluded,
//              heaviest first (5 kept; the first is the one drawn)
//   Surge ↯    the live magnet — biggest |vol| strike
//
// ── Colour is a word ────────────────────────────────────────────────────────
// Each level owns exactly one token (tokens.css, --color-vt-*). A chip is the
// level's fill with the level's own `-ink` on it — never a near-miss hex.
// ─────────────────────────────────────────────────────────────────────────────

export type VtKey = 'volt' | 'surge' | 'reversal' | 'coil'

export interface VtBookRow {
  strike: number
  /** OI + volume net GEX. */
  book: number
  /** Volume-only net GEX. */
  vol: number
}

export interface VoltickMarks {
  volt: number | null
  surge: number | null
  reversal: number | null
  coil: number | null
  /** Up to five coils, heaviest first. `coil` is coils[0]. */
  coils: number[]
}

export const EMPTY_VT: VoltickMarks = { volt: null, surge: null, reversal: null, coil: null, coils: [] }

const REV_WEIGHT = 0.18

export function voltickMarks(input: VtBookRow[]): VoltickMarks {
  const rows = input
    .filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.book) && Number.isFinite(r.vol))
    .slice()
    .sort((a, b) => a.strike - b.strike)
  if (!rows.length) return EMPTY_VT

  let volt: VtBookRow | null = null
  let voltAbs = 0
  for (const r of rows) {
    const a = Math.abs(r.book)
    if (a > voltAbs) {
      voltAbs = a
      volt = r
    }
  }
  const voltSign = volt ? Math.sign(volt.book) : 0

  let step = Infinity
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i]!.strike - rows[i - 1]!.strike
    if (d > 0 && d < step) step = d
  }
  const clusterWin = (step === Infinity ? 1 : step) * 2.5

  let reversal: VtBookRow | null = null
  let revBest = -Infinity
  for (const r of rows) {
    if (voltSign === 0 || Math.sign(r.book) !== -voltSign) continue
    const size = Math.abs(r.book)
    if (size < 0.05 * voltAbs) continue
    let cluster = 0
    for (const r2 of rows) {
      if (
        r2 !== r &&
        Math.abs(r2.strike - r.strike) <= clusterWin &&
        Math.sign(r2.book) === -voltSign &&
        Math.abs(r2.book) >= 0.4 * size
      )
        cluster++
    }
    const score = size * (1 + REV_WEIGHT * Math.min(cluster, 3))
    if (score > revBest) {
      revBest = score
      reversal = r
    }
  }

  const coils = rows
    .filter((r) => volt && r !== volt && r !== reversal && voltAbs > 0 && Math.abs(r.book) >= 0.5 * voltAbs)
    .sort((a, b) => Math.abs(b.book) - Math.abs(a.book))
    .slice(0, 5)
    .map((r) => r.strike)

  let surge: VtBookRow | null = null
  let surgeAbs = 0
  for (const r of rows) {
    const a = Math.abs(r.vol)
    if (a > surgeAbs) {
      surgeAbs = a
      surge = r
    }
  }

  return {
    volt: volt?.strike ?? null,
    surge: surge?.strike ?? null,
    reversal: reversal?.strike ?? null,
    coil: coils[0] ?? null,
    coils,
  }
}

export interface VtLevelDef {
  key: VtKey
  /** Short tag text. */
  label: string
  mark: string
  title: string
  /** Token NAMES, for canvas (resolved with getComputedStyle). */
  fillVar: string
  inkVar: string
  /** `var(...)` strings, for DOM styles. */
  fill: string
  ink: string
}

/** Draw / priority order: Volt first so a squeeze never hides it. */
export const VT_LEVELS: VtLevelDef[] = [
  {
    key: 'volt',
    label: 'VOLT',
    mark: '★',
    title: 'Volt — the strongest level on the board (highest GEX)',
    fillVar: '--color-vt-volt',
    inkVar: '--color-vt-volt-ink',
    fill: 'var(--color-vt-volt)',
    ink: 'var(--color-vt-volt-ink)',
  },
  {
    key: 'surge',
    label: 'SURGE',
    mark: '↯',
    title: "Surge — the live magnet (biggest volume GEX today)",
    fillVar: '--color-vt-surge',
    inkVar: '--color-vt-surge-ink',
    fill: 'var(--color-vt-surge)',
    ink: 'var(--color-vt-surge-ink)',
  },
  {
    key: 'reversal',
    label: 'REV',
    mark: '↘',
    title: 'Reversal — the opposite-sign pole price tends to turn at',
    fillVar: '--color-vt-reversal',
    inkVar: '--color-vt-reversal-ink',
    fill: 'var(--color-vt-reversal)',
    ink: 'var(--color-vt-reversal-ink)',
  },
  {
    key: 'coil',
    label: 'COIL',
    mark: '◆',
    title: 'Coil — a level at least half the Volt that price must get through first',
    fillVar: '--color-vt-coil',
    inkVar: '--color-vt-coil-ink',
    fill: 'var(--color-vt-coil)',
    ink: 'var(--color-vt-coil-ink)',
  },
]

/** The levels a strike carries (a strike can be two at once). */
export function vtLevelsAt(marks: VoltickMarks | null | undefined, strike: number): VtLevelDef[] {
  if (!marks) return []
  return VT_LEVELS.filter((d) => marks[d.key] === strike)
}
