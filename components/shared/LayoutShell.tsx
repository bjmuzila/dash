"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import GlobalToolbar from "./GlobalToolbar";
import NotesDock from "./NotesDock";
import { HOME_THEME } from "./homeTheme";
import { MobileNavProvider } from "./MobileNavContext";
import { NotesPanelProvider } from "./NotesPanelContext";
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

function ShellInner({ children }: { children: React.ReactNode }) {
  // Report this route's load/unload to page_load_status. The hook re-runs on every
  // pathname change (pageKey is in its dep array), so client-side nav is tracked too.
  const pathname = usePathname();
  const { key, label } = pageMetaFromPath(pathname);
  usePageLoadStatus({ pageKey: key, pageLabel: label, path: pathname });

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
        <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0, position: "relative", zIndex: 1 }}>
          {children}
        </main>
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

  const isBare = isEmbed || BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));

  if (isBare) {
    return (
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          position: "relative",
          isolation: "isolate",
          background: HOME_THEME.bg,
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <MobileNavProvider>
      <NotesPanelProvider>
        <ShellInner>{children}</ShellInner>
      </NotesPanelProvider>
    </MobileNavProvider>
  );
}
