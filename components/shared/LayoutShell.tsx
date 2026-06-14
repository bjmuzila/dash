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

      {/* Sidebar — always mounted; collapsed rail when closed on desktop */}
      <div
        style={{
          position: isMobile ? "fixed" : "static",
          top: isMobile ? 0 : "auto",
          left: 0,
          bottom: 0,
          zIndex: isMobile ? 200 : "auto",
          display: isMobile && !sidebarOpen ? "none" : "flex",
          flexDirection: "column",
          height: isMobile ? "100dvh" : "auto",
        }}
      >
        <Sidebar
          collapsed={!isMobile && !sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onOpen={() => setSidebarOpen(true)}
          isMobile={isMobile}
        />
      </div>

      <main
        className="flex-1 overflow-hidden"
        style={{ display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        {children}
      </main>
    </div>
  );
}
