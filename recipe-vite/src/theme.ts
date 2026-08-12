import type { CSSProperties } from 'react'

/**
 * recipe-vite design system — CB Edge palette, editorial layout.
 *
 * A VERBATIM COPY of budget-vite/src/theme.ts, plus `minutes()` at the bottom.
 * Copied rather than imported for the same reason the auth screens are: the two
 * apps build and deploy independently, and a shared module would let a change
 * for the budget screens break the cookbook's build. Keep them in step by hand
 * — if you retune a colour there, bring it here.
 *
 * The one thing this app does NOT inherit is a light surface. An earlier draft
 * of the cookbook was warm paper, on the theory that a recipe is read in a
 * bright kitchen and food photographs better on white. It looked like a
 * different product sitting next to budget.cbedge.net, which is the app it
 * shares a login, a grocery list and a week board with. Consistency won.
 *
 *
 * The COLOURS are the dashboard's (components/shared/homeTheme.ts): near-black
 * surfaces, cyan, orange, the same red. The STRUCTURE is the editorial one from
 * the reference app. Four rules make it hold together:
 *
 *   1. Colour has a job or it isn't used. `accent` = live/interactive,
 *      `warn` = needs attention, `bad` = failed, `good` = complete. Nothing is
 *      coloured for decoration, which is what separates this from a dashboard
 *      that colours everything.
 *   2. Cards, not hairline rules. Every section is a bounded surface: the same
 *      faint cyan wash over a translucent panel the dashboard draws
 *      (components/shared/PageCard.tsx), a hairline border and an 18px radius.
 *      This replaced the original "1px top rule and whitespace" treatment in
 *      2026-08 — on a phone the rules read as one continuous column and the eye
 *      had nothing to stop against, so where one section ended and the next
 *      began was guesswork. Fills INSIDE a card are still the exception
 *      (compose box, active segment).
 *   3. Serif for VALUES, mono for LABELS. A number you read is Newsreader and
 *      large; the word describing it is 10px mono uppercase and muted. Swapping
 *      those two is what makes a layout look like generic admin.
 *   4. No bold-for-emphasis. Hierarchy comes from size, case and colour.
 *
 * NOTE the token NAMES are inherited from the light version — `ink` means
 * FOREGROUND and `paper` means BACKGROUND, so on dark, ink is near-white. Every
 * helper below reads correctly under that inversion (a "done" checkbox is
 * filled `ink` with a `paper` tick, i.e. white with a dark check).
 *
 * Values mirror homeTheme.ts and the deeper surface set app/owner/budget uses,
 * but the two files are deliberately NOT shared — this app builds standalone.
 */

export const T = {
  // Surfaces — the dashboard's near-black set.
  paper: '#05060A',                    // page background (homeTheme.bg)
  paperRaised: '#0D1119',              // compose boxes, inputs (homeTheme.panel)
  paperSunk: 'rgba(255,255,255,0.07)', // progress tracks, empty history squares

  // Foreground. Named "ink" from the light original — on dark it's near-white.
  //
  // ALL FOUR ARE WHITE, deliberately. The dashboard does the same thing —
  // homeTheme.ts has `muted: "#FFFFFF"` — because grey-on-near-black is hard to
  // read on a phone outdoors, which is where this app actually gets used.
  // Hierarchy therefore comes from SIZE, CASE and WEIGHT, never from dimming
  // the text. `faint` keeps a little transparency for one job only: struck-out
  // completed rows, where fading is the whole signal.
  ink: '#FFFFFF',
  inkSoft: '#FFFFFF',                  // body text that isn't primary
  muted: '#FFFFFF',                    // labels, metadata
  faint: 'rgba(255,255,255,0.55)',     // completed/struck text, placeholders

  // Live / interactive. CB Edge's light cyan — legible as small text on black,
  // which #219EBC is not.
  accent: '#8ECAE6',
  accentSoft: 'rgba(142,202,230,0.35)',

  // Needs attention. The dashboard's orange, used for overdue and slipping —
  // things you should act on but that are not errors.
  warn: '#FB8501',
  good: '#8ECAE6',
  bad: '#EF4444',

  rule: 'rgba(255,255,255,0.09)',      // hairline divider
  ruleStrong: 'rgba(255,255,255,0.17)', // section boundary, input border

  // The dashboard's shell glow, faint enough not to fight the hairlines.
  glow:
    'radial-gradient(900px 480px at 12% -8%, rgba(33,158,188,0.10) 0%, transparent 60%), ' +
    'radial-gradient(760px 420px at 88% 4%, rgba(125,211,252,0.06) 0%, transparent 55%)',
} as const

