// ─────────────────────────────────────────────────────────────────────────────
// Surface ladder for the seasonality page only.
//
// Six steps by ROLE, every one of them a Voltick token or a wash over one. The
// CB Edge original typed six hexes here; this file is a name layer instead, the
// same way homeTheme.ts is, so the palette still moves from src/theme.ts.
//
//   app    the page ground, behind everything          INK
//   rail   the section nav. Recessed, not raised: it is chrome, and dropping it
//          to the page ground is what stops it reading as a fourth card.
//   shell  the pane the cards sit on                   PANEL
//   card   a card's own fill                           ELEV
//   card2  a tile or an open disclosure INSIDE a card  a wash over the card
//   cardHi a hovered or selected surface               a stronger wash
//
// card2 and cardHi are washes rather than tokens on purpose. Voltick ships four
// surfaces and this page needs six steps; a wash over ELEV lands between ELEV
// and the next step up without inventing a fifth surface hex, and it is what
// Voltick's own stat tiles already do.
//
// Cards are painted through SeaCard's inline style because the shared `Card`
// sets its background inline, and an inline style cannot be beaten by a class.
// That is also why these are TS constants rather than CSS variables.
// ─────────────────────────────────────────────────────────────────────────────

import { ELEV, INK, LINE, PANEL, PAPER, rgba } from "../../theme";

export const SEA = {
  app: INK,
  rail: INK,
  shell: PANEL,
  card: ELEV,
  card2: rgba(PAPER, 0.045),
  cardHi: rgba(PAPER, 0.08),
  /** Hairline between surfaces. */
  line: LINE,
  lineSoft: rgba(PAPER, 0.07),
} as const;
