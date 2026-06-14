"use client";

import { useState, useEffect } from "react";
import Sidebar from "./Sidebar";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // On desktop (≥768px), sidebar is always visible
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const showSidebar = !isMobile || sidebarOpen;

  return (
    <div className="flex flex-1 overflow-hidden" style={{ position: "relative" }}>
      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 199,
          }}
        />
      )}

      {/* Sidebar — absolute on mobile, static on desktop */}
      <div
        style={{
          position: isMobile ? "fixed" : "static",
          top: isMobile ? 0 : "auto",
          left: 0,
          bottom: 0,
          zIndex: isMobile ? 200 : "auto",
          display: showSidebar ? "flex" : "none",
          flexDirection: "column",
          height: isMobile ? "100dvh" : "auto",
        }}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} isMobile={isMobile} />
      </div>

      {/* Hamburger button (mobile only) */}
      {isMobile && !sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
          style={{
            position: "fixed",
            bottom: 16,
            left: 16,
            zIndex: 300,
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "#0a0f16",
            border: "1px solid #1e3050",
            color: "#00e5ff",
            fontSize: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,0.6)",
          }}
        >
          ☰
        </button>
      )}

      <main
        className="flex-1 overflow-hidden"
        style={{ display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        {children}
      </main>
    </div>
  );
}
