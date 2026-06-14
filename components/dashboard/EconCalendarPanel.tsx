"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  Medium:  "#f59e0b",
  Low:     "#3a5570",
  Holiday: "#6b7280",
};

function impactColor(i: string) { return IMPACT_COLOR[i] ?? "#3a5570"; }

function etToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function etWeekDays(): string[] {
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const [y, m, day] = todayStr.split("-").map(Number);
  const base = new Date(y, m - 1, day);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(base);
    x.setDate(base.getDate() + i);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  });
}

function isStale(ev: CalEvent, nowMs: number): boolean {
  if (!ev.time) return ev.date < etToday();
  const t = new Date(`${ev.date}T${ev.time}:00`);
  return nowMs - t.getTime() > 30 * 60 * 1000;
}

function dayLabel(dateStr: string, today: string): string {
  if (dateStr === today) return "TODAY";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}

type FilterKey = "high-usd" | "high" | "medium" | "low" | "all";

const FILTER_OPTS: { value: FilterKey; label: string; color: string }[] = [
  { value: "high-usd", label: "High·USD", color: "#ef4444" },
  { value: "high",     label: "High",     color: "#ef4444" },
  { value: "medium",   label: "Medium",   color: "#f59e0b" },
  { value: "low",      label: "Low",      color: "#3a5570" },
  { value: "all",      label: "All",      color: "#fff"    },
];

function passes(ev: CalEvent, active: Set<FilterKey>): boolean {
  if (active.has("all")) return true;
  if (active.has("high-usd") && ev.impact === "High" && ev.country === "USD") return true;
  if (active.has("high")     && ev.impact === "High") return true;
  if (active.has("medium")   && ev.impact === "Medium") return true;
  if (active.has("low")      && ev.impact === "Low") return true;
  return false;
}

