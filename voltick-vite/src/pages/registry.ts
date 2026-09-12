import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

/**
 * key (from lib/nav.ts) → page component, code split so each route's bundle
 * loads on demand.
 *
 * A key listed in nav.ts but missing here renders Placeholder, which is the
 * correct state for a page that is planned and not yet written. A key here with
 * no nav entry ships a chunk nothing links to, so do not leave one behind.
 */
export const PAGES: Record<string, LazyExoticComponent<ComponentType>> = {
  DesignSystem: lazy(() => import("./DesignSystem")),
  Colours: lazy(() => import("./Colours")),
  FeedCheck: lazy(() => import("./FeedCheck")),
  // Overview, SurfaceMap, Vocabulary and Questions are listed in nav.ts and
  // render Placeholder until a component lands here.
};
