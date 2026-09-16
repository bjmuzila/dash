/**
 * The visitor map, in Voltick.
 *
 * `VisitorMap.tsx` beside this file is the owner console's component. It was
 * copied whole and then repainted, and this file is where the repaint lives:
 * every colour the map draws is either a Voltick token or built from one with
 * `rgba()`. The component imports these and mints no hex of its own, so the
 * console's structure survives a palette change and the palette survives a
 * re-copy of the console's structure.
 *
 * The console's palette maps across like this:
 *
 *   #219EBC owner teal     ACCENT / ACCENT_TEXT   chrome, the active control
 *   #7dd3fc light blue     SKY                    country names, counts, fine lines
 *   #FFB703 gold (paying)  GOOD                   see below
 *   #8A93A6 slate          PAPER_QUIET            anonymous
 *   #0D1119 panel          ELEV                   pinned card, and the dot ring
 *
 * Gold is the one that is not a straight swap. Voltick's gold is VOLT, and VOLT
 * is spoken for: it means the strongest level on a board, and a subscription is
 * not a level. So the "has an account" hue is GOOD instead, which on the Voltick
 * sandbox already means money (see the customer card). The console's two-channel
 * logic is untouched and is the thing worth keeping: HUE says the visitor has an
 * account, FILL says they are paying. Solid is a customer, a ring is a free
 * registration, a quiet ring is a stranger.
 */
import {
  ACCENT,
  ACCENT_TEXT,
  BAD,
  ELEV,
  GOOD,
  INK,
  LINE,
  PANEL,
  PAPER,
  PAPER_DISPLAY,
  PAPER_QUIET,
  SKY,
  rgba,
} from "../../theme";

export { rgba as mapRgba };

/** The named colours the copied component reads off its theme object. */
export const MAP = {
  text: PAPER,
  /** Secondary text. A token, not `text` at reduced opacity: Voltick has no grey. */
  textQuiet: PAPER_QUIET,
  display: PAPER_DISPLAY,
  border: LINE,
  borderStrong: rgba(PAPER, 0.18),
  /** The raised surface: the pinned card, and the ring that separates the dots. */
  panelBgStrong: ELEV,
  panelBg: PANEL,
  bg: INK,
  /** Chrome accent, where it has to BE text. */
  cyan: ACCENT_TEXT,
  accent: ACCENT,
  /** "Has an account." Solid means paying, a ring means free. */
  gold: GOOD,
  lightBlue: SKY,
  green: GOOD,
  red: BAD,
  muted: PAPER_QUIET,
  textSecondary: PAPER_QUIET,
} as const;

/* ── The choropleth ramp ──────────────────────────────────────────────────── */

/**
 * Three stops, ONE hue, from just above the panel to ACCENT. Traffic is heavily
 * skewed to one or two countries, so the domain is square-rooted upstream; a
 * linear ramp would draw everything but the top country as the same near-empty
 * shade.
 *
 * The ceiling is ACCENT and not something paler on purpose. The dots are the
 * data and the choropleth is context, so the busiest country must not become
 * the one place a dot cannot be read: a near-white ceiling is exactly where the
 * marks go missing.
 */
export const RAMP: Array<[number, number, number]> = [
  [16, 26, 46], // barely above the panel
  [30, 62, 142],
  [47, 107, 255], // ACCENT, the ceiling
];

/** A country with no visitors: present, but not part of the data. */
export const EMPTY_FILL = rgba(PAPER, 0.045);
/** Every border on the map. One weight, hairline. */
export const STROKE = rgba(PAPER, 0.16);
/** The card surface, reused as the dots' separating ring. */
export const SURFACE = ELEV;

/* ── The dots ─────────────────────────────────────────────────────────────── */

/**
 * Each mark pairs its colour with the SURFACE colour, and that is what keeps it
 * readable at every step of the ramp: whichever half of a mark loses contrast
 * against the country under it, the other half holds. A solid dot on a bright
 * country is carried by its dark ring; on a near-black country the ring
 * disappears and the fill carries it. A ring in the surface colour is also what
 * keeps a tight fan of co-located visitors legible.
 */
export const BUBBLE_FILL = rgba(ELEV, 0.85);
export const BUBBLE_STROKE = rgba(PAPER_QUIET, 0.95);
export const MEMBER_FILL = GOOD;
/** Text and badges for anonymous visitors, matching their dot. */
export const VISITOR_INK = PAPER_QUIET;
/** The legend toggle when the dot layer is on. */
export const ACCOUNT_SOFT = rgba(GOOD, 0.1);
