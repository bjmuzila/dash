"use client";

import { useState, useEffect, useCallback } from "react";
import { useRefreshButton } from "@/hooks/useRefreshButton";

interface CalEvent {
  date: string;
  time?: string;
  time_formatted?: string;
  type?: string;
  details?: string;
  location?: string;
  coverage?: string;
  daily_text?: string;
}

// Exclude routine noise
const SKIP_DETAILS = ["executive time", "pool call", "in-town pool", "travel pool"];
function shouldSkip(ev: CalEvent): boolean {
  const d = (ev.details || ev.daily_text || "").toLowerCase();
  return SKIP_DETAILS.some(s => d.includes(s));
}

const TYPE_COLORS: Record<string, string> = {
  "pool report":  "#faad14",
  "president":    "#00e5ff",
  "press":        "#a78bfa",
  "travel":       "#f97316",
  "call":         "#22c55e",
  "meeting":      "#00b4ff",
  "remarks":      "#00e676",
  "speech":       "#00e676",
  "briefing":     "#a78bfa",
  "signing":      "#ff9060",
  "executive":    "#3a5570",
};

function getColor(type?: string): string {
  if (!type) return "#6b7280";
  const k = type.toLowerCase();
  for (const [kw, v] of Object.entries(TYPE_COLORS)) {
    if (k.includes(kw)) return v;
  }
  return "#9ca3af";
}

// ET today as YYYY-MM-DD
function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export default function EconCalendarPanel() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const doLoad = useCallback(async () => {
    const res = await fetch("/api/calendar");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    setEvents(json.events ?? []);
  }, []);

  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(async () => {
    setLoading(true);
    try { await doLoad(); } finally { setLoading(false); }
  });

  useEffect(() => {
    doLoad().finally(() => setLoading(false));
  }, [doLoad]);

  const today = etToday();
  const todayEvents = events
    .filter(e => e.date === today && !shouldSkip(e))
    .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--overview-bg, #05080d)", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "5px 10px", background: "var(--overview-header-bg, #070c14)",
        borderBottom: "1px solid var(--overview-border-soft, #0d1f30)",
        display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: "#fff", fontWeight: 700 }}>
          📅 Economic Calendar
        </span>
        <span style={{ fontSize: 9, color: "#1e3050", marginLeft: 4 }}>{today}</span>
        <button onClick={trigger} style={{ marginLeft: "auto", ...btnStyle }}>
          {btnLabel}
        </button>
      </div>

      {/* Events */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
        {loading ? (
          <div style={{ color: "#1e3050", fontSize: 11, padding: "4px 0" }}>Loading…</div>
        ) : todayEvents.length === 0 ? (
          <div style={{ color: "#1e3050", fontSize: 11, padding: "4px 0" }}>No events today ({today}).</div>
        ) : (
          todayEvents.map((ev, i) => (
            <div
              key={i}
              style={{
                display: "grid", gridTemplateColumns: "56px 1fr",
                gap: 6, padding: "4px 6px",
                background: "var(--overview-card-bg, #05080d)", border: "1px solid var(--overview-border-soft, #0d1f30)",
                borderLeft: `3px solid ${getColor(ev.type)}`, borderRadius: 3,
              }}
            >
              <div style={{ fontSize: 9, fontFamily: "inherit", color: "#6b7280", paddingTop: 1 }}>
                {ev.time_formatted ?? (ev.time ? ev.time.slice(0, 5) : "TBD")}
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: getColor(ev.type), textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2 }}>
                  {ev.type}
                </div>
                <div style={{ fontSize: 11, color: "#c8d8e8", lineHeight: 1.3 }}>
                  {ev.details || ev.daily_text || "—"}
                </div>
                {ev.location && (
                  <div style={{ fontSize: 9, color: "#3a5570", marginTop: 1 }}>{ev.location}</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
