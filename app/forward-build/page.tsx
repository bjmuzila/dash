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
 */

import { PageShell } from "@/components/shared/PageCard";
import ForwardBuildStructure from "@/components/scanner/ForwardBuildStructure";

export default function ForwardBuildPage() {
  return (
    <PageShell>
      <ForwardBuildStructure />
    </PageShell>
  );
}
