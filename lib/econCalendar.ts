/**
 * econCalendar — shared types, ET helpers and filter logic for the economic
 * calendar feed.
 *
 * PROVENANCE: copied verbatim from components/dashboard/EconCalendarPanel.tsx,
 * which is the more complete of the two desktop implementations. The other,
 * components/pages/EconomicCalendar.tsx, holds a drifted duplicate — its
 * `FilterKey` union is missing "all-usd" and "earnings", and its day-separator
 * renderer omits the panel's `.sort()`. Both should be migrated onto this
 * module; the phone view already is, so there are two copies rather than three.
 *
 * Everything here is ET-based on purpose. A trader in London must see the same
 * "TODAY" and the same 30-minute staleness cutoff as one in New York, so every
 * date and clock value round-trips through Intl with timeZone: America/New_York
 * rather than reading the device's local time.
 */

export interface CalEvent {
  date: string;            // YYYY-MM-DD, ET
  time: string;            // HH:MM 24h, ET — the sort/compare key
  time_formatted: string;  // h:MM AM/PM, ET — the display key
  title: string;
  country: string;
  impact: string;          // High | Medium | Low | Holiday | President
  forecast: string;
  previous: string;
  actual: string;
}

export interface EarnRow {
  date: string;            // YYYY-MM-DD, ET
  symbol: string;
  company: string;
  session: "pre" | "after" | "unknown";
  market_cap: number;
  eps_est: string | null;
}

export const IMPACT_COLOR: Record<string, string> = {
  High: "#ef4444",
  Medium: "#f59e0b",
  Low: "#3a5570",
  Holiday: "#6b7280",
  President: "#a855f7",
};

export function impactColor(i: string): string {
  return IMPACT_COLOR[i] ?? "#3a5570";
}

export function fmtMcap(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  return `$${Math.round(n / 1e9)}B`;
}

export function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

/** Rolling today → today+6, as YYYY-MM-DD ET strings. */
export function etWeekDays(): string[] {
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, day] = todayStr.split("-").map(Number);
  const base = new Date(y, m - 1, day);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(base);
    x.setDate(base.getDate() + i);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  });
}

/** ET wall clock as a date string + minutes since midnight. */
export function etNowParts(nowMs: number): { date: string; minutes: number } {
  const d = new Date(nowMs);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  const [h, m] = hm.split(":").map(Number);
  return { date, minutes: h * 60 + m };
}

/** An event goes stale 30 minutes after its scheduled start. */
export function isStale(ev: CalEvent, nowMs: number): boolean {
  const { date: etDate, minutes: nowMin } = etNowParts(nowMs);
  if (ev.date < etDate) return true;
  if (ev.date > etDate) return false;
  if (!ev.time) return false;
  const [h, m] = ev.time.split(":").map(Number);
  const evMin = h * 60 + m;
  return nowMin - evMin > 30;
}

export function dayLabel(dateStr: string, today: string): string {
  if (dateStr === today) return "TODAY";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}

export function fullDayLabel(dateStr: string, today: string): string {
  if (dateStr === today) return "TODAY";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toUpperCase();
}

export type FilterKey =
  | "all-usd"
  | "high-usd"
  | "high"
  | "medium-usd"
  | "medium"
  | "low-usd"
  | "low"
  | "trump"
  | "earnings"
  | "all";

export const FILTER_OPTS: { value: FilterKey; label: string; color: string }[] = [
  { value: "all-usd", label: "All·USD", color: "#219EBC" },
  { value: "high-usd", label: "High·USD", color: "#ef4444" },
  { value: "high", label: "High", color: "#ef4444" },
  { value: "medium-usd", label: "Medium·USD", color: "#f59e0b" },
  { value: "medium", label: "Medium", color: "#f59e0b" },
  { value: "low-usd", label: "Low·USD", color: "#3a5570" },
  { value: "low", label: "Low", color: "#3a5570" },
  { value: "trump", label: "TRUMP", color: "#a855f7" },
  { value: "earnings", label: "Earnings", color: "#219EBC" },
  { value: "all", label: "All", color: "#fff" },
];

export function passes(ev: CalEvent, active: Set<FilterKey>): boolean {
  if (active.has("all")) return true;
  if (active.has("trump") && ev.impact === "President") return true;
  if (active.has("all-usd") && ev.country === "USD") return true;
  if (active.has("high-usd") && ev.impact === "High" && ev.country === "USD") return true;
  if (active.has("high") && ev.impact === "High") return true;
  if (active.has("medium-usd") && ev.impact === "Medium" && ev.country === "USD") return true;
  if (active.has("medium") && ev.impact === "Medium") return true;
  if (active.has("low-usd") && ev.impact === "Low" && ev.country === "USD") return true;
  if (active.has("low") && ev.impact === "Low") return true;
  return false;
}

/** date → { pre, after } earnings buckets. "unknown" sessions are dropped. */
export function groupEarningsByDate(rows: EarnRow[]): Map<string, { pre: EarnRow[]; after: EarnRow[] }> {
  const map = new Map<string, { pre: EarnRow[]; after: EarnRow[] }>();
  for (const r of rows) {
    if (r.session !== "pre" && r.session !== "after") continue;
    if (!map.has(r.date)) map.set(r.date, { pre: [], after: [] });
    map.get(r.date)![r.session].push(r);
  }
  return map;
}
