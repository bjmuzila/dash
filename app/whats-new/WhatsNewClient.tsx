"use client";

import { useState } from "react";

type Entry = { date: string; items: string[] };

const COMING_SOON: string[] = [
  // Add ideas here
  "Mobile-optimized dashboard view",
  "Custom alert notifications for GEX levels",
  "Multi-expiry GEX comparison chart",
  "Dark/light theme toggle",
];

export default function WhatsNewClient({ entries }: { entries: Entry[] }) {
  const [tab, setTab] = useState<"updates" | "coming-soon">("updates");

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 18px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    border: active ? "1px solid rgba(33,158,188,0.5)" : "1px solid transparent",
    background: active ? "rgba(33,158,188,0.15)" : "transparent",
    color: active ? "#219EBC" : "#8a99b0",
    transition: "all 0.15s",
    letterSpacing: "0.04em",
  });

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        background:
          "radial-gradient(circle at top, rgba(33,158,188,0.08), transparent 40%), #05080d",
        padding: "24px 20px",
        color: "#e8edf5",
        fontFamily:
          "var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <div
              style={{
                fontSize: 14,
                color: "#FFFFFF",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                fontWeight: 800,
                marginBottom: 8,
              }}
            >
              Product Updates
            </div>
            <h1 style={{ fontSize: 36, lineHeight: 1.1, margin: "0 0 10px", fontWeight: 800 }}>
              What&apos;s New
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: "#FFFFFF" }}>
              The latest improvements to your dashboard, in plain English.
            </p>
          </div>

          {/* Tabs */}
          <div
            style={{
              display: "flex",
              gap: 4,
              background: "rgba(13,17,25,0.7)",
              border: "1px solid rgba(33,158,188,0.12)",
              borderRadius: 10,
              padding: 4,
              marginTop: 4,
              flexShrink: 0,
            }}
          >
            <button style={tabStyle(tab === "updates")} onClick={() => setTab("updates")}>
              Updates
            </button>
            <button style={tabStyle(tab === "coming-soon")} onClick={() => setTab("coming-soon")}>
              Coming Soon
            </button>
          </div>
        </div>

        {/* Updates tab */}
        {tab === "updates" && (
          <>
            {entries.length === 0 && (
              <div style={{ fontSize: 13, color: "#FFFFFF" }}>No updates yet.</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {entries.map((entry, i) => (
                <div
                  key={i}
                  style={{
                    border: "1px solid rgba(33,158,188,0.16)",
                    borderTop: "2px solid rgba(33,158,188,0.45)",
                    borderRadius: 16,
                    background:
                      "radial-gradient(circle at 50% 0%, rgba(33,158,188,0.08) 0%, transparent 55%), rgba(13,17,25,0.72)",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
                    padding: "16px 20px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      color: "#219EBC",
                      marginBottom: 12,
                    }}
                  >
                    {entry.date}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                    {entry.items.map((item, j) => (
                      <li key={j} style={{ fontSize: 14, lineHeight: 1.6, color: "#e8edf5" }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Coming Soon tab */}
        {tab === "coming-soon" && (
          <div
            style={{
              border: "1px solid rgba(33,158,188,0.16)",
              borderTop: "2px solid rgba(33,158,188,0.45)",
              borderRadius: 16,
              background:
                "radial-gradient(circle at 50% 0%, rgba(33,158,188,0.08) 0%, transparent 55%), rgba(13,17,25,0.72)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
              padding: "20px 24px",
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 800,
                letterSpacing: "0.06em",
                color: "#219EBC",
                marginBottom: 16,
              }}
            >
              On the Roadmap
            </div>
            {COMING_SOON.length === 0 ? (
              <p style={{ fontSize: 13, color: "#8a99b0", margin: 0 }}>Nothing listed yet — check back soon.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 10 }}>
                {COMING_SOON.map((item, i) => (
                  <li key={i} style={{ fontSize: 14, lineHeight: 1.6, color: "#e8edf5" }}>
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
