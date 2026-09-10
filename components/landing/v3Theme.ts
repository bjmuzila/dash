import type { CSSProperties } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// THE v3 THEME, MIRRORED FOR THE PUBLIC PAGES.
//
// The landing page, /explore/* and the public nav are Next-rendered and live in
// the v2 tree. `cbedge-v3/` is a clean-slate app with its own package.json and
// no `@/app/...` alias in either direction (cbedge-v3/AGENTS.md, "What this
// is"), so these pages CANNOT import `@/design/theme` or read tokens.css —
// there is no module path from here to there and adding one would break the
// one rule that app exists to enforce.
//
// So the values below are a TRANSCRIPTION of `cbedge-v3/src/design/tokens.css`,
// not a second palette. Every entry names the token it came from. If a token
// moves there, move it here; nothing else in the public tree may type a colour.
//
// WHAT "v3 THEME" MEANS ON THESE PAGES, concretely:
//
//   1. FLAT, NOT GLASS. v3's Card primitive is `rounded-md border border-line
//      bg-surface` — an 8px radius, an OPAQUE #23272e hairline and an opaque
//      #0f1117 plate. No backdrop-filter, no gradient fills, no glow rings.
//      The old landing was four translucent 20px-radius panels over a blurred
//      screenshot with cyan bloom on every edge; none of that survives.
//   2. TEXT IS WHITE. `--color-fg`, `--color-muted` and `--color-faint` all
//      resolve to #ffffff (tokens.css, "Text": *"All white per Brandon
//      2026-08-27 — the grey secondary/faint tones read too dim"*). The public
//      pages had already set HOME_THEME.muted to white and then dimmed it again
//      with `opacity: 0.55…0.85` on almost every paragraph, which is the same
//      grey arriving by a different door. There is no text opacity in this
//      file and none in the pages that use it.
//   3. THE SURFACE LADDER IS THE ONLY DEPTH. bg → surface → surface2 → raised.
//      A nested block gets the next step up, never a wash of the accent.
//
// The ONE thing carried over from v2 is the accent hue: #219ebc, the brand
// cyan. v3 keeps it as `--color-v2-cyan` and puts it on every card title, so
// this is not a departure — it is the token that already means "CB Edge" on a
// v3 surface. v3's own `--color-accent` (#5b8cff) is a UI blue for controls and
// would read as a different company on a marketing page.
// ─────────────────────────────────────────────────────────────────────────────

export const V3 = {
  /* Surfaces — tokens.css "Surfaces", the settled dark-slate ramp. */
  app: "#020304", // --color-app
  rail: "#040507", // --color-rail
  bg: "#07080b", // --color-bg      page canvas
  surface: "#0f1117", // --color-surface  cards
  surface2: "#14171d", // --color-surface2 nested rows / table heads
  raised: "#191b22", // --color-raised   hover / elevated
  line: "#23272e", // --color-line     borders and dividers

  /* Text — all white. See note 2 above. */
  fg: "#ffffff", // --color-fg
  muted: "#ffffff", // --color-muted
  faint: "#ffffff", // --color-faint

  /* Semantic */
  up: "#35c28e", // --color-up
  down: "#e0645f", // --color-down
  flat: "#7a828d", // --color-flat  (a MARK colour, never body text)
  accent: "#5b8cff", // --color-accent
  warn: "#e0a44a", // --color-warn
  violet: "#a78bfa", // --color-violet

  /* Key levels — tokens.css "Key levels". cb = Core, cw = call wall, pw = put */
  levelCb: "#ffd600", // --color-level-cb
  levelCw: "#29b6f6", // --color-level-cw
  levelPw: "#ff4757", // --color-level-pw

  /* The v2 leg v3 carries verbatim, for brand + hit/miss. */
  cyan: "#219ebc", // --color-v2-cyan   the accent on every v3 card title
  orange: "#fb8501", // --color-v2-orange partner / third-party only
  red: "#ef4444", // --color-v2-red
  pos: "#22c55e", // --color-v2-pos    a positive figure
  refresh: "#1fd98a", // --color-v2-refresh "live / success"
  purple: "#126783", // --color-v2-purple

  shadow: "#000000", // --color-shadow
} as const;

/* Type scale — tokens.css "Type scale". Numbers, because these pages style
   inline and cannot reach a Tailwind utility. Nothing here may invent a size:
   a value not on this list is a bug, the same as it would be inside v3. */
