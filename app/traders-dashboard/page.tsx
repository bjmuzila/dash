"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HOME_THEME as HT } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

// rgba helper — matches the convention used across themed pages.
function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScheduleItem { id: string; time: string; label: string; }
interface TaskItem { id: string; label: string; done: boolean; }
interface CalEvent { date: string; time_formatted: string; title: string; country: string; impact: string; }
interface Driver { when: string; title: string; body: string; }
interface OverviewRow { date: string; summary: string; drivers: Driver[]; generated_at: number; }
interface QuoteRow { price: number | null; change: number | null; pct: number | null; }

const FUTURES = [
  { sym: "ES", yahoo: "ES=F" },
  { sym: "NQ", yahoo: "NQ=F" },
  { sym: "YM", yahoo: "YM=F" },
];

const DEFAULT_SCHEDULE: ScheduleItem[] = [
  { id: "s1", time: "08:00 AM", label: "Coffee & Market Review" },
  { id: "s2", time: "08:30 AM", label: "Daily Planning" },
  { id: "s3", time: "09:00 AM", label: "Pre-Market Analysis" },
  { id: "s4", time: "09:30 AM", label: "Market Open" },
];

const DEFAULT_TASKS: TaskItem[] = [
  { id: "t1", label: "Review portfolio allocations", done: false },
  { id: "t2", label: "Prepare presentation slides for the 2 PM meeting", done: false },
  { id: "t3", label: "Quick workout (15 mins)", done: false },
  { id: "t4", label: "Check pre-market volume on watch list", done: false },
];

const DRIVER_COLORS = [HT.cyan, HT.orange, HT.red, HT.purple];
const uid = () => Math.random().toString(36).slice(2, 9);

