"use client";

import Sidebar from "./Sidebar";
import { HOME_THEME } from "./homeTheme";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        overflow: "hidden",
        position: "relative",
        background: HOME_THEME.bg,
        backgroundImage: HOME_THEME.shellGlow,
      }}
    >
      <Sidebar />
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
        {children}
      </main>
    </div>
  );
}
