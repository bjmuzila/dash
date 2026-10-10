/**
 * THRESHOLD COLORING — the Multi Greek ladder's second paint scheme.
 *
 * The heat scheme (lib/calculations/optionChain → metricBg) paints EVERY cell
 * that has a value, on a ramp keyed to the column's largest magnitude. It answers
 * "how does this strike compare to the biggest one", and it answers it for all
 * forty rows at once, which is why a full ladder reads as a wash.
 *
 * This scheme answers a different question — "does this strike matter at all" —
 * and answers it with a hard yes/no:
 *
 *     share = |GEX| / Σ|GEX| over the column      colored ⟺ share ≥ threshold
 *
 * The denominator is GROSS gamma, so + and − strikes compete for the same 100%
 * and a column dominated by puts cannot also light up its calls. Everything below
 * the line is dimmed rather than erased: a cell with a value still has to look
 * different from a cell with none.
 *
 * ── Why the walls need more than a brighter fill ────────────────────────────
 * CB / CW / PW paint over the gamma fill here, which throws the sign away — so
 * the colors put it back: CB is gold (it is sign-blind by definition, just the
 * biggest |GEX|), CW takes the +GEX color and PW the −GEX color, since those two
 * already carry their sign in their definitions.
 *
 * That alone was not enough. A wall filled with a louder version of the same hue
 * on a panel already full of that hue reads as "a bit more", not "this one" —
 * there is no headroom left inside the hue. So a wall gets three things nothing
 * else on the grid has: saturation and luminance pushed to the hue's vivid limit
 * (`boostHex`), a near-white rim (`rimHex`) — headroom outside the hue — and an
 * outer glow. The rim is the piece that actually does the work.
 */

export type MgColorMode = "heat" | "threshold";

export const MG_COLOR_MODE_KEY = "mg_color_mode";

/**
 * Every tunable, in one object, at the values picked in
 * generated/2026-08-21-mg-color-modes.html. Change them here, not at a call site.
 */
export const GEX_THRESHOLD = {
  /** Ordinary above-threshold cell opacity. */
  fillAlpha: 0.53,
  /** Below-threshold cells: present, but clearly not in play. */
  dimAlpha: 0.035,
  /** CB sits quieter than the two walls on purpose — it is a marker, not a level. */
  cbAlpha: 0.53,
  wallAlpha: 1,
  /** 0 = the raw +/− hue, 1 = as vivid as that hue goes. */
  wallBoost: 0.6,
  /** 0 = rim matches the fill, 1 = rim is essentially white. */
  wallRim: 0.8,
  wallRimW: 2,
  wallGlow: 0.65,
  /** Level outline width for CB (the walls use wallRimW). */
  cbOutlineW: 1,
} as const;

/**
 * The Intensity slider drives the threshold in this mode rather than sitting
 * dead: drag right and more of the ladder lights up. Its MINIMUM stop keeps its
 * existing meaning (levels-only) and is handled by the caller before this runs.
 *
 * Tuned so the slider's default — 1.75 on Multi Greek's 0.5–3 track, i.e. dead
 * centre — lands on 2.00%, which is where the ladder stops reading as a wash and
 * starts reading as a shortlist. Top of the track is 0% (color everything with a
 * value); bottom is TH_AT_MIN, just before the levels-only stop.
 */
export function thresholdPct(intensity: number, min: number, max: number): number {
  const span = max - min;
  if (!(span > 0)) return 2;
  const t = Math.min(1, Math.max(0, (intensity - min) / span));
  return TH_AT_MIN * (1 - t);
}
const TH_AT_MIN = 4;

// ── color math ───────────────────────────────────────────────────────────────

function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

