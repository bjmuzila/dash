// ─────────────────────────────────────────────────────────────────────────────
// v3's palette, transcribed for the v2 tree.
//
// WHY THIS EXISTS, given "never hardcode hex, source colours from homeTheme.ts".
// homeTheme IS the v2 look, and the bar these values dress — V3LegacyToolbar —
// exists precisely so a v2 page does not look like v2 any more. Dressing it in
// homeTheme would defeat the point of drawing it.
//
// It cannot import the real thing. v3's tokens live in
// cbedge-v3/src/design/tokens.css as CSS custom properties inside a Tailwind v4
// `@theme` block, in an app with its own package.json, its own node_modules and
// a hard rule that it shares NO code with v2 — in either direction. A CSS import
// across that line would also drag Tailwind v4 into a Tailwind v3 build, which
// is the exact failure cbedge-v3/AGENTS.md's "two traps" section documents.
//
// So this is a one-way, hand-kept copy of the handful of tokens ONE component
// needs. Values transcribed 2026-09-06 from tokens.css. If v3's palette moves,
// this bar goes slightly stale — a cosmetic drift on the legacy wing, which is
// the cheapest possible place for it. Anything more than a toolbar's worth of
// v3 look inside v2 is the wrong answer; port the page instead.
//
// NOTHING ELSE IN v2 MAY IMPORT THIS. It is not a second theme — it is one
// component's transcription. v2 UI sources colour from homeTheme.ts, still.
// ─────────────────────────────────────────────────────────────────────────────

export const V3_CHROME = {
  /** --color-bg — the dashboard canvas AND the toolbar band. */
  bg: "#07080b",
  /** --color-rail — the left icon rail; here, the Legacy menu's plate. */
  rail: "#040507",
  /** --color-surface — cards and panels. */
  surface: "#0f1117",
  /** --color-surface2 — nested rows, table headers. */
  surface2: "#14171d",
  /** --color-raised — hovered / elevated surface. */
  raised: "#191b22",
  /** --color-line — borders and dividers. Opaque slate, not a white hairline. */
  line: "#23272e",
  /** --color-fg / --color-muted / --color-faint. All white since 2026-08-27;
   *  kept as three names because v3 keeps them as three tokens. */
  fg: "#ffffff",
  muted: "#ffffff",
  faint: "#ffffff",
  /** --color-accent — the active-nav and focus colour. */
  accent: "#5b8cff",
  /** --font-sans / --font-mono. */
  fontSans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontMono: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, monospace",
} as const;

/**
 * v3's type scale, in px. v3 forbids an off-scale size anywhere — see
 * non-negotiable 1 in cbedge-v3/AGENTS.md — and a bar wearing its palette while
 * setting 12px text would read as neither app.
 */
export const V3_TEXT = {
  xxxs: 9,
  xxs: 10,
  xs: 11,
  sm: 13,
  base: 15,
  lg: 18,
} as const;

/** --radius-sm / --radius-md. */
export const V3_RADIUS = { sm: 4, md: 8 } as const;

/** Opacity ladder for muted text, so the bar has a hierarchy despite one white. */
export const V3_DIM = { on: 1, off: 0.62, faint: 0.42 } as const;
