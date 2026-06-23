"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import { HOME_THEME } from "./homeTheme";
import { MobileNavProvider, useMobileNav } from "./MobileNavContext";

// Routes that render full-bleed without the dashboard sidebar/chrome.
const BARE_ROUTES = ["/", "/sign-in", "/sign-up"];

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function MobileTopBar() {
  const { isMobile, drawerOpen, toggleDrawer } = useMobileNav();
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
      <button
        aria-label={drawerOpen ? "Close menu" : "Open menu"}
        onClick={toggleDrawer}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 40,
          borderRadius: 10,
          border: `1px solid ${HOME_THEME.border}`,
          background: "rgba(255,255,255,0.04)",
          color: HOME_THEME.text,
          cursor: "pointer",
        }}
      >
        {drawerOpen ? <CloseIcon /> : <MenuIcon />}
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/cb-edge-logo.png" alt="CB Edge" style={{ height: 26, width: "auto", display: "block" }} />
    </div>
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
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0, position: "relative" }}>
        <DrawerOverlay />
        <Sidebar />
        <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0, position: "relative", zIndex: 1 }}>
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
