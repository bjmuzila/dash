"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import GlobalToolbar from "./GlobalToolbar";
import PublicNav, { PUBLIC_NAV_HEIGHT } from "@/components/landing/PublicNav";
import { useAuth } from "@/components/auth/AuthProvider";
import OwnerSidebar, { isOwnerChromePath } from "./OwnerSidebar";
import NotesDock from "./NotesDock";
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

function ShellInner({ children }: { children: React.ReactNode }) {
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
      {/* Top toolbar spans the full window width. Navigation lives in its
          hamburger dropdown (NavMenu) — there is no persistent sidebar. */}
      <GlobalToolbar />
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
    </div>
  );
}

export default function LayoutShell({ children }: { children: React.ReactNode }) {
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

  // /docs is dual-audience: in-app help for members (full dashboard chrome) AND
  // a public KB linked from the marketing toolbar. For signed-out visitors it
  // must NOT show the app's GlobalToolbar/sidebar — it gets the public toolbar
  // instead. Wait for isLoaded so we don't flash the wrong chrome.
  const { isSignedIn, isLoaded } = useAuth();
  const isPublicDocs = isLoaded && !isSignedIn && (pathname === "/docs" || pathname.startsWith("/docs/"));

  const isBare =
    isEmbed || isPublicDocs || BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));

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
        {isPublicDocs && (
          <>
            <PublicNav active="Docs" />
            <div style={{ height: PUBLIC_NAV_HEIGHT, flexShrink: 0 }} />
          </>
        )}
        {children}
      </div>
    );
  }

  return (
    <MobileNavProvider>
      <NotesPanelProvider>
        <GexPanelProvider>
          <ShellInner>{children}</ShellInner>
        </GexPanelProvider>
      </NotesPanelProvider>
    </MobileNavProvider>
  );
}
