import { listShortLinks, type ShortLinkRow } from "@/lib/db";
import { CUSTOM_SLUG_RE, isReservedSlug } from "@/lib/shortLinks";
import { PROMO_SLUG_LIST } from "@/lib/promoLinks";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER-CREATED SHORT LINKS — the cached read side.
 *
 * `cbedge.net/<name>` is a root-level single dynamic segment, so it can only
 * ever answer for an allowlist (the long version of why is in
 * lib/shortLinks.ts). Half that allowlist is the PLACEMENTS code table; this is
 * the other half — the short_links rows the owner creates from the Overview
 * panel, so a new name works without a deploy.
 *
 * ─── WHY A CACHE AND NOT A QUERY ────────────────────────────────────────────
 *
 * middleware.ts consults this on every unmatched one-segment path, and the web
 * hands us a lot of those: `/wp-admin`, `/.env`, `/phpmyadmin`, every typo. A
 * query per probe would put bot traffic straight onto the connection pool. So
 * the WHOLE table is loaded at once (it is a handful of rows and will stay
 * that way) and answered from memory, on the same TTL-plus-background-refresh
 * shape middleware already uses for the maintenance flag.
 *
 * Failure is soft in one direction only: a DB hiccup keeps serving the last
 * known table for up to HARD_TTL_MS, and if we have never loaded one, no link
 * resolves. A short link that 404s for a minute is a bad minute; a short link
 * that resolves off stale data forever is a bug you can't see.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TTL_MS = 30_000;
const HARD_TTL_MS = 5 * 60_000;

let cache: { at: number; map: Map<string, ShortLinkRow> } = { at: 0, map: new Map() };
let loaded = false;
let refreshing: Promise<void> | null = null;

function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = listShortLinks()
    .then((rows) => {
      const map = new Map<string, ShortLinkRow>();
      for (const row of rows) {
        const slug = String(row.slug || "");
        // Re-checked on READ, not just on write. A row created before a page
        // existed must never be able to shadow — or un-gate — that page.
        if (!CUSTOM_SLUG_RE.test(slug)) continue;
        if (isReservedSlug(slug, PROMO_SLUG_LIST)) continue;
        map.set(slug, row);
      }
      cache = { at: Date.now(), map };
      loaded = true;
    })
    .catch((err) => {
      console.error("[shortLinkRegistry] load failed:", err);
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function getMap(): Promise<Map<string, ShortLinkRow>> {
  const age = Date.now() - cache.at;
  if (loaded && age < TTL_MS) return cache.map;
  if (loaded && age < HARD_TTL_MS) {
    void refresh(); // serve the last known table while it reloads
    return cache.map;
  }
  await refresh();
  return cache.map;
}

/** The row for a created short link, or null. Slug must already be normalized. */
export async function lookupShortLink(slug: string): Promise<ShortLinkRow | null> {
  if (!slug || !CUSTOM_SLUG_RE.test(slug)) return null;
  if (isReservedSlug(slug, PROMO_SLUG_LIST)) return null;
  const map = await getMap();
  return map.get(slug) ?? null;
}

/** Every created slug, for the owner panel's "already created" list. */
export async function listShortLinkSlugs(): Promise<string[]> {
  const map = await getMap();
  return [...map.keys()].sort();
}

/** Call after a create or delete so the next lookup sees it immediately. */
export function invalidateShortLinkCache(): void {
  cache = { at: 0, map: cache.map };
  loaded = false;
}
