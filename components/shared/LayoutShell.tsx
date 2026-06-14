"use client";

import { useState, useEffect } from "react";
import Sidebar from "./Sidebar";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = (mobile: boolean) => {
      setIsMobile(mobile);
      // Default: collapsed on mobile, open on desktop
      setSidebarOpen(!mobile);
    };
    update(mq.matches);
    const handler = (e: MediaQueryListEvent) => update(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden" style={{ position: "relative" }}>
      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 199 }}
        />
      )}

      {/* Sidebar */}
      <div
        style={{
          position: isMobile ? "fixed" : "static",
          top: isMobile ? 0 : "auto",
          left: 0,
          bottom: 0,
          zIndex: isMobile ? 200 : "auto",
          display: sidebarOpen ? "flex" : "none",
          flexDirection: "column",
          height: isMobile ? "100dvh" : "auto",
        }}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} isMobile={isMobile} />
      </div>

      {/* Hamburger toggle — always visible, all screen sizes */}
      <button
        onClick={() => setSidebarOpen(v => !v)}
        aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        style={{
          position: isMobile ? "fixed" : "relative",
          ...(isMobile
            ? { bottom: 16, left: sidebarOpen ? "auto" : 16, right: sidebarOpen ? 16 : "auto", zIndex: 300 }
            : { zIndex: 10, alignSelf: "flex-start", marginTop: 6 }),
          width: 28,
          height: 28,
          borderRadius: isMobile ? "50%" : 4,
          background: "#0a0f16",
          border: "1px solid #1e3050",
          color: "#00e5ff",
          fontSize: isMobile ? 18 : 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
          boxShadow: isMobile ? "0 4px 12px rgba(0,0,0,0.6)" : "none",
        }}
      >
        {sidebarOpen ? "◀" : "☰"}
      </button>

      <main
        className="flex-1 overflow-hidden"
        style={{ display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        {children}
      </main>
    </div>
  );
}
