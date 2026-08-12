import type { CSSProperties } from 'react'

/**
 * recipe-vite design system — warm paper, editorial serif.
 *
 * Same helper API as budget-vite (T, display, label, section, button, input …)
 * so the auth screens are a straight copy and stay in sync. The PALETTE is not
 * the same and shouldn't be: budget is a near-black dashboard you check, this
 * is a cookbook you cook from. A dark screen in a bright kitchen, held at
 * arm's length with wet hands, is the wrong surface — paper reads better under
 * overhead light and photographed food only looks like food on white.
 *
 * Four rules, inherited:
 *   1. Colour has a job. `accent` (terracotta) = the one action on the screen.
 *      Nothing is coloured for decoration.
 *   2. Cards, not hairline rules. Every section is a bounded surface.
 *   3. Serif for TITLES and numbers, mono for LABELS, sans for body.
 *   4. No bold-for-emphasis. Hierarchy is size, case and colour.
 *
 * Token names are the budget ones — `ink` is FOREGROUND, `paper` is BACKGROUND.
 * Here they mean what they say.
 */

export const T = {
  // Surfaces. Not pure white: #FCFBF9 is the warm off-white that keeps a page
  // of text from glaring, and it makes the true-white cards sit forward.
  paper: '#FCFBF9',
  paperRaised: '#FFFFFF',
  paperSunk: 'rgba(26,23,20,0.05)',

  // Foreground. Warm near-black, not #000 — pure black on warm paper reads as
  // a rendering artefact.
  ink: '#1A1714',
  inkSoft: '#3D3630',
  muted: '#8A7F75',
  faint: 'rgba(26,23,20,0.45)',

  // The one accent: terracotta. Reserved for the primary action (Cook, Make,
  // Save) and the active nav tab. If it shows up anywhere else, that's a bug.
  accent: '#E2734A',
  accentSoft: 'rgba(226,115,74,0.14)',

  warn: '#C77A2E',
  good: '#4F7A54',
  bad: '#C0392B',

  rule: 'rgba(26,23,20,0.08)',
  ruleStrong: 'rgba(26,23,20,0.15)',

  // A whisper of warmth at the top of the page, so a screen of white cards on
  // a white background still has a horizon.
  glow:
    'radial-gradient(900px 460px at 15% -10%, rgba(226,115,74,0.06) 0%, transparent 60%), ' +
    'radial-gradient(700px 380px at 88% 2%, rgba(201,168,120,0.05) 0%, transparent 55%)',

  // The soft lift under a card. One shadow, used everywhere — a second one at a
  // different blur is what makes a UI look assembled from templates.
  shadow: '0 1px 2px rgba(26,23,20,0.04), 0 8px 24px rgba(26,23,20,0.05)',
} as const

export const SERIF = "'Newsreader', 'Iowan Old Style', Georgia, 'Times New Roman', serif"
export const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
export const SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif"

// ── Type ─────────────────────────────────────────────────────────────────────

/** Page and recipe titles. Serif, large, tight. One per screen. */
export const display = (size = 30): CSSProperties => ({
  fontFamily: SERIF,
  fontSize: size,
  // 500 on light, where budget-vite uses 500 on dark for the opposite reason:
  // there it stops light text blooming, here it's simply where Newsreader's
  // optical size looks like a cookbook rather than a newspaper.
  fontWeight: 500,
  letterSpacing: '-0.015em',
  lineHeight: 1.12,
  color: T.ink,
  margin: 0,
})

/** A hero number — cook time, servings, the "01" on a discover card. */
export const hero = (size = 44): CSSProperties => ({
  fontFamily: SERIF,
  fontSize: size,
  fontWeight: 400,
  lineHeight: 1,
  letterSpacing: '-0.02em',
  color: T.ink,
})

/** THE label style. Tiny, uppercase, letterspaced mono. Every section heading,
 *  every piece of metadata, every text button. */
export const label = (extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: MONO,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: T.muted,
  ...extra,
})

export const sectionTitle = (extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: SERIF,
  fontSize: 20,
  fontWeight: 500,
  letterSpacing: '-0.01em',
  lineHeight: 1.25,
  color: T.ink,
  ...extra,
})

export const body = (size = 14): CSSProperties => ({
  fontFamily: SANS,
  fontSize: size,
  lineHeight: 1.55,
  color: T.inkSoft,
})

