import { OWNER_THEME } from "./theme";

/**
 * Single source of truth for the owner-vite nav — a faithful port of
 * OWNER_SIDEBAR_GROUPS from components/shared/OwnerSidebar.tsx. Same labels,
 * glyphs, group order, and href strings. Add a page here and it shows up in the
 * rail automatically. `key` names the page module under src/pages.
 */

export type OwnerLink = { label: string; href: string; glyph: string; key: string };
export type OwnerGroup = { label: string; accent: string; links: OwnerLink[] };

export const OWNER_SIDEBAR_GROUPS: OwnerGroup[] = [
  {
    label: "Owner",
    accent: OWNER_THEME.cyan,
    links: [
      { label: "Hub", href: "/owner", glyph: "⌂", key: "Hub" },
      { label: "Admin", href: "/owner/dev/admin", glyph: "⚿", key: "Admin" },
      { label: "Sales", href: "/owner/dev/sales", glyph: "$", key: "Sales" },
      { label: "Overview", href: "/owner/dev/owner?tab=overview", glyph: "⊞", key: "ControlPanel" },
      { label: "Infra", href: "/owner/dev/owner?tab=infra", glyph: "◈", key: "ControlPanel" },
      { label: "Probe", href: "/owner/probe", glyph: "🔍", key: "Probe" },
      { label: "Results", href: "/owner/dev/results", glyph: "▤", key: "Results" },
      { label: "Backtests", href: "/owner/backtests", glyph: "∿", key: "Backtests" },
      { label: "Tree", href: "/owner/dev/tree", glyph: "⌥", key: "Tree" },
      { label: "Greeks", href: "/greeks", glyph: "∇", key: "Greeks" },
    ],
  },
  {
    label: "Backend",
    accent: OWNER_THEME.orange,
    links: [
      { label: "Dev", href: "/owner/dev", glyph: "⚙", key: "Dev" },
      { label: "Bzila Alerts", href: "/owner/dev/bzila-alerts", glyph: "🔔", key: "BzilaAlerts" },
      { label: "Database", href: "/database", glyph: "⛁", key: "Database" },
      { label: "Est. Moves BE", href: "/estimated-move", glyph: "⇄", key: "EstimatedMove" },
      { label: "Changelog", href: "/changelog", glyph: "↻", key: "Changelog" },
      { label: "Social Media", href: "/social-media", glyph: "🗨︎", key: "SocialMedia" },
      { label: "Newsletter", href: "/owner/newsletter", glyph: "🗞︎", key: "Newsletter" },
      { label: "Emails", href: "/owner/admin/emails", glyph: "✉", key: "Emails" },
      { label: "Post Studio", href: "/owner/post-studio", glyph: "✎", key: "PostStudio" },
      { label: "Charts UI", href: "/owner/charts-ui", glyph: "▦", key: "ChartsUI" },
    ],
  },
  {
    label: "Personal",
    accent: OWNER_THEME.green,
    links: [
      { label: "Budget", href: "/owner/budget", glyph: "⚖", key: "Budget" },
      { label: "To-Do", href: "/owner/personal/todo", glyph: "☑", key: "Todo" },
    ],
  },
];

// The Control Panel (/owner/dev/owner) is one page with ?tab= sections.
export const OWNER_CONTROL_SECTIONS: { id: string; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "infra", label: "Infra" },
];

/** Flattened, de-duplicated route list (pathname → page key). */
export type OwnerRoute = { path: string; key: string; label: string };
export const OWNER_ROUTES: OwnerRoute[] = (() => {
  const seen = new Set<string>();
  const out: OwnerRoute[] = [];
  for (const g of OWNER_SIDEBAR_GROUPS) {
    for (const l of g.links) {
      const path = l.href.split("?")[0];
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({ path, key: l.key, label: l.label });
    }
  }
  return out;
})();
