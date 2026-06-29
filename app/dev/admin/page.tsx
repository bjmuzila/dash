"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  OWNER_THEME as HOME_THEME,
  homeButtonStyle,
  homeHeaderStyle,
  homePanelStyle,
  homeShellStyle,
  homeSecondaryButtonStyle,
} from "@/components/shared/ownerTheme";
import { OwnerQuickLinks } from "@/components/shared/OwnerQuickLinks";

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = "current_week" | "current_month" | "last_week" | "last_month" | "current_year";

interface KpiData {
  totalSales: number;
  totalRevenue: number;
  totalUsers: number;
  totalTraffic: number;
  salesDelta: number;
  revenueDelta: number;
  usersDelta: number;
  trafficDelta: number;
}

interface SalesByDay {
  day: string;       // "Mon", "Tue" etc. or "1","2"...
  label: string;     // "MON 8th"
  revenue: number;
  orders: number;
}

interface ProductEarning {
  name: string;
  revenue: number;
  pct: number;
  color: string;
}

interface CountryUser {
  country: string;
  flag: string;
  users: number;
  pct: number;
}

interface Transaction {
  id: string;
  ts: number;
  customer: string;
  product: string;
  amount: number;
  status: "completed" | "pending" | "failed";
}

// ─── Mock data generators ─────────────────────────────────────────────────────

function seedRand(seed: number) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

function genKpi(period: Period): KpiData {
  const r = seedRand(period.length * 31);
  const base = period.includes("month") ? 8 : 2;
  return {
    totalRevenue: Math.round(r() * 80000 + base * 40000),
    totalSales: Math.round(r() * 2000 + base * 800),
    totalUsers: Math.round(r() * 5000 + base * 2000),
    totalTraffic: Math.round(r() * 30000 + base * 15000),
    revenueDelta: parseFloat(((r() - 0.4) * 30).toFixed(1)),
    salesDelta: parseFloat(((r() - 0.4) * 25).toFixed(1)),
    usersDelta: parseFloat(((r() - 0.45) * 20).toFixed(1)),
    trafficDelta: parseFloat(((r() - 0.35) * 18).toFixed(1)),
  };
}

function ordinal(n: number): string {
  const s = ["th","st","nd","rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function genDailySales(period: Period): SalesByDay[] {
  const r = seedRand(period.length * 17);
  const now = new Date();
  // Compute the start date for the period
  const startDate = new Date(now);
  if (period === "current_week") {
    const dow = (now.getDay() + 6) % 7; // Mon=0
    startDate.setDate(now.getDate() - dow);
  } else if (period === "last_week") {
    const dow = (now.getDay() + 6) % 7;
    startDate.setDate(now.getDate() - dow - 7);
  } else if (period === "current_month") {
    startDate.setDate(1);
  } else {
    startDate.setDate(1);
    startDate.setMonth(startDate.getMonth() - 1);
  }
  const days = period.includes("week") ? 7 : 30;
  const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const dayName = DAY_NAMES[d.getDay()];
    const dateNum = d.getDate();
    return {
      day: dayName,
      label: `${dayName.toUpperCase()} ${ordinal(dateNum)}`,
      revenue: Math.round(r() * 8000 + 2000),
      orders: Math.round(r() * 80 + 20),
    };
  });
}

function genProducts(): ProductEarning[] {
  const COLORS = [HOME_THEME.cyan, HOME_THEME.purple, HOME_THEME.green, HOME_THEME.orange, "#e879f9"];
  const items = [
    { name: "SPX GEX Premium", revenue: 42300 },
    { name: "Options Flow Pro", revenue: 28900 },
    { name: "ES Candles Suite", revenue: 18700 },
    { name: "Confidence Score", revenue: 12100 },
    { name: "MVC Analytics", revenue: 7400 },
  ];
  const total = items.reduce((s, i) => s + i.revenue, 0);
  return items.map((item, i) => ({
    ...item,
    pct: Math.round((item.revenue / total) * 100),
    color: COLORS[i],
  }));
}