export const SERIF = "'Newsreader', 'Iowan Old Style', Georgia, 'Times New Roman', serif"
export const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
export const SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif"

// ── Type ─────────────────────────────────────────────────────────────────────

/** Page title. Serif, large, tight. One per screen. */
export const display = (size = 30): CSSProperties => ({
  fontFamily: SERIF,
  fontSize: size,
  // 500 not 600: light-on-dark blooms optically, so the same weight that looked
  // right on cream reads chunky here.
  fontWeight: 500,
  letterSpacing: '-0.015em',
  lineHeight: 1.1,
  color: T.ink,
  margin: 0,
})

/** The hero metric — a number you read at a glance. Serif, oversized. */
export const hero = (size = 44): CSSProperties => ({
  fontFamily: SERIF,
  fontSize: size,
  fontWeight: 400,
  lineHeight: 1,
  letterSpacing: '-0.02em',
  color: T.ink,
})

/**
 * THE label style. Tiny, uppercase, letterspaced monospace.
 * Every section heading, every piece of metadata, every text button.
 */
export const label = (extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: MONO,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: T.muted,
  ...extra,
})

/**
 * A SECTION TITLE. Sans, 17px, semibold — big enough to find while scrolling
 * one-handed, which 10px letterspaced mono was not. The count or status on the
 * right-hand side of a section stays `label()`: it is metadata, and promoting
 * both would flatten the hierarchy the size difference creates.
 */
export const sectionTitle = (extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: SANS,
  fontSize: 17,
  fontWeight: 600,
  letterSpacing: '-0.01em',
  lineHeight: 1.25,
  color: T.ink,
  ...extra,
})

/** Body copy. */
export const body = (size = 14): CSSProperties => ({
  fontFamily: SANS,
  fontSize: size,
  lineHeight: 1.5,
  color: T.ink,
})

/** Pulled quotes and saved notes — the one place italic serif earns its keep. */
export const quote = (): CSSProperties => ({
  fontFamily: SERIF,
  fontSize: 16,
  fontStyle: 'italic',
  lineHeight: 1.55,
  color: T.ink,
})

// ── Structure ────────────────────────────────────────────────────────────────

/**
 * A section — the default container for EVERY page.
 *
 * This is a card: the dashboard's surface (a faint cyan wash from the top edge
 * over a translucent panel), a hairline border, an 18px radius. Changing this
 * one helper is what converts all of Today, Todo, Lists, Money, Projects,
 * Routines and Settings at once — nothing else defines a page container.
 *
 * Radius 18 rather than `card()`'s 16: these are full-bleed containers on a
 * 390px screen and the slightly softer corner keeps them from reading as
 * buttons. `card()` stays 16 for the small dense surfaces inside the Money
 * screen, which nest inside these.
 *
 * DO NOT nest one section() in another — a card inside a card has two borders
 * and two washes and looks like a rendering bug. Inside a section, use `row()`,
 * `tile()` or a plain div.
 */
export const section = (extra: CSSProperties = {}): CSSProperties => ({
  background:
    'radial-gradient(circle at 50% 0%, rgba(33,158,188,0.07) 0%, transparent 55%), rgba(13,17,25,0.55)',
  border: `1px solid ${T.rule}`,
  borderRadius: 18,
  padding: 15,
  ...extra,
})

/** A row inside a list. Separated from its neighbour by a hairline. */
export const row = (extra: CSSProperties = {}): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 0',
  borderTop: `1px solid ${T.rule}`,
  ...extra,
})

/**
 * A dashboard CARD — the same surface `components/shared/PageCard.tsx` draws on
 * cbedge.net: a faint cyan wash from the top edge over a translucent panel,
 * hairline border, 16px radius.
 *
 * This is the container the Money page uses. Everywhere else still uses
 * `section()` (a rule and whitespace) — the money screen is dense enough that
 * the figures need boxing, the task screens are not.
 */
export const card = (extra: CSSProperties = {}): CSSProperties => ({
  background:
    'radial-gradient(circle at 50% 0%, rgba(33,158,188,0.07) 0%, transparent 55%), rgba(13,17,25,0.55)',
  border: `1px solid ${T.rule}`,
  borderRadius: 16,
  padding: 14,
  ...extra,
})