/** Recipe intro copy and headnotes — the one place italic serif earns its keep. */
export const quote = (): CSSProperties => ({
  fontFamily: SERIF,
  fontSize: 16,
  fontStyle: 'italic',
  lineHeight: 1.55,
  color: T.inkSoft,
})

// ── Structure ────────────────────────────────────────────────────────────────

/** A section — the default container for every page. */
export const section = (extra: CSSProperties = {}): CSSProperties => ({
  background: T.paperRaised,
  border: `1px solid ${T.rule}`,
  borderRadius: 18,
  padding: 16,
  boxShadow: T.shadow,
  ...extra,
})

/** A smaller card. Nests inside a section only when it must. */
export const card = (extra: CSSProperties = {}): CSSProperties => ({
  background: T.paperRaised,
  border: `1px solid ${T.rule}`,
  borderRadius: 14,
  padding: 14,
  boxShadow: T.shadow,
  ...extra,
})

/** A stat cell — skill level, cook time, ingredient count. No border: these sit
 *  in a row inside a card and boxing each one turns the row into a grid. */
export const tile = (extra: CSSProperties = {}): CSSProperties => ({
  minWidth: 0,
  ...extra,
})

export const panel = (extra: CSSProperties = {}): CSSProperties => ({
  background: T.paper,
  border: `1px solid ${T.rule}`,
  borderRadius: 10,
  padding: 14,
  ...extra,
})

export const row = (extra: CSSProperties = {}): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 0',
  borderTop: `1px solid ${T.rule}`,
  ...extra,
})

// ── Controls ─────────────────────────────────────────────────────────────────

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

/**
 * primary = the terracotta pill (Cook, Save, Import). ONE per screen.
 * ghost    = everything else.
 */
export const button = (variant: 'primary' | 'ghost' = 'primary'): CSSProperties => ({
  appearance: 'none',
  fontFamily: SANS,
  fontSize: 14,
  fontWeight: 500,
  letterSpacing: '0.01em',
  // 44px minimum: below that a target is genuinely hard to hit on a phone.
  minHeight: 44,
  padding: '12px 20px',
  borderRadius: 12,
  cursor: 'pointer',
  background: variant === 'primary' ? T.accent : T.paperRaised,
  color: variant === 'primary' ? '#FFFFFF' : T.ink,
  border: `1px solid ${variant === 'primary' ? T.accent : T.ruleStrong}`,
})

/** Segmented control / filter chip. The active one is filled ink. */
export const segment = (active: boolean): CSSProperties => ({
  appearance: 'none',
  fontFamily: SANS,
  fontSize: 13,
  fontWeight: 500,
  minHeight: 34,
  padding: '7px 14px',
  borderRadius: 999,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  background: active ? T.ink : 'transparent',
  color: active ? T.paper : T.muted,
  border: `1px solid ${active ? T.ink : T.rule}`,
})

export const input = (): CSSProperties => ({
  width: '100%',
  boxSizing: 'border-box',
  background: T.paperRaised,
  border: `1px solid ${T.ruleStrong}`,
  borderRadius: 10,
  color: T.ink,
  minHeight: 44,
  padding: '12px 13px',
  // 16px exactly: iOS Safari zooms the page when a focused input is smaller.
  fontSize: 16,
  fontFamily: SANS,
  outline: 'none',
})

export const checkbox = (done: boolean, size = 20): CSSProperties => ({
  flexShrink: 0,
  width: size,
  height: size,
  padding: 0,
  borderRadius: 6,
  cursor: 'pointer',
  background: done ? T.ink : 'transparent',
  border: `1.5px solid ${done ? T.ink : T.ruleStrong}`,
  color: T.paper,
  display: 'grid',
  placeItems: 'center',
  fontSize: size * 0.6,
  lineHeight: 1,
})

export const doneText = (done: boolean): CSSProperties => ({
  color: done ? T.faint : T.ink,
  textDecoration: done ? 'line-through' : 'none',
})

// ── Bits ─────────────────────────────────────────────────────────────────────

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

/** "1h 25m", "45m", "—". The time format used on every card and stat row. */
export function minutes(n: number | null | undefined): string {
  if (!n || n <= 0) return '—'
  const h = Math.floor(n / 60)
  const m = n % 60
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}
