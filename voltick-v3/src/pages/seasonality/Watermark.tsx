// ─────────────────────────────────────────────────────────────────────────────
// The CB Edge mark on every seasonality card — v3's copy.
//
// PORTED FROM v2 (components/seasonality/Watermark.tsx) 2026-09-07 with the two
// v2 imports replaced, because v3 shares no code with v2 (cbedge-v3/AGENTS.md):
//
//   @/components/shared/PageCard  →  the local `Card` below. v2's Card carries
//     a `.card-hover` class that only exists in v2's globals.css and a variant
//     switch this page never uses; SeaCard overrides the fill and the edge
//     anyway, so what survives the override is a padded box with a title row.
//     That is what is reproduced here, inline, rather than dragging a shared
//     primitive across the wall for one caller.
//   @/lib/brand → BRAND_LOGO_SRC below. Same string, same asset: v3 is served
//     from the same origin as v2, so /cbedge3.0.png resolves from v2's public/.
//     Deliberately NOT src/assets/cbedge-mark.svg — that is the square badge,
//     and this corner wants the horizontal 3.0 lockup.
//
// ONE MARK PER CARD, top right, so exactly one appears in a screenshot. The
// lockup is white artwork on a transparent ground and only reads on the dark
// card underneath, which is the only place this is ever mounted.
// `pointerEvents: none` keeps it out of every hover target; `aria-hidden` keeps
// it out of the accessibility tree, because it is branding, not content.
// ─────────────────────────────────────────────────────────────────────────────

import type { CSSProperties, ReactNode } from 'react'
import { SEA } from './seaTheme'
import { HOME_THEME, classicCardAccentStyle } from './homeTheme'

/** The horizontal 3.0 lockup, served from the app's public root. */
const BRAND_LOGO_SRC = '/cbedge3.0.png'

/** Sits in the card's top-right corner, above the content. */
export function Watermark({ inset = 14 }: { inset?: number }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        top: inset,
        right: inset,
        pointerEvents: 'none',
        zIndex: 4,
        lineHeight: 0,
      }}
    >
      <img
        src={BRAND_LOGO_SRC}
        alt=""
        style={{ width: 104, height: 'auto', opacity: 0.34, userSelect: 'none', display: 'block' }}
      />
    </div>
  )
}

/**
 * The card surface these pages sit on. Kept private to this folder: it is v2's
 * Card with the parts SeaCard overrides already removed.
 */
function Card({
  title,
  subtitle,
  padding = 24,
  style,
  children,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  padding?: number | string
  style?: CSSProperties
  children?: ReactNode
}) {
  return (
    <div style={{ ...classicCardAccentStyle, padding, ...style }}>
      {(title != null || subtitle != null) && (
        <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {title != null && (
            <div
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 800,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: HOME_THEME.text,
              }}
            >
              {title}
            </div>
          )}
          {subtitle != null && <div style={{ fontSize: 'var(--text-xs)', color: HOME_THEME.green }}>{subtitle}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

/**
 * A themed Card with the mark in its corner. Every seasonality card goes
 * through this rather than `Card` directly, so no card can ship unmarked and
 * the mark's position is defined once.
 */
export function SeaCard({
  title,
  subtitle,
  padding = 20,
  style,
  children,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  padding?: number | string
  style?: CSSProperties
  children?: ReactNode
}) {
  return (
    <Card
      title={title}
      subtitle={subtitle}
      padding={padding}
      style={{
        position: 'relative',
        // Painted here, not by a class: the card sets its background INLINE,
        // and no stylesheet can beat that. See seaTheme.ts.
        background: SEA.card,
        border: `1px solid ${SEA.line}`,
        boxShadow: 'none',
        ...style,
      }}
    >
      <Watermark />
      {children}
    </Card>
  )
}

export default Watermark
