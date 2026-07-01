"use client";

import { useState } from "react";

type Entry = { date: string; items: string[] };

const COMING_SOON: { label: string; eta?: string; icon: string }[] = [
  {
    icon: "⚡",
    label: "Fully finished Options Flow page with the most advanced tracking and data",
  },
  {
    icon: "🔥",
    label: "Multiple heatmap charts on the Candles page",
  },
  {
    icon: "📐",
    label: "ICT fully automatic charting for ESU & NQU with triggered alerts and results",
    eta: "Expected August",
  },
  {
    icon: "🗺️",
    label: "Full Footprint charts with Bookmap-style heatmap, big orders, and automated strategy alerts",
    eta: "Expected August",
  },
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
          "radial-gradient(ellipse at 20% 0%, rgba(33,158,188,0.10) 0%, transparent 50%), #05080d",
        padding: "32px 24px",
        color: "#e8edf5",
        fontFamily: "var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        {/* Header row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 32 }}>
          <div>
            <div style={{
              display: "inline-block",
              fontSize: 11,
              color: "#219EBC",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              fontWeight: 800,
              marginBottom: 10,
              background: "rgba(33,158,188,0.1)",
              border: "1px solid rgba(33,158,188,0.25)",
              borderRadius: 6,
              padding: "3px 10px",
            }}>
              Product Updates
            </div>
            <h1 style={{ fontSize: 38, lineHeight: 1.1, margin: "0 0 8px", fontWeight: 800, letterSpacing: "-0.02em" }}>
              What&apos;s New
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: "#8a99b0" }}>
              The latest improvements and what&apos;s coming next.
            </p>
          </div>

          {/* Tabs */}
          <div style={{
            display: "flex",
            gap: 4,
            background: "rgba(13,17,25,0.8)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 10,
            padding: 4,
            marginTop: 6,
            flexShrink: 0,
          }}>
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
              <div style={{ fontSize: 13, color: "#8a99b0" }}>No updates yet.</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {entries.map((entry, i) => (
                <div key={i} style={{
                  border: "1px solid rgba(33,158,188,0.13)",
                  borderTop: "2px solid rgba(33,158,188,0.45)",
                  borderRadius: 16,
                  background: "radial-gradient(circle at 50% 0%, rgba(33,158,188,0.07) 0%, transparent 60%), rgba(13,17,25,0.75)",
                  boxShadow: "0 4px 32px rgba(0,0,0,0.3)",
                  padding: "20px 24px",
                }}>
                  <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.04em", color: "#219EBC", marginBottom: 14 }}>
                    {entry.date}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                    {entry.items.map((item, j) => (
                      <li key={j} style={{ fontSize: 14, lineHeight: 1.65, color: "#c8d4e3", display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span style={{ color: "#219EBC", marginTop: 3, flexShrink: 0 }}>▸</span>
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
          <div>
            <div style={{ fontSize: 13, color: "#8a99b0", marginBottom: 20 }}>
              A look at what we&apos;re building — features actively in development or planned.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {COMING_SOON.map((item, i) => (
                <div key={i} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 18,
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 14,
                  background: "rgba(13,17,25,0.7)",
                  padding: "18px 22px",
                  boxShadow: "0 2px 20px rgba(0,0,0,0.25)",
                  transition: "border-color 0.15s",
                  position: "relative",
                  overflow: "hidden",
                }}>
                  {/* Subtle left accent */}
                  <div style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 3,
                    background: "linear-gradient(to bottom, rgba(33,158,188,0.6), rgba(33,158,188,0.1))",
                    borderRadius: "14px 0 0 14px",
                  }} />

                  {/* Icon */}
                  <div style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: "rgba(33,158,188,0.10)",
                    border: "1px solid rgba(33,158,188,0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    flexShrink: 0,
                  }}>
                    {item.icon}
                  </div>

                  {/* Label */}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#dde6f0", lineHeight: 1.5 }}>
                      {item.label}
                    </div>
                  </div>

                  {/* ETA badge or "Coming Soon" */}
                  <div style={{ flexShrink: 0 }}>
                    {item.eta ? (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        color: "#f59e0b",
                        background: "rgba(245,158,11,0.1)",
                        border: "1px solid rgba(245,158,11,0.3)",
                        borderRadius: 6,
                        padding: "4px 10px",
                        whiteSpace: "nowrap",
                      }}>
                        {item.eta}
                      </span>
                    ) : (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        color: "#219EBC",
                        background: "rgba(33,158,188,0.10)",
                        border: "1px solid rgba(33,158,188,0.25)",
                        borderRadius: 6,
                        padding: "4px 10px",
                        whiteSpace: "nowrap",
                      }}>
                        Coming Soon
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