export const V3_TEXT = {
  xxs: 9, // --text-3xs  badge ink, micro labels
  xs: 10, // --text-2xs  column heads, chips, note lines
  sm: 11, // --text-xs   dense cells
  base: 13, // --text-sm   DEFAULT UI text
  body: 15, // --text-base body copy
  lg: 18, // --text-lg   card titles
  xl: 24, // --text-xl   stat values
  xxl: 32, // --text-2xl  hero numbers
} as const;

/* Shape — tokens.css "Shape". A card is `md`. Nothing on these pages is
   rounder than `lg`; the 18–20px pills the old landing used are not v3. */
export const V3_RADIUS = { sm: 4, md: 8, lg: 12 } as const;

/* NOTE ON `--font-inter` (2026-09-10). Inter is NOT loaded any more: the web
   font was dropped for instant paint, and globals.css now aliases
   `--font-inter: var(--font-sans)`, the native system stack. The name is kept
   here so the two files stay legibly connected, but assume Segoe UI on Windows
   and San Francisco on macOS when you set a size or a tracking value — Inter's
   metrics are NOT what ships. Anything on this page that needs tight tracking
   is tuned for the system faces; see the display-type note in LandingClient. */
export const V3_SANS =
  "var(--font-inter), 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const V3_MONO = "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace";

/**
 * V3_NUM — the face for A NUMBER THE VISITOR READS. Not a font stack: a style
 * fragment, spread in (`...V3_NUM`) where `fontFamily: V3_MONO` used to sit.
 *
 * WHY, because it reads like a downgrade and is not. V3_MONO is a real
 * monospace, so every glyph gets one fixed advance — including `.` and `,`,
 * which are narrow glyphs sitting in a wide box. At the 10-13px label sizes
 * that is invisible and the alignment is worth it. At the 24-48px display
 * sizes on this page it is not: "66.8%" renders as "66 . 8%" and "7,590" as
 * "7 , 590", a hole either side of the punctuation. It was the loudest thing
 * on the page that read as broken typography (Brandon, 2026-09-10).
 *
 * `tabular-nums` takes the ONE property those big numbers actually wanted from
 * mono — every digit the same width, so a ticking level does not jitter and a
 * column of them still lines up — out of the sans face, where the comma and
 * the period keep their own narrow width. `lining-nums` is belt-and-braces: a
 * face whose default figures are old-style would drop the 7 and the 9 below
 * the baseline in a 48px headline.
 *
 * MONO STAYS on: uppercase letter-spaced labels and chips (HIT, PIVOT,
 * SPX · CORE, the column heads) and the ledger's own table cells — the fixed
 * advance is doing real work there and nothing is over ~13px.
 */
export const V3_NUM: CSSProperties = {
  fontFamily: V3_SANS,
  fontVariantNumeric: "tabular-nums lining-nums",
  fontFeatureSettings: '"tnum" 1, "lnum" 1',
};

/**
 * alpha() — v3's own helper, same job: a token plus an alpha channel, for the
 * places CSS needs rgba (a tint behind a chip, a shadow). It takes a value from
 * V3 and nothing else; a literal passed in here defeats the point of the file.
 */
