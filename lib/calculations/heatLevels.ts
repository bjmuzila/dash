/**
 * LEVELS-ONLY HEAT — what an Intensity slider means at its MINIMUM stop.
 *
 * Every Intensity slider in the app scales the same kind of thing: a per-column
 * gamma wash painted behind the numbers. Dragged to the bottom, that wash used
 * to collapse toward a uniform floor tint — every strike still painted, all of
 * them within a couple of percent of the same alpha. That is the least readable
 * position the control has, and it is the one people reach for when they want
 * LESS noise, not flatter noise.
 *
 * The minimum stop now means something instead: the gamma field is switched OFF
 * entirely and only the three named levels stay lit.
 *
 *   CB — Core Bullseye : the largest |net| strike in the column (sign-blind)
 *   CW — Call Wall     : the largest +net strike
 *   PW — Put Wall      : the most −net strike
 *
 * CB takes its strike first; CW and PW skip it, so three labels always name
 * three DISTINCT strikes rather than printing one level twice. That is the same
 * rule computeWalls() uses on Multi Greek and deriveColumnLevels() uses on the
 * ES card — it lives here so the four surfaces that host an Intensity slider
 * (Multi Greek, the option chain grid, the ES card heatmap, the ES chain rail)
 * cannot drift into four different answers for "which strikes survive at the
 * bottom of the slider".
 *
 * ── What the surviving cells look like ──────────────────────────────────────
 * They keep the HEATMAP's language, not the level badges'. A levels-only cell is
 * painted at one of the heat scale's three fixed rank floors — CB at rank 1, CW
 * at rank 2, PW at rank 3 — so it is still cyan for positive gamma and red for
 * negative, exactly as it would be at any other slider position. Filling them
 * gold/blue/red to match the CB/CW/PW badges was the obvious first move and it
 * was wrong: it threw away the sign, which is the one thing a gamma cell must
 * never stop saying, and it made a Put Wall and a red heat cell two different
 * shades of "red" for two unrelated reasons.
 *
 * The badge still names the level; the fill still says how much and which way.
 * The colours themselves live with each surface's heat function (rankBg() in
 * lib/calculations/optionChain, gexRankColor() in the ES card's chartMath) so
 * this module stays pure math.
 */

export type WallKind = "cb" | "cw" | "pw";

/**
 * Which heat rank floor each level paints at in levels-only mode. CB is the
 * column's biggest |net| by definition, so it is rank 1 whatever the heat scale
 * would have said; CW and PW take 2 and 3 to keep the three tiers visibly
 * ordered. Feed these to rankBg() / gexRankColor().
 */
export const WALL_RANK: Record<WallKind, 1 | 2 | 3> = { cb: 1, cw: 2, pw: 3 };

export interface ColumnWalls {
  cb: number | null;
  cw: number | null;
  pw: number | null;
}

/**
 * Slider minimums, one place. A surface tests its OWN slider's min — hardcoding
 * 0.5 in a file whose slider starts at 0.1 would make the levels-only mode
 * unreachable there, which is exactly the kind of silent drift this module
 * exists to stop.
 */
export const INTENSITY_MIN = {
  /** Multi Greek toolbar + the option chain grid (`min={0.5}`). */
  chain: 0.5,
  /** ES Candles card heatmap (`min={0.1}`), shared by its chain rail. */
  esCandles: 0.1,
} as const;

/**
 * Is this slider sitting on its bottom stop? Compared with a small epsilon
 * rather than `===` because the value round-trips through a range input's
 * string value and through saved settings, and 0.1 does not always come back as
 * exactly 0.1.
 */
export function atMinIntensity(value: number, min: number): boolean {
  return !Number.isFinite(value) || value <= min + 1e-6;
}

/**
 * CB / CW / PW for one column of (strike, net) pairs.
 *
 * `null` rather than a fallback when a side is empty or holds only CB: repeating
 * CB under a wall label reads as two levels agreeing when it is one level
 * counted twice.
 */
export function columnWalls(rows: { strike: number; net: number }[]): ColumnWalls {
  let cb: number | null = null;
  let cbAbs = 0;
  for (const r of rows) {
    const a = Math.abs(r.net || 0);
    if (a > cbAbs) { cbAbs = a; cb = r.strike; }
  }
  const cw = rows
    .filter(r => (r.net || 0) > 0)
    .sort((a, b) => b.net - a.net)
    .find(r => r.strike !== cb)?.strike ?? null;
  const pw = rows
    .filter(r => (r.net || 0) < 0)
    .sort((a, b) => a.net - b.net)
    .find(r => r.strike !== cb)?.strike ?? null;
  return { cb, cw, pw };
}

/** Which level (if any) this strike is in that column. CB wins ties by order. */
export function wallAt(walls: ColumnWalls | null | undefined, strike: number): WallKind | null {
  if (!walls) return null;
  if (walls.cb === strike) return "cb";
  if (walls.cw === strike) return "cw";
  if (walls.pw === strike) return "pw";
  return null;
}

/**
 * Respect the CB / CW / PW toolbar toggles where a surface has them: a level the
 * user switched off must not come back just because the slider hit bottom.
 */
export function wallVisible(kind: WallKind | null, show?: { cb?: boolean; cw?: boolean; pw?: boolean }): boolean {
  if (!kind) return false;
  if (!show) return true;
  return show[kind] !== false;
}
