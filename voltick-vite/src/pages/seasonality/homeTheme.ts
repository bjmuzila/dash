// ─────────────────────────────────────────────────────────────────────────────
// The seasonality port's view of CB Edge's HOME_THEME, repainted in Voltick.
//
// SeasonalityView and SeasonalityAlmanac are a 1:1 port of the public page at
// cbedge.net/explore/seasonality. Every colour in those two files reaches the
// screen through `HOME_THEME.*`, so this ONE file is where the whole almanac
// changes palette. Nothing in them was recoloured by hand, which is what keeps
// the port a port: a future update to the CB Edge originals drops straight in.
//
// So this is a NAME BRIDGE, not a second palette. Every value below is a token
// imported from ../../theme. There is no hex in this file, per non-negotiable
// #1 (import the token, never hand-mint a hex).
//
// THE TWO HALVES, and why they map differently:
//
//   CHROME  bg, panel, border, panelBg, panelBgStrong, text, muted
//           These are surfaces and type. They take Voltick's surface ladder and
//           Voltick's two paper steps, straight across.
//
//   DATA    cyan, orange, green, red
//           These are the chart series, not chrome. The CB Edge page carried
//           four of them (a teal, an orange, a pale blue and an alert red) and
//           this page draws up to six lines at once, so they have to stay six
//           separable hues.
//
//           They deliberately do NOT take the reserved level colours. VOLT,
//           FLIP, REVERSAL, SURGE and COIL each name one thing on a board, and
//           spending one of them on "the modern era average" would not look
//           slightly wrong, it would say something false. There are no levels
//           on this page. So the data half is drawn from the BRAND blues plus
//           GOOD and BAD, which carry the one meaning this page does use:
//           a return above zero and a return below it.
//
//             cyan   → ACCENT_TEXT  the primary series, and the accent where it
//                                   has to be text (a rail item, a tab, a chip)
//             green  → SKY          the seasonal average: a fine backdrop line
//                                   under the subject, which is what SKY is for
//             orange → VOLT         the subject line, the one the reader came
//                                   for. The only warm hue in the system, and
//                                   the only one that separates cleanly from
//                                   two blues at a 1px stroke.
//             red    → BAD          a negative return
//
//           VOLT is the one judgement call in here. It is used as a SERIES
//           colour on a page with no board and no levels, never as a level, and
//           it is the reason the two lines in the headline chart can be told
//           apart in greyscale as well as in colour.
//
// ES_CANDLE_UP / ES_CANDLE_DOWN are the almanac's bar and heat-cell direction
// pair. Those are P&L, so they are GOOD and BAD, which is exactly what those
// two tokens are reserved for.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ACCENT_TEXT,
  BAD,
  ELEV,
  GOOD,
  INK,
  LINE,
  PANEL,
  PAPER,
  PAPER_QUIET,
  SKY,
  VOLT,
} from "../../theme";

export const HOME_THEME = {
  /* chrome */
  bg: INK,
  panel: PANEL,
  panelBg: ELEV,
  panelBgStrong: ELEV,
  border: LINE,
  text: PAPER,
  muted: PAPER_QUIET,

  /* data */
  cyan: ACCENT_TEXT,
  green: SKY,
  orange: VOLT,
  red: BAD,
  /** Carried because the CB Edge original exports it. Nothing here reads it. */
  purple: SKY,
} as const;

/**
 * Direction pair for the almanac's bars and heat cells.
 *
 * Deliberately not HOME_THEME.green / .red above: those are series hues. A bar
 * that is up or down is P&L, and GOOD / BAD are the tokens that mean that.
 */
export const ES_CANDLE_UP = GOOD;
export const ES_CANDLE_DOWN = BAD;
