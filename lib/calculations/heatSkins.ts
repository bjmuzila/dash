/**
 * HEAT SKINS — how a heatmap cell is PAINTED, as data.
 *
 * This table used to live inside app/mult-greek/MultGreekClient.tsx, which was
 * fine while the Multi Greek ladder was the only surface that had a skin. The
 * option chain grid is the second one, and "same look as Multi Greek" has to
 * mean the SAME NUMBERS — one ramp, one set of rank floors, one level-fill
 * rule — or the two pages drift into two different pictures of the same gamma.
 *
 * Nothing about the MATH the numbers come from is in here. A skin only decides
 * how strong the tint is, how the cell is shaped and how the figure is
 * written — never which strike is a wall, which is rank 1, or what the value
 * is. Both skins read the identical `ratio = |value| / columnMax`.
 *
 *   classic — byte-for-byte what shipped: a 0.02→0.18 wash under white
 *             figures, square cells, full "$1.23M" values.
 *   vivid   — the tuner's export (generated/2026-08-25-heatmap-tuner.html):
 *             a near-opaque ramp so the column reads as a gradient at a
 *             glance, rounded cells with a gap so each one is its own tile,
 *             thin tracked-in type with a shadow to survive a hot fill, and
 *             compact figures so the wider padding still fits.
 *
 * `colW` from the tuner is deliberately NOT carried over: the ladder's columns
 * are 1fr inside four side-by-side panels, and a 94px floor per column would
 * overflow the row on anything under ~1800px.
 *
 * A HOST may override the `cell` block (geometry / type) for its own grid —
 * the option chain does, because its cells are 10px mono in a much denser
 * table — but never the ramp, the rank floors or the level fill. Those are
 * what "the vivid skin" means.
 */

import { LEVEL_COLORS } from "@/components/shared/homeTheme";
import type { WallKind } from "@/lib/calculations/heatLevels";

export type HeatSkin = "classic" | "vivid";

export type SkinDef = {
  label: string;
  /** rgb triplets — the sign of the value picks one. */
  pos: string;
  neg: string;
  /** alpha = min(max, base + (ratio × max(intensity,1))^ease × span) */
  ramp: { base: number; span: number; max: number; ease: number };
  /** Fixed alphas for ranks 1/2/3 — also what levels-only mode paints CB/CW/PW at. */
  rank: readonly [number, number, number];
  cell: {
    radius: number; gap: number; inset: number; padV: number; padH: number;
    fontSize: number; tracking: string; shadow?: string;
    /** Where the figure sits in the cell. */
    align: "center" | "right" | "left";
    /** Ink for the value. */
    text: string;
    /** weight by rank: [rank 1, ranks 2-3, unranked] */
    weight: readonly [number, number, number];
  };
  /**
   * Whether the ATM row also carries an "ATM" CHIP beside the strike.
   *
   * The white RING around the ATM row is no longer a skin choice — every skin
   * draws it, as the option chain page does, with an inset box-shadow. Which
   * strike spot sits on is not cosmetic. This knob only decides the chip:
   *
   *   "chip" / "both" — chip beside the strike as well.
   *   "box"  / "none" — ring only.
   */
  atm: "box" | "chip" | "both" | "none";
  /** money = "$1.23M" (2dp) · compact = "1.2M" (1dp) */
  fmt: "money" | "compact";
  /**
   * How a CB / CW / PW cell is FILLED.
   *
   *   null    — like every other cell: hue = SIGN, alpha = rank. The badge is
   *             the only thing naming the level.
   *   { … }   — the whole cell takes the LEVEL's colour instead.
   *             `mode: "level"` replaces the heat fill outright; `mode:
   *             "blend"` lays the level colour OVER the heat, so the sign
   *             survives underneath. `alpha` is per level — CB usually wants
   *             less than CW/PW because gold at full strength swamps a row.
   */
  levelFill: null | {
    mode: "level" | "blend";
    alpha: Record<WallKind, number>;
  };
  /** Where the Intensity slider is tuned to sit for this skin, and its ceiling.
   *  Switching skins moves the slider there — the ramps are different shapes,
   *  so the same number means a different picture on each and carrying one
   *  skin's position over to the other lands somewhere nobody chose. */
  intensity: { def: number; max: number };
};

