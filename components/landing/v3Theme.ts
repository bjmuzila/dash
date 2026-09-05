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

export const V3_SANS =
  "var(--font-inter), 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const V3_MONO = "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace";

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

/** The primary action. Solid accent, square-ish — a v3 control, not a pill. */
export const v3PrimaryButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "12px 22px",
  borderRadius: V3_RADIUS.md,
  border: `1px solid ${V3.cyan}`,
  background: V3.cyan,
  color: V3.fg,
  fontSize: V3_TEXT.base,
  fontWeight: 700,
  letterSpacing: "0.03em",
  textDecoration: "none",
  whiteSpace: "nowrap",
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