export function rgbaHex(hex: string, a: number): string {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function hexToHsl(hex: string): [number, number, number] {
  const [r0, g0, b0] = rgbOf(hex);
  const r = r0 / 255, g = g0 / 255, b = b0 / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.min(1, Math.max(0, s));
  const ll = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0, g = 0, b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * A brighter member of the same color family. Luminance is pulled toward a
 * mid-bright target rather than toward white — a washed-out pink stops reading
 * as a put wall.
 */
export function boostHex(hex: string, amount = GEX_THRESHOLD.wallBoost): string {
  if (!amount) return hex;
  const [h, s, l] = hexToHsl(hex);
  const TARGET_L = 0.6;
  return hslToHex(h, s + (1 - s) * amount, l + (TARGET_L - l) * amount * 0.9 + amount * 0.06);
}

/** The near-white edge. 0 = the fill color, 1 = essentially white. */
export function rimHex(hex: string, amount = GEX_THRESHOLD.wallRim): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, s * (1 - amount * 0.55), l + (0.97 - l) * amount);
}

/**
 * Readable ink for text on `hex` at opacity `a` over the near-black panel.
 * The cut is at 0.55, not 0.5: a mid-tone red or blue sits just under half
 * luminance and still wants white on it — only genuinely light fills (gold)
 * should flip to dark.
 */
export function inkOn(hex: string, a: number): string {
  const [r, g, b] = rgbOf(hex);
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L * a + 0.03 * (1 - a) > 0.55 ? "#0a1016" : "#ffffff";
}

// ── the two paints ───────────────────────────────────────────────────────────

/**
 * Ordinary (non-level) cell. `gross` is Σ|GEX| across the column; a column with
 * no gross has nothing to take a share of, so nothing is painted.
 */
export function thresholdBg(
  value: number | null | undefined,
  gross: number,
  thPct: number,
  posColor: string,
  negColor: string,
): string {
  const v = value ?? 0;
  if (!v || !(gross > 0)) return "transparent";
  const color = v > 0 ? posColor : negColor;
  const share = (Math.abs(v) / gross) * 100;
  return share >= thPct
    ? rgbaHex(color, GEX_THRESHOLD.fillAlpha)
    : rgbaHex(color, GEX_THRESHOLD.dimAlpha);
}

export interface WallPaint {
  /** Cell background. */
  bg: string;
  /** Outline color + width. */
  outline: string;
  outlineW: number;
  /** box-shadow, or "" when this level does not glow. */
  glow: string;
  /** Badge background (same color) and its readable ink. */
  badge: string;
  badgeInk: string;
  /** Ink for the cell's own number. */
  ink: string;
}

/**
 * CB / CW / PW under threshold coloring. CB keeps its gold and stays quiet; the
 * two walls get the boost + rim + glow that make them the loudest cells present.
 */
export function levelPaint(
  kind: "cb" | "cw" | "pw",
  cbColor: string,
  posColor: string,
  negColor: string,
): WallPaint {
  if (kind === "cb") {
    const a = GEX_THRESHOLD.cbAlpha;
    return {
      bg: rgbaHex(cbColor, a),
      outline: cbColor,
      outlineW: GEX_THRESHOLD.cbOutlineW,
      glow: "",
      badge: cbColor,
      badgeInk: inkOn(cbColor, 1),
      ink: inkOn(cbColor, a),
    };
  }
  const base = boostHex(kind === "cw" ? posColor : negColor);
  const a = GEX_THRESHOLD.wallAlpha;
  const g = GEX_THRESHOLD.wallGlow;
  return {
    bg: rgbaHex(base, a),
    outline: rimHex(base),
    outlineW: GEX_THRESHOLD.wallRimW,
    glow: [
      `0 0 ${Math.round(4 + g * 12)}px ${rgbaHex(base, 0.3 + g * 0.5)}`,
      `0 0 ${Math.round(1 + g * 3)}px ${rgbaHex(base, 0.55 + g * 0.45)}`,
    ].join(", "),
    badge: base,
    badgeInk: inkOn(base, 1),
    ink: inkOn(base, a),
  };
}
