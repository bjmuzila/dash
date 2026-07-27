"use client";

import { usePathname } from "next/navigation";
import { usePageLoadStatus } from "@/lib/pageStatus";

/**
 * Fires the /api/page-status beacon on the PUBLIC, Next-rendered pages.
 *
 * Why this exists: every dashboard page calls usePageLoadStatus() itself, but
 * those all live behind auth. The pages where acquisition actually happens —
 * the landing page, /pricing, /docs — were never tracked at all, so a visitor
 * arriving from Google and bouncing off /pricing left no row anywhere. That also
 * meant referrer/UTM capture had nothing to attach to: by the time a tracked
 * page loaded, the visitor had already signed in and document.referrer was us.
 *
 * ONLY the routes below are tracked. The dashboard pages under app/<name>/page.tsx
 * are excluded on purpose: they're served by the Vite SPA and already fire their
 * own beacon, so tracking them here too would double-count every load.
 */
const MARKETING_ROUTES: RegExp[] = [
  /^\/$/,
  /^\/pricing$/,
  /^\/docs(\/.*)?$/,
  /^\/explore(\/.*)?$/,
  /^\/whats-new$/,
  /^\/about-me$/,
  /^\/sign-in(\/.*)?$/,
  /^\/sign-up(\/.*)?$/,
  /^\/checkout\/success$/,
  /^\/coming-soon$/,
  /^\/terms$/,
  /^\/privacy$/,
  /^\/disclaimer$/,
  /^\/risk-disclosure$/,
];

/** Stable page_key per marketing route. "/" → "landing", "/docs/x" → "docs". */
function keyFor(pathname: string): string {
  if (pathname === "/") return "landing";
  const [, first = ""] = pathname.split("/");
  return first || "landing";
}

function Beacon({ pathname }: { pathname: string }) {
  // Keyed by pathname at the call site below, so this remounts per route and the
  // hook's effect re-runs — matching how a full page load would behave.
  usePageLoadStatus({
    pageKey: `public:${keyFor(pathname)}`,
    pageLabel: pathname,
    path: pathname,
  });
  return null;
}

export default function MarketingPageTracker() {
  const pathname = usePathname();
  if (!pathname || !MARKETING_ROUTES.some((re) => re.test(pathname))) return null;
  // key= forces a remount on route change; hooks can't be called conditionally,
  // which is why the hook lives in the child rather than here.
  return <Beacon key={pathname} pathname={pathname} />;
}
