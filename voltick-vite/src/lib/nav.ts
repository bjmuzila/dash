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
 * intended state for a page that is planned but not written yet.
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
  blurb: string;
  items: VoltickLink[];
};

export const VOLTICK_SECTIONS: VoltickGroup[] = [
  {
    title: "The console",
    blurb: "Where the merged product starts from: the CB Edge owner console, laid out in full.",
    items: [
      {
        label: "Owner console demo",
        path: "/demo/",
        key: "Demo",
        note: "All 28 routes of the owner console, every record synthetic. Served by the demo-web container, not by this SPA.",
        status: "live",
        external: true,
      },
    ],
  },
  {
    title: "The merger",
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
    title: "Design",
    blurb: "The Voltick system, rendered from the tokens this app actually ships.",
    items: [
      {
        label: "Design system",
        path: "/design-system",
        key: "DesignSystem",
        note: "Surfaces, text, type, shape, elevation and the aurora, drawn live from src/theme.ts.",
        status: "live",
      },
      {
        label: "Colour vocabulary",
        path: "/colours",
        key: "Colours",
        note: "The reserved colours and their marks. Each one means exactly one thing.",
        status: "live",
      },
    ],
  },
  {
    title: "Plumbing",
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
