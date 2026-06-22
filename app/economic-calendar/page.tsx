"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { HOME_THEME as HT, homeShellStyle, homeButtonStyle } from "@/components/shared/homeTheme";

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
  Medium:    "#f59e0b",
  Low:       "#3a5570",
  Holiday:   "#6b7280",
  President: "#a855f7",
};

function impactColor(i: string) { return IMPACT_COLOR[i] ?? "#3a5570"; }

function groupByDate(events: CalEvent[]): Record<string, CalEvent[]> {
  const g: Record<string, CalEvent[]> = {};
  for (const ev of events) {
    if (!g[ev.date]) g[ev.date] = [];
    g[ev.date].push(ev);
  }
  return g;
}

type FilterKey = "high-usd" | "high" | "medium-usd" | "medium" | "low-usd" | "low" | "trump" | "all";

const FILTER_OPTS: { value: FilterKey; label: string; color: string }[] = [
  { value: "high-usd",   label: "High · USD",   color: "#ef4444" },
  { value: "high",       label: "High",         color: "#ef4444" },
  { value: "medium-usd", label: "Medium · USD", color: "#f59e0b" },
  { value: "medium",     label: "Medium",       color: "#f59e0b" },
  { value: "low-usd",    label: "Low · USD",    color: "#3a5570" },
  { value: "low",        label: "Low",          color: "#3a5570" },
  { value: "trump",      label: "TRUMP",        color: "#a855f7" },
  { value: "all",        label: "All",          color: "#fff"    },
];

function passes(ev: CalEvent, active: Set<FilterKey>): boolean {
  if (active.has("all")) return true;
  if (active.has("trump")    && ev.impact === "President") return true;
  if (active.has("high-usd")   && ev.impact === "High"   && ev.country === "USD") return true;
  if (active.has("high")       && ev.impact === "High") return true;
  if (active.has("medium-usd") && ev.impact === "Medium" && ev.country === "USD") return true;
  if (active.has("medium")     && ev.impact === "Medium") return true;
  if (active.has("low-usd")    && ev.impact === "Low"    && ev.country === "USD") return true;
  if (active.has("low")        && ev.impact === "Low") return true;
  return false;
}

function etToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function dayLabel(dateStr: string, today: string): string {
  if (dateStr === today) return "TODAY";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}

