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
  High:    "#ef4444",
  Medium:  "#faad14",
  Low:     "#3a5570",
  Holiday: "#6b7280",
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

type ImpactFilter = "high-usd" | "high" | "all";

export default function EconomicCalendarPage() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [impactFilter, setImpactFilter] = useState<ImpactFilter>("high-usd");
  const [quote, setQuote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [calRes, quoteRes] = await Promise.all([
        fetch("/api/calendar"),
        fetch("/api/calendar-quote"),
      ]);
      const json = await calRes.json();
      if (!calRes.ok) { setError(json.error ?? `HTTP ${calRes.status}`); return; }
      setEvents(json.events ?? []);
      setLastRefresh(new Date().toLocaleTimeString());
      if (quoteRes.ok) {
        const qj = await quoteRes.json();
        if (qj.quote) setQuote(qj.quote);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  const filtered = events.filter(ev => {
    if (impactFilter === "high-usd" && !(ev.impact === "High" && ev.country === "USD")) return false;
    if (impactFilter === "high"     && ev.impact !== "High") return false;
    if (search && !(
      ev.title?.toLowerCase().includes(search.toLowerCase()) ||
      ev.country?.toLowerCase().includes(search.toLowerCase())
    )) return false;
    return true;
  });

  const groups = groupByDate(filtered);
  const sortedDates = Object.keys(groups).sort();

  const FILTER_OPTS: { value: ImpactFilter; label: string }[] = [
    { value: "high-usd", label: "High · USD" },
    { value: "high",     label: "High" },
    { value: "all",      label: "All" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#05080d", fontFamily: "Arial, Helvetica, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", borderBottom: "1px solid #0d1f30", background: "#070c14", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.14em", color: "#00e5ff" }}>
            📅 Economic Calendar
          </span>
          {lastRefresh && <span style={{ fontSize: 10, color: "#3a5570", fontFamily: "monospace" }}>Updated {lastRefresh}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Impact filter pills */}
          <div style={{ display: "flex", gap: 2, background: "#05080d", borderRadius: 3, padding: 2 }}>
            {FILTER_OPTS.map(o => (
              <button key={o.value} onClick={() => setImpactFilter(o.value)} style={{
                fontSize: 9, padding: "3px 8px", border: "none", borderRadius: 2, cursor: "pointer", fontWeight: 700,
                background: impactFilter === o.value ? "#1a2a3a" : "transparent",
                color: impactFilter === o.value ? "#00e5ff" : "#6b7280",
              }}>
                {o.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ fontSize: 11, padding: "3px 8px", background: "#0b111b", border: "1px solid #0d1f30", color: "#fff", outline: "none", borderRadius: 3, width: 140 }}
          />
          <button onClick={load} disabled={loading} style={{ fontSize: 11, padding: "3px 10px", border: "1px solid #0d1f30", borderRadius: 3, background: "transparent", color: "#00e5ff", cursor: "pointer" }}>
            {loading ? "…" : "↻"}
          </button>
        </div>
      </div>

      {/* Quote of the day */}
      {quote && (
        <div style={{ padding: "8px 16px", borderBottom: "1px solid #0d1f30", background: "#070c14", flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: 12, fontStyle: "italic", color: "#e8edf5", lineHeight: 1.6, textAlign: "center", letterSpacing: "0.02em" }}>
            &ldquo;{quote}&rdquo;
          </p>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 20 }}>
        {error ? (
          <div style={{ fontSize: 11, color: "#ef4444", padding: 12, border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, background: "rgba(239,68,68,0.05)" }}>
            ⚠ {error}
          </div>
        ) : loading && events.length === 0 ? (
          <div style={{ color: "#3a5570", fontSize: 12, textAlign: "center", marginTop: 40 }}>Loading…</div>
        ) : sortedDates.length === 0 ? (
          <div style={{ color: "#3a5570", fontSize: 12 }}>No events match.</div>
        ) : (
          sortedDates.map(date => {
            const isToday = date === today;
            const evs = groups[date];
            const d = new Date(date + "T12:00:00");
            const label = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();

            return (
              <div key={date}>
                {/* Date header */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${isToday ? "#00e5ff33" : "#0d1f30"}` }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: isToday ? "#00e5ff" : "#fff", letterSpacing: "0.1em" }}>
                    {label}
                  </span>
                  {isToday && (
                    <span style={{ fontSize: 8, fontWeight: 800, background: "#00e5ff", color: "#05080d", padding: "1px 6px", borderRadius: 3, letterSpacing: "0.12em" }}>
                      TODAY
                    </span>
                  )}
                </div>

                {/* Events */}
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {evs.map((ev, i) => (
                    <div key={i} style={{
                      display: "grid",
                      gridTemplateColumns: "80px 55px 1fr 90px 90px 90px",
                      gap: 10,
                      padding: "7px 12px",
                      background: "#070c14",
                      border: "1px solid #0d1f30",
                      borderLeft: `3px solid ${impactColor(ev.impact)}`,
                      borderRadius: 3,
                      alignItems: "center",
                    }}>
                      <span style={{ fontSize: 11, fontFamily: "monospace", color: "#fff" }}>
                        {ev.time_formatted || "All day"}
                      </span>
                      <span style={{ fontSize: 9, fontWeight: 800, color: impactColor(ev.impact), textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {ev.impact}
                      </span>
                      <span style={{ fontSize: 13, color: "#fff", fontWeight: ev.impact === "High" ? 700 : 400 }}>
                        {ev.title}
                        <span style={{ fontSize: 9, color: "#3a5570", marginLeft: 6 }}>{ev.country}</span>
                      </span>
                      <span style={{ fontSize: 11, color: ev.actual ? "#22c55e" : "#3a5570", textAlign: "right", fontFamily: "monospace" }}>
                        {ev.actual ? `A: ${ev.actual}` : "—"}
                      </span>
                      <span style={{ fontSize: 11, color: ev.forecast ? "#faad14" : "#3a5570", textAlign: "right", fontFamily: "monospace" }}>
                        {ev.forecast ? `F: ${ev.forecast}` : "—"}
                      </span>
                      <span style={{ fontSize: 11, color: ev.previous ? "#fff" : "#3a5570", textAlign: "right", fontFamily: "monospace" }}>
                        {ev.previous ? `P: ${ev.previous}` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