export function v3a(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ── The three surfaces every public page draws with ─────────────────────── */

/** The page canvas. Flat — v3 has no page gradient. */
export const v3PageStyle: CSSProperties = {
  background: V3.bg,
  color: V3.fg,
  fontFamily: V3_SANS,
};

/** THE card. v3's `rounded-md border border-line bg-surface`, as a style. */
export const v3CardStyle: CSSProperties = {
  background: V3.surface,
  border: `1px solid ${V3.line}`,
  borderRadius: V3_RADIUS.md,
};

/**
 * THE SAME CARD, GIVEN ITS EDGES BACK (2026-09-10, Brandon: "some of them just
 * seem to blend in").
 *
 * v3CardStyle is #0f1117 on #07080b behind a #23272e hairline. Inside the app
 * that is right — a dashboard is dense, the cards touch, and every one of those
 * hairlines is a divider doing work. A marketing page is the opposite shape:
 * five big plates floating in a lot of empty canvas, where a 3% luminance step
 * is not a card, it is a smudge. On a bright monitor the sections simply did
 * not read as separate objects.
 *
 * Three changes, all of them inside the existing token set — this is NOT a new
 * card style, it is the same card with more room around it:
 *
 *   1. THE GROUND DROPS, not the plate. The page canvas moves from --color-bg
 *      (#07080b) to --color-app (#020304), the token v3 already uses for the
 *      layer BEHIND everything. The card stays exactly #0f1117, so the step is
 *      roughly tripled without touching a single surface value or inventing a
 *      colour. Cheapest possible fix and the one that does most of the work.
 *   2. The hairline goes to a 9% white, which reads as an EDGE at this scale
 *      where #23272e read as a seam. Derived from --color-fg through v3a, so
 *      there is still no literal in the tree.
 *   3. A cast shadow, plus a 1px inset highlight along the top. This is the
 *      only place the "v3 does not bloom" rule bends, and it bends in the legal
 *      direction: a shadow is an object sitting ON something, which is what a
 *      card is. It is NOT a glow — no accent in it, nothing outside the box
 *      lighting up, the same black --color-shadow already names.
 *
 * Use it for a full-width SECTION plate. Cards nested inside one (feature
 * tiles, the receipts stats) stay on v3CardStyle / v3InsetStyle: stacking a
 * second shadow inside the first is exactly the glassy v2 look v3 removed.
 */
export const v3CardStrongStyle: CSSProperties = {
  background: V3.surface,
  border: `1px solid ${v3a(V3.fg, 0.09)}`,
  borderRadius: V3_RADIUS.md,
  boxShadow: `inset 0 1px 0 ${v3a(V3.fg, 0.045)}, 0 16px 36px -14px ${v3a(V3.shadow, 0.95)}`,
};

/** A nested block INSIDE a card — one step up the ladder, never a tint. */
export const v3InsetStyle: CSSProperties = {
  background: V3.surface2,
  border: `1px solid ${V3.line}`,
  borderRadius: V3_RADIUS.sm,
};

/** A card header row: v3 draws it as a bottom hairline, nothing else. */
export const v3CardHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  padding: "10px 14px",
  borderBottom: `1px solid ${V3.line}`,
};

/** The card title's own type — v3: `text-sm font-medium text-muted`. */
export const v3CardTitleStyle: CSSProperties = {
  fontSize: V3_TEXT.base,
  fontWeight: 500,
  color: V3.fg,
  letterSpacing: "0.02em",
};

/** A small uppercase chip. `tone` tints the plate and inks the text. */
export function v3Chip(tone: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 9px",
    borderRadius: V3_RADIUS.sm,
    border: `1px solid ${v3a(tone, 0.4)}`,
    background: v3a(tone, 0.12),
    color: tone,
    fontFamily: V3_MONO,
    fontSize: V3_TEXT.xs,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  };
}

/** The primary action. Solid accent, square-ish — a v3 control, not a pill.
 *
 *  INK IS V3.bg, NOT V3.fg (2026-09-10). White on #219ebc measures 3.1:1,
 *  under WCAG AA for the 15px CTA and the 11px nav button. The page canvas
 *  tone on cyan is ~6:1 and is already what /pricing's join button did. */
export const v3PrimaryButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "12px 22px",
  borderRadius: V3_RADIUS.md,
  border: `1px solid ${V3.cyan}`,
  background: V3.cyan,
  color: V3.bg,
  fontSize: V3_TEXT.base,
  fontWeight: 700,
  letterSpacing: "0.03em",
  textDecoration: "none",
  whiteSpace: "nowrap",
  // Lifts the button off the plate the way v3CardStrongStyle lifts the plate
  // off the canvas — a cast shadow in the accent's own hue, not a glow ring.
  // It is what makes the control read as pressable rather than as a coloured
  // rectangle. Kept tight and downward; nothing bleeds sideways.
  boxShadow: `0 6px 16px -6px ${v3a(V3.cyan, 0.55)}`,
};

/** The secondary action. Raised plate, hairline edge. */
export const v3GhostButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "12px 20px",
  borderRadius: V3_RADIUS.md,
  border: `1px solid ${V3.line}`,
  background: V3.raised,
  color: V3.fg,
  fontSize: V3_TEXT.base,
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

/** A text input on a public page — inset plate, hairline, no glow. */
export const v3InputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "12px 14px",
  borderRadius: V3_RADIUS.md,
  border: `1px solid ${V3.line}`,
  background: V3.surface2,
  color: V3.fg,
  fontSize: V3_TEXT.body,
  fontFamily: V3_SANS,
  outline: "none",
};

/** An inline text link. Accent, no underline until hover (pages add that). */
export const v3LinkStyle: CSSProperties = {
  color: V3.cyan,
  textDecoration: "none",
  fontWeight: 600,
};
