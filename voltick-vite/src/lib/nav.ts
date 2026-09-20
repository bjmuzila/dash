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
 * intended state for a page that is being written. Every page listed today is
 * built: the list carries no planned entries, and a new one lands here only
 * once its component exists.
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
      {
        label: "Visitors map",
        path: "/visitors-map",
        key: "VisitorsMap",
        note: "The owner console's visitor map, ported component for component, drawing synthetic loads.",
        status: "live",
      },
    ],
  },
  {
    title: "CB Edge v3",
    icon: "📊",
    blurb:
      "The v3 board and its pages, repainted in Voltick. Its own app in its own container, framed inside this site so the bars above and to the left stay with you.",
    items: [
      {
        label: "The v3 board",
        path: "/v3-board",
        key: "V3Board",
        note: "Every card and every page of v3, in Voltick surfaces and the Voltick colour vocabulary. Framed inside this site, so these bars stay put.",
        status: "live",
      },
    ],
  },
  {
    title: "Reference",
    icon: "\ud83d\udcd0",
    blurb:
      "What the engine actually computes, written down. Transcribed from the source that runs, not from a description of it.",
    items: [
      {
        label: "Formula reference",
        path: "/formulas",
        key: "Formulas",
        note: "Every formula, constant and threshold CB Edge computes: greeks, the exposure grids, profile and initial balance, the detectors, the scoring tables.",
        status: "live",
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
      {
        label: "Data flow",
        path: "/data-flow",
        key: "DataFlow",
        note: "Every path a number takes to reach a card in v3: the feeds, server-v2, the one socket, the store, the hooks.",
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
