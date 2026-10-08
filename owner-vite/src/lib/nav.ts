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
 *   Trading   — market research and the trading tools behind the dashboard
 *   Voltick   — the live business
 *   Personal  — not a business at all
 *   System    — the machine itself: infra, data, code
 *   CB Edge Archive — customer-facing CB Edge pages, folded away (2026-09-27)
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
export type OwnerGroup = {
  label: string;
  accent: string;
  links: OwnerLink[];
  /** Rendered folded shut in the rail and on the Hub until opened (or until
   *  you're on one of its pages). Used for the CB Edge archive. */
  collapsed?: boolean;
};

/** Rendered above the groups, in no group — the way home from anywhere. */
export const OWNER_PINNED_LINKS: OwnerLink[] = [
  { label: "Hub", href: "/owner", glyph: "⌂", key: "Hub" },
];

/**
 * 2026-09-27 — CB Edge stopped taking customers and nobody is billed anymore,
 * so the console is regrouped around what's still in use: Trading, Voltick,
 * Personal, System. Every page that only existed to win, bill, serve or talk to
 * CB Edge customers moved into the collapsed "CB Edge Archive" group at the
 * bottom. Nothing was deleted and NO href changed — the archive is a sidebar
 * move only, so bookmarks still work and a page comes back by moving its entry
 * out of the archive.
 */
export const OWNER_SIDEBAR_GROUPS: OwnerGroup[] = [
  {
    // Market research and the trading tools behind the dashboard. BOT (the
    // Discord trade-alert composer) sits here now that the customer-facing
    // broadcast pages are archived.
    label: "Trading",
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
      // London Strategic Edge vault browser — catalog, candles, chains, flow.
      { label: "LSE Data", href: "/owner/lse-data", glyph: "⇩", key: "LseData" },
      { label: "BOT", href: "/owner/bot", glyph: "◉", key: "Bot" },
    ],
  },
  {
    // The live business. The voltick.cbedge.net link above the groups is the
    // way out to the site itself; this is the work list for it.
    label: "Voltick",
    accent: OWNER_LIGHT_BLUE,
    links: [
      { label: "Voltick Audit", href: "/owner/voltick-audit", glyph: "⚡︎", key: "VoltickAudit" },
      { label: "Vela Usage", href: "/owner/vela", glyph: "◧", key: "VelaUsage" },
      // /healthz for the box behind vela.cbedge.net — feed, socket, DB, recorders, caches.
      { label: "Vela Health", href: "/owner/vela-health", glyph: "⌁", key: "VelaHealth" },
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
  {
    // The machine (infra, data, code) plus the two utilities that aren't about
    // CB Edge customers: the screenshot shoebox and the client-site previews.
    label: "System",
    accent: OWNER_THEME.cyan,
    links: [
      { label: "Dev", href: "/owner/dev", glyph: "⚙", key: "Dev" },
      { label: "Admin", href: "/owner/dev/admin", glyph: "⚿", key: "Admin" },
      // The AI-app connector (www.cbedge.net/mcp): who is connected through
      // Gemini / ChatGPT / Claude, tool usage, refusals, and a disconnect button.
      { label: "AI Connections", href: "/owner/ai-connections", glyph: "✦", key: "AiConnections" },
      { label: "Database", href: "/database", glyph: "⛁", key: "Database" },
      { label: "Postgres", href: "/owner/db-map", glyph: "⛃", key: "DbMap" },
      { label: "Media Dump", href: "/owner/media-dump", glyph: "🖼︎", key: "MediaDump" },
      // sites.cbedge.net — password-protected website previews for clients.
      { label: "Client Sites", href: "/owner/client-sites", glyph: "◫", key: "ClientSites" },
    ],
  },
  {
    // Customer-facing CB Edge pages — kept, routed and searchable (⌘K on the
    // Hub still finds them), just folded away at the bottom of the rail.
    label: "CB Edge Archive",
    accent: OWNER_THEME.orange,
    collapsed: true,
    links: [
      { label: "Sales", href: "/owner/dev/sales", glyph: "$", key: "Sales" },
      { label: "Customers", href: "/owner/customers", glyph: "◍", key: "Customers" },
      { label: "Visitors", href: "/owner/visitors", glyph: "🌐", key: "Visitors" },
      { label: "Affiliates", href: "/owner/affiliates", glyph: "⇉", key: "Affiliates" },
      { label: "Feedback", href: "/owner/feedback", glyph: "⚑", key: "Feedback" },
      { label: "Emails", href: "/owner/admin/emails", glyph: "✉", key: "Emails" },
      { label: "Bzila Alerts", href: "/owner/dev/bzila-alerts", glyph: "🔔", key: "BzilaAlerts" },
      { label: "Social Media", href: "/social-media", glyph: "🗨︎", key: "SocialMedia" },
      { label: "Post Studio", href: "/owner/post-studio", glyph: "✎", key: "PostStudio" },
      { label: "Changelog", href: "/changelog", glyph: "↻", key: "Changelog" },
      { label: "Chart Types", href: "/owner/charts-ui", glyph: "▦", key: "ChartsUI" },
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
