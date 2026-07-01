"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import EconCalendarDiscordBtn, { EconCalendarTemplateCopyBtn } from "@/components/shared/EconCalendarDiscordBtn";
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

interface EarnRow { symbol: string; company: string; callTime: string; marketCap: number; }

const CHIP_W = 44;   // chip column width
const CHIP_GAP = 12; // flex gap between chips

// FMP per-ticker logo (free, predictable URL).
function logoUrl(sym: string) {
  return `https://financialmodelingprep.com/image-stock/${sym.toUpperCase()}.png`;
}

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

// Current ET wall-clock as YYYY-MM-DD and minutes-since-midnight, so staleness
// is judged in market time regardless of the viewer's local timezone.
function etNowParts(nowMs: number): { date: string; minutes: number } {
  const d = new Date(nowMs);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  const [h, m] = hm.split(":").map(Number);
  return { date, minutes: h * 60 + m };
}

function isStale(ev: CalEvent, nowMs: number): boolean {
  const { date: etDate, minutes: nowMin } = etNowParts(nowMs);
  if (ev.date < etDate) return true;
  if (ev.date > etDate) return false;
  // same ET day
  if (!ev.time) return false;
  const [h, m] = ev.time.split(":").map(Number);
  const evMin = h * 60 + m;
  return nowMin - evMin > 30; // 30 min past event start
}

function dayLabel(dateStr: string, today: string): string {
  if (dateStr === today) return "TODAY";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}

function fullDayLabel(dateStr: string, today: string): string {
  if (dateStr === today) return "TODAY";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toUpperCase();
}

type FilterKey = "high-usd" | "high" | "medium-usd" | "medium" | "low-usd" | "low" | "trump" | "all";

const FILTER_OPTS: { value: FilterKey; label: string; color: string }[] = [
  { value: "high-usd",   label: "High·USD",   color: "#ef4444" },
  { value: "high",       label: "High",       color: "#ef4444" },
  { value: "medium-usd", label: "Medium·USD", color: "#f59e0b" },
  { value: "medium",     label: "Medium",     color: "#f59e0b" },
  { value: "low-usd",    label: "Low·USD",    color: "#3a5570" },
  { value: "low",        label: "Low",        color: "#3a5570" },
  { value: "trump",      label: "TRUMP",      color: "#a855f7" },
  { value: "all",        label: "All",        color: "#fff"    },
];

function passes(ev: CalEvent, active: Set<FilterKey>): boolean {
  if (active.has("all")) return true;
  if (active.has("trump")   && ev.impact === "President") return true;
  if (active.has("high-usd")   && ev.impact === "High"   && ev.country === "USD") return true;
  if (active.has("high")       && ev.impact === "High") return true;
  if (active.has("medium-usd") && ev.impact === "Medium" && ev.country === "USD") return true;
  if (active.has("medium")     && ev.impact === "Medium") return true;
  if (active.has("low-usd")    && ev.impact === "Low"    && ev.country === "USD") return true;
  if (active.has("low")        && ev.impact === "Low") return true;
  return false;
}

