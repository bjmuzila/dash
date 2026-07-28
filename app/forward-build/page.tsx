"use client";

/**
 * /forward-build — standalone Forward Build route.
 *
 * Forward Build used to live only as a tab inside /scanner. It's now its own
 * top-level route so it can be linked, deep-loaded and code-split on its own.
 * In app-vite this file is imported as `@/app/forward-build/page` and mounted at
 * /app/forward-build (see app-vite/src/App.tsx); under Next it's /forward-build.
 * The whole view is the self-contained <ForwardBuildStructure/> component, which
 * fetches GET /proxy/forward-build-structure and renders its own card grid.
 *
 * The scanner tab strip renders above it (link mode) so this page isn't a dead
 * end — every tab navigates back to /scanner?tab=<id>.
 */

import { PageShell } from "@/components/shared/PageCard";
import ScannerTabsBar from "@/components/scanner/ScannerTabsBar";
import ForwardBuildStructure from "@/components/scanner/ForwardBuildStructure";

export default function ForwardBuildPage() {
  return (
    <PageShell>
      <ScannerTabsBar active="forwardbuild" />
      <ForwardBuildStructure />
    </PageShell>
  );
}
