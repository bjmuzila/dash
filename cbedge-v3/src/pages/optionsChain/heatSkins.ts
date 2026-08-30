// ─────────────────────────────────────────────────────────────────────────────
// HEAT SKINS — how a chain cell is PAINTED, as data.
//
// Transcribed from v2's lib/calculations/heatSkins.ts plus the CHAIN_CELL table
// that lived inside components/pages/OptionsChain.tsx. The split is the same one
// v2 makes and it matters: a skin owns the RAMP, the RANK FLOORS and the LEVEL
// FILL — that is what "the vivid skin" means, and it is shared. A host owns the
// CELL GEOMETRY, because this grid's cells are 10px mono in a dense table with
// sticky rails and the Multi Greek ladder's are 9px figures in four side-by-side
// panels.
//
// Nothing about the MATH the numbers come from is in here. A skin never decides
// which strike is a wall, which is rank 1, or what the value is. Both skins read
// the identical `ratio = |value| / columnMax`.
//
//   classic — byte-for-byte what v2 shipped: a 0.02→0.18 wash under soft-white
//             figures, square cells, full "+$1.23M" values.
//   vivid   — a near-opaque ramp so the column reads as a gradient at a glance,
//             rounded cells with a gap so each is its own tile, thin type with a
//             shadow to survive a hot fill, and compact figures.
//
// ── The one thing that changed in the port ───────────────────────────────────
// v2 built its fills as `rgba(41,182,246,α)` from a stored "41,182,246" triplet.
// v3 bans colour literals (non-negotiable #1), so the pos/neg pair is now
// --color-gex-pos / --color-gex-neg — which hold EXACTLY those two values — and
// the alpha is applied with alpha() (color-mix) instead of an rgba() literal.
// Same colour, same alpha, one source of truth.
//
// Spec: docs/parity/options-chain.md — Part J.
// ─────────────────────────────────────────────────────────────────────────────

import { alpha, CHAIN, GEX_NEG, GEX_POS, LEVEL_COLORS, SHADOW, T } from '@/design/theme'
import type { WallKind } from './chainMath'

export type HeatSkin = 'classic' | 'vivid'

/** CB / CW / PW badge colours, for the skins that fill a level with them. */
const LEVEL_FILL_COLOR: Record<WallKind, string> = {
  cb: LEVEL_COLORS.cb,
  cw: LEVEL_COLORS.cw,
  pw: LEVEL_COLORS.pw,
}

export interface SkinDef {
  label: string
  /** alpha = min(max, base + (ratio × max(intensity,1))^ease × span) */
  ramp: { base: number; span: number; max: number; ease: number }
  /** Fixed alphas for ranks 1/2/3 — also what levels-only paints CB/CW/PW at. */
  rank: readonly [number, number, number]
  /**
   * How a CB / CW / PW cell is FILLED.
   *   null  — like every other cell: hue = SIGN, alpha = rank. The ★ is the only
   *           thing naming the level.
   *   blend — the level's own colour laid OVER the heat, so the sign survives
   *           underneath. `alpha` is per level: CB wants less than CW/PW because
   *           gold at full strength swamps the row it sits in.
   */
  levelFill: null | { mode: 'level' | 'blend'; alpha: Record<WallKind, number> }
  /**
   * Where the Intensity slider is tuned to sit for this skin, and its ceiling.
   * Switching skins MOVES the slider there — the ramps are different shapes, so
   * 1.75 on one is not 1.75 on the other and carrying a number across lands
   * somewhere nobody chose.
   */
  intensity: { def: number; max: number }
}

export const HEAT_SKINS: Record<HeatSkin, SkinDef> = {
  classic: {
    label: 'CLASSIC',
    ramp: { base: 0.02, span: 0.16, max: 0.18, ease: 1.4 },
    rank: [0.9, 0.45, 0.25],
    levelFill: null,
    intensity: { def: 1.75, max: 3 },
  },
  vivid: {
    label: 'VIVID',
    // A LOW ease (0.4) with a modest span is what separates this from "turn the
    // alpha up": the curve rises steeply out of zero, so the quiet two-thirds of
    // a column still differentiate instead of all sitting on the floor, and only
    // the genuinely large strikes approach the cap.
    ramp: { base: 0.05, span: 0.25, max: 1, ease: 0.4 },
    rank: [0.95, 0.62, 0.4],
    // CW and PW at full strength (the wall IS the colour), CB pulled back to
    // .85 because gold at 1.0 swamps the row. The heat still shows through CB.
    levelFill: { mode: 'blend', alpha: { cb: 0.85, cw: 1, pw: 1 } },
    intensity: { def: 3, max: 4 },
  },
}

