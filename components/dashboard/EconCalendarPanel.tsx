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
  const dow = d.getDay(); // 0=Sun
  const mon = new Date(d);
  mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 5 }, (_, i) => {
    const x = new Date(mon);
    x.setDate(mon.getDate() + i);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  });
}

// Parse event time (HH:MM or HH:MM:SS in ET) → Date object for today's date
function parseEventTime(ev: CalEvent): Date | null {
  const raw = ev.time;
  if (!raw) return null;
  const [h, mi] = raw.split(":").map(Number);
  if (isNaN(h) || isNaN(mi)) return null;
  // Construct a Date in ET by using a reference ISO string trick
  const etStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [y, m, d] = etStr.split("-").map(Number);
  // Build a UTC date that corresponds to ET h:mi on ev.date
  const base = new Date(`${ev.date}T${String(h).padStart(2,"0")}:${String(mi).padStart(2,"0")}:00`);
  return base;
}

// Is this event stale? (its date+time is >30 min in the past ET)
function isStale(ev: CalEvent, nowMs: number): boolean {
  const t = parseEventTime(ev);
  if (!t) {
    // No time: stale if date is before today ET
    const today = etDateStr(new Date());
    return ev.date < today;
  }
  return nowMs - t.getTime() > 30 * 60 * 1000;
}

const DAY_LABELS: Record<number, string> = { 0: "Mon", 1: "Tue", 2: "Wed", 3: "Thu", 4: "Fri" };

export default function EconCalendarPanel() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

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

  // Tick every minute so stale status updates live
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = etDateStr(new Date());
  const weekDays = etWeekDays();

  const weekEvents = events
    .filter(e => weekDays.includes(e.date) && !shouldSkip(e))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.time ?? "").localeCompare(b.time ?? "");
    });

  // Split into active (upcoming/no-time) and stale (>30 min past)
  const activeEvents = weekEvents.filter(e => !isStale(e, now));
  const staleEvents  = weekEvents.filter(e =>  isStale(e, now));

  const renderEvent = (ev: CalEvent, i: number, faded: boolean) => (
    <div
      key={`${ev.date}-${ev.time ?? ""}-${i}`}
      style={{
        display: "grid", gridTemplateColumns: "66px 1fr",
        gap: 6, padding: "4px 6px",
        background: "var(--overview-card-bg, #05080d)",
        border: "1px solid var(--overview-border-soft, #0d1f30)",
        borderLeft: `3px solid ${faded ? "#1e2a38" : getColor(ev.type)}`,
        borderRadius: 3,
        opacity: faded ? 0.35 : 1,
        transition: "opacity 0.4s",
      }}
    >
      <div style={{ fontSize: 9, fontFamily: "inherit", color: faded ? "#2a3a4a" : "#6b7280", paddingTop: 1 }}>
        <div style={{ color: faded ? "#1e2a38" : "#3a5570", fontWeight: 700 }}>
          {ev.date === today ? "Today" : DAY_LABELS[weekDays.indexOf(ev.date)] ?? ev.date.slice(5)}
        </div>
        {ev.time_formatted ?? (ev.time ? ev.time.slice(0, 5) : "TBD")}
      </div>
      <div>
        <div style={{ fontSize: 9, fontWeight: 700, color: faded ? "#1e2a38" : getColor(ev.type), textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2 }}>
          {ev.type}
        </div>
        <div style={{ fontSize: 11, color: faded ? "#2a3a4a" : "#c8d8e8", lineHeight: 1.3 }}>
          {ev.details || ev.daily_text || "—"}
        </div>
        {ev.location && (
          <div style={{ fontSize: 9, color: faded ? "#1a2535" : "#3a5570", marginTop: 1 }}>{ev.location}</div>
        )}
      </div>
    </div>
  );

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
