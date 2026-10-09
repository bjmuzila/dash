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

import { readUiTheme } from '@/design/uiTheme'

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

export interface VtOpts {
  /**
   * ALWAYS FOUR (GEX Candles, Voltick theme): every level resolves to a strike
   * whenever the ladder has any. The bot's definitions run first, unchanged;
   * these only fill a level the definition left empty:
   *   Reversal  → the biggest opposite-sign strike, 5% floor dropped; with no
   *               opposite-sign strike at all, the biggest strike that is not
   *               the Volt.
   *   Coil      → the heaviest strike that is not Volt / Reversal / Surge.
   *   Surge     → the Volt, when nothing has traded yet (no volume GEX).
   */
  always?: boolean
}

export function voltickMarks(input: VtBookRow[], opts: VtOpts = {}): VoltickMarks {
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

  if (opts.always && volt) {
    const byAbs = rows.slice().sort((a, b) => Math.abs(b.book) - Math.abs(a.book))
    if (!reversal) {
      reversal =
        byAbs.find((r) => r !== volt && voltSign !== 0 && Math.sign(r.book) === -voltSign) ??
        byAbs.find((r) => r !== volt && r.book !== 0) ??
        null
    }
    if (!surge) surge = volt
    // A fallback Reversal may have been counted as a Coil — it is the Reversal now.
    const revStrike = reversal?.strike
    for (let i = coils.length - 1; i >= 0; i--) if (coils[i] === revStrike) coils.splice(i, 1)
    if (!coils.length) {
      const c = byAbs.find((r) => r !== volt && r !== reversal && r !== surge && r.book !== 0)
      if (c) coils.push(c.strike)
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

// ── CB Edge levels, renamed for the Voltick UI theme ─────────────────────────
//
// Everywhere a v3 surface shows the CB Edge trio, the Voltick theme shows the
// SAME strikes under Voltick names (Brandon, 2026-09-28):
//
//   CORE (cb)                 → Volt ★
//   the wall on the CORE's side of spot  → Coil ◆
//     (CORE above spot → the call wall; CORE below spot → the put wall)
//   the wall on the other side           → Reversal ↘
//
// No new maths and no new data: the strike is whatever the surface already
// had. Only the name and the colour change. Surge has no CB Edge counterpart,
// so a renamed surface simply does not carry one.

/** Owner-only Voltick UI theme, read once — the toggle reloads the page. */
export const VOLTICK_UI = readUiTheme() === 'voltick'

// ── THE DEFINITION, ON A LADDER (Brandon, 2026-10-09) ────────────────────────
//   Volt ★      = the highest net GEX on the board (by size)
//   Reversal ↘  = the next highest net GEX that sits on the OTHER side of spot
//                 from the Volt (the top net GEX across spot)
//   Surge ↯     = the next highest net GEX that is neither the Volt nor the
//                 Reversal (either side of spot)
//   Coil ◆      = every other strike at least half the Volt's size (Volt,
//                 Reversal and Surge excluded), heaviest first, up to five.
//                 Switchable: the GEX menu's Coil toggle (pages/vela/gexBasis.ts
//                 vtCoilOn) is passed in as `opts.coil`.
// Replaces the 2026-10-04 reading (Coil = the 2nd top on the Volt's side, Surge
// = the biggest volume GEX). "Spot" is the price the reading is judged at: on
// Vela, the chart's own price moved onto the index's strikes (the ladder's
// recorded spot goes stale before the cash open and overnight).
// Read by the Vela chart (pages/vela: GEX Rail, Voltick Path, Key Levels, Level
// Alerts, the legend card, the session strip, Voltick Walls overnight).
// voltickMarks() above is the Voltick bot's own port and is unchanged; the
// recorded-walls version of this is vtTermsFromWalls() in pages/levelLog/wallData.ts.

export interface VtLadderRow {
  strike: number
  /** Net GEX at the strike, OI + vol (the live book). */
  net: number
}

export interface VtLadderLevels {
  volt: number | null
  reversal: number | null
  surge: number | null
  /** The heaviest Coil (coils[0]); null when none qualifies or the Coil is switched off. */
  coil: number | null
  /** Every Coil, heaviest first (up to five). */
  coils: number[]
}

export interface VtLadderOpts {
  /** Name Coils at all (the GEX menu's Coil toggle). Default on. */
  coil?: boolean
}

/** Tooltips for the levels as vtFromLadder names them (VT_LEVELS' titles are the bot's definitions, still used by the board). */
export const VT_LADDER_TITLE: Record<VtKey, string> = {
  volt: 'Volt — the highest net GEX on the board',
  reversal: 'Reversal — the highest net GEX on the other side of price from the Volt',
  surge: 'Surge — the next highest net GEX that is not the Volt or the Reversal',
  coil: 'Coil — a level at least half the Volt’s size',
}

/** A Coil is at least this share of the Volt's size. */
export const COIL_SHARE = 0.5
const MAX_COILS = 5

/**
 * Volt / Reversal / Surge / Coil for one ladder (definition above). `volt` may be
 * handed in (a surface's own CORE, so the two cannot disagree); otherwise it is
 * the top |net|. With no spot the sides cannot be told apart: no Reversal, and
 * the Surge is simply the next highest after the Volt.
 */
export function vtFromLadder(
  rows: readonly VtLadderRow[],
  spot: number | null | undefined,
  volt?: number | null,
  opts: VtLadderOpts = {},
): VtLadderLevels {
  const ok = rows.filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.net) && r.net !== 0)
  // heaviest first; ties go to the lower strike so a reading never flickers
  const byAbs = ok.slice().sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.strike - b.strike)
  const v = volt ?? byAbs[0]?.strike ?? null
  const none: VtLadderLevels = { volt: v, reversal: null, surge: null, coil: null, coils: [] }
  if (v == null) return none
  const voltAbs = Math.abs(ok.find((r) => r.strike === v)?.net ?? byAbs[0]?.net ?? 0)

  let reversal: number | null = null
  if (spot != null && spot > 0) {
    const up = v >= spot
    reversal = byAbs.find((r) => r.strike !== v && (up ? r.strike < spot : r.strike >= spot))?.strike ?? null
  }
  const surge = byAbs.find((r) => r.strike !== v && r.strike !== reversal)?.strike ?? null
  const coils =
    opts.coil === false || !(voltAbs > 0)
      ? []
      : byAbs
          .filter((r) => r.strike !== v && r.strike !== reversal && r.strike !== surge && Math.abs(r.net) >= COIL_SHARE * voltAbs)
          .slice(0, MAX_COILS)
          .map((r) => r.strike)
  return { volt: v, reversal, surge, coil: coils[0] ?? null, coils }
}

