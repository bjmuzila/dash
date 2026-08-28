import { OWNER_THEME, OWNER_LIGHT_BLUE } from "./theme";

/**
 * Single source of truth for the owner-vite nav — the rail in OwnerShell and the
 * router in App.jsx both read this file. Add a page here and it shows up in both.
 * `key` names the page module under src/pages.
 *
 * GROUPS ARE NAMED AFTER THE JOB, NOT THE LAYER. The first pass at this was
 * Owner / Backend / Personal, and two of those three had no membership test:
 * every page here is owner-only, and every page has a backend — so "Owner"
 * meant "unsorted". The second pass split by job, but left Business straddling
 * two unrelated jobs: READING numbers (who's paying, who visited) and SENDING
 * things to people (emails, the newsletter, alerts). Those never get opened in
 * the same sitting, and the second half is the same job as Content.
 *
 * So the test for a new page is "what am I DOING when I open this?", and it has
 * exactly one answer:
 *
 *   Info      — reading the numbers: who's paying, who signed up, who visited
 *   Content   — making something public, or sending it to someone
 *   Market    — market research and the trading tools behind the dashboard
 *   System    — the machine itself: infra, data, code
 *   Personal  — not CB Edge at all
 *
 * If a page seems to fit two, it belongs in the one matching why you'd go
 * looking for it, not what it's built on. Bzila Alerts is the worked example:
 * it's a broadcast, so it sits with Emails and Newsletter under Content — not
 * under System because it happens to be a cron job, and not under Info because
 * it happens to know who the customers are.
 *
 * Business and System merged: with the broadcast pages gone to Content and the
 * reporting pages gone to Info, "Business" had nothing left, and Dev + Database
 * are the whole of System. One group instead of two half-empty ones.
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
    // Reading the numbers. Overview lives here rather than under System: it is
    // the traffic/signups/pages report, and the only reason it ever sat with
    // Dev is that its URL is /owner/dev/owner.
    label: "Info",
    accent: OWNER_THEME.cyan,
    links: [
      { label: "Admin", href: "/owner/dev/admin", glyph: "⚿", key: "Admin" },
      { label: "Visitors", href: "/owner/visitors", glyph: "◍", key: "Visitors" },
      { label: "Overview", href: "/owner/dev/owner?tab=overview", glyph: "⊞", key: "ControlPanel" },
      { label: "Sales", href: "/owner/dev/sales", glyph: "$", key: "Sales" },
    ],
  },
  {
    // Making something public OR sending it to someone — one job, one group.
    label: "Content",
    accent: OWNER_THEME.orange,
    links: [
      // Customer support tickets — the other end of /feedback on cbedge.net.
      // Content rather than Info: you open this to ANSWER someone, which is the
      // same job as Emails and Newsletter, not to read a number.
      { label: "Feedback", href: "/owner/feedback", glyph: "⚑", key: "Feedback" },
      { label: "Social Media", href: "/social-media", glyph: "🗨︎", key: "SocialMedia" },
      { label: "Post Studio", href: "/owner/post-studio", glyph: "✎", key: "PostStudio" },
      { label: "Changelog", href: "/changelog", glyph: "↻", key: "Changelog" },
      { label: "Affiliates", href: "/owner/affiliates", glyph: "⇉", key: "Affiliates" },
      { label: "Emails", href: "/owner/admin/emails", glyph: "✉", key: "Emails" },
      { label: "Newsletter", href: "/owner/newsletter", glyph: "🗞︎", key: "Newsletter" },
      { label: "Bzila Alerts", href: "/owner/dev/bzila-alerts", glyph: "🔔", key: "BzilaAlerts" },
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
      { label: "Daily Grades", href: "/owner/daily-grades", glyph: "◆", key: "DailyGrades" },
      { label: "Est. Moves BE", href: "/estimated-move", glyph: "⇄", key: "EstimatedMove" },
      { label: "Watchlists", href: "/owner/watchlists", glyph: "☰", key: "Watchlists" },
      { label: "Chart Types", href: "/owner/charts-ui", glyph: "▦", key: "ChartsUI" },
    ],
  },
  {
    // The old Business group folded in here; everything it held moved to Info
    // or Content, so this is the merged group and it is just the machine.
    // Tree (/owner/dev/tree) was removed — the page module and pages/tree/* are
    // now unreferenced by the router.
    label: "System",
    accent: OWNER_LIGHT_BLUE,
    links: [
      { label: "Dev", href: "/owner/dev", glyph: "⚙", key: "Dev" },
      { label: "Database", href: "/database", glyph: "⛁", key: "Database" },
      // Labs — live-data experiments that are not board features yet. Distinct
      // from Chart Types (/owner/charts-ui), which is deliberately static
      // pictures with no fetching; anything here talks to a real endpoint.
      { label: "Labs", href: "/owner/labs", glyph: "⌬", key: "Labs" },
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
