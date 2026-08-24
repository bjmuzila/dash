// ─────────────────────────────────────────────────────────────────────────────
// Surface palette for the seasonality pages only.
//
// Deliberately NOT added to components/shared/homeTheme.ts. These values are
// darker and flatter than the app's frosted `panelBg`, and pushing them into
// the shared theme would restyle every card on every route as a side effect of
// a change to two pages. If this look is later adopted app-wide, promote it
// there in one deliberate commit — do not let it leak.
//
// Six steps, darkest outward:
//   app    the page ground, behind everything
//   rail   the section nav, one step up so it reads as chrome not content
//   shell  the pane the cards sit on
//   card   a card's own fill
//   card2  a tile or an open disclosure INSIDE a card
//   cardHi a hovered or selected surface
//
// Cards are painted through SeaCard's inline style because the shared `Card`
// sets its background inline, and an inline style cannot be overridden by a
// class. That is also why these are TS constants rather than CSS variables.
// ─────────────────────────────────────────────────────────────────────────────

export const SEA = {
  app: "#020304",
  rail: "#040507",
  shell: "#07080b",
  card: "#0f1117",
  card2: "#14171d",
  cardHi: "#191b22",
  /** Hairline between surfaces. Lighter than HOME_THEME.border — these grounds
   *  are much darker, so the app's 10% white edge disappears against them. */
  line: "rgba(255,255,255,0.14)",
  lineSoft: "rgba(255,255,255,0.07)",
} as const;
