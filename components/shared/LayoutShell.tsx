"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import GlobalToolbar from "./GlobalToolbar";
import { HOME_THEME } from "./homeTheme";
import { MobileNavProvider, useMobileNav } from "./MobileNavContext";

// Routes that render full-bleed without the dashboard sidebar/chrome.
const BARE_ROUTES = ["/", "/sign-in", "/sign-up", "/terms", "/risk-disclosure", "/privacy", "/disclaimer"];

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function MobileTopBar() {
  const { isMobile } = useMobileNav();
  if (!isMobile) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 52,
        flexShrink: 0,
        padding: "0 14px",
        paddingTop: "env(safe-area-inset-top, 0px)",
        background: "rgba(13,17,25,0.92)",
        backdropFilter: "blur(16px)",
        borderBottom: `1px solid ${HOME_THEME.border}`,
        position: "relative",
        zIndex: 9998,
      }}
    >
      {/* Hamburger moved out to a always-visible floating button (FloatingMenuButton).
          Reserve its footprint so the logo doesn't sit under it. */}
      <div style={{ width: 44, flexShrink: 0 }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/cb-edge-logo.png" alt="CB Edge" style={{ height: 26, width: "auto", display: "block" }} />
    </div>
  );
}

function FloatingMenuButton() {
  const { isMobile, drawerOpen, openDrawer } = useMobileNav();
  // Only on mobile, and only while the drawer is closed (the drawer itself has a
  // close control + tap-out backdrop). Pinned top-left, always on top.
  if (!isMobile || drawerOpen) return null;
  return (
    <button
      aria-label="Open menu"
      onClick={openDrawer}
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 0px) + 10px)",
        left: "calc(env(safe-area-inset-left, 0px) + 10px)",
        zIndex: 10050,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 44,
        height: 44,
        borderRadius: 12,
        border: `1px solid rgba(0,240,255,0.35)`,
        background: "rgba(13,17,25,0.92)",
        backdropFilter: "blur(12px)",
        color: HOME_THEME.cyan,
        boxShadow: "0 4px 16px rgba(0,0,0,0.5), 0 0 12px rgba(0,240,255,0.18)",
        cursor: "pointer",
      }}
    >
      <MenuIcon />
    </button>
  );
}

function DrawerOverlay() {
  const { isMobile, drawerOpen, closeDrawer } = useMobileNav();
  if (!isMobile || !drawerOpen) return null;
  return (
    <div
      onClick={closeDrawer}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(2px)",
        zIndex: 9999,
      }}
    />
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
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
      <MobileTopBar />
      <FloatingMenuButton />
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0, position: "relative" }}>
        <DrawerOverlay />
        <Sidebar />
        <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0, position: "relative", zIndex: 1 }}>
          <GlobalToolbar />
          {children}
        </main>
      </div>
    </div>
  );
}

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isBare = BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));

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
      <ShellInner>{children}</ShellInner>
    </MobileNavProvider>
  );
}
