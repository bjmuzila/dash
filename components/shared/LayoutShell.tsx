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

// Next routes that wear V3LegacyToolbar instead of GlobalToolbar.
//
// /feedback is support chrome reached FROM a dashboard page, and every dashboard
// page wears v3's bar now — landing on the old v2 toolbar mid-conversation reads
// as having been dropped into a different product.
//
// SINCE 2026-09-09 THIS IS THE FALLBACK, not the main path: /feedback was ported
// into v3 (cbedge-v3/src/pages/Feedback.tsx, served at /v3/feedback) and v3's
// account menu links there, so a customer inside v3 never arrives here. What
// still does is the v2 wing — its account menu points at this page, and those
// pages wear V3LegacyToolbar, which is exactly what this line gives it.
//
// /whats-new is the same story: the customer changelog is reached from the
// account menu on both wings, and for a SIGNED-IN customer every dashboard page
// around it now wears v3's bar. Landing on the old v2 toolbar to read the
// changelog reads as a different product. (Signed-OUT visitors never get here —
// the isPublicWhatsNew branch below sends them down the bare/PublicNav path,
// which is still the right chrome for a guest.)
//
// The page itself is unchanged; only the bar above it is. Prefix-matched, so
// /feedback/anything follows.
const V3_CHROME_ROUTES = ["/feedback", "/whats-new"];

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

// The bare public routes used to mount a VisitTracker here (page_key "home",
// "pricing", …). REMOVED 2026-09-10: app/layout.tsx mounts
// components/analytics/MarketingPageTracker for the same routes with the
// stable "public:<key>" keys, so every public page load was writing TWO
// page_visits rows under two different keys. Sessions were not doubled (the
// entry claim is once per tab) but page counts were. One tracker, the one
// whose keys the owner Overview already reads.

/**
 * Which top bar this shell wears.
 *
 *   "app"        GlobalToolbar — the full v2 toolbar. Every Next route that
 *                renders through app/layout.tsx: the owner hub, /guide, /docs.
 *                Unchanged, and the default.
 *
 *   "v2-legacy"  V3LegacyToolbar — v3's palette, v3's nav, a Legacy menu and a
 *                ← Back to v3 button. Two ways in: app-vite/src/App.tsx passes
 *                it explicitly (the Vite SPA at /app/* is the legacy wing now —
 *                v3 is the dashboard, see lib/v3Routes.ts — and GlobalToolbar
 *                there would be a strip of nav items that redirect out from
 *                under the click), and V3_CHROME_ROUTES above selects it by
 *                pathname for Next pages that hang off the v3 dashboard
 *                (/feedback, /whats-new). The docks and providers below stay
 *                mounted either way; only the bar changes.
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

  // A route in V3_CHROME_ROUTES overrides whatever the caller asked for — the
  // only caller that passes `chrome` is the SPA, which never renders these.
  const effectiveChrome: ShellChrome =
    V3_CHROME_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/")) ? "v2-legacy" : chrome;

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
          <ShellInner chrome={effectiveChrome}>{children}</ShellInner>
        </GexPanelProvider>
      </NotesPanelProvider>
    </MobileNavProvider>
  );
}
