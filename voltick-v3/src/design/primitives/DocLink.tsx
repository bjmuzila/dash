import { cardDoc, docUrl, routeDoc } from '@/docs/docsIndex'

// ─────────────────────────────────────────────────────────────────────────────
// THE MD BUTTON — every card and every page hands you its own reference.
//
// A plain <a download>, not a fetch and not a Blob. Three reasons, and the
// third is the one that decided it:
//
//   · it costs the bundle NOTHING. The markdown is a static asset under
//     public/docs, so a card that nobody asks about never downloads a byte of
//     prose — see src/docs/docsIndex.ts for why the files are not imported.
//   · middle-click, ⌘-click and "Save link as…" all work, because it is a link.
//     A button that calls URL.createObjectURL breaks every one of those.
//   · it cannot fail silently. A missing file is a 404 the user can see, not a
//     click that does nothing.
//
// `download` names the saved file after the slug rather than letting the
// browser invent one from the URL, and it is what stops Chrome rendering the
// markdown as plain text in a tab instead of saving it. `target="_blank"` is
// the fallback for a browser that ignores `download` on a same-origin link:
// worst case the reference opens in a tab, which is still the reference.
//
// STRUCTURAL ONLY — every colour is a token utility (non-negotiable #1) and
// every size comes off the type scale.
// ─────────────────────────────────────────────────────────────────────────────

export interface DocLinkProps {
  /** Doc slug, from src/docs/docsIndex.ts. Null or absent draws nothing. */
  slug?: string | null
  /** Button text. `MD` in a card header; spell it out where there is room. */
  label?: string
  /** What the reference is OF, for the tooltip — "the GEX Candles card". */
  subject?: string
  /** `chip` is the toolbar/header size; `row` is a list row's trailing tag. */
  size?: 'chip' | 'row'
  /**
   * POSITIONING ONLY — the gallery parks these absolutely against a tile.
   * Not a licence to restyle the button: the plate, the border and the type
   * size come off the tokens below and stay the same everywhere.
   *
   * BOTH wrappers below forward it, and that is the point. One that took it
   * and dropped it — or did not declare it at all — fails at its CALL SITE
   * rather than at its definition, which is exactly how the first cut of
   * this file broke the Docker build (`CardGallery.tsx(173,55): TS2322`).
   */
  className?: string
}

const BASE =
  'inline-flex shrink-0 items-center gap-1 rounded-sm border border-line font-semibold tracking-wide text-muted no-underline hover:bg-raised hover:text-fg'

const SIZES: Record<'chip' | 'row', string> = {
  chip: 'px-1.5 py-0.5 text-2xs',
  row: 'px-1 py-0 text-3xs',
}

export function DocLink({ slug, label = 'MD', subject, size = 'chip', className = '' }: DocLinkProps) {
  // No entry, no button. A doc that has not been written must not leave a
  // control behind that 404s — see THE RULE in src/docs/docsIndex.ts.
  if (!slug) return null
  const what = subject ? `Download the full reference for ${subject}` : 'Download the full reference for this page'
  return (
    <a
      href={docUrl(slug)}
      download={`${slug}.md`}
      target="_blank"
      rel="noreferrer"
      title={`${what} — everything it draws, every feed behind it, every setting and every known trap, as a markdown file.`}
      aria-label={what}
      // A link inside a draggable card header must not start a drag, and a link
      // inside a <Link> tile must not follow the tile — see the gallery.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
      className={[BASE, SIZES[size], className].filter(Boolean).join(' ')}
    >
      <span aria-hidden>↓</span>
      {label}
    </a>
  )
}

/**
 * The same button, for the route currently on screen.
 *
 * Draws nothing on a route with no entry, which is what keeps NotFound and any
 * half-built page from growing a control that leads nowhere.
 */
export function PageDocLink({
  pathname,
  size = 'chip',
  className,
}: {
  pathname: string
  size?: 'chip' | 'row'
  className?: string
}) {
  return <DocLink slug={routeDoc(pathname)} subject="this page" size={size} className={className} />
}

/** The same button, for a catalog card, by its TYPE id. */
export function CardDocLink({
  cardTypeId,
  label,
  size = 'chip',
  className,
}: {
  cardTypeId: string
  label?: string
  size?: 'chip' | 'row'
  className?: string
}) {
  return (
    <DocLink
      slug={cardDoc(cardTypeId)}
      label={label}
      subject={`the ${cardTypeId} card`}
      size={size}
      className={className}
    />
  )
}
