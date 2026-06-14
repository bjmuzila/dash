"use client";

import QuotesPanel from "@/components/shared/QuotesPanel";

export default function QuotesPage() {
  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0, background: "var(--bg, #05080d)" }}>
      <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--border, #1a2a3a)", flexShrink: 0 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "#4a6a84" }}>
          QUOTES — LIVE
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <QuotesPanel />
      </div>
    </div>
  );
}