export function isHeatSkin(v: unknown): v is HeatSkin {
  return v === 'classic' || v === 'vivid'
}

/** Heat fill for a cell painted at one of the skin's three fixed rank floors. */
export function skinRankBg(value: number, rank: 1 | 2 | 3, skin: SkinDef): string {
  return alpha((value || 0) >= 0 ? GEX_POS : GEX_NEG, skin.rank[rank - 1] as number)
}

/**
 * Heat tint for one cell, on the skin's ramp.
 *
 * `topRank` is the cell's 1/2/3 standing in its column (0 = unranked): the three
 * dominant strikes take the skin's fixed rank floors so they always stand out,
 * and everything else follows the eased curve scaled by `intensity`.
 *
 * At the Intensity slider's MINIMUM stop the caller does not reach this function
 * at all — the whole gamma field switches off and only CB / CW / PW stay
 * painted. See atMinIntensity in chainMath.
 */
export function skinMetricBg(
  value: number,
  maxValue: number,
  topRank: number,
  intensity: number,
  skin: SkinDef,
): string {
  const n = parseFloat(String(value)) || 0
  const m = maxValue || 0
  if (m === 0 || !n) return 'transparent'
  if (topRank === 1 || topRank === 2 || topRank === 3) {
    return skinRankBg(n, topRank as 1 | 2 | 3, skin)
  }
  const ratio = Math.min(Math.abs(n) / m, 1)
  const eased = Math.pow(ratio * Math.max(intensity || 0.1, 1), skin.ramp.ease)
  const a = Math.min(skin.ramp.max, skin.ramp.base + eased * skin.ramp.span)
  return alpha(n >= 0 ? GEX_POS : GEX_NEG, Number(a.toFixed(2)))
}

/**
 * Fill for a CB / CW / PW cell, when the skin asks for the level's colour rather
 * than the sign's. Returns null when the skin does not (CLASSIC), and the caller
 * falls through to the ordinary heat.
 *
 * "blend" is a two-stop linear-gradient rather than a colour: it is the only way
 * to composite one translucent layer over another in a single `background`
 * without knowing what the layer underneath resolved to.
 */
export function levelFillBg(kind: WallKind, skin: SkinDef, beneath: string): string | null {
  const lf = skin.levelFill
  if (!lf) return null
  const over = alpha(LEVEL_FILL_COLOR[kind], lf.alpha[kind])
  if (lf.mode === 'level') return over
  return `linear-gradient(${over},${over}), ${beneath === 'transparent' ? 'transparent' : beneath}`
}

// ── Cell geometry, as THIS grid wears each skin ──────────────────────────────
// The ramp / rank floors / level fill above are shared. What does not carry over
// from the Multi Greek ladder is the `cell` block, so it is stated here per
// skin. CLASSIC's entry is byte-for-byte the chain as it shipped — switching
// skins must be reversible to exactly the old page.

export interface ChainCellStyle {
  radius: number
  /** A 0.5px MARGIN, not a grid gap: it separates the tiles without moving the
   *  column tracks, so the sticky header and the strike rails stay aligned. */
  inset: number
  fontSize: number
  shadow?: string
  text: string
  /** weight by rank: [rank 1, ranks 2-3, unranked] */
  weight: readonly [number, number, number]
  /** Colour the leading +/− of a figure. */
  signColors: boolean
  /** "+$1.23M" (the chain's own convention) vs Multi Greek's "$1.23M". */
  plusSign: boolean
  /** Multi Greek pins every figure to its cell's middle; classic cells sit on a
   *  shared baseline. */
  align: 'center' | 'baseline'
}

export const CHAIN_CELL: Record<HeatSkin, ChainCellStyle> = {
  classic: {
    radius: 0,
    inset: 0,
    fontSize: 10,
    text: CHAIN.ink,
    weight: [400, 400, 400],
    signColors: true,
    plusSign: true,
    align: 'baseline',
  },
  vivid: {
    radius: 3,
    inset: 0.5,
    fontSize: 9.5,
    shadow: `0 1px 2px ${alpha(SHADOW, 0.85)}`,
    // White on a near-opaque fill, and NO coloured +/−: at this ramp a cell can
    // be a full-strength negative tile, and a green "+" on it is the unreadable
    // case. Direction is carried by the tint.
    text: T.text,
    weight: [600, 600, 300],
    // A "+" on every positive figure is a whole column of ink saying what the
    // absence of a minus already says, in the one place with no room to spare.
    plusSign: false,
    signColors: false,
    align: 'center',
  },
}

/** Saved skin choice, per browser. */
export const CHAIN_HEAT_SKIN_KEY = 'chain_heat_skin'
/** What an untouched chain loads with. */
export const CHAIN_DEFAULT_SKIN: HeatSkin = 'vivid'