export const HEAT_SKINS: Record<HeatSkin, SkinDef> = {
  classic: {
    label: "CLASSIC",
    pos: "41,182,246", neg: "255,71,87",
    ramp: { base: 0.02, span: 0.16, max: 0.18, ease: 1.4 },
    rank: [0.90, 0.45, 0.25],
    cell: {
      radius: 0, gap: 0, inset: 0, padV: 4, padH: 4,
      // SOFT_WHITE's literal, not the const — the pages that use it declare
      // their own. Keep the two in step.
      fontSize: 9, tracking: "0", align: "center", text: "#c3ccda",
      weight: [900, 800, 700],
    },
    atm: "box",
    fmt: "money",
    levelFill: null,
    intensity: { def: 1.75, max: 3 },
  },
  vivid: {
    label: "VIVID",
    pos: "41,182,246", neg: "255,71,87",
    // A LOW ease (0.4) with a modest span is what separates this from a simple
    // "turn the alpha up": the curve rises steeply out of zero, so the quiet
    // two-thirds of a column still differentiate instead of all sitting on the
    // floor, and only the genuinely large strikes approach the cap.
    ramp: { base: 0.05, span: 0.25, max: 1, ease: 0.4 },
    rank: [0.95, 0.62, 0.4],
    cell: {
      // inset is a 0.5px margin rather than a grid gap: it separates the tiles
      // without moving the column tracks, so the header and totals above stay
      // aligned with the cells whatever this is set to.
      radius: 3, gap: 0, inset: 0.5, padV: 2, padH: 8,
      fontSize: 9.5, tracking: "0", shadow: "0 1px 2px rgba(0,0,0,0.85)",
      // Right-aligned: the figures are the point of the column, and a shared
      // right edge is what lets you compare magnitudes down it at a glance.
      align: "right", text: "#ffffff",
      // Ranked cells step up only one notch (300 -> 600). At this ramp the FILL
      // already shouts which strikes are the big ones.
      weight: [600, 600, 300],
    },
    atm: "chip",
    fmt: "money",
    // The level's colour laid OVER the heat: CW and PW at full strength (the
    // wall IS the colour), CB pulled back to .85 because gold at 1.0 swamps
    // the row it sits in. The heat underneath still shows through CB.
    levelFill: { mode: "blend", alpha: { cb: 0.85, cw: 1, pw: 1 } },
    intensity: { def: 3, max: 4 },
  },
};

export function isHeatSkin(v: unknown): v is HeatSkin {
  return v === "classic" || v === "vivid";
}

/** "#ffd600" → "255,214,0". The level colours are hex; the fills are rgba(). */
export function hexToRgbTriplet(hex: string): string {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  return `${parseInt(f.slice(0, 2), 16)},${parseInt(f.slice(2, 4), 16)},${parseInt(f.slice(4, 6), 16)}`;
}

/** Heat fill for a cell painted at one of the skin's three fixed rank floors. */
export function skinRankBg(value: number, rank: 1 | 2 | 3, skin: SkinDef): string {
  return `rgba(${(value || 0) >= 0 ? skin.pos : skin.neg},${skin.rank[rank - 1]})`;
}

/**
 * Heat tint for one cell, on the skin's ramp.
 *
 * `topRank` is the cell's 1/2/3 standing in its column (0 = unranked): the
 * three dominant strikes take the skin's fixed rank floors so they always
 * stand out, and everything else follows the eased curve scaled by
 * `intensity`.
 *
 * At the Intensity slider's MINIMUM stop the caller does not reach this
 * function at all — the whole gamma field switches off and only CB / CW / PW
 * stay painted (see lib/calculations/heatLevels).
 */
export function skinMetricBg(value: number, maxValue: number, topRank: number, intensity: number, skin: SkinDef): string {
  const n = parseFloat(String(value)) || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return "transparent";
  if (topRank === 1 || topRank === 2 || topRank === 3) return skinRankBg(n, topRank as 1 | 2 | 3, skin);
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio * Math.max(intensity || 0.1, 1), skin.ramp.ease);
  const alpha = Math.min(skin.ramp.max, skin.ramp.base + eased * skin.ramp.span);
  return `rgba(${n >= 0 ? skin.pos : skin.neg},${alpha.toFixed(2)})`;
}

/**
 * Fill for a CB / CW / PW cell, when the skin asks for the level's colour
 * rather than the sign's. Returns null when the skin doesn't (CLASSIC), and
 * the caller falls through to the ordinary heat.
 *
 * "blend" is a two-stop linear-gradient rather than a colour: it is the only
 * way to composite one translucent layer over another in a single `background`
 * without knowing what the layer underneath resolved to.
 */
export function levelFillBg(kind: WallKind, skin: SkinDef, beneath: string): string | null {
  const lf = skin.levelFill;
  if (!lf) return null;
  const a = lf.alpha[kind];
  const c = hexToRgbTriplet(LEVEL_COLORS[kind]);
  if (lf.mode === "level") return `rgba(${c},${a})`;
  const over = `rgba(${c},${a})`;
  return `linear-gradient(${over},${over}), ${beneath === "transparent" ? "rgba(0,0,0,0)" : beneath}`;
}
