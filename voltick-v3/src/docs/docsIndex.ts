// ─────────────────────────────────────────────────────────────────────────────
// THE DOC INDEX — which markdown file explains which surface.
//
// Every card in src/board/catalog.tsx and every route in src/App.tsx has a
// written reference in public/docs/*.md, and this is the one place that says
// which is which. The files are SHIPPED AS STATIC ASSETS, not imported: a
// bundled `?raw` import would put ~600KB of prose into route chunks that
// budgets.json measures, for text nobody reads on a normal visit. Under
// `base: '/v3/'` they land at /v3/docs/<slug>.md and are fetched only when
// somebody clicks the button.
//
// ── THE RULE ────────────────────────────────────────────────────────────────
// A card or a page without an entry here draws NO button — it does not draw a
// broken one. So adding a surface never breaks this file, and never blocks it
// either; the day the doc is written, the line goes in and the button appears.
//
// Slugs are prefixed `card-` / `page-` rather than sharing a namespace, because
// `/cards/gex-candles` and a future `/gex-candles` route would otherwise both
// want the file called `gex-candles.md`.
// ─────────────────────────────────────────────────────────────────────────────

/** `/v3/docs/<slug>.md`. BASE_URL carries the trailing slash. */
export function docUrl(slug: string): string {
  return `${import.meta.env.BASE_URL}docs/${slug}.md`
}

/**
 * Catalog card id → doc slug.
 *
 * Keyed by the TYPE id, never an instance id (`gex-candles#2`) — two copies of
 * a card are two copies of one thing and they read the same reference. Callers
 * on the board pass `cardTypeOf(id)`.
 */
export const CARD_DOCS: Record<string, string> = {
  'gex-candles': 'card-gex-candles',
  'gex-chart': 'card-gex-chart',
  'gauge-rail': 'card-gauge-rail',
  'multi-greek': 'card-multi-greek',
  'vol-gex-flow': 'card-vol-gex-flow',
  'oi-by-expiry': 'card-oi-by-expiry',
  'net-premium': 'card-net-premium',
  'flow-tape': 'card-flow-tape',
  'top-flow': 'card-top-flow',
  'quick-links': 'card-quick-links',
  'key-levels': 'card-key-levels',
  'econ-calendar': 'card-econ-calendar',
}

/**
 * Route path → doc slug. EXACT pathnames, as App.tsx registers them.
 *
 * `/cards/:id` is deliberately absent: a deep-linked card should hand back that
 * CARD's reference, not a page one, and `routeDoc` below does that lookup.
 */
export const ROUTE_DOCS: Record<string, string> = {
  '/': 'page-home-cards',
  '/cards': 'page-home-cards',
  '/board': 'page-board',
  '/single': 'page-single-voltmap',
  '/traders-dashboard': 'page-traders-dashboard',
  '/premarket': 'page-premarket',
  '/options-chain': 'page-options-chain',
  '/chain': 'page-chain',
  '/analytics': 'page-analysis',
  '/flow': 'page-flow',
  '/em': 'page-em',
  '/replay': 'page-replay',
  '/scanner': 'page-scanner',
  '/economic-calendar': 'page-economic-calendar',
  '/level-log': 'page-level-log',
  '/seasonality': 'page-seasonality',
  '/whales': 'page-whales',
  '/legacy': 'page-legacy',
  '/feedback': 'page-feedback',
  // The phone build. Six screens, one reference: each is a thin wrapper around
  // a card or a page that already has its own file, and six near-identical
  // pages of prose would be six things to keep in sync.
  '/m': 'page-phone',
  '/m/gex': 'page-phone',
  '/m/heat': 'page-phone',
  '/m/spx': 'page-phone',
  '/m/em': 'page-phone',
  '/m/econ': 'page-phone',
  '/m/alerts': 'page-phone',
}

/** The doc for a catalog card, or null when it has none. */
export function cardDoc(cardTypeId: string): string | null {
  return CARD_DOCS[cardTypeId] ?? null
}

/**
 * The doc for the route currently on screen, or null.
 *
 * A deep-linked card (`/cards/gex-candles`) resolves to that card's own
 * reference rather than to the gallery's — the toolbar button and the button in
 * the card's own header then point at the same file, which is the only answer
 * that is not confusing.
 *
 * Trailing slashes are trimmed because a link written by hand can carry one and
 * the router does not care; a lookup table does.
 */
export function routeDoc(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const deep = /^\/cards\/(.+)$/.exec(path)
  if (deep) return cardDoc(deep[1] ?? '')
  return ROUTE_DOCS[path] ?? null
}

/** Every slug this index can hand out — what scripts/check-docs.mjs verifies. */
export function allDocSlugs(): string[] {
  return [...new Set([...Object.values(CARD_DOCS), ...Object.values(ROUTE_DOCS)])].sort()
}