function genCountries(): CountryUser[] {
  return [
    { country: "United States", flag: "🇺🇸", users: 8420, pct: 38 },
    { country: "United Kingdom", flag: "🇬🇧", users: 4210, pct: 19 },
    { country: "Canada", flag: "🇨🇦", users: 2870, pct: 13 },
    { country: "Australia", flag: "🇦🇺", users: 1950, pct: 9 },
    { country: "Germany", flag: "🇩🇪", users: 1640, pct: 7 },
    { country: "Other", flag: "🌍", users: 3110, pct: 14 },
  ];
}

const NAMES = ["Alex M.", "Sarah K.", "James T.", "Emma R.", "Liam N.", "Olivia P.", "Noah C.", "Ava S.", "Chris W.", "Maya B."];
const PRODUCTS = ["SPX GEX Premium", "Flow Pro", "ES Candles", "Confidence+", "MVC Suite"];

function genTransaction(): Transaction {
  const r = Math.random;
  const statuses = ["completed", "completed", "completed", "pending", "failed"] as const;
  return {
    id: "#" + Math.floor(r() * 90000 + 10000),
    ts: Date.now() - Math.floor(r() * 60000),
    customer: NAMES[Math.floor(r() * NAMES.length)],
    product: PRODUCTS[Math.floor(r() * PRODUCTS.length)],
    amount: parseFloat((r() * 290 + 29).toFixed(2)),
    status: statuses[Math.floor(r() * statuses.length)],
  };
}

// ─── Calendar ────────────────────────────────────────────────────────────────

interface CalendarDay {
  date: number;
  revenue: number;
  inMonth: boolean;
}

function buildCalendar(year: number, month: number): CalendarDay[] {
  const first = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const r = seedRand(year * 12 + month);
  const days: CalendarDay[] = [];
  for (let i = first - 1; i >= 0; i--) {
    days.push({ date: daysInPrev - i, revenue: 0, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    const isWeekend = dow === 0 || dow === 6;
    days.push({ date: d, revenue: isWeekend ? Math.round(r() * 1200 + 200) : Math.round(r() * 4000 + 800), inMonth: true });
  }
  while (days.length % 7 !== 0) days.push({ date: days.length - daysInMonth - first + 2, revenue: 0, inMonth: false });
  return days;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(v: number) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtNum(v: number) {
  return v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(v);
}

function fmtTs(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
}

const PERIOD_LABELS: Record<Period, string> = {
  current_week: "This Week",
  current_month: "This Month",
  last_week: "Last Week",
  last_month: "Last Month",
  current_year: "This Year",
};

// Build x-axis buckets (labels) for the bar chart based on period & real dates
function periodBuckets(period: Period): string[] {
  const now = new Date();
  if (period === "current_year") {
    return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  }
  if (period === "current_month" || period === "last_month") {
    const ref = new Date(now);
    if (period === "last_month") ref.setMonth(ref.getMonth() - 1);
    const y = ref.getFullYear(), m = ref.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m];
    // weekly buckets within the month
    return [1, 8, 15, 22, days].slice(0, 5).map((d) => `${mon} ${d}`);
  }
  // weeks: Mon–Sun dates
  const ref = new Date(now);
  if (period === "last_week") ref.setDate(ref.getDate() - 7);
  const dow = (ref.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - dow);
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return `${mon[d.getMonth()]} ${d.getDate()}`;
  });
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, delta, prefix = "" }: { label: string; value: string; delta: number; prefix?: string }) {
  const up = delta >= 0;
  return (
    <div style={{ ...homePanelStyle, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: HOME_THEME.muted, letterSpacing: "0.01em" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 500, color: HOME_THEME.text, lineHeight: 1 }}>{prefix}{value}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: up ? HOME_THEME.green : HOME_THEME.red }}>
        <span>{up ? "▲" : "▼"}</span>
        <span>{Math.abs(delta)}% vs prior period</span>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 500, color: HOME_THEME.muted, letterSpacing: "0.01em", marginBottom: 8 }}>
      {children}
    </div>
  );
}

// Floating tooltip — portaled to body so it's never clipped by overflow:hidden panels
function Tooltip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div style={{
      position: "fixed",
      left: x + 14,
      top: y - 10,
      background: "rgba(10,14,22,0.97)",
      border: `1px solid ${HOME_THEME.cyan}66`,
      borderRadius: 8,
      padding: "8px 14px",
      pointerEvents: "none",
      zIndex: 99999,
      boxShadow: `0 4px 24px rgba(0,0,0,0.7), 0 0 0 1px ${HOME_THEME.cyan}18`,
      whiteSpace: "nowrap",
    }}>
      {children}
    </div>,
    document.body
  );
}

