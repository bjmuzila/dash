"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { HOME_THEME as HT, homeShellStyle, homeButtonStyle, DOCK_THEME } from "@/components/shared/homeTheme";

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

interface EarnRow { symbol: string; company: string; callTime: string; marketCap: number; }

const CHIP_W = 44;
const CHIP_GAP = 12;

function logoUrl(sym: string) {
  return `https://financialmodelingprep.com/image-stock/${sym.toUpperCase()}.png`;
}

const IMPACT_COLOR: Record<string, string> = {
  High:      HT.red,
  Medium:    "#f59e0b",
  Low:       "#3a5570",
  Holiday:   "#6b7280",
  President: "#a855f7",
};

function impactColor(i: string) { return IMPACT_COLOR[i] ?? "#3a5570"; }

type FilterKey = "high-usd" | "high" | "medium-usd" | "medium" | "low-usd" | "low" | "trump" | "all";

const FILTER_OPTS: { value: FilterKey; label: string; color: string }[] = [
  { value: "high-usd",   label: "High · USD",   color: HT.red },
  { value: "high",       label: "High",         color: HT.red },
  { value: "medium-usd", label: "Medium · USD", color: "#f59e0b" },
  { value: "medium",     label: "Medium",       color: "#f59e0b" },
  { value: "low-usd",    label: "Low · USD",    color: "#3a5570" },
  { value: "low",        label: "Low",          color: "#3a5570" },
  { value: "trump",      label: "TRUMP",        color: "#a855f7" },
  { value: "all",        label: "All",          color: HT.text },
];

function passes(ev: CalEvent, active: Set<FilterKey>): boolean {
  if (active.has("all")) return true;
  if (active.has("trump")      && ev.impact === "President") return true;
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
  if (!ev.time) return false;
  const [h, m] = ev.time.split(":").map(Number);
  return nowMin - (h * 60 + m) > 30;
}

function fullDayLabel(dateStr: string, today: string): string {
  if (dateStr === today) return "TODAY";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
}

