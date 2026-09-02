import wordmarkUrl from '@/assets/cbedge-wordmark.png'

// ─────────────────────────────────────────────────────────────────────────────
// THE BRAND, in one file. Nothing else in v3 draws the logo.
//
// Two forms, and they are not interchangeable:
//
//   <CbMark />      the glyph alone — C and B inside the rounded square.
//                   Square, legible down to 16px, and the ONLY form allowed in
//                   a square slot (the rail head, a favicon, an app icon).
//   <CbWordmark />  the horizontal lockup: mark + "CB EDGE". Wide, needs ~100px
//                   of run to stay readable. Toolbar, headers, share cards.
//
// ── Why the mark is letters and not the bar ladder ──────────────────────────
// The source art's mark is five red bars beside five green bars. That reads at
// 512px and turns to mush at 16px — five 2.6-unit bars on a 32-unit grid land
// on roughly one device pixel each in a favicon, and the two columns merge into
// two coloured smudges. The letterforms keep exactly what the ladder was
// carrying — RED on the left, GREEN on the right, the down/up pair the whole
// app is painted in — while surviving the sizes a mark actually gets used at.
// The full ladder art still exists (public/cbedge3.0.png) for anywhere with the
// room for it, including the wordmark below.
//
// The mark is drawn rather than imported so it inherits the surface it sits on:
// its frame is `currentColor`, so a rail that dims its chrome dims the logo
// with it, and the letters come from --color-candle-down / --color-candle-up —
// the same two values every candle in the app is painted with. That is the
// point of redrawing the source art's pure #f00/#0f0 in v3's palette: the logo
// now says the same thing the charts say.
//
// The wordmark stays a bitmap because the lettering is a custom face we do not
// have as outlines. It is the 2026-09 "cbedge3.0" art, trimmed and composed at
// 96px tall — roughly 3.4x the 28px it renders at, so it is sharp on retina and
// still under 20KB.
// ─────────────────────────────────────────────────────────────────────────────

export function CbMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label={title ?? 'CB Edge'}
      className={className}
    >
      {title ? <title>{title}</title> : null}
      <rect x="2.2" y="2.2" width="27.6" height="27.6" rx="8.4" stroke="currentColor" strokeWidth="2.3" />
      {/* C — one open arc. Round caps because the ladder's bars were round-ended
          and that is the only piece of the old mark's drawing worth keeping. */}
      <path
        d="M14.6 9.0 A5.6 5.6 0 0 0 6.4 13.2 v5.6 A5.6 5.6 0 0 0 14.6 23.0"
        stroke="var(--color-candle-down)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* B — stem plus two bowls, drawn as a stroke rather than a filled glyph
          so its weight matches the C's exactly at every size. */}
      <path
        d="M18.2 7.2 V24.8 M18.2 7.2 h3.4 a4.4 4.4 0 0 1 0 8.8 h-3.4 M18.2 16.0 h4.4 a4.4 4.4 0 0 1 0 8.8 h-4.4"
        stroke="var(--color-candle-up)"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function CbWordmark({ className }: { className?: string }) {
  // width/height are the intrinsic pixels of the asset — stated so the toolbar
  // does not reflow between first paint and the image landing.
  return <img src={wordmarkUrl} width={374} height={96} alt="CB Edge" className={className} />
}
