import { OWNER_THEME, OWNER_LIGHT_BLUE } from "./theme";

/**
 * Single source of truth for the owner-vite nav — the rail in OwnerShell and the
 * router in App.jsx both read this file. Add a page here and it shows up in both.
 * `key` names the page module under src/pages.
 *
 * GROUPS ARE NAMED AFTER THE JOB, NOT THE LAYER. The old grouping was
 * Owner / Backend / Personal, and two of those three had no membership test:
 * every page here is owner-only, and every page has a backend — so "Owner"
 * meant "unsorted", and "Backend" had collected Social Media, Newsletter,
 * Emails, Post Studio, Watchlists and the ΔGEX Board. New pages landed
 * wherever, and finding one meant scanning 22 links across two buckets.
 *
 * The test for a new page is now "what am I DOING when I open this?", and it
 * has exactly one answer:
 *
 *   Business  — who's paying, who signed up, and talking to them
 *   Content   — making something public
 *   Market    — market research and the trading tools behind the dashboard
 *   System    — the machine itself: infra, data, code
 *   Personal  — not CB Edge at all
 *
 * If a page seems to fit two, it belongs in the one matching why you'd go
 * looking for it, not what it's built on. Bzila Alerts is the worked example:
 * it's a broadcast to customers, so it sits with Emails and Newsletter under
 * Business — it spent a long while under "Backend", two groups away from its
 * siblings, which is exactly the mix-up this layout is meant to end.
 *
 * `href` strings are UNCHANGED from the old grouping on purpose — they're also
 * the route table, and every bookmark and deep link in existence. So the URL
 * scheme (/owner/dev/sales vs /greeks vs /database) stays as inconsistent as it
 * was: the sidebar group and the URL do not agree, and that's accepted, because
 * making them agree means breaking links.
 */

export type OwnerLink = { label: string; href: string; glyph: string; key: string };
export type OwnerGroup = { label: string; accent: string; links: OwnerLink[] };

/** Rendered above the groups, in no group — the way home from anywhere. */
export const OWNER_PINNED_LINKS: OwnerLink[] = [
  { label: "Hub", href: "/owner", glyph: "⌂", key: "Hub" },
];

export const OWNER_SIDEBAR_GROUPS: OwnerGroup[] = [
  {
    label: "Business",
    accent: OWNER_THEME.cyan,
    links: [
      { label: "Admin", href: "/owner/dev/admin", glyph: "⚿", key: "Admin" },
      { label: "Sales", href: "/owner/dev/sales", glyph: "$", key: "Sales" },
      { label: "Visitors", href: "/owner/visitors", glyph: "◍", key: "Visitors" },
      { label: "Emails", href: "/owner/admin/emails", glyph: "✉", key: "Emails" },
      { label: "Newsletter", href: "/owner/newsletter", glyph: "🗞︎", key: "Newsletter" },
      { label: "Bzila Alerts", href: "/owner/dev/bzila-alerts", glyph: "🔔", key: "BzilaAlerts" },
    ],
  },
  {
    label: "Content",
    accent: OWNER_THEME.orange,
    links: [
      { label: "Social Media", href: "/social-media", glyph: "🗨︎", key: "SocialMedia" },
      { label: "Post Studio", href: "/owner/post-studio", glyph: "✎", key: "PostStudio" },
      { label: "Changelog", href: "/changelog", glyph: "↻", key: "Changelog" },
    ],
  },
  {
    label: "Market",
    accent: OWNER_THEME.gold,
    links: [
      { label: "Results", href: "/owner/dev/results", glyph: "▤", key: "Results" },
      { label: "Backtests", href: "/owner/backtests", glyph: "∿", key: "Backtests" },
      { label: "Probe", href: "/owner/probe", glyph: "🔍", key: "Probe" },
      { label: "Greeks", href: "/greeks", glyph: "∇", key: "Greeks" },
      { label: "ΔGEX Board", href: "/owner/gex-growth", glyph: "Δ", key: "GexGrowth" },
      { label: "Est. Moves BE", href: "/estimated-move", glyph: "⇄", key: "EstimatedMove" },
      { label: "Watchlists", href: "/owner/watchlists", glyph: "☰", key: "Watchlists" },
      { label: "Chart Types", href: "/owner/charts-ui", glyph: "▦", key: "ChartsUI" },
    ],
  },
  {
    label: "System",
    accent: OWNER_LIGHT_BLUE,
    links: [
      { label: "Dev", href: "/owner/dev", glyph: "⚙", key: "Dev" },
      { label: "Overview", href: "/owner/dev/owner?tab=overview", glyph: "⊞", key: "ControlPanel" },
      { label: "Database", href: "/database", glyph: "⛁", key: "Database" },
      { label: "Tree", href: "/owner/dev/tree", glyph: "⌥", key: "Tree" },
    ],
  },
  {
    label: "Personal",
    accent: OWNER_THEME.green,
    links: [
      { label: "Budget", href: "/owner/budget", glyph: "⚖", key: "Budget" },
      { label: "Reta", href: "/owner/reta", glyph: "⌀", key: "Reta" },
      { label: "To-Do", href: "/owner/personal/todo", glyph: "☑", key: "Todo" },
    ],
  },
];

// The Control Panel (/owner/dev/owner) is one page. The Infra tab was removed:
// its system + hosting cards moved to the top of Overview, and its Controls
// section moved to the Admin page.
export const OWNER_CONTROL_SECTIONS: { id: string; label: string }[] = [
  { id: "overview", label: "Overview" },
];

/**
 * Flattened, de-duplicated route list (pathname → page key). Pinned links come
 * FIRST — Hub lives outside the groups now, and leaving it out here would drop
 * /owner from the router entirely.
 */
export type OwnerRoute = { path: string; key: string; label: string };
export const OWNER_ROUTES: OwnerRoute[] = (() => {
  const seen = new Set<string>();
  const out: OwnerRoute[] = [];
  const add = (l: OwnerLink) => {
    const path = l.href.split("?")[0];
    if (seen.has(path)) return;
    seen.add(path);
    out.push({ path, key: l.key, label: l.label });
  };
  for (const l of OWNER_PINNED_LINKS) add(l);
  for (const g of OWNER_SIDEBAR_GROUPS) for (const l of g.links) add(l);
  return out;
})();
