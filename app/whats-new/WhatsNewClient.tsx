"use client";

import { useState } from "react";
import { PageShell, Card } from "@/components/shared/PageCard";
import { HOME_THEME } from "@/components/shared/homeTheme";

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
    border: active ? `1px solid ${HOME_THEME.cyan}80` : "1px solid transparent",
    background: active ? `${HOME_THEME.cyan}26` : "transparent",
    color: active ? HOME_THEME.cyan : HOME_THEME.muted + "99",
    transition: "all 0.15s",
    letterSpacing: "0.04em",
  });

  return (
    <PageShell maxWidth={860}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <div style={{
            display: "inline-block",
            fontSize: 11,
            color: HOME_THEME.cyan,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            fontWeight: 800,
            marginBottom: 10,
            background: `${HOME_THEME.cyan}1A`,
            border: `1px solid ${HOME_THEME.cyan}40`,
            borderRadius: 6,
            padding: "3px 10px",
          }}>
            Product Updates
          </div>
          <h1 style={{ fontSize: 38, lineHeight: 1.1, margin: "0 0 8px", fontWeight: 800, letterSpacing: "-0.02em", color: HOME_THEME.text }}>
            What&apos;s New
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: HOME_THEME.muted + "99" }}>
            The latest improvements and what&apos;s coming next.
          </p>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex",
          gap: 4,
          background: HOME_THEME.panelBgStrong,
          border: `1px solid ${HOME_THEME.border}`,
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
            <div style={{ fontSize: 13, color: HOME_THEME.muted + "99" }}>No updates yet.</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {entries.map((entry, i) => (
              <Card key={i} accent="cyan" padding="20px 24px">
                <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.04em", color: HOME_THEME.cyan, marginBottom: 14 }}>
                  {entry.date}
                </div>
                <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  {entry.items.map((item, j) => (
                    <li key={j} style={{ fontSize: 14, lineHeight: 1.65, color: HOME_THEME.text, display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{ color: HOME_THEME.cyan, marginTop: 3, flexShrink: 0 }}>▸</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Coming Soon tab */}
      {tab === "coming-soon" && (
        <div>
          <div style={{ fontSize: 13, color: HOME_THEME.muted + "99", marginBottom: 20 }}>
            A look at what we&apos;re building — features actively in development or planned.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {COMING_SOON.map((item, i) => (
              <Card key={i} accent="cyan" variant="classic" padding="18px 22px" style={{ position: "relative", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                  {/* Subtle left accent */}
                  <div style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 3,
                    background: `linear-gradient(to bottom, ${HOME_THEME.cyan}99, ${HOME_THEME.cyan}1A)`,
                    borderRadius: "18px 0 0 18px",
                  }} />

                  {/* Icon */}
                  <div style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: `${HOME_THEME.cyan}1A`,
                    border: `1px solid ${HOME_THEME.cyan}33`,
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
                    <div style={{ fontSize: 14, fontWeight: 600, color: HOME_THEME.text, lineHeight: 1.5 }}>
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
                        color: HOME_THEME.orange,
                        background: `${HOME_THEME.orange}1A`,
                        border: `1px solid ${HOME_THEME.orange}4D`,
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
                        color: HOME_THEME.cyan,
                        background: `${HOME_THEME.cyan}1A`,
                        border: `1px solid ${HOME_THEME.cyan}40`,
                        borderRadius: 6,
                        padding: "4px 10px",
                        whiteSpace: "nowrap",
                      }}>
                        Coming Soon
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}
