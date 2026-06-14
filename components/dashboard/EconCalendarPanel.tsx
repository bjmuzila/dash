"use client";

import { useState, useEffect, useCallback } from "react";
import { useRefreshButton } from "@/hooks/useRefreshButton";

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

// ET date string YYYY-MM-DD
function etDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

// Get Mon–Fri of the current ET week
function etWeekDays(): string[] {
  const now = new Date();
  const etStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const [y, m, day] = etStr.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  const dow = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 5 }, (_, i) => {
    const x = new Date(mon);
    x.setDate(mon.getDate() + i);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  });
}

// Is event stale? >30 min past its date+time ET
function isStale(ev: CalEvent, nowMs: number): boolean {
  if (!ev.time) return ev.date < etDateStr(new Date());
  const t = new Date(`${ev.date}T${ev.time}:00`);
  return nowMs - t.getTime() > 30 * 60 * 1000;
}

const DAY_LABELS: Record<number, string> = { 0: "Mon", 1: "Tue", 2: "Wed", 3: "Thu", 4: "Fri" };

type ImpactFilter = "All" | "High" | "Medium" | "Low";

export default function EconCalendarPanel() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [impactFilter, setImpactFilter] = useState<ImpactFilter>("All");

  const doLoad = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/calendar");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? `HTTP ${res.status}`);
      setEvents([]);
      return;
    }
    setEvents(json.events ?? []);
  }, []);

  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(async () => {
    setLoading(true);
    try { await doLoad(); } finally { setLoading(false); }
  });

  useEffect(() => {
    doLoad().finally(() => setLoading(false));
  }, [doLoad]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = etDateStr(new Date());
  const weekDays = etWeekDays();

  const weekEvents = events
    .filter(e => weekDays.includes(e.date))
    .filter(e => impactFilter === "All" || e.impact === impactFilter)
    .sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time));

  const activeEvents = weekEvents.filter(e => !isStale(e, now));
  const staleEvents  = weekEvents.filter(e =>  isStale(e, now));

  const renderEvent = (ev: CalEvent, i: number, faded: boolean) => {
    const col = faded ? "#1e2a38" : impactColor(ev.impact);
    const dayIdx = weekDays.indexOf(ev.date);
    const dayLabel = ev.date === today ? "Today" : (DAY_LABELS[dayIdx] ?? ev.date.slice(5));

    return (
      <div
        key={`${ev.date}-${ev.time}-${i}`}
        style={{
          display: "grid", gridTemplateColumns: "60px 1fr",
          gap: 6, padding: "4px 6px",
          background: "var(--overview-card-bg, #05080d)",
          border: "1px solid var(--overview-border-soft, #0d1f30)",
          borderLeft: `3px solid ${col}`,
          borderRadius: 3,
          opacity: faded ? 0.35 : 1,
          transition: "opacity 0.4s",
        }}
      >
        {/* Time column */}
        <div style={{ fontSize: 9, color: faded ? "#1e2a38" : "#6b7280", paddingTop: 1, lineHeight: 1.4 }}>
          <div style={{ color: faded ? "#1a2535" : "#3a5570", fontWeight: 700, fontSize: 8, textTransform: "uppercase" }}>
            {dayLabel}
          </div>
          {ev.time_formatted || ev.time || "TBD"}
        </div>

        {/* Content column */}
        <div>
          {/* Impact badge + country */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 1 }}>
            <span style={{
              fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
              color: col, lineHeight: 1,
            }}>
              {ev.impact}
            </span>
            <span style={{ fontSize: 7, color: faded ? "#1e2a38" : "#3a5570" }}>{ev.country}</span>
          </div>

          {/* Title */}
          <div style={{ fontSize: 11, color: faded ? "#2a3a4a" : "#c8d8e8", lineHeight: 1.3, fontWeight: ev.impact === "High" ? 600 : 400 }}>
            {ev.title}
          </div>

          {/* Forecast / Previous / Actual */}
          {(ev.forecast || ev.previous || ev.actual) && (
            <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
              {ev.actual && (
                <span style={{ fontSize: 9, color: faded ? "#1e2a38" : "#22c55e" }}>
                  A: {ev.actual}
                </span>
              )}
              {ev.forecast && (
                <span style={{ fontSize: 9, color: faded ? "#1e2a38" : "#faad14" }}>
                  F: {ev.forecast}
                </span>
              )}
              {ev.previous && (
                <span style={{ fontSize: 9, color: faded ? "#1a2535" : "#3a5570" }}>
                  P: {ev.previous}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

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
        <select
          value={impactFilter}
          onChange={e => setImpactFilter(e.target.value as ImpactFilter)}
          style={{
            marginLeft: "auto",
            background: "#070c14", color: "#6b7280",
            border: "1px solid #0d1f30", borderRadius: 3,
            fontSize: 9, fontWeight: 700, padding: "2px 5px",
            cursor: "pointer", letterSpacing: ".06em",
          }}
        >
          <option value="All">ALL</option>
          <option value="High">HIGH</option>
          <option value="Medium">MED</option>
          <option value="Low">LOW</option>
        </select>
        <button onClick={trigger} style={{ ...btnStyle }}>
          {btnLabel}
        </button>
      </div>

      {/* Events */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
        {loading ? (
          <div style={{ color: "#1e3050", fontSize: 11, padding: "4px 0" }}>Loading…</div>
        ) : error ? (
          <div style={{ color: "#ef4444", fontSize: 10, padding: "4px 0", wordBreak: "break-all" }}>Error: {error}</div>
        ) : weekEvents.length === 0 ? (
          <div style={{ color: "#1e3050", fontSize: 11, padding: "4px 0" }}>No events this week.</div>
        ) : (
          <>
            {activeEvents.map((ev, i) => renderEvent(ev, i, false))}
            {staleEvents.length > 0 && (
              <>
                {activeEvents.length > 0 && (
                  <div style={{ height: 1, background: "#0d1f30", margin: "4px 0" }} />
                )}
                {staleEvents.map((ev, i) => renderEvent(ev, i, true))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