export default function EconCalendarPanel() {
  const [events,        setEvents]        = useState<CalEvent[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [quote,         setQuote]         = useState<string | null>(null);
  const [now,           setNow]           = useState(() => Date.now());
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set(["high-usd"]));
  const [dropOpen,      setDropOpen]      = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function h(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const doLoad = useCallback(async () => {
    setError(null);
    const [econRes, qRes] = await Promise.all([
      fetch("/api/calendar"),
      fetch("/api/calendar-quote"),
    ]);
    const econJson = await econRes.json();
    if (!econRes.ok) {
      setError(econJson.error ?? `HTTP ${econRes.status}`);
      setEvents([]);
      return;
    }
    const sorted = (econJson.events ?? [])
      .sort((a: CalEvent, b: CalEvent) =>
        a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time)
      );
    setEvents(sorted);
    if (qRes.ok) {
      const qj = await qRes.json();
      if (qj.quote) setQuote(qj.quote);
    }
  }, []);

  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(async () => {
    setLoading(true);
    try { await doLoad(); } finally { setLoading(false); }
  });

  useEffect(() => {
    doLoad().finally(() => setLoading(false));
  }, [doLoad]);

  // Tick every 60s to update stale detection
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today    = etToday();
  const weekDays = etWeekDays();

  function toggleFilter(key: FilterKey) {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (key === "all") return new Set(["all"]);
      next.delete("all");
      if (next.has(key)) { next.delete(key); if (next.size === 0) next.add("all"); }
      else next.add(key);
      return next;
    });
  }

  const weekEvents = events
    .filter(e => weekDays.includes(e.date) && passes(e, activeFilters))
    .sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time));

  const activeEvents = weekEvents.filter(e => !isStale(e, now));
  const staleEvents  = weekEvents.filter(e =>  isStale(e, now));

  const filterLabel = activeFilters.has("all")
    ? "ALL"
    : Array.from(activeFilters).map(k => FILTER_OPTS.find(o => o.value === k)?.label ?? k).join("+");

  const renderEvent = (ev: CalEvent, i: number, faded: boolean) => {
    const col = faded ? "#1e2a38" : impactColor(ev.impact);
    const dl  = dayLabel(ev.date, today);

    return (
      <div
        key={`${ev.date}-${ev.time}-${i}`}
        style={{
          display: "grid",
          gridTemplateColumns: "62px 1fr",
          borderTop: "1px solid #0d1520",
          borderLeft: `3px solid ${col}`,
          background: "var(--overview-card-bg, #05080d)",
          opacity: faded ? 0.32 : 1,
          transition: "opacity 0.4s",
          minHeight: 48,
        }}
      >
        {/* Left: day + time */}
        <div style={{
          display: "flex", flexDirection: "column", justifyContent: "center",
          padding: "6px 8px",
          borderRight: "1px solid #0d1520",
          gap: 2,
        }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: faded ? "#1e2a38" : (dl === "TODAY" ? "#00e5ff" : "#fff"), letterSpacing: "0.06em" }}>
            {dl}
          </span>
          <span style={{ fontSize: 11, color: faded ? "#1e2a38" : "#fff", fontFamily: "monospace" }}>
            {ev.time_formatted || ev.time || "TBD"}
          </span>
        </div>

        {/* Right: content */}
        <div style={{ padding: "6px 8px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 3 }}>
          {/* Impact + country */}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 8, fontWeight: 800, color: col, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {ev.impact}
            </span>
            <span style={{ fontSize: 9, color: faded ? "#1e2a38" : "#fff", fontWeight: 600 }}>
              {ev.country}
            </span>
          </div>

          {/* Title */}
          <div style={{ fontSize: 12, color: faded ? "#1e2a38" : "#fff", fontWeight: ev.impact === "High" ? 700 : 500, lineHeight: 1.3 }}>
            {ev.title}
          </div>

          {/* A / F / P */}
          {(ev.actual || ev.forecast || ev.previous) && (
            <div style={{ display: "flex", gap: 10, marginTop: 1 }}>
              {ev.actual && (
                <span style={{ fontSize: 10, color: faded ? "#1e2a38" : "#22c55e", fontFamily: "monospace" }}>
                  A: <strong>{ev.actual}</strong>
                </span>
              )}
              {ev.forecast && (
                <span style={{ fontSize: 10, color: faded ? "#1e2a38" : "#f59e0b", fontFamily: "monospace" }}>
                  F: {ev.forecast}
                </span>
              )}
              {ev.previous && (
                <span style={{ fontSize: 10, color: faded ? "#1e2a38" : "#8a9ab8", fontFamily: "monospace" }}>
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--overview-bg, #05080d)", overflow: "hidden", fontFamily: "Arial, Helvetica, sans-serif" }}>

      {/* Header */}
      <div style={{
        padding: "5px 10px", background: "var(--overview-header-bg, #070c14)",
        borderBottom: "1px solid var(--overview-border-soft, #0d1f30)",
        display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
      }}>
        <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#fff", fontWeight: 700 }}>
          📅 Econ Calendar
        </span>
        <span style={{ fontSize: 9, color: "#3a5570", marginLeft: 2 }}>{today}</span>

        {/* Multi-select dropdown */}
        <div ref={dropRef} style={{ position: "relative", marginLeft: "auto" }}>
          <button
            onClick={() => setDropOpen(o => !o)}
            style={{
              fontSize: 9, padding: "2px 7px", border: "1px solid #1e3050",
              borderRadius: 3, background: "#070c14", color: "#fff",
              cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 4,
            }}
          >
            {filterLabel} <span style={{ fontSize: 7 }}>▾</span>
          </button>
          {dropOpen && (
            <div style={{
              position: "absolute", right: 0, top: "calc(100% + 3px)", zIndex: 200,
              background: "#0d1220", border: "1px solid #1e3050", borderRadius: 4,
              padding: "3px 0", minWidth: 140, boxShadow: "0 8px 24px rgba(0,0,0,0.7)",
            }}>
              {FILTER_OPTS.map(o => {
                const on = activeFilters.has(o.value);
                return (
                  <div
                    key={o.value}
                    onClick={() => toggleFilter(o.value)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "6px 12px", cursor: "pointer",
                      background: on ? "#111a2e" : "transparent",
                    }}
                  >
                    <span style={{
                      width: 12, height: 12, borderRadius: 2, flexShrink: 0,
                      border: `2px solid ${o.color}`,
                      background: on ? o.color : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 8, color: "#05080d", fontWeight: 900,
                    }}>{on ? "✓" : ""}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: on ? "#fff" : "#6b7280" }}>
                      {o.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <button onClick={trigger} style={{ ...btnStyle }}>
          {btnLabel}
        </button>
      </div>

      {/* Quote */}
      {quote && (
        <div style={{ padding: "5px 10px", borderBottom: "1px solid #0d1f30", background: "var(--overview-header-bg, #070c14)", flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: 10, fontStyle: "italic", color: "#fff", lineHeight: 1.5, textAlign: "center" }}>
            &ldquo;{quote}&rdquo;
          </p>
        </div>
      )}

      {/* Events */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ color: "#fff", fontSize: 11, padding: "8px 10px" }}>Loading…</div>
        ) : error ? (
          <div style={{ color: "#ef4444", fontSize: 10, padding: "6px 10px", wordBreak: "break-all" }}>⚠ {error}</div>
        ) : weekEvents.length === 0 ? (
          <div style={{ color: "#fff", fontSize: 11, padding: "8px 10px" }}>No events this week.</div>
        ) : (
          <>
            {activeEvents.map((ev, i) => renderEvent(ev, i, false))}
            {staleEvents.length > 0 && (
              <>
                {activeEvents.length > 0 && (
                  <div style={{ height: 1, background: "#0d1f30", margin: "2px 0" }} />
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