export default function EconomicCalendarPage() {
  const [events,        setEvents]        = useState<CalEvent[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [warning,       setWarning]       = useState<string | null>(null);
  const [lastRefresh,   setLastRefresh]   = useState<string | null>(null);
  const [quote,         setQuote]         = useState<string | null>(null);
  const [now,           setNow]           = useState(() => Date.now());
  const [search,        setSearch]        = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set(["all"]));
  const [dropOpen,      setDropOpen]      = useState(false);
  const [earnings,      setEarnings]      = useState<EarnRow[]>([]);
  const [maxChips,      setMaxChips]      = useState(12);
  const dropRef   = useRef<HTMLDivElement>(null);
  const stripRef  = useRef<HTMLDivElement>(null);

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
      const [econRes, qRes, earnRes] = await Promise.all([
        fetch("/api/calendar", { cache: "no-store" }),
        fetch("/api/calendar-quote", { cache: "no-store" }),
        fetch("/api/earnings-today", { cache: "no-store" }),
      ]);
      const econJson = await econRes.json();
      if (!econRes.ok) throw new Error(econJson?.error || `HTTP ${econRes.status}`);
      const list: CalEvent[] = Array.isArray(econJson?.events) ? econJson.events : Array.isArray(econJson) ? econJson : [];
      const sorted = list.sort((a, b) =>
        a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time)
      );
      setEvents(sorted);
      setWarning(econJson?.warning ? String(econJson.warning) : null);
      setLastRefresh(new Date().toLocaleTimeString());
      if (qRes.ok) {
        const qj = await qRes.json();
        if (qj.quote) setQuote(qj.quote);
      }
      if (earnRes.ok) {
        const ej = await earnRes.json();
        setEarnings(Array.isArray(ej.earnings) ? ej.earnings : []);
      }
    } catch (e) { setError(String(e)); setEvents([]); }
    finally    { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      setMaxChips(Math.max(1, Math.floor((w + CHIP_GAP) / (CHIP_W + CHIP_GAP))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [earnings.length]);

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

  const activeEvents = filtered.filter(e => !isStale(e, now));
  const staleEvents  = filtered.filter(e =>  isStale(e, now));

  const filterLabel = activeFilters.has("all")
    ? "ALL"
    : Array.from(activeFilters).map(k => FILTER_OPTS.find(o => o.value === k)?.label ?? k).join(" + ");

  const renderEvent = (ev: CalEvent, i: number, faded: boolean) => {
    const col = faded ? "#1e2a38" : impactColor(ev.impact);
    return (
      <div
        key={`${ev.date}-${ev.time}-${i}`}
        style={{
          display: "grid",
          gridTemplateColumns: "80px 1fr",
          borderTop: `1px solid ${HT.border}`,
          borderLeft: `3px solid ${col}`,
          background: faded ? HT.bg : `linear-gradient(90deg, ${col}0f 0%, transparent 35%), ${HT.bg}`,
          opacity: faded ? 0.32 : 1,
          transition: "opacity 0.4s",
          minHeight: 52,
        }}
      >
        <div style={{
          display: "flex", flexDirection: "column", justifyContent: "center",
          padding: "8px 12px",
          borderRight: `1px solid ${HT.border}`,
          boxShadow: faded ? "none" : `inset -1px 0 8px ${col}18`,
          gap: 2,
        }}>
          <span style={{ fontSize: 13, color: faded ? "#1e2a38" : HT.text, fontFamily: "monospace" }}>
            {ev.time_formatted || ev.time || "TBD"}
          </span>
        </div>
        <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: col, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {ev.impact}
            </span>
            <span style={{ fontSize: 11, color: faded ? "#1e2a38" : HT.text, fontWeight: 600 }}>
              {ev.country}
            </span>
          </div>
          <div style={{ fontSize: 15, fontWeight: ev.impact === "High" ? 700 : 500, color: faded ? "#1e2a38" : HT.text, lineHeight: 1.3 }}>
            {ev.title}
          </div>
          {(ev.actual || ev.forecast || ev.previous) && (
            <div style={{ display: "flex", gap: 14, marginTop: 2 }}>
              {ev.actual   && <span style={{ fontSize: 12, color: faded ? "#1e2a38" : "#22c55e", fontFamily: "monospace" }}>A: <strong>{ev.actual}</strong></span>}
              {ev.forecast && <span style={{ fontSize: 12, color: faded ? "#1e2a38" : "#f59e0b", fontFamily: "monospace" }}>F: {ev.forecast}</span>}
              {ev.previous && <span style={{ fontSize: 12, color: faded ? "#1e2a38" : "#8a9ab8", fontFamily: "monospace" }}>P: {ev.previous}</span>}
            </div>
          )}
        </div>
      </div>
    );
  };

  function renderWithDaySeparators(evList: CalEvent[], faded: boolean) {
    const result: React.ReactNode[] = [];
    let lastDate = "";
    evList.forEach((ev, i) => {
      if (ev.date !== lastDate) {
        lastDate = ev.date;
        const isTod = ev.date === today;
        result.push(
          <div
            key={`sep-${faded ? "s" : "a"}-${ev.date}`}
            style={{
              padding: "6px 16px",
              background: isTod ? "rgba(33,158,188,0.06)" : HT.panelBg,
              borderTop: `1px solid ${HT.border}`,
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 800, color: isTod ? HT.cyan : "#3a5570", letterSpacing: "0.1em" }}>
              {fullDayLabel(ev.date, today)}
            </span>
            {isTod && (
              <span style={{ fontSize: 8, fontWeight: 900, background: HT.cyan, color: "#05080d", padding: "1px 5px", borderRadius: 2, letterSpacing: "0.1em" }}>
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
    <div style={{ ...homeShellStyle, height: "100%" }}>

      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 16px", background: HT.panelBgStrong, backdropFilter: "blur(16px)",
        borderBottom: `1px solid ${HT.border}`, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: HT.text }}>
            📅 Economic Calendar
          </span>
          {lastRefresh && (
            <span style={{ fontSize: 11, color: HT.text, fontFamily: "monospace", background: HT.panelBg, padding: "2px 8px", borderRadius: 3 }}>
              {today}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Multi-select dropdown */}
          <div ref={dropRef} style={{ position: "relative" }}>
            <button onClick={() => setDropOpen(o => !o)} style={{ ...homeButtonStyle, display: "flex", alignItems: "center", gap: 6 }}>
              {filterLabel} <span style={{ fontSize: 8 }}>▾</span>
            </button>
            {dropOpen && (
              <div style={{
                position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 200,
                background: DOCK_THEME.bg, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
                border: `1px solid ${HT.border}`, borderTop: `2px solid ${DOCK_THEME.cyanTop}`, borderRadius: 14,
                padding: 6, minWidth: 180, boxShadow: DOCK_THEME.shadow,
              }}>
                {FILTER_OPTS.map(o => {
                  const on = activeFilters.has(o.value);
                  return (
                    <div
                      key={o.value}
                      onClick={() => toggleFilter(o.value)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 12px", cursor: "pointer", borderRadius: 8,
                        background: on ? DOCK_THEME.activeTile : "transparent",
                        border: on ? `1px solid ${DOCK_THEME.activeBorder}` : "1px solid transparent",
                      }}
                      onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = DOCK_THEME.hoverTile; }}
                      onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                        border: `2px solid ${o.color}`,
                        background: on ? o.color : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, color: "#05080d", fontWeight: 900,
                      }}>{on ? "✓" : ""}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: on ? HT.cyan : HT.text }}>
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
          <button onClick={load} disabled={loading} style={{ ...homeButtonStyle }}>
            {loading ? "…" : "↻ Now"}
          </button>
        </div>
      </div>

      {/* Quote */}
      {quote && (
        <div style={{ padding: "10px 20px", borderBottom: `1px solid ${HT.border}`, background: HT.panelBgStrong, backdropFilter: "blur(16px)", flexShrink: 0, textAlign: "center" }}>
          <span style={{ fontSize: 13, fontStyle: "italic", color: HT.text, lineHeight: 1.7 }}>
            &ldquo;{quote}&rdquo;
          </span>
        </div>
      )}

      {/* Warning */}
      {warning && !error && (
        <div style={{ padding: "6px 16px", fontSize: 11, color: "#f59e0b", background: "rgba(245,158,11,0.06)", borderBottom: "1px solid rgba(245,158,11,0.25)", flexShrink: 0 }}>
          ⚠ Live feed unavailable — showing saved events. ({warning})
        </div>
      )}

      {/* Event list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {error ? (
          <div style={{ fontSize: 13, color: HT.red, padding: 16, margin: 16, border: `1px solid rgba(239,68,68,0.3)`, borderRadius: 4, background: "rgba(239,68,68,0.05)" }}>
            ⚠ {error}
          </div>
        ) : loading && events.length === 0 ? (
          <div style={{ color: HT.text, fontSize: 14, textAlign: "center", marginTop: 60 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: HT.text, fontSize: 14, padding: 20 }}>No events match.</div>
        ) : (
          <>
            {renderWithDaySeparators(activeEvents, false)}
            {staleEvents.length > 0 && (
              <>
                {activeEvents.length > 0 && <div style={{ height: 1, background: HT.border, margin: "2px 0" }} />}
                {renderWithDaySeparators(staleEvents, true)}
              </>
            )}
          </>
        )}
      </div>

      {/* Earnings Today strip */}
      {earnings.length > 0 && (
        <div style={{
          flexShrink: 0,
          borderTop: `1px solid ${HT.border}`,
          background: HT.panelBgStrong,
          backdropFilter: "blur(16px)",
          padding: "8px 16px 10px",
        }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: HT.cyan, marginBottom: 8 }}>
            Earnings Today · {earnings.length}
          </div>
          <div ref={stripRef} style={{ display: "flex", gap: CHIP_GAP, overflow: "hidden", paddingBottom: 2, flexWrap: "nowrap" }}>
            {(() => {
              const overflow = earnings.length - maxChips;
              const showCount = overflow > 0 ? Math.max(0, maxChips - 1) : maxChips;
              const shown = earnings.slice(0, showCount);
              const hidden = earnings.length - shown.length;
              return (
                <>
                  {shown.map((e) => (
                    <a
                      key={e.symbol}
                      href={`https://finance.yahoo.com/quote/${e.symbol}`}
                      target="_blank"
                      rel="noreferrer"
                      title={`${e.company || e.symbol}${e.callTime ? ` · ${e.callTime}` : ""}`}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0, width: CHIP_W, textDecoration: "none" }}
                    >
                      <span style={{
                        width: 32, height: 32, borderRadius: 8, overflow: "hidden",
                        background: "#fff", border: `1px solid ${HT.border}`,
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}>
                        <img
                          src={logoUrl(e.symbol)} alt={e.symbol} width={32} height={32}
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
                      <span style={{ fontSize: 9, fontWeight: 700, color: HT.text, fontFamily: "monospace", letterSpacing: "0.02em", maxWidth: CHIP_W, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {e.symbol}
                      </span>
                    </a>
                  ))}
                  {hidden > 0 && (
                    <div title={`${hidden} more reporting today`} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", gap: 4, flexShrink: 0, width: CHIP_W }}>
                      <span style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(33,158,188,0.10)", border: `1px solid ${HT.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: HT.cyan }}>
                        +{hidden}
                      </span>
                      <span style={{ fontSize: 9, fontWeight: 700, color: "#3a5570", fontFamily: "monospace" }}>MORE</span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