export default function EconomicCalendarPage() {
  const [events,       setEvents]       = useState<CalEvent[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [warning,      setWarning]      = useState<string | null>(null);
  const [lastRefresh,  setLastRefresh]  = useState<string | null>(null);
  const [quote,        setQuote]        = useState<string | null>(null);
  const [search,       setSearch]       = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set(["all"]));
  const [dropOpen,     setDropOpen]     = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const list: CalEvent[] = Array.isArray(json?.events) ? json.events : Array.isArray(json) ? json : [];
      setEvents(list);
      setWarning(json?.warning ? String(json.warning) : null);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (e) { setError(String(e)); setEvents([]); }
    finally    { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = etToday();

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

  const filtered = events.filter(ev =>
    passes(ev, activeFilters) &&
    (!search || ev.title?.toLowerCase().includes(search.toLowerCase()) || ev.country?.toLowerCase().includes(search.toLowerCase()))
  );

  const groups     = groupByDate(filtered);
  const sortedDates = Object.keys(groups).sort();

  const filterLabel = activeFilters.has("all")
    ? "ALL"
    : Array.from(activeFilters).map(k => FILTER_OPTS.find(o => o.value === k)?.label ?? k).join(" + ");

  return (
    <div style={{ ...homeShellStyle, height: "100%" }}>

      {/* ── Top bar ──────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 16px", background: HT.panelBgStrong, backdropFilter: "blur(16px)",
        borderBottom: `1px solid ${HT.border}`, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: "#fff" }}>
            📅 Economic Calendar
          </span>
          {lastRefresh && (
            <span style={{ fontSize: 11, color: HT.text, fontFamily: "monospace", background: HT.panelBg, padding: "2px 8px", borderRadius: 3 }}>
              {today}
            </span>
          )}
          <span style={{ fontSize: 10, color: "#3a5570" }}>All countries · filterable</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Multi-select dropdown */}
          <div ref={dropRef} style={{ position: "relative" }}>
            <button
              onClick={() => setDropOpen(o => !o)}
              style={{
                ...homeButtonStyle,
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {filterLabel} <span style={{ fontSize: 8 }}>▾</span>
            </button>
            {dropOpen && (
              <div style={{
                position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 200,
                background: HT.panelBgStrong, backdropFilter: "blur(16px)", border: `1px solid ${HT.border}`, borderRadius: 4,
                padding: "4px 0", minWidth: 170, boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
              }}>
                {FILTER_OPTS.map(o => {
                  const on = activeFilters.has(o.value);
                  return (
                    <div
                      key={o.value}
                      onClick={() => toggleFilter(o.value)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 16px", cursor: "pointer",
                        background: on ? "rgba(0,240,255,0.08)" : "transparent",
                      }}
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                        border: `2px solid ${o.color}`,
                        background: on ? o.color : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, color: "#05080d", fontWeight: 900,
                      }}>{on ? "✓" : ""}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: on ? "#fff" : "#8a9ab8" }}>
                        {o.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <input
            type="text" placeholder="Search…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ fontSize: 12, padding: "4px 10px", background: "rgba(0,0,0,0.4)", border: `1px solid ${HT.border}`, color: HT.text, outline: "none", borderRadius: 3, width: 140 }}
          />
          <button
            onClick={load} disabled={loading}
            style={{ ...homeButtonStyle }}
          >
            {loading ? "…" : "↻ Now"}
          </button>
        </div>
      </div>

      {/* ── Quote of the day ─────────────────────────────────── */}
      {quote && (
        <div style={{ padding: "10px 20px", borderBottom: `1px solid ${HT.border}`, background: HT.panelBgStrong, backdropFilter: "blur(16px)", flexShrink: 0, textAlign: "center" }}>
          <span style={{ fontSize: 13, fontStyle: "italic", color: "#fff", lineHeight: 1.7 }}>
            &ldquo;{quote}&rdquo;
          </span>
        </div>
      )}

      {/* ── Stale-data warning (non-blocking) ────────────────── */}
      {warning && !error && (
        <div style={{ padding: "6px 16px", fontSize: 11, color: "#f59e0b", background: "rgba(245,158,11,0.06)", borderBottom: "1px solid rgba(245,158,11,0.25)", flexShrink: 0 }}>
          ⚠ Live feed unavailable — showing saved events. ({warning})
        </div>
      )}

      {/* ── Event list ───────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {error ? (
          <div style={{ fontSize: 13, color: "#ef4444", padding: 16, margin: 16, border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, background: "rgba(239,68,68,0.05)" }}>
            ⚠ {error}
          </div>
        ) : loading && events.length === 0 ? (
          <div style={{ color: "#fff", fontSize: 14, textAlign: "center", marginTop: 60 }}>Loading…</div>
        ) : sortedDates.length === 0 ? (
          <div style={{ color: "#fff", fontSize: 14, padding: 20 }}>No events match.</div>
        ) : (
          sortedDates.map(date => {
            const isToday = date === today;
            const evs = groups[date];
            const d   = new Date(date + "T12:00:00");
            const fullLabel = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();

            return (
              <div key={date}>
                {/* ── Date section header ── */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 16px 6px",
                  background: isToday ? "rgba(0,229,255,0.04)" : "transparent",
                  borderTop: `1px solid ${HT.border}`,
                }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: isToday ? "#00e5ff" : "#fff", letterSpacing: "0.08em" }}>
                    {fullLabel}
                  </span>
                  {isToday && (
                    <span style={{ fontSize: 9, fontWeight: 800, background: "#00e5ff", color: "#05080d", padding: "2px 8px", borderRadius: 3, letterSpacing: "0.12em" }}>
                      TODAY
                    </span>
                  )}
                </div>

                {/* ── Events for this date ── */}
                {evs.map((ev, i) => {
                  const col = impactColor(ev.impact);
                  const dl  = dayLabel(ev.date, today);
                  return (
                    <div
                      key={i}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "80px 1fr",
                        borderTop: i === 0 ? "none" : `1px solid ${HT.border}`,
                        borderLeft: `3px solid ${col}`,
                        background: HT.bg,
                        minHeight: 56,
                      }}
                    >
                      {/* Left: day + time */}
                      <div style={{
                        display: "flex", flexDirection: "column", justifyContent: "center",
                        padding: "10px 12px",
                        borderRight: `1px solid ${HT.border}`,
                        gap: 3,
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: isToday && dl === "TODAY" ? "#00e5ff" : "#fff", letterSpacing: "0.06em" }}>
                          {dl}
                        </span>
                        <span style={{ fontSize: 13, color: "#fff", fontFamily: "monospace" }}>
                          {ev.time_formatted || "All day"}
                        </span>
                      </div>

                      {/* Right: content */}
                      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
                        {/* Impact + country row */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: col, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                            {ev.impact}
                          </span>
                          <span style={{ fontSize: 11, color: "#fff", fontWeight: 600 }}>
                            {ev.country}
                          </span>
                        </div>

                        {/* Title */}
                        <div style={{ fontSize: 15, fontWeight: ev.impact === "High" ? 700 : 500, color: "#fff", lineHeight: 1.3 }}>
                          {ev.title}
                        </div>

                        {/* A / F / P values */}
                        {(ev.actual || ev.forecast || ev.previous) && (
                          <div style={{ display: "flex", gap: 14, marginTop: 2 }}>
                            {ev.actual && (
                              <span style={{ fontSize: 12, color: "#22c55e", fontFamily: "monospace" }}>
                                A: <strong>{ev.actual}</strong>
                              </span>
                            )}
                            {ev.forecast && (
                              <span style={{ fontSize: 12, color: "#f59e0b", fontFamily: "monospace" }}>
                                F: {ev.forecast}
                              </span>
                            )}
                            {ev.previous && (
                              <span style={{ fontSize: 12, color: "#8a9ab8", fontFamily: "monospace" }}>
                                P: {ev.previous}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