/** A small stat card. Lighter top edge instead of the cyan wash, so a row of
 *  six doesn't turn the page into a wall of glow. */
export const tile = (extra: CSSProperties = {}): CSSProperties => ({
  background:
    'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 34%), rgba(13,17,25,0.55)',
  border: `1px solid ${T.rule}`,
  borderRadius: 13,
  padding: '11px 10px',
  minWidth: 0,
  ...extra,
})

/** The rare raised surface: compose boxes, empty-state panels. */
export const panel = (extra: CSSProperties = {}): CSSProperties => ({
  background: T.paperRaised,
  border: `1px solid ${T.rule}`,
  borderRadius: 4,
  padding: 14,
  ...extra,
})

// ── Controls ─────────────────────────────────────────────────────────────────

/**
 * The default "button" here is TEXT — mono caps with a chevron or plus, no box.
 * Reserve the filled variant for the single primary action on a screen.
 */
export const textAction = (extra: CSSProperties = {}): CSSProperties => ({
  ...label(),
  color: T.accent,
  background: 'none',
  border: 'none',
  padding: '10px 0',
  minHeight: 40,
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  ...extra,
})

export const button = (variant: 'primary' | 'ghost' = 'primary'): CSSProperties => ({
  appearance: 'none',
  fontFamily: MONO,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  // 44px minimum: below that a target is genuinely hard to hit on a phone.
  minHeight: 44,
  padding: '12px 18px',
  borderRadius: 3,
  cursor: 'pointer',
  background: variant === 'primary' ? T.ink : 'transparent',
  color: variant === 'primary' ? T.paper : T.ink,
  border: variant === 'primary' ? `1px solid ${T.ink}` : `1px solid ${T.ruleStrong}`,
})

/** Segmented control. The active segment is filled ink — the one solid fill. */
export const segment = (active: boolean): CSSProperties => ({
  appearance: 'none',
  fontFamily: MONO,
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  minHeight: 34,
  padding: '7px 11px',
  borderRadius: 3,
  cursor: 'pointer',
  background: active ? T.ink : 'transparent',
  color: active ? T.paper : T.muted,
  border: `1px solid ${active ? T.ink : T.ruleStrong}`,
})

export const input = (): CSSProperties => ({
  width: '100%',
  boxSizing: 'border-box',
  background: T.paperRaised,
  border: `1px solid ${T.ruleStrong}`,
  borderRadius: 3,
  color: T.ink,
  minHeight: 44,
  padding: '12px 12px',
  // 16px exactly: iOS Safari zooms the page when a focused input is smaller.
  fontSize: 16,
  fontFamily: SANS,
  outline: 'none',
})

/**
 * The checkbox. A small square; done is a solid ink fill with a paper tick.
 * Square, not round — the reference uses squares, and a circle reads as a radio.
 */
export const checkbox = (done: boolean, size = 20): CSSProperties => ({
  flexShrink: 0,
  width: size,
  height: size,
  padding: 0,
  borderRadius: 2,
  cursor: 'pointer',
  background: done ? T.ink : 'transparent',
  border: `1.5px solid ${done ? T.ink : T.ruleStrong}`,
  color: T.paper,
  display: 'grid',
  placeItems: 'center',
  fontSize: size * 0.6,
  lineHeight: 1,
})

/** Completed text: struck through and faded, never removed. */
export const doneText = (done: boolean): CSSProperties => ({
  color: done ? T.faint : T.ink,
  textDecoration: done ? 'line-through' : 'none',
})

// ── Bits ─────────────────────────────────────────────────────────────────────

/** A thin progress rule. Sits under a hero number, not inside a card. */
export const track = (extra: CSSProperties = {}): CSSProperties => ({
  height: 3,
  background: T.paperSunk,
  borderRadius: 2,
  overflow: 'hidden',
  ...extra,
})

export const fill = (pct: number, colour: string = T.accent): CSSProperties => ({
  width: `${Math.max(0, Math.min(100, pct))}%`,
  height: '100%',
  background: colour,
  transition: 'width 160ms',
})

/** Colour for a due/overdue chip. Orange means "act", not "error". */
export const dueColour = (overdue: boolean) => (overdue ? T.warn : T.muted)

// ── Recipe-specific ──────────────────────────────────────────────────────────

/** "1h 25m", "45m", "—". The time format on every card and stat row. */
export function minutes(n: number | null | undefined): string {
  if (!n || n <= 0) return '—'
  const h = Math.floor(n / 60)
  const m = n % 60
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}
