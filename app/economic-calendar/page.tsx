"use client";

import { useState, useEffect, useCallback } from "react";

interface CalendarEvent {
  date: string;
  time_formatted?: string;
  day_of_week?: string;
  type?: string;
  details?: string;
  location?: string;
  coverage?: string;
}

const IMPACT_COLORS: Record<string, string> = {
  "President Schedule": "#faad14",
  "Press Briefing":     "#00e5ff",
  "Travel":             "#a78bfa",
  "Call":               "#22c55e",
  "Meeting":            "#00b4ff",
};

function eventColor(type?: string): string {
  if (!type) return "#6b7280";
  for (const [k, v] of Object.entries(IMPACT_COLORS)) {
    if (type.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return "#9ca3af";
}

function groupByDate(events: CalendarEvent[]): Record<string, CalendarEvent[]> {
  const groups: Record<string, CalendarEvent[]> = {};
  for (const ev of events) {
    if (!groups[ev.date]) groups[ev.date] = [];
    groups[ev.date].push(ev);
  }
  return groups;
}

export default function EconomicCalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list: CalendarEvent[] = json.events ?? [];
      setEvents(list);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);

  const filtered = filter
    ? events.filter(ev =>
        ev.details?.toLowerCase().includes(filter.toLowerCase()) ||
        ev.type?.toLowerCase().includes(filter.toLowerCase()) ||
        ev.location?.toLowerCase().includes(filter.toLowerCase())
      )
    : events;

  const groups = groupByDate(filtered);
  const sortedDates = Object.keys(groups).sort();

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 flex-shrink-0 border-b"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--accent)" }}>
            White House Schedule
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
            style={{
              background: "#0b111b",
              border: "1px solid var(--border)",
              color: "var(--text)",
              outline: "none",
              width: 160,
            }}
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
      <div className="flex-1 overflow-auto px-4 py-3" style={{ background: "#02070f" }}>
        {error ? (
          <div className="text-xs p-4 rounded border" style={{ color: "var(--red)", borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)" }}>
            ⚠ {error} — proxy must be running on port 3001
          </div>
        ) : loading && events.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-xs" style={{ color: "var(--muted)" }}>
            Loading schedule…
          </div>
        ) : sortedDates.length === 0 ? (
          <div className="text-xs" style={{ color: "var(--muted)" }}>No events found.</div>
        ) : (
          <div className="flex flex-col gap-6">
            {sortedDates.map(date => {
              const isToday = date === today;
              const evs = groups[date];
              const dow = evs[0]?.day_of_week ?? "";
              const d = new Date(date + "T12:00:00");
              const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

              return (
                <div key={date}>
                  {/* Date header */}
                  <div
                    className="flex items-center gap-2 mb-2"
                    style={{
                      borderLeft: `3px solid ${isToday ? "var(--accent)" : "var(--border)"}`,
                      paddingLeft: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: isToday ? "var(--accent)" : "#a8b8cc",
                        fontFamily: "monospace",
                      }}
                    >
                      {label}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>
                      {dow}
                    </span>
                    {isToday && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          color: "var(--bg)",
                          background: "var(--accent)",
                          padding: "1px 5px",
                          borderRadius: 4,
                          letterSpacing: "0.1em",
                        }}
                      >
                        TODAY
                      </span>
                    )}
                  </div>

                  {/* Events */}
                  <div className="flex flex-col gap-1">
                    {evs.map((ev, i) => (
                      <div
                        key={i}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "80px 120px 1fr 180px",
                          gap: 8,
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          padding: "6px 10px",
                          alignItems: "start",
                        }}
                      >
                        <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--muted)", paddingTop: 1 }}>
                          {ev.time_formatted ?? "All day"}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: eventColor(ev.type),
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            paddingTop: 1,
                          }}
                        >
                          {ev.type ?? "Event"}
                        </span>
                        <span style={{ fontSize: 12, color: "#e8edf5" }}>
                          {ev.details || "—"}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--muted)", textAlign: "right" }}>
                          {ev.location ?? ""}
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
