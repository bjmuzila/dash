"use client";

import { useState, useEffect, useCallback } from "react";

interface CalEvent {
  date: string;
  time: string;
  time_formatted: string;
  title: string;
  country: string;
  impact: string;
  forecast: string;
  previous: string;
  actual: string;
}

const IMPACT_COLOR: Record<string, string> = {
  High:      "#ef4444",
  Medium:    "#faad14",
  Low:       "#3a5570",
  Holiday:   "#6b7280",
  President: "#a855f7",
};

function impactColor(impact: string): string {
  return IMPACT_COLOR[impact] ?? "#3a5570";
}

function groupByDate(events: CalEvent[]): Record<string, CalEvent[]> {
  const groups: Record<string, CalEvent[]> = {};
  for (const ev of events) {
    if (!groups[ev.date]) groups[ev.date] = [];
    groups[ev.date].push(ev);
  }
  return groups;
}

export default function EconomicCalendarPage() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [econRes, trumpRes] = await Promise.all([
        fetch("/api/calendar"),
        fetch("/api/trump-calendar"),
      ]);
      const econJson = await econRes.json();
      const trumpJson = trumpRes.ok ? await trumpRes.json() : { events: [] };
      if (!econRes.ok) {
        setError(econJson.error ?? `HTTP ${econRes.status}`);
        return;
      }
      const merged = [
        ...(econJson.events ?? []),
        ...(trumpJson.events ?? []),
      ].sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time));
      setEvents(merged);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  // Next 7 days from today (inclusive)
  const next7: Set<string> = new Set();
  const todayDate = new Date(today + "T12:00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(todayDate);
    d.setDate(todayDate.getDate() + i);
    next7.add(d.toISOString().slice(0, 10));
  }

  const filtered = events.filter(ev => {
    const inRange = next7.has(ev.date);
    const matchesFilter = !filter || (
      ev.title?.toLowerCase().includes(filter.toLowerCase()) ||
      ev.country?.toLowerCase().includes(filter.toLowerCase()) ||
      ev.impact?.toLowerCase().includes(filter.toLowerCase())
    );
    return inRange && matchesFilter;
  });

  const groups = groupByDate(filtered);
  const sortedDates = Object.keys(groups).sort();

  return (
    <div className="flex flex-col h-full" style={{ background: "#05080d" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 flex-shrink-0 border-b"
        style={{ borderColor: "#1a2a3a", background: "#05080d" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--accent)" }}>
            📅 Economic Calendar
          </span>
          {lastRefresh && (
            <span className="text-xs font-mono" style={{ color: "var(--muted)" }}>
              Updated {lastRefresh}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter events…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="text-xs px-2 py-1 rounded border"
            style={{ background: "#0b111b", border: "1px solid var(--border)", color: "var(--text)", outline: "none", width: 160 }}
          />
          <button
            onClick={load}
            disabled={loading}
            className="text-xs px-3 py-1 rounded border"
            style={{ borderColor: "var(--border)", color: "var(--accent)", background: "transparent", cursor: "pointer" }}
          >
            {loading ? "…" : "↻"}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-3" style={{ background: "#05080d" }}>
        {error ? (
          <div className="text-xs p-4 rounded border" style={{ color: "#ef4444", borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)" }}>
            ⚠ {error}
          </div>
        ) : loading && events.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-xs" style={{ color: "var(--muted)" }}>
            Loading…
          </div>
        ) : sortedDates.length === 0 ? (
          <div className="text-xs" style={{ color: "var(--muted)" }}>No events found.</div>
        ) : (
          <div className="flex flex-col gap-6">
            {sortedDates.map(date => {
              const isToday = date === today;
              const evs = groups[date];
              const d = new Date(date + "T12:00:00");
              const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

              return (
                <div key={date}>
                  <div className="flex items-center gap-2 mb-2" style={{ borderLeft: `3px solid ${isToday ? "var(--accent)" : "var(--border)"}`, paddingLeft: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: isToday ? "var(--accent)" : "#a8b8cc", fontFamily: "monospace" }}>
                      {label}
                    </span>
                    {isToday && (
                      <span style={{ fontSize: 9, fontWeight: 800, color: "var(--bg)", background: "var(--accent)", padding: "1px 5px", borderRadius: 4, letterSpacing: "0.1em" }}>
                        TODAY
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col gap-1">
                    {evs.map((ev, i) => (
                      <div
                        key={i}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "70px 50px 60px 1fr 80px 80px 80px",
                          gap: 8,
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderLeft: `3px solid ${impactColor(ev.impact)}`,
                          borderRadius: 4,
                          padding: "5px 10px",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--muted)" }}>
                          {ev.time_formatted || "All day"}
                        </span>
                        <span style={{ fontSize: 9, fontWeight: 700, color: impactColor(ev.impact), textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          {ev.impact}
                        </span>
                        <span style={{ fontSize: 10, color: "#3a5570", fontWeight: 700 }}>
                          {ev.country}
                        </span>
                        <span style={{ fontSize: 12, color: "#e8edf5", fontWeight: ev.impact === "High" ? 700 : 400 }}>
                          {ev.title}
                        </span>
                        <span style={{ fontSize: 11, color: "#22c55e", textAlign: "right", fontFamily: "monospace" }}>
                          {ev.actual ? `A: ${ev.actual}` : ""}
                        </span>
                        <span style={{ fontSize: 11, color: "#faad14", textAlign: "right", fontFamily: "monospace" }}>
                          {ev.forecast ? `F: ${ev.forecast}` : ""}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--muted)", textAlign: "right", fontFamily: "monospace" }}>
                          {ev.previous ? `P: ${ev.previous}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
