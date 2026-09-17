import markUrl from '@/assets/cbedge-mark.svg'
import wordmarkUrl from '@/assets/cbedge-wordmark.png'

// ─────────────────────────────────────────────────────────────────────────────
// THE BRAND, in one file. Nothing else in v3 draws the logo.
//
// Two forms, and they are not interchangeable:
//
//   <CbMark />      the square badge — CB EDGE over the red/green ladder, in
//                   its rounded frame. The ONLY form allowed in a square slot:
//                   the rail head, the favicon, an app icon.
//   <CbWordmark />  the horizontal lockup: ladder + "CB EDGE" side by side.
//                   Wide, needs ~100px of run. Toolbar, headers, share cards.
//
// ── Both are ART, not drawn chrome ──────────────────────────────────────────
// Earlier versions of this file DREW the mark from tokens so it could inherit
// the surface it sat on. That is the right instinct for chrome and the wrong
// one for a logo: the badge is a fixed piece of artwork with its own colours,
// and every time it was redrawn "on theme" it stopped being the logo. So the
// mark is now the artwork itself, as SVG.
//
// The badge is fully vector — the frame, the ten bars and the divider are
// shapes, and the CB EDGE lettering is the real face traced to outlines (the
// custom type has no font file). That is why the same file serves a 20px rail
// head and a 1024px app icon.
//
// The ladder's gradient runs OUTWARD FROM THE DIVIDER: deep at the centre,
// bright at the edges, on both sides. One ramp per column, declared in user
// space across the full 512 box, so the two columns are mirror halves of one
// sweep rather than ten independently tinted bars.
//
// The wordmark stays a bitmap: it is the 2026-09 "cbedge3.0" art, trimmed and
// composed at 96px tall — roughly 3.4x the 28px it renders at, so it is sharp
// on retina and still under 20KB.
// ─────────────────────────────────────────────────────────────────────────────

export function CbMark({ className, title }: { className?: string; title?: string }) {
  // Square by construction (a 512x512 viewBox), so a caller sizes it with one
  // axis — `h-8 w-8` on the rail — and never has to think about aspect.
  return <img src={markUrl} width={512} height={512} alt={title ?? 'CB Edge'} className={className} />
}

export function CbWordmark({ className }: { className?: string }) {
  // width/height are the intrinsic pixels of the asset — stated so the toolbar
  // does not reflow between first paint and the image landing.
  return <img src={wordmarkUrl} width={374} height={96} alt="CB Edge" className={className} />
}