export default function EconCalendarPanel({ todayOnly = false }: { todayOnly?: boolean }) {
  const [events,        setEvents]        = useState<CalEvent[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [quote,         setQuote]         = useState<string | null>(null);
  const [now,           setNow]           = useState(() => Date.now());
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set(["high-usd", "medium-usd", "trump"]));
  const [dropOpen,      setDropOpen]      = useState(false);
  const [earnings,      setEarnings]      = useState<EarnRow[]>([]);
  const [maxChips,      setMaxChips]      = useState(8);
  const dropRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const doLoad = useCallback(async () => {
    setError(null);
    const [econRes, qRes, earnRes] = await Promise.all([
      fetch("/api/calendar", { cache: "no-store" }),
      fetch("/api/calendar-quote", { cache: "no-store" }),
      fetch("/api/earnings-today", { cache: "no-store" }),
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
    if (earnRes.ok) {
      const ej = await earnRes.json();
      setEarnings(Array.isArray(ej.earnings) ? ej.earnings : []);
    }
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

  // Measure how many logo chips fit on a single row; reserve one slot for the "+N" chip.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const fit = Math.max(1, Math.floor((w + CHIP_GAP) / (CHIP_W + CHIP_GAP)));
      setMaxChips(fit);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [earnings.length]);

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

  const activeDays = todayOnly ? [today] : weekDays;

  const weekEvents = events
    .filter(e => activeDays.includes(e.date) && passes(e, activeFilters))
    .sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time));

  const activeEvents = weekEvents.filter(e => !isStale(e, now));
  const staleEvents  = weekEvents.filter(e =>  isStale(e, now));

  const filterLabel = activeFilters.has("all")
    ? "ALL"
    : Array.from(activeFilters).map(k => FILTER_OPTS.find(o => o.value === k)?.label ?? k).join("+");

  const renderEvent = (ev: CalEvent, i: number, faded: boolean) => {
    const col = faded ? "#1e2a38" : impactColor(ev.impact);

    return (
      <div
        key={`${ev.date}-${ev.time}-${i}`}
        style={{
          display: "grid",
          gridTemplateColumns: "62px 1fr",
          borderTop: `1px solid ${HT.border}`,
          borderLeft: `3px solid ${col}`,
          background: faded ? HT.bg : `linear-gradient(90deg, ${col}0f 0%, transparent 35%), ${HT.bg}`,
          opacity: faded ? 0.32 : 1,
          transition: "opacity 0.4s",
          minHeight: 48,
        }}
      >
        {/* Left: time */}
        <div style={{
          display: "flex", flexDirection: "column", justifyContent: "center",
          padding: "6px 8px",
          borderRight: `1px solid ${HT.border}`,
          boxShadow: faded ? "none" : `inset -1px 0 8px ${col}18`,
          gap: 2,
        }}>
          <span style={{ fontSize: 13, color: faded ? "#1e2a38" : "#fff", fontFamily: "monospace" }}>
            {ev.time_formatted || ev.time || "TBD"}
          </span>
        </div>

        {/* Right: content */}
        <div style={{ padding: "6px 8px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 3 }}>
          {/* Impact + country */}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: col, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {ev.impact}
            </span>
            <span style={{ fontSize: 11, color: faded ? "#1e2a38" : "#fff", fontWeight: 600 }}>
              {ev.country}
            </span>
          </div>

          {/* Title */}
          <div style={{ fontSize: 14, color: faded ? "#1e2a38" : "#fff", fontWeight: ev.impact === "High" ? 700 : 500, lineHeight: 1.3 }}>
            {ev.title}
          </div>

          {/* A / F / P */}
          {(ev.actual || ev.forecast || ev.previous) && (
            <div style={{ display: "flex", gap: 10, marginTop: 1 }}>
              {ev.actual && (
                <span style={{ fontSize: 12, color: faded ? "#1e2a38" : "#22c55e", fontFamily: "monospace" }}>
                  A: <strong>{ev.actual}</strong>
                </span>
              )}
              {ev.forecast && (
                <span style={{ fontSize: 12, color: faded ? "#1e2a38" : "#f59e0b", fontFamily: "monospace" }}>
                  F: {ev.forecast}
                </span>
              )}
              {ev.previous && (
                <span style={{ fontSize: 12, color: faded ? "#1e2a38" : "#8a9ab8", fontFamily: "monospace" }}>
                  P: {ev.previous}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Group events by date for day separators
  function renderWithDaySeparators(evList: CalEvent[], faded: boolean) {
    const result: React.ReactNode[] = [];
    let lastDate = "";
    evList.forEach((ev, i) => {
      if (ev.date !== lastDate) {
        lastDate = ev.date;
        const isToday = ev.date === today;
        const label = fullDayLabel(ev.date, today);
        result.push(
          <div
            key={`sep-${faded ? "s" : "a"}-${ev.date}`}
            style={{
              padding: "4px 10px",
              background: isToday ? "rgba(33,158,188,0.06)" : HT.panelBg,
              borderTop: `1px solid ${HT.border}`,
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 800, color: isToday ? "#219EBC" : "#3a5570", letterSpacing: "0.1em" }}>
              {label}
            </span>
            {isToday && (
              <span style={{ fontSize: 8, fontWeight: 900, background: "#219EBC", color: "#05080d", padding: "1px 5px", borderRadius: 2, letterSpacing: "0.1em" }}>
                TODAY
              </span>
            )}
          </div>
        );
      }
      result.push(renderEvent(ev, i, faded));
    });
    return result;
  }

  return (
    <div ref={containerRef} style={{ ...homeShellStyle, background: "transparent", height: "100%", overflow: "hidden" }}>

      {/* Header */}
      <div style={{
        padding: "5px 10px", background: HT.panelBgStrong, backdropFilter: "blur(16px)",
        borderBottom: `1px solid ${HT.border}`,
        display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
        position: "relative", zIndex: 30,
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
              ...homeButtonStyle,
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            {filterLabel} <span style={{ fontSize: 7 }}>▾</span>
          </button>
          {dropOpen && (
            <div style={{
              position: "absolute", right: 0, top: "calc(100% + 3px)", zIndex: 200,
              background: HT.panelBgStrong, backdropFilter: "blur(16px)", border: `1px solid ${HT.border}`, borderRadius: 4,
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
                      background: on ? "rgba(33,158,188,0.08)" : "transparent",
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

        <button onClick={trigger} style={{ ...homeButtonStyle }}>
          {btnLabel}
        </button>
        <EconCalendarTemplateCopyBtn />
        <EconCalendarDiscordBtn />
      </div>

      {/* Quote */}
      {quote && (
        <div style={{ padding: "5px 10px", borderBottom: `1px solid ${HT.border}`, background: HT.panelBgStrong, backdropFilter: "blur(16px)", flexShrink: 0, position: "relative", zIndex: 10 }}>
          <p style={{ margin: 0, fontSize: 15, fontStyle: "italic", color: "#fff", lineHeight: 1.6, textAlign: "left" }}>
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
            {renderWithDaySeparators(activeEvents, false)}
            {staleEvents.length > 0 && (
              <>
                {activeEvents.length > 0 && (
                  <div style={{ height: 1, background: HT.border, margin: "2px 0" }} />
                )}
                {renderWithDaySeparators(staleEvents, true)}
              </>
            )}
          </>
        )}
      </div>

      {/* Earnings Today — logo strip pinned to the bottom of the panel */}
      {earnings.length > 0 && (
        <div style={{
          flexShrink: 0,
          borderTop: `1px solid ${HT.border}`,
          background: HT.panelBgStrong,
          backdropFilter: "blur(16px)",
          padding: "6px 10px 8px",
        }}>
          <div style={{
            fontSize: 9, fontWeight: 800, letterSpacing: "0.12em",
            textTransform: "uppercase", color: "#219EBC", marginBottom: 6,
          }}>
            Earnings Today · {earnings.length}
          </div>
          <div ref={stripRef} style={{
            display: "flex", gap: CHIP_GAP, overflow: "hidden",
            paddingBottom: 2, flexWrap: "nowrap",
          }}>
            {(() => {
              const overflow = earnings.length - maxChips;
              const showCount = overflow > 0 ? Math.max(0, maxChips - 1) : maxChips;
              const shown = earnings.slice(0, showCount);
              const hidden = earnings.length - shown.length;
              return (<>
            {shown.map((e) => (
              <a
                key={e.symbol}
                href={`https://finance.yahoo.com/quote/${e.symbol}`}
                target="_blank"
                rel="noreferrer"
                title={`${e.company || e.symbol}${e.callTime ? ` · ${e.callTime}` : ""}`}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  gap: 4, flexShrink: 0, width: 44, textDecoration: "none",
                }}
              >
                <span style={{
                  width: 32, height: 32, borderRadius: 8, overflow: "hidden",
                  background: "#fff", border: `1px solid ${HT.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <img
                    src={logoUrl(e.symbol)}
                    alt={e.symbol}
                    width={32}
                    height={32}
                    style={{ width: 32, height: 32, objectFit: "contain" }}
                    onError={(ev) => {
                      const t = ev.currentTarget;
                      t.style.display = "none";
                      const p = t.parentElement;
                      if (p && !p.querySelector(".logo-fallback")) {
                        const s = document.createElement("span");
                        s.className = "logo-fallback";
                        s.textContent = e.symbol.slice(0, 4);
                        s.style.cssText = "font-size:8px;font-weight:800;color:#05080d;text-align:center;line-height:1;";
                        p.appendChild(s);
                      }
                    }}
                  />
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 700, color: "#fff",
                  fontFamily: "monospace", letterSpacing: "0.02em",
                  maxWidth: 44, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {e.symbol}
                </span>
              </a>
            ))}
            {hidden > 0 && (
              <div
                title={`${hidden} more reporting today`}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "flex-start", gap: 4, flexShrink: 0, width: CHIP_W,
                }}
              >
                <span style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: "rgba(33,158,188,0.10)", border: `1px solid ${HT.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 800, color: "#219EBC",
                }}>
                  +{hidden}
                </span>
                <span style={{ fontSize: 9, fontWeight: 700, color: "#3a5570", fontFamily: "monospace" }}>
                  MORE
                </span>
              </div>
            )}
              </>);
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
