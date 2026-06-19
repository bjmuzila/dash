"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import { HOME_THEME } from "./homeTheme";

// Routes that render full-bleed without the dashboard sidebar/chrome.
const BARE_ROUTES = ["/", "/sign-in", "/sign-up"];

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
    <div
      style={{
        display: "flex",
        flex: 1,
        overflow: "hidden",
        position: "relative",
        isolation: "isolate",
        background: HOME_THEME.bg,
        backgroundImage: HOME_THEME.shellGlow,
      }}
    >
      <Sidebar />
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0, position: "relative", zIndex: 1 }}>
        {children}
      </main>
    </div>
  );
}