// Mini bar chart
function BarChart({ data, height = 160, color = HOME_THEME.cyan, valueKey = "revenue" }: {
  data: SalesByDay[];
  height?: number;
  color?: string;
  valueKey?: "revenue" | "orders";
}) {
  const [tip, setTip] = useState<{ x: number; y: number; d: SalesByDay } | null>(null);
  const max = Math.max(...data.map((d) => d[valueKey] as number), 1);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: data.length > 10 ? 3 : 6, height, width: "100%", paddingBottom: 22 }}>
        {data.map((d, i) => {
          const val = d[valueKey] as number;
          const barH = Math.max(4, (val / max) * (height - 28));
          return (
            <div
              key={i}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: 1, minWidth: 0 }}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, d })}
              onMouseLeave={() => setTip(null)}
            >
              <div
                style={{
                  width: "100%",
                  height: barH,
                  background: `linear-gradient(180deg, ${color}cc, ${color}44)`,
                  borderRadius: "3px 3px 0 0",
                  cursor: "crosshair",
                  transition: "filter .1s",
                  filter: tip?.d === d ? `drop-shadow(0 0 6px ${color}99)` : "none",
                }}
              />
              {data.length <= 14 && (
                <span style={{ fontSize: 9, color: HOME_THEME.muted, whiteSpace: "nowrap" }}>{d.label}</span>
              )}
            </div>
          );
        })}
      </div>
      {tip && (
        <Tooltip x={tip.x} y={tip.y}>
          <div style={{ fontSize: 11, fontWeight: 500, color: HOME_THEME.text, marginBottom: 5 }}>{tip.d.label}</div>
          <div style={{ display: "flex", gap: 16 }}>
            <div>
              <div style={{ fontSize: 9, color: HOME_THEME.muted, marginBottom: 2 }}>REVENUE</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.cyan }}>{fmtMoney(tip.d.revenue)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: HOME_THEME.muted, marginBottom: 2 }}>ORDERS</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.green }}>{tip.d.orders}</div>
            </div>
          </div>
        </Tooltip>
      )}
    </div>
  );
}

// Donut chart (SVG)
function DonutChart({ products }: { products: ProductEarning[] }) {
  const SIZE = 130;
  const R = 48;
  const CX = SIZE / 2;
  const total = products.reduce((s, p) => s + p.revenue, 0);
  let angle = -90;
  const slices = products.map((p) => {
    const sweep = (p.revenue / total) * 360;
    const start = angle;
    angle += sweep;
    return { ...p, start, sweep };
  });

  function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number) {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const x1 = cx + r * Math.cos(toRad(startDeg));
    const y1 = cy + r * Math.sin(toRad(startDeg));
    const x2 = cx + r * Math.cos(toRad(startDeg + sweepDeg));
    const y2 = cy + r * Math.sin(toRad(startDeg + sweepDeg));
    const large = sweepDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  }

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      {slices.map((s, i) => (
        <path
          key={i}
          d={arcPath(CX, CX, R, s.start, s.sweep - 1)}
          fill="none"
          stroke={s.color}
          strokeWidth={22}
          strokeLinecap="butt"
        />
      ))}
      <circle cx={CX} cy={CX} r={28} fill={HOME_THEME.panel} />
      <text x={CX} y={CX - 5} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={800}>TOP</text>
      <text x={CX} y={CX + 9} textAnchor="middle" fill={HOME_THEME.muted} fontSize={9}>5</text>
    </svg>
  );
}

