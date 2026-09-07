// ─────────────────────────────────────────────────────────────────────────────
// Surface palette for the seasonality pages only.
//
// The six steps below are v3's OWN surface ladder, read out of tokens.css
// rather than typed here. The file survives as a NAME layer: `SEA.card2` says
// "a tile inside a card" where `var(--color-surface2)` says only which step it
// is, and the seasonality pages reference these by role in ~20 places.
//
// Six steps, darkest outward:
//   app    the page ground, behind everything      --color-app
//   rail   the section nav, one step up so it reads as chrome not content
//   shell  the pane the cards sit on               --color-bg
//   card   a card's own fill                       --color-surface
//   card2  a tile or an open disclosure INSIDE a card
//   cardHi a hovered or selected surface           --color-raised
//
// Cards are painted through SeaCard's inline style because the shared `Card`
// sets its background inline, and an inline style cannot be overridden by a
// class. That is why these are TS strings rather than utility classes — but
// every one of them is a `var(--color-…)`, so the palette still moves from
// tokens.css and check-theme.mjs stays satisfied.
//
// EVERY value here is a CSS string. Nothing in this folder paints a canvas, so
// var()/color-mix() is safe throughout; if that ever changes, resolve through
// tokenHex() from design/theme.ts rather than typing a hex back in here.
// ─────────────────────────────────────────────────────────────────────────────

import { T, alpha } from "@/design/theme";

export const SEA = {
  app: "var(--color-app)",
  rail: "var(--color-rail)",
  shell: "var(--color-bg)",
  card: "var(--color-surface)",
  card2: "var(--color-surface2)",
  cardHi: "var(--color-raised)",
  /** Hairline between surfaces. Lighter than HOME_THEME.border — these grounds
   *  are much darker, so the app's 10% white edge disappears against them. */
  line: alpha(T.text, 0.14),
  lineSoft: alpha(T.text, 0.07),
} as const;
