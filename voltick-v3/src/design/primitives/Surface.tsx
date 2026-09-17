import type { CSSProperties, MouseEvent, ReactNode, Ref } from 'react'
import { alpha, SHADOW } from '@/design/theme'

// ─────────────────────────────────────────────────────────────────────────────
// THE ONLY FLOATING PLATE.
//
// Card's rule — "anything with a border and a background is a Card" — held for
// panels that sit IN the page and quietly failed for everything that floats
// above it. A modal shell, a dropdown menu, a hover card and a chart tooltip
// are the same object (an opaque plate lifted off the page) and every one of
// them drew its own: radius 14, 12, 8 and 6, three different shadows, two
// different fills, and a 2px accent edge on some but not others. Nothing was
// off-palette — the corners just never agreed, and that is what reads as four
// different apps.
//
// This is that plate, once.
//
// ── Why not Card, and why not Controls.tsx's Popover ─────────────────────────
// A Card is a TITLED REGION OF A PAGE: header slot, padded body, toolbar
// portal. A tooltip that borrows all of that spends its life fighting the
// parts it does not want.
//
// `Popover` in design/primitives/Controls.tsx is the other half of this and is
// deliberately a different thing: it owns BEHAVIOUR — open state, outside
// click, anchoring, viewport clamping, the phone sheet. Surface owns nothing
// but the plate. A component that needs both composes them; most callers here
// already do their own anchoring and need only this.
//
// Surface is unopinionated about POSITION. Fixed, absolute, portalled,
// anchored — the caller's problem, and it comes in through `style`. What
// Surface owns is fill, edge, radius and elevation. Do not restyle those at a
// call site: if a surface genuinely needs something this does not offer, add it
// here so every other one gets it too.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How far off the page the plate sits.
 *
 * `menu` is the default and covers the common case — a dropdown, a hover card,
 * a tooltip: close to the content, a shadow that reads as "on top of" rather
 * than "in front of".
 *
 * `modal` is for a surface with a scrim behind it. Heavier, because it has to
 * hold its own against a dimmed full-page backdrop where the menu shadow
 * disappears entirely.
 */
export type SurfaceElevation = 'menu' | 'modal'

export interface SurfaceProps {
  /** Elevation. See SurfaceElevation. Defaults to `menu`. */
  elevation?: SurfaceElevation
  /**
   * Remove the body padding — for menus whose rows paint their own full-width
   * hit area, and for anything that goes edge to edge.
   */
  flush?: boolean
  /**
   * Position, width, z-index, max-height — everything about WHERE this sits.
   * Not a licence to restyle the plate.
   */
  style?: CSSProperties
  className?: string
  role?: string
  /** For the outside-click handlers these surfaces all register. */
  ref?: Ref<HTMLDivElement>
  onClick?: (e: MouseEvent) => void
  children: ReactNode
}

const ELEVATION: Record<SurfaceElevation, string> = {
  menu: `0 12px 32px ${alpha(SHADOW, 0.42)}`,
  modal: `0 24px 60px ${alpha(SHADOW, 0.55)}`,
}

export function Surface({
  elevation = 'menu',
  flush = false,
  style,
  className = '',
  role,
  ref,
  onClick,
  children,
}: SurfaceProps) {
  return (
    <div
      ref={ref}
      role={role}
      onClick={onClick}
      style={{ boxShadow: ELEVATION[elevation], ...style }}
      className={[
        'overflow-hidden rounded-lg border border-line bg-surface',
        flush ? '' : 'p-3',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  )
}
