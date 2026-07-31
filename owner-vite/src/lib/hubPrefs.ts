import { OWNER_SIDEBAR_GROUPS } from "./nav";
import type { OwnerLink } from "./nav";

/**
 * hubPrefs — pinned + recent owner routes for the Hub command bar.
 *
 * Storage is localStorage, keyed by href (the same string in lib/nav.ts, so a
 * renamed label never orphans a pin). Every read re-resolves against
 * OWNER_SIDEBAR_GROUPS, which means a route deleted from the nav config
 * silently drops out of pins/recents instead of rendering a dead tile.
 *
 * All access is wrapped — private-mode Safari and SSR both throw on
 * localStorage, and a hub that can't remember pins is still a working hub.
 */

const PIN_KEY = "owner.hub.pinned";
const RECENT_KEY = "owner.hub.recent";
const RECENT_MAX = 8;

export type HubLink = OwnerLink & { group: string; accent: string };

/** Every nav link, flattened, with its group label + accent carried along. */
export const HUB_LINKS: HubLink[] = OWNER_SIDEBAR_GROUPS.flatMap((g) =>
  g.links
    .filter((l) => l.href !== "/owner")
    .map((l) => ({ ...l, group: g.label, accent: g.accent }))
);

const BY_HREF = new Map(HUB_LINKS.map((l) => [l.href, l]));

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(key: string, v: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable — pins are best-effort */
  }
}

/** Resolve stored hrefs back to live links, dropping anything no longer in nav. */
function resolve(hrefs: string[]): HubLink[] {
  const out: HubLink[] = [];
  for (const h of hrefs) {
    const l = BY_HREF.get(h);
    if (l) out.push(l);
  }
  return out;
}

export function getPinned(): HubLink[] {
  return resolve(read(PIN_KEY));
}

export function isPinned(href: string): boolean {
  return read(PIN_KEY).includes(href);
}

/** Toggle a pin and return the new pinned list. */
export function togglePin(href: string): HubLink[] {
  const cur = read(PIN_KEY);
  const next = cur.includes(href) ? cur.filter((h) => h !== href) : [...cur, href];
  write(PIN_KEY, next);
  return resolve(next);
}

export function getRecent(): HubLink[] {
  return resolve(read(RECENT_KEY));
}

/**
 * Record a visit. Safe to call with any pathname — anything that isn't a known
 * owner route (or is the hub itself) is ignored, so this can be wired into a
 * global route listener without a whitelist.
 */
export function recordVisit(href: string): void {
  if (!BY_HREF.has(href)) return;
  const cur = read(RECENT_KEY).filter((h) => h !== href);
  write(RECENT_KEY, [href, ...cur].slice(0, RECENT_MAX));
}

/**
 * Fuzzy score for one link against a query. Higher is better; null = no match.
 * Exact > prefix > substring > subsequence, and a hit on the label always
 * outranks the same hit on the group name or the URL.
 */
function scoreField(q: string, text: string): number | null {
  const t = text.toLowerCase();
  if (!t) return null;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - t.length;
  const idx = t.indexOf(q);
  if (idx >= 0) return 620 - idx * 4 - t.length;

  // Subsequence: every query char in order, penalised by how spread out it is.
  let i = 0;
  let gaps = 0;
  let last = -1;
  for (let c = 0; c < t.length && i < q.length; c++) {
    if (t[c] === q[i]) {
      if (last >= 0) gaps += c - last - 1;
      last = c;
      i++;
    }
  }
  return i === q.length ? 340 - gaps : null;
}

export function scoreLink(query: string, link: HubLink): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const label = scoreField(q, link.label);
  const group = scoreField(q, link.group);
  const href = scoreField(q, link.href);
  const best = Math.max(
    label ?? -Infinity,
    group != null ? group * 0.5 : -Infinity,
    href != null ? href * 0.4 : -Infinity
  );
  return best === -Infinity ? null : best;
}

/** Ranked matches for a query, best first. */
export function searchLinks(query: string, limit = 8): HubLink[] {
  const q = query.trim();
  if (!q) return [];
  return HUB_LINKS.map((l) => ({ l, s: scoreLink(q, l) }))
    .filter((r): r is { l: HubLink; s: number } => r.s !== null)
    .sort((a, b) => b.s - a.s || a.l.label.localeCompare(b.l.label))
    .slice(0, limit)
    .map((r) => r.l);
}
