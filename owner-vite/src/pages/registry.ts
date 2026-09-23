import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

/**
 * key (from lib/nav.ts) → page component, code-split so each route's bundle
 * loads on demand (the giants — Budget, Control Panel, Social Media — stay out
 * of the initial payload).
 */
export const PAGES: Record<string, LazyExoticComponent<ComponentType>> = {
  Hub: lazy(() => import("./Hub")),
  // ControlPanel (Overview) was retired 2026-09-15 — folded into Customers +
  // Admin. Its href redirects; see OWNER_REDIRECTS in nav.
  Admin: lazy(() => import("./Admin")),
  Sales: lazy(() => import("./Sales")),
  Customers: lazy(() => import("./Customers")),
  Visitors: lazy(() => import("./Visitors")),
  Affiliates: lazy(() => import("./Affiliates")),
  Probe: lazy(() => import("./Probe")),
  Results: lazy(() => import("./Results")),
  Backtests: lazy(() => import("./Backtests")),
  // Tree removed from the nav — dropping the lazy() keeps Tree.tsx and
  // pages/tree/* out of the build instead of shipping an unreachable chunk.
  Greeks: lazy(() => import("./Greeks")),
  Dev: lazy(() => import("./Dev")),
  BzilaAlerts: lazy(() => import("./BzilaAlerts")),
  Bot: lazy(() => import("./Bot")),
  Database: lazy(() => import("./Database")),
  DbMap: lazy(() => import("./DbMap")),
  EstimatedMove: lazy(() => import("./EstimatedMove")),
  Changelog: lazy(() => import("./Changelog")),
  SocialMedia: lazy(() => import("./SocialMedia")),
  // Newsletter was removed — the weekly-letter idea log became Media Dump, a
  // flat captioned pile of screenshots/files with no week and no parent idea.
  MediaDump: lazy(() => import("./MediaDump")),
  Emails: lazy(() => import("./Emails")),
  ClientSites: lazy(() => import("./ClientSites")),
  Feedback: lazy(() => import("./Feedback")),
  PostStudio: lazy(() => import("./PostStudio")),
  Budget: lazy(() => import("./Budget")),
  Reta: lazy(() => import("./Reta")),
  Todo: lazy(() => import("./Todo")),
  VoltickAudit: lazy(() => import("./VoltickAudit")),
  ChartsUI: lazy(() => import("./ChartsUI")),
  Watchlists: lazy(() => import("./Watchlists")),
  GexGrowth: lazy(() => import("./GexGrowth")),
  DailyGrades: lazy(() => import("./DailyGrades")),
  LseData: lazy(() => import("./LseData")),
};