// US equity-market full-day closures (NYSE/Cboe), ET date strings. Keep in sync with server-v2.
const MARKET_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
// en-CA gives YYYY-MM-DD; weekday short name in ET.
const etDateStr = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const etWeekday = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(d);
const isTradingDay = (d: Date) => {
  const wd = etWeekday(d);
  return wd !== "Sat" && wd !== "Sun" && !MARKET_HOLIDAYS.has(etDateStr(d));
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TradersDashboardPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>(DEFAULT_SCHEDULE);
  const [tasks, setTasks] = useState<TaskItem[]>(DEFAULT_TASKS);
  const [zip, setZip] = useState("");
  const [zipInput, setZipInput] = useState("");
  const [weather, setWeather] = useState<{ tempF: number; condition: string; place: string } | null>(null);
  const [quotes, setQuotes] = useState<Record<string, QuoteRow>>({});
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [overview, setOverview] = useState<OverviewRow | null>(null);
  const [editSched, setEditSched] = useState(false);
  const [editTasks, setEditTasks] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // ── Clock ──
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Load per-user prefs ──
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/traders-dashboard", { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j.schedule) && j.schedule.length) setSchedule(j.schedule);
          if (Array.isArray(j.tasks) && j.tasks.length) setTasks(j.tasks);
          if (j.zip) { setZip(j.zip); setZipInput(j.zip); }
        }
      } catch { /* keep defaults */ }
      setLoaded(true);
    })();
  }, []);

  // ── Save prefs (debounced) once loaded ──
  const savePrefs = useCallback((patch: { schedule?: ScheduleItem[]; tasks?: TaskItem[]; zip?: string | null }) => {
    fetch("/api/traders-dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }, []);

  // ── Live futures (Yahoo poll, 60s) ──
  const pollQuotes = useCallback(async () => {
    const syms = FUTURES.map((f) => f.yahoo).join(",");
    try {
      const r = await fetch(`/api/yahoo-quotes?symbols=${encodeURIComponent(syms)}&_=${Date.now()}`, { cache: "no-store" });
      if (r.ok) setQuotes(await r.json());
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    pollQuotes();
    const id = setInterval(pollQuotes, 60_000);
    return () => clearInterval(id);
  }, [pollQuotes]);

  // ── Econ calendar (drivers) ──
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/calendar", { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          setEvents(Array.isArray(j?.events) ? j.events : Array.isArray(j) ? j : []);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // ── AI overnight overview ──
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/traders-dashboard/overview", { cache: "no-store" });
        if (r.ok) { const j = await r.json(); if (j.overview) setOverview(j.overview); }
      } catch { /* ignore */ }
    })();
  }, []);

  // ── Weather ──
  const loadWeather = useCallback(async (z: string) => {
    if (!/^\d{5}$/.test(z)) return;
    try {
      const r = await fetch(`/api/weather?zip=${z}`, { cache: "no-store" });
      if (r.ok) setWeather(await r.json());
      else setWeather(null);
    } catch { setWeather(null); }
  }, []);
  useEffect(() => { if (zip) loadWeather(zip); }, [zip, loadWeather]);

  // ── Derived ──
  const { countdown, targetLabel } = useMemo(() => {
    if (!now) return { countdown: "--:--:--", targetLabel: "9:30 AM EST" };
    const target = new Date(now);
    target.setHours(9, 30, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    // Roll forward to the next trading day (skip weekends + market holidays).
    let guard = 0;
    while (!isTradingDay(target) && guard++ < 14) target.setDate(target.getDate() + 1);
    let s = Math.floor((target.getTime() - now.getTime()) / 1000);
    const days = Math.floor(s / 86400);
    s %= 86400;
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    s %= 3600;
    const m = String(Math.floor(s / 60)).padStart(2, "0");
    const hms = `${h}:${m}:${String(s % 60).padStart(2, "0")}`;
    const isToday = etDateStr(target) === etDateStr(now);
    const label = isToday
      ? "Target: 9:30 AM EST"
      : `Target: ${target.toLocaleDateString("en-US", { weekday: "long" })} 9:30 AM EST`;
    return { countdown: days > 0 ? `${days}d ${hms}` : hms, targetLabel: label };
  }, [now]);

  const dateStr = now
    ? now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "";

  // Drivers: AI overview's if present, else top high-impact USD events today.
  const drivers: Driver[] = useMemo(() => {
    if (overview?.drivers?.length) return overview.drivers.slice(0, 4);
    const etToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    return events
      .filter((e) => e.date === etToday && e.country === "USD" && /high/i.test(e.impact))
      .slice(0, 4)
      .map((e) => ({ when: e.time_formatted || "Today", title: e.title, body: `High-impact USD event · ${e.country}` }));
  }, [overview, events]);

  const completed = tasks.filter((t) => t.done).length;
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  const sectionLabel = { fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: HT.muted };
  const miniBtn = { padding: "3px 8px", borderRadius: 5, border: `1px solid ${HT.border}`, background: rgba(HT.text, 0.04), color: HT.cyan, fontSize: 10, fontWeight: 700, cursor: "pointer" } as const;
  const inputStyle = { fontSize: 13, padding: "5px 8px", border: `1px solid ${HT.border}`, borderRadius: 5, background: "rgba(0,0,0,0.4)", color: HT.text, outline: "none" } as const;

  // ── Mutators ──
  const updSchedule = (next: ScheduleItem[]) => { setSchedule(next); if (loaded) savePrefs({ schedule: next }); };
  const updTasks = (next: TaskItem[]) => { setTasks(next); if (loaded) savePrefs({ tasks: next }); };

  return (
    <PageShell maxWidth={1200}>

        {/* Header */}
        <Card accent="cyan" padding={20} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, background: `linear-gradient(90deg,${HT.cyan},${HT.purple})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Traders Dashboard
            </h1>
            <div style={{ color: HT.muted, fontSize: 13, marginTop: 4 }}>{dateStr}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            {weather ? (
              <>
                <div style={{ fontSize: 22, fontWeight: 700, color: HT.green }}>☀ {weather.tempF}°F</div>
                <div style={{ color: HT.muted, fontSize: 12 }}>{weather.condition}, {weather.place}</div>
              </>
            ) : (
              <form
                onSubmit={(e) => { e.preventDefault(); const z = zipInput.trim(); if (/^\d{5}$/.test(z)) { setZip(z); savePrefs({ zip: z }); } }}
                style={{ display: "flex", gap: 6, alignItems: "center" }}
              >
                <input value={zipInput} onChange={(e) => setZipInput(e.target.value)} placeholder="ZIP" maxLength={5} style={{ ...inputStyle, width: 80 }} />
                <button type="submit" style={miniBtn}>Set</button>
              </form>
            )}
            {weather && (
              <button onClick={() => { setWeather(null); setZip(""); setZipInput(""); savePrefs({ zip: null }); }} style={{ ...miniBtn, marginTop: 4 }}>Change ZIP</button>
            )}
          </div>
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1fr)", gap: 20 }}>
          {/* LEFT COLUMN */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>

            {/* Countdown */}
            <Card accent="orange" padding="28px 20px" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>Countdown to Market Open</div>
              <div style={{ fontSize: "clamp(48px,8vw,84px)", fontWeight: 800, letterSpacing: 2, fontVariantNumeric: "tabular-nums" }}>{countdown}</div>
              <div style={{ color: HT.muted, fontSize: 13, marginTop: 8 }}>{targetLabel}</div>
            </Card>

            {/* Overnight Overview */}
            <Card accent="green" padding={20}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
                <div style={{ fontSize: 17, fontWeight: 700 }}>📈 Overnight Market Overview</div>
                {overview && Number(overview.generated_at) > 0 && (
                  <span style={{ fontSize: 10, color: HT.muted }}>
                    Generated {new Date(Number(overview.generated_at)).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })} ET
                  </span>
                )}
              </div>

              <div style={{ borderLeft: `3px solid ${HT.cyan}`, paddingLeft: 14, marginBottom: 20, color: rgba(HT.text, 0.78), fontSize: 14, lineHeight: 1.5 }}>
                {overview ? (
                  <><strong style={{ color: HT.text }}>Sentiment:</strong> {overview.summary}</>
                ) : (
                  <span style={{ color: HT.muted }}>Today&apos;s overview is generated automatically at 7:00 AM ET. Check back shortly.</span>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...sectionLabel, marginBottom: 10 }}>📉 Overnight Futures (Live)</div>
                  <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                    {FUTURES.map((f) => {
                      const pct = quotes[f.yahoo]?.pct ?? null;
                      const pos = (pct ?? 0) >= 0;
                      return (
                        <div key={f.sym} style={{ flex: 1, textAlign: "center", padding: "10px 6px", borderRadius: 8, border: `1px solid ${HT.border}`, background: "rgba(0,0,0,0.25)" }}>
                          <div style={{ fontSize: 11, color: HT.muted, fontWeight: 700 }}>{f.sym}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: pct == null ? HT.muted : pos ? HT.green : HT.red }}>
                            {pct == null ? "—" : `${pos ? "+" : ""}${pct.toFixed(2)}%`}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ ...sectionLabel, marginBottom: 10 }}>⚡ Pre-Market Movers</div>
                  <div style={{ padding: "14px 12px", borderRadius: 8, border: `1px dashed ${HT.border}`, background: "rgba(0,0,0,0.2)", color: HT.muted, fontSize: 12, textAlign: "center" }}>
                    Movers feed goes live Monday.
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ ...sectionLabel, marginBottom: 10 }}>🗓 Key Drivers Today</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {drivers.length ? drivers.map((d, i) => {
                      const c = DRIVER_COLORS[i % DRIVER_COLORS.length];
                      return (
                        <div key={d.title + i} style={{ borderLeft: `3px solid ${c}`, padding: "8px 0 8px 12px" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: c }}>{d.when}</div>
                          <div style={{ fontWeight: 700, margin: "2px 0" }}>{d.title}</div>
                          <div style={{ color: HT.muted, fontSize: 12, lineHeight: 1.4 }}>{d.body}</div>
                        </div>
                      );
                    }) : (
                      <div style={{ color: HT.muted, fontSize: 12 }}>No major USD events scheduled today.</div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>

            {/* Quick Links */}
            <Card accent="cyan" padding={20}>
              <div style={{ fontSize: 17, fontWeight: 700, color: HT.cyan, marginBottom: 16 }}>🔗 Quick Links</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { label: "Home", href: "/home" },
                  { label: "Multi Greek", href: "/mult-greek" },
                  { label: "Analytics", href: "/analytics" },
                ].map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 8, border: `1px solid ${HT.border}`, background: "rgba(0,0,0,0.25)", color: HT.text, textDecoration: "none", fontWeight: 600, fontSize: 14, transition: "background .15s, border-color .15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = rgba(HT.cyan, 0.12); e.currentTarget.style.borderColor = HT.cyan; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.25)"; e.currentTarget.style.borderColor = HT.border; }}
                  >
                    <span>{l.label}</span>
                    <span style={{ color: HT.cyan }}>→</span>
                  </a>
                ))}
              </div>
            </Card>

            {/* Schedule */}
            <Card accent="red" padding={20}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: HT.red }}>🕐 Morning Schedule</div>
                <button onClick={() => setEditSched((v) => !v)} style={miniBtn}>{editSched ? "Done" : "Edit"}</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {schedule.map((s, i) => editSched ? (
                  <div key={s.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input value={s.time} onChange={(e) => updSchedule(schedule.map((x) => x.id === s.id ? { ...x, time: e.target.value } : x))} style={{ ...inputStyle, width: 90 }} />
                    <input value={s.label} onChange={(e) => updSchedule(schedule.map((x) => x.id === s.id ? { ...x, label: e.target.value } : x))} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
                    <button onClick={() => updSchedule(schedule.filter((x) => x.id !== s.id))} style={{ ...miniBtn, color: HT.red }}>✕</button>
                  </div>
                ) : (
                  <div key={s.id} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: HT.muted, fontWeight: 700, whiteSpace: "nowrap" }}>{s.time}</span>
                    <span style={{ fontWeight: i === schedule.length - 1 ? 700 : 500 }}>{s.label}</span>
                  </div>
                ))}
              </div>
              {editSched && (
                <button onClick={() => updSchedule([...schedule, { id: uid(), time: "09:00 AM", label: "New item" }])} style={{ ...miniBtn, marginTop: 12 }}>+ Add</button>
              )}
            </Card>

            {/* Tasks */}
            <Card accent="green" padding={20}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: HT.green }}>✅ Pre-Market Tasks</div>
                <button onClick={() => setEditTasks((v) => !v)} style={miniBtn}>{editTasks ? "Done" : "Edit"}</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {tasks.map((t) => editTasks ? (
                  <div key={t.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input value={t.label} onChange={(e) => updTasks(tasks.map((x) => x.id === t.id ? { ...x, label: e.target.value } : x))} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
                    <button onClick={() => updTasks(tasks.filter((x) => x.id !== t.id))} style={{ ...miniBtn, color: HT.red }}>✕</button>
                  </div>
                ) : (
                  <label key={t.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                    <input type="checkbox" checked={t.done} onChange={() => updTasks(tasks.map((x) => x.id === t.id ? { ...x, done: !x.done } : x))} style={{ marginTop: 2, accentColor: HT.green, width: 16, height: 16 }} />
                    <span style={{ fontSize: 14, color: t.done ? HT.muted : HT.text, textDecoration: t.done ? "line-through" : "none" }}>{t.label}</span>
                  </label>
                ))}
              </div>
              {editTasks && (
                <button onClick={() => updTasks([...tasks, { id: uid(), label: "New task", done: false }])} style={{ ...miniBtn, marginTop: 12 }}>+ Add</button>
              )}
              {!editTasks && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: HT.muted, marginBottom: 6 }}>
                    <span>Task Progress</span><span>{progress}%</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: rgba(HT.text, 0.08), overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${progress}%`, background: `linear-gradient(90deg,${HT.cyan},${HT.green})`, transition: "width .3s" }} />
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
    </PageShell>
  );
}
