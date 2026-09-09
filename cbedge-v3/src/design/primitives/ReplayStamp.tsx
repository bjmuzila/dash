// ─────────────────────────────────────────────────────────────────────────────
// THE REPLAY STAMP — what this is, when it is, and whose it is, burned INTO the
// surface being replayed.
//
// ── Why it is not in the toolbar ────────────────────────────────────────────
// These surfaces are SCREEN-RECORDED. A recording is a crop of the pane, and a
// caption that lives in the page chrome above it is one crop away from being
// gone — so a clip of a rewound ladder becomes indistinguishable from a clip of
// a live one, which is the single worst way any of these can be misread. The
// stamp therefore rides the pane itself, at its top-left, and the brand mark
// rides the bottom-right. Both travel with the pixels.
//
// ── Two pieces, one layer ───────────────────────────────────────────────────
//   <ReplayStamp>  ticker · expiry chip · +N · session date · frame clock
//   <ReplayBrand>  the CB Edge wordmark
//   <ReplayStampLayer>  both, absolutely positioned over a `relative` parent
//
// `pointerEvents: none` throughout — the stamp sits over a scrubbable, hoverable
// surface and must never intercept a click meant for a strike or a candle.
//
// Every replay surface in v3 mounts the same component, so the four tabs of
// /v3/replay caption themselves identically instead of four times over.
// ─────────────────────────────────────────────────────────────────────────────

import type { CSSProperties, ReactNode } from 'react'
import { alpha, LIGHT_BLUE, T } from '@/design/theme'
import { CbWordmark } from '@/shell/Brand'

export interface ReplayStampProps {
  /** The subject. Printed even when everything else is unknown. */
  symbol: string
  /** `Sep 9` etc. Omit where the surface has no single expiry (a whole board). */
  expiryLabel?: string | null
  /** Draw the expiry chip as 0DTE — orange, and the word instead of the date. */
  zeroDte?: boolean
  /** Expiries summed beyond the one named, rendered as `+N`. */
  extraExpiries?: number
  /** `Tue, Sep 8` — the SESSION being replayed, never today. */
  dateLabel?: string | null
  /** `09:39:41 ET` — the FRAME's own wall clock. */
  clockLabel?: string | null
  /** One extra line, for a caveat the surface has to carry (`recorded walls only`). */
  note?: ReactNode
  /** Distance from the pane's left edge. Ladders pass their strike-gutter width. */
  left?: number
  /** Distance from the pane's top edge. */
  top?: number
}

/** Frosted so it stays legible over a bar, a candle or a lit row. */
const PLATE: CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'column',
  gap: 3,
  padding: '6px 10px',
  borderRadius: 8,
  background: alpha(T.bg, 0.62),
  border: `1px solid ${T.border}`,
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
}

export function ReplayStamp({
  symbol,
  expiryLabel,
  zeroDte = false,
  extraExpiries = 0,
  dateLabel,
  clockLabel,
  note,
  left = 8,
  top = 4,
}: ReplayStampProps) {
  const chipColor = zeroDte ? T.orange : LIGHT_BLUE
  const line2 = [dateLabel, clockLabel].filter(Boolean).join(' · ')
  return (
    <div style={{ position: 'absolute', left, top, zIndex: 6, pointerEvents: 'none', ...PLATE }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            fontSize: 'var(--text-base)',
            fontWeight: 800,
            letterSpacing: '0.08em',
            color: T.cyan,
            fontFamily: 'var(--font-mono)',
            lineHeight: 1,
          }}
        >
          {symbol || '—'}
        </span>
        {expiryLabel ? (
          <span
            style={{
              fontSize: 'var(--text-2xs)',
              fontWeight: 700,
              letterSpacing: '0.06em',
              lineHeight: 1,
              padding: '3px 6px',
              borderRadius: 4,
              color: chipColor,
              border: `1px solid ${alpha(chipColor, 0.45)}`,
              background: alpha(chipColor, 0.1),
            }}
          >
            {zeroDte ? '0DTE' : `EXP ${expiryLabel}`}
          </span>
        ) : null}
        {extraExpiries > 0 && (
          <span
            style={{
              fontSize: 'var(--text-2xs)',
              fontWeight: 700,
              color: alpha(T.text, 0.55),
              lineHeight: 1,
            }}
          >
            +{extraExpiries}
          </span>
        )}
      </div>
      {line2 ? (
        <div
          style={{
            fontSize: 'var(--text-xs)',
            color: alpha(T.text, 0.55),
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.2,
          }}
        >
          {line2}
        </div>
      ) : null}
      {note ? (
        <div style={{ fontSize: 'var(--text-2xs)', color: alpha(T.text, 0.45), lineHeight: 1.2 }}>
          {note}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The wordmark, bottom-right of the pane.
 *
 * Deliberately the WORDMARK and not the square badge: this sits in a wide,
 * mostly-empty corner of a chart, and the horizontal lockup reads at a glance in
 * a compressed recording where a 24px badge does not.
 */
export function ReplayBrand({ right = 8, bottom = 6 }: { right?: number; bottom?: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        right,
        bottom,
        zIndex: 6,
        pointerEvents: 'none',
        opacity: 0.85,
      }}
    >
      <CbWordmark className="block h-6 w-auto" />
    </div>
  )
}

/**
 * Both marks over one pane. The parent must be `position: relative` — every
 * caller here already is, because they all draw a spot line the same way.
 */
export function ReplayStampLayer(props: ReplayStampProps & { brand?: boolean }) {
  const { brand = true, ...stamp } = props
  return (
    <>
      <ReplayStamp {...stamp} />
      {brand && <ReplayBrand />}
    </>
  )
}
