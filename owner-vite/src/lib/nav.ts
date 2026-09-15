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
 * things to people (emails, alerts). Those never get opened in the same
 * sitting, and the second half is the same job as Content.
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
 * it's a broadcast, so it sits with Emails under Content — not under System
 * because it happens to be a cron job, and not under Info because it happens to
 * know who the customers are.
 *
 * Business and System merged: with the broadcast pages gone to Content and the
 * reporting pages gone to Info, "Business" had nothing left, and Dev + Database
 * are the whole of System. One group instead of two half-empty ones.
 *
 * `href` strings are UNCHANGED from the old grouping on purpose — they're also
 * the route table, and every bookmark and deep link in existence. So the URL
 * scheme (/owner/dev/sales vs /greeks vs /database) stays as inconsistent as it
 * was: the sidebar group and the URL do not agree, and that's accepted, because
 * making them agree means breaking links. When a page IS retired, its href goes
 * in OWNER_REDIRECTS rather than just disappearing.
 */

export type OwnerLink = { label: string; href: string; glyph: string; key: string };
export type OwnerGroup = { label: string; accent: string; links: OwnerLink[] };

/** Rendered above the groups, in no group — the way home from anywhere. */
export const OWNER_PINNED_LINKS: OwnerLink[] = [
  { label: "Hub", href: "/owner", glyph: "⌂", key: "Hub" },
];

export const OWNER_SIDEBAR_GROUPS: OwnerGroup[] = [
  {
    // Reading the numbers — THREE pages, one per job, since 2026-09-15:
    //
    //   Sales      the money   (Stripe, revenue, expenses, campaign links)
    //   Customers  the people  (traffic, signups, activity, map, feedback)
    //   Admin      the machine (system health, controls, checks, access)
    //
    // Overview (/owner/dev/owner) and Visitors (/owner/visitors) were folded
    // into these: Overview's traffic half went to Customers and its system
    // half to Admin; Visitors' map went to Customers whole. Both old hrefs
    // redirect (OWNER_REDIRECTS below) so bookmarks keep working.
    label: "Info",
    accent: OWNER_THEME.cyan,
    links: [
      { label: "Sales", href: "/owner/dev/sales", glyph: "$", key: "Sales" },
      { label: "Customers", href: "/owner/customers", glyph: "◍", key: "Customers" },
      { label: "Admin", href: "/owner/dev/admin", glyph: "⚿", key: "Admin" },
    ],
  },
  {
    // Making something public OR sending it to someone — one job, one group.
    label: "Content",
    accent: OWNER_THEME.orange,
    links: [
      // Customer support tickets — the other end of /feedback on cbedge.net.
      // Content rather than Info: you open this to ANSWER someone, which is the
      // same job as Emails, not to read a number.
      { label: "Feedback", href: "/owner/feedback", glyph: "⚑", key: "Feedback" },
      { label: "Social Media", href: "/social-media", glyph: "🗨︎", key: "SocialMedia" },
      { label: "Post Studio", href: "/owner/post-studio", glyph: "✎", key: "PostStudio" },
      { label: "Changelog", href: "/changelog", glyph: "↻", key: "Changelog" },
      { label: "Affiliates", href: "/owner/affiliates", glyph: "⇉", key: "Affiliates" },
      { label: "Emails", href: "/owner/admin/emails", glyph: "✉", key: "Emails" },
      // Was "Newsletter" (/owner/newsletter) — the weekly-letter idea log. The
      // letter is gone; what survived is the shoebox: paste a screenshot, give
      // it a caption, find it again when you want to mention it. New href, so
      // the old bookmark 404s deliberately rather than opening a different page.
      { label: "Media Dump", href: "/owner/media-dump", glyph: "🖼︎", key: "MediaDump" },
      { label: "Bzila Alerts", href: "/owner/dev/bzila-alerts", glyph: "🔔", key: "BzilaAlerts" },
      // Trade-alert composer for the two Discord bots. Content rather than
      // System: you open it to SEND something, same job as Bzila Alerts.
      { label: "BOT", href: "/owner/bot", glyph: "◉", key: "Bot" },
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
      // London Strategic Edge vault browser — catalog, candles, chains, flow.
      // Market rather than System: you open it to go looking for data on an
      // instrument, not to service the machine.
      { label: "LSE Data", href: "/owner/lse-data", glyph: "⇩", key: "LseData" },
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
      { label: "Postgres", href: "/owner/db-map", glyph: "⛃", key: "DbMap" },
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

/**
 * Retired hrefs → where they went. Rendered by App.jsx as <Navigate replace>,
 * so every bookmark and deep link to the old page lands on the new one instead
 * of the 404. Not nav entries (no key), so check-owner-pages.mjs ignores them.
 */
export const OWNER_REDIRECTS: { from: string; to: string }[] = [
  // Overview → its traffic half is Customers; the system half is on Admin.
  { from: "/owner/dev/owner", to: "/owner/customers" },
  // Visitors → the map is the middle of the Customers page.
  { from: "/owner/visitors", to: "/owner/customers" },
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
