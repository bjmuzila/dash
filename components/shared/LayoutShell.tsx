"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import GlobalToolbar from "./GlobalToolbar";
import V3LegacyToolbar from "./V3LegacyToolbar";
import PublicNav from "@/components/landing/PublicNav";
import { useAuth } from "@/components/auth/AuthProvider";
import OwnerSidebar, { isOwnerChromePath } from "./OwnerSidebar";
import NotesDock from "./NotesDock";
import NoteClipMenu from "./NoteClipMenu";
import GexDock from "./GexDock";
import { HOME_THEME } from "./homeTheme";
import { MobileNavProvider } from "./MobileNavContext";
import { NotesPanelProvider } from "./NotesPanelContext";
import { GexPanelProvider } from "./GexPanelContext";
import { usePageLoadStatus } from "@/lib/pageStatus";

// Routes that render full-bleed without the dashboard chrome.
const BARE_ROUTES = ["/", "/sign-in", "/sign-up", "/explore", "/pricing", "/terms", "/risk-disclosure", "/privacy", "/disclaimer"];

// Turn a pathname into a stable key + readable label for Page Activity, so every
// route auto-reports without each page wiring the hook itself.
//   "/dev/owner"        → { key: "dev/owner", label: "Dev / Owner" }
//   "/personal/todo"    → { key: "personal/todo", label: "Personal / Todo" }
//   "/"                 → { key: "home",  label: "Home" }
function pageMetaFromPath(pathname: string): { key: string; label: string } {
  const trimmed = (pathname || "/").replace(/^\/+|\/+$/g, "");
  if (!trimmed) return { key: "home", label: "Home" };
  const label = trimmed
    .split("/")
    .map((seg) => seg.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(" / ");
  return { key: trimmed, label };
}

// Fires the page_visits beacon for a route. Used on BARE public routes (landing,
// sign-up, pricing, …) which skip ShellInner and were therefore untracked — i.e.
// ALL logged-out funnel traffic was invisible in analytics. Chrome routes keep
// tracking via ShellInner, so the two paths never double-report (mutually exclusive).
function VisitTracker() {
  const pathname = usePathname();
  const { key, label } = pageMetaFromPath(pathname);
  usePageLoadStatus({ pageKey: key, pageLabel: label, path: pathname });
  return null;
}

/**
 * Which top bar this shell wears.
 *
 *   "app"        GlobalToolbar — the full v2 toolbar. Every Next route that
 *                renders through app/layout.tsx: the owner hub, /guide, /docs,
 *                /whats-new, /feedback. Unchanged, and the default.
 *
 *   "v2-legacy"  V3LegacyToolbar — v3's palette, v3's nav, a Legacy menu and a
 *                ← Back to v3 button. Passed by app-vite/src/App.tsx and by
 *                nothing else: the Vite SPA at /app/* is the legacy wing now
 *                (v3 is the dashboard — see lib/v3Routes.ts), and GlobalToolbar
 *                there would be a strip of nav items that redirect out from
 *                under the click. The docks and providers below stay mounted
 *                either way; only the bar changes.
 */
export type ShellChrome = "app" | "v2-legacy";

function ShellInner({ children, chrome }: { children: React.ReactNode; chrome: ShellChrome }) {
  // Report this route's load/unload to page_load_status. The hook re-runs on every
  // pathname change (pageKey is in its dep array), so client-side nav is tracked too.
  const pathname = usePathname();
  const { key, label } = pageMetaFromPath(pathname);
  usePageLoadStatus({ pageKey: key, pageLabel: label, path: pathname });

  // Owner + backend routes get the shared left rail here (single mount point), so
  // root-level backend pages (/database, /logs, …) no longer lose it.
  const showOwnerRail = isOwnerChromePath(pathname);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        overflow: "hidden",
        position: "relative",
        isolation: "isolate",
        background: HOME_THEME.bg,
        backgroundImage: HOME_THEME.shellGlow,
      }}
    >
      {/* Top toolbar spans the full window width. On "app" chrome navigation
          lives in its hamburger dropdown (NavMenu) — there is no persistent
          sidebar. On "v2-legacy" the bar is v3's, and its nav leaves for /v3. */}
      {chrome === "v2-legacy" ? <V3LegacyToolbar /> : <GlobalToolbar />}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0, position: "relative" }}>
        {showOwnerRail && (
          <Suspense fallback={null}>
            <OwnerSidebar />
          </Suspense>
        )}
        <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0, position: "relative", zIndex: 1 }}>
          {children}
        </main>
        <GexDock />
        <NotesDock />
      </div>
      {/* App-wide right-click → "Add to Notes". One mount for every dashboard
          route; renders nothing until a right-click has something to clip. */}
      <NoteClipMenu />
    </div>
  );
}

export default function LayoutShell({
  children,
  chrome = "app",
}: {
  children: React.ReactNode;
  /** Which top bar to wear — see ShellChrome above. Defaults to the v2 toolbar,
   *  so every existing call site (app/layout.tsx) is unchanged. */
  chrome?: ShellChrome;
}) {
  const pathname = usePathname();
  // Embed mode (?embed=1): render full-bleed with no global toolbar/nav/notes, so
  // a page can be iframed as a dashboard card and show only its own UI + content.
  // Read from window on the client (avoids forcing the whole app under Suspense
  // that useSearchParams would require).
  const [isEmbed, setIsEmbed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsEmbed(new URLSearchParams(window.location.search).get("embed") === "1");
  }, [pathname]);

  // Dual-audience routes: in-app pages for members (full dashboard chrome) AND
  // pages that must render for signed-OUT visitors. A guest must NOT get the
  // app's GlobalToolbar/OwnerSidebar/docks — that nav links to paywalled routes
  // and the docks mount the live feed — so they get the marketing toolbar
  // instead. Wait for isLoaded so we don't flash the wrong chrome.
  //   /docs      — end-user KB, linked from the public toolbar.
  //   /whats-new — customer changelog; public because shipping every week is a
  //                selling point (also allowlisted in middleware.ts). Without
  //                this branch a guest would land on the changelog wearing the
  //                paid dashboard's chrome, every link in it bouncing to "/".
  const { isSignedIn, isLoaded } = useAuth();
  const isGuest = isLoaded && !isSignedIn;
  const isPublicDocs = isGuest && (pathname === "/docs" || pathname.startsWith("/docs/"));
  const isPublicWhatsNew = isGuest && pathname === "/whats-new";
  const isPublicChrome = isPublicDocs || isPublicWhatsNew;

  const isBare =
    isEmbed || isPublicChrome || BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));

  if (isBare) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: isPublicDocs ? "auto" : "hidden",
          position: "relative",
          isolation: "isolate",
          background: HOME_THEME.bg,
        }}
      >
        {!isEmbed && <VisitTracker />}
        {/* Sticky — reserves its own height, no spacer needed. /whats-new is not
            one of PUBLIC_NAV's pills, so no pill is marked current there. */}
        {isPublicChrome && <PublicNav active={isPublicDocs ? "Docs" : undefined} />}
        {children}
      </div>
    );
  }

  return (
    <MobileNavProvider>
      <NotesPanelProvider>
        <GexPanelProvider>
          <ShellInner chrome={chrome}>{children}</ShellInner>
        </GexPanelProvider>
      </NotesPanelProvider>
    </MobileNavProvider>
  );
}