// Calendar grid
function SalesCalendar({ year, month, days, onNav }: {
  year: number; month: number;
  days: CalendarDay[];
  onNav: (dir: -1 | 1) => void;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; day: CalendarDay } | null>(null);
  const max = Math.max(...days.filter((d) => d.inMonth).map((d) => d.revenue), 1);
  const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  return (
    <div style={{ ...homePanelStyle, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: HOME_THEME.text }}>{MONTH_NAMES[month]} {year}</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => onNav(-1)} style={{ ...homeSecondaryButtonStyle, padding: "3px 10px", fontSize: 11 }}>‹</button>
          <button onClick={() => onNav(1)} style={{ ...homeSecondaryButtonStyle, padding: "3px 10px", fontSize: 11 }}>›</button>
        </div>
      </div>
      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {WEEK_DAYS.map((d) => (
          <div key={d} style={{ textAlign: "center", fontSize: 9, fontWeight: 500, color: HOME_THEME.muted, letterSpacing: "0.01em", padding: "4px 0" }}>{d}</div>
        ))}
        {days.map((day, i) => {
          const intensity = day.inMonth && day.revenue > 0 ? (day.revenue / max) : 0;
          const isToday = isCurrentMonth && day.inMonth && day.date === today.getDate();
          return (
            <div
              key={i}
              style={{
                aspectRatio: "1",
                borderRadius: 6,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                background: day.inMonth && intensity > 0
                  ? `rgba(33,158,188,${0.07 + intensity * 0.35})`
                  : "rgba(255,255,255,0.02)",
                border: isToday ? `1px solid ${HOME_THEME.cyan}88` : "1px solid transparent",
                cursor: day.inMonth && day.revenue > 0 ? "crosshair" : "default",
                opacity: day.inMonth ? 1 : 0.25,
                transition: "background .15s, border-color .15s",
              }}
              onMouseMove={day.inMonth && day.revenue > 0 ? (e) => setTip({ x: e.clientX, y: e.clientY, day }) : undefined}
              onMouseLeave={day.inMonth && day.revenue > 0 ? () => setTip(null) : undefined}
            >
              <span style={{ fontSize: 10, fontWeight: isToday ? 800 : 500, color: isToday ? HOME_THEME.cyan : day.inMonth ? "#fff" : HOME_THEME.muted }}>
                {day.date}
              </span>
              {day.inMonth && day.revenue > 0 && (
                <span style={{ fontSize: 11, color: HOME_THEME.cyan, fontFamily: "monospace", fontWeight: 700 }}>{fmtMoney(day.revenue)}</span>
              )}
            </div>
          );
        })}
      </div>
      {tip && (
        <Tooltip x={tip.x} y={tip.y}>
          <div style={{ fontSize: 11, fontWeight: 500, color: HOME_THEME.text, marginBottom: 4 }}>
            {MONTH_NAMES[month]} {tip.day.date}, {year}
          </div>
          <div>
            <div style={{ fontSize: 9, color: HOME_THEME.muted, marginBottom: 2 }}>DAILY REVENUE</div>
            <div style={{ fontSize: 16, fontWeight: 500, color: HOME_THEME.cyan }}>{fmtMoney(tip.day.revenue)}</div>
          </div>
        </Tooltip>
      )}
    </div>
  );
}

