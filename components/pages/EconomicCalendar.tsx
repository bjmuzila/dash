"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { HOME_THEME as HT, homeShellStyle, homeButtonStyle, DOCK_THEME } from "@/components/shared/homeTheme";
// Same chip logo the home Economic Calendar panel uses: mirrored
// public/logos/<SYM>.png first (same-origin, immutably cached), then the live
// /proxy/ticker-logo resolver, then a ticker-text chip. This page used to hit
// the resolver directly, so mirrored logos never showed up here.
import ChipLogo from "@/components/shared/ChipLogo";
import { groupEarningsByDate } from "@/lib/econCalendar";

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

interface EarnRow {
  date: string;                          // YYYY-MM-DD (ET)
  symbol: string;
  company: string;
  session: "pre" | "after" | "unknown";
  market_cap: number;
  eps_est: string | null;
}

const CHIP_W = 46;
const CHIP_GAP = 10;

function fmtMcap(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  return `$${Math.round(n / 1e9)}B`;
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
  // Feed-health text is OWNER-ONLY — it names upstream hosts, HTTP status codes
  // and cache timestamps. Strict derivation (claim OR explicit id match) so a
  // build missing NEXT_PUBLIC_OWNER_USER_ID fails CLOSED rather than showing the
  // diagnostics to every signed-in customer.
  const { user, isOwnerClaim } = useAuth();
  const ownerId = (process.env.NEXT_PUBLIC_OWNER_USER_ID || "").trim();
  const isOwner = isOwnerClaim || (!!ownerId && user?.id === ownerId);

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
  const [activeTab,     setActiveTab]     = useState<"calendar" | "earnings">("calendar");
  const dropRef   = useRef<HTMLDivElement>(null);

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
        fetch("/proxy/earnings-week", { cache: "no-store" }),
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
        setEarnings(Array.isArray(ej.rows) ? ej.rows : []);
      }
    } catch (e) { setError(String(e)); setEvents([]); }
    finally    { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = etToday();

  // Earnings keyed by ET date → premarket / after-hours. "Time TBD" is dropped.
  // Memoised on `earnings`. This used to be a bare IIFE that rebuilt the whole
  // Map on EVERY render — including the once-a-minute `now` tick that exists
  // only to re-evaluate event staleness. So a page left open re-bucketed the
  // full earnings list 60 times an hour for a result that changes when the
  // fetch changes, which is once. Shared with the phone view via
  // lib/econCalendar so all three surfaces bucket identically.
  const earnByDate = useMemo(() => groupEarningsByDate(earnings), [earnings]);

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
          <span style={{ fontSize: 14, color: faded ? "#1e2a38" : HT.text, fontFamily: "var(--font-mono)" }}>
            {ev.time_formatted || ev.time || "TBD"}
          </span>
        </div>
        <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: col, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {ev.impact}
            </span>
            <span style={{ fontSize: 12, color: faded ? "#1e2a38" : HT.text, fontWeight: 600 }}>
              {ev.country}
            </span>
          </div>
          <div style={{ fontSize: 14, fontWeight: ev.impact === "High" ? 700 : 500, color: faded ? "#1e2a38" : HT.text, lineHeight: 1.3 }}>
            {ev.title}
          </div>
          {(ev.actual || ev.forecast || ev.previous) && (
            <div style={{ display: "flex", gap: 14, marginTop: 2 }}>
              {ev.actual   && <span style={{ fontSize: 12, color: faded ? "#1e2a38" : "#22c55e", fontFamily: "var(--font-mono)" }}>A: <strong>{ev.actual}</strong></span>}
              {ev.forecast && <span style={{ fontSize: 12, color: faded ? "#1e2a38" : "#f59e0b", fontFamily: "var(--font-mono)" }}>F: {ev.forecast}</span>}
              {ev.previous && <span style={{ fontSize: 12, color: faded ? "#1e2a38" : "#8a9ab8", fontFamily: "var(--font-mono)" }}>P: {ev.previous}</span>}
            </div>
          )}
        </div>
      </div>
    );
  };

  function renderWithDaySeparators(evList: CalEvent[], faded: boolean) {
    const result: React.ReactNode[] = [];
    const byDate = new Map<string, CalEvent[]>();
    evList.forEach(ev => {
      if (!byDate.has(ev.date)) byDate.set(ev.date, []);
      byDate.get(ev.date)!.push(ev);
    });

    let i = 0;
    for (const [date, evs] of byDate) {
      const isTod = date === today;
      result.push(
        <div
          key={`sep-${faded ? "s" : "a"}-${date}`}
          style={{
            padding: "6px 16px",
            background: isTod ? "rgba(33,158,188,0.06)" : HT.panelBg,
            borderTop: `1px solid ${HT.border}`,
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 800, color: isTod ? HT.cyan : "#3a5570", letterSpacing: "0.1em" }}>
            {fullDayLabel(date, today)}
          </span>
          {isTod && (
            <span style={{ fontSize: 10, fontWeight: 900, background: HT.cyan, color: "#05080d", padding: "1px 5px", borderRadius: 2, letterSpacing: "0.1em" }}>
              TODAY
            </span>
          )}
        </div>
      );

      const bucket = faded ? null : earnByDate.get(date);
      if (bucket?.pre.length) result.push(<EarnRowBlock key={`pre-${date}`} kind="pre" rows={bucket.pre} />);

      // After-hours slots in after the last event at/before 16:00.
      const afterIdx = evs.findIndex(e => (e.time || "00:00") > "16:00");
      evs.forEach((ev, k) => {
        if (bucket?.after.length && afterIdx >= 0 && k === afterIdx) {
          result.push(<EarnRowBlock key={`aft-${date}`} kind="after" rows={bucket.after} />);
        }
        result.push(renderEvent(ev, i++, faded));
      });
      if (bucket?.after.length && afterIdx < 0) {
        result.push(<EarnRowBlock key={`aft-${date}`} kind="after" rows={bucket.after} />);
      }
    }
    return result;
  }

  // Earnings-only view: every date that has pre/after earnings, newest first,
  // with an optional ticker/company search — independent of the impact filters.
  const earningsDates = Array.from(earnByDate.keys()).sort();
  const q = search.trim().toLowerCase();
  function matchesQ(r: EarnRow) {
    if (!q) return true;
    return r.symbol.toLowerCase().includes(q) || (r.company || "").toLowerCase().includes(q);
  }
  const earningsSections = earningsDates
    .map(date => {
      const bucket = earnByDate.get(date)!;
      const pre = bucket.pre.filter(matchesQ);
      const after = bucket.after.filter(matchesQ);
      return { date, pre, after };
    })
    .filter(s => s.pre.length > 0 || s.after.length > 0);

  function renderEarningsOnly() {
    if (earningsSections.length === 0) {
      return <div style={{ color: HT.text, fontSize: 14, padding: 20 }}>No earnings match.</div>;
    }
    return earningsSections.map(({ date, pre, after }) => {
      const isTod = date === today;
      return (
        <div key={`earn-sec-${date}`}>
          <div
            style={{
              padding: "6px 16px",
              background: isTod ? "rgba(33,158,188,0.06)" : HT.panelBg,
              borderTop: `1px solid ${HT.border}`,
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 800, color: isTod ? HT.cyan : "#3a5570", letterSpacing: "0.1em" }}>
              {fullDayLabel(date, today)}
            </span>
            {isTod && (
              <span style={{ fontSize: 10, fontWeight: 900, background: HT.cyan, color: "#05080d", padding: "1px 5px", borderRadius: 2, letterSpacing: "0.1em" }}>
                TODAY
              </span>
            )}
          </div>
          {pre.length > 0 && <EarnRowBlock kind="pre" rows={pre} />}
          {after.length > 0 && <EarnRowBlock kind="after" rows={after} />}
        </div>
      );
    });
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
            <span style={{ fontSize: 12, color: HT.text, fontFamily: "var(--font-mono)", background: HT.panelBg, padding: "2px 8px", borderRadius: 3 }}>
              {today}
            </span>
          )}

          {/* Tabs: full calendar vs earnings-only */}
          <div style={{ display: "flex", gap: 4, background: HT.panelBg, borderRadius: 6, padding: 3, border: `1px solid ${HT.border}` }}>
            {(["calendar", "earnings"] as const).map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                style={{
                  fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
                  padding: "5px 12px", borderRadius: 4, border: "none", cursor: "pointer",
                  background: activeTab === t ? HT.cyan : "transparent",
                  color: activeTab === t ? "#05080d" : HT.text,
                  transition: "background 0.15s, color 0.15s",
                }}
              >
                {t === "calendar" ? "Calendar" : "Earnings"}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Multi-select dropdown — only meaningful on the calendar tab */}
          {activeTab === "calendar" && (
          <div ref={dropRef} style={{ position: "relative" }}>
            <button onClick={() => setDropOpen(o => !o)} style={{ ...homeButtonStyle, display: "flex", alignItems: "center", gap: 6 }}>
              {filterLabel} <span style={{ fontSize: 10 }}>▾</span>
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
                        fontSize: 10, color: "#05080d", fontWeight: 900,
                      }}>{on ? "✓" : ""}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: on ? HT.cyan : HT.text }}>
                        {o.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          <input
            type="text" placeholder={activeTab === "earnings" ? "Search ticker…" : "Search…"} value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ fontSize: 12, padding: "4px 10px", background: "rgba(0,0,0,0.4)", border: `1px solid ${HT.border}`, color: HT.text, outline: "none", borderRadius: 3, width: 140 }}
          />
          <button onClick={load} disabled={loading} style={{ ...homeButtonStyle }}>
            {loading ? "…" : "↻ Now"}
          </button>
        </div>
      </div>

      {/* Quote */}
      {activeTab === "calendar" && quote && (
        <div style={{ padding: "10px 20px", borderBottom: `1px solid ${HT.border}`, background: HT.panelBgStrong, backdropFilter: "blur(16px)", flexShrink: 0, textAlign: "center" }}>
          <span style={{ fontSize: 14, fontStyle: "italic", color: HT.text, lineHeight: 1.7 }}>
            &ldquo;{quote}&rdquo;
          </span>
        </div>
      )}

      {/* Feed-health warning — OWNER ONLY (see isOwner above). This is the banner
          that was showing raw upstream text to customers. The hardcoded "showing
          saved events" prefix is gone too: it was wrong whenever the source was
          the cache rather than events.json, and `warning` already says which. */}
      {activeTab === "calendar" && isOwner && warning && !error && (
        <div style={{ padding: "6px 16px", fontSize: 12, color: "#f59e0b", background: "rgba(245,158,11,0.06)", borderBottom: "1px solid rgba(245,158,11,0.25)", flexShrink: 0 }}>
          ⚠ {warning}
        </div>
      )}

      {/* Event / earnings list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {activeTab === "earnings" ? (
          loading && earnings.length === 0 ? (
            <div style={{ color: HT.text, fontSize: 14, textAlign: "center", marginTop: 60 }}>Loading…</div>
          ) : (
            renderEarningsOnly()
          )
        ) : error && isOwner ? (
          // Raw fetch error, owner only. Customers fall through to the neutral
          // empty-state line below rather than seeing upstream status text.
          <div style={{ fontSize: 14, color: HT.red, padding: 16, margin: 16, border: `1px solid rgba(239,68,68,0.3)`, borderRadius: 4, background: "rgba(239,68,68,0.05)" }}>
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

    </div>
  );
}

// One earnings row woven into the calendar table — same grid as an event row.
function EarnRowBlock({ kind, rows }: { kind: "pre" | "after"; rows: EarnRow[] }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "80px 1fr",
      borderTop: `1px solid ${HT.border}`,
      borderLeft: `3px solid ${HT.cyan}`,
      background: `linear-gradient(90deg, ${HT.cyan}12 0%, transparent 40%), ${HT.bg}`,
      minHeight: 52,
    }}>
      <div style={{
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "8px 12px",
        borderRight: `1px solid ${HT.border}`,
        boxShadow: `inset -1px 0 8px ${HT.cyan}18`,
      }}>
        <span style={{ fontSize: 12, color: HT.cyan, fontFamily: "var(--font-mono)", fontWeight: 800, lineHeight: 1.25 }}>
          {kind === "pre" ? "PRE" : "AFTER"}
        </span>
        <span style={{ fontSize: 10, color: "#3a5570", fontFamily: "var(--font-mono)" }}>
          {kind === "pre" ? "MARKET" : "HOURS"}
        </span>
      </div>

      <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: HT.cyan, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {kind === "pre" ? "Premarket earnings" : "After-hours earnings"}
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: CHIP_GAP }}>
          {rows.map((e) => (
            <a
              key={e.symbol}
              href={`https://finance.yahoo.com/quote/${e.symbol}`}
              target="_blank"
              rel="noreferrer"
              title={`${e.company || e.symbol} · ${fmtMcap(e.market_cap)}${e.eps_est ? ` · est ${e.eps_est}` : ""}`}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0, width: CHIP_W, textDecoration: "none" }}
            >
              <ChipLogo sym={e.symbol} company={e.company} size={34} radius={8} />
              <span style={{ fontSize: 10, fontWeight: 700, color: HT.text, fontFamily: "var(--font-mono)", letterSpacing: "0.02em", maxWidth: CHIP_W, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.symbol}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
