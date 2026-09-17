// ─────────────────────────────────────────────────────────────────────────────
// THE BRAND, in one file. Nothing else in this app draws the logo.
//
// v3's version of this file renders two pieces of CB Edge ARTWORK: the square
// badge (cbedge-mark.svg) and the horizontal lockup (cbedge-wordmark.png).
// Artwork is exactly what a token repaint cannot reach, which is why this app
// still said CB EDGE everywhere after the palette moved — and on the phone
// build, where the rail head is the only branding on screen, that made a
// voltick page read as CB Edge's.
//
// So this is the one file in the copy that is REPLACED rather than repainted.
// The exports keep v3's names and their sizing contract (square badge, wide
// lockup), so Shell.tsx, the phone rail and anything else that draws the brand
// are untouched and stay copyable from v3.
//
// It is TYPE, not art, on purpose. Voltick's mark is not mine to invent, and a
// traced-looking approximation of one is worse than honest type: it would be a
// logo that is not the logo, in a file whose whole job is to be the logo. When
// the real asset exists, drop it in here and nothing else changes.
//
// Colour comes from the tokens like everything else — no hex in this file, so
// check-theme.mjs stays satisfied and the brand follows the palette.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The square badge. The only form allowed in a square slot: the rail head, a
 * favicon, an app icon. Square by construction so a caller sizes it on one axis
 * (`h-8 w-8` on the rail) and never thinks about aspect.
 */
export function CbMark({ className, title }: { className?: string; title?: string }) {
  return (
    <span
      className={className}
      title={title ?? 'Voltick'}
      aria-label={title ?? 'Voltick'}
      role="img"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        aspectRatio: '1 / 1',
        borderRadius: 'var(--radius-md)',
        background: 'color-mix(in srgb, var(--color-accent) 18%, var(--color-surface))',
        border: '1px solid color-mix(in srgb, var(--color-accent) 55%, transparent)',
        color: 'var(--color-fg)',
        fontFamily: 'var(--font-sans)',
        // Sized from the box rather than a fixed px, so one component serves a
        // 20px rail head and a 96px header without a second variant.
        fontSize: '0.58em',
        fontWeight: 700,
        letterSpacing: '-0.02em',
        lineHeight: 1,
      }}
    >
      V
    </span>
  )
}

/**
 * The horizontal lockup. Wide: it wants ~100px of run. Toolbar, headers, share
 * cards.
 */
export function CbWordmark({ className }: { className?: string }) {
  return (
    <span
      className={className}
      aria-label="Voltick"
      role="img"
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: '0.4em',
        fontFamily: 'var(--font-sans)',
        color: 'var(--color-fg)',
        fontSize: '1em',
        fontWeight: 700,
        letterSpacing: '-0.01em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      Voltick
      {/* The v3 tag is not decoration: this app IS v3, and someone looking at a
          screenshot of it needs to know which board they are looking at. */}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.62em',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-accent)',
        }}
      >
        v3
      </span>
    </span>
  )
}