// Live transaction log
function TransactionLog({ txns }: { txns: Transaction[] }) {
  const statusColors: Record<string, string> = {
    completed: HOME_THEME.green,
    pending: HOME_THEME.orange,
    failed: HOME_THEME.red,
  };

  return (
    <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${HOME_THEME.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: HOME_THEME.green, boxShadow: `0 0 7px ${HOME_THEME.green}`, flexShrink: 0, display: "inline-block" }} />
        <span style={{ fontSize: 10, fontWeight: 500, color: HOME_THEME.cyan, letterSpacing: "0.01em" }}>Live Transactions</span>
        <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: `${HOME_THEME.cyan}15`, border: `1px solid ${HOME_THEME.cyan}33`, color: HOME_THEME.cyan }}>{txns.length}</span>
      </div>
      {/* Column headers */}
      <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 70px 70px", gap: 8, padding: "6px 16px", borderBottom: `1px solid ${HOME_THEME.border}`, fontSize: 9, fontWeight: 500, color: HOME_THEME.muted, letterSpacing: "0.01em", flexShrink: 0 }}>
        <span>ID</span><span>Customer</span><span>Product</span><span style={{ textAlign: "right" }}>Amount</span><span style={{ textAlign: "right" }}>Status</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", fontFamily: "monospace" }}>
        {txns.map((t, i) => (
          <div
            key={t.id + i}
            style={{
              display: "grid",
              gridTemplateColumns: "60px 1fr 1fr 70px 70px",
              gap: 8,
              padding: "7px 16px",
              borderBottom: `1px solid rgba(255,255,255,0.04)`,
              fontSize: 12,
              alignItems: "center",
              animation: i === 0 ? "fadeIn .4s ease" : "none",
            }}
          >
            <span style={{ color: HOME_THEME.muted }}>{t.id}</span>
            <span style={{ color: HOME_THEME.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.customer}</span>
            <span style={{ color: HOME_THEME.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.product}</span>
            <span style={{ textAlign: "right", color: HOME_THEME.cyan, fontWeight: 700 }}>${t.amount.toFixed(2)}</span>
            <span style={{ textAlign: "right" }}>
              <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 10, fontWeight: 700, background: `${statusColors[t.status]}18`, border: `1px solid ${statusColors[t.status]}44`, color: statusColors[t.status] }}>
                {t.status}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Traffic sparkline (mini line chart)
function TrafficSparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  const W = 100, H = 60;
  const pad = 4;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - pad - (v / max) * (H - pad * 2);
    return `${x},${y}`;
  }).join(" ");

  const firstPt = `0,${H - pad - (data[0] / max) * (H - pad * 2)}`;
  const lastPt = `${W},${H - pad - (data[data.length - 1] / max) * (H - pad * 2)}`;

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={HOME_THEME.purple} stopOpacity="0.55" />
          <stop offset="100%" stopColor={HOME_THEME.purple} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${H} ${pts} ${W},${H}`}
        fill="url(#sparkGrad)"
      />
      <polyline points={pts} fill="none" stroke={HOME_THEME.purple} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Financial Analytics (Monex-style) ─────────────────────────────────────────

const FA_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function FinancialAnalytics({ period }: { period: Period }) {
  // Deterministic mock data, varies per period
  const periodSeed: Record<Period, number> = {
    current_week: 424242, current_month: 717171, last_week: 131313, last_month: 909090, current_year: 555555,
  };
  // per-bucket multiplier (a week bucket is ~1 day, month bucket ~1 week, year bucket ~1 month)
  const scale: Record<Period, number> = {
    current_week: 0.14, current_month: 1, last_week: 0.13, last_month: 0.95, current_year: 4.1,
  };
  const k = scale[period];
  const rng = seedRand(periodSeed[period]);
  const labels = periodBuckets(period);
  const months = labels.map((m) => {
    const income = Math.round((rng() * 12000 + 26000) * k);
    const expenses = Math.round((rng() * 9000 + 22000) * k);
    return { m, income, expenses };
  });
  const totalIncome = months.reduce((a, b) => a + b.income, 0);
  const totalExpenses = months.reduce((a, b) => a + b.expenses, 0);
  const netIncome = totalIncome - totalExpenses;

  const maxBar = Math.max(...months.flatMap((d) => [d.income, d.expenses]));

  const sources = [
    { name: "Salary", value: Math.round(142000 * k), pct: 37, color: HOME_THEME.cyan },
    { name: "Business", value: Math.round(168000 * k), pct: 44, color: HOME_THEME.green },
    { name: "Investment", value: Math.round(74500 * k), pct: 19, color: HOME_THEME.purple },
  ];
  const incomeOverviewTotal = sources.reduce((a, b) => a + b.value, 0);

  const expenseCats = [
    { name: "Housing", pct: 40, color: HOME_THEME.cyan },
    { name: "Transportation", pct: 25, color: HOME_THEME.purple },
    { name: "Entertainment", pct: 20, color: HOME_THEME.green },
    { name: "Food", pct: 10, color: "#f5a623" },
    { name: "Other", pct: 5, color: HOME_THEME.muted },
  ];

  // Donut math
  let acc = 0;
  const R = 52, C = 2 * Math.PI * R;
  const segs = expenseCats.map((c) => {
    const len = (c.pct / 100) * C;
    const seg = { ...c, dash: `${len} ${C - len}`, offset: -acc };
    acc += len;
    return seg;
  });

  // Forecast sparkline (income vs expenses 6 pts)
  const fc = months.slice(0, 7);
  const fcMax = Math.max(...fc.flatMap((d) => [d.income, d.expenses]));
  const poly = (key: "income" | "expenses") =>
    fc.map((d, i) => `${(i / (fc.length - 1)) * 100},${40 - (d[key] / fcMax) * 36}`).join(" ");

  return (
    <div>
      <SectionLabel>Financial Analytics · {PERIOD_LABELS[period]}</SectionLabel>

      {/* Top: bar chart + totals */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <div style={{ ...homePanelStyle, padding: "16px 18px" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: HOME_THEME.text, marginBottom: 2 }}>Income vs Expenses</div>
          <div style={{ fontSize: 11, color: HOME_THEME.muted, marginBottom: 16 }}>{PERIOD_LABELS[period]} · 2026</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 230 }}>
            {months.map((d) => (
              <div key={d.m} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 200, width: "100%", justifyContent: "center" }}>
                  <div title={`Income ${fmtMoney(d.income)}`} style={{ width: 18, height: `${(d.income / maxBar) * 100}%`, background: HOME_THEME.cyan, borderRadius: 4 }} />
                  <div title={`Expenses ${fmtMoney(d.expenses)}`} style={{ width: 18, height: `${(d.expenses / maxBar) * 100}%`, background: HOME_THEME.purple, borderRadius: 4 }} />
                </div>
                <div style={{ fontSize: 11, color: HOME_THEME.muted, whiteSpace: "nowrap" }}>{d.m}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 12, color: HOME_THEME.muted }}>
            <span><span style={{ color: HOME_THEME.cyan }}>■</span> Income</span>
            <span><span style={{ color: HOME_THEME.purple }}>■</span> Expenses</span>
          </div>
        </div>

        <div style={{ ...homePanelStyle, padding: "16px 18px", display: "flex", flexDirection: "column", justifyContent: "space-around" }}>
          {[
            { label: "Total Income", value: totalIncome, delta: 8.7, up: true },
            { label: "Total Expenses", value: totalExpenses, delta: -6.3, up: false },
            { label: "Total Net Income", value: netIncome, delta: 21.4, up: true },
          ].map((row) => (
            <div key={row.label}>
              <div style={{ fontSize: 10, color: HOME_THEME.muted, letterSpacing: "0.01em" }}>{row.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <div style={{ fontSize: 22, fontWeight: 500, color: HOME_THEME.text }}>{fmtMoney(row.value)}</div>
                <span style={{ fontSize: 10, fontWeight: 700, color: row.up ? HOME_THEME.green : HOME_THEME.red }}>
                  {row.up ? "▲" : "▼"} {Math.abs(row.delta)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom: income overview / expense donut / forecast */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 12 }}>
        {/* Income Overview */}
        <div style={{ ...homePanelStyle, padding: "16px 18px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: HOME_THEME.text, marginBottom: 10 }}>Income Overview</div>
          <div style={{ fontSize: 24, fontWeight: 500, color: HOME_THEME.text, marginBottom: 10 }}>{fmtMoney(incomeOverviewTotal)}</div>
          <div style={{ display: "flex", height: 6, borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
            {sources.map((s) => (<div key={s.name} style={{ width: `${s.pct}%`, background: s.color }} />))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            {sources.map((s) => (
              <div key={s.name}>
                <div style={{ fontSize: 10, color: HOME_THEME.muted }}><span style={{ color: s.color }}>●</span> {s.name}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.text }}>{fmtMoney(s.value)}</div>
                <div style={{ fontSize: 10, color: HOME_THEME.muted }}>{s.pct}%</div>
              </div>
            ))}
          </div>
        </div>

        {/* Expense Analysis donut */}
        <div style={{ ...homePanelStyle, padding: "16px 18px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: HOME_THEME.text, marginBottom: 10 }}>Expense Analysis</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <svg width="120" height="120" viewBox="0 0 120 120">
              <g transform="rotate(-90 60 60)">
                {segs.map((s) => (
                  <circle key={s.name} cx="60" cy="60" r={R} fill="none" stroke={s.color} strokeWidth="14"
                    strokeDasharray={s.dash} strokeDashoffset={s.offset} />
                ))}
              </g>
              <text x="60" y="58" textAnchor="middle" fontSize="20" fontWeight="800" fill="#fff">130</text>
              <text x="60" y="74" textAnchor="middle" fontSize="9" fill={HOME_THEME.muted}>Total</text>
            </svg>
            <div style={{ flex: 1 }}>
              {expenseCats.map((c) => (
                <div key={c.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 4 }}>
                  <span style={{ color: HOME_THEME.muted }}><span style={{ color: c.color }}>●</span> {c.name}</span>
                  <span style={{ color: HOME_THEME.text, fontWeight: 700 }}>{c.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Financial Forecast */}
        <div style={{ ...homePanelStyle, padding: "16px 18px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: HOME_THEME.text, marginBottom: 10 }}>Financial Forecast</div>
          <svg width="100%" height="90" viewBox="0 0 100 44" preserveAspectRatio="none">
            <polyline points={poly("income")} fill="none" stroke={HOME_THEME.cyan} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <polyline points={poly("expenses")} fill="none" stroke={HOME_THEME.purple} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
          <div style={{ display: "flex", gap: 14, fontSize: 10, color: HOME_THEME.muted, margin: "8px 0" }}>
            <span><span style={{ color: HOME_THEME.cyan }}>■</span> Income</span>
            <span><span style={{ color: HOME_THEME.purple }}>■</span> Expenses</span>
          </div>
          <div style={{ fontSize: 10, color: HOME_THEME.muted, lineHeight: 1.5, background: "rgba(255,255,255,0.03)", padding: "8px 10px", borderRadius: 8 }}>
            ☀️ Expecting a <span style={{ color: HOME_THEME.red, fontWeight: 700 }}>deficit in May</span>. Consider saving more in April or optimizing leisure expenses.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [period, setPeriod] = useState<Period>("current_week");
  const [kpi, setKpi] = useState<KpiData>(() => genKpi("current_week"));
  const [dailySales, setDailySales] = useState<SalesByDay[]>(() => genDailySales("current_week"));
  const [products] = useState<ProductEarning[]>(() => genProducts());
  const [countries] = useState<CountryUser[]>(() => genCountries());
  const [transactions, setTransactions] = useState<Transaction[]>(() =>
    Array.from({ length: 20 }, genTransaction)
  );
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [calDays, setCalDays] = useState(() => buildCalendar(new Date().getFullYear(), new Date().getMonth()));

  // Refresh kpi/chart on period change
  useEffect(() => {
    setKpi(genKpi(period));
    setDailySales(genDailySales(period));
  }, [period]);

  // Calendar nav
  function navCal(dir: -1 | 1) {
    setCalMonth((m) => {
      let nm = m + dir;
      let ny = calYear;
      if (nm < 0) { nm = 11; ny -= 1; setCalYear(ny); }
      if (nm > 11) { nm = 0; ny += 1; setCalYear(ny); }
      setCalDays(buildCalendar(ny, nm));
      return nm;
    });
  }

  // Simulate live transaction feed
  const txnRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    txnRef.current = setInterval(() => {
      setTransactions((prev) => [genTransaction(), ...prev].slice(0, 50));
    }, 2800);
    return () => { if (txnRef.current) clearInterval(txnRef.current); };
  }, []);

  // Traffic sparkline data
  const trafficData = Array.from({ length: 24 }, (_, i) => {
    const r = seedRand(period.length + i);
    return Math.round(r() * 1200 + 200);
  });

  const PERIODS: Period[] = ["current_week", "current_month", "last_week", "last_month", "current_year"];

  return (
    <div style={homeShellStyle}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
      `}</style>

      {/* Header */}
      <div style={homeHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 500, letterSpacing: "0.01em", color: HOME_THEME.text }}>
            Admin dashboard
          </span>
          <span style={{ fontSize: 10, color: HOME_THEME.muted }}>Sales · Traffic · Growth</span>
        </div>
        {/* Right: period selector + Owner link */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  ...homeSecondaryButtonStyle,
                  padding: "5px 12px",
                  fontSize: 10,
                  color: period === p ? HOME_THEME.cyan : HOME_THEME.muted,
                  borderColor: period === p ? `${HOME_THEME.cyan}44` : HOME_THEME.border,
                  background: period === p ? `${HOME_THEME.cyan}10` : "rgba(255,255,255,0.04)",
                }}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          {/* Owner-group quick links */}
          <OwnerQuickLinks current="/dev/admin" />
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(14px,2vw,22px)", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── Financial Analytics (top) ── */}
        <FinancialAnalytics period={period} />

        {/* ── KPI row ── */}
        <div>
          <SectionLabel>Key Metrics · {PERIOD_LABELS[period]}</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
            <KpiCard label="Total Revenue" value={fmtMoney(kpi.totalRevenue)} delta={kpi.revenueDelta} />
            <KpiCard label="Total Sales" value={fmtNum(kpi.totalSales)} delta={kpi.salesDelta} />
            <KpiCard label="New Users" value={fmtNum(kpi.totalUsers)} delta={kpi.usersDelta} />
            <KpiCard label="Traffic" value={fmtNum(kpi.totalTraffic)} delta={kpi.trafficDelta} />
          </div>
        </div>

        {/* ── Charts row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* Revenue bar chart */}
          <div style={{ ...homePanelStyle, padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: HOME_THEME.text }}>Revenue Growth</div>
                <div style={{ fontSize: 10, color: HOME_THEME.muted, marginTop: 2 }}>Daily breakdown · {PERIOD_LABELS[period]}</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 500, color: HOME_THEME.cyan }}>{fmtMoney(kpi.totalRevenue)}</div>
            </div>
            <BarChart data={dailySales} height={140} color={HOME_THEME.cyan} valueKey="revenue" />
          </div>

          {/* Order Volume bar chart */}
          <div style={{ ...homePanelStyle, padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: HOME_THEME.text }}>Order Volume</div>
                <div style={{ fontSize: 10, color: HOME_THEME.muted, marginTop: 2 }}>Units sold per day · {PERIOD_LABELS[period]}</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 500, color: HOME_THEME.green }}>
                {dailySales.reduce((s, d) => s + d.orders, 0).toLocaleString()} orders
              </div>
            </div>
            <BarChart data={dailySales} height={140} color={HOME_THEME.green} valueKey="orders" />
          </div>
        </div>

        {/* ── Traffic row ── */}
        <div style={{ ...homePanelStyle, padding: "16px 18px", display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: HOME_THEME.text, marginBottom: 8 }}>Traffic · 24h</div>
            <TrafficSparkline data={trafficData} />
          </div>
          <div style={{ display: "flex", gap: 16, flexShrink: 0 }}>
            <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "10px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: HOME_THEME.muted, marginBottom: 3 }}>PEAK / HR</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: HOME_THEME.purple }}>{Math.max(...trafficData).toLocaleString()}</div>
            </div>
            <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "10px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: HOME_THEME.muted, marginBottom: 3 }}>AVG / HR</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: HOME_THEME.purple }}>
                {Math.round(trafficData.reduce((a, b) => a + b, 0) / trafficData.length).toLocaleString()}
              </div>
            </div>
            <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "10px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: HOME_THEME.muted, marginBottom: 3 }}>TOTAL</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: HOME_THEME.purple }}>
                {fmtNum(trafficData.reduce((a, b) => a + b, 0))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Products + Countries + Calendar row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {/* Earnings by product */}
          <div style={{ ...homePanelStyle, padding: "16px 18px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: HOME_THEME.text, marginBottom: 14 }}>Earnings by Product</div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <DonutChart products={products} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                {products.map((p) => (
                  <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 11, color: HOME_THEME.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: p.color }}>{p.pct}%</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 5 }}>
              {products.map((p) => (
                <div key={p.name}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: HOME_THEME.muted, marginBottom: 3 }}>
                    <span>{p.name}</span>
                    <span style={{ color: HOME_THEME.text }}>{fmtMoney(p.revenue)}</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${p.pct}%`, background: p.color, borderRadius: 2 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Users by country */}
          <div style={{ ...homePanelStyle, padding: "16px 18px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: HOME_THEME.text, marginBottom: 14 }}>Users by Country</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {countries.map((c) => (
                <div key={c.country}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 16 }}>{c.flag}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: HOME_THEME.text }}>{c.country}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: HOME_THEME.muted }}>{c.users.toLocaleString()}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: HOME_THEME.cyan, minWidth: 28, textAlign: "right" }}>{c.pct}%</span>
                    </div>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${c.pct}%`, background: `linear-gradient(90deg, ${HOME_THEME.cyan}, ${HOME_THEME.purple})`, borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sales Calendar */}
          <SalesCalendar year={calYear} month={calMonth} days={calDays} onNav={navCal} />
        </div>

        {/* ── Live Transaction Log ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel>Live Transaction Log</SectionLabel>
          <div style={{ height: 340 }}>
            <TransactionLog txns={transactions} />
          </div>
        </div>


      </div>
    </div>
  );
}