export type CbLevelKey = 'cb' | 'cw' | 'pw'

/** Which side of spot the CORE sits on. null without a core or a spot. */
export function coreSide(core: number | null | undefined, spot: number | null | undefined): 'call' | 'put' | null {
  if (core == null || !Number.isFinite(core) || spot == null || !(spot > 0)) return null
  return core >= spot ? 'call' : 'put'
}

/**
 * The Voltick level a CB Edge level is shown as. `cb` is always the Volt; a
 * wall is the Coil on the CORE's side of spot and the Reversal on the other.
 * With no spot, the wall NEARER the CORE is taken as the Coil (pass `walls`);
 * with neither, the call wall is the Coil.
 */
export function vtKeyOf(
  key: CbLevelKey,
  core: number | null | undefined,
  spot: number | null | undefined,
  walls?: { cw?: number | null; pw?: number | null },
): VtKey {
  if (key === 'cb') return 'volt'
  let side = coreSide(core, spot)
  if (!side && core != null && walls?.cw != null && walls?.pw != null) {
    side = Math.abs(core - walls.cw) <= Math.abs(core - walls.pw) ? 'call' : 'put'
  }
  if (key === 'cw') return side === 'put' ? 'reversal' : 'coil'
  return side === 'put' ? 'coil' : 'reversal'
}

/** The level definition (label, mark, colours) for a key. */
export function vtDef(key: VtKey): VtLevelDef {
  return VT_LEVELS.find((d) => d.key === key) as VtLevelDef
}

/** Title-case display name, e.g. "Volt", "Reversal". */
export const VT_NAME: Record<VtKey, string> = {
  volt: 'Volt',
  surge: 'Surge',
  reversal: 'Reversal',
  coil: 'Coil',
}

/** Short code for tight chips — same as VT_LEVELS label. */
export const VT_CODE: Record<VtKey, string> = {
  volt: 'VOLT',
  surge: 'SURGE',
  reversal: 'REV',
  coil: 'COIL',
}

/**
 * One call site's renamer. Build it with the reading's own CORE, spot and
 * walls; every method returns the CB Edge text/colour it is handed unchanged
 * when the Voltick theme is off, so a call site reads the same either way:
 *
 *   const vt = levelNamer(core, spot, callWall, putWall)
 *   vt.name('cw', 'Call Wall')   // 'Coil' / 'Reversal' on Voltick
 *   vt.color('cw', 'var(--cw)')  // 'var(--color-vt-coil)' …
 */
export interface LevelNamer {
  /** Title case: "Volt", "Coil", "Reversal". */
  name: (k: CbLevelKey, cbedge: string) => string
  /** Upper case: "VOLT", "COIL", "REVERSAL". */
  upper: (k: CbLevelKey, cbedge: string) => string
  /** Chip code: "VOLT", "COIL", "REV". */
  code: (k: CbLevelKey, cbedge: string) => string
  /** A `var(--color-vt-…)` string. */
  color: (k: CbLevelKey, cbedge: string) => string
  /** The Voltick key, or null when the theme is off. */
  key: (k: CbLevelKey) => VtKey | null
}

export function levelNamer(
  core: number | null | undefined,
  spot: number | null | undefined,
  callWall?: number | null,
  putWall?: number | null,
): LevelNamer {
  const key = (k: CbLevelKey): VtKey | null =>
    VOLTICK_UI ? vtKeyOf(k, core, spot, { cw: callWall ?? null, pw: putWall ?? null }) : null
  return {
    key,
    name: (k, cb) => {
      const v = key(k)
      return v ? VT_NAME[v] : cb
    },
    upper: (k, cb) => {
      const v = key(k)
      return v ? VT_NAME[v].toUpperCase() : cb
    },
    code: (k, cb) => {
      const v = key(k)
      return v ? VT_CODE[v] : cb
    },
    color: (k, cb) => {
      const v = key(k)
      return v ? vtDef(v).fill : cb
    },
  }
}

/** walls_log / API level_type → CbLevelKey. */
export function cbKeyOfLevelType(lt: string): CbLevelKey {
  return lt === 'call_wall' ? 'cw' : lt === 'put_wall' ? 'pw' : 'cb'
}
