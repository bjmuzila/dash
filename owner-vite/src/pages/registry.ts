import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

/**
 * key (from lib/nav.ts) → page component, code-split so each route's bundle
 * loads on demand (the giants — Budget, Control Panel, Social Media — stay out
 * of the initial payload).
 */
export const PAGES: Record<string, LazyExoticComponent<ComponentType>> = {
  Hub: lazy(() => import("./Hub")),
  ControlPanel: lazy(() => import("./ControlPanel")),
  Admin: lazy(() => import("./Admin")),
  Sales: lazy(() => import("./Sales")),
  Affiliates: lazy(() => import("./Affiliates")),
  Visitors: lazy(() => import("./Visitors")),
  Probe: lazy(() => import("./Probe")),
  Results: lazy(() => import("./Results")),
  Backtests: lazy(() => import("./Backtests")),
  // Tree removed from the nav — dropping the lazy() keeps Tree.tsx and
  // pages/tree/* out of the build instead of shipping an unreachable chunk.
  Greeks: lazy(() => import("./Greeks")),
  Dev: lazy(() => import("./Dev")),
  BzilaAlerts: lazy(() => import("./BzilaAlerts")),
  Database: lazy(() => import("./Database")),
  EstimatedMove: lazy(() => import("./EstimatedMove")),
  Changelog: lazy(() => import("./Changelog")),
  SocialMedia: lazy(() => import("./SocialMedia")),
  Newsletter: lazy(() => import("./Newsletter")),
  Emails: lazy(() => import("./Emails")),
  Feedback: lazy(() => import("./Feedback")),
  PostStudio: lazy(() => import("./PostStudio")),
  Budget: lazy(() => import("./Budget")),
  Reta: lazy(() => import("./Reta")),
  Todo: lazy(() => import("./Todo")),
  ChartsUI: lazy(() => import("./ChartsUI")),
  Watchlists: lazy(() => import("./Watchlists")),
  GexGrowth: lazy(() => import("./GexGrowth")),
  DailyGrades: lazy(() => import("./DailyGrades")),
  Labs: lazy(() => import("./GexSurface")),
};
