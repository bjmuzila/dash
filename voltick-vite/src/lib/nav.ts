/**
 * The contents list. This file IS the landing page: Home renders these groups,
 * and App builds one route per item from the same array, so a link on the board
 * and a route that answers it can never drift apart.
 *
 * Adding a page is two edits:
 *   1. an item here, with a `key`
 *   2. that same `key` in src/pages/registry.ts, pointing at a lazy() import
 *
 * Miss step 2 and the route renders Placeholder rather than 404, which is the
 * intended state for a page that is planned and not written yet. Most of the
 * list is in that state on purpose: the pages arrive as demos and sandboxes of
 * the real site, one at a time.
 *
 * Copy rules apply to every string in this file: no em-dashes, and nothing that
 * reads as advice. Middle dot, comma, colon or parentheses.
 */

export type VoltickStatus = "live" | "planned";

export type VoltickLink = {
  /** Sidebar and card label. */
  label: string;
  /** Route path, root absolute. */
  path: string;
  /** Registry key. */
  key: string;
  /** One line of what the page is for. Shown on the contents board. */
  note: string;
  status: VoltickStatus;
  /**
   * True when this path is NOT a React route: nginx serves it (or proxies it)
   * and the SPA must never try to handle it. An external item renders as a
   * plain anchor on the contents board and gets no entry in the router, so a
   * click is a real navigation rather than a client-side route that would land
   * on NotFound.
   */
  external?: true;
};

export type VoltickGroup = {
  title: string;
  /**
   * The group's mark in the left rail. One emoji, and it is chrome: it stands
   * for the category, never for a data level. The reserved marks (star, bolt,
   * diamond) are spoken for by the color vocabulary and never appear here.
   */
  icon: string;
  blurb: string;
  items: VoltickLink[];
};

export const VOLTICK_SECTIONS: VoltickGroup[] = [
  {
    title: "Newsletter",
    icon: "📰",
    blurb: "The Weekly Edge, drawn in the Voltick system instead of the email's own palette.",
    items: [
      {
        label: "The Weekly Edge",
        path: "/newsletter",
        key: "Newsletter",
        note: "Last Sunday's letter, retyped into Voltick surfaces, type and reserved colors.",
        status: "live",
      },
    ],
  },
  {
    title: "Theme",
    icon: "🎨",
    blurb: "The Voltick system, rendered from the tokens this app actually ships. Almost everything here is a theme page today.",
    items: [
      {
        label: "Design system",
        path: "/design-system",
        key: "DesignSystem",
        note: "Surfaces, text, type, shape, elevation and the aurora, drawn live from src/theme.ts.",
        status: "live",
      },
      {
        label: "Color vocabulary",
        path: "/colors",
        key: "Colors",
        note: "The reserved colors and their marks. Each one means exactly one thing.",
        status: "live",
      },
    ],
  },
  {
    title: "Almanac",
    icon: "📅",
    blurb:
      "CB Edge's public seasonality almanac, ported whole and repainted in the Voltick palette. A static copy: it renders the compiled data and asks the backend for nothing.",
    items: [
      {
        label: "Seasonality",
        path: "/seasonality",
        key: "Seasonality",
        note: "Ninety-eight years of S&P 500 calendar behaviour, nineteen sections, drawn in Voltick surfaces and type.",
        status: "live",
      },
    ],
  },
  {
    title: "Demos",
    icon: "🖥️",
    blurb: "Sandbox copies of real surfaces, safe to click through. Synthetic records only, nothing customer facing.",
    items: [
      {
        label: "Owner console demo",
        path: "/demo/",
        key: "Demo",
        note: "All 28 routes of the owner console, every record synthetic. Served by the demo-web container, not by this SPA.",
        status: "live",
        external: true,
      },
      {
        label: "Customer card",
        path: "/customer-card",
        key: "CustomerCard",
        note: "One customer on one screen: identity, money, usage and the page feed, with no tabs to open.",
        status: "live",
      },
    ],
  },
  {
    title: "The merger",
    icon: "🔀",
    blurb: "What Voltick and CB Edge each already are, and what one product made of both looks like.",
    items: [
      {
        label: "Overview",
        path: "/overview",
        key: "Overview",
        note: "Why this sandbox exists and what gets decided here.",
        status: "planned",
      },
      {
        label: "Surface map",
        path: "/surface-map",
        key: "SurfaceMap",
        note: "Every Voltick surface beside its CB Edge counterpart, and which one survives.",
        status: "planned",
      },
      {
        label: "Vocabulary",
        path: "/vocabulary",
        key: "Vocabulary",
        note: "One word per concept across both products: Volt, flip, wall, coil, GEX, gamma.",
        status: "planned",
      },
      {
        label: "Open questions",
        path: "/questions",
        key: "Questions",
        note: "The decisions still outstanding, with what each one blocks.",
        status: "planned",
      },
    ],
  },
  {
    title: "Plumbing",
    icon: "🔌",
    blurb: "Proof that this subdomain reaches the CB Edge backend the way it is meant to.",
    items: [
      {
        label: "Feed check",
        path: "/feed-check",
        key: "FeedCheck",
        note: "Reads /proxy/health and opens /ws/gex, so a broken reverse proxy shows here first.",
        status: "live",
      },
    ],
  },
];

/** Every listed item, external ones included. Home renders these. */
export const VOLTICK_ITEMS: VoltickLink[] = VOLTICK_SECTIONS.flatMap((g) => g.items);

/** The items the SPA router owns. An external path is nginx's, never React's. */
export const VOLTICK_ROUTES: VoltickLink[] = VOLTICK_ITEMS.filter((r) => !r.external);

export function findRoute(path: string): VoltickLink | undefined {
  return VOLTICK_ITEMS.find((r) => r.path === path);
}

/** The group a path sits in, so the rail can open itself on the current page. */
export function findGroup(path: string): VoltickGroup | undefined {
  return VOLTICK_SECTIONS.find((g) => g.items.some((i) => i.path === path));
}
